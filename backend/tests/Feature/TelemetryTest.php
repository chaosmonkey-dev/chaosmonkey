<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Organization;
use App\Models\TelemetryEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class TelemetryTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = Organization::create([
            'name' => 'ChaosMonkey',
            'slug' => 'chaosmonkey',
        ]);
    }

    private Organization $org;

    /**
     * Issue a dashboard-style API token for a user in the test org.
     * Read endpoints now require SimpleTokenAuth.
     */
    private function dashboardToken(): string
    {
        $user = User::factory()->create(['organization_id' => $this->org->id]);
        $raw = 'test-dashboard-' . Str::random(16);
        ApiToken::create([
            'token' => hash('sha256', $raw),
            'user_id' => $user->id,
            'organization_id' => $this->org->id,
            'expires_at' => now()->addDays(30),
        ]);
        return $raw;
    }

    public function test_telemetry_endpoint_accepts_valid_payload(): void
    {
        $user = User::factory()->create();

        $payload = [
            'user_id' => 'test-user',
            'source' => 'vscode',
            'events' => [
                [
                    'event_type' => 'file_edit',
                    'duration_ms' => 1200,
                    'file_path' => '/Users/dev/project/file.php',
                    'content' => '<?php echo "secret"; ?>',
                ],
            ],
        ];

        $response = $this->actingAs($user)->postJson('/api/telemetry', $payload);

        $response->assertStatus(200)
            ->assertJson([
                'status' => 'ok',
                'received' => 1,
                'duplicate' => false,
            ]);

        $this->assertDatabaseCount('telemetry_events', 1);

        /** @var TelemetryEvent $event */
        $event = TelemetryEvent::first();
        $this->assertSame('test-user', $event->user_id);
        $this->assertSame('vscode', $event->source);
        $this->assertArrayHasKey(0, $event->payload);
        // Sanitization strips raw content and file_path from payload
        $this->assertArrayNotHasKey('content', $event->payload[0]);
        $this->assertArrayNotHasKey('file_path', $event->payload[0]);
    }

    public function test_telemetry_endpoint_rejects_invalid_payload(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/telemetry', []);

        $response->assertStatus(422);
        $this->assertDatabaseCount('telemetry_events', 0);
    }

    public function test_telemetry_endpoint_is_idempotent_for_duplicate_batches(): void
    {
        $user = User::factory()->create();

        $payload = [
            'user_id' => 'dupe-user',
            'source' => 'cursor',
            'batch_hash' => 'fixed-deterministic-batch-hash-for-testing',
            'events' => [
                ['event_type' => 'file_edit', 'duration_ms' => 300],
            ],
        ];

        $first = $this->actingAs($user)->postJson('/api/telemetry', $payload);
        $second = $this->actingAs($user)->postJson('/api/telemetry', $payload);

        $first->assertStatus(200)->assertJson(['duplicate' => false]);
        $second->assertStatus(200)->assertJson(['duplicate' => true]);

        $this->assertDatabaseCount('telemetry_events', 1);
    }

    public function test_session_events_filter_excludes_interval_segments(): void
    {
        $user = User::factory()->create();

        // Create legacy interval session event
        TelemetryEvent::create([
            'user_id' => 'test-user',
            'organization_id' => $this->org->id,
            'session_id' => 'session_interval',
            'source' => 'vscode',
            'event_type' => 'session',
            'count' => 1,
            'duration_ms' => 30000,
            'timestamp' => now(),
            'metadata' => [
                'segment_type' => 'interval',
                'source' => 'vscode',
                'extension_version' => '0.2.0',
            ],
            'payload' => [],
            'batch_hash' => 'test-interval-hash',
        ]);

        // Create new-style session event
        TelemetryEvent::create([
            'user_id' => 'test-user',
            'organization_id' => $this->org->id,
            'session_id' => 'session_123',
            'source' => 'vscode',
            'event_type' => 'session',
            'count' => 1,
            'duration_ms' => 120000, // 2 minutes
            'timestamp' => now(),
            'metadata' => [
                'segment_type' => 'session',
                'source' => 'vscode',
                'extension_version' => '0.3.0',
                'session_id' => 'session_123',
                'end_reason' => 'shutdown',
            ],
            'payload' => [],
            'batch_hash' => 'test-session-hash',
        ]);

        // Create legacy session event without segment_type (should be included)
        TelemetryEvent::create([
            'user_id' => 'test-user',
            'organization_id' => $this->org->id,
            'session_id' => 'session_legacy',
            'source' => 'vscode',
            'event_type' => 'session',
            'count' => 1,
            'duration_ms' => 90000, // 1.5 minutes
            'timestamp' => now(),
            'metadata' => [
                'source' => 'vscode',
                'extension_version' => '0.1.0',
            ],
            'payload' => [],
            'batch_hash' => 'test-legacy-hash',
        ]);

        // Query using sessionEvents scope - should exclude interval
        $sessionEvents = TelemetryEvent::sessionEvents()->get();

        $this->assertCount(2, $sessionEvents, 'Should include new session and legacy (NULL segment_type), but exclude interval');
        
        // Verify interval is excluded
        $intervalEvents = $sessionEvents->filter(function ($event) {
            return ($event->metadata['segment_type'] ?? null) === 'interval';
        });
        $this->assertCount(0, $intervalEvents, 'Interval sessions should be excluded');

        // Verify new session is included
        $newSessionEvents = $sessionEvents->filter(function ($event) {
            return ($event->metadata['segment_type'] ?? null) === 'session';
        });
        $this->assertCount(1, $newSessionEvents, 'New session events should be included');
        $this->assertEquals(120000, $newSessionEvents->first()->duration_ms);

        // Verify legacy (NULL segment_type) is included
        $legacyEvents = $sessionEvents->filter(function ($event) {
            return !isset($event->metadata['segment_type']);
        });
        $this->assertCount(1, $legacyEvents, 'Legacy sessions (NULL segment_type) should be included');
    }

    public function test_new_session_events_scope_only_includes_session_segment_type(): void
    {
        $user = User::factory()->create();

        // Create various session events
        TelemetryEvent::create([
            'user_id' => 'test-user',
            'organization_id' => $this->org->id,
            'session_id' => 'sess_interval_2',
            'source' => 'vscode',
            'event_type' => 'session',
            'count' => 1,
            'duration_ms' => 30000,
            'timestamp' => now(),
            'metadata' => ['segment_type' => 'interval'],
            'payload' => [],
            'batch_hash' => 'interval-hash',
        ]);

        TelemetryEvent::create([
            'user_id' => 'test-user',
            'organization_id' => $this->org->id,
            'session_id' => 'sess_new_2',
            'source' => 'vscode',
            'event_type' => 'session',
            'count' => 1,
            'duration_ms' => 120000,
            'timestamp' => now(),
            'metadata' => ['segment_type' => 'session'],
            'payload' => [],
            'batch_hash' => 'session-hash',
        ]);

        TelemetryEvent::create([
            'user_id' => 'test-user',
            'organization_id' => $this->org->id,
            'session_id' => 'sess_legacy_2',
            'source' => 'vscode',
            'event_type' => 'session',
            'count' => 1,
            'duration_ms' => 90000,
            'timestamp' => now(),
            'metadata' => [], // NULL segment_type
            'payload' => [],
            'batch_hash' => 'legacy-hash',
        ]);

        // Query using newSessionEvents scope - should only include segment_type = 'session'
        $newSessionEvents = TelemetryEvent::newSessionEvents()->get();

        $this->assertCount(1, $newSessionEvents, 'Should only include events with segment_type = session');
        $this->assertEquals('session', $newSessionEvents->first()->metadata['segment_type']);
        $this->assertEquals(120000, $newSessionEvents->first()->duration_ms);
    }

    public function test_sessions_default_returns_all(): void
    {
        TelemetryEvent::create(['user_id'=>'u1','organization_id'=>$this->org->id,'session_id'=>'sa1','source'=>'vscode','event_type'=>'session','count'=>1,'duration_ms'=>60000,'timestamp'=>now()->subDays(30),'metadata'=>['segment_type'=>'session'],'payload'=>[],'batch_hash'=>'ha']);
        TelemetryEvent::create(['user_id'=>'u2','organization_id'=>$this->org->id,'session_id'=>'sa2','source'=>'cursor','event_type'=>'session','count'=>1,'duration_ms'=>60000,'timestamp'=>now()->subDays(2),'metadata'=>['segment_type'=>'session'],'payload'=>[],'batch_hash'=>'hb']);
        $r=$this->withToken($this->dashboardToken())->getJson('/api/telemetry/sessions');
        $r->assertStatus(200)->assertJsonPath('pagination.total',2)->assertJsonPath('filters_applied.days','all');
    }

    public function test_sessions_days_7_filters_old(): void
    {
        TelemetryEvent::create(['user_id'=>'u1','organization_id'=>$this->org->id,'session_id'=>'sb1','source'=>'vscode','event_type'=>'session','count'=>1,'duration_ms'=>60000,'timestamp'=>now()->subDays(30),'metadata'=>['segment_type'=>'session'],'payload'=>[],'batch_hash'=>'hc']);
        TelemetryEvent::create(['user_id'=>'u2','organization_id'=>$this->org->id,'session_id'=>'sb2','source'=>'cursor','event_type'=>'session','count'=>1,'duration_ms'=>60000,'timestamp'=>now()->subDays(2),'metadata'=>['segment_type'=>'session'],'payload'=>[],'batch_hash'=>'hd']);
        $r=$this->withToken($this->dashboardToken())->getJson('/api/telemetry/sessions?days=7');
        $r->assertStatus(200)->assertJsonPath('pagination.total',1)->assertJsonPath('filters_applied.days','7');
    }
}


