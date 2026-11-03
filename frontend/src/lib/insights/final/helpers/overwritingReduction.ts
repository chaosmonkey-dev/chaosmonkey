/**
 * Overwriting Reduction System
 * 
 * Reduces adjective density and abstract nouns to create more authentic,
 * restrained engineering language that sounds like real analytics platforms.
 * 
 * TARGET TONE:
 * - "real analytics platform"
 * - NOT: "LLM trying to sound insightful"
 * - Tired but smart staff engineer
 * - Direct operational summaries
 * - Restraint over interpretation
 */

export interface OverwritingMetrics {
  adjectiveCount: number;
  abstractNounCount: number;
  sentenceComplexity: number;
  interpretationLevel: number;
  densityScore: number;
}

export interface ReductionOptions {
  maxAdjectivesPerSentence: number;
  maxAbstractNounsPerSentence: number;
  maxSentenceLength: number;
  removeInterpretiveWords: boolean;
  shortenSentences: boolean;
}

/**
 * Words that indicate over-interpretation (AI fingerprints)
 */
const INTERPRETIVE_WORDS = [
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
 * Abstract nouns that sound AI-generated
 */
const ABSTRACT_NOUNS = [
  'sustainability',
  'scalability',
  'maintainability',
  'reliability',
  'efficiency',
  'productivity',
  'quality',
  'performance',
  'optimization',
  'enhancement',
  'improvement',
  'capability',
  'capacity',
  'functionality',
  'complexity',
  'simplicity',
  'flexibility',
  'agility',
  'resilience',
  'maturity',
  'readiness',
  'alignment',
  'harmonization',
  'standardization',
  'normalization',
  'integration',
  'consolidation',
  'coordination',
  'collaboration',
  'synergy',
  'leverage',
  'paradigm',
  'methodology',
  'framework',
  'ecosystem',
  'landscape',
  'journey',
  'transformation'
];

/**
 * Over-interpretive phrases that sound like LLM analysis
 */
const OVER_INTERPRETIVE_PHRASES = [
  'This suggests that',
  'This indicates that',
  'This reveals that',
  'This demonstrates that',
  'This implies that',
  'This points to',
  'This underscores',
  'This highlights',
  'It is important to note that',
  'It should be noted that',
  'It is worth mentioning that',
  'In terms of',
  'With respect to',
  'In the context of',
  'From the perspective of',
  'Looking at it from',
  'When we consider',
  'Taking into account',
  'Given that',
  'Considering that',
  'Based on the fact that',
  'Due to the fact that',
  'As a result of',
  'In order to',
  'For the purpose of'
];

/**
 * Analyze text for overwriting indicators
 */
export function analyzeOverwriting(text: string): OverwritingMetrics {
  const words = text.split(/\s+/);
  const sentences = text.split('.').filter(s => s.trim().length > 0);
  
  // Count interpretive adjectives
  const adjectiveCount = INTERPRETIVE_WORDS.filter(word => 
    text.toLowerCase().includes(word.toLowerCase())
  ).length;
  
  // Count abstract nouns
  const abstractNounCount = ABSTRACT_NOUNS.filter(word => 
    text.toLowerCase().includes(word.toLowerCase())
  ).length;
  
  // Calculate sentence complexity (average length)
  const avgSentenceLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;
  const sentenceComplexity = avgSentenceLength / 100; // Normalize to 0-1 scale
  
  // Calculate interpretation level (presence of interpretive phrases)
  const interpretationLevel = OVER_INTERPRETIVE_PHRASES.filter(phrase => 
    text.toLowerCase().includes(phrase.toLowerCase())
  ).length / OVER_INTERPRETIVE_PHRASES.length;
  
  // Calculate overall density score
  const densityScore = (adjectiveCount + abstractNounCount) / words.length;
  
  return {
    adjectiveCount,
    abstractNounCount,
    sentenceComplexity,
    interpretationLevel,
    densityScore
  };
}

/**
 * Reduce overwriting in text
 */
export function reduceOverwriting(text: string, options: ReductionOptions): {
  reduced: string;
  metrics: OverwritingMetrics;
  changes: string[];
} {
  const changes: string[] = [];
  let reduced = text;
  
  // Remove interpretive adjectives
  const adjectiveChanges = removeInterpretiveAdjectives(reduced);
  reduced = adjectiveChanges.text;
  changes.push(...adjectiveChanges.changes);
  
  // Replace abstract nouns with concrete alternatives
  const nounChanges = replaceAbstractNouns(reduced);
  reduced = nounChanges.text;
  changes.push(...nounChanges.changes);
  
  // Remove over-interpretive phrases
  const phraseChanges = removeOverInterpretivePhrases(reduced);
  reduced = phraseChanges.text;
  changes.push(...phraseChanges.changes);
  
  // Shorten sentences if needed
  if (options.shortenSentences) {
    const sentenceChanges = shortenSentences(reduced);
    reduced = sentenceChanges.text;
    changes.push(...sentenceChanges.changes);
  }
  
  // Apply sentence length limits
  reduced = applySentenceLengthLimits(reduced, options.maxSentenceLength);
  
  // Calculate final metrics
  const metrics = analyzeOverwriting(reduced);
  
  return {
    reduced,
    metrics,
    changes
  };
}

/**
 * Remove interpretive adjectives
 */
function removeInterpretiveAdjectives(text: string): {
  text: string;
  changes: string[];
} {
  const changes: string[] = [];
  let modified = text;
  
  INTERPRETIVE_WORDS.forEach(adjective => {
    const regex = new RegExp(`\\b${adjective}\\b`, 'gi');
    if (regex.test(modified)) {
      modified = modified.replace(regex, '');
      changes.push(`Removed interpretive adjective: ${adjective}`);
    }
  });
  
  // Clean up extra spaces
  modified = modified.replace(/\s+/g, ' ').trim();
  
  return { text: modified, changes };
}

/**
 * Replace abstract nouns with concrete alternatives
 */
function replaceAbstractNouns(text: string): {
  text: string;
  changes: string[];
} {
  const changes: string[] = [];
  let modified = text;
  
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
    'collaboration': 'teamwork',
    'synergy': 'coordination',
    'leverage': 'use',
    'paradigm': 'approach',
    'methodology': 'process',
    'framework': 'structure',
    'ecosystem': 'system',
    'landscape': 'environment',
    'journey': 'process',
    'transformation': 'change'
  };
  
  Object.entries(concreteReplacements).forEach(([abstract, concrete]) => {
    const regex = new RegExp(`\\b${abstract}\\b`, 'gi');
    if (regex.test(modified)) {
      modified = modified.replace(regex, concrete);
      changes.push(`Replaced "${abstract}" with "${concrete}"`);
    }
  });
  
  return { text: modified, changes };
}

