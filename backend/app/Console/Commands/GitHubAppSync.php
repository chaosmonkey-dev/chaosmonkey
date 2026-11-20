<?php

namespace App\Console\Commands;

use App\Services\GitHubAppIngestionService;
use App\Services\GitHubAppTokenService;
use Illuminate\Console\Command;

/**
 * Organization-wide GitHub App historical synchronization.
 *
 * Authenticates via the GitHub App installation token (NOT customer OAuth)
 * and ingests pull requests, deployments, and releases through the same
 * GitHubAppIngestionService code path that live webhooks use. Writes are
 * idempotent upserts keyed on (repo_name, pr_number) / (repo_name, sha,
 * environment) / (repo_name, tag_name).
 *
 * AUTHORITY MODEL:
 * The repository authority is the installation itself — only repositories
 * returned by GET /installation/repositories for this org's installation_id
 * can be synchronized. An explicit --repo is validated against that list,
 * never trusted directly. This is independent of (and does not broaden)
 * the OAuth allow-list used by github:sync-*.
 *
 * RESUMABILITY:
 * Safe to interrupt and re-run. Upserts are idempotent; --from-repo skips
 * ahead to a named repo in the deterministic (alphabetical) repo ordering.
 */
class GitHubAppSync extends Command
{
    protected $signature = 'github:app-sync
                            {--repo= : Single repo (owner/name); must belong to the installation}
                            {--repos= : Comma-separated repo list; each validated against the installation}
                            {--all : Synchronize every repository in the installation}
                            {--days=90 : Historical window (days back from now)}
                            {--include-deployments : Also sync deployments (requires deployments:read)}
                            {--include-releases : Also sync releases (requires contents:read)}
                            {--enrich-reviews : Fetch real review evidence (pulls/{n}/reviews) for ingested PRs}
                            {--skip-details : Do not fetch per-PR detail (fewer API calls, less lineage)}
                            {--max-prs-per-repo=0 : Cap PRs ingested per repo (0 = no cap)}
                            {--max-deploys-per-repo=100 : Cap deployments ingested per repo}
                            {--from-repo= : Resume: skip repos until this name in the sorted list}
                            {--sleep-ms=250 : Base delay between API calls (milliseconds)}
                            {--dry-run : Inventory only; no writes}';

    protected $description = 'Historical sync via GitHub App installation token (OAuth-independent)';

    private string $token;
    private int $apiCalls = 0;
    private int $rateLimitRemaining = -1;
    private int $rateLimitReset = 0;

