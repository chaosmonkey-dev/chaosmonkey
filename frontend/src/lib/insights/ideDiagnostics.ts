/**
 * IDE Diagnostic Cards Builder
 *
 * Generates derived insights for IDE-level diagnostics in Plan & Code section.
 * Uses existing ToolProductivityPoint data (same as Productivity tab).
 *
 * Additive only - does not modify existing PI rules or thresholds.
 */

import type { ToolProductivityPoint, PerformanceInsight, InsightEvidence, InsightRecommendation } from './types'
import type { IDEMetrics, IDEContext, InsightCandidate } from './types';
import { getToolLabel } from './labels';
import { formatRate, formatPercentage } from './utils/numberFormatting';
import { normalizeToolId } from './providers'

/**
 * Aggregated metrics per IDE across the time window
 */
interface IDEMetrics {
  tool: string
  aiAssists: number
  codingMinutes: number
  commits: number
  sessionMinutes: number
  periods: number
  aiPerCodingMin: number
  commitsPerSession: number  // Weighted average
  codingMinutesShare: number
  hasTelemetry: boolean  // true if any point has source in {live, hybrid}
  dataSource: 'real' | 'mixed' | 'sim' | 'unknown'
  // For WoW comparison (if >= 2 periods)
  codingMinutesValues: number[]
  commitsPerSessionValues: number[]
  sessionMinutesValues: number[]
}

/**
 * Candidate insight from a detector
 */
interface CandidateInsight {
  tool: string
  kind: 'good' | 'bad'
  detector: string
  title: string
  description: string
  evidence: InsightEvidence[]
  recommendation: InsightRecommendation
  severity: PerformanceInsight['severity']
  metricId: string
  // For selection (largest delta wins)
  delta?: number
  priority?: number
}

/**
 * Options for building IDE diagnostics
 */
export interface IdeDiagnosticsOptions {
  /** Minimum periods required for certain detectors */
  minPeriodsForVolatility?: number
  /** Coefficient of variation threshold for volatility detector */
  volatilityCVThreshold?: number
}

/**
 * Build IDE diagnostic insights from productivity points
 * 
 * @param prodPoints - Merged productivity points by (period, tool)
 * @param opts - Optional configuration
 * @returns Array of PerformanceInsight (max 6 total, max 2 per IDE)
 */
