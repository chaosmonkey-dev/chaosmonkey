<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class FreshInstallCompatibilityTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Fresh migration completes without errors.
     */
    public function test_fresh_migration_completes_cleanly(): void
    {
        // If RefreshDatabase succeeded, migrations ran. Verify the migrations
        // table exists and has records.
        $this->assertTrue(Schema::hasTable('migrations'));
        $this->assertGreaterThan(0, \DB::table('migrations')->count());
    }

    /**
     * pull_requests table exists on fresh DB (Phase 0.6 repair).
     */
    public function test_pull_requests_table_exists_on_fresh_db(): void
    {
        $this->assertTrue(Schema::hasTable('pull_requests'));
    }

    /**
     * telemetry_events table exists with organization_id column.
     */
    public function test_telemetry_events_has_organization_id(): void
    {
        $this->assertTrue(Schema::hasTable('telemetry_events'));
        $this->assertTrue(Schema::hasColumn('telemetry_events', 'organization_id'));
    }

    /**
     * Required 0.4.0 enrollment columns exist.
     */
    public function test_040_enrollment_columns_exist(): void
    {
        $this->assertTrue(Schema::hasColumn('api_tokens', 'invite_id'));
        $this->assertTrue(Schema::hasColumn('api_tokens', 'installation_id'));
        $this->assertTrue(Schema::hasColumn('ide_connect_codes', 'invite_id'));
        $this->assertTrue(Schema::hasColumn('ide_connect_codes', 'installation_id'));
    }

    /**
     * K1A cohort tables exist on fresh DB.
     */
    public function test_k1a_cohort_tables_exist_on_fresh_db(): void
    {
        $this->assertTrue(Schema::hasTable('cohorts'));
        $this->assertTrue(Schema::hasTable('cohort_members'));
        $this->assertTrue(Schema::hasColumn('cohorts', 'organization_id'));
        $this->assertTrue(Schema::hasColumn('cohorts', 'archived_at'));
        $this->assertTrue(Schema::hasColumn('cohort_members', 'invite_id'));
        $this->assertTrue(Schema::hasColumn('cohort_members', 'organization_id'));
    }

    /**
     * Fresh DB does NOT seed ChaosMonkey organization (Phase 0.6 guard).
     */
    public function test_fresh_db_has_no_chaosmonkey_org(): void
    {
        $count = \DB::table('organizations')->where('slug', 'chaosmonkey')->count();
        $this->assertEquals(0, $count, 'Fresh DB must not seed ChaosMonkey organization');
    }

    /**
     * Fresh DB does NOT seed legacy backfill user (Phase 0.6 guard).
     */
    public function test_fresh_db_has_no_legacy_user(): void
    {
        $count = \DB::table('users')->where('github_id', 'legacy_admin')->count();
        $this->assertEquals(0, $count, 'Fresh DB must not seed legacy backfill user');
    }

    /**
     * Fresh DB has zero customer/runtime data.
     */
    public function test_fresh_db_has_zero_customer_data(): void
    {
        $this->assertEquals(0, \DB::table('telemetry_events')->count());
        $this->assertEquals(0, \DB::table('pull_requests')->count());
        $this->assertEquals(0, \DB::table('deployments')->count());
        $this->assertEquals(0, \DB::table('oauth_tokens')->count());
        $this->assertEquals(0, \DB::table('api_tokens')->count());
        $this->assertEquals(0, \DB::table('ide_connect_codes')->count());
        $this->assertEquals(0, \DB::table('invites')->count());
        $this->assertEquals(0, \DB::table('users')->count());
        $this->assertEquals(0, \DB::table('organizations')->count());
    }
}