    public function handle(GitHubAppTokenService $tokenService, GitHubAppIngestionService $ingestion): int
    {
        $installationId = $tokenService->resolveInstallationId();
        if (!$installationId) {
            $this->error('GITHUB_APP_INSTALLATION_ID not configured');
            return 1;
        }

        $this->token = $tokenService->getInstallationToken($installationId);
        if (!$this->token) {
            $this->error('Failed to mint installation token');
            return 1;
        }

        $days = max(1, (int) $this->option('days'));
        $cutoff = gmdate('Y-m-d\TH:i:s\Z', time() - ($days * 86400));
        $dryRun = (bool) $this->option('dry-run');
        $sleepMs = max(0, (int) $this->option('sleep-ms'));

        if ($this->option('enrich-reviews')) {
            return $this->enrichReviews($ingestion, $installationId, $dryRun, $sleepMs);
        }

        $this->info("Installation: {$installationId}");
        $this->info("Window: {$days} days (updated_at >= {$cutoff})" . ($dryRun ? ' [DRY RUN]' : ''));

        // Repository authority = the installation's own repo list.
        $authorized = $this->listInstallationRepos();
        if ($authorized === null) {
            $this->error('Failed to list installation repositories');
            return 1;
        }
        $authNames = array_column($authorized, 'full_name');
        sort($authNames);
        $this->info('Authorized repositories: ' . count($authNames));

        $targets = $this->resolveTargets($authNames);
        if ($targets === null) {
            return 1;
        }

        $fromRepo = $this->option('from-repo');
        if ($fromRepo) {
            $skipped = 0;
            $targets = array_values(array_filter($targets, function ($r) use ($fromRepo, &$skipped) {
                $skip = strcasecmp($r, $fromRepo) < 0;
                if ($skip) $skipped++;
                return !$skip;
            }));
            $this->info("Resume from {$fromRepo}: skipped {$skipped} repos");
        }

        $totals = ['repos_ok' => 0, 'repos_empty' => 0, 'repos_failed' => 0, 'prs' => 0, 'deploys' => 0, 'releases' => 0];
        $failures = [];

        foreach ($targets as $repo) {
            $this->info("--- {$repo}");
            try {
                $n = $this->syncRepoPrs($repo, $cutoff, $days, $dryRun, $sleepMs);
                $totals['prs'] += $n;
                $n > 0 ? $totals['repos_ok']++ : $totals['repos_empty']++;

                if ($this->option('include-deployments')) {
                    $totals['deploys'] += $this->syncRepoDeployments($repo, $cutoff, $dryRun, $sleepMs);
                }
                if ($this->option('include-releases')) {
                    $totals['releases'] += $this->syncRepoReleases($repo, $cutoff, $dryRun, $sleepMs);
                }
            } catch (\Exception $e) {
                $totals['repos_failed']++;
                $failures[$repo] = $e->getMessage();
                $this->warn("  FAILED: " . $e->getMessage());
            }
        }

        $this->info('=== SUMMARY ===');
        $this->info("Repos synced (evidence found): {$totals['repos_ok']}");
        $this->info("Repos synced (no qualifying activity): {$totals['repos_empty']}");
        $this->info("Repos failed: {$totals['repos_failed']}");
        $this->info("PRs ingested: {$totals['prs']}");
        if ($this->option('include-deployments')) $this->info("Deployments ingested: {$totals['deploys']}");
        if ($this->option('include-releases')) $this->info("Releases ingested: {$totals['releases']}");
        $this->info("API calls: {$this->apiCalls}, rate-limit remaining: {$this->rateLimitRemaining}");
        foreach ($failures as $repo => $err) {
            $this->warn("  {$repo}: {$err}");
        }

        return $totals['repos_failed'] > 0 ? 2 : 0;
    }

    private function resolveTargets(array $authNames): ?array
    {
        if ($this->option('all')) {
            return $authNames;
        }
        $requested = [];
        if ($repo = $this->option('repo')) {
            $requested[] = $repo;
        }
        if ($list = $this->option('repos')) {
            foreach (explode(',', $list) as $r) {
                $r = trim($r);
                if ($r !== '') $requested[] = $r;
            }
        }
        if (empty($requested)) {
            $this->error('Specify --repo=, --repos=, or --all');
            return null;
        }
        $targets = [];
        foreach ($requested as $r) {
            $match = null;
            foreach ($authNames as $a) {
                if (strcasecmp($a, $r) === 0) { $match = $a; break; }
            }
            if (!$match) {
                $this->warn("  {$r}: not in installation repo list — skipped (outside authorized boundary)");
                continue;
            }
            $targets[] = $match;
        }
        if (empty($targets)) {
            $this->error('No requested repositories are authorized by the installation');
            return null;
        }
        return $targets;
    }

    private function listInstallationRepos(): ?array
    {
        $repos = [];
        for ($page = 1; $page <= 10; $page++) {
            $res = $this->api('GET', "https://api.github.com/installation/repositories?per_page=100&page={$page}");
            if (!$res || !isset($res['repositories'])) {
                return null;
            }
            foreach ($res['repositories'] as $r) {
                $repos[] = $r;
            }
            if (count($res['repositories']) < 100) {
                return $repos;
            }
        }
        return $repos;
    }

