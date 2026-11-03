/**
 * Data Access Layer for Final Canonical Performance Insights
 * 
 * This module fetches and normalizes live API data for canonical PI generation.
 * 
 * DATA SOURCES:
 * - /api/metrics - GitHub snapshot, deployment metrics, PR analytics
 * - /api/telemetry - Raw telemetry events
 * - /api/telemetry/sessions - Session-level primitives
 * 
 * No imports from old V2 systems (computeV2PerformanceInsights.ts, piV2Manifest.ts)
 */

import type { CanonicalInsightInput } from './types';
import { buildApiUrl } from '../../../utils/apiUrl';
import { isLocalLabMode } from '../runtimeMode';
import { authenticatedFetch } from '../../../config/api';
import { normalizeToCanonicalToolId } from '../../workflowIdentity';
import { computeObservedCommitTtfcByWorkflow, type ObservedCommitTtfcAuthority } from './observedCommitAuthority';
import { piDebugLog, piDebugWarn } from './utils/logging';
import { computeTimeSemantics, computeConcurrency } from '../../intervalUnion';
import { resolveSurface, isMetricAvailable } from '../../surfaceAgentContract';
import { ALL_TIME_START } from '../../../stores/analysisContext';

/**
 * Fetch live data from APIs and build CanonicalInsightInput
 * 
 * This is the main data access function that:
 * 1. Fetches session primitives from /api/telemetry/sessions
 * 2. Fetches GitHub snapshot from /api/metrics
 * 3. Fetches GitHub by-period data from /api/metrics
 * 4. Normalizes data into CanonicalInsightInput format
 * 5. Adds derived fields (session_has_ai_activity)
 * 
 * @param granularity - Time granularity for data aggregation
 * @returns Normalized input data for canonical PI generation
 */
export async function fetchCanonicalInsightInput(
  granularity: 'day' | 'week' | 'month' | 'quarter' = 'week'
): Promise<CanonicalInsightInput> {
  piDebugLog('[DATA_ACCESS][START]', 'Fetching canonical insight input data');
  piDebugLog('[DATA_ACCESS][ENTRY_POINT]', 'dataAccess.ts is now executing (not bypassed)');

  // Check if we're in stress/demo mode - if so, bypass real API calls
  const isStressMode = typeof window !== 'undefined' && (
    window.location.search.includes('piStress=1') || 
    window.location.search.includes('demoMode=1')
  );
  
  if (isStressMode) {
    piDebugLog('[DATA_ACCESS][DEMO_MODE]', 'Stress/Demo mode detected - bypassing real API calls');
    piDebugLog('[DATA_ACCESS][DEMO_MODE]', 'This should not happen - final engine should use fixture data directly');
    
    // Return empty input to let the stress fixture handle data generation
    // The real issue is that the final engine is calling dataAccess in Demo Mode
    return {
      sessionRows: [],
      githubSnapshot: undefined,
      githubByPeriod: [],
      productivityByPeriod: [],
      granularity
    };
  }

  try {
    // Fetch session primitives
    const sessionRows = await fetchSessionPrimitives();
    
    // Fetch GitHub snapshot (metrics API)
    const githubSnapshot = await fetchGithubSnapshot();
    
    // CR1 Mission 1 / CR4 6C: GitHub Evidence Authority — strip ineligible GitHub
    // evidence at the first stage where it would otherwise reach generators.
    // OAuth connection alone (github_connected) is not evidence; seeded/demo/
    // fixture/realism_seeder/cm_activity_sim provenance must never produce
    // GitHub-dependent numeric claims. Telemetry-backed PI is unaffected
    // because sessionRows is independent of githubSnapshot.
    //
    // CR4 6C FIX: In Local PI Lab mode (localhost), use the mode-aware
    // isGithubEvidenceEligibleCombined() so seeded GitHub evidence is eligible
    // for generator development. In live/customer mode, the strict
    // isGithubEvidenceEligible() gate applies — no seeded fallback.
    const githubEligible = isGithubEvidenceEligibleCombined(githubSnapshot);
    const eligibleGithubSnapshot = githubEligible ? githubSnapshot : undefined;

    if (githubSnapshot && !githubEligible) {
      console.warn('[DATA_ACCESS][GITHUB_EVIDENCE_INELIGIBLE]', {
        reason: 'github_provenance indicates seeded/demo/fixture/simulated source; suppressing GitHub-dependent claims',
        provenance: githubSnapshot.github_provenance
      });
    }

    // Extract githubByPeriod from snapshot (only if eligible)
    const githubByPeriod = eligibleGithubSnapshot?.github_by_period || [];

    // Extract pr_by_period from snapshot (for Unit Economics V1 PR denominators)
    const prByPeriod = eligibleGithubSnapshot?.pr_by_period || [];

    // Extract outcomes_by_month from snapshot (Unit Economics V1 exact-count authority)
    const outcomesByMonth = eligibleGithubSnapshot?.outcomes_by_month || [];
    
    // Productivity by period (if available)
    const productivityByPeriod = eligibleGithubSnapshot?.productivity_by_period || [];

    piDebugLog('[DATA_ACCESS][FETCH_COMPLETE]', {
      sessionRowsCount: sessionRows.length,
      hasGithubSnapshot: !!githubSnapshot,
      githubEligible,
      githubByPeriodCount: githubByPeriod.length,
      productivityByPeriodCount: productivityByPeriod.length
    });

    // CRITICAL: Log session count at dataAccess.ts exit
    piDebugLog('[DATA_ACCESS][EXIT_SESSION_COUNT]', {
      sessionRowsCount: sessionRows.length,
      ideDistribution: Array.from(new Set(sessionRows.map(s => s.tool).filter(Boolean))),
      repoCount: new Set(sessionRows.map(s => s.git_repo_url).filter(Boolean)).size
    });

    // Build normalized input
    const input: CanonicalInsightInput = {
      sessionRows,
      githubSnapshot: eligibleGithubSnapshot,
      githubByPeriod,
      prByPeriod,
      outcomesByMonth,
      productivityByPeriod,
      granularity
    };

    // Add derived fields to session rows
    addDerivedSessionFields(sessionRows);

    // CR-X 1B.1: Expose time semantics as an explicit property on CanonicalInsightInput.
    // Previously attached as non-enumerable _timeSemantics on sessionRows (debug-only).
    // Now available to PI generators as input.timeSemantics.
    try {
      const timeResult = computeTimeSemantics(sessionRows);
      // Also compute concurrency for overlap/concurrency fields
      const concurrencyResult = computeConcurrency(sessionRows);
      input.timeSemantics = {
        agent_compute_time_ms: timeResult.agent_compute_time_ms,
        developer_elapsed_time_ms: timeResult.developer_elapsed_time_ms,
        overlap_time_ms: concurrencyResult.additive_agent_runtime_ms - concurrencyResult.unique_session_wall_clock_span_ms,
        concurrency_ratio: concurrencyResult.parallelism_factor,
        max_concurrent_sessions: concurrencyResult.max_concurrent_sessions,
        developer_count: timeResult.developer_count,
        total_sessions: sessionRows.length,
        valid_sessions: concurrencyResult.valid_interval_sessions,
      };
      // Keep the non-enumerable attachment for backward compatibility
      Object.defineProperty(sessionRows, '_timeSemantics', {
        value: timeResult,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    } catch (e) {
      piDebugLog('[DATA_ACCESS][TIME_SEMANTICS_ERROR]', { error: e instanceof Error ? e.message : String(e) });
    }

    return input;
  } catch (error) {
    console.error('[DATA_ACCESS][ERROR]', 'Failed to fetch canonical insight input', error);
    
    // Return empty input on error (generators will handle missing data gracefully)
    return {
      sessionRows: [],
      githubSnapshot: undefined,
      githubByPeriod: [],
      prByPeriod: [],
      outcomesByMonth: [],
      productivityByPeriod: [],
      granularity
    };
  }
}

/**
 * Fetch session primitives from /api/telemetry/sessions (legacy) or /api/telemetry/canonical (canonical)
 *
 * MIGRATION STATUS: USE_CANONICAL_ENDPOINT flag controls endpoint selection
 * - Legacy endpoint: /api/telemetry/sessions (4,337 sessions, uses session_commits field)
 * - Canonical endpoint: /api/telemetry/canonical (1,335 sessions, uses commit_count field)
 *
 * FIELD MAPPING STRATEGY:
 * - commit_count field in session-level data is BROKEN (all zeros)
 * - commits_per_session field in aggregated canonical data is POPULATED
 * - Solution: Fetch both session-level and aggregated data, merge commits_per_session into session rows by tool
 *
 * Field mapping in addDerivedSessionFields() ensures compatibility:
 * - commits_per_session (from aggregated) → session_commits (for generators)
 */
/**
 * CR5 WS1 P0 FIX — Shared in-flight Promise + short-lived cache for
 * fetchSessionPrimitives.
 *
 * Both the PI engine (via fetchCanonicalInsightInput) and AIOI (via
 * fetchObservedCommitTtfcAuthority) call fetchSessionPrimitives. Without
 * deduplication, they independently fetch the full canonical + enriched
 * payload (~50 requests each = ~100 total). With this dedupe, concurrent
 * calls share the same in-flight Promise (~50 total).
 *
 * CR5 WS1 P0 FIX #2: A short-lived cache (30s TTL) retains the resolved
 * result so the queued PI rerun (triggered by github-fetch-complete)
 * reuses the same canonical/enriched population instead of refetching.
 * The canonical/enriched population does not change between the initial
 * compute and the immediate queued rerun (same dashboard cycle, same
 * time filter). GitHub data is fetched separately and merged in the
 * harness — the session population is independent of GitHub state.
 *
 * CR-X PI FREEZE — Evidence-completeness contract:
 * Only a COMPLETE fetch (all expected pages returned, receivedTotal ===
 * expectedTotal) enters the 30s success cache. PARTIAL and ERROR results
 * are NEVER cached, so the github-fetch-complete rerun does a fresh fetch
 * instead of reusing poisoned data. Completeness is attached as a
 * non-enumerable property on the returned array AND stored in a
 * module-level variable for callers to inspect.
 */
let _sessionPrimitivesPromise: Promise<any[]> | null = null;
let _sessionPrimitivesCache: any[] | null = null;
let _sessionPrimitivesCacheAt: number = 0;
const SESSION_PRIMITIVES_CACHE_TTL_MS = 30_000; // 30 seconds — covers one dashboard cycle

/**
 * CR-X PI FREEZE — Session fetch completeness contract.
 *
 * status: 'complete' = all expected pages returned, receivedTotal === expectedTotal
 *         'partial'  = some pages returned but not all (timeout/error mid-pagination)
 *         'error'   = page 1 failed or no sessions returned
 *
 * Only 'complete' populates the 30s success cache. 'partial' and 'error'
 * never poison the cache, propagate to PI, and permit a bounded recovery.
 */
export interface SessionFetchCompleteness {
  status: 'complete' | 'partial' | 'error';
  expectedTotal: number;
  receivedTotal: number;
  pagesExpected: number;
  pagesCompleted: number;
  error?: string;
}

// Module-level last-completeness for callers that need to inspect it
// without access to the returned array's non-enumerable property.
let _lastSessionFetchCompleteness: SessionFetchCompleteness | null = null;

/**
 * Get the completeness status of the last fetchSessionPrimitives call.
 * Returns null if no fetch has occurred yet.
 */
export function getLastSessionFetchCompleteness(): SessionFetchCompleteness | null {
  return _lastSessionFetchCompleteness;
}

export interface SessionFetchTimeRange {
  from?: string  // ISO date (YYYY-MM-DD) or empty for all-time
  to?: string    // ISO date (YYYY-MM-DD) or empty for all-time
  /** K1B: cohort scope — '<id>' | 'unassigned' | 'all' | undefined (absent = all) */
  cohortId?: string
}

// Cache key includes time range + cohort so different scopes don't share cache
let _sessionPrimitivesCacheKey: string = ''

export async function fetchSessionPrimitives(timeRange?: SessionFetchTimeRange): Promise<any[]> {
  const cacheKey = timeRange
    ? `${timeRange.from || ''}|${timeRange.to || ''}|${timeRange.cohortId || ''}`
    : 'all'

  // 1. In-flight dedupe (concurrent calls with same range share the same Promise)
  if (_sessionPrimitivesPromise && _sessionPrimitivesCacheKey === cacheKey) {
    if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] fetchSessionPrimitives INFLIGHT_HIT', { cacheKey })
    piDebugLog('[DATA_ACCESS][DEDUP]', 'Reusing in-flight fetchSessionPrimitives promise');
    return _sessionPrimitivesPromise;
  }
  // 2. Short-lived cache (queued rerun reuses the same population)
  // CR-X PI FREEZE: Only complete results are cached. The cache is
  // populated inside _fetchSessionPrimitivesImpl via _setCompleteCache,
  // NOT here unconditionally. This prevents partial/error poisoning.
  if (_sessionPrimitivesCache && _sessionPrimitivesCacheKey === cacheKey && (Date.now() - _sessionPrimitivesCacheAt) < SESSION_PRIMITIVES_CACHE_TTL_MS) {
    if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] fetchSessionPrimitives CACHE_HIT', { cacheKey, age: Date.now() - _sessionPrimitivesCacheAt, count: _sessionPrimitivesCache.length })
    piDebugLog('[DATA_ACCESS][CACHE_HIT]', 'Reusing cached session primitives', { age: Date.now() - _sessionPrimitivesCacheAt, count: _sessionPrimitivesCache.length });
    return _sessionPrimitivesCache;
  }
  _sessionPrimitivesCacheKey = cacheKey
  if (import.meta.env.DEV) console.log('[CANONICAL_REQUEST] purpose=PI_SESSIONS', { cacheKey })
  if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] fetchSessionPrimitives FETCH_START', { cacheKey })
  const _traceStart = performance.now()
  _sessionPrimitivesPromise = _fetchSessionPrimitivesImpl(timeRange);
  try {
    const result = await _sessionPrimitivesPromise;
    if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] fetchSessionPrimitives FETCH_END', { cacheKey, durationMs: Math.round(performance.now() - _traceStart), sessionCount: result.length, completeness: _lastSessionFetchCompleteness })
    // CR-X PI FREEZE: Cache is set inside _fetchSessionPrimitivesImpl
    // ONLY when status === 'complete'. Partial/error results are NOT
    // cached here. This is the core fix for cache poisoning.
    return result;
  } finally {
    _sessionPrimitivesPromise = null;
  }
}

