/**
 * CANONICAL PI REGISTRY
 * 
 * This is the SINGLE authoritative source for Performance Insights inventory.
 * No other file may independently define PI ordering, allowlists, canonical IDs,
 * stage quotas, or fallback inventory.
 * 
 * All orchestration logic must consume this registry exclusively.
 * 
 * FINAL DEMO COMPOSITION: 14 PIs
 * - Plan & Code: 4 PIs
 * - Review & Merge: 3 PIs
 * - Deploy & Operate: 3 PIs
 * - Executive Findings: 4 PIs (migrated as first-class canonical PIs)
 */

export interface CanonicalPIEntry {
  id: string;
  title: string;
  stage: 'plan-code' | 'review-merge' | 'deploy-operate';
  canonicalPriority: number; // Lower = higher priority
  renderOrder: number; // Explicit render order within stage
  isExecutiveFinding: boolean;
  isFallbackAllowed: boolean; // Can render as fallback if stage would otherwise be empty
  dedupeGroup?: string; // Group key for deduplication (e.g., 'review-latency')
  minimumConfidence: 'low' | 'medium' | 'high';
  demoRequired: boolean; // Must render in demo mode
  suppressIfWeak: boolean; // Suppress if confidence < minimumConfidence
  suppressIfBaseline: boolean; // Suppress if marked as "baseline forming"
  suppressIfNoDelta: boolean; // Suppress if no meaningful delta/comparison
  intendedStageQuotaBucket: number; // Stage bucket for balancing (0 = primary, 1 = secondary)
}

export const CANONICAL_PI_REGISTRY: ReadonlyArray<CanonicalPIEntry> = [
  // ============================================================
  // PLAN & CODE STAGE (4 canonical insights)
  // ============================================================
  {
    id: 'active-coding-time-by-ide',
    title: 'Active coding time by IDE',
    stage: 'plan-code',
    canonicalPriority: 1,
    renderOrder: 1,
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'coding-time',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false, // Allow even with low confidence for demo
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },
  {
    id: 'delivery-rate-ai-vs-non-ai',
    title: 'Delivery rate: AI vs Non-AI',
    stage: 'plan-code',
    canonicalPriority: 2,
    renderOrder: 2,
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'delivery',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },
  {
    id: 'telemetry-ai-focus-imbalance',
    title: 'AI focus imbalance detected',
    stage: 'plan-code',
    canonicalPriority: 3,
    renderOrder: 3,
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'ai-focus',
    minimumConfidence: 'low',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },
  {
    id: 'session-conditioned-pr-cycle-time-ai-vs-non-ai',
    title: 'PR cycle time: AI vs Non-AI',
    stage: 'plan-code',
    canonicalPriority: 4,
    renderOrder: 4,
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'pr-cycle-time',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },

  // ============================================================
  // REVIEW & MERGE STAGE (3 canonical insights)
  // ============================================================
  {
    id: 'reopen-pressure-spike',
    title: 'PR reopen pressure spike',
    stage: 'review-merge',
    canonicalPriority: 1,
    renderOrder: 5,
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'reopen',
    minimumConfidence: 'high',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },
  {
    id: 'reviewer-load-concentration',
    title: 'Reviewer load concentration',
    stage: 'review-merge',
    canonicalPriority: 2,
    renderOrder: 6,
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'reviewer-load',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },
  {
    id: 'revert-rate-by-ide',
    title: 'Revert rate by IDE',
    stage: 'review-merge',
    canonicalPriority: 3,
    renderOrder: 7,
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'revert',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },

  // ============================================================
  // DEPLOY & OPERATE STAGE (3 canonical insights)
  // ============================================================
  {
    id: 'delivery-velocity-by-workflow',
    title: 'Delivery velocity by workflow',
    stage: 'deploy-operate',
    canonicalPriority: 1,
    renderOrder: 8,
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'delivery-velocity',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },
  {
    id: 'change-failure-rate-spike-by-ide',
    title: 'Change failure rate spike by IDE',
    stage: 'deploy-operate',
    canonicalPriority: 2,
    renderOrder: 9,
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'change-failure',
    minimumConfidence: 'high',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },
  {
    id: 'synthesized-deployment-cadence',
    title: 'Synthesized deployment cadence',
    stage: 'deploy-operate',
    canonicalPriority: 3,
    renderOrder: 10,
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'deployment-cadence',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },

  // ============================================================
  // EXECUTIVE FINDINGS (4 insights - migrated as first-class canonical PIs)
  // ============================================================
  {
    id: 'executive-ai-reopen-pressure-risk',
    title: 'AI reopen pressure risk',
    stage: 'review-merge',
    canonicalPriority: 10,
    renderOrder: 11,
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'executive-reopen',
    minimumConfidence: 'high',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },
  {
    id: 'executive-ai-yield-optimization',
    title: 'AI yield optimization',
    stage: 'plan-code',
    canonicalPriority: 10,
    renderOrder: 12,
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'executive-yield',
    minimumConfidence: 'high',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },
  {
    id: 'executive-stable-deployment-acceleration',
    title: 'Stable deployment acceleration',
    stage: 'deploy-operate',
    canonicalPriority: 10,
    renderOrder: 13,
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'executive-deployment',
    minimumConfidence: 'high',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },
  {
    id: 'executive-small-pr-workflow-optimization',
    title: 'Small PR workflow optimization',
    stage: 'review-merge',
    canonicalPriority: 10,
    renderOrder: 14,
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'executive-small-pr',
    minimumConfidence: 'high',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  }
];

// Helper functions for registry queries
export const getCanonicalPIById = (id: string): CanonicalPIEntry | undefined => {
  return CANONICAL_PI_REGISTRY.find(entry => entry.id === id);
};

export const getCanonicalPIsByStage = (stage: 'plan-code' | 'review-merge' | 'deploy-operate'): CanonicalPIEntry[] => {
  return CANONICAL_PI_REGISTRY
    .filter(entry => entry.stage === stage)
    .sort((a, b) => a.renderOrder - b.renderOrder);
};

export const getExecutiveFindings = (): CanonicalPIEntry[] => {
  return CANONICAL_PI_REGISTRY
    .filter(entry => entry.isExecutiveFinding)
    .sort((a, b) => a.renderOrder - b.renderOrder);
};

export const getCanonicalPIIds = (): Set<string> => {
  return new Set(CANONICAL_PI_REGISTRY.map(entry => entry.id));
};

export const getFallbackAllowedPIs = (): CanonicalPIEntry[] => {
  return CANONICAL_PI_REGISTRY.filter(entry => entry.isFallbackAllowed);
};

export const getDedupeGroups = (): Map<string, CanonicalPIEntry[]> => {
  const groups = new Map<string, CanonicalPIEntry[]>();
  for (const entry of CANONICAL_PI_REGISTRY) {
    if (entry.dedupeGroup) {
      if (!groups.has(entry.dedupeGroup)) {
        groups.set(entry.dedupeGroup, []);
      }
      groups.get(entry.dedupeGroup)!.push(entry);
    }
  }
  return groups;
};
