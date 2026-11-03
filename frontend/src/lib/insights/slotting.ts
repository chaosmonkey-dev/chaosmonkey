/**
 * Insight Slotting System
 * 
 * Replaces global caps with per-stage slot-based selection:
 * - Each stage has 3 slots: posture, change, action
 * - Global optional: compare slot (tool-ai-roi)
 * - Maximizes usefulness, minimizes redundancy
 */

import { PerformanceInsight, InsightSource } from './types';

// ============================================================================
// PART A: Stage Slot Schema
// ============================================================================

export interface StageSlots {
  posture: number;  // Always-on state summary
  change: number;   // Trend or mild anomaly
  action: number;   // Strong anomaly or composite
}

export interface SlotConfig {
  'plan-code': StageSlots;
  'review-merge': StageSlots;
  'deploy-operate': StageSlots;
  'global'?: { compare: number };  // Optional cross-tool comparison
}

export const DEFAULT_SLOT_CONFIG: SlotConfig = {
  'plan-code': { posture: 1, change: 1, action: 1 },
  'review-merge': { posture: 1, change: 1, action: 1 },
  'deploy-operate': { posture: 1, change: 1, action: 1 },
  'global': { compare: 1 }  // Optional tool-ai-roi
};

// ============================================================================
// PART B: Unified Insight Scoring
// ============================================================================

export interface ScoringContext {
  stage: string;
  existingStoryKeys?: Set<string>;  // For novelty penalty
  hasTelemetry?: boolean;
  hasGitHub?: boolean;
  hasSimulated?: boolean;
  isValueMode?: boolean;  // Value Mode context for diagnostic prioritization
}

/**
 * Unified scoring function for insight utility (not volume).
 * Higher score = more useful for leader decision-making.
 */