/**
 * CR-X PI FREEZE — Set the success cache ONLY for complete fetches.
 * Called from _fetchSessionPrimitivesImpl when status === 'complete'.
 */
function _setCompleteCache(result: any[]): void {
  _sessionPrimitivesCache = result;
  _sessionPrimitivesCacheAt = Date.now();
}

/**
 * CR-X PI FREEZE — Clear the success cache (for force-fresh reruns).
 * Called when a prior fetch was partial/error and a rerun is triggered.
 */
export function clearSessionPrimitivesCache(): void {
  _sessionPrimitivesCache = null;
  _sessionPrimitivesCacheAt = 0;
}

/**
 * CR-X PI FREEZE — Attach completeness to the returned array as a
 * non-enumerable property and store in the module-level variable.
 */
function _attachCompleteness(result: any[], completeness: SessionFetchCompleteness): void {
  _lastSessionFetchCompleteness = completeness;
  Object.defineProperty(result, '_completeness', {
    value: completeness,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] fetchSessionPrimitives COMPLETENESS', completeness);
}

async function _fetchSessionPrimitivesImpl(timeRange?: SessionFetchTimeRange): Promise<any[]> {
  const USE_CANONICAL_ENDPOINT = true;
  const MAX_PAGES = 25; // Fetch up to 25 pages to cover full historical population
  const PER_PAGE = 1000; // CR-X Phase 3: increased from 200 to reduce sequential pagination round-trips
  const _pipelineStart = performance.now() // CR-X P0: local timing for SESSION_PIPELINE trace logs

  try {
    piDebugLog('[DATA_ACCESS][MIGRATION]', USE_CANONICAL_ENDPOINT ? 'Using canonical endpoint' : 'Using legacy endpoint');

    // Fetch page 1 first to get total count
    // Use full historical telemetry by default for consistency with AI Ops and Productivity V3.
    // If a timeRange is provided (from analysisContext), use it to scope the fetch.
    // Use end-of-day timestamp to avoid backend Carbon::parse() truncating
    // same-day events at midnight (same fix as telemetryToUnified.ts).
    const now = `${new Date().toISOString().split('T')[0]}T23:59:59.999Z`
    const historicalFrom = timeRange?.from || ALL_TIME_START
    const historicalTo = timeRange?.to ? `${timeRange.to}T23:59:59.999Z` : now
    // K1B: cohort scope applies only to the canonical endpoint (legacy
    // /api/telemetry/sessions cannot resolve cohort membership). A stale or
    // invalid cohort produces HTTP 422 INVALID_COHORT → error completeness,
    // never silently widened to org-wide.
    const cohortParam = USE_CANONICAL_ENDPOINT && timeRange?.cohortId && timeRange.cohortId !== 'all'
      ? `&cohort_id=${encodeURIComponent(timeRange.cohortId)}`
      : ''
    // Use buildApiUrl() for consistent API path handling
    const endpoint = USE_CANONICAL_ENDPOINT
      ? `telemetry/canonical?from=${historicalFrom}&to=${historicalTo}&format=sessions&per_page=${PER_PAGE}&page=1${cohortParam}`
      : `telemetry/sessions?days=all&per_page=${PER_PAGE}&page=1`;
    const fullUrl = buildApiUrl(endpoint);
    
    piDebugLog('[DATA_ACCESS][API_CALL_DETAILS]', {
      callerFile: 'dataAccess.ts',
      functionName: 'fetchSessionPrimitives',
      fullUrl,
      method: 'GET',
      queryParams: {
        from: historicalFrom,
        to: historicalTo,
        format: 'sessions',
        per_page: PER_PAGE,
        page: 1,
        days: 'all'
      },
      period: `${historicalFrom} to ${historicalTo}`,
      from: historicalFrom,
      to: historicalTo,
      orgId: 'unknown', // Will be captured from response headers if available
      authStatePresent: typeof window !== 'undefined' && !!window.localStorage?.getItem('auth_token'),
      isDemoMode: typeof window !== 'undefined' && window.location.search.includes('piStress=1'),
      shouldCallRealApiInDemoMode: true // This is the issue - Demo Mode should not call real API
    });
    
    const page1Response = await authenticatedFetch(fullUrl);

    if (!page1Response.ok) {
      console.warn('[DATA_ACCESS][SESSIONS_FETCH_FAILED]', 'Page 1 failed', page1Response.status);
      // CR-X PI FREEZE: page 1 failed → status = 'error', never cached
      const errorResult: any[] = [];
      _attachCompleteness(errorResult, {
        status: 'error',
        expectedTotal: 0,
        receivedTotal: 0,
        pagesExpected: 0,
        pagesCompleted: 0,
        error: `Page 1 HTTP ${page1Response.status}`,
      });
      return errorResult;
    }

    const page1Data = await page1Response.json();

    if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] fetchSessionPrimitives PAGE_1_OK', { sessions: (page1Data.sessions || page1Data.data || []).length, total: page1Data.metadata?.total || page1Data.total || 0 })
    
    piDebugLog('[DATA_ACCESS][API_RESPONSE_DETAILS]', {
      responseStatus: page1Response.status,
      responseShape: {
        hasSessions: !!page1Data.sessions,
        hasData: !!page1Data.data,
        hasMetadata: !!page1Data.metadata,
        hasPagination: !!page1Data.pagination,
        keys: Object.keys(page1Data),
        paginationTotal: page1Data.pagination?.total,
        rawTotal: page1Data.total,
        metadataTotal: page1Data.metadata?.total
      },
      dataLength: (page1Data.sessions || page1Data.data || page1Data || []).length,
      mappedSessionLength: (page1Data.sessions || page1Data.data || page1Data || []).length,
      isDemoMode: typeof window !== 'undefined' && window.location.search.includes('piStress=1'),
      shouldCallRealApiInDemoMode: false // Demo Mode should NOT call real API
    });

    const page1Sessions = page1Data.sessions || page1Data.data || page1Data || [];
    
    // Detect empty API response and log critical details
    if (page1Sessions.length === 0) {
      const VERBOSE_PI_DEBUG = (import.meta.env.VITE_VERBOSE_PI_DEBUG ?? 'false') === 'true'
      if (VERBOSE_PI_DEBUG) {
        piDebugLog('[PI_DEBUG][CRITICAL]', 'No sessions returned from API!');
        piDebugLog('[PI_DEBUG][CRITICAL]', 'Original API response:', page1Data);
        piDebugLog('[DATA_ACCESS][EMPTY_RESPONSE_ANALYSIS]', {
        wrongUrl: fullUrl,
        wrongPeriod: `${historicalFrom} to ${now}`,
        wrongHostname: fullUrl.includes('localhost') || fullUrl.includes('127.0.0.1'),
        wrongAuthContext: typeof window !== 'undefined' && !window.localStorage?.getItem('auth_token'),
        wrongResponseShape: !page1Data.sessions && !page1Data.data,
        actualEmptyResponse: page1Data,
        legacyPathCalled: !USE_CANONICAL_ENDPOINT,
        demoModeIncorrectlyCallsRealApi: typeof window !== 'undefined' && window.location.search.includes('piStress=1')
      });
      }
    }

    // Determine total pages from pagination (API returns pagination.total, not metadata.total)
    // Canonical endpoint uses metadata.total, legacy uses pagination.total
    const totalSessions = USE_CANONICAL_ENDPOINT
      ? (page1Data.metadata?.total || page1Data.total || 0)
      : (page1Data.pagination?.total || page1Data.metadata?.total || page1Data.total || 0);

    let totalPages = Math.ceil(totalSessions / PER_PAGE);
    let pagesToFetch = Math.min(totalPages, MAX_PAGES);

    // CR5 WS1.6 P0 FIX — Revert parallel pagination (WS1.5) which REGRESSED
    // the browser cold path from ~11.8s to ~18.7s. Parallel pagination
    // caused Laravel/dev-server/SQLite contention (10 concurrent queries
    // on the same SQLite DB). Restore sequential pagination with early stop.
    //
    // CR-X Phase 2B: Bounded concurrency (4) was tested and ALSO regressed:
    // sessions went from ~3500ms (sequential, 11 pages) to ~8300ms (bounded
    // concurrency, 13 pages). Each concurrent request took 5-10x longer
    // due to SQLite read contention, wiping out the parallelism benefit.
    // Sequential pagination remains the correct approach for SQLite backends.
    // The in-flight promise dedupe in fetchSessionPrimitives() remains,
    // so concurrent callers share the same fetch.
    const metadataTotalIsZero = page1Sessions.length > 0 && totalSessions === 0;
    if (metadataTotalIsZero) {
      piDebugWarn('[DATA_ACCESS][METADATA_TOTAL_ZERO]', 'metadata.total is 0 but sessions found, will fetch sequentially with early stop');
      pagesToFetch = MAX_PAGES; // cap, but sequential loop stops early
    }

    piDebugLog('[DATA_ACCESS][SESSION_COUNT]', {
      totalSessions,
      totalPages,
      pagesToFetch,
      maxPages: MAX_PAGES,
      page1SessionsCount: page1Sessions.length,
      endpoint: USE_CANONICAL_ENDPOINT ? 'canonical' : 'legacy',
      sequentialEarlyStop: metadataTotalIsZero
    });

    // If no sessions or no pages to fetch, return early
    if (page1Sessions.length === 0 || pagesToFetch === 0) {
      console.warn('[DATA_ACCESS][NO_SESSIONS]', 'No sessions found or no pages to fetch');
      // CR-X PI FREEZE: 0 sessions from a successful page 1 = 'complete'
      // (the fetch succeeded, there are genuinely no sessions). This is
      // NOT an error — the engine correctly produces no session-dependent
      // findings when there are no sessions.
      _attachCompleteness(page1Sessions, {
        status: 'complete',
        expectedTotal: 0,
        receivedTotal: 0,
        pagesExpected: 0,
        pagesCompleted: 1,
      });
      _setCompleteCache(page1Sessions);
      return page1Sessions;
    }

    const allSessions = [...page1Sessions];

    // CR-X PI FREEZE — Completeness tracking
    let pagesCompleted = 1; // page 1 succeeded
    let brokeDueToError = false; // true if break was error/timeout, not natural early stop

    // CR5 WS1.6 P0 FIX — Sequential pagination with early stop.
    // When metadata.total is 0 (canonical endpoint), fetch pages one at a
    // time and stop when a page returns < PER_PAGE rows. When metadata.total
    // is accurate (legacy endpoint or fixed canonical), fetch sequentially
    // (parallel was tested and regressed due to SQLite contention).
    if (metadataTotalIsZero) {
      // Sequential with early stop
      for (let page = 2; page <= pagesToFetch; page++) {
        const url = buildApiUrl(USE_CANONICAL_ENDPOINT
          ? `telemetry/canonical?from=${historicalFrom}&to=${historicalTo}&format=sessions&per_page=${PER_PAGE}&page=${page}${cohortParam}`
          : `telemetry/sessions?days=all&per_page=${PER_PAGE}&page=${page}`
        );
        try {
          // CR-X P0-B: Bounded per-page timeout (10s). A single slow page
          // must not produce an infinite product skeleton. Return partial
          // results rather than hanging forever.
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10_000);
          const response = await authenticatedFetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (response.ok) {
            const data = await response.json();
            const sessions = data.sessions || data.data || data || [];
            allSessions.push(...sessions);
            pagesCompleted++;
            if (import.meta.env.DEV) console.log(`[CRX_P0_TRACE] fetchSessionPrimitives PAGE_${page}_OK`, { sessions: sessions.length })
            // Early stop: if this page returned fewer than PER_PAGE rows,
            // we've reached the end of the data.
            if (sessions.length < PER_PAGE) {
              piDebugLog(`[DATA_ACCESS][EARLY_STOP]`, `Page ${page} returned ${sessions.length} < ${PER_PAGE}, stopping pagination`);
              break; // natural early stop — NOT brokeDueToError
            }
          } else {
            console.warn('[DATA_ACCESS][SESSIONS_FETCH_FAILED]', `Page ${page} failed`, response.status);
            brokeDueToError = true;
            break;
          }
        } catch (error: any) {
          if (error?.name === 'AbortError') {
            console.warn('[DATA_ACCESS][PAGE_TIMEOUT]', `Page ${page} timed out after 10s — returning partial results (${allSessions.length} sessions)`);
          } else {
            console.warn('[DATA_ACCESS][SESSIONS_FETCH_ERROR]', `Page ${page} error`, error);
          }
          brokeDueToError = true;
          break;
        }
      }
    } else {
      // Sequential fetch (metadata.total is accurate)
      // CR-X Phase 2B: Parallel fetch was tested and regressed due to
      // SQLite contention. Sequential is the correct approach.
      for (let page = 2; page <= pagesToFetch; page++) {
        const url = buildApiUrl(USE_CANONICAL_ENDPOINT
          ? `telemetry/canonical?from=${historicalFrom}&to=${historicalTo}&format=sessions&per_page=${PER_PAGE}&page=${page}${cohortParam}`
          : `telemetry/sessions?days=all&per_page=${PER_PAGE}&page=${page}`
        );
        try {
          // CR-X P0-B: Bounded per-page timeout (10s).
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10_000);
          const response = await authenticatedFetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (response.ok) {
            const data = await response.json();
            const sessions = data.sessions || data.data || data || [];
            allSessions.push(...sessions);
            pagesCompleted++;
            if (import.meta.env.DEV) console.log(`[CRX_P0_TRACE] fetchSessionPrimitives PAGE_${page}_OK`, { sessions: sessions.length })
          } else {
            console.warn('[DATA_ACCESS][SESSIONS_FETCH_FAILED]', `Page ${page} failed`, response.status);
            brokeDueToError = true;
            break;
          }
        } catch (error: any) {
          if (error?.name === 'AbortError') {
            console.warn('[DATA_ACCESS][PAGE_TIMEOUT]', `Page ${page} timed out after 10s — returning partial results (${allSessions.length} sessions)`);
          } else {
            console.warn('[DATA_ACCESS][SESSIONS_FETCH_ERROR]', `Page ${page} error`, error);
          }
          brokeDueToError = true;
          break;
        }
      }
    }

    piDebugLog('[DATA_ACCESS][TOTAL_FETCHED]', `Total sessions fetched: ${allSessions.length}`);
    if (import.meta.env.DEV) console.log('[SESSION_PIPELINE] pagination_finalized', { totalFetched: allSessions.length, brokeDueToError, pagesCompleted, durationMs: Math.round(performance.now() - _pipelineStart) })

    // CR-X P0: Compute commits_per_session by tool from the session data we
    // already have, instead of making a SEPARATE HTTP request to the expensive
    // aggregated canonical endpoint. The aggregated endpoint defaults to
    // format=aggregated which runs a GROUP BY query that blocks the
    // single-threaded PHP server. Computing from session data is O(n) in
    // memory and avoids the extra HTTP round-trip.
    let commitsPerSessionByTool: Record<string, number> = {};
    if (USE_CANONICAL_ENDPOINT) {
      if (import.meta.env.DEV) console.log('[SESSION_PIPELINE] commits_per_session_compute_start')
      const toolCommitSums: Record<string, number> = {};
      const toolSessionCounts: Record<string, number> = {};
      for (const session of allSessions) {
        const tool = session.tool || session.source || 'unknown';
        const commits = session.session_commits ?? 0;
        toolCommitSums[tool] = (toolCommitSums[tool] || 0) + commits;
        toolSessionCounts[tool] = (toolSessionCounts[tool] || 0) + 1;
      }
      for (const tool of Object.keys(toolCommitSums)) {
        if (toolSessionCounts[tool] > 0) {
          commitsPerSessionByTool[tool] = toolCommitSums[tool] / toolSessionCounts[tool];
        }
      }
      if (import.meta.env.DEV) console.log('[SESSION_PIPELINE] commits_per_session_compute_end', { tools: Object.keys(commitsPerSessionByTool).length })
      piDebugLog('[DATA_ACCESS][AGGREGATED_COMMITS]', {
        toolsWithCommits: Object.keys(commitsPerSessionByTool),
        sampleValues: commitsPerSessionByTool
      });
    }

    // Merge and dedupe by session_id
    // Canonical endpoint guarantees uniqueness, but we dedupe for safety and legacy compatibility
    if (import.meta.env.DEV) console.log('[SESSION_PIPELINE] dedupe_start', { count: allSessions.length })
    const sessionMap = new Map<string, any>();

    for (const session of allSessions) {
      const sessionId = session.session_id;
      if (sessionId && !sessionMap.has(sessionId)) {
        // Merge commits_per_session from aggregated data by tool
        if (session.tool && commitsPerSessionByTool[session.tool]) {
          session.commits_per_session = commitsPerSessionByTool[session.tool];
        }
        sessionMap.set(sessionId, session);
      }
    }

    const dedupedSessions = Array.from(sessionMap.values());
    if (import.meta.env.DEV) console.log('[SESSION_PIPELINE] dedupe_end', { dedupedCount: dedupedSessions.length })

    // ============================================================
    // CR5 WS1 — CANONICAL ENRICHMENT
    //
    // Population contract (do NOT change the PI denominator):
    //   - Canonical endpoint is the membership authority (1,855
    //     segment_type=session rows). Enrichment MUST NOT add or
    //     drop canonical rows.
    //   - /api/telemetry/sessions exposes 4,857 rows of all segment
    //     types with 69 richer fields (session_has_commit_outcome,
    //     simulated, computed TTFC via computeTimeToFirstCommit(),
    //     focus_ratio, idle_time_ms, etc.).
    //   - Join: canonical.session_id (DB row id) === enriched.id
    //     (DB row id). Census proved 1,855/1,855 match on Local.
    //
    // Precedence (documented):
    //   CANONICAL WINS (membership/identity + already-real telemetry):
    //     session_id, tool, host_editor, timestamp, duration_ms,
    //     active_coding_duration_ms, ai_burst_count, files_edited,
    //     lines_added_total, git_repo_url, git_branch,
    //     identity_schema_version, identity_source
    //   ENRICHED WINS (capability fields not in canonical, or stronger
    //     than synthetic canonical values):
    //     session_has_commit_outcome, session_commits (observed),
    //     simulated, time_to_first_commit_ms (computed), focus_ratio,
    //     idle_time_ms, idle_ratio, ai_intensity_band,
    //     ai_usage_duration_ms, ai_active_span_ms, ai_burst_chars_total,
    //     ai_burst_lines_total, file_save_count, flow_profile,
    //     session_quality_score, session_quality_band,
    //     session_rework_ratio_est, extension_version, user_id,
    //     end_reason, language_id_counts, git_context_status
    //   Canonical commit_count (synthetic backfill) is NEVER promoted
    //     to observed; it is retained only as a fallback value.
    //   Canonical raw time_to_first_commit_ms (100% multiples of
    //     60000, synthetic) is superseded by the enriched computed
    //     TTFC when present; ttfc_from_enriched flags the source.
    // ============================================================
    if (import.meta.env.DEV) console.log('[SESSION_PIPELINE] enrichment_fetch_start')
    const enrichedMap = await fetchEnrichedSessionsMap();
    if (import.meta.env.DEV) console.log('[SESSION_PIPELINE] enrichment_fetch_end', { enrichedCount: enrichedMap.size, durationMs: Math.round(performance.now() - _pipelineStart) })
    if (import.meta.env.DEV) console.log('[SESSION_PIPELINE] enrichment_join_start', { canonicalCount: dedupedSessions.length, enrichedCount: enrichedMap.size })
    const enrichmentStats = enrichCanonicalSessions(dedupedSessions, enrichedMap);
    if (import.meta.env.DEV) console.log('[SESSION_PIPELINE] enrichment_join_end', { durationMs: Math.round(performance.now() - _pipelineStart) })

    // Log IDE distribution
    const tools = new Set<string>();
    const repos = new Set<string>();
    for (const session of dedupedSessions) {
      if (session.tool) tools.add(session.tool);
      if (session.git_repo_url) repos.add(session.git_repo_url);
    }

    piDebugLog('[DATA_ACCESS][SESSIONS_FETCHED]', {
      totalFetched: allSessions.length,
      dedupedCount: dedupedSessions.length,
      ideDistribution: Array.from(tools),
      repoCount: repos.size
    });

    piDebugLog('[CR5_WS1][ENRICHMENT_STATS]', enrichmentStats);

    // CR-X PI FREEZE — Determine final completeness status.
    // Only 'complete' populates the 30s success cache.
    const expectedTotal = totalSessions > 0 ? totalSessions : allSessions.length;
    const pagesExpected = pagesToFetch;
    const receivedTotal = dedupedSessions.length;
    // Complete if: no error break AND (received all expected OR natural early-stop exhausted data)
    const isComplete = !brokeDueToError && (
      (totalSessions > 0 && receivedTotal >= expectedTotal) ||
      (metadataTotalIsZero && pagesCompleted <= pagesToFetch) // early-stop is natural completion
    );
    const completeness: SessionFetchCompleteness = {
      status: isComplete ? 'complete' : 'partial',
      expectedTotal,
      receivedTotal,
      pagesExpected,
      pagesCompleted,
      error: brokeDueToError ? `Pagination stopped at page ${pagesCompleted + 1} due to error/timeout` : undefined,
    };
    _attachCompleteness(dedupedSessions, completeness);
    if (isComplete) {
      _setCompleteCache(dedupedSessions);
    }
    if (import.meta.env.DEV) console.log('[SESSION_PIPELINE] result_ready', { completeness, totalMs: Math.round(performance.now() - _pipelineStart) })
    return dedupedSessions;
  } catch (error) {
    console.error('[DATA_ACCESS][SESSIONS_ERROR]', error);
    // CR-X PI FREEZE: top-level error → status = 'error', never cached
    const errorResult: any[] = [];
    _attachCompleteness(errorResult, {
      status: 'error',
      expectedTotal: 0,
      receivedTotal: 0,
      pagesExpected: 0,
      pagesCompleted: 0,
      error: (error as Error)?.message || String(error),
    });
    return errorResult;
  }
}

