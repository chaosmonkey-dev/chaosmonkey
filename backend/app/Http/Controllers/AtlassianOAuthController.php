<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class AtlassianOAuthController extends Controller
{
    public function redirectToAtlassian()
    {
        // Read via config() so values survive `php artisan config:cache`.
        $clientId = config('services.atlassian.client_id');
        $redirectUri = config('services.atlassian.redirect');

        // Basic validation for required config
        $missing = [];
        if (!$clientId) $missing[] = 'ATLASSIAN_CLIENT_ID';

        if (!empty($missing)) {
            Log::error('Atlassian OAuth misconfigured', ['missing' => $missing]);
            return response()->json([
                'error' => 'ATLASSIAN_OAUTH_MISCONFIGURED',
                'missing' => $missing
            ], 500);
        }

        $state = Str::random(40);
        \DB::table('oauth_tokens')->updateOrInsert(
            ['user_id' => 0],
            [
                'access_token' => 'pending',
                'oauth_state' => $state,
                'user_data' => json_encode(['state' => 'pending']),
                'created_at' => now(),
                'updated_at' => now()
            ]
        );

        $params = [
            'audience' => 'api.atlassian.com',
            'client_id' => $clientId,
            'scope' => 'offline_access read:me',
            'redirect_uri' => $redirectUri,
            'response_type' => 'code',
            'prompt' => 'consent',
            'state' => $state
        ];

        $authUrl = 'https://auth.atlassian.com/authorize?' . http_build_query($params);

        Log::info('Redirecting to Atlassian OAuth', ['auth_url' => $authUrl]);

        return response()->json([
            'auth_url' => $authUrl,
            'message' => 'Atlassian OAuth authorization URL generated'
        ]);
    }

    public function handleCallback(Request $request)
    {
        $code = $request->get('code');
        $state = $request->get('state');

        $pendingAuth = \DB::table('oauth_tokens')->where('user_id', 0)->where('oauth_state', $state)->first();
        if (!$pendingAuth) {
            Log::error('Atlassian OAuth state mismatch or expired', ['received_state' => $state]);
            return response()->json(['error' => 'Invalid or expired state parameter'], 400);
        }

        if (!$code) {
            Log::error('No authorization code received from Atlassian');
            return response()->json(['error' => 'No authorization code received'], 400);
        }

        // Exchange code for token if configured — read via config() so
        // values survive `php artisan config:cache`.
        $clientId = config('services.atlassian.client_id');
        $clientSecret = config('services.atlassian.client_secret');
        $redirectUri = config('services.atlassian.redirect');

        $missing = [];
        if (!$clientId) $missing[] = 'ATLASSIAN_CLIENT_ID';
        if (!$clientSecret) $missing[] = 'ATLASSIAN_CLIENT_SECRET';

        if (!empty($missing)) {
            Log::error('Atlassian OAuth callback misconfigured', ['missing' => $missing]);
            return response()->json([
                'error' => 'ATLASSIAN_OAUTH_MISCONFIGURED',
                'missing' => $missing
            ], 500);
        }

        try {
            $response = Http::asForm()->post('https://auth.atlassian.com/oauth/token', [
                'grant_type' => 'authorization_code',
                'client_id' => $clientId,
                'client_secret' => $clientSecret,
                'code' => $code,
                'redirect_uri' => $redirectUri
            ]);

            Log::info('Atlassian token exchange response', ['status' => $response->status(), 'body' => substr($response->body(), 0, 600)]);

            if (!$response->successful()) {
                Log::error('Atlassian token exchange failed', ['status' => $response->status(), 'body' => $response->body()]);
                return response()->json(['error' => 'Atlassian token exchange failed', 'status' => $response->status(), 'body' => substr($response->body(), 0, 600)], 400);
            }

            $tokenData = $response->json();
            if (!isset($tokenData['access_token'])) {
                Log::error('Atlassian token response missing access_token', $tokenData);
                return response()->json(['error' => 'Atlassian token exchange failed - no access token received'], 400);
            }

            $accessToken = $tokenData['access_token'];

            // Optionally fetch account info from Atlassian
            $accountResp = Http::withHeaders(['Authorization' => 'Bearer ' . $accessToken])->get('https://api.atlassian.com/me');
            $account = $accountResp->successful() ? $accountResp->json() : null;

            \DB::table('oauth_tokens')->updateOrInsert(
                ['user_id' => $account['account_id'] ?? 0],
                [
                    'access_token' => $accessToken,
                    'user_data' => json_encode($account ?? ['atlassian' => 'unknown']),
                    'created_at' => now(),
                    'updated_at' => now()
                ]
            );

            Log::info('Atlassian OAuth successful', ['account' => $account ?? null]);

            $frontendUrl = config('app.frontend_url', 'http://localhost:5174') . '/callback?oauth_success=true&provider=atlassian';
            return redirect($frontendUrl);

        } catch (\Exception $e) {
            Log::error('Atlassian OAuth callback error', ['error' => $e->getMessage(), 'trace' => $e->getTraceAsString()]);
            return response()->json(['error' => 'Atlassian OAuth callback failed: ' . $e->getMessage()], 500);
        }
    }
}
