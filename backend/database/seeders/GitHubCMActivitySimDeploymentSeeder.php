<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class GitHubCMActivitySimDeploymentSeeder extends Seeder
{
    /**
     * Run database seeds.
     * Adds simulated deployments from cm-activity-sim to bring deployment data to June 2026
     * Date: June 22, 2026
     */
    public function run(): void
    {
        Log::info('[CM_ACTIVITY_SIM_DEPLOYMENT_SEEDER] Starting CM Activity Sim deployment seeding');
        
        $repoName = 'mattmcclintock/cm-activity-sim';
        // Use base date of June 20 to match PR seeder timing
        // Latest deployment will be at hour 60 from base, which is June 22 12:00
        $baseDate = Carbon::parse('2026-06-20');
        
        $deployments = [];
        
        // Successful deployments (simulating production deploys)
        for ($i = 0; $i < 25; $i++) {
            $deployedAt = $baseDate->copy()->addHours($i * 2.4);
            $environment = ($i % 5 === 0) ? 'staging' : 'production';
            $status = ($i % 10 === 9) ? 'failure' : 'success'; // 10% failure rate
            
            $deployments[] = [
                'repo_name' => $repoName,
                'deployment_status' => $status,
                'environment' => $environment,
                'deployed_at' => $deployedAt,
                'created_at' => $deployedAt,
                'updated_at' => $deployedAt,
                'sha' => null,
                'rollback_detected' => false,
                'metadata' => json_encode(['source' => 'cm_activity_sim']),
            ];
        }
        
        // Insert all deployments
        foreach ($deployments as $deployment) {
            DB::table('deployments')->insert($deployment);
        }
        
        Log::info('[CM_ACTIVITY_SIM_DEPLOYMENT_SEEDER] Created ' . count($deployments) . ' deployments from CM Activity Sim');
        Log::info('[CM_ACTIVITY_SIM_DEPLOYMENT_SEEDER] Success: ' . count(array_filter($deployments, fn($d) => $d['deployment_status'] === 'success')));
        Log::info('[CM_ACTIVITY_SIM_DEPLOYMENT_SEEDER] Failed: ' . count(array_filter($deployments, fn($d) => $d['deployment_status'] === 'failure')));
        Log::info('[CM_ACTIVITY_SIM_DEPLOYMENT_SEEDER] Latest deployment: ' . end($deployments)['deployed_at']);
    }
}
