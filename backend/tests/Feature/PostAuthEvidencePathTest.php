<?php

namespace Tests\Feature;

use App\Console\Commands\GitHubBackfillDeployments;
use App\Console\Commands\GitHubSyncPullRequests;
use App\Console\Commands\GitHubSyncReleases;
use App\Models\ApiToken;
use App\Models\Deployment;
use App\Models\Organization;
use App\Models\PullRequest;
use App\Models\Release;
use App\Models\User;
use App\Services\DeploymentMetricsService;
use Illuminate\Console\Command;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Symfony\Component\Console\Input\ArrayInput;
use Symfony\Component\Console\Output\BufferedOutput;
use Tests\TestCase;

/**
 * Disposable non-customer proof for the post-authorization evidence path.
 * GitHub API calls are deterministic command/service doubles; persisted rows
 * live only in the in-memory RefreshDatabase fixture and are never presented
 * as customer evidence.
 */
class PostAuthEvidencePathTest extends TestCase
{
    use RefreshDatabase;

    private function runCommand(Command $command, array $input): array
    {
        $command->setLaravel($this->app);
        $output = new BufferedOutput();
        $status = $command->run(new ArrayInput($input), $output);
        return [$status, $output->fetch()];
    }

    public function test_engineering_to_bounded_sync_to_delivery_timeseries_path(): void
    {
        config(['services.pilot.single_tenant_org_slug' => 'post-auth-fixture']);

        $org = Organization::factory()->create([
            'name' => 'Post Auth Fixture',
            'slug' => 'post-auth-fixture',
        ]);
        $user = User::factory()->create(['organization_id' => $org->id]);
        $dashboardToken = ApiToken::generateDashboardToken($user->id, $org->id)['raw'];

        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'access_token' => 'gho_fixture_engineering',
            'user_data' => json_encode([
                'login' => 'fixture-eng',
                'token_purpose' => 'engineering_integration',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $repo = 'customer-org/customer-repo';
        $mergedAt = now()->subDays(2)->toIso8601String();
        $createdAt = now()->subDays(4)->toIso8601String();

        $prCommand = new class($mergedAt, $createdAt) extends GitHubSyncPullRequests {
            public function __construct(private string $mergedAt, private string $createdAt)
            {
                parent::__construct();
            }

            protected function resolveCustomerRepoAllowList(?string $oauthToken, ?array $oauthUser, int $organizationId): array
            {
                return ['customer-org/customer-repo'];
            }

            protected function githubApiCall(string $oauthToken, string $endpoint): ?array
            {
                return [[
                    'number' => 42,
                    'merged_at' => $this->mergedAt,
                    'created_at' => $this->createdAt,
                    'updated_at' => $this->mergedAt,
                    'comments' => 1,
                    'review_comments' => 2,
                    'additions' => 10,
                    'deletions' => 4,
                    'changed_files' => 3,
                    'user' => ['login' => 'fixture-dev'],
                ]];
            }
        };

        [$status, $output] = $this->runCommand($prCommand, [
            '--repo' => $repo,
            '--state' => 'all',
            '--per_page' => 100,
            '--max_pages' => 1,
        ]);

        $this->assertSame(0, $status, $output);
        $pr = PullRequest::where('repo_name', $repo)->firstOrFail();
        $this->assertSame('github_api_sync', $pr->data_source);
        $this->assertSame('fixture-dev', $pr->user_login);

        $releaseCommand = new class extends GitHubSyncReleases {
            protected function resolveCustomerRepoAllowList(?string $oauthToken, ?array $oauthUser, int $organizationId): array
            {
                return ['customer-org/customer-repo'];
            }

            protected function githubApiCall(string $oauthToken, string $endpoint): ?array
            {
                return [[
                    'id' => 9001,
                    'tag_name' => 'v1.2.3',
                    'name' => 'Fixture release',
                    'published_at' => now()->subDay()->toIso8601String(),
                    'author' => ['login' => 'fixture-release'],
                    'draft' => false,
                    'prerelease' => false,
                    'target_commitish' => 'main',
                    'html_url' => 'https://github.example.invalid/customer-org/customer-repo/releases/v1.2.3',
                ]];
            }
        };

        [$status, $output] = $this->runCommand($releaseCommand, [
            '--repo' => $repo,
            '--per_page' => 100,
            '--max_pages' => 1,
            '--since' => now()->subDays(90)->format('Y-m-d'),
        ]);

        $this->assertSame(0, $status, $output);
        $release = Release::where('repo_name', $repo)->firstOrFail();
        $this->assertSame('github_api_sync', $release->metadata['data_source'] ?? null);

        $deploymentCommand = new class extends GitHubBackfillDeployments {
            protected function resolveCustomerRepoAllowList(?string $oauthToken, ?array $oauthUser, int $organizationId): array
            {
                return ['customer-org/customer-repo'];
            }

            protected function newDeploymentMetricsService(): DeploymentMetricsService
            {
                return new class extends DeploymentMetricsService {
                    public function fetchDeployments($token, $owner, $repo, $days = 30)
                    {
                        return [[
                            'id' => 7001,
                            'environment' => 'production',
                            'sha' => str_repeat('a', 40),
                            'ref' => 'main',
                            'task' => 'deploy',
                            'description' => 'fixture deployment',
                            'created_at' => now()->subDay()->toIso8601String(),
                        ]];
                    }

                    public function fetchDeploymentStatuses($token, $owner, $repo, $deploymentId)
                    {
                        return [[
                            'state' => 'success',
                            'created_at' => now()->subDay()->toIso8601String(),
                        ]];
                    }
                };
            }
        };

        [$status, $output] = $this->runCommand($deploymentCommand, [
            '--days' => 90,
            '--limit' => 10,
            '--repo' => [$repo],
        ]);

        $this->assertSame(0, $status, $output);
        $deployment = Deployment::where('repo_name', $repo)->firstOrFail();
        $this->assertSame('github_api_sync', $deployment->metadata['source'] ?? null);
        $this->assertSame('github_api_sync', $deployment->metadata['data_source'] ?? null);

        Deployment::create([
            'repo_name' => $repo,
            'environment' => 'production',
            'deployment_status' => 'failure',
            'deployed_at' => now()->subDay(),
            'metadata' => ['source' => 'demo'],
        ]);

        $response = $this->withToken($dashboardToken)->getJson('/api/delivery/timeseries?repo=' . $repo);
        $response->assertStatus(200);
        $response->assertJsonPath('meta.source', 'live');
        $response->assertJsonPath('meta.repo', $repo);

        $series = $response->json('series');
        $this->assertSame(1, array_sum(array_column($series, 'merged_pr_count')));
        $this->assertSame(1, array_sum(array_column($series, 'release_count')));
        $this->assertSame(1, array_sum(array_column($series, 'deployment_count')));
        $this->assertSame(1, array_sum(array_column($series, 'successful_deployment_count')));
    }
}
