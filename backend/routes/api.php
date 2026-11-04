<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\CursorUsageController;
use App\Http\Controllers\PullRequestController;
use App\Http\Controllers\TelemetryController;
use App\Http\Controllers\GitHubOAuthController;
use App\Http\Controllers\GitHubAppWebhookController;
use App\Http\Controllers\IDEController;
use App\Http\Controllers\ApiTokenController;
use App\Http\Controllers\SpendController;
use App\Http\Controllers\DevVerificationAuthController;
use App\Http\Controllers\PilotHealthController;
use App\Http\Controllers\AuthController;
use App\Http\Middleware\SimpleTokenAuth;

// CR-X multi-admin: email/password dashboard login (rate-limited)
Route::post('/auth/login', [AuthController::class, 'login'])
    ->middleware(['throttle:5,1']);

// Dashboard logout — revokes the current ApiToken (requires SimpleTokenAuth)
Route::post('/auth/logout', [AuthController::class, 'logout'])
    ->middleware(\App\Http\Middleware\SimpleTokenAuth::class);

// Lightweight liveness/readiness probes — intentionally public so load
// balancers and uptime checks work without credentials.
Route::get('/health', [PullRequestController::class, 'lightweightHealth']);
Route::get('/version', [PullRequestController::class, 'version']);

// Dashboard data endpoints — require a valid dashboard token and are
// organization-scoped.  Invite-backed extension tokens are rejected (403)
// by SimpleTokenAuth for these read paths.
Route::middleware(\App\Http\Middleware\SimpleTokenAuth::class)->group(function () {
    Route::get('/metrics', [PullRequestController::class, 'metrics']);
    Route::get('/developers', [PullRequestController::class, 'getDevelopers']);
    Route::get('/telemetry/canonical', [TelemetryController::class, 'canonical']);
    // CR-X 2C: Telemetry-derived repo inventory (org-scoped, no GitHub OAuth required)
    Route::get('/telemetry/repos', [TelemetryController::class, 'repos']);
    // CR-X Slice 1: Delivery time-series (observed-only weekly PR + deploy for PBT)
    Route::get('/delivery/timeseries', [PullRequestController::class, 'deliveryTimeseries']);
    // CR-X Pass 1 (F): Pilot health — read-only operational visibility
    Route::get('/pilot/health', [PilotHealthController::class, 'show']);

    // Detailed health diagnostics (reveals DB/OAuth state) — auth required.
    Route::get('/health-detailed', [PullRequestController::class, 'healthCheck']);
    Route::get('/repositories', [PullRequestController::class, 'getRepositories']);

    // Destructive data wipe — auth required (controller additionally
    // requires the admin role).
    Route::post('/clear-data', [PullRequestController::class, 'clearData']);
    Route::get('/github/setup', [PullRequestController::class, 'getGithubSetup']);
    Route::post('/github/test-connection', [PullRequestController::class, 'testGithubConnection']);

    // Productivity endpoints for frontend compatibility
    Route::get('/productivity/summary', [PullRequestController::class, 'productivitySummary']);
    Route::get('/productivity/trends', [PullRequestController::class, 'productivityTrends']);

    // Legacy Cursor usage file ingest — auth required (dashboard token).
    Route::post('/upload-cursor', [CursorUsageController::class, 'upload']);

    // Telemetry query routes — org-scoped dashboard reads. All return data
    // only for the authenticated user's organization.
    Route::get('/telemetry', [TelemetryController::class, 'index']);
    Route::get('/telemetry/orphan-stats', [TelemetryController::class, 'orphanStats']);
    Route::get('/telemetry/sessions', [TelemetryController::class, 'sessions']);
    Route::get('/telemetry/aggregated', [TelemetryController::class, 'aggregated']);
    // /telemetry/repos and /telemetry/canonical are in the protected group above
    // identity-coverage route removed — was exposing invite emails and dev display names publicly
});

// Telemetry ingestion routes — token-authenticated inside the controller.
// Extension/bridge clients present their installation or invite-backed API
// token as a bearer credential; the controller resolves it via the shared
// token authority and fails closed for 0.4.0+ payloads without one.
Route::post('/telemetry/upload', [TelemetryController::class, 'upload']);
Route::post('/telemetry', [TelemetryController::class, 'store']);

// Public telemetry test endpoint
Route::get('/telemetry/test', fn() => response()->json(['status' => 'ready']));

