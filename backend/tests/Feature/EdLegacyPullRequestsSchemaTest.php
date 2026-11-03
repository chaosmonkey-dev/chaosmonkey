<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\Organization;
use App\Models\PullRequest;
use App\Models\ApiToken;
use App\Models\User;
use App\Console\Commands\GitHubSyncPullRequests;
use App\Console\Commands\GitHubBackfillPRReviewMetrics;
use App\Console\Commands\GitHubBackfillPRReopenMetrics;
use App\Http\Controllers\PullRequestController;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Config;
use Carbon\Carbon;

/**
 * CR-X 5A: Verify that the latest product source runs safely against
 * Priority Dispatch's legacy `pull_requests` schema, which is missing the
 * optional enrichment columns: additions, deletions, first_review_at,
 * unique_reviewer_count, pr_reopened_count.
 */
class EdLegacyPullRequestsSchemaTest extends TestCase
{
    use RefreshDatabase;

    private const MISSING_COLUMNS = [
        'additions',
        'deletions',
        'first_review_at',
        'unique_reviewer_count',
        'pr_reopened_count',
    ];

    private function installLegacyPullRequestsSchema(): void
    {
        // CR-X 5A: Re-create pull_requests with Ed's current (legacy) schema,
        // which omits the five optional enrichment columns. This is safer than
        // dropping columns because it also removes any indexes on them.
        Schema::dropIfExists('pull_requests');
        Schema::create('pull_requests', function ($table) {
            $table->id();
            $table->string('repo_name')->nullable();
            $table->integer('pr_number')->nullable();
            $table->string('developer_id')->nullable();
            $table->timestamp('merged_at')->nullable();
            $table->integer('comments_count')->nullable();
            $table->integer('review_count')->nullable();
            $table->boolean('cursor_usage_detected')->default(false);
            $table->timestamps();
            $table->integer('changed_files')->nullable();
            $table->integer('review_comments')->nullable();
            $table->string('user_login')->nullable();
            $table->string('data_source')->nullable();
            $table->string('team_name')->nullable();
        });
    }

    private function createApiTokenForOrg(Organization $org): string
    {
        $user = User::factory()->create(['organization_id' => $org->id]);
        $token = ApiToken::generateDashboardToken($user->id, $org->id);
        return $token['raw'];
    }

    private function insertMergedPr(string $repo = 'prioritydispatch/test-repo', int $prNumber = 1, ?int $additions = null, ?int $deletions = null): PullRequest
    {
        $data = [
            'repo_name' => $repo,
            'pr_number' => $prNumber,
            'developer_id' => 'dev-1',
            'merged_at' => Carbon::now()->subDay(),
            'comments_count' => 2,
            'review_count' => 1,
            'cursor_usage_detected' => false,
            'created_at' => Carbon::now()->subDays(2),
            'updated_at' => Carbon::now()->subDay(),
            'changed_files' => 5,
            'review_comments' => 1,
            'user_login' => 'dev-1',
            'data_source' => 'github_api_sync',
        ];

        if ($additions !== null) {
            $data['additions'] = $additions;
        }
        if ($deletions !== null) {
            $data['deletions'] = $deletions;
        }

        return PullRequest::create($data);
    }

    private function invokePrivateMethod(object $object, string $method, array $args = [])
    {
        $reflection = new \ReflectionMethod(get_class($object), $method);
        $reflection->setAccessible(true);
        return $reflection->invoke($object, ...$args);
    }

    /**
     * Old schema: /api/metrics must not throw even though optional PR
     * enrichment columns are absent. The response should still be 200 and
     * contain the core PR/merge evidence fields.
     */
    public function test_metrics_does_not_500_with_legacy_schema(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createApiTokenForOrg($org);

        $this->installLegacyPullRequestsSchema();

        $this->insertMergedPr();

        $response = $this->withToken($token)->getJson('/api/metrics?time_filter=all&nocache=1');

        $response->assertStatus(200);
        // Core PR analytics block must be present and not throw; the exact
        // counts depend on repo attribution and whether the PR matches the
        // active repo filter, which is not the point of this test.
        $this->assertArrayHasKey('pr_analytics', $response->json());
        $this->assertArrayHasKey('total_prs', $response->json('pr_analytics') ?? []);    }

