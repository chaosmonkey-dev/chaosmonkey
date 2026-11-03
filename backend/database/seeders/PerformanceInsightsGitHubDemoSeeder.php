<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Models\User;
use App\Models\Organization;
use Carbon\Carbon;

class PerformanceInsightsGitHubDemoSeeder extends Seeder
{
    /**
     * PR and deployment patterns aligned with IDE performance characteristics
     * ENHANCED: Multiple periods, tool-level deltas, AI vs non-AI attribution
     */
    public function run(): void
    {
        Log::info('Starting Performance Insights GitHub Demo Data Seeding (ENHANCED)');

        // Use existing organization (ID 7)
        $org = Organization::find(7);
        if (!$org) {
            Log::error('Organization with ID 7 not found');
            return;
        }

        // Get demo users by IDE type
        $cursorUsers = User::where('email', 'like', 'demo-cursor-%')->get();
        $windsurfUsers = User::where('email', 'like', 'demo-windsurf-%')->get();
        $vscodeUsers = User::where('email', 'like', 'demo-vscode-%')->get();

        // Create reviewer users for uneven distribution
        $reviewerUsers = $this->createReviewerUsers($org);

        // Seed multiple periods (4 weeks) with increasing complexity
        $this->seedMultiPeriodData($cursorUsers, $windsurfUsers, $vscodeUsers, $reviewerUsers);

        Log::info('Performance Insights GitHub Demo Data Seeding Complete (ENHANCED)');
    }

    /**
     * Seed data across multiple periods to create historical deltas
     */
    private function seedMultiPeriodData($cursorUsers, $windsurfUsers, $vscodeUsers, $reviewerUsers): void
    {
        // Period 1: 28 days ago (week 1)
        $this->seedPeriod('week-1', Carbon::now()->subDays(28), $cursorUsers, 'cursor', 35, $reviewerUsers);
        $this->seedPeriod('week-1', Carbon::now()->subDays(28), $windsurfUsers, 'windsurf', 25, $reviewerUsers);
        $this->seedPeriod('week-1', Carbon::now()->subDays(28), $vscodeUsers, 'vscode', 20, $reviewerUsers);
        
        // Deployments for week 1
        $this->seedDeploymentsPeriod('week-1', Carbon::now()->subDays(28), $cursorUsers, 'cursor', 42);
        $this->seedDeploymentsPeriod('week-1', Carbon::now()->subDays(28), $windsurfUsers, 'windsurf', 32);
        $this->seedDeploymentsPeriod('week-1', Carbon::now()->subDays(28), $vscodeUsers, 'vscode', 28);

        // Period 2: 21 days ago (week 2) - slight increase
        $this->seedPeriod('week-2', Carbon::now()->subDays(21), $cursorUsers, 'cursor', 40, $reviewerUsers);
        $this->seedPeriod('week-2', Carbon::now()->subDays(21), $windsurfUsers, 'windsurf', 30, $reviewerUsers);
        $this->seedPeriod('week-2', Carbon::now()->subDays(21), $vscodeUsers, 'vscode', 22, $reviewerUsers);
        
        $this->seedDeploymentsPeriod('week-2', Carbon::now()->subDays(21), $cursorUsers, 'cursor', 48);
        $this->seedDeploymentsPeriod('week-2', Carbon::now()->subDays(21), $windsurfUsers, 'windsurf', 38);
        $this->seedDeploymentsPeriod('week-2', Carbon::now()->subDays(21), $vscodeUsers, 'vscode', 32);

        // Period 3: 14 days ago (week 3) - more increase
        $this->seedPeriod('week-3', Carbon::now()->subDays(14), $cursorUsers, 'cursor', 48, $reviewerUsers);
        $this->seedPeriod('week-3', Carbon::now()->subDays(14), $windsurfUsers, 'windsurf', 42, $reviewerUsers);
        $this->seedPeriod('week-3', Carbon::now()->subDays(14), $vscodeUsers, 'vscode', 28, $reviewerUsers);
        
        $this->seedDeploymentsPeriod('week-3', Carbon::now()->subDays(14), $cursorUsers, 'cursor', 52);
        $this->seedDeploymentsPeriod('week-3', Carbon::now()->subDays(14), $windsurfUsers, 'windsurf', 45);
        $this->seedDeploymentsPeriod('week-3', Carbon::now()->subDays(14), $vscodeUsers, 'vscode', 35);

        // Period 4: Recent (0-7 days) - highest
        $this->seedPeriod('week-4', Carbon::now()->subDays(7), $cursorUsers, 'cursor', 55, $reviewerUsers);
        $this->seedPeriod('week-4', Carbon::now()->subDays(7), $windsurfUsers, 'windsurf', 50, $reviewerUsers);
        $this->seedPeriod('week-4', Carbon::now()->subDays(7), $vscodeUsers, 'vscode', 35, $reviewerUsers);
        
        $this->seedDeploymentsPeriod('week-4', Carbon::now()->subDays(7), $cursorUsers, 'cursor', 62);
        $this->seedDeploymentsPeriod('week-4', Carbon::now()->subDays(7), $windsurfUsers, 'windsurf', 52);
        $this->seedDeploymentsPeriod('week-4', Carbon::now()->subDays(7), $vscodeUsers, 'vscode', 40);

        Log::info('Seeded 4 periods of multi-period demo data with increasing complexity');
    }

