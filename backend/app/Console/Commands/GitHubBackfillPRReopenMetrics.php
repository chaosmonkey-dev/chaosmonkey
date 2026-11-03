<?php

namespace App\Console\Commands;

use App\Services\PRReopenMetricsService;
use App\Http\Controllers\PullRequestController;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use App\Traits\PilotAwareTokenHelper;
use App\Traits\SchemaCapable;

class GitHubBackfillPRReopenMetrics extends Command
{
    use PilotAwareTokenHelper;
    use SchemaCapable;
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'github:backfill-pr-reopen-metrics {--days=30 : Number of days to look back} {--limit=200 : Maximum PRs to process}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Backfill PR reopen metrics from GitHub API';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $days = (int) $this->option('days');
        $limit = (int) $this->option('limit');

        // CR-X 5A: Fail closed with a clear capability-unavailable message
        // if the schema does not support reopen-metric enrichment.
        if (!$this->prHasReopenColumn()) {
            $this->warn('Schema does not support PR reopen-metric column (pr_reopened_count).');
            $this->warn('Run the additive migration for this column before using this backfill.');
            return 0;
        }

        $this->info("Starting PR reopen metrics backfill...");
        $this->info("Days: {$days}, Limit: {$limit}");
        
        // Get OAuth token
        $oauthToken = $this->getOAuthToken();
        if (!$oauthToken) {
            $this->error('No OAuth token found. Please connect GitHub first.');
            return 1;
        }
        
        $service = new PRReopenMetricsService();
        $prController = new PullRequestController();
        
        // Get PRs needing reopen metrics
        $prs = $service->getPRsNeedingReopenMetrics($days, $limit);
        $this->info("Found {$prs->count()} PRs needing reopen metrics");
        
        $processed = 0;
        $updated = 0;
        $errors = 0;
        $apiCalls = 0;
        
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
                // Fetch issue events from GitHub API
                $events = $prController->fetchPRIssueEvents($oauthToken, $owner, $repo, $pr->pr_number);
                $apiCalls++;
                
                if (empty($events)) {
                    $this->line("  No events found");
                    // Still update with zero
                    $service->updatePRReopenMetrics($owner, $repo, $pr->pr_number, []);
                } else {
                    // Update metrics
                    if ($service->updatePRReopenMetrics($owner, $repo, $pr->pr_number, $events)) {
                        $updated++;
                        $reopenCount = count(array_filter($events, function($event) {
                            return isset($event['event']) && $event['event'] === 'reopened';
                        }));
                        $this->line("  Updated metrics: {$reopenCount} reopens");
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
                Log::error('PR reopen backfill error', [
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
        $this->info("API calls: {$apiCalls}");
        
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
