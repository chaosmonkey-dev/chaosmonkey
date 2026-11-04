<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * CR-X P1-1: Claude Code bridge download endpoint regression.
 *
 * Hermetic: passes on a clean checkout because the canonical tarball is
 * source-controlled at backend/resources/extensions/ — no manual
 * pre-placement required.
 *
 * Proves:
 * - /api/bridge/download/latest serves the canonical tarball
 * - Content-Type is application/gzip
 * - Content-Disposition is attachment with the correct filename
 * - Served bytes match the source-controlled artifact
 * - SHA-256 matches the release manifest
 * - Route is public (no SimpleTokenAuth)
 */
class CcBridgeDownloadTest extends TestCase
{
    private const BRIDGE_FILENAME = 'chaosmonkey-cc-bridge-0.4.2-cc-bridge.tgz';
    private const BRIDGE_SHA256 = '700122fbf079834591c2eb789d869238c7bf4e82872df4453e03ab312201c6ab';
    private const BRIDGE_SIZE = 18033;

    /**
     * The canonical tarball must exist in the source-controlled
     * resources directory — this is the deterministic deployment authority.
     */
    public function test_bridge_tarball_exists_in_source_controlled_resources(): void
    {
        $tgzPath = resource_path('extensions/' . self::BRIDGE_FILENAME);
        $this->assertFileExists($tgzPath,
            'Canonical bridge tarball must exist at backend/resources/extensions/ (source-controlled)');

        $actualSize = filesize($tgzPath);
        $this->assertEquals(self::BRIDGE_SIZE, $actualSize,
            'Bridge tarball size must match manifest (' . self::BRIDGE_SIZE . ' bytes)');

        $actualHash = hash_file('sha256', $tgzPath);
        $this->assertEquals(self::BRIDGE_SHA256, $actualHash,
            'Bridge tarball SHA-256 must match release manifest');
    }

    /**
     * The bridge download endpoint serves the tarball with correct headers.
     */
    public function test_bridge_download_latest_serves_tarball(): void
    {
        $tgzPath = resource_path('extensions/' . self::BRIDGE_FILENAME);

        if (!file_exists($tgzPath)) {
            $this->markTestSkipped("CC bridge tarball not found at {$tgzPath}");
        }

        $response = $this->get('/api/bridge/download/latest');

        $response->assertStatus(200);
        $response->assertHeader('Content-Type', 'application/gzip');
        $disposition = $response->headers->get('Content-Disposition');
        $this->assertStringContainsString('attachment', $disposition);
        $this->assertStringContainsString(self::BRIDGE_FILENAME, $disposition);

        // Verify the served content matches the source-controlled artifact
        $expectedContent = file_get_contents($tgzPath);
        $actualContent = $response->streamedContent();
        $this->assertEquals($expectedContent, $actualContent,
            'Served tarball content must match source-controlled artifact');
    }

    /**
     * The bridge download route is public (no auth required),
     * mirroring the VSIX /extension/download/latest pattern.
     */
    public function test_bridge_download_route_is_public(): void
    {
        $routes = app('router')->getRoutes();
        $route = null;
        foreach ($routes as $r) {
            if ($r->uri() === 'api/bridge/download/latest' && in_array('GET', $r->methods())) {
                $route = $r;
                break;
            }
        }
        $this->assertNotNull($route, 'Bridge download route must be registered');

        $middleware = $route->gatherMiddleware();
        $this->assertNotContains('App\Http\Middleware\SimpleTokenAuth', $middleware,
            'Bridge download must be public (no SimpleTokenAuth)');
    }

    /**
     * The served tarball SHA-256 matches the release manifest authority.
     */
    public function test_served_tarball_sha256_matches_manifest(): void
    {
        $tgzPath = resource_path('extensions/' . self::BRIDGE_FILENAME);

        if (!file_exists($tgzPath)) {
            $this->markTestSkipped("CC bridge tarball not found");
        }

        $response = $this->get('/api/bridge/download/latest');
        $response->assertStatus(200);

        $servedContent = $response->streamedContent();
        $servedHash = hash('sha256', $servedContent);
        $this->assertEquals(self::BRIDGE_SHA256, $servedHash,
            'Served tarball SHA-256 must match release manifest');
    }
}