/**
 * CR5 WS1 — Fields enriched from /api/telemetry/sessions.
 *
 * These are the capability fields that the canonical endpoint does NOT
 * expose (or exposes only as synthetic backfill). They are copied from
 * the enriched sessions row onto the canonical row when present and
 * finite/valid. Canonical identity and already-real telemetry fields
 * are never overwritten by enriched values.
 */
const ENRICHED_FIELDS = [
  // Commit outcome / provenance authority
  'session_has_commit_outcome',
  'session_commits',
  'simulated',
  // Computed TTFC (via backend computeTimeToFirstCommit())
  'time_to_first_commit_ms',
  // Derived real telemetry
  'focus_ratio',
  'idle_time_ms',
  'idle_ratio',
  'ai_intensity_band',
  'ai_usage_duration_ms',
  'ai_active_span_ms',
  'ai_burst_chars_total',
  'ai_burst_lines_total',
  'file_save_count',
  'flow_profile',
  'session_quality_score',
  'session_quality_band',
  'session_rework_ratio_est',
  // Real telemetry context
  'extension_version',
  'user_id',
  'end_reason',
  'language_id_counts',
  'git_context_status',
] as const;

/**
 * CR5 WS1 — Fetch all rows from /api/telemetry/sessions?days=all and
 * index by DB row id. Returns a Map<id, row>.
 *
 * This endpoint exposes 4,857 rows of all segment types with 69 richer
 * fields. Only rows whose `id` matches a canonical session_id are used
 * for enrichment; the rest are ignored (canonical remains membership
 * authority).
 *
 * Failure is non-fatal: if the enriched fetch fails, canonical rows are
 * returned unenriched and provenance classification falls back to
 * session_level_fallback / missing (the pre-WS1 behavior).
 */
