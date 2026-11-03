<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Organization;
use App\Models\TelemetryEvent;
use App\Models\User;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CR-X 2B.1 — Canonical repository filter must use deterministic canonical
 * identity matching, not fuzzy LIKE wildcards.
 *
 * Proves:
 * A. Equivalent GitHub raw URLs all match the same canonical owner/repo.
 * B. Equivalent Azure variants match the same canonical identity.
 * C. owner/repo does NOT match another owner with same repo name, longer
 *    paths, or suffix collisions.
 * D. Unrelated repos remain excluded.
 * E. LIKE-significant characters (%, _) cannot broaden matching.
 * F. Cards/Time Series backend population source remains the exact filtered
 *    population.
 *
 * Uses ephemeral SQLite :memory: only. No Local DB mutation.
 */
class CanonicalRepoFilterTest extends TestCase
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
            Schema::dropIfExists('users');
            Schema::dropIfExists('organizations');
        }

        parent::tearDown();
    }

    /**
     * Create a session event with a specific git_repo_url in metadata.
     */
    private function createSessionWithRepo(string $repoUrl, ?string $sessionId = null): TelemetryEvent
    {
        return TelemetryEvent::create([
            'user_id' => 'invite:1',
            'organization_id' => $this->organizationId,
            'session_id' => $sessionId ?: Str::uuid()->toString(),
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'event_type' => 'session',
            'duration_ms' => 60000,
            'timestamp' => now()->subDay(),
            'metadata' => [
                'segment_type' => 'session',
                'git_repo_url' => $repoUrl,
            ],
            'payload' => [],
            'batch_hash' => Str::random(40),
        ]);
    }

    /**
     * Call the canonical endpoint with a repos filter.
     */
    private function callCanonicalWithRepos(string $reposFilter)
    {
        $qs = 'from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all';
        $qs .= '&repos=' . urlencode($reposFilter);

        return $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?' . $qs);
    }

    // ── A. Equivalent GitHub raw URLs all match ──────────────────────────

    public function test_a_equivalent_github_urls_all_match_same_canonical_filter(): void
    {
        // Create sessions with equivalent GitHub URLs for owner/repo
        $this->createSessionWithRepo('https://github.com/owner/repo.git');
        $this->createSessionWithRepo('https://github.com/owner/repo');
        $this->createSessionWithRepo('git@github.com:owner/repo.git');
        $this->createSessionWithRepo('git@github.com:owner/repo');
        $this->createSessionWithRepo('https://user@github.com/owner/repo.git');
        // Unrelated repo
        $this->createSessionWithRepo('https://github.com/other/repo.git');

        $response = $this->callCanonicalWithRepos('owner/repo');
        $response->assertStatus(200);

        $popCount = $response->json('metadata.canonical_population_count');
        $this->assertEquals(5, $popCount, 'All 5 equivalent GitHub URLs for owner/repo must match');
    }

    public function test_a_case_insensitive_github_urls_match(): void
    {
        $this->createSessionWithRepo('https://github.com/Owner/Repo.git');
        $this->createSessionWithRepo('https://github.com/owner/repo');

        $response = $this->callCanonicalWithRepos('owner/repo');
        $response->assertStatus(200);

        $popCount = $response->json('metadata.canonical_population_count');
        $this->assertEquals(2, $popCount, 'Case-insensitive GitHub URLs must match');
    }

    // ── B. Equivalent Azure variants match ───────────────────────────────

    public function test_b_equivalent_azure_urls_match_same_canonical_filter(): void
    {
        $this->createSessionWithRepo('https://dev.azure.com/org/proj/_git/repo');
        $this->createSessionWithRepo('https://user@dev.azure.com/org/proj/_git/repo');
        // Unrelated Azure repo
        $this->createSessionWithRepo('https://dev.azure.com/org/proj/_git/other-repo');

        $response = $this->callCanonicalWithRepos('azure:org/repo');
        $response->assertStatus(200);

        $popCount = $response->json('metadata.canonical_population_count');
        $this->assertEquals(2, $popCount, 'Both equivalent Azure URLs must match');
    }

    // ── C. False-positive collision tests ────────────────────────────────

    public function test_c_does_not_match_different_owner_same_repo_name(): void
    {
        $this->createSessionWithRepo('https://github.com/owner/repo.git');
        $this->createSessionWithRepo('https://github.com/another/repo.git');

        $response = $this->callCanonicalWithRepos('owner/repo');
        $response->assertStatus(200);

        $popCount = $response->json('metadata.canonical_population_count');
        $this->assertEquals(1, $popCount, 'Must NOT match another/owner with same repo name');
    }

    public function test_c_does_not_match_longer_path_containing_owner_repo(): void
    {
        $this->createSessionWithRepo('https://github.com/owner/repo.git');
        // Longer path that contains "owner/repo" as a substring
        $this->createSessionWithRepo('https://github.com/team/owner/repo.git');

        $response = $this->callCanonicalWithRepos('owner/repo');
        $response->assertStatus(200);

        $popCount = $response->json('metadata.canonical_population_count');
        $this->assertEquals(1, $popCount, 'Must NOT match team/owner/repo (longer path)');
    }

    public function test_c_does_not_match_suffix_collision(): void
    {
        $this->createSessionWithRepo('https://github.com/owner/repo.git');
        // Suffix collision: owner/repo-suffix contains "owner/repo" as prefix
        $this->createSessionWithRepo('https://github.com/owner/repo-suffix.git');
        // Prefix collision: owner-repo/repo contains "repo" but not "owner/repo"
        $this->createSessionWithRepo('https://github.com/owner-repo/repo.git');

        $response = $this->callCanonicalWithRepos('owner/repo');
        $response->assertStatus(200);

        $popCount = $response->json('metadata.canonical_population_count');
        $this->assertEquals(1, $popCount, 'Must NOT match owner/repo-suffix or owner-repo/repo');
    }

    // ── D. Unrelated repos remain excluded ───────────────────────────────

    public function test_d_unrelated_repos_excluded(): void
    {
        $this->createSessionWithRepo('https://github.com/owner/repo.git');
        $this->createSessionWithRepo('https://github.com/other/thing.git');
        $this->createSessionWithRepo('https://github.com/different/project.git');

        $response = $this->callCanonicalWithRepos('owner/repo');
        $response->assertStatus(200);

        $popCount = $response->json('metadata.canonical_population_count');
        $this->assertEquals(1, $popCount, 'Only the matching repo must be included');
    }

    public function test_d_multi_repo_filter_works(): void
    {
        $this->createSessionWithRepo('https://github.com/owner/repo.git');
        $this->createSessionWithRepo('https://github.com/other/thing.git');
        $this->createSessionWithRepo('https://github.com/different/project.git');

        $response = $this->callCanonicalWithRepos('owner/repo,other/thing');
        $response->assertStatus(200);

        $popCount = $response->json('metadata.canonical_population_count');
        $this->assertEquals(2, $popCount, 'Both selected repos must match');
    }

    // ── E. LIKE-significant characters cannot broaden matching ───────────

    public function test_e_percent_character_does_not_broaden_match(): void
    {
        $this->createSessionWithRepo('https://github.com/owner/repo.git');
        $this->createSessionWithRepo('https://github.com/other/thing.git');
        $this->createSessionWithRepo('https://github.com/any/any.git');

        // If LIKE wildcards were used, '%' would match everything
        $response = $this->callCanonicalWithRepos('owner/repo%');
        $response->assertStatus(200);

        $popCount = $response->json('metadata.canonical_population_count');
        // Should be 0 — "owner/repo%" is not a valid canonical ID
        $this->assertEquals(0, $popCount, 'Percent character must not broaden matching');
    }

    public function test_e_underscore_character_does_not_broaden_match(): void
    {
        $this->createSessionWithRepo('https://github.com/owner/repo.git');
        $this->createSessionWithRepo('https://github.com/other/repo.git');

        // If LIKE wildcards were used, '_' would match any single character
        $response = $this->callCanonicalWithRepos('owner/re_o');
        $response->assertStatus(200);

        $popCount = $response->json('metadata.canonical_population_count');
        // Should be 0 — "owner/re_o" is not a valid canonical ID for any repo
        $this->assertEquals(0, $popCount, 'Underscore character must not broaden matching');
    }

    // ── F. Population source remains exact filtered population ───────────

    public function test_f_population_count_reconciles_with_returned_data(): void
    {
        $this->createSessionWithRepo('https://github.com/owner/repo.git');
        $this->createSessionWithRepo('https://github.com/owner/repo');
        $this->createSessionWithRepo('https://github.com/other/thing.git');

        $response = $this->callCanonicalWithRepos('owner/repo');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $data = $response->json('data');

        $sessionsFromData = 0;
        foreach ($data as $row) {
            $sessionsFromData += $row['session_count'];
        }

        $this->assertEquals(
            $meta['canonical_population_count'],
            $sessionsFromData,
            'Sum of session counts in returned data must equal canonical_population_count'
        );
        $this->assertEquals(2, $meta['canonical_population_count']);
    }

    public function test_f_no_match_returns_empty_not_error(): void
    {
        $this->createSessionWithRepo('https://github.com/owner/repo.git');

        $response = $this->callCanonicalWithRepos('nonexistent/repo');
        $response->assertStatus(200);

        $popCount = $response->json('metadata.canonical_population_count');
        $this->assertEquals(0, $popCount, 'No match must return empty population, not error');
    }

    // ── Session format also respects repo filter ─────────────────────────

    public function test_session_format_respects_repo_filter(): void
    {
        $this->createSessionWithRepo('https://github.com/owner/repo.git', 'session-1');
        $this->createSessionWithRepo('https://github.com/other/thing.git', 'session-2');

        $qs = 'from=2000-01-01&to=2099-12-31&format=sessions&tools=all';
        $qs .= '&repos=' . urlencode('owner/repo');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?' . $qs);
        $response->assertStatus(200);

        $popCount = $response->json('metadata.canonical_population_count');
        $this->assertEquals(1, $popCount, 'Session format must also respect repo filter');
    }
}
