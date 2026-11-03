<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\IDEConnectCode;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\TelemetryEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * PILOT OPS 18H — canonical connect-code lifecycle contract.
 *
 * - Developer enrollments (invite + connect code) never silently expire:
 *   issuance stamps the non-expiring enrollment sentinel.
 * - Admin revoke/cancel/regenerate is the only lifecycle authority.
 * - Codes are intentionally reusable across distinct editor installations;
 *   exchange never marks used_at and used_at is never lifecycle evidence.
 * - Existing installation-bound api_tokens are fully independent of
 *   invite/code lifecycle.
 * - Dashboard-account invites remain time-bounded.
 * - Team roster distinguishes ready / connected / revoked / not_generated.
 * - Pilot Health reports enrollment scope only; admin revocations are
 *   reported as revoked, never as "expired".
 */
class ConnectCodeLifecycleTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;
    private User $admin;
    private string $adminToken;

    protected function setUp(): void
    {
        parent::setUp();

        $this->org = Organization::create(['name' => 'Test Org', 'slug' => 'test-org-' . Str::random(6)]);
        $this->admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-' . Str::random(8) . '@test.com',
            'password' => bcrypt('password'),
            'organization_id' => $this->org->id,
            'role' => 'admin',
        ]);
        $this->adminToken = 'test-admin-' . Str::random(16);
        ApiToken::create([
            'token' => hash('sha256', $this->adminToken),
            'user_id' => $this->admin->id,
            'organization_id' => $this->org->id,
            'expires_at' => now()->addDays(30),
        ]);
    }

    private function createEnrollmentInvite(string $email = 'dev@test.com'): Invite
    {
        $response = $this->postJson('/api/org/invites', [
            'email' => $email,
            'role' => 'member',
            'send_email' => false,
            'purpose' => 'developer_enrollment',
        ], ['X-API-Token' => $this->adminToken]);

        $response->assertStatus(200);
        return Invite::findOrFail($response->json('invite.id'));
    }

    private function issueCode(Invite $invite): string
    {
        $response = $this->postJson("/api/org/invites/{$invite->id}/connect-code", [], [
            'X-API-Token' => $this->adminToken,
        ]);
        $response->assertStatus(200);
        return $response->json('connect_code');
    }

    private function exchange(
        string $code,
        string $installationId,
        string $extensionVersion = '0.4.1'
    ) {
        return $this->postJson('/api/ide/connect/exchange', [
            'code' => $code,
            'installation_id' => $installationId,
            'extension_version' => $extensionVersion,
        ]);
    }

    // ─── 1. Enrollment creation has no practical time expiry ────────────

    public function test_enrollment_invite_created_with_never_expires_sentinel(): void
    {
        $invite = $this->createEnrollmentInvite();

        $this->assertEquals(
            Invite::ENROLLMENT_NEVER_EXPIRES,
            $invite->expires_at->toDateTimeString(),
            'Developer enrollment invite must carry the non-expiring sentinel'
        );
        $this->assertTrue($invite->isDeveloperEnrollment());
    }

    public function test_issued_connect_code_never_expires(): void
    {
        $invite = $this->createEnrollmentInvite();
        $this->issueCode($invite);

        $code = IDEConnectCode::where('invite_id', $invite->id)->first();
        $this->assertEquals(
            Invite::ENROLLMENT_NEVER_EXPIRES,
            $code->expires_at->toDateTimeString()
        );
    }

    // ─── 2. Exchange succeeds after the old 7-day boundary ──────────────

    public function test_exchange_succeeds_well_past_old_seven_day_window(): void
    {
        $invite = $this->createEnrollmentInvite();
        $code = $this->issueCode($invite);

        // Simulate the moment far beyond the old 7-day code expiry and the
        // old 24h invite expiry.
        Carbon::setTestNow(now()->addDays(60));
        try {
            $response = $this->exchange($code, '550e8400-e29b-41d4-a716-446655440000');
            $this->assertEquals(200, $response->status(), 'Enrollment code must remain usable after the old expiry window');
            $this->assertNotEmpty($response->json('token'));
        } finally {
            Carbon::setTestNow();
        }
    }

    // ─── 3. Same code supports multiple installation clients ─────────────

    public function test_same_code_enrolls_multiple_installations(): void
    {
        $invite = $this->createEnrollmentInvite();
        $code = $this->issueCode($invite);

        $r1 = $this->exchange($code, '550e8400-e29b-41d4-a716-446655440001');
        $r2 = $this->exchange($code, '550e8400-e29b-41d4-a716-446655440002');

        $this->assertEquals(200, $r1->status());
        $this->assertEquals(200, $r2->status());
        $this->assertEquals(2, ApiToken::where('invite_id', $invite->id)->count());
        $this->assertNotEquals($r1->json('token'), $r2->json('token'));
    }

    public function test_supported_bridge_versions_enroll_without_weakening_ide_floor(): void
    {
        $invite = $this->createEnrollmentInvite();
        $code = $this->issueCode($invite);

        $claude = $this->exchange(
            $code,
            '550e8400-e29b-41d4-a716-446655440101',
            '0.4.1-cc-bridge'
        );
        $claude->assertStatus(200);

        $codex = $this->exchange(
            $code,
            '550e8400-e29b-41d4-a716-446655440102',
            '0.4.1-codex-bridge'
        );
        $codex->assertStatus(200);
        $this->assertEquals("invite:{$invite->id}", $codex->json('developer_id'));
        $this->assertEquals('backend_claimed', $codex->json('identity_source'));
        $this->assertEquals('550e8400-e29b-41d4-a716-446655440102', $codex->json('installation_id'));

        $token = ApiToken::where('installation_id', '550e8400-e29b-41d4-a716-446655440102')->firstOrFail();
        $this->assertEquals($invite->id, $token->invite_id);
        $this->assertEquals($this->org->id, $token->organization_id);
    }

    public function test_stale_or_malformed_bridge_versions_still_fail_closed(): void
    {
        $invite = $this->createEnrollmentInvite();
        $code = $this->issueCode($invite);

        foreach (['0.3.8', '0.3.8-codex-bridge', '0.0.1-codex-bridge', 'codex-bridge'] as $i => $version) {
            $response = $this->exchange(
                $code,
                sprintf('550e8400-e29b-41d4-a716-4466554402%02d', $i),
                $version
            );

            $response->assertStatus(400);
            $this->assertEquals('VERSION_TOO_OLD', $response->json('error_code'));
        }

        $this->assertEquals(0, ApiToken::where('invite_id', $invite->id)->count());
    }

    public function test_codex_bridge_session_is_canonical_and_retry_is_idempotent(): void
    {
        $invite = $this->createEnrollmentInvite();
        $code = $this->issueCode($invite);
        $installationId = '550e8400-e29b-41d4-a716-446655440103';
        $sessionId = 'codex-lifecycle-proof-001';
        $eventId = 'codex-session-' . substr(hash('sha256', $sessionId), 0, 24);
        $batchHash = hash('sha256', 'codex:canonical:proof:001');

        $exchange = $this->exchange($code, $installationId, '0.4.1-codex-bridge');
        $exchange->assertStatus(200);
        $installationToken = $exchange->json('token');

        $payload = [
            'source' => 'codex',
            'editor_source' => 'codex',
            'extension_version' => '0.4.1-codex-bridge',
            'installation_id' => $installationId,
            'developer_id' => "invite:{$invite->id}",
            'organization_id' => $this->org->id,
            'identity_source' => 'backend_claimed',
            'identity_schema_version' => 1,
            'batch_hash' => $batchHash,
            'events' => [[
                'event_type' => 'session',
                'count' => 1,
                'duration_ms' => 180000,
                'timestamp' => now()->toISOString(),
                'session_id' => $sessionId,
                'metadata' => [
                    'tool' => 'codex',
                    'segment_type' => 'session',
                    'session_id' => $sessionId,
                    'event_id' => $eventId,
                    'installation_id' => $installationId,
                    'extension_version' => '0.4.1-codex-bridge',
                    'telemetry_contract' => 'codex_lifecycle_hooks_v1',
                    'hook_schema_version' => 1,
                    'lifecycle_event_counts' => [
                        'SessionStart' => 1,
                        'UserPromptSubmit' => 1,
                        'PreToolUse' => 1,
                        'PostToolUse' => 1,
                        'Stop' => 1,
                        'SessionEnd' => 1,
                    ],
                    'turn_count' => 1,
                    'completed_turn_count' => 1,
                    'tool_attempt_count' => 1,
                    'tool_call_count' => 1,
                    'tool_counts' => ['Bash' => 1],
                    'token_usage' => null,
                    'token_usage_status' => 'unavailable_lifecycle_hooks',
                    'duration_observation' => 'bridge_local_receipt',
                ],
            ]],
        ];

        $ingest = $this->withToken($installationToken)->postJson('/api/telemetry', $payload);
        $ingest->assertStatus(200);
        $this->assertFalse($ingest->json('duplicate'));
        $this->assertEquals(1, TelemetryEvent::count());

        $event = TelemetryEvent::firstOrFail();
        $this->assertEquals($sessionId, $event->session_id);
        $this->assertEquals('codex', $event->source);
        $this->assertEquals('codex', $event->editor_source);
        $this->assertEquals("invite:{$invite->id}", $event->user_id);
        $this->assertEquals($this->org->id, $event->organization_id);
        $this->assertEquals($eventId, $event->event_id);
        $metadata = is_array($event->metadata) ? $event->metadata : json_decode($event->metadata, true);
        $this->assertEquals('session', $metadata['segment_type']);
        $this->assertEquals($sessionId, $metadata['session_id']);
        $this->assertEquals($installationId, $metadata['installation_id']);
        $this->assertEquals("invite:{$invite->id}", $metadata['developer_id']);
        $this->assertEquals('backend_claimed', $metadata['identity_source']);
        $this->assertNull($metadata['token_usage']);

        $canonical = $this->withToken($this->adminToken)
            ->getJson('/api/telemetry/canonical?format=sessions');
        $canonical->assertStatus(200);
        $this->assertEquals(1, $canonical->json('metadata.canonical_population_count'));
        $this->assertContains('codex', $canonical->json('metadata.tools_in_population'));
        $this->assertEquals('codex', $canonical->json('data.0.tool'));

        $retry = $this->withToken($installationToken)->postJson('/api/telemetry', $payload);
        $retry->assertStatus(200);
        $this->assertTrue($retry->json('duplicate'));
        $this->assertEquals(1, TelemetryEvent::count());
    }

    // ─── 4/5/6. Revoke + regenerate lifecycle ────────────────────────────

    public function test_explicit_revoke_makes_code_fail(): void
    {
        $invite = $this->createEnrollmentInvite();
        $code = $this->issueCode($invite);

        $this->deleteJson("/api/org/invites/{$invite->id}/connect-code", [], [
            'X-API-Token' => $this->adminToken,
        ])->assertStatus(200);

        $codeModel = IDEConnectCode::where('code', $code)->first();
        $this->assertTrue($codeModel->isRevoked(), 'Revoked code must carry the revoked sentinel');
        $this->assertTrue($codeModel->isExpired(), 'Revoked code is closed for exchange');

        $response = $this->exchange($code, '550e8400-e29b-41d4-a716-446655440003');
        $this->assertEquals(400, $response->status());
    }

    public function test_regenerate_produces_new_code_and_old_code_fails(): void
    {
        $invite = $this->createEnrollmentInvite();
        $oldCode = $this->issueCode($invite);

        // The single regeneration path: POST connect-code with regenerate=true
        $response = $this->postJson("/api/org/invites/{$invite->id}/connect-code", [
            'regenerate' => true,
        ], ['X-API-Token' => $this->adminToken]);
        $response->assertStatus(200);
        $newCode = $response->json('connect_code');

        $this->assertNotEquals($oldCode, $newCode, 'Regenerate must produce a genuinely new code');
        $this->assertTrue(IDEConnectCode::where('code', $oldCode)->first()->isRevoked());
        $this->assertEquals(400, $this->exchange($oldCode, '550e8400-e29b-41d4-a716-446655440004')->status());
        $this->assertEquals(200, $this->exchange($newCode, '550e8400-e29b-41d4-a716-446655440005')->status());
    }

    public function test_regenerate_after_revoke_issues_new_code(): void
    {
        $invite = $this->createEnrollmentInvite();
        $oldCode = $this->issueCode($invite);

        $this->deleteJson("/api/org/invites/{$invite->id}/connect-code", [], [
            'X-API-Token' => $this->adminToken,
        ])->assertStatus(200);

        $newCode = $this->issueCode($invite);
        $this->assertNotEquals($oldCode, $newCode);
        $this->assertEquals(200, $this->exchange($newCode, '550e8400-e29b-41d4-a716-446655440006')->status());
    }

    // ─── 7. Cancel/destroy blocks future exchange ────────────────────────

    public function test_cancel_enrollment_blocks_future_exchange(): void
    {
        $invite = $this->createEnrollmentInvite();
        $code = $this->issueCode($invite);

        $this->deleteJson("/api/org/invites/{$invite->id}", [], [
            'X-API-Token' => $this->adminToken,
        ])->assertStatus(200);

        $this->assertEquals(400, $this->exchange($code, '550e8400-e29b-41d4-a716-446655440007')->status());
    }

    // ─── 8. Existing installation token survives code revoke ─────────────

    public function test_installation_token_survives_code_revoke_and_cancel(): void
    {
        $invite = $this->createEnrollmentInvite();
        $code = $this->issueCode($invite);

        $exchange = $this->exchange($code, '550e8400-e29b-41d4-a716-446655440008');
        $this->assertEquals(200, $exchange->status());
        $installationToken = $exchange->json('token');

        // Revoke the code — the installation token must remain valid.
        $this->deleteJson("/api/org/invites/{$invite->id}/connect-code", [], [
            'X-API-Token' => $this->adminToken,
        ])->assertStatus(200);

        $renew = $this->postJson('/api/ide/connect/renew', [], [
            'Authorization' => "Bearer {$installationToken}",
        ]);
        $this->assertEquals(200, $renew->status(), 'Installation token must work after code revoke');

        // Cancel the enrollment entirely — the installation token must
        // still remain valid (invite row deletion does not invalidate it).
        $this->deleteJson("/api/org/invites/{$invite->id}", [], [
            'X-API-Token' => $this->adminToken,
        ])->assertStatus(200);

        $renewAfterCancel = $this->postJson('/api/ide/connect/renew', [], [
            'Authorization' => "Bearer {$installationToken}",
        ]);
        $this->assertEquals(200, $renewAfterCancel->status(), 'Installation token must work after enrollment cancel');
    }

    // ─── 9. Dashboard-account invite keeps time-bounded expiry ───────────

    public function test_dashboard_invite_remains_time_bounded(): void
    {
        $response = $this->postJson('/api/org/invites', [
            'email' => 'dashuser@test.com',
            'role' => 'member',
            'send_email' => false,
            'expires_hours' => 168,
        ], ['X-API-Token' => $this->adminToken]);
        $response->assertStatus(200);

        $invite = Invite::findOrFail($response->json('invite.id'));
        $this->assertFalse($invite->isDeveloperEnrollment());
        $this->assertTrue($invite->expires_at->lt(now()->addDays(30)), 'Dashboard invite must remain time-bounded');
        $this->assertTrue($invite->expires_at->gt(now()->addDays(6)));
    }

    public function test_expired_dashboard_invite_cannot_be_accepted(): void
    {
        $invite = Invite::create([
            'organization_id' => $this->org->id,
            'token' => Str::random(32),
            'email' => 'old-dash@test.com',
            'expires_at' => now()->subDay(),
        ]);

        $response = $this->postJson("/api/invites/{$invite->token}/accept", [
            'name' => 'Old User',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ]);

        $this->assertEquals(400, $response->status());
        $this->assertStringContainsString('expired', $response->json('error'));
    }

    // ─── 10. Pilot Health ignores valid non-expiring enrollments ─────────

    public function test_pilot_health_ignores_non_expiring_enrollments(): void
    {
        $invite = $this->createEnrollmentInvite();
        $this->issueCode($invite);

        $response = $this->getJson('/api/pilot/health', ['X-API-Token' => $this->adminToken]);

        $response->assertStatus(200);
        $this->assertEquals('HEALTHY', $response->json('connect_code_expiry.state'));
        $this->assertEquals(0, $response->json('connect_code_expiry.expired_unredeemed'));
        $this->assertEquals(0, $response->json('connect_code_expiry.expiring_within_7d'));
        $this->assertEquals(1, $response->json('connect_code_expiry.total_unredeemed'));
    }

    public function test_pilot_health_reports_revoked_not_expired(): void
    {
        $invite = $this->createEnrollmentInvite();
        $this->issueCode($invite);

        $this->deleteJson("/api/org/invites/{$invite->id}/connect-code", [], [
            'X-API-Token' => $this->adminToken,
        ])->assertStatus(200);

        $response = $this->getJson('/api/pilot/health', ['X-API-Token' => $this->adminToken]);

        $response->assertStatus(200);
        $this->assertEquals('HEALTHY', $response->json('connect_code_expiry.state'));
        $this->assertEquals(0, $response->json('connect_code_expiry.expired_unredeemed'));
        $this->assertEquals(1, $response->json('connect_code_expiry.revoked'));
        $this->assertStringNotContainsString('expired without redemption', $response->json('connect_code_expiry.message'));
        $this->assertStringContainsString('revoked', $response->json('connect_code_expiry.message'));
    }

    // ─── 11. Team roster lifecycle states ────────────────────────────────

    private function pendingMember(int $inviteId): ?array
    {
        $response = $this->getJson('/api/org/users', ['X-API-Token' => $this->adminToken]);
        $response->assertStatus(200);
        return collect($response->json('users'))->firstWhere('invite_id', $inviteId);
    }

    public function test_team_lifecycle_not_generated_ready_connected_revoked(): void
    {
        $invite = $this->createEnrollmentInvite();

        // not_generated
        $member = $this->pendingMember($invite->id);
        $this->assertNotNull($member);
        $this->assertEquals('not_generated', $member['enrollment_status']);

        // ready
        $code = $this->issueCode($invite);
        $member = $this->pendingMember($invite->id);
        $this->assertEquals('ready', $member['enrollment_status']);
        $this->assertTrue($member['has_valid_connect_code']);

        // connected (installation bound)
        $this->exchange($code, '550e8400-e29b-41d4-a716-446655440009')->assertStatus(200);
        $member = $this->pendingMember($invite->id);
        $this->assertEquals('connected', $member['enrollment_status']);
        $this->assertEquals(1, $member['installation_count']);
    }

    public function test_team_shows_revoked_status_after_admin_revoke(): void
    {
        $invite = $this->createEnrollmentInvite();
        $this->issueCode($invite);

        $this->deleteJson("/api/org/invites/{$invite->id}/connect-code", [], [
            'X-API-Token' => $this->adminToken,
        ])->assertStatus(200);

        $member = $this->pendingMember($invite->id);
        $this->assertEquals('revoked', $member['enrollment_status']);
        $this->assertTrue($member['connect_code_revoked']);
        $this->assertFalse($member['connect_code_expired']);
    }

    public function test_connected_status_survives_code_revoke(): void
    {
        $invite = $this->createEnrollmentInvite();
        $code = $this->issueCode($invite);
        $this->exchange($code, '550e8400-e29b-41d4-a716-44665544000a')->assertStatus(200);

        $this->deleteJson("/api/org/invites/{$invite->id}/connect-code", [], [
            'X-API-Token' => $this->adminToken,
        ])->assertStatus(200);

        // Connected installation keeps the member "connected" — the code
        // lifecycle does not downgrade existing installations.
        $member = $this->pendingMember($invite->id);
        $this->assertEquals('connected', $member['enrollment_status']);
    }

    // ─── 18H.1: regeneration preservation contract ───────────────────────

    public function test_regenerate_on_connected_member_preserves_installations_and_status(): void
    {
        $invite = $this->createEnrollmentInvite();
        $oldCode = $this->issueCode($invite);

        // Two distinct installations bound to the SAME code.
        $install1 = '550e8400-e29b-41d4-a716-4466554400f1';
        $install2 = '550e8400-e29b-41d4-a716-4466554400f2';
        $tok1 = $this->exchange($oldCode, $install1)->json('token');
        $tok2 = $this->exchange($oldCode, $install2)->json('token');
        $this->assertNotEmpty($tok1);
        $this->assertNotEmpty($tok2);

        $member = $this->pendingMember($invite->id);
        $this->assertEquals('connected', $member['enrollment_status']);
        $this->assertEquals(2, $member['installation_count']);

        $tokensBefore = ApiToken::where('invite_id', $invite->id)->pluck('id')->sort()->values();

        // Regenerate the bootstrap code.
        $response = $this->postJson("/api/org/invites/{$invite->id}/connect-code", [
            'regenerate' => true,
        ], ['X-API-Token' => $this->adminToken]);
        $response->assertStatus(200);
        $newCode = $response->json('connect_code');
        $this->assertNotEquals($oldCode, $newCode);

        // New bootstrap code is never-expiring.
        $newCodeModel = IDEConnectCode::where('code', $newCode)->first();
        $this->assertEquals(Invite::ENROLLMENT_NEVER_EXPIRES, $newCodeModel->expires_at->toDateTimeString());

        // Both installation token rows survive, byte-for-byte (no revoke,
        // no deletion, no relinking).
        $tokensAfter = ApiToken::where('invite_id', $invite->id)->pluck('id')->sort()->values();
        $this->assertEquals($tokensBefore->toArray(), $tokensAfter->toArray());
        $this->assertEquals(0, ApiToken::where('invite_id', $invite->id)->whereNotNull('revoked_at')->count());

        // Roster still derives Connected — bootstrap rotation must not
        // downgrade an enrolled developer.
        $member = $this->pendingMember($invite->id);
        $this->assertEquals('connected', $member['enrollment_status']);
        $this->assertEquals(2, $member['installation_count']);

        // Existing installations remain authorized to ingest (renew path).
        $this->postJson('/api/ide/connect/renew', [], [
            'Authorization' => "Bearer {$tok1}",
        ])->assertStatus(200);
        $this->postJson('/api/ide/connect/renew', [], [
            'Authorization' => "Bearer {$tok2}",
        ])->assertStatus(200);

        // The new bootstrap code can still enroll an additional installation.
        $this->assertEquals(200, $this->exchange($newCode, '550e8400-e29b-41d4-a716-4466554400f3')->status());
        $member = $this->pendingMember($invite->id);
        $this->assertEquals(3, $member['installation_count']);
    }

    public function test_cancelled_invite_blocks_exchange_even_with_stray_live_code(): void
    {
        $invite = $this->createEnrollmentInvite();
        $code = $this->issueCode($invite);

        // Cancel the enrollment — codes revoked, invite soft-closed.
        $this->deleteJson("/api/org/invites/{$invite->id}", [], [
            'X-API-Token' => $this->adminToken,
        ])->assertStatus(200);

        // Simulate a stray live code on the closed invite (defense-in-depth:
        // the invite's closed state alone must block exchange).
        $stray = IDEConnectCode::create([
            'organization_id' => $invite->organization_id,
            'invite_id' => $invite->id,
            'user_id' => $this->admin->id,
            'expires_at' => Invite::enrollmentNeverExpires(),
        ]);

        // The stray live code fails on the closed-invite gate; the revoked
        // code fails even earlier at code-level expiry.
        $strayResponse = $this->exchange($stray->code, '550e8400-e29b-41d4-a716-4466554400f4');
        $this->assertEquals(400, $strayResponse->status());
        $this->assertStringContainsString('closed', $strayResponse->json('error'));
        $this->assertEquals(400, $this->exchange($code, '550e8400-e29b-41d4-a716-4466554400f5')->status());
    }

    public function test_pilot_health_counts_cancelled_invite_as_revoked_not_expired(): void
    {
        $invite = $this->createEnrollmentInvite();
        $this->issueCode($invite);

        $this->deleteJson("/api/org/invites/{$invite->id}", [], [
            'X-API-Token' => $this->adminToken,
        ])->assertStatus(200);

        $response = $this->getJson('/api/pilot/health', ['X-API-Token' => $this->adminToken]);

        $response->assertStatus(200);
        $this->assertEquals(0, $response->json('connect_code_expiry.expired_unredeemed'));
        $this->assertEquals(0, $response->json('connect_code_expiry.expiring_within_7d'));
        $this->assertEquals(0, $response->json('connect_code_expiry.total_unredeemed'));
        $this->assertEquals(1, $response->json('connect_code_expiry.revoked'));
    }

    // ─── 18H.1: Ed-style reconciliation command ──────────────────────────

    private function seedLegacyEnrollment(string $email): array
    {
        $invite = Invite::create([
            'organization_id' => $this->org->id,
            'token' => Str::random(32),
            'email' => $email,
            'expires_at' => now()->subDays(3), // legacy natural expiry
        ]);
        $code = IDEConnectCode::create([
            'organization_id' => $this->org->id,
            'invite_id' => $invite->id,
            'user_id' => $this->admin->id,
            'expires_at' => now()->subDay(), // legacy natural expiry
        ]);
        return [$invite, $code];
    }

    public function test_reconcile_upgrades_legacy_rows_and_is_idempotent(): void
    {
        [$invite, $code] = $this->seedLegacyEnrollment('legacy-dev@test.com');

        // Dry run: reports rows, changes nothing.
        $this->artisan('chaosmonkey:reconcile-enrollment-expiry', ['--dry-run' => true])
            ->expectsOutputToContain('1')
            ->assertSuccessful();
        $this->assertTrue($invite->fresh()->expires_at->isPast(), 'Dry run must not mutate');

        // Apply.
        $this->artisan('chaosmonkey:reconcile-enrollment-expiry')->assertSuccessful();

        $this->assertEquals(Invite::ENROLLMENT_NEVER_EXPIRES, $invite->fresh()->expires_at->toDateTimeString());
        $this->assertEquals(Invite::ENROLLMENT_NEVER_EXPIRES, $code->fresh()->expires_at->toDateTimeString());

        // Reconciled code is exchangeable again (the designed enrollment path).
        $this->assertEquals(200, $this->exchange($code->code, '550e8400-e29b-41d4-a716-4466554400f6')->status());

        // Idempotent: second run matches nothing.
        $this->artisan('chaosmonkey:reconcile-enrollment-expiry')
            ->expectsOutputToContain('0')
            ->assertSuccessful();
    }

    public function test_reconcile_never_resurrects_revoked_or_touches_unrelated_rows(): void
    {
        // Revoked/cancelled enrollment: revoked marker on invite + code.
        [$closedInvite, $closedCode] = $this->seedLegacyEnrollment('cancelled-dev@test.com');
        $closedInvite->update(['expires_at' => IDEConnectCode::revokedExpiresAt()]);
        $closedCode->update(['expires_at' => IDEConnectCode::revokedExpiresAt()]);

        // Redeemed invite with code.
        [$redeemedInvite, $redeemedCode] = $this->seedLegacyEnrollment('redeemed-dev@test.com');
        $redeemedInvite->update(['redeemed_at' => now()]);

        // Code-less dashboard invite (time-bounded, must not change).
        $dashInvite = Invite::create([
            'organization_id' => $this->org->id,
            'token' => Str::random(32),
            'email' => 'dash@test.com',
            'expires_at' => now()->subDays(2),
        ]);

        // Live installation token bound to the redeemed invite — untouched.
        $installationToken = ApiToken::create([
            'token' => hash('sha256', Str::random(32)),
            'user_id' => $this->admin->id,
            'organization_id' => $this->org->id,
            'invite_id' => $redeemedInvite->id,
            'installation_id' => '550e8400-e29b-41d4-a716-4466554400f7',
            'expires_at' => now()->addDays(60),
        ]);

        $this->artisan('chaosmonkey:reconcile-enrollment-expiry')->assertSuccessful();

        // Revoked/cancelled rows stay closed — never resurrected.
        $this->assertEquals(IDEConnectCode::REVOKED_EXPIRES_AT, $closedInvite->fresh()->expires_at->toDateTimeString());
        $this->assertEquals(IDEConnectCode::REVOKED_EXPIRES_AT, $closedCode->fresh()->expires_at->toDateTimeString());
        $this->assertTrue($closedCode->fresh()->isRevoked());
        $this->assertEquals(400, $this->exchange($closedCode->code, '550e8400-e29b-41d4-a716-4466554400f8')->status());

        // Redeemed invite untouched.
        $this->assertNotEquals(Invite::ENROLLMENT_NEVER_EXPIRES, $redeemedInvite->fresh()->expires_at->toDateTimeString());
        $this->assertNotEquals(Invite::ENROLLMENT_NEVER_EXPIRES, $redeemedCode->fresh()->expires_at->toDateTimeString());

        // Dashboard invite untouched.
        $this->assertTrue($dashInvite->fresh()->expires_at->isPast());

        // Installation token row untouched.
        $this->assertNull($installationToken->fresh()->revoked_at);
        $this->assertEquals($installationToken->expires_at->toDateTimeString(), $installationToken->fresh()->expires_at->toDateTimeString());
    }

    // ─── 12. used_at is never lifecycle evidence ─────────────────────────

    public function test_used_at_stamp_does_not_disable_reusable_code(): void
    {
        $invite = $this->createEnrollmentInvite();
        $code = $this->issueCode($invite);

        // Stamp used_at (legacy field) — the code must remain exchangeable.
        IDEConnectCode::where('code', $code)->update(['used_at' => now()]);

        $response = $this->exchange($code, '550e8400-e29b-41d4-a716-44665544000b');
        $this->assertEquals(200, $response->status(), 'used_at must not disable a live enrollment code');
    }

    public function test_used_at_stamp_does_not_resurrect_revoked_code(): void
    {
        $invite = $this->createEnrollmentInvite();
        $code = $this->issueCode($invite);
        $this->deleteJson("/api/org/invites/{$invite->id}/connect-code", [], [
            'X-API-Token' => $this->adminToken,
        ])->assertStatus(200);

        // used_at state must be irrelevant: revoked stays dead either way.
        IDEConnectCode::where('code', $code)->update(['used_at' => now()]);
        $this->assertEquals(400, $this->exchange($code, '550e8400-e29b-41d4-a716-44665544000c')->status());

        IDEConnectCode::where('code', $code)->update(['used_at' => null]);
        $this->assertEquals(400, $this->exchange($code, '550e8400-e29b-41d4-a716-44665544000d')->status());
    }

    // ─── Additional contract guards ──────────────────────────────────────

    public function test_enrollment_exchange_works_when_invite_is_only_sentinel(): void
    {
        // Guard: a live code on a sentinel invite remains exchangeable even
        // though nothing about the invite is time-bounded.
        $invite = $this->createEnrollmentInvite();
        $code = $this->issueCode($invite);
        $this->assertTrue($invite->fresh()->isDeveloperEnrollment());

        Carbon::setTestNow(now()->addDays(365));
        try {
            $this->assertEquals(200, $this->exchange($code, '550e8400-e29b-41d4-a716-44665544000e')->status());
        } finally {
            Carbon::setTestNow();
        }
    }
}
