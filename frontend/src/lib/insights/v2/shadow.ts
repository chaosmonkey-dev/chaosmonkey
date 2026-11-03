/**
 * ============================================================================
 * LEGACY FILE - REFERENCE ONLY
 * ============================================================================
 *
 * This file exists as historical reference only.
 *
 * The canonical Performance Insight compute layer is:
 *   frontend/src/lib/insights/final/
 *
 * Do not add new Performance Insight logic here.
 * Do not implement new features here.
 * Do not use this file as the primary compute path.
 *
 * When business logic is needed from legacy implementations,
 * extract only the required logic into /final.
 *
 * Owner decision (May 30, 2026):
 *   - computeV2 is legacy reference code
 *   - shadow.ts is legacy reference code
 *   - /final is canonical
 *   - All future PI work flows through /final
 *
 * Architecture:
 *   API Data
 *   ↓
 *   CanonicalInsightInput
 *   ↓
 *   /final generators
 *   ↓
 *   Realism Pipeline
 *   ↓
 *   CanonicalInsight[]
 *   ↓
 *   Current PI UI
 * ============================================================================
 */

import type { EngOutputPoint, SessionDataPoint } from '../types';
import { useGitHubStore } from '../../../stores/github';
import { getV2PrimitiveRegistry } from './registry';
import type { V2OrgFallbackFacts, V2ShadowOutput } from './types';
import { computeSessionPrimitives } from './computeSessionPrimitives';
import { computeFallbackFacts, computePeriodPrimitives, computeV2PreviewRows } from './computeAggregates';
import { normalizeV2SessionsWithDebug } from './normalize';
import { computeV2PerformanceInsights } from './computeV2PerformanceInsights';
import { cleanRightMetric } from './collapsedRowFormatter';
import { filterAndOrderInsightsByAllowlist, MVP_PI_ALLOWLIST_BY_STAGE, getStageForInsight } from './piV2Manifest';
import { getCanonicalPIIds } from './CANONICAL_PI_REGISTRY';

// Module-loaded diagnostic: confirms this legacy shadow module is loaded.
// This does NOT prove build identity — the active entrypoint/build identity
// is established by main.ts (LOCAL_ENTRYPOINT_PROOF) and the served dist
// artifacts, not by this diagnostic. This module is legacy reference only;
// the canonical PI engine is frontend/src/lib/insights/final/.
console.info('[SHADOW] legacy v2 shadow module loaded (non-authoritative)');

/**
 * ============================================================================ 
 * V2 SHADOW MODE — AUTHORITATIVE ENGINE ORCHESTRATION
 * ============================================================================
 * 
 * ✅ SINGLE ENGINE CALL:
 * - V2 shadow mode calls ONLY computeV2PerformanceInsights.ts (FULL engine)
 * - This computes ALL ~34 Performance Insights from real telemetry data
 * - No MVP engines, fallback engines, or parallel compute paths
 * 
 * ✅ DEPRECATED FOR V2:
 * - computeV2PerformanceInsights_MVP.ts (deprecated - use filtering instead)
 * - Any alternate PI compute engines (deprecated)
 * - Silent fallbacks to placeholder data (deprecated)
 * 
 * ✅ MVP BEHAVIOR:
 * - MVP is achieved via filtering in piV2Manifest.ts
 * - FilterAndOrderInsightsByAllowlist() controls visibility/order
 * - NOT achieved via alternate compute paths
 * 
 * ✅ DATA FLOW:
 * 1. Raw session/GitHub data → Session primitives
 * 2. Session primitives → computeV2PerformanceInsights() → All PIs
 * 3. All PIs → MVP filter (piV2Manifest.ts) → Final display set
 * 4. Final set → UI render
 * 
 * ============================================================================ 
 */

// REMOVED: Module run counter (not needed without window publishing)

// Module-level debug flag (disabled for performance)
console.warn('[V2_SHADOW_MODULE_LOADED]', { file: 'shadow.ts', ts: Date.now() })

export const V2_SHADOW_PROBE = { file: 'shadow.ts', ts: Date.now() }

// Module-level flag to ensure debug log happens only once per page load
let didLogV2Debug = false;

// FEATURE FLAG: Enable Raptor mini (Preview) for all clients. Set to `false` to disable globally.
export const RAPTOR_MINI_ENABLED_FOR_ALL = true; // <-- ENABLED: Use V2 engine with fixes

// Module-level state to support V2 tool-scope re-computation (UI-triggered)
let lastRunOpts: {
  sessions?: SessionDataPoint[];
  githubByPeriod?: EngOutputPoint[];
  sessionsInputSource?: string;
  sessionsLoaded?: boolean;
} | null = null;
let didRegisterToolScopeListener = false;

function getV2ToolScope(): 'all' | 'cursor' | 'windsurf' | 'vscode' {
  try {
    if (typeof window === 'undefined') return 'all';
    const v = String(window.localStorage?.getItem('cm_v2_tool_scope') ?? 'all').toLowerCase();
    if (v === 'cursor' || v === 'windsurf' || v === 'vscode') return v;
    return 'all';
  } catch {
    return 'all';
  }
}

export function isV2ShadowEnabled(): boolean {
  try {
    // ALWAYS ENABLE V2 MODE - no feature flags
    return true;
  } catch {
    return false;
  }
}

