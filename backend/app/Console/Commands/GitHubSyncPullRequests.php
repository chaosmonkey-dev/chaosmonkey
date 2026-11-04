<?php

namespace App\Console\Commands;

use App\Models\PullRequest;
use App\Services\GitHubApiService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;
use App\Traits\PilotAwareTokenHelper;
use App\Traits\SchemaCapable;

class GitHubSyncPullRequests extends Command
{
    use PilotAwareTokenHelper;
    use SchemaCapable;
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'github:sync-prs 
                            {--repo= : Full repo name (e.g., org/example-repo)}
                            {--state=all : PR state to fetch (all, open, closed)}
                            {--per_page=100 : Items per page (max 100)}
                            {--max_pages=10 : Maximum pages to fetch (0 for unlimited)}
                            {--since= : Only PRs updated since this date (YYYY-MM-DD)}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Sync pull requests from GitHub API to local database';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $repo = $this->option('repo');
        $state = $this->option('state');
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

        $this->info("Starting GitHub PR sync...");
        $this->info("Repo: {$repo}");
        $this->info("State: {$state}");
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
            return 1;
        }

        $this->info("OAuth token found: " . substr($oauthToken, 0, 10) . '...');
        $repoParts = explode('/', $repo);
        $owner = $repoParts[0];
        $repoName = $repoParts[1];

        $page = 1;
        $totalFetched = 0;
        $totalCreated = 0;
        $totalUpdated = 0;
        $totalSkipped = 0;
        $apiCalls = 0;

        $this->info("Fetching PRs from GitHub API...");

        while (true) {
            // Check max pages limit
            if ($maxPages > 0 && $page > $maxPages) {
                $this->info("Reached max pages limit ({$maxPages})");
                break;
            }

            $this->line("Fetching page {$page}...");

            // Build API URL
            $endpoint = "repos/{$owner}/{$repoName}/pulls?state={$state}&per_page={$perPage}&page={$page}&sort=created&direction=desc";
            if ($since) {
                $endpoint .= "&since={$since}";
            }

            // Fetch from GitHub API
            $prs = $this->githubApiCall($oauthToken, $endpoint);
            $apiCalls++;

            if (!$prs || !is_array($prs)) {
                $this->warn("No PRs returned or API error on page {$page}");
                break;
            }

            if (empty($prs)) {
                $this->info("No more PRs found");
                break;
            }

            $this->line("  Retrieved " . count($prs) . " PRs");

            // Process each PR
            foreach ($prs as $pr) {
                $totalFetched++;

                $prNumber = $pr['number'] ?? null;
                if (!$prNumber) {
                    $this->warn("  PR missing number, skipping");
                    $totalSkipped++;
                    continue;
                }

                // Check if PR already exists
                $existingPR = PullRequest::where('repo_name', $repo)
                    ->where('pr_number', $prNumber)
                    ->first();

                if ($existingPR) {
                    // Update existing PR
                    $updated = $this->updatePRFromGitHub($existingPR, $pr);
                    if ($updated) {
                        $totalUpdated++;
                        $this->line("  Updated PR #{$prNumber}");
                    } else {
                        $totalSkipped++;
                        $this->line("  PR #{$prNumber} unchanged, skipping");
                    }
                } else {
                    // Create new PR
                    $this->createPRFromGitHub($repo, $pr);
                    $totalCreated++;
                    $this->line("  Created PR #{$prNumber}");
                }
            }

            // Check if we got fewer than per_page (last page)
            if (count($prs) < $perPage) {
                $this->info("Last page reached (got " . count($prs) . " < {$perPage})");
                break;
            }

            $page++;

            // Rate limiting - sleep briefly between API calls
            usleep(200000); // 0.2 seconds
        }

        $this->info("Sync complete!");
        $this->info("Total fetched: {$totalFetched}");
        $this->info("Total created: {$totalCreated}");
        $this->info("Total updated: {$totalUpdated}");
        $this->info("Total skipped: {$totalSkipped}");
        $this->info("API calls: {$apiCalls}");

        // Show current DB state
        $this->info("Current DB state for {$repo}:");
        $dbCount = PullRequest::where('repo_name', $repo)->count();
        $this->info("  Total PRs in DB: {$dbCount}");

        $latestPR = PullRequest::where('repo_name', $repo)->latest('created_at')->first();
        if ($latestPR) {
            $this->info("  Latest PR: #{$latestPR->pr_number} at {$latestPR->created_at}");
        }

        return 0;
    }

    /**
     * Create a new PR from GitHub API data
     */
    private function createPRFromGitHub($repoName, $pr)
    {
        $prData = [
            'repo_name' => $repoName,
            'pr_number' => $pr['number'],
            'developer_id' => $this->getDeveloperId($pr),
            'merged_at' => isset($pr['merged_at']) ? Carbon::parse($pr['merged_at']) : null,
            'comments_count' => $pr['comments'] ?? 0,
            'review_count' => $this->calculateReviewCount($pr),
            'cursor_usage_detected' => false, // Not available from PR list endpoint
            'created_at' => Carbon::parse($pr['created_at']),
            'updated_at' => Carbon::parse($pr['updated_at']),
        ];

        // CR-X 5A: Only set optional enrichment columns if the schema supports them.
        if ($this->prHasReviewColumns()) {
            $prData['first_review_at'] = null; // Requires separate API call
            $prData['unique_reviewer_count'] = 0; // Requires separate API call
        }
        if ($this->prHasReopenColumn()) {
            $prData['pr_reopened_count'] = 0; // Requires events API
        }

        // Add GitHub-specific fields if the schema supports them and the API provides them
        if ($this->prHasSizeColumns()) {
            if (isset($pr['additions'])) {
                $prData['additions'] = $pr['additions'];
            }
            if (isset($pr['deletions'])) {
                $prData['deletions'] = $pr['deletions'];
            }
        }
        if (isset($pr['changed_files'])) {
            $prData['changed_files'] = $pr['changed_files'];
        }
        if (isset($pr['review_comments'])) {
            $prData['review_comments'] = $pr['review_comments'];
        }
        if (isset($pr['user']['login'])) {
            $prData['user_login'] = $pr['user']['login'];
        }
        $prData['data_source'] = 'github_api_sync';

        PullRequest::create($prData);
    }

    /**
     * Update an existing PR from GitHub API data
     */
    private function updatePRFromGitHub($existingPR, $pr)
    {
        $updated = false;

        // Update merge status
        $newMergedAt = isset($pr['merged_at']) ? Carbon::parse($pr['merged_at']) : null;
        if ($existingPR->merged_at != $newMergedAt) {
            $existingPR->merged_at = $newMergedAt;
            $updated = true;
        }

        // Update comments
        if ($existingPR->comments_count != ($pr['comments'] ?? 0)) {
            $existingPR->comments_count = $pr['comments'] ?? 0;
            $updated = true;
        }

        // Update review comments
        if (isset($pr['review_comments']) && $existingPR->review_comments != $pr['review_comments']) {
            $existingPR->review_comments = $pr['review_comments'];
            $updated = true;
        }

        // Update additions/deletions/changed_files if available and the schema supports them
        if ($this->prHasSizeColumns()) {
            if (isset($pr['additions']) && $existingPR->additions != $pr['additions']) {
                $existingPR->additions = $pr['additions'];
                $updated = true;
            }
            if (isset($pr['deletions']) && $existingPR->deletions != $pr['deletions']) {
                $existingPR->deletions = $pr['deletions'];
                $updated = true;
            }
        }
        if (isset($pr['changed_files']) && $existingPR->changed_files != $pr['changed_files']) {
            $existingPR->changed_files = $pr['changed_files'];
            $updated = true;
        }

        // Update updated_at
        $existingPR->updated_at = Carbon::parse($pr['updated_at']);
        $updated = true;

        if ($updated) {
            $existingPR->save();
        }

        return $updated;
    }

    /**
     * Get developer_id from PR data
     * This is a placeholder - in a real system you'd map GitHub users to developer_ids
     */
    private function getDeveloperId($pr)
    {
        // For now, use a default developer_id
        // In production, you'd map GitHub login to your developer table
        return 1;
    }

    /**
     * Calculate review count from PR data
     * This is a rough estimate - for accurate counts you'd need the reviews API
     */
    private function calculateReviewCount($pr)
    {
        // Use review_comments as a proxy for review count
        // For accurate counts, run: php artisan github:backfill-pr-review-metrics
        return $pr['review_comments'] ?? 0;
    }

    protected function getSyncOrganizationId(): ?int
    {
        $pilotOrg = $this->getPilotOrg();
        return $pilotOrg?->id;
    }

    /**
     * Resolve the only credential allowed to produce customer GitHub evidence.
     * users.github_token is intentionally not consulted: it does not exist in
     * canonical pilot schemas and would bypass purpose/org isolation if it did.
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
     * Explicit --repo is a bound, not a license to sync arbitrary public repos.
     * The requested repo must appear in the authoritative telemetry ∩ GitHub
     * access overlap for the organization.
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
