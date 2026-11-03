/**
 * Single Deterministic Realism Pipeline
 * 
 * Integrates all realism systems in the correct order to ensure
 * VP Engineering believability while maintaining product differentiation.
 * 
 * EXECUTION ORDER:
 * 1. Title hardening
 * 2. Banned phrase cleanup  
 * 3. Terminology normalization
 * 4. Narrative diversity pass
 * 5. Numerical formatting
 * 6. Confidence realism adjustment
 * 7. Change-state realism
 * 8. Overwrite reduction
 * 9. Final validation
 * 
 * PRINCIPLES:
 * - Single pass through all insights
 * - No competing mutations
 * - Deterministic results
 * - Fallback to lower confidence instead of suppression
 */

import type { CanonicalInsight } from '../types';
import { getCanonicalPIById } from '../canonicalInsights';
import { piDebugLog } from '../utils/logging';
import { generateAuthenticTitle, validateTitleAuthenticity } from './titleHardening';
import { validateBannedPhrases } from './bannedPhraseRegistry';
import { replaceFakeTerminology, validateTerminologyAuthenticity } from './terminologyHardening';
import { diversifyNarrative, validateNarrativeDiversity } from './narrativeDiversity';
import { sanitizeNumericString, validateNumericFormatting } from './numericFormatSanity';
import { applyStatisticalRealism } from './statisticalRealism';
import { reduceOverwriting } from './overwritingReduction';
import { validateInsightCredibility } from './credibilityValidation';
import { isStressModeEnabled } from '../../runtimeMode';

// Extended type for insights with pipeline metadata
type ProcessedInsight = CanonicalInsight & {
  [key: string]: any;
};

export interface RealismPipelineOptions {
  enableTitleHardening: boolean;
  enableBannedPhraseCleanup: boolean;
  enableTerminologyNormalization: boolean;
  enableNarrativeDiversity: boolean;
  enableNumericFormatting: boolean;
  enableConfidenceRealism: boolean;
  enableChangeStateRealism: boolean;
  enableOverwriteReduction: boolean;
  enableFinalValidation: boolean;
  strictMode: boolean; // If true, suppress problematic insights. If false, degrade confidence.
}

export interface RealismPipelineResult {
  processedInsights: CanonicalInsight[];
  suppressedInsights: CanonicalInsight[];
  degradedInsights: CanonicalInsight[];
  pipelineSummary: PipelineSummary;
}

export interface PipelineSummary {
  totalProcessed: number;
  insightsSuppressed: number;
  insightsDgraded: number;
  averageCredibilityScore: number;
  topIssues: string[];
  pipelineExecution: PipelineExecution[];
}

export interface PipelineExecution {
  step: string;
  insightsProcessed: number;
  issuesFound: number;
  averageScore: number;
}

/**
 * Single deterministic realism pipeline
 */
