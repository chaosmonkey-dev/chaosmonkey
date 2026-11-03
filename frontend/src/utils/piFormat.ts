/**
 * PI Row Formatting Utilities
 * 
 * Minimal, non-invasive formatting helpers for Performance Insights display
 * Ensures consistent units and labels across all PI rows and evidence
 */

/**
 * Format a percentage with proper labeling
 * @param value - Number or null/undefined
 * @param label - Optional label (defaults to empty)
 * @returns Formatted string like "37%" or "Focus: 37%"
 */
export function formatPercent(value: number | null | undefined, label: string = ''): string {
  if (value == null || !Number.isFinite(value)) {
    return 'Insufficient data'
  }
  
  const formatted = `${Math.round(value)}%`
  return label ? `${label}: ${formatted}` : formatted
}

/**
 * Format minutes with proper labeling and hour conversion
 * @param value - Number of minutes or null/undefined
 * @param label - Optional label (defaults to empty)
 * @returns Formatted string like "16 min", "1 hr 15 min", or "TTFC: 15.7 min"
 */
export function formatMinutes(value: number | null | undefined, label: string = ''): string {
  if (value == null || !Number.isFinite(value)) {
    return 'Insufficient data'
  }
  
  let formatted: string
  if (value >= 60) {
    const hours = Math.floor(value / 60)
    const minutes = Math.round(value % 60)
    if (minutes === 0) {
      formatted = `${hours} hr`
    } else {
      formatted = `${hours} hr ${minutes} min`
    }
  } else {
    // Keep decimal for values < 60 that have precision
    formatted = value % 1 === 0 ? `${Math.round(value)} min` : `${value.toFixed(1)} min`
  }
  
  return label ? `${label}: ${formatted}` : formatted
}

/**
 * Format a number with a unit label
 * @param value - Number or null/undefined
 * @param unit - Unit string (e.g., "sessions", "points", "cycles")
 * @param label - Optional label (defaults to empty)
 * @param decimals - Number of decimal places (defaults to 1 for values < 10, 0 otherwise)
 * @returns Formatted string like "200 sessions" or "Current: 1.2×"
 */
export function formatNumberWithUnit(
  value: number | null | undefined, 
  unit: string, 
  label: string = '',
  decimals?: number
): string {
  if (value == null || !Number.isFinite(value)) {
    return 'Insufficient data'
  }
  
  // Auto-determine decimals if not specified
  if (decimals === undefined) {
    decimals = Math.abs(value) < 10 && value % 1 !== 0 ? 1 : 0
  }
  
  const formatted = `${decimals > 0 ? value.toFixed(decimals) : Math.round(value)} ${unit}`
  return label ? `${label}: ${formatted}` : formatted
}

/**
 * Format a ratio with proper labeling
 * @param value - Number or null/undefined
 * @param label - Optional label (defaults to empty)
 * @returns Formatted string like "1.2×" or "Ratio: 1.2×"
 */
export function formatRatio(value: number | null | undefined, label: string = ''): string {
  if (value == null || !Number.isFinite(value)) {
    return 'Insufficient data'
  }
  
  const formatted = `${value.toFixed(1)}×`
  return label ? `${label}: ${formatted}` : formatted
}

/**
 * Generic fallback formatter for insufficient data
 * @param value - Any value to check
 * @returns "Insufficient data" if null/undefined/NaN, otherwise string representation
 */
export function formatFallback(value: any): string {
  if (value == null || !Number.isFinite(value)) {
    return 'Insufficient data'
  }
  return String(value)
}

/**
 * Detect metric type from PI metadata and apply appropriate formatter
 * @param value - The numeric value to format
 * @param metricType - Optional metric type hint
 * @param label - Optional label
 * @returns Formatted string with appropriate units
 */
export function formatPIValue(
  value: number | null | undefined,
  metricType?: string,
  label: string = ''
): string {
  // Auto-detect metric type from common patterns
  if (metricType) {
    const lowerType = metricType.toLowerCase()
    if (lowerType.includes('percent') || lowerType.includes('%') || lowerType.includes('rate')) {
      return formatPercent(value, label)
    }
    if (lowerType.includes('minute') || lowerType.includes('min') || lowerType.includes('duration') || lowerType.includes('time')) {
      return formatMinutes(value, label)
    }
    if (lowerType.includes('ratio') || lowerType.includes('×') || lowerType.includes('x')) {
      return formatRatio(value, label)
    }
    if (lowerType.includes('session') || lowerType.includes('count')) {
      return formatNumberWithUnit(value, 'sessions', label)
    }
    if (lowerType.includes('point') || lowerType.includes('score')) {
      return formatNumberWithUnit(value, 'points', label)
    }
    if (lowerType.includes('cycle')) {
      return formatNumberWithUnit(value, 'cycles', label)
    }
  }
  
  // Fallback: try to infer from value characteristics
  if (value == null || !Number.isFinite(value)) {
    return 'Insufficient data'
  }
  
  // If value looks like a percentage (0-100)
  if (value >= 0 && value <= 100 && (value % 1 !== 0 || value.toString().includes('.'))) {
    return formatPercent(value, label)
  }
  
  // If value is small and decimal, likely a ratio
  if (Math.abs(value) < 10 && value % 1 !== 0) {
    return formatRatio(value, label)
  }
  
  // Default to number with appropriate unit detection
  return formatNumberWithUnit(value, '', label)
}
