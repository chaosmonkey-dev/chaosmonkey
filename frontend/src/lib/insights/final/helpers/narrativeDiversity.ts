/**
 * Narrative Diversity System
 * 
 * Eliminates repetitive sentence structures that create AI fingerprints.
 * Replaces template patterns with diverse, authentic engineering language.
 * 
 * PROBLEM PATTERNS TO ELIMINATE:
 * - "[workflow] show[s] [abstract thing] enabling/signaling [constraint]"
 * - Repeated use of "show"
 * - Template sentence structures
 * - AI-ish synthesis language
 * 
 * TARGET TONE:
 * - Tired but smart staff engineer
 * - Direct operational observations
 * - Short, varied sentence structures
 * - Sounds like real incident review
 */

export interface NarrativePattern {
  structure: string;
  examples: string[];
  category: 'direct_observation' | 'impact_statement' | 'coordination_issue' | 'quality_tradeoff';
  avoidWords: string[];
}

/**
 * Diverse narrative patterns that avoid AI fingerprints
 */
const AUTHENTIC_NARRATIVE_PATTERNS: NarrativePattern[] = [
  // Direct observation patterns (like incident reviews)
  {
    structure: '{subject} {action} {outcome}',
    examples: [
      'Reviewer coordination lagged behind throughput gains.',
      'Release quality remained within baseline despite faster delivery.',
      'Merge throughput improved without increased rollback pressure.',
      'Teams using SWE-1.6 experienced wider deployment consistency gaps.',
      'Validation overhead increased as review speed accelerated.'
    ],
    category: 'direct_observation',
    avoidWords: ['show', 'demonstrate', 'indicate', 'reveal']
  },
  
  // Impact statement patterns (like staff engineer analysis)
  {
    structure: '{metric} {impact} due to {cause}',
    examples: [
      'PR cycle time increased due to reviewer bottlenecks.',
      'Deployment frequency slowed because of pipeline instability.',
      'Code quality declined as delivery pressure mounted.',
      'Merge conflicts rose from accelerated PR flows.',
      'Release consistency suffered from uneven testing coverage.'
    ],
    category: 'impact_statement',
    avoidWords: ['show', 'signal', 'enable', 'facilitate']
  },
  
  // Coordination issue patterns (like team retrospectives)
  {
    structure: '{team} {coordination_problem} when {condition}',
    examples: [
      'Review teams struggled with coordination when PR volume accelerated.',
      'Release coordination broke down as deployment frequency increased.',
      'QA teams faced validation challenges when code changes accelerated.',
      'DevOps teams managed pipeline pressure when merge rates rose.',
      'Support teams handled more incidents when deployment velocity increased.'
    ],
    category: 'coordination_issue',
    avoidWords: ['show', 'exhibit', 'display', 'manifest']
  },
  
  // Quality tradeoff patterns (like technical debt discussions)
  {
    structure: '{quality_metric} {tradeoff} as {speed_metric} {direction}',
    examples: [
      'Code review depth decreased as PR turnaround time accelerated.',
      'Test coverage declined as deployment frequency increased.',
      'Release stability suffered as delivery speed improved.',
      'Code quality drifted as merge velocity accelerated.',
      'Documentation completeness dropped as feature delivery accelerated.'
    ],
    category: 'quality_tradeoff',
    avoidWords: ['show', 'optimize', 'enhance', 'improve']
  }
];

/**
 * Banned sentence patterns (AI fingerprints)
 */
const BANNED_SENTENCE_PATTERNS = [
  'shows [abstract] enabling [constraint]',
  'shows [abstract] signaling [constraint]',
  'shows improved stability',
  'shows quality stability',
  'shows velocity compression',
  'indicates [pattern] enabling [outcome]',
  'demonstrates [quality] supporting [goal]',
  'reveals [insight] facilitating [result]',
  'exhibits [behavior] indicative of [trend]'
];

/**
 * Words to avoid in narratives (AI overuse indicators)
 */
