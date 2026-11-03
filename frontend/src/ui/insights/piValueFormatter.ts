/**
 * Canonical Performance Insights Value Formatter
 * 
 * Ensures every numeric value displayed in Performance Insights includes
 * proper units/metric context and follows consistent formatting rules.
 * 
 * No naked numbers anywhere in the PI experience.
 * No raw floats (e.g., 42.85714285714285) should ever appear in UI.
 */

export type PIValueKind = 
  | 'duration' 
  | 'percent' 
  | 'ratio' 
  | 'count' 
  | 'currency' 
  | 'score' 
  | 'bytes'
  | 'rate'
  | 'cycles'
  | 'deploy_frequency'
  | 'throughput'

export interface PIValueMeta {
  unit?: string
  kind?: PIValueKind
  precision?: number
  labelPrefix?: string
  denominatorLabel?: string
  range?: string
  comparisonTool?: string
}

/**
 * Canonical formatter for all PI values
 * Returns a properly formatted string with units and context
 */
export function formatPIValue(value: any, meta: PIValueMeta = {}): string {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return '—'
  }
  
  // Handle non-numeric values
  if (typeof value !== 'number' && typeof value !== 'string') {
    return String(value)
  }
  
  // Parse numeric value
  let numValue: number | null = null
  if (typeof value === 'number') {
    numValue = value
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return '—'
    
    // Try to parse as number
    const parsed = Number(trimmed.replace(/[^0-9.-]/g, ''))
    if (!isNaN(parsed) && isFinite(parsed)) {
      numValue = parsed
    }
  }
  
  // If not a valid number, return as string
  if (numValue === null || !isFinite(numValue)) {
    return String(value)
  }
  
  const {
    unit,
    kind = 'count',
    precision = 2,
    labelPrefix,
    denominatorLabel,
    range,
    comparisonTool
  } = meta
  
  // Format based on kind
  let formattedValue: string
  let formattedUnit: string = unit || ''
  
  switch (kind) {
    case 'duration':
      formattedValue = formatDuration(numValue, precision)
      if (!formattedUnit) {
        formattedUnit = inferDurationUnit(numValue)
      }
      break
      
    case 'percent':
      formattedValue = formatPercent(numValue, precision)
      formattedUnit = '%'
      break
      
    case 'ratio':
      formattedValue = formatRatio(numValue, precision)
      if (!formattedUnit) {
        formattedUnit = denominatorLabel || 'ratio'
      }
      break
      
    case 'count':
      formattedValue = formatCount(numValue, precision)
      if (!formattedUnit) {
        formattedUnit = inferCountUnit(denominatorLabel)
      }
      break
      
    case 'score':
      formattedValue = formatScore(numValue, precision, range)
      formattedUnit = 'score'
      break
      
    case 'bytes':
      formattedValue = formatBytes(numValue, precision)
      if (!formattedUnit) {
        formattedUnit = inferBytesUnit(numValue)
      }
      break
      
    case 'rate':
      formattedValue = formatRate(numValue, precision)
      if (!formattedUnit) {
        formattedUnit = denominatorLabel ? `/${denominatorLabel}` : '/sec'
      }
      break
      
    case 'cycles':
      formattedValue = formatCount(numValue, 0)
      formattedUnit = 'cycles'
      break
      
    case 'deploy_frequency':
      formattedValue = formatDeployFrequency(numValue, precision)
      formattedUnit = denominatorLabel || '/week'
      break
      
    case 'throughput':
      formattedValue = formatThroughput(numValue, precision)
      formattedUnit = denominatorLabel || '/day'
      break
      
    default:
      formattedValue = numValue.toFixed(precision)
      if (!formattedUnit) {
        formattedUnit = 'value'
      }
  }
  
  // Build final string
  let result = ''
  
  // Add label prefix if specified
  if (labelPrefix) {
    result += `${labelPrefix}: `
  }
  
  // Add formatted value
  result += formattedValue
  
  // Add unit
  if (formattedUnit) {
    result += ` ${formattedUnit}`
  }
  
  // Add comparison if specified
  if (comparisonTool) {
    const comparison = formatComparison(numValue, comparisonTool)
    if (comparison) {
      result += ` (${comparison})`
    }
  }
  
  return result.trim()
}

/**
 * Format duration values with appropriate units
 */
function formatDuration(value: number, precision: number): string {
  // Handle milliseconds to minutes/hours conversion
  if (value >= 60000) { // >= 1 minute in milliseconds
    const minutes = value / 60000
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60)
      const mins = Math.round(minutes % 60)
      return `${hours}h ${mins.toString().padStart(2, '0')}m`
    }
    return minutes.toFixed(precision)
  }
  
  // Assume value is already in minutes
  if (value >= 60) {
    const hours = Math.floor(value / 60)
    const mins = Math.round(value % 60)
    return `${hours}h ${mins.toString().padStart(2, '0')}m`
  }
  
  return value.toFixed(precision)
}

/**
 * Format percentage values
 */
