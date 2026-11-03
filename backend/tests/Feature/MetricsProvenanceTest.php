<?php
namespace Tests\Feature;

use App\Models\Deployment;
use App\Models\Organization;
use App\Models\PullRequest;
use App\Models\User;
use App\Models\ApiToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Deterministic Metrics Provenance Contract Tests
 *
 * Runs against a disposable in-memory SQLite database (:memory:).
 * Does NOT touch cr1-local-working.sqlite or any real local data.
 *
 * Local-snapshot integration tests (exact hardcoded counts from the real
 * local DB) have been moved to LocalSnapshotIntegrationTest.php with
 * @group local-snapshot, excluded from the default suite.
 */
class MetricsProvenanceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // Local Lab mode enables the cm_activity_sim fallback for PR/deployment
        // queries when no org OAuth repo allow-list is available.
        config(['app.env' => 'local']);
        \Cache::flush();
        $this->withoutMiddleware();
    }

    // ════════════════════════════════════════════════════════════
    // WEEK CONTRACT — empty DB must return zero/null, not missing keys
    // ════════════════════════════════════════════════════════════

    public function test_week_zero_prs()
    {
        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        $this->assertEquals(0, $j['pr_analytics']['total_prs'] ?? -1);
    }

    public function test_week_zero_total_prs_in_review_metrics()
    {
        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        // pr_review_metrics returns total_prs (not reviewed_pr_count)
        $this->assertEquals(0, $j['pr_review_metrics']['total_prs'] ?? -1);
    }

    public function test_week_zero_success_deployments()
    {
        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        $this->assertEquals(0, $j['deployment_metrics']['success_deployment_count'] ?? -1);
    }

    public function test_week_zero_failed_deployments()
    {
        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        $this->assertEquals(0, $j['deployment_metrics']['failed_deployment_count'] ?? -1);
    }

    public function test_week_cfr_is_zero_when_no_deployments()
    {
        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        // CFR is 0.0 when there are no deployments (not null — the calculation
        // returns 0.0 for total=0)
        $this->assertArrayHasKey('change_failure_rate', $j['deployment_metrics'] ?? [], 'change_failure_rate key missing');
        $this->assertEquals(0, $j['deployment_metrics']['change_failure_rate']);
    }

    public function test_week_null_latest_deployment_deployed_at()
    {
        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        $this->assertArrayHasKey('latest_deployment', $j['deployment_metrics'] ?? [], 'latest_deployment key missing');
        $this->assertArrayHasKey('deployed_at', $j['deployment_metrics']['latest_deployment'] ?? [], 'deployed_at key missing');
        $this->assertNull($j['deployment_metrics']['latest_deployment']['deployed_at']);
    }

    public function test_week_github_by_period_is_array()
    {
        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        // github_by_period is always an array (seeded periods exist even with no data)
        $this->assertIsArray($j['github_by_period'] ?? null);
    }

    public function test_week_provenance_data_source_is_fixture_fallback()
    {
        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        // With no data and no OAuth, provenance reports fixture_fallback
        $this->assertEquals('fixture_fallback', $j['github_provenance']['data_source'] ?? 'x');
    }

    // ════════════════════════════════════════════════════════════
    // REFLECTION TEST — deployment fallback respects week window
    // ════════════════════════════════════════════════════════════

    public function test_github_deploy_fallback_respects_week_window()
    {
        $controller = new \App\Http\Controllers\PullRequestController();
        $ref = new \ReflectionClass($controller);
        $method = $ref->getMethod('calculateDeploymentMetricsFromGitHubData');
        $method->setAccessible(true);
        $debug = null;
        $result = $method->invokeArgs($controller, [[], null, 'week', null, [], &$debug]);
        $this->assertArrayHasKey('latest_deployment', $result ?? [], 'latest_deployment missing from result');
        $this->assertArrayHasKey('deployed_at', $result['latest_deployment'] ?? [], 'deployed_at missing from latest_deployment');
        $this->assertNull($result['latest_deployment']['deployed_at'], 'DB fallback must not return all-time deployment for week window');
        $this->assertEquals(0, $result['failed_deployment_count'] ?? -1);
    }

    // ════════════════════════════════════════════════════════════
    // DETERMINISTIC FIXTURE TESTS — seeded data returns expected counts
    // ════════════════════════════════════════════════════════════

    public function test_week_with_fixture_returns_expected_pr_count()
    {
        PullRequest::create([
            'repo_name' => 'mattmcclintock/cm-activity-sim',
            'pr_number' => 101,
            'data_source' => 'cm_activity_sim',
            'merged_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        PullRequest::create([
            'repo_name' => 'mattmcclintock/cm-activity-sim',
            'pr_number' => 102,
            'data_source' => 'cm_activity_sim',
            'merged_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        $this->assertGreaterThanOrEqual(2, $j['pr_analytics']['total_prs'] ?? -1,
            'Week PR count should include the 2 fixture PRs');
    }

    public function test_week_with_fixture_returns_expected_deployment_counts()
    {
        Deployment::create([
            'repo_name' => 'mattmcclintock/cm-activity-sim',
            'deployment_status' => 'success',
            'deployed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Deployment::create([
            'repo_name' => 'mattmcclintock/cm-activity-sim',
            'deployment_status' => 'success',
            'deployed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Deployment::create([
            'repo_name' => 'mattmcclintock/cm-activity-sim',
            'deployment_status' => 'failure',
            'deployed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        $dm = $j['deployment_metrics'] ?? [];
        $this->assertGreaterThanOrEqual(2, $dm['success_deployment_count'] ?? -1,
            'Should count 2+ success deployments from fixture');
        $this->assertGreaterThanOrEqual(1, $dm['failed_deployment_count'] ?? -1,
            'Should count 1+ failed deployment from fixture');
    }

    public function test_all_time_with_fixture_provenance_source_is_cm_activity_sim()
    {
        Deployment::create([
            'repo_name' => 'mattmcclintock/cm-activity-sim',
            'deployment_status' => 'success',
            'deployed_at' => now()->subDays(5),
            'metadata' => ['source' => 'cm_activity_sim', 'data_source' => 'seeded'],
            'created_at' => now()->subDays(5),
            'updated_at' => now()->subDays(5),
        ]);

        $j = $this->getJson('/api/metrics?time_filter=all&oauth=false&nocache=1&use_all_data=1')->json();
        // With cm_activity_sim data, provenance source is 'cm_activity_sim'
        $this->assertEquals('cm_activity_sim', $j['github_provenance']['source'] ?? 'x',
            'Provenance source should be cm_activity_sim for local fixture data');
        $this->assertTrue($j['github_provenance']['db_data_available'] ?? false,
            'db_data_available should be true with fixture data');
    }

    // ════════════════════════════════════════════════════════════
    // CROSS-ORGANIZATION NEGATIVE COVERAGE — data must not leak
    // ════════════════════════════════════════════════════════════

    public function test_cross_org_data_does_not_leak_to_other_org()
    {
        $orgA = Organization::create(['name' => 'Org A', 'slug' => 'org-a']);
        $orgB = Organization::create(['name' => 'Org B', 'slug' => 'org-b']);

        $userA = User::factory()->create(['organization_id' => $orgA->id]);
        $rawTokenA = 'test-token-org-a-' . Str::random(32);
        ApiToken::create([
            'token' => hash('sha256', $rawTokenA),
            'user_id' => $userA->id,
            'organization_id' => $orgA->id,
            'expires_at' => now()->addDays(30),
        ]);

        // Insert PR data with cm_activity_sim (Local Lab fallback)
        PullRequest::create([
            'repo_name' => 'mattmcclintock/cm-activity-sim',
            'pr_number' => 201,
            'data_source' => 'cm_activity_sim',
            'merged_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Insert PR data with a DIFFERENT data_source (not cm_activity_sim)
        PullRequest::create([
            'repo_name' => 'other-org/repo',
            'pr_number' => 202,
            'data_source' => 'github_api',
            'merged_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Query as org A — should only see cm_activity_sim data
        $j = $this->withHeaders(['Authorization' => 'Bearer ' . $rawTokenA])
            ->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();

        // The cm_activity_sim PR should be counted
        $totalPrs = $j['pr_analytics']['total_prs'] ?? 0;
        $this->assertGreaterThanOrEqual(1, $totalPrs,
            'cm_activity_sim PR should be visible in Local Lab mode');

        // The github_api PR should NOT appear (filtered by data_source != cm_activity_sim)
        $this->assertLessThan(2, $totalPrs,
            'Non-cm_activity_sim PR should NOT be visible in Local Lab mode');
    }

    public function test_non_local_env_fails_closed_without_oauth()
    {
        // In non-local mode (testing), without OAuth, the fail-closed
        // path should return zero results (1=0 predicate)
        config(['app.env' => 'testing']);

        PullRequest::create([
            'repo_name' => 'mattmcclintock/cm-activity-sim',
            'pr_number' => 301,
            'data_source' => 'cm_activity_sim',
            'merged_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        $this->assertEquals(0, $j['pr_analytics']['total_prs'] ?? -1,
            'Non-local env without OAuth must fail closed (zero PRs)');
    }

    // ════════════════════════════════════════════════════════════
    // CR-X 18B.2: Customer repository authority (telemetry ∩ GitHub visible)
    // ════════════════════════════════════════════════════════════

    private function customerRepoAuthorityHarness(array $customerRepos = [], array $apiResponses = [])
    {
        return new class($customerRepos, $apiResponses) {
            use \App\Traits\PilotAwareTokenHelper;

            public array $customerRepos;
            public array $apiResponses;

            public function __construct(array $customerRepos, array $apiResponses)
            {
                $this->customerRepos = $customerRepos;
                $this->apiResponses = $apiResponses;
            }

            protected function getOrganizationCanonicalRepoSet(int $organizationId): array
            {
                return $this->customerRepos;
            }

            protected function fetchGitHubAuthorityApiCall(string $oauthToken, string $endpoint): ?array
            {
                return $this->apiResponses[$endpoint] ?? null;
            }
        };
    }

    private function engineeringOAuthUser(array $repositories = []): array
    {
        return [
            'login' => 'eng-user',
            'token_purpose' => 'engineering_integration',
            'repositories' => $repositories,
        ];
    }

    public function test_customer_repo_authority_rejects_personal_repos()
    {
        $harness = $this->customerRepoAuthorityHarness(['customer-org/customer-repo']);
        $ref = new \ReflectionClass($harness);
        $method = $ref->getMethod('resolveCustomerRepoAllowList');
        $method->setAccessible(true);

        $result = $method->invoke($harness, 'gho_test', $this->engineeringOAuthUser(['e-d/personal-repo']), 1);
        $this->assertEmpty($result, 'Token with only personal repos must not have customer repo authority');
    }

    public function test_customer_repo_authority_rejects_unrelated_org_repos()
    {
        $harness = $this->customerRepoAuthorityHarness(['customer-org/customer-repo']);
        $ref = new \ReflectionClass($harness);
        $method = $ref->getMethod('resolveCustomerRepoAllowList');
        $method->setAccessible(true);

        $result = $method->invoke($harness, 'gho_test', $this->engineeringOAuthUser(['some-other-org/unrelated-repo']), 1);
        $this->assertEmpty($result, 'Token with only unrelated organization repos must not have customer repo authority');
    }

    public function test_customer_repo_authority_accepts_normalized_telemetry_match()
    {
        // Telemetry carries SSH-style URL; token-visible is canonical owner/repo
        $harness = $this->customerRepoAuthorityHarness(['customer-org/customer-repo'], [
            'user/memberships/orgs/customer-org' => ['state' => 'active'],
        ]);
        $ref = new \ReflectionClass($harness);
        $method = $ref->getMethod('resolveCustomerRepoAllowList');
        $method->setAccessible(true);

        $result = $method->invoke($harness, 'gho_test', $this->engineeringOAuthUser(['customer-org/customer-repo']), 1);
        $this->assertContains('customer-org/customer-repo', $result, 'Normalized telemetry repo must match token-visible repo');
    }

    public function test_customer_repo_authority_allowlist_restricted_to_overlap()
    {
        $harness = $this->customerRepoAuthorityHarness(['customer-org/customer-repo'], [
            'user/memberships/orgs/customer-org' => ['state' => 'active'],
        ]);
        $ref = new \ReflectionClass($harness);
        $method = $ref->getMethod('resolveCustomerRepoAllowList');
        $method->setAccessible(true);

        $result = $method->invoke($harness, 'gho_test', $this->engineeringOAuthUser([
            'customer-org/customer-repo',
            'some-other-org/unrelated-repo',
            'e-d/personal-repo',
        ]), 1);

        $this->assertEquals(['customer-org/customer-repo'], $result, 'Allow-list must only contain customer telemetry repos');
    }

    public function test_customer_repo_authority_finds_repo_on_first_page()
    {
        $harness = $this->customerRepoAuthorityHarness(['customer-org/customer-repo'], [
            'user/repos?per_page=100&affiliation=owner,collaborator,organization_member&page=1' => [
                ['full_name' => 'customer-org/customer-repo'],
            ],
            'user/memberships/orgs/customer-org' => ['state' => 'active'],
        ]);

        $ref = new \ReflectionClass($harness);
        $method = $ref->getMethod('resolveCustomerRepoAllowList');
        $method->setAccessible(true);

        $result = $method->invoke($harness, 'gho_test', $this->engineeringOAuthUser(), 1);
        $this->assertEquals(['customer-org/customer-repo'], $result);
    }

    public function test_customer_repo_authority_finds_repo_beyond_first_page()
    {
        $pageOne = [];
        for ($i = 0; $i < 100; $i++) {
            $pageOne[] = ['full_name' => "token-owner/visible-{$i}"];
        }

        $harness = $this->customerRepoAuthorityHarness(['customer-org/customer-repo'], [
            'user/repos?per_page=100&affiliation=owner,collaborator,organization_member&page=1' => $pageOne,
            'user/repos?per_page=100&affiliation=owner,collaborator,organization_member&page=2' => [
                ['full_name' => 'customer-org/customer-repo'],
            ],
            'user/memberships/orgs/customer-org' => ['state' => 'active'],
        ]);

        $ref = new \ReflectionClass($harness);
        $method = $ref->getMethod('resolveCustomerRepoAllowList');
        $method->setAccessible(true);

        $result = $method->invoke($harness, 'gho_test', $this->engineeringOAuthUser(), 1);
        $this->assertEquals(['customer-org/customer-repo'], $result);
    }

    public function test_customer_repo_authority_rejects_personal_and_external_only()
    {
        $harness = $this->customerRepoAuthorityHarness([
            'e-d/personal-repo',
            'external-org/external-repo',
        ], [
            'user/repos?per_page=100&affiliation=owner,collaborator,organization_member&page=1' => [
                ['full_name' => 'e-d/personal-repo'],
                ['full_name' => 'external-org/external-repo'],
            ],
            'repos/e-d/personal-repo' => [
                'full_name' => 'e-d/personal-repo',
                'owner' => ['type' => 'User'],
            ],
            'repos/external-org/external-repo' => [
                'full_name' => 'external-org/external-repo',
                'owner' => ['type' => 'Organization'],
            ],
        ]);

        $ref = new \ReflectionClass($harness);
        $method = $ref->getMethod('resolveCustomerRepoAllowList');
        $method->setAccessible(true);

        $result = $method->invoke($harness, 'gho_test', $this->engineeringOAuthUser(), 1);
        $this->assertEquals([], $result);
    }

    public function test_azure_telemetry_repo_does_not_establish_github_authority()
    {
        $harness = $this->customerRepoAuthorityHarness(['azure:customer-org/customer-repo']);
        $ref = new \ReflectionClass($harness);
        $method = $ref->getMethod('resolveCustomerRepoAllowList');
        $method->setAccessible(true);

        $result = $method->invoke($harness, 'gho_test', $this->engineeringOAuthUser(['customer-org/customer-repo']), 1);
        $this->assertEquals([], $result);
    }

    public function test_customer_repo_authority_rejects_identity_only_credential()
    {
        $harness = $this->customerRepoAuthorityHarness(['customer-org/customer-repo']);
        $ref = new \ReflectionClass($harness);
        $method = $ref->getMethod('resolveCustomerRepoAllowList');
        $method->setAccessible(true);

        $result = $method->invoke($harness, 'gho_test', [
            'login' => 'identity-user',
            'token_purpose' => 'identity_only',
            'repositories' => ['customer-org/customer-repo'],
        ], 1);
        $this->assertEquals([], $result);
    }

    public function test_customer_repo_authority_rejects_support_login()
    {
        config(['services.pilot.support_github_logins' => 'support-bot']);
        $harness = $this->customerRepoAuthorityHarness(['customer-org/customer-repo']);
        $ref = new \ReflectionClass($harness);
        $method = $ref->getMethod('resolveCustomerRepoAllowList');
        $method->setAccessible(true);

        $result = $method->invoke($harness, 'gho_test', [
            'login' => 'support-bot',
            'token_purpose' => 'engineering_integration',
            'repositories' => ['customer-org/customer-repo'],
        ], 1);
        $this->assertEquals([], $result);
    }

    public function test_customer_repo_authority_rejects_no_intersection()
    {
        $harness = $this->customerRepoAuthorityHarness(['customer-org/customer-repo'], [
            'user/repos?per_page=100&affiliation=owner,collaborator,organization_member&page=1' => [
                ['full_name' => 'e-d/personal-repo'],
            ],
            'repos/customer-org/customer-repo' => [
                'full_name' => 'customer-org/customer-repo',
                'owner' => ['type' => 'Organization'],
            ],
        ]);

        $ref = new \ReflectionClass($harness);
        $method = $ref->getMethod('resolveCustomerRepoAllowList');
        $method->setAccessible(true);

        $result = $method->invoke($harness, 'gho_test', $this->engineeringOAuthUser(), 1);
        $this->assertEquals([], $result);
    }
}
