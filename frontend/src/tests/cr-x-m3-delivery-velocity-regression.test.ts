/**
 * CR-X M3 Regression: deployment-frequency computation truth.
 *
 * Behavior-level regression for generateDeliveryVelocityByWorkflow exercising
 * the actual generator/output contract with authoritative-shaped GitHub
 * deployment evidence (real provenance, nonzero measured deployments).
 *
 * CR-X R1.1: Partial by_ide MUST FAIL CLOSED. A workflow entry may appear
 * in breakdownByTool ONLY when its cycle_time_days AND a per-workflow
 * sample count are directly present. Missing per-workflow data = OMIT
 * that workflow (not org-level fallback). A workflow comparison requires
 * >=2 directly observed workflow values.
 *
 * Proves:
 *  1. cycle_time_days is treated as a DURATION (days per deployment), not a
 *     frequency. Conversion to weekly frequency is 7 / cycle_time_days:
 *       1 day  -> 7   deployments/week
 *       2 days -> 3.5 deployments/week
 *       7 days -> 1   deployment/week
 *  2. Higher deployments/week wins (descending sort).
 *  3. winner/runner-up ordering is correct.
 *  4. "X% faster" delta is positive and computed as
 *     (winner - runnerUp) / runnerUp.
 *  5. Absent by_ide omits breakdownByTool entirely (org-level stays org-level).
 *  6. Partial by_ide (missing cycle_time_days for one workflow) omits that
 *     workflow — no org-level fallback.
 *  7. Partial by_ide (missing count for one workflow) omits that workflow.
 *  8. Fewer than 2 qualifying workflows omits breakdownByTool entirely.
 *
 * No production source is altered by this test.
 */
import { describe, it, expect } from 'vitest'
import { generateDeliveryVelocityByWorkflow } from '../lib/insights/final/generators/deployOperate'
import { formatPct, formatFrequency } from '../lib/insights/final/utils/formatHelpers'
import { getCanonicalWorkflowIdentity } from '../lib/workflowIdentity'

/**
 * Build a CanonicalInsightInput with authoritative GitHub provenance so the
 * generator's provenance gate (hasAuthoritativeGithubEvidence) admits the
 * evidence. Mirrors the real backend snapshot shape: github_provenance with
 * historical_data_available + db_data_available, a non-ineligible data source,
 * and nonzero measured deployment counts.
 */
function makeInput(opts: {
  successDeployments?: number
  failedDeployments?: number
  windowWeeks?: number
  byIde?: Record<string, { cycle_time_days?: number; count?: number }> | null
  sessionRows?: any[]
}): any {
  const success = opts.successDeployments ?? 40
  const failed = opts.failedDeployments ?? 0
  const weeks = opts.windowWeeks ?? 4
  const githubSnapshot: any = {
    github_data_source: 'github_oauth',
    github_provenance: {
      source: 'github_oauth',
      historical_data_available: true,
      db_data_available: true,
      live_fetch_ok: false,
      generated_fallback_used: false,
    },
    deployment_metrics: {
      success_deployment_count: success,
      failed_deployment_count: failed,
      change_failure_rate: 0,
    },
  }
  if (opts.byIde !== undefined) {
    if (opts.byIde === null) {
      // intentionally omit by_ide entirely
    } else {
      githubSnapshot.deployment_metrics.by_ide = opts.byIde
    }
  }
  return {
    sessionRows: opts.sessionRows ?? [],
    githubSnapshot,
    githubByPeriod: new Array(weeks).fill({}),
    granularity: 'week' as const,
  }
}

