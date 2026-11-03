<?php

namespace App\Services;

use App\Models\PullRequest;
use Illuminate\Support\Facades\Log;
use DB;

use App\Traits\SchemaCapable;

class PRReviewMetricsService
{
    use SchemaCapable;

    /**
     * Update review metrics for a single PR
     */
    public function updatePRReviewMetrics($owner, $repo, $prNumber, $reviews)
    {
        // CR-X 5A: Fail closed if the enrichment columns are not present.
        if (!$this->prHasReviewColumns()) {
            Log::warning('PR review metrics skipped: schema does not support first_review_at/unique_reviewer_count');
            return false;
        }

        try {
            // Calculate metrics from reviews
            $firstReviewAt = null;
            $reviewCount = 0;
            $uniqueReviewers = [];
            
            foreach ($reviews as $review) {
                // Only count submitted reviews (not pending or dismissed)
                if (isset($review['state']) && $review['state'] === 'APPROVED' || $review['state'] === 'CHANGES_REQUESTED') {
                    $reviewCount++;
                    
                    // Track unique reviewers
                    if (isset($review['user']['login'])) {
                        $uniqueReviewers[] = $review['user']['login'];
                    }
                    
                    // Find first review time
                    if (isset($review['submitted_at']) && $firstReviewAt === null) {
                        $firstReviewAt = $review['submitted_at'];
                    } elseif (isset($review['submitted_at']) && $firstReviewAt > $review['submitted_at']) {
                        $firstReviewAt = $review['submitted_at'];
                    }
                }
            }
            
            $uniqueReviewerCount = count(array_unique($uniqueReviewers));
            
            // Update the PR record
            $updated = PullRequest::where('repo_name', "{$owner}/{$repo}")
                ->where('pr_number', $prNumber)
                ->update([
                    'first_review_at' => $firstReviewAt,
                    'review_count' => $reviewCount,
                    'unique_reviewer_count' => $uniqueReviewerCount,
                    'updated_at' => now(),
                ]);
            
            if ($updated) {
                Log::info('Updated PR review metrics', [
                    'repo' => "{$owner}/{$repo}",
                    'pr_number' => $prNumber,
                    'first_review_at' => $firstReviewAt,
                    'review_count' => $reviewCount,
                    'unique_reviewer_count' => $uniqueReviewerCount
                ]);
                return true;
            } else {
                Log::warning('PR not found for review metrics update', [
                    'repo' => "{$owner}/{$repo}",
                    'pr_number' => $prNumber
                ]);
                return false;
            }
            
        } catch (\Exception $e) {
            Log::error('Failed to update PR review metrics', [
                'repo' => "{$owner}/{$repo}",
                'pr_number' => $prNumber,
                'error' => $e->getMessage()
            ]);
            return false;
        }
    }
    
    /**
     * Get PRs that need review metrics backfill
     */
    public function getPRsNeedingReviewMetrics($days = 30, $limit = 200)
    {
        // CR-X 5A: If the schema does not support these enrichment columns,
        // no backfill is possible; return empty without throwing.
        if (!$this->prHasReviewColumns()) {
            Log::warning('getPRsNeedingReviewMetrics: schema does not support first_review_at/unique_reviewer_count; returning empty');
            return collect();
        }

        return PullRequest::where(function($query) {
                $query->whereNull('first_review_at')
                      ->orWhere('review_count', 0)
                      ->orWhere('unique_reviewer_count', 0);
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
