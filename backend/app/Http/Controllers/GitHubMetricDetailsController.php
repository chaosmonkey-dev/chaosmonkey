<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use App\Services\GitHubApiService;
use App\Traits\PilotAwareTokenHelper;

/**
 * Generic GitHub Metric Details Controller
 * 
 * Provides detailed records for GitHub metric cards drilldown
 * Endpoint: GET /api/github/metric-details?metric=<metric_key>&time_filter=<range>&limit=100
 */
class GitHubMetricDetailsController extends Controller
{
    use PilotAwareTokenHelper;
    private $gitHubService;

    public function __construct(GitHubApiService $gitHubService)
    {
        $this->gitHubService = $gitHubService;
    }

    /**
     * Fast repositories endpoint for drilldown (bypasses heavy metrics processing)
     */
    public function getRepositoriesSimple(Request $request)
    {
        try {
            // CR-X 2C: Org-level engineering integration token selection.
            $actingUser = $request->get('authenticated_user') ?? \Illuminate\Support\Facades\Auth::user();
            $orgId = $actingUser?->organization_id;

            $token = $this->getOrgEngineeringToken($orgId);
            $oauthUser = $this->getOrgEngineeringUser($orgId);

            // Dev mode fallback: session-based token (not used in pilot mode)
            if (!$token && !$this->isPilotMode()) {
                $token = session('github_oauth_token');
                $oauthUser = session('github_user_data');
            }

            // EVIDENCE GATE (R3 fail-closed): ONLY explicit engineering_integration
            // tokens may supply repository evidence.  All other purposes fail closed.
            if (!$this->isEngineeringEvidenceEligible($oauthUser)) {
                return response()->json([
                    'repositories' => [],
                    'total_count' => 0,
                    'reason' => 'not_engineering_integration_token'
                ]);
            }

            // P0 SUPPORT-TOKEN GUARD: In pilot mode, reject support login tokens
            // that may have slipped through getMetricsSafeOAuthToken()
            if ($this->isPilotMode() && $token) {
                $guardToken = \DB::table('oauth_tokens')->where('access_token', $token)->first();
                if ($guardToken) {
                    $guardUser = json_decode($guardToken->user_data ?? '{}', true);
                    if ($this->isSupportLogin($guardUser['login'] ?? null)) {
                        Log::warning('[P0_SUPPORT_TOKEN_GUARD] GitHubMetricDetails (repos): rejecting support login token', [
                            'login' => $guardUser['login'] ?? null,
                        ]);
                        $token = null;
                    }
                }
            }

            // Development mode bypass — local environment only (CR-X Pass 8)
            $isDevMode = app()->environment('local') && $request->get('dev_mode', false);

            if (!$token && !$isDevMode) {
                return response()->json([
                    'repositories' => [],
                    'total_count' => 0,
                    'reason' => $this->isPilotMode() ? 'no_safe_customer_token' : 'not_authenticated'
                ], 401);
            }

            // Get repositories directly from GitHub API
            if ($token && false) { // Disabled for now - use static data
                // TODO: Implement getUserRepositories method in GitHubApiService
                $repos = [];
            } else {
                // In pilot mode with no safe token, return empty
                if ($this->isPilotMode() && !$token) {
                    return response()->json([
                        'repositories' => [],
                        'total_count' => 0,
                        'reason' => 'no_safe_customer_token'
                    ]);
                }
                // Dev mode: return empty repos (no static Matt repo names)
                $repos = [];
            }
            
            return response()->json([
                'repositories' => $repos,
                'total_count' => count($repos),
                'reason' => null
            ]);
            
        } catch (\Exception $e) {
            Log::error('Error in getRepositoriesSimple', ['error' => $e->getMessage()]);
            return response()->json([
                'repositories' => [],
                'total_count' => 0,
                'reason' => 'api_error'
            ], 500);
        }
    }

