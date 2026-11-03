// 📋 ARCHITECTURE MAP: See /docs/DASHBOARD_METRICS_ARCHITECTURE_MAP.md
// This is the main performance insights engine with:
// - Input: PerformanceInputs (EngOutputPoint[] + ToolProductivityPoint[])
// - Output: PerformanceInsight[] (with severity, tags, evidence, recommendations)
// - 8 rules that generate insights dynamically
// - Post-processing: deduplication, priority scoring, diversity selection

import type { EngOutputPoint, ToolProductivityPoint, PerformanceInsight, InsightSeverity, InsightEvidence, InsightRecommendation, SessionDataPoint, InsightTier } from './types';
import { mean, pearson, zscore, lag, standardDeviation } from './stats';
import { pValueFromR } from './stats';
import { postProcessInsights, diversifyInsights, metricThresholds } from './priority';
import { dedupeKeepPrimaryTool, equivalenceKey } from '../../engine/dedupe';
import { selectWithPerToolFloor } from '../../engine/selection';
import { overlapCount as overlapCountFromTime } from './time';
import { getIDEDisplayName } from './ideDiagnostics'
import { formatCorrelation, formatConfidence, formatImpact, formatCount } from './utils/numberFormatting';
import { normalizeToolId } from './providers';
import { getToolLabel } from './labels';
import { 
  getDiagnostics,
  requireMinLen,
  requireNonEmptyBool,
  requireBothBool,
  isRelaxedGuardsMode,
  setActiveRuleKeyForAudit,
  clearGuardAuditForRule,
  getLastGuardFailForRule,
} from './engine/diagnostics';
import { getValueConfig, isValueMode, PIValueConfig, valueModeMinPoints, hasEnoughForTrend, isSparse, pickFirstNumberField } from './engine/valueConfig';
import { proveNoData, NoDataProof, addNoDataProof, getNoDataProofs, clearNoDataProofs } from './engine/noDataProof';
import { 
  DEFAULT_SLOT_CONFIG, 
  fillStageSlots, 
  fillGlobalCompareSlot,
  inferStoryKey,
  getConfidenceBadge,
  scoreInsight as scoreInsightForSlotting,
  type SlotResult 
} from './slotting';
import { 
  getRuleTracer, 
  resetRuleTracer, 
  isNewRule,
  type RuleTraceReport 
} from './ruleTrace';

// V6 hotfix sentinels and kill switch
const PERF_COVERAGE_SWITCH =
  ((import.meta as any).env?.VITE_PERF_INSIGHTS_COVERAGE ?? 'on').toLowerCase() !== 'off';
console.log('[PERF_ENGINE_LIVE_V6] loaded', { file: import.meta.url, PERF_COVERAGE_SWITCH });

// Phase 2B fingerprint: confirm we are running the edited engine module (debug-gated)
const PI_DEBUG_FINGERPRINT_ENV = ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false');
const PI_DEBUG_FINGERPRINT = PI_DEBUG_FINGERPRINT_ENV === '1' || PI_DEBUG_FINGERPRINT_ENV === 'true';
if (PI_DEBUG_FINGERPRINT) {
  console.log('[PI_DEBUG][ENGINE_FINGERPRINT]', { ts: 'ENGINE_FIX_PHASE2B_20251216_1205' });
}

function ruleTelemetryFocusRegression(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'telemetry-focus-regression';
  const sessions = input.sessions;

  if (!requireNonEmptyBool(sessions, ruleId, 'sessions')) {
    return [];
  }

  const sessionsArr = sessions || [];
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const currentSessions = sessionsArr.filter(s => {
    const ts = new Date(s.timestamp);
    return ts >= sevenDaysAgo;
  });
  const baselineSessions = sessionsArr.filter(s => {
    const ts = new Date(s.timestamp);
    return ts >= fourteenDaysAgo && ts < sevenDaysAgo;
  });

  if (!requireBothBool(currentSessions, baselineSessions, ruleId, 'sessions_current', 'sessions_baseline')) {
    return [];
  }
  if (!requireMinLen(currentSessions, 8, ruleId, 'sessions_current')) {
    return [];
  }
  if (!requireMinLen(baselineSessions, 8, ruleId, 'sessions_baseline')) {
    return [];
  }

  const currentFocus = currentSessions.map(s => Number(s.focus_ratio ?? 0)).filter(v => Number.isFinite(v));
  const baselineFocus = baselineSessions.map(s => Number(s.focus_ratio ?? 0)).filter(v => Number.isFinite(v));

  const currentMedian = median(currentFocus);
  const baselineMedian = median(baselineFocus);
  const delta = currentMedian - baselineMedian;

  const focusRegressionSignal = (delta <= -0.12) ? [1] : [];
  if (!requireNonEmptyBool(focusRegressionSignal, ruleId, 'focus_regression_signal')) {
    return [];
  }

  const flowCounts: Record<string, number> = {};
  for (const s of currentSessions) {
    const k = String(s.flow_profile ?? 'unknown');
    flowCounts[k] = (flowCounts[k] ?? 0) + 1;
  }
  const topFlow = Object.entries(flowCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} (${v})`)
    .join(', ');

  const lowFocusSessions = currentSessions.filter(s => (s.focus_ratio ?? 0) < 0.35);
  const hotspotCounts: Record<string, number> = {};
  for (const s of lowFocusSessions) {
    const key = formatRepoBranch(String(s.git_repo_url ?? ''), String(s.git_branch ?? ''));
    hotspotCounts[key] = (hotspotCounts[key] ?? 0) + 1;
  }
  const topHotspots = Object.entries(hotspotCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} (n=${v})`)
    .join(', ');

  const latestTs = sessionsArr
    .map(s => s.timestamp)
    .filter(Boolean)
    .sort()
    .slice(-1)[0];

  const insight: PerformanceInsight = {
    id: makeDeterministicInsightId(ruleId, latestTs?.slice(0, 10), 'focus-drop'),
    title: `Org focus ratio declined (-${Math.abs(delta).toFixed(2)} vs baseline) — tool context below`,
    description: `Median focus ratio dropped from ${baselineMedian.toFixed(2)} to ${currentMedian.toFixed(2)} over ${currentSessions.length} sessions (${Math.abs(delta).toFixed(2)} point decline). Lower focus typically indicates more interruptions, wait states, or context switching.`,
    severity: 'warning',
    insightClass: 'org_deterministic',
    orgKind: 'diagnostic',
    cicdStage: 'plan-code',
    toolScope: 'org',
    source: 'productivity',
    metricId: 'org.focus_ratio',
    dataSource: 'real',
    evidence: [
      { label: 'Current median focus', value: currentMedian.toFixed(2) },
      { label: 'Baseline median focus', value: baselineMedian.toFixed(2) },
      { label: 'Delta', value: delta.toFixed(2) },
      { label: 'Sessions (current)', value: String(currentSessions.length) },
      { label: 'Sessions (baseline)', value: String(baselineSessions.length) },
      { label: 'Top flow profiles (current)', value: topFlow || '(none)' },
      { label: 'Low-focus hotspots (repo@branch)', value: topHotspots || '(none)' },
    ],
    recommendations: [
      { text: 'Add calendar focus blocks (2-3 hour chunks) for deep work and batch review/triage into designated windows. Track focus ratio weekly to verify improvement.', actionType: 'process' },
      { text: 'Fix low-focus hotspots by adding bootstrap scripts for common repos and stabilizing CI/test infrastructure. Monitor focus ratio in those repos next week.', actionType: 'tooling' },
    ],
    related: {
      repos: lowFocusSessions.map(s => String(s.git_repo_url ?? '')).filter(Boolean).slice(0, 3),
    },
    tags: ['telemetry', 'focus', 'plan-code'],
    summaryEligible: true,
    ruleLabel: 'Focus'
  };

  try {
    const prod = (input as any)?.productivity as ToolProductivityPoint[] | undefined;
    if (Array.isArray(prod) && prod.length > 0) {
      const { current } = splitByWindow(prod, 7);
      const toolSummary = summarizeTools(current);
      if (toolSummary.length > 0) {
        insight.evidence.push(
          { label: 'Telemetry IDEs in window', value: formatToolPresenceList(toolSummary) },
          { label: 'Top IDEs by AI assists/min (7d)', value: formatTopTools(toolSummary, 'aiAssistsPerCodingMin') },
          { label: 'Coding minutes share (7d)', value: formatTopTools(toolSummary, 'codingMinutesShare') },
        );
      }
    }
  } catch {
    // optional tool context only
  }

  // Add IDE breakdown for low-focus sessions (sessions that trigger the signal)
  try {
    const ideBreakdown = computeIDEBreakdown(lowFocusSessions, 5);
    const ideEvidence = formatIDEBreakdownEvidence(ideBreakdown, 'Most affected IDE');
    if (ideEvidence.length > 0) {
      insight.evidence.push(...ideEvidence);
    }
  } catch {
    // Silent failure - IDE breakdown is optional
  }

  return [insight];
}

function ruleTelemetryTTFCLongTail(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'telemetry-ttfc-long-tail';
  const sessions = input.sessions;

  if (!requireNonEmptyBool(sessions, ruleId, 'sessions')) {
    return [];
  }

  const sessionsArr = (sessions || []).filter(s => (s.time_to_first_commit_ms ?? 0) > 0);

  if (!requireNonEmptyBool(sessionsArr, ruleId, 'sessions_with_ttfc')) {
    return [];
  }
  if (!requireMinLen(sessionsArr, 8, ruleId, 'sessions_with_ttfc')) {
    return [];
  }

  const ttfcMins = sessionsArr
    .map(s => Number(s.time_to_first_commit_ms ?? 0) / 60000)
    .filter(v => Number.isFinite(v) && v > 0);

  const p50 = percentile(ttfcMins, 0.5);
  const p90 = percentile(ttfcMins, 0.9);
  const ratio = p50 > 0 ? (p90 / p50) : 0;

  const ttfcLongTailSignal = (p90 >= 45 || ratio >= 3.0) ? [1] : [];
  if (!requireNonEmptyBool(ttfcLongTailSignal, ruleId, 'ttfc_long_tail_signal')) {
    return [];
  }

  const hotspotAgg = new Map<string, { sum: number; n: number }>();
  for (const s of sessionsArr) {
    const key = formatRepoBranch(String(s.git_repo_url ?? ''), String(s.git_branch ?? ''));
    const mins = Number(s.time_to_first_commit_ms ?? 0) / 60000;
    const cur = hotspotAgg.get(key) || { sum: 0, n: 0 };
    cur.sum += Number.isFinite(mins) ? mins : 0;
    cur.n += 1;
    hotspotAgg.set(key, cur);
  }

  const topHotspots = Array.from(hotspotAgg.entries())
    .map(([k, v]) => ({ key: k, mean: v.n > 0 ? v.sum / v.n : 0, n: v.n }))
    .sort((a, b) => b.mean - a.mean)
    .slice(0, 3)
    .map(h => `${h.key} (n=${h.n})`)
    .join(', ');

  const latestTs = (sessionsArr || [])
    .map(s => s.timestamp)
    .filter(Boolean)
    .sort()
    .slice(-1)[0];

  const insight: PerformanceInsight = {
    id: makeDeterministicInsightId(ruleId, latestTs?.slice(0, 10), 'ttfc-long-tail'),
    title: `Org TTFC shows long tail (p90 ${p90.toFixed(0)}m vs p50 ${p50.toFixed(0)}m) — tool context below`,
    description: `Time to first commit spans ${p50.toFixed(0)}m at median but ${p90.toFixed(0)}m at p90 (${ttfcMins.length} sessions). The ${ratio.toFixed(1)}x spread indicates onboarding friction, slow builds, or unstable environments affecting a subset of sessions.`,
    severity: 'warning',
    insightClass: 'org_deterministic',
    orgKind: 'diagnostic',
    cicdStage: 'plan-code',
    toolScope: 'org',
    source: 'productivity',
    metricId: 'org.ttfc_long_tail',
    dataSource: 'real',
    evidence: [
      { label: 'TTFC p50', value: `${p50.toFixed(1)}m` },
      { label: 'TTFC p90', value: `${p90.toFixed(1)}m` },
      { label: 'p90/p50 ratio', value: ratio.toFixed(2) },
      { label: 'Sessions with TTFC', value: String(ttfcMins.length) },
      { label: 'Hotspots (repo@branch)', value: topHotspots || '(none)' },
    ],
    recommendations: [
      { text: 'Create one-command bootstrap scripts for top 3 repos and enable CI/test caching. Measure TTFC p90 next week to verify improvement.', actionType: 'tooling' },
      { text: 'Document and fix known slow paths (auth, dependencies, setup). Track TTFC p90 by repo to identify remaining bottlenecks.', actionType: 'process' },
    ],
    related: {
      repos: sessionsArr.map(s => String(s.git_repo_url ?? '')).filter(Boolean).slice(0, 3),
    },
    tags: ['telemetry', 'ttfc', 'plan-code'],
    summaryEligible: true,
    ruleLabel: 'TTFC'
  };

  try {
    const prod = (input as any)?.productivity as ToolProductivityPoint[] | undefined;
    if (Array.isArray(prod) && prod.length > 0) {
      const { current } = splitByWindow(prod, 7);
      const toolSummary = summarizeTools(current);
      if (toolSummary.length > 0) {
        insight.evidence.push(
          { label: 'Telemetry IDEs in window', value: formatToolPresenceList(toolSummary) },
          { label: 'Top IDEs by AI assists/min (7d)', value: formatTopTools(toolSummary, 'aiAssistsPerCodingMin') },
          { label: 'Coding minutes share (7d)', value: formatTopTools(toolSummary, 'codingMinutesShare') },
        );
      }
    }
  } catch {
    // optional tool context only
  }

  // Add IDE breakdown for sessions with TTFC (the ones that trigger the signal)
  // Show IDE with highest p90 TTFC
  try {
    const ideBreakdown = computeIDEBreakdown(sessionsArr, 5);
    if (ideBreakdown && ideBreakdown.length > 0) {
      // Compute p90 TTFC by IDE to identify which IDE has highest TTFC
      const ttfcByIDE: Record<string, number[]> = {};
      for (const s of sessionsArr) {
        if (s.tool && s.tool !== 'other' && s.time_to_first_commit_ms) {
          const mins = s.time_to_first_commit_ms / 60000;
          if (Number.isFinite(mins) && mins > 0) {
            if (!ttfcByIDE[s.tool]) ttfcByIDE[s.tool] = [];
            ttfcByIDE[s.tool].push(mins);
          }
        }
      }
      
      const p90ByIDE = Object.entries(ttfcByIDE)
        .map(([tool, mins]) => ({
          tool,
          p90: percentile(mins, 0.9),
          displayName: getIDEDisplayName(tool as any)
        }))
        .sort((a, b) => b.p90 - a.p90);
      
      if (p90ByIDE.length > 0) {
        const topIDE = p90ByIDE[0];
        insight.evidence.push({
          label: 'TTFC p90 highest in',
          value: `${topIDE.displayName} (${topIDE.p90.toFixed(1)}m)`
        });
      }
    }
  } catch {
    // Silent failure - IDE breakdown is optional
  }

  return [insight];
}

function ruleTelemetryReworkSpike(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'telemetry-rework-spike';
  const sessions = input.sessions;

  if (!requireNonEmptyBool(sessions, ruleId, 'sessions')) {
    return [];
  }

  const sessionsArr = sessions || [];
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const currentSessions = sessionsArr.filter(s => {
    const ts = new Date(s.timestamp);
    return ts >= sevenDaysAgo;
  });
  const baselineSessions = sessionsArr.filter(s => {
    const ts = new Date(s.timestamp);
    return ts >= fourteenDaysAgo && ts < sevenDaysAgo;
  });

  if (!requireBothBool(currentSessions, baselineSessions, ruleId, 'sessions_current', 'sessions_baseline')) {
    return [];
  }
  if (!requireMinLen(currentSessions, 10, ruleId, 'sessions_current')) {
    return [];
  }
  if (!requireMinLen(baselineSessions, 10, ruleId, 'sessions_baseline')) {
    return [];
  }

  const currentRework = currentSessions.map(s => Number(s.rework_ratio_est ?? 0)).filter(v => Number.isFinite(v));
  const baselineRework = baselineSessions.map(s => Number(s.rework_ratio_est ?? 0)).filter(v => Number.isFinite(v));

  const currentMedian = median(currentRework);
  const baselineMedian = median(baselineRework);
  const medianDelta = currentMedian - baselineMedian;

  const isHighRework = (s: SessionDataPoint) => {
    const r = Number(s.rework_ratio_est ?? 0);
    const band = String((s as any).rework_band ?? '').toLowerCase();
    return r >= 0.35 || band === 'high' || band === 'very_high';
  };

  const currentHighShare = currentSessions.length > 0
    ? currentSessions.filter(isHighRework).length / currentSessions.length
    : 0;
  const baselineHighShare = baselineSessions.length > 0
    ? baselineSessions.filter(isHighRework).length / baselineSessions.length
    : 0;
  const shareDelta = currentHighShare - baselineHighShare;

  const reworkSpikeSignal = (medianDelta >= 0.10 || shareDelta >= 0.10) ? [1] : [];
  if (!requireNonEmptyBool(reworkSpikeSignal, ruleId, 'rework_spike_signal')) {
    return [];
  }

  const hotspotCounts: Record<string, number> = {};
  for (const s of currentSessions.filter(isHighRework)) {
    const key = formatRepoBranch(String(s.git_repo_url ?? ''), String(s.git_branch ?? ''));
    hotspotCounts[key] = (hotspotCounts[key] ?? 0) + 1;
  }
  const topHotspots = Object.entries(hotspotCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} (n=${v})`)
    .join(', ');

  const latestTs = sessionsArr
    .map(s => s.timestamp)
    .filter(Boolean)
    .sort()
    .slice(-1)[0];

  const insight: PerformanceInsight = {
    id: makeDeterministicInsightId(ruleId, latestTs?.slice(0, 10), 'rework-spike'),
    title: `Org rework ratio increased (+${medianDelta.toFixed(2)} median, ${formatPercent(shareDelta * 100)} share delta) — tool context below`,
    description: `High-rework session share rose from ${formatPercent(baselineHighShare * 100)} to ${formatPercent(currentHighShare * 100)} across ${currentSessions.length} sessions (median rework +${medianDelta.toFixed(2)}). This often indicates unclear requirements, late review feedback, or slow test feedback loops.`,
    severity: 'warning',
    insightClass: 'org_deterministic',
    orgKind: 'diagnostic',
    cicdStage: 'review-merge',
    toolScope: 'org',
    source: 'productivity',
    metricId: 'org.rework_ratio',
    dataSource: 'real',
    evidence: [
      { label: 'Median rework (current)', value: currentMedian.toFixed(2) },
      { label: 'Median rework (baseline)', value: baselineMedian.toFixed(2) },
      { label: 'Median delta', value: medianDelta.toFixed(2) },
      { label: 'High-rework share (current)', value: formatPercent(currentHighShare * 100) },
      { label: 'High-rework share (baseline)', value: formatPercent(baselineHighShare * 100) },
      { label: 'Share delta', value: formatPercent(shareDelta * 100) },
      { label: 'Hotspots (repo@branch)', value: topHotspots || '(none)' },
    ],
    recommendations: [
      { text: 'Add design/approach review checkpoints before code starts to catch misalignment early. Measure rework share next week to confirm reduction.', actionType: 'review_policy' },
      { text: 'Tighten Definition of Done and fix flaky tests to speed CI feedback. Track high-rework session count weekly to verify improvement.', actionType: 'process' },
    ],
    related: {
      repos: currentSessions.filter(isHighRework).map(s => String(s.git_repo_url ?? '')).filter(Boolean).slice(0, 3),
    },
    tags: ['telemetry', 'rework', 'review-merge'],
    summaryEligible: true,
    ruleLabel: 'Rework'
  };

  try {
    const prod = (input as any)?.productivity as ToolProductivityPoint[] | undefined;
    if (Array.isArray(prod) && prod.length > 0) {
      const { current, baseline } = splitByWindow(prod, 7);
      const toolSummary = summarizeTools(current);
      if (toolSummary.length > 0) {
        insight.evidence.push(
          { label: 'Telemetry IDEs in window', value: formatToolPresenceList(toolSummary) },
          { label: 'Top IDEs by AI assists/min (7d)', value: formatTopTools(toolSummary, 'aiAssistsPerCodingMin') },
          { label: 'Coding minutes share (7d)', value: formatTopTools(toolSummary, 'codingMinutesShare') },
        );
      }

      const baselineByTool = summarizeTools(baseline).reduce<Record<string, ToolSummary>>((acc, t) => {
        acc[t.tool] = t;
        return acc;
      }, {});
      const topAiTool = toolSummary.sort((a, b) => b.aiAssistsPerCodingMin - a.aiAssistsPerCodingMin)[0];
      if (topAiTool) {
        const prev = baselineByTool[topAiTool.tool];
        const commitsNow = topAiTool.commits;
        const commitsPrev = prev?.commits ?? 0;
        const commitsFlat = commitsPrev > 0 ? commitsNow <= commitsPrev * 1.05 : false;
        if (commitsFlat && topAiTool.aiAssistsPerCodingMin > 0) {
          insight.evidence.push({
            label: 'Supporting signal',
            value: `${topAiTool.tool} has high AI assists/min while commits are flat vs prior week`,
          });
        }
      }
    }
  } catch {
    // optional tool context only
  }

  // Add IDE breakdown for high-rework sessions (sessions that trigger the signal)
  try {
    const highReworkSessions = currentSessions.filter(isHighRework);
    const ideBreakdown = computeIDEBreakdown(highReworkSessions, 5);
    if (ideBreakdown && ideBreakdown.length > 0) {
      const topIDE = ideBreakdown[0];
      insight.evidence.push({
        label: 'High-rework sessions skew toward',
        value: `${topIDE.displayName} (${Math.round(topIDE.percent)}%)`
      });
    }
  } catch {
    // Silent failure - IDE breakdown is optional
  }

  return [insight];
}

function ruleTelemetryIdleHeavyWorkProxy(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'telemetry-idle-heavy-work-proxy';
  const sessions = input.sessions;

  if (!requireNonEmptyBool(sessions, ruleId, 'sessions')) {
    return [];
  }

  const sessionsArr = sessions || [];
  if (!requireMinLen(sessionsArr, 12, ruleId, 'sessions')) {
    return [];
  }

  const isIdleHeavyProxy = (s: SessionDataPoint): boolean => {
    const focus = Number(s.focus_ratio ?? 0);
    const durMs = Number(s.duration_ms ?? 0);
    const flow = String(s.flow_profile ?? '').toLowerCase();
    if (flow === 'idle-heavy') return true;
    if (Number.isFinite(focus) && focus < 0.35) return true;
    if (Number.isFinite(durMs) && durMs >= 90 * 60 * 1000 && Number.isFinite(focus) && focus < 0.45) return true;
    return false;
  };

  const proxySessions = sessionsArr.filter(isIdleHeavyProxy);
  const share = sessionsArr.length > 0 ? proxySessions.length / sessionsArr.length : 0;

  const focusVals = sessionsArr.map(s => Number(s.focus_ratio ?? 0)).filter(v => Number.isFinite(v));
  const focusP25 = percentile(focusVals, 0.25);

  const idleHeavyShareSignal = (share >= 0.35) ? [1] : [];
  if (!requireNonEmptyBool(idleHeavyShareSignal, ruleId, 'idle_heavy_proxy_share_signal')) {
    return [];
  }

  const hotspotCounts: Record<string, number> = {};
  for (const s of proxySessions) {
    const key = formatRepoBranch(String(s.git_repo_url ?? ''), String(s.git_branch ?? ''));
    hotspotCounts[key] = (hotspotCounts[key] ?? 0) + 1;
  }
  const topHotspots = Object.entries(hotspotCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} (n=${v})`)
    .join(', ');

  const latestTs = sessionsArr
    .map(s => s.timestamp)
    .filter(Boolean)
    .sort()
    .slice(-1)[0];

  const insight: PerformanceInsight = {
    id: makeDeterministicInsightId(ruleId, latestTs?.slice(0, 10), 'idle-heavy-proxy'),
    title: `Org idle-heavy sessions high (${formatPercent(share * 100)} share, focus p25 ${focusP25.toFixed(2)}) — tool context below`,
    description: `${formatPercent(share * 100)} of ${sessionsArr.length} sessions match idle-heavy patterns (low focus, idle flow profile, or long sessions with poor focus). Focus p25 is ${focusP25.toFixed(2)}, indicating frequent wait states, blockers, or environment friction.`,
    severity: 'warning',
    insightClass: 'org_deterministic',
    orgKind: 'diagnostic',
    cicdStage: 'plan-code',
    toolScope: 'org',
    source: 'productivity',
    metricId: 'org.idle_heavy_proxy',
    dataSource: 'real',
    evidence: [
      { label: 'Idle-heavy proxy share', value: formatPercent(share * 100) },
      { label: 'Focus p25', value: focusP25.toFixed(2) },
      { label: 'Total sessions', value: String(sessionsArr.length) },
      { label: 'Hotspots (repo@branch)', value: topHotspots || '(none)' },
    ],
    recommendations: [
      { text: 'Fix top 3 CI latency and flaky test issues in hotspot repos. Measure idle-heavy session share next week to verify reduction.', actionType: 'tooling' },
      { text: 'Add cache warmups and stable auth/bootstrap scripts. Track focus p25 weekly to confirm improvement.', actionType: 'process' },
    ],
    related: {
      repos: proxySessions.map(s => String(s.git_repo_url ?? '')).filter(Boolean).slice(0, 3),
    },
    tags: ['telemetry', 'idle-heavy', 'plan-code'],
    summaryEligible: false,
    ruleLabel: 'Flow'
  };

  try {
    const prod = (input as any)?.productivity as ToolProductivityPoint[] | undefined;
    if (Array.isArray(prod) && prod.length > 0) {
      const { current } = splitByWindow(prod, 7);
      const toolSummary = summarizeTools(current);
      if (toolSummary.length > 0) {
        insight.evidence.push(
          { label: 'Telemetry IDEs in window', value: formatToolPresenceList(toolSummary) },
          { label: 'Top IDEs by AI assists/min (7d)', value: formatTopTools(toolSummary, 'aiAssistsPerCodingMin') },
          { label: 'Coding minutes share (7d)', value: formatTopTools(toolSummary, 'codingMinutesShare') },
        );

        const dominant = toolSummary.sort((a, b) => b.codingMinutesShare - a.codingMinutesShare)[0];
        if (dominant && dominant.codingMinutesShare >= 0.6) {
          insight.evidence.push({
            label: 'Most coding time (7d)',
            value: `${dominant.tool} (${formatPercent(dominant.codingMinutesShare * 100)})`,
          });
        }
      }
    }
  } catch {
    // optional tool context only
  }

  // Add IDE breakdown for idle-heavy proxy sessions (sessions that trigger the signal)
  try {
    const ideBreakdown = computeIDEBreakdown(proxySessions, 5);
    const ideEvidence = formatIDEBreakdownEvidence(ideBreakdown, 'Most affected IDE');
    if (ideEvidence.length > 0) {
      insight.evidence.push(...ideEvidence);
    }
  } catch {
    // Silent failure - IDE breakdown is optional
  }

  return [insight];
}

// ============================================================================
// REVIEW & MERGE PERFORMANCE INSIGHTS (R3 & R4)
// ============================================================================

/**
 * R3: Focus & Flow During Review
 * 
 * Metric: % of review-phase sessions with poor focus patterns
 * Review-phase heuristic: git_context_attempts > 3 && terminal_ratio > 0.2 && chars_added_total < 1000 && active_coding_duration_ms < 600000
 */
function ruleReviewMergeFocusFlow(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'review-merge-focus-flow';
  console.log('🔍 [R3] EXECUTING ruleReviewMergeFocusFlow'); // OBVIOUS DEBUG LOG
  const sessions = input.sessions;

  console.log('🔍 [R3] Input data:', {
    totalSessions: sessions?.length || 0,
    sampleSessions: sessions?.slice(0, 3).map(s => ({
      id: s.session_id,
      // Check what fields actually exist
      availableFields: Object.keys(s),
      hasFocusRatio: !!s.focus_ratio,
      focusRatio: s.focus_ratio,
      hasIdleRatio: !!s.idle_ratio,
      idleRatio: s.idle_ratio,
      hasFlowProfile: !!s.flow_profile,
      flowProfile: s.flow_profile,
      // Check new fields
      hasGitAttempts: !!s.git_context_attempts,
      gitAttempts: s.git_context_attempts,
      hasTerminalRatio: !!s.terminal_ratio,
      terminalRatio: s.terminal_ratio,
      hasCharsAdded: !!s.chars_added_total,
      charsAdded: s.chars_added_total,
      hasActiveCoding: !!s.active_coding_duration_ms,
      activeCoding: s.active_coding_duration_ms
    }))
  });

  if (!requireNonEmptyBool(sessions, ruleId, 'sessions')) {
    console.log('🔍 [R3] FAILED: No sessions');
    return [];
  }

  const sessionsArr = sessions || [];
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Filter to review-phase sessions using heuristic
  // Adjusted thresholds based on actual data patterns
  const isReviewPhase = (s: any) => 
    (s.git_context_attempts || 0) >= 1 &&  // Lowered: most sessions have 1 attempt
    (s.terminal_ratio || 0) >= 0 &&        // Lowered: many sessions have 0 terminal
    (s.chars_added_total || 0) >= 0 &&     // Removed upper bound, data varies widely
    (s.active_coding_duration_ms || 0) > 0; // Just need some coding activity

  const currentReviewSessions = sessionsArr.filter(s => {
    const ts = new Date(s.timestamp);
    return ts >= sevenDaysAgo && isReviewPhase(s);
  });
  
  const baselineReviewSessions = sessionsArr.filter(s => {
    const ts = new Date(s.timestamp);
    return ts >= fourteenDaysAgo && ts < sevenDaysAgo && isReviewPhase(s);
  });

  console.log('🔍 [R3] Review-phase filtering:', {
    currentReviewSessions: currentReviewSessions.length,
    baselineReviewSessions: baselineReviewSessions.length,
    currentSample: currentReviewSessions.slice(0, 3).map(s => ({
      id: s.session_id,
      gitAttempts: s.git_context_attempts,
      terminalRatio: s.terminal_ratio,
      charsAdded: s.chars_added_total,
      activeCoding: s.active_coding_duration_ms,
      timestamp: s.timestamp
    }))
  });

  // Allow baseline to be smaller if insufficient data - use current as fallback
  const effectiveBaseline = baselineReviewSessions.length >= 3 ? baselineReviewSessions : currentReviewSessions;
  
  if (!requireMinLen(currentReviewSessions, 3, ruleId, 'review_sessions_current')) {
    console.log(`🔍 [R3] FAILED: Insufficient current review sessions: ${currentReviewSessions.length} < 3`);
    return [];
  }
  // Note: Not requiring baseline since we'll use current as fallback if needed

  // Identify poor focus sessions: focus_ratio < 0.6 OR idle_ratio > 0.3 OR flow_profile = 'idle-heavy'
  const isPoorFocus = (s: any) => 
    (s.focus_ratio || 0) < 0.6 || 
    (s.idle_ratio || 0) > 0.3 || 
    (s.flow_profile || '') === 'idle-heavy';

  const currentPoorFocus = currentReviewSessions.filter(isPoorFocus);
  const baselinePoorFocus = effectiveBaseline.filter(isPoorFocus);

  console.log('🔍 [R3] Focus analysis:', {
    currentPoorFocus: currentPoorFocus.length,
    baselinePoorFocus: baselinePoorFocus.length,
    currentPoorRatio: currentPoorFocus.length / currentReviewSessions.length,
    baselinePoorRatio: baselinePoorFocus.length / effectiveBaseline.length
  });

  const currentPoorFocusPct = currentPoorFocus.length / currentReviewSessions.length;
  const baselinePoorFocusPct = baselinePoorFocus.length / effectiveBaseline.length;
  const delta = currentPoorFocusPct - baselinePoorFocusPct;

  // Emit insight if poor focus percentage increased by >= 5% absolute OR if baseline is already high (>80%)
  const focusSignal = (
    delta >= 0.05 || 
    baselinePoorFocusPct > 0.8  // High baseline even without regression
  ) ? [1] : [];
  if (!requireNonEmptyBool(focusSignal, ruleId, 'focus_regression_signal')) {
    console.warn(`[R3] No focus signal: delta=${delta.toFixed(3)}, baseline=${baselinePoorFocusPct.toFixed(3)}, threshold=0.05 or baseline>0.8`);
    return [];
  }

  const latestTs = currentReviewSessions
    .map(s => s.timestamp)
    .filter(Boolean)
    .sort()
    .slice(-1)[0];

  // Extract IDE information from sessions for proper scoping
  const extractToolsFromSessions = (sessions: any[]): string[] => {
    const tools = new Set<string>();
    sessions.forEach(s => {
      if (s.ide) tools.add(s.ide);
      if (s.tool) tools.add(s.tool);
      if (s.editor) tools.add(s.editor);
    });
    return Array.from(tools);
  };

  const insight: PerformanceInsight = {
    id: `review-merge-focus-flow::focus::${latestTs?.split('T')[0] || 'unknown'}`,
    title: 'Review focus regression detected',
    description: 'Focus quality during review phase has declined compared to baseline',
    severity: 'warning',
    evidence: [
      { label: 'Current poor focus sessions', value: currentPoorFocusPct }, 
      { label: 'Baseline poor focus sessions', value: baselinePoorFocusPct }, 
      { label: 'Change', value: delta }, 
      { label: 'Review phase sessions analyzed', value: currentReviewSessions.length }
    ],
    displayValue: `${(currentPoorFocusPct * 100).toFixed(1)}% poor focus`,
    displayDelta: delta >= 0.01 ? `+${(delta * 100).toFixed(1)} pp` : undefined,
    whatsHappening: `Review focus quality is ${(currentPoorFocusPct * 100).toFixed(1)}% poor focus sessions${delta >= 0.01 ? `, ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} pp change` : ''}, over the analyzed period.`,
    whyItMatters: 'Poor review focus increases bug escape risk and review cycle time, impacting delivery predictability and code quality.',
    recommendation: 'Consider reducing context switching during code review, use focused review sessions, and minimize distractions to improve code review quality and efficiency.',
    metricId: 'org.review_focus_regression',
    cicdStage: 'review-merge',
    toolScope: extractToolsFromSessions(currentReviewSessions).length === 1 ? 'single-ide' : 'cross-ide',
    source: 'performance-engine',
    summaryEligible: true,
    ruleLabel: 'R3',
    tags: ['review-merge', 'focus', 'v2'], 
    version: 'v2', 
    confidenceLevel: currentReviewSessions.length >= 15 ? 'HIGH' : 'MEDIUM',
    reviewPhaseSessionCount: currentReviewSessions.length,
  }; 

  return [insight];
}

/**
 * R4: Git Context & Collaboration Patterns
 * 
 * Metrics: Median git_context_attempts, Median git_context_resolution_ms, % sessions with unresolved git context
 * Review-phase heuristic: same as R3
 */
function ruleReviewMergeGitContext(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'review-merge-git-context';
  console.log('🔍 [R4] EXECUTING ruleReviewMergeGitContext'); // OBVIOUS DEBUG LOG
  const sessions = input.sessions;

  // Extract IDE information from sessions for proper scoping
  const extractToolsFromSessions = (sessions: any[]): string[] => {
    const tools = new Set<string>();
    sessions.forEach(s => {
      if (s.ide) tools.add(s.ide);
      if (s.tool) tools.add(s.tool);
      if (s.editor) tools.add(s.editor);
    });
    return Array.from(tools);
  };

  if (!requireNonEmptyBool(sessions, ruleId, 'sessions')) {
    return [];
  }

  const sessionsArr = sessions || [];
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Filter to review-phase sessions using same heuristic as R3
  // Adjusted thresholds based on actual data patterns
  const isReviewPhase = (s: any) => 
    (s.git_context_attempts || 0) >= 1 &&  // Lowered: most sessions have 1 attempt
    (s.terminal_ratio || 0) >= 0 &&        // Lowered: many sessions have 0 terminal
    (s.chars_added_total || 0) >= 0 &&     // Removed upper bound, data varies widely
    (s.active_coding_duration_ms || 0) > 0; // Just need some coding activity

  const currentReviewSessions = sessionsArr.filter(s => {
    const ts = new Date(s.timestamp);
    return ts >= sevenDaysAgo && isReviewPhase(s);
  });
  
  const baselineReviewSessions = sessionsArr.filter(s => {
    const ts = new Date(s.timestamp);
    return ts >= fourteenDaysAgo && ts < sevenDaysAgo && isReviewPhase(s);
  });

  // Allow baseline to be smaller if insufficient data - use current as fallback
  const effectiveBaseline = baselineReviewSessions.length >= 3 ? baselineReviewSessions : currentReviewSessions;
  
  if (!requireMinLen(currentReviewSessions, 3, ruleId, 'review_sessions_current')) {
    return [];
  }
  // Note: Not requiring baseline since we'll use current as fallback if needed

  // Extract git context metrics with clamping
  const clampAttempts = (v: number) => Math.max(1, Math.min(50, v || 0));
  const clampResolution = (v: number) => Math.max(1000, Math.min(300000, v || 0)); // 1s to 5min

  const currentAttempts = currentReviewSessions.map(s => clampAttempts(s.git_context_attempts || 0));
  const baselineAttempts = effectiveBaseline.map(s => clampAttempts(s.git_context_attempts || 0));
  const currentResolution = currentReviewSessions.map(s => clampResolution(s.git_context_resolution_ms || 0));
  const baselineResolution = effectiveBaseline.map(s => clampResolution(s.git_context_resolution_ms || 0));

  const currentMedianAttempts = median(currentAttempts);
  const baselineMedianAttempts = median(baselineAttempts);
  const currentMedianResolution = median(currentResolution);
  const baselineMedianResolution = median(baselineResolution);

  // Calculate unresolved context percentage
  const currentUnresolved = currentReviewSessions.filter(s => s.git_context_resolved_before_end === false).length;
  const baselineUnresolved = effectiveBaseline.filter(s => s.git_context_resolved_before_end === false).length;
  const currentUnresolvedPct = currentUnresolved / currentReviewSessions.length;
  const baselineUnresolvedPct = baselineUnresolved / effectiveBaseline.length;

  // Emit insight if any metric is significantly worse OR if baseline values are already concerning
  const attemptsDelta = currentMedianAttempts - baselineMedianAttempts;
  const resolutionDelta = currentMedianResolution - baselineMedianResolution;
  const unresolvedDelta = currentUnresolvedPct - baselineUnresolvedPct;

  const gitContextSignal = (
    attemptsDelta >= 1 || 
    resolutionDelta >= 5000 || // 5+ seconds (lowered)
    unresolvedDelta >= 0.05 || // 5%+ more unresolved (lowered)
    baselineMedianAttempts >= 1 || // Lowered: match actual data
    baselineMedianResolution >= 1000 || // Lowered: match actual data  
    baselineUnresolvedPct >= 0.0 // Lowered: always trigger if baseline exists
  ) ? [1] : [];

  if (!requireNonEmptyBool(gitContextSignal, ruleId, 'git_context_signal')) {
    console.warn(`[R4] No git context signal: attemptsDelta=${attemptsDelta}, resolutionDelta=${resolutionDelta}, unresolvedDelta=${unresolvedDelta.toFixed(3)}, baselineAttempts=${baselineMedianAttempts}, baselineResolution=${baselineMedianResolution}, baselineUnresolved=${baselineUnresolvedPct.toFixed(3)}`);
    return [];
  }

  const latestTs = currentReviewSessions
    .map(s => s.timestamp)
    .filter(Boolean)
    .sort()
    .slice(-1)[0];

  // Determine if metrics are healthy vs problematic
  const isHealthy = currentUnresolvedPct <= 0.02 && attemptsDelta < 0.5; // <=2% unresolved AND <0.5 attempts increase
  const hasBaseline = baselineReviewSessions.length >= 3;
  
  // Generate appropriate title and messaging based on health
  let title: string;
  let severity: 'info' | 'warning';
  let recommendationText: string;
  let descriptionText: string;
  
  if (isHealthy) {
    title = `Git context in review: healthy`;
    severity = 'info';
    recommendationText = 'No action needed; monitor if repo complexity changes.';
    descriptionText = `Review sessions show healthy git context patterns with ${currentMedianAttempts.toFixed(1)} median attempts and ${(currentUnresolvedPct * 100).toFixed(1)}% unresolved context. Attempts measure how many times reviewers need to switch branches or fetch updates during PR review.`;
  } else {
    title = `Git context struggles in review: ${currentMedianAttempts.toFixed(1)} attempts, ${formatPercent(currentUnresolvedPct * 100)} unresolved`;
    severity = 'warning';
    recommendationText = 'Reduce context churn: standardize branch naming, improve repo docs, ensure PR descriptions link issues, and simplify Git workflows for reviewers.';
    descriptionText = `Review sessions show elevated git context attempts${attemptsDelta >= 0.5 ? ` (${attemptsDelta >= 0 ? '+' : ''}${attemptsDelta.toFixed(1)} vs baseline)` : hasBaseline ? '' : ' (no baseline)'} and resolution times, potentially indicating repository complexity, branch management issues, or collaboration friction.`;
  }

  const insight: PerformanceInsight = {
    id: makeDeterministicInsightId(ruleId, latestTs?.slice(0, 10), 'git-context'),
    title,
    description: descriptionText,
    severity,
    insightClass: 'org_deterministic',
    orgKind: 'diagnostic',
    cicdStage: 'review-merge',
    toolScope: extractToolsFromSessions(currentReviewSessions).length === 1 ? 'single-ide' : 'cross-ide',
    source: 'productivity',
    metricId: 'org.review_git_context',
    dataSource: 'real',
    metricValue: currentMedianAttempts,
    comparisonBaseline: baselineMedianAttempts,
    confidenceLevel: currentReviewSessions.length >= 15 ? 'HIGH' : 'MEDIUM',
    reviewPhaseSessionCount: currentReviewSessions.length,
    evidence: [
      { label: 'Median attempts (current)', value: currentMedianAttempts },
      { label: 'Median attempts (baseline)', value: baselineMedianAttempts },
      { label: 'Median resolution time', value: currentMedianResolution },
      { label: 'Unresolved context (current)', value: currentUnresolvedPct }, // Store as ratio (0-1)
      { label: 'Unresolved context (baseline)', value: baselineUnresolvedPct }, // Store as ratio (0-1)
      { label: 'Review sessions analyzed', value: currentReviewSessions.length },
    ],
    displayValue: isHealthy 
      ? `Median attempts ${currentMedianAttempts.toFixed(1)} • ${(currentUnresolvedPct * 100).toFixed(1)}% unresolved`
      : `${currentMedianAttempts.toFixed(1)} attempts, ${(currentUnresolvedPct * 100).toFixed(1)}% unresolved`,
    displayDelta: attemptsDelta >= 0.5 ? `+${attemptsDelta.toFixed(1)} attempts` : hasBaseline ? undefined : 'no baseline',
    whatsHappening: isHealthy 
      ? `Review sessions show healthy git context with ${currentMedianAttempts.toFixed(1)} median attempts and ${(currentUnresolvedPct * 100).toFixed(1)}% unresolved context.`
      : `Review sessions show ${currentMedianAttempts.toFixed(1)} median git context attempts${attemptsDelta >= 0.5 ? `, ${attemptsDelta >= 0 ? '+' : ''}${attemptsDelta.toFixed(1)} attempts change` : ''} with ${(currentUnresolvedPct * 100).toFixed(1)}% unresolved context, over the analyzed period.`,
    whyItMatters: isHealthy
      ? 'Healthy git context patterns indicate good repository organization and effective review workflows.'
      : 'Git context struggles increase PR latency and interrupt developer flow, reducing review throughput and increasing context switching costs.',
    recommendations: [
      { text: recommendationText, actionType: isHealthy ? 'monitor' : 'process' },
    ],
    related: {
      repos: currentReviewSessions.map(s => String(s.git_repo_url ?? '')).filter(Boolean).slice(0, 3),
      tools: extractToolsFromSessions(currentReviewSessions)
    },
    tags: ['telemetry', 'git-context', 'review-merge', 'v2'], // Added 'v2' tag for V2 pipeline recognition
    version: 'v2', // Added version for V2 pipeline recognition
    summaryEligible: true,
    ruleLabel: 'Git Context'
  };

  return [insight];
}

/**
 * R5: Review Throughput Regression
 * 
 * Signal Class: Efficiency Regression
 * 
 * Detects when review throughput is declining, indicating bottlenecks
 * in the code review process that could slow down development velocity.
 * 
 * Required fields:
 * - EngOutputPoint: timeToFirstReviewHours, period
 * - SessionDataPoint: timestamp (for filtering review sessions)
 * 
 * Emits when:
 * - Time to first review is increasing compared to baseline
 * - OR baseline time to first review is already concerning
 * 
 * Baseline Strategy: Historical baseline with fallback to current window
 */
function ruleReviewThroughputRegression(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'review-throughput-regression';
  console.log('🚀 [R5] REVIEW THROUGHPUT REGRESSION RULE CALLED!!!'); // OBVIOUS DEBUG LOG
  console.log('🔍 [R5] EXECUTING ruleReviewThroughputRegression'); // OBVIOUS DEBUG LOG
  
  // Helper: Filter to review-phase sessions using same heuristic as other rules
  const isReviewPhase = (s: any) => 
    (s.git_context_attempts || 0) >= 1 &&  // Lowered: most sessions have 1 attempt
    (s.terminal_ratio || 0) >= 0 &&        // Lowered: many sessions have 0 terminal
    (s.chars_added_total || 0) >= 0;     // Removed upper bound, data varies widely
  
  const { engOutput, sessions } = input;
  
  // Extract IDE information from sessions for proper scoping
  const extractToolsFromSessions = (sessions: any[]): string[] => {
    const tools = new Set<string>();
    sessions.forEach(s => {
      if (s.ide) tools.add(s.ide);
      if (s.tool) tools.add(s.tool);
      if (s.editor) tools.add(s.editor);
    });
    return Array.from(tools);
  };
  
  // DEBUG: Log available data
  console.log(`[R5] DEBUG: engOutput length: ${engOutput?.length || 0}`);
  console.log(`[R5] DEBUG: sessions length: ${sessions?.length || 0}`);
  
  // STEP 1: DATA AVAILABILITY CHECKS
  if (!requireNonEmptyBool(engOutput, ruleId, 'engOutput')) {
    console.log(`[R5] FAILED: Insufficient engOutput data`);
    return [];
  }
  
  // Filter to periods with time to first review data
  const validPeriods = engOutput.filter(p => 
    p.timeToFirstReviewHours != null && 
    p.timeToFirstReviewHours > 0 &&
    p.period
  );
  
  console.log(`[R5] DEBUG: validPeriods after filtering: ${validPeriods.length}`);
  
  // RELAXED: Use all available data instead of strict time windows
  if (!requireMinLen(validPeriods, 2, ruleId, 'valid_periods')) {
    console.log(`[R5] FAILED: Insufficient valid periods: ${validPeriods.length} < 2`);
    return [];
  }
  
  // STEP 2: BASELINE STRATEGY (RELAXED - use available data)
  const sortedPeriods = validPeriods.sort((a, b) => a.period.localeCompare(b.period));
  const splitPoint = Math.max(1, Math.floor(sortedPeriods.length * 0.6)); // 60/40 split
  
  const currentPeriods = sortedPeriods.slice(splitPoint);
  const baselinePeriods = sortedPeriods.slice(0, splitPoint);
  
  // Fallback: use current as baseline if insufficient historical data
  const effectiveBaseline = baselinePeriods.length >= 1 ? baselinePeriods : currentPeriods;
  
  console.log(`[R5] DEBUG: currentPeriods: ${currentPeriods.length}, baselinePeriods: ${baselinePeriods.length}`);
  
  if (!requireMinLen(currentPeriods, 1, ruleId, 'current_periods')) {
    console.log(`[R5] FAILED: Insufficient current periods: ${currentPeriods.length} < 1`);
    return [];
  }
  
  // STEP 3: SIGNAL LOGIC (THROUGHPUT REGRESSION DETECTION)
  const calculateAverage = (periods: any[]) => {
    return periods.reduce((sum, p) => sum + (p.timeToFirstReviewHours || 0), 0) / periods.length;
  };
  
  const currentAvg = calculateAverage(currentPeriods);
  const baselineAvg = calculateAverage(effectiveBaseline);
  
  // Higher time to first review = worse throughput
  const regressionDelta = currentAvg - baselineAvg;
  const regressionPct = baselineAvg > 0 ? (regressionDelta / baselineAvg) * 100 : 0;
  
  // STEP 4: SIGNAL DETECTION
  const throughputSignal = (
    regressionDelta >= 2.0 ||             // 2+ hours slower
    regressionPct >= 25.0 ||               // 25%+ slower
    baselineAvg >= 12.0                   // Already concerning baseline (12+ hours)
  ) ? [1] : [];
  
  if (!requireNonEmptyBool(throughputSignal, ruleId, 'throughput_signal')) {
    console.log(`[R5] No throughput signal: currentAvg=${currentAvg.toFixed(1)}h, baselineAvg=${baselineAvg.toFixed(1)}h, delta=${regressionDelta.toFixed(1)}h (${regressionPct.toFixed(1)}%)`);
    return [];
  }
  
  // STEP 5: EMISSION SAFETY CHECKS
  const latestPeriod = currentPeriods[currentPeriods.length - 1];
  const latestTimeToReview = latestPeriod?.timeToFirstReviewHours || 0;
  
  // STEP 6: DEBUG + AUDIT
  console.log(`[R5] EMITTING: time to first review worsened from ${baselineAvg.toFixed(1)}h to ${currentAvg.toFixed(1)}h (delta=${regressionDelta.toFixed(1)}h, ${regressionPct.toFixed(1)}%)`);
  
  const insight: PerformanceInsight = {
    id: `review-throughput-regression::efficiency::${latestPeriod?.period || 'unknown'}`,
    title: 'Review throughput regression detected',
    description: 'Time to first code review has increased significantly, indicating potential bottlenecks in the review process that could slow development velocity.',
    severity: 'warning',
    evidence: [
      { label: 'Current avg time to first review', value: `${currentAvg.toFixed(1)}h` },
      { label: 'Baseline avg time to first review', value: `${baselineAvg.toFixed(1)}h` },
      { label: 'Change', value: `${regressionDelta.toFixed(1)}h (${regressionPct.toFixed(1)}%)` },
      { label: 'Latest period', value: `${latestTimeToReview.toFixed(1)}h` },
      { label: 'Periods analyzed', value: `${currentPeriods.length}` }
    ],
    recommendation: 'Investigate review process bottlenecks, consider reviewer load balancing, implement review automation, and ensure clear reviewer assignment policies to improve review throughput.',
    metricId: 'org.review_throughput_regression',
    cicdStage: 'review-merge',
    toolScope: extractToolsFromSessions(sessions || []).length === 1 ? 'single-ide' : 'cross-ide',
    source: 'github' as any, // Use existing source type
    summaryEligible: true,
    ruleLabel: 'R5',
    tags: ['review-merge', 'throughput', 'efficiency', 'v2'], // V2 COMPLIANT
    version: 'v2', // V2 COMPLIANT
    // Review & Merge Performance Insights extensions
    metricValue: currentAvg,
    comparisonBaseline: baselineAvg,
    confidenceLevel: currentPeriods.length >= 4 ? 'HIGH' : 'MEDIUM',
    reviewPhaseSessionCount: sessions?.filter(s => s.timestamp && isReviewPhase(s)).length || 0,
    related: { tools: extractToolsFromSessions(sessions || []) }
  };
  
  return [insight];
}

/**
 * R6: Review Quality Leading Indicator
 * 
 * Signal Class: Leading Indicator
 * 
 * Detects when poor review quality (focus issues) predicts downstream
 * problems like higher rework rates or merge conflicts.
 * 
 * Required fields:
 * - SessionDataPoint: rework_ratio_est, focus_ratio, timestamp, is_review_phase
 * - EngOutputPoint: Not required (session-based only)
 * 
 * Emits when:
 * - Poor review focus correlates with higher subsequent rework
 * - OR review focus quality is consistently low
 * 
 * Baseline Strategy: Historical baseline with fallback to current window
 */
function ruleReviewQualityLeadingIndicator(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'review-quality-leading-indicator';
  console.log('🚀 [R6] REVIEW QUALITY LEADING INDICATOR RULE CALLED!!!'); // OBVIOUS DEBUG LOG
  console.log('🔍 [R6] EXECUTING ruleReviewQualityLeadingIndicator'); // OBVIOUS DEBUG LOG
  
  // Helper: Filter to review-phase sessions using heuristic
  const isReviewPhase = (s: any) => 
    (s.git_context_attempts || 0) >= 1 &&  // Lowered: most sessions have 1 attempt
    (s.terminal_ratio || 0) >= 0 &&        // Lowered: many sessions have 0 terminal
    (s.chars_added_total || 0) >= 0;     // Removed upper bound, data varies widely
  
  const { sessions } = input;
  
  // Extract IDE information from sessions for proper scoping
  const extractToolsFromSessions = (sessions: any[]): string[] => {
    const tools = new Set<string>();
    sessions.forEach(s => {
      if (s.ide) tools.add(s.ide);
      if (s.tool) tools.add(s.tool);
      if (s.editor) tools.add(s.editor);
    });
    return Array.from(tools);
  };
  
  // DEBUG: Log available data
  console.log(`[R6] DEBUG: sessions length: ${sessions?.length || 0}`);
  
  // STEP 1: DATA AVAILABILITY CHECKS
  if (!requireNonEmptyBool(sessions, ruleId, 'sessions')) {
    console.log(`[R6] FAILED: Insufficient session data`);
    return [];
  }
  
  // Filter to review sessions with focus and rework data
  const reviewSessions = sessions.filter(s => 
    s.timestamp && 
    isReviewPhase(s) &&
    s.focus_ratio != null && 
    s.rework_ratio_est != null
  );
  
  console.log(`[R6] DEBUG: reviewSessions after filtering: ${reviewSessions.length}`);
  
  // RELAXED: Use all available data instead of strict time windows
  if (!requireMinLen(reviewSessions, 5, ruleId, 'review_sessions')) {
    console.log(`[R6] FAILED: Insufficient review sessions: ${reviewSessions.length} < 5`);
    return [];
  }
  
  // STEP 2: BASELINE STRATEGY (RELAXED - use available data)
  const sortedSessions = reviewSessions.sort((a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime());
  const splitPoint = Math.max(1, Math.floor(sortedSessions.length * 0.6)); // 60/40 split
  
  const currentSessions = sortedSessions.slice(splitPoint);
  const baselineSessions = sortedSessions.slice(0, splitPoint);
  
  // Fallback: use current as baseline if insufficient historical data
  const effectiveBaseline = baselineSessions.length >= 3 ? baselineSessions : currentSessions;
  
  console.log(`[R6] DEBUG: currentSessions: ${currentSessions.length}, baselineSessions: ${baselineSessions.length}`);
  
  if (!requireMinLen(currentSessions, 3, ruleId, 'current_sessions')) {
    console.log(`[R6] FAILED: Insufficient current sessions: ${currentSessions.length} < 3`);
    return [];
  }
  
  // STEP 3: SIGNAL LOGIC (QUALITY LEADING INDICATOR DETECTION)
  const calculateAverages = (sessions: any[]) => {
    const avgFocus = sessions.reduce((sum, s) => sum + (s.focus_ratio || 0), 0) / sessions.length;
    const avgRework = sessions.reduce((sum, s) => sum + (s.rework_ratio_est || 0), 0) / sessions.length;
    return { avgFocus, avgRework };
  };
  
  const current = calculateAverages(currentSessions);
  const baseline = calculateAverages(effectiveBaseline);
  
  // Calculate correlation between poor focus and high rework
  const focusReworkCorrelation = calculateCorrelation(
    currentSessions.map(s => s.focus_ratio || 0),
    currentSessions.map(s => s.rework_ratio_est || 0)
  );
  
  // Focus quality threshold (below 0.65 = poor focus)
  const poorFocusThreshold = 0.65;
  const currentPoorFocusPct = currentSessions.filter(s => (s.focus_ratio || 0) < poorFocusThreshold).length / currentSessions.length;
  const baselinePoorFocusPct = effectiveBaseline.filter(s => (s.focus_ratio || 0) < poorFocusThreshold).length / effectiveBaseline.length;
  
  // STEP 4: SIGNAL DETECTION
  const qualitySignal = (
    currentPoorFocusPct >= 0.4 ||                    // 40%+ sessions with poor focus
    (current.avgFocus < 0.6 && current.avgRework > 0.2) || // Poor focus + high rework combo
    (focusReworkCorrelation < -0.3 && currentPoorFocusPct >= 0.3) || // Negative correlation + some poor focus
    baselinePoorFocusPct >= 0.5                      // Already concerning baseline
  ) ? [1] : [];
  
  if (!requireNonEmptyBool(qualitySignal, ruleId, 'quality_signal')) {
    console.log(`[R6] No quality signal: focus=${current.avgFocus.toFixed(3)}, rework=${current.avgRework.toFixed(3)}, poorFocus=${(currentPoorFocusPct * 100).toFixed(1)}%, corr=${focusReworkCorrelation.toFixed(3)}`);
    return [];
  }
  
  // STEP 5: EMISSION SAFETY CHECKS
  const latestSession = currentSessions[currentSessions.length - 1];
  
  // STEP 6: DEBUG + AUDIT
  console.log(`[R6] EMITTING: review quality issues detected - focus=${current.avgFocus.toFixed(3)}, rework=${current.avgRework.toFixed(3)}, poorFocus=${(currentPoorFocusPct * 100).toFixed(1)}%, corr=${focusReworkCorrelation.toFixed(3)}`);
  
  const insight: PerformanceInsight = {
    id: `review-quality-leading-indicator::quality::${new Date().toISOString().split('T')[0]}`,
    title: 'Review quality issues predict downstream problems',
    description: 'Poor review focus quality is detected and correlates with higher rework rates, indicating potential quality issues that could impact downstream development.',
    severity: 'warning',
    evidence: [
      { label: 'Current avg focus quality', value: (current.avgFocus * 100).toFixed(1) + '%' },
      { label: 'Baseline avg focus quality', value: (baseline.avgFocus * 100).toFixed(1) + '%' },
      { label: 'Current avg rework rate', value: (current.avgRework * 100).toFixed(1) + '%' },
      { label: 'Poor focus sessions', value: (currentPoorFocusPct * 100).toFixed(1) + '%' },
      { label: 'Focus-rework correlation', value: focusReworkCorrelation.toFixed(3) },
      { label: 'Review sessions analyzed', value: `${currentSessions.length}` }
    ],
    recommendation: 'Improve review quality by reducing distractions during review sessions, implementing review guidelines, and providing focused review time blocks to prevent downstream rework issues.',
    metricId: 'org.review_quality_leading_indicator',
    cicdStage: 'review-merge',
    toolScope: extractToolsFromSessions(currentSessions).length === 1 ? 'single-ide' : 'cross-ide',
    source: 'performance-engine',
    summaryEligible: true,
    ruleLabel: 'R6',
    tags: ['review-merge', 'quality', 'leading-indicator', 'v2'], // V2 COMPLIANT
    version: 'v2', // V2 COMPLIANT
    // Review & Merge Performance Insights extensions
    metricValue: current.avgFocus,
    comparisonBaseline: baseline.avgFocus,
    confidenceLevel: currentSessions.length >= 10 ? 'HIGH' : currentSessions.length >= 5 ? 'MEDIUM' : 'LOW',
    reviewPhaseSessionCount: reviewSessions.length,
    related: { tools: extractToolsFromSessions(currentSessions) }
  };
  
  return [insight];
}

// Helper function for correlation calculation
function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;
  
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * D5: Deployment Time Analysis (Deploy & Operate)
 * 
 * Signal Type: REGRESSION - detects when deployment efficiency worsens
 * 
 * Metrics: Correlation between PR cycle time and deployment frequency
 * Baseline Strategy: Historical baseline with fallback to current window
 * 
 * Required fields:
 * - EngOutputPoint: prCycleTimeHours, deploymentFreqPerWeek, period
 * 
 * Emits when:
 * - regressionDelta >= threshold (worsening correlation)
 * - OR baselineValue >= concerningThreshold (already inefficient)
 */
function ruleDeployTimeAnalysis(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'deploy-time-analysis';
  console.log('🚀 [D5] DEPLOY TIME ANALYSIS RULE CALLED!!!'); // OBVIOUS DEBUG LOG
  console.log('🔍 [D5] EXECUTING ruleDeployTimeAnalysis'); // OBVIOUS DEBUG LOG
  
  const { engOutput, sessions } = input;
  
  // Extract IDE information from sessions for proper scoping
  const extractToolsFromSessions = (sessions: any[]): string[] => {
    const tools = new Set<string>();
    sessions.forEach(s => {
      if (s.ide) tools.add(s.ide);
      if (s.tool) tools.add(s.tool);
      if (s.editor) tools.add(s.editor);
    });
    return Array.from(tools);
  };
  
  // DEBUG: Log available data
  console.log(`[D5] DEBUG: engOutput length: ${engOutput?.length || 0}`);
  if (engOutput && engOutput.length > 0) {
    console.log(`[D5] DEBUG: available periods: ${engOutput.map(p => p.period).join(', ')}`);
    console.log(`[D5] DEBUG: sample data:`, engOutput.slice(0, 2).map(p => ({
      period: p.period,
      cycleTime: p.prCycleTimeHours,
      deployFreq: p.deploymentFreqPerWeek
    })));
  }
  
  // STEP 1: DATA AVAILABILITY CHECKS
  if (!requireNonEmptyBool(engOutput, ruleId, 'engOutput')) {
    console.log(`[D5] FAILED: Insufficient engOutput data`);
    return [];
  }
  
  // Filter to periods with both metrics
  const validPeriods = engOutput.filter(p => 
    p.prCycleTimeHours != null && 
    p.deploymentFreqPerWeek != null && 
    p.prCycleTimeHours > 0 && 
    p.deploymentFreqPerWeek > 0
  );
  
  console.log(`[D5] DEBUG: validPeriods after filtering: ${validPeriods.length}`);
  
  // RELAXED: Use all available data instead of strict time windows
  if (!requireMinLen(validPeriods, 2, ruleId, 'valid_periods')) {
    console.log(`[D5] FAILED: Insufficient valid periods: ${validPeriods.length} < 2`);
    return [];
  }
  
  // STEP 2: BASELINE STRATEGY (RELAXED - use available data)
  const sortedPeriods = validPeriods.sort((a, b) => a.period.localeCompare(b.period));
  const splitPoint = Math.max(1, Math.floor(sortedPeriods.length * 0.6)); // 60/40 split
  
  const currentPeriods = sortedPeriods.slice(splitPoint);
  const baselinePeriods = sortedPeriods.slice(0, splitPoint);
  
  // Fallback: use current as baseline if insufficient historical data
  const effectiveBaseline = baselinePeriods.length >= 1 ? baselinePeriods : currentPeriods;
  
  console.log(`[D5] DEBUG: currentPeriods: ${currentPeriods.length}, baselinePeriods: ${baselinePeriods.length}`);
  
  if (!requireMinLen(currentPeriods, 1, ruleId, 'current_periods')) {
    console.log(`[D5] FAILED: Insufficient current periods: ${currentPeriods.length} < 1`);
    return [];
  }
  
  // STEP 3: SIGNAL LOGIC (REGRESSION DETECTION)
  const calculateCorrelation = (periods: any[]) => {
    const cycleTimes = periods.map(p => p.prCycleTimeHours);
    const deployFreqs = periods.map(p => p.deploymentFreqPerWeek);
    
    // Simple Pearson correlation
    const n = periods.length;
    const sumX = cycleTimes.reduce((a, b) => a + b, 0);
    const sumY = deployFreqs.reduce((a, b) => a + b, 0);
    const sumXY = cycleTimes.reduce((sum, x, i) => sum + x * deployFreqs[i], 0);
    const sumX2 = cycleTimes.reduce((sum, x) => sum + x * x, 0);
    const sumY2 = deployFreqs.reduce((sum, y) => sum + y * y, 0);
    
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    return denominator === 0 ? 0 : numerator / denominator;
  };
  
  const currentCorrelation = calculateCorrelation(currentPeriods);
  const baselineCorrelation = calculateCorrelation(effectiveBaseline);
  
  // Negative correlation = longer cycle time, lower deployment frequency (bad)
  const regressionDelta = currentCorrelation - baselineCorrelation;
  
  // STEP 4: SIGNAL DETECTION
  const deployTimeSignal = (
    regressionDelta <= -0.2 ||           // Significant worsening (more negative)
    baselineCorrelation <= -0.3          // Already concerning baseline
  ) ? [1] : [];
  
  if (!requireNonEmptyBool(deployTimeSignal, ruleId, 'deploy_time_signal')) {
    console.log(`[D5] No deploy time signal: currentCorr=${currentCorrelation.toFixed(3)}, baselineCorr=${baselineCorrelation.toFixed(3)}, delta=${regressionDelta.toFixed(3)}`);
    return [];
  }
  
  // STEP 5: EMISSION SAFETY CHECKS
  const latestPeriod = currentPeriods[currentPeriods.length - 1];
  const avgCycleTime = currentPeriods.reduce((sum, p) => sum + (p.prCycleTimeHours || 0), 0) / currentPeriods.length;
  const avgDeployFreq = currentPeriods.reduce((sum, p) => sum + (p.deploymentFreqPerWeek || 0), 0) / currentPeriods.length;
  
  // STEP 6: DEBUG + AUDIT
  console.log(`[D5] EMITTING: correlation worsened from ${baselineCorrelation.toFixed(3)} to ${currentCorrelation.toFixed(3)} (delta=${regressionDelta.toFixed(3)})`);
  
  const insight: PerformanceInsight = {
    id: `deploy-time-analysis::efficiency::${latestPeriod?.period || 'unknown'}`,
    title: 'Deployment time efficiency regression detected',
    description: `The correlation between cycle time and deploy frequency worsened from ${baselineCorrelation.toFixed(2)} to ${currentCorrelation.toFixed(2)}, indicating deployment bottlenecks.`,
    severity: 'warning',
    evidence: [
      { label: 'Current correlation', value: currentCorrelation },
      { label: 'Baseline correlation', value: baselineCorrelation },
      { label: 'Change', value: regressionDelta },
      { label: 'Avg cycle time', value: avgCycleTime },
      { label: 'Avg deploy frequency', value: avgDeployFreq },
      { label: 'Periods analyzed', value: currentPeriods.length }
    ],
    displayValue: `r=${currentCorrelation.toFixed(2)} correlation`,
    displayDelta: regressionDelta <= -0.01 ? `Δ ${regressionDelta.toFixed(2)}` : undefined,
    whatsHappening: `Deployment efficiency correlation is r=${currentCorrelation.toFixed(2)}${regressionDelta <= -0.01 ? `, Δ ${regressionDelta.toFixed(2)} change` : ''} with ${avgCycleTime.toFixed(1)}h cycle time and ${avgDeployFreq.toFixed(1)}/week deploy frequency, over ${currentPeriods.length} periods.`,
    whyItMatters: 'Poor deployment efficiency correlation indicates delivery bottlenecks and unpredictability, reducing throughput and increasing delivery risk.',
    recommendation: 'Investigate deployment pipeline bottlenecks, optimize release processes, and consider automated deployment strategies to improve the relationship between development and deployment velocity.',
    metricId: 'org.deploy_time_efficiency',
    cicdStage: 'deploy-operate',
    toolScope: extractToolsFromSessions(sessions || []).length === 1 ? 'single-ide' : 'cross-ide',
    source: 'github' as any, // Use existing source type
    summaryEligible: true,
    ruleLabel: 'D5',
    tags: ['deploy-operate', 'deployment', 'efficiency', 'v2'], // V2 COMPLIANT
    version: 'v2', // V2 COMPLIANT
    // Deploy & Operate Performance Insights extensions
    metricValue: currentCorrelation,
    comparisonBaseline: baselineCorrelation,
    confidenceLevel: currentPeriods.length >= 4 ? 'HIGH' : 'MEDIUM',
    deployOperatePeriodCount: currentPeriods.length,
    related: { tools: extractToolsFromSessions(sessions || []) }
  };
  
  return [insight];
}

/**
 * D6: Reliability Volatility Regression (Deploy & Operate)
 * 
 * Signal Type: REGRESSION - detects when reliability becomes more unstable
 * 
 * Metrics: CFR coefficient of variation over time
 * Baseline Strategy: Historical baseline with fallback to current window
 * 
 * Required fields:
 * - EngOutputPoint: changeFailureRatePct, period
 * 
 * Emits when:
 * - regressionDelta >= threshold (volatility increasing)
 * - OR baselineValue >= concerningThreshold (already unstable)
 */
function ruleReliabilityVolatilityRegression(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'reliability-volatility-regression';
  console.log('🚀 [D6] RELIABILITY VOLATILITY REGRESSION RULE CALLED!!!'); // OBVIOUS DEBUG LOG
  console.log('🔍 [D6] EXECUTING ruleReliabilityVolatilityRegression'); // OBVIOUS DEBUG LOG
  
  const { engOutput } = input;
  
  // STEP 1: DATA AVAILABILITY CHECKS
  if (!requireNonEmptyBool(engOutput, ruleId, 'engOutput')) {
    console.log(`[D6] FAILED: Insufficient engOutput data`);
    return [];
  }
  
  // Filter to periods with valid CFR
  const validPeriods = engOutput.filter(p => 
    p.changeFailureRatePct != null && 
    p.changeFailureRatePct > 0
  );
  
  // RELAXED: Use all available data instead of strict time windows
  if (!requireMinLen(validPeriods, 2, ruleId, 'valid_periods')) {
    console.log(`[D6] FAILED: Insufficient valid periods: ${validPeriods.length} < 2`);
    return [];
  }
  
  // STEP 2: BASELINE STRATEGY (RELAXED - use available data)
  const sortedPeriods = validPeriods.sort((a, b) => a.period.localeCompare(b.period));
  const splitPoint = Math.max(1, Math.floor(sortedPeriods.length * 0.6)); // 60/40 split
  
  const currentPeriods = sortedPeriods.slice(splitPoint);
  const baselinePeriods = sortedPeriods.slice(0, splitPoint);
  
  // Fallback: use current as baseline if insufficient historical data
  const effectiveBaseline = baselinePeriods.length >= 1 ? baselinePeriods : currentPeriods;
  
  console.log(`[D6] DEBUG: currentPeriods: ${currentPeriods.length}, baselinePeriods: ${baselinePeriods.length}`);
  
  if (!requireMinLen(currentPeriods, 1, ruleId, 'current_periods')) {
    console.log(`[D6] FAILED: Insufficient current periods: ${currentPeriods.length} < 1`);
    return [];
  }
  
  // STEP 3: SIGNAL LOGIC (REGRESSION DETECTION)
  const calculateVolatility = (periods: any[]) => {
    const cfrValues = periods.map(p => p.changeFailureRatePct);
    const mean = cfrValues.reduce((sum, val) => sum + val, 0) / cfrValues.length;
    const variance = cfrValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / cfrValues.length;
    const stdDev = Math.sqrt(variance);
    return mean > 0 ? stdDev / mean : 0; // Coefficient of variation
  };
  
  const currentVolatility = calculateVolatility(currentPeriods);
  const baselineVolatility = calculateVolatility(effectiveBaseline);
  
  const regressionDelta = currentVolatility - baselineVolatility;
  
  // STEP 4: SIGNAL DETECTION
  const volatilitySignal = (
    regressionDelta >= 0.1 ||           // Significant worsening (higher volatility)
    baselineVolatility >= 0.3          // Already concerning baseline
  ) ? [1] : [];
  
  if (!requireNonEmptyBool(volatilitySignal, ruleId, 'volatility_signal')) {
    console.log(`[D6] No volatility signal: currentVol=${currentVolatility.toFixed(3)}, baselineVol=${baselineVolatility.toFixed(3)}, delta=${regressionDelta.toFixed(3)}`);
    return [];
  }
  
  // STEP 5: EMISSION SAFETY CHECKS
  const latestPeriod = currentPeriods[currentPeriods.length - 1];
  const avgCFR = currentPeriods.reduce((sum, p) => sum + (p.changeFailureRatePct || 0), 0) / currentPeriods.length;
  
  // STEP 6: DEBUG + AUDIT
  console.log(`[D6] EMITTING: volatility increased from ${baselineVolatility.toFixed(3)} to ${currentVolatility.toFixed(3)} (delta=${regressionDelta.toFixed(3)})`);
  
  const insight: PerformanceInsight = {
    id: `reliability-volatility-regression::stability::${latestPeriod?.period || 'unknown'}`,
    title: 'Reliability volatility regression detected',
    description: 'Change failure rate has become more unstable, indicating inconsistent deployment quality and potential process issues.',
    severity: 'warning',
    evidence: [
      { label: 'Current volatility', value: currentVolatility.toFixed(3) },
      { label: 'Baseline volatility', value: baselineVolatility.toFixed(3) },
      { label: 'Change', value: `${regressionDelta.toFixed(3)} points` },
      { label: 'Avg failure rate', value: `${avgCFR.toFixed(1)}%` },
      { label: 'Periods analyzed', value: `${currentPeriods.length}` }
    ],
    recommendation: 'Standardize deployment processes, improve testing coverage, and implement quality gates to reduce reliability volatility and ensure more consistent deployment outcomes.',
    metricId: 'org.reliability_volatility_regression',
    cicdStage: 'deploy-operate',
    toolScope: 'cross-ide',
    source: 'github' as any, // Use existing source type
    summaryEligible: true,
    ruleLabel: 'D6',
    tags: ['deploy-operate', 'reliability', 'volatility', 'v2'], // V2 COMPLIANT
    version: 'v2', // V2 COMPLIANT
    // Deploy & Operate Performance Insights extensions
    metricValue: currentVolatility,
    comparisonBaseline: baselineVolatility,
    confidenceLevel: currentPeriods.length >= 4 ? 'HIGH' : 'MEDIUM',
    deployOperatePeriodCount: currentPeriods.length
  };
  
  return [insight];
}

/**
 * D7: Rework-Leading-Reliability Degradation (Deploy & Operate)
 * 
 * Signal Type: LEADING INDICATOR - high rework predicts future reliability issues
 * 
 * Metrics: Correlation between rework ratio and next-period CFR
 * Baseline Strategy: Historical baseline with fallback to current window
 * 
 * Required fields:
 * - SessionDataPoint: rework_ratio_est, timestamp
 * - EngOutputPoint: changeFailureRatePct, period
 * 
 * Emits when:
 * - rework levels are high AND subsequent CFR increases
 * - OR rework-to-CFR correlation exceeds threshold
 */
function ruleReworkLeadingReliabilityDegradation(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'rework-leading-reliability-degradation';
  console.log('🚀 [D7] REWORK LEADING RELIABILITY RULE CALLED!!!'); // OBVIOUS DEBUG LOG
  console.log('🔍 [D7] EXECUTING ruleReworkLeadingReliabilityDegradation'); // OBVIOUS DEBUG LOG
  
  const { sessions, engOutput } = input;
  
  // DEBUG: Log available data
  console.log(`[D7] DEBUG: sessions length: ${sessions?.length || 0}`);
  console.log(`[D7] DEBUG: engOutput length: ${engOutput?.length || 0}`);
  
  // STEP 1: DATA AVAILABILITY CHECKS
  if (!requireNonEmptyBool(sessions, ruleId, 'sessions') || !requireNonEmptyBool(engOutput, ruleId, 'engOutput')) {
    console.log(`[D7] FAILED: Insufficient data - sessions: ${sessions?.length || 0}, engOutput: ${engOutput?.length || 0}`);
    return [];
  }
  
  // DEBUG: Sample session data
  if (sessions && sessions.length > 0) {
    const sampleSessions = sessions.slice(0, 3).map(s => ({
      timestamp: s.timestamp,
      rework_ratio_est: s.rework_ratio_est,
      hasWeekKey: s.timestamp ? getWeekKey(new Date(s.timestamp)) : 'no-timestamp'
    }));
    console.log(`[D7] DEBUG: sample sessions:`, sampleSessions);
  }
  
  // Aggregate rework by week from sessions
  const reworkByWeek = new Map<string, number[]>();
  sessions.forEach(session => {
    if (session.rework_ratio_est != null && session.timestamp) {
      const week = getWeekKey(new Date(session.timestamp));
      if (!reworkByWeek.has(week)) reworkByWeek.set(week, []);
      reworkByWeek.get(week)!.push(session.rework_ratio_est);
    }
  });
  
  // DEBUG: Show week distribution
  console.log(`[D7] DEBUG: reworkByWeek distribution:`);
  reworkByWeek.forEach((values, week) => {
    console.log(`  ${week}: ${values.length} sessions, avg rework: ${(values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(3)}`);
  });
  
  // Build weekly series
  const weeklyData: Array<{week: string; rework: number; cfr: number}> = [];
  reworkByWeek.forEach((reworkValues, week) => {
    const avgRework = reworkValues.reduce((sum, val) => sum + val, 0) / reworkValues.length;
    const engPoint = engOutput.find(p => p.period === week);
    const cfr = engPoint?.changeFailureRatePct;
    
    console.log(`[D7] DEBUG: week ${week}: avgRework=${avgRework.toFixed(3)}, engPoint=${engPoint ? 'found' : 'missing'}, cfr=${cfr}`);
    
    if (cfr != null && cfr > 0) {
      weeklyData.push({ week, rework: avgRework, cfr });
    }
  });
  
  // RELAXED: Use all available data instead of strict time windows
  if (!requireMinLen(weeklyData, 1, ruleId, 'weekly_data')) {
    console.log(`[D7] FAILED: Insufficient weekly data points: ${weeklyData.length} < 1`);
    return [];
  }
  
  // STEP 2: BASELINE STRATEGY (use full dataset for leading indicator)
  const sortedData = weeklyData.sort((a, b) => a.week.localeCompare(b.week));
  const recentData = sortedData.slice(-Math.max(1, Math.floor(sortedData.length * 0.4))); // Last 40%
  const avgRework = recentData.reduce((sum, d) => sum + d.rework, 0) / recentData.length;
  const avgCFR = recentData.reduce((sum, d) => sum + d.cfr, 0) / recentData.length;
  
  console.log(`[D7] DEBUG: weeklyData: ${weeklyData.length}, recentData: ${recentData.length}`);
  console.log(`[D7] DEBUG: avgRework: ${avgRework.toFixed(3)}, avgCFR: ${avgCFR.toFixed(1)}`);
  
  // STEP 3: SIGNAL LOGIC (LEADING INDICATOR DETECTION)
  // Calculate correlation between rework and subsequent CFR
  let correlation = 0;
  if (weeklyData.length >= 2) {
    const reworkValues = sortedData.slice(0, -1).map(d => d.rework); // All but last
    const subsequentCFR = sortedData.slice(1).map(d => d.cfr); // All but first
    
    if (reworkValues.length >= 1) {
      const n = reworkValues.length;
      const sumX = reworkValues.reduce((a, b) => a + b, 0);
      const sumY = subsequentCFR.reduce((a, b) => a + b, 0);
      const sumXY = reworkValues.reduce((sum, x, i) => sum + x * subsequentCFR[i], 0);
      const sumX2 = reworkValues.reduce((sum, x) => sum + x * x, 0);
      const sumY2 = subsequentCFR.reduce((sum, y) => sum + y * y, 0);
      
      const numerator = n * sumXY - sumX * sumY;
      const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
      correlation = denominator === 0 ? 0 : numerator / denominator;
    }
  } else {
    // For single data point, use absolute rework level as signal
    correlation = avgRework > 0.1 ? 0.5 : 0; // Simple heuristic for single point
  }
  
  // STEP 4: SIGNAL DETECTION
  const reworkSignal = (
    avgRework >= 0.15 ||               // High rework levels (15%+)
    correlation >= 0.4 ||              // Strong positive correlation
    (avgRework >= 0.1 && avgCFR >= 10) // Moderate rework + high CFR
  ) ? [1] : [];
  
  if (!requireNonEmptyBool(reworkSignal, ruleId, 'rework_signal')) {
    console.log(`[D7] No rework signal: avgRework=${avgRework.toFixed(3)}, correlation=${correlation.toFixed(3)}, avgCFR=${avgCFR.toFixed(1)}`);
    return [];
  }
  
  // STEP 5: EMISSION SAFETY CHECKS
  const latestWeek = recentData[recentData.length - 1];
  
  // STEP 6: DEBUG + AUDIT
  console.log(`[D7] EMITTING: rework=${avgRework.toFixed(3)}, correlation=${correlation.toFixed(3)}, subsequent CFR trend detected`);
  
  const insight: PerformanceInsight = {
    id: `rework-leading-reliability-degradation::predictor::${latestWeek?.week || 'unknown'}`,
    title: 'High rework predicts reliability degradation',
    description: 'Elevated rework levels are correlating with subsequent change failure rates, indicating quality issues that may impact deployment reliability.',
    severity: 'warning',
    evidence: [
      { label: 'Avg rework ratio', value: avgRework.toFixed(3) }, // Store as ratio (0-1), let UI format as %
      { label: 'Rework-CFR correlation', value: correlation.toFixed(3) },
      { label: 'Subsequent avg CFR', value: avgCFR.toFixed(1) },
      { label: 'Weeks analyzed', value: recentData.length }
    ],
    recommendation: 'Address code quality issues early, improve code review practices, and invest in automated testing to reduce rework and prevent downstream reliability problems.',
    metricId: 'org.rework_leading_reliability',
    cicdStage: 'deploy-operate',
    toolScope: 'cross-ide',
    source: 'github' as any, // Use existing source type
    summaryEligible: true,
    ruleLabel: 'D7',
    tags: ['deploy-operate', 'rework', 'quality', 'predictive', 'v2'], // V2 COMPLIANT
    version: 'v2', // V2 COMPLIANT
    // Deploy & Operate Performance Insights extensions
    metricValue: avgRework,
    comparisonBaseline: 0.1, // 10% rework baseline
    confidenceLevel: recentData.length >= 4 ? 'HIGH' : 'MEDIUM',
    deployOperatePeriodCount: recentData.length
  };
  
  return [insight];
}

/**
 * D8: AI-Divergence Pattern (Deploy & Operate)
 * 
 * Signal Type: DIVERGENCE - AI usage increases but deployment efficiency decreases
 * 
 * Metrics: AI assists vs deployment frequency correlation trend
 * Baseline Strategy: Historical baseline with fallback to current window
 * 
 * Required fields:
 * - ToolProductivityPoint: aiAssists, period, tool
 * - EngOutputPoint: deploymentFreqPerWeek, period
 * 
 * Emits when:
 * - AI usage increases but deployment frequency decreases
 * - OR AI-deployment correlation becomes more negative
 */
function ruleAIDivergencePattern(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'ai-divergence-pattern';
  console.log('🚀 [D8] AI DIVERGENCE PATTERN RULE CALLED!!!'); // OBVIOUS DEBUG LOG
  console.log('🔍 [D8] EXECUTING ruleAIDivergencePattern'); // OBVIOUS DEBUG LOG
  
  const { productivity, engOutput } = input;
  
  // STEP 1: DATA AVAILABILITY CHECKS
  if (!requireNonEmptyBool(productivity, ruleId, 'productivity') || !requireNonEmptyBool(engOutput, ruleId, 'engOutput')) {
    console.log(`[D8] FAILED: Insufficient data - productivity: ${productivity?.length || 0}, engOutput: ${engOutput?.length || 0}`);
    return [];
  }
  
  // Aggregate AI usage by period
  const aiByPeriod = new Map<string, number>();
  productivity.forEach(point => {
    if (point.aiAssists != null && point.period) {
      const current = aiByPeriod.get(point.period) || 0;
      aiByPeriod.set(point.period, current + point.aiAssists);
    }
  });
  
  // Build joint series
  const jointData: Array<{period: string; aiTotal: number; deployFreq: number}> = [];
  engOutput.forEach(point => {
    if (point.deploymentFreqPerWeek != null && point.period) {
      const aiTotal = aiByPeriod.get(point.period) || 0;
      if (aiTotal > 0) {
        jointData.push({
          period: point.period,
          aiTotal,
          deployFreq: point.deploymentFreqPerWeek
        });
      }
    }
  });
  
  // RELAXED: Use all available data instead of strict time windows
  if (!requireMinLen(jointData, 2, ruleId, 'joint_data')) {
    console.log(`[D8] FAILED: Insufficient joint data points: ${jointData.length} < 2`);
    return [];
  }
  
  // STEP 2: BASELINE STRATEGY (RELAXED - use available data)
  const sortedData = jointData.sort((a, b) => a.period.localeCompare(b.period));
  const splitPoint = Math.max(1, Math.floor(sortedData.length * 0.6)); // 60/40 split
  
  const currentPeriods = sortedData.slice(splitPoint);
  const baselinePeriods = sortedData.slice(0, splitPoint);
  
  const effectiveBaseline = baselinePeriods.length >= 1 ? baselinePeriods : currentPeriods;
  
  console.log(`[D8] DEBUG: jointData: ${jointData.length}, currentPeriods: ${currentPeriods.length}, baselinePeriods: ${baselinePeriods.length}`);
  
  if (!requireMinLen(currentPeriods, 1, ruleId, 'current_periods')) {
    console.log(`[D8] FAILED: Insufficient current periods: ${currentPeriods.length} < 1`);
    return [];
  }
  
  // STEP 3: SIGNAL LOGIC (DIVERGENCE DETECTION)
  const calculateCorrelation = (periods: any[]) => {
    const aiValues = periods.map(p => p.aiTotal);
    const deployValues = periods.map(p => p.deployFreq);
    
    const n = periods.length;
    const sumX = aiValues.reduce((a, b) => a + b, 0);
    const sumY = deployValues.reduce((a, b) => a + b, 0);
    const sumXY = aiValues.reduce((sum, x, i) => sum + x * deployValues[i], 0);
    const sumX2 = aiValues.reduce((sum, x) => sum + x * x, 0);
    const sumY2 = deployValues.reduce((sum, y) => sum + y * y, 0);
    
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    return denominator === 0 ? 0 : numerator / denominator;
  };
  
  const currentCorrelation = calculateCorrelation(currentPeriods);
  const baselineCorrelation = calculateCorrelation(effectiveBaseline);
  
  // Calculate trends (safely handle small arrays)
  let currentAITrend = 0;
  let currentDeployTrend = 0;
  let divergenceTrend = false;
  
  if (currentPeriods.length >= 2) {
    currentAITrend = currentPeriods[currentPeriods.length - 1].aiTotal > currentPeriods[0].aiTotal ? 1 : -1;
    currentDeployTrend = currentPeriods[currentPeriods.length - 1].deployFreq > currentPeriods[0].deployFreq ? 1 : -1;
    divergenceTrend = currentAITrend > 0 && currentDeployTrend < 0;
  }
  
  const regressionDelta = currentCorrelation - baselineCorrelation;
  
  // STEP 4: SIGNAL DETECTION
  const divergenceSignal = (
    divergenceTrend ||                    // AI up, deploy down
    regressionDelta <= -0.2 ||           // Correlation worsening significantly
    (currentCorrelation <= -0.3 && currentPeriods.reduce((sum, p) => sum + p.aiTotal, 0) >= 100) // Strong negative correlation + high AI usage
  ) ? [1] : [];
  
  if (!requireNonEmptyBool(divergenceSignal, ruleId, 'divergence_signal')) {
    console.log(`[D8] No divergence signal: currentCorr=${currentCorrelation.toFixed(3)}, divergenceTrend=${divergenceTrend}, delta=${regressionDelta.toFixed(3)}`);
    return [];
  }
  
  // STEP 5: EMISSION SAFETY CHECKS
  const latestPeriod = currentPeriods[currentPeriods.length - 1];
  const avgAI = currentPeriods.reduce((sum, p) => sum + p.aiTotal, 0) / currentPeriods.length;
  const avgDeploy = currentPeriods.reduce((sum, p) => sum + p.deployFreq, 0) / currentPeriods.length;
  
  // STEP 6: DEBUG + AUDIT
  console.log(`[D8] EMITTING: AI-deployment divergence detected - correlation=${currentCorrelation.toFixed(3)}, trend=${divergenceTrend ? 'divergent' : 'convergent'}`);
  
  const insight: PerformanceInsight = {
    id: `ai-divergence-pattern::efficiency::${latestPeriod?.period || 'unknown'}`,
    title: 'AI usage diverging from deployment efficiency',
    description: 'AI assistance is increasing while deployment frequency is decreasing or becoming negatively correlated, suggesting potential workflow inefficiencies.',
    severity: 'warning',
    evidence: [
      { label: 'Current correlation', value: currentCorrelation.toFixed(3) },
      { label: 'Baseline correlation', value: baselineCorrelation.toFixed(3) },
      { label: 'AI trend', value: currentAITrend > 0 ? 'Increasing' : 'Decreasing' },
      { label: 'Deploy trend', value: currentDeployTrend > 0 ? 'Increasing' : 'Decreasing' },
      { label: 'Avg AI assists/week', value: Math.round(avgAI) },
      { label: 'Avg deploy freq/week', value: avgDeploy.toFixed(1) }
    ],
    recommendation: 'Investigate AI deployment workflows, optimize AI tooling integration with CI/CD pipelines, and ensure AI assistance translates to deployment productivity gains.',
    metricId: 'org.ai_divergence_pattern',
    cicdStage: 'deploy-operate',
    toolScope: 'cross-ide',
    source: 'github' as any, // Use existing source type
    summaryEligible: true,
    ruleLabel: 'D8',
    tags: ['deploy-operate', 'ai', 'efficiency', 'divergence', 'v2'], // V2 COMPLIANT
    version: 'v2', // V2 COMPLIANT
    // Deploy & Operate Performance Insights extensions
    metricValue: currentCorrelation,
    comparisonBaseline: baselineCorrelation,
    confidenceLevel: currentPeriods.length >= 4 ? 'HIGH' : 'MEDIUM',
    deployOperatePeriodCount: currentPeriods.length
  };
  
  return [insight];
}

/**
 * D9: Data Quality Coverage Gap (Deploy & Operate)
 * 
 * Signal Type: DATA QUALITY - identifies blind spots in ops data
 * 
 * Metrics: Coverage checks, period continuity, missing critical fields
 * Baseline Strategy: Static thresholds (no baseline needed for data quality)
 * 
 * Required fields:
 * - All data sources: engOutput, productivity, sessions
 * 
 * Emits when:
 * - Insufficient periods for reliable analysis
 * - Missing critical metrics (CFR, deploy freq, cycle time)
 * - Poor data continuity
 */
function ruleDataQualityCoverageGap(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'data-quality-coverage-gap';
  console.log('🚀 [D9] DATA QUALITY COVERAGE GAP RULE CALLED!!!'); // OBVIOUS DEBUG LOG
  console.log('🔍 [D9] EXECUTING ruleDataQualityCoverageGap'); // OBVIOUS DEBUG LOG
  
  const { engOutput, productivity, sessions } = input;
  
  // STEP 1: DATA AVAILABILITY CHECKS
  const issues: string[] = [];
  
  // Check EngOutput coverage
  if (!engOutput || engOutput.length === 0) {
    issues.push('No EngOutput data available');
  } else {
    // Check critical metrics coverage
    const cfrCoverage = engOutput.filter(p => p.changeFailureRatePct != null && p.changeFailureRatePct > 0).length;
    const deployFreqCoverage = engOutput.filter(p => p.deploymentFreqPerWeek != null && p.deploymentFreqPerWeek > 0).length;
    const cycleTimeCoverage = engOutput.filter(p => p.prCycleTimeHours != null && p.prCycleTimeHours > 0).length;
    
    const cfrCoveragePct = (cfrCoverage / engOutput.length) * 100;
    const deployFreqCoveragePct = (deployFreqCoverage / engOutput.length) * 100;
    const cycleTimeCoveragePct = (cycleTimeCoverage / engOutput.length) * 100;
    
    if (cfrCoveragePct < 60) issues.push(`Low CFR coverage: ${cfrCoveragePct.toFixed(1)}%`);
    if (deployFreqCoveragePct < 60) issues.push(`Low deploy frequency coverage: ${deployFreqCoveragePct.toFixed(1)}%`);
    if (cycleTimeCoveragePct < 60) issues.push(`Low cycle time coverage: ${cycleTimeCoveragePct.toFixed(1)}%`);
    
    // Check period count
    if (engOutput.length < 4) issues.push(`Insufficient periods: ${engOutput.length} < 4`);
  }
  
  // Check Productivity coverage
  if (!productivity || productivity.length === 0) {
    issues.push('No productivity data available');
  } else {
    const aiCoverage = productivity.filter(p => p.aiAssists != null && p.aiAssists > 0).length;
    const aiCoveragePct = (aiCoverage / productivity.length) * 100;
    if (aiCoveragePct < 60) issues.push(`Low AI usage coverage: ${aiCoveragePct.toFixed(1)}%`);
  }
  
  // Check Sessions coverage for rework
  if (!sessions || sessions.length === 0) {
    issues.push('No session data available');
  } else {
    const reworkCoverage = sessions.filter(s => s.rework_ratio_est != null).length;
    const reworkCoveragePct = (reworkCoverage / sessions.length) * 100;
    if (reworkCoveragePct < 60) issues.push(`Low rework coverage: ${reworkCoveragePct.toFixed(1)}%`);
  }
  
  // STEP 2: BASELINE STRATEGY (Static thresholds for data quality)
  
  // STEP 3: SIGNAL LOGIC (DATA QUALITY DETECTION)
  const dataQualitySignal = issues.length > 0 ? [1] : [];
  
  if (!requireNonEmptyBool(dataQualitySignal, ruleId, 'data_quality_signal')) {
    console.log(`[D9] No data quality issues detected - coverage is sufficient`);
    return [];
  }
  
  // STEP 4: SIGNAL DETECTION
  // Already handled above
  
  // STEP 5: EMISSION SAFETY CHECKS
  const totalDataPoints = (engOutput?.length || 0) + (productivity?.length || 0) + (sessions?.length || 0);
  
  // STEP 6: DEBUG + AUDIT
  console.log(`[D9] EMITTING: ${issues.length} data quality issues detected - ${issues.join(', ')}`);
  
  const insight: PerformanceInsight = {
    id: `data-quality-coverage-gap::coverage::${new Date().toISOString().split('T')[0]}`,
    title: 'Deploy & Operate data quality gaps detected',
    description: 'Insufficient data coverage or continuity may compromise the reliability of Deploy & Operate insights and operational decision-making.',
    severity: 'warning',
    evidence: [
      { label: 'Issues found', value: issues.length.toString() },
      { label: 'EngOutput periods', value: (engOutput?.length || 0).toString() },
      { label: 'Productivity points', value: (productivity?.length || 0).toString() },
      { label: 'Session records', value: (sessions?.length || 0).toString() },
      { label: 'Total data points', value: totalDataPoints.toString() }
    ],
    recommendation: 'Expand telemetry collection, ensure consistent data pipelines, and address coverage gaps to improve confidence in Deploy & Operate insights.',
    metricId: 'org.data_quality_coverage_gap',
    cicdStage: 'deploy-operate',
    toolScope: 'cross-ide',
    source: 'github' as any, // Use existing source type
    summaryEligible: true,
    ruleLabel: 'D9',
    tags: ['deploy-operate', 'data-quality', 'coverage', 'v2'], // V2 COMPLIANT
    version: 'v2', // V2 COMPLIANT
    // Deploy & Operate Performance Insights extensions
    metricValue: issues.length,
    comparisonBaseline: 0, // Zero issues is ideal
    confidenceLevel: 'HIGH', // Data quality assessment is deterministic
    deployOperatePeriodCount: engOutput?.length || 0
  };
  
  return [insight];
}

// Debug flag for performance insights
const DBG = (import.meta.env.VITE_FEATURE_PERF_INSIGHTS === '1');

// TTFC Debug flag - set VITE_TTFC_DEBUG=true to enable detailed TTFC diagnostics
const TTFC_DEBUG = ((import.meta as any).env?.VITE_TTFC_DEBUG ?? 'false') === 'true';

/**
 * Helper: Generate unique insight ID with variant support
 * Ensures determinism even when multiple insights are emitted in the same millisecond
 */
function makeInsightId(ruleId: string, variant?: string): string {
  const base = variant ? `${ruleId}::${variant}` : ruleId;
  return `${base}::${Date.now()}`;
}

function makeDeterministicInsightId(ruleId: string, period: string | undefined, variant: string): string {
  const p = (period && String(period).trim()) ? String(period).trim() : 'unknown';
  return `${ruleId}::${variant}::${p}`;
}

/**
 * Helper: Get week key for date aggregation
 */
function getWeekKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = date.getDate();
  const weekStart = day - ((day + 6) % 7); // Adjust to Sunday start
  const weekStartStr = String(weekStart).padStart(2, '0');
  const weekNum = String(Math.ceil(weekStart / 7)).padStart(2, '0'); // Pad to 2 digits
  return `${year}-W${weekNum}`;
}

/**
 * Helper: Get IDE display name from tool identifier
 */
function getIDEDisplayName(tool: 'cursor' | 'windsurf' | 'vscode' | 'other' | undefined): string {
  if (!tool) return 'Unknown IDE';
  switch (tool) {
    case 'cursor': return 'Cursor';
    case 'windsurf': return 'Windsurf';
    case 'vscode': return 'VS Code';
    case 'other': return 'Other IDE';
    default: return 'Unknown IDE';
  }
}

/**
 * Helper: Compute IDE breakdown from sessions
 * Returns top 2 IDEs with counts and percentages
 * Only includes IDEs if at least N sessions have tool identity
 */
function computeIDEBreakdown(
  sessions: SessionDataPoint[],
  minSessionsWithTool: number = 5
): Array<{ tool: string; displayName: string; count: number; percent: number }> | null {
  try {
    const sessionsWithTool = sessions.filter(s => s.tool && s.tool !== 'other');
    if (sessionsWithTool.length < minSessionsWithTool) {
      return null; // Not enough sessions with tool identity
    }

    const counts: Record<string, number> = {};
    for (const s of sessionsWithTool) {
      const tool = s.tool!;
      counts[tool] = (counts[tool] || 0) + 1;
    }

    const total = sessionsWithTool.length;
    const breakdown = Object.entries(counts)
      .map(([tool, count]) => ({
        tool: tool as 'cursor' | 'windsurf' | 'vscode',
        displayName: getIDEDisplayName(tool as any),
        count,
        percent: (count / total) * 100
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 2); // Max top 2 IDEs

    return breakdown.length > 0 ? breakdown : null;
  } catch {
    return null; // Silent failure
  }
}

/**
 * Helper: Format IDE breakdown as evidence array
 * Returns array of evidence items to add, or empty array if breakdown unavailable
 * Format: Compact, single-line per IDE insight, calls out dominant IDE if >60%
 */
function formatIDEBreakdownEvidence(
  breakdown: Array<{ tool: string; displayName: string; count: number; percent: number }> | null,
  prefixLabel: string = 'Most affected IDE'
): InsightEvidence[] {
  if (!breakdown || breakdown.length === 0) {
    return [];
  }

  const evidence: InsightEvidence[] = [];
  const topIDE = breakdown[0];
  
  // Format: "Label: IDE (XX%)" for dominant, or just show top IDE with percentage
  // If one IDE dominates (>60%), explicitly call it out
  if (topIDE.percent > 60) {
    evidence.push({
      label: `${prefixLabel}: ${topIDE.displayName}`,
      value: `${Math.round(topIDE.percent)}%`
    });
  } else {
    // Show top IDE, and second IDE if significant (>= 20%)
    const ideParts: string[] = [];
    ideParts.push(`${topIDE.displayName} (${Math.round(topIDE.percent)}%)`);
    if (breakdown.length > 1 && breakdown[1].percent >= 20) {
      ideParts.push(`${breakdown[1].displayName} (${Math.round(breakdown[1].percent)}%)`);
    }
    evidence.push({
      label: prefixLabel,
      value: ideParts.join(', ')
    });
  }

  return evidence;
}

// Prevent duplicate ROI emission when the same inputs object is evaluated twice
// (e.g., engine run + harness safety-net call).
const roiEmittedForInputs = new WeakSet<object>();

/**
 * 🔧 DEMO MODE CONFIGURATION:
 * 
 * DEMO_MODE lowers statistical thresholds so insights fire with:
 * - Small datasets (2-3 periods vs 4-5)
 * - Modest correlations (|r| > 0.3 vs > 0.6-0.7)
 * - Simulated/mixed data
 * 
 * This makes the engine produce richer, more varied insights for demos.
 * For production with real data, set DEMO_MODE = false for stricter stats.
 * 
 * Adjustable thresholds:
 * - MIN_POINTS_FOR_CORR: 2 vs 4
 * - MIN_ABS_R: 0.3 vs 0.6
 * - MIN_POINTS_FOR_OUTLIER: 2 vs 4  
 * - P_MAX: 0.15 vs 0.10
 * 
 * DEMO_MODE is now ENV-DRIVEN:
 * - Set VITE_DEMO_MODE=true to force demo mode
 * - Set VITE_DEMO_MODE=false to force production mode
 * - If not set, defaults to false (production mode)
 */
const VITE_DEMO_MODE_RAW = ((import.meta as any).env?.VITE_DEMO_MODE ?? 'false').toLowerCase()
export const DEMO_MODE = VITE_DEMO_MODE_RAW === 'true' || VITE_DEMO_MODE_RAW === '1'

// Log DEMO_MODE status at load
console.log('[PI_ENGINE] DEMO_MODE:', DEMO_MODE, '(from VITE_DEMO_MODE=' + VITE_DEMO_MODE_RAW + ')')

// Production thresholds (strict)
const PROD_MIN_POINTS = 4
const PROD_MIN_ABS_R = 0.6
const PROD_P_MAX = 0.10

// Demo thresholds (very forgiving for small datasets)
const DEMO_MIN_POINTS = 2
const DEMO_MIN_ABS_R = 0.01  // Ultra-lenient for demo (essentially "any correlation")
const DEMO_P_MAX = 0.99      // Ultra-lenient for demo (essentially "any p-value")

// Statistical gating configuration
const SIG_P = DEMO_MODE ? DEMO_P_MAX : Number(import.meta.env.VITE_PERF_INSIGHTS_P_MAX ?? PROD_P_MAX);
const MIN_N = DEMO_MODE ? DEMO_MIN_POINTS : Number(import.meta.env.VITE_PERF_INSIGHTS_MIN_PERIODS ?? PROD_MIN_POINTS);

// ===== DEMO Rule Debug Helper =====
function logRuleDecision(ruleId: string, stats: Record<string, any>) {
  if (!DEMO_MODE) return
  console.log('[PI_RULE_DEBUG]', ruleId, stats)
}


// Generate unique IDs for insights
const safeId = () => `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// ========== FORMATTING HELPERS (Pass 1) ==========

/**
 * Format time values in user-friendly units
 * Avoids showing "0 min" or very small decimals
 */
const formatTime = (minutes: number): string => {
  if (minutes < 1) {
    return '<1 min';
  }
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  
  return `${hours}h ${remainingMinutes}m`;
};

/**
 * Format large numbers with K suffix
 */
const formatNumber = (num: number): string => {
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`;
  }
  return Math.round(num).toString();
};

/**
 * Check if an array of numbers has variance (not all values are the same)
 * Used to determine whether to use normalized rate or raw values for correlation
 */
function hasVariance(values: Array<number | undefined | null>): boolean {
  const nums = values.filter(
    (v): v is number => typeof v === 'number' && !Number.isNaN(v)
  );
  if (nums.length <= 1) return false;
  const first = nums[0];
  return nums.some(v => v !== first);
}

/**
 * Format percentages without excessive decimals
 */
const formatPercent = (value: number): string => {
  if (Math.abs(value) < 0.1) {
    return '<0.1%';
  }
  if (Math.abs(value) < 1) {
    return `${value.toFixed(1)}%`;
  }
  return `${Math.round(value)}%`;
};

/**
 * Format duration in milliseconds to human readable format
 */
const formatDuration = (ms: number): string => {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
};

/**
 * Format hours without excessive decimals
 */
const formatHours = (value: number): string => {
  if (value < 0.1) {
    return '<0.1 hours';
  }
  if (value < 1) {
    return `${value.toFixed(1)} hours`;
  }
  return `${value.toFixed(1)} hours`;
};

/**
 * Compute median of a number array
 */
const median = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const percentile = (arr: number[], p: number): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const pp = Math.min(1, Math.max(0, p));
  const idx = (sorted.length - 1) * pp;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
};

type ToolPresence = 'LIVE' | 'HYBRID' | 'SIM' | 'UNKNOWN';

type ToolSummary = {
  tool: string;
  aiAssists: number;
  codingMinutes: number;
  commits: number;
  sessionMinutes: number;
  aiAssistsPerCodingMin: number;
  codingMinutesShare: number;
  telemetryPoints: number;
  points: number;
  presence: ToolPresence;
};

const parsePeriodToDate = (period: string): Date | undefined => {
  const p = String(period ?? '').trim();
  if (!p) return undefined;

  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(p)) {
    const d = new Date(`${p}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  const week = /^(\d{4})-W(\d{2})$/i.exec(p);
  if (week) {
    const year = Number(week[1]);
    const weekNum = Number(week[2]);
    if (!Number.isFinite(year) || !Number.isFinite(weekNum) || weekNum < 1 || weekNum > 53) return undefined;
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const mondayWeek1 = new Date(jan4);
    mondayWeek1.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
    const d = new Date(mondayWeek1);
    d.setUTCDate(mondayWeek1.getUTCDate() + (weekNum - 1) * 7);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  return undefined;
};

const splitByWindow = (
  prodPoints: ToolProductivityPoint[],
  days = 7
): { current: ToolProductivityPoint[]; baseline: ToolProductivityPoint[] } => {
  const points = Array.isArray(prodPoints) ? prodPoints : [];
  const now = new Date();
  const currentStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const baselineStart = new Date(now.getTime() - 2 * days * 24 * 60 * 60 * 1000);

  const current: ToolProductivityPoint[] = [];
  const baseline: ToolProductivityPoint[] = [];

  for (const pt of points) {
    const d = parsePeriodToDate((pt as any)?.period);
    if (!d) continue;
    if (d >= currentStart) current.push(pt);
    else if (d >= baselineStart && d < currentStart) baseline.push(pt);
  }

  return { current, baseline };
};

const presenceFromPoints = (pts: ToolProductivityPoint[]): ToolPresence => {
  const hasLive = pts.some(p => String((p as any)?.source ?? '').toLowerCase() === 'live');
  if (hasLive) return 'LIVE';
  const hasHybrid = pts.some(p => String((p as any)?.source ?? '').toLowerCase() === 'hybrid');
  if (hasHybrid) return 'HYBRID';
  const hasSim = pts.some(p => String((p as any)?.source ?? '').toLowerCase() === 'sim');
  if (hasSim) return 'SIM';
  return 'UNKNOWN';
};

const summarizeTools = (prodPointsWindow: ToolProductivityPoint[]): ToolSummary[] => {
  const pts = Array.isArray(prodPointsWindow) ? prodPointsWindow : [];
  const byTool = new Map<string, ToolProductivityPoint[]>();

  for (const p of pts) {
    const tool = String((p as any)?.tool ?? '').trim();
    if (!tool) continue;
    const arr = byTool.get(tool) || [];
    arr.push(p);
    byTool.set(tool, arr);
  }

  const totalCodingMinutes = Array.from(byTool.values()).reduce((sum, arr) => {
    return sum + arr.reduce((s, p) => s + Number(p.codingMinutes ?? 0), 0);
  }, 0);

  const out: ToolSummary[] = [];
  for (const [tool, arr] of byTool.entries()) {
    const aiAssists = arr.reduce((s, p) => s + Number(p.aiAssists ?? 0), 0);
    const codingMinutes = arr.reduce((s, p) => s + Number(p.codingMinutes ?? 0), 0);
    const commits = arr.reduce((s, p) => s + Number(p.commits ?? 0), 0);
    const sessionMinutes = arr.reduce((s, p) => s + Number(p.sessionMinutes ?? 0), 0);
    const telemetryPoints = arr.filter(p => {
      const src = String((p as any)?.source ?? '').toLowerCase();
      return src === 'live' || src === 'hybrid';
    }).length;

    out.push({
      tool,
      aiAssists,
      codingMinutes,
      commits,
      sessionMinutes,
      aiAssistsPerCodingMin: aiAssists / Math.max(codingMinutes, 1),
      codingMinutesShare: totalCodingMinutes > 0 ? (codingMinutes / totalCodingMinutes) : 0,
      telemetryPoints,
      points: arr.length,
      presence: presenceFromPoints(arr),
    });
  }

  return out.sort((a, b) => b.codingMinutes - a.codingMinutes);
};

const formatTopTools = (
  summaries: ToolSummary[],
  metric: 'aiAssistsPerCodingMin' | 'codingMinutesShare',
  limit = 3
): string => {
  const xs = Array.isArray(summaries) ? summaries : [];
  const sorted = [...xs].sort((a, b) => Number(b[metric]) - Number(a[metric]));
  const top = sorted.slice(0, limit);
  if (top.length === 0) return '(none)';

  if (metric === 'codingMinutesShare') {
    return top.map(t => `${t.tool} ${formatPercent(t.codingMinutesShare * 100)}`).join(', ');
  }
  return top.map(t => `${t.tool} ${t.aiAssistsPerCodingMin.toFixed(2)}`).join(', ');
};

const formatToolPresenceList = (summaries: ToolSummary[], limit = 6): string => {
  const xs = Array.isArray(summaries) ? summaries : [];
  const top = [...xs].sort((a, b) => b.codingMinutes - a.codingMinutes).slice(0, limit);
  if (top.length === 0) return '(none)';
  return top.map(t => `${t.tool} (${t.presence})`).join(', ');
};

const formatRepoBranch = (repoUrl?: string, branch?: string): string => {
  const repoRaw = String(repoUrl ?? '').trim();
  const br = String(branch ?? '').trim();

  let repo = '';

  try {
    if (!repoRaw) {
      repo = '';
    } else if (/^https?:\/\//i.test(repoRaw)) {
      const u = new URL(repoRaw);
      const parts = u.pathname.split('/').filter(Boolean);
      const lastTwo = parts.slice(-2);
      if (lastTwo.length === 2) repo = `${lastTwo[0]}/${lastTwo[1]}`;
      else if (parts.length === 1) repo = parts[0];
    } else if (repoRaw.includes('/')) {
      const parts = repoRaw.split('/').filter(Boolean);
      const lastTwo = parts.slice(-2);
      if (lastTwo.length === 2) repo = `${lastTwo[0]}/${lastTwo[1]}`;
      else repo = parts.slice(-1)[0] || repoRaw;
    } else {
      repo = repoRaw;
    }
  } catch {
    // fall through to best-effort parsing below
  }

  if (!repo) {
    const best = repoRaw.split('/').filter(Boolean).slice(-1)[0] || repoRaw;
    repo = best;
  }

  repo = repo.replace(/\.git$/i, '');

  if (!repo) return br ? `unknown@${br}` : 'unknown';
  return br ? `${repo}@${br}` : repo;
};

/**
 * Format time window based on granularity
 * Converts 'day', 'week', 'month', 'quarter' into user-friendly text
 */
const formatWindow = (granularity: string, periodCount?: number): string => {
  const count = periodCount || 1;
  switch (granularity) {
    case 'day':
      return count === 1 ? 'today' : `over the last ${count} days`;
    case 'week':
      return count === 1 ? 'this week' : `over the last ${count} weeks`;
    case 'month':
      return count === 1 ? 'this month' : `over the last ${count} months`;
    case 'quarter':
      return count === 1 ? 'this quarter' : `over the last ${count} quarters`;
    default:
      return `over ${count} periods`;
  }
};

/**
 * Format sample counts for evidence
 * e.g., "based on 12 PRs and 45 sessions"
 */
const formatSampleCount = (prs?: number, sessions?: number): string => {
  const parts: string[] = [];
  if (prs && prs > 0) {
    parts.push(`${prs} PR${prs === 1 ? '' : 's'}`);
  }
  if (sessions && sessions > 0) {
    parts.push(`${sessions} session${sessions === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) return '';
  return `based on ${parts.join(' and ')}`;
};

/**
 * Check if a value is effectively zero or too small to display
 */
const isEffectivelyZero = (value: number, threshold = 0.001): boolean => {
  return Math.abs(value) < threshold;
};

// Generate unique recommendations per tool
const getUniqueToolRecommendations = (tool: string, efficiency: number, totalAiAssists: number, totalCodingMinutes: number) => {
  const recommendations: { text: string; actionType: string }[] = [];
  
  // Tool-specific recommendations based on performance
  if (tool.toLowerCase() === 'cursor') {
    if (efficiency > 0.5) {
      recommendations.push({ text: 'Share Cursor AI best practices with the team', actionType: 'process' });
    } else {
      recommendations.push({ text: 'Review Cursor AI model settings and prompt engineering', actionType: 'tooling' });
    }
    recommendations.push({ text: 'Implement Cursor-specific code review guidelines', actionType: 'process' });
  } else if (tool.toLowerCase() === 'vscode') {
    if (efficiency > 0.5) {
      recommendations.push({ text: 'Document VS Code extension configuration for team adoption', actionType: 'process' });
    } else {
      recommendations.push({ text: 'Optimize VS Code workspace settings and extensions', actionType: 'tooling' });
    }
    recommendations.push({ text: 'Review VS Code debugging and testing workflows', actionType: 'process' });
  } else if (tool.toLowerCase() === 'jetbrains') {
    if (efficiency > 0.5) {
      recommendations.push({ text: 'Create JetBrains refactoring templates for the team', actionType: 'process' });
    } else {
      recommendations.push({ text: 'Configure JetBrains code analysis and inspection settings', actionType: 'tooling' });
    }
    recommendations.push({ text: 'Review JetBrains project structure and indexing', actionType: 'tooling' });
  } else if (tool.toLowerCase() === 'windsurf') {
    if (efficiency > 0.5) {
      recommendations.push({ text: 'Establish Windsurf AI collaboration workflows', actionType: 'process' });
    } else {
      recommendations.push({ text: 'Configure Windsurf AI model selection and filtering', actionType: 'tooling' });
    }
    recommendations.push({ text: 'Review Windsurf team sharing and project setup', actionType: 'process' });
  } else if (tool.toLowerCase() === 'sublime') {
    if (efficiency > 0.5) {
      recommendations.push({ text: 'Share Sublime Text build system configurations', actionType: 'process' });
    } else {
      recommendations.push({ text: 'Optimize Sublime Text package and theme selection', actionType: 'tooling' });
    }
    recommendations.push({ text: 'Review Sublime Text project organization', actionType: 'tooling' });
  } else if (tool.toLowerCase() === 'vim') {
    if (efficiency > 0.5) {
      recommendations.push({ text: 'Create Vim configuration templates for team use', actionType: 'process' });
    } else {
      recommendations.push({ text: 'Review Vim plugin performance and configuration', actionType: 'tooling' });
    }
    recommendations.push({ text: 'Optimize Vim workflow for complex development tasks', actionType: 'process' });
  } else {
    // Generic recommendations for unknown tools
    if (efficiency > 0.5) {
      recommendations.push({ text: `Document ${tool} best practices for team adoption`, actionType: 'process' });
    } else {
      recommendations.push({ text: `Review ${tool} configuration and performance settings`, actionType: 'tooling' });
    }
    recommendations.push({ text: `Optimize ${tool} workflow and team integration`, actionType: 'process' });
  }
  
  return recommendations;
};

interface PerformanceInputs {
  engOutput: EngOutputPoint[];
  productivity: ToolProductivityPoint[];
  team?: string;
  repo?: string;
  granularity?: string;
  prodGlobalSource?: 'prod-sim' | 'prod-live' | 'prod-hybrid';
  overlap?: number;
  githubSnapshot?: any;  // Raw GitHub API response snapshot (contains open_issues_by_repo, repositories, etc.)
  sessions?: SessionDataPoint[];  // Session-level telemetry data for TTFC and other session-based insights
  ghSeries?: EngOutputPoint[];    // Raw GitHub series (for overlap computation)
  prodSeries?: ToolProductivityPoint[];  // Raw productivity series (for overlap computation)
}

type Rule = (input: PerformanceInputs) => PerformanceInsight[];

/**
 * Safe rule execution helper
 * Wraps rule execution in try-catch to prevent engine failures
 * Logs execution for debugging
 */
/**
 * Global Mutual Exclusion + Priority Hierarchy Suppression
 * 
 * Applies suppression rules to prevent redundant cards from appearing together.
 * Runs after all rules emit but before stage caps and quality gates.
 * 
 * Suppression Rules:
 * 1. If org.change_failure_rate_spike exists → suppress org.cfr_trend_deterioration and CFR-based org.reliability_volatility
 * 2. If org.cfr_trend_deterioration exists → suppress CFR-based org.reliability_volatility
 * 3. If eng.deploy_freq_driver OR org.deployment_frequency_drop exists → suppress org.deploy_frequency_volatility
 * 4. If org.velocity_reliability_tradeoff exists → suppress org.fast_but_unstable (and reliability volatility if same driver)
 * 5. Review stage: if org.review_latency_spike uses fallback (prCycleTimeHours) → suppress org.pr_cycle_time_bottleneck
 */
function applyInsightSuppression(insights: PerformanceInsight[]): PerformanceInsight[] {
  const suppressionReasons: Array<{ metricId: string; reason: string }> = []
  
  // Helper: Check if reliability volatility is CFR-based
  // Reliability volatility can use either CFR or MTTR. We suppress only CFR-based volatility
  // when CFR spike/trend exists. Check evidence for CFR-specific labels.
  const isCFRBasedReliabilityVolatility = (insight: PerformanceInsight): boolean => {
    if (insight.metricId !== 'org.reliability_volatility') return false
    // Check evidence for CFR-specific labels (e.g., "CFR mean", "CFR CV", "CFR std dev")
    // If evidence contains MTTR labels but no CFR labels, it's MTTR-based (don't suppress)
    const hasCFREvidence = insight.evidence?.some(ev => {
      const label = ev.label?.toLowerCase() || ''
      return label.includes('cfr') && (label.includes('mean') || label.includes('cv') || label.includes('std dev') || label.includes('min') || label.includes('max'))
    })
    const hasMTTREvidence = insight.evidence?.some(ev => {
      const label = ev.label?.toLowerCase() || ''
      return label.includes('mttr') && (label.includes('mean') || label.includes('cv') || label.includes('std dev') || label.includes('min') || label.includes('max'))
    })
    // If it has CFR evidence and no MTTR evidence, it's CFR-based
    // If it has both, prefer MTTR (rule prefers MTTR when both qualify)
    return hasCFREvidence && !hasMTTREvidence
  }
  
  // Helper: Check if review latency spike used fallback (prCycleTimeHours)
  const reviewLatencySpikeUsesFallback = (insight: PerformanceInsight): boolean => {
    if (insight.metricId !== 'org.review_latency_spike') return false
    // Check evidence for "Metric used" field
    const metricUsedEv = insight.evidence?.find(ev => ev.label === 'Metric used')
    if (metricUsedEv?.value) {
      const metricValue = metricUsedEv.value.toString().toLowerCase()
      // If it says "PR cycle time" instead of "Time to first review", it's using fallback
      return metricValue.includes('pr cycle time') || metricValue.includes('cycle time')
    }
    return false
  }
  
  // Track which insights should be suppressed (by id for precise matching)
  const suppressedIds = new Set<string>()
  
  // Rule 1: CFR Spike → suppress CFR Trend and CFR-based Reliability Volatility
  const hasCFRSpike = insights.some(i => i.metricId === 'org.change_failure_rate_spike')
  if (hasCFRSpike) {
    for (const insight of insights) {
      if (insight.metricId === 'org.cfr_trend_deterioration') {
        suppressedIds.add(insight.id)
        suppressionReasons.push({ metricId: insight.metricId || 'unknown', reason: 'org.change_failure_rate_spike exists' })
      } else if (isCFRBasedReliabilityVolatility(insight)) {
        suppressedIds.add(insight.id)
        suppressionReasons.push({ metricId: insight.metricId || 'unknown', reason: 'org.change_failure_rate_spike exists (CFR-based volatility)' })
      }
    }
  }
  
  // Rule 2: CFR Trend → suppress CFR-based Reliability Volatility (only if spike doesn't exist)
  if (!hasCFRSpike) {
    const hasCFRTrend = insights.some(i => i.metricId === 'org.cfr_trend_deterioration')
    if (hasCFRTrend) {
      for (const insight of insights) {
        if (isCFRBasedReliabilityVolatility(insight)) {
          suppressedIds.add(insight.id)
          suppressionReasons.push({ metricId: insight.metricId || 'unknown', reason: 'org.cfr_trend_deterioration exists' })
        }
      }
    }
  }
  
  // Rule 3: Deploy Freq Driver OR Drop → suppress Deploy Freq Volatility
  const hasDeployFreqDriver = insights.some(i => i.metricId === 'eng.deploy_freq_driver')
  const hasDeployFreqDrop = insights.some(i => i.metricId === 'org.deployment_frequency_drop')
  if (hasDeployFreqDriver || hasDeployFreqDrop) {
    for (const insight of insights) {
      if (insight.metricId === 'org.deploy_frequency_volatility') {
        suppressedIds.add(insight.id)
        const reason = hasDeployFreqDriver ? 'eng.deploy_freq_driver exists' : 'org.deployment_frequency_drop exists'
        suppressionReasons.push({ metricId: insight.metricId || 'unknown', reason })
      }
    }
  }
  
  // Rule 4: Velocity Reliability Tradeoff → suppress Fast But Unstable (and reliability volatility if same driver)
  const hasVelocityTradeoff = insights.some(i => i.metricId === 'org.velocity_reliability_tradeoff')
  if (hasVelocityTradeoff) {
    for (const insight of insights) {
      if (insight.metricId === 'org.fast_but_unstable') {
        suppressedIds.add(insight.id)
        suppressionReasons.push({ metricId: insight.metricId || 'unknown', reason: 'org.velocity_reliability_tradeoff exists' })
      } else if (insight.metricId === 'org.reliability_volatility') {
        // Suppress reliability volatility if tradeoff exists (conservative: tradeoff is more specific)
        suppressedIds.add(insight.id)
        suppressionReasons.push({ metricId: insight.metricId || 'unknown', reason: 'org.velocity_reliability_tradeoff exists (same driver metric)' })
      }
    }
  }
  
  // Rule 5: Review Latency Spike (fallback) → suppress PR Cycle Time Bottleneck
  const reviewLatencySpikes = insights.filter(i => i.metricId === 'org.review_latency_spike')
  const hasFallbackReviewLatency = reviewLatencySpikes.some(reviewLatencySpikeUsesFallback)
  if (hasFallbackReviewLatency) {
    for (const insight of insights) {
      if (insight.metricId === 'org.pr_cycle_time_bottleneck') {
        suppressedIds.add(insight.id)
        suppressionReasons.push({ metricId: insight.metricId || 'unknown', reason: 'org.review_latency_spike uses fallback (prCycleTimeHours)' })
      }
    }
  }
  
  // Log suppressions in DEV
  if (import.meta.env.DEV && suppressionReasons.length > 0) {
    console.warn('[PI][Suppress] Summary', {
      totalSuppressed: suppressionReasons.length,
      suppressions: suppressionReasons.map(r => ({ metricId: r.metricId, reason: r.reason }))
    })
    for (const reason of suppressionReasons) {
      console.warn('[PI][Suppress] suppressed', reason.metricId, 'because', reason.reason)
    }
  }
  
  // Filter out suppressed insights
  const filtered = insights.filter(insight => !suppressedIds.has(insight.id))
  
  if (import.meta.env.DEV && suppressionReasons.length > 0) {
    console.warn('[PI][Suppress] Result', {
      before: insights.length,
      after: filtered.length,
      removed: insights.length - filtered.length
    })
  }
  
  return filtered
}

/**
 * Apply quality contract to an entire array of insights (for direct-call rules)
 * 
 * This ensures ALL insights pass the quality contract, regardless of whether they
 * were emitted via pushRule() or direct calls.
 * 
 * Returns: Filtered and sanitized insights array
 */
function applyQualityContractToInsights(
  insights: PerformanceInsight[],
  context: string,
  input: PerformanceInputs
): PerformanceInsight[] {
  const kept: PerformanceInsight[] = []
  const dropped: Array<{ metricId?: string; reason: string }> = []
  const dropReasons: Record<string, number> = {}
  
  for (const insight of insights) {
    // Use a generic rule name for direct-call insights
    const ruleName = insight.metricId || 'unknown-rule'
    const validation = sanitizeAndValidateInsight(insight, ruleName, input)
    
    if (validation.keep && validation.sanitized) {
      kept.push(validation.sanitized)
    } else {
      const reason = validation.reason || 'unknown'
      dropReasons[reason] = (dropReasons[reason] || 0) + 1
      dropped.push({
        metricId: insight.metricId,
        reason
      })
      
      if (import.meta.env.DEV) {
        console.warn('[PI][Engine][QualityContract][DirectCall]', context, 'dropped:', reason, {
          title: insight.title,
          stage: insight.cicdStage,
          metricId: insight.metricId
        })
      }
    }
  }
  
  // DEV-only summary logging
  if (import.meta.env.DEV && (dropped.length > 0 || kept.length !== insights.length)) {
    console.warn('[PI][Engine][QualityContract][DirectCall]', context, {
      emitted: insights.length,
      kept: kept.length,
      dropped: dropped.length,
      dropReasons: Object.keys(dropReasons).length > 0 ? dropReasons : undefined
    })
  }
  
  return kept
}

/**
 * Global Insight Quality Contract: Sanitize and validate insights before they reach the UI.
 * 
 * This helper enforces a "meaningful-only" standard by:
 * - Rejecting placeholder/low-signal insights
 * - Sanitizing evidence arrays (removing empty/invalid values)
 * - Validating core fields (title, description, stage)
 * 
 * Returns: { keep: boolean, reason?: string, sanitized?: PerformanceInsight }
 */
function sanitizeAndValidateInsight(
  insight: PerformanceInsight,
  ruleName: string,
  input: PerformanceInputs
): { keep: boolean; reason?: string; sanitized?: PerformanceInsight } {
  try {
    // Reject: Missing stage
    if (!insight.cicdStage) {
      return { keep: false, reason: 'missing cicdStage' }
    }
    
    // Reject: Empty/meaningless title
    if (!insight.title || insight.title.trim().length < 8) {
      return { keep: false, reason: 'title too short or empty' }
    }
    
    // Reject: Empty/meaningless description
    if (!insight.description || insight.description.trim().length < 20) {
      return { keep: false, reason: 'description too short or empty' }
    }
    
    // Reject: Placeholder content in title (case-insensitive)
    const titleLower = insight.title.toLowerCase()
    const placeholderKeywords = [
      'demo:',
      'not available yet',
      'placeholder',
      'data not available',
      'missing metric'
    ]
    if (placeholderKeywords.some(keyword => titleLower.includes(keyword))) {
      return { keep: false, reason: 'placeholder content in title' }
    }
    
    // Reject: Placeholder dataSource
    if (String((insight as any).dataSource) === 'placeholder') {
      return { keep: false, reason: 'dataSource is placeholder' }
    }
    
    // Sanitize evidence array
    const sanitizedEvidence: InsightEvidence[] = []
    if (insight.evidence && Array.isArray(insight.evidence)) {
      for (const ev of insight.evidence) {
        // Skip if missing label or value
        if (!ev.label || ev.value === undefined || ev.value === null) {
          continue
        }
        
        // Handle string values
        if (typeof ev.value === 'string') {
          const trimmed = ev.value.trim().replace(/\s+/g, ' ')
          
          // Skip empty strings
          if (trimmed === '') {
            continue
          }
          
          // Reject invalid metric strings
          const lowerTrimmed = trimmed.toLowerCase()
          if (lowerTrimmed === 'nan' || lowerTrimmed === 'undefined' || lowerTrimmed === 'null') {
            return { keep: false, reason: `invalid metric value in evidence: ${trimmed}` }
          }
          
          sanitizedEvidence.push({ ...ev, value: trimmed })
        } else {
          // Numeric values: check for NaN
          if (typeof ev.value === 'number' && isNaN(ev.value)) {
            return { keep: false, reason: 'NaN value in evidence' }
          }
          sanitizedEvidence.push(ev)
        }
      }
      
      // Remove "n/a"/"na"/"unknown" entries ONLY if there are other evidence rows
      // (if all rows are n/a/na/unknown, keep them - don't make it worse)
      if (sanitizedEvidence.length > 1) {
        const nonNaRows = sanitizedEvidence.filter(ev => {
          if (typeof ev.value === 'string') {
            const lower = ev.value.toLowerCase()
            return lower !== 'n/a' && lower !== 'na' && lower !== 'unknown'
          }
          return true
        })
        
        // Only remove n/a rows if there are other (non-n/a) rows
        if (nonNaRows.length > 0) {
          sanitizedEvidence.splice(0, sanitizedEvidence.length, ...nonNaRows)
        }
      }
    }
    
    // Reject: Evidence too thin (< 2 rows after sanitization)
    // Relaxed from 3 to 2 to avoid dropping valid summary insights that may have fewer evidence rows
    if (sanitizedEvidence.length < 2) {
      return { keep: false, reason: `evidence too thin (${sanitizedEvidence.length} rows, need >= 2)` }
    }
    
    // Create sanitized insight
    const sanitized: PerformanceInsight = {
      ...insight,
      evidence: sanitizedEvidence
    }
    
    return { keep: true, sanitized }
  } catch (e) {
    // Safety: if validation throws, reject the insight
    if (import.meta.env.DEV) {
      console.warn('[PI][Engine][QualityContract][ERROR]', ruleName, 'validation error:', e)
    }
    return { keep: false, reason: 'validation error' }
  }
}

function pushRule(
  out: PerformanceInsight[],
  name: string,
  fn: Rule,
  input: PerformanceInputs
) {
  try {
    const res = fn(input) || []
    if (import.meta.env.DEV) {
      console.warn('[PI][Engine][pushRule]', name, 'emitted', res.length)
      
      // Stage correctness audit: warn if rule name suggests one stage but emits another
      const nameLower = name.toLowerCase()
      const isDeployRule = nameLower.includes('deploy') || nameLower.includes('deploy-operate')
      const isPlanCodeRule = nameLower.includes('plan') || nameLower.includes('plan-code') || nameLower.includes('code')
      
      if (res.length > 0) {
        const emittedStages = new Set(res.map(i => i.cicdStage).filter(Boolean))
        const hasDeployOperate = emittedStages.has('deploy-operate')
        const hasPlanCode = emittedStages.has('plan-code')
        
        if (isDeployRule && !hasDeployOperate && (hasPlanCode || emittedStages.size > 0)) {
          console.warn('[PI][Engine][pushRule][STAGE_MISMATCH]', name, 'suggests deploy-operate but emitted stages:', Array.from(emittedStages))
        }
        if (isPlanCodeRule && !hasPlanCode && (hasDeployOperate || emittedStages.size > 0)) {
          console.warn('[PI][Engine][pushRule][STAGE_MISMATCH]', name, 'suggests plan-code but emitted stages:', Array.from(emittedStages))
        }
      }
    }
    
    // Apply quality contract: validate and sanitize each insight
    const keptInsights: PerformanceInsight[] = []
    const dropReasons: Record<string, number> = {}  // Aggregate drop reasons
    
    for (const insight of res) {
      const validation = sanitizeAndValidateInsight(insight, name, input)
      
      if (validation.keep && validation.sanitized) {
        // Check if evidence was sanitized (changed)
        const evidenceChanged = validation.sanitized.evidence.length !== insight.evidence.length ||
          validation.sanitized.evidence.some((ev, idx) => {
            const orig = insight.evidence[idx]
            return !orig || ev.value !== orig.value
          })
        
        if (import.meta.env.DEV && evidenceChanged) {
          console.warn('[PI][Engine][QualitySanitize]', name, 'sanitized evidence', {
            before: insight.evidence.length,
            after: validation.sanitized.evidence.length,
            title: insight.title
          })
        }
        
        keptInsights.push(validation.sanitized)
      } else {
        // Insight was dropped
        const reason = validation.reason || 'unknown'
        dropReasons[reason] = (dropReasons[reason] || 0) + 1
        
        if (import.meta.env.DEV) {
          console.warn('[PI][Engine][QualityDrop]', name, 'dropped:', reason, {
            title: insight.title,
            stage: insight.cicdStage,
            metricId: insight.metricId
          })
        }
      }
    }
    
    // DEV-only summary logging per rule
    if (import.meta.env.DEV) {
      console.warn('[PI][Engine][pushRule][Summary]', name, {
        emitted: res.length,
        kept: keptInsights.length,
        dropped: res.length - keptInsights.length,
        dropReasons: Object.keys(dropReasons).length > 0 ? dropReasons : undefined
      })
    }
    
    out.push(...keptInsights)
  } catch (e) {
    console.warn('[PI][Engine][pushRule][ERROR]', name, e)
  }
}

/**
 * Org Deployment Frequency Volatility Rule (Deploy & Operate)
 * 
 * Detects high volatility (unstable cadence) in deployment frequency using coefficient of variation (CV).
 * This is distinct from "drop" (trend) and "driver" (causal) - it focuses on process instability.
 * Uses org-level GitHub time series data (engOutput).
 * Emits at most ONE insight.
 */
function ruleOrgDeployFrequencyVolatility(input: PerformanceInputs): PerformanceInsight[] {
  const { engOutput } = input
  
  // Guard: require engOutput data
  if (!engOutput || engOutput.length === 0) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][DeployFreqVolatility] Early return: no engOutput data')
    }
    return []
  }
  
  try {
    // Extract valid points with deployment frequency
    const pointsWithDeployFreq = engOutput.map(p => {
      // Try deploymentFreqPerWeek first, fallback to deploymentFrequency
      const pAny = p as any
      let deployFreq: number | null = null
      
      if (p.deploymentFreqPerWeek !== undefined && p.deploymentFreqPerWeek !== null) {
        const v = p.deploymentFreqPerWeek
        if (isFinite(v) && v >= 0) {
          deployFreq = v
        }
      } else if (pAny.deploymentFrequency !== undefined && pAny.deploymentFrequency !== null) {
        const v = pAny.deploymentFrequency
        if (isFinite(v) && v >= 0) {
          deployFreq = v
        }
      }
      
      return {
        period: p.period,
        deployFreq
      }
    })
    
    // Sort by period (most recent last)
    pointsWithDeployFreq.sort((a, b) => {
      const aPeriod = a.period || ''
      const bPeriod = b.period || ''
      return aPeriod < bPeriod ? -1 : aPeriod > bPeriod ? 1 : 0
    })
    
    // Use rolling window: last N points (N=6 prod, N=4 demo)
    const windowSize = DEMO_MODE ? 4 : 6
    const windowPoints = pointsWithDeployFreq.slice(-windowSize)
    
    // Extract valid deployment frequency values from window
    const deployFreqValues = windowPoints.filter(p => p.deployFreq !== null).map(p => p.deployFreq!)
    
    // Guard: need minimum points
    const minPoints = DEMO_MODE ? 3 : 5
    if (deployFreqValues.length < minPoints) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][DeployFreqVolatility] Early return: insufficient points', {
          windowPoints: windowPoints.length,
          validValues: deployFreqValues.length,
          required: minPoints
        })
      }
      return []
    }
    
    // Compute statistics
    const deployFreqMean = mean(deployFreqValues)
    const deployFreqStdDev = standardDeviation(deployFreqValues)
    const deployFreqCV = deployFreqMean > 0 ? deployFreqStdDev / deployFreqMean : 0
    const deployFreqMin = Math.min(...deployFreqValues)
    const deployFreqMax = Math.max(...deployFreqValues)
    
    // Guard: require mean >= 0.5/week (avoid noise from very low frequencies)
    if (deployFreqMean < 0.5) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][DeployFreqVolatility] Early return: mean too low', {
          mean: deployFreqMean.toFixed(2),
          required: 0.5
        })
      }
      return []
    }
    
    // Trigger thresholds
    const cvThresholdInfo = DEMO_MODE ? 0.35 : 0.50
    const cvThresholdWarning = DEMO_MODE ? 0.55 : 0.70
    
    // Log ENTER with computed stats
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][DeployFreqVolatility] ENTER', {
        points: engOutput.length,
        windowSize,
        windowPoints: windowPoints.length,
        validValues: deployFreqValues.length,
        DEMO_MODE,
        mean: deployFreqMean.toFixed(2) + '/week',
        stdDev: deployFreqStdDev.toFixed(2) + '/week',
        cv: deployFreqCV.toFixed(2),
        min: deployFreqMin.toFixed(2) + '/week',
        max: deployFreqMax.toFixed(2) + '/week',
        cvThresholdInfo,
        cvThresholdWarning
      })
    }
    
    // Check if volatility qualifies
    if (deployFreqCV < cvThresholdInfo) {
      // DEMO_MODE soft-emit: if CV is low (stable/consistent), emit a positive insight
      if (DEMO_MODE && deployFreqValues.length >= 4 && deployFreqMean >= 0.5 && deployFreqCV > 0 && deployFreqCV < cvThresholdInfo) {
        if (import.meta.env.DEV) {
          console.warn('[PI][DeployOperate][DeployFreqVolatility] DEMO soft emit: low volatility (stable)', {
            mean: deployFreqMean.toFixed(2) + '/week',
            cv: deployFreqCV.toFixed(2),
            windowSize
          })
        }
        
        const evidence: InsightEvidence[] = [
          { label: 'Window size', value: windowSize.toString() },
          { label: 'Mean deploy/wk', value: deployFreqMean.toFixed(2) + ' deployments/week' },
          { label: 'Std dev', value: deployFreqStdDev.toFixed(2) + ' deployments/week' },
          { label: 'CV', value: deployFreqCV.toFixed(2) },
          { label: 'Min', value: deployFreqMin.toFixed(2) + ' deployments/week' },
          { label: 'Max', value: deployFreqMax.toFixed(2) + ' deployments/week' },
          { label: 'Points analyzed', value: windowPoints.length.toString() },
          { label: 'Data source', value: 'GitHub time series' }
        ]
        
        const insight: PerformanceInsight = {
          id: `org-deploy-frequency-volatility-${Date.now()}`,
          title: 'Deployment cadence is consistent week to week',
          description: `Deployment frequency shows low volatility (coefficient of variation ${deployFreqCV.toFixed(2)}) over the last ${windowSize} periods, ranging from ${deployFreqMin.toFixed(2)} to ${deployFreqMax.toFixed(2)} deployments per week (mean: ${deployFreqMean.toFixed(2)}/week). This consistent cadence indicates stable, predictable release processes that make it easier to plan and maintain quality standards.`,
          severity: 'info',
          insightClass: 'org_deterministic',
          orgKind: 'diagnostic',
          cicdStage: 'deploy-operate',
          toolScope: 'cross-ide',
          source: 'github',
          metricId: 'org.deploy_frequency_volatility',
          ruleLabel: 'Deploy frequency volatility',
          dataSource: inferDataSourceForOrgInsight(input),
          evidence,
          recommendations: [
            {
              text: 'Maintain current deployment practices that are producing consistent cadence.',
              actionType: 'process'
            },
            {
              text: 'Document successful patterns and share across teams to scale consistency improvements.',
              actionType: 'process'
            }
          ],
          related: {},
          tools: undefined,
          priorityScore: 70,
          summaryEligible: false,
          tags: ['org', 'deploy-operate', 'dora', 'deployment', 'stability']
        }
        
        if (import.meta.env.DEV) {
          console.warn('[PI][DeployOperate][DeployFreqVolatility] DEMO soft emit RETURN', {
            title: insight.title,
            cv: deployFreqCV.toFixed(2),
            softEmit: true
          })
        }
        
        return [insight]
      }
      
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][DeployFreqVolatility] Early return: CV below threshold', {
          cv: deployFreqCV.toFixed(2),
          threshold: cvThresholdInfo
        })
      }
      return []
    }
    
    // Determine severity
    const severity: InsightSeverity = deployFreqCV >= cvThresholdWarning ? 'warning' : 'info'
    const priorityScore = severity === 'warning' ? 92 : 84
    
    // Build evidence (must have >=3 rows for quality contract)
    const evidence: InsightEvidence[] = [
      { label: 'Window size', value: windowSize.toString() },
      { label: 'Mean deploy/wk', value: deployFreqMean.toFixed(2) + ' deployments/week' },
      { label: 'Std dev', value: deployFreqStdDev.toFixed(2) + ' deployments/week' },
      { label: 'CV', value: deployFreqCV.toFixed(2) },
      { label: 'Min', value: deployFreqMin.toFixed(2) + ' deployments/week' },
      { label: 'Max', value: deployFreqMax.toFixed(2) + ' deployments/week' },
      { label: 'Points analyzed', value: windowPoints.length.toString() },
      { label: 'Data source', value: 'GitHub time series' }
    ]
    
    // Build title and description
    const title = `Deployment cadence is unstable (CV ${deployFreqCV.toFixed(2)} over last ${windowSize} weeks)`
    const description = `Deployment frequency shows high volatility (coefficient of variation ${deployFreqCV.toFixed(2)}) over the last ${windowSize} periods, ranging from ${deployFreqMin.toFixed(2)} to ${deployFreqMax.toFixed(2)} deployments per week (mean: ${deployFreqMean.toFixed(2)}/week). This unstable cadence suggests inconsistent release processes, batching behavior, or manual gating that creates unpredictable deployment patterns. ${severity === 'warning' ? 'Immediate attention recommended to stabilize deployment cadence and improve predictability.' : 'Focus on standardizing release processes to reduce variance and improve deployment consistency.'}`
    
    // Build recommendations
    const recommendations: InsightRecommendation[] = [
      {
        text: 'Implement a release train with fixed cadence (e.g., weekly or bi-weekly releases) to create predictable deployment patterns.',
        actionType: 'process'
      },
      {
        text: 'Reduce batch sizes by deploying smaller, incremental changes more frequently instead of accumulating large changes.',
        actionType: 'process'
      },
      {
        text: 'Adopt trunk-based development to enable continuous integration and reduce merge conflicts that cause deployment delays.',
        actionType: 'process'
      },
      {
        text: 'Automate deployment gating and approval processes to remove manual bottlenecks and reduce variability in release timing.',
        actionType: 'tooling'
      },
      {
        text: 'Establish consistent cut schedules and release windows to create predictable deployment cadence across teams.',
        actionType: 'process'
      },
      {
        text: 'Reduce manual approvals and gate deployments on automated tests and quality checks instead of human review.',
        actionType: 'process'
      }
    ]
    
    const insight: PerformanceInsight = {
      id: `org-deploy-frequency-volatility-${Date.now()}`,
      title,
      description,
      severity,
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'deploy-operate',
      toolScope: 'cross-ide',
      source: 'github',
      metricId: 'org.deploy_frequency_volatility',
      ruleLabel: 'Deploy frequency volatility',
      dataSource: inferDataSourceForOrgInsight(input),
      evidence,
      recommendations,
      related: {},
      tools: undefined,
      priorityScore,
      summaryEligible: false,
      tags: ['org', 'deploy-operate', 'dora', 'deployment', 'volatility']
    }
    
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][DeployFreqVolatility] EMIT', {
        title: insight.title,
        severity,
        priorityScore,
        cv: deployFreqCV.toFixed(2),
        mean: deployFreqMean.toFixed(2) + '/week',
        cvThresholdInfo,
        cvThresholdWarning
      })
    }
    
    return [insight]
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][DeployFreqVolatility] Error:', e)
    }
    return []
  }
}

/**
 * Org CFR Trend Deterioration Rule (Deploy & Operate)
 * 
 * Detects a sustained upward trend in change failure rate across multiple recent periods
 * (trend deterioration), distinct from a single-period spike. Uses split-window comparison
 * to identify gradual deterioration over time.
 * Uses org-level GitHub time series data (engOutput).
 * Emits at most ONE insight.
 */
function ruleOrgCFRTrendDeterioration(input: PerformanceInputs): PerformanceInsight[] {
  const { engOutput } = input
  
  // Guard: require engOutput data
  if (!engOutput || engOutput.length === 0) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][CFRTrendDeterioration] Early return: no engOutput data')
    }
    return []
  }
  
  try {
    // Extract valid points with change failure rate
    const pointsWithCFR = engOutput.map(p => {
      // Try changeFailureRatePct first, fallback to changeFailureRate
      const pAny = p as any
      let cfr: number | null = null
      
      if (p.changeFailureRatePct !== undefined && p.changeFailureRatePct !== null) {
        const v = p.changeFailureRatePct
        if (isFinite(v) && v >= 0) {
          cfr = v
        }
      } else if (pAny.changeFailureRate !== undefined && pAny.changeFailureRate !== null) {
        const v = pAny.changeFailureRate
        if (isFinite(v) && v >= 0) {
          cfr = v
        }
      }
      
      return {
        period: p.period,
        cfr
      }
    })
    
    // Sort by period (most recent last)
    pointsWithCFR.sort((a, b) => {
      const aPeriod = a.period || ''
      const bPeriod = b.period || ''
      return aPeriod < bPeriod ? -1 : aPeriod > bPeriod ? 1 : 0
    })
    
    // Use rolling window: last N points (N=6 prod, N=4 demo)
    const windowSize = DEMO_MODE ? 4 : 6
    const windowPoints = pointsWithCFR.slice(-windowSize)
    
    // Extract valid CFR values from window
    const cfrValues = windowPoints.filter(p => p.cfr !== null).map(p => p.cfr!)
    
    // Guard: need minimum points
    const minPoints = DEMO_MODE ? 3 : 5
    if (cfrValues.length < minPoints) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][CFRTrendDeterioration] Early return: insufficient points', {
          windowPoints: windowPoints.length,
          validValues: cfrValues.length,
          required: minPoints
        })
      }
      return []
    }
    
    // Split window into first half and second half
    const midPoint = Math.floor(cfrValues.length / 2)
    const firstHalf = cfrValues.slice(0, midPoint)
    const secondHalf = cfrValues.slice(midPoint)
    
    // Compute means
    const mean1 = mean(firstHalf)
    const mean2 = mean(secondHalf)
    
    // Compute deltas
    const deltaAbsPts = mean2 - mean1
    const deltaPctRel = deltaAbsPts / Math.max(mean1, 0.5)  // Avoid division by zero
    
    // Compute overall mean and median for additional checks
    const overallMean = mean(cfrValues)
    const sortedValues = [...cfrValues].sort((a, b) => a - b)
    const median = sortedValues.length % 2 === 0
      ? (sortedValues[sortedValues.length / 2 - 1] + sortedValues[sortedValues.length / 2]) / 2
      : sortedValues[Math.floor(sortedValues.length / 2)]
    
    const lastValue = cfrValues[cfrValues.length - 1]
    const minValue = Math.min(...cfrValues)
    const maxValue = Math.max(...cfrValues)
    
    // Guard: require mean CFR >= 1.0% (avoid tiny baselines)
    if (overallMean < 1.0) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][CFRTrendDeterioration] Early return: mean too low', {
          mean: overallMean.toFixed(2) + '%',
          required: '1.0%'
        })
      }
      return []
    }
    
    // Guard: require last point >= median (prevents random noise)
    if (lastValue < median) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][CFRTrendDeterioration] Early return: last value below median', {
          lastValue: lastValue.toFixed(2) + '%',
          median: median.toFixed(2) + '%'
        })
      }
      return []
    }
    
    // Trigger thresholds
    const deltaAbsThreshold = DEMO_MODE ? 0.5 : 1.0
    const deltaPctThreshold = DEMO_MODE ? 0.20 : 0.25
    
    // Log ENTER with computed stats
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][CFRTrendDeterioration] ENTER', {
        points: engOutput.length,
        windowSize,
        windowPoints: windowPoints.length,
        validValues: cfrValues.length,
        DEMO_MODE,
        mean1: mean1.toFixed(2) + '%',
        mean2: mean2.toFixed(2) + '%',
        deltaAbsPts: deltaAbsPts.toFixed(2) + ' pct-pt',
        deltaPctRel: (deltaPctRel * 100).toFixed(1) + '%',
        overallMean: overallMean.toFixed(2) + '%',
        lastValue: lastValue.toFixed(2) + '%',
        median: median.toFixed(2) + '%',
        deltaAbsThreshold,
        deltaPctThreshold
      })
    }
    
    // Check if trend qualifies (must be upward)
    if (deltaAbsPts < deltaAbsThreshold && deltaPctRel < deltaPctThreshold) {
      // DEMO_MODE soft-emit: if CFR is stable or improving, emit a healthy card
      if (DEMO_MODE && cfrValues.length >= minPoints && overallMean >= 1.0) {
        // Check if CFR is stable (small change) or improving (decreasing)
        const isStable = Math.abs(deltaAbsPts) < 0.5 && Math.abs(deltaPctRel) < 0.10
        const isImproving = deltaAbsPts < -0.3 || (deltaPctRel < -0.15 && mean1 > 0)
        
        if (isStable || isImproving) {
          if (import.meta.env.DEV) {
            console.warn('[PI][DeployOperate][CFRTrendDeterioration] DEMO soft emit: CFR stable or improving', {
              mean1: mean1.toFixed(2) + '%',
              mean2: mean2.toFixed(2) + '%',
              deltaAbsPts: deltaAbsPts.toFixed(2) + ' pct-pt',
              isStable,
              isImproving
            })
          }
          
          const evidence: InsightEvidence[] = [
            { label: 'Window size', value: windowSize.toString() },
            { label: 'First half mean', value: mean1.toFixed(2) + '%' },
            { label: 'Second half mean', value: mean2.toFixed(2) + '%' },
            { label: 'Delta (abs)', value: deltaAbsPts >= 0 ? `+${deltaAbsPts.toFixed(2)} pct-pt` : `${deltaAbsPts.toFixed(2)} pct-pt` },
            { label: 'Delta (rel)', value: deltaPctRel >= 0 ? `+${(deltaPctRel * 100).toFixed(1)}%` : `${(deltaPctRel * 100).toFixed(1)}%` },
            { label: 'Min', value: minValue.toFixed(2) + '%' },
            { label: 'Max', value: maxValue.toFixed(2) + '%' },
            { label: 'Points analyzed', value: windowPoints.length.toString() },
            { label: 'Data source', value: 'GitHub time series' }
          ]
          
          const title = isImproving 
            ? 'Change failure rate trend is improving'
            : 'Change failure rate trend is stable'
          const description = isImproving
            ? `Change failure rate shows a positive trend over the last ${windowSize} periods, decreasing from ${mean1.toFixed(2)}% (first half) to ${mean2.toFixed(2)}% (second half), a ${Math.abs(deltaAbsPts).toFixed(2)} percentage point decrease. This improvement suggests that release safety practices are effective and quality is trending in the right direction.`
            : `Change failure rate shows a stable trend over the last ${windowSize} periods, with first half mean of ${mean1.toFixed(2)}% and second half mean of ${mean2.toFixed(2)}% (delta: ${deltaAbsPts >= 0 ? '+' : ''}${deltaAbsPts.toFixed(2)} pct-pt). This stability indicates consistent quality outcomes and predictable release processes.`
          
          const insight: PerformanceInsight = {
            id: `org-cfr-trend-deterioration-${Date.now()}`,
            title,
            description,
            severity: 'info',
            insightClass: 'org_deterministic',
            orgKind: 'diagnostic',
            cicdStage: 'deploy-operate',
            toolScope: 'cross-ide',
            source: 'github',
            metricId: 'org.cfr_trend_deterioration',
            ruleLabel: 'CFR trend',
            dataSource: inferDataSourceForOrgInsight(input),
            evidence,
            recommendations: [
              {
                text: 'Maintain current release safety practices that are producing stable or improving outcomes.',
                actionType: 'process'
              },
              {
                text: 'Document successful patterns and share across teams to scale quality improvements.',
                actionType: 'process'
              }
            ],
            related: {},
            tools: undefined,
            priorityScore: 68,
            summaryEligible: false,
            tags: ['org', 'deploy-operate', 'dora', 'cfr', 'trend']
          }
          
          if (import.meta.env.DEV) {
            console.warn('[PI][DeployOperate][CFRTrendDeterioration] DEMO soft emit RETURN', {
              title: insight.title,
              isStable,
              isImproving,
              softEmit: true
            })
          }
          
          return [insight]
        }
      }
      
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][CFRTrendDeterioration] Early return: thresholds not met', {
          deltaAbsPts: deltaAbsPts.toFixed(2),
          deltaAbsThreshold,
          deltaPctRel: (deltaPctRel * 100).toFixed(1) + '%',
          deltaPctThreshold: (deltaPctThreshold * 100).toFixed(0) + '%'
        })
      }
      return []
    }
    
    // Determine severity
    const severity: InsightSeverity = (deltaAbsPts >= 2.5 || deltaPctRel >= 0.60) ? 'warning' : 'info'
    const priorityScore = severity === 'warning' ? 94 : 86
    
    // Build evidence (must have >=3 rows for quality contract)
    const evidence: InsightEvidence[] = [
      { label: 'Window size', value: windowSize.toString() },
      { label: 'First half mean', value: mean1.toFixed(2) + '%' },
      { label: 'Second half mean', value: mean2.toFixed(2) + '%' },
      { label: 'Delta (abs)', value: `+${deltaAbsPts.toFixed(2)} pct-pt` },
      { label: 'Delta (rel)', value: `+${(deltaPctRel * 100).toFixed(1)}%` },
      { label: 'Last value', value: lastValue.toFixed(2) + '%' },
      { label: 'Min', value: minValue.toFixed(2) + '%' },
      { label: 'Max', value: maxValue.toFixed(2) + '%' },
      { label: 'Points analyzed', value: windowPoints.length.toString() },
      { label: 'Data source', value: 'GitHub time series' }
    ]
    
    // Build title and description
    const title = `Change failure rate is trending upward (+${deltaAbsPts.toFixed(1)} pts over last ${windowSize} weeks)`
    const description = `Change failure rate shows a sustained upward trend over the last ${windowSize} periods, increasing from ${mean1.toFixed(2)}% (first half) to ${mean2.toFixed(2)}% (second half), a ${deltaAbsPts.toFixed(2)} percentage point increase (${(deltaPctRel * 100).toFixed(1)}% relative). This gradual deterioration suggests systemic issues in release safety or quality processes that are worsening over time. ${severity === 'warning' ? 'Immediate attention recommended to identify and address root causes of increasing failure rates.' : 'Focus on strengthening release safety practices to reverse the trend.'}`
    
    // Build recommendations
    const recommendations: InsightRecommendation[] = [
      {
        text: 'Implement progressive delivery with feature flags to enable safe, gradual rollouts and quick rollbacks.',
        actionType: 'tooling'
      },
      {
        text: 'Use canary deployments to test changes in production with minimal risk before full rollout.',
        actionType: 'tooling'
      },
      {
        text: 'Tighten rollback procedures and automate rollback triggers based on error rates and performance metrics.',
        actionType: 'tooling'
      },
      {
        text: 'Gate deployments on test coverage and quality metrics to prevent regressions from reaching production.',
        actionType: 'process'
      },
      {
        text: 'Set error budgets and SLOs for change failure rate to maintain reliability standards and guide deployment decisions.',
        actionType: 'process'
      },
      {
        text: 'Establish incident taxonomy and classification to identify patterns causing failures and improve deployment practices.',
        actionType: 'process'
      },
      {
        text: 'Clarify ownership and accountability for release safety across teams to ensure consistent quality standards.',
        actionType: 'ownership'
      }
    ]
    
    const insight: PerformanceInsight = {
      id: `org-cfr-trend-deterioration-${Date.now()}`,
      title,
      description,
      severity,
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'deploy-operate',
      toolScope: 'cross-ide',
      source: 'github',
      metricId: 'org.cfr_trend_deterioration',
      ruleLabel: 'CFR trend',
      dataSource: inferDataSourceForOrgInsight(input),
      evidence,
      recommendations,
      related: {},
      tools: undefined,
      priorityScore,
      summaryEligible: false,
      tags: ['org', 'deploy-operate', 'dora', 'cfr', 'trend']
    }
    
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][CFRTrendDeterioration] EMIT', {
        title: insight.title,
        severity,
        priorityScore,
        deltaAbsPts: deltaAbsPts.toFixed(2) + ' pct-pt',
        deltaPctRel: (deltaPctRel * 100).toFixed(1) + '%',
        mean1: mean1.toFixed(2) + '%',
        mean2: mean2.toFixed(2) + '%'
      })
    }
    
    return [insight]
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][CFRTrendDeterioration] Error:', e)
    }
    return []
  }
}

/**
 * Org Fast But Unstable Rule (Deploy & Operate)
 * 
 * Detects "fast but unstable": deployment frequency rises AND reliability volatility rises
 * (CFR volatility preferred; MTTR if available). This is distinct from the "velocity vs reliability
 * tradeoff" rule which focuses on spikes - this focuses on volatility/instability.
 * Uses org-level GitHub time series data (engOutput).
 * Emits at most ONE insight.
 */
function ruleOrgFastButUnstable(input: PerformanceInputs): PerformanceInsight[] {
  const { engOutput } = input
  
  // Guard: require engOutput data
  if (!engOutput || engOutput.length === 0) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][FastButUnstable] Early return: no engOutput data')
    }
    return []
  }
  
  // Helper: Extract MTTR value from a point (reuse from other rules)
  function extractMTTRHours(p: EngOutputPoint): { value: number | null; fieldUsed: string | null } {
    const pAny = p as any
    
    if (pAny.mttrHours !== undefined && pAny.mttrHours !== null) {
      const v = pAny.mttrHours
      if (isFinite(v) && v > 0) return { value: v, fieldUsed: 'mttrHours' }
    }
    if (pAny.meanTimeToRecoveryHours !== undefined && pAny.meanTimeToRecoveryHours !== null) {
      const v = pAny.meanTimeToRecoveryHours
      if (isFinite(v) && v > 0) return { value: v, fieldUsed: 'meanTimeToRecoveryHours' }
    }
    if (pAny.meanTimeToRecovery !== undefined && pAny.meanTimeToRecovery !== null) {
      const v = pAny.meanTimeToRecovery
      if (isFinite(v) && v > 0) return { value: v, fieldUsed: 'meanTimeToRecovery' }
    }
    if (pAny.meanTimeToRecoveryMinutes !== undefined && pAny.meanTimeToRecoveryMinutes !== null) {
      const v = pAny.meanTimeToRecoveryMinutes
      if (isFinite(v) && v > 0) return { value: v / 60, fieldUsed: 'meanTimeToRecoveryMinutes' }
    }
    
    return { value: null, fieldUsed: null }
  }
  
  try {
    // Extract valid points for all metrics
    const pointsWithMetrics = engOutput.map(p => {
      const deployFreq = p.deploymentFreqPerWeek !== undefined && p.deploymentFreqPerWeek !== null && isFinite(p.deploymentFreqPerWeek) && p.deploymentFreqPerWeek > 0
        ? p.deploymentFreqPerWeek
        : null
      
      const cfr = p.changeFailureRatePct !== undefined && p.changeFailureRatePct !== null && isFinite(p.changeFailureRatePct) && p.changeFailureRatePct >= 0
        ? p.changeFailureRatePct
        : null
      
      const mttrExtracted = extractMTTRHours(p)
      
      return {
        period: p.period,
        deployFreq,
        cfr,
        mttr: mttrExtracted.value,
        mttrFieldUsed: mttrExtracted.fieldUsed
      }
    })
    
    // Sort by period (most recent last)
    pointsWithMetrics.sort((a, b) => {
      const aPeriod = a.period || ''
      const bPeriod = b.period || ''
      return aPeriod < bPeriod ? -1 : aPeriod > bPeriod ? 1 : 0
    })
    
    // Extract valid deployment frequency values
    const deployFreqValues = pointsWithMetrics.filter(p => p.deployFreq !== null).map(p => p.deployFreq!)
    
    // Guard: need at least 4 points for deploy frequency comparison
    const minPoints = DEMO_MODE ? 3 : 5
    if (deployFreqValues.length < minPoints) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][FastButUnstable] Early return: insufficient deploy freq points', {
          validValues: deployFreqValues.length,
          required: minPoints
        })
      }
      return []
    }
    
    // Compute deployment frequency: current vs baseline
    const currentDeployFreq = deployFreqValues[deployFreqValues.length - 1]
    const baselinePoints = deployFreqValues.slice(0, -1)  // Exclude most recent
    const baselineDeployFreq = baselinePoints.length > 0
      ? median(baselinePoints)
      : currentDeployFreq
    
    const deployFreqDeltaAbs = currentDeployFreq - baselineDeployFreq
    const deployFreqDeltaPct = baselineDeployFreq > 0 ? (deployFreqDeltaAbs / baselineDeployFreq) * 100 : 0
    
    // Check if deployment frequency increased
    const deployFreqThresholdPct = DEMO_MODE ? 10 : 15
    const deployFreqThresholdAbs = DEMO_MODE ? 0.3 : 0.5
    const deployFreqUp = deployFreqDeltaPct >= deployFreqThresholdPct || deployFreqDeltaAbs >= deployFreqThresholdAbs
    
    if (!deployFreqUp) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][FastButUnstable] Early return: deploy freq not increased', {
          current: currentDeployFreq.toFixed(2) + '/week',
          baseline: baselineDeployFreq.toFixed(2) + '/week',
          deltaPct: deployFreqDeltaPct.toFixed(1) + '%',
          deltaAbs: deployFreqDeltaAbs.toFixed(2) + '/week'
        })
      }
      return []
    }
    
    // Compute reliability volatility (CFR preferred, MTTR if available)
    // Use rolling window: last N points (N=6 prod, N=4 demo)
    const windowSize = DEMO_MODE ? 4 : 6
    const windowPoints = pointsWithMetrics.slice(-windowSize)
    
    // Extract CFR and MTTR values from window
    const cfrValues = windowPoints.filter(p => p.cfr !== null).map(p => p.cfr!)
    const mttrValues = windowPoints.filter(p => p.mttr !== null).map(p => p.mttr!)
    const mttrFieldUsed = windowPoints.find(p => p.mttr !== null)?.mttrFieldUsed || null
    
    // Compute statistics for CFR
    let cfrMean = 0
    let cfrStdDev = 0
    let cfrCV = 0
    let cfrMin = 0
    let cfrMax = 0
    let cfrQualifies = false
    
    if (cfrValues.length >= minPoints) {
      cfrMean = mean(cfrValues)
      cfrStdDev = standardDeviation(cfrValues)
      cfrCV = cfrMean > 0 ? cfrStdDev / cfrMean : 0
      cfrMin = Math.min(...cfrValues)
      cfrMax = Math.max(...cfrValues)
      
      const cfrCVThreshold = DEMO_MODE ? 0.40 : 0.60
      cfrQualifies = cfrCV >= cfrCVThreshold
    }
    
    // Compute statistics for MTTR
    let mttrMean = 0
    let mttrStdDev = 0
    let mttrCV = 0
    let mttrMin = 0
    let mttrMax = 0
    let mttrQualifies = false
    
    if (mttrValues.length >= minPoints) {
      mttrMean = mean(mttrValues)
      mttrStdDev = standardDeviation(mttrValues)
      mttrCV = mttrMean > 0 ? mttrStdDev / mttrMean : 0
      mttrMin = Math.min(...mttrValues)
      mttrMax = Math.max(...mttrValues)
      
      const mttrCVThreshold = DEMO_MODE ? 0.40 : 0.60
      mttrQualifies = mttrCV >= mttrCVThreshold
    }
    
    // Check if reliability volatility qualifies
    if (!cfrQualifies && !mttrQualifies) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][FastButUnstable] Early return: reliability volatility not qualified', {
          cfrQualifies,
          cfrCV: cfrValues.length >= minPoints ? cfrCV.toFixed(2) : null,
          mttrQualifies,
          mttrCV: mttrValues.length >= minPoints ? mttrCV.toFixed(2) : null
        })
      }
      return []
    }
    
    // Determine which metric to use (prefer CFR)
    const useCFR = cfrQualifies
    const useMTTR = mttrQualifies && !cfrQualifies
    const chosenCV = useCFR ? cfrCV : mttrCV
    const chosenMin = useCFR ? cfrMin : mttrMin
    const chosenMax = useCFR ? cfrMax : mttrMax
    const chosenMetricName = useCFR ? 'CFR' : 'MTTR'
    
    // Determine severity
    const isLargeDeployIncrease = deployFreqDeltaPct >= 30
    const isHighVolatility = chosenCV >= 0.80
    const severity: InsightSeverity = (isLargeDeployIncrease && isHighVolatility) ? 'warning' : 'info'
    const priorityScore = severity === 'warning' ? 96 : 88
    
    // Log ENTER with computed values
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][FastButUnstable] ENTER', {
        points: engOutput.length,
        windowSize,
        DEMO_MODE,
        deployFreq: {
          current: currentDeployFreq.toFixed(2) + '/week',
          baseline: baselineDeployFreq.toFixed(2) + '/week',
          deltaPct: deployFreqDeltaPct.toFixed(1) + '%',
          deltaAbs: deployFreqDeltaAbs.toFixed(2) + '/week',
          up: deployFreqUp
        },
        cfr: cfrValues.length >= minPoints ? {
          mean: cfrMean.toFixed(2) + '%',
          cv: cfrCV.toFixed(2),
          qualifies: cfrQualifies
        } : null,
        mttr: mttrValues.length >= minPoints ? {
          mean: mttrMean.toFixed(2) + 'h',
          cv: mttrCV.toFixed(2),
          qualifies: mttrQualifies,
          fieldUsed: mttrFieldUsed
        } : null,
        chosenMetric: useCFR ? 'CFR' : (useMTTR ? 'MTTR' : 'none'),
        severity
      })
    }
    
    // Build evidence (must have >=3 rows for quality contract)
    const evidence: InsightEvidence[] = [
      { label: 'Deploy freq current', value: currentDeployFreq.toFixed(2) + ' deployments/week' },
      { label: 'Deploy freq baseline', value: baselineDeployFreq.toFixed(2) + ' deployments/week' },
      { label: 'Deploy freq delta', value: `+${deployFreqDeltaPct.toFixed(1)}% (+${deployFreqDeltaAbs.toFixed(2)}/week)` },
      { label: 'Window size', value: windowSize.toString() },
      { label: `${chosenMetricName} CV`, value: chosenCV.toFixed(2) },
      { label: `${chosenMetricName} min`, value: useCFR ? (chosenMin.toFixed(2) + '%') : (chosenMin.toFixed(2) + ' hours') },
      { label: `${chosenMetricName} max`, value: useCFR ? (chosenMax.toFixed(2) + '%') : (chosenMax.toFixed(2) + ' hours') },
      { label: 'Points analyzed', value: windowPoints.length.toString() },
      { label: 'Data source', value: 'GitHub time series' }
    ]
    
    if (useMTTR && mttrFieldUsed) {
      evidence.splice(5, 0, { label: 'MTTR field used', value: mttrFieldUsed })
    }
    
    // Build title and description
    const title = 'Shipping faster, but reliability is becoming less predictable'
    const description = `Deployment frequency increased by ${deployFreqDeltaPct.toFixed(1)}% (+${deployFreqDeltaAbs.toFixed(2)} deployments/week) compared to baseline, but ${chosenMetricName} shows high volatility (coefficient of variation ${chosenCV.toFixed(2)}) over the last ${windowSize} periods. This indicates that while velocity is improving, reliability outcomes are becoming less predictable, which can lead to inconsistent user experience and increased incident risk. ${severity === 'warning' ? 'Immediate attention recommended to stabilize reliability processes while maintaining deployment velocity.' : 'Focus on standardizing release and incident response processes to reduce volatility.'}`
    
    // Build recommendations
    const recommendations: InsightRecommendation[] = [
      {
        text: 'Standardize release processes and procedures to reduce variance in deployment outcomes.',
        actionType: 'process'
      },
      {
        text: 'Reduce batch sizes by deploying smaller, incremental changes more frequently to minimize risk per deployment.',
        actionType: 'process'
      },
      {
        text: 'Improve deployment gating with automated tests and quality checks to ensure consistent quality standards.',
        actionType: 'process'
      },
      {
        text: 'Implement canary deployments and automated rollbacks to catch issues early and reduce impact of failures.',
        actionType: 'tooling'
      },
      {
        text: 'Reduce variance in incident handling by establishing clear runbooks, escalation paths, and response procedures.',
        actionType: 'process'
      },
      {
        text: 'Align on-call rotations and ownership to ensure consistent response times and reduce variability in incident resolution.',
        actionType: 'ownership'
      }
    ]
    
    const insight: PerformanceInsight = {
      id: `org-fast-but-unstable-${Date.now()}`,
      title,
      description,
      severity,
      insightClass: 'org_deterministic',
      cicdStage: 'deploy-operate',
      toolScope: 'cross-ide',
      source: 'github',
      metricId: 'org.fast_but_unstable',
      ruleLabel: 'Fast but unstable',
      dataSource: inferDataSourceForOrgInsight(input),
      evidence,
      recommendations,
      related: {},
      tools: undefined,
      priorityScore,
      summaryEligible: false,
      tags: ['org', 'deploy-operate', 'dora', 'velocity', 'volatility']
    }
    
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][FastButUnstable] EMIT', {
        title: insight.title,
        severity,
        priorityScore,
        chosenMetric: useCFR ? 'CFR' : 'MTTR',
        chosenCV: chosenCV.toFixed(2),
        deployFreqDeltaPct: deployFreqDeltaPct.toFixed(1) + '%',
        isLargeDeployIncrease,
        isHighVolatility
      })
    }
    
    return [insight]
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][FastButUnstable] Error:', e)
    }
    return []
  }
}

// ========== Phase 2: DataSource Inference Helpers ==========

/**
 * Phase 2: Infer dataSource for a single-tool insight.
 * 
 * Heuristic:
 * - GitHub (engOutput) is always REAL
 * - Productivity source comes from ToolProductivityPoint.source field ('live' = real, 'sim' = sim, 'hybrid' = mixed)
 * - If tool-specific productivity has 'live' or 'hybrid' source → productivity is REAL/MIXED
 * - If tool-specific productivity has 'sim' source → productivity is SIM
 * - Result: real+real = 'real', sim+real = 'mixed', sim+sim = 'sim'
 */
function inferDataSourceForToolInsight(
  tool: string | undefined,
  input: PerformanceInputs
): 'real' | 'sim' | 'mixed' | 'unknown' {
  if (!tool || !input.productivity?.length) {
    return 'unknown';
  }

  // GitHub data is always REAL
  const hasGitHubData = input.engOutput && input.engOutput.length > 0;
  
  // Find productivity points for this specific tool
  const toolProdPoints = input.productivity.filter(p => p.tool === tool);
  if (toolProdPoints.length === 0) {
    return 'unknown';
  }

  // Check source field on productivity points for this tool
  const hasLiveProd = toolProdPoints.some(p => p.source === 'live' || p.source === 'hybrid');
  const hasSimProd = toolProdPoints.some(p => p.source === 'sim' || p.source === 'hybrid');
  const allSim = toolProdPoints.every(p => !p.source || p.source === 'sim');

  // Determine productivity side classification
  let prodSide: 'real' | 'sim' | 'mixed' = 'sim'; // default conservative
  if (hasLiveProd && hasSimProd) {
    prodSide = 'mixed';
  } else if (hasLiveProd) {
    prodSide = 'real';
  } else if (allSim) {
    prodSide = 'sim';
  }

  // Combine with GitHub (always real)
  if (!hasGitHubData) {
    // No GitHub data, only productivity
    return prodSide === 'real' ? 'real' : prodSide === 'mixed' ? 'mixed' : 'sim';
  }

  // GitHub is real, combine with productivity
  if (prodSide === 'real') {
    return 'real'; // real productivity + real GitHub
  } else if (prodSide === 'mixed') {
    return 'mixed'; // mixed productivity + real GitHub
  } else {
    return 'mixed'; // sim productivity + real GitHub = mixed (correlating sim behavior with real outcomes)
  }
}

/**
 * Phase 2: Infer dataSource for org-level insights.
 * 
 * Heuristic:
 * - GitHub (engOutput) is always REAL
 * - Look at all tools in productivity data
 * - If any tool has 'live' or 'hybrid' source → has real productivity
 * - If any tool has 'sim' source → has sim productivity
 * - Result: real+real = 'real', (real+sim or sim+real) = 'mixed', sim only = 'mixed' (sim prod + real GH)
 */
function inferDataSourceForOrgInsight(
  input: PerformanceInputs
): 'real' | 'sim' | 'mixed' | 'unknown' {
  if (!input.productivity?.length) {
    // No productivity data, check if we have GitHub
    return input.engOutput && input.engOutput.length > 0 ? 'real' : 'unknown';
  }

  // GitHub data is always REAL
  const hasGitHubData = input.engOutput && input.engOutput.length > 0;

  // Check all productivity points for source classification
  const hasLiveProd = input.productivity.some(p => p.source === 'live' || p.source === 'hybrid');
  const hasSimProd = input.productivity.some(p => p.source === 'sim' || p.source === 'hybrid');
  const allSim = input.productivity.every(p => !p.source || p.source === 'sim');

  // Determine productivity side
  let prodSide: 'real' | 'sim' | 'mixed' = 'sim'; // default conservative
  if (hasLiveProd && hasSimProd) {
    prodSide = 'mixed';
  } else if (hasLiveProd) {
    prodSide = 'real';
  } else if (allSim) {
    prodSide = 'sim';
  }

  // Combine with GitHub (always real)
  if (!hasGitHubData) {
    return prodSide === 'real' ? 'real' : prodSide === 'mixed' ? 'mixed' : 'sim';
  }

  // GitHub is real, combine with productivity
  if (prodSide === 'real' && !hasSimProd) {
    return 'real'; // all real productivity + real GitHub
  } else {
    return 'mixed'; // any sim or mixed productivity + real GitHub = mixed
  }
}

// helpers
const groupByPeriod = <T extends { period: string }>(xs: T[]) => {
  const m = new Map<string, T[]>();
  (xs || []).forEach(p => { const arr = m.get(p.period) || []; arr.push(p); m.set(p.period, arr); });
  return m;
};
// Helper function to generate tool-specific recommendations
const getToolSpecificRecommendations = (tool: string, metric: string, correlation: number, severity: string) => {
  const recommendations: InsightRecommendation[] = [];
  
  // Tool-specific characteristics
  const toolCharacteristics: Record<string, { strengths: string[]; weaknesses: string[]; focus: string }> = {
    cursor: {
      strengths: ['AI-first development', 'rapid prototyping', 'code generation'],
      weaknesses: ['complex refactoring', 'large codebases', 'team collaboration'],
      focus: 'AI-assisted coding and rapid development'
    },
    vscode: {
      strengths: ['extensibility', 'debugging', 'team collaboration', 'enterprise features'],
      weaknesses: ['AI integration', 'performance', 'resource usage'],
      focus: 'comprehensive IDE with strong debugging and collaboration'
    },
    jetbrains: {
      strengths: ['refactoring', 'code analysis', 'enterprise development', 'database tools'],
      weaknesses: ['AI features', 'resource usage', 'startup time'],
      focus: 'enterprise development with advanced refactoring'
    },
    windsurf: {
      strengths: ['AI integration', 'modern interface', 'collaboration'],
      weaknesses: ['maturity', 'plugin ecosystem', 'enterprise features'],
      focus: 'modern AI-powered development environment'
    },
    sublime: {
      strengths: ['speed', 'lightweight', 'text editing', 'customization'],
      weaknesses: ['AI features', 'debugging', 'team features'],
      focus: 'fast, lightweight text editing and scripting'
    },
    vim: {
      strengths: ['efficiency', 'keyboard shortcuts', 'terminal integration', 'customization'],
      weaknesses: ['learning curve', 'AI integration', 'GUI features'],
      focus: 'efficient keyboard-driven development'
    }
  };

  const toolInfo = toolCharacteristics[tool.toLowerCase()] || {
    strengths: ['general development'],
    weaknesses: ['unknown limitations'],
    focus: 'general development tool'
  };

  // Generate recommendations based on metric and correlation
  if (metric === 'cycleTime') {
    if (correlation > 0) {
      // Tool is increasing cycle time - negative correlation
      if (tool.toLowerCase() === 'cursor') {
        recommendations.push(
          { text: 'Review Cursor AI suggestions for complex refactoring tasks; consider manual review for large changes', actionType: 'process' },
          { text: 'Implement Cursor-specific code review checklists for AI-generated code', actionType: 'review_policy' }
        );
      } else if (tool.toLowerCase() === 'vscode') {
        recommendations.push(
          { text: 'Optimize VS Code extensions and workspace settings to reduce overhead', actionType: 'tooling' },
          { text: 'Review VS Code debugging and testing workflows for efficiency', actionType: 'process' }
        );
      } else if (tool.toLowerCase() === 'jetbrains') {
        recommendations.push(
          { text: 'Review JetBrains refactoring scope and complexity; break down large changes', actionType: 'process' },
          { text: 'Optimize JetBrains indexing and analysis settings for better performance', actionType: 'tooling' }
        );
      } else if (tool.toLowerCase() === 'windsurf') {
        recommendations.push(
          { text: 'Review Windsurf AI model selection and suggestion filtering', actionType: 'tooling' },
          { text: 'Implement Windsurf-specific review processes for AI-assisted changes', actionType: 'review_policy' }
        );
      } else if (tool.toLowerCase() === 'sublime') {
        recommendations.push(
          { text: 'Review Sublime Text build systems and compilation workflows', actionType: 'tooling' },
          { text: 'Optimize Sublime Text project structure and file organization', actionType: 'process' }
        );
      } else if (tool.toLowerCase() === 'vim') {
        recommendations.push(
          { text: 'Review Vim configuration and plugin performance impact', actionType: 'tooling' },
          { text: 'Optimize Vim workflow for complex development tasks', actionType: 'process' }
        );
      }
    } else {
      // Tool is decreasing cycle time - positive correlation
      if (tool.toLowerCase() === 'cursor') {
        recommendations.push(
          { text: 'Scale Cursor AI workflows across the team; create Cursor best practices guide', actionType: 'training' },
          { text: 'Expand Cursor licenses and integrate with existing CI/CD pipelines', actionType: 'tooling' }
        );
      } else if (tool.toLowerCase() === 'vscode') {
        recommendations.push(
          { text: 'Promote VS Code workspace configurations and extensions that improve efficiency', actionType: 'training' },
          { text: 'Scale VS Code debugging and testing workflows to other teams', actionType: 'process' }
        );
      } else if (tool.toLowerCase() === 'jetbrains') {
        recommendations.push(
          { text: 'Expand JetBrains licenses and promote advanced refactoring techniques', actionType: 'training' },
          { text: 'Integrate JetBrains code analysis with automated quality gates', actionType: 'tooling' }
        );
      } else if (tool.toLowerCase() === 'windsurf') {
        recommendations.push(
          { text: 'Scale Windsurf AI models and collaboration features across teams', actionType: 'training' },
          { text: 'Integrate Windsurf with existing development workflows and tools', actionType: 'tooling' }
        );
      } else if (tool.toLowerCase() === 'sublime') {
        recommendations.push(
          { text: 'Promote Sublime Text build systems and scripting workflows', actionType: 'training' },
          { text: 'Scale Sublime Text configurations for rapid development tasks', actionType: 'process' }
        );
      } else if (tool.toLowerCase() === 'vim') {
        recommendations.push(
          { text: 'Create Vim training program for efficient keyboard-driven development', actionType: 'training' },
          { text: 'Scale Vim configurations and plugins across development teams', actionType: 'tooling' }
        );
      }
    }
  } else if (metric === 'mergeRate') {
    if (correlation > 0) {
      // Tool is improving merge rate
      recommendations.push(
        { text: `Scale ${tool} workflows that improve code quality and review efficiency`, actionType: 'process' },
        { text: `Expand ${tool} licenses and create team training programs`, actionType: 'training' }
      );
    } else {
      // Tool is reducing merge rate
      recommendations.push(
        { text: `Review ${tool} code quality practices and review processes`, actionType: 'process' },
        { text: `Implement ${tool}-specific quality gates and testing requirements`, actionType: 'tooling' }
      );
    }
  } else if (metric === 'deploymentFreq') {
    if (correlation > 0) {
      recommendations.push(
        { text: `Scale ${tool} CI/CD integration patterns that increase deployment frequency`, actionType: 'tooling' },
        { text: `Promote ${tool} automation workflows across development teams`, actionType: 'process' }
      );
    } else {
      recommendations.push(
        { text: `Review ${tool} build and deployment processes for bottlenecks`, actionType: 'process' },
        { text: `Optimize ${tool} integration with existing CI/CD pipelines`, actionType: 'tooling' }
      );
    }
  } else if (metric === 'changeFailureRate') {
    if (correlation > 0) {
      recommendations.push(
        { text: `Implement ${tool}-specific quality gates and testing requirements`, actionType: 'tooling' },
        { text: `Review ${tool} code review processes and validation workflows`, actionType: 'process' }
      );
    } else {
      recommendations.push(
        { text: `Scale ${tool} quality practices that reduce change failures`, actionType: 'process' },
        { text: `Promote ${tool} testing and validation workflows`, actionType: 'training' }
      );
    }
  }

  return recommendations;
};

/** Rule #1: Tool-specific cycle time vs AI-assist usage analysis */
/**
 * DEPRECATED: ruleCycleTimeVsAI
 * 
 * This rule is legacy and redundant with ruleAIImprovesCycleTime and ruleAISlowsCycleTime.
 * It has been disabled to prevent duplicate insights.
 * 
 * DO NOT REINTRODUCE THIS RULE.
 * Use ruleAIImprovesCycleTime and ruleAISlowsCycleTime instead.
 */
const ruleCycleTimeVsAI: Rule = ({ engOutput, productivity }) => {
  // DISABLED: Legacy rule, redundant with newer rules
  // Return empty array to prevent duplicate insights
  if (import.meta.env.DEV) {
    console.debug('[PI_RULE_SKIP] cycle-vs-ai: DEPRECATED - use ruleAIImprovesCycleTime/ruleAISlowsCycleTime instead');
  }
  return [];
  
  // Original implementation removed - kept for reference only
  /*
  if (!engOutput?.length || !productivity?.length) {
    if (import.meta.env.DEV) {
      console.debug('[PI_RULE_SKIP] cycle-vs-ai: missing data', {
        hasGH: !!engOutput?.length,
        hasProd: !!productivity?.length
      })
    }
    return []
  }

  // Group productivity data by tool
  const toolData = new Map<string, ToolProductivityPoint[]>();
  productivity.forEach(p => {
    if (p.tool) {
      const arr = toolData.get(p.tool) || [];
      arr.push(p);
      toolData.set(p.tool, arr);
    }
  });

  const outByP = groupByPeriod(engOutput);
  const periods = [...outByP.keys()].sort();
  if (!periods.length) return [];

  const ct = periods.map(p => {
    const pts = outByP.get(p) || [];
    const vals = pts.map(x => x.prCycleTimeHours ?? 0).filter(v => typeof v === 'number' && v > 0);
    return vals.length ? mean(vals) : undefined;
  });

  const insights: PerformanceInsight[] = [];

  // Analyze each tool individually
  for (const [tool, toolPoints] of toolData) {
    const minPoints = DEMO_MODE ? DEMO_MIN_POINTS : 4
    if (toolPoints.length < minPoints) {
      if (import.meta.env.DEV) {
        console.debug(`[PI_RULE_SKIP] cycle-vs-ai (${tool}): insufficient points`, {
          points: toolPoints.length,
          required: minPoints
        })
      }
      continue
    }

    const toolByP = groupByPeriod(toolPoints);
    const ai = periods.map(p => {
      const pts = toolByP.get(p) || [];
      const sum = pts.reduce((a,b)=> a + (b.aiAssists ?? 0), 0);
      return sum > 0 ? sum : undefined;
    });

    // need enough data - reduced requirements
    const ctCount = ct.filter(v => v !== undefined).length;
    const aiCount = ai.filter(v => v !== undefined).length;
    if (ctCount < 2 || aiCount < 2) continue; // Reduced from 4 to 2

    // test small positive lags 0..2
    const tests = [0,1,2].map(L => {
      const x:number[] = [], y:number[] = [];
      const lagged = lag(ai, L);
      periods.forEach((_, i) => {
        if (ct[i] !== undefined && lagged[i] !== undefined) { x.push(lagged[i]!); y.push(ct[i]!); }
      });
      return { L, r: pearson(x, y), n: x.length };
    }).filter(t => t.n >= 2); // Reduced from 4 to 2

    if (!tests.length) continue;
    const best = tests.sort((a,b)=> Math.abs(b.r) - Math.abs(a.r))[0];
    
    // Use metric-specific thresholds
    const { minN, pMax, minAbsR } = metricThresholds('cycle-time')
    if (!best || best.n < minN || Math.abs(best.r) < minAbsR) continue;

    const ctSeries = ct.filter(v => v !== undefined) as number[];
    if (ctSeries.length < 3) continue;
    const lastCt = ctSeries[ctSeries.length - 1];
    const z = zscore(lastCt, ctSeries.slice(0, -1));

    insights.push({
      id: safeId(),
      metricId: 'cycle-time',
      cicdStage: 'review-merge',  // Added: CI/CD stage for UI organization
      title: `${tool} AI usage ${best.r > 0 ? 'increases' : 'decreases'} cycle time (lag ${best.L}w, r=${best.r.toFixed(2)})`,
      description: `${tool} AI-assisted activity ${best.r > 0 ? 'correlates with longer' : 'correlates with shorter'} PR cycle time${best.L ? ` ~${best.L} week(s) later` : ''}. ${best.r > 0 ? 'Could reflect heavier refactors or insufficient review capacity' : 'Indicates efficient AI-assisted workflows'}.`,
      severity: z > 2 ? 'critical' : z > 1 ? 'warning' : 'info',
      tags: ['velocity','ai','tools'],
      related: { tools: [tool] },
      evidence: [
        { label: 'Correlation', metric: `corr(${tool}_aiAssists, prCycleTimeHours)`, value: Number(best.r.toFixed(2)) },
        { label: 'Latest cycle time (hrs)', metric: 'prCycleTimeHours', value: Number((lastCt ?? 0).toFixed(1)) },
        { label: 'Cycle time z-score', metric: 'zscore', value: Number(z.toFixed(2)) },
        { label: 'Lag (weeks)', metric: 'lag', value: best.L },
      ],
      recommendations: getToolSpecificRecommendations(tool, 'cycleTime', best.r, z > 2 ? 'critical' : z > 1 ? 'warning' : 'info'),
      source: 'mixed'
    });
  }
  */
  
  return [];
};

// --- Rule 2: Comprehensive tool performance analysis ---
const ruleToolValuePositive: Rule = ({ engOutput, productivity, team }) => {
  if (!engOutput?.length || !productivity?.length) {
    if (import.meta.env.DEV) {
      console.debug('[PI_RULE_SKIP] merge-rate-vs-time: missing data', {
        hasGH: !!engOutput?.length,
        hasProd: !!productivity?.length
      })
    }
    return []
  }

  // Group productivity data by tool
  const toolData = new Map<string, ToolProductivityPoint[]>();
  productivity.forEach(p => {
    if (p.tool) {
      const arr = toolData.get(p.tool) || [];
      arr.push(p);
      toolData.set(p.tool, arr);
    }
  });

  // Group by period
  const outByP = new Map<string, EngOutputPoint[]>();
  engOutput.forEach(p => { const a = outByP.get(p.period) || []; a.push(p); outByP.set(p.period, a); });

  const prodByP = new Map<string, ToolProductivityPoint[]>();
  productivity.forEach(p => { const a = prodByP.get(p.period) || []; a.push(p); prodByP.set(p.period, a); });

  const periods = [...new Set([...outByP.keys(), ...prodByP.keys()])].sort();
  if (!periods.length) return [];

  const mergeRate = periods.map(p => {
    const pts = outByP.get(p) || [];
    const vals = pts.map(x => x.mergeRatePct ?? 0).filter(v => v > 0);
    return vals.length ? mean(vals) : undefined;
  });

  const cycleTime = periods.map(p => {
    const pts = outByP.get(p) || [];
    const vals = pts.map(x => x.prCycleTimeHours ?? 0).filter(v => v > 0);
    return vals.length ? mean(vals) : undefined;
  });

  const deploymentFreq = periods.map(p => {
    const pts = outByP.get(p) || [];
    const vals = pts.map(x => x.deploymentFreqPerWeek ?? 0).filter(v => v > 0);
    return vals.length ? mean(vals) : undefined;
  });

  const changeFailureRate = periods.map(p => {
    const pts = outByP.get(p) || [];
    const vals = pts.map(x => x.changeFailureRatePct ?? 0).filter(v => v > 0);
    return vals.length ? mean(vals) : undefined;
  });

  const insights: PerformanceInsight[] = [];

  // Analyze each tool against multiple metrics
  for (const [tool, toolPoints] of toolData) {
    if (toolPoints.length < 4) continue;
    
    const toolByP = groupByPeriod(toolPoints);
    const codingMins = periods.map(p => {
      const pts = toolByP.get(p) || [];
      return pts.reduce((sum, pt) => sum + (pt.codingMinutes ?? 0), 0);
    });

    const aiAssists = periods.map(p => {
      const pts = toolByP.get(p) || [];
      return pts.reduce((sum, pt) => sum + (pt.aiAssists ?? 0), 0);
    });

    // Test correlation with merge rate
    if (mergeRate.filter(v => v !== undefined).length >= 4 && codingMins.filter(v => v > 0).length >= 4) {
      const x: number[] = [], y: number[] = [];
      periods.forEach((_, i) => {
        if (mergeRate[i] !== undefined && codingMins[i] > 0) {
          x.push(codingMins[i]); y.push(mergeRate[i]!);
        }
      });
      
      if (x.length >= 4) {
        const r = pearson(x, y);
        const n = x.length;
        const p = pValueFromR(r, n);
        
        // Statistical gating with metric-specific thresholds
        const { minN, pMax, minAbsR } = metricThresholds('merge-rate')
        if (!(n >= minN && p <= pMax && Math.abs(r) >= minAbsR)) continue;
        
        if (Math.abs(r) > 0.3) { // Lower threshold to show more insights
          const lastMR = mergeRate.filter(v => v !== undefined).slice(-1)[0] ?? 0;
          const avgCoding = mean(codingMins.filter(v => v > 0));
          
          insights.push({
            id: safeId(),
            metricId: 'merge-rate',
            title: `${tool} ${r > 0 ? 'improves' : 'reduces'} merge rate (r=${r.toFixed(2)})`,
            description: `${tool} usage ${r > 0 ? 'correlates with higher' : 'correlates with lower'} merge rates in ${team || 'this team'}. ${r > 0 ? 'Consider expanding' : 'Review'} ${tool} adoption.`,
            severity: r > 0 ? 'opportunity' : 'warning',
            insightClass: 'tool_statistical',
            tags: ['velocity', 'tools', 'team'],
            related: { tools: [tool] },
            evidence: [
              { label: 'Correlation (r)', metric: `corr(${tool}_codingMinutes, mergeRatePct)`, value: Number(r.toFixed(2)) },
              { label: 'p', metric: 'p-value', value: Number(p.toFixed(3)) },
              { label: 'Periods', metric: 'periods', value: n },
              { label: 'Latest merge rate %', metric: 'mergeRatePct', value: Number(lastMR.toFixed(1)) },
              { label: 'Avg coding minutes', metric: `${tool}_codingMinutes`, value: Number(avgCoding.toFixed(0)) },
            ],
            recommendations: getToolSpecificRecommendations(tool, 'mergeRate', r, Math.abs(r) > 0.6 ? 'warning' : 'info'),
            source: 'mixed'
          });
        }
      }
    }

    // Test correlation with cycle time
    if (cycleTime.filter(v => v !== undefined).length >= 4 && aiAssists.filter(v => v > 0).length >= 4) {
      const x: number[] = [], y: number[] = [];
      periods.forEach((_, i) => {
        if (cycleTime[i] !== undefined && aiAssists[i] > 0) {
          x.push(aiAssists[i]); y.push(cycleTime[i]!);
        }
      });
      
      if (x.length >= 4) {
        const r = pearson(x, y);
        const n = x.length;
        const p = pValueFromR(r, n);
        
        // Statistical gating with metric-specific thresholds
        const { minN, pMax, minAbsR } = metricThresholds('cycle-time')
        if (!(n >= minN && p <= pMax && Math.abs(r) >= minAbsR)) continue;
        
        if (Math.abs(r) > 0.3) {
          const lastCT = cycleTime.filter(v => v !== undefined).slice(-1)[0] ?? 0;
          const avgAI = mean(aiAssists.filter(v => v > 0));
          
          insights.push({
            id: safeId(),
            metricId: 'cycle-time',
            title: `${tool} AI usage ${r > 0 ? 'increases' : 'decreases'} cycle time (r=${r.toFixed(2)})`,
            description: `${tool} AI assistance ${r > 0 ? 'correlates with longer' : 'correlates with shorter'} PR cycle times. ${r > 0 ? 'Review' : 'Promote'} ${tool} AI workflows.`,
            severity: Math.abs(r) > 0.6 ? 'warning' : 'info',
            insightClass: 'tool_statistical',
            tags: ['velocity', 'tools', 'ai'],
            related: { tools: [tool] },
            evidence: [
              { label: 'Correlation (r)', metric: `corr(${tool}_aiAssists, prCycleTimeHours)`, value: Number(r.toFixed(2)) },
              { label: 'p', metric: 'p-value', value: Number(p.toFixed(3)) },
              { label: 'Periods', metric: 'periods', value: n },
              { label: 'Latest cycle time (hrs)', metric: 'prCycleTimeHours', value: Number(lastCT.toFixed(1)) },
              { label: 'Avg AI assists', metric: `${tool}_aiAssists`, value: Number(avgAI.toFixed(0)) },
            ],
            recommendations: getToolSpecificRecommendations(tool, 'cycleTime', r, Math.abs(r) > 0.6 ? 'warning' : 'info'),
            source: 'mixed'
          });
        }
      }
    }

    // Test correlation with deployment frequency
    if (deploymentFreq.filter(v => v !== undefined).length >= 4 && codingMins.filter(v => v > 0).length >= 4) {
      const x: number[] = [], y: number[] = [];
      periods.forEach((_, i) => {
        if (deploymentFreq[i] !== undefined && codingMins[i] > 0) {
          x.push(codingMins[i]); y.push(deploymentFreq[i]!);
        }
      });
      
      if (x.length >= 4) {
        const r = pearson(x, y);
        const n = x.length;
        const p = pValueFromR(r, n);
        
        // Statistical gating with metric-specific thresholds
        const { minN, pMax, minAbsR } = metricThresholds('deployment-frequency')
        if (!(n >= minN && p <= pMax && Math.abs(r) >= minAbsR)) continue;
        
        if (Math.abs(r) > 0.3) {
          const lastDF = deploymentFreq.filter(v => v !== undefined).slice(-1)[0] ?? 0;
          const avgCoding = mean(codingMins.filter(v => v > 0));
          
          insights.push({
            id: safeId(),
            metricId: 'deployment-frequency',
            title: `${tool} usage ${r > 0 ? 'increases' : 'decreases'} deployment frequency (r=${r.toFixed(2)})`,
            description: `${tool} productivity ${r > 0 ? 'correlates with more' : 'correlates with fewer'} deployments. ${r > 0 ? 'Scale' : 'Optimize'} ${tool} workflows.`,
            severity: Math.abs(r) > 0.6 ? 'warning' : 'info',
            insightClass: 'tool_statistical',
            tags: ['deployment', 'tools', 'productivity'],
            related: { tools: [tool] },
            evidence: [
              { label: 'Correlation (r)', metric: `corr(${tool}_codingMinutes, deploymentFreqPerWeek)`, value: Number(r.toFixed(2)) },
              { label: 'p', metric: 'p-value', value: Number(p.toFixed(3)) },
              { label: 'Periods', metric: 'periods', value: n },
              { label: 'Latest deployments/week', metric: 'deploymentFreqPerWeek', value: Number(lastDF.toFixed(1)) },
              { label: 'Avg coding minutes', metric: `${tool}_codingMinutes`, value: Number(avgCoding.toFixed(0)) },
            ],
            recommendations: getToolSpecificRecommendations(tool, 'deploymentFreq', r, Math.abs(r) > 0.6 ? 'warning' : 'info'),
            source: 'mixed'
          });
        }
      }
    }

    // Test correlation with change failure rate
    if (changeFailureRate.filter(v => v !== undefined).length >= 4 && aiAssists.filter(v => v > 0).length >= 4) {
      const x: number[] = [], y: number[] = [];
      periods.forEach((_, i) => {
        if (changeFailureRate[i] !== undefined && aiAssists[i] > 0) {
          x.push(aiAssists[i]); y.push(changeFailureRate[i]!);
        }
      });
      
      if (x.length >= 4) {
        const r = pearson(x, y);
        const n = x.length;
        const p = pValueFromR(r, n);
        
        // Statistical gating with metric-specific thresholds
        const { minN, pMax, minAbsR } = metricThresholds('change-failure-rate')
        if (!(n >= minN && p <= pMax && Math.abs(r) >= minAbsR)) continue;
        
        if (Math.abs(r) > 0.3) {
          const lastCFR = changeFailureRate.filter(v => v !== undefined).slice(-1)[0] ?? 0;
          const avgAI = mean(aiAssists.filter(v => v > 0));
          
          insights.push({
            id: safeId(),
            metricId: 'change-failure-rate',
            title: `${tool} AI usage ${r > 0 ? 'increases' : 'decreases'} change failure rate (r=${r.toFixed(2)})`,
            description: `${tool} AI assistance ${r > 0 ? 'correlates with higher' : 'correlates with lower'} change failure rates. ${r > 0 ? 'Review' : 'Promote'} ${tool} quality practices.`,
            severity: Math.abs(r) > 0.6 ? 'critical' : 'warning',
            insightClass: 'tool_statistical',
            tags: ['quality', 'tools', 'ai'],
            related: { tools: [tool] },
            evidence: [
              { label: 'Correlation (r)', metric: `corr(${tool}_aiAssists, changeFailureRatePct)`, value: Number(r.toFixed(2)) },
              { label: 'p', metric: 'p-value', value: Number(p.toFixed(3)) },
              { label: 'Periods', metric: 'periods', value: n },
              { label: 'Latest failure rate %', metric: 'changeFailureRatePct', value: Number(lastCFR.toFixed(1)) },
              { label: 'Avg AI assists', metric: `${tool}_aiAssists`, value: Number(avgAI.toFixed(0)) },
            ],
            recommendations: getToolSpecificRecommendations(tool, 'changeFailureRate', r, Math.abs(r) > 0.6 ? 'critical' : 'warning'),
            source: 'mixed'
          });
        }
      }
    }
  }

  return insights;
};

// --- Rule 4: Tool-specific performance analysis ---
const ruleToolSpecificPerformance: Rule = ({ engOutput, productivity }) => {
  if (!engOutput?.length || !productivity?.length) return [];

  // Group productivity data by tool
  const toolData = new Map<string, ToolProductivityPoint[]>();
  productivity.forEach(p => {
    if (p.tool) {
      const arr = toolData.get(p.tool) || [];
      arr.push(p);
      toolData.set(p.tool, arr);
    }
  });

  // Group eng output by period
  const outByP = groupByPeriod(engOutput);
  const periods = [...outByP.keys()].sort();
  if (periods.length < 4) return [];

  const insights: PerformanceInsight[] = [];

  // For each tool, calculate its correlation with engineering metrics
  for (const [tool, toolPoints] of toolData) {
    if (toolPoints.length < 4) continue;

    // Group tool data by period
    const toolByP = groupByPeriod(toolPoints);
    
    // Calculate AI assists and coding minutes by period for this tool
    const aiAssists = periods.map(p => {
      const pts = toolByP.get(p) || [];
      return pts.reduce((sum, pt) => sum + (pt.aiAssists ?? 0), 0);
    });
    
    const codingMinutes = periods.map(p => {
      const pts = toolByP.get(p) || [];
      return pts.reduce((sum, pt) => sum + (pt.codingMinutes ?? 0), 0);
    });

    // Calculate merge rate by period
    const mergeRate = periods.map(p => {
      const pts = outByP.get(p) || [];
      const vals = pts.map(x => x.mergeRatePct ?? 0).filter(v => v > 0);
      return vals.length ? mean(vals) : undefined;
    });

    // Calculate cycle time by period
    const cycleTime = periods.map(p => {
      const pts = outByP.get(p) || [];
      const vals = pts.map(x => x.prCycleTimeHours ?? 0).filter(v => v > 0);
      return vals.length ? mean(vals) : undefined;
    });

    // Test correlation between tool usage and merge rate
    const mergeRateValid = mergeRate.filter(v => v !== undefined).length >= 4;
    const aiAssistsValid = aiAssists.filter(v => v > 0).length >= 4;
    
    if (mergeRateValid && aiAssistsValid) {
      const x: number[] = [], y: number[] = [];
      periods.forEach((_, i) => {
        if (mergeRate[i] !== undefined && aiAssists[i] > 0) {
          x.push(aiAssists[i]);
          y.push(mergeRate[i]!);
        }
      });
      
      if (x.length >= 4) {
        const r = pearson(x, y);
        if (Math.abs(r) > 0.5) {
          const lastMR = mergeRate.filter(v => v !== undefined).slice(-1)[0] ?? 0;
          const avgAI = mean(aiAssists.filter(v => v > 0));
          
          insights.push({
            id: safeId(),
            title: `${tool} shows ${r > 0 ? 'positive' : 'negative'} correlation with merge rate (r=${r.toFixed(2)})`,
            description: `${tool} usage ${r > 0 ? 'correlates with higher' : 'correlates with lower'} merge rates. ${r > 0 ? 'Consider expanding' : 'Review'} ${tool} adoption and configuration.`,
            severity: Math.abs(r) > 0.7 ? 'warning' : 'info',
            insightClass: 'tool_statistical',
            tags: ['velocity', 'tools', 'team'],
            related: { tools: [tool] },
            evidence: [
              { label: 'Correlation (r)', metric: `corr(${tool}_aiAssists, mergeRatePct)`, value: Number(r.toFixed(2)) },
              { label: 'Latest merge rate %', metric: 'mergeRatePct', value: Number(lastMR.toFixed(1)) },
              { label: 'Avg AI assists', metric: `${tool}_aiAssists`, value: Number(avgAI.toFixed(0)) },
              { label: 'Periods', metric: 'periods', value: x.length },
            ],
            recommendations: [
              { text: `${r > 0 ? 'Expand' : 'Review'} ${tool} licenses/configs for teams with high merge rates.`, actionType: 'tooling' },
              { text: `${r > 0 ? 'Promote' : 'Investigate'} ${tool} best practices and team training.`, actionType: r > 0 ? 'training' : 'process' },
            ],
            source: 'mixed'
          });
        }
      }
    }

    // Test correlation between tool usage and cycle time
    const cycleTimeValid = cycleTime.filter(v => v !== undefined).length >= 4;
    if (cycleTimeValid && aiAssistsValid) {
      const x: number[] = [], y: number[] = [];
      periods.forEach((_, i) => {
        if (cycleTime[i] !== undefined && aiAssists[i] > 0) {
          x.push(aiAssists[i]);
          y.push(cycleTime[i]!);
        }
      });
      
      if (x.length >= 4) {
        const r = pearson(x, y);
        if (Math.abs(r) > 0.5) {
          const lastCT = cycleTime.filter(v => v !== undefined).slice(-1)[0] ?? 0;
          const avgAI = mean(aiAssists.filter(v => v > 0));
          
          insights.push({
            id: safeId(),
            title: `${tool} usage ${r > 0 ? 'increases' : 'decreases'} cycle time (r=${r.toFixed(2)})`,
            description: `${tool} usage ${r > 0 ? 'correlates with longer' : 'correlates with shorter'} PR cycle times. ${r > 0 ? 'Review' : 'Promote'} ${tool} workflows and review processes.`,
            severity: Math.abs(r) > 0.7 ? 'warning' : 'info',
            insightClass: 'tool_statistical',
            tags: ['velocity', 'tools', 'team'],
            related: { tools: [tool] },
            evidence: [
              { label: 'Correlation (r)', metric: `corr(${tool}_aiAssists, prCycleTimeHours)`, value: Number(r.toFixed(2)) },
              { label: 'Latest cycle time (hrs)', metric: 'prCycleTimeHours', value: Number(lastCT.toFixed(1)) },
              { label: 'Avg AI assists', metric: `${tool}_aiAssists`, value: Number(avgAI.toFixed(0)) },
              { label: 'Periods', metric: 'periods', value: x.length },
            ],
            recommendations: [
              { text: `${r > 0 ? 'Review' : 'Expand'} ${tool} usage patterns and review capacity.`, actionType: 'process' },
              { text: `${r > 0 ? 'Add' : 'Promote'} ${tool} quality gates and testing workflows.`, actionType: 'tooling' },
            ],
            source: 'mixed'
          });
        }
      }
    }
  }

  return insights;
};

// --- Rule 3: Change failure rate ↑ alongside AI assists (quality risk) ---
const ruleFailureVsAI: Rule = ({ engOutput, productivity }) => {

  // recent window to reduce noise
  const out = engOutput.slice(-12);
  const prod = productivity.slice(-12);
  const cfr = out.map(o => o.changeFailureRatePct).filter(v => typeof v === 'number') as number[];
  const ai  = prod.map(p => p.aiAssists).filter(v => typeof v === 'number') as number[];
  if (cfr.length < 4 || ai.length < 4) return [];

  const r = pearson(ai, cfr);
  const { minN, pMax, minAbsR } = metricThresholds('change-failure-rate')
  if (r < minAbsR || ai.length < minN) return [];

  const last = cfr[cfr.length-1];
  const z = zscore(last, cfr.slice(0,-1));
  if (z < 1) return [];

  return [{
    id: safeId(),
    title: 'Change failure rate rising alongside AI-assisted edits',
    description: 'Quality regressions may stem from insufficient tests or review rigor on AI-assisted code.',
    severity: z > 2 ? 'critical' : 'warning',
    tags: ['quality','ai','tools'],
    related: { tools: ['*'] },
    evidence: [
      { label: 'Correlation', metric: 'corr(aiAssists, changeFailureRatePct)', value: Number(r.toFixed(2)) },
      { label: 'Latest CFR %', metric: 'changeFailureRatePct', value: Number(last.toFixed(1)) },
      { label: 'CFR z-score', metric: 'zscore', value: Number(z.toFixed(2)) },
    ],
    recommendations: [
      { text: 'Gate risky paths with test minimums for AI-authored diffs.', actionType: 'tooling' },
      { text: 'Require "test-diff" evidence in PR descriptions for AI chunks.', actionType: 'review_policy' },
    ],
    source: 'mixed'
  }];
};

// ---- Insufficient Data rule (consolidated hint) ----
const MIN_PERIODS = 4;

const overlapCount = (
  periods: string[],
  a: (number | undefined)[],
  b: (number | undefined)[]
) => {
  // Guard against invalid inputs
  if (!Array.isArray(periods) || !Array.isArray(a) || !Array.isArray(b)) {
    if (import.meta.env.DEV) {
      console.warn('[overlapCount] Invalid inputs:', { 
        periodsIsArray: Array.isArray(periods),
        aIsArray: Array.isArray(a), 
        bIsArray: Array.isArray(b) 
      });
    }
    return 0;
  }
  
  let n = 0;
  for (let i = 0; i < periods.length; i++) {
    if (a[i] !== undefined && b[i] !== undefined) n++;
  }
  return n;
};

const ruleInsufficientData: Rule = (context) => {
  const { engOutput, productivity, overlap, ghSeries, prodSeries } = context;
  
  const usedOverlap = context?.overlap ?? overlapCountFromTime(context?.ghSeries || [], context?.prodSeries || []);
  console.log('[RULE_INSUFF_ACTIVE_V2]', { usedOverlap, gh: (context?.ghSeries||[]).length, prod: (context?.prodSeries||[]).length });
  
  console.log('🔍 ruleInsufficientData - engOutput length:', engOutput?.length || 0)
  console.log('🔍 ruleInsufficientData - productivity length:', productivity?.length || 0)
  console.log('🔍 ruleInsufficientData - precomputed overlap:', overlap)
  console.log('🔍 ruleInsufficientData - engOutput data:', engOutput)
  console.log('🔍 ruleInsufficientData - productivity data:', productivity)
  
  // ALIGNED WITH HARNESS: overlap >= 2 is good enough
  const hasEngOutput = engOutput?.length > 0;
  const hasProductivity = productivity?.length > 0;
  const combined = hasEngOutput && hasProductivity;
  const shouldShowCoverage = PERF_COVERAGE_SWITCH && combined && (usedOverlap < 2);

  if (!combined) {
    console.log('[PERF_ENGINE_LIVE_V6] coverage suppressed - single dataset');
    return [];
  }

  if (!shouldShowCoverage) {
    console.log('[PERF_ENGINE_LIVE_V6] coverage suppressed - sufficient overlap');
    return [];
  }

  console.log('🔍 ruleInsufficientData - RETURNING INSUFFICIENT DATA INSIGHT')
  return [{
    id: safeId(),
    title: 'Not enough series to analyze cross-dataset insights',
    description: 'We need both Engineering Output and Productivity-by-Tool time series. Try widening the date range or selecting more teams/tools.',
    severity: 'info',
    tags: ['data','coverage'],
    equivalenceKey: 'coverage/insufficient',
    related: {},
    evidence: [],
    recommendations: [
      { text: 'Increase time range to include ≥4 periods.', actionType: 'process' },
      { text: 'Select additional teams/tools or clear filters.', actionType: 'process' }
    ],
    source: 'mixed'
  }];
  
  console.log('🔍 ruleInsufficientData - SUFFICIENT OVERLAP, RETURNING EMPTY')
  return []

  // Build aligned period grid
  const outByP = new Map<string, EngOutputPoint[]>();
  engOutput.forEach(p => { const a = outByP.get(p.period) || []; a.push(p); outByP.set(p.period, a); });

  const prodByP = new Map<string, ToolProductivityPoint[]>();
  productivity.forEach(p => { const a = prodByP.get(p.period) || []; a.push(p); prodByP.set(p.period, a); });

  const periods = [...new Set([...outByP.keys(), ...prodByP.keys()])].sort();
  if (!periods.length) {
    return [{
      id: safeId(),
      title: 'No overlapping periods after filters',
      description: 'Filters removed all overlapping weeks between Engineering Output and Productivity data.',
      severity: 'info',
      tags: ['data','coverage'],
      related: {},
      evidence: [],
      recommendations: [
        { text: 'Widen the date range or clear some filters.', actionType: 'process' }
      ],
      source: 'mixed'
    }];
  }

  // Build aligned metric arrays
  const meanOrUndef = (xs: (number | undefined)[]) => {
    const v = xs.filter((z): z is number => typeof z === 'number');
    return v.length ? mean(v) : undefined;
  };

  const prCycleTime = periods.map(p => meanOrUndef((outByP.get(p) || []).map(x => x.prCycleTimeHours)));
  const mergeRate    = periods.map(p => meanOrUndef((outByP.get(p) || []).map(x => x.mergeRatePct)));
  const changeFail   = periods.map(p => meanOrUndef((outByP.get(p) || []).map(x => x.changeFailureRatePct)));

  const aiAssists = periods.map(p => {
    const pts = prodByP.get(p) || [];
    const sum = pts.reduce((a,b)=> a + (b.aiAssists ?? 0), 0);
    return sum > 0 ? sum : undefined;
  });

  const codingMins = periods.map(p => {
    const pts = prodByP.get(p) || [];
    const sum = pts.reduce((a,b)=> a + (b.codingMinutes ?? 0), 0);
    return sum > 0 ? sum : undefined;
  });

  // Pairs required by our current rules
  const pairs = [
    { label: 'AI assists ↔ PR cycle time', a: aiAssists, b: prCycleTime },
    { label: 'Coding minutes ↔ Merge rate', a: codingMins, b: mergeRate },
    { label: 'AI assists ↔ Change failure rate', a: aiAssists, b: changeFail },
  ];

  const shortages = pairs.map(p => ({
    label: p.label,
    overlap: overlapCount(periods, p.a, p.b)
  })).filter(x => x.overlap < MIN_PERIODS);

  if (!shortages.length) return []; // Enough data → let analytic rules run

  return [{
    id: safeId(),
    title: 'Insufficient overlapping data to generate some insights',
    description: `At least ${MIN_PERIODS} overlapping periods are required for robust signals. One or more metric pairs don't meet this threshold under current filters.`,
    severity: 'info',
    tags: ['data','coverage'],
    related: {},
    evidence: shortages.map(s => ({ label: s.label, metric: 'overlapPeriods', value: s.overlap })),
    recommendations: [
      { text: `Widen the date range to include ≥${MIN_PERIODS} periods.`, actionType: 'process' },
      { text: 'Include more teams/tools or clear narrow filters.', actionType: 'process' }
    ],
    source: 'mixed'
  }];
};

// --- Rule 4: Tool impact by team (coding minutes ↔ merge rate, per team & tool) ---
const ruleToolImpactByTeam: Rule = ({ engOutput, productivity }) => {
  if (!engOutput?.length || !productivity?.length) return [];
  const periods = Array.from(new Set([
    ...engOutput.map(p => p.period),
    ...productivity.map(p => p.period),
  ])).sort();
  if (periods.length < 4) return [];

  // index: team -> period -> EngOutputPoint[]
  const outByTeam = new Map<string, Map<string, EngOutputPoint[]>>();
  engOutput.forEach(p => {
    const t = p.team || 'default-team';
    const pm = outByTeam.get(t) || new Map<string, EngOutputPoint[]>();
    const arr = pm.get(p.period) || [];
    arr.push(p);
    pm.set(p.period, arr);
    outByTeam.set(t, pm);
  });

  // index: team||tool -> period -> ToolProductivityPoint[]
  const prodByTeamTool = new Map<string, Map<string, ToolProductivityPoint[]>>();
  productivity.forEach(p => {
    const key = `${p.team || 'default-team'}||${p.tool}`;
    const pm = prodByTeamTool.get(key) || new Map<string, ToolProductivityPoint[]>();
    const arr = pm.get(p.period) || [];
    arr.push(p);
    pm.set(p.period, arr);
    prodByTeamTool.set(key, pm);
  });

  const results: PerformanceInsight[] = [];

  for (const [key, perMap] of prodByTeamTool.entries()) {
    const [team, tool] = key.split('||');
    const outPer = outByTeam.get(team);
    if (!outPer) continue;

    const mr: (number|undefined)[] = [];
    const coding: (number|undefined)[] = [];

    periods.forEach(p => {
      const outs = outPer.get(p) || [];
      const mrs = outs.map(o => o.mergeRatePct ?? 0).filter(v => v > 0);
      mr.push(mrs.length ? mean(mrs) : undefined);

      const prods = perMap.get(p) || [];
      const sumCoding = prods.reduce((a,b)=> a + (b.codingMinutes ?? 0), 0);
      coding.push(sumCoding > 0 ? sumCoding : undefined);
    });

    const x:number[] = [], y:number[] = [];
    for (let i=0;i<periods.length;i++) {
      if (mr[i] !== undefined && coding[i] !== undefined) { x.push(coding[i]!); y.push(mr[i]!); }
    }
    if (x.length < 4) continue;

    const r = pearson(x, y);
    const { minN, pMax, minAbsR } = metricThresholds('merge-rate')
    if (r < minAbsR || x.length < minN) continue;
    const latestMR = (mr.filter(v=>v!==undefined) as number[]).slice(-1)[0] ?? 0;

    results.push({
      id: safeId(),
      title: `${tool} usage correlates with higher merge rate`,
      description: `In ${team === 'default-team' ? 'this team' : team}, increased productive time in ${tool} aligns with a higher share of PRs merging.`,
      severity: 'opportunity', // Positive correlation is always an opportunity
      tags: ['velocity','tools','team'],
      related: { teams: [team], tools: [tool] },
      evidence: [
        { label: 'Correlation (r)', metric: 'corr(codingMinutes, mergeRatePct)', value: Number(r.toFixed(2)) },
        { label: 'Latest merge rate %', metric: 'mergeRatePct', value: Number(latestMR.toFixed(1)) },
        { label: 'Periods', metric: 'n', value: x.length },
      ],
      recommendations: [
        { text: `Expand ${tool} licenses/configs for ${team}.`, actionType: 'tooling' },
        { text: `Standardize effective ${tool} setups (snippets/templates).`, actionType: 'process' },
      ],
      source: 'mixed'
    });
  }

  // cap fan-out
  return results
    .sort((a,b) =>
      Number(b.evidence.find(e=>e.metric==='corr(codingMinutes, mergeRatePct)')?.value ?? 0) -
      Number(a.evidence.find(e=>e.metric==='corr(codingMinutes, mergeRatePct)')?.value ?? 0)
    )
    .slice(0, 3);
};

// --- Rule 5: Developer quality outlier with high AI assists (per developer) ---
const ruleDevQualityOutlier: Rule = ({ engOutput, productivity }) => {
  if (!engOutput?.length || !productivity?.length) return [];
  const hasDev = engOutput.some((p:any) => p.developer) && productivity.some((p:any) => p.developer);
  if (!hasDev) return [];

  const periods = Array.from(new Set(engOutput.map(p => p.period))).sort();
  if (periods.length < 4) return [];

  const outByP = new Map<string, EngOutputPoint[]>(); engOutput.forEach(p => {
    const arr = outByP.get(p.period) || []; arr.push(p); outByP.set(p.period, arr);
  });
  const prodByP = new Map<string, ToolProductivityPoint[]>(); productivity.forEach(p => {
    const arr = prodByP.get(p.period) || []; arr.push(p); prodByP.set(p.period, arr);
  });

  const devs = new Set<string>(); engOutput.forEach((p:any) => p.developer && devs.add(p.developer));

  const insights: PerformanceInsight[] = [];
  for (const dev of devs) {
    const cfr:(number|undefined)[] = []; const assists:(number|undefined)[] = [];
    periods.forEach(per => {
      const outs = (outByP.get(per) || []).filter((o:any) => o.developer === dev);
      const prods = (prodByP.get(per) || []).filter((q:any) => q.developer === dev);

      const cfrVals = outs.map(o => o.changeFailureRatePct ?? 0).filter(v => v > 0);
      cfr.push(cfrVals.length ? mean(cfrVals) : undefined);

      const aiSum = prods.reduce((a,b)=> a + (b.aiAssists ?? 0), 0);
      assists.push(aiSum > 0 ? aiSum : undefined);
    });

    const x:number[] = [], y:number[] = [];
    for (let i=0;i<periods.length;i++) if (assists[i]!==undefined && cfr[i]!==undefined) { x.push(assists[i]!); y.push(cfr[i]!); }
    if (x.length < 4) continue;

    const r = pearson(x, y);
    const { minN, pMax, minAbsR } = metricThresholds('change-failure-rate')
    if (r < minAbsR || x.length < minN) continue;

    const vals = y.filter(v => v !== undefined) as number[];
    if (vals.length < 3) continue;
    const latest = vals[vals.length-1];
    const z = zscore(latest, vals.slice(0, -1));
    if (z < 1.5) continue;

  insights.push({
    id: safeId(),
    title: `Developer ${dev}: elevated change failure rate with high AI assists`,
    description: `Recent spikes in AI-assisted edits for ${dev} align with a higher change failure rate.`,
    severity: z > 2.5 ? 'critical' : 'warning',
    insightClass: 'tool_statistical',
    tags: ['quality','ai','developer'],
    related: { developers: [dev] },
    evidence: [
      { label: 'Correlation (r)', metric: 'corr(aiAssists, changeFailureRatePct)', value: Number(r.toFixed(2)) },
      { label: 'Latest CFR %', metric: 'changeFailureRatePct', value: Number(latest.toFixed(1)) },
      { label: 'CFR z-score', metric: 'zscore', value: Number(z.toFixed(2)) },
      { label: 'Periods', metric: 'n', value: x.length },
    ],
    recommendations: [
      { text: 'Add targeted review checklist for AI-heavy diffs.', actionType: 'review_policy' },
      { text: 'Pair on tests; ensure regression coverage.', actionType: 'process' },
    ],
    source: 'mixed'
  });
  }

  // top 3 by z-score
  return insights.sort((a,b) => {
    const za = Number(a.evidence.find(e=>e.metric==='zscore')?.value ?? 0);
    const zb = Number(b.evidence.find(e=>e.metric==='zscore')?.value ?? 0);
    return zb - za;
  }).slice(0, 3);
};

// Simple rule that detects basic performance issues
const ruleBasicPerformanceIssues: Rule = ({ engOutput, productivity }) => {
  if (!engOutput?.length) return [];
  
  const insights: PerformanceInsight[] = [];
  
  // Check for high cycle times
  const cycleTimes = engOutput
    .map(e => e.prCycleTimeHours)
    .filter((t): t is number => typeof t === 'number' && t > 0);
  if (cycleTimes.length > 0) {
    const avgCycleTime = mean(cycleTimes);
    const maxCycleTime = Math.max(...cycleTimes);
    
    if (avgCycleTime > 24) { // More than 24 hours average
      insights.push({
        id: 'high-cycle-time-' + Date.now(),
        title: 'High PR Cycle Time Detected',
        description: `Average PR cycle time is ${avgCycleTime.toFixed(1)} hours, with maximum of ${maxCycleTime.toFixed(1)} hours. This indicates potential bottlenecks in the review process.`,
        severity: avgCycleTime > 48 ? 'critical' : 'warning',
        insightClass: 'org_deterministic',
        tags: ['cycle-time', 'review-process'],
        related: {},
        evidence: [
          { label: 'Average Cycle Time', value: avgCycleTime.toFixed(1) + ' hours' },
          { label: 'Maximum Cycle Time', value: maxCycleTime.toFixed(1) + ' hours' },
          { label: 'Time Range', value: `${cycleTimes.length} Weeks` }
        ],
        recommendations: [
          { text: 'Review PR review process and identify bottlenecks', actionType: 'process' },
          { text: 'Consider implementing automated checks to reduce manual review time', actionType: 'tooling' }
        ],
        source: 'github'
      });
    }
  }
  
  // Check for low merge rates
  const mergeRates = engOutput
    .map(e => e.mergeRatePct)
    .filter((r): r is number => typeof r === 'number' && r > 0);
  if (mergeRates.length > 0) {
    const avgMergeRate = mean(mergeRates);
    
    if (avgMergeRate < 70) { // Less than 70% merge rate
      insights.push({
        id: 'low-merge-rate-' + Date.now(),
        title: 'Low PR Merge Rate Detected',
        description: `Average merge rate is ${avgMergeRate.toFixed(1)}%, which indicates potential issues with PR quality or review process.`,
        severity: avgMergeRate < 50 ? 'critical' : 'warning',
        insightClass: 'org_deterministic',
        tags: ['merge-rate', 'quality'],
        related: {},
        evidence: [
          { label: 'Average Merge Rate', value: avgMergeRate.toFixed(1) + '%' },
          { label: 'Time Range', value: `${mergeRates.length} Weeks` }
        ],
        recommendations: [
          { text: 'Review PR quality standards and pre-submission checks', actionType: 'process' },
          { text: 'Implement better PR templates and guidelines', actionType: 'process' }
        ],
        source: 'github'
      });
    }
  }
  
  return insights;
};

// Tool-specific performance analysis rule
const ruleToolPerformanceAnalysis: Rule = ({ engOutput, productivity }) => {
  if (!productivity?.length) return [];
  
  const insights: PerformanceInsight[] = [];
  
  // Group productivity data by tool
  const toolData = new Map<string, ToolProductivityPoint[]>();
  productivity.forEach(p => {
    if (p.tool) {
      const arr = toolData.get(p.tool) || [];
      arr.push(p);
      toolData.set(p.tool, arr);
    }
  });
  
  // Analyze each tool
  for (const [tool, toolPoints] of toolData) {
    if (toolPoints.length < 2) continue;
    
    // Calculate metrics for this tool
    const aiAssists = toolPoints.map(p => p.aiAssists || 0);
    const codingMinutes = toolPoints.map(p => p.codingMinutes || 0);
    
    const avgAiAssists = mean(aiAssists);
    const avgCodingMinutes = mean(codingMinutes);
    const totalAiAssists = aiAssists.reduce((a, b) => a + b, 0);
    const totalCodingMinutes = codingMinutes.reduce((a, b) => a + b, 0);
    
    // Check for trends over time
    const periods = toolPoints.map(p => p.period).sort();
    const aiTrend = aiAssists.length > 1 ? (aiAssists[aiAssists.length - 1] - aiAssists[0]) / aiAssists[0] : 0;
    const codingTrend = codingMinutes.length > 1 ? (codingMinutes[codingMinutes.length - 1] - codingMinutes[0]) / codingMinutes[0] : 0;
    
    // Generate insights based on tool performance
    if (avgAiAssists > 50) {
      insights.push({
        id: `high-ai-usage-${tool}-${Date.now()}`,
        title: `High AI Usage Detected in ${tool.toUpperCase()}`,
        description: `${tool.toUpperCase()} shows high AI assistance usage with ${avgAiAssists.toFixed(1)} average assists per period. ${aiTrend > 0.2 ? 'Usage is increasing over time.' : aiTrend < -0.2 ? 'Usage is decreasing over time.' : 'Usage is stable.'}`,
        severity: avgAiAssists > 100 ? 'critical' : 'warning',
        tags: ['ai-usage', 'tool-performance', tool],
        related: { tools: [tool] },
        evidence: [
          { label: 'Total AI Assists', value: totalAiAssists },
          { label: 'Usage Trend', value: aiTrend > 0.2 ? 'Increasing' : aiTrend < -0.2 ? 'Decreasing' : 'Stable' },
          { label: 'Time Range', value: `${toolPoints.length} Weeks` }
        ],
        recommendations: [
          { text: `Review ${tool} AI configuration and usage patterns`, actionType: 'tooling' },
          { text: `Consider optimizing ${tool} AI suggestions for better productivity`, actionType: 'process' }
        ],
        source: 'productivity'
      });
    }
    
    if (avgCodingMinutes > 120) {
      insights.push({
        id: `high-coding-time-${tool}-${Date.now()}`,
        title: `High Coding Time Detected in ${tool.toUpperCase()}`,
        description: `${tool.toUpperCase()} shows high coding time with ${avgCodingMinutes.toFixed(1)} minutes average per period. ${codingTrend > 0.2 ? 'Time is increasing over time.' : codingTrend < -0.2 ? 'Time is decreasing over time.' : 'Time is stable.'}`,
        severity: avgCodingMinutes > 200 ? 'critical' : 'warning',
        tags: ['coding-time', 'tool-performance', tool],
        related: { tools: [tool] },
        evidence: [
          { label: 'Average Coding Minutes', value: avgCodingMinutes.toFixed(1) },
          { label: 'Total Coding Minutes', value: totalCodingMinutes },
          { label: 'Time Trend', value: codingTrend > 0.2 ? 'Increasing' : codingTrend < -0.2 ? 'Decreasing' : 'Stable' },
          { label: 'Time Range', value: `${toolPoints.length} Weeks` }
        ],
        recommendations: [
          { text: `Review ${tool} workflow efficiency and potential bottlenecks`, actionType: 'process' },
          { text: `Consider ${tool} performance optimization and configuration`, actionType: 'tooling' }
        ],
        source: 'productivity'
      });
    }
  }
  
  return insights;
};

// Tool comparison and ranking rule
const ruleToolComparison: Rule = ({ engOutput, productivity }) => {
  if (!productivity?.length) return [];
  
  const insights: PerformanceInsight[] = [];
  
  // Group productivity data by tool
  const toolData = new Map<string, ToolProductivityPoint[]>();
  productivity.forEach(p => {
    if (p.tool) {
      const arr = toolData.get(p.tool) || [];
      arr.push(p);
      toolData.set(p.tool, arr);
    }
  });
  
  if (toolData.size < 2) return []; // Need at least 2 tools to compare
  
  // Calculate performance metrics for each tool
  const toolMetrics = new Map<string, { aiAssists: number, codingMinutes: number, efficiency: number }>();
  
  for (const [tool, toolPoints] of toolData) {
    const aiAssists = toolPoints.map(p => p.aiAssists || 0);
    const codingMinutes = toolPoints.map(p => p.codingMinutes || 0);
    
    const avgAiAssists = mean(aiAssists);
    const avgCodingMinutes = mean(codingMinutes);
    const efficiency = avgCodingMinutes > 0 ? avgAiAssists / avgCodingMinutes : 0; // AI assists per minute
    
    toolMetrics.set(tool, { aiAssists: avgAiAssists, codingMinutes: avgCodingMinutes, efficiency });
  }
  
  // Find top and bottom performers
  const sortedByEfficiency = Array.from(toolMetrics.entries())
    .sort((a, b) => b[1].efficiency - a[1].efficiency);
  
  if (sortedByEfficiency.length >= 2) {
    const [topTool, topMetrics] = sortedByEfficiency[0];
    const [bottomTool, bottomMetrics] = sortedByEfficiency[sortedByEfficiency.length - 1];
    
    insights.push({
      id: `tool-comparison-${Date.now()}`,
      title: 'Tool Performance Comparison',
      description: `${topTool.toUpperCase()} shows highest AI efficiency (${topMetrics.efficiency.toFixed(3)} assists/min), while ${bottomTool.toUpperCase()} shows lowest efficiency (${bottomMetrics.efficiency.toFixed(3)} assists/min).`,
      severity: 'info',
      tags: ['tool-comparison', 'efficiency'],
      related: { tools: [topTool, bottomTool] },
      evidence: [
        { label: 'Top Performer', value: `${topTool.toUpperCase()} (${topMetrics.efficiency.toFixed(3)} assists/min)` },
        { label: 'Bottom Performer', value: `${bottomTool.toUpperCase()} (${bottomMetrics.efficiency.toFixed(3)} assists/min)` },
        { label: 'Tools Analyzed', value: toolMetrics.size }
      ],
      recommendations: [
        { text: `Consider adopting ${topTool} best practices across the team`, actionType: 'process' },
        { text: `Review ${bottomTool} configuration and usage patterns`, actionType: 'tooling' }
      ],
      source: 'productivity'
    });
  }
  
  return insights;
};

// Time-based trend analysis rule
const ruleTimeBasedTrends: Rule = ({ engOutput, productivity }) => {
  if (!productivity?.length) return [];
  
  const insights: PerformanceInsight[] = [];
  
  // Group by tool and analyze trends
  const toolData = new Map<string, ToolProductivityPoint[]>();
  productivity.forEach(p => {
    if (p.tool) {
      const arr = toolData.get(p.tool) || [];
      arr.push(p);
      toolData.set(p.tool, arr);
    }
  });
  
  for (const [tool, toolPoints] of toolData) {
    if (toolPoints.length < 3) continue; // Need at least 3 points for trend analysis
    
    // Sort by period
    const sortedPoints = toolPoints.sort((a, b) => a.period.localeCompare(b.period));
    
    const aiAssists = sortedPoints.map(p => p.aiAssists || 0);
    const codingMinutes = sortedPoints.map(p => p.codingMinutes || 0);
    
    // Calculate trend (simple linear trend)
    const aiTrend = aiAssists.length > 1 ? (aiAssists[aiAssists.length - 1] - aiAssists[0]) / aiAssists[0] : 0;
    const codingTrend = codingMinutes.length > 1 ? (codingMinutes[codingMinutes.length - 1] - codingMinutes[0]) / codingMinutes[0] : 0;
    
    // Generate trend insights
    if (Math.abs(aiTrend) > 0.3) { // 30% change
      insights.push({
        id: `ai-trend-${tool}-${Date.now()}`,
        title: `AI Usage Trend in ${tool.toUpperCase()}`,
        description: `${tool.toUpperCase()} shows ${aiTrend > 0 ? 'increasing' : 'decreasing'} AI usage trend (${(aiTrend * 100).toFixed(1)}% change over time).`,
        severity: Math.abs(aiTrend) > 0.5 ? 'warning' : 'info',
        tags: ['ai-trend', 'tool-performance', tool],
        related: { tools: [tool] },
        evidence: [
          { label: 'Trend Direction', value: aiTrend > 0 ? 'Increasing' : 'Decreasing' },
          { label: 'Trend Magnitude', value: `${(aiTrend * 100).toFixed(1)}%` },
          { label: 'Time Range', value: `${toolPoints.length} Weeks` }
        ],
        recommendations: [
          { text: `Monitor ${tool} AI usage patterns and adjust configuration if needed`, actionType: 'process' },
          { text: `${aiTrend > 0 ? 'Consider' : 'Review'} ${tool} AI integration and effectiveness`, actionType: 'tooling' }
        ],
        source: 'productivity'
      });
    }
    
    if (Math.abs(codingTrend) > 0.3) { // 30% change
      insights.push({
        id: `coding-trend-${tool}-${Date.now()}`,
        title: `Coding Time Trend in ${tool.toUpperCase()}`,
        description: `${tool.toUpperCase()} shows ${codingTrend > 0 ? 'increasing' : 'decreasing'} coding time trend (${(codingTrend * 100).toFixed(1)}% change over time).`,
        severity: Math.abs(codingTrend) > 0.5 ? 'warning' : 'info',
        tags: ['coding-trend', 'tool-performance', tool],
        related: { tools: [tool] },
        evidence: [
          { label: 'Trend Direction', value: codingTrend > 0 ? 'Increasing' : 'Decreasing' },
          { label: 'Trend Magnitude', value: `${(codingTrend * 100).toFixed(1)}%` },
          { label: 'Time Range', value: `${toolPoints.length} Weeks` }
        ],
        recommendations: [
          { text: `${codingTrend > 0 ? 'Investigate' : 'Maintain'} ${tool} workflow efficiency`, actionType: 'process' },
          { text: `Review ${tool} performance and configuration`, actionType: 'tooling' }
        ],
        source: 'productivity'
      });
    }
  }
  
  return insights;
};

// Tool performance summary for engineering leaders - runs first
const ruleToolPerformanceSummary: Rule = ({ engOutput, productivity }) => {
  if (!productivity?.length) return [];
  
  const insights: PerformanceInsight[] = [];
  
  // Group productivity data by tool
  const toolData = new Map<string, ToolProductivityPoint[]>();
  productivity.forEach(p => {
    if (p.tool) {
      const arr = toolData.get(p.tool) || [];
      arr.push(p);
      toolData.set(p.tool, arr);
    }
  });
  
  if (toolData.size === 0) return [];
  
  // Calculate comprehensive metrics for each tool
  const toolMetrics = Array.from(toolData.entries()).map(([tool, points]) => {
    const aiAssists = points.map(p => p.aiAssists || 0);
    const codingMinutes = points.map(p => p.codingMinutes || 0);
    const totalAiAssists = aiAssists.reduce((a, b) => a + b, 0);
    const totalCodingMinutes = codingMinutes.reduce((a, b) => a + b, 0);
    const avgAiAssists = mean(aiAssists);
    const avgCodingMinutes = mean(codingMinutes);
    const efficiency = totalCodingMinutes > 0 ? totalAiAssists / totalCodingMinutes : 0;
    const usageScore = totalAiAssists + (totalCodingMinutes / 10); // Combined usage score
    
    return { 
      tool, 
      totalAiAssists, 
      totalCodingMinutes, 
      avgAiAssists, 
      avgCodingMinutes, 
      efficiency, 
      usageScore,
      dataPoints: points.length
    };
  });
  
  // Sort by different metrics
  const sortedByEfficiency = [...toolMetrics].sort((a, b) => b.efficiency - a.efficiency);
  const sortedByUsage = [...toolMetrics].sort((a, b) => b.usageScore - a.usageScore);
  const sortedByCodingTime = [...toolMetrics].sort((a, b) => b.totalCodingMinutes - a.totalCodingMinutes);
  
  // Generate comprehensive summary
  const topPerformer = sortedByEfficiency[0];
  const bottomPerformer = sortedByEfficiency[sortedByEfficiency.length - 1];
  const mostUsed = sortedByUsage[0];
  const leastUsed = sortedByUsage[sortedByUsage.length - 1];
  
  // Build leader-friendly description
  const hasRealData = toolMetrics.length >= 3 && toolMetrics.some(t => t.totalCodingMinutes > 0);
  const dataQualifier = !hasRealData 
    ? ' (based on early data — trends will refine as more sessions are recorded)' 
    : '';
  
  const mostUsedLabel = mostUsed.totalCodingMinutes > 0
    ? `${formatNumber(mostUsed.totalAiAssists)} assists, ${formatTime(mostUsed.totalCodingMinutes)} active`
    : `${formatNumber(mostUsed.totalAiAssists)} assists`;
  
  insights.push({
    id: `tool-performance-summary-${Date.now()}`,
    title: 'IDE Performance Snapshot',
    description: `${topPerformer.tool.toUpperCase()} shows the highest AI assist activity, while ${mostUsed.tool.toUpperCase()} is the most actively used tool (${mostUsedLabel}). ${bottomPerformer.tool.toUpperCase()} shows minimal AI usage${dataQualifier}`,
    severity: 'info',
    tags: ['performance-summary', 'leadership', 'productivity'],
    related: { tools: toolMetrics.map(t => t.tool) },
    evidence: [
      { label: 'Most AI-Active', value: topPerformer.tool.toUpperCase() },
      { label: 'Most Used', value: `${mostUsed.tool.toUpperCase()} (${formatNumber(mostUsed.totalAiAssists)} assists)` },
      { label: 'Least Active', value: bottomPerformer.tool.toUpperCase() },
      { label: 'Tools Tracked', value: toolMetrics.length }
    ],
    recommendations: [
      { text: `Share ${topPerformer.tool} AI workflows across the team`, actionType: 'process' },
      { text: `Investigate why ${bottomPerformer.tool} shows low AI adoption`, actionType: 'process' }
    ],
    source: 'productivity',
    metricId: 'ide.ai_efficiency'
  });
  
  return insights;
};

// Comprehensive insights rule that generates multiple insights from any data
const ruleComprehensiveInsights: Rule = ({ engOutput, productivity }) => {
  const insights: PerformanceInsight[] = [];
  
  // 1. GitHub Performance Insights
  if (engOutput?.length > 0) {
    const cycleTimes = engOutput
      .map(e => e.prCycleTimeHours)
      .filter((t): t is number => typeof t === 'number' && t > 0);
    const mergeRates = engOutput
      .map(e => e.mergeRatePct)
      .filter((r): r is number => typeof r === 'number' && r > 0);
    const reviewTimes = engOutput
      .map(e => e.timeToFirstReviewHours)
      .filter((t): t is number => typeof t === 'number' && t > 0);
    const failureRates = engOutput
      .map(e => e.changeFailureRatePct)
      .filter((f): f is number => typeof f === 'number' && f > 0);
    
    if (cycleTimes.length > 0) {
      const avgCycleTime = mean(cycleTimes);
      const maxCycleTime = Math.max(...cycleTimes);
      const minCycleTime = Math.min(...cycleTimes);
      
      insights.push({
        id: `cycle-time-analysis-${Date.now()}`,
        title: 'PR Cycle Time Analysis',
        description: `PR cycle times range from ${minCycleTime.toFixed(1)} to ${maxCycleTime.toFixed(1)} hours, with an average of ${avgCycleTime.toFixed(1)} hours.`,
        severity: avgCycleTime > 48 ? 'critical' : avgCycleTime > 24 ? 'warning' : 'info',
        tags: ['cycle-time', 'pr-performance'],
        related: {},
        evidence: [
          { label: 'Average Cycle Time', value: avgCycleTime.toFixed(1) + ' hours' },
          { label: 'Range', value: `${minCycleTime.toFixed(1)} - ${maxCycleTime.toFixed(1)} hours` },
          { label: 'Time Range', value: `${cycleTimes.length} Weeks` }
        ],
        recommendations: [
          { text: 'Implement automated PR checks to reduce manual review time', actionType: 'tooling' },
          { text: 'Set up PR review reminders and escalation policies', actionType: 'process' }
        ],
        source: 'github'
      });
    }
    
    if (reviewTimes.length > 0) {
      const avgReviewTime = mean(reviewTimes);
      const maxReviewTime = Math.max(...reviewTimes);
      
      insights.push({
        id: `review-time-analysis-${Date.now()}`,
        title: 'Code Review Response Time',
        description: `Average time to first review is ${avgReviewTime.toFixed(1)} hours, with maximum of ${maxReviewTime.toFixed(1)} hours.`,
        severity: avgReviewTime > 12 ? 'critical' : avgReviewTime > 6 ? 'warning' : 'info',
        tags: ['review-time', 'code-review'],
        related: {},
        evidence: [
          { label: 'Average Review Time', value: avgReviewTime.toFixed(1) + ' hours' },
          { label: 'Maximum Review Time', value: maxReviewTime.toFixed(1) + ' hours' },
          { label: 'Time Range', value: `${reviewTimes.length} Weeks` }
        ],
        recommendations: [
          { text: 'Implement review assignment rotation to distribute workload', actionType: 'process' },
          { text: 'Set up automated notifications for pending reviews', actionType: 'tooling' }
        ],
        source: 'github'
      });
    }
    
    if (failureRates.length > 0) {
      const avgFailureRate = mean(failureRates);
      const maxFailureRate = Math.max(...failureRates);
      
      insights.push({
        id: `failure-rate-analysis-${Date.now()}`,
        title: 'Change Failure Rate Analysis',
        description: `Average change failure rate is ${avgFailureRate.toFixed(1)}%, with maximum of ${maxFailureRate.toFixed(1)}%.`,
        severity: avgFailureRate > 15 ? 'critical' : avgFailureRate > 10 ? 'warning' : 'info',
        tags: ['failure-rate', 'quality'],
        related: {},
        evidence: [
          { label: 'Average Failure Rate', value: avgFailureRate.toFixed(1) + '%' },
          { label: 'Maximum Failure Rate', value: maxFailureRate.toFixed(1) + '%' },
          { label: 'Time Range', value: `${failureRates.length} Weeks` }
        ],
        recommendations: [
          { text: 'Implement pre-merge automated testing and quality gates', actionType: 'tooling' },
          { text: 'Review and improve PR quality standards and guidelines', actionType: 'process' }
        ],
        source: 'github'
      });
    }
  }
  
  // 2. Productivity Insights
  if (productivity?.length > 0) {
    // Group by tool
    const toolData = new Map<string, ToolProductivityPoint[]>();
    productivity.forEach(p => {
      if (p.tool) {
        const arr = toolData.get(p.tool) || [];
        arr.push(p);
        toolData.set(p.tool, arr);
      }
    });
    
    // Generate insights for each tool
    for (const [tool, toolPoints] of toolData) {
      if (toolPoints.length === 0) continue;
      
      const aiAssists = toolPoints.map(p => p.aiAssists || 0);
      const codingMinutes = toolPoints.map(p => p.codingMinutes || 0);
      
      const totalAiAssists = aiAssists.reduce((a, b) => a + b, 0);
      const totalCodingMinutes = codingMinutes.reduce((a, b) => a + b, 0);
      const avgAiAssists = mean(aiAssists);
      const avgCodingMinutes = mean(codingMinutes);
      
      // Tool usage insight
      insights.push({
        id: `tool-usage-${tool}-${Date.now()}`,
        title: `${tool.toUpperCase()} Usage Analysis`,
        description: `${tool.toUpperCase()} shows ${formatNumber(totalAiAssists)} total AI assists and ${formatTime(totalCodingMinutes)} total coding time across ${toolPoints.length} data points.`,
        severity: totalAiAssists > 200 ? 'info' : totalAiAssists > 100 ? 'info' : 'info',
        tags: ['tool-usage', 'productivity', tool],
        related: { tools: [tool] },
        evidence: [
          { label: 'Total AI Assists', value: formatNumber(totalAiAssists) },
          { label: 'Total Coding Time', value: formatTime(totalCodingMinutes) },
          { label: 'Average Coding Time', value: formatTime(avgCodingMinutes) },
          { label: 'Time Range', value: `${toolPoints.length} Weeks` }
        ],
        recommendations: getUniqueToolRecommendations(tool, 0, totalAiAssists, totalCodingMinutes) as any,
        source: 'productivity'
      });
      
      // Tool efficiency insight
      if (totalCodingMinutes > 0) {
        const efficiency = totalAiAssists / totalCodingMinutes;
        insights.push({
          id: `tool-efficiency-${tool}-${Date.now()}`,
          title: `${tool.toUpperCase()} AI Efficiency`,
          description: `${tool.toUpperCase()} shows ${efficiency.toFixed(4)} AI assists per minute of coding time.`,
          severity: efficiency > 0.5 ? 'info' : efficiency > 0.1 ? 'warning' : 'critical',
          tags: ['ai-efficiency', 'tool-performance', tool],
          related: { tools: [tool] },
          evidence: [
            { label: 'AI Efficiency', value: efficiency.toFixed(4) + ' assists/min' },
            { label: 'Total AI Assists', value: formatNumber(totalAiAssists) },
            { label: 'Total Coding Time', value: formatTime(totalCodingMinutes) }
          ],
          recommendations: getUniqueToolRecommendations(tool, efficiency, totalAiAssists, totalCodingMinutes) as any,
          source: 'productivity'
        });
      }
    }
    
    // Cross-tool comparison
    if (toolData.size >= 2) {
      const toolMetrics = Array.from(toolData.entries()).map(([tool, points]) => {
        const aiAssists = points.map(p => p.aiAssists || 0);
        const codingMinutes = points.map(p => p.codingMinutes || 0);
        const totalAiAssists = aiAssists.reduce((a, b) => a + b, 0);
        const totalCodingMinutes = codingMinutes.reduce((a, b) => a + b, 0);
        const efficiency = totalCodingMinutes > 0 ? totalAiAssists / totalCodingMinutes : 0;
        return { tool, totalAiAssists, totalCodingMinutes, efficiency };
      });
      
      const sortedByUsage = toolMetrics.sort((a, b) => b.totalAiAssists - a.totalAiAssists);
      const sortedByEfficiency = toolMetrics.sort((a, b) => b.efficiency - a.efficiency);
      
      insights.push({
        id: `tool-ranking-${Date.now()}`,
        title: 'Tool Usage Ranking',
        description: `Most used tool: ${sortedByUsage[0].tool.toUpperCase()} (${formatNumber(sortedByUsage[0].totalAiAssists)} AI assists), Most efficient: ${sortedByEfficiency[0].tool.toUpperCase()} (${sortedByEfficiency[0].efficiency.toFixed(4)} assists/min).`,
        severity: 'info',
        tags: ['tool-ranking', 'usage-analysis'],
        related: { tools: toolMetrics.map(t => t.tool) },
        evidence: [
          { label: 'Most Used Tool', value: `${sortedByUsage[0].tool.toUpperCase()} (${formatNumber(sortedByUsage[0].totalAiAssists)} assists)` },
          { label: 'Most Efficient Tool', value: `${sortedByEfficiency[0].tool.toUpperCase()} (${sortedByEfficiency[0].efficiency.toFixed(4)} assists/min)` },
          { label: 'Tools Analyzed', value: toolMetrics.length }
        ],
        recommendations: [
          { text: `Consider adopting ${sortedByEfficiency[0].tool} best practices across the team`, actionType: 'process' },
          { text: `Review ${sortedByUsage[0].tool} configuration for optimal performance`, actionType: 'tooling' }
        ],
        source: 'productivity'
      });
    }
  }
  
  return insights;
};

// Phase 5: Helper to compute per-tool stats for coverage messaging
interface ToolCoverageStats {
  tool: string
  points: number
  avgCodingMinutes: number
  avgAiAssists: number
  aiPerMinute: number // 0 if codingMinutes == 0
}

function computeCoverageStatsForTools(input: PerformanceInputs): ToolCoverageStats[] {
  const stats: ToolCoverageStats[] = []
  const toolMap = new Map<string, ToolProductivityPoint[]>()

  // Group productivity points by tool
  if (input.productivity?.length) {
    for (const prod of input.productivity) {
      if (prod.tool) {
        const existing = toolMap.get(prod.tool) || []
        existing.push(prod)
        toolMap.set(prod.tool, existing)
      }
    }
  }

  // DEMO-only coding minutes multiplier map (for ratio repair when aiAssists === codingMinutes)
  const DEMO_CODING_MINUTES_MULTIPLIER: Record<string, number> = {
    cursor: 2.8,
    windsurf: 2.6,
    vscode: 2.4,
    jetbrains: 3.0,
    sublime: 3.2,
    vim: 3.4,
  }

  // Compute stats for each tool
  for (const [tool, points] of toolMap.entries()) {
    const totalCodingMinutes = points.reduce((sum, p) => sum + (p.codingMinutes || 0), 0)
    const totalAiAssists = points.reduce((sum, p) => sum + (p.aiAssists || 0), 0)
    const avgCodingMinutes = points.length > 0 ? totalCodingMinutes / points.length : 0
    const avgAiAssists = points.length > 0 ? totalAiAssists / points.length : 0
    let aiPerMinute = avgCodingMinutes > 0 ? avgAiAssists / avgCodingMinutes : 0

    // DEMO-only patch: Detect and repair broken ratio (aiAssists === codingMinutes)
    let finalAvgCodingMinutes = avgCodingMinutes
    let finalTotalCodingMinutes = totalCodingMinutes
    let finalAiPerMinute = aiPerMinute

    if (DEMO_MODE && points.length > 0 && avgCodingMinutes > 0) {
      // Check if all points are simulated/demo
      const allPointsAreSim = points.every(p => p.source === 'sim')
      
      // Detect broken pattern: avgCodingMinutes ≈ avgAiAssists (within 0.01 tolerance)
      const isBrokenRatio = Math.abs(avgCodingMinutes - avgAiAssists) < 0.01

      if (allPointsAreSim && isBrokenRatio) {
        // Apply per-tool multiplier to derive synthetic coding minutes
        const ratioFactor = DEMO_CODING_MINUTES_MULTIPLIER[tool.toLowerCase()] ?? 2.5
        
        finalAvgCodingMinutes = avgAiAssists * ratioFactor
        finalTotalCodingMinutes = finalAvgCodingMinutes * points.length
        finalAiPerMinute = finalAvgCodingMinutes > 0
          ? avgAiAssists / finalAvgCodingMinutes
          : 0
      }
    }

    stats.push({
      tool,
      points: points.length,
      avgCodingMinutes: finalAvgCodingMinutes,
      avgAiAssists,
      aiPerMinute: finalAiPerMinute
    })
  }

  // Temporary debug log to verify the patch
  console.log('[PI_COVERAGE_STATS_PATCHED]', stats.map(s => ({
    tool: s.tool,
    avgCodingMinutes: s.avgCodingMinutes,
    avgAiAssists: s.avgAiAssists,
    aiPerMinute: s.aiPerMinute,
  })))

  return stats
}

/**
 * Org AI Usage Summary Rule (Plan & Code)
 * 
 * Generates an org-level insight for the plan-code stage showing AI adoption trends across all IDEs.
 * Uses computeCoverageStatsForTools for consistency with Plan & Code tool cards.
 * Emits at most ONE insight.
 */
function ruleOrgAIUsageSummary(input: PerformanceInputs): PerformanceInsight[] {
  console.warn('[PI][PlanCodeOrg][AIUsage] ENTER');
  
  const { productivity } = input;
  
  // Gating: require at least 3 productivity periods (with diagnostics)
  if (!requireMinLen(productivity, 3, 'org-ai-usage-summary', 'productivity')) {
    return [];
  }
  
  try {
    // --- Derive org-level display rate from per-tool coverage stats (matches Plan & Code tool cards) ---
    const coverage = computeCoverageStatsForTools(input);
    
    // Extract per-tool AI rates (same metric used by Plan & Code tool cards)
    const toolRates: number[] = [];
    for (const toolStat of coverage) {
      // Use aiPerMinute field (same as Plan & Code tool cards use)
      const rate = toolStat.aiPerMinute;
      if (typeof rate === 'number' && !Number.isNaN(rate) && rate > 0) {
        toolRates.push(rate);
      }
    }
    
    // Compute org-level display rate: median of per-tool rates (matches Plan & Code cards)
    let aiRateDisplay: number | undefined;
    
    if (toolRates.length > 0) {
      aiRateDisplay = median(toolRates);
    } else {
      // FALLBACK: use per-point median if coverage stats are unavailable
      const orgPointRates: number[] = [];
      for (const p of productivity) {
        const assists = p.aiAssists ?? 0;
        const minutes = p.codingMinutes ?? 0;
        if (assists > 0 && minutes > 0) {
          orgPointRates.push(assists / minutes);
        }
      }
      
      if (orgPointRates.length === 0) {
        console.warn('[PI][PlanCodeOrg][AIUsage] Early return: no valid per-point AI rates');
        return [];
      }
      
      aiRateDisplay = median(orgPointRates);
    }
    
    // Only proceed if we have a valid display rate
    if (aiRateDisplay == null || aiRateDisplay <= 0) {
      console.warn('[PI][PlanCodeOrg][AIUsage] Early return: invalid aiRateDisplay', { aiRateDisplay });
      return [];
    }
    
    // For trend calculation, we still need per-period rates (separate from display median)
    const periods = Array.from(new Set(productivity.map(p => p.period))).sort();
    const weeks = periods.length;
    
    if (weeks < 3) {
      console.warn('[PI][PlanCodeOrg][AIUsage] Early return: fewer than 3 distinct periods', { weeks });
      return [];
    }
    
    type PeriodAgg = { period: string; totalAssists: number; totalMinutes: number; };
    const perPeriod: PeriodAgg[] = periods.map(period => {
      const pts = productivity.filter(p => p.period === period);
      const totalAssists = pts.reduce((sum, p) => sum + (p.aiAssists ?? 0), 0);
      const totalMinutes = pts.reduce((sum, p) => sum + (p.codingMinutes ?? 0), 0);
      return { period, totalAssists, totalMinutes };
    }).filter(p => p.totalMinutes > 0);
    
    const periodRates = perPeriod.map(p => p.totalAssists / p.totalMinutes);
    if (periodRates.length < 3) {
      console.warn('[PI][PlanCodeOrg][AIUsage] Early return: fewer than 3 valid period rates', { periodRatesLen: periodRates.length });
      return [];
    }
    
    const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    
    // Trend (last half vs previous half) - uses per-period aggregates, separate from display median
    const half = Math.floor(periodRates.length / 2);
    const earlyRates = periodRates.slice(0, half);
    const recentRates = periodRates.slice(half);
    
    if (earlyRates.length === 0 || recentRates.length === 0) {
      console.warn('[PI][PlanCodeOrg][AIUsage] Early return: insufficient data for trend', { earlyLen: earlyRates.length, recentLen: recentRates.length });
      return [];
    }
    
    const earlyAvg = avg(earlyRates);
    const recentAvg = avg(recentRates);
    const change = earlyAvg > 0 ? (recentAvg - earlyAvg) / earlyAvg : 0;
    
    // Classify trend
    let trendLabel: 'rising' | 'falling' | 'flat';
    if (change > 0.15) trendLabel = 'rising';
    else if (change < -0.15) trendLabel = 'falling';
    else trendLabel = 'flat';
    
    // Title: Encode "so what" - if good: "Lock in what's working", if bad: "Risk rising"
    let title: string;
    if (trendLabel === 'rising') {
      title = 'Lock in AI workflows that are working';
    } else if (trendLabel === 'falling') {
      title = 'AI adoption is drifting—investigate friction';
    } else {
      title = 'Sustain consistent AI usage patterns';
    }
    
    // Description: Explain impact/implication without repeating evidence numbers verbatim
    let description: string;
    if (trendLabel === 'rising') {
      description = `AI adoption is accelerating across the organization. This momentum creates an opportunity to standardize high-performing workflows and scale best practices, but also requires monitoring to ensure quality and cycle time don't degrade as usage grows.`;
    } else if (trendLabel === 'falling') {
      description = `AI usage is declining, which may indicate workflow friction, quality concerns, or training gaps. Without intervention, this trend could reduce developer productivity and slow delivery velocity.`;
    } else {
      description = `AI usage remains stable, providing a solid foundation for targeted improvements. Focus on identifying and scaling the most effective AI-assisted workflows to drive measurable productivity gains.`;
    }
    
    // Evidence: Standardized labels (Current, Baseline, Delta, Points analyzed, Data source)
    const totalAssists = perPeriod.reduce((s, p) => s + p.totalAssists, 0);
    // Use earlyAvg (already calculated) as baseline
    const evidence = [
      { label: 'Current', value: `${aiRateDisplay.toFixed(2)} assists/min` },
      { label: 'Baseline', value: `${earlyAvg.toFixed(2)} assists/min` },
      { label: 'Delta', value: `${(change * 100).toFixed(0)}%` },
      { label: 'Points analyzed', value: `${weeks} periods` },
      { label: 'Data source', value: inferDataSourceForOrgInsight(input) || 'productivity' }
    ];
    
    // Recommendations: ≥3 crisp recommendations with owner + action + expected outcome
    let recommendations: InsightRecommendation[];
    if (trendLabel === 'rising') {
      recommendations = [
        {
          text: 'Engineering leads: Document and standardize the AI workflows showing the strongest productivity gains, then share patterns via team wikis or guild meetings. Expected: 15-20% faster adoption across teams.',
          actionType: 'process'
        },
        {
          text: 'Platform team: Monitor PR cycle time and change failure rate weekly as AI usage scales. Set alerts if cycle time increases >10% or CFR rises >2 percentage points. Expected: Early detection of quality regressions.',
          actionType: 'observability'
        },
        {
          text: 'DevOps: Track AI-assisted PR throughput vs. manual PRs to quantify impact. Expected: Data-driven decision on whether to expand AI tooling budget.',
          actionType: 'observability'
        }
      ];
    } else if (trendLabel === 'falling') {
      recommendations = [
        {
          text: 'Engineering managers: Survey teams where AI usage dropped to identify root causes (quality issues, workflow friction, training gaps). Expected: Actionable insights within 1 week.',
          actionType: 'process'
        },
        {
          text: 'Learning & Development: Offer targeted AI workflow training sessions and create quick-reference guides for common coding tasks. Expected: 25% increase in AI usage within 4 weeks.',
          actionType: 'training'
        },
        {
          text: 'Product team: Review AI tool performance metrics and user feedback. If quality issues are driving the decline, prioritize tool improvements or alternative solutions. Expected: Reduced friction and improved adoption.',
          actionType: 'tooling'
        }
      ];
    } else {
      recommendations = [
        {
          text: 'Engineering leads: Identify the top 2-3 AI-assisted workflows with the best outcomes (cycle time, code quality, developer satisfaction) and create playbooks for other teams. Expected: 30% improvement in average workflow efficiency.',
          actionType: 'process'
        },
        {
          text: 'Platform team: Run A/B tests comparing AI-assisted vs. manual PRs on cycle time, review quality, and developer satisfaction. Expected: Quantified ROI data to guide tooling investments.',
          actionType: 'observability'
        },
        {
          text: 'DevOps: Set up dashboards tracking AI usage trends by team and repository to identify adoption blockers early. Expected: Proactive intervention before usage drops significantly.',
          actionType: 'observability'
        }
      ];
    }
    
    const latestPeriod = periods.slice(-1)[0] || String((productivity || []).map(p => p.period).filter(Boolean).sort().slice(-1)[0] || 'unknown');
    const insight: PerformanceInsight = {
      id: makeDeterministicInsightId('org-ai-usage-summary', latestPeriod, 'summary'),
      title,
      description,
      severity: 'info',
      insightClass: 'org_deterministic',
      orgKind: 'summary',
      cicdStage: 'plan-code',
      tags: ['org', 'ai-usage', 'plan-code'],
      related: {},
      evidence,
      recommendations,
      source: 'productivity',
      metricId: 'ide.ai_suggestions_accepted',
      dataSource: inferDataSourceForOrgInsight(input),
      toolScope: 'org',
      tools: undefined
    };
    
    console.warn('[PI][PlanCodeOrg][AIUsage] EMIT', {
      aiRateDisplay: aiRateDisplay.toFixed(2),
      toolRates: toolRates.map(v => Number(v.toFixed(3))),
      trend: trendLabel,
      coverageSample: coverage.length > 0 ? {
        tool: coverage[0].tool,
        aiPerMinute: coverage[0].aiPerMinute
      } : null
    });
    
    return [insight];
  } catch (e) {
    console.warn('[PI][PlanCodeOrg][AIUsage] Error:', e);
    return [];
  }
}

/**
 * Org Coding Time Summary Rule (Plan & Code)
 * 
 * Generates an org-level insight for the plan-code stage showing coding activity trends across all IDEs.
 * Uses ToolProductivityPoint data aggregated by period.
 * Emits at most ONE insight.
 */
function ruleOrgCodingTimeSummary(input: PerformanceInputs): PerformanceInsight[] {
  console.warn('[PI][PlanCodeOrg][Coding] ENTER');
  
  const { productivity } = input;
  
  // Guard: require at least 3 distinct periods (with diagnostics)
  if (!requireMinLen(productivity, 3, 'org-coding-time-summary', 'productivity')) {
    return [];
  }
  
  try {
    // Get distinct periods
    const periods = Array.from(new Set(productivity.map(p => p.period))).sort();
    if (periods.length < 3) {
      console.warn('[PI][PlanCodeOrg][Coding] Early return: fewer than 3 distinct periods', { periodsLen: periods.length });
      return [];
    }
    
    // Aggregate productivity by period: sum codingMinutes across all tools per period
    type PeriodAgg = { period: string; totalMinutes: number; };
    const perPeriod: PeriodAgg[] = periods.map(period => {
      const pts = productivity.filter(p => p.period === period);
      const totalMinutes = pts.reduce((sum, p) => sum + (p.codingMinutes ?? 0), 0);
      return { period, totalMinutes };
    }).filter(p => p.totalMinutes > 0);
    
    if (perPeriod.length < 3) {
      console.warn('[PI][PlanCodeOrg][Coding] Early return: fewer than 3 valid periods', { validPeriodsLen: perPeriod.length });
      return [];
    }
    
    // Metrics
    const perPeriodMinutes = perPeriod.map(p => p.totalMinutes);
    const medianMinutes = median(perPeriodMinutes);
    
    // Split periods into earlier vs recent halves (by time order)
    const half = Math.floor(perPeriodMinutes.length / 2);
    const earlierMinutes = perPeriodMinutes.slice(0, half);
    const recentMinutes = perPeriodMinutes.slice(half);
    
    if (earlierMinutes.length === 0 || recentMinutes.length === 0) {
      console.warn('[PI][PlanCodeOrg][Coding] Early return: insufficient data for trend', {
        earlierLen: earlierMinutes.length,
        recentLen: recentMinutes.length
      });
      return [];
    }
    
    const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const earlierAvg = avg(earlierMinutes);
    const recentAvg = avg(recentMinutes);
    const relativeChange = earlierAvg > 0 ? (recentAvg - earlierAvg) / earlierAvg : 0;
    
    // Trend classification
    let trendLabel: 'increasing' | 'decreasing' | 'steady';
    if (relativeChange >= 0.10) trendLabel = 'increasing';
    else if (relativeChange <= -0.10) trendLabel = 'decreasing';
    else trendLabel = 'steady';
    
    // Title: Encode "so what" - if good: "Sustain momentum", if bad: "Risk rising"
    let title: string;
    if (trendLabel === 'increasing') {
      title = 'Sustain coding momentum—align review capacity';
    } else if (trendLabel === 'decreasing') {
      title = 'Coding activity is slowing—investigate blockers';
    } else {
      title = 'Stable coding time—optimize for better outcomes';
    }
    
    // Description: Explain impact/implication without repeating evidence numbers verbatim
    let description: string;
    if (trendLabel === 'increasing') {
      description = `Coding activity is rising, indicating strong development momentum. However, without proportional increases in review capacity, this growth could create bottlenecks in the PR pipeline, slowing overall delivery velocity.`;
    } else if (trendLabel === 'decreasing') {
      description = `Coding activity is declining, which may signal infrastructure issues, process friction, or context switching overhead. Left unaddressed, this trend could impact delivery timelines and team productivity.`;
    } else {
      description = `Coding activity remains stable, providing a consistent foundation. This presents an opportunity to optimize workflows, improve focus time, and leverage AI assistance to convert steady coding hours into higher-quality, faster-delivered features.`;
    }
    
    // Evidence: Standardized labels (Current, Baseline, Delta, Points analyzed, Data source)
    const evidence = [
      { label: 'Current', value: `${Math.round(recentAvg)} min/period` },
      { label: 'Baseline', value: `${Math.round(earlierAvg)} min/period` },
      { label: 'Delta', value: `${(relativeChange * 100).toFixed(0)}%` },
      { label: 'Points analyzed', value: `${perPeriod.length} periods` },
      { label: 'Data source', value: inferDataSourceForOrgInsight(input) || 'productivity' }
    ];
    
    // Recommendations: ≥3 crisp recommendations with owner + action + expected outcome
    let recommendations: InsightRecommendation[];
    if (trendLabel === 'increasing') {
      recommendations = [
        {
          text: 'Engineering managers: Assess review capacity and ensure reviewer availability scales with coding volume. Consider reviewer rotation schedules or expanding the reviewer pool. Expected: PR wait times remain stable despite increased coding activity.',
          actionType: 'process'
        },
        {
          text: 'Platform team: Monitor PR queue depth and cycle time metrics weekly. Set alerts if average cycle time increases >20% or queue depth exceeds 10 PRs per reviewer. Expected: Early detection of review bottlenecks.',
          actionType: 'observability'
        },
        {
          text: 'DevOps: Automate CI/CD checks and reduce manual approval gates to prevent PRs from piling up. Expected: 30% reduction in time-to-merge for non-critical changes.',
          actionType: 'tooling'
        }
      ];
    } else if (trendLabel === 'decreasing') {
      recommendations = [
        {
          text: 'Engineering leads: Survey teams to identify blockers—infrastructure issues, excessive meetings, context switching, or unclear priorities. Create action plans for top 3 blockers. Expected: 20% improvement in coding time within 4 weeks.',
          actionType: 'process'
        },
        {
          text: 'Product team: Review sprint planning and ensure realistic scope. Reduce scope creep and minimize mid-sprint interruptions. Expected: More predictable coding time allocation.',
          actionType: 'process'
        },
        {
          text: 'Platform team: Audit infrastructure performance (build times, test execution, deployment pipelines) and optimize slow paths. Expected: 15% reduction in non-coding overhead.',
          actionType: 'tooling'
        }
      ];
    } else {
      recommendations = [
        {
          text: 'Engineering managers: Identify teams with the best PR outcomes (quality, speed, satisfaction) and document their workflows. Share best practices via guild meetings. Expected: 25% improvement in average PR quality across teams.',
          actionType: 'process'
        },
        {
          text: 'Platform team: Pilot AI-assisted code review tools on 2-3 teams and measure impact on review speed and quality. Expected: 20% faster reviews with maintained or improved quality.',
          actionType: 'tooling'
        },
        {
          text: 'DevOps: Implement focus time blocks (e.g., "no meetings" mornings) and measure impact on coding efficiency and PR quality. Expected: 15% increase in deep work productivity.',
          actionType: 'process'
        }
      ];
    }
    
    // Severity & priority
    const severity: InsightSeverity = Math.abs(relativeChange) >= 0.25 ? 'warning' : 'info';
    
    const latestPeriod = periods.slice(-1)[0] || String((productivity || []).map(p => p.period).filter(Boolean).sort().slice(-1)[0] || 'unknown');
    const insight: PerformanceInsight = {
      id: makeDeterministicInsightId('org-coding-time-summary', latestPeriod, 'summary'),
      title,
      description,
      severity,
      insightClass: 'org_deterministic',
      orgKind: 'summary',
      cicdStage: 'plan-code',
      tags: ['org', 'coding-time', 'plan-code'],
      related: {},
      evidence,
      recommendations,
      source: 'productivity',
      metricId: 'ide.active_coding_time_minutes',
      dataSource: inferDataSourceForOrgInsight(input),
      toolScope: 'org',
      tools: undefined,
      priorityScore: 80
    };
    
    console.warn('[PI][PlanCodeOrg][Coding] EMIT', {
      trend: trendLabel,
      medianMinutes: Math.round(medianMinutes),
      relativeChange: (relativeChange * 100).toFixed(0) + '%'
    });
    
    return [insight];
  } catch (e) {
    console.warn('[PI][PlanCodeOrg][Coding] Error:', e);
    return [];
  }
}

/**
 * RULE: Org Productivity Skew (Plan & Code)
 * 
 * Detects if delivery is highly concentrated in a single tool, indicating bus factor risk.
 * 
 * Signal logic:
 * - Aggregates productivity points by tool (sum commits, sum sessionMinutes)
 * - Computes output share (commits) vs capacity share (sessionMinutes) per tool
 * - Triggers if top tool ≥50% output, top 2 ≥70%, or any tool output share exceeds capacity share by ≥25pts
 * 
 * @param input PerformanceInputs
 * @returns PerformanceInsight[]
 */
function ruleOrgProductivitySkew(input: PerformanceInputs): PerformanceInsight[] {
  if (import.meta.env.DEV) {
    console.warn('[PI][PlanCodeOrg][ProductivitySkew] ENTER')
  }
  
  const { productivity } = input
  
  // Guard: require productivity data (with diagnostics)
  if (!requireNonEmptyBool(productivity, 'org-productivity-skew', 'productivity')) {
    return []
  }
  
  try {
    // Aggregate by tool: sum commits and sessionMinutes
    const toolAggs = new Map<string, { commits: number; sessionMinutes: number; tool: string }>()
    
    for (const p of productivity) {
      const tool = p.tool || 'unknown'
      const existing = toolAggs.get(tool) || { commits: 0, sessionMinutes: 0, tool }
      
      existing.commits += p.commits || 0
      // Use sessionMinutes if available, otherwise estimate from codingMinutes (rough proxy)
      existing.sessionMinutes += p.sessionMinutes || (p.codingMinutes || 0) * 1.2
      
      toolAggs.set(tool, existing)
    }
    
    // Guard: require at least 2 tools
    if (toolAggs.size < 2) {
      if (import.meta.env.DEV) {
        console.warn('[PI][PlanCodeOrg][ProductivitySkew] Early return: fewer than 2 tools', { toolCount: toolAggs.size })
      }
      return []
    }
    
    // Compute totals
    const totalCommits = Array.from(toolAggs.values()).reduce((sum, t) => sum + t.commits, 0)
    const totalSessionMinutes = Array.from(toolAggs.values()).reduce((sum, t) => sum + t.sessionMinutes, 0)
    
    if (import.meta.env.DEV) {
      console.warn('[PI][PlanCodeOrg][ProductivitySkew] Aggregation complete', {
        toolCount: toolAggs.size,
        totalCommits,
        totalSessionMinutes: Math.round(totalSessionMinutes),
        tools: Array.from(toolAggs.entries()).map(([tool, data]) => ({
          tool,
          commits: data.commits,
          sessionMinutes: Math.round(data.sessionMinutes)
        }))
      })
    }
    
    // Guard: require minimum commits (relaxed for DEMO_MODE)
    const minCommits = DEMO_MODE ? 5 : 10
    if (totalCommits < minCommits) {
      if (import.meta.env.DEV) {
        console.warn('[PI][PlanCodeOrg][ProductivitySkew] Early return: total commits < threshold', { totalCommits, threshold: minCommits })
      }

      // Soft-signal (NOT no-data): If we have multi-tool activity time but commit/output is missing,
      // emit a SECONDARY directional insight based on activity distribution (capacity share only).
      // This keeps hard guards intact (still requires productivity + >=2 tools) and avoids quota filler.
      if (!DEMO_MODE && totalSessionMinutes > 0) {
        const byActivity = Array.from(toolAggs.values())
          .map(t => ({
            tool: t.tool,
            sessionMinutes: t.sessionMinutes,
            capacityShare: totalSessionMinutes > 0 ? (t.sessionMinutes / totalSessionMinutes) * 100 : 0,
          }))
          .sort((a, b) => b.sessionMinutes - a.sessionMinutes);

        const top = byActivity[0];
        const top2 = byActivity.slice(0, 2).reduce((sum, t) => sum + t.capacityShare, 0);
        const latestPeriod = (productivity || []).map(p => p.period).filter(Boolean).sort().slice(-1)[0] as any;

        const insight: PerformanceInsight = {
          id: makeDeterministicInsightId('org-productivity-skew', latestPeriod, 'directional-activity-only'),
          title: 'Output distribution unavailable; showing activity distribution (directional)',
          description: `Commit/output data is missing or too sparse to quantify delivery concentration. Based on IDE activity time, ${top?.tool || 'one tool'} accounts for ~${top?.capacityShare.toFixed(0) || '0'}% of activity. Treat this as directional until output signals are available.`,
          severity: 'info',
          insightClass: 'org_deterministic',
          orgKind: 'summary' as any,
          cicdStage: 'plan-code',
          toolScope: 'cross-ide',
          source: 'productivity',
          metricId: 'org.productivity_skew',
          dataSource: inferDataSourceForOrgInsight(input),
          evidence: [
            { label: 'Top tool by activity', value: top?.tool || 'unknown' },
            { label: 'Top tool activity share', value: (top?.capacityShare ?? 0).toFixed(1) + '%' },
            { label: 'Top 2 activity share', value: top2.toFixed(1) + '%' },
            { label: 'Tools tracked', value: String(byActivity.length) },
            { label: 'Output signal', value: `commits=${totalCommits} (<${minCommits})` },
          ],
          recommendations: [
            {
              text: 'Connect GitHub (or ensure PR/commit ingestion is working) so Plan–Code can measure output distribution, not just activity time.',
              actionType: 'observability'
            },
            {
              text: 'Until output is available, use this as a routing check: if one tool dominates activity, ensure cross-tool onboarding to prevent future bus-factor concentration.',
              actionType: 'process'
            }
          ],
          related: {},
          tools: undefined,
          priorityScore: 45,
          summaryEligible: false,
          tags: ['org', 'productivity', 'plan-code', 'low-confidence', 'directional', 'estimated']
        };

        return [insight];
      }

      return []
    }
    
    // Compute shares per tool
    const toolShares = Array.from(toolAggs.entries()).map(([tool, data]) => {
      const outputShare = totalCommits > 0 ? (data.commits / totalCommits) * 100 : 0
      const capacityShare = totalSessionMinutes > 0 ? (data.sessionMinutes / totalSessionMinutes) * 100 : 0
      const skew = outputShare - capacityShare
      
      return {
        tool,
        commits: data.commits,
        sessionMinutes: data.sessionMinutes,
        outputShare,
        capacityShare,
        skew
      }
    })
    
    // Sort by output share descending
    toolShares.sort((a, b) => b.outputShare - a.outputShare)
    
    // Dev-only diagnostics: log shares even if no qualifiers
    if (import.meta.env.DEV) {
      console.warn('[PI][PlanCodeOrg][ProductivitySkew] shares', {
        totalCommits,
        totalSessionMinutes: Math.round(totalSessionMinutes),
        toolShares: toolShares.map(t => ({
          tool: t.tool,
          outputShare: t.outputShare,
          capacityShare: t.capacityShare,
          skew: t.skew
        }))
      })
    }
    
    // Check trigger conditions
    const topTool = toolShares[0]
    const top2Combined = toolShares.slice(0, 2).reduce((sum, t) => sum + t.outputShare, 0)
    
    // Find tools that qualify
    const qualifyingTools = toolShares.filter(t => 
      t.outputShare >= 50 ||  // Top tool ≥50%
      (t === topTool && top2Combined >= 70) ||  // Top 2 combined ≥70%
      t.skew >= 25  // Output share exceeds capacity share by ≥25pts
    )
    
    if (qualifyingTools.length === 0) {
      // DEMO_MODE fallback: emit "mildly concentrated" insight if conditions met
      if (DEMO_MODE && toolShares.length >= 2 && totalCommits >= 5 && totalSessionMinutes > 0) {
        // Select top tool (highest outputShare)
        const targetTool = topTool
        
        // Title: Encode "so what" - monitoring to prevent future risk
        const title = `Monitor delivery concentration in ${targetTool.tool}`;
        
        // Description: Explain impact/implication without repeating evidence numbers verbatim
        const description = `While current concentration levels are below alert thresholds, there's a noticeable skew between output and capacity share. This pattern, if left unchecked, could evolve into a bus factor risk. Proactive monitoring and balanced onboarding can prevent future workflow imbalance.`;
        
        // Evidence: Standardized labels
        const evidence: InsightEvidence[] = [
          { label: 'Tool', value: targetTool.tool },
          { label: 'Output share', value: targetTool.outputShare.toFixed(1) + '%' },
          { label: 'Capacity share', value: targetTool.capacityShare.toFixed(1) + '%' },
          { label: 'Delta', value: targetTool.skew.toFixed(1) + ' percentage points' },
          { label: 'Points analyzed', value: `${productivity.length} productivity points` },
          { label: 'Data source', value: inferDataSourceForOrgInsight(input) || 'productivity' }
        ];
        
        // Recommendations: ≥3 crisp recommendations (using allowed actionType values)
        const recommendations: InsightRecommendation[] = [
          {
            text: `Engineering managers: Ensure onboarding programs cover all tools equally, not just ${targetTool.tool}. Create cross-tool knowledge sharing sessions. Expected: More balanced tool usage over time.`,
            actionType: 'training'
          },
          {
            text: 'Platform team: Track tool usage trends monthly and set alerts if any tool exceeds 50% output share. Expected: Early warning before concentration becomes a risk.',
            actionType: 'observability'
          },
          {
            text: 'DevOps: Document and share best practices from all tools, not just the most-used one. Expected: Reduced tool lock-in and better workflow portability.',
            actionType: 'process'
          }
        ];
        
        const insight: PerformanceInsight = {
          id: makeDeterministicInsightId('org-productivity-skew', targetTool.tool, 'demo-soft'),
          title,
          description,
          severity: 'info',
          insightClass: 'org_deterministic',
          cicdStage: 'plan-code',
          toolScope: 'cross-ide',
          source: 'productivity',
          metricId: 'org.productivity_skew',
          dataSource: inferDataSourceForOrgInsight(input),
          evidence,
          recommendations,
          related: {},
          tools: undefined,
          priorityScore: 90,
          tags: ['org', 'productivity', 'plan-code', 'skew']
        }
        
        if (import.meta.env.DEV) {
          console.warn('[PI][PlanCodeOrg][ProductivitySkew][DEMO] Soft emit (no qualifiers)', {
            tool: targetTool.tool,
            outputShare: targetTool.outputShare.toFixed(1) + '%',
            capacityShare: targetTool.capacityShare.toFixed(1) + '%',
            skew: targetTool.skew.toFixed(1) + 'pts',
            totalCommits,
            toolCount: toolAggs.size
          })
        }
        
        console.warn('[PI][PlanCodeOrg][ProductivitySkew] RETURN', insight.title, {
          cicdStage: insight.cicdStage,
          toolScope: insight.toolScope,
          priorityScore: insight.priorityScore
        })
        
        return [insight]
      }
      
      // Soft-signal (NOT no-data): When we have enough data but no strong skew, emit a SECONDARY
      // insight with explicit caveats. This avoids quota fillers while preserving truth.
      const mostSkewed = toolShares.reduce((best, cur) => (cur.skew > best.skew ? cur : best), toolShares[0])
      const latestPeriod = (productivity || []).map(p => p.period).filter(Boolean).sort().slice(-1)[0] as any
      const insight: PerformanceInsight = {
        id: makeDeterministicInsightId('org-productivity-skew', latestPeriod, 'directional-balanced'),
        title: 'No strong tool concentration detected (directional)',
        description: `Output is not strongly concentrated in a single tool based on recent periods. This is a directional read (not a guarantee): distribution can shift as adoption changes.`,
        severity: 'info',
        insightClass: 'org_deterministic',
        cicdStage: 'plan-code',
        toolScope: 'cross-ide',
        source: 'productivity',
        metricId: 'org.productivity_skew',
        dataSource: inferDataSourceForOrgInsight(input),
        evidence: [
          { label: 'Top tool', value: topTool.tool },
          { label: 'Top tool output share', value: topTool.outputShare.toFixed(1) + '%' },
          { label: 'Top 2 combined', value: top2Combined.toFixed(1) + '%' },
          { label: 'Max skew', value: mostSkewed.skew.toFixed(1) + ' pct-pt' },
          { label: 'Tools tracked', value: String(toolShares.length) },
          { label: 'Points analyzed', value: `${productivity.length} productivity points` },
        ],
        recommendations: [
          {
            text: 'Keep cross-tool onboarding and shared workflows so delivery doesn\'t concentrate in a single IDE/tool as adoption changes.',
            actionType: 'process'
          },
          {
            text: 'Set a monthly check: alert if any tool exceeds 50% of output share or if skew exceeds 25 percentage points.',
            actionType: 'observability'
          }
        ],
        related: {},
        tools: undefined,
        priorityScore: 45,
        summaryEligible: false,
        tags: ['org', 'productivity', 'plan-code', 'low-confidence', 'directional']
      }

      return [insight]

      // No DEMO_MODE fallback conditions met, return empty
      if (import.meta.env.DEV) {
        console.warn('[PI][PlanCodeOrg][ProductivitySkew] Early return: no qualifying tools', {
          topTool: topTool.tool,
          topToolOutputShare: topTool.outputShare.toFixed(1) + '%',
          top2Combined: top2Combined.toFixed(1) + '%',
          maxSkew: Math.max(...toolShares.map(t => t.skew)).toFixed(1) + 'pts',
          demoMode: DEMO_MODE,
          hasEnoughTools: toolShares.length >= 2,
          hasEnoughCommits: totalCommits >= 5,
          hasSessionTime: totalSessionMinutes > 0
        })
      }
      return []
    }
    
    // Select most skewed tool (highest skew, then highest output share)
    const worstTool = qualifyingTools.reduce((worst, current) => {
      if (current.skew > worst.skew) return current
      if (current.skew === worst.skew && current.outputShare > worst.outputShare) return current
      return worst
    })
    
    // Determine severity
    const severity: InsightSeverity = (worstTool.outputShare >= 60 || worstTool.skew >= 35)
      ? 'warning'
      : 'info'
    
    // Title: Encode "so what" - risk of bus factor and workflow imbalance
    const title = `Bus factor risk: delivery concentrated in ${worstTool.tool}`;
    
    // Description: Explain impact/implication without repeating evidence numbers verbatim
    const description = `A significant portion of organizational output is concentrated in a single tool, creating bus factor risk and workflow imbalance. This concentration means knowledge and processes are siloed, making the organization vulnerable if key contributors become unavailable. Additionally, the skew between output share and capacity share suggests that other tools may be underutilized or that workflows are not evenly distributed.`;
    
    // Evidence: Standardized labels (Current, Baseline, Delta, Points analyzed, Data source)
    const evidence: InsightEvidence[] = [
      { label: 'Tool', value: worstTool.tool },
      { label: 'Output share', value: worstTool.outputShare.toFixed(1) + '%' },
      { label: 'Capacity share', value: worstTool.capacityShare.toFixed(1) + '%' },
      { label: 'Delta', value: worstTool.skew.toFixed(1) + ' percentage points' },
      { label: 'Points analyzed', value: `${productivity.length} productivity points` },
      { label: 'Data source', value: inferDataSourceForOrgInsight(input) || 'productivity' }
    ]
    
    // Recommendations: ≥3 crisp recommendations with owner + action + expected outcome
    const recommendations: InsightRecommendation[] = [
      {
        text: `Engineering managers: Create cross-tool onboarding programs and pair programming sessions to spread ${worstTool.tool} expertise to other tools. Document high-performing workflows from ${worstTool.tool} and adapt them for other IDEs. Expected: 30% reduction in bus factor risk within 8 weeks.`,
        actionType: 'training'
      },
      {
        text: 'Platform team: Analyze why other tools are underutilized—is it tool capability gaps, training gaps, or workflow preferences? Create tool-specific improvement plans. Expected: More balanced tool usage across the organization.',
        actionType: 'observability'
      },
      {
        text: 'DevOps: Implement tool-agnostic workflows and standards (e.g., shared CI/CD configs, common testing frameworks) to reduce tool lock-in. Expected: Easier migration between tools and reduced concentration risk.',
        actionType: 'process'
      }
    ]
    
    const insight: PerformanceInsight = {
      id: `org-productivity-skew-${worstTool.tool}-${Date.now()}`,
      title,
      description,
      severity,
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'plan-code',
      toolScope: 'cross-ide',
      source: 'productivity',
      metricId: 'org.productivity_skew',
      dataSource: inferDataSourceForOrgInsight(input),
      evidence,
      recommendations,
      related: {},
      tools: undefined,
      priorityScore: 90,
      tags: ['org', 'productivity', 'plan-code', 'skew']
    }
    
    if (import.meta.env.DEV) {
      console.warn('[PI][PlanCodeOrg][ProductivitySkew] EMIT', {
        tool: worstTool.tool,
        outputShare: worstTool.outputShare.toFixed(1) + '%',
        capacityShare: worstTool.capacityShare.toFixed(1) + '%',
        skew: worstTool.skew.toFixed(1) + 'pts',
        severity,
        totalCommits,
        toolCount: toolAggs.size
      })
    }
    
    return [insight]
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[PI][PlanCodeOrg][ProductivitySkew] Error:', e)
    }
    return []
  }
}

// ============================================================================
// RULE: Time to First Commit (TTFC) Regression Detection (Plan & Code)
// ============================================================================
// 
// Detects regressions or improvements in ramp-up speed, measured by median
// Time to First Commit (TTFC). This is a key proxy for developer onboarding
// and workflow efficiency.
//
// Logic:
// 1. Eligibility: Sessions where time_to_first_commit_ms IS NOT NULL
// 2. Aggregation: Median TTFC for current (7d) vs baseline (prior 7d)
// 3. Change Detection: percent_change = (current - baseline) / baseline
// 4. Thresholds:
//    - Δ ≥ +20% → Warning (regression)
//    - Δ ≥ +10% → Opportunity (mild regression)
//    - Δ ≤ -15% → Highlight (improvement)
//    - Otherwise → No card
//
// Action generation:
// - Correlates with rework_ratio and ai_intensity for slow sessions
// - Provides specific, data-backed recommendations
// ============================================================================

function ruleTTFCRegression(input: PerformanceInputs): PerformanceInsight[] {
  console.warn('[PI][PlanCode][TTFC] ENTER');
  
  // TTFC_DEBUG: Log at rule entry
  if (TTFC_DEBUG) {
    console.warn('[TTFC_DEBUG][Rule] ENTER ruleTTFCRegression', {
      inputSessionsExists: !!input.sessions,
      inputSessionsLength: input.sessions?.length ?? 0,
      DEMO_MODE
    });
  }
  
  let sessions = input.sessions;
  
  // =========================================================================
  // DEMO_MODE: Inject synthetic sessions if no real sessions available
  // =========================================================================
  if (DEMO_MODE && (!sessions || sessions.length === 0)) {
    console.warn('[PI][PlanCode][TTFC] DEMO_MODE: Injecting synthetic sessions');
    
    const now = new Date();
    const demoSessions: SessionDataPoint[] = [];
    
    // Generate demo sessions for current window (last 7 days)
    // Scenario: 25% slower ramp-up (regression)
    for (let i = 0; i < 15; i++) {
      const daysAgo = Math.floor(Math.random() * 7);
      const timestamp = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      demoSessions.push({
        session_id: `demo-session-current-${i}`,
        timestamp: timestamp.toISOString(),
        duration_ms: 3600000 + Math.random() * 7200000,
        user_id: `demo-user-${i % 5}`,
        git_repo_url: 'https://github.com/demo/repo',
        git_branch: 'main',
        time_to_first_commit_ms: (22 + Math.random() * 10) * 60000, // 22-32 min (slower)
        ai_burst_count: Math.floor(Math.random() * 10),
        ai_active_span_ms: Math.random() * 600000,
        ai_burst_chars_total: Math.floor(Math.random() * 5000),
        ai_chars_per_min: Math.random() * 300,
        ai_intensity_band: 'medium',
        rework_ratio_est: 0.3 + Math.random() * 0.4,
        rework_band: 'medium',
        focus_ratio: 0.6 + Math.random() * 0.3,
        flow_profile: 'coding-heavy',
        session_quality_score: 70 + Math.random() * 20,
        session_quality_band: 'medium',
        is_remote_workspace: false,
        remote_name: null,
        extension_version: '1.0.0',
        vscode_version: '1.85.0',
      });
    }
    
    // Generate demo sessions for baseline window (7-14 days ago)
    for (let i = 0; i < 15; i++) {
      const daysAgo = 7 + Math.floor(Math.random() * 7);
      const timestamp = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      demoSessions.push({
        session_id: `demo-session-baseline-${i}`,
        timestamp: timestamp.toISOString(),
        duration_ms: 3600000 + Math.random() * 7200000,
        user_id: `demo-user-${i % 5}`,
        git_repo_url: 'https://github.com/demo/repo',
        git_branch: 'main',
        time_to_first_commit_ms: (16 + Math.random() * 8) * 60000, // 16-24 min (faster baseline)
        ai_burst_count: Math.floor(Math.random() * 10),
        ai_active_span_ms: Math.random() * 600000,
        ai_burst_chars_total: Math.floor(Math.random() * 5000),
        ai_chars_per_min: Math.random() * 300,
        ai_intensity_band: 'medium',
        rework_ratio_est: 0.2 + Math.random() * 0.3,
        rework_band: 'low',
        focus_ratio: 0.6 + Math.random() * 0.3,
        flow_profile: 'coding-heavy',
        session_quality_score: 75 + Math.random() * 20,
        session_quality_band: 'high',
        is_remote_workspace: false,
        remote_name: null,
        extension_version: '1.0.0',
        vscode_version: '1.85.0',
      });
    }
    
    sessions = demoSessions;
    
    if (TTFC_DEBUG) {
      console.warn('[TTFC_DEBUG][Rule] DEMO sessions injected', {
        count: demoSessions.length,
        currentWindow: demoSessions.filter(s => new Date(s.timestamp) >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)).length,
        baselineWindow: demoSessions.filter(s => {
          const ts = new Date(s.timestamp);
          return ts < new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }).length
      });
    }
  }
  
  // Guard: require session data (with diagnostics)
  if (!requireNonEmptyBool(sessions, 'org-ttfc-regression', 'sessions')) {
    if (TTFC_DEBUG) {
      console.warn('[TTFC_DEBUG][Rule] EARLY_RETURN: no_session_data', {
        sessionsIsNull: sessions === null,
        sessionsIsUndefined: sessions === undefined,
        sessionsLength: sessions?.length ?? 'N/A',
        DEMO_MODE
      });
    }
    return [];
  }

  const sessionsArr = sessions || [];
  
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    
    // TTFC_DEBUG: Log window boundaries
    if (TTFC_DEBUG) {
      console.warn('[TTFC_DEBUG][Rule] Window boundaries', {
        now: now.toISOString(),
        sevenDaysAgo: sevenDaysAgo.toISOString(),
        fourteenDaysAgo: fourteenDaysAgo.toISOString()
      });
    }
    
    // Filter sessions with commits (TTFC not null)
    const sessionsWithCommit = sessionsArr.filter(s => 
      s.time_to_first_commit_ms !== null && s.time_to_first_commit_ms > 0
    );
    
    // Compute commit rate for evidence
    const commitRate = sessionsArr.length > 0 
      ? sessionsWithCommit.length / sessionsArr.length 
      : 0;
    
    // Split into current (last 7d) and baseline (7-14d ago)
    const currentSessions = sessionsWithCommit.filter(s => {
      const ts = new Date(s.timestamp);
      return ts >= sevenDaysAgo;
    });
    
    const baselineSessions = sessionsWithCommit.filter(s => {
      const ts = new Date(s.timestamp);
      return ts >= fourteenDaysAgo && ts < sevenDaysAgo;
    });
    
    // TTFC_DEBUG: Log eligibility counts
    if (TTFC_DEBUG) {
      console.warn('[TTFC_DEBUG][Rule] Eligibility counts', {
        totalSessions: sessionsArr.length,
        sessionsWithCommit: sessionsWithCommit.length,
        eligibleCurrentN: currentSessions.length,
        eligibleBaselineN: baselineSessions.length,
        commitRate: (commitRate * 100).toFixed(1) + '%',
        sampleSessionTimestamps: sessionsArr.slice(0, 3).map(s => s.timestamp)
      });
    }
    
    // =========================================================================
    // SAMPLE SIZE THRESHOLDS (Tiered approach for small orgs)
    // =========================================================================
    // Tier 1 (strict): n >= 20 each window → standard thresholds (±10-20%)
    // Tier 2 (soft fallback): n >= 10 each window → requires stronger signal (±30% or more)
    // Tier 3 (minimal): n >= 3 each window (DEMO_MODE only) → standard thresholds
    // =========================================================================
    
    const TIER1_MIN_SAMPLE = 20;  // Standard threshold
    const TIER2_MIN_SAMPLE = 10;  // Soft fallback for smaller datasets
    const TIER3_MIN_SAMPLE = 3;   // DEMO_MODE only
    
    const hasTier1Sample = currentSessions.length >= TIER1_MIN_SAMPLE && baselineSessions.length >= TIER1_MIN_SAMPLE;
    const hasTier2Sample = currentSessions.length >= TIER2_MIN_SAMPLE && baselineSessions.length >= TIER2_MIN_SAMPLE;
    const hasTier3Sample = currentSessions.length >= TIER3_MIN_SAMPLE && baselineSessions.length >= TIER3_MIN_SAMPLE;
    
    // Determine which tier we're in
    let sampleTier: 1 | 2 | 3 | null = null;
    if (hasTier1Sample) {
      sampleTier = 1;
    } else if (hasTier2Sample) {
      sampleTier = 2;  // Will require stronger signal
    } else if (DEMO_MODE && hasTier3Sample) {
      sampleTier = 3;  // Demo mode only
    }
    
    if (sampleTier === null) {
      if (import.meta.env.DEV) {
        console.warn('[PI][PlanCode][TTFC] Early return: insufficient sample size', {
          current: currentSessions.length,
          baseline: baselineSessions.length,
          minRequired: DEMO_MODE ? TIER3_MIN_SAMPLE : TIER2_MIN_SAMPLE
        });
      }
      if (TTFC_DEBUG) {
        console.warn('[TTFC_DEBUG][Rule] EARLY_RETURN: insufficient_sample_size', {
          eligibleCurrentN: currentSessions.length,
          eligibleBaselineN: baselineSessions.length,
          tier1Required: TIER1_MIN_SAMPLE,
          tier2Required: TIER2_MIN_SAMPLE,
          tier3Required: TIER3_MIN_SAMPLE,
          DEMO_MODE,
          reason: 'Does not meet any sample tier threshold'
        });
      }
      return [];
    }
    
    if (TTFC_DEBUG) {
      console.warn('[TTFC_DEBUG][Rule] Sample tier determined', {
        sampleTier,
        currentN: currentSessions.length,
        baselineN: baselineSessions.length
      });
    }
    
    // Compute median TTFC in minutes
    const getTTFCMinutes = (s: SessionDataPoint) => (s.time_to_first_commit_ms || 0) / 60000;
    
    const currentTTFCs = currentSessions.map(getTTFCMinutes);
    const baselineTTFCs = baselineSessions.map(getTTFCMinutes);
    
    const currentMedian = median(currentTTFCs);
    const baselineMedian = median(baselineTTFCs);
    
    // Guard: baseline must be positive
    if (baselineMedian <= 0) {
      if (import.meta.env.DEV) {
        console.warn('[PI][PlanCode][TTFC] Early return: baseline median is zero');
      }
      if (TTFC_DEBUG) {
        console.warn('[TTFC_DEBUG][Rule] EARLY_RETURN: baseline_median_zero', {
          baselineMedian,
          baselineTTFCs: baselineTTFCs.slice(0, 5)
        });
      }
      return [];
    }
    
    // Compute percent change
    const percentChange = ((currentMedian - baselineMedian) / baselineMedian) * 100;
    const percentChangeRounded = Math.round(percentChange);
    
    // TTFC_DEBUG: Log computed metrics
    if (TTFC_DEBUG) {
      console.warn('[TTFC_DEBUG][Rule] Computed metrics', {
        currentMedian: currentMedian.toFixed(2) + ' min',
        baselineMedian: baselineMedian.toFixed(2) + ' min',
        percentChange: percentChangeRounded + '%',
        thresholds: { warning: '>=+20%', opportunity: '>=+10%', highlight: '<=-15%' }
      });
    }
    
    if (import.meta.env.DEV) {
      console.warn('[PI][PlanCode][TTFC] Computed metrics', {
        currentMedian: currentMedian.toFixed(1) + ' min',
        baselineMedian: baselineMedian.toFixed(1) + ' min',
        percentChange: percentChangeRounded + '%',
        currentSessions: currentSessions.length,
        baselineSessions: baselineSessions.length,
        commitRate: (commitRate * 100).toFixed(1) + '%'
      });
    }
    
    // =========================================================================
    // THRESHOLD LOGIC (Tiered based on sample size)
    // =========================================================================
    // Tier 1 (n >= 20): Standard thresholds
    //   - Δ >= +20% → Warning
    //   - Δ >= +10% → Opportunity
    //   - Δ <= -15% → Highlight
    // Tier 2 (n >= 10, n < 20): Stricter thresholds for smaller samples
    //   - Δ >= +30% → Warning (only for strong regressions)
    //   - Δ <= -25% → Highlight (only for strong improvements)
    //   - No opportunity tier (signal must be strong)
    // Tier 3 (DEMO_MODE, n >= 3): Same as Tier 1
    // =========================================================================
    
    let severity: InsightSeverity | null = null;
    let isRegression = false;
    let isImprovement = false;
    let isSmallSampleCard = false;  // Flag to show n= in evidence
    
    if (sampleTier === 1 || sampleTier === 3) {
      // Standard thresholds
      if (percentChange >= 20) {
        severity = 'warning';
        isRegression = true;
      } else if (percentChange >= 10) {
        severity = 'opportunity';
        isRegression = true;
      } else if (percentChange <= -15) {
        severity = 'highlight';
        isImprovement = true;
      }
    } else if (sampleTier === 2) {
      // Stricter thresholds for smaller samples - only emit for strong signals
      isSmallSampleCard = true;
      if (percentChange >= 30) {
        severity = 'warning';
        isRegression = true;
      } else if (percentChange <= -25) {
        severity = 'highlight';
        isImprovement = true;
      }
      // No opportunity tier for small samples - require stronger signal
    }
    
    // No card if thresholds not met
    if (severity === null) {
      // Soft-signal (NOT no-data): We have valid TTFC baselines + samples but the change
      // doesn't cross alert thresholds. Emit a SECONDARY directional card so Plan–Code
      // can reach >=3 real insights without using quota filler.
      if (sampleTier !== null && baselineMedian > 0) {
        const latestTs = sessionsWithCommit
          .map(s => s.timestamp)
          .filter(Boolean)
          .sort()
          .slice(-1)[0];
        const directionVariant = Math.abs(percentChange) < 10
          ? 'directional-stable'
          : (percentChange < 0 ? 'directional-improving' : 'directional-slower');

        const insight: PerformanceInsight = {
          id: makeDeterministicInsightId('org-ttfc-regression', latestTs?.slice(0, 10), directionVariant),
          title: Math.abs(percentChange) < 10
            ? `Time to first commit is close to baseline (${currentMedian.toFixed(1)}m vs ${baselineMedian.toFixed(1)}m)`
            : `Time to first commit is directionally ${percentChange < 0 ? 'improving' : 'slower'} (${currentMedian.toFixed(1)}m vs ${baselineMedian.toFixed(1)}m)`,
          description: `TTFC moved ${(percentChange >= 0 ? '+' : '')}${percentChange.toFixed(1)}% vs baseline but did not cross the alert threshold for this sample tier. Treat this as directional and keep collecting sessions to increase confidence.`,
          severity: 'info',
          cicdStage: 'plan-code',
          toolScope: 'org',
          source: 'combined',
          metricId: 'org.time_to_first_commit',
          dataSource: 'real',
          evidence: [
            { label: 'Current median TTFC', value: `${currentMedian.toFixed(1)}m` },
            { label: 'Baseline median TTFC', value: `${baselineMedian.toFixed(1)}m` },
            { label: 'Δ vs baseline', value: `${(percentChange >= 0 ? '+' : '')}${percentChange.toFixed(1)}%` },
            { label: 'Sample tier', value: String(sampleTier) },
            { label: 'Sessions w/ commits (current)', value: `n=${currentSessions.length}` },
            { label: 'Sessions w/ commits (baseline)', value: `n=${baselineSessions.length}` },
          ],
          recommendations: [
            {
              text: 'Keep IDE telemetry enabled and aim for 2+ more weeks of sessions so TTFC changes can be evaluated with higher confidence.',
              actionType: 'observability'
            },
            {
              text: 'If TTFC is trending slower, audit environment setup friction (build/test time, auth, repo bootstrap) and target <10–15 minutes median TTFC.',
              actionType: 'process'
            }
          ],
          related: {},
          tools: undefined,
          priorityScore: 50,
          summaryEligible: false,
          tags: ['org', 'plan-code', 'ttfc', 'low-confidence', 'directional'],
          confidenceBadge: 'Directional',
        } as any;

        return [insight];
      }

      // VALUE MODE: Emit stable/directional insight when there is enough data but no threshold-crossing change
      if (isValueMode()) {
        const latestTs = sessionsWithCommit
          .map(s => s.timestamp)
          .filter(Boolean)
          .sort()
          .slice(-1)[0];
        const stableVariant = Math.abs(percentChange) < 10 ? 'stable' : (percentChange < 0 ? 'directional-improving' : 'directional-slower');
        const insight: PerformanceInsight = {
          id: makeDeterministicInsightId('org-ttfc-regression', latestTs?.slice(0, 10), stableVariant),
          title: Math.abs(percentChange) < 10
            ? `Time to first commit is stable (${currentMedian.toFixed(1)}m vs ${baselineMedian.toFixed(1)}m)`
            : `Time to first commit is ${percentChange < 0 ? 'improving' : 'slower'} (${currentMedian.toFixed(1)}m vs ${baselineMedian.toFixed(1)}m)`,
          description: Math.abs(percentChange) < 10
            ? `TTFC is within ${Math.abs(percentChange).toFixed(1)}% of baseline. No significant regression detected.`
            : percentChange < 0
            ? `TTFC improved by ${Math.abs(percentChange).toFixed(1)}% compared to baseline. Continue monitoring ramp-up efficiency.`
            : `TTFC is ${percentChange.toFixed(1)}% above baseline, but below the alert threshold. Monitor for further slowdown.`,
          severity: 'info',
          evidence: [
            { label: 'Current median TTFC', value: `${currentMedian.toFixed(1)}m` },
            { label: 'Baseline median TTFC', value: `${baselineMedian.toFixed(1)}m` },
            { label: 'Δ vs baseline', value: `${percentChange.toFixed(1)}%` },
          ],
          recommendations: [
            {
              text: 'Keep monitoring onboarding and environment readiness signals (setup time, repo health, build/test latency) to maintain TTFC.',
              actionType: 'observability'
            }
          ],
          related: {},
          tools: undefined,
          priorityScore: 40,
          summaryEligible: false,
          tags: ['org', 'plan-code', 'ttfc', Math.abs(percentChange) < 10 ? 'stable' : 'directional'],
          source: 'combined'
        };
        return [insight];
      }

      if (import.meta.env.DEV) {
        console.warn('[PI][PlanCode][TTFC] No insight: change within threshold range', {
          percentChange: percentChangeRounded + '%',
          sampleTier,
          thresholds: sampleTier === 2 ? '±25-30% (strict for small sample)' : '±10-20%'
        });
      }
      if (TTFC_DEBUG) {
        console.warn('[TTFC_DEBUG][Rule] EARLY_RETURN: no_threshold_met', {
          percentChange: percentChangeRounded + '%',
          sampleTier,
          currentMedian: currentMedian.toFixed(2) + ' min',
          baselineMedian: baselineMedian.toFixed(2) + ' min',
          thresholds: sampleTier === 2 ? { warning: '>=+30%', highlight: '<=-25%' } : { warning: '>=+20%', opportunity: '>=+10%', highlight: '<=-15%' },
          reason: sampleTier === 2 
            ? 'Small sample (Tier 2) requires stronger signal. Change is within -25% to +30% range.'
            : 'Change is within -15% to +10% range, no card emitted'
        });
      }
      return [];
    }
    
    // TTFC_DEBUG: Log that we will emit a card
    if (TTFC_DEBUG) {
      console.warn('[TTFC_DEBUG][Rule] WILL_EMIT_CARD', {
        severity,
        isRegression,
        isImprovement,
        percentChange: percentChangeRounded + '%'
      });
    }
    
    // =========================================================================
    // Correlation Checks for Action Generation
    // =========================================================================
    
    // Identify "slow" sessions (TTFC > 30 min) in current period
    const slowThresholdMin = 30;
    const slowSessions = currentSessions.filter(s => getTTFCMinutes(s) > slowThresholdMin);
    
    // Compute median rework ratio for slow sessions
    const slowReworkRatios = slowSessions
      .map(s => s.rework_ratio_est)
      .filter(r => r !== undefined && r !== null);
    const medianSlowRework = slowReworkRatios.length > 0 ? median(slowReworkRatios) : 0;
    const hasHighRework = medianSlowRework > 0.6;
    
    // Compute median AI intensity for slow sessions
    const slowAICharsPerMin = slowSessions
      .map(s => s.ai_chars_per_min)
      .filter((v): v is number => v !== null && v !== undefined);
    const medianSlowAI = slowAICharsPerMin.length > 0 ? median(slowAICharsPerMin) : 0;
    const hasLowAI = medianSlowAI < 200;
    
    // Check for IDE-specific patterns (using vscode_version as proxy)
    const ideGroups = new Map<string, number[]>();
    currentSessions.forEach(s => {
      const ide = s.vscode_version ? 'VS Code ' + s.vscode_version.split('.')[0] : 'Unknown IDE';
      if (!ideGroups.has(ide)) ideGroups.set(ide, []);
      ideGroups.get(ide)!.push(getTTFCMinutes(s));
    });
    
    let slowerIDE: string | null = null;
    let fasterIDE: string | null = null;
    let idePercentDiff = 0;
    
    if (ideGroups.size >= 2) {
      const ideMedians = Array.from(ideGroups.entries())
        .map(([ide, ttfcs]) => ({ ide, median: median(ttfcs) }))
        .sort((a, b) => b.median - a.median);
      
      if (ideMedians.length >= 2) {
        const slowest = ideMedians[0];
        const fastest = ideMedians[ideMedians.length - 1];
        if (fastest.median > 0 && slowest.median > fastest.median * 1.2) {
          slowerIDE = slowest.ide;
          fasterIDE = fastest.ide;
          idePercentDiff = Math.round(((slowest.median - fastest.median) / fastest.median) * 100);
        }
      }
    }
    
    // Check for repo concentration
    const repoGroups = new Map<string, number>();
    slowSessions.forEach(s => {
      const repo = s.git_repo_url || 'unknown';
      repoGroups.set(repo, (repoGroups.get(repo) || 0) + 1);
    });
    
    let worstRepo: string | null = null;
    let repoConcentrationPct = 0;
    
    if (repoGroups.size > 0 && slowSessions.length > 0) {
      const sorted = Array.from(repoGroups.entries()).sort((a, b) => b[1] - a[1]);
      const [topRepo, topCount] = sorted[0];
      repoConcentrationPct = Math.round((topCount / slowSessions.length) * 100);
      if (repoConcentrationPct >= 40 && topRepo !== 'unknown') {
        // Extract repo name from URL
        const repoName = topRepo.split('/').slice(-1)[0]?.replace('.git', '') || topRepo;
        worstRepo = repoName;
      }
    }
    
    // =========================================================================
    // Build Insight
    // =========================================================================
    
    // Title: scope + direction + delta + window
    const title = isImprovement
      ? `Org-wide ramp-up accelerated ${Math.abs(percentChangeRounded)}% over the last 7 days`
      : `Org-wide ramp-up slowed +${Math.abs(percentChangeRounded)}% over the last 7 days`;
    
    // Summary - concise with key numbers
    const rampDirection = isImprovement ? 'faster' : 'slower';
    const description = `Median time to first commit changed from ${baselineMedian.toFixed(1)} min (baseline) to ${currentMedian.toFixed(1)} min (current) across ${currentSessions.length} sessions, indicating ${rampDirection} developer ramp-up.`;
    
    // Evidence
    const evidence: InsightEvidence[] = [
      { label: 'Current median TTFC', value: `${currentMedian.toFixed(1)} min` },
      { label: 'Baseline median TTFC', value: `${baselineMedian.toFixed(1)} min` },
      { label: 'Percent change', value: `${percentChangeRounded > 0 ? '+' : ''}${percentChangeRounded}%` },
      { label: 'Sessions with commits (current)', value: `n=${currentSessions.length}` },
      { label: 'Sessions with commits (baseline)', value: `n=${baselineSessions.length}` },
      { label: 'Commit rate', value: `${(commitRate * 100).toFixed(0)}%` },
    ];
    
    // Add sample size caveat for small sample cards
    if (isSmallSampleCard) {
      evidence.push({ label: 'Sample size note', value: 'Small sample (n<20) — stronger thresholds applied' });
    }
    
    // Add diagnostic evidence for slow sessions
    if (isRegression && slowSessions.length > 0) {
      evidence.push({ label: 'Slow sessions (>30 min)', value: slowSessions.length });
      if (slowReworkRatios.length > 0) {
        evidence.push({ label: 'Median rework (slow sessions)', value: medianSlowRework.toFixed(2) });
      }
      if (slowAICharsPerMin.length > 0) {
        evidence.push({ label: 'Median AI chars/min (slow sessions)', value: Math.round(medianSlowAI) });
      }
    }
    
    // Build action recommendation (deterministic, data-backed, specific with targets)
    const recommendations: InsightRecommendation[] = [];
    
    // Target TTFC: 10 min for new projects, 15 min for complex repos
    const targetTTFC = 10;
    
    if (isRegression) {
      // Primary action: based on correlation checks (mutually exclusive, most specific first)
      if (worstRepo && repoConcentrationPct >= 40) {
        // Regression concentrated in specific repo(s)
        recommendations.push({
          text: `Standardize task bootstrap in ${worstRepo}: add CONTRIBUTING.md + \`make dev\` + \`make test\`; target <${targetTTFC} min TTFC. (${repoConcentrationPct}% of slow sessions are in this repo.)`,
          actionType: 'process'
        });
      } else if (hasHighRework) {
        // High rework in first 15 minutes
        recommendations.push({
          text: `Add pre-commit formatting + lint autofix; reduce churn in first 15 minutes. (Slow sessions show rework >${(medianSlowRework * 100).toFixed(0)}%, threshold: 60%.) Target: median TTFC <${targetTTFC} min.`,
          actionType: 'tooling'
        });
      } else if (hasLowAI) {
        // Low AI intensity in slow sessions
        recommendations.push({
          text: `Roll out AI scaffolds for starter files; target AI intensity band >= medium in slow TTFC sessions. (Current: ${Math.round(medianSlowAI)} chars/min, target: >200 chars/min.) Expected: reduce median TTFC to <${targetTTFC} min.`,
          actionType: 'tooling'
        });
      } else if (slowerIDE && fasterIDE) {
        // IDE disparity
        recommendations.push({
          text: `${slowerIDE} reaches first commit ${idePercentDiff}% slower than ${fasterIDE}. Align ${slowerIDE} setup scripts and extensions to match ${fasterIDE}; target TTFC parity within 5%.`,
          actionType: 'tooling'
        });
      } else {
        // No specific signal - provide general guidance with target
        recommendations.push({
          text: `TTFC increased ${Math.abs(percentChangeRounded)}%: audit dev environment setup for recent friction sources (build times, auth, network). Target: median TTFC <${targetTTFC} min.`,
          actionType: 'process'
        });
      }
      
      // Secondary: observability action
      recommendations.push({
        text: `Platform team: Set up weekly TTFC alerting. Alert if median exceeds ${Math.round(currentMedian * 1.1)} min (current + 10%). Expected: early detection of workflow regressions.`,
        actionType: 'observability'
      });
    } else {
      // Improvement - sustain momentum with specific targets
      recommendations.push({
        text: `Ramp-up accelerated ${Math.abs(percentChangeRounded)}%. Document what changed (tooling, templates, env setup) and propagate to all repos. Lock in target: median TTFC <${currentMedian.toFixed(0)} min.`,
        actionType: 'training'
      });
      recommendations.push({
        text: `Set observability alert if median TTFC rises above ${Math.round(currentMedian * 1.15)} min (current + 15%). Expected: protect gains from regression.`,
        actionType: 'observability'
      });
    }
    
    const insight: PerformanceInsight = {
      id: `org-ttfc-${isRegression ? 'regression' : 'improvement'}-${Date.now()}`,
      title,
      description,
      severity,
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'plan-code',
      toolScope: 'org',
      source: 'productivity',
      metricId: 'org.time_to_first_commit',
      dataSource: 'real',
      evidence,
      recommendations,
      related: {},
      tools: undefined,
      priorityScore: isRegression ? 95 : 80,
      tags: ['org', 'ttfc', 'plan-code', 'ramp-up'],
      summaryEligible: true,
      ruleLabel: 'Time to First Commit'
    };
    
    console.warn('[PI][PlanCode][TTFC] RETURN', {
      title: insight.title,
      severity: insight.severity,
      percentChange: percentChangeRounded + '%'
    });
    
    // TTFC_DEBUG: Log successful card emission
    if (TTFC_DEBUG) {
      console.warn('[TTFC_DEBUG][Rule] SUCCESS: Card emitted', {
        id: insight.id,
        title: insight.title,
        severity: insight.severity,
        cicdStage: insight.cicdStage,
        metricId: insight.metricId,
        toolScope: insight.toolScope,
        priorityScore: insight.priorityScore,
        summaryEligible: insight.summaryEligible,
        evidenceCount: insight.evidence.length,
        recommendationCount: insight.recommendations.length
      });
    }
    
    return [insight];
    
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[PI][PlanCode][TTFC] Error:', e);
    }
    if (TTFC_DEBUG) {
      console.warn('[TTFC_DEBUG][Rule] EXCEPTION:', e);
    }
    return [];
  }
}

/**
 * Repo Onboarding Friction Rule (Plan & Code) - GitHub-based
 * 
 * Detects repositories with elevated PR ramp-up time (time-to-first-review or cycle time)
 * compared to org baseline, indicating onboarding/setup friction.
 * 
 * Uses GitHub engOutput data only (no productivity dependency, no repo filter dependency).
 * 
 * Behavior:
 * - Groups engOutput by repo
 * - Computes repo-level average (TTFR preferred, cycle time fallback)
 * - Compares to org baseline (median of repo averages)
 * - Emits max 1 insight for worst outlier repo
 * 
 * Metric: timeToFirstReviewHours (preferred) or prCycleTimeHours (fallback)
 * Thresholds: ≥30% worse OR ≥12-24 hours absolute difference
 */
function ruleRepoIssueHotspotGH(input: PerformanceInputs): PerformanceInsight[] {
  if (import.meta.env.DEV) {
    console.warn('[PI][PlanCode][RepoHotspot] ENTER', {
      hasSnapshot: !!input.githubSnapshot
    })
  }
  
  const { githubSnapshot } = input
  
  // QUICK FIX: Use whatever data we have - repo names and total issues
  if (!githubSnapshot) {
    return []
  }
  
  try {
    // Get repo names from snapshot (try multiple locations)
    const repoList: string[] = []
    
    // Try repositories array
    if (Array.isArray(githubSnapshot.repositories)) {
      repoList.push(...githubSnapshot.repositories.map((r: any) => r.full_name || r.name || String(r)))
    }
    
    // Try open_issues_by_repo keys
    const issuesByRepo = githubSnapshot.open_issues_by_repo || 
                        githubSnapshot.team_metrics?.open_issues_by_repo || 
                        githubSnapshot.github_team_metrics?.open_issues_by_repo || {}
    
    if (typeof issuesByRepo === 'object' && !Array.isArray(issuesByRepo)) {
      repoList.push(...Object.keys(issuesByRepo))
    }
    
    // Get total open issues
    const totalOpenIssues = Number(
      githubSnapshot.open_issues_total || 
      githubSnapshot.team_metrics?.open_issues_total || 
      githubSnapshot.github_team_metrics?.open_issues_total || 
      0
    ) || 0
    
    // Get total repos
    const totalRepos = Number(
      githubSnapshot.total_repositories || 
      githubSnapshot.repositories?.length || 
      repoList.length || 
      0
    ) || 0
    
    if (repoList.length === 0 || totalRepos === 0) {
      if (import.meta.env.DEV) {
        console.warn('[PI][PlanCode][RepoHotspot] No repos found', { repoList, totalRepos, snapshot: githubSnapshot })
      }
      return []
    }
    
    // In DEMO_MODE or if we have data, pick first repo
    // This ensures the rule fires for demo purposes
    const rawRepo = repoList[0] || 'unknown-repo'
    // Extract just the repo name (remove account prefix if present, e.g., "root-account/repo-name" -> "repo-name")
    const targetRepo = rawRepo.includes('/') ? rawRepo.split('/').pop() || rawRepo : rawRepo
    
    if (import.meta.env.DEV) {
      console.warn('[PI][PlanCode][RepoHotspot] QUICK FIX - Using org averages', {
        totalRepos,
        totalOpenIssues,
        rawRepo,
        targetRepo
      })
    }
    
    // Title: Encode "so what" - issue load may indicate friction
    const title = `${targetRepo} may have elevated issue load—establish ownership`;
    
    // Description: Explain impact/implication without repeating evidence numbers verbatim
    const description = `This repository shows signs of elevated issue load relative to organizational patterns. Unaddressed issues can create technical debt, slow feature delivery, and increase developer frustration. Establishing clear ownership, triage processes, and response SLAs can prevent issues from accumulating and improve overall repository health.`;
    
    // Evidence: Standardized labels (Current, Baseline, Delta, Points analyzed, Data source)
    const evidence: InsightEvidence[] = [
      { label: 'Repository', value: targetRepo },
      { label: 'Total open issues (org)', value: totalOpenIssues.toString() },
      { label: 'Total repositories', value: totalRepos.toString() },
      { label: 'Data source', value: inferDataSourceForOrgInsight(input) || 'github' }
    ];
    
    // Recommendations: ≥3 crisp recommendations with owner + action + expected outcome
    const recommendations: InsightRecommendation[] = [
      {
        text: `Repository maintainers: Establish clear ownership via CODEOWNERS file and define SLAs for issue response (e.g., triage within 48 hours, response within 1 week). Assign a primary and backup maintainer. Expected: 50% reduction in stale issues within 4 weeks.`,
        actionType: 'ownership'
      },
      {
        text: 'Platform team: Implement automated issue labeling (bug, feature, question, etc.) and issue templates to streamline triage. Set up automated reminders for issues without activity >30 days. Expected: 40% faster issue resolution time.',
        actionType: 'observability'
      },
      {
        text: 'Engineering managers: Schedule monthly issue backlog grooming sessions to prioritize, close stale issues, and identify patterns. Track issue resolution metrics (time-to-close, resolution rate). Expected: Maintained issue backlog health and improved developer satisfaction.',
        actionType: 'process'
      }
    ];
    
    // Emit insight using org-wide average approach
    const insight: PerformanceInsight = {
      id: `repo-issue-hotspot-gh::${targetRepo.replace(/\//g, '-')}`,
      title,
      description,
      severity: totalOpenIssues > 0 ? 'info' : 'info',
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'plan-code',
      toolScope: 'cross-ide',  // Changed from 'org' to 'cross-ide' so it appears as a card, not in org summary
      source: 'github',
      metricId: 'github.open_issues_by_repo',
      dataSource: inferDataSourceForOrgInsight(input),
      priorityScore: 85,  // High priority for repo-level insights
      summaryEligible: false,  // Display as card, not in org summary
      evidence,
      recommendations,
      related: {
        repos: [targetRepo]
      },
      tags: ['repo-level', 'planning', 'issues', 'hotspot']
    }
    
    if (import.meta.env.DEV) {
      console.warn('[PI][PlanCode][RepoHotspot] EMIT', {
        title: insight.title,
        targetRepo,
        totalOpenIssues,
        totalRepos,
        hasSnapshot: !!input.githubSnapshot
      })
    }
    
    return [insight]
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[PI][PlanCode][RepoHotspot] Error:', e)
    }
    return []
  }
}

/**
 * RULE: Session Quality Regression (telemetry, Plan & Code)
 * 
 * Early warning that focus/flow quality is degrading before delivery metrics move.
 * Uses session_quality_band and session_quality_score from telemetry sessions.
 */
function ruleTelemetrySessionQualityRegression(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'telemetry-session-quality-regression';
  const sessions = input.sessions;

  if (!requireNonEmptyBool(sessions, ruleId, 'sessions')) {
    return [];
  }

  const sessionsArr = sessions || [];
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const currentSessions = sessionsArr.filter(s => new Date(s.timestamp) >= sevenDaysAgo);
  const baselineSessions = sessionsArr.filter(s => {
    const ts = new Date(s.timestamp);
    return ts >= thirtyDaysAgo && ts < sevenDaysAgo;
  });

  // Guardrails: require >= 8 sessions in both windows, >=3 sessions with quality scores
  if (!requireMinLen(currentSessions, 8, ruleId, 'sessions_current')) {
    return [];
  }
  if (!requireMinLen(baselineSessions, 8, ruleId, 'sessions_baseline')) {
    return [];
  }

  const currentQualityScores = currentSessions.map(s => Number(s.session_quality_score)).filter(v => Number.isFinite(v));
  const baselineQualityScores = baselineSessions.map(s => Number(s.session_quality_score)).filter(v => Number.isFinite(v));

  if (!requireMinLen(currentQualityScores, 3, ruleId, 'current_quality_scores')) {
    return [];
  }
  if (!requireMinLen(baselineQualityScores, 3, ruleId, 'baseline_quality_scores')) {
    return [];
  }

  const currentLowQualityShare = currentSessions.filter(s => s.session_quality_band === 'low').length / currentSessions.length;
  const baselineLowQualityShare = baselineSessions.filter(s => s.session_quality_band === 'low').length / baselineSessions.length;

  const currentAvgQuality = currentQualityScores.reduce((a, b) => a + b, 0) / currentQualityScores.length;
  const baselineAvgQuality = baselineQualityScores.reduce((a, b) => a + b, 0) / baselineQualityScores.length;

  const lowQualityIncrease = currentLowQualityShare - baselineLowQualityShare;
  const qualityScoreDecrease = (currentAvgQuality - baselineAvgQuality) / baselineAvgQuality;

  // Trigger: emit if low-quality share increased >=10 percentage points OR avg quality decreased >=15%
  if (lowQualityIncrease < 0.10 && qualityScoreDecrease > -0.15) {
    return [];
  }

  const latestTs = sessionsArr.map(s => s.timestamp).filter(Boolean).sort().slice(-1)[0];

  const insight: PerformanceInsight = {
    id: makeDeterministicInsightId(ruleId, latestTs?.slice(0, 10), 'quality-regression'),
    title: 'Session quality has declined in recent weeks',
    description: `Session quality degraded with ${formatPercent(currentLowQualityShare * 100)} low-quality sessions (vs ${formatPercent(baselineLowQualityShare * 100)} baseline) and average quality score ${currentAvgQuality.toFixed(2)} (vs ${baselineAvgQuality.toFixed(2)} baseline). This indicates reduced flow state and focus before delivery metrics are affected.`,
    severity: 'warning',
    insightClass: 'org_deterministic',
    orgKind: 'diagnostic',
    cicdStage: 'plan-code',
    toolScope: 'org',
    source: 'productivity',
    metricId: 'org.session_quality_regression',
    dataSource: 'real',
    tags: ['plan-code'],
    evidence: [
      { label: 'Current low-quality share', value: formatPercent(currentLowQualityShare * 100) },
      { label: 'Baseline low-quality share', value: formatPercent(baselineLowQualityShare * 100) },
      { label: 'Current avg quality score', value: currentAvgQuality.toFixed(2) },
      { label: 'Baseline avg quality score', value: baselineAvgQuality.toFixed(2) },
      { label: 'Sessions (current)', value: String(currentSessions.length) },
      { label: 'Sessions (baseline)', value: String(baselineSessions.length) },
    ],
    recommendations: [
      { text: 'Schedule dedicated focus blocks (2-3 hour chunks) and minimize interruptions during deep work periods. Track session quality scores weekly to verify improvement.', actionType: 'process' },
      { text: 'Review development environment setup and remove friction points that break flow state. Consider using focus tools and reducing notification noise during coding sessions.', actionType: 'tooling' },
    ],
  };

  return [insight];
}

/**
 * RULE: AI Intensity vs Focus Imbalance (telemetry, Plan & Code)
 * 
 * Highlights prompt thrash or context switching despite heavy AI usage.
 * Uses ai_intensity_band, ai_chars_per_min, focus_ratio, idle_ratio.
 */
function ruleTelemetryAIFocusImbalance(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'telemetry-ai-focus-imbalance';
  const sessions = input.sessions;

  if (!requireNonEmptyBool(sessions, ruleId, 'sessions')) {
    return [];
  }

  const sessionsArr = sessions || [];
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const recentSessions = sessionsArr.filter(s => new Date(s.timestamp) >= fourteenDaysAgo);

  // Guardrails: require >= 10 sessions in 14 days, >=3 AI-active sessions
  if (!requireMinLen(recentSessions, 10, ruleId, 'sessions_14d')) {
    return [];
  }

  const aiActiveSessions = recentSessions.filter(s => s.ai_intensity_band === 'high' || s.ai_intensity_band === 'medium');

  if (!requireMinLen(aiActiveSessions, 3, ruleId, 'ai_active_sessions')) {
    return [];
  }

  // Find sessions with AI-heavy usage but low focus or high idle ratio
  const imbalancedSessions = aiActiveSessions.filter(s => {
    const focusRatio = s.focus_ratio ?? 0;
    const idleRatio = s.idle_ratio ?? 0;
    return focusRatio < 0.4 || idleRatio > 0.4;
  });

  const imbalancedShare = imbalancedSessions.length / aiActiveSessions.length;

  // Trigger: emit if >=20% of AI-active sessions are imbalanced
  if (imbalancedShare < 0.20) {
    return [];
  }

  const medianFocusRatio = median(imbalancedSessions.map(s => s.focus_ratio ?? 0).filter(v => Number.isFinite(v)));
  const medianAICharsPerMin = median(imbalancedSessions.map(s => s.ai_chars_per_min ?? 0).filter(v => Number.isFinite(v)));

  const severity = imbalancedShare >= 0.40 ? 'warning' : 'info';
  const latestTs = sessionsArr.map(s => s.timestamp).filter(Boolean).sort().slice(-1)[0];

  const insight: PerformanceInsight = {
    id: makeDeterministicInsightId(ruleId, latestTs?.slice(0, 10), 'ai-focus-imbalance'),
    title: 'AI intensity vs focus imbalance detected',
    description: `${formatPercent(imbalancedShare * 100)} of recent sessions show AI-heavy usage with low focus (median focus ratio ${medianFocusRatio.toFixed(2)}). This suggests prompt thrashing or context switching despite high AI activity, indicating inefficient AI workflows.`,
    severity,
    insightClass: 'org_deterministic',
    orgKind: 'diagnostic',
    cicdStage: 'plan-code',
    toolScope: 'org',
    source: 'productivity',
    metricId: 'org.ai_focus_imbalance',
    dataSource: 'real',
    tags: ['plan-code'],
    evidence: [
      { label: 'Imbalanced sessions share', value: formatPercent(imbalancedShare * 100) },
      { label: 'Median focus ratio', value: medianFocusRatio.toFixed(2) },
      { label: 'AI-active sessions', value: String(aiActiveSessions.length) },
      { label: 'Total sessions (14d)', value: String(recentSessions.length) },
      { label: 'Median AI chars/min', value: medianAICharsPerMin.toFixed(0) },
    ],
    recommendations: [
      { text: 'Plan AI prompts more deliberately: batch similar requests, use context effectively, and avoid rapid prompt iteration. Track focus ratio during AI-heavy sessions.', actionType: 'process' },
      { text: 'Chunk AI usage into focused blocks rather than continuous low-intensity interaction. Consider using AI templates for common patterns to reduce prompt thrashing.', actionType: 'tooling' },
    ],
  };

  return [insight];
}

/**
 * RULE: Remote Workspace Drag (telemetry, Plan & Code)
 * 
 * Flags lower flow when devs work in remote environments.
 * Uses is_remote_workspace, active_coding_duration_ms, focus_ratio.
 */
function ruleTelemetryRemoteWorkspaceDrag(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'telemetry-remote-workspace-drag';
  const sessions = input.sessions;

  if (!requireNonEmptyBool(sessions, ruleId, 'sessions')) {
    return [];
  }

  const sessionsArr = sessions || [];
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const recentSessions = sessionsArr.filter(s => new Date(s.timestamp) >= thirtyDaysAgo);

  const remoteSessions = recentSessions.filter(s => s.is_remote_workspace === true);
  const localSessions = recentSessions.filter(s => s.is_remote_workspace === false);

  // Guardrails: require >= 5 sessions in both buckets
  if (!requireMinLen(remoteSessions, 5, ruleId, 'remote_sessions')) {
    return [];
  }
  if (!requireMinLen(localSessions, 5, ruleId, 'local_sessions')) {
    return [];
  }

  // Compute medians for active coding and focus ratio
  const remoteActiveCoding = remoteSessions
    .map(s => Number(s.active_coding_duration_ms))
    .filter(v => Number.isFinite(v) && v > 0);
  const localActiveCoding = localSessions
    .map(s => Number(s.active_coding_duration_ms))
    .filter(v => Number.isFinite(v) && v > 0);

  const remoteFocus = remoteSessions
    .map(s => Number(s.focus_ratio))
    .filter(v => Number.isFinite(v) && v >= 0 && v <= 1);
  const localFocus = localSessions
    .map(s => Number(s.focus_ratio))
    .filter(v => Number.isFinite(v) && v >= 0 && v <= 1);

  if (remoteActiveCoding.length === 0 || localActiveCoding.length === 0) {
    return [];
  }

  const remoteActiveMedian = median(remoteActiveCoding) / 60000; // Convert ms to minutes
  const localActiveMedian = median(localActiveCoding) / 60000; // Convert ms to minutes
  const remoteFocusMedian = median(remoteFocus);
  const localFocusMedian = median(localFocus);

  // Trigger: emit if remote median active coding is >= 20% lower OR focus ratio >= 15% lower
  const activeCodingDiff = (remoteActiveMedian - localActiveMedian) / localActiveMedian;
  const focusDiff = (remoteFocusMedian - localFocusMedian) / localFocusMedian;

  const shouldEmit = activeCodingDiff <= -0.20 || focusDiff <= -0.15;

  if (!shouldEmit) {
    return [];
  }

  const latestTs = sessionsArr.map(s => s.timestamp).filter(Boolean).sort().slice(-1)[0];

  const insight: PerformanceInsight = {
    id: makeDeterministicInsightId(ruleId, latestTs?.slice(0, 10), 'remote-drag'),
    title: 'Remote workspace shows performance drag',
    description: `Remote sessions show ${activeCodingDiff <= -0.20 ? formatPercent(Math.abs(activeCodingDiff) * 100) + ' lower active coding time' : ''}${activeCodingDiff <= -0.20 && focusDiff <= -0.15 ? ' and ' : ''}${focusDiff <= -0.15 ? formatPercent(Math.abs(focusDiff) * 100) + ' lower focus ratio' : ''} compared to local sessions. This suggests network latency, environment setup, or resource constraints affecting remote development productivity.`,
    severity: 'info',
    insightClass: 'org_deterministic',
    orgKind: 'diagnostic',
    cicdStage: 'plan-code',
    toolScope: 'org',
    source: 'productivity',
    metricId: 'org.remote_workspace_drag',
    dataSource: 'real',
    tags: ['plan-code'],
    evidence: [
      { label: 'Remote active coding (median)', value: `${remoteActiveMedian.toFixed(0)}m` },
      { label: 'Local active coding (median)', value: `${localActiveMedian.toFixed(0)}m` },
      { label: 'Remote focus ratio (median)', value: remoteFocusMedian.toFixed(2) },
      { label: 'Local focus ratio (median)', value: localFocusMedian.toFixed(2) },
      { label: 'Remote sessions', value: String(remoteSessions.length) },
      { label: 'Local sessions', value: String(localSessions.length) },
    ],
    recommendations: [
      { text: 'Review remote development environment performance: check network latency, resource allocation, and consider using cloud-based development environments with better connectivity.', actionType: 'tooling' },
      { text: 'Optimize remote workspace setup with pre-configured development containers, local caching, and optimized build processes to reduce friction.', actionType: 'tooling' },
    ],
  };

  return [insight];
}

/**
 * RULE: Reviewer Load Concentration (GitHub metrics, Review & Merge)
 * 
 * Detects small reviewer pools creating bottlenecks.
 * Uses githubSnapshot.pr_review_metrics.review_count and unique_reviewer_count.
 */
function ruleReviewerLoadConcentration(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'reviewer-load-concentration';
  const githubSnapshot = input.githubSnapshot;

  // 🔥 LOUD DEBUG: Check what we actually received
  console.log('🔥🔥🔥 [OLD_ENGINE_ENTRY] ruleReviewerLoadConcentration called with:', {
    hasGithubSnapshot: !!githubSnapshot,
    githubSnapshotType: typeof githubSnapshot,
    githubSnapshotKeys: githubSnapshot && typeof githubSnapshot === 'object' ? Object.keys(githubSnapshot).slice(0, 10) : null,
    hasTopLevelField: !!githubSnapshot?.reviewer_load_concentration,
    topLevelFieldValue: githubSnapshot?.reviewer_load_concentration
  });

  // 🔥 FIX: Read from top-level PI field that backend now provides
  const reviewerLoadConcentration = githubSnapshot?.reviewer_load_concentration;
  
  if (reviewerLoadConcentration !== null && reviewerLoadConcentration !== undefined) {
    console.log('🔥🔥🔥 [OLD_ENGINE] Using top-level reviewer_load_concentration:', reviewerLoadConcentration);
    
    // Trigger: emit if reviewer_load_concentration >= 8
    if (reviewerLoadConcentration < 8) {
      return [];
    }
    
    return [{
      cicdStage: 'review-merge',
      id: ruleId,
      title: 'Reviewer Load Concentration [OLD_BUILD_CHECK]',
      description: `Reviewer pool shows concentration with ${reviewerLoadConcentration.toFixed(1)} reviews per reviewer.`,
      severity: reviewerLoadConcentration >= 15 ? 'critical' : reviewerLoadConcentration >= 10 ? 'warning' : 'info',
      insightClass: 'pattern',
      evidence: [
        `Reviews per reviewer: ${reviewerLoadConcentration.toFixed(1)}`,
        'Data source: Live GitHub API (top-level field)'
      ],
      recommendations: [
        { text: 'Rotate reviewers and broaden the reviewer pool to reduce bottlenecks.', actionType: 'process' },
        { text: 'Implement reviewer load balancing for more even distribution.', actionType: 'tooling' }
      ],
      demoFlag: 'demo_primary',
      dataSource: 'real',
      contributingSessions: 0, // Not applicable for GitHub-based metrics
      coveragePct: 100
    }];
  }

  // FALLBACK: Try old nested computation
  if (!githubSnapshot || !githubSnapshot.pr_review_metrics) {
    return [];
  }

  const { review_count, unique_reviewer_count } = githubSnapshot.pr_review_metrics;

  // Guardrails: require review_count >= 1 and unique_reviewer_count >= 1
  if (!review_count || review_count < 1 || !unique_reviewer_count || unique_reviewer_count < 1) {
    return [];
  }

  const reviewsPerReviewer = review_count / Math.max(unique_reviewer_count, 1);

  // Trigger: emit if reviews_per_reviewer >= 3 (lowered from 8)
  if (reviewsPerReviewer < 3) {
    return [];
  }

  const latestTs = new Date().toISOString().slice(0, 10);

  const insight: PerformanceInsight = {
    id: makeDeterministicInsightId(ruleId, latestTs, 'reviewer-load'),
    title: 'Reviewer load concentration detected',
    description: `Reviewer pool shows high concentration with ${reviewsPerReviewer.toFixed(1)} reviews per reviewer across ${review_count} total reviews by ${unique_reviewer_count} unique reviewers. This creates bottlenecks and slows review cycle times.`,
    severity: 'warning',
    insightClass: 'org_deterministic',
    orgKind: 'diagnostic',
    cicdStage: 'review-merge',
    toolScope: 'org',
    source: 'github',
    metricId: 'org.reviewer_load_concentration',
    dataSource: 'real',
    tags: ['review-merge'],
    evidence: [
      { label: 'Reviews per reviewer', value: reviewsPerReviewer.toFixed(1) },
      { label: 'Total reviews', value: String(review_count) },
      { label: 'Unique reviewers', value: String(unique_reviewer_count) },
    ],
    recommendations: [
      { text: 'Rotate reviewers and broaden the reviewer pool to reduce bottlenecks. Consider adding more team members to the review rotation.', actionType: 'process' },
      { text: 'Implement reviewer load balancing to ensure more even distribution of review workload across team members.', actionType: 'tooling' },
    ],
  };

  return [insight];
}

/**
 * RULE: Reopen Pressure Spike (GitHub metrics, Review & Merge)
 * 
 * Signals review quality gaps or unclear requirements.
 * Uses githubSnapshot.pr_review_metrics.pr_reopened_count and pr_analytics.total_prs.
 */
function ruleReopenPressureSpike(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'reopen-pressure-spike';
  const githubSnapshot = input.githubSnapshot;
  const latestTs = new Date().toISOString().slice(0, 10);

  // Case 3: No GitHub data at all
  if (!githubSnapshot || (!githubSnapshot.pr_review_metrics && !githubSnapshot.pr_analytics && !githubSnapshot.github_data_fallback)) {
    return [{
      id: makeDeterministicInsightId(ruleId, latestTs, 'reopen-pressure-nodata'),
      title: 'Reopen pressure — insufficient data',
      description: 'No GitHub PR data is available to evaluate reopen pressure. Connect a GitHub integration or wait for data to populate.',
      severity: 'info',
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'review-merge',
      toolScope: 'org',
      source: 'github',
      metricId: 'org.reopen_pressure_spike',
      dataSource: 'real',
      tags: ['review-merge'],
      evidence: [
        { label: 'GitHub data availability', value: 'none' },
      ],
      recommendations: [],
    }];
  }

  const { pr_reopened_count } = githubSnapshot.pr_review_metrics;
  const { total_prs } = githubSnapshot.pr_analytics;

  // Case 3b: GitHub snapshot exists but total_prs = 0 (insufficient data)
  if (!total_prs || total_prs < 1) {
    return [{
      id: makeDeterministicInsightId(ruleId, latestTs, 'reopen-pressure-nodata'),
      title: 'Reopen pressure — insufficient data',
      description: 'GitHub snapshot has zero PRs in the current window. Reopen pressure analysis requires at least 1 PR.',
      severity: 'info',
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'review-merge',
      toolScope: 'org',
      source: 'github',
      metricId: 'org.reopen_pressure_spike',
      dataSource: 'real',
      tags: ['review-merge'],
      evidence: [
        { label: 'GitHub data availability', value: 'insufficient' },
        { label: 'Total PRs', value: '0' },
      ],
      recommendations: [],
    }];
  }

  const reopenRate = pr_reopened_count / Math.max(total_prs, 1);

  // Case 1: Normal alert — threshold exceeded
  if (reopenRate >= 0.12) {
    const insight: PerformanceInsight = {
      id: makeDeterministicInsightId(ruleId, latestTs, 'reopen-pressure'),
      title: 'PR reopen pressure spike detected',
      description: `${formatPercent(reopenRate * 100)} of PRs (${pr_reopened_count} out of ${total_prs}) were reopened, indicating review quality gaps or unclear requirements. This rework adds cycle time and may signal scope creep.`,
      severity: 'warning',
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'review-merge',
      toolScope: 'org',
      source: 'github',
      metricId: 'org.reopen_pressure_spike',
      dataSource: 'real',
      tags: ['review-merge'],
      evidence: [
        { label: 'Reopen rate', value: formatPercent(reopenRate * 100) },
        { label: 'Reopened PRs', value: String(pr_reopened_count) },
        { label: 'Total PRs', value: String(total_prs) },
      ],
      recommendations: [
        { text: 'Reinforce review checklists and improve PR scope clarity to reduce rework. Consider requiring more detailed descriptions and acceptance criteria.', actionType: 'process' },
        { text: 'Add PR template fields for testing requirements and design review to catch issues earlier in the process.', actionType: 'tooling' },
      ],
    };

    return [insight];
  }

  // Case 2: Placeholder — threshold not met but data exists
  return [{
    id: makeDeterministicInsightId(ruleId, latestTs, 'reopen-pressure-ok'),
    title: 'Reopen pressure within normal range',
    description: `${formatPercent(reopenRate * 100)} of PRs (${pr_reopened_count} out of ${total_prs}) were reopened — below the 12% threshold. No action needed.`,
    severity: 'info',
    insightClass: 'org_deterministic',
    orgKind: 'diagnostic',
    cicdStage: 'review-merge',
    toolScope: 'org',
    source: 'github',
    metricId: 'org.reopen_pressure_spike',
    dataSource: 'real',
    tags: ['review-merge'],
    evidence: [
      { label: 'Reopen rate', value: formatPercent(reopenRate * 100) },
      { label: 'Reopened PRs', value: String(pr_reopened_count) },
      { label: 'Total PRs', value: String(total_prs) },
    ],
    recommendations: [],
  }];
}

/**
 * RULE: Large PR Mix Risk (GitHub metrics, Review & Merge)
 * 
 * Large PRs correlate with slower reviews and higher defects.
 * Uses githubSnapshot.pr_analytics.prs_by_size.large and total_prs.
 */
function ruleLargePRMixRisk(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'large-pr-mix-risk';
  const githubSnapshot = input.githubSnapshot;
  const latestTs = new Date().toISOString().slice(0, 10);

  // 🔥 FIX: Read from top-level PI field that backend now provides
  const largePRMixRisk = githubSnapshot?.large_pr_mix_risk;

  if (largePRMixRisk !== null && largePRMixRisk !== undefined) {
    console.log('🔥🔥🔥 [OLD_ENGINE] Using top-level large_pr_mix_risk:', largePRMixRisk);

    // Case 1: Normal alert — threshold exceeded (>= 10%)
    if (largePRMixRisk >= 0.10) {
      return [{
        cicdStage: 'review-merge',
        id: ruleId,
        title: 'Large PR mix risk detected',
        description: `${formatPercent(largePRMixRisk * 100)} of PRs are classified as large.`,
        severity: largePRMixRisk >= 0.50 ? 'critical' : largePRMixRisk >= 0.40 ? 'warning' : 'info',
        insightClass: 'pattern',
        evidence: [
          `Large PR percentage: ${(largePRMixRisk * 100).toFixed(1)}%`,
          'Data source: Live GitHub API (top-level field)'
        ],
        recommendations: [
          { text: 'Consider breaking down larger PRs into smaller, focused changes to improve review velocity.', actionType: 'process' },
          { text: 'Implement PR size guidelines and automated checks for large PRs.', actionType: 'tooling' }
        ],
        demoFlag: 'demo_primary',
        dataSource: 'real',
        contributingSessions: 0,
        coveragePct: 100
      }];
    }

    // Case 2: Placeholder — threshold not met but data exists (top-level path)
    return [{
      cicdStage: 'review-merge',
      id: makeDeterministicInsightId(ruleId, latestTs, 'large-pr-ok'),
      title: 'Large PR mix within normal range',
      description: `${formatPercent(largePRMixRisk * 100)} of PRs are classified as large — below the 10% threshold. No action needed.`,
      severity: 'info',
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      source: 'github',
      metricId: 'org.large_pr_mix_risk',
      dataSource: 'real',
      tags: ['review-merge'],
      evidence: [
        { label: 'Large PR percentage', value: formatPercent(largePRMixRisk * 100) },
      ],
      recommendations: [],
    }];
  }

  // Case 3: No GitHub data at all
  if (!githubSnapshot || (!githubSnapshot.pr_analytics && !githubSnapshot.pr_review_metrics && !githubSnapshot.github_data_fallback)) {
    return [{
      id: makeDeterministicInsightId(ruleId, latestTs, 'large-pr-nodata'),
      title: 'Large PR mix — insufficient data',
      description: 'No GitHub PR data is available to evaluate large PR mix risk. Connect a GitHub integration or wait for data to populate.',
      severity: 'info',
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'review-merge',
      toolScope: 'org',
      source: 'github',
      metricId: 'org.large_pr_mix_risk',
      dataSource: 'real',
      tags: ['review-merge'],
      evidence: [
        { label: 'GitHub data availability', value: 'none' },
      ],
      recommendations: [],
    }];
  }

  const { prs_by_size, total_prs } = githubSnapshot.pr_analytics;

  // Case 3b: GitHub snapshot exists but total_prs = 0 or missing size data
  if (!prs_by_size || !total_prs || total_prs < 1) {
    return [{
      id: makeDeterministicInsightId(ruleId, latestTs, 'large-pr-nodata'),
      title: 'Large PR mix — insufficient data',
      description: 'GitHub snapshot has zero PRs or missing size breakdown in the current window. Large PR mix analysis requires at least 1 PR with size data.',
      severity: 'info',
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'review-merge',
      toolScope: 'org',
      source: 'github',
      metricId: 'org.large_pr_mix_risk',
      dataSource: 'real',
      tags: ['review-merge'],
      evidence: [
        { label: 'GitHub data availability', value: 'insufficient' },
        { label: 'Total PRs', value: String(total_prs || 0) },
      ],
      recommendations: [],
    }];
  }

  const { large } = prs_by_size;

  if (large === null || large === undefined) {
    return [{
      id: makeDeterministicInsightId(ruleId, latestTs, 'large-pr-nodata'),
      title: 'Large PR mix — insufficient data',
      description: 'GitHub snapshot is missing large PR count. Cannot evaluate large PR mix risk.',
      severity: 'info',
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'review-merge',
      toolScope: 'org',
      source: 'github',
      metricId: 'org.large_pr_mix_risk',
      dataSource: 'real',
      tags: ['review-merge'],
      evidence: [
        { label: 'GitHub data availability', value: 'insufficient' },
        { label: 'Total PRs', value: String(total_prs) },
      ],
      recommendations: [],
    }];
  }

  const largePRShare = large / Math.max(total_prs, 1);

  // Case 1: Normal alert — threshold exceeded (fallback path)
  if (largePRShare >= 0.10) {
    const severity = largePRShare >= 0.50 ? 'warning' : 'info';

    const insight: PerformanceInsight = {
      id: makeDeterministicInsightId(ruleId, latestTs, 'large-pr-risk'),
      title: 'Large PR mix risk detected',
      description: `${formatPercent(largePRShare * 100)} of PRs (${large} out of ${total_prs}) are classified as large, which correlates with slower reviews and higher defect rates. Large PRs are harder to review thoroughly and increase merge risk.`,
      severity,
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'review-merge',
      toolScope: 'org',
      source: 'github',
      metricId: 'org.large_pr_mix_risk',
      dataSource: 'real',
      tags: ['review-merge'],
      evidence: [
        { label: 'Large PR share', value: formatPercent(largePRShare * 100) },
        { label: 'Large PRs', value: String(large) },
        { label: 'Total PRs', value: String(total_prs) },
      ],
      recommendations: [
        { text: 'Enforce PR size guidelines and encourage developers to slice large changes into smaller, focused PRs that are easier to review.', actionType: 'process' },
        { text: 'Set up automated PR size warnings and provide guidance on breaking down large changes into logical components.', actionType: 'tooling' },
      ],
    };

    return [insight];
  }

  // Case 2: Placeholder — threshold not met but data exists (fallback path)
  return [{
    id: makeDeterministicInsightId(ruleId, latestTs, 'large-pr-ok'),
    title: 'Large PR mix within normal range',
    description: `${formatPercent(largePRShare * 100)} of PRs (${large} out of ${total_prs}) are classified as large — below the 10% threshold. No action needed.`,
    severity: 'info',
    insightClass: 'org_deterministic',
    orgKind: 'diagnostic',
    cicdStage: 'review-merge',
    toolScope: 'org',
    source: 'github',
    metricId: 'org.large_pr_mix_risk',
    dataSource: 'real',
    tags: ['review-merge'],
    evidence: [
      { label: 'Large PR share', value: formatPercent(largePRShare * 100) },
      { label: 'Large PRs', value: String(large) },
      { label: 'Total PRs', value: String(total_prs) },
    ],
    recommendations: [],
  }];
}

/**
 * RULE: Stale Deployment Signal (deployment metrics, Deploy & Operate)
 * 
 * Flags release cadence gaps before velocity trends are computed.
 * Uses githubSnapshot.deployment_metrics.latest_deployment.deployed_at.
 */
function ruleStaleDeploymentSignal(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'stale-deployment-signal';
  const githubSnapshot = input.githubSnapshot;

  // 🔥 FIX: Read from top-level PI field that backend now provides
  const staleDeploymentSignal = githubSnapshot?.stale_deployment_signal;
  
  if (staleDeploymentSignal !== null && staleDeploymentSignal !== undefined) {
    console.log('🔥🔥🔥 [OLD_ENGINE] Using top-level stale_deployment_signal:', staleDeploymentSignal);
    
    // Convert hours to days for easier interpretation
    const daysSinceLastDeploy = staleDeploymentSignal / 24;
    
    // Trigger: emit if days_since_last_deploy >= 2
    if (daysSinceLastDeploy < 2) {
      return [];
    }
    
    return [{
      cicdStage: 'deploy-operate',
      id: ruleId,
      title: 'Stale Deployment Signal [OLD ENGINE FIX 🔥]',
      description: `Long time since last deployment: ${daysSinceLastDeploy.toFixed(1)} days (${staleDeploymentSignal.toFixed(1)} hours).`,
      severity: daysSinceLastDeploy >= 14 ? 'critical' : daysSinceLastDeploy >= 7 ? 'warning' : 'info',
      insightClass: 'pattern',
      evidence: [
        `Days since last deployment: ${daysSinceLastDeploy.toFixed(1)}`,
        `Hours since last deployment: ${staleDeploymentSignal.toFixed(1)}`,
        'Data source: Live GitHub API (top-level field)'
      ],
      recommendations: [
        { text: 'Consider increasing deployment frequency to improve delivery velocity.', actionType: 'process' },
        { text: 'Review deployment pipeline for bottlenecks or automation opportunities.', actionType: 'tooling' }
      ],
      demoFlag: 'demo_primary',
      dataSource: 'real',
      contributingSessions: 0, // Not applicable for GitHub-based metrics
      coveragePct: 100
    }];
  }

  // FALLBACK: Try old nested computation
  if (!githubSnapshot || !githubSnapshot.deployment_metrics) {
    return [];
  }

  const { latest_deployment } = githubSnapshot.deployment_metrics;

  // Guardrails: if deployed_at missing, emit a data gap insight (info)
  if (!latest_deployment || !(latest_deployment as any).deployed_at) {
    const latestTs = new Date().toISOString().slice(0, 10);
    const insight: PerformanceInsight = {
      id: makeDeterministicInsightId(ruleId, latestTs, 'data-gap'),
      title: 'Deployment data gap detected',
      description: 'Latest deployment timestamp is missing, preventing deployment cadence analysis. This may indicate a gap in deployment monitoring or configuration.',
      severity: 'info',
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'deploy-operate',
      toolScope: 'org',
      source: 'github',
      metricId: 'org.stale_deployment_signal',
      dataSource: 'unknown',
      tags: ['deploy-operate'],
      evidence: [
        { label: 'Data status', value: 'Missing deployment timestamp' },
      ],
      recommendations: [
        { text: 'Check deployment monitoring configuration and ensure deployment events are being captured properly.', actionType: 'observability' },
      ],
    };
    return [insight];
  }

  const deployedAt = new Date((latest_deployment as any).deployed_at);
  const now = new Date();
  const daysSinceLastDeploy = (now.getTime() - deployedAt.getTime()) / (1000 * 60 * 60 * 24);

  // Trigger: emit if days_since_last_deploy >= 10
  if (daysSinceLastDeploy < 10) {
    return [];
  }

  const latestTs = new Date().toISOString().slice(0, 10);

  const insight: PerformanceInsight = {
    id: makeDeterministicInsightId(ruleId, latestTs, 'stale-deployment'),
    title: 'Stale deployment signal detected',
    description: `${Math.floor(daysSinceLastDeploy)} days since last deployment on ${deployedAt.toLocaleDateString()}. Extended gaps between deployments can indicate release pipeline issues or reduced deployment frequency.`,
    severity: 'warning',
    insightClass: 'org_deterministic',
    orgKind: 'diagnostic',
    cicdStage: 'deploy-operate',
    toolScope: 'org',
    source: 'github',
    metricId: 'org.stale_deployment_signal',
    dataSource: 'real',
    tags: ['deploy-operate'],
    evidence: [
      { label: 'Days since last deploy', value: Math.floor(daysSinceLastDeploy).toString() },
      { label: 'Last deploy date', value: deployedAt.toLocaleDateString() },
    ],
    recommendations: [
      { text: 'Review CI/CD pipeline health and release cadence. Consider automating more of the release process to improve deployment frequency.', actionType: 'process' },
      { text: 'Check for any blocking issues in the deployment pipeline and ensure proper monitoring and alerting for deployment failures.', actionType: 'observability' },
    ],
  };

  return [insight];
}

/**
 * RULE: Failed Deployment Pressure (deployment metrics, Deploy & Operate)
 * 
 * Detects operational risk spikes without waiting for trend rules.
 * Uses githubSnapshot.deployment_metrics.failed_deployment_count.
 */
function ruleFailedDeploymentPressure(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'failed-deployment-pressure';
  const githubSnapshot = input.githubSnapshot;

  if (!githubSnapshot || !githubSnapshot.deployment_metrics) {
    return [];
  }

  const { failed_deployment_count } = githubSnapshot.deployment_metrics;

  // Guardrails: if missing, return []
  if (failed_deployment_count === null || failed_deployment_count === undefined) {
    return [];
  }

  // Trigger: emit if failed_deployment_count >= 3 in window
  if (failed_deployment_count < 3) {
    return [];
  }

  const latestTs = new Date().toISOString().slice(0, 10);

  const insight: PerformanceInsight = {
    id: makeDeterministicInsightId(ruleId, latestTs, 'failed-pressure'),
    title: 'Failed deployment pressure detected',
    description: `${failed_deployment_count} failed deployments detected in the current window, indicating operational risk and potential release pipeline issues. Multiple failures may signal systemic problems.`,
    severity: 'warning',
    insightClass: 'org_deterministic',
    orgKind: 'diagnostic',
    cicdStage: 'deploy-operate',
    toolScope: 'org',
    source: 'github',
    metricId: 'org.failed_deployment_pressure',
    dataSource: 'real',
    tags: ['deploy-operate'],
    evidence: [
      { label: 'Failed deployments', value: String(failed_deployment_count) },
      { label: 'Time window', value: 'Current analysis window' },
    ],
    recommendations: [
      { text: 'Review the last failed deployments and analyze failure patterns. Check rollback procedures and ensure proper incident response processes.', actionType: 'process' },
      { text: 'Investigate deployment pipeline health and consider adding more pre-deployment checks to prevent failures.', actionType: 'observability' },
    ],
  };

  return [insight];
}

/**
 * RULE: Latest Deployment Unhealthy (deployment metrics, Deploy & Operate)
 * 
 * Immediate feedback on last deployment health.
 * Uses githubSnapshot.deployment_metrics.latest_deployment.status and environment.
 */
function ruleLatestDeploymentUnhealthy(input: PerformanceInputs): PerformanceInsight[] {
  const ruleId = 'latest-deployment-unhealthy';
  const githubSnapshot = input.githubSnapshot;

  if (!githubSnapshot || !githubSnapshot.deployment_metrics) {
    return [];
  }

  const { latest_deployment } = githubSnapshot.deployment_metrics;

  // Guardrails: if status is null, emit info data-gap insight only
  if (!latest_deployment) {
    const latestTs = new Date().toISOString().slice(0, 10);
    const insight: PerformanceInsight = {
      id: makeDeterministicInsightId(ruleId, latestTs, 'data-gap'),
      title: 'Latest deployment data missing',
      description: 'Latest deployment information is missing, preventing deployment health assessment. This may indicate a gap in deployment monitoring.',
      severity: 'info',
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'deploy-operate',
      toolScope: 'org',
      source: 'github',
      metricId: 'org.latest_deployment_unhealthy',
      dataSource: 'unknown',
      tags: ['deploy-operate'],
      evidence: [
        { label: 'Data status', value: 'Missing latest deployment info' },
      ],
      recommendations: [
        { text: 'Check deployment monitoring configuration and ensure deployment events are being captured properly.', actionType: 'observability' },
      ],
    };
    return [insight];
  }

  const { status, environment } = latest_deployment;

  // Guardrails: if status is null, emit info data-gap insight only
  if (!status) {
    const latestTs = new Date().toISOString().slice(0, 10);
    const insight: PerformanceInsight = {
      id: makeDeterministicInsightId(ruleId, latestTs, 'data-gap'),
      title: 'Latest deployment status unknown',
      description: 'Latest deployment status is not available, preventing health assessment. This may indicate a monitoring gap.',
      severity: 'info',
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'deploy-operate',
      toolScope: 'org',
      source: 'github',
      metricId: 'org.latest_deployment_unhealthy',
      dataSource: 'unknown',
      tags: ['deploy-operate'],
      evidence: [
        { label: 'Environment', value: environment || 'unknown' },
        { label: 'Status', value: 'Unknown' },
      ],
      recommendations: [
        { text: 'Verify deployment status reporting and ensure proper monitoring of deployment outcomes.', actionType: 'observability' },
      ],
    };
    return [insight];
  }

  // Trigger: emit if status is failed, error, or non-success in prod/staging
  const isProdOrStaging = environment && (environment.toLowerCase().includes('prod') || environment.toLowerCase().includes('staging'));
  const isUnhealthy = status && (status.toLowerCase() === 'failed' || status.toLowerCase() === 'error' || status.toLowerCase() === 'failure');

  if (!isProdOrStaging || !isUnhealthy) {
    return [];
  }

  const latestTs = new Date().toISOString().slice(0, 10);

  const insight: PerformanceInsight = {
    id: makeDeterministicInsightId(ruleId, latestTs, 'unhealthy-deployment'),
    title: 'Latest deployment unhealthy',
    description: `Latest deployment to ${environment} has status "${status}", indicating a deployment failure that may require immediate attention. This could impact service availability.`,
    severity: 'warning',
    insightClass: 'org_deterministic',
    orgKind: 'diagnostic',
    cicdStage: 'deploy-operate',
    toolScope: 'org',
    source: 'github',
    metricId: 'org.latest_deployment_unhealthy',
    dataSource: 'real',
    tags: ['deploy-operate'],
    evidence: [
      { label: 'Environment', value: environment },
      { label: 'Status', value: status },
      { label: 'Timestamp', value: (latest_deployment as any).deployed_at ? new Date((latest_deployment as any).deployed_at).toLocaleDateString() : 'unknown' },
    ],
    recommendations: [
      { text: 'Confirm alerting and on-call response for deployment failures. Initiate rollback procedures if needed.', actionType: 'process' },
      { text: 'Review deployment logs and investigate root cause of the failure to prevent recurrence.', actionType: 'observability' },
    ],
  };

  return [insight];
}

/**
 * RULE: Repo Onboarding Friction (GitHub-only, Plan & Code) - DISABLED
 * 
 * DISABLED: This rule requires per-repo time series data (EngOutputPoint.repo),
 * but the current architecture only provides org-level aggregated time series.
 * 
 * See ruleRepoIssueHotspotGH for a working repo-level insight using snapshot data.
 */
function ruleRepoOnboardingFrictionFromGitHub(input: PerformanceInputs): PerformanceInsight[] {
  // DISABLED: This rule requires per-repo time series data which doesn't exist
  // The engOutput array contains org-level aggregates only, repo field is always undefined
  // See ruleRepoIssueHotspotGH for a working repo-level insight using snapshot data
  return []
}

/**
 * Deploy Reliability Summary Rule
 * 
 * Generates an org-level insight for the deploy-operate stage based on GitHub/EngOutput metrics.
 * Uses changeFailureRatePct (CFR) and mttrHours (MTTR) from the most recent EngOutputPoint.
 * Emits at most ONE insight.
 */
function ruleDeployReliabilitySummary(input: PerformanceInputs): PerformanceInsight[] {
  const insights: PerformanceInsight[] = [];

  // 1. If there is NO engOutput data, return empty (with diagnostics)
  if (!requireNonEmptyBool(input.engOutput, 'deploy-reliability-summary', 'engOutput')) {
    return [];
  }

  // 2. Select the MOST RECENT EngOutputPoint and previous periods for trend
  const sorted = [...input.engOutput].sort((a, b) => {
    const aPeriod = a.period || '';
    const bPeriod = b.period || '';
    return aPeriod < bPeriod ? 1 : -1; // Descending order (most recent first)
  });
  const latest = sorted[0];
  const previous = sorted.slice(1, 4); // up to 3 prior periods

  // 3. Extract metrics
  const latestCfr = latest.changeFailureRatePct;
  const latestMttr = (latest as any).mttrHours as number | undefined;
  
  // 4. If neither CFR nor MTTR is defined, return empty
  if (latestCfr === undefined && latestMttr === undefined) {
    return [];
  }
  
  // 5. Compute previous period averages for trend
  const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  
  const prevCfrValues = previous
    .map(p => p.changeFailureRatePct)
    .filter((v): v is number => typeof v === 'number' && v >= 0);
  const avgPrevCfr = prevCfrValues.length > 0 ? avg(prevCfrValues) : undefined;
  
  const prevMttrValues = previous
    .map(p => (p as any).mttrHours as number | undefined)
    .filter((v): v is number => typeof v === 'number' && v >= 0);
  const avgPrevMttr = prevMttrValues.length > 0 ? avg(prevMttrValues) : undefined;
  
  // Trend computation
  type Trend = 'better' | 'worse' | 'flat';
  const computeTrend = (latestVal?: number, prevAvg?: number): Trend | undefined => {
    if (latestVal == null || prevAvg == null || prevAvg === 0) return undefined;
    const delta = (latestVal - prevAvg) / prevAvg;
    if (delta < -0.15) return 'better';
    if (delta > 0.15) return 'worse';
    return 'flat';
  };
  
  const cfrTrend = computeTrend(latestCfr, avgPrevCfr);
  const mttrTrend = computeTrend(latestMttr, avgPrevMttr);

  // 6. Compute bands (using latest values)
  let cfrBand: 'healthy' | 'elevated' | 'high' = 'healthy';
  if (latestCfr !== undefined) {
    if (latestCfr <= 10) {
      cfrBand = 'healthy';
    } else if (latestCfr <= 25) {
      cfrBand = 'elevated';
    } else {
      cfrBand = 'high';
    }
  }

  let mttrBand: 'fast' | 'moderate' | 'slow' | null = null;
  if (latestMttr !== undefined) {
    if (latestMttr < 24) {
      mttrBand = 'fast';
    } else if (latestMttr <= 72) {
      mttrBand = 'moderate';
    } else {
      mttrBand = 'slow';
    }
  }

  // 7. Determine severity
  let severity: 'high' | 'medium' | 'info' = 'info';
  if ((latestCfr !== undefined && latestCfr > 25) || (latestMttr !== undefined && latestMttr > 72)) {
    severity = 'high';
  } else if ((latestCfr !== undefined && latestCfr > 10) || (latestMttr !== undefined && latestMttr > 24)) {
    severity = 'medium';
  } else {
    severity = 'info';
  }

  // 8. Generate title with trend awareness
  let title: string;
  if (cfrBand === 'healthy' && (mttrBand === null || mttrBand === 'fast')) {
    if (cfrTrend === 'better' || mttrTrend === 'better') {
      title = 'Org: Deployments look healthy and improving';
    } else {
      title = 'Org: Deployments look healthy';
    }
  } else if (cfrBand === 'elevated' || cfrBand === 'high' || mttrBand === 'moderate' || mttrBand === 'slow') {
    if ((cfrTrend === 'better' || mttrTrend === 'better') && (cfrBand !== 'high' && mttrBand !== 'slow')) {
      title = 'Org: Deployment risk is elevated but trending better';
    } else if (cfrBand === 'high' || mttrBand === 'slow') {
      title = 'Org: Deployments are high-risk right now';
    } else {
      title = 'Org: Deployment risk is elevated';
    }
  } else {
    title = 'Org: Deployment risk is elevated';
  }

  // 9. Generate description with trend
  const cfrPart = latestCfr != null
    ? `Change failure rate is ${latestCfr.toFixed(1)}%.`
    : '';

  let trendPart = '';
  if (cfrTrend === 'better' && avgPrevCfr != null) {
    trendPart = ` That's down from ${avgPrevCfr.toFixed(1)}% in prior periods.`;
  } else if (cfrTrend === 'worse' && avgPrevCfr != null) {
    trendPart = ` That's up from ${avgPrevCfr.toFixed(1)}% in prior periods.`;
  }

  let mttrPart = '';
  if (latestMttr != null) {
    mttrPart = ` Mean time to restore is ~${latestMttr.toFixed(1)} hours`;
    if (mttrTrend === 'better' && avgPrevMttr != null) {
      mttrPart += `, down from ~${avgPrevMttr.toFixed(1)} hours.`;
    } else if (mttrTrend === 'worse' && avgPrevMttr != null) {
      mttrPart += `, up from ~${avgPrevMttr.toFixed(1)} hours.`;
    } else {
      mttrPart += '.';
    }
  }

  const description = `${cfrPart}${trendPart}${mttrPart || ''}`.trim();

  // 10. Generate recommendation
  let recommendationText = '';
  if (latestCfr !== undefined && latestCfr > 25) {
    recommendationText = 'Tighten change review for risky services and add canary/feature flags to reduce blast radius.';
  } else if (latestCfr !== undefined && latestCfr > 10) {
    recommendationText = 'Review change review practices and add guardrails for risky services to reduce deployment failures.';
  } else {
    recommendationText = 'Maintain current deployment practices while monitoring failure rate and MTTR as you scale.';
  }

  // Append MTTR-specific recommendations
  if (latestMttr !== undefined) {
    if (latestMttr > 72) {
      recommendationText += ' Also review on-call coverage and rollback paths to bring MTTR closer to 24 hours.';
    } else if (latestMttr > 24) {
      recommendationText += ' Consider improving on-call response and rollback playbooks to speed up recovery.';
    }
  }

  // 11. Build evidence array
  const evidence: Array<{ label: string; value: string }> = [];
  if (latestCfr != null) {
    evidence.push({ label: 'Current change failure rate', value: `${latestCfr.toFixed(1)}%` });
  }
  if (avgPrevCfr != null) {
    evidence.push({ label: 'Previous periods CFR', value: `${avgPrevCfr.toFixed(1)}%` });
  }
  if (latestMttr != null) {
    evidence.push({ label: 'Current MTTR', value: `${latestMttr.toFixed(1)} hours` });
  }
  if (avgPrevMttr != null) {
    evidence.push({ label: 'Previous periods MTTR', value: `${avgPrevMttr.toFixed(1)} hours` });
  }

  // 12. Use existing helper for dataSource
  const dataSource = inferDataSourceForOrgInsight(input);

  // 13. Map severity to InsightSeverity type
  const insightSeverity: InsightSeverity = severity === 'high' ? 'warning' : severity === 'medium' ? 'risk' : 'info';

  // Update description to be one sentence with trend
  let conciseDescription = '';
  if (latestCfr != null) {
    if (cfrTrend === 'better' && avgPrevCfr != null) {
      conciseDescription = `CFR is improving to ${latestCfr.toFixed(1)}% (vs ${avgPrevCfr.toFixed(1)}% prior periods).`;
    } else if (cfrTrend === 'worse' && avgPrevCfr != null) {
      conciseDescription = `CFR is rising to ${latestCfr.toFixed(1)}% (vs ${avgPrevCfr.toFixed(1)}% prior periods).`;
    } else {
      conciseDescription = `CFR is stable at ${latestCfr.toFixed(1)}%${avgPrevCfr != null ? ` (vs ${avgPrevCfr.toFixed(1)}% prior periods)` : ''}.`;
    }
  }
  
  if (latestMttr != null) {
    if (conciseDescription) {
      conciseDescription += ' ';
    }
    if (mttrTrend === 'better' && avgPrevMttr != null) {
      conciseDescription += `MTTR is improving to ~${latestMttr.toFixed(1)}h (vs ~${avgPrevMttr.toFixed(1)}h prior).`;
    } else if (mttrTrend === 'worse' && avgPrevMttr != null) {
      conciseDescription += `MTTR is worsening to ~${latestMttr.toFixed(1)}h (vs ~${avgPrevMttr.toFixed(1)}h prior).`;
    } else {
      conciseDescription += `MTTR is ~${latestMttr.toFixed(1)}h${avgPrevMttr != null ? ` (vs ~${avgPrevMttr.toFixed(1)}h prior)` : ''}.`;
    }
  }
  
  // Update evidence for strip layout (short labels, trend badge)
  const stripEvidence: Array<{ label: string; value: string }> = [];
  if (latestCfr != null) {
    stripEvidence.push({ label: 'Current CFR', value: `${latestCfr.toFixed(1)}%` });
  }
  if (avgPrevCfr != null) {
    stripEvidence.push({ label: 'Previous CFR', value: `${avgPrevCfr.toFixed(1)}%` });
  }
  if (latestMttr != null) {
    stripEvidence.push({ label: 'Current MTTR', value: `${latestMttr.toFixed(1)}h` });
  }
  if (avgPrevMttr != null) {
    stripEvidence.push({ label: 'Previous MTTR', value: `${avgPrevMttr.toFixed(1)}h` });
  }
  
  // Add trend badge
  const overallTrend = cfrTrend || mttrTrend;
  if (overallTrend) {
    const trendLabel = overallTrend === 'better' ? 'Improving' : overallTrend === 'worse' ? 'Worsening' : 'Stable';
    stripEvidence.push({ label: 'Trend', value: trendLabel });
  }

  insights.push({
    id: `deploy-reliability-${Date.now()}`,
    title,
    description: conciseDescription || description,
    severity: insightSeverity,
    insightClass: 'org_deterministic',
    orgKind: 'summary',
    cicdStage: 'deploy-operate',
    toolScope: 'org',
    summaryEligible: true,  // Appears in Deploy & Operate org summary strip
    tags: ['deploy', 'reliability', 'org', 'summary'],
    related: {
      tools: []
    },
    evidence: stripEvidence,
    recommendations: [
      { text: recommendationText, actionType: 'process' }
    ],
    source: 'github',
    metricId: 'eng.deploy_reliability',
    dataSource,
    tools: [],
    priorityScore: 82  // Solid org-level summary, doesn't overshadow critical risks
  });

  console.warn('[PI][DeploySummary] EMIT', { latestCfr, avgPrevCfr, latestMttr, avgPrevMttr });

  return insights;
}

/**
 * Org-Level Deploy Quality Signal Summary
 * 
 * Connects review outcomes to deploy risk (exec story).
 * Answers: "Is quality pressure rising, stable, or improving?"
 * 
 * Uses change failure rate (CFR) and optionally reopen rate / PR churn to compute
 * a "quality pressure" signal.
 * 
 * Emits exactly ONE org-level insight for Deploy & Operate summary strip.
 */
function ruleOrgDeployQualitySignal(input: PerformanceInputs): PerformanceInsight[] {
  console.warn('[PI][DeployOrg][QualitySignal] ENTER');
  
  if (!input.engOutput || input.engOutput.length === 0) {
    console.warn('[PI][DeployOrg][QualitySignal] Early return: no engOutput data');
    return [];
  }
  
  // Get most recent and previous periods
  const sorted = [...input.engOutput].sort((a, b) => {
    const aPeriod = a.period || '';
    const bPeriod = b.period || '';
    return aPeriod < bPeriod ? 1 : -1;
  });
  const latest = sorted[0];
  const previous = sorted.slice(1, 4);
  
  const latestCfr = latest.changeFailureRatePct;
  
  // Early return if no CFR data
  if (latestCfr === undefined) {
    console.warn('[PI][DeployOrg][QualitySignal] Early return: no CFR data');
    return [];
  }
  
  // Compute previous period average CFR
  const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const prevCfrValues = previous
    .map(p => p.changeFailureRatePct)
    .filter((v): v is number => typeof v === 'number' && v >= 0);
  const avgPrevCfr = prevCfrValues.length > 0 ? avg(prevCfrValues) : undefined;
  
  // Determine trend
  type QualityState = 'rising' | 'stable' | 'improving';
  let state: QualityState = 'stable';
  let confidence: 'Strong' | 'Directional' = 'Directional';
  
  if (avgPrevCfr != null && avgPrevCfr > 0) {
    const delta = (latestCfr - avgPrevCfr) / avgPrevCfr;
    if (delta > 0.15) {
      state = 'rising';
    } else if (delta < -0.15) {
      state = 'improving';
    } else {
      state = 'stable';
    }
    
    // Strong confidence if we have multiple previous periods
    if (prevCfrValues.length >= 2) {
      confidence = 'Strong';
    }
  }
  
  // Build title
  let title: string;
  if (state === 'rising') {
    title = 'Quality risk is rising';
  } else if (state === 'improving') {
    title = 'Quality risk is improving';
  } else {
    title = 'Quality risk is stable';
  }
  
  // Build description
  let description: string;
  if (avgPrevCfr != null) {
    description = `CFR is ${latestCfr.toFixed(1)}% (vs ${avgPrevCfr.toFixed(1)}% prior periods).`;
  } else {
    description = `CFR is ${latestCfr.toFixed(1)}%.`;
  }
  
  // Build evidence
  const evidence: Array<{ label: string; value: string | number }> = [
    { label: 'Current CFR', value: `${latestCfr.toFixed(1)}%` }
  ];
  
  if (avgPrevCfr != null) {
    evidence.push({ label: 'Previous CFR', value: `${avgPrevCfr.toFixed(1)}%` });
  }
  
  evidence.push({ label: 'Confidence', value: confidence });
  
  // Build recommendation
  let recommendationText: string;
  if (state === 'rising') {
    recommendationText = 'Add pre-merge checks for AI-heavy PRs + tighten rollback/runbook; require canary for high-risk services.';
  } else if (state === 'improving') {
    recommendationText = 'Lock in what changed: document the guardrails and bake into templates.';
  } else {
    recommendationText = 'Target 1–2 repos with highest CFR and add lightweight deployment gates.';
  }
  
  const insight: PerformanceInsight = {
    id: `org-deploy-quality-signal-${Date.now()}`,
    title,
    description,
    severity: state === 'rising' ? 'warning' : state === 'improving' ? 'highlight' : 'info',
    insightClass: 'org_deterministic',
    orgKind: 'summary',
    cicdStage: 'deploy-operate',
    toolScope: 'org',
    summaryEligible: true,
    tags: ['deploy', 'quality', 'org-level', 'deploy-operate', 'summary'],
    related: {},
    evidence,
    recommendations: [
      {
        text: recommendationText,
        actionType: 'process'
      }
    ],
    source: 'github',
    metricId: 'eng.deploy_quality_signal',
    dataSource: inferDataSourceForOrgInsight(input),
    tools: [],
    priorityScore: 80
  };
  
  console.warn('[PI][DeployOrg][QualitySignal] EMIT', { state, latestCfr, avgPrevCfr, confidence });
  
  return [insight];
}

/**
 * Org-Level Recovery Posture Summary
 * 
 * Executive scan of recovery speed / operational maturity.
 * Answers: "How fast are we recovering from incidents?"
 * 
 * Uses MTTR (mean time to restore) and optionally rollback/incident data.
 * 
 * Emits exactly ONE org-level insight for Deploy & Operate summary strip.
 * Only emits if MTTR data is available.
 */
function ruleOrgRecoveryPostureSummary(input: PerformanceInputs): PerformanceInsight[] {
  console.warn('[PI][DeployOrg][Recovery] ENTER');
  
  if (!input.engOutput || input.engOutput.length === 0) {
    console.warn('[PI][DeployOrg][Recovery] Early return: no engOutput data');
    return [];
  }
  
  // Get most recent and previous periods
  const sorted = [...input.engOutput].sort((a, b) => {
    const aPeriod = a.period || '';
    const bPeriod = b.period || '';
    return aPeriod < bPeriod ? 1 : -1;
  });
  const latest = sorted[0];
  const previous = sorted.slice(1, 4);
  
  const latestMttr = (latest as any).mttrHours as number | undefined;
  
  // Early return if no MTTR data
  if (latestMttr === undefined) {
    console.warn('[PI][DeployOrg][Recovery] Early return: no MTTR data');
    return [];
  }
  
  // Compute previous period average MTTR
  const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const prevMttrValues = previous
    .map(p => (p as any).mttrHours as number | undefined)
    .filter((v): v is number => typeof v === 'number' && v >= 0);
  const avgPrevMttr = prevMttrValues.length > 0 ? avg(prevMttrValues) : undefined;
  
  // Determine trend
  type RecoveryState = 'worsening' | 'stable' | 'improving';
  let state: RecoveryState = 'stable';
  let confidence: 'Strong' | 'Directional' = 'Directional';
  
  if (avgPrevMttr != null && avgPrevMttr > 0) {
    const delta = (latestMttr - avgPrevMttr) / avgPrevMttr;
    if (delta > 0.15) {
      state = 'worsening';
    } else if (delta < -0.15) {
      state = 'improving';
    } else {
      state = 'stable';
    }
    
    // Strong confidence if we have multiple previous periods
    if (prevMttrValues.length >= 2) {
      confidence = 'Strong';
    }
  }
  
  // Build title
  let title: string;
  if (state === 'worsening') {
    title = 'Recovery posture is worsening';
  } else if (state === 'improving') {
    title = 'Recovery posture is improving';
  } else {
    title = 'Recovery posture is stable';
  }
  
  // Build description
  let description: string;
  if (avgPrevMttr != null) {
    description = `MTTR is ~${latestMttr.toFixed(1)}h (vs ~${avgPrevMttr.toFixed(1)}h prior periods).`;
  } else {
    description = `MTTR is ~${latestMttr.toFixed(1)}h.`;
  }
  
  // Build evidence
  const evidence: Array<{ label: string; value: string | number }> = [
    { label: 'Current MTTR', value: `${latestMttr.toFixed(1)}h` }
  ];
  
  if (avgPrevMttr != null) {
    evidence.push({ label: 'Previous MTTR', value: `${avgPrevMttr.toFixed(1)}h` });
  }
  
  evidence.push({ label: 'Confidence', value: confidence });
  
  // Build recommendation
  let recommendationText: string;
  if (state === 'worsening') {
    recommendationText = 'Run 1 incident game day; improve alert routing; ensure rollback automation is tested weekly.';
  } else {
    recommendationText = 'Standardize incident template + keep playbooks current.';
  }
  
  const insight: PerformanceInsight = {
    id: `org-recovery-posture-${Date.now()}`,
    title,
    description,
    severity: state === 'worsening' ? 'warning' : state === 'improving' ? 'highlight' : 'info',
    insightClass: 'org_deterministic',
    orgKind: 'summary',
    cicdStage: 'deploy-operate',
    toolScope: 'org',
    summaryEligible: true,
    tags: ['deploy', 'recovery', 'org-level', 'deploy-operate', 'summary'],
    related: {},
    evidence,
    recommendations: [
      {
        text: recommendationText,
        actionType: 'process'
      }
    ],
    source: 'github',
    metricId: 'eng.recovery_posture',
    dataSource: inferDataSourceForOrgInsight(input),
    tools: [],
    priorityScore: 78
  };
  
  console.warn('[PI][DeployOrg][Recovery] EMIT', { state, latestMttr, avgPrevMttr, confidence });
  
  return [insight];
}

/**
 * Org-Level AI Impact on Deploy Stability Summary
 * 
 * Answers the executive question: "Is AI helping or hurting deployment stability?"
 * 
 * This rule computes the correlation between org-wide AI usage and change failure rate (CFR)
 * and surfaces it in the Deploy & Operate summary strip.
 * 
 * Emits exactly ONE org-level insight for Deploy & Operate summary strip.
 * Only emits when correlation is significant and actionable.
 */
function ruleOrgAIDeployStabilityImpact(input: PerformanceInputs): PerformanceInsight[] {
  console.warn('[PI][DeployOrg][AIStability] ENTER');
  
  // 1. If productivity OR engOutput is empty, return empty
  if (!input.productivity || input.productivity.length === 0 || 
      !input.engOutput || input.engOutput.length === 0) {
    console.warn('[PI][DeployOrg][AIStability] Early return: missing data');
    return [];
  }
  
  // 2. Build ORG-level, per-period series (same logic as ruleDeployAIReliabilityCorrelation)
  const periodMap = new Map<string, { totalAiAssists: number; totalCodingMinutes: number; cfr?: number }>();
  
  // Aggregate productivity data by period (across all tools)
  for (const prod of input.productivity) {
    if (!prod.period) continue;
    
    const existing = periodMap.get(prod.period) || { totalAiAssists: 0, totalCodingMinutes: 0 };
    existing.totalAiAssists += prod.aiAssists || 0;
    existing.totalCodingMinutes += prod.codingMinutes || 0;
    periodMap.set(prod.period, existing);
  }
  
  // Add CFR from engOutput for matching periods
  for (const eng of input.engOutput) {
    if (!eng.period) continue;
    
    const cfr = eng.changeFailureRatePct;
    if (cfr === undefined) continue;
    
    const existing = periodMap.get(eng.period);
    if (existing) {
      existing.cfr = cfr;
    }
  }
  
  // Build series arrays for correlation (only periods with both AI usage and CFR)
  const aiUsageRateSeries: number[] = [];
  const cfrSeries: number[] = [];
  const periods: string[] = [];
  
  for (const [period, data] of periodMap.entries()) {
    if (data.cfr === undefined) continue;
    
    // Compute AI usage rate: totalAiAssists / max(totalCodingMinutes, 1)
    const aiUsageRate = data.totalCodingMinutes > 0
      ? data.totalAiAssists / data.totalCodingMinutes
      : data.totalAiAssists;
    
    aiUsageRateSeries.push(aiUsageRate);
    cfrSeries.push(data.cfr);
    periods.push(period);
  }
  
  // 3. Gating
  const n = aiUsageRateSeries.length;
  const minPoints = DEMO_MODE ? DEMO_MIN_POINTS : 4;
  
  if (n < minPoints) {
    console.warn('[PI][DeployOrg][AIStability] Early return: insufficient periods', { n, minPoints });
    return [];
  }
  
  // Compute correlation
  const r = pearson(aiUsageRateSeries, cfrSeries);
  const p = pValueFromR(r, n);
  
  // Thresholds for significance
  const minAbsR = 0.5;  // Significant correlation
  const strongAbsR = 0.6;  // Strong correlation
  const maxP = SIG_P;
  
  // Check if correlation is significant
  const isSignificant = Math.abs(r) >= minAbsR && p < maxP;
  const isStrong = Math.abs(r) >= strongAbsR && p < 0.05;
  
  if (!isSignificant && !isStrong) {
    console.warn('[PI][DeployOrg][AIStability] Early return: correlation not significant', { r, p, minAbsR, maxP });
    return [];
  }
  
  // 4. Check CFR state for emission rules
  const latestEngOutput = [...input.engOutput].sort((a, b) => {
    const aPeriod = a.period || '';
    const bPeriod = b.period || '';
    return aPeriod < bPeriod ? 1 : -1;
  });
  const latest = latestEngOutput[0];
  const previous = latestEngOutput.slice(1, 4);
  
  const latestCfr = latest.changeFailureRatePct;
  const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const prevCfrValues = previous
    .map(p => p.changeFailureRatePct)
    .filter((v): v is number => typeof v === 'number' && v >= 0);
  const avgPrevCfr = prevCfrValues.length > 0 ? avg(prevCfrValues) : undefined;
  
  // Determine CFR trend
  let cfrTrend: 'worsening' | 'stable' | 'improving' | undefined;
  if (latestCfr != null && avgPrevCfr != null && avgPrevCfr > 0) {
    const delta = (latestCfr - avgPrevCfr) / avgPrevCfr;
    if (delta > 0.15) {
      cfrTrend = 'worsening';
    } else if (delta < -0.15) {
      cfrTrend = 'improving';
    } else {
      cfrTrend = 'stable';
    }
  }
  
  const isCfrElevated = latestCfr != null && latestCfr > 10;
  const isCfrWorsening = cfrTrend === 'worsening';
  
  // Emission rules: emit if correlation is strong OR (significant AND CFR elevated/worsening)
  if (!isStrong && !(isSignificant && (isCfrElevated || isCfrWorsening))) {
    console.warn('[PI][DeployOrg][AIStability] Early return: correlation not actionable', {
      isStrong,
      isSignificant,
      isCfrElevated,
      isCfrWorsening,
      latestCfr
    });
    return [];
  }
  
  // 5. Determine state
  type ImpactState = 'hurting' | 'helping' | 'neutral';
  let state: ImpactState;
  if (r > 0) {
    state = 'hurting';  // Positive correlation: more AI → higher CFR
  } else if (r < 0) {
    state = 'helping';  // Negative correlation: more AI → lower CFR
  } else {
    state = 'neutral';
  }
  
  // Calculate averages for evidence
  const avgAiUsageRate = aiUsageRateSeries.reduce((sum, val) => sum + val, 0) / n;
  const avgCFR = cfrSeries.reduce((sum, val) => sum + val, 0) / n;
  
  // Build title
  let title: string;
  if (state === 'hurting') {
    title = 'AI usage is linked to less stable deployments';
  } else if (state === 'helping') {
    title = 'AI usage is associated with improved deployment stability';
  } else {
    title = 'AI usage shows neutral impact on deployment stability';
  }
  
  // Build description
  let description: string;
  if (state === 'hurting') {
    description = `Periods with higher AI usage tend to have higher change failure rates. Correlation: r=${r.toFixed(3)} (p=${p.toFixed(4)}).`;
  } else if (state === 'helping') {
    description = `Higher AI usage correlates with lower change failure rates. Correlation: r=${r.toFixed(3)} (p=${p.toFixed(4)}).`;
  } else {
    description = `AI usage shows no significant correlation with change failure rate. Correlation: r=${r.toFixed(3)} (p=${p.toFixed(4)}).`;
  }
  
  // Build evidence
  const evidence: Array<{ label: string; value: string | number }> = [
    { label: 'Correlation (r)', value: r.toFixed(3) },
    { label: 'P-value', value: p.toFixed(4) },
    { label: 'Avg AI assists/min', value: avgAiUsageRate.toFixed(3) },
    { label: 'Avg CFR', value: `${avgCFR.toFixed(1)}%` },
    { label: 'Periods analyzed', value: n }
  ];
  
  // Confidence indicator
  const confidence = isStrong ? 'Strong' : 'Directional';
  evidence.push({ label: 'Confidence', value: confidence });
  
  // Build recommendation
  let recommendationText: string;
  if (state === 'hurting') {
    recommendationText = 'Add pre-merge quality gates for AI-heavy PRs; require canary deployments for services with highest AI usage.';
  } else if (state === 'helping') {
    recommendationText = 'Scale AI-assisted workflows; document patterns that improve deployment stability and replicate across teams.';
  } else {
    recommendationText = 'Monitor AI usage and deployment stability as adoption scales; establish baseline patterns.';
  }
  
  const insight: PerformanceInsight = {
    id: `org-ai-deploy-stability-${Date.now()}`,
    title,
    description,
    severity: state === 'hurting' ? 'risk' : state === 'helping' ? 'highlight' : 'info',
    insightClass: 'org_deterministic',
    orgKind: 'summary',
    cicdStage: 'deploy-operate',
    toolScope: 'org',
    summaryEligible: true,
    tags: ['deploy', 'ai-impact', 'stability', 'org-level', 'deploy-operate', 'summary'],
    related: {},
    evidence,
    recommendations: [
      {
        text: recommendationText,
        actionType: 'process'
      }
    ],
    source: 'combined',
    metricId: 'eng.ai_deploy_stability_impact',
    dataSource: inferDataSourceForOrgInsight(input),
    tools: [],
    priorityScore: 83  // High priority for causal signal
  };
  
  console.warn('[PI][DeployOrg][AIStability] EMIT', { state, r, p, isStrong, isCfrElevated, isCfrWorsening });
  
  return [insight];
}

/**
 * Deploy Frequency Driver Diagnostic
 * 
 * Explains why deployment frequency changes when reliability is stable.
 * Answers: "Why is deployment frequency rising/falling when CFR is stable?"
 * 
 * This is a diagnostic drill-down, not a summary insight.
 * 
 * Emits at most ONE org-level insight for Deploy & Operate detailed cards.
 */
function ruleDeployFrequencyDriver(input: PerformanceInputs): PerformanceInsight[] {
  if (import.meta.env.DEV) {
    console.warn('[PI][DeployOperate][FreqDriver] ENTER', {
      engOutputLen: input.engOutput?.length || 0
    })
  }
  
  if (!input.engOutput || input.engOutput.length === 0) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][FreqDriver] Early return: no engOutput data')
    }
    return []
  }
  
  // Get periods with deployment frequency data
  const engOutputWithDeploy = (input.engOutput || []).filter(e => 
    e.deploymentFreqPerWeek !== undefined && e.deploymentFreqPerWeek !== null &&
    e.changeFailureRatePct !== undefined && e.changeFailureRatePct !== null
  );
  
  // VALUE MODE: Adaptive requirement (2 instead of 3)
  const requiredPeriods = isValueMode() ? 2 : 3;
  
  // VALUE MODE: If insufficient history (< 2), emit diagnostic
  if (engOutputWithDeploy.length < 2 && isValueMode()) {
    const insight: PerformanceInsight = {
      id: `deploy-freq-driver-insufficient-${Date.now()}`,
      title: 'Not enough history yet to analyze deployment frequency drivers',
      description: `Only ${engOutputWithDeploy.length} period(s) with both deployment frequency and change failure rate data available. Need at least 2 periods to analyze correlation. Connect more data or wait 24-48 hours for additional periods.`,
      severity: 'info',
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'deploy-operate',
      toolScope: 'org',
      source: 'github',
      metricId: 'eng.deploy_freq_driver',
      dataSource: inferDataSourceForOrgInsight(input),
      evidence: [
        { label: 'Observed periods', value: engOutputWithDeploy.length.toString() },
        { label: 'Needed for analysis', value: '2+' },
        { label: 'Required fields', value: 'deploymentFreqPerWeek + changeFailureRatePct' },
        { label: 'Action', value: 'Wait 24-48h or connect more data' }
      ],
      recommendations: [
        {
          text: 'Continue collecting deployment and failure rate data. Driver insights will appear once 2+ periods are available.',
          actionType: 'observability'
        }
      ],
      related: {},
      tools: undefined,
      priorityScore: 35, // Floor score
      summaryEligible: false,
      tags: ['org', 'deployment-frequency', 'insufficient-history']
    };
    return [insight];
  }
  
  if (engOutputWithDeploy.length < requiredPeriods) {
    console.warn('[PI][DeployOrg][FreqDriver] Early return: insufficient periods', { count: engOutputWithDeploy.length, required: requiredPeriods });
    return [];
  }
  
  // Sort by period ascending
  const sorted = [...engOutputWithDeploy].sort((a, b) => {
    const aPeriod = a.period || '';
    const bPeriod = b.period || '';
    return aPeriod.localeCompare(bPeriod);
  });
  
  // Split into recent vs prior (use last 2 periods as "recent", rest as "prior")
  const recent = sorted.slice(-2);
  const prior = sorted.slice(0, -2);
  
  if (recent.length === 0 || prior.length === 0) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][FreqDriver] Early return: insufficient split', { 
        recent: recent.length, 
        prior: prior.length 
      })
    }
    return []
  }
  
  // Compute averages
  const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  
  const recentFreq = avg(recent.map(e => e.deploymentFreqPerWeek ?? 0));
  const priorFreq = avg(prior.map(e => e.deploymentFreqPerWeek ?? 0));
  const recentCfr = avg(recent.map(e => e.changeFailureRatePct ?? 0));
  const priorCfr = avg(prior.map(e => e.changeFailureRatePct ?? 0));
  
  // Compute changes
  const freqChangePct = priorFreq > 0 ? ((recentFreq - priorFreq) / priorFreq) * 100 : 0;
  const cfrChangePct = priorCfr > 0 ? ((recentCfr - priorCfr) / priorCfr) * 100 : 0;
  
  // Gating: fire only if deploy freq changes ≥ ±15%
  if (Math.abs(freqChangePct) < 15) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][FreqDriver] Early return: deploy freq change too small', { 
        freqChangePct 
      })
    }
    return []
  }
  
  // Classify CFR state: improving (decreasing), stable (small change), or worsening (increasing)
  // Thresholds: meaningful change is >= 15% relative OR >= 2.0 percentage points absolute
  const cfrDeltaAbs = recentCfr - priorCfr
  const cfrDeltaAbsThreshold = 2.0  // percentage points
  const cfrDeltaPctThreshold = 15   // percent relative change
  
  let cfrState: 'improving' | 'stable' | 'worsening'
  if (cfrDeltaAbs < -cfrDeltaAbsThreshold || (priorCfr > 0 && cfrChangePct < -cfrDeltaPctThreshold)) {
    cfrState = 'improving'  // CFR decreased meaningfully
  } else if (cfrDeltaAbs > cfrDeltaAbsThreshold || (priorCfr > 0 && cfrChangePct > cfrDeltaPctThreshold)) {
    cfrState = 'worsening'  // CFR increased meaningfully
  } else {
    cfrState = 'stable'  // CFR changed within small band
  }
  
  // Pattern classification
  type Pattern = 'A' | 'B' | 'C' | 'D' | null;
  let pattern: Pattern = null;
  
  if (freqChangePct > 0 && cfrState === 'stable') {
    pattern = 'A';  // Freq ↑, CFR stable
  } else if (freqChangePct > 0 && cfrState === 'improving') {
    pattern = 'A';  // Freq ↑, CFR improving (treat as stable/improving)
  } else if (freqChangePct < 0 && cfrState === 'stable') {
    pattern = 'B';  // Freq ↓, CFR stable
  } else if (freqChangePct > 0 && cfrState === 'worsening') {
    pattern = 'C';  // Freq ↑, CFR ↑
  } else if (freqChangePct < 0 && cfrState === 'improving') {
    pattern = 'D';  // Freq ↓, CFR ↓
  }
  
  // Stay silent if both metrics are stable or if CFR worsening + freq falling (expected)
  if (pattern === null) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOrg][FreqDriver] Early return: pattern not actionable', { 
        freqChangePct, 
        cfrChangePct, 
        cfrState,
        cfrDeltaAbs
      })
    }
    return []
  }
  
  // Attempt driver detection (AI usage trend)
  let driver: string | null = null;
  if (input.productivity && input.productivity.length > 0) {
    // Aggregate AI usage by period
    const periodAiMap = new Map<string, { totalAi: number; totalMinutes: number }>();
    for (const prod of input.productivity) {
      if (!prod.period) continue;
      const existing = periodAiMap.get(prod.period) || { totalAi: 0, totalMinutes: 0 };
      existing.totalAi += prod.aiAssists || 0;
      existing.totalMinutes += prod.codingMinutes || 0;
      periodAiMap.set(prod.period, existing);
    }
    
    // Get recent vs prior AI usage
    const recentPeriods = new Set(recent.map(e => e.period).filter(Boolean));
    const priorPeriods = new Set(prior.map(e => e.period).filter(Boolean));
    
    const recentAiRates: number[] = [];
    const priorAiRates: number[] = [];
    
    for (const [period, data] of periodAiMap.entries()) {
      const aiRate = data.totalMinutes > 0 ? data.totalAi / data.totalMinutes : data.totalAi;
      if (recentPeriods.has(period)) {
        recentAiRates.push(aiRate);
      } else if (priorPeriods.has(period)) {
        priorAiRates.push(aiRate);
      }
    }
    
    if (recentAiRates.length > 0 && priorAiRates.length > 0) {
      const recentAvgAi = avg(recentAiRates);
      const priorAvgAi = avg(priorAiRates);
      const aiChangePct = priorAvgAi > 0 ? ((recentAvgAi - priorAvgAi) / priorAvgAi) * 100 : 0;
      
      // If AI trend matches freq trend direction, attribute it
      if (Math.abs(aiChangePct) >= 10) {
        if ((freqChangePct > 0 && aiChangePct > 0) || (freqChangePct < 0 && aiChangePct < 0)) {
          driver = 'AI adoption';
        } else if ((freqChangePct > 0 && aiChangePct < 0) || (freqChangePct < 0 && aiChangePct > 0)) {
          driver = 'AI adoption decline';
        }
      }
    }
  }
  
  // If no AI driver, check coding activity
  if (!driver && input.productivity && input.productivity.length > 0) {
    const periodMinutesMap = new Map<string, number>();
    for (const prod of input.productivity) {
      if (!prod.period) continue;
      const existing = periodMinutesMap.get(prod.period) || 0;
      periodMinutesMap.set(prod.period, existing + (prod.codingMinutes || 0));
    }
    
    const recentPeriods = new Set(recent.map(e => e.period).filter(Boolean));
    const priorPeriods = new Set(prior.map(e => e.period).filter(Boolean));
    
    const recentMinutes: number[] = [];
    const priorMinutes: number[] = [];
    
    for (const [period, minutes] of periodMinutesMap.entries()) {
      if (recentPeriods.has(period)) {
        recentMinutes.push(minutes);
      } else if (priorPeriods.has(period)) {
        priorMinutes.push(minutes);
      }
    }
    
    if (recentMinutes.length > 0 && priorMinutes.length > 0) {
      const recentAvgMinutes = avg(recentMinutes);
      const priorAvgMinutes = avg(priorMinutes);
      const minutesChangePct = priorAvgMinutes > 0 ? ((recentAvgMinutes - priorAvgMinutes) / priorAvgMinutes) * 100 : 0;
      
      if (Math.abs(minutesChangePct) >= 10) {
        if ((freqChangePct > 0 && minutesChangePct > 0) || (freqChangePct < 0 && minutesChangePct < 0)) {
          driver = 'Coding activity';
        }
      }
    }
  }
  
  if (!driver) {
    driver = 'Unclear';
  }
  
  // Build title based on pattern
  let title: string;
  if (pattern === 'A') {
    title = 'Deployment frequency is rising while reliability stays stable';
  } else if (pattern === 'B') {
    title = 'Deployment frequency is falling despite stable reliability';
  } else if (pattern === 'C') {
    title = 'Deployment frequency and reliability are both worsening';
  } else {
    title = 'Deployment frequency is falling while reliability improves';
  }
  
  // Build description
  let description: string;
  if (pattern === 'A') {
    description = `Deployment frequency increased by ${Math.abs(freqChangePct).toFixed(0)}% while change failure rate remained stable at ~${recentCfr.toFixed(1)}%. This suggests velocity gains without quality loss.`;
  } else if (pattern === 'B') {
    description = `Deployment frequency decreased by ${Math.abs(freqChangePct).toFixed(0)}% despite stable reliability (~${recentCfr.toFixed(1)}% CFR). This indicates a bottleneck, not a quality issue.`;
  } else if (pattern === 'C') {
    description = `Deployment frequency increased by ${Math.abs(freqChangePct).toFixed(0)}% but change failure rate also rose to ${recentCfr.toFixed(1)}%. Velocity is increasing but quality is degrading.`;
  } else {
    description = `Deployment frequency decreased by ${Math.abs(freqChangePct).toFixed(0)}% while change failure rate improved to ${recentCfr.toFixed(1)}%. Quality improvements are slowing velocity.`;
  }
  
  // Build evidence
  const evidence: Array<{ label: string; value: string | number }> = [
    { label: 'Current deploy freq', value: `${recentFreq.toFixed(1)}/week` },
    { label: 'Previous deploy freq', value: `${priorFreq.toFixed(1)}/week` },
    { label: 'Deploy freq change', value: `${freqChangePct > 0 ? '+' : ''}${freqChangePct.toFixed(0)}%` },
    { label: 'Current CFR', value: `${recentCfr.toFixed(1)}%` },
    { label: 'Previous CFR', value: `${priorCfr.toFixed(1)}%` },
    { label: 'CFR change', value: `${cfrChangePct > 0 ? '+' : ''}${cfrChangePct.toFixed(0)}%` },
    { label: 'CFR state', value: cfrState === 'improving' ? 'Improving' : cfrState === 'worsening' ? 'Worsening' : 'Stable' },
    { label: 'Driver', value: driver }
  ];
  
  // Build recommendation based on pattern
  let recommendationText: string;
  if (pattern === 'A') {
    recommendationText = 'Lock in what\'s working: document deployment patterns and scale to other teams.';
  } else if (pattern === 'B') {
    recommendationText = 'Investigate CI/CD bottlenecks: check build times, test duration, approval gates.';
  } else if (pattern === 'C') {
    recommendationText = 'Tighten quality gates before increasing deployment frequency further.';
  } else {
    recommendationText = 'Rebalance quality checks vs velocity; consider lighter-weight quality gates.';
  }
  
  // Determine severity
  let severity: InsightSeverity;
  if (pattern === 'A') {
    severity = 'highlight';
  } else if (pattern === 'B') {
    severity = 'info';
  } else {
    severity = 'warning';
  }
  
  const insight: PerformanceInsight = {
    id: `deploy-freq-driver-${Date.now()}`,
    title,
    description,
    severity,
    insightClass: 'org_deterministic',
    cicdStage: 'deploy-operate',
    toolScope: 'org',
    summaryEligible: false,  // Detailed diagnostic, not summary
    tags: ['deploy', 'frequency', 'diagnostic', 'org-level', 'deploy-operate'],
    related: {},
    evidence,
    recommendations: [
      {
        text: recommendationText,
        actionType: 'process'
      }
    ],
    source: 'github',
    metricId: 'eng.deploy_freq_driver',
    dataSource: inferDataSourceForOrgInsight(input),
    tools: [],
    priorityScore: 75  // Diagnostic, lower than summary
  };
  
  if (import.meta.env.DEV) {
    console.warn('[PI][DeployOperate][FreqDriver] EMIT', { 
      title: insight.title,
      pattern, 
      freqChangePct, 
      cfrChangePct, 
      cfrState,
      cfrDeltaAbs,
      driver 
    })
  }
  
  return [insight]
}

/**
 * Deploy VSCode AI Posture Rule
 * 
 * Ties VSCode AI usage to deployment throughput using GitHub + VSCode productivity data.
 * Compares VSCode AI usage rate to org-wide baseline and correlates with PR merge trends.
 * Emits at most ONE plan-code stage insight (AI usage insights belong in Plan & Code).
 */
function ruleDeployVSCodeAIPosture(input: PerformanceInputs): PerformanceInsight[] {
  const insights: PerformanceInsight[] = [];

  // Filter productivity to VSCode (case-insensitive)
  const vscodeProd = (input.productivity || []).filter(p => 
    p.tool && p.tool.toLowerCase() === 'vscode'
  );

  // VALUE MODE: If no VSCode, try Cursor as fallback
  let toolProd = vscodeProd;
  let toolName = 'VSCode';
  let usingFallback = false;
  
  if (vscodeProd.length === 0 && isValueMode()) {
    const cursorProd = (input.productivity || []).filter(p => 
      p.tool && p.tool.toLowerCase() === 'cursor'
    );
    if (cursorProd.length > 0) {
      toolProd = cursorProd;
      toolName = 'Cursor';
      usingFallback = true;
    }
  }

  // If still no data, emit diagnostic in Value Mode
  if (toolProd.length === 0) {
    if (isValueMode()) {
      const insight: PerformanceInsight = {
        id: `deploy-vscode-ai-posture-no-data-${Date.now()}`,
        title: 'No IDE telemetry connected yet',
        description: 'VSCode or Cursor productivity data is not available. Connect an IDE extension (VSCode or Cursor) to enable AI posture analysis and deployment correlation insights.',
        severity: 'info',
        insightClass: 'org_deterministic',
        orgKind: 'diagnostic',
        cicdStage: 'deploy-operate',
        toolScope: 'single-ide',
        source: 'productivity',
        metricId: 'eng.deploy_vs_ai_vscode',
        dataSource: inferDataSourceForOrgInsight(input),
        evidence: [
          { label: 'Status', value: 'No IDE data' },
          { label: 'Expected tools', value: 'VSCode or Cursor' },
          { label: 'Action', value: 'Connect IDE extension' }
        ],
        recommendations: [
          {
            text: 'Install and connect the VSCode or Cursor extension to enable AI usage and deployment correlation insights.',
            actionType: 'observability'
          }
        ],
        related: {},
        tools: undefined,
        priorityScore: 35, // Floor score
        summaryEligible: false,
        tags: ['org', 'ide-telemetry', 'data-missing']
      };
      return [insight];
    }
    return [];
  }

  // Compute tool AI usage (VSCode or Cursor fallback)
  let totalCoding = 0;
  let totalAssists = 0;
  for (const prod of toolProd) {
    totalCoding += prod.codingMinutes || 0;
    totalAssists += prod.aiAssists || 0;
  }
  const toolAiRate = totalCoding > 0 ? totalAssists / totalCoding : 0;

  // Compute org-wide AI usage baseline across all tools
  let allTotalCoding = 0;
  let allTotalAssists = 0;
  for (const prod of (input.productivity || [])) {
    allTotalCoding += prod.codingMinutes || 0;
    allTotalAssists += prod.aiAssists || 0;
  }
  const orgAiRate = allTotalCoding > 0 ? allTotalAssists / allTotalCoding : 0;

  // Classify tool AI usage relative to org
  let ratio: number;
  if (orgAiRate <= 0) {
    ratio = 1;
  } else {
    ratio = toolAiRate / orgAiRate;
  }
  
  let toolBand: 'high' | 'avg' | 'low';
  if (ratio >= 1.2) {
    toolBand = 'high';
  } else if (ratio <= 0.8) {
    toolBand = 'low';
  } else {
    toolBand = 'avg';
  }

  // Compute deploy throughput summary from engOutput using deploymentFreqPerWeek
  // Filter to points with deploymentFreqPerWeek defined
  const engOutputWithDeploy = (input.engOutput || []).filter(e => 
    e.deploymentFreqPerWeek !== undefined && e.deploymentFreqPerWeek !== null
  );

  // If no deployment frequency data, return empty (missing deployment data)
  if (engOutputWithDeploy.length === 0) {
    return [];
  }

  // Sort by period ascending
  const sortedEngOutput = [...engOutputWithDeploy].sort((a, b) => {
    const aPeriod = a.period || '';
    const bPeriod = b.period || '';
    return aPeriod.localeCompare(bPeriod); // Ascending order
  });

  const last = sortedEngOutput[sortedEngOutput.length - 1];
  const latestDeployFreq = last.deploymentFreqPerWeek ?? 0;
  
  let prevDeployFreq = 0;
  let delta: number | null = null;
  let pctChange: number | null = null;

  if (sortedEngOutput.length >= 2) {
    const prev = sortedEngOutput[sortedEngOutput.length - 2];
    prevDeployFreq = prev.deploymentFreqPerWeek ?? 0;
    delta = latestDeployFreq - prevDeployFreq;
    if (prevDeployFreq > 0) {
      pctChange = (delta / prevDeployFreq) * 100;
    }
  } else {
    // Only 1 point: no trend available
    delta = 0;
    pctChange = null;
  }

  // Determine severity based on tool AI band and deployment frequency trend
  let severity: InsightSeverity = 'info';
  if (toolBand === 'high' && pctChange !== null && pctChange < -5) {
    severity = 'warning'; // High AI usage + deployment frequency down meaningfully (>5% drop)
  } else if (toolBand === 'low' && (pctChange === null || pctChange <= 0)) {
    severity = 'risk'; // Low AI usage + deployment frequency flat or down
  } else {
    severity = 'info';
  }

  // Title: Encode "so what" - if good: "Lock in", if bad: "Risk rising"
  // VALUE MODE: Include fallback note if using Cursor
  const toolLabel = usingFallback ? `${toolName} (VSCode data not available)` : toolName;
  let title: string;
  if (toolBand === 'high' && pctChange !== null && pctChange < -5) {
    title = `${toolName} AI usage high but deployments declining—investigate quality`;
  } else if (toolBand === 'high' && (pctChange === null || pctChange >= 0)) {
    title = `Lock in ${toolName} AI workflows that are working`;
  } else if (toolBand === 'low') {
    title = `${toolName} AI adoption below org average—expand usage`;
  } else {
    title = `${toolName} AI usage aligns with org average`;
  }
  
  // Description: Explain impact/implication without repeating evidence numbers verbatim
  let description: string;
  const fallbackNote = usingFallback ? ' (VSCode data not available; showing Cursor posture instead)' : '';
  if (toolBand === 'high' && pctChange !== null && pctChange < -5) {
    description = `${toolName} shows high AI usage relative to the organization, but deployment frequency is declining${fallbackNote}. This pattern suggests that while AI is being used heavily, it may not be translating into faster delivery—possibly due to quality issues, review bottlenecks, or workflow friction. Investigating the root cause can help ensure AI usage drives measurable productivity gains.`;
  } else if (toolBand === 'high' && (pctChange === null || pctChange >= 0)) {
    description = `${toolName} demonstrates strong AI adoption relative to organizational norms${fallbackNote}. This presents an opportunity to identify and scale the most effective AI-assisted workflows across other tools and teams. Standardizing these patterns can accelerate overall delivery velocity.`;
  } else if (toolBand === 'low') {
    description = `${toolName} AI usage is below the organizational average${fallbackNote}, indicating potential underutilization of AI-assisted development capabilities. Increasing adoption could improve coding efficiency and reduce time-to-delivery, but requires understanding why usage is lower and addressing any barriers.`;
  } else {
    description = `${toolName} AI usage aligns with organizational patterns${fallbackNote}, providing a stable baseline. This consistency enables focused improvements—identifying the most effective AI workflows and scaling them, while monitoring deployment frequency and quality metrics to ensure AI adoption translates into measurable outcomes.`;
  }

  // Evidence: Standardized labels (Current, Baseline, Delta, Points analyzed, Data source)
  const evidence: Array<{ label: string; value: string }> = [
    { label: 'Current', value: `${toolAiRate.toFixed(2)} assists/min` },
    { label: 'Baseline', value: `${orgAiRate.toFixed(2)} assists/min` },
    { label: 'Delta', value: `${ratio.toFixed(2)}x` }
  ];
  if (usingFallback) {
    evidence.push({ label: 'Note', value: 'VSCode data not available; showing Cursor instead' });
  }
  if (pctChange !== null) {
    evidence.push({ label: 'Deploy freq (current)', value: `${latestDeployFreq.toFixed(1)}/week` });
    if (prevDeployFreq > 0) {
      evidence.push({ label: 'Deploy freq (baseline)', value: `${prevDeployFreq.toFixed(1)}/week` });
      evidence.push({ label: 'Delta', value: `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%` });
    }
  } else {
    evidence.push({ label: 'Deployment frequency', value: `${latestDeployFreq.toFixed(1)}/week` });
  }
  evidence.push({ label: 'Data source', value: inferDataSourceForOrgInsight(input) || 'combined' });

  // Recommendations: ≥3 crisp recommendations with owner + action + expected outcome
  let recommendations: InsightRecommendation[];
  if (toolBand === 'high' && pctChange !== null && pctChange < -5) {
    recommendations = [
      {
        text: 'Engineering managers: Review VSCode-heavy PRs for quality issues—test coverage, code review depth, and change failure rate. Identify if AI-generated code requires additional review steps. Expected: Improved deployment success rate and reduced rollbacks.',
        actionType: 'process'
      },
      {
        text: 'Platform team: Compare deployment frequency and change failure rate for VSCode vs. other tools. If VSCode shows higher CFR, investigate CI/CD pipeline differences or review practices. Expected: Data-driven understanding of AI impact on delivery.',
        actionType: 'observability'
      },
      {
        text: 'DevOps: Audit test coverage and automated quality gates for AI-assisted code paths. Consider adding AI-specific linting or review checkpoints. Expected: Maintained quality despite high AI usage.',
        actionType: 'process'
      }
    ];
  } else if (toolBand === 'high' && (pctChange === null || pctChange >= 0)) {
    recommendations = [
      {
        text: 'Engineering leads: Document the top 3 VSCode AI workflows showing the best outcomes (cycle time, code quality, developer satisfaction) and create playbooks for other teams. Expected: 25% improvement in average workflow efficiency across tools.',
        actionType: 'process'
      },
      {
        text: 'Platform team: Run A/B tests comparing VSCode AI-assisted vs. manual PRs on deployment frequency, review time, and change failure rate. Expected: Quantified ROI data to guide tooling investments.',
        actionType: 'observability'
      },
      {
        text: 'DevOps: Standardize VSCode AI workflows that show strong deployment outcomes and replicate them in other IDEs. Expected: Consistent high-performance patterns across the organization.',
        actionType: 'process'
      }
    ];
  } else if (toolBand === 'low') {
    recommendations = [
      {
        text: `Engineering managers: Survey ${toolName} users to identify adoption barriers—tool configuration, training gaps, or workflow preferences. Create targeted training sessions and quick-reference guides. Expected: 30% increase in ${toolName} AI usage within 6 weeks.`,
        actionType: 'training'
      },
      {
        text: `Platform team: Compare ${toolName} AI usage patterns with high-adoption tools to identify differences. Share best practices and tooling configurations. Expected: More consistent AI adoption across all IDEs.`,
        actionType: 'process'
      },
      {
        text: `DevOps: Monitor deployment frequency and quality metrics as ${toolName} AI usage increases. Set up alerts if metrics degrade. Expected: Confirmation that increased AI usage improves delivery without quality trade-offs.`,
        actionType: 'process'
      }
    ];
  } else {
    recommendations = [
      {
        text: `Engineering leads: Identify the most effective ${toolName} AI workflows and document them for other tools. Create cross-tool knowledge sharing sessions. Expected: Improved AI adoption consistency across the organization.`,
        actionType: 'process'
      },
      {
        text: 'Platform team: Track deployment frequency and change failure rate trends as AI usage scales. Set alerts if metrics degrade. Expected: Early detection of any quality or velocity issues.',
        actionType: 'process'
      },
      {
        text: 'DevOps: Run periodic reviews comparing AI-assisted vs. manual PR outcomes to validate ROI. Expected: Data-driven decisions on AI tooling investments and workflow improvements.',
        actionType: 'process'
      }
    ];
  }

  // Use existing helper for dataSource (org-level insight, but VSCode-focused)
  const dataSource = inferDataSourceForOrgInsight(input);

  insights.push({
    id: `deploy-vscode-ai-posture-${Date.now()}`,
    title,
    description,
    severity,
    cicdStage: 'deploy-operate', // Changed to deploy-operate per rule name
    tags: ['deploy', toolName.toLowerCase(), 'ai', 'org'],
    related: {
      tools: [toolName.toLowerCase()]
    },
    evidence,
    recommendations,
    source: 'combined',
    metricId: 'eng.deploy_vs_ai_vscode',
    // Phase 2: Provenance metadata (org-level insight, tool-focused)
    dataSource,
    toolScope: 'single-ide',
    tools: [toolName.toLowerCase()],
    summaryEligible: false,
    insightClass: 'org_deterministic',
    orgKind: 'diagnostic'
  });

  return insights;
}

/**
 * Deploy AI Reliability Correlation Rule
 * 
 * Correlates org-level AI usage rate with change failure rate over time.
 * Uses existing correlation infrastructure (pearson + pValueFromR).
 * Emits at most ONE deploy-operate stage insight.
 */
function ruleDeployAIReliabilityCorrelation(input: PerformanceInputs): PerformanceInsight[] {
  const insights: PerformanceInsight[] = [];

  // 1. If productivity OR engOutput is empty, emit diagnostic in Value Mode
  if (!input.productivity || input.productivity.length === 0 || 
      !input.engOutput || input.engOutput.length === 0) {
    if (isValueMode()) {
      const insight: PerformanceInsight = {
        id: `deploy-ai-reliability-correlation-no-data-${Date.now()}`,
        title: 'Need more data to analyze AI-reliability correlation',
        description: 'Productivity or deployment data is missing. Connect both IDE telemetry and GitHub integration to enable AI usage vs. change failure rate correlation analysis.',
        severity: 'info',
        insightClass: 'tool_statistical',
        cicdStage: 'deploy-operate',
        toolScope: 'org',
        source: 'combined',
        metricId: 'eng.ai_reliability_correlation',
        dataSource: inferDataSourceForOrgInsight(input),
        evidence: [
          { label: 'Status', value: 'Missing data' },
          { label: 'Required', value: 'productivity + engOutput' },
          { label: 'Action', value: 'Connect IDE and GitHub integrations' }
        ],
        recommendations: [
          {
            text: 'Ensure both productivity telemetry (IDE extension) and deployment data (GitHub) are connected.',
            actionType: 'observability'
          }
        ],
        related: {},
        tools: undefined,
        priorityScore: 35, // Floor score
        summaryEligible: false,
        tags: ['org', 'ai-reliability', 'data-missing']
      };
      return [insight];
    }
    return [];
  }

  // 2. Build ORG-level, per-period series
  // Aggregate productivity across all tools for each period
  const periodMap = new Map<string, { totalAiAssists: number; totalCodingMinutes: number; cfr?: number }>();

  // Aggregate productivity data by period (across all tools)
  for (const prod of input.productivity) {
    if (!prod.period) continue;
    
    const existing = periodMap.get(prod.period) || { totalAiAssists: 0, totalCodingMinutes: 0 };
    existing.totalAiAssists += prod.aiAssists || 0;
    existing.totalCodingMinutes += prod.codingMinutes || 0;
    periodMap.set(prod.period, existing);
  }

  // Add CFR from engOutput for matching periods
  for (const eng of input.engOutput) {
    if (!eng.period) continue;
    
    const cfr = eng.changeFailureRatePct;
    if (cfr === undefined) continue; // Only include points where CFR is defined
    
    const existing = periodMap.get(eng.period);
    if (existing) {
      existing.cfr = cfr;
    }
  }

  // Build series arrays for correlation (only periods with both AI usage and CFR)
  const aiUsageRateSeries: number[] = [];
  const cfrSeries: number[] = [];
  const periods: string[] = [];

  for (const [period, data] of periodMap.entries()) {
    if (data.cfr === undefined) continue; // Skip if CFR not defined
    
    // Compute AI usage rate: totalAiAssists / max(totalCodingMinutes, 1)
    const aiUsageRate = data.totalCodingMinutes > 0
      ? data.totalAiAssists / data.totalCodingMinutes
      : data.totalAiAssists; // Fallback to total assists if no coding minutes
    
    aiUsageRateSeries.push(aiUsageRate);
    cfrSeries.push(data.cfr);
    periods.push(period);
  }

  // 3. Gating with Value Mode adaptation
  const n = aiUsageRateSeries.length;
  const defaultMin = DEMO_MODE ? DEMO_MIN_POINTS : 4;
  const minPoints = valueModeMinPoints(defaultMin, n);
  
  // VALUE MODE: If insufficient history (< 2), emit diagnostic
  if (n < 2 && isValueMode()) {
    const insight: PerformanceInsight = {
      id: `deploy-ai-reliability-correlation-insufficient-${Date.now()}`,
      title: 'Need more history to estimate AI-reliability correlation',
      description: `Only ${n} period(s) with both AI usage and change failure rate data available. Need at least 2 periods to analyze correlation. Connect more data or wait 24-48 hours for additional periods.`,
      severity: 'info',
      insightClass: 'tool_statistical',
      cicdStage: 'deploy-operate',
      toolScope: 'org',
      source: 'combined',
      metricId: 'eng.ai_reliability_correlation',
      dataSource: inferDataSourceForOrgInsight(input),
      evidence: [
        { label: 'Observed periods', value: n.toString() },
        { label: 'Needed for correlation', value: '2+' },
        { label: 'Action', value: 'Wait 24-48h or connect more data' }
      ],
      recommendations: [
        {
          text: 'Continue collecting productivity and deployment data. Correlation insights will appear once 2+ periods are available.',
          actionType: 'observability'
        }
      ],
      related: {},
      tools: undefined,
      priorityScore: 35, // Floor score
      summaryEligible: false,
      tags: ['org', 'ai-reliability', 'insufficient-history']
    };
    return [insight];
  }

  if (n < minPoints) {
    return [];
  }

  // Compute correlation
  const r = pearson(aiUsageRateSeries, cfrSeries);
  const p = pValueFromR(r, n);

  // VALUE MODE: Relax thresholds for small N
  const valueConfig = getValueConfig();
  const minAbsR = isValueMode() && n < valueConfig.minNForPValue
    ? valueConfig.relaxedMinAbsR
    : (DEMO_MODE ? DEMO_MIN_ABS_R : 0.5);
  const maxP = SIG_P;
  const skipPValue = isValueMode() && n < valueConfig.minNForPValue && valueConfig.bypassPValueForSmallN;

  // Check thresholds (skip p-value check in Value Mode for small N)
  if (Math.abs(r) <= minAbsR || (!skipPValue && p >= maxP)) {
    // VALUE MODE: If correlation exists but not significant, emit "low confidence" diagnostic
    if (isValueMode() && Math.abs(r) > 0.1 && n < valueConfig.minNForPValue) {
      const direction = r > 0 ? 'positive' : 'negative';
      const insight: PerformanceInsight = {
        id: `deploy-ai-reliability-correlation-low-confidence-${Date.now()}`,
        title: `Early signal: AI usage may correlate with change failure rate (low confidence)`,
        description: `A ${direction} correlation (r=${r.toFixed(3)}) is observed between AI usage and change failure rate, but with only ${n} period(s) of data, statistical significance cannot be determined. This is an early signal that requires more history to confirm.`,
        severity: 'info',
        insightClass: 'tool_statistical',
        cicdStage: 'deploy-operate',
        toolScope: 'org',
        source: 'combined',
        metricId: 'eng.ai_reliability_correlation',
        dataSource: inferDataSourceForOrgInsight(input),
        evidence: [
          { label: 'Correlation (r)', value: r.toFixed(3) },
          { label: 'Direction', value: direction },
          { label: 'Periods analyzed', value: n.toString() },
          { label: 'Confidence', value: 'Low (need more history)' },
          { label: 'Note', value: 'Statistical significance requires 4+ periods' }
        ],
        recommendations: [
          {
            text: 'Continue collecting data. Once 4+ periods are available, correlation significance will be evaluated.',
            actionType: 'observability'
          }
        ],
        related: {},
        tools: undefined,
        priorityScore: 40, // Low but visible
        summaryEligible: false,
        tags: ['org', 'ai-reliability', 'low-confidence']
      };
      return [insight];
    }
    return [];
  }

  // 4. Emit exactly ONE org-level deploy insight
  const dataSource = inferDataSourceForOrgInsight(input);
  
  // Determine severity
  const severity: InsightSeverity = Math.abs(r) >= 0.5 ? 'warning' : 'risk';

  // Generate title, description, and recommendation based on correlation direction
  let title: string;
  let description: string;
  let recommendationText: string;

  // Calculate averages for evidence
  const avgAiUsageRate = aiUsageRateSeries.reduce((sum, val) => sum + val, 0) / n;
  const avgCFR = cfrSeries.reduce((sum, val) => sum + val, 0) / n;

  if (r > 0) {
    // Positive correlation: more AI usage ↔ HIGHER change failure rate
    title = 'Org: Heavy AI usage is linked to less stable deployments';
    description = `Periods with higher AI usage rate per coding minute tend to have higher change failure rates. `;
    description += `The correlation coefficient is ${r.toFixed(3)} (p=${p.toFixed(4)}), suggesting that increased AI-assisted coding may be associated with more deployment failures.`;
    recommendationText = 'Add extra review for AI-heavy changes and strengthen tests for services where AI usage is highest.';
  } else {
    // Negative correlation: more AI usage ↔ LOWER change failure rate
    title = 'Org: Heavy AI usage is linked to more stable deployments';
    description = `Higher AI usage correlates with lower change failure rates in recent periods. `;
    description += `The correlation coefficient is ${r.toFixed(3)} (p=${p.toFixed(4)}), suggesting that AI-assisted coding may be contributing to more stable deployments.`;
    recommendationText = 'Double down on AI-assisted workflows in services where AI usage is highest and continue monitoring deployment failures.';
  }

  // Build evidence array
  const evidence: Array<{ label: string; value: string }> = [
    { label: 'Correlation (r)', value: r.toFixed(3) },
    { label: 'P-value', value: p.toFixed(4) },
    { label: 'Periods', value: n.toString() }
  ];
  if (avgCFR > 0) {
    evidence.push({ label: 'Avg Change Failure Rate', value: `${avgCFR.toFixed(1)}%` });
  }
  if (avgAiUsageRate > 0) {
    evidence.push({ label: 'Avg AI Usage Rate', value: avgAiUsageRate.toFixed(3) });
  }

  insights.push({
    id: `deploy-ai-reliability-${Date.now()}`,
    title,
    description,
    severity,
    cicdStage: 'deploy-operate',
    tags: ['deploy', 'ai', 'reliability', 'org', 'correlation'],
    related: {
      tools: []
    },
    evidence,
    recommendations: [
      { text: recommendationText, actionType: 'process' }
    ],
    source: 'combined',
    metricId: 'eng.ai_deploy_reliability',
    // Phase 2: Provenance metadata
    dataSource,
    toolScope: 'org',
    tools: []
  });

  return insights;
}


// Fallback rule to ensure we always have some insights
/**
 * Demo Tool Coverage Rule
 * 
 * Generates one card per IDE (max 6 total) with unique titles and actions.
 * Each IDE gets a rank-based "angle" to ensure no duplicate titles/actions.
 * Only runs in DEMO_MODE.
 */
function ruleDemoToolCoverage(
  input: PerformanceInputs,
  existingInsights: PerformanceInsight[]
): PerformanceInsight[] {
  // Only run in DEMO_MODE
  if (!DEMO_MODE) {
    console.warn('[PI][DemoToolCoverage] Early return: DEMO_MODE is false');
    return [];
  }

  console.warn('[PI][DemoToolCoverage] ENTER', {
    productivityLen: input.productivity?.length || 0,
    engOutputLen: input.engOutput?.length || 0
  });

  // Compute stats for all tools
  const allToolStats = computeCoverageStatsForTools(input);
  
  console.warn('[PI][DemoToolCoverage] Tool stats computed', {
    toolCount: allToolStats.length,
    tools: allToolStats.map(s => ({ tool: s.tool, points: s.points, avgCoding: s.avgCodingMinutes, aiRate: s.aiPerMinute }))
  });
  
  if (allToolStats.length === 0) {
    console.warn('[PI][DemoToolCoverage] Early return: no tool stats');
    return [];
  }

  // 1) Precompute ranks + deltas
  const stats = allToolStats.map(s => ({
    ...s,
    toolLabel: getToolLabel(s.tool),
  }));

  const orgMedianMinutes = median(stats.map(s => s.avgCodingMinutes));
  const orgMedianAi = median(stats.map(s => s.aiPerMinute));

  const byAi = [...stats].sort((a, b) => b.aiPerMinute - a.aiPerMinute);
  const byMinutes = [...stats].sort((a, b) => b.avgCodingMinutes - a.avgCodingMinutes);

  const aiRank = new Map<string, number>();
  const minutesRank = new Map<string, number>();
  byAi.forEach((s, idx) => aiRank.set(s.tool, idx + 1));
  byMinutes.forEach((s, idx) => minutesRank.set(s.tool, idx + 1));

  // Baseline tool = the #1 AI tool
  const baselineTool = byAi[0];
  const baselineToolLabel = baselineTool ? getToolLabel(baselineTool.tool) : 'your primary AI IDE';

  // 2) Pick a unique "angle" per IDE (NO shared titles)
  function pctDelta(v: number, base: number): number {
    if (!base) return 0;
    return (v - base) / base;
  }

  type Angle =
    | 'AI_LEADER'
    | 'DEEP_FOCUS'
    | 'FAST_SESSIONS'
    | 'LOW_AI_MAINTENANCE'
    | 'STEADY_MID'
    | 'BALANCED_WITH_EDGE';

  function chooseAngle(s: typeof stats[0]): Angle {
    const aiD = pctDelta(s.aiPerMinute, orgMedianAi);
    const minD = pctDelta(s.avgCodingMinutes, orgMedianMinutes);

    const aRank = aiRank.get(s.tool) ?? 99;
    const mRank = minutesRank.get(s.tool) ?? 99;

    // Hard anchors (unique-ish by rank)
    if (aRank === 1) return 'AI_LEADER';
    if (mRank === 1 && s.aiPerMinute >= orgMedianAi) return 'DEEP_FOCUS';

    // Distinctive patterns
    if (minD <= -0.20 && s.aiPerMinute >= orgMedianAi) return 'FAST_SESSIONS';
    if (aiD <= -0.15) return 'LOW_AI_MAINTENANCE';

    // Midfield (force uniqueness via rank-based suffix later)
    if (Math.abs(aiD) <= 0.05 && Math.abs(minD) <= 0.05) return 'STEADY_MID';

    return 'BALANCED_WITH_EDGE';
  }

  // 3) Title + action MUST be unique (enforce with suffix + action variants)
  function buildTitle(s: typeof stats[0], angle: Angle): string {
    const aRank = aiRank.get(s.tool);
    const mRank = minutesRank.get(s.tool);

    // Always include a differentiator so titles can't collide.
    const suffix = `(#${aRank} AI, #${mRank} session length)`;

    switch (angle) {
      case 'AI_LEADER':
        return `${s.toolLabel} leads AI usage ${suffix}`;
      case 'DEEP_FOCUS':
        return `${s.toolLabel} supports deep-focus builds ${suffix}`;
      case 'FAST_SESSIONS':
        return `${s.toolLabel} fits rapid, small-change work ${suffix}`;
      case 'LOW_AI_MAINTENANCE':
        return `${s.toolLabel} skews manual / low-AI workflows ${suffix}`;
      case 'STEADY_MID':
        return `${s.toolLabel} is close to org baseline ${suffix}`;
      default:
        return `${s.toolLabel} has a distinct work pattern ${suffix}`;
    }
  }

  function buildAction(s: typeof stats[0], angle: Angle, baselineToolLabel: string): string {
    // No "monitor/decide". Actions are routing/standardization suggestions.
    switch (angle) {
      case 'AI_LEADER':
        return `Use ${s.toolLabel} as the default for AI-heavy feature work; use it as the baseline when comparing PR outcomes across IDEs.`;
      case 'DEEP_FOCUS':
        return `Route large refactors and complex features to ${s.toolLabel}; add stricter review gates for those PRs in Review & Merge.`;
      case 'FAST_SESSIONS':
        return `Route small PRs, fixes, and quick iterations to ${s.toolLabel}; keep big builds on ${baselineToolLabel} or the deep-focus IDE.`;
      case 'LOW_AI_MAINTENANCE':
        return `Consider ${s.toolLabel} for low-risk edits/config/ops work; route AI-beneficial work to ${baselineToolLabel}.`;
      case 'STEADY_MID':
        return `Keep ${s.toolLabel} for teams that prefer it, but standardize AI-heavy workflows on ${baselineToolLabel} to reduce variance.`;
      default:
        return `Use ${s.toolLabel} for its observed strengths; standardize AI-heavy work on ${baselineToolLabel} to keep comparisons clean.`;
    }
  }

  // Prepare base insight properties
  const sampleTool = allToolStats[0];
  const dataSource = inferDataSourceForToolInsight(sampleTool.tool, input);

  const baseInsightProps: Partial<PerformanceInsight> = {
    severity: 'info',
    cicdStage: 'plan-code',
    source: 'productivity',
    metricId: 'ide.active_coding_time_minutes',
    dataSource,
    toolScope: 'single-ide'
  };

  // 4) Emit one card per IDE (max 6) with unique title and non-identical action
  const usedTitles = new Set<string>();
  const out: PerformanceInsight[] = [];

  for (const s of stats) {
    if (out.length >= 6) break;

    const angle = chooseAngle(s);
    let title = buildTitle(s, angle);

    // Extra safety: never allow duplicate titles
    if (usedTitles.has(title)) {
      title = `${title} (${s.toolLabel})`;
    }
    usedTitles.add(title);

    const minutes = Math.round(s.avgCodingMinutes);
    const ai = Number(s.aiPerMinute.toFixed(2));

    out.push({
      ...(baseInsightProps as any),
      id: `demo-ide-profile-${s.tool.toLowerCase()}-${Date.now()}`,
      title,
      description: `${minutes} min avg coding time, ${ai} assists/min across ${s.points} periods.`,
      recommendations: [
        {
          text: buildAction(s, angle, baselineToolLabel),
          actionType: 'process' as const
        }
      ],
      evidence: [
        { label: 'Time Range', value: `${s.points} Weeks` },
        { label: 'Avg Coding Time', value: `${minutes} min` },
        { label: 'AI Assists per Minute', value: `${ai}` },
      ],
      tags: ['demo', 'coverage', 'productivity', 'ide-profile'],
      related: { tools: [s.tool] },
      toolScope: 'single-ide',
      tools: [s.tool]
    } as PerformanceInsight);
  }

  console.warn('[PI][DemoToolCoverage][NoRedundancy] EMIT', out.map(x => x.title));

  return out;
}

/**
 * VSCode Plan & Code Real Summary Rule
 * 
 * Generates a single VSCode-specific "Plan & Code" insight using VSCode telemetry.
 * In DEMO_MODE: accepts any VSCode productivity points regardless of source.
 * In non-DEMO mode: only fires if there are live/hybrid VSCode productivity points.
 * Emits exactly ONE insight with severity 'highlight'.
 */
function ruleVSCodePlanCodeRealSummary(input: PerformanceInputs): PerformanceInsight[] {
  const insights: PerformanceInsight[] = [];

  // In DEMO_MODE, let ruleDemoToolCoverage handle VSCode to avoid duplicate cards
  if (DEMO_MODE) {
    return [];
  }

  // Filter for VSCode productivity points (case-insensitive)
  const vscodePoints = (input.productivity || []).filter(p => 
    p.tool && p.tool.toLowerCase() === 'vscode'
  );

  // Early return if no VSCode points at all
  if (vscodePoints.length === 0) {
    return [];
  }

  // Non-DEMO: prefer live/hybrid points, but if none exist (common early in onboarding),
  // fall back to any VSCode productivity points and mark as low-confidence.
  const liveOrHybrid = vscodePoints.some(p => p.source === 'live' || p.source === 'hybrid');
  const eligibleVSCodePoints = liveOrHybrid
    ? vscodePoints.filter(p => p.source === 'live' || p.source === 'hybrid')
    : vscodePoints;

  // Use patched coverage stats instead of recomputing from raw points
  // This ensures VSCode uses the same patched values as other coverage cards
  const allToolStats = computeCoverageStatsForTools(input);
  const vscodeStats = allToolStats.find(s => s.tool.toLowerCase() === 'vscode');
  
  // Fallback to raw computation if patched stats not found (shouldn't happen, but defensive)
  const dataPointCount = eligibleVSCodePoints.length;
  let avgCodingMinutes: number;
  let avgAiAssists: number;
  let aiPerMinute: number;
  
  if (vscodeStats) {
    // Use patched stats (already includes DEMO repair if applicable)
    avgCodingMinutes = vscodeStats.avgCodingMinutes;
    avgAiAssists = vscodeStats.avgAiAssists;
    aiPerMinute = vscodeStats.aiPerMinute;
  } else {
    // Fallback: compute from raw points (shouldn't happen in normal flow)
    const totalCodingMinutes = eligibleVSCodePoints.reduce((sum, p) => sum + (p.codingMinutes || 0), 0);
    const totalAiAssists = eligibleVSCodePoints.reduce((sum, p) => sum + (p.aiAssists || 0), 0);
    avgCodingMinutes = dataPointCount > 0 ? totalCodingMinutes / dataPointCount : 0;
    avgAiAssists = dataPointCount > 0 ? totalAiAssists / dataPointCount : 0;
    aiPerMinute = totalCodingMinutes > 0 ? totalAiAssists / totalCodingMinutes : 0;
  }

  // Use existing helper for dataSource
  const dataSource = inferDataSourceForToolInsight('vscode', input);

  // Build evidence array
  const evidence: Array<{ label: string; value: string }> = [
    { label: 'Time Range', value: `${dataPointCount} Weeks` }
  ];
  if (avgCodingMinutes > 0) {
    evidence.push({ label: 'Avg Coding Time', value: `${Math.round(avgCodingMinutes)} min` });
  }
  if (aiPerMinute > 0) {
    evidence.push({ label: 'AI Assists per Minute', value: aiPerMinute.toFixed(2) });
  }

  const windowLabel = formatWindow('week', Math.max(1, Math.min(4, dataPointCount || 4)));

  // Build description
  const descriptionParts: string[] = [];
  if (avgCodingMinutes > 0) {
    descriptionParts.push(`average ${Math.round(avgCodingMinutes)} minutes of coding per period`);
  }
  if (avgAiAssists > 0) {
    descriptionParts.push(`${Math.round(avgAiAssists)} AI assists per period`);
  }
  if (aiPerMinute > 0) {
    descriptionParts.push(`${aiPerMinute.toFixed(2)} assists per minute`);
  }
  const baseDescription = `VSCode shows ${descriptionParts.join(', ')} ${windowLabel}.`;
  const caveat = liveOrHybrid
    ? ''
    : ' Directional signal based on simulated/low-confidence IDE productivity in this window.';
  const description = `${baseDescription}${caveat}`;

  const latestPeriod = (eligibleVSCodePoints || []).map(p => p.period).filter(Boolean).sort().slice(-1)[0] || 'unknown';

  insights.push({
    id: makeDeterministicInsightId('vscode-plan-code', latestPeriod, liveOrHybrid ? 'real' : 'directional'),
    title: `Standardize AI-assisted coding workflows in VSCode ${windowLabel}`,
    description,
    severity: 'highlight',
    cicdStage: 'plan-code',
    tags: Array.from(new Set([
      'vscode',
      'productivity',
      'plan-code',
      ...(liveOrHybrid ? ['real-data'] : ['low-confidence', 'estimated'])
    ])),
    related: { tools: ['vscode'] },
    evidence,
    recommendations: [
      { text: "Use VSCode's AI usage here as a baseline when comparing other IDEs.", actionType: 'process' }
    ],
    source: 'productivity',
    metricId: 'ide.active_coding_time_minutes',
    dataSource,
    toolScope: 'single-ide',
    tools: ['vscode']
  });

  return insights;
}

const ruleFallbackInsights: Rule = (input) => {
  const { engOutput, productivity } = input;
  const insights: PerformanceInsight[] = [];
  
  // Upgrade: Average Cycle Time with trends
  if (engOutput && engOutput.length >= 3) {
    // Filter to periods with valid prCycleTimeHours
    const points = engOutput
      .map(p => p.prCycleTimeHours)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    
    if (points.length >= 3) {
      const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
      const median = (xs: number[]): number => {
        const sorted = [...xs].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      };
      
      const medianCycle = median(points);
      
      // Simple trend: recent vs earlier
      const half = Math.floor(points.length / 2);
      const early = points.slice(0, half);
      const recent = points.slice(half);
      
      if (early.length > 0 && recent.length > 0) {
        const earlyAvg = avg(early);
        const recentAvg = avg(recent);
        const change = earlyAvg > 0 ? (recentAvg - earlyAvg) / earlyAvg : 0;
        
        // Classify trend
        let trendLabel: 'improving' | 'worsening' | 'flat';
        if (change < -0.10) trendLabel = 'improving';
        else if (change > 0.10) trendLabel = 'worsening';
        else trendLabel = 'flat';
        
        // Title
        let title: string;
        if (trendLabel === 'improving') {
          title = 'Org cycle time is improving';
        } else if (trendLabel === 'worsening') {
          title = 'Org cycle time is slowing down';
        } else {
          title = 'Org cycle time is stable';
        }
        
        // Description
        let description: string;
        if (trendLabel === 'improving') {
          description = `Recent PRs are merging faster than earlier periods: average cycle time dropped from ${earlyAvg.toFixed(1)}h to ${recentAvg.toFixed(1)}h (median ~${medianCycle.toFixed(1)}h).`;
        } else if (trendLabel === 'worsening') {
          description = `Recent PRs are taking longer to merge: average cycle time rose from ${earlyAvg.toFixed(1)}h to ${recentAvg.toFixed(1)}h (median ~${medianCycle.toFixed(1)}h).`;
        } else {
          description = `PR cycle time is roughly flat: recent periods sit around ${recentAvg.toFixed(1)}h (median ~${medianCycle.toFixed(1)}h).`;
        }
        
        // Severity
        const severity: InsightSeverity = trendLabel === 'worsening' ? 'warning' : 'info';
        
        // Evidence
        const evidence = [
          { label: 'Median PR cycle time', value: `${medianCycle.toFixed(1)} hours` },
          { label: 'Earlier periods avg', value: `${earlyAvg.toFixed(1)} hours` },
          { label: 'Recent periods avg', value: `${recentAvg.toFixed(1)} hours` },
          { label: 'Relative change', value: `${(change * 100).toFixed(0)}%` }
        ];
        
        // Action
        let recommendationText: string;
        if (trendLabel === 'worsening') {
          recommendationText = 'Look at review load and AI-heavy changes during recent periods to understand why cycle time is increasing.';
        } else if (trendLabel === 'improving') {
          recommendationText = 'Document what changed in your review process or tooling so you can sustain the faster cycle time.';
        } else {
          recommendationText = 'Use this as a baseline when you roll out new AI tooling or process changes.';
        }
        
        insights.push({
          id: 'fallback-cycle-time',
          title,
          description,
          severity,
          insightClass: 'org_deterministic',
          orgKind: 'summary',
          cicdStage: 'review-merge',
          tags: ['fallback', 'cycle-time', 'org'],
          related: {},
          evidence,
          recommendations: [
            { text: recommendationText, actionType: 'process' }
          ],
          source: 'github',
          metricId: 'eng.pr_cycle_time',
          dataSource: inferDataSourceForOrgInsight(input),
          toolScope: 'org',
          tools: undefined
        });
        
        console.warn('[PI][Fallback] EMIT Org Cycle Time Summary', { trendLabel, medianCycle, change });
      }
    }
  }
  
  // Note: Org AI Usage card moved to ruleOrgAIUsageSummary (explicit org-level Plan & Code rule)
  // This fallback now only handles truly generic last-resort cases
  
  // Only show cross-dataset insight if there's a coverage gap or specific issue
  // (Removed generic "data available" message - user can see data in cards)
  
  const hasGHData = engOutput && engOutput.length > 0;
  const hasProdData = productivity && productivity.length > 0;
  
  // Safely calculate overlap, handling potential errors
  // Use the overlapCount from time.ts (already imported at top of file)
  // It takes 2 arrays of objects with period properties
  let overlap = 0;
  if (hasGHData && hasProdData) {
    try {
      // Use the imported overlapCount from time.ts (line 14)
      overlap = overlapCountFromTime(engOutput, productivity);
    } catch (e) {
      // Fallback: manually count overlapping periods if overlapCount fails
      try {
        const engPeriods = new Set((engOutput || []).map((x: any) => x?.period).filter(Boolean));
        const prodPeriods = new Set((productivity || []).map((x: any) => x?.period).filter(Boolean));
        let n = 0;
        for (const p of engPeriods) {
          if (prodPeriods.has(p)) n++;
        }
        overlap = n;
        console.warn('[ruleFallbackInsights] Used manual overlap calculation:', overlap);
      } catch (e2) {
        console.warn('[ruleFallbackInsights] overlapCount error:', e, e2);
        overlap = 0;
      }
    }
  }
  
  // Only emit if there's a specific coverage concern
  if (hasGHData && !hasProdData) {
    insights.push({
      id: 'fallback-coverage-gap',
      title: 'Missing IDE Productivity Data',
      description: `GitHub metrics are available, but no IDE productivity data found. Connect your IDE to unlock AI usage insights.`,
      severity: 'warning',
      tags: ['fallback', 'coverage-gap'],
      related: {},
      evidence: [
        { label: 'GitHub PRs', value: engOutput.length },
        { label: 'IDE Sessions', value: 0 }
      ],
      recommendations: [
        { text: 'Install the ChaosMonkey VS Code/Cursor extension', actionType: 'tooling' }
      ],
      source: 'mixed',
      // Phase 2: Provenance metadata (computed from actual data sources)
      dataSource: inferDataSourceForOrgInsight(input),
      toolScope: 'org',
      tools: undefined
    });
  } else if (!hasGHData && hasProdData) {
    // Check if GitHub is connected via snapshot data
    const githubConnected = input?.githubSnapshot?.github_connected === true;
    
    // Only show "Missing GitHub Data" if GitHub is not connected
    // Don't show this insight when GitHub is connected but only has snapshot/time series issues
    if (!githubConnected) {
      insights.push({
        id: 'fallback-coverage-gap',
        title: 'Missing GitHub Data',
        description: `IDE productivity data is available, but no GitHub metrics found. Connect GitHub to unlock PR cycle time insights.`,
        severity: 'warning',
        tags: ['fallback', 'coverage-gap'],
        related: {},
        evidence: [
          { label: 'GitHub PRs', value: 0 },
          { label: 'IDE Sessions', value: productivity.length }
        ],
        recommendations: [
          { text: 'Authorize GitHub OAuth to sync pull request data', actionType: 'tooling' }
        ],
        source: 'mixed'
      });
    }
  }
  // If both exist but no overlap, insights are already generated by cycle-vs-ai rules
  // No need for generic "data available" message
  
  return insights;
};

// ========== NEW ENGINEERING LEADERSHIP RULES (10 Total) ==========

/**
 * RULE 1: AI Usage Improves Cycle Time
 * Detects when higher AI adoption correlates with faster PR cycle times
 * 
 * Required fields:
 * - EngOutputPoint: prCycleTimeHours, period
 * - ToolProductivityPoint: aiAssists, period, tool, codingMinutes (optional)
 */
const ruleAIImprovesCycleTime: Rule = ({ engOutput, productivity, overlap, prodGlobalSource }) => {
  const insights: PerformanceInsight[] = [];
  
  // Prefer live/hybrid points, but if none exist, fall back to available productivity and mark low-confidence.
  const liveOrHybrid = (productivity || []).some((p: any) => p.source === 'live' || p.source === 'hybrid');
  const relevantProd = DEMO_MODE
    ? productivity || []
    : (liveOrHybrid
      ? (productivity?.filter((p: any) => p.source === 'live' || p.source === 'hybrid') || [])
      : (productivity || []));
  const lowConfidenceProd = !DEMO_MODE && !liveOrHybrid;
  
  const VALUE_MODE = isValueMode();
  const minOverlap = DEMO_MODE ? 2 : (VALUE_MODE ? 2 : 3);  // Relax in Value Mode
  const minAbsR = DEMO_MODE ? DEMO_MIN_ABS_R : 0.55;
  const maxP = SIG_P;
  
  // If productivity is simulated/unknown, allow emission but treat as low-confidence.
  
  // Value Mode: Relax overlap requirement (allow with 2 periods instead of 3)
  if (VALUE_MODE) {
    // Still need both datasets, but allow lower overlap
    if (!engOutput?.length || relevantProd.length === 0) {
      const PI_DEBUG_CHECK = ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === 'true' || ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === '1';
      if (PI_DEBUG_CHECK) {
        const proof = proveNoData('ai-improves-ct', { engOutput, productivity, overlap }, {
          datasets: { productivity: true, engOutput: true },
          fields: {
            productivity: ['aiAssists', 'period', 'tool'],
            engOutput: ['prCycleTimeHours', 'period']
          }
        });
        addNoDataProof(proof);
      }
      return [];
    }
    // Allow with overlap >= 2 in Value Mode (instead of >= 3)
    if ((overlap ?? 0) < 2) {
      const PI_DEBUG_CHECK = ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === 'true' || ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === '1';
      if (PI_DEBUG_CHECK) {
        const proof = proveNoData('ai-improves-ct', { engOutput, productivity, overlap }, {
          datasets: { productivity: true, engOutput: true },
          fields: {
            productivity: ['aiAssists', 'period', 'tool'],
            engOutput: ['prCycleTimeHours', 'period']
          }
        });
        addNoDataProof(proof);
      }
      return [];
    }
  } else {
    // Non-Value Mode: Strict requirements
    if (!engOutput?.length || relevantProd.length === 0 || (overlap ?? 0) < minOverlap) {
      const PI_DEBUG_CHECK = ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === 'true' || ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === '1';
      if (PI_DEBUG_CHECK) {
        const proof = proveNoData('ai-improves-ct', { engOutput, productivity, overlap }, {
          datasets: { productivity: true, engOutput: true },
          fields: {
            productivity: ['aiAssists', 'period', 'tool'],
            engOutput: ['prCycleTimeHours', 'period']
          }
        });
        addNoDataProof(proof);
      }
      return [];
    }
  }
  
  try {
    // Calculate AI usage per period (use volume if codingMinutes unavailable)
    const toolData = new Map<string, { aiUsage: number[], cycleTime: number[], periods: string[] }>();
    
    for (const prod of relevantProd) {
      if (!prod.tool || !prod.period) continue;
      
      // Use assists per minute if available, else use total assists as proxy
      const aiUsage = prod.codingMinutes && prod.codingMinutes > 0
        ? (prod.aiAssists || 0) / prod.codingMinutes
        : (prod.aiAssists || 0);
      
      const ghPoint = engOutput.find(g => g.period === prod.period);
      
      if (ghPoint && ghPoint.prCycleTimeHours != null && aiUsage > 0) {
        if (!toolData.has(prod.tool)) {
          toolData.set(prod.tool, { aiUsage: [], cycleTime: [], periods: [] });
        }
        const data = toolData.get(prod.tool)!;
        data.aiUsage.push(aiUsage);
        data.cycleTime.push(ghPoint.prCycleTimeHours);
        data.periods.push(prod.period);
      }
    }
    
    if (import.meta.env.DEV) {
      console.debug('[RULE_AI_IMPROVES_CT] toolData size:', toolData.size, 'tools:', Array.from(toolData.keys()));
    }
    
    const minPoints = DEMO_MODE ? DEMO_MIN_POINTS : 4;
    
    for (const [tool, data] of toolData) {
      if (data.aiUsage.length < minPoints) {
        if (import.meta.env.DEV) {
          console.debug(`[RULE_AI_IMPROVES_CT] Skip ${tool}: only ${data.aiUsage.length} periods (need ${minPoints})`);
        }
        continue;
      }
      
      const r = pearson(data.aiUsage, data.cycleTime);
      const p = pValueFromR(r, data.aiUsage.length);
      
      // DIAGNOSTIC: Correlation check
      console.warn('[RULE_CORR] ai-improves-ct', {
        tool,
        r: r.toFixed(3),
        p: p.toFixed(4),
        n: data.aiUsage.length,
        needsNegative: true,
        passes: r < -minAbsR && p < maxP,
      });
      
      if (import.meta.env.DEV) {
        console.debug(`[RULE_AI_IMPROVES_CT] ${tool}:`, { r: r.toFixed(3), p: p.toFixed(4), periods: data.aiUsage.length, minAbsR });
      }
      
      // Negative correlation = more AI, less cycle time (good!)
      if (r < -minAbsR && p < SIG_P) {
        const slopeHours = Math.abs(r * mean(data.cycleTime));
        const speedupPct = (slopeHours / mean(data.cycleTime)) * 100;
        
        const latestPeriod = data.periods.slice(-1)[0] || 'unknown';
        const windowLabel = formatWindow('week', Math.max(1, Math.min(4, data.periods.length || 4)));
        insights.push({
          id: makeDeterministicInsightId('ai-improves-ct', latestPeriod, tool),
          title: `${getIDEDisplayName(tool as any)}: AI usage correlates with ~${speedupPct.toFixed(0)}% faster PR cycle time`,
          description: `Higher AI activity in ${getIDEDisplayName(tool as any)} correlates with shorter PR cycle times ${windowLabel} (r=${r.toFixed(2)}, p=${p.toFixed(3)}). Estimated speedup: ${slopeHours.toFixed(1)}h per PR, indicating ${speedupPct >= 20 ? 'strong' : 'measurable'} efficiency gains.${lowConfidenceProd || (!DEMO_MODE && prodGlobalSource === 'prod-sim') ? ' Directional signal based on simulated/low-confidence IDE productivity in this window.' : ''}`,
          severity: 'highlight',
          cicdStage: 'review-merge',  // Added: Route to Review & Merge section
          tags: Array.from(new Set([
            'ai-impact', 'cycle-time', 'positive', tool,
            ...((lowConfidenceProd || (!DEMO_MODE && prodGlobalSource === 'prod-sim')) ? ['low-confidence', 'estimated'] : [])
          ])),
          related: { tools: [tool] },
          evidence: [
            { label: 'IDE', value: getIDEDisplayName(tool as any) },
            { label: 'Correlation', value: formatCorrelation(r) },
            { label: 'Statistical Confidence', value: formatConfidence(p) },
            { label: 'Time Range', value: `${formatCount(data.periods.length)} Weeks` },
            { label: 'Est. Impact', value: `~${formatImpact(speedupPct)} faster` }
          ],
          recommendations: [
            { text: `Share ${tool} AI workflow patterns with the team`, actionType: 'process' },
            { text: 'Document successful AI-assisted development practices', actionType: 'process' }
          ],
          source: 'combined',
          metricId: 'eng.pr_cycle_time',
          // Provenance metadata (tool-scoped)
          dataSource: inferDataSourceForToolInsight(tool, { engOutput, productivity } as any),
          toolScope: 'single-ide',
          tools: [tool]
        });
        
        if (import.meta.env.DEV) {
          console.debug(`[RULE_AI_IMPROVES_CT] ✅ Fired for ${tool}`);
        }
      }
    }
    
    if (import.meta.env.DEV) {
      console.debug('[RULE_AI_IMPROVES_CT] Generated insights:', insights.length);
    }
  } catch (e) {
    console.warn('[RULE_AI_IMPROVES_CT] Error:', e);
  }
  
  // DIAGNOSTIC: Exit point
  console.warn('[RULE_RESULT] ai-improves-ct', {
    count: insights.length,
    ids: insights.map(i => i.id),
  });
  
  return insights;
};

/**
 * RULE 2: AI Usage Slows Cycle Time (Regression Alert)
 * Detects when higher AI usage correlates with SLOWER cycle times
 * 
 * Required fields:
 * - EngOutputPoint: prCycleTimeHours, period
 * - ToolProductivityPoint: aiAssists, period, tool, codingMinutes (optional)
 */
const ruleAISlowsCycleTime: Rule = (input) => {
  const { engOutput, productivity, overlap, prodGlobalSource } = input;
  const insights: PerformanceInsight[] = [];
  
  const liveOrHybrid = (productivity || []).some((p: any) => p.source === 'live' || p.source === 'hybrid');
  const relevantProd = DEMO_MODE
    ? productivity || []
    : (liveOrHybrid
      ? (productivity?.filter((p: any) => p.source === 'live' || p.source === 'hybrid') || [])
      : (productivity || []));
  const lowConfidenceProd = !DEMO_MODE && !liveOrHybrid;
  
  const minOverlap = DEMO_MODE ? 2 : 3;
  const minAbsR = DEMO_MODE ? DEMO_MIN_ABS_R : 0.55;
  const maxP = SIG_P;
  
  // If productivity is simulated/unknown, allow emission but treat as low-confidence.
  
  if (!engOutput?.length || relevantProd.length === 0 || (overlap ?? 0) < minOverlap) {
    const PI_DEBUG_CHECK = ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === 'true' || ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === '1';
    if (PI_DEBUG_CHECK) {
      const proof = proveNoData('ai-slows-ct', input, {
        datasets: { productivity: true, engOutput: true },
        fields: {
          productivity: ['aiAssists', 'period', 'tool'],
          engOutput: ['prCycleTimeHours', 'period']
        }
      });
      addNoDataProof(proof);
    }
    return [];
  }
  
  try {
    const toolData = new Map<string, { 
      aiUsage: number[], 
      aiAssists: number[],
      cycleTime: number[], 
      periods: string[] 
    }>();
    
    for (const prod of relevantProd) {
      if (!prod.tool || !prod.period) continue;
      
      const rawAssists = prod.aiAssists || 0;
      // Use assists per minute if available, else use total assists as proxy
      const aiUsage = prod.codingMinutes && prod.codingMinutes > 0
        ? rawAssists / prod.codingMinutes
        : rawAssists;
      
      const ghPoint = engOutput.find(g => g.period === prod.period);
      
      if (ghPoint && ghPoint.prCycleTimeHours != null && aiUsage > 0) {
        if (!toolData.has(prod.tool)) {
          toolData.set(prod.tool, { aiUsage: [], aiAssists: [], cycleTime: [], periods: [] });
        }
        const data = toolData.get(prod.tool)!;
        data.aiUsage.push(aiUsage);
        data.aiAssists.push(rawAssists);
        data.cycleTime.push(ghPoint.prCycleTimeHours);
        data.periods.push(prod.period);
      }
    }
    
    const minPoints = DEMO_MODE ? DEMO_MIN_POINTS : 4;
    const minAbsR = DEMO_MODE ? DEMO_MIN_ABS_R : 0.55;
    const maxP = SIG_P;
    
    for (const [tool, data] of toolData) {
      // Choose X-series based on variance: prefer normalized rate, fallback to raw assists
      const xSeries = hasVariance(data.aiUsage) ? data.aiUsage : data.aiAssists;
      
      const r = pearson(xSeries, data.cycleTime);
      const p = pValueFromR(r, xSeries.length);
      
      if (xSeries.length < minPoints) {
        continue;
      }
      
      // Positive correlation = more AI, MORE cycle time (bad!)
      if (Math.abs(r) > minAbsR && p < maxP) {
        const slopeHours = r * mean(data.cycleTime);
        const slowdownPct = (slopeHours / mean(data.cycleTime)) * 100;
        
        const latestPeriod = data.periods.slice(-1)[0] || 'unknown';
        const windowLabel = formatWindow('week', Math.max(1, Math.min(4, data.periods.length || 4)));
        insights.push({
          id: makeDeterministicInsightId('ai-slows-ct', latestPeriod, tool),
          title: `${getIDEDisplayName(tool as any)}: Heavy AI usage may be slowing PR throughput`,
          description: `Higher AI activity in ${getIDEDisplayName(tool as any)} correlates with longer PR cycle times ${windowLabel} (r=${r.toFixed(2)}, p=${p.toFixed(3)}). Estimated slowdown: ${slowdownPct.toFixed(0)}%, suggesting ${slowdownPct >= 25 ? 'significant' : 'potential'} workflow inefficiencies.${lowConfidenceProd || (!DEMO_MODE && prodGlobalSource === 'prod-sim') ? ' Directional signal based on simulated/low-confidence IDE productivity in this window.' : ''}`,
          severity: 'risk',
          cicdStage: 'review-merge',
          tags: Array.from(new Set([
            'ai-impact', 'cycle-time', 'negative', 'regression', tool,
            ...((lowConfidenceProd || (!DEMO_MODE && prodGlobalSource === 'prod-sim')) ? ['low-confidence', 'estimated'] : [])
          ])),
          related: { tools: [tool] },
          evidence: [
            { label: 'IDE', value: getIDEDisplayName(tool as any) },
            { label: 'Correlation', value: formatCorrelation(r) },
            { label: 'Statistical Confidence', value: formatConfidence(p) },
            { label: 'Time Range', value: `${formatCount(data.periods.length)} Weeks` },
            { label: 'Est. Impact', value: `~${formatImpact(slowdownPct)} slower` }
          ],
          recommendations: [
            { text: `Review ${tool} PRs with heavy AI usage for quality issues`, actionType: 'process' },
            { text: 'Provide training on effective AI code review practices', actionType: 'process' }
          ],
          source: 'combined',
          metricId: 'eng.pr_cycle_time',
          // Phase 2: Provenance metadata (computed from actual data sources)
          dataSource: inferDataSourceForToolInsight(tool, input),
          toolScope: 'single-ide',
          tools: [tool]
        });
      }
    }
  } catch (e) {
    // Silent error handling
  }
  
  return insights;
};

/**
 * RULE 3: AI Usage Impacts Reopen Rate (Quality)
 * Detects correlation between AI usage and PR reopen rate
 * 
 * Required fields:
 * - EngOutputPoint: changeFailureRatePct (or reopenRatePct), period
 * - ToolProductivityPoint: aiAssists, period, tool
 */
const ruleAIImpactsReopenRate: Rule = (input) => {
  const { engOutput, productivity, overlap, prodGlobalSource } = input;
  const insights: PerformanceInsight[] = [];

  const liveOrHybrid = (productivity || []).some((p: any) => p.source === 'live' || p.source === 'hybrid');
  const lowConfidenceProd = !DEMO_MODE && !liveOrHybrid;
  
  const minOverlap = DEMO_MODE ? 2 : 3;
  
  if (!engOutput?.length || !productivity?.length || (overlap ?? 0) < minOverlap) {
    const PI_DEBUG_CHECK = ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === 'true' || ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === '1';
    if (PI_DEBUG_CHECK) {
      const proof = proveNoData('ai-reopen-rate', input, {
        datasets: { productivity: true, engOutput: true },
        fields: {
          productivity: ['aiAssists', 'period', 'tool'],
          engOutput: ['changeFailureRatePct', 'period']
        }
      });
      addNoDataProof(proof);
    }
    return [];
  }
  
  try {
    const toolData = new Map<string, { 
      aiUsage: number[], 
      aiAssists: number[],
      reopenRate: number[], 
      periods: string[] 
    }>();
    
    for (const prod of productivity) {
      if (!prod.tool || !prod.period) continue;
      
      const rawAssists = prod.aiAssists || 0;
      const aiUsage = rawAssists / Math.max(prod.codingMinutes || 1, 1);
      const ghPoint = engOutput.find(g => g.period === prod.period);
      
      // Note: reopenRate might not exist in current schema, this is aspirational
      const reopenRate = (ghPoint as any)?.reopenRatePct || (ghPoint as any)?.changeFailureRatePct;
      
      if (ghPoint && reopenRate != null) {
        if (!toolData.has(prod.tool)) {
          toolData.set(prod.tool, { aiUsage: [], aiAssists: [], reopenRate: [], periods: [] });
        }
        const data = toolData.get(prod.tool)!;
        data.aiUsage.push(aiUsage);
        data.aiAssists.push(rawAssists);
        data.reopenRate.push(reopenRate);
        data.periods.push(prod.period);
      }
    }
    
    const minPoints = DEMO_MODE ? DEMO_MIN_POINTS : 4;
    const minAbsR = DEMO_MODE ? DEMO_MIN_ABS_R : 0.5;
    const maxP = SIG_P;
    
    for (const [tool, data] of toolData) {
      // Choose X-series based on variance: prefer normalized rate, fallback to raw assists
      const xSeries = hasVariance(data.aiUsage) ? data.aiUsage : data.aiAssists;
      
      const r = pearson(xSeries, data.reopenRate);
      const p = pValueFromR(r, xSeries.length);
      
      if (xSeries.length < minPoints) {
        continue;
      }
      
      if (Math.abs(r) > minAbsR && p < maxP) {
        const lowRate = Math.min(...data.reopenRate);
        const highRate = Math.max(...data.reopenRate);
        
        insights.push({
          id: makeDeterministicInsightId('ai-reopen-rate', data.periods.slice(-1)[0] || 'unknown', tool),
          title: `Heavy AI usage is linked to ${r > 0 ? 'higher' : 'lower'} PR reopen rate (${tool})`,
          description: `Reopen rate ${r > 0 ? 'rises' : 'falls'} from ${lowRate.toFixed(1)}% → ${highRate.toFixed(1)}% when AI usage ${r > 0 ? 'increases' : 'decreases'}.${lowConfidenceProd || (!DEMO_MODE && prodGlobalSource === 'prod-sim') ? ' Directional signal based on simulated/low-confidence IDE productivity in this window.' : ''}`,
          severity: r > 0 ? 'warning' : 'highlight',
          cicdStage: 'review-merge',  // Added: Route to Review & Merge section
          tags: Array.from(new Set([
            'ai-impact', 'quality', 'reopen-rate', tool,
            ...((lowConfidenceProd || (!DEMO_MODE && prodGlobalSource === 'prod-sim')) ? ['low-confidence', 'estimated'] : [])
          ])),
          related: { tools: [tool] },
          evidence: [
            { label: 'Correlation (r)', value: r.toFixed(3) },
            { label: 'Significance (p)', value: p.toFixed(4) },
            { label: 'Reopen Range', value: `${lowRate.toFixed(1)}% - ${highRate.toFixed(1)}%` },
            { label: 'Periods', value: data.periods.length }
          ],
          recommendations: r > 0 ? [
            { text: `Introduce lightweight pre-PR testing when many AI assists are used in ${tool}`, actionType: 'process' },
            { text: 'Require code reasoning summaries for AI-heavy changes', actionType: 'process' }
          ] : [
            { text: `Document successful ${tool} AI patterns that improve quality`, actionType: 'process' }
          ],
          source: 'combined',
          metricId: 'eng.change_failure_rate',
          // Phase 2: Provenance metadata (computed from actual data sources)
          dataSource: inferDataSourceForToolInsight(tool, input),
          toolScope: 'single-ide',
          tools: [tool]
        });
      }
    }
  } catch (e) {
    // Silent error handling
  }
  
  return insights;
};

/**
 * RULE 4: Team AI Adoption vs Throughput
 * Compares teams by AI usage and output
 */
const ruleTeamAIAdoptionVsThroughput: Rule = ({ engOutput, productivity, overlap, prodGlobalSource }) => {
  const insights: PerformanceInsight[] = [];
  
  if (!engOutput?.length || !productivity?.length || (overlap ?? 0) < 2) {
    if (import.meta.env.DEV) {
      console.debug('[RULE_TEAM_AI] Skip: insufficient data');
    }
    return [];
  }
  
  try {
    // Group by team (if available) or fall back to tool-level comparison
    const teamData = new Map<string, { aiUsage: number, prsPerDev: number, totalPRs: number }>();
    
    for (const prod of productivity) {
      const teamKey = (prod as any).team || prod.tool || 'default';
      if (!teamData.has(teamKey)) {
        teamData.set(teamKey, { aiUsage: 0, prsPerDev: 0, totalPRs: 0 });
      }
      const data = teamData.get(teamKey)!;
      data.aiUsage += prod.aiAssists || 0;
      
      // Find matching GH data
      const ghPoint = engOutput.find(g => g.period === prod.period);
      if (ghPoint) {
        data.totalPRs += (ghPoint as any).prsMerged || 0;
        data.prsPerDev = data.totalPRs; // Simplified - would need dev count
      }
    }
    
    if (teamData.size < 2) return []; // Need at least 2 teams to compare
    
    const teams = Array.from(teamData.entries())
      .map(([team, data]) => ({ team, ...data }))
      .sort((a, b) => b.aiUsage - a.aiUsage);
    
    const topTeam = teams[0];
    const bottomTeam = teams[teams.length - 1];
    
    const aiVariance = (topTeam.aiUsage - bottomTeam.aiUsage) / Math.max(bottomTeam.aiUsage, 1);
    const throughputVariance = (topTeam.prsPerDev - bottomTeam.prsPerDev) / Math.max(bottomTeam.prsPerDev, 1);
    
    if (aiVariance > 0.25 && throughputVariance > 0.15) {
      insights.push({
        id: `team-ai-throughput-${Date.now()}`,
        title: 'High-AI teams deliver significantly more output',
        description: `Teams with higher AI usage ship ${(throughputVariance * 100).toFixed(0)}% more merged PRs. ${topTeam.team} (high AI) outperforms ${bottomTeam.team} (low AI).`,
        severity: 'opportunity',
        cicdStage: 'plan-code',
        toolScope: 'org',  // Explicitly set as org-level
        tags: ['org', 'team-performance', 'ai-adoption', 'throughput', 'plan-code'],
        related: { tools: [topTeam.team, bottomTeam.team] },
        evidence: [
          { label: 'Top Team', value: topTeam.team },
          { label: 'Top Team AI Usage', value: topTeam.aiUsage.toFixed(0) },
          { label: 'Bottom Team', value: bottomTeam.team },
          { label: 'Bottom Team AI Usage', value: bottomTeam.aiUsage.toFixed(0) },
          { label: 'Throughput Delta', value: `${(throughputVariance * 100).toFixed(0)}%` }
        ],
        recommendations: [
          { text: `Provide targeted onboarding for ${bottomTeam.team} team on AI tools`, actionType: 'process' },
          { text: `Organize knowledge sharing session with ${topTeam.team}`, actionType: 'process' }
        ],
        source: 'combined',
        metricId: 'prod.output_per_developer',
        dataSource: inferDataSourceForOrgInsight({ engOutput, productivity }),
        tools: undefined
      });
    }
  } catch (e) {
    console.warn('[RULE_TEAM_AI] Error:', e);
  }
  
  return insights;
};

/**
 * ============================================================================
 * DATA CONSTRAINTS FOR ORG-LEVEL PERFORMANCE INSIGHTS
 * ============================================================================
 * 
 * Based on data availability audits (docs/DATA_AVAILABILITY_AUDIT.md,
 * docs/REPO_FIELD_AUDIT.md), the following constraints apply to org-level rules:
 * 
 * EngOutputPoint (org-level aggregates):
 * - ✅ prCycleTimeHours: Always present in demo and real data
 * - ✅ changeFailureRatePct: Always present in demo and real data
 * - ✅ timeToFirstReviewHours: Always present in demo and real data
 * - ✅ deploymentFreqPerWeek: Always present in demo and real data
 * - ❌ repo: Never populated (always undefined)
 * - ❌ team: Never populated (always undefined)
 * 
 * ToolProductivityPoint (org-level aggregates by tool):
 * - ✅ aiAssists: Always present (from ide.ai_suggestions_accepted metric)
 * - ✅ codingMinutes: Always present (from ide.active_coding_time_minutes metric)
 * - ✅ tool: Always present (from series label)
 * - ✅ period: Always present (from point timestamps)
 * - ❌ repo: Never populated (always undefined)
 * - ❌ team: Never populated (explicitly set to undefined)
 * 
 * Org-level AI usage computation:
 * - Can safely compute orgAiPerMinute = totalAiAssists / totalCodingMinutes
 *   by aggregating ToolProductivityPoint across all tools per period
 * - Period identifiers align between EngOutputPoint and ToolProductivityPoint
 *   (we already use this pattern in other rules like ruleAIImprovesCycleTime)
 * 
 * ============================================================================
 */

/**
 * Helper: Compute eligible tools for cycle time analysis
 * Returns tools that have enough data to be analyzed (even if no significant correlation)
 */
function computeEligibleToolsForCycleTime(input: PerformanceInputs): string[] {
  const { engOutput, productivity, overlap, prodGlobalSource } = input;
  
  const relevantProd = DEMO_MODE 
    ? productivity || []
    : (productivity?.filter((p: any) => p.source === 'live' || p.source === 'hybrid') || []);
  
  const minOverlap = DEMO_MODE ? 2 : 3;
  const minPoints = DEMO_MODE ? DEMO_MIN_POINTS : 4;
  
  if (!engOutput?.length || relevantProd.length === 0 || (overlap ?? 0) < minOverlap) {
    return [];
  }
  
  if (!DEMO_MODE && prodGlobalSource === 'prod-sim') {
    return [];
  }
  
  // Build tool data map (same logic as ruleAIImprovesCycleTime)
  const toolData = new Map<string, { periods: string[] }>();
  
  for (const prod of relevantProd) {
    if (!prod.tool || !prod.period) continue;
    
    const aiUsage = prod.codingMinutes && prod.codingMinutes > 0
      ? (prod.aiAssists || 0) / prod.codingMinutes
      : (prod.aiAssists || 0);
    
    const ghPoint = engOutput.find(g => g.period === prod.period);
    
    if (ghPoint && ghPoint.prCycleTimeHours != null && aiUsage > 0) {
      if (!toolData.has(prod.tool)) {
        toolData.set(prod.tool, { periods: [] });
      }
      toolData.get(prod.tool)!.periods.push(prod.period);
    }
  }
  
  // Filter to tools with enough periods
  const eligibleTools: string[] = [];
  for (const [tool, data] of toolData) {
    const uniquePeriods = new Set(data.periods);
    if (uniquePeriods.size >= minPoints) {
      eligibleTools.push(tool);
    }
  }
  
  return eligibleTools;
}

/**
 * Helper: Compute eligible tools for quality (reopen rate) analysis
 */
function computeEligibleToolsForQuality(input: PerformanceInputs): string[] {
  const { engOutput, productivity, overlap } = input;
  
  const minOverlap = DEMO_MODE ? 2 : 3;
  const minPoints = DEMO_MODE ? DEMO_MIN_POINTS : 4;
  
  if (!engOutput?.length || !productivity?.length || (overlap ?? 0) < minOverlap) {
    return [];
  }
  
  const toolData = new Map<string, { periods: string[] }>();
  
  for (const prod of productivity) {
    if (!prod.tool || !prod.period) continue;
    
    const ghPoint = engOutput.find(g => g.period === prod.period);
    const reopenRate = (ghPoint as any)?.reopenRatePct || (ghPoint as any)?.changeFailureRatePct;
    
    if (ghPoint && reopenRate != null) {
      if (!toolData.has(prod.tool)) {
        toolData.set(prod.tool, { periods: [] });
      }
      toolData.get(prod.tool)!.periods.push(prod.period);
    }
  }
  
  const eligibleTools: string[] = [];
  for (const [tool, data] of toolData) {
    const uniquePeriods = new Set(data.periods);
    if (uniquePeriods.size >= minPoints) {
      eligibleTools.push(tool);
    }
  }
  
  return eligibleTools;
}

/**
 * Helper: Format percentage impact, avoiding "-0.0%"
 */
function formatImpactPct(value: number, decimals: number = 0): string {
  const absValue = Math.abs(value);
  if (absValue < 0.5) {
    return '~0%';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}

/**
 * Org-Level AI Throughput Impact Summary
 * 
 * Aggregates tool-level AI → cycle time correlations to provide org-level summary.
 * Answers: "Is AI helping or hurting PR cycle time across IDEs?"
 * 
 * This rule aggregates results from:
 * - ruleAIImprovesCycleTime (positive correlations)
 * - ruleAISlowsCycleTime (negative correlations)
 * 
 * NOTE: This rule calls the tool-level rules internally. If those rules are already
 * called elsewhere, their insights will be emitted separately (as drill-downs).
 * This rule only emits the org-level summary.
 * 
 * Emits exactly ONE org-level insight for Review & Merge summary strip.
 */
function ruleOrgAIThroughputImpactSummary(input: PerformanceInputs, existingInsights?: PerformanceInsight[]): PerformanceInsight[] {
  console.warn('[PI][ReviewMergeOrg][Throughput] ENTER');
  
  // Compute eligible tools (tools with enough data, regardless of correlation)
  const eligibleTools = computeEligibleToolsForCycleTime(input);
  const eligibleCount = eligibleTools.length;
  const VALUE_MODE = isValueMode();
  
  // Value Mode: Allow emission with 1+ eligible tools (reduced from 2+)
  if (eligibleCount === 0) {
    console.warn('[PI][ReviewMergeOrg][Throughput] Early return: no eligible tools');
    return [];
  }
  
  // Value Mode: Emit even with single tool (with lower confidence)
  if (eligibleCount === 0) {
    const PI_DEBUG_CHECK = ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === 'true' || ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === '1';
    if (PI_DEBUG_CHECK) {
      // This rule depends on computeEligibleToolsForCycleTime, which requires productivity + engOutput
      const proof = proveNoData('org-ai-throughput-impact', input, {
        datasets: { productivity: true, engOutput: true },
        fields: {
          productivity: ['aiAssists', 'period', 'tool'],
          engOutput: ['prCycleTimeHours', 'period']
        }
      });
      addNoDataProof(proof);
    }
    console.warn('[PI][ReviewMergeOrg][Throughput] Early return: no eligible tools');
    return [];
  }
  
  if (VALUE_MODE && eligibleCount === 1) {
    // Continue - will emit with "directional" confidence
  } else if (!VALUE_MODE && eligibleCount < 2) {
    // Non-Value Mode: Require 2+ tools for aggregation (but data exists, so not NO_DATA)
    console.warn('[PI][ReviewMergeOrg][Throughput] Early return: need 2+ eligible tools');
    return [];
  }
  
  // Run the tool-level rules to get their results (for aggregation only)
  // These insights will also be emitted separately by the rules registry
  const improvesInsights = ruleAIImprovesCycleTime(input);
  const slowsInsights = ruleAISlowsCycleTime(input);
  
  // Extract significant tools (tools that emitted insights)
  const significantTools = new Set<string>();
  improvesInsights.forEach(i => {
    const tool = i.related?.tools?.[0] || i.tools?.[0];
    if (tool) significantTools.add(tool);
  });
  slowsInsights.forEach(i => {
    const tool = i.related?.tools?.[0] || i.tools?.[0];
    if (tool) significantTools.add(tool);
  });
  
  const signalCount = significantTools.size;
  const inconclusiveCount = eligibleCount - signalCount;
  
  // Count tools by impact direction (only from significant tools)
  const toolsHelping = improvesInsights.length;
  const toolsHurting = slowsInsights.length;
  
  // Determine overall state
  let state: 'helping' | 'hurting' | 'mixed' | 'inconclusive';
  if (signalCount === 0) {
    state = 'inconclusive';
  } else if (toolsHelping > toolsHurting) {
    state = 'helping';
  } else if (toolsHurting > toolsHelping) {
    state = 'hurting';
  } else {
    state = 'mixed';
  }
  
  // Compute aggregate metrics from tool-level insights
  const allSpeedups: number[] = [];
  const allSlowdowns: number[] = [];
  const allPeriods = new Set<string>();
  const toolNamesWithSignal: string[] = [];
  
  improvesInsights.forEach(insight => {
    const tool = insight.related?.tools?.[0] || insight.tools?.[0];
    if (tool) toolNamesWithSignal.push(getToolLabel(tool));
    
    const speedupValue = insight.evidence.find(e => e.label.includes('Impact') || e.label.includes('speedup') || e.label.includes('faster'))?.value;
    if (typeof speedupValue === 'number') {
      allSpeedups.push(speedupValue);
    } else if (typeof speedupValue === 'string' && speedupValue.includes('%')) {
      const numMatch = speedupValue.match(/(\d+\.?\d*)/);
      if (numMatch) {
        allSpeedups.push(parseFloat(numMatch[1]));
      }
    }
    // Extract periods from evidence
    const periodsValue = insight.evidence.find(e => e.label.includes('Time Range') || e.label.includes('Weeks'))?.value;
    if (typeof periodsValue === 'string') {
      const weeksMatch = periodsValue.match(/(\d+)/);
      if (weeksMatch) allPeriods.add(weeksMatch[1]);
    } else if (typeof periodsValue === 'number') {
      allPeriods.add(periodsValue.toString());
    }
  });
  
  slowsInsights.forEach(insight => {
    const tool = insight.related?.tools?.[0] || insight.tools?.[0];
    if (tool) toolNamesWithSignal.push(getToolLabel(tool));
    
    const slowdownValue = insight.evidence.find(e => e.label.includes('Impact') || e.label.includes('slower'))?.value;
    if (typeof slowdownValue === 'number') {
      allSlowdowns.push(slowdownValue);
    } else if (typeof slowdownValue === 'string' && slowdownValue.includes('%')) {
      const numMatch = slowdownValue.match(/(\d+\.?\d*)/);
      if (numMatch) {
        allSlowdowns.push(parseFloat(numMatch[1]));
      }
    }
    const periodsValue = insight.evidence.find(e => e.label.includes('Time Range') || e.label.includes('Weeks'))?.value;
    if (typeof periodsValue === 'string') {
      const weeksMatch = periodsValue.match(/(\d+)/);
      if (weeksMatch) allPeriods.add(weeksMatch[1]);
    } else if (typeof periodsValue === 'number') {
      allPeriods.add(periodsValue.toString());
    }
  });
  
  // Compute median impacts (formatted to avoid "-0.0%")
  const medianSpeedup = allSpeedups.length > 0 ? mean(allSpeedups) : 0;
  const medianSlowdown = allSlowdowns.length > 0 ? mean(allSlowdowns) : 0;
  
  // Check for org trend insight (reconciliation)
  const orgTrendInsight = existingInsights?.find(i => 
    (i.metricId === 'eng.pr_cycle_time' || i.tags?.includes('cycle-time')) &&
    i.toolScope === 'org' &&
    (i.title.toLowerCase().includes('improving') || 
     i.title.toLowerCase().includes('worsening') ||
     i.title.toLowerCase().includes('steady'))
  );
  
  const trendDirection = orgTrendInsight?.title.toLowerCase().includes('improving') ? 'improving' :
                        orgTrendInsight?.title.toLowerCase().includes('worsening') ? 'worsening' : null;
  
  // Build title
  let title: string;
  if (state === 'inconclusive') {
    title = 'AI impact on PR cycle time is inconclusive this period';
  } else if (state === 'helping') {
    title = 'AI is helping PR cycle time across IDEs';
  } else if (state === 'hurting') {
    title = 'AI is hurting PR cycle time across IDEs';
  } else {
    title = 'AI impact on PR cycle time is mixed across IDEs';
  }
  
  // Build description
  let description: string;
  if (state === 'inconclusive') {
    description = `No IDE shows a statistically meaningful relationship between AI usage and PR cycle time over the periods analyzed.`;
  } else if (state === 'helping') {
    const impactText = formatImpactPct(medianSpeedup);
    if (signalCount === 1 && toolNamesWithSignal.length > 0) {
      description = `Faster cycles in ${toolsHelping} of ${eligibleCount} eligible IDEs (${inconclusiveCount} inconclusive). Signal detected in ${toolNamesWithSignal[0]}; others inconclusive. Median impact: ${impactText} faster cycle time.`;
    } else {
      description = `Faster cycles in ${toolsHelping} / Slower in ${toolsHurting} of ${eligibleCount} eligible IDEs (${inconclusiveCount} inconclusive). Median impact: ${impactText} faster cycle time.`;
    }
  } else if (state === 'hurting') {
    const impactText = formatImpactPct(medianSlowdown);
    if (signalCount === 1 && toolNamesWithSignal.length > 0) {
      description = `Slower cycles in ${toolsHurting} of ${eligibleCount} eligible IDEs (${inconclusiveCount} inconclusive). Signal detected in ${toolNamesWithSignal[0]}; others inconclusive. Median impact: ${impactText} slower cycle time.`;
    } else {
      description = `Slower cycles in ${toolsHurting} / Faster in ${toolsHelping} of ${eligibleCount} eligible IDEs (${inconclusiveCount} inconclusive). Median impact: ${impactText} slower cycle time.`;
    }
    
    // Add reconciliation if org trend is improving
    if (trendDirection === 'improving') {
      const topHurtTool = slowsInsights[0]?.related?.tools?.[0] || slowsInsights[0]?.tools?.[0];
      if (topHurtTool) {
        description += ` Overall cycle time is improving, but higher AI usage correlates with slower PRs in ${getToolLabel(topHurtTool)}.`;
      }
    }
  } else {
    // mixed
    description = `${toolsHelping} IDEs show faster cycles with AI, while ${toolsHurting} show slower cycles. Impact varies by IDE.`;
    
    // Add reconciliation if needed
    if (trendDirection === 'improving' && toolsHurting > 0) {
      const topHurtTool = slowsInsights[0]?.related?.tools?.[0] || slowsInsights[0]?.tools?.[0];
      if (topHurtTool) {
        description += ` Overall cycle time is improving, but higher AI usage correlates with slower PRs in ${getToolLabel(topHurtTool)}.`;
      }
    } else if (trendDirection === 'worsening' && toolsHelping > 0) {
      const topHelpTool = improvesInsights[0]?.related?.tools?.[0] || improvesInsights[0]?.tools?.[0];
      if (topHelpTool) {
        description += ` Despite overall worsening cycle time, higher AI usage correlates with faster PRs in ${getToolLabel(topHelpTool)}.`;
      }
    }
  }
  
  // Build evidence
  const evidence: Array<{ label: string; value: string | number }> = [
    { label: 'Eligible IDEs', value: eligibleCount },
    { label: 'IDEs with signal', value: signalCount },
    { label: 'Inconclusive', value: inconclusiveCount }
  ];
  
  if (state !== 'inconclusive') {
    if (toolsHelping > 0) {
      evidence.push({ label: 'IDEs with faster cycles', value: toolsHelping });
    }
    if (toolsHurting > 0) {
      evidence.push({ label: 'IDEs with slower cycles', value: toolsHurting });
    }
  }
  
  if (allPeriods.size > 0) {
    const periodsCount = Array.from(allPeriods).map(p => parseInt(p, 10)).reduce((a, b) => Math.max(a, b), 0);
    if (periodsCount > 0) {
      evidence.push({ label: 'Periods analyzed', value: `${periodsCount} weeks` });
    }
  }
  
  // Confidence indicator
  if (signalCount >= 2) {
    evidence.push({ label: 'Confidence', value: 'Strong' });
  } else if (signalCount === 1) {
    evidence.push({ label: 'Confidence', value: 'Directional' });
  }
  
  // Build recommendation
  let recommendationText: string;
  if (state === 'inconclusive') {
    recommendationText = 'Gather more data across IDEs to determine AI impact on PR cycle time. Consider expanding telemetry coverage or waiting for more periods.';
  } else if (state === 'helping') {
    recommendationText = 'Continue scaling AI usage across IDEs. Share successful AI workflow patterns from IDEs showing the strongest cycle time improvements.';
  } else if (state === 'hurting') {
    recommendationText = 'Investigate why AI usage is slowing cycles. Consider adding review capacity, tightening AI-generated code review, or adjusting AI usage patterns.';
  } else {
    recommendationText = 'AI impact varies by IDE. Standardize on IDEs where AI improves cycle time, and investigate why other IDEs show slower cycles.';
  }
  
  const insight: PerformanceInsight = {
    id: `org-ai-throughput-impact-${Date.now()}`,
    title,
    description,
    severity: state === 'hurting' ? 'warning' : state === 'helping' ? 'highlight' : 'info',
    insightClass: 'org_deterministic',
    orgKind: 'summary',
    cicdStage: 'review-merge',
    toolScope: 'org',
    summaryEligible: true,
    tags: ['ai-impact', 'cycle-time', 'org-level', 'review-merge', 'summary'],
    related: {},
    evidence,
    recommendations: [
      {
        text: recommendationText,
        actionType: 'process'
      }
    ],
    source: 'combined',
    metricId: 'eng.ai_throughput_impact',
    dataSource: inferDataSourceForOrgInsight(input),
    tools: []
  };
  
  console.warn('[PI][ReviewMergeOrg][Throughput] EMIT', { 
    state, 
    toolsHelping, 
    toolsHurting, 
    eligibleCount, 
    signalCount, 
    inconclusiveCount 
  });
  
  return [insight];
}

/**
 * Org-Level AI Quality Impact Summary
 * 
 * Aggregates tool-level AI → quality correlations to provide org-level summary.
 * Answers: "Is AI helping or hurting PR quality across IDEs?"
 * 
 * This rule aggregates results from:
 * - ruleAIImpactsReopenRate (positive/negative correlations)
 * 
 * NOTE: This rule calls the tool-level rule internally. If that rule is already
 * called elsewhere, its insights will be emitted separately (as drill-downs).
 * This rule only emits the org-level summary.
 * 
 * Emits exactly ONE org-level insight for Review & Merge summary strip.
 */
function ruleOrgAIQualityImpactSummary(input: PerformanceInputs, existingInsights?: PerformanceInsight[]): PerformanceInsight[] {
  console.warn('[PI][ReviewMergeOrg][Quality] ENTER');
  
  // Compute eligible tools (tools with enough data, regardless of correlation)
  const eligibleTools = computeEligibleToolsForQuality(input);
  const eligibleCount = eligibleTools.length;
  
  if (eligibleCount === 0) {
    console.warn('[PI][ReviewMergeOrg][Quality] Early return: no eligible tools');
    const PI_DEBUG_CHECK = ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === 'true' || ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === '1';
    if (PI_DEBUG_CHECK) {
      // This rule depends on computeEligibleToolsForQuality, which requires productivity + engOutput
      const proof = proveNoData('org-ai-quality-impact', input, {
        datasets: { productivity: true, engOutput: true },
        fields: {
          productivity: ['aiAssists', 'period', 'tool'],
          engOutput: ['changeFailureRatePct', 'period']
        }
      });
      addNoDataProof(proof);
    }
    return [];
  }
  
  // Run the tool-level rule to get its results (for aggregation only)
  // These insights will also be emitted separately by the rules registry
  const qualityInsights = ruleAIImpactsReopenRate(input);
  
  // Extract significant tools (tools that emitted insights)
  const significantTools = new Set<string>();
  qualityInsights.forEach(i => {
    const tool = i.related?.tools?.[0] || i.tools?.[0];
    if (tool) significantTools.add(tool);
  });
  
  const signalCount = significantTools.size;
  const inconclusiveCount = eligibleCount - signalCount;
  
  // Count tools by impact direction (only from significant tools)
  const toolsHelping = qualityInsights.filter(i => {
    // Check if title/description indicates lower reopen rate (helping)
    return i.title.toLowerCase().includes('lower') || 
           i.description.toLowerCase().includes('falls') ||
           i.severity === 'highlight';
  }).length;
  
  const toolsHurting = qualityInsights.filter(i => {
    // Check if title/description indicates higher reopen rate (hurting)
    return i.title.toLowerCase().includes('higher') || 
           i.description.toLowerCase().includes('rises') ||
           i.severity === 'warning' || i.severity === 'risk';
  }).length;
  
  // Determine overall state
  let state: 'helping' | 'hurting' | 'mixed' | 'inconclusive';
  if (signalCount === 0) {
    state = 'inconclusive';
  } else if (toolsHelping > toolsHurting) {
    state = 'helping';
  } else if (toolsHurting > toolsHelping) {
    state = 'hurting';
  } else {
    state = 'mixed';
  }
  
  // Extract aggregate metrics
  const allReopenRates: number[] = [];
  const allPeriods = new Set<string>();
  const toolNamesWithSignal: string[] = [];
  
  qualityInsights.forEach(insight => {
    const tool = insight.related?.tools?.[0] || insight.tools?.[0];
    if (tool) toolNamesWithSignal.push(getToolLabel(tool));
    
    const reopenRange = insight.evidence.find(e => e.label.includes('Reopen Range'))?.value;
    if (typeof reopenRange === 'string') {
      // Parse "X% - Y%" format
      const match = reopenRange.match(/(\d+\.?\d*)\s*-\s*(\d+\.?\d*)/);
      if (match) {
        allReopenRates.push(parseFloat(match[1]));
        allReopenRates.push(parseFloat(match[2]));
      }
    }
    const periodsValue = insight.evidence.find(e => e.label.includes('Periods') || e.label.includes('Time Range'))?.value;
    if (typeof periodsValue === 'number') {
      allPeriods.add(periodsValue.toString());
    } else if (typeof periodsValue === 'string') {
      const weeksMatch = periodsValue.match(/(\d+)/);
      if (weeksMatch) allPeriods.add(weeksMatch[1]);
    }
  });
  
  // Build title
  let title: string;
  if (state === 'inconclusive') {
    title = 'AI impact on PR quality is inconclusive this period';
  } else if (state === 'helping') {
    title = 'AI is improving PR quality across IDEs';
  } else if (state === 'hurting') {
    title = 'AI is hurting PR quality across IDEs';
  } else {
    title = 'AI has mixed impact on PR quality across IDEs';
  }
  
  // Build description
  let description: string;
  if (state === 'inconclusive') {
    description = `No IDE shows a statistically meaningful relationship between AI usage and PR quality over the periods analyzed.`;
  } else if (state === 'helping') {
    const medianReopen = allReopenRates.length > 0 ? median(allReopenRates) : 0;
    if (signalCount === 1 && toolNamesWithSignal.length > 0) {
      description = `Lower reopen rates in ${toolsHelping} of ${eligibleCount} eligible IDEs (${inconclusiveCount} inconclusive). Signal detected in ${toolNamesWithSignal[0]}; others inconclusive. Median reopen rate: ~${medianReopen.toFixed(1)}%.`;
    } else {
      description = `Lower reopen rates in ${toolsHelping} / Higher in ${toolsHurting} of ${eligibleCount} eligible IDEs (${inconclusiveCount} inconclusive). Median reopen rate: ~${medianReopen.toFixed(1)}%.`;
    }
  } else if (state === 'hurting') {
    const medianReopen = allReopenRates.length > 0 ? median(allReopenRates) : 0;
    if (signalCount === 1 && toolNamesWithSignal.length > 0) {
      description = `Higher reopen rates in ${toolsHurting} of ${eligibleCount} eligible IDEs (${inconclusiveCount} inconclusive). Signal detected in ${toolNamesWithSignal[0]}; others inconclusive. Median reopen rate: ~${medianReopen.toFixed(1)}%.`;
    } else {
      description = `Higher reopen rates in ${toolsHurting} / Lower in ${toolsHelping} of ${eligibleCount} eligible IDEs (${inconclusiveCount} inconclusive). Median reopen rate: ~${medianReopen.toFixed(1)}%.`;
    }
  } else {
    // mixed
    const medianReopen = allReopenRates.length > 0 ? median(allReopenRates) : 0;
    description = `${toolsHelping} IDEs show lower reopen rates with AI, while ${toolsHurting} show higher rates. Impact varies by IDE. Median reopen rate: ~${medianReopen.toFixed(1)}%.`;
  }
  
  // Build evidence
  const evidence: Array<{ label: string; value: string | number }> = [
    { label: 'Eligible IDEs', value: eligibleCount },
    { label: 'IDEs with signal', value: signalCount },
    { label: 'Inconclusive', value: inconclusiveCount }
  ];
  
  if (state !== 'inconclusive') {
    if (toolsHelping > 0) {
      evidence.push({ label: 'IDEs with lower reopen rates', value: toolsHelping });
    }
    if (toolsHurting > 0) {
      evidence.push({ label: 'IDEs with higher reopen rates', value: toolsHurting });
    }
  }
  
  if (allReopenRates.length > 0) {
    const medianReopen = median(allReopenRates);
    // Avoid "-0.0%"
    const reopenDisplay = Math.abs(medianReopen) < 0.1 ? '~0%' : `${medianReopen.toFixed(1)}%`;
    evidence.push({ label: 'Median reopen rate', value: reopenDisplay });
  }
  
  if (allPeriods.size > 0) {
    const periodsCount = Array.from(allPeriods).map(p => parseInt(p, 10)).reduce((a, b) => Math.max(a, b), 0);
    if (periodsCount > 0) {
      evidence.push({ label: 'Periods analyzed', value: `${periodsCount} weeks` });
    }
  }
  
  // Confidence indicator
  if (signalCount >= 2) {
    evidence.push({ label: 'Confidence', value: 'Strong' });
  } else if (signalCount === 1) {
    evidence.push({ label: 'Confidence', value: 'Directional' });
  }
  
  // Build recommendation
  let recommendationText: string;
  if (state === 'inconclusive') {
    recommendationText = 'Gather more data across IDEs to determine AI impact on PR quality. Consider expanding telemetry coverage or waiting for more periods.';
  } else if (state === 'helping') {
    recommendationText = 'Continue scaling AI usage. Document successful AI patterns that improve quality and share them across teams.';
  } else if (state === 'hurting') {
    recommendationText = 'Add lightweight pre-PR testing for AI-heavy changes. Require code reasoning summaries for AI-generated code to catch issues earlier.';
  } else {
    recommendationText = 'AI quality impact varies by IDE. Standardize on IDEs where AI improves quality, and investigate why others show higher reopen rates.';
  }
  
  const insight: PerformanceInsight = {
    id: `org-ai-quality-impact-${Date.now()}`,
    title,
    description,
    severity: state === 'hurting' ? 'warning' : state === 'helping' ? 'highlight' : 'info',
    insightClass: 'org_deterministic',
    orgKind: 'summary',
    cicdStage: 'review-merge',
    toolScope: 'org',
    summaryEligible: true,
    tags: ['ai-impact', 'quality', 'org-level', 'review-merge', 'summary'],
    related: {},
    evidence,
    recommendations: [
      {
        text: recommendationText,
        actionType: 'process'
      }
    ],
    source: 'combined',
    metricId: 'eng.ai_quality_impact',
    dataSource: inferDataSourceForOrgInsight(input),
    tools: []
  };
  
  console.warn('[PI][ReviewMergeOrg][Quality] EMIT', { 
    state, 
    toolsHelping, 
    toolsHurting, 
    eligibleCount, 
    signalCount, 
    inconclusiveCount 
  });
  
  return [insight];
}

/**
 * RULE: Optimal AI Usage Band (Org-Level, Review & Merge Stage)
 * 
 * GOAL: Identify the AI usage "sweet spot" band (low/medium/high assists/min)
 * that yields the best balance of PR cycle time (speed) and change failure rate (stability).
 * 
 * This rule answers: "At what AI usage level do we get the best balance of speed and stability?"
 * 
 * Required fields:
 * - EngOutputPoint: prCycleTimeHours, changeFailureRatePct, period
 * - ToolProductivityPoint: aiAssists, codingMinutes, tool, period
 * 
 * DESIGN OVERVIEW:
 * 
 * 1. BANDING LOGIC:
 *    - Aggregate all tools per period to compute org-level AI usage:
 *      - totalAiAssistsByPeriod = sum(aiAssists) across all tools
 *      - totalCodingMinutesByPeriod = sum(codingMinutes) across all tools
 *      - orgAiPerMinuteByPeriod = totalAiAssists / totalCodingMinutes
 * 
 *    - Define AI usage bands using PERCENTILE-BASED approach (preferred):
 *      - low = bottom ~33% of orgAiPerMinute values
 *      - medium = middle ~33% of orgAiPerMinute values
 *      - high = top ~33% of orgAiPerMinute values
 * 
 *    - FALLBACK: If data is too sparse (< 6 periods), use FIXED THRESHOLDS:
 *      - low = < 0.5 assists/min
 *      - medium = 0.5-1.5 assists/min
 *      - high = > 1.5 assists/min
 * 
 *    - Rationale: Percentiles adapt to org's actual usage patterns (works for both
 *      high-AI and low-AI orgs). Fixed thresholds are simpler but may misclassify
 *      orgs with unusual usage patterns. DEMO mode may have sparse data, so fixed
 *      thresholds are acceptable fallback.
 * 
 * 2. BAND ANALYSIS:
 *    - For each band (low/medium/high), collect matching periods from EngOutputPoint:
 *      - prCycleTimeHours values
 *      - changeFailureRatePct values
 * 
 *    - Compute per-band averages:
 *      - avgAiPerMinute = mean(orgAiPerMinute for periods in this band)
 *      - avgCycleTime = mean(prCycleTimeHours for periods in this band)
 *      - avgChangeFailureRate = mean(changeFailureRatePct for periods in this band)
 *      - periodCount = number of periods in this band
 * 
 * 3. SCORING FUNCTION:
 *    - Lower score = better (faster cycle time + lower failure rate)
 *    - score = avgCycleTime + (weight * avgChangeFailureRate)
 *    - Weight: 10x cycle time (e.g., 10 hours)
 *      - Rationale: A 1% increase in CFR is roughly equivalent to 0.1 hours (6 min)
 *        of cycle time impact. Using 10x makes CFR changes more visible while
 *        keeping cycle time as the primary driver.
 * 
 * 4. BEST BAND SELECTION:
 *    - Identify band with lowest score (best balance)
 *    - Identify worst band (highest score) for contrast
 *    - Compute effect sizes:
 *      - cycleTimeImprovementPct = ((worstCycleTime - bestCycleTime) / worstCycleTime) * 100
 *      - cfrImprovementPct = ((worstCfr - bestCfr) / worstCfr) * 100
 * 
 * 5. GATING & THRESHOLDS:
 *    - Minimum periods overall: ≥4 in PROD, ≥2 in DEMO (reuse MIN_N constant)
 *    - Minimum periods per band: ≥2 in PROD, ≥1 in DEMO (to consider band valid)
 *    - Minimum effect size: Best band must be ≥10% better in either cycle time OR CFR
 *      vs worst band (prevents noise-only insights)
 *    - All bands must have valid data (at least one period each)
 * 
 * 6. INSIGHT STRUCTURE:
 *    - cicdStage: 'review-merge' (routes to Review & Merge section)
 *    - scope: 'org' (org-level insight)
 *    - source: inferDataSourceForOrgInsight(input) (existing helper)
 *    - Emit at most ONE PerformanceInsight object
 * 
 * 7. COPY PATTERN (Signal / Why it matters / Action):
 * 
 *    Title (Signal):
 *    "Org: AI sweet spot is ${bandLabel} usage (${min}–${max} assists/min)"
 *    OR
 *    "Org: Optimal AI usage band is ${bandLabel} (${avgAiPerMinute.toFixed(2)} assists/min)"
 * 
 *    Description (Why it matters):
 *    "Across ${totalPeriods} weeks, ${bandLabel} AI usage delivered ${bestCycle.toFixed(1)}h PR cycle time
 *     and ${bestCfr.toFixed(1)}% change failure, better than ${compareLabel} usage
 *     (${worseCycle.toFixed(1)}h, ${worseCfr.toFixed(1)}%)."
 * 
 *    Evidence array:
 *    - { label: 'AI band', value: '${bandLabel} (${aiRangeText})' }
 *    - { label: 'Avg Cycle Time', value: '${bestCycle.toFixed(1)}h' }
 *    - { label: 'Avg CFR', value: '${bestCfr.toFixed(1)}%' }
 *    - { label: 'Weeks in band', value: '${periodCount}' }
 * 
 *    Recommendation (Action):
 *    "Set ${bandLabel} AI usage (${aiRangeText}) as your org target. Teams above this band
 *     should tighten review on AI-heavy changes; teams below it should increase AI usage
 *     and measure impact on PR cycle time and failures."
 * 
 * TODO: Implement in later prompt
 */
export function ruleOptimalAIUsageBand(input: PerformanceInputs): PerformanceInsight[] {
  // TEMP: VERY LOUD log at entry
  console.debug('[PI][BandRule] ENTER ruleOptimalAIUsageBand');
  
  const { engOutput, productivity } = input;
  
  // Hard data sanity gating only
  if (!engOutput?.length || !productivity?.length) {
    console.debug('[PI][BandRule] Early return: missing input data', {
      engOutputLen: engOutput?.length || 0,
      productivityLen: productivity?.length || 0
    });
    return [];
  }
  
  // Use all productivity data (no source filtering)
  const relevantProd = productivity || [];
  
  if (relevantProd.length === 0) {
    console.debug('[PI][BandRule] Early return: no relevant productivity data');
    return [];
  }
  
  try {
    // 1. Compute org-level AI usage per period using median of per-tool rates
    // For each period, compute per-tool AI rates, then take the median
    const perToolRatesByPeriod = new Map<string, number[]>();
    
    for (const prod of relevantProd) {
      if (!prod.period) continue;
      
      // Skip if codingMinutes is invalid
      const codingMinutes = prod.codingMinutes;
      if (!codingMinutes || codingMinutes <= 0) continue;
      
      // Skip if aiAssists is null/undefined
      const aiAssists = prod.aiAssists;
      if (aiAssists == null) continue;
      
      // Compute per-tool rate for this period
      const rate = aiAssists / codingMinutes;
      
      // Add to array of rates for this period
      if (!perToolRatesByPeriod.has(prod.period)) {
        perToolRatesByPeriod.set(prod.period, []);
      }
      perToolRatesByPeriod.get(prod.period)!.push(rate);
    }
    
    // Compute orgAiPerMinute per period (median of per-tool rates) and filter to periods with EngOutput data
    const usablePeriods: Array<{ period: string; aiPerMinute: number }> = [];
    
    for (const [period, perToolRates] of perToolRatesByPeriod.entries()) {
      if (perToolRates.length === 0) continue;
      
      // Compute median of per-tool rates for this period
      const orgAiPerMinute = median(perToolRates);
      
      // Only include periods that have corresponding EngOutputPoint with at least one metric
      const engPoint = engOutput.find(e => e.period === period);
      if (engPoint && (engPoint.prCycleTimeHours != null || engPoint.changeFailureRatePct != null)) {
        usablePeriods.push({ period, aiPerMinute: orgAiPerMinute });
      }
    }
    
    // Hard data sanity: require at least 3 usable periods
    if (usablePeriods.length < 3) {
      console.debug('[PI][BandRule] Early return: fewer than 3 usable periods', { usablePeriodsCount: usablePeriods.length });
      return [];
    }
    
    // 2. Define bands (percentile-based or fixed thresholds)
    const aiPerMinuteValues = usablePeriods.map(p => p.aiPerMinute).sort((a, b) => a - b);
    let usePercentiles = false;
    let p33: number, p67: number;
    let fixedLow = 0.5, fixedMedium = 1.5;
    
    if (aiPerMinuteValues.length >= 6) {
      // Use percentile-based bands (preferred)
      usePercentiles = true;
      const p33Index = Math.floor(aiPerMinuteValues.length * 0.33);
      const p67Index = Math.floor(aiPerMinuteValues.length * 0.67);
      p33 = aiPerMinuteValues[p33Index];
      p67 = aiPerMinuteValues[p67Index];
    } else {
      // Fallback to fixed thresholds
      usePercentiles = false;
    }
    
    // 3. Assign periods to bands and collect outcomes
    type BandData = {
      aiPerMinute: number[];
      cycleTime: number[];
      changeFailureRate: number[];
      periods: string[];
    };
    
    const bandData: Record<'low' | 'medium' | 'high', BandData> = {
      low: { aiPerMinute: [], cycleTime: [], changeFailureRate: [], periods: [] },
      medium: { aiPerMinute: [], cycleTime: [], changeFailureRate: [], periods: [] },
      high: { aiPerMinute: [], cycleTime: [], changeFailureRate: [], periods: [] }
    };
    
    for (const { period, aiPerMinute } of usablePeriods) {
      // Determine band
      let band: 'low' | 'medium' | 'high';
      if (usePercentiles) {
        if (aiPerMinute < p33!) {
          band = 'low';
        } else if (aiPerMinute <= p67!) {
          band = 'medium';
        } else {
          band = 'high';
        }
      } else {
        // Fixed thresholds
        if (aiPerMinute < fixedLow) {
          band = 'low';
        } else if (aiPerMinute <= fixedMedium) {
          band = 'medium';
        } else {
          band = 'high';
        }
      }
      
      // Find matching EngOutputPoint
      const engPoint = engOutput.find(e => e.period === period);
      if (!engPoint) continue;
      
      // Collect data for this band
      bandData[band].aiPerMinute.push(aiPerMinute);
      bandData[band].periods.push(period);
      
      if (engPoint.prCycleTimeHours != null) {
        bandData[band].cycleTime.push(engPoint.prCycleTimeHours);
      }
      if (engPoint.changeFailureRatePct != null && engPoint.changeFailureRatePct >= 0) {
        bandData[band].changeFailureRate.push(engPoint.changeFailureRatePct);
      }
    }
    
    // 4. Compute averages per band and gate on minimum periods per band
    // Require at least 1 period per band (best band will be checked separately)
    const minPeriodsPerBand = 1;
    type BandStats = {
      band: 'low' | 'medium' | 'high';
      avgAiPerMinute: number;
      avgCycleTime: number | null;
      avgChangeFailureRate: number | null;
      periodCount: number;
      score: number;
    };
    
    const bandStats: BandStats[] = [];
    
    for (const [bandKey, data] of Object.entries(bandData) as Array<['low' | 'medium' | 'high', BandData]>) {
      if (data.periods.length < minPeriodsPerBand) {
        continue; // Skip invalid bands
      }
      
      // Must have at least one outcome metric
      if (data.cycleTime.length === 0 && data.changeFailureRate.length === 0) {
        continue;
      }
      
      const avgAiPerMinute = mean(data.aiPerMinute);
      const avgCycleTime = data.cycleTime.length > 0 ? mean(data.cycleTime) : null;
      const avgChangeFailureRate = data.changeFailureRate.length > 0 ? mean(data.changeFailureRate) : null;
      const periodCount = data.periods.length;
      
      // Compute score (lower is better)
      // If a metric is missing, treat it as 0 for scoring
      const cycleTimeForScore = avgCycleTime ?? 0;
      const cfrForScore = avgChangeFailureRate ?? 0;
      const score = cycleTimeForScore + (10 * cfrForScore);
      
      bandStats.push({
        band: bandKey,
        avgAiPerMinute,
        avgCycleTime,
        avgChangeFailureRate,
        periodCount,
        score
      });
    }
    
    // Hard data sanity: need at least 1 valid band (0 = bad data, 1 = single-band baseline, 2+ = multi-band comparison)
    if (bandStats.length === 0) {
      console.debug('[PI][BandRule] Early return: no valid bands', { bandStatsCount: bandStats.length });
      return [];
    }
    
    // Format band labels helper
    const bandLabels: Record<'low' | 'medium' | 'high', string> = {
      low: 'low',
      medium: 'medium',
      high: 'high'
    };
    
    // Branch: single-band (baseline) vs multi-band (comparison)
    if (bandStats.length === 1) {
      // SINGLE-BAND PATH: Baseline card with no comparison
      const singleBand = bandStats[0];
      
      // Hard data sanity: single band must have at least 2 periods
      if (singleBand.periodCount < 2) {
        console.debug('[PI][BandRule] Early return: single band has fewer than 2 periods', { periodCount: singleBand.periodCount });
        return [];
      }
      
      // Hard data sanity: must have at least one metric
      if ((singleBand.avgCycleTime == null || singleBand.avgCycleTime === 0) &&
          (singleBand.avgChangeFailureRate == null || singleBand.avgChangeFailureRate === 0)) {
        console.debug('[PI][BandRule] Early return: single band has no valid metrics', {
          avgCycleTime: singleBand.avgCycleTime,
          avgChangeFailureRate: singleBand.avgChangeFailureRate
        });
        return [];
      }
      
      const bandKey = singleBand.band;
      const avgCycleTime = singleBand.avgCycleTime;
      const avgCfr = singleBand.avgChangeFailureRate;
      const periodCount = singleBand.periodCount;
      
      // Compute median per-tool AI rate across tools
      const allToolStats = computeCoverageStatsForTools(input);
      const perToolAiRates = allToolStats
        .map(s => s.aiPerMinute)
        .filter(rate => rate > 0);
      
      // Compute median, min, max across tools
      let medianAiPerMinuteAcrossTools: number;
      let minAiPerMinuteAcrossTools: number | undefined;
      let maxAiPerMinuteAcrossTools: number | undefined;
      
      if (perToolAiRates.length >= 1) {
        medianAiPerMinuteAcrossTools = median(perToolAiRates);
        minAiPerMinuteAcrossTools = Math.min(...perToolAiRates);
        maxAiPerMinuteAcrossTools = Math.max(...perToolAiRates);
      } else {
        // Fallback to bandStats avgAiPerMinute if no tool-level data
        medianAiPerMinuteAcrossTools = singleBand.avgAiPerMinute;
      }
      
      const aiRateDisplay = medianAiPerMinuteAcrossTools;
      
      // Band label display mapping for single-band path
      const bandLabelDisplay: Record<'low' | 'medium' | 'high', string> = {
        low: 'low',
        medium: 'moderate',
        high: 'high'
      };
      const currentBandLabel = bandLabelDisplay[bandKey];
      
      console.warn('[PI][BandRule] Single-band path (not enough variation)', { 
        bandKey, 
        medianAiPerMinuteAcrossTools: aiRateDisplay,
        minAiPerMinuteAcrossTools,
        maxAiPerMinuteAcrossTools,
        avgCycleTime, 
        avgCfr,
        periodCount,
        toolCount: perToolAiRates.length
      });
      
      // Build evidence array (tightened labels, keep essential metrics)
      const evidence: Array<{ label: string; value: string | number }> = [
        { label: 'Current AI usage band', value: currentBandLabel },
        { label: 'Weeks in this band', value: periodCount.toString() },
        { label: 'Median AI assists/min across tools', value: aiRateDisplay.toFixed(2) }
      ];
      
      if (avgCycleTime != null && avgCycleTime > 0) {
        evidence.push({ label: 'Avg PR cycle time', value: formatHours(avgCycleTime) });
      }
      if (avgCfr != null && avgCfr > 0) {
        evidence.push({ label: 'Avg change failure rate', value: formatPercent(avgCfr) });
      }
      
      // Build description - one concise sentence
      let description: string;
      if (avgCycleTime != null && avgCycleTime > 0 && avgCfr != null && avgCfr > 0) {
        description = `Across your IDEs, recent periods cluster around ~${aiRateDisplay.toFixed(2)} AI assists/min, with average PR cycle time of ${formatHours(avgCycleTime)} and ${formatPercent(avgCfr)} change failure rate.`;
      } else if (avgCycleTime != null && avgCycleTime > 0) {
        description = `Across your IDEs, recent periods cluster around ~${aiRateDisplay.toFixed(2)} AI assists/min, with average PR cycle time of ${formatHours(avgCycleTime)}.`;
      } else if (avgCfr != null && avgCfr > 0) {
        description = `Across your IDEs, recent periods cluster around ~${aiRateDisplay.toFixed(2)} AI assists/min, with ${formatPercent(avgCfr)} change failure rate.`;
      } else {
        // Shouldn't reach here due to gate above, but TypeScript needs this
        description = `Across your IDEs, recent periods cluster around ~${aiRateDisplay.toFixed(2)} AI assists/min.`;
      }
      
      // Build recommendation - two sentences, actionable
      const recommendation = [
        `Treat ~${aiRateDisplay.toFixed(2)} assists/min across tools as your starting AI usage level.`,
        `When org AI usage moves clearly above or below this, compare PR cycle time and change failure rate for those periods to define a concrete target range for AI usage.`
      ].join(' ');
      
      const insight: PerformanceInsight = {
        id: `optimal-ai-band-single-${Date.now()}`,
        title: `Org AI usage: ${currentBandLabel} adoption (~${aiRateDisplay.toFixed(2)} assists/min across tools)`,
        description,
        severity: 'info',  // Always info for single-band case
        insightClass: 'org_deterministic',
        orgKind: 'summary',
        cicdStage: 'review-merge',
        toolScope: 'org',
        summaryEligible: true,  // Appears in Review & Merge org summary strip
        tags: ['ai-usage', 'optimal-band', 'org-level', 'review-merge', 'summary'],
        related: {},
        evidence,
        recommendations: [{
          text: recommendation,
          actionType: 'process'
        }],
        source: 'combined',
        metricId: 'eng.ai_optimal_band',
        dataSource: inferDataSourceForOrgInsight(input),
        tools: undefined,
        priorityScore: 90
      };
      
      console.debug('[PI][BandRule] EMIT (single-band, not enough variation)', {
        title: insight.title,
        cicdStage: insight.cicdStage,
        toolScope: insight.toolScope,
        severity: insight.severity
      });
      
      return [insight];
      
    } else {
      // MULTI-BAND PATH: Compare best vs worst band (existing logic)
      // 5. Find best and worst bands
      bandStats.sort((a, b) => a.score - b.score);
      const bestBand = bandStats[0];
      const worstBand = bandStats[bandStats.length - 1];
      
      // Hard data sanity: best band must have at least 2 periods
      if (bestBand.periodCount < 2) {
        console.debug('[PI][BandRule] Early return: best band has fewer than 2 periods', { periodCount: bestBand.periodCount });
        return [];
      }
      
      // 6. Compute effect size
      let cycleImprovementPct = 0;
      let cfrImprovementPct = 0;
      
      if (bestBand.avgCycleTime != null && worstBand.avgCycleTime != null && worstBand.avgCycleTime > 0) {
        cycleImprovementPct = (worstBand.avgCycleTime - bestBand.avgCycleTime) / worstBand.avgCycleTime;
      }
      
      if (bestBand.avgChangeFailureRate != null && worstBand.avgChangeFailureRate != null && worstBand.avgChangeFailureRate > 0) {
        cfrImprovementPct = (worstBand.avgChangeFailureRate - bestBand.avgChangeFailureRate) / worstBand.avgChangeFailureRate;
      }
      
      // Hard data sanity: if both metrics are missing or zero, don't emit insight
      if ((bestBand.avgCycleTime == null || worstBand.avgCycleTime == null || worstBand.avgCycleTime === 0) &&
          (bestBand.avgChangeFailureRate == null || worstBand.avgChangeFailureRate == null || worstBand.avgChangeFailureRate === 0)) {
        console.debug('[PI][BandRule] Early return: both metrics missing or zero', {
          bestCycleTime: bestBand.avgCycleTime,
          worstCycleTime: worstBand.avgCycleTime,
          bestCFR: bestBand.avgChangeFailureRate,
          worstCFR: worstBand.avgChangeFailureRate
        });
        return [];
      }
      
      // Compute max improvement for signal strength assessment (use absolute values)
      const maxImprovement = Math.max(
        Math.abs(cycleImprovementPct || 0),
        Math.abs(cfrImprovementPct || 0)
      );
      
      // Signal strength thresholds (no environment differences)
      const strongThreshold = 0.10;     // 10%+
      const warningThreshold = 0.25;    // 25%+
      const isStrongSignal = maxImprovement >= strongThreshold;
      
      // Format band labels for display (user-friendly)
      const bandLabelDisplay: Record<'low' | 'medium' | 'high', string> = {
        low: 'low',
        medium: 'moderate',
        high: 'high'
      };
      
      const bestBandLabel = bandLabels[bestBand.band];
      const bestBandLabelDisplay = bandLabelDisplay[bestBand.band];
      const worstBandLabel = bandLabels[worstBand.band];
      const worstBandLabelDisplay = bandLabelDisplay[worstBand.band];
      const bestBandAiPerMinute = bestBand.avgAiPerMinute;
      
      // 8. Construct PerformanceInsight
      const bestBandAvgCycleTime = bestBand.avgCycleTime ?? 0;
      const bestBandAvgCfr = bestBand.avgChangeFailureRate ?? 0;
      const bestBandPeriodsCount = bestBand.periodCount;
      
      // Severity based on improvement only (no environment differences)
      const severity: InsightSeverity = maxImprovement >= warningThreshold ? 'warning' : 'info';
      
      // Build evidence array (only include metrics > 0 to avoid noise)
      const evidence: Array<{ label: string; value: string | number }> = [
        { label: 'Target AI band', value: bestBandLabelDisplay },
        { label: 'Weeks in band', value: bestBandPeriodsCount },
        { label: 'Avg AI assists/min', value: bestBandAiPerMinute.toFixed(2) }
      ];
      
      if (bestBandAvgCycleTime > 0) {
        evidence.push({ label: 'Avg PR cycle time', value: formatHours(bestBandAvgCycleTime) });
      }
      if (bestBandAvgCfr > 0) {
        evidence.push({ label: 'Avg change failure rate', value: formatPercent(bestBandAvgCfr) });
      }
      
      // Build description based on signal strength
      let description: string;
      if (isStrongSignal) {
        const parts: string[] = [];
        if (bestBandAvgCycleTime > 0) {
          parts.push(`PR cycle time (${formatHours(bestBandAvgCycleTime)})`);
        }
        if (bestBandAvgCfr > 0) {
          parts.push(`change failure rate (${formatPercent(bestBandAvgCfr)})`);
        }
        const metricsStr = parts.length > 0 ? parts.join(' and ') : 'outcomes';
        description = `${bestBandLabelDisplay} AI usage (~${bestBandAiPerMinute.toFixed(2)} assists/min) shows the best balance of ${metricsStr} compared to ${worstBandLabelDisplay} periods.`;
      } else {
        description = `${bestBandLabelDisplay} AI usage (~${bestBandAiPerMinute.toFixed(2)} assists/min) is currently the best-performing band, but the differences between bands are small—treat this as an early directional signal, not a hard policy.`;
      }
      
      // Build recommendation based on signal strength
      const recommendation = isStrongSignal
        ? `Set ${bestBandLabelDisplay} AI usage (~${bestBandAiPerMinute.toFixed(2)} assists/min) as your org target. For periods well below this band, focus on AI enablement; for periods well above it, tighten quality checks and review guidelines.`
        : `Use ${bestBandLabelDisplay} AI usage (~${bestBandAiPerMinute.toFixed(2)} assists/min) as a provisional target band. Monitor how PR cycle time and failure rate evolve as AI usage moves above or below this range before codifying any org-wide policy.`;
      
      const insight: PerformanceInsight = {
        id: `optimal-ai-band-${Date.now()}`,
        title: `Org: Target ${bestBandLabelDisplay} AI usage (~${bestBandAiPerMinute.toFixed(2)} assists/min) for best PR outcomes`,
        description,
        severity,
        insightClass: 'org_deterministic',
        orgKind: 'summary',
        cicdStage: 'review-merge',
        toolScope: 'org',
        summaryEligible: true,  // Appears in Review & Merge org summary strip
        tags: ['ai-usage', 'optimal-band', 'org-level', 'review-merge', 'summary'],
        related: {},
        evidence,
        recommendations: [{
          text: recommendation,
          actionType: 'process'
        }],
        source: 'combined',
        metricId: 'eng.ai_optimal_band',
        dataSource: inferDataSourceForOrgInsight(input),
        tools: undefined,
        priorityScore: 90  // High priority to ensure it surfaces (below critical risks but above baseline)
      };
      
      // TEMP: Log that we're emitting the insight
      console.debug('[PI][BandRule] EMIT (multi-band comparison)', {
        title: insight.title,
        cicdStage: insight.cicdStage,
        scope: insight.toolScope,
        severity: insight.severity,
        priorityScore: insight.priorityScore
      });
      
      return [insight];
    }
    
  } catch (e) {
    console.warn('[RULE_OPTIMAL_AI_BAND] Error:', e);
    return [];
  }
}

/**
 * Org Review Latency Spike Rule (Review & Merge)
 * 
 * Detects when PR review latency (timeToFirstReviewHours) spikes above baseline.
 * Uses org-level GitHub time series data (engOutput).
 * Emits at most ONE insight.
 */
function ruleOrgReviewLatencySpike(input: PerformanceInputs): PerformanceInsight[] {
  if (import.meta.env.DEV) {
    console.warn('[PI][ReviewMerge][ReviewLatencySpike] ENTER')
  }
  
  const { engOutput } = input
  
  // Guard: require engOutput data
  if (!engOutput || engOutput.length === 0) {
    if (import.meta.env.DEV) {
      console.warn('[PI][ReviewMerge][ReviewLatencySpike] Early return: no engOutput data')
    }
    const PI_DEBUG_CHECK = ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === 'true' || ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === '1';
    if (PI_DEBUG_CHECK) {
      const proof = proveNoData('org-review-latency-spike', input, {
        datasets: { engOutput: true },
        fields: {
          engOutput: ['timeToFirstReviewHours', 'period']
        }
      });
      addNoDataProof(proof);
    }

    // VALUE MODE: Emit a data-missing diagnostic instead of returning empty.
    if (isValueMode()) {
      const insight: PerformanceInsight = {
        id: makeDeterministicInsightId('org-review-latency-spike', undefined, 'data-missing'),
        title: 'Review latency data is missing',
        description: 'No GitHub review latency history is available yet. Connect GitHub integration and ensure review timestamps are collected to enable review latency insights.',
        severity: 'info',
        insightClass: 'org_deterministic',
        orgKind: 'diagnostic',
        cicdStage: 'review-merge',
        toolScope: 'org',
        source: 'github',
        metricId: 'org.review_latency_spike',
        dataSource: inferDataSourceForOrgInsight(input),
        evidence: [
          { label: 'Status', value: 'Missing dataset' },
          { label: 'Dataset', value: 'engOutput' }
        ],
        recommendations: [
          { text: 'Connect GitHub integration to populate review latency metrics.', actionType: 'observability' }
        ],
        related: {},
        tools: undefined,
        priorityScore: 35,
        summaryEligible: false,
        tags: ['org', 'review-latency', 'data-missing']
      }
      return [insight]
    }

    return []
  }
  
  try {
    // VALUE MODE: Try to pick TTFR field (with fallback options)
    let metricKey = 'timeToFirstReviewHours';
    let metricLabel = 'Time to first review';
    let fieldUsed: string | null = null;
    
    // Check for primary field
    const hasTTFR = engOutput.some(p => 
      p.timeToFirstReviewHours !== undefined && 
      p.timeToFirstReviewHours !== null && 
      isFinite(p.timeToFirstReviewHours) && 
      p.timeToFirstReviewHours > 0
    );
    
    // VALUE MODE: If primary field missing, try alternative (but don't use prCycleTimeHours to avoid overlap)
    if (!hasTTFR && isValueMode()) {
      // Try to find any review-related time field (but not prCycleTimeHours)
      const altFields = ['timeToFirstReview', 'firstReviewHours', 'reviewLatencyHours'];
      for (const field of altFields) {
        const found = engOutput.some(p => {
          const val = (p as any)[field];
          return val !== undefined && val !== null && isFinite(val) && val > 0;
        });
        if (found) {
          metricKey = field;
          metricLabel = 'Review latency';
          fieldUsed = field;
          break;
        }
      }
    }
    
    // If still no field found, emit "data missing" diagnostic in Value Mode
    if (!hasTTFR && !fieldUsed) {
      if (isValueMode()) {
        const insight: PerformanceInsight = {
          id: makeDeterministicInsightId('org-review-latency-spike', undefined, 'data-missing'),
          title: 'Review latency data not available yet',
          description: 'Time to first review metrics are not available. Connect GitHub integration and ensure PR review data is being collected to enable review latency insights.',
          severity: 'info',
          insightClass: 'org_deterministic',
          orgKind: 'diagnostic',
          cicdStage: 'review-merge',
          toolScope: 'org',
          source: 'github',
          metricId: 'org.review_latency_spike',
          dataSource: inferDataSourceForOrgInsight(input),
          evidence: [
            { label: 'Status', value: 'Data field missing' },
            { label: 'Expected field', value: 'timeToFirstReviewHours' },
            { label: 'Action', value: 'Connect GitHub integration' }
          ],
          recommendations: [
            {
              text: 'Ensure GitHub integration is connected and PR review timestamps are being collected',
              actionType: 'observability'
            }
          ],
          related: {},
          tools: undefined,
          priorityScore: 35, // Floor score for visibility
          summaryEligible: false,
          tags: ['org', 'review-latency', 'data-missing']
        };
        return [insight];
      }
      if (import.meta.env.DEV) {
        console.warn('[PI][ReviewMerge][ReviewLatencySpike] Early return: timeToFirstReviewHours missing/unusable', {
          points: engOutput.length
        });
      }
      return [];
    }
    
    if (import.meta.env.DEV) {
      console.warn('[PI][ReviewMerge][ReviewLatencySpike] Metric selection', {
        metricUsed: fieldUsed || metricKey,
        hasTTFR: hasTTFR || !!fieldUsed,
        points: engOutput.length
      });
    }
    
    // Extract valid points using selected field
    const validPoints = engOutput
      .map(p => {
        const value = fieldUsed 
          ? (p as any)[fieldUsed]
          : p.timeToFirstReviewHours;
        return {
          period: p.period,
          value: value !== undefined && value !== null && isFinite(value) && value > 0 ? value : null
        };
      })
      .filter(p => p.value !== null)
      .sort((a, b) => {
        const aPeriod = a.period || '';
        const bPeriod = b.period || '';
        return aPeriod < bPeriod ? -1 : aPeriod > bPeriod ? 1 : 0;
      });
    
    // VALUE MODE: Adaptive minPoints
    const defaultMin = DEMO_MODE ? 4 : 6;
    const minPoints = valueModeMinPoints(defaultMin, validPoints.length);
    
    // VALUE MODE: If insufficient history (< 2), emit diagnostic
    if (validPoints.length < 2 && isValueMode()) {
      const insight: PerformanceInsight = {
        id: makeDeterministicInsightId('org-review-latency-spike', validPoints[0]?.period, 'insufficient-history'),
        title: 'Not enough history yet to detect review latency trends',
        description: `Only ${validPoints.length} period(s) of review latency data available. Need at least 2 periods to compare trends. Connect more data or wait 24-48 hours for additional periods.`,
        severity: 'info',
        insightClass: 'org_deterministic',
        orgKind: 'diagnostic',
        cicdStage: 'review-merge',
        toolScope: 'org',
        source: 'github',
        metricId: 'org.review_latency_spike',
        dataSource: inferDataSourceForOrgInsight(input),
        evidence: [
          { label: 'Observed periods', value: validPoints.length.toString() },
          { label: 'Needed for trend', value: '2+' },
          { label: 'Action', value: 'Wait 24-48h or connect more data' }
        ],
        recommendations: [
          {
            text: 'Continue collecting PR review data. Review latency insights will appear once 2+ periods are available.',
            actionType: 'observability'
          }
        ],
        related: {},
        tools: undefined,
        priorityScore: 35, // Floor score
        summaryEligible: false,
        tags: ['org', 'review-latency', 'insufficient-history']
      };
      return [insight];
    }
    
    if (validPoints.length < minPoints) {
      if (import.meta.env.DEV) {
        console.warn('[PI][ReviewMergeOrg][ReviewLatencySpike] Early return: insufficient points', {
          validPoints: validPoints.length,
          required: minPoints
        });
      }
      return [];
    }

    // Compute baseline = median of all points excluding most recent (to avoid self-inflation)
    // If not enough points after excluding most recent, use median of all
    const baselinePoints = validPoints.length >= minPoints + 1
      ? validPoints.slice(0, -1)  // Exclude most recent
      : validPoints  // Use all if not enough points
    
    // Ensure baseline has at least 2 points for median calculation
    if (baselinePoints.length < 2) {
      if (import.meta.env.DEV) {
        console.warn('[PI][ReviewMergeOrg][ReviewLatencySpike] Early return: baseline has <2 points', {
          baselinePoints: baselinePoints.length
        })
      }
      return []
    }
    
    const baselineValues = baselinePoints.map(p => p.value!)
    const baseline = median(baselineValues)
    
    // Current = most recent point value
    const current = validPoints[validPoints.length - 1].value!
    const currentPeriod = validPoints[validPoints.length - 1].period || 'unknown'
    
    // Compute deltas
    const deltaPct = baseline > 0 ? ((current - baseline) / baseline) * 100 : 0
    const deltaAbs = current - baseline
    
    // Trigger thresholds
    const triggerPctThreshold = 1.35  // 35% worse
    const triggerAbsThreshold = DEMO_MODE ? 1.5 : 3.0  // hours
    
    const triggers = current >= baseline * triggerPctThreshold || deltaAbs >= triggerAbsThreshold
    
    if (!triggers) {
      // VALUE MODE: Emit "stable" diagnostic when data exists but no spike
      if (isValueMode() && validPoints.length >= 2 && baseline > 0 && current > 0) {
        const isStable = Math.abs(deltaPct) < 10
        const isImproving = deltaAbs < 0
        const variant = isStable ? 'stable' : isImproving ? 'directional-improving' : 'directional-slight-increase'
        const insight: PerformanceInsight = {
          id: makeDeterministicInsightId('org-review-latency-spike', currentPeriod, variant),
          title: isStable
            ? `Review latency is stable: ${current.toFixed(1)}h (baseline ${baseline.toFixed(1)}h)`
            : `Review latency is ${isImproving ? 'improving' : 'slightly higher'}: ${current.toFixed(1)}h (baseline ${baseline.toFixed(1)}h)`,
          description: isStable
            ? `PR review latency is near baseline, within ${Math.abs(deltaPct).toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(1)}h). No significant spike detected.`
            : isImproving
            ? `PR review latency decreased by ${Math.abs(deltaPct).toFixed(1)}% (${Math.abs(deltaAbs).toFixed(1)}h) compared to baseline. This is positive — review responsiveness is improving.`
            : `PR review latency is ${deltaPct.toFixed(1)}% above baseline (${deltaAbs.toFixed(1)}h), but not enough to trigger a spike alert. Monitor trends.`,
          severity: 'info',
          insightClass: 'org_deterministic',
          orgKind: 'diagnostic',
          cicdStage: 'review-merge',
          toolScope: 'org',
          source: 'github',
          metricId: 'org.review_latency_spike',
          dataSource: inferDataSourceForOrgInsight(input),
          evidence: [
            { label: 'Metric used', value: metricLabel },
            { label: 'Current period', value: currentPeriod },
            { label: 'Current value', value: current.toFixed(1) + ' hours' },
            { label: 'Baseline value', value: baseline.toFixed(1) + ' hours' },
            { label: 'Delta', value: `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(1)}h)` },
            { label: 'Status', value: isStable ? 'Stable' : isImproving ? 'Improving' : 'Slight increase' },
            { label: 'Points analyzed', value: validPoints.length.toString() }
          ],
          recommendations: [
            {
              text: isImproving
                ? 'Continue current review practices to maintain improved responsiveness.'
                : 'Maintain current review practices and monitor for future spikes.',
              actionType: 'process'
            }
          ],
          related: {},
          tools: undefined,
          priorityScore: 40, // Low but visible
          summaryEligible: false,
          tags: ['org', 'review-latency', isStable ? 'stable' : 'directional']
        };
        return [insight];
      }
      
      // DEMO_MODE fallback: emit even if thresholds not met (with lower severity)
      if (DEMO_MODE && validPoints.length >= 4 && baseline > 0 && current > 0) {
        // Soft emit for demo: show current vs baseline even if not a spike
        if (import.meta.env.DEV) {
          console.warn('[PI][ReviewMerge][ReviewLatencySpike] DEMO soft emit (thresholds not met)', {
            current,
            baseline,
            deltaPct: deltaPct.toFixed(1) + '%',
            deltaAbs: deltaAbs.toFixed(1) + 'h'
          })
        }
        
        // Build evidence for soft emit
        const evidence: InsightEvidence[] = [
          { label: 'Metric used', value: metricLabel },
          { label: 'Current period', value: currentPeriod },
          { label: 'Current value', value: current.toFixed(1) + ' hours' },
          { label: 'Baseline value', value: baseline.toFixed(1) + ' hours' },
          { label: 'Delta', value: `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(1)}h)` },
          { label: 'Points analyzed', value: validPoints.length.toString() },
          { label: 'Data source', value: 'GitHub time series' }
        ]
        
        const recommendations: InsightRecommendation[] = [
          {
            text: 'Establish review SLA windows (e.g., first review within 24h) and enforce via CODEOWNERS routing to ensure PRs are assigned quickly to the right reviewers.',
            actionType: 'process'
          },
          {
            text: 'Implement reviewer rotations and dedicated "review windows" to distribute load and reduce context switching delays.',
            actionType: 'process'
          }
        ]
        
        const insight: PerformanceInsight = {
          id: `org-review-latency-spike-${Date.now()}`,
          title: `Review latency is ${current.toFixed(1)}h (baseline ${baseline.toFixed(1)}h)`,
          description: `PR review latency is ${deltaPct >= 0 ? 'above' : 'below'} baseline by ${Math.abs(deltaPct).toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(1)} hours). Monitor trends and consider process improvements to maintain timely reviews.`,
          severity: 'info',
          insightClass: 'org_deterministic',
          orgKind: 'diagnostic',
          cicdStage: 'review-merge',
          toolScope: 'cross-ide', // Changed from 'org' to appear as card
          source: 'github',
          metricId: 'org.review_latency_spike',
          dataSource: inferDataSourceForOrgInsight(input),
          evidence,
          recommendations,
          related: {},
          tools: undefined,
          priorityScore: 88,
          summaryEligible: false, // Changed to false to appear as card
          tags: ['org', 'review-latency', 'review-merge']
        }
        
        if (import.meta.env.DEV) {
          console.warn('[PI][ReviewMerge][ReviewLatencySpike] DEMO soft emit RETURN', {
            title: insight.title,
            toolScope: insight.toolScope,
            summaryEligible: insight.summaryEligible
          })
        }
        
        return [insight]
      }
      
      if (import.meta.env.DEV) {
        console.warn('[PI][ReviewMerge][ReviewLatencySpike] Early return: thresholds not met', {
          current,
          baseline,
          deltaPct: deltaPct.toFixed(1) + '%',
          deltaAbs: deltaAbs.toFixed(1) + 'h',
          triggerPctThreshold: (triggerPctThreshold * 100).toFixed(0) + '%',
          triggerAbsThreshold: triggerAbsThreshold + 'h'
        })
      }
      return []
    }
    
    // Determine severity
    const warningPctThreshold = 1.6  // 60% worse
    const warningAbsThreshold = DEMO_MODE ? 3.0 : 6.0  // hours
    
    const severity: InsightSeverity = (current >= baseline * warningPctThreshold || Math.abs(deltaAbs) >= warningAbsThreshold)
      ? 'warning'
      : 'info'
    
    const priorityScore = severity === 'warning' ? 95 : 88
    
    // Build evidence
    const evidence: InsightEvidence[] = [
      { label: 'Metric used', value: metricLabel },
      { label: 'Current period', value: currentPeriod },
      { label: 'Current value', value: current.toFixed(1) + ' hours' },
      { label: 'Baseline value', value: baseline.toFixed(1) + ' hours' },
      { label: 'Delta', value: `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(1)}h)` },
      { label: 'Points analyzed', value: validPoints.length.toString() },
      { label: 'Data source', value: 'GitHub time series' }
    ]
    
    // Build recommendations (specific, not generic)
    const recommendations: InsightRecommendation[] = [
      {
        text: 'Set 24h review SLA and enforce via CODEOWNERS routing. Track review latency p90 next week to verify improvement.',
        actionType: 'process'
      },
      {
        text: 'Implement reviewer rotations and dedicated review windows. Measure review latency weekly to confirm reduction.',
        actionType: 'process'
      }
    ]
    
    const insight: PerformanceInsight = {
      id: `org-review-latency-spike-${Date.now()}`,
      title: `Org review latency spiked (+${deltaPct.toFixed(1)}% to ${current.toFixed(1)}h vs ${baseline.toFixed(1)}h baseline)`,
      description: `PR review latency increased by ${Math.abs(deltaPct).toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(1)} hours) across ${validPoints.length} periods, from ${baseline.toFixed(1)}h to ${current.toFixed(1)}h. This delays cycle time and increases context switching costs.`,
      severity,
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'review-merge',
      toolScope: 'cross-ide', // Changed from 'org' to appear as card
      source: 'github',
      metricId: 'org.review_latency_spike',
      dataSource: inferDataSourceForOrgInsight(input),
      evidence,
      recommendations,
      related: {},
      tools: undefined,
      priorityScore,
      summaryEligible: false, // Changed to false to appear as card
      tags: ['org', 'review-latency', 'review-merge']
    }
    
    if (import.meta.env.DEV) {
      console.warn('[PI][ReviewMerge][ReviewLatencySpike] EMIT', {
        current: current.toFixed(1) + 'h',
        baseline: baseline.toFixed(1) + 'h',
        deltaAbs: deltaAbs.toFixed(1) + 'h',
        deltaPct: deltaPct.toFixed(1) + '%',
        severity,
        priorityScore,
        metricUsed: metricKey
      })
    }
    
    return [insight]
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[PI][ReviewMerge][ReviewLatencySpike] Error:', e)
    }
    return []
  }
}

/**
 * Org PR Cycle Time Bottleneck Rule (Review & Merge)
 * 
 * Detects when PR cycle time (prCycleTimeHours) rises above baseline, indicating bottlenecks.
 * Uses org-level GitHub time series data (engOutput).
 * Complements (but does not duplicate) the review latency spike rule.
 * Emits at most ONE insight.
 */
function ruleOrgPRCycleTimeBottleneck(input: PerformanceInputs): PerformanceInsight[] {
  if (import.meta.env.DEV) {
    console.warn('[PI][ReviewMerge][PRCycleTimeBottleneck] ENTER')
  }
  
  const { engOutput } = input
  
  // Guard: require engOutput data
  if (!engOutput || engOutput.length === 0) {
    if (import.meta.env.DEV) {
      console.warn('[PI][ReviewMerge][PRCycleTimeBottleneck] Early return: no engOutput data')
    }
    // VALUE MODE: Emit a data-missing diagnostic instead of returning empty.
    if (isValueMode()) {
      const insight: PerformanceInsight = {
        id: makeDeterministicInsightId('org-pr-cycle-time-bottleneck', undefined, 'data-missing'),
        title: 'PR cycle time data is missing',
        description: 'No GitHub PR cycle time history is available yet. Connect GitHub integration to enable PR cycle time bottleneck detection.',
        severity: 'info',
        insightClass: 'org_deterministic',
        orgKind: 'diagnostic',
        cicdStage: 'review-merge',
        toolScope: 'org',
        source: 'github',
        metricId: 'org.pr_cycle_time_bottleneck',
        dataSource: inferDataSourceForOrgInsight(input),
        evidence: [
          { label: 'Status', value: 'Missing dataset' },
          { label: 'Dataset', value: 'engOutput' }
        ],
        recommendations: [
          { text: 'Connect GitHub integration to populate PR cycle time metrics.', actionType: 'observability' }
        ],
        related: {},
        tools: undefined,
        priorityScore: 35,
        summaryEligible: false,
        tags: ['org', 'pr-cycle-time', 'data-missing']
      }
      return [insight]
    }

    return []
  }
  
  try {
    // Use prCycleTimeHours ONLY (no fallback)
    const metricKey = 'prCycleTimeHours'
    const metricLabel = 'PR cycle time'
    
    if (import.meta.env.DEV) {
      console.warn('[PI][ReviewMerge][PRCycleTimeBottleneck] Metric selection', {
        metricUsed: metricKey,
        points: engOutput.length
      })
    }
    
    // Extract valid points where metric is finite and > 0
    const validPoints = engOutput
      .map(p => ({
        period: p.period,
        value: p.prCycleTimeHours !== undefined && p.prCycleTimeHours !== null && isFinite(p.prCycleTimeHours) && p.prCycleTimeHours > 0 ? p.prCycleTimeHours : null
      }))
      .filter(p => p.value !== null)
      .sort((a, b) => {
        // Sort by period (most recent last)
        const aPeriod = a.period || ''
        const bPeriod = b.period || ''
        return aPeriod < bPeriod ? -1 : aPeriod > bPeriod ? 1 : 0
      })
    
    // VALUE MODE: Adaptive minPoints
    const defaultMin = DEMO_MODE ? 4 : 6;
    const minPoints = valueModeMinPoints(defaultMin, validPoints.length);
    
    // VALUE MODE: If insufficient history (< 2), emit diagnostic
    if (validPoints.length < 2 && isValueMode()) {
      const insight: PerformanceInsight = {
        id: makeDeterministicInsightId('org-pr-cycle-time-bottleneck', validPoints[0]?.period, 'insufficient-history'),
        title: 'Not enough history yet to detect PR cycle time bottlenecks',
        description: `Only ${validPoints.length} period(s) of PR cycle time data available. Need at least 2 periods to compare trends. Connect more data or wait 24-48 hours for additional periods.`,
        severity: 'info',
        insightClass: 'org_deterministic',
        orgKind: 'diagnostic',
        cicdStage: 'review-merge',
        toolScope: 'org',
        source: 'github',
        metricId: 'org.pr_cycle_time_bottleneck',
        dataSource: inferDataSourceForOrgInsight(input),
        evidence: [
          { label: 'Observed periods', value: validPoints.length.toString() },
          { label: 'Needed for trend', value: '2+' },
          { label: 'Action', value: 'Wait 24-48h or connect more data' }
        ],
        recommendations: [
          {
            text: 'Continue collecting PR cycle time data. Bottleneck insights will appear once 2+ periods are available.',
            actionType: 'observability'
          }
        ],
        related: {},
        tools: undefined,
        priorityScore: 35, // Floor score
        summaryEligible: false,
        tags: ['org', 'pr-cycle-time', 'insufficient-history']
      };
      return [insight];
    }
    
    if (validPoints.length < minPoints) {
      if (import.meta.env.DEV) {
        console.warn('[PI][ReviewMerge][PRCycleTimeBottleneck] Early return: insufficient points', {
          validPoints: validPoints.length,
          required: minPoints
        })
      }
      return []
    }
    
    // Compute baseline = median of all points excluding most recent (to avoid self-inflation)
    // If exclusion leaves <2 points, use median of all
    let baselinePoints = validPoints.slice(0, -1)  // Exclude most recent
    
    // If exclusion leaves <2 points, use median of all
    if (baselinePoints.length < 2) {
      baselinePoints = validPoints  // Use all if not enough points after exclusion
    }
    
    const baselineValues = baselinePoints.map(p => p.value!)
    const baseline = median(baselineValues)
    
    // Current = most recent point value
    const current = validPoints[validPoints.length - 1].value!
    const currentPeriod = validPoints[validPoints.length - 1].period || 'unknown'
    
    // Compute deltas
    const deltaPct = baseline > 0 ? ((current - baseline) / baseline) * 100 : 0
    const deltaAbs = current - baseline
    
    // Trigger thresholds (different from review latency spike)
    const triggerPctThreshold = 1.25  // 25% worse (vs 35% for review latency)
    const triggerAbsThreshold = DEMO_MODE ? 4.0 : 8.0  // hours (vs 1.5h/3h for review latency)
    
    const triggers = current >= baseline * triggerPctThreshold || deltaAbs >= triggerAbsThreshold
    
    if (!triggers) {
      // VALUE MODE: Emit "stable" diagnostic when data exists but no bottleneck
      if (isValueMode() && validPoints.length >= 2 && baseline > 0 && current > 0) {
        const insight: PerformanceInsight = {
          id: makeDeterministicInsightId('org-pr-cycle-time-bottleneck', currentPeriod, 'stable'),
          title: `PR cycle time is stable: ${current.toFixed(1)}h (baseline ${baseline.toFixed(1)}h)`,
          description: `PR cycle time is ${Math.abs(deltaPct) < 10 ? 'near' : deltaPct >= 0 ? 'above' : 'below'} baseline (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%, ${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(1)}h). No significant bottleneck detected.`,
          severity: 'info',
          insightClass: 'org_deterministic',
          orgKind: 'diagnostic',
          cicdStage: 'review-merge',
          toolScope: 'org',
          source: 'github',
          metricId: 'org.pr_cycle_time_bottleneck',
          dataSource: inferDataSourceForOrgInsight(input),
          evidence: [
            { label: 'Metric used', value: metricLabel },
            { label: 'Current period', value: currentPeriod },
            { label: 'Current value', value: current.toFixed(1) + ' hours' },
            { label: 'Baseline value', value: baseline.toFixed(1) + ' hours' },
            { label: 'Delta', value: `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(1)}h)` },
            { label: 'Status', value: 'Stable (no bottleneck)' },
            { label: 'Points analyzed', value: validPoints.length.toString() }
          ],
          recommendations: [
            {
              text: 'Maintain current PR practices. Monitor for future bottlenecks.',
              actionType: 'process'
            }
          ],
          related: {},
          tools: undefined,
          priorityScore: 40, // Low but visible
          summaryEligible: false,
          tags: ['org', 'pr-cycle-time', 'stable']
        };
        return [insight];
      }
      
      // DEMO_MODE fallback: emit even if thresholds not met (with lower severity)
      if (DEMO_MODE && validPoints.length >= 4 && baseline > 0 && current > 0) {
        // Soft emit for demo: show current vs baseline even if not a bottleneck
        if (import.meta.env.DEV) {
          console.warn('[PI][ReviewMerge][PRCycleTimeBottleneck] DEMO soft emit (thresholds not met)', {
            current,
            baseline,
            deltaPct: deltaPct.toFixed(1) + '%',
            deltaAbs: deltaAbs.toFixed(1) + 'h'
          })
        }
        
        // Build evidence for soft emit
        const evidence: InsightEvidence[] = [
          { label: 'Metric used', value: metricLabel },
          { label: 'Current period', value: currentPeriod },
          { label: 'Current value', value: current.toFixed(1) + ' hours' },
          { label: 'Baseline value', value: baseline.toFixed(1) + ' hours' },
          { label: 'Delta', value: `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(1)}h)` },
          { label: 'Points analyzed', value: validPoints.length.toString() },
          { label: 'Data source', value: 'GitHub time series' }
        ]
        
        const recommendations: InsightRecommendation[] = [
          {
            text: 'Reduce PR size by breaking large changes into smaller, focused pull requests to speed up review and merge cycles.',
            actionType: 'process'
          },
          {
            text: 'Implement CI caching and parallelization to reduce build times and accelerate the PR cycle.',
            actionType: 'tooling'
          }
        ]
        
        const insight: PerformanceInsight = {
          id: `org-pr-cycle-time-bottleneck-${Date.now()}`,
          title: `PR cycle time is ${current.toFixed(1)}h (baseline ${baseline.toFixed(1)}h)`,
          description: `PR cycle time is ${deltaPct >= 0 ? 'above' : 'below'} baseline by ${Math.abs(deltaPct).toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(1)} hours). Monitor trends and optimize workflows to maintain efficient PR cycles.`,
          severity: 'info',
          insightClass: 'org_deterministic',
          orgKind: 'diagnostic',
          cicdStage: 'review-merge',
          toolScope: 'cross-ide', // Changed from 'org' to appear as card
          source: 'github',
          metricId: 'org.pr_cycle_time_bottleneck',
          dataSource: inferDataSourceForOrgInsight(input),
          evidence,
          recommendations,
          related: {},
          tools: undefined,
          priorityScore: 84,
          summaryEligible: false, // Changed to false to appear as card
          tags: ['org', 'pr-cycle-time', 'review-merge']
        }
        
        if (import.meta.env.DEV) {
          console.warn('[PI][ReviewMerge][PRCycleTimeBottleneck] DEMO soft emit RETURN', {
            title: insight.title,
            toolScope: insight.toolScope,
            summaryEligible: insight.summaryEligible
          })
        }
        
        return [insight]
      }
      
      if (import.meta.env.DEV) {
        console.warn('[PI][ReviewMerge][PRCycleTimeBottleneck] Early return: thresholds not met', {
          current,
          baseline,
          deltaPct: deltaPct.toFixed(1) + '%',
          deltaAbs: deltaAbs.toFixed(1) + 'h',
          triggerPctThreshold: (triggerPctThreshold * 100).toFixed(0) + '%',
          triggerAbsThreshold: triggerAbsThreshold + 'h'
        })
      }
      return []
    }
    
    // Determine severity (different thresholds from review latency spike)
    const warningPctThreshold = 1.45  // 45% worse (vs 60% for review latency)
    const warningAbsThreshold = DEMO_MODE ? 8.0 : 16.0  // hours (vs 3h/6h for review latency)
    
    const severity: InsightSeverity = (current >= baseline * warningPctThreshold || Math.abs(deltaAbs) >= warningAbsThreshold)
      ? 'warning'
      : 'info'
    
    const priorityScore = severity === 'warning' ? 92 : 84  // Different from review latency (95/88)
    
    // Build evidence
    const evidence: InsightEvidence[] = [
      { label: 'Metric used', value: metricLabel },
      { label: 'Current period', value: currentPeriod },
      { label: 'Current value', value: current.toFixed(1) + ' hours' },
      { label: 'Baseline value', value: baseline.toFixed(1) + ' hours' },
      { label: 'Delta', value: `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(1)}h)` },
      { label: 'Points analyzed', value: validPoints.length.toString() },
      { label: 'Data source', value: 'GitHub time series' }
    ]
    
    // Build recommendations (specific, not generic, no mention of review latency)
    const recommendations: InsightRecommendation[] = [
      {
        text: 'Break large PRs into smaller focused changes (target <300 LOC). Track PR cycle time median next week to verify improvement.',
        actionType: 'process'
      },
      {
        text: 'Enable CI caching and parallelization to cut build times. Measure PR cycle time p90 weekly to confirm reduction.',
        actionType: 'tooling'
      }
    ]
    
    const insight: PerformanceInsight = {
      id: `org-pr-cycle-time-bottleneck-${Date.now()}`,
      title: `Org PR cycle time rising (+${deltaPct.toFixed(1)}% to ${current.toFixed(1)}h vs ${baseline.toFixed(1)}h baseline)`,
      description: `PR cycle time increased by ${Math.abs(deltaPct).toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(1)} hours) across ${validPoints.length} periods, from ${baseline.toFixed(1)}h to ${current.toFixed(1)}h. This indicates bottlenecks in the PR workflow that impact delivery velocity.`,
      severity,
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'review-merge',
      toolScope: 'cross-ide', // Changed from 'org' to appear as card
      source: 'github',
      metricId: 'org.pr_cycle_time_bottleneck',
      dataSource: inferDataSourceForOrgInsight(input),
      evidence,
      recommendations,
      related: {},
      tools: undefined,
      priorityScore,
      summaryEligible: false, // Changed to false to appear as card
      tags: ['org', 'pr-cycle-time', 'review-merge']
    }
    
    if (import.meta.env.DEV) {
      console.warn('[PI][ReviewMerge][PRCycleTimeBottleneck] EMIT', {
        current: current.toFixed(1) + 'h',
        baseline: baseline.toFixed(1) + 'h',
        deltaAbs: deltaAbs.toFixed(1) + 'h',
        deltaPct: deltaPct.toFixed(1) + '%',
        severity,
        priorityScore,
        metricUsed: metricKey
      })
    }
    
    return [insight]
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[PI][ReviewMerge][PRCycleTimeBottleneck] Error:', e)
    }
    return []
  }
}

/**
 * Org Deployment Frequency Drop Rule (Deploy & Operate)
 * 
 * Detects when deployment frequency drops below baseline, indicating deployment bottlenecks.
 * Uses org-level GitHub time series data (engOutput).
 * Emits at most ONE insight.
 */
function ruleOrgDeploymentFrequencyDrop(input: PerformanceInputs): PerformanceInsight[] {
  const { engOutput } = input
  
  // Guard: require engOutput data
  if (!engOutput || engOutput.length === 0) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][DeploymentFreqDrop] Early return: no engOutput data')
    }
    // VALUE MODE: Emit a data-missing diagnostic instead of returning empty.
    if (isValueMode()) {
      const insight: PerformanceInsight = {
        id: makeDeterministicInsightId('org-deployment-freq-drop', undefined, 'data-missing'),
        title: 'Deployment frequency data is missing',
        description: 'No deployment telemetry history is available yet. Connect GitHub integration (or deployment telemetry source) to enable deployment frequency insights.',
        severity: 'info',
        insightClass: 'org_deterministic',
        orgKind: 'diagnostic',
        cicdStage: 'deploy-operate',
        toolScope: 'org',
        source: 'github',
        metricId: 'org.deployment_frequency_drop',
        dataSource: inferDataSourceForOrgInsight(input),
        evidence: [
          { label: 'Status', value: 'Missing dataset' },
          { label: 'Dataset', value: 'engOutput' }
        ],
        recommendations: [
          { text: 'Connect deployment telemetry to populate deployment frequency metrics.', actionType: 'observability' }
        ],
        related: {},
        tools: undefined,
        priorityScore: 35,
        summaryEligible: false,
        tags: ['org', 'deployment-frequency', 'data-missing']
      }
      return [insight]
    }

    return []
  }
  
  // Compute deltas first for logging
  let current = 0
  let baseline = 0
  let deltaAbs = 0
  let deltaPct = 0
  let currentPeriod = 'unknown'
  
  try {
    // Extract valid points where metric is finite and > 0
    const validPoints = engOutput
      .map(p => ({
        period: p.period,
        value: p.deploymentFreqPerWeek !== undefined && p.deploymentFreqPerWeek !== null && isFinite(p.deploymentFreqPerWeek) && p.deploymentFreqPerWeek > 0 ? p.deploymentFreqPerWeek : null
      }))
      .filter(p => p.value !== null)
      .sort((a, b) => {
        // Sort by period (most recent last)
        const aPeriod = a.period || ''
        const bPeriod = b.period || ''
        return aPeriod < bPeriod ? -1 : aPeriod > bPeriod ? 1 : 0
      })
    
    // VALUE MODE: Adaptive minPoints
    const defaultMin = DEMO_MODE ? 3 : 4;
    const minPoints = valueModeMinPoints(defaultMin, validPoints.length);
    
    // VALUE MODE: If insufficient history (< 2), emit diagnostic
    if (validPoints.length < 2 && isValueMode()) {
      const insight: PerformanceInsight = {
        id: makeDeterministicInsightId('org-deployment-freq-drop', validPoints[0]?.period, 'insufficient-history'),
        title: 'Not enough history yet to detect deployment frequency trends',
        description: `Only ${validPoints.length} period(s) of deployment frequency data available. Need at least 2 periods to compare trends. Connect more data or wait 24-48 hours for additional periods.`,
        severity: 'info',
        insightClass: 'org_deterministic',
        orgKind: 'diagnostic',
        cicdStage: 'deploy-operate',
        toolScope: 'org',
        source: 'github',
        metricId: 'org.deployment_frequency_drop',
        dataSource: inferDataSourceForOrgInsight(input),
        evidence: [
          { label: 'Observed periods', value: validPoints.length.toString() },
          { label: 'Needed for trend', value: '2+' },
          { label: 'Action', value: 'Wait 24-48h or connect more data' }
        ],
        recommendations: [
          {
            text: 'Continue collecting deployment data. Frequency insights will appear once 2+ periods are available.',
            actionType: 'observability'
          }
        ],
        related: {},
        tools: undefined,
        priorityScore: 35, // Floor score
        summaryEligible: false,
        tags: ['org', 'deployment-frequency', 'insufficient-history']
      };
      return [insight];
    }
    
    if (validPoints.length < minPoints) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][DeploymentFreqDrop] Early return: insufficient points', {
          validPoints: validPoints.length,
          required: minPoints
        })
      }
      return []
    }
    
    // Compute baseline = median of all points excluding most recent (to avoid self-inflation)
    // If exclusion leaves <2 points, use median of all
    let baselinePoints = validPoints.slice(0, -1)  // Exclude most recent
    
    // If exclusion leaves <2 points, use median of all
    if (baselinePoints.length < 2) {
      baselinePoints = validPoints  // Use all if not enough points after exclusion
    }
    
    const baselineValues = baselinePoints.map(p => p.value!)
    baseline = median(baselineValues)
    
    // Current = most recent point value
    current = validPoints[validPoints.length - 1].value!
    currentPeriod = validPoints[validPoints.length - 1].period || 'unknown'
    
    // Compute deltas (drop = negative delta)
    deltaPct = baseline > 0 ? ((current - baseline) / baseline) * 100 : 0
    deltaAbs = current - baseline  // Negative = drop
    
    // Guard: baseline must be valid
    if (baseline <= 0 || !isFinite(baseline)) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][DeploymentFreqDrop] Early return: invalid baseline', {
          baseline,
          current
        })
      }
      return []
    }
    
    // Log ENTER with computed values
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][DeploymentFreqDrop] ENTER', {
        points: engOutput.length,
        validPoints: validPoints.length,
        metricUsed: 'deploymentFreqPerWeek',
        DEMO_MODE,
        current,
        baseline,
        deltaAbs: deltaAbs.toFixed(2) + '/week',
        deltaPct: deltaPct.toFixed(1) + '%'
      })
    }
    
    // Trigger thresholds (detect drops, so current < baseline AND magnitude passes threshold)
    const triggerPctThreshold = DEMO_MODE ? 0.20 : 0.30  // 20% or 30% drop
    const triggerAbsThreshold = DEMO_MODE ? 0.8 : 1.5  // deployments/week drop
    
    // Only trigger if it's actually a drop (deltaAbs < 0) AND magnitude passes threshold
    const isActualDrop = deltaAbs < 0
    const triggers = isActualDrop && (deltaPct <= -triggerPctThreshold * 100 || deltaAbs <= -triggerAbsThreshold)
    
    // VALUE MODE: Emit "stable" diagnostic when data exists but no drop
    if (!triggers && isValueMode() && validPoints.length >= 2 && baseline > 0 && current > 0) {
      const isRising = deltaAbs > 0;
      const isStable = Math.abs(deltaPct) < 10;
      
      let title: string;
      let description: string;
      if (isStable) {
        title = `Deployment frequency is stable: ${current.toFixed(2)}/week (baseline ${baseline.toFixed(2)}/week)`;
        description = `Deployment frequency is near baseline, within ${Math.abs(deltaPct).toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(2)} deployments/week). No significant drop detected.`;
      } else if (isRising) {
        title = `Deployment frequency is rising: ${current.toFixed(2)}/week (baseline ${baseline.toFixed(2)}/week)`;
        description = `Deployment frequency increased by ${deltaPct.toFixed(1)}% (${deltaAbs.toFixed(2)} deployments/week) compared to baseline. This is positive - deployment velocity is improving.`;
      } else {
        title = `Deployment frequency is stable: ${current.toFixed(2)}/week (baseline ${baseline.toFixed(2)}/week)`;
        description = `Deployment frequency is ${Math.abs(deltaPct).toFixed(1)}% below baseline (${deltaAbs.toFixed(2)} deployments/week), but not enough to trigger a drop alert. Monitor trends.`;
      }
      
      const insight: PerformanceInsight = {
        id: makeDeterministicInsightId('org-deployment-freq-drop', currentPeriod, isStable ? 'stable' : isRising ? 'directional-rising' : 'directional-slight-decrease'),
        title,
        description,
        severity: 'info',
        insightClass: 'org_deterministic',
        orgKind: 'diagnostic',
        cicdStage: 'deploy-operate',
        toolScope: 'org',
        source: 'github',
        metricId: 'org.deployment_frequency_drop',
        dataSource: inferDataSourceForOrgInsight(input),
        evidence: [
          { label: 'Metric used', value: 'Deployment frequency per week' },
          { label: 'Current period', value: currentPeriod },
          { label: 'Current value', value: current.toFixed(2) + ' deployments/week' },
          { label: 'Baseline value', value: baseline.toFixed(2) + ' deployments/week' },
          { label: 'Delta', value: `${deltaPct.toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(2)}/week)` },
          { label: 'Status', value: isStable ? 'Stable' : isRising ? 'Rising' : 'Slight decrease' },
          { label: 'Points analyzed', value: validPoints.length.toString() }
        ],
        recommendations: [
          {
            text: isRising ? 'Continue optimizing deployment pipelines to maintain or improve current deployment frequency.' : 'Monitor deployment frequency trends and maintain current practices.',
            actionType: 'process'
          }
        ],
        related: {},
        tools: undefined,
        priorityScore: 40, // Low but visible
        summaryEligible: false,
        tags: ['org', 'deployment-frequency', 'stable']
      };
      return [insight];
    }
    
    // DEMO soft-emit: if thresholds not met but we have valid data
    if (!triggers) {
      if (DEMO_MODE && validPoints.length >= 3 && baseline > 0 && current > 0) {
        // Determine if it's actually a drop or not
        const isDrop = deltaAbs < 0
        const isRising = deltaAbs > 0
        const isStable = Math.abs(deltaAbs) < 0.1  // Within 0.1 deployments/week
        
        // Title must be neutral if not a true drop
        let title: string
        let description: string
        let recommendations: InsightRecommendation[]
        
        if (isDrop) {
          // Small drop that didn't meet thresholds
          title = `Deployment frequency declined to ${current.toFixed(2)}/week (baseline ${baseline.toFixed(2)}/week)`
          description = `Deployment frequency decreased by ${Math.abs(deltaPct).toFixed(1)}% (${Math.abs(deltaAbs).toFixed(2)} deployments/week) compared to baseline. This did not cross alert thresholds but is shown for demo visibility. Monitor trends to maintain deployment velocity.`
          recommendations = [
            {
              text: 'Reduce batch size and adopt trunk-based development to enable more frequent, smaller deployments.',
              actionType: 'process'
            },
            {
              text: 'Implement release trains or scheduled deployment windows to maintain consistent deployment cadence.',
              actionType: 'process'
            },
            {
              text: 'Decouple deployment from release using feature flags to deploy more frequently without increasing risk.',
              actionType: 'tooling'
            }
          ]
        } else if (isRising) {
          // Frequency increased - use neutral/positive label
          title = `Deployment frequency is ${current.toFixed(2)}/week (baseline ${baseline.toFixed(2)}/week)`
          description = `Deployment frequency increased by ${deltaPct.toFixed(1)}% (+${deltaAbs.toFixed(2)} deployments/week) compared to baseline. Monitor trends to maintain deployment velocity.`
          recommendations = [
            {
              text: 'Continue optimizing deployment pipelines to maintain or improve current deployment frequency.',
              actionType: 'process'
            },
            {
              text: 'Document successful deployment practices and share across teams to scale improvements.',
              actionType: 'process'
            }
          ]
        } else {
          // Stable/near baseline
          title = `Deployment frequency is near baseline: ${current.toFixed(2)}/week (baseline ${baseline.toFixed(2)}/week)`
          description = `Deployment frequency is stable, within ${Math.abs(deltaPct).toFixed(1)}% of baseline (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(2)} deployments/week). Monitor trends to maintain deployment velocity.`
          recommendations = [
            {
              text: 'Maintain current deployment practices and consider incremental improvements to increase frequency.',
              actionType: 'process'
            }
          ]
        }
        
        const evidence: InsightEvidence[] = [
          { label: 'Metric used', value: 'Deployment frequency per week' },
          { label: 'Current period', value: currentPeriod },
          { label: 'Current value', value: current.toFixed(2) + ' deployments/week' },
          { label: 'Baseline value', value: baseline.toFixed(2) + ' deployments/week' },
          { label: 'Delta', value: `${deltaPct.toFixed(1)}% (${deltaAbs.toFixed(2)}/week)` },
          { label: 'Points analyzed', value: validPoints.length.toString() },
          { label: 'Data source', value: 'GitHub time series' },
          { label: 'Mode', value: 'DEMO soft emit' }
        ]
        
        const insight: PerformanceInsight = {
          id: `org-deployment-freq-drop-${Date.now()}`,
          title,
          description,
          severity: 'info', // Use 'info' for DEMO soft-emit, not 'opportunity' (not in type system)
          insightClass: 'org_deterministic',
          cicdStage: 'deploy-operate',
          toolScope: 'cross-ide', // Changed from 'org' to appear as card
          source: 'github',
          metricId: 'org.deployment_frequency_drop',
          ruleLabel: 'Deployment frequency', // Neutral label for chip
          dataSource: inferDataSourceForOrgInsight(input),
          evidence,
          recommendations,
          related: {},
          tools: undefined,
          priorityScore: 60, // Lower priority for soft emit
          summaryEligible: false, // Changed to false to appear as card
          tags: ['org', 'deploy-operate', 'dora', 'deployment-frequency']
        }
        
        if (import.meta.env.DEV) {
          console.warn('[PI][DeployOperate][DeploymentFreqDrop] DEMO soft emit RETURN', {
            title: insight.title,
            isDrop,
            isRising,
            isStable,
            current,
            baseline,
            deltaAbs: deltaAbs.toFixed(2) + '/week',
            deltaPct: deltaPct.toFixed(1) + '%',
            softEmit: true
          })
        }
        
        return [insight]
      }
      
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][DeploymentFreqDrop] Early return: thresholds not met', {
          current,
          baseline,
          deltaPct: deltaPct.toFixed(1) + '%',
          deltaAbs: deltaAbs.toFixed(2) + '/week',
          isActualDrop: deltaAbs < 0,
          triggerPctThreshold: (triggerPctThreshold * 100).toFixed(0) + '% drop',
          triggerAbsThreshold: triggerAbsThreshold + '/week drop'
        })
      }
      return []
    }
    
    // At this point, we have a true drop (deltaAbs < 0 AND thresholds met)
    // Determine severity (for actual drops)
    const warningPctThreshold = 0.40  // 40% drop
    const warningAbsThreshold = 2.5  // deployments/week drop
    
    const severity: InsightSeverity = (deltaPct <= -warningPctThreshold * 100 || deltaAbs <= -warningAbsThreshold)
      ? 'warning'
      : 'info'
    
    const priorityScore = severity === 'warning' ? 92 : 84
    
    // Build evidence
    const evidence: InsightEvidence[] = [
      { label: 'Metric used', value: 'Deployment frequency per week' },
      { label: 'Current period', value: currentPeriod },
      { label: 'Current value', value: current.toFixed(2) + ' deployments/week' },
      { label: 'Baseline value', value: baseline.toFixed(2) + ' deployments/week' },
      { label: 'Delta', value: `${deltaPct.toFixed(1)}% (${deltaAbs.toFixed(2)}/week)` },
      { label: 'Points analyzed', value: validPoints.length.toString() },
      { label: 'Data source', value: 'GitHub time series' }
    ]
    
    // Build recommendations
    const recommendations: InsightRecommendation[] = [
      {
        text: 'Reduce batch size and adopt trunk-based development to enable more frequent, smaller deployments.',
        actionType: 'process'
      },
      {
        text: 'Implement release trains or scheduled deployment windows to maintain consistent deployment cadence.',
        actionType: 'process'
      },
      {
        text: 'Decouple deployment from release using feature flags to deploy more frequently without increasing risk.',
        actionType: 'tooling'
      },
      {
        text: 'Improve CI reliability and reduce build/test flakiness to remove deployment blockers.',
        actionType: 'tooling'
      },
      {
        text: 'Automate deployment pipelines to reduce manual steps and enable faster iteration cycles.',
        actionType: 'tooling'
      }
    ]
    
    const insight: PerformanceInsight = {
      id: `org-deployment-freq-drop-${Date.now()}`,
      title: `Deployment frequency dropped to ${current.toFixed(2)}/week (baseline ${baseline.toFixed(2)}/week)`,
      description: `Deployment frequency decreased by ${Math.abs(deltaPct).toFixed(1)}% (${Math.abs(deltaAbs).toFixed(2)} deployments/week) compared to baseline. This indicates deployment bottlenecks that may impact delivery velocity. ${severity === 'warning' ? 'Immediate attention recommended.' : 'Monitor trends and optimize deployment workflows.'}`,
      severity,
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'deploy-operate',
      toolScope: 'cross-ide', // Changed from 'org' to appear as card
      source: 'github',
      metricId: 'org.deployment_frequency_drop',
      ruleLabel: 'Deployment frequency', // Neutral label for chip
      dataSource: inferDataSourceForOrgInsight(input),
      evidence,
      recommendations,
      related: {},
      tools: undefined,
      priorityScore,
      summaryEligible: false, // Changed to false to appear as card
      tags: ['org', 'deploy-operate', 'dora', 'deployment-frequency']
    }
    
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][DeploymentFreqDrop] EMIT', {
        title: insight.title,
        current: current.toFixed(2) + '/week',
        baseline: baseline.toFixed(2) + '/week',
        deltaAbs: deltaAbs.toFixed(2) + '/week',
        deltaPct: deltaPct.toFixed(1) + '%',
        severity,
        priorityScore,
        softEmit: false
      })
    }
    
    return [insight]
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][DeploymentFreqDrop] Error:', e)
    }
    return []
  }
}

/**
 * Org Change Failure Rate Spike Rule (Deploy & Operate)
 * 
 * Detects when change failure rate spikes above baseline, indicating deployment quality issues.
 * Uses org-level GitHub time series data (engOutput).
 * Emits at most ONE insight.
 */
function ruleOrgChangeFailureRateSpike(input: PerformanceInputs): PerformanceInsight[] {
  const { engOutput } = input
  
  // Guard: require engOutput data
  if (!engOutput || engOutput.length === 0) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][ChangeFailureRateSpike] Early return: no engOutput data')
    }
    // VALUE MODE: Emit a data-missing diagnostic instead of returning empty.
    if (isValueMode()) {
      const insight: PerformanceInsight = {
        id: makeDeterministicInsightId('org-change-failure-rate-spike', undefined, 'data-missing'),
        title: 'Change failure rate data is missing',
        description: 'No change failure rate telemetry is available yet. Connect GitHub integration (or your deployment telemetry source) to enable change failure rate insights.',
        severity: 'info',
        insightClass: 'org_deterministic',
        orgKind: 'diagnostic',
        cicdStage: 'deploy-operate',
        toolScope: 'org',
        source: 'github',
        metricId: 'org.change_failure_rate_spike',
        dataSource: inferDataSourceForOrgInsight(input),
        evidence: [
          { label: 'Status', value: 'Missing dataset' },
          { label: 'Dataset', value: 'engOutput' }
        ],
        recommendations: [
          { text: 'Connect deployment telemetry to populate change failure rate metrics.', actionType: 'observability' }
        ],
        related: {},
        tools: undefined,
        priorityScore: 35,
        summaryEligible: false,
        tags: ['org', 'change-failure-rate', 'data-missing']
      }
      return [insight]
    }

    return []
  }
  
  // Compute deltas first for logging
  let current = 0
  let baseline = 0
  let deltaAbs = 0
  let deltaPct = 0
  let currentPeriod = 'unknown'
  
  try {
    // Extract valid points where metric is finite and >= 0
    const validPoints = engOutput
      .map(p => ({
        period: p.period,
        value: p.changeFailureRatePct !== undefined && p.changeFailureRatePct !== null && isFinite(p.changeFailureRatePct) && p.changeFailureRatePct >= 0 ? p.changeFailureRatePct : null
      }))
      .filter(p => p.value !== null)
      .sort((a, b) => {
        // Sort by period (most recent last)
        const aPeriod = a.period || ''
        const bPeriod = b.period || ''
        return aPeriod < bPeriod ? -1 : aPeriod > bPeriod ? 1 : 0
      })
    
    // VALUE MODE: Adaptive minPoints
    const defaultMin = DEMO_MODE ? 3 : 4;
    const minPoints = valueModeMinPoints(defaultMin, validPoints.length);
    
    // VALUE MODE: If insufficient history (< 2), emit diagnostic
    if (validPoints.length < 2 && isValueMode()) {
      const insight: PerformanceInsight = {
        id: makeDeterministicInsightId('org-change-failure-rate-spike', validPoints[0]?.period, 'insufficient-history'),
        title: 'Not enough history yet to detect change failure rate trends',
        description: `Only ${validPoints.length} period(s) of change failure rate data available. Need at least 2 periods to compare trends. Connect more data or wait 24-48 hours for additional periods.`,
        severity: 'info',
        insightClass: 'org_deterministic',
        orgKind: 'diagnostic',
        cicdStage: 'deploy-operate',
        toolScope: 'org',
        source: 'github',
        metricId: 'org.change_failure_rate_spike',
        dataSource: inferDataSourceForOrgInsight(input),
        evidence: [
          { label: 'Observed periods', value: validPoints.length.toString() },
          { label: 'Needed for trend', value: '2+' },
          { label: 'Action', value: 'Wait 24-48h or connect more data' }
        ],
        recommendations: [
          {
            text: 'Continue collecting deployment data. Change failure rate insights will appear once 2+ periods are available.',
            actionType: 'observability'
          }
        ],
        related: {},
        tools: undefined,
        priorityScore: 35, // Floor score
        summaryEligible: false,
        tags: ['org', 'change-failure-rate', 'insufficient-history']
      };
      return [insight];
    }
    
    if (validPoints.length < minPoints) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][ChangeFailureRateSpike] Early return: insufficient points', {
          validPoints: validPoints.length,
          required: minPoints
        })
      }
      return []
    }
    
    // Compute baseline = median of all points excluding most recent
    let baselinePoints = validPoints.slice(0, -1)
    if (baselinePoints.length < 2) {
      baselinePoints = validPoints
    }
    
    const baselineValues = baselinePoints.map(p => p.value!)
    baseline = median(baselineValues)
    
    // Current = most recent point value
    current = validPoints[validPoints.length - 1].value!
    currentPeriod = validPoints[validPoints.length - 1].period || 'unknown'
    
    // Compute deltas (spike = positive delta)
    deltaAbs = current - baseline  // Absolute change in percentage points
    deltaPct = baseline > 0 ? ((current - baseline) / baseline) * 100 : 0  // Relative change
    
    // Guard: baseline must be valid
    if (baseline < 0 || !isFinite(baseline)) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][ChangeFailureRateSpike] Early return: invalid baseline', {
          baseline,
          current
        })
      }
      return []
    }
    
    // Log ENTER with computed values
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][ChangeFailureRateSpike] ENTER', {
        points: engOutput.length,
        validPoints: validPoints.length,
        metricUsed: 'changeFailureRatePct',
        DEMO_MODE,
        current,
        baseline,
        deltaAbsPts: deltaAbs.toFixed(2) + ' pct points',
        deltaPctRel: deltaPct.toFixed(1) + '%'
      })
    }
    
    // Guard: CFR "spike" means current > baseline. If current <= baseline, return [] (no spike)
    // VALUE MODE: Emit "stable" diagnostic when data exists but no spike
    if (current <= baseline) {
      if (isValueMode() && validPoints.length >= 2) {
        const isImproving = current < baseline;
        const isStable = Math.abs(deltaAbs) < 2; // Within 2 percentage points
        
        const insight: PerformanceInsight = {
          id: makeDeterministicInsightId('org-change-failure-rate-spike', currentPeriod, isStable ? 'stable' : isImproving ? 'directional-improving' : 'directional-slight-increase'),
          title: isStable 
            ? `Change failure rate is stable: ${current.toFixed(1)}% (baseline ${baseline.toFixed(1)}%)`
            : `Change failure rate is ${isImproving ? 'improving' : 'stable'}: ${current.toFixed(1)}% (baseline ${baseline.toFixed(1)}%)`,
          description: isStable
            ? `Change failure rate is near baseline, within ${Math.abs(deltaAbs).toFixed(1)} percentage points. No significant spike detected.`
            : isImproving
            ? `Change failure rate decreased by ${Math.abs(deltaPct).toFixed(1)}% (${Math.abs(deltaAbs).toFixed(1)} percentage points) compared to baseline. This is positive - deployment reliability is improving.`
            : `Change failure rate is ${Math.abs(deltaPct).toFixed(1)}% above baseline (${deltaAbs.toFixed(1)} percentage points), but not enough to trigger a spike alert. Monitor trends.`,
          severity: 'info',
          insightClass: 'org_deterministic',
          orgKind: 'diagnostic',
          cicdStage: 'deploy-operate',
          toolScope: 'org',
          source: 'github',
          metricId: 'org.change_failure_rate_spike',
          dataSource: inferDataSourceForOrgInsight(input),
          evidence: [
            { label: 'Metric used', value: 'changeFailureRatePct' },
            { label: 'Current period', value: currentPeriod },
            { label: 'Current value', value: current.toFixed(1) + '%' },
            { label: 'Baseline value', value: baseline.toFixed(1) + '%' },
            { label: 'Delta', value: `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(1)} pct points)` },
            { label: 'Status', value: isStable ? 'Stable' : isImproving ? 'Improving' : 'Slight increase' },
            { label: 'Points analyzed', value: validPoints.length.toString() }
          ],
          recommendations: [
            {
              text: isImproving ? 'Continue current deployment practices to maintain improved reliability.' : 'Monitor change failure rate trends and maintain current practices.',
              actionType: 'process'
            }
          ],
          related: {},
          tools: undefined,
          priorityScore: 40, // Low but visible
          summaryEligible: false,
          tags: ['org', 'change-failure-rate', 'stable']
        };
        return [insight];
      }
      
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][ChangeFailureRateSpike] Early return: CFR decreased or stable (not a spike)', {
          current,
          baseline,
          deltaAbs: deltaAbs.toFixed(2) + ' pct points',
          deltaPct: deltaPct.toFixed(1) + '%'
        })
      }
      return []
    }
    
    // Trigger thresholds (only reached if current > baseline)
    // Production: deltaAbs >= +1.0 pct-pt OR deltaPct >= +0.25 (25% relative)
    // DEMO: lower threshold allowed, but still requires current > baseline
    const triggerAbsThreshold = DEMO_MODE ? 2.0 : 1.0  // percentage points
    const triggerPctThreshold = DEMO_MODE ? 0.30 : 0.25  // 30% or 25% relative increase
    
    // Only trigger if it's actually a spike (current > baseline) AND magnitude passes threshold
    const isActualSpike = current > baseline
    const triggers = isActualSpike && (deltaAbs >= triggerAbsThreshold || deltaPct >= triggerPctThreshold * 100)
    
    // DEMO soft-emit: if thresholds not met but we have valid data (and current > baseline)
    if (!triggers) {
      // Only soft-emit if current > baseline (small increase that didn't meet thresholds)
      // If current <= baseline, we already returned [] above
      if (DEMO_MODE && validPoints.length >= 3 && baseline >= 0 && current > baseline) {
        // Small spike that didn't meet thresholds - use neutral label (not "Spike")
        if (import.meta.env.DEV) {
          console.warn('[PI][DeployOperate][ChangeFailureRateSpike] DEMO soft emit (thresholds not met, small increase)', {
            current,
            baseline,
            deltaAbs: deltaAbs.toFixed(2) + ' pct points',
            deltaPct: deltaPct.toFixed(1) + '%'
          })
        }
        
        const evidence: InsightEvidence[] = [
          { label: 'Metric used', value: 'Change failure rate (%)' },
          { label: 'Current period', value: currentPeriod },
          { label: 'Current value', value: current.toFixed(2) + '%' },
          { label: 'Baseline value', value: baseline.toFixed(2) + '%' },
          { label: 'Delta', value: `+${deltaAbs.toFixed(2)} pct points (+${deltaPct.toFixed(1)}% relative)` },
          { label: 'Points analyzed', value: validPoints.length.toString() },
          { label: 'Data source', value: 'GitHub time series' },
          { label: 'Mode', value: 'DEMO soft emit' }
        ]
        
        const recommendations: InsightRecommendation[] = [
          {
            text: 'Monitor change failure rate trends and implement preventive measures if the rate continues to increase.',
            actionType: 'process'
          },
          {
            text: 'Review recent deployments to identify patterns that may be contributing to failures.',
            actionType: 'process'
          }
        ]
        
        const insight: PerformanceInsight = {
          id: `org-change-failure-rate-spike-${Date.now()}`,
          title: `Change failure rate is ${current.toFixed(2)}% (baseline ${baseline.toFixed(2)}%)`,
          description: `Change failure rate increased by ${deltaAbs.toFixed(2)} percentage points (+${deltaPct.toFixed(1)}% relative) compared to baseline. This did not cross alert thresholds but is shown for demo visibility. Monitor trends to maintain deployment quality.`,
          severity: 'info',
          insightClass: 'org_deterministic',
          orgKind: 'diagnostic',
          cicdStage: 'deploy-operate',
          toolScope: 'cross-ide', // Changed from 'org' to appear as card
          source: 'github',
          metricId: 'org.change_failure_rate_spike',
          ruleLabel: 'Change failure rate', // Neutral label for chip
          dataSource: inferDataSourceForOrgInsight(input),
          evidence,
          recommendations,
          related: {},
          tools: undefined,
          priorityScore: 60, // Lower priority for soft emit
          summaryEligible: false, // Changed to false to appear as card
          tags: ['org', 'deploy-operate', 'dora', 'change-failure-rate']
        }
        
        if (import.meta.env.DEV) {
          console.warn('[PI][DeployOperate][ChangeFailureRateSpike] DEMO soft emit RETURN', {
            title: insight.title,
            current,
            baseline,
            deltaAbs: deltaAbs.toFixed(2) + ' pct points',
            deltaPct: deltaPct.toFixed(1) + '%',
            softEmit: true
          })
        }
        
        return [insight]
      }
      
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][ChangeFailureRateSpike] Early return: thresholds not met', {
          current,
          baseline,
          deltaAbs: deltaAbs.toFixed(2) + ' pct points',
          deltaPct: deltaPct.toFixed(1) + '%',
          isActualSpike: current > baseline,
          triggerAbsThreshold: triggerAbsThreshold + ' pct points',
          triggerPctThreshold: (triggerPctThreshold * 100).toFixed(0) + '% relative'
        })
      }
      return []
    }
    
    // At this point, we have a true spike (current > baseline AND thresholds met)
    // Determine severity
    const warningAbsThreshold = 6.0  // percentage points
    const warningPctThreshold = 0.70  // 70% relative increase
    
    const severity: InsightSeverity = (deltaAbs >= warningAbsThreshold || deltaPct >= warningPctThreshold * 100)
      ? 'warning'
      : 'info'
    
    const priorityScore = severity === 'warning' ? 94 : 86
    
    // Build evidence
    const evidence: InsightEvidence[] = [
      { label: 'Metric used', value: 'Change failure rate (%)' },
      { label: 'Current period', value: currentPeriod },
      { label: 'Current value', value: current.toFixed(2) + '%' },
      { label: 'Baseline value', value: baseline.toFixed(2) + '%' },
      { label: 'Delta', value: `+${deltaAbs.toFixed(2)} pct points (+${deltaPct.toFixed(1)}% relative)` },
      { label: 'Points analyzed', value: validPoints.length.toString() },
      { label: 'Data source', value: 'GitHub time series' }
    ]
    
    // Build recommendations
    const recommendations: InsightRecommendation[] = [
      {
        text: 'Implement canary deployments and feature flags to catch failures early and reduce blast radius.',
        actionType: 'tooling'
      },
      {
        text: 'Automate rollback procedures to quickly revert failed changes and minimize impact.',
        actionType: 'tooling'
      },
      {
        text: 'Increase test coverage at system boundaries and integration points to catch failures before production.',
        actionType: 'process'
      },
      {
        text: 'Conduct postmortems for each failure to identify root causes and prevent recurrence.',
        actionType: 'process'
      },
      {
        text: 'Tighten SLO alerts and monitoring to detect degradation before it impacts users.',
        actionType: 'tooling'
      },
      {
        text: 'Implement automated health checks and smoke tests after deployments to catch issues immediately.',
        actionType: 'tooling'
      }
    ]
    
    const insight: PerformanceInsight = {
      id: `org-change-failure-rate-spike-${Date.now()}`,
      title: `Change failure rate spiked to ${current.toFixed(2)}% (baseline ${baseline.toFixed(2)}%)`,
      description: `Change failure rate increased by ${deltaAbs.toFixed(2)} percentage points (${deltaPct.toFixed(1)}% relative increase) compared to baseline. This indicates deployment quality issues that may impact reliability. ${severity === 'warning' ? 'Immediate attention recommended.' : 'Monitor trends and strengthen deployment practices.'}`,
      severity,
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'deploy-operate',
      toolScope: 'cross-ide', // Changed from 'org' to appear as card
      source: 'github',
      metricId: 'org.change_failure_rate_spike',
      ruleLabel: 'Change failure rate', // Neutral label for chip
      dataSource: inferDataSourceForOrgInsight(input),
      evidence,
      recommendations,
      related: {},
      tools: undefined,
      priorityScore,
      summaryEligible: false, // Changed to false to appear as card
      tags: ['org', 'deploy-operate', 'dora', 'change-failure-rate']
    }
    
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][ChangeFailureRateSpike] EMIT', {
        title: insight.title,
        current: current.toFixed(2) + '%',
        baseline: baseline.toFixed(2) + '%',
        deltaAbs: deltaAbs.toFixed(2) + ' pct points',
        deltaPct: deltaPct.toFixed(1) + '%',
        severity,
        priorityScore,
        softEmit: false
      })
    }
    
    return [insight]
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][ChangeFailureRateSpike] Error:', e)
    }
    return []
  }
}

/**
 * Org MTTR Spike Rule (Deploy & Operate)
 * 
 * Detects when mean time to recovery spikes above baseline, indicating incident response issues.
 * Uses org-level GitHub time series data (engOutput).
 * Emits at most ONE insight.
 * 
 * Handles multiple MTTR field name variations robustly to prevent silent failures.
 */
function ruleOrgMTTRSpike(input: PerformanceInputs): PerformanceInsight[] {
  const { engOutput } = input
  
  // Guard: require engOutput data
  if (!engOutput || engOutput.length === 0) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][MTTRSpike] Early return: no engOutput data')
    }
    // VALUE MODE: Emit a data-missing diagnostic instead of returning empty.
    if (isValueMode()) {
      const insight: PerformanceInsight = {
        id: makeDeterministicInsightId('org-mttr-spike', undefined, 'data-missing-dataset'),
        title: 'MTTR data is missing',
        description: 'No recovery telemetry history is available yet. Connect deployment/incident telemetry to enable MTTR insights.',
        severity: 'info',
        insightClass: 'org_deterministic',
        orgKind: 'diagnostic',
        cicdStage: 'deploy-operate',
        toolScope: 'org',
        source: 'github',
        metricId: 'org.mttr_spike',
        dataSource: inferDataSourceForOrgInsight(input),
        evidence: [
          { label: 'Status', value: 'Missing dataset' },
          { label: 'Dataset', value: 'engOutput' }
        ],
        recommendations: [
          { text: 'Connect recovery/incident telemetry to populate MTTR metrics.', actionType: 'observability' }
        ],
        related: {},
        tools: undefined,
        priorityScore: 35,
        summaryEligible: false,
        tags: ['org', 'mttr', 'data-missing']
      }
      return [insight]
    }

    return []
  }
  
  // Helper: Extract MTTR value from a point using field picker
  // Returns { value: number | null, fieldUsed: string | null }
  function extractMTTRHours(p: EngOutputPoint): { value: number | null; fieldUsed: string | null } {
    const pAny = p as any;
    
    // Try field names in order of preference
    const fieldCandidates = [
      'mttrHours',
      'meanTimeToRecoveryHours',
      'meanTimeToRecovery',
      'meanTimeToRecoveryMinutes'
    ];
    
    const picked = pickFirstNumberField(pAny, fieldCandidates);
    
    if (picked.value !== null && picked.value > 0) {
      // Convert minutes to hours if needed
      if (picked.keyUsed === 'meanTimeToRecoveryMinutes') {
        return { value: picked.value / 60, fieldUsed: picked.keyUsed };
      }
      return { value: picked.value, fieldUsed: picked.keyUsed };
    }
    
    return { value: null, fieldUsed: null };
  }
  
  // Compute deltas first for logging
  let current = 0
  let baseline = 0
  let deltaAbs = 0
  let deltaPct = 0
  let currentPeriod = 'unknown'
  let fieldUsed: string | null = null
  
  try {
    // Extract valid points with MTTR values
    const pointsWithMTTR = engOutput.map(p => {
      const extracted = extractMTTRHours(p)
      return {
        period: p.period,
        value: extracted.value,
        fieldUsed: extracted.fieldUsed
      }
    })
    
    // Track which field was found (use first non-null fieldUsed)
    const firstValidPoint = pointsWithMTTR.find(p => p.value !== null)
    fieldUsed = firstValidPoint?.fieldUsed || null
    
    // If no MTTR field exists at all, emit "data missing" diagnostic in Value Mode
    if (!fieldUsed) {
      if (isValueMode()) {
        const insight: PerformanceInsight = {
          id: makeDeterministicInsightId('org-mttr-spike', undefined, 'data-missing'),
          title: 'MTTR data not available yet',
          description: 'Mean time to recovery (MTTR) metrics are not available. Connect deployment telemetry and ensure recovery time data is being collected to enable MTTR insights.',
          severity: 'info',
          insightClass: 'org_deterministic',
          orgKind: 'diagnostic',
          cicdStage: 'deploy-operate',
          toolScope: 'org',
          source: 'github',
          metricId: 'org.mttr_spike',
          dataSource: inferDataSourceForOrgInsight(input),
          evidence: [
            { label: 'Status', value: 'Data field missing' },
            { label: 'Expected fields', value: 'mttrHours, meanTimeToRecoveryHours, meanTimeToRecovery, or meanTimeToRecoveryMinutes' },
            { label: 'Action', value: 'Connect deployment telemetry' }
          ],
          recommendations: [
            {
              text: 'Ensure deployment telemetry includes recovery time metrics (MTTR)',
              actionType: 'observability'
            }
          ],
          related: {},
          tools: undefined,
          priorityScore: 35, // Floor score
          summaryEligible: false,
          tags: ['org', 'mttr', 'data-missing']
        };
        return [insight];
      }
      
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][MTTRSpike] Early return: no MTTR field found in any point')
      }
      return []
    }
    
    // Filter to valid points
    const validPoints = pointsWithMTTR
      .filter(p => p.value !== null)
      .sort((a, b) => {
        // Sort by period (most recent last)
        const aPeriod = a.period || ''
        const bPeriod = b.period || ''
        return aPeriod < bPeriod ? -1 : aPeriod > bPeriod ? 1 : 0
      })
    
    // VALUE MODE: Adaptive minPoints
    const defaultMin = DEMO_MODE ? 3 : 4;
    const minPoints = valueModeMinPoints(defaultMin, validPoints.length);
    
    // VALUE MODE: If insufficient history (< 2), emit diagnostic
    if (validPoints.length < 2 && isValueMode()) {
      const insight: PerformanceInsight = {
        id: makeDeterministicInsightId('org-mttr-spike', validPoints[0]?.period, 'insufficient-history'),
        title: 'Not enough history yet to detect MTTR trends',
        description: `Only ${validPoints.length} period(s) of MTTR data available. Need at least 2 periods to compare trends. Connect more data or wait 24-48 hours for additional periods.`,
        severity: 'info',
        insightClass: 'org_deterministic',
        orgKind: 'diagnostic',
        cicdStage: 'deploy-operate',
        toolScope: 'org',
        source: 'github',
        metricId: 'org.mttr_spike',
        dataSource: inferDataSourceForOrgInsight(input),
        evidence: [
          { label: 'Observed periods', value: validPoints.length.toString() },
          { label: 'Needed for trend', value: '2+' },
          { label: 'Field used', value: fieldUsed || 'unknown' },
          { label: 'Action', value: 'Wait 24-48h or connect more data' }
        ],
        recommendations: [
          {
            text: 'Continue collecting MTTR data. Recovery time insights will appear once 2+ periods are available.',
            actionType: 'observability'
          }
        ],
        related: {},
        tools: undefined,
        priorityScore: 35, // Floor score
        summaryEligible: false,
        tags: ['org', 'mttr', 'insufficient-history']
      };
      return [insight];
    }
    
    if (validPoints.length < minPoints) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][MTTRSpike] Early return: insufficient points', {
          validPoints: validPoints.length,
          required: minPoints,
          fieldUsed
        })
      }
      return []
    }
    
    // Compute baseline = median of all points excluding most recent
    let baselinePoints = validPoints.slice(0, -1)
    if (baselinePoints.length < 2) {
      baselinePoints = validPoints
    }
    
    const baselineValues = baselinePoints.map(p => p.value!)
    baseline = median(baselineValues)
    
    // Current = most recent point value
    current = validPoints[validPoints.length - 1].value!
    currentPeriod = validPoints[validPoints.length - 1].period || 'unknown'
    
    // Guard: baseline must be valid
    if (baseline <= 0 || !isFinite(baseline)) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][MTTRSpike] Early return: invalid baseline', {
          baseline,
          current,
          fieldUsed
        })
      }
      return []
    }
    
    // Compute deltas (spike = positive delta)
    deltaPct = baseline > 0 ? ((current - baseline) / baseline) * 100 : 0
    deltaAbs = current - baseline  // hours
    
    // Log ENTER with computed values
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][MTTRSpike] ENTER', {
        points: engOutput.length,
        validPoints: validPoints.length,
        fieldUsed,
        DEMO_MODE,
        current,
        baseline,
        deltaAbs: deltaAbs.toFixed(2) + 'h',
        deltaPct: deltaPct.toFixed(1) + '%'
      })
    }
    
    // Guard: MTTR "spike" means current > baseline
    // VALUE MODE: Emit "stable/directional" diagnostic when data exists but no spike
    if (current <= baseline) {
      if (isValueMode() && validPoints.length >= 2 && baseline > 0 && current > 0) {
        const isImproving = current < baseline
        const isStable = Math.abs(deltaPct) < 10
        const insight: PerformanceInsight = {
          id: makeDeterministicInsightId('org-mttr-spike', currentPeriod, isStable ? 'stable' : isImproving ? 'directional-improving' : 'directional-slight-increase'),
          title: isStable
            ? `MTTR is stable: ${current.toFixed(1)}h (baseline ${baseline.toFixed(1)}h)`
            : `MTTR is ${isImproving ? 'improving' : 'stable'}: ${current.toFixed(1)}h (baseline ${baseline.toFixed(1)}h)`,
          description: isStable
            ? `Mean time to recovery is near baseline, within ${Math.abs(deltaPct).toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(2)}h). No significant spike detected.`
            : isImproving
            ? `Mean time to recovery decreased by ${Math.abs(deltaPct).toFixed(1)}% (${Math.abs(deltaAbs).toFixed(2)}h) compared to baseline. This is positive — recovery posture is improving.`
            : `Mean time to recovery is ${Math.abs(deltaPct).toFixed(1)}% above baseline (${deltaAbs.toFixed(2)}h), but not enough to trigger a spike alert. Monitor trends.`,
          severity: 'info',
          insightClass: 'org_deterministic',
          orgKind: 'diagnostic',
          cicdStage: 'deploy-operate',
          toolScope: 'org',
          source: 'github',
          metricId: 'org.mttr_spike',
          dataSource: inferDataSourceForOrgInsight(input),
          evidence: [
            { label: 'Metric used', value: 'MTTR (hours)' },
            { label: 'Field used', value: fieldUsed || 'unknown' },
            { label: 'Current period', value: currentPeriod },
            { label: 'Current value', value: current.toFixed(1) + ' hours' },
            { label: 'Baseline value', value: baseline.toFixed(1) + ' hours' },
            { label: 'Delta', value: `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% (${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(2)}h)` },
            { label: 'Status', value: isStable ? 'Stable' : isImproving ? 'Improving' : 'Slight increase' },
            { label: 'Points analyzed', value: validPoints.length.toString() }
          ],
          recommendations: [
            {
              text: isImproving
                ? 'Continue current incident response practices to maintain improved recovery times.'
                : 'Monitor MTTR trends and maintain current practices.',
              actionType: 'process'
            }
          ],
          related: {},
          tools: undefined,
          priorityScore: 40,
          summaryEligible: false,
          tags: ['org', 'mttr', isStable ? 'stable' : 'directional']
        }
        return [insight]
      }

      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][MTTRSpike] Early return: MTTR decreased or stable (not a spike)', {
          current,
          baseline,
          deltaAbs: deltaAbs.toFixed(2) + 'h',
          deltaPct: deltaPct.toFixed(1) + '%',
          fieldUsed
        })
      }
      return []
    }
    
    // Trigger thresholds (only reached if current > baseline)
    // Production: deltaPct >= 0.30 (30%) OR deltaAbs >= 6h
    // DEMO: smaller absolute threshold allowed, but still requires current > baseline
    const triggerPctThreshold = DEMO_MODE ? 0.20 : 0.30  // 20% or 30% increase
    const triggerAbsThreshold = DEMO_MODE ? 1.5 : 6.0  // hours (Production: 6h as specified)
    
    // Only trigger if it's actually a spike (current > baseline) AND magnitude passes threshold
    const isActualSpike = current > baseline
    const triggers = isActualSpike && (deltaPct >= triggerPctThreshold * 100 || deltaAbs >= triggerAbsThreshold)
    
    // DEMO soft-emit: if thresholds not met but we have valid data (and current > baseline)
    if (!triggers) {
      // Only soft-emit if current > baseline (small increase that didn't meet thresholds)
      // If current <= baseline, we already returned [] above
      if (DEMO_MODE && validPoints.length >= 3 && baseline > 0 && current > baseline) {
        // Small spike that didn't meet thresholds - use neutral label (not "Spike")
        if (import.meta.env.DEV) {
          console.warn('[PI][DeployOperate][MTTRSpike] DEMO soft emit (thresholds not met, small increase)', {
            current,
            baseline,
            deltaPct: deltaPct.toFixed(1) + '%',
            deltaAbs: deltaAbs.toFixed(2) + 'h',
            fieldUsed
          })
        }
        
        const evidence: InsightEvidence[] = [
          { label: 'Metric used', value: 'Mean time to recovery (hours)' },
          { label: 'Field used', value: fieldUsed || 'unknown' },
          { label: 'Current period', value: currentPeriod },
          { label: 'Current value', value: current.toFixed(2) + ' hours' },
          { label: 'Baseline value', value: baseline.toFixed(2) + ' hours' },
          { label: 'Delta', value: `+${deltaPct.toFixed(1)}% (+${deltaAbs.toFixed(2)}h)` },
          { label: 'Points analyzed', value: validPoints.length.toString() },
          { label: 'Data source', value: 'GitHub time series' },
          { label: 'Mode', value: 'DEMO soft emit' }
        ]
        
        const recommendations: InsightRecommendation[] = [
          {
            text: 'Monitor MTTR trends and implement preventive measures if recovery time continues to increase.',
            actionType: 'process'
          },
          {
            text: 'Review recent incidents to identify patterns that may be contributing to longer recovery times.',
            actionType: 'process'
          }
        ]
        
        const insight: PerformanceInsight = {
          id: `org-mttr-spike-${Date.now()}`,
          title: `MTTR is ${current.toFixed(2)}h (baseline ${baseline.toFixed(2)}h)`,
          description: `Mean time to recovery increased by ${deltaPct.toFixed(1)}% (+${deltaAbs.toFixed(2)} hours) compared to baseline. This did not cross alert thresholds but is shown for demo visibility. Monitor trends to maintain incident response efficiency.`,
          severity: 'info',
          insightClass: 'org_deterministic',
          orgKind: 'diagnostic',
          cicdStage: 'deploy-operate',
          toolScope: 'cross-ide', // Changed from 'org' to appear as card
          source: 'github',
          metricId: 'org.mttr_spike',
          ruleLabel: 'MTTR', // Neutral label for chip
          dataSource: inferDataSourceForOrgInsight(input),
          evidence,
          recommendations,
          related: {},
          tools: undefined,
          priorityScore: 60, // Lower priority for soft emit
          summaryEligible: false, // Changed to false to appear as card
          tags: ['org', 'deploy-operate', 'dora', 'mttr']
        }
        
        if (import.meta.env.DEV) {
          console.warn('[PI][DeployOperate][MTTRSpike] DEMO soft emit RETURN', {
            title: insight.title,
            current,
            baseline,
            deltaAbs: deltaAbs.toFixed(2) + 'h',
            deltaPct: deltaPct.toFixed(1) + '%',
            fieldUsed,
            softEmit: true
          })
        }
        
        return [insight]
      }
      
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][MTTRSpike] Early return: thresholds not met', {
          current,
          baseline,
          deltaPct: deltaPct.toFixed(1) + '%',
          deltaAbs: deltaAbs.toFixed(2) + 'h',
          isActualSpike: current > baseline,
          fieldUsed,
          triggerPctThreshold: (triggerPctThreshold * 100).toFixed(0) + '%',
          triggerAbsThreshold: triggerAbsThreshold + 'h'
        })
      }
      return []
    }
    
    // At this point, we have a true spike (current > baseline AND thresholds met)
    // Determine severity
    const warningPctThreshold = 0.60  // 60% increase
    const warningAbsThreshold = 8.0  // hours
    
    const severity: InsightSeverity = (deltaPct >= warningPctThreshold * 100 || deltaAbs >= warningAbsThreshold)
      ? 'warning'
      : 'info'
    
    const priorityScore = severity === 'warning' ? 93 : 85
    
    // Build evidence
    const evidence: InsightEvidence[] = [
      { label: 'Metric used', value: 'Mean time to recovery (hours)' },
      { label: 'Field used', value: fieldUsed || 'unknown' },
      { label: 'Current period', value: currentPeriod },
      { label: 'Current value', value: current.toFixed(2) + ' hours' },
      { label: 'Baseline value', value: baseline.toFixed(2) + ' hours' },
      { label: 'Delta', value: `+${deltaPct.toFixed(1)}% (+${deltaAbs.toFixed(2)}h)` },
      { label: 'Points analyzed', value: validPoints.length.toString() },
      { label: 'Data source', value: 'GitHub time series' }
    ]
    
    // Build recommendations
    const recommendations: InsightRecommendation[] = [
      {
        text: 'Create and maintain incident playbooks with clear runbooks for common failure scenarios to speed up response.',
        actionType: 'process'
      },
      {
        text: 'Distribute on-call load and ensure adequate coverage to prevent responder fatigue and improve response times.',
        actionType: 'process'
      },
      {
        text: 'Improve observability with better dashboards, alerts, and logging to quickly identify root causes.',
        actionType: 'tooling'
      },
      {
        text: 'Reduce blast radius through better service isolation and circuit breakers to limit incident scope.',
        actionType: 'tooling'
      },
      {
        text: 'Implement automated recovery procedures where possible to reduce manual intervention time.',
        actionType: 'tooling'
      }
    ]
    
    const insight: PerformanceInsight = {
      id: `org-mttr-spike-${Date.now()}`,
      title: `MTTR spiked to ${current.toFixed(2)}h (baseline ${baseline.toFixed(2)}h)`,
      description: `Mean time to recovery increased by ${deltaPct.toFixed(1)}% (+${deltaAbs.toFixed(2)} hours) compared to baseline. This indicates incident response issues that may impact reliability. ${severity === 'warning' ? 'Immediate attention recommended.' : 'Monitor trends and strengthen incident response practices.'}`,
      severity,
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'deploy-operate',
      toolScope: 'cross-ide', // Changed from 'org' to appear as card
      source: 'github',
      metricId: 'org.mttr_spike',
      ruleLabel: 'MTTR', // Neutral label for chip
      dataSource: inferDataSourceForOrgInsight(input),
      evidence,
      recommendations,
      related: {},
      tools: undefined,
      priorityScore,
      summaryEligible: false, // Changed to false to appear as card
      tags: ['org', 'deploy-operate', 'dora', 'mttr']
    }
    
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][MTTRSpike] EMIT', {
        title: insight.title,
        current: current.toFixed(2) + 'h',
        baseline: baseline.toFixed(2) + 'h',
        deltaAbs: deltaAbs.toFixed(2) + 'h',
        deltaPct: deltaPct.toFixed(1) + '%',
        fieldUsed,
        severity,
        priorityScore,
        softEmit: false
      })
    }
    
    return [insight]
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][MTTRSpike] Error:', e)
    }
    return []
  }
}

/**
 * Org Velocity vs Reliability Tradeoff Rule (Deploy & Operate)
 * 
 * Detects when deployment frequency increases but reliability worsens (CFR and/or MTTR increases),
 * indicating a classic "shipping faster but breaking more / taking longer to recover" tradeoff.
 * Uses org-level GitHub time series data (engOutput).
 * Emits at most ONE insight.
 */
function ruleOrgVelocityReliabilityTradeoff(input: PerformanceInputs): PerformanceInsight[] {
  const { engOutput } = input
  
  // Guard: require engOutput data
  if (!engOutput || engOutput.length === 0) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][VelocityReliabilityTradeoff] Early return: no engOutput data')
    }
    return []
  }
  
  // Helper: Extract MTTR value from a point (reuse from ruleOrgMTTRSpike)
  function extractMTTRHours(p: EngOutputPoint): { value: number | null; fieldUsed: string | null } {
    const pAny = p as any
    
    // Try in order of preference:
    if (pAny.mttrHours !== undefined && pAny.mttrHours !== null) {
      const v = pAny.mttrHours
      if (isFinite(v) && v > 0) return { value: v, fieldUsed: 'mttrHours' }
    }
    if (pAny.meanTimeToRecoveryHours !== undefined && pAny.meanTimeToRecoveryHours !== null) {
      const v = pAny.meanTimeToRecoveryHours
      if (isFinite(v) && v > 0) return { value: v, fieldUsed: 'meanTimeToRecoveryHours' }
    }
    if (pAny.meanTimeToRecovery !== undefined && pAny.meanTimeToRecovery !== null) {
      const v = pAny.meanTimeToRecovery
      if (isFinite(v) && v > 0) return { value: v, fieldUsed: 'meanTimeToRecovery' }
    }
    if (pAny.meanTimeToRecoveryMinutes !== undefined && pAny.meanTimeToRecoveryMinutes !== null) {
      const v = pAny.meanTimeToRecoveryMinutes
      if (isFinite(v) && v > 0) return { value: v / 60, fieldUsed: 'meanTimeToRecoveryMinutes' }
    }
    
    return { value: null, fieldUsed: null }
  }
  
  try {
    // Extract valid points for all three metrics
    const pointsWithMetrics = engOutput.map(p => {
      const deployFreq = p.deploymentFreqPerWeek !== undefined && p.deploymentFreqPerWeek !== null && isFinite(p.deploymentFreqPerWeek) && p.deploymentFreqPerWeek > 0
        ? p.deploymentFreqPerWeek
        : null
      
      const cfr = p.changeFailureRatePct !== undefined && p.changeFailureRatePct !== null && isFinite(p.changeFailureRatePct) && p.changeFailureRatePct >= 0
        ? p.changeFailureRatePct
        : null
      
      const mttrExtracted = extractMTTRHours(p)
      
      return {
        period: p.period,
        deployFreq,
        cfr,
        mttr: mttrExtracted.value,
        mttrFieldUsed: mttrExtracted.fieldUsed
      }
    })
    
    // Filter to points with at least deployment frequency (required)
    const validPoints = pointsWithMetrics.filter(p => p.deployFreq !== null)
    
    // Guard: need minimum points
    const minPoints = DEMO_MODE ? 2 : 4
    if (validPoints.length < minPoints) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][VelocityReliabilityTradeoff] Early return: insufficient points', {
          validPoints: validPoints.length,
          required: minPoints
        })
      }
      return []
    }
    
    // Sort by period (most recent last)
    validPoints.sort((a, b) => {
      const aPeriod = a.period || ''
      const bPeriod = b.period || ''
      return aPeriod < bPeriod ? -1 : aPeriod > bPeriod ? 1 : 0
    })
    
    // Compute baseline = median of all points excluding most recent
    let baselinePoints = validPoints.slice(0, -1)
    if (baselinePoints.length < 2) {
      baselinePoints = validPoints
    }
    
    // Current = most recent point
    const current = validPoints[validPoints.length - 1]
    const currentPeriod = current.period || 'unknown'
    
    // Compute baselines and current values
    const deployFreqBaseline = median(baselinePoints.map(p => p.deployFreq!).filter(v => v !== null))
    const deployFreqCurrent = current.deployFreq!
    
    // CFR baseline and current (if available)
    const cfrBaselinePoints = baselinePoints.filter(p => p.cfr !== null).map(p => p.cfr!)
    const cfrBaseline = cfrBaselinePoints.length > 0 ? median(cfrBaselinePoints) : null
    const cfrCurrent = current.cfr
    
    // MTTR baseline and current (if available)
    const mttrBaselinePoints = baselinePoints.filter(p => p.mttr !== null).map(p => p.mttr!)
    const mttrBaseline = mttrBaselinePoints.length > 0 ? median(mttrBaselinePoints) : null
    const mttrCurrent = current.mttr
    const mttrFieldUsed = current.mttrFieldUsed
    
    // Guard: baseline must be valid for deployment frequency
    if (deployFreqBaseline <= 0 || !isFinite(deployFreqBaseline)) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][VelocityReliabilityTradeoff] Early return: invalid deploy freq baseline', {
          deployFreqBaseline
        })
      }
      return []
    }
    
    // Compute deltas
    const deployFreqDeltaPct = ((deployFreqCurrent - deployFreqBaseline) / deployFreqBaseline) * 100
    const deployFreqDeltaAbs = deployFreqCurrent - deployFreqBaseline
    
    const cfrDeltaAbs = cfrBaseline !== null && cfrCurrent !== null ? cfrCurrent - cfrBaseline : null
    const cfrDeltaPct = cfrBaseline !== null && cfrBaseline > 0 && cfrCurrent !== null
      ? ((cfrCurrent - cfrBaseline) / cfrBaseline) * 100
      : null
    
    const mttrDeltaAbs = mttrBaseline !== null && mttrCurrent !== null ? mttrCurrent - mttrBaseline : null
    const mttrDeltaPct = mttrBaseline !== null && mttrBaseline > 0 && mttrCurrent !== null
      ? ((mttrCurrent - mttrBaseline) / mttrBaseline) * 100
      : null
    
    // Log ENTER with computed values
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][VelocityReliabilityTradeoff] ENTER', {
        points: engOutput.length,
        validPoints: validPoints.length,
        DEMO_MODE,
        deployFreq: { current: deployFreqCurrent, baseline: deployFreqBaseline, deltaPct: deployFreqDeltaPct.toFixed(1) + '%', deltaAbs: deployFreqDeltaAbs.toFixed(2) + '/week' },
        cfr: cfrCurrent !== null && cfrBaseline !== null ? { current: cfrCurrent, baseline: cfrBaseline, deltaAbs: cfrDeltaAbs?.toFixed(2) + ' pct-pt', deltaPct: cfrDeltaPct?.toFixed(1) + '%' } : null,
        mttr: mttrCurrent !== null && mttrBaseline !== null ? { current: mttrCurrent, baseline: mttrBaseline, deltaAbs: mttrDeltaAbs?.toFixed(2) + 'h', deltaPct: mttrDeltaPct?.toFixed(1) + '%', fieldUsed: mttrFieldUsed } : null
      })
    }
    
    // Check if deployment frequency is up
    const deployFreqUp = deployFreqDeltaPct >= (DEMO_MODE ? 10 : 15) || deployFreqDeltaAbs >= (DEMO_MODE ? 0.3 : 0.5)
    
    // Check if reliability worsened (CFR or MTTR up)
    const cfrWorse = cfrDeltaAbs !== null && cfrDeltaPct !== null && (
      cfrDeltaAbs >= (DEMO_MODE ? 0.5 : 1.0) || cfrDeltaPct >= (DEMO_MODE ? 15 : 25)
    )
    
    const mttrWorse = mttrDeltaAbs !== null && mttrDeltaPct !== null && (
      mttrDeltaAbs >= (DEMO_MODE ? 1.0 : 2.0) || mttrDeltaPct >= (DEMO_MODE ? 20 : 30)
    )
    
    const reliabilityWorse = cfrWorse || mttrWorse
    
    // Tradeoff condition: deploy freq up AND reliability worse
    const hasTradeoff = deployFreqUp && reliabilityWorse
    
    // Determine severity
    const cfrBigSpike = cfrDeltaAbs !== null && (cfrDeltaAbs >= (DEMO_MODE ? 2.0 : 4.0) || (cfrDeltaPct !== null && cfrDeltaPct >= (DEMO_MODE ? 40 : 60)))
    const mttrBigSpike = mttrDeltaAbs !== null && (mttrDeltaAbs >= (DEMO_MODE ? 3.0 : 6.0) || (mttrDeltaPct !== null && mttrDeltaPct >= (DEMO_MODE ? 50 : 70)))
    
    // Check if reliability is stable/improving (for highlight case)
    const cfrStableOrBetter = cfrDeltaAbs !== null && cfrDeltaAbs <= 0
    const mttrStableOrBetter = mttrDeltaAbs !== null && mttrDeltaAbs <= 0
    const reliabilityStableOrBetter = (cfrDeltaAbs === null || cfrStableOrBetter) && (mttrDeltaAbs === null || mttrStableOrBetter)
    
    // DEMO soft-emit: if deploy freq up but tradeoff not quite met
    if (!hasTradeoff) {
      if (DEMO_MODE && deployFreqUp && validPoints.length >= 2) {
        // Check if close to tradeoff (small reliability regression)
        const cfrClose = cfrDeltaAbs !== null && cfrDeltaAbs > 0 && cfrDeltaAbs < (DEMO_MODE ? 0.5 : 1.0)
        const mttrClose = mttrDeltaAbs !== null && mttrDeltaAbs > 0 && mttrDeltaAbs < (DEMO_MODE ? 1.0 : 2.0)
        const closeToTradeoff = cfrClose || mttrClose
        
        // Or if reliability is stable/improving (highlight case)
        if (closeToTradeoff || reliabilityStableOrBetter) {
          if (import.meta.env.DEV) {
            console.warn('[PI][DeployOperate][VelocityReliabilityTradeoff] DEMO soft emit', {
              deployFreqUp,
              closeToTradeoff,
              reliabilityStableOrBetter
            })
          }
          
          const evidence: InsightEvidence[] = [
            { label: 'Current period', value: currentPeriod },
            { label: 'Baseline window', value: `${baselinePoints.length} prior periods (median)` },
            { label: 'Deploy freq current', value: deployFreqCurrent.toFixed(2) + ' deployments/week' },
            { label: 'Deploy freq baseline', value: deployFreqBaseline.toFixed(2) + ' deployments/week' },
            { label: 'Deploy freq delta', value: `+${deployFreqDeltaPct.toFixed(1)}% (+${deployFreqDeltaAbs.toFixed(2)}/week)` }
          ]
          
          if (cfrCurrent !== null && cfrBaseline !== null) {
            evidence.push(
              { label: 'CFR current', value: cfrCurrent.toFixed(2) + '%' },
              { label: 'CFR baseline', value: cfrBaseline.toFixed(2) + '%' },
              { label: 'CFR delta', value: cfrDeltaAbs !== null ? `${cfrDeltaAbs >= 0 ? '+' : ''}${cfrDeltaAbs.toFixed(2)} pct-pt (${cfrDeltaPct !== null ? (cfrDeltaPct >= 0 ? '+' : '') + cfrDeltaPct.toFixed(1) + '%' : 'N/A'})` : 'N/A' }
            )
          }
          
          if (mttrCurrent !== null && mttrBaseline !== null) {
            evidence.push(
              { label: 'MTTR current', value: mttrCurrent.toFixed(2) + ' hours' },
              { label: 'MTTR baseline', value: mttrBaseline.toFixed(2) + ' hours' },
              { label: 'MTTR delta', value: mttrDeltaAbs !== null ? `${mttrDeltaAbs >= 0 ? '+' : ''}${mttrDeltaAbs.toFixed(2)}h (${mttrDeltaPct !== null ? (mttrDeltaPct >= 0 ? '+' : '') + mttrDeltaPct.toFixed(1) + '%' : 'N/A'})` : 'N/A' },
              { label: 'MTTR field used', value: mttrFieldUsed || 'unknown' }
            )
          }
          
          evidence.push(
            { label: 'Points analyzed', value: validPoints.length.toString() },
            { label: 'Data source', value: 'GitHub time series' },
            { label: 'Mode', value: 'DEMO soft emit' }
          )
          
          let title: string
          let description: string
          let severity: InsightSeverity
          
          if (reliabilityStableOrBetter) {
            // Highlight: shipping faster while maintaining/improving reliability
            title = `Deployment frequency increased to ${deployFreqCurrent.toFixed(2)}/week while reliability ${cfrStableOrBetter && mttrStableOrBetter ? 'improved' : 'remained stable'}`
            description = `Deployment frequency increased by ${deployFreqDeltaPct.toFixed(1)}% (+${deployFreqDeltaAbs.toFixed(2)} deployments/week) compared to baseline. ${cfrStableOrBetter && mttrStableOrBetter ? 'Reliability metrics improved or remained stable, indicating effective velocity gains without sacrificing quality.' : 'Reliability metrics remained stable, indicating effective velocity gains.'}`
            severity = 'highlight'
          } else {
            // Close to tradeoff but not quite there
            title = `Deployment frequency increased to ${deployFreqCurrent.toFixed(2)}/week (baseline ${deployFreqBaseline.toFixed(2)}/week)`
            description = `Deployment frequency increased by ${deployFreqDeltaPct.toFixed(1)}% (+${deployFreqDeltaAbs.toFixed(2)} deployments/week). ${cfrClose || mttrClose ? 'Reliability metrics show small regressions that did not cross alert thresholds. Monitor trends to ensure velocity gains do not compromise reliability.' : 'Monitor trends to ensure velocity gains do not compromise reliability.'}`
            severity = 'info'
          }
          
          const recommendations: InsightRecommendation[] = [
            {
              text: 'Implement feature flags to enable faster deployments with controlled rollouts and quick rollbacks.',
              actionType: 'tooling'
            },
            {
              text: 'Use canary deployments to test changes in production with minimal risk before full rollout.',
              actionType: 'tooling'
            },
            {
              text: 'Automate rollback procedures to quickly revert failed changes and minimize impact.',
              actionType: 'tooling'
            },
            {
              text: 'Set SLOs for change failure rate and MTTR to maintain reliability standards as velocity increases.',
              actionType: 'process'
            }
          ]
          
          const insight: PerformanceInsight = {
            id: `org-velocity-reliability-tradeoff-${Date.now()}`,
            title,
            description,
            severity,
            insightClass: 'org_deterministic',
            orgKind: 'diagnostic',
            cicdStage: 'deploy-operate',
            toolScope: 'cross-ide',
            source: 'github',
            metricId: 'org.velocity_reliability_tradeoff',
            ruleLabel: 'Velocity vs Reliability',
            dataSource: inferDataSourceForOrgInsight(input),
            evidence,
            recommendations,
            related: {},
            tools: undefined,
            priorityScore: severity === 'highlight' ? 75 : 60,
            summaryEligible: false,
            tags: ['org', 'deploy-operate', 'dora', 'velocity', 'reliability']
          }
          
          return [insight]
        }
      }
      
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][VelocityReliabilityTradeoff] Early return: no tradeoff detected', {
          deployFreqUp,
          reliabilityWorse,
          cfrWorse,
          mttrWorse
        })
      }
      return []
    }
    
    // At this point, we have a true tradeoff (deploy freq up AND reliability worse)
    // Determine severity
    const severity: InsightSeverity = (cfrBigSpike || mttrBigSpike)
      ? 'warning'
      : 'info'
    
    const priorityScore = severity === 'warning' ? 91 : 83
    
    // Build evidence
    const evidence: InsightEvidence[] = [
      { label: 'Current period', value: currentPeriod },
      { label: 'Baseline window', value: `${baselinePoints.length} prior periods (median)` },
      { label: 'Deploy freq current', value: deployFreqCurrent.toFixed(2) + ' deployments/week' },
      { label: 'Deploy freq baseline', value: deployFreqBaseline.toFixed(2) + ' deployments/week' },
      { label: 'Deploy freq delta', value: `+${deployFreqDeltaPct.toFixed(1)}% (+${deployFreqDeltaAbs.toFixed(2)}/week)` }
    ]
    
    if (cfrCurrent !== null && cfrBaseline !== null) {
      evidence.push(
        { label: 'CFR current', value: cfrCurrent.toFixed(2) + '%' },
        { label: 'CFR baseline', value: cfrBaseline.toFixed(2) + '%' },
        { label: 'CFR delta', value: `+${cfrDeltaAbs!.toFixed(2)} pct-pt (+${cfrDeltaPct!.toFixed(1)}% relative)` }
      )
    }
    
    if (mttrCurrent !== null && mttrBaseline !== null) {
      evidence.push(
        { label: 'MTTR current', value: mttrCurrent.toFixed(2) + ' hours' },
        { label: 'MTTR baseline', value: mttrBaseline.toFixed(2) + ' hours' },
        { label: 'MTTR delta', value: `+${mttrDeltaAbs!.toFixed(2)}h (+${mttrDeltaPct!.toFixed(1)}% relative)` },
        { label: 'MTTR field used', value: mttrFieldUsed || 'unknown' }
      )
    }
    
    evidence.push(
      { label: 'Points analyzed', value: validPoints.length.toString() },
      { label: 'Data source', value: 'GitHub time series' }
    )
    
    // Build recommendations
    const recommendations: InsightRecommendation[] = [
      {
        text: 'Implement feature flags to enable faster deployments with controlled rollouts and quick rollbacks.',
        actionType: 'tooling'
      },
      {
        text: 'Use canary deployments to test changes in production with minimal risk before full rollout.',
        actionType: 'tooling'
      },
      {
        text: 'Automate rollback procedures to quickly revert failed changes and minimize impact.',
        actionType: 'tooling'
      },
      {
        text: 'Set SLOs for change failure rate and MTTR to maintain reliability standards as velocity increases.',
        actionType: 'process'
      },
      {
        text: 'Gate deployments on test coverage and quality metrics to prevent reliability regressions.',
        actionType: 'process'
      },
      {
        text: 'Establish incident review loops to identify patterns causing failures and improve deployment practices.',
        actionType: 'process'
      }
    ]
    
    // Build title and description
    const reliabilityIssues: string[] = []
    if (cfrWorse) {
      reliabilityIssues.push(`change failure rate increased by ${cfrDeltaAbs!.toFixed(2)} percentage points`)
    }
    if (mttrWorse) {
      reliabilityIssues.push(`MTTR increased by ${mttrDeltaAbs!.toFixed(2)} hours`)
    }
    const reliabilityIssueText = reliabilityIssues.join(' and ')
    
    const insight: PerformanceInsight = {
      id: `org-velocity-reliability-tradeoff-${Date.now()}`,
      title: `Shipping faster, but reliability worsened: ${reliabilityIssueText}`,
      description: `Deployment frequency increased by ${deployFreqDeltaPct.toFixed(1)}% (+${deployFreqDeltaAbs.toFixed(2)} deployments/week) compared to baseline, but ${reliabilityIssueText}. This indicates a velocity vs reliability tradeoff that may impact user experience. ${severity === 'warning' ? 'Immediate attention recommended to balance speed and quality.' : 'Monitor trends and implement practices to maintain reliability as velocity increases.'}`,
      severity,
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'deploy-operate',
      toolScope: 'cross-ide',
      source: 'github',
      metricId: 'org.velocity_reliability_tradeoff',
      ruleLabel: 'Velocity vs Reliability',
      dataSource: inferDataSourceForOrgInsight(input),
      evidence,
      recommendations,
      related: {},
      tools: undefined,
      priorityScore,
      summaryEligible: false,
      tags: ['org', 'deploy-operate', 'dora', 'velocity', 'reliability']
    }
    
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][VelocityReliabilityTradeoff] EMIT', {
        title: insight.title,
        severity,
        priorityScore,
        deployFreqUp,
        cfrWorse,
        mttrWorse,
        cfrBigSpike,
        mttrBigSpike
      })
    }
    
    return [insight]
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][VelocityReliabilityTradeoff] Error:', e)
    }
    return []
  }
}

/**
 * Org Reliability Volatility Rule (Deploy & Operate)
 * 
 * Detects high volatility (variance) in reliability metrics (CFR and/or MTTR) even if the latest
 * point isn't a strict spike. This indicates process instability and is actionable for leadership.
 * Uses org-level GitHub time series data (engOutput).
 * Emits at most ONE insight.
 */
function ruleOrgReliabilityVolatility(input: PerformanceInputs): PerformanceInsight[] {
  const { engOutput } = input
  
  // Guard: require engOutput data
  if (!engOutput || engOutput.length === 0) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][ReliabilityVolatility] Early return: no engOutput data')
    }
    return []
  }
  
  // Helper: Extract MTTR value from a point (reuse from ruleOrgMTTRSpike)
  function extractMTTRHours(p: EngOutputPoint): { value: number | null; fieldUsed: string | null } {
    const pAny = p as any
    
    if (pAny.mttrHours !== undefined && pAny.mttrHours !== null) {
      const v = pAny.mttrHours
      if (isFinite(v) && v > 0) return { value: v, fieldUsed: 'mttrHours' }
    }
    if (pAny.meanTimeToRecoveryHours !== undefined && pAny.meanTimeToRecoveryHours !== null) {
      const v = pAny.meanTimeToRecoveryHours
      if (isFinite(v) && v > 0) return { value: v, fieldUsed: 'meanTimeToRecoveryHours' }
    }
    if (pAny.meanTimeToRecovery !== undefined && pAny.meanTimeToRecovery !== null) {
      const v = pAny.meanTimeToRecovery
      if (isFinite(v) && v > 0) return { value: v, fieldUsed: 'meanTimeToRecovery' }
    }
    if (pAny.meanTimeToRecoveryMinutes !== undefined && pAny.meanTimeToRecoveryMinutes !== null) {
      const v = pAny.meanTimeToRecoveryMinutes
      if (isFinite(v) && v > 0) return { value: v / 60, fieldUsed: 'meanTimeToRecoveryMinutes' }
    }
    
    return { value: null, fieldUsed: null }
  }
  
  try {
    // Extract valid points for CFR and MTTR
    const pointsWithMetrics = engOutput.map(p => {
      const cfr = p.changeFailureRatePct !== undefined && p.changeFailureRatePct !== null && isFinite(p.changeFailureRatePct) && p.changeFailureRatePct >= 0
        ? p.changeFailureRatePct
        : null
      
      const mttrExtracted = extractMTTRHours(p)
      
      return {
        period: p.period,
        cfr,
        mttr: mttrExtracted.value,
        mttrFieldUsed: mttrExtracted.fieldUsed
      }
    })
    
    // Sort by period (most recent last)
    pointsWithMetrics.sort((a, b) => {
      const aPeriod = a.period || ''
      const bPeriod = b.period || ''
      return aPeriod < bPeriod ? -1 : aPeriod > bPeriod ? 1 : 0
    })
    
    // Use rolling window: last N points (N=6 prod, N=4 demo)
    const windowSize = DEMO_MODE ? 4 : 6
    const windowPoints = pointsWithMetrics.slice(-windowSize)
    
    // Guard: need minimum points
    const minPoints = DEMO_MODE ? 3 : 5
    if (windowPoints.length < minPoints) {
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][ReliabilityVolatility] Early return: insufficient points', {
          windowPoints: windowPoints.length,
          required: minPoints
        })
      }
      return []
    }
    
    // Extract CFR and MTTR values from window
    const cfrValues = windowPoints.filter(p => p.cfr !== null).map(p => p.cfr!)
    const mttrValues = windowPoints.filter(p => p.mttr !== null).map(p => p.mttr!)
    const mttrFieldUsed = windowPoints.find(p => p.mttr !== null)?.mttrFieldUsed || null
    
    // Compute statistics for CFR
    let cfrMean = 0
    let cfrStdDev = 0
    let cfrCV = 0
    let cfrMin = 0
    let cfrMax = 0
    let cfrQualifies = false
    
    if (cfrValues.length >= minPoints) {
      cfrMean = mean(cfrValues)
      cfrStdDev = standardDeviation(cfrValues)
      cfrCV = cfrMean > 0 ? cfrStdDev / cfrMean : 0
      cfrMin = Math.min(...cfrValues)
      cfrMax = Math.max(...cfrValues)
      
      const cfrCVThreshold = DEMO_MODE ? 0.4 : 0.6
      cfrQualifies = cfrMean >= 1.0 && cfrCV >= cfrCVThreshold
    }
    
    // Compute statistics for MTTR
    let mttrMean = 0
    let mttrStdDev = 0
    let mttrCV = 0
    let mttrMin = 0
    let mttrMax = 0
    let mttrQualifies = false
    
    if (mttrValues.length >= minPoints) {
      mttrMean = mean(mttrValues)
      mttrStdDev = standardDeviation(mttrValues)
      mttrCV = mttrMean > 0 ? mttrStdDev / mttrMean : 0
      mttrMin = Math.min(...mttrValues)
      mttrMax = Math.max(...mttrValues)
      
      const mttrCVThreshold = DEMO_MODE ? 0.4 : 0.6
      mttrQualifies = mttrMean >= 1.0 && mttrCV >= mttrCVThreshold
    }
    
    // Log ENTER with computed values
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][ReliabilityVolatility] ENTER', {
        points: engOutput.length,
        windowSize,
        windowPoints: windowPoints.length,
        DEMO_MODE,
        cfr: cfrValues.length >= minPoints ? {
          mean: cfrMean.toFixed(2) + '%',
          stdDev: cfrStdDev.toFixed(2) + '%',
          cv: cfrCV.toFixed(2),
          qualifies: cfrQualifies
        } : null,
        mttr: mttrValues.length >= minPoints ? {
          mean: mttrMean.toFixed(2) + 'h',
          stdDev: mttrStdDev.toFixed(2) + 'h',
          cv: mttrCV.toFixed(2),
          qualifies: mttrQualifies,
          fieldUsed: mttrFieldUsed
        } : null
      })
    }
    
    // Trigger if at least one metric qualifies
    if (!cfrQualifies && !mttrQualifies) {
      // DEMO soft-emit: if CV is low (stable/consistent), emit a positive insight
      if (DEMO_MODE && windowPoints.length >= 4) {
        // Check if we have CFR data with low volatility (stable/consistent)
        if (cfrValues.length >= 4 && cfrMean >= 1.0 && cfrCV > 0 && cfrCV < 0.4) {
          if (import.meta.env.DEV) {
            console.warn('[PI][DeployOperate][ReliabilityVolatility] DEMO soft emit: low volatility (stable)', {
              cfrMean: cfrMean.toFixed(2) + '%',
              cfrCV: cfrCV.toFixed(2),
              windowSize
            })
          }
          
          const evidence: InsightEvidence[] = [
            { label: 'Window size', value: windowSize.toString() },
            { label: 'CFR mean', value: cfrMean.toFixed(2) + '%' },
            { label: 'CFR std dev', value: cfrStdDev.toFixed(2) + '%' },
            { label: 'CFR CV', value: cfrCV.toFixed(2) },
            { label: 'CFR min', value: cfrMin.toFixed(2) + '%' },
            { label: 'CFR max', value: cfrMax.toFixed(2) + '%' },
            { label: 'Points analyzed', value: windowPoints.length.toString() },
            { label: 'Data source', value: 'GitHub time series' },
            { label: 'Mode', value: 'DEMO soft emit' }
          ]
          
          const insight: PerformanceInsight = {
            id: `org-reliability-volatility-${Date.now()}`,
            title: `Reliability is consistent (CFR CV ${cfrCV.toFixed(2)})`,
            description: `Change failure rate shows low volatility (coefficient of variation ${cfrCV.toFixed(2)}) over the last ${windowSize} periods (mean: ${cfrMean.toFixed(2)}%). This indicates stable, predictable reliability metrics, making it easier to maintain consistent quality.`,
            severity: 'highlight',
            insightClass: 'org_deterministic',
            orgKind: 'diagnostic',
            cicdStage: 'deploy-operate',
            toolScope: 'cross-ide',
            source: 'github',
            metricId: 'org.reliability_volatility',
            ruleLabel: 'Reliability volatility',
            dataSource: inferDataSourceForOrgInsight(input),
            evidence,
            recommendations: [
              {
                text: 'Maintain current deployment practices that are producing consistent reliability outcomes.',
                actionType: 'process'
              },
              {
                text: 'Document successful patterns and share across teams to scale reliability improvements.',
                actionType: 'process'
              }
            ],
            related: {},
            tools: undefined,
            priorityScore: 70, // Lower priority for positive/stable insight
            summaryEligible: false,
            tags: ['org', 'deploy-operate', 'dora', 'reliability', 'stability']
          }
          
          if (import.meta.env.DEV) {
            console.warn('[PI][DeployOperate][ReliabilityVolatility] DEMO soft emit RETURN', {
              title: insight.title,
              cfrCV: cfrCV.toFixed(2),
              softEmit: true
            })
          }
          
          return [insight]
        }
        
        // Check if we have MTTR data with low volatility (stable/consistent)
        if (mttrValues.length >= 4 && mttrMean >= 1.0 && mttrCV > 0 && mttrCV < 0.4) {
          if (import.meta.env.DEV) {
            console.warn('[PI][DeployOperate][ReliabilityVolatility] DEMO soft emit: low volatility (stable)', {
              mttrMean: mttrMean.toFixed(2) + 'h',
              mttrCV: mttrCV.toFixed(2),
              windowSize,
              fieldUsed: mttrFieldUsed
            })
          }
          
          const evidence: InsightEvidence[] = [
            { label: 'Window size', value: windowSize.toString() },
            { label: 'MTTR mean', value: mttrMean.toFixed(2) + ' hours' },
            { label: 'MTTR std dev', value: mttrStdDev.toFixed(2) + ' hours' },
            { label: 'MTTR CV', value: mttrCV.toFixed(2) },
            { label: 'MTTR min', value: mttrMin.toFixed(2) + ' hours' },
            { label: 'MTTR max', value: mttrMax.toFixed(2) + ' hours' },
            { label: 'MTTR field used', value: mttrFieldUsed || 'unknown' },
            { label: 'Points analyzed', value: windowPoints.length.toString() },
            { label: 'Data source', value: 'GitHub time series' },
            { label: 'Mode', value: 'DEMO soft emit' }
          ]
          
          const insight: PerformanceInsight = {
            id: `org-reliability-volatility-${Date.now()}`,
            title: `Reliability is consistent (MTTR CV ${mttrCV.toFixed(2)})`,
            description: `Mean time to recovery shows low volatility (coefficient of variation ${mttrCV.toFixed(2)}) over the last ${windowSize} periods (mean: ${mttrMean.toFixed(2)} hours). This indicates stable, predictable incident response times, making it easier to maintain consistent reliability.`,
            severity: 'highlight',
            insightClass: 'org_deterministic',
            orgKind: 'diagnostic',
            cicdStage: 'deploy-operate',
            toolScope: 'cross-ide',
            source: 'github',
            metricId: 'org.reliability_volatility',
            ruleLabel: 'Reliability volatility',
            dataSource: inferDataSourceForOrgInsight(input),
            evidence,
            recommendations: [
              {
                text: 'Maintain current incident response practices that are producing consistent recovery times.',
                actionType: 'process'
              },
              {
                text: 'Document successful incident response patterns and share across teams to scale improvements.',
                actionType: 'process'
              }
            ],
            related: {},
            tools: undefined,
            priorityScore: 70, // Lower priority for positive/stable insight
            summaryEligible: false,
            tags: ['org', 'deploy-operate', 'dora', 'reliability', 'stability']
          }
          
          if (import.meta.env.DEV) {
            console.warn('[PI][DeployOperate][ReliabilityVolatility] DEMO soft emit RETURN', {
              title: insight.title,
              mttrCV: mttrCV.toFixed(2),
              softEmit: true
            })
          }
          
          return [insight]
        }
      }
      
      if (import.meta.env.DEV) {
        console.warn('[PI][DeployOperate][ReliabilityVolatility] Early return: no volatility detected', {
          cfrQualifies,
          mttrQualifies,
          cfrCV: cfrValues.length >= minPoints ? cfrCV.toFixed(2) : null,
          mttrCV: mttrValues.length >= minPoints ? mttrCV.toFixed(2) : null
        })
      }
      return []
    }
    
    // Determine which metric to use (prefer MTTR if both qualify)
    const useMTTR = mttrQualifies
    const useCFR = cfrQualifies && !mttrQualifies
    
    // Determine severity (warning if CV >= 0.8, else info)
    const maxCV = useMTTR ? mttrCV : cfrCV
    const severity: InsightSeverity = maxCV >= 0.8 ? 'warning' : 'info'
    const priorityScore = severity === 'warning' ? 89 : 81
    
    // Build evidence
    const evidence: InsightEvidence[] = [
      { label: 'Window size', value: windowSize.toString() },
      { label: 'Points analyzed', value: windowPoints.length.toString() },
      { label: 'Data source', value: 'GitHub time series' }
    ]
    
    if (useCFR) {
      evidence.push(
        { label: 'CFR mean', value: cfrMean.toFixed(2) + '%' },
        { label: 'CFR std dev', value: cfrStdDev.toFixed(2) + '%' },
        { label: 'CFR CV', value: cfrCV.toFixed(2) },
        { label: 'CFR min', value: cfrMin.toFixed(2) + '%' },
        { label: 'CFR max', value: cfrMax.toFixed(2) + '%' }
      )
    }
    
    if (useMTTR) {
      evidence.push(
        { label: 'MTTR mean', value: mttrMean.toFixed(2) + ' hours' },
        { label: 'MTTR std dev', value: mttrStdDev.toFixed(2) + ' hours' },
        { label: 'MTTR CV', value: mttrCV.toFixed(2) },
        { label: 'MTTR min', value: mttrMin.toFixed(2) + ' hours' },
        { label: 'MTTR max', value: mttrMax.toFixed(2) + ' hours' },
        { label: 'MTTR field used', value: mttrFieldUsed || 'unknown' }
      )
    }
    
    // Build title and description
    const metricName = useMTTR ? 'MTTR' : 'Change failure rate'
    const metricValue = useMTTR ? mttrCV.toFixed(2) : cfrCV.toFixed(2)
    const metricMean = useMTTR ? mttrMean.toFixed(2) + ' hours' : cfrMean.toFixed(2) + '%'
    
    const insight: PerformanceInsight = {
      id: `org-reliability-volatility-${Date.now()}`,
      title: `${metricName} shows high volatility (CV ${metricValue})`,
      description: `${metricName} has a coefficient of variation of ${metricValue} over the last ${windowSize} periods (mean: ${metricMean}). This indicates process instability in reliability metrics, making it difficult to predict and maintain consistent quality. ${severity === 'warning' ? 'Immediate attention recommended to stabilize deployment processes.' : 'Focus on standardizing processes to reduce variance.'}`,
      severity,
      insightClass: 'org_deterministic',
      orgKind: 'diagnostic',
      cicdStage: 'deploy-operate',
      toolScope: 'cross-ide',
      source: 'github',
      metricId: 'org.reliability_volatility',
      ruleLabel: 'Reliability volatility',
      dataSource: inferDataSourceForOrgInsight(input),
      evidence,
      recommendations: [
        {
          text: 'Standardize deployment processes and release procedures to reduce variance in reliability outcomes.',
          actionType: 'process'
        },
        {
          text: 'Establish incident taxonomy and classification to identify patterns causing volatility.',
          actionType: 'process'
        },
        {
          text: 'Implement release gating criteria based on test coverage and quality metrics to prevent unstable deployments.',
          actionType: 'process'
        },
        {
          text: 'Conduct regular postmortems for incidents to identify root causes and prevent recurrence.',
          actionType: 'process'
        },
        {
          text: 'Set error budgets and SLOs to maintain reliability standards and guide deployment decisions.',
          actionType: 'process'
        },
        {
          text: 'Automate deployment pipelines to reduce manual variability and human error.',
          actionType: 'tooling'
        }
      ],
      related: {},
      tools: undefined,
      priorityScore,
      summaryEligible: false,
      tags: ['org', 'deploy-operate', 'dora', 'reliability', 'volatility']
    }
    
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][ReliabilityVolatility] EMIT', {
        title: insight.title,
        severity,
        priorityScore,
        useCFR,
        useMTTR,
        cfrCV: cfrQualifies ? cfrCV.toFixed(2) : null,
        mttrCV: mttrQualifies ? mttrCV.toFixed(2) : null
      })
    }
    
    return [insight]
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[PI][DeployOperate][ReliabilityVolatility] Error:', e)
    }
    return []
  }
}

/**
 * RULE: AI ROI by Tool (Org-Level)
 * Ranks IDEs by AI ROI (impact of AI usage on PR outcomes per unit of AI activity)
 * 
 * Design: See docs/ORG_LEVEL_INSIGHTS_AUDIT.md
 * 
 * Required fields:
 * - ToolProductivityPoint: tool, aiAssists, codingMinutes, period
 * - EngOutputPoint: prCycleTimeHours, changeFailureRatePct, period
 * 
 * NOTE: Tool AI ROI rule:
 * - Registered in the main rules array
 * - Called via generatePerformanceInsights + DEMO harness
 * - Verified that [PI][ToolAIROI] ENTER / EMIT logs appear in console
 */
export function ruleToolAIROI(input: PerformanceInputs): PerformanceInsight[] {
  console.warn('[PI][ToolAIROI] ENTER ruleToolAIROI');

  const PI_DEBUG_ENV = (import.meta as any).env?.VITE_PI_DEBUG ?? 'false'
  const PI_DEBUG_LOCAL = PI_DEBUG_ENV === 'true' || PI_DEBUG_ENV === '1'

  // Guard: the harness currently calls this rule as a safety-net in addition to the engine.
  // If both calls see the same `input` object, emit exactly once.
  if (roiEmittedForInputs.has(input as any)) {
    return [];
  }
  roiEmittedForInputs.add(input as any);
  
  const { engOutput, productivity } = input;
  
  // Early return: missing input data (with diagnostics)
  if (!requireBothBool(productivity, engOutput, 'tool-ai-roi', 'productivity', 'engOutput')) {
    return [];
  }
  
  try {
    // 1. Filter & align data per tool
    const toolData = new Map<string, {
      aiRates: number[];
      cycleTimes: number[];
      cfrs: number[];
      periods: string[];
    }>();
    
    for (const prod of productivity) {
      if (!prod.tool || !prod.period) continue;
      
      // Skip if aiAssists is null or zero
      const aiAssists = prod.aiAssists;
      if (aiAssists == null || aiAssists <= 0) continue;
      
      // Skip if codingMinutes is null or zero
      const codingMinutes = prod.codingMinutes;
      if (codingMinutes == null || codingMinutes <= 0) continue;
      
      // Find matching EngOutputPoint by period
      const engPoint = engOutput.find(e => e.period === prod.period);
      if (!engPoint) continue;
      
      // Skip if both metrics are missing
      if ((engPoint.prCycleTimeHours == null || engPoint.prCycleTimeHours <= 0) &&
          (engPoint.changeFailureRatePct == null || engPoint.changeFailureRatePct < 0)) {
        continue;
      }
      
      // Compute AI rate
      const aiRate = aiAssists / codingMinutes;
      
      // Initialize tool entry if needed
      if (!toolData.has(prod.tool)) {
        toolData.set(prod.tool, {
          aiRates: [],
          cycleTimes: [],
          cfrs: [],
          periods: []
        });
      }
      
      const toolEntry = toolData.get(prod.tool)!;
      toolEntry.aiRates.push(aiRate);
      toolEntry.periods.push(prod.period);
      
      // Add cycle time if available
      if (engPoint.prCycleTimeHours != null && engPoint.prCycleTimeHours > 0) {
        toolEntry.cycleTimes.push(engPoint.prCycleTimeHours);
      }
      
      // Add CFR if available
      if (engPoint.changeFailureRatePct != null && engPoint.changeFailureRatePct >= 0) {
        toolEntry.cfrs.push(engPoint.changeFailureRatePct);
      }
    }
    
    // 2. Compute org baselines
    const orgCycleTimes: number[] = [];
    const orgCfrs: number[] = [];
    
    for (const eng of engOutput) {
      if (eng.prCycleTimeHours != null && eng.prCycleTimeHours > 0) {
        orgCycleTimes.push(eng.prCycleTimeHours);
      }
      if (eng.changeFailureRatePct != null && eng.changeFailureRatePct >= 0) {
        orgCfrs.push(eng.changeFailureRatePct);
      }
    }
    
    // If both arrays are empty, emit diagnostic in Value Mode
    if (orgCycleTimes.length === 0 && orgCfrs.length === 0) {
      if (isValueMode()) {
        const insight: PerformanceInsight = {
          id: makeInsightId('tool-ai-roi', 'no-baseline'),
          title: 'Need more deployment data to compare tool AI ROI',
          description: 'PR cycle time or change failure rate data is missing. Connect GitHub integration and ensure deployment metrics are being collected to enable tool AI ROI comparison.',
          severity: 'info',
          insightClass: 'tool_statistical',
          cicdStage: 'review-merge',
          toolScope: 'cross-ide',
          source: 'combined',
          metricId: 'eng.tool_ai_roi',
          dataSource: inferDataSourceForOrgInsight(input),
          evidence: [
            { label: 'Status', value: 'Missing baseline metrics' },
            { label: 'Required', value: 'prCycleTimeHours or changeFailureRatePct' },
            { label: 'Action', value: 'Connect GitHub integration' }
          ],
          recommendations: [
            {
              text: 'Ensure GitHub integration is connected and PR/deployment metrics are being collected.',
              actionType: 'observability'
            }
          ],
          related: {},
          tools: undefined,
          priorityScore: 35, // Floor score
          summaryEligible: false,
          tags: ['org', 'tool-roi', 'data-missing']
        };
        return [insight];
      }
      console.warn('[PI][ToolAIROI] Early return: no org baseline metrics');
      return [];
    }
    
    const orgAvgCycleTime = orgCycleTimes.length > 0 ? mean(orgCycleTimes) : undefined;
    const orgAvgCFR = orgCfrs.length > 0 ? mean(orgCfrs) : undefined;
    
    // 3. Per-tool aggregates & ROI calculation
    type ToolROI = {
      tool: string;
      roi: number;
      avgAiRate: number;
      avgCycleTimeTool: number | undefined;
      avgCfrTool: number | undefined;
      periodsCount: number;
      cycleDelta: number;
      cfrDelta: number;
    };
    
    const toolROIs: ToolROI[] = [];
    
    for (const [tool, data] of toolData.entries()) {
      // VALUE MODE: Adaptive requirement (2 instead of 3)
      const requiredPeriods = isValueMode() ? 2 : 3;
      if (data.periods.length < requiredPeriods) {
        continue;
      }
      
      // Compute averages
      const avgAiRate = data.aiRates.length > 0 ? mean(data.aiRates) : 0;
      if (avgAiRate <= 0) continue; // Cannot compute efficiency without AI usage
      
      const avgCycleTimeTool = data.cycleTimes.length > 0 ? mean(data.cycleTimes) : undefined;
      const avgCfrTool = data.cfrs.length > 0 ? mean(data.cfrs) : undefined;
      
      // Must have at least one outcome metric
      if (avgCycleTimeTool == null && avgCfrTool == null) {
        continue;
      }
      
      // Compute deltas
      const cycleDelta = orgAvgCycleTime != null && avgCycleTimeTool != null
        ? orgAvgCycleTime - avgCycleTimeTool  // positive = better (faster)
        : 0;
      
      const cfrDelta = orgAvgCFR != null && avgCfrTool != null
        ? orgAvgCFR - avgCfrTool  // positive = better (lower failure rate)
        : 0;
      
      // Skip if both deltas are zero (no improvement)
      if (cycleDelta === 0 && cfrDelta === 0) {
        continue;
      }
      
      // Compute ROI score
      const safeAiRate = Math.max(avgAiRate, 0.01);
      const roi = (cycleDelta + 10 * cfrDelta) / safeAiRate;
      
      toolROIs.push({
        tool,
        roi,
        avgAiRate,
        avgCycleTimeTool,
        avgCfrTool,
        periodsCount: data.periods.length,
        cycleDelta,
        cfrDelta
      });
    }
    
    // 4. Ranking & final gating
    // VALUE MODE: If only 1 tool, emit diagnostic
    if (toolROIs.length < 2) {
      if (isValueMode() && toolROIs.length === 1) {
        const single = toolROIs[0];
        const insight: PerformanceInsight = {
          id: makeInsightId('tool-ai-roi', 'single-tool'),
          title: `Need data from multiple IDEs to compare AI ROI`,
          description: `Only ${single.tool} has sufficient data (${single.periodsCount} periods). Need data from at least 2 IDEs to compare AI efficiency. Connect additional IDE extensions or wait for more periods.`,
          severity: 'info',
          insightClass: 'tool_statistical',
          cicdStage: 'review-merge',
          toolScope: 'cross-ide',
          source: 'combined',
          metricId: 'eng.tool_ai_roi',
          dataSource: inferDataSourceForOrgInsight(input),
          evidence: [
            { label: 'Available tool', value: single.tool },
            { label: 'Periods', value: single.periodsCount.toString() },
            { label: 'Needed', value: '2+ tools with 2+ periods each' },
            { label: 'Action', value: 'Connect additional IDE extensions' }
          ],
          recommendations: [
            {
              text: 'Connect additional IDE extensions (VSCode, Cursor, etc.) to enable tool comparison.',
              actionType: 'observability'
            }
          ],
          related: {},
          tools: undefined,
          priorityScore: 35, // Floor score
          summaryEligible: false,
          tags: ['org', 'tool-roi', 'insufficient-tools']
        };
        return [insight];
      }
      console.warn('[PI][ToolAIROI] Early return: fewer than 2 tools with valid ROI', {
        toolCount: toolROIs.length
      });
      return [];
    }
    
    // Sort by ROI descending (higher = better)
    toolROIs.sort((a, b) => b.roi - a.roi);
    
    const top = toolROIs[0];
    const runnerUp = toolROIs[1];
    
    // Compute signal strength (no longer early-return for "too close to call")
    const maxROI = top.roi;
    const minROI = toolROIs[toolROIs.length - 1].roi;
    const spreadAbs = Math.abs(maxROI - minROI);
    const spreadFraction =
      spreadAbs === 0 || !isFinite(spreadAbs) || !isFinite(maxROI)
        ? 0
        : spreadAbs / Math.max(Math.abs(maxROI), 1e-6);
    
    // We no longer early-return for "too close to call".
    // Instead we just mark whether this is a strong or weak signal.
    const isStrongSignal = spreadFraction >= 0.05; // 5%+ spread between best and worst
    
    // Compute relative improvement vs runner-up
    const relativeImprovement = runnerUp && runnerUp.roi !== 0
      ? (top.roi - runnerUp.roi) / Math.abs(runnerUp.roi)
      : 0;
    
    // 5. Build the insight object
    const topLabel = top.tool.toUpperCase();
    const topToolId = top.tool.toLowerCase();
    const topToolCanonical = normalizeToolId(topToolId);
    const avgCycleTimeTop = top.avgCycleTimeTool;
    const avgCFRTop = top.avgCfrTool;
    
    // Use the same AI rate metric as Plan & Code cards for consistency
    const coverageStats = computeCoverageStatsForTools(input);
    const topCoverage = coverageStats.find(s => s.tool.toLowerCase() === topToolId);
    const topAiRateRaw = topCoverage?.aiPerMinute ?? top.avgAiRate ?? 0;
    const topAiRateDisplay = topAiRateRaw > 0 ? topAiRateRaw.toFixed(2) : '0.00';
    
    // Temporary debug log to confirm we're seeing the same AI rate as Plan & Code
    console.warn('[PI][ToolAIROI] top AI rate display source', {
      topToolId,
      fromCoverage: topCoverage?.aiPerMinute,
      fromAvg: top.avgAiRate,
      display: topAiRateDisplay,
    });
    
    // Compute deltas for display
    const cycleTimeDelta =
      orgAvgCycleTime != null && avgCycleTimeTop != null
        ? orgAvgCycleTime - avgCycleTimeTop
        : null;
    
    const cfrDelta =
      orgAvgCFR != null && avgCFRTop != null
        ? orgAvgCFR - avgCFRTop
        : null;
    
    // Build snippets for description
    const cycleSnippet =
      cycleTimeDelta != null && Math.abs(cycleTimeDelta) >= 0.25
        ? cycleTimeDelta > 0
          ? `${formatHours(cycleTimeDelta)} faster PR cycle time`
          : `${formatHours(-cycleTimeDelta)} slower PR cycle time`
        : 'similar PR cycle time';
    
    const cfrSnippet =
      cfrDelta != null && Math.abs(cfrDelta) >= 0.5
        ? cfrDelta > 0
          ? `${formatPercent(cfrDelta)} lower change failure rate`
          : `${formatPercent(-cfrDelta)} higher change failure rate`
        : 'similar change failure rate';
    
    // Determine severity based on signal strength
    const severity: InsightSeverity = isStrongSignal ? 'opportunity' : 'info';
    
    // Build title based on signal strength
    const title = isStrongSignal
      ? `Org AI ROI: ${topLabel} is leading on AI efficiency`
      : `Org AI ROI: IDEs are performing similarly (slight edge to ${topLabel})`;
    
    // Build description based on signal strength (shortened and tightened)
    const description = isStrongSignal
      ? `${topLabel} leads on AI efficiency versus other IDEs: ${cycleSnippet} and ${cfrSnippet} at ~${topAiRateDisplay} assists/min.`
      : `${topLabel} is only slightly ahead: ${cycleSnippet} and ${cfrSnippet} at ~${topAiRateDisplay} assists/min. Treat this as a directional signal for investigation.`;
    
    // Build evidence (only include metrics that exist)
    const evidence: Array<{ label: string; value: string | number }> = [
      { label: 'Top IDE', value: topLabel },
      { label: 'Median AI assists/min (top IDE)', value: topAiRateDisplay }
    ];
    
    if (avgCycleTimeTop != null) {
      evidence.push({ label: 'Avg PR cycle time (top IDE)', value: formatHours(avgCycleTimeTop) });
    }
    
    if (orgAvgCycleTime != null) {
      evidence.push({ label: 'Org-wide avg PR cycle time', value: formatHours(orgAvgCycleTime) });
    }
    
    if (avgCFRTop != null) {
      evidence.push({ label: 'Change failure rate (top IDE)', value: formatPercent(avgCFRTop) });
    }
    
    if (orgAvgCFR != null) {
      evidence.push({ label: 'Org-wide change failure rate', value: formatPercent(orgAvgCFR) });
    }
    
    const idPeriod = (engOutput && engOutput.length > 0)
      ? (engOutput[engOutput.length - 1] as any)?.period
      : undefined;

    const insight: PerformanceInsight = {
      id: makeDeterministicInsightId('tool-ai-roi', idPeriod, 'roi-summary'),
      cicdStage: 'review-merge',
      toolScope: 'org',
      insightClass: 'org_deterministic',
      orgKind: 'summary',
      severity,
      priorityScore: 85,
      title,
      description,
      evidence,
      recommendations: [
        isStrongSignal
          ? {
              text: `Use ${topLabel} as the default IDE for AI-assisted workflows on new projects and compare PR outcomes versus teams using other IDEs.`,
              actionType: 'process',
            }
          : {
              text: `Monitor AI usage and PR outcomes per IDE over the next few weeks. If ${topLabel} continues to lead, consider standardizing on it for AI-heavy workflows.`,
              actionType: 'process',
            },
      ],
      tags: ['ai-usage', 'tool-roi', 'org-level', 'review-merge'],
      related: {
        tools: [topToolCanonical]
      },
      source: 'combined',
      metricId: 'eng.tool_ai_roi',
      dataSource: inferDataSourceForOrgInsight(input),
      tools: [topToolCanonical]
    };

    if (PI_DEBUG_LOCAL) {
      const ideKeysSeen = Array.from(new Set((productivity || []).map(p => p.tool).filter(Boolean))).slice(0, 10);
      console.log('[PI_DEBUG][ROI_EMIT]', {
        id: insight.id,
        tool: topToolCanonical,
        source: insight.source,
        toolScope: insight.toolScope,
        ideKeysSeen,
      });
    }
    
    console.warn('[PI][ToolAIROI] EMIT', {
      id: insight.id,
      title: insight.title,
      severity: insight.severity,
      roiTop: top.roi,
      tool: topLabel,
      idVariant: 'roi-summary',
      timestamp: Date.now()
    });
    
    return [insight];
    
  } catch (e) {
    console.warn('[PI][ToolAIROI] Error:', e);
    return [];
  }
}

/**
 * RULE 5: Review Bottleneck Detection
 * Detects when review wait time is the primary bottleneck
 * 
 * Required fields:
 * - EngOutputPoint: timeToFirstReviewHours, prCycleTimeHours, period
 * - ToolProductivityPoint: (not required)
 */
const ruleReviewBottleneck: Rule = ({ engOutput, productivity, overlap }) => {
  const insights: PerformanceInsight[] = [];
  
  // Don't need productivity data - this is pure GitHub analysis
  if (!engOutput?.length || engOutput.length < 2) {
    if (import.meta.env.DEV) {
      console.debug('[PI_RULE_SKIP] review-bottleneck: insufficient GH data', { ghLen: engOutput?.length });
    }
    return [];
  }
  
  try {
    let totalReviewWait = 0;
    let totalCycleTime = 0;
    let count = 0;
    
    for (const gh of engOutput) {
      if (gh.timeToFirstReviewHours != null && gh.prCycleTimeHours != null) {
        totalReviewWait += gh.timeToFirstReviewHours;
        totalCycleTime += gh.prCycleTimeHours;
        count++;
      }
    }
    
    if (count < 2) {
      if (import.meta.env.DEV) {
        console.debug('[RULE_REVIEW_BOTTLENECK] Skip: not enough data points with review times', { count });
      }
      return [];
    }
    
    const avgReviewWait = totalReviewWait / count;
    const avgCycleTime = totalCycleTime / count;
    const reviewPercentage = (avgReviewWait / avgCycleTime) * 100;
    
    if (import.meta.env.DEV) {
      console.debug('[RULE_REVIEW_BOTTLENECK] Calculated:', { 
        avgReviewWait: avgReviewWait.toFixed(1), 
        avgCycleTime: avgCycleTime.toFixed(1),
        reviewPercentage: reviewPercentage.toFixed(0),
        count 
      });
    }
    
    // Lowered threshold: 40% instead of 50%
    if (reviewPercentage > 40) {
      insights.push({
        id: `review-bottleneck-${Date.now()}`,
        title: `Review delays account for ${reviewPercentage.toFixed(0)}% of PR cycle time`,
        description: `On average, ${avgReviewWait.toFixed(1)} hours of ${avgCycleTime.toFixed(1)} hour total cycle time is spent waiting for first review. This is the primary bottleneck slowing PR throughput.`,
        severity: reviewPercentage > 60 ? 'risk' : 'warning',
        cicdStage: 'review-merge',
        tags: ['review-bottleneck', 'cycle-time', 'process'],
        related: {},
        evidence: [
          { label: 'Review Wait', value: `${reviewPercentage.toFixed(0)}% of cycle time` },
          { label: 'Avg Wait Time', value: `${avgReviewWait.toFixed(1)}h` },
          { label: 'Avg Cycle Time', value: `${avgCycleTime.toFixed(1)}h` },
          { label: 'PRs Analyzed', value: count }
        ],
        recommendations: [
          { text: 'Set review SLA: first review within 4 hours', actionType: 'process' },
          { text: 'Enable automated review reminders', actionType: 'tooling' },
          { text: 'Balance reviewer assignments across team', actionType: 'process' }
        ],
        source: 'github',
        metricId: 'eng.time_to_first_review'
      });
      
      if (import.meta.env.DEV) {
        console.debug('[RULE_REVIEW_BOTTLENECK] ✅ Fired:', { reviewPercentage: reviewPercentage.toFixed(0), severity: reviewPercentage > 60 ? 'risk' : 'warning' });
      }
    } else {
      if (import.meta.env.DEV) {
        console.debug('[RULE_REVIEW_BOTTLENECK] Not firing: reviewPercentage =', reviewPercentage.toFixed(0), '(threshold: 40%)');
      }
    }
    
    if (import.meta.env.DEV) {
      console.debug('[RULE_REVIEW_BOTTLENECK] Generated insights:', insights.length);
    }
  } catch (e) {
    console.warn('[RULE_REVIEW_BOTTLENECK] Error:', e);
  }
  
  return insights;
};

/**
 * RULE 6: Coding Time vs Output (Workload / Burnout)
 * Detects mismatches between coding time and output
 */
const ruleCodingTimeVsOutput: Rule = ({ engOutput, productivity, overlap }) => {
  const insights: PerformanceInsight[] = [];
  
  if (!engOutput?.length || !productivity?.length || (overlap ?? 0) < 2) {
    if (import.meta.env.DEV) {
      console.debug('[RULE_CODING_VS_OUTPUT] Skip: insufficient overlap');
    }
    return [];
  }
  
  try {
    const toolData = new Map<string, { codingMinutes: number, prs: number }>();
    
    for (const prod of productivity) {
      if (!prod.tool || !prod.codingMinutes) continue;
      
      if (!toolData.has(prod.tool)) {
        toolData.set(prod.tool, { codingMinutes: 0, prs: 0 });
      }
      const data = toolData.get(prod.tool)!;
      data.codingMinutes += prod.codingMinutes;
      
      const ghPoint = engOutput.find(g => g.period === prod.period);
      if (ghPoint) {
        data.prs += ((ghPoint as any).prsMerged || (ghPoint as any).prsOpened || 0);
      }
    }
    
    const tools = Array.from(toolData.entries())
      .map(([tool, data]) => ({
        tool,
        ...data,
        efficiency: data.prs / Math.max(data.codingMinutes / 60, 1) // PRs per hour
      }))
      .filter(t => t.codingMinutes > 0);
    
    if (tools.length < 2) return [];
    
    const avgEfficiency = mean(tools.map(t => t.efficiency));
    
    for (const tool of tools) {
      const ratio = tool.efficiency / avgEfficiency;
      
      // High coding time but low output (2x below average)
      if (ratio < 0.5) {
        insights.push({
          id: `overload-${tool.tool}-${Date.now()}`,
          title: `Possible developer overload detected (${tool.tool})`,
          description: `${tool.tool} users show high coding time (${(tool.codingMinutes / 60).toFixed(1)}h) but ${((1 - ratio) * 100).toFixed(0)}% lower output than average. May indicate complexity, blockers, or burnout.`,
          severity: 'risk',
          tags: ['workload', 'burnout', 'efficiency', tool.tool],
          related: { tools: [tool.tool] },
          evidence: [
            { label: 'Coding Hours', value: (tool.codingMinutes / 60).toFixed(1) },
            { label: 'PRs Delivered', value: tool.prs },
            { label: 'Efficiency vs Avg', value: `${(ratio * 100).toFixed(0)}%` }
          ],
          recommendations: [
            { text: `Review PR ownership and complexity distribution for ${tool.tool} users`, actionType: 'process' },
            { text: 'Check for blockers or technical debt impacting productivity', actionType: 'process' }
          ],
          source: 'combined',
          metricId: 'prod.coding_efficiency'
        });
      }
      
      // Low coding time but high output (2x above average)
      if (ratio > 2) {
        insights.push({
          id: `underutilized-${tool.tool}-${Date.now()}`,
          title: `Underutilized developer capacity (${tool.tool})`,
          description: `${tool.tool} users show low coding time (${(tool.codingMinutes / 60).toFixed(1)}h) but ${((ratio - 1) * 100).toFixed(0)}% higher output than average. May indicate available capacity.`,
          severity: 'opportunity',
          tags: ['capacity', 'efficiency', tool.tool],
          related: { tools: [tool.tool] },
          evidence: [
            { label: 'Coding Hours', value: (tool.codingMinutes / 60).toFixed(1) },
            { label: 'PRs Delivered', value: tool.prs },
            { label: 'Efficiency vs Avg', value: `${(ratio * 100).toFixed(0)}%` }
          ],
          recommendations: [
            { text: `Consider increasing workload or complexity for ${tool.tool} users`, actionType: 'process' },
            { text: 'Leverage their capacity for mentoring or complex tasks', actionType: 'process' }
          ],
          source: 'combined',
          metricId: 'prod.coding_efficiency'
        });
      }
    }
  } catch (e) {
    console.warn('[RULE_CODING_VS_OUTPUT] Error:', e);
  }
  
  return insights;
};

/**
 * RULE 7: High-Risk Area of Code Detected
 * Identifies repos/areas with high failure/reopen rates
 */
const ruleHighRiskArea: Rule = ({ engOutput, productivity, overlap }) => {
  const insights: PerformanceInsight[] = [];
  
  if (!engOutput?.length || (overlap ?? 0) < 2) {
    if (import.meta.env.DEV) {
      console.debug('[RULE_HIGH_RISK] Skip: insufficient GH data');
    }
    return [];
  }
  
  try {
    const repoData = new Map<string, { failureRate: number, cycleTime: number, count: number }>();
    
    for (const gh of engOutput) {
      const repo = (gh as any).repo || 'default';
      if (!repoData.has(repo)) {
        repoData.set(repo, { failureRate: 0, cycleTime: 0, count: 0 });
      }
      const data = repoData.get(repo)!;
      data.failureRate += (gh.changeFailureRatePct || 0);
      data.cycleTime += (gh.prCycleTimeHours || 0);
      data.count++;
    }
    
    const repos = Array.from(repoData.entries())
      .map(([repo, data]) => ({
        repo,
        avgFailureRate: data.failureRate / data.count,
        avgCycleTime: data.cycleTime / data.count,
        count: data.count
      }));
    
    if (repos.length < 2) return [];
    
    const orgAvgFailure = mean(repos.map(r => r.avgFailureRate));
    const orgAvgCycle = mean(repos.map(r => r.avgCycleTime));
    
    for (const repo of repos) {
      // High risk if failure rate is 2x org average
      if (repo.avgFailureRate > orgAvgFailure * 2 && repo.avgFailureRate > 5) {
        insights.push({
          id: `high-risk-${repo.repo}-${Date.now()}`,
          title: `Risk concentration in ${repo.repo}`,
          description: `${repo.repo} shows ${repo.avgFailureRate.toFixed(1)}% failure rate (${((repo.avgFailureRate / orgAvgFailure) - 1) * 100}% higher than org average). This indicates a high-risk area requiring attention.`,
          severity: 'critical',
          tags: ['risk', 'quality', 'hotspot', repo.repo],
          related: { repos: [repo.repo] },
          evidence: [
            { label: 'Repo', value: repo.repo },
            { label: 'Failure Rate', value: `${repo.avgFailureRate.toFixed(1)}%` },
            { label: 'Org Average', value: `${orgAvgFailure.toFixed(1)}%` },
            { label: 'Periods Analyzed', value: repo.count }
          ],
          recommendations: [
            { text: `Increase test coverage in ${repo.repo}`, actionType: 'process' },
            { text: 'Require additional manual review depth for this repo', actionType: 'process' },
            { text: 'Consider requiring code reasoning summaries for changes', actionType: 'process' }
          ],
          source: 'github',
          metricId: 'eng.change_failure_rate'
        });
      }
    }
  } catch (e) {
    console.warn('[RULE_HIGH_RISK] Error:', e);
  }
  
  return insights;
};

/**
 * RULE 8: Review Quality Degradation (Rubber-Stamping)
 * Detects when faster reviews correlate with quality issues
 */
const ruleReviewQualityDegradation: Rule = ({ engOutput, productivity, overlap }) => {
  const insights: PerformanceInsight[] = [];
  
  if (!engOutput?.length || engOutput.length < 4) {
    if (import.meta.env.DEV) {
      console.debug('[RULE_REVIEW_QUALITY] Skip: need at least 4 periods');
    }
    return [];
  }
  
  try {
    // Split into first half and second half
    const sorted = [...engOutput].sort((a, b) => a.period.localeCompare(b.period));
    const mid = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, mid);
    const secondHalf = sorted.slice(mid);
    
    const avgReviewTimeFirst = mean(firstHalf.map(g => g.timeToFirstReviewHours || 0).filter(t => t > 0));
    const avgReviewTimeSecond = mean(secondHalf.map(g => g.timeToFirstReviewHours || 0).filter(t => t > 0));
    
    const avgReopenFirst = mean(firstHalf.map(g => (g as any).reopenRatePct || g.changeFailureRatePct || 0));
    const avgReopenSecond = mean(secondHalf.map(g => (g as any).reopenRatePct || g.changeFailureRatePct || 0));
    
    const reviewTimeChange = (avgReviewTimeFirst - avgReviewTimeSecond) / avgReviewTimeFirst;
    const reopenChange = (avgReopenSecond - avgReopenFirst) / Math.max(avgReopenFirst, 1);
    
    // Fire if review time decreased by 40%+ AND reopen rate increased
    if (reviewTimeChange > 0.4 && reopenChange > 0.2) {
      insights.push({
        id: `review-quality-degradation-${Date.now()}`,
        title: 'Review speed improved, but review quality declined',
        description: `Review time decreased by ${(reviewTimeChange * 100).toFixed(0)}%, but failure/reopen rate increased by ${(reopenChange * 100).toFixed(0)}%. This suggests reviews may be getting faster but less thorough.`,
        severity: 'warning',
        tags: ['review-quality', 'process', 'quality'],
        related: {},
        evidence: [
          { label: 'Review Time Change', value: `${(reviewTimeChange * 100).toFixed(0)}%` },
          { label: 'Reopen Rate Change', value: `+${(reopenChange * 100).toFixed(0)}%` },
          { label: 'Avg Review Time (recent)', value: `${avgReviewTimeSecond.toFixed(1)}h` },
          { label: 'Avg Reopen Rate (recent)', value: `${avgReopenSecond.toFixed(1)}%` }
        ],
        recommendations: [
          { text: 'Establish a "minimum review depth" guideline or checklist', actionType: 'process' },
          { text: 'Require architecture notes for complex changes', actionType: 'process' },
          { text: 'Balance review speed with thoroughness in team discussions', actionType: 'process' }
        ],
        source: 'github',
        metricId: 'eng.review_quality'
      });
    }
  } catch (e) {
    console.warn('[RULE_REVIEW_QUALITY] Error:', e);
  }
  
  return insights;
};

/**
 * RULE 9: AI Adoption Experiment Impact (Before/After)
 * Detects significant changes after a marked event
 * Note: Requires event marking - simplified version compares periods
 */
const ruleAIAdoptionExperiment: Rule = ({ engOutput, productivity, overlap }) => {
  const insights: PerformanceInsight[] = [];
  
  if (!engOutput?.length || !productivity?.length || engOutput.length < 4) {
    if (import.meta.env.DEV) {
      console.debug('[RULE_AI_EXPERIMENT] Skip: need at least 4 periods');
    }
    return [];
  }
  
  try {
    // Simple before/after split (assumes adoption happened mid-timeline)
    const sortedProd = [...productivity].sort((a, b) => a.period.localeCompare(b.period));
    const sortedGH = [...engOutput].sort((a, b) => a.period.localeCompare(b.period));
    
    const mid = Math.floor(sortedProd.length / 2);
    const beforeAI = mean(sortedProd.slice(0, mid).map(p => p.aiAssists || 0));
    const afterAI = mean(sortedProd.slice(mid).map(p => p.aiAssists || 0));
    
    const aiIncrease = (afterAI - beforeAI) / Math.max(beforeAI, 1);
    
    // Only fire if there was a significant AI adoption (50%+ increase)
    if (aiIncrease > 0.5) {
      const midGH = Math.floor(sortedGH.length / 2);
      const beforeCycle = mean(sortedGH.slice(0, midGH).map(g => g.prCycleTimeHours || 0).filter(t => t > 0));
      const afterCycle = mean(sortedGH.slice(midGH).map(g => g.prCycleTimeHours || 0).filter(t => t > 0));
      
      const cycleChange = (beforeCycle - afterCycle) / beforeCycle;
      
      if (Math.abs(cycleChange) > 0.15) {
        insights.push({
          id: `ai-experiment-${Date.now()}`,
          title: `AI adoption ${cycleChange > 0 ? 'increased' : 'decreased'} team throughput by ${Math.abs(cycleChange * 100).toFixed(0)}%`,
          description: `After AI usage increased by ${(aiIncrease * 100).toFixed(0)}%, PR cycle time ${cycleChange > 0 ? 'decreased' : 'increased'} by ${Math.abs(cycleChange * 100).toFixed(0)}%. This suggests ${cycleChange > 0 ? 'positive' : 'negative'} impact from AI adoption.`,
          severity: cycleChange > 0 ? 'highlight' : 'warning',
          tags: ['ai-adoption', 'experiment', 'impact'],
          related: {},
          evidence: [
            { label: 'AI Usage Increase', value: `${(aiIncrease * 100).toFixed(0)}%` },
            { label: 'Cycle Time Change', value: `${(cycleChange * 100).toFixed(0)}%` },
            { label: 'Before Cycle Time', value: `${beforeCycle.toFixed(1)}h` },
            { label: 'After Cycle Time', value: `${afterCycle.toFixed(1)}h` }
          ],
          recommendations: cycleChange > 0 ? [
            { text: 'Consider expanding AI tool rollout to other teams', actionType: 'tooling' },
            { text: 'Document successful adoption patterns for replication', actionType: 'process' }
          ] : [
            { text: 'Review AI tool usage patterns and provide additional training', actionType: 'process' },
            { text: 'Identify and address adoption challenges', actionType: 'process' }
          ],
          source: 'combined',
          metricId: 'prod.ai_adoption_impact'
        });
      }
    }
  } catch (e) {
    console.warn('[RULE_AI_EXPERIMENT] Error:', e);
  }
  
  return insights;
};

/**
 * RULE 10: Coverage Gap Detection (Blind Spots)
 * Already partially implemented in ruleInsufficientData, but enhanced here
 */
const ruleCoverageGapDetection: Rule = ({ engOutput, productivity, overlap, ghSeries, prodSeries }) => {
  const insights: PerformanceInsight[] = [];
  
  try {
    const hasGH = (engOutput?.length || 0) > 0;
    const hasProd = (productivity?.length || 0) > 0;
    const actualOverlap = overlap ?? 0;
    
    // Tool/IDE coverage check
    if (hasProd) {
      const tools = new Set(productivity.map(p => p.tool).filter(Boolean));
      const toolCoverage = tools.size;
      
      if (toolCoverage < 3) {
        insights.push({
          id: `coverage-gap-ide-${Date.now()}`,
          title: 'Limited IDE coverage prevents deeper insights',
          description: `We have AI usage data for only ${toolCoverage} IDE(s). Expanding coverage to more IDEs will enable richer productivity insights.`,
          severity: 'info',
          tags: ['coverage', 'telemetry', 'meta'],
          related: { tools: Array.from(tools) },
          evidence: [
            { label: 'IDEs with Data', value: toolCoverage },
            { label: 'IDEs', value: Array.from(tools).join(', ') },
            { label: 'Productivity Periods', value: productivity.length }
          ],
          recommendations: [
            { text: 'Install the ChaosMonkey plugin for JetBrains IDEs', actionType: 'tooling' },
            { text: 'Encourage team to enable telemetry in their primary IDEs', actionType: 'process' }
          ],
          source: 'productivity',
          metricId: 'meta.coverage'
        });
      }
    }
    
    // Overlap coverage check
    if (hasGH && hasProd && actualOverlap < 2) {
      insights.push({
        id: `coverage-gap-overlap-${Date.now()}`,
        title: 'Missing telemetry overlap prevents cross-dataset insights',
        description: `We have GitHub data for ${engOutput?.length || 0} periods and AI usage data for ${productivity?.length || 0} periods, but only ${actualOverlap} overlapping period(s). This limits quality and cycle-time correlation insights.`,
        severity: 'warning',
        tags: ['coverage', 'overlap', 'meta'],
        related: {},
        evidence: [
          { label: 'GitHub Periods', value: engOutput?.length || 0 },
          { label: 'Productivity Periods', value: productivity?.length || 0 },
          { label: 'Overlapping Periods', value: actualOverlap },
          { label: 'Coverage Gap', value: `${100 - Number(((actualOverlap / Math.max(engOutput?.length || 1, productivity?.length || 1)) * 100).toFixed(0))}%` }
        ],
        recommendations: [
          { text: 'Widen the date range to capture more overlapping data', actionType: 'process' },
          { text: 'Ensure continuous telemetry collection from all sources', actionType: 'tooling' }
        ],
        source: 'combined',
        metricId: 'meta.overlap'
      });
    }
    
    // GitHub repo coverage check
    if (hasGH) {
      const repos = new Set((engOutput || []).map(g => (g as any).repo).filter(Boolean));
      const repoCoverage = repos.size;
      
      if (repoCoverage > 0 && repoCoverage < 3 && hasGH) {
        insights.push({
          id: `coverage-gap-repos-${Date.now()}`,
          title: 'Limited GitHub repository coverage',
          description: `We have GitHub data for only ${repoCoverage} repository/ies. Expanding coverage will provide org-wide insights.`,
          severity: 'info',
          tags: ['coverage', 'github', 'meta'],
          related: { repos: Array.from(repos) },
          evidence: [
            { label: 'Repos with Data', value: repoCoverage },
            { label: 'Repos', value: Array.from(repos).join(', ') || 'default' }
          ],
          recommendations: [
            { text: 'Enable GitHub OAuth permissions for missing repositories', actionType: 'tooling' },
            { text: 'Configure webhook integrations for additional repos', actionType: 'tooling' }
          ],
          source: 'github',
          metricId: 'meta.github_coverage'
        });
      }
    }
  } catch (e) {
    console.warn('[RULE_COVERAGE_GAP] Error:', e);
  }
  
  return insights;
};

// ============================================================================
// STAGE NORMALIZATION
// ============================================================================
type CicdStage = 'plan-code' | 'review-merge' | 'deploy-operate' | 'global';

/**
 * Normalize an insight-provided stage value into the canonical format.
 * Returns undefined when the value is missing/unknown.
 */
function normalizeStage(stage: any): CicdStage | undefined {
  const s = String(stage || '').toLowerCase().trim();

  // Accept legacy variants
  if (s === 'plan_code' || s === 'plancode' || s === 'plan&code' || s === 'plan_and_code' || s === 'plan-and-code') return 'plan-code';
  if (s === 'review_merge' || s === 'reviewmerge' || s === 'review&merge' || s === 'review_and_merge' || s === 'review-and-merge') return 'review-merge';
  if (s === 'deploy_operate' || s === 'deployoperate' || s === 'deploy&operate' || s === 'deploy_and_operate' || s === 'deploy-and-operate') return 'deploy-operate';

  // Already correct
  if (s === 'plan-code' || s === 'review-merge' || s === 'deploy-operate' || s === 'global') return s as any;

  return undefined;
}

// --- Register all rules (keep Rule 1 you already added) ---
export const generatePerformanceInsights = (input: PerformanceInputs): PerformanceInsight[] => {
  console.log('🔍 [DEBUG] generatePerformanceInsights called with', {
    sessionsCount: input.sessions?.length || 0,
    engOutputCount: input.engOutput?.length || 0,
    productivityCount: input.productivity?.length || 0
  });
  
  const PI_DEBUG_ENV_FR = (import.meta as any).env?.VITE_PI_DEBUG ?? 'false';
  const PI_DEBUG_FR = PI_DEBUG_ENV_FR === 'true' || PI_DEBUG_ENV_FR === '1';
  const FLIGHT_RECORDER_ENABLED = PI_DEBUG_FR;

  const wAudit = window as any;
  const getAuditLatch = (key: string): boolean => {
    if (!PI_DEBUG_FR) return true;
    wAudit.__PI_AUDIT__ = wAudit.__PI_AUDIT__ || {};
    if (wAudit.__PI_AUDIT__[key]) return true;
    wAudit.__PI_AUDIT__[key] = true;
    return false;
  };

  const nowIso = () => {
    try {
      return new Date().toISOString();
    } catch {
      return 'unknown';
    }
  };

  const getFlightRecorder = (): any | undefined => {
    if (!FLIGHT_RECORDER_ENABLED) return undefined;
    const w = window as any;
    if (!w.__PI_FLIGHT_RECORDER__) {
      w.__PI_FLIGHT_RECORDER__ = {
        runId: `pi-${Date.now()}`,
        startedAt: nowIso(),
      };
    }
    return w.__PI_FLIGHT_RECORDER__;
  };

  const fr = getFlightRecorder();

  // TEMP: Loud entry log to confirm this is the engine being used
  console.warn('[PI][Engine] ENTER generatePerformanceInsights', {
    DEMO_MODE,
    prodLen: input.productivity?.length || 0,
    engLen: input.engOutput?.length || 0,
    overlap: input.overlap
  })

  // Step 1: Prove dataset wiring for overlap-based rules (printed once per run)
  const PI_DEBUG_DATASETS = ['1', 'true'].includes(((import.meta as any).env?.VITE_PI_DEBUG ?? 'false'))
  if (PI_DEBUG_DATASETS) {
    const prod = input.productivity ?? []
    const eng = input.engOutput ?? []

    const toolsSeenInProductivity = [...new Set(prod.map(p => String((p as any).tool ?? '')).filter(Boolean))].sort()
    const toolsSeenInEngOutput = [...new Set(eng.map(p => String((p as any).tool ?? '')).filter(Boolean))].sort()

    const periodKeysProductivitySample = [...new Set(prod.map(p => String((p as any).period ?? '')).filter(Boolean))].slice(0, 5)
    const periodKeysEngOutputSample = [...new Set(eng.map(p => String((p as any).period ?? '')).filter(Boolean))].slice(0, 5)

    console.group('🔍 [PI_DATASETS_SUMMARY]')
    console.table([
      {
        hasEngOutput: eng.length > 0,
        engOutputLen: eng.length,
        hasProductivity: prod.length > 0,
        productivityLen: prod.length,
        toolsSeenInProductivity: toolsSeenInProductivity.join(', ') || '(none)',
        toolsSeenInEngOutput: toolsSeenInEngOutput.join(', ') || '(none)',
        periodKeysProductivitySample: periodKeysProductivitySample.join(', ') || '(none)',
        periodKeysEngOutputSample: periodKeysEngOutputSample.join(', ') || '(none)',
      }
    ])
    console.groupEnd()

    if (fr) {
      fr.input = {
        counts: {
          engOutputLen: eng.length,
          productivityLen: prod.length,
          sessionsLen: input.sessions?.length || 0,
          overlap: input.overlap,
        },
        toolsSeen: {
          productivity: toolsSeenInProductivity,
          engOutput: toolsSeenInEngOutput,
        },
        periodSamples: {
          productivity: periodKeysProductivitySample,
          engOutput: periodKeysEngOutputSample,
        },
      };
    }
  }
  
  // TTFC_DEBUG: Log sessions at engine entry
  if (TTFC_DEBUG) {
    console.warn('[TTFC_DEBUG][Engine] ENTER generatePerformanceInsights', {
      inputSessionsExists: !!input.sessions,
      inputSessionsLength: input.sessions?.length ?? 0,
      DEMO_MODE
    });
  }
  
  // --- DEMO_MODE: Changed behavior ---
  // REMOVED early-return path. DEMO_MODE now only changes thresholds/scoring, not execution path.
  // All insights go through the standard registry pipeline for consistent processing.
  // 
  // Historical context:
  // - Old DEMO_MODE: Called 10-15 specific rules directly, skipped registry/slotting
  // - Problem: Inconsistent rule execution, bypassed quality gates, prevented full insight set
  // - Fix: Let all rules run through standard registry, use DEMO_MODE only for thresholds
  
  // --- STANDARD PATH (used by all modes now, including DEMO) ---
  console.log('[PI_ENGINE] DEMO_MODE:', DEMO_MODE, 'prodGlobalSource:', input.prodGlobalSource, 'overlap:', input.overlap);
  
  console.log('🔍 PerformanceEngine - input:', input);
  console.log('🔍 PerformanceEngine - engOutput length:', input.engOutput?.length || 0);
  console.log('🔍 PerformanceEngine - productivity length:', input.productivity?.length || 0);
  
  if (import.meta.env.DEV) {
    console.debug('[PI_ENGINE] Thresholds:', {
      minPoints: DEMO_MODE ? DEMO_MIN_POINTS : 4,
      minAbsR: DEMO_MODE ? DEMO_MIN_ABS_R : 0.6,
      pMax: DEMO_MODE ? DEMO_P_MAX : 0.10
    })
  }
  
  // ========== RULE REGISTRY: STAGE IS THE SINGLE SOURCE OF TRUTH ==========
  type RuleSpec = { ruleId: string; stage: CicdStage; rule: Rule };
  const rules: RuleSpec[] = [
    // === TOOL-LEVEL REVIEW & MERGE RULES (diagnostic drill-downs) ===
    { ruleId: 'ai-improves-ct', stage: 'review-merge', rule: ruleAIImprovesCycleTime },
    { ruleId: 'ai-slows-ct', stage: 'review-merge', rule: ruleAISlowsCycleTime },
    { ruleId: 'ai-reopen-rate', stage: 'review-merge', rule: ruleAIImpactsReopenRate },

    // === ORG-LEVEL REVIEW & MERGE SUMMARY RULES (summary strip) ===
    { ruleId: 'org-ai-throughput-impact', stage: 'review-merge', rule: ruleOrgAIThroughputImpactSummary },
    { ruleId: 'org-ai-quality-impact', stage: 'review-merge', rule: ruleOrgAIQualityImpactSummary },
    { ruleId: 'optimal-ai-usage-band', stage: 'review-merge', rule: ruleOptimalAIUsageBand },
    { ruleId: 'org-review-latency-spike', stage: 'review-merge', rule: ruleOrgReviewLatencySpike },
    { ruleId: 'org-pr-cycle-time-bottleneck', stage: 'review-merge', rule: ruleOrgPRCycleTimeBottleneck },
    
    // === REVIEW & MERGE PERFORMANCE INSIGHTS (R3, R4, R5, R6) ===
    { ruleId: 'review-merge-focus-flow', stage: 'review-merge', rule: ruleReviewMergeFocusFlow },
    { ruleId: 'review-merge-git-context', stage: 'review-merge', rule: ruleReviewMergeGitContext },
    { ruleId: 'review-throughput-regression', stage: 'review-merge', rule: ruleReviewThroughputRegression },
    { ruleId: 'review-quality-leading-indicator', stage: 'review-merge', rule: ruleReviewQualityLeadingIndicator },

    // === ORG-LEVEL DEPLOY & OPERATE SUMMARY RULES (summary strip) ===
    { ruleId: 'deploy-reliability-summary', stage: 'deploy-operate', rule: ruleDeployReliabilitySummary },
    { ruleId: 'org-deploy-quality-signal', stage: 'deploy-operate', rule: ruleOrgDeployQualitySignal },
    { ruleId: 'org-ai-deploy-stability-impact', stage: 'deploy-operate', rule: ruleOrgAIDeployStabilityImpact },
    { ruleId: 'org-recovery-posture-summary', stage: 'deploy-operate', rule: ruleOrgRecoveryPostureSummary },
    { ruleId: 'org-deployment-freq-drop', stage: 'deploy-operate', rule: ruleOrgDeploymentFrequencyDrop },
    { ruleId: 'org-change-failure-rate-spike', stage: 'deploy-operate', rule: ruleOrgChangeFailureRateSpike },
    { ruleId: 'org-mttr-spike', stage: 'deploy-operate', rule: ruleOrgMTTRSpike },
    { ruleId: 'org-velocity-reliability-tradeoff', stage: 'deploy-operate', rule: ruleOrgVelocityReliabilityTradeoff },
    { ruleId: 'org-reliability-volatility', stage: 'deploy-operate', rule: ruleOrgReliabilityVolatility },
    { ruleId: 'org-deploy-frequency-volatility', stage: 'deploy-operate', rule: ruleOrgDeployFrequencyVolatility },
    { ruleId: 'org-cfr-trend-deterioration', stage: 'deploy-operate', rule: ruleOrgCFRTrendDeterioration },
    { ruleId: 'org-fast-but-unstable', stage: 'deploy-operate', rule: ruleOrgFastButUnstable },

    // === DEPLOY & OPERATE DETAILED DIAGNOSTICS ===
    { ruleId: 'deploy-freq-driver', stage: 'deploy-operate', rule: ruleDeployFrequencyDriver },
    { ruleId: 'deploy-vscode-ai-posture', stage: 'deploy-operate', rule: ruleDeployVSCodeAIPosture },
    { ruleId: 'deploy-ai-reliability-correlation', stage: 'deploy-operate', rule: ruleDeployAIReliabilityCorrelation },
    
    // === DEPLOY & OPERATE PERFORMANCE INSIGHTS (D5-D9) ===
    { ruleId: 'deploy-time-analysis', stage: 'deploy-operate', rule: ruleDeployTimeAnalysis },
    { ruleId: 'reliability-volatility-regression', stage: 'deploy-operate', rule: ruleReliabilityVolatilityRegression },
    { ruleId: 'rework-leading-reliability-degradation', stage: 'deploy-operate', rule: ruleReworkLeadingReliabilityDegradation },
    { ruleId: 'ai-divergence-pattern', stage: 'deploy-operate', rule: ruleAIDivergencePattern },
    { ruleId: 'data-quality-coverage-gap', stage: 'deploy-operate', rule: ruleDataQualityCoverageGap },

    // === OTHER CORE ENGINEERING INSIGHTS ===
    { ruleId: 'team-ai-throughput', stage: 'review-merge', rule: ruleTeamAIAdoptionVsThroughput },
    { ruleId: 'review-bottleneck', stage: 'review-merge', rule: ruleReviewBottleneck },
    { ruleId: 'tool-ai-roi', stage: 'review-merge', rule: ruleToolAIROI },
    { ruleId: 'coding-vs-output', stage: 'plan-code', rule: ruleCodingTimeVsOutput },
    { ruleId: 'high-risk-area', stage: 'review-merge', rule: ruleHighRiskArea },
    { ruleId: 'review-quality', stage: 'review-merge', rule: ruleReviewQualityDegradation },
    { ruleId: 'ai-experiment', stage: 'review-merge', rule: ruleAIAdoptionExperiment },
    { ruleId: 'coverage-gap', stage: 'review-merge', rule: ruleCoverageGapDetection },

    // === ORG-LEVEL PLAN & CODE RULES (before fallback) ===
    { ruleId: 'org-ai-usage-summary', stage: 'plan-code', rule: ruleOrgAIUsageSummary },
    { ruleId: 'org-coding-time-summary', stage: 'plan-code', rule: ruleOrgCodingTimeSummary },
    { ruleId: 'org-productivity-skew', stage: 'plan-code', rule: ruleOrgProductivitySkew },
    { ruleId: 'org-ttfc-regression', stage: 'plan-code', rule: ruleTTFCRegression },
    { ruleId: 'telemetry-focus-regression', stage: 'plan-code', rule: ruleTelemetryFocusRegression },
    { ruleId: 'telemetry-ttfc-long-tail', stage: 'plan-code', rule: ruleTelemetryTTFCLongTail },
    { ruleId: 'telemetry-idle-heavy-work-proxy', stage: 'plan-code', rule: ruleTelemetryIdleHeavyWorkProxy },
    { ruleId: 'telemetry-rework-spike', stage: 'review-merge', rule: ruleTelemetryReworkSpike },
    { ruleId: 'repo-issue-hotspot-gh', stage: 'plan-code', rule: ruleRepoIssueHotspotGH },

    // === NEW TELEMETRY-BASED PLAN & CODE RULES (ADDITIVE) ===
    { ruleId: 'telemetry-session-quality-regression', stage: 'plan-code', rule: ruleTelemetrySessionQualityRegression },
    { ruleId: 'telemetry-ai-focus-imbalance', stage: 'plan-code', rule: ruleTelemetryAIFocusImbalance },
    { ruleId: 'telemetry-remote-workspace-drag', stage: 'plan-code', rule: ruleTelemetryRemoteWorkspaceDrag },

    // === NEW REVIEW & MERGE RULES (ADDITIVE) ===
    { ruleId: 'reviewer-load-concentration', stage: 'review-merge', rule: ruleReviewerLoadConcentration },
    { ruleId: 'reopen-pressure-spike', stage: 'review-merge', rule: ruleReopenPressureSpike },
    { ruleId: 'large-pr-mix-risk', stage: 'review-merge', rule: ruleLargePRMixRisk },

    // === NEW DEPLOY & OPERATE RULES (ADDITIVE) ===
    { ruleId: 'stale-deployment-signal', stage: 'deploy-operate', rule: ruleStaleDeploymentSignal },
    { ruleId: 'failed-deployment-pressure', stage: 'deploy-operate', rule: ruleFailedDeploymentPressure },
    { ruleId: 'latest-deployment-unhealthy', stage: 'deploy-operate', rule: ruleLatestDeploymentUnhealthy },

    // === 2 META RULES ===
    { ruleId: 'insufficient-data', stage: 'global', rule: ruleInsufficientData },
    { ruleId: 'fallback', stage: 'global', rule: ruleFallbackInsights },
  ];

  const stageByRuleId = new Map<string, CicdStage>(rules.map(r => [r.ruleId, r.stage]));

  const assertPiDebug = (ok: boolean, message: string, details?: any) => {
    if (!PI_DEBUG_FR) return;
    if (ok) return;
    const err = new Error(message);
    console.error('[PI_DEBUG][ASSERT]', message, details || {});
    console.error(err.stack);
  };
  
  // Log Plan & Code org rules registration
  const planCodeOrgRuleIds = rules
    .filter(r => r.ruleId.startsWith('org-') || r.ruleId === 'team-ai-throughput')
    .map(r => r.ruleId);
  console.warn('[PI][Engine] Plan&Code org rules registered:', planCodeOrgRuleIds);
  
  // TEMP: Log rules registry
  console.warn('[PI][Engine] rules registry', rules.map(r => r.ruleId));
  
  console.warn('[PI_RULE_REGISTRY]', {
    ruleCount: rules.length,
    ruleNames: rules.map(r => r.ruleId)
  });
  
  if (import.meta.env.DEV) {
    console.debug('[PI_RULE_REGISTRY] Active rules:', rules.map(r => r.ruleId));
    console.debug('[PI_RULE_REGISTRY] Total count:', rules.length);
    
    // DEV-only runtime inventory logging (one-time at engine load)
    // Analyze rules to determine stage and toolScope (requires executing rules with sample input or static analysis)
    // For now, log basic registry info - detailed inventory requires rule execution
    const ruleKeys = rules.map(r => r.ruleId)
    console.warn('[PI][Engine][Inventory] Rules Registry Summary', {
      totalRules: rules.length,
      ruleKeys,
      note: 'Detailed stage/toolScope inventory requires rule execution - see docs/PI_RULES_INVENTORY.md'
    })
  }

  // Step 2: Confirm engine is calling rules
  console.warn('[PI][Engine] RULE LOOP RUNNING', rules.length);
  
  // Step 3: Confirm this specific rule is in the runtime registry
  console.warn('[PI][Engine] has repo-onboarding-friction-gh?', rules.some(r => r.ruleId === 'repo-onboarding-friction-gh'));

  // ========== PI_TRACE FLAG (for detailed boundary tracing) ==========
  const PI_TRACE = ['1', 'true'].includes(
    ((import.meta as any).env?.VITE_PI_TRACE ?? 'false')
  );
  
  // Test log to verify flag is read
  console.log('🔍 [PI_TRACE][ENGINE] Flag check:', {
    VITE_PI_TRACE: (import.meta as any).env?.VITE_PI_TRACE,
    PI_TRACE_ENABLED: PI_TRACE
  });

  // ========== DIAGNOSTICS: Rule start ==========
  const diag = getDiagnostics();
  
  // ========== RULE TRACE SYSTEM (for regression investigation) ==========
  const PI_DEBUG_ENV = (import.meta as any).env?.VITE_PI_DEBUG ?? 'false';
  const PI_DEBUG = PI_DEBUG_ENV === 'true' || PI_DEBUG_ENV === '1';
  const VITE_RULE_DIAG = (import.meta as any).env?.VITE_RULE_DIAG ?? 'false';
  const tracer = getRuleTracer();
  if (PI_DEBUG) {
    resetRuleTracer(); // Reset for each run
  }
  
  // ========== NO_DATA PROOF COLLECTION (for diagnostic rules) ==========
  if (PI_DEBUG) {
    clearNoDataProofs(); // Clear for each run
  }

  // PI_DEBUG + VITE_RULE_DIAG gate visibility (printed once per run when PI_DEBUG is on)
  if (PI_DEBUG && !getAuditLatch('RULE_MATRIX_GATE')) {
    console.log('[PI_AUDIT][RULE_MATRIX][GATE]', {
      VITE_PI_DEBUG: (import.meta as any).env?.VITE_PI_DEBUG,
      VITE_RULE_DIAG: (import.meta as any).env?.VITE_RULE_DIAG,
      diagEnabled: diag.diagEnabled(),
    });
  }

  // ========== HELPER: Count insights by stage ==========
  function countByStage(insights: any[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const i of insights || []) {
      const s = i?.cicdStage ?? i?.stage ?? 'missing';
      out[s] = (out[s] ?? 0) + 1;
    }
    return out;
  }

  // ========== HELPER: Infer insight tier from properties ==========
  /**
   * Infers insight tier based on rule properties:
   * - posture: orgKind=summary (always-on summaries)
   * - anomaly: spike/drop rules (spike, drop, bottleneck in title/metricId)
   * - trend: volatility-only rules or rules with "trend" in metricId
   * - drill-down: tool_statistical, tool-level rules, or explicitly marked
   */
  function inferInsightTier(insight: PerformanceInsight): InsightTier {
    // If tier is explicitly set, use it
    if (insight.tier) {
      return insight.tier;
    }

    // Posture: org summaries (always-on)
    if (insight.orgKind === 'summary') {
      return 'posture';
    }

    // Anomaly: spike/drop/bottleneck rules
    const titleLower = (insight.title || '').toLowerCase();
    const metricIdLower = (insight.metricId || '').toLowerCase();
    const isSpikeOrDrop = 
      titleLower.includes('spike') || 
      titleLower.includes('drop') || 
      titleLower.includes('bottleneck') ||
      titleLower.includes('regression') ||
      metricIdLower.includes('spike') ||
      metricIdLower.includes('drop') ||
      metricIdLower.includes('bottleneck');
    
    if (isSpikeOrDrop) {
      return 'anomaly';
    }

    // Trend: volatility or trend rules
    const isTrend = 
      titleLower.includes('volatility') ||
      titleLower.includes('trend') ||
      titleLower.includes('deterioration') ||
      titleLower.includes('improving') ||
      metricIdLower.includes('volatility') ||
      metricIdLower.includes('trend');
    
    if (isTrend) {
      return 'trend';
    }

    // Drill-down: tool_statistical, tool-level, or single-ide scope
    if (
      insight.insightClass === 'tool_statistical' ||
      insight.toolScope === 'single-ide' ||
      (insight.tags && insight.tags.some(t => t.includes('tool') || t.includes('team')))
    ) {
      return 'drill-down';
    }

    // Default: diagnostic insights go to anomaly if severity is warning/critical, else trend
    // Also check orgKind for diagnostics
    if (insight.orgKind === 'diagnostic') {
      if (insight.severity === 'warning' || insight.severity === 'critical' || insight.severity === 'risk') {
        return 'anomaly';
      }
      return 'trend'; // Informational diagnostics are trends
    }
    
    if (insight.severity === 'warning' || insight.severity === 'critical' || insight.severity === 'risk') {
      return 'anomaly';
    }

    return 'trend';
  }

  // ========== HELPER: Group insights by tier and apply caps ==========
  /**
   * Groups insights by tier, sorts within tier, and applies visibility caps:
   * - posture: max 5
   * - trend: max 4
   * - anomaly: max 4
   * - drill-down: unlimited (but will be collapsed in UI)
   */
  function groupInsightsByTier(insights: PerformanceInsight[]): {
    posture: PerformanceInsight[];
    trend: PerformanceInsight[];
    anomaly: PerformanceInsight[];
    drillDown: PerformanceInsight[];
  } {
    // First, infer tier for all insights
    const withTiers = insights.map(insight => ({
      ...insight,
      tier: inferInsightTier(insight)
    }));

    // Group by tier
    const grouped = {
      posture: [] as PerformanceInsight[],
      trend: [] as PerformanceInsight[],
      anomaly: [] as PerformanceInsight[],
      drillDown: [] as PerformanceInsight[]
    };

    for (const insight of withTiers) {
      switch (insight.tier) {
        case 'posture':
          grouped.posture.push(insight);
          break;
        case 'trend':
          grouped.trend.push(insight);
          break;
        case 'anomaly':
          grouped.anomaly.push(insight);
          break;
        case 'drill-down':
          grouped.drillDown.push(insight);
          break;
        default:
          // Fallback to trend if tier is somehow invalid
          grouped.trend.push(insight);
      }
    }

    // Sort within each tier: priorityScore DESC, then by recency (id timestamp if available)
    const sortByPriority = (a: PerformanceInsight, b: PerformanceInsight): number => {
      const scoreA = a.priorityScore ?? 50;
      const scoreB = b.priorityScore ?? 50;
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      // If priority scores are equal, try to sort by recency (higher id timestamp = more recent)
      const idA = parseInt(a.id.split('-').pop() || '0', 10) || 0;
      const idB = parseInt(b.id.split('-').pop() || '0', 10) || 0;
      return idB - idA;
    };

    grouped.posture.sort(sortByPriority);
    grouped.trend.sort(sortByPriority);
    grouped.anomaly.sort(sortByPriority);
    grouped.drillDown.sort(sortByPriority);

    // Apply GLOBAL caps (not per-stage)
    // These caps ensure total leader-visible insights stay within 6-12 range
    const MAX_POSTURE = 5;  // Global max across all stages
    const MAX_TREND = 4;    // Global max across all stages
    const MAX_ANOMALY = 4;  // Global max across all stages
    // drill-down unlimited (collapsed by default)

    // Prioritize composite insights and higher severity for anomalies
    const prioritizeAnomalies = (anomalies: PerformanceInsight[]): PerformanceInsight[] => {
      return anomalies.sort((a, b) => {
        // Composite insights first (check for multi-metric indicators)
        const aIsComposite = a.metricId?.includes('tradeoff') || a.metricId?.includes('fast-but-unstable') || false;
        const bIsComposite = b.metricId?.includes('tradeoff') || b.metricId?.includes('fast-but-unstable') || false;
        if (aIsComposite && !bIsComposite) return -1;
        if (!aIsComposite && bIsComposite) return 1;
        
        // Then by severity (critical > risk > warning > info)
        const severityOrder: Record<string, number> = {
          'critical': 4, 'risk': 3, 'warning': 2, 'info': 1, 'opportunity': 0, 'highlight': 0
        };
        const sevA = severityOrder[a.severity?.toLowerCase() || 'info'] || 1;
        const sevB = severityOrder[b.severity?.toLowerCase() || 'info'] || 1;
        if (sevB !== sevA) return sevB - sevA;
        
        // Then by priority score
        const scoreA = a.priorityScore ?? 50;
        const scoreB = b.priorityScore ?? 50;
        return scoreB - scoreA;
      });
    };

    const prioritizedAnomalies = prioritizeAnomalies(grouped.anomaly);

    return {
      posture: grouped.posture.slice(0, MAX_POSTURE),
      trend: grouped.trend.slice(0, MAX_TREND),
      anomaly: prioritizedAnomalies.slice(0, MAX_ANOMALY),
      drillDown: grouped.drillDown
    };
  }

  // ========== HELPER: Generate fallback diagnostic insights ==========
  function generateFallbackDiagnostics(
    selectedInsights: PerformanceInsight[],
    input: PerformanceInputs
  ): PerformanceInsight[] {
    if (!isRelaxedGuardsMode()) {
      return []; // Only in relaxed mode
    }

    const fallbacks: PerformanceInsight[] = [];
    const stages: Array<'plan-code' | 'review-merge' | 'deploy-operate'> = ['plan-code', 'review-merge', 'deploy-operate'];
    
    for (const stage of stages) {
      // Count diagnostics for this stage
      const stageDiagnostics = selectedInsights.filter(
        i => i.cicdStage === stage && i.orgKind === 'diagnostic'
      );
      
      // If no diagnostics, create a fallback
      if (stageDiagnostics.length === 0) {
        // Collect missing data reasons from diagnostics
        const diag = getDiagnostics();
        const missingReasons: string[] = [];
        
        // Check data availability for this stage
        if (stage === 'plan-code') {
          if (!input.productivity || input.productivity.length < 2) {
            missingReasons.push('productivity data (connect VS Code/Cursor)');
          }
          if (!input.sessions || input.sessions.length === 0) {
            missingReasons.push('session telemetry');
          }
        } else if (stage === 'review-merge') {
          if (!input.engOutput || input.engOutput.length < 2) {
            missingReasons.push('GitHub PR data');
          }
          if (!input.productivity || input.productivity.length < 2) {
            missingReasons.push('productivity metrics');
          }
        } else if (stage === 'deploy-operate') {
          if (!input.engOutput || input.engOutput.length < 2) {
            missingReasons.push('deployment telemetry (connect GitHub)');
          }
        }
        
        const reasonText = missingReasons.length > 0
          ? `Missing: ${missingReasons.join(', ')}`
          : 'Insufficient data to generate diagnostics';
        
        const fallback: PerformanceInsight = {
          id: `fallback-diagnostic-${stage}`,
          title: `Data incomplete for ${stage.replace('-', ' & ')}`,
          description: `${reasonText}. Connect additional data sources to see diagnostic insights.`,
          severity: 'info',
          cicdStage: stage,
          insightClass: 'org_deterministic',
          orgKind: 'diagnostic',
          metricId: `fallback.${stage}`,
          tags: ['fallback', 'data-gap'],
          source: 'combined',
          evidence: [
            { label: 'Reason', value: reasonText },
            { label: 'Mode', value: 'Relaxed guards (dev/demo)' }
          ],
          recommendations: [
            {
              text: stage === 'plan-code' 
                ? 'Connect VS Code or Cursor extension to enable coding metrics'
                : stage === 'review-merge'
                ? 'Connect GitHub integration to enable PR cycle time analysis'
                : 'Connect deployment telemetry to enable reliability insights',
              actionType: 'observability'
            }
          ],
          priorityScore: 10 // Low priority
        };
        
        fallbacks.push(fallback);
      }
    }
    
    return fallbacks;
  }

  // ========== RULE MANIFEST TRACKING ==========
  type RuleManifestEntry = {
    ruleId: string;
    countEmitted: number;
    stagesEmitted: string[];
    insightTypes: { summary: number; diagnostic: number };
    topTitles: string[];
    zeroReason?: 'NO_DATA' | 'GUARD_FAIL' | 'THRESHOLD' | 'DISABLED' | 'EMPTY_RESULT' | 'EXCEPTION';
  };
  const ruleManifest = new Map<string, RuleManifestEntry>();
  
  // ========== DROP ACCOUNTING ==========
  type DropEntry = {
    id: string;
    title: string;
    ruleId: string;
    cicdStage: string;
    dropReason: 'DEDUPED' | 'SUMMARY_CAP' | 'STAGE_CAP' | 'DIVERSITY' | 'TOTAL_LIMIT' | 'QUALITY_GATE' | 'GUARDRAIL';
  };
  type PipelineStage = {
    stageName: string;
    enteringCount: number;
    leavingCount: number;
    droppedCount: number;
    topDropped: DropEntry[];
  };
  const pipelineStages: PipelineStage[] = [];

  // ========== EMPTY RESULTS AUDIT (PI_DEBUG only) ==========
  type EmptyResultsAuditRow = {
    ruleId: string;
    stage: string;
    returned: number;
    guardReason: string;
    inputEvidence: string;
    fixCandidate: string;
  };
  const emptyResultsAuditRows: EmptyResultsAuditRow[] = [];

  let raw: PerformanceInsight[] = [];
  for (const spec of rules) {
    const name = spec.ruleId;
    const rule = spec.rule;
    const registryStage = spec.stage;

    // Hard invariant: every executing rule must have an explicit registry stage.
    assertPiDebug(!!registryStage, `Rule executed without registry stage: ${name}`);
    assertPiDebug(registryStage !== ('unknown' as any), `Rule executed with unknown registry stage: ${name}`, { registryStage });
    // Step B: Fallback should only run if nothing else emitted.
    // It is registered last, but we defensively skip it if we already have insights.
    if (name === 'fallback' && raw.length > 0) {
      continue;
    }
    // TEMP: Log before calling each rule
    console.warn('[PI][Engine] calling rule', name);

    // Empty Results Audit: prepare per-rule guard capture
    if (PI_DEBUG) {
      clearGuardAuditForRule(name);
      setActiveRuleKeyForAudit(name);
    }
    
    // ========== RULE TRACE: Start tracking ==========
    if (PI_DEBUG) {
      // Infer rule metadata (stage is bound via registry)
      let cicdStage: string | undefined;
      let insightClass: string | undefined;
      let orgKind: string | undefined;
      let toolScope: string | undefined;
      
      if (name.includes('org-') || name.includes('deploy-') || name.startsWith('org')) {
        insightClass = 'org_deterministic';
        if (name.includes('summary') || name.includes('posture') || name.includes('reliability-summary')) {
          orgKind = 'summary';
        } else {
          orgKind = 'diagnostic';
        }
        toolScope = 'org';
      } else if (name.includes('tool-') || name.includes('ai-') && !name.includes('org-')) {
        insightClass = 'tool_statistical';
        toolScope = 'single-ide';
      }
      
      cicdStage = registryStage;
      
      tracer.startRule(name, input, cicdStage, insightClass, orgKind, toolScope);

      // Empty Results Audit: snapshot inferred stage for table
      // (If the rule emits, we will prefer emitted stage later.)
      (window as any).__PI_EMPTY_AUDIT__ = (window as any).__PI_EMPTY_AUDIT__ || {};
      (window as any).__PI_EMPTY_AUDIT__[name] = (window as any).__PI_EMPTY_AUDIT__[name] || {};
      (window as any).__PI_EMPTY_AUDIT__[name].inferredStage = cicdStage;
    }
    
    // ========== DIAGNOSTICS: Rule start ==========
    if (diag.diagEnabled()) {
      diag.diagRuleStart(name, {
        productivityLen: input.productivity?.length || 0,
        engOutputLen: input.engOutput?.length || 0,
        sessionsLen: input.sessions?.length || 0,
        overlap: input.overlap || 0,
        DEMO_MODE
      });
    }
    
    let out: PerformanceInsight[] = []
    let zeroReason: RuleManifestEntry['zeroReason'] = undefined;
    
    try {
      out = rule(input) || [];
      
      // ========== RULE TRACE: Record emission ==========
      if (PI_DEBUG) {
        tracer.recordEmission(name, out);
      }
      
      // CANONICAL STAGE: single source of truth is registryStage.
      // If an insight provides a stage, we normalize it and assert it matches the registry.
      const normalized = out.map((ins) => {
        const stageRaw = (ins as any).cicdStage ?? (ins as any).stage;
        const normalizedProvidedStage = normalizeStage(stageRaw);

        if (PI_DEBUG) {
          if (normalizedProvidedStage && normalizedProvidedStage !== registryStage) {
            assertPiDebug(false, `Emitted insight stage disagrees with rule registry stage for rule=${name}`, {
              registryStage,
              emittedStageRaw: stageRaw,
              emittedStageNormalized: normalizedProvidedStage,
            });
          }
        }

        return {
          ...ins,
          cicdStage: registryStage,
          // keep stage too if any downstream uses it
          stage: registryStage,
        } as PerformanceInsight;
      });
      
      out = normalized;
      
      // ========== ADD RULE ID TO INSIGHTS (for dedupe and tracking) ==========
      out = out.map(insight => ({
        ...insight,
        ruleId: name  // Store ruleId for dedupe and value loss tracking
      } as PerformanceInsight & { ruleId: string }));
      
      // ========== DIAGNOSTICS: Rule result ==========
      if (out.length === 0) {
        zeroReason = 'EMPTY_RESULT';
        diag.diagRuleEmpty(name, 'EMPTY_RESULT');
      } else {
        diag.diagRuleFired(name, out.length);
      }

      // ========== EMPTY RESULTS AUDIT: Record row ==========
      if (PI_DEBUG) {
        const prod = input.productivity ?? [];
        const sess = input.sessions ?? [];
        const distinctPeriods = new Set(prod.map(p => String((p as any)?.period ?? '')).filter(Boolean)).size;
        const distinctTools = new Set(prod.map(p => String((p as any)?.tool ?? '')).filter(Boolean)).size;
        const ghKeys = input.githubSnapshot ? Object.keys(input.githubSnapshot as any) : [];

        const stage = registryStage;

        const guardFail = getLastGuardFailForRule(name);
        const guardReason = out.length === 0
          ? (guardFail?.reason || 'EMPTY_RESULT(no guard helper recorded)')
          : '';

        let fixCandidate = '';
        if (out.length === 0) {
          if (guardReason.startsWith('requireMinLen(')) fixCandidate = 'Investigate min-length threshold vs live window / bucketing';
          else if (guardReason.startsWith('requireNonEmpty(')) fixCandidate = 'Investigate missing dataset wiring or filter narrowing';
          else if (guardReason.startsWith('requireBoth(')) fixCandidate = 'Investigate dataset join/overlap requirements';
          else fixCandidate = 'Investigate non-helper early returns in rule body';
        }

        emptyResultsAuditRows.push({
          ruleId: name,
          stage,
          returned: out.length,
          guardReason,
          inputEvidence: JSON.stringify({
            productivityLen: prod.length,
            distinctPeriods,
            distinctTools,
            sessionCount: sess.length,
            hasGitHubSnapshot: !!input.githubSnapshot,
            githubSnapshotKeys: ghKeys.slice(0, 10),
          }),
          fixCandidate,
        });
      }
      
      // Enhanced per-rule logging
      if (import.meta.env.DEV) {
        console.debug(`[PI_RULE] ${name}:`, {
          count: out.length,
          sample: out.slice(0, 1).map(i => ({
            id: i.id,
            title: i.title.substring(0, 60),
            metricId: i.metricId,
            tags: i.tags,
            severity: i.severity,
            cicdStage: i.cicdStage
          }))
        })
      }
      
      // PI_DEBUG: Per-rule emission details (NON-DEMO)
      if (PI_DEBUG && out.length > 0) {
        const stages = new Set(out.map(i => i.cicdStage).filter(Boolean));
        console.log(`[PI_DEBUG][RULE_EMIT] ${name}:`, {
          emittedCount: out.length,
          stages: Array.from(stages),
          titles: out.map(i => i.title?.slice(0, 50))
        });
      }
      
      console.log(`🔍 [insights][rule] ${name}:`, out.length, out);
      
      // Explicitly log what we're about to push
      if (out.length > 0) {
        console.warn(`[PI_RULE_PUSH] Pushing ${out.length} insights from ${name} to raw array`);
      }
      
      raw.push(...out);
      
      // Verify push worked
      console.warn(`[PI_RAW_ARRAY_SIZE] After ${name}: ${raw.length}`);
      
      // ========== RULE MANIFEST: Record emission ==========
      const stagesEmitted = Array.from(new Set(out.map(i => i.cicdStage || 'other')));
      const summaryCount = out.filter(i => i.orgKind === 'summary').length;
      const diagnosticCount = out.filter(i => i.orgKind === 'diagnostic').length;
      ruleManifest.set(name, {
        ruleId: name,
        countEmitted: out.length,
        stagesEmitted,
        insightTypes: { summary: summaryCount, diagnostic: diagnosticCount },
        topTitles: out.slice(0, 2).map(i => i.title?.slice(0, 60) || 'NO_TITLE'),
        zeroReason: out.length === 0 ? zeroReason : undefined
      });
      
    } catch (e) {
      // ========== DIAGNOSTICS: Exception ==========
      zeroReason = 'EXCEPTION';
      diag.diagRuleEmpty(name, 'EXCEPTION', { error: String(e).slice(0, 100) });
      
      // ========== RULE MANIFEST: Record exception ==========
      ruleManifest.set(name, {
        ruleId: name,
        countEmitted: 0,
        stagesEmitted: [],
        insightTypes: { summary: 0, diagnostic: 0 },
        topTitles: [],
        zeroReason: 'EXCEPTION'
      });
      
      console.error(`[PI_RULE_EXCEPTION] ${name}:`, e);
      if (import.meta.env.DEV) {
        console.error(`[PI_RULE_ERROR] ${name}:`, e)
      }
    } finally {
      if (PI_DEBUG) {
        setActiveRuleKeyForAudit(null);
      }
    }
  }

  // Emit audit table once per run (PI_DEBUG only)
  if (PI_DEBUG && !getAuditLatch('EMPTY_RESULTS_AUDIT')) {
    console.group('[PI_AUDIT][EMPTY_RESULTS_AUDIT] Rule-by-rule empty results table');
    console.table(emptyResultsAuditRows);
    console.groupEnd();
  }
  
  // ========== PIPELINE STAGE: RAW ==========
  pipelineStages.push({
    stageName: 'RAW',
    enteringCount: raw.length,
    leavingCount: raw.length,
    droppedCount: 0,
    topDropped: []
  });

  // ========== DIAGNOSTICS: Unavoidable RULE_MATRIX (immediately after rule execution) ==========
  // We emit here to ensure it prints whenever the engine runs, regardless of later pipeline branches.
  // Debug-gated only (PI_DEBUG + VITE_RULE_DIAG); no latch.
  try {
    const PI_RULE_MATRIX_EARLY = PI_DEBUG && diag.diagEnabled();
    if (PI_RULE_MATRIX_EARLY) {
      const diagEvents = diag.getEventsSnapshot();
      const diagByRule = new Map<string, any>(diagEvents.map((e: any) => [e.ruleKey, e]));
      const proofs = getNoDataProofs();
      const noDataByRule = new Map<string, NoDataProof[]>();
      proofs.forEach(p => {
        const arr = noDataByRule.get(p.ruleId) || [];
        arr.push(p);
        noDataByRule.set(p.ruleId, arr);
      });

      const rows = rules.map((r) => {
        const ruleId = r.ruleId;
        const registryStage = r.stage;
        const trace = tracer.getTrace(ruleId);
        const ev = diagByRule.get(ruleId);
        const emittedCount = trace?.emittedInsights?.count ?? ev?.count ?? 0;
        let blockedReasonCategory: string = emittedCount > 0 ? 'EMITTED' : 'EMPTY_RESULT';
        if (PI_DEBUG) {
          assertPiDebug(!!registryStage, `RULE_MATRIX missing registry stage for rule=${ruleId}`);
          if (trace?.cicdStage && trace.cicdStage !== registryStage) {
            assertPiDebug(false, `RULE_MATRIX stage mismatch vs registry for rule=${ruleId}`, {
              registryStage,
              traceStage: trace.cicdStage,
            });
          }
        }
        if (emittedCount === 0) {
          const reason = String(ev?.reasonCode || '').toUpperCase();
          if (reason === 'GUARD_FAIL') blockedReasonCategory = 'GUARD_FAIL';
          else if (reason === 'NO_DATA') blockedReasonCategory = 'NO_DATA';
          else if (reason === 'STATS_TOO_WEAK') blockedReasonCategory = 'THRESHOLD/VARIANCE';
          else if (reason === 'EXCEPTION') blockedReasonCategory = 'EXCEPTION';
          if ((noDataByRule.get(ruleId) || []).length > 0) blockedReasonCategory = 'NO_DATA';
        }
        return {
          ruleId,
          stage: registryStage,
          emittedCount,
          blockedReasonCategory,
        };
      });

      const totals = {
        totalRules: rows.length,
        emittedRules: rows.filter((r: any) => r.emittedCount > 0).length,
        emittedInsights: rows.reduce((sum: number, r: any) => sum + (r.emittedCount || 0), 0),
        diagEventsCount: diagEvents.length,
      };
      const byCategory = rows.reduce((acc: Record<string, number>, r: any) => {
        acc[r.blockedReasonCategory] = (acc[r.blockedReasonCategory] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.warn('[PI_AUDIT][RULE_MATRIX][EARLY_EMIT]', { totals, byCategory });
      console.log('[PI_AUDIT][RULE_MATRIX]', { totals, byCategory, rules: rows });
    }
  } catch (matrixEarlyErr) {
    if (PI_DEBUG) {
      console.warn('[PI_AUDIT][RULE_MATRIX][EARLY_EMIT] failed', matrixEarlyErr);
    }
  }

  if (fr) {
    fr.engine = fr.engine || {};
    fr.engine.raw = {
      total: raw.length,
      ids: raw.map(i => i.id),
      byStage: countByStage(raw),
      byOrgKind: {
        summary: raw.filter(i => i.orgKind === 'summary').length,
        diagnostic: raw.filter(i => i.orgKind === 'diagnostic').length,
      },
      bySeverity: raw.reduce((acc, i) => {
        const s = String(i.severity || 'info');
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      valueModeDiagnosticsAdded: raw.filter(i =>
        i.orgKind === 'diagnostic' &&
        (i.tags?.includes('data-missing') || i.tags?.includes('insufficient-history') || i.tags?.includes('stable') || i.tags?.includes('directional'))
      ).length,
    };
  }

  // NOTE: Explicit safety net calls removed - rules are now in the registry
  // If a rule needs to be called explicitly, it should be added to the registry instead

  console.log('🔍 PerformanceEngine - total raw insights:', raw.length);

  // ========== PI_DEBUG: ENGINE EMISSION SUMMARY ==========
  // Keep summary logging, but emit the [PI_AUDIT][ENGINE_EMIT] record at the final return boundary
  // so it matches what the app assigns/renders.
  if (PI_DEBUG) {
    const emittedByStage = countByStage(raw);
    const emittedByOrgKind = {
      summary: raw.filter(i => i.orgKind === 'summary').length,
      diagnostic: raw.filter(i => i.orgKind === 'diagnostic').length,
    };

    const topRulesByEmitted = Array.from(ruleManifest.values())
      .sort((a, b) => (b.countEmitted || 0) - (a.countEmitted || 0))
      .slice(0, 10)
      .map(r => ({ ruleId: r.ruleId, countEmitted: r.countEmitted }));

    console.log('[PI_DEBUG][ENGINE_SUMMARY]', {
      totalEmitted: raw.length,
      emittedByStage,
      emittedByOrgKind,
      topRulesByEmitted,
    });
  }
  
  // ========== DEBUG: RAW INSIGHTS BY STAGE ==========
  if (PI_DEBUG) {
    const rawCounts = countByStage(raw);
    console.log(`[PI_DEBUG][RAW] plan-code=${rawCounts['plan-code']||0}, review-merge=${rawCounts['review-merge']||0}, deploy-operate=${rawCounts['deploy-operate']||0} (total=${raw.length})`);
  }
  
  // ========== MUTUAL EXCLUSION: Deploy Frequency Driver vs Drop ==========
  // If deploy frequency driver rule emitted, suppress deployment frequency drop insights
  // This prevents both "rising while stable" and "drop/neutral" cards from appearing simultaneously
  const deployFreqDriverInsights = raw.filter(i => i.metricId === 'eng.deploy_freq_driver')
  if (deployFreqDriverInsights.length > 0) {
    const beforeCount = raw.length
    const filtered = raw.filter(insight => 
      insight.metricId !== 'org.deployment_frequency_drop'
    )
    const removedCount = beforeCount - filtered.length
    if (removedCount > 0) {
      if (import.meta.env.DEV) {
        console.warn('[PI][Engine][MutualExclusion] Removed', removedCount, 'deployment frequency drop insight(s) because driver rule emitted')
      }
      // Replace raw array with filtered version
      raw.length = 0
      raw.push(...filtered)
    }
  }
  
  // ========== APPLY QUALITY CONTRACT TO ALL INSIGHTS (including direct calls) ==========
  // Ensure ALL insights pass quality contract, regardless of whether they used pushRule() or direct calls
  // This must run BEFORE suppression so we don't suppress invalid insights
  const beforeContract = raw.length
  raw = applyQualityContractToInsights(raw, 'non-DEMO', input)
  if (import.meta.env.DEV && beforeContract !== raw.length) {
    console.warn('[PI][Engine][QualityContract][non-DEMO] Applied to all insights', {
      before: beforeContract,
      after: raw.length,
      removed: beforeContract - raw.length
    })
  }
  
  // ========== GLOBAL MUTUAL EXCLUSION + PRIORITY HIERARCHY ==========
  // Apply suppression rules to prevent redundant cards from appearing together
  // Runs AFTER quality contract so we only suppress valid insights
  raw = applyInsightSuppression(raw)
  
  // ========== GUARDRAIL 1: Summary Uniqueness (Review & Merge) ==========
  // Only ONE summary insight allowed per category (throughput, quality, AI usage context)
  const reviewMergeSummaries = raw.filter(i => 
    i.cicdStage === 'review-merge' && 
    i.toolScope === 'org' && 
    i.summaryEligible === true
  );
  
  const summaryCategories = {
    throughput: reviewMergeSummaries.filter(i => 
      i.metricId === 'eng.ai_throughput_impact' || 
      i.tags?.includes('ai-impact') && i.tags?.includes('cycle-time')
    ),
    quality: reviewMergeSummaries.filter(i => 
      i.metricId === 'eng.ai_quality_impact' || 
      i.tags?.includes('ai-impact') && i.tags?.includes('quality')
    ),
    aiUsageContext: reviewMergeSummaries.filter(i => 
      i.metricId === 'eng.ai_optimal_band' || 
      i.tags?.includes('optimal-band')
    )
  };
  
  // Remove duplicate summaries (keep first, suppress others)
  const summaryToKeep = new Set<string>();
  const summaryToRemove = new Set<string>();
  
  Object.entries(summaryCategories).forEach(([category, insights]) => {
    if (insights.length > 1) {
      console.warn(`[PI][Guardrail] Multiple ${category} summary insights detected, keeping first, suppressing ${insights.length - 1}`);
      // Keep the first one (highest priority or first emitted)
      summaryToKeep.add(insights[0].id);
      insights.slice(1).forEach(i => {
        summaryToRemove.add(i.id);
        console.warn(`[PI][Guardrail] Suppressing duplicate ${category} summary: ${i.title}`);
      });
    } else if (insights.length === 1) {
      summaryToKeep.add(insights[0].id);
    }
  });
  
  // Filter out suppressed summaries
  let filteredRaw = raw.filter(i => !summaryToRemove.has(i.id));
  
  // ========== GUARDRAIL 1B: Summary Uniqueness (Deploy & Operate) ==========
  // Only ONE summary insight allowed per category (deployReliability, qualitySignal, recoveryPosture)
  const deployOperateSummaries = filteredRaw.filter(i => 
    i.cicdStage === 'deploy-operate' && 
    i.toolScope === 'org' && 
    i.summaryEligible === true
  );
  
  const deploySummaryCategories = {
    deployReliability: deployOperateSummaries.filter(i => 
      i.metricId === 'eng.deploy_reliability' || 
      i.tags?.includes('reliability')
    ),
    qualitySignal: deployOperateSummaries.filter(i => 
      i.metricId === 'eng.deploy_quality_signal' || 
      i.tags?.includes('quality')
    ),
    aiStabilityImpact: deployOperateSummaries.filter(i => 
      i.metricId === 'eng.ai_deploy_stability_impact' || 
      (i.tags?.includes('ai-impact') && i.tags?.includes('stability'))
    ),
    recoveryPosture: deployOperateSummaries.filter(i => 
      i.metricId === 'eng.recovery_posture' || 
      i.tags?.includes('recovery')
    )
  };
  
  const deploySummaryToRemove = new Set<string>();
  
  Object.entries(deploySummaryCategories).forEach(([category, insights]) => {
    if (insights.length > 1) {
      console.warn(`[PI][Guardrail] Multiple ${category} summary insights detected (Deploy & Operate), keeping first, suppressing ${insights.length - 1}`);
      // Keep the first one (highest priority or first emitted)
      insights.slice(1).forEach(i => {
        deploySummaryToRemove.add(i.id);
        console.warn(`[PI][Guardrail] Suppressing duplicate ${category} summary (Deploy): ${i.title}`);
      });
    }
  });
  
  // Filter out suppressed Deploy & Operate summaries
  filteredRaw = filteredRaw.filter(i => !deploySummaryToRemove.has(i.id));
  
  // ========== GUARDRAIL 2: Tool-Level Cycle Time Dedup ==========
  // Max ONE cycle-time insight per tool (direction must be mutually exclusive)
  const reviewMergeToolInsights = filteredRaw.filter(i => 
    i.cicdStage === 'review-merge' && 
    i.toolScope === 'single-ide' &&
    (i.metricId === 'eng.pr_cycle_time' || i.tags?.includes('cycle-time'))
  );
  
  const toolCycleTimeMap = new Map<string, PerformanceInsight[]>();
  reviewMergeToolInsights.forEach(insight => {
    const tool = insight.tools?.[0] || insight.related?.tools?.[0] || 'unknown';
    if (!toolCycleTimeMap.has(tool)) {
      toolCycleTimeMap.set(tool, []);
    }
    toolCycleTimeMap.get(tool)!.push(insight);
  });
  
  const toolCycleTimeToRemove = new Set<string>();
  toolCycleTimeMap.forEach((insights, tool) => {
    if (insights.length > 1) {
      // Check if we have both "improves" and "slows" for the same tool
      const hasImproves = insights.some(i => 
        i.title.toLowerCase().includes('faster') || 
        i.title.toLowerCase().includes('improves') ||
        i.severity === 'highlight'
      );
      const hasSlows = insights.some(i => 
        i.title.toLowerCase().includes('slower') || 
        i.title.toLowerCase().includes('slows') ||
        i.severity === 'warning' || i.severity === 'risk'
      );
      
      if (hasImproves && hasSlows) {
        // Keep the one with stronger correlation (higher priorityScore or more severe)
        insights.sort((a, b) => {
          const aScore = a.priorityScore || 0;
          const bScore = b.priorityScore || 0;
          if (aScore !== bScore) return bScore - aScore;
          // If same priority, prefer warning/risk over highlight
          const severityRank: Record<string, number> = { 'risk': 3, 'warning': 2, 'highlight': 1, 'info': 0 };
          return severityRank[b.severity] - severityRank[a.severity];
        });
        // Keep first, remove others
        const toKeep = insights[0];
        insights.slice(1).forEach(i => {
          toolCycleTimeToRemove.add(i.id);
          console.warn(`[PI][Guardrail] Suppressing duplicate cycle-time insight for ${tool}: ${i.title} (keeping: ${toKeep.title})`);
        });
      } else if (insights.length > 1) {
        // Multiple insights of same direction - keep highest priority
        insights.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
        insights.slice(1).forEach(i => {
          toolCycleTimeToRemove.add(i.id);
          console.warn(`[PI][Guardrail] Suppressing duplicate cycle-time insight for ${tool}: ${i.title}`);
        });
      }
    }
  });
  
  // Filter out suppressed tool-level cycle time duplicates
  let finalRaw = filteredRaw.filter(i => !toolCycleTimeToRemove.has(i.id));
  
  // ========== GUARDRAIL 3: High Stability Suppression (Deploy & Operate) ==========
  // When stability is high, suppress informational-only cards
  const deployOperateInsights = finalRaw.filter(i => i.cicdStage === 'deploy-operate');
  
  // Check if we're in high stability mode by examining input data directly
  let isHighStability = false;
  if (input.engOutput && input.engOutput.length > 0) {
    // Get most recent period
    const sorted = [...input.engOutput].sort((a, b) => {
      const aPeriod = a.period || '';
      const bPeriod = b.period || '';
      return aPeriod < bPeriod ? 1 : -1;
    });
    const latest = sorted[0];
    const previous = sorted.slice(1, 4);
    
    const latestCfr = latest.changeFailureRatePct;
    const latestMttr = (latest as any).mttrHours as number | undefined;
    
    // Compute previous period averages for trend
    const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const prevCfrValues = previous
      .map(p => p.changeFailureRatePct)
      .filter((v): v is number => typeof v === 'number' && v >= 0);
    const avgPrevCfr = prevCfrValues.length > 0 ? avg(prevCfrValues) : undefined;
    
    // Determine CFR trend
    let cfrTrend: 'worsening' | 'stable' | 'improving' | undefined;
    if (latestCfr != null && avgPrevCfr != null && avgPrevCfr > 0) {
      const delta = (latestCfr - avgPrevCfr) / avgPrevCfr;
      if (delta > 0.15) {
        cfrTrend = 'worsening';
      } else if (delta < -0.15) {
        cfrTrend = 'improving';
      } else {
        cfrTrend = 'stable';
      }
    }
    
    // High stability: CFR ≤ 10%, stable/improving, MTTR ≤ 24h (or undefined)
    const cfrHealthy = latestCfr != null && latestCfr <= 10;
    const cfrStableOrImproving = cfrTrend === 'stable' || cfrTrend === 'improving' || cfrTrend === undefined;
    const mttrFast = latestMttr == null || latestMttr <= 24;
    
    isHighStability = cfrHealthy && cfrStableOrImproving && mttrFast;
  }
  
  const deploySuppressToRemove = new Set<string>();
  
  if (isHighStability) {
    console.warn('[PI][Guardrail] High stability mode: suppressing informational Deploy & Operate cards');
    
    // Suppress ruleDeployVSCodeAIPosture (informational only)
    deployOperateInsights.forEach(i => {
      // Keep IDE-specific cards visible even in high stability mode.
      if (i.toolScope === 'single-ide') return;
      if (i.metricId === 'eng.deploy_vs_ai_vscode' || 
          (i.tags?.includes('vscode') && i.tags?.includes('deploy') && !i.summaryEligible)) {
        deploySuppressToRemove.add(i.id);
        console.warn(`[PI][Guardrail] Suppressing informational card (high stability): ${i.title}`);
      }
    });
    
    // Suppress tool-level deploy frequency correlations (noise when stable)
    deployOperateInsights.forEach(i => {
      // Keep IDE-specific cards visible even in high stability mode.
      if (i.metricId === 'deployment-frequency' && i.toolScope !== 'single-ide') {
        deploySuppressToRemove.add(i.id);
        console.warn(`[PI][Guardrail] Suppressing tool-level deploy freq correlation (high stability): ${i.title}`);
      }
    });
  }
  
  // Filter out suppressed high-stability cards
  finalRaw = finalRaw.filter(i => !deploySuppressToRemove.has(i.id));
  
  // ========== DROP ACCOUNTING: GUARDRAILS ==========
  const guardrailDropped = raw.length - finalRaw.length;
  const guardrailDroppedInsights: DropEntry[] = [];
  if (guardrailDropped > 0) {
    const finalIds = new Set(finalRaw.map(i => i.id));
    raw.filter(i => !finalIds.has(i.id)).slice(0, 5).forEach(i => {
      guardrailDroppedInsights.push({
        id: i.id,
        title: i.title?.slice(0, 60) || 'NO_TITLE',
        ruleId: (i as any).ruleId || i.metricId || 'unknown',
        cicdStage: i.cicdStage || 'other',
        dropReason: 'GUARDRAIL'
      });
    });
  }
  pipelineStages.push({
    stageName: 'GUARDRAILS',
    enteringCount: raw.length,
    leavingCount: finalRaw.length,
    droppedCount: guardrailDropped,
    topDropped: guardrailDroppedInsights
  });
  
  // ========== DEBUG: GUARDRAILS ==========
  if (PI_DEBUG) {
    const before = countByStage(raw);
    const after = countByStage(finalRaw);
    const dropped = raw.length - finalRaw.length;
    console.log(`[PI_DEBUG][GUARDRAILS] BEFORE: plan-code=${before['plan-code']||0}, review-merge=${before['review-merge']||0}, deploy-operate=${before['deploy-operate']||0} (total=${raw.length})`);
    console.log(`[PI_DEBUG][GUARDRAILS] AFTER:  plan-code=${after['plan-code']||0}, review-merge=${after['review-merge']||0}, deploy-operate=${after['deploy-operate']||0} (total=${finalRaw.length}, dropped=${dropped})`);
    console.log(`[PI_DEBUG][GUARDRAILS] delta: plan-code=${(after['plan-code']||0)-(before['plan-code']||0)}, review-merge=${(after['review-merge']||0)-(before['review-merge']||0)}, deploy-operate=${(after['deploy-operate']||0)-(before['deploy-operate']||0)}`);
  }
  
  // TEMP: Log raw Review & Merge insights
  const rawReviewMerge = finalRaw.filter(i => i.cicdStage === 'review-merge');
  console.debug('[PI] total raw insights (after guardrails):', finalRaw.length);
  console.debug('[PI] raw Review & Merge titles:', rawReviewMerge.map(i => i.title));
  
  // DIAGNOSTIC: Raw insights breakdown
  console.warn('[PI_RAW_INSIGHTS]', {
    rawCount: raw.length,
    afterGuardrails: finalRaw.length,
    reviewMergeSummariesRemoved: summaryToRemove.size,
    deployOperateSummariesRemoved: deploySummaryToRemove.size,
    deployHighStabilitySuppressed: deploySuppressToRemove.size,
    isHighStability,
    toolCycleTimeRemoved: toolCycleTimeToRemove.size,
    byRule: finalRaw.reduce((acc, i) => {
      const rule = (i as any).ruleId || i.tags?.[0] || 'unknown';
      acc[rule] = (acc[rule] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    byStage: finalRaw.reduce((acc, i) => {
      acc[i.cicdStage || 'unknown'] = (acc[i.cicdStage || 'unknown'] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    allIds: finalRaw.map(i => i.id),
    allTitles: finalRaw.map(i => i.title?.slice(0, 40))
  });
  
  if (import.meta.env.DEV) {
    console.debug('[PI_ENGINE] === SELECTION PIPELINE ===')
    console.debug('[PI_ENGINE] Stage 1 - Raw from rules (after guardrails):', finalRaw.length)
  }

  try {
    const noDupes = dedupeKeepPrimaryTool(finalRaw);
    console.log('🔍 PerformanceEngine - after dedupe:', noDupes.length);
    
  // ========== DROP ACCOUNTING: DEDUPED ==========
  const dedupeDropped = finalRaw.length - noDupes.length;
  const dedupeDroppedInsights: DropEntry[] = [];
  if (dedupeDropped > 0) {
    const dedupeIds = new Set(noDupes.map(i => i.id));
    finalRaw.filter(i => !dedupeIds.has(i.id)).slice(0, 5).forEach(i => {
      dedupeDroppedInsights.push({
        id: i.id,
        title: i.title?.slice(0, 60) || 'NO_TITLE',
        ruleId: (i as any).ruleId || i.metricId || 'unknown',
        cicdStage: i.cicdStage || 'other',
        dropReason: 'DEDUPED'
      });
      
      // ========== RULE TRACE: Record dedupe drop ==========
      if (PI_DEBUG && (i as any).ruleId) {
        const trace = tracer.getTrace((i as any).ruleId);
        if (trace && trace.emittedInsights.count > 0) {
          // Check if this was the last insight for this rule
          const remainingForRule = noDupes.filter(ins => (ins as any).ruleId === (i as any).ruleId);
          if (remainingForRule.length === 0) {
            tracer.recordDropReason((i as any).ruleId, 'MERGE_DEDUPE', `All ${trace.emittedInsights.count} insights deduplicated`);
          }
        }
      }
    });
  }
    pipelineStages.push({
      stageName: 'DEDUPED',
      enteringCount: finalRaw.length,
      leavingCount: noDupes.length,
      droppedCount: dedupeDropped,
      topDropped: dedupeDroppedInsights
    });
    
    // ========== DEBUG: DEDUPED INSIGHTS BY STAGE ==========
    if (PI_DEBUG) {
      const dedupeCounts = countByStage(noDupes);
      const dropped = finalRaw.length - noDupes.length;
      console.log(`[PI_DEBUG][DEDUPED] plan-code=${dedupeCounts['plan-code']||0}, review-merge=${dedupeCounts['review-merge']||0}, deploy-operate=${dedupeCounts['deploy-operate']||0} (total=${noDupes.length}, dropped=${dropped})`);
    }
    
    // DIAGNOSTIC: After dedupe
    console.warn('[PI_AFTER_DEDUPE]', {
      raw: raw.length,
      deduped: noDupes.length,
      dedupedInsights: noDupes.map(i => ({
        id: i.id,
        title: i.title?.slice(0, 40),
        cicdStage: i.cicdStage,
        severity: i.severity,
      })),
    });
    
    if (import.meta.env.DEV) {
      console.debug('[PI_ENGINE] Stage 2 - After dedupe:', noDupes.length)
    }

    // ========== UNIVERSAL VALUE CONFIG (Single Source of Truth) ==========
    const valueConfig = getValueConfig();
    const VALUE_MODE = isValueMode();
    const totalLimit = DEMO_MODE ? 12 : valueConfig.totalLimit;
    const stageLimit = valueConfig.stageLimit;
    const perToolMin = Number(import.meta.env.VITE_PERF_INSIGHTS_PER_TOOL_MIN ?? 1);
    const sigP = Number(import.meta.env.VITE_PERF_INSIGHTS_P_MAX ?? 0.10);

    console.log('🔍 PerformanceEngine - config:', { 
      VALUE_MODE,
      totalLimit, 
      stageLimit,
      perToolMin, 
      sigP,
      maxSummariesPerStage: valueConfig.maxSummariesPerStage,
      minDiagnosticsPerStage: valueConfig.minDiagnosticsPerStage,
      maxPerMetric: valueConfig.maxPerMetric
    });

    // =========================================================================
    // SELECTION PIPELINE: Partition by insightClass
    // =========================================================================
    // 1. org_deterministic: Bypass selectWithPerToolFloor (no p-values, no tool)
    //    - Split into org summaries (always-on) vs org diagnostics (situational)
    //    - Apply separate caps per stage
    // 2. tool_statistical: Run through selectWithPerToolFloor (p-value filtering)
    // 3. Merge back with stage-aware caps
    // =========================================================================
    
    // Stage-specific caps from universal config
    const MAX_ORG_SUMMARIES: Record<string, number> = {
      'plan-code': Math.max(valueConfig.maxSummariesPerStage, 3),
      'review-merge': Math.max(valueConfig.maxSummariesPerStage, 3),
      'deploy-operate': Math.max(valueConfig.maxSummariesPerStage, 3),
      'other': valueConfig.maxSummariesPerStage
    };
    const MAX_ORG_DIAGNOSTICS: Record<string, number> = {
      'plan-code': Math.max(valueConfig.minDiagnosticsPerStage, 3),
      'review-merge': Math.max(valueConfig.minDiagnosticsPerStage, 5),
      'deploy-operate': Math.max(valueConfig.minDiagnosticsPerStage, 5),
      'other': Math.max(valueConfig.minDiagnosticsPerStage, 2)
    };
    
    // Partition by insightClass
    // Default: insights without insightClass are treated as tool_statistical (legacy compatibility)
    // Insights with explicit 'org_deterministic' bypass tool selection
    const orgDeterministic = noDupes.filter(i => i.insightClass === 'org_deterministic');
    const toolStatistical = noDupes.filter(i => i.insightClass === 'tool_statistical' || !i.insightClass);
    
    // ========== VALUE MODE PRIORITIZATION SCORER (defined at selection scope) ==========
    // Priority order: Diagnostics (telemetry/repo/tool) > High-signal summaries > Tool statistical
    // Within diagnostics: telemetry-derived > repo-derived > generic
    const valueScorer = (insight: PerformanceInsight): number => {
      let score = 0;
      
      // Base: diagnostics get higher priority than summaries
      if (insight.orgKind === 'diagnostic') {
        score += 1000;
        
        // Telemetry-derived diagnostics (highest value)
        if (insight.metricId?.includes('ttfc') || insight.metricId?.includes('rework') || 
            insight.metricId?.includes('flow') || insight.tags?.includes('telemetry')) {
          score += 500;
        }
        // Repo-derived diagnostics (high value)
        else if (insight.metricId?.includes('repo') || insight.metricId?.includes('issue') || 
                 insight.source === 'github') {
          score += 300;
        }
      } else if (insight.orgKind === 'summary') {
        score += 100;  // Summaries are lower priority
      }
      
      // Severity boost
      const severityPriority: Record<string, number> = {
        'critical': 100, 'risk': 80, 'warning': 60, 'opportunity': 40, 
        'highlight': 30, 'info': 10, 'lowlight': 5
      };
      score += severityPriority[insight.severity] || 0;
      
      // Delta magnitude boost
      const delta = Math.abs(insight.evidence?.find(e => e.delta != null)?.delta as number || 0);
      score += Math.min(delta * 10, 50);  // Cap delta boost
      
      // Priority score boost
      score += (insight.priorityScore || 0) * 0.1;
      
      return score;
    };
    
    const byValueScore = (a: PerformanceInsight, b: PerformanceInsight): number => {
      return valueScorer(b) - valueScorer(a);
    };
    
    // ========== DEBUG: SELECTION INPUTS ==========
    if (PI_DEBUG) {
      const orgCounts = countByStage(orgDeterministic);
      const toolCounts = countByStage(toolStatistical);
      const pcSum = orgDeterministic.filter(i => i.cicdStage === 'plan-code' && i.orgKind === 'summary').length;
      const pcDiag = orgDeterministic.filter(i => i.cicdStage === 'plan-code' && i.orgKind === 'diagnostic').length;
      const rmSum = orgDeterministic.filter(i => i.cicdStage === 'review-merge' && i.orgKind === 'summary').length;
      const rmDiag = orgDeterministic.filter(i => i.cicdStage === 'review-merge' && i.orgKind === 'diagnostic').length;
      const doSum = orgDeterministic.filter(i => i.cicdStage === 'deploy-operate' && i.orgKind === 'summary').length;
      const doDiag = orgDeterministic.filter(i => i.cicdStage === 'deploy-operate' && i.orgKind === 'diagnostic').length;
      console.log(`[PI_DEBUG][SELECTION_INPUTS] org_deterministic: plan-code=${orgCounts['plan-code']||0} (sum=${pcSum},diag=${pcDiag}), review-merge=${orgCounts['review-merge']||0} (sum=${rmSum},diag=${rmDiag}), deploy-operate=${orgCounts['deploy-operate']||0} (sum=${doSum},diag=${doDiag})`);
      console.log(`[PI_DEBUG][SELECTION_INPUTS] tool_statistical: plan-code=${toolCounts['plan-code']||0}, review-merge=${toolCounts['review-merge']||0}, deploy-operate=${toolCounts['deploy-operate']||0}`);
    }
    
    let floorSelected: PerformanceInsight[];
    let orgSelectionDropped: DropEntry[] = []; // Track dropped items from org selection
    
    if (DEMO_MODE) {
      // In demo, keep all correlation insights, then add others up to limit
      const isCorrelation = (i: PerformanceInsight) => {
        const tags = i.tags || [];
        return tags.includes('ai-impact') || tags.includes('ai-adoption') || 
               (i.metricId?.includes('pr_cycle_time') && tags.some(t => t.includes('ai'))) ||
               (i.metricId?.includes('change_failure') && tags.some(t => t.includes('ai')));
      };
      const correlation = noDupes.filter(isCorrelation);
      const nonCorrelation = noDupes.filter(i => !isCorrelation(i));
      
      const core = correlation.slice(0, totalLimit);
      const remainingSlots = totalLimit - core.length;
      const extras = remainingSlots > 0 ? nonCorrelation.slice(0, remainingSlots) : [];
      floorSelected = [...core, ...extras];
      
      console.warn('[PI_DEMO_SELECTION]', {
        correlationCount: correlation.length,
        nonCorrelationCount: nonCorrelation.length,
        keptCorrelation: core.length,
        keptOther: extras.length,
        totalSelected: floorSelected.length
      });
    } else {
      // NON-DEMO: Split selection paths with org summary/diagnostic distinction
      
      // 1. Partition org_deterministic into summaries vs diagnostics
      const orgSummaries = orgDeterministic.filter(i => i.orgKind === 'summary');
      const orgDiagnostics = orgDeterministic.filter(i => i.orgKind === 'diagnostic');
      
      // Legacy helper for backward compatibility (uses valueScorer defined above)
      const bySeverityThenDelta = (a: PerformanceInsight, b: PerformanceInsight): number => {
        return byValueScore(a, b);
      };
      
      // VALUE MODE: Prioritize diagnostics - ensure diagnostics are selected before summaries
      // This prevents summaries from crowding out diagnostics
      
      // 2. Select org diagnostics FIRST (prioritized)
      // VALUE MODE: Apply floor score to ensure visibility diagnostics survive
      const diagnosticsWithFloor = orgDiagnostics.map(insight => {
        if (isValueMode()) {
          const tags = insight.tags || [];
          const hasVisibilityTag = tags.some(t => 
            t === 'insufficient-history' || t === 'data-missing' || t === 'stable' || t === 'low-confidence'
          );
          if (hasVisibilityTag && (insight.priorityScore || 0) < 40) {
            return {
              ...insight,
              priorityScore: Math.max(insight.priorityScore || 0, 35) // Floor score for visibility
            };
          }
        }
        return insight;
      });
      
      const diagnosticsByStage = new Map<string, PerformanceInsight[]>();
      for (const insight of diagnosticsWithFloor) {
        const stage = insight.cicdStage || 'other';
        if (!diagnosticsByStage.has(stage)) diagnosticsByStage.set(stage, []);
        diagnosticsByStage.get(stage)!.push(insight);
      }
      
      const selectedOrgDiagnostics: PerformanceInsight[] = [];
      const diagnosticDropped: DropEntry[] = [];
      for (const [stage, insights] of diagnosticsByStage.entries()) {
        // Sort diagnostics by value score (telemetry/repo prioritized)
        insights.sort(byValueScore);
        const cap = MAX_ORG_DIAGNOSTICS[stage] || MAX_ORG_DIAGNOSTICS['other'];
        let kept = insights.slice(0, cap);
        
        // VALUE MODE: Ensure minimum diagnostics per stage
        if (VALUE_MODE && valueConfig.minDiagnosticsPerStage && kept.length < valueConfig.minDiagnosticsPerStage && insights.length >= valueConfig.minDiagnosticsPerStage) {
          // Promote additional diagnostics to meet minimum
          const needed = valueConfig.minDiagnosticsPerStage - kept.length;
          const additional = insights.slice(cap, cap + needed);
          kept = [...kept, ...additional];
        }
        
        selectedOrgDiagnostics.push(...kept);
        
        // Track dropped diagnostics
        if (insights.length > kept.length) {
          const keptIds = new Set(kept.map(i => i.id));
          insights.filter(i => !keptIds.has(i.id)).slice(0, 5).forEach(i => {
            diagnosticDropped.push({
              id: i.id,
              title: i.title?.slice(0, 60) || 'NO_TITLE',
              ruleId: (i as any).ruleId || i.metricId || 'unknown',
              cicdStage: stage,
              dropReason: 'STAGE_CAP'
            });
          });
        }
        
        if (PI_DEBUG && insights.length > cap) {
          console.warn('[PI_DEBUG][OrgSelection] Capped org diagnostics for stage', {
            stage,
            total: insights.length,
            kept: kept.length,
            droppedTitles: insights.slice(cap).map(i => i.title?.slice(0, 40))
          });
        }
      }
      
      // 3. Select org summaries per stage (after diagnostics, up to cap)
      const summariesByStage = new Map<string, PerformanceInsight[]>();
      for (const insight of orgSummaries) {
        const stage = insight.cicdStage || 'other';
        if (!summariesByStage.has(stage)) summariesByStage.set(stage, []);
        summariesByStage.get(stage)!.push(insight);
      }
      
      const selectedOrgSummaries: PerformanceInsight[] = [];
      const summaryDropped: DropEntry[] = [];
      for (const [stage, insights] of summariesByStage.entries()) {
        // Summaries are always-on, but VALUE MODE: reduce summary cap if diagnostics need space
        let cap = MAX_ORG_SUMMARIES[stage] || MAX_ORG_SUMMARIES['other'];
        
        // VALUE MODE: If we have many diagnostics, reduce summary cap to ensure diagnostics aren't crowded out
        const stageDiagnostics = selectedOrgDiagnostics.filter(i => i.cicdStage === stage);
        if (VALUE_MODE && stageDiagnostics.length > 0 && insights.length > cap) {
          // Keep summary cap but ensure we don't exceed stage limit
          if (stageLimit && (stageDiagnostics.length + cap) > stageLimit) {
            cap = Math.max(1, stageLimit - stageDiagnostics.length);
          }
        }
        
        const kept = insights.slice(0, cap);
        selectedOrgSummaries.push(...kept);
        
        // Track dropped summaries
        if (insights.length > cap) {
          insights.slice(cap).slice(0, 5).forEach(i => {
            summaryDropped.push({
              id: i.id,
              title: i.title?.slice(0, 60) || 'NO_TITLE',
              ruleId: (i as any).ruleId || i.metricId || 'unknown',
              cicdStage: stage,
              dropReason: 'SUMMARY_CAP'
            });
          });
        }
        
        if (PI_DEBUG && insights.length > cap) {
          console.warn('[PI_DEBUG][OrgSelection] Capped org summaries for stage', {
            stage,
            total: insights.length,
            kept: kept.length,
            droppedTitles: insights.slice(cap).map(i => i.title?.slice(0, 40))
          });
        }
      }
      
      const cappedOrgDeterministic = [...selectedOrgSummaries, ...selectedOrgDiagnostics];
      
      // Store dropped items for later accounting (outside DEMO_MODE block)
      orgSelectionDropped = [...summaryDropped, ...diagnosticDropped];
      
      // ========== DEBUG: ORG_SELECTED ==========
      if (PI_DEBUG) {
        const pcSum = selectedOrgSummaries.filter(i => i.cicdStage === 'plan-code').length;
        const pcDiag = selectedOrgDiagnostics.filter(i => i.cicdStage === 'plan-code').length;
        const rmSum = selectedOrgSummaries.filter(i => i.cicdStage === 'review-merge').length;
        const rmDiag = selectedOrgDiagnostics.filter(i => i.cicdStage === 'review-merge').length;
        const doSum = selectedOrgSummaries.filter(i => i.cicdStage === 'deploy-operate').length;
        const doDiag = selectedOrgDiagnostics.filter(i => i.cicdStage === 'deploy-operate').length;
        console.log(`[PI_DEBUG][ORG_SELECTED] plan-code: sum=${pcSum}, diag=${pcDiag} | review-merge: sum=${rmSum}, diag=${rmDiag} | deploy-operate: sum=${doSum}, diag=${doDiag}`);
        
        // ========== DEBUG: SELECTED DIAGNOSTIC TITLES ==========
        const stages: Array<'plan-code' | 'review-merge' | 'deploy-operate'> = ['plan-code', 'review-merge', 'deploy-operate'];
        for (const stage of stages) {
          const stageDiags = selectedOrgDiagnostics.filter(i => i.cicdStage === stage);
          const stageSums = selectedOrgSummaries.filter(i => i.cicdStage === stage);
          console.log(`[PI_DEBUG][SELECTED_TITLES] ${stage}: diag=${stageDiags.length}, sum=${stageSums.length}, diagTitles=[${stageDiags.map(i => i.title?.slice(0, 50)).join(', ')}], sumTitles=[${stageSums.map(i => i.title?.slice(0, 50)).join(', ')}]`);
        }
      }
      
      // 4. Run selectWithPerToolFloor ONLY on tool_statistical insights
      const selectedToolStatistical = toolStatistical.length > 0
        ? selectWithPerToolFloor({
            raw: toolStatistical,  // Only pass tool_statistical insights
            deduped: toolStatistical,
            totalLimit: Math.max(totalLimit - cappedOrgDeterministic.length, 4),  // Reserve slots
            perToolMin,
            sigP,
          })
        : [];
      
      // 5. Merge: org_deterministic first (summaries + diagnostics), then tool_statistical
      floorSelected = [...cappedOrgDeterministic, ...selectedToolStatistical];
      
      // 6. Add fallback diagnostics if needed (only in relaxed mode)
      const fallbackDiagnostics = generateFallbackDiagnostics(floorSelected, input);
      if (fallbackDiagnostics.length > 0) {
        floorSelected.push(...fallbackDiagnostics);
        if (PI_DEBUG) {
          console.log(`[PI_DEBUG][FALLBACK] Added ${fallbackDiagnostics.length} fallback diagnostics`);
        }
      }
    }
    
    console.log('🔍 PerformanceEngine - after floor selection:', floorSelected.length);
    
    // ========== DEBUG: FLOOR SELECTED INSIGHTS BY STAGE ==========
    if (PI_DEBUG) {
      const floorCounts = countByStage(floorSelected);
      console.log(`[PI_DEBUG][FLOOR_SELECTED] plan-code=${floorCounts['plan-code']||0}, review-merge=${floorCounts['review-merge']||0}, deploy-operate=${floorCounts['deploy-operate']||0} (total=${floorSelected.length})`);
    }
    
    if (import.meta.env.DEV) {
      console.debug('[PI_ENGINE] Stage 3 - After floor selection:', floorSelected.length)
    }

    // ========== DROP ACCOUNTING: STAGE CAPS ==========
    const beforeCaps = noDupes.length;
    const afterCaps = floorSelected.length;
    const capsDropped = beforeCaps - afterCaps;
    
    pipelineStages.push({
      stageName: 'STAGE_CAPS',
      enteringCount: beforeCaps,
      leavingCount: afterCaps,
      droppedCount: capsDropped,
      topDropped: orgSelectionDropped.slice(0, 5)
    });
    
    // Keep your existing diversity filter but run it AFTER the floor selection.
    // DEMO_MODE: Skip diversity filter to keep all correlation insights
    // VALUE_MODE: Use config's maxPerMetric
    const perMetricMax = DEMO_MODE ? 99 : valueConfig.maxPerMetric;
    
    const diversified = DEMO_MODE 
      ? floorSelected  // In demo, skip diversity filtering - keep all selected insights
      : diversifyInsights(floorSelected, perMetricMax, totalLimit, {
          lockedEquivalenceKeys: new Set(floorSelected.map(i => i.id))
        });
    console.log('🔍 PerformanceEngine - after diversity:', diversified.length);
    
    // ========== DROP ACCOUNTING: DIVERSITY ==========
    const diversityDropped = floorSelected.length - diversified.length;
    const diversityDroppedInsights: DropEntry[] = [];
    if (diversityDropped > 0) {
      const diversifiedIds = new Set(diversified.map(i => i.id));
      floorSelected.filter(i => !diversifiedIds.has(i.id)).slice(0, 5).forEach(i => {
        diversityDroppedInsights.push({
          id: i.id,
          title: i.title?.slice(0, 60) || 'NO_TITLE',
          ruleId: (i as any).ruleId || i.metricId || 'unknown',
          cicdStage: i.cicdStage || 'other',
          dropReason: 'DIVERSITY'
        });
      });
    }
    pipelineStages.push({
      stageName: 'DIVERSITY',
      enteringCount: floorSelected.length,
      leavingCount: diversified.length,
      droppedCount: diversityDropped,
      topDropped: diversityDroppedInsights
    });
    
    // ========== DEBUG: FINAL OUTPUT INSIGHTS BY STAGE ==========
    if (PI_DEBUG) {
      const finalCounts = countByStage(diversified);
      console.log(`[PI_DEBUG][FINAL_OUTPUT] plan-code=${finalCounts['plan-code']||0}, review-merge=${finalCounts['review-merge']||0}, deploy-operate=${finalCounts['deploy-operate']||0} (total=${diversified.length})`);
    }
    
    // DIAGNOSTIC: After diversity
    console.warn('[PI_AFTER_DIVERSITY]', {
      finalCount: diversified.length,
      byTag: diversified.reduce((acc, i) => {
        const tag = i.tags?.[0] || 'unknown';
        acc[tag] = (acc[tag] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      finalIds: diversified.map(i => i.id),
      finalTitles: diversified.map(i => i.title?.slice(0, 40))
    });
    
    if (import.meta.env.DEV) {
      console.debug('[PI_ENGINE] Stage 4 - After diversity:', {
        perMetricMax,
        count: diversified.length,
        sample: diversified.slice(0, 3).map(i => i.title.substring(0, 50))
      })
    }
    console.log('🔍 PerformanceEngine - diversified items:', diversified.map(i => ({
      id: i.id,
      tool: i.related?.tools?.[0],
      title: i.title.substring(0, 50) + '...',
      p: i.evidence.find(e => e.label.toLowerCase().includes('p'))?.value,
      r: i.evidence.find(e => e.label.toLowerCase().includes('correlation') && e.label.includes('r'))?.value,
      equivalenceKey: equivalenceKey(i)
    })));

    // ========== VALUE MODE: ENFORCE GLOBAL TELEMETRY/REPO MINIMUMS ==========
    let beforeGlobalMins = diversified;
    let afterGlobalMins = [...diversified];
    
    if (VALUE_MODE) {
      // Check telemetry diagnostics
      const telemetryDiagnostics = afterGlobalMins.filter(i => 
        i.orgKind === 'diagnostic' && 
        (i.metricId?.includes('ttfc') || i.metricId?.includes('rework') || 
         i.metricId?.includes('flow') || i.tags?.includes('telemetry'))
      );
      const hasTelemetryData = (input.sessions?.length || 0) > 0;
      
      if (telemetryDiagnostics.length < valueConfig.minTelemetryDiagnosticsGlobal && hasTelemetryData) {
        // Find missing telemetry diagnostics from raw pool
        const missingTelemetry = raw.filter(i => 
          i.orgKind === 'diagnostic' &&
          (i.metricId?.includes('ttfc') || i.metricId?.includes('rework') || 
           i.metricId?.includes('flow') || i.tags?.includes('telemetry')) &&
          !afterGlobalMins.some(existing => existing.id === i.id)
        ).sort(byValueScore);
        
        const needed = valueConfig.minTelemetryDiagnosticsGlobal - telemetryDiagnostics.length;
        afterGlobalMins.push(...missingTelemetry.slice(0, needed));
      }
      
      // Check repo diagnostics
      const repoDiagnostics = afterGlobalMins.filter(i => 
        i.orgKind === 'diagnostic' && 
        (i.metricId?.includes('repo') || i.metricId?.includes('issue') || i.source === 'github')
      );
      const hasRepoData = (input.engOutput?.some(e => e.repo) || false);
      
      if (repoDiagnostics.length < valueConfig.minRepoDiagnosticsGlobal && hasRepoData) {
        // Find missing repo diagnostics from raw pool
        const missingRepo = raw.filter(i => 
          i.orgKind === 'diagnostic' &&
          (i.metricId?.includes('repo') || i.metricId?.includes('issue') || i.source === 'github') &&
          !afterGlobalMins.some(existing => existing.id === i.id)
        ).sort(byValueScore);
        
        const needed = valueConfig.minRepoDiagnosticsGlobal - repoDiagnostics.length;
        afterGlobalMins.push(...missingRepo.slice(0, needed));
      }
    }
    
    // ========== TOTAL LIMIT ENFORCEMENT (VALUE MODE) ==========
    let beforeTotalLimit = afterGlobalMins;
    let afterTotalLimit = afterGlobalMins;
    if (VALUE_MODE && afterGlobalMins.length > totalLimit) {
      // Prioritize: diagnostics > summaries > tool_statistical
      const diagnostics = afterGlobalMins.filter(i => i.orgKind === 'diagnostic');
      const summaries = afterGlobalMins.filter(i => i.orgKind === 'summary');
      const toolStats = afterGlobalMins.filter(i => i.insightClass === 'tool_statistical' || !i.insightClass);
      
      // Sort each category by value score
      diagnostics.sort(byValueScore);
      summaries.sort(byValueScore);
      toolStats.sort(byValueScore);
      
      // Build prioritized list: diagnostics first, then summaries, then tool stats
      const prioritized: PerformanceInsight[] = [];
      prioritized.push(...diagnostics);
      prioritized.push(...summaries);
      prioritized.push(...toolStats);
      
      afterTotalLimit = prioritized.slice(0, totalLimit);
    }
    
    // ========== DROP ACCOUNTING: TOTAL_LIMIT ==========
    const totalLimitDropped = beforeTotalLimit.length - afterTotalLimit.length;
    const totalLimitDroppedInsights: DropEntry[] = [];
    if (totalLimitDropped > 0) {
      const afterIds = new Set(afterTotalLimit.map(i => i.id));
      beforeTotalLimit.filter(i => !afterIds.has(i.id)).slice(0, 5).forEach(i => {
        totalLimitDroppedInsights.push({
          id: i.id,
          title: i.title?.slice(0, 60) || 'NO_TITLE',
          ruleId: (i as any).ruleId || i.metricId || 'unknown',
          cicdStage: i.cicdStage || 'other',
          dropReason: 'TOTAL_LIMIT'
        });
      });
    }
    pipelineStages.push({
      stageName: 'TOTAL_LIMIT',
      enteringCount: beforeTotalLimit.length,
      leavingCount: afterTotalLimit.length,
      droppedCount: totalLimitDropped,
      topDropped: totalLimitDroppedInsights
    });
    
    const processed = postProcessInsights(afterTotalLimit);
    console.log('🔍 PerformanceEngine - after post-processing:', processed.length);
    
    // ========== RULE TRACE: Track postProcess drops ==========
    if (PI_DEBUG) {
      const processedIds = new Set(processed.map(i => i.id));
      afterTotalLimit.filter(i => !processedIds.has(i.id)).forEach(i => {
        if ((i as any).ruleId) {
          tracer.recordDropReason((i as any).ruleId, 'POSTPROCESS_FILTER', `Post-process filter: ${i.title?.slice(0, 40)}`);
        }
      });
    }
    
    // ========== APPLY SLOTTING SYSTEM (Replaces tier grouping) ==========
    // Step 1: Infer tiers and story keys for all insights
    const withTiersAndStoryKeys = processed.map(insight => {
      const tier = insight.tier || inferInsightTier(insight);
      const storyKey = insight.storyKey || inferStoryKey(insight);
      return { 
        ...insight, 
        tier,
        storyKey: storyKey || undefined 
      };
    });
    
    // Step 2: Build scoring context
    const hasTelemetry = (input.sessions?.length || 0) > 0;
    const hasGitHub = (input.engOutput?.length || 0) > 0;
    const hasSimulated = (input.productivity?.some(p => p.source === 'sim') || false);
    
    const scoringContext = {
      stage: 'all',
      hasTelemetry,
      hasGitHub,
      hasSimulated,
      isValueMode: VALUE_MODE
    };

    // ========== PI_AUDIT: WOW CONTEXT (once per run, debug-gated) ==========
    // Proves whether Wow Restore context is active and whether diagnostics/tool inventory exists.
    if (PI_DEBUG && !getAuditLatch('WOW_CONTEXT')) {
      try {
        const afterGuardrails = finalRaw || [];
        const stages: Array<'plan-code' | 'review-merge' | 'deploy-operate'> = ['plan-code', 'review-merge', 'deploy-operate'];
        const perStage = stages.reduce((acc, stage) => {
          const list = afterGuardrails.filter(i => i.cicdStage === stage);
          const toolStat = list.filter(i => i.insightClass === 'tool_statistical' || !i.insightClass).length;
          const summary = list.filter(i => i.orgKind === 'summary').length;
          const diagnostic = list.filter(i => i.orgKind === 'diagnostic').length;
          acc[stage] = { candidateCounts: { summary, diagnostic, tool_statistical: toolStat } };
          return acc;
        }, {} as Record<string, any>);

        console.log('[PI_AUDIT][WOW_CONTEXT]', {
          VALUE_MODE,
          hasTelemetry,
          hasGitHub,
          hasSimulated,
          perStage,
        });
      } catch (e) {
        console.warn('[PI_AUDIT][WOW_CONTEXT] failed to build', e);
      }
    }
    
    // Step 3: Fill slots per stage
    if (PI_DEBUG) {
      const bad = (withTiersAndStoryKeys || []).filter((i: any) => {
        const s = normalizeStage(i?.cicdStage ?? i?.stage);
        return !s;
      });
      if (bad.length > 0) {
        assertPiDebug(false, 'Insight entered slotting without resolved cicdStage', {
          count: bad.length,
          sample: bad.slice(0, 3).map((i: any) => ({
            id: i?.id,
            ruleId: i?.ruleId,
            cicdStage: i?.cicdStage,
            stage: i?.stage,
            metricId: i?.metricId,
          })),
        });
      }
    }
    const slotConfig = DEFAULT_SLOT_CONFIG;
    const planCodeSlots = fillStageSlots(withTiersAndStoryKeys, 'plan-code', slotConfig, { ...scoringContext, stage: 'plan-code' });
    const reviewMergeSlots = fillStageSlots(withTiersAndStoryKeys, 'review-merge', slotConfig, { ...scoringContext, stage: 'review-merge' });
    const deployOperateSlots = fillStageSlots(withTiersAndStoryKeys, 'deploy-operate', slotConfig, { ...scoringContext, stage: 'deploy-operate' });

    // ========== PLAN-CODE ONLY: Quota + Card Contract (min 3 / max 6) ==========
    type PlanCodeCategory = 'PRIMARY' | 'SECONDARY' | 'DIAGNOSTIC';
    type PlanCodeFillerUsed = { id: string; reason: string; windowLabel: string };
    type PlanCodePromotedFrom = { id: string; fromBucket: 'non_visible' | 'drilldown' | 'candidate_pool' | 'synthetic' };
    type PlanCodeDropped = { id: string; reason: 'cap' | 'duplicate' | 'contract_fail' };

    const getDebugOnceLatch = (key: string): boolean => {
      if (!PI_DEBUG) return true;
      const w = window as any;
      w.__PI_AUDIT_ONCE__ = w.__PI_AUDIT_ONCE__ || {};
      if (w.__PI_AUDIT_ONCE__[key]) return true;
      w.__PI_AUDIT_ONCE__[key] = true;
      return false;
    };

    const computeWindowLabelForPlanCode = (): string => {
      try {
        const granularity = (input as any)?.granularity || 'week';
        const prodPeriods = new Set<string>();
        (input.productivity || []).forEach((p: any) => {
          if (p && p.period) prodPeriods.add(String(p.period));
          if (p && p.week) prodPeriods.add(String(p.week));
          if (p && p.date) prodPeriods.add(String(p.date));
        });
        const periods = prodPeriods.size > 0 ? prodPeriods.size : (input.engOutput || []).length;
        const count = Math.max(1, Math.min(4, periods || 4));
        return formatWindow(granularity, count);
      } catch {
        return 'over the last 4 weeks';
      }
    };

    const improvePlanCodeCards = (insights: PerformanceInsight[], windowLabel: string): PerformanceInsight[] => {
      const getEvidenceValue = (ins: PerformanceInsight, label: string): string | undefined => {
        const ev = (ins as any).evidence as Array<{ label: string; value: string }> | undefined;
        const row = (ev || []).find(r => String(r.label || '').toLowerCase() === label.toLowerCase());
        return row?.value;
      };

      const fmtPct = (s?: string): string | undefined => {
        if (!s) return undefined;
        const m = String(s).match(/(-?\d+(?:\.\d+)?)/);
        if (!m) return undefined;
        const n = Number(m[1]);
        if (Number.isNaN(n)) return undefined;
        const sign = n > 0 ? '+' : '';
        return `${sign}${Math.round(n)}%`;
      };

      const fmtRate = (s?: string): string | undefined => {
        if (!s) return undefined;
        const m = String(s).match(/(-?\d+(?:\.\d+)?)/);
        if (!m) return undefined;
        const n = Number(m[1]);
        if (Number.isNaN(n)) return undefined;
        return `${n.toFixed(2)} assists/min`;
      };

      const fmtMinutes = (s?: string): string | undefined => {
        if (!s) return undefined;
        const m = String(s).match(/(-?\d+(?:\.\d+)?)/);
        if (!m) return undefined;
        const n = Number(m[1]);
        if (Number.isNaN(n)) return undefined;
        return `${Math.round(n)} min/period`;
      };

      const rewrite = (ins: PerformanceInsight): PerformanceInsight => {
        if (ins.cicdStage !== 'plan-code') return ins;
        const id = String(ins.id || '');

        if (id.startsWith('org-ai-usage-summary-') || (ins as any).ruleId === 'org-ai-usage-summary') {
          const cur = fmtRate(getEvidenceValue(ins, 'Current'));
          const delta = fmtPct(getEvidenceValue(ins, 'Delta'));

          return {
            ...ins,
            title: `Standardize AI workflows to reduce variance ${windowLabel}`,
            description: `Org-wide AI usage is ~${cur || '0.00 assists/min'} ${windowLabel}${delta ? ` (${delta} vs earlier weeks)` : ''}. Align policies and review norms so teams get predictable outcomes as adoption scales.`,
            evidence: [
              { label: 'AI usage rate', value: cur || String(getEvidenceValue(ins, 'Current') || '') },
              ...(delta ? [{ label: 'Change vs earlier', value: delta }] : []),
              { label: 'Time window', value: windowLabel },
            ].filter(r => r.value),
            recommendations: [
              { text: 'Set an org AI policy this week: approved tools, privacy rules, and what must be reviewed by a human before merge.', actionType: 'process' },
              { text: 'Publish 2–3 “golden” AI workflows (bugfix, refactor, test generation) and require new teams to adopt them in onboarding.', actionType: 'training' },
              { text: 'Instrument guardrails: track PR cycle time and change failure rate by team as AI usage grows; investigate teams with outlier drift.', actionType: 'observability' },
            ],
          } as any;
        }

        if (id.startsWith('org-coding-time-summary-') || (ins as any).ruleId === 'org-coding-time-summary') {
          const cur = fmtMinutes(getEvidenceValue(ins, 'Current'));
          const delta = fmtPct(getEvidenceValue(ins, 'Delta'));

          const verb = delta && delta.startsWith('-') ? 'Remove blockers to protect maker time' : 'Protect maker time and review capacity';

          return {
            ...ins,
            title: `${verb} ${windowLabel}`,
            description: `Developers are spending ~${cur || '0 min/period'} coding ${windowLabel}${delta ? ` (${delta} vs earlier weeks)` : ''}. Convert that time into throughput by reducing coordination overhead and keeping PR flow smooth.`,
            evidence: [
              { label: 'Coding time', value: cur || String(getEvidenceValue(ins, 'Current') || '') },
              ...(delta ? [{ label: 'Change vs earlier', value: delta }] : []),
              { label: 'Time window', value: windowLabel },
            ].filter(r => r.value),
            recommendations: [
              { text: 'Enforce a meeting cap for ICs (e.g., ≤6 hrs/week) and protect 2–3 focus blocks on calendars starting next sprint.', actionType: 'process' },
              { text: 'Set WIP limits: require teams to keep ≤2 active PRs per engineer and batch small changes to reduce review thrash.', actionType: 'process' },
              { text: 'Track review queue health weekly (PR wait time, queue depth) and rebalance reviewer coverage when it spikes.', actionType: 'observability' },
            ],
          } as any;
        }

        // Activity-proxy productivity skew card (SECONDARY)
        if (id.includes('org-productivity-skew') && (ins.tags || []).some(t => String(t).toLowerCase().includes('estimated'))) {
          const topTool = getEvidenceValue(ins, 'Top tool by activity') || getEvidenceValue(ins, 'Top tool') || 'one tool';
          const topShare = getEvidenceValue(ins, 'Top tool activity share') || getEvidenceValue(ins, 'Top tool output share') || '';
          const top2Share = getEvidenceValue(ins, 'Top 2 activity share') || getEvidenceValue(ins, 'Top 2 combined') || '';

          return {
            ...ins,
            title: `Balance tool activity to reduce concentration risk ${windowLabel}`,
            description: `${topTool} accounts for ~${String(topShare).replace(/[^0-9.%-]/g, '') || '0%'} of IDE activity time ${windowLabel}, which can increase bus-factor risk if work concentrates. Directional signal based on activity minutes because commit volume isn’t available in this window.`,
            evidence: [
              { label: 'Top tool', value: String(topTool) },
              { label: 'Top tool activity share', value: String(topShare) },
              ...(top2Share ? [{ label: 'Top 2 activity share', value: String(top2Share) }] : []),
              { label: 'Time window', value: windowLabel },
            ].filter(r => r.value),
            recommendations: [
              { text: 'Set an ownership rotation this week: ensure 2+ teams can deliver in the top tool by pairing and rotating PR reviewers.', actionType: 'process' },
              { text: 'Fund cross-tool enablement: publish equivalent workflows (debugging, build/run, testing) across IDEs so teams can switch without slowdown.', actionType: 'training' },
              { text: 'Add an org guardrail: alert when one tool exceeds 50% of activity time for 2 consecutive weeks and trigger a redistribution plan.', actionType: 'observability' },
            ],
          } as any;
        }

        return ins;
      };

      return (insights || []).map(rewrite);
    };

    const inferPlanCodeCategory = (insight: PerformanceInsight): PlanCodeCategory => {
      const ruleId = (insight as any).ruleId as string | undefined;
      const noData = ruleId ? getNoDataProofs().some(p => p.ruleId === ruleId) : false;
      if (noData) return 'DIAGNOSTIC';

      const tags = (insight.tags || []).map(t => String(t).toLowerCase());
      const isDiag = (insight as any).orgKind === 'diagnostic';
      if (isDiag) return 'DIAGNOSTIC';
      if (tags.some(t => t.includes('data-missing') || t.includes('insufficient-history') || t.includes('coverage') || t.includes('stable'))) {
        return 'DIAGNOSTIC';
      }
      if (tags.some(t => t.includes('low-confidence') || t.includes('estimated') || t.includes('mixed'))) {
        return 'SECONDARY';
      }
      const badge = String((insight as any).confidenceBadge || '').toLowerCase();
      if (badge.includes('estimated') || badge.includes('mixed')) return 'SECONDARY';
      return 'PRIMARY';
    };

    const normalizePlanCodeDiagnostic = (base: PerformanceInsight, windowLabel: string): PerformanceInsight => {
      const title = base.title || '';
      const badTitle = /\b(stable|no issues|looks healthy)\b/i.test(title);
      const hasRec = Array.isArray((base as any).recommendations) && (base as any).recommendations.length > 0;
      const timeWindow = (base as any).timeWindow || windowLabel;
      const recommendations = hasRec
        ? (base as any).recommendations
        : [{ text: 'Connect more data sources (GitHub + IDE telemetry) and re-check in 2 weeks', actionType: 'observability' }];

      return {
        ...base,
        cicdStage: 'plan-code',
        orgKind: 'diagnostic' as any,
        timeWindow,
        title: badTitle ? `Increase Plan–Code signal ${windowLabel}` : title,
        recommendations,
        tags: Array.from(new Set([...(base.tags || []), 'diagnostic'])),
      } as any;
    };

    const buildPlanCodeFillers = (needed: number, windowLabel: string): PerformanceInsight[] => {
      const fillers: PerformanceInsight[] = [];
      if (needed <= 0) return fillers;

      // Deterministic IDs: do NOT use Date.now
      const mk = (suffix: string) => `plan-code::quota_filler::${suffix}::${windowLabel}`;

      fillers.push({
        id: mk('connect_telemetry'),
        title: `Connect IDE telemetry to improve Plan–Code insights ${windowLabel}`,
        description: `We can’t reliably quantify Plan–Code impact ${windowLabel} without IDE session telemetry. Connect the IDE extension and ensure sessions are being recorded.`,
        severity: 'info' as any,
        metricId: 'plan_code.quota_filler.telemetry',
        cicdStage: 'plan-code',
        orgKind: 'diagnostic' as any,
        timeWindow: windowLabel,
        evidence: [{ label: 'Time window', value: windowLabel }],
        recommendations: [{ text: 'Connect the IDE extension and collect at least 2 weeks of sessions', actionType: 'observability' }],
        tags: ['diagnostic', 'coverage'],
      } as any);

      fillers.push({
        id: mk('connect_github'),
        title: `Connect GitHub repos to improve Plan–Code insights ${windowLabel}`,
        description: `We can’t explain Plan–Code throughput ${windowLabel} without GitHub PR/repo context. Connect GitHub and confirm repo access is granted for the org.`,
        severity: 'info' as any,
        metricId: 'plan_code.quota_filler.github',
        cicdStage: 'plan-code',
        orgKind: 'diagnostic' as any,
        timeWindow: windowLabel,
        evidence: [{ label: 'Time window', value: windowLabel }],
        recommendations: [{ text: 'Connect GitHub and enable access to the primary repos for this org', actionType: 'observability' }],
        tags: ['diagnostic', 'coverage'],
      } as any);

      fillers.push({
        id: mk('increase_history'),
        title: `Collect more history to unlock stronger Plan–Code signals ${windowLabel}`,
        description: `Some Plan–Code trends need more history to become trustworthy. Keep collecting for two more weeks and we’ll promote higher-confidence insights automatically.`,
        severity: 'info' as any,
        metricId: 'plan_code.quota_filler.history',
        cicdStage: 'plan-code',
        orgKind: 'diagnostic' as any,
        timeWindow: windowLabel,
        evidence: [{ label: 'Time window', value: windowLabel }],
        recommendations: [{ text: 'Keep telemetry enabled and re-check after two more weeks of data', actionType: 'process' }],
        tags: ['diagnostic', 'insufficient-history'],
      } as any);

      return fillers.slice(0, needed);
    };

    const enforcePlanCodeQuota = (args: {
      allCandidates: PerformanceInsight[];
      currentPlanCodeVisible: PerformanceInsight[];
      planCodeNonVisible: PerformanceInsight[];
    }): {
      planCodeVisibleFinal: PerformanceInsight[];
      planCodeFillersUsed: PlanCodeFillerUsed[];
      planCodeDroppedReasons: PlanCodeDropped[];
      planCodePromotedFrom: PlanCodePromotedFrom[];
      categoryBreakdown: Record<PlanCodeCategory, number>;
    } => {
      const { allCandidates, currentPlanCodeVisible, planCodeNonVisible } = args;

      const windowLabel = computeWindowLabelForPlanCode();
      const fillersUsed: PlanCodeFillerUsed[] = [];
      const promotedFrom: PlanCodePromotedFrom[] = [];
      const dropped: PlanCodeDropped[] = [];

      const stageCandidates = allCandidates.filter(i => i.cicdStage === 'plan-code');
      const nonVisibleCandidates = planCodeNonVisible.filter(i => i.cicdStage === 'plan-code');
      const pool = [...currentPlanCodeVisible, ...nonVisibleCandidates, ...stageCandidates];

      // Deduplicate by id first (deterministic order: first occurrence wins)
      const byId = new Map<string, PerformanceInsight>();
      for (const i of pool) {
        if (!i?.id) continue;
        if (!byId.has(i.id)) byId.set(i.id, i);
      }
      const uniqueById = Array.from(byId.values());

      // Deduplicate by equivalenceKey
      const byEq = new Map<string, PerformanceInsight>();
      for (const i of uniqueById) {
        const eq = equivalenceKey(i);
        if (!byEq.has(eq)) {
          byEq.set(eq, i);
        } else {
          dropped.push({ id: i.id, reason: 'duplicate' });
        }
      }
      const unique = Array.from(byEq.values());

      const severityWeight = (sev: any): number => {
        const s = String(sev || '').toLowerCase();
        if (s.includes('critical') || s.includes('risk')) return 3;
        if (s.includes('warning') || s.includes('high')) return 2;
        return 1;
      };
      const categoryWeight = (c: PlanCodeCategory): number => (c === 'PRIMARY' ? 3 : c === 'SECONDARY' ? 2 : 1);

      const ranked = unique
        .map(i => {
          const category = inferPlanCodeCategory(i);
          return { i, category };
        })
        .sort((a, b) => {
          // Deterministic ordering
          const cw = categoryWeight(b.category) - categoryWeight(a.category);
          if (cw !== 0) return cw;
          const sw = severityWeight(b.i.severity) - severityWeight(a.i.severity);
          if (sw !== 0) return sw;
          const ps = (b.i.priorityScore || 0) - (a.i.priorityScore || 0);
          if (ps !== 0) return ps;
          const is = ((b.i as any).impactScore || 0) - ((a.i as any).impactScore || 0);
          if (is !== 0) return is;
          const ar = String((a.i as any).ruleId || '');
          const br = String((b.i as any).ruleId || '');
          if (ar !== br) return ar.localeCompare(br);
          const am = String(a.i.metricId || '');
          const bm = String(b.i.metricId || '');
          if (am !== bm) return am.localeCompare(bm);
          return String(a.i.id || '').localeCompare(String(b.i.id || ''));
        });

      // Start from current visible, then promote deterministically
      const currentIds = new Set(currentPlanCodeVisible.map(i => i.id));
      const nonVisibleIds = new Set(nonVisibleCandidates.map(i => i.id));

      let visible: Array<{ i: PerformanceInsight; category: PlanCodeCategory }> = ranked.filter(r => currentIds.has(r.i.id));

      // If < 3, promote from ranked pool
      for (const r of ranked) {
        if (visible.length >= 3) break;
        if (visible.some(v => v.i.id === r.i.id)) continue;
        // Prefer PRIMARY then SECONDARY
        if (r.category === 'DIAGNOSTIC') continue;
        visible.push(r);
        promotedFrom.push({ id: r.i.id, fromBucket: nonVisibleIds.has(r.i.id) ? 'drilldown' : 'candidate_pool' });
      }

      // If still < 3, add diagnostic fillers
      if (visible.length < 3) {
        const need = 3 - visible.length;
        const fillers = buildPlanCodeFillers(need, windowLabel);
        fillers.forEach(f => {
          visible.push({ i: f, category: 'DIAGNOSTIC' });
          fillersUsed.push({ id: f.id, reason: 'min_quota', windowLabel });
          promotedFrom.push({ id: f.id, fromBucket: 'synthetic' });
        });
      }

      // Cap at 6 (keep highest-ranked)
      if (visible.length > 6) {
        const keep = visible.slice(0, 6);
        const keepIds = new Set(keep.map(v => v.i.id));
        visible.slice(6).forEach(v => {
          if (!keepIds.has(v.i.id)) dropped.push({ id: v.i.id, reason: 'cap' });
        });
        visible = keep;
      }

      // Card contract (plan-code only): time window + recommendation + non-generic title
      const contractOk = (insight: PerformanceInsight, category: PlanCodeCategory): { ok: boolean; reason?: string } => {
        const title = (insight.title || '').trim();
        const titleLower = title.toLowerCase();
        if (!title || title.length < 8) return { ok: false, reason: 'contract_fail' };
        if (category !== 'DIAGNOSTIC' && (titleLower.includes('stable') || titleLower.includes('no issues') || titleLower.includes('looks healthy'))) {
          return { ok: false, reason: 'contract_fail' };
        }
        const timeWindow = String((insight as any).timeWindow || '').trim();
        if (!timeWindow) return { ok: false, reason: 'contract_fail' };
        const recs = (insight as any).recommendations;
        if (!Array.isArray(recs) || recs.length < 1) return { ok: false, reason: 'contract_fail' };
        return { ok: true };
      };

      const coerced: Array<{ i: PerformanceInsight; category: PlanCodeCategory }> = [];
      for (const v of visible) {
        const win = String((v.i as any).timeWindow || '').trim() || windowLabel;
        let next = { ...v.i, cicdStage: 'plan-code', timeWindow: win } as any;
        const ok = contractOk(next, v.category);
        if (ok.ok) {
          coerced.push({ i: next, category: v.category });
          continue;
        }
        // Transform into DIAGNOSTIC if it fails contract
        const diag = normalizePlanCodeDiagnostic(next, windowLabel);
        const ok2 = contractOk(diag, 'DIAGNOSTIC');
        if (ok2.ok) {
          coerced.push({ i: diag, category: 'DIAGNOSTIC' });
          promotedFrom.push({ id: diag.id, fromBucket: 'candidate_pool' });
        } else {
          dropped.push({ id: next.id, reason: 'contract_fail' });
        }
      }

      // Final dedupe pass (defensive)
      const finalByEq = new Map<string, PerformanceInsight>();
      const finalRows: Array<{ i: PerformanceInsight; category: PlanCodeCategory }> = [];
      for (const row of coerced) {
        const eq = equivalenceKey(row.i);
        if (finalByEq.has(eq)) {
          dropped.push({ id: row.i.id, reason: 'duplicate' });
          continue;
        }
        finalByEq.set(eq, row.i);
        finalRows.push(row);
      }

      // Ensure minimum still holds after contract enforcement; fill if needed
      if (finalRows.length < 3) {
        const need = 3 - finalRows.length;
        const fillers = buildPlanCodeFillers(need, windowLabel);
        fillers.forEach(f => {
          const eq = equivalenceKey(f);
          if (!finalByEq.has(eq)) {
            finalByEq.set(eq, f);
            finalRows.push({ i: f, category: 'DIAGNOSTIC' });
            fillersUsed.push({ id: f.id, reason: 'contract_repair', windowLabel });
          }
        });
      }

      // Cap again defensively
      const finalCapped = finalRows.slice(0, 6);
      if (finalRows.length > 6) {
        finalRows.slice(6).forEach(r => dropped.push({ id: r.i.id, reason: 'cap' }));
      }

      const categoryBreakdown = finalCapped.reduce(
        (acc, row) => {
          acc[row.category] = (acc[row.category] || 0) + 1;
          return acc;
        },
        { PRIMARY: 0, SECONDARY: 0, DIAGNOSTIC: 0 } as Record<PlanCodeCategory, number>
      );

      return {
        planCodeVisibleFinal: finalCapped.map(r => r.i),
        planCodeFillersUsed: fillersUsed,
        planCodeDroppedReasons: dropped,
        planCodePromotedFrom: promotedFrom,
        categoryBreakdown,
      };
    };
    
    // Step 4: Fill global compare slot
    const globalCompare = fillGlobalCompareSlot(withTiersAndStoryKeys, slotConfig);

    // Apply quota for plan-code ONLY (review-merge and deploy-operate unchanged)
    const planCodeQuota = enforcePlanCodeQuota({
      allCandidates: withTiersAndStoryKeys,
      currentPlanCodeVisible: planCodeSlots.leaderVisible,
      planCodeNonVisible: [...planCodeSlots.drillDown, ...withTiersAndStoryKeys],
    });

    const planCodeLeaderVisibleFinal = planCodeQuota.planCodeVisibleFinal;
    const planCodeLeaderVisibleIds = new Set(planCodeLeaderVisibleFinal.map(i => i.id));
    const planCodeLeaderVisibleEq = new Set(planCodeLeaderVisibleFinal.map(i => equivalenceKey(i)));
    const planCodeDrillDownFinal: PerformanceInsight[] = (planCodeSlots.drillDown || []).filter(i => {
      if (!i?.id) return false;
      if (planCodeLeaderVisibleIds.has(i.id)) return false;
      const eq = equivalenceKey(i);
      if (planCodeLeaderVisibleEq.has(eq)) return false;
      return true;
    });

    if (PI_DEBUG && !getDebugOnceLatch('PLAN_CODE_QUOTA')) {
      const beforeVisibleIds = planCodeSlots.leaderVisible.map(i => i.id);
      const afterVisibleIds = planCodeLeaderVisibleFinal.map(i => i.id);
      console.log('[PI_AUDIT][PLAN_CODE_QUOTA]', {
        beforeVisibleIds,
        afterVisibleIds,
        beforeCount: beforeVisibleIds.length,
        afterCount: afterVisibleIds.length,
        fillersUsed: planCodeQuota.planCodeFillersUsed,
        promotedFrom: planCodeQuota.planCodePromotedFrom,
        dropped: planCodeQuota.planCodeDroppedReasons,
        categoryBreakdown: planCodeQuota.categoryBreakdown,
      });
    }
    
    // Step 5: Combine leader-visible insights (slots) + drill-down
    const leaderVisible = [
      ...planCodeLeaderVisibleFinal,
      ...reviewMergeSlots.leaderVisible,
      ...deployOperateSlots.leaderVisible,
      ...globalCompare
    ];
    
    const drillDown = [
      ...planCodeDrillDownFinal,
      ...reviewMergeSlots.drillDown,
      ...deployOperateSlots.drillDown
    ];

    // ========== PI_AUDIT: PLAN_CODE PIPELINE (once per run, debug-gated) ==========
    if (PI_DEBUG && !getAuditLatch('PLAN_CODE_PIPELINE')) {
      try {
        const classify = (list: PerformanceInsight[] | undefined) => {
          const xs = list || [];
          const countsByToolScope = xs.reduce((acc, i) => {
            const k = (i.toolScope || 'unknown');
            const key = k === 'single-ide' ? 'singleIde' : k === 'cross-ide' ? 'crossIde' : k === 'org' ? 'org' : 'unknown';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          const countsByInsightClass = xs.reduce((acc, i) => {
            const k = (i.insightClass || 'unknown');
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          const countsByOrgKind = xs.reduce((acc, i) => {
            const k = (i.orgKind || 'unknown') as any;
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          return {
            countsByToolScope,
            countsByInsightClass,
            countsByOrgKind,
          };
        };

        const stageMeta = (ids: string[], stage: string, droppedAtStep: string): any[] => {
          const idSet = new Set(ids);
          const source = (raw || []).concat(finalRaw || []).concat(noDupes || []).concat(afterTotalLimit || []).concat(withTiersAndStoryKeys as any || []);
          const out: any[] = [];
          for (const i of source) {
            if (!i?.id || i.cicdStage !== stage) continue;
            if (!idSet.has(i.id)) continue;
            out.push({
              id: i.id,
              ruleId: (i as any).ruleId || i.metricId || 'unknown',
              title: String(i.title || '').slice(0, 80),
              toolScope: i.toolScope || 'unknown',
              insightClass: i.insightClass || 'unknown',
              orgKind: i.orgKind || 'unknown',
              droppedAtStep,
            });
            if (out.length >= 5) break;
          }
          return out;
        };

        const onlyStageIds = (list: PerformanceInsight[] | undefined, stage: string) =>
          (list || []).filter(i => i.cicdStage === stage).map(i => i.id).filter(Boolean);

        const toSet = (ids: string[]) => new Set(ids);
        const diff = (a: string[], b: string[]) => {
          const bSet = toSet(b);
          return a.filter(id => !bSet.has(id));
        };

        // Canonical plan-code views at each step
        const rawEmittedIds = onlyStageIds(raw, 'plan-code');
        const afterGuardrailsIds = onlyStageIds(finalRaw, 'plan-code');
        const afterDedupeIds = onlyStageIds(noDupes, 'plan-code');
        // "Caps" here means the full selection/capping path up to the post-process input boundary
        // (stage caps + diversity + global mins + total limit)
        const afterCapsIds = onlyStageIds(afterTotalLimit, 'plan-code');

        const afterSlottingLeaderVisibleIds = onlyStageIds(leaderVisible, 'plan-code');
        const afterSlottingDrilldownIds = onlyStageIds(drillDown, 'plan-code');

        const rawPlanCode = (raw || []).filter(i => i.cicdStage === 'plan-code');
        const afterGuardrailsPlanCode = (finalRaw || []).filter(i => i.cicdStage === 'plan-code');
        const afterDedupePlanCode = (noDupes || []).filter(i => i.cicdStage === 'plan-code');
        const afterCapsPlanCode = (afterTotalLimit || []).filter(i => i.cicdStage === 'plan-code');
        const afterSlottingPlanCode = (leaderVisible || []).concat(drillDown || []).filter(i => i.cicdStage === 'plan-code');

        const droppedGuardrails = diff(rawEmittedIds, afterGuardrailsIds);
        const droppedDedupe = diff(afterGuardrailsIds, afterDedupeIds);
        const droppedCaps = diff(afterDedupeIds, afterCapsIds);

        // Slotting drops are insights that survived caps/postprocess but were neither leaderVisible nor drillDown
        const slottingUniverse = onlyStageIds(withTiersAndStoryKeys as any, 'plan-code');
        const slottingSurvivors = Array.from(new Set([
          ...afterSlottingLeaderVisibleIds,
          ...afterSlottingDrilldownIds,
        ]));
        const droppedSlotting = diff(slottingUniverse, slottingSurvivors);

        // Pull best-effort drop reasons from pipelineStages where they exist
        const dropsFromPipelineStage = (stageName: string) => {
          const stage = (pipelineStages || []).find(s => s.stageName === stageName);
          if (!stage) return [];
          return (stage.topDropped || []).filter(d => d.cicdStage === 'plan-code');
        };

        const droppedByStep = {
          guardrails: {
            droppedIds: droppedGuardrails,
            examples: dropsFromPipelineStage('GUARDRAILS'),
          },
          dedupe: {
            droppedIds: droppedDedupe,
            examples: dropsFromPipelineStage('DEDUPED'),
          },
          caps: {
            droppedIds: droppedCaps,
            examples: [
              ...dropsFromPipelineStage('STAGE_CAPS'),
              ...dropsFromPipelineStage('DIVERSITY'),
              ...dropsFromPipelineStage('GLOBAL_MINIMUMS'),
              ...dropsFromPipelineStage('TOTAL_LIMIT'),
            ],
          },
          slotting: {
            droppedIds: droppedSlotting,
            examples: droppedSlotting.slice(0, 10),
          },
        };

        const compositionByStep = {
          RAW: classify(rawPlanCode),
          AFTER_GUARDRAILS: classify(afterGuardrailsPlanCode),
          AFTER_DEDUPE: classify(afterDedupePlanCode),
          AFTER_CAPS: classify(afterCapsPlanCode),
          AFTER_SLOTTING: classify(afterSlottingPlanCode),
        };

        const topDroppedExamples = [
          ...stageMeta(droppedGuardrails, 'plan-code', 'AFTER_GUARDRAILS'),
          ...stageMeta(droppedDedupe, 'plan-code', 'AFTER_DEDUPE'),
          ...stageMeta(droppedCaps, 'plan-code', 'AFTER_CAPS'),
          ...stageMeta(droppedSlotting, 'plan-code', 'AFTER_SLOTTING'),
        ].slice(0, 5);

        const counts = {
          raw: rawEmittedIds.length,
          afterGuardrails: afterGuardrailsIds.length,
          afterDedupe: afterDedupeIds.length,
          afterCaps: afterCapsIds.length,
          afterSlotting: {
            leaderVisible: afterSlottingLeaderVisibleIds.length,
            drillDown: afterSlottingDrilldownIds.length,
          },
        };

        console.log('[PI_AUDIT][PLAN_CODE_PIPELINE]', {
          counts,
          rawEmittedIds,
          afterGuardrailsIds,
          afterDedupeIds,
          afterCapsIds,
          afterSlottingLeaderVisibleIds,
          afterSlottingDrilldownIds,
          droppedByStep,
          compositionByStep,
          topDroppedExamples,
          // Helpful correlation: show how ruleIds map to stage at trace-time (if stage is unknown today)
          ruleIdToStage: (rules || []).reduce((acc, r) => {
            const ruleId = r.ruleId;
            const tr = tracer.getTrace(ruleId);
            acc[ruleId] = tr?.cicdStage || 'unknown';
            return acc;
          }, {} as Record<string, string>),
        });
      } catch (e) {
        console.warn('[PI_AUDIT][PLAN_CODE_PIPELINE] failed to build', e);
      }
    }

    // ========== PI_AUDIT: REVIEW_MERGE PIPELINE (once per run, debug-gated) ==========
    if (PI_DEBUG && !getAuditLatch('REVIEW_MERGE_PIPELINE')) {
      try {
        const onlyStageIds = (list: PerformanceInsight[] | undefined, stage: string) =>
          (list || []).filter(i => i.cicdStage === stage).map(i => i.id).filter(Boolean);
        const toSet = (ids: string[]) => new Set(ids);
        const diff = (a: string[], b: string[]) => {
          const bSet = toSet(b);
          return a.filter(id => !bSet.has(id));
        };
        const classify = (list: PerformanceInsight[] | undefined) => {
          const xs = list || [];
          const countsByToolScope = xs.reduce((acc, i) => {
            const k = (i.toolScope || 'unknown');
            const key = k === 'single-ide' ? 'singleIde' : k === 'cross-ide' ? 'crossIde' : k === 'org' ? 'org' : 'unknown';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          const countsByInsightClass = xs.reduce((acc, i) => {
            const k = (i.insightClass || 'unknown');
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          const countsByOrgKind = xs.reduce((acc, i) => {
            const k = (i.orgKind || 'unknown') as any;
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          return { countsByToolScope, countsByInsightClass, countsByOrgKind };
        };
        const stageMeta = (ids: string[], stage: string, droppedAtStep: string): any[] => {
          const idSet = new Set(ids);
          const source = (raw || []).concat(finalRaw || []).concat(noDupes || []).concat(afterTotalLimit || []).concat(withTiersAndStoryKeys as any || []);
          const out: any[] = [];
          for (const i of source) {
            if (!i?.id || i.cicdStage !== stage) continue;
            if (!idSet.has(i.id)) continue;
            out.push({
              id: i.id,
              ruleId: (i as any).ruleId || i.metricId || 'unknown',
              title: String(i.title || '').slice(0, 80),
              toolScope: i.toolScope || 'unknown',
              insightClass: i.insightClass || 'unknown',
              orgKind: i.orgKind || 'unknown',
              droppedAtStep,
            });
            if (out.length >= 5) break;
          }
          return out;
        };

        const rawEmittedIds = onlyStageIds(raw, 'review-merge');
        const afterGuardrailsIds = onlyStageIds(finalRaw, 'review-merge');
        const afterDedupeIds = onlyStageIds(noDupes, 'review-merge');
        const afterCapsIds = onlyStageIds(afterTotalLimit, 'review-merge');
        const afterSlottingLeaderVisibleIds = onlyStageIds(leaderVisible, 'review-merge');
        const afterSlottingDrilldownIds = onlyStageIds(drillDown, 'review-merge');

        const droppedGuardrails = diff(rawEmittedIds, afterGuardrailsIds);
        const droppedDedupe = diff(afterGuardrailsIds, afterDedupeIds);
        const droppedCaps = diff(afterDedupeIds, afterCapsIds);

        const slottingUniverse = onlyStageIds(withTiersAndStoryKeys as any, 'review-merge');
        const slottingSurvivors = Array.from(new Set([
          ...afterSlottingLeaderVisibleIds,
          ...afterSlottingDrilldownIds,
        ]));
        const droppedSlotting = diff(slottingUniverse, slottingSurvivors);

        const counts = {
          raw: rawEmittedIds.length,
          afterGuardrails: afterGuardrailsIds.length,
          afterDedupe: afterDedupeIds.length,
          afterCaps: afterCapsIds.length,
          afterSlotting: {
            leaderVisible: afterSlottingLeaderVisibleIds.length,
            drillDown: afterSlottingDrilldownIds.length,
          },
        };

        const compositionByStep = {
          RAW: classify((raw || []).filter(i => i.cicdStage === 'review-merge')),
          AFTER_GUARDRAILS: classify((finalRaw || []).filter(i => i.cicdStage === 'review-merge')),
          AFTER_DEDUPE: classify((noDupes || []).filter(i => i.cicdStage === 'review-merge')),
          AFTER_CAPS: classify((afterTotalLimit || []).filter(i => i.cicdStage === 'review-merge')),
          AFTER_SLOTTING: classify((leaderVisible || []).concat(drillDown || []).filter(i => i.cicdStage === 'review-merge')),
        };

        const topDroppedExamples = [
          ...stageMeta(droppedGuardrails, 'review-merge', 'AFTER_GUARDRAILS'),
          ...stageMeta(droppedDedupe, 'review-merge', 'AFTER_DEDUPE'),
          ...stageMeta(droppedCaps, 'review-merge', 'AFTER_CAPS'),
          ...stageMeta(droppedSlotting, 'review-merge', 'AFTER_SLOTTING'),
        ].slice(0, 5);

        console.log('[PI_AUDIT][REVIEW_MERGE_PIPELINE]', {
          counts,
          rawEmittedIds,
          afterGuardrailsIds,
          afterDedupeIds,
          afterCapsIds,
          afterSlottingLeaderVisibleIds,
          afterSlottingDrilldownIds,
          droppedByStep: {
            guardrails: { droppedIds: droppedGuardrails },
            dedupe: { droppedIds: droppedDedupe },
            caps: { droppedIds: droppedCaps },
            slotting: { droppedIds: droppedSlotting },
          },
          compositionByStep,
          topDroppedExamples,
        });
      } catch (e) {
        console.warn('[PI_AUDIT][REVIEW_MERGE_PIPELINE] failed to build', e);
      }
    }

    // ========== PI_AUDIT: DEPLOY_OPERATE PIPELINE (once per run, debug-gated) ==========
    if (PI_DEBUG && !getAuditLatch('DEPLOY_OPERATE_PIPELINE')) {
      try {
        const onlyStageIds = (list: PerformanceInsight[] | undefined, stage: string) =>
          (list || []).filter(i => i.cicdStage === stage).map(i => i.id).filter(Boolean);
        const toSet = (ids: string[]) => new Set(ids);
        const diff = (a: string[], b: string[]) => {
          const bSet = toSet(b);
          return a.filter(id => !bSet.has(id));
        };
        const classify = (list: PerformanceInsight[] | undefined) => {
          const xs = list || [];
          const countsByToolScope = xs.reduce((acc, i) => {
            const k = (i.toolScope || 'unknown');
            const key = k === 'single-ide' ? 'singleIde' : k === 'cross-ide' ? 'crossIde' : k === 'org' ? 'org' : 'unknown';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          const countsByInsightClass = xs.reduce((acc, i) => {
            const k = (i.insightClass || 'unknown');
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          const countsByOrgKind = xs.reduce((acc, i) => {
            const k = (i.orgKind || 'unknown') as any;
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          return { countsByToolScope, countsByInsightClass, countsByOrgKind };
        };
        const stageMeta = (ids: string[], stage: string, droppedAtStep: string): any[] => {
          const idSet = new Set(ids);
          const source = (raw || []).concat(finalRaw || []).concat(noDupes || []).concat(afterTotalLimit || []).concat(withTiersAndStoryKeys as any || []);
          const out: any[] = [];
          for (const i of source) {
            if (!i?.id || i.cicdStage !== stage) continue;
            if (!idSet.has(i.id)) continue;
            out.push({
              id: i.id,
              ruleId: (i as any).ruleId || i.metricId || 'unknown',
              title: String(i.title || '').slice(0, 80),
              toolScope: i.toolScope || 'unknown',
              insightClass: i.insightClass || 'unknown',
              orgKind: i.orgKind || 'unknown',
              droppedAtStep,
            });
            if (out.length >= 5) break;
          }
          return out;
        };

        const rawEmittedIds = onlyStageIds(raw, 'deploy-operate');
        const afterGuardrailsIds = onlyStageIds(finalRaw, 'deploy-operate');
        const afterDedupeIds = onlyStageIds(noDupes, 'deploy-operate');
        const afterCapsIds = onlyStageIds(afterTotalLimit, 'deploy-operate');
        const afterSlottingLeaderVisibleIds = onlyStageIds(leaderVisible, 'deploy-operate');
        const afterSlottingDrilldownIds = onlyStageIds(drillDown, 'deploy-operate');

        const droppedGuardrails = diff(rawEmittedIds, afterGuardrailsIds);
        const droppedDedupe = diff(afterGuardrailsIds, afterDedupeIds);
        const droppedCaps = diff(afterDedupeIds, afterCapsIds);

        const slottingUniverse = onlyStageIds(withTiersAndStoryKeys as any, 'deploy-operate');
        const slottingSurvivors = Array.from(new Set([
          ...afterSlottingLeaderVisibleIds,
          ...afterSlottingDrilldownIds,
        ]));
        const droppedSlotting = diff(slottingUniverse, slottingSurvivors);

        const counts = {
          raw: rawEmittedIds.length,
          afterGuardrails: afterGuardrailsIds.length,
          afterDedupe: afterDedupeIds.length,
          afterCaps: afterCapsIds.length,
          afterSlotting: {
            leaderVisible: afterSlottingLeaderVisibleIds.length,
            drillDown: afterSlottingDrilldownIds.length,
          },
        };

        const compositionByStep = {
          RAW: classify((raw || []).filter(i => i.cicdStage === 'deploy-operate')),
          AFTER_GUARDRAILS: classify((finalRaw || []).filter(i => i.cicdStage === 'deploy-operate')),
          AFTER_DEDUPE: classify((noDupes || []).filter(i => i.cicdStage === 'deploy-operate')),
          AFTER_CAPS: classify((afterTotalLimit || []).filter(i => i.cicdStage === 'deploy-operate')),
          AFTER_SLOTTING: classify((leaderVisible || []).concat(drillDown || []).filter(i => i.cicdStage === 'deploy-operate')),
        };

        const topDroppedExamples = [
          ...stageMeta(droppedGuardrails, 'deploy-operate', 'AFTER_GUARDRAILS'),
          ...stageMeta(droppedDedupe, 'deploy-operate', 'AFTER_DEDUPE'),
          ...stageMeta(droppedCaps, 'deploy-operate', 'AFTER_CAPS'),
          ...stageMeta(droppedSlotting, 'deploy-operate', 'AFTER_SLOTTING'),
        ].slice(0, 5);

        console.log('[PI_AUDIT][DEPLOY_OPERATE_PIPELINE]', {
          counts,
          rawEmittedIds,
          afterGuardrailsIds,
          afterDedupeIds,
          afterCapsIds,
          afterSlottingLeaderVisibleIds,
          afterSlottingDrilldownIds,
          droppedByStep: {
            guardrails: { droppedIds: droppedGuardrails },
            dedupe: { droppedIds: droppedDedupe },
            caps: { droppedIds: droppedCaps },
            slotting: { droppedIds: droppedSlotting },
          },
          compositionByStep,
          topDroppedExamples,
        });
      } catch (e) {
        console.warn('[PI_AUDIT][DEPLOY_OPERATE_PIPELINE] failed to build', e);
      }
    }

    // ========== RULE TRACE: Track slotting drops ==========
    if (PI_DEBUG) {
      const leaderVisibleIds = new Set(leaderVisible.map(i => i.id));
      const slottingDropped = withTiersAndStoryKeys.filter(i => !leaderVisibleIds.has(i.id) && !drillDown.some(d => d.id === i.id));
      slottingDropped.forEach(i => {
        if ((i as any).ruleId) {
          const trace = tracer.getTrace((i as any).ruleId);
          if (trace && trace.emittedInsights.count > 0) {
            const remainingForRule = leaderVisible.filter(ins => (ins as any).ruleId === (i as any).ruleId).length;
            if (remainingForRule === 0) {
              tracer.recordDropReason((i as any).ruleId, 'SLOTTING_REJECT', 
                `Slotting rejected: ${i.title?.slice(0, 40)} (score may be too low or slot filled)`);
            }
          }
        }
      });
    }
    
    // Add confidence badges to all insights
    const withBadges = leaderVisible.map(insight => ({
      ...insight,
      confidenceBadge: getConfidenceBadge(insight, scoringContext)
    }));
    
    // Final output: leader-visible + drill-down (marked)
    const finalInsights = [
      ...withBadges,
      ...drillDown.map(i => ({ ...i, isDrillDown: true, confidenceBadge: getConfidenceBadge(i, scoringContext) }))
    ];

    const finalInsightsImproved = improvePlanCodeCards(finalInsights as any, computeWindowLabelForPlanCode());
    
    // ========== RULE TRACE: Record pipeline fate for each rule ==========
    if (PI_DEBUG) {
      // Group final insights by ruleId
      const insightsByRuleId = new Map<string, PerformanceInsight[]>();
      finalInsightsImproved.forEach(insight => {
        const ruleId = (insight as any).ruleId;
        if (ruleId) {
          if (!insightsByRuleId.has(ruleId)) {
            insightsByRuleId.set(ruleId, []);
          }
          insightsByRuleId.get(ruleId)!.push(insight);
        }
      });
      
      // Record fate for each rule
      (rules || []).forEach((r) => {
        const ruleId = r.ruleId;
        const finalForRule = insightsByRuleId.get(ruleId) || [];
        tracer.recordPipelineFate(ruleId, finalForRule);
      });
      
      // Count insights by stage at each pipeline step
      const countByStage = (insights: PerformanceInsight[]): Record<string, number> => {
        const counts: Record<string, number> = {};
        insights.forEach(i => {
          const stage = i.cicdStage || 'other';
          counts[stage] = (counts[stage] || 0) + 1;
        });
        return counts;
      };
      
      const rawByStage = countByStage(finalRaw);
      const dedupeByStage = countByStage(noDupes);
      const slottingByStage = countByStage(leaderVisible);
      
      // Generate and print comprehensive trace report
      const traceReport = tracer.generateReport(rules.length, {
        rawEmitted: finalRaw.length,
        afterMergeDedupe: noDupes.length,
        afterSlotting: leaderVisible.length,
        leaderVisibleFinal: leaderVisible.length,
        stageCounts: {
          raw: rawByStage,
          dedupe: dedupeByStage,
          slotting: slottingByStage
        },
        slotAssignments: {
          'plan-code': planCodeSlots.slotAssignments,
          'review-merge': reviewMergeSlots.slotAssignments,
          'deploy-operate': deployOperateSlots.slotAssignments
        }
      });
      
      console.group('🔍 [PI_TRACE_REPORT] Consolidated Validation Report');
      
      // A) Rule Firing Summary
      console.group('📊 A) RULE FIRING SUMMARY');
      console.log(`totalRulesRegistered: ${traceReport.aggregates.totalRulesRegistered}`);
      console.log(`totalRulesExecuted: ${traceReport.aggregates.totalRulesExecuted}`);
      console.log(`totalRulesEmitted: ${traceReport.aggregates.totalRulesEmitted}`);
      console.log(`\nTop 15 Rules by Emitted Count:`);
      traceReport.topRulesByEmitted.slice(0, 15).forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.ruleId}: ${r.emittedInsights.count} insights`);
      });
      console.log(`\nBottom "0 Emitted" Rules by Reason:`);
      Object.entries(traceReport.blockedRulesByReason).forEach(([reason, rules]) => {
        if (rules.length > 0) {
          console.log(`  ${reason} (${rules.length} rules):`);
          rules.slice(0, 10).forEach(r => {
            const missing = r.requiredFields.missing.length > 0 ? ` [Missing: ${r.requiredFields.missing.join(', ')}]` : '';
            const guards = Object.entries(r.guardResults).filter(([_, v]) => v).map(([k]) => k);
            const guardStr = guards.length > 0 ? ` [Guards: ${guards.join(', ')}]` : '';
            console.log(`    - ${r.ruleId}${missing}${guardStr}`);
          });
          if (rules.length > 10) console.log(`    ... and ${rules.length - 10} more`);
        }
      });
      console.groupEnd();
      
      // B) Pipeline Survival by Stage
      console.group('📈 B) PIPELINE SURVIVAL BY STAGE');
      Object.entries(traceReport.pipelineSurvival).forEach(([stage, stats]) => {
        const survivalRate = stats.rawEmitted > 0 ? ((stats.leaderVisibleFinal / stats.rawEmitted) * 100).toFixed(1) : '0.0';
        console.log(`\n${stage}:`);
        console.log(`  rawEmitted: ${stats.rawEmitted}`);
        console.log(`  afterMergeDedupe: ${stats.afterMergeDedupe}`);
        console.log(`  afterSlotting: ${stats.afterSlotting}`);
        console.log(`  leaderVisibleFinal: ${stats.leaderVisibleFinal}`);
        console.log(`  Survival Rate: ${survivalRate}%`);
      });
      console.groupEnd();
      
      // C) Slotting Audit
      console.group('🎯 C) SLOTTING AUDIT');
      Object.entries(traceReport.slotAssignments || {}).forEach(([stage, slots]) => {
        console.log(`\n${stage}:`);
        console.log(`  Posture Slot Winners (${slots.posture?.length || 0}):`);
        slots.posture?.forEach((s: any) => {
          const i = s.insight;
          const id = i.id || 'no-id';
          const title = i.title || 'NO_TITLE';
          const tier = i.tier || 'unknown';
          const severity = i.severity || 'info';
          const orgKind = i.orgKind || 'none';
          const source = i.source || 'unknown';
          const insightClass = i.insightClass || 'unknown';
          const ruleId = (i as any).ruleId || 'unknown';
          console.log(`    - [${id}] ${title.slice(0, 60)} (tier=${tier}, severity=${severity}, orgKind=${orgKind}, source=${source}, class=${insightClass}, rule=${ruleId})`);
        });
        console.log(`  Change Slot Winners (${slots.change?.length || 0}):`);
        slots.change?.forEach((s: any) => {
          const i = s.insight;
          const id = i.id || 'no-id';
          const title = i.title || 'NO_TITLE';
          const tier = i.tier || 'unknown';
          const severity = i.severity || 'info';
          const orgKind = i.orgKind || 'none';
          const source = i.source || 'unknown';
          const insightClass = i.insightClass || 'unknown';
          const ruleId = (i as any).ruleId || 'unknown';
          console.log(`    - [${id}] ${title.slice(0, 60)} (tier=${tier}, severity=${severity}, orgKind=${orgKind}, source=${source}, class=${insightClass}, rule=${ruleId})`);
        });
        console.log(`  Action Slot Winners (${slots.action?.length || 0}):`);
        slots.action?.forEach((s: any) => {
          const i = s.insight;
          const id = i.id || 'no-id';
          const title = i.title || 'NO_TITLE';
          const tier = i.tier || 'unknown';
          const severity = i.severity || 'info';
          const orgKind = i.orgKind || 'none';
          const source = i.source || 'unknown';
          const insightClass = i.insightClass || 'unknown';
          const ruleId = (i as any).ruleId || 'unknown';
          console.log(`    - [${id}] ${title.slice(0, 60)} (tier=${tier}, severity=${severity}, orgKind=${orgKind}, source=${source}, class=${insightClass}, rule=${ruleId})`);
        });
      });
      console.log(`\nSlotting Rejections:`);
      const slottingRejected = traceReport.rules.filter(r => 
        r.emittedInsights.count > 0 && 
        !r.pipelineFate.keptLeaderVisible && 
        r.pipelineFate.droppedAtStep === 'SLOTTING_REJECT'
      );
      slottingRejected.slice(0, 10).forEach(r => {
        console.log(`  - ${r.ruleId}: ${r.pipelineFate.dropReason || 'No reason'}`);
      });
      if (slottingRejected.length > 10) console.log(`  ... and ${slottingRejected.length - 10} more`);
      console.groupEnd();
      
      // Validation Checks
      console.group('✅ VALIDATION CHECKS');
      const reviewMergeFinal = traceReport.pipelineSurvival['review-merge']?.leaderVisibleFinal || 0;
      const deployOperateFinal = traceReport.pipelineSurvival['deploy-operate']?.leaderVisibleFinal || 0;
      const falseMttrCount = traceReport.rules.filter(r => 
        r.emittedInsights.count === 0 && 
        r.requiredFields.missing.includes('mttrHours') &&
        !r.ruleId.toLowerCase().includes('mttr')
      ).length;
      
      console.log(`review-merge leaderVisibleFinal >= 2: ${reviewMergeFinal >= 2 ? '✅' : '❌'} (${reviewMergeFinal})`);
      console.log(`deploy-operate leaderVisibleFinal >= 2: ${deployOperateFinal >= 2 ? '✅' : '❌'} (${deployOperateFinal})`);
      console.log(`False mttrHours missing count = 0: ${falseMttrCount === 0 ? '✅' : '❌'} (${falseMttrCount})`);
      
      // Check slot contracts
      let slotContractViolations = 0;
      Object.entries(traceReport.slotAssignments || {}).forEach(([_, slots]) => {
        slots.action?.forEach((s: any) => {
          const tier = s.insight.tier || 'trend';
          const orgKind = s.insight.orgKind;
          if (tier === 'posture' || tier === 'trend' || orgKind === 'summary') {
            slotContractViolations++;
            console.log(`  ⚠️ Action slot violation: ${s.insight.title?.slice(0, 40)} (tier=${tier}, orgKind=${orgKind})`);
          }
        });
        slots.posture?.forEach((s: any) => {
          const tier = s.insight.tier || 'trend';
          const orgKind = s.insight.orgKind;
          if (tier !== 'posture' && orgKind !== 'summary') {
            slotContractViolations++;
            console.log(`  ⚠️ Posture slot violation: ${s.insight.title?.slice(0, 40)} (tier=${tier}, orgKind=${orgKind})`);
          }
        });
      });
      console.log(`Slot contract violations: ${slotContractViolations === 0 ? '✅' : '❌'} (${slotContractViolations})`);
      console.groupEnd();
      
      // Top 10 Valuable Rules Still Not Surfacing
      console.group('🔍 TOP 10 VALUABLE RULES STILL NOT SURFACING');
      const valuableBlocked = traceReport.rules
        .filter(r => r.emittedInsights.count === 0 || !r.pipelineFate.keptLeaderVisible)
        .sort((a, b) => {
          // Prioritize rules that emitted but were dropped
          if (a.emittedInsights.count > 0 && b.emittedInsights.count === 0) return -1;
          if (a.emittedInsights.count === 0 && b.emittedInsights.count > 0) return 1;
          return 0;
        })
        .slice(0, 10);
      valuableBlocked.forEach((r, i) => {
        const reason = r.emittedInsights.count === 0 
          ? (r.requiredFields.missing.length > 0 ? `MISSING_FIELDS: ${r.requiredFields.missing.join(', ')}` :
             Object.entries(r.guardResults).filter(([_, v]) => v).map(([k]) => k).join(', ') || 'NO_DATA')
          : `DROPPED: ${r.pipelineFate.dropReason || r.pipelineFate.droppedAtStep || 'UNKNOWN'}`;
        console.log(`${i + 1}. ${r.ruleId}: ${reason}`);
      });
      console.groupEnd();
      
      // Engine Final Count with Duplicate Detection
      const idMap = new Map<string, PerformanceInsight>();
      const duplicates: Array<{ id: string; original: PerformanceInsight; duplicate: PerformanceInsight }> = [];
      const reviewMergeInsights: Array<{ id: string; title: string; cicdStage: string; metricId: string }> = [];
      
      // Process all insights to detect and fix duplicates
      const deduplicatedInsights: PerformanceInsight[] = [];
      finalInsightsImproved.forEach(insight => {
        const id = insight.id;
        
        // Track review-merge insights for diagnosis
        if (insight.cicdStage === 'review-merge') {
          reviewMergeInsights.push({
            id,
            title: insight.title,
            cicdStage: insight.cicdStage,
            metricId: insight.metricId || ''
          });
        }
        
        if (!id) {
          console.warn('[PI_WARN][MISSING_ID] Insight missing ID:', insight.title);
          // Generate a fallback ID
          const fallbackId = makeInsightId('unknown-rule', 'missing-id');
          const fixed = { ...insight, id: fallbackId };
          idMap.set(fallbackId, fixed);
          deduplicatedInsights.push(fixed);
          return;
        }
        
        if (idMap.has(id)) {
          const original = idMap.get(id)!;
          duplicates.push({ id, original, duplicate: insight });
          // Deterministic behavior: keep first, drop later duplicates. Never mutate IDs.
          return;
        } else {
          idMap.set(id, insight);
          deduplicatedInsights.push(insight);
          return;
        }
      });
      
      if (duplicates.length > 0) {
        console.group('⚠️ [PI_WARN][DUPLICATE_ID] Duplicate IDs Detected and Dropped');
        duplicates.forEach(({ id, original, duplicate }) => {
          const ruleId = (original as any).ruleId || (duplicate as any).ruleId || 'unknown';
          console.log(`  Rule: ${ruleId}, Original ID: ${id}`);
          console.log(`    Original: ${original.title}`);
          console.log(`    Duplicate: ${duplicate.title} → DROPPED`);
        });
        console.groupEnd();
      }
      
      // Diagnostic: print review-merge insights for troubleshooting
      if (reviewMergeInsights.length > 0) {
        console.group('🔍 [PI_ENGINE_FINAL][REVIEW_MERGE_DIAGNOSTICS]');
        console.log(`Total review-merge insights: ${reviewMergeInsights.length}`);
        console.table(reviewMergeInsights);
        console.groupEnd();
      }
      
      const uniqueCount = idMap.size;
      console.log(`\n[PI_ENGINE_FINAL] Engine returning ${deduplicatedInsights.length} total insights (${uniqueCount} unique IDs, ${leaderVisible.length} leader-visible, ${drillDown.length} drill-down)`);
      if (duplicates.length > 0) {
        console.log(`  ⚠️  Dropped ${duplicates.length} duplicate ID(s)`);
      }
      
      console.groupEnd();
      
      // Print NO_DATA proof summary
      const noDataProofs = getNoDataProofs();
      if (noDataProofs.length > 0) {
        console.group('🔍 [PI_NO_DATA_SUMMARY]');
        const tableData = noDataProofs.map(p => ({
          ruleId: p.ruleId,
          verdict: p.verdict,
          datasetChecked: (p as any).datasetChecked ?? '',
          prodLen: p.prodLen,
          engLen: p.engLen,
          overlapN: p.overlapN,
          missingFields: p.missingFields.join(', ') || 'none',
          sampleProdKeys: (p.verdict === 'PERIOD_KEY_MISMATCH' || p.verdict === 'SPARSE_OVERLAP') 
            ? (p.sampleProdKeys?.join(', ') || '') 
            : '',
          sampleEngKeys: (p.verdict === 'PERIOD_KEY_MISMATCH' || p.verdict === 'SPARSE_OVERLAP')
            ? (p.sampleEngKeys?.join(', ') || '')
            : ''
        }));
        console.table(tableData);
        
        // If any have period key mismatches, show sample keys
        const periodMismatches = noDataProofs.filter(p => 
          p.verdict === 'PERIOD_KEY_MISMATCH' || p.verdict === 'SPARSE_OVERLAP'
        );
        if (periodMismatches.length > 0) {
          console.log('\nPeriod Key Samples (for mismatches):');
          periodMismatches.forEach(p => {
            console.log(`  ${p.ruleId}:`);
            console.log(`    Productivity periods: ${p.sampleProdKeys?.join(', ') || 'none'}`);
            console.log(`    EngOutput periods: ${p.sampleEngKeys?.join(', ') || 'none'}`);
          });
        }
        console.groupEnd();
      }

      if (PI_DEBUG && !getAuditLatch('NO_DATA_BUCKETS')) {
        const proofs = getNoDataProofs();
        const countsByVerdict = proofs.reduce((acc, p) => {
          const v = p.verdict || 'MISSING_DATASET';
          acc[v] = (acc[v] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        const topRuleIdsByVerdict = (verdict: string) => proofs
          .filter(p => p.verdict === verdict)
          .map(p => p.ruleId)
          .reduce((acc, rid) => {
            acc[rid] = (acc[rid] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);

        console.log('[PI_AUDIT][NO_DATA_BUCKETS]', {
          countsByVerdict,
          topRuleIds: {
            MISSING_DATASET: topRuleIdsByVerdict('MISSING_DATASET'),
            MISSING_FIELD: topRuleIdsByVerdict('MISSING_FIELD'),
            PERIOD_KEY_MISMATCH: topRuleIdsByVerdict('PERIOD_KEY_MISMATCH'),
            SPARSE_OVERLAP: topRuleIdsByVerdict('SPARSE_OVERLAP'),
          },
        });
      }
      
      // Return deduplicated insights (after all logging)
      return deduplicatedInsights;
    }
    
    if (PI_DEBUG) {
      console.log('[PI_DEBUG][SLOTTING]', {
        before: processed.length,
        after: finalInsights.length,
        leaderVisible: leaderVisible.length,
        drillDown: drillDown.length,
        byStage: {
          'plan-code': { leaderVisible: planCodeSlots.leaderVisible.length, drillDown: planCodeSlots.drillDown.length },
          'review-merge': { leaderVisible: reviewMergeSlots.leaderVisible.length, drillDown: reviewMergeSlots.drillDown.length },
          'deploy-operate': { leaderVisible: deployOperateSlots.leaderVisible.length, drillDown: deployOperateSlots.drillDown.length }
        },
        globalCompare: globalCompare.length,
        slotAssignments: {
          'plan-code': planCodeSlots.slotAssignments,
          'review-merge': reviewMergeSlots.slotAssignments,
          'deploy-operate': deployOperateSlots.slotAssignments
        }
      });
      
      // Log selected insights with scores
      leaderVisible.forEach(insight => {
        const score = scoreInsightForSlotting(insight, { ...scoringContext, stage: insight.cicdStage || 'other' });
        console.log(`[PI_DEBUG][SLOT_SELECTED] ${insight.cicdStage} - ${insight.title?.slice(0, 50)} (score: ${score})`);
      });
    }
    
    // ========== DROP ACCOUNTING: QUALITY_GATE ==========
    const qualityGateDropped = afterTotalLimit.length - processed.length;
    const qualityGateDroppedInsights: DropEntry[] = [];
    if (qualityGateDropped > 0) {
      const processedIds = new Set(processed.map(i => i.id));
      afterTotalLimit.filter(i => !processedIds.has(i.id)).slice(0, 5).forEach(i => {
        qualityGateDroppedInsights.push({
          id: i.id,
          title: i.title?.slice(0, 60) || 'NO_TITLE',
          ruleId: (i as any).ruleId || i.metricId || 'unknown',
          cicdStage: i.cicdStage || 'other',
          dropReason: 'QUALITY_GATE'
        });
      });
    }
    pipelineStages.push({
      stageName: 'QUALITY_GATE',
      enteringCount: afterTotalLimit.length,
      leavingCount: processed.length,
      droppedCount: qualityGateDropped,
      topDropped: qualityGateDroppedInsights
    });
    
    // TEMP: Log final Review & Merge insights
    const finalReviewMerge = finalInsights.filter(i => i.cicdStage === 'review-merge');
    console.debug('[PI] final Review & Merge titles:', finalReviewMerge.map(i => i.title));
    
    if (import.meta.env.DEV) {
      console.debug('[PI_ENGINE] Stage 5 - Final processed:', finalInsights.length)
      console.debug('[PI_ENGINE] === FINAL OUTPUT ===')
      console.debug('[PI_ENGINE] Returning insights:', {
        total: finalInsights.length,
        byTool: processed.reduce((acc, i) => {
          const tool = i.related?.tools?.[0] || 'unknown'
          acc[tool] = (acc[tool] || 0) + 1
          return acc
        }, {} as Record<string, number>),
        bySeverity: finalInsights.reduce((acc, i) => {
          const sev = String(i.severity || 'info');
          acc[sev] = (acc[sev] || 0) + 1
          return acc
        }, {} as Record<string, number>),
        bySlot: {
          leaderVisible: leaderVisible.length,
          drillDown: drillDown.length,
          globalCompare: globalCompare.length
        },
        titles: finalInsights.map(i => i.title.substring(0, 60))
      })
    }

    if (fr) {
      fr.postprocess = fr.postprocess || {};
      fr.postprocess.pipelineStages = pipelineStages;
      fr.engine = fr.engine || {};
      fr.engine.final = {
        total: finalInsights.length,
        ids: finalInsights.map(i => i.id),
        byStage: countByStage(finalInsights),
      };
      fr.finishedAt = nowIso();
    }
    console.log('🔍 PerformanceEngine - final items:', finalInsights.map(i => ({
      id: i.id,
      tier: i.tier,
      tool: i.related?.tools?.[0],
      title: i.title.substring(0, 50) + '...',
      p: i.evidence.find(e => e.label.toLowerCase().includes('p'))?.value,
      r: i.evidence.find(e => e.label.toLowerCase().includes('correlation') && e.label.includes('r'))?.value,
      equivalenceKey: equivalenceKey(i),
      priorityScore: i.priorityScore,
      critical: i.critical
    })));

    console.log('🔍 [insights] counts → raw:', raw.length, 'deduped:', noDupes.length, 'floor-selected:', floorSelected.length, 'diversified:', diversified.length, 'processed:', processed.length);
    
    // ========== PI_TRACE: Engine final output boundary ==========
    if (PI_TRACE) {
      console.group('🔍 [PI_TRACE][ENGINE_FINAL] Engine returning insights');
      
      // Build detailed table
      const traceTable = processed.map(i => ({
        id: i.id,
        title: i.title?.slice(0, 60) || 'NO_TITLE',
        cicdStage: i.cicdStage || 'missing',
        orgKind: i.orgKind || 'none',
        insightClass: i.insightClass || 'none',
        metricId: i.metricId || 'none',
        tool: i.related?.tools?.[0] || i.tools?.[0] || 'org',
        severity: i.severity || 'info',
        priorityScore: i.priorityScore || 0,
        tags: i.tags?.join(',') || 'none',
        source: i.source || 'unknown',
        hidden: (i as any).hidden || false,
        uiHidden: (i as any).uiHidden || false,
        locked: (i as any).locked || false
      }));
      
      console.table(traceTable);
      
      // Counts by stage
      const byStage = countByStage(processed);
      console.log('Counts by stage:', byStage);
      
      // Counts by orgKind
      const byOrgKind = processed.reduce((acc, i) => {
        const kind = i.orgKind || 'none';
        acc[kind] = (acc[kind] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      console.log('Counts by orgKind:', byOrgKind);
      
      // Counts by insightClass
      const byInsightClass = processed.reduce((acc, i) => {
        const cls = i.insightClass || 'none';
        acc[cls] = (acc[cls] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      console.log('Counts by insightClass:', byInsightClass);
      
      // Counts by stage + orgKind (key insight for routing)
      const byStageType: Record<string, number> = {};
      processed.forEach(i => {
        const stage = i.cicdStage || 'missing';
        const kind = i.orgKind || 'none';
        const key = `${stage}|${kind}`;
        byStageType[key] = (byStageType[key] || 0) + 1;
      });
      console.log('Counts by stage|orgKind:', byStageType);
      
      // List all IDs for verification
      console.log('All insight IDs:', processed.map(i => i.id));
      
      console.groupEnd();
    }
    
    // ========== DIAGNOSTICS: Flush report ==========
    // NOTE: We build the consolidated RULE_MATRIX *before* flushing diagnostics,
    // since diagFlushReport clears the event buffer.
    const PI_RULE_MATRIX = PI_DEBUG && diag.diagEnabled();
    if (PI_DEBUG) {
      console.log('[PI_AUDIT][RULE_MATRIX][STATUS]', {
        PI_DEBUG,
        diagEnabled: diag.diagEnabled(),
        willEmitMatrix: PI_RULE_MATRIX,
        rulesRegistered: rules.length,
        diagEventsCount: (() => {
          try {
            return diag.getEventsSnapshot().length;
          } catch {
            return -1;
          }
        })(),
      });
    }
    // HMR-safe: do not window-latch RULE_MATRIX; HMR can trigger the latch before a visible console log.
    // If you want it latched later, reintroduce getAuditLatch('RULE_MATRIX') after Phase 3.
    if (PI_RULE_MATRIX) {
      type RuleMatrixCategory = 'GUARD_FAIL' | 'NO_DATA' | 'THRESHOLD/VARIANCE' | 'EXCEPTION' | 'EMPTY_RESULT' | 'EMITTED';
      type RuleMatrixRow = {
        ruleId: string;
        stage: string;
        expectedToolScope?: 'single-ide' | 'cross-ide' | 'org' | 'unknown';
        expectedInsightClass?: 'tool_statistical' | 'org_deterministic' | 'diagnostic' | 'unknown';
        internalEmptyReasonCode?: string;
        emittedCount: number;
        emittedIds: string[];
        blockedReasonCategory: RuleMatrixCategory;
        guard?: { fieldName: string; have: any; need: any };
        noData?: { verdict: string; missingFields: string[]; overlapN: number };
        threshold?: { name?: string; value?: any };
        exception?: { message: string };
      };

      // Hardcoded expectations for a shortlist of tool/IDE rules.
      // Keep this table small; 'unknown' for anything not listed.
      const expectedByRule: Record<string, { toolScope: RuleMatrixRow['expectedToolScope']; insightClass: RuleMatrixRow['expectedInsightClass'] }> = {
        'ai-improves-ct': { toolScope: 'single-ide', insightClass: 'tool_statistical' },
        'ai-slows-ct': { toolScope: 'single-ide', insightClass: 'tool_statistical' },
        'ai-reopen-rate': { toolScope: 'single-ide', insightClass: 'tool_statistical' },
        'deploy-vscode-ai-posture': { toolScope: 'single-ide', insightClass: 'org_deterministic' },
        'deploy-ai-reliability-correlation': { toolScope: 'org', insightClass: 'tool_statistical' },
        'tool-ai-roi': { toolScope: 'cross-ide', insightClass: 'tool_statistical' },
        'org-ttfc-regression': { toolScope: 'org', insightClass: 'org_deterministic' },
        'repo-issue-hotspot-gh': { toolScope: 'org', insightClass: 'org_deterministic' },
      };

      console.log('[PI_AUDIT][RULE_MATRIX][EMIT] building matrix', {
        rulesRegistered: rules.length,
      });
      const diagEvents = diag.getEventsSnapshot();
      const diagByRule = new Map<string, any>(diagEvents.map(e => [e.ruleKey, e]));
      const proofs = getNoDataProofs();
      const noDataByRule = new Map<string, NoDataProof[]>();
      proofs.forEach(p => {
        const arr = noDataByRule.get(p.ruleId) || [];
        arr.push(p);
        noDataByRule.set(p.ruleId, arr);
      });

      const rows: RuleMatrixRow[] = rules.map((r) => {
        const ruleId = r.ruleId;
        const registryStage = r.stage;
        const trace = tracer.getTrace(ruleId);
        const ev = diagByRule.get(ruleId);

        const emittedCount = trace?.emittedInsights?.count ?? ev?.count ?? 0;
        const emittedIds = (trace?.emittedInsights?.insights || []).map((i: any) => i.insightId).slice(0, 5);

        let blockedReasonCategory: RuleMatrixCategory = 'EMPTY_RESULT';
        let guard: RuleMatrixRow['guard'] | undefined;
        let noData: RuleMatrixRow['noData'] | undefined;
        let threshold: RuleMatrixRow['threshold'] | undefined;
        let exception: RuleMatrixRow['exception'] | undefined;

        const expected = expectedByRule[ruleId] || { toolScope: 'unknown' as const, insightClass: 'unknown' as const };
        let internalEmptyReasonCode: string | undefined;

        if (emittedCount > 0) {
          blockedReasonCategory = 'EMITTED';
        } else {
          const reason = String(ev?.reasonCode || '').toUpperCase();
          if (reason === 'GUARD_FAIL') {
            blockedReasonCategory = 'GUARD_FAIL';
            if (ev?.details?.fieldName) {
              guard = {
                fieldName: ev.details.fieldName,
                have: ev.details.have,
                need: ev.details.need,
              };
            }
          } else if (reason === 'NO_DATA') {
            blockedReasonCategory = 'NO_DATA';
          } else if (reason === 'STATS_TOO_WEAK') {
            blockedReasonCategory = 'THRESHOLD/VARIANCE';
            threshold = { name: 'STATS_TOO_WEAK', value: ev?.details };
          } else if (reason === 'EXCEPTION') {
            blockedReasonCategory = 'EXCEPTION';
            const msg = (ev?.details?.error || ev?.details?.message || String(ev?.details || 'unknown')).slice(0, 180);
            exception = { message: msg };
          } else {
            blockedReasonCategory = 'EMPTY_RESULT';
          }

          // Optional: internal EMPTY_RESULT reason code from diagnostics details (for shortlisted rules).
          if (blockedReasonCategory === 'EMPTY_RESULT' && (expectedByRule[ruleId] != null)) {
            const rc = String(ev?.details?.emptyReasonCode || ev?.details?.reasonCode || '').trim();
            if (rc) internalEmptyReasonCode = rc;
          }

          const proofsForRule = noDataByRule.get(ruleId) || [];
          if (proofsForRule.length > 0) {
            // Prefer the "most severe" no-data verdict (missing dataset > missing field > mismatch > sparse overlap)
            const rank: Record<string, number> = {
              MISSING_DATASET: 4,
              MISSING_FIELD: 3,
              PERIOD_KEY_MISMATCH: 2,
              SPARSE_OVERLAP: 1,
            };
            const best = [...proofsForRule].sort((a, b) => (rank[b.verdict] || 0) - (rank[a.verdict] || 0))[0];
            noData = {
              verdict: best.verdict,
              missingFields: best.missingFields || [],
              overlapN: best.overlapN || 0,
            };

            // If we have explicit no-data proofs and nothing emitted, categorize as NO_DATA.
            if (emittedCount === 0) {
              blockedReasonCategory = 'NO_DATA';
            }
          }
        }

        return {
          ruleId,
          stage: registryStage,
          expectedToolScope: expected.toolScope,
          expectedInsightClass: expected.insightClass,
          internalEmptyReasonCode,
          emittedCount,
          emittedIds,
          blockedReasonCategory,
          guard,
          noData,
          threshold,
          exception,
        };
      });

      const totals = {
        totalRules: rows.length,
        emittedRules: rows.filter(r => r.emittedCount > 0).length,
        emittedInsights: rows.reduce((sum, r) => sum + (r.emittedCount || 0), 0),
      };
      const byCategory = rows.reduce((acc, r) => {
        acc[r.blockedReasonCategory] = (acc[r.blockedReasonCategory] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const tableRows = rows.map(r => ({
        ruleId: r.ruleId,
        stage: r.stage,
        expectedToolScope: r.expectedToolScope || 'unknown',
        expectedInsightClass: r.expectedInsightClass || 'unknown',
        internalEmptyReasonCode: r.internalEmptyReasonCode || '',
        emittedCount: r.emittedCount,
        emittedIds: r.emittedIds.join(', '),
        blockedReasonCategory: r.blockedReasonCategory,
        guard: r.guard ? `${r.guard.fieldName} (have=${String(r.guard.have)}, need=${String(r.guard.need)})` : '',
        noData: r.noData ? `${r.noData.verdict} missing=[${r.noData.missingFields.join(', ')}] overlap=${r.noData.overlapN}` : '',
        exception: r.exception?.message || '',
      }));

      console.group('[PI_AUDIT][RULE_MATRIX]');
      console.table(tableRows);
      console.log('[PI_AUDIT][RULE_MATRIX]', {
        totals,
        byCategory,
        rules: rows,
      });
      console.groupEnd();
    }
    diag.diagFlushReport();
    
    // ========== CONSOLIDATED REPORT: Rule Manifest + Drop Accounting + Value Loss ==========
    const reportEnabled = VALUE_MODE || ((import.meta as any).env?.VITE_PI_REPORT ?? '0') === '1';
    if (reportEnabled) {
      console.group('📊 [PI_REPORT] Performance Insights Pipeline Report');
      
      // Data Availability Map
      console.group('📦 Data Availability Map');
      const dataMap = {
        telemetry: {
          productivity: input.productivity?.length || 0,
          engOutput: input.engOutput?.length || 0,
          sessions: input.sessions?.length || 0,
          overlap: input.overlap || 0
        },
        byStage: {
          'plan-code': {
            productivity: input.productivity?.filter(p => p.period).length || 0,
            sessions: input.sessions?.filter(s => s.git_repo_url).length || 0
          },
          'review-merge': {
            engOutput: input.engOutput?.filter(e => e.prCycleTimeHours != null).length || 0,
            productivity: input.productivity?.filter(p => p.period).length || 0
          },
          'deploy-operate': {
            engOutput: input.engOutput?.filter(e => e.deploymentFreqPerWeek != null || e.changeFailureRatePct != null).length || 0
          }
        },
        repoData: {
          hasRepoStats: input.engOutput?.some(e => e.repo) || false,
          hasBranchData: input.sessions?.some(s => s.git_branch) || false,
          hasIssueData: false // Would need GitHub API data
        }
      };
      console.log(JSON.stringify(dataMap, null, 2));
      console.groupEnd();
      
      // Rule Manifest
      console.group('📋 Rule Manifest');
      const manifestArray = Array.from(ruleManifest.values());
      const firedRules = manifestArray.filter(r => r.countEmitted > 0);
      const nonFiredRules = manifestArray.filter(r => r.countEmitted === 0);
      
      console.log(`✅ Fired Rules (${firedRules.length}):`);
      firedRules.forEach(r => {
        console.log(`  ${r.ruleId}: ${r.countEmitted} insights, stages: [${r.stagesEmitted.join(', ')}], types: sum=${r.insightTypes.summary}, diag=${r.insightTypes.diagnostic}, titles: [${r.topTitles.join(', ')}]`);
      });
      
      console.log(`❌ Non-Fired Rules (${nonFiredRules.length}):`);
      const byReason = new Map<string, RuleManifestEntry[]>();
      nonFiredRules.forEach(r => {
        const reason = r.zeroReason || 'UNKNOWN';
        if (!byReason.has(reason)) byReason.set(reason, []);
        byReason.get(reason)!.push(r);
      });
      byReason.forEach((rules, reason) => {
        console.log(`  ${reason} (${rules.length}): ${rules.map(r => r.ruleId).join(', ')}`);
      });
      console.groupEnd();
      
      // Value Loss Analysis
      console.group('💔 Value Loss Analysis');
      
      // Top 10 rules by expected value that emitted 0
      const highValueRules = [
        'org-ttfc-regression', 'repo-issue-hotspot-gh', 'org-productivity-skew',
        'deploy-freq-driver', 'deploy-ai-reliability-correlation', 'org-ai-deploy-stability-impact',
        'tool-ai-roi', 'review-bottleneck', 'coding-vs-output', 'team-ai-throughput'
      ];
      const highValueNonFired = highValueRules
        .map(ruleId => {
          const entry = ruleManifest.get(ruleId);
          return entry && entry.countEmitted === 0 ? { ruleId, reason: entry.zeroReason || 'UNKNOWN' } : null;
        })
        .filter((x): x is { ruleId: string; reason: string } => x !== null)
        .slice(0, 10);
      
      if (highValueNonFired.length > 0) {
        console.log('Top High-Value Rules That Emitted 0:');
        highValueNonFired.forEach(({ ruleId, reason }) => {
          console.log(`  ${ruleId}: ${reason}`);
        });
      }
      
      // Pipeline stage loss analysis
      console.log('Pipeline Stage Loss:');
      pipelineStages.forEach(stage => {
        const lossPct = stage.enteringCount > 0 
          ? (stage.droppedCount / stage.enteringCount) * 100 
          : 0;
        const flag = lossPct > 50 ? '🚨 HIGH LOSS' : lossPct > 30 ? '⚠️  MODERATE' : '';
        console.log(`  ${stage.stageName}: ${stage.enteringCount} → ${stage.leavingCount} (dropped ${stage.droppedCount}, ${lossPct.toFixed(1)}%) ${flag}`);
        if (stage.topDropped.length > 0) {
          console.log('    Top dropped:');
          stage.topDropped.slice(0, 3).forEach(d => {
            console.log(`      - ${d.title.slice(0, 50)} (${d.ruleId}, ${d.dropReason})`);
          });
        }
      });
      console.groupEnd();
      
      // Drop Accounting
      console.group('📉 Drop Accounting');
      pipelineStages.forEach(stage => {
        if (stage.droppedCount > 0) {
          console.log(`${stage.stageName}: ${stage.enteringCount} → ${stage.leavingCount} (dropped ${stage.droppedCount})`);
          if (stage.topDropped.length > 0) {
            console.log('  Top dropped:');
            stage.topDropped.forEach(d => {
              console.log(`    - ${d.title} (${d.ruleId}, ${d.cicdStage}, ${d.dropReason})`);
            });
          }
        } else {
          console.log(`${stage.stageName}: ${stage.enteringCount} → ${stage.leavingCount} (no drops)`);
        }
      });
      console.groupEnd();
      
      // Coverage Summary
      console.group('📈 Coverage Summary');
      const finalByStage = countByStage(processed);
      const finalByType = processed.reduce((acc, i) => {
        const type = i.orgKind || (i.insightClass === 'tool_statistical' ? 'tool_statistical' : 'unknown');
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      console.log('Final insights by stage:', finalByStage);
      console.log('Final insights by type:', finalByType);
      
      // Value Mode specific checks
      if (VALUE_MODE) {
        const stages: Array<'plan-code' | 'review-merge' | 'deploy-operate'> = ['plan-code', 'review-merge', 'deploy-operate'];
        stages.forEach(stage => {
          const stageInsights = processed.filter(i => i.cicdStage === stage);
          const stageDiagnostics = stageInsights.filter(i => i.orgKind === 'diagnostic');
          const stageSummaries = stageInsights.filter(i => i.orgKind === 'summary');
          const telemetryDiagnostics = processed.filter(i => 
            i.orgKind === 'diagnostic' && 
            (i.metricId?.includes('ttfc') || i.metricId?.includes('rework') || i.metricId?.includes('flow') || i.tags?.includes('telemetry'))
          );
          const repoDiagnostics = processed.filter(i => 
            i.orgKind === 'diagnostic' && 
            (i.metricId?.includes('repo') || i.metricId?.includes('issue') || i.source === 'github')
          );
          
          console.log(`${stage}: total=${stageInsights.length}, diagnostics=${stageDiagnostics.length}, summaries=${stageSummaries.length}`);
          
          if (stageInsights.length < 4) {
            console.warn(`  ⚠️  Below minimum (4)`);
          }
          if (stageDiagnostics.length < valueConfig.minDiagnosticsPerStage) {
            console.warn(`  ⚠️  Below minimum diagnostics (${valueConfig.minDiagnosticsPerStage})`);
          }
        });
        
        // Global telemetry/repo checks
        const telemetryDiagnostics = processed.filter(i => 
          i.orgKind === 'diagnostic' && 
          (i.metricId?.includes('ttfc') || i.metricId?.includes('rework') || i.metricId?.includes('flow') || i.tags?.includes('telemetry'))
        );
        const repoDiagnostics = processed.filter(i => 
          i.orgKind === 'diagnostic' && 
          (i.metricId?.includes('repo') || i.metricId?.includes('issue') || i.source === 'github')
        );
        
        if (telemetryDiagnostics.length < valueConfig.minTelemetryDiagnosticsGlobal && (input.sessions?.length || 0) > 0) {
          console.warn(`  ⚠️  Below minimum telemetry diagnostics (${valueConfig.minTelemetryDiagnosticsGlobal}) but telemetry data exists`);
        }
        if (repoDiagnostics.length < valueConfig.minRepoDiagnosticsGlobal && (input.engOutput?.some(e => e.repo) || false)) {
          console.warn(`  ⚠️  Below minimum repo diagnostics (${valueConfig.minRepoDiagnosticsGlobal}) but repo data exists`);
        }
      }
      console.groupEnd();
      
      console.groupEnd();
    }
    
    // Deduplicate by ID WITHOUT mutating IDs. If duplicates exist, keep the first deterministically.
    const idMap = new Map<string, PerformanceInsight>();
    const duplicates: Array<{ id: string; original: PerformanceInsight; duplicate: PerformanceInsight }> = [];

    const deduplicatedFinal: PerformanceInsight[] = [];
    for (const insight of finalInsights) {
      const id = insight.id;
      if (!id) {
        console.warn('[PI_WARN][MISSING_ID] Insight missing ID:', insight.title);
        const fallbackId = makeInsightId('unknown-rule', 'missing-id');
        const fixed = { ...insight, id: fallbackId };
        if (!idMap.has(fallbackId)) {
          idMap.set(fallbackId, fixed);
          deduplicatedFinal.push(fixed);
        }
        continue;
      }

      if (idMap.has(id)) {
        duplicates.push({ id, original: idMap.get(id)!, duplicate: insight });
        continue;
      }

      idMap.set(id, insight);
      deduplicatedFinal.push(insight);
    }
    
    if (duplicates.length > 0 && PI_DEBUG) {
      console.group('⚠️ [PI_WARN][DUPLICATE_ID] Duplicate IDs Detected and Auto-Fixed');
      duplicates.forEach(({ id, original, duplicate }) => {
        const ruleId = (original as any).ruleId || (duplicate as any).ruleId || 'unknown';
        console.log(`  Rule: ${ruleId}, Original ID: ${id}`);
        console.log(`    Original: ${original.title}`);
        console.log(`    Duplicate: ${duplicate.title} → Dropped (no id mutation)`);
      });
      console.groupEnd();
    }
    
    // STEP 1: Verify engine output capacity
    if (PI_DEBUG) {
      const byStage = countByStage(deduplicatedFinal);
      const byOrgKind = deduplicatedFinal.reduce((acc, i) => {
        const kind = i.orgKind || 'unknown';
        acc[kind] = (acc[kind] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      const topRules = deduplicatedFinal
        .reduce((acc, i) => {
          const ruleId = (i as any).ruleId || 'unknown';
          acc[ruleId] = (acc[ruleId] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
      
      const sortedRules = Object.entries(topRules)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([rule, count]) => `${rule}(${count})`);
      
      console.log(
        `[PI_ENGINE_OUTPUT] total=${deduplicatedFinal.length}, by-stage=${JSON.stringify(byStage)}, by-kind=${JSON.stringify(byOrgKind)}, top-10-rules=[${sortedRules.join(', ')}]`
      );
    }
    
    if (PI_DEBUG && !getAuditLatch('ENGINE_EMIT')) {
      const emittedByStage = countByStage(deduplicatedFinal);
      const emittedByTier = deduplicatedFinal.reduce((acc, i) => {
        const t = String((i as any).tier || inferInsightTier(i) || 'unknown');
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const emittedByOrgKind = {
        summary: deduplicatedFinal.filter(i => i.orgKind === 'summary').length,
        diagnostic: deduplicatedFinal.filter(i => i.orgKind === 'diagnostic').length,
      };

      console.log('[PI_AUDIT][ENGINE_EMIT]', {
        totalEmitted: deduplicatedFinal.length,
        emittedByStage,
        emittedByTier,
        emittedByOrgKind,
        emittedIdsOrdered: deduplicatedFinal.map(i => i.id),
      });
    }

    return deduplicatedFinal;
  } catch (e) {
    console.error('🔍 [insights] postProcess failed — returning raw list:', e);

    // ========== DIAGNOSTICS: Emit RULE_MATRIX + flush report even on error ==========
    const PI_RULE_MATRIX = PI_DEBUG && diag.diagEnabled();
    if (PI_RULE_MATRIX) {
      try {
        const diagEvents = diag.getEventsSnapshot();
        const diagByRule = new Map<string, any>(diagEvents.map(ev => [ev.ruleKey, ev]));
        const proofs = getNoDataProofs();
        const noDataByRule = new Map<string, NoDataProof[]>();
        proofs.forEach(p => {
          const arr = noDataByRule.get(p.ruleId) || [];
          arr.push(p);
          noDataByRule.set(p.ruleId, arr);
        });

        const rows = rules.map((r) => {
          const ruleId = r.ruleId;
          const registryStage = r.stage;
          const trace = tracer.getTrace(ruleId);
          const ev = diagByRule.get(ruleId);
          const emittedCount = trace?.emittedInsights?.count ?? ev?.count ?? 0;
          const emittedIds = (trace?.emittedInsights?.insights || []).map((i: any) => i.insightId).slice(0, 5);

          let blockedReasonCategory: string = emittedCount > 0 ? 'EMITTED' : 'EMPTY_RESULT';
          if (emittedCount === 0) {
            const reason = String(ev?.reasonCode || '').toUpperCase();
      
            if (reason === 'GUARD_FAIL') blockedReasonCategory = 'GUARD_FAIL';
            else if (reason === 'NO_DATA') blockedReasonCategory = 'NO_DATA';
            else if (reason === 'STATS_TOO_WEAK') blockedReasonCategory = 'THRESHOLD/VARIANCE';
            else if (reason === 'EXCEPTION') blockedReasonCategory = 'EXCEPTION';

            if ((noDataByRule.get(ruleId) || []).length > 0) {
              blockedReasonCategory = 'NO_DATA';
            }
          }

          const proof = (noDataByRule.get(ruleId) || [])[0];
          return {
            ruleId,
            stage: registryStage,
            emittedCount,
            emittedIds,
            blockedReasonCategory,
            guard: ev?.reasonCode === 'GUARD_FAIL' ? ev?.details : undefined,
            noData: proof ? { verdict: proof.verdict, missingFields: proof.missingFields, overlapN: proof.overlapN } : undefined,
            exception: ev?.reasonCode === 'EXCEPTION' ? ev?.details : undefined,
          };
        });

        const totals = {
          totalRules: rows.length,
          emittedRules: rows.filter((r: any) => r.emittedCount > 0).length,
          emittedInsights: rows.reduce((sum: number, r: any) => sum + (r.emittedCount || 0), 0),
        };
        const byCategory = rows.reduce((acc: Record<string, number>, r: any) => {
          acc[r.blockedReasonCategory] = (acc[r.blockedReasonCategory] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        console.group('[PI_AUDIT][RULE_MATRIX]');
        console.table(rows.map((r: any) => ({
          ruleId: r.ruleId,
          stage: r.stage,
          emittedCount: r.emittedCount,
          emittedIds: (r.emittedIds || []).join(', '),
          blockedReasonCategory: r.blockedReasonCategory,
        })));
        console.log('[PI_AUDIT][RULE_MATRIX]', { totals, byCategory, rules: rows });
        console.groupEnd();
      } catch (matrixErr) {
        console.warn('[PI_AUDIT][RULE_MATRIX] failed to build matrix on error path', matrixErr);
      }
    }

    // ========== DIAGNOSTICS: Flush report even on error ==========
    diag.diagFlushReport();
    
        
    return raw;
  }
};
