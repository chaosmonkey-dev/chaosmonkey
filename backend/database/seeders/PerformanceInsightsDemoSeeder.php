<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Models\TelemetryEvent;
use App\Models\User;
use App\Models\Organization;
use Carbon\Carbon;

class PerformanceInsightsDemoSeeder extends Seeder
{
    /**
     * Tool costs per developer per month
     */
    private const TOOL_COSTS = [
        'cursor' => 40.00,
        'windsurf' => 30.00,
        'vscode' => 0.00,
        'demo-cursor' => 40.00,
        'demo-windsurf' => 30.00,
        'demo-vscode' => 0.00,
    ];

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
     * Run the database seeds.
     */
    public function run(): void
    {
        Log::info('Starting Performance Insights Demo Data Seeding');

        // Update organization to Northstar Systems
        $org = Organization::find(7);
        if (!$org) {
            // Create or update organization
            $org = Organization::updateOrCreate(['id' => 7], [
                'name' => 'Northstar Systems',
                'created_at' => now(),
                'updated_at' => now()
            ]);
        }

        // Create demo users for each IDE cohort with realistic names and mixed IDE usage
        $cursorUsers = $this->createCheckoutPlatformUsers($org, 'demo-cursor');
        $windsurfUsers = $this->createGrowthEngineeringUsers($org, 'demo-windsurf');
        $vscodeUsers = $this->createDemoUsers($org, 'demo-vscode', 0);

        // Seed telemetry sessions for each IDE cohort
        $this->seedTelemetrySessions($cursorUsers, 'demo-cursor', 30);
        $this->seedTelemetrySessions($windsurfUsers, 'demo-windsurf', 30);
        $this->seedTelemetrySessions($vscodeUsers, 'demo-vscode', 30);

        // Seed GitHub data aligned with telemetry
        $this->seedGitHubData($org);

        // Update debug snapshot
        $this->updateDebugSnapshot();

        Log::info('Performance Insights Demo Data Seeding Complete');
    }

    /**
     * Create Checkout Platform users (high-performing team) with mixed IDE usage
     */
    private function createCheckoutPlatformUsers(Organization $org, string $tool, int $count): array
    {
        $users = [];
        $names = ['Sarah Chen', 'Daniel Martinez', 'Kevin Patel', 'Rachel Kim', 'Alex Thompson'];
        $ideDistribution = ['cursor', 'windsurf', 'vscode', 'cursor', 'windsurf']; // Mixed IDE usage
        
        for ($i = 0; $i < $count; $i++) {
            $assignedIDE = $ideDistribution[$i] ?? 'cursor';
            $user = new User([
                'github_id' => "checkout_platform_{$i}_" . time() . "_" . uniqid(),
                'name' => $names[$i] ?? "Checkout Platform User {$i}",
                'email' => "checkout-platform-{$i}_" . time() . "@northstar.com",
                'password' => bcrypt('demo123456'),
                'organization_id' => $org->id
            ]);
            $user->save();
            $users[] = $user;
        }
        return $users;
    }

    /**
     * Create Growth Engineering users (inefficient AI usage team) with mixed IDE usage
     */
    private function createGrowthEngineeringUsers(Organization $org, string $tool, int $count): array
    {
        $users = [];
        $names = ['Brian O\'Connor', 'Jason Miller', 'Tyler Brooks', 'Chris Walker', 'Megan Davis'];
        $ideDistribution = ['cursor', 'windsurf', 'vscode', 'cursor', 'windsurf']; // Mixed IDE usage
        
        // Select ONE developer for normalization behavior
        $normalizationIndex = 2; // Jason Miller - moderate AI, consistent PRs
        
        for ($i = 0; $i < $count; $i++) {
            // Use normalization pattern for most users, but selected variance for one
            $assignedIDE = ($i === $normalizationIndex) ? 'vscode' : $ideDistribution[$i] ?? 'cursor';
            $characteristics = ($i === $normalizationIndex) ? 
                // Jason Miller - normalized behavior
                [
                    'duration_ms' => 7200000, // 2 hours (consistent)
                    'ai_usage_duration_ms' => 600000, // 10 minutes (moderate AI)
                    'focus_ratio' => 75, // Good focus (0.75)
                    'idle_ratio' => 25, // Moderate idle (0.25)
                    'time_to_first_commit_ms' => 600000, // 10 minutes (consistent commits)
                    'session_rework_ratio_est' => 15, // Moderate rework (0.15)
                    'lines_added_total' => 120, // Moderate PRs (consistent)
                    'lines_removed_total_est' => 30, // Moderate rework (0.25)
                    'active_coding_duration_ms' => 5400000, // 90 minutes (good efficiency)
                    'ai_burst_count' => 6, // Moderate AI usage
                ] :
                // Use team characteristics for others
                $this->getIDECharacteristics('windsurf');
            
            $user = new User([
                'github_id' => "growth_engineering_{$i}_" . time() . "_" . uniqid(),
                'name' => $names[$i] ?? "Growth Engineering User {$i}",
                'email' => "growth-engineering-{$i}_" . time() . "@northstar.com",
                'password' => bcrypt('demo123456'),
                'organization_id' => $org->id
            ]);
            $user->save();
            $users[] = $user;
        }
        return $users;
    }

