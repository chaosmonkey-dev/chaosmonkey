<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Deployment;
use App\Models\Organization;
use App\Models\PullRequest;
use App\Models\Release;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CR-X 3D.1: Route-level deliveryTimeseries engineering-token selection.
 *
 * Tests against the ACTUAL GET /api/delivery/timeseries endpoint using
 * ephemeral test DB (RefreshDatabase). No Local authority DB writes.
 *
 * Proves:
 * A. same-org identity_only token only + github_api_sync releases → ZERO
 * B. same-org identity_only + engineering_integration + releases → counted
 * C. >10 non-engineering OAuth rows + valid engineering token → counted
 * D. engineering token from another org → ZERO
 * E. same-org engineering token + cm_activity_sim releases in live → ZERO
 * F. same-org engineering token + github_api_sync releases → counted
 *
 * Also proves db_sync compatibility.
 */
class DeliveryTimeseriesTokenSelectionTest extends TestCase
{
    use RefreshDatabase;

    private ?string $savedPilotSupportLogins = null;

    protected function setUp(): void
    {
        parent::setUp();
        // CR-X P0-0: PilotAwareTokenHelper now reads from config(), not env().
        $this->savedPilotSupportLogins = config('services.pilot.support_github_logins');
        config(['services.pilot.support_github_logins' => '']);
    }

    protected function tearDown(): void
    {
        // CR-X P0-0: Restore config override (replaces former putenv teardown).
        config(['services.pilot.support_github_logins' => $this->savedPilotSupportLogins ?? '']);
        parent::tearDown();
    }

    private function createDashboardToken(Organization $org): string
    {
        $user = User::factory()->create(['organization_id' => $org->id]);
        return ApiToken::generateDashboardToken($user->id, $org->id)['raw'];
    }

    /**
     * Insert an oauth_tokens row with a given token_purpose and org.
     */
    private function insertOAuthToken(
        Organization $org,
        string $purpose,
        string $login = 'dev-user',
        ?string $updatedAt = null
    ): void {
        \DB::table('oauth_tokens')->insert([
            'user_id' => User::factory()->create(['organization_id' => $org->id])->id,
            'organization_id' => $org->id,
            'access_token' => 'gho_test_' . Str::random(16),
            'user_data' => json_encode([
                'login' => $login,
                'id' => rand(1000, 99999),
                'token_purpose' => $purpose,
            ]),
            'created_at' => now()->subDays(30),
            'updated_at' => $updatedAt ?? now()->subDays(1),
        ]);
    }

    /**
     * Insert a release with metadata.data_source (real sync convention).
     */
    private function insertRelease(string $dataSource, ?string $publishedAt = null): void
    {
        Release::create([
            'repo_name' => 'test-repo',
            'tag_name' => 'v' . rand(1, 99) . '.' . rand(0, 99) . '.0',
            'published_at' => $publishedAt ?? now()->startOfWeek()->addDays(2)->format('Y-m-d H:i:s'),
            'author_login' => 'release-author',
            'metadata' => ['data_source' => $dataSource, 'draft' => false, 'prerelease' => false],
        ]);
    }

    /**
     * Get total release_count from the delivery timeseries response.
     */
    private function getTotalReleaseCount(string $token): int
    {
        $response = $this->withToken($token)->getJson('/api/delivery/timeseries');
        $response->assertStatus(200);
        $series = $response->json('series');
        return array_sum(array_column($series, 'release_count'));
    }

    // ====================================================================
    // A. identity_only token alone → ZERO release contribution
    // ====================================================================

    public function test_a_identity_only_token_alone_blocks_releases(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertOAuthToken($org, 'identity_only');
        $this->insertRelease('github_api_sync');

        $totalReleases = $this->getTotalReleaseCount($token);
        $this->assertEquals(0, $totalReleases, 'identity_only token must not authorize releases');
    }

    // ====================================================================
    // B. identity_only + engineering_integration → releases counted
    // ====================================================================

    public function test_b_identity_only_plus_engineering_token_counts_releases(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // identity_only token is newer (updated more recently)
        $this->insertOAuthToken($org, 'identity_only', 'dev-1', now()->subHours(1));
        // engineering token is older but must still be found
        $this->insertOAuthToken($org, 'engineering_integration', 'dev-2', now()->subDays(5));
        $this->insertRelease('github_api_sync');

        $totalReleases = $this->getTotalReleaseCount($token);
        $this->assertEquals(1, $totalReleases, 'engineering token must win over identity_only');
    }