/**
 * CR5 WS1 P0 FIX — Shared in-flight Promise for fetchEnrichedSessionsMap.
 * Deduplicates concurrent calls (PI + AIOI) to the /api/telemetry/sessions
 * endpoint. Cleared after resolution so subsequent calls fetch fresh data.
 */
let _enrichedSessionsMapPromise: Promise<Map<string | number, any>> | null = null;

async function fetchEnrichedSessionsMap(): Promise<Map<string | number, any>> {
  if (_enrichedSessionsMapPromise) {
    piDebugLog('[CR5_WS1][ENRICHED_DEDUP]', 'Reusing in-flight fetchEnrichedSessionsMap promise');
    return _enrichedSessionsMapPromise;
  }
  _enrichedSessionsMapPromise = _fetchEnrichedSessionsMapImpl();
  try {
    return await _enrichedSessionsMapPromise;
  } finally {
    _enrichedSessionsMapPromise = null;
  }
}

async function _fetchEnrichedSessionsMapImpl(): Promise<Map<string | number, any>> {
  const MAX_PAGES = 30;
  const PER_PAGE = 1000; // CR-X Phase 3: increased from 200 to reduce sequential pagination round-trips
  // CR-X 2026-08-30 — Cross-env join robustness: index enriched rows by
  // BOTH `id` (numeric DB row id, used on Local where canonical.session_id
  // is numeric) AND `session_id` (string UUID, used on Ed where
  // canonical.session_id is the UUID). enrichCanonicalSessions() prefers
  // the session_id===session_id match and falls back to session_id===id.
  // This keeps Local fully enriched (id join) and fixes Ed (session_id
  // join) without any environment-specific branching.
  const map = new Map<string | number, any>();
  const indexRow = (row: any) => {
    if (!row) return;
    if (row.id !== undefined && row.id !== null && !map.has(row.id)) map.set(row.id, row);
    if (row.session_id !== undefined && row.session_id !== null && !map.has(row.session_id)) map.set(row.session_id, row);
  };
  try {
    const url = buildApiUrl(`telemetry/sessions?days=all&per_page=${PER_PAGE}&page=1`);
    const page1Response = await authenticatedFetch(url);
    if (!page1Response.ok) {
      console.warn('[CR5_WS1][ENRICHED_FETCH_FAILED]', 'Page 1 failed', page1Response.status);
      return map;
    }
    const page1Data = await page1Response.json();
    const page1Rows = page1Data.sessions || page1Data.data || page1Data || [];
    const total = page1Data.pagination?.total || page1Data.metadata?.total || page1Data.total || 0;
    const totalPages = Math.ceil(total / PER_PAGE);
    const pagesToFetch = Math.min(Math.max(totalPages, 1), MAX_PAGES);

    for (const row of page1Rows) indexRow(row);

    // CR5 WS1 P0 FIX — If total is 0 but page 1 returned a full page,
    // fetch sequentially with early stop (same pattern as canonical).
    // Otherwise (total is accurate), fetch remaining pages in parallel.
    const totalIsZero = total === 0 && page1Rows.length > 0;

    if (totalIsZero) {
      for (let page = 2; page <= pagesToFetch; page++) {
        const resp = await authenticatedFetch(
          buildApiUrl(`telemetry/sessions?days=all&per_page=${PER_PAGE}&page=${page}`)
        );
        if (!resp.ok) {
          console.warn('[CR5_WS1][ENRICHED_PAGE_FAILED]', `Page ${page}`, resp.status);
          break;
        }
        const data = await resp.json();
        const rows = data.sessions || data.data || data || [];
        for (const row of rows) indexRow(row);
        if (rows.length < PER_PAGE) {
          piDebugLog(`[CR5_WS1][ENRICHED_EARLY_STOP]`, `Page ${page} returned ${rows.length} < ${PER_PAGE}`);
          break;
        }
      }
    } else {
      // CR-X P0: Sequential pagination (was parallel). Parallel pagination
      // fires all remaining pages at once, which on the single-threaded PHP
      // built-in server causes request contention and blocks the event loop.
      // Sequential is slower per-request but doesn't block other in-flight
      // requests (PBT, AIOI) from being processed.
      for (let page = 2; page <= pagesToFetch; page++) {
        try {
          const resp = await authenticatedFetch(
            buildApiUrl(`telemetry/sessions?days=all&per_page=${PER_PAGE}&page=${page}`)
          );
          if (!resp.ok) {
            console.warn('[CR5_WS1][ENRICHED_PAGE_FAILED]', `Page ${page}`, resp.status);
            break;
          }
          const data = await resp.json();
          const rows = data.sessions || data.data || data || [];
          for (const row of rows) indexRow(row);
          if (rows.length < PER_PAGE) {
            piDebugLog(`[CR5_WS1][ENRICHED_EARLY_STOP]`, `Page ${page} returned ${rows.length} < ${PER_PAGE}`);
            break;
          }
        } catch (error) {
          console.warn('[CR5_WS1][ENRICHED_PAGE_ERROR]', `Page ${page}`, error);
          break;
        }
      }
    }
    piDebugLog('[CR5_WS1][ENRICHED_FETCHED]', { enrichedRowCount: map.size, totalPages, pagesToFetch });
  } catch (error) {
    console.warn('[CR5_WS1][ENRICHED_FETCH_ERROR]', error);
  }
  return map;
}

/**
 * CR5 WS1 — Enrich canonical session rows from the enriched sessions
 * map. Mutates canonical rows in place. Returns enrichment stats.
 *
 * CR-X 2026-08-30 — Cross-env join robustness. The enriched map is
 * indexed by BOTH `id` and `session_id` (see _fetchEnrichedSessionsMapImpl).
 * The join prefers `canonical.session_id === enriched.session_id` (the
 * UUID join, correct on Ed where canonical.session_id is the UUID) and
 * falls back to `canonical.session_id === enriched.id` (the numeric DB
 * row id join, correct on Local where canonical.session_id is numeric).
 *
 * Canonical membership is preserved: rows with no enriched match are
 * kept unchanged (provenance falls back to session_level_fallback /
 * missing). No canonical row is added or dropped.
 */
