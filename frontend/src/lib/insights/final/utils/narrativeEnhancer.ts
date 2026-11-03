/**
 * Canonical Narrative Enhancement System
 * 
 * Migrated from V2 operationalNarrativeEnhancer.ts
 * Transforms Performance Insights from metric statements into executive intelligence narratives.
 * Focuses on operational implications, AI ROI interpretation, and workflow intelligence.
 * 
 * Key changes from V2:
 * - Treats seeded demo data as production-grade evidence
 * - Removes "baseline forming" language when demo evidence exists
 * - Preserves high-signal V2 copy patterns
 * - Supports deterministic executive narratives for demo mode
 */

import type { CanonicalInsight } from '../types';

export type NarrativeContext = {
  insightId: string;
  stage: 'plan-code' | 'review-merge' | 'deploy-operate';
  metricValue: number;
  comparisonData: Record<string, number>;
  hasAIVsNonAIData: boolean;
  aiAdvantage: number | null;
  workflowFragmentation: number | null;
  operationalRisk: 'low' | 'medium' | 'high';
  executiveReadiness: 'demo_ready' | 'narrative_strong' | 'needs_enhancement';
  hasDemoEvidence: boolean;
};

export type EnhancedNarrative = {
  title: string;
  subtitle: string;
  operationalImplication: string;
  workflowIntelligence: string;
  aiRoiInterpretation: string;
  downstreamImpact: string;
  executiveSummary: string;
  recommendedActions: string[];
  riskLevel: 'low' | 'medium' | 'high';
  confidenceLevel: 'high' | 'medium' | 'low';
  flagshipPotential: number;
};

/**
 * Executive Intelligence Narrative Templates
 * Preserved from V2 with high-signal copy patterns
 */
const EXECUTIVE_NARRATIVE_TEMPLATES = {
  // AI ROI Templates
  ai_advantage: {
    high: {
      title: "AI workflows create measurable delivery acceleration",
      implication: "AI-assisted development shows significant efficiency gains with quality tradeoffs carefully managed",
      intelligence: "AI workflow optimization delivers significant productivity gains",
      roi: "AI investment delivers 2-3x productivity uplift while maintaining code quality standards",
      impact: "Faster delivery cycles enable market responsiveness and competitive advantage"
    },
    medium: {
      title: "AI tools show promising workflow improvements",
      implication: "Early AI adoption indicates productivity benefits with optimization opportunities",
      intelligence: "AI workflow patterns indicate optimization potential",
      roi: "AI tools demonstrate positive ROI with focused enhancement potential",
      impact: "Incremental delivery improvements support business growth objectives"
    },
    low: {
      title: "AI workflow optimization opportunity identified",
      implication: "AI tools underutilized relative to potential - workflow adjustment needed",
      intelligence: "AI workflow optimization requires strategic adjustment",
      roi: "AI ROI achievable with targeted workflow changes and enablement",
      impact: "Workflow optimization required to realize AI investment benefits"
    }
  },

  // Workflow Intelligence Templates
  workflow_intelligence: {
    high: {
      title: "Workflow fragmentation creates delivery bottlenecks",
      implication: "Inconsistent development patterns across IDEs reduce team velocity and quality",
      intelligence: "Standardized workflows could improve delivery efficiency by 30-40%",
      roi: "Workflow optimization delivers operational efficiency gains",
      impact: "Fragmentation creates operational overhead and quality variability"
    },
    medium: {
      title: "Workflow patterns show optimization opportunities",
      implication: "Some workflow inconsistencies affecting team performance",
      intelligence: "Targeted workflow standardization could yield efficiency gains",
      roi: "Workflow refinement provides operational benefits",
      impact: "Workflow refinement supports consistent delivery outcomes"
    },
    low: {
      title: "Team workflows show consistent patterns",
      implication: "Standardized development practices support predictable delivery",
      intelligence: "Current workflow foundation supports scaling and optimization",
      roi: "Workflow consistency enables operational stability",
      impact: "Consistent workflows enable reliable delivery operations"
    }
  },

  // Operational Risk Templates
  operational_risk: {
    high: {
      title: "Operational risks require immediate attention",
      implication: "Current patterns pose significant delivery and quality risks",
      intelligence: "Risk mitigation critical for maintaining service reliability",
      roi: "Risk management preserves business value and customer trust",
      impact: "Unaddressed risks could impact customer experience and business continuity"
    },
    medium: {
      title: "Operational risks identified for proactive management",
      implication: "Moderate risk factors require monitoring and mitigation",
      intelligence: "Proactive risk management improves delivery predictability",
      roi: "Risk reduction provides operational stability benefits",
      impact: "Risk reduction supports stable delivery operations"
    },
    low: {
      title: "Operational practices show good risk management",
      implication: "Current processes effectively manage delivery risks",
      intelligence: "Strong risk management foundation supports scaling",
      roi: "Risk management enables confident operations",
      impact: "Well-managed risks enable confident delivery operations"
    }
  },

  // Review Efficiency Templates
  review_efficiency: {
    high: {
      title: "Review efficiency drives delivery velocity",
      implication: "Effective review processes enable rapid, high-quality delivery",
      intelligence: "Review optimization creates competitive delivery advantage",
      roi: "Review efficiency accelerates time-to-market",
      impact: "Efficient reviews support continuous delivery and innovation"
    },
    medium: {
      title: "Review process optimization opportunities identified",
      implication: "Review efficiency improvements could accelerate delivery",
      intelligence: "Review refinement supports faster delivery cycles",
      roi: "Review optimization provides productivity gains",
      impact: "Review enhancements improve team productivity"
    },
    low: {
      title: "Review bottlenecks impacting delivery velocity",
      implication: "Review process inefficiencies slow delivery and increase costs",
      intelligence: "Review process reengineering required for delivery acceleration",
      roi: "Review improvement reduces delivery costs",
      impact: "Review bottlenecks create delivery delays and quality risks"
    }
  },

  // Deployment Stability Templates
  deployment_stability: {
    high: {
      title: "Deployment stability enables reliable delivery",
      implication: "Robust deployment practices support consistent service delivery",
      intelligence: "Stability optimization creates operational excellence",
      roi: "Deployment stability reduces operational costs",
      impact: "Reliable deployments maintain customer trust and business continuity"
    },
    medium: {
      title: "Deployment stability shows improvement opportunities",
      implication: "Deployment process refinement could improve reliability",
      intelligence: "Stability enhancements support delivery confidence",
      roi: "Deployment improvements reduce failure costs",
      impact: "Deployment improvements reduce operational overhead"
    },
    low: {
      title: "Deployment instability creates business risk",
      implication: "Deployment failures impact service reliability and customer experience",
      intelligence: "Deployment stability critical for business operations",
      roi: "Stability improvements protect business value",
      impact: "Unstable deployments damage customer trust and increase costs"
    }
  }
};

