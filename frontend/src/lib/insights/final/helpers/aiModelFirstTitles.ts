/**
 * Operational Title Generation System
 * 
 * Generates direct, operationally authentic titles that sound like
 * they came from real engineering analytics platforms, not AI.
 * 
 * CREDIBILITY PRINCIPLES:
 * - Direct operational language (no compound nouns)
 * - Avoid MBA/consulting terminology
 * - Sound like Datadog/LinearB/real platforms
 * - Short, declarative sentences
 * - Concrete metric descriptions
 */

import { AIModel, getAIModelById, getDiverseAIModels, WORKFLOW_MODEL_COMBINATIONS } from '../registry/aiModelRegistry';
import { toPilotToolLabel } from '../utils/formatHelpers';

export interface TitleContext {
  primaryModel: AIModel;
  operationalMetric: string;
  metricDirection: 'increased' | 'decreased' | 'elevated' | 'reduced' | 'accelerated' | 'delayed';
  workflowType: 'accelerated' | 'stable' | 'experimental' | 'rapid' | 'review' | 'documentation';
  secondaryModels?: AIModel[];
  mixedModelWorkflow?: boolean;
}

export interface TitleTemplate {
  structure: string;
  variables: {
    primaryModel: string;
    operationalMetric: string;
    direction: string;
    workflowContext?: string;
    secondaryContext?: string;
  };
}

/**
 * Direct operational title templates
 * These sound like real engineering analytics, not AI-generated content
 */
const OPERATIONAL_TITLE_TEMPLATES: TitleTemplate[] = [
  // Direct model + metric patterns (like Datadog)
  {
    structure: '{primaryModel} {operationalMetric} {direction}',
    variables: {
      primaryModel: '',
      operationalMetric: '',
      direction: '',
      workflowContext: undefined,
      secondaryContext: undefined
    }
  },
  {
    structure: '{operationalMetric} {direction} in {primaryModel} workflows',
    variables: {
      primaryModel: '',
      operationalMetric: '',
      direction: '',
      workflowContext: undefined,
      secondaryContext: undefined
    }
  },
  {
    structure: '{primaryModel} workflows showed {direction} {operationalMetric}',
    variables: {
      primaryModel: '',
      operationalMetric: '',
      direction: '',
      workflowContext: undefined,
      secondaryContext: undefined
    }
  },
  // Issue-focused patterns (like incident reviews)
  {
    structure: '{primaryModel} {operationalMetric} created reviewer bottlenecks',
    variables: {
      primaryModel: '',
      operationalMetric: '',
      direction: 'increased',
      workflowContext: undefined,
      secondaryContext: undefined
    }
  },
  {
    structure: '{primaryModel} {operationalMetric} slowed delivery pipelines',
    variables: {
      primaryModel: '',
      operationalMetric: '',
      direction: 'decreased',
      workflowContext: undefined,
      secondaryContext: undefined
    }
  },
  {
    structure: '{primaryModel} {operationalMetric} increased deployment failures',
    variables: {
      primaryModel: '',
      operationalMetric: '',
      direction: 'elevated',
      workflowContext: undefined,
      secondaryContext: undefined
    }
  },
  // Comparison patterns (like GitHub analytics)
  {
    structure: '{primaryModel} {operationalMetric} higher than {secondaryContext}',
    variables: {
      primaryModel: '',
      operationalMetric: '',
      direction: 'increased',
      workflowContext: undefined,
      secondaryContext: 'baseline'
    }
  },
  {
    structure: '{primaryModel} {operationalMetric} lower than {secondaryContext}',
    variables: {
      primaryModel: '',
      operationalMetric: '',
      direction: 'decreased',
      workflowContext: undefined,
      secondaryContext: 'baseline'
    }
  },
  // Time-based patterns (like LinearB)
  {
    structure: '{primaryModel} cycle time {direction} last 30 days',
    variables: {
      primaryModel: '',
      operationalMetric: 'cycle time',
      direction: '',
      workflowContext: undefined,
      secondaryContext: undefined
    }
  },
  {
    structure: '{primaryModel} deployment frequency {direction}',
    variables: {
      primaryModel: '',
      operationalMetric: 'deployment frequency',
      direction: '',
      workflowContext: undefined,
      secondaryContext: undefined
    }
  }
];

/**
 * Concrete operational metrics (no abstract compound nouns)
 * These sound like real engineering measurements
 */
const OPERATIONAL_METRICS = {
  // Delivery metrics (direct and measurable)
  delivery: ['deployment frequency', 'merge rate', 'commit rate', 'release cadence', 'delivery time'],
  quality: ['reopen rate', 'failure rate', 'rollback rate', 'review time', 'test failures'],
  efficiency: ['cycle time', 'build time', 'review time', 'queue duration', 'pipeline duration'],
  coordination: ['reviewer load', 'merge conflicts', 'handoff delays', 'approval time', 'coordination overhead'],
  risk: ['deployment failures', 'integration issues', 'revert frequency', 'pipeline failures', 'incidents']
} as const;

/**
 * Simple directional terms (no corporate speak)
 */
const DIRECTIONAL_TERMS = {
  increased: ['increased', 'rose', 'grew'],
  decreased: ['decreased', 'fell', 'dropped'],
  elevated: ['elevated', 'higher', 'raised'],
  reduced: ['reduced', 'lower', 'decreased'],
  accelerated: ['accelerated', 'faster', 'quickened'],
  delayed: ['delayed', 'slower', 'prolonged']
} as const;

