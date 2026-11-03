<?php

namespace App\Console\Commands;

use App\Services\PRReviewMetricsService;
use App\Http\Controllers\PullRequestController;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use App\Traits\PilotAwareTokenHelper;
use App\Traits\SchemaCapable;

class GitHubBackfillPRReviewMetrics extends Command
{
    use PilotAwareTokenHelper;
    use SchemaCapable;
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'github:backfill-pr-review-metrics {--days=30 : Number of days to look back} {--limit=200 : Maximum PRs to process}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Backfill PR review metrics from GitHub API';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $days = (int) $this->option('days');
        $limit = (int) $this->option('limit');

        // CR-X 5A: Fail closed with a clear capability-unavailable message
        // if the schema does not support review-metric enrichment.
        if (!$this->prHasReviewColumns()) {
            $this->warn('Schema does not support PR review-metric columns (first_review_at, unique_reviewer_count).');
            $this->warn('Run the additive migration for these columns before using this backfill.');
            return 0;
        }

        $this->info("Starting PR review metrics backfill...");
        $this->info("Days: {$days}, Limit: {$limit}");
        
        // Get OAuth token
        $oauthToken = $this->getOAuthToken();
        if (!$oauthToken) {
            $this->error('No OAuth token found. Please connect GitHub first.');
            return 1;
        }
        
        $service = new PRReviewMetricsService();
        $prController = new PullRequestController();
        
        // Get PRs needing review metrics
        $prs = $service->getPRsNeedingReviewMetrics($days, $limit);
        $this->info("Found {$prs->count()} PRs needing review metrics");
        
        $processed = 0;
        $updated = 0;
        $errors = 0;
        
        foreach ($prs as $pr) {
            $processed++;
            
            // Parse repo name
            $repoParts = explode('/', $pr->repo_name);
            if (count($repoParts) !== 2) {
                $this->warn("Invalid repo format: {$pr->repo_name}");
                $errors++;
                continue;
            }
            
            $owner = $repoParts[0];
            $repo = $repoParts[1];
            
            $this->line("Processing PR #{$pr->pr_number} in {$owner}/{$repo}...");
            
            try {
                // Fetch reviews from GitHub API
                $reviews = $prController->fetchPRReviews($oauthToken, $owner, $repo, $pr->pr_number);
                
                if (empty($reviews)) {
                    $this->line("  No reviews found");
                    // Still update with zeros
                    $service->updatePRReviewMetrics($owner, $repo, $pr->pr_number, []);
                } else {
                    // Update metrics
                    if ($service->updatePRReviewMetrics($owner, $repo, $pr->pr_number, $reviews)) {
                        $updated++;
                        $this->line("  Updated metrics: " . count($reviews) . " reviews");
                    } else {
                        $this->warn("  Failed to update PR record");
                        $errors++;
                    }
                }
                
                // Rate limiting - sleep briefly between API calls
                usleep(100000); // 0.1 seconds
                
            } catch (\Exception $e) {
                $this->error("  Error: " . $e->getMessage());
                $errors++;
                Log::error('PR review backfill error', [
                    'repo' => $pr->repo_name,
                    'pr_number' => $pr->pr_number,
                    'error' => $e->getMessage()
                ]);
            }
            
            // Progress indicator
            if ($processed % 10 === 0) {
                $this->info("Processed {$processed}/{$prs->count()} PRs...");
            }
        }
        
        $this->info("Backfill complete!");
        $this->info("Processed: {$processed}");
        $this->info("Updated: {$updated}");
        $this->info("Errors: {$errors}");
        
        return $errors > 0 ? 1 : 0;
    }
    
    /**
     * Get OAuth token from database
     *
     * CR-X P0: Uses org-scoped engineering_integration token authority,
     * not the latest token by updated_at (which may be identity_only).
     */
    private function getOAuthToken()
    {
        $pilotSlug = $this->pilotOrgSlug();
        if ($pilotSlug) {
            $pilotOrg = \DB::table('organizations')->where('slug', $pilotSlug)->first();
            if ($pilotOrg) {
                $token = $this->getOrgEngineeringToken($pilotOrg->id);
                if ($token) {
                    return $token;
                }
                $this->warn('No engineering_integration token found for pilot org; refusing to use identity_only token for evidence backfill.');
                return null;
            }
        }

        // Dev mode: fall back to safe token retrieval
        return $this->getMetricsSafeOAuthToken();
    }
}