/**
 * Insight metadata for narrative classification
 * Simplified from V2 insightClassifications.ts
 */
const INSIGHT_METADATA: Record<string, {
  aiRoiRelevance: boolean;
  classifications: string[];
  flagshipPotential: number;
  reviewEfficiencySignal: boolean;
  deploymentStabilitySignal: boolean;
  workflowIntelligenceValue: boolean;
}> = {
  'delivery-rate-ai-vs-non-ai': {
    aiRoiRelevance: true,
    classifications: ['flagship_candidate', 'ai_roi'],
    flagshipPotential: 90,
    reviewEfficiencySignal: false,
    deploymentStabilitySignal: false,
    workflowIntelligenceValue: true
  },
  'executive-ai-yield-optimization': {
    aiRoiRelevance: true,
    classifications: ['flagship_candidate', 'ai_roi'],
    flagshipPotential: 95,
    reviewEfficiencySignal: false,
    deploymentStabilitySignal: false,
    workflowIntelligenceValue: true
  },
  'session-conditioned-pr-cycle-time-ai-vs-non-ai': {
    aiRoiRelevance: true,
    classifications: ['ai_roi'],
    flagshipPotential: 85,
    reviewEfficiencySignal: false,
    deploymentStabilitySignal: false,
    workflowIntelligenceValue: false
  },
  'reopen-pressure-spike': {
    aiRoiRelevance: false,
    classifications: ['operational_risk'],
    flagshipPotential: 80,
    reviewEfficiencySignal: false,
    deploymentStabilitySignal: false,
    workflowIntelligenceValue: false
  },
  'executive-ai-reopen-pressure-risk': {
    aiRoiRelevance: true,
    classifications: ['operational_risk', 'ai_roi'],
    flagshipPotential: 90,
    reviewEfficiencySignal: false,
    deploymentStabilitySignal: false,
    workflowIntelligenceValue: false
  },
  'reviewer-load-concentration': {
    aiRoiRelevance: false,
    classifications: ['workflow_intelligence'],
    flagshipPotential: 75,
    reviewEfficiencySignal: true,
    deploymentStabilitySignal: false,
    workflowIntelligenceValue: true
  },
  'executive-small-pr-workflow-optimization': {
    aiRoiRelevance: false,
    classifications: ['workflow_intelligence'],
    flagshipPotential: 85,
    reviewEfficiencySignal: true,
    deploymentStabilitySignal: false,
    workflowIntelligenceValue: true
  },
  'revert-rate-by-ide': {
    aiRoiRelevance: false,
    classifications: ['operational_risk'],
    flagshipPotential: 80,
    reviewEfficiencySignal: false,
    deploymentStabilitySignal: false,
    workflowIntelligenceValue: false
  },
  'delivery-velocity-by-workflow': {
    aiRoiRelevance: false,
    classifications: ['workflow_intelligence'],
    flagshipPotential: 85,
    reviewEfficiencySignal: false,
    deploymentStabilitySignal: true,
    workflowIntelligenceValue: true
  },
  'change-failure-rate-spike-by-ide': {
    aiRoiRelevance: false,
    classifications: ['operational_risk'],
    flagshipPotential: 85,
    reviewEfficiencySignal: false,
    deploymentStabilitySignal: true,
    workflowIntelligenceValue: false
  },
  'executive-stable-deployment-acceleration': {
    aiRoiRelevance: false,
    classifications: ['operational_risk'],
    flagshipPotential: 90,
    reviewEfficiencySignal: false,
    deploymentStabilitySignal: true,
    workflowIntelligenceValue: true
  },
  'synthesized-deployment-cadence': {
    aiRoiRelevance: false,
    classifications: ['workflow_intelligence'],
    flagshipPotential: 80,
    reviewEfficiencySignal: false,
    deploymentStabilitySignal: true,
    workflowIntelligenceValue: true
  },
  'active-coding-time-by-ide': {
    aiRoiRelevance: false,
    classifications: ['workflow_intelligence'],
    flagshipPotential: 70,
    reviewEfficiencySignal: false,
    deploymentStabilitySignal: false,
    workflowIntelligenceValue: true
  },
  'telemetry-ai-focus-imbalance': {
    aiRoiRelevance: true,
    classifications: ['ai_roi'],
    flagshipPotential: 75,
    reviewEfficiencySignal: false,
    deploymentStabilitySignal: false,
    workflowIntelligenceValue: true
  }
};

