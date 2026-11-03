/**
 * Confidence/Coverage Sanity System
 * 
 * Adds statistical realism heuristics to prevent impossible-looking
 * confidence/coverage combinations that make the system feel fake.
 * 
 * CREDIBILITY PRINCIPLES:
 * - Low sample sizes should reduce confidence
 * - Sparse model distribution should reduce coverage
 * - Confidence should account for model representation balance
 * - Avoid impossible-looking combinations
 */

import type { ConfidenceLevel } from '../types';

export interface SanityCheckInput {
  sampleSize: number;
  modelDistribution: Record<string, number>;
  coveragePct: number;
  baseConfidence: ConfidenceLevel;
  dataCompleteness?: number;
  timeWindowDays?: number;
}

export interface SanityAdjustedOutput {
  adjustedConfidence: ConfidenceLevel;
  adjustedCoverage: number;
  sanityFlags: string[];
  reasoning: string[];
}

/**
 * Sanity check thresholds based on statistical principles
 */
const SANITY_THRESHOLDS = {
  // Sample size thresholds for different confidence levels
  minSampleForHigh: 100,
  minSampleForMedium: 30,
  minSampleForLow: 10,
  
  // Coverage thresholds
  maxCoverageForTinySample: 60, // Max coverage for <10 samples
  maxCoverageForSmallSample: 80, // Max coverage for <30 samples
  maxCoverageForMediumSample: 95, // Max coverage for <100 samples
  
  // Model distribution balance
  minModelsForHighCoverage: 3,
  minModelsPerModelForBalance: 5,
  maxDominanceRatio: 0.7 // No model should be >70% of samples
};

/**
 * Perform sanity checks on confidence/coverage combinations
 */
export function performSanityChecks(input: SanityCheckInput): SanityAdjustedOutput {
  const {
    sampleSize,
    modelDistribution,
    coveragePct,
    baseConfidence,
    dataCompleteness = 100,
    timeWindowDays = 30
  } = input;
  
  const sanityFlags: string[] = [];
  const reasoning: string[] = [];
  let adjustedConfidence = baseConfidence;
  let adjustedCoverage = coveragePct;
  
  // Check 1: Sample size vs confidence
  const sampleSizeCheck = checkSampleSizeVsConfidence(sampleSize, baseConfidence);
  if (sampleSizeCheck.needsAdjustment) {
    adjustedConfidence = sampleSizeCheck.adjustedConfidence;
    sanityFlags.push('sample_size_confidence_mismatch');
    reasoning.push(sampleSizeCheck.reasoning);
  }
  
  // Check 2: Sample size vs coverage
  const coverageCheck = checkSampleSizeVsCoverage(sampleSize, coveragePct);
  if (coverageCheck.needsAdjustment) {
    adjustedCoverage = coverageCheck.adjustedCoverage;
    sanityFlags.push('sample_size_coverage_mismatch');
    reasoning.push(coverageCheck.reasoning);
  }
  
  // Check 3: Model distribution balance
  const distributionCheck = checkModelDistributionBalance(modelDistribution, sampleSize);
  if (distributionCheck.needsAdjustment) {
    adjustedCoverage = Math.min(adjustedCoverage, distributionCheck.adjustedCoverage);
    sanityFlags.push('model_distribution_imbalance');
    reasoning.push(distributionCheck.reasoning);
  }
  
  // Check 4: Data completeness impact
  if (dataCompleteness < 90) {
    adjustedConfidence = reduceConfidenceLevel(adjustedConfidence);
    sanityFlags.push('low_data_completeness');
    reasoning.push(`Data completeness ${dataCompleteness}% reduces confidence`);
  }
  
  // Check 5: Time window adequacy
  if (timeWindowDays < 14 && sampleSize < 50) {
    adjustedConfidence = reduceConfidenceLevel(adjustedConfidence);
    sanityFlags.push('insufficient_time_window');
    reasoning.push(`Time window ${timeWindowDays} days with ${sampleSize} samples insufficient for high confidence`);
  }
  
  // Check 6: Impossible combinations
  const impossibleCheck = checkImpossibleCombinations(sampleSize, adjustedCoverage, adjustedConfidence);
  if (impossibleCheck.needsAdjustment) {
    adjustedConfidence = impossibleCheck.adjustedConfidence;
    adjustedCoverage = impossibleCheck.adjustedCoverage;
    sanityFlags.push('impossible_combination');
    reasoning.push(impossibleCheck.reasoning);
  }
  
  return {
    adjustedConfidence,
    adjustedCoverage,
    sanityFlags,
    reasoning
  };
}

