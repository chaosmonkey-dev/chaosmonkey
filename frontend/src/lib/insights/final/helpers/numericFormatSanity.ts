/**
 * Numeric Format Sanity System
 * 
 * Eliminates raw floating point formatting that destroys credibility.
 * Implements executive-facing numeric presentation.
 * 
 * CRITICAL BUG EXAMPLE:
 * 12.666666666666666/week ← This is a catastrophic trust killer
 * 
 * REQUIREMENTS:
 * - No raw floats anywhere
 * - No excessive precision
 * - Numbers should look executive-facing
 * - Preserve realism without looking machine-generated
 */

export interface NumericFormatOptions {
  maxDecimals: number;
  showUnits: boolean;
  format: 'decimal' | 'percentage' | 'rate' | 'duration' | 'count';
  context?: string;
}


/**
 * Format number with executive-facing precision
 */
export function formatExecutiveNumber(
  value: number,
  options: NumericFormatOptions
): string {
  const { maxDecimals, format, showUnits, context } = options;
  
  // Handle edge cases
  if (isNaN(value) || !isFinite(value)) {
    return '—';
  }
  
  // Round to appropriate precision
  const rounded = roundToPrecision(value, maxDecimals);
  
  // Format based on type
  switch (format) {
    case 'decimal':
      return formatDecimal(rounded, showUnits, context);
    
    case 'percentage':
      return formatPercentage(rounded, showUnits);
    
    case 'rate':
      return formatRate(rounded, showUnits, context);
    
    case 'duration':
      return formatDuration(rounded, showUnits, context);
    
    case 'count':
      return formatCount(rounded, showUnits, context);
    
    default:
      return formatDecimal(rounded, showUnits, context);
  }
}

/**
 * Round number to specified precision with smart rounding
 */
function roundToPrecision(value: number, maxDecimals: number): number {
  if (maxDecimals === 0) {
    return Math.round(value);
  }
  
  const factor = Math.pow(10, maxDecimals);
  return Math.round(value * factor) / factor;
}

/**
 * Format decimal numbers
 */
function formatDecimal(value: number, showUnits: boolean, context?: string): string {
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  });
  
  if (!showUnits) {
    return formatted;
  }
  
  const unit = getUnitForContext(context);
  return `${formatted}${unit}`;
}

/**
 * Format percentages
 */
function formatPercentage(value: number, showUnits: boolean): string {
  const percentage = Math.round(value * 100);
  return showUnits ? `${percentage}%` : `${percentage}`;
}

/**
 * Format rates (per time period)
 */
function formatRate(value: number, showUnits: boolean, context?: string): string {
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
  
  if (!showUnits) {
    return formatted;
  }
  
  const period = getPeriodForContext(context);
  return `${formatted}/${period}`;
}

/**
 * Format duration
 */
function formatDuration(value: number, showUnits: boolean, context?: string): string {
  const rounded = Math.round(value);
  
  if (!showUnits) {
    return rounded.toString();
  }
  
  const unit = getDurationUnit(rounded, context);
  return `${rounded} ${unit}`;
}

/**
 * Format counts
 */
function formatCount(value: number, showUnits: boolean, context?: string): string {
  const formatted = Math.round(value).toLocaleString();
  
  if (!showUnits) {
    return formatted;
  }
  
  const unit = getUnitForContext(context);
  return `${formatted}${unit}`;
}

/**
 * Get appropriate unit for context
 */
function getUnitForContext(context?: string): string {
  const contextUnits: Record<string, string> = {
    'commits': '/week',
    'prs': '/week',
    'deployments': '/week',
    'reviews': '/week',
    'sessions': '/week',
    'duration': ' minutes',
    'time': ' minutes',
    'cycle': ' days',
    'rate': '/day',
    'frequency': '/week',
    'load': '',
    'count': '',
    'percentage': '%'
  };
  
  if (!context) {
    return '';
  }
  
  // Find matching context
  for (const [key, unit] of Object.entries(contextUnits)) {
    if (context.toLowerCase().includes(key)) {
      return unit;
    }
  }
  
  return '';
}

/**
 * Get time period for rate formatting
 */
function getPeriodForContext(context?: string): string {
  if (!context) {
    return 'day';
  }
  
  if (context.includes('week') || context.includes('weekly')) {
    return 'week';
  } else if (context.includes('hour')) {
    return 'hour';
  } else if (context.includes('day')) {
    return 'day';
  } else if (context.includes('month')) {
    return 'month';
  }
  
  return 'day';
}

/**
 * Get appropriate duration unit
 */
