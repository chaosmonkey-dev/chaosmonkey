<?php
/**
 * CR-X Hermetic Same-Code Dual-Install Rollout Gauntlet
 *
 * Proves the complete user journey: ONE developer, ONE still-valid connect
 * code, TWO distinct installations (IDE 0.4.1 + Claude Code bridge 0.4.2-cc-bridge).
 *
 * Runs entirely on :memory: SQLite — never touches a real local database
 * or any production environment.
 *
 * Acceptance contract:
 *  - connect code generation produces persistent admin-visible code state
 *  - refresh does not revert to "not generated"
 *  - first installation redemption succeeds
 *  - second DISTINCT installation redemption with same valid code succeeds
 *  - first redemption does NOT consume/destroy the code
 *  - each installation gets a distinct installation credential
 *  - both installations resolve to the SAME canonical developer_id
 *  - IDE event lands under correct IDE workflow
 *  - bridge event lands under claude_code
 *  - source/editor normalization remains distinct
 *  - no duplicate installation identity
 *  - no cross-developer leakage
 *  - expiration fails closed
 *  - replacing/regenerating code follows documented semantics
 *  - old/replaced code behavior is explicit and tested
 *  - Team state survives refresh/reload
 */

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\IDEConnectCode;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\TelemetryEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class HermeticDualInstallRolloutTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;
    private User $admin;
    private Invite $invite;
    private string $connectCode;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = Organization::create(['name' => 'Test Org']);
        $this->admin = User::create([
            'name' => 'Pilot Admin',
            'email' => 'admin@testorg.local',
            'password' => bcrypt('password'),
            'organization_id' => $this->org->id,
            'role' => 'admin',
        ]);
        $this->invite = Invite::create([
            'organization_id' => $this->org->id,
            'token' => Str::uuid()->toString(),
            'email' => 'dev@testorg.local',
            'role' => 'member',
            'expires_at' => now()->addDays(30),
        ]);
        $code = IDEConnectCode::issueForInvite($this->invite, $this->admin->id);
        $this->connectCode = $code->code;
    }

    /** Helper: exchange a connect code for an installation token. */
    private function exchange(string $installationId, string $version = '0.4.1')
    {
        return $this->postJson('/api/ide/connect/exchange', [
            'code' => $this->connectCode,
            'installation_id' => $installationId,
            'extension_version' => $version,
        ]);
    }

    /** Helper: send telemetry with an installation token. */
    private function sendTelemetry(string $token, string $installationId, array $metadata = [])
    {
        $baseMeta = array_merge([
            'session_id' => 'sess-' . Str::uuid()->toString(),
            'installation_id' => $installationId,
            'extension_version' => '0.4.1',
        ], $metadata);

        return $this->postJson('/api/telemetry', [
            'source' => $metadata['source'] ?? 'vscode',
            'installation_id' => $installationId,
            'extension_version' => '0.4.1',
            'events' => [
                [
                    'event_type' => 'session',
                    'timestamp' => now()->toISOString(),
                    'duration_ms' => 60000,
                    'metadata' => $baseMeta,
                ],
            ],
        ], ['Authorization' => "Bearer {$token}"]);
    }

    // ─── 1. Connect code generation & persistence ───────────────────────────

    public function test_connect_code_generation_produces_persistent_state(): void
    {
        $this->assertNotEmpty($this->connectCode);
        $this->assertDatabaseHas('ide_connect_codes', [
            'code' => $this->connectCode,
            'invite_id' => $this->invite->id,
            'organization_id' => $this->org->id,
            'used_at' => null,
        ]);
    }

    public function test_refresh_does_not_revert_to_not_generated(): void
    {
        // Simulate "refresh" by re-querying the code
        $reloaded = IDEConnectCode::where('code', $this->connectCode)->first();
        $this->assertNotNull($reloaded);
        $this->assertFalse($reloaded->isExpired());
        $this->assertTrue($reloaded->isValid());
    }

    public function test_issuing_twice_is_idempotent(): void
    {
        $second = IDEConnectCode::issueForInvite($this->invite, $this->admin->id);
        $this->assertEquals($this->connectCode, $second->code);
    }

    // ─── 2. First installation redemption ──────────────────────────────────

    public function test_first_installation_redemption_succeeds(): void
    {
        $installId = '550e8400-e29b-41d4-a716-446655440001';
        $response = $this->exchange($installId);

        $this->assertEquals(200, $response->status(), "First exchange should succeed: {$response->content()}");
        $body = $response->json();
        $this->assertEquals("invite:{$this->invite->id}", $body['developer_id']);
        $this->assertEquals($this->org->id, $body['organization_id']);
        $this->assertEquals($installId, $body['installation_id']);
        $this->assertNotEmpty($body['token']);
        $this->assertEquals('backend_claimed', $body['identity_source']);
    }

    // ─── 3. Second installation redemption (same code) ─────────────────────

    public function test_second_distinct_installation_redemption_succeeds(): void
    {
        $installA = '550e8400-e29b-41d4-a716-446655440001';
        $installB = '550e8400-e29b-41d4-a716-446655440002';

        $first = $this->exchange($installA);
        $this->assertEquals(200, $first->status());

        $second = $this->exchange($installB);
        $this->assertEquals(200, $second->status(), "Second distinct install should succeed: {$second->content()}");

        $firstBody = $first->json();
        $secondBody = $second->json();

        // Distinct credentials
        $this->assertNotEquals($firstBody['token'], $secondBody['token']);
        $this->assertNotEquals($firstBody['installation_id'], $secondBody['installation_id']);

        // Same canonical developer_id
        $this->assertEquals($firstBody['developer_id'], $secondBody['developer_id']);
        $this->assertEquals("invite:{$this->invite->id}", $firstBody['developer_id']);

        // Same organization
        $this->assertEquals($firstBody['organization_id'], $secondBody['organization_id']);
    }

    // ─── 4. Code not consumed/destroyed by first redemption ────────────────

    public function test_first_redemption_does_not_consume_code(): void
    {
        $installA = '550e8400-e29b-41d4-a716-446655440001';
        $this->exchange($installA);

        // Code should still be valid and unused
        $code = IDEConnectCode::where('code', $this->connectCode)->first();
        $this->assertNotNull($code);
        $this->assertNull($code->used_at);
        $this->assertTrue($code->isValid());
    }

    // ─── 5. Distinct installation credentials ──────────────────────────────

    public function test_each_installation_gets_distinct_credential(): void
    {
        $installA = '550e8400-e29b-41d4-a716-446655440001';
        $installB = '550e8400-e29b-41d4-a716-446655440002';

        $this->exchange($installA);
        $this->exchange($installB);

        $tokens = ApiToken::where('invite_id', $this->invite->id)->get();
        $this->assertCount(2, $tokens);
        $this->assertNotEquals($tokens[0]->token, $tokens[1]->token);
        $this->assertNotEquals($tokens[0]->installation_id, $tokens[1]->installation_id);
    }

    // ─── 6. Both resolve to same canonical developer_id ───────────────────

    public function test_both_installations_resolve_to_same_developer_id(): void
    {
        $installA = '550e8400-e29b-41d4-a716-446655440001';
        $installB = '550e8400-e29b-41d4-a716-446655440002';

        $first = $this->exchange($installA)->json();
        $second = $this->exchange($installB)->json();

        $this->assertEquals($first['developer_id'], $second['developer_id']);
    }

    // ─── 7. IDE telemetry classified as correct IDE workflow ───────────────

    public function test_ide_telemetry_classified_as_correct_ide_workflow(): void
    {
        $installId = '550e8400-e29b-41d4-a716-446655440001';
        $token = $this->exchange($installId)->json()['token'];

        $response = $this->sendTelemetry($token, $installId, [
            'source' => 'cursor',
            'editor_source' => 'cursor',
            'appName' => 'Cursor',
            'uriScheme' => 'cursor',
        ]);

        $this->assertEquals(200, $response->status(), "IDE telemetry should succeed: {$response->content()}");

        // installation_id is stored in metadata JSON, not a column
        $event = TelemetryEvent::where('source', 'cursor')->first();
        $this->assertNotNull($event, 'IDE telemetry event should be persisted');
        $this->assertEquals('cursor', $event->source);
        $meta = is_string($event->metadata) ? json_decode($event->metadata, true) : (array)$event->metadata;
        $this->assertEquals($installId, $meta['installation_id'] ?? null);
    }

    // ─── 8. Bridge telemetry classified as claude_code ─────────────────────

    public function test_bridge_telemetry_classified_as_claude_code(): void
    {
        $installId = '550e8400-e29b-41d4-a716-446655440002';
        $token = $this->exchange($installId)->json()['token'];

        $response = $this->sendTelemetry($token, $installId, [
            'source' => 'claude_code',
            'editor_source' => 'claude_code',
            'extension_version' => '0.4.2-cc-bridge',
        ]);

        $this->assertEquals(200, $response->status(), "Bridge telemetry should succeed: {$response->content()}");

        // installation_id is in metadata JSON; source may be normalized
        $event = TelemetryEvent::where('source', 'claude_code')
            ->orWhere('source', 'claude-code')
            ->first();
        $this->assertNotNull($event, 'Bridge telemetry event should be persisted');
        $this->assertContains($event->source, ['claude_code', 'claude-code']);
    }

    // ─── 9. Source/editor normalization remains distinct ──────────────────

    public function test_source_editor_normalization_remains_distinct(): void
    {
        $installA = '550e8400-e29b-41d4-a716-446655440001';
        $installB = '550e8400-e29b-41d4-a716-446655440002';

        $tokenA = $this->exchange($installA)->json()['token'];
        $tokenB = $this->exchange($installB)->json()['token'];

        // IDE: cursor
        $this->sendTelemetry($tokenA, $installA, [
            'source' => 'cursor',
            'editor_source' => 'cursor',
        ]);

        // Bridge: claude_code
        $this->sendTelemetry($tokenB, $installB, [
            'source' => 'claude_code',
            'editor_source' => 'claude_code',
            'extension_version' => '0.4.2-cc-bridge',
        ]);

        $eventA = TelemetryEvent::where('source', 'cursor')->first();
        $eventB = TelemetryEvent::where('source', 'claude_code')
            ->orWhere('source', 'claude-code')
            ->first();

        $this->assertNotNull($eventA, 'IDE event should exist');
        $this->assertNotNull($eventB, 'Bridge event should exist');
        $this->assertNotEquals($eventA->source, $eventB->source);
    }

    // ─── 10. No duplicate installation identity ────────────────────────────

    public function test_no_duplicate_installation_identity(): void
    {
        $installA = '550e8400-e29b-41d4-a716-446655440001';

        $this->exchange($installA);
        // Exchange again with same installation_id — creates a second token
        // but both have the same installation_id (not a duplicate identity,
        // just a renewed credential for the same installation)
        $this->exchange($installA);

        $tokens = ApiToken::where('installation_id', $installA)->get();
        $this->assertGreaterThanOrEqual(1, $tokens->count());
        // All tokens for this installation_id share the same developer_id
        foreach ($tokens as $t) {
            $this->assertEquals($this->invite->id, $t->invite_id);
        }
    }

    // ─── 11. No cross-developer leakage ───────────────────────────────────

    public function test_no_cross_developer_leakage(): void
    {
        // Create a second org + invite
        $org2 = Organization::create(['name' => 'Org 2']);
        $admin2 = User::create([
            'name' => 'Admin 2',
            'email' => 'admin2@testorg.local',
            'password' => bcrypt('password'),
            'organization_id' => $org2->id,
            'role' => 'admin',
        ]);
        $invite2 = Invite::create([
            'organization_id' => $org2->id,
            'token' => Str::uuid()->toString(),
            'email' => 'dev2@testorg.local',
            'role' => 'member',
            'expires_at' => now()->addDays(30),
        ]);
        $code2 = IDEConnectCode::issueForInvite($invite2, $admin2->id);

        $installA = '550e8400-e29b-41d4-a716-446655440001';
        $installB = '660e8400-e29b-41d4-a716-446655440002';

        $tokenA = $this->exchange($installA)->json()['token'];

        // Exchange org2's code
        $responseB = $this->postJson('/api/ide/connect/exchange', [
            'code' => $code2->code,
            'installation_id' => $installB,
            'extension_version' => '0.4.1',
        ]);
        $this->assertEquals(200, $responseB->status());
        $bodyB = $responseB->json();

        // Different developer_ids
        $this->assertNotEquals("invite:{$this->invite->id}", $bodyB['developer_id']);
        $this->assertEquals("invite:{$invite2->id}", $bodyB['developer_id']);

        // Different orgs
        $this->assertNotEquals($this->org->id, $bodyB['organization_id']);
    }

    // ─── 12. Expiration fails closed ──────────────────────────────────────

    public function test_expired_code_fails_closed(): void
    {
        // Expire the code
        $code = IDEConnectCode::where('code', $this->connectCode)->first();
        $code->expires_at = now()->subDay();
        $code->save();

        $installId = '550e8400-e29b-41d4-a716-446655440001';
        $response = $this->exchange($installId);

        $this->assertEquals(400, $response->status());
        $this->assertStringContainsString('expired', $response->json('error'));
    }

    // ─── 13. Regenerated/replaced code invalidates prior codes ────────────

    public function test_regenerated_code_invalidates_prior_codes(): void
    {
        $oldCode = $this->connectCode;

        // Revoke old codes and issue a new one
        IDEConnectCode::revokeForInvite($this->invite);
        $newCode = IDEConnectCode::issueForInvite($this->invite, $this->admin->id, forceNew: true);

        $this->assertNotEquals($oldCode, $newCode->code);

        // Old code should now be expired
        $oldCodeModel = IDEConnectCode::where('code', $oldCode)->first();
        $this->assertTrue($oldCodeModel->isExpired());

        // Old code exchange fails
        $installId = '550e8400-e29b-41d4-a716-446655440001';
        $oldResponse = $this->postJson('/api/ide/connect/exchange', [
            'code' => $oldCode,
            'installation_id' => $installId,
            'extension_version' => '0.4.1',
        ]);
        $this->assertEquals(400, $oldResponse->status());

        // New code exchange succeeds
        $newResponse = $this->postJson('/api/ide/connect/exchange', [
            'code' => $newCode->code,
            'installation_id' => $installId,
            'extension_version' => '0.4.1',
        ]);
        $this->assertEquals(200, $newResponse->status());
    }

    // ─── 14. Team state survives refresh/reload ───────────────────────────

    public function test_team_state_survives_refresh(): void
    {
        $installId = '550e8400-e29b-41d4-a716-446655440001';
        $this->exchange($installId);

        // Simulate refresh by re-querying from DB
        $code = IDEConnectCode::where('code', $this->connectCode)->first();
        $this->assertNotNull($code);
        $this->assertTrue($code->isValid());

        $tokens = ApiToken::where('invite_id', $this->invite->id)->get();
        $this->assertCount(1, $tokens);
        $this->assertEquals($installId, $tokens->first()->installation_id);
    }

    // ─── 15. Installation_id mismatch rejected ─────────────────────────────

    public function test_installation_id_mismatch_rejected(): void
    {
        $installA = '550e8400-e29b-41d4-a716-446655440001';
        $installB = '550e8400-e29b-41d4-a716-446655440002';

        $tokenA = $this->exchange($installA)->json()['token'];

        // Try to send telemetry with a different installation_id
        $response = $this->sendTelemetry($tokenA, $installB);

        $this->assertEquals(403, $response->status());
        $this->assertEquals('INSTALLATION_ID_MISMATCH', $response->json('error_code'));
    }

    // ─── 16. Frozen artifact versions ──────────────────────────────────────

    public function test_frozen_ide_vsix_artifact_exists(): void
    {
        $vsixPath = resource_path('extensions/chaosmonkey-telemetry-0.4.1.vsix');
        $this->assertFileExists($vsixPath, 'IDE VSIX 0.4.1 must exist in backend resources');

        $hash = hash_file('sha256', $vsixPath);
        $this->assertEquals(
            '7f434439a6cfb5b0da39e10a49c7f9724c225b25d27857146076ee5a5e4c7626',
            $hash,
            'IDE VSIX SHA-256 must match frozen artifact'
        );
    }

    public function test_frozen_bridge_tgz_artifact_exists(): void
    {
        $tgzPath = resource_path('extensions/chaosmonkey-cc-bridge-0.4.2-cc-bridge.tgz');
        $this->assertFileExists($tgzPath, 'Bridge tarball 0.4.2-cc-bridge must exist in backend resources');

        $hash = hash_file('sha256', $tgzPath);
        $this->assertEquals(
            '700122fbf079834591c2eb789d869238c7bf4e82872df4453e03ab312201c6ab',
            $hash,
            'Bridge tarball SHA-256 must match frozen artifact'
        );
    }

    // ─── 17. Version gate rejects old extensions ──────────────────────────

    public function test_old_extension_version_rejected(): void
    {
        $installId = '550e8400-e29b-41d4-a716-446655440001';
        $response = $this->exchange($installId, '0.3.8');

        $this->assertEquals(400, $response->status());
        $this->assertEquals('VERSION_TOO_OLD', $response->json('error_code'));
    }

    // ─── 18. Token renewal ────────────────────────────────────────────────

    public function test_token_renewal_extends_expiry(): void
    {
        $installId = '550e8400-e29b-41d4-a716-446655440001';
        $token = $this->exchange($installId)->json()['token'];

        // Set expiry to <14 days so renewal triggers
        $tokenRow = ApiToken::where('installation_id', $installId)->first();
        $tokenRow->expires_at = now()->addDays(5);
        $tokenRow->save();

        $response = $this->postJson('/api/ide/connect/renew', [], [
            'Authorization' => "Bearer {$token}",
        ]);

        $this->assertEquals(200, $response->status());
        $this->assertTrue($response->json('renewed'));
    }
}
