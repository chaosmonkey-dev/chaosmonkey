<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\TelemetryEvent;
use App\Models\User;
use App\Models\PullRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class OrgIsolationTest extends TestCase
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
        $this->seedFixture();
    }

    protected function tearDown(): void
    {
        if (app()->environment('testing')
            && config('database.default') === 'sqlite'
            && config('database.connections.sqlite.database') === ':memory:'
        ) {
            Schema::dropIfExists('telemetry_events');
            Schema::dropIfExists('api_tokens');
            Schema::dropIfExists('cohort_members');
            Schema::dropIfExists('cohorts');
            Schema::dropIfExists('invites');
            Schema::dropIfExists('users');
            Schema::dropIfExists('organizations');
            Schema::dropIfExists('pull_requests');
            Schema::dropIfExists('deployments');
            Schema::dropIfExists('releases');
            Schema::dropIfExists('cursor_usage');
            Schema::dropIfExists('oauth_tokens');
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
                $table->string('role')->default('member');
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('invites')) {
            Schema::create('invites', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('token', 64)->unique();
                $table->string('email')->nullable();
                $table->string('role')->default('member');
                $table->timestamp('expires_at');
                $table->timestamp('redeemed_at')->nullable();
                $table->foreignId('redeemed_by_user_id')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('cohorts')) {
            Schema::create('cohorts', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('name');
                $table->timestamp('archived_at')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('cohort_members')) {
            Schema::create('cohort_members', function ($table) {
                $table->id();
                $table->foreignId('cohort_id')->constrained('cohorts')->cascadeOnDelete();
                $table->foreignId('invite_id')->unique()->constrained('invites')->cascadeOnDelete();
                $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
                $table->foreignId('assigned_by')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('api_tokens')) {
            Schema::create('api_tokens', function ($table) {
                $table->id();
                $table->string('token', 64)->unique();
                $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->foreignId('invite_id')->nullable()->constrained('invites')->nullOnDelete();
                $table->string('installation_id', 64)->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->timestamp('revoked_at')->nullable();
                $table->timestamps();

                $table->index('token');
                $table->index('user_id');
                $table->index('organization_id');
            });
        }

        if (!Schema::hasTable('telemetry_events')) {
            Schema::create('telemetry_events', function ($table) {
                $table->id();
                $table->string('user_id')->nullable();
                $table->foreignId('organization_id')->nullable()->index();
                $table->string('session_id')->nullable();
                $table->string('source');
                $table->string('editor_source', 32)->nullable();
                $table->string('event_type')->nullable();
                $table->integer('count')->default(0);
                $table->integer('duration_ms')->nullable();
                $table->timestamp('timestamp')->nullable();
                $table->json('metadata')->nullable();
                $table->json('payload');
                $table->string('batch_hash', 64)->unique();
                $table->integer('session_prs_created')->default(0);
                $table->integer('session_prs_merged')->default(0);
                $table->integer('session_pr_reopen_count')->default(0);
                $table->integer('session_deployment_successes')->default(0);
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('oauth_tokens')) {
            Schema::create('oauth_tokens', function ($table) {
                $table->id();
                $table->string('user_id')->nullable();
                $table->foreignId('organization_id')->nullable();
                $table->string('access_token')->nullable();
                $table->string('oauth_state', 64)->nullable();
                $table->json('user_data')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('pull_requests')) {
            Schema::create('pull_requests', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->nullable()->index();
                $table->string('repo_name')->nullable();
                $table->integer('pr_number')->nullable();
                $table->string('developer_id')->nullable();
                $table->timestamp('merged_at')->nullable();
                $table->integer('comments_count')->nullable();
                $table->integer('review_count')->nullable();
                $table->boolean('cursor_usage_detected')->default(false);
                $table->timestamp('first_review_at')->nullable();
                $table->integer('unique_reviewer_count')->default(0);
                $table->integer('pr_reopened_count')->default(0);
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('deployments')) {
            Schema::create('deployments', function ($table) {
                $table->id();
                $table->string('repo_name')->nullable();
                $table->string('environment')->nullable();
                $table->string('deployment_status')->nullable();
                $table->timestamp('deployed_at')->nullable();
                $table->string('sha')->nullable();
                $table->boolean('rollback_detected')->default(false);
                $table->json('metadata')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('releases')) {
            Schema::create('releases', function ($table) {
                $table->id();
                $table->string('repo_name');
                $table->bigInteger('release_id')->nullable();
                $table->string('tag_name');
                $table->string('release_name')->nullable();
                $table->datetime('published_at')->nullable();
                $table->string('author_login')->nullable();
                $table->json('metadata')->nullable();
                $table->timestamps();

                $table->index(['repo_name', 'release_id']);
                $table->index('published_at');
            });
        }

        if (!Schema::hasTable('cursor_usage')) {
            Schema::create('cursor_usage', function ($table) {
                $table->id();
                $table->string('developer_id')->nullable();
                $table->string('ide_name')->nullable();
                $table->integer('copilot_insertions')->default(0);
                $table->integer('claude_insertions')->default(0);
                $table->integer('cursor_insertions')->default(0);
                $table->integer('windsurf_insertions')->default(0);
                $table->timestamps();
            });
        }
    }

    // === Fixtures ===

    private Organization $orgA;
    private Organization $orgB;
    private Organization $orgC; // empty org
    private User $adminA;
    private User $adminB;
    private User $adminC;
    private string $adminAToken;
    private string $adminBToken;
    private string $adminCToken;
    private string $extensionToken;
    private Invite $inviteForExtension;

    private function seedFixture(): void
    {
        $this->orgA = Organization::create([
            'name' => 'Org Alpha',
            'slug' => 'org-alpha-' . Str::random(6),
        ]);

        $this->orgB = Organization::create([
            'name' => 'Org Beta',
            'slug' => 'org-beta-' . Str::random(6),
        ]);

        $this->orgC = Organization::create([
            'name' => 'Org Charlie (empty)',
            'slug' => 'org-charlie-' . Str::random(6),
        ]);

        $this->adminA = User::create([
            'name' => 'Admin Alpha',
            'email' => 'admin-alpha@org-a.test',
            'organization_id' => $this->orgA->id,
            'role' => 'admin',
        ]);

        $this->adminB = User::create([
            'name' => 'Admin Beta',
            'email' => 'admin-beta@org-b.test',
            'organization_id' => $this->orgB->id,
            'role' => 'admin',
        ]);

        $this->adminC = User::create([
            'name' => 'Admin Charlie',
            'email' => 'admin-charlie@org-c.test',
            'organization_id' => $this->orgC->id,
            'role' => 'admin',
        ]);

        // Dashboard tokens
        $this->adminAToken = ApiToken::generateDashboardToken($this->adminA->id, $this->orgA->id)['raw'];
        $this->adminBToken = ApiToken::generateDashboardToken($this->adminB->id, $this->orgB->id)['raw'];
        $this->adminCToken = ApiToken::generateDashboardToken($this->adminC->id, $this->orgC->id)['raw'];

        // Extension token (invite-backed, Org A)
        $this->inviteForExtension = Invite::create([
            'organization_id' => $this->orgA->id,
            'token' => Str::random(32),
            'email' => 'dev-ext@org-a.test',
            'expires_at' => now()->addDays(30),
        ]);

        $raw = Str::random(64);
        ApiToken::create([
            'token' => hash('sha256', $raw),
            'user_id' => null,
            'organization_id' => $this->orgA->id,
            'invite_id' => $this->inviteForExtension->id,
            'installation_id' => 'install-isolation-001',
            'expires_at' => now()->addDays(90),
        ]);
        $this->extensionToken = $raw;

        // Seed telemetry for Org A: developer invite:1 with 3 tools
        // CR-X 18B.2: git_repo_url on sessions seeds the canonical customer
        // repo set so the telemetry∩token-visible authority gate resolves.
        $this->createTelemetryEvent($this->orgA->id, 'invite:1', 'cursor', 'sess-a-1', 'https://github.com/org-alpha/repo-1');
        $this->createTelemetryEvent($this->orgA->id, 'invite:1', 'vscode', 'sess-a-2', 'https://github.com/org-alpha/repo-2');
        $this->createTelemetryEvent($this->orgA->id, 'invite:1', 'windsurf', 'sess-a-3');

        // Seed telemetry for Org A: developer invite:3 with 2 different tools
        $this->createTelemetryEvent($this->orgA->id, 'invite:3', 'cursor', 'sess-a-4');
        $this->createTelemetryEvent($this->orgA->id, 'invite:3', 'devin', 'sess-a-5');

        // Seed telemetry for Org B: 2 session events with distinct tools
        $this->createTelemetryEvent($this->orgB->id, 'invite:2', 'cursor', 'sess-b-1', 'https://github.com/org-beta/repo-1');
        $this->createTelemetryEvent($this->orgB->id, 'invite:2', 'vscode', 'sess-b-2');

        // Org C: no telemetry (empty org)
        $this->seedGitHubFixtures();
    }

    private function createTelemetryEvent(int $orgId, string $userId, string $source, string $sessionId, ?string $repoUrl = null): TelemetryEvent
    {
        return TelemetryEvent::create([
            'organization_id' => $orgId,
            'user_id' => $userId,
            'session_id' => $sessionId,
            'source' => $source,
            'editor_source' => $source,
            'event_type' => 'session',
            'count' => 1,
            'duration_ms' => 60000,
            'timestamp' => now()->subHour(),
            'metadata' => array_filter([
                'segment_type' => 'session',
                'duration_ms' => 60000,
                'active_coding_duration_ms' => 30000,
                'session_id' => $sessionId,
                'git_repo_url' => $repoUrl,
            ], fn($v) => $v !== null),
            'payload' => [],
            'batch_hash' => Str::random(64),
        ]);
    }

    private function seedGitHubFixtures(): void
    {
        // Org A: authenticated GitHub user with a repository allow-list
        DB::table('oauth_tokens')->insert([
            'organization_id' => $this->orgA->id,
            'access_token' => 'gho_test_org_a',
            'user_data' => json_encode([
                'login' => 'org-a-user',
                'token_purpose' => 'engineering_integration',
                'repositories' => ['org-alpha/repo-1', 'org-alpha/repo-2'],
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Org B: authenticated GitHub user with a different repository set
        DB::table('oauth_tokens')->insert([
            'organization_id' => $this->orgB->id,
            'access_token' => 'gho_test_org_b',
            'user_data' => json_encode([
                'login' => 'org-b-user',
                'token_purpose' => 'engineering_integration',
                'repositories' => ['org-beta/repo-1'],
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Org C: deliberately has no OAuth token

        // Org A owns 2 PRs (1 merged)
        PullRequest::create([
            'organization_id' => $this->orgA->id,
            'repo_name' => 'org-alpha/repo-1',
            'developer_id' => 'user:a-1',
            'merged_at' => now(),
            'cursor_usage_detected' => false,
        ]);
        PullRequest::create([
            'organization_id' => $this->orgA->id,
            'repo_name' => 'org-alpha/repo-2',
            'developer_id' => 'user:a-2',
            'merged_at' => null,
            'cursor_usage_detected' => true,
        ]);

        // Org B owns 1 unmerged PR
        PullRequest::create([
            'organization_id' => $this->orgB->id,
            'repo_name' => 'org-beta/repo-1',
            'developer_id' => 'user:b-1',
            'merged_at' => null,
            'cursor_usage_detected' => false,
        ]);
    }

    // === 1-3: No-auth returns 401 ===

    public function test_no_auth_canonical_returns_401(): void
    {
        $this->getJson('/api/telemetry/canonical')->assertStatus(401);
    }

    public function test_no_auth_metrics_returns_401(): void
    {
        $this->getJson('/api/metrics')->assertStatus(401);
    }

    public function test_no_auth_developers_returns_401(): void
    {
        $this->getJson('/api/developers')->assertStatus(401);
    }

    // === 4: Invalid token returns 401 ===

    public function test_invalid_token_canonical_returns_401(): void
    {
        $this->withHeaders(['Authorization' => 'Bearer invalid-xyz-123'])
            ->getJson('/api/telemetry/canonical')->assertStatus(401);
    }

    public function test_invalid_token_metrics_returns_401(): void
    {
        $this->withHeaders(['Authorization' => 'Bearer invalid-xyz-123'])
            ->getJson('/api/metrics')->assertStatus(401);
    }

    public function test_invalid_token_developers_returns_401(): void
    {
        $this->withHeaders(['Authorization' => 'Bearer invalid-xyz-123'])
            ->getJson('/api/developers')->assertStatus(401);
    }

    public function test_sentinel_token_canonical_returns_401(): void
    {
        $this->withHeaders(['Authorization' => 'Bearer oauth_authenticated'])
            ->getJson('/api/telemetry/canonical')->assertStatus(401);
    }

    public function test_sentinel_token_metrics_returns_401(): void
    {
        $this->withHeaders(['Authorization' => 'Bearer oauth_authenticated'])
            ->getJson('/api/metrics')->assertStatus(401);
    }

    public function test_sentinel_token_developers_returns_401(): void
    {
        $this->withHeaders(['Authorization' => 'Bearer oauth_authenticated'])
            ->getJson('/api/developers')->assertStatus(401);
    }

    // === 5: Extension token returns 403 on dashboard reads ===

    public function test_extension_token_canonical_returns_403(): void
    {
        $this->withHeaders(['Authorization' => 'Bearer ' . $this->extensionToken])
            ->getJson('/api/telemetry/canonical')->assertStatus(403);
    }

    public function test_extension_token_metrics_returns_403(): void
    {
        $this->withHeaders(['Authorization' => 'Bearer ' . $this->extensionToken])
            ->getJson('/api/metrics')->assertStatus(403);
    }

    public function test_extension_token_developers_returns_403(): void
    {
        $this->withHeaders(['Authorization' => 'Bearer ' . $this->extensionToken])
            ->getJson('/api/developers')->assertStatus(403);
    }

    // === 6-7: Org-scoped canonical telemetry ===

    public function test_org_a_canonical_shows_only_org_a_telemetry(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/telemetry/canonical?format=sessions');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertEquals(5, $json['metadata']['canonical_population_count'] ?? 0,
            'Org A should see exactly 5 telemetry events (3 from invite:1 + 2 from invite:3)');
    }

    public function test_org_b_canonical_shows_only_org_b_telemetry(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminBToken])
            ->getJson('/api/telemetry/canonical?format=sessions');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertEquals(2, $json['metadata']['canonical_population_count'] ?? 0,
            'Org B should see exactly 2 telemetry events');
    }

    // === 8: Empty org receives zero canonical population ===

    public function test_empty_org_c_canonical_returns_zero_population(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminCToken])
            ->getJson('/api/telemetry/canonical?format=sessions');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertEquals(0, $json['metadata']['canonical_population_count'] ?? -1,
            'Org C (empty) must see 0 canonical population');
        $this->assertEmpty($json['data'] ?? [], 'Org C sessions must be empty');
    }

    // === 9-10: Developers exclude cross-org identities ===

    public function test_org_a_developers_exclude_org_b_identities(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/developers');

        $response->assertStatus(200);
        $developerIds = collect($response->json('developers') ?? [])
            ->pluck('id')
            ->toArray();
        $this->assertNotContains('invite:2', $developerIds,
            'Org A developers must not include Org B identities');
    }

    public function test_org_b_developers_exclude_org_a_identities(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminBToken])
            ->getJson('/api/developers');

        $response->assertStatus(200);
        $developerIds = collect($response->json('developers') ?? [])
            ->pluck('id')
            ->toArray();
        $this->assertNotContains('invite:1', $developerIds,
            'Org B developers must not include Org A identities');
    }

    // === 11-12: Metrics exclude cross-org data ===

    public function test_org_a_metrics_exclude_org_b_telemetry(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/metrics?time_filter=all&oauth=false&nocache=1');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertArrayNotHasKey('metrics_unhandled_exception', $json,
            'Metrics must not return an error envelope');
        $this->assertEquals(5, $json['telemetry_sessions'] ?? -1,
            'Org A metrics should show 5 telemetry sessions, not Org B data');
    }

    public function test_org_b_metrics_exclude_org_a_telemetry(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminBToken])
            ->getJson('/api/metrics?time_filter=all&oauth=false&nocache=1');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertArrayNotHasKey('metrics_unhandled_exception', $json,
            'Metrics must not return an error envelope');
        $this->assertEquals(2, $json['telemetry_sessions'] ?? -1,
            'Org B metrics should show 2 telemetry sessions, not Org A data');
    }

    // === 13: Cross-org query parameters cannot override token organization ===

    public function test_cross_org_query_param_cannot_override_token_org(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/telemetry/canonical?format=sessions&organization_id=999');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertEquals(5, $json['metadata']['canonical_population_count'] ?? -1,
            'Query param organization_id must not override token org');
    }

    public function test_cross_org_user_id_param_cannot_leak_other_org(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/telemetry/canonical?format=sessions&user_id=invite:2');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertEquals(0, $json['metadata']['canonical_population_count'] ?? -1,
            'Org A token with Org B user_id must see 0 events (no matching org+user)');
    }

    // === 14: Rejected requests create no rows ===

    public function test_rejected_requests_create_no_rows(): void
    {
        $inviteBefore = Invite::count();
        $tokenBefore = ApiToken::count();
        $userBefore = User::count();
        $orgBefore = Organization::count();
        $telemetryBefore = TelemetryEvent::count();

        $this->getJson('/api/telemetry/canonical');
        $this->getJson('/api/metrics');
        $this->getJson('/api/developers');
        $this->withHeaders(['Authorization' => 'Bearer invalid'])->getJson('/api/telemetry/canonical');
        $this->withHeaders(['Authorization' => 'Bearer oauth_authenticated'])->getJson('/api/metrics');
        $this->withHeaders(['Authorization' => 'Bearer ' . $this->extensionToken])->getJson('/api/developers');

        $this->assertEquals($inviteBefore, Invite::count(), 'No invites created');
        $this->assertEquals($tokenBefore, ApiToken::count(), 'No tokens created');
        $this->assertEquals($userBefore, User::count(), 'No users created');
        $this->assertEquals($orgBefore, Organization::count(), 'No organizations created');
        $this->assertEquals($telemetryBefore, TelemetryEvent::count(), 'No telemetry rows created');
    }

    // === 15-19: GitHub-derived metrics are strictly scoped by request organization ===

    public function test_org_a_metrics_receives_only_org_a_github_data(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/metrics?time_filter=all&nocache=1');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertArrayNotHasKey('metrics_unhandled_exception', $json);
        $this->assertEquals(2, $json['total_pull_requests'] ?? -1, 'Org A should see its 2 PRs');
        $this->assertEquals(1, $json['merged_pull_requests'] ?? -1, 'Org A should see 1 merged PR');
        $this->assertEquals(2, $json['team_metrics']['total_prs'] ?? -1, 'team_metrics should match Org A');
        $this->assertStringNotContainsString('org-beta/repo-1', json_encode($json['pr_analytics'] ?? []), 'Org A must not see Org B repo data');
    }

    public function test_org_b_metrics_receives_only_org_b_github_data(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminBToken])
            ->getJson('/api/metrics?time_filter=all&nocache=1');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertArrayNotHasKey('metrics_unhandled_exception', $json);
        $this->assertEquals(1, $json['total_pull_requests'] ?? -1, 'Org B should see its 1 PR');
        $this->assertEquals(0, $json['merged_pull_requests'] ?? -1, 'Org B should see 0 merged PRs');
        $this->assertStringNotContainsString('org-alpha/repo-1', json_encode($json['pr_analytics'] ?? []), 'Org B must not see Org A repo data');
    }

    public function test_org_c_metrics_has_no_foreign_github_data(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminCToken])
            ->getJson('/api/metrics?time_filter=all&nocache=1');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertArrayNotHasKey('metrics_unhandled_exception', $json);
        $this->assertEquals(0, $json['total_pull_requests'] ?? -1, 'Org C should see 0 PRs');
        $this->assertEquals(0, $json['merged_pull_requests'] ?? -1, 'Org C should see 0 merged PRs');
        $this->assertEquals(0, $json['team_metrics']['total_prs'] ?? -1, 'team_metrics should be empty for Org C');
        $this->assertStringNotContainsString('org-alpha', json_encode($json['pr_analytics'] ?? []), 'Org C must not contain Org A repo');
        $this->assertStringNotContainsString('org-beta', json_encode($json['pr_analytics'] ?? []), 'Org C must not contain Org B repo');
    }

    public function test_repo_query_param_cannot_escape_organization_allow_list(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/metrics?time_filter=all&repo=org-beta/repo-1&nocache=1');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertArrayNotHasKey('metrics_unhandled_exception', $json);
        $this->assertEquals(0, $json['total_pull_requests'] ?? -1, 'Foreign repo param must not leak data');
    }

    public function test_metrics_cache_key_is_organization_specific(): void
    {
        $respA = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/metrics?time_filter=all&nocache=1');
        $respB = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminBToken])
            ->getJson('/api/metrics?time_filter=all&nocache=1');

        $keyA = $respA->baseResponse->headers->get('X-CM-Cache-Key');
        $keyB = $respB->baseResponse->headers->get('X-CM-Cache-Key');

        $this->assertNotNull($keyA);
        $this->assertNotNull($keyB);
        $this->assertNotEquals($keyA, $keyB, 'Cache keys must differ by organization');
    }

    // === 15: Existing telemetry ingestion path still works (sanity check) ===

    public function test_telemetry_ingestion_path_unaffected(): void
    {
        // POST /api/telemetry and /api/telemetry/upload must not be behind
        // SimpleTokenAuth's dashboard-only scoping; they accept invite-backed
        // extension tokens. Verify the extension token can still POST.
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->extensionToken])
            ->postJson('/api/telemetry', [
                'user_id' => 'invite:1',
                'session_id' => 'sess-ingest-1',
                'source' => 'cursor',
                'event_type' => 'session',
                'metadata' => ['segment_type' => 'session'],
            ]);

        // Accept 200/201/202 as success; only assert it is NOT 401/403,
        // proving the extension token retains ingestion access.
        $this->assertNotEquals(401, $response->getStatusCode());
        $this->assertNotEquals(403, $response->getStatusCode());
    }

    // === Developer Filter Tests ===

    public function test_user_id_filter_sessions_returns_only_selected_developer(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/telemetry/canonical?format=sessions&user_id=invite:1');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertEquals(3, $json['metadata']['canonical_population_count'] ?? -1,
            'invite:1 should return exactly 3 sessions');
        $developerIds = collect($json['data'] ?? [])->pluck('developer_id')->unique()->values()->all();
        $this->assertNotEmpty($developerIds, 'Sessions should have developer_id in metadata');
    }

    public function test_user_id_filter_sessions_returns_distinct_data_for_different_developers(): void
    {
        $resp1 = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/telemetry/canonical?format=sessions&user_id=invite:1');
        $resp3 = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/telemetry/canonical?format=sessions&user_id=invite:3');

        $resp1->assertStatus(200);
        $resp3->assertStatus(200);

        $count1 = $resp1->json('metadata.canonical_population_count');
        $count3 = $resp3->json('metadata.canonical_population_count');

        $this->assertEquals(3, $count1, 'invite:1 has 3 sessions');
        $this->assertEquals(2, $count3, 'invite:3 has 2 sessions');
        $this->assertNotEquals($count1, $count3, 'Developers must have distinct session counts');
    }

    public function test_user_id_filter_aggregated_returns_only_selected_developer(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/telemetry/canonical?format=aggregated&period=week&user_id=invite:1');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertEquals(3, $json['metadata']['canonical_population_count'] ?? -1,
            'invite:1 aggregated should report 3 canonical population');
        $totalSessions = collect($json['data'] ?? [])->sum('session_count');
        $this->assertEquals(3, $totalSessions,
            'invite:1 aggregated should have 3 total sessions across all tool-period rows');
    }

    public function test_user_id_filter_aggregated_returns_distinct_data_for_different_developers(): void
    {
        $resp1 = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/telemetry/canonical?format=aggregated&period=week&user_id=invite:1');
        $resp3 = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/telemetry/canonical?format=aggregated&period=week&user_id=invite:3');

        $resp1->assertStatus(200);
        $resp3->assertStatus(200);

        $pop1 = $resp1->json('metadata.canonical_population_count');
        $pop3 = $resp3->json('metadata.canonical_population_count');

        $this->assertEquals(3, $pop1, 'invite:1 aggregated population is 3');
        $this->assertEquals(2, $pop3, 'invite:3 aggregated population is 2');
        $this->assertNotEquals($pop1, $pop3, 'Aggregated populations must differ by developer');

        $tools1 = $resp1->json('metadata.tools_in_population');
        $tools3 = $resp3->json('metadata.tools_in_population');
        $this->assertContains('devin', $tools3, 'invite:3 should have devin tool');
        $this->assertNotContains('devin', $tools1, 'invite:1 should NOT have devin tool');
    }

    public function test_user_id_filter_aggregated_daily_is_filtered(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/telemetry/canonical?format=aggregated&period=day&user_id=invite:3');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertEquals(2, $json['metadata']['canonical_population_count'] ?? -1,
            'invite:3 daily aggregated should report 2 canonical population');
        $totalSessions = collect($json['data'] ?? [])->sum('session_count');
        $this->assertEquals(2, $totalSessions,
            'invite:3 daily aggregated should have 2 total sessions');
    }

    public function test_nonexistent_identity_returns_zero_records(): void
    {
        $sessResp = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/telemetry/canonical?format=sessions&user_id=invite:999');
        $aggResp = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/telemetry/canonical?format=aggregated&period=week&user_id=invite:999');

        $sessResp->assertStatus(200);
        $aggResp->assertStatus(200);

        $this->assertEquals(0, $sessResp->json('metadata.canonical_population_count'),
            'Nonexistent identity sessions should have 0 population');
        $this->assertEmpty($sessResp->json('data'),
            'Nonexistent identity sessions data should be empty');

        $this->assertEquals(0, $aggResp->json('metadata.canonical_population_count'),
            'Nonexistent identity aggregated should have 0 population');
        $this->assertEmpty($aggResp->json('data'),
            'Nonexistent identity aggregated data should be empty');
    }

    public function test_all_developers_returns_union_of_all_telemetry(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/telemetry/canonical?format=sessions');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertEquals(5, $json['metadata']['canonical_population_count'] ?? -1,
            'All Developers should return union of all org telemetry (3 + 2 = 5)');
    }

    public function test_user_id_filter_metadata_is_scoped_to_developer(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminAToken])
            ->getJson('/api/telemetry/canonical?format=aggregated&period=week&user_id=invite:1');

        $response->assertStatus(200);
        $json = $response->json();
        $metadata = $json['metadata'] ?? [];

        $this->assertEquals(3, $metadata['canonical_population_count'] ?? -1,
            'Metadata population count must be scoped to invite:1');
        $this->assertEquals('invite:1', $metadata['filters_applied']['user_id'] ?? null,
            'Metadata filters_applied must record user_id=invite:1');

        $toolsInPop = $metadata['tools_in_population'] ?? [];
        $this->assertNotContains('devin', $toolsInPop,
            'invite:1 metadata must not include devin (only invite:3 has devin)');
    }

    public function test_user_id_filter_with_org_isolation(): void
    {
        // Org B token with Org A's user_id should return 0 (no matching org+user)
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminBToken])
            ->getJson('/api/telemetry/canonical?format=aggregated&period=week&user_id=invite:1');

        $response->assertStatus(200);
        $json = $response->json();
        $this->assertEquals(0, $json['metadata']['canonical_population_count'] ?? -1,
            'Org B token with Org A user_id must return 0 (org isolation with user filter)');
    }
}
