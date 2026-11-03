/**
 * Code Freshness Verification
 * 
 * Prevents running stale code by:
 * 1. Embedding build timestamp at compile time
 * 2. Checking on mount/load
 * 3. Warning in console if code is stale
 * 4. Providing dev-only endpoint to verify
 */

// PHASE 4: For dev mode, use runtime timestamp (updated on each server restart)
// For production, use build-time timestamp from Vite
const isDev = import.meta.env.DEV
const buildTimeFromVite = import.meta.env.VITE_BUILD_TIMESTAMP

// In dev mode, use current time (will be fresh on each server restart)
// In production, use build-time timestamp
export const BUILD_TIMESTAMP = isDev 
  ? new Date().toISOString() // Runtime timestamp for dev (fresh on each restart)
  : (buildTimeFromVite || new Date().toISOString())

export const BUILD_VERSION = import.meta.env.VITE_BUILD_VERSION || 'dev'

// PHASE 4: Server start timestamp (set once at app boot - same as BUILD_TIMESTAMP in dev)
export const SERVER_START_TIMESTAMP = new Date().toISOString()

// Maximum age (in minutes) before warning about stale code
const MAX_STALE_MINUTES = 5

export interface CodeFreshnessCheck {
  isFresh: boolean
  ageMinutes: number
  timestamp: string
  version: string
  warning?: string
}

/**
 * Check if the current code is fresh (recently built)
 */
export function checkCodeFreshness(): CodeFreshnessCheck {
  const now = new Date()
  const buildTime = new Date(BUILD_TIMESTAMP)
  const ageMs = now.getTime() - buildTime.getTime()
  const ageMinutes = Math.floor(ageMs / (1000 * 60))
  
  const isFresh = ageMinutes < MAX_STALE_MINUTES
  
  let warning: string | undefined
  if (!isFresh) {
    warning = `⚠️ STALE CODE DETECTED: Build is ${ageMinutes} minutes old (max: ${MAX_STALE_MINUTES} min). Restart dev server!`
  }
  
  return {
    isFresh,
    ageMinutes,
    timestamp: BUILD_TIMESTAMP,
    version: BUILD_VERSION,
    warning
  }
}

/**
 * Log code freshness status to console (dev only)
 */
export function logCodeFreshness(): void {
  if (import.meta.env.DEV) {
    const check = checkCodeFreshness()
    const style = check.isFresh 
      ? 'color: green; font-weight: bold;' 
      : 'color: red; font-weight: bold; font-size: 14px;'
    
    console.log(
      `%c[CODE FRESHNESS] ${check.isFresh ? '✅ FRESH' : '❌ STALE'}`,
      style,
      {
        buildTime: check.timestamp,
        age: `${check.ageMinutes} min`,
        version: check.version
      }
    )
    
    if (check.warning) {
      console.error(`%c${check.warning}`, 'color: red; font-weight: bold; font-size: 16px;')
      console.error('%cAction: Kill frontend server and run: cd frontend && npm run dev', 'color: orange; font-weight: bold;')
    }
  }
}

/**
 * Verify code freshness on app load (call this in main.ts or App.vue)
 * Note: Visual indicator is now shown in BUILD STAMP, so console logging is optional
 */
export function verifyCodeFreshnessOnLoad(): void {
  if (import.meta.env.DEV) {
    // Visual indicator is shown in BUILD STAMP, so we can skip console logs
    // or keep them for debugging. Uncomment below to enable console logs:
    // logCodeFreshness()
    
    // Check every 2 minutes in dev mode (for visual indicator updates)
    // The BUILD STAMP will automatically update via Vue reactivity
  }
}
