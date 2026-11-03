/**
 * FINAL PI STRESS TEST FIXTURE - DEV ONLY
 * 
 * Generates controlled, diverse dataset to stress-test all 26 canonical PIs
 * 
 * PURPOSE: Validate every registered PI can render under complete data conditions
 * USAGE: Dev-only, activated via VITE_FINAL_PI_STRESS_MODE=true or ?piStress=1
 * 
 * This fixture creates synthetic session rows and GitHub data that satisfy
 * all canonical PI dependencies without polluting Matt's real org runtime data or any future customer org data.
 */

import type { CanonicalInsightInput } from './types';
import { CANONICAL_PI_REGISTRY } from './canonicalInsights';

/**
 * Check if stress mode is enabled
 */
export function isStressModeEnabled(): boolean {
  // Production safety: Only allow stress mode in dev or with explicit flag
  const stressAllowed = 
    (typeof import.meta !== 'undefined' && import.meta.env?.DEV) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ALLOW_PI_STRESS_MODE === 'true');
  
  if (!stressAllowed) {
    return false;
  }
  
  // Check environment variable
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FINAL_PI_STRESS_MODE === 'true') {
    return true;
  }
  
  // Check URL parameters (case-insensitive support for both piStress, pistress, and demoMode)
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('piStress') === '1' || urlParams.get('pistress') === '1' || urlParams.get('demoMode') === '1';
  }
  
  return false;
}

/**
 * Generate stress test session data with full diversity
 */
function generateStressSessions(): any[] {
  const sessions: any[] = [];
  const tools = ['cursor', 'windsurf', 'vscode', 'claude_code'];
  const repos = [
    'https://github.com/example/frontend-app',
    'https://github.com/example/backend-api',
    'https://github.com/example/mobile-app',
    'https://github.com/example/data-pipeline',
    'https://github.com/example/ml-models'
  ];
  
  // Generate 250 diverse sessions with intentional AI imbalance
  for (let i = 0; i < 250; i++) {
    const repo = repos[i % repos.length];
    const sessionId = `stress-session-${i}`;
    
    // Create intentional AI imbalance tied to specific tools
    // 60% Cursor (high AI), 20% Windsurf (medium AI), 15% VS Code (low AI), 5% Claude (none)
    let tool: string;
    let aiIntensityBand: string;
    if (i % 20 < 12) { // 60% high AI (Cursor)
      tool = 'cursor';
      aiIntensityBand = 'high';
    } else if (i % 20 < 16) { // 20% medium AI (Windsurf)
      tool = 'windsurf';
      aiIntensityBand = 'medium';
    } else if (i % 20 < 19) { // 15% low AI (VS Code)
      tool = 'vscode';
      aiIntensityBand = 'low';
    } else { // 5% no AI (Claude)
      tool = 'claude_code';
      aiIntensityBand = 'none';
    }
    
    const aiBurstCount = aiIntensityBand === 'none' ? 0 : 
                        aiIntensityBand === 'low' ? 1 : 
                        aiIntensityBand === 'medium' ? 5 : 15;
    
    // Create diverse session patterns
    const totalDuration = 30 + (i % 120) * 60 * 1000; // 30 minutes to 2 hours
    const activeCodingRatio = 0.3 + (i % 7) * 0.1; // 30% to 90%
    const activeCodingDuration = totalDuration * activeCodingRatio;
    
    // Time to first commit varies
    const ttfc = i % 10 === 0 ? 0 : // Some sessions start with commits
                i % 5 === 0 ? 5 * 60 * 1000 : // 5 minutes
                (10 + (i % 30)) * 60 * 1000; // 10-40 minutes
    
    // Line changes for rework calculation - create high rework users
    const linesAdded = 50 + (i % 500) * 10;
    let reworkPct: number;
    if (i % 20 < 4) { // 20% of sessions have very high rework (50-80%)
      reworkPct = 0.5 + (i % 3) * 0.1; // 50%, 60%, 70%
    } else { // 80% have normal rework (10-30%)
      reworkPct = 0.1 + (i % 3) * 0.1; // 10%, 20%, 30%
    }
    const linesRemoved = Math.floor(linesAdded * reworkPct);
    
    // Commit patterns
    const commits = Math.max(1, Math.floor(activeCodingDuration / (15 * 60 * 1000))); // 1 commit per 15 min of active coding
    
    // Quality bands
    const qualityScore = 40 + (i % 60); // 40-100
    const qualityBand = qualityScore >= 80 ? 'high' : qualityScore >= 60 ? 'medium' : 'low';
    
    // Specialized time tracking
    const debugTime = i % 3 === 0 ? (5 + (i % 20)) * 60 * 1000 : 0;
    const terminalTime = i % 4 === 0 ? (10 + (i % 30)) * 60 * 1000 : 0;
    const focusRatio = 0.5 + (i % 5) * 0.1; // 50%-90%
    
    // Timestamp spread over 8 weeks
    const now = new Date();
    const sessionTime = new Date(now.getTime() - (i % 56) * 24 * 60 * 60 * 1000);
    
    sessions.push({
      session_id: sessionId,
      user_id: `stress-user-${i % 20}`, // 20 different users
      tool,
      git_repo_url: repo,
      git_branch: 'main',
      timestamp: sessionTime.toISOString(),
      
      // Core session metrics
      duration_ms: totalDuration,
      active_coding_duration_ms: activeCodingDuration,
      time_to_first_commit_ms: ttfc,
      
      // AI metrics
      ai_burst_count: aiBurstCount,
      ai_usage_duration_ms: aiBurstCount > 0 ? activeCodingDuration * 0.6 : 0,
      ai_intensity_band: aiIntensityBand,
      
      // Work metrics
      lines_added_total: linesAdded,
      lines_removed_total_est: linesRemoved,
      commit_count: commits,
      commits_per_session: commits,
      files_edited: 1 + (i % 8),
      
      // Specialized time metrics
      debug_time_ms: debugTime,
      terminal_active_time_ms: terminalTime,
      focus_ratio: focusRatio,
      
      // Quality metrics
      session_quality_score: qualityScore,
      session_quality_band: qualityBand,
      rework_band: linesRemoved / linesAdded > 0.3 ? 'high' : linesRemoved / linesAdded > 0.2 ? 'medium' : 'low',
      flow_profile: activeCodingRatio > 0.7 ? 'coding-heavy' : activeCodingRatio > 0.4 ? 'mixed' : 'idle-heavy',
      
      // Derived fields (normally added by addDerivedSessionFields)
      session_has_ai_activity: aiBurstCount > 0,
      session_active_coding_duration_minutes: activeCodingDuration / 60000,
      session_duration_minutes: totalDuration / 60000,
      session_idle_time_minutes: (totalDuration - activeCodingDuration) / 60000,
      session_rework_ratio_est: linesRemoved / (linesAdded + linesRemoved),
      session_commits: commits,
      
      // Metadata
      metadata: null
    });
  }
  
  return sessions;
}