    /**
     * Get detailed records for a specific GitHub metric
     */
    public function getMetricDetails(Request $request)
    {
        $metric = $request->get('metric');
        $timeFilter = $request->get('time_filter', 'all');
        $limit = min($request->get('limit', 100), 200); // Max 200 records

        Log::info('GitHub metric details request', [
            'metric' => $metric,
            'time_filter' => $timeFilter,
            'limit' => $limit
        ]);

        // Validate metric key
        $supportedMetrics = [
            'total_prs', 'total_commits', 'merge_rate', 'total_repositories',
            'review_count', 'unique_reviewers', 'pr_reopens', 'rejected_prs',
            'latest_deployment', 'failed_deployments', 'success_deployments', 'deployment_status',
            'deployment_environment', 'rollback_detected', 'commits_per_day',
            'first_review_at', 'time_to_merge', 'pr_review_cycles'
        ];

        if (!in_array($metric, $supportedMetrics)) {
            return response()->json([
                'metric' => $metric,
                'total_count' => 0,
                'showing_count' => 0,
                'records' => [],
                'reason' => 'unsupported_metric'
            ], 400);
        }

        // CR-X 2C: Org-level engineering integration token selection.
        $actingUser = $request->get('authenticated_user') ?? \Illuminate\Support\Facades\Auth::user();
        $orgId = $actingUser?->organization_id;

        $token = $this->getOrgEngineeringToken($orgId);
        $oauthUser = $this->getOrgEngineeringUser($orgId);

        // Dev mode fallback: session-based token (not used in pilot mode)
        if (!$token && !$this->isPilotMode()) {
            $token = session('github_oauth_token');
            $oauthUser = session('github_user_data');
        }

        // EVIDENCE GATE (R3 fail-closed): ONLY explicit engineering_integration
        // tokens may supply GitHub metric detail evidence.  All other purposes fail closed.
        if (!$this->isEngineeringEvidenceEligible($oauthUser)) {
            return response()->json([
                'metric' => $metric,
                'total_count' => 0,
                'showing_count' => 0,
                'records' => [],
                'reason' => 'not_engineering_integration_token'
            ]);
        }

        // P0 SUPPORT-TOKEN GUARD: In pilot mode, reject support login tokens
        // that may have slipped through getMetricsSafeOAuthToken()
        if ($this->isPilotMode() && $token) {
            $guardToken = \DB::table('oauth_tokens')->where('access_token', $token)->first();
            if ($guardToken) {
                $guardUser = json_decode($guardToken->user_data ?? '{}', true);
                if ($this->isSupportLogin($guardUser['login'] ?? null)) {
                    Log::warning('[P0_SUPPORT_TOKEN_GUARD] GitHubMetricDetails (metric): rejecting support login token', [
                        'login' => $guardUser['login'] ?? null,
                    ]);
                    $token = null;
                }
            }
        }

        // Development mode bypass - allow testing without OAuth.
        // CR-X Pass 8: Restricted to non-production environments only.
        // Previously allowed dev_mode in production, which could bypass
        // OAuth authentication in a live deployment.
        $isDevMode = app()->environment('local') && $request->get('dev_mode', false);
        
        if (!$token && !$isDevMode) {
            return response()->json([
                'metric' => $metric,
                'total_count' => 0,
                'showing_count' => 0,
                'records' => [],
                'reason' => $this->isPilotMode() ? 'no_safe_customer_token' : 'not_authenticated'
            ], 401);
        }

        // Route to appropriate method based on metric
        try {
            $result = $this->fetchMetricDetails($metric, $token, $timeFilter, $limit);
            
            return response()->json([
                'metric' => $metric,
                'total_count' => $result['total_count'] ?? 0,
                'showing_count' => count($result['records'] ?? []),
                'records' => $result['records'] ?? [],
                'reason' => $result['reason'] ?? null
            ]);
            
        } catch (\Exception $e) {
            Log::error('Error fetching GitHub metric details', [
                'metric' => $metric,
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'metric' => $metric,
                'total_count' => 0,
                'showing_count' => 0,
                'records' => [],
                'reason' => 'api_error'
            ], 500);
        }
    }

    /**
     * Route metric to appropriate fetch method
     */
    private function fetchMetricDetails($metric, $token, $timeFilter, $limit)
    {
        switch ($metric) {
            case 'total_prs':
                return $this->fetchPullRequests($token, $timeFilter, $limit);
                
            case 'pr_reopens':
                return $this->fetchReopenedPullRequests($token, $timeFilter, $limit);
                
            case 'failed_deployments':
                return $this->fetchFailedDeployments($token, $timeFilter, $limit);
                
            case 'success_deployments':
                return $this->fetchSuccessDeployments($token, $timeFilter, $limit);
                
            case 'total_commits':
                return $this->fetchCommits($token, $timeFilter, $limit);
                
            case 'total_repositories':
                return $this->fetchRepositories($token, $timeFilter, $limit);
                
            case 'merge_rate':
                return $this->fetchMergeRate($token, $timeFilter, $limit);
                
            case 'review_count':
                return $this->fetchReviewCount($token, $timeFilter, $limit);
                
            case 'unique_reviewers':
                return $this->fetchUniqueReviewers($token, $timeFilter, $limit);
                
            case 'rejected_prs':
                return $this->fetchRejectedPRs($token, $timeFilter, $limit);
                
            case 'commits_per_day':
                return $this->fetchCommitsPerDay($token, $timeFilter, $limit);
                
            case 'first_review_at':
                return $this->fetchFirstReviewAt($token, $timeFilter, $limit);
                
            case 'time_to_merge':
                return $this->fetchTimeToMerge($token, $timeFilter, $limit);
                
            case 'pr_review_cycles':
                return $this->fetchPRReviewCycles($token, $timeFilter, $limit);
                
            // Stub implementations for other metrics
            case 'latest_deployment':
            case 'deployment_status':
            case 'deployment_environment':
            case 'rollback_detected':
                return [
                    'total_count' => 0,
                    'records' => [],
                    'reason' => 'insufficient_data'
                ];
                
            default:
                return [
                    'total_count' => 0,
                    'records' => [],
                    'reason' => 'unsupported_metric'
                ];
        }
    }