export function scoreInsight(insight: PerformanceInsight, context: ScoringContext): number {
  let score = 0;

  // 0. Narrative insight bonus (operational titles > generic metric labels)
  // Prioritize insights with narrative titles over basic metric labels
  const title = insight.title || '';
  const isGenericMetric = 
    title.includes(':') && 
    (title.match(/^\d+.*%$/) || title.match(/^\d+.*\/week$/) || title.match(/^\d+.*h$/));
  const isNarrative = 
    !isGenericMetric && 
    (title.toLowerCase().includes('pressure') || 
     title.toLowerCase().includes('throughput') || 
     title.toLowerCase().includes('cadence') || 
     title.toLowerCase().includes('workflow') || 
     title.toLowerCase().includes('risk') || 
     title.toLowerCase().includes('elevated') || 
     title.toLowerCase().includes('degrading') || 
     title.toLowerCase().includes('improving') ||
     title.toLowerCase().includes('slowing') ||
     title.toLowerCase().includes('bottleneck') ||
     title.toLowerCase().includes('excellent') ||
     title.toLowerCase().includes('critical') ||
     title.toLowerCase().includes('stable') ||
     title.toLowerCase().includes('unstable'));
  
  if (isNarrative) {
    score += 50;  // Strong bonus for narrative insights
  } else if (isGenericMetric) {
    score -= 30;  // Penalty for generic metric labels
  }

  // 1. Actionability score (does it recommend a decision/action?)
  const hasActionableRecommendations = (insight.recommendations?.length || 0) > 0;
  const hasSpecificActions = insight.recommendations?.some(r => 
    r.text?.toLowerCase().includes('survey') ||
    r.text?.toLowerCase().includes('investigate') ||
    r.text?.toLowerCase().includes('review') ||
    r.text?.toLowerCase().includes('enable') ||
    r.text?.toLowerCase().includes('connect')
  ) || false;
  score += hasActionableRecommendations ? 20 : 0;
  score += hasSpecificActions ? 15 : 0;

  // 2. Composite bonus (multi-metric > single metric)
  const isComposite = 
    insight.metricId?.includes('tradeoff') ||
    insight.metricId?.includes('fast-but-unstable') ||
    insight.metricId?.includes('velocity-reliability') ||
    insight.title?.toLowerCase().includes('tradeoff') ||
    insight.title?.toLowerCase().includes('balance') ||
    (insight.evidence?.length || 0) >= 3;  // Multiple evidence points
  score += isComposite ? 30 : 0;

  // 3. Severity bonus (critical/risk > warning > info)
  const severityScores: Record<string, number> = {
    'critical': 40,
    'risk': 30,
    'warning': 20,
    'opportunity': 15,
    'highlight': 10,
    'info': 5,
    'lowlight': 8
  };
  score += severityScores[insight.severity?.toLowerCase() || 'info'] || 5;

  // 4. Confidence bonus (Observed > Mixed > GitHub-only > Estimated)
  const confidenceScore = computeConfidenceScore(insight, context);
  score += confidenceScore;

  // 5. Coverage bonus (more repos/tools > less)
  const repoCount = insight.related?.repos?.length || 0;
  const toolCount = insight.related?.tools?.length || 0;
  const teamCount = insight.related?.teams?.length || 0;
  score += Math.min(repoCount * 3, 15);  // Cap at 15
  score += Math.min(toolCount * 2, 10);   // Cap at 10
  score += Math.min(teamCount * 2, 10);   // Cap at 10

  // 6. Novelty penalty (dedupe penalty if story already represented)
  if (context.existingStoryKeys && insight.storyKey) {
    if (context.existingStoryKeys.has(insight.storyKey)) {
      score -= 50;  // Heavy penalty for duplicate story
    }
  }

  // 7. Priority score boost (if already computed)
  if (insight.priorityScore) {
    score += insight.priorityScore * 0.2;  // Scale 0-100 to 0-20
  }

  // 8. Evidence strength (more evidence = more credible)
  const evidenceCount = insight.evidence?.length || 0;
  score += Math.min(evidenceCount * 2, 10);  // Cap at 10

  // 9. Delta magnitude (larger changes = more attention-worthy)
  const delta = Math.abs(insight.evidence?.find(e => e.delta != null)?.delta as number || 0);
  score += Math.min(delta * 5, 20);  // Cap at 20

  // 10. Diagnostic bonus (diagnostics > summaries, especially in Value Mode)
  // High-signal diagnostics (telemetry/repo/drivers) should beat generic summaries
  if (insight.orgKind === 'diagnostic') {
    score += 35;  // Strong bonus for diagnostics
    // Extra boost for telemetry/repo sources (demo-worthy)
    const source = insight.source?.toLowerCase() || '';
    const hasTelemetry = context.hasTelemetry && (insight.metricId?.includes('ttfc') || insight.metricId?.includes('rework') || insight.tags?.includes('telemetry'));
    const hasRepo = context.hasGitHub && (insight.metricId?.includes('pr') || insight.metricId?.includes('deploy') || insight.metricId?.includes('cycle'));
    if (hasTelemetry || hasRepo || source === 'github' || source === 'mixed') {
      score += 25;  // Additional boost for real data sources
    }
  } else if (insight.orgKind === 'summary') {
    // Summaries get a smaller base score to prevent crowd-out
    // They're still valuable but shouldn't beat diagnostics
    if (context.isValueMode) {
      score -= 15;  // In Value Mode, summaries are less prioritized
    }
  }

  return Math.round(score);
}

// Debug helper: score with a minimal breakdown for audit logs.
// Does NOT affect selection/scoring; used only for [PI_AUDIT] console logs.
function scoreInsightBreakdown(
  insight: PerformanceInsight,
  context: ScoringContext
): { total: number; breakdown: { diagnosticBonus: number; valueModeSummaryPenalty: number } } {
  const total = scoreInsight(insight, context);
  let diagnosticBonus = 0;
  let valueModeSummaryPenalty = 0;

  if (insight.orgKind === 'diagnostic') {
    diagnosticBonus += 35;
    const source = insight.source?.toLowerCase() || '';
    const hasTelemetry = context.hasTelemetry && (insight.metricId?.includes('ttfc') || insight.metricId?.includes('rework') || insight.tags?.includes('telemetry'));
    const hasRepo = context.hasGitHub && (insight.metricId?.includes('pr') || insight.metricId?.includes('deploy') || insight.metricId?.includes('cycle'));
    if (hasTelemetry || hasRepo || source === 'github' || source === 'mixed') {
      diagnosticBonus += 25;
    }
  } else if (insight.orgKind === 'summary' && context.isValueMode) {
    valueModeSummaryPenalty -= 15;
  }

  return { total, breakdown: { diagnosticBonus, valueModeSummaryPenalty } };
}