/**
 * Check if sample size supports confidence level
 */
function checkSampleSizeVsConfidence(sampleSize: number, confidence: ConfidenceLevel): {
  needsAdjustment: boolean;
  adjustedConfidence: ConfidenceLevel;
  reasoning: string;
} {
  if (confidence === 'high' && sampleSize < SANITY_THRESHOLDS.minSampleForHigh) {
    return {
      needsAdjustment: true,
      adjustedConfidence: sampleSize < SANITY_THRESHOLDS.minSampleForMedium ? 'low' : 'medium',
      reasoning: `Sample size ${sampleSize} too small for high confidence (need ${SANITY_THRESHOLDS.minSampleForHigh}+)`
    };
  }
  
  if (confidence === 'medium' && sampleSize < SANITY_THRESHOLDS.minSampleForMedium) {
    return {
      needsAdjustment: true,
      adjustedConfidence: 'low',
      reasoning: `Sample size ${sampleSize} too small for medium confidence (need ${SANITY_THRESHOLDS.minSampleForMedium}+)`
    };
  }
  
  return {
    needsAdjustment: false,
    adjustedConfidence: confidence,
    reasoning: ''
  };
}

/**
 * Check if sample size supports coverage percentage
 */
function checkSampleSizeVsCoverage(sampleSize: number, coverage: number): {
  needsAdjustment: boolean;
  adjustedCoverage: number;
  reasoning: string;
} {
  let adjustedCoverage = coverage;
  let needsAdjustment = false;
  let reasoning = '';
  
  if (sampleSize < SANITY_THRESHOLDS.minSampleForLow && coverage > SANITY_THRESHOLDS.maxCoverageForTinySample) {
    adjustedCoverage = SANITY_THRESHOLDS.maxCoverageForTinySample;
    needsAdjustment = true;
    reasoning = `Sample size ${sampleSize} too small for ${coverage}% coverage (max ${SANITY_THRESHOLDS.maxCoverageForTinySample}%)`;
  } else if (sampleSize < SANITY_THRESHOLDS.minSampleForMedium && coverage > SANITY_THRESHOLDS.maxCoverageForSmallSample) {
    adjustedCoverage = SANITY_THRESHOLDS.maxCoverageForSmallSample;
    needsAdjustment = true;
    reasoning = `Sample size ${sampleSize} too small for ${coverage}% coverage (max ${SANITY_THRESHOLDS.maxCoverageForSmallSample}%)`;
  } else if (sampleSize < SANITY_THRESHOLDS.minSampleForHigh && coverage > SANITY_THRESHOLDS.maxCoverageForMediumSample) {
    adjustedCoverage = SANITY_THRESHOLDS.maxCoverageForMediumSample;
    needsAdjustment = true;
    reasoning = `Sample size ${sampleSize} too small for ${coverage}% coverage (max ${SANITY_THRESHOLDS.maxCoverageForMediumSample}%)`;
  }
  
  return { needsAdjustment, adjustedCoverage, reasoning };
}

/**
 * Check if model distribution is balanced enough for high coverage
 */
function checkModelDistributionBalance(distribution: Record<string, number>, totalSampleSize: number): {
  needsAdjustment: boolean;
  adjustedCoverage: number;
  reasoning: string;
} {
  const models = Object.keys(distribution);
  const modelCounts = Object.values(distribution);
  const totalModels = models.length;
  
  // Check minimum model count for high coverage
  if (totalModels < SANITY_THRESHOLDS.minModelsForHighCoverage) {
    return {
      needsAdjustment: true,
      adjustedCoverage: 85,
      reasoning: `Only ${totalModels} models detected, insufficient for >85% coverage`
    };
  }
  
  // Check for model dominance
  const maxCount = Math.max(...modelCounts);
  const dominanceRatio = maxCount / totalSampleSize;
  
  if (dominanceRatio > SANITY_THRESHOLDS.maxDominanceRatio) {
    const dominantModel = models[modelCounts.indexOf(maxCount)];
    return {
      needsAdjustment: true,
      adjustedCoverage: 75,
      reasoning: `Model ${dominantModel} dominates with ${Math.round(dominanceRatio * 100)}% of samples, reducing coverage reliability`
    };
  }
  
  // Check per-model sample sizes
  const insufficientModels = modelCounts.filter(count => count < SANITY_THRESHOLDS.minModelsPerModelForBalance);
  if (insufficientModels.length > 0) {
    return {
      needsAdjustment: true,
      adjustedCoverage: 80,
      reasoning: `${insufficientModels.length} models have <${SANITY_THRESHOLDS.minModelsPerModelForBalance} samples each, reducing coverage reliability`
    };
  }
  
  return {
    needsAdjustment: false,
    adjustedCoverage: 100,
    reasoning: ''
  };
}

