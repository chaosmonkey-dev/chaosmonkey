/**
 * Final PI Content Contract
 * 
 * This file defines the canonical content contract for all 14 canonical PIs.
 * Every PI MUST conform to this contract before rendering.
 * 
 * ENFORCEMENT RULES:
 * - No title matching metric label
 * - No "TODO" in any field
 * - No "baseline forming" when seeded evidence exists
 * - No raw floating point values (must use formatting helpers)
 * - No empty What Changed / Why It Matters
 * - No generic boilerplate
 * - No generic "Operational variance" as primary risk unless no better risk exists
 */

// Formatting helpers will be used in generators
// import { formatNumber, formatPercentage, formatTime } from '../utils/numberFormatting';

/**
 * Operational title for each canonical PI
 * These replace metric labels with business-readable operational titles
 */
export const OPERATIONAL_TITLES: Record<string, string> = {
  // Plan & Code
  'active-coding-time-by-ide': 'Devin leads focused coding time, while Cursor shows stronger sustained work windows',
  'delivery-rate-ai-vs-non-ai': 'AI-assisted sessions are producing more commits per session than non-AI work',
  'telemetry-ai-focus-imbalance': 'High AI usage is not translating into consistent focus across tools',
  'session-conditioned-pr-cycle-time-ai-vs-non-ai': 'AI-assisted PR paths are faster, but cycle-time gains vary by workflow',
  'executive-ai-yield-optimization': 'AI workflow optimization shows 28% yield lift, with more upside at full adoption',

  // Review & Merge
  'reopen-pressure-spike': 'Reopen pressure is rising before merge, signaling review quality risk',
  'reviewer-load-concentration': 'Reviewer load is concentrated, creating merge scalability risk',
  'revert-rate-by-ide': 'Devin-linked work shows higher revert pressure than Cursor and VS Code',
  'executive-ai-reopen-pressure-risk': 'AI-heavy review paths need stronger quality gates before merge',
  'executive-small-pr-workflow-optimization': 'Smaller PR workflows are reducing review drag and speeding delivery',

  // Deploy & Operate
  'delivery-velocity-by-workflow': 'Delivery velocity remains strong, but workflow variance needs attention',
  'change-failure-rate-spike-by-ide': 'Change failure rate remains elevated despite stable deployment volume',
  'synthesized-deployment-cadence': 'Deployment cadence is healthy, with CI/CD throughput holding steady',
  'executive-stable-deployment-acceleration': 'Deployment cadence remains strong, but failure pressure needs quality gate attention'
};

/**
 * Content contract for each canonical PI
 * Defines required fields and validation rules
 */
export interface PIContentContract {
  id: string;
  finalTitle: string;
  operationalImpactLabel: string;
  operationalImpactValue: string;
  primaryRisk: string;
  cohort: string;
  executiveSummary: string;
  whatChanged: string;
  whyItMatters: string;
  evidenceAndContext: string;
  whatToDoNext: string;
  confidenceReasoning: string;
  demoNarrativePriority: number;
  requiredEvidenceSources: string[];
}

/**
 * Full content contracts for all 14 canonical PIs
 */
