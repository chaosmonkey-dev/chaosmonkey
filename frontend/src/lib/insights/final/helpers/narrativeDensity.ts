/**
 * Narrative Density Reduction System
 * 
 * Reduces over-explaining and narrative density in PI cards to make them
 * sound like tired but smart staff engineer analysis, not LLM-generated prose.
 * 
 * CREDIBILITY PRINCIPLES:
 * - Reduce unnecessary narrative density
 * - Shorter "what changed" copy
 * - Fewer adjectives and abstract nouns
 * - Fewer attempts to sound intelligent
 * - More concise operational summaries
 */

export interface NarrativeDensitySettings {
  maxDescriptionLength: number;
  maxWhatChangedLength: number;
  maxWhyItMattersLength: number;
  maxEvidenceLength: number;
  adjectiveReduction: boolean;
  abstractNounReduction: boolean;
  corporateSpeakRemoval: boolean;
}

export interface DenseNarrative {
  description: string;
  whatChanged: string;
  whyItMatters: string;
  evidenceAndContext: string;
  operationalImpact: string;
  primaryRisk: string;
  executiveSummary: string;
}

/**
 * Default density settings for different insight types
 */
const DEFAULT_DENSITY_SETTINGS: Record<string, NarrativeDensitySettings> = {
  operational: {
    maxDescriptionLength: 120,
    maxWhatChangedLength: 80,
    maxWhyItMattersLength: 60,
    maxEvidenceLength: 150,
    adjectiveReduction: true,
    abstractNounReduction: true,
    corporateSpeakRemoval: true
  },
  executive: {
    maxDescriptionLength: 100,
    maxWhatChangedLength: 70,
    maxWhyItMattersLength: 50,
    maxEvidenceLength: 120,
    adjectiveReduction: true,
    abstractNounReduction: true,
    corporateSpeakRemoval: true
  },
  technical: {
    maxDescriptionLength: 140,
    maxWhatChangedLength: 90,
    maxWhyItMattersLength: 70,
    maxEvidenceLength: 160,
    adjectiveReduction: false,
    abstractNounReduction: true,
    corporateSpeakRemoval: true
  }
};

/**
 * Words and phrases to remove for density reduction
 */
const CORPORATE_SPEAK_PATTERNS = [
  'synergistic',
  'paradigm',
  'leverage',
  'optimize',
  'strategic',
  'holistic',
  'comprehensive',
  'robust',
  'scalable',
  'efficient',
  'effective',
  'streamline',
  'enhance',
  'facilitate',
  'implement',
  'utilize',
  'methodology',
  'framework',
  'ecosystem',
  'landscape',
  'journey',
  'transformation',
  'digital transformation',
  'operational excellence',
  'best practices',
  'value proposition',
  'core competency',
  'game changer',
  'win-win',
  'out of the box',
  'touch base',
  'circle back',
  'deep dive',
  'low-hanging fruit',
  'move the needle',
  'boil the ocean'
];

const EXCESSIVE_ADJECTIVES = [
  'significant',
  'substantial',
  'considerable',
  'notable',
  'remarkable',
  'exceptional',
  'outstanding',
  'excellent',
  'superior',
  'optimal',
  'ideal',
  'perfect',
  'flawless',
  'seamless',
  'effortless',
  'instantaneous',
  'revolutionary',
  'innovative',
  'cutting-edge',
  'state-of-the-art',
  'world-class',
  'industry-leading',
  'mission-critical',
  'business-critical',
  'enterprise-grade',
  'production-ready'
];

/**
 * Reduce narrative density while preserving meaning
 */
