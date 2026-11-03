/**
 * Rule Execution Trace System
 * 
 * Comprehensive instrumentation to track each rule through the pipeline
 * and identify where insights are being suppressed.
 */

import { PerformanceInsight, PerformanceInputs } from './types';

export interface RuleTraceEntry {
  ruleId: string;
  cicdStage?: string;
  insightClass?: string;
  orgKind?: string;
  toolScope?: string;
  
  // Data availability
  requiredDatasets: {
    engOutput: boolean;
    productivity: boolean;
    sessions: boolean;
    githubSnapshot: boolean;
    overlap: boolean;
  };
  
  // Field availability
  requiredFields: {
    present: string[];
    missing: string[];
  };
  
  // Data sufficiency
  minPoints: {
    required: number;
    actual: number;
    sufficient: boolean;
  };
  
  // Guard results
  guardResults: {
    sparseHistory: boolean;
    blockedShape: boolean;
    insufficientData: boolean;
    stableOnly: boolean;
  };
  
  // Emission
  emittedInsights: {
    count: number;
    insights: Array<{
      insightId: string;
      title: string;
      severity: string;
      tier?: string;
      storyKey?: string;
      confidenceBadge?: string;
    }>;
  };
  
  // Pipeline fate
  pipelineFate: {
    keptLeaderVisible: boolean;
    droppedAtStep?: 'RULE_GUARD' | 'POSTPROCESS_FILTER' | 'MERGE_DEDUPE' | 'SLOTTING_REJECT' | 'UI_FILTER' | 'NONE';
    dropReason?: string;
    finalInsightIds?: string[];
  };
}

export interface RuleTraceReport {
  rules: RuleTraceEntry[];
  aggregates: {
    totalRulesRegistered: number;
    totalRulesExecuted: number;
    totalRulesEmitted: number;
    emittedToLeaderVisible: number;
    byStage: Record<string, { emitted: number; leaderVisible: number }>;
    byNewVsOld: {
      new: { total: number; emitted: number; leaderVisible: number };
      old: { total: number; emitted: number; leaderVisible: number };
    };
    dropReasons: Record<string, number>;
  };
  topRulesByEmitted: RuleTraceEntry[];
  blockedRulesByReason: Record<string, RuleTraceEntry[]>;
  pipelineSurvival: Record<string, {
    rawEmitted: number;
    afterMergeDedupe: number;
    afterSlotting: number;
    leaderVisibleFinal: number;
  }>;
  slotAssignments?: Record<string, Record<string, Array<{ slot: string; insight: any }>>>;
}

// Define "new" rules (added in last 3 days)
// Update this list based on git history or manual tracking
const NEW_RULES = new Set([
  'org-review-latency-spike',
  'org-pr-cycle-time-bottleneck',
  'org-deployment-freq-drop',
  'org-change-failure-rate-spike',
  'org-mttr-spike',
  'deploy-freq-driver',
  'deploy-vscode-ai-posture',
  'deploy-ai-reliability-correlation',
  'tool-ai-roi',
  'org-velocity-reliability-tradeoff',
  'org-reliability-volatility',
  'org-deploy-frequency-volatility',
  'org-cfr-trend-deterioration',
  'org-fast-but-unstable'
]);

export function isNewRule(ruleId: string): boolean {
  return NEW_RULES.has(ruleId);
}

/**
 * Analyze data availability for a rule
 * Only checks fields that the specific rule actually needs (not all common fields)
 */
