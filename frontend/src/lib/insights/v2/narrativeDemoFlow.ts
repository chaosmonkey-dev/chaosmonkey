/**
 * Phase C: Narrative Demo Flow Structure
 * 
 * Transforms Performance Insights from a list into an operational intelligence narrative.
 * Supports the flow: AI workflow behavior → review efficiency → merge quality → deployment outcomes → operational ROI
 */

import type { V2PreviewRow } from './types';
import { getFlagshipCandidates } from './insightClassifications';

export type NarrativeChapter = {
  id: string;
  title: string;
  subtitle: string;
  narrativeTheme: string;
  businessQuestion: string;
  keyInsights: string[];
  supportingInsights: string[];
  flowPosition: 'opening' | 'middle' | 'climax' | 'closing';
  estimatedDuration: number; // minutes
  executiveHook: string;
  transitionToNext: string;
};

export type NarrativeFlow = {
  id: string;
  title: string;
  executiveSummary: string;
  totalDuration: number;
  chapters: NarrativeChapter[];
  flagshipInsights: string[];
  dataRequirements: string[];
  successMetrics: string[];
  preparationChecklist: string[];
};

export type NarrativeStructure = {
  flow: NarrativeFlow;
  insightMapping: Record<string, NarrativeChapter>;
  presentationOrder: string[];
  fallbackData: Record<string, any>;
};

/**
 * Narrative Flow Definition
 * 
 * This defines the complete executive demo narrative structure
 */
const NARRATIVE_FLOW: NarrativeFlow = {
  id: 'operational-intelligence-narrative',
  title: 'Engineering Intelligence: From AI Tools to Business Impact',
  executiveSummary: 'Transform your engineering organization with data-driven insights about AI workflow effectiveness, review efficiency, and operational excellence.',
  totalDuration: 8, // minutes
  flagshipInsights: [
    'ai-suggestions-accepted-by-ide',
    'delivery-rate-ai-vs-non-ai', 
    'time-to-first-commit-by-ide',
    'ai-assisted-delivery-impact',
    'change-failure-rate-trend-by-ide',
    'fast-but-unstable-by-ide',
    'pr-cycle-time-by-ide',
    'reviewer-load-concentration'
  ],
  dataRequirements: [
    'AI tool attribution data',
    'GitHub PR analytics with timestamps',
    'Deployment success/failure metrics',
    'Code review cycle data',
    'Revert detection by IDE'
  ],
  successMetrics: [
    'Executive engagement during demo',
    'Strategic questions about AI investment',
    'Actionable next steps identified',
    'Business impact quantified',
    'No technical errors or data issues'
  ],
  preparationChecklist: [
    'Verify all flagship insights have meaningful data',
    'Test demo flow with sample data',
    'Prepare executive talking points',
    'Create fallback data for demo reliability'
  ],
  chapters: [
    {
      id: 'ai-workflow-behavior',
      title: 'AI Workflow Behavior',
      subtitle: 'How your teams are adopting and using AI tools',
      narrativeTheme: 'AI adoption patterns and productivity impact',
      businessQuestion: 'Are we maximizing our AI investment across all development environments?',
      keyInsights: ['ai-suggestions-accepted-by-ide', 'time-to-first-commit-by-ide'],
      supportingInsights: ['active-coding-time-by-ide', 'average-session-length-by-ide'],
      flowPosition: 'opening',
      estimatedDuration: 2,
      executiveHook: 'Your AI investment returns vary 3x by development environment',
      transitionToNext: 'But faster coding is only valuable if it leads to better reviews'
    },
    {
      id: 'review-efficiency',
      title: 'Review Efficiency & Quality',
      subtitle: 'Impact of AI on code review processes and quality',
      narrativeTheme: 'Review process optimization and quality maintenance',
      businessQuestion: 'How much time are we losing in code review bottlenecks?',
      keyInsights: ['pr-cycle-time-by-ide', 'reviewer-load-concentration'],
      supportingInsights: ['pr-size-by-ide', 'pr-review-cycles-by-ide'],
      flowPosition: 'middle',
      estimatedDuration: 3,
      executiveHook: 'AI-assisted PRs review 50% faster while maintaining quality',
      transitionToNext: 'Faster, higher-quality reviews should lead to better deployments'
    },
    {
      id: 'deployment-outcomes',
      title: 'Deployment Outcomes & Reliability',
      subtitle: 'From development to production - measuring real business impact',
      narrativeTheme: 'Deployment reliability and operational excellence',
      businessQuestion: 'Are our AI investments improving or compromising reliability?',
      keyInsights: ['change-failure-rate-trend-by-ide', 'fast-but-unstable-by-ide'],
      supportingInsights: ['deployment-frequency-volatility-by-ide', 'mttr-by-ide'],
      flowPosition: 'climax',
      estimatedDuration: 2,
      executiveHook: 'AI teams break the speed-quality tradeoff',
      transitionToNext: 'So what\'s the total business impact of these patterns?'
    },
    {
      id: 'operational-roi',
      title: 'Operational ROI & Strategic Impact',
      subtitle: 'Quantifying the business value of engineering intelligence',
      narrativeTheme: 'Total business impact and strategic recommendations',
      businessQuestion: 'What\'s the quantified ROI of our engineering investments?',
      keyInsights: ['delivery-rate-ai-vs-non-ai', 'ai-assisted-delivery-impact'],
      supportingInsights: ['ai-rework-burden-ai-vs-non-ai', 'ai-yield-ratio-ai-vs-non-ai'],
      flowPosition: 'closing',
      estimatedDuration: 1,
      executiveHook: 'AI-powered teams deliver 40% more value with equivalent quality',
      transitionToNext: 'Here\'s how to scale your success across the organization'
    }
  ]
};

