<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Track C1: Org-scoped configured cost persistence.
     * Additive only — does not touch existing tables.
     */
    public function up(): void
    {
        if (!Schema::hasTable('tool_cost_configs')) {
            Schema::create('tool_cost_configs', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('organization_id')->nullable();
                $table->string('tool_id');
                $table->string('tool_name')->nullable();
                $table->integer('seat_count')->default(0);
                $table->decimal('cost_per_seat_monthly', 10, 2)->default(0);
                $table->decimal('monthly_spend', 10, 2)->default(0);
                $table->dateTime('configured_at')->nullable();
                $table->unsignedBigInteger('configured_by')->nullable();
                $table->timestamps();

                // Unique per (organization, tool) — one configured cost per tool per org
                $table->unique(['organization_id', 'tool_id'], 'tool_cost_configs_org_tool_unique');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('tool_cost_configs');
    }
};
