<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Organization;
use App\Models\TelemetryEvent;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CR2 P0 — Canonical developer (user_id) filter must apply identically to
 * returned data and to response metadata (canonical_population_count,
 * session_count_by_tool, tools_in_population).
 */
class CanonicalDeveloperFilterTest extends TestCase
{
    private string $dashboardToken;
    private int $organizationId;

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

        if (!Schema::hasTable('organizations')) {
            Schema::create('organizations', function ($table) {
                $table->id();
                $table->string('name');
                $table->string('slug')->unique();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('invites')) {
            Schema::create('invites', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->string('email');
                $table->string('status')->default('pending');
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

        if (!Schema::hasTable('api_tokens')) {
            Schema::create('api_tokens', function ($table) {
                $table->id();
                $table->string('token', 64)->unique();
                $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->unsignedBigInteger('invite_id')->nullable();
                $table->string('installation_id', 64)->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->timestamp('revoked_at')->nullable();
                $table->timestamps();
                $table->index('token');
                $table->index('user_id');
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
                $table->timestamps();
            });
        }

        $org = Organization::create(['name' => 'Test Org', 'slug' => 'test-' . uniqid()]);
        $this->organizationId = $org->id;
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-' . Str::random(8) . '@test.com',
            'role' => 'admin',
            'organization_id' => $org->id,
        ]);
        $this->dashboardToken = ApiToken::generateDashboardToken($admin->id, $org->id)['raw'];
    }

    protected function tearDown(): void
    {
        if (app()->environment('testing')
            && config('database.default') === 'sqlite'
            && config('database.connections.sqlite.database') === ':memory:'
        ) {
            Schema::dropIfExists('api_tokens');
            Schema::dropIfExists('telemetry_events');
            Schema::dropIfExists('invites');
            Schema::dropIfExists('users');
            Schema::dropIfExists('organizations');
        }

        parent::tearDown();
    }

    private function createSessionEvent(string $userId, string $source, ?string $editorSource, int $organizationId): TelemetryEvent
    {
        return TelemetryEvent::create([
            'user_id' => $userId,
            'organization_id' => $organizationId,
            'source' => $source,
            'editor_source' => $editorSource,
            'event_type' => 'session',
            'session_id' => 'session-' . Str::random(8),
            'duration_ms' => 60000,
            'timestamp' => now()->subDay(),
            'metadata' => ['segment_type' => 'session'],
            'payload' => [],
            'batch_hash' => Str::random(40),
        ]);
    }

    private function callCanonical(?string $userId = null)
    {
        $qs = 'from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all';
        if ($userId !== null) {
            $qs .= '&user_id=' . urlencode($userId);
        }

        return $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?' . $qs);
    }

    private function assertDataReconcilesWithMetadata($response): void
    {
        $meta = $response->json('metadata');
        $data = $response->json('data');

        $sessionsFromData = [];
        foreach ($data as $row) {
            $sessionsFromData[$row['tool']] = ($sessionsFromData[$row['tool']] ?? 0) + $row['session_count'];
        }

        ksort($sessionsFromData);
        $expected = $meta['session_count_by_tool'];
        ksort($expected);

        $this->assertEquals(
            $expected,
            $sessionsFromData,
            'Per-tool session counts in returned data must reconcile exactly with metadata.session_count_by_tool'
        );
        $this->assertEquals(
            $meta['canonical_population_count'],
            array_sum($sessionsFromData),
            'Sum of session counts in returned data must equal canonical_population_count'
        );
    }

    public function test_no_user_id_returns_full_eligible_population(): void
    {
        $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);
        $this->createSessionEvent('invite:14', 'devin', 'devin', $this->organizationId);

        $response = $this->callCanonical(null);
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $this->assertEquals(2, $meta['canonical_population_count']);
        $this->assertDataReconcilesWithMetadata($response);
    }

    public function test_user_id_filters_returned_data_not_just_metadata(): void
    {
        $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);
        $this->createSessionEvent('invite:11', 'devin', 'devin', $this->organizationId);
        $this->createSessionEvent('invite:14', 'vscode', 'vscode', $this->organizationId);

        $response = $this->callCanonical('invite:11');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $data = $response->json('data');