export function reduceNarrativeDensity(
  narrative: DenseNarrative,
  insightType: 'operational' | 'executive' | 'technical' = 'operational'
): DenseNarrative {
  const settings = DEFAULT_DENSITY_SETTINGS[insightType];
  
  return {
    description: reduceTextDensity(narrative.description, settings),
    whatChanged: reduceTextDensity(narrative.whatChanged, settings),
    whyItMatters: reduceTextDensity(narrative.whyItMatters, settings),
    evidenceAndContext: reduceTextDensity(narrative.evidenceAndContext, settings),
    operationalImpact: reduceTextDensity(narrative.operationalImpact, settings),
    primaryRisk: reduceTextDensity(narrative.primaryRisk, settings),
    executiveSummary: reduceTextDensity(narrative.executiveSummary, settings)
  };
}

/**
 * Apply density reduction to individual text segments
 */
function reduceTextDensity(text: string, settings: NarrativeDensitySettings): string {
  let reduced = text;
  
  // Remove corporate speak
  if (settings.corporateSpeakRemoval) {
    reduced = removeCorporateSpeak(reduced);
  }
  
  // Remove abstract nouns
  if (settings.abstractNounReduction) {
    reduced = removeAbstractNouns(reduced);
  }
  
  // Remove excessive adjectives
  if (settings.adjectiveReduction) {
    reduced = removeExcessiveAdjectives(reduced);
  }
  
  // Shorten sentences
  reduced = shortenSentences(reduced);
  
  // Remove redundant phrases
  reduced = removeRedundantPhrases(reduced);
  
  // Apply length limits
  reduced = truncateToLength(reduced, getMaxLengthForField(reduced, settings));
  
  return reduced.trim();
}

/**
 * Remove corporate speak patterns
 */
function removeCorporateSpeak(text: string): string {
  let cleaned = text;
  
  CORPORATE_SPEAK_PATTERNS.forEach(pattern => {
    const regex = new RegExp(`\\b${pattern}\\b`, 'gi');
    cleaned = cleaned.replace(regex, '');
  });
  
  // Clean up extra spaces
  cleaned = cleaned.replace(/\\s+/g, ' ').trim();
  
  return cleaned;
}

/**
 * Remove abstract nouns and replace with concrete alternatives
 */
function removeAbstractNouns(text: string): string {
  const concreteReplacements: Record<string, string> = {
    'sustainability': 'long-term stability',
    'scalability': 'growth capacity',
    'maintainability': 'ease of changes',
    'reliability': 'consistency',
    'efficiency': 'speed',
    'productivity': 'output',
    'quality': 'accuracy',
    'performance': 'results',
    'optimization': 'improvements',
    'enhancement': 'upgrades',
    'improvement': 'better results',
    'capability': 'ability',
    'capacity': 'limit',
    'functionality': 'features',
    'complexity': 'difficulty',
    'simplicity': 'ease',
    'flexibility': 'adaptability',
    'agility': 'speed',
    'resilience': 'recovery',
    'maturity': 'readiness',
    'readiness': 'preparedness',
    'alignment': 'agreement',
    'harmonization': 'coordination',
    'standardization': 'consistency',
    'normalization': 'regularization',
    'integration': 'connection',
    'consolidation': 'combination',
    'coordination': 'teamwork',
    'collaboration': 'teamwork'
  };
  
  let cleaned = text;
  
  Object.entries(concreteReplacements).forEach(([abstract, concrete]) => {
    const regex = new RegExp(`\\b${abstract}\\b`, 'gi');
    cleaned = cleaned.replace(regex, concrete);
  });
  
  return cleaned;
}

/**
 * Remove excessive adjectives
 */
function removeExcessiveAdjectives(text: string): string {
  let cleaned = text;
  
  EXCESSIVE_ADJECTIVES.forEach(adjective => {
    const regex = new RegExp(`\\b${adjective}\\b`, 'gi');
    cleaned = cleaned.replace(regex, '');
  });
  
  // Clean up double spaces
  cleaned = cleaned.replace(/\\s+/g, ' ').trim();
  
  return cleaned;
}

/**
 * Shorten sentences by removing unnecessary clauses
 */
