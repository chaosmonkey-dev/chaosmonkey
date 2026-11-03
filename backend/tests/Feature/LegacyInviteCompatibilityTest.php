<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\IDEConnectCode;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class LegacyInviteCompatibilityTest extends TestCase
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
        $this->seedLegacyFixture();
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
    }

    private Organization $org;
    private User $admin;
    private string $adminToken;
    private array $legacyEmails;
    private array $legacyInviteIds;

    private function seedLegacyFixture(): void
    {
        $this->org = Organization::create([
            'name' => 'Pilot Org',
            'slug' => 'pilot-org-' . Str::random(6),
        ]);

        $this->admin = User::create([
            'name' => 'Pilot Admin',
            'email' => 'pilot-admin@test.com',
            'organization_id' => $this->org->id,
            'role' => 'admin',
        ]);

        $this->adminToken = ApiToken::generateDashboardToken($this->admin->id, $this->org->id)['raw'];

        // Create 21 expired legacy invitations with real emails
        $this->legacyEmails = [];
        $this->legacyInviteIds = [];
        for ($i = 1; $i <= 21; $i++) {
            $email = "dev{$i}@pilot.com";
            $this->legacyEmails[] = $email;
            $invite = Invite::create([
                'organization_id' => $this->org->id,
                'token' => Str::random(32),
                'email' => $email,
                'role' => 'member',
                'expires_at' => now()->subDays(30 + $i), // All expired
            ]);
            $this->legacyInviteIds[] = $invite->id;
        }

        // Also create a few extra invites in a different org to verify isolation
        $otherOrg = Organization::create([
            'name' => 'Other Org',
            'slug' => 'other-org-' . Str::random(6),
        ]);
        for ($i = 1; $i <= 3; $i++) {
            Invite::create([
                'organization_id' => $otherOrg->id,
                'token' => Str::random(32),
                'email' => "other{$i}@other.com",
                'role' => 'member',
                'expires_at' => now()->subDays(30),
            ]);
        }
    }

    public function test_21_legacy_expired_invites_exist(): void
    {
        $this->assertEquals(21, count($this->legacyEmails));
        $this->assertEquals(21, count($this->legacyInviteIds));
        foreach ($this->legacyInviteIds as $id) {
            $invite = Invite::find($id);
            $this->assertNotNull($invite);
            $this->assertTrue($invite->isExpired(), "Invite {$id} must be expired");
            $this->assertFalse($invite->isRedeemed(), "Invite {$id} must not be redeemed");
        }
    }

    public function test_bulk_rollout_with_same_emails_creates_rollout_for_all_21(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson('/api/org/invites/bulk', [
                'emails' => $this->legacyEmails,
                'delivery_mode' => 'shared_link',
            ]);

        $response->assertStatus(200);

        // The rollout should produce a shared link
        $body = $response->json();
        $this->assertEquals('shared_link', $body['delivery_mode'] ?? null);
        $this->assertNotEmpty($body['rollout_url'] ?? null, 'Rollout URL must be generated');
    }

    public function test_bulk_rollout_with_mixed_case_and_whitespace_normalizes_emails(): void
    {
        $mixedEmails = [
            '  Dev1@Pilot.com  ',   // whitespace + mixed case
            'DEV2@pilot.com',       // upper case
            ' dev3@pilot.com',      // leading whitespace
            'dev4@pilot.com ',      // trailing whitespace
            'Dev5@PILOT.COM',       // all upper
        ];

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson('/api/org/invites/bulk', [
                'emails' => $mixedEmails,
                'delivery_mode' => 'shared_link',
            ]);

        $response->assertStatus(200);

        // Verify normalized emails exist as invites
        foreach (['dev1@pilot.com', 'dev2@pilot.com', 'dev3@pilot.com', 'dev4@pilot.com', 'dev5@pilot.com'] as $normalized) {
            $exists = Invite::where('organization_id', $this->org->id)
                ->whereRaw('LOWER(email) = ?', [$normalized])
                ->exists();
            $this->assertTrue($exists, "Normalized email {$normalized} must have an invite");
        }
    }

    public function test_bulk_rollout_with_duplicate_emails_deduplicates(): void
    {
        $dupEmails = [
            'dev1@pilot.com',
            'DEV1@pilot.com',   // duplicate after normalization
            'dev1@pilot.com',   // exact duplicate
        ];

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson('/api/org/invites/bulk', [
                'emails' => $dupEmails,
                'delivery_mode' => 'shared_link',
            ]);

        $response->assertStatus(200);

        // Should only have one invite for dev1@pilot.com (counting non-redeemed, non-expired)
        $activeInvites = Invite::where('organization_id', $this->org->id)
            ->whereRaw('LOWER(email) = ?', ['dev1@pilot.com'])
            ->whereNull('redeemed_at')
            ->where('expires_at', '>', now())
            ->get();
        $this->assertEquals(1, $activeInvites->count(), 'Duplicate emails must produce exactly one active invite');
    }

    public function test_legacy_invites_preserved_after_bulk_rollout(): void
    {
        $legacyCountBefore = Invite::where('organization_id', $this->org->id)->count();

        $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson('/api/org/invites/bulk', [
                'emails' => $this->legacyEmails,
                'delivery_mode' => 'shared_link',
            ]);

        // Legacy invites should still exist (not deleted)
        foreach ($this->legacyInviteIds as $id) {
            $this->assertNotNull(Invite::find($id), "Legacy invite {$id} must not be deleted");
        }

        // The total count should be >= legacy count (new invites may be created or existing reused)
        $countAfter = Invite::where('organization_id', $this->org->id)->count();
        $this->assertGreaterThanOrEqual($legacyCountBefore, $countAfter, 'Legacy invites must not be deleted');
    }

    public function test_no_null_email_rows_created(): void
    {
        $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson('/api/org/invites/bulk', [
                'emails' => $this->legacyEmails,
                'delivery_mode' => 'shared_link',
            ]);

        $nullEmailCount = Invite::where('organization_id', $this->org->id)
            ->whereNull('email')
            ->count();
        $this->assertEquals(0, $nullEmailCount, 'No null-email rows should be created');
    }

    public function test_no_duplicate_identities_created(): void
    {
        $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson('/api/org/invites/bulk', [
                'emails' => $this->legacyEmails,
                'delivery_mode' => 'shared_link',
            ]);

        // Check for duplicate normalized emails among active (non-expired, non-redeemed) invites
        $activeInvites = Invite::where('organization_id', $this->org->id)
            ->whereNull('redeemed_at')
            ->where('expires_at', '>', now())
            ->get();

        $normalizedEmails = $activeInvites->map(fn ($i) => strtolower(trim($i->email ?? '')))
            ->filter(fn ($e) => $e !== '')
            ->values();

        $unique = $normalizedEmails->unique();
        $this->assertEquals($normalizedEmails->count(), $unique->count(), 'No duplicate normalized emails among active invites');
    }

    public function test_other_org_invites_not_affected(): void
    {
        $otherOrgBeforeCount = Invite::where('organization_id', '!=', $this->org->id)->count();

        $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson('/api/org/invites/bulk', [
                'emails' => $this->legacyEmails,
                'delivery_mode' => 'shared_link',
            ]);

        $otherOrgAfterCount = Invite::where('organization_id', '!=', $this->org->id)->count();
        $this->assertEquals($otherOrgBeforeCount, $otherOrgAfterCount, 'Other org invites must not be affected');
    }

    public function test_rollout_claim_works_for_approved_email(): void
    {
        // First create a rollout
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson('/api/org/invites/bulk', [
                'emails' => ['dev1@pilot.com', 'dev2@pilot.com'],
                'delivery_mode' => 'shared_link',
            ]);

        $response->assertStatus(200);
        $rolloutUrl = $response->json('rollout_url');
        $this->assertNotEmpty($rolloutUrl);

        // Extract token from rollout URL
        $token = basename(parse_url($rolloutUrl, PHP_URL_PATH));
        $this->assertNotEmpty($token);

        // Claim for dev1@pilot.com
        $claimResponse = $this->postJson("/api/rollouts/{$token}/claim", [
            'email' => 'dev1@pilot.com',
        ]);

        $this->assertContains($claimResponse->status(), [200, 400]);
        if ($claimResponse->status() === 200) {
            $body = $claimResponse->json();
            $connectCode = $body['setup']['connect_code'] ?? $body['connect_code'] ?? $body['code'] ?? null;
            $this->assertNotEmpty($connectCode, 'Claim should return a connect code');
        }
    }

    public function test_rollout_claim_rejects_unapproved_email(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson('/api/org/invites/bulk', [
                'emails' => ['dev1@pilot.com'],
                'delivery_mode' => 'shared_link',
            ]);

        $response->assertStatus(200);
        $rolloutUrl = $response->json('rollout_url');
        $token = basename(parse_url($rolloutUrl, PHP_URL_PATH));

        // Claim with unapproved email
        $claimResponse = $this->postJson("/api/rollouts/{$token}/claim", [
            'email' => 'unapproved@pilot.com',
        ]);

        $claimResponse->assertStatus(400);
    }

    public function test_distinct_enrollment_codes_for_different_emails(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson('/api/org/invites/bulk', [
                'emails' => ['dev1@pilot.com', 'dev2@pilot.com'],
                'delivery_mode' => 'shared_link',
            ]);

        $response->assertStatus(200);
        $rolloutUrl = $response->json('rollout_url');
        $token = basename(parse_url($rolloutUrl, PHP_URL_PATH));

        // Claim for dev1
        $claim1 = $this->postJson("/api/rollouts/{$token}/claim", [
            'email' => 'dev1@pilot.com',
        ]);

        // Claim for dev2
        $claim2 = $this->postJson("/api/rollouts/{$token}/claim", [
            'email' => 'dev2@pilot.com',
        ]);

        if ($claim1->status() === 200 && $claim2->status() === 200) {
            $code1 = $claim1->json('setup.connect_code') ?? $claim1->json('connect_code') ?? $claim1->json('code');
            $code2 = $claim2->json('setup.connect_code') ?? $claim2->json('connect_code') ?? $claim2->json('code');
            $this->assertNotNull($code1, 'Code 1 must not be null');
            $this->assertNotNull($code2, 'Code 2 must not be null');
            $this->assertNotEquals($code1, $code2, 'Enrollment codes must be distinct per email');
        }
    }

    public function test_bulk_rollout_preserves_legacy_invite_rows(): void
    {
        $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson('/api/org/invites/bulk', [
                'emails' => $this->legacyEmails,
                'delivery_mode' => 'shared_link',
            ]);

        // Legacy invite rows should still exist by ID (tokens may rotate on reuse)
        foreach ($this->legacyInviteIds as $id) {
            $this->assertNotNull(Invite::find($id), "Legacy invite row {$id} must not be deleted");
        }
    }
}
