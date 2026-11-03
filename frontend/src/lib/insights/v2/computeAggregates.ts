import type { EngOutputPoint } from '../types';
import type { PrimitiveCoverageRow, PrimitiveMissingReasons, ToolFingerprintSummary, V2OrgFallbackFacts, V2SessionPrimitiveRow, V2PreviewRow } from './types';
import { percentile, safeRatio } from './math';
import { toCanonicalPeriodKey } from '../engine/period';
import { computeV2PerformanceInsights } from './computeV2PerformanceInsights';
import { filterToCanonicalV2Rows } from './v2PreviewRowIds';

const inc = (m: PrimitiveMissingReasons, prim: string, reason: string) => {
  m[prim] = m[prim] || {};
  m[prim][reason] = (m[prim][reason] || 0) + 1;
};

export function computeFallbackFacts(
  sessionRows: V2SessionPrimitiveRow[],
  hasGhPeriods: boolean = false,
  githubByPeriod?: EngOutputPoint[],
  orgLevelMTTR?: number,
  productivityByPeriod?: any[],
  githubSnapshot?: any
): V2OrgFallbackFacts | null {
  if (!Array.isArray(sessionRows) || sessionRows.length === 0) return null;

  // 1) tool session fingerprint summary
  const byTool = new Map<string, V2SessionPrimitiveRow[]>();
  for (const r of sessionRows) {
    const t = String(r.tool || 'unknown');
    const arr = byTool.get(t) || [];
    arr.push(r);
    byTool.set(t, arr);
  }

  const toolSessionFingerprints: ToolFingerprintSummary[] = Array.from(byTool.entries())
    .map(([tool, rows]) => {
      const n = rows.length;
      const flowCounts: Record<string, number> = {};
      const focusVals: number[] = [];
      const durVals: number[] = [];
      const aiVals: number[] = [];
      for (const r of rows) {
        const fp = String(r.session_flow_profile || 'unknown');
        flowCounts[fp] = (flowCounts[fp] || 0) + 1;
        if (typeof r.session_focus_ratio === 'number') focusVals.push(r.session_focus_ratio);
        if (typeof r.session_duration_minutes === 'number') durVals.push(r.session_duration_minutes);
        if (typeof r.session_ai_chars_per_min === 'number') aiVals.push(r.session_ai_chars_per_min);
      }
      const shares: Record<string, number> = {};
      for (const k of Object.keys(flowCounts)) {
        shares[k] = n > 0 ? Math.round((flowCounts[k] / n) * 1000) / 10 : 0;
      }
      return {
        tool,
        sessions: n,
        flowProfileShares: shares,
        focusRatioP50: percentile(focusVals, 0.5),
        durationMinutesP50: percentile(durVals, 0.5),
        aiCharsPerMinP50: percentile(aiVals, 0.5),
      };
    })
    .sort((a, b) => b.sessions - a.sessions);

  // 2) org TTFC p90/p50 ratio (commit outcomes only)
  const ttfcVals = sessionRows
    .map(r => r.session_ttfc_minutes)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  const p50Ttfc = percentile(ttfcVals, 0.5);
  const p90Ttfc = percentile(ttfcVals, 0.9);
  const orgTtfcP90P50Ratio = (p50Ttfc != null && p90Ttfc != null) ? safeRatio(p90Ttfc, p50Ttfc) : null;

  // 3) org AI intensity distribution by tool (use ai_chars_per_min as current best available “intensity” proxy)
  const orgAiIntensityByTool = toolSessionFingerprints.map(t => {
    const rows = byTool.get(t.tool) || [];
    const vals = rows
      .map(r => r.session_ai_chars_per_min)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    return {
      tool: t.tool,
      p50: percentile(vals, 0.5),
      p90: percentile(vals, 0.9),
      n: vals.length,
    };
  });

  // 4) org rework/churn distribution (use rework_ratio_est)
  const reworkVals = sessionRows
    .map(r => r.session_rework_ratio_est)
    .filter((v): v is number => typeof v === 'number' && v >= 0);

  const orgReworkDistribution = {
    p50: percentile(reworkVals, 0.5),
    p90: percentile(reworkVals, 0.9),
    n: reworkVals.length,
  };

  // 5) AI kickoff timing (median first burst minutes)
  const firstBurstMinutesVals = sessionRows
    .map(r => r.session_ai_first_burst_minutes)
    .filter((v): v is number => typeof v === 'number' && v >= 0);
  const totalSessions = sessionRows.length;
  const orgAiKickoffTiming = totalSessions > 0 ? {
    p50: percentile(firstBurstMinutesVals, 0.5),
    n: firstBurstMinutesVals.length,
    coveragePct: Math.round((firstBurstMinutesVals.length / totalSessions) * 1000) / 10,
  } : null;

  // 6) AI span coverage (median span ratio)
  const spanRatioVals = sessionRows
    .map(r => r.session_ai_span_ratio)
    .filter((v): v is number => typeof v === 'number' && v >= 0 && v <= 1);
  const orgAiSpanCoverage = totalSessions > 0 ? {
    p50: percentile(spanRatioVals, 0.5),
    n: spanRatioVals.length,
    coveragePct: Math.round((spanRatioVals.length / totalSessions) * 1000) / 10,
  } : null;

  // 7) Late AI usage share (% sessions with last_burst_ratio >= 0.75)
  const lastBurstRatioVals = sessionRows
    .map(r => r.session_ai_last_burst_ratio)
    .filter((v): v is number => typeof v === 'number' && v >= 0 && v <= 1);
  const lateAiSessions = lastBurstRatioVals.filter(v => v >= 0.75).length;
  const orgLateAiUsageShare = totalSessions > 0 ? {
    share: lastBurstRatioVals.length > 0 ? Math.round((lateAiSessions / lastBurstRatioVals.length) * 1000) / 10 : 0,
    n: lastBurstRatioVals.length,
    coveragePct: Math.round((lastBurstRatioVals.length / totalSessions) * 1000) / 10,
  } : null;

  // Compute preview rows - always ensure it's an array (never undefined)
  const previewRows = computeV2PreviewRows(sessionRows, hasGhPeriods, githubByPeriod, orgLevelMTTR, githubSnapshot);
  // Guarantee: previewRows is always an array when sessionRows.length > 0
  const guaranteedPreviewRows = Array.isArray(previewRows) ? previewRows : [];
  
  // Trace: After computeV2PreviewRows in computeFallbackFacts
  // DISABLED: console.log('[PI TRACE]', 'after-computeV2PreviewRows-in-computeFallbackFacts', guaranteedPreviewRows.map(r => ({ id: r.id, demoFlag: r.demoFlag })));

  return {
    toolSessionFingerprints,
    orgTtfcP90P50Ratio,
    orgAiIntensityByTool,
    orgReworkDistribution,
    orgAiKickoffTiming,
    orgAiSpanCoverage,
    orgLateAiUsageShare,
    previewRows: guaranteedPreviewRows,
  };
}