    /**
     * Old schema: PR-size enrichment must return the unavailable
     * representation (null medians and zero bucket counts) instead of
     * inventing zeros or selecting missing columns.
     */
    public function test_pr_size_merge_cycle_unavailable_on_legacy_schema(): void
    {
        $org = Organization::factory()->create();

        $this->installLegacyPullRequestsSchema();

        // Merged PR without size columns
        $this->insertMergedPr();

        $controller = new PullRequestController();
        $result = $this->invokePrivateMethod($controller, 'calculatePRSizeMergeCycle', [collect()]);

        $this->assertSame(0, $result['small_n']);
        $this->assertNull($result['small_median_hours']);
        $this->assertSame(0, $result['large_n']);
        $this->assertNull($result['large_median_hours']);
        $this->assertNull($result['ratio']);
        // We can still count that a PR was merged without needing size data.
        $this->assertGreaterThanOrEqual(1, $result['merged_total']);
    }

    /**
     * Old schema: github:sync-prs must create a PR without attempting to
     * write the missing enrichment columns.
     */
    public function test_pr_sync_does_not_write_missing_columns_on_legacy_schema(): void
    {
        $org = Organization::factory()->create();

        $this->installLegacyPullRequestsSchema();

        $command = new GitHubSyncPullRequests();
        $command->setLaravel($this->app);
        $command->setOutput(new \Illuminate\Console\OutputStyle(
            new \Symfony\Component\Console\Input\StringInput(''),
            new \Symfony\Component\Console\Output\NullOutput()
        ));

        $prFixture = [
            'number' => 1,
            'merged_at' => Carbon::now()->subDay()->toIso8601String(),
            'created_at' => Carbon::now()->subDays(2)->toIso8601String(),
            'updated_at' => Carbon::now()->subDay()->toIso8601String(),
            'comments' => 2,
            'review_comments' => 1,
            'additions' => 50,
            'deletions' => 30,
            'changed_files' => 5,
            'user' => ['login' => 'dev-1'],
        ];

        $this->invokePrivateMethod($command, 'createPRFromGitHub', ['prioritydispatch/test-repo', $prFixture]);

        $created = PullRequest::where('repo_name', 'prioritydispatch/test-repo')
            ->where('pr_number', 1)
            ->first();

        $this->assertNotNull($created);
        $this->assertSame('github_api_sync', $created->data_source);
        $this->assertSame(1, $created->review_count);
        // Missing columns must not be set to avoid SQL errors.
        $this->assertFalse(Schema::hasColumn('pull_requests', 'additions'));
    }

    /**
     * Old schema: github:backfill-pr-review-metrics must exit cleanly with
     * a capability-unavailable message instead of throwing SQL errors.
     */
    public function test_pr_review_backfill_fails_closed_on_legacy_schema(): void
    {
        Organization::factory()->create();

        $this->installLegacyPullRequestsSchema();

        $exitCode = Artisan::call('github:backfill-pr-review-metrics', [
            '--days' => 30,
            '--limit' => 10,
        ]);

        $this->assertSame(0, $exitCode);
        $this->assertStringContainsString('does not support PR review-metric columns', Artisan::output());
    }

    /**
     * Old schema: github:backfill-pr-reopen-metrics must exit cleanly with
     * a capability-unavailable message instead of throwing SQL errors.
     */
    public function test_pr_reopen_backfill_fails_closed_on_legacy_schema(): void
    {
        Organization::factory()->create();

        $this->installLegacyPullRequestsSchema();

        $exitCode = Artisan::call('github:backfill-pr-reopen-metrics', [
            '--days' => 30,
            '--limit' => 10,
        ]);

        $this->assertSame(0, $exitCode);
        $this->assertStringContainsString('does not support PR reopen-metric column', Artisan::output());
    }

    /**
     * Full schema: PR-size merge cycle still works and correctly buckets
     * small/large PRs when the optional size columns are present.
     */
    public function test_pr_size_merge_cycle_computes_with_full_schema(): void
    {
        $org = Organization::factory()->create();

        // Small PR (< 200 changes)
        $this->insertMergedPr('prioritydispatch/small', 1, 50, 30);
        // Large PR (>= 200 changes)
        $this->insertMergedPr('prioritydispatch/large', 2, 150, 150);

        $controller = new PullRequestController();
        $result = $this->invokePrivateMethod($controller, 'calculatePRSizeMergeCycle', [collect()]);

        $this->assertSame(1, $result['small_n']);
        $this->assertSame(1, $result['large_n']);
        $this->assertNotNull($result['small_median_hours']);
        $this->assertNotNull($result['large_median_hours']);
        $this->assertSame(2, $result['merged_total']);
    }

