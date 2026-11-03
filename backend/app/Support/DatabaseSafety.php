<?php

namespace App\Support;

/**
 * Central database safety policy for CR-X.
 *
 * Enforces a single invariant: automated tests and destructive console
 * commands must never resolve to a physical operational database.
 *
 * Approved ephemeral test targets (ONLY when APP_ENV=testing):
 *   - SQLite ":memory:"
 *   - SQLite physical file beneath backend/storage/framework/testing/databases/
 *
 * EVERYTHING ELSE FAILS CLOSED — including MySQL, PostgreSQL, SQL Server,
 * arbitrary DB URLs, operational SQLite, staging/customer DBs, and any
 * non-SQLite connection.
 *
 * There is no environment-variable escape hatch for operational databases.
 */
final class DatabaseSafety
{
    /**
     * The single approved test-temp root for physical ephemeral SQLite files.
     */
    public const TEST_TEMP_ROOT = 'storage/framework/testing/databases';

    /**
     * Destructive Artisan commands that must be guarded.
     */
    public const DESTRUCTIVE_COMMANDS = [
        'migrate:fresh',
        'migrate:refresh',
        'migrate:reset',
        'db:wipe',
    ];

    /**
     * Resolved database connection descriptor.
     */
    public readonly string $connection;
    public readonly string $driver;
    public readonly ?string $target;

    /**
     * Resolve the current application database connection into a descriptor.
     *
     * @return self
     */
    public static function resolve(): self
    {
        $connection = (string) config('database.default');
        $driver = (string) config("database.connections.{$connection}.driver", '');
        $target = config("database.connections.{$connection}.database");

        return new self(
            connection: $connection,
            driver: $driver,
            target: is_string($target) ? $target : null,
        );
    }

    /**
     * Resolve the current SQLite database target from Laravel config.
     *
     * Returns the raw configured database string for the default connection
     * when the driver is sqlite, or null for non-sqlite drivers.
     *
     * @return string|null
     */
    public static function resolveSqliteTarget(): ?string
    {
        $desc = static::resolve();

        if ($desc->driver !== 'sqlite') {
            return null;
        }

        return $desc->target;
    }

    private function __construct(string $connection, string $driver, ?string $target)
    {
        $this->connection = $connection;
        $this->driver = $driver;
        $this->target = $target;
    }

    /**
     * Determine whether a database target is an approved ephemeral test target.
     *
     * Only SQLite ":memory:" and SQLite files beneath the approved test-temp
     * root (while APP_ENV=testing) are approved. Non-SQLite drivers are
     * NEVER approved ephemeral test targets.
     *
     * @param  string  $target
     * @param  string  $driver
     * @return bool
     */
    public static function isApprovedEphemeralTestTarget(string $target, string $driver = 'sqlite'): bool
    {
        // Non-SQLite drivers are never approved ephemeral test targets.
        if ($driver !== 'sqlite') {
            return false;
        }

        // 1. In-memory SQLite is always approved.
        if ($target === ':memory:') {
            return true;
        }

        // 2. Physical SQLite file beneath the approved test-temp root.
        //    Require APP_ENV=testing.
        if (!app()->environment('testing')) {
            return false;
        }

        return static::isPathWithinApprovedRoot($target);
    }

    /**
     * Determine whether the resolved application DB is an approved ephemeral
     * test target.
     *
     * @return bool
     */
    public function isApprovedEphemeral(): bool
    {
        if ($this->target === null) {
            return false;
        }

        return static::isApprovedEphemeralTestTarget($this->target, $this->driver);
    }

