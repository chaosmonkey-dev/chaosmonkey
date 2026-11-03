/**
 * PHASE 3: Port 4 V1 insights into V2
 * These are ported V1 insights adapted to V2PreviewRow format
 */

import type { V2PreviewRow } from './types';

// Local formatDuration function (copied from computeV2PerformanceInsights.ts)
function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(minutes)}m`;
}

/**
 * Compute repo issue hotspot from GitHub snapshot data
 */
export function computeRepoIssueHotspotV2(
  sessionRows: any[],
  githubSnapshot: any
): V2PreviewRow | null {
  console.log('🔍 [repo-issue-hotspot] Called with githubSnapshot:', {
    hasSnapshot: !!githubSnapshot,
    hasOpenIssuesTotal: !!(githubSnapshot?.open_issues_total),
    hasOpenIssuesByRepo: !!(githubSnapshot?.open_issues_by_repo),
    hasRepositories: !!(githubSnapshot?.repositories),
    snapshotKeys: githubSnapshot ? Object.keys(githubSnapshot) : []
  });

  // Use the actual GitHub metrics data we have access to
  if (!githubSnapshot?.open_issues_total && !githubSnapshot?.open_issues_by_repo) {
    // Return INCOMPLETE insight instead of null
    return {
      id: 'repo-issue-hotspot',
      title: 'Repository Issue Hotspot',
      subtitle: 'Code quality indicators',
      rightMetric: 'GitHub Issues not connected',
      details: 'GitHub Issues data not available. Connect GitHub to enable issue hotspot and quality insights.',
      coveragePct: 0,
      n: 0,
      insufficientSignal: true,
      breakdownByTool: {},
      definition: 'Identifies repositories with highest issue concentration to target code quality improvements.',
      recommendation: 'Connect GitHub Issues to enable repository issue tracking and hotspot detection.',
      conceptKey: 'repo-issue-hotspot',
      signalCoveragePct: 0,
      primarySignalsUsed: ['github'],
      dataMaturityLabel: 'Early Signal',
      demoFlag: 'demo_hidden',
      contributingUnitsCount: 0,
      contributingUnitType: 'sessions',
      owner: 'engineering',
      cicdStage: 'plan-code',
      isCore: false,
      visibilityHint: 'supporting',
      engineVersion: 'v2',
      tags: ['v2']
    };
  }

  // Use open_issues_by_repo if available, otherwise use open_issues_total
  let totalIssues = 0;
  let issueCounts: Record<string, number> = {};
  
  if (githubSnapshot.open_issues_by_repo && Array.isArray(githubSnapshot.open_issues_by_repo)) {
    // Use the detailed repo breakdown
    for (const repoData of githubSnapshot.open_issues_by_repo) {
      const repoName = repoData.repo || repoData.name || 'unknown';
      const issueCount = repoData.open_issues || 0;
      issueCounts[repoName] = issueCount;
      totalIssues += issueCount;
    }
  } else if (typeof githubSnapshot.open_issues_total === 'number') {
    // Use the total count
    totalIssues = githubSnapshot.open_issues_total;
    // Try to get repo names from repositories array for context
    if (githubSnapshot.repositories && Array.isArray(githubSnapshot.repositories)) {
      for (const repo of githubSnapshot.repositories) {
        const repoName = repo.full_name || repo.name || String(repo);
        // Distribute issues evenly across repos if we don't have per-repo breakdown
        issueCounts[repoName] = Math.floor(totalIssues / githubSnapshot.repositories.length);
      }
    } else {
      issueCounts['all_repos'] = totalIssues;
    }
  }
  
  if (totalIssues === 0) {
    return {
      id: 'repo-issue-hotspot',
      title: 'Repository Issue Hotspot',
      subtitle: 'Code quality indicators',
      rightMetric: 'No open issues',
      details: 'No open issues found across repositories. Great job maintaining code quality!',
      coveragePct: 100,
      n: 0,
      insufficientSignal: true,
      breakdownByTool: {},
      definition: 'Identifies repositories with highest issue concentration to target code quality improvements.',
      recommendation: 'Monitor issue creation trends to identify emerging quality concerns.',
      conceptKey: 'repo-issue-hotspot',
      signalCoveragePct: 100,
      primarySignalsUsed: ['github'],
      dataMaturityLabel: 'Observed but flat',
      demoFlag: 'demo_hidden',
      contributingUnitsCount: 0,
      contributingUnitType: 'sessions',
      owner: 'engineering',
      cicdStage: 'plan-code',
      isCore: false,
      visibilityHint: 'supporting',
      engineVersion: 'v2',
      tags: ['v2']
    };
  }

  // Find repository with most issues and get top 2
  let repoName = 'unknown';
  let issueCount = 0;
  const sortedRepos: Array<{repo: string, count: number, pct: number}> = [];
  
  for (const [repo, count] of Object.entries(issueCounts)) {
    const pct = totalIssues > 0 ? (count / totalIssues) * 100 : 0;
    sortedRepos.push({repo, count, pct});
  }
  
  // Sort by issue count descending
  sortedRepos.sort((a, b) => b.count - a.count);
  
  if (sortedRepos.length > 0) {
    repoName = sortedRepos[0].repo;
    issueCount = sortedRepos[0].count;
  }

  const issuePct = totalIssues > 0 ? (issueCount / totalIssues) * 100 : 0;
  const actionableTitle = `Issue hotspot: ${repoName}`;
  
  // Build details with top 2 repos and volume guidance
  let details = `${repoName} has ${issueCount} open issues (${issuePct.toFixed(1)}% of org).`;
  
  if (sortedRepos.length > 1) {
    const secondRepo = sortedRepos[1];
    details += ` Top 2 repos: ${repoName} (${issueCount} issues, ${issuePct.toFixed(1)}%), ${secondRepo.repo} (${secondRepo.count} issues, ${secondRepo.pct.toFixed(1)}%).`;
  }
  
  if (totalIssues < 10) {
    details += ' Low volume; interpret cautiously.';
  }
  
  // Executive-friendly recommendation
  let recommendation = `Triage the backlog: label + prioritize, assign owners, set SLA for high-severity, and schedule a weekly cleanup.`;
  
  if (sortedRepos.length > 1) {
    const secondRepo = sortedRepos[1];
    const diff = issuePct - secondRepo.pct;
    if (diff <= 15) { // Within ~15%
      recommendation += ` Also watch: ${secondRepo.repo}.`;
    }
  }

  return {
    id: 'repo-issue-hotspot',
    title: actionableTitle,
    subtitle: 'Largest share of open issues',
    rightMetric: `${issueCount} open issues (${issuePct.toFixed(1)}% of org)`,
    details,
    coveragePct: 100,
    n: totalIssues,
    insufficientSignal: false,
    breakdownByTool: {
      [repoName]: `${issueCount} issues`
    },
    definition: 'Identifies repositories with highest issue concentration to target code quality improvements.',
    recommendation,
    conceptKey: 'repo-issue-hotspot',
    signalCoveragePct: 100,
    primarySignalsUsed: ['github'],
    dataMaturityLabel: totalIssues >= 50 ? 'Measured' : 'Early Signal',
    demoFlag: totalIssues >= 10 ? 'demo_primary' : 'demo_secondary',
    contributingUnitsCount: totalIssues,
    contributingUnitType: 'sessions',
    owner: 'engineering',
    cicdStage: 'plan-code',
    isCore: false,
    visibilityHint: 'supporting',
    tags: ['v2']
  };
}

/**
 * Compute TTFC long tail analysis from session data
 */
export function computeTTFCLongTailV2(
  sessionRows: any[]
): V2PreviewRow | null {
  const ttfcValues = sessionRows
    .map(row => row.ttfc_minutes)
    .filter(value => value !== null && value !== undefined && Number.isFinite(value));
  
  if (ttfcValues.length === 0) {
    return null;
  }

  const sortedTtfc = [...ttfcValues].sort((a, b) => a - b);
  const median = sortedTtfc[Math.floor(sortedTtc.length / 2)];
  const p90 = sortedTtc[Math.floor(sortedTtc.length * 0.9)];
  const longTailThreshold = median * 3; // 3x median as "long tail"
  
  const longTailCount = sortedTtc.filter(ttfc => ttfc > longTailThreshold).length;
  const longTailPct = (longTailCount / sortedTtfc.length) * 100;

  return {
    id: 'ttfc-long-tail-v2',
    title: 'Time to First Commit Long Tail',
    subtitle: 'TTFC distribution analysis',
    rightMetric: `Median ${formatDuration(median)}, P90 ${formatDuration(p90)}`,
    details: `Analyzed ${sortedTtfc.length} sessions. ${longTailCount} sessions (${longTailPct.toFixed(1)}%) take > ${formatDuration(longTailThreshold)} to first commit.`,
    coveragePct: 100,
    n: sortedTtc.length,
    insufficientSignal: sortedTtc.length < 10,
    breakdownByTool: {
      'median': formatDuration(median),
      'p90': formatDuration(p90),
      'long_tail': `${longTailCount} sessions`
    },
    definition: 'Analyzes the distribution of time to first commit, identifying sessions that take unusually long to start coding.',
    recommendation: 'Investigate patterns in sessions with long TTFC to identify setup or onboarding improvements.',
    conceptKey: 'ttfc-long-tail',
    signalCoveragePct: 100,
    primarySignalsUsed: ['sessions'],
    dataMaturityLabel: sortedTtc.length >= 50 ? 'Measured' : 'Early Signal',
    demoFlag: sortedTtc.length >= 50 ? 'demo_secondary' : 'demo_hidden',
    contributingUnitsCount: sortedTtc.length,
    contributingUnitType: 'sessions',
    owner: 'engineering',
    tags: ['v2'],
    engineVersion: 'v2',
    whatsHappening: `${longTailPct.toFixed(1)}% of sessions take > ${formatDuration(longTailThreshold)} to first commit, while median is ${formatDuration(median)}.`,
    whyItMatters: 'Long TTFC indicates setup friction or onboarding delays that impact developer productivity and project momentum.',
    cicdStage: 'plan-code',
    isCore: false,
    visibilityHint: 'supporting'
  };
}

/**
 * Compute idle heavy work proxy from session data
 */
export function computeIdleHeavyWorkV2(
  sessionRows: any[]
): V2PreviewRow | null {
  const idleSessions = sessionRows.filter(row => 
    row.idle_ratio !== null && 
    row.idle_ratio !== undefined && 
    Number.isFinite(row.idle_ratio) && 
    row.idle_ratio > 0.7 // Heavy idle threshold
  );

  if (idleSessions.length === 0) {
    return null;
  }

  const totalSessions = sessionRows.length;
  const idlePct = (idleSessions.length / totalSessions) * 100;
  const avgIdleRatio = idleSessions.reduce((sum, row) => sum + row.idle_ratio, 0) / idleSessions.length;

  return {
    id: 'idle-heavy-work-v2',
    title: 'Idle Time Patterns',
    subtitle: 'Session activity analysis',
    rightMetric: `${idlePct.toFixed(1)}% sessions idle-heavy`,
    details: `Found ${idleSessions.length} sessions with >70% idle time out of ${totalSessions} total sessions. Average idle ratio: ${(avgIdleRatio * 100).toFixed(1)}%.`,
    coveragePct: 100,
    n: totalSessions,
    insufficientSignal: totalSessions < 10,
    breakdownByTool: {
      'idle_heavy_sessions': `${idleSessions.length} sessions`,
      'avg_idle_ratio': `${(avgIdleRatio * 100).toFixed(1)}%`
    },
    definition: 'Identifies sessions with high idle time ratios, indicating potential productivity bottlenecks or tooling issues.',
    recommendation: 'Investigate causes of high idle time in development sessions to improve productivity.',
    conceptKey: 'idle-heavy-work',
    signalCoveragePct: 100,
    primarySignalsUsed: ['sessions'],
    dataMaturityLabel: totalSessions >= 50 ? 'Measured' : 'Early Signal',
    demoFlag: totalSessions >= 50 ? 'demo_secondary' : 'demo_hidden',
    contributingUnitsCount: totalSessions,
    contributingUnitType: 'sessions',
    owner: 'engineering',
    tags: ['v2'],
    engineVersion: 'v2',
    whatsHappening: `${idlePct.toFixed(1)}% of sessions show heavy idle patterns (${(avgIdleRatio * 100).toFixed(1)}% average idle time), suggesting productivity bottlenecks.`,
    whyItMatters: 'High idle time indicates tooling issues, environment problems, or workflow inefficiencies that directly impact developer productivity.',
    cicdStage: 'plan-code',
    isCore: false,
    visibilityHint: 'supporting'
  };
}

/**
 * Compute org coding time summary from productivity data
 */
export function computeOrgCodingTimeV2(
  productivityByPeriod: any[]
): V2PreviewRow | null {
  if (!productivityByPeriod || !Array.isArray(productivityByPeriod) || productivityByPeriod.length === 0) {
    return null;
  }

  const totalCodingTime = productivityByPeriod.reduce((sum, period) => {
    const codingTime = period.coding_time_minutes || 0;
    return sum + codingTime;
  }, 0);

  const totalActiveTime = productivityByPeriod.reduce((sum, period) => {
    const activeTime = period.active_coding_time_minutes || 0;
    return sum + activeTime;
  }, 0);

  const periodCount = productivityByPeriod.length;
  const avgCodingTime = totalCodingTime / periodCount;
  const avgActiveTime = totalActiveTime / periodCount;
  const codingRatio = totalActiveTime > 0 ? (totalCodingTime / totalActiveTime) * 100 : 0;

  return {
    id: 'org-coding-time-summary-v2',
    title: 'Organization Coding Time Summary',
    subtitle: 'Development activity analysis',
    rightMetric: `Avg ${formatDuration(avgCodingTime)} per period`,
    details: `Analyzed ${periodCount} periods. Total coding time: ${formatDuration(totalCodingTime)}. Total active time: ${formatDuration(totalActiveTime)}.`,
    coveragePct: 100,
    n: periodCount,
    insufficientSignal: periodCount < 2,
    breakdownByTool: {
      'avg_coding_time': formatDuration(avgCodingTime),
      'avg_active_time': formatDuration(avgActiveTime),
      'coding_ratio': `${codingRatio.toFixed(1)}%`
    },
    definition: 'Analyzes organization-level coding time patterns and productivity metrics across all development activity.',
    recommendation: 'Monitor coding time trends to identify productivity patterns and potential optimization opportunities.',
    conceptKey: 'org-coding-time',
    signalCoveragePct: 100,
    primarySignalsUsed: ['telemetry'],
    dataMaturityLabel: periodCount >= 4 ? 'Measured' : 'Early Signal',
    demoFlag: periodCount >= 4 ? 'demo_secondary' : 'demo_hidden',
    contributingUnitsCount: periodCount,
    contributingUnitType: 'periods',
    owner: 'engineering',
    tags: ['v2'],
    engineVersion: 'v2',
    whatsHappening: `Average coding time is ${formatDuration(avgCodingTime)} per period with ${codingRatio.toFixed(1)}% of active time spent coding.`,
    whyItMatters: 'Organization coding time trends indicate overall development velocity and help identify productivity patterns or bottlenecks.',
    cicdStage: 'plan-code',
    isCore: false,
    visibilityHint: 'supporting'
  };
}
