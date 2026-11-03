<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Models\TelemetryEvent;
use App\Models\User;
use App\Models\Organization;
use Carbon\Carbon;

class HeroInsightsDemoSeeder extends Seeder
{
    /**
     * Demo repositories for realistic linking
     */
    private const REPOSITORIES = [
        'frontend-app',
        'backend-api', 
        'mobile-app',
        'devops-infra',
        'data-platform',
        'auth-service',
        'payment-service'
    ];

    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        Log::info('Starting Hero Insights Demo Data Seeding - Phase 1');

        // Get or create Northstar Systems organization
        $org = Organization::find(7);
        if (!$org) {
            $org = Organization::updateOrCreate(['id' => 7], [
                'name' => 'Northstar Systems',
                'created_at' => now(),
                'updated_at' => now()
            ]);
        }

        // Create persona-based users
        $claudeCodeUsers = $this->createClaudeCodeUsers($org);
        $cursorUsers = $this->createCursorUsers($org);
        $windsurfUsers = $this->createWindsurfUsers($org);
        $vscodeUsers = $this->createVSCodeUsers($org);

        // Seed telemetry sessions for each persona
        $this->seedClaudeCodeSessions($claudeCodeUsers);
        $this->seedCursorSessions($cursorUsers);
        $this->seedWindsurfSessions($windsurfUsers);
        $this->seedVSCodeSessions($vscodeUsers);

        // Seed GitHub data aligned with telemetry patterns
        $this->seedGitHubData($org);

