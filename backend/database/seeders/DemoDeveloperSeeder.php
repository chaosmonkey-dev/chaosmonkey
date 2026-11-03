<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DemoDeveloperSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        $demoDevelopers = [
            [
                'name' => 'High Performer',
                'email' => 'high-performer@demo.com',
                'password' => Hash::make('password123'),
                'organization_id' => 7,
                'role' => 'developer',
            ],
            [
                'name' => 'Average Developer',
                'email' => 'avg-dev@demo.com',
                'password' => Hash::make('password123'),
                'organization_id' => 7,
                'role' => 'developer',
            ],
            [
                'name' => 'Struggling Developer',
                'email' => 'struggling-dev@demo.com',
                'password' => Hash::make('password123'),
                'organization_id' => 7,
                'role' => 'developer',
            ],
        ];

        foreach ($demoDevelopers as $developer) {
            User::firstOrCreate(
                ['email' => $developer['email']],
                $developer
            );
        }

        $this->command->info('Demo developers created successfully.');
    }
}