    /**
     * Seed pull requests for a specific period with IDE and AI patterns
     */
    private function seedPeriod($periodLabel, Carbon $baseDate, $users, string $tool, int $prCount, $reviewerUsers): void
    {
        $prs = [];

        for ($i = 0; $i < $prCount; $i++) {
            $user = $users->random();
            $createdDate = $baseDate->copy()->addDays(rand(0, 6))->addHours(rand(0, 23));
            $mergedDate = $createdDate->copy()->addHours($this->getMergeTimeHours($tool));

            // Determine if AI-assisted based on tool (Cursor/Windsurf = higher AI intensity)
            $aiIntensity = $this->getAIIntensity($tool);
            $isAIAssisted = rand(1, 100) <= $aiIntensity;

            $pr = [
                'repo_name' => $this->getRepository($tool, $i),
                'pr_number' => $i + 1,
                'developer_id' => $user->name,
                'user_login' => $user->name,
                'merged_at' => $mergedDate,
                'comments_count' => $this->getRealisticCommentCount($tool, $isAIAssisted),
                'review_count' => $this->getRealisticReviewCount($tool, $isAIAssisted),
                'review_comments' => $this->getRealisticReviewComments($tool, $isAIAssisted),
                'cursor_usage_detected' => $tool === 'cursor' ? 1 : 0,
                'created_at' => $createdDate,
                'updated_at' => $mergedDate,
                'first_review_at' => $createdDate->copy()->addHours(rand(1, 6)),
                'unique_reviewer_count' => $this->getRealisticReviewerCount($tool, $isAIAssisted),
                'pr_reopened_count' => $this->getReopenRate($tool, $isAIAssisted) ? 1 : 0,
                'additions' => $this->getRealisticAdditions($tool, $isAIAssisted),
                'deletions' => $this->getRealisticDeletions($tool, $isAIAssisted),
                'changed_files' => $this->getRealisticFileCount($tool, $isAIAssisted),
                'data_source' => 'demo',
                'team_name' => $this->getTeamName($tool, $i),
            ];

            $prs[] = $pr;
        }

        // Insert pull requests
        foreach (array_chunk($prs, 50) as $chunk) {
            DB::table('pull_requests')->insert($chunk);
        }

        Log::info("Seeded {$prCount} pull requests for {$tool} in {$periodLabel}");
    }

