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
 * PILOT OPS — Engineering OAuth initiating-user binding.
 *
 * Regression suite for the Stacks/Martina defect: the engineering callback
 * resolved the local user ONLY by github_id.  A password/invite-created
 * dashboard user (github_id NULL) fell into new-user admission and was
 * rejected with DASHBOARD_INVITE_REQUIRED, making intent=engineering
 * structurally unreachable for every non-GitHub-identity dashboard user.
 *
 * Contract under test:
 *   - redirect stores initiating_user_id + initiating_org_id + intent in
 *     the verified OAuth state
 *   - engineering callback attaches engineering_integration to the
 *     INITIATING dashboard user, never by github_id
 *   - github_id is never written onto the dashboard user
 *   - missing/invalid initiating_user_id, org mismatch, and non-admin
 *     initiators all fail closed before the GitHub exchange/admission
 *   - support logins never become engineering authority
 *   - intent=login admission gate is unchanged
 *   - ordinary login can never overwrite an engineering credential
 *
 * Tests run against an isolated in-memory SQLite database.
 * Http::fake() simulates all GitHub API responses — no live OAuth occurs.
 */
class OAuthEngineeringInitiatorTest extends TestCase
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

    private function runCallback(string $state, array $githubUser, ?string $accessToken = null)
    {
        $this->githubUser = $githubUser;
        $this->tokenQueue[] = $accessToken ?? ('gho_test_' . Str::random(24));

        return $this->getJson("/api/github/oauth/callback?code=fake_code&state={$state}");
    }

    /**
     * Insert a pending OAuth state row directly — used to exercise the
     * callback against forged/legacy states that the redirect would never
     * emit (missing fields, mismatched org, non-admin initiator).
     */
    private function insertPendingState(array $stateData): string
    {
        $state = Str::random(40);
        DB::table('oauth_tokens')->insert([
            'user_id' => 0,
            'access_token' => 'pending',
            'oauth_state' => $state,
            'user_data' => json_encode($stateData),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        return $state;
    }

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

    // ─── A. STATE BINDING ───────────────────────────────────────────

    public function test_engineering_redirect_binds_initiating_user_and_org_in_state(): void
    {
        $org = $this->createOrg();
        $user = $this->createUser($org); // github_id NULL — password/invite-created
        $bearer = $this->createDashboardToken($org->id, $user->id);

        $this->startOAuthFlow('intent=engineering', $bearer);

        $pending = DB::table('oauth_tokens')->where('user_id', 0)->first();
        $this->assertNotNull($pending);
        $data = json_decode($pending->user_data, true);
        $this->assertEquals('engineering', $data['oauth_intent'] ?? null);
        $this->assertEquals($org->id, $data['initiating_org_id'] ?? null);
        $this->assertEquals($user->id, $data['initiating_user_id'] ?? null,
            'engineering state must bind the initiating dashboard user');
    }

    // ─── B. THE MARTINA SCENARIO ────────────────────────────────────

    public function test_password_created_admin_without_github_id_completes_engineering_oauth(): void
    {
        // Pilot mode — the admission gate that rejected Martina is armed.
        $org = $this->createOrg('pilot-org');
        config(['services.pilot.single_tenant_org_slug' => $org->slug]);

        // Password/invite-created dashboard admin — github_id NULL.
        $user = $this->createUser($org, [
            'email' => 'martina@customer.test',
            'github_id' => null,
        ]);
        $bearer = $this->createDashboardToken($org->id, $user->id);

        // GitHub returns an identity that matches NO local user by github_id
        // and shares the dashboard user's email — the two traps that made
        // engineering unreachable (admission gate + EMAIL_ALREADY_EXISTS).
        $ghUser = [
            'id' => 99001,
            'login' => 'martina-gh',
            'name' => 'Martina',
            'email' => 'martina@customer.test',
        ];

        $state = $this->startOAuthFlow('intent=engineering', $bearer);
        $this->runCallback($state, $ghUser, 'gho_martina_eng')->assertStatus(302);

        // Engineering credential attached to the initiating user + org.
        $rows = $this->credentialRows($user->id);
        $this->assertCount(1, $rows);
        $this->assertArrayHasKey('engineering_integration', $rows);
        $this->assertEquals('gho_martina_eng', $rows['engineering_integration']->access_token);
        $this->assertEquals($org->id, $rows['engineering_integration']->organization_id);

        // Dashboard identity untouched — github_id must NOT be written.
        $this->assertNull(User::find($user->id)->github_id,
            'engineering attach must not convert the dashboard user into a GitHub-identity user');

        // No new user was created.
        $this->assertEquals(1, User::count());
    }

    // ─── C. FAIL-CLOSED INITIATOR VALIDATION ────────────────────────

    public function test_engineering_state_missing_initiating_user_fails_closed(): void
    {
        $org = $this->createOrg();

        // Legacy/forged engineering state without initiating_user_id.
        $state = $this->insertPendingState([
            'oauth_intent' => 'engineering',
            'initiating_org_id' => $org->id,
        ]);

        $response = $this->runCallback($state, [
            'id' => 99002, 'login' => 'attacker', 'email' => 'a@b.c',
        ]);

        $response->assertStatus(403);
        $this->assertEquals('ENGINEERING_INITIATOR_INVALID', $response->json('error'));
        $this->assertEquals(0, DB::table('oauth_tokens')
            ->where('access_token', '!=', 'pending')->count(),
            'no credential may be written from an initiator-less engineering state');
    }

    public function test_engineering_state_with_deleted_initiating_user_fails_closed(): void
    {
        $org = $this->createOrg();

        $state = $this->insertPendingState([
            'oauth_intent' => 'engineering',
            'initiating_org_id' => $org->id,
            'initiating_user_id' => 999999, // user no longer exists
        ]);

        $response = $this->runCallback($state, [
            'id' => 99003, 'login' => 'ghost', 'email' => 'g@h.i',
        ]);

        $response->assertStatus(403);
        $this->assertEquals('ENGINEERING_INITIATOR_INVALID', $response->json('error'));
    }

    public function test_engineering_initiator_org_mismatch_fails_closed(): void
    {
        $orgA = $this->createOrg('org-a');
        $orgB = $this->createOrg('org-b');
        $user = $this->createUser($orgA);

        // State claims the connect was initiated for org B, but the
        // initiating user belongs to org A — fail closed.
        $state = $this->insertPendingState([
            'oauth_intent' => 'engineering',
            'initiating_org_id' => $orgB->id,
            'initiating_user_id' => $user->id,
        ]);

        $response = $this->runCallback($state, [
            'id' => 99004, 'login' => 'mismatch', 'email' => 'm@n.o',
        ]);

        $response->assertStatus(403);
        $this->assertEquals('ENGINEERING_ORG_MISMATCH', $response->json('error'));
        $this->assertEmpty($this->credentialRows($user->id));
    }

    public function test_engineering_initiator_non_admin_fails_closed(): void
    {
        $org = $this->createOrg();
        $member = $this->createUser($org, ['role' => 'member']);

        // The redirect already rejects non-admin Bearer tokens; this proves
        // the callback also fails closed on a forged/mismatched state.
        $state = $this->insertPendingState([
            'oauth_intent' => 'engineering',
            'initiating_org_id' => $org->id,
            'initiating_user_id' => $member->id,
        ]);

        $response = $this->runCallback($state, [
            'id' => 99005, 'login' => 'memberuser', 'email' => 'm@m.m',
        ]);

        $response->assertStatus(403);
        $this->assertEquals('ADMIN_REQUIRED', $response->json('error'));
        $this->assertEmpty($this->credentialRows($member->id));
    }

    // ─── D. SUPPORT LOGIN ───────────────────────────────────────────

    public function test_support_login_cannot_become_engineering_authority(): void
    {
        config(['services.pilot.support_github_logins' => 'support-gh']);

        $org = $this->createOrg();
        $user = $this->createUser($org); // customer admin initiator
        $bearer = $this->createDashboardToken($org->id, $user->id);

        $state = $this->startOAuthFlow('intent=engineering', $bearer);
        $this->runCallback($state, [
            'id' => 99006,
            'login' => 'support-gh', // the connected GitHub account is a support login
            'email' => 'support@chaosmonkey.dev',
        ], 'gho_support_attempt')->assertStatus(302);

        $rows = $this->credentialRows($user->id);
        $this->assertArrayNotHasKey('engineering_integration', $rows,
            'a support GitHub login must never yield engineering authority');
        $this->assertArrayHasKey('identity_only', $rows);
    }

    // ─── E. LOGIN PLANE UNCHANGED ───────────────────────────────────

    public function test_login_intent_still_requires_dashboard_admission(): void
    {
        // Pilot mode armed, org exists, no invite_context — the exact gate
        // Martina's plain GitHub login hit.
        $org = $this->createOrg('pilot-org');
        config(['services.pilot.single_tenant_org_slug' => $org->slug]);

        $state = $this->startOAuthFlow('intent=login');
        $response = $this->runCallback($state, [
            'id' => 99007, 'login' => 'newface', 'email' => 'new@face.test',
        ]);

        $response->assertStatus(403);
        $this->assertEquals('DASHBOARD_INVITE_REQUIRED', $response->json('error'));
    }

    public function test_login_after_engineering_cannot_overwrite_engineering_credential(): void
    {
        $org = $this->createOrg('pilot-org');
        config(['services.pilot.single_tenant_org_slug' => $org->slug]);

        $user = $this->createUser($org, ['github_id' => null]);
        $bearer = $this->createDashboardToken($org->id, $user->id);
        $ghUser = ['id' => 99008, 'login' => 'martina-gh', 'email' => 'm@c.test'];

        // Engineering credential established via initiator binding.
        $state = $this->startOAuthFlow('intent=engineering', $bearer);
        $this->runCallback($state, $ghUser, 'gho_eng_keep')->assertStatus(302);
        $engRow = $this->credentialRows($user->id)['engineering_integration'];

        // A subsequent ordinary GitHub login for an unlinked github_id hits
        // the admission gate in pilot mode — and must leave the engineering
        // credential byte-identical regardless.
        $state = $this->startOAuthFlow('intent=login');
        $this->runCallback($state, $ghUser, 'gho_identity_attempt');

        $rows = $this->credentialRows($user->id);
        $this->assertCount(1, $rows);
        $this->assertEquals($engRow->id, $rows['engineering_integration']->id);
        $this->assertEquals('gho_eng_keep', $rows['engineering_integration']->access_token);
    }
}