export function analyzeDataAvailability(
  ruleId: string,
  input: PerformanceInputs
): RuleTraceEntry['requiredDatasets'] & RuleTraceEntry['requiredFields'] {
  const datasets = {
    engOutput: (input.engOutput?.length || 0) > 0,
    productivity: (input.productivity?.length || 0) > 0,
    sessions: (input.sessions?.length || 0) > 0,
    githubSnapshot: !!(input as any).githubSnapshot,
    overlap: (input.overlap || 0) > 0
  };
  
  // Infer required fields based on ruleId patterns (only check what this rule actually needs)
  const requiredFields: string[] = [];
  const ruleIdLower = ruleId.toLowerCase();
  
  // EngOutput fields (only add if rule needs them)
  if (datasets.engOutput) {
    if (ruleIdLower.includes('cycle-time') || ruleIdLower.includes('cycle-time') || ruleIdLower.includes('pr-cycle')) {
      requiredFields.push('prCycleTimeHours');
    }
    if (ruleIdLower.includes('review') || ruleIdLower.includes('bottleneck') || ruleIdLower.includes('latency')) {
      requiredFields.push('timeToFirstReviewHours');
    }
    if (ruleIdLower.includes('deploy') || ruleIdLower.includes('deployment-freq')) {
      requiredFields.push('deploymentFreqPerWeek');
    }
    if (ruleIdLower.includes('change-failure') || ruleIdLower.includes('cfr') || ruleIdLower.includes('reliability')) {
      requiredFields.push('changeFailureRatePct');
    }
    // MTTR only for rules that explicitly need it
    if (ruleIdLower.includes('mttr') || ruleIdLower.includes('mean-time-to-recover')) {
      requiredFields.push('mttrHours');
    }
    if (ruleIdLower.includes('merge-rate') || ruleIdLower.includes('merge')) {
      requiredFields.push('mergeRatePct');
    }
  }
  
  // Productivity fields
  if (datasets.productivity) {
    if (ruleIdLower.includes('ai') || ruleIdLower.includes('throughput') || ruleIdLower.includes('roi')) {
      requiredFields.push('aiAssists');
    }
    if (ruleIdLower.includes('coding') || ruleIdLower.includes('time') || ruleIdLower.includes('productivity')) {
      requiredFields.push('codingMinutes');
    }
    if (ruleIdLower.includes('commit') || ruleIdLower.includes('output')) {
      requiredFields.push('commits');
    }
    if (ruleIdLower.includes('session') || ruleIdLower.includes('ttfc')) {
      requiredFields.push('sessionMinutes');
    }
  }
  
  // Sessions fields
  if (datasets.sessions) {
    if (ruleIdLower.includes('ttfc') || ruleIdLower.includes('first-commit')) {
      requiredFields.push('time_to_first_commit_ms');
    }
    if (ruleIdLower.includes('ai') || ruleIdLower.includes('burst')) {
      requiredFields.push('ai_burst_count');
    }
    if (ruleIdLower.includes('rework') || ruleIdLower.includes('quality')) {
      requiredFields.push('rework_ratio_est');
    }
  }
  
  // Check which required fields are present/missing
  const present: string[] = [];
  const missing: string[] = [];
  
  for (const field of requiredFields) {
    let found = false;
    
    // Check engOutput
    if (datasets.engOutput && ['prCycleTimeHours', 'timeToFirstReviewHours', 'deploymentFreqPerWeek', 
        'changeFailureRatePct', 'mttrHours', 'mergeRatePct'].includes(field)) {
      const sample = input.engOutput?.[0] || {};
      if (sample[field as keyof typeof sample] !== undefined) {
        found = true;
      }
    }
    
    // Check productivity
    if (datasets.productivity && ['aiAssists', 'codingMinutes', 'commits', 'sessionMinutes'].includes(field)) {
      const sample = input.productivity?.[0] || {};
      if (sample[field as keyof typeof sample] !== undefined) {
        found = true;
      }
    }
    
    // Check sessions
    if (datasets.sessions && ['time_to_first_commit_ms', 'ai_burst_count', 'rework_ratio_est'].includes(field)) {
      const sample = input.sessions?.[0] || {};
      if (sample[field as keyof typeof sample] !== undefined) {
        found = true;
      }
    }
    
    if (found) {
      present.push(field);
    } else {
      missing.push(field);
    }
  }
  
  return {
    ...datasets,
    requiredFields: { present, missing }
  };
}

/**
 * Track a rule's execution and emission
 */
export class RuleTracer {
  private traces: Map<string, RuleTraceEntry> = new Map();
  private emittedInsightIds: Set<string> = new Set();
  private finalInsightIds: Set<string> = new Set();
  
  startRule(
    ruleId: string,
    input: PerformanceInputs,
    cicdStage?: string,
    insightClass?: string,
    orgKind?: string,
    toolScope?: string
  ): void {
    const dataAnalysis = analyzeDataAvailability(ruleId, input);
    
    this.traces.set(ruleId, {
      ruleId,
      cicdStage,
      insightClass,
      orgKind,
      toolScope,
      requiredDatasets: {
        engOutput: dataAnalysis.engOutput,
        productivity: dataAnalysis.productivity,
        sessions: dataAnalysis.sessions,
        githubSnapshot: dataAnalysis.githubSnapshot,
        overlap: dataAnalysis.overlap
      },
      requiredFields: dataAnalysis.requiredFields,
      minPoints: {
        required: 0, // Will be updated during execution
        actual: 0,
        sufficient: false
      },
      guardResults: {
        sparseHistory: false,
        blockedShape: false,
        insufficientData: false,
        stableOnly: false
      },
      emittedInsights: {
        count: 0,
        insights: []
      },
      pipelineFate: {
        keptLeaderVisible: false
      }
    });
  }
  
