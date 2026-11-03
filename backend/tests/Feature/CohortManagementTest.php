<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Cohort;
use App\Models\CohortMember;
use App\Models\IDEConnectCode;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * K1A: cohort authority foundation.
 *
 * Proves: schema shape, org isolation, fail-closed admin mutations,
 * zero-or-one membership, reassignment/removal semantics, enrollment
 * integration (single + bulk, email + shared_link), atomicity, shared-link
 * privacy, and telemetry non-mutation.
 */
class CohortManagementTest extends TestCase
{
    private Organization $organization;
    private Organization $otherOrganization;
    private User $admin;
    private string $tokenRaw;

    protected function setUp(): void
    {
        parent::setUp();

        Mail::fake();

        $this->assertTrue(app()->environment('testing'), 'Refusing to run: APP_ENV is not testing');
        $this->assertEquals('sqlite', config('database.default'), 'Refusing to run: database driver is not sqlite');
        $this->assertEquals(':memory:', config('database.connections.sqlite.database'), 'Refusing to run: SQLite database is not :memory:');

        $this->createTables();

        $this->organization = Organization::create([
            'name' => 'Cohort Test Org',
            'slug' => 'cohort-test-' . Str::random(6),
        ]);

        $this->otherOrganization = Organization::create([
            'name' => 'Other Org',
            'slug' => 'other-org-' . Str::random(6),
        ]);

        $this->admin = User::create([
            'name' => 'Cohort Admin',
            'email' => 'admin-' . Str::random(8) . '@cohort.test',
            'password' => bcrypt('password'),
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->tokenRaw = ApiToken::generateDashboardToken($this->admin->id, $this->organization->id)['raw'];
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
                $table->timestamp('expires_at');
                $table->timestamp('redeemed_at')->nullable();
                $table->foreignId('redeemed_by_user_id')->nullable();
                $table->timestamps();
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
            });
        }

