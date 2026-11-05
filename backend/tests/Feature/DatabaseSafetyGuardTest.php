<?php

namespace Tests\Feature;

use App\Support\DatabaseSafety;
use Tests\TestCase;

/**
 * CR-X P0-F: Database Safety Guard Acceptance Tests
 *
 * Verifies that the safety guard correctly:
 * - accepts :memory: and approved ephemeral test paths
 * - rejects physical operational paths
 * - rejects the restored July candidate path
 * - rejects the wiped Local path
 * - rejects archive/freeze/recovery paths
 * - rejects path traversal
 * - fails closed on bootstrap with a prohibited path
 * - catches child tests that repoint the DB config
 * - allows RefreshDatabase only against permitted targets
 * - refuses destructive commands against non-approved physical paths
 * - preserves rejected files byte-identical after refusal
 *
 * @group p0f-safety
 */
class DatabaseSafetyGuardTest extends TestCase
{
    /**
     * 1. :memory: is accepted for testing.
     */
    public function test_memory_database_is_accepted(): void
    {
        $this->assertTrue(DatabaseSafety::isApprovedEphemeralTestTarget(':memory:'));
    }

    /**
     * 2. Approved ephemeral test path is accepted.
     */
    public function test_approved_ephemeral_test_path_is_accepted(): void
    {
        // The guard requires the parent dir to resolve — ensure it exists on
        // fresh checkouts where no test has created it yet.
        $root = base_path(DatabaseSafety::TEST_TEMP_ROOT);
        if (!is_dir($root)) {
            mkdir($root, 0777, true);
        }
        $path = $root . '/test_safety.sqlite';
        $this->assertTrue(DatabaseSafety::isApprovedEphemeralTestTarget($path));
    }

    /**
     * 3. Arbitrary physical SQLite path is rejected.
     */
    public function test_arbitrary_physical_path_is_rejected(): void
    {
        $this->assertFalse(DatabaseSafety::isApprovedEphemeralTestTarget('/tmp/arbitrary-test.sqlite'));
        $this->assertFalse(DatabaseSafety::isApprovedEphemeralTestTarget('/var/db/operational.sqlite'));
    }

    /**
     * 4. Restored July candidate path is rejected.
     */
    public function test_restored_july_candidate_path_is_rejected(): void
    {
        $path = database_path('cr1-local-restored-july-20260902.sqlite');
        $this->assertFalse(DatabaseSafety::isApprovedEphemeralTestTarget($path));
        $this->assertTrue(DatabaseSafety::isKnownOperationalPath($path));
    }

    /**
     * 5. Wiped Local path is rejected.
     */
    public function test_wiped_local_path_is_rejected(): void
    {
        $path = database_path('cr1-local-working.sqlite');
        $this->assertFalse(DatabaseSafety::isApprovedEphemeralTestTarget($path));
        $this->assertTrue(DatabaseSafety::isKnownOperationalPath($path));
    }

    /**
     * 6. Archive/freeze/recovery paths are rejected.
     */
    public function test_archive_freeze_recovery_paths_are_rejected(): void
    {
        $paths = [
            database_path('database.sqlite'),
            database_path('cr5-v1-freeze-2026-08-21-1855.sqlite'),
            database_path('cr1-local-working.sqlite.test'),
            database_path('cr1-local-working.sqlite.quarantine.20260802_214500'),
            database_path('database.sqlite.quarantine.20260802_214500'),
        ];

        foreach ($paths as $path) {
            $this->assertFalse(
                DatabaseSafety::isApprovedEphemeralTestTarget($path),
                "Archive path should be rejected: {$path}"
            );
            $this->assertTrue(
                DatabaseSafety::isKnownOperationalPath($path),
                "Archive path should be in deny-list: {$path}"
            );
        }
    }

    /**
     * 7. Path traversal is rejected.
     */
    public function test_path_traversal_is_rejected(): void
    {
        $maliciousPath = base_path(DatabaseSafety::TEST_TEMP_ROOT) . '/../../database/cr1-local-working.sqlite';
        $this->assertFalse(DatabaseSafety::isApprovedEphemeralTestTarget($maliciousPath));
    }