        $this->assertEquals(2, $meta['canonical_population_count']);
        $this->assertEquals('invite:11', $meta['filters_applied']['user_id']);

        // The proven defect: data must not include invite:14's vscode row
        $tools = array_unique(array_column($data, 'tool'));
        $this->assertNotContains('vscode', $tools, 'Returned data leaked another developer\'s tool row');
        $this->assertDataReconcilesWithMetadata($response);
    }

    public function test_second_developer_scoped_independently(): void
    {
        $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);
        for ($i = 0; $i < 12; $i++) {
            $this->createSessionEvent('invite:14', 'devin', 'devin', $this->organizationId);
        }
        $this->createSessionEvent('invite:14', 'vscode', 'vscode', $this->organizationId);

        $response = $this->callCanonical('invite:14');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $this->assertEquals(13, $meta['canonical_population_count']);
        $this->assertEquals(['devin' => 12, 'vscode' => 1], $meta['session_count_by_tool']);
        $this->assertDataReconcilesWithMetadata($response);
    }

    public function test_nonexistent_developer_returns_empty_truthful_result(): void
    {
        $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);
        $this->createSessionEvent('invite:14', 'devin', 'devin', $this->organizationId);

        $response = $this->callCanonical('invite:999');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $data = $response->json('data');

        $this->assertEquals(0, $meta['canonical_population_count']);
        $this->assertEquals([], $meta['session_count_by_tool']);
        $this->assertEquals([], $meta['tools_in_population']);
        $this->assertEquals([], $data);
    }

    public function test_cross_organization_developer_data_cannot_leak(): void
    {
        $otherOrg = Organization::create(['name' => 'Other Org', 'slug' => 'other-' . uniqid()]);

        // Same user_id string exists in both organizations — must not leak across orgs
        $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);
        $this->createSessionEvent('invite:11', 'devin', 'devin', $otherOrg->id);

        $response = $this->callCanonical('invite:11');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $data = $response->json('data');

        $this->assertEquals(1, $meta['canonical_population_count']);
        $tools = array_unique(array_column($data, 'tool'));
        $this->assertEquals(['cursor'], $tools, 'Cross-organization developer data leaked into response');
        $this->assertDataReconcilesWithMetadata($response);
    }

    // ====================================================================
    // CR-X Phase 3: developer_ids (multi-developer) filter reconciliation
    // ====================================================================

    private function callCanonicalWithDeveloperIds(?string $developerIds = null)
    {
        $qs = 'from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all';
        if ($developerIds !== null) {
            $qs .= '&developer_ids=' . urlencode($developerIds);
        }

        return $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?' . $qs);
    }

    public function test_developer_ids_filters_aggregated_data_not_just_metadata(): void
    {
        // invite:11 has 2 sessions (cursor + devin)
        $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);
        $this->createSessionEvent('invite:11', 'devin', 'devin', $this->organizationId);
        // invite:14 has 1 session (vscode) — must NOT appear in filtered results
        $this->createSessionEvent('invite:14', 'vscode', 'vscode', $this->organizationId);

        $response = $this->callCanonicalWithDeveloperIds('invite:11');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $data = $response->json('data');

        $this->assertEquals(2, $meta['canonical_population_count']);
        $this->assertEquals('invite:11', $meta['filters_applied']['developer_ids']);

        // The proven defect: aggregated data must not include invite:14's vscode row
        $tools = array_unique(array_column($data, 'tool'));
        $this->assertNotContains('vscode', $tools,
            'Aggregated data leaked another developer\'s tool row despite developer_ids filter');
        $this->assertDataReconcilesWithMetadata($response);
    }

    public function test_developer_ids_multi_select_reconciles_exactly(): void
    {
        // invite:11 has 2 sessions
        $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);
        $this->createSessionEvent('invite:11', 'devin', 'devin', $this->organizationId);
        // invite:14 has 3 sessions
        $this->createSessionEvent('invite:14', 'devin', 'devin', $this->organizationId);
        $this->createSessionEvent('invite:14', 'vscode', 'vscode', $this->organizationId);
        $this->createSessionEvent('invite:14', 'vscode', 'vscode', $this->organizationId);
        // invite:99 has 1 session — must NOT appear
        $this->createSessionEvent('invite:99', 'cursor', 'cursor', $this->organizationId);

        $response = $this->callCanonicalWithDeveloperIds('invite:11,invite:14');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $data = $response->json('data');

        // 2 + 3 = 5 sessions from the two selected developers
        $this->assertEquals(5, $meta['canonical_population_count']);
        $this->assertDataReconcilesWithMetadata($response);

        // invite:99's cursor row must not appear (would inflate count)
        $totalSessions = array_sum(array_column($data, 'session_count'));
        $this->assertEquals(5, $totalSessions,
            'Total session count in aggregated data must be 5 (2+3), not include unselected developers');
    }

    public function test_developer_ids_empty_string_returns_full_population(): void
    {
        $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);
        $this->createSessionEvent('invite:14', 'devin', 'devin', $this->organizationId);

        $response = $this->callCanonicalWithDeveloperIds('');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $this->assertEquals(2, $meta['canonical_population_count']);
        $this->assertDataReconcilesWithMetadata($response);
    }

    public function test_developer_ids_appears_in_filters_applied_metadata(): void
    {
        $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);

        $response = $this->callCanonicalWithDeveloperIds('invite:11');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $this->assertEquals('invite:11', $meta['filters_applied']['developer_ids']);
    }

    // ====================================================================
    // CR-X Phase 3 P0: local-developer selector fail-open regression
    // The actual product emits developer_ids=local-developer when Matt is
    // selected. The whereIn clause type 'In' was silently skipped by the
    // old sub-query extraction code, causing fail-open to full org population.
    // ====================================================================

    public function test_local_developer_selector_narrows_population_not_fail_open(): void
    {
        config()->set('local_developer.static_identities', ['local-developer', '4', '18269556']);
        config()->set('local_developer.sample_persona_ids', ['90001', '90002', '90003', '90004', '90005', '90006']);

        // Create events with user_ids that match the static identity set
        // (local-developer, 4, 18269556) and some that don't
        $this->createSessionEvent('local-developer', 'cursor', 'cursor', $this->organizationId);
        $this->createSessionEvent('4', 'devin', 'devin', $this->organizationId);
        $this->createSessionEvent('18269556', 'vscode', 'vscode', $this->organizationId);
        // These should NOT match local-developer resolution
        $this->createSessionEvent('invite:99', 'cursor', 'cursor', $this->organizationId);
        $this->createSessionEvent('other-user', 'devin', 'devin', $this->organizationId);

        $response = $this->callCanonicalWithDeveloperIds('local-developer');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $data = $response->json('data');

        // Must narrow to 3 (the resolved static identities), NOT 5 (full org)
        $this->assertEquals(3, $meta['canonical_population_count'],
            'local-developer selector must narrow population — fail-open regression detected');
        $this->assertEquals('local-developer', $meta['filters_applied']['developer_ids']);
        $this->assertDataReconcilesWithMetadata($response);

        // invite:99 and other-user must NOT appear
        $totalSessions = array_sum(array_column($data, 'session_count'));
        $this->assertEquals(3, $totalSessions,
            'Total sessions must be 3 (resolved identities only), not 5 (full org)');
    }

    public function test_unresolved_developer_selector_fails_closed(): void
    {
        // Create events that do NOT match any static or dynamic identity
        $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);
        $this->createSessionEvent('invite:14', 'devin', 'devin', $this->organizationId);

        // 'nonexistent-dev' is not local-developer, so it's treated as a literal
        // user_id filter. No rows match → empty result (fail closed)
        $response = $this->callCanonicalWithDeveloperIds('nonexistent-dev');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $this->assertEquals(0, $meta['canonical_population_count'],
            'Unresolved developer selector must fail closed (empty), not return full population');
    }

    // ====================================================================
    // CR-X Phase 3 P0: Repo filter + combined developer+repo intersection
    // ====================================================================

    private function callCanonicalWithRepos(?string $repos = null)
    {
        $qs = 'from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all';
        if ($repos !== null) {
            $qs .= '&repos=' . urlencode($repos);
        }

        return $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?' . $qs);
    }

    private function callCanonicalWithDeveloperIdsAndRepos(string $developerIds, string $repos)
    {
        $qs = 'from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all';
        $qs .= '&developer_ids=' . urlencode($developerIds);
        $qs .= '&repos=' . urlencode($repos);

        return $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?' . $qs);
    }

    private function createSessionEventWithRepo(string $userId, string $source, ?string $editorSource, int $organizationId, string $repoUrl): TelemetryEvent
    {
        return TelemetryEvent::create([
            'user_id' => $userId,
            'organization_id' => $organizationId,
            'session_id' => 'session-' . Str::random(8),
            'source' => $source,
            'editor_source' => $editorSource,
            'event_type' => 'session',
            'duration_ms' => 60000,
            'timestamp' => now()->subDay(),
            'metadata' => ['segment_type' => 'session', 'git_repo_url' => $repoUrl],
            'payload' => [],
            'batch_hash' => Str::random(40),
        ]);
    }

    public function test_repo_filter_narrows_population(): void
    {
        $this->createSessionEventWithRepo('invite:11', 'cursor', 'cursor', $this->organizationId, 'https://github.com/owner/repo-a.git');
        $this->createSessionEventWithRepo('invite:11', 'devin', 'devin', $this->organizationId, 'https://github.com/owner/repo-b.git');
        $this->createSessionEventWithRepo('invite:14', 'vscode', 'vscode', $this->organizationId, 'https://github.com/owner/repo-a.git');

        // Unfiltered: 3 sessions
        $responseUnfiltered = $this->callCanonicalWithRepos(null);
        $this->assertEquals(3, $responseUnfiltered->json('metadata.canonical_population_count'));

        // Filter to repo-a: 2 sessions (invite:11 cursor + invite:14 vscode)
        $response = $this->callCanonicalWithRepos('owner/repo-a');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $this->assertEquals(2, $meta['canonical_population_count'],
            'Repo filter must narrow population from 3 to 2');
        $this->assertEquals('owner/repo-a', $meta['filters_applied']['repos']);
        $this->assertDataReconcilesWithMetadata($response);
    }

    public function test_combined_developer_and_repo_filter_is_intersection(): void
    {
        $this->createSessionEventWithRepo('invite:11', 'cursor', 'cursor', $this->organizationId, 'https://github.com/owner/repo-a.git');
        $this->createSessionEventWithRepo('invite:11', 'devin', 'devin', $this->organizationId, 'https://github.com/owner/repo-b.git');
        $this->createSessionEventWithRepo('invite:14', 'vscode', 'vscode', $this->organizationId, 'https://github.com/owner/repo-a.git');

        // developer_ids=invite:11 + repos=owner/repo-a → only 1 session (invite:11 + repo-a)
        $qs = 'from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all';
        $qs .= '&developer_ids=' . urlencode('invite:11') . '&repos=' . urlencode('owner/repo-a');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?' . $qs);
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $this->assertEquals(1, $meta['canonical_population_count'],
            'Combined developer+repo filter must be intersection (1), not union (3) or developer-only (2)');
        $this->assertDataReconcilesWithMetadata($response);
    }

    public function test_filter_cache_key_changes_with_developer_and_repo(): void
    {
        $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);

        // First request with developer_ids
        $response1 = $this->callCanonicalWithDeveloperIds('invite:11');
        $hash1 = $response1->json('metadata.query_hash');

        // Second request with different developer_ids
        $response2 = $this->callCanonicalWithDeveloperIds('invite:14');
        $hash2 = $response2->json('metadata.query_hash');

        $this->assertNotEquals($hash1, $hash2,
            'Cache key (query_hash) must change when developer_ids changes');

        // Third request with repos
        $response3 = $this->callCanonicalWithRepos('owner/repo-a');
        $hash3 = $response3->json('metadata.query_hash');

        $this->assertNotEquals($hash1, $hash3,
            'Cache key (query_hash) must change when repos filter is added');
    }

    // ====================================================================
    // CR-X Day 1B S1 P0-A: invite_backed_count in canonical metadata
    // The canonical metadata must include invite_backed_count computed over
    // the SAME scoped query as canonical_population_count. This guarantees
    // the frontend coverage numerator and denominator describe the exact
    // same population — no divergent frontend identity resolution.
    // ====================================================================

    public function test_canonical_metadata_includes_invite_backed_count(): void
    {
        $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);
        $this->createSessionEvent('invite:14', 'devin', 'devin', $this->organizationId);
        $this->createSessionEvent('legacy_dev', 'cursor', 'cursor', $this->organizationId);

        $response = $this->callCanonical();
        $this->assertEquals(3, $response->json('metadata.canonical_population_count'));
        $this->assertEquals(2, $response->json('metadata.invite_backed_count'),
            'invite_backed_count must count sessions with user_id LIKE invite:%');
    }

    public function test_invite_backed_count_scoped_to_developer_filter(): void
    {
        // invite:11 has 2 sessions, invite:14 has 1, legacy_dev has 1
        $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);
        $this->createSessionEvent('invite:11', 'devin', 'devin', $this->organizationId);
        $this->createSessionEvent('invite:14', 'devin', 'devin', $this->organizationId);
        $this->createSessionEvent('legacy_dev', 'cursor', 'cursor', $this->organizationId);

        $response = $this->callCanonicalWithDeveloperIds('invite:11');
        $this->assertEquals(2, $response->json('metadata.canonical_population_count'));
        $this->assertEquals(2, $response->json('metadata.invite_backed_count'),
            'Both sessions for invite:11 are invite-backed');
    }

    public function test_invite_backed_count_zero_for_legacy_only_population(): void
    {
        $this->createSessionEvent('legacy_dev', 'cursor', 'cursor', $this->organizationId);
        $this->createSessionEvent('legacy_dev2', 'devin', 'devin', $this->organizationId);

        $response = $this->callCanonical();
        $this->assertEquals(2, $response->json('metadata.canonical_population_count'));
        $this->assertEquals(0, $response->json('metadata.invite_backed_count'),
            'No invite-backed sessions in legacy-only population');
    }

    public function test_invite_backed_count_scoped_to_repo_filter(): void
    {
        $this->createSessionEventWithRepo('invite:11', 'cursor', 'cursor', $this->organizationId, 'https://github.com/owner/repo-a.git');
        $this->createSessionEventWithRepo('legacy_dev', 'cursor', 'cursor', $this->organizationId, 'https://github.com/owner/repo-a.git');
        $this->createSessionEventWithRepo('invite:14', 'devin', 'devin', $this->organizationId, 'https://github.com/owner/repo-b.git');

        $response = $this->callCanonicalWithRepos('owner/repo-a');
        $this->assertEquals(2, $response->json('metadata.canonical_population_count'));
        $this->assertEquals(1, $response->json('metadata.invite_backed_count'),
            'Only 1 of 2 repo-a sessions is invite-backed');
    }

    public function test_invite_backed_count_scoped_to_combined_filter(): void
    {
        $this->createSessionEventWithRepo('invite:11', 'cursor', 'cursor', $this->organizationId, 'https://github.com/owner/repo-a.git');
        $this->createSessionEventWithRepo('invite:11', 'devin', 'devin', $this->organizationId, 'https://github.com/owner/repo-b.git');
        $this->createSessionEventWithRepo('legacy_dev', 'cursor', 'cursor', $this->organizationId, 'https://github.com/owner/repo-a.git');

        $response = $this->callCanonicalWithDeveloperIdsAndRepos('invite:11', 'owner/repo-a');
        $this->assertEquals(1, $response->json('metadata.canonical_population_count'));
        $this->assertEquals(1, $response->json('metadata.invite_backed_count'),
            'The 1 session in the intersection is invite-backed');
    }

    // ====================================================================
    // CR-X Day 2 X1: total_commit_count in canonical metadata
    // The canonical metadata must include total_commit_count computed over
    // the SAME scoped canonical query. This is the denominator for
    // cost-per-commit in the PBT cost summary strip.
    // Source: CR-X-PILOT-READINESS-AUDIT.md:850 — "Cost per commit | YES
    // (accepted) | denominator: commit event count"
    // ====================================================================

    private function createCommitEvent(string $userId, string $source, int $organizationId, string $sessionId = null): TelemetryEvent
    {
        return TelemetryEvent::create([
            'user_id' => $userId,
            'organization_id' => $organizationId,
            'source' => $source,
            'editor_source' => $source,
            'event_type' => 'commit',
            'session_id' => $sessionId ?? 'session-' . Str::random(8),
            'timestamp' => now()->subDay(),
            'metadata' => [],
            'payload' => [],
            'batch_hash' => Str::random(40),
        ]);
    }

    public function test_canonical_metadata_includes_total_commit_count(): void
    {
        $s1 = $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);
        $s2 = $this->createSessionEvent('invite:14', 'devin', 'devin', $this->organizationId);
        $this->createCommitEvent('invite:11', 'cursor', $this->organizationId, $s1->session_id);
        $this->createCommitEvent('invite:11', 'cursor', $this->organizationId, $s1->session_id);
        $this->createCommitEvent('invite:14', 'devin', $this->organizationId, $s2->session_id);

        $response = $this->callCanonical();
        $this->assertEquals(2, $response->json('metadata.canonical_population_count'));
        $this->assertEquals(3, $response->json('metadata.total_commit_count'),
            'total_commit_count must count event_type=commit events sharing session_ids with canonical sessions');
    }

    public function test_total_commit_count_zero_when_no_commits(): void
    {
        $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);

        $response = $this->callCanonical();
        $this->assertEquals(1, $response->json('metadata.canonical_population_count'));
        $this->assertEquals(0, $response->json('metadata.total_commit_count'),
            'total_commit_count must be 0 when no commit events share session_ids with canonical sessions');
    }

    public function test_total_commit_count_scoped_to_developer_filter(): void
    {
        $s1 = $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);
        $s2 = $this->createSessionEvent('invite:14', 'devin', 'devin', $this->organizationId);
        $this->createCommitEvent('invite:11', 'cursor', $this->organizationId, $s1->session_id);
        $this->createCommitEvent('invite:14', 'devin', $this->organizationId, $s2->session_id);
        $this->createCommitEvent('invite:14', 'devin', $this->organizationId, $s2->session_id);

        $response = $this->callCanonicalWithDeveloperIds('invite:11');
        $this->assertEquals(1, $response->json('metadata.canonical_population_count'));
        $this->assertEquals(1, $response->json('metadata.total_commit_count'),
            'total_commit_count must be scoped to the developer filter (only commits for invite:11 sessions)');
    }

    // ====================================================================
    // CR-X Day 2 X1 HARDENING: Explicit tenant isolation on commit count.
    // Commit events sharing a session_id with canonical sessions in another
    // organization must NOT contribute to total_commit_count.
    // ====================================================================

    public function test_total_commit_count_isolated_by_organization(): void
    {
        $otherOrgId = 999;
        // Create a session in the authenticated org
        $s1 = $this->createSessionEvent('invite:11', 'cursor', 'cursor', $this->organizationId);
        // Create a commit for that session in the authenticated org
        $this->createCommitEvent('invite:11', 'cursor', $this->organizationId, $s1->session_id);

        // Create a commit event in a DIFFERENT org that shares the same session_id
        // This simulates a theoretical cross-org session_id collision
        TelemetryEvent::create([
            'user_id' => 'invite:99',
            'organization_id' => $otherOrgId,
            'source' => 'cursor',
            'editor_source' => 'cursor',
            'event_type' => 'commit',
            'session_id' => $s1->session_id,
            'timestamp' => now()->subDay(),
            'metadata' => [],
            'payload' => [],
            'batch_hash' => Str::random(40),
        ]);

        $response = $this->callCanonical();
        $this->assertEquals(1, $response->json('metadata.canonical_population_count'));
        // Only the commit in the authenticated org should count — not the
        // cross-org commit sharing the same session_id
        $this->assertEquals(1, $response->json('metadata.total_commit_count'),
            'total_commit_count must be isolated by organization — cross-org session_id collision must not leak commits');
    }

    public function test_total_commit_count_zero_remains_zero_not_fail_open(): void
    {
        // No sessions, no commits — total_commit_count must be 0, not fail open
        $response = $this->callCanonical();
        $this->assertEquals(0, $response->json('metadata.canonical_population_count'));
        $this->assertEquals(0, $response->json('metadata.total_commit_count'),
            'total_commit_count must be 0 when canonical population is empty — no fail-open');
    }

    private function callCanonicalGroupedByDeveloper(string $tools = 'all', ?string $developerIds = null, ?string $repos = null)
    {
        $qs = 'from=2000-01-01&to=2099-12-31&format=aggregated&period=week&group_by=developer';
        $qs .= '&tools=' . urlencode($tools);
        if ($developerIds !== null) {
            $qs .= '&developer_ids=' . urlencode($developerIds);
        }
        if ($repos !== null) {
            $qs .= '&repos=' . urlencode($repos);
        }

        return $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?' . $qs);
    }

    public function test_developer_grouping_collapses_aliases_and_reconciles_coverage(): void
    {
        config()->set('local_developer.static_identities', ['local-developer', '4', '18269556']);
        $this->createSessionEvent('local-developer', 'devin', 'devin', $this->organizationId);
        $this->createSessionEvent('18269556', 'windsurf', 'windsurf', $this->organizationId);
        $this->createSessionEvent('opaque-user', 'devin', 'devin', $this->organizationId);

        $response = $this->callCanonicalGroupedByDeveloper('devin,windsurf');
        $response->assertStatus(200);

        $this->assertEquals(3, $response->json('metadata.canonical_population_count'));
        $this->assertEquals(2, $response->json('metadata.developer_attributed_sessions'));
        $this->assertEquals(1, $response->json('metadata.developer_unattributed_sessions'));
        $this->assertEquals(['local-developer' => 2], $response->json('metadata.session_count_by_group'));
        $this->assertEquals(['local-developer'], array_values(array_unique(array_column($response->json('data'), 'developer'))));
        $this->assertEquals(2, array_sum(array_column($response->json('data'), 'session_count')));
    }

    public function test_developer_grouping_uses_only_evidence_backed_local_personas(): void
    {
        config()->set('local_developer.sample_persona_ids', ['90001', '90002', '90003', '90004', '90005', '90006']);
        $simulated = $this->createSessionEvent('90002', 'claude_code', 'claude_code', $this->organizationId);
        $simulated->metadata = ['segment_type' => 'session', 'simulated' => true];
        $simulated->save();
        $this->createSessionEvent('90010', 'claude_code', 'claude_code', $this->organizationId);

        $response = $this->callCanonicalGroupedByDeveloper('claude_code');
        $response->assertStatus(200);

        $this->assertEquals(['90002' => 1], $response->json('metadata.session_count_by_group'));
        $this->assertEquals(1, $response->json('metadata.developer_unattributed_sessions'));
    }

    public function test_developer_grouping_intersects_developer_repo_and_tool_filters(): void
    {
        DB::table('invites')->insert([
            'id' => 11,
            'organization_id' => $this->organizationId,
            'email' => 'developer@test.com',
            'status' => 'accepted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->createSessionEventWithRepo('invite:11', 'claude_code', 'claude_code', $this->organizationId, 'https://github.com/owner/repo-a.git');
        $this->createSessionEventWithRepo('invite:11', 'devin', 'devin', $this->organizationId, 'https://github.com/owner/repo-b.git');
        $this->createSessionEventWithRepo('opaque-user', 'claude_code', 'claude_code', $this->organizationId, 'https://github.com/owner/repo-a.git');

        $response = $this->callCanonicalGroupedByDeveloper('claude_code', 'invite:11', 'owner/repo-a');
        $response->assertStatus(200);

        $this->assertEquals(1, $response->json('metadata.canonical_population_count'));
        $this->assertEquals(['invite:11' => 1], $response->json('metadata.session_count_by_group'));
        $this->assertEquals('invite:11', $response->json('data.0.developer'));
    }

    public function test_developer_grouping_zero_attribution_is_successful_and_truthful(): void
    {
        $this->createSessionEvent('opaque-user', 'cursor', 'cursor', $this->organizationId);

        $response = $this->callCanonicalGroupedByDeveloper('cursor');
        $response->assertStatus(200);

        $this->assertEquals([], $response->json('data'));
        $this->assertEquals(1, $response->json('metadata.canonical_population_count'));
        $this->assertEquals(0, $response->json('metadata.developer_attributed_sessions'));
        $this->assertEquals(1, $response->json('metadata.developer_unattributed_sessions'));
        $this->assertEquals([], $response->json('metadata.groups_in_population'));
    }

    // ====================================================================
    // Pilot Ops 17G.3: canonical workflow scope consistency.
    // A Claude Code bridge session hosted on the VS Code surface
    // (editor_source='vscode' + bridge markers) is canonically attributed
    // to claude_code by the aggregated CASE. The tools= filter must scope
    // to the same canonical workflow population: tools=vscode must exclude
    // it, tools=claude_code must include it. PBT Cards (aggregated,
    // per-tool session_count) and individual workflow drilldown
    // (group_by=developer / canonical_population_count) must agree.
    // ====================================================================

    private function createHostedClaudeOnVscodeSession(string $userId, int $organizationId): TelemetryEvent
    {
        return TelemetryEvent::create([
            'user_id' => $userId,
            'organization_id' => $organizationId,
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'event_type' => 'session',
            'session_id' => 'session-' . Str::random(8),
            'duration_ms' => 60000,
            'timestamp' => now()->subDay(),
            'metadata' => [
                'segment_type' => 'session',
                'vscode_version' => 'claude-code',
                'extension_version' => 'cc-bridge-0.3.7',
            ],
            'payload' => [],
            'batch_hash' => Str::random(40),
        ]);
    }

    private function callCanonicalWithTools(string $tools)
    {
        $qs = 'from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=' . urlencode($tools);

        return $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?' . $qs);
    }

    public function test_hosted_claude_session_excluded_from_canonical_vscode_scope(): void
    {
        $this->createSessionEvent('invite:11', 'vscode', 'vscode', $this->organizationId);
        $this->createHostedClaudeOnVscodeSession('invite:11', $this->organizationId);

        $response = $this->callCanonicalWithTools('vscode');
        $response->assertStatus(200);

        $this->assertEquals(1, $response->json('metadata.canonical_population_count'),
            'tools=vscode must scope to the canonical VS Code workflow (1), not the raw surface population (2)');
        $this->assertEquals(['vscode' => 1], $response->json('metadata.session_count_by_tool'));
    }

    public function test_hosted_claude_session_included_in_canonical_claude_scope(): void
    {
        $this->createSessionEvent('invite:11', 'vscode', 'vscode', $this->organizationId);
        $this->createHostedClaudeOnVscodeSession('invite:11', $this->organizationId);

        $response = $this->callCanonicalWithTools('claude_code');
        $response->assertStatus(200);

        $this->assertEquals(1, $response->json('metadata.canonical_population_count'),
            'tools=claude_code must include the VS Code-hosted Claude session');
        $this->assertEquals(['claude_code' => 1], $response->json('metadata.session_count_by_tool'));
    }

    public function test_hosted_claude_exclusion_applies_to_developer_drilldown_scope(): void
    {
        $this->createSessionEvent('invite:11', 'vscode', 'vscode', $this->organizationId);
        $this->createHostedClaudeOnVscodeSession('invite:11', $this->organizationId);

        $response = $this->callCanonicalGroupedByDeveloper('vscode');
        $response->assertStatus(200);

        $this->assertEquals(1, $response->json('metadata.canonical_population_count'),
            'Individual VS Code drilldown must use the canonical VS Code population (1), not the raw surface population (2)');
    }

    public function test_hosted_claude_included_when_claude_requested_alongside_vscode(): void
    {
        $this->createSessionEvent('invite:11', 'vscode', 'vscode', $this->organizationId);
        $this->createHostedClaudeOnVscodeSession('invite:11', $this->organizationId);

        $response = $this->callCanonicalWithTools('vscode,claude_code');
        $response->assertStatus(200);

        $this->assertEquals(2, $response->json('metadata.canonical_population_count'));
        $this->assertEquals(['vscode' => 1, 'claude_code' => 1], $response->json('metadata.session_count_by_tool'));
    }
}
