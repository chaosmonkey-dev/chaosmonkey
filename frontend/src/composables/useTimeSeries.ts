import { ref, computed, watch, nextTick, toRef, type ComputedRef, type Ref } from 'vue'
import type { ProductivityQuery, TimeSeries, DataSource } from '../types/metrics'
import { getProductivityTimeSeries, fetchDeliveryTimeSeries, buildDeliverySeries, type DeliveryTimeSeriesRow, type DeliveryAttributionAuthority } from '../services/metricsFacade'
import { useMetricsFacadeStore } from '../stores/metricsFacade'
import { log, warn, error as logError } from '../utils/logger'

// 🔥 P1: Gate noisy PBT logs behind debug flag
const PBT_DEBUG = (import.meta.env.VITE_PBT_DEBUG ?? 'false') === 'true'

/**
 * Composable for managing time series data with debouncing and request cancellation
 * @param queryRef - Computed reference to productivity query parameters
 * @returns Reactive time series data with loading states and error handling
 */
export function useTimeSeries(queryRef: ComputedRef<ProductivityQuery>, enabled: Ref<boolean> = ref(true)) {
  const metricsFacadeStore = useMetricsFacadeStore()
  // State with strict typing
  const data = ref<TimeSeries | null>(null)
  const dataSource = ref<DataSource | null>(null)
  const isLoading = ref<boolean>(false)
  const error = ref<string | null>(null)
  const latestObservedAt = ref<string | null>(null)
  const canonicalMetadata = ref<Record<string, any> | null>(null)
  // CR-X R2: Delivery series is kept separate from workflow series.
  // Org-level delivery data must NOT be duplicated into per-workflow series.
  const deliverySeries = ref<TimeSeries[number] | null>(null)
  const deliveryAttributionAuthority = ref<DeliveryAttributionAuthority>('org')
  // CR-X C: Delivery provenance — 'cm_activity_sim' = Local demo, 'live' = real GitHub, 'error' = fetch failed
  const deliverySource = ref<string>('unknown')
  // CR-X PBT-CLEANUP-4: Explicit delivery error state — ERROR != EMPTY != LOADING.
  // When delivery fetch fails, this is set to an error message. When it succeeds
  // (even with zero rows), this is cleared. The component uses this to render
  // an explicit "delivery unavailable" state instead of a false empty/zero.
  const deliveryError = ref<string | null>(null)
  
  // Request management
  let currentRequestId = 0
  let debounceTimeout: ReturnType<typeof setTimeout> | null = null
  
  // Runtime guard: validate query parameters
  const isValidQuery = (query: ProductivityQuery): boolean => {
    if (!query || typeof query !== 'object') {
      // PBT_QUERY_INVALID removed to reduce console spam 'Query is not an object', query)
      return false
    }
    
    const { from, to, repos, scope, viewBucket } = query
    
    // 🔥 FIX: Allow empty strings for from/to (All Time)
    // Empty strings are valid for All Time queries and will be converted to ALL_TIME_START by telemetryToUnified
    if (from === undefined || from === null || to === undefined || to === null) {
      // PBT_QUERY_INVALID removed to reduce console spam 'from/to are undefined or null', { from, to })
      return false
    }
    
    if (!Array.isArray(repos) || !scope || !viewBucket) {
      // PBT_QUERY_INVALID removed to reduce console spam 'Missing required fields', { repos, scope, viewBucket })
      return false
    }
    
    // Validate date strings only if not empty (empty = All Time)
    if (from !== '' && to !== '') {
      const fromDate = new Date(from)
      const toDate = new Date(to)
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        // PBT_QUERY_INVALID removed to reduce console spam 'Invalid date strings', { from, to })
        return false
      }
    }
    
    // Validate scope
    if (!['org', 'team', 'dev'].includes(scope)) {
      // PBT_QUERY_INVALID removed to reduce console spam 'Invalid scope', scope)
      return false
    }
    
    // Validate view bucket
    if (!['daily', 'weekly', 'monthly'].includes(viewBucket)) {
      // PBT_QUERY_INVALID removed to reduce console spam 'Invalid viewBucket', viewBucket)
      return false
    }
    
    // PBT_QUERY_VALID removed to reduce console spam
    return true
  }
  
  /**
   * Fetch time series data with request cancellation
   * @param query - Productivity query parameters
   * @param requestId - Unique request identifier for cancellation
   * @returns Promise with time series result
   */
  const fetchTimeSeries = async (query: ProductivityQuery, requestId: number): Promise<void> => {
    try {
      // Runtime guard: validate query before API call
      if (!isValidQuery(query)) {
        throw new Error('Invalid query parameters')
      }
      
      // Check if this request is still current
      if (requestId !== currentRequestId) {
        log('🔄 Request superseded, aborting:', requestId)
        return
      }
      
      // Set loading state
      // CR-X PI/PBT-TIME P0: Clear prior data immediately when a new request
      // starts. During a scope transition, the chart must NOT display old
      // data under the new scope label. Setting data.value = null forces the
      // component to render an explicit loading state instead of stale data.
      isLoading.value = true
      data.value = null
      error.value = null
      
      if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] useTimeSeries FETCH_START', { requestId, from: query.from, to: query.to, viewBucket: query.viewBucket, toolIds: query.toolIds })
      
      log('🔄 Fetching time series for query:', {
        from: query.from,
        to: query.to,
        scope: query.scope,
        viewBucket: query.viewBucket,
        reposCount: query.repos.length,
        requestId
      })
      
      // Fetch data from service
      const result = await getProductivityTimeSeries(query)
      
      // Check if request is still current
      if (requestId !== currentRequestId) {
        log('🔄 Request superseded after fetch, discarding result:', requestId)
        return
      }
      
      // CR-X R2: Fetch delivery time series as a SEPARATE series.
      // Delivery data is org-level (or repo-level) — NOT per-workflow.
      // We do NOT merge it into per-workflow series to avoid implying
      // workflow delivery attribution that does not exist.
      //
      // CR-X PBT-CLEANUP-4: ERROR != EMPTY != LOADING.
      // fetchDeliveryTimeSeries now THROWS on HTTP failure or network
      // rejection. A successful 200 with zero rows returns normally.
      // On error: preserve prior good delivery data (if any) and set
      // deliveryError so the component can render an explicit unavailable
      // state instead of a false empty/zero.
      //
      // K1B COHORT: Delivery evidence is org/repo-scoped — it cannot resolve
      // developer cohort attribution. When a cohort filter is active we skip
      // the delivery fetch entirely so org-wide delivery numbers can never
      // render under a cohort label.
      const cohortActive = !!query.cohortId && query.cohortId !== 'all' && query.cohortId !== ''
      try {
        if (cohortActive) {
          deliverySeries.value = null
          deliverySource.value = 'unavailable'
          deliveryError.value = 'Delivery metrics are organization-scoped and are not available for cohort filters'
        } else {
        const deliveryResult = await fetchDeliveryTimeSeries(
          query.from || undefined,
          query.to || undefined,
          query.repos?.length === 1 ? query.repos[0] : undefined
        )
        // CR-X PI/PBT-TIME P0: Re-check guard after async delivery fetch.
        // An older request must NOT overwrite delivery state if a newer
        // request has already started.
        if (requestId !== currentRequestId) {
          log('🔄 Request superseded after delivery fetch, discarding:', requestId)
          return
        }
        // Success — clear error, update provenance
        deliveryError.value = null
        const authority = deliveryResult.meta?.attribution_authority ?? 'org'
        deliveryAttributionAuthority.value = authority
        deliverySource.value = deliveryResult.meta?.source ?? 'unknown'
        if (deliveryResult.series.length > 0) {
          const singleSeries = buildDeliverySeries(
            deliveryResult.series,
            authority,
            deliveryResult.meta?.repo ?? null
          )
          deliverySeries.value = singleSeries
          if (PBT_DEBUG) console.info('[useTimeSeries] Delivery series built (standalone):', {
            deliveryWeeks: deliveryResult.series.length,
            source: deliveryResult.meta.source,
            attributionAuthority: authority,
            label: singleSeries?.label,
          })
        } else {
          // Authoritative empty — genuine zero observations
          deliverySeries.value = null
        }
        }
      } catch (deliveryErr) {
        // CR-X PBT-CLEANUP-4: Delivery fetch failed.
        // Do NOT clear deliverySeries — preserve prior good data if it exists.
        // Set deliveryError so the component can show an explicit unavailable state.
        // CR-X PI/PBT-TIME P0: Re-check guard — don't apply error state from old request.
        if (requestId !== currentRequestId) {
          log('🔄 Request superseded after delivery error, discarding:', requestId)
          return
        }
        const msg = deliveryErr instanceof Error ? deliveryErr.message : 'Delivery fetch failed'
        deliveryError.value = msg
        deliverySource.value = 'error'
        if (PBT_DEBUG) console.warn('[useTimeSeries] Delivery fetch failed (preserving prior data):', deliveryErr)
      }

      // CR-X PI/PBT-TIME P0: Final guard before chart state application.
      // This is the critical point — an old request must NEVER overwrite
      // chart data after a newer request has started.
      if (requestId !== currentRequestId) {
        log('🔄 Request superseded before state application, discarding:', requestId)
        return
      }

      // Update state with new data
      data.value = result.series
      dataSource.value = result.dataSource
      latestObservedAt.value = result.latest_observed_at ?? null
      canonicalMetadata.value = result.metadata ?? null
      
      if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] useTimeSeries FETCH_SUCCESS', { requestId, seriesCount: result.series.length, dataSource: result.dataSource, totalPoints: result.series.reduce((sum: number, s: any) => sum + (s.points?.length || 0), 0) })
      
      if (PBT_DEBUG) console.info('[useTimeSeries] TIME SERIES FETCHED SUCCESSFULLY:', {
        dataPoints: result.series.length,
        dataSource: result.dataSource,
        requestId,
        seriesLabels: result.series.map(s => s.label),
        totalPoints: result.series.reduce((sum, s) => sum + (s.points?.length || 0), 0)
      })

      // 🔥 DATA RECONCILIATION AUDIT: Log useTimeSeries output
      if (PBT_DEBUG) console.log('[AUDIT:USE_TIME_SERIES_OUTPUT]', {
        dataPoints: result.series.length,
        dataSource: result.dataSource,
        seriesLabels: result.series.map(s => s.label),
        telemetryPointCounts: result.series.map(s => ({ tool: s.label, telemetryPointCount: s.telemetryPointCount, totalPointCount: s.totalPointCount, sessionCount: s.sessionCount })),
        sampleSeries: result.series.slice(0, 3)
      })

      // Write to console for programmatic inspection
      try {
        const debugData = {
          stage: 'useTimeSeries-output',
          timestamp: new Date().toISOString(),
          output: {
            dataPoints: result.series.length,
            dataSource: result.dataSource,
            seriesLabels: result.series.map(s => s.label),
            totalPoints: result.series.reduce((sum, s) => sum + (s.points?.length || 0), 0)
          }
        }
        if (PBT_DEBUG) console.log('[PIPELINE-LOG]', JSON.stringify(debugData))
      } catch (e) {
        // Ignore logging errors
      }
      
      log('✅ Time series fetched successfully:', {
        dataPoints: result.series.length,
        dataSource: result.dataSource,
        requestId
      })
      
    } catch (err) {
      // Check if request is still current
      if (requestId !== currentRequestId) {
        log('🔄 Request superseded after error, ignoring:', requestId)
        return
      }
      
      // Handle error but do NOT preserve existing data.
      // CR-X PI/PBT-TIME P0: A timeout/error must show a truthful unavailable
      // state. It must NOT silently cache an empty result as if the scoped
      // population is genuinely zero, and it must NOT keep stale prior-scope
      // data visible under the new scope label.
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      error.value = errorMessage
      data.value = null
      
      if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] useTimeSeries FETCH_ERROR', { requestId, error: errorMessage })
      
      logError('❌ Failed to fetch time series:', {
        error: errorMessage,
        requestId,
        query: queryRef.value
      })
      
    } finally {
      // Only update loading state if this is still the current request
      if (requestId === currentRequestId) {
        isLoading.value = false
      }
    }
  }
  
  /**
   * Debounced refresh function
   * @returns Promise that resolves when refresh completes
   */
  const refresh = async (): Promise<void> => {
    // Clear existing debounce timeout
    if (debounceTimeout) {
      clearTimeout(debounceTimeout)
    }
    
    // Increment request ID to cancel previous requests
    currentRequestId++
    const requestId = currentRequestId
    
    // Debounce the request by 350ms
    return new Promise((resolve) => {
      debounceTimeout = setTimeout(async () => {
        await fetchTimeSeries(queryRef.value, requestId)
        resolve()
      }, 350)
    })
  }
  
  /**
   * Immediate refresh without debouncing
   * @returns Promise that resolves when refresh completes
   */
  const refreshImmediate = async (): Promise<void> => {
    // Clear any pending debounced request
    if (debounceTimeout) {
      clearTimeout(debounceTimeout)
      debounceTimeout = null
    }
    
    // Increment request ID and fetch immediately
    currentRequestId++
    const requestId = currentRequestId
    
    await fetchTimeSeries(queryRef.value, requestId)
  }
  
  /**
   * Clear all data and reset state
   */
  const clear = (): void => {
    data.value = null
    dataSource.value = null
    error.value = null
    isLoading.value = false
    deliveryError.value = null

    // Cancel any pending requests
    currentRequestId++
    if (debounceTimeout) {
      clearTimeout(debounceTimeout)
      debounceTimeout = null
    }
  }
  
  // Watch for query changes with debouncing
  watch(
    queryRef,
    (newQuery, oldQuery) => {
      // CR-X P0: Never fetch PBT telemetry while the tab/component is inactive.
      // Inactive ProductivityByToolV3 instances can still react to shared
      // filter state changes (KeepAlive / hidden tab); this guard keeps them
      // from competing with PI on the single-process Local backend.
      if (!enabled.value) {
        return
      }

      // Skip if query hasn't actually changed
      if (JSON.stringify(newQuery) === JSON.stringify(oldQuery)) {
        return
      }
      
      // Runtime guard: validate new query
      if (!isValidQuery(newQuery)) {
        warn('Invalid query detected, skipping fetch:', newQuery)
        return
      }
      
      log('🔄 Query changed, triggering debounced refresh')
      // CR-X PI/PBT-TIME P0: Clear prior data immediately when the query
      // changes. The chart must NOT display old-scope data under the new
      // scope label during the debounce window. Set loading so the UI can
      // render an explicit loading state instead of stale data.
      data.value = null
      isLoading.value = true
      error.value = null
      refresh()
    },
    { 
      deep: true, // Watch nested properties
      immediate: false // Don't trigger on mount
    }
  )

  watch(
    () => metricsFacadeStore.telemetryModeVersion,
    () => {
      if (!enabled.value) return
      log('🔄 Telemetry mode changed, refreshing time series immediately')
      refreshImmediate()
    }
  )

  // CR-X P0: when the component becomes active, fetch the latest query once.
  watch(enabled, (isEnabled, wasEnabled) => {
    if (isEnabled && wasEnabled === false && isValidQuery(queryRef.value)) {
      log('🚀 PBT became active — fetching latest time series')
      refreshImmediate()
    }
  })
  
  // Initial data fetch on mount (immediate, no debounce for faster perceived performance)
  nextTick(() => {
    if (enabled.value && isValidQuery(queryRef.value)) {
      log('🚀 Initial data fetch on mount')
      // Use immediate fetch for initial load to avoid 350ms debounce delay
      currentRequestId++
      const requestId = currentRequestId
      fetchTimeSeries(queryRef.value, requestId)
    }
  })
  
  // Computed properties for derived state
  const hasData = computed(() => data.value !== null && data.value.length > 0)
  const isEmpty = computed(() => data.value === null || data.value.length === 0)
  const isRealData = computed(() => dataSource.value === 'Real')
  const isSimulatedData = computed(() => dataSource.value === 'Simulated')
  
  // Cleanup function for component unmounting
  const cleanup = (): void => {
    if (debounceTimeout) {
      clearTimeout(debounceTimeout)
      debounceTimeout = null
    }
    currentRequestId++ // Cancel any pending requests
  }
  
  return {
    // State
    data,
    dataSource,
    isLoading,
    error,
    latestObservedAt,
    canonicalMetadata,
    // CR-X R2: Delivery series (standalone, org-level — NOT per-workflow)
    deliverySeries,
    deliveryAttributionAuthority,
    deliverySource,
    // CR-X PBT-CLEANUP-4: Explicit delivery error state
    deliveryError,

    // Actions
    refresh,
    refreshImmediate,
    clear,
    cleanup,
    
    // Computed
    hasData,
    isEmpty,
    isRealData,
    isSimulatedData,
    
    // Internal state (for debugging)
    currentRequestId: computed(() => currentRequestId)
  }
}
