<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\IDEConnectCode;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Dashboard-invite recovery contract (P1 invite-recovery):
 *
 *  - Pending dashboard invites carry a recoverable acceptance link:
 *    accept-link reveals the current URL; reissue rotates the token
 *    atomically so exactly one link is ever valid.
 *  - The old token fails closed after reissue; the new token accepts once.
 *  - Redeemed, cancelled (revoked sentinel), cross-org, and non-admin
 *    requests are all rejected.
 *  - Ordinary list endpoints (/api/org/invites, /api/org/users) never emit
 *    the raw invite token.
 *  - Role is preserved through reissue and surfaces on the pending row.
 */
class InviteReissueTest extends TestCase
{
    private Organization $org;
    private Organization $otherOrg;
    private User $admin;
    private User $member;
    private User $otherOrgAdmin;
    private string $adminToken;
    private string $memberToken;
    private string $otherOrgToken;

    protected function setUp(): void
    {
        parent::setUp();

        Mail::fake();

        $this->assertTrue(app()->environment('testing'), 'Refusing to run: APP_ENV is not testing');
        $this->assertEquals('sqlite', config('database.default'), 'Refusing to run: database driver is not sqlite');
        $this->assertEquals(':memory:', config('database.connections.sqlite.database'), 'Refusing to run: SQLite database is not :memory:');

        $this->createTables();

        $this->org = Organization::create(['name' => 'Org A', 'slug' => 'org-a-' . Str::random(6)]);
        $this->otherOrg = Organization::create(['name' => 'Org B', 'slug' => 'org-b-' . Str::random(6)]);

        $this->admin = User::create([
            'name' => 'Admin A',
            'email' => 'admin-a-' . Str::random(6) . '@test.local',
            'password' => bcrypt('password'),
            'organization_id' => $this->org->id,
            'role' => 'admin',
        ]);
        $this->member = User::create([
            'name' => 'Member A',
            'email' => 'member-a-' . Str::random(6) . '@test.local',
            'password' => bcrypt('password'),
            'organization_id' => $this->org->id,
            'role' => 'member',
        ]);
        $this->otherOrgAdmin = User::create([
            'name' => 'Admin B',
            'email' => 'admin-b-' . Str::random(6) . '@test.local',
            'password' => bcrypt('password'),
            'organization_id' => $this->otherOrg->id,
            'role' => 'admin',
        ]);

        $this->adminToken = $this->makeToken($this->admin);
        $this->memberToken = $this->makeToken($this->member);
        $this->otherOrgToken = $this->makeToken($this->otherOrgAdmin);
    }

