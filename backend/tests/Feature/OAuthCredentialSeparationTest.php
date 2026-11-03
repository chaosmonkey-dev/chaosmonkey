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
 * PILOT OPS 18G: GitHub identity auth vs engineering integration separation.
 *
 * Regression suite for the 18F canonical defect: oauth_tokens effectively
 * kept one row per user_id, so an ordinary GitHub dashboard login overwrote
 * a valid engineering_integration credential with identity_only and
 * silently destroyed org engineering authority.
 *
 * Contract under test:
 *   - login and engineering credentials persist in separate purpose-scoped rows
 *   - ENGINEERING → LOGIN no longer destroys engineering authority
 *   - LOGIN → ENGINEERING keeps both credentials usable
 *   - engineering reconnect refreshes only the engineering row
 *   - org binding / initiating_org_id mismatch remains fail-closed
 *   - ordinary login can never produce engineering evidence
 *   - support logins are never engineering authority
 *   - legacy rows (no token_purpose) remain usable and are not reclassified
 *
 * Tests run against an isolated in-memory SQLite database.
 * Http::fake() simulates all GitHub API responses — no live OAuth occurs.
 */
class OAuthCredentialSeparationTest extends TestCase
{
    private ?string $savedPilotSlug = null;
    private ?string $savedSupportLogins = null;

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

        $this->savedPilotSlug = config('services.pilot.single_tenant_org_slug');
        $this->savedSupportLogins = config('services.pilot.support_github_logins');
        config(['services.pilot.single_tenant_org_slug' => null]);
        config(['services.pilot.support_github_logins' => '']);

        $this->createTables();

