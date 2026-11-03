<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\ApiToken;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * CR-X Pass 2 (A) + P0: GitHub engineering-evidence truth surface tests.
 *
 * Verifies the /api/metrics response includes the five-state
 * github_engineering_evidence_state field:
 * - NOT_CONNECTED: no engineering_integration token for the org
 * - LOGIN_ONLY: (legacy, no longer produced by org-scoped resolution)
 * - PARTIAL: (legacy, no longer produced by org-scoped resolution)
 * - CONNECTED: engineering_integration + evidence data available
 * - CONNECTED_NO_ELIGIBLE_DATA: engineering_integration but no evidence retrieved
 *
 * CR-X P0: Engineering data integration is organization-scoped.
 * If any org member has an engineering_integration token, the org is
 * CONNECTED regardless of which member most recently logged in with
 * identity_only purpose.  Identity-only tokens no longer produce
 * LOGIN_ONLY — the org simply has no engineering integration.
 */
class GithubEvidenceStateTest extends TestCase
{
    use RefreshDatabase;

    private function createDashboardToken(Organization $org): string
    {
        $user = User::factory()->create(['organization_id' => $org->id]);
        return ApiToken::generateDashboardToken($user->id, $org->id)['raw'];
    }

    public function test_metrics_includes_github_evidence_state_field(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/metrics?time_filter=week&nocache=1');

        $response->assertStatus(200);
        // The field must be present and one of the five valid states
        $state = $response->json('github_engineering_evidence_state');
        $this->assertContains($state, ['NOT_CONNECTED', 'LOGIN_ONLY', 'PARTIAL', 'CONNECTED', 'CONNECTED_NO_ELIGIBLE_DATA']);
        // The message field must also be present
        $this->assertNotNull($response->json('github_engineering_evidence_message'));
    }

    public function test_no_oauth_token_returns_not_connected_state(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // No oauth_tokens row for this org
        $response = $this->withToken($token)->getJson('/api/metrics?time_filter=week&nocache=1');

        $response->assertStatus(200);
        $response->assertJsonPath('github_engineering_evidence_state', 'NOT_CONNECTED');
    }