/**
 * Compute V2 Preview Rows
 * 
 * CONTRACT:
 * - Always returns exactly 6 rows (one per canonical ID)
 * - All values are numeric (0.0 is valid)
 * - No null, undefined, or explanatory strings in preview values
 * - All fallback behavior enforced in computeV2PerformanceInsights
 */
export function computeV2PreviewRows(
  sessionRows: V2SessionPrimitiveRow[],
  hasGhPeriods: boolean,
  githubByPeriod?: EngOutputPoint[],
  orgLevelMTTR?: number,
  githubSnapshot?: any
): V2PreviewRow[] {
  // Diagnostic logging: Identify active PI pipeline
  // DISABLED: console.log('[PI ACTIVE PIPELINE]', 'computeV2PreviewRows');
  
  // Use centralized V2 computation layer
  const computedRows = computeV2PerformanceInsights(sessionRows, hasGhPeriods, githubByPeriod, orgLevelMTTR, githubSnapshot);
  
  // Step 1: Log the compute output shape (DEV only)
  if ((import.meta as any).env?.DEV) {
    const lens = (a: any) => Array.isArray(a) ? a.length : undefined
    const keys = (a: any) => Array.isArray(a) && a[0] ? Object.keys(a[0]) : undefined
    const v2 = computedRows as any
    console.log('[V2 SHADOW][COMPUTE_SHAPE]', {
      topKeys: v2 ? Object.keys(v2) : null,
      previewRowsLen: lens((v2 as any)?.previewRows),
      previewRowsKeys: keys((v2 as any)?.previewRows),
      candidateRowsLen: lens((v2 as any)?.candidateRows),
      candidateRowsKeys: keys((v2 as any)?.candidateRows),
      rowsLen: lens((v2 as any)?.rows),
      rowsKeys: keys((v2 as any)?.rows),
      allRowsLen: lens((v2 as any)?.allRows),
      allRowsKeys: keys((v2 as any)?.allRows),
      gatedRowsLen: lens((v2 as any)?.gatedRows),
      primaryLen: lens((v2 as any)?.primary),
      secondaryLen: lens((v2 as any)?.secondary),
      hiddenLen: lens((v2 as any)?.hidden),
      debugRowsLen: lens((v2 as any)?.debugRows),
      // Also check if computedRows itself is an array (most likely)
      computedRowsIsArray: Array.isArray(computedRows),
      computedRowsLen: Array.isArray(computedRows) ? computedRows.length : undefined,
      computedRowsFirstKeys: Array.isArray(computedRows) && computedRows[0] ? Object.keys(computedRows[0]) : undefined,
    })
  }
  
  // Trace: After computeV2PerformanceInsights
  // DISABLED: console.log('[PI TRACE]', 'after-computeV2PerformanceInsights', computedRows.map(r => ({ id: r.id, demoFlag: r.demoFlag })));
  
  // Filter to ensure only canonical rows (should be all 6, but enforce contract)
  const filteredRows = filterToCanonicalV2Rows(computedRows);
  
  // Safety net: Ensure all rows have demoFlag (should already be set by computeV2PerformanceInsights, but double-check)
  for (const row of filteredRows) {
    if (!row.demoFlag) {
      row.demoFlag = 'demo_secondary';
      const PI_DEBUG_ENV = (import.meta as any)?.env?.VITE_PI_DEBUG ?? 'false'
      const PI_DEBUG = PI_DEBUG_ENV === 'true' || PI_DEBUG_ENV === '1'
      if (PI_DEBUG) {
        // DISABLED: console.warn('[PI DEFAULTED demoFlag in computeV2PreviewRows]', row.id);
      }
    }
  }
  
  // Trace: After filterToCanonicalV2Rows
  // DISABLED: console.log('[PI TRACE]', 'after-filterToCanonicalV2Rows', filteredRows.map(r => ({ id: r.id, demoFlag: r.demoFlag })));
  
  return filteredRows;
}

