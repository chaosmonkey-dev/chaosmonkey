import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { API_ENDPOINTS } from '../config/api'
import { log, error as logError } from '../utils/logger'

// Types
export type TimeRange = 'all' | 'week' | 'month' | 'quarter'

export interface GitHubMetrics {
  commits: number
  pullRequests: number
  mergedPRs: number
  mergeRate: number
  prsPerDeveloper: number
  issues: number
  openIssues: number
  repositories: number
  contributors: number
  codeReviewTime: number
  leadTime: number
  reopenedPRs: number
  rejectedPRs: number
  commentToMergeRatio: number
  deploymentFrequency: number
  changeFailureRate: number
  meanTimeToRecovery: number
  // Real GitHub API data
  totalCommits: number
  totalIssues: number
  uniqueContributors: number
  commitsPerDay: number
  issuesPerDay: number
}

export interface GitHubRepository {
  id: number
  name: string
  full_name: string
  description: string | null
  private: boolean
  fork: boolean
  stargazers_count: number
  language: string | null
  updated_at: string
}

// 🔥 DEV-ONLY: Prevent multiple simultaneous API_ENDPOINTS.METRICS calls
let isFetchingMetrics = false
let lastFetchTime = 0
// 🔥 FIX: Increased from 2000ms to 5000ms to prevent rapid-refresh race conditions
const MIN_FETCH_INTERVAL = 5000 // 5 seconds between calls

