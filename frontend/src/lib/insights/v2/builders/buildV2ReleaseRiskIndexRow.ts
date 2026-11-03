/**
 * V2 Release Risk Index Insight Builder
 * CFR × MTTR risk calculation for Deploy & Operate stage
 * Risk = CFR_fraction * mttrHours (failure-hours per change proxy)
 */

import type { EngOutputPoint } from '../../types';
import type { V2PreviewRow } from '../types';
import type { V2SessionPrimitiveRow } from '../types';

export function buildV2ReleaseRiskIndexRow(inputs: {
  githubByPeriod: EngOutputPoint[];
  orgLevelMTTR?: number;
  sessionRows?: V2SessionPrimitiveRow[];
}): V2PreviewRow | null {
  // Kill switch: enable by default in DEV
  const PI_DEBUG = (import.meta as any)?.env?.VITE_PI_DEBUG === '1' || import.meta.env.DEV === true;
  const ENABLE_V2_RELEASE_RISK_INDEX = PI_DEBUG;
  
  if (!ENABLE_V2_RELEASE_RISK_INDEX) {
    return null;
  }

  try {
    const { githubByPeriod, orgLevelMTTR } = inputs;
    
    // Validate inputs
    if (!Array.isArray(githubByPeriod) || githubByPeriod.length === 0) {
      return null;
    }

    // Extract valid periods with both CFR and MTTR
    const validPeriods = githubByPeriod.filter(p => 
      typeof p?.changeFailureRatePct === 'number' && p.changeFailureRatePct > 0 &&
      typeof p?.mttrHours === 'number' && p.mttrHours > 0
    );

    // If no MTTR data, try to use orgLevelMTTR fallback
    let periodsToUse = validPeriods;
    let usingFallback = false;
    
    if (validPeriods.length === 0 && orgLevelMTTR && orgLevelMTTR > 0) {
      // Use org-level MTTR as fallback for all periods with CFR data
      periodsToUse = githubByPeriod.filter(p => 
        typeof p?.changeFailureRatePct === 'number' && p.changeFailureRatePct > 0
      ).map(p => ({
        ...p,
        mttrHours: orgLevelMTTR // Inject fallback MTTR
      }));
      usingFallback = true;
    }

    // Insufficient signal check - need at least 2 valid periods
    const insufficientSignal = periodsToUse.length < 2;
    
    if (insufficientSignal) {
      return null;
    }

    // Use last 2-4 valid periods for calculation
    const recentPeriods = periodsToUse.slice(-4); // Take up to 4 most recent
    
    // Calculate risk index for each period
    // Risk tiers: Healthy < 0.10, Mixed 0.10-0.30, Needs attention > 0.30
    const RISK_THRESHOLDS = {
      HEALTHY: 0.10,
      MIXED: 0.30
    } as const;

    const periodRisks = recentPeriods.map(p => {
      const cfrFraction = p.changeFailureRatePct! / 100; // Convert % to fraction
      const risk = cfrFraction * p.mttrHours!;
      return {
        period: p.period,
        cfr: p.changeFailureRatePct!,
        mttr: p.mttrHours!,
        risk
      };
    });

    // Calculate average risk across recent periods
    const avgRisk = periodRisks.reduce((sum, pr) => sum + pr.risk, 0) / periodRisks.length;
    
    // Determine risk tier
    let riskTier: string;
    if (avgRisk < RISK_THRESHOLDS.HEALTHY) {
      riskTier = 'Healthy';
    } else if (avgRisk < RISK_THRESHOLDS.MIXED) {
      riskTier = 'Mixed';
    } else {
      riskTier = 'Needs attention';
    }

    // Calculate trend (compare recent vs older periods)
    let trend = '';
    if (periodRisks.length >= 3) {
      const recent = periodRisks.slice(-2);
      const older = periodRisks.slice(-4, -2);
      if (older.length > 0) {
        const recentAvg = recent.reduce((sum, pr) => sum + pr.risk, 0) / recent.length;
        const olderAvg = older.reduce((sum, pr) => sum + pr.risk, 0) / older.length;
        const change = ((recentAvg - olderAvg) / olderAvg) * 100;
        
        if (Math.abs(change) > 5) { // Only show trend if significant
          const direction = change > 0 ? '↑' : '↓';
          trend = ` (${direction}${Math.abs(Math.round(change))}% vs prior)`;
        }
      }
    }

    // Calculate averages for display
    const avgCFR = recentPeriods.reduce((sum, p) => sum + p.changeFailureRatePct!, 0) / recentPeriods.length;
    const avgMTTR = recentPeriods.reduce((sum, p) => sum + p.mttrHours!, 0) / recentPeriods.length;
    const coveragePct = githubByPeriod.length > 0 
      ? Math.round((periodsToUse.length / githubByPeriod.length) * 100)
      : 0;

    // Build the V2PreviewRow
    const row: V2PreviewRow = {
      // Core identity (required)
      id: 'v2-release-risk-index',
      title: avgRisk > RISK_THRESHOLDS.MIXED 
    ? `Release risk remains elevated${trend}`
    : avgRisk > RISK_THRESHOLDS.HEALTHY
      ? `Release risk remains moderate${trend}`
      : `Release risk remains controlled${trend}`,
      subtitle: `CFR ${avgCFR.toFixed(1)}% × MTTR ${avgMTTR.toFixed(1)}h = ${avgRisk.toFixed(2)}${trend}${usingFallback ? ' (using org MTTR)' : ''}`,
      rightMetric: avgRisk.toFixed(2),
      
      // Stage assignment (required for grouping)
      cicdStage: 'deploy-operate',
      
      // Evidence (required for meaningful display)
      breakdownByTool: {
        'avg_cfr_pct': avgCFR.toFixed(1),
        'avg_mttr_hours': avgMTTR.toFixed(1),
        'risk_index': avgRisk.toFixed(2),
        'risk_tier': riskTier,
        'periods_used': String(recentPeriods.length),
        'coverage_pct': `${coveragePct}%`
      },
      
      // Metadata (required)
      coveragePct,
      n: recentPeriods.length,
      insufficientSignal: false,
      recommendation: avgRisk > RISK_THRESHOLDS.MIXED 
        ? `Critical: High release risk detected (CFR ${avgCFR.toFixed(1)}% × MTTR ${avgMTTR.toFixed(1)}h). Implement automated testing, canary deployments, and incident response procedures.`
        : avgRisk > RISK_THRESHOLDS.HEALTHY
          ? `Moderate release risk. Monitor failure patterns and consider improving deployment automation and monitoring.`
          : `Release risk looks healthy. Maintain current deployment practices and monitoring.`,
      definition: 'Release Risk Index = Change Failure Rate (%) × Mean Time To Recovery (hours). Measures the combination of failure frequency and recovery impact.',
      
      // Optional but useful fields
      details: `Based on ${recentPeriods.length} recent periods with average CFR of ${avgCFR.toFixed(1)}% and MTTR of ${avgMTTR.toFixed(1)}h, resulting in risk index of ${avgRisk.toFixed(2)}.`,
      confidence: coveragePct >= 80 ? 'high' : coveragePct >= 50 ? 'medium' : 'low',
      contributingUnitsCount: recentPeriods.length,
      contributingUnitType: 'periods' as const,
      dataMaturityLabel: 'Measured',
      demoFlag: avgRisk > RISK_THRESHOLDS.MIXED ? 'demo_primary' : avgRisk > RISK_THRESHOLDS.HEALTHY ? 'demo_secondary' : 'demo_hidden',
      displayValue: avgRisk.toFixed(2),
      displayUnit: 'risk-index',
      whatsHappening: avgRisk > RISK_THRESHOLDS.MIXED 
        ? `High release risk: ${avgCFR.toFixed(1)}% of changes fail and take ${avgMTTR.toFixed(1)}h to recover on average.`
        : avgRisk > RISK_THRESHOLDS.HEALTHY
          ? `Moderate release risk: ${avgCFR.toFixed(1)}% failure rate with ${avgMTTR.toFixed(1)}h recovery time.`
          : `Low release risk: ${avgCFR.toFixed(1)}% failure rate with ${avgMTTR.toFixed(1)}h recovery time.`,
      whyItMatters: 'High release risk indicates both frequent failures and slow recovery, which can significantly impact service availability and customer trust.',
    };

    console.log('[V2_ADD_PI][RETURN]', {
      id: 'v2-release-risk-index',
      returned: true,
      insufficientSignal: false,
      avgRisk: avgRisk.toFixed(2),
      riskTier,
      periodCount: recentPeriods.length
    });

    return row;

  } catch (error) {
    console.error('[V2_ADD_PI][ERROR]', {
      id: 'v2-release-risk-index',
      error: error instanceof Error ? error.message : String(error)
    });
    
    // Return insufficient signal row on error
    const errorRow: V2PreviewRow = {
      id: 'v2-release-risk-index',
      title: 'Release Risk Index (Error)',
      subtitle: 'Computation failed - showing fallback',
      rightMetric: '—',
      cicdStage: 'deploy-operate',
      breakdownByTool: { 'org': 'Error' },
      coveragePct: 0,
      n: 0,
      insufficientSignal: true,
      recommendation: 'Check data sources and try again.',
      definition: 'Release Risk Index = CFR × MTTR (error state).',
      details: 'Computation error occurred while calculating release risk index.',
      confidence: 'low',
      contributingUnitsCount: 0,
      contributingUnitType: 'periods',
      dataMaturityLabel: 'Early Signal',
      demoFlag: 'demo_hidden',
      displayValue: '—',
      whatsHappening: 'Error in release risk index computation.',
      whyItMatters: 'Release risk insights unavailable due to error.',
    };

    console.log('[V2_ADD_PI][RETURN]', {
      id: 'v2-release-risk-index',
      returned: true,
      insufficientSignal: true,
      reason: 'error_fallback'
    });

    return errorRow;
  }
}