    /**
     * Seed deployments for a specific period with tool patterns
     */
    private function seedDeploymentsPeriod($periodLabel, Carbon $baseDate, $users, string $tool, int $deploymentCount): void
    {
        $deployments = [];

        for ($i = 0; $i < $deploymentCount; $i++) {
            $user = $users->random();
            $deployedAt = $baseDate->copy()->addDays(rand(0, 6))->addHours(rand(0, 23));

            $deployment = [
                'repo_name' => $this->getRepository($tool, $i),
                'environment' => 'production',
                'deployment_status' => $this->getDeploymentState($tool),
                'deployed_at' => $deployedAt,
                'sha' => $this->generateCommitSHA(),
                'rollback_detected' => 0,
                'metadata' => json_encode([
                    'creator_login' => $user->name,
                    'creator_name' => $user->name,
                    'creator_email' => $user->email,
                    'description' => $this->generateDeploymentDescription($tool),
                    'data_source' => 'demo',
                    'team_name' => $this->getTeamName($tool, $i),
                    'period_label' => $periodLabel,
                ]),
                'created_at' => $deployedAt,
                'updated_at' => $deployedAt,
            ];

            $deployments[] = $deployment;
        }

        // Insert deployments
        foreach (array_chunk($deployments, 50) as $chunk) {
            DB::table('deployments')->insert($chunk);
        }

        Log::info("Seeded {$deploymentCount} deployments for {$tool} in {$periodLabel}");
    }

    /**
     * Get AI intensity by tool (percentage of PRs that are AI-assisted)
     */
    private function getAIIntensity(string $tool): int
    {
        switch ($tool) {
            case 'cursor':
            case 'demo-cursor':
                return 75; // 75% of Cursor PRs are AI-assisted
            case 'windsurf':
            case 'demo-windsurf':
                return 65; // 65% of Windsurf PRs are AI-assisted
            case 'vscode':
            case 'demo-vscode':
                return 15; // 15% of VS Code PRs are AI-assisted (manual focus)
            default:
                return 40;
        }
    }

    /**
     * Get IDE-specific merge time in hours
     */
    private function getMergeTimeHours(string $tool): int
    {
        switch ($tool) {
            case 'cursor':
            case 'demo-cursor':
                return rand(6, 12); // 6-12 hours (fast)
            case 'windsurf':
            case 'demo-windsurf':
                return rand(12, 24); // 12-24 hours (moderate)
            case 'vscode':
            case 'demo-vscode':
                return rand(24, 48); // 24-48 hours (slow)
            default:
                return rand(6, 12);
        }
    }

    /**
     * Get IDE-specific PR size characteristics
     */
    private function getPRSize(string $tool, string $metric): int
    {
        switch ($tool) {
            case 'cursor':
            case 'demo-cursor':
                // Smaller, focused PRs
                switch ($metric) {
                    case 'additions': return rand(20, 400);
                    case 'deletions': return rand(5, 150);
                    case 'files': return rand(1, 12);
                }
                break;
            case 'windsurf':
                // Moderate to larger PRs (Windsurf is 22% larger than Cursor)
                switch ($metric) {
                    case 'additions': return rand(120, 480);
                    case 'deletions': return rand(20, 180);
                    case 'files': return rand(5, 15);
                }
                break;
            case 'vscode':
                // Larger PRs
                switch ($metric) {
                    case 'additions': return rand(200, 500);
                    case 'deletions': return rand(40, 200);
                    case 'files': return rand(10, 20);
                }
                break;
        }
        return 100;
    }

    /**
     * Get IDE-specific file count per PR
     */
    private function getRealisticFileCount(string $tool, bool $isAIAssisted): int
    {
        $baseRange = match($tool) {
            'cursor', 'demo-cursor' => [1, 8],
            'windsurf', 'demo-windsurf' => [4, 12],
            'vscode', 'demo-vscode' => [8, 18],
            default => [3, 10]
        };

        if ($isAIAssisted) {
            $baseRange[1] = max($baseRange[0], (int)($baseRange[1] * 0.85));
        }

        return rand($baseRange[0], $baseRange[1]);
    }

    /**
     * Generate a realistic commit SHA for deployments
     */
    private function generateCommitSHA(): string
    {
        return substr(sha1(uniqid((string)mt_rand(), true)), 0, 40);
    }

    /**
     * Get IDE-specific commit count per PR
     */
    private function getCommitCount(string $tool): int
    {
        switch ($tool) {
            case 'cursor':
                return rand(2, 5);
            case 'windsurf':
                return rand(4, 8);
            case 'vscode':
                return rand(6, 12);
            default:
                return rand(4, 8);
        }
    }

    /**
     * Get IDE-specific review cycles (comments count)
     */
    private function getReviewCycles(string $tool): int
    {
        switch ($tool) {
            case 'cursor':
                return rand(1, 4);
            case 'windsurf':
                return rand(4, 9);
            case 'vscode':
                return rand(8, 16);
            default:
                return rand(4, 8);
        }
    }