export const PI_CONTENT_CONTRACTS: PIContentContract[] = [
  // ============================================================
  // PLAN & CODE STAGE (5 PIs)
  // ============================================================
  {
    id: 'active-coding-time-by-ide',
    finalTitle: 'Devin leads focused coding time while Cursor shows stronger sustained work windows',
    operationalImpactLabel: 'Active coding time difference',
    operationalImpactValue: '+9% higher with Devin',
    primaryRisk: 'Higher active coding times may indicate longer sessions without breaks, which could lead to fatigue.',
    cohort: 'IDE Comparison',
    executiveSummary: 'Devin delivers 9% longer coding windows (158 vs 145 min), potentially increasing downstream review pressure. Audit session length vs PR size correlation to assess reviewer load impact.',
    whatChanged: 'Active coding time varies by IDE: Devin (158 min), Cursor (145 min), VS Code (92 min). Devin demonstrates 9% higher active coding time than Cursor.',
    whyItMatters: 'Sustained reviewer concentration increases merge dependency risk and limits scaling throughput. If Devin sessions produce larger PRs due to longer focus windows, reviewer capacity must expand proportionally or cycle times will extend as delivery volume grows.',
    evidenceAndContext: 'Based on 113 sessions. Devin: 158 min, Cursor: 145 min, VS Code: 92 min. High confidence based on production-grade demo evidence.',
    whatToDoNext: 'Investigate Devin workflow optimizations that enable higher active coding times. Consider session break reminders for sustained focus.',
    confidenceReasoning: 'High confidence based on production-grade demo evidence with sufficient session coverage.',
    demoNarrativePriority: 80,
    requiredEvidenceSources: ['session_active_coding_duration_minutes', 'ide_attribution']
  },
  {
    id: 'delivery-rate-ai-vs-non-ai',
    finalTitle: 'AI-assisted sessions produce more commits per session than non-AI work',
    operationalImpactLabel: 'Delivery rate improvement',
    operationalImpactValue: '+51% higher with AI',
    primaryRisk: 'Higher delivery rates may come at the cost of code quality if AI assistance is not properly reviewed.',
    cohort: 'AI vs Traditional',
    executiveSummary: 'AI sessions accelerate commit throughput (12.5 vs 8.3 commits/session), though quality indicators weaken as reviewer time compresses. Monitor commit frequency vs PR size before scaling beyond 50% adoption.',
    whatChanged: 'AI-assisted sessions deliver 12.5 commits per session versus 8.3 commits for traditional sessions, representing a 51% productivity improvement.',
    whyItMatters: 'Compressed review cycles correlate with elevated reopen pressure and downstream deployment instability. If AI-assisted sessions increase commit frequency without corresponding review capacity expansion, reviewer concentration risk increases and quality gates may fail to catch issues before merge.',
    evidenceAndContext: 'Based on 113 sessions. AI sessions: 12.5 commits/session (45 sessions). Non-AI sessions: 8.3 commits/session (68 sessions). High confidence based on production-grade demo evidence.',
    whatToDoNext: 'Scale AI-assisted development practices to capture the demonstrated productivity improvement. Optimize AI workflow integration to maximize delivery rate improvements.',
    confidenceReasoning: 'High confidence based on production-grade demo evidence with sufficient session coverage and clear delivery rate signal.',
    demoNarrativePriority: 95,
    requiredEvidenceSources: ['commit_count', 'ai_attribution', 'session_count']
  },
  {
    id: 'telemetry-ai-focus-imbalance',
    finalTitle: 'High AI usage not translating into consistent focus across tools',
    operationalImpactLabel: 'AI adoption imbalance',
    operationalImpactValue: '62 points between highest and lowest',
    primaryRisk: 'High AI focus imbalance may indicate uneven training or tool access restrictions.',
    cohort: 'AI Adoption',
    executiveSummary: 'AI adoption concentrates in Devin (92%) and Cursor (85%) while VS Code lags (23%), fragmenting workflow productivity. Standardize tool access to capture org-wide adoption value.',
    whatChanged: 'AI focus imbalance of 62 represents a 107% increase above the 30 baseline threshold. Devin leads at 92% AI adoption, VS Code lowest at 23%.',
    whyItMatters: 'Workflow fragmentation limits org-wide productivity gains and creates training overhead that slows onboarding. Uneven AI adoption across IDEs means AI productivity benefits are concentrated in specific workflows rather than distributed across the engineering organization, reducing the ROI of AI tooling investments.',
    evidenceAndContext: 'Based on 113 sessions. Devin: 92% AI adoption. Cursor: 85% AI adoption. VS Code: 23% AI adoption. High confidence based on production-grade demo evidence.',
    whatToDoNext: 'Address AI adoption imbalance through targeted training and tool access standardization. Monitor AI adoption patterns and provide targeted support for IDEs with lower adoption.',
    confidenceReasoning: 'High confidence based on production-grade demo evidence with sufficient session coverage and clear adoption imbalance signal.',
    demoNarrativePriority: 75,
    requiredEvidenceSources: ['ai_burst_count', 'ide_attribution']
  },
  {
    id: 'session-conditioned-pr-cycle-time-ai-vs-non-ai',
    finalTitle: 'AI-assisted PR paths faster but cycle-time gains vary by workflow',
    operationalImpactLabel: 'PR cycle time improvement',
    operationalImpactValue: '-24% faster with AI',
    primaryRisk: 'Faster cycle times may come at the cost of code quality if AI assistance reduces review depth.',
    cohort: 'AI vs Traditional',
    executiveSummary: 'AI PRs accelerate merge velocity (18.5 vs 24.2h cycle time), but review compression increases operational variance. Strengthen quality gates if cycle time gains correlate with elevated reopen pressure.',
    whatChanged: 'AI-assisted PRs have 18.5h cycle time versus 24.2h for traditional PRs, representing a 24% improvement.',
    whyItMatters: 'Review compression increases operational variance between teams and may reduce review depth below quality thresholds. If AI-assisted PRs accelerate merge velocity without maintaining review quality, reopen pressure will compound and create delivery delays that offset cycle time gains.',
    evidenceAndContext: 'Based on 113 sessions. AI PRs: 18.5h cycle time (45 PRs). Non-AI PRs: 24.2h cycle time (68 PRs). High confidence based on production-grade demo evidence.',
    whatToDoNext: 'Scale AI-assisted PR workflows to capture the demonstrated cycle time improvement. Optimize AI PR workflow integration to maximize cycle time improvements.',
    confidenceReasoning: 'High confidence based on production-grade demo evidence with sufficient PR coverage and clear cycle time improvement signal.',
    demoNarrativePriority: 85,
    requiredEvidenceSources: ['pr_cycle_time', 'ai_attribution', 'session_count']
  },
  {
    id: 'executive-ai-yield-optimization',
    finalTitle: 'AI workflow optimization shows 28% yield lift with more upside at full adoption',
    operationalImpactLabel: 'Overall yield improvement',
    operationalImpactValue: '+28% at current adoption',
    primaryRisk: 'Under-optimized AI workflows may limit yield gains. Ensure AI tooling is properly configured and developers are trained.',
    cohort: 'Executive Finding',
    executiveSummary: 'AI optimization delivers 28% yield lift at 68% adoption, but scaling requires reviewer capacity expansion. Address concentration risk before full adoption to prevent scalability limits.',
    whatChanged: 'AI workflow optimization delivers 28% overall yield improvement at 68% adoption. Scaling to full adoption could unlock 42% yield improvement.',
    whyItMatters: 'AI acceleration without reviewer expansion creates concentration risk that limits scalability. If AI workflow gains continue while reviewer capacity remains static, delivery throughput will bottleneck at review stage and the organization will be unable to scale AI benefits beyond current reviewer pool constraints.',
    evidenceAndContext: 'Based on 113 sessions. Overall yield improvement: 28%. Current AI adoption: 68%. Potential at full adoption: 42%. High confidence based on production-grade demo evidence synthesized from multiple Plan & Code metrics.',
    whatToDoNext: 'Scale AI workflow adoption to capture the full yield improvement potential. Optimize existing AI workflows to maximize yield gains.',
    confidenceReasoning: 'High confidence based on production-grade demo evidence synthesized from multiple Plan & Code metrics with consistent directional signals indicating AI productivity gains.',
    demoNarrativePriority: 98,
    requiredEvidenceSources: ['delivery_rate', 'pr_cycle_time', 'ai_adoption_rate']
  },

  // ============================================================
  // REVIEW & MERGE STAGE (5 PIs)
  // ============================================================
  {
    id: 'reopen-pressure-spike',
    finalTitle: 'Reopen pressure rising before merge signaling review quality risk',
    operationalImpactLabel: 'Reopen rate elevation',
    operationalImpactValue: '+70% above threshold',
    primaryRisk: 'Elevated reopen rates may indicate systemic code quality issues, rushed reviews, or unclear acceptance criteria.',
    cohort: 'Quality Signal',
    executiveSummary: 'Reopen pressure exceeds threshold (8.5% vs 5%), signaling review compression potentially correlated with workflow acceleration. Establish reviewer time-in-code minimums if Devin exceeds 10% sustainably.',
    whatChanged: 'Current PR reopen rate of 8.5% represents a 70% increase above the 5% baseline threshold. 7 reopened PRs out of 87 total indicates review quality concerns.',
    whyItMatters: 'Reopened PRs represent code that passed review but required additional cycles to fix, indicating review depth was insufficient to catch issues before merge. Each reopened PR adds approximately 36 hours of additional review effort and creates delivery delays that compound as reopen pressure increases above 10%.',
    evidenceAndContext: 'Based on 87 PRs analyzed. Reopened PRs: 7 (8.5%). Baseline threshold: 5%. Delta: +70%. High confidence based on production-grade demo evidence.',
    whatToDoNext: 'Immediate review process intervention required. Implement stricter review criteria, increase review depth, and clarify acceptance criteria to reduce reopen pressure.',
    confidenceReasoning: 'High confidence based on production-grade demo evidence with sufficient PR coverage and clear reopen rate signal above threshold.',
    demoNarrativePriority: 90,
    requiredEvidenceSources: ['pr_reopen_count', 'pr_total_count', 'review_metrics']
  },
  {
    id: 'reviewer-load-concentration',
    finalTitle: 'Reviewer load concentrated creating merge scalability risk',
    operationalImpactLabel: 'Load concentration elevation',
    operationalImpactValue: '+44% above target',
    primaryRisk: 'Reviewer burnout risk increases with sustained high concentration. Delivery delays compound as top reviewers become bottlenecks.',
    cohort: 'Workflow Intelligence',
    executiveSummary: 'Merge throughput depends on 72% concentration on top 3 reviewers, creating availability risk. Implement rotation if any reviewer exceeds 20% load for 2 consecutive weeks.',
    whatChanged: 'Top 3 reviewers handle 72% of all reviews, exceeding the 50% balanced distribution target by 44%. This concentration creates reviewer bottlenecks.',
    whyItMatters: 'Reviewer concentration creates single-point dependencies where PR approvals depend on individual availability. When 72% of reviews depend on 3 reviewers, delivery timelines become unpredictable and team resilience to individual unavailability (PTO, illness, departure) is severely compromised.',
    evidenceAndContext: 'Based on 95 reviews across 12 reviewers. Top 3 reviewers handle 72% of load. Target: 50%. Delta: +44%. High confidence based on production-grade demo evidence.',
    whatToDoNext: 'Implement reviewer load balancing and expand reviewer pool to reduce concentration. Rotate review assignments and provide reviewer training to broaden participation.',
    confidenceReasoning: 'High confidence based on production-grade demo evidence with sufficient review coverage and clear concentration signal above target.',
    demoNarrativePriority: 85,
    requiredEvidenceSources: ['reviewer_assignment_count', 'reviewer_unique_count', 'review_total_count']
  },
  {
    id: 'revert-rate-by-ide',
    finalTitle: 'Devin work shows higher revert pressure than Cursor and VS Code',
    operationalImpactLabel: 'Revert rate comparison',
    operationalImpactValue: 'Devin 4.1% vs VS Code 2.8%',
    primaryRisk: 'Devin revert rate of 4.1% is highest among IDEs and may indicate AI-assisted code quality issues.',
    cohort: 'Quality Signal',
    executiveSummary: 'Devin shows elevated revert pressure (4.1% vs 2.8% for VS Code), suggesting code may require additional validation. Establish integration testing gates if Devin exceeds 5% sustainably.',
    whatChanged: 'Average revert rate of 3.4% represents a 32% improvement below the 5% threshold. VS Code leads with 2.8%, followed by Cursor (3.2%) and Devin (4.1%).',
    whyItMatters: 'Reverted commits represent code that passed all quality gates but required rollback due to production issues, creating user impact and operational costs. Devin elevated revert rate suggests AI-assisted workflows may bypass quality validation that traditional workflows catch before merge.',
    evidenceAndContext: 'Based on 135 commits with 5 reverts (3.4% avg). Cursor: 3.2%, Devin: 4.1%, VS Code: 2.8%. Baseline: 5%. Improvement: 32%. High confidence based on production-grade demo evidence.',
    whatToDoNext: 'Investigate Devin revert rate drivers. Increase review depth for AI-assisted code and ensure AI-generated code receives thorough quality checks.',
    confidenceReasoning: 'High confidence based on production-grade demo evidence with sufficient commit coverage and clear revert rate signal below threshold.',
    demoNarrativePriority: 80,
    requiredEvidenceSources: ['revert_count', 'commit_count', 'ide_attribution']
  },
  {
    id: 'executive-ai-reopen-pressure-risk',
    finalTitle: 'AI-heavy review paths need stronger quality gates before merge',
    operationalImpactLabel: 'AI reopen pressure elevation',
    operationalImpactValue: '+65% higher than non-AI',
    primaryRisk: 'Without intervention, AI-assisted code quality issues may compound as AI adoption scales.',
    cohort: 'Executive Finding',
    executiveSummary: 'AI-heavy paths need stronger quality gates—reopen pressure 65% higher (11.2% vs 6.8%) and revert rate elevated (4.8% vs 2.9%). Without intervention, quality issues will compound as adoption scales.',
    whatChanged: 'AI-assisted PRs demonstrate 11.2% reopen rate versus 6.8% for traditional workflows, representing 65% elevated reopen pressure. AI revert rate of 4.8% also exceeds non-AI baseline of 2.9%.',
    whyItMatters: 'AI-assisted code quality issues compound as AI adoption scales, requiring rollback procedures that strain operational capacity. If AI reopen and revert rates remain elevated while AI adoption increases, the organization will face increasing rollback frequency that compromises deployment confidence and may require velocity reduction.',
    evidenceAndContext: 'Synthesized from 95 sessions across Review & Merge metrics. AI reopen rate: 11.2%, non-AI: 6.8%. AI revert rate: 4.8%, non-AI: 2.9%. Overall risk score: 72/100. High confidence based on production-grade demo evidence.',
    whatToDoNext: 'Implement enhanced review quality gates for AI-assisted code. Increase review depth, add automated quality checks, and provide AI code quality training to reduce reopen pressure.',
    confidenceReasoning: 'High confidence based on production-grade demo evidence synthesized from multiple Review & Merge metrics with consistent directional signals indicating AI quality concerns.',
    demoNarrativePriority: 95,
    requiredEvidenceSources: ['pr_reopen_rate', 'revert_rate', 'ai_attribution']
  },
  {
    id: 'executive-small-pr-workflow-optimization',
    finalTitle: 'Smaller PR workflows are reducing review drag and speeding delivery',
    operationalImpactLabel: 'Velocity improvement from small PRs',
    operationalImpactValue: '+50% faster cycle time',
    primaryRisk: 'Overemphasis on small PRs may encourage code fragmentation and reduce architectural coherence.',
    cohort: 'Executive Finding',
    executiveSummary: 'Small PRs reduce review drag and accelerate delivery (14.2 vs 28.5h cycle time), but overemphasis may fragment architecture. Increase to 80% while monitoring architectural integrity.',
    whatChanged: 'Small PRs (62% of total) complete in 14.2h versus 28.5h for large PRs, representing 50% velocity improvement. Current small PR adoption at 62% indicates room for optimization.',
    whyItMatters: 'Small PR acceleration balances velocity gains against architectural coherence risks. Overemphasis on small PRs may encourage code fragmentation that increases technical debt and reduces long-term maintainability, requiring architectural integrity monitoring to prevent velocity gains from compromising system stability.',
    evidenceAndContext: 'Synthesized from 87 PRs analyzed. Small PR rate: 62%. Small PR cycle time: 14.2h, large PR: 28.5h. Velocity improvement: 50%. Potential gain at 80% adoption: +18%. High confidence based on production-grade demo evidence.',
    whatToDoNext: 'Increase small PR rate from 62% to target 80% to capture additional 18% velocity gain. Implement PR size guidelines, encourage incremental development, and provide small PR training.',
    confidenceReasoning: 'High confidence based on production-grade demo evidence synthesized from PR size distribution and cycle time metrics with clear velocity improvement signal.',
    demoNarrativePriority: 90,
    requiredEvidenceSources: ['pr_size_distribution', 'pr_cycle_time', 'small_pr_rate']
  },

  // ============================================================
  // DEPLOY & OPERATE STAGE (4 PIs)
  // ============================================================
  {
    id: 'delivery-velocity-by-workflow',
    finalTitle: 'Delivery velocity remains strong, but workflow variance needs attention',
    operationalImpactLabel: 'Velocity elevation above target',
    operationalImpactValue: '+40% above target',
    primaryRisk: 'Slow delivery velocity reduces market responsiveness and competitive agility.',
    cohort: 'Workflow Intelligence',
    executiveSummary: 'Delivery velocity exceeds target (4.2 vs 3.0 days), but CI/CD workflow variance creates inconsistent governance. Investigate testing bottlenecks if VS Code exceeds 4.5 days for 2 consecutive weeks.',
    whatChanged: 'Current delivery velocity of 4.2 days represents a 40% increase above the 3.0 day target threshold. Workflow bottlenecks in testing, approval, or deployment processes are likely contributors.',
    whyItMatters: 'Workflow variance in CI/CD pipelines creates inconsistent release governance that may block time-sensitive releases. If VS Code cycle time exceeds 4.5 days, critical security patches and bug fixes may be delayed, creating competitive disadvantage and potential SLA breaches for time-sensitive deployments.',
    evidenceAndContext: 'Based on 72 deployments analyzed. Current velocity: 4.2 days. Target: 3.0 days. Delta: +40%. High confidence based on production-grade demo evidence.',
    whatToDoNext: 'Implement delivery pipeline optimization to reduce cycle time. Automate testing, streamline approval processes, and optimize deployment infrastructure to achieve target velocity.',
    confidenceReasoning: 'High confidence based on production-grade demo evidence with sufficient deployment coverage and clear velocity signal above target.',
    demoNarrativePriority: 85,
    requiredEvidenceSources: ['deployment_lead_time', 'workflow_attribution', 'deployment_count']
  },
  {
    id: 'change-failure-rate-spike-by-ide',
    finalTitle: 'Change failure rate remains elevated despite stable deployment volume',
    operationalImpactLabel: 'Failure rate elevation',
    operationalImpactValue: '+60% above target',
    primaryRisk: 'Elevated failure rates at current deployment frequency may increase with further acceleration.',
    cohort: 'Quality Signal',
    executiveSummary: 'Deployment cadence healthy, but elevated failure pressure (8.0% vs 5.0%) suggests velocity outpaces validation. Devin failure rate (9.2%) indicates workflows may bypass quality gates—implement canary deployments.',
    whatChanged: 'Current change failure rate of 8.0% represents a 60% increase above the 5.0% baseline threshold. 6 failed deployments out of 75 total indicates stability concerns.',
    whyItMatters: 'Elevated failure rates at current deployment frequency indicate velocity gains may be outpacing validation rigor. Devin failure rate suggests AI-assisted workflows may bypass quality gates—without intervention, failure pressure will compound as deployment frequency increases, requiring rollback procedures that strain operational capacity.',
    evidenceAndContext: 'Based on 75 deployments analyzed. Failed deployments: 6 (8.0%). Baseline threshold: 5.0%. Delta: +60%. High confidence based on production-grade demo evidence.',
    whatToDoNext: 'Optimize quality gates to reduce failure rate while maintaining deployment cadence. Strengthen pre-deployment validation and automated testing to improve stability.',
    confidenceReasoning: 'High confidence based on production-grade demo evidence with sufficient deployment coverage and clear failure rate signal above threshold.',
    demoNarrativePriority: 90,
    requiredEvidenceSources: ['deployment_failure_count', 'deployment_success_count', 'ide_attribution']
  },
  {
    id: 'synthesized-deployment-cadence',
    finalTitle: 'Deployment cadence is healthy, with CI/CD throughput holding steady',
    operationalImpactLabel: 'Deployment cadence improvement',
    operationalImpactValue: '+50% above baseline',
    primaryRisk: 'Lead time may increase as deployment cadence scales. Monitor pipeline performance.',
    cohort: 'Delivery Pipeline',
    executiveSummary: 'Deployment cadence healthy (12/week vs 8 baseline) with efficient CI/CD throughput, but lead time variance indicates pipeline bottlenecks. Monitor performance as frequency increases to maintain stability.',
    whatChanged: 'Deployment frequency increased to 12 per week from 8 baseline, representing 50% improvement. Average lead time of 4.5 hours indicates efficient delivery pipeline.',
    whyItMatters: 'Lead time variance indicates pipeline bottlenecks in specific workflows that may block time-sensitive releases. Monitor pipeline performance as frequency increases to ensure CI/CD stages can maintain stability at scale without requiring velocity reduction to prevent failure pressure from compounding.',
    evidenceAndContext: 'Based on 165 deployments. Weekly frequency: 12 (baseline: 8). Average lead time: 4.5h. Improvement: 50%. High confidence based on production-grade demo evidence.',
    whatToDoNext: 'Maintain current deployment cadence and lead time performance. Monitor pipeline bottlenecks as frequency increases and optimize CI/CD stages proactively.',
    confidenceReasoning: 'High confidence based on production-grade demo evidence with sufficient deployment coverage and clear cadence improvement signal.',
    demoNarrativePriority: 80,
    requiredEvidenceSources: ['deployment_frequency', 'deployment_lead_time', 'deployment_count']
  },
  {
    id: 'executive-stable-deployment-acceleration',
    finalTitle: 'Deployment cadence remains strong, but failure pressure needs quality gate attention',
    operationalImpactLabel: 'Deployment frequency improvement',
    operationalImpactValue: '+50% above baseline',
    primaryRisk: 'Failure rate of 6% at current cadence may increase with further acceleration. Quality gate optimization required.',
    cohort: 'Executive Finding',
    executiveSummary: 'Deployment frequency strong (12/week, 50% above baseline) but 6% failure rate requires quality gate optimization. Strengthen pre-deployment validation if failure rate exceeds 8% as frequency increases.',
    whatChanged: 'Deployment frequency of 12 per week represents 50% improvement above 8 baseline. Success rate of 94% is strong, but 6% failure rate requires quality gate optimization.',
    whyItMatters: 'Strong cadence with elevated failure rate indicates quality gate optimization is required to maintain stability at scale. If failure rate exceeds 8% as deployment frequency increases, rollback procedures will strain operational capacity and may require velocity reduction to prevent deployment confidence from degrading.',
    evidenceAndContext: 'Based on 165 deployments. Weekly frequency: 12 (baseline: 8). Success rate: 94%. Failure rate: 6%. Frequency improvement: 50%. High confidence based on production-grade demo evidence.',
    whatToDoNext: 'Optimize quality gates to reduce failure rate while maintaining deployment cadence. Strengthen pre-deployment validation and automated testing to improve stability.',
    confidenceReasoning: 'High confidence based on production-grade demo evidence synthesized from deployment metrics with clear cadence signal and manageable failure rate.',
    demoNarrativePriority: 95,
    requiredEvidenceSources: ['deployment_frequency', 'deployment_success_rate', 'deployment_failure_rate']
  }
];

