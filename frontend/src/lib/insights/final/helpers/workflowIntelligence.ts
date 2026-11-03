/**
 * Workflow Intelligence Helper
 * 
 * Manages narrative hierarchy, model diversity, and realistic workflow distributions
 * for Performance Insights. Ensures AI model primary, workflow secondary, IDE tertiary.
 */

import { AIModel, getAIModelById, getDiverseAIModels, WORKFLOW_MODEL_COMBINATIONS, AIModelID } from '../registry/aiModelRegistry';
import { generateAIModelFirstTitle, generateDiverseTitleContexts, createMixedModelContext, getIDEContextForModel } from './aiModelFirstTitles';

export interface WorkflowContext {
  primaryModel: AIModel;
  secondaryModels?: AIModel[];
  workflowType: 'accelerated' | 'stable' | 'experimental' | 'rapid' | 'review' | 'documentation';
  dominantIDE?: string;
  behaviorPattern: string;
}

export interface NarrativeStructure {
  title: string;
  primaryActor: string; // AI model
  workflowBehavior: string; // operational pattern
  supportingContext: string; // IDE/context details
}

/**
 * Generate diverse workflow contexts across insights to avoid repetition
 */
export function generateWorkflowContexts(count: number): WorkflowContext[] {
  const contexts: WorkflowContext[] = [];
  const usedModels = new Set<AIModelID>();
  const workflowTypes = Object.keys(WORKFLOW_MODEL_COMBINATIONS) as Array<keyof typeof WORKFLOW_MODEL_COMBINATIONS>;
  
  for (let i = 0; i < count; i++) {
    const workflowType = workflowTypes[i % workflowTypes.length];
    const availableModels = WORKFLOW_MODEL_COMBINATIONS[workflowType].filter(id => !usedModels.has(id));
    const modelId = availableModels.length > 0 ? availableModels[0] : WORKFLOW_MODEL_COMBINATIONS[workflowType][0];
    const primaryModel = getAIModelById(modelId)!;
    
    usedModels.add(modelId);
    
    contexts.push({
      primaryModel,
      secondaryModels: getDiverseAIModels(2),
      workflowType,
      dominantIDE: getIDEForWorkflow(workflowType, i),
      behaviorPattern: getBehaviorPattern(workflowType, i)
    });
  }
  
  return contexts;
}

/**
 * Create narrative structure with AI model as primary actor
 */
export function createNarrativeStructure(context: WorkflowContext): NarrativeStructure {
  const { primaryModel, workflowType, dominantIDE, behaviorPattern } = context;
  
  // Generate AI-model-first title
  const titleContext = {
    primaryModel,
    operationalMetric: behaviorPattern,
    metricDirection: 'elevated' as const,
    workflowType,
    secondaryModels: context.secondaryModels,
    mixedModelWorkflow: context.secondaryModels && context.secondaryModels.length > 0
  };
  
  const aiModelFirstTitle = generateAIModelFirstTitle(titleContext);
  
  return {
    title: aiModelFirstTitle,
    primaryActor: primaryModel.canonicalName,
    workflowBehavior: `${workflowType} workflows`,
    supportingContext: dominantIDE ? `Most active in ${dominantIDE} environments` : 'Observed across multiple development environments'
  };
}

/**
 * Generate causal language that avoids deterministic claims
 */
export function getCausalLanguage(): string[] {
  return [
    'correlated with',
    'associated with',
    'concentrated in',
    'appeared in',
    'elevated across',
    'clustered around',
    'observed in',
    'linked to',
    'co-occurred with',
    'tended to appear in'
  ];
}

/**
 * Generate mixed-workflow workflow contexts for increased diversity
 */
export function generateMixedModelContexts(count: number): WorkflowContext[] {
  const contexts: WorkflowContext[] = [];
  const workflowTypes = Object.keys(WORKFLOW_MODEL_COMBINATIONS) as Array<keyof typeof WORKFLOW_MODEL_COMBINATIONS>;
  
  for (let i = 0; i < count; i++) {
    const workflowType = workflowTypes[i % workflowTypes.length];
    const modelCombination = WORKFLOW_MODEL_COMBINATIONS[workflowType];
    
    // Primary model
    const primaryModelId = modelCombination[i % modelCombination.length];
    const primaryModel = getAIModelById(primaryModelId)!;
    
    // Secondary models for multi-tool workflows
    const secondaryModels = getDiverseAIModels(2).filter(m => m.id !== primaryModelId);
    
    contexts.push({
      primaryModel,
      secondaryModels,
      workflowType,
      dominantIDE: getIDEContextForModel(primaryModel, workflowType),
      behaviorPattern: getBehaviorPattern(workflowType, i)
    });
  }
  
  return contexts;
}

/**
 * Increase model diversity across workflow types
 */
export function increaseModelDiversity(baseContexts: WorkflowContext[]): WorkflowContext[] {
  const diverseContexts: WorkflowContext[] = [];
  const allModels = getDiverseAIModels(baseContexts.length * 2);
  let modelIndex = 0;
  
  baseContexts.forEach((context) => {
    // Rotate through different models to avoid repetition
    const primaryModel = allModels[modelIndex % allModels.length];
    modelIndex++;
    
    // Add mixed-model workflows for 40% of contexts
    const shouldAddMixedModel = Math.random() < 0.4;
    const secondaryModels = shouldAddMixedModel 
      ? allModels.slice(modelIndex, modelIndex + 2).filter(m => m.id !== primaryModel.id)
      : undefined;
    
    if (shouldAddMixedModel) {
      modelIndex += 2;
    }
    
    diverseContexts.push({
      ...context,
      primaryModel,
      secondaryModels,
      dominantIDE: getIDEContextForModel(primaryModel, context.workflowType)
    });
  });
  
  return diverseContexts;
}

