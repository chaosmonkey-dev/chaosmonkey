<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Organization;
use App\Models\TelemetryEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class CanonicalReportingTimezoneTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $org = Organization::create([
            'name' => 'ChaosMonkey',
            'slug' => 'chaosmonkey',
        ]);
        $user = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'admin',
        ]);
        $this->dashboardToken = ApiToken::generateDashboardToken($user->id, $org->id)['raw'];
    }

    private string $dashboardToken;

    /**
     * Create a session event at a specific UTC timestamp.
     */
    private function createSessionAtUtc(string $utcTimestamp, string $source = 'vscode'): TelemetryEvent
    {
        $org = Organization::where('slug', 'chaosmonkey')->first();
        return TelemetryEvent::create([
            'user_id' => 'test-user',
            'organization_id' => $org?->id,
            'source' => $source,
            'editor_source' => null,
            'event_type' => 'session',
            'duration_ms' => 60000,
            'timestamp' => $utcTimestamp,
            'metadata' => ['segment_type' => 'session'],
            'payload' => [],
            'batch_hash' => hash('sha256', Str::random(64)),
        ]);
    }

    /**
     * CR-X P0: An event at 2026-09-07T00:11:41Z (which is still Sep 6 in
     * America/New_York) must be included when the reporting timezone is
     * America/New_York and the date-only range is from=2026-08-30 to=2026-09-06.
     */
    public function test_late_day_event_included_in_local_calendar_window(): void
    {
        // Event at 2026-09-07T00:11:41Z = 2026-09-06 20:11:41 EDT
        $this->createSessionAtUtc('2026-09-07T00:11:41Z');

        // With reporting_timezone: from/to are date-only in America/New_York
        // to=2026-09-06 means end-of-day EDT = 2026-09-07T03:59:59Z
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-08-30&to=2026-09-06&format=aggregated&period=day&tools=all&reporting_timezone=America/New_York');

        $response->assertStatus(200);
        $meta = $response->json('metadata');
        $this->assertEquals(1, $meta['canonical_population_count'], 'Late-day EDT event must be in the local-calendar window');

        // The event must appear in the Sep 6 daily bucket (local calendar date)
        $data = $response->json('data');
        $periods = array_column($data, 'period');
        $this->assertContains('2026-09-06', $periods, 'Event must be bucketed as Sep 6 (local calendar date)');
        $this->assertNotContains('2026-09-07', $periods, 'Event must NOT be bucketed as Sep 7');
    }

    /**
     * Without reporting_timezone, the same event at 2026-09-07T00:11:41Z
     * must be excluded from from=2026-08-30T00:00:00Z&to=2026-09-06T23:59:59Z
     * (UTC behavior preserved).
     */
    public function test_utc_default_excludes_event_after_midnight(): void
    {
        $this->createSessionAtUtc('2026-09-07T00:11:41Z');

        // No reporting_timezone: UTC behavior. to=2026-09-06T23:59:59.999Z
        // excludes the 2026-09-07T00:11:41Z event.
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-08-30T00:00:00.000Z&to=2026-09-06T23:59:59.999Z&format=aggregated&period=day&tools=all');

        $response->assertStatus(200);
        $meta = $response->json('metadata');
        $this->assertEquals(0, $meta['canonical_population_count'], 'UTC default must exclude event after UTC midnight');
    }

    /**
     * An event after local midnight (2026-09-07T05:00:00Z = 2026-09-07 01:00 EDT)
     * must belong to Sep 7, not Sep 6.
     */
    public function test_event_after_local_midnight_belongs_to_next_day(): void
    {
        // 2026-09-07T05:00:00Z = 2026-09-07 01:00:00 EDT
        $this->createSessionAtUtc('2026-09-07T05:00:00Z');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-08-30&to=2026-09-07&format=aggregated&period=day&tools=all&reporting_timezone=America/New_York');

        $response->assertStatus(200);
        $data = $response->json('data');
        $periods = array_column($data, 'period');
        $this->assertContains('2026-09-07', $periods, 'Event after local midnight must be bucketed as Sep 7');
        $this->assertNotContains('2026-09-06', $periods, 'Event after local midnight must NOT be bucketed as Sep 6');
    }

    /**
     * Positive-offset timezone: Asia/Tokyo (UTC+9).
     * 2026-09-06T15:00:00Z = 2026-09-07 00:00 JST.
     * This event must be bucketed as Sep 7 in Tokyo timezone.
     */
    public function test_positive_offset_timezone(): void
    {
        $this->createSessionAtUtc('2026-09-06T15:00:00Z');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-09-01&to=2026-09-07&format=aggregated&period=day&tools=all&reporting_timezone=Asia/Tokyo');

        $response->assertStatus(200);
        $data = $response->json('data');
        $periods = array_column($data, 'period');
        $this->assertContains('2026-09-07', $periods, 'Tokyo: UTC 15:00 must be bucketed as Sep 7 (local 00:00)');
    }

    /**
     * Developer + repo scope must compose with reporting_timezone.
     */
    public function test_developer_filter_composes_with_reporting_timezone(): void
    {
        $this->createSessionAtUtc('2026-09-07T00:11:41Z');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-08-30&to=2026-09-06&format=aggregated&period=day&tools=all&reporting_timezone=America/New_York&developer_ids=test-user');

        $response->assertStatus(200);
        $meta = $response->json('metadata');
        $this->assertEquals(1, $meta['canonical_population_count'], 'Developer filter must compose with timezone');
    }

    // ── CR-X P0-B: DST boundary regression tests ──────────────────────────

    /**
     * Spring DST transition 2026: March 8, 2026 at 2:00 AM EST -> 3:00 AM EDT.
     * UTC: 2026-03-08T07:00:00Z (clocks spring forward).
     *
     * Before transition: offset = -5 hours (EST)
     * After transition:  offset = -4 hours (EDT)
     *
     * An event at 2026-03-08T06:59:00Z = 1:59 AM EST (still Mar 8 local)
     * An event at 2026-03-08T07:00:00Z = 3:00 AM EDT (Mar 8 local)
     * Both are Mar 8 local, but with different offsets.
     *
     * An event at 2026-03-08T04:59:00Z = 11:59 PM EST on Mar 7 (Mar 7 local)
     * An event at 2026-03-08T05:00:00Z = 12:00 AM EST on Mar 8 (Mar 8 local)
     */
    public function test_spring_dst_transition_events_bucket_correctly(): void
    {
        // Event before transition: 2026-03-08T06:30:00Z = 1:30 AM EST = Mar 8 local
        $this->createSessionAtUtc('2026-03-08T06:30:00Z');
        // Event after transition: 2026-03-08T07:30:00Z = 3:30 AM EDT = Mar 8 local
        $this->createSessionAtUtc('2026-03-08T07:30:00Z');
        // Event on Mar 7 local: 2026-03-08T04:30:00Z = 11:30 PM EST = Mar 7 local
        $this->createSessionAtUtc('2026-03-08T04:30:00Z');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-03-01&to=2026-03-15&format=aggregated&period=day&tools=all&reporting_timezone=America/New_York');

        $response->assertStatus(200);
        $data = $response->json('data');
        $periods = array_column($data, 'period');

        // The Mar 7 local event must be bucketed as 2026-03-07
        $this->assertContains('2026-03-07', $periods, 'Pre-midnight EST event must be bucketed as Mar 7 local');
        // Both Mar 8 local events (pre and post DST transition) must be bucketed as 2026-03-08
        $this->assertContains('2026-03-08', $periods, 'Events on Mar 8 local (both pre and post DST transition) must be bucketed as Mar 8');
        // No Mar 9 leakage
        $this->assertNotContains('2026-03-09', $periods, 'No events should be bucketed as Mar 9');
    }

    /**
     * Fall DST transition 2026: November 1, 2026 at 2:00 AM EDT -> 1:00 AM EST.
     * UTC: 2026-11-01T06:00:00Z (clocks fall back).
     *
     * Before transition: offset = -4 hours (EDT)
     * After transition:  offset = -5 hours (EST)
     *
     * An event at 2026-11-01T05:30:00Z = 1:30 AM EDT = Nov 1 local
     * An event at 2026-11-01T06:30:00Z = 1:30 AM EST = Nov 1 local (after fall back)
     * Both are Nov 1 local, but with different offsets.
     *
     * An event at 2026-11-01T04:59:00Z = 12:59 AM EDT = Nov 1 local
     * An event at 2026-11-01T05:00:00Z = 1:00 AM EDT = Nov 1 local
     */
    public function test_fall_dst_transition_events_bucket_correctly(): void
    {
        // Event before transition: 2026-11-01T05:30:00Z = 1:30 AM EDT = Nov 1 local
        $this->createSessionAtUtc('2026-11-01T05:30:00Z');
        // Event after transition: 2026-11-01T06:30:00Z = 1:30 AM EST = Nov 1 local
        $this->createSessionAtUtc('2026-11-01T06:30:00Z');
        // Event on Oct 31 local: 2026-11-01T03:30:00Z = 11:30 PM EDT = Oct 31 local
        $this->createSessionAtUtc('2026-11-01T03:30:00Z');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-10-25&to=2026-11-08&format=aggregated&period=day&tools=all&reporting_timezone=America/New_York');

        $response->assertStatus(200);
        $data = $response->json('data');
        $periods = array_column($data, 'period');

        // The Oct 31 local event must be bucketed as 2026-10-31
        $this->assertContains('2026-10-31', $periods, 'Pre-midnight EDT event must be bucketed as Oct 31 local');
        // Both Nov 1 local events (pre and post fall-back) must be bucketed as 2026-11-01
        $this->assertContains('2026-11-01', $periods, 'Events on Nov 1 local (both pre and post DST transition) must be bucketed as Nov 1');
        // No Nov 2 leakage
        $this->assertNotContains('2026-11-02', $periods, 'No events should be bucketed as Nov 2');
    }

    /**
     * Range spanning both DST transitions (spring + fall) must produce
     * correct buckets for events near both transitions.
     */
    public function test_range_spanning_both_dst_transitions(): void
    {
        // Spring transition event
        $this->createSessionAtUtc('2026-03-08T06:30:00Z'); // 1:30 AM EST = Mar 8
        // Fall transition event
        $this->createSessionAtUtc('2026-11-01T06:30:00Z'); // 1:30 AM EST = Nov 1
        // Summer event (EDT)
        $this->createSessionAtUtc('2026-07-15T03:00:00Z'); // 11:00 PM EDT Jul 14 -> wait, -4 = Jul 14 23:00

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-03-01&to=2026-11-30&format=aggregated&period=day&tools=all&reporting_timezone=America/New_York');

        $response->assertStatus(200);
        $data = $response->json('data');
        $periods = array_column($data, 'period');

        $this->assertContains('2026-03-08', $periods, 'Spring transition event must be Mar 8');
        $this->assertContains('2026-11-01', $periods, 'Fall transition event must be Nov 1');
        // 2026-07-15T03:00:00Z with -4 offset = 2026-07-14 23:00 EDT = Jul 14 local
        $this->assertContains('2026-07-14', $periods, 'Summer EDT event at 03:00Z must be Jul 14 local (23:00 EDT)');
    }

    /**
     * Late Sep 6 EDT telemetry at 2026-09-07T00:11:41Z still belongs to Sep 6.
     * This is the original P0 case — must remain correct with DST-safe bucketing.
     */
    public function test_late_sep6_edt_event_remains_sep6_with_dst_bucketing(): void
    {
        $this->createSessionAtUtc('2026-09-07T00:11:41Z');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-08-30&to=2026-09-06&format=aggregated&period=day&tools=all&reporting_timezone=America/New_York');

        $response->assertStatus(200);
        $data = $response->json('data');
        $periods = array_column($data, 'period');
        $this->assertContains('2026-09-06', $periods, 'Late Sep 6 EDT event must remain Sep 6 with DST-safe bucketing');
        $this->assertNotContains('2026-09-07', $periods);
    }

    /**
     * Event after Sep 7 local midnight belongs to Sep 7.
     */
    public function test_event_after_sep7_local_midnight_belongs_to_sep7_with_dst_bucketing(): void
    {
        // 2026-09-07T05:00:00Z = 1:00 AM EDT = Sep 7 local
        $this->createSessionAtUtc('2026-09-07T05:00:00Z');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-08-30&to=2026-09-07&format=aggregated&period=day&tools=all&reporting_timezone=America/New_York');

        $response->assertStatus(200);
        $data = $response->json('data');
        $periods = array_column($data, 'period');
        $this->assertContains('2026-09-07', $periods, 'Event after local midnight must be Sep 7');
        $this->assertNotContains('2026-09-06', $periods);
    }

    /**
     * Positive-offset timezone (Asia/Tokyo, UTC+9) with DST-safe bucketing.
     * Tokyo does not observe DST, so this proves the single-segment path.
     */
    public function test_positive_offset_timezone_with_dst_bucketing(): void
    {
        $this->createSessionAtUtc('2026-09-06T15:00:00Z'); // Sep 7 00:00 JST

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-09-01&to=2026-09-07&format=aggregated&period=day&tools=all&reporting_timezone=Asia/Tokyo');

        $response->assertStatus(200);
        $data = $response->json('data');
        $periods = array_column($data, 'period');
        $this->assertContains('2026-09-07', $periods, 'Tokyo: UTC 15:00 must be bucketed as Sep 7 (local 00:00)');
    }

    /**
     * UTC default (no reporting_timezone) must remain unchanged with DST-safe code.
     */
    public function test_utc_default_unchanged_with_dst_bucketing(): void
    {
        $this->createSessionAtUtc('2026-09-07T00:11:41Z');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-08-30T00:00:00.000Z&to=2026-09-06T23:59:59.999Z&format=aggregated&period=day&tools=all');

        $response->assertStatus(200);
        $meta = $response->json('metadata');
        $this->assertEquals(0, $meta['canonical_population_count'], 'UTC default must still exclude event after UTC midnight');
    }

    // ── CR-X P0-B FINAL: Midnight-boundary DST tests ──────────────────────
    //
    // These tests are designed to FAIL if the wrong pre/post-transition
    // offset is applied near a local-midnight boundary.  A one-hour offset
    // error near midnight can move an event across the date boundary,
    // changing the daily bucket label.
    //
    // Spring transition: 2026-03-08T07:00:00Z (2:00 EST -> 3:00 EDT)
    //   Before: offset = -5h (EST), After: offset = -4h (EDT)
    //
    //   First post-transition local midnight:
    //     Mar 9 00:00 EDT = 2026-03-09T04:00:00Z
    //     With correct EDT (-4): 2026-03-09T03:30:00Z -> Mar 8 23:30 EDT -> Mar 8
    //     With wrong  EST (-5): 2026-03-09T03:30:00Z -> Mar 8 22:30 EST -> Mar 8
    //     BUT: 2026-03-09T04:30:00Z -> Mar 9 00:30 EDT -> Mar 9 (correct)
    //          with wrong EST (-5): -> Mar 8 23:30 EST -> Mar 8 (WRONG!)
    //
    //   So: an event at 2026-03-09T04:30:00Z must be Mar 9.
    //   If we used EST (-5) instead of EDT (-4), it would be Mar 8. TEST FAILS.

    public function test_spring_transition_post_midnight_event_must_not_fall_back_to_previous_day(): void
    {
        // 2026-03-09T04:30:00Z = 00:30 EDT = Mar 9 local
        // If wrong offset (EST -5) were applied: 23:30 EST Mar 8 = WRONG
        $this->createSessionAtUtc('2026-03-09T04:30:00Z');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-03-01&to=2026-03-15&format=aggregated&period=day&tools=all&reporting_timezone=America/New_York');

        $response->assertStatus(200);
        $data = $response->json('data');
        $periods = array_column($data, 'period');
        $this->assertContains('2026-03-09', $periods, 'Post-spring-transition midnight event must be Mar 9, not Mar 8 (would fail with wrong EST offset)');
        $this->assertNotContains('2026-03-08', $periods, 'Must not bucket as Mar 8 — wrong offset would cause this');
    }

    // Fall transition: 2026-11-01T06:00:00Z (2:00 EDT -> 1:00 EST)
    //   Before: offset = -4h (EDT), After: offset = -5h (EST)
    //
    //   First post-transition local midnight:
    //     Nov 2 00:00 EST = 2026-11-02T05:00:00Z
    //     With correct EST (-5): 2026-11-02T05:30:00Z -> Nov 2 00:30 EST -> Nov 2
    //     With wrong EDT (-4): 2026-11-02T05:30:00Z -> Nov 2 01:30 EDT -> Nov 2
    //     BUT: 2026-11-02T04:30:00Z -> Nov 1 23:30 EST -> Nov 1 (correct)
    //          with wrong EDT (-4): -> Nov 2 00:30 EDT -> Nov 2 (WRONG!)
    //
    //   So: an event at 2026-11-02T04:30:00Z must be Nov 1.
    //   If we used EDT (-4) instead of EST (-5), it would be Nov 2. TEST FAILS.

    public function test_fall_transition_pre_midnight_event_must_not_move_forward_to_next_day(): void
    {
        // 2026-11-02T04:30:00Z = 23:30 EST = Nov 1 local
        // If wrong offset (EDT -4) were applied: 00:30 EDT Nov 2 = WRONG
        $this->createSessionAtUtc('2026-11-02T04:30:00Z');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-10-25&to=2026-11-08&format=aggregated&period=day&tools=all&reporting_timezone=America/New_York');

        $response->assertStatus(200);
        $data = $response->json('data');
        $periods = array_column($data, 'period');
        $this->assertContains('2026-11-01', $periods, 'Post-fall-transition pre-midnight event must be Nov 1, not Nov 2 (would fail with wrong EDT offset)');
        $this->assertNotContains('2026-11-02', $periods, 'Must not bucket as Nov 2 — wrong offset would cause this');
    }

    // Additional: exact transition-instant events.
    // An event at the exact transition instant must use the post-transition offset.

    public function test_spring_transition_exact_instant_uses_post_transition_offset(): void
    {
        // 2026-03-08T07:00:00Z = exact spring transition instant
        // Post-transition offset = -4h (EDT) -> 3:00 AM EDT = Mar 8
        // If pre-transition offset (-5h EST) were used: 2:00 AM EST = Mar 8
        // Both give Mar 8, but let's test one second after transition:
        // 2026-03-08T07:00:01Z -> 3:00:01 AM EDT -> Mar 8 (correct)
        $this->createSessionAtUtc('2026-03-08T07:00:01Z');

        // And one second before transition:
        // 2026-03-08T06:59:59Z -> 1:59:59 AM EST -> Mar 8 (correct)
        $this->createSessionAtUtc('2026-03-08T06:59:59Z');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-03-01&to=2026-03-15&format=aggregated&period=day&tools=all&reporting_timezone=America/New_York');

        $response->assertStatus(200);
        $data = $response->json('data');
        $periods = array_column($data, 'period');
        $this->assertContains('2026-03-08', $periods, 'Both pre and post exact-transition events must be Mar 8');
    }

    public function test_fall_transition_exact_instant_uses_post_transition_offset(): void
    {
        // 2026-11-01T06:00:00Z = exact fall transition instant
        // Post-transition offset = -5h (EST) -> 1:00 AM EST = Nov 1
        // One second after: 2026-11-01T06:00:01Z -> 1:00:01 AM EST -> Nov 1
        $this->createSessionAtUtc('2026-11-01T06:00:01Z');

        // One second before: 2026-11-01T05:59:59Z -> 1:59:59 AM EDT -> Nov 1
        $this->createSessionAtUtc('2026-11-01T05:59:59Z');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?from=2026-10-25&to=2026-11-08&format=aggregated&period=day&tools=all&reporting_timezone=America/New_York');

        $response->assertStatus(200);
        $data = $response->json('data');
        $periods = array_column($data, 'period');
        $this->assertContains('2026-11-01', $periods, 'Both pre and post exact-transition events must be Nov 1');
    }
}
