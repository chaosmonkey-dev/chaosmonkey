/**
 * CR-X R1.1: Partial by_ide MUST FAIL CLOSED.
 *
 * Proves that three active generators never copy an org-level value into a
 * per-workflow bucket when by_ide is absent, empty, or partial, and that real
 * authoritative by_ide data still renders breakdownByTool with real counts.
 *
 * Authority rule implemented:
 *   A workflow entry may appear in breakdownByTool ONLY when its specific
 *   workflow metric AND a per-workflow sample count are directly present
 *   and authoritative in the source.
 *   Missing per-workflow data = OMIT that workflow.
 *   Missing != org average. Missing != zero.
 *   A workflow comparison requires >=2 directly observed workflow values.
 *   No fabricated Math.floor(total * 0.33) sample counts.
 *
 * Backend by_ide contract trace (read-only):
 *   The current backend NEVER emits by_ide for any of the three metrics.
 *   - calculatePRReviewMetrics / calculatePRReviewMetricsFromGitHubData:
 *     flat {first_review_at, review_count, unique_reviewer_count,
 *     pr_reopened_count, total_prs}. No by_ide.
 *   - calculatePRAnalytics: flat {total_prs, merged_prs, ...}. No by_ide.
 *   - calculateDeploymentMetrics / calculateDeploymentMetricsFromGitHubData:
 *     flat {latest_deployment, failed_deployment_count, success_deployment_count,
 *     deployment_frequency, change_failure_rate, ...}. No by_ide.
 *   So in production, all three generators ALWAYS take the org-level path.
 *   The by_ide path is only exercised by test/demo fixtures.
 *
 * No production source is altered by this test beyond the R1.1 fix.
 */
import { describe, it, expect } from 'vitest'
import { generateReopenPressureSpike } from '../lib/insights/final/generators/reviewMerge'
import { generateDeliveryVelocityByWorkflow, generateDeploymentReliabilityPressure } from '../lib/insights/final/generators/deployOperate'

/**
 * Build a CanonicalInsightInput with authoritative GitHub provenance so the
 * generators' provenance gates admit the evidence.
 */
function makeAuthoritativeInput(opts: {
  githubSnapshot?: any
  githubByPeriod?: any[]
  sessionRows?: any[]
}): any {
  return {
    sessionRows: opts.sessionRows ?? [],
    githubSnapshot: opts.githubSnapshot ?? {},
    githubByPeriod: opts.githubByPeriod ?? [{}],
    granularity: 'week' as const,
  }
}

/**
 * Provenance shape that passes hasAuthoritativeGithubEvidence.
 */
function authoritativeProvenance() {
  return {
    github_data_source: 'github_oauth',
    github_provenance: {
      source: 'github_oauth',
      historical_data_available: true,
      db_data_available: true,
      live_fetch_ok: false,
      generated_fallback_used: false,
    },
  }
}

// ============================================================
// A. by_ide ABSENT → no breakdown → org_level_only
// ============================================================
describe('CR-X R1.1 A: by_ide ABSENT', () => {
  it('reopen pressure: no breakdown, org_level_only', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        pr_review_metrics: { pr_reopened_count: 5, total_prs: 50 },
      },
    })
    const out = generateReopenPressureSpike(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeUndefined()
    expect(out!.attributionStatus).toBe('org_level_only')
  })

  it('delivery velocity: no breakdown, org_level_only', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 40,
          failed_deployment_count: 0,
          change_failure_rate: 0,
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeUndefined()
    expect(out!.attributionStatus).toBe('org_level_only')
  })

  it('deployment reliability: no breakdown, org_level_only', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 30,
          failed_deployment_count: 5,
          change_failure_rate: 14.3,
          deployment_frequency: 35,
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeploymentReliabilityPressure(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeUndefined()
    expect(out!.attributionStatus).toBe('org_level_only')
  })
})

