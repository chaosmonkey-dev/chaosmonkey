<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Data-driven guard: the legacy ChaosMonkey org / Matt user backfill only
     * runs when pre-existing records actually need organization assignment.
     * A fresh empty Patra DB has zero rows to backfill, so no default org or
     * user is created. Patra org/admin are created explicitly during deployment.
     */
    public function up(): void
    {
        // Determine whether any legacy data actually needs backfill
        $needsBackfill = false;
        $chaosMonkeyOrgId = null;

        $chaosMonkeyOrg = DB::table('organizations')->where('slug', 'chaosmonkey')->first();
        if ($chaosMonkeyOrg) {
            $chaosMonkeyOrgId = $chaosMonkeyOrg->id;
        }

        // Check for NULL organization_id records that would need a fallback org
        $nullTelemetry = Schema::hasColumn('telemetry_events', 'organization_id')
            ? DB::table('telemetry_events')->whereNull('organization_id')->count()
            : 0;
        $nullUsers = Schema::hasColumn('users', 'organization_id')
            ? DB::table('users')->whereNull('organization_id')->count()
            : 0;
        $nullTokens = Schema::hasTable('api_tokens') && Schema::hasColumn('api_tokens', 'organization_id')
            ? DB::table('api_tokens')->whereNull('organization_id')->count()
            : 0;

        if ($nullTelemetry > 0 || $nullUsers > 0 || $nullTokens > 0) {
            $needsBackfill = true;
        }

        // Only create the fallback org/user if legacy data requires it
        if ($needsBackfill && !$chaosMonkeyOrgId) {
            $chaosMonkeyOrgId = DB::table('organizations')->insertGetId([
                'name' => 'ChaosMonkey',
                'slug' => 'chaosmonkey',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        if ($needsBackfill) {
            // Create Matt McClintock user if not exists and assign to ChaosMonkey org
            $mattUser = DB::table('users')->where('github_id', 'matt_mcclintock')->first();
            if (!$mattUser) {
                DB::table('users')->insert([
                    'name' => 'Matt McClintock',
                    'email' => 'matt@chaosmonkey.com',
                    'github_id' => 'matt_mcclintock',
                    'organization_id' => $chaosMonkeyOrgId,
                    'password' => bcrypt('password'), // placeholder
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            // Migrate all NULL organization_id to ChaosMonkey org
            DB::table('telemetry_events')
                ->whereNull('organization_id')
                ->update(['organization_id' => $chaosMonkeyOrgId]);

            DB::table('users')
                ->whereNull('organization_id')
                ->update(['organization_id' => $chaosMonkeyOrgId]);

            if (Schema::hasTable('api_tokens')) {
                DB::table('api_tokens')
                    ->whereNull('organization_id')
                    ->update(['organization_id' => $chaosMonkeyOrgId]);
            }
        }

        // Make telemetry_events.organization_id NOT NULL (schema work — always runs)
        if (Schema::hasTable('telemetry_events') && Schema::hasColumn('telemetry_events', 'organization_id')) {
            // Only tighten to NOT NULL if there are no remaining NULLs
            $remainingNulls = DB::table('telemetry_events')->whereNull('organization_id')->count();
            if ($remainingNulls === 0) {
                Schema::table('telemetry_events', function (Blueprint $table) {
                    $table->foreignId('organization_id')->nullable(false)->change();
                });
            }
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Make organization_id nullable again
        if (Schema::hasTable('telemetry_events') && Schema::hasColumn('telemetry_events', 'organization_id')) {
            Schema::table('telemetry_events', function (Blueprint $table) {
                $table->foreignId('organization_id')->nullable()->change();
            });
        }

        // Set all organization_id back to NULL (dangerous in production)
        $chaosMonkeyOrg = DB::table('organizations')->where('slug', 'chaosmonkey')->first();
        if ($chaosMonkeyOrg) {
            DB::table('telemetry_events')
                ->where('organization_id', $chaosMonkeyOrg->id)
                ->update(['organization_id' => null]);

            DB::table('users')
                ->where('organization_id', $chaosMonkeyOrg->id)
                ->update(['organization_id' => null]);

            if (Schema::hasTable('api_tokens')) {
                DB::table('api_tokens')
                    ->where('organization_id', $chaosMonkeyOrg->id)
                    ->update(['organization_id' => null]);
            }

            // Delete Matt McClintock user
            DB::table('users')
                ->where('github_id', 'matt_mcclintock')
                ->delete();

            // Delete ChaosMonkey organization
            DB::table('organizations')
                ->where('slug', 'chaosmonkey')
                ->delete();
        }
    }
};
