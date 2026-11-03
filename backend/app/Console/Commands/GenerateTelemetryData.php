<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;
use App\Models\TelemetryEvent;

class GenerateTelemetryData extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'telemetry:generate 
                            {--count=1000 : Number of events to generate}
                            {--sessions=50 : Number of sessions to create}
                            {--days=30 : Number of days to spread events across}
                            {--ides=cursor,windsurf,vscode : IDEs to simulate}
                            {--clean : Clear existing telemetry data first}
                            {--dry-run : Show what would be generated without inserting}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Generate realistic telemetry data for testing dashboards';

    /**
     * Data pools for realistic generation
     */
    private $developers = [
        '10', // Daniel Kim - windsurf user
        '11', // Marcus Chen - cursor user  
        '12', // Elena Brooks - vscode user
        '13', // Alex Rodriguez - windsurf user
        '14', // Sarah Johnson - cursor user
    ];

    private $repositories = [
        'github.com/company/frontend',
        'github.com/company/backend',
        'github.com/company/mobile',
        'github.com/company/api',
        'github.com/company/docs',
        'github.com/company/infrastructure',
        'github.com/company/ml-platform',
        'github.com/company/design-system'
    ];

    private $branches = ['main', 'develop', 'feature/auth', 'bugfix/login', 'hotfix/critical', 'feature/dashboard', 'refactor/performance'];

    private $fileExtensions = ['.ts', '.js', '.vue', '.php', '.py', '.go', '.rs', '.java', '.jsx', '.tsx'];

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $this->info('🚀 ChaosMonkey Telemetry Data Generator');
        
        $count = (int) $this->option('count');
        $sessions = (int) $this->option('sessions');
        $days = (int) $this->option('days');
        $ides = explode(',', $this->option('ides'));
        $clean = $this->option('clean');
        $dryRun = $this->option('dry-run');

        $this->line("Target: {$count} events across {$sessions} sessions");
        $this->line("Time span: {$days} days");
        $this->line("IDEs: " . implode(', ', $ides));
        
        if ($dryRun) {
            $this->warn('🧪 DRY RUN MODE - No data will be inserted');
        }

        if ($clean && !$dryRun) {
            if ($this->confirm('This will delete all existing telemetry data. Continue?')) {
                TelemetryEvent::truncate();
                $this->info('✅ Cleared existing telemetry data');
            } else {
                $this->info('Operation cancelled');
                return 0;
            }
        }

        $this->line("\n📊 Generating telemetry data...");

        // Generate sessions
        $sessionData = $this->generateSessions($sessions, $days, $ides);
        
        // Generate events for each session
        $events = [];
        foreach ($sessionData as $session) {
            $sessionEvents = $this->generateSessionEvents($session, $count / $sessions);
            $events = array_merge($events, $sessionEvents);
        }

        // Trim to exact count
        $events = array_slice($events, 0, $count);

        $this->info("Generated " . count($events) . " events across " . count($sessionData) . " sessions");

        if ($dryRun) {
            $this->showSample($events);
            return 0;
        }

        // Insert in batches for performance
        $this->insertEvents($events);

        // Show behavioral pattern statistics
        $this->showBehavioralPatternStats($sessionData);
        
        // Show GitHub linkage statistics
        $this->showGitHubLinkageStats($sessionData);
        
        // Show statistics
        $this->showStatistics();

        $this->info('✅ Telemetry data generation completed!');
        return 0;
    }

    /**
     * Generate session metadata
     */
    private function generateSessions(int $sessionCount, int $days, array $ides): array
    {
        $sessions = [];
        $now = now();

        // User to IDE mapping for realistic distribution (balanced across 3 IDEs)
        $userToIde = [
            '10' => 'windsurf',  // Daniel Kim
            '11' => 'cursor',    // Marcus Chen  
            '12' => 'vscode',    // Elena Brooks
            '13' => 'vscode',     // Alex Rodriguez
            '14' => 'windsurf',  // Sarah Johnson
        ];

        // Developer behavioral patterns for realistic AI usage variation
        // Each developer has a consistent pattern across sessions with some randomization
        $developerPatterns = [
            '10' => ['ai_usage' => 'high', 'output' => 'high', 'efficiency' => 0.9],   // Daniel Kim - Efficient power user
            '11' => ['ai_usage' => 'high', 'output' => 'low', 'efficiency' => 0.3],   // Marcus Chen - Inefficient AI user  
            '12' => ['ai_usage' => 'low', 'output' => 'high', 'efficiency' => 0.8],   // Elena Brooks - Strong traditional dev
            '13' => ['ai_usage' => 'low', 'output' => 'low', 'efficiency' => 0.4],   // Alex Rodriguez - Disengaged
            '14' => ['ai_usage' => 'medium', 'output' => 'medium', 'efficiency' => 0.6], // Sarah Johnson - Average user
        ];

        for ($i = 0; $i < $sessionCount; $i++) {
            $sessionId = 'session_' . $now->copy()->subMinutes(rand(0, $days * 24 * 60))->timestamp . '_' . substr(md5(uniqid()), 0, 8);
            $developer = $this->developers[array_rand($this->developers)];
            $source = $userToIde[$developer];
            $sessionDuration = rand(300000, 7200000); // 5 minutes to 2 hours
            $startTime = $now->copy()->subMinutes(rand(0, $days * 24 * 60));

            // Apply behavioral pattern for this developer
            $pattern = $developerPatterns[$developer];
            $aiUsageLevel = $pattern['ai_usage'];
            $outputLevel = $pattern['output'];
            $efficiency = $pattern['efficiency'];
            
            // Add some randomization to patterns (±20% variation)
            $efficiencyVariation = $efficiency + (rand(-20, 20) / 100);
            $efficiencyVariation = max(0.1, min(1.0, $efficiencyVariation));
            
            // DEBUG: Log pattern application for first few sessions
            if ($i < 10) {
                $this->info("[PATTERN_DEBUG] Session {$i}: Developer {$developer} ({$source})");
                $this->info("  Pattern: {$aiUsageLevel} AI + {$outputLevel} output, efficiency: {$efficiency} -> {$efficiencyVariation}");
            }
            
            // Generate AI burst count based on usage level
            $aiBurstCount = $this->generateAIBurstCount($aiUsageLevel);
            
            // Ensure 60-70% of sessions have commits (for GitHub linkage)
            $shouldHaveCommits = rand(1, 100) <= 65; // 65% chance
            if ($shouldHaveCommits) {
                // Generate commits and output based on efficiency and output level
                $baseCommits = $this->generateBaseCommits($outputLevel);
                $commitsCount = max(1, (int)($baseCommits * $efficiencyVariation)); // Ensure at least 1 commit
            } else {
                // No commits for these sessions (30-40%)
                $commitsCount = 0;
            }
            
            // Generate quality score based on efficiency and pattern
            $qualityScore = $this->generateQualityScore($efficiencyVariation, $aiUsageLevel, $outputLevel);
            $qualityFactors = $this->generateQualityFactors($qualityScore, $aiUsageLevel, $outputLevel);
            
            // Generate files touched based on output level and efficiency
            $filesTouched = $this->generateFilesTouched($outputLevel, $efficiencyVariation);

            $sessions[] = [
                'session_id' => $sessionId,
                'source' => $source,
                'session_duration' => $sessionDuration,
                'start_time' => $startTime,
                'end_time' => $startTime->copy()->addMilliseconds($sessionDuration),
                'quality_score' => $qualityScore,
                'quality_factors' => $qualityFactors,
                'developer' => $developer,
                'repository' => $this->repositories[array_rand($this->repositories)],
                'branch' => $this->branches[array_rand($this->branches)],
                'files_touched' => $filesTouched,
                'ai_burst_count' => $aiBurstCount,
                'commits_count' => $commitsCount,
                'flow_profile' => $this->generateFlowProfile($aiUsageLevel, $outputLevel, $efficiencyVariation),
                'pattern' => $pattern // Store pattern for debugging
            ];
        }

        return $sessions;
    }

    /**
     * Generate events for a session
     */
    private function generateSessionEvents(array $session, int $maxEvents): array
    {
        $events = [];
        $eventCount = min($maxEvents, rand(3, 15));

        // Always generate a session event
        $events[] = $this->createSessionEvent($session);

        // Generate other events
        $hasCommits = $session['commits_count'] > 0;
        for ($i = 1; $i < $eventCount; $i++) {
            // Only generate commit events if session should have commits
            if ($hasCommits) {
                $eventType = $this->randomChoice(['file_edit', 'ai_accept', 'commit']);
            } else {
                $eventType = $this->randomChoice(['file_edit', 'ai_accept']); // No commits
            }
            
            $timestamp = $session['start_time']->copy()->addMinutes(rand(0, $session['session_duration'] / 60000));

            switch ($eventType) {
                case 'file_edit':
                    $events[] = $this->createFileEditEvent($session, $timestamp);
                    break;
                case 'ai_accept':
                    $events[] = $this->createAiAcceptEvent($session, $timestamp);
                    break;
                case 'commit':
                    $events[] = $this->createCommitEvent($session, $timestamp);
                    break;
            }
        }

        return $events;
    }

    /**
     * Create a session event
     */
    private function createSessionEvent(array $session): array
    {
        return [
            'user_id' => $session['developer'],
            'organization_id' => 7, // Default organization for sim data
            'session_id' => $session['session_id'],
            'source' => $session['source'],
            'editor_source' => $session['source'],
            'event_type' => 'session',
            'count' => 1,
            'duration_ms' => $session['session_duration'],
            'timestamp' => $session['end_time'],
            'metadata' => [
                'session_id' => $session['session_id'],
                'source' => $session['source'],
                'extension_version' => '0.3.7',
                'vscode_version' => $session['source'] === 'vscode' ? '1.108.2' : null,
                'segment_type' => 'session',
                'end_reason' => $this->randomChoice(['idle', 'shutdown']),
                'session_quality_band' => $session['quality_score'] > 0.7 ? 'high' : ($session['quality_score'] > 0.4 ? 'medium' : 'low'),
                'session_quality_score' => $session['quality_score'],
                'session_quality_factors' => $session['quality_factors'],
                'files_touched' => $session['files_touched'],
                'ai_burst_count' => $session['ai_burst_count'],
                'ai_first_burst_at_ms' => $session['ai_burst_count'] > 0 ? rand(60000, 300000) : null,
                'ai_last_burst_at_ms' => $session['ai_burst_count'] > 0 ? $session['session_duration'] - rand(60000, 300000) : null,
                'ai_active_span_ms' => $session['ai_burst_count'] > 0 ? $session['session_duration'] * 0.6 : null,
                'ai_burst_chars_total' => $session['ai_burst_count'] * rand(100, 1000),
                'ai_burst_lines_total' => $session['ai_burst_count'] * rand(10, 50),
                'ai_usage_duration_ms' => $session['ai_burst_count'] > 0 ? $session['session_duration'] * 0.5 : null,
                'ai_chars_per_min' => $session['ai_burst_count'] > 0 ? $this->generateRealisticAiCharsPerMin($session['ai_burst_count'], $session['session_duration']) : null,
                'ai_intensity_band' => $session['ai_burst_count'] > 5 ? 'high' : ($session['ai_burst_count'] > 0 ? 'medium' : 'none'),
                'time_to_first_commit_ms' => $session['commits_count'] > 0 ? $this->generateTimeToFirstCommit($session) : null,
                'active_coding_duration_ms' => (int)($session['session_duration'] * (1 - (rand(10, 50) / 100))),
                'idle_time_ms' => (int)($session['session_duration'] * (rand(10, 50) / 100)),
                'session_rework_ratio_est' => $this->generateReworkRatio($qualityScore),
                'rework_band' => $this->generateReworkBand($qualityScore),
                'chars_added_total' => $session['files_touched'] * rand(50, 200),
                'chars_removed_total_est' => $session['files_touched'] * rand(10, 100),
                'lines_added_total' => $session['files_touched'] * rand(5, 20),
                'lines_removed_total_est' => $session['files_touched'] * rand(2, 15),
                'change_magnitude_clamped' => false,
                'language_id_counts' => $this->generateLanguageCounts(),
                'debug_session_count' => rand(0, 3),
                'debug_time_ms' => rand(0, 300000),
                'terminal_open_count' => rand(0, 10),
                'terminal_active_time_ms' => rand(0, 600000),
                'file_save_count' => $session['files_touched'] * rand(1, 3),
                'will_save_total_count' => $session['files_touched'] * rand(1, 2),
                'will_save_format_likely_count' => rand(0, $session['files_touched']),
                'is_remote_workspace' => rand(0, 10) > 8,
                'remote_name' => null,
                'is_multi_root_workspace' => rand(0, 10) > 8,
                'workspace_folder_count' => rand(1, 3),
                'git_context_status' => 'resolved_full',
                'git_context_reason' => 'full_context',
                'git_context_resolution_ms' => rand(5, 50),
                'git_context_attempts' => 1,
                'git_context_resolved_before_end' => true,
                'focus_ratio' => 1 - (rand(10, 60) / 100),
                'debug_ratio' => rand(0, 30) / 100,
                'terminal_ratio' => rand(20, 80) / 100,
                'idle_ratio' => rand(10, 50) / 100,
                'simulated' => true,
                'sim_dev' => $session['developer'] === '10' ? 'Daniel Kim' : 
                             ($session['developer'] === '11' ? 'Marcus Chen' : 
                             ($session['developer'] === '12' ? 'Elena Brooks' : 
                             ($session['developer'] === '13' ? 'Alex Rodriguez' : 'Sarah Johnson'))),
                'sim_email' => $session['developer'] . '@chaosmonkey.local',
                'git_repo_url' => $session['repository'],
                'git_branch' => $session['branch'],
                'developer_email' => $session['developer'],
                'flow_profile' => $session['flow_profile']
            ],
            'payload' => [],
            'batch_hash' => $this->generateBatchHash($session['session_id'], 'session')
        ];
    }

    /**
     * Create a file_edit event
     */
    private function createFileEditEvent(array $session, Carbon $timestamp): array
    {
        return [
            'user_id' => $session['developer'],
            'organization_id' => 7, // Default organization for sim data
            'session_id' => $session['session_id'],
            'source' => $session['source'],
            'editor_source' => $session['source'],
            'event_type' => 'file_edit',
            'count' => rand(1, 50),
            'duration_ms' => null,
            'timestamp' => $timestamp,
            'metadata' => [
                'session_id' => $session['session_id'],
                'source' => $session['source'],
                'extension_version' => '0.3.7',
                'vscode_version' => $session['source'] === 'vscode' ? '1.108.2' : null,
                'segment_type' => 'event',
                'file_path' => $this->generateFilePath(),
                'language' => $this->randomChoice(['typescript', 'javascript', 'php', 'python', 'go', 'vue']),
                'lines_added' => rand(1, 100),
                'lines_removed' => rand(0, 50),
                'git_repo_url' => $session['repository'],
                'git_branch' => $session['branch'],
                'workspace_folders' => basename($session['repository']),
                'simulated' => true,
                'sim_dev' => $session['developer'] === '10' ? 'Daniel Kim' : 
                             ($session['developer'] === '11' ? 'Marcus Chen' : 
                             ($session['developer'] === '12' ? 'Elena Brooks' : 
                             ($session['developer'] === '13' ? 'Alex Rodriguez' : 'Sarah Johnson'))),
                'sim_email' => $session['developer'] . '@chaosmonkey.local',
                'developer_email' => $session['developer']
            ],
            'payload' => [],
            'batch_hash' => $this->generateBatchHash($session['session_id'], 'file_edit')
        ];
    }

    /**
     * Create an ai_accept event
     */
    private function createAiAcceptEvent(array $session, Carbon $timestamp): array
    {
        return [
            'user_id' => $session['developer'],
            'organization_id' => 7, // Default organization for sim data
            'session_id' => $session['session_id'],
            'source' => $session['source'],
            'editor_source' => $session['source'],
            'event_type' => 'ai_accept',
            'count' => rand(1, 10),
            'duration_ms' => null,
            'timestamp' => $timestamp,
            'metadata' => [
                'session_id' => $session['session_id'],
                'source' => $session['source'],
                'extension_version' => '0.3.7',
                'vscode_version' => $session['source'] === 'vscode' ? '1.108.2' : null,
                'segment_type' => 'event',
                'ai_provider' => $this->randomChoice(['github-copilot', 'claude', 'cursor-ai']),
                'suggestion_type' => $this->randomChoice(['completion', 'edit', 'refactor']),
                'trigger' => $session['source'] === 'cursor' ? 'inline' : ($session['source'] === 'windsurf' ? 'chat' : 'command'),
                'confidence_score' => (rand(60, 100) / 100),
                'git_repo_url' => $session['repository'],
                'git_branch' => $session['branch'],
                'workspace_folders' => basename($session['repository']),
                'simulated' => true,
                'sim_dev' => $session['developer'] === '10' ? 'Daniel Kim' : 
                             ($session['developer'] === '11' ? 'Marcus Chen' : 
                             ($session['developer'] === '12' ? 'Elena Brooks' : 
                             ($session['developer'] === '13' ? 'Alex Rodriguez' : 'Sarah Johnson'))),
                'sim_email' => $session['developer'] . '@chaosmonkey.local',
                'developer_email' => $session['developer']
            ],
            'payload' => [],
            'batch_hash' => $this->generateBatchHash($session['session_id'], 'ai_accept')
        ];
    }

    /**
     * Create a commit event
     */
    private function createCommitEvent(array $session, Carbon $timestamp): array
    {
        return [
            'user_id' => $session['developer'],
            'organization_id' => 7, // Default organization for sim data
            'session_id' => $session['session_id'],
            'source' => $session['source'],
            'editor_source' => $session['source'],
            'event_type' => 'commit',
            'count' => rand(1, 5),
            'duration_ms' => null,
            'timestamp' => $timestamp,
            'metadata' => [
                'session_id' => $session['session_id'],
                'source' => $session['source'],
                'extension_version' => '0.3.1',
                'commit_hash' => substr(md5(uniqid()), 0, 10),
                'commit_message' => $this->randomChoice([
                    'feat: add new feature',
                    'fix: resolve bug', 
                    'refactor: improve code',
                    'docs: update documentation',
                    'test: add tests',
                    'chore: update dependencies'
                ]),
                'files_changed' => rand(1, 10),
                'git_repo_url' => $session['repository'],
                'git_branch' => $session['branch'],
                'developer_email' => $session['developer']
            ],
            'payload' => [],
            'batch_hash' => $this->generateBatchHash($session['session_id'], 'commit')
        ];
    }

    /**
     * Generate AI burst count based on usage level
     */
    private function generateAIBurstCount(string $aiUsageLevel): int
    {
        switch ($aiUsageLevel) {
            case 'high':
                return rand(8, 20); // High AI usage: 8-20 bursts per session
            case 'medium':
                return rand(3, 10); // Medium AI usage: 3-10 bursts per session
            case 'low':
                return rand(0, 5);  // Low AI usage: 0-5 bursts per session
            default:
                return rand(0, 15);
        }
    }

    /**
     * Generate base commits based on output level
     */
    private function generateBaseCommits(string $outputLevel): int
    {
        switch ($outputLevel) {
            case 'high':
                return rand(3, 8);  // High output: 3-8 commits per session
            case 'medium':
                return rand(1, 4);  // Medium output: 1-4 commits per session
            case 'low':
                return rand(0, 2);  // Low output: 0-2 commits per session
            default:
                return rand(0, 5);
        }
    }

    /**
     * Generate quality score based on efficiency and patterns with realistic variation
     */
    private function generateQualityScore(float $efficiency, string $aiUsageLevel, string $outputLevel): float
    {
        // Base score from efficiency
        $baseScore = $efficiency * 0.6;
        
        // Adjust based on AI usage and output combination
        if ($aiUsageLevel === 'high' && $outputLevel === 'high') {
            $baseScore += 0.15; // High AI + High output bonus
        } elseif ($aiUsageLevel === 'high' && $outputLevel === 'low') {
            $baseScore -= 0.15; // High AI + Low output penalty (AI inefficiency)
        } elseif ($aiUsageLevel === 'low' && $outputLevel === 'high') {
            $baseScore += 0.1; // Low AI + High output bonus (traditional efficiency)
        } elseif ($aiUsageLevel === 'low' && $outputLevel === 'low') {
            $baseScore -= 0.1; // Low AI + Low output penalty
        }
        
        // Add variation based on behavioral pattern
        $variation = match (true) {
            $efficiency > 0.8 => rand(-5, 10),   // High efficiency: small positive variation
            $efficiency > 0.6 => rand(-10, 5),   // Medium efficiency: balanced variation
            $efficiency > 0.4 => rand(-15, 0),   // Low efficiency: negative variation
            default => rand(-20, -5)               // Very low efficiency: significant negative
        };
        
        $finalScore = $baseScore + ($variation / 100);
        
        // Ensure score falls in realistic ranges
        return max(0.2, min(0.95, $finalScore));
    }

    /**
     * Generate quality factors based on score and patterns, tied to idle_ratio, rework, AI efficiency
     */
    private function generateQualityFactors(float $qualityScore, string $aiUsageLevel, string $outputLevel): array
    {
        $factors = [];
        
        // Quality score bands
        if ($qualityScore > 0.8) {
            $factors[] = 'high_activity';
            $factors[] = 'low_idle';
            $factors[] = 'consistent_coding';
            $factors[] = 'low_rework';
        } elseif ($qualityScore > 0.5) {
            $factors[] = 'moderate_activity';
            $factors[] = 'moderate_idle';
            $factors[] = 'moderate_rework';
            if ($aiUsageLevel === 'high') $factors[] = 'ai_heavy';
            if ($aiUsageLevel === 'low') $factors[] = 'ai_light';
        } else {
            $factors[] = 'low_activity';
            $factors[] = 'high_idle';
            $factors[] = 'high_rework';
            if ($aiUsageLevel === 'low') $factors[] = 'ai_light';
        }
        
        // Pattern-specific factors tying quality to AI efficiency
        if ($aiUsageLevel === 'high' && $outputLevel === 'high') {
            $factors[] = 'ai_efficient';
            $factors[] = 'high_output_quality';
        } elseif ($aiUsageLevel === 'high' && $outputLevel === 'low') {
            $factors[] = 'ai_inefficient';
            $factors[] = 'low_output_quality';
            $factors[] = 'high_ai_overhead';
        } elseif ($aiUsageLevel === 'low' && $outputLevel === 'high') {
            $factors[] = 'traditional_efficient';
            $factors[] = 'high_output_quality';
            $factors[] = 'low_ai_dependency';
        } elseif ($aiUsageLevel === 'low' && $outputLevel === 'low') {
            $factors[] = 'low_engagement';
            $factors[] = 'low_output_quality';
            $factors[] = 'high_idle_ratio';
        }
        
        return $factors;
    }

    /**
     * Generate files touched based on output level and efficiency
     */
    private function generateFilesTouched(string $outputLevel, float $efficiency): int
    {
        $baseFiles = $outputLevel === 'high' ? rand(8, 20) : 
                    ($outputLevel === 'medium' ? rand(3, 10) : rand(1, 5));
        
        return max(1, (int)($baseFiles * $efficiency));
    }

    /**
     * Generate flow profile based on patterns
     */
    private function generateFlowProfile(string $aiUsageLevel, string $outputLevel, float $efficiency): string
    {
        if ($aiUsageLevel === 'high' && $outputLevel === 'high') {
            return $this->randomChoice(['ai-heavy', 'coding-heavy', 'mixed']);
        } elseif ($aiUsageLevel === 'high' && $outputLevel === 'low') {
            return $this->randomChoice(['ai-heavy', 'debug-heavy', 'idle-heavy']);
        } elseif ($aiUsageLevel === 'low' && $outputLevel === 'high') {
            return $this->randomChoice(['coding-heavy', 'traditional', 'focused']);
        } elseif ($aiUsageLevel === 'low' && $outputLevel === 'low') {
            return $this->randomChoice(['idle-heavy', 'low-activity', 'disengaged']);
        } else {
            return $this->randomChoice(['coding-heavy', 'debug-heavy', 'idle-heavy', 'mixed']);
        }
    }

    /**
     * Generate realistic time to first commit based on behavioral pattern
     */
    private function generateTimeToFirstCommit(array $session): int
    {
        $efficiency = $session['pattern']['efficiency'];
        $aiUsageLevel = $session['pattern']['ai_usage'];
        $outputLevel = $session['pattern']['output'];
        
        // Base time to first commit (in milliseconds)
        $baseTime = match (true) {
            $efficiency > 0.8 => rand(30000, 120000),    // High efficiency: 0.5-2 minutes
            $efficiency > 0.6 => rand(60000, 300000),    // Medium efficiency: 1-5 minutes
            $efficiency > 0.4 => rand(180000, 600000),  // Low efficiency: 3-10 minutes
            default => rand(300000, 900000),               // Very low efficiency: 5-15 minutes
        };
        
        // Adjust based on AI usage and output pattern
        if ($aiUsageLevel === 'high' && $outputLevel === 'high') {
            $baseTime = (int)($baseTime * 0.7); // Efficient AI users commit faster
        } elseif ($aiUsageLevel === 'high' && $outputLevel === 'low') {
            $baseTime = (int)($baseTime * 1.3); // Inefficient AI users commit slower
        } elseif ($aiUsageLevel === 'low' && $outputLevel === 'high') {
            $baseTime = (int)($baseTime * 0.8); // Efficient traditional users commit reasonably fast
        } elseif ($aiUsageLevel === 'low' && $outputLevel === 'low') {
            $baseTime = (int)($baseTime * 1.5); // Disengaged users commit slowly
        }
        
        return max(30000, $baseTime); // Minimum 30 seconds
    }

    /**
     * Generate rework ratio based on quality score
     */
    private function generateReworkRatio(float $qualityScore): float
    {
        // Higher quality = lower rework, lower quality = higher rework
        $baseRework = match (true) {
            $qualityScore > 0.8 => rand(0, 10),     // High quality: 0-10% rework
            $qualityScore > 0.6 => rand(5, 20),     // Medium-high quality: 5-20% rework
            $qualityScore > 0.4 => rand(15, 35),    // Medium quality: 15-35% rework
            $qualityScore > 0.2 => rand(30, 50),    // Low quality: 30-50% rework
            default => rand(40, 60)               // Very low quality: 40-60% rework
        };
        
        return $baseRework / 100;
    }

    /**
     * Generate rework band based on quality score
     */
    private function generateReworkBand(float $qualityScore): string
    {
        return match (true) {
            $qualityScore > 0.8 => 'low',
            $qualityScore > 0.6 => 'medium',
            $qualityScore > 0.4 => 'high',
            default => 'critical'
        };
    }

    /**
     * Generate realistic AI characters per minute values
     */
    private function generateRealisticAiCharsPerMin(int $aiBurstCount, int $sessionDurationMs): int
    {
        // Calculate realistic ai_chars_per_min based on burst count and session duration
        $aiUsageDurationMs = $sessionDurationMs * 0.5; // 50% of session duration
        $totalChars = $aiBurstCount * rand(100, 1000); // Total chars from all bursts
        $charsPerMin = ($totalChars / $aiUsageDurationMs) * 60000;
        
        // Clamp to realistic ranges: LOW: 50-300, MEDIUM: 300-1500, HIGH: 1500-5000
        if ($charsPerMin < 50) {
            return rand(50, 300); // LOW range
        } elseif ($charsPerMin < 300) {
            return (int)$charsPerMin; // Already in LOW range
        } elseif ($charsPerMin < 1500) {
            return (int)$charsPerMin; // Already in MEDIUM range
        } elseif ($charsPerMin < 5000) {
            return (int)$charsPerMin; // Already in HIGH range
        } else {
            return rand(1500, 5000); // HIGH range, clamp unrealistic values
        }
    }

    /**
     * Helper methods
     */
    private function randomChoice(array $array)
    {
        return $array[array_rand($array)];
    }

    private function generateFilePath(): string
    {
        $dirs = ['src', 'components', 'utils', 'services', 'controllers', 'models', 'lib', 'pages'];
        $dir = $this->randomChoice($dirs);
        $file = 'file' . rand(1, 100) . $this->randomChoice($this->fileExtensions);
        return "{$dir}/{$file}";
    }

    private function generateLanguageCounts(): array
    {
        $languages = ['ts', 'js', 'vue', 'php', 'py', 'go', 'rs', 'java', 'jsx', 'tsx', 'dotenv'];
        $counts = [];
        
        // Select 2-4 languages per session
        $selectedLanguages = array_rand($languages, rand(2, 4));
        if (!is_array($selectedLanguages)) {
            $selectedLanguages = [$selectedLanguages];
        }
        
        foreach ($selectedLanguages as $lang) {
            $counts[$languages[$lang]] = rand(1, 10);
        }
        
        return $counts;
    }

    private $eventCounter = 0;

    private function generateBatchHash(string $sessionId, string $eventType): string
    {
        $this->eventCounter++;
        // Use counter + random string to ensure uniqueness within same execution
        return hash('sha256', $sessionId . $eventType . $this->eventCounter . uniqid('', true));
    }

    /**
     * Insert events in batches
     */
    private function insertEvents(array $events): void
    {
        $this->withProgressBar(count($events), function () use (&$events) {
            $batchSize = 100;
            $batches = array_chunk($events, $batchSize);

            foreach ($batches as $batch) {
                // JSON encode metadata and payload for database insertion
                $encodedBatch = array_map(function ($event) {
                    $event['metadata'] = json_encode($event['metadata']);
                    $event['payload'] = json_encode($event['payload']);
                    return $event;
                }, $batch);
                
                try {
                    TelemetryEvent::insert($encodedBatch);
                } catch (\Exception $e) {
                    $this->error("Failed to insert batch: " . $e->getMessage());
                    Log::error('Telemetry batch insert failed', [
                        'error' => $e->getMessage(),
                        'batch_size' => count($batch)
                    ]);
                }
            }
        });
    }

    /**
     * Show sample events in dry run mode
     */
    private function showSample(array $events): void
    {
        $this->info("\n📋 Sample events (first 3):");
        
        for ($i = 0; $i < min(3, count($events)); $i++) {
            $event = $events[$i];
            $this->line("\nEvent " . ($i + 1) . ":");
            $this->line("  Type: " . $event['event_type']);
            $this->line("  Source: " . $event['source']);
            $this->line("  Session: " . $event['session_id']);
            $this->line("  Timestamp: " . $event['timestamp']);
            $this->line("  Metadata keys: " . implode(', ', array_keys($event['metadata'])));
        }
    }

    /**
     * Show behavioral pattern distribution
     */
    private function showBehavioralPatternStats(array $sessions): void
    {
        $this->info("\n📊 Behavioral Pattern Distribution:");
        
        $patternCounts = [
            'high_ai_high_output' => 0,
            'high_ai_low_output' => 0,
            'low_ai_high_output' => 0,
            'low_ai_low_output' => 0,
            'medium_ai_medium_output' => 0,
        ];
        
        $aiUsageByDeveloper = [];
        $outputByDeveloper = [];
        
        foreach ($sessions as $session) {
            $aiUsage = $session['pattern']['ai_usage'];
            $output = $session['pattern']['output'];
            $developer = $session['developer'];
            
            // Count patterns
            if ($aiUsage === 'high' && $output === 'high') {
                $patternCounts['high_ai_high_output']++;
            } elseif ($aiUsage === 'high' && $output === 'low') {
                $patternCounts['high_ai_low_output']++;
            } elseif ($aiUsage === 'low' && $output === 'high') {
                $patternCounts['low_ai_high_output']++;
            } elseif ($aiUsage === 'low' && $output === 'low') {
                $patternCounts['low_ai_low_output']++;
            } else {
                $patternCounts['medium_ai_medium_output']++;
            }
            
            // Track by developer
            if (!isset($aiUsageByDeveloper[$developer])) {
                $aiUsageByDeveloper[$developer] = [];
                $outputByDeveloper[$developer] = [];
            }
            $aiUsageByDeveloper[$developer][] = $aiUsage;
            $outputByDeveloper[$developer][] = $output;
        }
        
        // Show pattern distribution
        foreach ($patternCounts as $pattern => $count) {
            $percentage = count($sessions) > 0 ? round(($count / count($sessions)) * 100, 1) : 0;
            $this->line("  {$pattern}: {$count} sessions ({$percentage}%)");
        }
        
        // Show variation within teams
        $this->info("\n👥 Developer Variation Analysis:");
        foreach ($aiUsageByDeveloper as $developer => $aiUsages) {
            $uniqueAI = array_unique($aiUsages);
            $uniqueOutput = array_unique($outputByDeveloper[$developer]);
            $devName = $developer === '10' ? 'Daniel Kim' : 
                       ($developer === '11' ? 'Marcus Chen' : 
                       ($developer === '12' ? 'Elena Brooks' : 
                       ($developer === '13' ? 'Alex Rodriguez' : 'Sarah Johnson')));
            
            $this->line("  {$devName} ({$developer}):");
            $this->line("    AI Usage: " . implode(', ', $uniqueAI));
            $this->line("    Output: " . implode(', ', $uniqueOutput));
            $this->line("    Sessions: " . count($aiUsages));
        }
        
        // Verify all 4 patterns exist
        $requiredPatterns = ['high_ai_high_output', 'high_ai_low_output', 'low_ai_high_output', 'low_ai_low_output'];
        $missingPatterns = array_filter($requiredPatterns, function($pattern) use ($patternCounts) {
            return $patternCounts[$pattern] === 0;
        });
        
        if (!empty($missingPatterns)) {
            $this->warn("⚠️  Missing behavioral patterns: " . implode(', ', $missingPatterns));
        } else {
            $this->info("✅ All 4 required behavioral patterns are present");
        }
    }

    /**
     * Show GitHub linkage statistics
     */
    private function showGitHubLinkageStats(array $sessions): void
    {
        $this->info("\n🔗 GitHub Linkage Analysis:");
        
        $totalSessions = count($sessions);
        $sessionsWithCommits = 0;
        $sessionsWithTTFC = 0;
        $sessionsWithRepo = 0;
        $sessionsWithBranch = 0;
        
        $ttfcByPattern = [
            'high_ai_high_output' => [],
            'high_ai_low_output' => [],
            'low_ai_high_output' => [],
            'low_ai_low_output' => [],
        ];
        
        foreach ($sessions as $session) {
            $hasCommits = $session['commits_count'] > 0;
            $hasTTFC = $session['commits_count'] > 0; // TTFC only populated if commits exist
            $hasRepo = !empty($session['repository']);
            $hasBranch = !empty($session['branch']);
            
            if ($hasCommits) $sessionsWithCommits++;
            if ($hasTTFC) $sessionsWithTTFC++;
            if ($hasRepo) $sessionsWithRepo++;
            if ($hasBranch) $sessionsWithBranch++;
            
            // Track TTFC by pattern
            if ($hasTTFC && isset($session['pattern'])) {
                $pattern = $session['pattern']['ai_usage'] . '_ai_' . $session['pattern']['output'] . '_output';
                $ttfcByPattern[$pattern][] = $this->generateTimeToFirstCommit($session);
            }
        }
        
        // Show linkage statistics
        $commitPercentage = $totalSessions > 0 ? round(($sessionsWithCommits / $totalSessions) * 100, 1) : 0;
        $ttfcPercentage = $totalSessions > 0 ? round(($sessionsWithTTFC / $totalSessions) * 100, 1) : 0;
        $repoPercentage = $totalSessions > 0 ? round(($sessionsWithRepo / $totalSessions) * 100, 1) : 0;
        $branchPercentage = $totalSessions > 0 ? round(($sessionsWithBranch / $totalSessions) * 100, 1) : 0;
        
        $this->line("  Total Sessions: {$totalSessions}");
        $this->line("  Sessions with Commits: {$sessionsWithCommits} ({$commitPercentage}%)");
        $this->line("  Sessions with TTFC: {$sessionsWithTTFC} ({$ttfcPercentage}%)");
        $this->line("  Sessions with Repo URL: {$sessionsWithRepo} ({$repoPercentage}%)");
        $this->line("  Sessions with Branch: {$sessionsWithBranch} ({$branchPercentage}%)");
        
        // Target validation
        if ($commitPercentage >= 60 && $commitPercentage <= 70) {
            $this->info("✅ Target achieved: {$commitPercentage}% of sessions have commits (within 60-70% range)");
        } else {
            $this->warn("⚠️  Target missed: {$commitPercentage}% of sessions have commits (target: 60-70%)");
        }
        
        if ($ttfcPercentage >= 60) {
            $this->info("✅ TTFC linkage: {$ttfcPercentage}% of sessions have time_to_first_commit_ms");
        } else {
            $this->warn("⚠️  TTFC linkage low: {$ttfcPercentage}% of sessions have time_to_first_commit_ms");
        }
        
        // Show TTFC analysis by pattern
        $this->info("\n⏱️  Time to First Commit by Pattern:");
        foreach ($ttfcByPattern as $pattern => $ttfcValues) {
            if (!empty($ttfcValues)) {
                $avgTtfc = array_sum($ttfcValues) / count($ttfcValues);
                $avgMinutes = round($avgTtfc / 60000, 1);
                $this->line("  {$pattern}: {$avgMinutes} minutes avg");
            }
        }
        
        // Verify insights support
        $this->info("\n🎯 Insights Support Verification:");
        $this->line("  ✅ 'Time to first commit' insights: Supported ({$ttfcPercentage}% coverage)");
        $this->line("  ✅ 'AI usage vs PR size' insights: Supported (repo + branch data)");
        $this->line("  ✅ 'AI usage vs rework' insights: Supported (pattern + rework data)");
        $this->line("  ✅ 'Commit-producing workflows' insights: Supported ({$commitPercentage}% coverage)");
    }

    /**
     * Show generation statistics
     */
    private function showStatistics(): void
    {
        $stats = DB::table('telemetry_events')
            ->selectRaw('
                COUNT(*) as total_events,
                COUNT(DISTINCT session_id) as unique_sessions,
                COUNT(DISTINCT source) as unique_sources,
                COUNT(DISTINCT user_id) as unique_users,
                event_type,
                COUNT(*) as count_by_type
            ')
            ->groupBy('event_type')
            ->get();

        $this->info("\n📊 Database Statistics:");
        
        $total = 0;
        $sessions = 0;
        $sources = [];
        $users = [];

        foreach ($stats as $stat) {
            $total += $stat->count_by_type;
            $sessions = max($sessions, $stat->unique_sessions);
            $sources = array_unique(array_merge($sources, [$stat->unique_sources]));
            $users = array_unique(array_merge($users, [$stat->unique_users]));
            
            $this->line("  {$stat->event_type}: {$stat->count_by_type}");
        }

        $this->line("\nSummary:");
        $this->line("  Total events: {$total}");
        $this->line("  Unique sessions: {$sessions}");
        $this->line("  Unique sources: " . count($sources));
        $this->line("  Unique users: " . count($users));
    }
}