    /**
     * 8. Bootstrap fails closed on prohibited path.
     */
    public function test_bootstrap_fails_closed_on_prohibited_path(): void
    {
        // Simulate a prohibited DB path
        $originalDb = config('database.connections.sqlite.database');
        config(['database.connections.sqlite.database' => database_path('cr1-local-working.sqlite')]);

        try {
            DatabaseSafety::assertTestDatabaseSafe();
            $this->fail('Expected RuntimeException was not thrown for prohibited path');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('DATABASE SAFETY ABORT', $e->getMessage());
            $this->assertStringContainsString('cr1-local-working.sqlite', $e->getMessage());
        } finally {
            config(['database.connections.sqlite.database' => $originalDb]);
        }
    }

    /**
     * 9. Post-setUp/precondition catches a child test changing DB config.
     *
     * This test simulates a child test repointing the DB config to a
     * physical path. The assertPreConditions guard in TestCase should
     * catch this.
     */
    public function test_post_setup_guard_catches_repointed_config(): void
    {
        // The assertPreConditions() in TestCase already ran before this
        // test body and verified :memory:. Now simulate a repoint.
        $originalDb = config('database.connections.sqlite.database');
        config(['database.connections.sqlite.database' => database_path('cr1-local-working.sqlite')]);

        try {
            DatabaseSafety::assertTestDatabaseSafe();
            $this->fail('Expected RuntimeException was not thrown for repointed config');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('DATABASE SAFETY ABORT', $e->getMessage());
        } finally {
            config(['database.connections.sqlite.database' => $originalDb]);
        }

        // Restore so assertPostConditions doesn't fire.
    }

    /**
     * 10. RefreshDatabase runs only against permitted ephemeral target.
     *
     * This test verifies that the current test DB is :memory: (which is
     * the approved target for RefreshDatabase).
     */
    public function test_refreshdatabase_uses_permitted_target(): void
    {
        $target = DatabaseSafety::resolveSqliteTarget();
        $this->assertEquals(':memory:', $target);
        $this->assertTrue(DatabaseSafety::isApprovedEphemeralTestTarget($target));
    }

    /**
     * 11. Destructive command guard allows migrate:fresh for :memory:.
     */
    public function test_destructive_command_allowed_for_memory(): void
    {
        $this->assertTrue(DatabaseSafety::isDestructiveCommandPermitted('migrate:fresh'));
        $this->assertTrue(DatabaseSafety::isDestructiveCommandPermitted('migrate:refresh'));
        $this->assertTrue(DatabaseSafety::isDestructiveCommandPermitted('migrate:reset'));
        $this->assertTrue(DatabaseSafety::isDestructiveCommandPermitted('db:wipe'));
    }

    /**
     * 12. Destructive command guard refuses non-approved physical path.
     */
    public function test_destructive_command_refuses_physical_path(): void
    {
        $originalDb = config('database.connections.sqlite.database');
        config(['database.connections.sqlite.database' => database_path('cr1-local-working.sqlite')]);

        try {
            $this->assertFalse(DatabaseSafety::isDestructiveCommandPermitted('migrate:fresh'));
            $this->assertFalse(DatabaseSafety::isDestructiveCommandPermitted('migrate:refresh'));
            $this->assertFalse(DatabaseSafety::isDestructiveCommandPermitted('migrate:reset'));
            $this->assertFalse(DatabaseSafety::isDestructiveCommandPermitted('db:wipe'));
        } finally {
            config(['database.connections.sqlite.database' => $originalDb]);
        }
    }

    /**
     * 13. Rejected disposable file remains byte-identical after refusal.
     *
     * Creates a harmless temp file, attempts to point the guard at it,
     * verifies the guard rejects it, and confirms the file is unchanged.
     */
    public function test_rejected_file_remains_byte_identical(): void
    {
        $tempFile = tempnam(sys_get_temp_dir(), 'p0f_safety_test_');
        $content = "SAFETY TEST MARKER - this file must not be modified\n";
        file_put_contents($tempFile, $content);
        $hashBefore = hash_file('sha256', $tempFile);

        $originalDb = config('database.connections.sqlite.database');
        config(['database.connections.sqlite.database' => $tempFile]);

        try {
            // The guard should reject this path (it's not :memory: or approved test root)
            $this->assertFalse(DatabaseSafety::isApprovedEphemeralTestTarget($tempFile));
            $this->assertFalse(DatabaseSafety::isDestructiveCommandPermitted('migrate:fresh'));
        } finally {
            config(['database.connections.sqlite.database' => $originalDb]);
        }

        // Verify the file is byte-identical
        $hashAfter = hash_file('sha256', $tempFile);
        $this->assertEquals($hashBefore, $hashAfter, 'Rejected file must remain byte-identical');
        $this->assertEquals($content, file_get_contents($tempFile), 'File content must be unchanged');

        // Cleanup
        unlink($tempFile);
    }

