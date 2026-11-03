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
        Schema::create('deployments', function (Blueprint $table) {
            $table->id();
            $table->string('repo_name')->nullable();
            $table->string('environment')->nullable(); // prod, staging, dev, preview
            $table->string('deployment_status')->nullable(); // success, failure, in_progress, queued, unknown
            $table->timestamp('deployed_at')->nullable();
            $table->string('sha')->nullable(); // Git SHA for rollback detection
            $table->boolean('rollback_detected')->default(false);
            $table->json('metadata')->nullable(); // Additional deployment metadata
            $table->timestamps();
            
            // Indexes for performance
            $table->index(['repo_name', 'deployed_at']);
            $table->index('environment');
            $table->index('deployment_status');
            $table->index('rollback_detected');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('deployments');
    }
};
