<?php

use Illuminate\Support\Facades\Route;

// Test route
Route::get('/test', function () {
    return response()->json(['status' => 'OK', 'time' => date('Y-m-d H:i:s')]);
});

Route::get('/', function () {
    return response()->json(['status' => 'ok']);
});

// Self-contained health check — no external assets (the framework default
// /up page loads Tailwind/fonts from CDNs, which leaks outbound calls on
// self-hosted installs).
Route::get('/up', function () {
    return response(
        '<!DOCTYPE html><html><head><title>ChaosMonkey</title></head>'
        . '<body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;'
        . 'align-items:center;justify-content:center;margin:0;background:#f3f4f6">'
        . '<div style="font-size:1.1rem">'
        . '<span style="color:#16a34a">&#9679;</span> ChaosMonkey is up'
        . '</div></body></html>'
    );
});

// Login route for authentication middleware
Route::get('/login', function () {
    return response()->json(['message' => 'Authentication required'], 401);
})->name('login');

// Serve Vue.js SPA for all other routes
Route::get('/{any?}', function () {
    $htmlPath = __DIR__ . '/../public/index.html';
    if (file_exists($htmlPath)) {
        return response()->file($htmlPath);
    }
    return response()->json(['error' => 'Frontend not found'], 404);
})->where('any', '^(?!api|test|up).*$');
