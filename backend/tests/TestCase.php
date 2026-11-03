<?php

namespace Tests;

use App\Support\DatabaseSafety;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    use CreatesApplication;

    /**
     * CR-X P0-F: Post-setUp / pre-test-body invariant check.
     *
     * PHPUnit calls assertPreConditions() AFTER setUp() completes but
     * BEFORE the test method body executes. This catches any child test
     * that repointed Laravel's application DB connection to a prohibited
     * physical path during setUp().
     *
     * @return void
     * @throws \RuntimeException when the resolved DB is not safe
     */
    protected function assertPreConditions(): void
    {
        if (app()->environment('testing')) {
            DatabaseSafety::assertTestDatabaseSafe();
        }

        parent::assertPreConditions();
    }

    /**
     * CR-X P0-F: Post-test-body invariant check.
     *
     * PHPUnit calls assertPostConditions() AFTER the test method body
     * completes but BEFORE tearDown(). This catches any test that mutated
     * the DB connection during execution.
     *
     * @return void
     * @throws \RuntimeException when the resolved DB is not safe
     */
    protected function assertPostConditions(): void
    {
        if (app()->environment('testing')) {
            DatabaseSafety::assertTestDatabaseSafe();
        }

        parent::assertPostConditions();
    }
}