function shortenSentences(text: string): string {
  const sentences = text.split('.').map(s => s.trim()).filter(s => s.length > 0);
  
  const shortened = sentences.map(sentence => {
    // Remove introductory clauses
    if (sentence.startsWith('It is important to note that')) {
      sentence = sentence.replace('It is important to note that', '');
    }
    
    if (sentence.startsWith('It should be noted that')) {
      sentence = sentence.replace('It should be noted that', '');
    }
    
    if (sentence.startsWith('It is worth mentioning that')) {
      sentence = sentence.replace('It is worth mentioning that', '');
    }
    
    // Remove explanatory clauses
    sentence = sentence.replace(/, which means that/g, '');
    sentence = sentence.replace(/, indicating that/g, '');
    sentence = sentence.replace(/, suggesting that/g, '');
    sentence = sentence.replace(/, resulting in/g, '');
    
    return sentence.trim();
  });
  
  return shortened.join('. ');
}

/**
 * Remove redundant phrases
 */
function removeRedundantPhrases(text: string): string {
  const redundantPatterns = [
    { pattern: /in order to/g, replacement: 'to' },
    { pattern: /due to the fact that/g, replacement: 'because' },
    { pattern: /in terms of/g, replacement: '' },
    { pattern: /on the basis of/g, replacement: 'based on' },
    { pattern: /with respect to/g, replacement: 'for' },
    { pattern: /in the event that/g, replacement: 'if' },
    { pattern: /as a result of/g, replacement: 'from' },
    { pattern: /for the purpose of/g, replacement: 'to' },
    { pattern: /in the context of/g, replacement: 'for' },
    { pattern: /with regard to/g, replacement: 'about' }
  ];
  
  let cleaned = text;
  
  redundantPatterns.forEach(({ pattern, replacement }) => {
    cleaned = cleaned.replace(pattern, replacement);
  });
  
  return cleaned;
}

/**
 * Get appropriate max length for different field types
 */
function getMaxLengthForField(text: string, settings: NarrativeDensitySettings): number {
  // Heuristic: shorter for impact/summary fields, longer for evidence
  if (text.includes('impact') || text.includes('risk') || text.includes('summary')) {
    return Math.min(settings.maxDescriptionLength, 100);
  }
  
  if (text.includes('evidence') || text.includes('context')) {
    return settings.maxEvidenceLength;
  }
  
  return settings.maxDescriptionLength;
}

/**
 * Truncate text to specified length while preserving sentence boundaries
 */
function truncateToLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  
  // Try to truncate at sentence boundary
  const sentences = text.split('. ');
  let truncated = '';
  
  for (const sentence of sentences) {
    if ((truncated + sentence).length <= maxLength) {
      truncated += (truncated ? '. ' : '') + sentence;
    } else {
      break;
    }
  }
  
  // If no complete sentence fits, truncate at word boundary
  if (!truncated) {
    const words = text.split(' ');
    let result = '';
    
    for (const word of words) {
      if ((result + word).length <= maxLength - 3) {
        result += (result ? ' ' : '') + word;
      } else {
        break;
      }
    }
    
    return result + '...';
  }
  
  return truncated;
}

/**
 * Generate concise operational summary
 */
export function generateConciseSummary(
  keyMetric: string,
  value: string,
  impact: string,
  recommendation: string
): string {
  const parts = [
    `${keyMetric}: ${value}`,
    impact,
    recommendation
  ];
  
  return parts.join('. ').substring(0, 120) + (parts.join('. ').length > 120 ? '...' : '');
}

/**
 * Create staff-engineer style narrative
 */
export function createStaffEngineerNarrative(
  finding: string,
  impact: string,
  action: string
): DenseNarrative {
  return {
    description: `${finding}. ${impact}`.substring(0, 120),
    whatChanged: finding.substring(0, 80),
    whyItMatters: impact.substring(0, 60),
    evidenceAndContext: `Analysis of recent data shows ${finding.toLowerCase()}`.substring(0, 150),
    operationalImpact: impact.substring(0, 100),
    primaryRisk: `Risk: ${action}`.substring(0, 80),
    executiveSummary: `${finding}. ${action}`.substring(0, 100)
  };
}