    /**
     * Fetch pull requests with basic fields
     */
    private function fetchPullRequests($token, $timeFilter, $limit)
    {
        $pullRequestController = new PullRequestController($this->gitHubService);
        
        try {
            // Read directly from metrics response (no new GitHub calls)
            $metricsResponse = $pullRequestController->metrics(new \Illuminate\Http\Request());
            $data = $metricsResponse->getData();
            
            $allPRs = $data->all_prs_truncated ?? [];
            $totalCount = $data->all_prs_total ?? 0;
            
            if (empty($allPRs)) {
                return [
                    'total_count' => $totalCount,
                    'records' => [],
                    'reason' => 'details_not_available'
                ];
            }
            
            // Map real PR data to drilldown format
            $prRecords = array_map(function($pr) {
                // Handle both array and object formats
                $prArray = is_object($pr) ? (array) $pr : $pr;
                
                // Handle nested objects
                $userArray = is_object($prArray['user'] ?? null) ? (array) $prArray['user'] : ($prArray['user'] ?? []);
                $baseArray = is_object($prArray['base'] ?? null) ? (array) $prArray['base'] : ($prArray['base'] ?? []);
                $baseRepoArray = is_object($baseArray['repo'] ?? null) ? (array) $baseArray['repo'] : ($baseArray['repo'] ?? []);
                
                return [
                    'id' => $prArray['id'] ?? $prArray['number'] ?? null,
                    'number' => $prArray['number'] ?? null,
                    'title' => $prArray['title'] ?? '',
                    'author' => $userArray['login'] ?? $prArray['author'] ?? '',
                    'created_at' => $prArray['created_at'] ?? '',
                    'updated_at' => $prArray['updated_at'] ?? '',
                    'state' => $prArray['state'] ?? '',
                    'additions' => $prArray['additions'] ?? 0,
                    'deletions' => $prArray['deletions'] ?? 0,
                    'changed_files' => $prArray['changed_files'] ?? 0,
                    'url' => $prArray['html_url'] ?? '',
                    'repository' => $baseRepoArray['full_name'] ?? $prArray['repo'] ?? ''
                ];
            }, array_slice($allPRs, 0, $limit));
            
            return [
                'total_count' => $totalCount,
                'records' => $prRecords,
                'reason' => null
            ];
            
        } catch (\Exception $e) {
            Log::error('Failed to fetch PR data from metrics for drilldown', [
                'error' => $e->getMessage(),
                'time_filter' => $timeFilter,
                'limit' => $limit
            ]);
            
            return [
                'total_count' => 0,
                'records' => [],
                'reason' => 'api_error'
            ];
        }
    }

    /**
     * Fetch reopened pull requests
     */
    private function fetchReopenedPullRequests($token, $timeFilter, $limit)
    {
        $pullRequestController = new PullRequestController($this->gitHubService);
        
        try {
            // Get existing metrics data that contains all_prs_truncated
            $metricsResponse = $pullRequestController->metrics(new \Illuminate\Http\Request());
            $allPRs = $metricsResponse->getData()->all_prs_truncated ?? [];
            
            if (empty($allPRs)) {
                Log::warning('No PR data available in all_prs_truncated for reopened PRs drilldown', [
                    'time_filter' => $timeFilter,
                    'limit' => $limit
                ]);
                
                return [
                    'total_count' => 0,
                    'records' => [],
                    'reason' => 'insufficient_data'
                ];
            }
            
            // Filter for PRs that have been reopened (based on available fields)
            // Since we don't have explicit reopen events in all_prs_truncated, 
            // we'll return PRs that show signs of being reopened (multiple state changes)
            $reopenedPRs = array_filter($allPRs, function($pr) {
                $prArray = is_object($pr) ? (array) $pr : $pr;
                
                // For now, include PRs that have been updated after being created
                // This is a heuristic - in a real implementation, we'd use GitHub Events API
                $createdAt = $prArray['created_at'] ?? '';
                $updatedAt = $prArray['updated_at'] ?? '';
                
                if ($createdAt && $updatedAt) {
                    $created = new \DateTime($createdAt);
                    $updated = new \DateTime($updatedAt);
                    $interval = $created->diff($updated);
                    
                    // If updated more than 1 hour after creation, likely reopened
                    return $interval->h > 1 || $interval->d > 0;
                }
                
                return false;
            });
            
            // Map to drilldown format
            $reopenedPRRecords = array_map(function($pr) {
                $prArray = is_object($pr) ? (array) $pr : $pr;
                
                // Handle nested objects
                $userArray = is_object($prArray['user'] ?? null) ? (array) $prArray['user'] : ($prArray['user'] ?? []);
                $baseArray = is_object($prArray['base'] ?? null) ? (array) $prArray['base'] : ($prArray['base'] ?? []);
                $baseRepoArray = is_object($baseArray['repo'] ?? null) ? (array) $baseArray['repo'] : ($baseArray['repo'] ?? []);
                
                return [
                    'id' => $prArray['id'] ?? $prArray['number'] ?? null,
                    'number' => $prArray['number'] ?? null,
                    'title' => $prArray['title'] ?? '',
                    'author' => $userArray['login'] ?? $prArray['author'] ?? '',
                    'created_at' => $prArray['created_at'] ?? '',
                    'updated_at' => $prArray['updated_at'] ?? '',
                    'state' => $prArray['state'] ?? '',
                    'reopened_count' => 1, // Since we can't track actual reopens, mark as 1
                    'last_reopened_at' => $prArray['updated_at'] ?? '',
                    'url' => $prArray['html_url'] ?? '',
                    'repository' => $baseRepoArray['full_name'] ?? $prArray['repo'] ?? ''
                ];
            }, array_slice($reopenedPRs, 0, $limit));
            
            return [
                'total_count' => count($reopenedPRs),
                'records' => $reopenedPRRecords,
                'reason' => null
            ];
            
        } catch (\Exception $e) {
            Log::error('Failed to fetch reopened PR data from metrics for drilldown', [
                'error' => $e->getMessage(),
                'time_filter' => $timeFilter,
                'limit' => $limit
            ]);
            
            return [
                'total_count' => 0,
                'records' => [],
                'reason' => 'api_error'
            ];
        }
    }

