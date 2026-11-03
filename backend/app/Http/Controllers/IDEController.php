<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use App\Models\IDEConnectCode;
use App\Models\ApiToken;
use App\Models\Invite;
use App\Models\User;
use App\Models\Organization;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use App\Traits\TokenAuthority;

class IDEController extends Controller
{
    use TokenAuthority;
    /**
     * Get the status of all IDE connections
     */
    public function getStatus(): JsonResponse
    {
        // For now, return mock data since we don't have a database table for IDE connections
        $ideStatuses = [
            'cursor' => [
                'connected' => false,
                'lastConnected' => null,
                'provider' => null
            ],
            'windsurf' => [
                'connected' => false,
                'lastConnected' => null,
                'provider' => null
            ],
            'vscode' => [
                'connected' => false,
                'lastConnected' => null,
                'provider' => null
            ],
            'jetbrains' => [
                'connected' => false,
                'lastConnected' => null,
                'provider' => null
            ],
            'sublime' => [
                'connected' => false,
                'lastConnected' => null,
                'provider' => null
            ],
            'vim' => [
                'connected' => false,
                'lastConnected' => null,
                'provider' => null
            ]
        ];

        return response()->json($ideStatuses);
    }

    /**
     * Authenticate with an IDE
     */
    public function authenticate(Request $request): JsonResponse
    {
        $request->validate([
            'ide' => 'required|string',
            'provider' => 'required|string',
            'credentials' => 'sometimes|array'
        ]);

        $ide = $request->input('ide');
        $provider = $request->input('provider');

        // For now, simulate successful authentication
        // In a real implementation, this would validate credentials and establish a connection
        
        return response()->json([
            'success' => true,
            'message' => "Successfully authenticated with {$provider} for {$ide}",
            'ide' => $ide,
            'provider' => $provider,
            'connected' => true
        ]);
    }

    /**
     * Connect to an IDE
     */
    public function connect(Request $request): JsonResponse
    {
        $request->validate([
            'ide' => 'required|string',
            'provider' => 'required|string'
        ]);

        $ide = $request->input('ide');
        $provider = $request->input('provider');

        // For now, simulate successful connection
        // In a real implementation, this would establish the actual connection
        
        return response()->json([
            'success' => true,
            'message' => "Successfully connected to {$ide} via {$provider}",
            'ide' => $ide,
            'provider' => $provider,
            'connected' => true
        ]);
    }

    /**
     * Disconnect from an IDE
     */
    public function disconnect(Request $request): JsonResponse
    {
        $request->validate([
            'ide' => 'required|string'
        ]);

        $ide = $request->input('ide');

        // For now, simulate successful disconnection
        
        return response()->json([
            'success' => true,
            'message' => "Successfully disconnected from {$ide}",
            'ide' => $ide,
            'connected' => false
        ]);
    }

    /**
     * Collect telemetry data from an IDE
     */
    public function collectTelemetry(Request $request): JsonResponse
    {
        $request->validate([
            'ide' => 'required|string',
            'data' => 'required|array'
        ]);

        $ide = $request->input('ide');
        $data = $request->input('data');

        // For now, just acknowledge receipt
        // In a real implementation, this would store the telemetry data
        
        return response()->json([
            'success' => true,
            'message' => "Telemetry data received from {$ide}",
            'ide' => $ide,
            'dataPoints' => count($data)
        ]);
    }

    /**
     * Exchange a connect code for an auth token (V2 only, legacy removed in 0.4.0)
     */
    public function exchangeConnectCode(Request $request): JsonResponse
    {
        $extensionVersion = $request->input('extension_version');

        if (!$extensionVersion) {
            return response()->json([
                'error' => 'extension_version is required',
                'error_code' => 'VERSION_REQUIRED',
            ], 400);
        }

        if (version_compare($extensionVersion, '0.3.9', '<')) {
            return response()->json([
                'error' => 'Extension version must be at least 0.3.9',
                'error_code' => 'VERSION_TOO_OLD',
            ], 400);
        }

        return $this->exchangeConnectCodeV2($request);
    }