// ============================================================
// B. by_ide EMPTY OBJECT → no breakdown → org_level_only
// ============================================================
describe('CR-X R1.1 B: by_ide EMPTY OBJECT', () => {
  it('reopen pressure: no breakdown, org_level_only', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        pr_analytics: {
          total_prs: 50,
          reopened_prs: 5,
          by_ide: {},
        },
      },
    })
    const out = generateReopenPressureSpike(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeUndefined()
    expect(out!.attributionStatus).toBe('org_level_only')
  })

  it('delivery velocity: no breakdown, org_level_only', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 40,
          failed_deployment_count: 0,
          change_failure_rate: 0,
          by_ide: {},
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeUndefined()
    expect(out!.attributionStatus).toBe('org_level_only')
  })

  it('deployment reliability: no breakdown, org_level_only', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 30,
          failed_deployment_count: 5,
          change_failure_rate: 14.3,
          deployment_frequency: 35,
          by_ide: {},
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeploymentReliabilityPressure(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeUndefined()
    expect(out!.attributionStatus).toBe('org_level_only')
  })
})

// ============================================================
// C. by_ide PARTIAL, one workflow observed → no winner/runner-up
// ============================================================
describe('CR-X R1.1 C: by_ide PARTIAL (one workflow)', () => {
  it('reopen pressure: no comparative winner/runner-up, org_level_only', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        pr_analytics: {
          total_prs: 50,
          reopened_prs: 5,
          by_ide: {
            cursor: { reopen_rate: 8, count: 20 },
          },
        },
      },
    })
    const out = generateReopenPressureSpike(input)
    expect(out).not.toBeNull()
    // Only 1 qualifying workflow → no comparison, no breakdown
    expect(out!.breakdownByTool).toBeUndefined()
    expect(out!.attributionStatus).toBe('org_level_only')
  })

  it('delivery velocity: no comparative winner/runner-up, org_level_only', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 40,
          failed_deployment_count: 0,
          change_failure_rate: 0,
          by_ide: {
            cursor: { cycle_time_days: 1, count: 20 },
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeUndefined()
    expect(out!.attributionStatus).toBe('org_level_only')
  })

  it('deployment reliability: no comparative winner/runner-up, org_level_only', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 30,
          failed_deployment_count: 5,
          change_failure_rate: 14.3,
          deployment_frequency: 35,
          by_ide: {
            cursor: { weekly_frequency: 10, failure_rate: 5, count: 20 },
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeploymentReliabilityPressure(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeUndefined()
    expect(out!.attributionStatus).toBe('org_level_only')
  })
})

