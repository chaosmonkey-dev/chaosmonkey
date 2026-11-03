/**
 * Credibility Validation System
 * 
 * Validates that Performance Insights sound operationally authentic
 * and believable to senior engineering leaders.
 * 
 * CREDIBILITY PRINCIPLES:
 * - Titles sound like real engineering analytics, not AI
 * - Narrative structure avoids template repetition
 * - Pills are operational, not taxonomy-generated
 * - States are diverse, not all "Stable"
 * - Confidence/coverage combinations are statistically plausible
 * - Narrative density is restrained, not over-explained
 */

import type { CanonicalInsight } from '../types';
import { performSanityChecks } from './confidenceSanity';
import { reduceNarrativeDensity } from './narrativeDensity';

export interface CredibilityValidationResult {
  isCredible: boolean;
  credibilityScore: number; // 0-100
  issues: CredibilityIssue[];
  recommendations: string[];
  selfCritique: string;
}

export interface CredibilityIssue {
  type: 'title' | 'narrative' | 'pills' | 'state' | 'confidence' | 'density';
  severity: 'low' | 'medium' | 'high';
  description: string;
  suggestion: string;
}

/**
 * Validate insight credibility across all dimensions
 */
export function validateInsightCredibility(insight: CanonicalInsight): CredibilityValidationResult {
  const issues: CredibilityIssue[] = [];
  const recommendations: string[] = [];
  
  // Validate title
  const titleIssues = validateTitle(insight.title);
  issues.push(...titleIssues);
  
  // Validate narrative structure
  const narrativeIssues = validateNarrativeStructure(insight);
  issues.push(...narrativeIssues);
  
  // Validate pills/cohort
  const pillIssues = validatePills(insight);
  issues.push(...pillIssues);
  
  // Validate change state
  const stateIssues = validateChangeState(insight);
  issues.push(...stateIssues);
  
  // Validate confidence/coverage
  const confidenceIssues = validateConfidenceCoverage(insight);
  issues.push(...confidenceIssues);
  
  // Validate narrative density
  const densityIssues = validateNarrativeDensity(insight);
  issues.push(...densityIssues);
  
  // Calculate credibility score
  const credibilityScore = calculateCredibilityScore(issues);
  
  // Generate recommendations
  recommendations.push(...generateRecommendations(issues));
  
  // Generate self-critique
  const selfCritique = generateSelfCritique(insight, issues);
  
  return {
    isCredible: credibilityScore >= 70,
    credibilityScore,
    issues,
    recommendations,
    selfCritique
  };
}

/**
 * Validate title credibility
 */
function validateTitle(title: string): CredibilityIssue[] {
  const issues: CredibilityIssue[] = [];
  
  // Check for AI-generated compound nouns
  const compoundNouns = [
    'delivery acceleration', 'workflow coordination', 'throughput optimization',
    'cycle efficiency', 'operational instability', 'workflow fragmentation',
    'delivery variance', 'throughput compression', 'stability divergence',
    'cadence variance', 'workflow coordination variance', 'efficiency concentrated',
    'velocity compression', 'stability pressure', 'delivery delivery'
  ];
  
  compoundNouns.forEach(noun => {
    if (title.toLowerCase().includes(noun)) {
      issues.push({
        type: 'title',
        severity: 'high',
        description: `Title contains AI-generated compound noun: "${noun}"`,
        suggestion: `Replace with direct operational language, e.g., "delivery slowed" instead of "delivery acceleration fragmentation"`
      });
    }
  });
  
  // Check for MBA/consulting language
  const mbaTerms = [
    'synergistic', 'paradigm', 'leverage', 'strategic', 'holistic',
    'comprehensive', 'robust', 'scalable', 'optimize', 'enhance'
  ];
  
  mbaTerms.forEach(term => {
    if (title.toLowerCase().includes(term)) {
      issues.push({
        type: 'title',
        severity: 'medium',
        description: `Title contains MBA terminology: "${term}"`,
        suggestion: `Replace with concrete engineering term, e.g., "faster" instead of "enhanced"`
      });
    }
  });
  
  // Check if title sounds like real analytics platform
  const realPlatformPatterns = [
    /^\\w+ \\w+ (increased|decreased|rose|fell)/,
    /^\\w+ (cycle time|deployment frequency|failure rate) /,
    /^(PR|commit|deployment|review) \\w+ /
  ];
  
  const soundsReal = realPlatformPatterns.some(pattern => pattern.test(title));
  if (!soundsReal && !title.includes('workflows')) {
    issues.push({
      type: 'title',
      severity: 'medium',
      description: 'Title does not sound like real engineering analytics',
      suggestion: 'Use direct operational patterns like "Model X metric increased" or "PR cycle time decreased"'
    });
  }
  
  return issues;
}

