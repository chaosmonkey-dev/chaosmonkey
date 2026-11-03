/**
 * Debug log helper - suppresses noisy logs by default
 * Only enabled when explicitly requested via environment variables
 */

const PI_DEBUG_LOGS_ENABLED =
  import.meta.env.VITE_PI_DEBUG_LOGS === 'true' ||
  import.meta.env.VITE_DEBUG_AUDIT === 'true';

export function debugLog(category: string, message: string, data?: any): void {
  if (PI_DEBUG_LOGS_ENABLED) {
    if (data !== undefined) {
      console.log(`[${category}] ${message}`, data);
    } else {
      console.log(`[${category}] ${message}`);
    }
  }
}

export function debugTrace(category: string, message: string, data?: any): void {
  if (PI_DEBUG_LOGS_ENABLED) {
    if (data !== undefined) {
      console.trace(`[${category}] ${message}`, data);
    } else {
      console.trace(`[${category}] ${message}`);
    }
  }
}

export function debugGroup(category: string, message: string, fn: () => void): void {
  if (PI_DEBUG_LOGS_ENABLED) {
    console.group(`[${category}] ${message}`);
    fn();
    console.groupEnd();
  }
}

// Specific debug helpers for different log categories
export const canonicalPiTrace = (message: string, data?: any) => debugLog('CANONICAL_PI_TRACE', message, data);
export const piTrace = (message: string, data?: any) => debugLog('PI_TRACE', message, data);
export const customHideDebug = (message: string, data?: any) => debugLog('CUSTOM_HIDE_DEBUG', message, data);
export const uiRenderTrace = (message: string, data?: any) => debugLog('UI_RENDER_TRACE', message, data);
export const piInsightsWatch = (message: string, data?: any) => debugLog('PI_INSIGHTS_WATCH', message, data);
export const piCacheWrite = (message: string, data?: any) => debugLog('PI_CACHE_WRITE', message, data);
export const raceLog = (message: string, data?: any) => debugLog('RACE', message, data);
export const piDebug = (message: string, data?: any) => debugLog('PI_DEBUG', message, data);
export const cmPerf = (message: string, data?: any) => debugLog('CM_PERF', message, data);