export function applyRealismPipeline(
  insights: CanonicalInsight[],
  options: Partial<RealismPipelineOptions> = {}
): RealismPipelineResult {
  piDebugLog('[REALISM_PIPELINE][INPUT]', {
    count: insights.length,
    ids: insights.map(i => i.id),
    planCodeIds: insights.filter(i => i.cicdStage === 'plan-code').map(i => i.id)
  });

  const defaultOptions: RealismPipelineOptions = {
    enableTitleHardening: true,
    enableBannedPhraseCleanup: true,
    enableTerminologyNormalization: true,
    enableNarrativeDiversity: true,
    enableNumericFormatting: true,
    enableConfidenceRealism: true,
    enableChangeStateRealism: true,
    enableOverwriteReduction: true,
    enableFinalValidation: true,
    strictMode: false // Degrade confidence instead of suppressing
  };
  
  const opts = { ...defaultOptions, ...options };
  const pipelineExecution: PipelineExecution[] = [];
  
  piDebugLog('[REALISM_PIPELINE][START]', {
    inputInsights: insights.length,
    options: opts
  });
  
  let processedInsights = [...insights];
  let suppressedInsights: CanonicalInsight[] = [];
  let degradedInsights: CanonicalInsight[] = [];
  
  // STEP 1: Title Hardening
  if (opts.enableTitleHardening) {
    const step1Result = processTitleHardening(processedInsights);
    processedInsights = step1Result.insights;
    pipelineExecution.push(step1Result.execution);
  }
  
  // STEP 2: Banned Phrase Cleanup
  if (opts.enableBannedPhraseCleanup) {
    const step2Result = processBannedPhraseCleanup(processedInsights);
    processedInsights = step2Result.insights;
    pipelineExecution.push(step2Result.execution);
  }
  
  // STEP 3: Terminology Normalization
  if (opts.enableTerminologyNormalization) {
    const step3Result = processTerminologyNormalization(processedInsights);
    processedInsights = step3Result.insights;
    pipelineExecution.push(step3Result.execution);
  }
  
  // STEP 4: Narrative Diversity Pass
  if (opts.enableNarrativeDiversity) {
    const step4Result = processNarrativeDiversity(processedInsights);
    processedInsights = step4Result.insights;
    pipelineExecution.push(step4Result.execution);
  }
  
  // STEP 5: Numerical Formatting
  if (opts.enableNumericFormatting) {
    const step5Result = processNumericFormatting(processedInsights);
    processedInsights = step5Result.insights;
    pipelineExecution.push(step5Result.execution);
  }
  
  // STEP 6: Confidence Realism Adjustment
  if (opts.enableConfidenceRealism) {
    const step6Result = processConfidenceRealism(processedInsights, opts.strictMode);
    processedInsights = step6Result.insights;
    suppressedInsights.push(...step6Result.suppressed);
    degradedInsights.push(...step6Result.degraded);
    pipelineExecution.push(step6Result.execution);
  }
  
  // STEP 7: Change-State Realism
  if (opts.enableChangeStateRealism) {
    const step7Result = processChangeStateRealism(processedInsights);
    processedInsights = step7Result.insights;
    pipelineExecution.push(step7Result.execution);
  }
  
  // STEP 8: Overwrite Reduction
  if (opts.enableOverwriteReduction) {
    const step8Result = processOverwriteReduction(processedInsights);
    processedInsights = step8Result.insights;
    pipelineExecution.push(step8Result.execution);
  }
  
  // STEP 9: Final Validation
  if (opts.enableFinalValidation) {
    const step9Result = processFinalValidation(processedInsights, opts.strictMode);
    processedInsights = step9Result.insights;
    suppressedInsights.push(...step9Result.suppressed);
    degradedInsights.push(...step9Result.degraded);
    pipelineExecution.push(step9Result.execution);
  }
  
  // Calculate summary
  const finalValidation = processedInsights.map(insight => validateInsightCredibility(insight));
  const averageCredibilityScore = finalValidation.length > 0
    ? finalValidation.reduce((sum, val) => sum + (Number.isFinite(val.overallScore) ? val.overallScore : 0), 0) / finalValidation.length
    : 0;
  
  const allIssues = finalValidation.flatMap(val => val.criticalIssues);
  const topIssues = getTopPipelineIssues(allIssues);
  
  const summary: PipelineSummary = {
    totalProcessed: insights.length,
    insightsSuppressed: suppressedInsights.length,
    insightsDgraded: degradedInsights.length,
    averageCredibilityScore,
    topIssues,
    pipelineExecution
  };
  
  piDebugLog('[REALISM_PIPELINE][COMPLETE]', summary);
  
  return {
    processedInsights,
    suppressedInsights,
    degradedInsights,
    pipelineSummary: summary
  };
}

/**
 * Step 1: Title Hardening
 */
function processTitleHardening(insights: CanonicalInsight[]): {
  insights: CanonicalInsight[];
  execution: PipelineExecution;
} {
  let issuesFound = 0;
  const processedInsights = insights.map(insight => {
    const validation = validateTitleAuthenticity(insight.title);
    
    if (!validation.isAuthentic) {
      issuesFound++;
      piDebugLog('[REALISM_PIPELINE][TITLE_HARDENING]', {
        insightId: insight.id,
        issues: validation.issues,
        originalTitle: insight.title
      });
      
      // Generate authentic title
      const hardenedTitle = generateAuthenticTitle();
      
      return {
        ...insight,
        title: hardenedTitle,
        // Add metadata about title hardening
        titleHardeningApplied: true,
        originalTitle: insight.title
      };
    }
    
    return insight;
  });
  
  return {
    insights: processedInsights,
    execution: {
      step: 'Title Hardening',
      insightsProcessed: insights.length,
      issuesFound,
      averageScore: processedInsights.reduce((sum, insight) => {
        const validation = validateTitleAuthenticity(insight.title);
        return sum + validation.credibilityScore;
      }, 0) / insights.length
    }
  };
}

