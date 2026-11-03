<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Artisan;
use Database\Seeders\RunDemoDataSeeder;

class DemoDataController extends Controller
{
    /**
     * Activate demo data for Performance Insights
     */
    public function activate(Request $request)
    {
        try {
            Log::info('Demo data activation requested');

            // Run the demo data seeder
            $seeder = new RunDemoDataSeeder();
            $seeder->run();

            // Update debug tracking
            $this->updateDebugTracking();

            return response()->json([
                'success' => true,
                'message' => 'Demo data activated successfully',
                'stats' => $this->getDemoStats(),
                'debug_snapshot' => [
                    'demoData' => [
                        'enabled' => true,
                        'sessionsInjected' => $this->getSessionCount(),
                        'prsInjected' => $this->getPRCount(),
                        'deploymentsInjected' => $this->getDeploymentCount(),
                        'toolCosts' => [
                            'cursor' => 40.00,
                            'windsurf' => 30.00,
                            'vscode' => 0.00
                        ]
                    ]
                ]
            ]);

        } catch (\Exception $e) {
            Log::error('Demo data activation failed: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Demo data activation failed: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get demo data statistics
     */
    public function stats()
    {
        return response()->json([
            'success' => true,
            'stats' => $this->getDemoStats(),
            'debug_snapshot' => [
                'demoData' => [
                    'enabled' => $this->isDemoDataEnabled(),
                    'sessionsInjected' => $this->getSessionCount(),
                    'prsInjected' => $this->getPRCount(),
                    'deploymentsInjected' => $this->getDeploymentCount(),
                    'toolCosts' => [
                        'cursor' => 40.00,
                        'windsurf' => 30.00,
                        'vscode' => 0.00
                    ]
                ]
            ]
        ]);
    }

    /**
     * Run demo data seeder via Artisan
     */
    public function runSeeder()
    {
        try {
            Log::info('Demo data seeder execution requested');

            // Capture Artisan output
            Artisan::call('db:seed', [
                '--class' => 'RunDemoDataSeeder'
            ]);

            $artisanOutput = Artisan::output();

            return response()->json([
                'success' => true,
                'message' => 'Demo data seeder executed successfully',
                'output' => $artisanOutput
            ]);

        } catch (\Exception $e) {
            Log::error('Demo data seeder execution failed: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Demo data seeder execution failed: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Clear demo data
     */
    public function clear()
    {
        try {
            Log::warning('Demo data clear requested');

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

            // Clear cache
            Cache::forget('demo_data_stats');

            return response()->json([
                'success' => true,
                'message' => 'Demo data cleared successfully'
            ]);

        } catch (\Exception $e) {
            Log::error('Demo data clear failed: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Demo data clear failed: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get demo data statistics
     */
    private function getDemoStats(): array
    {
        return [
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

            'cost_summary' => [
                'cursor' => [
                    'sessions' => DB::table('telemetry_events')
                        ->where('event_type', 'session')
                        ->where('editor_source', 'cursor')
                        ->count(),
                    'monthly_cost' => 40.00,
                    'total_cost' => 40.00 * 3 // 3 users
                ],
                'windsurf' => [
                    'sessions' => DB::table('telemetry_events')
                        ->where('event_type', 'session')
                        ->where('editor_source', 'windsurf')
                        ->count(),
                    'monthly_cost' => 30.00,
                    'total_cost' => 30.00 * 3 // 3 users
                ],
                'vscode' => [
                    'sessions' => DB::table('telemetry_events')
                        ->where('event_type', 'session')
                        ->where('editor_source', 'vscode')
                        ->count(),
                    'monthly_cost' => 0.00,
                    'total_cost' => 0.00
                ]
            ]
        ];
    }

    /**
     * Update debug tracking for frontend
     */
    private function updateDebugTracking(): void
    {
        $tracking = [
            'enabled' => true,
            'sessionsInjected' => $this->getSessionCount(),
            'prsInjected' => $this->getPRCount(),
            'deploymentsInjected' => $this->getDeploymentCount(),
            'toolCosts' => [
                'cursor' => 40.00,
                'windsurf' => 30.00,
                'vscode' => 0.00
            ],
            'activatedAt' => now()->toISOString()
        ];

        Cache::put('demo_data_debug_tracking', $tracking, 3600); // 1 hour
        Log::info('Demo data debug tracking updated', $tracking);
    }

    /**
     * Check if demo data is enabled
     */
    private function isDemoDataEnabled(): bool
    {
        return Cache::has('demo_data_debug_tracking');
    }

    /**
     * Get session count
     */
    private function getSessionCount(): int
    {
        return DB::table('telemetry_events')
            ->where('event_type', 'session')
            ->where('editor_source', 'like', 'demo-%')
            ->count();
    }

    /**
     * Get PR count
     */
    private function getPRCount(): int
    {
        return DB::table('pull_requests')
            ->where('author_login', 'like', 'Demo % User %')
            ->count();
    }

    /**
     * Get deployment count
     */
    private function getDeploymentCount(): int
    {
        return DB::table('deployments')
            ->where('creator_login', 'like', 'Demo % User %')
            ->count();
    }
}