    /**
     * Fetch commits with basic fields
     */
    private function fetchCommits($token, $timeFilter, $limit)
    {
        $pullRequestController = new PullRequestController($this->gitHubService);
        
        try {
            // Get existing metrics data that contains all_commits_truncated
            $metricsResponse = $pullRequestController->metrics(new \Illuminate\Http\Request());
            $allCommits = $metricsResponse->getData()->all_commits_truncated ?? [];
            
            if (empty($allCommits)) {
                Log::warning('No commit data available in all_commits_truncated for drilldown', [
                    'time_filter' => $timeFilter,
                    'limit' => $limit
                ]);
                
                return [
                    'total_count' => 0,
                    'records' => [],
                    'reason' => 'insufficient_data'
                ];
            }
            
            // Map commit data to drilldown format
            $commitRecords = array_map(function($commit) {
                // Handle both array and object formats
                $commitArray = is_object($commit) ? (array) $commit : $commit;
                return [
                    'id' => $commitArray['sha'] ?? '',
                    'sha' => $commitArray['sha'] ?? '',
                    'message' => $commitArray['message'] ?? '',
                    'author' => $commitArray['author_login'] ?? $commitArray['author_name'] ?? '',
                    'created_at' => $commitArray['date'] ?? $commitArray['created_at'] ?? '',
                    'url' => ($commitArray['repo'] ?? null) ? 'https://github.com/' . $commitArray['repo'] . '/commit/' . ($commitArray['sha'] ?? '') : '',
                    'repository' => $commitArray['repo'] ?? ''
                ];
            }, array_slice($allCommits, 0, $limit));
            
            return [
                'total_count' => count($allCommits),
                'records' => $commitRecords,
                'reason' => null
            ];
            
        } catch (\Exception $e) {
            Log::error('Failed to fetch commit data from metrics for drilldown', [
                'error' => $e->getMessage(),
                'time_filter' => $timeFilter,
                'limit' => $limit
            ]);
            
            return [
                'total_count' => 0,
                'records' => [],
                'reason' => 'api_error'
            ];
        }
    }