    /**
     * Create demo users for specific IDE (fallback for VS Code)
     */
    private function createDemoUsers(Organization $org, string $tool, int $count): array
    {
        $users = [];
        for ($i = 1; $i <= $count; $i++) {
            // Create user with unique timestamp to avoid conflicts
            $user = new User([
                'github_id' => "demo_{$tool}_user_{$i}_" . time() . "_{$i}",
                'name' => ucfirst($tool) . " Demo User {$i}",
                'email' => "demo-{$tool}-{$i}_" . time() . "@example.com",
                'password' => bcrypt('demo123456'),
                'organization_id' => $org->id
            ]);
            $user->save();
            $users[] = $user;
        }
        return $users;
    }

    /**
     * Seed telemetry sessions with IDE-specific behavior patterns
     */
    private function seedTelemetrySessions(array $users, string $tool, int $sessionCount): void
    {
        $sessions = [];
        $baseDate = Carbon::now()->subDays(30);

        for ($i = 0; $i < $sessionCount; $i++) {
            $user = $users[array_rand($users)];
            $sessionDate = $baseDate->copy()->addDays(rand(0, 29))->addHours(rand(0, 23));

            $session = $this->generateSessionData($user, $tool, $sessionDate, $i);
            $sessions[] = $session;

            // Add related events (AI accepts, commits, etc.)
            $sessions = array_merge($sessions, $this->generateSessionEvents($session, $tool));
        }

        // Insert in batches
        foreach (array_chunk($sessions, 100) as $chunk) {
            TelemetryEvent::insert($chunk);
        }

        Log::info("Seeded {$sessionCount} sessions for {$tool}");
    }

    /**
     * Generate session data based on IDE performance characteristics
     */
    private function generateSessionData(User $user, string $tool, Carbon $sessionDate, int $sessionIndex): array
    {
        $sessionId = "{$tool}_session_" . $sessionDate->timestamp . "_{$sessionIndex}";
        $repo = self::REPOSITORIES[array_rand(self::REPOSITORIES)];
        $branch = $this->generateBranchName($tool, $sessionIndex);

        // IDE-specific behavior patterns
        $characteristics = $this->getIDECharacteristics($tool);

        $sessionData = [
            'organization_id' => $user->organization->id,
            'user_id' => $user->id,
            'session_id' => $sessionId,
            'source' => 'extension',
            'editor_source' => $tool,
            'event_type' => 'session',
            'count' => 1,
            'tool_cost' => self::TOOL_COSTS[$tool],
            'duration_ms' => $characteristics['duration_ms'],
            'timestamp' => $sessionDate,
            'metadata' => json_encode([
                'segment_type' => 'session',
                'git_repo_url' => "https://github.com/demo-org/{$repo}",
                'git_branch' => $branch,
                'ai_usage_duration_ms' => $characteristics['ai_usage_duration_ms'],
                'focus_ratio' => $characteristics['focus_ratio'],
                'idle_ratio' => $characteristics['idle_ratio'],
                'time_to_first_commit_ms' => $characteristics['time_to_first_commit_ms'],
                'session_rework_ratio_est' => $characteristics['session_rework_ratio_est'],
                'lines_added_total' => $characteristics['lines_added_total'],
                'lines_removed_total_est' => $characteristics['lines_removed_total_est'],
                'active_coding_duration_ms' => $characteristics['active_coding_duration_ms'],
                'ai_burst_count' => $characteristics['ai_burst_count'],
            ]),
            'payload' => json_encode([
                'segment_type' => 'session',
                'git_repo_url' => "https://github.com/demo-org/{$repo}",
                'git_branch' => $branch,
                'ai_usage_duration_ms' => $characteristics['ai_usage_duration_ms'],
                'focus_ratio' => $characteristics['focus_ratio'],
                'idle_ratio' => $characteristics['idle_ratio'],
                'time_to_first_commit_ms' => $characteristics['time_to_first_commit_ms'],
                'session_rework_ratio_est' => $characteristics['session_rework_ratio_est'],
                'lines_added_total' => $characteristics['lines_added_total'],
                'lines_removed_total_est' => $characteristics['lines_removed_total_est'],
                'active_coding_duration_ms' => $characteristics['active_coding_duration_ms'],
                'ai_burst_count' => $characteristics['ai_burst_count'],
            ]),
            'batch_hash' => md5($sessionId . time()),
            'created_at' => now(),
            'updated_at' => now(),
        ];

        return $sessionData;
    }