    /**
     * Old schema: optional PR review/reopen enrichment must be unavailable
     * (null), never observed zero.
     */
    public function test_pr_review_metrics_unavailable_on_legacy_schema(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createApiTokenForOrg($org);

        $this->installLegacyPullRequestsSchema();
        $this->insertMergedPr();

        $response = $this->withToken($token)->getJson('/api/metrics?time_filter=all&nocache=1');

        $response->assertStatus(200);
        $response->assertJsonPath('pr_review_metrics.unique_reviewer_count', null);
        $response->assertJsonPath('pr_review_metrics.pr_reopened_count', null);
        $response->assertJsonPath('pr_review_metrics.first_review_at', null);
        // review_count and total_prs are core evidence and remain truthfully computed.
        $this->assertIsInt($response->json('pr_review_metrics.review_count'));
        $this->assertIsInt($response->json('pr_review_metrics.total_prs'));
    }

    /**
     * Full schema: genuinely observed zero is preserved, not collapsed to null.
     */
    public function test_pr_review_metrics_preserves_observed_zero_on_full_schema(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createApiTokenForOrg($org);

        PullRequest::create([
            'repo_name' => 'prioritydispatch/test-repo',
            'pr_number' => 1,
            'developer_id' => 'dev-1',
            'merged_at' => Carbon::now()->subDay(),
            'comments_count' => 2,
            'review_count' => 1,
            'cursor_usage_detected' => false,
            'created_at' => Carbon::now()->subDays(2),
            'updated_at' => Carbon::now()->subDay(),
            'changed_files' => 5,
            'review_comments' => 1,
            'user_login' => 'dev-1',
            'data_source' => 'github_api_sync',
            'unique_reviewer_count' => 0,
            'pr_reopened_count' => 0,
        ]);

        $response = $this->withToken($token)->getJson('/api/metrics?time_filter=all&nocache=1');

        $response->assertStatus(200);
        $response->assertJsonPath('pr_review_metrics.unique_reviewer_count', 0);
        $response->assertJsonPath('pr_review_metrics.pr_reopened_count', 0);
    }

    /**
     * Old schema: delivery timeseries must not fabricate a zero reopened count.
     */
    public function test_delivery_timeseries_reopen_unavailable_on_legacy_schema(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createApiTokenForOrg($org);

        $this->installLegacyPullRequestsSchema();
        $this->insertMergedPr();

        $from = Carbon::now()->subDays(7)->toDateString();
        $to = Carbon::now()->toDateString();
        $response = $this->withToken($token)->getJson("/api/delivery/timeseries?from={$from}&to={$to}");

        $response->assertStatus(200);
        $this->assertNotEmpty($response->json('series'));
        $first = $response->json('series')[0];
        $this->assertNull($first['pr_reopened_count']);
        $this->assertNull($first['pr_review_cycles']);
        // review_count is truthfully computed from the existing column.
        $this->assertIsInt($first['review_count']);
    }

    /**
     * Full schema: delivery timeseries preserves an observed zero reopen count.
     */
    public function test_delivery_timeseries_preserves_observed_zero_on_full_schema(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createApiTokenForOrg($org);

        PullRequest::create([
            'repo_name' => 'prioritydispatch/test-repo',
            'pr_number' => 1,
            'developer_id' => 'dev-1',
            'merged_at' => Carbon::now()->subDay(),
            'comments_count' => 2,
            'review_count' => 1,
            'cursor_usage_detected' => false,
            'created_at' => Carbon::now()->subDays(2),
            'updated_at' => Carbon::now()->subDay(),
            'changed_files' => 5,
            'review_comments' => 1,
            'user_login' => 'dev-1',
            'data_source' => 'github_api_sync',
            'pr_reopened_count' => 0,
        ]);

        $from = Carbon::now()->subDays(7)->toDateString();
        $to = Carbon::now()->toDateString();
        $response = $this->withToken($token)->getJson("/api/delivery/timeseries?from={$from}&to={$to}");

        $response->assertStatus(200);
        $first = $response->json('series')[0];
        $this->assertSame(0, $first['pr_reopened_count']);
        $this->assertNotNull($first['pr_review_cycles']);
        $this->assertIsInt($first['review_count']);
    }
}
