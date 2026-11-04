<?php

namespace App\Http\Controllers;

use App\Models\ApiToken;
use App\Models\User;
use App\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use App\Traits\PilotAwareTokenHelper;
use App\Traits\TokenAuthority;

class GitHubOAuthController extends Controller
{
    use PilotAwareTokenHelper;
    use TokenAuthority;
    public function redirectToGitHub(Request $request)
    {
        // CR-X P0-0: Read GitHub OAuth config via config(), not env().
        // Direct env() returns null when Laravel config cache is enabled
        // (a past production outage traced to exactly this).  config() reads the cached
        // values resolved at config:cache time.
        $clientId = config('services.github.client_id');
        $redirectUri = config('services.github.redirect');

        // CR-X Wave 2: Intent-based OAuth scope selection.
        //
        // Two explicit intents are supported:
        //   login       — identity login only; scopes limited to read:user,user:email
        //   engineering — GitHub engineering-data connection from Settings;
        //                 transitional classic-OAuth path may request repo
        //
        // Missing/unknown intent defaults to 'login' (fail safe, least privilege).
        // The intent is stored in the verified OAuth state row and read back
        // in the callback — it is NOT trusted from a raw callback query param.
        $intent = $request->get('intent', 'login');
        if (!in_array($intent, ['login', 'engineering'], true)) {
            $intent = 'login';
        }

        // Account creation is always identity-only.  If a conflicting
        // intent=engineering arrives with create_account=true, normalize to
        // login rather than rejecting — the user is trying to create an
        // account, not connect engineering data.  This prevents scope
        // escalation through the account-creation path.
        $isAccountCreation = $request->get('create_account', false);
        if ($isAccountCreation && $intent === 'engineering') {
            Log::warning('CR-X Wave 2: create_account=true with intent=engineering — normalizing to login', [
                'ip' => $request->ip(),
            ]);
            $intent = 'login';
        }

        // CR-X Wave 2: Engineering intent requires authenticated dashboard context.
        //
        // The redirect route is public (Login.vue needs it pre-auth), but
        // intent=engineering must only be honored from an authenticated
        // dashboard user.  We manually resolve the Bearer token here —
        // NOT via route middleware — so login/default remains unauthenticated
        // while engineering fails closed without a valid dashboard token.
        //
        // The initiating organization_id is bound into the verified OAuth
        // state so the callback can confirm the engineering token is issued
        // to the same org that initiated the request.
        $initiatingOrgId = null;
        $initiatingUserId = null;
        if ($intent === 'engineering') {
            $bearer = null;
            $authHeader = $request->header('Authorization');
            if ($authHeader && str_starts_with($authHeader, 'Bearer ')) {
                $bearer = substr($authHeader, 7);
            }
            if (!$bearer) {
                Log::warning('CR-X Wave 2: intent=engineering without Bearer token — failing closed', [
                    'ip' => $request->ip(),
                ]);
                return response()->json([
                    'error' => 'AUTH_REQUIRED',
                    'message' => 'Engineering data connection requires an authenticated dashboard session.',
                ], 403);
            }
            $apiToken = $this->resolveToken($bearer);
            if (!$apiToken) {
                Log::warning('CR-X Wave 2: intent=engineering with invalid Bearer token — failing closed', [
                    'ip' => $request->ip(),
                ]);
                return response()->json([
                    'error' => 'AUTH_REQUIRED',
                    'message' => 'Invalid or expired dashboard token.',
                ], 403);
            }
            $initiatingOrgId = $apiToken->organization_id;
            $initiatingUserId = $apiToken->user_id;

            // Pilot Ops 12: engineering integration is an admin-only action
            if (($apiToken->user->role ?? 'member') !== 'admin') {
                Log::warning('CR-X Wave 2: intent=engineering with non-admin token — failing closed', [
                    'ip' => $request->ip(),
                    'user_id' => $apiToken->user->id,
                    'organization_id' => $initiatingOrgId,
                ]);
                return response()->json([
                    'error' => 'ADMIN_REQUIRED',
                    'message' => 'Only organization admins can connect GitHub Engineering Data.',
                ], 403);
            }

            if (!$initiatingOrgId) {
                Log::warning('CR-X Wave 2: intent=engineering with token lacking organization_id — failing closed', [
                    'ip' => $request->ip(),
                ]);
                return response()->json([
                    'error' => 'AUTH_REQUIRED',
                    'message' => 'Engineering data connection requires an organization context.',
                ], 403);
            }
        }

        $scope = $intent === 'engineering'
            ? 'read:user,user:email,repo'
            : 'read:user,user:email';
        
        // Generate a random state for OAuth security - store in database instead of session
        $state = Str::random(40);
        
        // Check for invite context in request
        $inviteToken = $request->get('invite_token');
        $inviteContext = null;
        
        if ($inviteToken) {
            // Validate invite token and extract context
            $invite = DB::table('invites')
                ->where('token', $inviteToken)
                ->where('redeemed_at', null)
                ->where('expires_at', '>', now())
                ->first();
                
            if ($invite) {
                $inviteContext = [
                    'invite_token' => $inviteToken,
                    'organization_id' => $invite->organization_id,
                    'email' => $invite->email,
                    'role' => $invite->role ?? 'member'
                ];
            }
        }
        
        \DB::table('oauth_tokens')->updateOrInsert(
            ['user_id' => 0], // Use 0 as placeholder for pending auth
            [
                'access_token' => 'pending',
                'oauth_state' => $state,
                'user_data' => json_encode([
                    'state' => 'pending',
                    'is_account_creation' => $isAccountCreation,
                    'invite_context' => $inviteContext,
                    'oauth_intent' => $intent,
                    'initiating_org_id' => $initiatingOrgId,
                    'initiating_user_id' => $initiatingUserId,
                ]),
                'created_at' => now(),
                'updated_at' => now()
            ]
        );
        
        $authUrl = "https://github.com/login/oauth/authorize?" . http_build_query([
            'client_id' => $clientId,
            'redirect_uri' => $redirectUri,
            'scope' => $scope,
            'state' => $state
        ]);
        
        Log::info('Redirecting to GitHub OAuth', [
            'oauth_redirect_issued' => true,
            'is_account_creation' => $isAccountCreation
        ]);
        
        return response()->json([
            'auth_url' => $authUrl,
            'message' => $isAccountCreation ? 'OAuth authorization URL generated for account creation' : 'OAuth authorization URL generated'
        ]);
    }
    