/**
 * Step 2: Banned Phrase Cleanup
 */
function processBannedPhraseCleanup(insights: CanonicalInsight[]): {
  insights: CanonicalInsight[];
  execution: PipelineExecution;
} {
  let issuesFound = 0;
  const processedInsights = insights.map(insight => {
    // Check all text fields for banned phrases
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
    
    let insightIssues = 0;
    const processedInsight: ProcessedInsight = { ...insight };
    
    textFields.forEach(field => {
      if (processedInsight[field] && typeof processedInsight[field] === 'string') {
        const validation = validateBannedPhrases(processedInsight[field]);
        
        if (validation.violations.length > 0) {
          insightIssues++;
          issuesFound++;
          
          piDebugLog('[REALISM_PIPELINE][BANNED_PHRASES]', {
            insightId: insight.id,
            field,
            violations: validation.violations.map(v => v.phrase)
          });
          
          // Rewrite banned phrases
          processedInsight[field] = validation.rewritten;
        }
      }
    });
    
    if (insightIssues > 0) {
      processedInsight.bannedPhraseCleanupApplied = true;
    }
    
    return processedInsight;
  });
  
  return {
    insights: processedInsights,
    execution: {
      step: 'Banned Phrase Cleanup',
      insightsProcessed: insights.length,
      issuesFound,
      averageScore: 100 - (issuesFound / (insights.length * 8) * 100) // 8 text fields per insight
    }
  };
}

/**
 * Step 3: Terminology Normalization
 */
function processTerminologyNormalization(insights: CanonicalInsight[]): {
  insights: CanonicalInsight[];
  execution: PipelineExecution;
} {
  let issuesFound = 0;
  const processedInsights = insights.map(insight => {
    // Check for fake operational terminology
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
    
    let insightIssues = 0;
    const processedInsight: ProcessedInsight = { ...insight };
    
    textFields.forEach(field => {
      if (processedInsight[field] && typeof processedInsight[field] === 'string') {
        const validation = validateTerminologyAuthenticity(processedInsight[field]);
        
        if (!validation.isAuthentic) {
          insightIssues++;
          issuesFound++;
          
          piDebugLog('[REALISM_PIPELINE][TERMINOLOGY]', {
            insightId: insight.id,
            field,
            fakeTerms: validation.fakeTerms.map(t => t.fake)
          });
          
          // Replace fake terminology
          processedInsight[field] = replaceFakeTerminology(processedInsight[field]);
        }
      }
    });
    
    if (insightIssues > 0) {
      processedInsight.terminologyNormalizationApplied = true;
    }
    
    return processedInsight;
  });
  
  return {
    insights: processedInsights,
    execution: {
      step: 'Terminology Normalization',
      insightsProcessed: insights.length,
      issuesFound,
      averageScore: 100 - (issuesFound / (insights.length * 9) * 100) // 9 text fields per insight
    }
  };
}

/**
 * Step 4: Narrative Diversity Pass
 */
function processNarrativeDiversity(insights: CanonicalInsight[]): {
  insights: CanonicalInsight[];
  execution: PipelineExecution;
} {
  let issuesFound = 0;
  const processedInsights = insights.map(insight => {
    // Focus on whyItMatters field for narrative diversity
    if (insight.whyItMatters && typeof insight.whyItMatters === 'string') {
      const validation = validateNarrativeDiversity(insight.whyItMatters);
      
      if (!validation.isDiverse) {
        issuesFound++;
        
        piDebugLog('[REALISM_PIPELINE][NARRATIVE_DIVERSITY]', {
          insightId: insight.id,
          issues: validation.issues
        });
        
        // CR-X QUALITY FIX: Do NOT replace the generator's whyItMatters with
        // generic narrative diversity replacements. The generator's
        // whyItMatters is the authoritative interpretation — replacing it with
        // "Teams benefited from experienced." destroys interpretation quality.
        // The narrative diversity pass should flag issues for review, not
        // overwrite meaningful content with generic nonsense.
        // Only apply diversification in stress/demo mode where narratives
        // may be highly repetitive.
        if (isStressModeEnabled()) {
          const diversifiedNarrative = diversifyNarrative(insight.whyItMatters);
          return {
            ...insight,
            whyItMatters: diversifiedNarrative,
            narrativeDiversityApplied: true,
            originalWhyItMatters: insight.whyItMatters
          };
        }
        // In live mode: preserve the generator's whyItMatters as-is
        return {
          ...insight,
          narrativeDiversityApplied: false,
          narrativeDiversityIssues: validation.issues
        };
      }
    }
    
    return insight;
  });
  
  return {
    insights: processedInsights,
    execution: {
      step: 'Narrative Diversity',
      insightsProcessed: insights.length,
      issuesFound,
      averageScore: processedInsights.reduce((sum, insight) => {
        if (insight.whyItMatters) {
          const validation = validateNarrativeDiversity(insight.whyItMatters);
          return sum + validation.credibilityScore;
        }
        return sum + 100;
      }, 0) / insights.length
    }
  };
}

