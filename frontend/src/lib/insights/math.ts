/**
 * Mathematical utilities for insights calculations
 * 
 * Provides safe mathematical operations for analyzing performance data
 * with proper null/zero handling and statistical calculations.
 */

/**
 * Calculate percentage delta with safe division and null handling
 * @param curr - Current value
 * @param prev - Previous value (baseline)
 * @returns Percentage change or null if calculation not possible
 */
export function safePctDelta(curr?: number, prev?: number): number | null {
  // Guard against null/undefined values
  if (curr === null || curr === undefined || prev === null || prev === undefined) {
    return null
  }
  
  // Guard against zero baseline (division by zero)
  if (prev === 0) {
    return null
  }
  
  // Calculate percentage change: (current - previous) / previous * 100
  const delta = ((curr - prev) / prev) * 100
  
  // Return null for invalid results (NaN, Infinity)
  if (!isFinite(delta)) {
    return null
  }
  
  return delta
}

/**
 * Calculate moving average over k periods
 * @param points - Array of numeric values
 * @param k - Number of periods to average
 * @returns Moving average or null if insufficient data
 */
export function movingAvg(points: number[], k: number): number | null {
  if (!Array.isArray(points) || points.length < k || k <= 0) {
    return null
  }
  
  // Take the last k points
  const recentPoints = points.slice(-k)
  
  // Filter out null/undefined values
  const validPoints = recentPoints.filter(p => p !== null && p !== undefined && isFinite(p))
  
  if (validPoints.length === 0) {
    return null
  }
  
  // Calculate average
  const sum = validPoints.reduce((acc, val) => acc + val, 0)
  return sum / validPoints.length
}

/**
 * Calculate z-score for a value relative to an array
 * @param value - Value to calculate z-score for
 * @param arr - Array of values to compare against
 * @returns Z-score or null if calculation not possible
 */
export function zScore(value: number, arr: number[]): number | null {
  if (!Array.isArray(arr) || arr.length === 0) {
    return null
  }
  
  // Filter valid numbers
  const validValues = arr.filter(v => v !== null && v !== undefined && isFinite(v))
  
  if (validValues.length === 0) {
    return null
  }
  
  // Calculate mean
  const mean = validValues.reduce((sum, val) => sum + val, 0) / validValues.length
  
  // Calculate standard deviation
  const variance = validValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / validValues.length
  const stdDev = Math.sqrt(variance)
  
  // Guard against zero standard deviation
  if (stdDev === 0) {
    return null
  }
  
  // Calculate z-score: (value - mean) / standard_deviation
  return (value - mean) / stdDev
}

/**
 * Clamp a number between min and max values
 * @param n - Number to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped number
 */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

/**
 * Round a number to 2 decimal places
 * @param n - Number to round
 * @returns Rounded number
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}






