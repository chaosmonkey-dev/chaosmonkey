<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

class TelemetryEvent extends Model
{
    use HasFactory;

    /**
     * Orphan rate threshold for warning logs (5%)
     */
    const ORPHAN_RATE_WARNING_THRESHOLD = 0.05;

    /**
     * Cache TTL for orphan rate calculation (5 minutes)
     */
    const ORPHAN_RATE_CACHE_TTL = 300;

    protected $fillable = [
        'organization_id',
        'user_id',
        'session_id',  // Primary join key for session correlation (added 2025-08-13)
        'source',
        'editor_source',  // Canonical tool identifier (cursor/windsurf/vscode) extracted from metadata
        'event_type',
        'count',
        'payload',
        'duration_ms',
        'timestamp',
        'metadata',
        'batch_hash',
        'event_id', // P0-G: per-event idempotency key for durable replay
        'session_prs_created', // PR creation count (for Review & Merge insights)
        'session_prs_merged', // PR merge count (for Review & Merge insights)
        'session_pr_reopen_count', // PR reopen count (for Review & Merge insights)
        'session_deployment_successes', // Deployment success count (for Deploy & Operate insights)
    ];

    protected $casts = [
        'metadata' => 'array',
        'timestamp' => 'datetime',
        'payload' => 'array',
    ];

    // =========================================================================
    // SESSION-ELIGIBLE SCOPES (for session analytics)
    // =========================================================================
    // These scopes ensure session-level queries never include orphan events
    // (events without session_id that cannot be correlated to a session).
    // =========================================================================

    /**
     * GLOBAL SCOPE: Session-eligible events only
     * 
     * Use this scope for ANY session-level analytics query.
     * This is the PRIMARY safeguard against orphan event pollution.
     * 
     * Events are session-eligible if:
     * - session_id IS NOT NULL
     * 
     * @param Builder $query
     * @return Builder
     */
    public function scopeSessionEligible(Builder $query): Builder
    {
        return $query->whereNotNull('session_id');
    }

    /**
     * Scope for session analytics with orphan rate warning
     * 
     * This is the RECOMMENDED scope for session dashboards.
     * It applies the sessionEligible filter AND logs a warning if orphan rate exceeds threshold.
     * 
     * @param Builder $query
     * @return Builder
     */
    public function scopeForSessionAnalytics(Builder $query): Builder
    {
        // Check orphan rate (cached, non-blocking)
        static::checkOrphanRateAsync();
        
        // Apply session-eligible filter
        return $query->sessionEligible();
    }

    /**
     * Scope to filter session events, excluding legacy interval segments
     * 
     * NOTE:
     * Older extension versions (0.2.x and earlier) emitted 30-second "interval" session events.
     * As of extension 0.3.0, we only use metadata.segment_type = "session" for session metrics.
     * Legacy "interval" and "full_session" segments are ignored.
     * 
     * This scope includes:
     * - Events where segment_type IS NULL (legacy events before segment_type existed)
     * - Events where segment_type = 'session' (new model as of extension 0.3.0)
     * 
     * This scope excludes:
     * - Events where segment_type = 'interval' (old 30-second segments)
     * - Events where segment_type = 'full_session' (older version)
     * 
     * @param Builder $query
     * @return Builder
     */
    public function scopeSessionEvents(Builder $query): Builder
    {
        return $query->where('event_type', 'session')
                    ->sessionEligible()  // ADDED: Exclude orphan events
                    ->where(function ($q) {
                        // Only include NULL (legacy) or 'session' (new model)
                        // This implicitly excludes 'interval' and 'full_session'
                        $q->whereNull('metadata->segment_type')
                          ->orWhere('metadata->segment_type', 'session');
                    });
    }

    /**
     * Scope to get only new-style session events (segment_type = 'session')
     * This is the preferred scope for session metrics as of extension 0.3.0
     * 
     * NOTE: This scope automatically excludes orphan events via sessionEligible()
     * 
     * @param Builder $query
     * @return Builder
     */
    public function scopeNewSessionEvents(Builder $query): Builder
    {
        return $query->where('event_type', 'session')
                    ->sessionEligible()  // Exclude orphan events
                    ->where('metadata->segment_type', 'session');
    }