/**
 * Enhance insight with operational narrative
 */
export function enhanceOperationalNarrative(
  insight: CanonicalInsight,
  context: NarrativeContext
): EnhancedNarrative {
  const metadata = INSIGHT_METADATA[insight.id] || getDefaultMetadata();
  
  const narrativeType = determineNarrativeType(metadata, context);
  const template = selectNarrativeTemplate(narrativeType, context);
  
  return {
    title: enhanceTitle(insight.title || '', metadata, context),
    subtitle: (insight as any).subtitle || '',
    operationalImplication: template.implication,
    workflowIntelligence: template.intelligence || '',
    aiRoiInterpretation: template.roi || '',
    downstreamImpact: template.impact,
    executiveSummary: createExecutiveSummary(metadata, context),
    recommendedActions: generateRecommendedActions(metadata, context),
    riskLevel: context.operationalRisk,
    confidenceLevel: determineConfidenceLevel(metadata, context),
    flagshipPotential: metadata.flagshipPotential
  };
}

/**
 * Determine narrative type based on insight characteristics
 */
function determineNarrativeType(metadata: any, context: NarrativeContext): keyof typeof EXECUTIVE_NARRATIVE_TEMPLATES {
  if (metadata.aiRoiRelevance && context.hasAIVsNonAIData) {
    return 'ai_advantage';
  }
  
  if (metadata.classifications.includes('workflow_intelligence')) {
    return 'workflow_intelligence';
  }
  
  if (metadata.classifications.includes('operational_risk')) {
    return 'operational_risk';
  }
  
  if (metadata.reviewEfficiencySignal) {
    return 'review_efficiency';
  }
  
  if (metadata.deploymentStabilitySignal) {
    return 'deployment_stability';
  }
  
  return 'workflow_intelligence'; // Default
}

/**
 * Select narrative template based on type and context
 */
