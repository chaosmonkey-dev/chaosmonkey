/**
 * Terminology Hardening System
 * 
 * Removes fake operational terminology that sounds synthetic and AI-generated.
 * Replaces with simple, evolved operational labels that feel natural.
 * 
 * FAKE TERMS TO ELIMINATE:
 * - Stability pressure
 * - Flow efficiency  
 * - Velocity compression
 * - Release validation drift
 * 
 * REPLACEMENT PRINCIPLES:
 * - Shorter labels
 * - Fewer abstract nouns
 * - Fewer "smart sounding" concepts
 * - Natural evolution over years of product iteration
 */

export interface TerminologyMapping {
  fake: string;
  authentic: string;
  category: 'risk' | 'performance' | 'quality' | 'coordination';
  reason: string;
}

/**
 * FAKE → AUTHENTIC terminology mappings
 */
const TERMINOLOGY_MAPPINGS: TerminologyMapping[] = [
  // Risk terminology
  {
    fake: 'Stability pressure',
    authentic: 'Stability risk',
    category: 'risk',
    reason: 'Pressure sounds synthetic, risk is natural engineering term'
  },
  {
    fake: 'Flow efficiency',
    authentic: 'Workflow speed',
    category: 'performance',
    reason: 'Flow is abstract, workflow is concrete operational term'
  },
  {
    fake: 'Velocity compression',
    authentic: 'Delivery slowdown',
    category: 'performance',
    reason: 'Compression is abstract, slowdown is direct observation'
  },
  {
    fake: 'Release validation drift',
    authentic: 'Validation inconsistency',
    category: 'quality',
    reason: 'Drift sounds academic, inconsistency is operational'
  },
  {
    fake: 'Throughput optimization',
    authentic: 'Delivery improvement',
    category: 'performance',
    reason: 'Optimization is MBA speak, improvement is direct'
  },
  {
    fake: 'Coordination overhead',
    authentic: 'Coordination bottlenecks',
    category: 'coordination',
    reason: 'Overhead is abstract, bottlenecks are concrete'
  },
  {
    fake: 'Process efficiency',
    authentic: 'Process speed',
    category: 'performance',
    reason: 'Efficiency is overused, speed is direct'
  },
  {
    fake: 'Quality assurance pressure',
    authentic: 'QA workload',
    category: 'coordination',
    reason: 'Pressure is abstract, workload is measurable'
  },
  {
    fake: 'Deployment cadence variance',
    authentic: 'Inconsistent deployment timing',
    category: 'performance',
    reason: 'Cadence variance is synthetic, timing is direct'
  },
  {
    fake: 'Cycle time optimization',
    authentic: 'Faster cycle time',
    category: 'performance',
    reason: 'Optimization is corporate, faster is direct'
  }
];

/**
 * AUTHENTIC operational labels that sound naturally evolved
 */
const AUTHENTIC_LABELS = {
  risk: [
    'Delivery risk',
    'Stability risk', 
    'Release risk',
    'Quality risk',
    'Review bottleneck',
    'Merge instability',
    'Validation drift',
    'Queue growth',
    'Reviewer saturation',
    'Deployment failure risk',
    'Service risk',
    'Operational risk'
  ],
  
  performance: [
    'Delivery speed',
    'Workflow speed',
    'Process speed',
    'Cycle time',
    'Deployment frequency',
    'Throughput',
    'Merge velocity',
    'Review speed',
    'Build time',
    'Release time',
    'Response time',
    'Processing time'
  ],
  
  quality: [
    'Quality issues',
    'Code quality',
    'Test coverage',
    'Defect rate',
    'Failure rate',
    'Error rate',
    'Bug count',
    'Reopen rate',
    'Rollback rate',
    'Validation issues',
    'Quality drift',
    'Consistency issues'
  ],
  
  coordination: [
    'Reviewer load',
    'Queue bottleneck',
    'Team capacity',
    'Coordination time',
    'Handoff delay',
    'Approval time',
    'Review time',
    'Merge conflicts',
    'Communication lag',
    'Team workload',
    'Process bottleneck',
    'Workflow bottleneck'
  ]
};

/**
 * Replace fake terminology with authentic alternatives
 */
export function replaceFakeTerminology(text: string): string {
  let rewritten = text;
  
  // Apply mappings
  TERMINOLOGY_MAPPINGS.forEach(mapping => {
    const regex = new RegExp(mapping.fake, 'gi');
    rewritten = rewritten.replace(regex, mapping.authentic);
  });
  
  return rewritten;
}

/**
 * Get authentic label by category
 */
export function getAuthenticLabel(category: keyof typeof AUTHENTIC_LABELS): string {
  const labels = AUTHENTIC_LABELS[category];
  return labels[Math.floor(Math.random() * labels.length)];
}

/**
 * Check if text contains fake terminology
 */