  recordGuardResult(
    ruleId: string,
    guardType: 'sparseHistory' | 'blockedShape' | 'insufficientData' | 'stableOnly',
    result: boolean
  ): void {
    const trace = this.traces.get(ruleId);
    if (trace) {
      trace.guardResults[guardType] = result;
    }
  }
  
  recordMinPoints(
    ruleId: string,
    required: number,
    actual: number
  ): void {
    const trace = this.traces.get(ruleId);
    if (trace) {
      trace.minPoints = {
        required,
        actual,
        sufficient: actual >= required
      };
    }
  }
  
  recordEmission(
    ruleId: string,
    insights: PerformanceInsight[]
  ): void {
    const trace = this.traces.get(ruleId);
    if (!trace) return;
    
    trace.emittedInsights = {
      count: insights.length,
      insights: insights.map(i => ({
        insightId: i.id,
        title: i.title?.slice(0, 60) || 'NO_TITLE',
        severity: i.severity || 'info',
        tier: i.tier,
        storyKey: i.storyKey,
        confidenceBadge: i.confidenceBadge
      }))
    };
    
    // Track emitted insight IDs
    insights.forEach(i => this.emittedInsightIds.add(i.id));
  }
  
  recordPipelineFate(
    ruleId: string,
    finalInsights: PerformanceInsight[]
  ): void {
    const trace = this.traces.get(ruleId);
    if (!trace) return;
    
    // Find which emitted insights survived
    const emittedIds = new Set(trace.emittedInsights.insights.map(i => i.insightId));
    const finalIds = finalInsights
      .filter(i => emittedIds.has(i.id))
      .map(i => i.id);
    
    trace.pipelineFate = {
      keptLeaderVisible: finalIds.length > 0,
      finalInsightIds: finalIds,
      droppedAtStep: finalIds.length === 0 ? 'SLOTTING_REJECT' : 'NONE',
      dropReason: finalIds.length === 0 
        ? `All ${trace.emittedInsights.count} insights dropped during slotting`
        : undefined
    };
    
    // Track final insight IDs
    finalIds.forEach(id => this.finalInsightIds.add(id));
  }
  
  recordDropReason(
    ruleId: string,
    step: RuleTraceEntry['pipelineFate']['droppedAtStep'],
    reason: string
  ): void {
    const trace = this.traces.get(ruleId);
    if (trace && trace.pipelineFate.droppedAtStep === undefined) {
      trace.pipelineFate.droppedAtStep = step;
      trace.pipelineFate.dropReason = reason;
    }
  }
  
