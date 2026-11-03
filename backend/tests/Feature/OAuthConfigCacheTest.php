<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CR-X P0-0: Config-cache OAuth hardening regression tests.
 *
 * Proves that GitHub OAuth redirect generation works correctly when
 * Laravel config cache semantics are in effect — i.e. that the controller
 * reads GitHub OAuth values via config('services.github.*'), not direct
 * env() calls that return null under config:cache.
 *
 * Contract:
 *   - auth_url contains a NONEMPTY client_id
 *   - redirect_uri / callback is correct
 *   - login scope is exactly read:user,user:email (identity-only)
 *   - state is present and nonempty
 *   - engineering intent (authenticated) still receives repo scope
 *   - secret is never printed/logged in test output
 *
 * These tests set config('services.github.*') directly to simulate
 * config-cached values, then verify the redirect endpoint reads them
 * correctly. This is the deterministic equivalent of running with
 * bootstrap/cache/config.php present.
 */
class OAuthConfigCacheTest extends TestCase
{
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

        // Simulate config-cached GitHub OAuth values.
        // In production with config:cache, these would be resolved from env()
        // at cache-build time and stored in bootstrap/cache/config.php.
        // At runtime, config() returns the cached values; env() returns null.
        config([
            'services.github' => [
                'client_id' => 'test_client_id_' . Str::random(8),
                'client_secret' => 'test_secret_' . Str::random(16),
                'redirect' => 'http://localhost:8010/api/github/oauth/callback',
            ],
        ]);

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
            Schema::dropIfExists('invites');
            Schema::dropIfExists('telemetry_events');
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
     * Extract query params from the auth_url returned by the redirect endpoint.
     */
    private function getRedirectParams(string $queryString = '', ?string $bearerToken = null): array
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
        return $params;
    }

    private function createDashboardToken(int $orgId, int $userId): string
    {
        $rawToken = Str::random(64);
        \App\Models\ApiToken::create([
            'token' => hash('sha256', $rawToken),
            'user_id' => $userId,
            'organization_id' => $orgId,
            'expires_at' => null,
        ]);
        return $rawToken;
    }

    // ─── Config-cache redirect tests ───────────────────────────────

    public function test_login_redirect_has_nonempty_client_id_under_config_cache(): void
    {
        $params = $this->getRedirectParams('intent=login');

        $this->assertNotEmpty($params['client_id'], 'client_id must be nonempty under config-cache semantics');
        $this->assertEquals(
            config('services.github.client_id'),
            $params['client_id'],
            'client_id must come from config(), not env()'
        );
    }

    public function test_login_redirect_has_correct_callback_under_config_cache(): void
    {
        $params = $this->getRedirectParams('intent=login');

        $this->assertNotEmpty($params['redirect_uri'], 'redirect_uri must be present');
        $this->assertEquals(
            config('services.github.redirect'),
            $params['redirect_uri'],
            'redirect_uri must come from config()'
        );
    }

    public function test_login_redirect_has_identity_only_scope_under_config_cache(): void
    {
        $params = $this->getRedirectParams('intent=login');

        $this->assertStringContainsString('read:user', $params['scope']);
        $this->assertStringContainsString('user:email', $params['scope']);
        $this->assertStringNotContainsString('repo', $params['scope']);
    }

    public function test_login_redirect_has_nonempty_state_under_config_cache(): void
    {
        $params = $this->getRedirectParams('intent=login');

        $this->assertNotEmpty($params['state'], 'state must be present and nonempty');
    }

    public function test_missing_intent_defaults_to_login_under_config_cache(): void
    {
        $params = $this->getRedirectParams('');

        $this->assertNotEmpty($params['client_id']);
        $this->assertStringNotContainsString('repo', $params['scope']);
    }

    public function test_engineering_intent_still_receives_repo_scope_under_config_cache(): void
    {
        $org = Organization::create(['name' => 'Eng Org', 'slug' => 'eng-org']);
        $user = User::create([
            'name' => 'Eng Admin',
            'email' => 'engadmin@test.com',
            'password' => \Illuminate\Support\Facades\Hash::make(Str::random(32)),
            'organization_id' => $org->id,
            'role' => 'admin',
        ]);
        $rawToken = $this->createDashboardToken($org->id, $user->id);

        $params = $this->getRedirectParams('intent=engineering', $rawToken);

        $this->assertNotEmpty($params['client_id']);
        $this->assertStringContainsString('read:user', $params['scope']);
        $this->assertStringContainsString('user:email', $params['scope']);
        $this->assertStringContainsString('repo', $params['scope']);
    }

    public function test_unauthenticated_engineering_still_rejected_under_config_cache(): void
    {
        $response = $this->getJson('/api/github/oauth/redirect?intent=engineering');
        $this->assertEquals(403, $response->status());
        $this->assertNull($response->json('auth_url'));
    }

    // ─── Config-backed credential access tests ────────────────────

    public function test_config_services_github_section_exists(): void
    {
        $this->assertNotNull(config('services.github'), 'services.github config section must exist');
        $this->assertNotNull(config('services.github.client_id'), 'client_id key must exist');
        $this->assertNotNull(config('services.github.client_secret'), 'client_secret key must exist');
        $this->assertNotNull(config('services.github.redirect'), 'redirect key must exist');
    }

    public function test_controller_reads_client_id_from_config_not_env(): void
    {
        // Source inspection: controller must not contain env('GITHUB_CLIENT_ID')
        $source = file_get_contents(base_path('app/Http/Controllers/GitHubOAuthController.php'));
        $this->assertStringNotContainsString("env('GITHUB_CLIENT_ID')", $source,
            'Controller must not call env(GITHUB_CLIENT_ID) directly — use config()');
        $this->assertStringNotContainsString("env('GITHUB_CLIENT_SECRET')", $source,
            'Controller must not call env(GITHUB_CLIENT_SECRET) directly — use config()');
        $this->assertStringNotContainsString("env('GITHUB_OAUTH_REDIRECT')", $source,
            'Controller must not call env(GITHUB_OAUTH_REDIRECT) directly — use config()');
        $this->assertStringContainsString("config('services.github.client_id')", $source,
            'Controller must read client_id via config()');
    }

    public function test_config_file_defines_github_section(): void
    {
        $source = file_get_contents(base_path('config/services.php'));
        $this->assertStringContainsString("'github'", $source,
            'config/services.php must define a github section');
        $this->assertStringContainsString("env('GITHUB_CLIENT_ID')", $source,
            'config/services.php must read GITHUB_CLIENT_ID via env() (correct inside config files)');
    }

    // ─── Callback destination config-cache tests ───────────────────

    public function test_callback_uses_configured_frontend_url_not_env(): void
    {
        // Configure a distinctive frontend URL to prove the callback
        // redirect uses config(), not env('APP_FRONTEND_URL').
        $distinctiveUrl = 'https://frontend.config-cache.test';
        config(['app.frontend_url' => $distinctiveUrl]);

        // Initiate OAuth to get a valid state
        $redirectResponse = $this->getJson('/api/github/oauth/redirect?intent=login');
        $this->assertEquals(200, $redirectResponse->status());
        $authUrl = $redirectResponse->json('auth_url');
        parse_str(parse_url($authUrl, PHP_URL_QUERY), $redirectParams);
        $state = $redirectParams['state'];
        $this->assertNotEmpty($state);

        // Pre-create a user so the callback finds an existing user
        $org = Organization::create(['name' => 'Callback Org', 'slug' => 'callback-org']);
        $user = User::create([
            'name' => 'Callback User',
            'email' => 'callback@test.com',
            'password' => \Illuminate\Support\Facades\Hash::make(Str::random(32)),
            'github_id' => '88888',
            'organization_id' => $org->id,
            'role' => 'admin',
        ]);

        // Mock GitHub API responses
        \Illuminate\Support\Facades\Http::fake([
            'github.com/login/oauth/access_token' => \Illuminate\Support\Facades\Http::response(
                'access_token=fake_callback_token&token_type=bearer&scope=read%3Auser%2Cuser%3Aemail',
                200,
                ['Content-Type' => 'application/x-www-form-urlencoded']
            ),
            'api.github.com/user' => \Illuminate\Support\Facades\Http::response([
                'id' => '88888',
                'login' => 'callbackuser',
                'name' => 'Callback User',
                'email' => 'callback@test.com',
            ], 200),
        ]);

        $callbackResponse = $this->getJson("/api/github/oauth/callback?code=fake_code&state={$state}");

        // The callback should redirect (302) to the configured frontend URL
        $this->assertEquals(302, $callbackResponse->status(),
            'Callback should return 302 redirect to frontend');

        $location = $callbackResponse->headers->get('Location');
        $this->assertNotNull($location, 'Redirect Location header must be present');
        $this->assertStringStartsWith(
            $distinctiveUrl . '/callback',
            $location,
            'Callback redirect must use configured frontend URL, not env(APP_FRONTEND_URL)'
        );
        $this->assertStringContainsString('oauth_success=true', $location);
        $this->assertStringContainsString('handoff_code=', $location);

        // No raw dashboard token in the redirect URL
        $this->assertStringNotContainsString('dashboard_token=', $location,
            'Raw dashboard token must never appear in the redirect URL');
    }

    public function test_controller_does_not_call_env_for_frontend_url(): void
    {
        // Source inspection: controller must not use env('APP_FRONTEND_URL')
        $source = file_get_contents(base_path('app/Http/Controllers/GitHubOAuthController.php'));
        $this->assertStringNotContainsString("env('APP_FRONTEND_URL')", $source,
            'Controller must not call env(APP_FRONTEND_URL) directly — use config()');
        $this->assertStringContainsString("config('app.frontend_url')", $source,
            'Controller must read frontend URL via config(app.frontend_url)');
    }

    public function test_pilot_helper_reads_from_config_not_env(): void
    {
        // Source inspection: PilotAwareTokenHelper must not use env() for pilot settings
        $source = file_get_contents(base_path('app/Traits/PilotAwareTokenHelper.php'));
        $this->assertStringNotContainsString("env('PILOT_SINGLE_TENANT_ORG_SLUG')", $source,
            'PilotAwareTokenHelper must not call env(PILOT_SINGLE_TENANT_ORG_SLUG) — use config()');
        $this->assertStringNotContainsString("env('PILOT_SUPPORT_GITHUB_LOGINS')", $source,
            'PilotAwareTokenHelper must not call env(PILOT_SUPPORT_GITHUB_LOGINS) — use config()');
        $this->assertStringNotContainsString("env('PILOT_SINGLE_TENANT_ORG_NAME')", $source,
            'PilotAwareTokenHelper must not call env(PILOT_SINGLE_TENANT_ORG_NAME) — use config()');
        $this->assertStringContainsString("config('services.pilot.", $source,
            'PilotAwareTokenHelper must read pilot config via config(services.pilot.*)');
    }

    public function test_config_file_defines_pilot_section(): void
    {
        $source = file_get_contents(base_path('config/services.php'));
        $this->assertStringContainsString("'pilot'", $source,
            'config/services.php must define a pilot section');
        $this->assertStringContainsString("env('PILOT_SINGLE_TENANT_ORG_SLUG')", $source,
            'config/services.php must read PILOT_SINGLE_TENANT_ORG_SLUG via env()');
        $this->assertStringContainsString("env('PILOT_SUPPORT_GITHUB_LOGINS'", $source,
            'config/services.php must read PILOT_SUPPORT_GITHUB_LOGINS via env()');
    }
}
