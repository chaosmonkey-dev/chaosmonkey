<?php

namespace App\Console\Commands;

use App\Services\DeploymentMetricsService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use App\Traits\PilotAwareTokenHelper;

class GitHubBackfillDeployments extends Command
{
    use PilotAwareTokenHelper;
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'github:backfill-deployments {--days=30 : Number of days to look back} {--limit=200 : Maximum repositories to process} {--repo=* : Limit backfill to specific owner/repo repositories}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Backfill deployment metrics from GitHub Deployments API';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $days = (int) $this->option('days');
        $limit = (int) $this->option('limit');
        
        $this->info("Starting deployment metrics backfill...");
        $this->info("Days: {$days}, Limit: {$limit}");
        
        $organizationId = $this->getSyncOrganizationId();
        $oauthToken = $organizationId ? $this->getOAuthToken() : null;
        if (!$organizationId || !$oauthToken) {
            $this->error('No organization engineering_integration OAuth token found. Please reconnect GitHub Engineering Data first.');
            return 1;
        }

        $oauthUser = $this->getOrgEngineeringUser($organizationId);
        $repoAllowList = $this->resolveCustomerRepoAllowList($oauthToken, $oauthUser, $organizationId);
        if (empty($repoAllowList)) {
            $this->error('No customer repository authority found for this organization.');
            return 1;
        }

        $service = $this->newDeploymentMetricsService();
        $allowByLower = [];
        foreach ($repoAllowList as $allowedRepo) {
            $allowByLower[strtolower($allowedRepo)] = $allowedRepo;
        }

        $repos = [];
        foreach ($service->getReposNeedingDeploymentBackfill($days, $limit) as $candidateRepo) {
            $canonicalRepo = $allowByLower[strtolower($candidateRepo)] ?? null;
            if ($canonicalRepo) {
                $repos[] = $canonicalRepo;
            }
        }

        $requestedRepos = array_map('strtolower', (array) $this->option('repo'));
        if (!empty($requestedRepos)) {
            $unauthorized = array_diff($requestedRepos, array_map('strtolower', $repoAllowList));
            if (!empty($unauthorized)) {
                $this->error('Unauthorized repo for deployment backfill: ' . implode(', ', $unauthorized));
                return 1;
            }
            $requestedCanonical = [];
            foreach ($requestedRepos as $requestedRepo) {
                $requestedCanonical[] = $allowByLower[$requestedRepo];
            }
            $repos = array_values(array_intersect($repos, $requestedCanonical));
        }

        $this->info("Found " . count($repos) . " authorized repositories needing deployment backfill");
        
        if (empty($repos)) {
            $this->info("All authorized repositories have recent deployment data. No backfill needed.");
            return 0;
        }
        
        $processed = 0;
        $updated = 0;
        $errors = 0;
        $apiCalls = 0;
        
        foreach ($repos as $repoName) {
            $processed++;
            
            // Parse repo name
            $repoParts = explode('/', $repoName);
            if (count($repoParts) !== 2) {
                $this->warn("Invalid repo format: {$repoName}");
                $errors++;
                continue;
            }
            
            $owner = $repoParts[0];
            $repo = $repoParts[1];
            
            $this->line("Processing deployments for {$owner}/{$repo}...");
            
            try {
                // Fetch deployments from GitHub API
                $deployments = $service->fetchDeployments($oauthToken, $owner, $repo, $days);
                $apiCalls++;
                
                if (empty($deployments)) {
                    $this->line("  No deployments found");
                    continue;
                }
                
                // Update deployment metrics
                $updatedCount = $service->updateDeploymentMetrics($owner, $repo, $deployments, $days, $oauthToken);
                if ($updatedCount > 0) {
                    $updated += $updatedCount;
                    $this->line("  Updated {$updatedCount} deployments");
                } else {
                    $this->warn("  Failed to update deployment metrics");
                    $errors++;
                }
                
                // Rate limiting - sleep briefly between API calls
                usleep(100000); // 0.1 seconds
                
            } catch (\Exception $e) {
                $this->error("  Error: " . $e->getMessage());
                $errors++;
                Log::error('Deployment backfill error', [
                    'repo' => $repoName,
                    'error' => $e->getMessage()
                ]);
            }
            
            // Progress indicator
            if ($processed % 10 === 0) {
                $this->info("Processed {$processed}/" . count($repos) . " repositories...");
            }
        }
        
        $this->info("Backfill complete!");
        $this->info("Processed repositories: {$processed}");
        $this->info("Updated deployments: {$updated}");
        $this->info("Errors: {$errors}");
        $this->info("API calls: {$apiCalls}");
        
        return $errors > 0 ? 1 : 0;
    }
    
    protected function getSyncOrganizationId(): ?int
    {
        $pilotOrg = $this->getPilotOrg();
        return $pilotOrg?->id;
    }

    /**
     * Deployment backfill may only use the org's engineering_integration
     * credential. Support and identity-only credentials fail closed.
     */
    protected function getOAuthToken(): ?string
    {
        $organizationId = $this->getSyncOrganizationId();
        if (!$organizationId) {
            return null;
        }

        return $this->getOrgEngineeringToken($organizationId);
    }

    protected function newDeploymentMetricsService(): DeploymentMetricsService
    {
        return new DeploymentMetricsService();
    }
}
