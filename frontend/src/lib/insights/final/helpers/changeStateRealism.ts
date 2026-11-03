/**
 * Change State Realism System
 * 
 * Generates diverse operational states that sound like real engineering
 * analytics platforms, not AI-generated content with repetitive "Stable" labels.
 * 
 * CREDIBILITY PRINCIPLES:
 * - Diverse state vocabulary beyond "Stable"
 * - Reflect actual metric movement patterns
 * - Increase state diversity across cards
 * - Avoid adjacent identical states
 */

export type ChangeState = 
  | 'improving'
  | 'degrading' 
  | 'elevated'
  | 'recovering'
  | 'volatile'
  | 'plateauing'
  | 'narrowing'
  | 'widening'
  | 'accelerating'
  | 'declining'
  | 'stabilizing'
  | 'fluctuating';

/**
 * State selection logic based on metric patterns
 */
export type MetricPattern = 
  | 'steady_improvement'
  | 'steady_decline'
  | 'volatile_with_trend'
  | 'plateau_with_variance'
  | 'recovering_from_spike'
  | 'accelerating_change'
  | 'widening_gap'
  | 'narrowing_variance'
  | 'normal_fluctuation';

/**
 * Map metric patterns to appropriate states
 */
const PATTERN_TO_STATE: Record<MetricPattern, ChangeState[]> = {
  steady_improvement: ['improving', 'accelerating', 'stabilizing'],
  steady_decline: ['degrading', 'declining', 'volatile'],
  volatile_with_trend: ['volatile', 'fluctuating', 'elevated'],
  plateau_with_variance: ['plateauing', 'fluctuating', 'stabilizing'],
  recovering_from_spike: ['recovering', 'stabilizing', 'improving'],
  accelerating_change: ['accelerating', 'elevated', 'volatile'],
  widening_gap: ['widening', 'elevated', 'degrading'],
  narrowing_variance: ['narrowing', 'stabilizing', 'improving'],
  normal_fluctuation: ['fluctuating', 'stabilizing', 'plateauing']
};

/**
 * Determine metric pattern from values
 */
export function determineMetricPattern(
  currentValue: number,
  baselineValue: number,
  historicalValues?: number[],
  volatility?: number
): MetricPattern {
  const delta = currentValue - baselineValue;
  const percentChange = baselineValue !== 0 ? (delta / baselineValue) * 100 : 0;
  const isImprovement = delta > 0;
  
  // Determine volatility if historical data provided
  let isVolatile = false;
  if (historicalValues && historicalValues.length > 3) {
    const mean = historicalValues.reduce((sum, val) => sum + val, 0) / historicalValues.length;
    const variance = historicalValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / historicalValues.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = mean !== 0 ? stdDev / mean : 0;
    isVolatile = coefficientOfVariation > 0.2; // 20%+ variation is volatile
  } else if (volatility !== undefined) {
    isVolatile = volatility > 0.2;
  }
  
  // Pattern determination logic
  if (isVolatile) {
    if (isImprovement) {
      return 'volatile_with_trend';
    } else {
      return 'volatile_with_trend';
    }
  } else if (Math.abs(percentChange) < 5) {
    return 'plateau_with_variance';
  } else if (Math.abs(percentChange) > 20) {
    if (isImprovement) {
      return 'accelerating_change';
    } else {
      return 'accelerating_change';
    }
  } else if (isImprovement) {
    return historicalValues && historicalValues.length > 0 && 
            historicalValues[historicalValues.length - 2] < baselineValue
      ? 'recovering_from_spike'
      : 'steady_improvement';
  } else {
    return 'steady_decline';
  }
}

/**
 * Generate realistic change state
 */
export function generateChangeState(
  pattern: MetricPattern,
  adjacentStates?: ChangeState[]
): ChangeState {
  const availableStates = PATTERN_TO_STATE[pattern];
  
  // Avoid repetition with adjacent states
  let filteredStates = availableStates;
  if (adjacentStates && adjacentStates.length > 0) {
    filteredStates = availableStates.filter(state => 
      !adjacentStates.includes(state)
    );
  }
  
  // Fallback to all states if filtered set is empty
  if (filteredStates.length === 0) {
    filteredStates = availableStates;
  }
  
  return filteredStates[Math.floor(Math.random() * filteredStates.length)];
}

/**
 * Generate diverse state rotation for multiple insights with enhanced diversity
 */
export function generateStateRotation(
  patterns: MetricPattern[],
  maxAdjacencyRepeats: number = 1,
  maxStableFrequency: number = 0.3 // Max 30% can be stable/stabilizing
): ChangeState[] {
  const states: ChangeState[] = [];
  const recentStates: ChangeState[] = [];
  let stableCount = 0;
  
  patterns.forEach((pattern, _index) => {
    // Get recent states for adjacency checking
    const recentWindow = recentStates.slice(-maxAdjacencyRepeats);
    
    // Check if we're overusing stable states
    const stableRatio = stableCount / Math.max(1, states.length);
    const shouldAvoidStable = stableRatio >= maxStableFrequency;
    
    const state = generateChangeStateWithConstraints(pattern, recentWindow, shouldAvoidStable);
    states.push(state);
    
    // Track stable states
    if (state === 'stabilizing' || state === 'plateauing') {
      stableCount++;
    }
    
    // Update recent states
    recentStates.push(state);
    if (recentStates.length > maxAdjacencyRepeats * 2) {
      recentStates.shift();
    }
  });
  
  return states;
}

/**
 * Generate change state with stability constraints
 */