export function buildIdeDiagnostics(
  prodPoints: ToolProductivityPoint[],
  opts: IdeDiagnosticsOptions = {}
): PerformanceInsight[] {
  try {
    const minPeriodsForVolatility = opts.minPeriodsForVolatility ?? 4
    const volatilityCVThreshold = opts.volatilityCVThreshold ?? 0.6

    if (!Array.isArray(prodPoints) || prodPoints.length === 0) {
      return []
    }

    // Group points by tool
    const byTool = new Map<string, ToolProductivityPoint[]>()
    for (const p of prodPoints) {
      const normalized = normalizeToolId(p.tool || 'unknown')
      // Skip unknown and copilot (not part of IDE diagnostics)
      if (normalized === 'unknown' || normalized === 'copilot') continue
      const tool = normalized as 'vscode' | 'cursor' | 'windsurf'
      const arr = byTool.get(tool) || []
      arr.push(p)
      byTool.set(tool, arr)
    }

    if (byTool.size === 0) {
      return []
    }

    // Calculate org-level totals for shares and medians
    const allCodingMinutes = prodPoints.reduce((sum, p) => sum + (p.codingMinutes || 0), 0)
    const allAiAssists = prodPoints.reduce((sum, p) => sum + (p.aiAssists || 0), 0)
    const allCodingMinutesTotal = allCodingMinutes
    const orgMedianAiPerMin = computeOrgMedianAiPerMin(Array.from(byTool.values()))

    // Aggregate metrics per IDE
    const ideMetrics = new Map<string, IDEMetrics>()
    for (const [tool, points] of byTool.entries()) {
      const aiAssists = points.reduce((sum, p) => sum + (p.aiAssists || 0), 0)
      const codingMinutes = points.reduce((sum, p) => sum + (p.codingMinutes || 0), 0)
      const commits = points.reduce((sum, p) => sum + (p.commits || 0), 0)
      const sessionMinutes = points.reduce((sum, p) => sum + (p.sessionMinutes || 0), 0)

      const hasTelemetry = points.some(p => {
        const src = (p.source || '').toLowerCase()
        return src === 'live' || src === 'hybrid'
      })

      const telemetryPoints = points.filter(p => {
        const src = (p.source || '').toLowerCase()
        return src === 'live' || src === 'hybrid'
      }).length

      const dataSource: IDEMetrics['dataSource'] = 
        telemetryPoints === 0 ? 'sim' :
        telemetryPoints === points.length ? 'real' :
        'mixed'

      // Calculate commits per session (simple average of period values)
      // Note: commits field in ToolProductivityPoint is already commits_per_session
      const commitsPerSession = points.length > 0
        ? points.reduce((sum, p) => sum + (p.commits || 0), 0) / points.length
        : 0

      ideMetrics.set(tool, {
        tool,
        aiAssists,
        codingMinutes,
        commits,
        sessionMinutes,
        periods: points.length,
        aiPerCodingMin: codingMinutes > 0 ? aiAssists / codingMinutes : 0,
        commitsPerSession,
        codingMinutesShare: allCodingMinutesTotal > 0 ? codingMinutes / allCodingMinutesTotal : 0,
        hasTelemetry,
        dataSource,
        codingMinutesValues: points.map(p => p.codingMinutes || 0),
        commitsPerSessionValues: points.map(p => p.commits || 0),
        sessionMinutesValues: points.map(p => p.sessionMinutes || 0),
      })
    }

    // Compute org medians for comparison
    const orgMedianCommitsPerSession = computeOrgMedian(
      Array.from(ideMetrics.values()).map(m => m.commitsPerSession)
    )
    const orgMedianSessionMinutes = computeOrgMedian(
      Array.from(ideMetrics.values()).map(m => {
        const avg = m.sessionMinutesValues.length > 0
          ? m.sessionMinutesValues.reduce((a, b) => a + b, 0) / m.sessionMinutesValues.length
          : 0
        return avg
      })
    )

    // Filter to IDEs with telemetry presence (or if only one IDE, allow it even without telemetry to ensure we show something)
    const ideMetricsWithTelemetry = Array.from(ideMetrics.values())
      .filter(m => m.hasTelemetry || ideMetrics.size === 1)  // Allow single IDE even without telemetry
      .sort((a, b) => b.codingMinutesShare - a.codingMinutesShare)  // Sort by share desc

    if (ideMetricsWithTelemetry.length === 0) {
      return []  // No IDEs available, don't show diagnostics
    }

    // Take top 3 IDEs by coding minutes share (or all if < 3)
    const topIDEs = ideMetricsWithTelemetry.slice(0, 3)

    // Run detectors for each IDE
    const allCandidates: CandidateInsight[] = []
    for (const metrics of topIDEs) {
      const candidates = runDetectors(metrics, {
        orgMedianAiPerMin,
        orgMedianCommitsPerSession,
        orgMedianSessionMinutes,
        minPeriodsForVolatility,
        volatilityCVThreshold,
      })
      allCandidates.push(...candidates)
    }

    // Select best 2 per IDE (1 good, 1 bad)
    const selected = selectBestInsights(allCandidates, topIDEs.map(m => m.tool))

    // Convert to PerformanceInsight format
    const insights: PerformanceInsight[] = selected.map((candidate, idx) => ({
      id: `ide-diagnostic-${candidate.tool}-${candidate.detector}-${idx}`,
      title: candidate.title,
      description: candidate.description,
      severity: candidate.severity,
      insightClass: 'org_deterministic' as const,
      orgKind: 'diagnostic' as const,
      cicdStage: 'plan-code' as const,
      toolScope: 'single-ide' as const,
      source: 'productivity' as const,
      metricId: candidate.metricId,
      tags: ['ide-diagnostic', candidate.tool, candidate.detector],
      evidence: candidate.evidence,
      recommendations: [candidate.recommendation],
      related: {
        tools: [candidate.tool],
      },
      dataSource: ideMetrics.get(candidate.tool)?.dataSource || 'unknown',
      summaryEligible: false,
      ruleLabel: getMetricLabel(candidate.metricId),
    }))

    // Cap at 6 total
    return insights.slice(0, 6)
  } catch (error) {
    console.warn('[IDE_DIAGNOSTICS] Error building diagnostics (failing closed):', error)
    return []  // Fail closed - don't break existing PI
  }
}

