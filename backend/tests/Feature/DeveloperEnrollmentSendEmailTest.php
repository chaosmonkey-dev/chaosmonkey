<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class DeveloperEnrollmentSendEmailTest extends TestCase
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
            'name' => 'Enrollment Test Org',
            'slug' => 'enrollment-test-' . Str::random(6),
        ]);

        $this->admin = User::create([
            'name' => 'Enrollment Admin',
            'email' => 'admin-' . Str::random(8) . '@enrollment.test',
            'password' => bcrypt('password'),
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->tokenRaw = 'enrollment-token-' . Str::random(32);
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

    public function test_send_email_false_stores_email_as_label_and_does_not_send_mail(): void
    {
        $email = 'alex@company.com';

        $response = $this->withAuth()->postJson('/api/org/invites', [
            'role' => 'member',
            'email' => $email,
            'send_email' => false,
            'expires_hours' => 168,
        ]);

        $response->assertStatus(200);
        $body = $response->json();

        // Email is stored as the roster label
        $this->assertEquals($email, $body['invite']['email']);

        // No mail delivery attempted
        Mail::assertNothingSent();

        // Message must not claim an email was sent
        $this->assertEquals('Developer enrollment created successfully', $body['message']);

        // Invite row persisted with the email label
        $this->assertNotNull(Invite::where('email', $email)->first());
    }

    public function test_default_send_email_true_still_sends_mail_for_backward_compatibility(): void
    {
        $email = 'bravo@company.com';

        $response = $this->withAuth()->postJson('/api/org/invites', [
            'role' => 'member',
            'email' => $email,
        ]);

        $response->assertStatus(200);
        $body = $response->json();

        // Historical callers that omit send_email get the legacy "sent" message,
        // proving the mail-delivery branch was entered (default = true).
        $this->assertEquals('Invite sent successfully', $body['message']);
        $this->assertEquals($email, $body['invite']['email']);
        $this->assertNotNull(Invite::where('email', $email)->first());
    }

    public function test_developer_enrollment_without_email_is_rejected(): void
    {
        // Pilot Ops 27: anonymous enrollments render as "Pending invitation"
        // on the Team roster forever — the supported creation path must fail
        // closed instead of producing identity-less rows.
        $response = $this->withAuth()->postJson('/api/org/invites', [
            'role' => 'member',
            'send_email' => false,
            'purpose' => 'developer_enrollment',
        ]);

        $response->assertStatus(422);
        $this->assertEquals(0, Invite::count());
    }

    public function test_developer_enrollment_with_email_creates_nonexpiring_enrollment(): void
    {
        $email = 'dev@customer.test';

        $response = $this->withAuth()->postJson('/api/org/invites', [
            'role' => 'member',
            'email' => $email,
            'send_email' => false,
            'purpose' => 'developer_enrollment',
        ]);

        $response->assertStatus(200);
        Mail::assertNothingSent();

        $invite = Invite::where('email', $email)->first();
        $this->assertNotNull($invite);
        // 18H contract: enrollment invites carry the non-expiring sentinel
        $this->assertEquals('2099-12-31 23:59:59', $invite->expires_at->format('Y-m-d H:i:s'));
        $this->assertNull($invite->redeemed_at);
    }

    public function test_non_enrollment_invite_may_still_be_email_less(): void
    {
        // Ordinary dashboard invite links remain shareable without an email —
        // only developer_enrollment requires roster identity.
        $response = $this->withAuth()->postJson('/api/org/invites', [
            'role' => 'member',
            'send_email' => false,
            'expires_hours' => 24,
        ]);

        $response->assertStatus(200);
        $this->assertEquals(1, Invite::count());
        $this->assertNull(Invite::first()->email);
    }

    public function test_duplicate_pending_email_returns_422_and_creates_no_new_row(): void
    {
        $email = 'dup@company.com';

        // First enrollment succeeds
        $first = $this->withAuth()->postJson('/api/org/invites', [
            'role' => 'member',
            'email' => $email,
            'send_email' => false,
        ]);
        $first->assertStatus(200);

        $countAfterFirst = Invite::where('email', $email)->count();
        $this->assertEquals(1, $countAfterFirst);

        // Second attempt for same email is rejected safely
        $second = $this->withAuth()->postJson('/api/org/invites', [
            'role' => 'member',
            'email' => $email,
            'send_email' => false,
        ]);

        $second->assertStatus(422);
        $this->assertEquals(1, Invite::where('email', $email)->count());
    }
}
