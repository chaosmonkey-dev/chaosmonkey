/**
 * Statistical Realism System
 * 
 * Fixes impossible confidence/coverage combinations that make the system
 * feel fake to VP Engineering audiences.
 * 
 * PROBLEM EXAMPLES:
 * - Sessions: 240, Claude Sonnet 4.6: 2, GPT-5 Coding: 3, Confidence: High
 * - Tiny model counts + High confidence + 100% coverage
 * - Sparse representation + perfect metrics
 * 
 * REALISM PRINCIPLES:
 * - Tiny model representation should NEVER produce High confidence
 * - Sparse model mix should reduce coverage
 * - Confidence should feel operationally believable
 * - Statistical plausibility over synthetic perfection
 */

import type { ConfidenceLevel } from '../types';

export interface StatisticalInput {
  totalSessions: number;
  modelDistribution: Record<string, number>;
  baseConfidence: ConfidenceLevel;
  baseCoverage: number;
  dataCompleteness?: number;
}

export interface StatisticalOutput {
  adjustedConfidence: ConfidenceLevel;
  adjustedCoverage: number;
  credibilityScore: number;
  realismFlags: string[];
  reasoning: string[];
}

/**
 * Statistical realism thresholds based on real engineering data
 */
const REALISM_THRESHOLDS = {
  // Minimum samples for confidence levels
  minSamplesForHigh: 100,
  minSamplesForMedium: 30,
  minSamplesForLow: 10,
  
  // Model representation requirements
  minModelsForInsight: 2,
  minSamplesPerModel: 5,
  maxDominanceRatio: 0.8, // No model should be >80% of samples
  
  // Coverage realism limits
  maxCoverageForTinySample: 65,
  maxCoverageForSmallSample: 85,
  maxCoverageForSparseModels: 75,
  
  // Data completeness requirements
  minCompletenessForHigh: 95,
  minCompletenessForMedium: 80,
  minCompletenessForLow: 60
};

/**
 * Apply statistical realism to confidence and coverage
 */
export function applyStatisticalRealism(input: StatisticalInput): StatisticalOutput {
  const {
    totalSessions,
    modelDistribution,
    baseConfidence,
    baseCoverage,
    dataCompleteness = 100
  } = input;
  
  const flags: string[] = [];
  const reasoning: string[] = [];
  let adjustedConfidence = baseConfidence;
  let adjustedCoverage = baseCoverage;
  
  // Check 1: Sample size vs confidence
  const sampleSizeCheck = checkSampleSizeRealism(totalSessions, baseConfidence);
  if (sampleSizeCheck.needsAdjustment) {
    adjustedConfidence = sampleSizeCheck.adjustedConfidence;
    flags.push('sample_size_confidence_mismatch');
    reasoning.push(sampleSizeCheck.reasoning);
  }
  
  // Check 2: Model distribution balance
  const distributionCheck = checkModelDistributionRealism(modelDistribution, totalSessions);
  if (distributionCheck.needsAdjustment) {
    adjustedCoverage = Math.min(adjustedCoverage, distributionCheck.adjustedCoverage);
    flags.push('model_distribution_imbalance');
    reasoning.push(distributionCheck.reasoning);
  }
  
  // Check 3: Sparse model representation
  const sparsityCheck = checkModelSparsityRealism(modelDistribution, totalSessions);
  if (sparsityCheck.needsAdjustment) {
    adjustedConfidence = sparsityCheck.adjustedConfidence;
    adjustedCoverage = Math.min(adjustedCoverage, sparsityCheck.adjustedCoverage);
    flags.push('sparse_model_representation');
    reasoning.push(sparsityCheck.reasoning);
  }
  
  // Check 4: Coverage vs sample size
  const coverageCheck = checkCoverageRealism(totalSessions, adjustedCoverage);
  if (coverageCheck.needsAdjustment) {
    adjustedCoverage = coverageCheck.adjustedCoverage;
    flags.push('coverage_sample_mismatch');
    reasoning.push(coverageCheck.reasoning);
  }
  
  // Check 5: Data completeness impact
  const completenessCheck = checkDataCompletenessRealism(dataCompleteness, adjustedConfidence);
  if (completenessCheck.needsAdjustment) {
    adjustedConfidence = completenessCheck.adjustedConfidence;
    flags.push('data_completeness_impact');
    reasoning.push(completenessCheck.reasoning);
  }
  
  // Check 6: Impossible combinations
  const impossibleCheck = checkImpossibleCombinations(totalSessions, modelDistribution, adjustedConfidence, adjustedCoverage);
  if (impossibleCheck.needsAdjustment) {
    adjustedConfidence = impossibleCheck.adjustedConfidence;
    adjustedCoverage = impossibleCheck.adjustedCoverage;
    flags.push('impossible_combination');
    reasoning.push(impossibleCheck.reasoning);
  }
  
  // Calculate credibility score
  const credibilityScore = calculateCredibilityScore(flags, totalSessions);
  
  return {
    adjustedConfidence,
    adjustedCoverage,
    credibilityScore,
    realismFlags: flags,
    reasoning
  };
}