        Log::info('Hero Insights Demo Data Seeding Complete - Phase 1');
    }

    /**
     * Create Claude Code users (terminal-heavy architects)
     */
    private function createClaudeCodeUsers(Organization $org): array
    {
        $users = [];
        $names = ['Marcus Chen', 'Sarah Kim', 'David Rodriguez', 'Emily Zhang', 'James Wilson'];
        
        for ($i = 0; $i < 8; $i++) {
            $user = new User([
                'github_id' => "claude_code_user_{$i}_" . time() . "_" . uniqid(),
                'name' => $names[$i] ?? "Claude Code User {$i}",
                'email' => "claude-code-{$i}_" . time() . "@northstar.com",
                'password' => bcrypt('demo123456'),
                'organization_id' => $org->id
            ]);
            $user->save();
            $users[] = $user;
        }
        return $users;
    }

    /**
     * Create Cursor users (productivity-focused)
     */
    private function createCursorUsers(Organization $org): array
    {
        $users = [];
        $names = ['Alex Thompson', 'Rachel Green', 'Michael Park', 'Lisa Wang', 'Tom Anderson'];
        
        for ($i = 0; $i < 14; $i++) {
            $user = new User([
                'github_id' => "cursor_user_{$i}_" . time() . "_" . uniqid(),
                'name' => $names[$i] ?? "Cursor User {$i}",
                'email' => "cursor-{$i}_" . time() . "@northstar.com",
                'password' => bcrypt('demo123456'),
                'organization_id' => $org->id
            ]);
            $user->save();
            $users[] = $user;
        }
        return $users;
    }

    /**
     * Create Windsurf users (AI-heavy)
     */
    private function createWindsurfUsers(Organization $org): array
    {
        $users = [];
        $names = ['Brian Miller', 'Jessica Lee', 'Chris Taylor', 'Amanda Brown', 'Kevin Davis'];
        
        for ($i = 0; $i < 10; $i++) {
            $user = new User([
                'github_id' => "windsurf_user_{$i}_" . time() . "_" . uniqid(),
                'name' => $names[$i] ?? "Windsurf User {$i}",
                'email' => "windsurf-{$i}_" . time() . "@northstar.com",
                'password' => bcrypt('demo123456'),
                'organization_id' => $org->id
            ]);
            $user->save();
            $users[] = $user;
        }
        return $users;
    }

    /**
     * Create VS Code users (traditionalists)
     */
    private function createVSCodeUsers(Organization $org): array
    {
        $users = [];
        $names = ['Robert Johnson', 'Maria Garcia', 'Daniel White', 'Jennifer Martinez', 'Paul Harris'];
        
        for ($i = 0; $i < 8; $i++) {
            $user = new User([
                'github_id' => "vscode_user_{$i}_" . time() . "_" . uniqid(),
                'name' => $names[$i] ?? "VS Code User {$i}",
                'email' => "vscode-{$i}_" . time() . "@northstar.com",
                'password' => bcrypt('demo123456'),
                'organization_id' => $org->id
            ]);
            $user->save();
            $users[] = $user;
        }
        return $users;
    }

    /**
     * Seed Claude Code sessions (terminal-heavy, long sessions, larger commits)
     */
    private function seedClaudeCodeSessions(array $users): void
    {
        $sessions = [];
        $baseDate = Carbon::now()->subDays(30);

        for ($i = 0; $i < 40; $i++) {
            $user = $users[array_rand($users)];
            $sessionDate = $baseDate->copy()->addDays(rand(0, 29))->addHours(rand(0, 23));
            $sessionId = "claude_code_session_" . $sessionDate->timestamp . "_{$i}";
            $repo = self::REPOSITORIES[array_rand(self::REPOSITORIES)];

            // Claude Code characteristics: terminal-heavy, long sessions, larger commits
            $sessionData = [
                'organization_id' => $user->organization->id,
                'user_id' => $user->id,
                'session_id' => $sessionId,
                'source' => 'extension',
                'editor_source' => 'claude-code',
                'event_type' => 'session',
                'count' => 1,
                'duration_ms' => rand(150, 240) * 60 * 1000, // 150-240 minutes
                'timestamp' => $sessionDate,
                'metadata' => json_encode([
                    'segment_type' => 'session',
                    'git_repo_url' => "https://github.com/northstar/{$repo}",
                    'git_branch' => "feature/architectural-refactor-" . rand(100, 999),
                    'flow_profile' => 'terminal-heavy',
                    'session_commits' => rand(2, 4), // Fewer, larger commits
                    'time_to_first_commit_ms' => rand(15, 25) * 60 * 1000, // 15-25 minutes
                    'active_coding_duration_ms' => rand(135, 210) * 60 * 1000, // High active coding
                    'ai_burst_count' => rand(3, 8), // Low AI usage
                    'ai_intensity_band' => 'low',
                    'session_rework_ratio_est' => rand(5, 12) / 100, // 5-12% rework
                    'chars_added_total' => rand(3000, 6000), // Large changes
                    'chars_removed_total_est' => rand(600, 1200),
                    'session_prs_created' => 1, // Fewer, larger PRs
                    'session_prs_merged' => 1,
                    'session_pr_reopen_count' => rand(0, 1),
                    'session_deployment_successes' => rand(1, 2),
                ]),
                'payload' => json_encode([]),
                'batch_hash' => md5($sessionId . time()),
                'session_prs_created' => 1,
                'session_prs_merged' => 1,
                'session_pr_reopen_count' => rand(0, 1),
                'session_deployment_successes' => rand(1, 2),
                'created_at' => now(),
                'updated_at' => now(),
            ];
            $sessions[] = $sessionData;

            // Add related events separately to avoid column mismatch
            $this->generateClaudeCodeEvents($sessionData);
        }

        foreach (array_chunk($sessions, 100) as $chunk) {
            TelemetryEvent::insert($chunk);
        }

        Log::info("Seeded 40 Claude Code sessions with terminal-heavy patterns");
    }

    /**
     * Seed Cursor sessions (fastest TTFC, balanced delivery)
     */
    private function seedCursorSessions(array $users): void
    {
        $sessions = [];
        $baseDate = Carbon::now()->subDays(30);

        for ($i = 0; $i < 70; $i++) {
            $user = $users[array_rand($users)];
            $sessionDate = $baseDate->copy()->addDays(rand(0, 29))->addHours(rand(0, 23));
            $sessionId = "cursor_session_" . $sessionDate->timestamp . "_{$i}";
            $repo = self::REPOSITORIES[array_rand(self::REPOSITORIES)];

            // Cursor characteristics: fastest TTFC, balanced AI, strong commits
            $sessionData = [
                'organization_id' => $user->organization->id,
                'user_id' => $user->id,
                'session_id' => $sessionId,
                'source' => 'extension',
                'editor_source' => 'cursor',
                'event_type' => 'session',
                'count' => 1,
                'duration_ms' => rand(60, 90) * 60 * 1000, // 60-90 minutes
                'timestamp' => $sessionDate,
                'metadata' => json_encode([
                    'segment_type' => 'session',
                    'git_repo_url' => "https://github.com/northstar/{$repo}",
                    'git_branch' => "feature/ai-assist-" . strtolower(str_replace(' ', '-', $this->getRandomFeatureName())),
                    'flow_profile' => 'coding-heavy',
                    'session_commits' => rand(4, 6), // Strong commit rate
                    'time_to_first_commit_ms' => rand(8, 12) * 60 * 1000, // 8-12 minutes (FASTEST)
                    'active_coding_duration_ms' => rand(50, 75) * 60 * 1000, // Good active coding
                    'ai_burst_count' => rand(15, 25), // Medium AI usage
                    'ai_intensity_band' => 'medium',
                    'session_rework_ratio_est' => rand(8, 15) / 100, // 8-15% rework
                    'chars_added_total' => rand(1500, 3000), // Medium changes
                    'chars_removed_total_est' => rand(300, 600),
                    'session_prs_created' => rand(1, 2),
                    'session_prs_merged' => rand(1, 2),
                    'session_pr_reopen_count' => rand(0, 1),
                    'session_deployment_successes' => rand(2, 4), // High deployment success
                ]),
                'payload' => json_encode([]),
                'batch_hash' => md5($sessionId . time()),
                'session_prs_created' => rand(1, 2),
                'session_prs_merged' => rand(1, 2),
                'session_pr_reopen_count' => rand(0, 1),
                'session_deployment_successes' => rand(2, 4),
                'created_at' => now(),
                'updated_at' => now(),
            ];
            $sessions[] = $sessionData;

            // Add related events separately to avoid column mismatch
            $this->generateCursorEvents($sessionData);
        }

        foreach (array_chunk($sessions, 100) as $chunk) {
            TelemetryEvent::insert($chunk);
        }

        Log::info("Seeded 70 Cursor sessions with fastest TTFC patterns");
    }

    /**
     * Seed Windsurf sessions (highest AI adoption, smaller PRs)
     */
    private function seedWindsurfSessions(array $users): void
    {
        $sessions = [];
        $baseDate = Carbon::now()->subDays(30);

        for ($i = 0; $i < 50; $i++) {
            $user = $users[array_rand($users)];
            $sessionDate = $baseDate->copy()->addDays(rand(0, 29))->addHours(rand(0, 23));
            $sessionId = "windsurf_session_" . $sessionDate->timestamp . "_{$i}";
            $repo = self::REPOSITORIES[array_rand(self::REPOSITORIES)];

            // Windsurf characteristics: highest AI adoption, many small commits, elevated rework
            $sessionData = [
                'organization_id' => $user->organization->id,
                'user_id' => $user->id,
                'session_id' => $sessionId,
                'source' => 'extension',
                'editor_source' => 'windsurf',
                'event_type' => 'session',
                'count' => 1,
                'duration_ms' => rand(75, 120) * 60 * 1000, // 75-120 minutes
                'timestamp' => $sessionDate,
                'metadata' => json_encode([
                    'segment_type' => 'session',
                    'git_repo_url' => "https://github.com/northstar/{$repo}",
                    'git_branch' => "feature/windsurf-" . $this->getRandomFeatureName(),
                    'flow_profile' => 'mixed',
                    'session_commits' => rand(6, 10), // High commit count
                    'time_to_first_commit_ms' => rand(12, 18) * 60 * 1000, // 12-18 minutes
                    'active_coding_duration_ms' => rand(45, 80) * 60 * 1000,
                    'ai_burst_count' => rand(45, 80), // HIGHEST AI adoption
                    'ai_intensity_band' => 'high',
                    'session_rework_ratio_est' => rand(15, 25) / 100, // 15-25% rework (elevated)
                    'chars_added_total' => rand(800, 2000), // Smaller changes
                    'chars_removed_total_est' => rand(200, 500),
                    'session_prs_created' => rand(3, 6), // Many smaller PRs
                    'session_prs_merged' => rand(2, 5),
                    'session_pr_reopen_count' => rand(1, 3), // Elevated reopen pressure
                    'session_deployment_successes' => rand(3, 5), // High deployment frequency
                ]),
                'payload' => json_encode([]),
                'batch_hash' => md5($sessionId . time()),
                'session_prs_created' => rand(3, 6),
                'session_prs_merged' => rand(2, 5),
                'session_pr_reopen_count' => rand(1, 3),
                'session_deployment_successes' => rand(3, 5),
                'created_at' => now(),
                'updated_at' => now(),
            ];
            $sessions[] = $sessionData;

            // Add related events separately to avoid column mismatch
            $this->generateWindsurfEvents($sessionData);
        }

        foreach (array_chunk($sessions, 100) as $chunk) {
            TelemetryEvent::insert($chunk);
        }

        Log::info("Seeded 50 Windsurf sessions with highest AI adoption patterns");
    }

    /**
     * Seed VS Code sessions (highest focus ratio, steady delivery)
     */
    private function seedVSCodeSessions(array $users): void
    {
        $sessions = [];
        $baseDate = Carbon::now()->subDays(30);

        for ($i = 0; $i < 40; $i++) {
            $user = $users[array_rand($users)];
            $sessionDate = $baseDate->copy()->addDays(rand(0, 29))->addHours(rand(0, 23));
            $sessionId = "vscode_session_" . $sessionDate->timestamp . "_{$i}";
            $repo = self::REPOSITORIES[array_rand(self::REPOSITORIES)];

            // VS Code characteristics: highest focus ratio, steady delivery, low AI
            $sessionData = [
                'organization_id' => $user->organization->id,
                'user_id' => $user->id,
                'session_id' => $sessionId,
                'source' => 'extension',
                'editor_source' => 'vscode',
                'event_type' => 'session',
                'count' => 1,
                'duration_ms' => rand(95, 120) * 60 * 1000, // 95-120 minutes
                'timestamp' => $sessionDate,
                'metadata' => json_encode([
                    'segment_type' => 'session',
                    'git_repo_url' => "https://github.com/northstar/{$repo}",
                    'git_branch' => "feature/manual-" . $this->getRandomFeatureName(),
                    'flow_profile' => 'coding-heavy',
                    'session_commits' => rand(3, 4), // Steady commit rate
                    'time_to_first_commit_ms' => rand(18, 24) * 60 * 1000, // 18-24 minutes
                    'active_coding_duration_ms' => rand(85, 110) * 60 * 1000, // HIGHEST focus ratio
                    'ai_burst_count' => rand(3, 8), // Low AI usage
                    'ai_intensity_band' => 'low',
                    'session_rework_ratio_est' => rand(5, 10) / 100, // 5-10% rework (lowest)
                    'chars_added_total' => rand(1200, 2500), // Consistent changes
                    'chars_removed_total_est' => rand(240, 500),
                    'session_prs_created' => rand(1, 2),
                    'session_prs_merged' => rand(1, 2),
                    'session_pr_reopen_count' => rand(0, 1), // Lowest reopen pressure
                    'session_deployment_successes' => rand(1, 2), // Steady deployment frequency
                ]),
                'payload' => json_encode([]),
                'batch_hash' => md5($sessionId . time()),
                'session_prs_created' => rand(1, 2),
                'session_prs_merged' => rand(1, 2),
                'session_pr_reopen_count' => rand(0, 1),
                'session_deployment_successes' => rand(1, 2),
                'created_at' => now(),
                'updated_at' => now(),
            ];
            $sessions[] = $sessionData;

            // Add related events separately to avoid column mismatch
            $this->generateVSCodeEvents($sessionData);
        }

        foreach (array_chunk($sessions, 100) as $chunk) {
            TelemetryEvent::insert($chunk);
        }

        Log::info("Seeded 40 VS Code sessions with highest focus ratio patterns");
    }

    /**
     * Generate Claude Code specific events (terminal commands, git operations)
     */
    private function generateClaudeCodeEvents(array $session): void
    {
        $events = [];
        $sessionData = json_decode($session['metadata'], true);

        // Terminal command events (high for Claude Code)
        for ($i = 0; $i < rand(40, 60); $i++) {
            $events[] = [
                'organization_id' => $session['organization_id'],
                'user_id' => $session['user_id'],
                'session_id' => $session['session_id'],
                'source' => 'extension',
                'editor_source' => 'claude-code',
                'event_type' => 'terminal_command',
                'count' => 1,
                'duration_ms' => null,
                'timestamp' => Carbon::parse($session['timestamp'])->addMinutes(rand(1, 60)),
                'metadata' => json_encode([
                    'command' => $this->getTerminalCommand(),
                    'working_directory' => '/projects/northstar'
                ]),
                'payload' => json_encode([]),
                'batch_hash' => md5($session['session_id'] . '_terminal_' . $i),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        // AI accept events (low for Claude Code)
        for ($i = 0; $i < $sessionData['ai_burst_count']; $i++) {
            $events[] = [
                'organization_id' => $session['organization_id'],
                'user_id' => $session['user_id'],
                'session_id' => $session['session_id'],
                'source' => 'extension',
                'editor_source' => 'claude-code',
                'event_type' => 'ai_accept',
                'count' => 1,
                'duration_ms' => null,
                'timestamp' => Carbon::parse($session['timestamp'])->addMinutes(rand(5, 30)),
                'metadata' => json_encode([]),
                'payload' => json_encode([]),
                'batch_hash' => md5($session['session_id'] . '_ai_' . $i),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        // Insert events in batches
        foreach (array_chunk($events, 100) as $chunk) {
            TelemetryEvent::insert($chunk);
        }
    }

    /**
     * Generate Cursor specific events (balanced AI usage)
     */
    private function generateCursorEvents(array $session): void
    {
        $events = [];
        $sessionData = json_decode($session['metadata'], true);

        // Terminal command events (medium for Cursor)
        for ($i = 0; $i < rand(8, 15); $i++) {
            $events[] = [
                'organization_id' => $session['organization_id'],
                'user_id' => $session['user_id'],
                'session_id' => $session['session_id'],
                'source' => 'extension',
                'editor_source' => 'cursor',
                'event_type' => 'terminal_command',
                'count' => 1,
                'duration_ms' => null,
                'timestamp' => Carbon::parse($session['timestamp'])->addMinutes(rand(1, 30)),
                'metadata' => json_encode([
                    'command' => $this->getBasicCommand(),
                    'working_directory' => '/projects/northstar'
                ]),
                'payload' => json_encode([]),
                'batch_hash' => md5($session['session_id'] . '_terminal_' . $i),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        // AI accept events (medium for Cursor)
        for ($i = 0; $i < $sessionData['ai_burst_count']; $i++) {
            $events[] = [
                'organization_id' => $session['organization_id'],
                'user_id' => $session['user_id'],
                'session_id' => $session['session_id'],
                'source' => 'extension',
                'editor_source' => 'cursor',
                'event_type' => 'ai_accept',
                'count' => 1,
                'duration_ms' => null,
                'timestamp' => Carbon::parse($session['timestamp'])->addMinutes(rand(2, 20)),
                'metadata' => json_encode([]),
                'payload' => json_encode([]),
                'batch_hash' => md5($session['session_id'] . '_ai_' . $i),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        // Insert events in batches
        foreach (array_chunk($events, 100) as $chunk) {
            TelemetryEvent::insert($chunk);
        }
    }

    /**
     * Generate Windsurf specific events (high AI usage)
     */
    private function generateWindsurfEvents(array $session): void
    {
        $events = [];
        $sessionData = json_decode($session['metadata'], true);

        // Terminal command events (low for Windsurf)
        for ($i = 0; $i < rand(5, 10); $i++) {
            $events[] = [
                'organization_id' => $session['organization_id'],
                'user_id' => $session['user_id'],
                'session_id' => $session['session_id'],
                'source' => 'extension',
                'editor_source' => 'windsurf',
                'event_type' => 'terminal_command',
                'count' => 1,
                'duration_ms' => null,
                'timestamp' => Carbon::parse($session['timestamp'])->addMinutes(rand(1, 20)),
                'metadata' => json_encode([
                    'command' => $this->getBasicCommand(),
                    'working_directory' => '/projects/northstar'
                ]),
                'payload' => json_encode([]),
                'batch_hash' => md5($session['session_id'] . '_terminal_' . $i),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        // AI accept events (highest for Windsurf)
        for ($i = 0; $i < $sessionData['ai_burst_count']; $i++) {
            $events[] = [
                'organization_id' => $session['organization_id'],
                'user_id' => $session['user_id'],
                'session_id' => $session['session_id'],
                'source' => 'extension',
                'editor_source' => 'windsurf',
                'event_type' => 'ai_accept',
                'count' => 1,
                'duration_ms' => null,
                'timestamp' => Carbon::parse($session['timestamp'])->addMinutes(rand(1, 15)),
                'metadata' => json_encode([]),
                'payload' => json_encode([]),
                'batch_hash' => md5($session['session_id'] . '_ai_' . $i),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        // Insert events in batches
        foreach (array_chunk($events, 100) as $chunk) {
            TelemetryEvent::insert($chunk);
        }
    }

    /**
     * Generate VS Code specific events (minimal AI usage)
     */
    private function generateVSCodeEvents(array $session): void
    {
        $events = [];
        $sessionData = json_decode($session['metadata'], true);

        // Terminal command events (low for VS Code)
        for ($i = 0; $i < rand(4, 8); $i++) {
            $events[] = [
                'organization_id' => $session['organization_id'],
                'user_id' => $session['user_id'],
                'session_id' => $session['session_id'],
                'source' => 'extension',
                'editor_source' => 'vscode',
                'event_type' => 'terminal_command',
                'count' => 1,
                'duration_ms' => null,
                'timestamp' => Carbon::parse($session['timestamp'])->addMinutes(rand(1, 25)),
                'metadata' => json_encode([
                    'command' => $this->getBasicCommand(),
                    'working_directory' => '/projects/northstar'
                ]),
                'payload' => json_encode([]),
                'batch_hash' => md5($session['session_id'] . '_terminal_' . $i),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        // AI accept events (lowest for VS Code)
        for ($i = 0; $i < $sessionData['ai_burst_count']; $i++) {
            $events[] = [
                'organization_id' => $session['organization_id'],
                'user_id' => $session['user_id'],
                'session_id' => $session['session_id'],
                'source' => 'extension',
                'editor_source' => 'vscode',
                'event_type' => 'ai_accept',
                'count' => 1,
                'duration_ms' => null,
                'timestamp' => Carbon::parse($session['timestamp'])->addMinutes(rand(10, 40)),
                'metadata' => json_encode([]),
                'payload' => json_encode([]),
                'batch_hash' => md5($session['session_id'] . '_ai_' . $i),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        // Insert events in batches
        foreach (array_chunk($events, 100) as $chunk) {
            TelemetryEvent::insert($chunk);
        }
    }

    /**
     * Get terminal command for Claude Code (complex operations)
     */
    private function getTerminalCommand(): string
    {
        $commands = [
            'git rebase -i HEAD~10',
            'git cherry-pick abc123..def456',
            'find . -name "*.js" -exec grep -l "TODO" {} \;',
            'sed -i "s/oldPattern/newPattern/g" **/*.ts',
            'git subtree pull --prefix=packages/shared origin main',
            'docker-compose -f docker-compose.prod.yml up -d',
            'kubectl rollout status deployment/api-service'
        ];
        return $commands[array_rand($commands)];
    }

    /**
     * Get basic terminal command for other IDEs
     */
    private function getBasicCommand(): string
    {
        $commands = [
            'git add .',
            'git commit -m "Update feature"',
            'git push origin feature-branch',
            'npm run build',
            'npm test',
            'git status'
        ];
        return $commands[array_rand($commands)];
    }

    /**
     * Get random feature name
     */
    private function getRandomFeatureName(): string
    {
        $features = [
            'UserAuthentication', 'PaymentProcessing', 'DashboardUI', 'APIIntegration',
            'MobileResponsive', 'PerformanceOptimization', 'SecurityUpdate', 'BugFix',
            'DataMigration', 'SearchFunctionality', 'FileUpload', 'EmailNotifications',
            'CacheOptimization', 'DatabaseIndexing', 'RateLimiting', 'WebSocketSupport'
        ];
        return $features[array_rand($features)];
    }

    /**
     * Seed GitHub data aligned with telemetry patterns
     */
    private function seedGitHubData(Organization $org): void
    {
        // This would integrate with existing GitHub seeder
        // For Phase 1, we focus on telemetry patterns only
        Log::info('GitHub data seeding should be integrated with existing GitHubDemoSeeder for Phase 2');
    }
}