/**
 * Create narrative structure from insights
 */
export function createNarrativeStructure(insights: V2PreviewRow[]): NarrativeStructure {
  const insightMapping: Record<string, NarrativeChapter> = {};
  const presentationOrder: string[] = [];
  const flagshipInsights = getFlagshipCandidates();
  // Additional insights available for future use
  // const aiRoiInsights = getAiRoiInsights();
  // const workflowInsights = getWorkflowIntelligenceInsights();
  // const riskInsights = getOperationalRiskInsights();

  // Map insights to narrative chapters
  for (const chapter of NARRATIVE_FLOW.chapters) {
    // Map key insights
    for (const insightId of chapter.keyInsights) {
      const foundInsight = insights.find(i => i.id === insightId);
      if (foundInsight) {
        insightMapping[insightId] = chapter;
        presentationOrder.push(insightId);
      }
    }

    // Map supporting insights (lower priority)
    for (const insightId of chapter.supportingInsights) {
      const foundInsight = insights.find(i => i.id === insightId);
      if (foundInsight && !insightMapping[insightId]) {
        insightMapping[insightId] = chapter;
        presentationOrder.push(insightId);
      }
    }
  }

  // Add any remaining flagship insights to appropriate chapters
  for (const flagship of flagshipInsights) {
    if (!insightMapping[flagship.id]) {
      const foundInsight = insights.find(i => i.id === flagship.id);
      if (foundInsight) {
        const chapter = determineBestChapter(flagship, foundInsight);
        insightMapping[flagship.id] = chapter;
        presentationOrder.push(flagship.id);
      }
    }
  }

  return {
    flow: NARRATIVE_FLOW,
    insightMapping,
    presentationOrder,
    fallbackData: generateFallbackData()
  };
}

/**
 * Determine the best chapter for an insight based on its characteristics
 */
function determineBestChapter(metadata: any, _insight: V2PreviewRow): NarrativeChapter {
  // AI ROI insights go to operational ROI or AI workflow
  if (metadata.aiRoiRelevance) {
    return NARRATIVE_FLOW.chapters.find(c => c.id === 'operational-roi') || 
           NARRATIVE_FLOW.chapters.find(c => c.id === 'ai-workflow-behavior') ||
           NARRATIVE_FLOW.chapters[0];
  }

  // Review efficiency insights
  if (metadata.reviewEfficiencySignal) {
    return NARRATIVE_FLOW.chapters.find(c => c.id === 'review-efficiency') || NARRATIVE_FLOW.chapters[1];
  }

  // Deployment stability insights
  if (metadata.deploymentStabilitySignal) {
    return NARRATIVE_FLOW.chapters.find(c => c.id === 'deployment-outcomes') || NARRATIVE_FLOW.chapters[2];
  }

  // Operational risk insights
  if (metadata.classifications.includes('operational_risk')) {
    return NARRATIVE_FLOW.chapters.find(c => c.id === 'deployment-outcomes') || NARRATIVE_FLOW.chapters[2];
  }

  // Workflow intelligence insights
  if (metadata.workflowIntelligenceValue) {
    return NARRATIVE_FLOW.chapters.find(c => c.id === 'ai-workflow-behavior') || NARRATIVE_FLOW.chapters[0];
  }

  // Default to first chapter
  return NARRATIVE_FLOW.chapters[0];
}

/**
 * Generate fallback data for demo reliability
 */
