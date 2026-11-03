<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * K1A: Cohort membership — the canonical developer-grouping relation.
 *
 * invite_id is UNIQUE: a developer (invite-backed identity) belongs to
 * zero or one cohort at a time. organization_id is denormalized from the
 * cohort as a tenant guard; membership writes must prove
 * invite.organization_id = cohort.organization_id = organization_id.
 *
 * Membership rows carry no effective-date semantics in V1: analytics use
 * current-membership semantics. Deleting an invite cascades membership.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cohort_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('cohort_id')->constrained('cohorts')->cascadeOnDelete();
            $table->foreignId('invite_id')->unique()->constrained('invites')->cascadeOnDelete();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('assigned_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index('cohort_id');
            $table->index('organization_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cohort_members');
    }
};
