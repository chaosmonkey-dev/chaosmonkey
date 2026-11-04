<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CR-X Wave 2: OAuth Intent / Scopes Security Tests.
 *
 * Proves that OAuth redirect scopes and callback token_purpose are
 * bound to a verified OAuth intent, and that engineering intent
 * requires authenticated dashboard organization context.
 *
 * Contract:
 *   intent=login       → scopes read:user,user:email → token_purpose identity_only
 *   intent=engineering → scopes read:user,user:email,repo → token_purpose engineering_integration
 *                        BUT only when initiated from an authenticated dashboard context
 *   missing intent     → login scopes → identity_only (fail safe)
 *   invalid intent     → login scopes → identity_only (fail safe)
 *   create_account=true → always login scopes regardless of intent (fail safe)
 *   unauthenticated engineering → 403, no OAuth URL issued
 *   support login      → identity_only regardless of intent
 *   tampered state     → never produces engineering_integration
 *
 * Tests run against an isolated in-memory SQLite database.
 * No live OAuth token is created. Http::fake() simulates GitHub responses.
 */
class OAuthIntentScopesTest extends TestCase
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
        // Use config() overrides instead of putenv() so the trait sees the
        // test values.  putenv() only affects env() at runtime, but the
        // trait now calls config('services.pilot.support_github_logins').
        $this->savedPilotSupportLogins = config('services.pilot.support_github_logins');
        config(['services.pilot.support_github_logins' => '']);

        $this->createTables();
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
            Schema::dropIfExists('ide_connect_codes');
            Schema::dropIfExists('invites');
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

        if (!Schema::hasTable('invites')) {
            Schema::create('invites', function ($table) {
                $table->id();
                $table->string('token')->unique();
                $table->foreignId('organization_id')->nullable();
                $table->string('email')->nullable();
                $table->string('role')->default('member');
                $table->timestamp('redeemed_at')->nullable();
                $table->foreignId('redeemed_by_user_id')->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('ide_connect_codes')) {
            Schema::create('ide_connect_codes', function ($table) {
                $table->id();
                $table->string('code')->unique();
                $table->foreignId('invite_id')->nullable();
                $table->foreignId('organization_id')->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->timestamp('used_at')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('telemetry_events')) {
            Schema::create('telemetry_events', function ($table) {
                $table->id();
                $table->timestamp('timestamp')->nullable();
                $table->string('session_id')->nullable();
                $table->string('event_type')->nullable();
                $table->string('source')->nullable();
                $table->json('metadata')->nullable();
                $table->timestamps();
            });
        }
    }

    /**
     * Call the redirect endpoint and extract the scope from the auth_url.
     */
    private function getRedirectScope(string $queryString = '', ?string $bearerToken = null): string
    {
        $url = '/api/github/oauth/redirect' . ($queryString ? "?{$queryString}" : '');
        $headers = [];
        if ($bearerToken) {
            $headers['Authorization'] = 'Bearer ' . $bearerToken;
        }
        $response = $this->getJson($url, $headers);

        $this->assertEquals(200, $response->status(), "Redirect should return 200 for: {$queryString}");

        $authUrl = $response->json('auth_url');
        $this->assertNotNull($authUrl, 'auth_url should be present');

        parse_str(parse_url($authUrl, PHP_URL_QUERY), $params);
        return $params['scope'] ?? '';
    }

    /**
     * Extract the oauth_state from the redirect response's DB row.
     */
    private function getRedirectState(string $queryString = '', ?string $bearerToken = null): string
    {
        $url = '/api/github/oauth/redirect' . ($queryString ? "?{$queryString}" : '');
        $headers = [];
        if ($bearerToken) {
            $headers['Authorization'] = 'Bearer ' . $bearerToken;
        }
        $response = $this->getJson($url, $headers);

        $authUrl = $response->json('auth_url');
        parse_str(parse_url($authUrl, PHP_URL_QUERY), $params);
        return $params['state'] ?? '';
    }

    /**
     * Create a valid dashboard API token for an org/user.
     * Returns the raw token string (suitable for Bearer header).
     */
    private function createDashboardToken(int $orgId, int $userId): string
    {
        $rawToken = Str::random(64);
        ApiToken::create([
            'token' => hash('sha256', $rawToken),
            'user_id' => $userId,
            'organization_id' => $orgId,
            'expires_at' => null,
        ]);
        return $rawToken;
    }

    /**
     * Simulate a full OAuth callback with a given intent and GitHub user data.
     * Uses Http::fake() to simulate GitHub API responses.
     */
    private function simulateCallback(string $state, array $githubUserData, ?int $orgId = null, ?int $credentialUserId = null): array
    {
        // Pre-create the user so the callback finds an existing user
        $org = Organization::create(['name' => 'Test Org', 'slug' => 'test-org']);
        $user = User::create([
            'name' => $githubUserData['name'] ?? 'Test User',
            'email' => $githubUserData['email'] ?? 'test@test.com',
            'password' => \Illuminate\Support\Facades\Hash::make(Str::random(32)),
            'github_id' => $githubUserData['id'],
            'organization_id' => $orgId ?? $org->id,
            'role' => 'admin',
        ]);

        Http::fake([
            'github.com/login/oauth/access_token' => Http::response(
                'access_token=fake_token_' . Str::random(16) . '&token_type=bearer&scope=read%3Auser%2Cuser%3Aemail',
                200,
                ['Content-Type' => 'application/x-www-form-urlencoded']
            ),
            'api.github.com/user' => Http::response($githubUserData, 200),
            'api.github.com/user/emails' => Http::response([
                ['email' => $githubUserData['email'] ?? 'test@test.com', 'primary' => true, 'verified' => true]
            ], 200),
        ]);

        $response = $this->getJson("/api/github/oauth/callback?code=fake_code&state={$state}");

        // Read the stored token purpose from the DB.  Engineering intent
        // attaches to the INITIATING dashboard user (bound in verified
        // state), which may differ from the GitHub-matched user — pass
        // $credentialUserId to assert on the initiator's credential row.
        $tokenRow = \DB::table('oauth_tokens')
            ->where('user_id', $credentialUserId ?? $user->id)
            ->where('access_token', '!=', 'pending')
            ->first();

        $userData = $tokenRow ? json_decode($tokenRow->user_data, true) : [];

        return [
            'response' => $response,
            'token_purpose' => $userData['token_purpose'] ?? null,
            'user_id' => $user->id,
            'org_id' => $orgId ?? $org->id,
        ];
    }

    // ─── Redirect scope tests ───────────────────────────────────────

    public function test_missing_intent_defaults_to_login_scopes_without_repo(): void
    {
        $scope = $this->getRedirectScope('');
        $this->assertStringContainsString('read:user', $scope);
        $this->assertStringContainsString('user:email', $scope);
        $this->assertStringNotContainsString('repo', $scope);
    }

    public function test_intent_login_does_not_contain_repo(): void
    {
        $scope = $this->getRedirectScope('intent=login');
        $this->assertStringContainsString('read:user', $scope);
        $this->assertStringContainsString('user:email', $scope);
        $this->assertStringNotContainsString('repo', $scope);
    }

    public function test_intent_login_contains_required_identity_scopes(): void
    {
        $scope = $this->getRedirectScope('intent=login');
        $this->assertStringContainsString('read:user', $scope);
        $this->assertStringContainsString('user:email', $scope);
    }

    public function test_unsupported_intent_cannot_escalate_scope(): void
    {
        $scope = $this->getRedirectScope('intent=admin');
        $this->assertStringNotContainsString('repo', $scope);
        $this->assertStringContainsString('read:user', $scope);
    }

    public function test_create_account_always_uses_identity_scopes(): void
    {
        $scope = $this->getRedirectScope('create_account=true');
        $this->assertStringContainsString('read:user', $scope);
        $this->assertStringContainsString('user:email', $scope);
        $this->assertStringNotContainsString('repo', $scope);
    }

    public function test_create_account_with_engineering_intent_cannot_escalate(): void
    {
        // create_account=true + intent=engineering must normalize to login
        $scope = $this->getRedirectScope('intent=engineering&create_account=true');
        $this->assertStringNotContainsString('repo', $scope);
        $this->assertStringContainsString('read:user', $scope);
        $this->assertStringContainsString('user:email', $scope);
    }

    // ─── Engineering auth context tests ─────────────────────────────

    public function test_unauthenticated_engineering_intent_is_rejected(): void
    {
        // No Bearer token → 403, no OAuth URL issued
        $response = $this->getJson('/api/github/oauth/redirect?intent=engineering');
        $this->assertEquals(403, $response->status());
        $this->assertNull($response->json('auth_url'));
        $this->assertEquals('AUTH_REQUIRED', $response->json('error'));
    }

    public function test_engineering_with_invalid_bearer_token_is_rejected(): void
    {
        $response = $this->getJson('/api/github/oauth/redirect?intent=engineering', [
            'Authorization' => 'Bearer invalid_token_' . Str::random(16),
        ]);
        $this->assertEquals(403, $response->status());
        $this->assertNull($response->json('auth_url'));
    }

    public function test_authenticated_engineering_intent_receives_repo_scope(): void
    {
        // Create a valid dashboard token
        $org = Organization::create(['name' => 'Eng Org', 'slug' => 'eng-org']);
        $user = User::create([
            'name' => 'Eng Admin',
            'email' => 'engadmin@test.com',
            'password' => \Illuminate\Support\Facades\Hash::make(Str::random(32)),
            'organization_id' => $org->id,
            'role' => 'admin',
        ]);
        $rawToken = $this->createDashboardToken($org->id, $user->id);

        $scope = $this->getRedirectScope('intent=engineering', $rawToken);
        $this->assertStringContainsString('read:user', $scope);
        $this->assertStringContainsString('user:email', $scope);
        $this->assertStringContainsString('repo', $scope);
    }

    // ─── Callback token_purpose tests ───────────────────────────────

    public function test_verified_login_callback_produces_identity_only(): void
    {
        $state = $this->getRedirectState('intent=login');
        $result = $this->simulateCallback($state, [
            'id' => '12345',
            'login' => 'testuser',
            'name' => 'Test User',
            'email' => 'test@test.com',
        ]);

        $this->assertEquals('identity_only', $result['token_purpose']);
    }

    public function test_verified_account_creation_callback_produces_identity_only(): void
    {
        $state = $this->getRedirectState('create_account=true');
        $result = $this->simulateCallback($state, [
            'id' => '12348',
            'login' => 'newuser',
            'name' => 'New User',
            'email' => 'new@test.com',
        ]);

        $this->assertEquals('identity_only', $result['token_purpose']);
    }

    public function test_verified_engineering_callback_produces_engineering_integration(): void
    {
        // Create an authenticated org context
        $org = Organization::create(['name' => 'Eng Org', 'slug' => 'eng-org']);
        $user = User::create([
            'name' => 'Eng Admin',
            'email' => 'engadmin@test.com',
            'password' => \Illuminate\Support\Facades\Hash::make(Str::random(32)),
            'organization_id' => $org->id,
            'role' => 'admin',
        ]);
        $rawToken = $this->createDashboardToken($org->id, $user->id);

        // Initiate engineering OAuth with authenticated context
        $state = $this->getRedirectState('intent=engineering', $rawToken);

        // Simulate callback — engineering intent attaches the credential to
        // the INITIATING dashboard user, not the GitHub-matched identity.
        $result = $this->simulateCallback($state, [
            'id' => '12346',
            'login' => 'enguser',
            'name' => 'Eng User',
            'email' => 'eng@test.com',
        ], $org->id, $user->id);

        $this->assertEquals('engineering_integration', $result['token_purpose']);
    }

    public function test_invalid_tampered_state_cannot_create_engineering_integration(): void
    {
        $fakeState = Str::random(40);

        Http::fake([
            'github.com/login/oauth/access_token' => Http::response(
                'access_token=fake_token&token_type=bearer',
                200,
                ['Content-Type' => 'application/x-www-form-urlencoded']
            ),
            'api.github.com/user' => Http::response([
                'id' => '99999',
                'login' => 'attacker',
                'name' => 'Attacker',
                'email' => 'attacker@test.com',
            ], 200),
        ]);

        $response = $this->getJson("/api/github/oauth/callback?code=fake_code&state={$fakeState}");

        $this->assertEquals(400, $response->status());

        $engTokens = \DB::table('oauth_tokens')
            ->whereRaw("json_extract(user_data, '$.token_purpose') = ?", ['engineering_integration'])
            ->count();
        $this->assertEquals(0, $engTokens, 'No engineering_integration token should exist from tampered state');
    }

    public function test_support_login_remains_identity_only_even_with_engineering_intent(): void
    {
        // CR-X P0-0: Use config() override instead of putenv() — the trait
        // now reads from config('services.pilot.support_github_logins').
        config(['services.pilot.support_github_logins' => 'support-user']);

        // Create authenticated context for the engineering redirect
        $org = Organization::create(['name' => 'Support Org', 'slug' => 'support-org']);
        $user = User::create([
            'name' => 'Support Admin',
            'email' => 'supportadmin@test.com',
            'password' => \Illuminate\Support\Facades\Hash::make(Str::random(32)),
            'organization_id' => $org->id,
            'role' => 'admin',
        ]);
        $rawToken = $this->createDashboardToken($org->id, $user->id);

        $state = $this->getRedirectState('intent=engineering', $rawToken);
        $result = $this->simulateCallback($state, [
            'id' => '12347',
            'login' => 'support-user',
            'name' => 'Support User',
            'email' => 'support@test.com',
        ], $org->id, $user->id);

        $this->assertEquals('identity_only', $result['token_purpose']);
    }

    // ─── Evidence gate integration ──────────────────────────────────

    public function test_identity_only_still_fails_is_engineering_evidence_eligible(): void
    {
        $controller = new \App\Http\Controllers\GitHubOAuthController();

        $reflection = new \ReflectionMethod($controller, 'isEngineeringEvidenceEligible');
        $reflection->setAccessible(true);

        $result = $reflection->invoke($controller, ['login' => 'testuser', 'token_purpose' => 'identity_only']);
        $this->assertFalse($result, 'identity_only must fail the evidence gate');
    }

    public function test_engineering_integration_passes_evidence_gate(): void
    {
        $controller = new \App\Http\Controllers\GitHubOAuthController();

        $reflection = new \ReflectionMethod($controller, 'isEngineeringEvidenceEligible');
        $reflection->setAccessible(true);

        $result = $reflection->invoke($controller, ['login' => 'enguser', 'token_purpose' => 'engineering_integration']);
        $this->assertTrue($result, 'engineering_integration must pass the evidence gate');
    }

    // ─── Frontend caller verification (source inspection) ───────────

    public function test_login_vue_sends_intent_login(): void
    {
        $source = file_get_contents(base_path('../frontend/src/pages/Login.vue'));
        $this->assertStringContainsString('intent=login', $source,
            'Login.vue must send intent=login in the OAuth redirect call');
    }

    public function test_settings_vue_sends_intent_engineering(): void
    {
        $source = file_get_contents(base_path('../frontend/src/pages/Settings.vue'));
        $this->assertStringContainsString('intent=engineering', $source,
            'Settings.vue must send intent=engineering in the OAuth redirect call');
    }

    public function test_settings_vue_uses_authenticated_fetch(): void
    {
        $source = file_get_contents(base_path('../frontend/src/pages/Settings.vue'));
        $this->assertStringContainsString('authenticatedFetch', $source,
            'Settings.vue must use authenticatedFetch for the engineering OAuth redirect so the Bearer token is sent');
    }

    // ─── Pilot Ops 12: Dashboard Admission Hardening ─────────────────

    public function test_existing_authorized_github_user_can_still_login_in_pilot_mode(): void
    {
        // Given the configured pilot org and an existing user
        $pilotOrg = Organization::create(['name' => 'Example Org', 'slug' => 'example-org']);
        config(['services.pilot.single_tenant_org_slug' => 'example-org']);

        $existingUser = User::create([
            'name' => 'Ed St. Louis',
            'email' => 'ed@example.com',
            'password' => \Illuminate\Support\Facades\Hash::make(Str::random(32)),
            'github_id' => '976865',
            'organization_id' => $pilotOrg->id,
            'role' => 'admin',
        ]);

        $state = $this->getRedirectState();
        Http::fake([
            'github.com/login/oauth/access_token' => Http::response(
                'access_token=fake_token&token_type=bearer&scope=read%3Auser%2Cuser%3Aemail',
                200,
                ['Content-Type' => 'application/x-www-form-urlencoded']
            ),
            'api.github.com/user' => Http::response([
                'id' => '976865',
                'login' => 'ed-st-louis',
                'email' => 'ed@example.com',
                'name' => 'Ed St. Louis',
            ], 200),
            'api.github.com/user/emails' => Http::response([
                ['email' => 'ed@example.com', 'primary' => true, 'verified' => true]
            ], 200),
        ]);

        $response = $this->getJson("/api/github/oauth/callback?code=fake&state={$state}");

        // Callback issues an opaque handoff redirect for the frontend
        $response->assertStatus(302);
        $this->assertStringContainsString('handoff_code=', $response->headers->get('Location') ?? '');
        $this->assertEquals('admin', $existingUser->fresh()->role);
        $this->assertNotNull(DB::table('oauth_tokens')->where('user_id', $existingUser->id)->first(), 'OAuth token was stored');
    }

    public function test_unknown_github_user_cannot_create_pilot_user_without_invite(): void
    {
        Organization::create(['name' => 'Example Org', 'slug' => 'example-org']);
        config(['services.pilot.single_tenant_org_slug' => 'example-org']);

        $state = $this->getRedirectState();
        Http::fake([
            'github.com/login/oauth/access_token' => Http::response(
                'access_token=fake_token&token_type=bearer&scope=read%3Auser%2Cuser%3Aemail',
                200,
                ['Content-Type' => 'application/x-www-form-urlencoded']
            ),
            'api.github.com/user' => Http::response([
                'id' => '999999999',
                'login' => 'random-attacker',
                'email' => 'attacker@example.com',
                'name' => 'Random Attacker',
            ], 200),
            'api.github.com/user/emails' => Http::response([
                ['email' => 'attacker@example.com', 'primary' => true, 'verified' => true]
            ], 200),
        ]);

        $response = $this->getJson("/api/github/oauth/callback?code=fake&state={$state}");

        $response->assertStatus(403);
        $response->assertJsonPath('error', 'DASHBOARD_INVITE_REQUIRED');
        $this->assertNull(User::where('github_id', '999999999')->first());
    }

    public function test_unknown_github_user_cannot_obtain_dashboard_token_without_invite(): void
    {
        Organization::create(['name' => 'Example Org', 'slug' => 'example-org']);
        config(['services.pilot.single_tenant_org_slug' => 'example-org']);

        $state = $this->getRedirectState();
        Http::fake([
            'github.com/login/oauth/access_token' => Http::response(
                'access_token=fake_token&token_type=bearer&scope=read%3Auser%2Cuser%3Aemail',
                200,
                ['Content-Type' => 'application/x-www-form-urlencoded']
            ),
            'api.github.com/user' => Http::response([
                'id' => '999999998',
                'login' => 'token-attacker',
                'email' => 'tok@example.com',
                'name' => 'Token Attacker',
            ], 200),
            'api.github.com/user/emails' => Http::response([
                ['email' => 'tok@example.com', 'primary' => true, 'verified' => true]
            ], 200),
        ]);

        $response = $this->getJson("/api/github/oauth/callback?code=fake&state={$state}");

        $response->assertStatus(403);
        $response->assertJsonPath('error', 'DASHBOARD_INVITE_REQUIRED');
        $this->assertNull(User::where('github_id', '999999998')->first());
    }

    public function test_valid_dashboard_invite_admits_user_to_pilot_org_as_member(): void
    {
        $pilotOrg = Organization::create(['name' => 'Example Org', 'slug' => 'example-org']);
        config(['services.pilot.single_tenant_org_slug' => 'example-org']);

        // Create a dashboard-user invite (no connect code)
        $inviteToken = Str::random(32);
        DB::table('invites')->insert([
            'token' => $inviteToken,
            'organization_id' => $pilotOrg->id,
            'email' => 'newmember@example.com',
            'role' => 'member',
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Pre-stage the pending oauth state with invite context
        $state = $this->getRedirectState("invite_token={$inviteToken}");

        Http::fake([
            'github.com/login/oauth/access_token' => Http::response(
                'access_token=fake_token&token_type=bearer&scope=read%3Auser%2Cuser%3Aemail',
                200,
                ['Content-Type' => 'application/x-www-form-urlencoded']
            ),
            'api.github.com/user' => Http::response([
                'id' => '111111111',
                'login' => 'invited-member',
                'email' => 'newmember@example.com',
                'name' => 'Invited Member',
            ], 200),
            'api.github.com/user/emails' => Http::response([
                ['email' => 'newmember@example.com', 'primary' => true, 'verified' => true]
            ], 200),
        ]);

        $response = $this->getJson("/api/github/oauth/callback?code=fake&state={$state}");

        $response->assertStatus(302);

        $user = User::where('github_id', '111111111')->first();
        $this->assertNotNull($user);
        $this->assertEquals($pilotOrg->id, $user->organization_id);
        $this->assertEquals('member', $user->role);
    }

    public function test_dashboard_invite_can_admit_admin_to_pilot_org(): void
    {
        $pilotOrg = Organization::create(['name' => 'Example Org', 'slug' => 'example-org']);
        config(['services.pilot.single_tenant_org_slug' => 'example-org']);

        $inviteToken = Str::random(32);
        DB::table('invites')->insert([
            'token' => $inviteToken,
            'organization_id' => $pilotOrg->id,
            'email' => 'newadmin@example.com',
            'role' => 'admin',
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $state = $this->getRedirectState("invite_token={$inviteToken}");

        Http::fake([
            'github.com/login/oauth/access_token' => Http::response(
                'access_token=fake_token&token_type=bearer&scope=read%3Auser%2Cuser%3Aemail',
                200,
                ['Content-Type' => 'application/x-www-form-urlencoded']
            ),
            'api.github.com/user' => Http::response([
                'id' => '222222222',
                'login' => 'invited-admin',
                'email' => 'newadmin@example.com',
                'name' => 'Invited Admin',
            ], 200),
            'api.github.com/user/emails' => Http::response([
                ['email' => 'newadmin@example.com', 'primary' => true, 'verified' => true]
            ], 200),
        ]);

        $response = $this->getJson("/api/github/oauth/callback?code=fake&state={$state}");

        $response->assertStatus(302);
        $user = User::where('github_id', '222222222')->first();
        $this->assertEquals('admin', $user->role);
    }

    public function test_developer_enrollment_invite_cannot_grant_dashboard_access(): void
    {
        $pilotOrg = Organization::create(['name' => 'Example Org', 'slug' => 'example-org']);
        config(['services.pilot.single_tenant_org_slug' => 'example-org']);

        $inviteToken = Str::random(32);
        $inviteId = DB::table('invites')->insertGetId([
            'token' => $inviteToken,
            'organization_id' => $pilotOrg->id,
            'email' => 'dev@example.com',
            'role' => 'member',
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('ide_connect_codes')->insert([
            'code' => 'ABC123',
            'invite_id' => $inviteId,
            'organization_id' => $pilotOrg->id,
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $state = $this->getRedirectState("invite_token={$inviteToken}");

        Http::fake([
            'github.com/login/oauth/access_token' => Http::response(
                'access_token=fake_token&token_type=bearer&scope=read%3Auser%2Cuser%3Aemail',
                200,
                ['Content-Type' => 'application/x-www-form-urlencoded']
            ),
            'api.github.com/user' => Http::response([
                'id' => '333333333',
                'login' => 'dev-enrollee',
                'email' => 'dev@example.com',
                'name' => 'Dev Enrollee',
            ], 200),
            'api.github.com/user/emails' => Http::response([
                ['email' => 'dev@example.com', 'primary' => true, 'verified' => true]
            ], 200),
        ]);

        $response = $this->getJson("/api/github/oauth/callback?code=fake&state={$state}");

        $response->assertStatus(403);
        $response->assertJsonPath('error', 'DEVELOPER_ENROLLMENT_INVITE');
        $this->assertNull(User::where('github_id', '333333333')->first());
    }

    public function test_pilot_mode_does_not_create_stray_organization_on_unknown_login(): void
    {
        Organization::create(['name' => 'Example Org', 'slug' => 'example-org']);
        config(['services.pilot.single_tenant_org_slug' => 'example-org']);

        $state = $this->getRedirectState();
        Http::fake([
            'github.com/login/oauth/access_token' => Http::response(
                'access_token=fake_token&token_type=bearer&scope=read%3Auser%2Cuser%3Aemail',
                200,
                ['Content-Type' => 'application/x-www-form-urlencoded']
            ),
            'api.github.com/user' => Http::response([
                'id' => '777777777',
                'login' => 'stray-user',
                'email' => 'stray@example.com',
                'name' => 'Stray User',
            ], 200),
            'api.github.com/user/emails' => Http::response([
                ['email' => 'stray@example.com', 'primary' => true, 'verified' => true]
            ], 200),
        ]);

        $beforeCount = Organization::count();
        $this->getJson("/api/github/oauth/callback?code=fake&state={$state}")->assertStatus(403);
        $this->assertEquals($beforeCount, Organization::count(), 'No stray organization should be created');
    }

    public function test_member_cannot_initiate_engineering_data_oauth(): void
    {
        $org = Organization::create(['name' => 'Test Org', 'slug' => 'test-org']);
        $member = User::create([
            'name' => 'Member',
            'email' => 'member@example.com',
            'password' => \Illuminate\Support\Facades\Hash::make(Str::random(32)),
            'github_id' => '555555555',
            'organization_id' => $org->id,
            'role' => 'member',
        ]);
        $token = $this->createDashboardToken($org->id, $member->id);

        $this->withToken($token)
            ->getJson('/api/github/oauth/redirect?intent=engineering')
            ->assertStatus(403)
            ->assertJsonPath('error', 'ADMIN_REQUIRED');
    }

    public function test_admin_can_initiate_engineering_data_oauth(): void
    {
        $org = Organization::create(['name' => 'Test Org', 'slug' => 'test-org']);
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@example.com',
            'password' => \Illuminate\Support\Facades\Hash::make(Str::random(32)),
            'github_id' => '666666666',
            'organization_id' => $org->id,
            'role' => 'admin',
        ]);
        $token = $this->createDashboardToken($org->id, $admin->id);

        $this->withToken($token)
            ->getJson('/api/github/oauth/redirect?intent=engineering')
            ->assertStatus(200)
            ->assertJsonPath('auth_url', fn ($url) => str_contains($url, 'scope='));
    }
}
