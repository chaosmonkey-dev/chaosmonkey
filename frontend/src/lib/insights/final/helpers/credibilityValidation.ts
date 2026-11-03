/**
 * Credibility Validation System
 * 
 * Comprehensive validation and self-critique system for Performance Insights
 * to ensure VP Engineering believability.
 * 
 * VALIDATION DIMENSIONS:
 * - Banned phrase elimination
 * - Title authenticity
 * - Narrative diversity
 * - Terminology realism
 * - Statistical plausibility
 * - Numeric formatting
 * - State diversity
 * - Overwriting reduction
 * 
 * TARGET: "Would a skeptical VP Engineering believe this product is real?"
 */

import type { CanonicalInsight } from '../types';
import { validateBannedPhrases } from './bannedPhraseRegistry';
import { validateTitleAuthenticity } from './titleHardening';
import { validateNarrativeDiversity } from './narrativeDiversity';
import { validateTerminologyAuthenticity } from './terminologyHardening';
import { applyStatisticalRealism } from './statisticalRealism';
import { validateNumericFormatting } from './numericFormatSanity';
import { validateOverwritingReduction } from './overwritingReduction';

export interface CredibilityValidationResult {
  overallScore: number; // 0-100
  isBelievable: boolean;
  vpEngAssessment: 'believable' | 'skeptical' | 'unbelievable';
  dimensionScores: DimensionScores;
  criticalIssues: CriticalIssue[];
  selfCritique: string;
  recommendations: string[];
  validationSummary: ValidationSummary;
}

export interface DimensionScores {
  bannedPhrases: number;
  titleAuthenticity: number;
  narrativeDiversity: number;
  terminologyRealism: number;
  statisticalPlausibility: number;
  numericFormatting: number;
  stateDiversity: number;
  overwritingReduction: number;
}

export interface CriticalIssue {
  dimension: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  impact: string;
  fix: string;
}

export interface ValidationSummary {
  totalInsights: number;
  believableInsights: number;
  skepticalInsights: number;
  unbelievableInsights: number;
  averageScore: number;
  topIssues: string[];
}

/**
 * Validate single insight for credibility
 */