    // ════════════════════════════════════════════════════════════════
    // P0-F R2 GAP 1 — Non-SQLite fail-closed
    // ════════════════════════════════════════════════════════════════

    /**
     * 15. Non-SQLite driver is never an approved ephemeral test target.
     */
    public function test_non_sqlite_driver_is_never_approved(): void
    {
        $this->assertFalse(DatabaseSafety::isApprovedEphemeralTestTarget('some_db', 'mysql'));
        $this->assertFalse(DatabaseSafety::isApprovedEphemeralTestTarget('some_db', 'pgsql'));
        $this->assertFalse(DatabaseSafety::isApprovedEphemeralTestTarget('some_db', 'sqlsrv'));
    }

    /**
     * 16. Bootstrap fails closed for a non-SQLite connection.
     */
    public function test_bootstrap_fails_closed_for_non_sqlite(): void
    {
        $originalDriver = config('database.connections.sqlite.driver');
        $originalDefault = config('database.default');

        // Simulate a MySQL default connection.
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.driver' => 'mysql']);
        config(['database.connections.mysql.database' => 'staging_customer_db']);

        try {
            DatabaseSafety::assertTestDatabaseSafe();
            $this->fail('Expected RuntimeException for non-SQLite connection in testing');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('DATABASE SAFETY ABORT', $e->getMessage());
            $this->assertStringContainsString('mysql', $e->getMessage());
            $this->assertStringContainsString('staging_customer_db', $e->getMessage());
        } finally {
            config(['database.connections.sqlite.driver' => $originalDriver]);
            config(['database.default' => $originalDefault]);
        }
    }

    /**
     * 17. Destructive command fails closed for non-SQLite.
     */
    public function test_destructive_command_fails_closed_for_non_sqlite(): void
    {
        $originalDefault = config('database.default');

        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.driver' => 'mysql']);
        config(['database.connections.mysql.database' => 'staging_db']);

        try {
            $this->assertFalse(DatabaseSafety::isDestructiveCommandPermitted('migrate:fresh'));
            $this->assertFalse(DatabaseSafety::isDestructiveCommandPermitted('db:wipe'));
        } finally {
            config(['database.default' => $originalDefault]);
        }
    }

    // ════════════════════════════════════════════════════════════════
    // P0-F R2 GAP 2 — Real Artisan guard integration test
    // ════════════════════════════════════════════════════════════════

    /**
     * 18. Real Artisan migrate:fresh is blocked against a disposable
     *     physical SQLite file OUTSIDE the approved ephemeral directory,
     *     and the file remains byte-identical.
     *
     *     Uses subprocess because $this->artisan() / Artisan::call() does
     *     NOT dispatch the CommandStarting event (only the Kernel's
     *     runCommand() path dispatches it). Subprocess via the CLI is the
     *     correct Laravel test equivalent for event-driven guards.
     */
    public function test_real_artisan_migrate_fresh_blocked_against_disposable_file(): void
    {
        // 1. Create a disposable SQLite file with a marker table/row.
        $tempFile = tempnam(sys_get_temp_dir(), 'p0f_r2_artisan_');
        $pdo = new \PDO('sqlite:' . $tempFile);
        $pdo->exec("CREATE TABLE marker (id INTEGER PRIMARY KEY, payload TEXT)");
        $pdo->exec("INSERT INTO marker (payload) VALUES ('DO_NOT_DESTROY')");
        $pdo = null;

        // 2. Record SHA-256.
        $hashBefore = hash_file('sha256', $tempFile);

        // 3. Run php artisan migrate:fresh --force via subprocess with
        //    DB_DATABASE pointing at the disposable file.
        $phpBin = PHP_BINARY;
        $artisanPath = base_path('artisan');
        $cmd = sprintf(
            '%s %s migrate:fresh --force 2>&1',
            escapeshellarg($phpBin),
            escapeshellarg($artisanPath)
        );

        $output = [];
        $exitCode = 0;
        $env = array_merge(getenv(), [
            'DB_DATABASE' => $tempFile,
            'APP_ENV' => 'local', // not testing — simulate operational context
        ]);

        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $proc = proc_open($cmd, $descriptors, $pipes, base_path(), $env);
        if (is_resource($proc)) {
            fclose($pipes[0]);
            $output[] = stream_get_contents($pipes[1]);
            $output[] = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $exitCode = proc_close($proc);
        }

        $outputStr = implode("\n", $output);

        // 4. Assert the guard aborted.
        $this->assertNotEquals(0, $exitCode, 'migrate:fresh must not succeed against disposable file');
        $this->assertStringContainsString('DATABASE SAFETY ABORT', $outputStr, 'Safety abort must appear in output');
        $this->assertStringContainsString('migrate:fresh', $outputStr, 'Blocked command name must appear in output');

        // 5. Verify disposable file SHA-256 and data are identical.
        $hashAfter = hash_file('sha256', $tempFile);
        $this->assertEquals($hashBefore, $hashAfter, 'Disposable file must be byte-identical after blocked command');

        $pdo = new \PDO('sqlite:' . $tempFile);
        $row = $pdo->query("SELECT payload FROM marker WHERE id = 1")->fetch(\PDO::FETCH_ASSOC);
        $this->assertEquals('DO_NOT_DESTROY', $row['payload'], 'Marker row must be intact');
        $pdo = null;

        // 6. Delete only the disposable test file.
        unlink($tempFile);
    }

