/**
 * "Why It Matters" Structural Diversity System
 * 
 * Eliminates repetitive template structures and introduces diverse framing patterns
 * that sound like real engineering analysis, not AI-generated content.
 * 
 * CREDIBILITY PRINCIPLES:
 * - No repeated sentence templates
 * - Avoid "signaling coordination constraints" patterns
 * - Shorter, direct operational sentences
 * - Sound like staff engineer analysis, not MBA consulting
 */

import { AIModel } from '../registry/aiModelRegistry';

export type WhyItMattersPattern = 
  | 'direct_impact'
  | 'bottleneck_warning' 
  | 'resource_pressure'
  | 'coordination_lag'
  | 'capacity_constraint'
  | 'quality_tradeoff'
  | 'delivery_risk'
  | 'efficiency_gain'
  | 'stability_concern'
  | 'workflow_imbalance';

/**
 * Diverse "Why it matters" patterns that avoid template repetition
 * These sound like real engineering leadership analysis
 */
const WHY_IT_MATTERS_PATTERNS: Record<WhyItMattersPattern, string[]> = {
  direct_impact: [
    "Reviewer coordination began lagging behind throughput gains.",
    "Merge velocity improved without corresponding quality degradation.",
    "Release validation remained stable despite accelerated delivery.",
    "Teams using {model} showed wider release consistency variance."
  ],
  
  bottleneck_warning: [
    "Accelerated PR throughput increased reviewer load concentration.",
    "Higher commit frequency created approval queue bottlenecks.",
    "Review capacity constraints emerged as throughput accelerated.",
    "Pipeline stages began showing uneven load distribution."
  ],
  
  resource_pressure: [
    "Extended focus windows compressed reviewer availability.",
    "Session length increases strained reviewer capacity.",
    "AI acceleration patterns created reviewer saturation points.",
    "Workflow velocity gains exceeded reviewer scaling."
  ],
  
  coordination_lag: [
    "Cross-team coordination lagged behind individual productivity.",
    "Merge coordination overhead increased with workflow acceleration.",
    "Handoff efficiency decreased as individual velocity rose.",
    "Review turnaround times showed coordination bottlenecks."
  ],
  
  capacity_constraint: [
    "Reviewer pool size became limiting factor for delivery velocity.",
    "CI/CD pipeline capacity constrained deployment frequency.",
    "Testing infrastructure showed capacity limits under load.",
    "Release coordination bandwidth approached saturation."
  ],
  
  quality_tradeoff: [
    "Faster cycle times may reduce review depth coverage.",
    "Velocity gains came with elevated rework pressure.",
    "Accelerated delivery showed increased validation gaps.",
    "Throughput improvements correlated with quality variance."
  ],
  
  delivery_risk: [
    "Deployment frequency increases created stability concerns.",
    "Release cadence acceleration elevated failure risk.",
    "Merge velocity gains compressed validation timeframes.",
    "Higher throughput showed deployment reliability pressure."
  ],
  
  efficiency_gain: [
    "Workflow automation reduced manual coordination overhead.",
    "AI assistance improved individual developer productivity.",
    "Session efficiency gains translated to delivery acceleration.",
    "Tool adoption showed measurable productivity improvements."
  ],
  
  stability_concern: [
    "Production stability showed correlation with acceleration patterns.",
    "Deployment failures increased with release frequency.",
    "System reliability indicators showed stress under velocity.",
    "Incident rates elevated during delivery acceleration periods."
  ],
  
  workflow_imbalance: [
    "AI adoption created workflow coordination asymmetry.",
    "Multi-tool workflows showed uneven distribution patterns.",
    "Tool preference divergence created team velocity variance.",
    "Workflow fragmentation emerged across development teams."
  ]
};

/**
 * Generate diverse "Why it matters" statement
 * 
 * CREDIBILITY RULES:
 * - No template repetition
 * - No "signaling coordination constraints"
 * - Short, direct operational sentences
 * - Sound like real staff engineer analysis
 */