/**
 * Step 5: Numerical Formatting
 */
function processNumericFormatting(insights: CanonicalInsight[]): {
  insights: CanonicalInsight[];
  execution: PipelineExecution;
} {
  let issuesFound = 0;
  const processedInsights = insights.map(insight => {
    // Check all text fields for numeric formatting issues
    const textFields = [
      'description',
      'whatChanged',
      'evidenceAndContext',
      'operationalImpact',
      'executiveSummary'
    ];
    
    let insightIssues = 0;
    const processedInsight = { ...insight };
    
    textFields.forEach(field => {
      if (processedInsight[field] && typeof processedInsight[field] === 'string') {
        const validation = validateNumericFormatting(processedInsight[field]);
        
        if (!validation.isCredible) {
          insightIssues++;
          issuesFound++;
          
          piDebugLog('[REALISM_PIPELINE][NUMERIC_FORMATTING]', {
            insightId: insight.id,
            field,
            issues: validation.issues
          });
          
          // Sanitize numeric formatting
          processedInsight[field] = sanitizeNumericString(processedInsight[field]);
        }
      }
    });
    
    if (insightIssues > 0) {
      processedInsight.numericFormattingApplied = true;
    }
    
    return processedInsight;
  });
  
  return {
    insights: processedInsights,
    execution: {
      step: 'Numeric Formatting',
      insightsProcessed: insights.length,
      issuesFound,
      averageScore: 100 - (issuesFound / (insights.length * 5) * 100) // 5 text fields per insight
    }
  };
}

/**
 * Step 6: Confidence Realism Adjustment
 */
