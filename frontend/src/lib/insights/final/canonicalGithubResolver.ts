/**
 * CR-X 3D.4A — Canonical GitHub input resolver for PI.
 *
 * Pure helper extracted from Dashboards.refreshPI so the canonical GitHub
 * evidence path is testable without DOM/browser mounting.
 *
 * CONTRACT:
 *   - Fresh authenticated GitHub snapshot eligible → use it
 *   - Fresh authenticated GitHub snapshot unavailable/ineligible → FAIL CLOSED
 *     (githubSnapshot = null, githubByPeriod = [])
 *   - NEVER silently substitute a potentially stale githubStore.rawResponse
 *     as current canonical PI GitHub evidence
 *
 * When this resolver returns null/empty, the downstream PI generators
 * (reviewMerge, deployOperate, unitEconomics) naturally produce no
 * GitHub-derived findings via their existing evidence gates
 * (input.githubSnapshot || {} → no data sources → return null).
 *
 * Telemetry-only findings are unaffected because they consume sessionRows,
 * not githubSnapshot.
 */
import { isGithubEvidenceEligibleCombined } from './dataAccess'

export interface CanonicalGithubResolution {
  /** The github snapshot to pass into CanonicalInsightInput.githubSnapshot, or null. */
  githubSnapshot: any | null
  /** The githubByPeriod array to pass into CanonicalInsightInput.githubByPeriod. */
  githubByPeriod: any[]
  /** Whether the fresh snapshot was eligible and used. */
  freshEligible: boolean
  /** Human-readable reason for the resolution outcome. */
  reason: string
}

/**
 * Map raw github_by_period entries to engineering-output-by-granularity points.
 * Accepts an optional mapper function so the resolver stays pure and testable
 * without importing the Vue-dependent mapper.
 *
 * If no mapper is provided, returns the raw array (suitable for tests that
 * construct pre-mapped data).
 */
export function resolveCanonicalGithubInput(
  freshGithubSnapshot: any | null | undefined,
  options?: {
    /** Optional mapper to transform github_by_period into granularity points. */
    mapByPeriod?: (byPeriod: any[], granularity: string) => any[]
    /** Granularity for the mapper (default 'week'). */
    granularity?: string
  }
): CanonicalGithubResolution {
  const granularity = options?.granularity ?? 'week'
  const mapper = options?.mapByPeriod

  // ─── Fresh eligible → use it ───────────────────────────────────
  if (freshGithubSnapshot && isGithubEvidenceEligibleCombined(freshGithubSnapshot)) {
    let githubByPeriod: any[] = []
    if (
      Array.isArray(freshGithubSnapshot.github_by_period) &&
      freshGithubSnapshot.github_by_period.length >= 2
    ) {
      githubByPeriod = mapper
        ? mapper(freshGithubSnapshot.github_by_period, granularity)
        : freshGithubSnapshot.github_by_period
    }
    return {
      githubSnapshot: freshGithubSnapshot,
      githubByPeriod,
      freshEligible: true,
      reason: 'fresh-eligible',
    }
  }

  // ─── Fresh unavailable/ineligible → FAIL CLOSED ───────────────
  // Do NOT fall back to githubStore.rawResponse (stale LKG).
  // GitHub-derived PI findings become unavailable/empty via existing
  // generator evidence gates. Telemetry-only findings continue normally.
  return {
    githubSnapshot: null,
    githubByPeriod: [],
    freshEligible: false,
    reason: freshGithubSnapshot ? 'fresh-ineligible' : 'fresh-unavailable',
  }
}
