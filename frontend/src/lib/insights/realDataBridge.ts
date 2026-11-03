// Real Data Bridge - connects insights to actual product data
import type { Granularity } from './time'
import type { SessionDataPoint } from './types'
import { normalizeToolId } from './providers'
import { authenticatedFetch } from '../../config/api'
import { fetchSessionPrimitives } from './final/dataAccess'
import { resolveSurface, isMetricAvailable } from '../surfaceAgentContract'

/**
 * MVP Quality Gate: Simulated data is ONLY available in debug mode.
 * In production, all simulated/random data paths return empty arrays.
 */
const PI_DEBUG_ENV = typeof import.meta !== 'undefined'
  ? ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false')
  : 'false';
const PI_DEBUG = PI_DEBUG_ENV === 'true' || PI_DEBUG_ENV === '1';
const IS_DEVELOPMENT = typeof import.meta !== 'undefined'
  ? (import.meta as any).env?.DEV === true
  : false;

// Access the actual product data from the main component
export function getRealProductData() {
  // Try to access the main product's data from the global scope
  if (typeof window !== 'undefined') {
    // Look for the main product's data in the global scope
    const mainProductData = (window as any).mainProductData
    
    if (mainProductData) {
      return mainProductData
    }
  }
  
  return null
}

// Direct access to the main product's reactive data
export function getMainProductMetrics() {
  if (typeof window !== 'undefined') {
    // Try to access the main product's metrics directly
    const mainProduct = (window as any).mainProductInstance
    if (mainProduct?.metrics?.value?.team_metrics) {
      return mainProduct.metrics.value.team_metrics
    }
  }
  return null
}

export function getMainProductSimulatedData() {
  if (typeof window !== 'undefined') {
    const mainProduct = (window as any).mainProductInstance
    if (mainProduct?.simulatedMetricsHistory?.value) {
      return mainProduct.simulatedMetricsHistory.value
    }
  }
  return null
}

export function getMainProductHistoricalData() {
  if (typeof window !== 'undefined') {
    const mainProduct = (window as any).mainProductInstance
    if (mainProduct?.historicalSnapshots?.value) {
      return mainProduct.historicalSnapshots.value
    }
  }
  return null
}

// GitHub resolver that tries to access real product data
export function resolveRealGitHubData(granularity: Granularity) {
  // Try direct access first
  const teamMetrics = getMainProductMetrics()
  if (teamMetrics) {
    const timeSeriesData = convertTeamMetricsToTimeSeries(teamMetrics, granularity)
    return { data: timeSeriesData, source: 'real-product-team-metrics-direct' }
  }
  
  // Fallback to injected data
  const realData = getRealProductData()
  if (realData?.team_metrics) {
    const timeSeriesData = convertTeamMetricsToTimeSeries(realData.team_metrics, granularity)
    return { data: timeSeriesData, source: 'real-product-team-metrics-injected' }
  }
  
  return { data: [], source: 'none' }
}

// Productivity resolver that tries to access real product data
// MVP QUALITY: Simulated data is gated behind PI_DEBUG flag
export function resolveRealProductivityData(granularity: Granularity) {
  // MVP QUALITY GATE: Only allow simulated data in debug mode
  if (!PI_DEBUG && !IS_DEVELOPMENT) {
    // In production, return empty - no simulated data allowed
    return { data: [], source: 'none-simulated-data-blocked' }
  }

  // Try direct access first
  const simulatedData = getMainProductSimulatedData()
  const historicalData = getMainProductHistoricalData()

  if (simulatedData || historicalData) {
    const timeSeriesData = convertSimulatedDataToTimeSeries({ simulatedData, historicalData }, granularity)
    return { data: timeSeriesData, source: 'real-product-simulated-data-direct' }
  }

  // Fallback to injected data
  const realData = getRealProductData()
  if (realData?.simulatedMetricsHistory || realData?.historicalSnapshots) {
    const timeSeriesData = convertSimulatedDataToTimeSeries(realData, granularity)
    return { data: timeSeriesData, source: 'real-product-simulated-data-injected' }
  }

  return { data: [], source: 'none' }
}

