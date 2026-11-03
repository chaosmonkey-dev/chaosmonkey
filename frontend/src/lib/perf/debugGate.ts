/**
 * 🔍 DEV-ONLY Debug Gate Utility
 * 
 * Controls hot-path debug logs that can impact performance.
 * Tree-shakeable and disabled in production builds.
 * 
 * Usage:
 *   import { isDebugEnabled } from '../lib/perf/debugGate'
 *   if (isDebugEnabled('STRIP')) console.log('🔥 [STRIP DEBUG] ...')
 * 
 * Enable in console:
 *   window.__CM_DEBUG__ = true                    // Enable all
 *   window.__CM_DEBUG_SCOPES__ = {STRIP: true}    // Enable specific scope
 */

// DEV-only guard - entire module tree-shakes out in production
const DEV_ENABLED = (import.meta as any).env?.DEV || import.meta.env.DEV

// Global debug flag
const GLOBAL_DEBUG_ENABLED = DEV_ENABLED && 
  typeof window !== 'undefined' && 
  (window as any).__CM_DEBUG__ === true

// Scope-specific debug flags
const SCOPE_DEBUG_ENABLED = DEV_ENABLED && 
  typeof window !== 'undefined' && 
  (window as any).__CM_DEBUG_SCOPES__

/**
 * Check if debugging is enabled globally or for a specific scope
 * @param scope Optional scope name (e.g., 'STRIP', 'PI', 'FORMAT')
 * @returns boolean - true if debug is enabled for the scope
 */
export function isDebugEnabled(scope?: string): boolean {
  if (!DEV_ENABLED) return false
  
  // Global debug flag enables everything
  if (GLOBAL_DEBUG_ENABLED) return true
  
  // Scope-specific debugging
  if (scope && SCOPE_DEBUG_ENABLED) {
    return (window as any).__CM_DEBUG_SCOPES__[scope] === true
  }
  
  // Default: disabled
  return false
}

/**
 * Check if CM PI debug is enabled via global flag
 * This gates verbose Performance Insights logs to reduce console noise
 * @returns boolean - true if CM_PI_DEBUG is enabled
 */
export function isCMPIDebugEnabled(): boolean {
  return DEV_ENABLED && 
    typeof window !== 'undefined' && 
    (window as any).CM_PI_DEBUG === true
}

/**
 * Debug logging helper that includes scope check
 * @param scope Debug scope name
 * @param args Arguments to pass to console.log
 */
export function debugLog(scope: string, ...args: any[]): void {
  if (isDebugEnabled(scope)) {
    console.log(...args)
  }
}

/**
 * Type for debug scopes
 */
export type DebugScope = 'STRIP' | 'PI' | 'FORMAT' | 'HARNESS' | 'GENERAL'
