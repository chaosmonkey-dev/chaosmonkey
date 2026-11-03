/**
 * V2 First Review Latency Insight Builder
 * Contract-first implementation matching V2PreviewRow type from types.ts
 */

import type { EngOutputPoint } from '../types';
import type { V2PreviewRow } from './types';

export function buildV2FirstReviewLatencyRow(inputs: {
  githubByPeriod: EngOutputPoint[];
}): V2PreviewRow | null {
  // Local debug computation - no global PI_DEBUG dependency
  const PI_DEBUG = (import.meta as any)?.env?.VITE_PI_DEBUG === '1' || import.meta.env.DEV === true;
  const ENABLE_V2_FIRST_REVIEW_LATENCY = PI_DEBUG; // Kill switch
  
  console.log('[V2_ADD_PI][ENTER]', {
    id: 'v2-first-review-latency',
    ghLen: inputs?.githubByPeriod?.length || 0,
    withMetric: inputs?.githubByPeriod?.filter(p => 
      typeof p?.timeToFirstReviewHours === 'number' && p.timeToFirstReviewHours > 0
    ).length || 0
  });

  // Kill switch - return null if disabled
  if (!ENABLE_V2_FIRST_REVIEW_LATENCY) {
    console.log('[V2_ADD_PI][RETURN]', {
      id: 'v2-first-review-latency',
      returned: false,
      reason: 'kill_switch_disabled'
    });
    return null;
  }

  try {
    const { githubByPeriod } = inputs;
    
    // Validate inputs
    if (!Array.isArray(githubByPeriod) || githubByPeriod.length === 0) {
      console.log('[V2_ADD_PI][RETURN]', {
        id: 'v2-first-review-latency',
        returned: false,
        reason: 'no_github_periods'
      });
      return null;
    }

    // Extract valid review latency data
    const validPeriods = githubByPeriod.filter(p => 
      typeof p?.timeToFirstReviewHours === 'number' && p.timeToFirstReviewHours > 0
    );

    // Insufficient signal check
    const insufficientSignal = validPeriods.length < 2;
    
    // Compute metrics
    const avgReviewHours = validPeriods.length > 0 
      ? validPeriods.reduce((sum, p) => sum + p.timeToFirstReviewHours, 0) / validPeriods.length
      : 0;
    
    const avgReviewMinutes = Math.round(avgReviewHours * 60);
    const coveragePct = Math.round((validPeriods.length / githubByPeriod.length) * 100);

    // Build the row matching V2PreviewRow contract
    const row: V2PreviewRow = {
      // Core identity (required)
      id: 'v2-first-review-latency',
      title: insufficientSignal ? 'First Review Latency (Insufficient Data)' : 'First Review Latency',
      subtitle: insufficientSignal 
        ? `Need ≥2 periods with review data, have ${validPeriods.length}`
        : `Average ${avgReviewMinutes} minutes to first review`,
      rightMetric: insufficientSignal ? '--' : `${avgReviewMinutes} min`,
      
      // Stage assignment (required for grouping)
      cicdStage: 'review-merge',
      
      // Evidence (required for meaningful display)
      breakdownByTool: {
        'avg_hours': avgReviewHours.toFixed(1),
        'periods_with_data': String(validPeriods.length),
        'total_periods': String(githubByPeriod.length),
        'coverage_pct': `${coveragePct}%`
      },
      
      // Metadata (required)
      coveragePct,
      n: validPeriods.length,
      insufficientSignal,
      recommendation: insufficientSignal 
        ? 'Add more PR activity to generate review latency insights.'
        : avgReviewMinutes > 240 
          ? 'Consider implementing review SLAs to reduce latency.'
          : 'Review latency looks healthy.',
      definition: 'Time from PR creation to first code review, measuring review responsiveness.',
      
      // Optional but useful fields
      details: insufficientSignal 
        ? `Insufficient data: only ${validPeriods.length} of ${githubByPeriod.length} periods have review latency data.`
        : `Based on ${validPeriods.length} periods with an average of ${avgReviewMinutes} minutes to first review.`,
      confidence: coveragePct >= 80 ? 'high' : coveragePct >= 50 ? 'medium' : 'low',
      contributingUnitsCount: validPeriods.length,
      contributingUnitType: 'periods' as const,
      dataMaturityLabel: insufficientSignal ? 'Early Signal' : 'Measured',
      demoFlag: insufficientSignal ? 'demo_secondary' : 'demo_primary',
      displayValue: insufficientSignal ? '--' : `${avgReviewMinutes} min`,
      displayUnit: 'minutes',
      whatsHappening: insufficientSignal 
        ? `Limited review latency data available (${validPeriods.length} periods).`
        : `Average first review time is ${avgReviewMinutes} minutes across ${validPeriods.length} periods.`,
      whyItMatters: 'Faster reviews improve developer velocity and code quality.',
    };

    console.log('[V2_ADD_PI][RETURN]', {
      id: 'v2-first-review-latency',
      returned: true,
      insufficientSignal,
      avgReviewMinutes,
      coveragePct
    });

    return row;

  } catch (error) {
    console.error('[V2_ADD_PI][BUILDER_ERROR]', {
      id: 'v2-first-review-latency',
      error: error instanceof Error ? error.message : String(error)
    });
    
    // Return insufficient signal row on error
    const errorRow: V2PreviewRow = {
      id: 'v2-first-review-latency',
      title: 'First Review Latency (Error)',
      subtitle: 'Computation failed - showing fallback',
      rightMetric: '--',
      cicdStage: 'review-merge',
      breakdownByTool: { error: 'true' },
      coveragePct: 0,
      n: 0,
      insufficientSignal: true,
      recommendation: 'Check data sources and try again.',
      definition: 'Time from PR creation to first code review (error state).',
      details: 'Computation error occurred while calculating review latency.',
      confidence: 'low',
      contributingUnitsCount: 0,
      contributingUnitType: 'periods',
      dataMaturityLabel: 'Early Signal',
      demoFlag: 'demo_hidden',
      displayValue: '--',
      whatsHappening: 'Error in review latency computation.',
      whyItMatters: 'Review latency insights unavailable due to error.',
    };

    console.log('[V2_ADD_PI][RETURN]', {
      id: 'v2-first-review-latency',
      returned: true,
      insufficientSignal: true,
      reason: 'error_fallback'
    });

    return errorRow;
  }
}