    /**
     * Get IDE-specific reopen rate (boolean) - ENHANCED with AI factor
     */
    private function getReopenRate(string $tool, bool $isAIAssisted): bool
    {
        $baseRate = match($tool) {
            'cursor', 'demo-cursor' => 10,
            'windsurf', 'demo-windsurf' => 20,
            'vscode', 'demo-vscode' => 35,
            default => 20
        };

        // AI-assisted PRs have lower reopen rate
        $adjustedRate = $isAIAssisted ? $baseRate * 0.7 : $baseRate;
        return rand(1, 100) <= $adjustedRate;
    }

    /**
     * Get IDE-specific deployment state
     */
    private function getDeploymentState(string $tool): string
    {
        switch ($tool) {
            case 'cursor':
            case 'demo-cursor':
                return rand(1, 100) <= 92 ? 'success' : 'failure'; // 8% failure rate
            case 'windsurf':
            case 'demo-windsurf':
                return rand(1, 100) <= 84 ? 'success' : 'failure'; // 16% failure rate
            case 'vscode':
            case 'demo-vscode':
                return rand(1, 100) <= 68 ? 'success' : 'failure'; // 32% failure rate
            default:
                return 'success';
        }
    }

    /**
     * Generate PR title based on IDE patterns
     */
    private function generatePRTitle(string $tool, int $index): string
    {
        $features = [
            'User Authentication Enhancement',
            'Payment Gateway Integration',
            'Dashboard UI Improvements',
            'API Performance Optimization',
            'Mobile Responsive Design',
            'Security Vulnerability Fix',
            'Database Migration Script',
            'Search Functionality Update',
            'File Upload System',
            'Email Notification Service'
        ];

        $prefix = $tool === 'cursor' ? '[AI-Assisted] ' : 
                  ($tool === 'windsurf' ? '[Feature] ' : '[Update] ');

        return $prefix . $features[$index % count($features)];
    }

    /**
     * Generate PR body based on IDE characteristics
     */
    private function generatePRBody(string $tool): string
    {
        switch ($tool) {
            case 'cursor':
            case 'demo-cursor':
                return "This PR implements the feature with AI assistance. Code has been reviewed and tested. Changes are focused and minimal.";
            case 'windsurf':
            case 'demo-windsurf':
                return "This PR adds the requested functionality with moderate scope. Includes tests and documentation updates.";
            case 'vscode':
            case 'demo-vscode':
                return "This PR contains comprehensive changes for the feature. Includes multiple components and extensive testing.";
            default:
                return "Standard pull request with feature implementation.";
        }
    }

    /**
     * Generate repository name
     */
    private function getRepository(string $tool, int $index): string
    {
        return "demo-org/" . self::REPOSITORIES[$index % count(self::REPOSITORIES)];
    }

    /**
     * Demo repositories for consistent linking
     */
    private const REPOSITORIES = [
        'frontend-app',
        'backend-api',
        'mobile-app',
        'devops-infra',
        'data-platform'
    ];

    /**
     * Demo features for branch naming
     */
    private const FEATURES = [
        'auth', 'payment', 'dashboard', 'api', 'mobile',
        'security', 'database', 'search', 'upload', 'email'
    ];

    /**
     * Generate branch name
     */
    private function generateBranchName(string $tool, int $index): string
    {
        $prefix = $tool === 'demo-cursor' ? 'feature/ai-' : 
                  ($tool === 'demo-windsurf' ? 'feature/ws-' : 'feature/vs-');
        
        return $prefix . self::FEATURES[$index % count(self::FEATURES)] . '-' . $index;
    }

    /**
     * Generate review events for PR
     */
    private function generateReviewEvents(array $pr, string $tool, User $user): array
    {
        $events = [];
        $reviewCount = $this->getReviewCycles($tool);

        for ($i = 0; $i < $reviewCount; $i++) {
            $events[] = [
                'pull_request_id' => $pr['github_id'],
                'user_id' => $user->id,
                'body' => $this->generateReviewComment($tool, $i),
                'state' => 'APPROVED',
                'created_at' => Carbon::parse($pr['created_at'])->addHours($i + 1),
                'updated_at' => Carbon::parse($pr['created_at'])->addHours($i + 1),
            ];
        }

        return $events;
    }

