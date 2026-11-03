<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Pilot Ops 28.1 — canonical pilots sit behind same-host nginx TLS termination
 * (loopback proxy). TrustProxies is scoped to loopback so customer-facing
 * URLs generate as https:// and client IPs resolve correctly, while forwarded
 * headers from untrusted sources are ignored.
 */
class TrustedProxyUrlGenerationTest extends TestCase
{
    private Organization $organization;
    private User $admin;
    private string $tokenRaw;

    protected function setUp(): void
    {
        parent::setUp();

        Mail::fake();

        $this->assertTrue(app()->environment('testing'), 'Refusing to run: APP_ENV is not testing');
        $this->assertEquals('sqlite', config('database.default'), 'Refusing to run: database driver is not sqlite');
        $this->assertEquals(':memory:', config('database.connections.sqlite.database'), 'Refusing to run: SQLite database is not :memory:');

        $this->createTables();

        $this->organization = Organization::create([
            'name' => 'Proxy Test Org',
            'slug' => 'proxy-test-' . Str::random(6),
        ]);

        $this->admin = User::create([
            'name' => 'Proxy Admin',
            'email' => 'admin-' . Str::random(8) . '@proxy.test',
            'password' => bcrypt('password'),
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->tokenRaw = 'proxy-token-' . Str::random(32);
        ApiToken::create([
            'token' => hash('sha256', $this->tokenRaw),
            'user_id' => $this->admin->id,
            'organization_id' => $this->organization->id,
            'expires_at' => now()->addDays(1),
        ]);
    }

    protected function tearDown(): void
    {
        if (app()->environment('testing')
            && config('database.default') === 'sqlite'
            && config('database.connections.sqlite.database') === ':memory:'
        ) {
            Schema::dropIfExists('api_tokens');
            Schema::dropIfExists('oauth_tokens');
            Schema::dropIfExists('invites');
            Schema::dropIfExists('users');
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
                $table->string('slug')->unique();
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
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->string('role')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('invites')) {
            Schema::create('invites', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('token', 64)->unique();
                $table->string('email')->nullable();
                $table->string('role')->nullable();
                $table->timestamp('expires_at');
                $table->timestamp('redeemed_at')->nullable();
                $table->foreignId('redeemed_by_user_id')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('oauth_tokens')) {
            Schema::create('oauth_tokens', function ($table) {
                $table->id();
                $table->unsignedBigInteger('user_id');
                $table->text('access_token');
                $table->json('user_data');
                $table->string('oauth_state')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('api_tokens')) {
            Schema::create('api_tokens', function ($table) {
                $table->id();
                $table->string('token', 64)->unique();
                $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->foreignId('invite_id')->nullable()->constrained('invites')->nullOnDelete();
                $table->string('installation_id', 64)->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->timestamp('revoked_at')->nullable();
                $table->timestamps();
            });
        }
    }

    private function nginxForwardedRequest(): array
    {
        // Shape of a real nginx -> loopback php -S hop: REMOTE_ADDR is loopback
        // and X-Forwarded-* carries the outer (client-facing) request.
        return [
            'server' => ['REMOTE_ADDR' => '127.0.0.1'],
            'headers' => [
                'Authorization' => 'Bearer ' . $this->tokenRaw,
                'X-Forwarded-Proto' => 'https',
                'X-Forwarded-For' => '203.0.113.10',
                'Host' => 'decisions.chaosmonkey.dev',
            ],
        ];
    }

    public function test_enrollment_shareable_url_is_https_behind_trusted_nginx(): void
    {
        $hop = $this->nginxForwardedRequest();

        $response = $this->withServerVariables($hop['server'])
            ->withHeaders($hop['headers'])
            ->postJson('/api/org/invites', [
                'purpose' => 'developer_enrollment',
                'role' => 'member',
                'email' => 'dev@customer.example',
                'send_email' => false,
            ]);

        $response->assertStatus(200);
        $url = $response->json('invite.shareable_url') ?? $response->json('shareable_url');
        $this->assertNotNull($url);
        $this->assertStringStartsWith('https://', $url);
        $this->assertStringContainsString('/invite/', $url);
        $this->assertStringNotContainsString('http://', $url);
        $this->assertStringNotContainsString('/api/api', $url);
    }

    public function test_forwarded_proto_from_untrusted_source_is_ignored(): void
    {
        // A direct client (non-loopback REMOTE_ADDR) cannot spoof scheme.
        $response = $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.99'])
            ->withHeaders([
                'Authorization' => 'Bearer ' . $this->tokenRaw,
                'X-Forwarded-Proto' => 'https',
                'Host' => 'decisions.chaosmonkey.dev',
            ])
            ->postJson('/api/org/invites', [
                'purpose' => 'developer_enrollment',
                'role' => 'member',
                'email' => 'dev@customer.example',
                'send_email' => false,
            ]);

        $response->assertStatus(200);
        $url = $response->json('invite.shareable_url') ?? $response->json('shareable_url');
        $this->assertNotNull($url);
        $this->assertStringStartsWith('http://', $url);
    }

    public function test_forwarded_client_ip_is_resolved_for_trusted_proxy(): void
    {
        $hop = $this->nginxForwardedRequest();

        $response = $this->withServerVariables($hop['server'])
            ->withHeaders($hop['headers'])
            ->postJson('/api/org/invites', [
                'purpose' => 'developer_enrollment',
                'role' => 'member',
                'email' => 'dev2@customer.example',
                'send_email' => false,
            ]);

        $response->assertStatus(200);
        $this->assertEquals('203.0.113.10', request()->ip());
    }

    public function test_oauth_redirect_callback_remains_configured_https(): void
    {
        config(['services.github.redirect' => 'https://decisions.chaosmonkey.dev/api/github/oauth/callback']);

        $hop = $this->nginxForwardedRequest();
        $response = $this->withServerVariables($hop['server'])
            ->withHeaders($hop['headers'])
            ->getJson('/api/github/oauth/redirect');

        $response->assertStatus(200);
        $authUrl = $response->json('auth_url');
        $this->assertNotNull($authUrl);
        $this->assertStringContainsString('redirect_uri=https%3A%2F%2Fdecisions.chaosmonkey.dev%2Fapi%2Fgithub%2Foauth%2Fcallback', $authUrl);
        $this->assertStringNotContainsString('api%2Fapi', $authUrl);
    }

    public function test_plain_loopback_request_still_works(): void
    {
        // Direct loopback call with no forwarded headers (health probe shape).
        $response = $this->withServerVariables(['REMOTE_ADDR' => '127.0.0.1'])
            ->getJson('/api/health');

        $response->assertStatus(200);
    }

    public function test_bearer_auth_unchanged_behind_proxy(): void
    {
        $hop = $this->nginxForwardedRequest();

        // Unauthenticated check first: a successful Bearer request logs the
        // user into the session guard, which persists within the test.
        $bad = $this->withServerVariables($hop['server'])
            ->withHeaders(array_diff_key($hop['headers'], ['Authorization' => true]))
            ->postJson('/api/org/invites', [
                'purpose' => 'developer_enrollment',
                'role' => 'member',
                'email' => 'dev4@customer.example',
                'send_email' => false,
            ]);
        $bad->assertStatus(401);

        $ok = $this->withServerVariables($hop['server'])
            ->withHeaders($hop['headers'])
            ->postJson('/api/org/invites', [
                'purpose' => 'developer_enrollment',
                'role' => 'member',
                'email' => 'dev3@customer.example',
                'send_email' => false,
            ]);
        $ok->assertStatus(200);
    }
}
