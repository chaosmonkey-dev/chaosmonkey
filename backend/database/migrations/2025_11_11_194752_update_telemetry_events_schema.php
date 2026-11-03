<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('telemetry_events', function (Blueprint $table) {
            if (!Schema::hasColumn('telemetry_events', 'user_id')) {
                $table->string('user_id')->nullable();
            }
            if (!Schema::hasColumn('telemetry_events', 'event_type')) {
                $table->string('event_type')->nullable();
            }
            if (!Schema::hasColumn('telemetry_events', 'count')) {
                $table->integer('count')->default(0);
            }
            if (!Schema::hasColumn('telemetry_events', 'duration_ms')) {
                $table->integer('duration_ms')->nullable();
            }
            if (!Schema::hasColumn('telemetry_events', 'timestamp')) {
                $table->timestamp('timestamp')->nullable();
            }
            if (!Schema::hasColumn('telemetry_events', 'metadata')) {
                $table->json('metadata')->nullable();
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('telemetry_events', function (Blueprint $table) {
            if (Schema::hasColumn('telemetry_events', 'metadata')) {
                $table->dropColumn('metadata');
            }
            if (Schema::hasColumn('telemetry_events', 'timestamp')) {
                $table->dropColumn('timestamp');
            }
            if (Schema::hasColumn('telemetry_events', 'duration_ms')) {
                $table->dropColumn('duration_ms');
            }
            if (Schema::hasColumn('telemetry_events', 'count')) {
                $table->dropColumn('count');
            }
            if (Schema::hasColumn('telemetry_events', 'event_type')) {
                $table->dropColumn('event_type');
            }
            if (Schema::hasColumn('telemetry_events', 'user_id')) {
                $table->dropColumn('user_id');
            }
        });
    }
};