export function computePeriodPrimitives(
  sessionRows: V2SessionPrimitiveRow[],
  githubByPeriod?: EngOutputPoint[]
): {
  coverage: PrimitiveCoverageRow[];
  reasonsMissing: PrimitiveMissingReasons;
  topCandidateSignals: Array<{ key: string; value: any }>;
} {
  const reasonsMissing: PrimitiveMissingReasons = {};

  const periodKeys = Array.from(new Set(sessionRows.map(r => r.periodKey).filter(Boolean)));
  const totalPeriods = periodKeys.length;

  // candidate signal: high-quality session share by period
  const highQualityByPeriod: Array<{ period: string; share: number; n: number }> = [];
  for (const pk of periodKeys) {
    const xs = sessionRows.filter(r => r.periodKey === pk);
    const n = xs.length;
    if (n === 0) continue;
    const good = xs.filter(r => (r.session_focus_ratio ?? 0) >= 0.65 && (r.session_rework_ratio_est ?? 1) <= 0.25).length;
    highQualityByPeriod.push({ period: pk, share: good / n, n });
  }

  // candidate signals: AI sessions without commit outcome vs missing TTFC field
  const aiNoCommit = sessionRows.filter(r => r.session_has_ai_activity && !(r as any).session_has_commit_outcome).length;
  const aiMissingTtfcField = sessionRows.filter(r => r.session_has_ai_activity && !r.session_has_ttfc).length;

  // candidate signal: tool flow profile skew (max share of a flow_profile)
  const toolSkew: Array<{ tool: string; topProfile: string; share: number; n: number }> = [];
  const byTool = new Map<string, V2SessionPrimitiveRow[]>();
  for (const r of sessionRows) {
    const t = String(r.tool || 'unknown');
    const arr = byTool.get(t) || [];
    arr.push(r);
    byTool.set(t, arr);
  }
  for (const [tool, xs] of byTool.entries()) {
    const n = xs.length;
    if (n < 10) {
      inc(reasonsMissing, 'tool_flow_profile_distribution', 'INSUFFICIENT_SAMPLES');
      continue;
    }
    const counts: Record<string, number> = {};
    for (const r of xs) {
      const k = String(r.session_flow_profile || 'unknown');
      counts[k] = (counts[k] || 0) + 1;
    }
    let topProfile = 'unknown';
    let topCount = 0;
    for (const k of Object.keys(counts)) {
      if (counts[k] > topCount) {
        topProfile = k;
        topCount = counts[k];
      }
    }
    toolSkew.push({ tool, topProfile, share: topCount / n, n });
  }

  const topCandidateSignals: Array<{ key: string; value: any }> = [
    { key: 'period_count', value: totalPeriods },
    { key: 'ai_sessions_without_commit_count', value: aiNoCommit },
    { key: 'ai_sessions_missing_ttfc_field_count', value: aiMissingTtfcField },
    { key: 'high_quality_session_share_by_period_top3', value: highQualityByPeriod.sort((a, b) => b.share - a.share).slice(0, 3) },
    { key: 'tool_flow_profile_skew_top3', value: toolSkew.sort((a, b) => b.share - a.share).slice(0, 3) },
  ];

  // Light coverage rows: these are “always computable” aggregates if sessions exist.
  const coverage: PrimitiveCoverageRow[] = [
    { primitive: 'tool_session_fingerprint_summary', level: 'org', totalRows: sessionRows.length, computableRows: sessionRows.length, coveragePct: 100 },
    { primitive: 'ttfc_field_coverage', level: 'org', totalRows: sessionRows.length, computableRows: sessionRows.filter(r => r.session_has_ttfc).length, coveragePct: sessionRows.length > 0 ? Math.round((sessionRows.filter(r => r.session_has_ttfc).length / sessionRows.length) * 1000) / 10 : 0 },
    { primitive: 'commit_outcome_rate', level: 'org', totalRows: sessionRows.length, computableRows: sessionRows.filter(r => (r as any).session_has_commit_outcome).length, coveragePct: sessionRows.length > 0 ? Math.round((sessionRows.filter(r => (r as any).session_has_commit_outcome).length / sessionRows.length) * 1000) / 10 : 0 },
    { primitive: 'org_ttfc_p90_p50_ratio', level: 'org', totalRows: sessionRows.length, computableRows: sessionRows.filter(r => (r as any).session_has_commit_outcome).length, coveragePct: sessionRows.length > 0 ? Math.round((sessionRows.filter(r => (r as any).session_has_commit_outcome).length / sessionRows.length) * 1000) / 10 : 0 },
    { primitive: 'org_ai_intensity_distribution_by_tool', level: 'org', totalRows: sessionRows.length, computableRows: sessionRows.filter(r => (r.session_ai_chars_per_min ?? 0) > 0).length, coveragePct: sessionRows.length > 0 ? Math.round((sessionRows.filter(r => (r.session_ai_chars_per_min ?? 0) > 0).length / sessionRows.length) * 1000) / 10 : 0 },
    { primitive: 'org_rework_distribution', level: 'org', totalRows: sessionRows.length, computableRows: sessionRows.filter(r => (r.session_rework_ratio_est ?? -1) >= 0).length, coveragePct: sessionRows.length > 0 ? Math.round((sessionRows.filter(r => (r.session_rework_ratio_est ?? -1) >= 0).length / sessionRows.length) * 1000) / 10 : 0 },
  ];

  // Optional: if githubByPeriod exists, provide a join-ready signal.
  if (Array.isArray(githubByPeriod) && githubByPeriod.length > 0) {
    const cfr = githubByPeriod.map(g => g.changeFailureRatePct).filter((v): v is number => typeof v === 'number' && v >= 0);
    topCandidateSignals.push({ key: 'github_periods_with_cfr', value: cfr.length });
  }

  return { coverage, reasonsMissing, topCandidateSignals };
}
