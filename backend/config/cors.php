<?php

$envOrigins = array_values(array_filter(array_map('trim', explode(',', env('CORS_ALLOWED_ORIGINS', ''))), fn ($v) => $v !== ''));
$allowedOrigins = array_values(array_unique(array_merge($envOrigins, [
    env('APP_FRONTEND_URL', 'http://localhost:5174'),
    env('FRONTEND_DEV_URL', 'http://localhost:5174'),
    env('FRONTEND_DEV_ALT_URL', 'http://localhost:5175'),
    env('FRONTEND_LOCALHOST_URL', 'http://127.0.0.1:5174'),
    env('FRONTEND_LOCALHOST_ALT_URL', 'http://127.0.0.1:5175'),
    'http://127.0.0.1:57195', // Browser preview
    'http://localhost:57195', // Browser preview alt
])));

$allowedMethods = array_values(array_filter(array_map('trim', explode(',', env('CORS_ALLOWED_METHODS', 'GET,POST,PUT,PATCH,DELETE,OPTIONS'))), fn ($v) => $v !== ''));
$allowedHeaders = array_values(array_filter(array_map('trim', explode(',', env('CORS_ALLOWED_HEADERS', 'Content-Type,Authorization,X-Requested-With,X-CSRF-TOKEN,X-Api-Token,chaosmonkey-auth-token'))), fn ($v) => $v !== ''));
$exposedHeaders = array_values(array_filter(array_map('trim', explode(',', env('CORS_EXPOSED_HEADERS', ''))), fn ($v) => $v !== ''));

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers. You are free to adjust these settings as needed.
    |
    | To learn more: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
    |
    */

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => $allowedMethods,

    'allowed_origins' => $allowedOrigins,

    'allowed_origins_patterns' => [
        '/^http:\/\/192\.168\.\d+\.\d+:\d+$/'
    ],

    'allowed_headers' => $allowedHeaders,

    'exposed_headers' => $exposedHeaders,

    'max_age' => (int) env('CORS_MAX_AGE', 0),

    'supports_credentials' => true,

];
