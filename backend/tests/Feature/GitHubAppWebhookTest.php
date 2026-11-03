<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * CR-X Track A — GitHub App Webhook + Ingestion Contract Tests.
 *
 * Proves:
 *   - Webhook signature verification fails on invalid/missing signatures
 *   - Webhook returns 503 when App is not configured
 *   - PR events are ingested into pull_requests with data_source='github_app'
 *   - Deployment events are ingested into deployments with github_app metadata
 *   - Release events are ingested into releases with github_app metadata
 *   - Multi-tenant: installation_id is scoped per event (no global ID)
 *   - Ping events are accepted (webhook setup handshake)
 *
 * Tests run against an isolated in-memory SQLite database.
 * No live GitHub API calls, no live installation tokens.
 */
class GitHubAppWebhookTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->assertTrue(
            app()->environment('testing'),
            'Refusing to run: APP_ENV is not testing'
        );
        $this->assertEquals('sqlite', config('database.default'),
            'Refusing to run: database driver is not sqlite'
        );
        $this->assertEquals(':memory:', config('database.connections.sqlite.database'),
            'Refusing to run: SQLite database is not :memory:'
        );

        $this->createTables();

        // Configure the App for tests (runtime code reads config(), not env())
        config()->set('services.github_app.id', 'test-app-123');
        config()->set('services.github_app.private_key', $this->generateTestPrivateKey());
        config()->set('services.github_app.webhook_secret', 'test-webhook-secret');
        config()->set('services.github_app.installation_id', 99999);

        Cache::flush();
    }

    protected function tearDown(): void
    {
        config()->set('services.github_app.id', null);
        config()->set('services.github_app.private_key', null);
        config()->set('services.github_app.webhook_secret', null);
        config()->set('services.github_app.installation_id', null);
        Cache::flush();
        parent::tearDown();
    }

    /**
     * Webhook with no signature should return 401.
     */
    public function test_webhook_rejects_missing_signature(): void
    {
        $payload = json_encode(['action' => 'opened', 'installation' => ['id' => 1]]);

        $response = $this->call(
            'POST',
            '/api/github/app/webhook',
            [],
            [],
            [],
            ['CONTENT_TYPE' => 'application/json', 'HTTP_X_GITHUB_EVENT' => 'pull_request'],
            $payload
        );

        $response->assertStatus(401);
    }

    /**
     * Webhook with invalid signature should return 401.
     */
    public function test_webhook_rejects_invalid_signature(): void
    {
        $payload = json_encode(['action' => 'opened', 'installation' => ['id' => 1]]);

        $response = $this->call(
            'POST',
            '/api/github/app/webhook',
            [],
            [],
            [],
            [
                'CONTENT_TYPE' => 'application/json',
                'HTTP_X_GITHUB_EVENT' => 'pull_request',
                'HTTP_X_HUB_SIGNATURE_256' => 'sha256=invalidsignature',
            ],
            $payload
        );

        $response->assertStatus(401);
    }

    /**
     * Ping event with valid signature should return 200.
     */
    public function test_webhook_accepts_ping_event(): void
    {
        $payload = json_encode(['zen' => 'Hello', 'installation' => ['id' => 1]]);
        $signature = 'sha256=' . hash_hmac('sha256', $payload, 'test-webhook-secret');

        $response = $this->call(
            'POST',
            '/api/github/app/webhook',
            [],
            [],
            [],
            [
                'CONTENT_TYPE' => 'application/json',
                'HTTP_X_GITHUB_EVENT' => 'ping',
                'HTTP_X_HUB_SIGNATURE_256' => $signature,
            ],
            $payload
        );

        $response->assertStatus(200);
        $response->assertJson(['status' => 'processed']);
    }

    /**
     * PR event should be ingested into pull_requests with data_source='github_app'.
     */
    public function test_pr_event_ingested_with_github_app_provenance(): void
    {
        $payload = json_encode([
            'action' => 'opened',
            'installation' => ['id' => 99999],
            'repository' => ['full_name' => 'test-org/test-repo'],
            'pull_request' => [
                'number' => 42,
                'user' => ['login' => 'testuser'],
                'created_at' => '2026-09-15T10:00:00Z',
                'updated_at' => '2026-09-15T10:00:00Z',
                'merged_at' => null,
                'head' => ['sha' => 'abc123', 'ref' => 'feature-branch'],
                'base' => ['ref' => 'main'],
                'merge_commit_sha' => null,
                'requested_reviewers' => [],
                'additions' => 10,
                'deletions' => 5,
                'changed_files' => 3,
            ],
        ]);

        $signature = 'sha256=' . hash_hmac('sha256', $payload, 'test-webhook-secret');

        $response = $this->call(
            'POST',
            '/api/github/app/webhook',
            [],
            [],
            [],
            [
                'CONTENT_TYPE' => 'application/json',
                'HTTP_X_GITHUB_EVENT' => 'pull_request',
                'HTTP_X_HUB_SIGNATURE_256' => $signature,
            ],
            $payload
        );

        $response->assertStatus(200);

        // Verify the PR was ingested
        $pr = DB::table('pull_requests')
            ->where('repo_name', 'test-org/test-repo')
            ->where('pr_number', 42)
            ->first();

        $this->assertNotNull($pr);
        $this->assertEquals('github_app', $pr->data_source);
        // Lineage columns persist under the post-DB-task schema
        $this->assertEquals('abc123', $pr->head_sha);
        $this->assertEquals('main', $pr->base_ref);
        $this->assertEquals('feature-branch', $pr->head_ref);
        $this->assertEquals('testuser', $pr->author_login);
        $this->assertEquals('github_app', $pr->evidence_source);
    }

    /**
     * closed+merged PR persists merged_at and merge_sha.
     */
    public function test_pr_merged_event_persists_merge_state(): void
    {
        $payload = json_encode([
            'action' => 'closed',
            'installation' => ['id' => 99999],
            'repository' => ['full_name' => 'test-org/test-repo'],
            'pull_request' => [
                'number' => 43,
                'user' => ['login' => 'merger'],
                'created_at' => '2026-09-15T10:00:00Z',
                'updated_at' => '2026-09-15T12:00:00Z',
                'merged_at' => '2026-09-15T12:00:00Z',
                'head' => ['sha' => 'def789', 'ref' => 'ship-it'],
                'base' => ['ref' => 'main'],
                'merge_commit_sha' => 'deadbeef42',
                'requested_reviewers' => [],
                'additions' => 5,
                'deletions' => 2,
                'changed_files' => 1,
            ],
        ]);
        $signature = 'sha256=' . hash_hmac('sha256', $payload, 'test-webhook-secret');

        $this->call('POST', '/api/github/app/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_GITHUB_EVENT' => 'pull_request',
            'HTTP_X_HUB_SIGNATURE_256' => $signature,
        ], $payload)->assertStatus(200);

        $pr = DB::table('pull_requests')
            ->where('repo_name', 'test-org/test-repo')->where('pr_number', 43)->first();

        $this->assertNotNull($pr);
        $this->assertEquals('2026-09-15T12:00:00Z', $pr->merged_at);
        $this->assertEquals('deadbeef42', $pr->merge_sha);
        $this->assertEquals('def789', $pr->head_sha);
    }

    /**
     * Deployment event should be ingested into deployments.
     */
    public function test_deployment_event_ingested(): void
    {
        $payload = json_encode([
            'action' => 'created',
            'installation' => ['id' => 99999],
            'repository' => ['full_name' => 'test-org/test-repo'],
            'deployment' => [
                'sha' => 'def456',
                'environment' => 'production',
                'created_at' => '2026-09-15T12:00:00Z',
            ],
        ]);

        $signature = 'sha256=' . hash_hmac('sha256', $payload, 'test-webhook-secret');

        $response = $this->call(
            'POST',
            '/api/github/app/webhook',
            [],
            [],
            [],
            [
                'CONTENT_TYPE' => 'application/json',
                'HTTP_X_GITHUB_EVENT' => 'deployment',
                'HTTP_X_HUB_SIGNATURE_256' => $signature,
            ],
            $payload
        );

        $response->assertStatus(200);

        $deployment = DB::table('deployments')
            ->where('repo_name', 'test-org/test-repo')
            ->where('sha', 'def456')
            ->first();

        $this->assertNotNull($deployment);
        $this->assertEquals('production', $deployment->environment);

        $metadata = json_decode($deployment->metadata, true);
        $this->assertEquals('github_app', $metadata['data_source']);
    }

    /**
     * Release event should be ingested into releases.
     */
    public function test_release_event_ingested(): void
    {
        $payload = json_encode([
            'action' => 'published',
            'installation' => ['id' => 99999],
            'repository' => ['full_name' => 'test-org/test-repo'],
            'release' => [
                'id' => 12345,
                'tag_name' => 'v1.2.3',
                'name' => 'Release 1.2.3',
                'published_at' => '2026-09-15T14:00:00Z',
                'author' => ['login' => 'testuser'],
            ],
        ]);

        $signature = 'sha256=' . hash_hmac('sha256', $payload, 'test-webhook-secret');

        $response = $this->call(
            'POST',
            '/api/github/app/webhook',
            [],
            [],
            [],
            [
                'CONTENT_TYPE' => 'application/json',
                'HTTP_X_GITHUB_EVENT' => 'release',
                'HTTP_X_HUB_SIGNATURE_256' => $signature,
            ],
            $payload
        );

        $response->assertStatus(200);

        $release = DB::table('releases')
            ->where('repo_name', 'test-org/test-repo')
            ->where('tag_name', 'v1.2.3')
            ->first();

        $this->assertNotNull($release);
        $this->assertEquals('v1.2.3', $release->tag_name);

        $metadata = json_decode($release->metadata, true);
        $this->assertEquals('github_app', $metadata['data_source']);
    }

    /**
     * Multi-tenant: different installation IDs scope to different events.
     * The webhook does NOT use a global installation ID.
     */
    public function test_multi_tenant_installation_scoping(): void
    {
        // Event from the pilot's configured installation (99999)
        $payload1 = json_encode([
            'action' => 'opened',
            'installation' => ['id' => 99999],
            'repository' => ['full_name' => 'org-a/repo'],
            'pull_request' => [
                'number' => 1,
                'user' => ['login' => 'user-a'],
                'created_at' => '2026-09-15T10:00:00Z',
                'head' => ['sha' => 'aaa'],
                'base' => ['ref' => 'main'],
            ],
        ]);
        $sig1 = 'sha256=' . hash_hmac('sha256', $payload1, 'test-webhook-secret');

        // Event from installation 22222
        $payload2 = json_encode([
            'action' => 'opened',
            'installation' => ['id' => 22222],
            'repository' => ['full_name' => 'org-b/repo'],
            'pull_request' => [
                'number' => 1,
                'user' => ['login' => 'user-b'],
                'created_at' => '2026-09-15T10:00:00Z',
                'head' => ['sha' => 'bbb'],
                'base' => ['ref' => 'main'],
            ],
        ]);
        $sig2 = 'sha256=' . hash_hmac('sha256', $payload2, 'test-webhook-secret');

        $resp1 = $this->call('POST', '/api/github/app/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_GITHUB_EVENT' => 'pull_request',
            'HTTP_X_HUB_SIGNATURE_256' => $sig1,
        ], $payload1);
        $this->assertEquals(200, $resp1->status(), 'Configured installation should ingest: ' . $resp1->content());

        // Per-pilot isolation: a foreign installation is rejected, never written
        $resp2 = $this->call('POST', '/api/github/app/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_GITHUB_EVENT' => 'pull_request',
            'HTTP_X_HUB_SIGNATURE_256' => $sig2,
        ], $payload2);
        $this->assertEquals(403, $resp2->status(), 'Foreign installation must be rejected');

        $prA = DB::table('pull_requests')->where('repo_name', 'org-a/repo')->first();
        $prB = DB::table('pull_requests')->where('repo_name', 'org-b/repo')->first();

        $this->assertNotNull($prA, 'PR from the configured installation should be ingested');
        $this->assertNull($prB, 'PR from a foreign installation must not be written');
        $this->assertEquals('github_app', $prA->data_source);
    }

    /**
     * With no GITHUB_APP_INSTALLATION_ID configured the webhook fails closed
     * (503 -> GitHub retries later) and ingests nothing.
     */
    public function test_webhook_fails_closed_when_installation_unset(): void
    {
        config()->set('services.github_app.installation_id', null);

        $payload = json_encode([
            'action' => 'opened',
            'installation' => ['id' => 99999],
            'repository' => ['full_name' => 'test-org/test-repo'],
            'pull_request' => [
                'number' => 7,
                'user' => ['login' => 'testuser'],
                'created_at' => '2026-09-15T10:00:00Z',
                'head' => ['sha' => 'abc'],
                'base' => ['ref' => 'main'],
            ],
        ]);
        $signature = 'sha256=' . hash_hmac('sha256', $payload, 'test-webhook-secret');

        $response = $this->call(
            'POST',
            '/api/github/app/webhook',
            [],
            [],
            [],
            [
                'CONTENT_TYPE' => 'application/json',
                'HTTP_X_GITHUB_EVENT' => 'pull_request',
                'HTTP_X_HUB_SIGNATURE_256' => $signature,
            ],
            $payload
        );

        $response->assertStatus(503);
        $this->assertNull(DB::table('pull_requests')->first());
    }

    /**
     * Webhook without installation_id should return 400.
     */
    public function test_webhook_rejects_missing_installation_id(): void
    {
        $payload = json_encode(['action' => 'opened']);
        $signature = 'sha256=' . hash_hmac('sha256', $payload, 'test-webhook-secret');

        $response = $this->call(
            'POST',
            '/api/github/app/webhook',
            [],
            [],
            [],
            [
                'CONTENT_TYPE' => 'application/json',
                'HTTP_X_GITHUB_EVENT' => 'pull_request',
                'HTTP_X_HUB_SIGNATURE_256' => $signature,
            ],
            $payload
        );

        $response->assertStatus(400);
    }

    /**
     * pull_request action=reopened should record pr_reopen_events and
     * increment pr_reopened_count — deduplicated by X-GitHub-Delivery.
     */
    public function test_pr_reopened_event_records_reopen_once(): void
    {
        $payload = json_encode([
            'action' => 'reopened',
            'installation' => ['id' => 99999],
            'repository' => ['full_name' => 'test-org/test-repo'],
            'sender' => ['login' => 'reopener'],
            'pull_request' => [
                'number' => 42,
                'user' => ['login' => 'testuser'],
                'created_at' => '2026-09-15T10:00:00Z',
                'updated_at' => '2026-09-16T09:00:00Z',
                'merged_at' => null,
                'head' => ['sha' => 'abc123', 'ref' => 'feature-branch'],
                'base' => ['ref' => 'main'],
                'merge_commit_sha' => null,
                'requested_reviewers' => [],
                'additions' => 10,
                'deletions' => 5,
                'changed_files' => 3,
            ],
        ]);

        $signature = 'sha256=' . hash_hmac('sha256', $payload, 'test-webhook-secret');
        $headers = [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_GITHUB_EVENT' => 'pull_request',
            'HTTP_X_HUB_SIGNATURE_256' => $signature,
            'HTTP_X_GITHUB_DELIVERY' => 'delivery-guid-reopen-1',
        ];

        $this->call('POST', '/api/github/app/webhook', [], [], [], $headers, $payload)
            ->assertStatus(200);
        // Duplicate delivery (GitHub redelivery) must not double-count
        $this->call('POST', '/api/github/app/webhook', [], [], [], $headers, $payload)
            ->assertStatus(200);

        $pr = DB::table('pull_requests')
            ->where('repo_name', 'test-org/test-repo')
            ->where('pr_number', 42)
            ->first();

        $this->assertNotNull($pr);
        $this->assertEquals(1, $pr->pr_reopened_count);
        $this->assertNull($pr->merged_at);

        $events = DB::table('pr_reopen_events')
            ->where('repo_name', 'test-org/test-repo')
            ->where('pr_number', 42)
            ->get();

        $this->assertCount(1, $events);
        $this->assertEquals('delivery-guid-reopen-1', $events->first()->event_id);
        $this->assertEquals('reopener', $events->first()->actor_login);
    }

    /**
     * Create the minimal tables needed for ingestion tests.
     */
    private function createTables(): void
    {
        // pull_requests (existing schema, minimal columns)
        DB::statement('CREATE TABLE IF NOT EXISTS pull_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_name VARCHAR,
            pr_number INTEGER,
            developer_id VARCHAR,
            merged_at DATETIME,
            comments_count INTEGER DEFAULT 0,
            review_count INTEGER DEFAULT 0,
            cursor_usage_detected TINYINT DEFAULT 0,
            created_at DATETIME,
            updated_at DATETIME,
            first_review_at DATETIME,
            unique_reviewer_count INTEGER DEFAULT 0,
            pr_reopened_count INTEGER DEFAULT 0,
            additions INTEGER DEFAULT 0,
            deletions INTEGER DEFAULT 0,
            changed_files INTEGER DEFAULT 0,
            user_login VARCHAR,
            data_source VARCHAR,
            head_sha VARCHAR,
            merge_sha VARCHAR,
            commit_shas TEXT,
            base_ref VARCHAR,
            head_ref VARCHAR,
            author_login VARCHAR,
            fetched_at DATETIME,
            evidence_source VARCHAR
        )');

        // deployments (existing schema)
        DB::statement('CREATE TABLE IF NOT EXISTS deployments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_name VARCHAR,
            environment VARCHAR,
            deployment_status VARCHAR,
            deployed_at DATETIME,
            sha VARCHAR,
            rollback_detected TINYINT DEFAULT 0,
            metadata TEXT,
            created_at DATETIME,
            updated_at DATETIME
        )');

        // releases (existing schema)
        DB::statement('CREATE TABLE IF NOT EXISTS releases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_name VARCHAR,
            release_id INTEGER,
            tag_name VARCHAR,
            release_name VARCHAR,
            published_at DATETIME,
            author_login VARCHAR,
            metadata TEXT,
            created_at DATETIME,
            updated_at DATETIME
        )');

        // pr_reopen_events (existing schema)
        DB::statement('CREATE TABLE IF NOT EXISTS pr_reopen_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_name VARCHAR,
            pr_number INTEGER,
            occurred_at DATETIME,
            event_id VARCHAR NULL,
            actor_login VARCHAR NULL,
            raw_event TEXT NULL,
            created_at DATETIME,
            updated_at DATETIME
        )');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS uniq_event_id ON pr_reopen_events (event_id)');
    }

    /**
     * Generate a test RSA private key for JWT signing.
     */
    private function generateTestPrivateKey(): string
    {
        $config = [
            'digest_alg' => 'sha256',
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ];
        $key = openssl_pkey_new($config);
        if (!$key) {
            return 'test-key-fallback';
        }
        openssl_pkey_export($key, $pem);
        return $pem;
    }
}
