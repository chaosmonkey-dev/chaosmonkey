<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $this->call([
            OrganizationSeeder::class,
        ]);

        // NOTE: No default user is seeded. Create the first admin/owner
        // account explicitly with:
        //   php artisan chaosmonkey:create-admin you@example.com --generate
        // Demo data seeders (HeroInsightsDemoSeeder, GitHubDemoSeeder, ...)
        // must be invoked by name — never from the default path.
    }
}