function formatPercent(value: number, _precision: number): string {
  // Convert ratio to percentage if needed
  let percentValue = value
  if (value <= 1) {
    percentValue = value * 100
  }
  
  // Use 1 decimal for values < 10, whole numbers for larger
  if (Math.abs(percentValue) < 10) {
    return percentValue.toFixed(1)
  }
  return Math.round(percentValue).toString()
}

/**
 * Format ratio values
 */
function formatRatio(value: number, precision: number): string {
  return value.toFixed(precision)
}

/**
 * Format count values
 */
function formatCount(value: number, precision: number): string {
  // Use whole numbers for counts unless decimal precision is explicitly needed
  if (precision === 0 || Number.isInteger(value)) {
    return Math.round(value).toString()
  }
  return value.toFixed(precision)
}

/**
 * Format score values with optional range
 */
function formatScore(value: number, precision: number, range?: string): string {
  const formatted = value.toFixed(precision)
  return range ? `${formatted} (${range})` : formatted
}

/**
 * Format bytes values
 */
function formatBytes(value: number, precision: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  
  return `${size.toFixed(precision)}`
}

/**
 * Format rate values
 */
function formatRate(value: number, precision: number): string {
  return value.toFixed(precision)
}

/**
 * Format deploy frequency values (deploys per week)
 */
function formatDeployFrequency(value: number, precision: number): string {
  // Use 1 decimal for frequency to avoid raw floats like 42.85714285714285
  return value.toFixed(precision)
}

/**
 * Format throughput values (items per day/week)
 */
function formatThroughput(value: number, precision: number): string {
  // Use 1 decimal for throughput to avoid raw floats
  return value.toFixed(precision)
}

/**
 * Infer duration unit based on value magnitude
 */
function inferDurationUnit(value: number): string {
  if (value >= 60000) { // milliseconds
    const minutes = value / 60000
    return minutes >= 60 ? 'hrs' : 'min'
  }
  return value >= 60 ? 'hrs' : 'min'
}

/**
 * Infer count unit based on denominator
 */
function inferCountUnit(denominator?: string): string {
  if (!denominator) return 'items'
  
  const denominatorLower = denominator.toLowerCase()
  if (denominatorLower.includes('session')) return 'sessions'
  if (denominatorLower.includes('commit')) return 'commits'
  if (denominatorLower.includes('assist')) return 'assists'
  if (denominatorLower.includes('pr') || denominatorLower.includes('pull request')) return 'PRs'
  if (denominatorLower.includes('deploy')) return 'deploys'
  if (denominatorLower.includes('week')) return '/week'
  if (denominatorLower.includes('day')) return '/day'
  if (denominatorLower.includes('hour')) return '/hour'
  
  return denominator
}

/**
 * Infer bytes unit based on value magnitude
 */
function inferBytesUnit(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  
  return units[unitIndex]
}

/**
 * Format comparison text for tool comparisons
 */
function formatComparison(_value: number, comparisonTool: string): string {
  // This would need actual comparison data - for now return placeholder
  return `vs ${comparisonTool}`
}

/**
 * Predefined metadata for common PI metrics
 */
export const PI_METADATA: Record<string, PIValueMeta> = {
  // Plan & Code PIs
  'commits-per-session': {
    kind: 'ratio',
    denominatorLabel: 'session',
    precision: 1
  },
  'active-coding-time': {
    kind: 'duration',
    unit: 'min',
    precision: 1
  },
  'ai-suggestions-accepted': {
    kind: 'ratio',
    denominatorLabel: 'session',
    precision: 1
  },
  'session-length': {
    kind: 'duration',
    unit: 'min',
    precision: 1
  },
  'time-to-first-commit': {
    kind: 'duration',
    unit: 'min',
    precision: 1,
    labelPrefix: 'TTFC'
  },
  'rework-rate': {
    kind: 'percent',
    precision: 1
  },
  'delivery-rate': {
    kind: 'ratio',
    denominatorLabel: 'session',
    precision: 1
  },
  
  // Review & Merge PIs
  'pr-review-cycles': {
    kind: 'cycles',
    precision: 0
  },
  'pr-size-risk': {
    kind: 'percent',
    precision: 1
  },
  'review-latency': {
    kind: 'duration',
    unit: 'hrs',
    precision: 1
  },
  
  // Deploy & Operate PIs
  'deployment-frequency': {
    kind: 'rate',
    denominatorLabel: 'week',
    precision: 1
  },
  'change-failure-rate': {
    kind: 'percent',
    precision: 1
  },
  'mttr': {
    kind: 'duration',
    unit: 'hrs',
    precision: 1
  },
  
  // Generic evidence fields
  'coverage': {
    kind: 'percent',
    precision: 1
  },
  'sample-size': {
    kind: 'count',
    unit: 'sessions',
    precision: 0
  },
  'confidence': {
    kind: 'score',
    range: '0-1',
    precision: 2
  }
}

/**
 * Get metadata for a PI by ID or label
 */
export function getPI_METADATA(key: string): PIValueMeta {
  return PI_METADATA[key] || {}
}