function selectNarrativeTemplate(
  type: keyof typeof EXECUTIVE_NARRATIVE_TEMPLATES,
  context: NarrativeContext
) {
  const templates = EXECUTIVE_NARRATIVE_TEMPLATES[type];
  
  // Determine template level based on context
  let level: 'high' | 'medium' | 'low' = 'medium';
  
  if (type === 'ai_advantage') {
    if (context.aiAdvantage && context.aiAdvantage > 20) level = 'high';
    else if (context.aiAdvantage && context.aiAdvantage > 5) level = 'medium';
    else level = 'low';
  } else if (type === 'workflow_intelligence') {
    if (context.workflowFragmentation && context.workflowFragmentation > 30) level = 'high';
    else if (context.workflowFragmentation && context.workflowFragmentation > 15) level = 'medium';
    else level = 'low';
  } else {
    level = context.operationalRisk === 'high' ? 'high' : 
            context.operationalRisk === 'medium' ? 'medium' : 'low';
  }
  
  const template = templates[level];
  if (!template.intelligence) {
    return {
      ...template,
      intelligence: template.implication // Fallback to implication
    };
  }
  
  return template;
}

/**
 * Enhance title with operational context
 */
function enhanceTitle(currentTitle: string, metadata: any, context: NarrativeContext): string {
  // Keep strong existing titles, enhance weak ones
  if (currentTitle.includes('leads in') || currentTitle.includes('has the fastest')) {
    return currentTitle;
  }
  
  // Add operational context to generic titles
  if (metadata.aiRoiRelevance && context.hasAIVsNonAIData) {
    return currentTitle.replace(/patterns observed/g, 'AI workflow patterns');
  }
  
  if (metadata.classifications.includes('operational_risk')) {
    return currentTitle.replace(/patterns/g, 'risk patterns');
  }
  
  return currentTitle;
}


/**
 * Create executive summary
 */
function createExecutiveSummary(metadata: any, context: NarrativeContext): string {
  const summaries = {
    flagship_candidate: {
      demo_ready: "Executive-ready insight with clear business impact and actionable recommendations.",
      narrative_strong: "Strong narrative foundation with compelling operational implications.",
      needs_enhancement: "Promising insight requiring data enrichment for executive presentation."
    },
    operational_risk: {
      demo_ready: "Critical operational risk indicator requiring immediate leadership attention.",
      narrative_strong: "Significant operational risk with clear mitigation strategies.",
      needs_enhancement: "Emerging operational risk pattern requiring monitoring."
    },
    ai_roi_candidate: {
      demo_ready: "AI investment ROI validated with measurable productivity gains.",
      narrative_strong: "AI workflow advantages demonstrate positive business impact.",
      needs_enhancement: "AI ROI potential identified with optimization opportunities."
    },
    workflow_intelligence: {
      demo_ready: "Workflow intelligence reveals optimization opportunities for delivery acceleration.",
      narrative_strong: "Workflow patterns indicate areas for process improvement.",
      needs_enhancement: "Workflow insights require additional context for strategic decisions."
    }
  };
  
  const category = metadata.classifications.includes('flagship_candidate') ? 'flagship_candidate' :
                   metadata.classifications.includes('operational_risk') ? 'operational_risk' :
                   metadata.aiRoiRelevance ? 'ai_roi_candidate' : 'workflow_intelligence';
  
  return summaries[category]?.[context.executiveReadiness] || "Insight requiring additional analysis for executive presentation.";
}

/**
 * Generate recommended actions
 */
function generateRecommendedActions(metadata: any, context: NarrativeContext): string[] {
  const actions = [];
  
  // AI ROI actions
  if (metadata.aiRoiRelevance && context.hasAIVsNonAIData) {
    if (context.aiAdvantage && context.aiAdvantage > 20) {
      actions.push("Scale AI workflow adoption across development teams");
      actions.push("Invest in advanced AI tooling and training");
    } else if (context.aiAdvantage && context.aiAdvantage > 5) {
      actions.push("Optimize AI workflow integration and best practices");
      actions.push("Provide targeted AI tooling enablement");
    } else {
      actions.push("Review AI workflow configuration and usage patterns");
      actions.push("Develop AI workflow optimization strategy");
    }
  }
  
  // Workflow intelligence actions
  if (metadata.workflowIntelligenceValue) {
    if (context.workflowFragmentation && context.workflowFragmentation > 30) {
      actions.push("Standardize development workflows across IDEs");
      actions.push("Implement workflow consistency monitoring");
    } else if (context.workflowFragmentation && context.workflowFragmentation > 15) {
      actions.push("Identify and address workflow inconsistencies");
      actions.push("Develop workflow optimization guidelines");
    } else {
      actions.push("Maintain current workflow standards");
      actions.push("Monitor for workflow optimization opportunities");
    }
  }
  
  // Operational risk actions
  if (metadata.classifications.includes('operational_risk')) {
    if (context.operationalRisk === 'high') {
      actions.push("Immediate risk mitigation required");
      actions.push("Implement enhanced monitoring and alerts");
    } else if (context.operationalRisk === 'medium') {
      actions.push("Develop risk mitigation plan");
      actions.push("Increase monitoring frequency");
    } else {
      actions.push("Maintain current risk management practices");
      actions.push("Continue risk monitoring and assessment");
    }
  }
  
  // Review efficiency actions
  if (metadata.reviewEfficiencySignal) {
    actions.push("Optimize review process and workflows");
    actions.push("Implement review efficiency metrics");
  }
  
  // Deployment stability actions
  if (metadata.deploymentStabilitySignal) {
    actions.push("Enhance deployment testing and validation");
    actions.push("Implement deployment stability monitoring");
  }
  
  return actions.length > 0 ? actions : ["Set up automated alerts for metric deviations exceeding 15% thresholds"];
}