    /**
     * Fetch repositories with basic fields
     */
    private function fetchRepositories($token, $timeFilter, $limit)
    {
        $pullRequestController = new PullRequestController($this->gitHubService);
        
        try {
            // Use fast repositories endpoint instead of slow metrics endpoint
            $request = new \Illuminate\Http\Request(['dev_mode' => '1']);
            $reposResponse = $this->getRepositoriesSimple($request);
            $repositories = $reposResponse->getData()->repositories ?? [];
            
            Log::info('GitHub drilldown fetchRepositories - using fast endpoint', [
                'repositories_count' => count($repositories),
                'response_reason' => $reposResponse->getData()->reason ?? null
            ]);
            
            if (empty($repositories)) {
                Log::warning('No repository data available from fast endpoint for drilldown', [
                    'time_filter' => $timeFilter,
                    'limit' => $limit,
                    'reason' => $reposResponse->getData()->reason ?? 'unknown'
                ]);
                
                return [
                    'total_count' => 0,
                    'records' => [],
                    'reason' => $reposResponse->getData()->reason ?? 'insufficient_data'
                ];
            }
            
            // Map real repository data to drilldown format
            $repoRecords = array_map(function($repo) {
                // Handle both array and object formats
                $repoArray = is_object($repo) ? (array) $repo : $repo;
                return [
                    'id' => $repoArray['id'] ?? 0,
                    'name' => $repoArray['name'] ?? $repoArray['full_name'] ?? '',
                    'full_name' => $repoArray['full_name'] ?? $repoArray['name'] ?? '',
                    'description' => $repoArray['description'] ?? '',
                    'created_at' => $repoArray['created_at'] ?? '',
                    'updated_at' => $repoArray['updated_at'] ?? '',
                    'url' => $repoArray['html_url'] ?? ('https://github.com/' . ($repoArray['full_name'] ?? $repoArray['name'] ?? '')),
                    'language' => $repoArray['language'] ?? '',
                    'stars' => $repoArray['stargazers_count'] ?? 0,
                    'forks' => $repoArray['forks_count'] ?? 0,
                    'private' => $repoArray['private'] ?? false
                ];
            }, array_slice($repositories, 0, $limit));
            
            return [
                'total_count' => count($repositories),
                'records' => $repoRecords,
                'reason' => null
            ];
            
        } catch (\Exception $e) {
            Log::error('Failed to fetch real repository data for drilldown', [
                'error' => $e->getMessage(),
                'time_filter' => $timeFilter,
                'limit' => $limit
            ]);
            
            return [
                'total_count' => 0,
                'records' => [],
                'reason' => 'api_error'
            ];
        }
    }

    /**
     * Fetch failed deployments
     */
    private function fetchFailedDeployments($token, $timeFilter, $limit)
    {
        $pullRequestController = new PullRequestController($this->gitHubService);
        
        try {
            // Read directly from metrics response (no new GitHub calls)
            $metricsResponse = $pullRequestController->metrics(new \Illuminate\Http\Request());
            $data = $metricsResponse->getData();
            
            $failedDeployments = $data->deployment_metrics->failed_deployments_truncated ?? [];
            $totalCount = $data->deployment_metrics->failed_deployment_count ?? 0;
            
            if (empty($failedDeployments)) {
                return [
                    'total_count' => $totalCount,
                    'records' => [],
                    'reason' => 'details_not_available'
                ];
            }
            
            // Map real deployment data to drilldown format
            $records = array_map(function($deployment) {
                // Handle both array and object formats
                $deploymentArray = is_object($deployment) ? (array) $deployment : $deployment;
                
                return [
                    'id' => $deploymentArray['id'],
                    'repository' => $deploymentArray['repo_name'],
                    'environment' => $deploymentArray['environment'] ?? 'unknown',
                    'status' => $deploymentArray['status'],
                    'conclusion' => $deploymentArray['conclusion'],
                    'deployed_at' => $deploymentArray['deployed_at'],
                    'sha' => $deploymentArray['sha'],
                    'url' => $deploymentArray['html_url']
                ];
            }, array_slice($failedDeployments, 0, $limit));
            
            return [
                'total_count' => $totalCount,
                'records' => $records,
                'reason' => null
            ];
            
        } catch (\Exception $e) {
            Log::error('Failed to fetch deployment data from metrics for drilldown', [
                'error' => $e->getMessage(),
                'time_filter' => $timeFilter,
                'limit' => $limit
            ]);
            
            return [
                'total_count' => 0,
                'records' => [],
                'reason' => 'api_error'
            ];
        }
    }

    /**
     * Fetch success deployments
     */
    private function fetchSuccessDeployments($token, $timeFilter, $limit)
    {
        $pullRequestController = new PullRequestController($this->gitHubService);
        
        try {
            // Read directly from metrics response (no new GitHub calls)
            $metricsResponse = $pullRequestController->metrics(new \Illuminate\Http\Request());
            $data = $metricsResponse->getData();
            
            $successDeployments = $data->deployment_metrics->success_deployments_truncated ?? [];
            $totalCount = $data->deployment_metrics->success_deployment_count ?? 0;
            
            if (empty($successDeployments)) {
                return [
                    'total_count' => $totalCount,
                    'records' => [],
                    'reason' => 'details_not_available'
                ];
            }
            
            // Map real deployment data to drilldown format
            $records = array_map(function($deployment) {
                // Handle both array and object formats
                $deploymentArray = is_object($deployment) ? (array) $deployment : $deployment;
                
                return [
                    'id' => $deploymentArray['id'],
                    'repository' => $deploymentArray['repo_name'],
                    'environment' => $deploymentArray['environment'] ?? 'unknown',
                    'status' => $deploymentArray['status'],
                    'conclusion' => $deploymentArray['conclusion'],
                    'deployed_at' => $deploymentArray['deployed_at'],
                    'sha' => $deploymentArray['sha'],
                    'url' => $deploymentArray['html_url']
                ];
            }, array_slice($successDeployments, 0, $limit));
            
            return [
                'total_count' => $totalCount,
                'records' => $records,
                'reason' => null
            ];
            
        } catch (\Exception $e) {
            Log::error('Failed to fetch success deployment data from metrics for drilldown', [
                'error' => $e->getMessage(),
                'time_filter' => $timeFilter,
                'limit' => $limit
            ]);
            
            return [
                'total_count' => 0,
                'records' => [],
                'reason' => 'api_error'
            ];
        }
    }

