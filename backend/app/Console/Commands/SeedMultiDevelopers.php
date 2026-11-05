<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\CursorUsage;
use App\Models\PullRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class SeedMultiDevelopers extends Command
{
    protected $signature = 'seed:multi-developers';
    protected $description = 'Seed realistic multi-developer telemetry and GitHub activity';

    private $developers = [
        'alex_chen' => [
            'name' => 'Alex Chen',
            'email' => 'alex.chen@company.com',
            'archetype' => 'ai_heavy_fast_mover',
            'primary_ide' => 'cursor',
            'ai_intensity' => 'high',
            'session_pattern' => 'short_intense',
            'work_frequency' => 0.9,
            'github_username' => 'alexchen-dev'
        ],
        'sarah_rodriguez' => [
            'name' => 'Sarah Rodriguez', 
            'email' => 'sarah.rodriguez@company.com',
            'archetype' => 'disciplined_senior',
            'primary_ide' => 'vscode',
            'ai_intensity' => 'medium',
            'session_pattern' => 'long_steady',
            'work_frequency' => 0.85,
            'github_username' => 'sarahrod-dev'
        ],
        'marcus_kim' => [
            'name' => 'Marcus Kim',
            'email' => 'marcus.kim@company.com', 
            'archetype' => 'reviewer_bottleneck',
            'primary_ide' => 'vscode',
            'ai_intensity' => 'low_medium',
            'session_pattern' => 'mixed_coding_review',
            'work_frequency' => 0.8,
            'github_username' => 'marcuskim-tech'
        ],
        'jordan_taylor' => [
            'name' => 'Jordan Taylor',
            'email' => 'jordan.taylor@company.com',
            'archetype' => 'inconsistent_adopter',
            'primary_ide' => 'mixed',
            'ai_intensity' => 'variable',
            'session_pattern' => 'variable',
            'work_frequency' => 0.7,
            'github_username' => 'jordantaylor-exp'
        ],
        'riley_park' => [
            'name' => 'Riley Park',
            'email' => 'riley.park@company.com',
            'archetype' => 'high_output_risky',
            'primary_ide' => 'cursor',
            'ai_intensity' => 'very_high',
            'session_pattern' => 'very_long_intense',
            'work_frequency' => 0.95,
            'github_username' => 'rileypark-fast'
        ],
        'sam_martinez' => [
            'name' => 'Sam Martinez',
            'email' => 'sam.martinez@company.com',
            'archetype' => 'low_output_stable',
            'primary_ide' => 'vscode',
            'ai_intensity' => 'low',
            'session_pattern' => 'short_cautious',
            'work_frequency' => 0.75,
            'github_username' => 'sammartinez-steady'
        ]
    ];

    private $ideDistribution = [
        'alex_chen' => ['cursor' => 0.8, 'windsurf' => 0.2],
        'sarah_rodriguez' => ['vscode' => 0.7, 'claude_code' => 0.3],
        'marcus_kim' => ['vscode' => 0.6, 'github_copilot' => 0.4],
        'jordan_taylor' => ['windsurf' => 0.4, 'cursor' => 0.3, 'vscode' => 0.3],
        'riley_park' => ['cursor' => 0.9, 'windsurf' => 0.1],
        'sam_martinez' => ['vscode' => 0.8, 'claude_code' => 0.2]
    ];

    private $prSizeDistribution = [
        'alex_chen' => ['tiny' => 0.1, 'small' => 0.6, 'medium' => 0.3, 'large' => 0.0],
        'sarah_rodriguez' => ['tiny' => 0.05, 'small' => 0.2, 'medium' => 0.7, 'large' => 0.05],
        'marcus_kim' => ['tiny' => 0.0, 'small' => 0.1, 'medium' => 0.4, 'large' => 0.5],
        'jordan_taylor' => ['tiny' => 0.15, 'small' => 0.4, 'medium' => 0.4, 'large' => 0.05],
        'riley_park' => ['tiny' => 0.05, 'small' => 0.3, 'medium' => 0.4, 'large' => 0.25],
        'sam_martinez' => ['tiny' => 0.3, 'small' => 0.5, 'medium' => 0.2, 'large' => 0.0]
    ];

    public function handle()
    {
        $this->info('Starting multi-developer organizational behavior simulation...');
        
        try {
            // Phase 1: Clear existing simulation data
            $this->clearSimulationData();
            
            // Phase 2: Seed telemetry sessions
            $this->seedTelemetrySessions();
            
            // Phase 3: Seed GitHub activity
            $this->seedGitHubActivity();
            
            // Phase 4: Validate results
            $this->validateSimulation();
            
            $this->info('✅ Multi-developer simulation completed successfully!');
            $this->displayResults();
            
        } catch (\Exception $e) {
            $this->error('❌ Simulation failed: ' . $e->getMessage());
            Log::error('[SIMULATION] Failed', ['error' => $e->getMessage()]);
            return 1;
        }
        
        return 0;
    }

    private function clearSimulationData()
    {
        $this->info('Clearing existing simulation data...');
        
        CursorUsage::where('user_id', 'like', 'simulation_%')->delete();
        PullRequest::where('developer_id', 'like', 'simulation_%')->delete();
        
        $this->info('✓ Existing simulation data cleared');
    }

    private function seedTelemetrySessions()
    {
        $this->info('Seeding telemetry sessions for all developers...');
        
        $startDate = now()->subDays(30);
        $endDate = now();
        $totalSessions = 0;
        
        foreach ($this->developers as $devId => $devInfo) {
            $sessions = $this->generateDeveloperSessions($devId, $devInfo, $startDate, $endDate);
            
            foreach ($sessions as $session) {
                CursorUsage::create($session);
                $totalSessions++;
            }
            
            $this->info("✓ Seeded " . count($sessions) . " sessions for {$devInfo['name']}");
        }
        
        $this->info("✓ Total telemetry sessions seeded: {$totalSessions}");
    }

    private function generateDeveloperSessions($devId, $devInfo, $startDate, $endDate)
    {
        $sessions = [];
        $currentDate = $startDate->copy();
        
        while ($currentDate <= $endDate) {
            if ($this->shouldWorkToday($currentDate, $devInfo)) {
                $daySessions = $this->generateDaySessions($devId, $currentDate, $devInfo);
                $sessions = array_merge($sessions, $daySessions);
            }
            $currentDate->addDay();
        }
        
        return $sessions;
    }

    private function shouldWorkToday($date, $devInfo)
    {
        $isWeekday = $date->isWeekday();
        $baseProbability = $isWeekday ? 0.8 : 0.2;
        
        $adjustedProbability = $baseProbability * $devInfo['work_frequency'];
        
        return (mt_rand() / mt_getrandmax()) <= $adjustedProbability;
    }

    private function generateDaySessions($devId, $date, $devInfo)
    {
        $sessionCount = $this->getSessionCount($devInfo['session_pattern']);
        $sessions = [];
        
        for ($i = 0; $i < $sessionCount; $i++) {
            $session = $this->generateSession($devId, $date, $devInfo, $i);
            if ($session) {
                $sessions[] = $session;
            }
        }
        
        return $sessions;
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

    private function generateSession($devId, $date, $devInfo, $sessionIndex)
    {
        $ide = $this->selectIDE($devId);
        $duration = $this->getSessionDuration($devInfo['session_pattern']);
        $aiData = $this->generateAIData($devInfo['ai_intensity'], $duration);
        
        // Calculate session timing
        $hour = 9 + ($sessionIndex * 3) + rand(-1, 1);
        $hour = max(8, min(18, $hour));
        
        $startTime = $date->copy()->setTime($hour, rand(0, 59));
        $endTime = $startTime->copy()->addMinutes($duration);
        
        return [
            'user_id' => "simulation_{$devId}",
            'repo' => 'https://github.com/demo-org/demo-sim.git',
            'created_at' => $startTime,
            'updated_at' => $startTime,
            'ide_name' => $ide,
            'cursor_insertions' => $this->getInsertionsForIDE($ide, 'cursor', $aiData),
            'windsurf_insertions' => $this->getInsertionsForIDE($ide, 'windsurf', $aiData),
            'vscode_insertions' => $this->getInsertionsForIDE($ide, 'vscode', $aiData),
            'jetbrains_insertions' => $this->getInsertionsForIDE($ide, 'jetbrains', $aiData),
            'session_duration' => $duration * 60, // in seconds
            'keystrokes_per_minute' => $aiData['chars_per_min'],
            'files_edited' => $this->getFilesEdited($devInfo['archetype'], $duration),
            'commits_per_session' => $this->getCommitsPerSession($devInfo['archetype']),
            'time_to_first_commit' => $this->getTimeToFirstCommit($devInfo['archetype']),
            'project_name' => 'demo-sim',
            'branch' => 'main'
        ];
    }

    private function selectIDE($devId)
    {
        $distribution = $this->ideDistribution[$devId];
        $rand = mt_rand() / mt_getrandmax();
        $cumulative = 0;
        
        foreach ($distribution as $ide => $probability) {
            $cumulative += $probability;
            if ($rand <= $cumulative) {
                return $ide;
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

    private function generateAIData($intensity, $duration)
    {
        $multiplier = $this->getAIMultiplier($intensity);
        $burstCount = max(1, intval($duration / 30) * $multiplier);
        
        $charsPerBurst = $this->getCharsPerBurst($intensity);
        $totalChars = $burstCount * $charsPerBurst * (0.8 + (mt_rand() / mt_getrandmax()) * 0.4);
        $totalLines = intval($totalChars / 50);
        
        return [
            'burst_count' => $burstCount,
            'first_burst_at' => 5000,
            'last_burst_at' => ($duration * 60 * 1000) - 10000,
            'chars_total' => intval($totalChars),
            'lines_total' => $totalLines,
            'active_span' => ($duration * 60 * 1000) * 0.6,
            'chars_per_min' => intval($totalChars / ($duration * 0.6))
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

    private function getExtensionVersion($ide)
    {
        $versions = [
            'cursor' => '0.3.7',
            'windsurf' => '0.3.7', 
            'vscode' => '0.3.7',
            'claude_code' => '0.3.7',
            'github_copilot' => '0.3.7'
        ];
        return $versions[$ide] ?? '0.3.7';
    }

    private function getEndReason($archetype)
    {
        $reasons = [
            'ai_heavy_fast_mover' => 'idle',
            'disciplined_senior' => 'idle',
            'reviewer_bottleneck' => 'idle',
            'inconsistent_adopter' => ['idle', 'manual'][rand(0, 1)],
            'high_output_risky' => 'idle',
            'low_output_stable' => 'idle'
        ];
        return $reasons[$archetype] ?? 'idle';
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

    private function seedGitHubActivity()
    {
        $this->info('Seeding GitHub activity (PRs, reviews, commits)...');
        
        // This will be implemented in the next phase
        // For now, we'll focus on telemetry to validate the approach
        
        $this->info('✓ GitHub activity seeding completed (placeholder)');
    }

    private function validateSimulation()
    {
        $this->info('Validating simulation results...');
        
        $uniqueDevs = CursorUsage::distinct('user_id')
            ->where('user_id', 'like', 'simulation_%')
            ->count();
            
        $totalSessions = CursorUsage::where('user_id', 'like', 'simulation_%')
            ->count();
        
        $this->info("✓ Unique developers: {$uniqueDevs}");
        $this->info("✓ Total sessions: {$totalSessions}");
        
        if ($uniqueDevs >= 6) {
            $this->info('✓ Multi-developer simulation validated successfully');
        } else {
            $this->warn('⚠ Expected 6 developers, found ' . $uniqueDevs);
        }
    }

    private function generateFileName($archetype)
    {
        $filePatterns = [
            'ai_heavy_fast_mover' => ['Component.php', 'Controller.php', 'Service.php', 'Model.php'],
            'disciplined_senior' => ['Architecture.php', 'Interface.php', 'Repository.php', 'Config.php'],
            'reviewer_bottleneck' => ['Review.php', 'Merge.php', 'Approval.php', 'Gatekeeper.php'],
            'inconsistent_adopter' => ['Experimental.php', 'Test.php', 'Prototype.php', 'Draft.php'],
            'high_output_risky' => ['Feature.php', 'Endpoint.php', 'Migration.php', 'Route.php'],
            'low_output_stable' => ['Fix.php', 'Patch.php', 'Update.php', 'Maintenance.php']
        ];
        
        $files = $filePatterns[$archetype] ?? ['File.php'];
        return $files[array_rand($files)];
    }

    private function getInsertionsForIDE($currentIDE, $targetIDE, $aiData)
    {
        if ($currentIDE === $targetIDE) {
            // Primary IDE gets most of the AI insertions
            return intval($aiData['lines_total'] * 0.8);
        } else {
            // Secondary/other IDEs get minimal insertions
            return intval($aiData['lines_total'] * 0.1);
        }
    }

    private function getFilesEdited($archetype, $duration)
    {
        $baseFiles = [
            'ai_heavy_fast_mover' => 3,
            'disciplined_senior' => 2,
            'reviewer_bottleneck' => 2,
            'inconsistent_adopter' => 4,
            'high_output_risky' => 5,
            'low_output_stable' => 1
        ];
        
        $base = $baseFiles[$archetype] ?? 2;
        return max(1, intval($base * ($duration / 120))); // Scale by session duration
    }

    private function getCommitsPerSession($archetype)
    {
        $patterns = [
            'ai_heavy_fast_mover' => [1, 2, 3],
            'disciplined_senior' => [1, 1, 2],
            'reviewer_bottleneck' => [0, 1, 1],
            'inconsistent_adopter' => [0, 1, 2],
            'high_output_risky' => [2, 3, 4],
            'low_output_stable' => [0, 0, 1]
        ];
        
        $commits = $patterns[$archetype] ?? [1, 1, 1];
        return $commits[array_rand($commits)];
    }

    private function getTimeToFirstCommit($archetype)
    {
        $patterns = [
            'ai_heavy_fast_mover' => [5, 10, 15],
            'disciplined_senior' => [15, 30, 45],
            'reviewer_bottleneck' => [20, 40, 60],
            'inconsistent_adopter' => [10, 25, 45],
            'high_output_risky' => [3, 8, 12],
            'low_output_stable' => [30, 45, 60]
        ];
        
        $times = $patterns[$archetype] ?? [15, 30, 45];
        return $times[array_rand($times)];
    }

    private function displayResults()
    {
        $this->newLine();
        $this->info('📊 SIMULATION RESULTS:');
        $this->newLine();
        
        foreach ($this->developers as $devId => $devInfo) {
            $sessionCount = CursorUsage::where('user_id', "simulation_{$devId}")->count();
            $this->line("  {$devInfo['name']}: {$sessionCount} sessions");
        }
        
        $this->newLine();
        $this->info('🎯 Next Steps:');
        $this->line('  1. Test API endpoints to verify multi-developer metrics');
        $this->line('  2. Implement GitHub activity seeding');
        $this->line('  3. Add review dynamics and PR size distribution');
        $this->line('  4. Create deployment outcome narratives');
    }
}
