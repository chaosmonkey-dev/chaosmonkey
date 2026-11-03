<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\ApiToken;
use App\Models\Invite;
use App\Models\Organization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;

/**
 * P0-G Part D: event_id idempotency tests.
 *
 * Verifies that telemetry events with the same event_id are deduplicated,
 * and that historical events without event_id remain compatible.
 */
class EventIdIdempotencyTest extends TestCase
{
    use RefreshDatabase;

    private function createInstallationToken(Organization $org, Invite $invite, string $installationId): string
    {
        $user = \App\Models\User::factory()->create(['organization_id' => $org->id]);
        $raw = Str::random(64);
        ApiToken::create([
            'token' => hash('sha256', $raw),
            'user_id' => $user->id,
            'organization_id' => $org->id,
            'invite_id' => $invite->id,
            'installation_id' => $installationId,
            'expires_at' => now()->addDays(90),
        ]);

        return $raw;
    }

    private function buildTelemetryPayload(string $eventId, string $batchHash, string $installationId = '550e8400-e29b-41d4-a716-446655440010'): array
    {
        return [
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'extension_version' => '0.4.1',
            'installation_id' => $installationId,
            'developer_id' => 'invite:1',
            'team_id' => null,
            'identity_schema_version' => '1.0',
            'batch_hash' => $batchHash,
            'events' => [
                [
                    'event_type' => 'file_edit',
                    'count' => 1,
                    'timestamp' => now()->toISOString(),
                    'metadata' => [
                        'session_id' => 'session_test_1',
                        'event_id' => $eventId,
                        'installation_id' => $installationId,
                    ],
                ],
            ],
        ];
    }

    public function test_first_event_with_event_id_is_accepted(): void
    {
        $org = Organization::factory()->create();
        $invite = Invite::factory()->create(['organization_id' => $org->id]);
        $installId = '550e8400-e29b-41d4-a716-446655440010';
        $token = $this->createInstallationToken($org, $invite, $installId);

        $payload = $this->buildTelemetryPayload('evt_abc123_unique_1', hash('sha256', 'batch1'), $installId);
        $response = $this->withToken($token)->postJson('/api/telemetry', $payload);

        $response->assertStatus(200);
        $response->assertJson(['duplicate' => false]);
    }

    public function test_duplicate_event_id_is_rejected_as_duplicate(): void
    {
        $org = Organization::factory()->create();
        $invite = Invite::factory()->create(['organization_id' => $org->id]);
        $installId = '550e8400-e29b-41d4-a716-446655440011';
        $token = $this->createInstallationToken($org, $invite, $installId);

        $eventId = 'evt_dup_test_unique_2';
        $payload1 = $this->buildTelemetryPayload($eventId, hash('sha256', 'batch2a'), $installId);
        $payload2 = $this->buildTelemetryPayload($eventId, hash('sha256', 'batch2b'), $installId);

        $response1 = $this->withToken($token)->postJson('/api/telemetry', $payload1);
        $response1->assertStatus(200);
        $response1->assertJson(['duplicate' => false]);

        // Same event_id, different batch_hash — should be rejected as duplicate
        $response2 = $this->withToken($token)->postJson('/api/telemetry', $payload2);
        $response2->assertStatus(200);
        $response2->assertJson(['duplicate' => true]);
    }

    public function test_different_event_ids_are_both_accepted(): void
    {
        $org = Organization::factory()->create();
        $invite = Invite::factory()->create(['organization_id' => $org->id]);
        $installId = '550e8400-e29b-41d4-a716-446655440012';
        $token = $this->createInstallationToken($org, $invite, $installId);

        $payload1 = $this->buildTelemetryPayload('evt_unique_a', hash('sha256', 'batch3a'), $installId);
        $payload2 = $this->buildTelemetryPayload('evt_unique_b', hash('sha256', 'batch3b'), $installId);

        $response1 = $this->withToken($token)->postJson('/api/telemetry', $payload1);
        $response1->assertStatus(200);
        $response1->assertJson(['duplicate' => false]);

        $response2 = $this->withToken($token)->postJson('/api/telemetry', $payload2);
        $response2->assertStatus(200);
        $response2->assertJson(['duplicate' => false]);
    }

    public function test_event_without_event_id_remains_compatible(): void
    {
        $org = Organization::factory()->create();
        $invite = Invite::factory()->create(['organization_id' => $org->id]);
        $installId = '550e8400-e29b-41d4-a716-446655440013';
        $token = $this->createInstallationToken($org, $invite, $installId);

        $payload = [
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'extension_version' => '0.4.1',
            'installation_id' => $installId,
            'developer_id' => 'invite:1',
            'team_id' => null,
            'identity_schema_version' => '1.0',
            'batch_hash' => hash('sha256', 'batch_no_event_id'),
            'events' => [
                [
                    'event_type' => 'file_edit',
                    'count' => 1,
                    'timestamp' => now()->toISOString(),
                    'metadata' => [
                        'session_id' => 'session_test_no_event_id',
                        'installation_id' => $installId,
                        // No event_id — historical compatibility
                    ],
                ],
            ],
        ];

        $response = $this->withToken($token)->postJson('/api/telemetry', $payload);
        $response->assertStatus(200);
        $response->assertJson(['duplicate' => false]);
    }

    public function test_event_id_is_stored_in_database(): void
    {
        $org = Organization::factory()->create();
        $invite = Invite::factory()->create(['organization_id' => $org->id]);
        $installId = '550e8400-e29b-41d4-a716-446655440014';
        $token = $this->createInstallationToken($org, $invite, $installId);

        $eventId = 'evt_stored_test_unique';
        $payload = $this->buildTelemetryPayload($eventId, hash('sha256', 'batch_stored'), $installId);

        $response = $this->withToken($token)->postJson('/api/telemetry', $payload);
        $response->assertStatus(200);

        $this->assertDatabaseHas('telemetry_events', ['event_id' => $eventId]);
    }
}