        // Mirrors 2026_09_27_000000_create_cohorts_table.php
        if (!Schema::hasTable('cohorts')) {
            Schema::create('cohorts', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('name')->collation('NOCASE');
                $table->string('description')->nullable();
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamp('archived_at')->nullable();
                $table->timestamps();
                $table->unique(['organization_id', 'name']);
                $table->index(['organization_id', 'archived_at']);
            });
        }

        // Mirrors 2026_09_27_000001_create_cohort_members_table.php
        if (!Schema::hasTable('cohort_members')) {
            Schema::create('cohort_members', function ($table) {
                $table->id();
                $table->foreignId('cohort_id')->constrained('cohorts')->cascadeOnDelete();
                $table->foreignId('invite_id')->unique()->constrained('invites')->cascadeOnDelete();
                $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
                $table->foreignId('assigned_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
                $table->index('cohort_id');
                $table->index('organization_id');
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
    }

    private function withAuth(?string $token = null): self
    {
        return $this->withHeaders([
            'Authorization' => 'Bearer ' . ($token ?? $this->tokenRaw),
        ]);
    }

    private function createUser(string $email, ?string $role, ?int $organizationId = null): User
    {
        return User::create([
            'name' => 'User ' . $email,
            'email' => $email,
            'password' => bcrypt('password'),
            'organization_id' => $organizationId ?? $this->organization->id,
            'role' => $role,
        ]);
    }

    private function tokenFor(User $user): string
    {
        return ApiToken::generateDashboardToken($user->id, $user->organization_id)['raw'];
    }

    private function createInvite(string $email, ?int $organizationId = null): Invite
    {
        return Invite::create([
            'organization_id' => $organizationId ?? $this->organization->id,
            'email' => $email,
            'expires_at' => Invite::enrollmentNeverExpires(),
        ]);
    }

    private function createCohort(string $name, ?int $organizationId = null): Cohort
    {
        return Cohort::create([
            'organization_id' => $organizationId ?? $this->organization->id,
            'name' => $name,
            'created_by' => $this->admin->id,
        ]);
    }

    // ---------------------------------------------------------------
    // Schema shape
    // ---------------------------------------------------------------

    public function test_cohort_tables_have_expected_schema(): void
    {
        $this->assertTrue(Schema::hasTable('cohorts'));
        $this->assertTrue(Schema::hasTable('cohort_members'));

        foreach (['id', 'organization_id', 'name', 'description', 'created_by', 'archived_at', 'created_at', 'updated_at'] as $col) {
            $this->assertTrue(Schema::hasColumn('cohorts', $col), "cohorts missing $col");
        }
        foreach (['id', 'cohort_id', 'invite_id', 'organization_id', 'assigned_by', 'created_at', 'updated_at'] as $col) {
            $this->assertTrue(Schema::hasColumn('cohort_members', $col), "cohort_members missing $col");
        }

        // cohorts.name carries NOCASE collation → UNIQUE(org, name) is case-insensitive
        $ddl = DB::selectOne("SELECT sql FROM sqlite_master WHERE name = 'cohorts' AND type = 'table'");
        $this->assertStringContainsStringIgnoringCase('collate', $ddl->sql);
        $this->assertStringContainsStringIgnoringCase('nocase', $ddl->sql);
    }

    public function test_case_insensitive_uniqueness_enforced_at_database_level(): void
    {
        $this->createCohort('Platform');

        $this->expectException(QueryException::class);
        DB::table('cohorts')->insert([
            'organization_id' => $this->organization->id,
            'name' => 'PLATFORM',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ---------------------------------------------------------------
    // CRUD
    // ---------------------------------------------------------------

    public function test_admin_can_create_cohort(): void
    {
        $response = $this->withAuth()->postJson('/api/org/cohorts', [
            'name' => 'Platform',
            'description' => 'Platform engineering',
        ]);

        $response->assertStatus(201);
        $cohort = $response->json('cohort');
        $this->assertEquals('Platform', $cohort['name']);
        $this->assertEquals('Platform engineering', $cohort['description']);
        $this->assertNull($cohort['archived_at']);
        $this->assertEquals(0, $cohort['member_count']);
    }

    public function test_admin_can_list_cohorts_with_member_counts(): void
    {
        $a = $this->createCohort('Alpha');
        $b = $this->createCohort('Beta');
        $invite = $this->createInvite('member@example.com');
        app(\App\Services\CohortMembershipService::class)->assign($a, $invite, $this->admin->id);

        $response = $this->withAuth()->getJson('/api/org/cohorts');

        $response->assertStatus(200);
        $cohorts = collect($response->json('cohorts'))->keyBy('name');
        $this->assertEquals(1, $cohorts['Alpha']['member_count']);
        $this->assertEquals(0, $cohorts['Beta']['member_count']);
    }

    public function test_admin_can_rename_and_update_cohort(): void
    {
        $cohort = $this->createCohort('Old Name');

        $response = $this->withAuth()->patchJson("/api/org/cohorts/{$cohort->id}", [
            'name' => 'New Name',
            'description' => 'updated',
        ]);

        $response->assertStatus(200);
        $this->assertEquals('New Name', $response->json('cohort.name'));
        $this->assertEquals('updated', $response->json('cohort.description'));
    }

    public function test_admin_can_archive_cohort_idempotently(): void
    {
        $cohort = $this->createCohort('To Archive');
        $invite = $this->createInvite('stay@example.com');
        app(\App\Services\CohortMembershipService::class)->assign($cohort, $invite, $this->admin->id);

        $response = $this->withAuth()->postJson("/api/org/cohorts/{$cohort->id}/archive");
        $response->assertStatus(200);
        $this->assertNotNull($response->json('cohort.archived_at'));

        // Membership rows persist for audit
        $this->assertEquals(1, CohortMember::where('cohort_id', $cohort->id)->count());

        // Second archive is a no-op, not an error
        $again = $this->withAuth()->postJson("/api/org/cohorts/{$cohort->id}/archive");
        $again->assertStatus(200);
        $this->assertNotNull($again->json('cohort.archived_at'));
    }

    public function test_archived_cohort_rejects_update(): void
    {
        $cohort = $this->createCohort('Frozen');
        $cohort->update(['archived_at' => now()]);

        $response = $this->withAuth()->patchJson("/api/org/cohorts/{$cohort->id}", [
            'name' => 'Thawed',
        ]);

        $response->assertStatus(422);
        $this->assertEquals('COHORT_ARCHIVED', $response->json('error_code'));
    }

    public function test_duplicate_name_case_insensitive_rejected(): void
    {
        $this->withAuth()->postJson('/api/org/cohorts', ['name' => 'Platform'])->assertStatus(201);

        $response = $this->withAuth()->postJson('/api/org/cohorts', ['name' => 'PLATFORM']);
        $response->assertStatus(422);
        $this->assertEquals('DUPLICATE_COHORT_NAME', $response->json('error_code'));

        // Same name in a different org is allowed
        $other = Cohort::create([
            'organization_id' => $this->otherOrganization->id,
            'name' => 'platform',
        ]);
        $this->assertNotNull($other->id);
    }

    // ---------------------------------------------------------------
    // Authorization — fail closed
    // ---------------------------------------------------------------

    public function test_non_admin_denied_all_cohort_mutations(): void
    {
        $member = $this->createUser('member-' . Str::random(6) . '@cohort.test', 'member');
        $token = $this->tokenFor($member);
        $cohort = $this->createCohort('Guarded');
        $invite = $this->createInvite('target@example.com');

        $this->withAuth($token)->postJson('/api/org/cohorts', ['name' => 'X'])->assertStatus(403);
        $this->withAuth($token)->patchJson("/api/org/cohorts/{$cohort->id}", ['name' => 'Y'])->assertStatus(403);
        $this->withAuth($token)->postJson("/api/org/cohorts/{$cohort->id}/archive")->assertStatus(403);
        $this->withAuth($token)->postJson("/api/org/cohorts/{$cohort->id}/members", ['invite_ids' => [$invite->id]])->assertStatus(403);
        $this->withAuth($token)->deleteJson("/api/org/cohorts/{$cohort->id}/members/{$invite->id}")->assertStatus(403);

        // Read stays available to authenticated org members
        $this->withAuth($token)->getJson('/api/org/cohorts')->assertStatus(200);
    }

    public function test_null_role_denied_cohort_mutations_fail_closed(): void
    {
        $nullRole = $this->createUser('nullrole-' . Str::random(6) . '@cohort.test', null);
        $token = $this->tokenFor($nullRole);
        $cohort = $this->createCohort('Guarded');
        $invite = $this->createInvite('target2@example.com');

        // The legacy requireAdmin defaults missing role to admin; the new
        // cohort endpoints must NOT inherit that permissive fallback.
        $this->withAuth($token)->postJson('/api/org/cohorts', ['name' => 'X'])->assertStatus(403);
        $this->withAuth($token)->patchJson("/api/org/cohorts/{$cohort->id}", ['name' => 'Y'])->assertStatus(403);
        $this->withAuth($token)->postJson("/api/org/cohorts/{$cohort->id}/archive")->assertStatus(403);
        $this->withAuth($token)->postJson("/api/org/cohorts/{$cohort->id}/members", ['invite_ids' => [$invite->id]])->assertStatus(403);
        $this->withAuth($token)->deleteJson("/api/org/cohorts/{$cohort->id}/members/{$invite->id}")->assertStatus(403);
    }

    public function test_unauthenticated_request_denied(): void
    {
        $this->getJson('/api/org/cohorts')->assertStatus(401);
        $this->postJson('/api/org/cohorts', ['name' => 'X'])->assertStatus(401);
    }

    // ---------------------------------------------------------------
    // Organization isolation
    // ---------------------------------------------------------------

    public function test_cross_org_cohort_not_visible_or_addressable(): void
    {
        $foreign = $this->createCohort('Foreign Cohort', $this->otherOrganization->id);

        $this->withAuth()->getJson("/api/org/cohorts/{$foreign->id}/members")->assertStatus(404);
        $this->withAuth()->patchJson("/api/org/cohorts/{$foreign->id}", ['name' => 'Hijack'])->assertStatus(404);
        $this->withAuth()->postJson("/api/org/cohorts/{$foreign->id}/archive")->assertStatus(404);

        $invite = $this->createInvite('isolated@example.com');
        $this->withAuth()->postJson("/api/org/cohorts/{$foreign->id}/members", ['invite_ids' => [$invite->id]])
            ->assertStatus(404);

        $this->withAuth()->deleteJson("/api/org/cohorts/{$foreign->id}/members/{$invite->id}")->assertStatus(404);

        // Index never leaks foreign cohorts
        $names = collect($this->withAuth()->getJson('/api/org/cohorts')->json('cohorts'))->pluck('name');
        $this->assertFalse($names->contains('Foreign Cohort'));

        // Foreign cohort unchanged
        $this->assertEquals('Foreign Cohort', $foreign->fresh()->name);
        $this->assertNull($foreign->fresh()->archived_at);
    }

    // ---------------------------------------------------------------
    // Membership semantics
    // ---------------------------------------------------------------

    public function test_assign_same_org_invite_to_cohort(): void
    {
        $cohort = $this->createCohort('Assigned');
        $invite = $this->createInvite('dev-a@example.com');

        $response = $this->withAuth()->postJson("/api/org/cohorts/{$cohort->id}/members", [
            'invite_ids' => [$invite->id],
        ]);

        $response->assertStatus(200);
        $this->assertEquals(1, $response->json('assigned'));
        $this->assertEquals(0, $response->json('reassigned'));

        $member = CohortMember::where('invite_id', $invite->id)->sole();
        $this->assertEquals($cohort->id, $member->cohort_id);
        $this->assertEquals($this->organization->id, $member->organization_id);

        $members = $this->withAuth()->getJson("/api/org/cohorts/{$cohort->id}/members")->json('members');
        $this->assertCount(1, $members);
        $this->assertEquals('invite:' . $invite->id, $members[0]['developer_id']);
        $this->assertEquals('dev-a@example.com', $members[0]['email']);
    }

    public function test_cross_org_invite_rejected_atomically(): void
    {
        $cohort = $this->createCohort('Target');
        $foreignInvite = $this->createInvite('foreign@example.com', $this->otherOrganization->id);
        $localInvite = $this->createInvite('local@example.com');

        $response = $this->withAuth()->postJson("/api/org/cohorts/{$cohort->id}/members", [
            'invite_ids' => [$localInvite->id, $foreignInvite->id],
        ]);

        $response->assertStatus(422);
        $this->assertEquals('INVALID_INVITES', $response->json('error_code'));

        // Nothing was written — even the valid invite
        $this->assertEquals(0, CohortMember::count());
    }

    public function test_archived_cohort_rejects_assignment(): void
    {
        $cohort = $this->createCohort('Archive Target');
        $cohort->update(['archived_at' => now()]);
        $invite = $this->createInvite('post-archive@example.com');

        $response = $this->withAuth()->postJson("/api/org/cohorts/{$cohort->id}/members", [
            'invite_ids' => [$invite->id],
        ]);

        $response->assertStatus(422);
        $this->assertEquals('COHORT_ARCHIVED', $response->json('error_code'));
        $this->assertEquals(0, CohortMember::count());
    }

    public function test_reassignment_a_to_b_leaves_exactly_one_membership(): void
    {
        $a = $this->createCohort('Cohort A');
        $b = $this->createCohort('Cohort B');
        $invite = $this->createInvite('mover@example.com');

        $this->withAuth()->postJson("/api/org/cohorts/{$a->id}/members", ['invite_ids' => [$invite->id]])
            ->assertStatus(200);

        $response = $this->withAuth()->postJson("/api/org/cohorts/{$b->id}/members", ['invite_ids' => [$invite->id]]);
        $response->assertStatus(200);
        $this->assertEquals(0, $response->json('assigned'));
        $this->assertEquals(1, $response->json('reassigned'));

        $rows = CohortMember::where('invite_id', $invite->id)->get();
        $this->assertCount(1, $rows);
        $this->assertEquals($b->id, $rows->first()->cohort_id);
    }

    public function test_removing_member_produces_unassigned_developer(): void
    {
        $cohort = $this->createCohort('Departure');
        $invite = $this->createInvite('leaver@example.com');
        $this->withAuth()->postJson("/api/org/cohorts/{$cohort->id}/members", ['invite_ids' => [$invite->id]])
            ->assertStatus(200);

        $this->withAuth()->deleteJson("/api/org/cohorts/{$cohort->id}/members/{$invite->id}")
            ->assertStatus(200);

        $this->assertNull(CohortMember::where('invite_id', $invite->id)->first());

        // Removing a non-member is a truthful 404
        $this->withAuth()->deleteJson("/api/org/cohorts/{$cohort->id}/members/{$invite->id}")
            ->assertStatus(404);
    }

    public function test_multiple_installations_do_not_duplicate_membership(): void
    {
        $cohort = $this->createCohort('Multi-Install');
        $invite = $this->createInvite('multi-device@example.com');

        // One developer identity (invite), multiple installations/tokens
        ApiToken::create([
            'token' => hash('sha256', 'install-token-1'),
            'organization_id' => $this->organization->id,
            'invite_id' => $invite->id,
            'installation_id' => 'install-aaa',
            'expires_at' => now()->addYear(),
        ]);
        ApiToken::create([
            'token' => hash('sha256', 'install-token-2'),
            'organization_id' => $this->organization->id,
            'invite_id' => $invite->id,
            'installation_id' => 'install-bbb',
            'expires_at' => now()->addYear(),
        ]);

        $this->withAuth()->postJson("/api/org/cohorts/{$cohort->id}/members", ['invite_ids' => [$invite->id]])
            ->assertStatus(200);

        // Membership is per-invite, not per-installation
        $this->assertEquals(1, CohortMember::where('invite_id', $invite->id)->count());
    }

    // ---------------------------------------------------------------
    // Enrollment integration — single invite
    // ---------------------------------------------------------------

    public function test_single_enrollment_with_cohort_assigns_invite(): void
    {
        $cohort = $this->createCohort('Enrolled');

        $response = $this->withAuth()->postJson('/api/org/invites', [
            'email' => 'enrolled@example.com',
            'purpose' => 'developer_enrollment',
            'send_email' => false,
            'cohort_id' => $cohort->id,
        ]);

        $response->assertStatus(200);
        $this->assertEquals($cohort->id, $response->json('cohort.id'));

        $invite = Invite::where('email', 'enrolled@example.com')->sole();
        $member = CohortMember::where('invite_id', $invite->id)->sole();
        $this->assertEquals($cohort->id, $member->cohort_id);
    }

    public function test_single_enrollment_invalid_cohort_fails_before_invite_created(): void
    {
        $response = $this->withAuth()->postJson('/api/org/invites', [
            'email' => 'never-created@example.com',
            'purpose' => 'developer_enrollment',
            'send_email' => false,
            'cohort_id' => 99999,
        ]);

        $response->assertStatus(422);
        $this->assertEquals('INVALID_COHORT', $response->json('error_code'));
        $this->assertEquals(0, Invite::count());
        $this->assertEquals(0, CohortMember::count());
    }

    // ---------------------------------------------------------------
    // Enrollment integration — bulk email mode
    // ---------------------------------------------------------------

    public function test_bulk_email_with_cohort_assigns_created_invites(): void
    {
        $cohort = $this->createCohort('Bulk Email');

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => ['b1@example.com', 'b2@example.com'],
            'cohort_id' => $cohort->id,
        ]);

        $response->assertStatus(200);
        $this->assertEquals(2, $response->json('summary.sent'));
        $this->assertEquals($cohort->id, $response->json('cohort.id'));
        $this->assertEquals(2, $response->json('cohort.assigned_count'));

        $this->assertEquals(2, CohortMember::where('cohort_id', $cohort->id)->count());
    }

    public function test_bulk_email_without_cohort_is_unchanged(): void
    {
        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => ['plain@example.com'],
        ]);

        $response->assertStatus(200);
        $this->assertEquals(1, $response->json('summary.sent'));
        $this->assertArrayNotHasKey('cohort', $response->json());
        $this->assertEquals(0, CohortMember::count());
    }

    // ---------------------------------------------------------------
    // Enrollment integration — bulk shared_link mode
    // ---------------------------------------------------------------

    public function test_bulk_shared_link_with_cohort_assigns_and_stays_private(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);
        $cohort = $this->createCohort('Shared Cohort');

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => ['s1@example.com', 's2@example.com'],
            'delivery_mode' => 'shared_link',
            'cohort_id' => $cohort->id,
        ]);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertEquals('shared_link', $body['delivery_mode']);
        $this->assertArrayHasKey('rollout_url', $body);
        $this->assertEquals($cohort->id, $body['cohort']['id']);
        $this->assertEquals('Shared Cohort', $body['cohort']['name']);
        $this->assertEquals(2, $body['cohort']['assigned_count']);

        // Privacy contract preserved
        $this->assertArrayNotHasKey('emails', $body);
        $this->assertArrayNotHasKey('results', $body);
        $this->assertArrayNotHasKey('connect_code', $body);
        $this->assertArrayNotHasKey('bearer', $body);
        $this->assertArrayNotHasKey('installation_token', $body);
        $this->assertArrayNotHasKey('token', $body);

        $this->assertEquals(2, CohortMember::where('cohort_id', $cohort->id)->count());

        Mail::assertNothingSent();
    }

    public function test_bulk_shared_link_reused_invite_is_reassigned(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        $cohortA = $this->createCohort('From');
        $cohortB = $this->createCohort('To');
        $invite = $this->createInvite('reassign@example.com');
        app(\App\Services\CohortMembershipService::class)->assign($cohortA, $invite, $this->admin->id);

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => ['reassign@example.com'],
            'delivery_mode' => 'shared_link',
            'cohort_id' => $cohortB->id,
        ]);

        $response->assertStatus(200);
        $this->assertEquals(1, $response->json('summary.reused'));
        $this->assertEquals(1, $response->json('cohort.assigned_count'));

        $rows = CohortMember::where('invite_id', $invite->id)->get();
        $this->assertCount(1, $rows);
        $this->assertEquals($cohortB->id, $rows->first()->cohort_id);

        Mail::assertNothingSent();
    }

    public function test_bulk_invalid_cohort_fails_atomically(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => ['atomic1@example.com', 'atomic2@example.com'],
            'delivery_mode' => 'shared_link',
            'cohort_id' => 424242,
        ]);

        $response->assertStatus(422);
        $this->assertEquals('INVALID_COHORT', $response->json('error_code'));
        $this->assertArrayNotHasKey('rollout_url', $response->json());
        $this->assertEquals(0, Invite::count());
        $this->assertEquals(0, CohortMember::count());
        $this->assertEquals(0, IDEConnectCode::count());
    }

    public function test_bulk_cross_org_cohort_rejected(): void
    {
        $foreign = $this->createCohort('Foreign', $this->otherOrganization->id);

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => ['crosscohort@example.com'],
            'delivery_mode' => 'shared_link',
            'cohort_id' => $foreign->id,
        ]);

        $response->assertStatus(422);
        $this->assertEquals('INVALID_COHORT', $response->json('error_code'));
        $this->assertEquals(0, Invite::count());
    }

    public function test_bulk_archived_cohort_rejected(): void
    {
        $cohort = $this->createCohort('Archived');
        $cohort->update(['archived_at' => now()]);

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => ['arch@example.com'],
            'delivery_mode' => 'shared_link',
            'cohort_id' => $cohort->id,
        ]);

        $response->assertStatus(422);
        $this->assertEquals('INVALID_COHORT', $response->json('error_code'));
        $this->assertEquals(0, Invite::count());
    }

    public function test_bulk_cohort_assignment_requires_explicit_admin_role(): void
    {
        // A null-role user passes the legacy permissive requireAdmin but
        // must still be denied cohort assignment.
        $nullRole = $this->createUser('nullbulk-' . Str::random(6) . '@cohort.test', null);
        $token = $this->tokenFor($nullRole);
        $cohort = $this->createCohort('AdminOnly');

        $response = $this->withAuth($token)->postJson('/api/org/invites/bulk', [
            'emails' => ['noguard@example.com'],
            'cohort_id' => $cohort->id,
        ]);

        $response->assertStatus(403);
        $this->assertEquals(0, CohortMember::count());
    }

    // ---------------------------------------------------------------
    // Telemetry non-mutation
    // ---------------------------------------------------------------

    public function test_telemetry_rows_unchanged_by_cohort_lifecycle(): void
    {
        $invite = $this->createInvite('telemetry-dev@example.com');

        $row = [
            'user_id' => 'invite:' . $invite->id,
            'organization_id' => $this->organization->id,
            'session_id' => 'sess-1',
            'source' => 'vscode',
            'event_type' => 'session',
            'count' => 1,
            'duration_ms' => 60000,
            'timestamp' => now()->subHour(),
            'metadata' => json_encode(['team_id' => null]),
            'payload' => json_encode(['events' => []]),
            'batch_hash' => bin2hex(random_bytes(32)),
            'created_at' => now(),
            'updated_at' => now(),
        ];
        DB::table('telemetry_events')->insert($row);
        $before = (array) DB::table('telemetry_events')->first();

        // Full cohort lifecycle against the same developer identity
        $cohortA = $this->createCohort('Tel A');
        $cohortB = $this->createCohort('Tel B');

        $this->withAuth()->postJson("/api/org/cohorts/{$cohortA->id}/members", ['invite_ids' => [$invite->id]]);
        $this->withAuth()->postJson("/api/org/cohorts/{$cohortB->id}/members", ['invite_ids' => [$invite->id]]);
        $this->withAuth()->postJson("/api/org/cohorts/{$cohortB->id}/archive");
        $this->withAuth()->deleteJson("/api/org/cohorts/{$cohortB->id}/members/{$invite->id}");

        $after = (array) DB::table('telemetry_events')->first();
        $this->assertEquals($before, $after);

        // No cohort field ever appears on the telemetry row
        $this->assertArrayNotHasKey('cohort_id', $after);
    }
}