export function containsFakeTerminology(text: string): TerminologyMapping[] {
  const found: TerminologyMapping[] = [];
  
  TERMINOLOGY_MAPPINGS.forEach(mapping => {
    if (text.toLowerCase().includes(mapping.fake.toLowerCase())) {
      found.push(mapping);
    }
  });
  
  return found;
}

/**
 * Validate terminology authenticity
 */
export function validateTerminologyAuthenticity(text: string): {
  isAuthentic: boolean;
  credibilityScore: number;
  fakeTerms: TerminologyMapping[];
  suggestions: string[];
} {
  const fakeTerms = containsFakeTerminology(text);
  const suggestions: string[] = [];
  let score = 100;
  
  fakeTerms.forEach(term => {
    score -= 15;
    suggestions.push(`Replace "${term.fake}" with "${term.authentic}"`);
  });
  
  // Check for other synthetic patterns
  const syntheticPatterns = [
    'efficiency',
    'optimization',
    'synergy',
    'paradigm',
    'methodology',
    'framework',
    'ecosystem'
  ];
  
  syntheticPatterns.forEach(pattern => {
    if (text.toLowerCase().includes(pattern)) {
      score -= 10;
      suggestions.push(`Remove synthetic term: ${pattern}`);
    }
  });
  
  return {
    isAuthentic: fakeTerms.length === 0,
    credibilityScore: Math.max(0, score),
    fakeTerms,
    suggestions
  };
}

/**
 * Generate authentic operational label
 */
export function generateAuthenticOperationalLabel(
  category: keyof typeof AUTHENTIC_LABELS,
  context?: string
): string {
  const baseLabel = getAuthenticLabel(category);
  
  // Add context if provided
  if (context) {
    return `${context} ${baseLabel}`;
  }
  
  return baseLabel;
}

/**
 * Apply terminology hardening to pills/tags
 */
export function hardenPillTerminology(pill: string): string {
  // Check if pill contains fake terminology
  const fakeTerms = containsFakeTerminology(pill);
  
  if (fakeTerms.length > 0) {
    return replaceFakeTerminology(pill);
  }
  
  // If already authentic, return as-is
  const validation = validateTerminologyAuthenticity(pill);
  if (validation.isAuthentic) {
    return pill;
  }
  
  // Otherwise generate authentic alternative
  return getAuthenticLabel('risk'); // Default to risk category for pills
}

/**
 * Apply terminology hardening to insight object
 */
export function hardenInsightTerminology(insight: any): any {
  const hardened = { ...insight };
  
  // Apply to all text fields
  const textFields = [
    'title',
    'description', 
    'whatChanged',
    'whyItMatters',
    'evidenceAndContext',
    'operationalImpact',
    'primaryRisk',
    'executiveSummary',
    'cohort' // pills/tags
  ];
  
  textFields.forEach(field => {
    if (hardened[field] && typeof hardened[field] === 'string') {
      hardened[field] = replaceFakeTerminology(hardened[field]);
    }
  });
  
  return hardened;
}

/**
 * Get terminology mapping by fake term
 */
export function getTerminologyMapping(fakeTerm: string): TerminologyMapping | undefined {
  return TERMINOLOGY_MAPPINGS.find(mapping => 
    mapping.fake.toLowerCase() === fakeTerm.toLowerCase()
  );
}

/**
 * Get all terminology mappings by category
 */
export function getTerminologyMappingsByCategory(category: TerminologyMapping['category']): TerminologyMapping[] {
  return TERMINOLOGY_MAPPINGS.filter(mapping => mapping.category === category);
}

/**
 * Generate authentic risk label
 */
export function generateAuthenticRiskLabel(context?: string): string {
  const riskLabels = AUTHENTIC_LABELS.risk;
  const baseLabel = riskLabels[Math.floor(Math.random() * riskLabels.length)];
  
  return context ? `${context} ${baseLabel}` : baseLabel;
}

/**
 * Generate authentic performance label
 */
export function generateAuthenticPerformanceLabel(context?: string): string {
  const performanceLabels = AUTHENTIC_LABELS.performance;
  const baseLabel = performanceLabels[Math.floor(Math.random() * performanceLabels.length)];
  
  return context ? `${context} ${baseLabel}` : baseLabel;
}

/**
 * Generate authentic quality label
 */
export function generateAuthenticQualityLabel(context?: string): string {
  const qualityLabels = AUTHENTIC_LABELS.quality;
  const baseLabel = qualityLabels[Math.floor(Math.random() * qualityLabels.length)];
  
  return context ? `${context} ${baseLabel}` : baseLabel;
}

/**
 * Generate authentic coordination label
 */
export function generateAuthenticCoordinationLabel(context?: string): string {
  const coordinationLabels = AUTHENTIC_LABELS.coordination;
  const baseLabel = coordinationLabels[Math.floor(Math.random() * coordinationLabels.length)];
  
  return context ? `${context} ${baseLabel}` : baseLabel;
}