// Convert team metrics to time series format
// MVP QUALITY: This function adds random variation - only use in debug mode
function convertTeamMetricsToTimeSeries(teamMetrics: any, granularity: Granularity): any[] {
  if (!teamMetrics) return []

  // MVP QUALITY GATE: Random variation only in debug mode
  if (!PI_DEBUG && !IS_DEVELOPMENT) {
    console.warn('[PI_MVP] convertTeamMetricsToTimeSeries blocked - simulated data not allowed in production')
    return []
  }

  // Create time series data from the team metrics
  const timeSeriesData: any[] = []
  const periods = generatePeriods(granularity, 8) // 8 periods

  periods.forEach((period) => {
    // Use the team metrics as base data and add some variation
    const variation = 0.8 + (Math.random() * 0.4) // 0.8 to 1.2

    timeSeriesData.push({
      period,
      prCycleTimeHours: (teamMetrics.lead_time || 24) * variation,
      timeToFirstReviewHours: (teamMetrics.code_review_time || 4) * variation,
      deploymentFreqPerWeek: (teamMetrics.deployment_frequency || 3) * variation,
      mergeRatePct: (teamMetrics.merge_rate || 70) * variation,
      changeFailureRatePct: (teamMetrics.change_failure_rate || 5) * variation,
    })
  })

  return timeSeriesData
}

// Convert simulated data to time series format
// MVP QUALITY: This function generates random data - only use in debug mode
function convertSimulatedDataToTimeSeries(simulatedData: any, granularity: Granularity): any[] {
  if (!simulatedData) return []

  // MVP QUALITY GATE: Random data generation only in debug mode
  if (!PI_DEBUG && !IS_DEVELOPMENT) {
    console.warn('[PI_MVP] convertSimulatedDataToTimeSeries blocked - simulated data not allowed in production')
    return []
  }

  const timeSeriesData: any[] = []
  const periods = generatePeriods(granularity, 8) // 8 periods
  const tools = ['cursor', 'vscode', 'intellij', 'windsurf', 'jetbrains', 'sublime', 'vim']

  periods.forEach((period) => {
    tools.forEach(tool => {
      // Use simulated data as base and add variation
      const variation = 0.8 + (Math.random() * 0.4) // 0.8 to 1.2

      timeSeriesData.push({
        period,
        tool,
        aiAssists: (50 + Math.random() * 100) * variation,
        codingMinutes: (120 + Math.random() * 120) * variation,
      })
    })
  })

  return timeSeriesData
}

// Generate periods for the given granularity
function generatePeriods(granularity: Granularity, count: number): string[] {
  const periods = []
  const now = new Date()
  
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(now)
    
    switch (granularity) {
      case 'hour':
        date.setHours(date.getHours() - i)
        periods.push(date.toISOString().slice(0, 13) + ':00:00')
        break
      case 'day':
        date.setDate(date.getDate() - i)
        periods.push(date.toISOString().slice(0, 10))
        break
      case 'week':
        date.setDate(date.getDate() - (i * 7))
        periods.push(date.toISOString().slice(0, 10))
        break
      case 'month':
        date.setMonth(date.getMonth() - i)
        periods.push(date.toISOString().slice(0, 7))
        break
      case 'quarter':
        date.setMonth(date.getMonth() - (i * 3))
        const quarter = Math.floor(date.getMonth() / 3) + 1
        periods.push(`${date.getFullYear()}-Q${quarter}`)
        break
      default:
        date.setDate(date.getDate() - i)
        periods.push(date.toISOString().slice(0, 10))
    }
  }
  
  return periods
}

// Bridge function to inject real product data into the global scope
export function injectRealProductData(data: any) {
  if (typeof window !== 'undefined') {
    (window as any).mainProductData = data
  }
}

// ============================================================================
// SESSION DATA FETCHING (for TTFC and session-based insights)
// ============================================================================

// Debug flag for TTFC diagnostics
const TTFC_DEBUG = typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TTFC_DEBUG === 'true'

// Module-level export for debugging raw session sample from API
export let __CM_RAW_SESSION_SAMPLE: any = null


/**
 * Fetch sessions from the backend API for insight generation.
 * 
 * @param days - Time window in days (7, 30, or 'all')
 * @param options - Additional filter options
 * @returns Promise<SessionDataPoint[]>
 */