/**
 * Compute confidence score based on data source quality.
 * Observed (telemetry) > Mixed > GitHub-only > Estimated (simulated)
 */
function computeConfidenceScore(insight: PerformanceInsight, context: ScoringContext): number {
  const source = insight.source?.toLowerCase() || 'unknown';
  const dataSource = insight.dataSource?.toLowerCase() || 'unknown';

  // Observed (VS Code telemetry)
  if (source === 'github' && context.hasTelemetry && 
      (insight.metricId?.includes('ttfc') || insight.metricId?.includes('rework') || 
       insight.metricId?.includes('flow') || insight.tags?.includes('telemetry'))) {
    return 25;  // Highest confidence
  }

  // Mixed (GitHub + some telemetry)
  if (source === 'mixed' || dataSource === 'mixed') {
    return 20;
  }

  // GitHub-only (real but limited)
  if (source === 'github' || (context.hasGitHub && !context.hasSimulated)) {
    return 15;
  }

  // Estimated (simulated)
  if (source === 'simulated' || dataSource === 'sim' || context.hasSimulated) {
    return 5;  // Lower confidence but still useful
  }

  // Unknown
  return 10;
}

/**
 * Get confidence badge label for UI
 */
export function getConfidenceBadge(insight: PerformanceInsight, context: ScoringContext): 'Observed' | 'Mixed' | 'GitHub-only' | 'Estimated' {
  const source = insight.source?.toLowerCase() || 'unknown';
  const dataSource = insight.dataSource?.toLowerCase() || 'unknown';

  // Observed (telemetry)
  if (source === 'github' && context.hasTelemetry && 
      (insight.metricId?.includes('ttfc') || insight.metricId?.includes('rework') || 
       insight.metricId?.includes('flow') || insight.tags?.includes('telemetry'))) {
    return 'Observed';
  }

  // Mixed
  if (source === 'mixed' || dataSource === 'mixed') {
    return 'Mixed';
  }

  // GitHub-only
  if (source === 'github' || (context.hasGitHub && !context.hasSimulated)) {
    return 'GitHub-only';
  }

  // Estimated
  return 'Estimated';
}

// ============================================================================
// PART C: Story De-duplication
// ============================================================================

/**
 * Infer story key from insight properties.
 * Stories group related insights that tell the same narrative.
 */
export function inferStoryKey(insight: PerformanceInsight): string | null {
  const metricId = insight.metricId?.toLowerCase() || '';
  const title = insight.title?.toLowerCase() || '';

  // Reliability story: CFR + volatility + trend + defects
  if (metricId.includes('change-failure') || metricId.includes('cfr') ||
      metricId.includes('mttr') || metricId.includes('reliability') ||
      title.includes('change failure') || title.includes('reliability')) {
    return 'reliability-story';
  }

  // Merge bottleneck story: PR cycle time + review latency
  if (metricId.includes('cycle-time') || metricId.includes('pr-cycle') ||
      metricId.includes('review-latency') || metricId.includes('time-to-first-review') ||
      title.includes('cycle time') || title.includes('review latency') ||
      title.includes('merge bottleneck')) {
    return 'merge-bottleneck-story';
  }

  // AI impact story: AI throughput + quality + deploy stability
  if (metricId.includes('ai') || metricId.includes('ttfc') ||
      metricId.includes('ai-roi') || metricId.includes('ai-reliability') ||
      title.includes('ai') || title.includes('ttfc')) {
    return 'ai-impact-story';
  }

  // Deployment pace story: freq drop + volatility + fast-but-unstable
  if (metricId.includes('deployment-freq') || metricId.includes('deploy-freq') ||
      metricId.includes('fast-but-unstable') || metricId.includes('volatility') ||
      title.includes('deployment frequency') || title.includes('deploy frequency') ||
      title.includes('fast but unstable')) {
    return 'deployment-pace-story';
  }

  // Productivity skew story: tool differences
  if (metricId.includes('productivity-skew') || metricId.includes('tool') ||
      title.includes('productivity') || title.includes('tool')) {
    return 'productivity-skew-story';
  }

  // Default: use metricId as story key if available
  if (insight.metricId) {
    return `story-${insight.metricId}`;
  }

  return null;
}

