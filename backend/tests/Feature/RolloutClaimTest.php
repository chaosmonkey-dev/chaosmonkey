<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\IDEConnectCode;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class RolloutClaimTest extends TestCase
{
    private Organization $organization;
    private User $admin;
    private string $tokenRaw;

    protected function setUp(): void
    {
        parent::setUp();

        $this->assertTrue(app()->environment('testing'), 'Refusing to run: APP_ENV is not testing');
        $this->assertEquals('sqlite', config('database.default'), 'Refusing to run: database driver is not sqlite');
        $this->assertEquals(':memory:', config('database.connections.sqlite.database'), 'Refusing to run: SQLite database is not :memory:');

        $this->createTables();

        config(['app.url' => 'http://test.test:8010']);
        config(['app.frontend_url' => 'http://test.test:5174']);

        $this->organization = Organization::create([
            'name' => 'Rollout Test Org',
            'slug' => 'rollout-test-' . Str::random(6),
        ]);

        $this->admin = User::create([
            'name' => 'Rollout Admin',
            'email' => 'admin-' . Str::random(8) . '@rollout.test',
            'password' => bcrypt('password'),
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->tokenRaw = 'rollout-token-' . Str::random(32);
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

    private function getRolloutToken(array $emails): string
    {
        $response = $this->withAuth()->postJson('/api/org/invites/bulk', [
            'emails' => $emails,
            'delivery_mode' => 'shared_link',
        ]);

        $response->assertStatus(200);
        $url = $response->json('rollout_url');
        $parts = explode('/enroll/', $url);

        return $parts[1];
    }

    private function encodeRolloutToken(array $payload): string
    {
        $encrypted = Crypt::encryptString(json_encode($payload));

        return rtrim(strtr($encrypted, '+/', '-_'), '=');
    }

    public function test_valid_claim_returns_setup_and_connect_code(): void
    {
        $email = 'claim@example.com';
        $token = $this->getRolloutToken([$email]);

        $response = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => $email,
        ]);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertArrayHasKey('invite', $body);
        $this->assertArrayHasKey('setup', $body);
        $this->assertEquals('Rollout Test Org', $body['invite']['organization_name']);
        $this->assertEquals($email, $body['invite']['email']);
        $this->assertFalse($body['invite']['is_expired']);
        $this->assertFalse($body['invite']['is_redeemed']);

        $this->assertEquals('0.4.1', $body['setup']['extension_version']);
        $this->assertEquals('http://test.test:8010', $body['setup']['api_base_url']);
        $this->assertEquals('http://test.test:8010/api/extension/download/latest', $body['setup']['vsix_download_url']);
        $this->assertNotEmpty($body['setup']['connect_code']);

        $this->assertArrayNotHasKey('token', $body['invite']);
        $this->assertEquals('member', $body['invite']['role']);
        $this->assertArrayNotHasKey('id', $body['invite']);
    }

    public function test_claim_performs_no_database_writes(): void
    {
        $email = 'nowrite@example.com';
        $token = $this->getRolloutToken([$email]);

        $invitesBefore = DB::table('invites')->count();
        $codesBefore = DB::table('ide_connect_codes')->count();

        $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => $email,
        ]);

        $this->assertEquals($invitesBefore, DB::table('invites')->count());
        $this->assertEquals($codesBefore, DB::table('ide_connect_codes')->count());
    }

    public function test_unknown_email_returns_generic_rejection(): void
    {
        $token = $this->getRolloutToken(['known@example.com']);

        $response = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => 'unknown@example.com',
        ]);

        $response->assertStatus(400);
        $this->assertEquals('Invalid or expired rollout link.', $response->json('error'));
    }

    public function test_cross_organization_email_cannot_claim(): void
    {
        $email = 'cross@example.com';
        $token = $this->getRolloutToken(['org1@example.com']);

        $otherOrg = Organization::create([
            'name' => 'Other Rollout Org',
            'slug' => 'other-rollout-' . Str::random(6),
        ]);

        Invite::create([
            'organization_id' => $otherOrg->id,
            'email' => $email,
            'expires_at' => now()->addDay(),
        ]);

        $response = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => $email,
        ]);

        $response->assertStatus(400);
        $this->assertEquals('Invalid or expired rollout link.', $response->json('error'));
    }

    public function test_expired_rollout_token_fails(): void
    {
        $token = $this->encodeRolloutToken([
            'purpose' => 'developer_rollout',
            'organization_id' => $this->organization->id,
            'invite_ids' => [1],
            'expires_at' => now()->subHour()->toISOString(),
        ]);

        $response = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => 'any@example.com',
        ]);

        $response->assertStatus(400);
        $this->assertEquals('Invalid or expired rollout link.', $response->json('error'));
    }

    public function test_malformed_rollout_token_fails(): void
    {
        $response = $this->postJson('/api/rollouts/' . bin2hex(random_bytes(16)) . '/claim', [
            'email' => 'any@example.com',
        ]);

        $response->assertStatus(400);
        $this->assertEquals('Invalid or expired rollout link.', $response->json('error'));
    }

    public function test_expired_invite_fails(): void
    {
        $email = 'expired-invite@example.com';

        Invite::create([
            'organization_id' => $this->organization->id,
            'email' => $email,
            'expires_at' => now()->subDay(),
        ]);

        $token = $this->getRolloutToken(['tokencarrier-expired@example.com']);

        $response = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => $email,
        ]);

        $response->assertStatus(400);
        $this->assertEquals('Invalid or expired rollout link.', $response->json('error'));
    }

    public function test_redeemed_invite_fails(): void
    {
        $email = 'redeemed-invite@example.com';

        Invite::create([
            'organization_id' => $this->organization->id,
            'email' => $email,
            'expires_at' => now()->addDay(),
            'redeemed_at' => now(),
        ]);

        $token = $this->getRolloutToken(['tokencarrier-redeemed@example.com']);

        $response = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => $email,
        ]);

        $response->assertStatus(400);
        $this->assertEquals('Invalid or expired rollout link.', $response->json('error'));
    }

    public function test_missing_connect_code_fails(): void
    {
        $email = 'no-code@example.com';

        $invite = Invite::create([
            'organization_id' => $this->organization->id,
            'email' => $email,
            'expires_at' => now()->addDay(),
        ]);

        $token = $this->getRolloutToken([$email]);

        // Delete the auto-issued connect codes for every invite matching this email
        // (the bulk endpoint mints its own invite, so scope by email, not invite id)
        $inviteIds = Invite::where('organization_id', $this->organization->id)
            ->whereRaw('LOWER(email) = ?', [$email])
            ->pluck('id');
        IDEConnectCode::whereIn('invite_id', $inviteIds)->delete();

        $response = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => $email,
        ]);

        $response->assertStatus(400);
        $this->assertEquals('Invalid or expired rollout link.', $response->json('error'));
    }

    public function test_approved_email_claims_only_its_own_code(): void
    {
        $first = 'first@example.com';
        $second = 'second@example.com';
        $token = $this->getRolloutToken([$first, $second]);

        $firstInvite = Invite::where('email', $first)->first();
        $firstCode = IDEConnectCode::where('invite_id', $firstInvite->id)->first()->code;

        $response = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => $first,
        ]);

        $this->assertEquals($firstCode, $response->json('setup.connect_code'));
        $this->assertEquals($first, $response->json('invite.email'));
    }

    public function test_rollout_cannot_claim_unrelated_pending_invite_in_same_org(): void
    {
        $target = 'target@example.com';
        $unrelated = 'unrelated@example.com';

        Invite::create([
            'organization_id' => $this->organization->id,
            'email' => $unrelated,
            'expires_at' => now()->addDay(),
        ]);

        $token = $this->getRolloutToken([$target]);

        $response = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => $unrelated,
        ]);

        $response->assertStatus(400);
        $this->assertEquals('Invalid or expired rollout link.', $response->json('error'));
    }

    public function test_two_emails_in_same_rollout_each_claim_own_setup(): void
    {
        $first = 'alpha-rollout@example.com';
        $second = 'bravo-rollout@example.com';
        $token = $this->getRolloutToken([$first, $second]);

        $firstCode = IDEConnectCode::where('invite_id', Invite::where('email', $first)->first()->id)->first()->code;
        $secondCode = IDEConnectCode::where('invite_id', Invite::where('email', $second)->first()->id)->first()->code;

        $firstResponse = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => $first,
        ]);

        $secondResponse = $this->postJson('/api/rollouts/' . $token . '/claim', [
            'email' => $second,
        ]);

        $this->assertEquals($first, $firstResponse->json('invite.email'));
        $this->assertEquals($firstCode, $firstResponse->json('setup.connect_code'));
        $this->assertEquals($second, $secondResponse->json('invite.email'));
        $this->assertEquals($secondCode, $secondResponse->json('setup.connect_code'));
    }
}
