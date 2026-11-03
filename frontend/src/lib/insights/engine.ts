// Small, composable insights engine
console.log('[ENGINE_LIVE_V3]', import.meta.url);
console.log('[ENGINE_LIVE_V4]', import.meta.url);

const COVERAGE_RULE_ENABLED =
  ((import.meta as any).env?.VITE_PERF_INSIGHTS_COVERAGE ?? 'on').toLowerCase() !== 'off';
console.log('[ENGINE_LIVE_V5]', { file: import.meta.url, COVERAGE_RULE_ENABLED });

// V6 hotfix sentinels and kill switch
const PERF_COVERAGE_SWITCH =
  ((import.meta as any).env?.VITE_PERF_INSIGHTS_COVERAGE ?? 'on').toLowerCase() !== 'off';
console.log('[ENGINE_LIVE_V6] loaded', { file: import.meta.url, PERF_COVERAGE_SWITCH });
export interface Insight {
  confidenceBadge?: 'Observed' | 'Mixed' | 'GitHub-only' | 'Estimated';
  supportingContext?: Array<{
    id: string;
    title: string;
    metricId?: string;
    evidence: Array<{ label: string; value?: number | string }>;
  }>;
  id: string;
  title: string;
  detail: string;
  severity: 'critical' | 'warning' | 'info';
  entityType: 'org' | 'team' | 'dev' | 'tool';
  entityId?: string;
  metricId: string;
  timeWindow: string;
  actions?: string[];
}

export interface InsightsInput {
  window: 'hour' | 'day' | 'week' | 'month' | 'quarter';
  scope: 'org' | 'team' | 'dev';
  series: Array<{ label: string; points: { t: string; v: number }[] }>;
  summary?: Record<string, number>;
  github?: {
    prMerged?: number;
    prOpened?: number;
    prClosed?: number;
    prReopened?: number;
    timeToMergeHoursAvg?: number;
    commentsPerPRAvg?: number;
    deployments?: number;
    mttrHours?: number;
  };
  context?: {
    toolId?: string;
    teamId?: string;
    developerIds?: string[];
    metricId?: string;
  };
}

// Helper utilities
function pctChange(curr: number, base: number): number {
  if (base === 0) return curr > 0 ? 100 : 0;
  return ((curr - base) / base) * 100;
}

function movingAvg(points: { t: string; v: number }[], k: number): number | null {
  if (!points || points.length === 0) return null;
  const values = points.map(p => p.v).filter(v => typeof v === 'number' && !isNaN(v));
  if (values.length === 0) return null;
  
  const windowSize = Math.min(k, values.length);
  const recentValues = values.slice(-windowSize);
  return recentValues.reduce((sum, val) => sum + val, 0) / recentValues.length;
}

function safeLastValue(points: { t: string; v: number }[]): number | null {
  if (!points || points.length === 0) return null;
  const lastPoint = points[points.length - 1];
  return typeof lastPoint?.v === 'number' && !isNaN(lastPoint.v) ? lastPoint.v : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 
    ? (sorted[mid - 1] + sorted[mid]) / 2 
    : sorted[mid];
}

function getBaseline(points: { t: string; v: number }[], preferredWindow: number): number | null {
  if (!points || points.length === 0) return null;
  const values = points.map(p => p.v).filter(v => typeof v === 'number' && !isNaN(v));
  if (values.length === 0) return null;
  
  // If we have enough points for moving average, use it
  if (values.length >= preferredWindow) {
    return movingAvg(points, preferredWindow);
  }
  
  // Fallback: use median of all points for dev-friendly insights
  return median(values);
}