export async function fetchSessionsForInsights(
  days: 7 | 30 | 'all' = 7,
  options?: {
    qualityBand?: 'high' | 'medium' | 'low'
    flowProfile?: 'idle-heavy' | 'debug-heavy' | 'terminal-heavy' | 'coding-heavy' | 'mixed'
    hasAi?: boolean
    perPage?: number
    page?: number
  },
  signal?: AbortSignal
): Promise<SessionDataPoint[]> {
  try {
    // Build query parameters for canonical endpoint
    const params = new URLSearchParams()
    
    // Canonical endpoint uses from/to dates instead of days parameter
    const toDate = new Date().toISOString().split('T')[0]
    const fromDate = days === 'all' ? '2020-01-01' : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    
    params.set('from', fromDate)
    params.set('to', toDate)
    params.set('format', 'sessions')
    params.set('tools', 'all')
    
    if (options?.qualityBand) params.set('quality_band', options.qualityBand)
    if (options?.flowProfile) params.set('flow_profile', options.flowProfile)
    if (options?.hasAi !== undefined) params.set('has_ai', String(options.hasAi))
    params.set('per_page', String(options?.perPage || 200))
    if (options?.page) params.set('page', String(options.page))
    
    // Get API base URL from environment
    const apiBaseUrl = (import.meta as any).env?.VITE_API_BASE_URL || ''
    
    // CRITICAL: Use canonical telemetry endpoint for consistency with PI and Productivity V3
    // This ensures all surfaces operate on the same telemetry universe (canonical population)
    const requestUrl = `${apiBaseUrl}/api/telemetry/canonical?${params.toString()}`
    
    // TTFC_DEBUG: Log request URL
    if (TTFC_DEBUG) {
      console.warn('[TTFC_DEBUG][SessionsFetch] Request URL:', requestUrl)
    }
    
    // Using public endpoint - no auth required for eng leader deployments
    const response = await authenticatedFetch(requestUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal, // Add AbortSignal support
    })
    
    if (PI_DEBUG) console.log('[PI_DEBUG][SESSIONS_API]', {
      requestUrl,
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
    })
    
    if (!response.ok) {
      console.warn('[SessionsFetch] API error:', response.status, response.statusText)
      if (TTFC_DEBUG) {
        console.warn('[TTFC_DEBUG][SessionsFetch] API FAILED:', { status: response.status, statusText: response.statusText })
      }
      return []
    }
    
    const json = await response.json()
    
    if (PI_DEBUG) console.log('[PI_DEBUG][SESSIONS_RESPONSE]', {
      sessionsCount: Array.isArray(json) ? json.length : 'not_array',
      firstSession: Array.isArray(json) && json.length > 0 ? json[0] : null,
      responseType: typeof json,
      jsonKeys: Object.keys(json),
      hasData: !!(json && json.data),
      dataIsArray: Array.isArray(json?.data),
      dataLength: json?.data?.length,
      fullResponse: json
    })
    
    // Capture raw session sample for debugging (before mapping)
    if (json.data && Array.isArray(json.data) && json.data.length > 0) {
      __CM_RAW_SESSION_SAMPLE = json.data[0]
    } else {
      __CM_RAW_SESSION_SAMPLE = null
    }
    
    // Map response data to SessionDataPoint array
    if (PI_DEBUG) console.log('[PI_DEBUG][SESSIONS_MAPPING_START]', {
      inputCount: (json.data || []).length,
      firstRawSession: (json.data || [])[0]
    })
    
    const sessions: SessionDataPoint[] = (json.data || []).map((s: any) => {
      // Extract tool identity with priority: tool > editor_source > source > ide > client > appName > uriScheme
      // Also check metadata.* variants
      const toolCandidates = [
        s.tool,
        s.editor_source,
        s.source,
        s.ide,
        s.client,
        s.appName,
        s.uriScheme,
        s.metadata?.tool,
        s.metadata?.editor_source,
        s.metadata?.source,
        s.metadata?.ide,
        s.metadata?.client,
        s.metadata?.appName,
        s.metadata?.uriScheme,
      ];
      const rawSource = toolCandidates.find(v => v !== undefined && v !== null && String(v).trim() !== '') || '';
      const normalizedTool = normalizeToolId(rawSource);
      // Allow any tool string from canonical telemetry population
      const tool: string | undefined = normalizedTool !== 'unknown' ? normalizedTool : undefined;
      
      return {
        session_id: s.session_id || s.id,
        timestamp: s.timestamp,
        duration_ms: s.duration_ms || 0,
        user_id: s.user_id || '',
        git_repo_url: s.git_repo_url,
        git_branch: s.git_branch,
        time_to_first_commit_ms: s.time_to_first_commit_ms,
        ai_burst_count: s.ai_burst_count || 0,
        ai_active_span_ms: s.ai_active_span_ms,
        ai_burst_chars_total: s.ai_burst_chars_total || 0,
        ai_chars_per_min: s.ai_chars_per_min,
        ai_intensity_band: s.ai_intensity_band || 'none',
        rework_ratio_est: s.rework_ratio_est || 0,
        rework_band: s.rework_band,
        focus_ratio: s.focus_ratio || 0,
        flow_profile: s.flow_profile || 'mixed',
        idle_ratio: s.idle_ratio || 0,
        debug_ratio: s.debug_ratio || 0,
        terminal_ratio: s.terminal_ratio || 0,
        // Git context fields for Review & Merge insights
        git_context_attempts: s.git_context_attempts || 0,
        git_context_resolution_ms: s.git_context_resolution_ms || 0,
        git_context_resolved_before_end: s.git_context_resolved_before_end || false,
        git_context_status: s.git_context_status,
        git_context_reason: s.git_context_reason,
        // Activity metrics for Review & Merge insights
        // CR-X 1B.1: Gate by surfaceAgentContract — suppress unavailable fields
        // even if the DB has values (stale/seeded data violating bridge contract)
        active_coding_duration_ms: isMetricAvailable(resolveSurface(tool), 'active_coding_duration_ms')
          ? (s.active_coding_duration_ms || 0)
          : 0,
        chars_added_total: s.chars_added_total || 0,
        chars_removed_total_est: s.chars_removed_total_est || 0,
        lines_added_total: s.lines_added_total || 0,
        lines_removed_total_est: s.lines_removed_total_est || 0,
        session_quality_score: s.session_quality_score,
        session_quality_band: s.session_quality_band,
        is_remote_workspace: s.is_remote_workspace || false,
        remote_name: s.remote_name,
        extension_version: s.extension_version,
        vscode_version: s.vscode_version,
        tool, // IDE tool identity (optional)
      };
    })
    
    if (PI_DEBUG) console.log('[PI_DEBUG][SESSIONS_MAPPING_COMPLETE]', {
      outputCount: sessions.length,
      firstMappedSession: sessions[0],
      sampleSessionKeys: sessions[0] ? Object.keys(sessions[0]) : 'NO_SESSIONS',
      allSessionsValid: sessions.every(s => s.session_id && s.timestamp)
    })
    
    // CRITICAL DEBUG: Log if sessions are empty or malformed, but skip in Demo Mode
    const isDemoMode = typeof window !== 'undefined' && (
      new URLSearchParams(window.location.search).get('piStress') === '1' ||
      new URLSearchParams(window.location.search).get('demoMode') === '1'
    );
    
    // Handle empty sessions with improved logic
    if (sessions.length === 0 && !isDemoMode) {
      const hasPopulation = json.canonical_population_count > 0;
      const totalPages = json.total_pages || 1;
      const currentPage = options?.page || 1;
      const isMultiPageContext = !!options?._isMultiPageContext;
      
      // Retry case: positive population count, single page, not already retried
      if (hasPopulation && totalPages === 1 && currentPage === 1 && !options?._retried && !isMultiPageContext) {
        if (PI_DEBUG) console.log('[PI_DEBUG][RETRYING] Empty sessions with positive population, retrying page 1...');
        
        // Retry once
        const retryOptions = { ...options, _retried: true, page: 1 };
        return fetchCanonicalSessions(days, retryOptions);
      }
      
      // Expected empty later pages in multi-page fetch - not critical
      if (isMultiPageContext && currentPage > 1) {
        if (PI_DEBUG) console.log('[PI_DEBUG][EMPTY_LATER_PAGE] Page', currentPage, 'empty in multi-page fetch (expected)');
      } else {
        // Critical error case: after retry or truly no data on page 1
        console.error('[PI_DEBUG][CRITICAL] No sessions returned from API!')
        console.error('[PI_DEBUG][CRITICAL] Original API response:', json)
        console.error('[PI_DEBUG][CRITICAL] Context:', { hasPopulation, totalPages, currentPage, retried: !!options?._retried, isMultiPageContext })
      }
    } else if (sessions.length === 0 && isDemoMode) {
      if (PI_DEBUG) console.log('[PI_DEBUG][DEMO_MODE] Legacy bridge skipped in Demo Mode - using fixture data');
    }
    
    // TTFC_DEBUG: Comprehensive session diagnostics
    if (TTFC_DEBUG) {
      const now = new Date()
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
      
      const withTTFC = sessions.filter(s => s.time_to_first_commit_ms !== null && s.time_to_first_commit_ms > 0)
      const inCurrentWindow = withTTFC.filter(s => new Date(s.timestamp) >= sevenDaysAgo)
      const inBaselineWindow = withTTFC.filter(s => {
        const ts = new Date(s.timestamp)
        return ts >= fourteenDaysAgo && ts < sevenDaysAgo
      })
      
      console.warn('[TTFC_DEBUG][SessionsFetch] Response diagnostics:', {
        totalSessionsReturned: sessions.length,
        sessionsWithTTFC: withTTFC.length,
        sessionsInCurrentWindow: inCurrentWindow.length,
        sessionsInBaselineWindow: inBaselineWindow.length,
        sampleSessionKeys: sessions[0] ? Object.keys(sessions[0]) : 'NO_SESSIONS',
        sampleTTFCValues: withTTFC.slice(0, 3).map(s => ({
          ttfc_ms: s.time_to_first_commit_ms,
          ttfc_min: s.time_to_first_commit_ms ? (s.time_to_first_commit_ms / 60000).toFixed(1) : null,
          timestamp: s.timestamp
        }))
      })
    }
    
    if (PI_DEBUG) console.log('[SessionsFetch] Fetched', sessions.length, 'sessions for insights')
    return sessions
    
  } catch (error) {
    console.warn('[SessionsFetch] Error fetching sessions:', error)
    if (TTFC_DEBUG) {
      console.warn('[TTFC_DEBUG][SessionsFetch] EXCEPTION:', error)
    }
    return []
  }
}