export function enrichCanonicalSessions(
  canonicalSessions: any[],
  enrichedMap: Map<string | number, any>
): {
  canonicalCount: number;
  enrichedMatchCount: number;
  simulatedCount: number;
  observedCommitOutcomeCount: number;
  enrichedTtfcCount: number;
} {
  let enrichedMatchCount = 0;
  let simulatedCount = 0;
  let observedCommitOutcomeCount = 0;
  let enrichedTtfcCount = 0;

  for (const canonical of canonicalSessions) {
    const joinKey = canonical.session_id;
    if (joinKey === undefined || joinKey === null) continue;
    // The enriched map is dual-indexed by both `id` (numeric DB row id,
    // Local join) and `session_id` (UUID, Ed join). A single lookup by
    // canonical.session_id resolves correctly in both environments:
    //   - Local: canonical.session_id is numeric -> matches enriched.id key
    //   - Ed:    canonical.session_id is UUID    -> matches enriched.session_id key
    const enriched = enrichedMap.get(joinKey);
    if (!enriched) {
      // No enriched match — canonical row preserved unchanged.
      continue;
    }
    enrichedMatchCount++;

    if (enriched.simulated === true) simulatedCount++;
    if (enriched.session_has_commit_outcome === true) observedCommitOutcomeCount++;

    // Copy enriched capability fields. Canonical identity/real-telemetry
    // fields are NOT in ENRICHED_FIELDS and are therefore never overwritten.
    for (const field of ENRICHED_FIELDS) {
      const enrichedValue = enriched[field];
      if (enrichedValue === undefined || enrichedValue === null) continue;
      // Only overwrite when the canonical row lacks a finite value for
      // this field, EXCEPT for commit/TTFC where the enriched value is
      // the authoritative (observed/computed) source and the canonical
      // value is synthetic backfill.
      const canonicalValue = canonical[field];
      const isCommitOrTtfcField =
        field === 'session_commits' ||
        field === 'session_has_commit_outcome' ||
        field === 'simulated' ||
        field === 'time_to_first_commit_ms';

      if (isCommitOrTtfcField) {
        // Enriched is the authority for these fields.
        canonical[field] = enrichedValue;
        if (field === 'time_to_first_commit_ms') {
          // Flag that TTFC came from the enriched computed path so
          // addDerivedSessionFields can classify provenance correctly.
          canonical.ttfc_from_enriched = true;
          enrichedTtfcCount++;
        }
      } else if (canonicalValue === undefined || canonicalValue === null) {
        // Fill missing canonical field from enriched.
        canonical[field] = enrichedValue;
      }
      // If canonical already has a finite value for a non-commit/TTFC
      // field, keep canonical (canonical is not weaker for real telemetry).
    }
  }

  return {
    canonicalCount: canonicalSessions.length,
    enrichedMatchCount,
    simulatedCount,
    observedCommitOutcomeCount,
    enrichedTtfcCount,
  };
}

/**
 * CR5 WS1 — Fetch the shared observed commit/TTFC authority for AIOI.
 *
 * This reuses the canonical enrichment + provenance classification path
 * (fetchSessionPrimitives enriches and addDerivedSessionFields
 * classifies) and then computes per-workflow observed aggregates via
 * the shared `computeObservedCommitTtfcByWorkflow` module.
 *
 * The provenance LOGIC is shared (single classification + single
 * authority computation). The fetch is currently independent of the
 * PI engine call because AIOI and the PI engine are invoked on
 * separate data flows in Dashboards.vue; unifying the fetch is a
 * post-V1 optimization. On Local (1,855 canonical + 4,857 enriched
 * rows, localhost) the cost is negligible.
 *
 * AIOI consumes this authority for commits/session and TTFC. When a
 * workflow has no observed evidence, the authority returns null for
 * both metrics — AIOI renders unavailable and MUST NOT fall back to
 * canonical aggregated commit_count or rounded TTFC.
 *
 * Failure is non-fatal: returns an empty authority (all workflows
 * render unavailable) so AIOI never shows unqualified values.
 */

/**
 * CR5 WS1 P0 FIX #3 — Shared enriched canonical result.
 *
 * Returns the enriched canonical session population AND the AIOI
 * observed commit/TTFC authority derived from that SAME population.
 * This is the single entry point for the dashboard calculation cycle:
 * both the PI engine (canonicalInput.sessionRows) and AIOI
 * (observedCommitTtfcAuthority) consume this one result.
 *
 * Hard invariants:
 *   - canonical membership stays exactly 1,855 (no rows added/dropped)
 *   - enriched endpoint NEVER becomes the denominator
 *   - canonical.session_id === enriched.id join
 *   - Windsurf → Devin normalization in authority computation
 *
 * Returns:
 *   {
 *     sessionRows: enrichedCanonicalRows,  // for PI engine
 *     observedAuthority,                    // for AIOI
 *     enrichmentStats                       // for runtime proof
 *   }
 */
export interface SharedEnrichedResult {
  sessionRows: any[];
  observedAuthority: ObservedCommitTtfcAuthority;
  enrichmentStats: {
    canonicalMembershipCount: number;
    enrichedMatchCount: number;
    observedCommitQualifiedCount: number;
    observedTtfcQualifiedCount: number;
    rowsWithSessionCommitsSource: number;
    rowsWithTtfcSource: number;
  };
}

export async function fetchSharedEnrichedCanonical(timeRange?: SessionFetchTimeRange): Promise<SharedEnrichedResult> {
  if (import.meta.env.DEV) console.log('[CANONICAL_REQUEST] purpose=ENRICHMENT', { timeRange })
  try {
    const sessionRows = await fetchSessionPrimitives(timeRange);
    addDerivedSessionFields(sessionRows);
    const observedAuthority = computeObservedCommitTtfcByWorkflow(sessionRows);

    // Build enrichment stats for runtime proof
    let enrichedMatchCount = 0;
    let observedCommitQualifiedCount = 0;
    let observedTtfcQualifiedCount = 0;
    let rowsWithSessionCommitsSource = 0;
    let rowsWithTtfcSource = 0;

    for (const row of sessionRows) {
      if (row.session_has_commit_outcome !== undefined || row.simulated !== undefined || row.ttfc_from_enriched !== undefined) {
        enrichedMatchCount++;
      }
      if (row.session_commits_source === 'observed') {
        observedCommitQualifiedCount++;
        rowsWithSessionCommitsSource++;
      }
      if (row.ttfc_source === 'observed') {
        observedTtfcQualifiedCount++;
        rowsWithTtfcSource++;
      }
    }

    const result: SharedEnrichedResult = {
      sessionRows,
      observedAuthority,
      enrichmentStats: {
        canonicalMembershipCount: sessionRows.length,
        enrichedMatchCount,
        observedCommitQualifiedCount,
        observedTtfcQualifiedCount,
        rowsWithSessionCommitsSource,
        rowsWithTtfcSource,
      },
    };

    // DEV-only runtime proof
    if (import.meta.env.DEV) {
      piDebugLog('[CR5_WS1][SHARED_ENRICHED_RUNTIME]', {
        canonicalMembershipCount: result.enrichmentStats.canonicalMembershipCount,
        piSessionRowsCount: result.sessionRows.length,
        enrichedMatchCount: result.enrichmentStats.enrichedMatchCount,
        samePopulation: result.enrichmentStats.canonicalMembershipCount === result.sessionRows.length,
        observedCommitQualifiedCount: result.enrichmentStats.observedCommitQualifiedCount,
        observedTtfcQualifiedCount: result.enrichmentStats.observedTtfcQualifiedCount,
        rowsWithSessionCommitsSource: result.enrichmentStats.rowsWithSessionCommitsSource,
        rowsWithTtfcSource: result.enrichmentStats.rowsWithTtfcSource,
        workflowsWithObservedAuthority: Array.from(result.observedAuthority.entries()).map(([k, v]) => ({
          toolId: k,
          commitsPerSession: v.commitsPerSession,
          ttfcMinutes: v.ttfcMinutes,
          observedCommitSessionCount: v.observedCommitSessionCount,
        })),
        aioiAuthorityDerivedFromSameResult: true,
      });
    }

    return result;
  } catch (error) {
    console.warn('[CR5_WS1][SHARED_ENRICHED_ERROR]', error);
    // Fail closed: return empty rows + empty authority
    return {
      sessionRows: [],
      observedAuthority: new Map(),
      enrichmentStats: {
        canonicalMembershipCount: 0,
        enrichedMatchCount: 0,
        observedCommitQualifiedCount: 0,
        observedTtfcQualifiedCount: 0,
        rowsWithSessionCommitsSource: 0,
        rowsWithTtfcSource: 0,
      },
    };
  }
}

/**
 * CR5 WS1 — Fetch observed commit/TTFC authority for AIOI (legacy entry point).
 *
 * CR5 WS1 P0 FIX #3: In production, AIOI authority is now derived from the
 * shared enriched canonical result (fetchSharedEnrichedCanonical) inside
 * refreshPI. This function remains for backward compatibility but is no
 * longer called from Dashboards.vue.
 */
export async function fetchObservedCommitTtfcAuthority(): Promise<ObservedCommitTtfcAuthority> {
  try {
    const sessionRows = await fetchSessionPrimitives();
    addDerivedSessionFields(sessionRows);
    const authority = computeObservedCommitTtfcByWorkflow(sessionRows);
    piDebugLog('[CR5_WS1][AIOI_AUTHORITY]', {
      workflowCount: authority.size,
      workflows: Array.from(authority.entries()).map(([toolId, e]) => ({
        toolId,
        commitsPerSession: e.commitsPerSession,
        ttfcMinutes: e.ttfcMinutes,
        observedCommitSessionCount: e.observedCommitSessionCount,
        observedTtfcSessionCount: e.observedTtfcSessionCount,
      })),
    });
    return authority;
  } catch (error) {
    console.warn('[CR5_WS1][AIOI_AUTHORITY_ERROR]', error);
    return new Map();
  }
}

/**
 * Fetch GitHub snapshot from /api/metrics
 *
 * IMPORTANT: Use all-time historical data by default for canonical PI engine
 * Backend default is 'week', but PI requires all-time org baseline for truthfulness
 *
 * NORMALIZATION: Safely normalize missing optional fields to prevent generator crashes
 * - pr_analytics: Ensure required fields exist or set to safe defaults
 * - pr_review_metrics: Ensure required fields exist or set to safe defaults
 * - deployment_metrics: Ensure required fields exist or set to safe defaults
 */
/**
 * CR-X PERF P0 — Pure GitHub snapshot normalization.
 *
 * Extracted from fetchGithubSnapshot so the same normalization can be applied
 * to a store-resolved snapshot WITHOUT re-fetching. This is the single
 * authority for pr_analytics / pr_review_metrics / deployment_metrics
 * field-defaulting. Both the network path (fetchGithubSnapshot) and the
 * store-reuse path (resolveGithubSnapshotForPI) call this helper, guaranteeing
 * byte-equivalent normalized output for the same raw payload.
 *
 * Returns a new object; does NOT mutate the input.
 */
export function normalizeGithubSnapshot(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw;
  // Shallow-clone so we never mutate the store's rawResponse.
  const data: any = { ...raw };

  // Normalize pr_analytics: ensure required fields exist
  if (data.pr_analytics) {
    data.pr_analytics = {
      total_prs: data.pr_analytics.total_prs ?? 0,
      merged_prs: data.pr_analytics.merged_prs ?? 0,
      open_prs: data.pr_analytics.open_prs ?? 0,
      closed_prs: data.pr_analytics.closed_prs ?? 0,
      draft_prs: data.pr_analytics.draft_prs ?? 0,
      avg_comments_per_pr: data.pr_analytics.avg_comments_per_pr ?? 0,
      avg_review_comments_per_pr: data.pr_analytics.avg_review_comments_per_pr ?? 0,
      prs_by_size: data.pr_analytics.prs_by_size ?? { small: 0, medium: 0, large: 0 },
      github_db_pr_count: data.pr_analytics.github_db_pr_count ?? 0,
      github_db_deploy_count: data.pr_analytics.github_db_deploy_count ?? 0,
      ...data.pr_analytics // Preserve any additional fields
    };
  }

  // Normalize pr_review_metrics: ensure required fields exist.
  // CR-X 5C: `unique_reviewer_count` and `pr_reopened_count` are optional
  // enrichment columns on legacy schemas. Backend sends `null` for
  // unavailable capability, so preserve `null` instead of coercing to `0`.
  if (data.pr_review_metrics) {
    data.pr_review_metrics = {
      first_review_at: data.pr_review_metrics.first_review_at ?? null,
      review_count: data.pr_review_metrics.review_count ?? 0,
      unique_reviewer_count: data.pr_review_metrics.unique_reviewer_count ?? null,
      pr_reopened_count: data.pr_review_metrics.pr_reopened_count ?? null,
      total_prs: data.pr_review_metrics.total_prs ?? 0,
      ...data.pr_review_metrics // Preserve any additional fields
    };
  }

  // Normalize deployment_metrics: ensure required fields exist
  if (data.deployment_metrics) {
    data.deployment_metrics = {
      latest_deployment: data.deployment_metrics.latest_deployment ?? null,
      failed_deployment_count: data.deployment_metrics.failed_deployment_count ?? 0,
      success_deployment_count: data.deployment_metrics.success_deployment_count ?? 0,
      deployment_frequency: data.deployment_metrics.deployment_frequency ?? 0,
      change_failure_rate: data.deployment_metrics.change_failure_rate ?? 0,
      rollback_detected: data.deployment_metrics.rollback_detected ?? false,
      deploy_to_incident_time: data.deployment_metrics.deploy_to_incident_time ?? null,
      ...data.deployment_metrics // Preserve any additional fields
    };
  }

  return data;
}