/**
 * Validate narrative structure diversity
 */
function validateNarrativeStructure(insight: CanonicalInsight): CredibilityIssue[] {
  const issues: CredibilityIssue[] = [];
  
  // Check for repetitive "signaling coordination constraints" pattern
  const templatePatterns = [
    'shows [abstract phrase] signaling [constraint]',
    'indicates [pattern] enabling [outcome]',
    'demonstrates [quality] supporting [goal]'
  ];
  
  templatePatterns.forEach(pattern => {
    if (insight.whyItMatters?.match(new RegExp(pattern.replace(/\\[.*?\\]/g, '.*')))) {
      issues.push({
        type: 'narrative',
        severity: 'high',
        description: 'Narrative uses repetitive template structure',
        suggestion: 'Use diverse sentence patterns like "Reviewer coordination began lagging behind throughput gains"'
      });
    }
  });
  
  // Check for corporate AI phrasing
  const corporatePhrases = [
    'operational variance',
    'strategic acceleration',
    'enhanced productivity',
    'intelligent automation'
  ];
  
  corporatePhrases.forEach(phrase => {
    if (insight.whyItMatters?.includes(phrase)) {
      issues.push({
        type: 'narrative',
        severity: 'medium',
        description: `Narrative contains corporate AI phrasing: "${phrase}"`,
        suggestion: 'Replace with direct operational language like "faster delivery" or "more efficient"'
      });
    }
  });
  
  // Check sentence length
  const sentences = (insight.whyItMatters || '').split('.').filter(s => s.trim().length > 0);
  const avgSentenceLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;
  
  if (avgSentenceLength > 100) {
    issues.push({
      type: 'narrative',
      severity: 'medium',
      description: 'Sentences are too long (average: ' + Math.round(avgSentenceLength) + ' chars)',
      suggestion: 'Shorten sentences to sound more like direct engineering analysis'
    });
  }
  
  return issues;
}

/**
 * Validate pills are operational, not taxonomy-generated
 */
function validatePills(insight: CanonicalInsight): CredibilityIssue[] {
  const issues: CredibilityIssue[] = [];
  
  // Check for taxonomy-generated pills
  const taxonomyPills = [
    'AI workflow concentration',
    'stability-pressure divergence',
    'release validation drift',
    'throughput coordination variance',
    'workflow concentration dynamics',
    'delivery acceleration fragmentation'
  ];
  
  const pillText = insight.cohort || '';
  taxonomyPills.forEach(pill => {
    if (pillText.toLowerCase().includes(pill.toLowerCase())) {
      issues.push({
        type: 'pills',
        severity: 'high',
        description: `Pill sounds taxonomy-generated: "${pill}"`,
        suggestion: `Replace with operational label like "Reviewer saturation" or "Validation drift"`
      });
    }
  });
  
  // Check if pill sounds like real platform
  const operationalPills = [
    'reviewer saturation', 'validation drift', 'merge instability',
    'release inconsistency', 'coordination lag', 'quality drift'
  ];
  
  const soundsOperational = operationalPills.some(pill => 
    pillText.toLowerCase().includes(pill.toLowerCase())
  );
  
  if (!soundsOperational && !pillText.includes('Executive')) {
    issues.push({
      type: 'pills',
      severity: 'medium',
      description: 'Pill does not sound like real analytics platform tag',
      suggestion: 'Use short operational labels like "Reviewer saturation" or "Queue bottleneck"'
    });
  }
  
  return issues;
}

/**
 * Validate change state diversity
 */
