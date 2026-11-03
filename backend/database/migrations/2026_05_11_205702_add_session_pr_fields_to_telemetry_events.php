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
            $table->integer('session_prs_created')->default(0);
            $table->integer('session_prs_merged')->default(0);
            $table->integer('session_pr_reopen_count')->default(0);
            $table->integer('session_deployment_successes')->default(0);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('telemetry_events', function (Blueprint $table) {
            $table->dropColumn('session_prs_created');
            $table->dropColumn('session_prs_merged');
            $table->dropColumn('session_pr_reopen_count');
            $table->dropColumn('session_deployment_successes');
        });
    }
};