/**
 * CR-X PERF P0 — Resolve the GitHub snapshot for PI without a redundant
 * network request when an eligible resolved snapshot already exists.
 *
 * Contract (ONE GitHub snapshot authority per refresh cycle):
 *   - If `storeSnapshot` is provided AND is eligible per
 *     isGithubEvidenceEligibleCombined, normalize and reuse it. No network.
 *   - Otherwise fall back to fetchGithubSnapshot() (authenticated, nocache).
 *
 * This eliminates the ~598ms redundant /api/metrics?nocache=1&github_nocache=1
 * fetch that PI performed even though githubStore.rawResponse already held
 * the same freshly-fetched payload (the onMounted and refreshPI
 * githubStore.fetchMetrics calls had already populated it).
 *
 * Freshness is preserved: the store snapshot is the result of a force=true
 * fetch in the same refresh cycle. The fallback remains available for any
 * path that arrives without a populated store.
 */
export async function resolveGithubSnapshotForPI(storeSnapshot?: any): Promise<any> {
  // CR-X Phase 3 FIX: Only reuse the store snapshot when it was fetched with
  // time_filter=all. The PI engine requires all-time GitHub data (matching
  // fetchGithubSnapshot's time_filter=all). PerformanceInsightsWidget.vue
  // calls githubStore.fetchMetrics('week') which populates the store with
  // week-filtered data (total_prs=0, fewer deployments). Reusing that
  // snapshot causes the PI engine to produce 34 PIs instead of 48 because
  // the generators see less GitHub evidence.
  if (storeSnapshot && isGithubEvidenceEligibleCombined(storeSnapshot) && storeSnapshot?.time_filter === 'all') {
    piDebugLog('[DATA_ACCESS][GH_SNAPSHOT_REUSE]', {
      reason: 'store-snapshot-eligible-all-time',
      time_filter: storeSnapshot?.time_filter,
      total_prs: storeSnapshot?.github_team_metrics?.total_prs,
      hasPrAnalytics: !!storeSnapshot?.pr_analytics,
      hasPrReviewMetrics: !!storeSnapshot?.pr_review_metrics,
      hasDeploymentMetrics: !!storeSnapshot?.deployment_metrics,
    });
    return normalizeGithubSnapshot(storeSnapshot);
  }

  piDebugLog('[DATA_ACCESS][GH_SNAPSHOT_FALLBACK_FETCH]', {
    reason: storeSnapshot
      ? (storeSnapshot?.time_filter && storeSnapshot.time_filter !== 'all'
        ? `store-snapshot-wrong-time-filter:${storeSnapshot.time_filter}`
        : 'store-snapshot-ineligible')
      : 'store-snapshot-absent',
  });
  return fetchGithubSnapshot();
}

export async function fetchGithubSnapshot(): Promise<any> {
  try {
    // Use buildApiUrl() for consistent API path handling
    // Explicitly request all-time data to avoid backend 'week' default
    const url = buildApiUrl('metrics?time_filter=all&use_all_data=1&nocache=1&github_nocache=1');
    piDebugLog('[DATA_ACCESS][FETCHING_METRICS]', { url });
    // CR-X 3D.4: Use authenticatedFetch (not plain fetch) so the SimpleTokenAuth
    // middleware receives the dashboard credential. Plain fetch() omits the
    // Authorization header, causing a 401 and silently returning undefined —
    // which left PI consuming the stale githubStore LKG cache while PBT's
    // /api/delivery/timeseries (which uses authenticatedFetch) showed the
    // fresh extended population.
    const response = await authenticatedFetch(url);
    if (!response.ok) {
      console.warn('[DATA_ACCESS][METRICS_FETCH_FAILED]', response.status);
      return undefined;
    }

    const data = await response.json();
    const normalized = normalizeGithubSnapshot(data);

    piDebugLog('[DATA_ACCESS][METRICS_FETCHED]', {
      hasPrReviewMetrics: !!normalized.pr_review_metrics,
      hasPrAnalytics: !!normalized.pr_analytics,
      hasDeploymentMetrics: !!normalized.deployment_metrics,
      hasGithubByPeriod: !!normalized.github_by_period,
      hasReviewerLoadConcentration: !!normalized.reviewer_load_concentration,
      hasReopenPressureSpike: normalized.reopen_pressure_spike !== undefined,
      keys: normalized ? Object.keys(normalized) : [],
      prReviewMetricsKeys: normalized.pr_review_metrics ? Object.keys(normalized.pr_review_metrics) : [],
      reviewerLoadConcentrationValue: normalized.reviewer_load_concentration,
      reopenPressureSpikeValue: normalized.reopen_pressure_spike,
      fullReviewerLoadConcentration: normalized.reviewer_load_concentration,
      fullPrReviewMetrics: normalized.pr_review_metrics,
      normalizedPrAnalytics: normalized.pr_analytics,
      normalizedPrReviewMetrics: normalized.pr_review_metrics,
      normalizedDeploymentMetrics: normalized.deployment_metrics
    });

    return normalized;
  } catch (error) {
    console.error('[DATA_ACCESS][METRICS_ERROR]', error);
    return undefined;
  }
}

/**
 * Add derived fields to session rows
 *
 * Currently adds:
 * - session_has_ai_activity: Derived from ai_burst_count, ai_usage_duration_ms, ai_intensity_band
 * - session_active_coding_duration_minutes: Converted from active_coding_duration_ms
 * - session_duration_minutes: Converted from duration_ms
 * - session_commits: Mapped from commits_per_session (aggregated canonical data) or commit_count (fallback)
 * - session_idle_time_minutes: Derived from duration_ms - active_coding_duration_ms
 *
 * FIELD MAPPING STRATEGY:
 * - commits_per_session (from aggregated canonical data) is POPULATED and correct
 * - commit_count (from session-level data) is BROKEN (all zeros)
 * - Priority: commits_per_session > commit_count
 */
