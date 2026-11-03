<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Models\ApiToken;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use App\Traits\PilotAwareTokenHelper;
use App\Traits\TokenAuthority;

class SimpleTokenAuth
{
    use PilotAwareTokenHelper;
    use TokenAuthority;
    public function handle(Request $request, Closure $next)
    {
        // Skip token auth for specific public routes
        $publicRoutes = [
            '/api/test-simple',
            '/api/telemetry/test',
            '/api/github/oauth/status',
            '/api/github/oauth/redirect',
            '/api/github/oauth/callback',
            '/api/github/oauth/dashboard-token',
        ];
        
        if (in_array($request->path(), $publicRoutes)) {
            return $next($request);
        }
        
        // Check API token authentication - support multiple formats
        $token = null;
        
        // Try Authorization header (Bearer token)
        if ($request->header('Authorization')) {
            $authHeader = $request->header('Authorization');
            if (str_starts_with($authHeader, 'Bearer ')) {
                $token = substr($authHeader, 7);
            } else {
                $token = $authHeader; // Try raw token
            }
        }
        
        // Try X-Api-Token header
        if (!$token && $request->header('X-Api-Token')) {
            $token = $request->header('X-Api-Token');
        }
        
        // Try chaosmonkey-auth-token header
        if (!$token && $request->header('chaosmonkey-auth-token')) {
            $token = $request->header('chaosmonkey-auth-token');
        }
        
        // Try query parameter — LOCAL/TESTING DEBUGGING ONLY.
        // Query-string tokens leak via browser history, server access logs,
        // and Referer headers to any third-party resource loaded by the page.
        // This fallback previously had no environment or path restriction,
        // meaning any protected route (org/users, metrics, repositories, etc.)
        // could be accessed via a URL-embedded token in production.
        if (!$token && $request->query('token') && app()->environment(['local', 'testing'])) {
            $token = $request->query('token');
        }
        
        if (!$token) {
            return response()->json([
                'error' => 'API token required',
                'message' => 'Authentication required. Please log in via GitHub OAuth to obtain a dashboard credential.',
                'path' => $request->path()
            ], 401);
        }

        // Reject the literal sentinel that was used before request-bound credentials
        if ($token === 'oauth_authenticated') {
            return response()->json([
                'error' => 'Invalid credential',
                'message' => 'The oauth_authenticated sentinel is not a valid API credential. Please re-authenticate.',
            ], 401);
        }

        // Validate token using shared authority (hash-first, legacy fallback)
        $apiToken = $this->resolveToken($token);
            
        if (!$apiToken) {
            return response()->json(['error' => 'Invalid or expired API token'], 401);
        }

        // Invite-backed tokens are restricted to telemetry ingestion + renewal
        if ($apiToken->invite_id) {
            $telemetryOnlyPaths = [
                'api/telemetry',
                'api/telemetry/upload',
                'api/ide/connect/renew',
            ];
            if (!in_array($request->path(), $telemetryOnlyPaths)) {
                return response()->json([
                    'error' => 'Invite-backed tokens are only valid for telemetry ingestion',
                    'error_code' => 'TELEMETRY_ONLY_TOKEN',
                ], 403);
            }
        }

        // Add authenticated user to request
        $request->merge(['authenticated_user' => $apiToken->user]);
        $request->merge(['authenticated_api_token' => $apiToken]);
        
        return $next($request);
    }
}