    protected function tearDown(): void
    {
        if (app()->environment('testing')
            && config('database.default') === 'sqlite'
            && config('database.connections.sqlite.database') === ':memory:'
        ) {
            Schema::dropIfExists('cohort_members');
            Schema::dropIfExists('cohorts');
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
                $table->foreignId('user_id')->nullable()->constrained('users');
                $table->foreignId('organization_id')->nullable()->constrained('organizations');
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
                $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
                $table->foreignId('organization_id')->nullable()->constrained('organizations');
                $table->foreignId('invite_id')->nullable()->constrained('invites')->nullOnDelete();
                $table->string('installation_id', 64)->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->timestamp('revoked_at')->nullable();
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
    }

    private function makeToken(User $user): string
    {
        $raw = 'token-' . Str::random(40);
        ApiToken::create([
            'token' => hash('sha256', $raw),
            'user_id' => $user->id,
            'organization_id' => $user->organization_id,
            'expires_at' => now()->addDay(),
        ]);
        return $raw;
    }

    private function asAdmin(): self
    {
        return $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken]);
    }

    private function makePendingInvite(array $overrides = []): Invite
    {
        // Invite::$fillable omits 'role', so insert directly to control it.
        $id = \Illuminate\Support\Facades\DB::table('invites')->insertGetId(array_merge([
            'organization_id' => $this->org->id,
            'email' => 'pending-' . Str::random(6) . '@test.local',
            'role' => 'admin',
            'token' => bin2hex(random_bytes(16)),
            'expires_at' => now()->addHours(168),
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));

        return Invite::findOrFail($id);
    }

    // ── reveal (accept-link) ──────────────────────────────────────────

    public function test_accept_link_reveals_current_pending_url(): void
    {
        $invite = $this->makePendingInvite();

        $response = $this->asAdmin()->postJson("/api/org/invites/{$invite->id}/accept-link");

        $response->assertOk();
        $this->assertStringContainsString('/invite/' . $invite->token, $response->json('shareable_url'));
    }

    public function test_accept_link_rejects_redeemed_invite(): void
    {
        $invite = $this->makePendingInvite(['redeemed_at' => now()]);

        $this->asAdmin()->postJson("/api/org/invites/{$invite->id}/accept-link")->assertStatus(422);
    }

    public function test_accept_link_rejects_expired_invite(): void
    {
        $invite = $this->makePendingInvite(['expires_at' => now()->subHour()]);

        $this->asAdmin()->postJson("/api/org/invites/{$invite->id}/accept-link")->assertStatus(422);
    }

    // ── reissue ───────────────────────────────────────────────────────

    public function test_reissue_rotates_token_and_returns_new_url(): void
    {
        $invite = $this->makePendingInvite();
        $oldToken = $invite->token;

        $response = $this->asAdmin()->postJson("/api/org/invites/{$invite->id}/reissue");

        $response->assertOk();
        $invite->refresh();
        $this->assertNotEquals($oldToken, $invite->token);
        $this->assertStringContainsString('/invite/' . $invite->token, $response->json('shareable_url'));
        $this->assertArrayNotHasKey('token', $response->json('invite'));
    }

    public function test_old_token_fails_and_new_token_accepts_after_reissue(): void
    {
        $invite = $this->makePendingInvite();
        $oldToken = $invite->token;

        $this->asAdmin()->postJson("/api/org/invites/{$invite->id}/reissue")->assertOk();
        $invite->refresh();
        $newToken = $invite->token;

        // Old token fails closed on the public lookup and accept paths.
        $this->getJson("/api/invites/{$oldToken}")->assertStatus(404);
        $this->postJson("/api/invites/{$oldToken}/accept", [
            'name' => 'X', 'password' => 'password123', 'password_confirmation' => 'password123',
        ])->assertStatus(404);

        // New token resolves and accepts exactly once.
        $this->getJson("/api/invites/{$newToken}")->assertOk();
        $this->postJson("/api/invites/{$newToken}/accept", [
            'name' => 'New Admin', 'password' => 'password123', 'password_confirmation' => 'password123',
        ])->assertOk();

        $this->postJson("/api/invites/{$newToken}/accept", [
            'name' => 'Second Use', 'password' => 'password123', 'password_confirmation' => 'password123',
        ])->assertStatus(400); // already redeemed
    }

    public function test_reissue_preserves_role_and_refreshes_dashboard_expiry(): void
    {
        $invite = $this->makePendingInvite(['role' => 'admin', 'expires_at' => now()->subHour()]);

        $this->asAdmin()->postJson("/api/org/invites/{$invite->id}/reissue", ['expires_hours' => 72])->assertOk();
        $invite->refresh();

        $this->assertEquals('admin', $invite->role);
        $this->assertTrue($invite->expires_at->greaterThan(now()->addHours(71)));
        $this->assertTrue($invite->expires_at->lessThan(now()->addHours(73)));
    }

    public function test_reissue_enrollment_invite_keeps_never_expiring_sentinel(): void
    {
        $invite = $this->makePendingInvite([
            'expires_at' => Invite::ENROLLMENT_NEVER_EXPIRES,
        ]);

        $this->asAdmin()->postJson("/api/org/invites/{$invite->id}/reissue")->assertOk();
        $invite->refresh();

        $this->assertEquals(Invite::ENROLLMENT_NEVER_EXPIRES, $invite->expires_at->toDateTimeString());
    }

    public function test_reissue_code_backed_invite_keeps_never_expiring_sentinel(): void
    {
        $invite = $this->makePendingInvite(['expires_at' => now()->addHours(24)]);
        IDEConnectCode::create([
            'code' => strtoupper(Str::random(12)),
            'user_id' => $this->admin->id,
            'organization_id' => $this->org->id,
            'invite_id' => $invite->id,
            'expires_at' => Invite::enrollmentNeverExpires(),
        ]);

        $this->asAdmin()->postJson("/api/org/invites/{$invite->id}/reissue")->assertOk();
        $invite->refresh();

        $this->assertEquals(Invite::ENROLLMENT_NEVER_EXPIRES, $invite->expires_at->toDateTimeString());
    }

    public function test_reissue_rejects_redeemed_invite(): void
    {
        $invite = $this->makePendingInvite(['redeemed_at' => now()]);

        $this->asAdmin()->postJson("/api/org/invites/{$invite->id}/reissue")->assertStatus(422);
    }

    public function test_reissue_rejects_cancelled_invite(): void
    {
        $invite = $this->makePendingInvite(['expires_at' => IDEConnectCode::REVOKED_EXPIRES_AT]);

        $this->asAdmin()->postJson("/api/org/invites/{$invite->id}/reissue")->assertStatus(422);
    }

    public function test_reissue_rejects_other_organization(): void
    {
        $invite = $this->makePendingInvite();

        $this->withHeaders(['Authorization' => 'Bearer ' . $this->otherOrgToken])
            ->postJson("/api/org/invites/{$invite->id}/reissue")
            ->assertStatus(403);
    }

    public function test_reissue_rejects_non_admin(): void
    {
        $invite = $this->makePendingInvite();

        $this->withHeaders(['Authorization' => 'Bearer ' . $this->memberToken])
            ->postJson("/api/org/invites/{$invite->id}/reissue")
            ->assertStatus(403);
    }

    public function test_accept_link_rejects_cross_org_and_non_admin(): void
    {
        $invite = $this->makePendingInvite();

        $this->withHeaders(['Authorization' => 'Bearer ' . $this->otherOrgToken])
            ->postJson("/api/org/invites/{$invite->id}/accept-link")
            ->assertStatus(403);
        $this->withHeaders(['Authorization' => 'Bearer ' . $this->memberToken])
            ->postJson("/api/org/invites/{$invite->id}/accept-link")
            ->assertStatus(403);
    }

    public function test_malformed_token_fails_closed(): void
    {
        $this->getJson('/api/invites/not-a-real-token')->assertStatus(404);
        $this->postJson('/api/invites/not-a-real-token/accept', [
            'name' => 'X', 'password' => 'password123', 'password_confirmation' => 'password123',
        ])->assertStatus(404);
    }

    // ── secret hygiene in list payloads ───────────────────────────────

    public function test_invite_index_never_returns_raw_tokens(): void
    {
        $invite = $this->makePendingInvite();

        $response = $this->asAdmin()->getJson('/api/org/invites');

        $response->assertOk();
        $invites = $response->json('invites');
        $this->assertNotEmpty($invites);
        foreach ($invites as $row) {
            $this->assertArrayNotHasKey('token', $row);
        }
        $this->assertStringNotContainsString($invite->token, $response->getContent());
    }

    public function test_org_users_pending_row_has_no_token_and_marks_kind_and_role(): void
    {
        $invite = $this->makePendingInvite(['role' => 'admin']);

        $response = $this->asAdmin()->getJson('/api/org/users');

        $response->assertOk();
        $pending = collect($response->json('users'))->firstWhere('invite_id', $invite->id);

        $this->assertNotNull($pending);
        $this->assertEquals('pending', $pending['status']);
        $this->assertEquals('dashboard', $pending['invite_kind']);
        $this->assertEquals('admin', $pending['role']);
        $this->assertArrayNotHasKey('invite_token', $pending);
        $this->assertStringNotContainsString($invite->token, $response->getContent());
    }
}
