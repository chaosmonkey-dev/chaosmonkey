<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Organization;
use App\Models\TelemetryEvent;
use App\Models\User;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class TelemetryIdentityPathTest extends TestCase
{
    private string $dashboardToken;
    protected function setUp(): void
    {
        parent::setUp();

        // Fail closed: only allow Schema operations in an isolated test DB
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
                $table->string('role')->default('member');
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('invites')) {
            Schema::create('invites', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('token', 64)->unique();
                $table->string('email')->nullable();
                $table->string('role')->default('member');
                $table->timestamp('expires_at');
                $table->timestamp('redeemed_at')->nullable();
                $table->foreignId('redeemed_by_user_id')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('api_tokens')) {
            Schema::create('api_tokens', function ($table) {
                $table->id();
                $table->string('token', 64)->unique();
                $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->foreignId('invite_id')->nullable()->constrained('invites')->nullOnDelete();
                $table->string('installation_id', 64)->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->timestamp('revoked_at')->nullable();
                $table->timestamps();
                $table->index('token');
                $table->index('user_id');
            });
        }

        if (!Schema::hasTable('telemetry_events')) {
            Schema::create('telemetry_events', function ($table) {
                $table->id();
                $table->string('user_id')->nullable();
                $table->foreignId('organization_id')->nullable()->index();
                $table->string('session_id')->nullable();
                $table->string('source');
                $table->string('editor_source', 32)->nullable();
                $table->string('event_type')->nullable();
                $table->integer('count')->default(0);
                $table->integer('duration_ms')->nullable();
                $table->timestamp('timestamp')->nullable();
                $table->json('metadata')->nullable();
                $table->json('payload');
                $table->string('batch_hash', 64)->unique();
                $table->string('event_id', 64)->nullable(); // P0-G: per-event idempotency
                $table->integer('session_prs_created')->default(0);
                $table->integer('session_prs_merged')->default(0);
                $table->integer('session_pr_reopen_count')->default(0);
                $table->integer('session_deployment_successes')->default(0);
                $table->timestamps();
            });
        }

        $org = Organization::create(['name' => 'ChaosMonkey', 'slug' => 'chaosmonkey']);
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-' . Str::random(8) . '@test.com',
            'role' => 'admin',
            'organization_id' => $org->id,
        ]);
        $this->dashboardToken = ApiToken::generateDashboardToken($admin->id, $org->id)['raw'];
    }

    protected function tearDown(): void
    {
        // Only drop when the isolated test contract is proven
        if (app()->environment('testing')
            && config('database.default') === 'sqlite'
            && config('database.connections.sqlite.database') === ':memory:'
        ) {
            Schema::dropIfExists('api_tokens');
            Schema::dropIfExists('telemetry_events');
            Schema::dropIfExists('invites');
            Schema::dropIfExists('users');
            Schema::dropIfExists('organizations');
        }

        parent::tearDown();
    }

    /**
     * TEST: Legacy session (pre-0.4.0) — identity fields remain null/schema 0
     */
    public function test_legacy_session_has_null_identity(): void
    {
        $payload = [
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'user_id' => 'legacy-user',
            'events' => [
                [
                    'event_type' => 'session',
                    'count' => 1,
                    'duration_ms' => 1200000,
                    'timestamp' => now()->toISOString(),
                    'metadata' => [
                        'source' => 'vscode',
                        'extension_version' => '0.3.9',
                        'segment_type' => 'session',
                        'session_id' => 'session_legacy_001',
                        'end_reason' => 'idle',
                        // NO identity fields — legacy payload
                    ],
                ],
            ],
        ];

        $response = $this->postJson('/api/telemetry', $payload);
        $response->assertStatus(200);

        // Query canonical sessions
        $canonical = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?format=sessions');
        $canonical->assertStatus(200);

        $sessions = $canonical->json('data') ?? $canonical->json('sessions') ?? [];
        $this->assertNotEmpty($sessions, 'Canonical should return at least one session');

        $session = $sessions[0];
        $this->assertNull($session['installation_id'], 'Legacy session installation_id should be null');
        $this->assertNull($session['developer_id'], 'Legacy session developer_id should be null');
        $this->assertNull($session['team_id'], 'Legacy session team_id should be null');
        $this->assertEquals(0, $session['identity_schema_version'], 'Legacy session should have schema version 0');
        $this->assertEquals('legacy_unknown', $session['identity_source'], 'Legacy session should have legacy_unknown source');
    }

    /**
     * TEST: 0.4.0 session without bearer token is rejected (fail-closed)
     */
    public function test_v040_session_without_auth_is_rejected(): void
    {
        $installationId = '550e8400-e29b-41d4-a716-446655440000';

        $payload = [
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'user_id' => 'dev-user-vscode',
            'installation_id' => $installationId,
            'developer_id' => null,
            'team_id' => null,
            'identity_schema_version' => 1,
            'events' => [
                [
                    'event_type' => 'session',
                    'count' => 1,
                    'duration_ms' => 1800000,
                    'timestamp' => now()->toISOString(),
                    'metadata' => [
                        'source' => 'vscode',
                        'extension_version' => '0.4.0',
                        'segment_type' => 'session',
                        'session_id' => 'session_v040_001',
                        'end_reason' => 'idle',
                        'identity_schema_version' => 1,
                        'installation_id' => $installationId,
                        'developer_id' => null,
                        'team_id' => null,
                        'identity_source' => 'generated_installation',
                    ],
                ],
            ],
        ];

        $response = $this->postJson('/api/telemetry', $payload);
        $response->assertStatus(401);
        $response->assertJson(['error_code' => 'AUTH_REQUIRED_V040']);
    }

    /**
     * TEST: No identity is inferred from user_id, email, Git or machine details
     */
    public function test_no_identity_inferred_from_user_id_or_git(): void
    {
        $payload = [
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'user_id' => 'matt@example.com', // Contains email-like string
            'events' => [
                [
                    'event_type' => 'session',
                    'count' => 1,
                    'duration_ms' => 900000,
                    'timestamp' => now()->toISOString(),
                    'metadata' => [
                        'source' => 'vscode',
                        'extension_version' => '0.3.9',
                        'segment_type' => 'session',
                        'session_id' => 'session_no_identity_001',
                        'end_reason' => 'idle',
                        'git_repo_url' => 'https://github.com/matt/repo',
                        'git_branch' => 'main',
                        // NO identity fields
                    ],
                ],
            ],
        ];

        $response = $this->postJson('/api/telemetry', $payload);
        $response->assertStatus(200);

        $canonical = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?format=sessions');
        $canonical->assertStatus(200);

        $sessions = $canonical->json('data') ?? $canonical->json('sessions') ?? [];
        $this->assertNotEmpty($sessions);

        $session = $sessions[0];
        // Identity must NOT be inferred from user_id or git context
        $this->assertNull($session['installation_id'], 'installation_id must not be inferred from user_id');
        $this->assertNull($session['developer_id'], 'developer_id must not be inferred from user_id or git');
        $this->assertNull($session['team_id'], 'team_id must not be inferred from user_id or git');
        $this->assertEquals(0, $session['identity_schema_version'], 'Schema version should be 0 for legacy session');
        $this->assertEquals('legacy_unknown', $session['identity_source'], 'Source should be legacy_unknown');
    }

    /**
     * TEST: 0.4.0 session with configured identity but no bearer token is rejected (fail-closed)
     */
    public function test_v040_configured_identity_without_auth_is_rejected(): void
    {
        $installationId = '660e8400-e29b-41d4-a716-446655440001';

        $payload = [
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'user_id' => 'dev-user-vscode',
            'installation_id' => $installationId,
            'developer_id' => 'dev_pseudonymous_42',
            'team_id' => 'team_alpha',
            'identity_schema_version' => 1,
            'events' => [
                [
                    'event_type' => 'session',
                    'count' => 1,
                    'duration_ms' => 1500000,
                    'timestamp' => now()->toISOString(),
                    'metadata' => [
                        'source' => 'vscode',
                        'extension_version' => '0.4.0',
                        'segment_type' => 'session',
                        'session_id' => 'session_configured_001',
                        'end_reason' => 'idle',
                        'identity_schema_version' => 1,
                        'installation_id' => $installationId,
                        'developer_id' => 'dev_pseudonymous_42',
                        'team_id' => 'team_alpha',
                        'identity_source' => 'configured_developer',
                    ],
                ],
            ],
        ];

        $response = $this->postJson('/api/telemetry', $payload);
        $response->assertStatus(401);
        $response->assertJson(['error_code' => 'AUTH_REQUIRED_V040']);
    }
}
