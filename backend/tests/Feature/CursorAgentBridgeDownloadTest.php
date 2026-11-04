<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * Cursor Agent bridge download endpoint regression.
 *
 * Hermetic: passes on a clean checkout because the canonical tarball is
 * source-controlled at backend/resources/extensions/ — no manual
 * pre-placement required. Mirrors CcBridgeDownloadTest.
 *
 * Proves:
 * - /api/cursor-agent-bridge/download/latest serves the canonical tarball
 * - Content-Type is application/gzip
 * - Content-Disposition is attachment with the correct filename
 * - Served bytes match the source-controlled artifact
 * - SHA-256 matches the release manifest (and the accepted release artifact)
 * - Route is public (no SimpleTokenAuth)
 * - Missing artifact aborts 500 rather than serving an empty body
 */
class CursorAgentBridgeDownloadTest extends TestCase
{
    private const BRIDGE_FILENAME = 'chaosmonkey-cursor-agent-bridge-0.4.2-cursor-bridge.tgz';
    private const BRIDGE_SHA256 = '972acbc5c02efccac995484c80534e34f28de837a1e65a72520286353d2bbe21';
    private const BRIDGE_SIZE = 22325;

    /**
     * The canonical tarball must exist in the source-controlled
     * resources directory — this is the deterministic deployment authority.
     */
    public function test_bridge_tarball_exists_in_source_controlled_resources(): void
    {
        $tgzPath = resource_path('extensions/' . self::BRIDGE_FILENAME);
        $this->assertFileExists($tgzPath,
            'Canonical cursor-agent bridge tarball must exist at backend/resources/extensions/ (source-controlled)');

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
            $this->markTestSkipped("Cursor agent bridge tarball not found at {$tgzPath}");
        }

        $response = $this->get('/api/cursor-agent-bridge/download/latest');

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
     * mirroring the /bridge/download/latest pattern.
     */
    public function test_bridge_download_route_is_public(): void
    {
        $routes = app('router')->getRoutes();
        $route = null;
        foreach ($routes as $r) {
            if ($r->uri() === 'api/cursor-agent-bridge/download/latest' && in_array('GET', $r->methods())) {
                $route = $r;
                break;
            }
        }
        $this->assertNotNull($route, 'Cursor agent bridge download route must be registered');

        $middleware = $route->gatherMiddleware();
        $this->assertNotContains('App\Http\Middleware\SimpleTokenAuth', $middleware,
            'Cursor agent bridge download must be public (no SimpleTokenAuth)');
    }

    /**
     * The served tarball SHA-256 matches the release manifest authority.
     */
    public function test_served_tarball_sha256_matches_manifest(): void
    {
        $tgzPath = resource_path('extensions/' . self::BRIDGE_FILENAME);

        if (!file_exists($tgzPath)) {
            $this->markTestSkipped("Cursor agent bridge tarball not found");
        }

        $response = $this->get('/api/cursor-agent-bridge/download/latest');
        $response->assertStatus(200);

        $servedContent = $response->streamedContent();
        $servedHash = hash('sha256', $servedContent);
        $this->assertEquals(self::BRIDGE_SHA256, $servedHash,
            'Served tarball SHA-256 must match release manifest');
    }

    /**
     * A missing artifact must fail closed (500), never serve an
     * empty/zero-byte body — the anomaly class observed on a past
     * production download probe.
     */
    public function test_missing_artifact_fails_closed(): void
    {
        $tgzPath = resource_path('extensions/' . self::BRIDGE_FILENAME);
        $hiddenPath = $tgzPath . '.test-hidden';
        $this->assertFileExists($tgzPath);
        rename($tgzPath, $hiddenPath);

        try {
            $response = $this->get('/api/cursor-agent-bridge/download/latest');
            $response->assertStatus(500);
        } finally {
            rename($hiddenPath, $tgzPath);
        }
    }

    /**
     * The capability endpoint is the one authoritative contract consumed by
     * the Pilot Setup banner, copied instructions, and invite setup — it
     * must return the verified manifest on a promoted backend.
     */
    public function test_capability_endpoint_advertises_verified_manifest(): void
    {
        $response = $this->get('/api/cursor-agent-bridge/capability');

        $response->assertStatus(200);
        $body = $response->json();
        $this->assertTrue($body['available']);
        $this->assertEquals('0.4.2-cursor-bridge', $body['version']);
        $this->assertEquals(self::BRIDGE_FILENAME, $body['filename']);
        $this->assertEquals(self::BRIDGE_SHA256, $body['sha256']);
        // Capability must never expose enrollment secrets
        $this->assertArrayNotHasKey('auth_token', $body);
        $this->assertArrayNotHasKey('token', $body);
        $this->assertArrayNotHasKey('connect_code', $body);
    }

    /**
     * An unpromoted or incomplete backend fails closed — available=false,
     * never an HTTP error the UI might misread as capability.
     */
    public function test_capability_fails_closed_when_artifact_missing(): void
    {
        $tgzPath = resource_path('extensions/' . self::BRIDGE_FILENAME);
        $hiddenPath = $tgzPath . '.test-hidden';
        rename($tgzPath, $hiddenPath);

        try {
            $response = $this->get('/api/cursor-agent-bridge/capability');
            $response->assertStatus(200);
            $this->assertFalse($response->json('available'));
        } finally {
            rename($hiddenPath, $tgzPath);
        }
    }

    /**
     * A hash-mismatched artifact (stale or substituted bytes) is not
     * capability — the endpoint must not advertise it.
     */
    public function test_capability_fails_closed_on_hash_mismatch(): void
    {
        $tgzPath = resource_path('extensions/' . self::BRIDGE_FILENAME);
        $hiddenPath = $tgzPath . '.test-hidden';
        rename($tgzPath, $hiddenPath);

        try {
            file_put_contents($tgzPath, 'not-the-real-artifact');
            $response = $this->get('/api/cursor-agent-bridge/capability');
            $response->assertStatus(200);
            $this->assertFalse($response->json('available'));
        } finally {
            unlink($tgzPath);
            rename($hiddenPath, $tgzPath);
        }
    }
}