/**
 * Generate stress test GitHub snapshot
 */
function generateStressGithubSnapshot(): any {
  const now = new Date();
  const eightWeeksAgo = new Date(now.getTime() - 56 * 24 * 60 * 60 * 1000);
  
  // Generate PR data across size buckets
  const prSizeBuckets = {
    small: 45,    // < 50 lines
    medium: 35,   // 50-200 lines  
    large: 20     // > 200 lines
  };
  
  // Generate review metrics
  const prReviewMetrics = {
    avg_review_cycle_time_hours: 8.5 + Math.random() * 4,
    reviewer_load_concentration: 0.3 + Math.random() * 0.4,
    review_bottleneck_prs: 5 + Math.floor(Math.random() * 10),
    small_pr_cycle_time_hours: 2.5 + Math.random() * 2,
    large_pr_cycle_time_hours: 24 + Math.random() * 12
  };
  
  // Generate deployment metrics
  const deploymentMetrics = {
    deployment_frequency_per_week: 3 + Math.random() * 4,
    change_failure_rate: 0.05 + Math.random() * 0.15,
    deployment_success_rate: 0.85 + Math.random() * 0.1,
    avg_lead_time_hours: 6 + Math.random() * 8,
    delivery_velocity_by_workflow: {
      'ai_accelerated': 1.3 + Math.random() * 0.4,
      'traditional': 0.9 + Math.random() * 0.3,
      'mixed_model': 1.1 + Math.random() * 0.3
    }
  };
  
  // Generate PR analytics
  const prAnalytics = {
    total_prs: 120 + Math.floor(Math.random() * 80),
    merged_prs: 95 + Math.floor(Math.random() * 40),
    reopened_prs: 8 + Math.floor(Math.random() * 7),
    merge_rate: 0.75 + Math.random() * 0.15,
    reopen_rate: 0.06 + Math.random() * 0.08,
    pr_size_distribution: prSizeBuckets,
    avg_lines_added: 85 + Math.random() * 115,
    avg_lines_changed: 120 + Math.random() * 180
  };
  
  return {
    total_pull_requests: prAnalytics.total_prs,
    merged_pull_requests: prAnalytics.merged_prs,
    merge_rate: prAnalytics.merge_rate * 100,
    
    // Tool usage detection
    cursor_usage_detected: 62,
    windsurf_usage_detected: 62,
    vscode_usage_detected: 63,
    claude_code_usage_detected: 63,
    
    // AI metrics
    total_copilot_insertions: 1200,
    total_claude_insertions: 2400,
    total_cursor_insertions: 1800,
    total_windsurf_insertions: 1600,
    total_insertions: 7000,
    
    // Core metrics
    telemetry_sessions: 250,
    open_issues_total: 28,
    time_filter: 'week',
    
    // Detailed metrics for generators
    prReviewMetrics,
    pr_analytics: prAnalytics,
    deploymentMetrics,
    
    // Time series data
    github_by_period: generateTimeSeriesData(eightWeeksAgo, now),
    productivity_by_period: generateProductivityTimeSeries(eightWeeksAgo, now)
  };
}

