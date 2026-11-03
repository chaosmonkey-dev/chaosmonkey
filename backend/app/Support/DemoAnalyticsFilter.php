<?php

namespace App\Support;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\Log;

class DemoAnalyticsFilter
{
    /**
     * Apply demo analytics filter to exclude real founder telemetry from analytics computations.
     * 
     * @param Builder|QueryBuilder $query
     * @return Builder|QueryBuilder
     */
    public static function apply($query)
    {
        // If demo mode is not enabled, return query unchanged
        if (!config('demo.enabled')) {
            return $query;
        }

        $excludedUserIds = config('demo.excluded_real_user_ids', []);
        
        if (empty($excludedUserIds)) {
            return $query;
        }

        // Apply the filter: exclude rows where simulated = false AND user_id is in excluded list
        // This preserves ALL simulated data and seeded demo users
        $query->where(function ($query) use ($excludedUserIds) {
            $query->where('simulated', true)
                  ->orWhereNotIn('user_id', $excludedUserIds);
        });

        // Log the filtering for debugging
        $originalCount = $query->count();
        $filteredCount = $query->count();
        $excludedCount = $originalCount - $filteredCount;
        
        if ($excludedCount > 0) {
            Log::info("[DemoAnalyticsFilter] Excluded {$excludedCount} founder telemetry rows from analytics query");
        }

        return $query;
    }

    /**
     * Check if demo mode is enabled.
     * 
     * @return bool
     */
    public static function isEnabled()
    {
        return config('demo.enabled', false);
    }

    /**
     * Get the list of excluded real user IDs.
     * 
     * @return array
     */
    public static function getExcludedUserIds()
    {
        return config('demo.excluded_real_user_ids', []);
    }
}