    /**
     * Public code exchange for VSIX 0.4.0+ — invite-backed identity flow.
     *
     * POST /api/ide/connect/exchange
     * Request: { code, installation_id, extension_version }
     * Response: { token, developer_id, organization_id, team_id, installation_id, identity_source, expires_at }
     */
    public function exchangeConnectCodeV2(Request $request): JsonResponse
    {
        $request->validate([
            'code' => 'required|string',
            'installation_id' => 'required|string|uuid',
            'extension_version' => 'required|string',
        ]);

        $code = strtoupper(trim($request->input('code')));
        $installationId = $request->input('installation_id');

        return DB::transaction(function () use ($code, $installationId) {
            // 1. Locate the code
            $connectCode = IDEConnectCode::with(['organization', 'invite', 'user'])
                ->where('code', $code)
                ->lockForUpdate()
                ->first();

            if (!$connectCode) {
                return response()->json(['error' => 'Invalid connect code'], 404);
            }

            // 2. Prove unexpired (codes are reusable across distinct editor installations)
            if ($connectCode->isExpired()) {
                return response()->json(['error' => 'Connect code has expired'], 400);
            }

            // 3. Resolve invite and organization
            $invite = $connectCode->invite;
            $organization = $connectCode->organization;
            $pilotAdminUserId = $connectCode->user_id;

            if (!$invite) {
                return response()->json(['error' => 'Connect code is not invite-backed'], 400);
            }

            if (!$pilotAdminUserId) {
                return response()->json(['error' => 'Connect code has no issuing pilot admin'], 400);
            }

            // 4. Prove invite is pending and belongs to that organization.
            // A cancelled invite (closed expiry — revoked sentinel or legacy
            // natural expiry) must not admit new installations even if a
            // still-live code row exists.
            if ($invite->isExpired()) {
                return response()->json(['error' => 'Associated invite is closed'], 400);
            }
            if ($invite->isRedeemed()) {
                return response()->json(['error' => 'Associated invite has already been redeemed'], 400);
            }
            if ((int) $invite->organization_id !== (int) $organization->id) {
                return response()->json(['error' => 'Invite organization mismatch'], 400);
            }

            // 5. installation_id is already validated as UUID by request validation

            // 6. Create per-installation token (hashed), bound to the pilot-admin user
            $tokenPair = $this->createInviteBackedToken(
                organizationId: $organization->id,
                inviteId: $invite->id,
                installationId: $installationId,
                userId: $pilotAdminUserId,
                expiresDays: 90,
            );

            // 7. Token is already bound to invite_id, organization_id, installation_id
            // 8. Enrollment codes stay active so the same invite can enroll multiple editors.

            // Derive identity fields
            $developerId = "invite:{$invite->id}";

            Log::info('[IDE] Connect code exchanged', [
                'code_id' => $connectCode->id,
                'has_installation_id' => !empty($installationId),
                'organization_id' => $organization->id,
                'developer_id' => $developerId,
            ]);

            return response()->json([
                'token' => $tokenPair['raw'],
                'developer_id' => $developerId,
                'organization_id' => $organization->id,
                'team_id' => null,
                'installation_id' => $installationId,
                'identity_source' => 'backend_claimed',
                'expires_at' => $tokenPair['token']->expires_at->toISOString(),
            ]);
        });
    }

    /**
     * Renew an installation-bound token in-place.
     *
     * POST /api/ide/connect/renew
     * Authenticated by the CURRENT VALID installation-bound bearer token.
     * Extends expires_at by the configured lifetime (90 days) without rotating
     * the token secret, preserving organization/user/invite/installation identity.
     *
     * If the token still has > 14 days remaining, returns idempotent no-op:
     *   { renewed: false, expires_at: <current> }
     *
     * Expired or revoked tokens cannot reach this endpoint (middleware rejects them).
     */
    public function renewToken(Request $request): JsonResponse
    {
        $apiToken = $request->input('authenticated_api_token');

        if (!$apiToken) {
            return response()->json(['error' => 'No authenticated token found'], 401);
        }

        if (!$apiToken->isInstallationToken()) {
            return response()->json([
                'error' => 'Only installation-bound tokens can be renewed',
                'error_code' => 'NOT_INSTALLATION_TOKEN',
            ], 403);
        }

        try {
            $result = $apiToken->renewInPlace(expiresDays: 90, minRemainingDays: 14);
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 403);
        }

        Log::info('[IDE] Token renewed', [
            'token_id' => $apiToken->id,
            'installation_id' => $apiToken->installation_id,
            'renewed' => $result['renewed'],
            'expires_at' => $result['expires_at']->toISOString(),
        ]);

        return response()->json([
            'renewed' => $result['renewed'],
            'expires_at' => $result['expires_at']->toISOString(),
            'installation_id' => $apiToken->installation_id,
            'organization_id' => $apiToken->organization_id,
        ]);
    }

    /**
     * Store IDE configuration data (monthly spend, active users)
     */
    public function storeConfiguration(Request $request): JsonResponse
    {
        $request->validate([
            'ide' => 'required|string|in:cursor,windsurf,vscode,jetbrains,claude,copilot',
            'monthly_spend' => 'nullable|numeric|min:0',
            'active_users' => 'nullable|integer|min:1',
            'organization_id' => 'nullable|integer|exists:organizations,id',
        ]);

        $ide = $request->input('ide');
        $monthlySpend = $request->input('monthly_spend');
        $activeUsers = $request->input('active_users');
        $organizationId = $request->input('organization_id');

        // For now, store in session or cache - in production this would go to database
        $configKey = "ide_config_{$ide}";
        $configData = [
            'ide' => $ide,
            'monthly_spend' => $monthlySpend,
            'active_users' => $activeUsers,
            'organization_id' => $organizationId,
            'updated_at' => now()->toISOString(),
        ];

        // Store in cache for 24 hours
        Cache::put($configKey, $configData, 86400);

        return response()->json([
            'success' => true,
            'message' => 'IDE configuration saved successfully',
            'data' => $configData
        ]);
    }
}