function generateFallbackData(): Record<string, any> {
  return {
    'ai-suggestions-accepted-by-ide': {
      title: 'Cursor leads in AI suggestions accepted (+45% vs VS Code)',
      rightMetric: '12.3 per session',
      breakdownByTool: {
        cursor: 12.3,
        vscode: 8.5,
        windsurf: 11.2
      }
    },
    'delivery-rate-ai-vs-non-ai': {
      title: 'AI-assisted developers deliver 40% more commits per session',
      rightMetric: '3.4 vs 2.4 commits',
      breakdownByTool: {
        cursor: 3.4,
        vscode: 2.4,
        windsurf: 3.1
      }
    },
    'time-to-first-commit-by-ide': {
      title: 'AI-assisted developers reach first commit 60% faster',
      rightMetric: '8.2 minutes',
      breakdownByTool: {
        cursor: 8.2,
        vscode: 20.5,
        windsurf: 10.1
      }
    },
    'pr-cycle-time-by-ide': {
      title: 'Cursor has the fastest PR cycle time (35% faster than VS Code)',
      rightMetric: '4.2 hours',
      breakdownByTool: {
        cursor: 4.2,
        vscode: 6.5,
        windsurf: 4.8
      }
    },
    'change-failure-rate-trend-by-ide': {
      title: 'AI-assisted deployments show 30% lower failure rates',
      rightMetric: '2.1%',
      breakdownByTool: {
        cursor: 2.1,
        vscode: 3.0,
        windsurf: 2.4
      }
    },
    'fast-but-unstable-by-ide': {
      title: 'Cursor teams deploy faster with better stability',
      rightMetric: 'Optimal balance',
      breakdownByTool: {
        cursor: 'Fast & Stable',
        vscode: 'Slow & Unstable',
        windsurf: 'Fast & Stable'
      }
    }
  };
}

/**
 * Get narrative flow for presentation
 */
export function getNarrativeFlow(insights: V2PreviewRow[]): NarrativeStructure {
  return createNarrativeStructure(insights);
}

/**
 * Get chapter insights for presentation
 */
export function getChapterInsights(
  insights: V2PreviewRow[], 
  chapterId: string,
  narrativeStructure: NarrativeStructure
): V2PreviewRow[] {
  return insights.filter(insight => 
    narrativeStructure.insightMapping[insight.id || '']?.id === chapterId
  ).sort((a, b) => {
    // Key insights first, then supporting insights
    const aChapter = narrativeStructure.insightMapping[a.id || ''];
    const bChapter = narrativeStructure.insightMapping[b.id || ''];
    
    if (!aChapter || !bChapter) return 0;
    
    const aIsKey = aChapter.keyInsights.includes(a.id || '');
    const bIsKey = bChapter.keyInsights.includes(b.id || '');
    
    if (aIsKey && !bIsKey) return -1;
    if (!aIsKey && bIsKey) return 1;
    
    return 0;
  });
}

/**
 * Generate chapter narrative summary
 */
export function generateChapterSummary(
  chapter: NarrativeChapter,
  insights: V2PreviewRow[]
): string {
  const keyInsightData = insights.filter(i => chapter.keyInsights.includes(i.id || ''));
  const supportingInsightData = insights.filter(i => chapter.supportingInsights.includes(i.id || ''));
  
  let summary = `${chapter.title}: ${chapter.subtitle}\n\n`;
  summary += `Executive Question: ${chapter.businessQuestion}\n\n`;
  summary += `Key Findings:\n`;
  
  for (const insight of keyInsightData) {
    summary += `• ${insight.title}: ${insight.rightMetric || 'Data available'}\n`;
  }
  
  if (supportingInsightData.length > 0) {
    summary += `\nSupporting Evidence:\n`;
    for (const insight of supportingInsightData) {
      summary += `• ${insight.title}: ${insight.rightMetric || 'Data available'}\n`;
    }
  }
  
  summary += `\nExecutive Hook: ${chapter.executiveHook}\n`;
  summary += `Business Impact: ${chapter.narrativeTheme}\n`;
  
  return summary;
}

/**
 * Validate narrative flow readiness
 */
