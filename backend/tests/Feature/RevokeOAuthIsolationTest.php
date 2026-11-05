<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use App\Models\User;
use App\Models\Organization;
use App\Models\ApiToken;
use Tests\TestCase;

class RevokeOAuthIsolationTest extends TestCase
{
    use RefreshDatabase;

    private $org;
    private $userA;
    private $userB;
    private $tokenRawA;
    private $tokenRawB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->org = Organization::create([
            'name' => 'Acme Pilot',
            'slug' => 'acme-pilot-' . Str::random(6),
        ]);

        // User A: support-style user (Matt)
        $this->userA = User::create([
            'name' => 'Matt Support',
            'email' => 'matt@test.com',
            'password' => bcrypt('password'),
            'github_id' => 41001234,
            'organization_id' => $this->org->id,
            'role' => 'admin',
        ]);

        // User B: second-tenant authority
        $this->userB = User::create([
            'name' => 'Acme Authority',
            'email' => 'acme@test.com',
            'password' => bcrypt('password'),
            'github_id' => 99999999,
            'organization_id' => $this->org->id,
            'role' => 'admin',
        ]);

        // OAuth tokens for each user
        \DB::table('oauth_tokens')->insert([
            [
                'user_id' => $this->userA->id,
                'access_token' => 'token-A-' . Str::random(32),
                'organization_id' => $this->org->id,
                'user_data' => json_encode(['login' => 'octo-user', 'id' => 41001234]),
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => $this->userB->id,
                'access_token' => 'token-B-' . Str::random(32),
                'organization_id' => $this->org->id,
                'user_data' => json_encode(['login' => 'acme-authority', 'id' => 99999999]),
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        // API tokens for each user (for SimpleTokenAuth)
        $this->tokenRawA = 'api-token-A-' . Str::random(48);
        ApiToken::create([
            'token' => hash('sha256', $this->tokenRawA),
            'user_id' => $this->userA->id,
            'organization_id' => $this->org->id,
            'expires_at' => now()->addDays(365),
        ]);

        $this->tokenRawB = 'api-token-B-' . Str::random(48);
        ApiToken::create([
            'token' => hash('sha256', $this->tokenRawB),
            'user_id' => $this->userB->id,
            'organization_id' => $this->org->id,
            'expires_at' => now()->addDays(365),
        ]);
    }

    /**
     * Authenticated User A revoke deletes only User A's OAuth token.
     * User B's OAuth token and API token remain.
     */
    public function test_authenticated_revoke_deletes_only_calling_user_oauth_token(): void
    {
        $this->assertEquals(2, \DB::table('oauth_tokens')->count());

        $response = $this->postJson('/api/github/oauth/revoke', [], [
            'X-Api-Token' => $this->tokenRawA,
        ]);

        $response->assertStatus(200);
        $response->assertJson(['success' => true]);

        // User A's OAuth token deleted
        $this->assertEquals(0, \DB::table('oauth_tokens')
            ->where('user_id', $this->userA->id)
            ->count());

        // User B's OAuth token REMAINS
        $this->assertEquals(1, \DB::table('oauth_tokens')
            ->where('user_id', $this->userB->id)
            ->count());

        // User B's API token still exists
        $this->assertEquals(1, \DB::table('api_tokens')
            ->where('user_id', $this->userB->id)
            ->count());

        // User A's API token still exists (revoke only touches oauth_tokens)
        $this->assertEquals(1, \DB::table('api_tokens')
            ->where('user_id', $this->userA->id)
            ->count());

        // Organization remains
        $this->assertDatabaseHas('organizations', ['id' => $this->org->id]);

        // Both users remain
        $this->assertDatabaseHas('users', ['id' => $this->userA->id]);
        $this->assertDatabaseHas('users', ['id' => $this->userB->id]);
    }

    /**
     * Unauthenticated revoke returns 401 and deletes nothing.
     */
    public function test_unauthenticated_revoke_returns_401_and_deletes_nothing(): void
    {
        $this->assertEquals(2, \DB::table('oauth_tokens')->count());

        $response = $this->postJson('/api/github/oauth/revoke');

        $response->assertStatus(401);

        // No OAuth tokens deleted
        $this->assertEquals(2, \DB::table('oauth_tokens')->count());

        // User A's token still exists
        $this->assertEquals(1, \DB::table('oauth_tokens')
            ->where('user_id', $this->userA->id)
            ->count());

        // User B's token still exists
        $this->assertEquals(1, \DB::table('oauth_tokens')
            ->where('user_id', $this->userB->id)
            ->count());
    }

    /**
     * Revoke response does not falsely claim session was cleared.
     */
    public function test_revoke_response_does_not_falsely_claim_session_cleared(): void
    {
        $response = $this->postJson('/api/github/oauth/revoke', [], [
            'X-Api-Token' => $this->tokenRawA,
        ]);

        $response->assertStatus(200);
        $data = $response->json();
        $this->assertArrayNotHasKey('session_cleared', $data);
        $this->assertStringNotContainsString('session cleared', $data['message'] ?? '');
    }
}
