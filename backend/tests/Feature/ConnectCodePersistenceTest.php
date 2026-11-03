<?php

namespace Tests\Feature;

use App\Models\IDEConnectCode;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Proves the enrollment-code persistence contract:
 * - issueForInvite() is idempotent (returns same code, does not rotate)
 * - roster response exposes has_connect_code (non-secret) not plaintext code
 * - expired/used codes correctly return has_connect_code=false
 * - repeated issue calls return the identical active code
 */
class ConnectCodePersistenceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

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
            Schema::dropIfExists('cohort_members');
            Schema::dropIfExists('cohorts');
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
                $table->string('role')->nullable();
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
                $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
                $table->foreignId('organization_id')->nullable()->constrained('organizations');
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
                $table->foreignId('user_id')->nullable()->constrained('users');
                $table->foreignId('organization_id')->nullable()->constrained('organizations');
                $table->foreignId('invite_id')->nullable()->constrained('invites')->nullOnDelete();
                $table->string('installation_id', 64)->nullable();
                $table->timestamp('expires_at');
                $table->timestamp('used_at')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('cohorts')) {
            Schema::create('cohorts', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('name');
                $table->timestamp('archived_at')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('cohort_members')) {
            Schema::create('cohort_members', function ($table) {
                $table->id();
                $table->foreignId('cohort_id')->constrained('cohorts')->cascadeOnDelete();
                $table->foreignId('invite_id')->unique()->constrained('invites')->cascadeOnDelete();
                $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
                $table->foreignId('assigned_by')->nullable();
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
                $table->string('event_id', 64)->nullable();
                $table->integer('session_prs_created')->default(0);
                $table->integer('session_prs_merged')->default(0);
                $table->integer('session_pr_reopen_count')->default(0);
                $table->integer('session_deployment_successes')->default(0);
                $table->timestamps();
            });
        }
    }

    private function seedOrgUserAndInvite(): array
    {
        $org = Organization::create([
            'name' => 'Test Org',
            'slug' => 'test-org-' . Str::random(6),
        ]);

        $user = User::create([
            'email' => 'admin-' . Str::random(8) . '@test.com',
            'name' => 'Admin',
            'organization_id' => $org->id,
            'role' => 'admin',
        ]);

        $invite = Invite::create([
            'organization_id' => $org->id,
            'token' => Str::random(32),
            'email' => 'dev@test.com',
            'expires_at' => now()->addDays(30),
        ]);

        return [$org, $user, $invite];
    }

    /**
     * TEST: issueForInvite returns the same code when called twice (idempotent)
     */
    public function test_issue_for_invite_is_idempotent(): void
    {
        [$org, $user, $invite] = $this->seedOrgUserAndInvite();

        $code1 = IDEConnectCode::issueForInvite($invite, $user->id);
        $code2 = IDEConnectCode::issueForInvite($invite, $user->id);

        $this->assertEquals($code1->code, $code2->code, 'Second call must return the same code, not a rotated one');
        $this->assertEquals($code1->id, $code2->id, 'Must be the same DB row');

        $count = IDEConnectCode::where('invite_id', $invite->id)
            ->where('expires_at', '>', now())
            ->count();
        $this->assertEquals(1, $count, 'Must have exactly one active code after two calls');
    }

    /**
     * TEST: issueForInvite with forceNew=true revokes the prior code and
     * creates a genuinely new one (PILOT OPS 18H regeneration contract).
     */
    public function test_issue_for_invite_force_new_creates_second_code(): void
    {
        [$org, $user, $invite] = $this->seedOrgUserAndInvite();

        $code1 = IDEConnectCode::issueForInvite($invite, $user->id);
        $code2 = IDEConnectCode::issueForInvite($invite, $user->id, forceNew: true);

        $this->assertNotEquals($code1->code, $code2->code, 'forceNew must create a different code');
        $this->assertNotEquals($code1->id, $code2->id, 'forceNew must create a new DB row');

        $code1->refresh();
        $this->assertTrue($code1->isRevoked(), 'forceNew must revoke the prior live code');
    }

    /**
     * TEST: Roster response exposes has_connect_code=true when active code exists
     */
    public function test_roster_shows_has_connect_code_true_when_code_exists(): void
    {
        [$org, $user, $invite] = $this->seedOrgUserAndInvite();

        IDEConnectCode::issueForInvite($invite, $user->id);

        $response = $this->getJson('/api/org/users', [
            'X-API-Token' => $this->makeTokenForUser($user),
        ]);

        $response->assertStatus(200);
        $members = $response->json('users');
        $pending = collect($members)->firstWhere('status', 'pending');

        $this->assertNotNull($pending, 'Pending invite should appear in roster');
        $this->assertTrue($pending['has_connect_code'], 'has_connect_code must be true when active code exists');
        $this->assertArrayNotHasKey('connect_code', $pending, 'Roster must NOT ship plaintext connect_code');
        $this->assertEquals('ready', $pending['enrollment_status']);
    }

    /**
     * TEST: Roster response exposes has_connect_code=false when no code exists
     */
    public function test_roster_shows_has_connect_code_false_when_no_code(): void
    {
        [$org, $user, $invite] = $this->seedOrgUserAndInvite();

        $response = $this->getJson('/api/org/users', [
            'X-API-Token' => $this->makeTokenForUser($user),
        ]);

        $response->assertStatus(200);
        $members = $response->json('users');
        $pending = collect($members)->firstWhere('status', 'pending');

        $this->assertNotNull($pending);
        $this->assertFalse($pending['has_connect_code'], 'has_connect_code must be false when no code exists');
        $this->assertArrayNotHasKey('connect_code', $pending, 'Roster must NOT ship plaintext connect_code');
        $this->assertEquals('not_generated', $pending['enrollment_status']);
    }

    /**
     * TEST: Roster shows enrollment_status=expired + connect_code_expired=true
     * when an unused code has expired (PILOT OPS 14-B truth gate).
     */
    public function test_roster_shows_expired_status_when_code_expired(): void
    {
        [$org, $user, $invite] = $this->seedOrgUserAndInvite();

        // Create an expired code
        IDEConnectCode::create([
            'organization_id' => $org->id,
            'invite_id' => $invite->id,
            'user_id' => $user->id,
            'expires_at' => now()->subDay(),
        ]);

        $response = $this->getJson('/api/org/users', [
            'X-API-Token' => $this->makeTokenForUser($user),
        ]);

        $response->assertStatus(200);
        $pending = collect($response->json('users'))->firstWhere('status', 'pending');

        // PILOT OPS 14-B: an expired unused code must NOT be presented as
        // "Ready to connect" (ready) nor hidden as "not_generated". It must
        // surface as "Code expired" so the admin can regenerate it.
        $this->assertTrue($pending['has_connect_code'], 'Expired code still counts as a code being issued');
        $this->assertFalse($pending['has_valid_connect_code'], 'Expired code must not be valid');
        $this->assertTrue($pending['connect_code_expired'], 'connect_code_expired must be true for expired unused code');
        $this->assertArrayNotHasKey('connect_code', $pending, 'Roster must NOT ship plaintext connect_code');
        $this->assertEquals('expired', $pending['enrollment_status']);
    }

    /**
     * TEST: used_at is non-authoritative legacy state (PILOT OPS 18H).
     * Enrollment codes are intentionally reusable across installations and
     * exchange never marks them used, so a used_at-stamped live code must
     * still surface as a valid code — not as "not generated".
     */
    public function test_roster_treats_used_at_stamped_code_as_still_live(): void
    {
        [$org, $user, $invite] = $this->seedOrgUserAndInvite();

        IDEConnectCode::create([
            'organization_id' => $org->id,
            'invite_id' => $invite->id,
            'user_id' => $user->id,
            'expires_at' => Invite::enrollmentNeverExpires(),
            'used_at' => now(),
        ]);

        $response = $this->getJson('/api/org/users', [
            'X-API-Token' => $this->makeTokenForUser($user),
        ]);

        $response->assertStatus(200);
        $pending = collect($response->json('users'))->firstWhere('status', 'pending');

        $this->assertTrue($pending['has_connect_code'], 'used_at must not hide a live code');
        $this->assertTrue($pending['has_valid_connect_code'], 'used_at must not invalidate a live code');
        $this->assertFalse($pending['connect_code_expired']);
        $this->assertEquals('ready', $pending['enrollment_status']);
    }

    /**
     * TEST: Calling the issue endpoint twice returns the same code (HTTP-level proof)
     */
    public function test_issue_endpoint_called_twice_returns_same_code(): void
    {
        [$org, $user, $invite] = $this->seedOrgUserAndInvite();

        $token = $this->makeTokenForUser($user);

        $resp1 = $this->postJson("/api/org/invites/{$invite->id}/connect-code", [], [
            'X-API-Token' => $token,
        ]);
        $resp1->assertStatus(200);
        $code1 = $resp1->json('connect_code');

        $resp2 = $this->postJson("/api/org/invites/{$invite->id}/connect-code", [], [
            'X-API-Token' => $token,
        ]);
        $resp2->assertStatus(200);
        $code2 = $resp2->json('connect_code');

        $this->assertEquals($code1, $code2, 'Second issue call must return the same code, not a rotated one');
    }

    /**
     * TEST: Roster after refresh (re-fetch) retains has_connect_code=true
     */
    public function test_roster_refetch_retains_has_connect_code(): void
    {
        [$org, $user, $invite] = $this->seedOrgUserAndInvite();
        $token = $this->makeTokenForUser($user);

        // Issue a code
        $this->postJson("/api/org/invites/{$invite->id}/connect-code", [], [
            'X-API-Token' => $token,
        ])->assertStatus(200);

        // Simulate refresh: re-fetch roster
        $response = $this->getJson('/api/org/users', [
            'X-API-Token' => $token,
        ]);

        $response->assertStatus(200);
        $pending = collect($response->json('users'))->firstWhere('status', 'pending');
        $this->assertTrue($pending['has_connect_code'], 'has_connect_code must survive refresh');
    }

    /**
     * TEST: Revoke endpoint marks the code revoked on next roster fetch
     *
     * PILOT OPS 18H: revokeForInvite() stamps the revoked sentinel, so the
     * code surfaces as enrollment_status='revoked' with
     * connect_code_revoked=true — truthfully distinct from legacy natural
     * expiry. The admin sees "Code revoked" + a Regenerate action rather
     * than a misleading "Ready to connect" or a hidden "not_generated".
     */
    public function test_revoke_clears_has_connect_code_on_roster_refetch(): void
    {
        [$org, $user, $invite] = $this->seedOrgUserAndInvite();
        $token = $this->makeTokenForUser($user);

        // Issue a code
        $this->postJson("/api/org/invites/{$invite->id}/connect-code", [], [
            'X-API-Token' => $token,
        ])->assertStatus(200);

        // Revoke
        $this->deleteJson("/api/org/invites/{$invite->id}/connect-code", [], [
            'X-API-Token' => $token,
        ])->assertStatus(200);

        // Re-fetch roster
        $response = $this->getJson('/api/org/users', [
            'X-API-Token' => $token,
        ]);

        $response->assertStatus(200);
        $pending = collect($response->json('users'))->firstWhere('status', 'pending');
        $this->assertTrue($pending['has_connect_code'], 'Revoked code still counts as a code being issued');
        $this->assertFalse($pending['has_valid_connect_code'], 'Revoked code must not be valid');
        $this->assertFalse($pending['connect_code_expired'], 'Revoked code must NOT be reported as expired');
        $this->assertTrue($pending['connect_code_revoked'], 'Revoked code must surface as revoked');
        $this->assertEquals('revoked', $pending['enrollment_status']);
    }

    /**
     * Create a valid API token for the given user (for SimpleTokenAuth middleware).
     */
    private function makeTokenForUser(User $user): string
    {
        $token = 'test-token-' . Str::random(16);
        \App\Models\ApiToken::create([
            'token' => hash('sha256', $token),
            'user_id' => $user->id,
            'organization_id' => $user->organization_id,
            'expires_at' => now()->addDays(30),
        ]);
        return $token;
    }
}