    /**
     * Generate review comment based on IDE characteristics
     */
    private function generateReviewComment(string $tool, int $reviewIndex): string
    {
        switch ($tool) {
            case 'cursor':
            case 'demo-cursor':
                return $reviewIndex === 0 ? "Looks good, AI-assisted code is clean." : "Approved for merge.";
            case 'windsurf':
            case 'demo-windsurf':
                return $reviewIndex === 0 ? "Good implementation, minor suggestions." : "Addressed feedback, approved.";
            case 'vscode':
            case 'demo-vscode':
                return $reviewIndex === 0 ? "Extensive changes, needs careful review." : "After several iterations, approved.";
            default:
                return "Review comment.";
        }
    }

    /**
     * Generate deployment description
     */
    private function generateDeploymentDescription(string $tool): string
    {
        switch ($tool) {
            case 'cursor':
            case 'demo-cursor':
                return "Automated deployment from AI-assisted feature branch";
            case 'windsurf':
            case 'demo-windsurf':
                return "Standard deployment from feature branch";
            case 'vscode':
            case 'demo-vscode':
                return "Manual deployment after extensive testing";
            default:
                return "Deployment";
        }
    }

    /**
     * Get realistic comment count by tool - ENHANCED with AI factor
     */
    private function getRealisticCommentCount(string $tool, bool $isAIAssisted): int
    {
        $baseRange = match($tool) {
            'cursor', 'demo-cursor' => [2, 12],
            'windsurf', 'demo-windsurf' => [5, 15],
            'vscode', 'demo-vscode' => [8, 20],
            default => [5, 10]
        };

        // AI-assisted PRs have fewer comments
        if ($isAIAssisted) {
            $baseRange[1] = (int)($baseRange[1] * 0.8);
        }

        return rand($baseRange[0], $baseRange[1]);
    }

    /**
     * Get realistic review count by tool - ENHANCED with AI factor
     */
    private function getRealisticReviewCount(string $tool, bool $isAIAssisted): int
    {
        $baseRange = match($tool) {
            'cursor', 'demo-cursor' => [2, 6],
            'windsurf', 'demo-windsurf' => [4, 10],
            'vscode', 'demo-vscode' => [6, 15],
            default => [4, 8]
        };

        // AI-assisted PRs have fewer reviews
        if ($isAIAssisted) {
            $baseRange[1] = (int)($baseRange[1] * 0.8);
        }

        return rand($baseRange[0], $baseRange[1]);
    }

    /**
     * Get realistic reviewer count by tool - ENHANCED with AI factor
     */
    private function getRealisticReviewerCount(string $tool, bool $isAIAssisted): int
    {
        $baseRange = match($tool) {
            'cursor', 'demo-cursor' => [1, 3],
            'windsurf', 'demo-windsurf' => [2, 4],
            'vscode', 'demo-vscode' => [3, 6],
            default => [2, 4]
        };

        // AI-assisted PRs have fewer reviewers
        if ($isAIAssisted) {
            $baseRange[1] = (int)($baseRange[1] * 0.8);
        }

        return rand($baseRange[0], $baseRange[1]);
    }

    /**
     * Get realistic review comments by tool - ENHANCED with AI factor
     */
    private function getRealisticReviewComments(string $tool, bool $isAIAssisted): int
    {
        $baseRange = match($tool) {
            'cursor', 'demo-cursor' => [1, 4],
            'windsurf', 'demo-windsurf' => [3, 8],
            'vscode', 'demo-vscode' => [5, 15],
            default => [3, 8]
        };

        // AI-assisted PRs have fewer review comments
        if ($isAIAssisted) {
            $baseRange[1] = (int)($baseRange[1] * 0.8);
        }

        return rand($baseRange[0], $baseRange[1]);
    }

