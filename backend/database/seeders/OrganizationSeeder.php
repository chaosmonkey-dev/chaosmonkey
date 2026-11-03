<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class OrganizationSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        // Create default organization
        $defaultOrg = Organization::firstOrCreate(
            ['slug' => 'default'],
            [
                'name' => 'Default Organization',
                'slug' => 'default',
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        // Backfill existing users to default organization
        User::whereNull('organization_id')->update([
            'organization_id' => $defaultOrg->id
        ]);

        // Backfill existing OAuth tokens to default organization
        DB::table('oauth_tokens')->whereNull('organization_id')->update([
            'organization_id' => $defaultOrg->id
        ]);

        // Backfill existing telemetry events to default organization
        DB::table('telemetry_events')->whereNull('organization_id')->update([
            'organization_id' => $defaultOrg->id
        ]);

        $this->command->info('✅ Default organization created and existing data backfilled');
        $this->command->info("   Organization ID: {$defaultOrg->id}");
        $this->command->info("   Users backfilled: " . User::where('organization_id', $defaultOrg->id)->count());
        $this->command->info("   OAuth tokens backfilled: " . DB::table('oauth_tokens')->where('organization_id', $defaultOrg->id)->count());
        $this->command->info("   Telemetry events backfilled: " . DB::table('telemetry_events')->where('organization_id', $defaultOrg->id)->count());
    }
}