    /**
     * Fetch merge rate metrics
     */
    private function fetchMergeRate($token, $timeFilter, $limit)
    {
        $pullRequestController = new PullRequestController($this->gitHubService);
        
        try {
            $metricsResponse = $pullRequestController->metrics(new \Illuminate\Http\Request());
            $githubTeamMetrics = $metricsResponse->getData()->github_team_metrics ?? [];
            $mergeRate = $githubTeamMetrics->merge_rate ?? 0;
            
            return [
                'total_count' => 1,
                'records' => [[
                    'id' => 'merge_rate',
                    'metric' => 'Merge Rate',
                    'value' => round($mergeRate, 2),
                    'percentage' => round($mergeRate, 2) . '%',
                    'description' => 'Percentage of pull requests that were merged',
                    'created_at' => now()->toISOString()
                ]],
                'reason' => null
            ];
        } catch (\Exception $e) {
            return [
                'total_count' => 0,
                'records' => [],
                'reason' => 'api_error'
            ];
        }
    }

    /**
     * Fetch review count metrics
     */
    private function fetchReviewCount($token, $timeFilter, $limit)
    {
        $pullRequestController = new PullRequestController($this->gitHubService);
        
        try {
            // Get existing metrics data that contains all_prs_truncated
            $metricsResponse = $pullRequestController->metrics(new \Illuminate\Http\Request());
            $allPRs = $metricsResponse->getData()->all_prs_truncated ?? [];
            
            if (empty($allPRs)) {
                Log::warning('No PR data available in all_prs_truncated for review count drilldown', [
                    'time_filter' => $timeFilter,
                    'limit' => $limit
                ]);
                
                return [
                    'total_count' => 0,
                    'records' => [],
                    'reason' => 'insufficient_data'
                ];
            }
            
            // Calculate review data from PRs
            $reviewData = [];
            foreach ($allPRs as $pr) {
                $prArray = is_object($pr) ? (array) $pr : $pr;
                $reviewCount = ($prArray['comments'] ?? 0) + ($prArray['review_comments'] ?? 0);
                if ($reviewCount > 0) {
                    $reviewData[] = [
                        'id' => $prArray['id'] ?? $prArray['number'] ?? null,
                        'pr_number' => $prArray['number'] ?? 0,
                        'pr_title' => $prArray['title'] ?? '',
                        'review_count' => $reviewCount,
                        'comments' => $prArray['comments'] ?? 0,
                        'review_comments' => $prArray['review_comments'] ?? 0,
                        'author' => $prArray['user']['login'] ?? $prArray['author'] ?? '',
                        'created_at' => $prArray['created_at'] ?? '',
                        'url' => $prArray['html_url'] ?? '',
                        'repository' => $prArray['base']['repo']['full_name'] ?? $prArray['repo'] ?? ''
                    ];
                }
            }
            
            return [
                'total_count' => count($reviewData),
                'records' => array_slice($reviewData, 0, $limit),
                'reason' => null
            ];
            
        } catch (\Exception $e) {
            Log::error('Failed to fetch review count data from metrics for drilldown', [
                'error' => $e->getMessage(),
                'time_filter' => $timeFilter,
                'limit' => $limit
            ]);
            
            return [
                'total_count' => 0,
                'records' => [],
                'reason' => 'api_error'
            ];
        }
    }