// ============================================================
// D. by_ide has TWO authoritative workflows → only those two participate
// ============================================================
describe('CR-X R1.1 D: by_ide TWO authoritative workflows', () => {
  it('reopen pressure: only two workflows in breakdown, missing third omitted', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        pr_analytics: {
          total_prs: 50,
          reopened_prs: 5,
          by_ide: {
            cursor: { reopen_rate: 8, count: 20 },
            windsurf: { reopen_rate: 12, count: 15 },
            // vscode missing — must NOT appear
          },
        },
      },
    })
    const out = generateReopenPressureSpike(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(Object.keys(out!.breakdownByTool!).sort()).toEqual(['cursor', 'windsurf'])
    expect(out!.breakdownByTool!.cursor.value).toBe(8)
    expect(out!.breakdownByTool!.cursor.count).toBe(20)
    expect(out!.breakdownByTool!.windsurf.value).toBe(12)
    expect(out!.breakdownByTool!.windsurf.count).toBe(15)
    expect(out!.breakdownByTool!.vscode).toBeUndefined()
    expect(out!.attributionStatus).toBe('ide_attributed')
  })

  it('delivery velocity: only two workflows in breakdown, missing third omitted', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 40,
          failed_deployment_count: 0,
          change_failure_rate: 0,
          by_ide: {
            cursor: { cycle_time_days: 1, count: 20 },   // 7/week
            windsurf: { cycle_time_days: 2, count: 15 }, // 3.5/week
            // vscode missing — must NOT appear
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(Object.keys(out!.breakdownByTool!).sort()).toEqual(['cursor', 'windsurf'])
    expect(out!.breakdownByTool!.cursor.value).toBeCloseTo(7, 5)
    expect(out!.breakdownByTool!.cursor.count).toBe(20)
    expect(out!.breakdownByTool!.windsurf.value).toBeCloseTo(3.5, 5)
    expect(out!.breakdownByTool!.windsurf.count).toBe(15)
    expect(out!.breakdownByTool!.vscode).toBeUndefined()
    expect(out!.attributionStatus).toBe('ide_attributed')
  })

  it('deployment reliability: only two workflows in breakdown, missing third omitted', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 30,
          failed_deployment_count: 5,
          change_failure_rate: 14.3,
          deployment_frequency: 35,
          by_ide: {
            cursor: { weekly_frequency: 10, failure_rate: 5, count: 20 },
            windsurf: { weekly_frequency: 8, failure_rate: 20, count: 15 },
            // vscode missing — must NOT appear
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeploymentReliabilityPressure(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(Object.keys(out!.breakdownByTool!).sort()).toEqual(['cursor', 'windsurf'])
    expect(out!.breakdownByTool!.cursor.count).toBe(20)
    expect(out!.breakdownByTool!.windsurf.count).toBe(15)
    expect(out!.breakdownByTool!.vscode).toBeUndefined()
    expect(out!.attributionStatus).toBe('ide_attributed')
  })
})

// ============================================================
// E. by_ide workflow has one required metric missing → that workflow omitted
// ============================================================
describe('CR-X R1.1 E: by_ide workflow with missing required metric', () => {
  it('reopen pressure: workflow missing reopen_rate is omitted', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        pr_analytics: {
          total_prs: 50,
          reopened_prs: 5,
          by_ide: {
            cursor: { reopen_rate: 8, count: 20 },
            windsurf: { count: 15 }, // missing reopen_rate → omitted
            vscode: { reopen_rate: 10, count: 15 },
          },
        },
      },
    })
    const out = generateReopenPressureSpike(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(Object.keys(out!.breakdownByTool!).sort()).toEqual(['cursor', 'vscode'])
    expect(out!.breakdownByTool!.windsurf).toBeUndefined()
  })

  it('reopen pressure: workflow missing count is omitted', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        pr_analytics: {
          total_prs: 50,
          reopened_prs: 5,
          by_ide: {
            cursor: { reopen_rate: 8, count: 20 },
            windsurf: { reopen_rate: 12 }, // missing count → omitted
            vscode: { reopen_rate: 10, count: 15 },
          },
        },
      },
    })
    const out = generateReopenPressureSpike(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(Object.keys(out!.breakdownByTool!).sort()).toEqual(['cursor', 'vscode'])
    expect(out!.breakdownByTool!.windsurf).toBeUndefined()
  })

  it('delivery velocity: workflow missing cycle_time_days is omitted (no org fallback)', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 40,
          failed_deployment_count: 0,
          change_failure_rate: 0,
          by_ide: {
            cursor: { cycle_time_days: 1, count: 20 },
            windsurf: { count: 15 }, // missing cycle_time_days → omitted, NOT org fallback
            vscode: { cycle_time_days: 7, count: 15 },
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(Object.keys(out!.breakdownByTool!).sort()).toEqual(['cursor', 'vscode'])
    expect(out!.breakdownByTool!.windsurf).toBeUndefined()
    // Windsurf must NOT have received the org-level velocity
    const orgWeekly = 40 / 4 // 10/week
    expect(out!.breakdownByTool!.cursor.value).toBeCloseTo(7, 5)
    expect(out!.breakdownByTool!.vscode.value).toBeCloseTo(1, 5)
    // Ensure no workflow value equals the org-level fallback
    for (const key of Object.keys(out!.breakdownByTool!)) {
      expect(out!.breakdownByTool![key].value).not.toBeCloseTo(orgWeekly, 5)
    }
  })

  it('deployment reliability: workflow missing failure_rate is omitted (no hybrid row)', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 30,
          failed_deployment_count: 5,
          change_failure_rate: 14.3,
          deployment_frequency: 35,
          by_ide: {
            cursor: { weekly_frequency: 10, failure_rate: 5, count: 20 },
            windsurf: { weekly_frequency: 8, count: 15 }, // missing failure_rate → omitted
            vscode: { weekly_frequency: 12, failure_rate: 5, count: 15 },
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeploymentReliabilityPressure(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(Object.keys(out!.breakdownByTool!).sort()).toEqual(['cursor', 'vscode'])
    expect(out!.breakdownByTool!.windsurf).toBeUndefined()
  })

  it('deployment reliability: workflow missing weekly_frequency is omitted (no hybrid row)', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 30,
          failed_deployment_count: 5,
          change_failure_rate: 14.3,
          deployment_frequency: 35,
          by_ide: {
            cursor: { weekly_frequency: 10, failure_rate: 5, count: 20 },
            windsurf: { failure_rate: 20, count: 15 }, // missing weekly_frequency → omitted
            vscode: { weekly_frequency: 12, failure_rate: 5, count: 15 },
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeploymentReliabilityPressure(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(Object.keys(out!.breakdownByTool!).sort()).toEqual(['cursor', 'vscode'])
    expect(out!.breakdownByTool!.windsurf).toBeUndefined()
  })
})

