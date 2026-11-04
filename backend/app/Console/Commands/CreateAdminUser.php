<?php

namespace App\Console\Commands;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Bootstrap the first admin/owner account for a fresh self-hosted install.
 *
 * There is intentionally no default credential anywhere in this codebase —
 * the operator runs this once after migrations:
 *
 *   php artisan chaosmonkey:create-admin admin@example.com --generate
 *   php artisan chaosmonkey:create-admin admin@example.com 's3cret-pass' --org="Acme Inc"
 *
 * If the password argument is omitted the command prompts interactively;
 * --generate mints a strong random password and prints it once.
 */
class CreateAdminUser extends Command
{
    protected $signature = 'chaosmonkey:create-admin
                            {email : Email address for the admin user}
                            {password? : Password (omit to be prompted, or use --generate)}
                            {--org= : Organization name or slug to use (created if missing)}
                            {--generate : Generate a random password and print it once}
                            {--name= : Display name for the admin user (defaults to local part of email)}';

    protected $description = 'Create the first admin/owner user and organization for a fresh install';

    public function handle(): int
    {
        $email = strtolower(trim((string) $this->argument('email')));

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error("Invalid email address: {$email}");
            return self::FAILURE;
        }

        if (User::where('email', $email)->exists()) {
            $this->error("A user with email {$email} already exists. Refusing to overwrite credentials.");
            return self::FAILURE;
        }

        // Resolve password: explicit argument > --generate > interactive prompt.
        $password = $this->argument('password');
        $generated = false;

        if ($password && $this->option('generate')) {
            $this->error('Pass either a password argument or --generate, not both.');
            return self::FAILURE;
        }

        if (!$password && $this->option('generate')) {
            $password = Str::password(20);
            $generated = true;
        }

        if (!$password) {
            $password = $this->secret('Password for the new admin user');
            $confirm = $this->secret('Confirm password');
            if (!$password || $password !== $confirm) {
                $this->error('Passwords do not match or are empty.');
                return self::FAILURE;
            }
        }

        if (strlen($password) < 12) {
            $this->error('Password must be at least 12 characters.');
            return self::FAILURE;
        }

        // Resolve organization: --org name/slug > single existing org > create one.
        $organization = $this->resolveOrganization();
        if (!$organization) {
            return self::FAILURE;
        }

        $name = $this->option('name') ?: Str::of($email)->before('@')->replace(['.', '_', '-'], ' ')->title()->toString();

        $user = User::create([
            'name' => $name,
            'email' => $email,
            'password' => bcrypt($password),
            'organization_id' => $organization->id,
            'role' => 'admin',
            'email_verified_at' => now(),
        ]);

        $this->info("Admin user created: {$user->email} (id {$user->id}, role=admin)");
        $this->info("Organization: {$organization->name} (id {$organization->id}, slug {$organization->slug})");

        if ($generated) {
            $this->warn('Generated password (shown once — store it securely):');
            $this->line("  {$password}");
        }

        $this->info('Log in at the dashboard with these credentials (POST /api/auth/login).');

        return self::SUCCESS;
    }

    private function resolveOrganization(): ?Organization
    {
        $orgOption = $this->option('org');

        if ($orgOption) {
            $organization = Organization::where('slug', $orgOption)
                ->orWhere('name', $orgOption)
                ->first();

            if ($organization) {
                return $organization;
            }

            return Organization::create([
                'name' => $orgOption,
                'slug' => Str::slug($orgOption) ?: 'org-' . Str::lower(Str::random(8)),
            ]);
        }

        $existing = Organization::orderBy('id')->first();
        if ($existing) {
            return $existing;
        }

        return Organization::create([
            'name' => 'Primary Organization',
            'slug' => 'primary',
        ]);
    }
}
