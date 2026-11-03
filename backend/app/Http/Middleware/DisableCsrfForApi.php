<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class DisableCsrfForApi
{
    /**
     * Handle an incoming request.
     */
    public function handle(Request $request, Closure $next)
    {
        // Skip CSRF for API requests
        if ($request->is('api/*')) {
            // Do NOT touch session at all
            return $next($request);
        }

        // Otherwise, normal CSRF behavior (optional)
        return $next($request);
    }
}