// Legacy IDE Routes — disabled in 0.4.0 (replaced by /ide/connect/exchange)
// Route::get('/ide/status', [IDEController::class, 'getStatus']);
// Route::post('/ide/authenticate', [IDEController::class, 'authenticate']);
// Route::post('/ide/connect', [IDEController::class, 'connect']);
// Route::post('/ide/disconnect', [IDEController::class, 'disconnect']);
// Route::post('/ide/collect-telemetry', [IDEController::class, 'collectTelemetry']);
// Route::post('/ide/configuration', [IDEController::class, 'storeConfiguration']);

// IDE Connect Code exchange — only public endpoint (rate limited, no auth:api guard)
Route::middleware(['throttle:10,1'])->group(function () {
    Route::post('/ide/connect/exchange', [IDEController::class, 'exchangeConnectCode']);
});

// IDE token renewal — authenticated by the current valid installation-bound token
// SimpleTokenAuth allows installation tokens for this path (see middleware allowlist)
Route::post('/ide/connect/renew', [IDEController::class, 'renewToken'])
    ->middleware(\App\Http\Middleware\SimpleTokenAuth::class);

// GitHub OAuth Routes - now session-free
Route::get('/github/oauth/redirect', [GitHubOAuthController::class, 'redirectToGitHub']);
Route::get('/github/oauth/callback', [GitHubOAuthController::class, 'handleCallback']);
Route::get('/github/oauth/status', [GitHubOAuthController::class, 'getOAuthStatus']);
Route::post('/github/oauth/dashboard-token', [GitHubOAuthController::class, 'exchangeDashboardToken'])
    ->middleware(['throttle:10,1']);
Route::post('/github/oauth/revoke', [GitHubOAuthController::class, 'revokeOAuth'])
    ->middleware(\App\Http\Middleware\SimpleTokenAuth::class);

// CR-X Track A: GitHub App webhook (no auth middleware — signature-verified)
Route::post('/github/app/webhook', [GitHubAppWebhookController::class, 'handleWebhook'])
    ->middleware(['throttle:60,1']);

// API Token Management Routes — DISABLED in 0.4.0 (invite-backed IDE identity only)
// Route::middleware(['auth:api'])->group(function () {
//     Route::get('/api-token/generate', [ApiTokenController::class, 'generate']);
//     Route::get('/api-token', [ApiTokenController::class, 'index']);
//     Route::post('/api-token/validate', [ApiTokenController::class, 'validateToken']);
// });
// Route::get('/api-token/config', function() {
//     return view('api-token');
// });

// Atlassian OAuth (minimal)
use App\Http\Controllers\AtlassianOAuthController;
use App\Http\Controllers\GitHubMetricDetailsController;
use App\Http\Controllers\CohortController;
use App\Http\Controllers\InviteController;
use App\Http\Controllers\ExtensionController;
use App\Http\Controllers\OrganizationController;
Route::get('/atlassian/oauth/redirect', [AtlassianOAuthController::class, 'redirectToAtlassian']);
Route::get('/atlassian/oauth/callback', [AtlassianOAuthController::class, 'handleCallback']);

// GitHub metric drilldown endpoints — dashboard reads, require a valid
// dashboard token (invite-backed tokens are rejected by SimpleTokenAuth).
Route::middleware(\App\Http\Middleware\SimpleTokenAuth::class)->group(function () {
    // GitHub Metric Details - Drilldown for metric cards
    Route::get('/github/metric-details', [GitHubMetricDetailsController::class, 'getMetricDetails']);

    // Fast repositories endpoint for drilldown (bypasses heavy metrics processing)
    Route::get('/github/repositories-simple', [GitHubMetricDetailsController::class, 'getRepositoriesSimple']);
});

// Test route to verify controller loading
Route::get('/test-oauth', function() {
    return response()->json(['message' => 'Test route working']);
});

// Simple test endpoint to check if backend is responding
Route::get('/test-simple', function() {
    return response()->json([
        'message' => 'Simple test endpoint working',
        'timestamp' => now()->toISOString(),
        'server' => 'Laravel backend'
    ]);
});