/**
 * Run all detectors and return candidate insights
 */
function runDetectors(
  metrics: IDEMetrics,
  context: {
    orgMedianAiPerMin: number
    orgMedianCommitsPerSession: number
    orgMedianSessionMinutes: number
    minPeriodsForVolatility: number
    volatilityCVThreshold: number
  }
): CandidateInsight[] {
  const candidates: CandidateInsight[] = []

  // Detector 1: AI Efficiency Leader/Laggard
  if (metrics.codingMinutes > 0) {
    const delta = context.orgMedianAiPerMin > 0
      ? ((metrics.aiPerCodingMin - context.orgMedianAiPerMin) / context.orgMedianAiPerMin) * 100
      : 0

    if (metrics.aiPerCodingMin >= context.orgMedianAiPerMin * 1.2) {
      // GOOD: Leads on AI efficiency
      candidates.push({
        tool: metrics.tool,
        kind: 'good',
        detector: 'ai-efficiency-leader',
        title: `${getToolLabel(metrics.tool)} leads in AI efficiency (+${Math.round(delta)}% vs org median)`,
        description: `${getToolLabel(metrics.tool)} achieves ${metrics.aiPerCodingMin.toFixed(1)} AI assists/minute (vs org median ${context.orgMedianAiPerMin.toFixed(1)}). This ${delta >= 20 ? 'strong' : 'solid'} performance indicates effective AI adoption and workflow integration.`,
        evidence: [
          { label: 'AI assists/min', value: formatRate(metrics.aiPerCodingMin, '/minute', 1) },
          { label: 'Org median', value: formatRate(context.orgMedianAiPerMin, '/minute', 1) },
          { label: 'Coding minutes share', value: formatPercentage(metrics.codingMinutesShare, true, 0) },
          { label: 'Data', value: metrics.dataSource === 'real' ? 'LIVE' : metrics.dataSource.toUpperCase() },
        ],
        recommendation: {
          text: 'Standardize workflows driving this (templates/settings) and re-check assists/min next week.',
          actionType: 'process',
        },
        severity: 'highlight',
        metricId: 'ide.ai_efficiency',
        delta: delta,
        priority: delta,
      })
    } else if (metrics.aiPerCodingMin <= context.orgMedianAiPerMin * 0.8 && context.orgMedianAiPerMin > 0) {
      // BAD: Trails on AI efficiency
      candidates.push({
        tool: metrics.tool,
        kind: 'bad',
        detector: 'ai-efficiency-laggard',
        title: `${getToolLabel(metrics.tool)} trails in AI efficiency (${Math.round(Math.abs(delta))}% below org median)`,
        description: `${getToolLabel(metrics.tool)} achieves ${metrics.aiPerCodingMin.toFixed(1)} AI assists/minute (vs org median ${context.orgMedianAiPerMin.toFixed(1)}). This ${Math.abs(delta) >= 30 ? 'significant' : 'notable'} gap suggests lower AI adoption or workflow integration issues.`,
        evidence: [
          { label: 'AI assists/min', value: formatRate(metrics.aiPerCodingMin, '/minute', 1) },
          { label: 'Org median', value: formatRate(context.orgMedianAiPerMin, '/minute', 1) },
          { label: 'Coding minutes share', value: formatPercentage(metrics.codingMinutesShare, true, 0) },
          { label: 'Data', value: metrics.dataSource === 'real' ? 'LIVE' : metrics.dataSource.toUpperCase() },
        ],
        recommendation: {
          text: 'Compare configs/models/prompts; re-check assists/min next week.',
          actionType: 'process',
        },
        severity: 'warning',
        metricId: 'ide.ai_efficiency',
        delta: -Math.abs(delta),
        priority: -Math.abs(delta),
      })
    }
  }

  // Detector 2: Output Conversion Gap
  if (metrics.codingMinutes > 0 && metrics.aiPerCodingMin >= context.orgMedianAiPerMin * 1.2) {
    // High AI efficiency - check if output (commits) is keeping up
    const commitsVsMedian = context.orgMedianCommitsPerSession > 0
      ? (metrics.commitsPerSession / context.orgMedianCommitsPerSession)
      : 0

    // Check WoW if available (use WoW if >= 2 periods, otherwise use median comparison)
    let wowChange = 0
    let useWoW = false
    if (metrics.commitsPerSessionValues.length >= 2) {
      const current = metrics.commitsPerSessionValues.slice(-Math.floor(metrics.commitsPerSessionValues.length / 2))
      const baseline = metrics.commitsPerSessionValues.slice(0, Math.floor(metrics.commitsPerSessionValues.length / 2))
      const currentAvg = current.reduce((a, b) => a + b, 0) / current.length
      const baselineAvg = baseline.reduce((a, b) => a + b, 0) / baseline.length
      wowChange = baselineAvg > 0 ? ((currentAvg - baselineAvg) / baselineAvg) * 100 : 0
      useWoW = true
    }

    // BAD: High AI but commits flat/down (check WoW first, then median)
    const isBad = useWoW
      ? (wowChange <= 5)
      : (commitsVsMedian <= 1.0)

    if (isBad) {
      // BAD: High AI but flat/down commits
      candidates.push({
        tool: metrics.tool,
        kind: 'bad',
        detector: 'output-conversion-gap',
        title: `${getToolLabel(metrics.tool)} shows AI usage without output lift (conversion gap)`,
        description: `${getToolLabel(metrics.tool)} generates ${metrics.aiPerCodingMin.toFixed(1)} AI assists/minute but only ${metrics.commitsPerSession.toFixed(1)} commits/session ${useWoW ? `(${wowChange >= 0 ? '+' : ''}${wowChange.toFixed(0)}% WoW)` : `(vs org median ${context.orgMedianCommitsPerSession.toFixed(1)})`}. This suggests AI isn't effectively translating to code output.`,
        evidence: [
          { label: 'AI assists/min', value: metrics.aiPerCodingMin.toFixed(2) },
          { label: 'Commits/session', value: metrics.commitsPerSession.toFixed(1) },
          { label: useWoW ? 'WoW change' : 'vs org median', value: useWoW ? `${wowChange >= 0 ? '+' : ''}${wowChange.toFixed(0)}%` : context.orgMedianCommitsPerSession.toFixed(1) },
          { label: 'Periods analyzed', value: metrics.periods.toString() },
        ],
        recommendation: {
          text: 'Add a tighter acceptance loop (tests/PR checklist) and verify commits/session next week.',
          actionType: 'process',
        },
        severity: 'warning',
        metricId: 'ide.output_conversion',
        delta: -wowChange,
        priority: -Math.abs(wowChange),
      })
    }
    
    // GOOD: High AI and up commits (check WoW first, then median)
    const isGood = useWoW
      ? (wowChange >= 10)
      : (commitsVsMedian >= 1.1)

    if (isGood) {
      // GOOD: High AI and up commits
      const improvement = useWoW ? wowChange : (commitsVsMedian - 1.0) * 100
      candidates.push({
        tool: metrics.tool,
        kind: 'good',
        detector: 'output-conversion-strong',
        title: `${getToolLabel(metrics.tool)} converts AI into output (+${Math.round(improvement)}% commits/session)`,
        description: `${getToolLabel(metrics.tool)} achieves ${metrics.aiPerCodingMin.toFixed(1)} AI assists/minute with ${metrics.commitsPerSession.toFixed(1)} commits/session ${useWoW ? `(${wowChange >= 0 ? '+' : ''}${wowChange.toFixed(0)}% WoW)` : `(vs org median ${context.orgMedianCommitsPerSession.toFixed(1)})`}, indicating ${improvement >= 20 ? 'excellent' : 'effective'} AI-to-code conversion.`,
        evidence: [
          { label: 'AI assists/min', value: metrics.aiPerCodingMin.toFixed(2) },
          { label: 'Commits/session', value: metrics.commitsPerSession.toFixed(1) },
          { label: useWoW ? 'WoW change' : 'vs org median', value: useWoW ? `${wowChange >= 0 ? '+' : ''}${wowChange.toFixed(0)}%` : context.orgMedianCommitsPerSession.toFixed(1) },
          { label: 'Periods analyzed', value: metrics.periods.toString() },
        ],
        recommendation: {
          text: 'Continue current practices and track commits/session next week to verify sustainability.',
          actionType: 'process',
        },
        severity: 'highlight',
        metricId: 'ide.output_conversion',
        delta: improvement,
        priority: improvement,
      })
    }
  }

  // Detector 3: Coding Time Volatility (BAD only)
  if (metrics.periods >= context.minPeriodsForVolatility && metrics.codingMinutesValues.length > 0) {
    const mean = metrics.codingMinutesValues.reduce((a, b) => a + b, 0) / metrics.codingMinutesValues.length
    const variance = metrics.codingMinutesValues.reduce((sum, val) => {
      return sum + Math.pow(val - mean, 2)
    }, 0) / metrics.codingMinutesValues.length
    const stddev = Math.sqrt(variance)
    const cv = mean > 0 ? stddev / mean : 0

    if (cv >= context.volatilityCVThreshold) {
      candidates.push({
        tool: metrics.tool,
        kind: 'bad',
        detector: 'coding-time-volatility',
        title: `${getToolLabel(metrics.tool)} coding time is volatile (CV ${cv.toFixed(2)})`,
        description: `${getToolLabel(metrics.tool)} shows coding time coefficient of variation ${cv.toFixed(2)} across ${metrics.periods} periods, indicating inconsistent usage patterns or tooling instability.`,
        evidence: [
          { label: 'Mean coding min/period', value: mean.toFixed(0) },
          { label: 'Stddev', value: stddev.toFixed(0) },
          { label: 'Periods', value: metrics.periods.toString() },
        ],
        recommendation: {
          text: 'Check interruptions/tooling stability; verify next week volatility decreases.',
          actionType: 'tooling',
        },
        severity: 'warning',
        metricId: 'ide.coding_time_volatility',
        delta: -cv * 100,  // Negative for bad
        priority: -cv * 100,
      })
    }
  }

  // Detector 4: Session Length Drift (GOOD or BAD)
  if (metrics.sessionMinutesValues.length >= 2) {
    const current = metrics.sessionMinutesValues.slice(-Math.floor(metrics.sessionMinutesValues.length / 2))
    const baseline = metrics.sessionMinutesValues.slice(0, Math.floor(metrics.sessionMinutesValues.length / 2))
    const currentAvg = current.reduce((a, b) => a + b, 0) / current.length
    const baselineAvg = baseline.reduce((a, b) => a + b, 0) / baseline.length

    const changePct = baselineAvg > 0 ? ((currentAvg - baselineAvg) / baselineAvg) * 100 : 0

    if (changePct >= 20) {
      // GOOD: Sessions longer (sustained focus)
      candidates.push({
        tool: metrics.tool,
        kind: 'good',
        detector: 'session-length-increase',
        title: `${getToolLabel(metrics.tool)} sessions are longer (sustained focus)`,
        description: `${getToolLabel(metrics.tool)} average session length increased ${changePct.toFixed(0)}% from ${baselineAvg.toFixed(0)} to ${currentAvg.toFixed(0)} minutes, indicating improved focus and workflow continuity.`,
        evidence: [
          { label: 'Avg session min', value: currentAvg.toFixed(0) },
          { label: 'vs baseline', value: baselineAvg.toFixed(0) },
          { label: 'Commits/session', value: metrics.commitsPerSession.toFixed(1) },
        ],
        recommendation: {
          text: 'Continue focus-friendly practices; track avg session length next week.',
          actionType: 'process',
        },
        severity: 'highlight',
        metricId: 'ide.session_length',
        delta: changePct,
        priority: changePct,
      })
    } else if (changePct <= -20) {
      // BAD: Sessions shorter (fragmentation risk)
      candidates.push({
        tool: metrics.tool,
        kind: 'bad',
        detector: 'session-length-decrease',
        title: `${getToolLabel(metrics.tool)} sessions are shorter (fragmentation risk)`,
        description: `${getToolLabel(metrics.tool)} average session length decreased ${Math.abs(changePct).toFixed(0)}% from ${baselineAvg.toFixed(0)} to ${currentAvg.toFixed(0)} minutes, indicating increased context switching or interruptions.`,
        evidence: [
          { label: 'Avg session min', value: currentAvg.toFixed(0) },
          { label: 'vs baseline', value: baselineAvg.toFixed(0) },
          { label: 'Commits/session', value: metrics.commitsPerSession.toFixed(1) },
        ],
        recommendation: {
          text: 'Reduce context switching; track avg session length next week.',
          actionType: 'process',
        },
        severity: 'warning',
        metricId: 'ide.session_length',
        delta: changePct,
        priority: changePct,
      })
    }
  }

  return candidates
}