// Generate insights from input data
export function generateInsights(input: InsightsInput): Insight[] {
  const insights: Insight[] = [];
  const { window, scope, series, github, context } = input;

  console.log('🔍 Insights engine input:', {
    window,
    scope,
    seriesCount: series.length,
    github,
    context
  });

  // Extract both datasets for coverage gating
  const gh = Array.isArray((input as any)?.github?.series) ? (input as any).github.series : [];
  const prod = Array.isArray((input as any)?.productivity?.series) ? (input as any).productivity.series : [];

  const ghPeriods = new Set(gh.map((x: any) => x?.period).filter(Boolean));
  const prodPeriods = new Set(prod.map((x: any) => x?.period).filter(Boolean));
  let overlap = 0;
  for (const k of ghPeriods) if (prodPeriods.has(k)) overlap++;

  const COVERAGE_RULE_ENABLED = String((import.meta as any).env?.VITE_PERF_INSIGHTS_COVERAGE ?? 'off').toLowerCase() === 'on';
  const allowCoverage = COVERAGE_RULE_ENABLED && gh.length > 0 && prod.length > 0 && overlap < 4;

  console.log('[ENGINE_LIVE_V5]', { ghLen: gh.length, prodLen: prod.length, overlap, COVERAGE_RULE_ENABLED });

  const shouldShowCoverage = (gh.length > 0 && prod.length > 0 && overlap < 4);

  console.log('🔍 [ENGINE_CENTRALIZED] Coverage gate:', {
    hasGH: gh.length > 0,
    hasProd: prod.length > 0,
    overlap,
    shouldShowCoverage
  });

  // V6 dataset normalization and GH series synthesis
  function _normPeriodsFromSeriesShapeA(seriesArr:any[]): string[] {
    // Shape A: [{ period: 'YYYY-MM-DD', ... }]
    return (seriesArr || [])
      .map((s:any)=> String(s?.period || ''))
      .filter(Boolean);
  }

  function _normPeriodsFromSeriesShapeB(seriesArr:any[]): string[] {
    // Shape B: [{ label, points:[{t,v},...] }, ...]
    const stamps:string[] = [];
    for (const s of (seriesArr || [])) {
      const pts = Array.isArray(s?.points) ? s.points : [];
      for (const p of pts) {
        const t = String(p?.t || '');
        if (t) stamps.push(t);
      }
    }
    return stamps;
  }

  function _unique<T>(arr:T[]): T[] { return Array.from(new Set(arr)); }

  // Add this block where you already have access to `params`:
  const ideSeriesAny =
    Array.isArray((input as any)?.series) ? (input as any).series : [];
  let ghSeriesAny =
    Array.isArray((input as any)?.ghSeries) ? (input as any).ghSeries : [];

  // If GH series missing but we do have a snapshot in `input.github`, synthesize a GH series
  if ((!ghSeriesAny || ghSeriesAny.length === 0) && (input as any)?.github && ideSeriesAny?.length > 0) {
    // Extract IDE stamps from either shape
    const ideStamps =
      ideSeriesAny[0]?.points ? _normPeriodsFromSeriesShapeB(ideSeriesAny)
                              : _normPeriodsFromSeriesShapeA(ideSeriesAny);
    const stamps = _unique(ideStamps);

    const ghValue =
      Number((input as any).github?.leadTime) ??
      Number((input as any).github?.time_to_merge) ??
      Number((input as any).github?.codeReviewTime) ?? 0;

    ghSeriesAny = [{
      label: 'gh.time_to_merge_hours',
      points: stamps.map(t => ({ t, v: isFinite(ghValue) ? ghValue : 0 }))
    }];

    console.log('[ENGINE_LIVE_V6] synthesized GH series from snapshot', {
      stamps: stamps.length, ghValue
    });
  }

  // Using centralized data for overlap calculation
  // CRITICAL: Define hasGH and hasProd from coverage data
  const hasGH = gh.length > 0;
  const hasProd = prod.length > 0;
  const combined = hasGH && hasProd;
  
  console.log('[ENGINE_LIVE_V6] datasets', {
    hasGH, hasProd, combined, ghLen: gh.length, prodLen: prod.length
  });
  console.log('[ENGINE_LIVE_V6] overlap', overlap);

  // Rule 1: Throughput dip (critical) - 15% threshold
  for (const s of series) {
    const lastValue = safeLastValue(s.points);
    const baseline = getBaseline(s.points, 7);
    
    if (lastValue !== null && baseline !== null && baseline > 0) {
      const change = pctChange(lastValue, baseline);
      if (change <= -15) {
        insights.push({
          id: `throughput-dip-${s.label}`,
          title: `${s.label} Throughput Dip`,
          detail: `${s.label} performance dropped ${Math.abs(change).toFixed(1)}% vs ${s.points.length >= 7 ? 'recent average' : 'historical median'}.`,
          severity: 'critical',
          entityType: 'tool',
          entityId: s.label,
          metricId: context?.metricId || 'throughput',
          timeWindow: window,
          actions: [
            'Review PR queue for bottlenecks',
            'Check test flakiness last 7 days'
          ]
        });
      }
    }
  }

  // Rule 2: Time-to-merge risk
  if (github?.timeToMergeHoursAvg !== undefined) {
    const ttm = github.timeToMergeHoursAvg;
    if (ttm >= 72) {
      insights.push({
        id: 'time-to-merge-critical',
        title: 'Critical Time to Merge',
        detail: `Average time to merge is ${ttm.toFixed(1)} hours - critically slow.`,
        severity: 'critical',
        entityType: scope,
        entityId: context?.teamId,
        metricId: 'time_to_merge_hours',
        timeWindow: window,
        actions: [
          'Identify PRs > 48h open and assign reviewers',
          'Enable auto-assign reviewers'
        ]
      });
    } else if (ttm >= 48) {
      insights.push({
        id: 'time-to-merge-warning',
        title: 'Time to Merge Warning',
        detail: `Average time to merge is ${ttm.toFixed(1)} hours - consider reviewing process.`,
        severity: 'warning',
        entityType: scope,
        entityId: context?.teamId,
        metricId: 'time_to_merge_hours',
        timeWindow: window,
        actions: [
          'Identify PRs > 48h open and assign reviewers',
          'Enable auto-assign reviewers'
        ]
      });
    }
  }

  // Rule 3: Reopened PRs
  if (github?.prReopened !== undefined && github?.prClosed !== undefined && github.prClosed > 0) {
    const reopenRate = github.prReopened / github.prClosed;
    if (reopenRate >= 0.15) {
      insights.push({
        id: 'reopened-prs-warning',
        title: 'High PR Reopen Rate',
        detail: `${(reopenRate * 100).toFixed(1)}% of PRs reopened - quality issues detected.`,
        severity: 'warning',
        entityType: scope,
        entityId: context?.teamId,
        metricId: 'pr_reopen_rate',
        timeWindow: window,
        actions: [
          'Triage PR review checklist',
          'Add CI gate for failing suites'
        ]
      });
    }
  }

  // Rule 4: Comment-to-merge low
  if (github?.commentsPerPRAvg !== undefined) {
    const commentsPerPR = github.commentsPerPRAvg;
    if (commentsPerPR < 0.8) {
      insights.push({
        id: 'comment-to-merge-warning',
        title: 'Very Low Review Engagement',
        detail: `Only ${commentsPerPR.toFixed(1)} comments per PR - consider mandatory reviews.`,
        severity: 'warning',
        entityType: scope,
        entityId: context?.teamId,
        metricId: 'comments_per_pr',
        timeWindow: window
      });
    } else if (commentsPerPR < 1.2) {
      insights.push({
        id: 'comment-to-merge-info',
        title: 'Low Review Engagement',
        detail: `${commentsPerPR.toFixed(1)} comments per PR - consider encouraging more reviews.`,
        severity: 'info',
        entityType: scope,
        entityId: context?.teamId,
        metricId: 'comments_per_pr',
        timeWindow: window
      });
    }
  }

  // Rule 5: MTTR risk
  if (github?.mttrHours !== undefined && github.mttrHours >= 24) {
    insights.push({
      id: 'mttr-risk',
      title: 'High Mean Time to Recovery',
      detail: `MTTR is ${github.mttrHours.toFixed(1)} hours - critically slow recovery.`,
      severity: 'critical',
      entityType: scope,
      entityId: context?.teamId,
      metricId: 'mttr_hours',
      timeWindow: window,
      actions: [
        'Audit on-call coverage',
        'Create rollback runbook'
      ]
    });
  }

  // Rule 6: Tool regression (warning) - 10% threshold
  for (const s of series) {
    const lastValue = safeLastValue(s.points);
    const baseline = getBaseline(s.points, 5);
    
    if (lastValue !== null && baseline !== null && baseline > 0) {
      const change = pctChange(lastValue, baseline);
      if (change <= -10) {
        insights.push({
          id: `tool-regression-${s.label}`,
          title: `${s.label} Performance Regression`,
          detail: `${s.label} declined ${Math.abs(change).toFixed(1)}% vs ${s.points.length >= 5 ? 'recent average' : 'historical median'}.`,
          severity: 'warning',
          entityType: 'tool',
          entityId: s.label,
          metricId: context?.metricId || 'performance',
          timeWindow: window
        });
      }
    }
  }

  // Rule 7: Positive highlight (info) - 12% threshold
  for (const s of series) {
    const lastValue = safeLastValue(s.points);
    const baseline = getBaseline(s.points, 7);
    
    if (lastValue !== null && baseline !== null && baseline > 0) {
      const change = pctChange(lastValue, baseline);
      if (change >= 12) {
        insights.push({
          id: `positive-highlight-${s.label}`,
          title: `${s.label} Performance Improvement`,
          detail: `${s.label} improved ${change.toFixed(1)}% vs ${s.points.length >= 7 ? 'recent average' : 'historical median'}.`,
          severity: 'info',
          entityType: 'tool',
          entityId: s.label,
          metricId: context?.metricId || 'performance',
          timeWindow: window
        });
      }
    }
  }

  // Rule 8: Coverage check - gated by allowCoverage
  if (allowCoverage) {
    insights.push({
      id: 'coverage/insufficient',
      title: 'Not enough series to analyze cross-dataset insights',
      detail: 'We need both Engineering Output and Productivity-by-Tool time series. Try widening the date range or selecting more teams/tools.',
      severity: 'info' as const,
      entityType: scope,
      entityId: context?.teamId,
      metricId: 'coverage',
      timeWindow: window,
      tags: ['data','coverage'],
      source: 'mixed',
      evidence: [
        { label:'overlap', metric:'periods', value: overlap },
        { label:'gh periods', metric:'periods', value: gh.length },
        { label:'prod periods', metric:'periods', value: prod.length }
      ],
      recommendations: [
        { text: 'Increase time range to include ≥4 periods. (owner: Eng Manager, within 2 weeks)' }
      ],
      equivalenceKey: 'coverage/insufficient',
    } as any);
  } else {
    console.log('[ENGINE_LIVE_V5] coverage suppressed');
  }

  // Rule 9: Never return empty - dev-friendly fallback
  if (insights.length === 0) {
    console.log('📝 No insights generated, adding fallback insight');
    insights.push({
      id: 'stable-period',
      title: 'Stable Period Detected',
      detail: 'No significant risks or opportunities found. Consider expanding time window to month to uncover trends.',
      severity: 'info',
      entityType: scope,
      entityId: context?.teamId,
      metricId: 'overall_health',
      timeWindow: window
    });
  }

  console.log('📊 Final insights count:', insights.length);

  // Sort by severity: critical > warning > info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return insights;
}
