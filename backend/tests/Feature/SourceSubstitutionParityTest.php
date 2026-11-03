<?php

namespace Tests\Feature;

use App\Http\Controllers\PullRequestController;
use App\Models\Deployment;
use App\Models\Organization;
use App\Models\PullRequest;
use App\Models\Release;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * CR-X 3D: Backend source-substitution numeric parity.
 *
 * Proves that equivalent business facts produce equivalent numeric
 * metrics from the real backend consumers, regardless of whether
 * the provenance is Local seeded (cm_activity_sim) or live-authorized
 * (github_api_sync + engineering_integration).
 *
 * The underlying measured numbers should match. Allow differences
 * only in provenance/source labels and auth state.
 *
 * Tests run against an isolated in-memory SQLite database.
 * No DB writes to Local authority.
 */
class SourceSubstitutionParityTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->assertTrue(app()->environment('testing'));
        $this->assertEquals('sqlite', config('database.default'));
        $this->assertEquals(':memory:', config('database.connections.sqlite.database'));

        $this->createTables();
        $this->seedFixture();
    }

    protected function tearDown(): void
    {
        if (app()->environment('testing')
            && config('database.default') === 'sqlite'
            && config('database.connections.sqlite.database') === ':memory:'
        ) {
            Schema::dropIfExists('releases');
            Schema::dropIfExists('deployments');
            Schema::dropIfExists('pull_requests');
            Schema::dropIfExists('oauth_tokens');
            Schema::dropIfExists('organizations');
        }
        parent::tearDown();
    }

    private function createTables(): void
    {
        if (!Schema::hasTable('organizations')) {
            Schema::create('organizations', function ($table) {
                $table->id();
                $table->string('name');
                $table->string('slug')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('oauth_tokens')) {
            Schema::create('oauth_tokens', function ($table) {
                $table->id();
                $table->string('user_id')->nullable();
                $table->foreignId('organization_id')->nullable();
                $table->string('access_token')->nullable();
                $table->string('oauth_state', 64)->nullable();
                $table->json('user_data')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('pull_requests')) {
            Schema::create('pull_requests', function ($table) {
                $table->id();
                $table->string('repo_name')->nullable();
                $table->integer('pr_number')->nullable();
                $table->string('developer_id')->nullable();
                $table->timestamp('merged_at')->nullable();
                $table->integer('review_count')->nullable();
                $table->timestamp('first_review_at')->nullable();
                $table->integer('unique_reviewer_count')->default(0);
                $table->integer('pr_reopened_count')->default(0);
                $table->integer('additions')->default(0);
                $table->integer('deletions')->default(0);
                $table->integer('changed_files')->default(0);
                $table->string('user_login')->nullable();
                $table->string('data_source')->default('demo');
                $table->string('team_name')->nullable();
                $table->json('metadata')->nullable();
                $table->foreignId('organization_id')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('deployments')) {
            Schema::create('deployments', function ($table) {
                $table->id();
                $table->string('repo_name')->nullable();
                $table->string('commit_sha')->nullable();
                $table->string('deployment_status')->nullable();
                $table->string('environment')->nullable();
                $table->datetime('deployed_at')->nullable();
                $table->json('metadata')->nullable();
                $table->foreignId('organization_id')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('releases')) {
            Schema::create('releases', function ($table) {
                $table->id();
                $table->string('repo_name');
                $table->bigInteger('release_id')->nullable();
                $table->string('tag_name');
                $table->string('release_name')->nullable();
                $table->datetime('published_at')->nullable();
                $table->string('author_login')->nullable();
                $table->json('metadata')->nullable();
                $table->timestamps();
                $table->index(['repo_name', 'release_id']);
                $table->index('published_at');
            });
        }
    }

    private Organization $org;

    private function seedFixture(): void
    {
        $this->org = Organization::create([
            'name' => 'Parity Test Org',
            'slug' => 'parity-test',
        ]);
    }

    /**
     * Seed equivalent PR facts with a given data_source.
     * 27 PRs, 18 merged, review_count totals 72, reopened totals 6.
     */
    private function seedPRs(string $dataSource): void
    {
        for ($i = 1; $i <= 27; $i++) {
            $merged = $i <= 18;
            PullRequest::create([
                'repo_name' => 'mattmcclintock/cm-activity-sim',
                'pr_number' => $i,
                'developer_id' => 'dev1',
                'merged_at' => $merged ? "2026-06-{$i} 12:00:00" : null,
                'review_count' => $i <= 21 ? 3 : 0,
                'unique_reviewer_count' => 2,
                'pr_reopened_count' => $i <= 6 ? 1 : 0,
                'data_source' => $dataSource,
                'organization_id' => $this->org->id,
                'created_at' => "2026-06-" . str_pad((string)$i, 2, '0', STR_PAD_LEFT) . " 10:00:00",
                'updated_at' => now(),
            ]);
        }
    }

    /**
     * Seed equivalent deployment facts with a given metadata.source.
     * 25 deployments: 23 success, 2 failure, 20 production, 5 staging.
     */
    private function seedDeployments(string $metaSource): void
    {
        for ($i = 1; $i <= 25; $i++) {
            $isFailure = $i > 23;
            $isProduction = $i <= 20;
            Deployment::create([
                'repo_name' => 'mattmcclintock/cm-activity-sim',
                'deployment_status' => $isFailure ? 'failure' : 'success',
                'environment' => $isProduction ? 'production' : 'staging',
                'deployed_at' => "2026-06-" . str_pad((string)(($i % 30) + 1), 2, '0', STR_PAD_LEFT) . " 14:00:00",
                'metadata' => ['source' => $metaSource],
                'organization_id' => $this->org->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    /**
     * Seed equivalent release facts with a given metadata key.
     * 6 releases in June 2026.
     */
    private function seedReleases(string $metaKey, string $metaValue): void
    {
        for ($i = 1; $i <= 6; $i++) {
            Release::create([
                'repo_name' => 'mattmcclintock/cm-activity-sim',
                'tag_name' => "v1.{$i}.0",
                'published_at' => "2026-06-" . str_pad((string)($i * 4), 2, '0', STR_PAD_LEFT) . " 12:00:00",
                'author_login' => 'test-author',
                'metadata' => [$metaKey => $metaValue],
                'organization_id' => $this->org->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    private function callCalculateReleaseMetrics(?array $oauthUser, bool $isLocal, ?array $repoAllowList = null): array
    {
        $controller = new PullRequestController();
        $origEnv = config('app.env');
        config(['app.env' => $isLocal ? 'local' : 'production']);
        $reflection = new \ReflectionMethod($controller, 'calculateReleaseMetrics');
        $reflection->setAccessible(true);
        $result = $reflection->invoke($controller, null, 'all', $repoAllowList, $oauthUser);
        config(['app.env' => $origEnv]);
        return $result;
    }

    private function callAggregateOutcomesByMonth(bool $isLocal, ?array $repoAllowList = null, ?array $oauthUser = null): array
    {
        $controller = new PullRequestController();
        $origEnv = config('app.env');
        config(['app.env' => $isLocal ? 'local' : 'production']);
        $reflection = new \ReflectionMethod($controller, 'aggregateOutcomesByMonth');
        $reflection->setAccessible(true);
        $result = $reflection->invoke($controller, $repoAllowList, $oauthUser);
        config(['app.env' => $origEnv]);
        return $result;
    }

    // ====================================================================
    // Backend numeric parity — outcomes_by_month
    // ====================================================================

    public function test_outcomes_by_month_parity_pr_counts(): void
    {
        // Local seeded
        $this->seedPRs('cm_activity_sim');
        $this->seedDeployments('cm_activity_sim');
        $this->seedReleases('source', 'cm_activity_sim');
        $localResult = $this->callAggregateOutcomesByMonth(true);

        // Reset for live
        PullRequest::query()->delete();
        Deployment::query()->delete();
        Release::query()->delete();

        // Live authorized
        $this->seedPRs('github_api_sync');
        $this->seedDeployments('github_api_sync');
        $this->seedReleases('data_source', 'github_api_sync');
        $oauthUser = ['login' => 'mattmcclintock', 'token_purpose' => 'engineering_integration'];
        $liveResult = $this->callAggregateOutcomesByMonth(false, ['mattmcclintock/cm-activity-sim'], $oauthUser);

        // Compare numeric fields (not provenance labels)
        $localJune = collect($localResult)->firstWhere('month', '2026-06');
        $liveJune = collect($liveResult)->firstWhere('month', '2026-06');

        $this->assertNotNull($localJune);
        $this->assertNotNull($liveJune);
        $this->assertEquals($localJune['merged_pr_count'], $liveJune['merged_pr_count']);
        $this->assertEquals($localJune['total_pr_count'], $liveJune['total_pr_count']);
        $this->assertEquals($localJune['deployment_count'], $liveJune['deployment_count']);
        $this->assertEquals($localJune['successful_deployment_count'], $liveJune['successful_deployment_count']);
        $this->assertEquals($localJune['failed_deployment_count'], $liveJune['failed_deployment_count']);
        $this->assertEquals($localJune['release_count'], $liveJune['release_count']);
    }

    // ====================================================================
    // Backend numeric parity — calculateReleaseMetrics
    // ====================================================================

    public function test_release_metrics_parity(): void
    {
        // Local seeded
        $this->seedReleases('source', 'cm_activity_sim');
        $localResult = $this->callCalculateReleaseMetrics(null, true);

        Release::query()->delete();

        // Live authorized — use data_source key (real sync convention)
        $this->seedReleases('data_source', 'github_api_sync');
        $oauthUser = ['login' => 'mattmcclintock', 'token_purpose' => 'engineering_integration'];
        $liveResult = $this->callCalculateReleaseMetrics($oauthUser, false, ['mattmcclintock/cm-activity-sim']);

        $this->assertEquals($localResult['total_releases'], $liveResult['total_releases']);
        $this->assertEquals($localResult['releases_in_period'], $liveResult['releases_in_period']);
        $this->assertNotNull($localResult['latest_release']);
        $this->assertNotNull($liveResult['latest_release']);
    }

    // ====================================================================
    // Backend numeric parity — release metrics with source key (live)
    // ====================================================================

    public function test_release_metrics_parity_with_source_key(): void
    {
        // Local seeded
        $this->seedReleases('source', 'cm_activity_sim');
        $localResult = $this->callCalculateReleaseMetrics(null, true);

        Release::query()->delete();

        // Live authorized — use source key
        $this->seedReleases('source', 'github_api_sync');
        $oauthUser = ['login' => 'mattmcclintock', 'token_purpose' => 'engineering_integration'];
        $liveResult = $this->callCalculateReleaseMetrics($oauthUser, false, ['mattmcclintock/cm-activity-sim']);

        $this->assertEquals($localResult['total_releases'], $liveResult['total_releases']);
    }

    // ====================================================================
    // Empty pilot — no evidence yields zero metrics
    // ====================================================================

    public function test_empty_pilot_yields_zero_release_metrics(): void
    {
        // No releases at all
        $localResult = $this->callCalculateReleaseMetrics(null, true);
        $this->assertEquals(0, $localResult['total_releases']);
        $this->assertNull($localResult['latest_release']);

        $liveResult = $this->callCalculateReleaseMetrics(
            ['login' => 'mattmcclintock', 'token_purpose' => 'engineering_integration'],
            false,
            ['mattmcclintock/cm-activity-sim']
        );
        $this->assertEquals(0, $liveResult['total_releases']);
    }

    public function test_empty_pilot_yields_empty_outcomes_by_month(): void
    {
        $localResult = $this->callAggregateOutcomesByMonth(true);
        $this->assertEmpty($localResult);
    }
}
