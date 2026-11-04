<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class GitHubRealismSeeder extends Seeder
{
    /**
     * Run database seeds.
     */
    public function run(): void
    {
        Log::info('[GITHUB_REALISM_SEEDER] Starting targeted realism seeding');
        
        // Phase 2: Create 8-15 medium PRs with realistic characteristics
        $this->seedMediumPRs();
        
        // Phase 3: Multi-developer realism
        $this->seedDeveloperAttribution();
        
        // Phase 4: Review topology realism
        $this->seedReviewerIdentities();
        
        // Phase 5: Reopen/rework realism
        $this->seedReopenedPRs();
        
        // Phase 6: Deployment volatility realism
        $this->seedDeploymentVolatility();

        // Phase 7: Review metric cleanup
        $this->sanitizeReviewMetrics();
        
        // Phase 8: Temporal realism (applied throughout)
        Log::info('[GITHUB_REALISM_SEEDER] Completed targeted realism seeding');
    }
    
    private function seedMediumPRs(): void
    {
        $mediumPRs = [
            [
                'repo_name' => 'AngryMonkeyParty/AM-Sim',
                'pr_number' => 101,
                'developer_id' => 'alex.chen',
                'user_login' => 'alexchen',
                'additions' => 45,
                'deletions' => 12,
                'changed_files' => 6,
                'comments_count' => 3,
                'review_count' => 2,
                'review_comments' => 2,
                'first_review_at' => Carbon::now()->subDays(3)->subHours(2),
                'merged_at' => Carbon::now()->subDays(2)->subHours(4),
                'created_at' => Carbon::now()->subDays(4)->subHours(1),
                'updated_at' => Carbon::now()->subDays(2)->subHours(4),
                'data_source' => 'realism_seeder',
                'team_name' => 'backend',
                'cursor_usage_detected' => true,
                'unique_reviewer_count' => 2,
                'pr_reopened_count' => 0,
            ],
            [
                'repo_name' => 'example-org/chaosmonkey',
                'pr_number' => 102,
                'developer_id' => 'sarah.rodriguez',
                'user_login' => 'sarahrodriguez',
                'additions' => 67,
                'deletions' => 23,
                'changed_files' => 8,
                'comments_count' => 4,
                'review_count' => 3,
                'review_comments' => 3,
                'first_review_at' => Carbon::now()->subDays(5)->subHours(6),
                'merged_at' => Carbon::now()->subDays(4)->subHours(8),
                'created_at' => Carbon::now()->subDays(6)->subHours(2),
                'updated_at' => Carbon::now()->subDays(4)->subHours(8),
                'data_source' => 'realism_seeder',
                'team_name' => 'frontend',
                'cursor_usage_detected' => true,
                'unique_reviewer_count' => 3,
                'pr_reopened_count' => 0,
            ],
            [
                'repo_name' => 'AngryMonkeyParty/AM-Sim',
                'pr_number' => 103,
                'developer_id' => 'marcus.kim',
                'user_login' => 'marcuskim',
                'additions' => 28,
                'deletions' => 8,
                'changed_files' => 4,
                'comments_count' => 2,
                'review_count' => 2,
                'review_comments' => 1,
                'first_review_at' => Carbon::now()->subDays(2)->subHours(3),
                'merged_at' => Carbon::now()->subDays(1)->subHours(5),
                'created_at' => Carbon::now()->subDays(3)->subHours(1),
                'updated_at' => Carbon::now()->subDays(1)->subHours(5),
                'data_source' => 'realism_seeder',
                'team_name' => 'backend',
                'cursor_usage_detected' => false,
                'unique_reviewer_count' => 1,
                'pr_reopened_count' => 0,
            ],
            [
                'repo_name' => 'example-org/chaosmonkey-dev',
                'pr_number' => 104,
                'developer_id' => 'riley.park',
                'user_login' => 'rileypark',
                'additions' => 89,
                'deletions' => 31,
                'changed_files' => 9,
                'comments_count' => 5,
                'review_count' => 4,
                'review_comments' => 4,
                'first_review_at' => Carbon::now()->subDays(8)->subHours(4),
                'merged_at' => Carbon::now()->subDays(7)->subHours(2),
                'created_at' => Carbon::now()->subDays(9)->subHours(1),
                'updated_at' => Carbon::now()->subDays(7)->subHours(2),
                'data_source' => 'realism_seeder',
                'team_name' => 'devops',
                'cursor_usage_detected' => true,
                'unique_reviewer_count' => 2,
                'pr_reopened_count' => 1,
            ],
            [
                'repo_name' => 'local-demo/cm-activity-sim',
                'pr_number' => 105,
                'developer_id' => 'jordan.taylor',
                'user_login' => 'jordantaylor',
                'additions' => 34,
                'deletions' => 15,
                'changed_files' => 5,
                'comments_count' => 3,
                'review_count' => 2,
                'review_comments' => 2,
                'first_review_at' => Carbon::now()->subDays(1)->subHours(8),
                'merged_at' => Carbon::now()->subHours(12),
                'created_at' => Carbon::now()->subDays(2)->subHours(3),
                'updated_at' => Carbon::now()->subHours(12),
                'data_source' => 'realism_seeder',
                'team_name' => 'frontend',
                'cursor_usage_detected' => true,
                'unique_reviewer_count' => 2,
                'pr_reopened_count' => 0,
            ],
            [
                'repo_name' => 'AngryMonkeyParty/AM-Sim',
                'pr_number' => 106,
                'developer_id' => 'priya.patel',
                'user_login' => 'priyapatel',
                'additions' => 56,
                'deletions' => 19,
                'changed_files' => 7,
                'comments_count' => 4,
                'review_count' => 3,
                'review_comments' => 3,
                'first_review_at' => Carbon::now()->subDays(4)->subHours(7),
                'merged_at' => Carbon::now()->subDays(3)->subHours(9),
                'created_at' => Carbon::now()->subDays(5)->subHours(2),
                'updated_at' => Carbon::now()->subDays(3)->subHours(9),
                'data_source' => 'realism_seeder',
                'team_name' => 'backend',
                'cursor_usage_detected' => false,
                'unique_reviewer_count' => 3,
                'pr_reopened_count' => 0,
            ],
            [
                'repo_name' => 'example-org/chaosmonkey',
                'pr_number' => 107,
                'developer_id' => 'chris.walker',
                'user_login' => 'chriswalker',
                'additions' => 41,
                'deletions' => 11,
                'changed_files' => 6,
                'comments_count' => 2,
                'review_count' => 2,
                'review_comments' => 1,
                'first_review_at' => Carbon::now()->subHours(18),
                'merged_at' => Carbon::now()->subHours(8),
                'created_at' => Carbon::now()->subHours(22),
                'updated_at' => Carbon::now()->subHours(8),
                'data_source' => 'realism_seeder',
                'team_name' => 'frontend',
                'cursor_usage_detected' => true,
                'unique_reviewer_count' => 2,
                'pr_reopened_count' => 0,
            ],
            [
                'repo_name' => 'example-org/chaosmonkey-dev',
                'pr_number' => 108,
                'developer_id' => 'alex.chen',
                'user_login' => 'alexchen',
                'additions' => 73,
                'deletions' => 27,
                'changed_files' => 8,
                'comments_count' => 5,
                'review_count' => 4,
                'review_comments' => 4,
                'first_review_at' => Carbon::now()->subDays(6)->subHours(3),
                'merged_at' => Carbon::now()->subDays(5)->subHours(7),
                'created_at' => Carbon::now()->subDays(7)->subHours(1),
                'updated_at' => Carbon::now()->subDays(5)->subHours(7),
                'data_source' => 'realism_seeder',
                'team_name' => 'devops',
                'cursor_usage_detected' => true,
                'unique_reviewer_count' => 3,
                'pr_reopened_count' => 0,
            ],
            [
                'repo_name' => 'AngryMonkeyParty/AM-Sim',
                'pr_number' => 109,
                'developer_id' => 'sarah.rodriguez',
                'user_login' => 'sarahrodriguez',
                'additions' => 22,
                'deletions' => 6,
                'changed_files' => 3,
                'comments_count' => 1,
                'review_count' => 1,
                'review_comments' => 1,
                'first_review_at' => Carbon::now()->subHours(15),
                'merged_at' => Carbon::now()->subHours(6),
                'created_at' => Carbon::now()->subHours(20),
                'updated_at' => Carbon::now()->subHours(6),
                'data_source' => 'realism_seeder',
                'team_name' => 'backend',
                'cursor_usage_detected' => false,
                'unique_reviewer_count' => 1,
                'pr_reopened_count' => 0,
            ],
            [
                'repo_name' => 'local-demo/cm-activity-sim',
                'pr_number' => 110,
                'developer_id' => 'marcus.kim',
                'user_login' => 'marcuskim',
                'additions' => 95,
                'deletions' => 38,
                'changed_files' => 10,
                'comments_count' => 6,
                'review_count' => 5,
                'review_comments' => 4,
                'first_review_at' => Carbon::now()->subDays(10)->subHours(5),
                'merged_at' => Carbon::now()->subDays(9)->subHours(8),
                'created_at' => Carbon::now()->subDays(11)->subHours(2),
                'updated_at' => Carbon::now()->subDays(9)->subHours(8),
                'data_source' => 'realism_seeder',
                'team_name' => 'frontend',
                'cursor_usage_detected' => true,
                'unique_reviewer_count' => 4,
                'pr_reopened_count' => 1,
            ],
        ];
        
        foreach ($mediumPRs as $pr) {
            DB::table('pull_requests')->insert($pr);
        }
        
        Log::info('[GITHUB_REALISM_SEEDER] Created ' . count($mediumPRs) . ' medium PRs');
    }
    
    private function seedDeveloperAttribution(): void
    {
        // Update existing PRs with varied developer attribution for realism
        $updates = [
            ['developer_id' => 'alex.chen', 'user_login' => 'alexchen', 'team_name' => 'backend'],
            ['developer_id' => 'sarah.rodriguez', 'user_login' => 'sarahrodriguez', 'team_name' => 'frontend'],
            ['developer_id' => 'marcus.kim', 'user_login' => 'marcuskim', 'team_name' => 'devops'],
            ['developer_id' => 'riley.park', 'user_login' => 'rileypark', 'team_name' => 'frontend'],
            ['developer_id' => 'jordan.taylor', 'user_login' => 'jordantaylor', 'team_name' => 'backend'],
            ['developer_id' => 'priya.patel', 'user_login' => 'priyapatel', 'team_name' => 'devops'],
            ['developer_id' => 'chris.walker', 'user_login' => 'chriswalker', 'team_name' => 'frontend'],
        ];
        
        // Update some existing PRs with varied developers
        DB::table('pull_requests')
            ->where('developer_id', 'octo-user')
            ->limit(15)
            ->inRandomOrder()
            ->update([
                'developer_id' => DB::raw("CASE 
                    WHEN id % 7 = 0 THEN 'alex.chen'
                    WHEN id % 7 = 1 THEN 'sarah.rodriguez'
                    WHEN id % 7 = 2 THEN 'marcus.kim'
                    WHEN id % 7 = 3 THEN 'riley.park'
                    WHEN id % 7 = 4 THEN 'jordan.taylor'
                    WHEN id % 7 = 5 THEN 'priya.patel'
                    ELSE 'chris.walker'
                END"),
                'user_login' => DB::raw("CASE 
                    WHEN id % 7 = 0 THEN 'alexchen'
                    WHEN id % 7 = 1 THEN 'sarahrodriguez'
                    WHEN id % 7 = 2 THEN 'marcuskim'
                    WHEN id % 7 = 3 THEN 'rileypark'
                    WHEN id % 7 = 4 THEN 'jordantaylor'
                    WHEN id % 7 = 5 THEN 'priyapatel'
                    ELSE 'chriswalker'
                END"),
                'team_name' => DB::raw("CASE 
                    WHEN id % 7 IN (0, 3, 4) THEN 'backend'
                    WHEN id % 7 IN (1, 5, 6) THEN 'frontend'
                    ELSE 'devops'
                END"),
                'updated_at' => now()
            ]);
        
        Log::info('[GITHUB_REALISM_SEEDER] Updated existing PRs with multi-developer attribution');
    }
    
    private function seedReviewerIdentities(): void
    {
        // Update PRs with varied reviewer counts for realism
        DB::table('pull_requests')
            ->where('unique_reviewer_count', 1)
            ->limit(20)
            ->inRandomOrder()
            ->update([
                'unique_reviewer_count' => DB::raw("CASE 
                    WHEN id % 5 = 0 THEN 1
                    WHEN id % 5 = 1 THEN 3
                    WHEN id % 5 = 2 THEN 2
                    WHEN id % 5 = 3 THEN 4
                    ELSE 2
                END"),
                'review_count' => DB::raw("review_count + ABS(RANDOM() % 3)"),
                'review_comments' => DB::raw("review_comments + ABS(RANDOM() % 2)"),
                'updated_at' => now()
            ]);
        
        Log::info('[GITHUB_REALISM_SEEDER] Updated PRs with varied reviewer identities');
    }
    
    private function seedReopenedPRs(): void
    {
        // Mark 2-4 PRs as reopened, concentrating around larger PRs
        DB::table('pull_requests')
            ->where('pr_reopened_count', 0)
            ->where(function($query) {
                $query->where('additions', '>', 50)
                      ->orWhere('changed_files', '>', 7);
            })
            ->limit(3)
            ->inRandomOrder()
            ->update([
                'pr_reopened_count' => 1,
                'updated_at' => now()
            ]);
        
        Log::info('[GITHUB_REALISM_SEEDER] Marked PRs as reopened');
    }
    
    private function seedDeploymentVolatility(): void
    {
        // Add a rollback deployment
        DB::table('deployments')->insert([
            'repo_name' => 'example-org/chaosmonkey',
            'environment' => 'production',
            'deployment_status' => 'success',
            'deployed_at' => Carbon::now()->subDays(1)->subHours(3),
            'sha' => 'rollback_' . substr(md5(microtime()), 0, 8),
            'rollback_detected' => true,
            'metadata' => json_encode([
                'type' => 'rollback',
                'reason' => 'hotfix_rollback',
                'previous_sha' => 'abc123def456'
            ]),
            'created_at' => Carbon::now()->subDays(1)->subHours(3),
            'updated_at' => Carbon::now()->subDays(1)->subHours(3),
        ]);
        
        // Add a failed deployment cluster
        $failedDeployments = [
            [
                'repo_name' => 'AngryMonkeyParty/AM-Sim',
                'environment' => 'staging',
                'deployment_status' => 'failure',
                'deployed_at' => Carbon::now()->subDays(2)->subHours(1),
                'sha' => 'fail_' . substr(md5(microtime()), 0, 8),
                'rollback_detected' => false,
                'metadata' => json_encode([
                    'type' => 'failure',
                    'reason' => 'test_failure'
                ]),
                'created_at' => Carbon::now()->subDays(2)->subHours(1),
                'updated_at' => Carbon::now()->subDays(2)->subHours(1),
            ],
            [
                'repo_name' => 'AngryMonkeyParty/AM-Sim',
                'environment' => 'staging',
                'deployment_status' => 'failure',
                'deployed_at' => Carbon::now()->subDays(2)->subHours(3),
                'sha' => 'fail_' . substr(md5(microtime()), 0, 8),
                'rollback_detected' => false,
                'metadata' => json_encode([
                    'type' => 'failure',
                    'reason' => 'config_error'
                ]),
                'created_at' => Carbon::now()->subDays(2)->subHours(3),
                'updated_at' => Carbon::now()->subDays(2)->subHours(3),
            ],
        ];
        
        foreach ($failedDeployments as $deployment) {
            DB::table('deployments')->insert($deployment);
        }
        
        // Add a hotfix deployment sequence
        DB::table('deployments')->insert([
            'repo_name' => 'example-org/chaosmonkey-dev',
            'environment' => 'production',
            'deployment_status' => 'success',
            'deployed_at' => Carbon::now()->subHours(6),
            'sha' => 'hotfix_' . substr(md5(microtime()), 0, 8),
            'rollback_detected' => false,
            'metadata' => json_encode([
                'type' => 'hotfix',
                'reason' => 'critical_bug_fix'
            ]),
            'created_at' => Carbon::now()->subHours(6),
            'updated_at' => Carbon::now()->subHours(6),
        ]);
        
        Log::info('[GITHUB_REALISM_SEEDER] Added deployment volatility patterns');
    }

    private function sanitizeReviewMetrics(): void
    {
        // Normalize any accidental review metric outliers produced by SQLite RANDOM() expressions
        DB::table('pull_requests')
            ->where(function ($query) {
                $query->where('review_count', '<=', 0)
                      ->orWhere('review_count', '>', 20)
                      ->orWhere('review_comments', '<', 0)
                      ->orWhere('review_comments', '>', 20);
            })
            ->update([
                'review_count' => DB::raw("CAST(ABS(review_count) AS INTEGER) % 5 + 2"),
                'review_comments' => DB::raw("CAST(ABS(review_comments) AS INTEGER) % 8 + 1"),
                'updated_at' => now()
            ]);

        Log::info('[GITHUB_REALISM_SEEDER] Sanitized review metrics for realism');
    }
}
