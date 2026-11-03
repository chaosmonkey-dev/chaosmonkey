<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
{
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
    });
}

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('pull_requests');
    }
};
