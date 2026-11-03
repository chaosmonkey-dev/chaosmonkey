<?php

namespace App\Services;

use App\Models\Deployment;
use Illuminate\Support\Facades\Log;
use DB;
use App\Traits\PilotAwareTokenHelper;

class DeploymentMetricsService
{
    use PilotAwareTokenHelper;
    private $githubApiService;

    public function __construct()
    {
        $this->githubApiService = new GitHubApiService();
    }

    /**
     * Fetch deployments for a repository using GitHub Deployments API
     */
    public function fetchDeployments($token, $owner, $repo, $days = 30)
    {
        $endpoint = "repos/{$owner}/{$repo}/deployments?per_page=100";
        $deployments = $this->githubApiService->makeApiCall($token, $endpoint);
        
        if (!$deployments || !is_array($deployments)) {
            Log::warning('No deployments found for repo', ['owner' => $owner, 'repo' => $repo]);
            return [];
        }
        
        // Filter by time window
        $cutoffDate = now()->subDays($days);
        $filteredDeployments = array_filter($deployments, function($deployment) use ($cutoffDate) {
            return isset($deployment['created_at']) && 
                   strtotime($deployment['created_at']) >= $cutoffDate->timestamp;
        });
        
        Log::info('Fetched deployments for repo', [
            'owner' => $owner, 
            'repo' => $repo, 
            'total' => count($deployments),
            'filtered' => count($filteredDeployments)
        ]);
        
        return array_values($filteredDeployments);
    }

    /**
     * Fetch deployment statuses for a specific deployment
     */
    public function fetchDeploymentStatuses($token, $owner, $repo, $deploymentId)
    {
        $endpoint = "repos/{$owner}/{$repo}/deployments/{$deploymentId}/statuses";
        $statuses = $this->githubApiService->makeApiCall($token, $endpoint);
        
        if (!$statuses || !is_array($statuses)) {
            Log::warning('No deployment statuses found', ['owner' => $owner, 'repo' => $repo, 'deployment_id' => $deploymentId]);
            return [];
        }
        
        return $statuses;
    }

    /**
     * Normalize deployment status from GitHub API
     */
    private function normalizeDeploymentStatus($githubStatus)
    {
        // Map GitHub deployment states to our normalized states
        $statusMap = [
            'success' => 'success',
            'failure' => 'failure',
            'error' => 'failure',
            'inactive' => 'failure',
            'in_progress' => 'in_progress',
            'queued' => 'queued',
            'pending' => 'queued',
            'waiting' => 'queued'
        ];
        
        $state = $githubStatus['state'] ?? 'unknown';
        return $statusMap[$state] ?? 'unknown';
    }

    /**
     * Update deployment metrics for a repository
     */
    public function updateDeploymentMetrics($owner, $repo, $deployments, $days = 30, ?string $oauthToken = null)
    {
        try {
            $updatedCount = 0;
            $repoFullName = "{$owner}/{$repo}";
            $statusToken = $oauthToken ?: $this->getOAuthToken();
            if (!$statusToken) {
                throw new \RuntimeException('No organization engineering_integration OAuth token available for deployment statuses');
            }
            
            foreach ($deployments as $deployment) {
                // Get deployment statuses to determine final status
                $statuses = $this->fetchDeploymentStatuses(
                    $statusToken,
                    $owner,
                    $repo,
                    $deployment['id']
                );
                
                // Use the latest status or default to the deployment state
                $latestStatus = !empty($statuses) ? $statuses[0] : null;
                $finalStatus = $latestStatus ? 
                    $this->normalizeDeploymentStatus($latestStatus) : 
                    $this->normalizeDeploymentStatus($deployment);
                
                // Determine deployed_at (use latest status created_at or deployment created_at)
                $deployedAt = null;
                if ($latestStatus && isset($latestStatus['created_at'])) {
                    $deployedAt = $latestStatus['created_at'];
                } elseif (isset($deployment['created_at'])) {
                    $deployedAt = $deployment['created_at'];
                }
                
                // Upsert deployment record
                $deploymentData = [
                    'repo_name' => $repoFullName,
                    'environment' => $deployment['environment'] ?? 'unknown',
                    'deployment_status' => $finalStatus,
                    'deployed_at' => $deployedAt ? date('Y-m-d H:i:s', strtotime($deployedAt)) : null,
                    'sha' => $deployment['sha'] ?? null,
                    'metadata' => [
                        'source' => 'github_api_sync',
                        'data_source' => 'github_api_sync',
                        'github_deployment_id' => $deployment['id'],
                        'description' => $deployment['description'] ?? null,
                        'ref' => $deployment['ref'] ?? null,
                        'task' => $deployment['task'] ?? null
                    ],
                    'updated_at' => now(),
                ];
                
                // Use deployment ID as unique identifier for upsert
                $existing = Deployment::where('repo_name', $repoFullName)
                    ->whereJsonContains('metadata->github_deployment_id', $deployment['id'])
                    ->first();
                
                if ($existing) {
                    $existing->update($deploymentData);
                } else {
                    $deploymentData['created_at'] = now();
                    Deployment::create($deploymentData);
                }
                
                $updatedCount++;
            }
            
            Log::info('Updated deployment metrics', [
                'repo' => $repoFullName,
                'deployments_updated' => $updatedCount
            ]);
            
            return $updatedCount;
            
        } catch (\Exception $e) {
            Log::error('Failed to update deployment metrics', [
                'repo' => "{$owner}/{$repo}",
                'error' => $e->getMessage()
            ]);
            return 0;
        }
    }

    /**
     * Get latest deployment for a repository
     */
    public function getLatestDeployment($repoName)
    {
        return Deployment::where('repo_name', $repoName)
            ->orderBy('deployed_at', 'desc')
            ->first();
    }

    /**
     * Get repositories that need deployment backfill
     */
    public function getReposNeedingDeploymentBackfill($days = 30, $limit = 200)
    {
        // Get unique repos from pull_requests table that have recent activity
        $repos = DB::table('pull_requests')
            ->select('repo_name')
            ->where('data_source', 'github_api_sync')
            ->where(function($query) use ($days) {
                $query->where('created_at', '>=', now()->subDays($days))
                      ->orWhere('updated_at', '>=', now()->subDays($days))
                      ->orWhere('merged_at', '>=', now()->subDays($days));
            })
            ->distinct()
            ->limit($limit)
            ->pluck('repo_name');
        
        // Filter out repos that already have recent deployment data
        $reposNeedingBackfill = [];
        foreach ($repos as $repo) {
            $hasRecentData = Deployment::where('repo_name', $repo)
                ->where('deployed_at', '>=', now()->subDays($days))
                ->exists();
            
            if (!$hasRecentData) {
                $reposNeedingBackfill[] = $repo;
            }
        }
        
        return $reposNeedingBackfill;
    }

    /**
     * Deployment status reads must use the same org engineering credential as
     * the deployment list fetch; support and identity-only tokens fail closed.
     */
    private function getOAuthToken(): ?string
    {
        $pilotOrg = $this->getPilotOrg();
        return $pilotOrg?->id ? $this->getOrgEngineeringToken($pilotOrg->id) : null;
    }
}
