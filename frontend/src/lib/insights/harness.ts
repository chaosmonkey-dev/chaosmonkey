// frontend/src/lib/insights/harness.ts
import { generatePerformanceInsights, DEMO_MODE } from './performanceEngine'
import { normalizePeriodKey } from './engine/period'
import { isV2ShadowEnabled, runV2Shadow } from './v2/shadow'
import { computeV2PerformanceInsights } from './v2/computeV2PerformanceInsights';
import { PI_REGISTRY, logRegistryProof } from './v2/piRegistry';
import { V2_PREVIEW_ROW_IDS } from './v2/v2PreviewRowIds';
import type { V2PreviewRow } from './v2/types'
import { isCMPIDebugEnabled } from '../perf/debugGate'
import { getCanonicalPIIds } from './v2/CANONICAL_PI_REGISTRY';

// V6 hotfix sentinels and kill switch
const PERF_COVERAGE_SWITCH =
  ((import.meta as any).env?.VITE_PERF_INSIGHTS_COVERAGE ?? 'on').toLowerCase() !== 'off';
if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[HARNESS_LIVE_V6] loaded', { file: import.meta.url, PERF_COVERAGE_SWITCH });
if (isCMPIDebugEnabled()) console.warn('[HARNESS_MODULE_LOADED_V2_PROBE]', { file: 'harness.ts', ts: Date.now() })

// TTFC Debug flag
const TTFC_DEBUG = ((import.meta as any).env?.VITE_TTFC_DEBUG ?? 'false') === 'true';
import type { PerformanceInsight, EngOutputPoint, ToolProductivityPoint, SessionDataPoint } from './types'
import { mapGitHubToEngOutputByGranularity, mapProductivityToToolsByGranularity } from './providers'
import { deriveGranularity, pickBestGranularity, overlapCount, type Granularity } from './time'

let __LAST_GITHUB_SNAPSHOT__: any = null

export type HarnessInput = {
  githubWeekly: any[]         // raw GitHub weekly series
  productivityWeekly: any[]   // raw productivity-by-tool weekly series
  granularity: Granularity    // granularity for period key alignment
  prodContext?: {             // Source classification for productivity data
    hasLiveProd: boolean
    hasSimProd: boolean
    liveTools?: string[]
    simTools?: string[]
  }
  githubSnapshot?: any        // raw GitHub API response snapshot (contains open_issues_by_repo, repositories, etc.)
  sessions?: SessionDataPoint[]  // Session-level telemetry data for TTFC and session-based insights
  sessionsLoaded?: boolean       // Optional flag indicating sessions fetch completed
  piRunId?: number             // Optional run ID from parent refreshPI() call (for deterministic V2 refresh)
}

/**
 * 🔍 OVERLAP COMPUTATION EXPLANATION:
 * 
 * overlap = count of periods that exist in BOTH engOutput and productivity arrays
 * 
 * Computed via: overlapCount(gh.data, prod.data)
 * Logic: Set intersection of period values
 * 
 * Why overlap might be 0:
 * 1. Period format mismatch (e.g., "2025-W48" vs "2025-11-25")
 * 2. Different time windows (GH has Nov data, Prod has Dec data)  
 * 3. Granularity mismatch (weekly vs daily)
 * 
 * Fix: Ensure both mappers use periodKey() with same granularity,
 * OR both use raw period values that are already aligned.
 * 
 * Current behavior:
 * - pickBestGranularity() tries day/week/month/quarter until overlap >= 4
 * - If none meet threshold, returns preferred anyway (but overlap will be low)
 * - Engine rules check `if (!engOutput?.length || !productivity?.length)` and return []
 * - If overlap is 0, rules that need correlation can't find matching periods → return []
 * - Only fallback rule runs → "Stable Period Detected"
 */