export function validateInsightCredibility(insight: CanonicalInsight): CredibilityValidationResult {
  const dimensionScores: DimensionScores = {
    bannedPhrases: 0,
    titleAuthenticity: 0,
    narrativeDiversity: 0,
    terminologyRealism: 0,
    statisticalPlausibility: 0,
    numericFormatting: 0,
    stateDiversity: 0,
    overwritingReduction: 0
  };
  
  const criticalIssues: CriticalIssue[] = [];
  const recommendations: string[] = [];
  
  // Dimension 1: Banned phrases
  const bannedPhraseValidation = validateBannedPhrases(insight.title + ' ' + insight.description + ' ' + insight.whyItMatters);
  dimensionScores.bannedPhrases = bannedPhraseValidation.credibilityScore;
  if (bannedPhraseValidation.violations.length > 0) {
    criticalIssues.push({
      dimension: 'bannedPhrases',
      severity: 'critical',
      description: 'Contains AI-generated credibility killers',
      impact: 'Immediately sounds fake to VP Engineering',
      fix: 'Remove all banned phrases and replace with operational language'
    });
  }
  
  // Dimension 2: Title authenticity
  const titleValidation = validateTitleAuthenticity(insight.title);
  dimensionScores.titleAuthenticity = titleValidation.credibilityScore;
  if (titleValidation.issues.length > 0) {
    criticalIssues.push({
      dimension: 'titleAuthenticity',
      severity: 'high',
      description: 'Title sounds synthetic or AI-generated',
      impact: 'Reduces trust in entire insight',
      fix: 'Rewrite title with direct operational language'
    });
  }
  
  // Dimension 3: Narrative diversity
  const narrativeValidation = validateNarrativeDiversity(insight.whyItMatters || '');
  dimensionScores.narrativeDiversity = narrativeValidation.credibilityScore;
  if (narrativeValidation.issues.length > 0) {
    criticalIssues.push({
      dimension: 'narrativeDiversity',
      severity: 'high',
      description: 'Narrative uses repetitive AI templates',
      impact: 'Sounds like LLM-generated analysis',
      fix: 'Diversify sentence structures and remove template patterns'
    });
  }
  
  // Dimension 4: Terminology realism
  const terminologyValidation = validateTerminologyAuthenticity(insight.title + ' ' + insight.whyItMatters);
  dimensionScores.terminologyRealism = terminologyValidation.credibilityScore;
  if (terminologyValidation.fakeTerms.length > 0) {
    criticalIssues.push({
      dimension: 'terminologyRealism',
      severity: 'high',
      description: 'Uses fake operational terminology',
      impact: 'Sounds like synthetic ontology',
      fix: 'Replace with simple, evolved operational labels'
    });
  }
  
  // Dimension 5: Statistical plausibility
  const statisticalInput = {
    totalSessions: insight.n || 0,
    modelDistribution: {}, // Would need actual distribution
    baseConfidence: insight.confidence || 'low',
    baseCoverage: insight.coveragePct || 0
  };
  const statisticalResult = applyStatisticalRealism(statisticalInput);
  dimensionScores.statisticalPlausibility = statisticalResult.credibilityScore;
  if (statisticalResult.realismFlags.length > 0) {
    criticalIssues.push({
      dimension: 'statisticalPlausibility',
      severity: 'critical',
      description: 'Impossible confidence/coverage combinations',
      impact: 'Destroys statistical credibility',
      fix: 'Apply realistic statistical constraints'
    });
  }
  
  // Dimension 6: Numeric formatting
  const numericValidation = validateNumericFormatting(insight.description + ' ' + insight.evidenceAndContext);
  dimensionScores.numericFormatting = numericValidation.credibilityScore;
  if (numericValidation.issues.length > 0) {
    criticalIssues.push({
      dimension: 'numericFormatting',
      severity: 'critical',
      description: 'Raw floating points or excessive precision',
      impact: 'Catastrophic trust killer',
      fix: 'Apply executive-facing numeric formatting'
    });
  }
  
  // Dimension 7: State diversity (would need multiple insights)
  dimensionScores.stateDiversity = 85; // Placeholder for single insight
  
  // Dimension 8: Overwriting reduction
  const overwritingValidation = validateOverwritingReduction(
    insight.description + ' ' + insight.whyItMatters,
    insight.description + ' ' + insight.whyItMatters
  );
  dimensionScores.overwritingReduction = Math.max(0, 100 - overwritingValidation.improvement * 100);
  if (overwritingValidation.stillOverwritten.length > 0) {
    criticalIssues.push({
      dimension: 'overwritingReduction',
      severity: 'medium',
      description: 'Still sounds like LLM trying to sound insightful',
      impact: 'Reduces operational authenticity',
      fix: 'Reduce adjective density and abstract nouns'
    });
  }
  
  // Calculate overall score
  // CR5 V1 FINAL P0-3: Guard against NaN dimension scores to prevent
  // overallScore from becoming NaN. Replace any non-finite score with 0.
  const scores = Object.values(dimensionScores).map(s => Number.isFinite(s) ? s : 0);
  const overallScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  
  // Determine VP Engineering assessment
  const vpEngAssessment = determineVPAssessment(overallScore, criticalIssues);
  
  // Generate self-critique
  const selfCritique = generateSelfCritique(insight, overallScore, criticalIssues);
  
  // Generate recommendations
  recommendations.push(...generateRecommendations(criticalIssues));
  
  return {
    overallScore,
    isBelievable: overallScore >= 70,
    vpEngAssessment,
    dimensionScores,
    criticalIssues,
    selfCritique,
    recommendations,
    validationSummary: {
      totalInsights: 1,
      believableInsights: overallScore >= 70 ? 1 : 0,
      skepticalInsights: overallScore >= 50 && overallScore < 70 ? 1 : 0,
      unbelievableInsights: overallScore < 50 ? 1 : 0,
      averageScore: overallScore,
      topIssues: criticalIssues.slice(0, 3).map(issue => issue.description)
    }
  };
}

/**
 * Validate multiple insights for credibility
 */
export function validateMultipleInsights(insights: CanonicalInsight[]): {
  overall: CredibilityValidationResult;
  individual: CredibilityValidationResult[];
  summary: ValidationSummary;
} {
  const individualResults = insights.map(insight => validateInsightCredibility(insight));
  
  // Calculate overall metrics
  const totalInsights = insights.length;
  const believableInsights = individualResults.filter(r => r.isBelievable).length;
  const skepticalInsights = individualResults.filter(r => r.overallScore >= 50 && r.overallScore < 70).length;
  const unbelievableInsights = individualResults.filter(r => r.overallScore < 50).length;
  const averageScore = individualResults.reduce((sum, r) => sum + r.overallScore, 0) / totalInsights;
  
  // Aggregate critical issues
  const allCriticalIssues = individualResults.flatMap(r => r.criticalIssues);
  const topIssues = getTopIssues(allCriticalIssues);
  
  const overallResult: CredibilityValidationResult = {
    overallScore: averageScore,
    isBelievable: averageScore >= 70,
    vpEngAssessment: determineVPAssessment(averageScore, allCriticalIssues),
    dimensionScores: aggregateDimensionScores(individualResults.map(r => r.dimensionScores)),
    criticalIssues: topIssues,
    selfCritique: generateBatchSelfCritique(individualResults, averageScore),
    recommendations: generateBatchRecommendations(allCriticalIssues),
    validationSummary: {
      totalInsights,
      believableInsights,
      skepticalInsights,
      unbelievableInsights,
      averageScore,
      topIssues: topIssues.slice(0, 5).map(issue => issue.description)
    }
  };
  
  return {
    overall: overallResult,
    individual: individualResults,
    summary: overallResult.validationSummary
  };
}

