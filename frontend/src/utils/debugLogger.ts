/**
 * Centralized Debug Logging Helper
 * 
 * All debug logging must go through this helper to ensure
 * console silence by default for pilot readiness.
 */

export const isDebugEnabled = (scope?: string): boolean => {
  // Only allow debug in development with explicit flag
  if (!import.meta.env.DEV) return false;
  if (import.meta.env.VITE_PI_DEBUG !== 'true') return false;
  return true;
};

export const debugLog = (...args: unknown[]): void => {
  if (isDebugEnabled()) {
    console.log(...args);
  }
};

export const debugWarn = (...args: unknown[]): void => {
  if (isDebugEnabled()) {
    console.warn(...args);
  }
};

export const debugError = (...args: unknown[]): void => {
  if (isDebugEnabled()) {
    console.error(...args);
  }
};

// For true errors that should always show
export const logError = (...args: unknown[]): void => {
  console.error(...args);
};
