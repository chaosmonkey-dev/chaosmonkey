<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\ApiToken;
use App\Models\Deployment;
use App\Models\Organization;
use App\Models\PullRequest;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;

/**
 * CR-X R2: Delivery timeseries endpoint tests.
 *
 * Verifies /api/delivery/timeseries provides:
 * - authentication required (401 without token)
 * - tenant/org scoping (token determines org context)
 * - repo filtering
 * - date filtering (from/to)
 * - provenance eligibility (cm_activity_sim in local, github_api_sync/db_sync in live)
 * - seeded/non-authoritative rows excluded
 * - success/failure deployment counts
 * - merge-cycle calculation
 * - attribution_authority in meta (org vs repo)
 * - count_authority = observed_rows
 *
 * Uses ephemeral test DB only (RefreshDatabase). No Local DB writes.
 */
class DeliveryTimeseriesTest extends TestCase
{
    use RefreshDatabase;

    private function createDashboardToken(Organization $org): string
    {
        $user = User::factory()->create(['organization_id' => $org->id]);
        return ApiToken::generateDashboardToken($user->id, $org->id)['raw'];
    }

    private function insertDeployment(array $overrides = []): void
    {
        Deployment::create(array_merge([
            'repo_name' => 'test-repo',
            'environment' => 'production',
            'deployment_status' => 'success',
            'deployed_at' => now()->startOfWeek(),
            'sha' => Str::random(40),
            'rollback_detected' => false,
            // Testing env is not 'local', so the endpoint uses the "live" path
            // which requires github_api_sync or db_sync provenance.
            'metadata' => ['source' => 'github_api_sync'],
        ], $overrides));
    }

    private function insertPullRequest(array $overrides = []): void
    {
        PullRequest::create(array_merge([
            'repo_name' => 'test-repo',
            'pr_number' => rand(1, 99999),
            'developer_id' => 'invite:1',
            'merged_at' => now()->startOfWeek(),
            'created_at' => now()->startOfWeek()->subHours(24),
            'comments_count' => 0,
            'review_count' => 0,
            'first_review_at' => null,
            'unique_reviewer_count' => 0,
            'pr_reopened_count' => 0,
            'cursor_usage_detected' => false,
            'additions' => 10,
            'deletions' => 5,
            'changed_files' => 2,
            'review_comments' => 0,
            'user_login' => 'testuser',
            // Testing env uses the "live" path — must not be demo/seeded/cm_activity_sim
            'data_source' => 'github_api_sync',
            'team_name' => null,
        ], $overrides));
    }

    public function test_unauthenticated_request_returns_401(): void
    {
        $response = $this->getJson('/api/delivery/timeseries');
        $response->assertStatus(401);
    }

    public function test_authenticated_request_returns_200_with_series_and_meta(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/delivery/timeseries');
        $response->assertStatus(200);
        $response->assertJsonStructure(['series', 'meta']);
        $response->assertJsonPath('meta.period', 'week');
        $response->assertJsonPath('meta.attribution_authority', 'org');
    }

    public function test_returns_observed_delivery_data_with_correct_counts(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $weekStart = now()->startOfWeek();
        $this->insertDeployment(['deployed_at' => $weekStart, 'deployment_status' => 'success']);
        $this->insertDeployment(['deployed_at' => $weekStart->addDay(), 'deployment_status' => 'failure']);
        $this->insertPullRequest(['merged_at' => $weekStart->addDay()]);

        $response = $this->withToken($token)->getJson('/api/delivery/timeseries');
        $response->assertStatus(200);

        $series = $response->json('series');
        $this->assertNotEmpty($series);

        $totalDeploys = array_sum(array_column($series, 'deployment_count'));
        $totalSuccess = array_sum(array_column($series, 'successful_deployment_count'));
        $totalFailed = array_sum(array_column($series, 'failed_deployment_count'));
        $totalMergedPRs = array_sum(array_column($series, 'merged_pr_count'));

        $this->assertEquals(2, $totalDeploys);
        $this->assertEquals(1, $totalSuccess);
        $this->assertEquals(1, $totalFailed);
        $this->assertEquals(1, $totalMergedPRs);

        // Every row must have count_authority = observed_rows
        foreach ($series as $row) {
            $this->assertEquals('observed_rows', $row['count_authority']);
        }
    }

    public function test_repo_filter_sets_attribution_authority_to_repo(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertDeployment(['repo_name' => 'repo-a']);
        $this->insertDeployment(['repo_name' => 'repo-b']);

        $response = $this->withToken($token)->getJson('/api/delivery/timeseries?repo=repo-a');
        $response->assertStatus(200);
        $response->assertJsonPath('meta.repo', 'repo-a');
        $response->assertJsonPath('meta.attribution_authority', 'repo');
    }

    public function test_no_repo_filter_sets_attribution_authority_to_org(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/delivery/timeseries');
        $response->assertStatus(200);
        $response->assertJsonPath('meta.attribution_authority', 'org');
        $response->assertJsonPath('meta.repo', null);
    }

    public function test_date_from_filter_excludes_earlier_data(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $oldDate = now()->subWeeks(4)->startOfWeek();
        $newDate = now()->startOfWeek();

        $this->insertDeployment(['deployed_at' => $oldDate]);
        $this->insertDeployment(['deployed_at' => $newDate]);

        $fromFilter = now()->subWeeks(2)->format('Y-m-d');
        $response = $this->withToken($token)->getJson("/api/delivery/timeseries?from={$fromFilter}");
        $response->assertStatus(200);

        $series = $response->json('series');
        $totalDeploys = array_sum(array_column($series, 'deployment_count'));
        $this->assertEquals(1, $totalDeploys); // only the recent one
    }

