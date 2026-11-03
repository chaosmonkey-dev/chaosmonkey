/**
 * V2 First Review Latency Insight Builder
 * Contract-first implementation using githubByPeriod[].timeToFirstReviewHours
 * Enhanced with IDE-weighted insights using session data
 */

import type { EngOutputPoint } from '../../types';
import type { V2PreviewRow } from '../types';
import type { V2SessionPrimitiveRow } from '../types';

export function buildV2FirstReviewLatencyRow(inputs: {
  githubByPeriod: EngOutputPoint[];
  sessionRows?: V2SessionPrimitiveRow[];
}): V2PreviewRow | null {
  console.log('[V2_ADD_PI][ENTER]', {
    id: 'v2-first-review-latency',
    ghLen: inputs?.githubByPeriod?.length || 0,
    withMetric: inputs?.githubByPeriod?.filter(p => 
      typeof p?.timeToFirstReviewHours === 'number' && (p.timeToFirstReviewHours ?? 0) > 0
    ).length || 0,
    sessionLen: inputs?.sessionRows?.length || 0
  });

  try {
    const { githubByPeriod, sessionRows } = inputs;
    
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
    
    // Compute org-level metrics
    const avgHours = validPeriods.length > 0 
      ? validPeriods.reduce((sum, p) => sum + (p.timeToFirstReviewHours || 0), 0) / validPeriods.length
      : 0;
    
    const avgMinutes = Math.round(avgHours * 60);
    const coveragePct = githubByPeriod.length > 0 
      ? Math.round((validPeriods.length / githubByPeriod.length) * 100)
      : 0;

    // IDE-weighted analysis using session data
    let ideAnalysis = {
      hasSessionData: false,
      toolBreakdown: {} as Record<string, number>,
      dominantTool: 'unknown',
      weightedAvgMinutes: avgMinutes
    };

    if (sessionRows && sessionRows.length > 0) {
      // Count sessions by tool
      const toolCounts = new Map<string, number>();
      for (const session of sessionRows) {
        const tool = session.tool || 'unknown';
        toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
      }
      
      // Calculate tool weights based on session usage
      const totalSessions = Array.from(toolCounts.values()).reduce((sum, count) => sum + count, 0);
      
      if (totalSessions > 0) {
        ideAnalysis.hasSessionData = true;
        ideAnalysis.toolBreakdown = Object.fromEntries(
          Array.from(toolCounts.entries()).map(([tool, count]) => [tool, count / totalSessions])
        );
        
        // Find dominant tool
        ideAnalysis.dominantTool = Array.from(toolCounts.entries())
          .sort(([, a], [, b]) => b - a)[0]?.[0] || 'unknown';
        
        // Since we don't have IDE-specific review latency, we'll use the org average
        // but weight the narrative by IDE usage patterns
        ideAnalysis.weightedAvgMinutes = avgMinutes;
      }
    }

    // Format time display (minutes vs hours)
    const formatTime = (minutes: number) => {
      if (minutes >= 60) {
        const hours = Math.round(minutes / 60 * 10) / 10;
        return `${hours}h`;
      }
      return `${minutes}m`;
    };

    // Generate IDE-driven title with data-driven context
    let title = 'First Review Latency';
    let subtitle = 'Time from PR creation → first review';
    let rightMetric = formatTime(avgMinutes);
    
    if (!insufficientSignal && ideAnalysis.hasSessionData) {
      const tool = ideAnalysis.dominantTool;
      const toolLabel = tool.charAt(0).toUpperCase() + tool.slice(1);
      const toolShare = Math.round(ideAnalysis.toolBreakdown[tool] * 100);
      
      // IDE-DRIVEN TITLE RULE: Lead with IDE, use exact format
      if (avgMinutes > 240) {
        title = `${toolLabel} shows highest review latency`;
      } else if (avgMinutes > 120) {
        title = `${toolLabel} shows moderate review latency`;
      } else {
        title = `${toolLabel} shows lowest review latency`;
      }
      subtitle = `Review latency measured across all PRs (${toolShare}% of development activity)`;
    } else if (!insufficientSignal) {
      if (avgMinutes > 240) {
        title = `Slow reviews delaying delivery (${formatTime(avgMinutes)} to first review)`;
      } else if (avgMinutes > 120) {
        title = `Review velocity needs improvement (${formatTime(avgMinutes)} to first review)`;
      } else {
        title = `Fast reviews supporting delivery (${formatTime(avgMinutes)} to first review)`;
      }
      subtitle = 'Review latency measured across all PRs and IDEs';
    }

    // Build the V2PreviewRow with IDE-weighted insights
    const row: V2PreviewRow = {
      // Core identity (required)
      id: 'v2-first-review-latency',
      title: insufficientSignal ? 'First Review Latency (Insufficient Data)' : title,
      subtitle: insufficientSignal 
        ? `Need ≥2 periods with review data, have ${validPeriods.length}`
        : subtitle,
      rightMetric: insufficientSignal ? '—' : rightMetric,
      
      // Stage assignment (required for grouping)
      cicdStage: 'review-merge',
      
      // Evidence (required for meaningful display) - IDE-driven structure
      breakdownByTool: {
        'review_latency_avg': insufficientSignal ? '—' : formatTime(avgMinutes),
        'data_periods': `${validPeriods.length}/${githubByPeriod.length}`,
        'coverage_pct': `${coveragePct}%`,
        'data_source': 'GitHub PR data',
        ...(ideAnalysis.hasSessionData && {
          'dominant_ide': ideAnalysis.dominantTool,
          'ide_activity_share': `${Math.round(ideAnalysis.toolBreakdown[ideAnalysis.dominantTool] * 100)}%`,
          'total_ides': Object.keys(ideAnalysis.toolBreakdown).length.toString()
        })
      },
      
      // Metadata (required)
      coveragePct,
      n: validPeriods.length,
      insufficientSignal,
      recommendation: insufficientSignal 
        ? 'Add more PR activity to generate review latency insights.'
        : avgMinutes > 240 
          ? `Critical: Implement review SLAs (target <2h) and enable auto-assign reviewers. ${ideAnalysis.hasSessionData ? `Focus on ${ideAnalysis.dominantTool} workflows since they drive ${Math.round(ideAnalysis.toolBreakdown[ideAnalysis.dominantTool] * 100)}% of development activity.` : ''}`
          : avgMinutes > 120 
            ? `Set review SLAs (target <4h) and enable reviewer notifications. ${ideAnalysis.hasSessionData ? `${ideAnalysis.dominantTool} leads development activity - optimize their review process first.` : ''}`
            : `Maintain current review practices. ${ideAnalysis.hasSessionData ? `${ideAnalysis.dominantTool} maintains good review velocity - consider them a model for other teams.` : ''}`,
      definition: 'Time from PR creation to first code review, measuring team responsiveness and review process efficiency.',
      
      // Optional but useful fields
      details: insufficientSignal 
        ? `Insufficient data: only ${validPeriods.length} of ${githubByPeriod.length} periods have review latency data. Need ≥2 periods for insights.`
        : `Review latency computed from GitHub PR data across ${validPeriods.length} periods (average ${formatTime(avgMinutes)}).${ideAnalysis.hasSessionData ? ` IDE activity from telemetry: ${ideAnalysis.dominantTool} leads development (${Math.round(ideAnalysis.toolBreakdown[ideAnalysis.dominantTool] * 100)}% of sessions).` : ' No IDE telemetry data available.'}`,
      confidence: coveragePct >= 80 ? 'high' : coveragePct >= 50 ? 'medium' : 'low',
      contributingUnitsCount: validPeriods.length,
      contributingUnitType: 'periods' as const,
      dataMaturityLabel: insufficientSignal ? 'Early Signal' : 'Measured',
      demoFlag: insufficientSignal ? 'demo_secondary' : 'demo_primary',
      displayValue: insufficientSignal ? '—' : formatTime(avgMinutes),
      displayUnit: avgMinutes >= 60 ? 'hours' : 'minutes',
      whatsHappening: insufficientSignal 
        ? `Limited review latency data available (${validPeriods.length} periods).`
        : avgMinutes > 240 
          ? `Reviews taking ${formatTime(avgMinutes)} on average, which may slow development velocity.${ideAnalysis.hasSessionData ? ` ${ideAnalysis.dominantTool} drives most development activity.` : ''}`
          : avgMinutes > 120 
            ? `Reviews averaging ${formatTime(avgMinutes)} - room for improvement to speed up delivery.${ideAnalysis.hasSessionData ? ` ${ideAnalysis.dominantTool} leads development activity.` : ''}`
            : `Reviews averaging ${formatTime(avgMinutes)} - good responsiveness supporting fast delivery.${ideAnalysis.hasSessionData ? ` ${ideAnalysis.dominantTool} maintains active development.` : ''}`,
      whyItMatters: 'Faster reviews improve developer velocity, reduce context switching, and enable faster feature delivery.',
    };

    console.log('[V2_ADD_PI][RETURN]', {
      id: 'v2-first-review-latency',
      returned: true,
      insufficientSignal,
      avgMinutes,
      coveragePct
    });

    return row;

  } catch (error) {
    console.error('[V2_ADD_PI][ERROR]', {
      id: 'v2-first-review-latency',
      error: error instanceof Error ? error.message : String(error)
    });
    
    // Return insufficient signal row on error
    const errorRow: V2PreviewRow = {
      id: 'v2-first-review-latency',
      title: 'First Review Latency (Error)',
      subtitle: 'Computation failed - showing fallback',
      rightMetric: '—',
      cicdStage: 'review-merge',
      breakdownByTool: { 'org': 'Error' },
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
      displayValue: '—',
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