  generateReport(
    totalRulesRegistered: number,
    pipelineData?: {
      rawEmitted?: number;
      afterMergeDedupe?: number;
      afterSlotting?: number;
      leaderVisibleFinal?: number;
      stageCounts?: {
        raw: Record<string, number>;
        dedupe: Record<string, number>;
        slotting: Record<string, number>;
      };
      slotAssignments?: Record<string, Record<string, Array<{ slot: string; insight: any }>>>;
    }
  ): RuleTraceReport {
    const rules = Array.from(this.traces.values());
    
    const executed = rules.length;
    const emitted = rules.filter(r => r.emittedInsights.count > 0).length;
    const leaderVisible = rules.filter(r => r.pipelineFate.keptLeaderVisible).length;
    
    // Top rules by emitted count
    const topRulesByEmitted = [...rules]
      .filter(r => r.emittedInsights.count > 0)
      .sort((a, b) => b.emittedInsights.count - a.emittedInsights.count);
    
    // Blocked rules by reason
    const blockedRulesByReason: Record<string, RuleTraceEntry[]> = {
      'NO_DATA': [],
      'MISSING_FIELDS': [],
      'GUARD_FAIL': [],
      'THRESHOLD': [],
      'STABLE_ONLY': [],
      'EXCEPTION': []
    };
    
    rules.filter(r => r.emittedInsights.count === 0).forEach(r => {
      const missingDatasets = Object.entries(r.requiredDatasets).filter(([_, v]) => !v).map(([k]) => k);
      if (missingDatasets.length > 0) {
        blockedRulesByReason['NO_DATA'].push(r);
      } else if (r.requiredFields.missing.length > 0) {
        blockedRulesByReason['MISSING_FIELDS'].push(r);
      } else if (r.guardResults.blockedShape || r.guardResults.sparseHistory || r.guardResults.insufficientData) {
        blockedRulesByReason['GUARD_FAIL'].push(r);
      } else if (r.guardResults.stableOnly) {
        blockedRulesByReason['STABLE_ONLY'].push(r);
      } else {
        blockedRulesByReason['THRESHOLD'].push(r);
      }
    });
    
    // By stage
    const byStage: Record<string, { emitted: number; leaderVisible: number }> = {};
    rules.forEach(r => {
      const stage = r.cicdStage || 'other';
      if (!byStage[stage]) {
        byStage[stage] = { emitted: 0, leaderVisible: 0 };
      }
      if (r.emittedInsights.count > 0) byStage[stage].emitted++;
      if (r.pipelineFate.keptLeaderVisible) byStage[stage].leaderVisible++;
    });
    
    // Pipeline survival by stage
    const pipelineSurvival: Record<string, {
      rawEmitted: number;
      afterMergeDedupe: number;
      afterSlotting: number;
      leaderVisibleFinal: number;
    }> = {};
    
    if (pipelineData?.stageCounts) {
      // Use actual pipeline stage counts
      ['plan-code', 'review-merge', 'deploy-operate'].forEach(stage => {
        pipelineSurvival[stage] = {
          rawEmitted: pipelineData.stageCounts.raw[stage] || 0,
          afterMergeDedupe: pipelineData.stageCounts.dedupe[stage] || 0,
          afterSlotting: pipelineData.stageCounts.slotting[stage] || 0,
          leaderVisibleFinal: pipelineData.stageCounts.slotting[stage] || 0
        };
      });
    } else {
      // Fallback: estimate from rules
      ['plan-code', 'review-merge', 'deploy-operate'].forEach(stage => {
        const stageRules = rules.filter(r => (r.cicdStage || 'other') === stage);
        const raw = stageRules.reduce((sum, r) => sum + r.emittedInsights.count, 0);
        const final = stageRules.filter(r => r.pipelineFate.keptLeaderVisible).length;
        pipelineSurvival[stage] = {
          rawEmitted: raw,
          afterMergeDedupe: Math.floor(raw * 0.9),
          afterSlotting: final,
          leaderVisibleFinal: final
        };
      });
    }
    
    // By new vs old
    const newRules = rules.filter(r => isNewRule(r.ruleId));
    const oldRules = rules.filter(r => !isNewRule(r.ruleId));
    
    const byNewVsOld = {
      new: {
        total: newRules.length,
        emitted: newRules.filter(r => r.emittedInsights.count > 0).length,
        leaderVisible: newRules.filter(r => r.pipelineFate.keptLeaderVisible).length
      },
      old: {
        total: oldRules.length,
        emitted: oldRules.filter(r => r.emittedInsights.count > 0).length,
        leaderVisible: oldRules.filter(r => r.pipelineFate.keptLeaderVisible).length
      }
    };
    
    // Drop reasons
    const dropReasons: Record<string, number> = {};
    rules.forEach(r => {
      if (!r.pipelineFate.keptLeaderVisible && r.pipelineFate.dropReason) {
        const reason = r.pipelineFate.dropReason.split(':')[0] || r.pipelineFate.dropReason;
        dropReasons[reason] = (dropReasons[reason] || 0) + 1;
      }
    });
    
    return {
      rules,
      aggregates: {
        totalRulesRegistered,
        totalRulesExecuted: executed,
        totalRulesEmitted: emitted,
        emittedToLeaderVisible: leaderVisible,
        byStage,
        byNewVsOld,
        dropReasons
      },
      topRulesByEmitted,
      blockedRulesByReason,
      pipelineSurvival,
      slotAssignments: pipelineData?.slotAssignments
    };
  }
  
  getTrace(ruleId: string): RuleTraceEntry | undefined {
    return this.traces.get(ruleId);
  }
}

// Global tracer instance
let globalTracer: RuleTracer | null = null;

export function getRuleTracer(): RuleTracer {
  if (!globalTracer) {
    globalTracer = new RuleTracer();
  }
  return globalTracer;
}

export function resetRuleTracer(): void {
  globalTracer = new RuleTracer();
}

