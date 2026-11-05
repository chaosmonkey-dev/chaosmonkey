<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class SeedTelemetryEventsSimulation extends Command
{
    protected $signature = 'seed:telemetry-events-simulation';
    protected $description = 'Seed realistic multi-developer telemetry simulation through telemetry_events pipeline';

    private $developers = [
        'alex_chen' => [
            'name' => 'Alex Chen',
            'user_id' => 90001, // Simulated user ID
            'archetype' => 'ai_heavy_fast_mover',
            'primary_tool' => 'cursor',
            'ai_intensity' => 'high',
            'session_pattern' => 'short_intense',
            'work_frequency' => 0.9,
            'file_edit_ratio' => 0.8, // High file edit frequency
            'email' => 'alex.chen@example.org',
            'team' => 'Platform Engineering'
        ],
        'sarah_rodriguez' => [
            'name' => 'Sarah Rodriguez', 
            'user_id' => 90002,
            'archetype' => 'disciplined_senior',
            'primary_tool' => 'vscode',
            'ai_intensity' => 'medium',
            'session_pattern' => 'long_steady',
            'work_frequency' => 0.85,
            'file_edit_ratio' => 0.6,
            'email' => 'sarah.rodriguez@example.org',
            'team' => 'Platform Engineering'
        ],
        'marcus_kim' => [
            'name' => 'Marcus Kim',
            'user_id' => 90003, 
            'archetype' => 'reviewer_bottleneck',
            'primary_tool' => 'vscode',
            'ai_intensity' => 'low_medium',
            'session_pattern' => 'mixed_coding_review',
            'work_frequency' => 0.8,
            'file_edit_ratio' => 0.4,
            'email' => 'marcus.kim@example.org',
            'team' => 'Platform Engineering'
        ],
        'jordan_taylor' => [
            'name' => 'Jordan Taylor',
            'user_id' => 90004,
            'archetype' => 'inconsistent_adopter',
            'primary_tool' => 'windsurf',
            'ai_intensity' => 'variable',
            'session_pattern' => 'variable',
            'work_frequency' => 0.7,
            'file_edit_ratio' => 0.5,
            'email' => 'jordan.taylor@example.org',
            'team' => 'Platform Engineering'
        ],
        'riley_park' => [
            'name' => 'Riley Park',
            'user_id' => 90005,
            'archetype' => 'high_output_risky',
            'primary_tool' => 'cursor',
            'ai_intensity' => 'very_high',
            'session_pattern' => 'very_long_intense',
            'work_frequency' => 0.95,
            'file_edit_ratio' => 0.9,
            'email' => 'riley.park@example.org',
            'team' => 'Platform Engineering'
        ],
        'sam_martinez' => [
            'name' => 'Sam Martinez',
            'user_id' => 90006,
            'archetype' => 'low_output_stable',
            'primary_tool' => 'vscode',
            'ai_intensity' => 'low',
            'session_pattern' => 'short_cautious',
            'work_frequency' => 0.75,
            'file_edit_ratio' => 0.3,
            'email' => 'sam.martinez@example.org',
            'team' => 'Platform Engineering'
        ]
    ];

    private $toolDistribution = [
        'alex_chen' => ['cursor' => 0.8, 'windsurf' => 0.2],
        'sarah_rodriguez' => ['vscode' => 0.7, 'claude_code' => 0.3],
        'marcus_kim' => ['vscode' => 0.6, 'github_copilot' => 0.4],
        'jordan_taylor' => ['windsurf' => 0.4, 'cursor' => 0.3, 'vscode' => 0.3],
        'riley_park' => ['cursor' => 0.9, 'windsurf' => 0.1],
        'sam_martinez' => ['vscode' => 0.8, 'claude_code' => 0.2]
    ];

    public function handle()
    {
        $this->info('Starting telemetry_events-native multi-developer simulation...');
        
        try {
            // Phase 1: Clear existing simulation data
            $this->clearSimulationData();
            
            // Phase 2: Seed telemetry events for all developers
            $this->seedTelemetryEvents();
            
            // Phase 3: Validate results
            $this->validateSimulation();
            
            $this->info('✅ Telemetry events simulation completed successfully!');
            $this->displayResults();
            
        } catch (\Exception $e) {
            $this->error('❌ Simulation failed: ' . $e->getMessage());
            Log::error('[TELEMETRY_SIMULATION] Failed', ['error' => $e->getMessage()]);
            return 1;
        }
        
        return 0;
    }

    private function clearSimulationData()
    {
        $this->info('Clearing existing simulation data...');
        
        // Clear simulation data
        DB::table('telemetry_events')
            ->where('user_id', '>=', 90000)
            ->where('user_id', '<=', 99999)
            ->delete();
        
        // Exclude old poisoned demo sessions from analytics
        $this->excludeOldDemoSessions();
        
        $this->info('✓ Existing simulation data cleared');
    }

    private function excludeOldDemoSessions()
    {
        $this->info('Excluding old demo placeholder sessions...');
        
        // Mark old demo sessions to exclude from analytics
        $demoPatterns = ['demo-vscode', 'demo-cursor', 'demo-windsurf'];
        
        foreach ($demoPatterns as $pattern) {
            DB::table('telemetry_events')
                ->where('session_id', 'like', "%{$pattern}%")
                ->where(function($query) {
                    $query->whereNull('metadata')
                          ->orWhere('metadata', '{}')
                          ->orWhere('metadata', 'null');
                })
                ->update([
                    'metadata' => json_encode([
                        'exclude_from_analytics' => true,
                        'demo_placeholder' => true,
                        'exclusion_reason' => 'Old poisoned demo session'
                    ])
                ]);
        }
        
        $this->info('✓ Old demo sessions marked for exclusion');
    }

    private function seedTelemetryEvents()
    {
        $this->info('Seeding telemetry events for all developers...');
        
        $startDate = now()->subDays(30);
        $endDate = now();
        $totalEvents = 0;
        
        foreach ($this->developers as $devId => $devInfo) {
            $events = $this->generateDeveloperEvents($devId, $devInfo, $startDate, $endDate);
            
            foreach ($events as $event) {
                DB::table('telemetry_events')->insert($event);
                $totalEvents++;
            }
            
            $sessionCount = count(array_filter($events, fn($e) => $e['event_type'] === 'session'));
            $fileEditCount = count(array_filter($events, fn($e) => $e['event_type'] === 'file_edit'));
            
            $this->info("✓ Seeded {$sessionCount} sessions and {$fileEditCount} file edits for {$devInfo['name']}");
        }
        
        $this->info("✓ Total telemetry events seeded: {$totalEvents}");
    }

    private function generateDeveloperEvents($devId, $devInfo, $startDate, $endDate)
    {
        $events = [];
        $currentDate = $startDate->copy();
        
        while ($currentDate <= $endDate) {
            if ($this->shouldWorkToday($currentDate, $devInfo)) {
                $dayEvents = $this->generateDayEvents($devId, $currentDate, $devInfo);
                $events = array_merge($events, $dayEvents);
            }
            $currentDate->addDay();
        }
        
        return $events;
    }

    private function shouldWorkToday($date, $devInfo)
    {
        $isWeekday = $date->isWeekday();
        $baseProbability = $isWeekday ? 0.8 : 0.2;
        
        $adjustedProbability = $baseProbability * $devInfo['work_frequency'];
        
        return (mt_rand() / mt_getrandmax()) <= $adjustedProbability;
    }

    private function generateDayEvents($devId, $date, $devInfo)
    {
        $events = [];
        $sessionCount = $this->getSessionCount($devInfo['session_pattern']);
        
        for ($i = 0; $i < $sessionCount; $i++) {
            $sessionEvents = $this->generateSessionEvents($devId, $date, $devInfo, $i);
            $events = array_merge($events, $sessionEvents);
        }
        
        return $events;
    }

    private function getSessionCount($pattern)
    {
        switch ($pattern) {
            case 'short_intense': return rand(2, 4);
            case 'long_steady': return rand(1, 2);
            case 'very_long_intense': return rand(1, 3);
            case 'short_cautious': return rand(1, 2);
            case 'variable': return rand(0, 4);
            case 'mixed_coding_review': return rand(1, 3);
            default: return rand(1, 3);
        }
    }

    private function generateSessionEvents($devId, $date, $devInfo, $sessionIndex)
    {
        $events = [];
        $tool = $this->selectTool($devId);
        $sessionDuration = $this->getSessionDuration($devInfo['session_pattern']);
        
        // Calculate session timing
        $hour = 9 + ($sessionIndex * 3) + rand(-1, 1);
        $hour = max(8, min(18, $hour));
        
        $sessionStart = $date->copy()->setTime($hour, rand(0, 59));
        $sessionEnd = $sessionStart->copy()->addMinutes($sessionDuration);
        
        $sessionId = "session_" . $sessionStart->getTimestamp() . "_{$devId}";
        
        // Generate session event
        $sessionEvent = $this->generateSessionEvent($devId, $devInfo, $sessionId, $sessionStart, $tool, $sessionDuration);
        $events[] = $sessionEvent;
        
        // Generate file edit events
        $fileEditCount = $this->getFileEditCount($devInfo, $sessionDuration);
        for ($i = 0; $i < $fileEditCount; $i++) {
            $fileEditEvent = $this->generateFileEditEvent($devId, $devInfo, $sessionId, $sessionStart, $tool, $i, $fileEditCount);
            $events[] = $fileEditEvent;
        }
        
        return $events;
    }

    private function generateSessionEvent($devId, $devInfo, $sessionId, $sessionStart, $tool, $sessionDuration)
    {
        $aiData = $this->generateAIData($devInfo['ai_intensity'], $sessionDuration);
        
        $sessionCommits = $this->getSessionCommits($devInfo['archetype'], $sessionDuration);
        $timeToFirstCommit = $this->getTimeToFirstCommit($devInfo['archetype']);
        
        // Clamp extreme values for realistic sessions
        $clampedData = $this->clampSessionValues($devInfo['archetype'], $aiData, $sessionDuration);
        
        $sessionMetadata = [
            'source' => $tool,
            'extension_version' => '0.3.7',
            'vscode_version' => '1.110.1',
            'segment_type' => 'session',
            'session_id' => $sessionId,
            'end_reason' => 'idle',
            'git_repo_url' => 'https://github.com/demo-org/demo-sim.git',
            'git_branch' => 'main',
            'ai_burst_count' => intval($clampedData['burst_count']),
            'ai_first_burst_at_ms' => $aiData['first_burst_at'],
            'ai_last_burst_at_ms' => $aiData['last_burst_at'],
            'ai_burst_chars_total' => intval($clampedData['chars_total']),
            'ai_burst_lines_total' => intval($clampedData['lines_total']),
            'ai_active_span_ms' => $aiData['active_span'],
            'ai_usage_duration_ms' => $aiData['active_span'],
            'ai_usage_duration_definition' => 'span_between_first_and_last_ai_burst',
            'ai_chars_per_min' => intval($clampedData['chars_per_min']),
            'ai_intensity_band' => $this->getAIIntensityBand($devInfo['ai_intensity']),
            'ai_intensity_definition' => 'ai_burst_chars_total divided by ai_active_span_ms (span between first/last AI burst)',
            'language_id_counts' => $this->getLanguageCounts($devInfo['archetype']),
            'chars_added_total' => intval($clampedData['chars_total']),
            'chars_removed_total_est' => intval($clampedData['chars_total'] * 0.2),
            'lines_added_total' => intval($clampedData['lines_total']),
            'lines_removed_total_est' => intval($clampedData['lines_total'] * 0.3),
            'change_magnitude_definition' => 'added: exact_from_inserted_text; removed: estimated_from_change_range',
            'rework_ratio_est' => $this->getReworkRatio($devInfo['archetype']),
            'rework_band' => $this->getReworkBand($devInfo['archetype']),
            'rework_definition' => 'removed/added using chars_removed_total_est (range-based estimate) over chars_added_total (exact)',
            'debug_session_count' => 0,
            'debug_time_ms' => 0,
            'is_remote_workspace' => false,
            'remote_name' => null,
            'is_multi_root_workspace' => false,
            'workspace_folder_count' => 1,
            'file_save_count' => intval(rand(2, 8)),
            'will_save_total_count' => intval(rand(1, 4)),
            'will_save_format_likely_count' => intval(rand(0, 2)),
            'save_format_definition' => 'format_likely inferred when a file edit occurs within 250ms after onWillSave (max 1 per will-save)',
            'terminal_open_count' => intval(rand(0, 2)),
            'terminal_active_time_ms' => rand(0, 30000),
            'terminal_definition' => 'active_time approximated via onDidChangeActiveTerminal intervals; no commands/titles/cwd captured',
            'active_coding_duration_ms' => ($sessionDuration * 60 * 1000) * 0.7,
            'idle_time_ms' => ($sessionDuration * 60 * 1000) * 0.3,
            'focus_ratio' => $this->getFocusRatio($devInfo['archetype']),
            'debug_ratio' => 0,
            'terminal_ratio' => 0.1,
            'idle_ratio' => 0.3,
            'flow_profile' => $this->getFlowProfile($devInfo['archetype']),
            'flow_definition' => 'profile chosen by ordered rules: idle>debug>terminal>coding>mixed using ratios of duration_ms',
            'git_context_status' => 'resolved_full',
            'git_context_reason' => 'full_context',
            'git_context_attempts' => 1,
            'git_context_resolution_ms' => rand(1, 5),
            'git_context_resolved_before_end' => true,
            'session_quality_score' => $this->getQualityScore($devInfo['archetype']),
            'session_quality_band' => $this->getQualityBand($devInfo['archetype']),
            'session_quality_factors' => [],
            'event_id' => "evt_" . substr($devId, 0, 3) . "_" . $sessionStart->getTimestamp(),
            // Simulation metadata
            'simulated' => true,
            'sim_dev' => $devInfo['name'],
            'sim_email' => $devInfo['email'],
            'sim_archetype' => $devInfo['archetype'],
            'sim_team' => $devInfo['team'],
            // Session-specific metrics
            'session_commits' => $sessionCommits,
            'time_to_first_commit_ms' => $timeToFirstCommit
        ];

        return [
            'user_id' => $devInfo['user_id'],
            'source' => $tool,
            'batch_hash' => $this->generateBatchHash(),
            'payload' => json_encode([
                'event_type' => 'session',
                'count' => 1,
                'timestamp' => $sessionStart->toISOString(),
                'metadata' => $sessionMetadata
            ]),
            'created_at' => $sessionStart,
            'updated_at' => $sessionStart,
            'event_type' => 'session',
            'count' => 1,
            'duration_ms' => $sessionDuration * 60 * 1000,
            'timestamp' => $sessionStart,
            'metadata' => json_encode($sessionMetadata),
            'session_id' => $sessionId,
            'editor_source' => $tool,
            'organization_id' => 7,
            'tool_cost' => $this->getToolCost($tool, $sessionDuration)
        ];
    }

    private function generateFileEditEvent($devId, $devInfo, $sessionId, $sessionStart, $tool, $editIndex, $totalEdits)
    {
        $editTimestamp = $sessionStart->copy()->addSeconds(rand(60, 3600));
        $fileEditMetadata = [
            'source' => $tool,
            'extension_version' => '0.3.7',
            'vscode_version' => '1.110.1',
            'session_id' => $sessionId,
            'segment_type' => 'event',
            'git_repo_url' => 'https://github.com/demo-org/demo-sim.git',
            'git_branch' => 'main',
            'workspace_folders' => 'chaosMonkey-CB-8.12.25',
            'event_id' => "evt_" . substr($devId, 0, 3) . "_" . $sessionStart->getTimestamp() . "_{$editIndex}",
            // Simulation metadata
            'simulated' => true,
            'sim_dev' => $devInfo['name'],
            'sim_email' => $devInfo['email'],
            'sim_archetype' => $devInfo['archetype'],
            'sim_team' => $devInfo['team']
        ];
        
        return [
            'user_id' => $devInfo['user_id'],
            'source' => $tool,
            'batch_hash' => $this->generateBatchHash(),
            'payload' => json_encode([
                'event_type' => 'file_edit',
                'count' => rand(1, 5),
                'timestamp' => $editTimestamp->toISOString(),
                'metadata' => $fileEditMetadata
            ]),
            'created_at' => $editTimestamp,
            'updated_at' => $editTimestamp,
            'event_type' => 'file_edit',
            'count' => rand(1, 5),
            'duration_ms' => null,
            'timestamp' => $editTimestamp,
            'metadata' => json_encode($fileEditMetadata),
            'session_id' => $sessionId,
            'editor_source' => $tool,
            'organization_id' => 7,
            'tool_cost' => 0
        ];
    }

    private function selectTool($devId)
    {
        $distribution = $this->toolDistribution[$devId];
        $rand = mt_rand() / mt_getrandmax();
        $cumulative = 0;
        
        foreach ($distribution as $tool => $probability) {
            $cumulative += $probability;
            if ($rand <= $cumulative) {
                return $tool;
            }
        }
        
        return array_key_first($distribution);
    }

    private function getSessionDuration($pattern)
    {
        switch ($pattern) {
            case 'short_intense': return rand(30, 90);
            case 'long_steady': return rand(120, 240);
            case 'very_long_intense': return rand(180, 360);
            case 'short_cautious': return rand(45, 120);
            case 'variable': return rand(15, 300);
            case 'mixed_coding_review': return rand(60, 180);
            default: return rand(60, 180);
        }
    }

    private function getFileEditCount($devInfo, $sessionDuration)
    {
        $baseCount = intval($sessionDuration / 30); // Roughly one file edit per 30 minutes
        return max(1, intval($baseCount * $devInfo['file_edit_ratio']));
    }

    private function generateAIData($intensity, $sessionDuration)
    {
        $multiplier = $this->getAIMultiplier($intensity);
        $burstCount = max(1, intval($sessionDuration / 30) * $multiplier);
        
        $charsPerBurst = $this->getCharsPerBurst($intensity);
        $totalChars = $burstCount * $charsPerBurst * (0.8 + (mt_rand() / mt_getrandmax()) * 0.4);
        $totalLines = intval($totalChars / 50);
        
        return [
            'burst_count' => $burstCount,
            'first_burst_at' => 5000,
            'last_burst_at' => ($sessionDuration * 60 * 1000) - 10000,
            'chars_total' => intval($totalChars),
            'lines_total' => $totalLines,
            'active_span' => ($sessionDuration * 60 * 1000) * 0.6,
            'chars_per_min' => intval($totalChars / ($sessionDuration * 0.6))
        ];
    }

    private function getAIMultiplier($intensity)
    {
        switch ($intensity) {
            case 'very_high': return 3;
            case 'high': return 2;
            case 'medium': return 1;
            case 'low_medium': return 0.8;
            case 'low': return 0.5;
            case 'variable': return 0.5 + (mt_rand() / mt_getrandmax()) * 1.5;
            default: return 1;
        }
    }

    private function getCharsPerBurst($intensity)
    {
        switch ($intensity) {
            case 'very_high': return rand(5000, 15000);
            case 'high': return rand(3000, 8000);
            case 'medium': return rand(1500, 4000);
            case 'low_medium': return rand(800, 2000);
            case 'low': return rand(300, 1000);
            case 'variable': return rand(500, 5000);
            default: return rand(1500, 4000);
        }
    }

    private function getAIIntensityBand($intensity)
    {
        switch ($intensity) {
            case 'very_high':
            case 'high': return 'high';
            case 'medium':
            case 'low_medium': return 'medium';
            case 'low': return 'low';
            case 'variable': return ['low', 'medium', 'high'][rand(0, 2)];
            default: return 'medium';
        }
    }

    private function getLanguageCounts($archetype)
    {
        $patterns = [
            'ai_heavy_fast_mover' => ['php' => rand(3, 8), 'javascript' => rand(1, 3)],
            'disciplined_senior' => ['php' => rand(2, 5), 'javascript' => rand(1, 2)],
            'reviewer_bottleneck' => ['php' => rand(1, 4), 'javascript' => rand(1, 2)],
            'inconsistent_adopter' => ['php' => rand(1, 6), 'javascript' => rand(0, 3)],
            'high_output_risky' => ['php' => rand(4, 10), 'javascript' => rand(2, 5)],
            'low_output_stable' => ['php' => rand(1, 3), 'javascript' => rand(0, 1)]
        ];
        return $patterns[$archetype] ?? ['php' => 2, 'javascript' => 1];
    }

    private function getReworkRatio($archetype)
    {
        $ratios = [
            'ai_heavy_fast_mover' => 0.1 + (mt_rand() / mt_getrandmax()) * 0.2,
            'disciplined_senior' => 0.05 + (mt_rand() / mt_getrandmax()) * 0.1,
            'reviewer_bottleneck' => 0.08 + (mt_rand() / mt_getrandmax()) * 0.15,
            'inconsistent_adopter' => 0.15 + (mt_rand() / mt_getrandmax()) * 0.25,
            'high_output_risky' => 0.2 + (mt_rand() / mt_getrandmax()) * 0.3,
            'low_output_stable' => 0.05 + (mt_rand() / mt_getrandmax()) * 0.1
        ];
        return round($ratios[$archetype], 3);
    }

    private function getReworkBand($archetype)
    {
        $ratio = $this->getReworkRatio($archetype);
        if ($ratio <= 0.1) return 'low';
        if ($ratio <= 0.25) return 'medium';
        return 'high';
    }

    private function getFocusRatio($archetype)
    {
        $ratios = [
            'ai_heavy_fast_mover' => 0.6 + (mt_rand() / mt_getrandmax()) * 0.3,
            'disciplined_senior' => 0.7 + (mt_rand() / mt_getrandmax()) * 0.2,
            'reviewer_bottleneck' => 0.5 + (mt_rand() / mt_getrandmax()) * 0.3,
            'inconsistent_adopter' => 0.3 + (mt_rand() / mt_getrandmax()) * 0.4,
            'high_output_risky' => 0.4 + (mt_rand() / mt_getrandmax()) * 0.4,
            'low_output_stable' => 0.8 + (mt_rand() / mt_getrandmax()) * 0.15
        ];
        return round($ratios[$archetype], 2);
    }

    private function getFlowProfile($archetype)
    {
        $profiles = [
            'ai_heavy_fast_mover' => 'coding-heavy',
            'disciplined_senior' => 'mixed',
            'reviewer_bottleneck' => 'mixed',
            'inconsistent_adopter' => 'idle-heavy',
            'high_output_risky' => 'coding-heavy',
            'low_output_stable' => 'mixed'
        ];
        return $profiles[$archetype] ?? 'mixed';
    }

    private function getQualityScore($archetype)
    {
        $scores = [
            'ai_heavy_fast_mover' => rand(75, 95),
            'disciplined_senior' => rand(85, 100),
            'reviewer_bottleneck' => rand(80, 95),
            'inconsistent_adopter' => rand(60, 90),
            'high_output_risky' => rand(65, 85),
            'low_output_stable' => rand(90, 100)
        ];
        return $scores[$archetype] ?? 85;
    }

    private function getQualityBand($archetype)
    {
        $score = $this->getQualityScore($archetype);
        if ($score >= 90) return 'high';
        if ($score >= 75) return 'medium';
        return 'low';
    }

    private function getToolCost($tool, $sessionDuration)
    {
        $hourlyRates = [
            'cursor' => 20.0,
            'windsurf' => 20.0,
            'vscode' => 0.0,
            'claude_code' => 25.0,
            'github_copilot' => 10.0
        ];
        
        $hourlyRate = $hourlyRates[$tool] ?? 20.0;
        return round(($hourlyRate * $sessionDuration / 60), 2);
    }

    private function getSessionCommits($archetype, $sessionDuration)
    {
        switch ($archetype) {
            case 'ai_heavy_fast_mover': // Alex
                return rand(3, 8); // Fast, many commits
            case 'high_output_risky': // Riley
                return rand(5, 12); // Very high output
            case 'disciplined_senior': // Sarah
                return rand(2, 4); // Steady, moderate
            case 'low_output_stable': // Sam
                return rand(1, 3); // Cautious, few commits
            case 'reviewer_bottleneck': // Marcus
                return rand(2, 5); // Moderate, review-focused
            case 'inconsistent_adopter': // Jordan
                return rand(0, 7); // Variable, sometimes none
            default:
                return rand(2, 5);
        }
    }

    private function getTimeToFirstCommit($archetype)
    {
        switch ($archetype) {
            case 'ai_heavy_fast_mover': // Alex
                return rand(2, 8) * 60 * 1000; // 2-8 minutes
            case 'high_output_risky': // Riley
                return rand(1, 5) * 60 * 1000; // 1-5 minutes
            case 'disciplined_senior': // Sarah
                return rand(5, 15) * 60 * 1000; // 5-15 minutes
            case 'low_output_stable': // Sam
                return rand(10, 25) * 60 * 1000; // 10-25 minutes
            case 'reviewer_bottleneck': // Marcus
                return rand(8, 20) * 60 * 1000; // 8-20 minutes
            case 'inconsistent_adopter': // Jordan
                return rand(1, 30) * 60 * 1000; // 1-30 minutes (very variable)
            default:
                return rand(5, 15) * 60 * 1000;
        }
    }

    private function clampSessionValues($archetype, $aiData, $sessionDuration)
    {
        $clamped = $aiData;
        
        // Define reasonable ceilings based on session duration
        $maxCharsPerMinute = 500;
        $maxLinesPerMinute = 10;
        $maxBurstsPerHour = 20;
        
        // Apply stricter clamping for most archetypes
        switch ($archetype) {
            case 'high_output_risky': // Riley - allow higher but still reasonable
                $maxCharsPerMinute = 800;
                $maxLinesPerMinute = 15;
                $maxBurstsPerHour = 30;
                $isRiskyPattern = true;
                break;
            case 'ai_heavy_fast_mover': // Alex - high but reasonable
                $maxCharsPerMinute = 600;
                $maxLinesPerMinute = 12;
                $maxBurstsPerHour = 25;
                $isRiskyPattern = false;
                break;
            default:
                $isRiskyPattern = false;
                break;
        }
        
        // Calculate maximum values based on session duration
        $maxChars = $maxCharsPerMinute * ($sessionDuration / 60);
        $maxLines = $maxLinesPerMinute * ($sessionDuration / 60);
        $maxBursts = $maxBurstsPerHour * ($sessionDuration / 60);
        
        // Clamp values
        $clamped['chars_total'] = min($aiData['chars_total'], $maxChars);
        $clamped['lines_total'] = min($aiData['lines_total'], $maxLines);
        $clamped['burst_count'] = min($aiData['burst_count'], $maxBursts);
        $clamped['chars_per_min'] = min($aiData['chars_per_min'], $maxCharsPerMinute);
        
        // Add risk flags for extreme sessions
        if ($isRiskyPattern) {
            $clamped['change_magnitude_clamped'] = true;
            $clamped['sim_risk_pattern'] = 'high_output_ai_churn';
        }
        
        return $clamped;
    }

    private function generateBatchHash()
    {
        return hash('sha256', uniqid('', true));
    }

    private function validateSimulation()
    {
        $this->info('Validating simulation results...');
        
        $uniqueDevs = DB::table('telemetry_events')
            ->where('user_id', '>=', 90000)
            ->where('user_id', '<=', 99999)
            ->distinct('user_id')
            ->count();
            
        $totalEvents = DB::table('telemetry_events')
            ->where('user_id', '>=', 90000)
            ->where('user_id', '<=', 99999)
            ->count();
            
        $sessionEvents = DB::table('telemetry_events')
            ->where('user_id', '>=', 90000)
            ->where('user_id', '<=', 99999)
            ->where('event_type', 'session')
            ->count();
            
        $fileEditEvents = DB::table('telemetry_events')
            ->where('user_id', '>=', 90000)
            ->where('user_id', '<=', 99999)
            ->where('event_type', 'file_edit')
            ->count();
        
        $this->info("✓ Unique developers: {$uniqueDevs}");
        $this->info("✓ Total events: {$totalEvents}");
        $this->info("✓ Session events: {$sessionEvents}");
        $this->info("✓ File edit events: {$fileEditEvents}");
        
        if ($uniqueDevs >= 6) {
            $this->info('✓ Multi-developer simulation validated successfully');
        } else {
            $this->warn('⚠ Expected 6 developers, found ' . $uniqueDevs);
        }
    }

    private function displayResults()
    {
        $this->newLine();
        $this->info('📊 TELEMETRY EVENTS SIMULATION RESULTS:');
        $this->newLine();
        
        foreach ($this->developers as $devId => $devInfo) {
            $sessionCount = DB::table('telemetry_events')
                ->where('user_id', $devInfo['user_id'])
                ->where('event_type', 'session')
                ->count();
                
            $fileEditCount = DB::table('telemetry_events')
                ->where('user_id', $devInfo['user_id'])
                ->where('event_type', 'file_edit')
                ->count();
            
            $this->line("  {$devInfo['name']}: {$sessionCount} sessions, {$fileEditCount} file edits");
        }
        
        $this->newLine();
        $this->info('🎯 Next Steps:');
        $this->line('  1. Test /api/telemetry to verify simulated developers');
        $this->line('  2. Test /api/telemetry/sessions to verify simulated sessions');
        $this->line('  3. Test /api/metrics to verify unique_developers increases');
        $this->line('  4. Verify Performance Insights react naturally');
    }
}