    /**
     * Get IDE-specific performance characteristics based on team behavior patterns
     */
    private function getIDECharacteristics(string $tool): array
    {
        // Checkout Platform: consistent, lower idle, smaller PRs
        $checkoutCharacteristics = [
            'duration_ms' => 5400000, // 1.5 hours (consistent)
            'ai_usage_duration_ms' => 900000, // 15 minutes (moderate AI)
            'focus_ratio' => 85, // High focus (0.85)
            'idle_ratio' => 15, // Low idle (0.15)
            'time_to_first_commit_ms' => 180000, // 3 minutes (fast commits)
            'session_rework_ratio_est' => 8, // Low rework (0.08)
            'lines_added_total' => 60, // Smaller PRs (consistent)
            'lines_removed_total_est' => 12, // Low rework (0.2)
            'active_coding_duration_ms' => 4590000, // 76.5 minutes (high efficiency)
            'ai_burst_count' => 4, // Consistent AI usage
        ];

        // Growth Engineering: high idle, bursty AI, large PRs
        $growthCharacteristics = [
            'duration_ms' => 8400000, // 2.3 hours (longer sessions)
            'ai_usage_duration_ms' => 1800000, // 30 minutes (high AI)
            'focus_ratio' => 45, // Low focus (0.45)
            'idle_ratio' => 55, // High idle (0.55)
            'time_to_first_commit_ms' => 900000, // 15 minutes (slower commits)
            'session_rework_ratio_est' => 22, // High rework (0.22)
            'lines_added_total' => 180, // Large PRs (bursty)
            'lines_removed_total_est' => 45, // High rework (0.25)
            'active_coding_duration_ms' => 3780000, // 63 minutes (low efficiency)
            'ai_burst_count' => 12, // Bursty AI usage
        ];

        // Growth Engineering: high idle, bursty AI, large PRs
        $growthCharacteristics = [
            'duration_ms' => 8400000, // 2.3 hours (longer sessions)
            'ai_usage_duration_ms' => 1800000, // 30 minutes (high AI)
            'focus_ratio' => 45, // Low focus (0.45)
            'idle_ratio' => 55, // High idle (0.55)
            'time_to_first_commit_ms' => 900000, // 15 minutes (slower commits)
            'session_rework_ratio_est' => 22, // High rework (0.22)
            'lines_added_total' => 180, // Large PRs (bursty)
            'lines_removed_total_est' => 45, // High rework (0.25)
            'active_coding_duration_ms' => 3780000, // 63 minutes (low efficiency)
            'ai_burst_count' => 12, // Bursty AI usage
        ];

        // VS Code: minimal usage (fallback)
        $vscodeCharacteristics = [
            'duration_ms' => 3600000, // 1 hour (minimal)
            'ai_usage_duration_ms' => 0, // No AI usage
            'focus_ratio' => 60, // Medium focus (0.6)
            'idle_ratio' => 40, // Medium idle (0.4)
            'time_to_first_commit_ms' => 1200000, // 20 minutes (slow commits)
            'session_rework_ratio_est' => 30, // Medium rework (0.3)
            'lines_added_total' => 40, // Minimal activity
            'lines_removed_total_est' => 12, // Low rework (0.3)
            'active_coding_duration_ms' => 2160000, // 36 minutes (low efficiency)
            'ai_burst_count' => 0, // No AI usage
        ];

        switch ($tool) {
            case 'cursor':
            case 'demo-cursor':
                return $checkoutCharacteristics;
            case 'windsurf':
            case 'demo-windsurf':
                return $growthCharacteristics;
            case 'vscode':
            case 'demo-vscode':
                return $vscodeCharacteristics;
            default:
                return [
                    'duration_ms' => 7200000, // 2 hours base
                    'ai_usage_duration_ms' => 0,
                    'focus_ratio' => 0.7,
                    'idle_ratio' => 0.3,
                    'time_to_first_commit_ms' => 600000, // 10 minutes
                    'session_rework_ratio_est' => 0.2,
                    'lines_added_total' => 100,
                    'lines_removed_total_est' => 20,
                    'active_coding_duration_ms' => 5040000, // 1.4 hours
                    'ai_burst_count' => 0,
                ];
        }
    }