    // ====================================================================
    // C. >10 non-engineering tokens + valid engineering → counted
    // ====================================================================

    public function test_c_more_than_10_non_engineering_tokens_still_finds_engineering(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Insert 15 identity_only tokens (all newer than the engineering one)
        for ($i = 0; $i < 15; $i++) {
            $this->insertOAuthToken(
                $org,
                'identity_only',
                'identity-user-' . $i,
                now()->subHours($i + 1)
            );
        }
        // Engineering token is the oldest — must still be found
        $this->insertOAuthToken($org, 'engineering_integration', 'eng-user', now()->subDays(10));
        $this->insertRelease('github_api_sync');

        $totalReleases = $this->getTotalReleaseCount($token);
        $this->assertEquals(1, $totalReleases, 'engineering token must be found regardless of token count');
    }

    // ====================================================================
    // D. engineering token from another org → ZERO
    // ====================================================================

    public function test_d_engineering_token_from_another_org_blocks_releases(): void
    {
        $org = Organization::factory()->create();
        $otherOrg = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Engineering token belongs to a different org
        $this->insertOAuthToken($otherOrg, 'engineering_integration', 'other-org-dev');
        $this->insertRelease('github_api_sync');

        $totalReleases = $this->getTotalReleaseCount($token);
        $this->assertEquals(0, $totalReleases, 'cross-org engineering token must not authorize releases');
    }

    // ====================================================================
    // E. same-org engineering token + cm_activity_sim releases → ZERO (live)
    // ====================================================================

    public function test_e_engineering_token_with_cm_activity_sim_releases_excluded_in_live(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertOAuthToken($org, 'engineering_integration');
        $this->insertRelease('cm_activity_sim');

        $totalReleases = $this->getTotalReleaseCount($token);
        $this->assertEquals(0, $totalReleases, 'cm_activity_sim releases must be excluded in live mode');
    }

    // ====================================================================
    // F. same-org engineering token + github_api_sync releases → counted
    // ====================================================================

    public function test_f_engineering_token_with_github_api_sync_releases_counted(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertOAuthToken($org, 'engineering_integration');
        $this->insertRelease('github_api_sync');
        $this->insertRelease('github_api_sync');
        $this->insertRelease('github_api_sync');

        $totalReleases = $this->getTotalReleaseCount($token);
        $this->assertEquals(3, $totalReleases, 'github_api_sync releases with engineering auth must be counted');
    }

    // ====================================================================
    // F2. same-org engineering token + db_sync releases → counted
    // ====================================================================

    public function test_f2_engineering_token_with_db_sync_releases_counted(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertOAuthToken($org, 'engineering_integration');
        $this->insertRelease('db_sync');
        $this->insertRelease('db_sync');

        $totalReleases = $this->getTotalReleaseCount($token);
        $this->assertEquals(2, $totalReleases, 'db_sync releases with engineering auth must be counted');
    }

    // ====================================================================
    // G. no OAuth token at all → ZERO
    // ====================================================================

    public function test_g_no_oauth_token_blocks_releases(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // No oauth_tokens inserted
        $this->insertRelease('github_api_sync');

        $totalReleases = $this->getTotalReleaseCount($token);
        $this->assertEquals(0, $totalReleases, 'no OAuth token must block releases');
    }

    // ====================================================================
    // H. support-login token cannot substitute for engineering
    // ====================================================================

    public function test_h_support_login_token_cannot_authorize_releases(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // CR-X P0-0: Use config() override instead of putenv().
        config(['services.pilot.support_github_logins' => 'chaosmonkey-support']);

        // Insert a support-login token with engineering_integration purpose
        \DB::table('oauth_tokens')->insert([
            'user_id' => User::factory()->create(['organization_id' => $org->id])->id,
            'organization_id' => $org->id,
            'access_token' => 'gho_support_' . Str::random(16),
            'user_data' => json_encode([
                'login' => 'chaosmonkey-support',
                'id' => 99999,
                'token_purpose' => 'engineering_integration',
            ]),
            'created_at' => now()->subDays(1),
            'updated_at' => now()->subHours(1),
        ]);

        $this->insertRelease('github_api_sync');

        $totalReleases = $this->getTotalReleaseCount($token);
        $this->assertEquals(0, $totalReleases, 'support-login token must not authorize releases');

        // CR-X P0-0: Restore config value.
        config(['services.pilot.support_github_logins' => '']);
    }
}
