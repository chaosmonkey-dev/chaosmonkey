<?php

namespace Tests\Feature;

use App\Models\IDEConnectCode;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CR-X Pilot Rollout Contract — Real Backend Runtime Test
 *
 * Tests the ACTUAL route/controller behavior for the canonical extension
 * download authority and invite/enrollment setup response.
 *
 * No customer data is mutated. Uses in-memory SQLite + test fixtures.
 */
class PilotRolloutContractTest extends TestCase
{
    private Organization $organization;
    private User $admin;

    // ─── Canonical artifact identity (accepted release manifest) ───
    private const CANONICAL_VERSION = '0.4.1';
    private const CANONICAL_FILENAME = 'chaosmonkey-telemetry-0.4.1.vsix';
    private const CANONICAL_SHA256 = 'b66fc8545fda619c68f9e502a7198307b00a897b991c07bb0f2b1c1291889a94';
    private const CANONICAL_SIZE = 51657;
    private const CANONICAL_ENDPOINT = '/api/extension/download/latest';

    protected function setUp(): void
    {
        parent::setUp();

        $this->assertTrue(app()->environment('testing'), 'Refusing to run: APP_ENV is not testing');
        $this->assertEquals('sqlite', config('database.default'), 'Refusing to run: database driver is not sqlite');
        $this->assertEquals(':memory:', config('database.connections.sqlite.database'), 'Refusing to run: SQLite database is not :memory:');

        $this->createTables();

        config(['app.url' => 'http://test.test:8010']);

        $this->organization = Organization::create([
            'name' => 'Rollout Contract Org',
            'slug' => 'rollout-' . Str::random(6),
        ]);

        $this->admin = User::create([
            'name' => 'Rollout Admin',
            'email' => 'admin-' . Str::random(8) . '@rollout.test',
            'password' => bcrypt('password'),
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);
    }

    protected function tearDown(): void
    {
        if (app()->environment('testing')
            && config('database.default') === 'sqlite'
            && config('database.connections.sqlite.database') === ':memory:'
        ) {
            Schema::dropIfExists('ide_connect_codes');
            Schema::dropIfExists('invites');
            Schema::dropIfExists('users');
            Schema::dropIfExists('organizations');
        }

        parent::tearDown();
    }

    private function createTables(): void
    {
        if (!Schema::hasTable('organizations')) {
            Schema::create('organizations', function ($table) {
                $table->id();
                $table->string('name');
                $table->string('slug')->unique();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('users')) {
            Schema::create('users', function ($table) {
                $table->id();
                $table->string('name')->nullable();
                $table->string('email')->unique();
                $table->string('password')->nullable();
                $table->string('github_id')->nullable();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->string('role')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('invites')) {
            Schema::create('invites', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('token', 64)->unique();
                $table->string('email')->nullable();
                $table->string('role')->nullable();
                $table->timestamp('expires_at');
                $table->timestamp('redeemed_at')->nullable();
                $table->foreignId('redeemed_by_user_id')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('ide_connect_codes')) {
            Schema::create('ide_connect_codes', function ($table) {
                $table->id();
                $table->string('code', 32)->unique();
                $table->foreignId('user_id')->nullable()->constrained();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->foreignId('invite_id')->nullable()->constrained('invites')->nullOnDelete();
                $table->string('installation_id', 64)->nullable();
                $table->timestamp('expires_at');
                $table->timestamp('used_at')->nullable();
                $table->timestamps();
            });
        }
    }

    private function createInviteWithCode(): array
    {
        $invite = Invite::create([
            'organization_id' => $this->organization->id,
            'email' => 'dev@example.com',
            'expires_at' => now()->addDay(),
        ]);

        $code = IDEConnectCode::create([
            'code' => strtoupper(Str::random(4) . '-' . Str::random(4)),
            'user_id' => $this->admin->id,
            'organization_id' => $invite->organization_id,
            'invite_id' => $invite->id,
            'expires_at' => now()->addDays(7),
        ]);

        return [$invite, $code];
    }

    // ─── Tests ───

    /**
     * Test 0: The canonical VSIX exists in source-controlled resources
     * (hermetic deployment authority — no manual pre-placement required).
     */
    public function test_canonical_vsix_exists_in_source_controlled_resources(): void
    {
        $vsixPath = resource_path('extensions/' . self::CANONICAL_FILENAME);
        $this->assertFileExists($vsixPath,
            'Canonical VSIX must exist at backend/resources/extensions/ (source-controlled)');

        $actualSize = filesize($vsixPath);
        $this->assertEquals(self::CANONICAL_SIZE, $actualSize,
            'Canonical VSIX size must match manifest (' . self::CANONICAL_SIZE . ' bytes)');

        $actualHash = hash_file('sha256', $vsixPath);
        $this->assertEquals(self::CANONICAL_SHA256, $actualHash,
            'Canonical VSIX SHA-256 must match release manifest');
    }

    /**
     * Test 1: GET /api/extension/download/latest returns HTTP 200.
     */
    public function test_canonical_endpoint_returns_200(): void
    {
        $response = $this->get(self::CANONICAL_ENDPOINT);
        $response->assertStatus(200);
    }

    /**
     * Test 2: Response Content-Disposition names chaosmonkey-telemetry-0.4.1.vsix.
     */
    public function test_canonical_endpoint_filename_matches_release_authority(): void
    {
        $response = $this->get(self::CANONICAL_ENDPOINT);

        $contentDisposition = $response->headers->get('Content-Disposition');
        $this->assertNotNull($contentDisposition, 'Content-Disposition header missing');
        $this->assertStringContainsString(self::CANONICAL_FILENAME, $contentDisposition,
            'Content-Disposition must name the canonical VSIX filename');
    }

    /**
     * Test 3: Response is binary/download semantics, not source ZIP semantics.
     */
    public function test_canonical_endpoint_is_binary_download_not_source_zip(): void
    {
        $response = $this->get(self::CANONICAL_ENDPOINT);

        $contentType = $response->headers->get('Content-Type');
        $this->assertNotNull($contentType, 'Content-Type header missing');

        // Must be octet-stream (binary VSIX), not application/zip (source ZIP)
        $this->assertStringContainsString('application/octet-stream', $contentType,
            'Content-Type must be application/octet-stream for VSIX download, not application/zip');

        // Content-Disposition must NOT name a source ZIP
        $contentDisposition = $response->headers->get('Content-Disposition');
        $this->assertStringNotContainsString('ChaosMonkey-extension-source.zip', $contentDisposition ?? '',
            'Content-Disposition must not name a source ZIP');
    }

    /**
     * Test 4: Response body SHA-256 is exactly the canonical hash.
     */
    public function test_canonical_endpoint_sha256_matches_release_authority(): void
    {
        $response = $this->get(self::CANONICAL_ENDPOINT);

        $content = $response->streamedContent();
        $this->assertNotNull($content, 'Response body is null');

        $hash = hash('sha256', $content);
        $this->assertEquals(self::CANONICAL_SHA256, $hash,
            'Downloaded VSIX SHA-256 must match canonical release artifact');
    }

    /**
     * Test 5: Response byte length is 51,657.
     */
    public function test_canonical_endpoint_byte_length_matches_release_authority(): void
    {
        $response = $this->get(self::CANONICAL_ENDPOINT);

        $content = $response->streamedContent();
        $this->assertNotNull($content, 'Response body is null');

        $this->assertEquals(self::CANONICAL_SIZE, strlen($content),
            'Downloaded VSIX byte length must match canonical release artifact');
    }

    /**
     * Test 6: Packaged VSIX package.json version is 0.4.1.
     *
     * Opens the returned VSIX (ZIP) archive in-memory and reads the
     * extension/package.json version field.
     */
    public function test_canonical_endpoint_packaged_version_is_041(): void
    {
        $response = $this->get(self::CANONICAL_ENDPOINT);

        $content = $response->streamedContent();
        $this->assertNotNull($content, 'Response body is null');

        // Write to temp file and open as ZIP
        $tmpFile = tempnam(sys_get_temp_dir(), 'pilot_rollout_vsix_') . '.vsix';
        file_put_contents($tmpFile, $content);

        try {
            $zip = new \ZipArchive();
            $openResult = $zip->open($tmpFile);
            $this->assertTrue($openResult === true, 'VSIX is not a valid ZIP archive');

            $packageJsonIndex = $zip->locateName('extension/package.json');
            $this->assertNotFalse($packageJsonIndex, 'extension/package.json not found in VSIX');

            $packageJsonRaw = $zip->getFromIndex($packageJsonIndex);
            $zip->close();

            $packageJson = json_decode($packageJsonRaw, true);
            $this->assertNotNull($packageJson, 'package.json is not valid JSON');
            $this->assertEquals(self::CANONICAL_VERSION, $packageJson['version'],
                'Packaged extension version must be ' . self::CANONICAL_VERSION);
            $this->assertEquals('chaosmonkey-telemetry', $packageJson['name'],
                'Packaged extension name must be chaosmonkey-telemetry');
        } finally {
            @unlink($tmpFile);
        }
    }

    /**
     * Test 7: Invite/enrollment setup endpoint returns extension_version = 0.4.1.
     */
    public function test_invite_setup_returns_extension_version_041(): void
    {
        [$invite, $code] = $this->createInviteWithCode();

        $response = $this->getJson('/api/invites/' . $invite->token);
        $response->assertStatus(200);

        $body = $response->json();
        $this->assertArrayHasKey('setup', $body);
        $this->assertEquals(self::CANONICAL_VERSION, $body['setup']['extension_version'],
            'Invite setup must report extension_version 0.4.1');
    }

    /**
     * Test 8: Invite/enrollment setup endpoint returns vsix_download_url ending in
     * /api/extension/download/latest.
     */
    public function test_invite_setup_returns_canonical_download_url(): void
    {
        [$invite, $code] = $this->createInviteWithCode();

        $response = $this->getJson('/api/invites/' . $invite->token);
        $response->assertStatus(200);

        $body = $response->json();
        $this->assertArrayHasKey('setup', $body);
        $this->assertStringEndsWith('/api/extension/download/latest', $body['setup']['vsix_download_url'],
            'vsix_download_url must end with /api/extension/download/latest');
        $this->assertStringNotContainsString('source/download', $body['setup']['vsix_download_url'],
            'vsix_download_url must not reference source/download');
    }

    /**
     * Test 9: api_base_url derives from runtime app/tenant configuration,
     * not a Priority Dispatch hardcode.
     */
    public function test_invite_setup_api_base_url_derives_from_runtime_config(): void
    {
        // Set a distinctive test URL that proves runtime config is used
        config(['app.url' => 'http://runtime-tenant-test:9999']);

        [$invite, $code] = $this->createInviteWithCode();

        $response = $this->getJson('/api/invites/' . $invite->token);
        $response->assertStatus(200);

        $body = $response->json();
        $this->assertArrayHasKey('setup', $body);
        $this->assertEquals('http://runtime-tenant-test:9999', $body['setup']['api_base_url'],
            'api_base_url must derive from config(app.url), not a hardcoded hostname');
        $this->assertStringNotContainsString('prioritydispatch', $body['setup']['api_base_url'],
            'api_base_url must not contain prioritydispatch (no tenant hardcode)');
    }

    /**
     * Test 10: Existing >=0.4.0 authentication/ingestion compatibility remains unchanged.
     *
     * Verifies the TelemetryController version gate logic is present and accepts
     * 0.4.0+ (which includes 0.4.1). This is a source-level check since testing
     * the full telemetry ingestion pipeline requires a valid bearer token and
     * would mutate test data unnecessarily.
     */
    public function test_ingestion_gate_accepts_040_and_041(): void
    {
        // Verify version_compare gate exists in TelemetryController
        $controllerPath = app_path('Http/Controllers/TelemetryController.php');
        $this->assertTrue(file_exists($controllerPath), 'TelemetryController.php not found');

        $source = file_get_contents($controllerPath);

        // The gate must use version_compare with >= 0.4.0
        $this->assertStringContainsString("version_compare", $source,
            'TelemetryController must use version_compare for extension version gating');
        $this->assertStringContainsString("'0.4.0', '>='", $source,
            'TelemetryController must gate on >= 0.4.0 (accepts 0.4.1)');

        // Verify 0.4.1 is >= 0.4.0 (PHP version_compare sanity)
        $this->assertEquals(1, version_compare('0.4.1', '0.4.0', '>='),
            'PHP version_compare confirms 0.4.1 >= 0.4.0');
        $this->assertEquals(1, version_compare('0.4.0', '0.4.0', '>='),
            'PHP version_compare confirms 0.4.0 >= 0.4.0');
    }
}
