<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;

class RunDemoDataSeeder extends Seeder
{
    /**
     * Run the complete Performance Insights demo data seeding process
     */
    public function run(): void
    {
        Log::info('=== Starting Performance Insights Demo Data Seeding ===');

        try {
            // Clear existing demo data (optional - uncomment if needed)
            // $this->clearDemoData();

            // Step 1: Run telemetry seeding
            Log::info('Step 1: Seeding telemetry sessions...');
            $this->call(PerformanceInsightsDemoSeeder::class);

            // Step 2: Run GitHub data seeding
            Log::info('Step 2: Seeding GitHub data...');
            $this->call(PerformanceInsightsGitHubDemoSeeder::class);

            // Step 3: Update demo data tracking
            Log::info('Step 3: Updating demo data tracking...');
            $this->updateDemoDataTracking();

            // Step 4: Verify data integrity
            Log::info('Step 4: Verifying data integrity...');
            $this->verifyDataIntegrity();

            Log::info('=== Performance Insights Demo Data Seeding Complete ===');
            
            // Print summary
            $this->printSummary();

        } catch (\Exception $e) {
            Log::error('Demo data seeding failed: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * Clear existing demo data (use with caution)
     */
    private function clearDemoData(): void
    {
        Log::warning('Clearing existing demo data...');
        
        // Clear demo telemetry events
        DB::table('telemetry_events')
            ->where('editor_source', 'like', 'demo-%')
            ->delete();

        // Clear demo pull requests
        DB::table('pull_requests')
            ->where('author_login', 'like', 'Demo % User %')
            ->delete();

        // Clear demo deployments
        DB::table('deployments')
            ->where('creator_login', 'like', 'Demo % User %')
            ->delete();

        // Clear demo users
        DB::table('users')
            ->where('email', 'like', 'demo-%@example.com')
            ->delete();

        Log::info('Demo data cleared');
    }

    /**
     * Update demo data tracking in a simple stats table
     */
    private function updateDemoDataTracking(): void
    {
        $stats = [
            'telemetry_sessions' => DB::table('telemetry_events')
                ->where('event_type', 'session')
                ->where('editor_source', 'like', 'demo-%')
                ->count(),
            
            'ai_accept_events' => DB::table('telemetry_events')
                ->where('event_type', 'ai_accept')
                ->where('editor_source', 'like', 'demo-%')
                ->count(),
            
            'commit_events' => DB::table('telemetry_events')
                ->where('event_type', 'commit')
                ->where('editor_source', 'like', 'demo-%')
                ->count(),
            
            'pull_requests' => DB::table('pull_requests')
                ->where('author_login', 'like', 'Demo % User %')
                ->count(),
            
            'deployments' => DB::table('deployments')
                ->where('creator_login', 'like', 'Demo % User %')
                ->count(),
            
            'cursor_sessions' => DB::table('telemetry_events')
                ->where('event_type', 'session')
                ->where('editor_source', 'cursor')
                ->count(),
            
            'windsurf_sessions' => DB::table('telemetry_events')
                ->where('event_type', 'session')
                ->where('editor_source', 'windsurf')
                ->count(),
            
            'vscode_sessions' => DB::table('telemetry_events')
                ->where('event_type', 'session')
                ->where('editor_source', 'vscode')
                ->count(),
        ];

        Log::info('Demo data statistics:', $stats);
        
        // Store in cache for frontend access
        cache()->put('demo_data_stats', $stats, 3600); // 1 hour
    }

    /**
     * Verify data integrity and relationships
     */
    private function verifyDataIntegrity(): void
    {
        $issues = [];

        // Check if we have sessions for all IDEs
        $cursorSessions = DB::table('telemetry_events')
            ->where('event_type', 'session')
            ->where('editor_source', 'cursor')
            ->count();

        $windsurfSessions = DB::table('telemetry_events')
            ->where('event_type', 'session')
            ->where('editor_source', 'windsurf')
            ->count();

        $vscodeSessions = DB::table('telemetry_events')
            ->where('event_type', 'session')
            ->where('editor_source', 'vscode')
            ->count();

        if ($cursorSessions < 20) $issues[] = "Cursor sessions too low: {$cursorSessions}";
        if ($windsurfSessions < 20) $issues[] = "Windsurf sessions too low: {$windsurfSessions}";
        if ($vscodeSessions < 20) $issues[] = "VS Code sessions too low: {$vscodeSessions}";

        // Check if we have GitHub data
        $prCount = DB::table('pull_requests')
            ->whereIn('data_source', ['demo', 'realism_seeder'])
            ->count();

        $deploymentCount = DB::table('deployments')
            ->where(function ($query) {
                $query->where('metadata', 'like', '%"data_source"%')
                      ->orWhere('repo_name', 'like', 'demo-org/%')
                      ->orWhere('repo_name', 'like', 'mattmcclintock/%')
                      ->orWhere('repo_name', 'like', 'AngryMonkeyParty/%');
            })
            ->count();

        if ($prCount < 20) $issues[] = "Pull requests too low: {$prCount}";
        if ($deploymentCount < 10) $issues[] = "Deployments too low: {$deploymentCount}";

        // Check tool_cost values
        $nullCosts = DB::table('telemetry_events')
            ->where('event_type', 'session')
            ->where('editor_source', 'like', 'demo-%')
            ->whereNull('tool_cost')
            ->count();

        if ($nullCosts > 0) $issues[] = "Sessions with null tool_cost: {$nullCosts}";

        $invalidReviewCounts = DB::table('pull_requests')
            ->where(function ($query) {
                $query->where('review_count', '<=', 0)
                      ->orWhere('review_count', '>', 20);
            })
            ->count();

        $invalidReviewComments = DB::table('pull_requests')
            ->where(function ($query) {
                $query->where('review_comments', '<', 0)
                      ->orWhere('review_comments', '>', 20);
            })
            ->count();

        if ($invalidReviewCounts > 0) {
            $issues[] = "Pull requests with invalid review_count: {$invalidReviewCounts}";
        }

        if ($invalidReviewComments > 0) {
            $issues[] = "Pull requests with invalid review_comments: {$invalidReviewComments}";
        }

        if (!empty($issues)) {
            Log::warning('Data integrity issues found:', $issues);
        } else {
            Log::info('Data integrity verification passed');
        }
    }

    /**
     * Print summary of seeded data
     */
    private function printSummary(): void
    {
        $summary = [
            'Demo Data Seeding Summary',
            '========================',
            '',
            'IDE Cohorts:',
            '- Cursor: High AI usage, high performance, $40/month',
            '- Windsurf: Moderate usage, $30/month', 
            '- VS Code: Low AI usage, $0/month',
            '',
            'Data Volumes:',
            '- ~90 total sessions (30 per IDE)',
            '- ~35 pull requests (aligned with IDE patterns)',
            '- ~24 deployments (aligned with PR patterns)',
            '',
            'Expected Insights:',
            '- Clear IDE cost vs performance comparisons',
            '- AI adoption vs efficiency patterns',
            '- PR quality vs tool usage correlations',
            '',
            'Debug Tracking:',
            '- CM DEBUG SNAPSHOT includes demoData object',
            '- Tool costs and injection counts tracked',
            '',
            'To view results:',
            '1. Run: php artisan db:seed --class=RunDemoDataSeeder',
            '2. Visit: /dashboards?v2=1',
            '3. Check console for: CM DEBUG SNAPSHOT',
        ];

        foreach ($summary as $line) {
            echo $line . PHP_EOL;
        }

        Log::info('Demo data seeding summary printed to console');
    }
}
