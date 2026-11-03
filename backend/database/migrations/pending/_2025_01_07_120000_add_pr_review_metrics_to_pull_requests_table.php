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
        Schema::table('pull_requests', function (Blueprint $table) {
            // PR-level review metrics
            $table->timestamp('first_review_at')->nullable()->after('review_count');
            $table->integer('unique_reviewer_count')->default(0)->after('first_review_at');
            $table->integer('pr_reopened_count')->default(0)->after('unique_reviewer_count');
            
            // Indexes for performance
            $table->index('first_review_at');
            $table->index(['repo_name', 'first_review_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('pull_requests', function (Blueprint $table) {
            $table->dropIndex(['first_review_at']);
            $table->dropIndex(['repo_name', 'first_review_at']);
            $table->dropColumn(['first_review_at', 'unique_reviewer_count', 'pr_reopened_count']);
        });
    }
};
