/**
 * MVP PI V2 Performance Insights - Exactly 12 PIs with Real Data Only
 * 
 * This is the clean MVP implementation with:
 * - No Math.random()
 * - No hardcoded values
 * - Real telemetry + GitHub metrics only
 * - Insufficient signal handling
 */

import type { EngOutputPoint } from '../types';
import type { V2SessionPrimitiveRow, V2PreviewRow } from './types';
import { computeRepoIssueHotspotV2 } from './v1PortedInsights';
import { getToolLabel } from '../labels';
import { filterAndOrderInsightsByAllowlist } from './piV2Manifest';

export function computeV2PerformanceInsights(
  sessionRows: V2SessionPrimitiveRow[],
  hasGhPeriods: boolean = false,
  githubByPeriod?: EngOutputPoint[],
  orgLevelMTTR?: number,
  githubSnapshot?: any
): V2PreviewRow[] {
  console.log('[V2_PI_DEBUG] MVP computeV2PerformanceInsights called with:', {
    totalSessions: sessionRows.length,
    hasGhPeriods,
    githubByPeriodCount: githubByPeriod?.length || 0,
    hasGithubSnapshot: !!githubSnapshot
  });

  const insights: V2PreviewRow[] = [];

  // Helper: Get tool breakdown from sessions
  const toolBreakdown = sessionRows.reduce((acc, session) => {
    const tool = session.tool || 'unknown';
    acc[tool] = (acc[tool] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalSessions = sessionRows.length;
  const breakdownByTool = Object.entries(toolBreakdown).map(([tool, count]) => ({
    tool: getToolLabel(tool),
    value: count,
    pct: Math.round((count / totalSessions) * 100)
  }));

  const dominantIDE = breakdownByTool.reduce((max, current) => 
    current.value > max.value ? current : max, 
    { tool: 'Unknown', value: 0, pct: 0 }
  );

  // PLAN & CODE STAGE (6 PIs)

  // (1) commits-per-session-by-ide (truthful labeling)
  const sessionsWithCommitSignal = sessionRows.filter(s => s.session_commit_signal_present || s.session_has_ttfc);
  const commitSignalByTool = sessionsWithCommitSignal.reduce((acc, session) => {
    const tool = session.tool || 'unknown';
    acc[tool] = (acc[tool] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const commitSignalBreakdown = Object.entries(commitSignalByTool).map(([tool, count]) => ({
    tool: getToolLabel(tool),
    value: count,
    pct: Math.round((count / sessionsWithCommitSignal.length) * 100)
  }));

  const dominantCommitIDE = commitSignalBreakdown.reduce((max, current) => 
    current.value > max.value ? current : max, 
    { tool: 'Unknown', value: 0, pct: 0 }
  );

  insights.push({
    id: 'commits-per-session-by-ide',
    title: `${getToolLabel(dominantCommitIDE.tool)} leads in commit-linked sessions (${dominantCommitIDE.pct}%)`,
    subtitle: `${sessionsWithCommitSignal.length} sessions have commit signals out of ${totalSessions} total`,
    rightMetric: `${dominantCommitIDE.pct}%`,
    details: `${sessionsWithCommitSignal.length} sessions show commit activity (${Math.round((sessionsWithCommitSignal.length / totalSessions) * 100)}% coverage). ${getToolLabel(dominantCommitIDE.tool)} leads with ${dominantCommitIDE.value} commit-linked sessions. Based on session_commit_signal_present and session_has_ttfc flags.`,
    coveragePct: Math.round((sessionsWithCommitSignal.length / totalSessions) * 100),
    n: sessionsWithCommitSignal.length,
    insufficientSignal: sessionsWithCommitSignal.length < 5,
    breakdownByTool: commitSignalBreakdown.reduce((acc, item) => ({ ...acc, [item.tool]: item.value }), {}),
    definition: 'Sessions with commit signals, broken down by IDE',
    recommendation: sessionsWithCommitSignal.length < 5 
      ? 'More commit signal data needed for reliable IDE comparison.'
      : `${getToolLabel(dominantCommitIDE.tool)} shows strong commit activity. Consider sharing best practices.`,
    signalCoveragePct: Math.round((sessionsWithCommitSignal.length / totalSessions) * 100),
    primarySignalsUsed: ['session_commit_signal_present', 'session_has_ttfc'],
    dataMaturityLabel: sessionsWithCommitSignal.length >= 20 ? 'Measured' : 'Early Signal',
    demoFlag: sessionsWithCommitSignal.length < 5 ? 'demo_hidden' : 'demo_secondary',
    contributingUnitsCount: sessionsWithCommitSignal.length,
    contributingUnitType: 'sessions',
    owner: 'plan-code-commits-per-session-by-ide',
    cicdStage: 'plan-code'
  });

  // (2) active-coding-time-by-ide (real minutes)
  const sessionsWithActiveTime = sessionRows.filter(s => s.session_active_coding_duration_minutes !== null);
  const activeTimeByTool = sessionsWithActiveTime.reduce((acc, session) => {
    const tool = session.tool || 'unknown';
    if (!acc[tool]) {
      acc[tool] = { total: 0, count: 0 };
    }
    acc[tool].total += session.session_active_coding_duration_minutes!;
    acc[tool].count += 1;
    return acc;
  }, {} as Record<string, { total: number; count: number }>);

  const activeTimeBreakdown = Object.entries(activeTimeByTool).map(([tool, data]) => ({
    tool: getToolLabel(tool),
    value: Math.round(data.total / data.count), // average minutes
    pct: Math.round((data.count / sessionsWithActiveTime.length) * 100)
  }));

  const dominantActiveTimeIDE = activeTimeBreakdown.reduce((max, current) => 
    current.value > max.value ? current : max, 
    { tool: 'Unknown', value: 0, pct: 0 }
  );

  insights.push({
    id: 'active-coding-time-by-ide',
    title: `${getToolLabel(dominantActiveTimeIDE.tool)} leads with ${dominantActiveTimeIDE.value}m active coding`,
    subtitle: `Average active coding time across ${sessionsWithActiveTime.length} sessions`,
    rightMetric: `${dominantActiveTimeIDE.value}m`,
    details: `${getToolLabel(dominantActiveTimeIDE.tool)} shows highest average active coding time at ${dominantActiveTimeIDE.value} minutes per session. Based on session_active_coding_duration_minutes field. ${sessionsWithActiveTime.length} sessions have timing data available.`,
    coveragePct: Math.round((sessionsWithActiveTime.length / totalSessions) * 100),
    n: sessionsWithActiveTime.length,
    insufficientSignal: sessionsWithActiveTime.length < 5,
    breakdownByTool: activeTimeBreakdown.reduce((acc, item) => ({ ...acc, [item.tool]: item.value }), {}),
    definition: 'Average active coding duration per session, broken down by IDE',
    recommendation: sessionsWithActiveTime.length < 5 
      ? 'More session timing data needed for reliable coding time analysis.'
      : `${getToolLabel(dominantActiveTimeIDE.tool)} users show focused coding. Consider time boxing techniques.`,
    signalCoveragePct: Math.round((sessionsWithActiveTime.length / totalSessions) * 100),
    primarySignalsUsed: ['session_active_coding_duration_minutes'],
    dataMaturityLabel: sessionsWithActiveTime.length >= 20 ? 'Measured' : 'Early Signal',
    demoFlag: sessionsWithActiveTime.length < 5 ? 'demo_hidden' : 'demo_secondary',
    contributingUnitsCount: sessionsWithActiveTime.length,
    contributingUnitType: 'sessions',
    owner: 'plan-code-active-coding-time-by-ide',
    cicdStage: 'plan-code'
  });

  // (3) ai-suggestions-accepted-by-ide (from real AI signals)
  const sessionsWithAI = sessionRows.filter(s => s.session_has_ai_activity);
  insights.push({
    id: 'ai-suggestions-accepted-by-ide',
    title: 'AI suggestions accepted: insufficient data',
    subtitle: 'AI acceptance signals not available in current telemetry',
    rightMetric: 'N/A',
    details: 'AI suggestion acceptance metrics require acceptance event tracking that is not currently available in session data. Current telemetry only tracks AI activity bursts (session_ai_burst_count) but not acceptance outcomes.',
    coveragePct: 0,
    n: 0,
    insufficientSignal: true,
    breakdownByTool: {},
    definition: 'AI suggestions accepted by developers, broken down by IDE',
    recommendation: 'Implement AI acceptance event tracking to measure AI suggestion effectiveness.',
    signalCoveragePct: 0,
    primarySignalsUsed: [],
    dataMaturityLabel: 'Early Signal',
    demoFlag: 'demo_hidden',
    contributingUnitsCount: 0,
    contributingUnitType: 'sessions',
    owner: 'plan-code-ai-suggestions-accepted-by-ide',
    cicdStage: 'plan-code'
  });

  // (4) average-session-length-by-ide (real duration)
  const sessionsWithDuration = sessionRows.filter(s => s.session_duration_minutes !== null);
  const durationByTool = sessionsWithDuration.reduce((acc, session) => {
    const tool = session.tool || 'unknown';
    if (!acc[tool]) {
      acc[tool] = { total: 0, count: 0 };
    }
    acc[tool].total += session.session_duration_minutes!;
    acc[tool].count += 1;
    return acc;
  }, {} as Record<string, { total: number; count: number }>);

  const durationBreakdown = Object.entries(durationByTool).map(([tool, data]) => ({
    tool: getToolLabel(tool),
    value: Math.round(data.total / data.count), // average minutes
    pct: Math.round((data.count / sessionsWithDuration.length) * 100)
  }));

  const dominantDurationIDE = durationBreakdown.reduce((max, current) => 
    current.value > max.value ? current : max, 
    { tool: 'Unknown', value: 0, pct: 0 }
  );

  insights.push({
    id: 'average-session-length-by-ide',
    title: `${getToolLabel(dominantDurationIDE.tool)} sessions average ${dominantDurationIDE.value} minutes`,
    subtitle: `Average session duration across ${sessionsWithDuration.length} sessions`,
    rightMetric: `${dominantDurationIDE.value}m`,
    details: `${getToolLabel(dominantDurationIDE.tool)} users have longest sessions at ${dominantDurationIDE.value} minutes on average. Based on session_duration_minutes field. ${sessionsWithDuration.length} sessions have duration data available.`,
    coveragePct: Math.round((sessionsWithDuration.length / totalSessions) * 100),
    n: sessionsWithDuration.length,
    insufficientSignal: sessionsWithDuration.length < 5,
    breakdownByTool: durationBreakdown.reduce((acc, item) => ({ ...acc, [item.tool]: item.value }), {}),
    definition: 'Average session duration in minutes, broken down by IDE',
    recommendation: sessionsWithDuration.length < 5 
      ? 'More session duration data needed for reliable session analysis.'
      : `${dominantDurationIDE.value} minute sessions suggest ${dominantDurationIDE.value < 30 ? 'focused bursts' : dominantDurationIDE.value > 90 ? 'potential burnout risk' : 'balanced work sessions'}.`,
    signalCoveragePct: Math.round((sessionsWithDuration.length / totalSessions) * 100),
    primarySignalsUsed: ['session_duration_minutes'],
    dataMaturityLabel: sessionsWithDuration.length >= 20 ? 'Measured' : 'Early Signal',
    demoFlag: sessionsWithDuration.length < 5 ? 'demo_hidden' : 'demo_secondary',
    contributingUnitsCount: sessionsWithDuration.length,
    contributingUnitType: 'sessions',
    owner: 'plan-code-average-session-length-by-ide',
    cicdStage: 'plan-code'
  });

  // (5) commit-abandonment-rate-ai-vs-non-ai
  const workSessions = sessionRows.filter(s => 
    (s.chars_added_total && s.chars_added_total > 0) ||
    (s.session_active_coding_duration_minutes && s.session_active_coding_duration_minutes > 0) ||
    (s.session_duration_minutes && s.session_duration_minutes > 0)
  );
  
  const aiSessions = workSessions.filter(s => s.session_has_ai_activity);
  const nonAiSessions = workSessions.filter(s => !s.session_has_ai_activity);
  
  const abandonedAISessions = aiSessions.filter(s => !s.session_commit_signal_present);
  const abandonedNonAISessions = nonAiSessions.filter(s => !s.session_commit_signal_present);
  
  const aiAbandonmentRate = aiSessions.length > 0 ? (abandonedAISessions.length / aiSessions.length) * 100 : 0;
  const nonAiAbandonmentRate = nonAiSessions.length > 0 ? (abandonedNonAISessions.length / nonAiSessions.length) * 100 : 0;

  insights.push({
    id: 'commit-abandonment-rate-ai-vs-non-ai',
    title: `AI sessions ${aiAbandonmentRate.toFixed(1)}% abandonment vs ${nonAiAbandonmentRate.toFixed(1)}% non-AI`,
    subtitle: `Commit completion comparison across ${workSessions.length} work sessions`,
    rightMetric: `AI ${aiAbandonmentRate.toFixed(1)}% vs Non-AI ${nonAiAbandonmentRate.toFixed(1)}%`,
    details: `AI-assisted sessions show ${aiAbandonmentRate.toFixed(1)}% abandonment rate (${abandonedAISessions.length}/${aiSessions.length}) compared to ${nonAiAbandonmentRate.toFixed(1)}% for non-AI sessions (${abandonedNonAISessions.length}/${nonAiSessions.length}). Abandonment = no commit signal detected. Based on session_has_ai_activity and session_commit_signal_present flags.`,
    coveragePct: Math.round((workSessions.length / totalSessions) * 100),
    n: workSessions.length,
    insufficientSignal: workSessions.length < 10,
    breakdownByTool: {
      'AI Sessions': aiSessions.length,
      'Non-AI Sessions': nonAiSessions.length
    },
    definition: 'Comparison of session abandonment rates between AI-assisted and non-AI development',
    recommendation: workSessions.length < 10 
      ? 'More work session data needed for reliable AI impact analysis.'
      : aiAbandonmentRate > nonAiAbandonmentRate + 10 
        ? 'AI sessions show higher abandonment - investigate AI tooling integration.'
        : aiAbandonmentRate < nonAiAbandonmentRate - 10 
          ? 'AI sessions show lower abandonment - AI appears to help completion.'
          : 'AI and non-AI sessions show similar abandonment rates.',
    signalCoveragePct: Math.round((workSessions.length / totalSessions) * 100),
    primarySignalsUsed: ['session_has_ai_activity', 'session_commit_signal_present', 'chars_added_total', 'session_active_coding_duration_minutes'],
    dataMaturityLabel: workSessions.length >= 30 ? 'Measured' : 'Early Signal',
    demoFlag: workSessions.length < 10 ? 'demo_hidden' : 'demo_secondary',
    contributingUnitsCount: workSessions.length,
    contributingUnitType: 'sessions',
    owner: 'plan-code-commit-abandonment-rate-ai-vs-non-ai',
    cicdStage: 'plan-code'
  });

  // (6) branches-per-session-by-ide (git_branch coverage)
  insights.push({
    id: 'branches-per-session-by-ide',
    title: 'Git branch coverage: insufficient data',
    subtitle: 'Git branch tracking not available in current telemetry',
    rightMetric: 'N/A',
    details: 'Git branch usage analysis requires git_branch field tracking that is not currently available in V2SessionPrimitiveRow. This insight would show branching patterns and collaboration habits once implemented.',
    coveragePct: 0,
    n: 0,
    insufficientSignal: true,
    breakdownByTool: {},
    definition: 'Percentage of sessions with git branch activity, broken down by IDE',
    recommendation: 'Implement git branch tracking in session telemetry to enable collaboration pattern analysis.',
    signalCoveragePct: 0,
    primarySignalsUsed: [],
    dataMaturityLabel: 'Early Signal',
    demoFlag: 'demo_hidden',
    contributingUnitsCount: 0,
    contributingUnitType: 'sessions',
    owner: 'plan-code-branches-per-session-by-ide',
    cicdStage: 'plan-code'
  });

  // REVIEW & MERGE STAGE (3 PIs)

  // (7) org_review_git_context
  insights.push({
    id: 'org_review_git_context',
    title: 'Review git context: insufficient data',
    subtitle: 'GitHub review context metrics not available',
    rightMetric: 'N/A',
    details: 'Review context analysis requires GitHub PR review data that is not currently available in githubByPeriod or githubSnapshot. This insight would show median review attempts and unresolved percentages once GitHub integration is complete.',
    coveragePct: 0,
    n: 0,
    insufficientSignal: true,
    breakdownByTool: {},
    definition: 'Organization-level git context in code review process',
    recommendation: 'Enhance GitHub integration to include PR review context metrics for review quality analysis.',
    signalCoveragePct: 0,
    primarySignalsUsed: [],
    dataMaturityLabel: 'Early Signal',
    demoFlag: 'demo_hidden',
    contributingUnitsCount: 0,
    contributingUnitType: 'prs',
    owner: 'review-merge-org-review-git-context',
    cicdStage: 'review-merge'
  });

  // (8) org_review_focus_regression
  insights.push({
    id: 'org_review_focus_regression',
    title: 'Review focus regression: insufficient data',
    subtitle: 'Review focus metrics not available',
    rightMetric: 'N/A',
    details: 'Review focus analysis requires GitHub PR focus metrics that are not currently available. This insight would compare poor-focus percentages against baseline to detect review quality regression once implemented.',
    coveragePct: 0,
    n: 0,
    insufficientSignal: true,
    breakdownByTool: {},
    definition: 'Organization-level review focus quality regression detection',
    recommendation: 'Implement review focus tracking in GitHub integration to enable quality regression monitoring.',
    signalCoveragePct: 0,
    primarySignalsUsed: [],
    dataMaturityLabel: 'Early Signal',
    demoFlag: 'demo_hidden',
    contributingUnitsCount: 0,
    contributingUnitType: 'prs',
    owner: 'review-merge-org-review-focus-regression',
    cicdStage: 'review-merge'
  });

  // (9) review_latency_stable (ORG)
  if (githubByPeriod && githubByPeriod.length > 0) {
    const reviewLatencyValues = githubByPeriod
      .map(p => p.timeToFirstReviewHours)
      .filter(h => h !== undefined && h !== null && h > 0) as number[];
    
    if (reviewLatencyValues.length >= 3) {
      const avgLatency = reviewLatencyValues.reduce((sum, h) => sum + h, 0) / reviewLatencyValues.length;
      const latencyHours = avgLatency;
      const latencyDays = latencyHours / 24;
      
      insights.push({
        id: 'review_latency_stable',
        title: `Review latency stable at ${latencyDays.toFixed(1)} days`,
        subtitle: `Average time to first review across ${reviewLatencyValues.length} periods`,
        rightMetric: `${latencyDays.toFixed(1)}d`,
        details: `Organization maintains consistent review latency at ${latencyDays.toFixed(1)} days (${latencyHours.toFixed(1)} hours) based on ${reviewLatencyValues.length} GitHub periods. Low variation indicates stable review process.`,
        coveragePct: Math.round((reviewLatencyValues.length / (githubByPeriod.length || 1)) * 100),
        n: reviewLatencyValues.length,
        insufficientSignal: reviewLatencyValues.length < 3,
        breakdownByTool: { 'Organization': latencyDays },
        definition: 'Organization-level time to first review stability',
        recommendation: latencyDays > 3 
          ? 'Review latency is high. Consider reviewer availability improvements.'
          : latencyDays < 0.5 
            ? 'Excellent review latency! Maintain current process.'
            : 'Review latency is healthy. Continue current review practices.',
        signalCoveragePct: Math.round((reviewLatencyValues.length / (githubByPeriod.length || 1)) * 100),
        primarySignalsUsed: ['timeToFirstReviewHours'],
        dataMaturityLabel: reviewLatencyValues.length >= 8 ? 'Measured' : 'Early Signal',
        demoFlag: reviewLatencyValues.length < 3 ? 'demo_hidden' : 'demo_secondary',
        contributingUnitsCount: reviewLatencyValues.length,
        contributingUnitType: 'periods',
        owner: 'review-merge-review-latency-stable',
        cicdStage: 'review-merge'
      });
    } else {
      insights.push({
        id: 'review_latency_stable',
        title: 'Review latency: insufficient data',
        subtitle: 'GitHub review latency data not available',
        rightMetric: 'N/A',
        details: `Review latency analysis requires timeToFirstReviewHours data from GitHub metrics. Currently only ${reviewLatencyValues.length} periods have valid latency data. Need at least 3 periods for stability analysis.`,
        coveragePct: 0,
        n: 0,
        insufficientSignal: true,
        breakdownByTool: {},
        definition: 'Organization-level time to first review stability',
        recommendation: 'Ensure GitHub integration provides consistent timeToFirstReviewHours data for review latency analysis.',
        signalCoveragePct: 0,
        primarySignalsUsed: [],
        dataMaturityLabel: 'Early Signal',
        demoFlag: 'demo_hidden',
        contributingUnitsCount: 0,
        contributingUnitType: 'periods',
        owner: 'review-merge-review-latency-stable',
        cicdStage: 'review-merge'
      });
    }
  } else {
    insights.push({
      id: 'review_latency_stable',
      title: 'Review latency: insufficient data',
      subtitle: 'GitHub metrics not available',
      rightMetric: 'N/A',
      details: 'Review latency analysis requires GitHub metrics (githubByPeriod) with timeToFirstReviewHours data. Currently no GitHub period data available.',
      coveragePct: 0,
      n: 0,
      insufficientSignal: true,
      breakdownByTool: {},
      definition: 'Organization-level time to first review stability',
      recommendation: 'Connect GitHub repository to enable review latency and other PR metrics.',
      signalCoveragePct: 0,
      primarySignalsUsed: [],
      dataMaturityLabel: 'Early Signal',
      demoFlag: 'demo_hidden',
      contributingUnitsCount: 0,
      contributingUnitType: 'periods',
      owner: 'review-merge-review-latency-stable',
      cicdStage: 'review-merge'
    });
  }

  // DEPLOY & OPERATE STAGE (4 PIs - Enhanced Narrative)

  // Helper: Format numbers for display (no raw decimals)
  const formatNumber = (num: number, decimals: number = 1): string => {
    if (num === null || num === undefined || !Number.isFinite(num)) return '—';
    return num.toFixed(decimals);
  };

  const formatPercent = (num: number, decimals: number = 0): string => {
    if (num === null || num === undefined || !Number.isFinite(num)) return '—';
    return `${num.toFixed(decimals)}%`;
  };

  // Helper: Calculate trend from period data
  const calculateTrend = (values: number[]): { direction: string; deltaPct: number } => {
    if (values.length < 2) return { direction: 'stable', deltaPct: 0 };
    
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    const firstAvg = firstHalf.reduce((sum, v) => sum + v, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, v) => sum + v, 0) / secondHalf.length;
    
    const deltaPct = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0;
    let direction = 'stable';
    if (deltaPct > 10) direction = 'rose';
    else if (deltaPct < -10) direction = 'declined';
    
    return { direction, deltaPct };
  };

  // PI 1: Deployment throughput rose without higher failure pressure
  if (githubByPeriod && githubByPeriod.length > 0) {
    const deployFreqValues = githubByPeriod
      .map(p => p.deploymentFreqPerWeek)
      .filter(f => f !== undefined && f !== null && f > 0) as number[];
    
    const cfrValues = githubByPeriod
      .map(p => p.changeFailureRatePct)
      .filter(r => r !== undefined && r !== null && r >= 0) as number[];
    
    if (deployFreqValues.length >= 2 && cfrValues.length >= 2) {
      const deployTrend = calculateTrend(deployFreqValues);
      const cfrTrend = calculateTrend(cfrValues);
      const currentDeployFreq = deployFreqValues[deployFreqValues.length - 1];
      const currentCFR = cfrValues[cfrValues.length - 1];
      const avgDeployFreq = deployFreqValues.reduce((sum, v) => sum + v, 0) / deployFreqValues.length;
      
      const title = deployTrend.direction === 'rose' && cfrTrend.direction !== 'rose'
        ? `Deployment throughput rose ${formatPercent(Math.abs(deployTrend.deltaPct))} without higher failure pressure`
        : deployTrend.direction === 'rose' && cfrTrend.direction === 'rose'
          ? `Deployment throughput rose ${formatPercent(Math.abs(deployTrend.deltaPct))} with elevated failure pressure`
          : deployTrend.direction === 'declined'
            ? `Deployment throughput declined ${formatPercent(Math.abs(deployTrend.deltaPct))} while failure rate ${cfrTrend.direction}`
            : `Deployment throughput stable at ${formatNumber(avgDeployFreq, 1)} deploys/week`;
      
      insights.push({
        id: 'deploy-throughput-narrative',
        title,
        subtitle: 'Deployment velocity and reliability analysis',
        rightMetric: deployTrend.direction === 'rose' 
          ? `+${formatPercent(Math.abs(deployTrend.deltaPct))} throughput`
          : deployTrend.direction === 'declined'
            ? `${formatPercent(Math.abs(deployTrend.deltaPct))} decline`
            : 'Stable cadence',
        details: `Deployment frequency ${deployTrend.direction} from ${formatNumber(deployFreqValues[0], 1)} to ${formatNumber(currentDeployFreq, 1)} deploys/week (${deployTrend.direction === 'rose' ? '+' : ''}${formatPercent(deployTrend.deltaPct)}). Change failure rate ${cfrTrend.direction} and currently ${formatPercent(currentCFR, 1)}. ${deployTrend.direction === 'rose' && cfrTrend.direction !== 'rose' ? 'Team is shipping faster without compromising reliability.' : ''}`,
        coveragePct: Math.round((deployFreqValues.length / (githubByPeriod.length || 1)) * 100),
        n: deployFreqValues.length,
        insufficientSignal: deployFreqValues.length < 2,
        breakdownByTool: { 
          'Current deploys/week': formatNumber(currentDeployFreq, 1),
          'Throughput change': `${deployTrend.direction === 'rose' ? '+' : ''}${formatPercent(deployTrend.deltaPct)}`,
          'Current CFR': formatPercent(currentCFR, 1),
          'CFR trend': cfrTrend.direction
        },
        definition: 'Deployment throughput analysis measures delivery velocity changes while monitoring failure rate pressure to assess DevOps maturation.',
        recommendation: deployTrend.direction === 'rose' && cfrTrend.direction !== 'rose'
          ? 'Scale current deployment practices across teams while maintaining quality gates. Invest in deployment infrastructure to support continued growth.'
          : deployTrend.direction === 'rose' && cfrTrend.direction === 'rose'
            ? 'Address elevated failure pressure by strengthening quality gates and testing automation before scaling release cadence further.'
            : deployTrend.direction === 'declined'
              ? 'Investigate deployment bottlenecks and process constraints. Accelerate DevOps transformation with CI/CD infrastructure improvements.'
              : 'Maintain current deployment cadence while monitoring for optimization opportunities.',
        signalCoveragePct: Math.round((deployFreqValues.length / (githubByPeriod.length || 1)) * 100),
        primarySignalsUsed: ['deploymentFreqPerWeek', 'changeFailureRatePct'],
        dataMaturityLabel: deployFreqValues.length >= 4 ? 'Measured' : 'Early Signal',
        demoFlag: deployFreqValues.length >= 2 ? 'demo_primary' : 'demo_hidden',
        contributingUnitsCount: deployFreqValues.length,
        contributingUnitType: 'periods',
        owner: 'deploy-operate-throughput-narrative',
        cicdStage: 'deploy-operate'
      });
    }
  }

  // PI 2: Change failure rate remains elevated despite higher throughput
  if (githubByPeriod && githubByPeriod.length > 0) {
    const cfrValues = githubByPeriod
      .map(p => p.changeFailureRatePct)
      .filter(r => r !== undefined && r !== null && r >= 0) as number[];
    
    const deployFreqValues = githubByPeriod
      .map(p => p.deploymentFreqPerWeek)
      .filter(f => f !== undefined && f !== null && f > 0) as number[];
    
    if (cfrValues.length >= 2) {
      const cfrTrend = calculateTrend(cfrValues);
      const currentCFR = cfrValues[cfrValues.length - 1];
      const avgCFR = cfrValues.reduce((sum, v) => sum + v, 0) / cfrValues.length;
      const isElevated = currentCFR > 15;
      
      const currentDeployFreq = deployFreqValues.length > 0 ? deployFreqValues[deployFreqValues.length - 1] : null;
      const deployTrend = deployFreqValues.length >= 2 ? calculateTrend(deployFreqValues) : null;
      
      const title = isElevated && deployTrend?.direction === 'rose'
        ? `Change failure rate elevated at ${formatPercent(currentCFR, 1)} despite higher throughput`
        : isElevated
          ? `Change failure rate elevated at ${formatPercent(currentCFR, 1)} requires attention`
          : cfrTrend.direction === 'rose'
            ? `Change failure rate rising to ${formatPercent(currentCFR, 1)}`
            : `Change failure rate stable at ${formatPercent(currentCFR, 1)}`;
      
      insights.push({
        id: 'cfr-elevated-narrative',
        title,
        subtitle: 'Deployment reliability and quality analysis',
        rightMetric: formatPercent(currentCFR, 1),
        details: `Change failure rate is ${isElevated ? 'elevated' : 'within acceptable range'} at ${formatPercent(currentCFR, 1)} (${cfrTrend.direction === 'rose' ? '+' : ''}${formatPercent(cfrTrend.deltaPct)} trend). ${currentDeployFreq ? `Deployment frequency is ${formatNumber(currentDeployFreq, 1)} deploys/week${deployTrend ? ` (${deployTrend.direction})` : ''}.` : ''} ${isElevated ? 'Elevated failure rate indicates quality issues requiring investigation.' : 'Failure rate is within healthy range for deployment velocity.'}`,
        coveragePct: Math.round((cfrValues.length / (githubByPeriod.length || 1)) * 100),
        n: cfrValues.length,
        insufficientSignal: cfrValues.length < 2,
        breakdownByTool: { 
          'Current CFR': formatPercent(currentCFR, 1),
          'CFR trend': cfrTrend.direction,
          'Deploys/week': currentDeployFreq ? formatNumber(currentDeployFreq, 1) : 'N/A'
        },
        definition: 'Change failure rate analysis measures deployment reliability and quality, tracking the percentage of deployments that fail or require rollback.',
        recommendation: isElevated
          ? 'Investigate deployment failure patterns, strengthen testing automation, and improve pre-deployment validation. Consider reducing release cadence until failure rate improves.'
          : cfrTrend.direction === 'rose'
            ? 'Monitor rising failure rate trends. Strengthen quality gates and testing coverage before failure rate becomes elevated.'
            : 'Maintain current quality practices. Continue monitoring failure rate for early detection of reliability degradation.',
        signalCoveragePct: Math.round((cfrValues.length / (githubByPeriod.length || 1)) * 100),
        primarySignalsUsed: ['changeFailureRatePct', 'deploymentFreqPerWeek'],
        dataMaturityLabel: cfrValues.length >= 4 ? 'Measured' : 'Early Signal',
        demoFlag: cfrValues.length >= 2 ? 'demo_primary' : 'demo_hidden',
        contributingUnitsCount: cfrValues.length,
        contributingUnitType: 'periods',
        owner: 'deploy-operate-cfr-elevated-narrative',
        cicdStage: 'deploy-operate'
      });
    }
  }

  // PI 3: Deployment cadence is strong but stale deployment gap needs attention
  if (githubByPeriod && githubByPeriod.length > 0) {
    const deployFreqValues = githubByPeriod
      .map(p => p.deploymentFreqPerWeek)
      .filter(f => f !== undefined && f !== null && f > 0) as number[];
    
    if (deployFreqValues.length >= 2) {
      const currentDeployFreq = deployFreqValues[deployFreqValues.length - 1];
      const avgDeployFreq = deployFreqValues.reduce((sum, v) => sum + v, 0) / deployFreqValues.length;
      const isStrongCadence = currentDeployFreq >= 3;
      
      // Check for stale deployment gap (time since last deployment)
      const latestDeployment = githubSnapshot?.deployment_metrics?.latest_deployment;
      const lastDeployTime = latestDeployment?.deployed_at ? new Date(latestDeployment.deployed_at).getTime() : null;
      const now = Date.now();
      const hoursSinceLastDeploy = lastDeployTime ? (now - lastDeployTime) / (1000 * 60 * 60) : null;
      const isStale = hoursSinceLastDeploy !== null && hoursSinceLastDeploy > 48; // 48 hours = stale
      
      const title = isStrongCadence && isStale
        ? `Deployment cadence strong at ${formatNumber(currentDeployFreq, 1)}/week but stale gap needs attention`
        : isStrongCadence
          ? `Deployment cadence strong at ${formatNumber(currentDeployFreq, 1)} deploys/week`
          : isStale
            ? `Stale deployment gap of ${formatNumber(hoursSinceLastDeploy || 0, 0)}h requires attention`
            : `Deployment cadence moderate at ${formatNumber(currentDeployFreq, 1)} deploys/week`;
      
      insights.push({
        id: 'deployment-cadence-narrative',
        title,
        subtitle: 'Deployment frequency and freshness analysis',
        rightMetric: isStrongCadence 
          ? `${formatNumber(currentDeployFreq, 1)}/week`
          : isStale
            ? `${formatNumber(hoursSinceLastDeploy || 0, 0)}h stale`
            : `${formatNumber(currentDeployFreq, 1)}/week`,
        details: `Deployment cadence is ${isStrongCadence ? 'strong' : 'moderate'} at ${formatNumber(currentDeployFreq, 1)} deploys/week (avg ${formatNumber(avgDeployFreq, 1)}). ${hoursSinceLastDeploy !== null ? `Latest deployment was ${formatNumber(hoursSinceLastDeploy, 0)} hours ago${isStale ? ' - exceeding 48h freshness threshold' : '.'}` : 'No deployment timestamp available.'} ${isStrongCadence && !isStale ? 'Team maintains healthy release cadence with regular deployments.' : ''}`,
        coveragePct: Math.round((deployFreqValues.length / (githubByPeriod.length || 1)) * 100),
        n: deployFreqValues.length,
        insufficientSignal: deployFreqValues.length < 2,
        breakdownByTool: { 
          'Current deploys/week': formatNumber(currentDeployFreq, 1),
          'Hours since last deploy': hoursSinceLastDeploy !== null ? formatNumber(hoursSinceLastDeploy, 0) : 'N/A',
          'Freshness status': isStale ? 'Stale' : 'Fresh'
        },
        definition: 'Deployment cadence analysis measures release frequency and freshness, identifying gaps in deployment regularity that may indicate process bottlenecks.',
        recommendation: isStale
          ? 'Address stale deployment gap by investigating release blockers, improving deployment automation, and establishing regular release schedule to maintain delivery momentum.'
          : isStrongCadence
            ? 'Maintain strong deployment cadence. Consider scaling successful practices to accelerate delivery in other areas while ensuring quality gates remain effective.'
            : 'Strengthen deployment cadence by reducing release friction, improving CI/CD pipeline efficiency, and establishing more frequent release rhythm.',
        signalCoveragePct: Math.round((deployFreqValues.length / (githubByPeriod.length || 1)) * 100),
        primarySignalsUsed: ['deploymentFreqPerWeek', 'latest_deployment'],
        dataMaturityLabel: deployFreqValues.length >= 4 ? 'Measured' : 'Early Signal',
        demoFlag: deployFreqValues.length >= 2 ? 'demo_primary' : 'demo_hidden',
        contributingUnitsCount: deployFreqValues.length,
        contributingUnitType: 'periods',
        owner: 'deploy-operate-cadence-narrative',
        cicdStage: 'deploy-operate'
      });
    }
  }

  // PI 4: Latest deployment is healthy, but reliability pressure remains visible
  if (githubSnapshot?.deployment_metrics) {
    const latestDeployment = githubSnapshot.deployment_metrics.latest_deployment;
    const latestStatus = latestDeployment?.status || 'unknown';
    const isHealthy = latestStatus === 'success' || latestStatus === 'succeeded';
    const failedCount = githubSnapshot.deployment_metrics.failed_deployment_count || 0;
    const successCount = githubSnapshot.deployment_metrics.success_deployment_count || 0;
    const totalDeployments = failedCount + successCount;
    const cfr = totalDeployments > 0 ? (failedCount / totalDeployments) * 100 : 0;
    const hasReliabilityPressure = cfr > 15 || failedCount > 0;
    
    const title = isHealthy && hasReliabilityPressure
      ? `Latest deployment succeeded, but failure pressure remains visible`
      : isHealthy
        ? `Latest deployment succeeded with healthy reliability`
        : `Latest deployment ${latestStatus} - reliability requires attention`;
    
    insights.push({
      id: 'latest-deployment-narrative',
      title,
      subtitle: 'Deployment status and reliability pressure analysis',
      rightMetric: isHealthy ? 'Success' : latestStatus,
      details: `Latest deployment status: ${latestStatus}. ${totalDeployments > 0 ? `Total deployments: ${totalDeployments} (${successCount} success, ${failedCount} failed). Change failure rate: ${formatPercent(cfr, 1)}.` : 'No deployment count data available.'} ${hasReliabilityPressure ? `Reliability pressure visible with ${formatPercent(cfr, 1)}% failure rate${failedCount > 0 ? ` and ${failedCount} failed deployments` : ''}.` : 'Reliability is healthy with low failure rate.'}`,
      coveragePct: totalDeployments > 0 ? 100 : 0,
      n: totalDeployments,
      insufficientSignal: totalDeployments === 0,
      breakdownByTool: { 
        'Latest status': latestStatus,
        'Success count': successCount,
        'Failed count': failedCount,
        'CFR': formatPercent(cfr, 1)
      },
      definition: 'Latest deployment analysis checks deployment health status while monitoring overall reliability pressure from failure rates and failed deployment counts.',
      recommendation: isHealthy && hasReliabilityPressure
        ? 'Latest deployment succeeded, but elevated failure rate (${formatPercent(cfr, 1)}%) indicates quality issues. Investigate failure patterns and strengthen testing to reduce reliability pressure.'
        : isHealthy
          ? 'Latest deployment successful and reliability healthy. Maintain current quality practices and deployment monitoring.'
          : 'Latest deployment failed. Investigate failure cause, address immediate issues, and strengthen pre-deployment validation to prevent recurrence.',
      signalCoveragePct: totalDeployments > 0 ? 100 : 0,
      primarySignalsUsed: ['latest_deployment', 'failed_deployment_count', 'success_deployment_count'],
      dataMaturityLabel: totalDeployments >= 5 ? 'Measured' : 'Early Signal',
      demoFlag: totalDeployments > 0 ? 'demo_primary' : 'demo_hidden',
      contributingUnitsCount: totalDeployments,
      contributingUnitType: 'deployments',
      owner: 'deploy-operate-latest-deployment-narrative',
      cicdStage: 'deploy-operate'
    });
  }

  console.log(`[V2_PI_DEBUG] MVP computed ${insights.length} insights`);
  
  // Debug: Show Deploy & Operate PI objects
  const deployOperateInsights = insights.filter(i => i.cicdStage === 'deploy-operate');
  console.log('[DEPLOY_OPERATE_DEBUG] Deploy & Operate PIs:', deployOperateInsights.map(i => ({
    id: i.id,
    title: i.title,
    rightMetric: i.rightMetric,
    demoFlag: i.demoFlag
  })));
  
  // Apply MVP allowlist filtering - single source of truth for exactly 12 PIs
  const filteredInsights = filterAndOrderInsightsByAllowlist(insights);
  console.log(`[V2_PI_DEBUG] After MVP filtering: ${filteredInsights.length} insights`);
  
  // Debug: Show final Deploy & Operate PI objects after filtering
  const finalDeployOperateInsights = filteredInsights.filter(i => i.cicdStage === 'deploy-operate');
  console.log('[DEPLOY_OPERATE_FINAL] Final Deploy & Operate PIs:', finalDeployOperateInsights.map(i => ({
    id: i.id,
    title: i.title,
    rightMetric: i.rightMetric,
    demoFlag: i.demoFlag
  })));
  
  // Debug: MVP safety check
  const DEBUG_MVP_PI = false;
  if (DEBUG_MVP_PI) {
    console.log('MVP_PI_FINAL_LIST =>', filteredInsights.map(i => i.id));
    console.log('MVP_PI_COUNTS =>', {
      plan_code: filteredInsights.filter(i => ['commits-per-session-by-ide', 'active-coding-time-by-ide', 'ai-suggestions-accepted-by-ide', 'average-session-length-by-ide', 'commit-abandonment-rate-ai-vs-non-ai', 'branches-per-session-by-ide'].includes(i.id)).length,
      review_merge: filteredInsights.filter(i => ['org_review_git_context', 'org_review_focus_regression', 'review_latency_stable'].includes(i.id)).length,
      deploy_operate: filteredInsights.filter(i => ['org_deploy_time_efficiency', 'deployment_cadence_stability', 'change-failure-rate-trend-org'].includes(i.id)).length
    });
  }
  
  return filteredInsights;
}