export function generateWhyItMatters(
  pattern: WhyItMattersPattern,
  primaryModel?: AIModel,
  _context?: string
): string {
  const patterns = WHY_IT_MATTERS_PATTERNS[pattern];
  let statement = patterns[Math.floor(Math.random() * patterns.length)];
  
  // Replace model placeholder if provided
  if (primaryModel) {
    statement = statement.replace(/{model}/g, primaryModel.canonicalName);
  }
  
  return statement;
}

/**
 * Get diverse pattern rotation to avoid repetition
 */
export function getWhyItMattersPatternRotation(count: number): WhyItMattersPattern[] {
  const patterns: WhyItMattersPattern[] = [];
  const allPatterns = Object.keys(WHY_IT_MATTERS_PATTERNS) as WhyItMattersPattern[];
  
  // Rotate through patterns with some randomness to avoid adjacency repetition
  for (let i = 0; i < count; i++) {
    const basePattern = allPatterns[i % allPatterns.length];
    // 40% chance to use a different pattern for variety
    const pattern = Math.random() < 0.6 
      ? basePattern 
      : allPatterns[Math.floor(Math.random() * allPatterns.length)];
    
    patterns.push(pattern);
  }
  
  return patterns;
}

/**
 * Legacy narrative structure functions (kept for compatibility)
 */
export type NarrativeFrame = WhyItMattersPattern;

export type NarrativeStructure = {
  frame: NarrativeFrame;
  primarySubject: string;
  operationalContext: string;
  relationshipType: string;
  consequence: string;
  supportingEvidence: string;
};

/**
 * Generate diverse narrative structure (legacy compatibility)
 */
export function generateNarrativeStructure(
  frame: NarrativeFrame,
  primaryModel: AIModel,
  operationalContext: string
): NarrativeStructure {
  // Map to new why-it-matters patterns for compatibility
    return {
    frame,
    primarySubject: primaryModel.canonicalName,
    operationalContext,
    relationshipType: 'associated with',
    consequence: 'workflow changes',
    supportingEvidence: 'baseline patterns'
  };
}

/**
 * Build narrative sentence from structure (legacy compatibility)
 */
export function buildNarrativeSentence(structure: NarrativeStructure): string {
  // Use new why-it-matters system
  return generateWhyItMatters(structure.frame);
}

/**
 * Legacy constants for compatibility
 */
const NARRATIVE_FRAMES: Record<string, string[]> = {
  comparative: ["Multi-tool workflows showed different patterns than single-workflow approaches"],
  observational: ["Analysis revealed workflow patterns"],
  trend: ["Trends indicated workflow changes"],
  cohort: ["Cohort analysis showed patterns"],
  asymmetry: ["Asymmetry detected between workflows"],
  operational_tension: ["Workflow coordination overhead observed"],
  workflow_distribution: ["Workflow distribution analyzed"],
  model_specialization: ["Model specialization patterns noted"]
};

const OBSERVATIONAL_RELATIONSHIPS = [
  'associated with',
  'correlated with',
  'linked to'
];

const OPERATIONAL_CONSEQUENCES = [
  'workflow changes',
  'delivery variations',
  'quality differences'
];

/**
 * Generate mixed-model narrative variance
 */
