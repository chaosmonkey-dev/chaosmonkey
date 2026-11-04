<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Models\Organization;
use App\Traits\PilotAwareTokenHelper;
use Illuminate\Auth\Middleware\Authenticate as Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class ApiAuth extends Middleware
{
    use PilotAwareTokenHelper;

    /**
     * Get the path the user should be redirected to when they are not authenticated.
     *
     * In pilot mode: never auto-login. Return null so unauthenticated() fires,
     * which returns 401 for JSON requests.
     *
     * In local/dev mode only: auto-create/authenticate a default user to preserve
     * existing development workflow.
     */
    protected function redirectTo(Request $request): ?string
    {
        if (!Auth::check()) {
            // Pilot mode: never auto-login — let unauthenticated() return 401
            if ($this->isPilotMode()) {
                return null;
            }

            // Dev auto-login is strictly limited to local/testing. In every
            // other environment (production, staging, anything unset) the
            // request must fail closed to a 401 — never mint a default user.
            if (app()->environment(['local', 'testing'])) {
                $this->createAndAuthenticateDefaultUser();
            }
        }

        // If Auth::user() exists, set request authenticated_user
        $user = Auth::user();
        if ($user) {
            $request->merge(['authenticated_user' => $user]);
        }

        return null;
    }

    /**
     * Create and authenticate a default user and organization if none exist.
     *
     * DEV MODE ONLY — guarded by app()->environment(['local','testing'])
     * at the call site, so this can never run in production.
     */
    private function createAndAuthenticateDefaultUser(): void
    {
        // Dev fallback: user id 4 (Matt) — only in local/dev mode
        $user = User::find(4);

        if (!$user) {
            // Create default organization
            $organization = Organization::create([
                'name' => 'Default Organization',
                'slug' => 'default-' . time(),
            ]);

            // Create default user (dev only — password is a random throwaway;
            // real accounts are created via invites or chaosmonkey:create-admin)
            $user = User::create([
                'name' => 'Default User',
                'email' => 'default@example.com',
                'password' => bcrypt(\Illuminate\Support\Str::random(40)),
                'organization_id' => $organization->id,
            ]);
        }

        // Authenticate the user for this request
        Auth::login($user);
    }

    /**
     * Handle an unauthenticated request.
     *
     * In pilot mode: always return 401 for JSON requests.
     */
    protected function unauthenticated($request, array $guards)
    {
        if ($request->expectsJson()) {
            return response()->json(['error' => 'Unauthenticated'], 401);
        }

        return redirect()->guest(route('login'));
    }
}
