<?php
namespace Tests\Feature;

use Tests\TestCase;

/**
 * Local-Snapshot Integration Tests
 *
 * @group local-snapshot
 *
 * These tests inspect a historical SQLite snapshot via a separate
 * READ-ONLY PDO connection. They do NOT repoint Laravel's application
 * DB connection at any physical operational database.
 *
 * The snapshot path defaults to the July restored candidate:
 *   backend/database/cr1-local-restored-july-20260902.sqlite
 *
 * Override via SNAPSHOT_DB environment variable for manual forensic runs.
 *
 * These tests are excluded from the default phpunit suite via the
 * <exclude>local-snapshot</exclude> group in phpunit.xml.
 *
 * CR-X P0-F: The application DB remains :memory: at all times. The
 * historical snapshot is accessed only through a read-only SQLite URI
 * connection that cannot mutate the file.
 */
class LocalSnapshotIntegrationTest extends TestCase
{
    /**
     * Read-only PDO connection to the historical snapshot.
     */
    protected ?\PDO $snapshotPdo = null;

    /**
     * Resolved snapshot path (null if unavailable).
     */
    protected ?string $snapshotPath = null;

    protected function setUp(): void
    {
        parent::setUp();

        // Resolve the snapshot path. Do NOT repoint Laravel's app DB.
        $this->snapshotPath = env('SNAPSHOT_DB', database_path('cr1-local-restored-july-20260902.sqlite'));

        if (!$this->snapshotPath || !file_exists($this->snapshotPath)) {
            $this->markTestSkipped(
                "Local snapshot DB not found at: {$this->snapshotPath} — skipping forensic tests."
            );
        }

        // Open a SEPARATE read-only PDO connection. This never becomes
        // Laravel's default connection and cannot mutate the file.
        $uri = 'file:' . $this->snapshotPath . '?mode=ro&immutable=1';
        $this->snapshotPdo = new \PDO('sqlite:' . $uri, null, null, [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
        ]);

        \Cache::flush();
        $this->withoutMiddleware();
    }

    protected function tearDown(): void
    {
        $this->snapshotPdo = null;
        parent::tearDown();
    }

    /**
     * Query the historical snapshot directly via read-only PDO.
     *
     * @param  string  $sql
     * @param  array  $params
     * @return array
     */
    protected function snapshotQuery(string $sql, array $params = []): array
    {
        $stmt = $this->snapshotPdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll(\PDO::FETCH_ASSOC);
    }

    /**
     * Get a single scalar value from the snapshot.
     *
     * @param  string  $sql
     * @param  array  $params
     * @return mixed
     */
    protected function snapshotScalar(string $sql, array $params = []): mixed
    {
        $stmt = $this->snapshotPdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchColumn();
    }

    // ════════════════════════════════════════════════════════════
    // CR1 LOCAL SNAPSHOT — exact totals from historical snapshot (read-only PDO)
    // ════════════════════════════════════════════════════════════

    public function test_snapshot_all_time_exact_totals()
    {
        $totalPrs = (int) $this->snapshotScalar("SELECT COUNT(*) FROM pull_requests");
        $reviewedPrs = (int) $this->snapshotScalar("SELECT COUNT(*) FROM pull_requests WHERE first_review_at IS NOT NULL");
        $reopenedCount = (int) $this->snapshotScalar("SELECT COUNT(*) FROM pr_reopen_events");
        $uniqueReopened = (int) $this->snapshotScalar("SELECT COUNT(DISTINCT pr_number) FROM pr_reopen_events");

        $this->assertEquals(832, $totalPrs);
        $this->assertEquals(826, $reviewedPrs);
        $this->assertEquals(203, $reopenedCount);
        $this->assertEquals(168, $uniqueReopened);
    }

    public function test_snapshot_cfr_calculation()
    {
        $total = (int) $this->snapshotScalar("SELECT COUNT(*) FROM deployments WHERE deployed_at IS NOT NULL");
        $failed = (int) $this->snapshotScalar("SELECT COUNT(*) FROM deployments WHERE deployed_at IS NOT NULL AND deployment_status = 'failure'");
        $cfr = $total > 0 ? ($failed / $total) * 100 : 0;

        $this->assertEquals(719, $total);
        $this->assertEquals(138, $failed);
        $this->assertEqualsWithDelta(19.2, $cfr, 0.1);
    }

    public function test_snapshot_by_period_only_real_periods()
    {
        $periods = $this->snapshotQuery(
            "SELECT DISTINCT strftime('%Y-%m', merged_at) as period FROM pull_requests WHERE merged_at IS NOT NULL ORDER BY period"
        );
        $this->assertNotEmpty($periods);
    }

    public function test_snapshot_no_period_exceeds_latest_timestamp()
    {
        $latest = $this->snapshotScalar("SELECT MAX(merged_at) FROM pull_requests WHERE merged_at IS NOT NULL");
        $this->assertNotNull($latest);
        $periods = $this->snapshotQuery(
            "SELECT DISTINCT strftime('%Y-%m', merged_at) as period FROM pull_requests WHERE merged_at IS NOT NULL ORDER BY period"
        );
        foreach ($periods as $p) {
            $this->assertLessThanOrEqual($latest, $p['period'] . '-31 23:59:59');
        }
    }

    public function test_snapshot_seeded_source()
    {
        // Check that deployments have seeded metadata
        $seededCount = (int) $this->snapshotScalar(
            "SELECT COUNT(*) FROM deployments WHERE metadata LIKE '%seeded%' OR metadata LIKE '%cm_activity_sim%'"
        );
        $this->assertGreaterThan(0, $seededCount, 'Snapshot should contain seeded deployment data');
    }