export function runPerfInsightsHarness(input: HarnessInput): PerformanceInsight[] {
  // =====================================
  // PHASE 0: HARNESS TIMING MARKERS
  // =====================================
  const t0 = performance.now();
  if (PI_DEBUG) console.log('[CANONICAL_PI_PIPELINE][HARNESS_ENTRY]', {
    timestamp: Date.now(),
    githubWeeklyCount: input.githubWeekly?.length || 0,
    productivityWeeklyCount: input.productivityWeekly?.length || 0,
    sessionsCount: input.sessions?.length || 0,
    granularity: input.granularity
  });
  if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log("⏱️ [CM_HARNESS] start");
  
  if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('🔍 [HARNESS] runPerfInsightsHarness called with:', {
    githubWeeklyCount: input.githubWeekly?.length || 0,
    productivityWeeklyCount: input.productivityWeekly?.length || 0,
    sessionsCount: input.sessions?.length || 0,
    granularity: input.granularity,
    hasGithubWeekly: !!input.githubWeekly,
    hasProductivityWeekly: !!input.productivityWeekly,
    hasSessions: !!input.sessions
  });
  
  // V2 shadow results (kept in outer scope so we can merge with V1 below)
  let v2Insights: PerformanceInsight[] = []
  let v2RowsCount = 0
  let v2Sample: Pick<PerformanceInsight, 'id' | 'title' | 'tags' | 'cicdStage'> | undefined

  // PI_DEBUG (single function-scoped definition)
  const PI_DEBUG_ENV = (import.meta as any).env?.VITE_PI_DEBUG ?? 'false'
  const PI_DEBUG = PI_DEBUG_ENV === 'true' || PI_DEBUG_ENV === '1'
  
  // TTFC_DEBUG: Log session input at harness entry
  if (TTFC_DEBUG) {
    const callStack = new Error().stack || ''
    const isFromPerfInsightsPage = callStack.includes('PerformanceInsights') || 
                                    callStack.includes('Dashboard') ||
                                    callStack.includes('Widget')
    console.warn('[TTFC_DEBUG][Harness] ENTER runPerfInsightsHarness', {
      hasSessionsInput: !!input.sessions,
      sessionsLength: input.sessions?.length ?? 0,
      calledFromPerfInsightsPage: isFromPerfInsightsPage,
      callStackSnippet: callStack.split('\n').slice(1, 5).join(' | ')
    })
  }

  // V2-only: log the actual sessions payload passed into v2 (once per page load)
  // This must reflect the true upstream shape (not normalized).
  try {
    if (isV2ShadowEnabled()) {
      const w = window as any
      w.__PI_AUDIT__ = w.__PI_AUDIT__ || {}
      const latchKey = 'V2_SESSIONS_INPUT_SHAPE'
      if (!w.__PI_AUDIT__[latchKey]) {
        w.__PI_AUDIT__[latchKey] = true
        const sess: any[] = Array.isArray(input.sessions) ? (input.sessions as any[]) : []
        const first = sess[0]
        const meta = first?.metadata
        const metaType = meta === null || meta === undefined
          ? 'null'
          : Array.isArray(meta)
            ? 'array'
            : typeof meta
        const metaInfo = (() => {
          if (metaType === 'object') return { keys: Object.keys(meta).slice(0, 50) }
          if (metaType === 'string') return { snippet: String(meta).slice(0, 200) }
          return { value: meta }
        })()

        if (isCMPIDebugEnabled()) console.groupCollapsed('[PI_V2][HARNESS_INPUT][sessions]')
        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('typeof input.sessions:', typeof (input as any).sessions)
        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('input.sessions.length:', sess.length)
        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('first row keys:', first ? Object.keys(first).slice(0, 80) : [])
        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('typeof first.metadata:', metaType)
        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('first.metadata info:', metaInfo)
        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('first row sample:', first)
        if (isCMPIDebugEnabled()) console.groupEnd()
      }
    }
  } catch {
    // never throw
  }
  
  // 🔍 FORENSIC: Raw GitHub input inspection - Stage 1 ONLY
  if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[CM_FORENSIC:RAW_GITHUB_INPUT]', {
    rawCount: Array.isArray(input.githubWeekly) ? input.githubWeekly.length : 0,
    rawPeriods: Array.isArray(input.githubWeekly)
      ? [...new Set(
          input.githubWeekly
            .map(r => r?.period)
            .filter(Boolean)
        )]
      : [],
    sampleRows: Array.isArray(input.githubWeekly)
      ? input.githubWeekly.slice(0, 3).map(r => ({
          period: r?.period,
          timestamp: r?.timestamp,
          date: r?.date,
          prs: r?.prs,
          deployments: r?.deployments
        }))
      : []
  });

  // Use granularity-aligned logic with resolvers
  const rawGithubSeries = input.githubWeekly;
  const rawProdSeries = input.productivityWeekly;
  
  // Create a mock filterStore for deriveGranularity (since we already have granularity)
  const mockFilterStore = { activeViewBucket: () => input.granularity };
  const preferred: Granularity = deriveGranularity(mockFilterStore);
  
  const ghResolver = (g: Granularity) => {
    const data = mapGitHubToEngOutputByGranularity(rawGithubSeries, g);
    
    // 🔍 FORENSIC AUDIT: Period forensics - Stage 2: Map to EngOutput
    const discardReasons = [];
    if (rawGithubSeries?.length > 0 && (!data || data.length === 0)) {
      discardReasons.push('mapGitHubToEngOutputByGranularity returned empty array');
    }
    if (data && data.length < rawGithubSeries?.length) {
      discardReasons.push(`${rawGithubSeries.length - data.length} periods lost during mapping`);
    }
    
    if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[CM_AUDIT:PERIOD_FORENSICS]', {
      stage: 'MAPPED_TO_ENG_OUTPUT',
      granularity: g,
      inputCount: rawGithubSeries?.length || 0,
      outputCount: data?.length || 0,
      periodKeys: data?.map(d => d.period) || [],
      sample: data?.slice(0, 3) || [],
      inputSource: 'mapGitHubToEngOutputByGranularity',
      discardReasons,
      rawInputSample: rawGithubSeries?.slice(0, 2) || [],
      mappedOutputSample: data?.slice(0, 2) || []
    });
    
    return { data, source: 'github-synth' };
  };
  const prodResolver = (g: Granularity) => {
    const data = mapProductivityToToolsByGranularity(rawProdSeries, g);
    
    return { data, source: 'prod-synth' };
  };
  
  // Lower threshold from 4 to 2 to be more forgiving with limited data
  // This allows insights to generate with just 2 overlapping periods instead of 4
  const { granularity, gh, prod } = pickBestGranularity(ghResolver, prodResolver, preferred, 2);
  
  // 🔍 FORENSIC AUDIT: Period forensics - Stage 3: Pick best granularity
  const forensicDiscardReasons = [];
  const ghResolverResult = ghResolver(granularity);
  const expectedGhCount = ghResolverResult.data?.length || 0;
  if (expectedGhCount > 0 && (!gh.data || gh.data.length === 0)) {
    forensicDiscardReasons.push('pickBestGranularity selected granularity with empty GitHub data');
  }
  if (gh.data && gh.data.length < expectedGhCount) {
    forensicDiscardReasons.push(`${expectedGhCount - gh.data.length} periods lost during granularity selection`);
  }
  
  if (PI_DEBUG) console.log('[CM_AUDIT:PERIOD_FORENSICS]', {
    stage: 'PICK_BEST_GRANULARITY',
    selectedGranularity: granularity,
    preferredGranularity: preferred,
    inputCount: expectedGhCount,
    outputCount: gh.data?.length || 0,
    periodKeys: gh.data?.map(d => d.period) || [],
    sample: gh.data?.slice(0, 3) || [],
    inputSource: 'pickBestGranularity',
    discardReasons: forensicDiscardReasons,
    allGranularitiesTested: ['week', 'month', 'quarter'],
    resolverInputSample: ghResolverResult.data?.slice(0, 2) || [],
    selectedOutputSample: gh.data?.slice(0, 2) || []
  });
  
  // Normalize period keys to canonical format (YYYY-Www) for all datasets
  // This ensures period alignment across all rules
  const normalizedEngOutput = gh.data.map(e => ({
    ...e,
    period: normalizePeriodKey(e.period)
  }));
  
  // 🔍 FORENSIC AUDIT: Period forensics - Stage 4: Normalize period keys
  const discardReasons = [];
  const originalPeriods = gh.data?.map(e => e.period) || [];
  const normalizedPeriods = normalizedEngOutput?.map(e => e.period) || [];
  const uniqueNormalizedPeriods = [...new Set(normalizedPeriods)];
  
  if (uniqueNormalizedPeriods.length < normalizedPeriods.length) {
    discardReasons.push(`${normalizedPeriods.length - uniqueNormalizedPeriods.length} periods collapsed due to duplicate normalized keys`);
  }
  if (normalizedEngOutput.length < gh.data?.length) {
    discardReasons.push(`${gh.data.length - normalizedEngOutput.length} periods lost during normalization`);
  }
  
  if (PI_DEBUG) console.log('[CM_AUDIT:PERIOD_FORENSICS]', {
    stage: 'NORMALIZED_PERIOD_KEYS',
    inputCount: gh.data?.length || 0,
    outputCount: normalizedEngOutput?.length || 0,
    uniqueNormalizedCount: uniqueNormalizedPeriods.length,
    periodKeys: normalizedPeriods,
    originalPeriodKeys: originalPeriods,
    sample: normalizedEngOutput?.slice(0, 3) || [],
    samplePeriodMappings: gh.data?.slice(0, 5).map(e => ({ 
      original: e.period, 
      normalized: normalizePeriodKey(e.period) 
    })) || [],
    inputSource: 'normalizePeriodKey',
    discardReasons,
    duplicateCollisions: originalPeriods.map((orig, idx) => ({
      original: orig,
      normalized: normalizedPeriods[idx],
      isDuplicate: normalizedPeriods.indexOf(normalizedPeriods[idx]) !== idx
    })).filter(item => item.isDuplicate)
  });
  
  const normalizedProductivity = prod.data.map(p => ({
    ...p,
    period: normalizePeriodKey(p.period)
  }));
  
  // Recalculate overlap with normalized periods (CORRECT approach)
  const overlap = overlapCount(normalizedEngOutput, normalizedProductivity);
  
  // Debug logging for overlap=0 cases (guarded by VITE_PI_DEBUG)
  if (PI_DEBUG && overlap === 0) {
    console.warn('[PI_DEBUG][OVERLAP_ZERO]', {
      engOutputLen: normalizedEngOutput.length,
      productivityLen: normalizedProductivity.length,
      engSamplePeriods: normalizedEngOutput.slice(0, 3).map(e => e.period),
      prodSamplePeriods: normalizedProductivity.slice(0, 3).map(p => p.period),
      granularity,
      note: 'Period formats may be mismatched despite normalization'
    });
  }
  
  // Determine productivity data source (sim / live / hybrid)
  // Check BOTH prodContext AND raw series for telemetry markers
  const rawProd = rawProdSeries || [];
  const rawHasLive = rawProd.some((s: any) =>
    s?.usesTelemetry === true ||
    s?.isLive === true ||
    s?.dataSource === 'Real' ||
    s?.dataSource === 'Hybrid' ||
    (Array.isArray(s?.points) && s.points.some((pt: any) => pt.isLive === true || pt.source === 'live'))
  );
  
  const hasLiveProd = (input.prodContext?.hasLiveProd ?? false) || 
                     rawHasLive || 
                     prod.data.some((p: any) => p.source === 'live' || p.source === 'hybrid');
  
  const hasSimProd = (input.prodContext?.hasSimProd ?? false) || 
                    prod.data.some((p: any) => p.source === 'sim' || p.source === 'hybrid') ||
                    !hasLiveProd;  // If no live detected, assume sim exists
  
  const prodGlobalSource = hasLiveProd && hasSimProd ? 'prod-hybrid' : hasLiveProd ? 'prod-live' : 'prod-sim';
  
  // Pass through to the engine:
  try {
    if (input.githubSnapshot != null) {
      __LAST_GITHUB_SNAPSHOT__ = input.githubSnapshot
      try {
        ;(window as any).__CM_PI_V2_HAS_SEEN_GITHUB_SNAPSHOT__ = true
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  const inputs = {
    engOutput: normalizedEngOutput,
    productivity: normalizedProductivity,
    granularity,
    overlap: overlap,
    prodGlobalSource: prodGlobalSource as 'prod-sim' | 'prod-live' | 'prod-hybrid',  // Type assertion for TypeScript
    ghSeries: normalizedEngOutput,
    prodSeries: normalizedProductivity,
    githubSnapshot: input.githubSnapshot ?? __LAST_GITHUB_SNAPSHOT__,  // Pass snapshot data for repo-level insights
    sessions: input.sessions,  // Pass session data for TTFC and session-based insights
  };

  // PI v2 shadow mode: compute primitives in parallel but do not affect v1 insights.
  try {
    // Choose the sessions array V2 should consume.
    // Prefer explicit input.sessions. If empty/absent, attempt to extract session-like rows
    // from the raw productivity series (best-effort, v2-only and additive).
  const inputSessions = Array.isArray(input.sessions) ? input.sessions : []
    let sessionsForV2: any[] = Array.isArray(inputSessions) ? inputSessions : []
    let sessionsSource = 'input.sessions'

    const looksLikeSession = (r: any) => {
      if (!r || typeof r !== 'object') return false
      const et = String(r?.event_type ?? r?.eventType ?? '').toLowerCase()
      const st = String(r?.segment_type ?? r?.segmentType ?? '').toLowerCase()
      const metadataSt = String(r?.metadata?.segment_type ?? r?.metadata?.segmentType ?? '').toLowerCase()
      const hasDuration = r?.session_duration_ms != null || r?.sessionDurationMs != null || r?.duration_ms != null || r?.durationMs != null || r?.metadata?.session_duration_ms != null
      if (et === 'session' || st === 'session' || metadataSt === 'session') return true
      if (hasDuration) return true
      return false
    }

    try {
      if ((!sessionsForV2 || sessionsForV2.length === 0) && Array.isArray(rawProdSeries) && rawProdSeries.length > 0) {
        const extracted = rawProdSeries.filter(looksLikeSession)
        if (extracted.length > 0) {
          sessionsForV2 = extracted
          sessionsSource = 'productivityWeekly(extracted_sessions)'
        }
      }
    } catch (e) {
      // best-effort only
    }

    // Fix: sessionsLoadedFlag is pure pass-through of the fetch-complete signal
    // Do NOT conflate "loaded" with "has sessions" - they are orthogonal
    const sessionsLoadedFlag = input.sessionsLoaded === true
    const hasSessions = Array.isArray(input.sessions) && input.sessions.length > 0
    
    console.warn('[HARNESS][V2_INPUT] Passing sessions to V2 shadow', { 
      sessionsSource, 
      count: (sessionsForV2 || []).length,
      sessionsLoaded: sessionsLoadedFlag,        // Fetch-complete signal (true/false)
      hasSessions: hasSessions                    // Whether sessions array has content
    })

    console.warn('[HARNESS][V2_PROBE_BEFORE_CALL]', {
      line: 'after V2_INPUT',
      typeofRunV2Shadow: typeof runV2Shadow,
      fnHead: String(runV2Shadow).slice(0, 120),
      sessionsLen: Array.isArray(sessionsForV2) ? sessionsForV2.length : -1,
      ghLen: Array.isArray(normalizedEngOutput) ? normalizedEngOutput.length : -1,
    })

    // Instrumentation: Log before V2 call
    if (PI_DEBUG) {
      console.warn('[PI_V2][HARNESS][CALL]', {
        v2Enabled: isV2ShadowEnabled?.() ?? 'unknown',
        sessionsCount: sessionsForV2?.length,
        sessionsLoaded: sessionsLoadedFlag,
        githubByPeriodCount: normalizedEngOutput?.length,
      })
    }

    // REVERT: Convert V2 rows to PerformanceInsight format and merge with V1
    try {
      let v2Rows: any[] = []
      let v2Err: any = null

      const v2CallLabel = PI_DEBUG ? `[PI_V2][HARNESS][CALL_TIME] ${Date.now()}` : ''

      console.warn('[HARNESS][V2_ABOUT_TO_CALL]', {
        sessionsLen: Array.isArray(sessionsForV2) ? sessionsForV2.length : -1,
        ghLen: Array.isArray(normalizedEngOutput) ? normalizedEngOutput.length : -1,
      })

      try {
        if (PI_DEBUG) {
          console.time(v2CallLabel)
        }
        // Bypass V2 shadow complexity - call compute directly
        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[PI_DEBUG][V2_ENGINE_CALL]', {
          sessionsForV2Count: sessionsForV2.length,
          firstSessionId: sessionsForV2[0]?.session_id,
          githubDataCount: normalizedEngOutput.length,
          callingCompute: true
        })
        
        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[PI_DEBUG][V2_ENGINE_STARTING]', {
          sessionsCount: sessionsForV2?.length,
          githubCount: normalizedEngOutput?.length,
          v2EngineEnabled: isV2ShadowEnabled()
        })
        
        // GUARD: Prevent direct V2 engine call to avoid triple invocation
        // Shadow pipeline will handle V2 computation
        if (false) { // DISABLED: Direct call causes triple invocation
        v2Rows = computeV2PerformanceInsights(
          sessionsForV2,
          true, // hasGhPeriods
          normalizedEngOutput,
          undefined, // orgLevelMTTR
          (inputs as any).productivity,
          (inputs as any).githubSnapshot
        );
        
        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[PI_DEBUG][V2_ENGINE_RESULT]', {
          v2RowsCount: v2Rows.length,
          firstV2RowId: v2Rows[0]?.id,
          allV2RowIds: v2Rows.map(r => r.id)
        })
        } else {
          if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[PI_DEBUG][V2_ENGINE_SKIPPED]', {
            reason: 'preventing triple invocation',
            shadowPipelineWillHandle: true
          });
          v2Rows = [];
        }
        
        // Apply MVP allowlist and write to window store using shadow pipeline
        // Note: Shadow pipeline will compute V2 insights and handle MVP filtering
        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[PI_DEBUG][CALLING_SHADOW_PIPELINE]', {
          sessionsCount: sessionsForV2.length,
          githubCount: normalizedEngOutput.length
        });
        
        // 🔍 FORENSIC AUDIT: Period forensics - Stage 5: Before runV2Shadow
        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[CM_AUDIT:PERIOD_FORENSICS]', {
          stage: 'BEFORE_RUNV2SHADOW',
          inputCount: normalizedEngOutput?.length || 0,
          outputCount: normalizedEngOutput?.length || 0,
          periodKeys: normalizedEngOutput?.map(e => e.period) || [],
          sample: normalizedEngOutput?.slice(0, 3) || [],
          inputSource: 'harness_to_shadow',
          discardReasons: []
        });

        // STAGE 5: runV2Shadow input/output audit
        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[CM_AUDIT:STAGE_5_RUNV2SHADOW]', {
          inputGithubByPeriodLength: normalizedEngOutput.length,
          outputInsightCount: 'pending_after_call'
        });

        // Capture shadow pipeline results
        const shadowResults = runV2Shadow({
          sessions: sessionsForV2,
            githubByPeriod: normalizedEngOutput,
            githubSnapshot: (inputs as any).githubSnapshot
          });
        
        // Convert shadow results to v2Rows for UI processing
        v2Rows = (shadowResults as any) || [];
        
        // STAGE 5: runV2Shadow output audit
        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[CM_AUDIT:STAGE_5_RUNV2SHADOW_OUTPUT]', {
          outputInsightCount: v2Rows.length
        });
        
        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[PI_DEBUG][SHADOW_RESULTS_CAPTURED]', {
          shadowResultsCount: v2Rows.length,
          shadowResultIds: v2Rows.map(r => r.id)
        });
      } catch (e: any) {
        console.error('[PI_DEBUG][V2_ENGINE_ERROR]', {
          error: e.message,
          stack: e.stack,
          errorString: String(e)
        })
        v2Err = e
      } finally {
        if (PI_DEBUG) {
          try {
            console.timeEnd(v2CallLabel)
          } catch {
            // ignore
          }
        }
        console.warn('[HARNESS][V2_PROBE_AFTER_CALL]', {
          threw: !!v2Err,
          errorMessage: v2Err ? String(v2Err?.message ?? v2Err) : undefined,
          errorStack: v2Err?.stack,
          isArray: Array.isArray(v2Rows),
          len: Array.isArray(v2Rows) ? v2Rows.length : -1,
          firstId: Array.isArray(v2Rows) ? v2Rows?.[0]?.id : undefined,
        })
      }

      v2RowsCount = Array.isArray(v2Rows) ? v2Rows.length : 0
      
      // Convert V2PreviewRow[] to PerformanceInsight[]
      // Important: UI expects recommendations[0].text and evidence label/value pairs.
      const summarizeCounts = (m: Record<string, number>): string => {
        const order = ['cursor', 'windsurf', 'vscode']
        const keys = Array.from(new Set([...order, ...Object.keys(m || {})]))
          .filter((k) => (m as any)?.[k] != null)
        return keys
          .map((k) => `${k}=${Number((m as any)[k] ?? 0)}`)
          .join(', ')
      }

      const sessionsCountByTool: Record<string, number> = {}
      try {
        for (const s of (sessionsForV2 || [])) {
          const t = String((s as any)?.tool ?? (s as any)?.tool_id ?? (s as any)?.source ?? 'unknown').toLowerCase()
          sessionsCountByTool[t] = (sessionsCountByTool[t] ?? 0) + 1
        }
      } catch {
        // ignore
      }

      const prodPointsCountByTool: Record<string, number> = {}
      const prodSourceCounts: Record<string, number> = { live: 0, hybrid: 0, sim: 0, unknown: 0 }
      try {
        const prod = Array.isArray((inputs as any).productivity) ? (inputs as any).productivity : []
        for (const p of prod) {
          const t = String((p as any)?.tool ?? 'unknown').toLowerCase()
          prodPointsCountByTool[t] = (prodPointsCountByTool[t] ?? 0) + 1
          const src = String((p as any)?.source ?? '').toLowerCase()
          if (src === 'live' || src === 'hybrid' || src === 'sim') {
            prodSourceCounts[src] = (prodSourceCounts[src] ?? 0) + 1
          } else {
            prodSourceCounts.unknown = (prodSourceCounts.unknown ?? 0) + 1
          }
        }
      } catch {
        // ignore
      }

      const telemetrySourceSummary = (() => {
        const hasLive = (prodSourceCounts.live ?? 0) > 0
        const hasHybrid = (prodSourceCounts.hybrid ?? 0) > 0
        const hasSim = (prodSourceCounts.sim ?? 0) > 0
        if (hasHybrid) return 'hybrid'
        if (hasLive && hasSim) return 'hybrid'
        if (hasLive) return 'live'
        if (hasSim) return 'sim'
        return 'unknown'
      })()

      v2Insights = (v2Rows || []).map((row: V2PreviewRow): PerformanceInsight => {
        // PHASE 3 CANARY: Log input row before conversion
        const v2PlanCodeIds = ['commits-per-session-by-ide', 'active-coding-time-by-ide', 'ai-suggestions-accepted-by-ide', 'average-session-length-by-ide', 'time-to-first-commit-by-ide'];
        const isPlanCode = row?.id && v2PlanCodeIds.includes(row.id);
        if (isPlanCode) {
          if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[PHASE3_CANARY_HARNESS]', {
            id: row?.id,
            title: row?.title,
            displayValue: (row as any)?.displayValue,
            displayDelta: (row as any)?.displayDelta,
            confidenceLabel: (row as any)?.confidenceLabel,
          });
          if (isCMPIDebugEnabled()) console.trace('[PHASE3_TRACE_HARNESS]');
        }
        
        const tags = row.cicdStage ? [row.cicdStage, 'v2'] : ['v2']

        const toNumberMaybe = (v: any): number | null => {
          if (v === null || v === undefined) return null
          if (typeof v === 'number' && Number.isFinite(v)) return v
          const s = typeof v === 'string' ? v.trim() : ''
          if (!s) return null
          const direct = s.endsWith('%') ? s.slice(0, -1) : s
          if (direct !== '' && Number.isFinite(Number(direct))) return Number(direct)
          const m = s.match(/-?\d+(?:\.\d+)?/)
          if (!m) return null
          const n = Number(m[0])
          return Number.isFinite(n) ? n : null
        }

        const inferUnitFromMetricText = (s: string): string | null => {
          const text = String(s || '').toLowerCase()
          if (!text) return null
          if (text.includes('commits/session')) return 'commits/session'
          if (text.includes('commits/pr')) return 'commits/pr'
          if (text.includes('chars/hr') || text.includes('chars/hour')) return 'chars/hr'
          if (text.includes('assists/min')) return 'assists/min'
          if (text.includes('hours') || text.includes('hrs') || text.includes('hr')) return 'hours'
          if (text.includes('days') || text.includes('day')) return 'days'
          if (text.includes('%')) return '%'
          return null
        }

        const inferUnitFromRowId = (id: string): string | null => {
          const key = String(id || '').toLowerCase()
          if (!key) return null
          if (key.includes('commits-per-session')) return 'commits/session'
          if (key.includes('pr-cycle-time')) return 'days'
          if (key.includes('time-to-first-commit') || key.includes('ttfc')) return 'minutes'
          if (key.includes('pr-size')) return 'commits/pr'
          if (key.includes('revert-rate')) return '%'
          if (key.includes('change-failure-rate')) return '%'
          if (key.includes('mttr')) return 'hours'
          if (key.includes('deployment-frequency')) return 'deploys/week'
          return null
        }

        const unit = inferUnitFromMetricText(String(row.rightMetric || ''))
          || inferUnitFromMetricText(String(row.secondaryRightMetric || ''))
          || inferUnitFromRowId(String(row.id || ''))

        const inferMetricName = (): string | null => {
          const subtitle = String((row as any)?.subtitle || '').trim()
          const rm = String(row.rightMetric || '').trim()
          const id = String(row.id || '').toLowerCase()

          // Prefer subtitle when it looks descriptive
          if (subtitle && subtitle.length >= 6 && !/^\d/.test(subtitle)) {
            const cleaned = subtitle.replace(/^estimated\s+/i, '').trim()
            if (cleaned) return cleaned
          }

          // Pull left side of ranked comparison strings like "cursor: 0.6 commits/session"
          if (rm && rm.includes(':') && rm.split(':')[0].length <= 20) {
            // If rightMetric is a ranked list (multiple tool:value pairs), don't use it as name
          } else if (rm && rm.length <= 60 && /[a-zA-Z]/.test(rm) && !rm.includes('\n')) {
            // If it reads like a sentence/label, use it
            if (!/^\d/.test(rm)) return rm
          }

          if (id.includes('commits-per-session')) return 'Commits per session'
          if (id.includes('average-session-length')) return 'Avg session length'
          if (id.includes('ai-suggestions')) return 'AI suggestions accepted'
          if (id.includes('active-coding-time')) return 'Active coding time'
          if (id.includes('time-to-first-commit') || id.includes('ttfc')) return 'Time to first commit'
          if (id.includes('pr-size')) return 'PR size'
          if (id.includes('pr-cycle-time')) return 'PR cycle time'
          if (id.includes('change-failure-rate')) return 'Change failure rate'
          if (id.includes('revert-rate')) return 'Revert rate'
          if (id.includes('mttr')) return 'MTTR'

          return null
        }

        const metricName = inferMetricName()

        // PHASE 3 CONTRACT: Preserve titles verbatim for Plan & Code insights (already standardized)
        // Reuse v2PlanCodeIds from line 372 (already declared above)
        const isPlanCodeInsight = row.id && v2PlanCodeIds.includes(row.id);
        
        const compactTitle = (s: any): string => {
          // For Plan & Code insights, preserve title verbatim (already standardized in compute layer)
          if (isPlanCodeInsight && row.title) {
            return String(row.title).trim();
          }
          
          const raw = String(s || '').trim()
          if (!raw) return raw
          const max = 78
          if (raw.length <= max) return raw
          const seps = [' — ', ' - ', ' | ', ' • ', ': ']
          for (const sep of seps) {
            const idx = raw.indexOf(sep)
            if (idx > 0 && idx < max) {
              const head = raw.slice(0, idx).trim()
              if (head.length >= 10) return head
            }
          }
          const cut = raw.slice(0, max)
          const lastSpace = cut.lastIndexOf(' ')
          if (lastSpace > 40) return cut.slice(0, lastSpace).trim()
          return cut.trim()
        }

        const labelWithUnit = (base: string): string => {
          const b = String(base || '').trim()
          if (!b) return b
          if (!unit) return b
          if (b.toLowerCase().includes(unit.toLowerCase())) return b
          return `${b} (${unit})`
        }

        const labelWithMetric = (base: string): string => {
          const b = String(base || '').trim()
          if (!b) return b
          if (!metricName) return b
          const mn = String(metricName).trim()
          if (!mn) return b
          // Avoid double-prefix if already present
          if (b.toLowerCase().startsWith(mn.toLowerCase())) return b
          return `${mn} — ${b}`
        }

        const labelWithMetricAndUnit = (base: string): string => labelWithMetric(labelWithUnit(base))

        const measureLabel = (() => {
          const mn = String(metricName || '').trim()
          const u = String(unit || '').trim()
          if (!mn && !u) return null
          if (mn && u) return `${mn} (${u})`
          return mn || u
        })()

        const numericLeadEvidence: any[] = []
        try {
          if (row.breakdownByTool && typeof row.breakdownByTool === 'object') {
            const byTool = Object.entries(row.breakdownByTool)
              .map(([k, v]) => ({ k, n: toNumberMaybe(v), raw: v }))
              .filter((x) => x.n !== null)
              .sort((a, b) => Math.abs((b.n as number)) - Math.abs((a.n as number)))
              .slice(0, 3)
            for (const x of byTool) {
              // If raw value is a formatted string (contains units/words), use it and skip numeric
              if (typeof x.raw === 'string' && /[a-zA-Z]/.test(x.raw)) {
                numericLeadEvidence.push({ label: String(x.k), value: x.raw })
              } else {
                // Only use numeric if no formatted string available
                numericLeadEvidence.push({ label: String(x.k), value: x.n })
              }
            }
          } else if (row.breakdownByPeriod && typeof row.breakdownByPeriod === 'object') {
            const byPeriod = Object.entries(row.breakdownByPeriod)
              .map(([k, v]) => ({ k, n: toNumberMaybe(v), raw: v }))
              .filter((x) => x.n !== null)
              .sort((a, b) => String(a.k).localeCompare(String(b.k)))
            const last3 = byPeriod.slice(-3)
            for (const x of last3) {
              // If raw value is a formatted string (contains units/words), use it and skip numeric
              if (typeof x.raw === 'string' && /[a-zA-Z]/.test(x.raw)) {
                numericLeadEvidence.push({ label: String(x.k), value: x.raw })
              } else {
                // Only use numeric if no formatted string available
                numericLeadEvidence.push({ label: String(x.k), value: x.n })
              }
            }
          }
        } catch {
          // never throw
        }

        if (numericLeadEvidence.length === 0) {
          const curr = toNumberMaybe(row.rightMetric)
          const comp = toNumberMaybe(row.secondaryRightMetric)
          if (curr !== null) numericLeadEvidence.push({ label: 'Current', value: curr })
          if (comp !== null) numericLeadEvidence.push({ label: 'Compare', value: comp })
        }

        const evidence: any[] = [...numericLeadEvidence]

        const pushUnique = (label: string, value: any) => {
          const l = String(label || '').trim()
          if (!l) return
          const vKey = value === undefined ? '' : value === null ? 'null' : typeof value === 'string' ? value : JSON.stringify(value)
          const lKey = l.toLowerCase()
          const exists = evidence.some((e: any) => {
            const el = String(e?.label || '').trim().toLowerCase()
            if (el !== lKey) return false
            const ev = e?.value
            const evKey = ev === undefined ? '' : ev === null ? 'null' : typeof ev === 'string' ? ev : JSON.stringify(ev)
            return evKey === vKey
          })
          if (!exists) evidence.push({ label: l, value })
        }

        if (measureLabel) {
          pushUnique('Measure', measureLabel)
        }

        // Provenance / sample sizes: explain flat or identical per-IDE values at a glance.
        try {
          if (Object.keys(sessionsCountByTool).length > 0) {
            pushUnique('Sessions by IDE', summarizeCounts(sessionsCountByTool))
          }
          if (Object.keys(prodPointsCountByTool).length > 0) {
            pushUnique('Telemetry points by IDE', summarizeCounts(prodPointsCountByTool))
          }
          if (telemetrySourceSummary && telemetrySourceSummary !== 'unknown') {
            pushUnique('Telemetry source', telemetrySourceSummary)
          }
        } catch {
          // ignore
        }

        if (typeof row.coveragePct === 'number' && Number.isFinite(row.coveragePct)) {
          pushUnique('Coverage', `${Math.round(row.coveragePct)}%`)
        }
        if (typeof row.n === 'number' && Number.isFinite(row.n)) {
          pushUnique('Points', row.n)
        }

        if (typeof (row as any).signalCoveragePct === 'number' && Number.isFinite((row as any).signalCoveragePct)) {
          pushUnique('Signal coverage', `${Number((row as any).signalCoveragePct).toFixed(1)}%`)
        }

        if (typeof row.contributingUnitsCount === 'number' && Number.isFinite(row.contributingUnitsCount)) {
          if (row.contributingUnitType === 'periods') {
            pushUnique('Weeks in band', row.contributingUnitsCount)
          } else if (row.contributingUnitType === 'prs') {
            pushUnique('Contributing PRs', row.contributingUnitsCount)
          } else if (row.contributingUnitType === 'sessions') {
            pushUnique('Contributing sessions', row.contributingUnitsCount)
          } else {
            pushUnique('Contributing units', row.contributingUnitsCount)
          }
        }

        if (Array.isArray((row as any).primarySignalsUsed) && (row as any).primarySignalsUsed.length > 0) {
          pushUnique('Signals used', (row as any).primarySignalsUsed.join(', '))
        }

        if (row.breakdownByPeriod && typeof row.breakdownByPeriod === 'object') {
          const entries = Object.entries(row.breakdownByPeriod)
            .map(([k, v]) => ({ k: String(k), v, n: toNumberMaybe(v) }))
            .sort((a, b) => a.k.localeCompare(b.k))

          const isIsoDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
          const periodKeys = entries.map(e => e.k).filter(Boolean)
          if (periodKeys.length >= 2 && periodKeys.every(isIsoDay)) {
            pushUnique('Period range', `${periodKeys[0]} → ${periodKeys[periodKeys.length - 1]}`)
          }

          const tail = entries.slice(Math.max(0, entries.length - 4))
          for (const it of tail) {
            pushUnique(it.k, it.n !== null ? it.n : String(it.v))
          }
        }

        if (row.breakdownByTool && typeof row.breakdownByTool === 'object') {
          const entries = Object.entries(row.breakdownByTool)
            .map(([k, v]) => ({ k: String(k), v, n: toNumberMaybe(v) }))
            .sort((a, b) => {
              if (a.n === null && b.n === null) return 0
              if (a.n === null) return 1
              if (b.n === null) return -1
              return Math.abs(b.n) - Math.abs(a.n)
            })
            .slice(0, 4)
          for (const it of entries) {
            pushUnique(it.k, it.n !== null ? it.n : String(it.v))
          }
        }

        if (row.rightMetric) pushUnique('Metric', row.rightMetric)
        if (row.secondaryRightMetric) pushUnique('Compare', row.secondaryRightMetric)

        if (Array.isArray(row.evidence)) {
          for (const e of row.evidence) {
            if (typeof e === 'string' && e.trim()) pushUnique('Evidence', e.trim())
          }
        }

        const owners = row.owner ? (Array.isArray(row.owner) ? row.owner : [row.owner]) : undefined

        const evidenceOrdered = (() => {
          const isStringy = (v: any) => typeof v === 'string' && v.trim().length > 0
          const pri = (label: string): number => {
            const l = String(label || '').trim().toLowerCase()
            if (!l) return 90
            if (l === 'measure') return 10
            if (l === 'period range') return 12
            if (l === 'weeks in band') return 14
            if (l === 'contributing prs') return 14
            if (l === 'contributing sessions') return 14
            if (l === 'contributing units') return 14
            if (l === 'coverage') return 16
            if (l === 'signal coverage') return 16
            if (l === 'points') return 18
            if (l === 'sessions by ide') return 20
            if (l === 'telemetry points by ide') return 20
            if (l === 'telemetry source') return 20
            if (l === 'signals used') return 22
            if (l === 'metric') return 70
            if (l === 'compare') return 72
            if (l === 'evidence') return 80
            if (/^20\d{2}-\d{2}-\d{2}$/.test(l) || /^\d{4}-w\d{1,2}$/.test(l)) return 40
            if (l === 'current') return 42
            return 50
          }

          return evidence
            .map((e: any, idx: number) => {
              const label = String(e?.label || '')
              const isLead = idx < numericLeadEvidence.length
              const basePri = isLead ? 0 : pri(label)
              const value = e?.value
              const valuePri = isStringy(value) ? 1 : 0
              return { e, idx, basePri, valuePri }
            })
            .sort((a, b) => {
              if (a.basePri !== b.basePri) return a.basePri - b.basePri
              if (a.valuePri !== b.valuePri) return a.valuePri - b.valuePri
              return a.idx - b.idx
            })
            .map((x) => x.e)
        })()

        // PHASE 3 CONTRACT: Preserve displayValue, displayDelta, confidenceLabel for collapsed rendering
        // Severity taxonomy: CRITICAL (action_required), HIGH (investigate), MODERATE (monitor), WATCHLIST (informational)
        const insight = {
          id: row.id,
          title: compactTitle(row.title || row.subtitle || ''),
          description: row.subtitle || row.details || '',
          severity: row.urgencyLabel === 'action_required' ? 'critical' :
                    row.urgencyLabel === 'investigate' ? 'high' :
                    row.urgencyLabel === 'monitor' ? 'moderate' :
                    row.urgencyLabel === 'informational' ? 'watchlist' :
                    'moderate',
          tags: tags,
          metricId: row.id,
          cicdStage: row.cicdStage,
          evidence: evidenceOrdered,
          recommendations: row.recommendation ? [{
            text: row.recommendation,
          }] : [],
          source: 'combined',
          dataSource: row.dataMaturityLabel === 'Measured' ? 'real' : 'mixed',
          toolScope: row.breakdownByTool ? 'cross-ide' : 'org',
          tools: row.breakdownByTool ? Object.keys(row.breakdownByTool) : undefined,
          recommendedOwners: owners,
          urgencyLabel: row.urgencyLabel,
          whatsHappening: row.whatsHappening,
          whyItMatters: row.whyItMatters,
          confidence: row.confidence,
          dataMaturityLabel: row.dataMaturityLabel,
          coveragePct: row.coveragePct,
          contributingUnitsCount: row.contributingUnitsCount,
          contributingUnitType: row.contributingUnitType,
          conceptKey: row.conceptKey,
          isCore: row.isCore,
          visibilityHint: row.visibilityHint,
          // V2 IDENTIFICATION FIELDS - CRITICAL for widget filtering
          origin: 'v2',
          producer: 'v2Shadow',
          engineVersion: 'v2',
          version: 'v2',
          // PHASE 3: Preserve structured display fields for collapsed rendering
          displayValue: (row as any).displayValue,
          displayDelta: (row as any).displayDelta,
          displayDeltaPct: (row as any).displayDeltaPct,
          displayUnit: (row as any).displayUnit,
          displayWinnerLabel: (row as any).displayWinnerLabel,
          confidenceLabel: (row as any).confidenceLabel,
          rightMetric: row.rightMetric, // Keep for fallback compatibility
          // PROMPT 5: Preserve breakdownByTool so Chips winner/delta resolvers work
          breakdownByTool: row.breakdownByTool,
          insufficientSignal: (row as any).insufficientSignal,
        } as any
        // --- Presentation Normalizer (demo readiness) ---
        try {
          // Hide tool chips when breakdown values are all placeholders
          if (insight.breakdownByTool && typeof insight.breakdownByTool === 'object') {
            const vals = Object.values(insight.breakdownByTool || {})
            const allPlaceholders = vals.length > 0 && vals.every(v => v === '—' || v === null || v === undefined)
            if (allPlaceholders) {
              insight.tools = undefined
              insight.toolScope = 'org'
            }
          }

          // Upgrade insights that have sufficient real data but still marked as baseline/insufficient
          const hasEnoughCoverage = typeof insight.coveragePct === 'number' && Number.isFinite(insight.coveragePct) && insight.coveragePct >= 50
          const hasEnoughSamples = typeof insight.n === 'number' && Number.isFinite(insight.n) && insight.n >= 20
          if (insight.insufficientSignal && (hasEnoughCoverage || hasEnoughSamples || (insight.contributingUnitsCount && insight.contributingUnitsCount >= 10))) {
            insight.insufficientSignal = false
            // Clean up weak baseline language in title/details
            if (insight.title) {
              insight.title = String(insight.title)
                .replace(/baseline (is )?still forming/ig, '')
                .replace(/establishing baseline patterns/ig, '')
                .replace(/building baseline/ig, '')
                .replace(/limited sample/ig, '')
                .trim()
            }
            if (!insight.title || insight.title.length === 0) {
              // Fallback to existing row title if available
              insight.title = String(row.title || row.subtitle || 'Operational signal').trim()
            }
          }

          // Hide Delivery Velocity By Workflow when workflow-level data missing
          if (insight.metricId === 'delivery-velocity-by-workflow') {
            const hasWorkflowBreakdown = row && (row.breakdownByTool || row.breakdownByPeriod || row.breakdownByWorkflow)
            if (!hasWorkflowBreakdown) {
              insight.visibilityHint = 'hidden'
              insight.demoFlag = 'demo_hidden'
            }
          }

          // Hide weak Review & Merge and Deploy & Operate cards that still report insufficient signal
          const isReviewOrDeployStage = insight.cicdStage === 'review-merge' || insight.cicdStage === 'deploy-operate'
          if (isReviewOrDeployStage && insight.insufficientSignal) {
            insight.visibilityHint = 'hidden'
            insight.demoFlag = 'demo_hidden'
          }
        } catch (err) {
          // never block pipeline on presentation fixes
        }

        // PHASE 3 CANARY: Log output insight after conversion
        if (isPlanCode) {
          if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[PHASE3_CANARY_HARNESS_OUT]', {
            id: insight?.id,
            title: insight?.title,
            displayValue: (insight as any)?.displayValue,
            displayDelta: (insight as any)?.displayDelta,
            confidenceLabel: (insight as any)?.confidenceLabel,
          });
        }
        
        return insight
      })

      v2Sample = v2Insights[0]
      
      // V2 BINDING LOG - Prove V2 identification fields are set
      if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[PI_BIND]', {
        using: 'v2',
        len: v2Insights.length,
        sampleId: v2Sample?.id,
        sampleOrigin: v2Sample?.origin,
        sampleProducer: v2Sample?.producer,
        sampleTags: v2Sample?.tags,
        sampleStage: v2Sample?.cicdStage,
        sampleEngineVersion: (v2Sample as any)?.engineVersion,
        sampleVersion: (v2Sample as any)?.version
      })
      
      // Minimal log: counts per stage
      if (import.meta.env.DEV) {
        const byStage = v2Insights.reduce((acc, i) => {
          const stage = i.cicdStage || 'other'
          acc[stage] = (acc[stage] || 0) + 1
          return acc
        }, {} as Record<string, number>)
        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[V2 HARNESS]', {
          total: v2Insights.length,
          byStage
        })
      }
    } catch (err: any) {
      // v2 must never block v1
      if (PI_DEBUG) {
        try {
          if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[PI_DEBUG][HARNESS_V2_ERROR]', {
            message: err?.message || String(err),
            stack: err?.stack,
            sessionsSource,
            sessionsCount: (sessionsForV2 || []).length,
            sessionsLoaded: sessionsLoadedFlag,
            githubByPeriodCount: normalizedEngOutput?.length,
          })
        } catch {
          // never throw
        }
      }
    }
  } catch {
    // outer try block: v2 must never block v1
  }

  // ========== PI_AUDIT: TOOL IDENTITY (once per run, debug-gated) ==========
  // Proves whether tool identity exists in raw productivity rows and whether it survives normalization.
  // No behavior changes; logs only.
  // Reuse PI_DEBUG from above (line 233)
  if (PI_DEBUG) {
    const w = window as any
    w.__PI_AUDIT__ = w.__PI_AUDIT__ || {}
    const latchKey = 'TOOL_IDENTITY'
    const latched = !!w.__PI_AUDIT__[latchKey]
    if (!latched) {
      w.__PI_AUDIT__[latchKey] = true
      try {
        const rawRows = Array.isArray(rawProdSeries) ? rawProdSeries : []
        const keyCounts: Record<string, number> = {
          tool: 0,
          toolId: 0,
          ide: 0,
          editor: 0,
          source: 0,
        }

        for (const r of rawRows) {
          if (r?.tool != null) keyCounts.tool++
          if (r?.toolId != null) keyCounts.toolId++
          if (r?.ide != null) keyCounts.ide++
          if (r?.editor != null) keyCounts.editor++
          if (r?.source != null) keyCounts.source++
        }

        const normalizedTools = (inputs.productivity || [])
          .map((p: any) => String(p?.tool ?? '').toLowerCase())
          .filter(Boolean)

        const normalizedToolHistogram: Record<string, number> = {}
        for (const t of normalizedTools) {
          const bucket = (t === 'vscode' || t === 'cursor' || t === 'windsurf' || t === 'copilot' || t === 'unknown')
            ? t
            : 'other'
          normalizedToolHistogram[bucket] = (normalizedToolHistogram[bucket] || 0) + 1
        }

        const countsPerTool: Record<string, number> = {}
        for (const t of normalizedTools) {
          countsPerTool[t] = (countsPerTool[t] || 0) + 1
        }

        const distinctNormalizedTools = Object.keys(countsPerTool).sort()

        const truncate = (v: any, max = 48) => {
          const s = String(v ?? '')
          return s.length > max ? s.slice(0, max) + '…' : s
        }
        const sampleRows = rawRows.slice(0, 5).map((r: any) => ({
          tool: truncate(r?.tool),
          toolId: truncate(r?.toolId),
          ide: truncate(r?.ide),
          editor: truncate(r?.editor),
          source: truncate(r?.source),
          periodKey: truncate(r?.period ?? r?.week ?? r?.date ?? r?.timestamp),
        }))

        if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[PI_AUDIT][TOOL_IDENTITY]', {
          toolKeyHistogram: Object.keys(keyCounts).sort().reduce((acc, k) => {
            acc[k] = keyCounts[k]
            return acc
          }, {} as Record<string, number>),
          normalizedToolHistogram: Object.keys(normalizedToolHistogram).sort().reduce((acc, k) => {
            acc[k] = normalizedToolHistogram[k]
            return acc
          }, {} as Record<string, number>),
          distinctNormalizedTools,
          countsPerTool: Object.keys(countsPerTool).sort().reduce((acc, k) => {
            acc[k] = countsPerTool[k]
            return acc
          }, {} as Record<string, number>),
          sampleRows,
        })
      } catch (e) {
        console.warn('[PI_AUDIT][TOOL_IDENTITY] failed to build', e)
      }
    }
  }
  
  // TEMP: Log that we're about to call the engine
  console.warn('[PI][Harness] About to call generatePerformanceInsights', {
    engOutputLen: inputs.engOutput?.length || 0,
    productivityLen: inputs.productivity?.length || 0,
    overlap: inputs.overlap,
    prodGlobalSource: inputs.prodGlobalSource,
    DEMO_MODE
  });
  
  // V2 TEST: This should run BEFORE the engine
  if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[HARNESS][V2_BEFORE_ENGINE]', 'V2 section before engine');
  
  // Phase 0: Log runtime mode and final counts
  const v2Enabled = isV2ShadowEnabled();
  if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[PI_RENDER_MODE]', {
    v2Enabled,
    urlParams: new URLSearchParams(window.location.search).toString(),
    localStorage: localStorage.getItem('cm_insights_v2')
  });
  
  // Phase 1: Verify data inputs
  if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[PI_INPUT_PROOF][sessions]', {
    count: Array.isArray(input.sessions) ? input.sessions.length : 0,
    sampleFields: input.sessions && input.sessions.length > 0 ? {
      session_quality_score: input.sessions[0]?.session_quality_score,
      session_quality_band: input.sessions[0]?.session_quality_band,
      ai_intensity_band: input.sessions[0]?.ai_intensity_band,
      is_remote_workspace: input.sessions[0]?.is_remote_workspace,
      focus_ratio: input.sessions[0]?.focus_ratio,
      idle_ratio: input.sessions[0]?.idle_ratio
    } : null
  });
  
  if (isCMPIDebugEnabled()) if (PI_DEBUG) console.log('[PI_INPUT_PROOF][githubSnapshot]', {
    hasGithubSnapshot: !!input.githubSnapshot,
    githubSnapshotType: typeof input.githubSnapshot,
    githubSnapshotKeys: input.githubSnapshot && typeof input.githubSnapshot === 'object' ? Object.keys(input.githubSnapshot).slice(0, 10) : null,
    hasReview: !!(input.githubSnapshot?.pr_review_metrics),
    hasDeploy: !!(input.githubSnapshot?.deployment_metrics),
    hasAnalytics: !!(input.githubSnapshot?.pr_analytics),
    hasTopLevelPIs: {
      reviewer_load_concentration: !!input.githubSnapshot?.reviewer_load_concentration,
      large_pr_mix_risk: !!input.githubSnapshot?.large_pr_mix_risk,
      stale_deployment_signal: !!input.githubSnapshot?.stale_deployment_signal,
      pr_review_cycles: !!input.githubSnapshot?.pr_review_cycles,
      reopen_pressure_spike: !!input.githubSnapshot?.reopen_pressure_spike
    }
  });

  // 🔥 PHASE 1 RAW INPUT SNAPSHOT: Log githubSnapshot at harness entry
  if (PI_DEBUG) console.log('🔍 [PHASE1_HARNESS_ENTRY] githubSnapshot FULL INSPECTION:', {
    exists: !!input.githubSnapshot,
    type: typeof input.githubSnapshot,
    allKeys: input.githubSnapshot && typeof input.githubSnapshot === 'object' ? Object.keys(input.githubSnapshot) : null,
    
    // Review & Merge fields
    pr_review_metrics: {
      exists: !!input.githubSnapshot?.pr_review_metrics,
      type: typeof input.githubSnapshot?.pr_review_metrics,
      keys: input.githubSnapshot?.pr_review_metrics ? Object.keys(input.githubSnapshot.pr_review_metrics) : null,
      total_prs: input.githubSnapshot?.pr_review_metrics?.total_prs,
      merged_prs: input.githubSnapshot?.pr_review_metrics?.merged_prs,
      pr_reopened_count: input.githubSnapshot?.pr_review_metrics?.pr_reopened_count,
      review_count: input.githubSnapshot?.pr_review_metrics?.review_count,
      unique_reviewer_count: input.githubSnapshot?.pr_review_metrics?.unique_reviewer_count
    },
    
    pr_analytics: {
      exists: !!input.githubSnapshot?.pr_analytics,
      type: typeof input.githubSnapshot?.pr_analytics,
      keys: input.githubSnapshot?.pr_analytics ? Object.keys(input.githubSnapshot.pr_analytics) : null,
      total_prs: input.githubSnapshot?.pr_analytics?.total_prs,
      merged_pull_requests: input.githubSnapshot?.pr_analytics?.merged_pull_requests
    },
    
    reviewer_load_concentration: input.githubSnapshot?.reviewer_load_concentration,
    pr_review_cycles: input.githubSnapshot?.pr_review_cycles,
    reopen_pressure_spike: input.githubSnapshot?.reopen_pressure_spike,
    large_pr_mix_risk: input.githubSnapshot?.large_pr_mix_risk,
    
    // Deploy & Operate fields
    deployment_metrics: {
      exists: !!input.githubSnapshot?.deployment_metrics,
      type: typeof input.githubSnapshot?.deployment_metrics,
      keys: input.githubSnapshot?.deployment_metrics ? Object.keys(input.githubSnapshot.deployment_metrics) : null,
      failed_deployment_count: input.githubSnapshot?.deployment_metrics?.failed_deployment_count,
      success_deployment_count: input.githubSnapshot?.deployment_metrics?.success_deployment_count,
      change_failure_rate: input.githubSnapshot?.deployment_metrics?.change_failure_rate,
      latest_deployment: input.githubSnapshot?.deployment_metrics?.latest_deployment
    },
    
    stale_deployment_signal: input.githubSnapshot?.stale_deployment_signal,
    failed_deployment_pressure: input.githubSnapshot?.failed_deployment_pressure,
    latest_deployment_unhealthy: input.githubSnapshot?.latest_deployment_unhealthy
  });
  
  // Phase 2: Verify registry + allowlist wiring
  logRegistryProof();
  if (PI_DEBUG) console.log('[V2_ALLOWLIST_PROOF]', {
    v2PreviewRowIds: V2_PREVIEW_ROW_IDS,
    count: V2_PREVIEW_ROW_IDS.length
  });
  
  // V6 dataset normalization and overlap computation
  const engineInsights = generatePerformanceInsights(inputs)
  
  console.warn('[PI][Harness] Engine returned', {
    count: engineInsights?.length || 0,
    titles: engineInsights?.map(i => i.title) || []
  });
  
  // Phase 0: Log final counts after engine returns
  if (PI_DEBUG) console.log('[PI_RENDER_MODE]', {
    v2Enabled,
    v1Count: engineInsights?.length || 0,
    v2Count: 0, // Will update after V2 computation
    finalCount: engineInsights?.length || 0
  });
  
  // 🔍 DEBUG: Check why V1 engine only returns 2 insights
  if (PI_DEBUG) console.log('[PI_DEBUG][V1_ENGINE_DEEP_DIVE]', {
    inputsCount: {
      engOutput: inputs.engOutput?.length || 0,
      productivity: inputs.productivity?.length || 0,
      overlap: inputs.overlap
    },
    engineInsightsCount: engineInsights?.length || 0,
    allEngineInsightIds: engineInsights?.map(i => i.id) || [],
    expectingAtLeast: 15
  });
  
  // V2 INSIGHTS ONLY: V2 bypasses V1 engine entirely for stability
  // V2 insights are pre-filtered by manifest and should not be merged with V1
  let allInsights = isV2ShadowEnabled() ? v2Insights : [...(engineInsights || [])];
  
  // TEMPORARY FIX: Apply MVP allowlist if V2 is disabled to prevent 33 insights
  if (PI_DEBUG) console.log('[HARNESS][MVP_FILTER_CHECK]', {
    isV2ShadowEnabled: isV2ShadowEnabled(),
    allInsightsCount: allInsights.length,
    shouldApplyFilter: !isV2ShadowEnabled() && allInsights.length > 15,
    v2InsightsCount: v2Insights.length,
    engineInsightsCount: engineInsights?.length || 0
  });
  
  if (!isV2ShadowEnabled() && allInsights.length > 15) {
    // Use centralized canonical registry instead of local MVP_ALLOWLIST
    const canonicalIds = getCanonicalPIIds();
    
    allInsights = allInsights.filter(insight => canonicalIds.has(insight.id));
    console.warn('[HARNESS][CANONICAL_FILTER]', { 
      before: engineInsights?.length || 0, 
      after: allInsights.length,
      canonicalIds: Array.from(canonicalIds)
    });
  }

  // 🔥 DIAGNOSTIC ONLY: Fallback generator for pipeline analysis, NOT for production UI
  if (!isV2ShadowEnabled() && allInsights.length < 15) {
    console.warn('[HARNESS][FALLBACK_DIAGNOSTIC]', {
      currentCount: allInsights.length,
      sessionsAvailable: (input.sessions || []).length,
      diagnosticMode: true,
      usedForRender: false
    });
    
    // Generate diagnostic insights ONLY to analyze what signals exist
    // DO NOT add to allInsights - this is for analysis only
    const diagnosticInsights = generateMVPFallbackInsights(input.sessions || []);
    
    console.warn('[HARNESS][FALLBACK_DIAGNOSTIC_COMPLETE]', {
      diagnosticCount: diagnosticInsights.length,
      usedForRender: false,
      purpose: 'Pipeline analysis only'
    });
    
    // 🔴 CRITICAL: DO NOT FEED UI WITH FALLBACK INSIGHTS
    // allInsights remains unchanged - only real engine insights are rendered
  }

  // 🔥 MVP FALLBACK INSIGHTS GENERATOR
  function generateMVPFallbackInsights(sessions: SessionDataPoint[]): PerformanceInsight[] {
    if (!sessions || sessions.length === 0) return [];
    
    if (PI_DEBUG) console.log('[HARNESS][FALLBACK_GENERATOR]', {
      sessionsCount: sessions.length,
      generatingInsights: true
    });
    
    const insights: PerformanceInsight[] = [];
    
    // Simple session-based calculations
    const sessionsByTool = new Map<string, SessionDataPoint[]>();
    sessions.forEach(s => {
      const tool = s.tool || 'unknown';
      if (!sessionsByTool.has(tool)) sessionsByTool.set(tool, []);
      sessionsByTool.get(tool)!.push(s);
    });
    
    // Generate basic insights for each tool
    for (const [tool, toolSessions] of sessionsByTool.entries()) {
      const commitsCount = toolSessions.filter(s => (s as any).chars_added_total && (s as any).chars_added_total > 0).length;
      const aiSessionsCount = toolSessions.filter(s => (s as any).ai_burst_count && (s as any).ai_burst_count > 0).length;
      const avgSessionLength = toolSessions.reduce((sum, s) => sum + ((s as any).duration_ms || 0), 0) / toolSessions.length / 60000; // Convert to minutes
      
      // Commits per session insight
      if (commitsCount > 0) {
        insights.push({
          id: `commits-per-session-by-ide-${tool}`,
          title: `Commits per session: ${tool}`,
          cicdStage: 'plan-code',
          tags: ['session', 'productivity'],
          posture: 'diagnostic',
          severity: 'info',
          recommendation: `Continue monitoring commit patterns for ${tool}.`,
          rightMetric: `${commitsCount} sessions with commits`,
          details: `Based on ${toolSessions.length} sessions`,
          n: commitsCount,
          insufficientSignal: commitsCount < 3,
          coveragePct: (commitsCount / toolSessions.length) * 100
        } as PerformanceInsight);
      }
      
      // AI usage insight
      if (aiSessionsCount > 0) {
        insights.push({
          id: `ai-suggestions-accepted-by-ide-${tool}`,
          title: `AI suggestions: ${tool}`,
          cicdStage: 'plan-code',
          tags: ['ai', 'productivity'],
          posture: 'diagnostic',
          severity: 'info',
          recommendation: `${aiSessionsCount > toolSessions.length * 0.5 ? 'Good' : 'Consider increasing'} AI usage for ${tool}.`,
          rightMetric: `${aiSessionsCount} sessions with AI`,
          details: `Based on ${toolSessions.length} sessions`,
          n: aiSessionsCount,
          insufficientSignal: aiSessionsCount < 3,
          coveragePct: (aiSessionsCount / toolSessions.length) * 100
        } as PerformanceInsight);
      }
      
      // Session length insight
      if (avgSessionLength > 0) {
        insights.push({
          id: `average-session-length-by-ide-${tool}`,
          title: `Session length: ${tool}`,
          cicdStage: 'plan-code',
          tags: ['session', 'productivity'],
          posture: 'diagnostic',
          severity: 'info',
          recommendation: `Average session length of ${Math.round(avgSessionLength)} minutes for ${tool}.`,
          rightMetric: `${Math.round(avgSessionLength)} min avg`,
          details: `Based on ${toolSessions.length} sessions`,
          n: toolSessions.length,
          insufficientSignal: toolSessions.length < 3,
          coveragePct: 100
        } as PerformanceInsight);
      }
    }
    
    if (PI_DEBUG) console.log('[HARNESS][FALLBACK_GENERATOR]', {
      insightsGenerated: insights.length,
      insightIds: insights.map(i => i.id)
    });
    
    return insights.slice(0, 15); // Limit to 15 insights
  }

  // Phase 1 log (PI_DEBUG): prove counts and sample of converted V2 insight
  try {
    const PI_DEBUG_ENV = (import.meta as any).env?.VITE_PI_DEBUG ?? 'false'
    const PI_DEBUG = PI_DEBUG_ENV === 'true' || PI_DEBUG_ENV === '1'
    if (PI_DEBUG) {
      if (PI_DEBUG) console.log('[PI_DEBUG][HARNESS_V2_MERGE]', {
        v1InsightsCount: engineInsights?.length ?? 0,
        v2RowsCount,
        v2InsightsCount: v2Insights.length,
        mergedInsightsCount: allInsights.length,
        v2Sample,
      })
    }
  } catch {
    // never throw
  }
  
  if (import.meta.env.DEV) {
    if (PI_DEBUG) console.log('[HARNESS]', {
      v1: engineInsights?.length ?? 0,
      v2: v2Insights.length,
      total: allInsights.length
    })
  }
  
  if (DEMO_MODE) {
    if (PI_DEBUG) console.log(
      `⏱️ [CM_HARNESS] end ms=${Math.round(performance.now() - t0)}`
    );
    return allInsights
  }
  
  if (PI_DEBUG) console.log(
    `⏱️ [CM_HARNESS] end ms=${Math.round(performance.now() - t0)}`
  );
  return allInsights
}
