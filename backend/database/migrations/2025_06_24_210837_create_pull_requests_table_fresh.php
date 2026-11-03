<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Backward-compatible pull_requests table creation for fresh installs.
 *
 * On existing DBs where pull_requests already exists (created historically
 * via pending/ or manual schema changes), this migration is a no-op.
 *
 * On fresh Patra DBs, this creates the full canonical pull_requests schema
 * required by accepted V1, including columns that subsequent active migrations
 * (2026_05_04_224009) reference via ->after('deletions').
 *
 * Schema derived from the accepted freeze DB
 * (cr5-v1-freeze-2026-08-21-1855.sqlite) pull_requests table definition.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('pull_requests')) {
            return;
        }

        Schema::create('pull_requests', function (Blueprint $table) {
            $table->id();
            $table->string('repo_name')->nullable();
            $table->integer('pr_number')->nullable();
            $table->string('developer_id')->nullable();
            $table->timestamp('merged_at')->nullable();
            $table->integer('comments_count')->nullable();
            $table->integer('review_count')->nullable();
            $table->boolean('cursor_usage_detected')->default(false);
            $table->timestamps();
            // Review metrics (historically from disabled _2025_01_07_120000)
            $table->timestamp('first_review_at')->nullable()->after('review_count');
            $table->integer('unique_reviewer_count')->default(0)->after('first_review_at');
            $table->integer('pr_reopened_count')->default(0)->after('unique_reviewer_count');
            // GitHub PR fields base (additions/deletions needed by 2026_05_04_224009 ->after('deletions'))
            $table->integer('additions')->default(0)->after('pr_reopened_count');
            $table->integer('deletions')->default(0)->after('additions');

            $table->index('first_review_at');
            $table->index(['repo_name', 'first_review_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pull_requests');
    }
};
