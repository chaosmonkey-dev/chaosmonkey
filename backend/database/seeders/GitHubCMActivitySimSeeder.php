<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class GitHubCMActivitySimSeeder extends Seeder
{
    /**
     * Run database seeds.
     * Adds simulated PRs from cm-activity-sim starting at PR #186
     * Date: June 22, 2026
     */
    public function run(): void
    {
        Log::info('[CM_ACTIVITY_SIM_SEEDER] Starting CM Activity Sim PR seeding');
        
        $repoName = 'mattmcclintock/cm-activity-sim';
        // Use base date of June 20 to ensure all PRs are <= now (June 22)
        // Latest PR will be at hour 63 from base, which is June 22 15:00
        $baseDate = Carbon::parse('2026-06-20');
        
        $prs = [];
        $prNumber = 186;
        
        // Clean small merged PRs (PRs 186-190)
        for ($i = 0; $i < 5; $i++) {
            $createdAt = $baseDate->copy()->addHours($i * 2);
            $mergedAt = $createdAt->copy()->addHours(rand(2, 4));
            
            $prs[] = [
                'repo_name' => $repoName,
                'pr_number' => $prNumber++,
                'developer_id' => 'dev_' . ($i % 3),
                'user_login' => 'developer_' . ($i % 3),
                'additions' => rand(50, 150),
                'deletions' => rand(10, 30),
                'changed_files' => rand(3, 6),
                'comments_count' => rand(1, 3),
                'review_count' => rand(1, 2),
                'review_comments' => rand(1, 2),
                'first_review_at' => $createdAt->copy()->addHours(1),
                'merged_at' => $mergedAt,
                'created_at' => $createdAt,
                'updated_at' => $mergedAt,
                'data_source' => 'cm_activity_sim',
                'team_name' => 'frontend',
                'cursor_usage_detected' => ($i % 2 === 0),
                'unique_reviewer_count' => rand(1, 2),
                'pr_reopened_count' => 0,
            ];
        }
        
        // Baseline medium merged PRs (PRs 191-195)
        for ($i = 0; $i < 5; $i++) {
            $createdAt = $baseDate->copy()->addHours(10 + $i * 3);
            $mergedAt = $createdAt->copy()->addHours(rand(6, 12));
            
            $prs[] = [
                'repo_name' => $repoName,
                'pr_number' => $prNumber++,
                'developer_id' => 'dev_' . (($i + 1) % 4),
                'user_login' => 'developer_' . (($i + 1) % 4),
                'additions' => rand(200, 500),
                'deletions' => rand(50, 100),
                'changed_files' => rand(7, 12),
                'comments_count' => rand(3, 6),
                'review_count' => rand(2, 4),
                'review_comments' => rand(2, 4),
                'first_review_at' => $createdAt->copy()->addHours(2),
                'merged_at' => $mergedAt,
                'created_at' => $createdAt,
                'updated_at' => $mergedAt,
                'data_source' => 'cm_activity_sim',
                'team_name' => 'backend',
                'cursor_usage_detected' => ($i % 2 !== 0),
                'unique_reviewer_count' => rand(2, 3),
                'pr_reopened_count' => 0,
            ];
        }
        
        // Large-risk merged PRs (PRs 196-198)
        for ($i = 0; $i < 3; $i++) {
            $createdAt = $baseDate->copy()->addHours(25 + $i * 4);
            $mergedAt = $createdAt->copy()->addHours(rand(16, 24));
            
            $prs[] = [
                'repo_name' => $repoName,
                'pr_number' => $prNumber++,
                'developer_id' => 'senior_dev_' . $i,
                'user_login' => 'senior_' . $i,
                'additions' => rand(600, 1500),
                'deletions' => rand(100, 300),
                'changed_files' => rand(15, 25),
                'comments_count' => rand(8, 15),
                'review_count' => rand(4, 6),
                'review_comments' => rand(5, 10),
                'first_review_at' => $createdAt->copy()->addHours(4),
                'merged_at' => $mergedAt,
                'created_at' => $createdAt,
                'updated_at' => $mergedAt,
                'data_source' => 'cm_activity_sim',
                'team_name' => 'devops',
                'cursor_usage_detected' => true,
                'unique_reviewer_count' => rand(3, 4),
                'pr_reopened_count' => ($i === 1 ? 1 : 0), // One reopened
            ];
        }
        
        // Review-heavy merged PRs (PRs 199-201)
        for ($i = 0; $i < 3; $i++) {
            $createdAt = $baseDate->copy()->addHours(37 + $i * 3);
            $mergedAt = $createdAt->copy()->addHours(rand(12, 20));
            
            $prs[] = [
                'repo_name' => $repoName,
                'pr_number' => $prNumber++,
                'developer_id' => 'dev_' . (($i + 2) % 3),
                'user_login' => 'developer_' . (($i + 2) % 3),
                'additions' => rand(150, 400),
                'deletions' => rand(30, 80),
                'changed_files' => rand(8, 15),
                'comments_count' => rand(15, 25),
                'review_count' => rand(6, 10),
                'review_comments' => rand(10, 20),
                'first_review_at' => $createdAt->copy()->addHours(1),
                'merged_at' => $mergedAt,
                'created_at' => $createdAt,
                'updated_at' => $mergedAt,
                'data_source' => 'cm_activity_sim',
                'team_name' => 'frontend',
                'cursor_usage_detected' => false,
                'unique_reviewer_count' => rand(4, 5),
                'pr_reopened_count' => 0,
            ];
        }
        
        // Closed-unmerged PRs (PRs 202-204)
        for ($i = 0; $i < 3; $i++) {
            $createdAt = $baseDate->copy()->addHours(46 + $i * 2);
            $closedAt = $createdAt->copy()->addHours(rand(4, 8));
            
            $prs[] = [
                'repo_name' => $repoName,
                'pr_number' => $prNumber++,
                'developer_id' => 'dev_' . $i,
                'user_login' => 'developer_' . $i,
                'additions' => rand(100, 300),
                'deletions' => rand(20, 60),
                'changed_files' => rand(5, 10),
                'comments_count' => rand(2, 5),
                'review_count' => rand(1, 3),
                'review_comments' => rand(1, 3),
                'first_review_at' => $createdAt->copy()->addHours(1),
                'merged_at' => null, // Not merged
                'created_at' => $createdAt,
                'updated_at' => $closedAt,
                'data_source' => 'cm_activity_sim',
                'team_name' => 'backend',
                'cursor_usage_detected' => ($i % 2 === 0),
                'unique_reviewer_count' => rand(1, 2),
                'pr_reopened_count' => 0,
            ];
        }
        
        // Reopened PRs (PRs 205-206)
        for ($i = 0; $i < 2; $i++) {
            $createdAt = $baseDate->copy()->addHours(52 + $i * 3);
            $mergedAt = $createdAt->copy()->addHours(rand(20, 30));
            
            $prs[] = [
                'repo_name' => $repoName,
                'pr_number' => $prNumber++,
                'developer_id' => 'dev_' . (($i + 1) % 2),
                'user_login' => 'developer_' . (($i + 1) % 2),
                'additions' => rand(300, 600),
                'deletions' => rand(50, 120),
                'changed_files' => rand(10, 18),
                'comments_count' => rand(6, 12),
                'review_count' => rand(3, 5),
                'review_comments' => rand(4, 8),
                'first_review_at' => $createdAt->copy()->addHours(2),
                'merged_at' => $mergedAt,
                'created_at' => $createdAt,
                'updated_at' => $mergedAt,
                'data_source' => 'cm_activity_sim',
                'team_name' => 'frontend',
                'cursor_usage_detected' => true,
                'unique_reviewer_count' => rand(2, 3),
                'pr_reopened_count' => 1, // Reopened
            ];
        }
        
        // Open queue PRs (PRs 207-209)
        for ($i = 0; $i < 3; $i++) {
            $createdAt = $baseDate->copy()->addHours(58 + $i);
            
            $prs[] = [
                'repo_name' => $repoName,
                'pr_number' => $prNumber++,
                'developer_id' => 'dev_' . $i,
                'user_login' => 'developer_' . $i,
                'additions' => rand(80, 250),
                'deletions' => rand(15, 50),
                'changed_files' => rand(4, 9),
                'comments_count' => rand(1, 4),
                'review_count' => rand(0, 2),
                'review_comments' => rand(0, 2),
                'first_review_at' => null,
                'merged_at' => null, // Still open
                'created_at' => $createdAt,
                'updated_at' => $createdAt,
                'data_source' => 'cm_activity_sim',
                'team_name' => 'backend',
                'cursor_usage_detected' => ($i % 2 !== 0),
                'unique_reviewer_count' => 0,
                'pr_reopened_count' => 0,
            ];
        }
        
        // Draft PRs (PRs 210-212) - detected by 0 comments, 0 reviews, not merged
        for ($i = 0; $i < 3; $i++) {
            $createdAt = $baseDate->copy()->addHours(61 + $i);
            
            $prs[] = [
                'repo_name' => $repoName,
                'pr_number' => $prNumber++,
                'developer_id' => 'dev_' . (($i + 1) % 3),
                'user_login' => 'developer_' . (($i + 1) % 3),
                'additions' => rand(40, 120),
                'deletions' => rand(10, 30),
                'changed_files' => rand(2, 5),
                'comments_count' => 0,
                'review_count' => 0,
                'review_comments' => 0,
                'first_review_at' => null,
                'merged_at' => null, // Still draft
                'created_at' => $createdAt,
                'updated_at' => $createdAt,
                'data_source' => 'cm_activity_sim',
                'team_name' => 'frontend',
                'cursor_usage_detected' => false,
                'unique_reviewer_count' => 0,
                'pr_reopened_count' => 0,
            ];
        }
        
        // Insert all PRs
        foreach ($prs as $pr) {
            DB::table('pull_requests')->insert($pr);
        }
        
        Log::info('[CM_ACTIVITY_SIM_SEEDER] Created ' . count($prs) . ' PRs from CM Activity Sim');
        Log::info('[CM_ACTIVITY_SIM_SEEDER] PR range: 186-' . ($prNumber - 1));
        Log::info('[CM_ACTIVITY_SIM_SEEDER] Merged: ' . count(array_filter($prs, fn($p) => $p['merged_at'] !== null)));
        Log::info('[CM_ACTIVITY_SIM_SEEDER] Open: ' . count(array_filter($prs, fn($p) => $p['merged_at'] === null && $p['comments_count'] > 0)));
        Log::info('[CM_ACTIVITY_SIM_SEEDER] Draft: ' . count(array_filter($prs, fn($p) => $p['comments_count'] === 0 && $p['review_count'] === 0)));
        Log::info('[CM_ACTIVITY_SIM_SEEDER] Reopened: ' . count(array_filter($prs, fn($p) => $p['pr_reopened_count'] > 0)));
    }
}
