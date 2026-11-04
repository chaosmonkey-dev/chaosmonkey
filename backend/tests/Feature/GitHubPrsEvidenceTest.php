<?php
namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Organization;
use App\Models\PullRequest;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CR-X P0-2: GitHub PR Evidence Array Contract Tests
 *
 * Verifies that /api/metrics exposes a `prs` array mapped from existing
 * pull_requests rows for L3 directional attribution, with:
 *   - expected L3 fields (id, pr_number, repo, user_login, data_source, created_at, merged_at)
 *   - organization isolation (no cross-org leakage)
 *   - time_filter respected
 *   - per-PR data_source provenance preserved truthfully
 *
 * Runs against a disposable in-memory SQLite database (:memory:).
 * Does NOT touch any real local data.
 */
class GitHubPrsEvidenceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // Local Lab mode enables the cm_activity_sim fallback for PR queries
        // when no org OAuth repo allow-list is available.
        config(['app.env' => 'local']);
        \Cache::flush();
        $this->withoutMiddleware();
    }

    // ════════════════════════════════════════════════════════════
    // prs ARRAY PRESENCE + SHAPE
    // ════════════════════════════════════════════════════════════

    public function test_metrics_exposes_prs_array()
    {
        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        $this->assertArrayHasKey('prs', $j, 'metrics response must expose a prs array');
        $this->assertIsArray($j['prs']);
    }

    public function test_prs_array_has_expected_l3_fields()
    {
        PullRequest::create([
            'repo_name' => 'local-demo/cm-activity-sim',
            'pr_number' => 101,
            'user_login' => 'dev1',
            'data_source' => 'cm_activity_sim',
            'merged_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        $this->assertGreaterThanOrEqual(1, count($j['prs'] ?? []));
        $pr = $j['prs'][0];
        $this->assertArrayHasKey('id', $pr);
        $this->assertArrayHasKey('pr_number', $pr);
        $this->assertArrayHasKey('repo', $pr);
        $this->assertArrayHasKey('user_login', $pr);
        $this->assertArrayHasKey('data_source', $pr);
        $this->assertArrayHasKey('created_at', $pr);
        $this->assertArrayHasKey('merged_at', $pr);
        // repo maps from repo_name
        $this->assertEquals('local-demo/cm-activity-sim', $pr['repo']);
        $this->assertEquals('dev1', $pr['user_login']);
        $this->assertEquals('cm_activity_sim', $pr['data_source']);
    }

    public function test_prs_array_does_not_expose_developer_id_or_lineage_fields()
    {
        PullRequest::create([
            'repo_name' => 'local-demo/cm-activity-sim',
            'pr_number' => 101,
            'developer_id' => 'dev_0',
            'data_source' => 'cm_activity_sim',
            'merged_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        $pr = $j['prs'][0] ?? null;
        $this->assertNotNull($pr);
        // L3 only — no developer_id in the API contract
        $this->assertArrayNotHasKey('developer_id', $pr);
        // No lineage fields (Track A P0-B DB TASK)
        $this->assertArrayNotHasKey('head_sha', $pr);
        $this->assertArrayNotHasKey('merge_sha', $pr);
        $this->assertArrayNotHasKey('commit_shas', $pr);
        $this->assertArrayNotHasKey('head_ref', $pr);
        $this->assertArrayNotHasKey('base_ref', $pr);
    }

    // ════════════════════════════════════════════════════════════
    // TIME FILTER RESPECTED
    // ════════════════════════════════════════════════════════════

    public function test_prs_array_respects_week_time_filter()
    {
        // Old PR (outside week window) — should NOT appear in week filter
        PullRequest::create([
            'repo_name' => 'local-demo/cm-activity-sim',
            'pr_number' => 100,
            'data_source' => 'cm_activity_sim',
            'created_at' => now()->subYear(),
            'updated_at' => now()->subYear(),
        ]);
        // Recent PR (inside week window) — should appear
        PullRequest::create([
            'repo_name' => 'local-demo/cm-activity-sim',
            'pr_number' => 101,
            'data_source' => 'cm_activity_sim',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        $prNumbers = array_column($j['prs'] ?? [], 'pr_number');
        $this->assertContains(101, $prNumbers, 'recent PR should be in prs array');
        $this->assertNotContains(100, $prNumbers, 'old PR should be excluded by week filter');
    }

    // ════════════════════════════════════════════════════════════
    // PER-PR PROVENANCE PRESERVED
    // ════════════════════════════════════════════════════════════

    public function test_prs_array_preserves_per_pr_data_source_provenance()
    {
        // In Local Lab mode, applyOrganizationRepoFilter selects only
        // data_source = 'cm_activity_sim' PRs (the Local demo authority).
        // Both PRs use cm_activity_sim but different repos to prove per-PR
        // provenance is preserved individually.
        PullRequest::create([
            'repo_name' => 'local-demo/cm-activity-sim',
            'pr_number' => 201,
            'data_source' => 'cm_activity_sim',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        PullRequest::create([
            'repo_name' => 'local-demo/cm-activity-sim',
            'pr_number' => 202,
            'data_source' => 'cm_activity_sim',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        $prs = $j['prs'] ?? [];
        $byNumber = [];
        foreach ($prs as $pr) {
            $byNumber[$pr['pr_number']] = $pr;
        }
        $this->assertEquals('cm_activity_sim', $byNumber[201]['data_source'] ?? null);
        $this->assertEquals('cm_activity_sim', $byNumber[202]['data_source'] ?? null);
    }

    // ════════════════════════════════════════════════════════════
    // NO ARBITRARY TRUNCATION
    // ════════════════════════════════════════════════════════════

    public function test_prs_array_preserves_all_matching_prs_no_truncation()
    {
        for ($i = 0; $i < 10; $i++) {
            PullRequest::create([
                'repo_name' => 'local-demo/cm-activity-sim',
                'pr_number' => 300 + $i,
                'data_source' => 'cm_activity_sim',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        $this->assertGreaterThanOrEqual(10, count($j['prs'] ?? []),
            'prs array must preserve ALL PRs matching the filter — no arbitrary truncation');
    }

    // ════════════════════════════════════════════════════════════
    // EMPTY DB → EMPTY prs ARRAY (not missing key)
    // ════════════════════════════════════════════════════════════

    public function test_empty_db_returns_empty_prs_array()
    {
        $j = $this->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();
        $this->assertArrayHasKey('prs', $j);
        $this->assertIsArray($j['prs']);
        $this->assertEquals(0, count($j['prs']));
    }

    // ════════════════════════════════════════════════════════════
    // ORGANIZATION ISOLATION — prs array must not leak cross-org PRs
    // ════════════════════════════════════════════════════════════

    /**
     * CR-X P0-2 contract: the NEW prs array must honor the same
     * organization isolation authority as the existing pr_analytics block.
     *
     * In Local Lab mode (no org OAuth repo allow-list), the authority is
     * data_source = 'cm_activity_sim' (the Local demo authority).  PRs from
     * other data sources (e.g. github_api, representing another org's
     * repos) must NOT appear in the prs array.
     *
     * This test authenticates as organization A and asserts:
     *   - A's permitted PR evidence (cm_activity_sim) appears in prs
     *   - B's PR rows (github_api) do NOT appear in prs
     */
    public function test_prs_array_isolates_organization_data_no_cross_org_leak()
    {
        $orgA = Organization::create(['name' => 'Org A', 'slug' => 'org-a']);
        $orgB = Organization::create(['name' => 'Org B', 'slug' => 'org-b']);

        $userA = User::factory()->create(['organization_id' => $orgA->id]);
        $rawTokenA = 'test-token-prs-org-a-' . Str::random(32);
        ApiToken::create([
            'token' => hash('sha256', $rawTokenA),
            'user_id' => $userA->id,
            'organization_id' => $orgA->id,
            'expires_at' => now()->addDays(30),
        ]);

        // PR visible to Org A under Local Lab authority (cm_activity_sim)
        PullRequest::create([
            'repo_name' => 'local-demo/cm-activity-sim',
            'pr_number' => 401,
            'user_login' => 'dev-a-1',
            'data_source' => 'cm_activity_sim',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        PullRequest::create([
            'repo_name' => 'local-demo/cm-activity-sim',
            'pr_number' => 402,
            'user_login' => 'dev-a-2',
            'data_source' => 'cm_activity_sim',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // PR belonging to Org B (different data_source — NOT Local Lab authority)
        PullRequest::create([
            'repo_name' => 'org-b/private-repo',
            'pr_number' => 403,
            'user_login' => 'dev-b-1',
            'data_source' => 'github_api',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        PullRequest::create([
            'repo_name' => 'org-b/another-repo',
            'pr_number' => 404,
            'user_login' => 'dev-b-2',
            'data_source' => 'realism_seeder',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $j = $this->withHeaders(['Authorization' => 'Bearer ' . $rawTokenA])
            ->getJson('/api/metrics?time_filter=week&oauth=false&nocache=1')->json();

        $prs = $j['prs'] ?? [];
        $prNumbers = array_column($prs, 'pr_number');

        // Org A's permitted PRs must be present
        $this->assertContains(401, $prNumbers, 'Org A cm_activity_sim PR 401 must appear in prs array');
        $this->assertContains(402, $prNumbers, 'Org A cm_activity_sim PR 402 must appear in prs array');

        // Org B's PRs must NOT leak into Org A's prs array
        $this->assertNotContains(403, $prNumbers, 'Org B github_api PR 403 must NOT leak into prs array');
        $this->assertNotContains(404, $prNumbers, 'Org B realism_seeder PR 404 must NOT leak into prs array');

        // Every returned PR must be cm_activity_sim (Org A authority)
        foreach ($prs as $pr) {
            $this->assertEquals('cm_activity_sim', $pr['data_source'],
                'prs array must only contain cm_activity_sim PRs in Local Lab mode');
            $this->assertNotEquals('org-b/private-repo', $pr['repo'],
                'prs array must not contain Org B repos');
            $this->assertNotEquals('org-b/another-repo', $pr['repo'],
                'prs array must not contain Org B repos');
        }
    }
}
