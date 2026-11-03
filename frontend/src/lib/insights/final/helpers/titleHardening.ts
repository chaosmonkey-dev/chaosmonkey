/**
 * Title Hardening System
 * 
 * Replaces synthetic compound nouns with direct operational language
 * that sounds like real engineering analytics platforms.
 * 
 * TARGET TONE:
 * - Datadog, LinearB, GitHub analytics
 * - Short, direct, operational
 * - Sounds like something said in eng leadership meeting
 * - NO compound noun chains
 * - NO "variance" unless mathematically necessary
 * - NO "fragmentation" or "concentration"
 */

export interface TitlePattern {
  structure: string;
  examples: string[];
  category: 'direct_metric' | 'model_impact' | 'risk_indicator' | 'trend_observation';
}

/**
 * GOOD title patterns that sound operationally authentic
 */
const AUTHENTIC_TITLE_PATTERNS: TitlePattern[] = [
  // Direct metric patterns (like Datadog)
  {
    structure: '{model} {metric} {direction}',
    examples: [
      'Claude Sonnet 4.6 PR cycle time decreased',
      'SWE-1.6 release stability declined',
      'Cursor workflows reopen rates increased',
      'GPT-5 Coding deployment frequency improved'
    ],
    category: 'direct_metric'
  },
  
  // Model impact patterns (like LinearB)
  {
    structure: '{metric} {direction} in {model} workflows',
    examples: [
      'Release stability weakened in SWE-1.6 workflows',
      'Reviewer load increased in Claude Sonnet 4.6 sessions',
      'Merge conflicts rose in GPT-5 Coding PRs',
      'Deployment timing became less consistent'
    ],
    category: 'model_impact'
  },
  
  // Risk indicator patterns (like incident reviews)
  {
    structure: '{model} {risk_type} {direction}',
    examples: [
      'SWE-1.6 rollback frequency increased',
      'Claude Sonnet 4.6 failure rate elevated',
      'Devin workflows deployment risk grew',
      'GPT-5 Coding quality issues surfaced'
    ],
    category: 'risk_indicator'
  },
  
  // Trend observation patterns (like GitHub analytics)
  {
    structure: '{metric} became {trend}',
    examples: [
      'Release timing became less consistent',
      'PR review quality declined',
      'Deployment frequency slowed',
      'Merge velocity accelerated'
    ],
    category: 'trend_observation'
  }
];

/**
 * BAD patterns to eliminate (synthetic AI fingerprints)
 */
const BANNED_TITLE_PATTERNS = [
  'SWE-1.6 workflows showed uneven delivery acceleration',
  'Claude Sonnet 4.6 workflows showed inconsistent deployment timing',
  'Claude Sonnet 4.6 workflows accelerated PR cycle throughput',
  'velocity compression signaling',
  'coordination constraints observed',
  'throughput coordination variance',
  'operational divergence detected',
  'workflow concentration dynamics',
  'stability pressure increased',
  'flow efficiency decreased',
  'Claude Sonnet 4.6 and SWE-1.6 workflows showed uneven delivery velocity',
  'cadence variance',
  'workflow coordination variance',
  'efficiency concentrated',
  'throughput compressed',
  'fragmentation',
  'variance'
];

/**
 * Direct operational metrics (no abstract concepts)
 */
const OPERATIONAL_METRICS = [
  'PR cycle time',
  'release stability',
  'reopen rate',
  'deployment frequency',
  'reviewer load',
  'merge conflicts',
  'rollback frequency',
  'failure rate',
  'deployment risk',
  'quality issues',
  'release timing',
  'review quality',
  'merge velocity',
  'delivery speed',
  'code stability',
  'test failures',
  'build time',
  'deployment time',
  'review time',
  'approval rate'
];

/**
 * Simple directional terms (no corporate speak)
 */
const DIRECTIONAL_TERMS = {
  increased: ['increased', 'rose', 'grew', 'elevated'],
  decreased: ['decreased', 'fell', 'dropped', 'declined'],
  improved: ['improved', 'better', 'enhanced'],
  worsened: ['worsened', 'declined', 'degraded'],
  stable: ['stable', 'consistent', 'steady'],
  unstable: ['unstable', 'inconsistent', 'variable']
};

/**
 * AI model names for context
 */
const AI_MODELS = [
  'Claude Sonnet 4.6',
  'SWE-1.6',
  'GPT-5 Coding',
  'Cursor',
  'Windsurf',
  'VS Code'
];

/**
 * Generate authentic title from components
 */
export function generateAuthenticTitle(
  model?: string,
  metric?: string,
  direction?: string,
  pattern?: TitlePattern
): string {
  // If banned pattern detected, rewrite automatically
  if (metric && isBannedPattern(metric)) {
    return rewriteBannedTitle(metric, model);
  }
  
  // Select pattern if not provided
  const selectedPattern = pattern || AUTHENTIC_TITLE_PATTERNS[
    Math.floor(Math.random() * AUTHENTIC_TITLE_PATTERNS.length)
  ];
  
  // Generate components
  const selectedModel = model || AI_MODELS[Math.floor(Math.random() * AI_MODELS.length)];
  const selectedMetric = metric || OPERATIONAL_METRICS[Math.floor(Math.random() * OPERATIONAL_METRICS.length)];
  const selectedDirection = direction || getRandomDirection();
  
  // Build title based on pattern structure
  switch (selectedPattern.category) {
    case 'direct_metric':
      return `${selectedModel} ${selectedMetric} ${selectedDirection}`;
    
    case 'model_impact':
      return `${selectedMetric} ${selectedDirection} in ${selectedModel} workflows`;
    
    case 'risk_indicator':
      const riskType = getRiskType(selectedMetric);
      return `${selectedModel} ${riskType} ${selectedDirection}`;
    
    case 'trend_observation':
      return `${selectedMetric} became ${getTrendAdjective(selectedDirection)}`;
    
    default:
      return `${selectedModel} ${selectedMetric} ${selectedDirection}`;
  }
}

