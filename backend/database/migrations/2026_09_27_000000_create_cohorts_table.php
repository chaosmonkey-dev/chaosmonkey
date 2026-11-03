<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * K1A: Organization-scoped developer cohorts.
 *
 * A cohort is a server-authoritative grouping of invite-backed developer
 * identities (invite:<id>). Cohorts are never supplied by telemetry clients
 * and never written onto telemetry rows; membership is resolved at query
 * time (K1B) from cohort_members.
 *
 * name uses NOCASE collation so the (organization_id, name) unique
 * constraint is case-insensitive. All deployments and tests run SQLite;
 * NOCASE is a supported collation there.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cohorts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name')->collation('NOCASE');
            $table->string('description')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();

            $table->unique(['organization_id', 'name']);
            $table->index(['organization_id', 'archived_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cohorts');
    }
};
