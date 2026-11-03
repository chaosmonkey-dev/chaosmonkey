<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Add session_id as a first-class column for efficient querying.
     * 
     * Previously, session_id was only available inside the JSON metadata column.
     * Extracting it to a dedicated column enables:
     * - Efficient indexing for session-based queries
     * - JOIN operations between events in the same session
     * - Faster aggregation queries (e.g., events per session)
     * 
     * This migration also backfills existing rows from metadata->session_id.
     */
    public function up(): void
    {
        // Step 1: Add the session_id column
        Schema::table('telemetry_events', function (Blueprint $table) {
            if (!Schema::hasColumn('telemetry_events', 'session_id')) {
                $table->string('session_id')->nullable()->after('user_id');
                $table->index('session_id', 'idx_telemetry_session_id');
            }
        });

        // Step 2: Backfill session_id from metadata JSON for existing rows
        // This extracts metadata->session_id into the new column
        // NOTE: This uses MySQL JSON extraction syntax. Adjust for PostgreSQL if needed.
        try {
            DB::statement("
                UPDATE telemetry_events 
                SET session_id = JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.session_id'))
                WHERE session_id IS NULL 
                AND JSON_EXTRACT(metadata, '$.session_id') IS NOT NULL
            ");
            
            $backfilledCount = DB::table('telemetry_events')
                ->whereNotNull('session_id')
                ->count();
                
            \Log::info("Backfilled session_id for {$backfilledCount} telemetry events");
        } catch (\Exception $e) {
            \Log::warning("Failed to backfill session_id (may be using different DB): " . $e->getMessage());
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('telemetry_events', function (Blueprint $table) {
            if (Schema::hasColumn('telemetry_events', 'session_id')) {
                $table->dropIndex('idx_telemetry_session_id');
                $table->dropColumn('session_id');
            }
        });
    }
};