export const useGitHubStore = defineStore('github', () => {
  // State
  const metrics = ref<GitHubMetrics | null>(null)
  const repositories = ref<GitHubRepository[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const rawResponse = ref<any>(null)  // Store raw API response for snapshot data
  const connected = ref(false)
  const connectionReason = ref<string | null>(null)

  // 🔥 PHASE 3: Per-range cache for instant data availability
  const rawResponseByRange = ref<Record<string, any>>({})
  const lastFetchTimeByRange = ref<Record<string, number>>({})

  // 🔥 PHASE 4: sessionStorage-backed Last-Known-Good (LKG) cache
  const LKG_STORAGE_KEY = 'cm_github_lkg'

  function isValidSnapshot(payload: any): boolean {
    if (!payload || typeof payload !== 'object') return false
    // Must contain at least one major metrics section
    return !!(
      payload.github_team_metrics ||
      payload.pr_review_metrics ||
      payload.deployment_metrics ||
      (payload.github_connected === true)
    )
  }

  function persistLKG(range: string, payload: any): void {
    try {
      const existing = JSON.parse(sessionStorage.getItem(LKG_STORAGE_KEY) || '{}')
      existing[range] = { data: payload, ts: Date.now() }
      sessionStorage.setItem(LKG_STORAGE_KEY, JSON.stringify(existing))
    } catch { /* quota or serialization error — ignore */ }
  }

  function loadLKG(range: string): any | null {
    try {
      const stored = JSON.parse(sessionStorage.getItem(LKG_STORAGE_KEY) || '{}')
      return stored[range]?.data ?? null
    } catch { return null }
  }

  // Hydrate from sessionStorage on init
  // 🔥 LIVE PILOT MODE: Disable LKG hydration whenever live-pilot mode is enabled
  const isLivePilotRuntime =
    (import.meta as any).env?.VITE_LIVE_PILOT_MODE === 'true' &&
    typeof window !== 'undefined'

  if (isLivePilotRuntime) {
    log('[GH_LKG] Live-pilot mode - skipping LKG hydration')
    // Clear LKG cache in live-pilot mode
    try {
      sessionStorage.removeItem(LKG_STORAGE_KEY)
    } catch { /* ignore */ }
  } else {
    try {
      const stored = JSON.parse(sessionStorage.getItem(LKG_STORAGE_KEY) || '{}')
      // Find most recent entry across all ranges
      let bestEntry: { data: any; ts: number } | null = null
      for (const key of Object.keys(stored)) {
        const entry = stored[key]
        if (entry?.data && isValidSnapshot(entry.data)) {
          if (!bestEntry || entry.ts > bestEntry.ts) bestEntry = entry
        }
        // Also populate per-range cache
        if (entry?.data) rawResponseByRange.value[key] = entry.data
      }
      if (bestEntry) {
        rawResponse.value = bestEntry.data
        connected.value = bestEntry.data.github_connected ?? false
        log('[GH_LKG] Hydrated from sessionStorage on init', {
          keys: Object.keys(bestEntry.data).slice(0, 10),
          ts: bestEntry.ts
        })
      }
    } catch { /* ignore parse errors */ }
  }

  // 🔥 HELPER: Check if GitHub payload contains meaningful data
  function isMeaningfulGitHubPayload(payload: any): boolean {
    if (!payload || typeof payload !== 'object') return false
    
    return (
      payload?.github_connected === true ||
      typeof payload?.deployment_metrics?.failed_deployment_count === 'number' ||
      typeof payload?.github_team_metrics?.total_prs === 'number' ||
      typeof payload?.github_team_metrics?.total_repositories === 'number'
    )
  }

  // 🔥 HELPER: Check if store already has meaningful data
  function hasMeaningfulExistingData(): boolean {
    return (
      isMeaningfulGitHubPayload(rawResponse.value) ||
      (metrics.value !== null && (metrics.value.pullRequests > 0 || metrics.value.repositories > 0))
    )
  }

  // 🔥 PHASE 1.0: GitHub snapshot preservation helpers
  function hasGitHubSnapshotKeys(payload: any): boolean {
    return !!(
      payload?.github_connected === true ||
      payload?.github_team_metrics ||
      payload?.team_metrics ||
      payload?.github_fetch_debug
    )
  }

  function hasExistingGitHubSnapshot(): boolean {
    return !!(
      rawResponse.value?.github_team_metrics ||
      rawResponse.value?.team_metrics ||
      rawResponse.value?.github_connected
    )
  }

  // Actions
  const fetchMetrics = async (range: string = 'all', options: { signal?: AbortSignal; source?: string; force?: boolean } = {}) => {
    log('🔥🔥🔥 [GITHUB STORE] fetchMetrics called with range:', range)
  
    // 🔥 PHASE 0 EVIDENCE: Function entry tracing
    log('[GH_FETCH_ENTRY]', {
      source: options.source || 'unknown',
      range,
      hadRawResponse: !!rawResponse.value,
      hadMetrics: !!metrics.value
    })
    
    const { signal, force } = options
    const source = options.source || 'unknown'
    
    // 🔥 MINIMAL CALLSITE TRACING: Log once per call
    log('[GITHUB_FETCH]', {
      source,
      range,
      hadRawResponse: !!rawResponse.value,
      hadMetrics: !!metrics.value
    });
    
    // 🔥 PHASE 0 EVIDENCE: DEV-only structured logging
    if ((import.meta as any).env?.DEV) {
      const caller = new Error().stack?.split('\n')[2]?.trim() || 'unknown'
      const rawData = rawResponse.value
      log('[GITHUB_FETCH_CALLSITE]', {
        route: window.location.pathname + window.location.search,
        caller: caller,
        component: 'githubStore.fetchMetrics',
        requested_time_filter: range,
        timestamp: Date.now(),
        store_state_before: {
          hasExistingData: !!rawData,
          github_connected: rawData?.github_connected,
          github_connection_reason: rawData?.github_connection_reason,
          total_prs: rawData?.team_metrics?.total_prs,
          failed_deployments: rawData?.deployment_metrics?.failed_deployment_count,
          has_all_prs_array: Array.isArray(rawData?.all_prs_truncated),
          all_prs_length: rawData?.all_prs_truncated?.length,
          has_deploy_array: Array.isArray(rawData?.deployments_truncated),
          deploy_length: rawData?.deployments_truncated?.length
        }
      });
    }
    
    // 🔥 PHASE 3+4: Cache hit fast path — check in-memory then sessionStorage
    const cachedResponse = rawResponseByRange.value[range] || loadLKG(range)
    if (cachedResponse && !force) {
      log(`[GH_FETCH] cache-hit source=${source} range=${range} - returning cached data instantly`)
      log(`[GH_FETCH] cached PI fields:`, {
        reviewer_load_concentration: cachedResponse?.reviewer_load_concentration,
        reopen_pressure_spike: cachedResponse?.reopen_pressure_spike
      })
      // Set rawResponse to cached data so components see it immediately
      rawResponse.value = cachedResponse
      if (isValidSnapshot(cachedResponse) && !connected.value) {
        connected.value = cachedResponse.github_connected ?? false
      }
      return cachedResponse
    }
    
    // 🔥 DEV-ONLY: Prevent multiple simultaneous calls
    const now = Date.now()
    if (isFetchingMetrics) {
      log(`[GH_FETCH] skipped-in-progress source=${source}`)
      return
    }
    if (now - lastFetchTime < MIN_FETCH_INTERVAL) {
      log(`[GH_FETCH] skipped-too-soon source=${source} elapsed=${now - lastFetchTime}ms`)
      return
    }

    isFetchingMetrics = true
    lastFetchTime = now
    log(`[GH_FETCH] start source=${source} range=${range}`)

    try {
      log('🔥🔥🔥 [GITHUB STORE] STARTING METRICS FETCH 🔥🔥🔥')
      log('🔄 Starting API call to fetch GitHub metrics...')
      log('Range:', range)
      log('API base URL:', api.defaults.baseURL)
      
      // Use the existing real GitHub OAuth integration endpoint
      // This endpoint fetches real data from GitHub API when OAuth is available
      // Always pass time_filter parameter, including 'all'
      // DEMO: Add cache bypass and demo parameters for fresh data
      const url = `${API_ENDPOINTS.METRICS}?time_filter=${range}&nocache=1&github_nocache=1&use_all_data=1` // DEMO: Force fresh data
      
      log('🔥🔥🔥 [GITHUB STORE] FULL URL:', url)
      log('Full URL being called:', url)
      log('📡 Making API call to:', url)
      log('⏱️ Starting timer...')
      const startTime = Date.now()
      
      const requestId = Math.random().toString(36).substr(2, 9)
      log(`🔗 Request ID: ${requestId}`)
      
      // FIX: Only pass signal if it's a valid AbortSignal instance
      // Axios checks for signal.addEventListener, so we must ensure it exists
      const requestConfig: any = {}
      if (signal && typeof signal === 'object' && typeof (signal as any).addEventListener === 'function') {
        requestConfig.signal = signal
      }
      
      // =====================================
      // PHASE 0: ADD TRACE HEADER TO API CALL
      // =====================================
      if (typeof window !== 'undefined' && (window as any).__CM_TRACE_ID) {
        requestConfig.headers = {
          ...(requestConfig.headers || {}),
          'X-CM-Trace': (window as any).__CM_TRACE_ID
        }
      }
      
      const response = await api.get(url, requestConfig)
      
      const endTime = Date.now()
      log(`✅ API call completed in ${endTime - startTime}ms`)
      log('🔥🔥🔥 [GITHUB STORE] RAW RESPONSE STATUS:', response.status)
      log('🔥🔥🔥 [GITHUB STORE] RAW RESPONSE DATA:', response.data)
      
      // DEBUG: Log PI-specific fields from fresh API response
      log('[GITHUB_STORE][FRESH_API_RESPONSE]', {
        reviewer_load_concentration: response.data?.reviewer_load_concentration,
        reopen_pressure_spike: response.data?.reopen_pressure_spike,
        hasPrReviewMetrics: !!response.data?.pr_review_metrics,
        hasPrAnalytics: !!response.data?.pr_analytics
      })
      
      // 🔥 PHASE 0 EVIDENCE: DEV-only response logging
      if ((import.meta as any).env?.DEV) {
        const payload = response.data
        log('[GITHUB_FETCH_RESPONSE]', {
          route: window.location.pathname + window.location.search,
          caller: new Error().stack?.split('\n')[2]?.trim() || 'unknown',
          requested_time_filter: range,
          response_status: response.status,
          response_duration_ms: endTime - startTime,
          payload_summary: {
            github_connected: payload?.github_connected,
            github_connection_reason: payload?.github_connection_reason,
            total_prs: payload?.team_metrics?.total_prs,
            failed_deployments: payload?.deployment_metrics?.failed_deployment_count,
            has_all_prs_array: Array.isArray(payload?.all_prs_truncated),
            all_prs_length: payload?.all_prs_truncated?.length,
            has_deploy_array: Array.isArray(payload?.deployments_truncated),
            deploy_length: payload?.deployments_truncated?.length
          },
          timestamp: Date.now()
        });
      }
      
      // 🔥 PHASE 0 EVIDENCE: HTTP response tracing
      log('[GH_FETCH_HTTP]', {
        source: options.source || 'unknown',
        range,
        status: response.status,
        contentType: response.headers?.['content-type'],
        responseBytes: JSON.stringify(response.data || {}).length,
        topKeys: response.data ? Object.keys(response.data).slice(0,20) : null,
        hasGithubTeamMetrics: !!response.data?.github_team_metrics,
        totalPRs: response.data?.github_team_metrics?.total_prs,
        hasDeploymentMetrics: !!response.data?.deployment_metrics,
        failedDeployments: response.data?.deployment_metrics?.failed_deployment_count,
        serverStamp: response.data?.server_stamp
      })
      
      // 🔥 PHASE 1.1A: Detailed HTTP OK logging
      if (response.status === 200) {
        log('[GH_FETCH_HTTP_OK]', {
          source: options.source || 'unknown',
          range,
          status: response.status,
          time_filter: response.data?.time_filter,
          hasGithubTeamMetrics: !!response.data?.github_team_metrics,
          githubTeamMetrics_total_prs: response.data?.github_team_metrics?.total_prs,
          hasDeploymentMetrics: !!response.data?.deployment_metrics,
          deploymentMetrics_failed_deployment_count: response.data?.deployment_metrics?.failed_deployment_count,
          github_connected: response.data?.github_connected,
          responseSize: JSON.stringify(response.data || {}).length
        });
      }
      
      if (response.status === 200) {
        log('🔥🔥🔥 [GITHUB STORE] RESPONSE RECEIVED 🔥🔥🔥')
        log('🔥🔥🔥 [GITHUB STORE] SERVER STAMP:', response.data?.server_stamp)
        log('🔥🔥🔥 [GITHUB STORE] DB INFO:', {
          connection: response.data?.db_connection,
          database: response.data?.db_database
        })
        log('📊 Response received:', response.data)
        const realData = response.data

        // 🔥 GUARD: Check if response contains meaningful data
        const meaningful = isMeaningfulGitHubPayload(realData)
        const hadMeaningful = hasMeaningfulExistingData()

        // If response is NOT meaningful AND we already had meaningful data, preserve existing data
        if (!meaningful && hadMeaningful) {
          console.warn('[GITHUB STORE] Response not meaningful, preserving existing data:', { 
            responseKeys: Object.keys(realData || {}),
            hadMeaningful 
          })
          error.value = 'GitHub metrics temporarily unavailable — showing last known data'
          // Still update cache and metrics to ensure consistency
          rawResponseByRange.value[range] = rawResponse.value
          lastFetchTimeByRange.value[range] = Date.now()
          return rawResponse.value
        }

        // Backend provides explicit connectivity so UI can avoid claiming "Real GitHub" on DB-only zeros.
        connected.value = !!realData?.github_connected
        connectionReason.value = (realData?.github_connection_reason ?? null) as any
        
        log('🔍 GitHub connection info from API:', {
          github_connected: realData?.github_connected,
          github_connection_reason: realData?.github_connection_reason,
          connected_after_override: connected.value,
          connection_reason_after: connectionReason.value
        })
        
        // githubConnected is true ONLY when the API explicitly says github_connected === true.
        // A raw response object with zero PRs/repos is not connection evidence.
        
        // ============================================================================
        // MAPPING TABLE: API Response → GitHub Store → EngOutput Display
        // ============================================================================
        // FIELD MAPPING (✅ = Available, ❌ = Not in API):
        //
        // pullRequests        ← total_pull_requests                   → ✅ PR cards
        // mergedPRs           ← merged_pull_requests                  → ✅ Merged PR card
        // mergeRate           ← merge_rate                            → ✅ Merge rate card
        // repositories        ← total_repositories                    → ✅ Repo count card
        // contributors        ← team_metrics.unique_developers        → ✅ Contributors card
        // openIssues          ← open_issues_total                     → ✅ Issues card
        // leadTime            ← team_metrics.time_to_merge            → ✅ Lead time card
        // codeReviewTime      ← team_metrics.time_to_first_review     → ✅ Review time card
        // reopenedPRs         ← team_metrics.reopened_prs             → ✅ Insights
        // rejectedPRs         ← team_metrics.rejected_prs             → ✅ Change failure rate
        // commentToMergeRatio ← team_metrics.comment_to_merge_ratio   → ✅ Insights
        //
        // REMOVED FIELDS (Backend doesn't provide these):
        // commits             ← ❌ github_team_metrics.total_commits  → NEVER POPULATED
        // totalCommits        ← ❌ github_team_metrics.total_commits  → NEVER POPULATED
        // issues              ← ❌ github_team_metrics.total_issues   → NEVER POPULATED (using open_issues_total instead)
        // totalIssues         ← ❌ github_team_metrics.total_issues   → NEVER POPULATED (using open_issues_total instead)
        // uniqueContributors  ← ❌ github_team_metrics.unique_contributors → FIELD NAME MISMATCH (using unique_developers)
        // commitsPerDay       ← ❌ github_team_metrics.commits_per_day → NEVER POPULATED
        // issuesPerDay        ← ❌ github_team_metrics.issues_per_day → NEVER POPULATED
        // ============================================================================
        
        // Transform the real GitHub data to match our interface
        // ONLY use fields that actually exist in the API response
        const transformedMetrics: GitHubMetrics = {
          // ===== PR Metrics (✅ Available) =====
          pullRequests: realData.github_team_metrics?.total_prs || 0,
          mergedPRs: realData.github_team_metrics?.merged_prs || 0,
          mergeRate: realData.github_team_metrics?.merge_rate || 0,
          prsPerDeveloper: realData.github_team_metrics?.unique_developers > 0 
            ? Math.round((realData.github_team_metrics?.total_prs || 0) / realData.github_team_metrics?.unique_developers)
            : (realData.github_team_metrics?.total_prs || 0), // If no developers, assume 1 developer
          
          // ===== Repository Metrics (✅ Available) =====
          repositories: realData.github_team_metrics?.total_repositories || 0,
          
          // ===== Contributor Metrics (✅ Available from PRs + Commits) =====
          contributors: realData.github_team_metrics?.unique_developers || 0,
          // uniqueContributors: Prefer unique_contributors (from PRs + commits), fallback to unique_developers (PRs only)
          uniqueContributors: realData.github_team_metrics?.unique_contributors 
            ?? realData.github_team_metrics?.unique_developers 
            ?? 0,
          
          // ===== Timing Metrics (✅ Available) =====
          codeReviewTime: realData.pr_review_cycles || 0,
          leadTime: realData.github_team_metrics?.time_to_merge || 0,
          
          // ===== Quality Metrics (✅ Available) =====
          reopenedPRs: realData.pr_review_metrics?.pr_reopened_count || 0,
          rejectedPRs: realData.github_team_metrics?.rejected_prs || 0,
          commentToMergeRatio: realData.github_team_metrics?.comment_to_merge_ratio || 0,
          changeFailureRate: realData.change_failure_rate || 0,
          
          // ===== Issues Metrics (✅ Now includes total issues) =====
          // openIssues: Shows current open issues count
          openIssues: realData.github_team_metrics?.open_issues_total ?? 0,
          // issues: Total issues (open + closed) from GitHub API
          issues: realData.github_team_metrics?.total_issues ?? 0,
          // totalIssues: Same as issues (total all-time issues)
          totalIssues: realData.github_team_metrics?.total_issues ?? 0,
          // issuesPerDay: Rate of issue creation
          issuesPerDay: realData.github_team_metrics?.issues_per_day ?? 0,
          
          // ===== Commits Metrics (✅ Now available from GitHub API) =====
          // Backend now calls /repos/{owner}/{repo}/commits endpoint
          commits: realData.github_team_metrics?.total_commits ?? 0,
          totalCommits: realData.github_team_metrics?.total_commits ?? 0,
          commitsPerDay: realData.github_team_metrics?.commits_per_day ?? 0,
          
          // ===== Simulated Metrics (⚠️ Not from GitHub API) =====
          deploymentFrequency: realData.stale_deployment_signal ?? Math.round((realData.github_team_metrics?.total_prs || 0) * 0.4), // Use real deployments if available, otherwise simulated
          meanTimeToRecovery: realData.mttr_hours ?? realData.github_team_metrics?.time_to_merge ?? 2, // Use real MTTR if available, otherwise fallback
        }
        
        log('🔄 Transforming metrics:', transformedMetrics)
        log('📊 Fields populated from API:', {
          pullRequests: transformedMetrics.pullRequests,
          mergedPRs: transformedMetrics.mergedPRs,
          repositories: transformedMetrics.repositories,
          contributors: transformedMetrics.contributors,
          openIssues: transformedMetrics.openIssues,
          leadTime: transformedMetrics.leadTime,
          commits: transformedMetrics.commits,
          totalCommits: transformedMetrics.totalCommits,
          deploymentFrequency: transformedMetrics.deploymentFrequency,
          meanTimeToRecovery: transformedMetrics.meanTimeToRecovery,
        })
        log('🔍 Raw API fields for DORA:', {
          deployments: realData.deployments,
          mttr_hours: realData.mttr_hours,
          total_pull_requests: realData.github_team_metrics?.total_prs,
        })
        
        // 🔥 PHASE 1.0: GitHub snapshot preservation guard
        const shouldPreserve = (realData.timeout === true || !hasGitHubSnapshotKeys(realData)) && hasExistingGitHubSnapshot()
        
        // 🔥 PHASE 3: Check if we have range-specific cache to preserve
        const rangeCachedResponse = rawResponseByRange.value[range]
        if (shouldPreserve && rangeCachedResponse) {
          log(`[GH_FETCH] preserve-range-cache source=${source} range=${range} - using cached response for this range`)
          rawResponse.value = rangeCachedResponse
          // Ensure cache timestamps are updated
          lastFetchTimeByRange.value[range] = Date.now()
          return rangeCachedResponse
        }
        
        // 🔥 PHASE 1.0: Verification log
        log('[GH_SNAPSHOT_DECISION]', { 
          action: shouldPreserve ? 'preserve' : 'overwrite', 
          range, 
          source: options.source || 'unknown',
          timeout: realData?.timeout, 
          hasGitHubKeys: hasGitHubSnapshotKeys(realData), 
          hadExisting: hasExistingGitHubSnapshot() 
        })
        
        if (shouldPreserve) {
          console.warn('[GITHUB_STORE] preserving last-known-good GitHub snapshot; new response missing GitHub keys', { 
            timeout: realData.timeout, 
            keys: Object.keys(realData || {}) 
          })
          // DO NOT overwrite - preserve existing data
          // But ensure cache consistency
          rawResponseByRange.value[range] = rawResponse.value
          lastFetchTimeByRange.value[range] = Date.now()
          return rawResponse.value
        }
        
        // 🔥 PHASE 4: Overwrite guard — only accept valid snapshots
        if (!isValidSnapshot(realData) && isValidSnapshot(rawResponse.value)) {
          console.warn('[GH_FETCH] Rejected invalid snapshot — preserving LKG', {
            newKeys: Object.keys(realData || {}),
            existingKeys: Object.keys(rawResponse.value || {}).slice(0, 10)
          })
          rawResponseByRange.value[range] = rawResponse.value
          lastFetchTimeByRange.value[range] = Date.now()
          return rawResponse.value
        }

        metrics.value = transformedMetrics
        rawResponse.value = realData  // Store raw response for snapshot data (open_issues_by_repo, etc.)
        // FIX: Populate metrics from rawResponse for Performance Insights
        metrics.value = realData
        error.value = null  // ✅ ensure any previous timeout message is cleared
        
        // DEBUG: Log PI-specific fields
        log('[GITHUB_STORE][PI_FIELDS]', {
          reviewer_load_concentration: realData?.reviewer_load_concentration,
          reopen_pressure_spike: realData?.reopen_pressure_spike,
          pr_review_metrics: realData?.pr_review_metrics,
          pr_analytics: realData?.pr_analytics,
          deployment_metrics: realData?.deployment_metrics
        });

        // 🔥 PHASE 3: Store successful response in per-range cache
        rawResponseByRange.value[range] = realData
        lastFetchTimeByRange.value[range] = Date.now()
        log(`[GH_FETCH] cache-store source=${source} range=${range} - cached response for instant reuse`)

        // 🔥 PHASE 4: Persist to sessionStorage as LKG
        if (isValidSnapshot(realData)) {
          persistLKG(range, realData)
        }

        // 🔥 PHASE 1.1A: Assignment logging
        log('[GH_ASSIGN]', {
          source: options.source || 'unknown',
          range,
          assignedRawResponseKeys: Object.keys(realData || {}).slice(0, 20),
          assignedGithubTeamMetrics_total_prs: realData?.github_team_metrics?.total_prs,
          assignedDeploymentMetrics_failed_deployment_count: realData?.deployment_metrics?.failed_deployment_count,
          assignedGithub_connected: realData?.github_connected,
          metricsAssigned: !!metrics.value,
          rawResponseAssigned: !!rawResponse.value
        });

        log('??[GITHUB STORE] Data stored successfully:', {
          connected: connected.value,
          hasRawResponse: !!rawResponse.value,
          rawResponseKeys: rawResponse.value ? Object.keys(rawResponse.value).slice(0, 10) : [],
          githubTeamMetricsKeys: rawResponse.value?.github_team_metrics ? Object.keys(rawResponse.value.github_team_metrics) : []
        })
        
        // NEW: Log PR counts for Performance Insights debugging
        const prAnalyticsTotalPrs = realData?.pr_analytics?.total_prs || 0
        const prReviewMetricsTotalPrs = realData?.pr_review_metrics?.total_prs || 0
        log('??[GITHUB STORE] PR COUNTS FOR PI:', {
          'pr_analytics.total_prs': prAnalyticsTotalPrs,
          'pr_review_metrics.total_prs': prReviewMetricsTotalPrs,
          'hasAnyPrData': prAnalyticsTotalPrs > 0 || prReviewMetricsTotalPrs > 0,
          'time_filter': range,
          'source': options.source || 'unknown'
        })

        // Return realData (not transformedMetrics) so Dashboards.vue can access
        // the nested structures: github_team_metrics, pr_review_metrics, deployment_metrics
        log(`[GH_FETCH] success source=${options.source || 'unknown'} total_prs=${realData?.github_team_metrics?.total_prs || 0}`)
        return realData
      } else {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
    } catch (err: any) {
      // 🔥 PHASE 0 EVIDENCE: Error tracing (before any state mutation)
      log('[GH_FETCH_ERROR]', {
        source: options.source || 'unknown',
        range,
        name: err?.name,
        code: err?.code,
        message: err?.message
      })
      
      // 🔥 PHASE 1.1A: Detailed catch logging
      log('[GH_FETCH_CATCH]', {
        source: options.source || 'unknown',
        range,
        errorName: err?.name,
        errorCode: err?.code,
        errorMessage: err?.message,
        isCanceled: err.name === 'CanceledError' || err.name === 'AbortError' || err.code === 'ERR_CANCELED' || err.code === 'ECONNABORTED' || err.message?.includes('canceled'),
        isTimeout: err?.message?.includes('timeout') || err?.code === 'ECONNABORTED',
        stackTrace: err?.stack?.split('\n')[0] // First line only
      });
      
      // Suppress CanceledError/AbortError - these are expected when request is aborted
      const isCanceled = err.name === 'CanceledError' || 
                        err.name === 'AbortError' || 
                        err.code === 'ERR_CANCELED' ||
                        err.code === 'ECONNABORTED' ||
                        err.message?.includes('canceled')
      
      if (isCanceled) {
        // Request was intentionally aborted - don't log as error
        loading.value = false
        return null // Return null instead of throwing
      }
      
      logError('❌ Failed to fetch GitHub metrics:', err)
      
      // More detailed error logging (only for real errors)
      if (err instanceof Error) {
        logError('Error name:', err.name)
        logError('Error message:', err.message)
        logError('Error stack:', err.stack)
        
        // Check for timeout (both message and code)
        const isTimeout = err.message?.includes('timeout') || 
                          (err as any).code === 'ECONNABORTED' ||
                          err.name === 'AxiosError' && err.message?.includes('exceeded')
        
        if (isTimeout) {
          error.value = 'Request timed out after 60 seconds - using cached data if available'
          // If we have cached data, keep using it instead of clearing it
          if (metrics.value && Object.keys(metrics.value).length > 0) {
            logError('🔄 [GITHUB] Timeout but using cached data:', metrics.value)
            loading.value = false
            return metrics.value
          }
        } else if (err.message?.includes('Network Error')) {
          error.value = 'Network error - cannot connect to backend server'
        } else if (err.message?.includes('CORS')) {
          error.value = 'CORS error - cross-origin request blocked'
        } else {
          error.value = `Failed to fetch GitHub metrics: ${err.message || 'Unknown error'}`
        }
      } else {
        error.value = 'Unknown error occurred while fetching metrics'
      }
      
      // 🔥 GUARD: Preserve existing data on transient failures
      const hadMeaningful = hasMeaningfulExistingData()
      
      if (hadMeaningful) {
        console.warn('[GITHUB STORE] Error occurred but preserving existing meaningful data:', {
          error: err.message || 'Unknown error',
          hadMeaningful
        })
        error.value = `GitHub metrics temporarily unavailable (${err.message || 'network error'}) — showing last known data`
        return rawResponse.value
      }
      
      // Never wipe store state on error — preserve last-known-good data.
      // Setting metrics/rawResponse to null here previously caused PI "insufficient signal"
      // cascades when GitHub was transiently unavailable on page load.
      console.warn('[GITHUB STORE] Error occurred with no prior meaningful data — preserving empty state (not wiping):', {
        error: err.message || 'Unknown error',
        hadMeaningful
      })
      error.value = `GitHub metrics unavailable: ${err.message || 'network error'}`
      return null
    } finally {
      // 🔥 PHASE 1.1A: Finally logging
      log('[GH_FETCH_FINALLY]', {
        source: options.source || 'unknown',
        range,
        finalHasRawResponse: !!rawResponse.value,
        finalHasMetrics: !!metrics.value,
        finalLoading: loading.value,
        finalIsFetching: isFetchingMetrics
      });
      
      // 🔥 DEV-ONLY: Reset fetching flag
      isFetchingMetrics = false
      loading.value = false
    }
  }

  const clearError = () => {
    error.value = null
  }

  // Fetch repositories from GitHub (non-critical, won't block dashboard)
  const fetchRepositories = async () => {
    try {
      log('🔄 Fetching repositories from GitHub...')
      log('📡 API base URL:', api.defaults.baseURL)
      log('🔗 Endpoint: API_ENDPOINTS.REPOSITORIES?oauth=true')
      
      // Use a shorter timeout for repositories (non-critical)
      const response = await api.get(`${API_ENDPOINTS.REPOSITORIES}?oauth=true`, { timeout: 10000 }) // 10 seconds
      
      if (response.status === 200) {
        log('📁 Repositories received:', response.data)
        
        // Handle different response formats
        let repos: GitHubRepository[] = []
        
        if (response.data.repositories && Array.isArray(response.data.repositories)) {
          // Format: {"repositories": ["owner/repo-name", "owner/repo-name2"]}
          repos = response.data.repositories.map((repoString: string, index: number) => {
            const [owner, name] = repoString.split('/')
            return {
              id: index + 1,
              name: name,
              full_name: repoString,
              description: null,
              private: false, // Assume public for now
              fork: false,    // Assume not fork for now
              stargazers_count: 0,
              language: null, // Will need separate API call to get language
              updated_at: new Date().toISOString()
            }
          })
        } else if (Array.isArray(response.data)) {
          // Format: ["owner/repo-name", "owner/repo-name2"]
          repos = response.data.map((repoString: string, index: number) => {
            const [owner, name] = repoString.split('/')
            return {
              id: index + 1,
              name: name,
              full_name: repoString,
              description: null,
              private: false,
              fork: false,
              stargazers_count: 0,
              language: null,
              updated_at: new Date().toISOString()
            }
          })
        }
        
        log('📁 Processed repositories:', repos)
        repositories.value = repos
        log('📁 Final repositories state:', repositories.value)
        return repos
      } else {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
    } catch (err: any) {
      // Check for timeout specifically - don't log as error, just warn
      const isTimeout = err?.message?.includes('timeout') || 
                        err?.code === 'ECONNABORTED'
      
      if (isTimeout) {
        log('⏰ Repository fetch timed out (non-critical), continuing without repository list')
        repositories.value = [] // Set to empty array instead of throwing
        return [] // Return empty array so dashboard can continue
      }
      
      logError('❌ Failed to fetch repositories:', err)
      
      // For development/testing only, return mock repositories when endpoint doesn't exist
      if (import.meta.env.DEV && err instanceof Error && (err.message.includes('404') || err.message.includes('Network Error'))) {
        log('🔄 Using mock repositories due to API error:', err.message)
        const mockRepositories: GitHubRepository[] = [
          {
            id: 1,
            name: 'ChaosMonkey.dev',
            full_name: 'example-org/chaosmonkey-dev',
            description: 'Chaos Monkey Development',
            private: false,
            fork: false,
            stargazers_count: 0,
            language: 'Vue',
            updated_at: new Date().toISOString()
          },
          {
            id: 2,
            name: 'fake-codesight-repo',
            full_name: 'example-org/sample-repo',
            description: 'Fake CodeSight Repository',
            private: false,
            fork: false,
            stargazers_count: 0,
            language: 'JavaScript',
            updated_at: new Date().toISOString()
          },
          {
            id: 3,
            name: 'jediraptor',
            full_name: 'example-org/jediraptor',
            description: 'Jedi Raptor Project',
            private: false,
            fork: false,
            stargazers_count: 0,
            language: 'Python',
            updated_at: new Date().toISOString()
          }
        ]
        log('📁 Setting mock repositories:', mockRepositories)
        repositories.value = mockRepositories
        log('📁 Final mock repositories state:', repositories.value)
        return mockRepositories
      }
      
      // Return empty array on error
      log('📁 Setting empty repositories array due to error')
      repositories.value = []
      return []
    }
  }

  return {
    // State
    metrics,
    repositories,
    loading,
    error,
    rawResponse,
    connected,
    connectionReason,
    isFetchingMetrics, // 🔥 PHASE 1.1A: Expose fetching flag for EngOutput guard
    
    // 🔥 PHASE 3: Cache state for debugging
    rawResponseByRange,
    lastFetchTimeByRange,
    
    // Actions
    fetchMetrics,
    fetchRepositories,
    clearError
  }
})