    public function test_identity_only_token_returns_not_connected_state(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 1,
            'access_token' => 'gho_identity_test',
            'user_data' => json_encode([
                'login' => 'testuser',
                'token_purpose' => 'identity_only',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->withToken($token)->getJson('/api/metrics?time_filter=week&nocache=1');

        $response->assertStatus(200);
        // CR-X P0: identity_only tokens no longer produce LOGIN_ONLY.
        // The org has no engineering_integration token, so the org-level
        // engineering evidence state is NOT_CONNECTED.
        $response->assertJsonPath('github_engineering_evidence_state', 'NOT_CONNECTED');
    }

    public function test_engineering_integration_token_without_data_returns_connected_no_eligible_data(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 1,
            'access_token' => 'gho_eng_test',
            'user_data' => json_encode([
                'login' => 'testuser',
                'token_purpose' => 'engineering_integration',
                'repositories' => [],
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->withToken($token)->getJson('/api/metrics?time_filter=week&nocache=1');

        $response->assertStatus(200);
        // With engineering_integration but empty repositories → zero customer repo authority.
        // 18B fail-closed contract: must be CONNECTED_NO_CUSTOMER_REPO_AUTHORITY, not CONNECTED.
        $state = $response->json('github_engineering_evidence_state');
        $this->assertEquals('CONNECTED_NO_CUSTOMER_REPO_AUTHORITY', $state,
            'Engineering integration token with empty repositories must fail closed as CONNECTED_NO_CUSTOMER_REPO_AUTHORITY');
    }

    public function test_missing_token_purpose_returns_not_connected_state(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 1,
            'access_token' => 'gho_legacy_test',
            'user_data' => json_encode([
                'login' => 'testuser',
                // No token_purpose field — legacy token
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->withToken($token)->getJson('/api/metrics?time_filter=week&nocache=1');

        $response->assertStatus(200);
        // CR-X P0: legacy tokens (no token_purpose) are not engineering_integration,
        // so the org-level engineering evidence state is NOT_CONNECTED.
        $response->assertJsonPath('github_engineering_evidence_state', 'NOT_CONNECTED');
    }

    /**
     * CR-X P0: The core regression — an older engineering_integration token
     * must still be selected over a newer identity_only token.
     */
    public function test_engineering_token_older_than_identity_only_org_remains_connected(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Engineering token — older updated_at
        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 1,
            'access_token' => 'gho_eng_older',
            'user_data' => json_encode([
                'login' => 'eng-user',
                'token_purpose' => 'engineering_integration',
                'repositories' => [],
            ]),
            'created_at' => now()->subDays(5),
            'updated_at' => now()->subDays(5),
        ]);

        // Identity-only token — newer updated_at (would have won under old latest-token logic)
        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 2,
            'access_token' => 'gho_identity_newer',
            'user_data' => json_encode([
                'login' => 'identity-user',
                'token_purpose' => 'identity_only',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->withToken($token)->getJson('/api/metrics?time_filter=week&nocache=1');

        $response->assertStatus(200);
        // The engineering token must win despite being older.
        // 18B: empty repositories → zero customer repo authority → fail closed.
        $state = $response->json('github_engineering_evidence_state');
        $this->assertEquals('CONNECTED_NO_CUSTOMER_REPO_AUTHORITY', $state,
            'Engineering token with empty repositories must fail closed as CONNECTED_NO_CUSTOMER_REPO_AUTHORITY');
        $response->assertJsonPath('github_token_purpose', 'engineering_integration');
    }

    /**
     * CR-X P0: Multiple identity_only tokens from different dashboard users
     * must not alter the org engineering state when an engineering token exists.
     */
    public function test_multiple_identity_only_users_do_not_alter_org_engineering_state(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Engineering token
        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 1,
            'access_token' => 'gho_eng_main',
            'user_data' => json_encode([
                'login' => 'eng-user',
                'token_purpose' => 'engineering_integration',
                'repositories' => [],
            ]),
            'created_at' => now()->subDays(3),
            'updated_at' => now()->subDays(3),
        ]);

        // Multiple identity_only tokens from different users, all newer
        for ($i = 2; $i <= 4; $i++) {
            DB::table('oauth_tokens')->insert([
                'organization_id' => $org->id,
                'user_id' => $i,
                'access_token' => 'gho_identity_' . $i,
                'user_data' => json_encode([
                    'login' => 'identity-user-' . $i,
                    'token_purpose' => 'identity_only',
                ]),
                'created_at' => now()->subDays($i - 1),
                'updated_at' => now()->subDays($i - 1),
            ]);
        }

        $response = $this->withToken($token)->getJson('/api/metrics?time_filter=week&nocache=1');

        $response->assertStatus(200);
        // 18B: empty repositories → zero customer repo authority → fail closed.
        $state = $response->json('github_engineering_evidence_state');
        $this->assertEquals('CONNECTED_NO_CUSTOMER_REPO_AUTHORITY', $state,
            'Engineering token with empty repositories must fail closed as CONNECTED_NO_CUSTOMER_REPO_AUTHORITY');
        $response->assertJsonPath('github_token_purpose', 'engineering_integration');
    }

    /**
     * CR-X P0: OAuth status endpoint must prefer the org's engineering token
     * over the latest identity_only token.
     */
    public function test_oauth_status_prefers_engineering_token_over_identity_only(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Engineering token — older
        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 1,
            'access_token' => 'gho_eng_older',
            'user_data' => json_encode([
                'login' => 'eng-user',
                'token_purpose' => 'engineering_integration',
            ]),
            'created_at' => now()->subDays(5),
            'updated_at' => now()->subDays(5),
        ]);

        // Identity-only token — newer
        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 2,
            'access_token' => 'gho_identity_newer',
            'user_data' => json_encode([
                'login' => 'identity-user',
                'token_purpose' => 'identity_only',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->getJson('/api/github/oauth/status');

        $response->assertStatus(200);
        $response->assertJsonPath('oauth_authenticated', true);
        $response->assertJsonPath('token_purpose', 'engineering_integration');
    }

    /**
     * CR-X P0: OAuth status with only identity_only token shows identity_only.
     */
    public function test_oauth_status_identity_only_without_engineering_token(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 1,
            'access_token' => 'gho_identity_only',
            'user_data' => json_encode([
                'login' => 'identity-user',
                'token_purpose' => 'identity_only',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->getJson('/api/github/oauth/status');

        $response->assertStatus(200);
        $response->assertJsonPath('oauth_authenticated', true);
        $response->assertJsonPath('token_purpose', 'identity_only');
    }

    /**
     * CR-X P0: OAuth status with no tokens shows not authenticated.
     */
    public function test_oauth_status_no_tokens_returns_not_authenticated(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // No oauth_tokens rows

        $response = $this->getJson('/api/github/oauth/status');

        $response->assertStatus(200);
        $response->assertJsonPath('oauth_authenticated', false);
        $response->assertJsonPath('token_purpose', null);
    }
}