const BANNED_WORDS = [
  'shows',
  'demonstrates',
  'indicates',
  'reveals',
  'exhibits',
  'signals',
  'enables',
  'facilitates',
  'optimizes',
  'enhances',
  'leverages',
  'synergizes',
  'paradigm',
  'methodology',
  'framework'
];

/**
 * Generate diverse narrative sentence
 */
export function generateDiverseNarrative(
  subject: string,
  action: string,
  outcome: string,
  pattern?: NarrativePattern
): string {
  // Select pattern if not provided
  const selectedPattern = pattern || AUTHENTIC_NARRATIVE_PATTERNS[
    Math.floor(Math.random() * AUTHENTIC_NARRATIVE_PATTERNS.length)
  ];
  
  // Build narrative based on pattern category
  switch (selectedPattern.category) {
    case 'direct_observation':
      return generateDirectObservation(subject, action, outcome);
    
    case 'impact_statement':
      return generateImpactStatement(subject, action, outcome);
    
    case 'coordination_issue':
      return generateCoordinationIssue(subject, action, outcome);
    
    case 'quality_tradeoff':
      return generateQualityTradeoff(subject, action, outcome);
    
    default:
      return generateDirectObservation(subject, action, outcome);
  }
}

/**
 * Generate direct observation narrative
 */
function generateDirectObservation(subject: string, action: string, outcome: string): string {
  const actionVerbs = ['lagged', 'improved', 'declined', 'increased', 'decreased', 'suffered', 'benefited'];
  const outcomePhrases = ['behind gains', 'without issues', 'significantly', 'noticeably', 'dramatically'];
  
  const selectedAction = action || actionVerbs[Math.floor(Math.random() * actionVerbs.length)];
  const selectedOutcome = outcome || outcomePhrases[Math.floor(Math.random() * outcomePhrases.length)];
  
  return `${subject} ${selectedAction} ${selectedOutcome}.`;
}

/**
 * Generate impact statement narrative
 */
function generateImpactStatement(subject: string, cause: string, _effect: string): string {
  const impactVerbs = ['increased', 'decreased', 'declined', 'improved', 'suffered', 'benefited'];
  const causalPhrases = ['due to', 'because of', 'from', 'as a result of'];
  
  const selectedImpact = impactVerbs[Math.floor(Math.random() * impactVerbs.length)];
  const selectedCausal = causalPhrases[Math.floor(Math.random() * causalPhrases.length)];
  
  return `${subject} ${selectedImpact} ${selectedCausal} ${cause || 'operational changes'}.`;
}

/**
 * Generate coordination issue narrative
 */
function generateCoordinationIssue(team: string, problem: string, condition: string): string {
  const coordinationVerbs = ['struggled', 'faced', 'managed', 'handled', 'dealt with'];
  const problemNouns = ['bottlenecks', 'challenges', 'pressure', 'constraints', 'issues'];
  const conditionClauses = ['when volume accelerated', 'as frequency increased', 'during rapid delivery'];
  
  const selectedVerb = coordinationVerbs[Math.floor(Math.random() * coordinationVerbs.length)];
  const selectedProblem = problem || problemNouns[Math.floor(Math.random() * problemNouns.length)];
  const selectedCondition = condition || conditionClauses[Math.floor(Math.random() * conditionClauses.length)];
  
  return `${team} ${selectedVerb} with ${selectedProblem} ${selectedCondition}.`;
}

/**
 * Generate quality tradeoff narrative
 */
function generateQualityTradeoff(qualityMetric: string, _tradeoff: string, speedMetric: string): string {
  const tradeoffVerbs = ['decreased', 'declined', 'suffered', 'dropped', 'reduced'];
  const speedVerbs = ['accelerated', 'increased', 'improved', 'rose', 'grew'];
  
  const selectedTradeoff = tradeoffVerbs[Math.floor(Math.random() * tradeoffVerbs.length)];
  const selectedSpeed = speedVerbs[Math.floor(Math.random() * speedVerbs.length)];
  
  return `${qualityMetric} ${selectedTradeoff} as ${speedMetric} ${selectedSpeed}.`;
}

