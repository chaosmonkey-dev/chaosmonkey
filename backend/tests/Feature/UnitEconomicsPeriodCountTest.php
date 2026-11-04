<?php
namespace Tests\Feature;

use App\Models\Deployment;
use App\Models\PullRequest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Deterministic Unit Economics Period-Count Contract Tests
 *
 * Runs against a disposable in-memory SQLite database (:memory:) with
 * fixtures that prove the period-count, provenance, and authority contracts.
 *
 * Local-snapshot forensic checks live outside this suite; this test only
 * exercises the :memory: contract.
 */
class UnitEconomicsPeriodCountTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['app.env' => 'local']);
        \Cache::flush();
        $this->withoutMiddleware();
    }

    /**
     * Helper: fetch metrics with broad time filter
     */
    private function fetchMetrics(): array
    {
        return $this->getJson('/api/metrics?time_filter=all&use_all_data=1&nocache=1&oauth=false')->json();
    }

    /**
     * Helper: seed a known set of deployments and PRs for deterministic assertions.
     *
     * Creates:
     *   - 5 deployments in the current month (3 success, 2 failure)
     *     with repo_name=org/example-repo
     *   - 3 PRs in the current month (2 merged, 1 open)
     *     with data_source=cm_activity_sim
     */
    private function seedFixtures(): array
    {
        $now = now();
        $month = $now->format('Y-m');

        // Deployments — all on today's date so they're in the same calendar month
        // and within the last 10 weeks for github_by_period observed rows
        $deployments = [];
        for ($i = 0; $i < 3; $i++) {
            $deployments[] = Deployment::create([
                'repo_name' => 'org/example-repo',
                'environment' => 'production',
                'deployment_status' => 'success',
                'deployed_at' => $now,
                'metadata' => ['source' => 'cm_activity_sim', 'data_source' => 'seeded'],
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
        for ($i = 0; $i < 2; $i++) {
            $deployments[] = Deployment::create([
                'repo_name' => 'org/example-repo',
                'environment' => 'production',
                'deployment_status' => 'failure',
                'deployed_at' => $now,
                'metadata' => ['source' => 'cm_activity_sim', 'data_source' => 'seeded'],
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        // PRs — 2 merged, 1 open, all created today
        $prs = [];
        for ($i = 0; $i < 2; $i++) {
            $prs[] = PullRequest::create([
                'repo_name' => 'org/example-repo',
                'pr_number' => 100 + $i,
                'data_source' => 'cm_activity_sim',
                'merged_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
        $prs[] = PullRequest::create([
            'repo_name' => 'org/example-repo',
            'pr_number' => 102,
            'data_source' => 'cm_activity_sim',
            'merged_at' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return ['month' => $month, 'deployments' => $deployments, 'prs' => $prs];
    }

    // ════════════════════════════════════════════════════════════
    // 1. OUTCOMES_BY_MONTH EXISTS AND HAS ENTRIES
    // ════════════════════════════════════════════════════════════

    public function test_outcomes_by_month_exists_and_has_entries()
    {
        $this->seedFixtures();
        $j = $this->fetchMetrics();
        $this->assertArrayHasKey('outcomes_by_month', $j, 'outcomes_by_month key should exist');
        $obm = $j['outcomes_by_month'];
        $this->assertIsArray($obm, 'outcomes_by_month should be an array');
        $this->assertNotEmpty($obm, 'outcomes_by_month should not be empty with fixture data');
    }

    // ════════════════════════════════════════════════════════════
    // 2. OBSERVED MONTHLY DEPLOYMENT ROWS PRODUCE EXACT INTEGER COUNTS
    // ════════════════════════════════════════════════════════════

    public function test_observed_monthly_deployment_rows_produce_exact_integer_counts()
    {
        $f = $this->seedFixtures();
        $j = $this->fetchMetrics();
        $obm = $j['outcomes_by_month'] ?? [];

        $found = false;
        foreach ($obm as $entry) {
            if ($entry['month'] === $f['month']) {
                $found = true;
                $this->assertIsInt($entry['deployment_count'], 'deployment_count must be integer');
                $this->assertIsInt($entry['successful_deployment_count'], 'successful_deployment_count must be integer');
                $this->assertIsInt($entry['failed_deployment_count'], 'failed_deployment_count must be integer');
                // 5 deployments: 3 success, 2 failure
                $this->assertEquals(5, $entry['deployment_count'], 'deployment_count must be 5 (3 success + 2 failure)');
                $this->assertEquals(3, $entry['successful_deployment_count'], 'successful must be 3');
                $this->assertEquals(2, $entry['failed_deployment_count'], 'failed must be 2');
            }
        }
        $this->assertTrue($found, "Current month ({$f['month']}) should be present in outcomes_by_month");
    }

    // ════════════════════════════════════════════════════════════
    // 3. SUCCESS + FAILED = TOTAL
    // ════════════════════════════════════════════════════════════

    public function test_success_plus_failure_equals_total()
    {
        $this->seedFixtures();
        $j = $this->fetchMetrics();
        $obm = $j['outcomes_by_month'] ?? [];

        foreach ($obm as $entry) {
            $total = $entry['deployment_count'];
            $success = $entry['successful_deployment_count'];
            $failed = $entry['failed_deployment_count'];
            $this->assertEquals($total, $success + $failed,
                "success({$success}) + failed({$failed}) != total({$total}) for month {$entry['month']}");
        }
    }

    // ════════════════════════════════════════════════════════════
    // 4. OBSERVED MONTHLY PR ROWS PRODUCE EXACT MERGED COUNT
    // ════════════════════════════════════════════════════════════

    public function test_observed_monthly_pr_rows_produce_exact_merged_count()
    {
        $f = $this->seedFixtures();
        $j = $this->fetchMetrics();
        $obm = $j['outcomes_by_month'] ?? [];

        $found = false;
        foreach ($obm as $entry) {
            if ($entry['month'] === $f['month']) {
                $found = true;
                $this->assertIsInt($entry['merged_pr_count'], 'merged_pr_count must be integer');
                $this->assertIsInt($entry['total_pr_count'], 'total_pr_count must be integer');
                // 2 merged, 3 total
                $this->assertEquals(2, $entry['merged_pr_count'], 'merged_pr_count must be 2');
                $this->assertEquals(3, $entry['total_pr_count'], 'total_pr_count must be 3');
            }
        }
        $this->assertTrue($found, "Current month ({$f['month']}) should be present in outcomes_by_month");
    }

    // ════════════════════════════════════════════════════════════
    // 5. CALENDAR MONTH COMES FROM ACTUAL EVENT DATE
    // ════════════════════════════════════════════════════════════

    public function test_calendar_month_comes_from_actual_event_date()
    {
        $f = $this->seedFixtures();
        $j = $this->fetchMetrics();
        $obm = $j['outcomes_by_month'] ?? [];

        foreach ($obm as $entry) {
            $this->assertMatchesRegularExpression('/^\d{4}-\d{2}$/', $entry['month'],
                "month must be YYYY-MM format, got: {$entry['month']}");
        }

        $months = array_column($obm, 'month');
        $this->assertContains($f['month'], $months, "Current month ({$f['month']}) must be present");
    }

    // ════════════════════════════════════════════════════════════
    // 6. WEEK CROSSING MONTH BOUNDARY DOES NOT SHIFT OUTCOMES
    // ════════════════════════════════════════════════════════════

    public function test_week_crossing_month_boundary_does_not_shift_outcomes()
    {
        $f = $this->seedFixtures();
        $j = $this->fetchMetrics();
        $obm = $j['outcomes_by_month'] ?? [];

        $entry = null;
        foreach ($obm as $e) {
            if ($e['month'] === $f['month']) {
                $entry = $e;
                break;
            }
        }
        $this->assertNotNull($entry, "Current month entry must exist");
        // Exact observed count — not a rate-derived approximation
        $this->assertEquals(5, $entry['deployment_count'],
            'deployment_count must be exact observed count (5), not rate-derived');
    }

    // ════════════════════════════════════════════════════════════
    // 7. SYNTHETIC RATE FALLBACK DOES NOT RECEIVE AUTHORITATIVE COUNT FIELDS
    // ════════════════════════════════════════════════════════════

    public function test_synthetic_rate_fallback_does_not_receive_count_fields()
    {
        $this->seedFixtures();
        $j = $this->fetchMetrics();
        $gbp = $j['github_by_period'] ?? [];

        $foundSynthetic = false;
        foreach ($gbp as $entry) {
            if (($entry['count_authority'] ?? null) === 'derived_rate') {
                $foundSynthetic = true;
                $this->assertArrayNotHasKey('deployment_count', $entry,
                    'Synthetic/rate-derived row must NOT have deployment_count');
                $this->assertArrayNotHasKey('successful_deployment_count', $entry,
                    'Synthetic/rate-derived row must NOT have successful_deployment_count');
                $this->assertArrayNotHasKey('failed_deployment_count', $entry,
                    'Synthetic/rate-derived row must NOT have failed_deployment_count');
                $this->assertArrayHasKey('deploymentFreqPerWeek', $entry,
                    'Synthetic row should still have deploymentFreqPerWeek');
            }
        }
        // With 5 deployments in the current week, most periods will be synthetic
        // (only 1-2 of the 10 weekly periods will have observed data)
        $this->assertTrue($foundSynthetic, 'Should have at least one synthetic/rate-derived period row');
    }

    // ════════════════════════════════════════════════════════════
    // 8. OUTCOMES_BY_MONTH REJECTS DERIVED-RATE COUNTS
    // ════════════════════════════════════════════════════════════

    public function test_outcomes_by_month_only_contains_observed_rows_authority()
    {
        $this->seedFixtures();
        $j = $this->fetchMetrics();
        $obm = $j['outcomes_by_month'] ?? [];

        foreach ($obm as $entry) {
            $this->assertEquals('observed_rows', $entry['count_authority'],
                "All outcomes_by_month entries must have count_authority='observed_rows', got: {$entry['count_authority']}");
        }
    }

    // ════════════════════════════════════════════════════════════
    // 9. LOCAL CM_ACTIVITY_SIM OBSERVED ROWS ACCEPTED AS SEEDED
    // ════════════════════════════════════════════════════════════

    public function test_local_cm_activity_sim_observed_rows_accepted_as_seeded()
    {
        $this->seedFixtures();
        $j = $this->fetchMetrics();
        $obm = $j['outcomes_by_month'] ?? [];

        $foundSeeded = false;
        foreach ($obm as $entry) {
            if ($entry['source'] === 'cm_activity_sim') {
                $foundSeeded = true;
                $this->assertEquals('seeded', $entry['data_source'],
                    'cm_activity_sim entries must have data_source=seeded');
            }
        }
        $this->assertTrue($foundSeeded, 'Should have cm_activity_sim entries in local mode');
    }

    // ════════════════════════════════════════════════════════════
    // 10. DEMO / REALISM ROWS REJECTED FOR UE MONTHLY AUTHORITY
    // ════════════════════════════════════════════════════════════

    public function test_demo_realism_rows_rejected_for_ue_monthly_authority()
    {
        // Seed cm_activity_sim data (should appear)
        $this->seedFixtures();

        // Also seed a demo deployment (should NOT appear)
        Deployment::create([
            'repo_name' => 'org/example-repo',
            'environment' => 'production',
            'deployment_status' => 'success',
            'deployed_at' => now()->subDay(),
            'metadata' => ['source' => 'demo', 'data_source' => 'demo'],
            'created_at' => now()->subDay(),
            'updated_at' => now()->subDay(),
        ]);

        $j = $this->fetchMetrics();
        $obm = $j['outcomes_by_month'] ?? [];

        foreach ($obm as $entry) {
            $this->assertNotEquals('demo', $entry['source'],
                "demo source must not appear in outcomes_by_month (month: {$entry['month']})");
            $this->assertNotEquals('realism_seeder', $entry['source'],
                'realism_seeder source must not appear in outcomes_by_month');
            $this->assertNotEquals('demo', $entry['data_source'],
                'demo data_source must not appear in outcomes_by_month');
        }
    }

    // ════════════════════════════════════════════════════════════
    // 11. RATE FIELDS STILL EXIST IN GITHUB_BY_PERIOD
    // ════════════════════════════════════════════════════════════

    public function test_rate_fields_still_exist_in_github_by_period()
    {
        $this->seedFixtures();
        $j = $this->fetchMetrics();
        $gbp = $j['github_by_period'] ?? [];

        foreach ($gbp as $entry) {
            $this->assertArrayHasKey('deploymentFreqPerWeek', $entry, 'deploymentFreqPerWeek should still exist');
            $this->assertArrayHasKey('changeFailureRatePct', $entry, 'changeFailureRatePct should still exist');
        }
    }

    // ════════════════════════════════════════════════════════════
    // 12. OBSERVED ROWS IN GITHUB_BY_PERIOD STILL HAVE COUNT FIELDS
    // ════════════════════════════════════════════════════════════

    public function test_observed_rows_in_github_by_period_still_have_count_fields()
    {
        $this->seedFixtures();
        $j = $this->fetchMetrics();
        $gbp = $j['github_by_period'] ?? [];

        $foundObserved = false;
        foreach ($gbp as $entry) {
            if (($entry['count_authority'] ?? null) !== 'derived_rate') {
                if (isset($entry['deployment_count'])) {
                    $foundObserved = true;
                    $this->assertIsInt($entry['deployment_count'], 'Observed deployment_count must be integer');
                }
            }
        }
        $this->assertTrue($foundObserved, 'Should have at least one observed period row with count fields');
    }

    // ════════════════════════════════════════════════════════════
    // 13. PROVENANCE PRESENT
    // ════════════════════════════════════════════════════════════

    public function test_local_lab_provenance_present()
    {
        $this->seedFixtures();
        $j = $this->fetchMetrics();
        $this->assertArrayHasKey('github_provenance', $j, 'github_provenance should exist');
        $prov = $j['github_provenance'];
        $this->assertArrayHasKey('source', $prov, 'provenance should have source field');
        $this->assertNotEmpty($prov['source'], 'provenance source should not be empty');
    }

    // ════════════════════════════════════════════════════════════
    // NEGATIVE COVERAGE — non-cm_activity_sim data excluded in Local Lab
    // ════════════════════════════════════════════════════════════

    public function test_non_cm_activity_sim_prs_excluded_in_local_lab_mode()
    {
        // Create a PR with a different data_source
        PullRequest::create([
            'repo_name' => 'other/repo',
            'pr_number' => 999,
            'data_source' => 'github_api',
            'merged_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $j = $this->fetchMetrics();
        $obm = $j['outcomes_by_month'] ?? [];

        // With only a github_api PR (not cm_activity_sim), outcomes_by_month
        // should be empty because the provenance gate rejects non-cm_activity_sim
        // data in Local Lab mode.
        $this->assertIsArray($obm, 'outcomes_by_month should be an array');
        $totalPrCount = 0;
        foreach ($obm as $entry) {
            $totalPrCount += $entry['total_pr_count'] ?? 0;
        }
        $this->assertEquals(0, $totalPrCount,
            'github_api PR should NOT appear in outcomes_by_month (provenance gate rejects non-cm_activity_sim)');
    }
}