    /**
     * 19. Real Artisan guard fails closed for a fake non-SQLite connection
     *     before Laravel attempts a network connection.
     *
     *     Uses subprocess for the same reason as test 18.
     */
    public function test_real_artisan_guard_fails_closed_for_non_sqlite(): void
    {
        $phpBin = PHP_BINARY;
        $artisanPath = base_path('artisan');
        $cmd = sprintf(
            '%s %s db:wipe --force 2>&1',
            escapeshellarg($phpBin),
            escapeshellarg($artisanPath)
        );

        $env = array_merge(getenv(), [
            'DB_CONNECTION' => 'mysql',
            'DB_HOST' => '127.0.0.1',
            'DB_PORT' => '1', // unreachable
            'DB_DATABASE' => 'fake_test_db',
            'DB_USERNAME' => 'root',
            'DB_PASSWORD' => '',
            'APP_ENV' => 'local',
        ]);

        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $output = [];
        $exitCode = 0;
        $proc = proc_open($cmd, $descriptors, $pipes, base_path(), $env);
        if (is_resource($proc)) {
            fclose($pipes[0]);
            $output[] = stream_get_contents($pipes[1]);
            $output[] = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $exitCode = proc_close($proc);
        }

        $outputStr = implode("\n", $output);

        // Guard must abort before any MySQL connection attempt.
        $this->assertNotEquals(0, $exitCode, 'db:wipe must not succeed for non-SQLite');
        $this->assertStringContainsString('DATABASE SAFETY ABORT', $outputStr, 'Safety abort must appear in output');
        $this->assertStringContainsString('mysql', $outputStr, 'Driver name must appear in output');

        // Must NOT contain a connection error (which would mean the guard
        // didn't fire before the connection attempt).
        $this->assertStringNotContainsString('SQLSTATE', $outputStr, 'Guard must abort before connection attempt');
        $this->assertStringNotContainsString('Connection refused', $outputStr, 'Guard must abort before connection attempt');
    }

    // ════════════════════════════════════════════════════════════════
    // P0-F R2 GAP 3 — PHPUnit lifecycle guard proof via fixture
    // ════════════════════════════════════════════════════════════════