/**
 * Generate operationally authentic title
 * 
 * CREDIBILITY RULES:
 * - No compound nouns (delivery acceleration, workflow coordination)
 * - No abstract concepts (throughput optimization, cycle efficiency)
 * - Sound like real engineering platforms
 * - Short, direct sentences
 */
export function generateAIModelFirstTitle(context: TitleContext): string {
  const { primaryModel, operationalMetric, metricDirection, workflowType, secondaryModels, mixedModelWorkflow } = context;
  
  // Select template based on context
  let template;
  if (mixedModelWorkflow && secondaryModels && secondaryModels.length > 0) {
    // For mixed workflows, use comparison templates
    template = OPERATIONAL_TITLE_TEMPLATES.find(t => 
      t.structure.includes('higher than') || t.structure.includes('lower than')
    ) || OPERATIONAL_TITLE_TEMPLATES[0];
  } else {
    // Use direct operational templates
    const directTemplates = OPERATIONAL_TITLE_TEMPLATES.filter(t => 
      !t.structure.includes('higher than') && !t.structure.includes('lower than')
    );
    template = directTemplates[Math.floor(Math.random() * directTemplates.length)];
  }
  
  // Get simple directional term
  const directionOptions = DIRECTIONAL_TERMS[metricDirection] || DIRECTIONAL_TERMS.increased;
  const direction = directionOptions[Math.floor(Math.random() * directionOptions.length)];
  
  // Build variables
  const variables = {
    ...template.variables,
    primaryModel: primaryModel.canonicalName,
    operationalMetric: operationalMetric,
    direction: direction,
    workflowContext: workflowType ? `${workflowType}` : '',
    secondaryContext: secondaryModels && secondaryModels.length > 0 
      ? `${secondaryModels[0].canonicalName}` 
      : 'baseline'
  };
  
  // Replace variables in template
  let title = template.structure;
  Object.entries(variables).forEach(([key, value]) => {
    if (value && template.structure.includes(`{${key}}`)) {
      title = title.replace(new RegExp(`{${key}}`, 'g'), value);
    }
  });
  
  return title;
}

/**
 * Create mixed-workflow workflow context
 */
export function createMixedModelContext(primaryModelId: string, workflowType: string): TitleContext {
  const primaryModel = getAIModelById(primaryModelId) || getDiverseAIModels(1)[0];
  const secondaryModels = getDiverseAIModels(2).filter(m => m.id !== primaryModel.id);
  
  return {
    primaryModel,
    operationalMetric: OPERATIONAL_METRICS.delivery[Math.floor(Math.random() * OPERATIONAL_METRICS.delivery.length)],
    metricDirection: 'increased',
    workflowType: workflowType as any,
    secondaryModels,
    mixedModelWorkflow: true
  };
}

/**
 * Generate diverse title contexts to avoid repetition
 */
export function generateDiverseTitleContexts(count: number): TitleContext[] {
  const contexts: TitleContext[] = [];
  const usedModels = new Set<string>();
  const workflowTypes = Object.keys(WORKFLOW_MODEL_COMBINATIONS);
  const allModels = getDiverseAIModels(count * 2);
  
  for (let i = 0; i < count; i++) {
    const availableModels = allModels.filter(m => !usedModels.has(m.id));
    const primaryModel = availableModels.length > 0 ? availableModels[0] : allModels[i % allModels.length];
    
    usedModels.add(primaryModel.id);
    
    const metricCategories = Object.keys(OPERATIONAL_METRICS) as Array<keyof typeof OPERATIONAL_METRICS>;
    const metricCategory = metricCategories[i % metricCategories.length];
    const metrics = OPERATIONAL_METRICS[metricCategory];
    const operationalMetric = metrics[Math.floor(Math.random() * metrics.length)];
    
    const directions = Object.keys(DIRECTIONAL_TERMS) as Array<keyof typeof DIRECTIONAL_TERMS>;
    const metricDirection = directions[Math.floor(Math.random() * directions.length)];
    
    const workflowType = workflowTypes[i % workflowTypes.length] as any;
    
    // 30% chance of mixed-workflow workflow
    const mixedModelWorkflow = Math.random() < 0.3;
    const secondaryModels = mixedModelWorkflow ? getDiverseAIModels(2).filter(m => m.id !== primaryModel.id) : undefined;
    
    contexts.push({
      primaryModel,
      operationalMetric,
      metricDirection,
      workflowType,
      secondaryModels,
      mixedModelWorkflow
    });
  }
  
  return contexts;
}

/**
 * Get IDE context for supporting metadata (not titles)
 */
export function getIDEContextForModel(_model: AIModel, workflowType: string): string {
  const ideMappings: Record<string, string[]> = {
    'accelerated': ['cursor', 'windsurf'],
    'stable': ['vscode', 'cursor'],
    'experimental': ['windsurf', 'cursor'],
    'rapid': ['cursor', 'vscode'],
    'review': ['vscode', 'cursor'],
    'documentation': ['windsurf', 'vscode']
  };
  
  const ides = ideMappings[workflowType] || ['cursor', 'windsurf', 'vscode'];
  return toPilotToolLabel(ides[Math.floor(Math.random() * ides.length)]);
}