export function addDerivedSessionFields(sessionRows: any[]): void {
  sessionRows.forEach(session => {
    // ============================================================
    // CR5 WS1 — COMMIT PROVENANCE CLASSIFICATION
    //
    // Accepted contract (CR5-STATUS.md, CR5-LOG Entry 3):
    //   session_commits_source = 'observed' ONLY when ALL of:
    //     - session_has_commit_outcome === true
    //     - simulated !== true
    //     - session_commits is a finite valid session-level value from
    //       the enriched /api/telemetry/sessions path
    //
    // Canonical commit_count (synthetic backfill from metadata, generated
    // by backfill_session_commits.php based on AI intensity band) is NEVER
    // promoted to 'observed' merely because it is non-zero. It remains
    // 'session_level_fallback' (untrusted for observed provenance).
    //
    // Capability is environment/dataset aware:
    //   - Local: enriched path provides session_has_commit_outcome for
    //     1,069/1,639 non-simulated canonical sessions → observed.
    //   - Staging: no commit outcome evidence → suppressed/data-gap.
    //   - Ed: older backend lacks session_has_commit_outcome → suppressed.
    // Generators that require observed commit data must gate on 'observed'.
    // ============================================================
    const hasObservedCommitOutcome =
      session.session_has_commit_outcome === true && session.simulated !== true;
    const enrichedSessionCommitsValid =
      typeof session.session_commits === 'number' && Number.isFinite(session.session_commits);

    if (hasObservedCommitOutcome && enrichedSessionCommitsValid) {
      // Observed: extension-reported commit outcome on a non-simulated
      // session with a finite session-level session_commits value from
      // the enriched sessions path.
      session.session_commits_source = 'observed';
    } else if (enrichedSessionCommitsValid) {
      // Enriched session_commits present but no observed outcome (or
      // simulated). Keep the value but mark as session_level_fallback.
      session.session_commits_source = 'session_level_fallback';
    } else if (typeof session.commit_count === 'number' && Number.isFinite(session.commit_count) && session.commit_count > 0) {
      // Canonical synthetic backfill only. Never observed.
      session.session_commits = session.commit_count;
      session.session_commits_source = 'session_level_fallback';
    } else if (typeof session.commits_per_session === 'number' && Number.isFinite(session.commits_per_session)) {
      session.session_commits = session.commits_per_session;
      session.session_commits_source = 'aggregated_fallback';
    } else {
      session.session_commits = null;
      session.session_commits_source = 'missing';
    }

    // CR5 WS1.7 P0: Canonical AI-active authority = ai_burst_count > 0.
    // This matches the backend's has_ai filter (TelemetryController.php line 1334/2247).
    // The previous 3-condition derivation (ai_burst_count > 0 OR
    // ai_usage_duration_ms > 0 OR ai_intensity_band !== 'none') counted 22
    // VS Code sessions as AI-active that had ai_usage_duration_ms > 0 but
    // ai_burst_count = 0 and NO ai_accept events. ai_usage_duration_ms is
    // defined as "span between first and last AI burst" — if there are no
    // AI bursts, this value should be 0. The non-zero values are a data
    // quality anomaly, not evidence of AI activity.
    // 22-session delta: 1,657 (3-condition) → 1,635 (ai_burst_count > 0).
    // Observed-commit cohort: 904/165 → 882/187 (total stays 1,069).
    // CR-X Pass 3: Zero is measured data, not missing. If ai_burst_count
    // is undefined/null/NaN, session_has_ai_activity is left unset rather
    // than defaulted to false. Only measured ai_burst_count (including 0)
    // produces a boolean.
    if (typeof session.session_has_ai_activity !== 'boolean') {
      if (typeof session.ai_burst_count === 'number' && Number.isFinite(session.ai_burst_count)) {
        session.session_has_ai_activity = (session.ai_burst_count > 0);
      }
      // else: leave unset — missing data is not "no AI activity"
    }

    // CR-X FINAL: Claude Code-under-VS-Code metadata resolution.
    // When the raw editor_source is 'vscode' but vscode_version is 'claude-code'
    // or extension_version contains 'cc-bridge', resolve the tool to 'claude_code'.
    // This mirrors the accepted Ed reconciliation finding: grouping only by
    // editor_source hid Claude Code and incorrectly made Ed look single-workflow.
    // The canonical workflow-resolution path must recognize this metadata.
    const rawToolForResolution = session.tool ?? session.session_source ?? '';
    if (rawToolForResolution === 'vscode' || rawToolForResolution === 'vs-code' || rawToolForResolution === 'visual studio code') {
      const vscodeVersion = typeof session.vscode_version === 'string' ? session.vscode_version : null;
      const extensionVersion = typeof session.extension_version === 'string' ? session.extension_version : null;
      if (vscodeVersion === 'claude-code' ||
          (extensionVersion && extensionVersion.includes('cc-bridge'))) {
        session.tool = 'claude_code';
        session.session_source = 'claude_code';
        session.editor_source = 'claude_code';
      }
    }

    const toolId = normalizeToCanonicalToolId(session.tool ?? session.session_source ?? '');
    // CR-X 1B.1: Use surfaceAgentContract instead of hardcoded isClaudeCode.
    // The contract is authority — even if the DB has values for unavailable
    // fields (stale/seeded data), we must not propagate them.
    const surface = resolveSurface(toolId);
    const isActiveCodingAvailable = isMetricAvailable(surface, 'active_coding_duration_ms');
    const isIdleTimeAvailable = isMetricAvailable(surface, 'idle_time_ms');
    const isFocusRatioAvailable = isMetricAvailable(surface, 'focus_ratio');
    const isFlowProfileAvailable = isMetricAvailable(surface, 'flow_profile');
    const isFileSaveAvailable = isMetricAvailable(surface, 'file_save_count');

    // CR-X 1B.1: Clear stale DB values for unavailable fields.
    // The DB may have stale/seeded values that violate the bridge contract.
    // The contract is authority — delete these fields so they don't propagate.
    if (!isActiveCodingAvailable) {
      delete session.active_coding_duration_ms;
      delete session.session_active_coding_duration_minutes;
    }
    if (!isIdleTimeAvailable) {
      delete session.idle_time_ms;
      delete session.session_idle_time_minutes;
      delete session.idle_ratio;
    }
    if (!isFocusRatioAvailable) {
      delete session.focus_ratio;
    }
    if (!isFlowProfileAvailable) {
      delete session.flow_profile;
    }
    if (!isFileSaveAvailable) {
      delete session.file_save_count;
      delete session.files_edited;
    }

    // Convert active_coding_duration_ms to minutes (only for workflows that instrument it)
    if (isActiveCodingAvailable && session.active_coding_duration_ms !== undefined && session.active_coding_duration_ms !== null) {
      session.session_active_coding_duration_minutes = session.active_coding_duration_ms / 60000;
    }

    // Convert duration_ms to minutes
    if (session.duration_ms !== undefined && session.duration_ms !== null) {
      session.session_duration_minutes = session.duration_ms / 60000;
    }

    // Derive idle_time_minutes (total duration - active coding duration)
    // CR-X 1B.1: Gate by contract — idle_time is unavailable for terminal workflows
    if (isIdleTimeAvailable && session.duration_ms !== undefined && session.duration_ms !== null &&
        session.active_coding_duration_ms !== undefined && session.active_coding_duration_ms !== null) {
      session.session_idle_time_minutes = (session.duration_ms - session.active_coding_duration_ms) / 60000;
    }

    // Derive session_rework_ratio_est (lines removed / total lines)
    if (session.lines_added_total !== undefined && session.lines_removed_total_est !== undefined) {
      const totalLines = session.lines_added_total + session.lines_removed_total_est;
      if (totalLines > 0) {
        session.session_rework_ratio_est = session.lines_removed_total_est / totalLines;
      } else {
        session.session_rework_ratio_est = 0;
      }
    }

    // Derive rework_band from rework_ratio
    if (session.session_rework_ratio_est !== undefined) {
      if (session.session_rework_ratio_est < 0.2) {
        session.rework_band = 'low';
      } else if (session.session_rework_ratio_est < 0.4) {
        session.rework_band = 'medium';
      } else {
        session.rework_band = 'high';
      }
    }

    // CR1: only measured API quality scores are used; do not synthesize from active/idle time.
    // Derive flow_profile based on idle vs active ratio
    if (session.session_idle_time_minutes !== undefined && session.session_active_coding_duration_minutes !== undefined) {
      const total = session.session_idle_time_minutes + session.session_active_coding_duration_minutes;
      if (total > 0) {
        const idleRatio = session.session_idle_time_minutes / total;
        if (idleRatio > 0.6) {
          session.flow_profile = 'idle-heavy';
        } else if (idleRatio > 0.4) {
          session.flow_profile = 'mixed';
        } else {
          session.flow_profile = 'coding-heavy';
        }
      }
    }

    // Derive focus_ratio (active coding / total duration)
    if (session.session_active_coding_duration_minutes !== undefined && session.session_duration_minutes !== undefined) {
      if (session.session_duration_minutes > 0) {
        session.focus_ratio = session.session_active_coding_duration_minutes / session.session_duration_minutes;
      }
    }

    // Derive idle_ratio (idle time / total duration)
    if (session.session_idle_time_minutes !== undefined && session.session_duration_minutes !== undefined) {
      if (session.session_duration_minutes > 0) {
        session.idle_ratio = session.session_idle_time_minutes / session.session_duration_minutes;
      }
    }

    // Derive ai_intensity_band based on ai_burst_count and session duration
    // Also consider ai_usage_duration_ms as an alternative signal
    if (session.ai_burst_count !== undefined && session.session_duration_minutes !== undefined) {
      const burstsPerMinute = session.ai_burst_count / session.session_duration_minutes;
      const aiUsageMinutes = (session.ai_usage_duration_ms || 0) / 60000;
      const aiUsageRatio = session.session_duration_minutes > 0 ? aiUsageMinutes / session.session_duration_minutes : 0;
      
      // Use both burst frequency and usage duration to determine intensity
      if (burstsPerMinute > 0.5 || aiUsageRatio > 0.5) {
        session.ai_intensity_band = 'high';
      } else if (burstsPerMinute > 0.2 || aiUsageRatio > 0.2) {
        session.ai_intensity_band = 'medium';
      } else if (session.ai_burst_count > 0 || aiUsageMinutes > 0) {
        session.ai_intensity_band = 'low';
      } else {
        session.ai_intensity_band = 'none';
      }
    }

    // Derive session_debug_ratio from debug_time_ms if present
    // This is a telemetry-first field - only compute if raw telemetry field exists
    if (session.debug_time_ms !== undefined && session.debug_time_ms !== null && session.duration_ms !== undefined && session.duration_ms > 0) {
      session.session_debug_ratio = session.debug_time_ms / session.duration_ms;
    }
    // If debug_time_ms is absent, session_debug_ratio remains undefined
    // Generator will handle this as instrumentation gap / null

    // Derive session_terminal_ratio from terminal_active_time_ms if present
    // This is a telemetry-first field - only compute if raw telemetry field exists
    if (session.terminal_active_time_ms !== undefined && session.terminal_active_time_ms !== null && session.duration_ms !== undefined && session.duration_ms > 0) {
      session.session_terminal_ratio = session.terminal_active_time_ms / session.duration_ms;
    }
    // If terminal_active_time_ms is absent, session_terminal_ratio remains undefined
    // Generator will handle this as instrumentation gap / null

    // Derive context_switching_score from idle_ratio (already computed)
    // This is a telemetry-first proxy - use existing idle_ratio as context switching indicator
    // Higher idle_ratio = more context switching / fragmentation
    if (session.idle_ratio !== undefined) {
      session.context_switching_score = session.idle_ratio;
    }
    // If idle_ratio is absent, context_switching_score remains undefined
    // Generator will handle this as instrumentation gap / null

    // ============================================================
    // CR5 WS1 — TTFC PROVENANCE CLASSIFICATION
    //
    // Accepted contract (CR5-STATUS.md, CR5-LOG Entry 3):
    //   ttfc_source = 'observed' ONLY when ALL of:
    //     - session is non-simulated (simulated !== true)
    //     - session has observed commit evidence under the rule above
    //       (session_has_commit_outcome === true && session_commits_source === 'observed')
    //     - TTFC came from the enriched /api/telemetry/sessions path
    //       where backend computeTimeToFirstCommit() is applied
    //       (flagged via ttfc_from_enriched === true)
    //     - value is finite and valid
    //
    // Non-multiple-of-60000 is ONLY corroborating evidence that the
    // enriched path is behaving differently from legacy rounded data;
    // it is NOT the definition of observed provenance.
    //
    // Canonical raw time_to_first_commit_ms (100% multiples of 60000,
    // synthetic backfill) is NEVER promoted to 'observed'. Without the
    // enriched computed path, TTFC is 'missing'.
    // ============================================================
    const ttfcValue = session.time_to_first_commit_ms;
    const ttfcFinite = typeof ttfcValue === 'number' && Number.isFinite(ttfcValue) && ttfcValue >= 0;
    const ttfcFromEnriched = session.ttfc_from_enriched === true;
    const observedCommitForTtfc =
      session.simulated !== true &&
      session.session_has_commit_outcome === true &&
      session.session_commits_source === 'observed';

    if (observedCommitForTtfc && ttfcFromEnriched && ttfcFinite) {
      session.ttfc_source = 'observed';
    } else if (ttfcFromEnriched && ttfcFinite && session.simulated !== true) {
      // Enriched computed TTFC present but commit outcome not observed.
      // Keep value but do not classify as observed (no commit evidence).
      session.ttfc_source = 'session_level_fallback';
    } else {
      // Canonical raw synthetic TTFC, or missing — never observed.
      session.ttfc_source = 'missing';
    }
  });

  const aiActiveCount = sessionRows.filter(s => s.session_has_ai_activity).length;
  const hasActiveCodingCount = sessionRows.filter(s => s.session_active_coding_duration_minutes > 0).length;

  // CR5 WS1 — Provenance runtime evidence (acceptance gate).
  const simulatedCount = sessionRows.filter(s => s.simulated === true).length;
  const observedCommitCount = sessionRows.filter(s => s.session_commits_source === 'observed').length;
  const observedTtfcCount = sessionRows.filter(s => s.ttfc_source === 'observed').length;
  const commitSourceCounts = sessionRows.reduce((acc: Record<string, number>, s) => {
    acc[s.session_commits_source] = (acc[s.session_commits_source] || 0) + 1;
    return acc;
  }, {});
  const ttfcSourceCounts = sessionRows.reduce((acc: Record<string, number>, s) => {
    acc[s.ttfc_source] = (acc[s.ttfc_source] || 0) + 1;
    return acc;
  }, {});

  piDebugLog('[DATA_ACCESS][DERIVED_FIELDS]', {
    totalSessions: sessionRows.length,
    aiActiveSessions: aiActiveCount,
    aiActivePct: sessionRows.length > 0 ? (aiActiveCount / sessionRows.length) * 100 : 0,
    hasActiveCodingSessions: hasActiveCodingCount,
    hasActiveCodingPct: sessionRows.length > 0 ? (hasActiveCodingCount / sessionRows.length) * 100 : 0
  });

  // ── Concurrency: compute developer_elapsed_time (interval-union) ──
  // agent_compute_time = Σ(duration_ms) — existing additive semantic, unchanged
  // developer_elapsed_time = union of [start, end] intervals per developer
  // start = timestamp (session END) - duration_ms
  // This does NOT change existing session_duration_minutes semantics.
  try {
    const timeResult = computeTimeSemantics(sessionRows);
    piDebugLog('[DATA_ACCESS][TIME_SEMANTICS]', {
      agent_compute_time_ms: timeResult.agent_compute_time_ms,
      developer_elapsed_time_ms: timeResult.developer_elapsed_time_ms,
      developer_count: timeResult.developer_count,
      totalSessions: sessionRows.length,
    });
    // Attach to the sessionRows array as metadata (non-enumerable to avoid polluting rows)
    Object.defineProperty(sessionRows, '_timeSemantics', {
      value: timeResult,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  } catch (e) {
    piDebugLog('[DATA_ACCESS][TIME_SEMANTICS_ERROR]', { error: e instanceof Error ? e.message : String(e) });
  }

  piDebugLog('[CR5_WS1][PROVENANCE_SUMMARY]', {
    canonicalCount: sessionRows.length,
    simulatedCount,
    nonSimulatedCount: sessionRows.length - simulatedCount,
    observedCommitCount,
    observedTtfcCount,
    commitSourceCounts,
    ttfcSourceCounts
  });

  // Expose provenance summary on window for runtime acceptance inspection.
  if (typeof window !== 'undefined') {
    if (!(window as any).__CM_DEBUG__) (window as any).__CM_DEBUG__ = {};
    (window as any).__CM_DEBUG__.cr5Ws1Provenance = {
      canonicalCount: sessionRows.length,
      simulatedCount,
      nonSimulatedCount: sessionRows.length - simulatedCount,
      observedCommitCount,
      observedTtfcCount,
      commitSourceCounts,
      ttfcSourceCounts
    };
  }
}

/**
 * CR1 Mission 1: GitHub Evidence Authority
 *
 * Determines GitHub evidence eligibility from the actual provenance contract
 * (github_provenance), not from github_connected (OAuth connection alone is
 * not evidence of usable data).
 *
 * Eligible:
 *   - historical_data_available === true
 *   - provenance.source is NOT a seeded/synthetic source
 *   - db_pr_data_sources contains no seeded/synthetic source
 *   - generated_fallback_used is not true
 *   - all-time historical evidence may be used even when window_data_available
 *     is false, and live_fetch_ok may be false when a valid historical DB
 *     snapshot exists
 *
 * Ineligible provenance sources: seeded_db, fixture_fallback, demo,
 * realism_seeder, cm_activity_sim, or any generated/simulated fallback.
 *
 * CR-X Track A: github_app provenance (from GitHub App installation
 * ingestion) is NOT in the ineligible set — it is authoritative real
 * GitHub evidence, same tier as github_api. The strict gate below
 * accepts it as long as historical_data_available is true.
 */
export const INELIGIBLE_GITHUB_PROVENANCE_SOURCES = new Set([
  'seeded_db',
  'fixture_fallback',
  'demo',
  'realism_seeder',
  'cm_activity_sim'
]);

export function isGithubEvidenceEligible(githubSnapshot: any): boolean {
  if (!githubSnapshot) return false;

  const prov = githubSnapshot.github_provenance;
  // No provenance object present: cannot confirm real production evidence.
  if (!prov) return false;

  if (prov.source && INELIGIBLE_GITHUB_PROVENANCE_SOURCES.has(prov.source)) {
    return false;
  }

  if (Array.isArray(prov.db_pr_data_sources)) {
    const hasIneligibleDbSource = prov.db_pr_data_sources.some((s: string) =>
      INELIGIBLE_GITHUB_PROVENANCE_SOURCES.has(s)
    );
    if (hasIneligibleDbSource) return false;
  }

  if (prov.generated_fallback_used === true) return false;

  // Real historical evidence remains eligible even if the current window is
  // empty; live_fetch_ok may legitimately be false when a valid DB snapshot
  // exists. The only hard requirement is historical_data_available.
  return prov.historical_data_available === true;
}

/**
 * CR5 WS1.7 — Lab-mode GitHub evidence eligibility.
 *
 * CR5 FINAL DOWNSTREAM UPDATE: In Local Lab mode, the explicit cm_activity_sim
 * demo GitHub dataset is eligible in normal /dashboards?v2=1 (no ?piStress=1
 * required). This is the Local demo authority — the simulation assets were
 * deliberately built to demonstrate the product's downstream lifecycle
 * analysis. The provenance label distinguishes demo from real evidence.
 *
 * Two eligibility paths in lab mode:
 *   1. cm_activity_sim demo dataset: eligible when provenance.source ===
 *      'cm_activity_sim' AND historical_data_available === true. This is
 *      the normal dashboard path on localhost.
 *   2. Explicit stress flag (?piStress=1 or ?demoMode=1): any GitHub data
 *      is eligible for generator exercise. This is the dev/stress path.
 *
 * In Live/Customer mode (production), only real GitHub evidence is eligible.
 * The standard isGithubEvidenceEligible() gate applies.
 */
export function isGithubEvidenceEligibleForLab(githubSnapshot: any): boolean {
  if (!githubSnapshot) return false;

  // Path 1: Local lab mode + cm_activity_sim demo dataset (normal dashboard)
  if (isLocalLabMode()) {
    const prov = githubSnapshot.github_provenance;
    if (prov && prov.source === 'cm_activity_sim' && prov.historical_data_available === true) {
      return true;
    }
  }

  // Path 2: Explicit stress flag (dev/stress path)
  const isExplicitStressMode = typeof window !== 'undefined' && (
    window.location.search.includes('piStress=1') ||
    window.location.search.includes('demoMode=1')
  );
  if (!isExplicitStressMode) return false;

  // In explicit stress mode, any GitHub data (seeded or real) is eligible
  // for exercise. The provenance label will distinguish seeded from real.
  const hasGithubData =
    githubSnapshot.total_pull_requests > 0 ||
    githubSnapshot.all_prs_total > 0 ||
    githubSnapshot.all_commits_total > 0 ||
    (githubSnapshot.github_by_period && githubSnapshot.github_by_period.length > 0) ||
    (githubSnapshot.github_provenance && githubSnapshot.github_provenance.historical_data_available === true);

  return hasGithubData;
}

/**
 * CR4 FINAL — Combined GitHub evidence eligibility.
 *
 * Returns true if GitHub evidence is eligible in the current runtime mode.
 * - Live mode: uses isGithubEvidenceEligible() (strict provenance gate)
 * - Lab mode: uses isGithubEvidenceEligibleForLab() (seeded evidence allowed)
 *
 * Use isGithubEvidenceLabeled() to determine the provenance label.
 */
export function isGithubEvidenceEligibleCombined(githubSnapshot: any): boolean {
  return isGithubEvidenceEligible(githubSnapshot) || isGithubEvidenceEligibleForLab(githubSnapshot);
}

/**
 * CR4 FINAL — GitHub evidence provenance label.
 *
 * Returns 'live' for real GitHub evidence, 'seeded' for simulated/seeded
 * evidence, and 'none' when no evidence is available.
 */
export function getGithubEvidenceLabel(githubSnapshot: any): 'live' | 'seeded' | 'none' {
  if (!githubSnapshot) return 'none';

  // Check if real (passed the strict provenance gate)
  if (isGithubEvidenceEligible(githubSnapshot)) return 'live';

  // Check if seeded but eligible in lab mode
  if (isLocalLabMode() && isGithubEvidenceEligibleForLab(githubSnapshot)) {
    // Determine if it's actually seeded by checking the source
    const source = githubSnapshot.github_data_source || '';
    const prov = githubSnapshot.github_provenance;
    if (prov && prov.source && INELIGIBLE_GITHUB_PROVENANCE_SOURCES.has(prov.source)) {
      return 'seeded';
    }
    if (source === 'seeded_db' || source === 'demo' || source === 'fixture_fallback') {
      return 'seeded';
    }
    // If it has data but didn't pass the strict gate, treat as seeded in lab mode
    return 'seeded';
  }

  return 'none';
}

/**
 * CR5 P0.5 — Provenance semantic state for GitHub-backed numeric fields.
 *
 * A numeric field is NOT authoritative merely because it exists.
 * Fixture-fallback APIs return zero-valued objects with keys present,
 * which must NOT be treated as MEASURED_ZERO.
 *
 * Semantic states:
 *   MEASURED_ZERO     — real provenance, value is genuinely zero
 *   MEASURED_NONZERO  — real provenance, value is nonzero
 *   UNKNOWN           — no authoritative provenance; value is meaningless
 *
 * Authority requires ALL of:
 *   - github_provenance exists
 *   - data_source is NOT fixture_fallback/seeded_db/demo/realism_seeder/cm_activity_sim
 *   - historical_data_available === true OR live_fetch_ok === true
 *   - db_data_available === true (when historical_data_available is the basis)
 *
 * In Lab mode, seeded evidence may be eligible for generator exercise but
 * the semantic state remains UNKNOWN — it must not produce numeric findings.
 */
export type GithubProvenanceState = 'MEASURED_ZERO' | 'MEASURED_NONZERO' | 'UNKNOWN';

export function getGithubProvenanceState(
  githubSnapshot: any,
  numericValue: number | null | undefined
): GithubProvenanceState {
  if (!githubSnapshot) return 'UNKNOWN';

  const prov = githubSnapshot.github_provenance;
  const dataSource = githubSnapshot.github_data_source || '';

  // No provenance object — cannot confirm authority
  if (!prov) return 'UNKNOWN';

  // CR5 FINAL DOWNSTREAM — Local lab mode: cm_activity_sim demo dataset is
  // authoritative. The simulation assets were deliberately built as the
  // Local demo authority. In every other environment, cm_activity_sim
  // remains ineligible (the strict gate below applies).
  if (isLocalLabMode() && prov.source === 'cm_activity_sim' && prov.historical_data_available === true) {
    if (numericValue === null || numericValue === undefined) return 'UNKNOWN';
    return numericValue === 0 ? 'MEASURED_ZERO' : 'MEASURED_NONZERO';
  }

  // Check for ineligible provenance sources
  if (INELIGIBLE_GITHUB_PROVENANCE_SOURCES.has(dataSource)) return 'UNKNOWN';
  if (prov.source && INELIGIBLE_GITHUB_PROVENANCE_SOURCES.has(prov.source)) return 'UNKNOWN';
  if (prov.generated_fallback_used === true) return 'UNKNOWN';

  // Check authority flags — at least one must be true
  const hasHistorical = prov.historical_data_available === true;
  const hasLiveFetch = prov.live_fetch_ok === true;
  const hasDbData = prov.db_data_available === true;

  // If historical_data_available is the basis, db_data_available must also be true
  if (hasHistorical && !hasDbData) return 'UNKNOWN';
  if (!hasHistorical && !hasLiveFetch) return 'UNKNOWN';

  // Provenance is authoritative — classify the value
  if (numericValue === null || numericValue === undefined) return 'UNKNOWN';
  return numericValue === 0 ? 'MEASURED_ZERO' : 'MEASURED_NONZERO';
}

/**
 * CR5 P0.5 — GitHub evidence authority check for generators.
 *
 * Returns true ONLY when the GitHub snapshot has authoritative provenance
 * AND the specified numeric field has a non-zero measured value.
 *
 * Use this instead of `Object.keys(deployment_metrics).length > 0` which
 * passes for fixture-fallback zero-valued objects.
 */
export function hasAuthoritativeGithubEvidence(
  githubSnapshot: any,
  numericField: number | null | undefined
): boolean {
  const state = getGithubProvenanceState(githubSnapshot, numericField);
  return state === 'MEASURED_NONZERO' || state === 'MEASURED_ZERO';
}

/**
 * Determine data mode (live, seeded, mixed)
 * 
 * This helps generators understand the provenance of their data
 */
export function determineDataMode(input: CanonicalInsightInput): 'live' | 'seeded' | 'mixed' {
  const hasLiveSessions = input.sessionRows.length > 0;
  const hasRealGithubData = isGithubEvidenceEligible(input.githubSnapshot);

  if (hasLiveSessions && hasRealGithubData) {
    return 'live';
  } else if (hasLiveSessions || hasRealGithubData) {
    return 'mixed';
  } else {
    return 'seeded';
  }
}