/**
 * Check if narrative contains banned patterns
 */
export function containsBannedPatterns(narrative: string): boolean {
  const lowerNarrative = narrative.toLowerCase();
  
  // Check banned sentence patterns
  for (const pattern of BANNED_SENTENCE_PATTERNS) {
    const regex = new RegExp(pattern.replace(/\\[.*?\\]/g, '.*'), 'i');
    if (regex.test(lowerNarrative)) {
      return true;
    }
  }
  
  // Check banned words
  for (const word of BANNED_WORDS) {
    if (lowerNarrative.includes(word)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Rewrite banned narrative with authentic language
 */
export function rewriteBannedNarrative(bannedNarrative: string): string {
  let rewritten = bannedNarrative;
  
  // Replace banned words
  BANNED_WORDS.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const replacements: Record<string, string> = {
      'shows': 'reveals',
      'demonstrates': 'indicates',
      'indicates': 'suggests',
      'reveals': 'shows',
      'exhibits': 'displays',
      'signals': 'indicates',
      'enables': 'allows',
      'facilitates': 'supports',
      'optimizes': 'improves',
      'enhances': 'improves',
      'leverages': 'uses',
      'synergizes': 'combines'
    };
    
    rewritten = rewritten.replace(regex, replacements[word] || 'shows');
  });
  
  // Replace banned patterns
  BANNED_SENTENCE_PATTERNS.forEach(pattern => {
    const regex = new RegExp(pattern.replace(/\\[.*?\\]/g, '.*'), 'i');
    if (regex.test(rewritten)) {
      // Generate authentic replacement
      rewritten = generateDiverseNarrative('Teams', 'experienced', 'operational changes');
    }
  });
  
  return rewritten;
}

/**
 * Validate narrative diversity
 */
export function validateNarrativeDiversity(narrative: string): {
  isDiverse: boolean;
  credibilityScore: number;
  issues: string[];
  suggestions: string[];
} {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;
  
  // Check for banned patterns
  if (containsBannedPatterns(narrative)) {
    issues.push('Contains AI fingerprint patterns');
    suggestions.push('Rewrite with diverse sentence structures');
    score -= 25;
  }
  
  // Check for overuse of "show"
  const showCount = (narrative.match(/\\bshow\\b/gi) || []).length;
  if (showCount > 0) {
    issues.push(`Overuses "show" (${showCount} times)`);
    suggestions.push('Replace with varied verbs like "revealed", "indicated", "experienced"');
    score -= 15;
  }
  
  // Check sentence length variety
  const sentences = narrative.split('.').filter(s => s.trim().length > 0);
  const avgLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;
  if (avgLength > 80) {
    issues.push('Sentences too long (average: ' + Math.round(avgLength) + ' chars)');
    suggestions.push('Shorten sentences for operational authenticity');
    score -= 10;
  }
  
  // Check for template patterns
  const templateIndicators = ['enabling', 'signaling', 'facilitating', 'supporting'];
  templateIndicators.forEach(indicator => {
    if (narrative.toLowerCase().includes(indicator)) {
      issues.push(`Contains template indicator: ${indicator}`);
      suggestions.push('Use direct operational language instead');
      score -= 10;
    }
  });
  
  return {
    isDiverse: issues.length === 0,
    credibilityScore: Math.max(0, score),
    issues,
    suggestions
  };
}

/**
 * Apply narrative diversity to existing text
 */
export function diversifyNarrative(existingNarrative: string): string {
  // If diverse, return as-is
  const validation = validateNarrativeDiversity(existingNarrative);
  if (validation.isDiverse) {
    return existingNarrative;
  }
  
  // If banned, rewrite
  if (containsBannedPatterns(existingNarrative)) {
    return rewriteBannedNarrative(existingNarrative);
  }
  
  // Otherwise, generate new diverse narrative
  return generateDiverseNarrative('Teams', 'experienced', 'operational changes');
}
