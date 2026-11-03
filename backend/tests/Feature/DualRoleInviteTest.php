<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\IDEConnectCode;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * P0 dual-role access: a developer enrollment and a dashboard invite are
 * separate capabilities for the same email and must never block each other.
 */
class DualRoleInviteTest extends TestCase
{
    private Organization $organization;
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
            'name' => 'Dual Role Org',
            'slug' => 'dual-role-' . Str::random(6),
        ]);

        $this->admin = User::create([
            'name' => 'Org Admin',
            'email' => 'admin-' . Str::random(8) . '@dual.test',
            'password' => bcrypt('password'),
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->tokenRaw = 'dual-role-token-' . Str::random(32);
        ApiToken::create([
            'token' => hash('sha256', $this->tokenRaw),
            'user_id' => $this->admin->id,
            'organization_id' => $this->organization->id,
            'expires_at' => now()->addDays(1),
        ]);
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
    }

    private function withAuth(): self
    {
        return $this->withHeaders([
            'Authorization' => 'Bearer ' . $this->tokenRaw,
        ]);
    }

    private function createEnrollment(string $email): Invite
    {
        $response = $this->withAuth()->postJson('/api/org/invites', [
            'role' => 'member',
            'email' => $email,
            'send_email' => false,
            'purpose' => 'developer_enrollment',
        ]);

        $response->assertStatus(200);

        return Invite::where('email', $email)
            ->where('expires_at', Invite::ENROLLMENT_NEVER_EXPIRES)
            ->firstOrFail();
    }

    public function test_enrollment_then_dashboard_member_invite_succeeds(): void
    {
        $email = 'dual-role@example.test';
        $enrollment = $this->createEnrollment($email);

        $response = $this->withAuth()->postJson('/api/org/invites', [
            'email' => $email,
            'role' => 'member',
            'send_email' => false,
            'expires_hours' => 168,
        ]);

        $response->assertStatus(200);

        // Both records coexist as separate rows.
        $this->assertEquals(2, Invite::where('email', $email)->count());
        $this->assertNotNull(
            Invite::where('email', $email)
                ->where('expires_at', '!=', Invite::ENROLLMENT_NEVER_EXPIRES)
                ->whereNull('redeemed_at')
                ->first()
        );
    }

    public function test_enrollment_then_dashboard_admin_invite_succeeds(): void
    {
        $email = 'dual-admin@example.test';
        $this->createEnrollment($email);

        $response = $this->withAuth()->postJson('/api/org/invites', [
            'email' => $email,
            'role' => 'admin',
            'send_email' => false,
            'expires_hours' => 168,
        ]);

        $response->assertStatus(200);
        $this->assertEquals('admin', $response->json('invite.role'));
        $this->assertEquals(2, Invite::where('email', $email)->count());
    }

    public function test_dashboard_user_then_developer_enrollment_succeeds(): void
    {
        $email = 'existing-dash@example.test';

        // Existing dashboard user in the org
        User::create([
            'name' => 'Dashboard User',
            'email' => $email,
            'password' => bcrypt('password'),
            'organization_id' => $this->organization->id,
            'role' => 'member',
        ]);

        $response = $this->withAuth()->postJson('/api/org/invites', [
            'role' => 'member',
            'email' => $email,
            'send_email' => false,
            'purpose' => 'developer_enrollment',
        ]);

        $response->assertStatus(200);
        $this->assertNotNull(
            Invite::where('email', $email)
                ->where('expires_at', Invite::ENROLLMENT_NEVER_EXPIRES)
                ->first()
        );
    }

    public function test_duplicate_dashboard_invite_still_blocked(): void
    {
        $email = 'dup-dash@example.test';

        $this->withAuth()->postJson('/api/org/invites', [
            'email' => $email,
            'role' => 'member',
            'send_email' => false,
            'expires_hours' => 24,
        ])->assertStatus(200);

        $this->withAuth()->postJson('/api/org/invites', [
            'email' => $email,
            'role' => 'admin',
            'send_email' => false,
            'expires_hours' => 24,
        ])->assertStatus(422);

        $this->assertEquals(1, Invite::where('email', $email)->count());
    }

    public function test_duplicate_developer_enrollment_still_blocked(): void
    {
        $email = 'dup-enroll@example.test';
        $this->createEnrollment($email);

        $response = $this->withAuth()->postJson('/api/org/invites', [
            'role' => 'member',
            'email' => $email,
            'send_email' => false,
            'purpose' => 'developer_enrollment',
        ]);

        $response->assertStatus(422);
        $this->assertEquals(1, Invite::where('email', $email)->count());
    }

    public function test_dashboard_invite_for_existing_dashboard_user_still_blocked(): void
    {
        $email = 'active-dash@example.test';

        User::create([
            'name' => 'Active Dashboard User',
            'email' => $email,
            'password' => bcrypt('password'),
            'organization_id' => $this->organization->id,
            'role' => 'member',
        ]);

        $this->withAuth()->postJson('/api/org/invites', [
            'email' => $email,
            'role' => 'admin',
            'send_email' => false,
            'expires_hours' => 24,
        ])->assertStatus(422);
    }

    public function test_dashboard_invite_redeem_creates_user_enrollment_intact(): void
    {
        $email = 'redeem-dual@example.test';
        $enrollment = $this->createEnrollment($email);
        $code = IDEConnectCode::issueForInvite($enrollment, $this->admin->id);

        $dash = $this->withAuth()->postJson('/api/org/invites', [
            'email' => $email,
            'role' => 'admin',
            'send_email' => false,
            'expires_hours' => 24,
        ])->assertStatus(200)->json('invite');

        // Redeem the dashboard invite → dashboard user created
        $this->postJson('/api/invites/' . $dash['token'] . '/accept', [
            'name' => 'Dual Role User',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ])->assertStatus(200);

        $user = User::where('email', $email)->first();
        $this->assertNotNull($user);
        $this->assertEquals('admin', $user->role);

        // Enrollment invite + connect code still pending and usable
        $enrollment->refresh();
        $this->assertNull($enrollment->redeemed_at);
        $this->assertEquals(
            Invite::ENROLLMENT_NEVER_EXPIRES,
            $enrollment->expires_at->toDateTimeString()
        );
        $this->assertEquals(
            $code->code,
            IDEConnectCode::where('invite_id', $enrollment->id)->first()->code
        );
    }

    public function test_connect_code_survives_dashboard_invite_creation(): void
    {
        $email = 'code-survives@example.test';
        $enrollment = $this->createEnrollment($email);

        $code = IDEConnectCode::issueForInvite($enrollment, $this->admin->id);
        $rawCode = $code->code;

        $this->withAuth()->postJson('/api/org/invites', [
            'email' => $email,
            'role' => 'admin',
            'send_email' => false,
            'expires_hours' => 168,
        ])->assertStatus(200);

        // Enrollment invite and its connect code untouched
        $enrollment->refresh();
        $this->assertEquals(Invite::ENROLLMENT_NEVER_EXPIRES, $enrollment->expires_at->toDateTimeString());
        $this->assertNull($enrollment->redeemed_at);
        $this->assertEquals($rawCode, IDEConnectCode::where('invite_id', $enrollment->id)->first()->code);
    }

    public function test_cross_org_enrollment_does_not_block_dashboard_invite(): void
    {
        $email = 'cross-org@example.test';

        // Enrollment in a DIFFERENT org
        $otherOrg = Organization::create([
            'name' => 'Other Org',
            'slug' => 'other-' . Str::random(6),
        ]);
        Invite::create([
            'organization_id' => $otherOrg->id,
            'email' => $email,
            'role' => 'member',
            'expires_at' => Invite::enrollmentNeverExpires(),
        ]);

        $response = $this->withAuth()->postJson('/api/org/invites', [
            'email' => $email,
            'role' => 'member',
            'send_email' => false,
            'expires_hours' => 24,
        ]);

        $response->assertStatus(200);
    }

    public function test_resend_targets_dashboard_invite_not_enrollment(): void
    {
        $email = 'resend-scope@example.test';
        $enrollment = $this->createEnrollment($email);
        $enrollmentToken = $enrollment->token;

        $dash = $this->withAuth()->postJson('/api/org/invites', [
            'email' => $email,
            'role' => 'member',
            'send_email' => false,
            'expires_hours' => 24,
        ])->assertStatus(200)->json('invite');

        $this->withAuth()->postJson('/api/org/invites/resend', [
            'email' => $email,
            'role' => 'member',
        ])->assertStatus(200);

        // The dashboard invite was rotated; the enrollment row is untouched.
        $enrollment->refresh();
        $this->assertEquals($enrollmentToken, $enrollment->token);
        $this->assertEquals(
            Invite::ENROLLMENT_NEVER_EXPIRES,
            $enrollment->expires_at->toDateTimeString()
        );
        $this->assertNotEquals(
            $dash['token'],
            Invite::where('id', $dash['id'])->first()->token
        );
    }

    public function test_bulk_email_enrolls_existing_dashboard_user(): void
    {
        $email = 'bulk-dash-user@example.test';

        User::create([
            'name' => 'Bulk Dash User',
            'email' => $email,
            'password' => bcrypt('password'),
            'organization_id' => $this->organization->id,
            'role' => 'member',
        ]);

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$email],
            'role' => 'member',
            'delivery_mode' => 'email',
        ]);

        $response->assertStatus(200);
        $this->assertEquals('sent', $response->json('results.0.status'));
        $this->assertNotNull(
            Invite::where('email', $email)
                ->where('expires_at', Invite::ENROLLMENT_NEVER_EXPIRES)
                ->first()
        );
    }

    public function test_bulk_does_not_convert_pending_dashboard_invite(): void
    {
        $email = 'bulk-dash-pending@example.test';

        $dash = $this->withAuth()->postJson('/api/org/invites', [
            'email' => $email,
            'role' => 'member',
            'send_email' => false,
            'expires_hours' => 24,
        ])->assertStatus(200)->json('invite');

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$email],
            'role' => 'member',
            'delivery_mode' => 'email',
        ]);

        $response->assertStatus(200);
        $this->assertEquals('sent', $response->json('results.0.status'));

        // Dashboard invite untouched; a separate enrollment invite created.
        $dashRow = Invite::find($dash['id']);
        $this->assertNotEquals(
            Invite::ENROLLMENT_NEVER_EXPIRES,
            $dashRow->expires_at->toDateTimeString()
        );
        $this->assertEquals($dash['token'], $dashRow->token);
        $this->assertEquals(2, Invite::where('email', $email)->count());
    }

    public function test_bulk_reuses_pending_enrollment(): void
    {
        $email = 'bulk-reuse@example.test';
        $enrollment = $this->createEnrollment($email);

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$email],
            'role' => 'member',
            'delivery_mode' => 'email',
        ]);

        $response->assertStatus(200);
        $this->assertEquals('reused', $response->json('results.0.status'));
        $this->assertEquals($enrollment->id, $response->json('results.0.invite_id'));
        $this->assertEquals(1, Invite::where('email', $email)->count());
    }
}