    /**
     * Hardened check: is the given path safely within the approved test root?
     *
     * - canonicalizes the approved root (realpath if exists, else normalized)
     * - canonicalizes dirname($target) (realpath if exists, else normalized)
     * - rejects if the parent cannot be safely resolved
     * - rejects symlink escape (realpath must be within approved root)
     * - rejects path traversal (no '..' segments after normalization)
     *
     * @param  string  $target
     * @return bool
     */
    private static function isPathWithinApprovedRoot(string $target): bool
    {
        $normalizedTarget = static::normalizePath($target);

        // Reject path traversal (no '..' segments after normalization).
        if (str_contains($normalizedTarget, '/../')) {
            return false;
        }

        $approvedRootRaw = base_path(static::TEST_TEMP_ROOT);
        $approvedRoot = static::normalizePath($approvedRootRaw);

        // The target must be inside the approved root (string-prefix check).
        if (!str_starts_with($normalizedTarget, $approvedRoot . '/')) {
            return false;
        }

        // Resolve the approved root's real path (canonical, no symlinks).
        $approvedRootReal = @realpath($approvedRootRaw);
        if ($approvedRootReal === false) {
            // Root doesn't exist yet — use the normalized path as canonical.
            $approvedRootReal = $approvedRoot;
        } else {
            $approvedRootReal = static::normalizePath($approvedRootReal);
        }

        // Resolve the parent directory of the target.
        $parent = dirname($normalizedTarget);
        $parentReal = @realpath($parent);
        if ($parentReal === false) {
            // Parent doesn't exist — reject. We require the parent to be
            // resolvable so a symlinked parent cannot escape.
            return false;
        }
        $parentReal = static::normalizePath($parentReal);

        // The parent must be the approved root or a descendant of it.
        if ($parentReal !== $approvedRootReal
            && !str_starts_with($parentReal, $approvedRootReal . '/')
        ) {
            return false;
        }

        // If the target file itself exists, verify its realpath is also within
        // the approved root (defense against symlinked files).
        $targetReal = @realpath($target);
        if ($targetReal !== false) {
            $targetReal = static::normalizePath($targetReal);
            if ($targetReal !== $approvedRootReal
                && !str_starts_with($targetReal, $approvedRootReal . '/')
            ) {
                return false;
            }
        }

        return true;
    }

    /**
     * Determine whether a target is a known operational database path
     * (defense-in-depth deny-list).
     *
     * @param  string  $target
     * @return bool
     */
    public static function isKnownOperationalPath(string $target): bool
    {
        $normalized = strtolower(static::normalizePath($target));
        $operationalPatterns = [
            'cr1-local-working.sqlite',
            'cr1-local-restored-july',
            'database.sqlite',
            'cr5-v1-freeze',
            'cr1-local-working.sqlite.test',
            'cr1-local-working.sqlite.quarantine',
            'database.sqlite.quarantine',
        ];

        foreach ($operationalPatterns as $pattern) {
            if (str_contains($normalized, strtolower($pattern))) {
                return true;
            }
        }

        return false;
    }

    /**
     * Assert that the current application database is safe for testing.
     *
     * FAILS CLOSED for every non-approved target, including non-SQLite
     * drivers, operational SQLite paths, and arbitrary DB URLs.
     *
     * @return void
     * @throws \RuntimeException when the resolved DB is not an approved ephemeral test target
     */
    public static function assertTestDatabaseSafe(): void
    {
        $desc = static::resolve();

        if ($desc->isApprovedEphemeral()) {
            return;
        }

        $approvedRoot = base_path(static::TEST_TEMP_ROOT);

        $targetDisplay = $desc->target ?? '(null/unresolved)';

        throw new \RuntimeException(
            "DATABASE SAFETY ABORT: Test environment resolved to a non-ephemeral database.\n"
            . "  Resolved connection: {$desc->connection}\n"
            . "  Resolved driver: {$desc->driver}\n"
            . "  Resolved DB target: {$targetDisplay}\n"
            . "  Approved test targets:\n"
            . "    - SQLite :memory:\n"
            . "    - SQLite {$approvedRoot}/<test-name>.sqlite\n"
            . "  All other drivers and physical paths are prohibited.\n"
            . "  Execution aborted to protect operational data."
        );
    }

    /**
     * Determine whether a destructive Artisan command is permitted
     * against the currently resolved database.
     *
     * FAILS CLOSED for non-SQLite and non-approved physical targets.
     *
     * @param  string  $commandName
     * @return bool
     */
    public static function isDestructiveCommandPermitted(string $commandName): bool
    {
        if (!in_array($commandName, static::DESTRUCTIVE_COMMANDS)) {
            return true; // Non-destructive commands are always permitted.
        }

        $desc = static::resolve();

        return $desc->isApprovedEphemeral();
    }

    /**
     * Normalize a filesystem path for comparison (resolve separators, trim).
     *
     * @param  string  $path
     * @return string
     */
    private static function normalizePath(string $path): string
    {
        // Convert backslashes to forward slashes.
        $path = str_replace('\\', '/', $path);
        // Collapse multiple slashes.
        $path = preg_replace('#/{2,}#', '/', $path);
        // Remove trailing slash.
        $path = rtrim($path, '/');

        return $path;
    }
}