/**
 * Remove over-interpretive phrases
 */
function removeOverInterpretivePhrases(text: string): {
  text: string;
  changes: string[];
} {
  const changes: string[] = [];
  let modified = text;
  
  OVER_INTERPRETIVE_PHRASES.forEach(phrase => {
    const regex = new RegExp(phrase.replace(/\s+/g, '\\s+'), 'gi');
    if (regex.test(modified)) {
      modified = modified.replace(regex, '');
      changes.push(`Removed interpretive phrase: "${phrase}"`);
    }
  });
  
  // Clean up sentence fragments
  modified = modified.replace(/\s+\./g, '.').replace(/\.\s+\./g, '. ');
  
  return { text: modified, changes };
}

/**
 * Shorten sentences for operational authenticity
 */
function shortenSentences(text: string): {
  text: string;
  changes: string[];
} {
  const changes: string[] = [];
  const sentences = text.split('.').filter(s => s.trim().length > 0);
  
  const shortened = sentences.map(sentence => {
    const trimmed = sentence.trim();
    
    // Remove introductory clauses
    let shortened = trimmed.replace(/^(This|It|That)\s+(suggests|indicates|reveals|demonstrates|implies|points to|underscores|highlights)\s+that\s+/gi, '');
    shortened = shortened.replace(/^(It is|It should be|It is worth)\s+(noted|mentioned)\s+that\s+/gi, '');
    
    // Remove concluding phrases
    shortened = shortened.replace(/\s+(which|that)\s+(means|indicates|suggests|implies|shows|demonstrates)\s+.*$/gi, '');
    shortened = shortened.replace(/\s+(indicating|suggesting|implying|showing|demonstrating)\s+.*$/gi, '');
    
    // Remove redundant connectors
    shortened = shortened.replace(/\b(in order to|for the purpose of|with respect to|in terms of|in the context of)\b/gi, '');
    
    if (shortened !== trimmed) {
      changes.push(`Shortened: "${trimmed}" → "${shortened}"`);
    }
    
    return shortened;
  });
  
  return { text: shortened.join('. '), changes };
}

