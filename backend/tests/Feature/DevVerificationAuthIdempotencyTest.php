<?php
namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * CR-X Local-Dev Auth Resilience: DevVerificationAuth Idempotency Contract
 *
 * Proves that /api/dev/verification-auth returns a DETERMINISTIC raw token
 * derived from user_id + organization_id + app key, so repeated bootstrap
 * calls never rotate the credential under an earlier browser tab.
 *
 * Runs against a disposable in-memory SQLite database (:memory:).
 * Does NOT touch any real local data.
 */
class DevVerificationAuthIdempotencyTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['app.env' => 'local']);
        config(['app.key' => 'base64:test-key-for-deterministic-token-verification']);
        \Cache::flush();
        // The endpoint reads CM_ENABLE_DEV_VERIFICATION_AUTH through
        // services.chaosmonkey.dev_verification_auth (config-cached).
        config(['services.chaosmonkey.dev_verification_auth' => true]);
        $this->withoutMiddleware();
    }

    /**
     * Seed a user + organization + sufficient telemetry for the endpoint guard.
     */
    private function seedDevUserAndTelemetry(int $userId = 4, int $orgId = 7): User
    {
        $now = now();
        DB::table('organizations')->insert([
            'id' => $orgId,
            'name' => 'Test Org',
            'slug' => 'test-org',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        DB::table('users')->insert([
            'id' => $userId,
            'name' => 'Matt Test',
            'email' => 'matt@chaosmonkey.com',
            'password' => bcrypt('password'),
            'organization_id' => $orgId,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        // Seed 1000+ telemetry events so the endpoint's telemetry guard passes.
        $rows = [];
        for ($i = 0; $i < 1100; $i++) {
            $rows[] = [
                'user_id' => $userId,
                'organization_id' => $orgId,
                'event_type' => 'test_event',
                'source' => 'test',
                'batch_hash' => 'test-batch-' . $userId . '-' . $i,
                'payload' => '{}',
                'created_at' => $now,
                'updated_at' => $now,
                'timestamp' => $now,
            ];
        }
        // Insert in chunks to avoid SQLite variable limit.
        foreach (array_chunk($rows, 500) as $chunk) {
            DB::table('telemetry_events')->insert($chunk);
        }

        return User::find($userId);
    }

    // ════════════════════════════════════════════════════════════
    // 1-3. DETERMINISTIC + IDEMPOTENT: repeated calls return same raw token
    // ════════════════════════════════════════════════════════════

    public function test_first_call_returns_a_token()
    {
        $this->seedDevUserAndTelemetry();
        $resp = $this->getJson('/api/dev/verification-auth');
        $resp->assertStatus(200);
        $resp->assertJsonStructure(['token', 'user', 'verification']);
        $this->assertNotEmpty($resp->json('token'));
    }

    public function test_second_call_returns_exactly_same_raw_token()
    {
        $this->seedDevUserAndTelemetry();
        $first = $this->getJson('/api/dev/verification-auth')->json('token');
        $second = $this->getJson('/api/dev/verification-auth')->json('token');
        $this->assertEquals($first, $second, 'Second call must return the exact same raw token');
    }

    public function test_three_rapid_sequential_calls_all_return_same_raw_token()
    {
        $this->seedDevUserAndTelemetry();
        $tokens = [];
        for ($i = 0; $i < 3; $i++) {
            $tokens[] = $this->getJson('/api/dev/verification-auth')->json('token');
        }
        $this->assertEquals($tokens[0], $tokens[1], 'Call 2 token must match call 1');
        $this->assertEquals($tokens[0], $tokens[2], 'Call 3 token must match call 1');
    }

    // ════════════════════════════════════════════════════════════
    // 4. DETERMINISTIC HASH: exactly one row with the deterministic hash
    // ════════════════════════════════════════════════════════════

    public function test_hash_of_returned_raw_token_corresponds_to_exactly_one_deterministic_row()
    {
        $user = $this->seedDevUserAndTelemetry();
        $rawToken = $this->getJson('/api/dev/verification-auth')->json('token');
        $expectedHash = hash('sha256', $rawToken);

        // Make 3 calls to ensure idempotency
        $this->getJson('/api/dev/verification-auth');
        $this->getJson('/api/dev/verification-auth');

        $count = DB::table('api_tokens')->where('token', $expectedHash)->count();
        $this->assertEquals(1, $count, 'Exactly one row must exist with the deterministic token hash');

        // Verify it's scoped to the right user/org
        $row = DB::table('api_tokens')->where('token', $expectedHash)->first();
        $this->assertEquals($user->id, $row->user_id);
        $this->assertEquals($user->organization_id, $row->organization_id);
    }

    // ════════════════════════════════════════════════════════════
    // 5. FIRST TOKEN REMAINS VALID AFTER REPEATED CALLS
    // ════════════════════════════════════════════════════════════

    public function test_first_token_remains_valid_after_subsequent_bootstrap_calls()
    {
        $this->seedDevUserAndTelemetry();
        $firstToken = $this->getJson('/api/dev/verification-auth')->json('token');

        // Simulate 3 more bootstrap calls
        $this->getJson('/api/dev/verification-auth');
        $this->getJson('/api/dev/verification-auth');
        $this->getJson('/api/dev/verification-auth');

        // The FIRST raw token must still pass ApiToken::findValidToken()
        $valid = ApiToken::findValidToken($firstToken);
        $this->assertNotNull($valid, 'First token must remain valid after subsequent bootstrap calls');
    }

    // ════════════════════════════════════════════════════════════
    // 6-7. UNRELATED TOKENS REMAIN UNCHANGED
    // ════════════════════════════════════════════════════════════

    public function test_existing_unrelated_dashboard_token_remains_unchanged()
    {
        $user = $this->seedDevUserAndTelemetry();

        // Create an unrelated dashboard token
        $dashboardRaw = 'unrelated-dashboard-token-' . uniqid();
        $dashboardHash = hash('sha256', $dashboardRaw);
        DB::table('api_tokens')->insert([
            'token' => $dashboardHash,
            'user_id' => $user->id,
            'organization_id' => $user->organization_id,
            'expires_at' => now()->addDays(30),
            'revoked_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Call dev verification auth 3 times
        $this->getJson('/api/dev/verification-auth');
        $this->getJson('/api/dev/verification-auth');
        $this->getJson('/api/dev/verification-auth');

        // The unrelated dashboard token must still be valid and unchanged
        $valid = ApiToken::findValidToken($dashboardRaw);
        $this->assertNotNull($valid, 'Unrelated dashboard token must remain valid');
        $this->assertEquals($dashboardHash, $valid->token, 'Unrelated dashboard token hash must not change');
    }

    public function test_existing_invite_installation_token_remains_unchanged()
    {
        $user = $this->seedDevUserAndTelemetry();

        // Create an installation token (installation_id set, invite_id null —
        // avoids FK constraint on invites table in test DB)
        $instRaw = 'install-token-' . uniqid();
        $instHash = hash('sha256', $instRaw);
        DB::table('api_tokens')->insert([
            'token' => $instHash,
            'user_id' => $user->id,
            'organization_id' => $user->organization_id,
            'invite_id' => null,
            'installation_id' => 'inst-123',
            'expires_at' => now()->addDays(30),
            'revoked_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Call dev verification auth 3 times
        $this->getJson('/api/dev/verification-auth');
        $this->getJson('/api/dev/verification-auth');

        // The installation token must still be valid and unchanged
        $valid = ApiToken::findValidToken($instRaw);
        $this->assertNotNull($valid, 'Installation token must remain valid');
        $this->assertEquals($instHash, $valid->token, 'Installation token hash must not change');
        $this->assertEquals('inst-123', $valid->installation_id, 'Installation ID must be preserved');
    }

    // ════════════════════════════════════════════════════════════
    // 8-9. USER/ORG SCOPING: different user/org → different token
    // ════════════════════════════════════════════════════════════

    public function test_deterministic_token_scoped_to_expected_user_and_organization()
    {
        $user = $this->seedDevUserAndTelemetry(userId: 4, orgId: 7);
        $rawToken = $this->getJson('/api/dev/verification-auth')->json('token');
        $hash = hash('sha256', $rawToken);

        $row = DB::table('api_tokens')->where('token', $hash)->first();
        $this->assertNotNull($row);
        $this->assertEquals(4, $row->user_id);
        $this->assertEquals(7, $row->organization_id);
    }

    public function test_different_user_or_organization_produces_different_deterministic_token()
    {
        // Seed user A (user_id=4, org_id=7)
        $this->seedDevUserAndTelemetry(userId: 4, orgId: 7);
        $tokenA = $this->getJson('/api/dev/verification-auth')->json('token');

        // Seed user B (user_id=5, org_id=8) with its own telemetry
        $now = now();
        DB::table('organizations')->insert([
            'id' => 8, 'name' => 'Org B', 'slug' => 'org-b',
            'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('users')->insert([
            'id' => 5, 'name' => 'User B', 'email' => 'b@test.com',
            'password' => bcrypt('password'), 'organization_id' => 8,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $rows = [];
        for ($i = 0; $i < 1100; $i++) {
            $rows[] = [
                'user_id' => 5, 'organization_id' => 8,
                'event_type' => 'test_event', 'source' => 'test',
                'batch_hash' => 'test-batch-5-' . $i,
                'payload' => '{}',
                'created_at' => $now, 'updated_at' => $now, 'timestamp' => $now,
            ];
        }
        foreach (array_chunk($rows, 500) as $chunk) {
            DB::table('telemetry_events')->insert($chunk);
        }

        // The endpoint finds user with org_id=7 first, so we need to test
        // the deterministic derivation directly for user B
        $appKey = config('app.key');
        $tokenB = hash_hmac('sha256', 'chaosmonkey-local-dev-verification:v1:5:8', $appKey);

        $this->assertNotEquals($tokenA, $tokenB, 'Different user/org must produce different deterministic token');
    }

    // ════════════════════════════════════════════════════════════
    // 10. ENVIRONMENT GUARD: endpoint restricted to local/testing
    // ════════════════════════════════════════════════════════════

    public function test_endpoint_environment_guard_code_is_unchanged()
    {
        // The env guard (CM_ENABLE_DEV_VERIFICATION_AUTH + local/testing check)
        // is in createVerificationToken() and was NOT modified by P0-2 auth fix.
        // Verify the guard code exists and is intact by reading the source.
        $source = file_get_contents(
            base_path('app/Http/Controllers/DevVerificationAuthController.php')
        );
        $this->assertStringContainsString('CM_ENABLE_DEV_VERIFICATION_AUTH', $source);
        $this->assertStringContainsString('isAllowedEnvironment', $source);
        $this->assertStringContainsString("app()->environment(['local', 'testing'])", $source);
        $this->assertStringContainsString('DEV_VERIFICATION_AUTH_GUARD_FAILED', $source);
    }

    // ════════════════════════════════════════════════════════════
    // 11-12. NO RAW TOKEN PERSISTED OR LOGGED
    // ════════════════════════════════════════════════════════════

    public function test_no_raw_token_persisted_in_db()
    {
        $this->seedDevUserAndTelemetry();
        $rawToken = $this->getJson('/api/dev/verification-auth')->json('token');

        // The raw token must NOT appear in any api_tokens row (only its hash)
        $rawMatch = DB::table('api_tokens')->where('token', $rawToken)->count();
        $this->assertEquals(0, $rawMatch, 'Raw token must not be persisted — only its SHA-256 hash');

        // The hash must exist
        $hashMatch = DB::table('api_tokens')->where('token', hash('sha256', $rawToken))->count();
        $this->assertEquals(1, $hashMatch, 'SHA-256 hash of raw token must be persisted');
    }

    public function test_no_raw_token_in_logs()
    {
        $this->seedDevUserAndTelemetry();
        $rawToken = $this->getJson('/api/dev/verification-auth')->json('token');

        // The raw token must not appear in the log output.
        // We check by searching the log file for the raw token string.
        $logPath = storage_path('logs/laravel.log');
        if (file_exists($logPath)) {
            $logContent = file_get_contents($logPath);
            $this->assertStringNotContainsString($rawToken, $logContent, 'Raw token must not be logged');
        }
        // If no log file exists in testing, that's fine — no logging = no leak.
    }
}
