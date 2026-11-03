<?php

namespace Tests\Feature\Fixtures;

use App\Support\DatabaseSafety;
use Tests\TestCase;

/**
 * P0-F R2 GAP 3 — Fixture: Unsafe child setUp.
 *
 * This fixture deliberately repoints Laravel's application DB config to a
 * prohibited disposable physical SQLite path in setUp(). The
 * assertPreConditions() guard in TestCase must abort BEFORE the test body
 * executes.
 *
 * This file is NOT in the default test discovery path (it lives in a
 * Fixtures/ subdirectory and is invoked explicitly by
 * DatabaseSafetyGuardTest::test_phpunit_lifecycle_catches_unsafe_child_setup).
 *
 * @group p0f-safety-fixture
 */
class UnsafeChildSetupFixture extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Create a disposable SQLite file to use as the prohibited target.
        $tempFile = tempnam(sys_get_temp_dir(), 'p0f_r2_fixture_');
        // Make it a valid SQLite file.
        $pdo = new \PDO('sqlite:' . $tempFile);
        $pdo->exec("CREATE TABLE marker (payload TEXT)");
        $pdo->exec("INSERT INTO marker VALUES ('FIXTURE_MARKER')");
        $pdo = null;

        // Repoint the application DB to a prohibited physical path.
        // This is the exact bypass pattern that destroyed the Local DB.
        config(['database.connections.sqlite.database' => $tempFile]);

        // Store the path so tearDown can clean it up.
        $this->fixtureTempFile = $tempFile;
    }

    protected function tearDown(): void
    {
        if ($this->fixtureTempFile && file_exists($this->fixtureTempFile)) {
            @unlink($this->fixtureTempFile);
        }
        parent::tearDown();
    }

    private ?string $fixtureTempFile = null;

    /**
     * This test body must NEVER execute. If it does, the safety guard
     * failed to catch the unsafe setUp().
     */
    public function test_unsafe_child_marker_must_not_execute(): void
    {
        // If this line runs, the guard failed.
        // We emit a recognizable marker that the parent test searches for.
        fwrite(STDERR, "UNSAFE_CHILD_BODY_EXECUTED\n");
        $this->assertTrue(true, 'This should never be reached');
    }
}
