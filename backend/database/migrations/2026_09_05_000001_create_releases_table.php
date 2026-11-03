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
        if (!Schema::hasTable('releases')) {
            Schema::create('releases', function (Blueprint $table) {
                $table->id();
                $table->string('repo_name');
                $table->bigInteger('release_id')->nullable(); // GitHub release/deployment ID
                $table->string('tag_name');
                $table->string('release_name')->nullable();
                $table->datetime('published_at')->nullable();
                $table->string('author_login')->nullable();
                $table->json('metadata')->nullable(); // Provenance fields like data_source
                $table->timestamps();

                // Indexes for performance
                $table->index(['repo_name', 'release_id']);
                $table->index('published_at');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('releases');
    }
};
