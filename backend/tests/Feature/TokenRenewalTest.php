<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\ApiToken;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use App\Models\IDEConnectCode;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;

/**
 * P0-G Part A & B: Backend token renewal endpoint tests.
 *
 * Exercises the renewal endpoint against the ephemeral test DB only.
 * No protected databases are touched.
 */
class TokenRenewalTest extends TestCase
{
    use RefreshDatabase;

    private function createInstallationToken(Organization $org, Invite $invite, string $installationId, ?int $expiresDays = 90): array
    {
        $user = User::factory()->create(['organization_id' => $org->id]);
        $raw = \Illuminate\Support\Str::random(64);
        $token = ApiToken::create([
            'token' => hash('sha256', $raw),
            'user_id' => $user->id,
            'organization_id' => $org->id,
            'invite_id' => $invite->id,
            'installation_id' => $installationId,
            'expires_at' => now()->addDays($expiresDays),
        ]);

        return ['raw' => $raw, 'token' => $token];
    }

    private function createDashboardToken(User $user, Organization $org): array
    {
        $raw = \Illuminate\Support\Str::random(64);
        $token = ApiToken::create([
            'token' => hash('sha256', $raw),
            'user_id' => $user->id,
            'organization_id' => $org->id,
            'invite_id' => null,
            'installation_id' => null,
            'expires_at' => null,
        ]);

        return ['raw' => $raw, 'token' => $token];
    }

    public function test_renewal_extends_expires_at_for_valid_installation_token(): void
    {
        $org = Organization::factory()->create();
        $invite = Invite::factory()->create(['organization_id' => $org->id]);
        $pair = $this->createInstallationToken($org, $invite, '550e8400-e29b-41d4-a716-446655440000', expiresDays: 5);

        $originalExpiry = $pair['token']->expires_at;
        $response = $this->withToken($pair['raw'])->postJson('/api/ide/connect/renew');

        $response->assertStatus(200);
        $response->assertJson(['renewed' => true]);
        $newExpiry = \Illuminate\Support\Carbon::parse($response->json('expires_at'));
        $this->assertGreaterThan($originalExpiry, $newExpiry);
        $this->assertGreaterThan(now()->addDays(89), $newExpiry);
    }

    public function test_renewal_is_idempotent_when_token_has_plenty_of_lifetime(): void
    {
        $org = Organization::factory()->create();
        $invite = Invite::factory()->create(['organization_id' => $org->id]);
        $pair = $this->createInstallationToken($org, $invite, '550e8400-e29b-41d4-a716-446655440001', expiresDays: 90);

        $originalExpiry = $pair['token']->expires_at;
        $response = $this->withToken($pair['raw'])->postJson('/api/ide/connect/renew');

        $response->assertStatus(200);
        $response->assertJson(['renewed' => false]);
        $this->assertEquals($originalExpiry->toISOString(), $response->json('expires_at'));
    }

    public function test_renewal_rejects_dashboard_token(): void
    {
        $org = Organization::factory()->create();
        $user = User::factory()->create();
        $pair = $this->createDashboardToken($user, $org);

        $response = $this->withToken($pair['raw'])->postJson('/api/ide/connect/renew');

        $response->assertStatus(403);
        $response->assertJson(['error_code' => 'NOT_INSTALLATION_TOKEN']);
    }

    public function test_renewal_requires_authentication(): void
    {
        $response = $this->postJson('/api/ide/connect/renew');
        $response->assertStatus(401);
    }

    public function test_renewal_rejects_expired_token(): void
    {
        $org = Organization::factory()->create();
        $invite = Invite::factory()->create(['organization_id' => $org->id]);
        $pair = $this->createInstallationToken($org, $invite, '550e8400-e29b-41d4-a716-446655440002', expiresDays: -1);

        $response = $this->withToken($pair['raw'])->postJson('/api/ide/connect/renew');

        // Expired tokens are rejected by SimpleTokenAuth before reaching the controller
        $response->assertStatus(401);
    }

    public function test_renewal_rejects_revoked_token(): void
    {
        $org = Organization::factory()->create();
        $invite = Invite::factory()->create(['organization_id' => $org->id]);
        $pair = $this->createInstallationToken($org, $invite, '550e8400-e29b-41d4-a716-446655440003', expiresDays: 5);
        $pair['token']->revoke();

        $response = $this->withToken($pair['raw'])->postJson('/api/ide/connect/renew');

        $response->assertStatus(401);
    }

    public function test_renewal_preserves_token_secret(): void
    {
        $org = Organization::factory()->create();
        $invite = Invite::factory()->create(['organization_id' => $org->id]);
        $pair = $this->createInstallationToken($org, $invite, '550e8400-e29b-41d4-a716-446655440004', expiresDays: 5);

        $originalHash = $pair['token']->token;
        $this->withToken($pair['raw'])->postJson('/api/ide/connect/renew');

        $pair['token']->refresh();
        $this->assertEquals($originalHash, $pair['token']->token);
    }

    public function test_renewal_preserves_organization_and_installation_identity(): void
    {
        $org = Organization::factory()->create();
        $invite = Invite::factory()->create(['organization_id' => $org->id]);
        $installationId = '550e8400-e29b-41d4-a716-446655440005';
        $pair = $this->createInstallationToken($org, $invite, $installationId, expiresDays: 5);

        $response = $this->withToken($pair['raw'])->postJson('/api/ide/connect/renew');

        $response->assertStatus(200);
        $response->assertJson([
            'installation_id' => $installationId,
            'organization_id' => $org->id,
        ]);
    }
}
