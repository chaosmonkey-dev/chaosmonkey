<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

class ApiSessionAuth
{
    /**
     * Handle an incoming request.
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  \Closure(\Illuminate\Http\Request): (\Illuminate\Http\Response|\Illuminate\Http\RedirectResponse)  $next
     * @return \Illuminate\Http\Response|\Illuminate\Http\RedirectResponse
     */
    public function handle(Request $request, Closure $next)
    {
        // Start session for API routes
        if (!session()->isStarted()) {
            session()->start();
        }

        // Check if user is authenticated via session
        if (!Auth::check()) {
            Log::warning('API Session Auth: User not authenticated', [
                'path' => $request->path(),
                'ip' => $request->ip(),
                'session_id' => session()->getId()
            ]);

            return response()->json(['error' => 'Authentication required'], 401);
        }

        Log::debug('API Session Auth: User authenticated', [
            'user_id' => Auth::id(),
            'path' => $request->path()
        ]);

        return $next($request);
    }
}
