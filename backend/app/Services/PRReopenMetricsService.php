<?php

namespace App\Services;

use App\Models\PullRequest;
use Illuminate\Support\Facades\Log;
use DB;

use App\Traits\SchemaCapable;

class PRReopenMetricsService
{
    use SchemaCapable;

    /**
     * Update reopen metrics for a single PR
     */
    public function updatePRReopenMetrics($owner, $repo, $prNumber, $events)
    {
        // CR-X 5A: Fail closed if the enrichment column is not present.
        if (!$this->prHasReopenColumn()) {
            Log::warning('PR reopen metrics skipped: schema does not support pr_reopened_count');
            return false;
        }

        try {
            // Calculate reopen count from events
            $reopenCount = 0;
            
            foreach ($events as $event) {
                // Count events where event type is "reopened"
                if (isset($event['event']) && $event['event'] === 'reopened') {
                    $reopenCount++;
                }
            }
            
            // Update the PR record
            $updated = PullRequest::where('repo_name', "{$owner}/{$repo}")
                ->where('pr_number', $prNumber)
                ->update([
                    'pr_reopened_count' => $reopenCount,
                    'updated_at' => now(),
                ]);
            
            if ($updated) {
                Log::info('Updated PR reopen metrics', [
                    'repo' => "{$owner}/{$repo}",
                    'pr_number' => $prNumber,
                    'pr_reopened_count' => $reopenCount
                ]);
                return true;
            } else {
                Log::warning('PR not found for reopen metrics update', [
                    'repo' => "{$owner}/{$repo}",
                    'pr_number' => $prNumber
                ]);
                return false;
            }
            
        } catch (\Exception $e) {
            Log::error('Failed to update PR reopen metrics', [
                'repo' => "{$owner}/{$repo}",
                'pr_number' => $prNumber,
                'error' => $e->getMessage()
            ]);
            return false;
        }
    }
    
    /**
     * Get PRs that need reopen metrics backfill
     */
    public function getPRsNeedingReopenMetrics($days = 30, $limit = 200)
    {
        // CR-X 5A: If the schema does not support the enrichment column,
        // no backfill is possible; return empty without throwing.
        if (!$this->prHasReopenColumn()) {
            Log::warning('getPRsNeedingReopenMetrics: schema does not support pr_reopened_count; returning empty');
            return collect();
        }

        return PullRequest::where(function($query) {
                $query->whereNull('pr_reopened_count')
                      ->orWhere('pr_reopened_count', 0);
            })
            ->where(function($query) use ($days) {
                $query->where('created_at', '>=', now()->subDays($days))
                      ->orWhere('updated_at', '>=', now()->subDays($days))
                      ->orWhere('merged_at', '>=', now()->subDays($days));
            })
            ->orderBy('created_at', 'desc')
            ->limit($limit)
            ->get(['repo_name', 'pr_number', 'created_at', 'merged_at']);
    }
}