/**
 * Apply sentence length limits
 */
function applySentenceLengthLimits(text: string, maxLength: number): string {
  const sentences = text.split('.').filter(s => s.trim().length > 0);
  
  const limited = sentences.map(sentence => {
    const trimmed = sentence.trim();
    if (trimmed.length <= maxLength) {
      return trimmed;
    }
    
    // Try to truncate at word boundary
    const words = trimmed.split(' ');
    let result = '';
    
    for (const word of words) {
      if ((result + word).length <= maxLength - 3) {
        result += (result ? ' ' : '') + word;
      } else {
        break;
      }
    }
    
    return result + '...';
  });
  
  return limited.join('. ');
}

/**
 * Validate overwriting reduction
 */
export function validateOverwritingReduction(original: string, reduced: string): {
  improvement: number;
  credibilityGain: number;
  stillOverwritten: string[];
  recommendations: string[];
} {
  const originalMetrics = analyzeOverwriting(original);
  const reducedMetrics = analyzeOverwriting(reduced);
  
  const improvement = originalMetrics.densityScore > 0
    ? (originalMetrics.densityScore - reducedMetrics.densityScore) / originalMetrics.densityScore
    : 0;
  const credibilityGain = (originalMetrics.interpretationLevel - reducedMetrics.interpretationLevel);
  
  const stillOverwritten: string[] = [];
  
  // Check remaining issues
  if (reducedMetrics.adjectiveCount > 3) {
    stillOverwritten.push('Too many interpretive adjectives');
  }
  
  if (reducedMetrics.abstractNounCount > 2) {
    stillOverwritten.push('Too many abstract nouns');
  }
  
  if (reducedMetrics.sentenceComplexity > 0.8) {
    stillOverwritten.push('Sentences too complex');
  }
  
  if (reducedMetrics.interpretationLevel > 0.3) {
    stillOverwritten.push('Still sounds interpretive');
  }
  
  const recommendations: string[] = [];
  
  if (stillOverwritten.length > 0) {
    recommendations.push('Further reduction needed for authentic tone');
  }
  
  if (reducedMetrics.densityScore > 0.05) {
    recommendations.push('Consider more concrete language');
  }
  
  if (reducedMetrics.sentenceComplexity > 0.6) {
    recommendations.push('Shorten sentences for operational authenticity');
  }
  
  return {
    improvement,
    credibilityGain,
    stillOverwritten,
    recommendations
  };
}

/**
 * Apply overwriting reduction to insight object
 */
export function applyOverwritingReductionToInsight(insight: any): any {
  const options: ReductionOptions = {
    maxAdjectivesPerSentence: 1,
    maxAbstractNounsPerSentence: 1,
    maxSentenceLength: 80,
    removeInterpretiveWords: true,
    shortenSentences: true
  };
  
  const reduced = { ...insight };
  
  // Apply to all text fields
  const textFields = [
    'title',
    'description',
    'whatChanged',
    'whyItMatters',
    'evidenceAndContext',
    'operationalImpact',
    'primaryRisk',
    'executiveSummary'
  ];
  
  textFields.forEach(field => {
    if (reduced[field] && typeof reduced[field] === 'string') {
      const result = reduceOverwriting(reduced[field], options);
      reduced[field] = result.reduced;
    }
  });
  
  return reduced;
}

/**
 * Generate staff-engineer style summary
 */
export function generateStaffEngineerSummary(
  finding: string,
  impact: string,
  action: string
): string {
  // Apply reduction to create authentic tone
  const options: ReductionOptions = {
    maxAdjectivesPerSentence: 0,
    maxAbstractNounsPerSentence: 0,
    maxSentenceLength: 60,
    removeInterpretiveWords: true,
    shortenSentences: true
  };
  
  const combined = `${finding}. ${impact}. ${action}`;
  const result = reduceOverwriting(combined, options);
  
  return result.reduced;
}