/**
 * Check sample size vs confidence realism
 */
function checkSampleSizeRealism(sampleSize: number, confidence: ConfidenceLevel): {
  needsAdjustment: boolean;
  adjustedConfidence: ConfidenceLevel;
  reasoning: string;
} {
  if (confidence === 'high' && sampleSize < REALISM_THRESHOLDS.minSamplesForHigh) {
    return {
      needsAdjustment: true,
      adjustedConfidence: sampleSize < REALISM_THRESHOLDS.minSamplesForMedium ? 'low' : 'medium',
      reasoning: `Sample size ${sampleSize} too small for High confidence (need ${REALISM_THRESHOLDS.minSamplesForHigh}+)`
    };
  }
  
  if (confidence === 'medium' && sampleSize < REALISM_THRESHOLDS.minSamplesForMedium) {
    return {
      needsAdjustment: true,
      adjustedConfidence: 'low',
      reasoning: `Sample size ${sampleSize} too small for Medium confidence (need ${REALISM_THRESHOLDS.minSamplesForMedium}+)`
    };
  }
  
  return {
    needsAdjustment: false,
    adjustedConfidence: confidence,
    reasoning: ''
  };
}

/**
 * Check model distribution balance
 */
function checkModelDistributionRealism(distribution: Record<string, number>, totalSamples: number): {
  needsAdjustment: boolean;
  adjustedCoverage: number;
  reasoning: string;
} {
  const models = Object.keys(distribution);
  const modelCounts = Object.values(distribution);
  const totalModels = models.length;
  
  // Check minimum model count
  if (totalModels < REALISM_THRESHOLDS.minModelsForInsight) {
    return {
      needsAdjustment: true,
      adjustedCoverage: REALISM_THRESHOLDS.maxCoverageForSparseModels,
      reasoning: `Only ${totalModels} models detected, insufficient for high coverage`
    };
  }
  
  // Check for model dominance
  const maxCount = Math.max(...modelCounts);
  const dominanceRatio = maxCount / totalSamples;
  
  if (dominanceRatio > REALISM_THRESHOLDS.maxDominanceRatio) {
    const dominantModel = models[modelCounts.indexOf(maxCount)];
    return {
      needsAdjustment: true,
      adjustedCoverage: REALISM_THRESHOLDS.maxCoverageForSparseModels,
      reasoning: `Model ${dominantModel} dominates with ${Math.round(dominanceRatio * 100)}% of samples`
    };
  }
  
  // Check per-model sample sizes
  const insufficientModels = modelCounts.filter(count => count < REALISM_THRESHOLDS.minSamplesPerModel);
  if (insufficientModels.length > 0) {
    return {
      needsAdjustment: true,
      adjustedCoverage: REALISM_THRESHOLDS.maxCoverageForSparseModels,
      reasoning: `${insufficientModels.length} models have <${REALISM_THRESHOLDS.minSamplesPerModel} samples each`
    };
  }
  
  return {
    needsAdjustment: false,
    adjustedCoverage: 100,
    reasoning: ''
  };
}

/**
 * Check for sparse model representation
 */
