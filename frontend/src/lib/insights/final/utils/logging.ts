/**
 * PI Debug Logging Utility
 * 
 * Gates noisy Performance Insights debug logs behind VITE_PI_DEBUG === 'true'
 * Prevents console flooding in production pilot dashboard.
 */

const PI_DEBUG_ENABLED = typeof import.meta !== 'undefined' && import.meta.env?.VITE_PI_DEBUG === 'true';

/**
 * Log only when VITE_PI_DEBUG === 'true'
 * Use for noisy trace/diagnostic logs that should not appear in production
 */
export function piDebugLog(...args: any[]): void {
  if (PI_DEBUG_ENABLED) {
    console.log(...args);
  }
}

/**
 * Log only when VITE_PI_DEBUG === 'true'
 * Use for noisy trace/diagnostic logs that should not appear in production
 */
export function piDebugInfo(...args: any[]): void {
  if (PI_DEBUG_ENABLED) {
    console.info(...args);
  }
}

/**
 * Log only when VITE_PI_DEBUG === 'true'
 * Use for noisy trace/diagnostic logs that should not appear in production
 */
export function piDebugWarn(...args: any[]): void {
  if (PI_DEBUG_ENABLED) {
    console.warn(...args);
  }
}

/**
 * Always log - use for real errors that represent actual product failure
 * This is NOT gated and should be used for production-critical issues
 */
export function piErrorLog(...args: any[]): void {
  console.error(...args);
}

/**
 * Check if PI debug logging is enabled
 */
export function isPiDebugEnabled(): boolean {
  return PI_DEBUG_ENABLED;
}