/**
 * Determine confidence level
 * Updated to treat demo evidence as production-grade
 */
function determineConfidenceLevel(_metadata: any, context: NarrativeContext): 'high' | 'medium' | 'low' {
  if (context.hasDemoEvidence) {
    return 'high'; // Demo evidence is production-grade
  }
  if (context.executiveReadiness === 'demo_ready') return 'high';
  if (context.executiveReadiness === 'narrative_strong') return 'medium';
  return 'low';
}

/**
 * Create default metadata for insights without classification
 */
function getDefaultMetadata() {
  return {
    aiRoiRelevance: false,
    classifications: ['workflow_intelligence'],
    flagshipPotential: 50,
    reviewEfficiencySignal: false,
    deploymentStabilitySignal: false,
    workflowIntelligenceValue: false
  };
}

/**
 * Extract narrative context from insight data
 * Updated to treat demo evidence as production-grade
 */
export function extractNarrativeContext(insight: CanonicalInsight, hasDemoEvidence: boolean = true): NarrativeContext {
  const breakdown = (insight as any).breakdownByTool || {};
  const tools = Object.keys(breakdown);
  
  // Determine AI vs non-AI comparison
  const aiTools = tools.filter(tool => ['cursor', 'windsurf'].includes(tool));
  const nonAiTools = tools.filter(tool => ['vscode', 'jetbrains', 'unknown'].includes(tool));
  
  const hasAIVsNonAIData = aiTools.length > 0 && nonAiTools.length > 0;
  let aiAdvantage: number | null = null;
  
  if (hasAIVsNonAIData) {
    const aiAvg = aiTools.reduce((sum, tool) => sum + Number(breakdown[tool] || 0), 0) / aiTools.length;
    const nonAiAvg = nonAiTools.reduce((sum, tool) => sum + Number(breakdown[tool] || 0), 0) / nonAiTools.length;
    aiAdvantage = ((aiAvg - nonAiAvg) / nonAiAvg) * 100;
  }
  
  // Determine workflow fragmentation
  const values = Object.values(breakdown).filter(v => v !== null && v !== undefined && Number.isFinite(v)) as number[];
  const max = Math.max(...values, 1); // Avoid division by zero
  const min = Math.min(...values, 0);
  const workflowFragmentation = max > 0 ? ((max - min) / max) * 100 : 0;
  
  // Determine operational risk (simplified heuristic)
  const riskKeywords = ['failure', 'revert', 'unstable', 'risk', 'spike', 'pressure'];
  const hasRiskKeywords = riskKeywords.some(keyword => 
    insight.id.toLowerCase().includes(keyword) ||
    insight.title.toLowerCase().includes(keyword)
  );
  
  const operationalRisk = hasRiskKeywords ? 'high' : workflowFragmentation > 50 ? 'medium' : 'low';
  
  // Determine executive readiness - demo evidence is production-grade
  const executiveReadiness = hasDemoEvidence ? 'demo_ready' : 'narrative_strong';
  
  return {
    insightId: insight.id,
    stage: (insight as any).stage,
    metricValue: (insight as any).primaryMetric || 0,
    comparisonData: breakdown as Record<string, number>,
    hasAIVsNonAIData,
    aiAdvantage,
    workflowFragmentation,
    operationalRisk,
    executiveReadiness,
    hasDemoEvidence
  };
}
