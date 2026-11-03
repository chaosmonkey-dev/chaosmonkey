<?php

namespace Database\Seeders;

use App\Models\PullRequest;
use App\Models\Deployment;
use Illuminate\Database\Seeder;
use Carbon\Carbon;

class GitHubDemoSeeder extends Seeder
{
    /**
     * Seed demo GitHub data for testing RM/DO chips.
     */
    public function run(): void
    {
        // Create demo PRs for Review & Merge metrics
        $prs = [
            [
                'repo_name' => 'demo-repo-1',
                'pr_number' => 1,
                'developer_id' => 1,
                'merged_at' => Carbon::now()->subDays(2),
                'comments_count' => 5,
                'review_count' => 2,
                'first_review_at' => Carbon::now()->subDays(2)->addHours(4),
                'unique_reviewer_count' => 2,
                'pr_reopened_count' => 0,
                'cursor_usage_detected' => true,
                'created_at' => Carbon::now()->subDays(3),
                'updated_at' => Carbon::now(),
            ],
            [
                'repo_name' => 'demo-repo-1',
                'pr_number' => 2,
                'developer_id' => 2,
                'merged_at' => Carbon::now()->subDays(1),
                'comments_count' => 12,
                'review_count' => 3,
                'first_review_at' => Carbon::now()->subDays(1)->addHours(2),
                'unique_reviewer_count' => 3,
                'pr_reopened_count' => 1,
                'cursor_usage_detected' => false,
                'created_at' => Carbon::now()->subDays(2),
                'updated_at' => Carbon::now(),
            ],
            [
                'repo_name' => 'demo-repo-2',
                'pr_number' => 3,
                'developer_id' => 1,
                'merged_at' => Carbon::now()->subHours(6),
                'comments_count' => 8,
                'review_count' => 1,
                'first_review_at' => Carbon::now()->subHours(6)->addHours(3),
                'unique_reviewer_count' => 1,
                'pr_reopened_count' => 0,
                'cursor_usage_detected' => true,
                'created_at' => Carbon::now()->subHours(12),
                'updated_at' => Carbon::now(),
            ],
            // Add some PRs without reviews (should be filtered out)
            [
                'repo_name' => 'demo-repo-2',
                'pr_number' => 4,
                'developer_id' => 3,
                'merged_at' => Carbon::now()->subHours(3),
                'comments_count' => 2,
                'review_count' => 0, // No reviews
                'first_review_at' => null,
                'unique_reviewer_count' => 0,
                'pr_reopened_count' => 0,
                'cursor_usage_detected' => false,
                'created_at' => Carbon::now()->subHours(8),
                'updated_at' => Carbon::now(),
            ],
        ];

        foreach ($prs as $pr) {
            PullRequest::create($pr);
        }

        // Create demo deployments for Deploy & Operate metrics
        $deployments = [
            [
                'repo_name' => 'demo-repo-1',
                'environment' => 'production',
                'deployment_status' => 'success',
                'deployed_at' => Carbon::now()->subDays(1),
                'sha' => 'abc123def456',
                'rollback_detected' => false,
                'metadata' => ['duration_minutes' => 15],
                'created_at' => Carbon::now()->subDays(1),
                'updated_at' => Carbon::now(),
            ],
            [
                'repo_name' => 'demo-repo-1',
                'environment' => 'staging',
                'deployment_status' => 'success',
                'deployed_at' => Carbon::now()->subHours(12),
                'sha' => 'def456ghi789',
                'rollback_detected' => false,
                'metadata' => ['duration_minutes' => 8],
                'created_at' => Carbon::now()->subHours(12),
                'updated_at' => Carbon::now(),
            ],
            [
                'repo_name' => 'demo-repo-2',
                'environment' => 'production',
                'deployment_status' => 'failure',
                'deployed_at' => Carbon::now()->subHours(6),
                'sha' => 'ghi789jkl012',
                'rollback_detected' => true,
                'metadata' => ['duration_minutes' => 25, 'error' => 'Database connection failed'],
                'created_at' => Carbon::now()->subHours(6),
                'updated_at' => Carbon::now(),
            ],
            [
                'repo_name' => 'demo-repo-2',
                'environment' => 'production',
                'deployment_status' => 'success',
                'deployed_at' => Carbon::now()->subHours(2),
                'sha' => 'jkl012mno345',
                'rollback_detected' => false,
                'metadata' => ['duration_minutes' => 12],
                'created_at' => Carbon::now()->subHours(2),
                'updated_at' => Carbon::now(),
            ],
        ];

        foreach ($deployments as $deployment) {
            Deployment::create($deployment);
        }

        $this->command->info('GitHub demo data seeded successfully!');
        $this->command->info('PRs created: ' . count($prs));
        $this->command->info('Deployments created: ' . count($deployments));
        $this->command->info('PRs with reviews: ' . PullRequest::where('review_count', '>', 0)->count());
    }
}
