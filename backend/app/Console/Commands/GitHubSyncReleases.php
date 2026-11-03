<?php

namespace App\Console\Commands;

use App\Services\ReleaseSyncService;
use App\Services\GitHubApiService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use App\Traits\PilotAwareTokenHelper;

class GitHubSyncReleases extends Command
{
    use PilotAwareTokenHelper;
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'github:sync-releases
                            {--repo= : Full repo name (e.g., mattmcclintock/cm-activity-sim)}
                            {--per_page=100 : Items per page (max 100)}
                            {--max_pages=10 : Maximum pages to fetch (0 for unlimited)}
                            {--since= : Only releases published since this date (YYYY-MM-DD)}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Sync releases from GitHub API to local database';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $repo = $this->option('repo');
        $perPage = (int) $this->option('per_page');
        $maxPages = (int) $this->option('max_pages');
        $since = $this->option('since');

        // Validate per_page (GitHub API max is 100)
        if ($perPage > 100) {
            $this->warn("per_page cannot exceed 100, using 100");
            $perPage = 100;
        }
        if ($perPage < 1) {
            $this->warn("per_page must be at least 1, using 100");
            $perPage = 100;
        }

        $repoParts = $repo ? explode('/', $repo) : [];
        if (count($repoParts) !== 2) {
            $this->error('Repo is required in owner/repo format. Use --repo=owner/repo');
            return 1;
        }

        $this->info("Starting GitHub release sync...");
        $this->info("Repo: {$repo}");
        $this->info("Per page: {$perPage}");
        $maxPagesDisplay = $maxPages === 0 ? 'unlimited' : $maxPages;
        $this->info("Max pages: {$maxPagesDisplay}");
        $sinceDisplay = $since ?: 'all time';
        $this->info("Since: {$sinceDisplay}");

        $organizationId = $this->getSyncOrganizationId();
        $oauthToken = $organizationId ? $this->getOAuthToken() : null;
        if (!$organizationId || !$oauthToken) {
            $this->error('No organization engineering_integration OAuth token found. Please reconnect GitHub Engineering Data first.');
            return 1;
        }

        $oauthUser = $this->getOrgEngineeringUser($organizationId);
        $repo = $this->resolveAuthorizedSyncRepo($repo, $oauthToken, $oauthUser, $organizationId);
        if (!$repo) {
            $this->error('Repo is not authorized customer evidence. Reconnect an engineering account that can see this telemetry-derived customer repository.');
            Log::info('GitHubSyncReleases: repo failed customer authority gate', [
                'repo' => $repoParts[0] . '/' . $repoParts[1],
                'organization_id' => $organizationId,
            ]);
            return 1;
        }

        $this->info("OAuth token found: " . substr($oauthToken, 0, 10) . '...');
        $repoParts = explode('/', $repo);
        $owner = $repoParts[0];
        $repoName = $repoParts[1];

        $releaseSyncService = new ReleaseSyncService();

        $page = 1;
        $totalFetched = 0;
        $totalUpserted = 0;
        $apiCalls = 0;

        $this->info("Fetching releases from GitHub API...");

        while (true) {
            // Check max pages limit
            if ($maxPages > 0 && $page > $maxPages) {
                $this->info("Reached max pages limit ({$maxPages})");
                break;
            }

            $this->line("Fetching page {$page}...");

            // Build API URL
            $endpoint = "repos/{$owner}/{$repoName}/releases?per_page={$perPage}&page={$page}";
            $releases = $this->githubApiCall($oauthToken, $endpoint);
            $apiCalls++;

            if (!$releases || !is_array($releases)) {
                $this->warn("No releases returned or API error on page {$page}");
                break;
            }

            if (empty($releases)) {
                $this->info("No more releases found");
                break;
            }

            $this->line("  Retrieved " . count($releases) . " releases");

            // Normalize and filter releases
            $normalized = $releaseSyncService->fetchReleases($oauthToken, $owner, $repoName, $since);
            // fetchReleases already does the API call; for paginated mode we use the raw response
            // Instead, normalize directly from the page response
            $normalized = $this->normalizeReleases($releases, $owner, $repoName, $since);

            $totalFetched += count($normalized);

            // Persist to releases table
            $upserted = $releaseSyncService->persistReleases($repo, $normalized);
            $totalUpserted += $upserted;

            // Check if we got fewer than per_page (last page)
            if (count($releases) < $perPage) {
                $this->info("Last page reached (got " . count($releases) . " < {$perPage})");
                break;
            }

            $page++;

            // Rate limiting - sleep briefly between API calls
            usleep(200000); // 0.2 seconds
        }

