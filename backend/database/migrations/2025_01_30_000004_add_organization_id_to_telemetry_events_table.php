<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Backward-compatible guard: on fresh installs telemetry_events does not
     * exist yet (created later by 2025_11_10_150105). The column is added by
     * the idempotent follow-up migration 2025_11_12_000002. On existing DBs
     * where this migration already ran, it no-ops (column already present).
     */
    public function up(): void
    {
        if (!Schema::hasTable('telemetry_events')) {
            return;
        }
        if (Schema::hasColumn('telemetry_events', 'organization_id')) {
            return;
        }
        Schema::table('telemetry_events', function (Blueprint $table) {
            $table->foreignId('organization_id')->nullable()->after('id')->index();
            $table->foreign('organization_id')->references('id')->on('organizations')->onDelete('set null');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (!Schema::hasTable('telemetry_events')) {
            return;
        }
        if (!Schema::hasColumn('telemetry_events', 'organization_id')) {
            return;
        }
        Schema::table('telemetry_events', function (Blueprint $table) {
            $table->dropForeign(['organization_id']);
            $table->dropIndex(['organization_id']);
            $table->dropColumn('organization_id');
        });
    }
};
