<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class Cors
{
    private const DEFAULT_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
    private const DEFAULT_HEADERS = 'Content-Type, Authorization, X-Requested-With, X-CSRF-TOKEN, X-Api-Token, X-CM-Trace, chaosmonkey-auth-token';

    public function handle(Request $request, Closure $next): Response
    {
        $origin = $request->headers->get('Origin');
        $cors = config('cors', []);

        $allowedMethods = $cors['allowed_methods'] ?? [];
        $allowedHeaders = $cors['allowed_headers'] ?? [];
        $exposedHeaders = $cors['exposed_headers'] ?? [];
        $maxAge = $cors['max_age'] ?? 0;

        $methods = $this->buildMethods($allowedMethods);
        $headers = $this->buildHeaders($allowedHeaders);

        $originAllowed = $this->isAllowedOrigin($origin);

        if ($request->isMethod('OPTIONS')) {
            $response = response('', 204);

            if ($originAllowed && $origin) {
                $response->headers->set('Access-Control-Allow-Origin', $this->normalizeOrigin($origin));
                $response->headers->set('Access-Control-Allow-Credentials', 'true');
            }

            $response->headers->set('Access-Control-Allow-Methods', $methods);
            $response->headers->set('Access-Control-Allow-Headers', $headers);
            $response->headers->set('Vary', 'Origin');

            if ($maxAge > 0) {
                $response->headers->set('Access-Control-Max-Age', (string) $maxAge);
            }

            return $response;
        }

        $response = $next($request);

        if ($originAllowed && $origin) {
            $response->headers->set('Access-Control-Allow-Origin', $this->normalizeOrigin($origin));
            $response->headers->set('Access-Control-Allow-Credentials', 'true');
        } elseif (!$origin) {
            $response->headers->set('Access-Control-Allow-Origin', '*');
        }

        $response->headers->set('Access-Control-Allow-Methods', $methods);
        $response->headers->set('Access-Control-Allow-Headers', $headers);
        $response->headers->set('Vary', 'Origin');

        if ($exposedHeaders) {
            $response->headers->set('Access-Control-Expose-Headers', implode(', ', $exposedHeaders));
        }

        if ($maxAge > 0) {
            $response->headers->set('Access-Control-Max-Age', (string) $maxAge);
        }

        return $response;
    }

    private function allowedOrigins(): array
    {
        $origins = [];

        $configOrigins = config('cors.allowed_origins', []);
        if (is_string($configOrigins)) {
            $configOrigins = explode(',', $configOrigins);
        }
        if (is_array($configOrigins)) {
            $origins = array_merge($origins, $configOrigins);
        }

        foreach ([
            env('CORS_ALLOWED_ORIGINS'),
            env('APP_FRONTEND_URL'),
            env('FRONTEND_URL'),
        ] as $value) {
            if (!$value) {
                continue;
            }
            $origins = array_merge($origins, explode(',', $value));
        }

        return array_values(array_unique(array_filter(array_map(function ($origin) {
            return $this->normalizeOrigin($origin);
        }, $origins))));
    }

    private function isAllowedOrigin(?string $origin): bool
    {
        if (!$origin) {
            return false;
        }

        $origin = $this->normalizeOrigin($origin);
        $allowed = $this->allowedOrigins();

        return in_array('*', $allowed, true) || in_array($origin, $allowed, true);
    }

    private function normalizeOrigin(string $origin): string
    {
        return rtrim(trim($origin), '/');
    }

    private function buildMethods(array $allowedMethods): string
    {
        if (empty($allowedMethods) || in_array('*', $allowedMethods, true)) {
            return self::DEFAULT_METHODS;
        }

        return implode(', ', array_map('strtoupper', $allowedMethods));
    }

    private function buildHeaders(array $allowedHeaders): string
    {
        if (empty($allowedHeaders) || in_array('*', $allowedHeaders, true)) {
            return self::DEFAULT_HEADERS;
        }

        return implode(', ', $allowedHeaders);
    }
}