/**
 * Fetch sessions for TTFC analysis (scoped to specified days, default all historical)
 * 
 * @param days - Time window in days (default: 0 = all historical data)
 * @param signal - Optional AbortSignal for request cancellation
 * @returns Promise<SessionDataPoint[]>
 */
/**
 * CR5 WS1.4 P0 FIX: Shared mapping from canonical row to SessionDataPoint.
 * Used by both the cached path (fetchSessionPrimitives) and the direct
 * fetch path, ensuring consistent shape.
 */
function mapCanonicalRowToSessionDataPoint(s: any): SessionDataPoint {
  const toolCandidates = [
    s.tool, s.editor_source, s.source, s.ide, s.client, s.appName, s.uriScheme,
    s.metadata?.tool, s.metadata?.editor_source, s.metadata?.source, s.metadata?.ide,
    s.metadata?.client, s.metadata?.appName, s.metadata?.uriScheme,
  ];
  const rawSource = toolCandidates.find(v => v !== undefined && v !== null && String(v).trim() !== '') || '';
  const normalizedTool = normalizeToolId(rawSource);
  const tool: string | undefined = normalizedTool !== 'unknown' ? normalizedTool : undefined;
  // CR-X 1B.1: Resolve surface for capability gating
  const surface = resolveSurface(tool);

  return {
    session_id: s.session_id || s.id,
    timestamp: s.timestamp,
    duration_ms: s.duration_ms || 0,
    user_id: s.user_id || '',
    git_repo_url: s.git_repo_url,
    git_branch: s.git_branch,
    time_to_first_commit_ms: s.time_to_first_commit_ms,
    ai_burst_count: s.ai_burst_count || 0,
    ai_active_span_ms: s.ai_active_span_ms,
    ai_burst_chars_total: s.ai_burst_chars_total || 0,
    ai_chars_per_min: s.ai_chars_per_min,
    ai_intensity_band: s.ai_intensity_band || 'none',
    rework_ratio_est: s.rework_ratio_est || 0,
    rework_band: s.rework_band,
    // CR-X 1B.1: Gate focus_ratio, flow_profile, idle_ratio by contract
    focus_ratio: isMetricAvailable(surface, 'focus_ratio') ? (s.focus_ratio || 0) : 0,
    flow_profile: isMetricAvailable(surface, 'flow_profile') ? (s.flow_profile || 'mixed') : 'mixed',
    idle_ratio: isMetricAvailable(surface, 'idle_time_ms') ? (s.idle_ratio || 0) : 0,
    debug_ratio: s.debug_ratio || 0,
    terminal_ratio: s.terminal_ratio || 0,
    git_context_attempts: s.git_context_attempts || 0,
    git_context_resolution_ms: s.git_context_resolution_ms || 0,
    git_context_resolved_before_end: s.git_context_resolved_before_end || false,
    git_context_status: s.git_context_status,
    git_context_reason: s.git_context_reason,
    // CR-X 1B.1: Gate active_coding_duration_ms by contract
    active_coding_duration_ms: isMetricAvailable(surface, 'active_coding_duration_ms')
      ? (s.active_coding_duration_ms || 0)
      : 0,
    chars_added_total: s.chars_added_total || 0,
    chars_removed_total_est: s.chars_removed_total_est || 0,
    lines_added_total: s.lines_added_total || 0,
    lines_removed_total_est: s.lines_removed_total_est || 0,
    commit_count: s.commit_count || 0,
    files_edited: s.files_edited || 0,
    session_quality_score: s.session_quality_score,
    session_quality_band: s.session_quality_band,
    is_remote_workspace: s.is_remote_workspace || false,
    remote_name: s.remote_name,
    extension_version: s.extension_version,
    vscode_version: s.vscode_version,
    tool,
  };
}

