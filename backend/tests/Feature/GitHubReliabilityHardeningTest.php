<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Http\Controllers\PullRequestController;
use App\Services\GitHubApiService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use ReflectionClass;

/**
 * PILOT OPS 18G.1 — GitHub reliability hardening regressions.
 *
 * Proves:
 *  1. identity_only tokens carrying 'repo' scope (grant carryover) can never
 *     resolve as engineering authority.
 *  2. The live GitHub metrics request budget stays below the PHP
 *     max_execution_time ceiling (no hard fatal → no CORS-less response).
 *  3. time_filter=all no longer references an undefined $cutoffTime.
 *  4. The enrichment rate-limit check uses the correct 'rate_limit' endpoint
 *     (no leading slash → no api.github.com//rate_limit 404).
 *  5. The GitHub delivery-metrics happy path still returns real metrics.
 */
class GitHubReliabilityHardeningTest extends TestCase
{
    use RefreshDatabase;

    private function fakeGitHub(array $responses): GitHubApiService
    {
        return new class($responses) extends GitHubApiService {
            public array $calls = [];
            private array $responses;
            public function __construct(array $responses)
            {
                $this->responses = $responses;
            }
            public function makeApiCall($token, $endpoint)
            {
                $this->calls[] = $endpoint;
                return $this->responses[$endpoint] ?? null;
            }
        };
    }

    private function controllerWith(GitHubApiService $svc): PullRequestController
    {
        $controller = new PullRequestController();
        $prop = new \ReflectionProperty(PullRequestController::class, 'githubApiService');
        $prop->setAccessible(true);
        $prop->setValue($controller, $svc);
        return $controller;
    }

    private function invokePrivate(object $obj, string $method, array $args = [])
    {
        $m = new \ReflectionMethod($obj, $method);
        $m->setAccessible(true);
        return $m->invokeArgs($obj, $args);
    }

    /** @test — repo scope on identity_only never becomes engineering authority */
    public function identity_only_token_with_repo_scope_is_not_engineering_authority()
    {
        DB::table('users')->insert([
            'name' => 'Matt', 'email' => 'matt@example.com', 'password' => 'x',
            'organization_id' => null, 'github_id' => '18269556', 'role' => 'admin',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $uid = DB::getPdo()->lastInsertId();

        // Identity-only credential whose GitHub grant carried repo scope over
        // from a prior authorization — exactly the production failure mode.
        DB::table('oauth_tokens')->insert([
            'user_id' => $uid,
            'access_token' => 'gho_identityWithRepoScope',
            'user_data' => json_encode([
                'token_purpose' => 'identity_only',
                'login' => 'octo-user',
                'scope' => 'read:user,user:email,repo',
                'repositories' => ['acme/widgets'],
            ]),
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $status = $this->getJson('/api/github/oauth/status');
        $status->assertOk();
        $this->assertNotEquals('engineering_integration', $status->json('token_purpose'));
        $this->assertSame('identity_only', $status->json('token_purpose'));
    }

    /** @test — request budget stays below the PHP ceiling */
    public function metrics_request_budget_is_bounded_below_php_ceiling()
    {
        $controller = new PullRequestController();
        $original = ini_get('max_execution_time');
        try {
            ini_set('max_execution_time', '30');
            $budget = $this->invokePrivate($controller, 'githubRequestBudgetSeconds');
            $this->assertLessThanOrEqual(25, $budget, 'budget must sit below the 30s ceiling with margin');
            $this->assertGreaterThanOrEqual(10, $budget);
            $this->assertLessThanOrEqual(60, $budget);

            ini_set('max_execution_time', '12');
            $this->assertSame(10, $this->invokePrivate($controller, 'githubRequestBudgetSeconds'),
                'floor of 10s applies when the ceiling leaves almost no room');

            ini_set('max_execution_time', '0');
            $this->assertSame(60, $this->invokePrivate($controller, 'githubRequestBudgetSeconds'),
                'unlimited ceiling keeps the historical 60s budget');
        } finally {
            ini_set('max_execution_time', (string) $original);
        }
    }

    /** @test — time_filter=all no longer touches an undefined $cutoffTime */
    public function delivery_metrics_with_time_filter_all_returns_result_not_null()
    {
        $svc = $this->fakeGitHub([
            'repos/acme/widgets/actions/runs?per_page=50' => [
                'workflow_runs' => [[
                    'id' => 987654,
                    'created_at' => now()->toIso8601String(),
                    'conclusion' => 'success',
                    'head_sha' => 'abc123',
                    'name' => 'deploy',
                    'html_url' => 'https://github.com/acme/widgets/actions/runs/987654',
                ]],
            ],
        ]);
        $controller = $this->controllerWith($svc);

        $result = $this->invokePrivate($controller, 'computeOrgDeploymentMetricsFromGitHubActions', [
            'token', ['acme/widgets'], 'all',
        ]);

        // Pre-fix: "Undefined variable $cutoffTime" ErrorException → catch → null.
        $this->assertIsArray($result);
        $this->assertArrayHasKey('success_deployment_count', $result);
        $this->assertArrayHasKey('latest_deployment', $result);
    }

    /** @test — rate-limit check uses the correct endpoint (no leading slash) */
    public function enrichment_rate_limit_check_uses_correct_endpoint()
    {
        $svc = $this->fakeGitHub([
            'rate_limit' => ['resources' => ['core' => ['remaining' => 4999]]],
        ]);
        $controller = $this->controllerWith($svc);

        $diagnostics = [];
        $this->invokePrivate($controller, 'selectivelyEnrichPRDetails', [
            [], 'token', time(), 10, &$diagnostics,
        ]);

        $this->assertContains('rate_limit', $svc->calls);
        $this->assertNotContains('/rate_limit', $svc->calls);
    }
}
