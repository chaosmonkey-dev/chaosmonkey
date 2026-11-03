<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class RouteHardeningTest extends TestCase
{
    public function test_public_ide_connect_exchange_route_is_registered(): void
    {
        $postRoutes = collect(Route::getRoutes()->get('POST') ?? []);

        $this->assertTrue(
            $postRoutes->contains(fn ($route) => $route->uri() === 'api/ide/connect/exchange'),
            'The public IDE connect exchange route must be registered.'
        );
    }

    public function test_legacy_api_token_and_ide_routes_are_disabled(): void
    {
        $allUris = collect(Route::getRoutes()->getRoutes())
            ->map(fn ($route) => $route->uri())
            ->implode(',');

        $this->assertStringNotContainsString('api-token', $allUris, 'Legacy API token management routes must be disabled.');
        $this->assertStringNotContainsString('ide/authenticate', $allUris, 'Legacy IDE authenticate route must be disabled.');
        $this->assertStringNotContainsString('ide/collect-telemetry', $allUris, 'Legacy IDE collect-telemetry route must be disabled.');
        $this->assertStringNotContainsString('ide/disconnect', $allUris, 'Legacy IDE disconnect route must be disabled.');
    }
}