    /**
     * Get team name by tool and index
     */
    private function getTeamName(string $tool, int $index): string
    {
        $teams = ['Platform Team', 'Web Team', 'Legacy Team'];
        
        switch ($tool) {
            case 'cursor':
            case 'demo-cursor':
                return $teams[0];
            case 'windsurf':
            case 'demo-windsurf':
                return $teams[1];
            case 'vscode':
            case 'demo-vscode':
                return $teams[2];
            default:
                return $teams[$index % 3];
        }
    }

    /**
     * Get assigned reviewers with uneven distribution
     */
    private function getAssignedReviewers(string $tool, array $reviewerUsers): string
    {
        $reviewerCount = $this->getRealisticReviewerCount($tool, false);
        
        // Create uneven distribution: some reviewers are overloaded
        $weightedReviewers = [];
        
        // First 3 reviewers get 60% of the load (overloaded)
        for ($i = 0; $i < 3 && $i < count($reviewerUsers); $i++) {
            for ($j = 0; $j < 6; $j++) {
                $weightedReviewers[] = $reviewerUsers[$i]->name;
            }
        }
        
        // Remaining reviewers get 40% of the load (lighter)
        for ($i = 3; $i < count($reviewerUsers); $i++) {
            for ($j = 0; $j < 2; $j++) {
                $weightedReviewers[] = $reviewerUsers[$i]->name;
            }
        }
        
        // Randomly select reviewers
        $selectedReviewers = [];
        for ($i = 0; $i < $reviewerCount && !empty($weightedReviewers); $i++) {
            $index = array_rand($weightedReviewers);
            $selectedReviewers[] = $weightedReviewers[$index];
            unset($weightedReviewers[$index]);
        }
        
        return implode(', ', array_unique($selectedReviewers));
    }

    /**
     * Get realistic additions by tool - ENHANCED with AI factor
     */
    private function getRealisticAdditions(string $tool, bool $isAIAssisted): int
    {
        $baseRange = match($tool) {
            'cursor', 'demo-cursor' => [20, 120],
            'windsurf', 'demo-windsurf' => [100, 300],  // 22% larger than Cursor
            'vscode', 'demo-vscode' => [150, 500],
            default => [50, 200]
        };

        // AI-assisted PRs slightly smaller/focused
        if ($isAIAssisted) {
            $baseRange[1] = (int)($baseRange[1] * 0.85);
        }

        return rand($baseRange[0], $baseRange[1]);
    }

    /**
     * Get realistic deletions by tool - ENHANCED with AI factor
     */
    private function getRealisticDeletions(string $tool, bool $isAIAssisted): int
    {
        $baseRange = match($tool) {
            'cursor', 'demo-cursor' => [5, 40],
            'windsurf', 'demo-windsurf' => [15, 100],
            'vscode', 'demo-vscode' => [30, 200],
            default => [10, 50]
        };

        // AI-assisted PRs slightly fewer deletions
        if ($isAIAssisted) {
            $baseRange[1] = (int)($baseRange[1] * 0.85);
        }

        return rand($baseRange[0], $baseRange[1]);
    }

    /**
     * Create reviewer users with uneven distribution
     */
    private function createReviewerUsers(Organization $org): array
    {
        $reviewerNames = [
            'Alice Chen', 'Bob Smith', 'Carol Davis', 'David Wilson',
            'Eve Johnson', 'Frank Miller', 'Grace Lee', 'Henry Brown'
        ];
        
        $reviewerUsers = [];
        
        foreach ($reviewerNames as $index => $name) {
            $githubId = 'reviewer_' . strtolower(str_replace(' ', '_', $name));
            $email = 'reviewer-' . strtolower(str_replace(' ', '_', $name)) . '@demo-org.com';
            
            // Check if user already exists
            $user = User::where('github_id', $githubId)->first();
            
            if (!$user) {
                $user = new User([
                    'github_id' => $githubId,
                    'name' => $name,
                    'email' => $email,
                    'password' => bcrypt('demo123456'),
                    'organization_id' => $org->id
                ]);
                
                $user->save();
                Log::info("Created reviewer user: {$name}");
            } else {
                Log::info("Reviewer user already exists: {$name}");
            }
            
            $reviewerUsers[] = $user;
        }
        
        Log::info("Retrieved " . count($reviewerUsers) . " reviewer users");
        return $reviewerUsers;
    }

}