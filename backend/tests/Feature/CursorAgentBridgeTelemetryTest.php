<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\TelemetryEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Cursor Agent Bridge — backend compatibility contract.
 *
 * Verifies that events emitted by extensions/cursor-agent-bridge
 * (source='cursor-agent', metadata.appName='Cursor') flow through the
 * existing ingestion → persistence → canonical-population pipeline with
 * correct tool classification and provenance — with NO backend changes.
 *
 * Payloads here are synthetic fixtures mirroring the bridge's envelope,
 * derived from Cursor's documented hook contract. They do not prove
 * behavior inside a real authenticated Cursor Agents Window.
 */
class CursorAgentBridgeTelemetryTest extends TestCase
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

    private function enrollBridgeInstallation(string $installationId = '550e8400-e29b-41d4-a716-446655440201'): array
    {
        $response = $this->postJson('/api/org/invites', [
            'email' => 'agent-fixture@test.com',
            'role' => 'member',
            'send_email' => false,
            'purpose' => 'developer_enrollment',
        ], ['X-API-Token' => $this->adminToken]);
        $response->assertStatus(200);
        $invite = Invite::findOrFail($response->json('invite.id'));

        $codeResponse = $this->postJson("/api/org/invites/{$invite->id}/connect-code", [], [
            'X-API-Token' => $this->adminToken,
        ]);
        if ($codeResponse->status() !== 200) {
            fwrite(STDERR, "CODE ISSUE FAILED: " . $codeResponse->getContent() . "\n");
        }
        $codeResponse->assertStatus(200);
        $code = $codeResponse->json('connect_code');

        $exchange = $this->postJson('/api/ide/connect/exchange', [
            'code' => $code,
            'installation_id' => $installationId,
            'extension_version' => '0.4.2-cursor-bridge',
        ]);
        if ($exchange->status() !== 200) {
            fwrite(STDERR, "EXCHANGE FAILED: " . $exchange->getContent() . "\n");
        }
        $exchange->assertStatus(200);

        return [$invite, $installationId, $exchange->json('token'), $code];
    }

    private function exchangeFor(string $code, string $installationId, string $version): string
    {
        $exchange = $this->postJson('/api/ide/connect/exchange', [
            'code' => $code,
            'installation_id' => $installationId,
            'extension_version' => $version,
        ]);
        $exchange->assertStatus(200);
        return $exchange->json('token');
    }

    private function bridgeSessionPayload(string $installationId, string $inviteRef, string $sessionId, string $eventId): array
    {
        return [
            'source' => 'cursor-agent',
            'editor_source' => 'cursor',
            'extension_version' => '0.4.2-cursor-bridge',
            'installation_id' => $installationId,
            'developer_id' => $inviteRef,
            'organization_id' => $this->org->id,
            'identity_source' => 'backend_claimed',
            'identity_schema_version' => 1,
            'events' => [[
                'event_type' => 'session',
                'count' => 1,
                'duration_ms' => 65432,
                'timestamp' => now()->toISOString(),
                'session_id' => $sessionId,
                'metadata' => [
                    'source' => 'cursor-agent',
                    'appName' => 'Cursor',
                    'vscode_version' => '2.3.1',
                    'extension_version' => '0.4.2-cursor-bridge',
                    'segment_type' => 'session',
                    'session_id' => $sessionId,
                    'event_id' => $eventId,
                    'installation_id' => $installationId,
                    'developer_id' => $inviteRef,
                    'identity_source' => 'backend_claimed',
                    'identity_schema_version' => 1,
                    'end_reason' => 'session_end',
                    'duration_source' => 'cursor_session_end',
                    'composer_mode' => 'agent',
                    'is_background_agent' => true,
                    'model_id' => 'fixture-model',
                    'agent_turn_count' => 3,
                    'ai_burst_count' => 2,
                    'ai_authored' => true,
                    'bash_invocation_count' => 1,
                    'git_repo_url' => 'https://github.com/Acme/repo.git',
                    'git_branch' => 'main',
                ],
            ]],
        ];
    }

    public function test_bridge_session_persists_with_cursor_tool_and_agent_provenance(): void
    {
        [$invite, $installationId, $token] = $this->enrollBridgeInstallation();
        $inviteRef = "invite:{$invite->id}";
        $sessionId = 'cursor-agent-fixture-001';
        $eventId = 'ca-' . $sessionId . '-session';

        $ingest = $this->withToken($token)
            ->postJson('/api/telemetry', $this->bridgeSessionPayload($installationId, $inviteRef, $sessionId, $eventId));
        $ingest->assertStatus(200);
        $this->assertFalse($ingest->json('duplicate'));
        $this->assertEquals(1, TelemetryEvent::count());

        $event = TelemetryEvent::firstOrFail();
        // Provenance: observation plane preserved in source column
        $this->assertEquals('cursor-agent', $event->source);
        // Host product resolved to cursor (from metadata.appName)
        $this->assertEquals('cursor', $event->editor_source);
        $this->assertEquals($sessionId, $event->session_id);
        $this->assertEquals($inviteRef, $event->user_id);
        $this->assertEquals($this->org->id, $event->organization_id);
        $this->assertEquals($eventId, $event->event_id);

        $metadata = is_array($event->metadata) ? $event->metadata : json_decode($event->metadata, true);
        $this->assertEquals('cursor-agent', $metadata['source']);
        $this->assertEquals('Cursor', $metadata['appName']);
        $this->assertTrue($metadata['is_background_agent']);
        $this->assertEquals('agent', $metadata['composer_mode']);
        $this->assertArrayNotHasKey('tool', $metadata, 'metadata.tool must not be set');
    }

    public function test_bridge_session_enters_canonical_population_as_cursor(): void
    {
        [$invite, $installationId, $token] = $this->enrollBridgeInstallation();
        $inviteRef = "invite:{$invite->id}";

        $ingest = $this->withToken($token)
            ->postJson('/api/telemetry', $this->bridgeSessionPayload(
                $installationId, $inviteRef, 'cursor-agent-fixture-002', 'ca-fixture-002-session'));
        $ingest->assertStatus(200);

        $canonical = $this->withToken($this->adminToken)
            ->getJson('/api/telemetry/canonical?format=sessions');
        $canonical->assertStatus(200);
        $this->assertEquals(1, $canonical->json('metadata.canonical_population_count'));
        $this->assertContains('cursor', $canonical->json('metadata.tools_in_population'));
        $this->assertNotContains('claude_code', $canonical->json('metadata.tools_in_population'));
        $this->assertNotContains('codex', $canonical->json('metadata.tools_in_population'));
    }

    public function test_event_id_replay_is_idempotent(): void
    {
        [$invite, $installationId, $token] = $this->enrollBridgeInstallation();
        $inviteRef = "invite:{$invite->id}";
        $payload = $this->bridgeSessionPayload($installationId, $inviteRef, 'cursor-agent-fixture-003', 'ca-fixture-003-session');

        $first = $this->withToken($token)->postJson('/api/telemetry', $payload);
        $first->assertStatus(200);
        $second = $this->withToken($token)->postJson('/api/telemetry', $payload);
        $second->assertStatus(200);
        $this->assertTrue($second->json('duplicate'));
        $this->assertEquals(1, TelemetryEvent::count(), 'event_id replay must not create a second row');
    }

    public function test_ide_and_agent_sessions_from_same_developer_coexist_as_cursor(): void
    {
        [$invite, $installationId, $token, $code] = $this->enrollBridgeInstallation();
        $inviteRef = "invite:{$invite->id}";

        // Agent session via bridge
        $this->withToken($token)
            ->postJson('/api/telemetry', $this->bridgeSessionPayload(
                $installationId, $inviteRef, 'cursor-agent-fixture-004', 'ca-fixture-004-session'))
            ->assertStatus(200);

        // Second installation for the same developer — the real-world
        // IDE+bridge coexistence shape (tokens are installation-bound)
        $ideInstallationId = '550e8400-e29b-41d4-a716-446655440202';
        $ideToken = $this->exchangeFor($code, $ideInstallationId, '0.4.1');

        // IDE session via the existing VSIX envelope (source=cursor)
        $idePayload = [
            'source' => 'cursor',
            'editor_source' => 'cursor',
            'extension_version' => '0.4.1',
            'installation_id' => $ideInstallationId,
            'developer_id' => $inviteRef,
            'organization_id' => $this->org->id,
            'identity_source' => 'backend_claimed',
            'identity_schema_version' => 1,
            'events' => [[
                'event_type' => 'session',
                'count' => 1,
                'duration_ms' => 300000,
                'timestamp' => now()->toISOString(),
                'session_id' => 'cursor-ide-fixture-004',
                'metadata' => [
                    'source' => 'cursor',
                    'appName' => 'Cursor',
                    'uriScheme' => 'cursor',
                    'extension_version' => '0.4.1',
                    'vscode_version' => '1.128.0',
                    'segment_type' => 'session',
                    'session_id' => 'cursor-ide-fixture-004',
                    'event_id' => 'ide-fixture-004-session',
                    'installation_id' => $ideInstallationId,
                    'developer_id' => $inviteRef,
                    'identity_source' => 'backend_claimed',
                    'identity_schema_version' => 1,
                    'end_reason' => 'idle',
                ],
            ]],
        ];
        $this->withToken($ideToken)->postJson('/api/telemetry', $idePayload)->assertStatus(200);

        $this->assertEquals(2, TelemetryEvent::count());
        // Both observation planes preserved in the source column
        $this->assertEquals(
            ['cursor-agent', 'cursor'],
            TelemetryEvent::orderBy('id')->pluck('source')->all()
        );

        $canonical = $this->withToken($this->adminToken)
            ->getJson('/api/telemetry/canonical?format=sessions');
        $canonical->assertStatus(200);
        // One canonical workflow (cursor), two sessions — no workflow double-count
        $tools = $canonical->json('metadata.tools_in_population');
        $this->assertEquals(['cursor'], array_values(array_unique($tools)));
    }

    /**
     * Agent sessions must never produce human active-coding metrics.
     * source='cursor-agent' sessions resolve tool='cursor'; they are gated
     * into the delegated-agent path so their verified agent edit spans are
     * not recomputed as human active_coding_duration_ms.
     */
    public function test_agent_file_edits_must_not_become_human_active_coding(): void
    {
        [$invite, $installationId, $token] = $this->enrollBridgeInstallation();
        $inviteRef = "invite:{$invite->id}";
        $sessionId = 'cursor-agent-fixture-005';

        $sessionPayload = $this->bridgeSessionPayload(
            $installationId, $inviteRef, $sessionId, 'ca-fixture-005-session');
        $this->withToken($token)->postJson('/api/telemetry', $sessionPayload)->assertStatus(200);

        // Two agent-authored file edits, 90s apart, same session
        foreach ([['ca-fixture-005-e1', 0], ['ca-fixture-005-e2', 90000]] as [$eventId, $offsetMs]) {
            $edit = $this->bridgeSessionPayload($installationId, $inviteRef, $sessionId, $eventId);
            $edit['events'][0]['event_type'] = 'file_edit';
            $edit['events'][0]['duration_ms'] = null;
            $edit['events'][0]['timestamp'] = now()->addMilliseconds($offsetMs)->toISOString();
            $edit['events'][0]['metadata']['segment_type'] = 'event';
            $edit['events'][0]['metadata']['chars_added'] = 40;
            $edit['events'][0]['metadata']['ai_authored'] = true;
            $edit['events'][0]['metadata']['agent_verified'] = true;
            $this->withToken($token)->postJson('/api/telemetry', $edit)->assertStatus(200);
        }

        // The PI session-row path (/api/telemetry/sessions) runs
        // normalizeSessionRow → computeActiveCodingDuration for non-delegated
        // tools. Bridge sessions resolve tool='cursor' → not delegated →
        // the agent file_edit span becomes "active coding duration".
        // Auth-protected org-scoped read — use the admin dashboard token.
        $sessions = $this->withToken($this->adminToken)->getJson('/api/telemetry/sessions?days=all&per_page=200');
        $sessions->assertStatus(200);
        $data = $sessions->json('data');

        $row = collect($data)
            ->firstWhere('session_id', $sessionId);
        $this->assertNotNull($row, 'bridge session must appear in sessions feed');

        // source='cursor-agent' sessions are now gated into the
        // delegated-agent path, so the bridge's authoritative null is honored
        // and agent edit spans can never be recomputed as human
        // active-coding time — even if the latent Carbon-3
        // diffInMilliseconds sign bug in computeActiveCodingDuration is
        // fixed later.
        $this->assertNull(
            $row['active_coding_duration_ms'],
            'agent sessions must not report human active-coding duration'
        );
    }

    private function bridgeSegmentPayload(string $installationId, string $inviteRef, string $sessionId, array $segment): array
    {
        $payload = $this->bridgeSessionPayload($installationId, $inviteRef, $sessionId, $segment['event_id']);
        $payload['events'][0]['duration_ms'] = $segment['duration_ms'];
        $payload['events'][0]['timestamp'] = $segment['timestamp']->toISOString();
        $payload['events'][0]['metadata'] = array_merge($payload['events'][0]['metadata'], [
            'session_segment' => true,
            'segment_ordinal' => $segment['ordinal'],
            'is_final_segment' => $segment['is_final'] ?? false,
            'end_reason' => $segment['end_reason'],
            'duration_source' => $segment['duration_source'],
            'cursor_session_duration_ms' => $segment['cursor_session_duration_ms'] ?? null,
            'agent_turn_count' => $segment['turns'] ?? 0,
            'ai_burst_count' => $segment['edits'] ?? 0,
            'chars_added_total' => $segment['chars'] ?? 0,
        ]);
        return $payload;
    }

    /**
     * Canonical visibility for the segment contract: a persistent Cursor
     * conversation emits one session-segment event per completed turn, plus a
     * final remainder on genuine sessionEnd. All share the stable
     * conversation session_id with disjoint, delta-only intervals.
     */
    public function test_turn_segments_enter_canonical_population_without_duplicates(): void
    {
        [$invite, $installationId, $token] = $this->enrollBridgeInstallation();
        $inviteRef = "invite:{$invite->id}";
        $sessionId = 'cursor-agent-conv-1';
        $t0 = now()->subMinutes(30);

        $segments = [
            ['event_id' => "ca-{$sessionId}-seg-1", 'ordinal' => 1, 'duration_ms' => 45000,
             'timestamp' => $t0->copy()->addSeconds(45), 'end_reason' => 'turn_boundary',
             'duration_source' => 'local_measured', 'turns' => 1, 'edits' => 1, 'chars' => 82],
            ['event_id' => "ca-{$sessionId}-seg-2", 'ordinal' => 2, 'duration_ms' => 60000,
             'timestamp' => $t0->copy()->addSeconds(105), 'end_reason' => 'turn_boundary',
             'duration_source' => 'local_measured', 'turns' => 1, 'edits' => 1, 'chars' => 110],
            ['event_id' => "ca-{$sessionId}-seg-3", 'ordinal' => 3, 'duration_ms' => 8000,
             'timestamp' => $t0->copy()->addSeconds(113), 'end_reason' => 'session_end',
             'duration_source' => 'cursor_session_end', 'is_final' => true,
             'cursor_session_duration_ms' => 113000, 'turns' => 0, 'edits' => 0, 'chars' => 0],
        ];

        foreach ($segments as $seg) {
            $this->withToken($token)
                ->postJson('/api/telemetry', $this->bridgeSegmentPayload(
                    $installationId, $inviteRef, $sessionId, $seg))
                ->assertStatus(200);
        }

        // Three segment rows — one canonical conversation via shared session_id
        $this->assertEquals(3, TelemetryEvent::where('session_id', $sessionId)->count());
        $this->assertEquals(3, TelemetryEvent::where('session_id', $sessionId)->distinct()->count('event_id'));

        // Sum of segment durations equals the measured conversation span —
        // intervals are disjoint, nothing double-counted.
        $this->assertEquals(
            113000,
            TelemetryEvent::where('session_id', $sessionId)->sum('duration_ms'),
            'segment durations must sum to the conversation span'
        );

        // Canonical population sees the completed work immediately.
        $canonical = $this->withToken($this->adminToken)
            ->getJson('/api/telemetry/canonical?format=sessions');
        $canonical->assertStatus(200);
        $this->assertContains('cursor', $canonical->json('metadata.tools_in_population'));
        $this->assertGreaterThanOrEqual(1, $canonical->json('metadata.canonical_population_count'));
        // Segment vs conversation distinction: 3 reporting segments under
        // one stable Cursor conversation ID.
        $this->assertEquals(3, $canonical->json('metadata.canonical_population_count'));
        $this->assertEquals(1, $canonical->json('metadata.canonical_conversation_count'));
        $this->assertEquals(['cursor' => 3], $canonical->json('metadata.session_count_by_tool'));
        $this->assertEquals(['cursor' => 1], $canonical->json('metadata.conversation_count_by_tool'));

        // Session feed exposes all three segments under the stable
        // conversation session_id, classified as the cursor workflow.
        $sessions = $this->withToken($this->adminToken)->getJson('/api/telemetry/sessions?days=all&per_page=200');
        $rows = collect($sessions->json('data'))->where('session_id', $sessionId);
        $this->assertEquals(3, $rows->count(), 'all segments must appear in the sessions feed');
        foreach ($rows as $r) {
            $this->assertEquals('cursor', $r['tool'] ?? null);
        }

        // Replay of a segment event_id is idempotent — no duplicate interval.
        $replay = $this->withToken($token)
            ->postJson('/api/telemetry', $this->bridgeSegmentPayload(
                $installationId, $inviteRef, $sessionId, $segments[0]));
        $this->assertTrue($replay->json('duplicate'));
        $this->assertEquals(3, TelemetryEvent::where('session_id', $sessionId)->count());
    }
}