/**
 * Select best 2 insights per IDE (1 good, 1 bad)
 */
function selectBestInsights(
  candidates: CandidateInsight[],
  toolOrder: string[]
): CandidateInsight[] {
  const selected: CandidateInsight[] = []

  for (const tool of toolOrder) {
    const toolCandidates = candidates.filter(c => c.tool === tool)
    const good = toolCandidates.filter(c => c.kind === 'good').sort((a, b) => (b.priority || 0) - (a.priority || 0))
    const bad = toolCandidates.filter(c => c.kind === 'bad').sort((a, b) => (a.priority || 0) - (b.priority || 0))  // Lower is worse

    // Select best good (if available)
    if (good.length > 0) {
      selected.push(good[0])
    }

    // Select worst bad (if available)
    if (bad.length > 0) {
      selected.push(bad[0])
    }
  }

  // Cap at 6 total
  return selected.slice(0, 6)
}

/**
 * Compute org median AI per coding minute
 */
function computeOrgMedianAiPerMin(toolPointArrays: ToolProductivityPoint[][]): number {
  const aiPerMinValues: number[] = []
  for (const points of toolPointArrays) {
    const aiAssists = points.reduce((sum, p) => sum + (p.aiAssists || 0), 0)
    const codingMinutes = points.reduce((sum, p) => sum + (p.codingMinutes || 0), 0)
    if (codingMinutes > 0) {
      aiPerMinValues.push(aiAssists / codingMinutes)
    }
  }
  return computeOrgMedian(aiPerMinValues)
}

/**
 * Compute median of array
 */
function computeOrgMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

/**
 * Get metric label for display
 */
function getMetricLabel(metricId: string): string {
  const labels: Record<string, string> = {
    'ide.ai_efficiency': 'AI Efficiency',
    'ide.output_conversion': 'Output Conversion',
    'ide.coding_time_volatility': 'Coding Time Volatility',
    'ide.session_length': 'Session Length',
  }
  return labels[metricId] || metricId
}