    /**
     * Scope to get all events for a specific session
     * Uses the session_id column (primary join key)
     * 
     * @param Builder $query
     * @param string $sessionId
     * @return Builder
     */
    public function scopeForSession(Builder $query, string $sessionId): Builder
    {
        return $query->where('session_id', $sessionId);
    }

    /**
     * Scope to get events that have a session_id (can be correlated)
     * 
     * @param Builder $query
     * @return Builder
     */
    public function scopeWithSessionId(Builder $query): Builder
    {
        return $query->whereNotNull('session_id');
    }

    /**
     * Scope to get events that are missing session_id (legacy/orphan events)
     * 
     * @param Builder $query
     * @return Builder
     */
    public function scopeWithoutSessionId(Builder $query): Builder
    {
        return $query->whereNull('session_id');
    }

    /**
     * Get all events in the same session as this event
     * 
     * @return \Illuminate\Database\Eloquent\Collection
     */
    public function getSessionEvents()
    {
        if (empty($this->session_id)) {
            return collect([$this]);
        }
        
        return static::forSession($this->session_id)
            ->orderBy('timestamp')
            ->get();
    }

    /**
     * Get the session summary event for this event's session
     * 
     * @return TelemetryEvent|null
     */
    public function getSessionSummary(): ?TelemetryEvent
    {
        if (empty($this->session_id)) {
            return null;
        }
        
        return static::forSession($this->session_id)
            ->where('event_type', 'session')
            ->first();
    }

    // =========================================================================
    // ORPHAN RATE MONITORING (WINDOWED)
    // =========================================================================
    // 
    // Orphan rate is calculated over a time window to detect recent regressions,
    // not historical baggage. Default window is 7 days.
    //
    // Window options:
    // - 7 (default): Last 7 days
    // - 30: Last 30 days
    // - null: All-time (not recommended for production monitoring)
    // =========================================================================

    /**
     * Build cache key suffix for a given window
     * 
     * @param ?int $days Window in days (null = all-time)
     * @return string Cache key suffix
     */
    private static function getWindowCacheKeySuffix(?int $days): string
    {
        return $days === null ? 'all' : "{$days}d";
    }

    /**
     * Get human-readable window description
     * 
     * @param ?int $days Window in days (null = all-time)
     * @return string Human-readable description
     */
    private static function getWindowDescription(?int $days): string
    {
        if ($days === null) {
            return 'all-time period';
        }
        return "last {$days} days";
    }

    /**
     * Calculate orphan rate for a given time window
     * 
     * @param bool $useCache Whether to use cached value (default: true)
     * @param ?int $days Window in days (default: 7, null = all-time)
     * @param ?int $organizationId Organization ID for multi-tenant scoping
     * @return array{orphan_count: int, total_count: int, orphan_rate: float, exceeds_threshold: bool, window_days: int|string}
     */
    public static function calculateOrphanRate(bool $useCache = true, ?int $days = 7, ?int $organizationId = null): array
    {
        $windowSuffix = static::getWindowCacheKeySuffix($days);
        $orgSuffix = $organizationId ? "_org_{$organizationId}" : "";
        $cacheKey = "telemetry_orphan_rate_stats_{$windowSuffix}{$orgSuffix}";
        
        if ($useCache) {
            $cached = Cache::get($cacheKey);
            if ($cached !== null) {
                return $cached;
            }
        }
        
        // Build base query with time window filter
        $baseQuery = static::query();
        if ($days !== null) {
            $baseQuery->where('timestamp', '>=', now()->subDays($days));
        }
        
        // Add organization scoping if provided
        if ($organizationId !== null) {
            $baseQuery->where(function($q) use ($organizationId) {
                $q->where('organization_id', $organizationId)
                  ->orWhereNull('organization_id'); // Include legacy data
            });
        }
        
        $totalCount = (clone $baseQuery)->count();
        $orphanCount = (clone $baseQuery)->whereNull('session_id')->count();
        
        $orphanRate = $totalCount > 0 ? $orphanCount / $totalCount : 0.0;
        $exceedsThreshold = $orphanRate > static::ORPHAN_RATE_WARNING_THRESHOLD;
        
        $result = [
            'organization_id' => $organizationId,
            'orphan_count' => $orphanCount,
            'total_count' => $totalCount,
            'session_eligible_count' => $totalCount - $orphanCount,
            'orphan_rate' => round($orphanRate, 4),
            'orphan_rate_percent' => round($orphanRate * 100, 2),
            'exceeds_threshold' => $exceedsThreshold,
            'threshold_percent' => static::ORPHAN_RATE_WARNING_THRESHOLD * 100,
            'window_days' => $days ?? 'all',
            'window_description' => static::getWindowDescription($days),
            'calculated_at' => now()->toISOString(),
        ];
        
        // Cache for TTL (5 minutes)
        Cache::put($cacheKey, $result, static::ORPHAN_RATE_CACHE_TTL);
        
        return $result;
    }