    private function syncRepoPrs(string $repo, string $cutoff, int $days, bool $dryRun, int $sleepMs): int
    {
        // PRs are listed sorted by updated_at desc; stop paginating once a
        // full page is older than the window. The list endpoint has no
        // 'since' filter, so the window is applied client-side on updated_at.
        $ingested = 0;
        $maxPrs = (int) $this->option('max-prs-per-repo');
        $skipDetails = (bool) $this->option('skip-details');

        for ($page = 1; $page <= 20; $page++) {
            $url = "https://api.github.com/repos/{$repo}/pulls?state=all&per_page=100&page={$page}&sort=updated&direction=desc";
            $page_items = $this->api('GET', $url);
            if ($page_items === null) {
                throw new \RuntimeException('PR list API failed on page ' . $page);
            }
            if (empty($page_items)) {
                break;
            }

            $oldestOnPage = end($page_items)['updated_at'] ?? null;
            foreach ($page_items as $pr) {
                if (($pr['updated_at'] ?? '') < $cutoff) {
                    continue;
                }
                if ($maxPrs > 0 && $ingested >= $maxPrs) {
                    break 2;
                }
                $detail = $pr;
                if (!$skipDetails) {
                    $detail = $this->api('GET', "https://api.github.com/repos/{$repo}/pulls/{$pr['number']}");
                    if ($detail === null) {
                        $this->warn("  PR #{$pr['number']}: detail fetch failed, using list fields");
                        $detail = $pr;
                    }
                    $this->throttle($sleepMs);
                }
                if (!$dryRun) {
                    $payload = [
                        'action' => 'synchronize',
                        'pull_request' => $detail,
                        'repository' => ['full_name' => $repo],
                        'sender' => ['login' => 'github-app-sync'],
                    ];
                    app(GitHubAppIngestionService::class)
                        ->ingestPullRequestEvent($payload, (int) config('services.github_app.installation_id'));
                }
                $ingested++;
            }
            if ($oldestOnPage && $oldestOnPage < $cutoff) {
                break;
            }
            if (count($page_items) < 100) {
                break;
            }
            $this->throttle($sleepMs);
        }

        $this->line("  PRs in window: {$ingested}" . ($dryRun ? ' (dry-run)' : ''));
        return $ingested;
    }

    private function syncRepoDeployments(string $repo, string $cutoff, bool $dryRun, int $sleepMs): int
    {
        $ingested = 0;
        $max = max(1, (int) $this->option('max-deploys-per-repo'));
        $deploys = $this->api('GET', "https://api.github.com/repos/{$repo}/deployments?per_page={$max}");
        if ($deploys === null) {
            $this->warn('  deployments: API unavailable (permission scope?)');
            return 0;
        }
        foreach ($deploys as $d) {
            if (($d['created_at'] ?? '') < $cutoff) {
                continue;
            }
            // Fetch latest status so the row lands with a real status, not 'pending'.
            $statuses = $this->api('GET', "https://api.github.com/repos/{$repo}/deployments/{$d['id']}/statuses?per_page=1");
            $this->throttle($sleepMs);
            $payload = [
                'deployment' => $d,
                'repository' => ['full_name' => $repo],
            ];
            if (is_array($statuses) && !empty($statuses[0])) {
                $payload['deployment_status'] = $statuses[0];
            }
            if (!$dryRun) {
                app(GitHubAppIngestionService::class)->ingestDeploymentEvent($payload);
            }
            $ingested++;
            if ($ingested >= $max) break;
        }
        $this->line("  Deployments in window: {$ingested}");
        return $ingested;
    }

    private function syncRepoReleases(string $repo, string $cutoff, bool $dryRun, int $sleepMs): int
    {
        $ingested = 0;
        $releases = $this->api('GET', "https://api.github.com/repos/{$repo}/releases?per_page=100");
        if ($releases === null) {
            $this->warn('  releases: API unavailable (permission scope?)');
            return 0;
        }
        foreach ($releases as $r) {
            $ts = $r['published_at'] ?? $r['created_at'] ?? '';
            if ($ts < $cutoff) {
                continue;
            }
            if (!$dryRun) {
                app(GitHubAppIngestionService::class)->ingestReleaseEvent([
                    'release' => $r,
                    'repository' => ['full_name' => $repo],
                ]);
            }
            $ingested++;
        }
        $this->line("  Releases in window: {$ingested}");
        return $ingested;
    }

