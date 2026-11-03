<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Cohort;
use App\Models\CohortMember;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\TelemetryEvent;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * K1B — cohort_id scope on /api/telemetry/canonical.
 *
 * Locked semantics:
 *  - absent / 'all'  → eligible org population (unchanged)
 *  - <int>           → sessions whose user_id is 'invite:N' for current
 *                      members (current-membership, query-time); Local Lab
 *                      may additionally expand explicit local aliases read-only
 *  - empty cohort    → truthful zero, never org-wide
 *  - 'unassigned'    → invite-backed org developers with no membership
 *  - invalid/cross-org/archived → 422 INVALID_COHORT (fail closed)
 *  - cohort_id ∩ developer_ids → AND; empty intersection → zero
 */
class CanonicalCohortFilterTest extends TestCase
{
    private string $dashboardToken;
    private int $organizationId;
    private int $otherOrganizationId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->assertTrue(app()->environment('testing'), 'Refusing to run: APP_ENV is not testing');
        $this->assertEquals('sqlite', config('database.default'), 'Refusing to run: database driver is not sqlite');
        $this->assertEquals(':memory:', config('database.connections.sqlite.database'), 'Refusing to run: SQLite database is not :memory:');

        $this->createTables();

        $org = Organization::create(['name' => 'Cohort Org', 'slug' => 'cohort-org-' . Str::random(6)]);
        $this->organizationId = $org->id;