    public function handleCallback(Request $request)
    {
        $code = $request->get('code');
        $state = $request->get('state');
        
        // Verify OAuth state parameter from database
        $pendingAuth = \DB::table('oauth_tokens')->where('user_id', 0)->where('oauth_state', $state)->first();
        if (!$pendingAuth) {
            Log::error('OAuth state mismatch or expired', [
                'error' => 'state_mismatch'
            ]);
            return response()->json(['error' => 'Invalid or expired state parameter'], 400);
        }
        
        if (!$code) {
            Log::error('No authorization code received');
            return response()->json(['error' => 'No authorization code received'], 400);
        }

        // Decode the verified OAuth state once — intent was bound at
        // redirect time and is the only authority for token purpose below.
        $pendingData = json_decode($pendingAuth->user_data ?? '{}', true);
        $verifiedIntent = $pendingData['oauth_intent'] ?? 'login';
        if (!in_array($verifiedIntent, ['login', 'engineering'], true)) {
            $verifiedIntent = 'login';
        }
        $initiatingOrgId = $pendingData['initiating_org_id'] ?? null;
        $initiatingUserId = $pendingData['initiating_user_id'] ?? null;

        // Engineering credentials attach to the dashboard user who
        // initiated the connect — resolved from verified OAuth state, never
        // by github_id.  Dashboard identity and GitHub engineering data are
        // separate authority planes: a password/invite-created dashboard
        // user (github_id NULL) must not fall into new-user admission, and
        // engineering authority must never attach from a GitHub identity
        // match alone.  Validate the initiator here, before the GitHub
        // exchange and before any dashboard-admission logic.
        $initiatingUser = null;
        if ($verifiedIntent === 'engineering') {
            if ($initiatingUserId) {
                $initiatingUser = User::find((int) $initiatingUserId);
            }
            if (!$initiatingUser) {
                Log::warning('CR-X Wave 2: engineering intent without valid initiating user — failing closed', [
                    'initiating_user_id' => $initiatingUserId,
                ]);
                return response()->json([
                    'error' => 'ENGINEERING_INITIATOR_INVALID',
                    'message' => 'Engineering data connection must be initiated by an authenticated dashboard admin. Please sign in and retry.'
                ], 403);
            }
            if (!$initiatingOrgId || (int) $initiatingUser->organization_id !== (int) $initiatingOrgId) {
                Log::warning('CR-X Wave 2: engineering intent initiating org mismatch — failing closed', [
                    'initiating_user_id' => $initiatingUser->id,
                    'initiating_org_id' => $initiatingOrgId,
                    'user_org_id' => $initiatingUser->organization_id,
                ]);
                return response()->json([
                    'error' => 'ENGINEERING_ORG_MISMATCH',
                    'message' => 'Engineering data connection does not match your organization. Please sign in and retry.'
                ], 403);
            }
            if (($initiatingUser->role ?? 'member') !== 'admin') {
                Log::warning('CR-X Wave 2: engineering intent from non-admin initiator — failing closed', [
                    'initiating_user_id' => $initiatingUser->id,
                    'initiating_org_id' => $initiatingOrgId,
                ]);
                return response()->json([
                    'error' => 'ADMIN_REQUIRED',
                    'message' => 'Only organization admins can connect engineering data.'
                ], 403);
            }
        }

        try {
            // Exchange code for access token
            $response = Http::asForm()->post('https://github.com/login/oauth/access_token', [
                'client_id' => config('services.github.client_id'),
                'client_secret' => config('services.github.client_secret'),
                'code' => $code,
                'redirect_uri' => config('services.github.redirect')
            ]);
            
            Log::info('GitHub OAuth token exchange response', [
                'status' => $response->status(),
            ]);
            
            // GitHub OAuth responses are form-encoded, not JSON
            $responseBody = $response->body();
            parse_str($responseBody, $tokenData);
            
            Log::info('GitHub OAuth token exchange completed', [
                'has_access_token' => isset($tokenData['access_token']),
            ]);
            
            if (!$tokenData) {
                Log::error('GitHub OAuth token exchange failed - no response data');
                return response()->json(['error' => 'OAuth token exchange failed - no response data'], 400);
            }
            
            if (isset($tokenData['error'])) {
                Log::error('GitHub OAuth error', [
                    'error' => $tokenData['error'] ?? 'unknown',
                ]);
                return response()->json(['error' => 'OAuth token exchange failed: ' . ($tokenData['error_description'] ?? $tokenData['error'])], 400);
            }
            
            if (!isset($tokenData['access_token'])) {
                Log::error('GitHub OAuth error - no access token in response', [
                    'has_error_key' => isset($tokenData['error']),
                ]);
                return response()->json(['error' => 'OAuth token exchange failed - no access token received'], 400);
            }
            
            $accessToken = $tokenData['access_token'];
            
            // Get user info with the new token
            $userResponse = Http::withHeaders([
                'Authorization' => 'token ' . $accessToken,
                'Accept' => 'application/vnd.github.v3+json'
            ])->get('https://api.github.com/user');
            
            if (!$userResponse->successful()) {
                Log::error('GitHub user info request failed', [
                    'status' => $userResponse->status(),
                    'body' => $userResponse->body()
                ]);
                return response()->json(['error' => 'Failed to get user info from GitHub'], 400);
            }
            
            $userData = $userResponse->json();
            
            if (!$userData || !isset($userData['login'])) {
                Log::error('GitHub user info response invalid', $userData);
                return response()->json(['error' => 'Invalid user info response from GitHub'], 400);
            }
            
            // Extract user data
            $githubId = $userData['id'];
            $email = $userData['email'];
            $name = $userData['name'] ?? $userData['login'];
            $username = $userData['login']; // GitHub username (always available)
            
            // If email is null, fetch primary verified email from GitHub
            if (!$email) {
                $emailsResponse = Http::withHeaders([
                    'Authorization' => 'token ' . $accessToken,
                    'Accept' => 'application/vnd.github.v3+json'
                ])->get('https://api.github.com/user/emails');
                
                if ($emailsResponse->successful()) {
                    $emails = $emailsResponse->json();
                    foreach ($emails as $emailData) {
                        if ($emailData['primary'] && $emailData['verified']) {
                            $email = $emailData['email'];
                            break;
                        }
                    }
                }
                
                // If still no email after API call, use username as fallback
                if (!$email) {
                    $email = $username . '@github.local'; // Use username as fallback
                    Log::info('Using username as email fallback', ['username' => $username, 'fallback_email' => $email]);
                }
            }
            
            // Engineering intent resolves the initiating dashboard user from
            // verified OAuth state; ordinary login resolves by github_id.
            // github_id is never required or written for engineering attach —
            // dashboard identity and engineering authority remain separate.
            $user = $verifiedIntent === 'engineering'
                ? $initiatingUser
                : User::where('github_id', $githubId)->first();

            // If user does not exist, create new user with proper org assignment
            if (!$user) {
                // CR-X defensive: if a user with this GitHub email already exists
                // (created via invite/password), do NOT create a duplicate user.
                // Return a controlled error so the human can log in with their
                // existing email/password or contact their admin for account linking.
                $existingByEmail = User::where('email', $email)->first();
                if ($existingByEmail) {
                    Log::warning('OAuth: email collision — existing account found for GitHub email', [
                        'github_id' => $githubId,
                        'email' => $email,
                        'existing_user_id' => $existingByEmail->id,
                    ]);
                    return response()->json([
                        'error' => 'EMAIL_ALREADY_EXISTS',
                        'message' => 'An account with this email already exists. Please sign in with your email and password, or contact your administrator to link your GitHub account.',
                    ], 409);
                }

                // Read invite_context from the verified pending oauth state,
                // NOT from the GitHub /user response (which won't have it)
                $inviteContext = $pendingData['invite_context'] ?? null;
                $pilotOrg = $this->getPilotOrg();

                // Invite context takes precedence over pilot direct-OAuth assignment
                if ($inviteContext && isset($inviteContext['organization_id'])) {
                    // Case 2: Invited user - validate the dashboard invite
                    $invite = DB::table('invites')
                        ->where('token', $inviteContext['invite_token'] ?? '')
                        ->whereNull('redeemed_at')
                        ->where('expires_at', '>', now())
                        ->first();

                    if (!$invite) {
                        return response()->json([
                            'error' => 'DASHBOARD_INVITE_REQUIRED',
                            'message' => 'The invite is missing, expired, or already used. Please request a new dashboard invitation.',
                        ], 403);
                    }

                    // Developer Enrollment invites must not grant dashboard
                    // access. PILOT OPS 18H: any code row — live, revoked, or
                    // legacy-expired — marks the invite's purpose as developer
                    // enrollment. used_at is non-authoritative and unused.
                    $hasConnectCode = DB::table('ide_connect_codes')
                        ->where('invite_id', $invite->id)
                        ->exists();

                    if ($hasConnectCode) {
                        return response()->json([
                            'error' => 'DEVELOPER_ENROLLMENT_INVITE',
                            'message' => 'This invite is for developer enrollment only and cannot be used for dashboard access.',
                        ], 403);
                    }

                    $organization = Organization::find($inviteContext['organization_id']);
                    
                    if (!$organization) {
                        return response()->json(['error' => 'Invalid invite organization'], 400);
                    }
                    
                    Log::info('OAuth: Creating user in invited organization', [
                        'github_id' => $githubId,
                        'organization_id' => $organization->id,
                    ]);
                    
                } else {
                    $pilotOrg = $this->getPilotOrg();
                    if ($pilotOrg) {
                        // Pilot Ops 12: unknown GitHub user without a dashboard invite
                        return response()->json([
                            'error' => 'DASHBOARD_INVITE_REQUIRED',
                            'message' => 'Dashboard access requires an invitation. Please use an invite link or contact your organization administrator.',
                        ], 403);
                    }

                    // Normal mode: create personal org
                    $organization = Organization::create([
                        'name' => "{$name}'s Organization",
                        'slug' => Str::slug($userData['login']) . '-' . Str::random(6)
                    ]);
                    Log::info('OAuth: Creating user with new organization', [
                        'github_id' => $githubId,
                        'organization_id' => $organization->id
                    ]);
                }

                // Create new User
                $role = 'member';
                if ($inviteContext && isset($inviteContext['role']) && in_array($inviteContext['role'], ['admin', 'member'], true)) {
                    $role = $inviteContext['role'];
                } elseif (!$pilotOrg) {
                    // Normal multi-tenant mode: first user is admin of their own org
                    $role = 'admin';
                }
                $user = User::create([
                    'name' => $name,
                    'email' => $email,
                    'password' => Hash::make(Str::random(32)),
                    'github_id' => $githubId,
                    'organization_id' => $organization->id,
                    'role' => $role
                ]);

                // If this was an invite, mark it as redeemed
                if ($inviteContext && isset($inviteContext['invite_token'])) {
                    DB::table('invites')
                        ->where('token', $inviteContext['invite_token'])
                        ->update([
                            'redeemed_at' => now(),
                            'redeemed_by_user_id' => $user->id,
                            'updated_at' => now(),
                        ]);

                    Log::info('OAuth: Dashboard invite redeemed automatically', [
                        'user_id' => $user->id
                    ]);
                }

            } else {
                // Case 1: Existing local user - reuse their existing org
                if (!$user->organization_id) {
                    $pilotOrg = $this->getPilotOrg();
                    if ($pilotOrg) {
                        $user->organization_id = $pilotOrg->id;
                        $user->role = $user->role ?: 'member';
                        $user->save();
                    }
                }
                Log::info('OAuth: Found existing user', [
                    'github_id' => $githubId,
                    'user_id' => $user->id,
                    'organization_id' => $user->organization_id
                ]);
            }
            
            // Log user in
            Auth::login($user);
            // Note: Don't regenerate session here as it can cause session loss
            // $request->session()->regenerate();
            
            // CR-X Wave 2: Token purpose is derived from the VERIFIED OAuth intent
            // stored in the state row, NOT from role-based auto-escalation.
            //
            //   intent=login       → identity_only (always, even for non-support)
            //   intent=engineering → engineering_integration (if not support login)
            //   missing/unknown    → identity_only (fail safe)
            //   support login      → identity_only (always, regardless of intent)
            //
            // This ensures a plain dashboard login NEVER produces an engineering
            // token, even if the org lacks one. Engineering authorization is a
            // distinct deliberate action from Settings.
            // ($pendingData / $verifiedIntent / $initiatingOrgId were decoded
            // and validated from the verified state before user resolution.)

            // CR-X Wave 2: For engineering intent, verify the initiating org
            // context bound in the verified OAuth state matches the resolved
            // user's organization.  This prevents an engineering token from
            // being issued to a different org than the one that initiated
            // the authenticated Settings request.
            if ($verifiedIntent === 'engineering') {
                if (!$initiatingOrgId || (int) $initiatingOrgId !== (int) $user->organization_id) {
                    Log::warning('CR-X Wave 2: engineering intent org mismatch — downgrading to identity_only', [
                        'user_id' => $user->id,
                        'login' => $username,
                        'initiating_org_id' => $initiatingOrgId,
                        'user_org_id' => $user->organization_id,
                    ]);
                    $verifiedIntent = 'login';
                }
            }

            $isSupport = $this->isSupportLogin($username);
            $tokenPurpose = 'identity_only';

            if ($verifiedIntent === 'engineering' && !$isSupport) {
                $tokenPurpose = 'engineering_integration';
                Log::info('CR-X Wave 2: Token classified engineering_integration from verified OAuth intent', [
                    'user_id' => $user->id,
                    'login' => $username,
                    'organization_id' => $user->organization_id,
                    'intent' => $verifiedIntent,
                ]);
            } else {
                Log::info('CR-X Wave 2: Token classified identity_only', [
                    'user_id' => $user->id,
                    'login' => $username,
                    'organization_id' => $user->organization_id,
                    'intent' => $verifiedIntent,
                    'is_support' => $isSupport,
                ]);
            }

            $userData['token_purpose'] = $tokenPurpose;

            // PILOT OPS 18G: identity and engineering credentials persist in
            // separate purpose-scoped rows.  The previous updateOrInsert on
            // user_id alone kept a single row per user, so an ordinary login
            // overwrote a valid engineering_integration credential with
            // identity_only and silently destroyed org engineering authority.
            $this->upsertOAuthCredential(
                (int) $user->id,
                $user->organization_id ? (int) $user->organization_id : null,
                $accessToken,
                $tokenPurpose,
                $userData
            );
            
            // Session storage no longer needed - everything is in database

            // Generate a one-time handoff code — the raw dashboard token is never
            // placed in the redirect URL.  Only user_id and organization_id are
            // cached; the real token is generated during the exchange step.
            $handoffCode = Str::random(48);
            $cacheKey = 'oauth_handoff:' . hash('sha256', $handoffCode);

            Cache::put($cacheKey, [
                'user_id' => $user->id,
                'organization_id' => $user->organization_id,
            ], now()->addSeconds(120));

            Log::info('OAuth authentication successful', [
                'user' => $userData['login'] ?? 'unknown',
                'user_id' => $userData['id'] ?? 0,
                'token_stored_in_db' => true,
                'handoff_code_issued' => true,
            ]);

            // Redirect to frontend with opaque one-time handoff code.
            // CR-X P0-0: Read frontend URL via config(), not env().
            // config('app.frontend_url') is resolved at config:cache time
            // and survives config:cache; direct env() does not.
            $frontendUrl = config('app.frontend_url');

            return redirect("{$frontendUrl}/callback?oauth_success=true&handoff_code={$handoffCode}");
            
        } catch (\Exception $e) {
            Log::error('OAuth callback error', ['error' => $e->getMessage(), 'trace' => $e->getTraceAsString()]);
            return response()->json(['error' => 'OAuth callback failed: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Exchange a one-time handoff code for a dashboard API token.
     *
     * The handoff code is consumed atomically via Cache::pull (single-use).
     * Only user_id and organization_id were cached — no raw token is stored.
     * The real dashboard token is generated here and returned in the JSON body.
     *
     * Client-supplied user_id or organization_id fields are ignored.
     */
    public function exchangeDashboardToken(Request $request): JsonResponse
    {
        $code = $request->input('handoff_code');

        if (!$code || !is_string($code)) {
            return response()->json(['error' => 'Invalid handoff code.'], 400);
        }

        $cacheKey = 'oauth_handoff:' . hash('sha256', $code);

        // Atomic single-use consumption
        $handoff = Cache::pull($cacheKey);

        if (!$handoff) {
            return response()->json(['error' => 'Invalid or expired handoff code.'], 400);
        }

        $userId = (int) ($handoff['user_id'] ?? 0);
        $organizationId = (int) ($handoff['organization_id'] ?? 0);

        if ($userId <= 0 || $organizationId <= 0) {
            return response()->json(['error' => 'Invalid or expired handoff code.'], 400);
        }

        $user = User::find($userId);
        if (!$user || (int) $user->organization_id !== $organizationId) {
            return response()->json(['error' => 'Invalid or expired handoff code.'], 400);
        }

        // Generate the real dashboard token only after successful handoff
        $dashboardToken = ApiToken::generateDashboardToken($userId, $organizationId);
        $rawDashboardToken = $dashboardToken['raw'];

        Log::info('Dashboard token issued via handoff exchange', [
            'user_id' => $userId,
            'organization_id' => $organizationId,
        ]);

        return response()->json([
            'dashboard_token' => $rawDashboardToken,
            'token_type' => 'Bearer',
        ]);
    }

    public function getOAuthStatus()
    {
        // CR-X P0: Organization-scoped engineering integration state.
        // GitHub authentication is user-scoped, but engineering data
        // integration is organization-scoped: any org member's
        // engineering_integration token makes the org connected.
        // We prefer the org's engineering token over the latest token
        // by updated_at (which may be an identity_only token from a
        // different member who logged in more recently).
        $pilotSlug = $this->pilotOrgSlug();
        $supportLogins = $this->supportGitHubLogins();

        // Resolve the pilot org ID for org-scoped engineering lookup
        $orgId = null;
        if ($pilotSlug) {
            $pilotOrg = \DB::table('organizations')->where('slug', $pilotSlug)->first();
            if ($pilotOrg) {
                $orgId = $pilotOrg->id;
            }
        }

        // Try org-scoped engineering integration token first
        if ($orgId) {
            $engUser = $this->getOrgEngineeringUser($orgId);
            if ($engUser) {
                $engToken = $this->getOrgEngineeringToken($orgId);
                $repoAuthority = $this->resolveCustomerRepoAuthority($engToken, $engUser, $orgId);
                return response()->json([
                    'oauth_authenticated' => true,
                    'user' => $engUser,
                    'token_type' => 'oauth',
                    'token_purpose' => 'engineering_integration',
                    // CR-X 18B: distinguish engineering token from customer repo authority
                    'repo_authority' => $repoAuthority,
                    'repo_authority_message' => $repoAuthority
                        ? 'GitHub account can see customer repositories that appear in this organization\'s telemetry.'
                        : 'Connected engineering account cannot see any customer repositories from this organization\'s telemetry. Grant the account access to the organization\'s repositories.',
                ]);
            }
        }

        // Dev mode (no pilot slug): scan all tokens for engineering_integration
        // before falling back to the latest token.  This ensures dev/local
        // environments also prefer engineering tokens over identity_only.
        if (!$pilotSlug && empty($supportLogins)) {
            $allTokens = \DB::table('oauth_tokens')
                ->where('access_token', '!=', 'pending')
                ->whereNotNull('access_token')
                ->orderBy('updated_at', 'desc')
                ->get();
            foreach ($allTokens as $tokenRow) {
                $userData = json_decode($tokenRow->user_data ?? '{}', true);
                if (($userData['token_purpose'] ?? null) === 'engineering_integration') {
                    return response()->json([
                        'oauth_authenticated' => true,
                        'user' => $userData,
                        'token_type' => 'oauth',
                        'token_purpose' => 'engineering_integration',
                    ]);
                }
            }
        }

        // No engineering integration — fall back to latest non-support token
        // for personal identity display (identity_only or no token).
        if ($pilotSlug || !empty($supportLogins)) {
            // Pilot mode: use safe token retrieval
            $token = $this->getMetricsSafeOAuthToken();
            $userData = null;
            $dbToken = null;
            if ($token) {
                $dbToken = \DB::table('oauth_tokens')
                    ->where('access_token', $token)
                    ->first();
                if ($dbToken) {
                    $userData = json_decode($dbToken->user_data, true);
                }
            }
            $oauthToken = $token;
        } else {
            // Dev mode: latest global token (preserves existing behavior)
            $dbToken = \DB::table('oauth_tokens')
                ->where('access_token', '!=', 'pending')
                ->latest('updated_at')
                ->first();
            $oauthToken = null;
            $userData = null;
            if ($dbToken) {
                $oauthToken = $dbToken->access_token;
                $userData = json_decode($dbToken->user_data, true);
            }
        }
        
        $tokenOrgId = $dbToken ? ($dbToken->organization_id ?? 0) : 0;
        $repoAuthority = $oauthToken ? $this->resolveCustomerRepoAuthority($oauthToken, $userData, (int) $tokenOrgId) : false;

        return response()->json([
            'oauth_authenticated' => !empty($oauthToken),
            'user' => $userData ?? null,
            'token_type' => $oauthToken ? 'oauth' : 'personal_access_token',
            // CR-X B6: Expose token_purpose so the frontend can surface
            // engineering-evidence connection state in Settings and Pilot Health.
            // 'engineering_integration' = can produce PR/release/deployment evidence.
            // 'identity_only' = identity only, zero engineering evidence.
            'token_purpose' => $userData['token_purpose'] ?? null,
            // Dedicated GitHub App: true once the customer's installation ID
            // is configured. App installation is an independent
            // engineering-evidence authority — it does not require the
            // broad OAuth 'repo' scope.
            'github_app_installed' => !empty(config('services.github_app.installation_id')),
            // CR-X 18B: customer repo authority gate
            'repo_authority' => $repoAuthority,
            'repo_authority_message' => $oauthToken && !$repoAuthority
                ? 'Connected account cannot see any customer repositories from this organization\'s telemetry. Grant the account access to the organization\'s repositories.'
                : 'GitHub account can see customer repositories that appear in this organization\'s telemetry.',
        ]);
    }
    
    public function revokeOAuth(Request $request)
    {
        $user = $request->get('authenticated_user');
        if (!$user) {
            return response()->json(['error' => 'Authentication required'], 401);
        }

        // Find OAuth tokens belonging ONLY to the authenticated user
        $userTokens = \DB::table('oauth_tokens')
            ->where('user_id', $user->id)
            ->where('access_token', '!=', 'pending')
            ->get();

        $revokedRemote = 0;
        foreach ($userTokens as $dbToken) {
            $oauthToken = $dbToken->access_token;

            // Revoke this user's OAuth token with GitHub
            try {
                Http::withHeaders([
                    'Authorization' => 'token ' . $oauthToken
                ])->delete('https://api.github.com/applications/' . config('services.github.client_id') . '/token', [
                    'access_token' => $oauthToken
                ]);
                $revokedRemote++;
            } catch (\Exception $e) {
                Log::warning('Failed to revoke OAuth token at GitHub', ['error' => $e->getMessage()]);
            }
        }

        // Delete ONLY the authenticated user's OAuth tokens (including pending placeholders)
        $deleted = \DB::table('oauth_tokens')
            ->where('user_id', $user->id)
            ->delete();

        return response()->json([
            'success' => true,
            'message' => 'OAuth token revoked for current user',
            'tokens_deleted' => $deleted,
            'remote_revoked' => $revokedRemote,
        ]);
    }
} 