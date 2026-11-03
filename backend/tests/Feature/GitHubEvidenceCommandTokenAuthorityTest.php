<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\Organization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CR-X P0: GitHub evidence console commands must use org-scoped
 * engineering_integration token authority, not the latest token by
 * updated_at.  This test exercises the private getOAuthToken() method
 * on each command class without calling the live GitHub API.
 */
class GitHubEvidenceCommandTokenAuthorityTest extends TestCase
{
    use RefreshDatabase;

    private function setPilotOrg(Organization $org): void
    {
        Config::set('services.pilot.single_tenant_org_slug', $org->slug);
    }

    /**
     * Call the private getOAuthToken() method on a command class.
     */
    private function getCommandToken(string $commandClass): ?string
    {
        $command = new $commandClass();
        $command->setLaravel($this->app);
        $output = new \Illuminate\Console\OutputStyle(
            new \Symfony\Component\Console\Input\StringInput(''),
            new \Symfony\Component\Console\Output\NullOutput()
        );
        $command->setOutput($output);
        $reflection = new \ReflectionMethod($commandClass, 'getOAuthToken');
        $reflection->setAccessible(true);
        return $reflection->invoke($command);
    }

    /**
     * Helper to verify that all five evidence commands resolve to the
     * engineering token for the pilot org.
     */
    private function assertAllCommandsUseEngineeringToken(string $expectedToken): void
    {
        $commands = [
            \App\Console\Commands\GitHubSyncPullRequests::class,
            \App\Console\Commands\GitHubSyncReleases::class,
            \App\Console\Commands\GitHubBackfillDeployments::class,
            \App\Console\Commands\GitHubBackfillPRReviewMetrics::class,
            \App\Console\Commands\GitHubBackfillPRReopenMetrics::class,
        ];

        foreach ($commands as $commandClass) {
            $token = $this->getCommandToken($commandClass);
            $this->assertSame($expectedToken, $token, "{$commandClass} should use the engineering token");
        }
    }