describe('CR-X M3: generateDeliveryVelocityByWorkflow deployment-frequency truth', () => {
  it('treats cycle_time_days as a duration and converts to weekly frequency (7/days)', () => {
    const input = makeInput({
      successDeployments: 40,
      windowWeeks: 4,
      byIde: {
        cursor: { cycle_time_days: 1, count: 20 },   // 7/1 = 7
        windsurf: { cycle_time_days: 2, count: 15 }, // 7/2 = 3.5
        vscode: { cycle_time_days: 7, count: 15 },   // 7/7 = 1
      },
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    const b = out!.breakdownByTool!
    // Duration -> frequency: 7 / cycle_time_days
    expect(b.cursor.value).toBeCloseTo(7, 10)
    expect(b.windsurf.value).toBeCloseTo(3.5, 10)
    expect(b.vscode.value).toBeCloseTo(1, 10)
    // Sanity: a SHORTER cycle (1 day) yields a HIGHER frequency, proving
    // the field is interpreted as duration, not frequency.
    expect(b.cursor.value).toBeGreaterThan(b.windsurf.value)
    expect(b.windsurf.value).toBeGreaterThan(b.vscode.value)
  })

  it('higher deployments/week wins and winner/runner-up ordering is correct', () => {
    const input = makeInput({
      successDeployments: 40,
      windowWeeks: 4,
      byIde: {
        cursor: { cycle_time_days: 1, count: 20 },   // 7/week (highest)
        windsurf: { cycle_time_days: 2, count: 15 }, // 3.5/week (runner-up)
        vscode: { cycle_time_days: 7, count: 15 },   // 1/week
      },
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    const what = out!.whatChanged
    // Winner (Cursor) appears before runner-up (Windsurf -> "Devin workflow")
    const winnerLabel = getCanonicalWorkflowIdentity('cursor')
    const runnerUpLabel = getCanonicalWorkflowIdentity('windsurf')
    expect(what).toContain(winnerLabel)
    expect(what).toContain(runnerUpLabel)
    expect(what.indexOf(winnerLabel)).toBeLessThan(what.indexOf(runnerUpLabel))
    // Winner value formatted appears before runner-up value
    expect(what).toContain(formatFrequency(7))
    expect(what).toContain(formatFrequency(3.5))
  })

  it('"X% faster" delta is positive and computed as (winner - runnerUp) / runnerUp', () => {
    const input = makeInput({
      successDeployments: 40,
      windowWeeks: 4,
      byIde: {
        cursor: { cycle_time_days: 1, count: 20 },   // 7/week
        windsurf: { cycle_time_days: 2, count: 15 }, // 3.5/week
        vscode: { cycle_time_days: 7, count: 15 },   // 1/week
      },
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    const winner = 7
    const runnerUp = 3.5
    const expectedDeltaPct = ((winner - runnerUp) / runnerUp) * 100 // 100%
    expect(expectedDeltaPct).toBeGreaterThan(0)
    expect(out!.whatChanged).toContain(formatPct(expectedDeltaPct))
    expect(out!.whatChanged).toContain('faster')
    // The delta must be positive (winner > runnerUp)
    expect(winner).toBeGreaterThan(runnerUp)
  })

  it('absent by_ide omits breakdownByTool entirely (org-level stays org-level)', () => {
    // Org-level weekly frequency = totalDeployments / windowWeeks = 40 / 4 = 10/week
    const orgWeekly = 40 / 4
    const input = makeInput({
      successDeployments: 40,
      windowWeeks: 4,
      byIde: null,
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    expect(out!.current).toBeCloseTo(orgWeekly, 10)
    // CR-X R1: No synthetic per-workflow bars when by_ide is absent.
    expect(out!.breakdownByTool).toBeUndefined()
    expect(out!.attributionStatus).toBe('org_level_only')
  })

  it('partial by_ide: missing cycle_time_days omits that workflow (no org fallback)', () => {
    // CR-X R1.1: A workflow missing cycle_time_days MUST NOT receive the
    // org-level velocity. It is omitted from the breakdown entirely.
    const orgWeekly = 40 / 4
    const input = makeInput({
      successDeployments: 40,
      windowWeeks: 4,
      byIde: {
        cursor: { cycle_time_days: 1, count: 20 },   // 7/week
        windsurf: { count: 15 },                     // missing cycle_time_days → omitted
        vscode: { cycle_time_days: 7, count: 15 },   // 1/week
      },
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(Object.keys(out!.breakdownByTool!).sort()).toEqual(['cursor', 'vscode'])
    expect(out!.breakdownByTool!.cursor.value).toBeCloseTo(7, 10)
    expect(out!.breakdownByTool!.vscode.value).toBeCloseTo(1, 10)
    // Windsurf must NOT appear and must NOT have received org-level velocity
    expect(out!.breakdownByTool!.windsurf).toBeUndefined()
    for (const key of Object.keys(out!.breakdownByTool!)) {
      expect(out!.breakdownByTool![key].value).not.toBeCloseTo(orgWeekly, 5)
    }
  })

  it('partial by_ide: missing count omits that workflow (fail closed)', () => {
    // CR-X R1.1: A workflow missing count cannot be represented truthfully
    // in ToolBreakdown (count is required). It is omitted.
    const input = makeInput({
      successDeployments: 40,
      windowWeeks: 4,
      byIde: {
        cursor: { cycle_time_days: 1, count: 20 },
        windsurf: { cycle_time_days: 2 },             // missing count → omitted
        vscode: { cycle_time_days: 7, count: 15 },
      },
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(Object.keys(out!.breakdownByTool!).sort()).toEqual(['cursor', 'vscode'])
    expect(out!.breakdownByTool!.windsurf).toBeUndefined()
  })

  it('fewer than 2 qualifying workflows omits breakdownByTool entirely', () => {
    // Only 1 workflow has both cycle_time_days and count → no comparison
    const input = makeInput({
      successDeployments: 40,
      windowWeeks: 4,
      byIde: {
        cursor: { cycle_time_days: 1, count: 20 },
        windsurf: { cycle_time_days: 2 },             // missing count → omitted
        vscode: { count: 15 },                        // missing cycle_time_days → omitted
      },
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeUndefined()
    expect(out!.attributionStatus).toBe('org_level_only')
  })

  it('returns null without authoritative GitHub deployment evidence', () => {
    // No provenance -> provenance gate fails closed.
    const input: any = {
      sessionRows: new Array(50).fill({}),
      githubSnapshot: { deployment_metrics: { success_deployment_count: 10 } },
      githubByPeriod: [{}],
      granularity: 'week',
    }
    expect(generateDeliveryVelocityByWorkflow(input)).toBeNull()
  })
})