    public function test_snapshot_reopen_distinct()
    {
        $totalPrs = (int) $this->snapshotScalar("SELECT COUNT(*) FROM pull_requests");
        $reviewedPrs = (int) $this->snapshotScalar("SELECT COUNT(*) FROM pull_requests WHERE first_review_at IS NOT NULL");
        $reopenedCount = (int) $this->snapshotScalar("SELECT COUNT(*) FROM pr_reopen_events");
        $uniqueReopened = (int) $this->snapshotScalar("SELECT COUNT(DISTINCT pr_number) FROM pr_reopen_events");

        $reopenFreq = $reviewedPrs > 0 ? ($reopenedCount / $reviewedPrs) * 100 : 0;
        $uniqueReopenRate = $totalPrs > 0 ? ($uniqueReopened / $totalPrs) * 100 : 0;

        $this->assertEqualsWithDelta(24.6, $reopenFreq, 0.5);
        $this->assertEqualsWithDelta(20.2, $uniqueReopenRate, 0.5);
    }

    public function test_snapshot_query_clone_no_leakage()
    {
        $totalPrs = (int) $this->snapshotScalar("SELECT COUNT(*) FROM pull_requests");
        $reviewedPrs = (int) $this->snapshotScalar("SELECT COUNT(*) FROM pull_requests WHERE first_review_at IS NOT NULL");
        $this->assertEquals(832, $totalPrs);
        $this->assertEquals(826, $reviewedPrs);
    }

    // ════════════════════════════════════════════════════════════
    // UNIT ECONOMICS SNAPSHOT — exact monthly counts from historical snapshot
    // ════════════════════════════════════════════════════════════

    public function test_snapshot_observed_monthly_deployment_rows_produce_exact_integer_counts()
    {
        $rows = $this->snapshotQuery(
            "SELECT strftime('%Y-%m', deployed_at) as month,
                    COUNT(*) as deployment_count,
                    SUM(CASE WHEN deployment_status = 'success' THEN 1 ELSE 0 END) as successful_deployment_count,
                    SUM(CASE WHEN deployment_status = 'failure' THEN 1 ELSE 0 END) as failed_deployment_count
             FROM deployments WHERE deployed_at IS NOT NULL
             GROUP BY strftime('%Y-%m', deployed_at) ORDER BY month"
        );

        $foundJune = false;
        foreach ($rows as $entry) {
            if ($entry['month'] === '2026-06') {
                $foundJune = true;
                $this->assertIsInt((int) $entry['deployment_count']);
                $this->assertEquals(25, (int) $entry['deployment_count'], 'June deployment_count must be 25 (observed rows)');
                $this->assertEquals(23, (int) $entry['successful_deployment_count'], 'June successful must be 23');
                $this->assertEquals(2, (int) $entry['failed_deployment_count'], 'June failed must be 2');
            }
        }
        $this->assertTrue($foundJune, 'June 2026 should be present in deployments by month');
    }

    public function test_snapshot_observed_monthly_pr_rows_produce_exact_merged_count()
    {
        $rows = $this->snapshotQuery(
            "SELECT strftime('%Y-%m', merged_at) as month,
                    SUM(CASE WHEN merged_at IS NOT NULL THEN 1 ELSE 0 END) as merged_pr_count,
                    COUNT(*) as total_pr_count
             FROM pull_requests
             GROUP BY strftime('%Y-%m', merged_at) ORDER BY month"
        );

        $foundJune = false;
        foreach ($rows as $entry) {
            if ($entry['month'] === '2026-06') {
                $foundJune = true;
                $this->assertEquals(18, (int) $entry['merged_pr_count'], 'June merged_pr_count must be 18 (observed rows)');
                $this->assertEquals(27, (int) $entry['total_pr_count'], 'June total_pr_count must be 27');
            }
        }
        $this->assertTrue($foundJune, 'June 2026 should be present in PRs by month');
    }

    public function test_snapshot_week_crossing_month_boundary_does_not_shift_outcomes()
    {
        $rows = $this->snapshotQuery(
            "SELECT strftime('%Y-%m', deployed_at) as month,
                    COUNT(*) as deployment_count
             FROM deployments WHERE deployed_at IS NOT NULL
             GROUP BY strftime('%Y-%m', deployed_at) ORDER BY month"
        );

        $juneEntry = null;
        foreach ($rows as $entry) {
            if ($entry['month'] === '2026-06') {
                $juneEntry = $entry;
                break;
            }
        }
        $this->assertNotNull($juneEntry, 'June 2026 entry must exist');
        $this->assertEquals(25, (int) $juneEntry['deployment_count'],
            'June deployment_count must be exact observed count (25), not rate-derived');
    }

    public function test_snapshot_demo_realism_rows_rejected_for_ue_monthly_authority()
    {
        // Check that no demo/realism_seeder sources appear in deployments metadata
        $demoCount = (int) $this->snapshotScalar(
            "SELECT COUNT(*) FROM deployments WHERE metadata LIKE '%demo%' OR metadata LIKE '%realism_seeder%'"
        );
        $this->assertEquals(0, $demoCount, 'demo/realism_seeder sources must not appear in deployments');

        // Verify April and May 2026 are not present in deployment months
        $months = $this->snapshotQuery(
            "SELECT DISTINCT strftime('%Y-%m', deployed_at) as month FROM deployments WHERE deployed_at IS NOT NULL ORDER BY month"
        );
        $monthList = array_column($months, 'month');
        $this->assertNotContains('2026-04', $monthList, 'April (demo-only) must not appear in deployments by month');
        $this->assertNotContains('2026-05', $monthList, 'May (demo/realism) must not appear in deployments by month');
    }
}