    /**
     * 20. PHPUnit lifecycle assertPreConditions catches an unsafe child
     *     setUp() automatically — proof via subprocess.
     *
     *     We run a dedicated fixture test via subprocess that deliberately
     *     repoints the DB config in setUp() to a prohibited path. The
     *     assertPreConditions() guard must abort before the test body.
     */
    public function test_phpunit_lifecycle_catches_unsafe_child_setup(): void
    {
        $fixturePath = base_path('tests/Feature/Fixtures/UnsafeChildSetupFixture.php');
        $this->assertFileExists($fixturePath, 'Fixture file must exist');

        // Run the fixture in a subprocess via phpunit.
        // PHPUnit accepts a file path as an argument to run just that file.
        $phpBin = PHP_BINARY;
        $phpunitBin = base_path('vendor/bin/phpunit');
        $cmd = sprintf(
            '%s %s --filter test_unsafe_child_marker_must_not_execute %s 2>&1',
            escapeshellarg($phpBin),
            escapeshellarg($phpunitBin),
            escapeshellarg($fixturePath)
        );

        $output = [];
        $exitCode = 0;
        exec($cmd, $output, $exitCode);

        $outputStr = implode("\n", $output);

        // The fixture test must NOT pass (the marker must not execute).
        // It should fail with the safety abort.
        $this->assertNotEquals(0, $exitCode, 'Unsafe fixture must not pass (exit code must be non-zero)');

        // The output should contain the safety abort message.
        $this->assertStringContainsString('DATABASE SAFETY ABORT', $outputStr, 'Safety abort must appear in output');

        // The marker that would only appear if the test body ran must NOT appear.
        $this->assertStringNotContainsString('UNSAFE_CHILD_BODY_EXECUTED', $outputStr, 'Test body must not execute');
    }

    // ════════════════════════════════════════════════════════════════
    // P0-F R2 GAP 4 — Hardened path canonicalization
    // ════════════════════════════════════════════════════════════════

    /**
     * 21. Valid file under approved root is accepted.
     */
    public function test_valid_file_under_approved_root_accepted(): void
    {
        $approvedDir = base_path(DatabaseSafety::TEST_TEMP_ROOT);
        if (!is_dir($approvedDir)) {
            mkdir($approvedDir, 0755, true);
        }
        $validPath = $approvedDir . '/valid_test.sqlite';
        // Create the file so realpath works.
        touch($validPath);

        try {
            $this->assertTrue(
                DatabaseSafety::isApprovedEphemeralTestTarget($validPath),
                'Valid file under approved root should be accepted'
            );
        } finally {
            @unlink($validPath);
        }
    }

    /**
     * 22. Traversal escape is rejected.
     */
    public function test_traversal_escape_rejected(): void
    {
        $approvedDir = base_path(DatabaseSafety::TEST_TEMP_ROOT);
        $maliciousPath = $approvedDir . '/../../database/cr1-local-working.sqlite';
        $this->assertFalse(
            DatabaseSafety::isApprovedEphemeralTestTarget($maliciousPath),
            'Path traversal escape must be rejected'
        );
    }

    /**
     * 23. Symlink-parent escape is rejected.
     */
    public function test_symlink_parent_escape_rejected(): void
    {
        $approvedDir = base_path(DatabaseSafety::TEST_TEMP_ROOT);
        if (!is_dir($approvedDir)) {
            mkdir($approvedDir, 0755, true);
        }

        // Create a symlink inside the approved root that points outside.
        $symlinkPath = $approvedDir . '/escape_symlink';
        $outsideDir = sys_get_temp_dir() . '/p0f_r2_outside';
        if (!is_dir($outsideDir)) {
            mkdir($outsideDir, 0755, true);
        }

        // Create a target file outside the approved root.
        $outsideFile = $outsideDir . '/escaped.sqlite';
        touch($outsideFile);

        // Create symlink: approvedDir/escape_symlink -> outsideDir
        if (file_exists($symlinkPath) || is_link($symlinkPath)) {
            @unlink($symlinkPath);
        }
        @symlink($outsideDir, $symlinkPath);

        // Target via the symlink: approvedDir/escape_symlink/escaped.sqlite
        $targetViaSymlink = $symlinkPath . '/escaped.sqlite';

        try {
            $result = DatabaseSafety::isApprovedEphemeralTestTarget($targetViaSymlink);
            $this->assertFalse($result, 'Symlink-parent escape must be rejected');
        } finally {
            @unlink($symlinkPath);
            @unlink($outsideFile);
            @rmdir($outsideDir);
        }
    }

    /**
     * 24. Non-existent parent is rejected (cannot safely resolve).
     */
    public function test_non_existent_parent_rejected(): void
    {
        $approvedDir = base_path(DatabaseSafety::TEST_TEMP_ROOT);
        $nonExistentParent = $approvedDir . '/nonexistent_subdir/file.sqlite';
        $this->assertFalse(
            DatabaseSafety::isApprovedEphemeralTestTarget($nonExistentParent),
            'Non-existent parent directory must be rejected'
        );
    }
}