/**
 * Merge redundant insights into a single richer story.
 * Returns primary insight with secondary insights attached as supporting context.
 */
export function mergeStoryInsights(
  insights: PerformanceInsight[],
  storyKey: string
): PerformanceInsight {
  // Sort by score to pick best primary
  const sorted = [...insights].sort((a, b) => {
    const scoreA = scoreInsight(a, { stage: a.cicdStage || 'other' });
    const scoreB = scoreInsight(b, { stage: b.cicdStage || 'other' });
    return scoreB - scoreA;
  });

  const primary = sorted[0];
  const secondaries = sorted.slice(1);

  // Merge evidence
  const mergedEvidence = [...(primary.evidence || [])];
  const seenLabels = new Set(primary.evidence?.map(e => e.label) || []);
  
  for (const secondary of secondaries) {
    for (const ev of secondary.evidence || []) {
      if (!seenLabels.has(ev.label)) {
        mergedEvidence.push(ev);
        seenLabels.add(ev.label);
      }
    }
  }

  // Merge recommendations
  const mergedRecommendations = [...(primary.recommendations || [])];
  const seenRecText = new Set(primary.recommendations?.map(r => r.text) || []);
  
  for (const secondary of secondaries) {
    for (const rec of secondary.recommendations || []) {
      if (!seenRecText.has(rec.text)) {
        mergedRecommendations.push(rec);
        seenRecText.add(rec.text);
      }
    }
  }

  // Create merged insight
  const merged: PerformanceInsight = {
    ...primary,
    storyKey,
    evidence: mergedEvidence,
    recommendations: mergedRecommendations,
    // Attach secondaries as metadata for drill-down
    supportingContext: secondaries.map(s => ({
      id: s.id,
      title: s.title,
      metricId: s.metricId,
      evidence: s.evidence || []
    })) as any
  };

  // Update title if multiple insights merged
  if (secondaries.length > 0) {
    const storyTitles: Record<string, string> = {
      'reliability-story': 'Deployment Reliability: Multiple Signals',
      'merge-bottleneck-story': 'Merge Process Bottleneck: Cycle Time & Review Latency',
      'ai-impact-story': 'AI Impact: Throughput, Quality & Stability',
      'deployment-pace-story': 'Deployment Pace: Frequency & Stability Trade-offs',
      'productivity-skew-story': 'Productivity Differences Across Tools'
    };
    merged.title = storyTitles[storyKey] || `${primary.title} (with related signals)`;
  }

  return merged;
}

// ============================================================================
// PART D: Slotting Algorithm
// ============================================================================

export interface SlotResult {
  leaderVisible: PerformanceInsight[];  // Selected insights for slots
  drillDown: PerformanceInsight[];      // Remaining insights (collapsed)
  slotAssignments: Record<string, { slot: string; insight: PerformanceInsight }[]>;  // Debug
}

/**
 * Fill slots for a stage with best insights.
 */
