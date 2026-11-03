/**
 * ============================================================================ 
 * PERFORMANCE INSIGHTS V2 — CHOKE POINT FOR CONTROL
 * ============================================================================
 * 
 * ✅ SINGLE CONTROL POINT:
 * - This file is the ONLY place that controls PI visibility, order, and stage
 * - No other file should filter, hide, or reorder Performance Insights
 * - V1 deduping/diversity logic does NOT apply to V2 insights
 * 
 * ✅ HOW TO CONTROL PIs:
 * 
 * TO ADD A PI:
 * 1. Add the ID to the appropriate stage array below (MVP_PI_ALLOWLIST_BY_STAGE)
 * 2. Implement the PI in computeV2PerformanceInsights.ts
 * 3. Done - PI will render in the specified stage and order
 * 
 * TO HIDE A PI:
 * 1. Remove the ID from the MVP_PI_ALLOWLIST_BY_STAGE array below
 * 2. Done - PI will no longer render (but still computed)
 * 
 * TO CHANGE ORDER:
 * 1. Reorder IDs within the stage arrays in MVP_PI_ALLOWLIST_BY_STAGE
 * 2. Order is top-to-bottom within each array
 * 3. Stage order is: plan_code → review_merge → deploy_operate
 * 
 * TO CHANGE STAGE:
 * 1. Move the ID from one stage array to another in MVP_PI_ALLOWLIST_BY_STAGE
 * 2. Done - PI will render in the new stage
 * 
 * ✅ MVP vs FULL MODE:
 * - FULL engine (computeV2PerformanceInsights.ts) always computes ~34 PIs
 * - MVP is a presentation decision, NOT a compute decision
 * - MVP = subset of FULL output controlled by this file
 * - This prevents re-introduction of MVP engines or silent fallbacks
 * 
 * ✅ ENFORCEMENT:
 * - filterAndOrderInsightsByAllowlist() is the only filter applied
 * - No other filtering logic can override this manifest
 * - Title-based hiding is disabled for V2 mode
 * 
 * ============================================================================ 
 * 
 * PI V2 MVP Manifest - Single Source of Truth for Performance Insights
 * 
 * CONTROLS:
 * - PI inclusion: Add/remove IDs from the arrays below
 * - Stage assignment: Move IDs between plan_code/review_merge/deploy_operate arrays
 * - Ordering: Arrays define render order (top to bottom)
 * 
 * RULES:
 * - If a PI is in the manifest, it WILL render
 * - If a PI is NOT in the manifest, it WILL NOT render
 * - No other filtering logic can override this manifest
 * - Title-based hiding is disabled for V2 mode
 * - V1 engine deduping/diversity does NOT apply to V2 insights
 * 
 * HOW TO ADD A PI:
 * 1. Add the ID to the appropriate stage array below
 * 2. Implement the PI in computeV2PerformanceInsights.ts
 * 3. Done - no other changes required
 * 
 * HOW TO REMOVE A PI:
 * 1. Remove the ID from the manifest array below
 * 2. Done - PI will no longer render
 * 
 * HOW TO CHANGE STAGE:
 * 1. Move the ID to a different stage array
 * 2. Done - PI will render in new stage
 */

export const MVP_PI_ALLOWLIST_BY_STAGE = {
  'plan-code': [
    'active-coding-time-by-ide',
    'delivery-rate-ai-vs-non-ai',
    'telemetry-ai-focus-imbalance',
    'session-conditioned-pr-cycle-time-ai-vs-non-ai',
    'executive-ai-yield-optimization'
    // PILOT READINESS: 5/5 GREEN - all use real telemetry data
  ],

  'review-merge': [
    'reviewer-load-concentration',
    'executive-small-pr-workflow-optimization'
    // PILOT READINESS: 2/7 GREEN (removed 5 RED PIs)
    // DISABLED: reopen-pressure-spike (RED - requires reopened_prs, by_ide)
    // DISABLED: revert-rate-by-ide (RED - requires revert_metrics)
    // DISABLED: executive-ai-reopen-pressure-risk (RED - requires ai_reopen_rate, non_ai_reopen_rate)
    // DISABLED: session-conditioned-pr-cycle-time-ai-vs-non-ai (moved to plan-code)
    // DISABLED: branch-stagnation-risk-ai-vs-non-ai (not in canonical classification)
    // DISABLED: review-latency-spike-by-ide (not in canonical classification)
    // DISABLED: pr-review-cycles-by-ide (not in canonical classification)
  ],

  'deploy-operate': [
    'synthesized-deployment-cadence',
    'delivery-velocity-by-workflow',
    'change-failure-rate-spike-by-ide'
    // PILOT READINESS: 3/3 GREEN (all use real or derived data)
    // DISABLED: executive-stable-deployment-acceleration (RED - requires success_rate, by_ide)
    // DISABLED: failed-deployment-pressure (not in canonical classification)
  ]
} as const;

