/**
 * Global Banned Phrase Registry
 * 
 * Eliminates AI-generated credibility killers that make the system
 * sound fake to VP Engineering audiences.
 * 
 * CREDIBILITY KILLERS - NEVER ALLOW THESE:
 * - Synthetic compound noun chains
 * - AI-generated enterprise phrasing
 * - Fake operational ontology
 * - MBA consulting jargon
 */

export interface BannedPhrase {
  phrase: string;
  category: 'compound_noun' | 'enterprise_speak' | 'fake_ontology' | 'mba_jargon';
  replacement: string;
  severity: 'critical' | 'high' | 'medium';
}

/**
 * CRITICAL: These phrases should NEVER appear anywhere in the system
 */
export const BANNED_PHRASES: BannedPhrase[] = [
  // Compound noun chains (CRITICAL - synthetic AI fingerprints)
  {
    phrase: 'cadence variance',
    category: 'compound_noun',
    replacement: 'inconsistent timing',
    severity: 'critical'
  },
  {
    phrase: 'acceleration fragmentation',
    category: 'compound_noun',
    replacement: 'uneven speed increases',
    severity: 'critical'
  },
  {
    phrase: 'velocity compression',
    category: 'compound_noun',
    replacement: 'slower delivery',
    severity: 'critical'
  },
  {
    phrase: 'coordination compression',
    category: 'compound_noun',
    replacement: 'coordination bottlenecks',
    severity: 'critical'
  },
  {
    phrase: 'workflow concentration',
    category: 'compound_noun',
    replacement: 'workflow clustering',
    severity: 'critical'
  },
  {
    phrase: 'operational divergence',
    category: 'compound_noun',
    replacement: 'operational differences',
    severity: 'critical'
  },
  {
    phrase: 'pressure dynamics',
    category: 'compound_noun',
    replacement: 'capacity issues',
    severity: 'critical'
  },
  {
    phrase: 'signaling constraints',
    category: 'compound_noun',
    replacement: 'coordination limits',
    severity: 'critical'
  },
  {
    phrase: 'throughput coordination',
    category: 'compound_noun',
    replacement: 'delivery coordination',
    severity: 'critical'
  },
  {
    phrase: 'SWE-1.6 workflows showed uneven delivery acceleration',
    category: 'compound_noun',
    replacement: 'SWE-1.6 workflows showed uneven delivery acceleration',
    severity: 'critical'
  },
  {
    phrase: 'Claude Sonnet 4.6 workflows showed inconsistent deployment timing',
    category: 'compound_noun',
    replacement: 'Claude Sonnet 4.6 workflows showed inconsistent deployment timing',
    severity: 'critical'
  },
  {
    phrase: 'Claude Sonnet 4.6 workflows accelerated PR cycle throughput',
    category: 'compound_noun',
    replacement: 'Claude Sonnet 4.6 workflows accelerated PR cycle throughput',
    severity: 'critical'
  },

  // Enterprise speak (HIGH - sounds like MBA consulting)
  {
    phrase: 'synergistic',
    category: 'enterprise_speak',
    replacement: 'coordinated',
    severity: 'high'
  },
  {
    phrase: 'paradigm',
    category: 'enterprise_speak',
    replacement: 'approach',
    severity: 'high'
  },
  {
    phrase: 'leverage',
    category: 'enterprise_speak',
    replacement: 'use',
    severity: 'high'
  },
  {
    phrase: 'optimize',
    category: 'enterprise_speak',
    replacement: 'improve',
    severity: 'high'
  },
  {
    phrase: 'strategic',
    category: 'enterprise_speak',
    replacement: 'planned',
    severity: 'high'
  },
  {
    phrase: 'holistic',
    category: 'enterprise_speak',
    replacement: 'complete',
    severity: 'high'
  },
  {
    phrase: 'comprehensive',
    category: 'enterprise_speak',
    replacement: 'thorough',
    severity: 'high'
  },
  {
    phrase: 'robust',
    category: 'enterprise_speak',
    replacement: 'strong',
    severity: 'high'
  },
  {
    phrase: 'scalable',
    category: 'enterprise_speak',
    replacement: 'flexible',
    severity: 'high'
  },
  {
    phrase: 'efficient',
    category: 'enterprise_speak',
    replacement: 'fast',
    severity: 'high'
  },
  {
    phrase: 'effective',
    category: 'enterprise_speak',
    replacement: 'successful',
    severity: 'high'
  },

  // Fake operational ontology (HIGH - synthetic concepts)
  {
    phrase: 'stability pressure',
    category: 'fake_ontology',
    replacement: 'stability risk',
    severity: 'high'
  },
  {
    phrase: 'flow efficiency',
    category: 'fake_ontology',
    replacement: 'workflow speed',
    severity: 'high'
  },
  {
    phrase: 'velocity compression',
    category: 'fake_ontology',
    replacement: 'delivery slowdown',
    severity: 'high'
  },
  {
    phrase: 'release validation drift',
    category: 'fake_ontology',
    replacement: 'validation inconsistency',
    severity: 'high'
  },

  // MBA jargon (MEDIUM - sounds like consulting)
  {
    phrase: 'methodology',
    category: 'mba_jargon',
    replacement: 'process',
    severity: 'medium'
  },
  {
    phrase: 'framework',
    category: 'mba_jargon',
    replacement: 'structure',
    severity: 'medium'
  },
  {
    phrase: 'ecosystem',
    category: 'mba_jargon',
    replacement: 'system',
    severity: 'medium'
  },
  {
    phrase: 'landscape',
    category: 'mba_jargon',
    replacement: 'environment',
    severity: 'medium'
  },
  {
    phrase: 'journey',
    category: 'mba_jargon',
    replacement: 'process',
    severity: 'medium'
  },
  {
    phrase: 'transformation',
    category: 'mba_jargon',
    replacement: 'change',
    severity: 'medium'
  }
];