export async function fetchSessionsForTTFC(
  days: number = 0, // 0 means all historical data
  signal?: AbortSignal,
  cohortId?: string // K1B: cohort scope forwarded to the canonical fetch/cache
): Promise<SessionDataPoint[]> {
  // CR-X FINAL P0: ALWAYS reuse the cached all-time canonical rows from
  // fetchSessionPrimitives instead of issuing a duplicate canonical session
  // scan. The all-time population contains every session, so any days>0
  // window is a strict subset — we filter by timestamp.
  //
  // This eliminates the duplicate canonical session paginated request that
  // was contending with the primary session fetch on the SQLite backend,
  // causing 60-100s cold loads.
  //
  // The 30s cache + in-flight dedupe in fetchSessionPrimitives ensures this
  // is free if fetchSharedEnrichedCanonical already fetched the same population.
  try {
    // K1B: when a cohort is active the cache key must include it — passing
    // an empty/undefined cohort would reuse the org-wide population.
    const cachedRows = await fetchSessionPrimitives(cohortId ? { cohortId } : undefined);
    if (cachedRows.length > 0) {
      if (days === 0) {
        if (PI_DEBUG) console.log('[fetchSessionsForTTFC] Reusing cached canonical rows (all-time):', cachedRows.length);
        return cachedRows.map((s: any) => mapCanonicalRowToSessionDataPoint(s));
      }
      // Filter by timestamp for days > 0
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
      const filtered = cachedRows.filter((s: any) => {
        const ts = s.timestamp;
        if (!ts) return false;
        const tsMs = typeof ts === 'number' ? ts : new Date(ts).getTime();
        return tsMs >= cutoffMs;
      });
      if (PI_DEBUG) console.log('[fetchSessionsForTTFC] Reusing cached canonical rows (filtered to last', days, 'days):', filtered.length, 'of', cachedRows.length);
      return filtered.map((s: any) => mapCanonicalRowToSessionDataPoint(s));
    }
    // Fall through to direct fetch if cache is empty
  } catch (err) {
    console.warn('[fetchSessionsForTTFC] Cached fetch failed, falling back to direct fetch:', err);
    // Fall through to direct fetch
  }

  // Use all historical data for MVP (days=0) or clamp to reasonable max
  const clampedDays = days === 0 ? 'all' : Math.min(Math.max(days, 7), 30) as 7 | 30 | 'all'

  // Fetch first page with metadata
  const apiBaseUrl = ((import.meta as any).env?.VITE_API_BASE_URL || '')
    .replace(/\/$/, '')
    .replace(/\/api$/, '')
  const toDate = new Date().toISOString().split('T')[0]
  const fromDate = clampedDays === 'all' ? '2020-01-01' : new Date(Date.now() - (clampedDays as number) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  
  const params = new URLSearchParams()
  params.set('from', fromDate)
  params.set('to', toDate)
  params.set('format', 'sessions')
  params.set('tools', 'all')
  params.set('per_page', '1000') // CR-X Phase 3: increased from 200 to reduce pagination round-trips
  params.set('page', '1')
  if (cohortId && cohortId !== 'all') params.set('cohort_id', cohortId)
  
  const requestUrl = `${apiBaseUrl}/api/telemetry/canonical?${params.toString()}`
  
  if (PI_DEBUG) console.log('[AIOI_FETCH_START] Fetching sessions from:', requestUrl)
  
  try {
    const response = await authenticatedFetch(requestUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal,
    })
    
    if (!response.ok) {
      console.warn('[fetchSessionsForTTFC] API error:', response.status)
      return []
    }
    
    const json = await response.json()
    
    // Extract total_pages from metadata
    const totalPagesFromResponse =
      Number(json.total_pages) ||
      Number(json.meta?.total_pages) ||
      Number(json.pagination?.total_pages) ||
      Number(json.metadata?.total_pages) ||
      1
    
    const totalPages = Math.max(1, totalPagesFromResponse)
    
    if (PI_DEBUG) console.log('[fetchSessionsForTTFC] First page metadata:', {
      totalPages,
      totalPopulation: json.canonical_population_count,
      firstPageDataCount: json.data?.length
    })
    
    // Map first page sessions
    const firstPageSessions = (json.data || []).map((s: any) => mapCanonicalRowToSessionDataPoint(s))
    
    if (firstPageSessions.length === 0) {
      return firstPageSessions
    }
    
    // If only 1 page, return first page
    if (totalPages <= 1) {
      if (PI_DEBUG) console.log('[fetchSessionsForTTFC] Single page only, returning', firstPageSessions.length, 'sessions')
      return firstPageSessions
    }
    
    // Fetch remaining pages
    const allSessions = [...firstPageSessions]
    const MAX_PAGES = 50 // Safety limit
    
    for (let page = 2; page <= Math.min(totalPages, MAX_PAGES); page++) {
      const pageParams = new URLSearchParams(params.toString())
      pageParams.set('page', String(page))
      
      const pageResponse = await authenticatedFetch(`${apiBaseUrl}/api/telemetry/canonical?${pageParams.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal,
      })
      
      if (!pageResponse.ok) {
        console.warn('[fetchSessionsForTTFC] Page', page, 'fetch failed, stopping pagination')
        break
      }
      
      const pageJson = await pageResponse.json()
      const pageSessions = (pageJson.data || []).map((s: any) => mapCanonicalRowToSessionDataPoint(s))
      
      if (pageSessions.length === 0) {
        if (PI_DEBUG) console.log('[fetchSessionsForTTFC] Page', page, 'empty, stopping pagination')
        break
      }
      
      allSessions.push(...pageSessions)
      if (PI_DEBUG) console.log('[fetchSessionsForTTFC] Fetched page', page, 'with', pageSessions.length, 'sessions')
    }
    
    if (PI_DEBUG) console.log('[fetchSessionsForTTFC] Total sessions fetched:', allSessions.length, 'from', totalPages, 'pages')
    return allSessions
    
  } catch (error) {
    console.warn('[fetchSessionsForTTFC] Error:', error)
    return []
  }
}