export function generateChangeStateWithConstraints(
  pattern: MetricPattern,
  adjacentStates?: ChangeState[],
  avoidStable: boolean = false
): ChangeState {
  const availableStates = PATTERN_TO_STATE[pattern];
  
  // Filter states
  let filteredStates = availableStates;
  
  // Avoid adjacency repeats
  if (adjacentStates && adjacentStates.length > 0) {
    filteredStates = availableStates.filter(state => 
      !adjacentStates.includes(state)
    );
  }
  
  // Avoid stable states if requested
  if (avoidStable) {
    filteredStates = filteredStates.filter(state => 
      state !== 'stabilizing' && state !== 'plateauing'
    );
  }
  
  // Fallback to all states if filtered set is empty
  if (filteredStates.length === 0) {
    filteredStates = availableStates;
  }
  
  return filteredStates[Math.floor(Math.random() * filteredStates.length)];
}

/**
 * Validate state diversity across multiple insights
 */
export function validateStateDiversity(states: ChangeState[]): {
  isDiverse: boolean;
  credibilityScore: number;
  issues: string[];
  suggestions: string[];
} {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;
  
  // Check for overuse of stable states
  const stableStates = states.filter(s => s === 'stabilizing' || s === 'plateauing');
  const stableRatio = stableStates.length / states.length;
  
  if (stableRatio > 0.4) {
    issues.push(`Overuse of stable states: ${Math.round(stableRatio * 100)}%`);
    suggestions.push('Reduce stable states to <30% of total');
    score -= 25;
  }
  
  // Check for adjacent duplicates
  let adjacentDuplicates = 0;
  for (let i = 1; i < states.length; i++) {
    if (states[i] === states[i - 1]) {
      adjacentDuplicates++;
    }
  }
  
  if (adjacentDuplicates > 0) {
    issues.push(`${adjacentDuplicates} adjacent duplicate states`);
    suggestions.push('Ensure neighboring cards have different states');
    score -= 20;
  }
  
  // Check for overall diversity
  const uniqueStates = new Set(states);
  if (uniqueStates.size < 3 && states.length > 3) {
    issues.push(`Low state diversity: only ${uniqueStates.size} unique states`);
    suggestions.push('Use at least 3 different states across insights');
    score -= 15;
  }
  
  return {
    isDiverse: issues.length === 0,
    credibilityScore: Math.max(0, score),
    issues,
    suggestions
  };
}

/**
 * Get emotional tone variety score
 */
export function getEmotionalToneVariety(states: ChangeState[]): {
  positiveRatio: number;
  negativeRatio: number;
  neutralRatio: number;
  isBalanced: boolean;
} {
  const positiveStates = ['improving', 'recovering', 'accelerating', 'elevated'];
  const negativeStates = ['degrading', 'declining', 'volatile', 'fluctuating'];
  const neutralStates = ['plateauing', 'stabilizing', 'narrowing', 'widening'];
  
  const positiveCount = states.filter(s => positiveStates.includes(s)).length;
  const negativeCount = states.filter(s => negativeStates.includes(s)).length;
  const neutralCount = states.filter(s => neutralStates.includes(s)).length;
  
  const total = states.length;
  
  const positiveRatio = positiveCount / total;
  const negativeRatio = negativeCount / total;
  const neutralRatio = neutralCount / total;
  
  return {
    positiveRatio,
    negativeRatio,
    neutralRatio,
    isBalanced: Math.abs(positiveRatio - negativeRatio) <= 0.3
  };
}

/**
 * Get state color for UI (real platform color schemes)
 */
export function getStateColor(state: ChangeState): string {
  const colorMap: Record<ChangeState, string> = {
    improving: 'green',
    accelerating: 'green',
    recovering: 'blue',
    stabilizing: 'blue',
    narrowing: 'blue',
    
    degrading: 'red',
    declining: 'red',
    volatile: 'orange',
    fluctuating: 'orange',
    elevated: 'orange',
    
    plateauing: 'yellow',
    widening: 'yellow'
  };
  
  return colorMap[state];
}

/**
 * Get state description for tooltips
 */
export function getStateDescription(state: ChangeState): string {
  const descriptions: Record<ChangeState, string> = {
    improving: 'Metric showing consistent improvement',
    accelerating: 'Metric improvement rate increasing',
    recovering: 'Metric recovering from previous decline',
    stabilizing: 'Metric becoming more consistent',
    narrowing: 'Variance in metric decreasing',
    
    degrading: 'Metric showing consistent decline',
    declining: 'Metric value decreasing',
    volatile: 'Metric showing high variance',
    fluctuating: 'Metric oscillating around baseline',
    elevated: 'Metric above normal range',
    
    plateauing: 'Metric showing little change',
    widening: 'Variance in metric increasing'
  };
  
  return descriptions[state];
}

/**
 * Determine if state indicates action needed
 */
export function isActionRequired(state: ChangeState): boolean {
  const actionStates: ChangeState[] = [
    'degrading', 'declining', 'volatile', 'elevated', 'widening'
  ];
  
  return actionStates.includes(state);
}

/**
 * Get state urgency level
 */
export function getStateUrgency(state: ChangeState): 'low' | 'medium' | 'high' {
  const urgencyMap: Record<ChangeState, 'low' | 'medium' | 'high'> = {
    improving: 'low',
    accelerating: 'low',
    recovering: 'medium',
    stabilizing: 'low',
    narrowing: 'low',
    
    degrading: 'high',
    declining: 'high',
    volatile: 'medium',
    fluctuating: 'medium',
    elevated: 'medium',
    
    plateauing: 'low',
    widening: 'medium'
  };
  
  return urgencyMap[state];
}

/**
 * Generate state from simple metric comparison
 */
export function generateStateFromMetrics(
  currentValue: number,
  baselineValue: number,
  _previousValue?: number,
  historicalValues?: number[]
): ChangeState {
  const pattern = determineMetricPattern(
    currentValue, 
    baselineValue, 
    historicalValues
  );
  
  return generateChangeState(pattern);
}
