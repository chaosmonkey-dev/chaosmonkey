<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Idempotent follow-up: ensures telemetry_events.organization_id exists on
 * fresh installs where 2025_01_30_000004 safely skipped (table did not exist
 * yet). On existing DBs where the column already exists, this is a no-op.
 */
return new class extends Migration
{
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
