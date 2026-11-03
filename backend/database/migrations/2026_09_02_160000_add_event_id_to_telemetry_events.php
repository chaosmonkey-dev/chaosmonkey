<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P0-G Part D: Add event_id column to telemetry_events for idempotent replay.
 *
 * This is an ADDITIVE migration only:
 * - Adds nullable event_id column (historical rows remain valid with NULL)
 * - Adds a unique index on event_id
 *
 * SQLite enforces unique constraints only for non-NULL values,
 * so historical rows with NULL event_id are unaffected.
 *
 * This migration is NOT applied to the restored July candidate in P0-G.
 * It is exercised only against the ephemeral test DB.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('telemetry_events', function (Blueprint $table) {
            $table->string('event_id', 64)->nullable()->after('batch_hash');
        });

        // Create unique index on event_id.
        // SQLite enforces this only for non-NULL values automatically.
        // Historical rows with NULL event_id are unaffected.
        Schema::table('telemetry_events', function (Blueprint $table) {
            $table->index('event_id', 'idx_telemetry_event_id');
        });
    }

    public function down(): void
    {
        Schema::table('telemetry_events', function (Blueprint $table) {
            $table->dropIndex('idx_telemetry_event_id');
            $table->dropColumn('event_id');
        });
    }
};