        // Single closure fake for the whole test — repeated Http::fake()
        // calls stack stubs (first match wins), so per-callback responses
        // must be driven through shared state instead.
        Http::preventStrayRequests();
        Http::fake(function ($request) {
            $url = $request->url();
            if (str_contains($url, 'github.com/login/oauth/access_token')) {
                $token = array_shift($this->tokenQueue) ?? ('gho_auto_' . Str::random(16));
                return Http::response(
                    'access_token=' . $token . '&token_type=bearer&scope=read%3Auser%2Cuser%3Aemail',
                    200,
                    ['Content-Type' => 'application/x-www-form-urlencoded']
                );
            }
            if (str_contains($url, 'api.github.com/user/emails')) {
                return Http::response([
                    ['email' => $this->githubUser['email'] ?? 'test@test.com', 'primary' => true, 'verified' => true]
                ], 200);
            }
            if (str_contains($url, 'api.github.com/user')) {
                return Http::response($this->githubUser ?? [], 200);
            }
            if (str_contains($url, 'api.github.com/')) {
                return Http::response([], 200);
            }
            return Http::response('', 404);
        });
    }

    private array $tokenQueue = [];
    private ?array $githubUser = null;

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

        config(['services.pilot.single_tenant_org_slug' => $this->savedPilotSlug]);
        config(['services.pilot.support_github_logins' => $this->savedSupportLogins ?? '']);

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
                $table->foreignId('organization_id')->nullable();
                $table->json('metadata')->nullable();
                $table->timestamps();
            });
        }
    }

    // ─── Helpers ────────────────────────────────────────────────────

    private function createOrg(string $slug = 'test-org'): Organization
    {
        return Organization::create([
            'name' => 'Test Org',
            'slug' => $slug . '-' . Str::random(6),
        ]);
    }

    private function createUser(Organization $org, array $attrs = []): User
    {
        return User::create(array_merge([
            'name' => 'Test User',
            'email' => 'user-' . Str::random(6) . '@test.com',
            'password' => \Illuminate\Support\Facades\Hash::make(Str::random(32)),
            'organization_id' => $org->id,
            'role' => 'admin',
        ], $attrs));
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
     * Start an OAuth flow and return the verified state parameter.
     */
    private function startOAuthFlow(string $queryString = '', ?string $bearerToken = null): string
    {
        $url = '/api/github/oauth/redirect' . ($queryString ? "?{$queryString}" : '');
        $headers = $bearerToken ? ['Authorization' => 'Bearer ' . $bearerToken] : [];
        $response = $this->getJson($url, $headers);

        $this->assertEquals(200, $response->status(), "Redirect failed for: {$queryString}");
        $authUrl = $response->json('auth_url');
        $this->assertNotNull($authUrl);

        parse_str(parse_url($authUrl, PHP_URL_QUERY), $params);
        return $params['state'] ?? '';
    }

    /**
     * Return the scope string GitHub was redirected with.
     */
    private function startOAuthFlowScope(string $queryString = '', ?string $bearerToken = null): string
    {
        $url = '/api/github/oauth/redirect' . ($queryString ? "?{$queryString}" : '');
        $headers = $bearerToken ? ['Authorization' => 'Bearer ' . $bearerToken] : [];
        $response = $this->getJson($url, $headers);
        $authUrl = $response->json('auth_url');
        parse_str(parse_url($authUrl, PHP_URL_QUERY), $params);
        return $params['scope'] ?? '';
    }

    /**
     * Run the OAuth callback against the fake GitHub for a given GitHub user.
     * $githubUser must include 'id' and 'login'; extra keys (e.g.
     * 'repositories') are persisted into user_data exactly like the real
     * /user response payload.
     */
    private function runCallback(string $state, array $githubUser, ?string $accessToken = null)
    {
        $this->githubUser = $githubUser;
        $this->tokenQueue[] = $accessToken ?? ('gho_test_' . Str::random(24));

        return $this->getJson("/api/github/oauth/callback?code=fake_code&state={$state}");
    }

    /**
     * All non-pending oauth_tokens rows for a user, as [purpose => row].
     */
    private function credentialRows(int $userId): array
    {
        $rows = DB::table('oauth_tokens')
            ->where('user_id', $userId)
            ->where('access_token', '!=', 'pending')
            ->get();

        $byPurpose = [];
        foreach ($rows as $row) {
            $purpose = json_decode($row->user_data ?? '{}', true)['token_purpose'] ?? '(none)';
            $byPurpose[$purpose] = $row;
        }
        return $byPurpose;
    }

    private function purposeOf(object $row): ?string
    {
        return json_decode($row->user_data ?? '{}', true)['token_purpose'] ?? null;
    }

    // ─── A. LOGIN → ENGINEERING ─────────────────────────────────────

    public function test_login_then_engineering_keeps_both_credentials(): void
    {
        $org = $this->createOrg();
        $user = $this->createUser($org, ['github_id' => 77001]);
        $bearer = $this->createDashboardToken($org->id, $user->id);
        $ghUser = ['id' => 77001, 'login' => 'dualuser', 'name' => 'Dual', 'email' => 'dual@test.com'];

        // 1. Ordinary login creates the identity credential
        $state = $this->startOAuthFlow('intent=login');
        $this->runCallback($state, $ghUser, 'gho_identity_1')->assertStatus(302);

        $rows = $this->credentialRows($user->id);
        $this->assertCount(1, $rows);
        $this->assertArrayHasKey('identity_only', $rows);

        // 2. Engineering OAuth completes — must NOT touch the identity row
        $state = $this->startOAuthFlow('intent=engineering', $bearer);
        $this->runCallback($state, $ghUser, 'gho_engineering_1')->assertStatus(302);

        $rows = $this->credentialRows($user->id);
        $this->assertCount(2, $rows, 'identity and engineering credentials must coexist');
        $this->assertEquals('gho_identity_1', $rows['identity_only']->access_token,
            'identity credential must remain intact');
        $this->assertEquals('gho_engineering_1', $rows['engineering_integration']->access_token);

        // 3. Identity login still works — a fresh login refreshes only the identity row
        $state = $this->startOAuthFlow('intent=login');
        $response = $this->runCallback($state, $ghUser, 'gho_identity_2');
        $response->assertStatus(302);
        $this->assertStringContainsString('handoff_code=', $response->headers->get('Location'));

        $rows = $this->credentialRows($user->id);
        $this->assertCount(2, $rows);
        $this->assertEquals('gho_identity_2', $rows['identity_only']->access_token);
        $this->assertEquals('gho_engineering_1', $rows['engineering_integration']->access_token,
            'engineering token must survive subsequent logins');

        // 4. Engineering authority still resolves + repo authority path intact
        $status = $this->getJson('/api/github/oauth/status');
        $status->assertStatus(200);
        $status->assertJsonPath('token_purpose', 'engineering_integration');
    }

    // ─── B. ENGINEERING → LOGIN  (THE 18F BUG) ─────────────────────

    public function test_engineering_then_login_preserves_engineering_authority(): void
    {
        $org = $this->createOrg('pilot-org');
        $user = $this->createUser($org, ['github_id' => 77002]);
        $bearer = $this->createDashboardToken($org->id, $user->id);

        // Pilot mode: status resolves the org-scoped engineering token
        $pilotOrg = Organization::find($org->id);
        config(['services.pilot.single_tenant_org_slug' => $pilotOrg->slug]);

        // Customer telemetry repo universe so repo authority can resolve
        DB::table('telemetry_events')->insert([
            'event_type' => 'session',
            'organization_id' => $org->id,
            'metadata' => json_encode([
                'segment_type' => 'session',
                'git_repo_url' => 'https://github.com/acme/widgets',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $ghUser = [
            'id' => 77002,
            'login' => 'enguser',
            'name' => 'Eng User',
            'email' => 'eng@test.com',
            'repositories' => ['acme/widgets'],
        ];

        // 1. Valid engineering integration is established
        $state = $this->startOAuthFlow('intent=engineering', $bearer);
        $this->runCallback($state, $ghUser, 'gho_engineering_authority')->assertStatus(302);

        $rows = $this->credentialRows($user->id);
        $this->assertCount(1, $rows);
        $engRowId = $rows['engineering_integration']->id;

        // 2. Ordinary GitHub login occurs afterward — THE 18F BUG PATH
        $state = $this->startOAuthFlow('intent=login');
        $this->runCallback($state, $ghUser, 'gho_identity_later')->assertStatus(302);

        // 3. Engineering integration STILL EXISTS and is unchanged
        $rows = $this->credentialRows($user->id);
        $this->assertCount(2, $rows, 'login must create a separate identity row');
        $this->assertArrayHasKey('engineering_integration', $rows);
        $this->assertEquals($engRowId, $rows['engineering_integration']->id,
            'engineering row must be preserved, not overwritten');
        $this->assertEquals('gho_engineering_authority', $rows['engineering_integration']->access_token,
            'engineering access token must not be replaced by the login token');
        $this->assertEquals('identity_only', $this->purposeOf($rows['identity_only']));

        // 4. /api/github/oauth/status still resolves the engineering credential
        $status = $this->getJson('/api/github/oauth/status');
        $status->assertStatus(200);
        $status->assertJsonPath('oauth_authenticated', true);
        $status->assertJsonPath('token_purpose', 'engineering_integration');

        // 5. Repo authority still resolves through the engineering token
        //    (telemetry repo acme/widgets ∩ token-visible repositories)
        $status->assertJsonPath('repo_authority', true);
    }

    // ─── C. ENGINEERING RECONNECT ───────────────────────────────────

    public function test_engineering_reconnect_refreshes_only_the_engineering_row(): void
    {
        $org = $this->createOrg();
        $user = $this->createUser($org, ['github_id' => 77003]);
        $bearer = $this->createDashboardToken($org->id, $user->id);
        $ghUser = ['id' => 77003, 'login' => 'reconnect', 'name' => 'Re', 'email' => 're@test.com'];

        // Establish both credentials
        $state = $this->startOAuthFlow('intent=login');
        $this->runCallback($state, $ghUser, 'gho_identity_keep')->assertStatus(302);
        $state = $this->startOAuthFlow('intent=engineering', $bearer);
        $this->runCallback($state, $ghUser, 'gho_eng_v1')->assertStatus(302);

        $rows = $this->credentialRows($user->id);
        $engRowId = $rows['engineering_integration']->id;
        $identityRowId = $rows['identity_only']->id;

        // Engineering reconnect — same row updated in place, identity untouched
        $state = $this->startOAuthFlow('intent=engineering', $bearer);
        $this->runCallback($state, $ghUser, 'gho_eng_v2')->assertStatus(302);

        $rows = $this->credentialRows($user->id);
        $this->assertCount(2, $rows, 'reconnect must not create duplicate engineering rows');
        $this->assertEquals($engRowId, $rows['engineering_integration']->id,
            'reconnect must update the existing engineering row');
        $this->assertEquals('gho_eng_v2', $rows['engineering_integration']->access_token);
        $this->assertEquals($identityRowId, $rows['identity_only']->id);
        $this->assertEquals('gho_identity_keep', $rows['identity_only']->access_token,
            'identity credential must remain intact across engineering reconnect');
    }

    // ─── D. ORG BINDING / FAIL-CLOSED ───────────────────────────────

    public function test_engineering_org_mismatch_fails_closed_and_preserves_engineering_row(): void
    {
        $orgA = $this->createOrg('org-a');
        $orgB = $this->createOrg('org-b');
        $user = $this->createUser($orgA, ['github_id' => 77004]);
        $adminA = $this->createDashboardToken($orgA->id, $user->id);
        $ghUser = ['id' => 77004, 'login' => 'orgmover', 'name' => 'Mover', 'email' => 'mover@test.com'];

        // 1. Engineering integration established for org A
        $state = $this->startOAuthFlow('intent=engineering', $adminA);
        $this->runCallback($state, $ghUser, 'gho_eng_orgA')->assertStatus(302);

        $rows = $this->credentialRows($user->id);
        $engRow = $rows['engineering_integration'];
        $this->assertEquals($orgA->id, $engRow->organization_id);

        // 2. User's org membership changes to org B
        DB::table('users')->where('id', $user->id)->update(['organization_id' => $orgB->id]);

        // 3. An engineering flow initiated with org A context now mismatches
        //    the initiating user's org — must fail closed (403, no write)
        //    and must NOT overwrite or move the existing org A engineering row.
        $state = $this->startOAuthFlow('intent=engineering', $adminA);
        $this->runCallback($state, $ghUser, 'gho_mismatch_token')->assertStatus(403);

        $rows = $this->credentialRows($user->id);
        $this->assertArrayHasKey('engineering_integration', $rows,
            'engineering credential must survive a mismatched callback');
        $this->assertEquals($engRow->id, $rows['engineering_integration']->id);
        $this->assertEquals($orgA->id, $rows['engineering_integration']->organization_id,
            'engineering authority must not be moved to another org');
        $this->assertEquals('gho_eng_orgA', $rows['engineering_integration']->access_token,
            'engineering token must not be replaced by the mismatched flow');

        // The mismatched flow produced no credential at all — hard fail closed
        $this->assertArrayNotHasKey('identity_only', $rows);
    }

    public function test_engineering_intent_without_auth_context_remains_rejected(): void
    {
        $response = $this->getJson('/api/github/oauth/redirect?intent=engineering');
        $response->assertStatus(403);
        $this->assertNull($response->json('auth_url'));
    }

    // ─── E. LOGIN SCOPE / NO ENGINEERING EVIDENCE ──────────────────

    public function test_login_scopes_and_credential_never_become_engineering_evidence(): void
    {
        $org = $this->createOrg();
        $user = $this->createUser($org, ['github_id' => 77005]);
        $ghUser = ['id' => 77005, 'login' => 'plainlogin', 'name' => 'Plain', 'email' => 'plain@test.com'];

        // Login redirect requests only identity scopes
        $scope = $this->startOAuthFlowScope('intent=login');
        $this->assertStringContainsString('read:user', $scope);
        $this->assertStringContainsString('user:email', $scope);
        $this->assertStringNotContainsString('repo', $scope);

        // Login callback writes identity_only and nothing else
        $state = $this->startOAuthFlow('intent=login');
        $this->runCallback($state, $ghUser)->assertStatus(302);

        $rows = $this->credentialRows($user->id);
        $this->assertCount(1, $rows);
        $this->assertArrayHasKey('identity_only', $rows);
        $this->assertArrayNotHasKey('engineering_integration', $rows);

        // Status must not present engineering authority from a login credential
        $status = $this->getJson('/api/github/oauth/status');
        $status->assertStatus(200);
        $status->assertJsonPath('token_purpose', 'identity_only');
    }

    // ─── F. SUPPORT EXCLUSION ───────────────────────────────────────

    public function test_support_login_never_holds_engineering_authority(): void
    {
        config(['services.pilot.support_github_logins' => 'support-gh']);

        $org = $this->createOrg('support-org');
        $user = $this->createUser($org, ['github_id' => 77006]);
        $bearer = $this->createDashboardToken($org->id, $user->id);

        // Even with a verified engineering intent, a support login classifies
        // as identity_only.
        $state = $this->startOAuthFlow('intent=engineering', $bearer);
        $this->runCallback($state, [
            'id' => 77006,
            'login' => 'support-gh',
            'name' => 'Support',
            'email' => 'support@test.com',
        ])->assertStatus(302);

        $rows = $this->credentialRows($user->id);
        $this->assertCount(1, $rows);
        $this->assertArrayHasKey('identity_only', $rows);
        $this->assertArrayNotHasKey('engineering_integration', $rows);

        // Pilot-mode status: support login token must not resolve as the
        // org's engineering credential, nor as the safe metrics token.
        $pilotOrg = Organization::find($org->id);
        config(['services.pilot.single_tenant_org_slug' => $pilotOrg->slug]);

        $status = $this->getJson('/api/github/oauth/status');
        $status->assertStatus(200);
        $this->assertNotEquals('engineering_integration', $status->json('token_purpose'));
    }

    // ─── G. EXISTING DATA COMPATIBILITY ─────────────────────────────

    public function test_legacy_and_existing_rows_remain_usable_without_reclassification(): void
    {
        $org = $this->createOrg();
        $user = $this->createUser($org, ['github_id' => 77007]);
        $bearer = $this->createDashboardToken($org->id, $user->id);
        $ghUser = ['id' => 77007, 'login' => 'legacyuser', 'name' => 'Legacy', 'email' => 'legacy@test.com'];

        // Pre-repair state: a single legacy row with no token_purpose
        // (written before purpose classification existed).
        $legacyId = DB::table('oauth_tokens')->insertGetId([
            'user_id' => $user->id,
            'organization_id' => $org->id,
            'access_token' => 'gho_legacy_token',
            'user_data' => json_encode(['id' => 77007, 'login' => 'legacyuser']),
            'created_at' => now()->subDays(10),
            'updated_at' => now()->subDays(10),
        ]);

        // 1. Engineering connect must NOT consume the legacy row — it inserts
        //    a dedicated engineering row alongside it.
        $state = $this->startOAuthFlow('intent=engineering', $bearer);
        $this->runCallback($state, $ghUser, 'gho_eng_new')->assertStatus(302);

        $rows = $this->credentialRows($user->id);
        $this->assertCount(2, $rows);
        $this->assertArrayHasKey('engineering_integration', $rows);
        $this->assertEquals('gho_eng_new', $rows['engineering_integration']->access_token);

        $legacyRow = DB::table('oauth_tokens')->where('id', $legacyId)->first();
        $this->assertNull($this->purposeOf($legacyRow),
            'legacy row must not be silently reclassified by an engineering connect');
        $this->assertEquals('gho_legacy_token', $legacyRow->access_token);

        // 2. A subsequent ordinary login refreshes the legacy (identity-bucket)
        //    row in place — never the engineering row.
        $state = $this->startOAuthFlow('intent=login');
        $this->runCallback($state, $ghUser, 'gho_login_fresh')->assertStatus(302);

        $rows = $this->credentialRows($user->id);
        $this->assertCount(2, $rows);
        $this->assertEquals($legacyId, $rows['identity_only']->id,
            'login must update the existing identity-bucket row, not insert a third row');
        $this->assertEquals('gho_login_fresh', $rows['identity_only']->access_token);
        $this->assertEquals('gho_eng_new', $rows['engineering_integration']->access_token,
            'engineering credential must survive the login');

        // 3. Engineering authority still resolves for the org
        $status = $this->getJson('/api/github/oauth/status');
        $status->assertJsonPath('token_purpose', 'engineering_integration');
    }

    /**
     * A second user in the same org logging in must not disturb another
     * user's engineering credential.
     */
    public function test_other_user_login_does_not_touch_engineering_credential(): void
    {
        $org = $this->createOrg();
        $engUser = $this->createUser($org, ['github_id' => 77008]);
        $otherUser = $this->createUser($org, ['github_id' => 77009]);
        $bearer = $this->createDashboardToken($org->id, $engUser->id);

        $state = $this->startOAuthFlow('intent=engineering', $bearer);
        $this->runCallback($state, [
            'id' => 77008, 'login' => 'engowner', 'name' => 'Owner', 'email' => 'owner@test.com',
        ], 'gho_eng_owned')->assertStatus(302);

        // A different org member performs an ordinary login
        $state = $this->startOAuthFlow('intent=login');
        $this->runCallback($state, [
            'id' => 77009, 'login' => 'memberuser', 'name' => 'Member', 'email' => 'member@test.com',
        ], 'gho_member_identity')->assertStatus(302);

        $engRows = $this->credentialRows($engUser->id);
        $this->assertEquals('gho_eng_owned', $engRows['engineering_integration']->access_token);

        $status = $this->getJson('/api/github/oauth/status');
        $status->assertJsonPath('token_purpose', 'engineering_integration');
    }

    // ─── H. PRE-18G ENGINEERING ROW + LOGIN ─────────────────────────
    //
    // Unlike test B (which creates the engineering credential through the
    // repaired callback), this seeds the row directly in the exact shape a
    // pre-18G deployment would have persisted it — proving the repaired
    // write SELECTOR, not just the write path, handles existing rows.

    public function test_pre18g_engineering_row_survives_ordinary_login(): void
    {
        $org = $this->createOrg('pilot-org');
        $user = $this->createUser($org, ['github_id' => 77010]);

        // Pilot mode: status resolves the org-scoped engineering token
        $pilotOrg = Organization::find($org->id);
        config(['services.pilot.single_tenant_org_slug' => $pilotOrg->slug]);

        // Customer telemetry repo universe so repo authority can resolve
        DB::table('telemetry_events')->insert([
            'event_type' => 'session',
            'organization_id' => $org->id,
            'metadata' => json_encode([
                'segment_type' => 'session',
                'git_repo_url' => 'https://github.com/acme/widgets',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Seed the exact pre-18G persisted shape: one engineering row,
        // written directly — no repaired-callback involvement.
        $seededEngId = DB::table('oauth_tokens')->insertGetId([
            'user_id' => $user->id,
            'organization_id' => $org->id,
            'access_token' => 'gho_pre18g_engineering',
            'user_data' => json_encode([
                'id' => 77010,
                'login' => 'seededeng',
                'email' => 'seeded@test.com',
                'token_purpose' => 'engineering_integration',
                'repositories' => ['acme/widgets'],
            ]),
            'created_at' => now()->subDays(5),
            'updated_at' => now()->subDays(5),
        ]);

        // Ordinary login — the 18F destructive path — must not touch it
        $ghUser = ['id' => 77010, 'login' => 'seededeng', 'name' => 'Seeded', 'email' => 'seeded@test.com'];
        $state = $this->startOAuthFlow('intent=login');
        $this->runCallback($state, $ghUser, 'gho_identity_after')->assertStatus(302);

        $rows = $this->credentialRows($user->id);
        $this->assertCount(2, $rows, 'login must create a separate identity row');
        $this->assertArrayHasKey('identity_only', $rows);

        $engRow = DB::table('oauth_tokens')->where('id', $seededEngId)->first();
        $this->assertNotNull($engRow, 'seeded engineering row must still exist');
        $this->assertEquals('gho_pre18g_engineering', $engRow->access_token,
            'seeded engineering token must be unchanged');
        $this->assertEquals('engineering_integration', $this->purposeOf($engRow),
            'seeded row must not be reclassified');
        $this->assertEquals($org->id, $engRow->organization_id,
            'seeded row org binding must be unchanged');
        $this->assertEquals('gho_identity_after', $rows['identity_only']->access_token);

        // Engineering authority + repo authority still resolve
        $status = $this->getJson('/api/github/oauth/status');
        $status->assertStatus(200);
        $status->assertJsonPath('token_purpose', 'engineering_integration');
        $status->assertJsonPath('repo_authority', true);
    }

    // ─── I. PRE-18G IDENTITY ROW + ENGINEERING CONNECT ──────────────
    //
    // Seeds the pre-18G identity_only persisted shape directly, then runs
    // an engineering connect — proving the identity row is never consumed
    // or reclassified by an engineering write.

    public function test_pre18g_identity_row_survives_engineering_connect(): void
    {
        $org = $this->createOrg();
        $user = $this->createUser($org, ['github_id' => 77011]);
        $bearer = $this->createDashboardToken($org->id, $user->id);

        // Seed the exact pre-18G persisted shape: one identity row
        $seededIdentityId = DB::table('oauth_tokens')->insertGetId([
            'user_id' => $user->id,
            'organization_id' => $org->id,
            'access_token' => 'gho_pre18g_identity',
            'user_data' => json_encode([
                'id' => 77011,
                'login' => 'seededid',
                'email' => 'seededid@test.com',
                'token_purpose' => 'identity_only',
            ]),
            'created_at' => now()->subDays(5),
            'updated_at' => now()->subDays(5),
        ]);

        // Engineering connect — must insert a dedicated engineering row,
        // never consume or reclassify the seeded identity row.
        $ghUser = ['id' => 77011, 'login' => 'seededid', 'name' => 'Seeded Id', 'email' => 'seededid@test.com'];
        $state = $this->startOAuthFlow('intent=engineering', $bearer);
        $this->runCallback($state, $ghUser, 'gho_eng_fresh')->assertStatus(302);

        $rows = $this->credentialRows($user->id);
        $this->assertCount(2, $rows, 'engineering connect must add a row, not reuse the identity row');
        $this->assertArrayHasKey('engineering_integration', $rows);
        $this->assertEquals('gho_eng_fresh', $rows['engineering_integration']->access_token);
        $this->assertNotEquals($seededIdentityId, $rows['engineering_integration']->id,
            'engineering write must not claim the seeded identity row');

        $identityRow = DB::table('oauth_tokens')->where('id', $seededIdentityId)->first();
        $this->assertNotNull($identityRow, 'seeded identity row must still exist');
        $this->assertEquals('gho_pre18g_identity', $identityRow->access_token,
            'seeded identity token must be unchanged');
        $this->assertEquals('identity_only', $this->purposeOf($identityRow),
            'seeded identity row must not be reclassified');

        // Engineering authority resolves
        $status = $this->getJson('/api/github/oauth/status');
        $status->assertJsonPath('token_purpose', 'engineering_integration');
    }
}