    /**
     * Check orphan rate and log warning if it exceeds threshold
     * TTL-gated: warns at most once per TTL per window to avoid log spam
     * Non-blocking: uses cached value if available
     * 
     * @param ?int $days Window in days (default: 7, null = all-time)
     * @return void
     */
    public static function checkOrphanRateAsync(?int $days = 7): void
    {
        try {
            $stats = static::calculateOrphanRate(true, $days);
            
            if ($stats['exceeds_threshold']) {
                // TTL-gated warning: only warn once per TTL per window
                $windowSuffix = static::getWindowCacheKeySuffix($days);
                $warnGateKey = "telemetry_orphan_rate_warned_{$windowSuffix}";
                
                // Check if we've already warned within the TTL
                if (Cache::has($warnGateKey)) {
                    // Already warned recently for this window, skip
                    return;
                }
                
                // Set the warn gate (expires at same TTL as stats cache)
                Cache::put($warnGateKey, true, static::ORPHAN_RATE_CACHE_TTL);
                
                Log::warning('[TelemetryEvent] Orphan rate exceeds threshold', [
                    'orphan_rate_percent' => $stats['orphan_rate_percent'],
                    'threshold_percent' => $stats['threshold_percent'],
                    'orphan_count' => $stats['orphan_count'],
                    'total_count' => $stats['total_count'],
                    'session_eligible_count' => $stats['session_eligible_count'],
                    'window_days' => $stats['window_days'],
                    'window_description' => $stats['window_description'],
                    'calculated_at' => $stats['calculated_at'],
                    'action' => "Investigate extension regressions or legacy events in the {$stats['window_description']}",
                ]);
            }
        } catch (\Throwable $e) {
            // Non-blocking: don't fail the request if orphan rate check fails
            Log::debug('[TelemetryEvent] Failed to check orphan rate: ' . $e->getMessage());
        }
    }

    /**
     * Get orphan rate statistics for a given window
     * 
     * @param ?int $days Window in days (default: 7, null = all-time)
     * @param ?int $organizationId Organization ID for multi-tenant scoping
     * @return array
     */
    public static function getOrphanRateStats(?int $days = 7, ?int $organizationId = null): array
    {
        return static::calculateOrphanRate(false, $days, $organizationId);
    }

    /**
     * Get breakdown of orphan events by event_type for a given window
     * 
     * @param ?int $days Window in days (default: 7, null = all-time)
     * @param ?int $organizationId Organization ID for multi-tenant scoping
     * @return \Illuminate\Support\Collection
     */
    public static function getOrphanBreakdown(?int $days = 7, ?int $organizationId = null): \Illuminate\Support\Collection
    {
        $windowSuffix = static::getWindowCacheKeySuffix($days);
        $orgSuffix = $organizationId ? "_org_{$organizationId}" : "";
        $cacheKey = "telemetry_orphan_rate_breakdown_{$windowSuffix}{$orgSuffix}";
        
        // Check cache first
        $cached = Cache::get($cacheKey);
        if ($cached !== null) {
            return collect($cached);
        }
        
        // Build query with time window filter
        $query = static::withoutSessionId();
        if ($days !== null) {
            $query->where('timestamp', '>=', now()->subDays($days));
        }
        
        // Add organization scoping if provided
        if ($organizationId !== null) {
            $query->where(function($q) use ($organizationId) {
                $q->where('organization_id', $organizationId)
                  ->orWhereNull('organization_id'); // Include legacy data
            });
        }
        
        $breakdown = $query
            ->selectRaw('event_type, COUNT(*) as count')
            ->groupBy('event_type')
            ->orderByDesc('count')
            ->get();
        
        // Cache the breakdown
        Cache::put($cacheKey, $breakdown->toArray(), static::ORPHAN_RATE_CACHE_TTL);
        
        return $breakdown;
    }

    /**
     * Get the organization that owns the telemetry event.
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
