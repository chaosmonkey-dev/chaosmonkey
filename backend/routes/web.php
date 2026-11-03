<?php

use Illuminate\Support\Facades\Route;

// Test route
Route::get('/test', function () {
    return response()->json(['status' => 'OK', 'time' => date('Y-m-d H:i:s')]);
});

Route::get('/', function () {
    return response()->json(['status' => 'ok']);
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
})->where('any', '^(?!api|test).*$');