    /**
     * Review enrichment: fetch completed PR reviews via pulls/{n}/reviews for
     * every PR already ingested from App-evidence repos, and populate the
     * aggregate review columns (review_count = submitted reviews,
     * unique_reviewer_count, first_review_at). Idempotent — re-running
     * recomputes the same aggregates. Scoped to rows whose repo_name belongs
     * to this installation's authorized repo list.
     */
    private function enrichReviews(GitHubAppIngestionService $ingestion, int $installationId, bool $dryRun, int $sleepMs): int
    {
        $authorized = $this->listInstallationRepos();
        if ($authorized === null) {
            $this->error('Failed to list installation repositories');
            return 1;
        }
        $authNames = array_map('strtolower', array_column($authorized, 'full_name'));

        $prs = \Illuminate\Support\Facades\DB::table('pull_requests')
            ->where('data_source', 'github_app')
            ->get(['id', 'repo_name', 'pr_number']);

        $targets = $prs->filter(fn($p) => in_array(strtolower($p->repo_name), $authNames, true));
        $this->info("Review enrichment: {$targets->count()} PRs across " . $targets->pluck('repo_name')->unique()->count() . " authorized repos");

        $enriched = 0; $reviewsFound = 0; $errors = 0;
        foreach ($targets as $pr) {
            $reviews = [];
            for ($page = 1; $page <= 5; $page++) {
                $batch = $this->api('GET', "https://api.github.com/repos/{$pr->repo_name}/pulls/{$pr->pr_number}/reviews?per_page=100&page={$page}");
                if ($batch === null) {
                    if ($page === 1) { $errors++; $this->warn("  {$pr->repo_name}#{$pr->pr_number}: reviews API failed"); }
                    break;
                }
                foreach ($batch as $r) $reviews[] = $r;
                if (count($batch) < 100) break;
                $this->throttle($sleepMs);
            }
            $this->throttle($sleepMs);

            // Submitted reviews only — PENDING is an unsubmitted draft.
            $submitted = array_values(array_filter($reviews, fn($r) =>
                ($r['state'] ?? '') !== 'PENDING' && !empty($r['submitted_at'])
            ));
            $reviewers = array_unique(array_filter(array_map(fn($r) => $r['user']['login'] ?? null, $submitted)));
            $firstAt = null;
            foreach ($submitted as $r) {
                $ts = $r['submitted_at'];
                if ($firstAt === null || $ts < $firstAt) $firstAt = $ts;
            }

            if (!$dryRun) {
                \Illuminate\Support\Facades\DB::table('pull_requests')->where('id', $pr->id)->update([
                    'review_count' => count($submitted),
                    'unique_reviewer_count' => count($reviewers),
                    'first_review_at' => $firstAt,
                ]);
            }
            $enriched++;
            $reviewsFound += count($submitted);
            if ($enriched % 200 === 0) {
                $this->line("  {$enriched} PRs processed, {$reviewsFound} reviews, rate-limit remaining {$this->rateLimitRemaining}");
            }
        }

        $this->info('=== REVIEW ENRICHMENT ===');
        $this->info("PRs processed: {$enriched}, reviews found: {$reviewsFound}, API errors: {$errors}");
        $this->info("API calls: {$this->apiCalls}, rate-limit remaining: {$this->rateLimitRemaining}");
        return $errors > 0 ? 2 : 0;
    }

    /**
     * Minimal GitHub API client with rate-limit awareness.
     * Returns decoded JSON array, or null on failure.
     */
    private function api(string $method, string $url, int $retries = 0): ?array
    {
        $this->waitForRateLimit();

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_USERAGENT => 'chaosmonkey-app-sync',
            CURLOPT_TIMEOUT => 30,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HEADERFUNCTION => function ($ch, $header) {
                if (stripos($header, 'X-RateLimit-Remaining:') === 0) {
                    $this->rateLimitRemaining = (int) trim(substr($header, 22));
                } elseif (stripos($header, 'X-RateLimit-Reset:') === 0) {
                    $this->rateLimitReset = (int) trim(substr($header, 18));
                }
                return strlen($header);
            },
            CURLOPT_HTTPHEADER => [
                "Authorization: Bearer {$this->token}",
                'Accept: application/vnd.github+json',
                'X-GitHub-Api-Version: 2022-11-28',
            ],
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $this->apiCalls++;

        $isRateLimited = $code === 429 || ($code === 403 && $this->rateLimitRemaining === 0);
        if ($isRateLimited && $retries < 2) {
            $this->warn('  rate-limited (' . $code . '); sleeping 60s');
            sleep(60);
            return $this->api($method, $url, $retries + 1);
        }
        if ($code < 200 || $code >= 300) {
            return null;
        }
        $data = json_decode($body, true);
        return is_array($data) ? $data : null;
    }

    private function waitForRateLimit(): void
    {
        if ($this->rateLimitRemaining >= 0 && $this->rateLimitRemaining < 20 && $this->rateLimitReset > time()) {
            $wait = min(3600, $this->rateLimitReset - time() + 5);
            $this->warn("  rate limit low ({$this->rateLimitRemaining}); sleeping {$wait}s until reset");
            sleep($wait);
        }
    }

    private function throttle(int $sleepMs): void
    {
        if ($sleepMs > 0) {
            usleep($sleepMs * 1000);
        }
    }
}