export function generateMixedModelNarrative(
  primaryModel: AIModel,
  secondaryModels: AIModel[],
  operationalContext: string
): string[] {
  const narratives: string[] = [];
  
  // Mixed-workflow comparison
  const mixedModelFrame = NARRATIVE_FRAMES.comparative[Math.floor(Math.random() * NARRATIVE_FRAMES.comparative.length)];
  const relationshipType = OBSERVATIONAL_RELATIONSHIPS[Math.floor(Math.random() * OBSERVATIONAL_RELATIONSHIPS.length)];
  const consequence = OPERATIONAL_CONSEQUENCES[Math.floor(Math.random() * OPERATIONAL_CONSEQUENCES.length)];
  
  const mixedModelNarrative = mixedModelFrame
    .replace(/{primarySubject}/g, `Multi-tool workflows`)
    .replace(/{operationalContext}/g, operationalContext)
    .replace(/{relationshipType}/g, relationshipType)
    .replace(/{consequence}/g, consequence)
    .replace(/{supportingEvidence}/g, `${primaryModel.canonicalName}-only delivery paths`);
  
  narratives.push(mixedModelNarrative);
  
  // Cross-workflow execution chains
  const crossModelFrame = NARRATIVE_FRAMES.workflow_distribution[Math.floor(Math.random() * NARRATIVE_FRAMES.workflow_distribution.length)];
  const crossModelNarrative = crossModelFrame
    .replace(/{primarySubject}/g, `Cross-workflow execution chains`)
    .replace(/{operationalContext}/g, operationalContext)
    .replace(/{relationshipType}/g, relationshipType)
    .replace(/{consequence}/g, consequence);
  
  narratives.push(crossModelNarrative);
  
  // Model specialization comparison
  if (secondaryModels.length > 0) {
    const specializationFrame = NARRATIVE_FRAMES.model_specialization[Math.floor(Math.random() * NARRATIVE_FRAMES.model_specialization.length)];
    const specializationNarrative = specializationFrame
      .replace(/{primarySubject}/g, primaryModel.canonicalName)
      .replace(/{operationalContext}/g, operationalContext)
      .replace(/{relationshipType}/g, relationshipType)
      .replace(/{consequence}/g, consequence)
      .replace(/{supportingEvidence}/g, `${secondaryModels[0].canonicalName} specialization patterns`);
    
    narratives.push(specializationNarrative);
  }
  
  return narratives;
}

/**
 * Soften AI oracle language in existing text
 */
export function softenOracleLanguage(text: string): string {
  const oraclePatterns = [
    { pattern: /caused|created|drove|solved|fixed|resolved/gi, replacement: 'was associated with' },
    { pattern: /will|shall|must|should/gi, replacement: 'may tend to' },
    { pattern: /definitely|certainly|absolutely/gi, replacement: 'appears to' },
    { pattern: /prove|demonstrate|guarantee/gi, replacement: 'suggest' },
    { pattern: /optimize|maximize|perfect/gi, replacement: 'improve' },
    { pattern: /problem|issue|crisis/gi, replacement: 'challenge' },
    { pattern: /success|failure|win|lose/gi, replacement: 'outcome' }
  ];
  
  let softened = text;
  oraclePatterns.forEach(({ pattern, replacement }) => {
    softened = softened.replace(pattern, replacement);
  });
  
  return softened;
}

/**
 * Generate diverse frame rotation to avoid repetition
 */
export function generateFrameRotation(count: number): NarrativeFrame[] {
  const frames: NarrativeFrame[] = [];
  const allFrames = Object.keys(NARRATIVE_FRAMES) as NarrativeFrame[];
  
  // Rotate through frames with some randomness
  for (let i = 0; i < count; i++) {
    const baseFrame = allFrames[i % allFrames.length];
    // Add some variety - 30% chance to use a different frame
    const frame = Math.random() < 0.7 
      ? baseFrame 
      : allFrames[Math.floor(Math.random() * allFrames.length)];
    
    frames.push(frame);
  }
  
  return frames;
}

/**
 * Increase operational realism in narratives
 */
export function addOperationalRealism(baseText: string, operationalMetrics: string[]): string {
  const realisticTerms = [
    'review load',
    'merge coordination', 
    'rollback pressure',
    'deployment cadence',
    'PR stagnation',
    'CI retry pressure',
    'reviewer concentration',
    'release stability',
    'throughput variance',
    'cycle time',
    'merge queue duration',
    'build time',
    'test duration',
    'deployment latency',
    'pipeline throughput'
  ];
  
  let realistic = baseText;
  
  // Replace generic terms with concrete operational metrics
  operationalMetrics.forEach(metric => {
    const genericTerms = ['performance', 'efficiency', 'quality', 'speed', 'productivity'];
    const randomGeneric = genericTerms[Math.floor(Math.random() * genericTerms.length)];
    realistic = realistic.replace(new RegExp(randomGeneric, 'gi'), metric);
  });
  
  // Also use realisticTerms to enhance the text
  const randomRealisticTerm = realisticTerms[Math.floor(Math.random() * realisticTerms.length)];
  realistic = realistic.replace(/\bmetric\b|\bmeasurement\b/gi, randomRealisticTerm);
  
  return realistic;
}
