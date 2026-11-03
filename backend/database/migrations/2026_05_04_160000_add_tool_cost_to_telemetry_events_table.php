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
            if (!Schema::hasColumn('telemetry_events', 'tool_cost')) {
                $table->decimal('tool_cost', 8, 2)->nullable()->comment('Monthly tool cost in USD for demo data');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('telemetry_events', function (Blueprint $table) {
            if (Schema::hasColumn('telemetry_events', 'tool_cost')) {
                $table->dropColumn('tool_cost');
            }
        });
    }
};
