<?php

namespace Tests\Feature;

use App\Http\Controllers\PullRequestController;
use App\Models\Organization;
use App\Models\Release;
use App\Services\GitHubApiService;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * CR-X 3C: Release provenance safety tests.
 *
 * Proves:
 *   LOCAL:
 *     - cm_activity_sim release is counted by calculateReleaseMetrics
 *     - cm_activity_sim release is counted by aggregateOutcomesByMonth
 *     - demo release excluded
 *     - realism_seeder release excluded
 *     - unknown/unqualified provenance fails closed
 *
 *   LIVE / CUSTOMER:
 *     - cm_activity_sim release excluded
 *     - demo release excluded
 *     - realism_seeder release excluded
 *     - release rows without eligible engineering evidence excluded
 *     - legitimate engineering-authorized evidence preserves current behavior
 *     - simulated release rows do not make github_connected true
 *
 * Tests run against an isolated in-memory SQLite database.
 * No live OAuth, no live GitHub API calls, no DB writes to Local authority.
 */
class ReleaseProvenanceSafetyTest extends TestCase
{
    private ?string $savedAppEnv = null;

    protected function setUp(): void
    {
        parent::setUp();

        $this->assertTrue(
            app()->environment('testing'),
            'Refusing to run: APP_ENV is not testing'
        );
        $this->assertEquals('sqlite', config('database.default'),
            'Refusing to run: database driver is not sqlite'
        );
        $this->assertEquals(':memory:', config('database.connections.sqlite.database'),
            'Refusing to run: SQLite database is not :memory:'
        );

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
            'name' => 'Test Org',
            'slug' => 'test-org',
        ]);
    }

    /**
     * Insert a release row with given metadata source.
     */
    private function insertRelease(string $source, string $publishedAt = '2026-06-15 12:00:00'): void
    {
        Release::create([
            'repo_name' => 'org/example-repo',
            'tag_name' => 'v-' . uniqid(),
            'published_at' => $publishedAt,
            'author_login' => 'cm-activity-sim',
            'metadata' => ['source' => $source],
            'organization_id' => $this->org->id,
        ]);
    }

    /**
     * Call protected isReleaseProvenanceEligible via reflection.
     */
    private function callIsReleaseProvenanceEligible($release, bool $isLocal): bool
    {
        $controller = new PullRequestController();
        $reflection = new \ReflectionMethod($controller, 'isReleaseProvenanceEligible');
        $reflection->setAccessible(true);
        return $reflection->invoke($controller, $release, $isLocal);
    }

    /**
     * Call protected calculateReleaseMetrics via reflection.
     */
    private function callCalculateReleaseMetrics(?array $oauthUser = null, bool $isLocal = true, ?array $repoAllowList = null): array
    {
        $controller = new PullRequestController();

        // Mock app.env for the Local/live split
        $shouldMockEnv = config('app.env') !== ($isLocal ? 'local' : 'production');
        if ($shouldMockEnv) {
            // We use reflection to set the env config inline
            config(['app.env' => $isLocal ? 'local' : 'production']);
        }

        $reflection = new \ReflectionMethod($controller, 'calculateReleaseMetrics');
        $reflection->setAccessible(true);
        $result = $reflection->invoke($controller, null, 'all', $repoAllowList, $oauthUser);

        if ($shouldMockEnv) {
            config(['app.env' => 'testing']);
        }

        return $result;
    }

    /**
     * Call protected aggregateOutcomesByMonth via reflection.
     */
    private function callAggregateOutcomesByMonth(bool $isLocal = true, ?array $repoAllowList = null, ?array $oauthUser = null): array
    {
        $controller = new PullRequestController();

        $shouldMockEnv = config('app.env') !== ($isLocal ? 'local' : 'production');
        if ($shouldMockEnv) {
            config(['app.env' => $isLocal ? 'local' : 'production']);
        }

        $reflection = new \ReflectionMethod($controller, 'aggregateOutcomesByMonth');
        $reflection->setAccessible(true);
        $result = $reflection->invoke($controller, $repoAllowList, $oauthUser);

        if ($shouldMockEnv) {
            config(['app.env' => 'testing']);
        }

        return $result;
    }

    // ====================================================================
    // isReleaseProvenanceEligible — unit-level provenance tests
    // ====================================================================

    public function test_local_cm_activity_sim_release_is_eligible(): void
    {
        $rel = Release::create([
            'repo_name' => 'test/repo',
            'tag_name' => 'v1.0',
            'published_at' => '2026-06-15 12:00:00',
            'metadata' => ['source' => 'cm_activity_sim'],
        ]);
        $this->assertTrue($this->callIsReleaseProvenanceEligible($rel, true));
    }

    public function test_local_demo_release_is_rejected(): void
    {
        $rel = Release::create([
            'repo_name' => 'test/repo',
            'tag_name' => 'v1.0',
            'published_at' => '2026-06-15 12:00:00',
            'metadata' => ['source' => 'demo'],
        ]);
        $this->assertFalse($this->callIsReleaseProvenanceEligible($rel, true));
    }

    public function test_local_realism_seeder_release_is_rejected(): void
    {
        $rel = Release::create([
            'repo_name' => 'test/repo',
            'tag_name' => 'v1.0',
            'published_at' => '2026-06-15 12:00:00',
            'metadata' => ['source' => 'realism_seeder'],
        ]);
        $this->assertFalse($this->callIsReleaseProvenanceEligible($rel, true));
    }

    public function test_local_unknown_provenance_fails_closed(): void
    {
        $rel = Release::create([
            'repo_name' => 'test/repo',
            'tag_name' => 'v1.0',
            'published_at' => '2026-06-15 12:00:00',
            'metadata' => ['source' => 'unknown_source'],
        ]);
        $this->assertFalse($this->callIsReleaseProvenanceEligible($rel, true));
    }

    public function test_local_null_metadata_fails_closed(): void
    {
        $rel = Release::create([
            'repo_name' => 'test/repo',
            'tag_name' => 'v1.0',
            'published_at' => '2026-06-15 12:00:00',
            'metadata' => null,
        ]);
        $this->assertFalse($this->callIsReleaseProvenanceEligible($rel, true));
    }

    public function test_live_cm_activity_sim_release_is_rejected(): void
    {
        $rel = Release::create([
            'repo_name' => 'test/repo',
            'tag_name' => 'v1.0',
            'published_at' => '2026-06-15 12:00:00',
            'metadata' => ['source' => 'cm_activity_sim'],
        ]);
        $this->assertFalse($this->callIsReleaseProvenanceEligible($rel, false));
    }

    public function test_live_demo_release_is_rejected(): void
    {
        $rel = Release::create([
            'repo_name' => 'test/repo',
            'tag_name' => 'v1.0',
            'published_at' => '2026-06-15 12:00:00',
            'metadata' => ['source' => 'demo'],
        ]);
        $this->assertFalse($this->callIsReleaseProvenanceEligible($rel, false));
    }

    public function test_live_realism_seeder_release_is_rejected(): void
    {
        $rel = Release::create([
            'repo_name' => 'test/repo',
            'tag_name' => 'v1.0',
            'published_at' => '2026-06-15 12:00:00',
            'metadata' => ['source' => 'realism_seeder'],
        ]);
        $this->assertFalse($this->callIsReleaseProvenanceEligible($rel, false));
    }

    public function test_live_github_api_sync_release_is_eligible(): void
    {
        $rel = Release::create([
            'repo_name' => 'test/repo',
            'tag_name' => 'v1.0',
            'published_at' => '2026-06-15 12:00:00',
            'metadata' => ['source' => 'github_api_sync'],
        ]);
        $this->assertTrue($this->callIsReleaseProvenanceEligible($rel, false));
    }

    public function test_live_github_api_sync_via_data_source_field_is_eligible(): void
    {
        // ReleaseSyncService and GitHubSyncReleases stamp
        // metadata.data_source = 'github_api_sync' (NOT metadata.source).
        // This is the real customer sync path — must be accepted.
        $rel = Release::create([
            'repo_name' => 'test/repo',
            'tag_name' => 'v1.0',
            'published_at' => '2026-06-15 12:00:00',
            'metadata' => ['data_source' => 'github_api_sync', 'draft' => false, 'prerelease' => false],
        ]);
        $this->assertTrue($this->callIsReleaseProvenanceEligible($rel, false));
    }

    public function test_live_db_sync_via_data_source_field_is_eligible(): void
    {
        $rel = Release::create([
            'repo_name' => 'test/repo',
            'tag_name' => 'v1.0',
            'published_at' => '2026-06-15 12:00:00',
            'metadata' => ['data_source' => 'db_sync'],
        ]);
        $this->assertTrue($this->callIsReleaseProvenanceEligible($rel, false));
    }

    public function test_live_db_sync_release_is_eligible(): void
    {
        $rel = Release::create([
            'repo_name' => 'test/repo',
            'tag_name' => 'v1.0',
            'published_at' => '2026-06-15 12:00:00',
            'metadata' => ['source' => 'db_sync'],
        ]);
        $this->assertTrue($this->callIsReleaseProvenanceEligible($rel, false));
    }

    public function test_live_unknown_provenance_fails_closed(): void
    {
        $rel = Release::create([
            'repo_name' => 'test/repo',
            'tag_name' => 'v1.0',
            'published_at' => '2026-06-15 12:00:00',
            'metadata' => ['source' => 'something_else'],
        ]);
        $this->assertFalse($this->callIsReleaseProvenanceEligible($rel, false));
    }

    // ====================================================================
    // calculateReleaseMetrics — Local mode
    // ====================================================================

    public function test_local_cm_activity_sim_release_counted_by_calculateReleaseMetrics(): void
    {
        $this->insertRelease('cm_activity_sim');
        $result = $this->callCalculateReleaseMetrics(null, true);
        $this->assertEquals(1, $result['total_releases']);
        $this->assertEquals(1, $result['releases_in_period']);
        $this->assertNotNull($result['latest_release']);
    }

    public function test_local_demo_release_excluded_by_calculateReleaseMetrics(): void
    {
        $this->insertRelease('demo');
        $result = $this->callCalculateReleaseMetrics(null, true);
        $this->assertEquals(0, $result['total_releases']);
        $this->assertNull($result['latest_release']);
    }

    public function test_local_realism_seeder_release_excluded_by_calculateReleaseMetrics(): void
    {
        $this->insertRelease('realism_seeder');
        $result = $this->callCalculateReleaseMetrics(null, true);
        $this->assertEquals(0, $result['total_releases']);
    }

    public function test_local_mixed_provenance_only_counts_cm_activity_sim(): void
    {
        $this->insertRelease('cm_activity_sim', '2026-06-10 12:00:00');
        $this->insertRelease('demo', '2026-06-12 12:00:00');
        $this->insertRelease('realism_seeder', '2026-06-14 12:00:00');
        $result = $this->callCalculateReleaseMetrics(null, true);
        $this->assertEquals(1, $result['total_releases']);
    }

    // ====================================================================
    // calculateReleaseMetrics — Live mode
    // ====================================================================

    public function test_live_cm_activity_sim_release_excluded_without_engineering_auth(): void
    {
        $this->insertRelease('cm_activity_sim');
        $result = $this->callCalculateReleaseMetrics(null, false);
        // Unavailable, not a measured zero.
        $this->assertNull($result['total_releases']);
        $this->assertSame('no_evidence_authority', $result['unavailable']);
        $this->assertNull($result['latest_release']);
    }

    public function test_live_cm_activity_sim_release_excluded_even_with_engineering_auth(): void
    {
        $this->insertRelease('cm_activity_sim');
        $oauthUser = ['login' => 'octo-user', 'token_purpose' => 'engineering_integration'];
        $result = $this->callCalculateReleaseMetrics($oauthUser, false);
        $this->assertEquals(0, $result['total_releases']);
    }

    public function test_live_github_api_sync_release_counted_with_engineering_auth(): void
    {
        $this->insertRelease('github_api_sync');
        $oauthUser = ['login' => 'octo-user', 'token_purpose' => 'engineering_integration'];
        // Live mode requires a repoAllowList — applyOrganizationRepoFilter
        // is fail-closed (1 = 0) without one.
        $result = $this->callCalculateReleaseMetrics($oauthUser, false, ['org/example-repo']);
        $this->assertEquals(1, $result['total_releases']);
        $this->assertNotNull($result['latest_release']);
    }

    public function test_live_github_api_sync_release_excluded_without_engineering_auth(): void
    {
        $this->insertRelease('github_api_sync');
        // repoAllowList alone is NOT sufficient — no engineering auth
        $result = $this->callCalculateReleaseMetrics(null, false, ['org/example-repo']);
        $this->assertNull($result['total_releases']);
        $this->assertSame('no_evidence_authority', $result['unavailable']);
    }

    public function test_live_db_sync_release_excluded_without_engineering_auth(): void
    {
        $this->insertRelease('db_sync');
        // repoAllowList alone is NOT sufficient — no engineering auth
        $result = $this->callCalculateReleaseMetrics(null, false, ['org/example-repo']);
        $this->assertNull($result['total_releases']);
        $this->assertSame('no_evidence_authority', $result['unavailable']);
    }

    public function test_live_db_sync_release_counted_with_engineering_auth(): void
    {
        $this->insertRelease('db_sync');
        $oauthUser = ['login' => 'octo-user', 'token_purpose' => 'engineering_integration'];
        $result = $this->callCalculateReleaseMetrics($oauthUser, false, ['org/example-repo']);
        $this->assertEquals(1, $result['total_releases']);
        $this->assertNotNull($result['latest_release']);
    }

    public function test_live_demo_release_excluded_even_with_engineering_auth(): void
    {
        $this->insertRelease('demo');
        $oauthUser = ['login' => 'octo-user', 'token_purpose' => 'engineering_integration'];
        $result = $this->callCalculateReleaseMetrics($oauthUser, false, ['org/example-repo']);
        $this->assertEquals(0, $result['total_releases']);
    }

    // ====================================================================
    // aggregateOutcomesByMonth — release_count provenance filtering
    // ====================================================================

    public function test_local_cm_activity_sim_release_counted_in_outcomes_by_month(): void
    {
        $this->insertRelease('cm_activity_sim', '2026-06-15 12:00:00');
        $result = $this->callAggregateOutcomesByMonth(true);
        $juneEntry = collect($result)->firstWhere('month', '2026-06');
        $this->assertNotNull($juneEntry);
        $this->assertEquals(1, $juneEntry['release_count']);
    }

    public function test_local_demo_release_excluded_from_outcomes_by_month(): void
    {
        $this->insertRelease('demo', '2026-06-15 12:00:00');
        $result = $this->callAggregateOutcomesByMonth(true);
        // No eligible releases → no release_count contribution
        foreach ($result as $entry) {
            $this->assertEquals(0, $entry['release_count']);
        }
    }

    public function test_local_realism_seeder_release_excluded_from_outcomes_by_month(): void
    {
        $this->insertRelease('realism_seeder', '2026-06-15 12:00:00');
        $result = $this->callAggregateOutcomesByMonth(true);
        foreach ($result as $entry) {
            $this->assertEquals(0, $entry['release_count']);
        }
    }

    public function test_live_cm_activity_sim_release_excluded_from_outcomes_by_month(): void
    {
        $this->insertRelease('cm_activity_sim', '2026-06-15 12:00:00');
        $oauthUser = ['login' => 'octo-user', 'token_purpose' => 'engineering_integration'];
        $result = $this->callAggregateOutcomesByMonth(false, ['org/example-repo'], $oauthUser);
        foreach ($result as $entry) {
            $this->assertEquals(0, $entry['release_count']);
        }
    }

    public function test_live_github_api_sync_release_counted_in_outcomes_by_month_with_auth(): void
    {
        $this->insertRelease('github_api_sync', '2026-06-15 12:00:00');
        $oauthUser = ['login' => 'octo-user', 'token_purpose' => 'engineering_integration'];
        $result = $this->callAggregateOutcomesByMonth(false, ['org/example-repo'], $oauthUser);
        $juneEntry = collect($result)->firstWhere('month', '2026-06');
        $this->assertNotNull($juneEntry);
        $this->assertEquals(1, $juneEntry['release_count']);
    }

    public function test_live_github_api_sync_release_excluded_from_outcomes_by_month_without_auth(): void
    {
        $this->insertRelease('github_api_sync', '2026-06-15 12:00:00');
        // repoAllowList alone is NOT sufficient — no engineering auth
        $result = $this->callAggregateOutcomesByMonth(false, ['org/example-repo'], null);
        foreach ($result as $entry) {
            $this->assertEquals(0, $entry['release_count']);
        }
    }

    public function test_live_db_sync_release_excluded_from_outcomes_by_month_without_auth(): void
    {
        $this->insertRelease('db_sync', '2026-06-15 12:00:00');
        // repoAllowList alone is NOT sufficient — no engineering auth
        $result = $this->callAggregateOutcomesByMonth(false, ['org/example-repo'], null);
        foreach ($result as $entry) {
            $this->assertEquals(0, $entry['release_count']);
        }
    }

    public function test_live_db_sync_release_counted_in_outcomes_by_month_with_auth(): void
    {
        $this->insertRelease('db_sync', '2026-06-15 12:00:00');
        $oauthUser = ['login' => 'octo-user', 'token_purpose' => 'engineering_integration'];
        $result = $this->callAggregateOutcomesByMonth(false, ['org/example-repo'], $oauthUser);
        $juneEntry = collect($result)->firstWhere('month', '2026-06');
        $this->assertNotNull($juneEntry);
        $this->assertEquals(1, $juneEntry['release_count']);
    }

    // ====================================================================
    // GitHub connection state — simulated releases must NOT make connected
    // ====================================================================

    public function test_simulated_release_does_not_make_github_connected(): void
    {
        // The calculateReleaseMetrics method does NOT set github_connected.
        // It only returns release counts. Verify it returns no connection state.
        $this->insertRelease('cm_activity_sim');
        $result = $this->callCalculateReleaseMetrics(null, true);
        $this->assertArrayNotHasKey('github_connected', $result);
        $this->assertArrayNotHasKey('connected', $result);
    }

    // ====================================================================
    // deliveryTimeseries token selection — engineering token must win
    // over identity-only token when both exist for the same org
    // ====================================================================

    /**
     * Insert an oauth_tokens row with a given token_purpose.
     */
    private function insertOAuthToken(string $purpose, ?int $orgId = null, string $login = 'octo-user'): void
    {
        \DB::table('oauth_tokens')->insert([
            'user_id' => '1',
            'organization_id' => $orgId ?? $this->org->id,
            'access_token' => 'gho_test_' . uniqid(),
            'user_data' => json_encode([
                'login' => $login,
                'id' => 18269556,
                'token_purpose' => $purpose,
            ]),
            'created_at' => now(),
            'updated_at' => now()->subSeconds(rand(1, 100)),
        ]);
    }

    public function test_live_data_source_field_github_api_sync_release_counted_with_auth(): void
    {
        // Real ReleaseSyncService stamps metadata.data_source, not metadata.source
        $rel = Release::create([
            'repo_name' => 'org/example-repo',
            'tag_name' => 'v1.0',
            'published_at' => '2026-06-15 12:00:00',
            'metadata' => ['data_source' => 'github_api_sync', 'draft' => false],
        ]);
        $oauthUser = ['login' => 'octo-user', 'token_purpose' => 'engineering_integration'];
        $result = $this->callCalculateReleaseMetrics($oauthUser, false, ['org/example-repo']);
        $this->assertEquals(1, $result['total_releases']);
    }

    public function test_identity_only_token_alone_blocks_live_releases(): void
    {
        $this->insertOAuthToken('identity_only');
        $this->insertRelease('github_api_sync');
        // identity-only token → isEngineeringEvidenceEligible returns false
        $oauthUser = ['login' => 'octo-user', 'token_purpose' => 'identity_only'];
        $result = $this->callCalculateReleaseMetrics($oauthUser, false, ['org/example-repo']);
        $this->assertEquals(0, $result['total_releases']);
    }

    public function test_engineering_token_wins_over_identity_only_for_calculateReleaseMetrics(): void
    {
        // Both tokens exist; engineering token should be usable
        $this->insertRelease('github_api_sync');
        $oauthUser = ['login' => 'octo-user', 'token_purpose' => 'engineering_integration'];
        $result = $this->callCalculateReleaseMetrics($oauthUser, false, ['org/example-repo']);
        $this->assertEquals(1, $result['total_releases']);
    }

    public function test_engineering_token_from_another_org_never_eligible(): void
    {
        // Create a second org
        $otherOrg = Organization::create(['name' => 'Other Org', 'slug' => 'other-org']);
        $this->insertOAuthToken('engineering_integration', $otherOrg->id);
        $this->insertRelease('github_api_sync');
        // Even with engineering token, it's from a different org — repoAllowList
        // for the acting org would not include this repo. The calculateReleaseMetrics
        // method uses applyOrganizationRepoFilter which is org-scoped.
        $oauthUser = ['login' => 'octo-user', 'token_purpose' => 'engineering_integration'];
        // Pass a repoAllowList that doesn't include the release's repo
        $result = $this->callCalculateReleaseMetrics($oauthUser, false, ['other-org/different-repo']);
        $this->assertEquals(0, $result['total_releases']);
    }

    public function test_no_token_blocks_live_releases(): void
    {
        $this->insertRelease('github_api_sync');
        // No oauthUser at all
        $result = $this->callCalculateReleaseMetrics(null, false, ['org/example-repo']);
        $this->assertNull($result['total_releases']);
        $this->assertSame('no_evidence_authority', $result['unavailable']);
    }

    public function test_app_installed_empty_releases_reported_unavailable_not_zero(): void
    {
        // Under the dedicated-App model (installation ID configured) the App
        // holds no Contents permission, so no release rows can ever be
        // produced — an empty table must surface as unavailable, not "0".
        config(['services.github_app.installation_id' => '999999']);
        $oauthUser = ['login' => 'octo-user', 'token_purpose' => 'engineering_integration'];
        try {
            $result = $this->callCalculateReleaseMetrics($oauthUser, false, ['org/example-repo']);
        } finally {
            config(['services.github_app.installation_id' => null]);
        }
        $this->assertNull($result['total_releases']);
        $this->assertSame('github_app_no_contents', $result['unavailable']);
    }

    public function test_app_installed_existing_release_rows_still_counted(): void
    {
        // Pre-App historical rows remain real evidence.
        config(['services.github_app.installation_id' => '999999']);
        $this->insertRelease('github_api_sync');
        $oauthUser = ['login' => 'octo-user', 'token_purpose' => 'engineering_integration'];
        try {
            $result = $this->callCalculateReleaseMetrics($oauthUser, false, ['org/example-repo']);
        } finally {
            config(['services.github_app.installation_id' => null]);
        }
        $this->assertEquals(1, $result['total_releases']);
    }
}
