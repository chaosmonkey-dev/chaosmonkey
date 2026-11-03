<?php

namespace App\Providers;

use App\Support\DatabaseSafety;
use Illuminate\Console\Events\CommandStarting;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // CR-X P0-F R2: Defense-in-depth guard against destructive Artisan
        // commands targeting any non-ephemeral database.
        //
        // Listens to the CommandStarting event and aborts if a destructive
        // command (migrate:fresh, migrate:refresh, migrate:reset, db:wipe)
        // would execute against a non-ephemeral database — including
        // non-SQLite drivers (MySQL, PostgreSQL, SQL Server), operational
        // SQLite paths, and arbitrary DB URLs.
        //
        // There is NO environment-variable escape hatch. Only SQLite
        // :memory: and the approved ephemeral test-temp directory are
        // permitted targets for destructive commands.
        Event::listen(CommandStarting::class, function (CommandStarting $event) {
            $command = $event->command;

            if (!in_array($command, DatabaseSafety::DESTRUCTIVE_COMMANDS)) {
                return;
            }

            $desc = DatabaseSafety::resolve();

            if ($desc->isApprovedEphemeral()) {
                return; // Approved ephemeral target — permitted.
            }

            // Destructive command against a non-ephemeral DB — abort.
            $targetDisplay = $desc->target ?? '(null/unresolved)';
            $output = $event->output;
            $output->writeln('');
            $output->writeln('<error>DATABASE SAFETY ABORT</error>');
            $output->writeln('<error>Command "' . $command . '" was blocked.</error>');
            $output->writeln('<error>Resolved connection: ' . $desc->connection . '</error>');
            $output->writeln('<error>Resolved driver: ' . $desc->driver . '</error>');
            $output->writeln('<error>Resolved DB target: ' . $targetDisplay . '</error>');
            $output->writeln('<error>Only SQLite :memory: and the approved ephemeral test directory</error>');
            $output->writeln('<error>are permitted targets for destructive commands.</error>');
            $output->writeln('<error>Non-SQLite drivers are never approved ephemeral test targets.</error>');
            $output->writeln('<error>There is no escape hatch for operational databases.</error>');
            $output->writeln('');

            // Throw to abort command execution.
            throw new \RuntimeException(
                "DATABASE SAFETY ABORT: Command '{$command}' blocked — "
                . "resolved DB (driver={$desc->driver}, target={$targetDisplay}) "
                . "is not an approved ephemeral test target."
            );
        });
    }
}