// Organization & Invite Routes
Route::middleware(\App\Http\Middleware\SimpleTokenAuth::class)->group(function () {
    // Organization invite management
    Route::post('/org/invites', [InviteController::class, 'create']);
    Route::post('/org/invites/bulk', [InviteController::class, 'bulk']);
    Route::post('/org/invites/resend', [InviteController::class, 'resend']);
    Route::post('/org/invites/{invite}/reissue', [InviteController::class, 'reissue']);
    Route::post('/org/invites/{invite}/accept-link', [InviteController::class, 'acceptLink']);
    Route::delete('/org/invites/{invite}', [InviteController::class, 'destroy']);
    Route::get('/org/invites', [InviteController::class, 'index']);
    Route::post('/org/invites/{invite}/connect-code', [InviteController::class, 'issueConnectCode']);
    Route::delete('/org/invites/{invite}/connect-code', [InviteController::class, 'revokeConnectCode']);

    // Organization cohort management (K1A — server-authoritative membership)
    Route::get('/org/cohorts', [CohortController::class, 'index']);
    Route::post('/org/cohorts', [CohortController::class, 'store']);
    Route::patch('/org/cohorts/{cohort}', [CohortController::class, 'update']);
    Route::post('/org/cohorts/{cohort}/archive', [CohortController::class, 'archive']);
    Route::get('/org/cohorts/{cohort}/members', [CohortController::class, 'members']);
    Route::post('/org/cohorts/{cohort}/members', [CohortController::class, 'addMembers']);
    Route::delete('/org/cohorts/{cohort}/members/{invite}', [CohortController::class, 'removeMember']);

    // Organization user management
    Route::get('/org/users', [OrganizationController::class, 'users']);
    Route::delete('/org/users/{user}', [OrganizationController::class, 'deleteUser']);
    Route::post('/org/users/{user}/role', [OrganizationController::class, 'updateUserRole']);

    // Invite redemption (requires auth)
    Route::post('/invites/{token}/redeem', [InviteController::class, 'redeem']);
});

// Public invite lookup (no auth required)
Route::get('/invites/{token}', [InviteController::class, 'show']);
Route::post('/invites/{token}/accept', [InviteController::class, 'accept']);

// Public shared rollout claim (throttled, no auth required)
Route::post('/rollouts/{token}/claim', [InviteController::class, 'claimRollout'])
    ->middleware(['throttle:10,1']);

// Extension Routes
// Public downloads for pilot onboarding (no ApiAuth auto-Matt dependency)
Route::get('/extension/source/download', [ExtensionController::class, 'downloadSource']);
Route::get('/extension/download/latest', [ExtensionController::class, 'downloadLatest']);
// CR-X P1-1: Claude Code bridge tarball download (mirrors VSIX pattern)
Route::get('/bridge/download/latest', [ExtensionController::class, 'downloadBridgeLatest']);
// C1: Codex telemetry bridge tarball download (same immutable-artifact pattern)
Route::get('/codex-bridge/download/latest', [ExtensionController::class, 'downloadCodexBridgeLatest']);
// Cursor Agent bridge tarball download (same immutable-artifact pattern)
Route::get('/cursor-agent-bridge/download/latest', [ExtensionController::class, 'downloadCursorAgentBridgeLatest'])
    ->name('downloads.cursor-agent-bridge');
// Public capability advertisement — one authoritative contract consumed by
// the Pilot Setup banner, copied instructions, and invite setup payloads.
Route::get('/cursor-agent-bridge/capability', [ExtensionController::class, 'cursorAgentBridgeCapability'])
    ->name('capability.cursor-agent-bridge');

// Build and VSIX download require SimpleTokenAuth (not ApiAuth, which can auto-login as Matt in dev)
Route::middleware(\App\Http\Middleware\SimpleTokenAuth::class)->group(function () {
    Route::post('/extension/build', [ExtensionController::class, 'downloadVSIX']);
    Route::get('/extension/download/{filename}', [ExtensionController::class, 'serveVSIX']);
});

Route::post('/test-post', function() {
    return response()->json(['ok' => true, 'time' => now()]);
});

// Configured Spend Routes — org-scoped tool cost configuration
Route::middleware(\App\Http\Middleware\SimpleTokenAuth::class)->group(function () {
    Route::get('/org/spend/config', [SpendController::class, 'index']);
    Route::put('/org/spend/config', [SpendController::class, 'update']);
    Route::delete('/org/spend/config', [SpendController::class, 'destroyAll']);
    Route::delete('/org/spend/config/{tool_id}', [SpendController::class, 'destroy']);
});

// User settings API routes (MVP - using hardcoded user) - DISABLED to avoid errors
// Route::get('/user/settings', [UserController::class, 'getSettings']);
// Route::put('/user/profile', [UserController::class, 'updateProfile']);
// Route::put('/user/notifications', [UserController::class, 'updateNotifications']);
// Route::put('/user/preferences', [UserController::class, 'updatePreferences']);

// Test route to verify routes file is loading
Route::get('/dev/test', function() {
  return response()->json(['message' => 'Dev routes are loading']);
});

// Dev-only verification auth endpoint (local/testing only)
Route::get('/dev/verification-auth', [DevVerificationAuthController::class, 'createVerificationToken']);
