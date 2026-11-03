// frontend/src/lib/insights/providers.ts
import type { EngOutputPoint, ToolProductivityPoint } from './types'
import { periodKey, type Granularity } from './time'
import { toCanonicalPeriodKey } from './engine/period'

const PI_DEBUG = typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_PI_DEBUG === 'true'

// Normalize to ISO yyyy-mm-dd (week start if a Date)
const toISO = (d: any) => {
  if (!d) return undefined
  if (typeof d === 'string') return d.slice(0,10)
  try { return new Date(d).toISOString().slice(0,10) } catch { return undefined }
}

export function normalizeToolId(raw: string): 'vscode'|'cursor'|'windsurf'|'devin'|'copilot'|'claude_code'|'codex'|'github_copilot'|'unknown' {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return 'unknown'

  // VS Code variants
  if (s === 'vscode' || s === 'vs-code' || s === 'vs code' || s === 'visual studio code' || s === 'visual-studio-code') {
    return 'vscode'
  }

  // Cursor variants
  if (s === 'cursor' || s.startsWith('cursor-') || s.includes('cursor')) {
    return 'cursor'
  }

  // Devin variants (native identity after Windsurf rename)
  if (s === 'devin' || s.startsWith('devin-') || s.includes('devin')) {
    return 'devin'
  }

  // Windsurf variants (historical alias — canonical normalization maps windsurf → devin)
  if (s === 'windsurf' || s.startsWith('windsurf-') || s.includes('windsurf')) {
    return 'windsurf'
  }

  // Copilot variants (including github_copilot from canonical)
  if (s === 'copilot' || s === 'github-copilot' || s === 'githubcopilot' || s === 'github_copilot' || s.includes('copilot')) {
    return 'github_copilot'
  }

  // Claude Code variants (from canonical)
  if (s === 'claude_code' || s === 'claude-code' || s === 'claudecode' || s.includes('claude')) {
    return 'claude_code'
  }

  // Codex variants (from canonical — codex bridge emits source='codex')
  if (s === 'codex' || s === 'codex-cli' || s === 'codex_cli' || s === 'openai-codex' || s === 'openai codex' || s.includes('codex')) {
    return 'codex'
  }

  return 'unknown'
}