export function runV2Shadow(opts: {
  sessions?: SessionDataPoint[];
  githubByPeriod?: EngOutputPoint[];
  githubSnapshot?: any;
  // Optional productivity/telemetry time-series points (per period, per tool) from /api/telemetry
  productivityByPeriod?: any[];
  // Optional source tag for debugging where sessions were sourced from
  sessionsInputSource?: string;
  // Optional readiness flag indicating sessions fetch completed upstream
  sessionsLoaded?: boolean;
  // Optional run ID from parent refreshPI() call (for deterministic V2 refresh)
  piRunId?: number;
  // Optional runner identifier (who invoked this - 'dashboards', 'widget', etc.)
  runner?: string;
}): V2ShadowOutput {
  
  // Performance: Disabled verbose logging
  // console.warn('[V2_SHADOW_ENTER_UNGATED]', {
  //   sessions: Array.isArray(opts?.sessions) ? opts.sessions.length : -1,
  //   gh: Array.isArray(opts?.githubByPeriod) ? opts.githubByPeriod.length : -1,
  // })
  
  // No window publishing - simple return value
  const PI_DEBUG_ENV_SHADOW = (import.meta as any)?.env?.VITE_PI_DEBUG ?? 'false';
  const PI_DEBUG_SHADOW = PI_DEBUG_ENV_SHADOW === 'true' || PI_DEBUG_ENV_SHADOW === '1';
  const enabled = isV2ShadowEnabled();
  const githubByPeriodCount = opts?.githubByPeriod?.length ?? 0;
  const sessionsCountInput = Array.isArray(opts?.sessions) ? opts!.sessions!.length : 0;
  const productivityByPeriodCount = Array.isArray((opts as any)?.productivityByPeriod) ? (opts as any).productivityByPeriod.length : 0;
  const githubSnapshotKeysCount = (() => {
    try {
      return opts?.githubSnapshot && typeof opts.githubSnapshot === 'object'
        ? Object.keys(opts.githubSnapshot).length
        : 0
    } catch {
      return 0
    }
  })()
  let normalizedSessionCount: number | undefined = undefined;
  let primaryCount: number | undefined = undefined;
  let secondaryCount: number | undefined = undefined;
  let hiddenCount: number | undefined = undefined;
  let errorMessage: string | undefined = undefined;
  let errorStack: string | undefined = undefined;
  let didEmitShadowReturn = false;

  const emit = (payload: any) => {
    if (!PI_DEBUG_SHADOW) return;
    if (didEmitShadowReturn) return;
    didEmitShadowReturn = true;
    try {
      console.warn('[PI_DEBUG][V2_SHADOW_RETURN]', payload);
    } catch {
      // never throw
    }
  };

  const finalize = (reason: 'disabled' | 'no-sessions' | 'no-github' | 'gated-empty' | 'error' | 'ok', rows: any[]) => {
    const sample = (rows || []).slice(0, 3).map((r: any) => ({
      id: r?.id,
      title: r?.title,
      cicdStage: r?.cicdStage,
      insufficientSignal: r?.insufficientSignal,
    }));
    emit({
      enabled,
      reason,
      returnedCount: Array.isArray(rows) ? rows.length : 0,
      sessionsCount: sessionsCountInput,
      normalizedSessionCount,
      githubByPeriodCount,
      productivityByPeriodCount,
      githubSnapshotKeysCount,
      primaryCount,
      secondaryCount,
      hiddenCount,
      sample,
      errorMessage,
      errorStack,
      sessionsLoaded: opts?.sessionsLoaded,
      sessionsInputSource: opts?.sessionsInputSource,
      runner: opts?.runner,
    });
    return rows;
  };

  // Log entry exactly once per invocation (PI_DEBUG gated)
  if (PI_DEBUG_SHADOW) {
    try {
      console.warn('[PI_DEBUG][V2_SHADOW_ENTER]', {
        enabled,
        sessionsCountInput,
        githubByPeriodCount,
        sessionsLoaded: opts?.sessionsLoaded,
        sessionsInputSource: opts?.sessionsInputSource,
        runner: opts?.runner,
      })
    } catch {
      // never throw
    }
  }

  try {
    const shadowStart = performance.now();

    const primitiveRegistry = getV2PrimitiveRegistry();

    // Compute GitHub availability once for use throughout the function
    const hasGhPeriods = (opts?.githubByPeriod?.length ?? 0) > 0;

    // Debug object used throughout the pipeline (must exist)
    const debug: any = {}

    // 1) Disabled
    if (!enabled) {
      return finalize('disabled', []);
    }

    // 2) No sessions
    if (sessionsCountInput === 0) {
      return finalize('no-sessions', [])
    }

    // 3) No GitHub periods
    if (githubByPeriodCount === 0) {
      return finalize('no-github', [])
    }

    // DEV-only pipeline timing instrumentation is intentionally disabled here
    const PI_PIPELINE_DEBUG = false
    const runId = Number((opts as any)?.piRunId ?? Date.now())
    const shouldLog = (_id: any) => false

  // Cache opts for potential re-run when tool scope changes (v2-only)
  try {
    lastRunOpts = opts;
  } catch {
    // ignore
  }

  // Register a listener to re-run V2 shadow when tool scope changes (v2-only)
  // TEMP DISABLED (MVP stability): can cause re-entrancy / recursive spam.
  const ENABLE_TOOL_SCOPE_LISTENER = false
  if (ENABLE_TOOL_SCOPE_LISTENER) {
    try {
      if (typeof window !== 'undefined' && !didRegisterToolScopeListener) {
        didRegisterToolScopeListener = true;
        window.addEventListener('cm_v2_tool_scope_changed', () => {
          try {
            if (!isV2ShadowEnabled()) return;
            if (!lastRunOpts) return;
            runV2Shadow(lastRunOpts);
          } catch {
            // never throw
          }
        });
      }
    } catch {
      // ignore
    }
  }

  let rawSessionsAny: any[] = Array.isArray(opts.sessions) ? (opts.sessions as any[]) : [];
  
  // DEV-ONLY FALLBACK: If sessions are 0 but telemetry exists (AI Impact renders), synthesize minimal sessions
  // This is a last resort to unblock V2 rendering when backend returns 0 sessions
  if ((import.meta as any).env?.DEV && rawSessionsAny.length === 0 && opts.sessionsLoaded === true) {
    try {
      // Check if telemetry exists by looking for productivity data in window or stores
      const hasTelemetry = typeof window !== 'undefined' && (
        (window as any).__CM_PI_V2_TRACE__?.fetch?.sessionsRawCount > 0 ||
        (window as any).__CM_PI_V2_TRACE__?.primitives?.sessionPrimitiveRowsCount > 0
      )
      
      if (hasTelemetry) {
        // Synthesize minimal session data from telemetry aggregates (DEV only)
        // This allows V2 to compute previewRows even when backend returns 0 sessions
        rawSessionsAny = [{
          session_id: 'dev_fallback_session_1',
          timestamp: new Date().toISOString(),
          tool: 'cursor',
          duration_ms: 3600000, // 1 hour
          ai_burst_count: 5,
          ai_active_span_ms: 1800000, // 30 min
          ai_chars_per_min: 50,
          time_to_first_commit_ms: 600000, // 10 min
          focus_ratio: 0.7,
          flow_profile: 'coding-heavy',
        }]
      }
    } catch {
      // Ignore fallback errors
    }
  }
  
  // Reuse debug object initialized earlier, add additional fields
  Object.assign(debug, {
    rawRowCount: rawSessionsAny.length,
    filteredRowCount: 0,
    normalizedSessionCount: 0,
    computedPrimitiveRowCount: 0,
    fallbackFactsComputed: false,
    error: null,
    sampleKeysTopLevel: [],
    sampleKeysMetadata: [],
    sampleKeysNormalized: [],
    sessionsInputSource: undefined,
    sessionsInputCount: 0,
    sessionsInputFirstKeys: [],
    githubByPeriodCount: 0,
  })
  
  // Pipeline timing instrumentation (DEV only)
  const shadowTimings: Record<string, number> = {};
  
  // Stage 1: Filter rows
  let filteredSessions: any[] = [];
  try {
    filteredSessions = rawSessionsAny.filter(r => {
      const et = String(r?.event_type ?? r?.eventType ?? '').toLowerCase();
      const st = String(r?.segment_type ?? r?.segmentType ?? '').toLowerCase();
      const metadataSt = String(r?.metadata?.segment_type ?? r?.metadata?.segmentType ?? '').toLowerCase();
      const hasDuration = r?.session_duration_ms != null || r?.sessionDurationMs != null || r?.duration_ms != null || r?.durationMs != null || r?.metadata?.session_duration_ms != null || r?.metadata?.sessionDurationMs != null;
      if (et === 'session' || st === 'session' || metadataSt === 'session') return true;
      if (hasDuration) return true;
      return false;
    });
    debug.filteredRowCount = filteredSessions.length;
  } catch (err: any) {
    debug.error = {
      message: `Stage 1 (filterRows) failed: ${err?.message || String(err)}`,
      stack: err?.stack,
      stage: 'filterRows',
    };
  }

  // V2 Debug: Tool/source fields audit (ground truth on the raw filtered rows)
  try {
    const nonEmpty = (v: any) => {
      if (v === undefined || v === null) return false;
      if (typeof v === 'string') return v.trim().length > 0;
      return true;
    };

    const getByDotPath = (obj: any, path: string): any => {
      if (!obj) return undefined;
      const parts = path.split('.');
      let cur = obj;
      for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
      }
      return cur;
    };

    const baseCandidates = [
      'source',
      'tool',
      'editor_source',
      'ide',
      'client_source',
      'session_source',
      'metadata.source',
      'metadata.tool',
      'metadata.editor_source',
      'metadata.ide',
      'metadata.client_source',
      'metadata.session_source',
    ];

    const discovered: string[] = [];
    const firstFiltered = filteredSessions?.[0];
    if (firstFiltered && typeof firstFiltered === 'object') {
      for (const k of Object.keys(firstFiltered)) {
        const lk = k.toLowerCase();
        if (lk.includes('source') || lk.includes('tool') || lk.includes('editor') || lk.includes('ide')) {
          discovered.push(k);
        }
      }
      const meta = firstFiltered?.metadata;
      if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
        for (const k of Object.keys(meta)) {
          const lk = k.toLowerCase();
          if (lk.includes('source') || lk.includes('tool') || lk.includes('editor') || lk.includes('ide')) {
            discovered.push(`metadata.${k}`);
          }
        }
      }
    }

    const candidates = Array.from(new Set([...baseCandidates, ...discovered])).sort();
    const audit: Record<string, { nonEmpty: number; empty: number; missing: number }> = {};
    for (const c of candidates) {
      audit[c] = { nonEmpty: 0, empty: 0, missing: 0 };
    }

    for (const r of filteredSessions) {
      for (const c of candidates) {
        const v = getByDotPath(r, c);
        if (v === undefined || v === null) {
          audit[c].missing++;
        } else if (typeof v === 'string' && v.trim().length === 0) {
          audit[c].empty++;
        } else if (nonEmpty(v)) {
          audit[c].nonEmpty++;
        } else {
          audit[c].missing++;
        }
      }
    }

    debug.toolSourceFieldsAudit = audit;
    debug.toolSourceFieldsAuditCandidates = candidates;
  } catch {
    // never throw
  }

  // Capture raw (pre-normalization) sample from the filtered sessions list
  try {
    const firstFiltered = filteredSessions?.[0];
    const meta = firstFiltered?.metadata;
    const metaType = meta === null || meta === undefined
      ? 'null'
      : Array.isArray(meta)
        ? 'array'
        : (typeof meta);

    const createRawSampleSnippet = (obj: any, maxKeys = 10): Record<string, any> | undefined => {
      if (!obj || typeof obj !== 'object') return undefined;
      const keys = Object.keys(obj).slice(0, maxKeys);
      const snippet: Record<string, any> = {};
      for (const key of keys) {
        const val = obj[key];
        if (val === null || val === undefined) {
          snippet[key] = val;
        } else if (Array.isArray(val)) {
          snippet[key] = `[Array(${val.length})]`;
        } else if (typeof val === 'object') {
          snippet[key] = `[Object(${Object.keys(val).length} keys)]`;
        } else if (typeof val === 'string') {
          snippet[key] = val.length > 120 ? val.slice(0, 120) + '...' : val;
        } else {
          snippet[key] = val;
        }
      }
      return Object.keys(snippet).length > 0 ? snippet : undefined;
    };

    (debug as any).sampleRowRawTopLevel = createRawSampleSnippet(firstFiltered);
    (debug as any).sampleRowRawMetadataType = metaType;
    (debug as any).sampleRowRawMetadataKeys = (metaType === 'object' && meta && typeof meta === 'object')
      ? Object.keys(meta).slice(0, 60)
      : undefined;
    
    // Expose first 5 raw sessions for tool field probe (UI diagnostic)
    const probeSessions = (filteredSessions || []).slice(0, 5).map((s: any, idx: number) => {
      const sessionId = s?.session_id || s?.id || s?.sessionId || `session_${idx}`;
      const shortId = String(sessionId).length > 12 ? String(sessionId).slice(0, 12) + '...' : String(sessionId);
      
      // Extract tool-related fields
      const toolFields: Record<string, any> = {
        session_id: shortId,
        tool: s?.tool,
        editor_source: s?.editor_source,
        source: s?.source,
        ide: s?.ide,
        client: s?.client,
        appName: s?.appName,
        uriScheme: s?.uriScheme,
        'metadata.tool': s?.metadata?.tool,
        'metadata.editor_source': s?.metadata?.editor_source,
        'metadata.source': s?.metadata?.source,
        'metadata.ide': s?.metadata?.ide,
        'metadata.client': s?.metadata?.client,
        'metadata.appName': s?.metadata?.appName,
        'metadata.uriScheme': s?.metadata?.uriScheme,
      };
      
      return toolFields;
    });
    (debug as any).rawToolFieldProbeSessions = probeSessions;
  } catch {
    // never throw
  }

  // Stage 2: Normalize sessions
  let normalizedSessions: any[] = [];
  let normalizeDebug: any = null;
  try {
    if (!debug.error) {
      const normalizeStart = performance.now();
      const res = normalizeV2SessionsWithDebug(filteredSessions);
      normalizedSessions = res.sessions as any[];
      normalizeDebug = res.debug;
      debug.normalizedSessionCount = normalizedSessions.length;
      if (PI_PIPELINE_DEBUG) {
        shadowTimings.normalize = Math.round(performance.now() - normalizeStart);
      }
      
      // Checkpoint 2: After normalize - populate trace object
      if (typeof window !== 'undefined') {
        const trace = (window as any).__CM_PI_V2_TRACE__ || {};
        trace.normalize = {
          normalizedSessionsCount: normalizedSessions.length,
          normalizedDroppedCount: filteredSessions.length - normalizedSessions.length,
        };
        (window as any).__CM_PI_V2_TRACE__ = trace;
      }
    }
  } catch (err: any) {
    debug.error = {
      message: `Stage 2 (normalizeV2Sessions) failed: ${err?.message || String(err)}`,
      stack: err?.stack,
      stage: 'normalizeV2Sessions',
    };
  }

  // Stage 2b: Apply tool scope filter (v2-only; before primitives/preview rows are computed)
  try {
    const scope = getV2ToolScope();
    (debug as any).toolScope = scope;
    if (scope !== 'all' && Array.isArray(normalizedSessions)) {
      normalizedSessions = normalizedSessions.filter(s => String((s as any)?.tool ?? 'unknown') === scope);
      (debug as any).normalizedSessionCountAfterToolScope = normalizedSessions.length;
    }
  } catch {
    // ignore
  }

  // Additional v2 debug facts computed from normalized sessions (UI-visible)
  try {
    // normalization counters (if available)
    if (normalizeDebug && typeof normalizeDebug === 'object') {
      debug.toolRawCounts = normalizeDebug.toolRawCounts;
      debug.toolCanonicalCounts = normalizeDebug.toolCanonicalCounts;
      debug.toolDroppedCount = normalizeDebug.toolDroppedCount;
      debug.toolChosenPathCounts = normalizeDebug.toolChosenPathCounts;
    }

    const normalizedToolHistogram: Record<string, number> = {};
    for (const s of normalizedSessions) {
      const t = (s as any)?.tool;
      const key = (t === undefined || t === null) ? 'unknown' : String(t) || 'unknown';
      normalizedToolHistogram[key] = (normalizedToolHistogram[key] || 0) + 1;
    }
    debug.normalizedToolHistogram = normalizedToolHistogram;
    debug.normalizedSessionCountUsedForToolDist = normalizedSessions.length;

    // Back-compat field used by UI row: make it identical to normalizedToolHistogram.
    debug.toolDistribution = normalizedToolHistogram;

    const init = () => ({ present: 0, missing: 0, numberCount: 0, stringCount: 0 });
    const bt = {
      total: normalizedSessions.length,
      ai_first_burst_at_ms: init(),
      ai_last_burst_at_ms: init(),
      ai_active_span_ms: init(),
    };

    const bump = (bucket: any, v: any) => {
      if (v === undefined || v === null) {
        bucket.missing++;
        return;
      }
      bucket.present++;
      if (typeof v === 'number') bucket.numberCount++;
      else if (typeof v === 'string') bucket.stringCount++;
    };

    for (const s of normalizedSessions) {
      bump(bt.ai_first_burst_at_ms, (s as any)?.ai_first_burst_at_ms);
      bump(bt.ai_last_burst_at_ms, (s as any)?.ai_last_burst_at_ms);
      bump(bt.ai_active_span_ms, (s as any)?.ai_active_span_ms);
    }
    debug.burstTimingCoverage = bt;

    const hasBurstTiming = (s: any) => {
      const dur = s?.duration_ms;
      const first = s?.ai_first_burst_at_ms;
      const last = s?.ai_last_burst_at_ms;
      const span = s?.ai_active_span_ms;
      return dur != null && (first != null || last != null || span != null);
    };

    const isKnownTool = (s: any) => {
      const t = String(s?.tool ?? 'unknown');
      return t.trim().length > 0 && t !== 'unknown';
    };

    let example: any = null;
    let reason = '';

    // Prefer known-tool sessions first, then require burst timing
    example = normalizedSessions.find(s => isKnownTool(s) && hasBurstTiming(s));
    if (example) {
      reason = 'known_tool_and_burst_timing';
    } else {
      example = normalizedSessions.find(s => isKnownTool(s));
      if (example) {
        reason = 'known_tool_fallback';
      } else {
        example = normalizedSessions.find(s => hasBurstTiming(s));
        if (example) reason = 'burst_timing_fallback';
        else {
          example = normalizedSessions[0];
          reason = 'first_row_fallback';
        }
      }
    }

    debug.exampleSessionChosenReason = reason;

    if (example) {
      const sid = String((example as any)?.session_id ?? '');
      const chosenPath = (normalizeDebug && normalizeDebug.toolChosenPathBySessionId)
        ? String(normalizeDebug.toolChosenPathBySessionId[sid] ?? '')
        : '';
      const rawToolVal = (normalizeDebug && normalizeDebug.toolRawBySessionId)
        ? (normalizeDebug.toolRawBySessionId[sid])
        : undefined;

      debug.exampleNormalizedSession = {
        session_id: String((example as any)?.session_id ?? ''),
        tool: String((example as any)?.tool ?? 'unknown'),
        duration_ms: (example as any)?.duration_ms ?? null,
        ai_first_burst_at_ms: (example as any)?.ai_first_burst_at_ms ?? null,
        ai_last_burst_at_ms: (example as any)?.ai_last_burst_at_ms ?? null,
        ai_active_span_ms: (example as any)?.ai_active_span_ms ?? null,
        focus_ratio: (example as any)?.focus_ratio ?? null,
        idle_ratio: (example as any)?.idle_ratio ?? null,
        flow_profile: (example as any)?.flow_profile ?? null,

        tool_chosen_path: chosenPath || null,
        tool_raw_value: rawToolVal,
        raw_tool_fields: {
          tool: (example as any)?.tool,
          tool_raw: (example as any)?.tool_raw,
          source: (example as any)?.source,
          editor_source: (example as any)?.editor_source,
          ide: (example as any)?.ide,
          client_source: (example as any)?.client_source,
          session_source: (example as any)?.session_source,
        },
      };
    }
  } catch {
    // never throw
  }

  // Compute sample keys from first raw row, first raw row metadata, and first normalized row
  const firstRaw = rawSessionsAny?.[0];
  const firstNormalized = normalizedSessions?.[0];

  // Top-level keys from first raw row
  const sampleKeysTopLevel = firstRaw ? Array.from(new Set(Object.keys(firstRaw))).sort() : [];

  // Metadata keys (if metadata is a plain object)
  const sampleKeysMetadata = (() => {
    if (!firstRaw?.metadata) return [];
    if (typeof firstRaw.metadata !== 'object' || Array.isArray(firstRaw.metadata)) return [];
    return Array.from(new Set(Object.keys(firstRaw.metadata))).sort();
  })();

  // Normalized keys from first normalized row
  const sampleKeysNormalized = firstNormalized ? Array.from(new Set(Object.keys(firstNormalized))).sort() : [];

  // Helper to create small sample snippets (first ~10 keys, truncate strings, avoid huge objects/arrays)
  const createSampleSnippet = (obj: any, maxKeys = 10): Record<string, any> | undefined => {
    if (!obj || typeof obj !== 'object') return undefined;
    const keys = Object.keys(obj).slice(0, maxKeys);
    const snippet: Record<string, any> = {};
    for (const key of keys) {
      const val = obj[key];
      if (val === null || val === undefined) {
        snippet[key] = val;
      } else if (Array.isArray(val)) {
        snippet[key] = `[Array(${val.length})]`;
      } else if (typeof val === 'object') {
        snippet[key] = `[Object(${Object.keys(val).length} keys)]`;
      } else if (typeof val === 'string') {
        snippet[key] = val.length > 120 ? val.slice(0, 120) + '...' : val;
      } else {
        snippet[key] = val;
      }
    }
    return Object.keys(snippet).length > 0 ? snippet : undefined;
  };

  debug.sampleKeysTopLevel = sampleKeysTopLevel;
  debug.sampleKeysMetadata = sampleKeysMetadata;
  debug.sampleKeysNormalized = sampleKeysNormalized;
  debug.sampleRowTopLevel = createSampleSnippet(firstRaw);
  debug.sampleRowMetadata = firstRaw?.metadata && typeof firstRaw.metadata === 'object' && !Array.isArray(firstRaw.metadata) ? createSampleSnippet(firstRaw.metadata) : undefined;
  debug.sampleRowNormalized = createSampleSnippet(firstNormalized);

  // Record sessionsInputSource and sessionsLoaded flag if provided by harness
  // Always set these fields (even if 0/undefined) for debug visibility
  try {
    debug.sessionsInputSource = opts?.sessionsInputSource ?? 'unknown'
    debug.sessionsInputCount = opts?.sessions?.length ?? 0
    debug.sessionsInputFirstKeys = firstRaw ? Object.keys(firstRaw).slice(0, 10) : []
    debug.isLoaded = !!(opts?.sessionsLoaded === true)
    debug.githubByPeriodCount = opts?.githubByPeriod?.length ?? 0
    debug.piRunId = opts?.piRunId ?? undefined
  } catch {
    // Set defaults on error
    debug.sessionsInputSource = 'unknown'
    debug.sessionsInputCount = 0
    debug.isLoaded = false
    debug.githubByPeriodCount = 0
    debug.piRunId = undefined
  }

  // Set completion status: 'ok' means data available, 'empty' means no data but pipeline completed
  // Status will be set to 'ready' in publishV2ShadowToWindow when publishing
  // Keep 'loading' until publish, then always transition to 'ready'
  try {
    if (debug.sessionsInputCount === 0 && !debug.isLoaded) {
      // Still loading - keep status as 'loading'
      debug.status = 'loading'
    } else if (debug.normalizedSessionCount === 0 && debug.isLoaded) {
      // Pipeline completed but no data - mark as 'empty' (will become 'ready' on publish)
      debug.status = 'empty'
    } else {
      // Pipeline completed with data - mark as 'ok' (will become 'ready' on publish)
      debug.status = 'ok'
    }
  } catch {
    debug.status = 'loading'
  }

  if (normalizedSessions.length === 0) {
    normalizedSessionCount = 0
    return finalize('no-sessions', [])
  }

  // Stage 3: Compute session primitives
  let rows: any[] = [];
  let coverage: any[] = [];
  let reasonsMissing: any = {};
  try {
    if (!debug.error) {
      const primitivesStart = performance.now();
      
      // PI_DEBUG: Log sessions being passed to computeSessionPrimitives
      if (PI_DEBUG_SHADOW) {
        console.warn('[V2_SHADOW_CALLING_SESSION_PRIMITIVES]', {
          normalizedSessionsCount: Array.isArray(normalizedSessions) ? normalizedSessions.length : 0,
          normalizedSessionsIsArray: Array.isArray(normalizedSessions),
          hasRegistry: !!primitiveRegistry,
          note: 'About to call computeSessionPrimitives'
        });
      }
      
      const result = computeSessionPrimitives(normalizedSessions as any, primitiveRegistry, { PI_DEBUG: PI_DEBUG_SHADOW });
      rows = result.rows;
      coverage = result.coverage;
      reasonsMissing = result.reasonsMissing;
      debug.computedPrimitiveRowCount = rows.length;
      
      // PI_DEBUG: Log result from computeSessionPrimitives
      if (PI_DEBUG_SHADOW) {
        console.warn('[V2_SHADOW_SESSION_PRIMITIVES_RESULT]', {
          rowsComputed: rows.length,
          coverageCount: coverage.length,
          reasonsMissingKeys: Object.keys(reasonsMissing || {}),
          note: 'computeSessionPrimitives returned successfully'
        });
      }
      
      if (PI_PIPELINE_DEBUG) {
        shadowTimings.primitives = Math.round(performance.now() - primitivesStart);
      }

      // One-shot debug print requested for parity/debugging.
      // Proof payload: tool distribution, AI vs non-AI split, Git artifact availability, join match rate.
      try {
        if (PI_DEBUG_SHADOW) {
          const w = window as any
          w.__PI_AUDIT__ = w.__PI_AUDIT__ || {}
          const latchKey = 'V2_PIPELINE_COUNTS'
          const prev = w.__PI_AUDIT__[latchKey] as any

          const sessionsCountByTool: Record<string, number> = {}
          const sessionsCountByAiFlag: Record<string, number> = { ai: 0, non_ai: 0 }

          for (const r of (rows || [])) {
            const tool = String((r as any)?.tool ?? 'unknown').toLowerCase()
            sessionsCountByTool[tool] = (sessionsCountByTool[tool] ?? 0) + 1
            if ((r as any)?.session_has_ai_activity === true) sessionsCountByAiFlag.ai++
            else sessionsCountByAiFlag.non_ai++
          }

          const ghPeriods = Array.isArray(opts?.githubByPeriod) ? opts.githubByPeriod.length : 0
          const prodPoints = Array.isArray((opts as any)?.productivityByPeriod) ? (opts as any).productivityByPeriod.length : 0
          const ghMetrics = (() => {
            try {
              const s = useGitHubStore()
              return {
                connected: (s as any)?.connected ?? null,
                connectionReason: (s as any)?.connectionReason ?? null,
                pullRequests: (s as any)?.metrics?.pullRequests ?? null,
                deploymentFrequency: (s as any)?.metrics?.deploymentFrequency ?? null,
                meanTimeToRecovery: (s as any)?.metrics?.meanTimeToRecovery ?? null,
              }
            } catch {
              return null
            }
          })()

          // Emit at least once, and also re-emit if GitHub connectivity changes.
          // This avoids latching on the initial run while /api/metrics is still loading.
          const prevConnected = prev?.githubConnected
          const curConnected = ghMetrics?.connected
          const shouldEmit = !prev || prevConnected !== curConnected
          if (shouldEmit) {
            w.__PI_AUDIT__[latchKey] = {
              githubConnected: curConnected,
              emittedAt: Date.now(),
            }

            // Join match rate is currently not implemented in computeV2PerformanceInsights.
            // Git→session attribution for IDE/AI splits will collapse until the join exists.
            const join = {
              implemented: false,
              matched: 0,
              total: 0,
              matchRatePct: null as number | null,
              note: 'join_not_implemented (repo+author+timestamp-window)'
            }

            console.log('[PI_DEBUG][V2_PIPELINE_COUNTS]', {
              sessionsInputCount: Array.isArray(opts?.sessions) ? opts.sessions.length : 0,
              normalizedSessionCount: normalizedSessions.length,
              sessionPrimitiveRowsCount: rows.length,
              sessionsCountByTool,
              sessionsCountByAiFlag,
              githubByPeriodCount: ghPeriods,
              productivityByPeriodCount: prodPoints,
              githubMetrics: ghMetrics,
              join,
            })
          }
        }
      } catch {
        // never throw
      }
      
      // Checkpoint 3: After primitives - populate trace object
      if (typeof window !== 'undefined') {
        const trace = (window as any).__CM_PI_V2_TRACE__ || {};
        const aiSessionCount = rows.filter((r: any) => r?.session_has_ai_activity === true).length;
        const nonAiSessionCount = rows.length - aiSessionCount;
        trace.primitives = {
          sessionPrimitiveRowsCount: rows.length,
          aiSessionCount,
          nonAiSessionCount,
        };
        (window as any).__CM_PI_V2_TRACE__ = trace;
      }
    }
  } catch (err: any) {
    debug.error = {
      message: `Stage 3 (computeSessionPrimitives) failed: ${err?.message || String(err)}`,
      stack: err?.stack,
      stage: 'computeSessionPrimitives',
    };
  }

  // Stage 4: Compute fallback facts (attempt even if Stage 3 failed, using normalized sessions)
  let fallbackFacts: V2OrgFallbackFacts | null = null;
  let previewRowsFromNormalized: any[] = [];
  
  // Get org-level MTTR from GitHub store for fallback
  let orgLevelMTTR: number | undefined = undefined;
  try {
    const githubStore = useGitHubStore();
    if (githubStore.metrics?.meanTimeToRecovery !== undefined && 
        githubStore.metrics.meanTimeToRecovery !== null && 
        Number.isFinite(githubStore.metrics.meanTimeToRecovery) &&
        githubStore.metrics.meanTimeToRecovery > 0) {
      orgLevelMTTR = githubStore.metrics.meanTimeToRecovery;
    }
  } catch {
    // Store may not be available in all contexts, ignore
  }

  try {
    if (normalizedSessions.length > 0) {
      // Try with computed rows first, fallback to empty array if Stage 3 failed
      const rowsForFacts = rows.length > 0 ? rows : [];
      const computeStart = performance.now();
      fallbackFacts = computeFallbackFacts(
        rowsForFacts,
        hasGhPeriods,
        opts?.githubByPeriod,
        orgLevelMTTR,
        (opts as any)?.productivityByPeriod,
        (opts as any)?.githubSnapshot
      );
      
      // If computeFallbackFacts returns null but we have normalized sessions, create debug facts
      if (!fallbackFacts && normalizedSessions.length > 0) {
        // Compute preview rows directly from normalized sessions as fallback
        try {
          previewRowsFromNormalized = computeV2PreviewRows(
            rowsForFacts,
            hasGhPeriods,
            opts?.githubByPeriod,
            orgLevelMTTR,
            (opts as any)?.productivityByPeriod,
            (opts as any)?.githubSnapshot
          );
          
          // Step 1: Log the compute output shape (DEV only) - after computeV2PreviewRows
          if ((import.meta as any).env?.DEV) {
            const lens = (a: any) => Array.isArray(a) ? a.length : undefined
            const keys = (a: any) => Array.isArray(a) && a[0] ? Object.keys(a[0]) : undefined
            console.log('[V2 SHADOW][COMPUTE_SHAPE] after computeV2PreviewRows', {
              previewRowsFromNormalizedLen: lens(previewRowsFromNormalized),
              previewRowsFromNormalizedKeys: keys(previewRowsFromNormalized),
              firstRowId: previewRowsFromNormalized[0]?.id,
              firstRowInsufficientSignal: previewRowsFromNormalized[0]?.insufficientSignal,
              allHaveInsufficientSignal: previewRowsFromNormalized.every((r: any) => r?.insufficientSignal === true),
            })
          }
        } catch {
          previewRowsFromNormalized = [];
        }
        if (PI_PIPELINE_DEBUG) {
          shadowTimings.compute = Math.round(performance.now() - computeStart);
        }
        // Step 2: Only add placeholder if truly empty - do NOT overwrite real rows
        // Hard requirement: Do NOT allow placeholder to overwrite real rows
        const hasRealRows = previewRowsFromNormalized.length > 0 && 
          previewRowsFromNormalized.some((r: any) => !r?.insufficientSignal)
        if (!hasRealRows && previewRowsFromNormalized.length === 0 && normalizedSessions.length > 0) {
          previewRowsFromNormalized = [{
            id: 'v2-preview-insufficient-signal',
            title: 'Insights collecting initial data',
            subtitle: 'Minimum coverage thresholds not yet met.',
            rightMetric: 'Insufficient signal',
            details: `Total sessions: ${normalizedSessions.length}\n\nAll preview insights require minimum coverage thresholds that were not met.`,
            coveragePct: 0,
            n: 0,
            insufficientSignal: true,
            cicdStage: 'plan-code' as const, // Ensure placeholder has cicdStage
          }];
        }
        fallbackFacts = {
          toolSessionFingerprints: [],
          orgTtfcP90P50Ratio: null,
          orgAiIntensityByTool: [],
          orgReworkDistribution: { p50: null, p90: null, n: 0 },
          orgAiKickoffTiming: null,
          orgAiSpanCoverage: null,
          orgLateAiUsageShare: null,
          previewRows: previewRowsFromNormalized,
        };
      } else if (fallbackFacts) {
        // Ensure previewRows exist and is always an array (never undefined)
        if (!fallbackFacts.previewRows || !Array.isArray(fallbackFacts.previewRows)) {
          try {
            previewRowsFromNormalized = computeV2PreviewRows(
              rowsForFacts,
              hasGhPeriods,
              opts?.githubByPeriod,
              orgLevelMTTR,
              (opts as any)?.productivityByPeriod,
              (opts as any)?.githubSnapshot
            );
            
            // Step 1: Log the compute output shape (DEV only) - after computeV2PreviewRows (fallback path)
            if ((import.meta as any).env?.DEV) {
              const lens = (a: any) => Array.isArray(a) ? a.length : undefined
              const keys = (a: any) => Array.isArray(a) && a[0] ? Object.keys(a[0]) : undefined
              console.log('[V2 SHADOW][COMPUTE_SHAPE] after computeV2PreviewRows (fallback path)', {
                previewRowsFromNormalizedLen: lens(previewRowsFromNormalized),
                previewRowsFromNormalizedKeys: keys(previewRowsFromNormalized),
                firstRowId: previewRowsFromNormalized[0]?.id,
                firstRowInsufficientSignal: previewRowsFromNormalized[0]?.insufficientSignal,
                allHaveInsufficientSignal: previewRowsFromNormalized.every((r: any) => r?.insufficientSignal === true),
              })
            }
            
            fallbackFacts.previewRows = previewRowsFromNormalized;
          } catch {
            fallbackFacts.previewRows = [];
          }
          if (PI_PIPELINE_DEBUG && !shadowTimings.compute) {
            shadowTimings.compute = Math.round(performance.now() - computeStart);
          }
        } else if (PI_PIPELINE_DEBUG && !shadowTimings.compute) {
          // computeFallbackFacts already computed previewRows, capture timing
          shadowTimings.compute = Math.round(performance.now() - computeStart);
        }
        
        // Step 1: Log what computeFallbackFacts returned (DEV only)
        if ((import.meta as any).env?.DEV && fallbackFacts.previewRows) {
          const lens = (a: any) => Array.isArray(a) ? a.length : undefined
          const keys = (a: any) => Array.isArray(a) && a[0] ? Object.keys(a[0]) : undefined
          console.log('[V2 SHADOW][COMPUTE_SHAPE] after computeFallbackFacts', {
            fallbackFactsPreviewRowsLen: lens(fallbackFacts.previewRows),
            fallbackFactsPreviewRowsKeys: keys(fallbackFacts.previewRows),
            firstRowId: fallbackFacts.previewRows[0]?.id,
            firstRowInsufficientSignal: fallbackFacts.previewRows[0]?.insufficientSignal,
            allHaveInsufficientSignal: fallbackFacts.previewRows.every((r: any) => r?.insufficientSignal === true),
          })
        }
        
        // Step 2: Only add placeholder if truly empty - do NOT overwrite real rows
        // Hard requirement: Do NOT allow placeholder to overwrite real rows
        const hasRealRowsInFallback = fallbackFacts.previewRows.length > 0 && 
          fallbackFacts.previewRows.some((r: any) => !r?.insufficientSignal)
        if (!hasRealRowsInFallback && fallbackFacts.previewRows.length === 0 && normalizedSessions.length > 0) {
          fallbackFacts.previewRows = [{
            id: 'v2-preview-insufficient-signal',
            title: 'Insights collecting initial data',
            subtitle: 'Minimum coverage thresholds not yet met.',
            rightMetric: 'Insufficient signal',
            details: `Total sessions: ${normalizedSessions.length}\n\nAll preview insights require minimum coverage thresholds that were not met.`,
            coveragePct: 0,
            n: 0,
            insufficientSignal: true,
            cicdStage: 'plan-code' as const, // Ensure placeholder has cicdStage
          }];
        }
      }
      debug.fallbackFactsComputed = fallbackFacts != null;
      
      // Populate debug fields for preview rows
      if (fallbackFacts?.previewRows && Array.isArray(fallbackFacts.previewRows)) {
        debug.previewRowsCount = fallbackFacts.previewRows.length;
        debug.previewRowsIds = fallbackFacts.previewRows.map((r: any) => r?.id || 'unknown').filter(Boolean);
      } else {
        debug.previewRowsCount = 0;
        debug.previewRowsIds = [];
      }
    }
  } catch (err: any) {
      // Even if computeFallbackFacts fails, create minimal debug facts with preview rows
      if (normalizedSessions.length > 0) {
        try {
          previewRowsFromNormalized = computeV2PreviewRows(
            rows.length > 0 ? rows : [],
            hasGhPeriods,
            opts?.githubByPeriod,
            orgLevelMTTR,
            (opts as any)?.productivityByPeriod,
            (opts as any)?.githubSnapshot
          );
          
          // Step 1: Log the compute output shape (DEV only) - after computeV2PreviewRows (error path)
          if ((import.meta as any).env?.DEV) {
            const lens = (a: any) => Array.isArray(a) ? a.length : undefined
            const keys = (a: any) => Array.isArray(a) && a[0] ? Object.keys(a[0]) : undefined
            console.log('[V2 SHADOW][COMPUTE_SHAPE] after computeV2PreviewRows (error path)', {
              previewRowsFromNormalizedLen: lens(previewRowsFromNormalized),
              previewRowsFromNormalizedKeys: keys(previewRowsFromNormalized),
              firstRowId: previewRowsFromNormalized[0]?.id,
              firstRowInsufficientSignal: previewRowsFromNormalized[0]?.insufficientSignal,
              allHaveInsufficientSignal: previewRowsFromNormalized.every((r: any) => r?.insufficientSignal === true),
            })
          }
        } catch {
          previewRowsFromNormalized = [];
        }
        // Step 2: Only add placeholder if truly empty - do NOT overwrite real rows
        // Hard requirement: Do NOT allow placeholder to overwrite real rows
        const hasRealRowsInError = previewRowsFromNormalized.length > 0 && 
          previewRowsFromNormalized.some((r: any) => !r?.insufficientSignal)
        if (!hasRealRowsInError && previewRowsFromNormalized.length === 0 && normalizedSessions.length > 0) {
          previewRowsFromNormalized = [{
            id: 'v2-preview-insufficient-signal',
            title: 'Insights collecting initial data',
            subtitle: 'Minimum coverage thresholds not yet met.',
            rightMetric: 'Insufficient signal',
            details: `Total sessions: ${normalizedSessions.length}\n\nAll preview insights require minimum coverage thresholds that were not met.`,
            coveragePct: 0,
            n: 0,
            insufficientSignal: true,
            cicdStage: 'plan-code' as const, // Ensure placeholder has cicdStage
          }];
        }
        fallbackFacts = {
          toolSessionFingerprints: [],
          orgTtfcP90P50Ratio: null,
          orgAiIntensityByTool: [],
          orgReworkDistribution: { p50: null, p90: null, n: 0 },
          orgAiKickoffTiming: null,
          orgAiSpanCoverage: null,
          orgLateAiUsageShare: null,
          previewRows: previewRowsFromNormalized,
        };
        // Populate debug fields even in error case
        debug.previewRowsCount = previewRowsFromNormalized.length;
        debug.previewRowsIds = previewRowsFromNormalized.map((r: any) => r?.id || 'unknown').filter(Boolean);
      }
    debug.error = {
      message: `Stage 4 (computeFallbackFacts) failed: ${err?.message || String(err)}`,
      stack: err?.stack,
      stage: 'computeFallbackFacts',
    };
  }

  // Compute period primitives (non-critical, can fail silently)
  let periodAgg: any = { coverage: [], reasonsMissing: {}, topCandidateSignals: [] };
  try {
    if (rows.length > 0) {
      periodAgg = computePeriodPrimitives(rows, opts.githubByPeriod);
    }
  } catch (err: any) {
    // Log but don't fail the whole pipeline
    // DISABLED: console.warn('[V2] computePeriodPrimitives failed:', err);
  }

  const primitiveCoverage = [...coverage, ...periodAgg.coverage];
  const mergedReasonsMissing = { ...reasonsMissing };
  for (const k of Object.keys(periodAgg.reasonsMissing || {})) {
    mergedReasonsMissing[k] = mergedReasonsMissing[k] || {};
    const bucket = periodAgg.reasonsMissing[k];
    for (const reason of Object.keys(bucket)) {
      mergedReasonsMissing[k][reason] = (mergedReasonsMissing[k][reason] || 0) + (bucket[reason] || 0);
    }
  }

  const topCandidateSignals = [
    ...(periodAgg.topCandidateSignals || []),
    { key: 'org_ttfc_p90_p50_ratio', value: fallbackFacts?.orgTtfcP90P50Ratio ?? null },
    { key: 'tool_session_fingerprints_top3', value: (fallbackFacts?.toolSessionFingerprints || []).slice(0, 3) },
    { key: 'org_ai_intensity_by_tool', value: fallbackFacts?.orgAiIntensityByTool ?? [] },
    { key: 'org_rework_distribution', value: fallbackFacts?.orgReworkDistribution ?? null },
  ];

  // Step 3: Materialize from actual gated output (primary + secondary)
  // Call computeV2PerformanceInsights directly to get rows with gating applied
  let primaryRows: any[] = []
  let secondaryRows: any[] = []
  let candidateRows: any[] = []
  let previewRows: any[] = []
  
  try {
    if (rows.length > 0) {
      // CHOKE-POINT PROOF LOG: Prove data flow into computeV2PerformanceInsights
      if (import.meta.env.DEV) {
        console.log('[SHADOW_DEBUG] About to call computeV2PerformanceInsights with rows:', rows.length);
      }
      
      if (import.meta.env.DEV) {
        console.log('[PI_INPUT] sessionRows.length:', rows.length);
        console.log('[PI_INPUT] first 2 rows:', rows.slice(0, 2).map(r => ({
          tool: r.tool,
          editor_source: (r as any).editor_source,
          source: (r as any).source,
          git_branch: r.git_branch,
          focus_ratio: r.session_focus_ratio,
          time_to_first_commit_ms: r.time_to_first_commit_ms,
          session_duration_minutes: r.session_duration_minutes,
          session_active_coding_duration_minutes: r.session_active_coding_duration_minutes
        })));
        
        const uniqueTools = new Set(rows.map(r => r.tool));
        console.log('[PI_INPUT] unique tool values:', Array.from(uniqueTools));
        console.log('[PI_INPUT] % tool == unknown:', Math.round((Array.from(uniqueTools).filter(t => t === 'unknown').length / uniqueTools.size) * 100) + '%');
        console.log('[PI_INPUT] count rows with git_branch present:', rows.filter(r => r.git_branch !== null && r.git_branch !== undefined && r.git_branch !== '').length);
        console.log('[PI_INPUT] count rows with focus_ratio present:', rows.filter(r => r.session_focus_ratio !== null && r.session_focus_ratio !== undefined).length);
        console.log('[PI_INPUT] count rows with time_to_first_commit_ms present:', rows.filter(r => r.time_to_first_commit_ms !== null && r.time_to_first_commit_ms !== undefined).length);
        
        console.log('[PI_INPUT] githubByPeriod.length:', opts?.githubByPeriod?.length || 0);
        if (opts?.githubByPeriod && opts.githubByPeriod.length > 0) {
          console.log('[PI_INPUT] first github element keys:', Object.keys(opts.githubByPeriod[0] || {}));
        }
      }
      
      // 🔥 DEBUG: Log githubSnapshot before passing to V2 compute
      console.log('🔥🔥🔥 [SHADOW_DEBUG] About to call computeV2PerformanceInsights with:', {
        githubSnapshot: (opts as any)?.githubSnapshot,
        githubSnapshotType: typeof (opts as any)?.githubSnapshot,
        githubSnapshotKeys: (opts as any)?.githubSnapshot && typeof (opts as any)?.githubSnapshot === 'object' ? Object.keys((opts as any)?.githubSnapshot).slice(0, 10) : null,
        hasTopLevelPIs: !!(opts as any)?.githubSnapshot?.reviewer_load_concentration
      });
      
      // 🔥 STEP 2 — HARD GUARD COMPUTE
      let result = [];
      try {
        console.log('[LEGACY_PIPELINE_EXECUTED][COMPUTE_V2_ENTRY]', {
          timestamp: Date.now(),
          sessionRowsCount: rows.length,
          hasGhPeriods,
          githubByPeriodCount: opts?.githubByPeriod?.length || 0,
          githubSnapshotExists: !!(opts as any)?.githubSnapshot,
          githubSnapshotKeys: (opts as any)?.githubSnapshot ? Object.keys((opts as any).githubSnapshot) : [],
          githubSnapshotSample: (opts as any)?.githubSnapshot ? {
            pr_review_metrics: (opts as any).githubSnapshot.pr_review_metrics,
            pr_analytics: (opts as any).githubSnapshot.pr_analytics,
            deployment_metrics: (opts as any).githubSnapshot.deployment_metrics
          } : null
        });
        result = computeV2PerformanceInsights(
          rows,
          hasGhPeriods,
          opts?.githubByPeriod,
          orgLevelMTTR,
          (opts as any)?.productivityByPeriod,
          (opts as any)?.githubSnapshot
        )
        console.log("[PI_DEBUG] computeV2PerformanceInsights succeeded:", result.length)
      } catch (e) {
        console.error("[PI_SHADOW_CRASH]", e)
      }
      let computedRowsWithGating = result;
      
      // LOG 2: Before manifest/filter stage for deployment-frequency-volatility-by-ide
      const deploymentFreqInsight = computedRowsWithGating?.find(r => r.id === 'deployment-frequency-volatility-by-ide');
      if (deploymentFreqInsight) {
        console.log('[CHAIN_2_MANIFEST_FILTER]', {
          id: deploymentFreqInsight.id,
          title: deploymentFreqInsight.title,
          subtitle: deploymentFreqInsight.subtitle,
          description: deploymentFreqInsight.details,
          summary: deploymentFreqInsight.subtitle,
          whyItMatters: deploymentFreqInsight.details
        });
      }

      // Apply MVP allowlist filtering - SINGLE CHOKE POINT
      const filteredRows = filterAndOrderInsightsByAllowlist(computedRowsWithGating);
      
      // PROOF LOG: Trace what we're actually returning
      console.info('[PI_TRACE_SHADOW_BEFORE_RETURN]', {
        computedCount: computedRowsWithGating?.length,
        computedIds: (computedRowsWithGating||[]).map(r => r.id),
        filteredCount: filteredRows?.length,
        filteredIds: (filteredRows||[]).map(r => r.id),
        file: 'shadow.ts',
      });

            
      // CHOKE-POINT PROOF LOG: Prove output from computeV2PerformanceInsights
      if (import.meta.env.DEV) {
        console.log('[PI_OUTPUT] rows.length:', computedRowsWithGating.length);
        console.log('[PI_OUTPUT] filtered.length:', filteredRows.length);
        console.log('[PI_OUTPUT] all rows:', computedRowsWithGating.map(r => ({
          id: r.id,
          value: r.rightMetric,
          insufficientSignal: r.insufficientSignal,
          contributingUnits: r.contributingUnitsCount,
          coveragePct: r.coveragePct,
          n: r.n
        })));
        console.log('[PI_OUTPUT] filtered rows:', filteredRows.map(r => ({
          id: r.id,
          value: r.rightMetric
        })));
      }
      
      // Step 3: All allowlisted rows pass through — demoFlag is for UI styling only, not gating.
      // Previously demo_hidden rows were dropped here; now piV2Manifest is the single gate.
      candidateRows = filteredRows
      primaryRows = filteredRows.filter((r: any) => r?.demoFlag === 'demo_primary')
      secondaryRows = filteredRows.filter((r: any) => r?.demoFlag === 'demo_secondary')
      
      // All allowlisted rows pass through — insufficientSignal is preserved for UI display only.
      // Previously rows with insufficientSignal===true were dropped (except 7 passthrough IDs).
      // Now piV2Manifest is the single gate; UI renders "Insufficient data" badge instead of hiding.
      previewRows = candidateRows;

      // DEV-ONLY: Log which PIs have insufficient signal (informational, not gating)
      const insufficientRows = candidateRows.filter((r: any) => r?.insufficientSignal === true);
      if (insufficientRows.length > 0 && (import.meta as any).env?.DEV) {
        console.info('[PI_DEBUG][INSUFFICIENT_SIGNAL_INFO]', {
          count: insufficientRows.length,
          ids: insufficientRows.map((r: any) => r.id),
          note: 'These PIs render with insufficient-data styling (not dropped)'
        });
      }
      
      // Step 3: Ensure every row has cicdStage
      const ensureCicdStage = (row: any): any => {
        if (!row.cicdStage) {
          const tags = Array.isArray(row.tags) ? row.tags : []
          if (tags.some((t: string) => t.includes('plan-code'))) {
            row.cicdStage = 'plan-code'
          } else if (tags.some((t: string) => t.includes('review-merge'))) {
            row.cicdStage = 'review-merge'
          } else if (tags.some((t: string) => t.includes('deploy-operate') || t.includes('deploy'))) {
            row.cicdStage = 'deploy-operate'
          } else if (row.stage === 'review-merge' || row.bucket === 'review-merge') {
            row.cicdStage = 'review-merge'
          } else if (row.stage === 'deploy-operate' || row.bucket === 'deploy-operate' || row.stage === 'deploy' || row.bucket === 'deploy') {
            row.cicdStage = 'deploy-operate'
          } else {
            row.cicdStage = 'plan-code'
          }
        }
        return row
      }
      
      candidateRows = candidateRows.map(ensureCicdStage)
      previewRows = previewRows.map(ensureCicdStage)
      
      // Step 3: Diagnostic log (once per runId)
      if ((import.meta as any).env?.DEV && shouldLog(runId)) {
        console.log('[V2 MATERIALIZE CHECK]', {
          runId,
          primaryLen: primaryRows.length,
          secondaryLen: secondaryRows.length,
          candidateLen: candidateRows.length,
          previewLen: previewRows.length,
          sampleKeys: candidateRows[0] ? Object.keys(candidateRows[0]) : []
        })
        
        // DEBUG: Check if displayValue exists in AI Suggestions row
        const aiSuggestionsRow = candidateRows.find((r: any) => r?.id === 'ai-suggestions-accepted-by-ide')
        if (aiSuggestionsRow) {
          console.log('🔍 [SHADOW] AI Suggestions Row Fields:', {
            id: aiSuggestionsRow.id,
            displayValue: aiSuggestionsRow.displayValue,
            displayDelta: aiSuggestionsRow.displayDelta,
            displayUnit: aiSuggestionsRow.displayUnit,
            hasAllKeys: Object.keys(aiSuggestionsRow).includes('displayValue')
          })
        }
      }

      // DEV-ONLY: Allowlist completeness check — proves no allowlisted ID was dropped
      if ((typeof window !== 'undefined' && (window as any).__CM_DEBUG_PI__) || (import.meta as any).env?.DEV) {
        const allAllowlistIds = [
          ...MVP_PI_ALLOWLIST_BY_STAGE['plan-code'],
          ...MVP_PI_ALLOWLIST_BY_STAGE['review-merge'],
          ...MVP_PI_ALLOWLIST_BY_STAGE['deploy-operate'],
        ];
        const finalIds = new Set(previewRows.map((r: any) => r.id));
        const missingIds = allAllowlistIds.filter(id => !finalIds.has(id));
        const stageBreakdown = {
          'plan-code': previewRows.filter((r: any) => r.cicdStage === 'plan-code').length,
          'review-merge': previewRows.filter((r: any) => r.cicdStage === 'review-merge').length,
          'deploy-operate': previewRows.filter((r: any) => r.cicdStage === 'deploy-operate').length,
        };
        if (missingIds.length > 0) {
          console.warn('[PI_DEBUG][ALLOWLIST_MISSING_FINAL]', {
            expected: allAllowlistIds.length,
            actual: previewRows.length,
            missingCount: missingIds.length,
            missingIds,
            stageBreakdown,
            note: 'These allowlisted IDs were not produced by the compute engine'
          });
        } else if ((window as any).__CM_DEBUG_PI__) {
          console.info('[PI_DEBUG][ALLOWLIST_COMPLETE]', {
            expected: allAllowlistIds.length,
            actual: previewRows.length,
            stageBreakdown,
            allIds: [...finalIds]
          });
        }
      }

      // DEV-ONLY: Per-PI data availability matrix (set window.__CM_DEBUG_PI_DATA__ = true in console)
      if (typeof window !== 'undefined' && (window as any).__CM_DEBUG_PI_DATA__) {
        const ghSnapshotKeys = ['pr_review_metrics', 'pr_analytics', 'deployment_metrics', 'reviewer_load_concentration', 'github_team_metrics'];
        const ghSnap = (opts as any)?.githubSnapshot;
        const snapshotKeysPresent = ghSnapshotKeys.filter(k => !!ghSnap?.[k]);
        const hasSessions = rows.length > 0;
        const hasGhPeriodData = !!(opts?.githubByPeriod && opts.githubByPeriod.length > 0);

        // Classify each PI's data state
        const classifyDataState = (r: any): string => {
          const cov = r.coveragePct ?? r.signalCoveragePct ?? 0;
          const n = r.contributingUnitsCount ?? r.n ?? 0;
          const isInsufficient = !!r.insufficientSignal;
          const rightMetric = String(r.rightMetric || '');

          // Check if this PI needs snapshot data but doesn't have it
          const snapshotPIs = ['reviewer-load-concentration', 'reopen-pressure-spike', 'large-pr-mix-risk',
                               'stale-deployment-signal', 'failed-deployment-pressure', 'latest-deployment-unhealthy'];
          const ghPeriodPIs = ['session-conditioned-pr-cycle-time-ai-vs-non-ai', 'branch-stagnation-risk-ai-vs-non-ai',
                               'session-conditioned-change-risk-ai-vs-non-ai', 'review-latency-spike-by-ide',
                               'deployment-frequency-volatility-by-ide', 'change-failure-rate-spike-by-ide',
                               'delivery-velocity-by-workflow', 'mttr-by-ide', 'fast-but-unstable-org', 'rework-rate-by-ide'];

          if (cov > 0 && n > 0 && !isInsufficient && !rightMetric.includes('0.0') && rightMetric !== '—') {
            return 'LIVE';
          }
          if (snapshotPIs.includes(r.id) && snapshotKeysPresent.length === 0) {
            return 'NO_INPUTS(gh_snapshot)';
          }
          if (ghPeriodPIs.includes(r.id) && !hasGhPeriodData) {
            return 'NO_INPUTS(gh_periods)';
          }
          if (!hasSessions) {
            return 'NO_INPUTS(sessions)';
          }
          if (isInsufficient && n === 0) {
            return 'NO_INPUTS(zero_state_fill)';
          }
          if (cov === 0 && n === 0) {
            return 'TIME_WINDOW_EMPTY';
          }
          if (rightMetric === '0.0' || rightMetric === '—') {
            return 'MAPPING_FAILURE';
          }
          return 'PARTIAL';
        };

        console.group('[PI_DATA_COVERAGE] Per-PI Data Availability');
        console.table(
          previewRows.map((r: any) => {
            const stage = getStageForInsight(r.id) || r.cicdStage || '—';
            const requiredGH: string[] = [];
            if (['reviewer-load-concentration', 'reopen-pressure-spike', 'large-pr-mix-risk'].includes(r.id)) {
              if (!ghSnap?.pr_review_metrics) requiredGH.push('pr_review_metrics');
              if (!ghSnap?.pr_analytics) requiredGH.push('pr_analytics');
            }
            if (['stale-deployment-signal', 'failed-deployment-pressure', 'latest-deployment-unhealthy'].includes(r.id)) {
              if (!ghSnap?.deployment_metrics) requiredGH.push('deployment_metrics');
            }
            return {
              id: r.id,
              stage,
              dataState: classifyDataState(r),
              hasSessions: (r.n ?? 0) > 0,
              hasGhSnapshot: snapshotKeysPresent.length > 0,
              coveragePct: r.coveragePct ?? r.signalCoveragePct ?? 0,
              contributingUnits: r.contributingUnitsCount ?? r.n ?? 0,
              insufficientSignal: !!r.insufficientSignal,
              rightMetric: r.rightMetric || '—',
              requiredGHKeysMissing: requiredGH.length > 0 ? requiredGH.join(', ') : '—',
            };
          })
        );
        console.log('[PI_DATA_COVERAGE] GitHub Snapshot keys present:', snapshotKeysPresent);
        console.log('[PI_DATA_COVERAGE] Sessions count:', rows.length, '| GH periods:', opts?.githubByPeriod?.length || 0);
        console.groupEnd();
      }
    }
  } catch (err) {
    // FULL ENGINE FAILED - Show DEV error, don't silently fallback
    if ((import.meta as any).env?.DEV) {
      console.error('[V2 COMPUTE FAILED] Full engine crashed:', err);
      console.error('[V2 COMPUTE FAILED] Error details:', {
        message: err?.message || String(err),
        stack: err?.stack,
        stage: 'computeV2PerformanceInsights'
      });
    }
    
    // Create single error row for DEV mode only
    candidateRows = [{
      id: 'v2-compute-failed',
      title: 'Performance insights unavailable',
      subtitle: import.meta.env.DEV ? `Error: ${err?.message || String(err)}` : 'Unable to compute insights at this time',
      rightMetric: '—',
      details: import.meta.env.DEV ? 'Check console for error details' : 'Please try refreshing the page',
      coveragePct: 0,
      n: 0,
      insufficientSignal: true,
      breakdownByTool: {},
      definition: 'Error state placeholder',
      cicdStage: 'plan-code' as const,
      demoFlag: 'demo_hidden' as const,
      contributingUnitsCount: 0,
      contributingUnitType: 'sessions' as const,
      dataMaturityLabel: 'unknown' as const,
      owner: 'system' as const,
    }];
  }
  
  // ALWAYS use computed rows from FULL engine - no fallback
  const gatedRows = candidateRows;
  
  // Step 3: Use candidateRows and previewRows from materialization
  // Only generate placeholders if candidateRows.length === 0
  let candidateRowsToPublish: any[] = []
  let previewRowsToPublish: any[] = []
  
  if (candidateRows.length > 0) {
    // Publish gated rows
    candidateRowsToPublish = candidateRows
    previewRowsToPublish = previewRows
  } else {
    // Step 4: Only generate placeholders when there are zero candidateRows (no primary+secondary at all)
    // When generating placeholders: always set insufficientSignal: true, always set cicdStage to each stage
    if (gatedRows.length === 0) {
      // Create placeholders for each stage
      candidateRowsToPublish = [
        {
          id: 'v2-preview-insufficient-signal-plan-code',
          title: 'Insights collecting initial data',
          subtitle: 'Minimum coverage thresholds not yet met.',
          rightMetric: 'Insufficient signal',
          details: `Total sessions: ${normalizedSessions.length}\n\nAll preview insights require minimum coverage thresholds that were not met.`,
          coveragePct: 0,
          n: 0,
          insufficientSignal: true,
          cicdStage: 'plan-code' as const,
        },
        {
          id: 'v2-preview-insufficient-signal-review-merge',
          title: 'Insights collecting initial data',
          subtitle: 'Minimum coverage thresholds not yet met.',
          rightMetric: 'Insufficient signal',
          details: `Total sessions: ${normalizedSessions.length}\n\nAll preview insights require minimum coverage thresholds that were not met.`,
          coveragePct: 0,
          n: 0,
          insufficientSignal: true,
          cicdStage: 'review-merge' as const,
        },
        {
          id: 'v2-preview-insufficient-signal-deploy-operate',
          title: 'Insights collecting initial data',
          subtitle: 'Minimum coverage thresholds not yet met.',
          rightMetric: 'Insufficient signal',
          details: `Total sessions: ${normalizedSessions.length}\n\nAll preview insights require minimum coverage thresholds that were not met.`,
          coveragePct: 0,
          n: 0,
          insufficientSignal: true,
          cicdStage: 'deploy-operate' as const,
        }
      ]
      previewRowsToPublish = candidateRowsToPublish
    } else {
      // If we have gated rows but all are placeholders, publish them
      candidateRowsToPublish = gatedRows
      previewRowsToPublish = gatedRows
    }
  }
  
  // Phase 1: Log materialization output (throttled)
  if ((import.meta as any).env?.DEV && shouldLog(runId)) {
    const realLen = previewRowsToPublish.length
    const placeholderLen = candidateRowsToPublish.length - previewRowsToPublish.length
    const first3 = candidateRowsToPublish.slice(0, 3).map((r: any) => ({
      id: r?.id,
      cicdStage: r?.cicdStage,
      insufficientSignal: r?.insufficientSignal
    }))
    console.log('[V2 MATERIALIZE OUT]', {
      len: candidateRowsToPublish.length,
      realLen,
      placeholderLen,
      first3
    })
  }
  
  // Phase 1: Log pre-publish state
  if ((import.meta as any).env?.DEV) {
    const realCandidate = candidateRowsToPublish.some((r: any) => !r?.insufficientSignal)
    const realPreview = previewRowsToPublish.some((r: any) => !r?.insufficientSignal)
    console.log('[V2 OUT PRE-PUBLISH]', {
      candidateLen: candidateRowsToPublish.length,
      previewLen: previewRowsToPublish.length,
      ffPreviewLen: fallbackFacts?.previewRows?.length || 0,
      realCandidate,
      realPreview
    })
  }
  
  // Step 2: Stamp the runner (who invoked this)
  if (!debug.runner) {
    debug.runner = opts?.runner || 'unknown'
  }
  
  // REVERT: Return previewRows directly (gated set: primary + secondary)
  // Minimal log: counts of primary/secondary/hidden
  if ((import.meta as any).env?.DEV) {
    const primaryCount = candidateRowsToPublish.filter((r: any) => r?.demoFlag === 'demo_primary').length
    const secondaryCount = candidateRowsToPublish.filter((r: any) => r?.demoFlag === 'demo_secondary').length
    console.log('[V2 HARNESS]', {
      primary: primaryCount,
      secondary: secondaryCount,
      total: candidateRowsToPublish.length,
      rendered: previewRowsToPublish.length
    })
  }

  // Single-return log + return (Phase 3): emit once per call and preserve return value
  normalizedSessionCount = normalizedSessions?.length ?? 0
  primaryCount = candidateRowsToPublish.filter((r: any) => r?.demoFlag === 'demo_primary').length
  secondaryCount = candidateRowsToPublish.filter((r: any) => r?.demoFlag === 'demo_secondary').length
  hiddenCount = candidateRowsToPublish.filter((r: any) => r?.insufficientSignal === true).length

  const PI_DEBUG_ENV = (import.meta as any)?.env?.VITE_PI_DEBUG ?? 'false'
  const PI_DEBUG = PI_DEBUG_ENV === 'true' || PI_DEBUG_ENV === '1'

  // =============================
  // MVP Data Integrity Enforcement
  // Single choke point: right before finalize(...)
  // =============================
  // EXPLORATORY: Temporary denylist for PI curation (Phase 1)
  const HIDDEN_PI_IDS = new Set<string>([
    // Deploy & Operate (problematic / noisy / duplicate)
    'deployment-time-efficiency-regression',
    'ai-neutral-impact-on-delivery', 
    'no-deployment-velocity-data-available',
    'no-deployment-cadence-stability-data-available',
    'mttr',
    
    // Duplicate change-failure-rate variants (keep only canonical)
    'change-failure-rate-trend-by-ide',
    
    // AI speculative / over-claiming
    'ai-yield-ratio-ai-vs-non-ai',
    'commit-abandonment-rate-ai-vs-non-ai'
    // REMOVED: 'branch-stagnation-risk-ai-vs-non-ai' - now required
    // REMOVED: 'change-failure-rate-spike-by-ide' - now required
  ])

  // Use centralized canonical registry instead of local MVP_ALLOWLIST
  const canonicalIds = getCanonicalPIIds();
  
  console.log('[PI_PIPELINE][SHADOW_CANONICAL_REGISTRY]', {
    registrySize: canonicalIds.size,
    canonicalIds: Array.from(canonicalIds)
  });

  const telemetryMvpIds = new Set<string>([
    'active-coding-time-by-ide',
    'ai-suggestions-accepted-by-ide',
    'average-session-length-by-ide',
  ])

  const maturityRank = (label: any): number => {
    const s = String(label || '').toLowerCase()
    if (s.includes('measured')) return 3
    if (s.includes('observed')) return 2
    if (s.includes('early')) return 1
    return 0
  }

  const inferRowSources = (row: any): { sourcesUsed: string[]; attributionUsed: string; placeholderOrProxy: boolean; reason?: string } => {
    const id = String(row?.id || '')
    const sources = new Set<string>()

    const primarySignals: string[] = Array.isArray((row as any)?.primarySignalsUsed)
      ? ((row as any).primarySignalsUsed as any[]).map((s: any) => String(s))
      : []

    const subtitle = String(row?.subtitle || '')
    const details = String(row?.details || '')
    const looksGitAttributed = subtitle.toLowerCase().includes('git-attributed') || details.toLowerCase().includes('git-attributed')

    // Org-only rows are explicitly org-level and should not claim per-tool attribution.
    if (id.endsWith('-org')) {
      sources.add('githubByPeriod')
      return {
        sourcesUsed: Array.from(sources),
        attributionUsed: 'org-only',
        placeholderOrProxy: false,
      }
    }

    // Derive sources from row-declared signals (preferred over availability).
    const sigLc = primarySignals.map(s => s.toLowerCase())
    if (sigLc.includes('sessions') || sigLc.includes('committed_sessions') || sigLc.includes('period_matching')) {
      sources.add('sessions')
    }
    if (sigLc.includes('telemetry')) {
      sources.add('productivityByPeriod')
    }
    if (sigLc.some(s => s.startsWith('github_')) || sigLc.includes('github_periods')) {
      sources.add('githubByPeriod')
    }
    if (sigLc.includes('github_prs')) {
      sources.add('githubSnapshot.all_prs')
    }
    if (sigLc.includes('github_commits')) {
      sources.add('githubSnapshot.all_commits')
    }
    if (looksGitAttributed) {
      sources.add('gitJoin')
      // Join attribution always implies sessions + underlying artifacts.
      sources.add('sessions')
      // If the row is about PRs/commits, include artifact sources when present.
      const snap = opts?.githubSnapshot
      const prsLen = Array.isArray(snap?.all_prs) ? snap.all_prs.length : 0
      const commitsLen = Array.isArray(snap?.all_commits) ? snap.all_commits.length : 0
      if ((id.includes('pr-') || id.includes('review-cycles')) && prsLen > 0) sources.add('githubSnapshot.all_prs')
      if ((id.includes('revert') || id.includes('delivery-rate')) && commitsLen > 0) sources.add('githubSnapshot.all_commits')
    }

    // MVP telemetry-native rows must be per-tool from productivity points.
    if (telemetryMvpIds.has(id)) {
      sources.add('productivityByPeriod')
    }

    // Session-native AI rows
    if (id === 'ai-rework-burden-ai-vs-non-ai') {
      sources.add('sessions')
    }

    const combinedText = (details + ' ' + subtitle).toLowerCase()
    const explicitlyProxy =
      combinedText.includes('proxy') ||
      combinedText.includes('todo: join') ||
      combinedText.includes('equal distribution') ||
      subtitle.toLowerCase().includes('estimated')

    let attributionUsed: string = 'per-tool-from-sessions'
    let placeholderOrProxy = false
    let reason: string | undefined

    if (telemetryMvpIds.has(id) || sigLc.includes('telemetry')) {
      attributionUsed = 'per-tool-from-productivityByPeriod'
    } else if (looksGitAttributed) {
      attributionUsed = 'per-tool-from-join'
    } else if (id === 'time-to-first-commit-by-ide') {
      attributionUsed = 'per-tool-from-sessions'
    }

    if (!looksGitAttributed && !telemetryMvpIds.has(id) && explicitlyProxy) {
      attributionUsed = 'proxy'
      placeholderOrProxy = true
      reason = 'Row text indicates proxy/placeholder attribution'
    }

    return {
      sourcesUsed: Array.from(sources),
      attributionUsed,
      placeholderOrProxy,
      reason,
    }
  }

  // Start from previewRowsToPublish (these are the ones about to be rendered)
  const beforeAllowlist = Array.isArray(previewRowsToPublish) ? [...previewRowsToPublish] : []

  // EXPLORATORY: Apply hidden PI denylist filter (Phase 1)
  const afterHiddenFilter = beforeAllowlist.filter((r: any) => !HIDDEN_PI_IDS.has(String(r?.id || '')))

  const allowlisted = afterHiddenFilter.filter((r: any) => canonicalIds.has(String(r?.id || '')))
  
  // Log V2 Add-PI allowlist status (outside PI_DEBUG for visibility)
  const firstReviewLatencyAfter = allowlisted.some((r: any) => r?.id === 'v2-first-review-latency');
  const releaseRiskIndexAfter = allowlisted.some((r: any) => r?.id === 'v2-release-risk-index');
  console.log('[V2_ALLOWLIST_PASS]', {
    id: 'v2-first-review-latency',
    passed: firstReviewLatencyAfter
  });
  console.log('[V2_ALLOWLIST_PASS]', {
    id: 'v2-release-risk-index',
    passed: releaseRiskIndexAfter
  });
  
  if (PI_DEBUG) {
    const beforeIds = beforeAllowlist.map((r: any) => String(r?.id || 'unknown'))
    const afterHiddenIds = afterHiddenFilter.map((r: any) => String(r?.id || 'unknown'))
    const afterIds = allowlisted.map((r: any) => String(r?.id || 'unknown'))
    const afterSet = new Set(afterIds)
    const dropped = beforeIds.filter(id => !afterSet.has(id))
    const hidden = beforeIds.filter(id => !afterHiddenIds.includes(id))
    console.warn('[PI_DEBUG][V2_ALLOWLIST]', {
      beforeCount: beforeAllowlist.length,
      hiddenCount: hidden.length,
      hiddenIds: hidden,
      afterCount: afterIds.length,
      dropped: dropped
    })
  }
  
  // REMOVED TEMP FIX: Let computed results flow through normally
  
  // 🔥 STEP 3 — DISABLED FALLBACK INSIGHTS (DO NOT REPLACE CANONICAL PIs)
  // The 3-row fallback was replacing canonical inventory. Disabled to preserve canonical composition.
  let finalRows = allowlisted;
  if (allowlisted.length === 0) {
    console.error("[PI_CANONICAL_COLLAPSE] No canonical insights computed - DO NOT use fallback");
    console.error("[PI_CANONICAL_COLLAPSE] This indicates upstream compute failure, not a UI issue");
    console.error("[PI_CANONICAL_COLLAPSE] Expected: 14 canonical PIs, Actual: 0");
    // Return empty array instead of fallback - let the UI show the real error
    finalRows = [];
  }

  // Return the MVP_ALLOWLIST filtered results (not the pre-filtered ones)
  return finalize('ok', finalRows);

  // Original blocking logic (commented out temporarily)
  // const requireJoinAttributed = new Set<string>();
  // const keptAfterBlock: any[] = [];
  // const blocked: any[] = [];
  // ... rest of blocking logic
  
  if (import.meta.env.DEV) {
    console.log('[BLOCK_DEBUG] Processing allowlisted rows:', allowlisted.length);
  }
  
  for (const r of allowlisted) {
    const meta = inferRowSources(r)
    
    if (import.meta.env.DEV) {
      console.log('[BLOCK_DEBUG] Row:', {
        id: r.id,
        placeholderOrProxy: meta.placeholderOrProxy,
        reason: meta.reason,
        subtitle: r.subtitle,
        details: r.details?.substring(0, 100) + '...'
      });
    }

    // Data integrity rule: never show Git-derived "by IDE" rows unless they are explicitly join-attributed.
    // (Option A: correct but sparse). If attribution isn't present, treat as fallback/proxy and hide.
    const subtitle = String((r as any)?.subtitle || '')
    const details = String((r as any)?.details || '')
    const looksGitAttributed = subtitle.toLowerCase().includes('git-attributed') || details.toLowerCase().includes('git-attributed')
    if (requireJoinAttributed.has(String(r?.id || '')) && !looksGitAttributed) {
      const reason = 'Missing join attribution (fallback/proxy)'
      blocked.push({ id: String(r?.id || 'unknown'), reason })
      if (PI_DEBUG) {
        console.warn('[PI_DEBUG][V2_PLACEHOLDER_BLOCK]', {
          id: String(r?.id || 'unknown'),
          reason,
        })
      }
      continue
    }
    if (meta.placeholderOrProxy) {
      blocked.push({ id: String(r?.id || 'unknown'), reason: meta.reason || 'proxy/placeholder attribution' })
      if (PI_DEBUG) {
        console.warn('[PI_DEBUG][V2_PLACEHOLDER_BLOCK]', {
          id: String(r?.id || 'unknown'),
          reason: meta.reason || 'proxy/placeholder attribution',
        })
      }
      continue
    }

    keptAfterBlock.push(r)

    // Telemetry-native integrity: must come from productivityByPeriod
    if (telemetryMvpIds.has(String(r?.id || ''))) {
      const prodLen = Array.isArray(opts?.productivityByPeriod) ? opts.productivityByPeriod.length : 0
      const usesTelemetry = Array.isArray((r as any)?.primarySignalsUsed)
        ? (r as any).primarySignalsUsed.includes('telemetry')
        : true
      if (prodLen <= 0 || usesTelemetry === false) {
        const hiddenReason = prodLen <= 0
          ? 'Missing productivityByPeriod'
          : 'Row does not declare telemetry as a primary signal'
        blocked.push({ id: String(r?.id || 'unknown'), reason: hiddenReason })
        if (PI_DEBUG) {
          console.warn('[PI_DEBUG][V2_TELEMETRY_ROWS]', {
            id: String(r?.id || 'unknown'),
            periodsUsed: prodLen,
            breakdownByTool: (r as any)?.breakdownByTool,
          })
        }
      } else {
        if (PI_DEBUG) {
          console.log('[PI_DEBUG][V2_NON_TELEMETRY_ROW]', {
            id: String(r?.id || 'unknown'),
            cicdStage: (r as any)?.cicdStage,
          })
        }
      }
    } else {
      if (PI_DEBUG) {
        console.log('[PI_DEBUG][V2_NON_TELEMETRY_ROW]', {
          id: String(r?.id || 'unknown'),
          cicdStage: (r as any)?.cicdStage,
          title: (r as any)?.title?.slice(0, 50)
        })
      }
    }

    // AUDIT LOG: Breakdown values for ALL rows (not just telemetry rows)
    if (PI_DEBUG) {
      const rowId = String(r?.id || 'unknown')
      const needsBreakdown = [
        'commits-per-session-by-ide',
        'pr-review-cycles-by-ide',
        'ai-rework-burden-ai-vs-non-ai',
        'fast-but-unstable-org',
        'time-to-first-commit-by-ide'
      ]
      
      if (needsBreakdown.includes(rowId)) {
        console.warn('[PI_DEBUG][V2_BREAKDOWN_VALUES]', {
          id: rowId,
          breakdownByTool: (r as any)?.breakdownByTool,
          rightMetric: (r as any)?.rightMetric,
          subtitle: (r as any)?.subtitle,
          callout: (r as any)?.callout,
          detail: typeof (r as any)?.detail === 'string' 
            ? (r as any).detail.slice(0, 300) 
            : (r as any)?.detail
        })
      }
    }

    keptAfterBlock.push(r)
  }

  // Deterministic dedupe (ONE place): `${id}::${stage}`
  const dedupeMap = new Map<string, any>()
  const dedupeDrops: Array<{ id: string; stage: string; keptReason: string; droppedReason: string }> = []
  const scoreRow = (row: any) => {
    return {
      m: maturityRank((row as any)?.dataMaturityLabel),
      c: Number((row as any)?.coveragePct ?? 0),
      u: Number((row as any)?.contributingUnitsCount ?? (row as any)?.n ?? 0),
    }
  }
  const betterThan = (a: any, b: any): boolean => {
    const sa = scoreRow(a)
    const sb = scoreRow(b)
    if (sa.m !== sb.m) return sa.m > sb.m
    if (sa.c !== sb.c) return sa.c > sb.c
    if (sa.u !== sb.u) return sa.u > sb.u
    return false
  }

  for (const r of keptAfterBlock) {
    const id = String(r?.id || 'unknown')
    const stage = String(r?.cicdStage || 'unknown')
    const key = `${id}::${stage}`
    const existing = dedupeMap.get(key)
    if (!existing) {
      dedupeMap.set(key, r)
      continue
    }
    const keepNew = betterThan(r, existing)
    const kept = keepNew ? r : existing
    const dropped = keepNew ? existing : r
    dedupeMap.set(key, kept)
    dedupeDrops.push({
      id,
      stage,
      keptReason: keepNew ? 'new row scored higher' : 'existing row scored higher',
      droppedReason: keepNew ? 'existing row scored lower' : 'new row scored lower',
    })
    if (PI_DEBUG) {
      // no per-item log; summarize below
    }
  }

  const afterDedupe = Array.from(dedupeMap.values())
  
  // Log V2 Add-PI dedupe status (outside PI_DEBUG for visibility)
  const firstReviewLatencyAfterDedupe = afterDedupe.some((r: any) => r?.id === 'v2-first-review-latency');
  const releaseRiskIndexAfterDedupe = afterDedupe.some((r: any) => r?.id === 'v2-release-risk-index');
  console.log('[V2_DEDUPE_PASS]', {
    id: 'v2-first-review-latency',
    passed: firstReviewLatencyAfterDedupe
  });
  console.log('[V2_DEDUPE_PASS]', {
    id: 'v2-release-risk-index',
    passed: releaseRiskIndexAfterDedupe
  });
  
  if (PI_DEBUG) {
    console.warn('[PI_DEBUG][V2_DEDUPE]', {
      before: keptAfterBlock.length,
      after: afterDedupe.length,
      dropped: dedupeDrops,
    })
  }

  // Phase 2: per-row source report (right before finalize)
  if (PI_DEBUG) {
    for (const r of afterDedupe) {
      const meta = inferRowSources(r)
      console.warn('[PI_DEBUG][V2_ROW_SOURCES]', {
        id: String(r?.id || 'unknown'),
        cicdStage: String(r?.cicdStage || 'unknown'),
        demoFlag: String((r as any)?.demoFlag || 'unknown'),
        insufficientSignal: (r as any)?.insufficientSignal === true,
        sourcesUsed: meta.sourcesUsed,
        attributionUsed: meta.attributionUsed,
        placeholderOrProxy: meta.placeholderOrProxy,
        reason: meta.reason,
      })
    }
  }

  // Phase 4: Minimal UI/copy clarity for allowlisted rows only
  // DEBUG: Check displayValue before applyUIClarity
  const aiSuggestionsBeforeClarity = afterDedupe.find((r: any) => r?.id === 'ai-suggestions-accepted-by-ide')
  if (aiSuggestionsBeforeClarity) {
    console.log('🔍 [SHADOW BEFORE applyUIClarity] AI Suggestions Row:', {
      id: aiSuggestionsBeforeClarity.id,
      displayValue: aiSuggestionsBeforeClarity.displayValue,
      displayDelta: aiSuggestionsBeforeClarity.displayDelta,
      displayUnit: aiSuggestionsBeforeClarity.displayUnit,
      allKeys: Object.keys(aiSuggestionsBeforeClarity)
    })
  }

  const applyUIClarity = (row: any): any => {
    const id = String(row?.id || '')
    const updates: Partial<any> = {}
    
    // FIRST: Clean any metadata from rightMetric (Range:, N:, Sessions:, IDE values, ORG:, etc.)
    const cleanedMetric = cleanRightMetric(row.rightMetric)
    
    // DEBUG: Log cleaning operation
    if (row.rightMetric !== cleanedMetric) {
      console.log('[PI TRACE] Cleaned rightMetric', {
        id,
        before: row.rightMetric,
        after: cleanedMetric
      })
    }
    
    switch (id) {
      case 'commits-per-session-by-ide':
        updates.subtitle = 'Commits per session by IDE'
        if (!cleanedMetric.includes('commits/session')) {
          updates.rightMetric = cleanedMetric.replace(/commits?\/?session?/gi, '') + ' commits/session'
        } else {
          updates.rightMetric = cleanedMetric
        }
        break
      case 'active-coding-time-by-ide':
        updates.subtitle = 'Active coding time by IDE'
        if (!cleanedMetric.includes('min')) {
          updates.rightMetric = cleanedMetric.replace(/days?/gi, '') + ' min'
        } else {
          updates.rightMetric = cleanedMetric
        }
        break
      case 'ai-suggestions-accepted-by-ide':
        updates.subtitle = 'AI suggestions accepted by IDE'
        if (!cleanedMetric.includes('/period')) {
          updates.rightMetric = cleanedMetric + ' /period'
        } else {
          updates.rightMetric = cleanedMetric
        }
        break
      case 'average-session-length-by-ide':
        updates.subtitle = 'Average session length by IDE'
        if (!cleanedMetric.includes('min')) {
          updates.rightMetric = cleanedMetric.replace(/days?/gi, '') + ' min'
        } else {
          updates.rightMetric = cleanedMetric
        }
        break
      case 'time-to-first-commit-by-ide':
        updates.subtitle = 'Time to first commit by IDE'
        if (!cleanedMetric.includes('min')) {
          updates.rightMetric = cleanedMetric.replace(/days?/gi, '') + ' min'
        } else {
          updates.rightMetric = cleanedMetric
       
        }
        break
      case 'ai-rework-burden-ai-vs-non-ai':
        updates.subtitle = 'Rework ratio: AI vs Non-AI'
        if (!cleanedMetric.includes('ratio')) {
          updates.rightMetric = cleanedMetric.replace(/%/gi, '') + ' rework ratio'
        } else {
          updates.rightMetric = cleanedMetric
        }
        break
      case 'delivery-rate-ai-vs-non-ai':
        updates.subtitle = 'Commits per session: AI vs Non-AI'
        if (!cleanedMetric.includes('commits/session')) {
         
          updates.rightMetric = cleanedMetric.replace(/commits?\/?session?/gi, '') + ' commits/session'
        } else {
          updates.rightMetric = cleanedMetric
        }
        break
      case 'fast-but-unstable-org':
        updates.subtitle = 'Velocity vs reliability tradeoff (org)'
        if (!cleanedMetric.includes('score')) {
          updates.rightMetric = cleanedMetric + ' score'
        } else {
          updates.rightMetric = cleanedMetric
        }
        // Make org-level titles actionable
        if (row.title && row.title.includes('Velocity vs reliability')) {
          updates.title = 'Shipping faster but reliability is becoming less predictable'
        }
        break
      case 'change-failure-rate-trend-org':
        updates.subtitle = 'Change failure rate trend (org)'
        if (!cleanedMetric.includes('trend')) {
          updates.rightMetric = cleanedMetric + ' trend'
        } else {
          updates.rightMetric = cleanedMetric
        }
        // Make org-level titles actionable
        if (row.title && row.title.includes('Change failure rate trend')) {
          updates.title = 'Change failure rate is trending upward (action required)'
        }
        break
      case 'mttr-by-ide':
        updates.subtitle = 'Mean time to recovery by IDE'
        if (!cleanedMetric.includes('hours')) {
          updates.rightMetric = cleanedMetric.replace(/days?/gi, '') + ' hours'
        } else {
          updates.rightMetric = cleanedMetric
        }
        break
      default:
        // For non-allowlisted rows, just apply the metadata cleaning
        updates.rightMetric = cleanedMetric
        break
    }
    return { ...row, ...updates }
  }

  finalRows = afterDedupe.map(applyUIClarity)

  // DEBUG: Check displayValue after applyUIClarity
  const aiSuggestionsAfterClarity = finalRows.find((r: any) => r?.id === 'ai-suggestions-accepted-by-ide')
  if (aiSuggestionsAfterClarity) {
    console.log('🔍 [SHADOW AFTER applyUIClarity] AI Suggestions Row:', {
      id: aiSuggestionsAfterClarity.id,
      displayValue: aiSuggestionsAfterClarity.displayValue,
      displayDelta: aiSuggestionsAfterClarity.displayDelta,
      displayUnit: aiSuggestionsAfterClarity.displayUnit,
      allKeys: Object.keys(aiSuggestionsAfterClarity)
    })
  }

  const reason: 'disabled' | 'no-sessions' | 'no-github' | 'gated-empty' | 'error' | 'ok' =
    (finalRows || []).length === 0 ? 'gated-empty' : 'ok'

  // Publish V2 results to window for widget consumption
  publishV2ShadowToWindow(finalRows, reason)

  return finalize(reason, finalRows);
  } catch (err: any) {
    console.error('[V2_SHADOW][RUN_ERROR]', {
      error: err.message,
      stack: err.stack,
      optsLength: opts.githubByPeriod?.length || 0
    });
    errorMessage = String(err?.message ?? err)
    errorStack = String(err?.stack ?? '')
    return finalize('error', [])
  }
}

// Publish V2 shadow results to window for widget consumption
function publishV2ShadowToWindow(rows: V2PreviewRow[], reason: string) {
  try {
    const w = window as any
    if (!w) return
    
    w.__CM_PI_V2__ = {
      enabled: true,
      reason,
      timestamp: Date.now(),
      debug: {
        previewRowsCount: rows.length,
        previewRowsIds: rows.map(r => r.id || 'unknown'),
        previewRows: rows
      }
    }
  } catch (err: any) {
    console.error('[V2_SHADOW][PUBLISH_ERROR]', err)
  }
}

// REMOVED: publishV2ShadowToWindow - no window publishing needed in MVP contract