/**
 * Get content contract for a specific PI
 */
export function getContentContract(piId: string): PIContentContract | undefined {
  return PI_CONTENT_CONTRACTS.find(contract => contract.id === piId);
}

/**
 * Validate that an insight conforms to the content contract
 */
export function validateContentContract(insight: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const contract = getContentContract(insight.id);

  if (!contract) {
    errors.push(`No content contract found for PI ID: ${insight.id}`);
    return { valid: false, errors };
  }

  // Check title is operational (not metric label)
  if (insight.title === contract.id.replace(/-/g, ' ') || 
      insight.title.includes('by IDE') ||
      insight.title.includes('vs Non-AI') ||
      insight.title.includes('by workflow')) {
    errors.push(`PI ${insight.id} has metric label as title: "${insight.title}"`);
  }

  // Check for TODO markers
  const fieldsToCheck = ['description', 'recommendation', 'executiveSummary', 'whatChanged', 'whyItMatters', 'whatToDoNext'];
  for (const field of fieldsToCheck) {
    if (insight[field] && insight[field].toLowerCase().includes('todo')) {
      errors.push(`PI ${insight.id} has TODO in ${field}`);
    }
  }

  // Check for "baseline forming" when demo evidence exists
  if (insight.demoFlag === 'demo_primary' && insight.description?.toLowerCase().includes('baseline forming')) {
    errors.push(`PI ${insight.id} has "baseline forming" despite demo evidence`);
  }

  // Check for raw floating point values in evidence
  if (insight.evidence) {
    for (const ev of insight.evidence) {
      if (typeof ev.value === 'number') {
        const strVal = String(ev.value);
        if (strVal.includes('0000000') || strVal.includes('9999999')) {
          errors.push(`PI ${insight.id} has raw float in evidence: ${ev.metric}=${ev.value}`);
        }
      }
    }
  }

  // Check for empty What Changed / Why It Matters
  if (!insight.whatChanged || insight.whatChanged.trim().length === 0) {
    errors.push(`PI ${insight.id} has empty whatChanged`);
  }
  if (!insight.whyItMatters || insight.whyItMatters.trim().length === 0) {
    errors.push(`PI ${insight.id} has empty whyItMatters`);
  }

  // Check for generic "Operational variance" as primary risk
  if (insight.primaryRisk === 'Operational variance' || insight.primaryRisk === 'operational variance') {
    // Only allow if no better risk exists (check if contract has better risk)
    if (contract.primaryRisk !== 'Operational variance') {
      errors.push(`PI ${insight.id} has generic "Operational variance" as primary risk, should be: "${contract.primaryRisk}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}
