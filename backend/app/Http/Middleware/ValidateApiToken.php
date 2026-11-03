<?php

namespace App\Http\Middleware;

use App\Models\ApiToken;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class ValidateApiToken
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
        // Extract token from Authorization header
        $authHeader = $request->header('Authorization');
        $token = null;
        
        if ($authHeader && str_starts_with($authHeader, 'Bearer ')) {
            $token = substr($authHeader, 7);
        }
        
        if (!$token) {
            Log::warning('API token missing from request', [
                'ip' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'path' => $request->path()
            ]);
            
            return response()->json(['error' => 'API token required'], 401);
        }
        
        // Lookup valid ApiToken using the model method
        $apiToken = ApiToken::findValidToken($token);
            
        if (!$apiToken) {
            Log::warning('Invalid or expired API token', [
                'token_prefix' => substr($token, 0, 8) . '...',
                'ip' => $request->ip(),
                'path' => $request->path()
            ]);
            
            return response()->json(['error' => 'Invalid or expired token'], 401);
        }
        
        // Attach user and organization to request for controllers to use
        $request->attributes->set('api_user', $apiToken->user);
        $request->attributes->set('api_organization', $apiToken->organization);
        
        Log::debug('API token validated successfully', [
            'user_id' => $apiToken->user->id,
            'organization_id' => $apiToken->organization->id,
            'path' => $request->path()
        ]);
        
        return $next($request);
    }
}
