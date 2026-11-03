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
        Schema::table('metrics', function (Blueprint $table) {
            // Period-level deployment metrics
            $table->integer('failed_deployment_count')->default(0)->after('merge_rate');
            $table->date('period_start')->nullable()->after('failed_deployment_count'); // For weekly/monthly rollups
            $table->date('period_end')->nullable()->after('period_start');
            $table->string('period_type')->nullable()->after('period_end'); // 'week', 'month', 'quarter'
            $table->string('repo_name')->nullable()->after('period_type'); // For per-repo rollups
            
            // Indexes for performance
            $table->index(['period_start', 'period_end', 'period_type']);
            $table->index('repo_name');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('metrics', function (Blueprint $table) {
            $table->dropIndex(['period_start', 'period_end', 'period_type']);
            $table->dropIndex('repo_name');
            $table->dropColumn(['failed_deployment_count', 'period_start', 'period_end', 'period_type', 'repo_name']);
        });
    }
};
