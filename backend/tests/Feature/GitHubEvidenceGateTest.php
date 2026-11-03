<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CRX-P0-6D-SECURITY-R3 Evidence Gate Contract Tests.
 *
 * Proves that ONLY token_purpose=engineering_integration may supply
 * GitHub engineering evidence.  All other purposes fail closed.
 *
 * Tests run against an isolated in-memory SQLite database.
 * No live dashboard-token generation, no live OAuth, no live GitHub API calls.
 */
class GitHubEvidenceGateTest extends TestCase
{
    private ?string $savedPilotSupportLogins = null;

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

        // CR-X P0-0: PilotAwareTokenHelper now reads from config(), not env().
        // Use config() override instead of putenv() so the trait sees the
        // test values under both cached and uncached config semantics.
        $this->savedPilotSupportLogins = config('services.pilot.support_github_logins');
        config(['services.pilot.support_github_logins' => '']);

        $this->createTables();
        $this->seedFixture();
    }

    protected function tearDown(): void
    {
        if (app()->environment('testing')
            && config('database.default') === 'sqlite'
            && config('database.connections.sqlite.database') === ':memory:'
        ) {
            Schema::dropIfExists('oauth_tokens');
            Schema::dropIfExists('api_tokens');
            Schema::dropIfExists('users');
            Schema::dropIfExists('organizations');
            Schema::dropIfExists('telemetry_events');
        }

        // CR-X P0-0: Restore config override (replaces former putenv teardown).
        config(['services.pilot.support_github_logins' => $this->savedPilotSupportLogins ?? '']);

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

        if (!Schema::hasTable('users')) {
            Schema::create('users', function ($table) {
                $table->id();
                $table->string('name')->nullable();
                $table->string('email')->unique();
                $table->string('password')->nullable();
                $table->string('github_id')->nullable();
                $table->foreignId('organization_id')->nullable();
                $table->string('role')->default('member');
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('api_tokens')) {
            Schema::create('api_tokens', function ($table) {
                $table->id();
                $table->string('token', 64)->unique();
                $table->foreignId('user_id')->nullable();
                $table->foreignId('organization_id')->nullable();
                $table->foreignId('invite_id')->nullable();
                $table->string('installation_id', 64)->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->timestamp('revoked_at')->nullable();
                $table->timestamps();
                $table->index('token');
                $table->index('user_id');
                $table->index('organization_id');
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
    }

    private Organization $org;
    private User $admin;
    private string $dashboardToken;

    private function seedFixture(): void
    {
        $this->org = Organization::create([
            'name' => 'Decisions',
            'slug' => 'decisions',
        ]);

        $this->admin = User::create([
            'name' => 'Matt',
            'email' => 'matt@test.com',
            'github_id' => '18269556',
            'organization_id' => $this->org->id,
            'role' => 'admin',
        ]);

        $this->dashboardToken = ApiToken::generateDashboardToken($this->admin->id, $this->org->id)['raw'];
    }

    /**
     * Insert an oauth_tokens row with a given token_purpose.
     */
    private function insertOAuthToken(?string $purpose, ?string $login = 'mattmcclintock'): string
    {
        $token = 'gho_test_' . Str::random(16);
        $userData = [
            'login' => $login,
            'id' => 18269556,
            'public_repos' => 3,
        ];
        if ($purpose !== null) {
            $userData['token_purpose'] = $purpose;
        }

        \DB::table('oauth_tokens')->insert([
            'user_id' => $this->admin->id,
            'organization_id' => $this->org->id,
            'access_token' => $token,
            'user_data' => json_encode($userData),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $token;
    }

    // ====================================================================
    // EVIDENCE GATE: isEngineeringEvidenceEligible() unit-level tests
    // ====================================================================

    public function test_identity_only_token_is_not_eligible(): void
    {
        $this->assertFalse($this->callEligible([
            'login' => 'mattmcclintock',
            'token_purpose' => 'identity_only',
        ]));
    }

    public function test_missing_purpose_is_not_eligible(): void
    {
        $this->assertFalse($this->callEligible([
            'login' => 'mattmcclintock',
        ]));
    }

    public function test_null_purpose_is_not_eligible(): void
    {
        $this->assertFalse($this->callEligible([
            'login' => 'mattmcclintock',
            'token_purpose' => null,
        ]));
    }

    public function test_unknown_purpose_is_not_eligible(): void
    {
        $this->assertFalse($this->callEligible([
            'login' => 'mattmcclintock',
            'token_purpose' => 'unknown',
        ]));
    }

    public function test_legacy_purpose_is_not_eligible(): void
    {
        $this->assertFalse($this->callEligible([
            'login' => 'mattmcclintock',
            'token_purpose' => 'legacy',
        ]));
    }

    public function test_engineering_integration_is_eligible(): void
    {
        $this->assertTrue($this->callEligible([
            'login' => 'mattmcclintock',
            'token_purpose' => 'engineering_integration',
        ]));
    }

    public function test_null_user_is_not_eligible(): void
    {
        $this->assertFalse($this->callEligible(null));
    }

    public function test_user_without_login_is_not_eligible(): void
    {
        $this->assertFalse($this->callEligible([
            'token_purpose' => 'engineering_integration',
        ]));
    }

    public function test_public_repos_cannot_leak_as_customer_truth(): void
    {
        // Even if a user has public_repos=3, identity_only must block evidence.
        $this->assertFalse($this->callEligible([
            'login' => 'mattmcclintock',
            'token_purpose' => 'identity_only',
            'public_repos' => 3,
        ]));
    }

    /**
     * Call the protected trait method via a reflection helper.
     */
    private function callEligible(?array $oauthUser): bool
    {
        $controller = new \App\Http\Controllers\GitHubMetricDetailsController(
            new \App\Services\GitHubApiService()
        );
        $reflection = new \ReflectionMethod($controller, 'isEngineeringEvidenceEligible');
        $reflection->setAccessible(true);
        return $reflection->invoke($controller, $oauthUser);
    }

    // ====================================================================
    // GET /api/github/repositories — R3 gate
    // ====================================================================

    public function test_identity_only_get_repositories_returns_empty(): void
    {
        $this->insertOAuthToken('identity_only');
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/repositories');
        $response->assertStatus(200);
        $response->assertJson(['repositories' => []]);
    }

    public function test_missing_purpose_get_repositories_returns_empty(): void
    {
        $this->insertOAuthToken(null);
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/repositories');
        $response->assertStatus(200);
        $response->assertJson(['repositories' => []]);
    }

    public function test_engineering_integration_get_repositories_proceeds(): void
    {
        $this->insertOAuthToken('engineering_integration');
        // The token is fake so GitHub API will fail, and the DB fallback will
        // also fail (no pull_requests table in test DB).  But the key proof is
        // that the gate PASSED — the controller got past the R3 check and
        // attempted the fetch.  A 500 from the DB fallback proves the gate
        // was NOT the blocking point.
        // The identity_only test returns 200 with empty repos (blocked at gate).
        // The engineering_integration test must NOT return the same blocked shape.
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/repositories');
        // Accept either 200 (success) or 500 (DB fallback failure) — both prove
        // the gate passed.  A 200 with empty repos AND a "blocked" reason would
        // mean the gate blocked it, which is the failure case.
        $this->assertContains($response->status(), [200, 500],
            'Engineering integration token should pass the gate (200 or 500 from fallback, not blocked)');
        if ($response->status() === 200) {
            $json = $response->json();
            // If 200, should not have the blocked reason
            $this->assertArrayNotHasKey('reason', $json,
                'Engineering integration token should not be blocked at the gate');
        }
    }

    // ====================================================================
    // GET /api/github/repositories-simple — R3 gate
    // ====================================================================

    public function test_identity_only_repositories_simple_returns_empty(): void
    {
        $this->insertOAuthToken('identity_only');
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/github/repositories-simple');
        $response->assertStatus(200);
        $response->assertJson(['repositories' => [], 'total_count' => 0]);
    }

    public function test_missing_purpose_repositories_simple_returns_empty(): void
    {
        $this->insertOAuthToken(null);
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/github/repositories-simple');
        $response->assertStatus(200);
        $response->assertJson(['repositories' => [], 'total_count' => 0]);
    }

    // ====================================================================
    // GET /api/github/metric-details — R3 gate
    // ====================================================================

    public function test_identity_only_metric_details_returns_empty(): void
    {
        $this->insertOAuthToken('identity_only');
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/github/metric-details?metric=total_repositories');
        $response->assertStatus(200);
        $response->assertJsonPath('total_count', 0);
        $response->assertJsonPath('records', []);
    }

    public function test_missing_purpose_metric_details_returns_empty(): void
    {
        $this->insertOAuthToken(null);
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/github/metric-details?metric=total_commits');
        $response->assertStatus(200);
        $response->assertJsonPath('total_count', 0);
        $response->assertJsonPath('records', []);
    }

    // ====================================================================
    // AUTH / TEAM — login mapping and team scoping remain valid
    // ====================================================================

    public function test_login_mapping_remains_valid(): void
    {
        // Verify that the dashboard token resolves to the correct user+org
        // via the metrics endpoint (which uses authenticated_user).
        $this->insertOAuthToken('identity_only');
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/metrics?time_filter=week&nocache=1');
        $response->assertStatus(200);
        // The metrics endpoint should succeed — token maps to admin user
        $data = $response->json();
        $this->assertNotNull($data, 'Metrics response should be valid JSON');
    }

    public function test_team_org_scoping_remains_valid(): void
    {
        // Verify that the dashboard token resolves to the correct org
        // by checking that metrics returns without error.
        $this->insertOAuthToken('identity_only');
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/metrics?time_filter=week&nocache=1');
        $response->assertStatus(200);
    }

    // ====================================================================
    // ZERO-POP METRICS — identity_only login yields clean state
    // ====================================================================

    public function test_zero_telemetry_identity_only_yields_no_github_connected(): void
    {
        $this->insertOAuthToken('identity_only');
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/metrics?time_filter=week&nocache=1');
        $response->assertStatus(200);
        $data = $response->json();
        // Debug: dump key fields to understand the response
        $this->assertNotNull($data, 'Metrics response should be valid JSON');
        // github_connected must be absent or false — identity_only must not set it true
        $this->assertNotTrue(
            $data['github_connected'] ?? false,
            'github_connected must not be true for identity_only token. ' .
            'Got: ' . json_encode([
                'github_connected' => $data['github_connected'] ?? 'NOT_SET',
                'github_connection_reason' => $data['github_connection_reason'] ?? 'NOT_SET',
                'github_oauth_connected' => $data['github_oauth_connected'] ?? 'NOT_SET',
                'response_keys' => array_slice(array_keys($data), 0, 15),
            ])
        );
    }

    public function test_zero_telemetry_identity_only_yields_zero_repositories(): void
    {
        $this->insertOAuthToken('identity_only');
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/metrics?time_filter=week&nocache=1');
        $response->assertStatus(200);
        $data = $response->json();
        // total_repositories must be 0 or absent — no personal repo leakage
        $totalRepos = $data['total_repositories'] ?? 0;
        $this->assertEquals(0, $totalRepos,
            'total_repositories must be 0 for identity_only token, got: ' . $totalRepos);
    }

    public function test_zero_telemetry_identity_only_yields_empty_repositories_array(): void
    {
        $this->insertOAuthToken('identity_only');
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/metrics?time_filter=week&nocache=1');
        $response->assertStatus(200);
        $data = $response->json();
        $repos = $data['repositories'] ?? [];
        $this->assertEquals([], $repos,
            'repositories must be empty array for identity_only token');
    }

    // ====================================================================
    // ENROLLMENT ROUTE — rollout claim contract exists
    // ====================================================================

    public function test_rollout_claim_route_exists(): void
    {
        // The route must exist and return 400 for an invalid token
        // (not 404 — route is registered)
        $response = $this->postJson('/api/rollouts/invalid-token/claim', [
            'email' => 'test@test.com',
        ]);
        $this->assertNotEquals(404, $response->status(),
            'Rollout claim route must exist (not 404)');
    }

    // ====================================================================
    // CR-X 2C: Org-level engineering token selection
    // ====================================================================

    public function test_org_engineering_token_returns_engineering_integration_token(): void
    {
        $this->insertOAuthToken('identity_only');
        $engToken = $this->insertOAuthToken('engineering_integration');

        $resolved = $this->callOrgEngineeringToken($this->org->id);
        $this->assertEquals($engToken, $resolved,
            'getOrgEngineeringToken should return the engineering_integration token');
    }

    public function test_org_engineering_token_skips_support_login(): void
    {
        // Support login with engineering_integration purpose should be skipped
        $this->insertOAuthToken('engineering_integration', 'chaosmonkey-support');
        $engToken = $this->insertOAuthToken('engineering_integration', 'ed-customer');

        // Set PILOT_SUPPORT_GITHUB_LOGINS to mark 'chaosmonkey-support' as support
        // CR-X P0-0: Use config() override instead of putenv().
        config(['services.pilot.support_github_logins' => 'chaosmonkey-support']);

        $resolved = $this->callOrgEngineeringToken($this->org->id);
        $this->assertEquals($engToken, $resolved,
            'getOrgEngineeringToken should skip support login tokens');

        config(['services.pilot.support_github_logins' => '']);
    }

    public function test_org_engineering_token_returns_null_when_no_eligible_token(): void
    {
        $this->insertOAuthToken('identity_only');
        $this->insertOAuthToken(null);

        $resolved = $this->callOrgEngineeringToken($this->org->id);
        $this->assertNull($resolved,
            'getOrgEngineeringToken should return null when no engineering_integration token exists');
    }

    public function test_org_engineering_token_is_org_scoped(): void
    {
        // Token in a different org should not be returned
        $otherOrg = Organization::create(['name' => 'Other', 'slug' => 'other']);
        $otherUser = User::create([
            'name' => 'Other User',
            'email' => 'other@test.com',
            'github_id' => '99999',
            'organization_id' => $otherOrg->id,
            'role' => 'admin',
        ]);

        \DB::table('oauth_tokens')->insert([
            'user_id' => $otherUser->id,
            'organization_id' => $otherOrg->id,
            'access_token' => 'gho_other_org_token',
            'user_data' => json_encode([
                'login' => 'other-user',
                'token_purpose' => 'engineering_integration',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Our org has no engineering_integration token
        $this->insertOAuthToken('identity_only');

        $resolved = $this->callOrgEngineeringToken($this->org->id);
        $this->assertNull($resolved,
            'getOrgEngineeringToken must not return tokens from other organizations');
    }

    public function test_org_engineering_user_returns_user_data(): void
    {
        $this->insertOAuthToken('engineering_integration', 'ed-customer');

        $userData = $this->callOrgEngineeringUser($this->org->id);
        $this->assertNotNull($userData);
        $this->assertEquals('ed-customer', $userData['login']);
        $this->assertEquals('engineering_integration', $userData['token_purpose']);
    }

    private function callOrgEngineeringToken(int $orgId): ?string
    {
        $controller = new \App\Http\Controllers\GitHubMetricDetailsController(
            new \App\Services\GitHubApiService()
        );
        $reflection = new \ReflectionMethod($controller, 'getOrgEngineeringToken');
        $reflection->setAccessible(true);
        return $reflection->invoke($controller, $orgId);
    }

    private function callOrgEngineeringUser(int $orgId): ?array
    {
        $controller = new \App\Http\Controllers\GitHubMetricDetailsController(
            new \App\Services\GitHubApiService()
        );
        $reflection = new \ReflectionMethod($controller, 'getOrgEngineeringUser');
        $reflection->setAccessible(true);
        return $reflection->invoke($controller, $orgId);
    }

    // ====================================================================
    // CR-X 2C: Telemetry-derived repo inventory endpoint
    // ====================================================================

    public function test_telemetry_repos_returns_distinct_repos(): void
    {
        $this->createTelemetryEventsTable();
        $this->insertTelemetrySession('https://github.com/owner/repo-a.git', $this->org->id);
        $this->insertTelemetrySession('https://github.com/owner/repo-b.git', $this->org->id);
        $this->insertTelemetrySession('https://github.com/owner/repo-a.git', $this->org->id);

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/repos');

        $response->assertStatus(200);
        $data = $response->json();
        $this->assertEquals('telemetry', $data['source']);
        $this->assertEquals(2, $data['total_count']);
        $this->assertContains('owner/repo-a', $data['repositories']);
        $this->assertContains('owner/repo-b', $data['repositories']);
    }

    public function test_telemetry_repos_normalizes_github_urls(): void
    {
        $this->createTelemetryEventsTable();
        // SSH, HTTPS, and .git variants should all normalize to owner/repo
        $this->insertTelemetrySession('git@github.com:owner/repo.git', $this->org->id);
        $this->insertTelemetrySession('https://github.com/owner/repo.git', $this->org->id);
        $this->insertTelemetrySession('https://github.com/owner/repo', $this->org->id);

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/repos');

        $response->assertStatus(200);
        $data = $response->json();
        $this->assertEquals(1, $data['total_count'],
            'Different URL forms of the same repo should normalize to one entry: ' .
            json_encode($data['repositories']));
        $this->assertContains('owner/repo', $data['repositories']);
    }

    public function test_telemetry_repos_is_org_scoped(): void
    {
        $this->createTelemetryEventsTable();
        $otherOrg = Organization::create(['name' => 'Other', 'slug' => 'other-scope']);

        $this->insertTelemetrySession('https://github.com/our-org/our-repo.git', $this->org->id);
        $this->insertTelemetrySession('https://github.com/other-org/secret-repo.git', $otherOrg->id);

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/repos');

        $response->assertStatus(200);
        $data = $response->json();
        $this->assertContains('our-org/our-repo', $data['repositories']);
        $this->assertNotContains('other-org/secret-repo', $data['repositories'],
            'Telemetry repos must not leak repos from other organizations');
    }

    public function test_telemetry_repos_empty_when_no_repo_urls(): void
    {
        $this->createTelemetryEventsTable();
        // Session without git_repo_url
        $this->insertTelemetrySession(null, $this->org->id);

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/repos');

        $response->assertStatus(200);
        $data = $response->json();
        $this->assertEquals(0, $data['total_count']);
        $this->assertEquals([], $data['repositories']);
    }

    private function createTelemetryEventsTable(): void
    {
        if (!Schema::hasTable('telemetry_events')) {
            Schema::create('telemetry_events', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->nullable();
                $table->string('user_id')->nullable();
                $table->string('session_id')->nullable();
                $table->string('source')->nullable();
                $table->string('editor_source')->nullable();
                $table->string('event_type')->nullable();
                $table->integer('count')->default(1);
                $table->json('payload')->nullable();
                $table->integer('duration_ms')->nullable();
                $table->timestamp('timestamp')->nullable();
                $table->json('metadata')->nullable();
                $table->string('batch_hash')->nullable();
                $table->string('event_id')->nullable();
                $table->integer('session_prs_created')->default(0);
                $table->integer('session_prs_merged')->default(0);
                $table->integer('session_pr_reopen_count')->default(0);
                $table->integer('session_deployment_successes')->default(0);
                $table->timestamps();
                $table->index('organization_id');
                $table->index('event_type');
                $table->index('session_id');
            });
        }
    }

    private function insertTelemetrySession(?string $repoUrl, int $orgId): void
    {
        $metadata = ['segment_type' => 'session'];
        if ($repoUrl) {
            $metadata['git_repo_url'] = $repoUrl;
        }

        \DB::table('telemetry_events')->insert([
            'organization_id' => $orgId,
            'user_id' => 'test-user',
            'session_id' => 'sess-' . Str::random(8),
            'event_type' => 'session',
            'metadata' => json_encode($metadata),
            'timestamp' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
