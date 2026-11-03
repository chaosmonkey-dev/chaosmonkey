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
        Schema::create('pr_reopen_events', function (Blueprint $table) {
            $table->id();
            $table->string('repo_name'); // e.g., "owner/repo"
            $table->integer('pr_number');
            $table->timestamp('occurred_at'); // When the reopen event happened
            $table->string('event_id')->nullable(); // GitHub event ID for deduplication
            $table->string('actor_login')->nullable(); // Who reopened the PR
            $table->json('raw_event')->nullable(); // Full GitHub event payload
            $table->timestamps();
            
            // Indexes for time-window queries
            $table->index(['occurred_at'], 'idx_occurred_at');
            $table->index(['repo_name', 'occurred_at'], 'idx_repo_occurred_at');
            $table->index(['repo_name', 'pr_number', 'occurred_at'], 'idx_repo_pr_occurred_at');
            $table->unique(['event_id'], 'uniq_event_id'); // Prevent duplicates
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('pr_reopen_events');
    }
};
