<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\IDEConnectCode;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\TelemetryEvent;
use App\Models\User;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class InviteBackedIdentityTest extends TestCase
{
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

        $this->createTables();
    }

    protected function tearDown(): void
    {
        if (app()->environment('testing')
            && config('database.default') === 'sqlite'
            && config('database.connections.sqlite.database') === ':memory:'
        ) {
            Schema::dropIfExists('telemetry_events');
            Schema::dropIfExists('api_tokens');
            Schema::dropIfExists('ide_connect_codes');
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
                $table->string('github_id')->nullable();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('invites')) {
            Schema::create('invites', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('token', 64)->unique();
                $table->string('email');
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
                $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->foreignId('invite_id')->nullable()->constrained('invites')->nullOnDelete();
                $table->string('installation_id', 64)->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->timestamp('revoked_at')->nullable();
                $table->timestamps();

                $table->index('token');
                $table->index('user_id');
                $table->index('organization_id');
            });
        }

        if (!Schema::hasTable('ide_connect_codes')) {
            Schema::create('ide_connect_codes', function ($table) {
                $table->id();
                $table->string('code', 32)->unique();
                $table->foreignId('user_id')->nullable()->constrained();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->foreignId('invite_id')->nullable()->constrained('invites')->nullOnDelete();
                $table->string('installation_id', 64)->nullable();
                $table->timestamp('expires_at');
                $table->timestamp('used_at')->nullable();
                $table->timestamps();
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
    }

    private function seedOrgAndInvite(): array
    {
        $org = Organization::create([
            'name' => 'Test Org',
            'slug' => 'test-org-' . Str::random(6),
        ]);

        $invite = Invite::create([
            'organization_id' => $org->id,
            'token' => Str::random(32),
            'email' => 'dev@test.com',
            'expires_at' => now()->addDays(30),
        ]);

        return [$org, $invite];
    }

    private function createConnectCodeForInvite(int $orgId, int $inviteId): IDEConnectCode
    {
        $user = User::create([
            'email' => 'admin-' . Str::random(8) . '@test.com',
            'name' => 'Admin',
            'organization_id' => $orgId,
        ]);

        return IDEConnectCode::create([
            'organization_id' => $orgId,
            'invite_id' => $inviteId,
            'user_id' => $user->id,
            'expires_at' => now()->addDays(7),
        ]);
    }

    /**
     * TEST: Correct invite selection — exchange returns token bound to the right invite
     */
    public function test_exchange_selects_correct_invite(): void
    {
        [$org, $invite] = $this->seedOrgAndInvite();
        $code = $this->createConnectCodeForInvite($org->id, $invite->id);

        $installationId = '550e8400-e29b-41d4-a716-446655440000';

        $response = $this->postJson('/api/ide/connect/exchange', [
            'code' => $code->code,
            'installation_id' => $installationId,
            'extension_version' => '0.4.0',
        ]);

        $response->assertStatus(200);
        $body = $response->json();
        $this->assertEquals("invite:{$invite->id}", $body['developer_id']);
        $this->assertEquals($org->id, $body['organization_id']);
        $this->assertEquals($installationId, $body['installation_id']);
        $this->assertEquals('backend_claimed', $body['identity_source']);
        $this->assertNotEmpty($body['token']);
    }

    /**
     * TEST: A connect code can enroll multiple distinct editor installations
     */
    public function test_used_code_enrolls_multiple_installations(): void
    {
        [$org, $invite] = $this->seedOrgAndInvite();
        $code = $this->createConnectCodeForInvite($org->id, $invite->id);

        $first = $this->postJson('/api/ide/connect/exchange', [
            'code' => $code->code,
            'installation_id' => '550e8400-e29b-41d4-a716-446655440001',
            'extension_version' => '0.4.0',
            'editor_source' => 'vscode',
        ]);
        $first->assertStatus(200);
        $firstBody = $first->json();

        $second = $this->postJson('/api/ide/connect/exchange', [
            'code' => $code->code,
            'installation_id' => '550e8400-e29b-41d4-a716-446655440002',
            'extension_version' => '0.4.0',
            'editor_source' => 'cursor',
        ]);
        $second->assertStatus(200);
        $secondBody = $second->json();

        $this->assertNotEquals($firstBody['token'], $secondBody['token']);
        $this->assertNotEquals($firstBody['installation_id'], $secondBody['installation_id']);
        $this->assertEquals($firstBody['developer_id'], $secondBody['developer_id']);
        $this->assertEquals($firstBody['organization_id'], $secondBody['organization_id']);
        $this->assertEquals($firstBody['developer_id'], "invite:{$invite->id}");
    }

    // superseded by test_used_code_enrolls_multiple_installations

    /**
     * TEST: Expired code is rejected
     */
    public function test_expired_code_rejected(): void
    {
        [$org, $invite] = $this->seedOrgAndInvite();
        $code = IDEConnectCode::create([
            'organization_id' => $org->id,
            'invite_id' => $invite->id,
            'expires_at' => now()->subDay(),
        ]);

        $this->postJson('/api/ide/connect/exchange', [
            'code' => $code->code,
            'installation_id' => '550e8400-e29b-41d4-a716-446655440002',
            'extension_version' => '0.4.0',
        ])->assertStatus(400);
    }

    /**
     * TEST: Token is stored as SHA-256 hash, not raw
     */
    public function test_token_stored_as_hash(): void
    {
        [$org, $invite] = $this->seedOrgAndInvite();
        $code = $this->createConnectCodeForInvite($org->id, $invite->id);

        $response = $this->postJson('/api/ide/connect/exchange', [
            'code' => $code->code,
            'installation_id' => '550e8400-e29b-41d4-a716-446655440003',
            'extension_version' => '0.4.0',
        ]);

        $rawToken = $response->json('token');
        $this->assertNotEmpty($rawToken);

        // Token in DB should be the hash, not the raw value
        $dbToken = ApiToken::where('invite_id', $invite->id)->first();
        $this->assertNotNull($dbToken);
        $this->assertEquals(hash('sha256', $rawToken), $dbToken->token);
        $this->assertNotEquals($rawToken, $dbToken->token);
    }

    /**
     * TEST: Token is bound to installation_id
     */
    public function test_token_bound_to_installation_id(): void
    {
        [$org, $invite] = $this->seedOrgAndInvite();
        $code = $this->createConnectCodeForInvite($org->id, $invite->id);

        $installationId = '550e8400-e29b-41d4-a716-446655440004';

        $this->postJson('/api/ide/connect/exchange', [
            'code' => $code->code,
            'installation_id' => $installationId,
            'extension_version' => '0.4.0',
        ]);

        $dbToken = ApiToken::where('invite_id', $invite->id)->first();
        $this->assertEquals($installationId, $dbToken->installation_id);
    }

    /**
     * TEST: Revoked token is rejected by findValidToken
     */
    public function test_revoked_token_rejected(): void
    {
        [$org, $invite] = $this->seedOrgAndInvite();
        $code = $this->createConnectCodeForInvite($org->id, $invite->id);

        $response = $this->postJson('/api/ide/connect/exchange', [
            'code' => $code->code,
            'installation_id' => '550e8400-e29b-41d4-a716-446655440005',
            'extension_version' => '0.4.0',
        ]);

        $rawToken = $response->json('token');

        // Revoke the token
        $dbToken = ApiToken::where('invite_id', $invite->id)->first();
        $dbToken->revoke();

        // findValidToken should return null
        $this->assertNull(ApiToken::findValidToken($rawToken));
    }

    /**
     * TEST: Identity stability — same token resolves to same developer_id
     */
    public function test_identity_stability_across_lookups(): void
    {
        [$org, $invite] = $this->seedOrgAndInvite();
        $code = $this->createConnectCodeForInvite($org->id, $invite->id);

        $response = $this->postJson('/api/ide/connect/exchange', [
            'code' => $code->code,
            'installation_id' => '550e8400-e29b-41d4-a716-446655440006',
            'extension_version' => '0.4.0',
        ]);

        $rawToken = $response->json('token');
        $expectedDevId = "invite:{$invite->id}";

        // Resolve token multiple times
        $token1 = ApiToken::findValidToken($rawToken);
        $token2 = ApiToken::findValidToken($rawToken);

        $this->assertNotNull($token1);
        $this->assertNotNull($token2);
        $this->assertEquals($expectedDevId, "invite:{$token1->invite_id}");
        $this->assertEquals($expectedDevId, "invite:{$token2->invite_id}");
    }

    /**
     * TEST: Authenticated telemetry overrides client-supplied identity
     */
    public function test_authenticated_telemetry_overrides_identity(): void
    {
        [$org, $invite] = $this->seedOrgAndInvite();
        $code = $this->createConnectCodeForInvite($org->id, $invite->id);

        $installationId = '550e8400-e29b-41d4-a716-446655440007';

        $exchangeResponse = $this->postJson('/api/ide/connect/exchange', [
            'code' => $code->code,
            'installation_id' => $installationId,
            'extension_version' => '0.4.0',
        ]);

        $rawToken = $exchangeResponse->json('token');
        $expectedDevId = "invite:{$invite->id}";

        // Send telemetry with bearer token but fake identity fields
        $payload = [
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'user_id' => 'fake-user',
            'extension_version' => '0.4.0',
            'installation_id' => $installationId,
            'developer_id' => 'fake-developer',
            'team_id' => 'fake-team',
            'identity_schema_version' => 1,
            'events' => [
                [
                    'event_type' => 'session',
                    'count' => 1,
                    'duration_ms' => 1200000,
                    'timestamp' => now()->toISOString(),
                    'metadata' => [
                        'source' => 'vscode',
                        'extension_version' => '0.4.0',
                        'segment_type' => 'session',
                        'session_id' => 'session_auth_001',
                        'end_reason' => 'idle',
                        'installation_id' => $installationId,
                        'developer_id' => 'fake-developer',
                        'team_id' => 'fake-team',
                        'identity_source' => 'generated_installation',
                        'identity_schema_version' => 1,
                    ],
                ],
            ],
        ];

        $response = $this->withHeaders([
            'Authorization' => "Bearer {$rawToken}",
        ])->postJson('/api/telemetry', $payload);

        $response->assertStatus(200);

        // Verify stored event has server-authoritative identity
        $event = TelemetryEvent::where('session_id', 'session_auth_001')->first();
        $this->assertNotNull($event);
        $metadata = is_string($event->metadata) ? json_decode($event->metadata, true) : (array) $event->metadata;
        $this->assertEquals($expectedDevId, $metadata['developer_id']);
        $this->assertEquals('backend_claimed', $metadata['identity_source']);
        $this->assertEquals($org->id, $metadata['organization_id']);
        $this->assertEquals($installationId, $metadata['installation_id']);
    }

    /**
     * TEST: 0.4.0+ telemetry without bearer token is rejected
     */
    public function test_v040_telemetry_without_token_rejected(): void
    {
        [$org] = $this->seedOrgAndInvite();

        $payload = [
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'user_id' => 'dev-user',
            'extension_version' => '0.4.0',
            'organization_id' => $org->id,
            'events' => [
                [
                    'event_type' => 'session',
                    'count' => 1,
                    'duration_ms' => 600000,
                    'timestamp' => now()->toISOString(),
                    'metadata' => [
                        'source' => 'vscode',
                        'extension_version' => '0.4.0',
                        'segment_type' => 'session',
                        'session_id' => 'session_no_token_001',
                        'end_reason' => 'idle',
                    ],
                ],
            ],
        ];

        $response = $this->postJson('/api/telemetry', $payload);
        $response->assertStatus(401);
        $this->assertEquals('AUTH_REQUIRED_V040', $response->json('error_code'));
    }

    /**
     * TEST: Legacy telemetry (pre-0.4.0) without token is preserved (anonymous)
     */
    public function test_legacy_telemetry_preserved_without_token(): void
    {
        // Legacy anonymous path — explicitly enabled (disabled by default).
        config(['telemetry.allow_anonymous_ingest' => true]);

        [$org] = $this->seedOrgAndInvite();

        $payload = [
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'user_id' => 'legacy-user',
            'organization_id' => $org->id,
            'events' => [
                [
                    'event_type' => 'session',
                    'count' => 1,
                    'duration_ms' => 600000,
                    'timestamp' => now()->toISOString(),
                    'metadata' => [
                        'source' => 'vscode',
                        'extension_version' => '0.3.9',
                        'segment_type' => 'session',
                        'session_id' => 'session_legacy_preserved_001',
                        'end_reason' => 'idle',
                    ],
                ],
            ],
        ];

        $response = $this->postJson('/api/telemetry', $payload);
        $response->assertStatus(200);
    }

    /**
     * TEST: Installation ID mismatch between token and payload is rejected
     */
    public function test_installation_id_mismatch_rejected(): void
    {
        [$org, $invite] = $this->seedOrgAndInvite();
        $code = $this->createConnectCodeForInvite($org->id, $invite->id);

        $tokenInstallationId = '550e8400-e29b-41d4-a716-446655440008';
        $payloadInstallationId = '660e8400-e29b-41d4-a716-446655440099';

        $exchangeResponse = $this->postJson('/api/ide/connect/exchange', [
            'code' => $code->code,
            'installation_id' => $tokenInstallationId,
            'extension_version' => '0.4.0',
        ]);

        $rawToken = $exchangeResponse->json('token');

        $payload = [
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'user_id' => 'dev-user',
            'extension_version' => '0.4.0',
            'installation_id' => $payloadInstallationId,
            'events' => [
                [
                    'event_type' => 'session',
                    'count' => 1,
                    'duration_ms' => 600000,
                    'timestamp' => now()->toISOString(),
                    'metadata' => [
                        'source' => 'vscode',
                        'extension_version' => '0.4.0',
                        'segment_type' => 'session',
                        'session_id' => 'session_mismatch_001',
                        'end_reason' => 'idle',
                        'installation_id' => $payloadInstallationId,
                    ],
                ],
            ],
        ];

        $response = $this->withHeaders([
            'Authorization' => "Bearer {$rawToken}",
        ])->postJson('/api/telemetry', $payload);

        $response->assertStatus(403);
        $this->assertEquals('INSTALLATION_ID_MISMATCH', $response->json('error_code'));
    }

    /**
     * TEST: Missing installation_id in payload for authenticated 0.4.0+ telemetry is rejected
     */
    public function test_missing_installation_id_rejected(): void
    {
        [$org, $invite] = $this->seedOrgAndInvite();
        $code = $this->createConnectCodeForInvite($org->id, $invite->id);

        $tokenInstallationId = '550e8400-e29b-41d4-a716-446655440020';

        $exchangeResponse = $this->postJson('/api/ide/connect/exchange', [
            'code' => $code->code,
            'installation_id' => $tokenInstallationId,
            'extension_version' => '0.4.0',
        ]);

        $rawToken = $exchangeResponse->json('token');

        // Send telemetry with bearer token but no installation_id in payload or metadata
        $payload = [
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'extension_version' => '0.4.0',
            'events' => [
                [
                    'event_type' => 'session',
                    'count' => 1,
                    'duration_ms' => 600000,
                    'timestamp' => now()->toISOString(),
                    'metadata' => [
                        'source' => 'vscode',
                        'extension_version' => '0.4.0',
                        'segment_type' => 'session',
                        'session_id' => 'session_missing_install_001',
                        'end_reason' => 'idle',
                    ],
                ],
            ],
        ];

        $response = $this->withHeaders([
            'Authorization' => "Bearer {$rawToken}",
        ])->postJson('/api/telemetry', $payload);

        $response->assertStatus(403);
        $this->assertEquals('INSTALLATION_ID_MISMATCH', $response->json('error_code'));
    }

    /**
     * TEST: Non-invite-backed code is rejected by V2 exchange
     */
    public function test_non_invite_backed_code_rejected(): void
    {
        [$org] = $this->seedOrgAndInvite();

        // Create code without invite_id
        $code = IDEConnectCode::create([
            'organization_id' => $org->id,
            'expires_at' => now()->addDays(7),
        ]);

        $this->postJson('/api/ide/connect/exchange', [
            'code' => $code->code,
            'installation_id' => '550e8400-e29b-41d4-a716-446655440009',
            'extension_version' => '0.4.0',
        ])->assertStatus(400);
    }

    /**
     * TEST: Identity coverage endpoint has been removed (Phase 9 — was exposing invite emails)
     */
    public function test_identity_coverage_endpoint_removed(): void
    {
        [$org] = $this->seedOrgAndInvite();

        $response = $this->getJson("/api/telemetry/identity-coverage?organization_id={$org->id}");
        $response->assertStatus(404);
    }

    /**
     * TEST: Artisan command generates codes for pending invites
     */
    public function test_artisan_command_generates_codes(): void
    {
        [$org, $invite] = $this->seedOrgAndInvite();

        $outputPath = sys_get_temp_dir() . '/cm_test_codes_' . Str::random(8) . '.csv';

        $this->artisan('chaosmonkey:issue-ide-connect-codes', [
            '--organization' => $org->id,
            '--pending-invites' => true,
            '--output' => $outputPath,
        ])->assertSuccessful();

        $code = IDEConnectCode::where('invite_id', $invite->id)->first();
        $this->assertNotNull($code);
        $this->assertNull($code->used_at);

        // Verify CSV file exists with 0600 permissions
        $this->assertTrue(file_exists($outputPath));
        $perms = fileperms($outputPath) & 0777;
        $this->assertEquals(0600, $perms, "CSV file should have 0600 permissions, got {$perms}");

        // Verify CSV contains only email,code,expires_at columns
        $csvContent = file_get_contents($outputPath);
        $this->assertStringStartsWith("email,code,expires_at\n", $csvContent);
        $this->assertStringContainsString($invite->email, $csvContent);
        $this->assertStringContainsString($code->code, $csvContent);

        @unlink($outputPath);
    }

    /**
     * TEST: Artisan command is idempotent — running twice does not create duplicate codes
     */
    public function test_artisan_command_idempotent(): void
    {
        [$org, $invite] = $this->seedOrgAndInvite();

        $outputPath = sys_get_temp_dir() . '/cm_test_codes_idem_' . Str::random(8) . '.csv';

        $this->artisan('chaosmonkey:issue-ide-connect-codes', [
            '--organization' => $org->id,
            '--pending-invites' => true,
            '--output' => $outputPath,
        ])->assertSuccessful();

        $this->artisan('chaosmonkey:issue-ide-connect-codes', [
            '--organization' => $org->id,
            '--pending-invites' => true,
            '--output' => $outputPath,
        ])->assertSuccessful();

        $count = IDEConnectCode::where('invite_id', $invite->id)
            ->whereNull('used_at')
            ->count();
        $this->assertEquals(1, $count, 'Should have exactly one valid code after two runs');

        @unlink($outputPath);
    }
}