// 11A) Map GitHub weekly metrics → EngOutputPoint[]
// NOTE: Current API returns aggregated metrics, not time-series.
// We create a single time-series point for the current period.
export function mapGitHubWeeklyToEngOutput(series: any[]): EngOutputPoint[] {
  const src = Array.isArray(series) ? series : []
  
  // If we have aggregated metrics (not time-series), create multi-period series for demo mode
  if (src.length === 1 && !src[0]?.period && !src[0]?.week && !src[0]?.date) {
    const aggregated = src[0]
    if (aggregated?.github_team_metrics || aggregated?.team_metrics) {
      const teamMetrics = aggregated.github_team_metrics || aggregated.team_metrics || {}
      const currentPeriod = getCurrentISOWeek() // Generate current week period
      
      // Check if we should create demo multi-period series
      const isDemoMode =
        aggregated?.github_enrichment_status === 'demo_db_first' ||
        aggregated?.github_connection_reason === 'demo_db_operational_realism' ||
        aggregated?.github_data_fallback === true
      
      console.log('[CM_FORENSIC:DEMO_PERIOD_BRANCH]', {
        hasAggregated: !!aggregated,
        aggregatedKeys: aggregated ? Object.keys(aggregated).slice(0, 20) : [],
        enrichmentStatus: aggregated?.github_enrichment_status,
        connectionReason: aggregated?.github_connection_reason,
        hasPrAnalytics: !!aggregated?.pr_analytics,
        hasReviewMetrics: !!aggregated?.pr_review_metrics,
        hasDeploymentMetrics: !!aggregated?.deployment_metrics,
        isDemoMode,
        branch: isDemoMode ? 'demo_multi_period' : 'single_point'
      })
      
      const series = isDemoMode
        ? createDemoMultiPeriodSeries(currentPeriod, teamMetrics, aggregated)
        : [createEngOutputPointFromAggregated(currentPeriod, teamMetrics, aggregated)]

      console.log('[CM_FORENSIC:DEMO_PERIOD_RESULT]', {
        branch: isDemoMode ? 'demo_multi_period' : 'single_point',
        seriesCount: series.length,
        periods: series.map(p => p.period)
      })

      return series
    }
  }
  
  // Handle actual time-series data if present
  return src.map((w: any) => {
    // Map MTTR fields (try multiple aliases, convert minutes to hours if needed)
    let mttrHours: number | undefined = undefined;
    if (w?.mttrHours !== undefined && w?.mttrHours !== null && isFinite(w.mttrHours)) {
      mttrHours = w.mttrHours;
    } else if (w?.meanTimeToRecoveryHours !== undefined && w?.meanTimeToRecoveryHours !== null && isFinite(w.meanTimeToRecoveryHours)) {
      mttrHours = w.meanTimeToRecoveryHours;
    } else if (w?.meanTimeToRecovery !== undefined && w?.meanTimeToRecovery !== null && isFinite(w.meanTimeToRecovery)) {
      mttrHours = w.meanTimeToRecovery; // Assume hours if no unit specified
    } else if (w?.meanTimeToRecoveryMinutes !== undefined && w?.meanTimeToRecoveryMinutes !== null && isFinite(w.meanTimeToRecoveryMinutes)) {
      mttrHours = w.meanTimeToRecoveryMinutes / 60; // Convert minutes to hours
    } else if (w?.mttr !== undefined && w?.mttr !== null && isFinite(w.mttr)) {
      mttrHours = w.mttr; // Assume hours if no unit specified
    }
    
    return {
      period: toCanonicalPeriodKey(w?.period ?? w?.week ?? toISO(w?.date)) as any,
      team: w?.team,
      repo: w?.repo,
      // Optional tool id (normalized) when telemetry provides it
      tool: normalizeToolId(w?.tool ?? w?.toolId ?? w?.ide ?? w?.editor ?? 'unknown') as any,
      // Field aliases with snake_case to camelCase mapping
      prCycleTimeHours: w?.time_to_merge ?? w?.lead_time ?? w?.pr_cycle_time ?? w?.leadTime ?? w?.prCycleTimeHours,
      timeToFirstReviewHours: w?.time_to_first_review ?? w?.codeReviewTime ?? w?.timeToFirstReviewHours,
      deploymentFreqPerWeek: w?.deployment_frequency ?? w?.deploymentFrequency ?? w?.deploymentFreqPerWeek,
      mergeRatePct: w?.merge_rate ?? w?.mergeRate ?? w?.mergeRatePct,
      changeFailureRatePct: w?.change_failure_rate ?? w?.changeFailureRate ?? w?.changeFailureRatePct,
      // MTTR field mapping (extends EngOutputPoint)
      mttrHours: mttrHours,
      // optional future fields: developer, etc.
      // developer: w?.developer,
    } as any;
  }).filter(x => !!x.period)
}