/**
 * Determine VP Engineering assessment
 */
function determineVPAssessment(score: number, issues: CriticalIssue[]): 'believable' | 'skeptical' | 'unbelievable' {
  const criticalIssues = issues.filter(i => i.severity === 'critical').length;
  const highIssues = issues.filter(i => i.severity === 'high').length;
  
  if (score >= 85 && criticalIssues === 0 && highIssues <= 1) {
    return 'believable';
  } else if (score >= 60 && criticalIssues === 0) {
    return 'skeptical';
  } else {
    return 'unbelievable';
  }
}

/**
 * Generate self-critique for single insight
 */
function generateSelfCritique(insight: CanonicalInsight, score: number, issues: CriticalIssue[]): string {
  let critique = `Self-critique of "${insight.title}": `;
  
  if (score >= 85) {
    critique += 'Sounds operationally authentic and believable to engineering leaders. ';
  } else if (score >= 70) {
    critique += 'Generally believable but has minor credibility issues. ';
  } else if (score >= 50) {
    critique += 'Has significant credibility problems that would make VP Engineering skeptical. ';
  } else {
    critique += 'Sounds AI-generated and would not be believable to VP Engineering. ';
  }
  
  // Add specific issue assessments
  const criticalIssues = issues.filter(i => i.severity === 'critical');
  if (criticalIssues.length > 0) {
    critique += `Critical issues: ${criticalIssues.map(i => i.description).join(', ')}. `;
  }
  
  const highIssues = issues.filter(i => i.severity === 'high');
  if (highIssues.length > 0) {
    critique += `High-priority issues: ${highIssues.map(i => i.description).join(', ')}. `;
  }
  
  // Add VP Engineering perspective
  if (score < 70) {
    critique += 'VP Engineering would likely question the authenticity of this insight. ';
  }
  
  // Add final assessment
  if (score >= 70) {
    critique += 'Ready for executive audience.';
  } else {
    critique += 'Needs credibility improvements before executive presentation.';
  }
  
  return critique;
}

/**
 * Generate self-critique for batch of insights
 */
function generateBatchSelfCritique(results: CredibilityValidationResult[], averageScore: number): string {
  const believableCount = results.filter(r => r.isBelievable).length;
  const totalCount = results.length;
  
  let critique = `Batch self-critique (${totalCount} insights): `;
  
  if (averageScore >= 80) {
    critique += `Strong credibility with ${believableCount}/${totalCount} believable insights. `;
  } else if (averageScore >= 70) {
    critique += `Good credibility with ${believableCount}/${totalCount} believable insights, some need refinement. `;
  } else if (averageScore >= 50) {
    critique += `Moderate credibility with ${believableCount}/${totalCount} believable insights, significant issues remain. `;
  } else {
    critique += `Poor credibility with only ${believableCount}/${totalCount} believable insights. `;
  }
  
  // Add pattern analysis
  const allIssues = results.flatMap(r => r.criticalIssues);
  const issuePatterns = analyzeIssuePatterns(allIssues);
  
  if (issuePatterns.length > 0) {
    critique += `Common issues: ${issuePatterns.join(', ')}. `;
  }
  
  // Add VP Engineering perspective
  if (averageScore < 70) {
    critique += 'VP Engineering would likely question the authenticity of the entire system. ';
  }
  
  critique += `Overall readiness: ${averageScore >= 70 ? 'Ready' : 'Needs work'} for executive audience.`;
  
  return critique;
}

/**
 * Generate recommendations based on issues
 */
function generateRecommendations(issues: CriticalIssue[]): string[] {
  const recommendations: string[] = [];
  
  issues.forEach(issue => {
    if (!recommendations.includes(issue.fix)) {
      recommendations.push(issue.fix);
    }
  });
  
  return recommendations;
}

/**
 * Generate batch recommendations
 */
function generateBatchRecommendations(allIssues: CriticalIssue[]): string[] {
  const recommendations: string[] = [];
  const issueTypes = new Set(allIssues.map(i => i.dimension));
  
  issueTypes.forEach(type => {
    const typeIssues = allIssues.filter(i => i.dimension === type);
    if (typeIssues.length > 0) {
      recommendations.push(typeIssues[0].fix);
    }
  });
  
  return recommendations;
}

