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
 * P1 regression — canonical aggregated responses must preserve fractional
 * ai_suggestions_accepted (AVG of metadata.ai_burst_count). The serializer
 * previously cast the average to (int), truncating every sub-1.0 average to
 * 0 — which displayed Patra's real ~0.7/session activity as "0.0" on the AIOI
 * workflow card while PBT (decimal path) showed ~0.3.
 */
class CanonicalAiActivityPrecisionTest extends TestCase
{
    use RefreshDatabase;

    private string $dashboardToken;
    private Organization $org;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = Organization::create([
            'name' => 'ChaosMonkey',
            'slug' => 'chaosmonkey',
        ]);
        $user = User::factory()->create([
            'organization_id' => $this->org->id,
            'role' => 'admin',
        ]);
        $this->dashboardToken = ApiToken::generateDashboardToken($user->id, $this->org->id)['raw'];
    }

    private function createSessionEvent(array $metadata = [], ?string $userId = null): TelemetryEvent
    {
        return TelemetryEvent::create([
            'user_id' => $userId ?? 'test-user',
            'organization_id' => $this->org->id,
            'source' => 'claude-code',
            'editor_source' => 'claude-code',
            'event_type' => 'session',
            'duration_ms' => 60000,
            'timestamp' => now()->subDay(),
            'metadata' => array_merge(['segment_type' => 'session'], $metadata),
            'payload' => [],
            'batch_hash' => hash('sha256', Str::random(64)),
        ]);
    }

    private function canonicalAggregated(): array
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all');
        $response->assertStatus(200);
        return $response->json('data');
    }

    private function claudeCodeRows(array $data): array
    {
        return array_values(array_filter($data, fn ($row) => ($row['tool'] ?? null) === 'claude_code'));
    }

    public function test_fractional_average_below_one_is_preserved(): void
    {
        // avg = 2/3 = 0.67 — previously serialized as 0
        $this->createSessionEvent(['ai_burst_count' => 0]);
        $this->createSessionEvent(['ai_burst_count' => 1]);
        $this->createSessionEvent(['ai_burst_count' => 1]);

        $rows = $this->claudeCodeRows($this->canonicalAggregated());
        $this->assertNotEmpty($rows);
        $this->assertEquals(0.67, $rows[0]['ai_suggestions_accepted']);
    }

    public function test_fractional_average_above_one_is_not_floored(): void
    {
        // avg = 2.5 — previously serialized as 2
        $this->createSessionEvent(['ai_burst_count' => 2]);
        $this->createSessionEvent(['ai_burst_count' => 3]);

        $rows = $this->claudeCodeRows($this->canonicalAggregated());
        $this->assertNotEmpty($rows);
        $this->assertEquals(2.5, $rows[0]['ai_suggestions_accepted']);
    }

    public function test_genuine_zero_remains_zero(): void
    {
        $this->createSessionEvent(['ai_burst_count' => 0]);
        $this->createSessionEvent(['ai_burst_count' => 0]);

        $rows = $this->claudeCodeRows($this->canonicalAggregated());
        $this->assertNotEmpty($rows);
        $this->assertSame(0, $rows[0]['ai_suggestions_accepted']);
    }

    public function test_missing_burst_evidence_follows_existing_contract(): void
    {
        // No ai_burst_count in metadata — existing contract emits 0.
        $this->createSessionEvent([]);

        $rows = $this->claudeCodeRows($this->canonicalAggregated());
        $this->assertNotEmpty($rows);
        $this->assertSame(0, $rows[0]['ai_suggestions_accepted']);
    }

    public function test_developer_aggregation_preserves_precision(): void
    {
        $invite = Invite::create([
            'organization_id' => $this->org->id,
            'email' => 'dev@example.com',
            'expires_at' => Invite::enrollmentNeverExpires(),
        ]);
        $this->createSessionEvent(['ai_burst_count' => 1], "invite:{$invite->id}");
        $this->createSessionEvent(['ai_burst_count' => 2], "invite:{$invite->id}");
        $this->createSessionEvent(['ai_burst_count' => 0], "invite:{$invite->id}");

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2000-01-01&to=2099-12-31&format=developer&period=week');
        $response->assertStatus(200);
        $rows = $response->json('data');
        $this->assertNotEmpty($rows, 'developer format returned no rows — identity map did not resolve the invite');
        $this->assertEquals(1.0, $rows[0]['ai_suggestions_accepted']);
    }

    public function test_patra_shaped_data_no_longer_displays_zero(): void
    {
        // Patra week-41 shape: invite:3=148 sessions/115 bursts, invite:6=39/19,
        // invite:17=2/16 — scaled down 10x preserving fractional averages.
        $invite3 = Invite::create(['organization_id' => $this->org->id, 'email' => 'a@example.com', 'expires_at' => Invite::enrollmentNeverExpires()]);
        $invite6 = Invite::create(['organization_id' => $this->org->id, 'email' => 'b@example.com', 'expires_at' => Invite::enrollmentNeverExpires()]);

        // 15 sessions averaging 0.73 (11 bursts / 15 sessions)
        for ($i = 0; $i < 11; $i++) {
            $this->createSessionEvent(['ai_burst_count' => 1], "invite:{$invite3->id}");
        }
        for ($i = 0; $i < 4; $i++) {
            $this->createSessionEvent(['ai_burst_count' => 0], "invite:{$invite3->id}");
        }
        // 4 sessions averaging 0.5
        $this->createSessionEvent(['ai_burst_count' => 1], "invite:{$invite6->id}");
        $this->createSessionEvent(['ai_burst_count' => 1], "invite:{$invite6->id}");
        $this->createSessionEvent(['ai_burst_count' => 0], "invite:{$invite6->id}");
        $this->createSessionEvent(['ai_burst_count' => 0], "invite:{$invite6->id}");

        $rows = $this->claudeCodeRows($this->canonicalAggregated());
        $this->assertNotEmpty($rows);
        // 19 sessions, 13 bursts → avg 0.68 — old code emitted 0
        $this->assertEquals(0.68, $rows[0]['ai_suggestions_accepted']);
        $this->assertGreaterThan(0, $rows[0]['ai_suggestions_accepted']);
    }

    public function test_canonical_aggregated_and_session_rows_report_compatible_values(): void
    {
        $this->createSessionEvent(['ai_burst_count' => 0]);
        $this->createSessionEvent(['ai_burst_count' => 1]);
        $this->createSessionEvent(['ai_burst_count' => 1]);

        $canonical = $this->claudeCodeRows($this->canonicalAggregated());
        $this->assertEquals(0.67, $canonical[0]['ai_suggestions_accepted']);

        // PBT consumes canonical session rows (authoritativeSessions) and
        // averages ai_burst_count itself — verify the aggregated response
        // agrees with the session-level source of truth.
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2000-01-01&to=2099-12-31&format=sessions&per_page=200');
        $response->assertStatus(200);
        $sessions = $response->json('data');
        $this->assertCount(3, $sessions);
        $avg = array_sum(array_column($sessions, 'ai_burst_count')) / count($sessions);
        $this->assertEqualsWithDelta($canonical[0]['ai_suggestions_accepted'], $avg, 0.01);
    }
}