// Helper function to get current ISO week
function getCurrentISOWeek(): string {
  const now = new Date()
  const year = now.getUTCFullYear()
  // Get ISO week number
  const startOfYear = new Date(Date.UTC(year, 0, 1))
  const startOfWeek = new Date(startOfYear)
  startOfWeek.setUTCDate(startOfYear.getUTCDate() - startOfYear.getUTCDay() + 1) // Monday of week 1
  
  const currentWeekStart = new Date(now)
  currentWeekStart.setUTCDate(now.getUTCDate() - now.getUTCDay() + 1) // Monday of current week
  
  const weekNumber = Math.floor((currentWeekStart.getTime() - startOfWeek.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1
  return `${year}-W${String(weekNumber).padStart(2, '0')}`
}

// Helper function to create demo multi-period series from aggregated metrics
function createDemoMultiPeriodSeries(currentPeriod: string, teamMetrics: any, aggregated: any): EngOutputPoint[] {
  // Parse current period (format: YYYY-Www)
  const [year, weekStr] = currentPeriod.split('-W')
  const currentWeek = parseInt(weekStr)
  
  // Create 4 weekly periods ending at current week
  const periods = [
    `${year}-W${String(currentWeek - 3).padStart(2, '0')}`, // 3 weeks ago
    `${year}-W${String(currentWeek - 2).padStart(2, '0')}`, // 2 weeks ago  
    `${year}-W${String(currentWeek - 1).padStart(2, '0')}`, // 1 week ago
    currentPeriod // current week
  ]
  
  // Extract base metrics from current aggregate data
  const baseMetrics = {
    prCycleTimeHours: teamMetrics?.time_to_merge ?? teamMetrics?.lead_time ?? aggregated?.time_to_merge ?? 0,
    timeToFirstReviewHours: aggregated?.pr_review_metrics?.time_to_first_review ?? teamMetrics?.time_to_first_review ?? aggregated?.time_to_first_review ?? 0,
    deploymentFreqPerWeek: teamMetrics?.deployment_frequency ?? aggregated?.deployment_freq_per_week ?? aggregated?.deployment_frequency ?? (() => {
      const dm = aggregated?.deployment_metrics
      if (dm && dm.latest_deployment?.deployed_at) {
        const deployedAt = new Date(dm.latest_deployment.deployed_at);
        const now = new Date();
        const daysSinceDeploy = (now.getTime() - deployedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceDeploy <= 7) {
          return dm.success_deployment_count || 0;
        }
        const totalDeployments = (dm.success_deployment_count || 0) + (dm.failed_deployment_count || 0);
        return Math.round(totalDeployments / 4 * 10) / 10;
      }
      return 0
    })(),
    mergeRatePct: teamMetrics?.merge_rate ?? teamMetrics?.mergeRate ?? aggregated?.merge_rate ?? 0,
    changeFailureRatePct: (() => {
      const raw = teamMetrics?.change_failure_rate ?? aggregated?.change_failure_rate ?? teamMetrics?.changeFailureRate ?? 0
      return (raw > 0 && raw <= 1) ? raw * 100 : raw
    })(),
    mttrHours: (() => {
      let mttrHours: number | undefined = undefined
      if (aggregated?.mttr_hours !== undefined && aggregated?.mttr_hours !== null && isFinite(aggregated.mttr_hours)) {
        mttrHours = aggregated.mttr_hours
      } else if (teamMetrics?.mean_time_to_recovery_hours !== undefined && teamMetrics?.mean_time_to_recovery_hours !== null && isFinite(teamMetrics.mean_time_to_recovery_hours)) {
        mttrHours = teamMetrics.mean_time_to_recovery_hours
      } else if (teamMetrics?.mean_time_to_recovery !== undefined && teamMetrics?.mean_time_to_recovery !== null && isFinite(teamMetrics.mean_time_to_recovery)) {
        mttrHours = teamMetrics.mean_time_to_recovery
      } else if (teamMetrics?.mean_time_to_recovery_minutes !== undefined && teamMetrics?.mean_time_to_recovery_minutes !== null && isFinite(teamMetrics.mean_time_to_recovery_minutes)) {
        mttrHours = teamMetrics.mean_time_to_recovery_minutes / 60
      } else if (teamMetrics?.mttr !== undefined && teamMetrics?.mttr !== null && isFinite(teamMetrics.mttr)) {
        mttrHours = teamMetrics.mttr
      }
      return mttrHours
    })()
  }
  
  // Create plausible variance for demo narrative
  // Week -3: slightly lower deploys, slightly higher CFR
  // Week -2: moderate deploys, moderate CFR  
  // Week -1: improving deploys, improving CFR
  // Week 0: current aggregate values
  const varianceFactors = [
    { // Week -3
      deploymentMultiplier: 0.7,
      cfrMultiplier: 1.3,
      prTimeMultiplier: 1.2,
      reviewTimeMultiplier: 1.15,
      mergeRateMultiplier: 0.85,
      mttrMultiplier: 1.25
    },
    { // Week -2
      deploymentMultiplier: 0.85,
      cfrMultiplier: 1.1,
      prTimeMultiplier: 1.1,
      reviewTimeMultiplier: 1.08,
      mergeRateMultiplier: 0.92,
      mttrMultiplier: 1.15
    },
    { // Week -1
      deploymentMultiplier: 0.95,
      cfrMultiplier: 0.95,
      prTimeMultiplier: 1.05,
      reviewTimeMultiplier: 1.02,
      mergeRateMultiplier: 0.98,
      mttrMultiplier: 1.05
    },
    { // Week 0 (current)
      deploymentMultiplier: 1.0,
      cfrMultiplier: 1.0,
      prTimeMultiplier: 1.0,
      reviewTimeMultiplier: 1.0,
      mergeRateMultiplier: 1.0,
      mttrMultiplier: 1.0
    }
  ]

  // PILOT OPS 14-E: Removed misleading `[MAPPER] Creating demo multi-period
  // series` console.debug log. The log fired whenever the backend response
  // carried demo-related fields (github_enrichment_status,
  // github_connection_reason, github_data_fallback), even when the
  // frontend DEMO_MODE was false — because the isDemoMode check is based on
  // backend response fields, not a frontend env var. The mapper architecture
  // is unchanged; only the noisy debug log was removed.

  // Generate 4 points with variance
  return periods.map((period, index) => {
    const factor = varianceFactors[index]
    
    return {
      period,
      team: teamMetrics?.team,
      repo: teamMetrics?.repo,
      tool: 'unknown' as any,
      prCycleTimeHours: Math.round(baseMetrics.prCycleTimeHours * factor.prTimeMultiplier * 100) / 100,
      timeToFirstReviewHours: Math.round(baseMetrics.timeToFirstReviewHours * factor.reviewTimeMultiplier * 100) / 100,
      deploymentFreqPerWeek: Math.max(0, Math.round(baseMetrics.deploymentFreqPerWeek * factor.deploymentMultiplier * 10) / 10),
      mergeRatePct: Math.min(100, Math.max(0, Math.round(baseMetrics.mergeRatePct * factor.mergeRateMultiplier * 100) / 100)),
      changeFailureRatePct: Math.min(100, Math.max(0, Math.round(baseMetrics.changeFailureRatePct * factor.cfrMultiplier * 100) / 100)),
      mttrHours: baseMetrics.mttrHours ? Math.round(baseMetrics.mttrHours * factor.mttrMultiplier * 100) / 100 : undefined,
    } as any
  })
}

// Helper function to create EngOutputPoint from aggregated metrics
function createEngOutputPointFromAggregated(period: string, teamMetrics: any, aggregated: any): EngOutputPoint {
  // Map MTTR from aggregated data with multiple aliases
  let mttrHours: number | undefined = undefined
  
  // Try MTTR from various sources in order of preference
  if (aggregated?.mttr_hours !== undefined && aggregated?.mttr_hours !== null && isFinite(aggregated.mttr_hours)) {
    mttrHours = aggregated.mttr_hours
  } else if (teamMetrics?.mean_time_to_recovery_hours !== undefined && teamMetrics?.mean_time_to_recovery_hours !== null && isFinite(teamMetrics.mean_time_to_recovery_hours)) {
    mttrHours = teamMetrics.mean_time_to_recovery_hours
  } else if (teamMetrics?.mean_time_to_recovery !== undefined && teamMetrics?.mean_time_to_recovery !== null && isFinite(teamMetrics.mean_time_to_recovery)) {
    mttrHours = teamMetrics.mean_time_to_recovery
  } else if (teamMetrics?.mean_time_to_recovery_minutes !== undefined && teamMetrics?.mean_time_to_recovery_minutes !== null && isFinite(teamMetrics.mean_time_to_recovery_minutes)) {
    mttrHours = teamMetrics.mean_time_to_recovery_minutes / 60
  } else if (teamMetrics?.mttr !== undefined && teamMetrics?.mttr !== null && isFinite(teamMetrics.mttr)) {
    mttrHours = teamMetrics.mttr
  }
  
  console.debug('[MAPPER] MTTR mapping from aggregated data', {
    mttrHours,
    sources: {
      aggregated_mttr_hours: aggregated?.mttr_hours,
      team_mean_time_to_recovery_hours: teamMetrics?.mean_time_to_recovery_hours,
      team_mean_time_to_recovery: teamMetrics?.mean_time_to_recovery,
      team_mean_time_to_recovery_minutes: teamMetrics?.mean_time_to_recovery_minutes,
      team_mttr: teamMetrics?.mttr
    }
  })
  
  return {
    period,
    team: teamMetrics?.team,
    repo: teamMetrics?.repo,
    tool: 'unknown' as any, // Aggregated data doesn't have tool attribution
    // Map DORA metrics from aggregated data
    prCycleTimeHours: teamMetrics?.time_to_merge ?? teamMetrics?.lead_time ?? aggregated?.time_to_merge ?? 0,
    timeToFirstReviewHours: aggregated?.pr_review_metrics?.time_to_first_review ?? teamMetrics?.time_to_first_review ?? aggregated?.time_to_first_review ?? 0,
    // Use deployment frequency from aggregated data or compute from timestamps
    deploymentFreqPerWeek: teamMetrics?.deployment_frequency ?? aggregated?.deployment_freq_per_week ?? aggregated?.deployment_frequency ?? teamMetrics?.deploymentFreqPerWeek ?? (() => {
      const dm = aggregated?.deployment_metrics
      if (dm && dm.latest_deployment?.deployed_at) {
        // Compute frequency from actual deployment timestamp
        const deployedAt = new Date(dm.latest_deployment.deployed_at);
        const now = new Date();
        const daysSinceDeploy = (now.getTime() - deployedAt.getTime()) / (1000 * 60 * 60 * 24);
        
        // If deployment is recent (within 7 days), compute weekly frequency
        if (daysSinceDeploy <= 7) {
          return dm.success_deployment_count || 0;
        }
        
        // For older deployments, estimate weekly frequency from total count over time window
        // Assuming 4-week time window for API data
        const totalDeployments = (dm.success_deployment_count || 0) + (dm.failed_deployment_count || 0);
        return Math.round(totalDeployments / 4 * 10) / 10; // deployments per week
      }
      return 0
    })(),
    mergeRatePct: teamMetrics?.merge_rate ?? teamMetrics?.mergeRate ?? aggregated?.merge_rate ?? 0,
    changeFailureRatePct: (() => {
      const raw = teamMetrics?.change_failure_rate ?? aggregated?.change_failure_rate ?? teamMetrics?.changeFailureRate ?? 0
      // API returns ratio (0-1); convert to percentage if value is ≤ 1 and non-zero
      return (raw > 0 && raw <= 1) ? raw * 100 : raw
    })(),
    // MTTR field mapping
    mttrHours: mttrHours,
  } as any
}

// 11B) Map productivity weekly → ToolProductivityPoint[]
// NOTE: Current API returns aggregated metrics, not time-series.
// We create time-series points from IDE metrics and telemetry data.
export function mapProductivityWeeklyToTools(series: any[]): ToolProductivityPoint[] {
  const src = Array.isArray(series) ? series : []
  
  // Legacy ide_metrics aggregated data conversion removed - use telemetry endpoints instead
  // Note: ide_metrics from /api/metrics is legacy placeholder with no real telemetry correlation
  
  // Handle actual time-series data if present
  return src.map((w: any) => ({
    period: toCanonicalPeriodKey(w?.period ?? w?.week ?? toISO(w?.date)) as any,
    team: w?.team,
    tool: normalizeToolId(w?.tool ?? w?.toolId ?? w?.ide ?? w?.editor ?? 'unknown'),
    // developer: w?.developer, // if/when available
    aiAssists: w?.AI_suggestions_accepted ?? w?.aiAssists,
    codingMinutes: w?.AI_usage_duration_minutes ?? w?.codingMinutes,
  })).filter(x => !!x.period)
}

// Legacy createToolProductivityPointsFromIDEMetrics function removed
// Note: This function converted ide_metrics legacy placeholder data

// New overloads that accept granularity and compute period keys accordingly.
export function mapGitHubToEngOutputByGranularity(series: any[], granularity: Granularity): EngOutputPoint[] {
  const src = Array.isArray(series) ? series : [];
  
  // STAGE 2: providers.ts mapper audit
  if (PI_DEBUG) console.log('[CM_AUDIT:STAGE_2_MAPPER]', {
    wasFunctionEntered: true,
    inputCount: src.length,
    inputKeys: src.length > 0 ? Object.keys(src[0]) : []
  });
  
  // If we have aggregated metrics (not time-series), create a single point for current period
  if (src.length === 1 && !src[0]?.period && !src[0]?.week && !src[0]?.date) {
    const aggregated = src[0]
    if (aggregated?.github_team_metrics || aggregated?.team_metrics) {
      const teamMetrics = aggregated.github_team_metrics || aggregated.team_metrics || {}
      const currentPeriod = toCanonicalPeriodKey(periodKey(new Date(), granularity)) as string
      
      console.debug('[MAPPER] Converting aggregated GitHub metrics to time-series point (granularity)', {
        granularity,
        currentPeriod,
        teamMetrics: Object.keys(teamMetrics)
      })
      
      const isDemoMode =
        aggregated?.github_enrichment_status === 'demo_db_first' ||
        aggregated?.github_connection_reason === 'demo_db_operational_realism' ||
        aggregated?.github_data_fallback === true

      const series = isDemoMode
        ? createDemoMultiPeriodSeries(currentPeriod, teamMetrics, aggregated)
        : [createEngOutputPointFromAggregated(currentPeriod, teamMetrics, aggregated)]

      console.log('[CM_FORENSIC:LIVE_MAPPER_PERIOD_RESULT]', {
        branch: isDemoMode ? 'demo_multi_period' : 'single_point',
        seriesCount: series.length,
        periods: series.map(p => p.period)
      })

      return series
    }
  }
  
  const result = src.map((w: any) => {
    // Try native period-like fields first; else compute from date/timestamp
    const native =
      w?.period ?? w?.hour ?? w?.day ?? w?.week ?? w?.month ?? w?.quarter ?? w?.date ?? w?.timestamp;
    const pRaw = typeof native === 'string' && native.length >= 7
      ? native
      : periodKey(native, granularity);
    const p = toCanonicalPeriodKey(pRaw) as any;
    // Map MTTR fields (try multiple aliases, convert minutes to hours if needed)
    let mttrHours: number | undefined = undefined;
    if (w?.mttrHours !== undefined && w?.mttrHours !== null && isFinite(w.mttrHours)) {
      mttrHours = w.mttrHours;
    } else if (w?.meanTimeToRecoveryHours !== undefined && w?.meanTimeToRecoveryHours !== null && isFinite(w.meanTimeToRecoveryHours)) {
      mttrHours = w.meanTimeToRecoveryHours;
    } else if (w?.meanTimeToRecovery !== undefined && w?.meanTimeToRecovery !== null && isFinite(w.meanTimeToRecovery)) {
      mttrHours = w.meanTimeToRecovery; // Assume hours if no unit specified
    } else if (w?.meanTimeToRecoveryMinutes !== undefined && w?.meanTimeToRecoveryMinutes !== null && isFinite(w.meanTimeToRecoveryMinutes)) {
      mttrHours = w.meanTimeToRecoveryMinutes / 60; // Convert minutes to hours
    } else if (w?.mttr !== undefined && w?.mttr !== null && isFinite(w.mttr)) {
      mttrHours = w.mttr; // Assume hours if no unit specified
    }
    
    return {
      period: p,
      team: w?.team, repo: w?.repo, // developer: w?.developer,
      // Optional tool id (normalized) when telemetry provides it
      tool: normalizeToolId(w?.tool ?? w?.toolId ?? w?.ide ?? w?.editor ?? 'unknown') as any,
      // Field aliases with snake_case to camelCase mapping
      prCycleTimeHours: w?.time_to_merge ?? w?.lead_time ?? w?.pr_cycle_time ?? w?.leadTime ?? w?.prCycleTimeHours,
      timeToFirstReviewHours: w?.time_to_first_review ?? w?.codeReviewTime ?? w?.timeToFirstReviewHours,
      deploymentFreqPerWeek: w?.deployment_frequency ?? w?.deploymentFrequency ?? w?.deploymentFreqPerWeek,
      mergeRatePct: w?.merge_rate ?? w?.mergeRate ?? w?.mergeRatePct,
      changeFailureRatePct: w?.change_failure_rate ?? w?.changeFailureRate ?? w?.changeFailureRatePct,
      // Add MTTR field (extend EngOutputPoint interface if needed, but TypeScript will allow this)
      mttrHours: mttrHours,
    } as any;
  }).filter(x => !!x.period);
  
  // STAGE 2: providers.ts mapper output audit
  if (PI_DEBUG) console.log('[CM_AUDIT:STAGE_2_MAPPER_OUTPUT]', {
    outputCount: result.length,
    outputPeriods: result.map(r => r.period)
  });

  if (PI_DEBUG && result.length > 0) {
    console.debug('[MAPPER] mapGitHubToEngOutputByGranularity:', {
      granularity,
      inputCount: src.length,
      outputCount: result.length,
      rawPeriodSample: src[0]?.period || src[0]?.week || src[0]?.date,
      mappedPeriodSample: result[0]?.period,
      allMappedPeriods: result.map(r => r.period)
    })
  }
  
  return result;
}

export function mapProductivityToToolsByGranularity(series: any[], granularity: Granularity): ToolProductivityPoint[] {
  const src = Array.isArray(series) ? series : [];
  
  // If we have aggregated metrics (not time-series), create points from IDE metrics
  if (src.length === 1 && !src[0]?.period && !src[0]?.week && !src[0]?.date) {
    const aggregated = src[0]
    if (aggregated?.ide_metrics) {
      const currentPeriod = toCanonicalPeriodKey(periodKey(new Date(), granularity)) as string
      const ideMetrics = aggregated.ide_metrics || {}
      
      console.debug('[MAPPER] Converting aggregated GitHub metrics to time-series point (granularity)', {
        granularity,
        currentPeriod,
        ideTools: Object.keys(ideMetrics).filter(key => key !== '_telemetry_sessions_total'),
        totalSessions: ideMetrics._telemetry_sessions_total
      })
      
      // Legacy createToolProductivityPointsFromIDEMetrics removed - use telemetry endpoints instead
    }
  }
  
  const result = src.map((w: any) => {
    const native =
      w?.period ?? w?.hour ?? w?.day ?? w?.week ?? w?.month ?? w?.quarter ?? w?.date ?? w?.timestamp;
    const pRaw = typeof native === 'string' && native.length >= 7
      ? native
      : periodKey(native, granularity);
    const p = toCanonicalPeriodKey(pRaw) as any;

    const mapped: ToolProductivityPoint & { source?: 'sim' | 'live' | 'hybrid' } = {
      period: p,
      team: w?.team,
      tool: normalizeToolId(w?.tool ?? w?.toolId ?? w?.ide ?? w?.editor ?? 'unknown'),
      // 🔴 CANONICAL MAPPINGS ONLY - Restore legitimate field mappings
      aiAssists: w?.AI_suggestions_accepted ?? w?.aiAssists,
      codingMinutes: w?.AI_usage_duration_minutes ?? w?.active_coding_time_minutes ?? w?.codingMinutes,
      commits: w?.commits_per_session ?? w?.commits,
      // ✅ LEGITIMATE: duration_ms → sessionMinutes (time mapping)
      sessionMinutes: w?.duration_ms ? (w.duration_ms / 60000) : (w?.average_session_length_minutes ?? w?.sessionMinutes),
      // 🔴 CRITICAL: preserve live/sim/hybrid from Dashboards.vue
      source: w?.source ?? 'sim',
    };

    return mapped;
  }).filter(x => !!x.period);
  
  if ((import.meta as any).env?.DEV && result.length > 0) {
    console.debug('[MAPPER] mapProductivityToToolsByGranularity:', {
      granularity,
      inputCount: src.length,
      outputCount: result.length,
      rawSample: src[0],
      mappedSample: result[0],
      uniquePeriods: [...new Set(result.map(r => r.period))],
      uniqueTools: [...new Set(result.map(r => r.tool))],
      sources: [...new Set((result as any[]).map(r => r.source))],
    });
  }
  
  return result;
}