function processConfidenceRealism(insights: CanonicalInsight[], strictMode: boolean): {
  insights: CanonicalInsight[];
  suppressed: CanonicalInsight[];
  degraded: CanonicalInsight[];
  execution: PipelineExecution;
} {
  let issuesFound = 0;
  const suppressed: CanonicalInsight[] = [];
  const degraded: CanonicalInsight[] = [];
  
  const processedInsights = insights.map(insight => {
    // Get registry entry to check minimumConfidence requirement
    const registryEntry = getCanonicalPIById(insight.id);
    const minimumConfidence = registryEntry?.minimumConfidence || 'low';
    
    // CR-X Product-Strength Wave: Executive synthesis and multi-dimensional
    // families use their own evidence structures (not breakdownByTool).
    // The statistical realism checks expect modelDistribution from
    // breakdownByTool, which these families don't have. Skip the confidence
    // downgrade for these families — their generators already set honest
    // confidence based on actual sample sizes.
    const exemptPresentationKinds = new Set([
      'executive_synthesis',
      'repo_conditioned_behavior',
      'workflow_repo_allocation',
      'within_workflow_temporal',
      'workflow_repo_allocation_shift',
    ]);
    if (exemptPresentationKinds.has((insight as any).presentationKind)) {
      return insight;
    }
    
    // Apply statistical realism to confidence and coverage
    const statisticalInput = {
      totalSessions: insight.n || 0,
      modelDistribution: {}, // Would need actual distribution from breakdownByTool
      baseConfidence: insight.confidence || 'low',
      baseCoverage: insight.coveragePct || 0,
      dataCompleteness: 100 // Assume complete data
    };
    
    const statisticalResult = applyStatisticalRealism(statisticalInput);
    
    if (statisticalResult.realismFlags.length > 0) {
      issuesFound++;
      
      piDebugLog('[REALISM_PIPELINE][CONFIDENCE_REALISM]', {
        insightId: insight.id,
        originalConfidence: insight.confidence,
        originalCoverage: insight.coveragePct,
        flags: statisticalResult.realismFlags,
        adjustedConfidence: statisticalResult.adjustedConfidence,
        adjustedCoverage: statisticalResult.adjustedCoverage,
        minimumConfidence: minimumConfidence
      });
      
      // ADAPTIVE GATING: Check if confidence meets minimum requirement from registry
      const confidenceOrder = { 'low': 0, 'medium': 1, 'high': 2 };
      const adjustedLevel = confidenceOrder[statisticalResult.adjustedConfidence as keyof typeof confidenceOrder] || 0;
      const minimumLevel = confidenceOrder[minimumConfidence as keyof typeof confidenceOrder] || 0;
      
      // If adjusted confidence is below minimum, degrade to low (honest rendering)
      if (adjustedLevel < minimumLevel) {
        piDebugLog('[REALISM_PIPELINE][ADAPTIVE_GATE]', {
          insightId: insight.id,
          adjustedConfidence: statisticalResult.adjustedConfidence,
          minimumConfidence: minimumConfidence,
          action: 'Degrading to low confidence for honest rendering'
        });
        
        degraded.push({
          ...insight,
          confidence: 'low',
          coveragePct: statisticalResult.adjustedCoverage,
          confidenceRealismApplied: true,
          originalConfidence: insight.confidence,
          originalCoverage: insight.coveragePct,
          adaptiveGateTriggered: true,
          gateReason: `Below minimum confidence (${minimumConfidence})`
        });
        
        return {
          ...insight,
          confidence: 'low',
          coveragePct: statisticalResult.adjustedCoverage,
          confidenceRealismApplied: true,
          originalConfidence: insight.confidence,
          originalCoverage: insight.coveragePct,
          adaptiveGateTriggered: true,
          gateReason: `Below minimum confidence (${minimumConfidence})`
        };
      }
      
      // Check if confidence is too low for strict mode
      if (strictMode && statisticalResult.adjustedConfidence === 'low' && statisticalResult.credibilityScore < 50) {
        suppressed.push(insight);
        return null;
      }
      
      // Check if confidence was degraded (but still meets minimum)
      const confidenceDegraded = statisticalResult.adjustedConfidence !== insight.confidence;
      if (confidenceDegraded) {
        degraded.push({
          ...insight,
          confidence: statisticalResult.adjustedConfidence,
          coveragePct: statisticalResult.adjustedCoverage,
          confidenceRealismApplied: true,
          originalConfidence: insight.confidence,
          originalCoverage: insight.coveragePct
        });
      }
      
      return {
        ...insight,
        confidence: statisticalResult.adjustedConfidence,
        coveragePct: statisticalResult.adjustedCoverage,
        confidenceRealismApplied: true,
        originalConfidence: insight.confidence,
        originalCoverage: insight.coveragePct
      };
    }
    
    return insight;
  }).filter(Boolean) as CanonicalInsight[];
  
  return {
    insights: processedInsights,
    suppressed,
    degraded,
    execution: {
      step: 'Confidence Realism',
      insightsProcessed: insights.length,
      issuesFound,
      averageScore: processedInsights.reduce((sum, insight) => {
        const statisticalInput = {
          totalSessions: insight.n || 0,
          modelDistribution: {},
          baseConfidence: insight.confidence || 'low',
          baseCoverage: insight.coveragePct || 0
        };
        const result = applyStatisticalRealism(statisticalInput);
        return sum + result.credibilityScore;
      }, 0) / processedInsights.length
    }
  };
}

/**
 * Step 7: Change-State Realism
 */
function processChangeStateRealism(insights: CanonicalInsight[]): {
  insights: CanonicalInsight[];
  execution: PipelineExecution;
} {
  // For change state realism, we need to look at multiple insights together
  // For now, we'll validate individual insights but the rotation logic would need to be applied at the batch level
  
  let issuesFound = 0;
  const processedInsights = insights.map(insight => {
    // This is a simplified version - full change state realism would need to be applied at the batch level
    return insight;
  });
  
  return {
    insights: processedInsights,
    execution: {
      step: 'Change-State Realism',
      insightsProcessed: insights.length,
      issuesFound,
      averageScore: 85 // Placeholder
    }
  };
}