function validateChangeState(insight: CanonicalInsight): CredibilityIssue[] {
  const issues: CredibilityIssue[] = [];
  
  // Note: This would need access to the actual state field
  // For now, we'll validate based on urgencyLabel patterns
  
  // Check if urgencyLabel indicates overuse of stable states
  // (This is a simplified check - would need multiple insights for real validation)
  const urgencyLabel = insight.urgencyLabel;
  if (urgencyLabel && ['investigate', 'monitor'].includes(urgencyLabel)) {
    // This might indicate overuse of neutral states
    issues.push({
      type: 'state',
      severity: 'low',
      description: 'Consider using more diverse change states',
      suggestion: 'Use states like "Improving", "Degrading", "Volatile", "Plateauing" for more realism'
    });
  }
  
  // Check for state diversity (would need multiple insights to validate)
  // This is a placeholder for when we have access to multiple insights
  
  return issues;
}

/**
 * Validate confidence/coverage realism
 */
function validateConfidenceCoverage(insight: CanonicalInsight): CredibilityIssue[] {
  const issues: CredibilityIssue[] = [];
  
  const sampleSize = insight.n || 0;
  const confidence = insight.confidence;
  const coverage = insight.coveragePct || 0;
  
  // Check for impossible combinations
  if (sampleSize < 10 && confidence === 'high' && coverage > 80) {
    issues.push({
      type: 'confidence',
      severity: 'high',
      description: 'Impossible combination: tiny sample with high confidence and high coverage',
      suggestion: 'Reduce confidence to "low" and coverage to <60% for samples <10'
    });
  }
  
  if (sampleSize < 30 && confidence === 'high' && coverage > 95) {
    issues.push({
      type: 'confidence',
      severity: 'high',
      description: 'Impossible combination: small sample with perfect coverage and high confidence',
      suggestion: 'Reduce confidence to "medium" and coverage to <85% for samples <30'
    });
  }
  
  if (sampleSize < 5 && confidence !== 'low') {
    issues.push({
      type: 'confidence',
      severity: 'high',
      description: 'Impossible combination: very small sample with high confidence',
      suggestion: 'Set confidence to "low" for samples <5'
    });
  }
  
  // Check for statistical implausibility
  if (sampleSize < 20 && coverage === 100) {
    issues.push({
      type: 'confidence',
      severity: 'medium',
      description: 'Statistically implausible: 100% coverage with small sample',
      suggestion: 'Reduce coverage to <80% for samples <20'
    });
  }
  
  return issues;
}

/**
 * Validate narrative density
 */
function validateNarrativeDensity(insight: CanonicalInsight): CredibilityIssue[] {
  const issues: CredibilityIssue[] = [];
  
  // Check description length
  const description = insight.description || '';
  if (description.length > 200) {
    issues.push({
      type: 'density',
      severity: 'medium',
      description: 'Description too long (' + description.length + ' chars)',
      suggestion: 'Shorten to <120 chars for operational authenticity'
    });
  }
  
  // Check for over-explaining
  const overExplainingPatterns = [
    'It is important to note that',
    'It should be noted that',
    'It is worth mentioning that',
    'in order to',
    'due to the fact that',
    'with respect to',
    'in the context of'
  ];
  
  overExplainingPatterns.forEach(pattern => {
    if (description.includes(pattern)) {
      issues.push({
        type: 'density',
        severity: 'medium',
        description: `Over-explaining with phrase: "${pattern}"`,
        suggestion: 'Remove unnecessary introductory phrases for tighter prose'
      });
    }
  });
  
  // Check for excessive adjectives
  const excessiveAdjectives = [
    'significant', 'substantial', 'considerable', 'remarkable',
    'exceptional', 'outstanding', 'excellent', 'superior'
  ];
  
  const adjectiveCount = excessiveAdjectives.filter(adj => 
    description.toLowerCase().includes(adj)
  ).length;
  
  if (adjectiveCount > 2) {
    issues.push({
      type: 'density',
      severity: 'low',
      description: 'Too many excessive adjectives (' + adjectiveCount + ')',
      suggestion: 'Remove unnecessary adjectives to sound more like staff engineer analysis'
    });
  }
  
  return issues;
}

/**
 * Calculate overall credibility score
 */