export const STABLE_ORDER = true;

// Helper function to filter and order insights by MVP allowlist
export function filterAndOrderInsightsByAllowlist(insights: any[]): any[] {
  
  // Filter to only allowlisted IDs
  const filtered = insights.filter(insight => {
    const inPlanCode = MVP_PI_ALLOWLIST_BY_STAGE['plan-code'].includes(insight.id as any);
    const inReviewMerge = MVP_PI_ALLOWLIST_BY_STAGE['review-merge'].includes(insight.id as any);
    const inDeployOperate = MVP_PI_ALLOWLIST_BY_STAGE['deploy-operate'].includes(insight.id as any);
    return inPlanCode || inReviewMerge || inDeployOperate;
  });

  
  // Order by stage and allowlist order
  const ordered: any[] = [];
  
  // Add Plan & Code in order
  for (const id of MVP_PI_ALLOWLIST_BY_STAGE['plan-code']) {
    const found = filtered.find(i => i.id === id);
    if (found) ordered.push(found);
  }
  
  // Add Review & Merge in order
  for (const id of MVP_PI_ALLOWLIST_BY_STAGE['review-merge']) {
    const found = filtered.find(i => i.id === id);
    if (found) ordered.push(found);
  }
  
  // Add Deploy & Operate in order
  for (const id of MVP_PI_ALLOWLIST_BY_STAGE['deploy-operate']) {
    const found = filtered.find(i => i.id === id);
    if (found) ordered.push(found);
  }

  // DEV-ONLY LOGGING: Track rendered vs dropped PIs
  if (import.meta.env.DEV) {
    const renderedIds = ordered.map(i => i.id);
    const droppedIds = insights.filter(i => !renderedIds.includes(i.id)).map(i => i.id);

    console.info('[PI_TRACE_MANIFEST_FILTER]', {
      inCount: insights.length,
      outCount: ordered.length,
      outIds: ordered.map(r => r.id),
      file: 'piV2Manifest.ts',
    });

    console.info('[PI_V2_MANIFEST_FILTER]', {
      rendered: renderedIds,
      droppedCount: droppedIds.length,
      dropped: droppedIds,
      source: 'piV2Manifest.ts - filterAndOrderInsightsByAllowlist()'
    });

    // ── Insufficient PI Report ──
    const insufficientPIs = ordered.filter(
      (i: any) => i.insufficientSignal === true || i.hasData === false
    );
    if (insufficientPIs.length > 0) {
      const stageFor = (id: string) =>
        MVP_PI_ALLOWLIST_BY_STAGE['plan-code'].includes(id as any) ? 'plan-code'
        : MVP_PI_ALLOWLIST_BY_STAGE['review-merge'].includes(id as any) ? 'review-merge'
        : MVP_PI_ALLOWLIST_BY_STAGE['deploy-operate'].includes(id as any) ? 'deploy-operate'
        : 'unknown';
      const report = insufficientPIs.map((i: any) => ({
        id: i.id,
        title: i.title,
        stage: stageFor(i.id),
        rightMetric: i.rightMetric,
        missingInputs: [
          ...(i.insufficientSignal ? ['insufficientSignal=true'] : []),
          ...(i.hasData === false ? ['hasData=false'] : []),
          ...(i.n === 0 ? ['n=0 (zero contributing units)'] : []),
          ...(i.coveragePct === 0 ? ['coveragePct=0'] : []),
        ],
        recommendation: i.recommendation || '—',
      }));

      console.groupCollapsed(
        `%c[INSUFFICIENT PI REPORT] ${insufficientPIs.length} insight(s) lack data`,
        'color: #ff4444; font-weight: bold; font-size: 12px'
      );
      for (const entry of report) {
        console.log(
          `%c[${entry.stage}] ${entry.id}`,
          'color: #ff8800; font-weight: bold',
          '\n  title:', entry.title,
          '\n  rightMetric:', entry.rightMetric,
          '\n  missing:', entry.missingInputs.join(', '),
          '\n  recommendation:', entry.recommendation
        );
      }
      console.groupEnd();
    }
  }

  return ordered;
}

// Helper function to get stage for an insight
export function getStageForInsight(insightId: string): 'plan-code' | 'review-merge' | 'deploy-operate' | null {
  if (MVP_PI_ALLOWLIST_BY_STAGE['plan-code'].includes(insightId as any)) return 'plan-code';
  if (MVP_PI_ALLOWLIST_BY_STAGE['review-merge'].includes(insightId as any)) return 'review-merge';
  if (MVP_PI_ALLOWLIST_BY_STAGE['deploy-operate'].includes(insightId as any)) return 'deploy-operate';
  return null;
}