/**
 * Step 8: Overwrite Reduction
 */
function processOverwriteReduction(insights: CanonicalInsight[]): {
  insights: CanonicalInsight[];
  execution: PipelineExecution;
} {
  let issuesFound = 0;
  const processedInsights = insights.map(insight => {
    // Apply overwrite reduction to narrative fields
    const narrativeFields = [
      'description',
      'whatChanged',
      'whyItMatters',
      'evidenceAndContext',
      'operationalImpact',
      'executiveSummary'
    ];
    
    let insightIssues = 0;
    const processedInsight = { ...insight };
    
    narrativeFields.forEach(field => {
      if (processedInsight[field] && typeof processedInsight[field] === 'string') {
        const original = processedInsight[field];
        const reduced = reduceOverwriting(original, {
          maxAdjectivesPerSentence: 1,
          maxAbstractNounsPerSentence: 1,
          maxSentenceLength: 80,
          removeInterpretiveWords: true,
          shortenSentences: true
        });
        
        if (reduced.metrics.densityScore > 0.05) { // If there was overwriting
          insightIssues++;
          issuesFound++;
          
          piDebugLog('[REALISM_PIPELINE][OVERWRITE_REDUCTION]', {
            insightId: insight.id,
            field,
            originalDensity: reduced.metrics.densityScore,
            changes: reduced.changes.length
          });
          
          processedInsight[field] = reduced.reduced;
        }
      }
    });
    
    if (insightIssues > 0) {
      processedInsight.overwriteReductionApplied = true;
    }
    
    return processedInsight;
  });
  
  return {
    insights: processedInsights,
    execution: {
      step: 'Overwrite Reduction',
      insightsProcessed: insights.length,
      issuesFound,
      averageScore: processedInsights.reduce((sum, insight) => {
        // Simple scoring based on whether overwrite reduction was applied
        return sum + (insight.overwriteReductionApplied ? 85 : 95);
      }, 0) / processedInsights.length
    }
  };
}

/**
 * Step 9: Final Validation
 */
function processFinalValidation(insights: CanonicalInsight[], strictMode: boolean): {
  insights: CanonicalInsight[];
  suppressed: CanonicalInsight[];
  degraded: CanonicalInsight[];
  execution: PipelineExecution;
} {
  let issuesFound = 0;
  const suppressed: CanonicalInsight[] = [];
  const degraded: CanonicalInsight[] = [];
  
  const processedInsights = insights.map(insight => {
    const validation = validateInsightCredibility(insight);
    
    if (!validation.isBelievable) {
      issuesFound++;
      
      piDebugLog('[REALISM_PIPELINE][FINAL_VALIDATION]', {
        insightId: insight.id,
        score: validation.overallScore,
        assessment: validation.vpEngAssessment,
        criticalIssues: validation.criticalIssues.length
      });
      
      // Check if insight should be suppressed in strict mode
      if (strictMode && validation.vpEngAssessment === 'unbelievable') {
        suppressed.push(insight);
        return null;
      }
      
      // Mark as degraded if not believable
      if (validation.vpEngAssessment !== 'believable') {
        degraded.push({
          ...insight,
          finalValidationFailed: true,
          credibilityScore: validation.overallScore,
          vpEngAssessment: validation.vpEngAssessment
        });
      }
      
      return {
        ...insight,
        finalValidationApplied: true,
        credibilityScore: validation.overallScore,
        vpEngAssessment: validation.vpEngAssessment
      };
    }
    
    return insight;
  }).filter(Boolean) as CanonicalInsight[];
  
  return {
    insights: processedInsights,
    suppressed,
    degraded,
    execution: {
      step: 'Final Validation',
      insightsProcessed: insights.length,
      issuesFound,
      averageScore: processedInsights.length > 0
        ? processedInsights.reduce((sum, insight) => {
            const score = insight.credibilityScore;
            return sum + (Number.isFinite(score) ? score : 100);
          }, 0) / processedInsights.length
        : 100
    }
  };
}

/**
 * Get top pipeline issues
 */
function getTopPipelineIssues(issues: any[]): string[] {
  const issueCounts = issues.reduce((counts, issue) => {
    const key = `${issue.dimension}: ${issue.description}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  
  return Object.entries(issueCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([issue]) => issue);
}