// ============================================================
// F. THREE authoritative workflows → real values preserved
// ============================================================
describe('CR-X R1.1 F: THREE authoritative workflows', () => {
  it('reopen pressure: all three workflows preserved with real values and counts', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        pr_analytics: {
          total_prs: 50,
          reopened_prs: 5,
          by_ide: {
            cursor: { reopen_rate: 8, count: 20 },
            windsurf: { reopen_rate: 12, count: 15 },
            vscode: { reopen_rate: 10, count: 15 },
          },
        },
      },
    })
    const out = generateReopenPressureSpike(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(Object.keys(out!.breakdownByTool!).sort()).toEqual(['cursor', 'vscode', 'windsurf'])
    expect(out!.breakdownByTool!.cursor.value).toBe(8)
    expect(out!.breakdownByTool!.cursor.count).toBe(20)
    expect(out!.breakdownByTool!.windsurf.value).toBe(12)
    expect(out!.breakdownByTool!.windsurf.count).toBe(15)
    expect(out!.breakdownByTool!.vscode.value).toBe(10)
    expect(out!.breakdownByTool!.vscode.count).toBe(15)
  })

  it('delivery velocity: all three workflows preserved with real values and counts', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 40,
          failed_deployment_count: 0,
          change_failure_rate: 0,
          by_ide: {
            cursor: { cycle_time_days: 1, count: 20 },   // 7/week
            windsurf: { cycle_time_days: 2, count: 15 }, // 3.5/week
            vscode: { cycle_time_days: 7, count: 15 },   // 1/week
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(Object.keys(out!.breakdownByTool!).sort()).toEqual(['cursor', 'vscode', 'windsurf'])
    expect(out!.breakdownByTool!.cursor.value).toBeCloseTo(7, 5)
    expect(out!.breakdownByTool!.cursor.count).toBe(20)
    expect(out!.breakdownByTool!.windsurf.value).toBeCloseTo(3.5, 5)
    expect(out!.breakdownByTool!.windsurf.count).toBe(15)
    expect(out!.breakdownByTool!.vscode.value).toBeCloseTo(1, 5)
    expect(out!.breakdownByTool!.vscode.count).toBe(15)
  })

  it('deployment reliability: all three workflows preserved with real values and counts', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 30,
          failed_deployment_count: 5,
          change_failure_rate: 14.3,
          deployment_frequency: 35,
          by_ide: {
            cursor: { weekly_frequency: 10, failure_rate: 5, count: 20 },
            windsurf: { weekly_frequency: 8, failure_rate: 20, count: 15 },
            vscode: { weekly_frequency: 12, failure_rate: 5, count: 15 },
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeploymentReliabilityPressure(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(Object.keys(out!.breakdownByTool!).sort()).toEqual(['cursor', 'vscode', 'windsurf'])
    expect(out!.breakdownByTool!.cursor.count).toBe(20)
    expect(out!.breakdownByTool!.windsurf.count).toBe(15)
    expect(out!.breakdownByTool!.vscode.count).toBe(15)
  })
})