/**
 * Check for statistically impossible combinations
 */
function checkImpossibleCombinations(sampleSize: number, coverage: number, confidence: ConfidenceLevel): {
  needsAdjustment: boolean;
  adjustedConfidence: ConfidenceLevel;
  adjustedCoverage: number;
  reasoning: string;
} {
  // Impossible: Tiny sample + High coverage + High confidence
  if (sampleSize < 10 && coverage > 80 && confidence === 'high') {
    return {
      needsAdjustment: true,
      adjustedConfidence: 'low',
      adjustedCoverage: 60,
      reasoning: 'Impossible combination: tiny sample with high coverage and high confidence'
    };
  }
  
  // Impossible: Small sample + Perfect coverage + High confidence
  if (sampleSize < 30 && coverage > 95 && confidence === 'high') {
    return {
      needsAdjustment: true,
      adjustedConfidence: 'medium',
      adjustedCoverage: 85,
      reasoning: 'Impossible combination: small sample with perfect coverage and high confidence'
    };
  }
  
  // Impossible: Very small sample + High confidence
  if (sampleSize < 5 && confidence !== 'low') {
    return {
      needsAdjustment: true,
      adjustedConfidence: 'low',
      adjustedCoverage: Math.min(coverage, 50),
      reasoning: 'Impossible combination: very small sample with high confidence'
    };
  }
  
  return {
    needsAdjustment: false,
    adjustedConfidence: confidence,
    adjustedCoverage: coverage,
    reasoning: ''
  };
}

/**
 * Reduce confidence level by one step
 */
function reduceConfidenceLevel(current: ConfidenceLevel): ConfidenceLevel {
  switch (current) {
    case 'high': return 'medium';
    case 'medium': return 'low';
    case 'low': return 'low';
    default: return 'low';
  }
}

/**
 * Generate realistic confidence for given sample characteristics
 */
export function generateRealisticConfidence(
  sampleSize: number,
  modelCount: number,
  dataCompleteness: number = 100,
  timeWindowDays: number = 30
): ConfidenceLevel {
  // Base confidence from sample size
  let confidence: ConfidenceLevel;
  if (sampleSize >= SANITY_THRESHOLDS.minSampleForHigh) {
    confidence = 'high';
  } else if (sampleSize >= SANITY_THRESHOLDS.minSampleForMedium) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }
  
  // Reduce for model imbalance
  if (modelCount < 3) {
    confidence = reduceConfidenceLevel(confidence);
  }
  
  // Reduce for data completeness
  if (dataCompleteness < 90) {
    confidence = reduceConfidenceLevel(confidence);
  }
  
  // Reduce for insufficient time window
  if (timeWindowDays < 14 && sampleSize < 50) {
    confidence = reduceConfidenceLevel(confidence);
  }
  
  return confidence;
}

/**
 * Generate realistic coverage for given sample characteristics
 */
export function generateRealisticCoverage(
  sampleSize: number,
  modelDistribution: Record<string, number>,
  dataCompleteness: number = 100
): number {
  let coverage = 100;
  
  // Adjust for sample size
  if (sampleSize < SANITY_THRESHOLDS.minSampleForLow) {
    coverage = Math.min(coverage, SANITY_THRESHOLDS.maxCoverageForTinySample);
  } else if (sampleSize < SANITY_THRESHOLDS.minSampleForMedium) {
    coverage = Math.min(coverage, SANITY_THRESHOLDS.maxCoverageForSmallSample);
  } else if (sampleSize < SANITY_THRESHOLDS.minSampleForHigh) {
    coverage = Math.min(coverage, SANITY_THRESHOLDS.maxCoverageForMediumSample);
  }
  
  // Adjust for model distribution
  const modelCount = Object.keys(modelDistribution).length;
  if (modelCount < SANITY_THRESHOLDS.minModelsForHighCoverage) {
    coverage = Math.min(coverage, 85);
  }
  
  // Adjust for data completeness
  coverage = coverage * (dataCompleteness / 100);
  
  return Math.round(coverage);
}