    /**
     * Fetch unique reviewers metrics
     */
    private function fetchUniqueReviewers($token, $timeFilter, $limit)
    {
        $pullRequestController = new PullRequestController($this->gitHubService);
        
        try {
            // Get existing metrics data that contains all_prs_truncated
            $metricsResponse = $pullRequestController->metrics(new \Illuminate\Http\Request());
            $allPRs = $metricsResponse->getData()->all_prs_truncated ?? [];
            
            if (empty($allPRs)) {
                Log::warning('No PR data available in all_prs_truncated for unique reviewers drilldown', [
                    'time_filter' => $timeFilter,
                    'limit' => $limit
                ]);
                
                return [
                    'total_count' => 0,
                    'records' => [],
                    'reason' => 'insufficient_data'
                ];
            }
            
            // Extract unique reviewers from PR data
            $uniqueReviewers = [];
            foreach ($allPRs as $pr) {
                $prArray = is_object($pr) ? (array) $pr : $pr;
                
                // Handle nested stdClass objects
                $userArray = is_object($prArray['user'] ?? null) ? (array) $prArray['user'] : ($prArray['user'] ?? []);
                $baseArray = is_object($prArray['base'] ?? null) ? (array) $prArray['base'] : ($prArray['base'] ?? []);
                $baseRepoArray = is_object($baseArray['repo'] ?? null) ? (array) $baseArray['repo'] : ($baseArray['repo'] ?? []);
                
                $author = $userArray['login'] ?? $prArray['author'] ?? '';
                if (!empty($author)) {
                    $uniqueReviewers[$author] = [
                        'reviewer' => $author,
                        'pr_count' => ($uniqueReviewers[$author]['pr_count'] ?? 0) + 1,
                        'last_pr_date' => max($uniqueReviewers[$author]['last_pr_date'] ?? '', $prArray['created_at'] ?? ''),
                        'repositories' => array_unique(array_merge($uniqueReviewers[$author]['repositories'] ?? [], [$baseRepoArray['full_name'] ?? $prArray['repo'] ?? '']))
                    ];
                }
            }
            
            // Convert to array and sort by PR count
            $reviewerRecords = array_values($uniqueReviewers);
            usort($reviewerRecords, function($a, $b) {
                return $b['pr_count'] - $a['pr_count'];
            });
            
            // Map to drilldown format
            $finalRecords = array_map(function($reviewer, $index) {
                return [
                    'id' => 'reviewer_' . $index,
                    'reviewer' => $reviewer['reviewer'],
                    'pr_count' => $reviewer['pr_count'],
                    'last_pr_date' => $reviewer['last_pr_date'],
                    'repositories' => implode(', ', $reviewer['repositories']),
                    'created_at' => $reviewer['last_pr_date']
                ];
            }, array_slice($reviewerRecords, 0, $limit), array_keys(array_slice($reviewerRecords, 0, $limit)));
            
            return [
                'total_count' => count($reviewerRecords),
                'records' => $finalRecords,
                'reason' => null
            ];
            
        } catch (\Exception $e) {
            Log::error('Failed to fetch unique reviewers data from metrics for drilldown', [
                'error' => $e->getMessage(),
                'time_filter' => $timeFilter,
                'limit' => $limit
            ]);
            
            return [
                'total_count' => 0,
                'records' => [],
                'reason' => 'api_error'
            ];
        }
    }

    /**
     * Fetch rejected PRs metrics
     */
    private function fetchRejectedPRs($token, $timeFilter, $limit)
    {
        $pullRequestController = new PullRequestController($this->gitHubService);
        
        try {
            // Get existing metrics data that contains all_prs_truncated
            $metricsResponse = $pullRequestController->metrics(new \Illuminate\Http\Request());
            $allPRs = $metricsResponse->getData()->all_prs_truncated ?? [];
            
            if (empty($allPRs)) {
                Log::warning('No PR data available in all_prs_truncated for rejected PRs drilldown', [
                    'time_filter' => $timeFilter,
                    'limit' => $limit
                ]);
                
                return [
                    'total_count' => 0,
                    'records' => [],
                    'reason' => 'insufficient_data'
                ];
            }
            
            // Filter for PRs that were closed without merging (rejected)
            $rejectedPRs = array_filter($allPRs, function($pr) {
                $prArray = is_object($pr) ? (array) $pr : $pr;
                $state = $prArray['state'] ?? '';
                $mergedAt = $prArray['merged_at'] ?? null;
                // Consider PRs rejected if they're closed but not merged
                return $state === 'closed' && empty($mergedAt);
            });
            
            // Map to drilldown format
            $rejectedPRRecords = array_map(function($pr) {
                $prArray = is_object($pr) ? (array) $pr : $pr;
                
                // Handle nested stdClass objects
                $userArray = is_object($prArray['user'] ?? null) ? (array) $prArray['user'] : ($prArray['user'] ?? []);
                $baseArray = is_object($prArray['base'] ?? null) ? (array) $prArray['base'] : ($prArray['base'] ?? []);
                $baseRepoArray = is_object($baseArray['repo'] ?? null) ? (array) $baseArray['repo'] : ($baseArray['repo'] ?? []);
                
                return [
                    'id' => $prArray['id'] ?? $prArray['number'] ?? null,
                    'number' => $prArray['number'] ?? null,
                    'title' => $prArray['title'] ?? '',
                    'author' => $userArray['login'] ?? $prArray['author'] ?? '',
                    'created_at' => $prArray['created_at'] ?? '',
                    'closed_at' => $prArray['closed_at'] ?? '',
                    'state' => $prArray['state'] ?? '',
                    'merged_at' => $prArray['merged_at'] ?? null,
                    'url' => $prArray['html_url'] ?? '',
                    'repository' => $baseRepoArray['full_name'] ?? $prArray['repo'] ?? '',
                    'rejection_reason' => 'Closed without merging'
                ];
            }, array_slice($rejectedPRs, 0, $limit));
            
            return [
                'total_count' => count($rejectedPRs),
                'records' => $rejectedPRRecords,
                'reason' => null
            ];
            
        } catch (\Exception $e) {
            Log::error('Failed to fetch rejected PR data from metrics for drilldown', [
                'error' => $e->getMessage(),
                'time_filter' => $timeFilter,
                'limit' => $limit
            ]);
            
            return [
                'total_count' => 0,
                'records' => [],
                'reason' => 'api_error'
            ];
        }
    }

