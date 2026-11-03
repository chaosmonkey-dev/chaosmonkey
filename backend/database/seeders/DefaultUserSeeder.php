<?php

namespace Database\Seeders;

use App\Models\User;
use App\Models\Organization;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DefaultUserSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        // Create default organization if it doesn't exist
        $organization = Organization::firstOrCreate(
            ['slug' => 'default-org'],
            [
                'name' => 'Default Organization',
                'slug' => 'default-org',
            ]
        );

        // Create default user if it doesn't exist
        User::firstOrCreate(
            ['email' => 'default@example.com'],
            [
                'name' => 'Default User',
                'email' => 'default@example.com',
                'password' => Hash::make('password'),
                'organization_id' => $organization->id,
            ]
        );

        $this->command->info('Default user and organization created successfully.');
    }
}
