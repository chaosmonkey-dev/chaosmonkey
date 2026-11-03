<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use App\Models\User;
use App\Models\ApiToken;

class AuthController extends Controller
{
    /**
     * Email/password dashboard login.
     *
     * Uses the existing users.password column (populated by invite acceptance
     * or GitHub OAuth fallback).  Issues a dashboard token through the existing
     * ApiToken::generateDashboardToken authority.  Rate-limited via route
     * middleware (throttle:5,1).
     */
    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email'    => 'required|string',
            'password' => 'required|string',
        ], [
            'email.required'    => 'Email is required',
            'password.required' => 'Password is required',
        ]);

        // Normalize email: lowercase + trim
        $email = strtolower(trim($validated['email']));
        $password = $validated['password'];

        $user = User::where('email', $email)->first();

        if (!$user) {
            // Generic error — do not leak whether the email exists
            return response()->json([
                'error'   => 'Invalid credentials',
                'message' => 'Email or password is incorrect',
            ], 401);
        }

        // Verify password against the stored hash.
        // User model casts password as 'hashed', so the raw DB value is the hash.
        // Hash::check compares the plain-text against the stored hash.
        $storedHash = $user->getAttributes()['password'] ?? null;
        if (!$storedHash || !Hash::check($password, $storedHash)) {
            return response()->json([
                'error'   => 'Invalid credentials',
                'message' => 'Email or password is incorrect',
            ], 401);
        }

        // Ensure the user has an organization
        if (!$user->organization_id) {
            return response()->json([
                'error'   => 'No organization',
                'message' => 'This account is not associated with an organization',
            ], 403);
        }

        // Issue dashboard token through the existing token authority
        $dashboardToken = ApiToken::generateDashboardToken($user->id, $user->organization_id);
        $rawToken = $dashboardToken['raw'];

        Log::info('Email/password login successful', [
            'user_id'         => $user->id,
            'organization_id' => $user->organization_id,
            'has_github_id'   => !empty($user->github_id),
        ]);

        return response()->json([
            'dashboard_token' => $rawToken,
            'token_type'      => 'Bearer',
            'user' => [
                'id'              => $user->id,
                'name'            => $user->name,
                'email'           => $user->email,
                'organization_id' => $user->organization_id,
                'role'            => $user->role ?? 'member',
            ],
        ]);
    }

    /**
     * Dashboard logout — revokes the current API token.
     *
     * Unlike the old GitHub OAuth revoke (which deleted oauth_tokens), this
     * endpoint only revokes the dashboard ApiToken row, leaving GitHub OAuth
     * state and engineering integration tokens untouched.
     */
    public function logout(Request $request): JsonResponse
    {
        $apiToken = $request->get('authenticated_api_token');
        $user = $request->get('authenticated_user');

        if (!$apiToken) {
            // No token resolved — still return success so the frontend can clean up
            return response()->json(['success' => true, 'message' => 'Logged out']);
        }

        $apiToken->revoke();

        Log::info('Dashboard token revoked via logout', [
            'user_id'         => $user?->id,
            'organization_id'  => $user?->organization_id,
            'api_token_id'     => $apiToken->id,
        ]);

        return response()->json(['success' => true, 'message' => 'Logged out']);
    }
}
