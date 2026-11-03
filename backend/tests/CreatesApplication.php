<?php

namespace Tests;

use App\Support\DatabaseSafety;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Application;

trait CreatesApplication
{
    public function createApplication(): Application
    {
        $app = require __DIR__ . '/../bootstrap/app.php';

        $app->make(Kernel::class)->bootstrap();

        // CR-X P0-F: Fail closed before RefreshDatabase or any test trait
        // can invoke destructive setup against a physical operational DB.
        if ($app->environment('testing')) {
            DatabaseSafety::assertTestDatabaseSafe();
        }

        return $app;
    }
}