function calculateCredibilityScore(issues: CredibilityIssue[]): number {
  let score = 100;
  
  issues.forEach(issue => {
    switch (issue.severity) {
      case 'high':
        score -= 15;
        break;
      case 'medium':
        score -= 8;
        break;
      case 'low':
        score -= 3;
        break;
    }
  });
  
  return Math.max(0, score);
}

/**
 * Generate recommendations based on issues
 */
function generateRecommendations(issues: CredibilityIssue[]): string[] {
  const recommendations: string[] = [];
  
  if (issues.some(i => i.type === 'title')) {
    recommendations.push('Rewrite titles using direct operational language instead of AI-generated compound nouns');
  }
  
  if (issues.some(i => i.type === 'narrative')) {
    recommendations.push('Diversify sentence structures and remove corporate AI phrasing from narratives');
  }
  
  if (issues.some(i => i.type === 'pills')) {
    recommendations.push('Replace taxonomy-generated pills with short operational labels');
  }
  
  if (issues.some(i => i.type === 'state')) {
    recommendations.push('Introduce diverse change states beyond repetitive "Stable" labels');
  }
  
  if (issues.some(i => i.type === 'confidence')) {
    recommendations.push('Apply statistical sanity checks to confidence/coverage combinations');
  }
  
  if (issues.some(i => i.type === 'density')) {
    recommendations.push('Reduce narrative density and over-explaining to sound more authentic');
  }
  
  return recommendations;
}

/**
 * Generate self-critique summary
 */
function generateSelfCritique(insight: CanonicalInsight, issues: CredibilityIssue[]): string {
  const highSeverityCount = issues.filter(i => i.severity === 'high').length;
  const mediumSeverityCount = issues.filter(i => i.severity === 'medium').length;
  
  let critique = `Self-critique of "${insight.title}": `;
  
  if (highSeverityCount > 0) {
    critique += `Has ${highSeverityCount} high-severity credibility issues that make it sound AI-generated. `;
  } else if (mediumSeverityCount > 2) {
    critique += `Has ${mediumSeverityCount} medium-severity issues that reduce authenticity. `;
  } else if (issues.length > 0) {
    critique += `Has minor credibility issues but generally sounds operational. `;
  } else {
    critique += `Sounds operationally authentic and believable to engineering leaders. `;
  }
  
  // Add specific assessment
  const titleIssues = issues.filter(i => i.type === 'title').length;
  const narrativeIssues = issues.filter(i => i.type === 'narrative').length;
  
  if (titleIssues > 0) {
    critique += `Title sounds ${titleIssues > 1 ? 'very' : ''} AI-generated. `;
  }
  
  if (narrativeIssues > 0) {
    critique += `Narrative structure ${narrativeIssues > 1 ? 'heavily' : ''} uses template patterns. `;
  }
  
  if (issues.some(i => i.type === 'confidence' && i.severity === 'high')) {
    critique += 'Confidence/coverage combination is statistically impossible. ';
  }
  
  critique += issues.length > 0 ? 'Needs credibility improvements.' : 'Ready for VP Engineering audience.';
  
  return critique;
}

/**
 * Apply credibility hardening to insight
 */
export function applyCredibilityHardening(insight: CanonicalInsight): CanonicalInsight {
  const hardened = { ...insight };
  
  // Apply title hardening (would need context to regenerate)
  // This is a placeholder - actual implementation would need model context
  
  // Apply narrative density reduction
  const densityReduced = reduceNarrativeDensity({
    description: hardened.description || '',
    whatChanged: hardened.whatChanged || '',
    whyItMatters: hardened.whyItMatters || '',
    evidenceAndContext: hardened.evidenceAndContext || '',
    operationalImpact: hardened.operationalImpact || '',
    primaryRisk: hardened.primaryRisk || '',
    executiveSummary: hardened.executiveSummary || ''
  });
  
  Object.assign(hardened, densityReduced);
  
  // Apply confidence/coverage sanity
  if (hardened.n) {
    const sanityCheck = performSanityChecks({
      sampleSize: hardened.n,
      modelDistribution: {}, // Would need actual distribution
      coveragePct: hardened.coveragePct || 0,
      baseConfidence: hardened.confidence
    });
    
    hardened.confidence = sanityCheck.adjustedConfidence;
    hardened.coveragePct = sanityCheck.adjustedCoverage;
  }
  
  return hardened;
}