        $this->info("Sync complete!");
        $this->info("Total fetched: {$totalFetched}");
        $this->info("Total upserted: {$totalUpserted}");
        $this->info("API calls: {$apiCalls}");

        // Show current DB state
        $this->info("Current DB state for {$repo}:");
        $dbCount = \App\Models\Release::where('repo_name', $repo)->count();
        $this->info("  Total releases in DB: {$dbCount}");

        $latestRelease = \App\Models\Release::where('repo_name', $repo)
            ->whereNotNull('published_at')
            ->latest('published_at')
            ->first();
        if ($latestRelease) {
            $this->info("  Latest release: {$latestRelease->tag_name} at {$latestRelease->published_at}");
        }

        return 0;
    }

    /**
     * Normalize release data from GitHub API response — do NOT persist body/text
     */
    private function normalizeReleases($releases, $owner, $repoName, $since = null)
    {
        $normalized = [];

        foreach ($releases as $release) {
            $publishedAt = $release['published_at'] ?? $release['created_at'] ?? null;

            // Filter by since date if provided
            if ($since && $publishedAt && strtotime($publishedAt) < strtotime($since)) {
                continue;
            }

            $normalized[] = [
                'repo_name'     => "{$owner}/{$repoName}",
                'release_id'    => $release['id'] ?? null,
                'tag_name'      => $release['tag_name'] ?? '',
                'release_name'  => $release['name'] ?? null,
                'published_at'  => $publishedAt,
                'author_login'  => $release['author']['login'] ?? null,
                'metadata'      => [
                    'data_source'      => 'github_api_sync',
                    'draft'            => $release['draft'] ?? false,
                    'prerelease'       => $release['prerelease'] ?? false,
                    'target_commitish' => $release['target_commitish'] ?? null,
                    'url'              => $release['html_url'] ?? null,
                ],
            ];
        }

        return $normalized;
    }

    protected function getSyncOrganizationId(): ?int
    {
        $pilotOrg = $this->getPilotOrg();
        return $pilotOrg?->id;
    }

    /**
     * users.github_token is intentionally not consulted. Canonical authority is
     * the organization-scoped engineering_integration OAuth credential.
     */
    protected function getOAuthToken(): ?string
    {
        $organizationId = $this->getSyncOrganizationId();
        if (!$organizationId) {
            return null;
        }

        return $this->getOrgEngineeringToken($organizationId);
    }

    /**
     * The explicit --repo bound must be inside this org's authoritative
     * telemetry ∩ token-visible customer repository overlap.
     */
    protected function resolveAuthorizedSyncRepo(
        ?string $repo,
        ?string $oauthToken,
        ?array $oauthUser,
        ?int $organizationId
    ): ?string {
        if (!$repo || !$oauthToken || !$organizationId || !$this->isEngineeringEvidenceEligible($oauthUser)) {
            return null;
        }

        $allowList = $this->resolveCustomerRepoAllowList($oauthToken, $oauthUser, $organizationId);
        foreach ($allowList as $authorizedRepo) {
            if (strtolower($authorizedRepo) === strtolower($repo)) {
                return $authorizedRepo;
            }
        }

        return null;
    }

    protected function githubApiCall(string $oauthToken, string $endpoint): ?array
    {
        $response = (new GitHubApiService())->makeApiCall($oauthToken, $endpoint);
        return is_array($response) ? $response : null;
    }
}