function getDurationUnit(value: number, context?: string): string {
  if (context?.includes('minutes') || context?.includes('duration')) {
    return value === 1 ? 'minute' : 'minutes';
  } else if (context?.includes('hours')) {
    return value === 1 ? 'hour' : 'hours';
  } else if (context?.includes('days')) {
    return value === 1 ? 'day' : 'days';
  }
  
  // Auto-detect based on magnitude
  if (value < 60) {
    return value === 1 ? 'minute' : 'minutes';
  } else if (value < 24 * 60) {
    const hours = Math.round(value / 60);
    return hours === 1 ? 'hour' : 'hours';
  } else {
    const days = Math.round(value / (24 * 60));
    return days === 1 ? 'day' : 'days';
  }
}

/**
 * Sanitize existing numeric string
 */
export function sanitizeNumericString(numericString: string): string {
  // Remove excessive precision
  const cleaned = numericString.replace(/(\d+\.\d{2,})\d*/g, '$1');
  
  // Round to 1 decimal place max
  const withOneDecimal = cleaned.replace(/(\d+\.\d{2,})/g, (_match, p1) => {
    const num = parseFloat(p1);
    return num.toFixed(1);
  });
  
  // Handle percentages
  const withPercentage = withOneDecimal.replace(/(\d+\.\d+)%/g, (_match, p1) => {
    const num = parseFloat(p1);
    return `${Math.round(num * 100)}%`;
  });
  
  return withPercentage;
}

/**
 * Validate numeric formatting credibility
 */
export function validateNumericFormatting(text: string): {
  isCredible: boolean;
  credibilityScore: number;
  issues: string[];
  suggestions: string[];
} {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;
  
  // Check for raw floating points with excessive precision
  const rawFloats = text.match(/\\d+\\.\\d{3,}/g);
  if (rawFloats) {
    issues.push(`Raw floats with excessive precision: ${rawFloats.join(', ')}`);
    suggestions.push('Round to 1 decimal place max for executive presentation');
    score -= 30;
  }
  
  // Check for machine-generated patterns
  const machinePatterns = text.match(/\\d+\\.\\d{15,}/g);
  if (machinePatterns) {
    issues.push(`Machine-generated precision detected: ${machinePatterns.join(', ')}`);
    suggestions.push('Eliminate raw floating point precision');
    score -= 40;
  }
  
  // Check for inconsistent decimal places
  const decimals = text.match(/\\d+\\.\\d+/g);
  if (decimals && decimals.some(d => d.split('.')[1].length > 2)) {
    issues.push('Inconsistent decimal precision');
    suggestions.push('Standardize to 1 decimal place maximum');
    score -= 15;
  }
  
  // Check for unrounded percentages
  const percentages = text.match(/\\d+\\.\\d+%?/g);
  if (percentages && percentages.some(p => p.includes('.'))) {
    issues.push('Unrounded percentages detected');
    suggestions.push('Round percentages to whole numbers');
    score -= 10;
  }
  
  return {
    isCredible: issues.length === 0,
    credibilityScore: Math.max(0, score),
    issues,
    suggestions
  };
}

/**
 * Apply numeric formatting sanity to insight object
 */
export function applyNumericSanity(insight: any): any {
  const sanitized = { ...insight };
  
  // Sanitize all text fields that might contain numbers
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
    if (sanitized[field] && typeof sanitized[field] === 'string') {
      sanitized[field] = sanitizeNumericString(sanitized[field]);
    }
  });
  
  return sanitized;
}

/**
 * Format metric value with context-aware precision
 */
export function formatMetricValue(
  value: number,
  metricType: string,
  showUnits: boolean = true
): string {
  const options: NumericFormatOptions = {
    maxDecimals: 1,
    showUnits,
    format: getFormatForMetric(metricType),
    context: metricType
  };
  
  return formatExecutiveNumber(value, options);
}

/**
 * Determine appropriate format for metric type
 */
function getFormatForMetric(metricType: string): NumericFormatOptions['format'] {
  if (metricType.includes('percentage') || metricType.includes('rate')) {
    return 'percentage';
  } else if (metricType.includes('time') || metricType.includes('duration')) {
    return 'duration';
  } else if (metricType.includes('count') || metricType.includes('number')) {
    return 'count';
  } else if (metricType.includes('frequency') || metricType.includes('rate')) {
    return 'rate';
  } else {
    return 'decimal';
  }
}

/**
 * Create executive summary with proper numeric formatting
 */
export function createExecutiveSummary(
  keyMetric: string,
  value: number,
  trend: string,
  impact: string
): string {
  const formattedValue = formatMetricValue(value, keyMetric);
  return `${keyMetric}: ${formattedValue} ${trend}. ${impact}`;
}
