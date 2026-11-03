/**
 * Number Formatting Utilities for Performance Insights
 * Ensures consistent numerical and unit formatting across all insights
 */

/**
 * Format a number with consistent decimal places
 * @param value - Number to format
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted string or '--' if null/undefined
 */
export function formatNumber(value: number | null | undefined, decimals: number = 1): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return value.toFixed(decimals)
}

/**
 * Format a percentage with consistent decimal places
 * @param value - Number (0-1) or percentage (0-100)
 * @param isDecimal - If true, input is 0-1, if false, input is 0-100
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string or '--' if null/undefined
 */
export function formatPercentage(value: number | null | undefined, isDecimal: boolean = false, decimals: number = 1): string {
  if (value == null || !Number.isFinite(value)) return '--'
  const percentage = isDecimal ? value * 100 : value
  return `${percentage.toFixed(decimals)}%`
}

/**
 * Format a duration in hours with consistent decimal places
 * @param hours - Duration in hours
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted duration string or '--' if null/undefined
 */
export function formatDuration(hours: number | null | undefined, decimals: number = 1): string {
  if (hours == null || !Number.isFinite(hours)) return '--'
  return `${hours.toFixed(decimals)}h`
}

/**
 * Format a rate (per minute, per session, etc.)
 * @param value - Rate value
 * @param unit - Unit string (default: '/minute')
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted rate string or '--' if null/undefined
 */
export function formatRate(value: number | null | undefined, unit: string = '/minute', decimals: number = 1): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${value.toFixed(decimals)}${unit}`
}

/**
 * Format a correlation coefficient with standard precision
 * @param value - Correlation coefficient (-1 to 1)
 * @returns Formatted correlation string or '--' if null/undefined
 */
export function formatCorrelation(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return `r=${value.toFixed(3)}`
}

/**
 * Format statistical confidence as percentage
 * @param pValue - P-value (0-1)
 * @returns Formatted confidence string or '--' if null/undefined
 */
export function formatConfidence(pValue: number | null | undefined): string {
  if (pValue == null || !Number.isFinite(pValue)) return '--'
  const confidence = (1 - pValue) * 100
  return `${confidence.toFixed(1)}%`
}

/**
 * Format a count with consistent integer formatting
 * @param value - Count value
 * @returns Formatted count string or '--' if null/undefined
 */
export function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return Math.round(value).toString()
}

/**
 * Format a ratio with consistent decimal places
 * @param value - Ratio value
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted ratio string or '--' if null/undefined
 */
export function formatRatio(value: number | null | undefined, decimals: number = 2): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return value.toFixed(decimals)
}

/**
 * Format time with appropriate unit (h, m, s)
 * @param minutes - Duration in minutes
 * @returns Formatted time string or '--' if null/undefined
 */
export function formatTime(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '--'
  
  if (minutes >= 60) {
    const hours = minutes / 60
    return hours >= 24 ? `${(hours / 24).toFixed(1)}d` : `${hours.toFixed(1)}h`
  } else if (minutes >= 1) {
    return `${minutes.toFixed(0)}m`
  } else {
    return `${(minutes * 60).toFixed(0)}s`
  }
}

/**
 * Format duration in hours and minutes (PI canonical formatter)
 * Rules: <60m → 45m, >=60m → 2h 14m, >=24h → 1d 3h
 * @param minutes - Duration in minutes
 * @returns Formatted duration string or '--' if null/undefined
 */
export function formatDurationHoursMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '--'
  
  // Less than 60 minutes: show as minutes
  if (minutes < 60) {
    return `${Math.round(minutes)}m`
  }
  
  // 60 minutes or more: convert to hours
  const totalHours = minutes / 60
  
  // 24 hours or more: show as days + hours
  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24)
    const remainingHours = Math.round(totalHours % 24)
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
  }
  
  // Between 60 minutes and 24 hours: show as hours + minutes
  const hours = Math.floor(totalHours)
  const remainingMinutes = Math.round(minutes % 60)
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

/**
 * Format a boolean as Yes/No
 * @param value - Boolean value
 * @returns 'Yes', 'No', or '--' if null/undefined
 */
export function formatBoolean(value: boolean | null | undefined): string {
  if (value == null) return '--'
  return value ? 'Yes' : 'No'
}

/**
 * Format an impact percentage with context
 * @param percentage - Impact percentage
 * @param decimals - Number of decimal places (default: 0)
 * @returns Formatted impact string or '--' if null/undefined
 */
export function formatImpact(percentage: number | null | undefined, decimals: number = 0): string {
  if (percentage == null || !Number.isFinite(percentage)) return '--'
  const sign = percentage >= 0 ? '+' : ''
  return `${sign}${percentage.toFixed(decimals)}%`
}