// ============================================================
// G. SAMPLE COUNTS — no Math.floor percentage allocation remains
// ============================================================
describe('CR-X R1.1 G: no fabricated sample counts', () => {
  it('reopen pressure: counts come from source, not Math.floor(total * 0.33)', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        pr_analytics: {
          total_prs: 50,
          reopened_prs: 5,
          by_ide: {
            cursor: { reopen_rate: 8, count: 20 },
            windsurf: { reopen_rate: 12, count: 15 },
            vscode: { reopen_rate: 10, count: 15 },
          },
        },
      },
    })
    const out = generateReopenPressureSpike(input)
    expect(out).not.toBeNull()
    const b = out!.breakdownByTool!
    // Math.floor(50 * 0.33) = 16, Math.floor(50 * 0.34) = 17
    // Real counts are 20, 15, 15 — none should be 16 or 17
    expect(b.cursor.count).toBe(20)
    expect(b.windsurf.count).toBe(15)
    expect(b.vscode.count).toBe(15)
    expect(b.cursor.count).not.toBe(16)
    expect(b.windsurf.count).not.toBe(16)
    expect(b.vscode.count).not.toBe(17)
  })

  it('delivery velocity: counts come from source, not Math.floor(total * 0.33)', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 40,
          failed_deployment_count: 0,
          change_failure_rate: 0,
          by_ide: {
            cursor: { cycle_time_days: 1, count: 20 },
            windsurf: { cycle_time_days: 2, count: 15 },
            vscode: { cycle_time_days: 7, count: 15 },
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    const b = out!.breakdownByTool!
    // Math.floor(40 * 0.33) = 13, Math.floor(40 * 0.34) = 13
    // Real counts are 20, 15, 15 — none should be 13
    expect(b.cursor.count).toBe(20)
    expect(b.windsurf.count).toBe(15)
    expect(b.vscode.count).toBe(15)
    expect(b.cursor.count).not.toBe(13)
    expect(b.windsurf.count).not.toBe(13)
    expect(b.vscode.count).not.toBe(13)
  })

  it('deployment reliability: counts come from source, not Math.floor(total * 0.33)', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 30,
          failed_deployment_count: 5,
          change_failure_rate: 14.3,
          deployment_frequency: 35,
          by_ide: {
            cursor: { weekly_frequency: 10, failure_rate: 5, count: 20 },
            windsurf: { weekly_frequency: 8, failure_rate: 20, count: 15 },
            vscode: { weekly_frequency: 12, failure_rate: 5, count: 15 },
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeploymentReliabilityPressure(input)
    expect(out).not.toBeNull()
    const b = out!.breakdownByTool!
    // Math.floor(35 * 0.33) = 11, Math.floor(35 * 0.34) = 11
    // Real counts are 20, 15, 15 — none should be 11
    expect(b.cursor.count).toBe(20)
    expect(b.windsurf.count).toBe(15)
    expect(b.vscode.count).toBe(15)
    expect(b.cursor.count).not.toBe(11)
    expect(b.windsurf.count).not.toBe(11)
    expect(b.vscode.count).not.toBe(11)
  })

  it('reopen pressure: no breakdown when source provides no counts (fail closed)', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        pr_analytics: {
          total_prs: 50,
          reopened_prs: 5,
          by_ide: {
            cursor: { reopen_rate: 8 }, // no count
            windsurf: { reopen_rate: 12 }, // no count
            vscode: { reopen_rate: 10 }, // no count
          },
        },
      },
    })
    const out = generateReopenPressureSpike(input)
    expect(out).not.toBeNull()
    // No authoritative count → fail closed
    expect(out!.breakdownByTool).toBeUndefined()
    expect(out!.attributionStatus).toBe('org_level_only')
  })
})

