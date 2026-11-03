<?php

namespace App\Http\Controllers;

use App\Models\ApiToken;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class ApiTokenController extends Controller
{
    /**
     * Generate a new API token for the authenticated user
     */
    public function generate(Request $request)
    {
        // For now, we'll use the first user (should be authenticated via GitHub OAuth)
        $user = User::first();
        
        if (!$user) {
            return response()->json(['error' => 'No user found'], 404);
        }
        
        // Revoke existing tokens for this user
        ApiToken::where('user_id', $user->id)->update(['revoked_at' => now()]);
        
        // Generate new token (hashed)
        $rawToken = Str::random(60);
        
        $apiToken = ApiToken::create([
            'user_id' => $user->id,
            'organization_id' => $user->organization_id,
            'token' => hash('sha256', $rawToken),
            'expires_at' => now()->addMonths(6),
        ]);
        
        Log::info('API token generated', [
            'user_id' => $user->id,
            'organization_id' => $user->organization_id,
            'token_id' => $apiToken->id,
            'token_preview' => substr($rawToken, 0, 8) . '...'
        ]);
        
        return response()->json([
            'token' => $rawToken,
            'expires_at' => $apiToken->expires_at,
            'message' => 'Use this token in your Windsurf extension configuration'
        ]);
    }
    
    /**
     * List active API tokens for the user
     */
    public function index(Request $request)
    {
        $user = User::first();
        
        if (!$user) {
            return response()->json(['error' => 'No user found'], 404);
        }
        
        $tokens = ApiToken::where('user_id', $user->id)
            ->whereNull('revoked_at')
            ->where('expires_at', '>', now())
            ->get(['id', 'expires_at', 'created_at']);
        
        return response()->json($tokens);
    }
    
    /**
     * Validate an API token
     */
    public function validateToken(Request $request)
    {
        $token = $request->input('token');
        
        if (!$token) {
            return response()->json(['valid' => false, 'error' => 'Token required']);
        }
        
        $apiToken = ApiToken::findValidToken($token);
        
        if (!$apiToken) {
            return response()->json(['valid' => false, 'error' => 'Invalid or expired token']);
        }
        
        return response()->json([
            'valid' => true,
            'user' => $apiToken->user->name ?? $apiToken->user->email,
            'organization' => $apiToken->organization->name ?? 'Default',
            'expires_at' => $apiToken->expires_at
        ]);
    }
    
    /**
     * Get IDE configuration for Windsurf extension
     */
    public function getIdeConfig(Request $request)
    {
        // For now, use the first user for demo purposes
        // In production, this should require proper authentication
        $user = \App\Models\User::first();
        
        if (!$user) {
            return response()->json(['error' => 'No user found - please authenticate first'], 404);
        }
        
        // Generate or get existing API token for this user
        $apiToken = ApiToken::where('user_id', $user->id)
            ->whereNull('revoked_at')
            ->where('expires_at', '>', now())
            ->first();
        
        if (!$apiToken) {
            // Generate a new token
            $rawToken = Str::random(60);
            $apiToken = ApiToken::create([
                'user_id' => $user->id,
                'organization_id' => $user->organization_id ?? 1,
                'token' => hash('sha256', $rawToken),
                'expires_at' => now()->addMonths(6),
            ]);
        }
        
        return response()->json([
            'api_token' => $rawToken ?? null,
            'api_url' => config('app.url') ?: 'http://127.0.0.1:8010',
            'telemetry_endpoint' => '/api/telemetry',
            'connect_endpoint' => '/api/ide/connect/exchange',
            'expires_at' => $apiToken->expires_at,
            'user' => [
                'id' => $user->id,
                'name' => $user->name ?? $user->email,
                'email' => $user->email,
            ],
            'organization' => [
                'id' => $user->organization_id ?? 1,
                'name' => 'Default Organization',
            ]
        ]);
    }
}