        $other = Organization::create(['name' => 'Other Org', 'slug' => 'other-' . Str::random(6)]);
        $this->otherOrganizationId = $other->id;

        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-' . Str::random(8) . '@test.com',
            'password' => bcrypt('password'),
            'role' => 'admin',
            'organization_id' => $org->id,
        ]);
        $this->dashboardToken = ApiToken::generateDashboardToken($admin->id, $org->id)['raw'];
    }

    protected function tearDown(): void
    {
        if (app()->environment('testing')
            && config('database.default') === 'sqlite'
            && config('database.connections.sqlite.database') === ':memory:'
        ) {
            Schema::dropIfExists('cohort_members');
            Schema::dropIfExists('cohorts');
            Schema::dropIfExists('telemetry_events');
            Schema::dropIfExists('ide_connect_codes');
            Schema::dropIfExists('api_tokens');
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
                $table->timestamp('expires_at')->nullable();
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
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('ide_connect_codes')) {
            Schema::create('ide_connect_codes', function ($table) {
                $table->id();
                $table->string('code', 32)->unique();
                $table->foreignId('user_id')->nullable();
                $table->foreignId('organization_id')->nullable();
                $table->foreignId('invite_id')->nullable();
                $table->string('installation_id', 64)->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->timestamp('used_at')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('cohorts')) {
            Schema::create('cohorts', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('name')->collation('NOCASE');
                $table->string('description')->nullable();
                $table->foreignId('created_by')->nullable();
                $table->timestamp('archived_at')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('cohort_members')) {
            Schema::create('cohort_members', function ($table) {
                $table->id();
                $table->foreignId('cohort_id')->constrained('cohorts')->cascadeOnDelete();
                $table->foreignId('invite_id')->unique();
                $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
                $table->foreignId('assigned_by')->nullable();
                $table->timestamps();
            });
        }
    }

    private function createSessionEvent(string $userId, string $source, int $organizationId, array $metadata = []): TelemetryEvent
    {
        return TelemetryEvent::create([
            'user_id' => $userId,
            'organization_id' => $organizationId,
            'source' => $source,
            'editor_source' => $source,
            'event_type' => 'session',
            'session_id' => 'session-' . Str::random(8),
            'duration_ms' => 60000,
            'timestamp' => now()->subDay(),
            'metadata' => array_merge(['segment_type' => 'session'], $metadata),
            'payload' => [],
            'batch_hash' => Str::random(40),
        ]);
    }

    private function createInvite(string $email, ?int $orgId = null): Invite
    {
        return Invite::create([
            'organization_id' => $orgId ?? $this->organizationId,
            'email' => $email,
            'expires_at' => now()->addDay(),
        ]);
    }

    private function createCohort(string $name, ?int $orgId = null): Cohort
    {
        return Cohort::create([
            'organization_id' => $orgId ?? $this->organizationId,
            'name' => $name,
        ]);
    }

    private function addMember(Cohort $cohort, Invite $invite): CohortMember
    {
        return CohortMember::create([
            'cohort_id' => $cohort->id,
            'invite_id' => $invite->id,
            'organization_id' => $cohort->organization_id,
        ]);
    }

    private function callCanonical(string $extra = '', string $format = 'aggregated')
    {
        $qs = "from=2000-01-01&to=2099-12-31&format={$format}&period=week&tools=all" . $extra;

        return $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?' . $qs);
    }

    // ---------------------------------------------------------------

    public function test_no_cohort_param_returns_full_population(): void
    {
        $cohort = $this->createCohort('Scoped');
        $in = $this->createInvite('in@example.com');
        $this->addMember($cohort, $in);
        $out = $this->createInvite('out@example.com');

        $this->createSessionEvent("invite:{$in->id}", 'cursor', $this->organizationId);
        $this->createSessionEvent("invite:{$out->id}", 'vscode', $this->organizationId);

        $response = $this->callCanonical();
        $response->assertStatus(200);
        $this->assertEquals(2, $response->json('metadata.canonical_population_count'));
        $this->assertNull($response->json('metadata.filters_applied.cohort_id'));
        $this->assertNull($response->json('metadata.filters_applied.cohort'));
    }

    public function test_cohort_all_matches_no_param(): void
    {
        $this->createSessionEvent('invite:1', 'cursor', $this->organizationId);

        $baseline = $this->callCanonical();
        $all = $this->callCanonical('&cohort_id=all');

        $all->assertStatus(200);
        $this->assertEquals(
            $baseline->json('metadata.canonical_population_count'),
            $all->json('metadata.canonical_population_count')
        );
        $this->assertEquals(
            $baseline->json('metadata.query_hash'),
            $all->json('metadata.query_hash'),
            'cohort_id=all must not change the canonical population or hash inputs'
        );
    }

    public function test_specific_cohort_scopes_to_current_members(): void
    {
        $cohort = $this->createCohort('Platform');
        $a = $this->createInvite('a@example.com');
        $b = $this->createInvite('b@example.com');
        $outside = $this->createInvite('outside@example.com');
        $this->addMember($cohort, $a);
        $this->addMember($cohort, $b);

        $this->createSessionEvent("invite:{$a->id}", 'cursor', $this->organizationId);
        $this->createSessionEvent("invite:{$a->id}", 'devin', $this->organizationId);
        $this->createSessionEvent("invite:{$b->id}", 'vscode', $this->organizationId);
        $this->createSessionEvent("invite:{$outside->id}", 'vscode', $this->organizationId);
        $this->createSessionEvent('legacy-user', 'vscode', $this->organizationId);

        $response = $this->callCanonical("&cohort_id={$cohort->id}");
        $response->assertStatus(200);

        $this->assertEquals(3, $response->json('metadata.canonical_population_count'));

        $proof = $response->json('metadata.filters_applied.cohort');
        $this->assertEquals($cohort->id, $proof['id']);
        $this->assertEquals('Platform', $proof['name']);
        $this->assertEquals(2, $proof['member_count']);
        $this->assertEquals(2, $proof['resolved_developer_count']);
        $this->assertEquals('current', $proof['membership_semantics']);
    }

    public function test_local_demo_persona_invite_scopes_proven_simulated_identity(): void
    {
        config()->set('local_developer.local_demo_persona_invites', [
            'jordan.vega@chaosmonkey.local' => '90001',
        ]);

        $cohort = $this->createCohort('Platform');
        $personaInvite = $this->createInvite('jordan.vega@chaosmonkey.local');
        $outside = $this->createInvite('outside@example.com');
        $this->addMember($cohort, $personaInvite);

        $this->createSessionEvent('90001', 'cursor', $this->organizationId, ['simulated' => true]);
        $this->createSessionEvent('90002', 'vscode', $this->organizationId, ['simulated' => true]);
        $this->createSessionEvent("invite:{$outside->id}", 'vscode', $this->organizationId);

        $response = $this->callCanonical("&cohort_id={$cohort->id}");
        $response->assertStatus(200);

        $this->assertEquals(1, $response->json('metadata.canonical_population_count'));
        $proof = $response->json('metadata.filters_applied.cohort');
        $this->assertEquals(1, $proof['member_count']);
        $this->assertEquals(1, $proof['resolved_developer_count']);
        $this->assertEquals('invite_backed_with_local_aliases', $proof['identity_resolution']);
    }

    public function test_local_matt_invite_scopes_verified_local_developer_aliases(): void
    {
        $cohort = $this->createCohort('Platform');
        $mattInvite = $this->createInvite('matt@chaosmonkey.com');
        $this->addMember($cohort, $mattInvite);

        $this->createSessionEvent('4', 'vscode', $this->organizationId);
        $this->createSessionEvent('18269556', 'windsurf', $this->organizationId);
        $this->createSessionEvent("invite:{$mattInvite->id}", 'devin', $this->organizationId);
        $this->createSessionEvent('90001', 'cursor', $this->organizationId, ['simulated' => true]);

        $response = $this->callCanonical("&cohort_id={$cohort->id}");
        $response->assertStatus(200);

        $this->assertEquals(3, $response->json('metadata.canonical_population_count'));
        $this->assertEquals(1, $response->json('metadata.filters_applied.cohort.resolved_developer_count'));
    }

    public function test_current_membership_semantics_move_history_with_member(): void
    {
        // Alice's historical sessions follow her CURRENT membership.
        $cohortA = $this->createCohort('A');
        $cohortB = $this->createCohort('B');
        $alice = $this->createInvite('alice@example.com');
        $this->addMember($cohortA, $alice);

        $this->createSessionEvent("invite:{$alice->id}", 'cursor', $this->organizationId);

        $this->assertEquals(1, $this->callCanonical("&cohort_id={$cohortA->id}")->json('metadata.canonical_population_count'));
        $this->assertEquals(0, $this->callCanonical("&cohort_id={$cohortB->id}")->json('metadata.canonical_population_count'));

        // Move Alice A→B: her history moves with her (V1 contract)
        CohortMember::where('invite_id', $alice->id)->update(['cohort_id' => $cohortB->id]);

        $this->assertEquals(0, $this->callCanonical("&cohort_id={$cohortA->id}")->json('metadata.canonical_population_count'));
        $this->assertEquals(1, $this->callCanonical("&cohort_id={$cohortB->id}")->json('metadata.canonical_population_count'));
    }

    public function test_empty_cohort_returns_truthful_zero_not_org_wide(): void
    {
        $empty = $this->createCohort('Empty');
        $other = $this->createInvite('populated@example.com');
        $this->createSessionEvent("invite:{$other->id}", 'cursor', $this->organizationId);

        $response = $this->callCanonical("&cohort_id={$empty->id}");
        $response->assertStatus(200);

        $this->assertEquals(0, $response->json('metadata.canonical_population_count'));
        $this->assertEquals([], $response->json('data'));
        $this->assertEquals(0, $response->json('metadata.filters_applied.cohort.member_count'));
    }

    public function test_unassigned_scopes_to_invite_backed_non_members(): void
    {
        $cohort = $this->createCohort('Assigned');
        $member = $this->createInvite('member@example.com');
        $free = $this->createInvite('free@example.com');
        $this->addMember($cohort, $member);

        $this->createSessionEvent("invite:{$member->id}", 'cursor', $this->organizationId);
        $this->createSessionEvent("invite:{$free->id}", 'vscode', $this->organizationId);
        $this->createSessionEvent("invite:{$free->id}", 'devin', $this->organizationId);
        // Non-invite identities are NOT part of the unassigned cohort scope
        $this->createSessionEvent('legacy-user', 'vscode', $this->organizationId);

        $response = $this->callCanonical('&cohort_id=unassigned');
        $response->assertStatus(200);

        $this->assertEquals(2, $response->json('metadata.canonical_population_count'));

        $proof = $response->json('metadata.filters_applied.cohort');
        $this->assertEquals('unassigned', $proof['mode']);
        $this->assertEquals('current', $proof['membership_semantics']);
        $this->assertGreaterThanOrEqual(1, $proof['resolved_developer_count']);
    }

    public function test_invalid_cohort_fails_closed_422(): void
    {
        $response = $this->callCanonical('&cohort_id=999999');
        $response->assertStatus(422);
        $this->assertEquals('INVALID_COHORT', $response->json('error_code'));
    }

    public function test_non_numeric_cohort_fails_closed_422(): void
    {
        $response = $this->callCanonical('&cohort_id=garbage');
        $response->assertStatus(422);
        $this->assertEquals('INVALID_COHORT', $response->json('error_code'));
    }

    public function test_archived_cohort_fails_closed_422(): void
    {
        $cohort = $this->createCohort('Archived');
        $cohort->update(['archived_at' => now()]);

        $response = $this->callCanonical("&cohort_id={$cohort->id}");
        $response->assertStatus(422);
        $this->assertEquals('INVALID_COHORT', $response->json('error_code'));
    }

    public function test_cross_org_cohort_fails_closed_422(): void
    {
        $foreign = $this->createCohort('Foreign', $this->otherOrganizationId);

        $response = $this->callCanonical("&cohort_id={$foreign->id}");
        $response->assertStatus(422);
        $this->assertEquals('INVALID_COHORT', $response->json('error_code'));
    }

    public function test_cohort_and_developer_ids_intersect(): void
    {
        $cohort = $this->createCohort('Intersection');
        $in = $this->createInvite('in@example.com');
        $other = $this->createInvite('other@example.com');
        $this->addMember($cohort, $in);

        $this->createSessionEvent("invite:{$in->id}", 'cursor', $this->organizationId);
        $this->createSessionEvent("invite:{$in->id}", 'devin', $this->organizationId);
        $this->createSessionEvent("invite:{$other->id}", 'vscode', $this->organizationId);

        // cohort ∩ {in} = 2 sessions
        $response = $this->callCanonical("&cohort_id={$cohort->id}&developer_ids=invite:{$in->id}");
        $response->assertStatus(200);
        $this->assertEquals(2, $response->json('metadata.canonical_population_count'));
        $this->assertEquals("invite:{$in->id}", $response->json('metadata.filters_applied.developer_ids'));
    }

    public function test_empty_intersection_never_falls_back_to_org_wide(): void
    {
        $cohort = $this->createCohort('C');
        $member = $this->createInvite('member@example.com');
        $outside = $this->createInvite('outside@example.com');
        $this->addMember($cohort, $member);

        $this->createSessionEvent("invite:{$member->id}", 'cursor', $this->organizationId);
        $this->createSessionEvent("invite:{$outside->id}", 'vscode', $this->organizationId);

        // cohort C ∩ {outside} = ∅ → truthful zero, NOT the 2 org rows
        $response = $this->callCanonical("&cohort_id={$cohort->id}&developer_ids=invite:{$outside->id}");
        $response->assertStatus(200);
        $this->assertEquals(0, $response->json('metadata.canonical_population_count'));
    }

    public function test_cohort_scope_applies_to_sessions_format(): void
    {
        $cohort = $this->createCohort('Sessions');
        $in = $this->createInvite('s-in@example.com');
        $out = $this->createInvite('s-out@example.com');
        $this->addMember($cohort, $in);

        $this->createSessionEvent("invite:{$in->id}", 'cursor', $this->organizationId);
        $this->createSessionEvent("invite:{$out->id}", 'vscode', $this->organizationId);

        $response = $this->callCanonical("&cohort_id={$cohort->id}", 'sessions');
        $response->assertStatus(200);
        $this->assertCount(1, $response->json('data'));
        $this->assertEquals(1, $response->json('metadata.canonical_population_count'));
    }

    public function test_codex_alias_cohort_developer_day_aggregation_is_supported(): void
    {
        // Regression for the exact PBT query shape reported as a 500:
        // format=aggregated&period=day&group_by=developer&tools=<codex aliases>
        // &reporting_timezone=<IANA>&cohort_id=<id>. The endpoint must support it.
        $cohort = $this->createCohort('Platform Engineering');
        $member = $this->createInvite('pe@example.com');
        $this->addMember($cohort, $member);

        $this->createSessionEvent("invite:{$member->id}", 'codex', $this->organizationId);
        $this->createSessionEvent("invite:{$member->id}", 'codex-cli', $this->organizationId);
        $this->createSessionEvent("invite:{$member->id}", 'cursor', $this->organizationId);

        $qs = "from=2020-01-01&to=2026-10-01T23:59:59.999Z&format=aggregated&period=day"
            . "&group_by=developer&reporting_timezone=America/New_York"
            . "&tools=codex,codex-cli,codex_cli,openai-codex&cohort_id={$cohort->id}";

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?' . $qs);

        $response->assertStatus(200);
        // 2 Codex-aliased sessions for the cohort member; the cursor session
        // is excluded by the tools filter, and cohort isolation keeps it scoped.
        $this->assertEquals(2, $response->json('metadata.canonical_population_count'));
    }

    public function test_query_hash_distinguishes_cohort_scopes(): void
    {
        $cohortA = $this->createCohort('HA');
        $cohortB = $this->createCohort('HB');

        $none = $this->callCanonical()->json('metadata.query_hash');
        $a = $this->callCanonical("&cohort_id={$cohortA->id}")->json('metadata.query_hash');
        $b = $this->callCanonical("&cohort_id={$cohortB->id}")->json('metadata.query_hash');
        $unassigned = $this->callCanonical('&cohort_id=unassigned')->json('metadata.query_hash');

        $this->assertNotEquals($none, $a);
        $this->assertNotEquals($a, $b);
        $this->assertNotEquals($a, $unassigned);
    }

    public function test_cohort_queries_do_not_mutate_telemetry(): void
    {
        $cohort = $this->createCohort('Immutable');
        $in = $this->createInvite('im@example.com');
        $this->addMember($cohort, $in);
        $event = $this->createSessionEvent("invite:{$in->id}", 'cursor', $this->organizationId);

        $before = TelemetryEvent::find($event->id)->getAttributes();

        $this->callCanonical("&cohort_id={$cohort->id}");
        $this->callCanonical('&cohort_id=unassigned');
        $this->callCanonical('&cohort_id=999999');

        $after = TelemetryEvent::find($event->id)->getAttributes();
        $this->assertEquals($before, $after);
        $this->assertArrayNotHasKey('cohort_id', $after);
    }

    public function test_roster_pending_invites_carry_cohort_fields(): void
    {
        $cohort = $this->createCohort('Rostered');
        $assigned = $this->createInvite('assigned@example.com');
        $free = $this->createInvite('free-roster@example.com');
        $this->addMember($cohort, $assigned);

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/org/users');
        $response->assertStatus(200);

        $users = collect($response->json('users'));
        $assignedRow = $users->firstWhere('invite_id', $assigned->id);
        $freeRow = $users->firstWhere('invite_id', $free->id);

        $this->assertEquals($cohort->id, $assignedRow['cohort_id']);
        $this->assertEquals('Rostered', $assignedRow['cohort_name']);
        $this->assertNull($freeRow['cohort_id']);
        $this->assertNull($freeRow['cohort_name']);
    }

    public function test_developers_endpoint_carries_cohort_fields(): void
    {
        $cohort = $this->createCohort('DevList');
        $assigned = $this->createInvite('dev-assigned@example.com');
        $free = $this->createInvite('dev-free@example.com');
        $this->addMember($cohort, $assigned);

        $this->createSessionEvent("invite:{$assigned->id}", 'cursor', $this->organizationId);
        $this->createSessionEvent("invite:{$free->id}", 'vscode', $this->organizationId);

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/developers');
        $response->assertStatus(200);

        $devs = collect($response->json('developers'));
        $assignedRow = $devs->firstWhere('id', "invite:{$assigned->id}");
        $freeRow = $devs->firstWhere('id', "invite:{$free->id}");

        $this->assertNotNull($assignedRow);
        $this->assertEquals($cohort->id, $assignedRow['cohort_id']);
        $this->assertEquals('DevList', $assignedRow['cohort_name']);
        $this->assertNull($freeRow['cohort_id']);
    }
}