function checkModelSparsityRealism(distribution: Record<string, number>, totalSamples: number): {
  needsAdjustment: boolean;
  adjustedConfidence: ConfidenceLevel;
  adjustedCoverage: number;
  reasoning: string;
} {
  const modelCounts = Object.values(distribution);
  
  // Check for extremely sparse representation
  const tinyModels = modelCounts.filter(count => count < 3).length;
  
  if (tinyModels > 0 && totalSamples < 50) {
    return {
      needsAdjustment: true,
      adjustedConfidence: 'low',
      adjustedCoverage: REALISM_THRESHOLDS.maxCoverageForTinySample,
      reasoning: `${tinyModels} models have <3 samples with total sample size ${totalSamples}`
    };
  }
  
  // Check for impossible High confidence with sparse data
  const maxModelCount = Math.max(...modelCounts);
  if (maxModelCount < 10 && totalSamples < 100) {
    return {
      needsAdjustment: true,
      adjustedConfidence: 'medium',
      adjustedCoverage: REALISM_THRESHOLDS.maxCoverageForSmallSample,
      reasoning: `Largest model has only ${maxModelCount} samples, insufficient for High confidence`
    };
  }
  
  return {
    needsAdjustment: false,
    adjustedConfidence: 'high',
    adjustedCoverage: 100,
    reasoning: ''
  };
}

/**
 * Check coverage vs sample size realism
 */
function checkCoverageRealism(sampleSize: number, coverage: number): {
  needsAdjustment: boolean;
  adjustedCoverage: number;
  reasoning: string;
} {
  let adjustedCoverage = coverage;
  let needsAdjustment = false;
  let reasoning = '';
  
  if (sampleSize < REALISM_THRESHOLDS.minSamplesForLow && coverage > REALISM_THRESHOLDS.maxCoverageForTinySample) {
    adjustedCoverage = REALISM_THRESHOLDS.maxCoverageForTinySample;
    needsAdjustment = true;
    reasoning = `Sample size ${sampleSize} too small for ${coverage}% coverage`;
  } else if (sampleSize < REALISM_THRESHOLDS.minSamplesForMedium && coverage > REALISM_THRESHOLDS.maxCoverageForSmallSample) {
    adjustedCoverage = REALISM_THRESHOLDS.maxCoverageForSmallSample;
    needsAdjustment = true;
    reasoning = `Sample size ${sampleSize} too small for ${coverage}% coverage`;
  } else if (sampleSize < REALISM_THRESHOLDS.minSamplesForHigh && coverage > 95) {
    adjustedCoverage = 90;
    needsAdjustment = true;
    reasoning = `Sample size ${sampleSize} too small for perfect coverage`;
  }
  
  return { needsAdjustment, adjustedCoverage, reasoning };
}

/**
 * Check data completeness impact
 */
function checkDataCompletenessRealism(completeness: number, confidence: ConfidenceLevel): {
  needsAdjustment: boolean;
  adjustedConfidence: ConfidenceLevel;
  reasoning: string;
} {
  if (confidence === 'high' && completeness < REALISM_THRESHOLDS.minCompletenessForHigh) {
    return {
      needsAdjustment: true,
      adjustedConfidence: completeness < REALISM_THRESHOLDS.minCompletenessForMedium ? 'low' : 'medium',
      reasoning: `Data completeness ${completeness}% too low for High confidence`
    };
  }
  
  if (confidence === 'medium' && completeness < REALISM_THRESHOLDS.minCompletenessForMedium) {
    return {
      needsAdjustment: true,
      adjustedConfidence: 'low',
      reasoning: `Data completeness ${completeness}% too low for Medium confidence`
    };
  }
  
  return {
    needsAdjustment: false,
    adjustedConfidence: confidence,
    reasoning: ''
  };
}

/**
 * Check for impossible combinations
 */