    public function test_date_to_filter_excludes_later_data(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $oldDate = now()->subWeeks(4)->startOfWeek();
        $newDate = now()->startOfWeek();

        $this->insertDeployment(['deployed_at' => $oldDate]);
        $this->insertDeployment(['deployed_at' => $newDate]);

        $toFilter = now()->subWeeks(2)->format('Y-m-d');
        $response = $this->withToken($token)->getJson("/api/delivery/timeseries?to={$toFilter}");
        $response->assertStatus(200);

        $series = $response->json('series');
        $totalDeploys = array_sum(array_column($series, 'deployment_count'));
        $this->assertEquals(1, $totalDeploys); // only the old one
    }

    public function test_repo_filter_excludes_other_repos(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertDeployment(['repo_name' => 'repo-a']);
        $this->insertDeployment(['repo_name' => 'repo-b']);
        $this->insertDeployment(['repo_name' => 'repo-b']);

        $response = $this->withToken($token)->getJson('/api/delivery/timeseries?repo=repo-b');
        $response->assertStatus(200);

        $series = $response->json('series');
        $totalDeploys = array_sum(array_column($series, 'deployment_count'));
        $this->assertEquals(2, $totalDeploys); // only repo-b deployments
    }

    public function test_merge_cycle_hours_calculated_from_created_to_merged(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $mergedAt = now()->startOfWeek();
        $createdAt = $mergedAt->copy()->subHours(48);

        $this->insertPullRequest([
            'merged_at' => $mergedAt,
            'created_at' => $createdAt,
        ]);

        $response = $this->withToken($token)->getJson('/api/delivery/timeseries');
        $response->assertStatus(200);

        $series = $response->json('series');
        $this->assertNotEmpty($series);

        $rowWithCycle = array_filter($series, fn($r) => $r['median_merge_cycle_hours'] !== null);
        $this->assertNotEmpty($rowWithCycle);

        $row = array_values($rowWithCycle)[0];
        $this->assertEqualsWithDelta(48.0, $row['median_merge_cycle_hours'], 1.0, 'Merge cycle should be ~48 hours');
    }

    public function test_deploy_success_rate_calculated_correctly(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $weekStart = now()->startOfWeek();
        $this->insertDeployment(['deployed_at' => $weekStart, 'deployment_status' => 'success']);
        $this->insertDeployment(['deployed_at' => $weekStart->copy()->addHours(1), 'deployment_status' => 'success']);
        $this->insertDeployment(['deployed_at' => $weekStart->copy()->addHours(2), 'deployment_status' => 'failure']);

        $response = $this->withToken($token)->getJson('/api/delivery/timeseries');
        $response->assertStatus(200);

        $series = $response->json('series');
        $row = $series[0] ?? null;
        $this->assertNotNull($row);
        $this->assertEquals(3, $row['deployment_count']);
        $this->assertEquals(2, $row['successful_deployment_count']);
        $this->assertEquals(1, $row['failed_deployment_count']);
        $this->assertEqualsWithDelta(66.67, $row['deploy_success_rate'], 0.5, 'Success rate should be ~66.67%');
    }

    public function test_empty_data_returns_empty_series_not_error(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/delivery/timeseries');
        $response->assertStatus(200);
        $response->assertJsonPath('series', []);
        $response->assertJsonPath('meta.total_weeks', 0);
    }

    public function test_meta_contains_source_field(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/delivery/timeseries');
        $response->assertStatus(200);
        // Testing env is not 'local', so source = 'live'
        $response->assertJsonPath('meta.source', 'live');
    }

    public function test_seeded_demo_data_excluded_in_live_mode(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Insert a real (github_api_sync) deployment
        $this->insertDeployment(['deployed_at' => now()->startOfWeek()]);
        // Insert a seeded (demo) deployment — must be excluded
        $this->insertDeployment([
            'deployed_at' => now()->startOfWeek()->addDay(),
            'metadata' => ['source' => 'demo'],
        ]);
        // Insert a cm_activity_sim deployment — must be excluded in live mode
        $this->insertDeployment([
            'deployed_at' => now()->startOfWeek()->addDays(2),
            'metadata' => ['source' => 'cm_activity_sim'],
        ]);

        $response = $this->withToken($token)->getJson('/api/delivery/timeseries');
        $response->assertStatus(200);

        $series = $response->json('series');
        $totalDeploys = array_sum(array_column($series, 'deployment_count'));
        $this->assertEquals(1, $totalDeploys, 'Only github_api_sync deployment should be counted');
    }

    public function test_seeded_pr_data_excluded_in_live_mode(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Real PR
        $this->insertPullRequest(['merged_at' => now()->startOfWeek()]);
        // Seeded PR — must be excluded
        $this->insertPullRequest([
            'merged_at' => now()->startOfWeek()->addDay(),
            'data_source' => 'demo',
        ]);
        // cm_activity_sim PR — must be excluded in live mode
        $this->insertPullRequest([
            'merged_at' => now()->startOfWeek()->addDays(2),
            'data_source' => 'cm_activity_sim',
        ]);

        $response = $this->withToken($token)->getJson('/api/delivery/timeseries');
        $response->assertStatus(200);

        $series = $response->json('series');
        $totalPRs = array_sum(array_column($series, 'merged_pr_count'));
        $this->assertEquals(1, $totalPRs, 'Only github_api_sync PR should be counted');
    }
}