/**
 * Check if title contains banned pattern
 */
export function isBannedPattern(title: string): boolean {
  return BANNED_TITLE_PATTERNS.some(banned => 
    title.toLowerCase().includes(banned.toLowerCase())
  );
}

/**
 * Rewrite banned title with operational language
 */
export function rewriteBannedTitle(bannedTitle: string, model?: string): string {
  // Extract core meaning and rewrite
  let rewritten = bannedTitle;
  
  // Replace banned patterns
  BANNED_TITLE_PATTERNS.forEach(banned => {
    if (rewritten.toLowerCase().includes(banned.toLowerCase())) {
      // Map to operational equivalent
      const operational = mapToOperational(banned);
      rewritten = rewritten.replace(new RegExp(banned, 'gi'), operational);
    }
  });
  
  // Ensure model context if provided
  if (model && !rewritten.includes(model)) {
    rewritten = `${model} ${rewritten}`;
  }
  
  return rewritten;
}

/**
 * Map banned patterns to operational equivalents
 */
function mapToOperational(banned: string): string {
  const mappings: Record<string, string> = {
    'SWE-1.6 workflows showed uneven delivery acceleration': 'SWE-1.6 workflows showed uneven delivery acceleration',
    'Claude Sonnet 4.6 workflows showed inconsistent deployment timing': 'Claude Sonnet 4.6 workflows showed inconsistent deployment timing',
    'Claude Sonnet 4.6 workflows accelerated PR cycle throughput': 'Claude Sonnet 4.6 workflows accelerated PR cycle throughput',
    'velocity compression': 'delivery slowdown',
    'coordination constraints': 'coordination bottlenecks',
    'throughput coordination': 'delivery coordination',
    'operational divergence': 'operational differences',
    'workflow concentration': 'workflow clustering',
    'stability pressure': 'stability risk',
    'flow efficiency': 'workflow speed',
    'Claude Sonnet 4.6 workflows showed uneven delivery velocity': 'Claude Sonnet 4.6 workflows showed uneven delivery velocity',
    'cadence variance': 'timing inconsistency',
    'workflow coordination variance': 'coordination differences',
    'efficiency concentrated': 'efficiency focused',
    'throughput compressed': 'throughput reduced',
    'fragmentation': 'inconsistency',
    'variance': 'differences'
  };
  
  return mappings[banned] || 'operational changes';
}

/**
 * Get random directional term
 */
function getRandomDirection(): string {
  const allDirections = Object.values(DIRECTIONAL_TERMS).flat();
  return allDirections[Math.floor(Math.random() * allDirections.length)];
}

/**
 * Get risk type from metric
 */
function getRiskType(metric: string): string {
  if (metric.includes('deployment') || metric.includes('release')) {
    return 'deployment risk';
  } else if (metric.includes('quality') || metric.includes('failure')) {
    return 'quality risk';
  } else if (metric.includes('rollback') || metric.includes('revert')) {
    return 'rollback frequency';
  } else {
    return 'operational risk';
  }
}

/**
 * Get trend adjective from direction
 */
function getTrendAdjective(direction: string): string {
  const trendMappings: Record<string, string> = {
    increased: 'higher',
    decreased: 'lower',
    improved: 'better',
    worsened: 'worse',
    stable: 'consistent',
    unstable: 'inconsistent'
  };
  
  return trendMappings[direction] || 'changed';
}

/**
 * Validate title authenticity
 */
export function validateTitleAuthenticity(title: string): {
  isAuthentic: boolean;
  credibilityScore: number;
  issues: string[];
  suggestions: string[];
} {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;
  
  // Check for banned patterns
  if (isBannedPattern(title)) {
    issues.push('Contains banned AI-generated pattern');
    suggestions.push('Rewrite with direct operational language');
    score -= 30;
  }
  
  // Check for compound noun chains
  const compoundNouns = title.match(/\\b\\w+ \\w+ \\w+\\b/g);
  if (compoundNouns && compoundNouns.length > 0) {
    issues.push('Contains compound noun chains');
    suggestions.push('Break into shorter, direct phrases');
    score -= 20;
  }
  
  // Check for abstract terms
  const abstractTerms = ['variance', 'fragmentation', 'concentration', 'efficiency', 'optimization'];
  abstractTerms.forEach(term => {
    if (title.toLowerCase().includes(term)) {
      issues.push(`Contains abstract term: ${term}`);
      suggestions.push(`Replace with concrete operational language`);
      score -= 15;
    }
  });
  
  // Check length
  if (title.length > 80) {
    issues.push('Title too long for operational authenticity');
    suggestions.push('Shorten to under 80 characters');
    score -= 10;
  }
  
  return {
    isAuthentic: issues.length === 0,
    credibilityScore: Math.max(0, score),
    issues,
    suggestions
  };
}

/**
 * Apply title hardening to existing title
 */
export function hardenTitle(existingTitle: string): string {
  // If authentic, return as-is
  const validation = validateTitleAuthenticity(existingTitle);
  if (validation.isAuthentic) {
    return existingTitle;
  }
  
  // If banned, rewrite
  if (isBannedPattern(existingTitle)) {
    return rewriteBannedTitle(existingTitle);
  }
  
  // Otherwise, generate new authentic title
  return generateAuthenticTitle();
}