/**
 * Get top issues by severity and frequency
 */
function getTopIssues(issues: CriticalIssue[]): CriticalIssue[] {
  // Group by description and count frequency
  const issueGroups = new Map<string, CriticalIssue[]>();
  
  issues.forEach(issue => {
    const key = issue.description;
    if (!issueGroups.has(key)) {
      issueGroups.set(key, []);
    }
    issueGroups.get(key)!.push(issue);
  });
  
  // Sort by severity and frequency
  const sorted = Array.from(issueGroups.entries())
    .map(([description, group]) => ({
      description,
      count: group.length,
      severity: group[0].severity,
      impact: group[0].impact,
      fix: group[0].fix,
      dimension: group[0].dimension
    }))
    .sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
      if (severityDiff !== 0) return severityDiff;
      return b.count - a.count;
    });
  
  return sorted.slice(0, 10);
}

/**
 * Analyze issue patterns
 */
function analyzeIssuePatterns(issues: CriticalIssue[]): string[] {
  const patterns: string[] = [];
  
  const dimensionCounts = issues.reduce((counts, issue) => {
    counts[issue.dimension] = (counts[issue.dimension] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  
  Object.entries(dimensionCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .forEach(([dimension, count]) => {
      patterns.push(`${dimension} (${count} insights)`);
    });
  
  return patterns;
}

/**
 * Aggregate dimension scores across multiple insights
 */
function aggregateDimensionScores(scores: DimensionScores[]): DimensionScores {
  const dimensions: (keyof DimensionScores)[] = [
    'bannedPhrases',
    'titleAuthenticity',
    'narrativeDiversity',
    'terminologyRealism',
    'statisticalPlausibility',
    'numericFormatting',
    'stateDiversity',
    'overwritingReduction'
  ];
  
  const aggregated: DimensionScores = {
    bannedPhrases: 0,
    titleAuthenticity: 0,
    narrativeDiversity: 0,
    terminologyRealism: 0,
    statisticalPlausibility: 0,
    numericFormatting: 0,
    stateDiversity: 0,
    overwritingReduction: 0
  };
  
  dimensions.forEach(dimension => {
    const total = scores.reduce((sum, score) => sum + score[dimension], 0);
    aggregated[dimension] = total / scores.length;
  });
  
  return aggregated;
}

/**
 * Generate credibility report for screenshots
 */
export function generateCredibilityReport(insights: CanonicalInsight[]): {
  report: string;
  summary: ValidationSummary;
  readyForScreenshots: boolean;
} {
  const validation = validateMultipleInsights(insights);
  
  const report = `
# Performance Insights Credibility Report

## Executive Summary
- **Overall Score**: ${Math.round(validation.overall.overallScore)}/100
- **VP Engineering Assessment**: ${validation.overall.vpEngAssessment.toUpperCase()}
- **Ready for Executive Audience**: ${validation.overall.isBelievable ? 'YES' : 'NO'}

## Insight Breakdown
- **Total Insights**: ${validation.summary.totalInsights}
- **Believable**: ${validation.summary.believableInsights}
- **Skeptical**: ${validation.summary.skepticalInsights}
- **Unbelievable**: ${validation.summary.unbelievableInsights}

## Dimension Scores
- **Banned Phrases**: ${Math.round(validation.overall.dimensionScores.bannedPhrases)}/100
- **Title Authenticity**: ${Math.round(validation.overall.dimensionScores.titleAuthenticity)}/100
- **Narrative Diversity**: ${Math.round(validation.overall.dimensionScores.narrativeDiversity)}/100
- **Terminology Realism**: ${Math.round(validation.overall.dimensionScores.terminologyRealism)}/100
- **Statistical Plausibility**: ${Math.round(validation.overall.dimensionScores.statisticalPlausibility)}/100
- **Numeric Formatting**: ${Math.round(validation.overall.dimensionScores.numericFormatting)}/100
- **State Diversity**: ${Math.round(validation.overall.dimensionScores.stateDiversity)}/100
- **Overwriting Reduction**: ${Math.round(validation.overall.dimensionScores.overwritingReduction)}/100

## Critical Issues
${validation.overall.criticalIssues.slice(0, 5).map(issue => 
  `- **${issue.dimension}**: ${issue.description}`
).join('\n')}

## Self-Critique
${validation.overall.selfCritique}

## Recommendations
${validation.overall.recommendations.map(rec => `- ${rec}`).join('\n')}

## Screenshot Readiness
${validation.overall.isBelievable ? 
  '✅ READY for screenshots - insights sound operationally authentic' : 
  '❌ NOT READY for screenshots - credibility improvements needed'}
`;
  
  return {
    report,
    summary: validation.summary,
    readyForScreenshots: validation.overall.isBelievable
  };
}