    /**
     * Fetch commits per day metrics
     */
    private function fetchCommitsPerDay($token, $timeFilter, $limit)
    {
        $pullRequestController = new PullRequestController($this->gitHubService);
        
        try {
            $metricsResponse = $pullRequestController->metrics(new \Illuminate\Http\Request());
            $githubTeamMetrics = $metricsResponse->getData()->github_team_metrics ?? [];
            $commitsPerDay = $githubTeamMetrics->commits_per_day ?? 0;
            
            return [
                'total_count' => 1,
                'records' => [[
                    'id' => 'commits_per_day',
                    'metric' => 'Commits Per Day',
                    'value' => round($commitsPerDay, 2),
                    'description' => 'Average number of commits per day',
                    'created_at' => now()->toISOString()
                ]],
                'reason' => null
            ];
        } catch (\Exception $e) {
            return [
                'total_count' => 0,
                'records' => [],
                'reason' => 'api_error'
            ];
        }
    }

    /**
     * Fetch first review time metrics
     */
    private function fetchFirstReviewAt($token, $timeFilter, $limit)
    {
        $pullRequestController = new PullRequestController($this->gitHubService);
        
        try {
            $metricsResponse = $pullRequestController->metrics(new \Illuminate\Http\Request());
            $githubTeamMetrics = $metricsResponse->getData()->github_team_metrics ?? [];
            $timeToFirstReview = $githubTeamMetrics->time_to_first_review ?? 0;
            
            return [
                'total_count' => 1,
                'records' => [[
                    'id' => 'first_review_at',
                    'metric' => 'Time to First Review',
                    'value' => round($timeToFirstReview, 2),
                    'unit' => 'hours',
                    'description' => 'Average time from PR creation to first review',
                    'created_at' => now()->toISOString()
                ]],
                'reason' => null
            ];
        } catch (\Exception $e) {
            return [
                'total_count' => 0,
                'records' => [],
                'reason' => 'api_error'
            ];
        }
    }

    /**
     * Fetch time to merge metrics
     */
    private function fetchTimeToMerge($token, $timeFilter, $limit)
    {
        $pullRequestController = new PullRequestController($this->gitHubService);
        
        try {
            $metricsResponse = $pullRequestController->metrics(new \Illuminate\Http\Request());
            $githubTeamMetrics = $metricsResponse->getData()->github_team_metrics ?? [];
            $timeToMerge = $githubTeamMetrics->time_to_merge ?? 0;
            
            return [
                'total_count' => 1,
                'records' => [[
                    'id' => 'time_to_merge',
                    'metric' => 'Time to Merge',
                    'value' => round($timeToMerge, 2),
                    'unit' => 'days',
                    'description' => 'Average time from PR creation to merge',
                    'created_at' => now()->toISOString()
                ]],
                'reason' => null
            ];
        } catch (\Exception $e) {
            return [
                'total_count' => 0,
                'records' => [],
                'reason' => 'api_error'
            ];
        }
    }

    /**
     * Fetch PR review cycles metrics
     */
    private function fetchPRReviewCycles($token, $timeFilter, $limit)
    {
        $pullRequestController = new PullRequestController($this->gitHubService);
        
        try {
            $metricsResponse = $pullRequestController->metrics(new \Illuminate\Http\Request());
            $data = $metricsResponse->getData();
            
            $prReviewCycles = $data->pr_review_cycles ?? 0;
            $reviewMetrics = $data->pr_review_metrics ?? (object)[];
            $reviewCount = $reviewMetrics->review_count ?? 0;
            $totalPRs = $reviewMetrics->total_prs ?? 0;
            
            return [
                'total_count' => 1,
                'records' => [[
                    'id' => 'pr_review_cycles',
                    'metric' => 'PR Review Cycles',
                    'value' => round($prReviewCycles, 2),
                    'unit' => 'cycles per PR',
                    'description' => 'Average number of review cycles per pull request',
                    'details' => [
                        'total_reviews' => $reviewCount,
                        'total_prs' => $totalPRs,
                        'calculation' => $totalPRs > 0 ? "{$reviewCount} reviews ÷ {$totalPRs} PRs" : 'No PRs available'
                    ],
                    'created_at' => now()->toISOString()
                ]],
                'reason' => null
            ];
        } catch (\Exception $e) {
            return [
                'total_count' => 0,
                'records' => [],
                'reason' => 'api_error'
            ];
        }
    }
}