function checkImpossibleCombinations(
  sampleSize: number,
  distribution: Record<string, number>,
  confidence: ConfidenceLevel,
  coverage: number
): {
  needsAdjustment: boolean;
  adjustedConfidence: ConfidenceLevel;
  adjustedCoverage: number;
  reasoning: string;
} {
  const modelCounts = Object.values(distribution);
  const maxModelCount = Math.max(...modelCounts);
  const totalModels = modelCounts.length;
  
  // Impossible: Tiny sample + High confidence + High coverage
  if (sampleSize < 20 && confidence === 'high' && coverage > 80) {
    return {
      needsAdjustment: true,
      adjustedConfidence: 'low',
      adjustedCoverage: 60,
      reasoning: 'Impossible: tiny sample with High confidence and High coverage'
    };
  }
  
  // Impossible: Sparse models + High confidence
  if (maxModelCount < 5 && totalModels > 3 && confidence === 'high') {
    return {
      needsAdjustment: true,
      adjustedConfidence: 'medium',
      adjustedCoverage: Math.min(coverage, 75),
      reasoning: 'Impossible: sparse model representation with High confidence'
    };
  }
  
  // Impossible: Very small max model count + High confidence
  if (maxModelCount < 3 && confidence === 'high') {
    return {
      needsAdjustment: true,
      adjustedConfidence: 'low',
      adjustedCoverage: Math.min(coverage, 65),
      reasoning: 'Impossible: largest model has <3 samples with High confidence'
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
 * Calculate credibility score based on realism flags
 */
function calculateCredibilityScore(flags: string[], sampleSize: number): number {
  let score = 100;
  
  flags.forEach(flag => {
    switch (flag) {
      case 'sample_size_confidence_mismatch':
        score -= 25;
        break;
      case 'model_distribution_imbalance':
        score -= 20;
        break;
      case 'sparse_model_representation':
        score -= 30;
        break;
      case 'coverage_sample_mismatch':
        score -= 15;
        break;
      case 'data_completeness_impact':
        score -= 10;
        break;
      case 'impossible_combination':
        score -= 35;
        break;
    }
  });
  
  // Bonus for adequate sample size
  if (sampleSize >= REALISM_THRESHOLDS.minSamplesForHigh) {
    score += 5;
  } else if (sampleSize >= REALISM_THRESHOLDS.minSamplesForMedium) {
    score += 2;
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Generate realistic confidence from sample characteristics
 */
export function generateRealisticConfidence(
  totalSessions: number,
  modelDistribution: Record<string, number>,
  dataCompleteness: number = 100
): ConfidenceLevel {
  // Start with sample size-based confidence
  let confidence: ConfidenceLevel;
  if (totalSessions >= REALISM_THRESHOLDS.minSamplesForHigh) {
    confidence = 'high';
  } else if (totalSessions >= REALISM_THRESHOLDS.minSamplesForMedium) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }
  
  // Reduce for sparse model representation
  const modelCounts = Object.values(modelDistribution);
  const maxModelCount = Math.max(...modelCounts);
  const totalModels = modelCounts.length;
  
  if (maxModelCount < 5 && totalModels > 2) {
    confidence = 'low';
  } else if (maxModelCount < 10 && totalModels > 3) {
    confidence = confidence === 'high' ? 'medium' : confidence;
  }
  
  // Reduce for data completeness
  if (dataCompleteness < REALISM_THRESHOLDS.minCompletenessForHigh && confidence === 'high') {
    confidence = 'medium';
  } else if (dataCompleteness < REALISM_THRESHOLDS.minCompletenessForMedium && confidence === 'medium') {
    confidence = 'low';
  }
  
  return confidence;
}

/**
 * Generate realistic coverage from sample characteristics
 */
export function generateRealisticCoverage(
  totalSessions: number,
  modelDistribution: Record<string, number>,
  dataCompleteness: number = 100
): number {
  let coverage = 100;
  
  // Adjust for sample size
  if (totalSessions < REALISM_THRESHOLDS.minSamplesForLow) {
    coverage = REALISM_THRESHOLDS.maxCoverageForTinySample;
  } else if (totalSessions < REALISM_THRESHOLDS.minSamplesForMedium) {
    coverage = REALISM_THRESHOLDS.maxCoverageForSmallSample;
  } else if (totalSessions < REALISM_THRESHOLDS.minSamplesForHigh) {
    coverage = 90;
  }
  
  // Adjust for model distribution
  const modelCounts = Object.values(modelDistribution);
  const maxModelCount = Math.max(...modelCounts);
  const totalModels = modelCounts.length;
  
  if (totalModels < 2 || maxModelCount < REALISM_THRESHOLDS.minSamplesPerModel) {
    coverage = Math.min(coverage, REALISM_THRESHOLDS.maxCoverageForSparseModels);
  }
  
  // Adjust for data completeness
  coverage = coverage * (dataCompleteness / 100);
  
  return Math.round(coverage);
}
