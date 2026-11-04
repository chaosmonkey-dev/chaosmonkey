<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Add editor_source column to store tool identity for V2 normalization.
     * 
     * This column stores the canonical tool identifier (windsurf, cursor, vscode, etc.)
     * extracted from event metadata/payload during ingestion.
     * 
     * The column is nullable to support existing rows that may not have tool identity.
     */
    public function up(): void
    {
        Schema::table('telemetry_events', function (Blueprint $table) {
            if (!Schema::hasColumn('telemetry_events', 'editor_source')) {
                $table->string('editor_source', 32)->nullable()->after('source');
                $table->index('editor_source', 'idx_telemetry_editor_source');
            }
        });

        // Optional: Backfill from metadata if available
        // This attempts to extract tool identity from existing metadata
        try {
            // Try to extract from metadata->source, metadata->editor_source, metadata->tool, etc.
            $extract = fn (string $key) => DB::getDriverName() === 'sqlite'
                ? "json_extract(metadata, '$.{$key}')"
                : "JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.{$key}'))";

            DB::statement("
                UPDATE telemetry_events
                SET editor_source = COALESCE(
                    {$extract('editor_source')},
                    {$extract('source')},
                    {$extract('tool')},
                    {$extract('ide')},
                    {$extract('client_source')},
                    {$extract('session_source')}
                )
                WHERE editor_source IS NULL
                AND metadata IS NOT NULL
            ");
            
            $backfilledCount = DB::table('telemetry_events')
                ->whereNotNull('editor_source')
                ->count();
                
            \Log::info("Backfilled editor_source for {$backfilledCount} telemetry events");
        } catch (\Exception $e) {
            \Log::warning("Failed to backfill editor_source (may be using different DB): " . $e->getMessage());
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('telemetry_events', function (Blueprint $table) {
            if (Schema::hasColumn('telemetry_events', 'editor_source')) {
                $table->dropIndex('idx_telemetry_editor_source');
                $table->dropColumn('editor_source');
            }
        });
    }
};