/**
 * Generate time series data for GitHub metrics
 */
function generateTimeSeriesData(startDate: Date, endDate: Date): any[] {
  const data = [];
  const weeks = Math.ceil((endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
  
  for (let i = 0; i < weeks; i++) {
    const weekDate = new Date(startDate.getTime() + i * 7 * 24 * 60 * 60 * 1000);
    data.push({
      period: weekDate.toISOString().split('T')[0],
      week: i + 1,
      commits: 15 + Math.floor(Math.random() * 25),
      prs_opened: 3 + Math.floor(Math.random() * 8),
      prs_merged: 2 + Math.floor(Math.random() * 6),
      deployments: 1 + Math.floor(Math.random() * 4),
      lines_added: 500 + Math.floor(Math.random() * 2000),
      lines_removed: 200 + Math.floor(Math.random() * 800)
    });
  }
  
  return data;
}

/**
 * Generate productivity time series data
 */
function generateProductivityTimeSeries(startDate: Date, endDate: Date): any[] {
  const data = [];
  const weeks = Math.ceil((endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
  
  for (let i = 0; i < weeks; i++) {
    const weekDate = new Date(startDate.getTime() + i * 7 * 24 * 60 * 60 * 1000);
    data.push({
      period: weekDate.toISOString().split('T')[0],
      week: i + 1,
      productivity_score: 70 + Math.random() * 25,
      active_coding_hours: 25 + Math.random() * 15,
      ai_adoption_rate: 0.4 + Math.random() * 0.4,
      delivery_velocity: 0.8 + Math.random() * 0.6
    });
  }
  
  return data;
}

/**
 * Generate complete stress test input data
 */
export function generateStressTestInput(): CanonicalInsightInput {
  console.log('[FINAL_PI_STRESS][GENERATING]', 'Creating stress test dataset with 250 sessions');
  
  const sessions = generateStressSessions();
  const githubSnapshot = generateStressGithubSnapshot();
  
  const input: CanonicalInsightInput = {
    sessionRows: sessions,
    githubSnapshot,
    githubByPeriod: githubSnapshot.github_by_period || [],
    productivityByPeriod: githubSnapshot.productivity_by_period || [],
    granularity: 'week'
  };
  
  console.log('[FINAL_PI_STRESS][GENERATED]', {
    sessionCount: sessions.length,
    githubSnapshotAvailable: !!githubSnapshot,
    timeSeriesWeeks: githubSnapshot.github_by_period?.length || 0,
    toolDistribution: {
      cursor: sessions.filter(s => s.tool === 'cursor').length,
      windsurf: sessions.filter(s => s.tool === 'windsurf').length,
      vscode: sessions.filter(s => s.tool === 'vscode').length,
      claude_code: sessions.filter(s => s.tool === 'claude_code').length
    },
    aiIntensityDistribution: {
      high: sessions.filter(s => s.ai_intensity_band === 'high').length,
      medium: sessions.filter(s => s.ai_intensity_band === 'medium').length,
      low: sessions.filter(s => s.ai_intensity_band === 'low').length,
      none: sessions.filter(s => s.ai_intensity_band === 'none').length
    }
  });
  
  return input;
}

/**
 * Stress test matrix interface
 */
interface StressTestMatrix {
  pi_id: string;
  stage: string;
  registered: boolean;
  renders_with_real_data: boolean;
  renders_with_stress_data: boolean;
  real_data_missing_condition?: string;
  stress_fixture_fields_used: string[];
  detail_card_safe: boolean;
  notes: string;
}

/**
 * Run stress test and generate matrix
 */
export async function runStressTest(realInsights: any[], stressInsights: any[]): Promise<StressTestMatrix[]> {
  console.log('[FINAL_PI_STRESS][RUNNING]', 'Generating stress test matrix');
  
  const matrix: StressTestMatrix[] = [];
  
  for (const pi of CANONICAL_PI_REGISTRY) {
    const realInsight = realInsights.find(i => i.id === pi.id);
    const stressInsight = stressInsights.find(i => i.id === pi.id);
    
    const rendersWithRealData = !!realInsight;
    const rendersWithStressData = !!stressInsight;
    
    // Determine missing conditions
    let realDataMissingCondition = '';
    if (!rendersWithRealData) {
      if (pi.stage === 'plan-code') {
        realDataMissingCondition = 'Missing session data diversity (AI intensity, rework patterns, quality bands)';
      } else if (pi.stage === 'review-merge') {
        realDataMissingCondition = 'Missing PR/review metrics or insufficient PR size distribution';
      } else if (pi.stage === 'deploy-operate') {
        realDataMissingCondition = 'Missing deployment metrics or deployment frequency data';
      }
    }
    
    // Determine fields used by stress fixture
    const stressFixtureFieldsUsed: string[] = [];
    if (rendersWithStressData) {
      stressFixtureFieldsUsed.push('session_rows', 'github_snapshot');
      if (pi.stage === 'plan-code') {
        stressFixtureFieldsUsed.push('ai_metrics', 'time_metrics', 'quality_metrics', 'work_metrics');
      } else if (pi.stage === 'review-merge') {
        stressFixtureFieldsUsed.push('pr_review_metrics', 'pr_analytics');
      } else if (pi.stage === 'deploy-operate') {
        stressFixtureFieldsUsed.push('deployment_metrics');
      }
    }
    
    matrix.push({
      pi_id: pi.id,
      stage: pi.stage,
      registered: true,
      renders_with_real_data: rendersWithRealData,
      renders_with_stress_data: rendersWithStressData,
      real_data_missing_condition: realDataMissingCondition || undefined,
      stress_fixture_fields_used: stressFixtureFieldsUsed,
      detail_card_safe: rendersWithStressData, // Assume safe if renders with stress data
      notes: rendersWithStressData ? '✅ Renders under stress conditions' : 
              rendersWithRealData ? '⚠️ Renders with real data only' : 
              '❌ Does not render with either dataset'
    });
  }
  
  // Log matrix to console
  console.log('[FINAL_PI_STRESS][MATRIX]', matrix);
  
  // Expose on window for dev inspection
  if (typeof window !== 'undefined') {
    (window as any).__FINAL_PI_STRESS_MATRIX__ = matrix;
  }
  
  return matrix;
}

/**
 * Get stress test summary statistics
 */
export function getStressTestSummary(matrix: StressTestMatrix[]): {
  total_registered: number;
  real_data_rendered: number;
  stress_data_rendered: number;
  still_not_rendering: number;
  by_stage: Record<string, {
    total: number;
    real_rendered: number;
    stress_rendered: number;
  }>;
} {
  const summary = {
    total_registered: matrix.length,
    real_data_rendered: matrix.filter(m => m.renders_with_real_data).length,
    stress_data_rendered: matrix.filter(m => m.renders_with_stress_data).length,
    still_not_rendering: matrix.filter(m => !m.renders_with_stress_data).length,
    by_stage: {} as Record<string, { total: number; real_rendered: number; stress_rendered: number; }>
  };
  
  // Calculate by stage
  for (const pi of CANONICAL_PI_REGISTRY) {
    if (!summary.by_stage[pi.stage]) {
      summary.by_stage[pi.stage] = { total: 0, real_rendered: 0, stress_rendered: 0 };
    }
    summary.by_stage[pi.stage].total++;
  }
  
  for (const row of matrix) {
    if (row.renders_with_real_data) {
      summary.by_stage[row.stage].real_rendered++;
    }
    if (row.renders_with_stress_data) {
      summary.by_stage[row.stage].stress_rendered++;
    }
  }
  
  console.log('[FINAL_PI_STRESS][SUMMARY]', summary);
  
  return summary;
}