// ============================================================
// H. CLAUDE CODE — not required, not fabricated
// ============================================================
describe('CR-X R1.1 H: Claude Code not fabricated', () => {
  it('reopen pressure: claude_code absent from breakdown when not in source', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        pr_analytics: {
          total_prs: 50,
          reopened_prs: 5,
          by_ide: {
            cursor: { reopen_rate: 8, count: 20 },
            windsurf: { reopen_rate: 12, count: 15 },
          },
        },
      },
    })
    const out = generateReopenPressureSpike(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(out!.breakdownByTool!.claude_code).toBeUndefined()
    expect(out!.breakdownByTool!.cursor).toBeDefined()
    expect(out!.breakdownByTool!.windsurf).toBeDefined()
  })

  it('delivery velocity: claude_code absent from breakdown when not in source', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 40,
          failed_deployment_count: 0,
          change_failure_rate: 0,
          by_ide: {
            cursor: { cycle_time_days: 1, count: 20 },
            windsurf: { cycle_time_days: 2, count: 15 },
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(out!.breakdownByTool!.claude_code).toBeUndefined()
  })

  it('deployment reliability: claude_code absent from breakdown when not in source', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 30,
          failed_deployment_count: 5,
          change_failure_rate: 14.3,
          deployment_frequency: 35,
          by_ide: {
            cursor: { weekly_frequency: 10, failure_rate: 5, count: 20 },
            windsurf: { weekly_frequency: 8, failure_rate: 20, count: 15 },
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeploymentReliabilityPressure(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(out!.breakdownByTool!.claude_code).toBeUndefined()
  })

  it('claude_code appears only when authoritatively present in source', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 40,
          failed_deployment_count: 0,
          change_failure_rate: 0,
          by_ide: {
            cursor: { cycle_time_days: 1, count: 20 },
            claude_code: { cycle_time_days: 0.5, count: 10 }, // 14/week
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    expect(out!.breakdownByTool).toBeDefined()
    expect(out!.breakdownByTool!.claude_code).toBeDefined()
    expect(out!.breakdownByTool!.claude_code.value).toBeCloseTo(14, 5)
    expect(out!.breakdownByTool!.claude_code.count).toBe(10)
  })
})