export function validateNarrativeReadiness(
  insights: V2PreviewRow[],
  narrativeStructure: NarrativeStructure
): {
  isReady: boolean;
  missingKeyInsights: string[];
  missingDataInsights: string[];
  readinessScore: number;
  recommendations: string[];
} {
  const missingKeyInsights: string[] = [];
  const missingDataInsights: string[] = [];
  let totalInsights = 0;
  let availableInsights = 0;

  // Check key insights
  for (const chapter of narrativeStructure.flow.chapters) {
    for (const insightId of chapter.keyInsights) {
      totalInsights++;
      const insight = insights.find(i => i.id === insightId);
      if (!insight) {
        missingKeyInsights.push(insightId);
      } else if (hasInsufficientData(insight)) {
        missingDataInsights.push(insightId);
      } else {
        availableInsights++;
      }
    }
  }

  // Check supporting insights
  for (const chapter of narrativeStructure.flow.chapters) {
    for (const insightId of chapter.supportingInsights) {
      totalInsights++;
      const insight = insights.find(i => i.id === insightId);
      if (!insight) {
        // Supporting insights are optional, just track for completeness
      } else if (hasInsufficientData(insight)) {
        missingDataInsights.push(insightId);
      } else {
        availableInsights++;
      }
    }
  }

  const readinessScore = totalInsights > 0 ? (availableInsights / totalInsights) * 100 : 0;
  const isReady = readinessScore >= 75 && missingKeyInsights.length === 0;

  const recommendations: string[] = [];
  
  if (missingKeyInsights.length > 0) {
    recommendations.push(`Add missing key insights: ${missingKeyInsights.join(', ')}`);
  }
  
  if (missingDataInsights.length > 0) {
    recommendations.push(`Seed data for sparse insights: ${missingDataInsights.join(', ')}`);
  }
  
  if (readinessScore < 50) {
    recommendations.push('Focus on data saturation before executive demo');
  } else if (readinessScore < 75) {
    recommendations.push('Enhance data quality for stronger narrative');
  } else {
    recommendations.push('Ready for executive demo with current data');
  }

  return {
    isReady,
    missingKeyInsights,
    missingDataInsights,
    readinessScore,
    recommendations
  };
}

/**
 * Check if insight has insufficient data
 */
function hasInsufficientData(insight: V2PreviewRow): boolean {
  // Check for null/undefined right metric
  if (!insight.rightMetric || insight.rightMetric === '—' || insight.rightMetric === 'Insufficient') {
    return true;
  }

  // Check for zero values that might indicate missing data
  if (insight.rightMetric === '0' || insight.rightMetric === '0.0') {
    return true;
  }

  // Check for generic insufficient data messages
  const metricStr = (insight.rightMetric || '').toLowerCase();
  if (metricStr.includes('insufficient') || metricStr.includes('awaiting') || metricStr.includes('no data')) {
    return true;
  }

  return false;
}

/**
 * Get demo preparation checklist
 */
export function getDemoPreparationChecklist(
  narrativeStructure: NarrativeStructure
): string[] {
  const checklist = [
    'Verify all flagship insights have meaningful data',
    'Test demo flow with sample data',
    'Prepare executive talking points for each chapter',
    'Create fallback data for demo reliability',
    'Test visual hierarchy and transitions',
    'Prepare answers to expected executive questions',
    'Verify API response times (< 500ms)',
    'Test on target display devices'
  ];

  // Add specific data preparation tasks
  for (const chapter of narrativeStructure.flow.chapters) {
    for (const insightId of chapter.keyInsights) {
      checklist.push(`Validate ${insightId} data quality`);
    }
  }

  return checklist;
}

/**
 * Generate executive talking points
 */
export function generateExecutiveTalkingPoints(
  narrativeStructure: NarrativeStructure,
  insights: V2PreviewRow[]
): Record<string, string[]> {
  const talkingPoints: Record<string, string[]> = {};

  for (const chapter of narrativeStructure.flow.chapters) {
    const chapterInsights = getChapterInsights(insights, chapter.id, narrativeStructure);
    const points: string[] = [];

    points.push(`Chapter: ${chapter.title}`);
    points.push(`Business Question: ${chapter.businessQuestion}`);
    points.push(`Executive Hook: ${chapter.executiveHook}`);

    for (const insight of chapterInsights) {
      if (chapter.keyInsights.includes(insight.id || '')) {
        points.push(`Key Finding: ${insight.title}`);
        points.push(`Evidence: ${insight.rightMetric || 'Data available'}`);
        
        // Add context from breakdown if available
        if (insight.breakdownByTool) {
          const tools = Object.keys(insight.breakdownByTool);
          if (tools.length >= 2) {
            const topTool = tools.reduce((a, b) => 
              (insight.breakdownByTool?.[a] || 0) > (insight.breakdownByTool?.[b] || 0) ? a : b
            );
            points.push(`Leader: ${topTool} with ${insight.breakdownByTool[topTool]}`);
          }
        }
      }
    }

    points.push(`Transition: ${chapter.transitionToNext}`);
    talkingPoints[chapter.id] = points;
  }

  return talkingPoints;
}