    /**
     * Generate related events for a session
     */
    private function generateSessionEvents(array $session, string $tool): array
    {
        $events = [];
        $characteristics = $this->getIDECharacteristics($tool);

        // AI accept events
        for ($i = 0; $i < $characteristics['ai_burst_count']; $i++) {
            $events[] = [
                'organization_id' => $session['organization_id'],
                'user_id' => $session['user_id'],
                'session_id' => $session['session_id'],
                'source' => 'extension',
                'editor_source' => $tool,
                'event_type' => 'ai_accept',
                'count' => 1,
                'tool_cost' => self::TOOL_COSTS[$tool],
                'duration_ms' => null,
                'timestamp' => Carbon::parse($session['timestamp'])->addMinutes(rand(5, 60)),
                'metadata' => json_encode([]),
                'payload' => json_encode([]),
                'batch_hash' => md5($session['session_id'] . '_ai_' . $i),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        // Commit events
        $commitCount = max(1, intval($characteristics['lines_added_total'] / 20));
        for ($i = 0; $i < $commitCount; $i++) {
            $events[] = [
                'organization_id' => $session['organization_id'],
                'user_id' => $session['user_id'],
                'session_id' => $session['session_id'],
                'source' => 'extension',
                'editor_source' => $tool,
                'event_type' => 'commit',
                'count' => 1,
                'tool_cost' => self::TOOL_COSTS[$tool],
                'duration_ms' => null,
                'timestamp' => Carbon::parse($session['timestamp'])->addMinutes(rand(10, 120)),
                'metadata' => json_encode([]),
                'payload' => json_encode([]),
                'batch_hash' => md5($session['session_id'] . '_commit_' . $i),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        return $events;
    }

    /**
     * Generate branch name based on IDE patterns
     */
    private function generateBranchName(string $tool, int $sessionIndex): string
    {
        switch ($tool) {
            case 'cursor':
                return "feature/ai-assist-" . strtolower(str_replace(' ', '-', $this->getRandomFeatureName()));
            case 'windsurf':
                return "feature/windsurf-" . $this->getRandomFeatureName();
            case 'vscode':
                return "feature/manual-" . $this->getRandomFeatureName();
            default:
                return "feature/branch-{$sessionIndex}";
        }
    }

    /**
     * Get random feature name for branches
     */
    private function getRandomFeatureName(): string
    {
        $features = [
            'User Authentication', 'Payment Processing', 'Dashboard UI', 'API Integration',
            'Mobile Responsive', 'Performance Optimization', 'Security Update', 'Bug Fix',
            'Data Migration', 'Search Functionality', 'File Upload', 'Email Notifications'
        ];
        return $features[array_rand($features)];
    }

    /**
     * Seed GitHub data (PRs and deployments) aligned with telemetry
     */
    private function seedGitHubData(Organization $org): void
    {
        // This would integrate with existing GitHub seeder
        // For now, we'll log the intent
        Log::info('GitHub data seeding should be integrated with existing GitHubDemoSeeder');
    }

    /**
     * Update debug snapshot with demo data tracking
     */
    private function updateDebugSnapshot(): void
    {
        // This will be used by frontend debug system
        Log::info('Demo data seeding completed', [
            'tool_costs' => self::TOOL_COSTS,
            'sessions_per_tool' => 30,
            'repositories' => self::REPOSITORIES,
        ]);
    }
}