/**
 * Auto-rewrite banned phrases with operational alternatives
 */
export function rewriteBannedPhrases(text: string): string {
  let rewritten = text;
  
  // Process by severity order (critical first)
  const criticalPhrases = BANNED_PHRASES.filter(p => p.severity === 'critical');
  const highPhrases = BANNED_PHRASES.filter(p => p.severity === 'high');
  const mediumPhrases = BANNED_PHRASES.filter(p => p.severity === 'medium');
  
  // Apply rewrites in order
  [...criticalPhrases, ...highPhrases, ...mediumPhrases].forEach(banned => {
    const regex = new RegExp(banned.phrase, 'gi');
    rewritten = rewritten.replace(regex, banned.replacement);
  });
  
  return rewritten;
}

/**
 * Check if text contains banned phrases
 */
export function containsBannedPhrases(text: string): BannedPhrase[] {
  const found: BannedPhrase[] = [];
  
  BANNED_PHRASES.forEach(banned => {
    if (text.toLowerCase().includes(banned.phrase.toLowerCase())) {
      found.push(banned);
    }
  });
  
  return found;
}

/**
 * Get banned phrases by category
 */
export function getBannedPhrasesByCategory(category: BannedPhrase['category']): BannedPhrase[] {
  return BANNED_PHRASES.filter(p => p.category === category);
}

/**
 * Get banned phrases by severity
 */
export function getBannedPhrasesBySeverity(severity: BannedPhrase['severity']): BannedPhrase[] {
  return BANNED_PHRASES.filter(p => p.severity === severity);
}

/**
 * Validate text for banned phrases and return credibility score
 */
export function validateBannedPhrases(text: string): {
  isValid: boolean;
  credibilityScore: number;
  violations: BannedPhrase[];
  rewritten: string;
} {
  const violations = containsBannedPhrases(text);
  const rewritten = rewriteBannedPhrases(text);
  
  // Calculate credibility score based on violations
  let score = 100;
  violations.forEach(violation => {
    switch (violation.severity) {
      case 'critical':
        score -= 25;
        break;
      case 'high':
        score -= 15;
        break;
      case 'medium':
        score -= 8;
        break;
    }
  });
  
  score = Math.max(0, score);
  
  return {
    isValid: violations.length === 0,
    credibilityScore: score,
    violations,
    rewritten
  };
}

/**
 * Apply banned phrase filtering to insight object
 */
export function filterInsightBannedPhrases(insight: any): any {
  const filtered = { ...insight };
  
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
    if (filtered[field] && typeof filtered[field] === 'string') {
      filtered[field] = rewriteBannedPhrases(filtered[field]);
    }
  });
  
  return filtered;
}