    public function test_engineering_token_older_than_identity_only_wins(): void
    {
        $org = Organization::factory()->create(['slug' => 'pilot-token-test']);
        $this->setPilotOrg($org);

        // Older engineering token
        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 1,
            'access_token' => 'gho_eng_older',
            'user_data' => json_encode([
                'login' => 'eng-user',
                'token_purpose' => 'engineering_integration',
            ]),
            'created_at' => now()->subDays(5),
            'updated_at' => now()->subDays(5),
        ]);

        // Newer identity-only token
        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 2,
            'access_token' => 'gho_identity_newer',
            'user_data' => json_encode([
                'login' => 'identity-user',
                'token_purpose' => 'identity_only',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertAllCommandsUseEngineeringToken('gho_eng_older');
    }

    public function test_multiple_identity_only_tokens_do_not_override_engineering(): void
    {
        $org = Organization::factory()->create(['slug' => 'pilot-multi-identity']);
        $this->setPilotOrg($org);

        // Engineering token
        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 1,
            'access_token' => 'gho_eng_main',
            'user_data' => json_encode([
                'login' => 'eng-user',
                'token_purpose' => 'engineering_integration',
            ]),
            'created_at' => now()->subDays(3),
            'updated_at' => now()->subDays(3),
        ]);

        // Multiple newer identity-only tokens from different users
        for ($i = 2; $i <= 4; $i++) {
            DB::table('oauth_tokens')->insert([
                'organization_id' => $org->id,
                'user_id' => $i,
                'access_token' => 'gho_identity_' . $i,
                'user_data' => json_encode([
                    'login' => 'identity-user-' . $i,
                    'token_purpose' => 'identity_only',
                ]),
                'created_at' => now()->subDays($i - 1),
                'updated_at' => now()->subDays($i - 1),
            ]);
        }

        $this->assertAllCommandsUseEngineeringToken('gho_eng_main');
    }

    public function test_identity_only_only_refuses_evidence_sync(): void
    {
        $org = Organization::factory()->create(['slug' => 'pilot-identity-only']);
        $this->setPilotOrg($org);

        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 1,
            'access_token' => 'gho_identity_only',
            'user_data' => json_encode([
                'login' => 'identity-user',
                'token_purpose' => 'identity_only',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $commands = [
            \App\Console\Commands\GitHubSyncPullRequests::class,
            \App\Console\Commands\GitHubSyncReleases::class,
            \App\Console\Commands\GitHubBackfillDeployments::class,
            \App\Console\Commands\GitHubBackfillPRReviewMetrics::class,
            \App\Console\Commands\GitHubBackfillPRReopenMetrics::class,
        ];

        foreach ($commands as $commandClass) {
            $token = $this->getCommandToken($commandClass);
            $this->assertNull($token, "{$commandClass} must refuse identity_only token for evidence");
        }
    }

    public function test_no_token_fails_closed(): void
    {
        $org = Organization::factory()->create(['slug' => 'pilot-no-token']);
        $this->setPilotOrg($org);

        $commands = [
            \App\Console\Commands\GitHubSyncPullRequests::class,
            \App\Console\Commands\GitHubSyncReleases::class,
            \App\Console\Commands\GitHubBackfillDeployments::class,
            \App\Console\Commands\GitHubBackfillPRReviewMetrics::class,
            \App\Console\Commands\GitHubBackfillPRReopenMetrics::class,
        ];

        foreach ($commands as $commandClass) {
            $token = $this->getCommandToken($commandClass);
            $this->assertNull($token, "{$commandClass} must fail closed with no token");
        }
    }

    public function test_organization_isolation_preserved(): void
    {
        $pilotOrg = Organization::factory()->create(['slug' => 'pilot-isolated']);
        $otherOrg = Organization::factory()->create(['slug' => 'other-pilot']);
        $this->setPilotOrg($pilotOrg);

        // Engineering token in the OTHER org
        DB::table('oauth_tokens')->insert([
            'organization_id' => $otherOrg->id,
            'user_id' => 1,
            'access_token' => 'gho_other_org_eng',
            'user_data' => json_encode([
                'login' => 'other-eng-user',
                'token_purpose' => 'engineering_integration',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Identity-only token in the pilot org
        DB::table('oauth_tokens')->insert([
            'organization_id' => $pilotOrg->id,
            'user_id' => 2,
            'access_token' => 'gho_pilot_identity',
            'user_data' => json_encode([
                'login' => 'pilot-identity',
                'token_purpose' => 'identity_only',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $commands = [
            \App\Console\Commands\GitHubSyncPullRequests::class,
            \App\Console\Commands\GitHubSyncReleases::class,
            \App\Console\Commands\GitHubBackfillDeployments::class,
            \App\Console\Commands\GitHubBackfillPRReviewMetrics::class,
            \App\Console\Commands\GitHubBackfillPRReopenMetrics::class,
        ];

        foreach ($commands as $commandClass) {
            $token = $this->getCommandToken($commandClass);
            $this->assertNull($token, "{$commandClass} must not leak tokens from other orgs");
        }
    }

    public function test_pr_sync_does_not_require_users_github_token_column(): void
    {
        $org = Organization::factory()->create(['slug' => 'pilot-no-user-token-column']);
        $this->setPilotOrg($org);
        $this->assertFalse(Schema::hasColumn('users', 'github_token'));

        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 1,
            'access_token' => 'gho_pr_eng',
            'user_data' => json_encode([
                'login' => 'eng-user',
                'token_purpose' => 'engineering_integration',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertSame(
            'gho_pr_eng',
            $this->getCommandToken(\App\Console\Commands\GitHubSyncPullRequests::class)
        );
    }

    public function test_release_sync_does_not_require_users_github_token_column(): void
    {
        $org = Organization::factory()->create(['slug' => 'pilot-no-user-token-column-release']);
        $this->setPilotOrg($org);
        $this->assertFalse(Schema::hasColumn('users', 'github_token'));

        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 1,
            'access_token' => 'gho_release_eng',
            'user_data' => json_encode([
                'login' => 'eng-user',
                'token_purpose' => 'engineering_integration',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertSame(
            'gho_release_eng',
            $this->getCommandToken(\App\Console\Commands\GitHubSyncReleases::class)
        );
    }

    public function test_pr_sync_explicit_repo_bound_requires_customer_authority(): void
    {
        $command = new class extends \App\Console\Commands\GitHubSyncPullRequests {
            protected function resolveCustomerRepoAllowList(?string $oauthToken, ?array $oauthUser, int $organizationId): array
            {
                return ['customer-org/customer-repo'];
            }

            public function checkRepo(string $repo, ?array $oauthUser): ?string
            {
                return $this->resolveAuthorizedSyncRepo($repo, 'gho_eng', $oauthUser, 1);
            }
        };

        $engineeringUser = ['login' => 'eng-user', 'token_purpose' => 'engineering_integration'];
        $this->assertSame('customer-org/customer-repo', $command->checkRepo('CUSTOMER-ORG/CUSTOMER-REPO', $engineeringUser));
        $this->assertNull($command->checkRepo('external-org/external-repo', $engineeringUser));
        $this->assertNull($command->checkRepo('customer-org/customer-repo', [
            'login' => 'identity-user',
            'token_purpose' => 'identity_only',
        ]));
    }

    public function test_release_sync_explicit_repo_bound_requires_customer_authority(): void
    {
        $command = new class extends \App\Console\Commands\GitHubSyncReleases {
            protected function resolveCustomerRepoAllowList(?string $oauthToken, ?array $oauthUser, int $organizationId): array
            {
                return ['customer-org/customer-repo'];
            }

            public function checkRepo(string $repo, ?array $oauthUser): ?string
            {
                return $this->resolveAuthorizedSyncRepo($repo, 'gho_eng', $oauthUser, 1);
            }
        };

        $engineeringUser = ['login' => 'eng-user', 'token_purpose' => 'engineering_integration'];
        $this->assertSame('customer-org/customer-repo', $command->checkRepo('CUSTOMER-ORG/CUSTOMER-REPO', $engineeringUser));
        $this->assertNull($command->checkRepo('external-org/external-repo', $engineeringUser));
        $this->assertNull($command->checkRepo('customer-org/customer-repo', [
            'login' => 'identity-user',
            'token_purpose' => 'identity_only',
        ]));
    }
}
