<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class MultiAdminAuthTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->assertTrue(app()->environment('testing'), 'Refusing to run: APP_ENV is not testing');
        $this->assertEquals('sqlite', config('database.default'), 'Refusing to run: database driver is not sqlite');
        $this->assertEquals(':memory:', config('database.connections.sqlite.database'), 'Refusing to run: SQLite database is not :memory:');

        $this->createTables();
        $this->seedFixture();
    }

    protected function tearDown(): void
    {
        if (app()->environment('testing') && config('database.default') === 'sqlite' && config('database.connections.sqlite.database') === ':memory:') {
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
                $table->string('password')->nullable();
                $table->string('github_id')->nullable();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->string('role')->default('member');
                $table->timestamps();
            });
        }
        if (!Schema::hasTable('invites')) {
            Schema::create('invites', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('token', 64)->unique();
                $table->string('email')->nullable();
                $table->string('role')->default('member');
                $table->timestamp('expires_at');
                $table->timestamp('redeemed_at')->nullable();
                $table->foreignId('redeemed_by_user_id')->nullable();
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
                $table->index('token');
                $table->index('user_id');
                $table->index('organization_id');
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
                $table->integer('session_prs_created')->default(0);
                $table->integer('session_prs_merged')->default(0);
                $table->integer('session_pr_reopen_count')->default(0);
                $table->integer('session_deployment_successes')->default(0);
                $table->timestamps();
            });
        }
    }

    private Organization $orgA;
    private Organization $orgB;
    private User $adminA;
    private User $adminA2;
    private User $memberA;
    private User $adminB;
    private string $adminAToken;
    private string $adminA2Token;
    private string $memberAToken;
    private string $adminBToken;

    private function seedFixture(): void
    {
        $this->orgA = Organization::create(['name' => 'Org A', 'slug' => 'org-a-' . Str::random(6)]);
        $this->orgB = Organization::create(['name' => 'Org B', 'slug' => 'org-b-' . Str::random(6)]);

        $this->adminA = User::create([
            'name' => 'Admin A', 'email' => 'admin-a@test.com',
            'password' => Hash::make('SecretPass123'),
            'organization_id' => $this->orgA->id, 'role' => 'admin',
        ]);
        $this->adminA2 = User::create([
            'name' => 'Admin A2', 'email' => 'admin-a2@test.com',
            'password' => Hash::make('SecretPass456'),
            'organization_id' => $this->orgA->id, 'role' => 'admin',
        ]);
        $this->memberA = User::create([
            'name' => 'Member A', 'email' => 'member-a@test.com',
            'password' => Hash::make('MemberPass789'),
            'organization_id' => $this->orgA->id, 'role' => 'member',
        ]);
        $this->adminB = User::create([
            'name' => 'Admin B', 'email' => 'admin-b@test.com',
            'password' => Hash::make('AdminBPass000'),
            'organization_id' => $this->orgB->id, 'role' => 'admin',
        ]);

        $this->adminAToken = ApiToken::generateDashboardToken($this->adminA->id, $this->orgA->id)['raw'];
        $this->adminA2Token = ApiToken::generateDashboardToken($this->adminA2->id, $this->orgA->id)['raw'];
        $this->memberAToken = ApiToken::generateDashboardToken($this->memberA->id, $this->orgA->id)['raw'];
        $this->adminBToken = ApiToken::generateDashboardToken($this->adminB->id, $this->orgB->id)['raw'];
    }

    private function authHeaders(string $token): array
    {
        return ['Authorization' => 'Bearer ' . $token];
    }

    private function makeAdminToken(int $userId, int $orgId): string
    {
        return ApiToken::generateDashboardToken($userId, $orgId)['raw'];
    }

    // === 1. Email/password login ===

    public function test_email_password_login_returns_dashboard_token(): void
    {
        $response = $this->postJson('/api/auth/login', [
            'email' => 'admin-a@test.com',
            'password' => 'SecretPass123',
        ]);
        $response->assertStatus(200);
        $response->assertJsonStructure(['dashboard_token', 'token_type', 'user']);
        $this->assertNotNull($response->json('dashboard_token'));
        $this->assertEquals('admin', $response->json('user.role'));
        $this->assertEquals($this->orgA->id, $response->json('user.organization_id'));
    }

    public function test_email_password_login_normalizes_email_case(): void
    {
        $response = $this->postJson('/api/auth/login', [
            'email' => 'ADMIN-A@TEST.COM',
            'password' => 'SecretPass123',
        ]);
        $response->assertStatus(200);
        $this->assertNotNull($response->json('dashboard_token'));
    }

    public function test_email_password_login_wrong_password_returns_401(): void
    {
        $response = $this->postJson('/api/auth/login', [
            'email' => 'admin-a@test.com',
            'password' => 'wrongpassword',
        ]);
        $response->assertStatus(401);
        $response->assertJsonPath('error', 'Invalid credentials');
    }

    public function test_email_password_login_nonexistent_email_returns_401(): void
    {
        $response = $this->postJson('/api/auth/login', [
            'email' => 'nobody@nowhere.com',
            'password' => 'anypassword',
        ]);
        $response->assertStatus(401);
        $response->assertJsonPath('error', 'Invalid credentials');
    }

    // === 2. Logout revokes dashboard token ===

    public function test_logout_revokes_current_dashboard_token(): void
    {
        $this->withHeaders($this->authHeaders($this->adminAToken))
            ->postJson('/api/auth/logout')
            ->assertStatus(200);

        // Token should now be invalid
        $this->withHeaders($this->authHeaders($this->adminAToken))
            ->getJson('/api/org/users')
            ->assertStatus(401);
    }

    public function test_logout_does_not_revoke_other_admins_token(): void
    {
        $this->withHeaders($this->authHeaders($this->adminAToken))
            ->postJson('/api/auth/logout');

        // Admin A2's token should still work
        $this->withHeaders($this->authHeaders($this->adminA2Token))
            ->getJson('/api/org/users')
            ->assertStatus(200);
    }

    // === 3. Two admins in same org see same org ===

    public function test_two_admins_same_org_see_same_users(): void
    {
        $respA = $this->withHeaders($this->authHeaders($this->adminAToken))->getJson('/api/org/users');
        $respA2 = $this->withHeaders($this->authHeaders($this->adminA2Token))->getJson('/api/org/users');

        $respA->assertStatus(200);
        $respA2->assertStatus(200);

        $emailsA = collect($respA->json('users'))->pluck('email')->sort()->values();
        $emailsA2 = collect($respA2->json('users'))->pluck('email')->sort()->values();

        $this->assertEquals($emailsA, $emailsA2, 'Both admins should see the same set of users');
        $this->assertContains('admin-a@test.com', $emailsA->toArray());
        $this->assertContains('admin-a2@test.com', $emailsA->toArray());
        $this->assertContains('member-a@test.com', $emailsA->toArray());
    }

    // === 4. Member cannot create admin invite ===

    public function test_member_cannot_create_invite(): void
    {
        $this->withHeaders($this->authHeaders($this->memberAToken))
            ->postJson('/api/org/invites', ['email' => 'newdev@test.com', 'role' => 'admin'])
            ->assertStatus(403)
            ->assertJsonPath('error', 'Insufficient permissions');
    }

    public function test_admin_can_create_invite(): void
    {
        $this->withHeaders($this->authHeaders($this->adminAToken))
            ->postJson('/api/org/invites', ['email' => 'newdev@test.com', 'role' => 'member', 'send_email' => false])
            ->assertStatus(200);
    }

    // === 5. Member cannot delete/change another dashboard user ===

    public function test_member_cannot_delete_user(): void
    {
        $this->withHeaders($this->authHeaders($this->memberAToken))
            ->deleteJson("/api/org/users/{$this->adminA2->id}")
            ->assertStatus(403);
    }

    public function test_member_cannot_change_role(): void
    {
        $this->withHeaders($this->authHeaders($this->memberAToken))
            ->postJson("/api/org/users/{$this->adminA2->id}/role", ['role' => 'member'])
            ->assertStatus(403);
    }

    // === 6. Last-admin protection ===

    public function test_last_admin_cannot_be_demoted(): void
    {
        // orgB has adminB as the only admin. Add a second admin (adminB2).
        $adminB2 = User::create([
            'name' => 'Admin B2', 'email' => 'admin-b2@test.com',
            'password' => Hash::make('Pass123'),
            'organization_id' => $this->orgB->id, 'role' => 'admin',
        ]);
        $adminB2Token = $this->makeAdminToken($adminB2->id, $this->orgB->id);

        // Demote adminB via adminB2 (2 admins → 1, should succeed)
        $this->withHeaders($this->authHeaders($adminB2Token))
            ->postJson("/api/org/users/{$this->adminB->id}/role", ['role' => 'member'])
            ->assertStatus(200);

        // Now adminB2 is the last admin. Try to demote adminB2 — self-modification blocked.
        $this->withHeaders($this->authHeaders($adminB2Token))
            ->postJson("/api/org/users/{$adminB2->id}/role", ['role' => 'member'])
            ->assertStatus(400);

        // Promote adminB back via adminB2, then demote adminB2 (2 → 1, succeed).
        $this->withHeaders($this->authHeaders($adminB2Token))
            ->postJson("/api/org/users/{$this->adminB->id}/role", ['role' => 'admin'])
            ->assertStatus(200);

        // adminB is now admin again. Generate a fresh token for adminB.
        $adminBToken2 = $this->makeAdminToken($this->adminB->id, $this->orgB->id);

        // Demote adminB2 via adminB (2 → 1, succeed)
        $this->withHeaders($this->authHeaders($adminBToken2))
            ->postJson("/api/org/users/{$adminB2->id}/role", ['role' => 'member'])
            ->assertStatus(200);

        // Now adminB is the last admin. Try to demote adminB — self-modification blocked.
        $this->withHeaders($this->authHeaders($adminBToken2))
            ->postJson("/api/org/users/{$this->adminB->id}/role", ['role' => 'member'])
            ->assertStatus(400);

        // Final: org still has at least 1 admin
        $this->assertGreaterThanOrEqual(1,
            User::where('organization_id', $this->orgB->id)->where('role', 'admin')->count());
    }

    public function test_last_admin_cannot_be_deleted(): void
    {
        // orgB has only adminB as admin. Create a second admin, then delete adminB (not last — succeed).
        // Then delete the second admin (last admin — self-deletion blocked).
        $adminB2 = User::create([
            'name' => 'Admin B2', 'email' => 'admin-b2@test.com',
            'password' => Hash::make('Pass123'),
            'organization_id' => $this->orgB->id, 'role' => 'admin',
        ]);
        $adminB2Token = $this->makeAdminToken($adminB2->id, $this->orgB->id);

        // Delete adminB via adminB2 (not self, not last admin — should succeed)
        $this->withHeaders($this->authHeaders($adminB2Token))
            ->deleteJson("/api/org/users/{$this->adminB->id}")
            ->assertStatus(200);

        // Now adminB2 is the last admin. Try to delete adminB2 — self-deletion blocked.
        $this->withHeaders($this->authHeaders($adminB2Token))
            ->deleteJson("/api/org/users/{$adminB2->id}")
            ->assertStatus(400);

        // Create a member, try to delete adminB2 via member — 403 (not admin)
        $memberB = User::create([
            'name' => 'Member B', 'email' => 'member-b@test.com',
            'password' => Hash::make('Pass123'),
            'organization_id' => $this->orgB->id, 'role' => 'member',
        ]);
        $memberBToken = $this->makeAdminToken($memberB->id, $this->orgB->id);

        $this->withHeaders($this->authHeaders($memberBToken))
            ->deleteJson("/api/org/users/{$adminB2->id}")
            ->assertStatus(403);

        // Final: org still has at least 1 admin
        $this->assertGreaterThanOrEqual(1,
            User::where('organization_id', $this->orgB->id)->where('role', 'admin')->count());
    }

    // === 7. Cross-org isolation ===

    public function test_admin_a_cannot_see_org_b_users(): void
    {
        $response = $this->withHeaders($this->authHeaders($this->adminAToken))
            ->getJson('/api/org/users');

        $response->assertStatus(200);
        $this->assertEquals($this->orgA->id, $response->json('organization.id'));

        $emails = collect($response->json('users'))->pluck('email')->toArray();
        $this->assertNotContains('admin-b@test.com', $emails);
    }

    public function test_admin_a_cannot_delete_org_b_user(): void
    {
        $this->withHeaders($this->authHeaders($this->adminAToken))
            ->deleteJson("/api/org/users/{$this->adminB->id}")
            ->assertStatus(403);
    }

    public function test_admin_a_cannot_change_org_b_user_role(): void
    {
        $this->withHeaders($this->authHeaders($this->adminAToken))
            ->postJson("/api/org/users/{$this->adminB->id}/role", ['role' => 'member'])
            ->assertStatus(404);
    }

    // === 8. Developer enrollment remains telemetry-only ===

    public function test_invite_backed_token_cannot_access_org_users(): void
    {
        $invite = Invite::create([
            'organization_id' => $this->orgA->id,
            'token' => Str::random(32),
            'email' => 'dev-enroll@test.com',
            'expires_at' => now()->addDays(30),
        ]);

        $raw = Str::random(64);
        ApiToken::create([
            'token' => hash('sha256', $raw),
            'user_id' => null,
            'organization_id' => $this->orgA->id,
            'invite_id' => $invite->id,
            'installation_id' => 'install-enroll-001',
            'expires_at' => now()->addDays(90),
        ]);

        $this->withHeaders(['Authorization' => 'Bearer ' . $raw])
            ->getJson('/api/org/users')
            ->assertStatus(403)
            ->assertJsonPath('error_code', 'TELEMETRY_ONLY_TOKEN');
    }

    // === 9. Invite → password setup → login flow ===

    public function test_invite_accept_then_login_flow(): void
    {
        // Admin creates an invite with admin role
        $inviteResponse = $this->withHeaders($this->authHeaders($this->adminAToken))
            ->postJson('/api/org/invites', [
                'email' => 'newuser@test.com',
                'role' => 'admin',
                'send_email' => false,
            ]);
        $inviteResponse->assertStatus(200);
        $inviteToken = $inviteResponse->json('invite.token');

        // New user accepts the invite
        $acceptResponse = $this->postJson("/api/invites/{$inviteToken}/accept", [
            'name' => 'New User',
            'password' => 'NewUserPass123',
            'password_confirmation' => 'NewUserPass123',
        ]);
        $acceptResponse->assertStatus(200);
        $this->assertEquals('admin', $acceptResponse->json('user.role'));
        $this->assertEquals($this->orgA->id, $acceptResponse->json('user.organization_id'));

        // New user logs in with email/password
        $loginResponse = $this->postJson('/api/auth/login', [
            'email' => 'newuser@test.com',
            'password' => 'NewUserPass123',
        ]);
        $loginResponse->assertStatus(200);
        $this->assertNotNull($loginResponse->json('dashboard_token'));
        $this->assertEquals('admin', $loginResponse->json('user.role'));

        // New user can access the dashboard
        $this->withHeaders(['Authorization' => 'Bearer ' . $loginResponse->json('dashboard_token')])
            ->getJson('/api/org/users')
            ->assertStatus(200);
    }

    // === 10. Regression: admin invite propagation ===

    public function test_admin_invite_results_in_admin_user_role(): void
    {
        // Admin creates an invite with role=admin
        $inviteResponse = $this->withHeaders($this->authHeaders($this->adminAToken))
            ->postJson('/api/org/invites', [
                'email' => 'newadmin-regression@test.com',
                'role' => 'admin',
                'send_email' => false,
            ]);
        $inviteResponse->assertStatus(200);
        $inviteToken = $inviteResponse->json('invite.token');

        // Verify the invite stored role=admin in the DB
        $invite = \DB::table('invites')->where('token', $inviteToken)->first();
        $this->assertEquals('admin', $invite->role, 'Invite must store role=admin');

        // Verify the show endpoint returns role=admin
        $showResponse = $this->getJson("/api/invites/{$inviteToken}");
        $showResponse->assertStatus(200);
        $showResponse->assertJsonPath('invite.role', 'admin');

        // Accept the invite
        $acceptResponse = $this->postJson("/api/invites/{$inviteToken}/accept", [
            'name' => 'New Admin Regression',
            'password' => 'NewAdminPass123',
            'password_confirmation' => 'NewAdminPass123',
        ]);
        $acceptResponse->assertStatus(200);
        $acceptResponse->assertJsonPath('user.role', 'admin');

        // Verify the user in the DB has role=admin
        $user = User::where('email', 'newadmin-regression@test.com')->first();
        $this->assertNotNull($user);
        $this->assertEquals('admin', $user->role, 'Created user must have role=admin');

        // Login with email/password
        $loginResponse = $this->postJson('/api/auth/login', [
            'email' => 'newadmin-regression@test.com',
            'password' => 'NewAdminPass123',
        ]);
        $loginResponse->assertStatus(200);
        $loginResponse->assertJsonPath('user.role', 'admin');

        // /api/org/users must report this user as admin
        $orgUsersResponse = $this->withHeaders([
            'Authorization' => 'Bearer ' . $loginResponse->json('dashboard_token'),
        ])->getJson('/api/org/users');
        $orgUsersResponse->assertStatus(200);

        $users = collect($orgUsersResponse->json('users'));
        $newUser = $users->firstWhere('email', 'newadmin-regression@test.com');
        $this->assertNotNull($newUser, 'New admin must appear in org users list');
        $this->assertEquals('admin', $newUser['role'], 'Org users endpoint must report role=admin');
    }

    public function test_member_invite_results_in_member_user_role(): void
    {
        // Admin creates an invite with role=member
        $inviteResponse = $this->withHeaders($this->authHeaders($this->adminAToken))
            ->postJson('/api/org/invites', [
                'email' => 'newmember-regression@test.com',
                'role' => 'member',
                'send_email' => false,
            ]);
        $inviteResponse->assertStatus(200);
        $inviteToken = $inviteResponse->json('invite.token');

        // Verify the invite stored role=member
        $invite = \DB::table('invites')->where('token', $inviteToken)->first();
        $this->assertEquals('member', $invite->role);

        // Accept the invite
        $acceptResponse = $this->postJson("/api/invites/{$inviteToken}/accept", [
            'name' => 'New Member Regression',
            'password' => 'NewMemberPass123',
            'password_confirmation' => 'NewMemberPass123',
        ]);
        $acceptResponse->assertStatus(200);
        $acceptResponse->assertJsonPath('user.role', 'member');

        // Verify the user in the DB has role=member
        $user = User::where('email', 'newmember-regression@test.com')->first();
        $this->assertNotNull($user);
        $this->assertEquals('member', $user->role);

        // Login
        $loginResponse = $this->postJson('/api/auth/login', [
            'email' => 'newmember-regression@test.com',
            'password' => 'NewMemberPass123',
        ]);
        $loginResponse->assertStatus(200);
        $loginResponse->assertJsonPath('user.role', 'member');

        // /api/org/users must report this user as member
        $orgUsersResponse = $this->withHeaders([
            'Authorization' => 'Bearer ' . $loginResponse->json('dashboard_token'),
        ])->getJson('/api/org/users');
        $orgUsersResponse->assertStatus(200);

        $users = collect($orgUsersResponse->json('users'));
        $newUser = $users->firstWhere('email', 'newmember-regression@test.com');
        $this->assertNotNull($newUser);
        $this->assertEquals('member', $newUser['role']);
    }
}
