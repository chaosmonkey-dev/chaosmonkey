<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class DevVerificationAuthController extends Controller
{
    /**
     * Provide dev-only verification authentication token
     * 
     * This endpoint is only available in local/testing environments
     * and requires CM_ENABLE_DEV_VERIFICATION_AUTH=true env flag.
     * 
     * @return \Illuminate\Http\JsonResponse
     */
    public function createVerificationToken()
    {
        // Robust environment check with proper boolean parsing.
        // The CM_ENABLE_DEV_VERIFICATION_AUTH env var is resolved at
        // config:cache time into services.chaosmonkey.dev_verification_auth;
        // read via config() so it survives `php artisan config:cache`.
        $rawEnvValue = config('services.chaosmonkey.dev_verification_auth', false);
        $enabled = filter_var($rawEnvValue, FILTER_VALIDATE_BOOLEAN);
        $environment = app()->environment();
        $isAllowedEnvironment = app()->environment(['local', 'testing']);

        if (!$isAllowedEnvironment || !$enabled) {
            if ($environment === 'local') {
                return response()->json([
                    'error' => 'DEV_VERIFICATION_AUTH_GUARD_FAILED',
                    'environment' => $environment,
                    'isAllowedEnvironment' => $isAllowedEnvironment,
                    'rawEnvValue' => $rawEnvValue,
                    'enabled' => $enabled,
                    'expected' => 'local/testing environment and CM_ENABLE_DEV_VERIFICATION_AUTH=true'
                ], 500);
            }

            abort(404);
        }

        // Find a suitable user for verification
        $user = $this->findVerificationUser();

        if (!$user) {
            Log::error('DevVerificationAuth: No suitable user found for verification auth');
            return response()->json([
                'error' => 'No suitable user found for verification'
            ], 500);
        }

        // Create a verification token in api_tokens table
        $token = $this->generateVerificationToken($user);

        Log::info('DevVerificationAuth: Created verification token for user', [
            'user_id' => $user->id,
            'email' => $user->email,
            'organization_id' => $user->organization_id
        ]);

        // Self-check: Verify the token can access telemetry data
        $telemetryEventsCount = DB::table('telemetry_events')
            ->where('organization_id', $user->organization_id)
            ->count();

        // CR4 6G FIX: This is a raw distinct-session count, NOT the canonical
        // population count. The canonical endpoint applies workflow eligibility
        // filters (excluded tools, canonical universe) that reduce this number.
        // Renamed from canonicalPopulationCount to distinctSessionCount to avoid
        // mislabeling a broader count as canonical population.
        $distinctSessionCount = DB::table('telemetry_events')
            ->where('organization_id', $user->organization_id)
            ->whereNotNull('session_id')
            ->distinct('session_id')
            ->count('session_id');

        if ($telemetryEventsCount < 1000) {
            Log::error('DevVerificationAuth: Token has insufficient telemetry data', [
                'user_id' => $user->id,
                'organization_id' => $user->organization_id,
                'telemetryEventsCount' => $telemetryEventsCount
            ]);

            return response()->json([
                'error' => 'DEV_AUTH_TOKEN_HAS_NO_TELEMETRY',
                'organizationId' => $user->organization_id,
                'telemetryEventsCount' => $telemetryEventsCount
            ], 500);
        }

        return response()->json([
            'token' => $token,
            'token_storage_keys' => ['api_token', 'auth_token'],
            'user' => [
                'id' => $user->id,
                'email' => $user->email,
                'name' => $user->name,
                'organization_id' => $user->organization_id
            ],
            'verification' => [
                'organizationId' => $user->organization_id,
                'telemetryEventsCount' => $telemetryEventsCount,
                'distinctSessionCount' => $distinctSessionCount,
                'metricsAvailable' => true
            ]
        ]);
    }

    /**
     * Find a suitable user for verification
     */
    private function findVerificationUser()
    {
        // Try to find user with organization_id 7 (pilot org)
        $user = DB::table('users')
            ->where('organization_id', 7)
            ->first();

        if ($user) {
            Log::info('DevVerificationAuth: Found user with organization_id 7');
            return $user;
        }

        // Try to find an admin user
        $user = DB::table('users')
            ->where('is_admin', true)
            ->first();

        if ($user) {
            Log::info('DevVerificationAuth: Found admin user');
            return $user;
        }

        // Try to find the first user
        $user = DB::table('users')
            ->first();

        if ($user) {
            Log::info('DevVerificationAuth: Found first user');
            return $user;
        }

        return null;
    }

    /**
     * Generate a deterministic verification token for the user.
     *
     * CR-X Local-Dev Auth Resilience: The raw token is derived deterministically
     * from user_id + organization_id + the application key via HMAC-SHA256.
     * Repeated bootstrap calls for the same user/org/app-key combination return
     * the EXACT same raw token, so multiple browser tabs/reloads never rotate
     * the credential under each other.
     *
     * Idempotency is keyed on the deterministic stored token HASH (not user_id),
     * so the same raw token always maps to the same row. If the row exists,
     * expires_at is refreshed in-place (raw token unchanged). If not, a new
     * row is inserted. Unrelated dashboard/invite/installation tokens are
     * never touched.
     *
     * The raw token is never persisted (only its SHA-256 hash) and never logged.
     *
     * @param  object  $user
     * @return string  The raw bearer token (deterministic for given user/org/key)
     */
    private function generateVerificationToken($user)
    {
        $appKey = config('app.key');
        $rawToken = hash_hmac(
            'sha256',
            'chaosmonkey-local-dev-verification:v1:' . $user->id . ':' . $user->organization_id,
            $appKey
        );
        $storedHash = hash('sha256', $rawToken);

        // Idempotency: match by the deterministic stored token hash, not user_id.
        // If a row with this hash exists, refresh expires_at in-place.
        // If not, insert a new row. Never touch unrelated tokens.
        $existing = DB::table('api_tokens')->where('token', $storedHash)->first();

        if ($existing) {
            // Refresh expiry so the deterministic dev token stays valid across
            // repeated bootstrap calls. Raw token is unchanged.
            DB::table('api_tokens')
                ->where('id', $existing->id)
                ->update([
                    'expires_at' => now()->addDays(1),
                    'revoked_at' => null,
                    'updated_at' => now(),
                ]);

            Log::info('DevVerificationAuth: Reusing deterministic dev token (idempotent)', [
                'token_id' => $existing->id,
                'user_id' => $user->id,
                'organization_id' => $user->organization_id,
            ]);

            return $rawToken;
        }

        // Insert a new deterministic dev-verification token row.
        try {
            DB::table('api_tokens')->insert([
                'token' => $storedHash,
                'user_id' => $user->id,
                'organization_id' => $user->organization_id,
                'expires_at' => now()->addDays(1),
                'revoked_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            Log::info('DevVerificationAuth: Inserted new deterministic dev token', [
                'user_id' => $user->id,
                'organization_id' => $user->organization_id,
            ]);

            return $rawToken;
        } catch (\Exception $e) {
            Log::error('DevVerificationAuth: Cannot insert deterministic dev token (read-only DB)', [
                'user_id' => $user->id,
                'organization_id' => $user->organization_id,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException(
                'DEV_AUTH_NO_REUSABLE_TOKEN: Database is read-only and no existing deterministic dev token found. ' .
                'Either make the DB writable or insert the deterministic token hash into api_tokens.'
            );
        }
    }
}