/**
 * Get concrete engineering terms to replace AI hype language
 */
export function getConcreteEngineeringTerms(): Record<string, string[]> {
  return {
    throughput: ['commit frequency', 'delivery rate', 'merge velocity', 'deployment cadence'],
    quality: ['review depth', 'code stability', 'rollback frequency', 'reopen pressure'],
    efficiency: ['cycle time', 'merge queue', 'reviewer load', 'CI throughput'],
    risk: ['deployment failure', 'revert rate', 'test failures', 'integration issues'],
    performance: ['build time', 'test duration', 'deployment latency', 'pipeline throughput']
  };
}

/**
 * Replace AI hype language with concrete engineering terms
 */
export function replaceHypeLanguage(text: string): string {
  const hypeTerms = [
    'optimization emerged',
    'workflow intelligence',
    'throughput posture',
    'delivery cohorts',
    'operational variance',
    'strategic acceleration',
    'enhanced productivity',
    'intelligent automation'
  ];
  
  const concreteTerms = [
    'increased delivery rate',
    'workflow patterns',
    'throughput patterns',
    'delivery workflows',
    'operational variation',
    'faster delivery',
    'higher productivity',
    'automation patterns'
  ];
  
  let result = text;
  hypeTerms.forEach((hype, index) => {
    result = result.replace(new RegExp(hype, 'gi'), concreteTerms[index]);
  });
  
  return result;
}

/**
 * Generate varied narrative structures to avoid template repetition
 */
export function generateNarrativeVariations(context: WorkflowContext): string[] {
  const { primaryModel, workflowType, behaviorPattern } = context;
  
  return [
    `${primaryModel.canonicalName} workflows ${behaviorPattern} in ${workflowType} delivery patterns`,
    `${behaviorPattern} observed in ${primaryModel.canonicalName}-heavy ${workflowType} workflows`,
    `${workflowType} delivery showed ${behaviorPattern} with ${primaryModel.canonicalName} usage`,
    `${primaryModel.canonicalName} usage correlated with ${behaviorPattern} in ${workflowType} contexts`,
    `${behaviorPattern} concentrated in workflows using ${primaryModel.canonicalName} for ${workflowType} tasks`
  ];
}

/**
 * Determine appropriate IDE for workflow context
 */
function getIDEForWorkflow(workflowType: string, index: number): string {
  const ides = ['Cursor', 'Devin', 'VS Code', 'JetBrains', 'Neovim', 'Vim', 'Emacs'];
  // Distribute IDEs realistically across workflow types
  return ides[index % ides.length];
}

/**
 * Get behavior patterns for workflow types
 */
function getBehaviorPattern(workflowType: string, index: number): string {
  const patterns = {
    accelerated: ['accelerated merge velocity', 'reduced cycle time', 'increased delivery rate'],
    stable: ['maintained stability', 'consistent review quality', 'reliable deployment patterns'],
    experimental: ['higher rework rates', 'increased testing overhead', 'variable performance'],
    rapid: ['fast iteration cycles', 'elevated commit frequency', 'quick deployment patterns'],
    review: ['deeper review engagement', 'higher approval rates', 'reduced reopen pressure'],
    documentation: ['comprehensive documentation', 'detailed code comments', 'enhanced knowledge capture']
  };
  
  const typePatterns = patterns[workflowType as keyof typeof patterns] || patterns.accelerated;
  return typePatterns[index % typePatterns.length];
}

/**
 * Create operational-only insights (no AI mention in title)
 */
export function createOperationalInsightTitle(metric: string, pattern: string): string {
  const operationalPatterns = [
    `${metric} ${pattern} across delivery workflows`,
    `${pattern} concentrated in ${metric} patterns`,
    `${metric} variance ${pattern} in review processes`,
    `${pattern} emerged in ${metric} distribution`,
    `${metric} bottlenecks ${pattern} in deployment pipelines`
  ];
  
  return operationalPatterns[Math.floor(Math.random() * operationalPatterns.length)];
}

/**
 * Generate realistic model distribution for large engineering org
 */
export function generateRealisticModelDistribution(): AIModel[] {
  // Simulate a large org with diverse model usage
  const baseModels = getDiverseAIModels(8);
  const additionalModels = getDiverseAIModels(12);
  
  // Weight towards popular models but include diversity
  return [...baseModels, ...additionalModels.slice(0, 5)];
}

/**
 * Create workflow detail with proper hierarchy (Model > Workflow > IDE)
 */
export function createWorkflowDetail(context: WorkflowContext): string {
  const { primaryModel, workflowType, dominantIDE, behaviorPattern } = context;
  
  let detail = `${primaryModel.canonicalName} ${behaviorPattern} in ${workflowType} workflows`;
  
  if (dominantIDE) {
    detail += `. Most active in ${dominantIDE} environments`;
  }
  
  return detail;
}
