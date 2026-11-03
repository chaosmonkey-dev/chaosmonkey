<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use App\Models\Invite;
use App\Models\Organization;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Invite>
 */
class InviteFactory extends Factory
{
    protected $model = Invite::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'token' => \Illuminate\Support\Str::random(32),
            'email' => $this->faker->optional()->safeEmail(),
            'expires_at' => now()->addDays(30),
            'redeemed_at' => null,
            'redeemed_by_user_id' => null,
        ];
    }
}