// ============================================================
// I. NARRATIVE — org-level path says org-level; authoritative path does not say unavailable
// ============================================================
describe('CR-X R1.1 I: narrative consistency', () => {
  it('reopen pressure: org-level path says "workflow attribution unavailable"', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        pr_review_metrics: { pr_reopened_count: 5, total_prs: 50 },
      },
    })
    const out = generateReopenPressureSpike(input)
    expect(out).not.toBeNull()
    expect(out!.whatChanged).toContain('workflow attribution unavailable')
    expect(out!.attributionStatus).toBe('org_level_only')
  })

  it('reopen pressure: authoritative path does NOT say "workflow attribution unavailable"', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        pr_analytics: {
          total_prs: 50,
          reopened_prs: 5,
          by_ide: {
            cursor: { reopen_rate: 8, count: 20 },
            windsurf: { reopen_rate: 12, count: 15 },
          },
        },
      },
    })
    const out = generateReopenPressureSpike(input)
    expect(out).not.toBeNull()
    expect(out!.whatChanged).not.toContain('workflow attribution unavailable')
    expect(out!.whatChanged).toContain('Workflow breakdown available')
    expect(out!.attributionStatus).toBe('ide_attributed')
  })

  it('delivery velocity: org-level path says "workflow attribution unavailable"', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 40,
          failed_deployment_count: 0,
          change_failure_rate: 0,
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    expect(out!.whatChanged).toContain('workflow attribution unavailable')
    expect(out!.attributionStatus).toBe('org_level_only')
  })

  it('delivery velocity: authoritative path does NOT say "workflow attribution unavailable"', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 40,
          failed_deployment_count: 0,
          change_failure_rate: 0,
          by_ide: {
            cursor: { cycle_time_days: 1, count: 20 },
            windsurf: { cycle_time_days: 2, count: 15 },
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeliveryVelocityByWorkflow(input)
    expect(out).not.toBeNull()
    expect(out!.whatChanged).not.toContain('workflow attribution unavailable')
    expect(out!.description).not.toContain('org-level until deployment-to-workflow tagging is available')
    expect(out!.attributionStatus).toBe('ide_attributed')
  })

  it('deployment reliability: org-level path says "IDE attribution unavailable"', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 30,
          failed_deployment_count: 5,
          change_failure_rate: 14.3,
          deployment_frequency: 35,
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeploymentReliabilityPressure(input)
    expect(out).not.toBeNull()
    expect(out!.description).toContain('IDE attribution unavailable')
    expect(out!.attributionStatus).toBe('org_level_only')
  })

  it('deployment reliability: authoritative path does NOT say "IDE attribution unavailable"', () => {
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        deployment_metrics: {
          success_deployment_count: 30,
          failed_deployment_count: 5,
          change_failure_rate: 14.3,
          deployment_frequency: 35,
          by_ide: {
            cursor: { weekly_frequency: 10, failure_rate: 5, count: 20 },
            windsurf: { weekly_frequency: 8, failure_rate: 20, count: 15 },
          },
        },
      },
      githubByPeriod: new Array(4).fill({}),
    })
    const out = generateDeploymentReliabilityPressure(input)
    expect(out).not.toBeNull()
    expect(out!.description).not.toContain('IDE attribution unavailable')
    expect(out!.description).toContain('Workflow breakdown available')
    expect(out!.attributionStatus).toBe('ide_attributed')
  })
})

// ============================================================
// SOURCE COMPATIBILITY — reopen by_ide only used when same source
// ============================================================
describe('CR-X R1.1: source compatibility for reopen by_ide', () => {
  it('reopen pressure: pr_analytics.by_ide NOT used when org-level source is pr_review_metrics', () => {
    // Org-level reopen comes from pr_review_metrics, but by_ide is under
    // pr_analytics — different samples. Must NOT combine.
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        pr_review_metrics: { pr_reopened_count: 5, total_prs: 50 },
        pr_analytics: {
          total_prs: 50,
          reopened_prs: 5,
          by_ide: {
            cursor: { reopen_rate: 8, count: 20 },
            windsurf: { reopen_rate: 12, count: 15 },
          },
        },
      },
    })
    const out = generateReopenPressureSpike(input)
    expect(out).not.toBeNull()
    // by_ide from pr_analytics must NOT be used with pr_review_metrics org-level
    expect(out!.breakdownByTool).toBeUndefined()
    expect(out!.attributionStatus).toBe('org_level_only')
  })

  it('reopen pressure: pr_analytics.by_ide IS used when org-level source is pr_analytics', () => {
    // Force org-level source to be pr_analytics by omitting pr_review_metrics
    // and reopen_pressure_spike.
    const input = makeAuthoritativeInput({
      githubSnapshot: {
        ...authoritativeProvenance(),
        pr_analytics: {
          total_prs: 50,
          reopened_prs: 5,
          by_ide: {
            cursor: { reopen_rate: 8, count: 20 },
            windsurf: { reopen_rate: 12, count: 15 },
          },
        },
      },
    })
    const out = generateReopenPressureSpike(input)
    expect(out).not.toBeNull()
    // Same source (pr_analytics) → by_ide may be used
    expect(out!.breakdownByTool).toBeDefined()
    expect(out!.attributionStatus).toBe('ide_attributed')
  })
})
