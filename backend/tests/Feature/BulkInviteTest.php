<?php

namespace Tests\Feature;

use App\Mail\BulkInviteEmail;
use App\Models\ApiToken;
use App\Models\IDEConnectCode;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class BulkInviteTest extends TestCase
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
            'name' => 'Bulk Test Org',
            'slug' => 'bulk-test-' . Str::random(6),
        ]);

        $this->admin = User::create([
            'name' => 'Bulk Admin',
            'email' => 'admin-' . Str::random(8) . '@bulk.test',
            'password' => bcrypt('password'),
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->tokenRaw = 'bulk-token-' . Str::random(32);
        ApiToken::create([
            'token' => hash('sha256', $this->tokenRaw),
            'user_id' => $this->admin->id,
            'organization_id' => $this->organization->id,
            'expires_at' => now()->addDays(1),
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow(null);

        if (app()->environment('testing')
            && config('database.default') === 'sqlite'
            && config('database.connections.sqlite.database') === ':memory:'
        ) {
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
    }

    private function withAuth(): self
    {
        return $this->withHeaders([
            'Authorization' => 'Bearer ' . $this->tokenRaw,
        ]);
    }

    private function assertBulkInviteEmailSent(string $email, string $organizationName, string $token): void
    {
        Mail::assertSent(BulkInviteEmail::class, function ($mail) use ($email, $organizationName, $token) {
            $html = $mail->render();

            $hasCorrectRecipient = $mail->recipientEmail === $email;
            $hasOrg = $mail->organizationName === $organizationName;
            $hasNoDashboard = str_contains($html, 'No dashboard account is required');
            $hasInviteUrl = str_contains($html, '/invite/' . $token);
            $hasVersion = str_contains($html, 'ChaosMonkey 0.4.0');
            $hasEditors = str_contains($html, 'VS Code')
                && str_contains($html, 'Cursor')
                && str_contains($html, 'Devin');
            $noAcceptInvite = !str_contains($html, '/accept-invite/');
            $noPassword = !str_contains(strtolower($html), 'password');
            $noLegacyAuth = !str_contains(strtolower($html), 'auth token');

            return $hasCorrectRecipient
                && $hasOrg
                && $hasNoDashboard
                && $hasInviteUrl
                && $hasVersion
                && $hasEditors
                && $noAcceptInvite
                && $noPassword
                && $noLegacyAuth;
        });
    }

    public function test_bulk_creates_three_distinct_invites_with_connect_codes(): void
    {
        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [
                'alpha@example.com',
                'bravo@example.com',
                'charlie@example.com',
            ],
        ]);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertEquals(3, $body['summary']['requested']);
        $this->assertEquals(3, $body['summary']['sent']);
        $this->assertEquals(0, $body['summary']['reused']);
        $this->assertEquals(0, $body['summary']['skipped_active']);
        $this->assertEquals(0, $body['summary']['failed']);
        $this->assertCount(3, $body['results']);

        $ids = array_map(fn ($r) => $r['invite_id'], $body['results']);
        $this->assertCount(3, array_unique($ids));

        foreach ($ids as $id) {
            $this->assertNotNull(IDEConnectCode::where('invite_id', $id)->first());
        }

        foreach (['alpha@example.com', 'bravo@example.com', 'charlie@example.com'] as $em) {
            $token = Invite::where('email', $em)->first()->token;
            $this->assertBulkInviteEmailSent($em, 'Bulk Test Org', $token);
        }
    }

    public function test_bulk_dedupes_input(): void
    {
        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [
                'alpha@example.com',
                'Alpha@example.com ',
                'bravo@example.com',
            ],
        ]);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertEquals(3, $body['summary']['requested']);
        $this->assertEquals(2, $body['summary']['sent']);
        $this->assertCount(2, $body['results']);

        foreach (['alpha@example.com', 'bravo@example.com'] as $em) {
            $token = Invite::where('email', $em)->first()->token;
            $this->assertBulkInviteEmailSent($em, 'Bulk Test Org', $token);
        }
    }

    public function test_bulk_reuses_existing_pending_enrollment_invite(): void
    {
        $email = 'reused@example.com';

        // Reuse applies to pending developer enrollments (sentinel expiry).
        // A pending dashboard invite is a separate capability and is not
        // consumed by bulk enrollment.
        $existingInvite = Invite::create([
            'organization_id' => $this->organization->id,
            'email' => $email,
            'expires_at' => Invite::enrollmentNeverExpires(),
        ]);

        $oldToken = $existingInvite->token;

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$email],
        ]);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertEquals(1, $body['summary']['reused']);
        $this->assertEquals(0, $body['summary']['sent']);
        $this->assertEquals($existingInvite->id, $body['results'][0]['invite_id']);

        $refreshed = Invite::find($existingInvite->id);
        $this->assertNotEquals($oldToken, $refreshed->token);
        $this->assertEquals(1, Invite::where('email', $email)->where('organization_id', $this->organization->id)->count());
        $this->assertBulkInviteEmailSent($email, 'Bulk Test Org', $refreshed->token);
    }

    public function test_bulk_enrolls_active_organization_member(): void
    {
        // Dashboard users can still receive a developer enrollment — the two
        // capabilities are independent.
        $email = 'active@example.com';

        User::create([
            'name' => 'Active Developer',
            'email' => $email,
            'password' => bcrypt('password'),
            'organization_id' => $this->organization->id,
            'role' => 'member',
        ]);

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$email, 'other@example.com'],
        ]);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertEquals(0, $body['summary']['skipped_active']);
        $this->assertEquals(2, $body['summary']['sent']);
        $this->assertEquals('sent', $body['results'][0]['status']);
        $this->assertEquals('sent', $body['results'][1]['status']);

        $enrollment = Invite::where('email', $email)->first();
        $this->assertNotNull($enrollment);
        $this->assertEquals(
            Invite::ENROLLMENT_NEVER_EXPIRES,
            $enrollment->expires_at->toDateTimeString()
        );

        $token = Invite::where('email', 'other@example.com')->first()->token;
        $this->assertBulkInviteEmailSent('other@example.com', 'Bulk Test Org', $token);
    }

    public function test_bulk_cross_organization_reuse_impossible(): void
    {
        $email = 'cross@example.com';

        $otherOrg = Organization::create([
            'name' => 'Other Org',
            'slug' => 'other-org-' . Str::random(6),
        ]);

        DB::table('invites')->insert([
            'organization_id' => $otherOrg->id,
            'token' => bin2hex(random_bytes(16)),
            'email' => $email,
            'role' => 'member',
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$email],
        ]);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertEquals(1, $body['summary']['sent']);
        $this->assertEquals($this->organization->id, $body['results'][0]['invite_id'] ? Invite::find($body['results'][0]['invite_id'])->organization_id : null);
    }

    public function test_bulk_rejects_over_50_unique_emails(): void
    {
        $emails = [];
        for ($i = 1; $i <= 51; $i++) {
            $emails[] = "dev{$i}@example.com";
        }

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => $emails,
        ]);

        $response->assertStatus(422);
    }

    public function test_bulk_partial_failure_for_malformed_email(): void
    {
        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [
                'valid1@example.com',
                'not-an-email',
                'valid2@example.com',
            ],
        ]);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertEquals(3, $body['summary']['requested']);
        $this->assertEquals(2, $body['summary']['sent']);
        $this->assertEquals(1, $body['summary']['failed']);
        $this->assertCount(3, $body['results']);

        foreach (['valid1@example.com', 'valid2@example.com'] as $em) {
            $token = Invite::where('email', $em)->first()->token;
            $this->assertBulkInviteEmailSent($em, 'Bulk Test Org', $token);
        }
    }

    public function test_existing_single_invite_endpoint_still_works(): void
    {
        $response = $this->withAuth()->postJson('/api/org/invites', [
            'email' => 'single@example.com',
        ]);

        $response->assertStatus(200);
        $this->assertEquals('single@example.com', $response->json('invite.email'));
    }

    public function test_bulk_shared_link_creates_invites_and_codes(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [
                'shared1@example.com',
                'shared2@example.com',
            ],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertEquals('shared_link', $body['delivery_mode']);
        $this->assertArrayHasKey('rollout_url', $body);
        $this->assertStringContainsString('/enroll/', $body['rollout_url']);
        $this->assertArrayNotHasKey('results', $body);

        $this->assertEquals(2, $body['summary']['created']);
        $this->assertEquals(0, $body['summary']['reused']);
        $this->assertEquals(0, $body['summary']['skipped']);
        $this->assertEquals(0, $body['summary']['failed']);

        foreach (['shared1@example.com', 'shared2@example.com'] as $em) {
            $invite = Invite::where('email', $em)->first();
            $this->assertNotNull($invite);
            $this->assertNotNull(IDEConnectCode::where('invite_id', $invite->id)->first());
        }

        Mail::assertNothingSent();
    }

    public function test_bulk_shared_link_reuses_existing_pending_invite(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        $email = 'shared-reuse@example.com';

        $existingInvite = Invite::create([
            'organization_id' => $this->organization->id,
            'email' => $email,
            'expires_at' => Invite::enrollmentNeverExpires(),
        ]);

        $oldToken = $existingInvite->token;

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$email],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertEquals(0, $body['summary']['created']);
        $this->assertEquals(1, $body['summary']['reused']);
        $this->assertEquals($existingInvite->id, Invite::where('email', $email)->first()->id);
        $this->assertNotEquals($oldToken, Invite::where('email', $email)->first()->token);

        Mail::assertNothingSent();
    }

    public function test_bulk_shared_link_response_excludes_email_list_and_codes(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => ['leak1@example.com', 'leak2@example.com'],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertArrayNotHasKey('emails', $body);
        $this->assertArrayNotHasKey('results', $body);
        $this->assertArrayNotHasKey('connect_code', $body);
        $this->assertArrayNotHasKey('bearer', $body);
        $this->assertArrayNotHasKey('installation_token', $body);
        $this->assertArrayNotHasKey('token', $body);
    }

    public function test_bulk_shared_link_enrolls_active_member(): void
    {
        // A dashboard user may still need a developer enrollment — shared-link
        // bulk enrollment creates one instead of skipping.
        $email = 'active-member@example.com';

        User::create([
            'name' => 'Active Member',
            'email' => $email,
            'password' => bcrypt('password'),
            'organization_id' => $this->organization->id,
            'role' => 'member',
        ]);

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$email],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $this->assertArrayHasKey('rollout_url', $response->json());
        $this->assertEquals(0, $response->json('summary.skipped'));
        $this->assertEquals(1, $response->json('summary.created'));
        $this->assertEquals(0, $response->json('summary.reused'));

        $enrollment = Invite::where('email', $email)->first();
        $this->assertNotNull($enrollment);
        $this->assertEquals(
            Invite::ENROLLMENT_NEVER_EXPIRES,
            $enrollment->expires_at->toDateTimeString()
        );

        Mail::assertNothingSent();
    }

    public function test_bulk_shared_link_per_email_database_failure_rolls_back(): void
    {
        Schema::dropIfExists('ide_connect_codes');

        $email = 'valid-but-fails@example.com';

        $invitesBefore = Invite::count();

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$email],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(500);
        $this->assertArrayNotHasKey('rollout_url', $response->json());
        $this->assertEquals('Failed to generate shared rollout', $response->json('error'));
        $this->assertEquals($invitesBefore, Invite::count());

        Mail::assertNothingSent();
    }

    public function test_bulk_shared_link_mixed_valid_and_invalid_emails(): void
    {
        // Valid emails enroll (existing dashboard users included); invalid
        // entries are reported as failed without aborting the batch.
        $email = 'mixed-active@example.com';

        User::create([
            'name' => 'Mixed Active',
            'email' => $email,
            'password' => bcrypt('password'),
            'organization_id' => $this->organization->id,
            'role' => 'member',
        ]);

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$email, 'not-an-email'],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $this->assertArrayHasKey('rollout_url', $response->json());
        $this->assertEquals(0, $response->json('summary.skipped'));
        $this->assertEquals(1, $response->json('summary.failed'));
        $this->assertEquals(1, $response->json('summary.created'));
        $this->assertEquals(0, $response->json('summary.reused'));
    }

    public function test_bulk_shared_link_reuses_case_variant_pending_invite(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        $email = 'REUSE-CASE@example.com';
        $existingInvite = Invite::create([
            'organization_id' => $this->organization->id,
            'email' => $email,
            'expires_at' => Invite::enrollmentNeverExpires(),
        ]);

        $oldToken = $existingInvite->token;
        $oldExpires = $existingInvite->expires_at->toDateTimeString();
        $oldUpdated = $existingInvite->updated_at->toDateTimeString();

        $invitesBefore = Invite::count();
        $codesBefore = IDEConnectCode::count();

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [strtolower($email)],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertEquals(0, $body['summary']['created']);
        $this->assertEquals(1, $body['summary']['reused']);
        $this->assertEquals(0, $body['summary']['skipped']);
        $this->assertEquals(0, $body['summary']['failed']);
        $this->assertArrayHasKey('rollout_url', $body);
        $this->assertStringContainsString('/enroll/', $body['rollout_url']);
        $this->assertEquals($invitesBefore, Invite::count());
        $this->assertEquals(1, IDEConnectCode::where('invite_id', $existingInvite->id)->count());
        $this->assertEquals(1, Invite::where('organization_id', $this->organization->id)->whereRaw('LOWER(email) = ?', [strtolower($email)])->count());

        $refreshed = Invite::find($existingInvite->id);
        $this->assertNotEquals($oldToken, $refreshed->token);
        $this->assertTrue($refreshed->expires_at->isFuture());
        Mail::assertNothingSent();
    }

    public function test_bulk_shared_link_enrolls_active_member_case_insensitive(): void
    {
        $email = 'ActiveCase@example.com';
        User::create([
            'name' => 'Active Case',
            'email' => $email,
            'password' => bcrypt('password'),
            'organization_id' => $this->organization->id,
            'role' => 'member',
        ]);

        $invitesBefore = Invite::count();
        $codesBefore = IDEConnectCode::count();

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [strtolower($email)],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $this->assertEquals(0, $response->json('summary.skipped'));
        $this->assertEquals(1, $response->json('summary.created'));
        $this->assertEquals(0, $response->json('summary.reused'));
        $this->assertArrayHasKey('rollout_url', $response->json());
        $this->assertEquals($invitesBefore + 1, Invite::count());
        $this->assertEquals($codesBefore + 1, IDEConnectCode::count());
        Mail::assertNothingSent();
    }

    public function test_bulk_shared_link_rollback_on_encryption_failure(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        $existingEmail = 'existing-fail@example.com';
        $newEmail = 'new-fail@example.com';

        $existingInvite = Invite::create([
            'organization_id' => $this->organization->id,
            'email' => $existingEmail,
            'expires_at' => now()->addDay(),
        ]);

        $oldToken = $existingInvite->token;
        $oldExpires = $existingInvite->expires_at->toDateTimeString();
        $oldUpdated = $existingInvite->updated_at->toDateTimeString();

        $invitesBefore = Invite::count();
        $codesBefore = IDEConnectCode::count();

        config(['app.key' => '']);
        app()->forgetInstance('encrypter');

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$existingEmail, $newEmail],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(500);
        $body = $response->json();
        $this->assertEquals('Failed to generate shared rollout', $body['error']);
        $this->assertArrayNotHasKey('rollout_url', $body);
        $this->assertArrayNotHasKey('trace', $body);
        $this->assertArrayNotHasKey('exception', $body);
        $this->assertEquals($invitesBefore, Invite::count());
        $this->assertEquals($codesBefore, IDEConnectCode::count());

        $refreshed = Invite::find($existingInvite->id);
        $this->assertEquals($oldToken, $refreshed->token);
        $this->assertEquals($oldExpires, $refreshed->expires_at->copy()->toDateTimeString());
        $this->assertEquals($oldUpdated, $refreshed->updated_at->toDateTimeString());
        Mail::assertNothingSent();
    }

    public function test_bulk_shared_link_rollback_on_mid_batch_failure(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        $first = 'first-fail@example.com';
        $second = 'second-fail@example.com';

        $invitesBefore = Invite::count();
        $codesBefore = IDEConnectCode::count();

        Event::listen('eloquent.creating: App\Models\IDEConnectCode', function () {
            if (IDEConnectCode::count() >= 1) {
                throw new \RuntimeException('forced mid-batch failure');
            }
        });

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$first, $second],
            'delivery_mode' => 'shared_link',
        ]);

        Event::forget('eloquent.creating: App\Models\IDEConnectCode');

        $response->assertStatus(500);
        $this->assertEquals('Failed to generate shared rollout', $response->json('error'));
        $this->assertEquals($invitesBefore, Invite::count());
        $this->assertEquals($codesBefore, IDEConnectCode::count());
        $this->assertNull(Invite::where('email', $first)->first());
        $this->assertNull(Invite::where('email', $second)->first());
        Mail::assertNothingSent();
    }

    public function test_bulk_shared_link_two_developer_batch_can_claim_each(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        $existing = 'EXISTING-CLAIM@example.com';
        $new = 'new-claim@example.com';

        Invite::create([
            'organization_id' => $this->organization->id,
            'email' => $existing,
            'expires_at' => Invite::enrollmentNeverExpires(),
        ]);

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [strtolower($existing), $new],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $body = $response->json();
        $this->assertEquals(1, $body['summary']['reused']);
        $this->assertEquals(1, $body['summary']['created']);
        $this->assertEquals(0, $body['summary']['skipped']);
        $this->assertArrayHasKey('rollout_url', $body);

        $url = $body['rollout_url'];
        $token = explode('/enroll/', $url)[1];

        $firstResponse = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => strtolower($existing),
        ]);
        $firstResponse->assertStatus(200);
        $this->assertEquals(strtolower($existing), strtolower($firstResponse->json('invite.email')));
        $this->assertNotEmpty($firstResponse->json('setup.connect_code'));

        $secondResponse = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => $new,
        ]);
        $secondResponse->assertStatus(200);
        $this->assertEquals($new, $secondResponse->json('invite.email'));
        $this->assertNotEmpty($secondResponse->json('setup.connect_code'));
        $this->assertNotEquals(
            $firstResponse->json('setup.connect_code'),
            $secondResponse->json('setup.connect_code')
        );
        Mail::assertNothingSent();
    }

    private function sentinel(): Carbon
    {
        return Carbon::create(2099, 12, 31, 23, 59, 59, 'UTC');
    }

    public function test_bulk_shared_link_new_invite_expires_at_pilot_sentinel(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        $fixed = Carbon::parse('2026-08-05 12:00:00');
        Carbon::setTestNow($fixed);

        $email = 'new-sentinel@example.com';

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$email],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $invite = Invite::where('email', $email)->first();
        $this->assertNotNull($invite);
        $this->assertEquals($this->sentinel()->toDateTimeString(), $invite->expires_at->toDateTimeString());
        Mail::assertNothingSent();
    }

    public function test_bulk_shared_link_reused_invite_expires_at_pilot_sentinel(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        $fixed = Carbon::parse('2026-08-05 12:00:00');
        Carbon::setTestNow($fixed);

        $email = 'REUSE-SENTINEL@example.com';
        $existingInvite = Invite::create([
            'organization_id' => $this->organization->id,
            'email' => $email,
            'expires_at' => Invite::enrollmentNeverExpires(),
        ]);

        $oldExpires = $existingInvite->expires_at->toDateTimeString();
        $oldToken = $existingInvite->token;

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [strtolower($email)],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $refreshed = Invite::find($existingInvite->id);
        $this->assertEquals($this->sentinel()->toDateTimeString(), $refreshed->expires_at->toDateTimeString());
        $this->assertNotEquals($oldToken, $refreshed->token);
        Mail::assertNothingSent();
    }

    public function test_bulk_shared_link_connect_code_expires_at_pilot_sentinel(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        Carbon::setTestNow(Carbon::parse('2026-08-05 12:00:00'));

        $email = 'code-sentinel@example.com';

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$email],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $invite = Invite::where('email', $email)->first();
        $code = IDEConnectCode::where('invite_id', $invite->id)->first();
        $this->assertNotNull($code);
        $this->assertEquals($this->sentinel()->toDateTimeString(), $code->expires_at->toDateTimeString());
        Mail::assertNothingSent();
    }

    public function test_bulk_shared_link_reused_connect_code_extended_to_pilot_sentinel(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        $fixed = Carbon::parse('2026-08-05 12:00:00');
        Carbon::setTestNow($fixed);

        $email = 'CODE-REUSE@example.com';
        $existingInvite = Invite::create([
            'organization_id' => $this->organization->id,
            'email' => $email,
            'expires_at' => Invite::enrollmentNeverExpires(),
        ]);

        $shortCode = IDEConnectCode::create([
            'user_id' => $this->admin->id,
            'organization_id' => $this->organization->id,
            'invite_id' => $existingInvite->id,
            'expires_at' => now()->addDay(),
        ]);

        $oldExpires = $shortCode->expires_at->toDateTimeString();

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [strtolower($email)],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $refreshed = IDEConnectCode::find($shortCode->id);
        $this->assertNotEquals($oldExpires, $refreshed->expires_at->toDateTimeString());
        $this->assertEquals($this->sentinel()->toDateTimeString(), $refreshed->expires_at->toDateTimeString());
        Mail::assertNothingSent();
    }

    public function test_bulk_shared_link_claim_after_30_days(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        $fixed = Carbon::parse('2026-08-05 12:00:00');
        Carbon::setTestNow($fixed);

        $email = 'claim-30d@example.com';

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$email],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $token = explode('/enroll/', $response->json('rollout_url'))[1];

        Carbon::setTestNow($fixed->copy()->addDays(30));

        $claim = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => $email,
        ]);

        $claim->assertStatus(200);
        $this->assertNotEmpty($claim->json('setup.connect_code'));
        Mail::assertNothingSent();
    }

    public function test_bulk_shared_link_claim_after_365_days(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        $fixed = Carbon::parse('2026-08-05 12:00:00');
        Carbon::setTestNow($fixed);

        $email = 'claim-365d@example.com';

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$email],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $token = explode('/enroll/', $response->json('rollout_url'))[1];

        Carbon::setTestNow($fixed->copy()->addDays(365));

        $claim = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => $email,
        ]);

        $claim->assertStatus(200);
        $this->assertNotEmpty($claim->json('setup.connect_code'));
        Mail::assertNothingSent();
    }

    public function test_bulk_shared_link_claim_unrelated_email_rejected(): void
    {
        config(['app.frontend_url' => 'http://test.test:5174']);

        Carbon::setTestNow(Carbon::parse('2026-08-05 12:00:00'));

        $in = 'inside@example.com';
        $out = 'outside@example.com';

        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => [$in],
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $token = explode('/enroll/', $response->json('rollout_url'))[1];

        $claim = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => $out,
        ]);

        $claim->assertStatus(400);
        $this->assertEquals('Invalid or expired rollout link.', $claim->json('error'));
        Mail::assertNothingSent();
    }
}