export function fillStageSlots(
  insights: PerformanceInsight[],
  stage: 'plan-code' | 'review-merge' | 'deploy-operate',
  config: SlotConfig,
  context: ScoringContext
): SlotResult {
  const stageConfig = config[stage];
  const stageInsights = insights.filter(i => i.cicdStage === stage);
  
  // Group by story key and merge redundant stories
  const storyGroups = new Map<string, PerformanceInsight[]>();
  for (const insight of stageInsights) {
    const storyKey = insight.storyKey || inferStoryKey(insight);
    if (storyKey) {
      if (!storyGroups.has(storyKey)) {
        storyGroups.set(storyKey, []);
      }
      storyGroups.get(storyKey)!.push(insight);
    } else {
      // No story key = standalone insight
      storyGroups.set(`standalone-${insight.id}`, [insight]);
    }
  }

  // Merge story groups
  const mergedInsights: PerformanceInsight[] = [];
  for (const [storyKey, group] of storyGroups) {
    if (group.length > 1) {
      mergedInsights.push(mergeStoryInsights(group, storyKey));
    } else {
      mergedInsights.push(group[0]);
    }
  }

  // Enforce slot contracts: categorize insights by tier and eligibility
  // POSTURE SLOT: Only posture tier or orgKind=summary (always-on summaries)
  console.groupCollapsed(
    `[PI_SLOT_EVAL] ${stage} → posture (candidates=${mergedInsights.length})`
  );
  const postureCandidates = mergedInsights.filter(i => {
    const tier = i.tier || 'trend'; // Default fallback
    const tierMismatch = tier !== 'posture';
    const orgKindMismatch = i.orgKind !== 'summary';
    const passes = tier === 'posture' || i.orgKind === 'summary';
    
    console.log({
      id: i.id,
      title: i.title,
      tier: i.tier,
      orgKind: i.orgKind,
      insightClass: i.insightClass,
      severity: i.severity,
      source: i.source,
      rejectedBecause: {
        tierMismatch,
        orgKindMismatch,
        summaryExcluded: false,
        diagnosticExcluded: false,
      },
      passes,
    });
    
    return passes;
  });
  console.log(
    `[PI_SLOT_RESULT] posture: kept=${postureCandidates.length}, rejected=${mergedInsights.length - postureCandidates.length}`
  );
  console.groupEnd();
  
  // CHANGE SLOT: Only trend tier OR mild anomaly (warning/info/opportunity severity)
  // EXCLUDE: posture tier, strong anomalies (critical/risk)
  console.groupCollapsed(
    `[PI_SLOT_EVAL] ${stage} → change (candidates=${mergedInsights.length})`
  );
  const changeCandidates = mergedInsights.filter(i => {
    const tier = i.tier || 'trend';
    const tierMismatch = tier === 'posture' || i.orgKind === 'summary';
    
    let severity = i.severity?.toLowerCase() || 'info';
    const severityMismatch = !(severity === 'warning' || severity === 'info' || severity === 'opportunity');
    const passes = !(tierMismatch) && (tier === 'trend' || (tier === 'anomaly' && (severity === 'warning' || severity === 'info' || severity === 'opportunity')));
    
    console.log({
      id: i.id,
      title: i.title,
      tier: i.tier,
      orgKind: i.orgKind,
      insightClass: i.insightClass,
      severity: i.severity,
      source: i.source,
      rejectedBecause: {
        tierMismatch,
        orgKindMismatch: false,
        summaryExcluded: false,
        diagnosticExcluded: false,
        severityMismatch,
      },
      passes,
    });
    
    if (tier === 'posture' || i.orgKind === 'summary') return false; // Never backfill posture into change
    if (tier === 'trend') return true;
    if (tier === 'anomaly') {
      const severity = i.severity?.toLowerCase() || 'info';
      return severity === 'warning' || severity === 'info' || severity === 'opportunity';
    }
    return false;
  });
  console.log(
    `[PI_SLOT_RESULT] change: kept=${changeCandidates.length}, rejected=${mergedInsights.length - changeCandidates.length}`
  );
  console.groupEnd();
  
  // ACTION SLOT: Only strong anomalies (critical/risk/warning) OR composite insights
  // EXCLUDE: posture tier, trend tier, drill-down tier
  // HARD GUARD: If diagnostics exist in this stage, action slot cannot accept summaries
  // PRIORITY: Anomalies beat summaries deterministically (severity > composite > deltaMagnitude > priorityScore)
  const hasDiagnosticsInStage = mergedInsights.some(i => i.orgKind === 'diagnostic');
  
  console.groupCollapsed(
    `[PI_SLOT_EVAL] ${stage} → action (candidates=${mergedInsights.length}, hasDiagnostics=${hasDiagnosticsInStage})`
  );
  const actionCandidates = mergedInsights.filter(i => {
    const tier = i.tier || 'trend';
    const tierMismatch = tier === 'posture' || tier === 'trend' || tier === 'drill-down';
    const diagnosticExcluded = hasDiagnosticsInStage && i.orgKind === 'summary';
    
    let severity = i.severity?.toLowerCase() || 'info';
    const severityMismatch = !(severity === 'critical' || severity === 'risk' || severity === 'warning');
    
    const isComposite = 
      i.metricId?.includes('tradeoff') || 
      i.metricId?.includes('fast-but-unstable') ||
      i.metricId?.includes('velocity-reliability') ||
      i.title?.toLowerCase().includes('tradeoff') ||
      i.title?.toLowerCase().includes('balance');
    
    const passes = !(tierMismatch || diagnosticExcluded) && (
      (tier === 'anomaly' && (severity === 'critical' || severity === 'risk' || severity === 'warning')) ||
      isComposite
    );
    
    console.log({
      id: i.id,
      title: i.title,
      tier: i.tier,
      orgKind: i.orgKind,
      insightClass: i.insightClass,
      severity: i.severity,
      source: i.source,
      rejectedBecause: {
        tierMismatch,
        orgKindMismatch: false,
        summaryExcluded: false,
        diagnosticExcluded,
        severityMismatch,
      },
      isComposite,
      passes,
    });
    
    if (tier === 'posture' || tier === 'trend' || tier === 'drill-down') {
      return false; // Never backfill posture/trend into action
    }
    // HARD GUARD: If diagnostics exist, summaries cannot fill action slot
    if (hasDiagnosticsInStage && i.orgKind === 'summary') {
      return false; // Reserve action slot for diagnostics when they exist
    }
    if (tier === 'anomaly') {
      const severity = i.severity?.toLowerCase() || 'info';
      return severity === 'critical' || severity === 'risk' || severity === 'warning';
    }
    // Composite insights (tradeoff, fast-but-unstable, velocity-reliability)
    const isComposite2 = 
      i.metricId?.includes('tradeoff') || 
      i.metricId?.includes('fast-but-unstable') ||
      i.metricId?.includes('velocity-reliability') ||
      i.title?.toLowerCase().includes('tradeoff') ||
      i.title?.toLowerCase().includes('balance');
    return isComposite2;
  });
  console.log(
    `[PI_SLOT_RESULT] action: kept=${actionCandidates.length}, rejected=${mergedInsights.length - actionCandidates.length}`
  );
  console.groupEnd();

  // Score all candidates
  const scoreWithContext = (i: PerformanceInsight) => scoreInsight(i, context);
  
  // Fill slots
  const selected: PerformanceInsight[] = [];
  const slotAssignments: Record<string, { slot: string; insight: PerformanceInsight }[]> = {
    posture: [],
    change: [],
    action: []
  };
  const usedStoryKeys = new Set<string>();

  // 1. Fill posture slot (always-on)
  const sortedPosture = [...postureCandidates].sort((a, b) => 
    scoreWithContext(b) - scoreWithContext(a)
  );
  for (let i = 0; i < Math.min(stageConfig.posture, sortedPosture.length); i++) {
    const insight = sortedPosture[i];
    selected.push(insight);
    slotAssignments.posture.push({ slot: 'posture', insight });
    if (insight.storyKey) usedStoryKeys.add(insight.storyKey);
  }

  // 2. Fill change slot (trend or mild anomaly)
  const sortedChange = [...changeCandidates]
    .filter(i => !selected.includes(i) && !usedStoryKeys.has(i.storyKey || ''))
    .sort((a, b) => scoreWithContext(b) - scoreWithContext(a));
  for (let i = 0; i < Math.min(stageConfig.change, sortedChange.length); i++) {
    const insight = sortedChange[i];
    selected.push(insight);
    slotAssignments.change.push({ slot: 'change', insight });
    if (insight.storyKey) usedStoryKeys.add(insight.storyKey);
  }

  // 3. Fill action slot (strong anomaly or composite)
  // PRIORITY ORDER: Diagnostics beat summaries deterministically when both exist
  // Sort by: diagnostics > anomalies > severity > composite > deltaMagnitude > priorityScore > score
  const sortedAction = [...actionCandidates]
    .filter(i => !selected.includes(i) && !usedStoryKeys.has(i.storyKey || ''))
    .sort((a, b) => {
      // 1. Diagnostics beat summaries deterministically (unless no diagnostics exist)
      const aIsDiagnostic = a.orgKind === 'diagnostic';
      const bIsDiagnostic = b.orgKind === 'diagnostic';
      if (aIsDiagnostic && !bIsDiagnostic) return -1;
      if (!aIsDiagnostic && bIsDiagnostic) return 1;
      
      // 2. Anomalies beat composites (anomaly tier > composite)
      const aIsAnomaly = a.tier === 'anomaly';
      const bIsAnomaly = b.tier === 'anomaly';
      if (aIsAnomaly && !bIsAnomaly) return -1;
      if (!aIsAnomaly && bIsAnomaly) return 1;
      
      // 3. Severity (critical > risk > warning)
      const severityOrder: Record<string, number> = { 'critical': 3, 'risk': 2, 'warning': 1, 'info': 0 };
      const aSeverity = severityOrder[a.severity?.toLowerCase() || 'info'] || 0;
      const bSeverity = severityOrder[b.severity?.toLowerCase() || 'info'] || 0;
      if (aSeverity !== bSeverity) return bSeverity - aSeverity;
      
      // 4. Composite bonus
      const aIsComposite = a.metricId?.includes('tradeoff') || a.metricId?.includes('fast-but-unstable') || a.metricId?.includes('velocity-reliability');
      const bIsComposite = b.metricId?.includes('tradeoff') || b.metricId?.includes('fast-but-unstable') || b.metricId?.includes('velocity-reliability');
      if (aIsComposite && !bIsComposite) return -1;
      if (!aIsComposite && bIsComposite) return 1;
      
      // 5. Delta magnitude
      const aDelta = Math.abs(a.evidence?.find(e => e.delta != null)?.delta as number || 0);
      const bDelta = Math.abs(b.evidence?.find(e => e.delta != null)?.delta as number || 0);
      if (aDelta !== bDelta) return bDelta - aDelta;
      
      // 6. Priority score
      const aPriority = a.priorityScore || 0;
      const bPriority = b.priorityScore || 0;
      if (aPriority !== bPriority) return bPriority - aPriority;
      
      // 7. Final score
      return scoreWithContext(b) - scoreWithContext(a);
    });
  for (let i = 0; i < Math.min(stageConfig.action, sortedAction.length); i++) {
    const insight = sortedAction[i];
    selected.push(insight);
    slotAssignments.action.push({ slot: 'action', insight });
    if (insight.storyKey) usedStoryKeys.add(insight.storyKey);
  }

  // -------------------------------------------------------------------------
  // SLOT BACKFILL (minimal, non-scoring)
  // -------------------------------------------------------------------------
  // Prevent empty change/action slots when there is remaining inventory.
  // Uses the existing scoreInsight ranking (scoreWithContext) and does NOT
  // change any scoring/math.
  //
  // Rules:
  // - If action is empty and there are remaining candidates not used in posture/change,
  //   fill action with the highest-ranked remaining candidate (1 item).
  // - If change is empty and there are remaining candidates not used in posture/action,
  //   fill change with the highest-ranked remaining candidate (1 item).
  // -------------------------------------------------------------------------

  const postureSelected = new Set(slotAssignments.posture.map(x => x.insight));
  const changeSelected = new Set(slotAssignments.change.map(x => x.insight));
  const actionSelected = new Set(slotAssignments.action.map(x => x.insight));

  if (slotAssignments.action.length === 0 && stageConfig.action > 0) {
    const remainingForAction = mergedInsights
      .filter(i => !postureSelected.has(i) && !changeSelected.has(i) && !actionSelected.has(i))
      .filter(i => !selected.includes(i));

    if (remainingForAction.length > 0) {
      const [best] = [...remainingForAction].sort((a, b) => scoreWithContext(b) - scoreWithContext(a));
      selected.push(best);
      slotAssignments.action.push({ slot: 'action', insight: best });
      if (best.storyKey) usedStoryKeys.add(best.storyKey);
    }
  }

  if (slotAssignments.change.length === 0 && stageConfig.change > 0) {
    const remainingForChange = mergedInsights
      .filter(i => !postureSelected.has(i) && !actionSelected.has(i))
      .filter(i => !selected.includes(i));

    if (remainingForChange.length > 0) {
      const [best] = [...remainingForChange].sort((a, b) => scoreWithContext(b) - scoreWithContext(a));
      selected.push(best);
      slotAssignments.change.push({ slot: 'change', insight: best });
      if (best.storyKey) usedStoryKeys.add(best.storyKey);
    }
  }

  // Everything else goes to drill-down
  console.groupCollapsed(
    `[PI_SLOT_EVAL] ${stage} → drillDown (candidates=${mergedInsights.length})`
  );
  const drillDown = mergedInsights.filter(i => {
    const kept = !selected.includes(i);
    if (!kept) {
      console.log({
        id: i.id,
        title: i.title,
        tier: i.tier,
        orgKind: i.orgKind,
        insightClass: i.insightClass,
        severity: i.severity,
        source: i.source,
        rejectedBecause: {
          tierMismatch: false,
          orgKindMismatch: false,
          summaryExcluded: false,
          diagnosticExcluded: false,
          alreadySelected: true,
        },
        passes: false,
      });
    }
    return kept;
  });
  console.log(
    `[PI_SLOT_RESULT] drillDown: kept=${drillDown.length}, rejected=${selected.length}`
  );
  console.groupEnd();

  // ========== PI_AUDIT: SLOT RANKING (once per run, debug-gated) ==========
  // Logs winner + top candidates per slot with minimal score breakdown.
  // No behavior changes.
  const PI_DEBUG_ENV = (import.meta as any).env?.VITE_PI_DEBUG ?? 'false';
  const PI_DEBUG = PI_DEBUG_ENV === 'true' || PI_DEBUG_ENV === '1';
  const auditLabelByStage: Record<string, string> = {
    'plan-code': '[PI_AUDIT][PLAN_CODE_SLOT_RANKING]',
    'review-merge': '[PI_AUDIT][REVIEW_MERGE_SLOT_RANKING]',
    'deploy-operate': '[PI_AUDIT][DEPLOY_OPERATE_SLOT_RANKING]',
  };

  const getAuditLatch = (key: string): boolean => {
    if (!PI_DEBUG) return true;
    const w = window as any;
    w.__PI_AUDIT__ = w.__PI_AUDIT__ || {};
    if (w.__PI_AUDIT__[key]) return true;
    w.__PI_AUDIT__[key] = true;
    return false;
  };

  if (PI_DEBUG && !getAuditLatch(`SLOT_RANKING_${stage}`)) {
    try {
      const topN = (xs: PerformanceInsight[], n = 5) => {
        return [...xs]
          .sort((a, b) => scoreWithContext(b) - scoreWithContext(a))
          .slice(0, n)
          .map(i => {
            const s = scoreInsightBreakdown(i, context);
            return {
              id: i.id,
              title: String(i.title || '').slice(0, 90),
              ruleId: (i as any).ruleId || i.metricId || 'unknown',
              orgKind: i.orgKind || 'unknown',
              toolScope: i.toolScope || 'unknown',
              insightClass: i.insightClass || 'unknown',
              severity: i.severity,
              source: i.source,
              scoreTotal: s.total,
              scoreBreakdown: s.breakdown,
            };
          });
      };

      const winnerFor = (slot: 'posture' | 'change' | 'action') => {
        const first = slotAssignments[slot]?.[0]?.insight;
        if (!first) return null;
        return {
          id: first.id,
          title: String(first.title || '').slice(0, 90),
          ruleId: (first as any).ruleId || first.metricId || 'unknown',
          orgKind: first.orgKind || 'unknown',
          toolScope: first.toolScope || 'unknown',
          insightClass: first.insightClass || 'unknown',
          severity: first.severity,
          source: first.source,
          scoreTotal: scoreInsightBreakdown(first, context).total,
        };
      };

      console.log(auditLabelByStage[stage], {
        stage,
        slots: {
          posture: {
            winner: winnerFor('posture'),
            topCandidates: topN(postureCandidates, 5),
          },
          change: {
            winner: winnerFor('change'),
            topCandidates: topN(changeCandidates, 5),
          },
          action: {
            winner: winnerFor('action'),
            topCandidates: topN(actionCandidates, 5),
          },
        },
      });
    } catch (e) {
      console.warn(`${auditLabelByStage[stage]} failed to build`, e);
    }
  }

  return {
    leaderVisible: selected,
    drillDown,
    slotAssignments
  };
}

/**
 * Fill global compare slot (tool-ai-roi)
 */
export function fillGlobalCompareSlot(
  insights: PerformanceInsight[],
  config: SlotConfig
): PerformanceInsight[] {
  if (!config.global) return [];
  
  const compareInsights = insights.filter(i => 
    i.metricId?.includes('tool-ai-roi') || 
    i.metricId?.includes('ai-roi') ||
    i.title?.toLowerCase().includes('ai roi')
  );
  
  // Return best one
  return compareInsights
    .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
    .slice(0, config.global.compare);
}

