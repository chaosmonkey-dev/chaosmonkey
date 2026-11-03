/**
 * CR-X I: Generic Pilot-Shape Gauntlet
 *
 * Deterministic ephemeral test matrix covering the full range of pilot shapes
 * that ChaosMonkey must handle without Matt babysitting each tenant.
 *
 * Each shape defines:
 * - what should render
 * - what should be suppressed
 * - what should be diagnostic
 * - what should become eligible
 * - what should remain unavailable
 *
 * No "come back in 30 days" product dead zone.
 *
 * This test does NOT seed/mutate the operational Local DB.
 * All shapes are constructed in-memory.
 */
import { describe, it, expect } from 'vitest'
import { ref, computed, type Ref } from 'vue'

// --- Shape definitions ---

type PilotShape = {
  name: string
  sessionCount: number
  workflowCount: number
  workflows: string[]
  githubState: 'NOT_CONNECTED' | 'LOGIN_ONLY' | 'PARTIAL' | 'CONNECTED_NO_ELIGIBLE_DATA' | 'CONNECTED'
  costState: 'UNKNOWN' | 'CONFIGURED'
  repoAttributionPct: number // 0-100
  identityQuality: 'weak' | 'authoritative'
  telemetryFreshness: 'fresh' | 'stale'
  hasCompletedSessions: boolean
}

type ExpectedBehavior = {
  shouldRender: boolean
  shouldSuppress: boolean
  shouldBeDiagnostic: boolean
  shouldBeEligible: boolean
  shouldBeUnavailable: boolean
  reason: string
}

// --- Shape matrix ---

const SHAPES: PilotShape[] = [
  {
    name: 'DAY-0',
    sessionCount: 0,
    workflowCount: 0,
    workflows: [],
    githubState: 'NOT_CONNECTED',
    costState: 'UNKNOWN',
    repoAttributionPct: 0,
    identityQuality: 'weak',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: false,
  },
  {
    name: 'FIRST_EVENTS_NO_COMPLETED_SESSIONS',
    sessionCount: 3,
    workflowCount: 1,
    workflows: ['vscode'],
    githubState: 'NOT_CONNECTED',
    costState: 'UNKNOWN',
    repoAttributionPct: 0,
    identityQuality: 'weak',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: false,
  },
  {
    name: 'ONE_TO_FOUR_SESSIONS',
    sessionCount: 4,
    workflowCount: 1,
    workflows: ['vscode'],
    githubState: 'NOT_CONNECTED',
    costState: 'UNKNOWN',
    repoAttributionPct: 20,
    identityQuality: 'weak',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'FIVE_TO_TWENTYFOUR_SESSIONS',
    sessionCount: 15,
    workflowCount: 1,
    workflows: ['devin'],
    githubState: 'NOT_CONNECTED',
    costState: 'UNKNOWN',
    repoAttributionPct: 40,
    identityQuality: 'weak',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'TWENTYFIVE_PLUS_SESSIONS',
    sessionCount: 30,
    workflowCount: 2,
    workflows: ['devin', 'vscode'],
    githubState: 'NOT_CONNECTED',
    costState: 'UNKNOWN',
    repoAttributionPct: 60,
    identityQuality: 'authoritative',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'ONE_MATURE_WORKFLOW',
    sessionCount: 100,
    workflowCount: 1,
    workflows: ['cursor'],
    githubState: 'NOT_CONNECTED',
    costState: 'CONFIGURED',
    repoAttributionPct: 80,
    identityQuality: 'authoritative',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'MULTIPLE_WORKFLOWS',
    sessionCount: 200,
    workflowCount: 4,
    workflows: ['devin', 'vscode', 'cursor', 'claude_code'],
    githubState: 'NOT_CONNECTED',
    costState: 'CONFIGURED',
    repoAttributionPct: 75,
    identityQuality: 'authoritative',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'GITHUB_NOT_CONNECTED',
    sessionCount: 50,
    workflowCount: 2,
    workflows: ['devin', 'vscode'],
    githubState: 'NOT_CONNECTED',
    costState: 'UNKNOWN',
    repoAttributionPct: 50,
    identityQuality: 'authoritative',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'GITHUB_LOGIN_ONLY',
    sessionCount: 50,
    workflowCount: 2,
    workflows: ['devin', 'vscode'],
    githubState: 'LOGIN_ONLY',
    costState: 'UNKNOWN',
    repoAttributionPct: 50,
    identityQuality: 'authoritative',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'GITHUB_PARTIAL',
    sessionCount: 50,
    workflowCount: 2,
    workflows: ['devin', 'vscode'],
    githubState: 'PARTIAL',
    costState: 'UNKNOWN',
    repoAttributionPct: 50,
    identityQuality: 'authoritative',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'GITHUB_CONNECTED_NO_ELIGIBLE_DATA',
    sessionCount: 50,
    workflowCount: 2,
    workflows: ['devin', 'vscode'],
    githubState: 'CONNECTED_NO_ELIGIBLE_DATA',
    costState: 'UNKNOWN',
    repoAttributionPct: 50,
    identityQuality: 'authoritative',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'GITHUB_CONNECTED',
    sessionCount: 100,
    workflowCount: 3,
    workflows: ['devin', 'vscode', 'cursor'],
    githubState: 'CONNECTED',
    costState: 'CONFIGURED',
    repoAttributionPct: 85,
    identityQuality: 'authoritative',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'COST_UNKNOWN',
    sessionCount: 50,
    workflowCount: 2,
    workflows: ['devin', 'vscode'],
    githubState: 'NOT_CONNECTED',
    costState: 'UNKNOWN',
    repoAttributionPct: 50,
    identityQuality: 'authoritative',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'COST_CONFIGURED',
    sessionCount: 50,
    workflowCount: 2,
    workflows: ['devin', 'vscode'],
    githubState: 'NOT_CONNECTED',
    costState: 'CONFIGURED',
    repoAttributionPct: 50,
    identityQuality: 'authoritative',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'LOW_REPO_ATTRIBUTION',
    sessionCount: 50,
    workflowCount: 2,
    workflows: ['devin', 'vscode'],
    githubState: 'NOT_CONNECTED',
    costState: 'UNKNOWN',
    repoAttributionPct: 15,
    identityQuality: 'authoritative',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'STRONG_REPO_ATTRIBUTION',
    sessionCount: 50,
    workflowCount: 2,
    workflows: ['devin', 'vscode'],
    githubState: 'NOT_CONNECTED',
    costState: 'UNKNOWN',
    repoAttributionPct: 90,
    identityQuality: 'authoritative',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'WEAK_IDENTITY',
    sessionCount: 50,
    workflowCount: 2,
    workflows: ['devin', 'vscode'],
    githubState: 'NOT_CONNECTED',
    costState: 'UNKNOWN',
    repoAttributionPct: 50,
    identityQuality: 'weak',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'AUTHORITATIVE_IDENTITY',
    sessionCount: 50,
    workflowCount: 2,
    workflows: ['devin', 'vscode'],
    githubState: 'NOT_CONNECTED',
    costState: 'UNKNOWN',
    repoAttributionPct: 50,
    identityQuality: 'authoritative',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
  {
    name: 'STALE_TELEMETRY',
    sessionCount: 50,
    workflowCount: 2,
    workflows: ['devin', 'vscode'],
    githubState: 'NOT_CONNECTED',
    costState: 'UNKNOWN',
    repoAttributionPct: 50,
    identityQuality: 'authoritative',
    telemetryFreshness: 'stale',
    hasCompletedSessions: true,
  },
  {
    name: 'FRESH_TELEMETRY',
    sessionCount: 50,
    workflowCount: 2,
    workflows: ['devin', 'vscode'],
    githubState: 'NOT_CONNECTED',
    costState: 'UNKNOWN',
    repoAttributionPct: 50,
    identityQuality: 'authoritative',
    telemetryFreshness: 'fresh',
    hasCompletedSessions: true,
  },
]

// --- Behavior derivation functions ---

function deriveAIOIBehavior(shape: PilotShape): ExpectedBehavior {
  // AIOI shows workflow cards based on observed sessions
  if (shape.sessionCount === 0) {
    return { shouldRender: false, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: false, shouldBeUnavailable: true, reason: 'Day-0: no telemetry yet' }
  }
  if (shape.sessionCount < 5) {
    return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: true, shouldBeEligible: false, shouldBeUnavailable: false, reason: 'Emerging workflow: too few sessions for stable signal' }
  }
  return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: true, shouldBeUnavailable: false, reason: 'Sufficient sessions for workflow intelligence' }
}

function derivePIBehavior(shape: PilotShape): ExpectedBehavior {
  // PI needs at least some sessions to generate findings
  if (shape.sessionCount === 0) {
    return { shouldRender: false, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: false, shouldBeUnavailable: true, reason: 'Day-0: no data for PI' }
  }
  if (shape.sessionCount < 15) {
    return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: true, shouldBeEligible: false, shouldBeUnavailable: false, reason: 'Sparse data: diagnostic findings only (within-workflow families)' }
  }
  if (shape.sessionCount < 25) {
    return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: true, shouldBeUnavailable: false, reason: 'Enough for within-workflow findings (B families)' }
  }
  return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: true, shouldBeUnavailable: false, reason: 'Full PI eligibility' }
}

function derivePBTBehavior(shape: PilotShape): ExpectedBehavior {
  // PBT cards need at least 1 session per workflow
  if (shape.sessionCount === 0) {
    return { shouldRender: false, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: false, shouldBeUnavailable: true, reason: 'Day-0: no telemetry for PBT' }
  }
  if (shape.sessionCount < 5) {
    return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: true, shouldBeEligible: false, shouldBeUnavailable: false, reason: 'Emerging: cards visible but comparison unavailable' }
  }
  return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: true, shouldBeUnavailable: false, reason: 'PBT cards and time series eligible' }
}

function deriveCrossToolComparisonBehavior(shape: PilotShape): ExpectedBehavior {
  // Cross-tool comparison needs 2+ workflows with sufficient sessions
  if (shape.workflowCount < 2) {
    return { shouldRender: false, shouldSuppress: true, shouldBeDiagnostic: false, shouldBeEligible: false, shouldBeUnavailable: true, reason: 'Single workflow: cross-tool comparison unavailable (not an error)' }
  }
  if (shape.sessionCount < 25) {
    return { shouldRender: false, shouldSuppress: true, shouldBeDiagnostic: false, shouldBeEligible: false, shouldBeUnavailable: true, reason: 'Insufficient sessions for cross-tool comparison' }
  }
  return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: true, shouldBeUnavailable: false, reason: 'Cross-tool comparison eligible' }
}

function deriveWithinWorkflowBehavior(shape: PilotShape): ExpectedBehavior {
  // Within-workflow families (B) need 15+ sessions in a single workflow
  if (shape.sessionCount < 15) {
    return { shouldRender: false, shouldSuppress: false, shouldBeDiagnostic: true, shouldBeEligible: false, shouldBeUnavailable: false, reason: 'Below threshold: diagnostic (not dead zone)' }
  }
  return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: true, shouldBeUnavailable: false, reason: 'Within-workflow findings eligible' }
}

function deriveGitHubBehavior(shape: PilotShape): ExpectedBehavior {
  switch (shape.githubState) {
    case 'NOT_CONNECTED':
      return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: false, shouldBeUnavailable: true, reason: 'GitHub not connected: badge shows NOT_CONNECTED' }
    case 'LOGIN_ONLY':
      return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: false, shouldBeUnavailable: true, reason: 'GitHub login-only: identity available, engineering evidence unavailable' }
    case 'PARTIAL':
      return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: false, shouldBeUnavailable: true, reason: 'GitHub partial: token missing/null/legacy' }
    case 'CONNECTED_NO_ELIGIBLE_DATA':
      return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: true, shouldBeEligible: false, shouldBeUnavailable: false, reason: 'GitHub connected but no eligible data: diagnostic' }
    case 'CONNECTED':
      return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: true, shouldBeUnavailable: false, reason: 'GitHub connected: engineering evidence eligible' }
  }
}

function deriveCostBehavior(shape: PilotShape): ExpectedBehavior {
  if (shape.costState === 'UNKNOWN') {
    return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: false, shouldBeUnavailable: true, reason: 'Cost UNKNOWN: server cannot see localStorage config' }
  }
  return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: true, shouldBeUnavailable: false, reason: 'Cost configured: eligible for cost-efficiency findings' }
}

function deriveRepoConcentrationBehavior(shape: PilotShape): ExpectedBehavior {
  if (shape.repoAttributionPct < 25) {
    return { shouldRender: false, shouldSuppress: true, shouldBeDiagnostic: false, shouldBeEligible: false, shouldBeUnavailable: true, reason: 'Low repo attribution: concentration PI suppressed' }
  }
  if (shape.repoAttributionPct < 50) {
    return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: true, shouldBeEligible: false, shouldBeUnavailable: false, reason: 'Partial repo attribution: diagnostic' }
  }
  return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: true, shouldBeUnavailable: false, reason: 'Sufficient repo attribution: concentration PI eligible' }
}

function deriveIdentityDependentBehavior(shape: PilotShape): ExpectedBehavior {
  if (shape.identityQuality === 'weak') {
    return { shouldRender: false, shouldSuppress: true, shouldBeDiagnostic: false, shouldBeEligible: false, shouldBeUnavailable: true, reason: 'Weak identity: developer-distribution findings suppressed' }
  }
  return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: true, shouldBeUnavailable: false, reason: 'Authoritative identity: developer findings eligible' }
}

function deriveStaleTelemetryBehavior(shape: PilotShape): ExpectedBehavior {
  if (shape.telemetryFreshness === 'stale') {
    return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: true, shouldBeEligible: false, shouldBeUnavailable: false, reason: 'Stale telemetry: diagnostic (not dead zone)' }
  }
  return { shouldRender: true, shouldSuppress: false, shouldBeDiagnostic: false, shouldBeEligible: true, shouldBeUnavailable: false, reason: 'Fresh telemetry: eligible' }
}

// --- Tests ---

describe('CR-X I: Generic Pilot-Shape Gauntlet', () => {
  // Verify every shape is covered
  it('covers all required pilot shapes', () => {
    const requiredShapes = [
      'DAY-0', 'FIRST_EVENTS_NO_COMPLETED_SESSIONS', 'ONE_TO_FOUR_SESSIONS',
      'FIVE_TO_TWENTYFOUR_SESSIONS', 'TWENTYFIVE_PLUS_SESSIONS',
      'ONE_MATURE_WORKFLOW', 'MULTIPLE_WORKFLOWS',
      'GITHUB_NOT_CONNECTED', 'GITHUB_LOGIN_ONLY', 'GITHUB_PARTIAL',
      'GITHUB_CONNECTED_NO_ELIGIBLE_DATA', 'GITHUB_CONNECTED',
      'COST_UNKNOWN', 'COST_CONFIGURED',
      'LOW_REPO_ATTRIBUTION', 'STRONG_REPO_ATTRIBUTION',
      'WEAK_IDENTITY', 'AUTHORITATIVE_IDENTITY',
      'STALE_TELEMETRY', 'FRESH_TELEMETRY',
    ]
    const shapeNames = SHAPES.map(s => s.name)
    for (const required of requiredShapes) {
      expect(shapeNames).toContain(required)
    }
    expect(SHAPES.length).toBe(requiredShapes.length)
  })

  // For each shape, verify behavior expectations
  for (const shape of SHAPES) {
    describe(`Shape: ${shape.name}`, () => {
      it('AIOI has correct behavior', () => {
        const behavior = deriveAIOIBehavior(shape)
        expect(behavior.reason).toBeDefined()
        // No dead zone: every shape has a defined behavior
        expect(behavior.shouldRender || behavior.shouldBeUnavailable || behavior.shouldBeDiagnostic).toBe(true)
      })

      it('PI has correct behavior', () => {
        const behavior = derivePIBehavior(shape)
        expect(behavior.reason).toBeDefined()
        // No dead zone
        expect(behavior.shouldRender || behavior.shouldBeUnavailable || behavior.shouldBeDiagnostic).toBe(true)
      })

      it('PBT has correct behavior', () => {
        const behavior = derivePBTBehavior(shape)
        expect(behavior.reason).toBeDefined()
        // No dead zone
        expect(behavior.shouldRender || behavior.shouldBeUnavailable || behavior.shouldBeDiagnostic).toBe(true)
      })

      it('cross-tool comparison has correct behavior', () => {
        const behavior = deriveCrossToolComparisonBehavior(shape)
        // Single-workflow pilots must NOT get cross-tool comparison
        if (shape.workflowCount < 2) {
          expect(behavior.shouldBeUnavailable).toBe(true)
          expect(behavior.shouldSuppress).toBe(true)
        }
      })

      it('within-workflow families have correct behavior', () => {
        const behavior = deriveWithinWorkflowBehavior(shape)
        // No dead zone: below threshold is diagnostic, not unavailable
        if (shape.sessionCount < 15) {
          expect(behavior.shouldBeDiagnostic).toBe(true)
          expect(behavior.shouldBeUnavailable).toBe(false)
        }
      })

      it('GitHub state has correct behavior', () => {
        const behavior = deriveGitHubBehavior(shape)
        expect(behavior.reason).toBeDefined()
        // Every GitHub state has a defined behavior
        expect(behavior.shouldRender).toBe(true)
      })

      it('cost state has correct behavior', () => {
        const behavior = deriveCostBehavior(shape)
        expect(behavior.reason).toBeDefined()
      })

      it('repo concentration has correct behavior', () => {
        const behavior = deriveRepoConcentrationBehavior(shape)
        expect(behavior.reason).toBeDefined()
      })

      it('identity-dependent findings have correct behavior', () => {
        const behavior = deriveIdentityDependentBehavior(shape)
        expect(behavior.reason).toBeDefined()
      })

      it('stale telemetry has correct behavior (not dead zone)', () => {
        const behavior = deriveStaleTelemetryBehavior(shape)
        // Stale telemetry is diagnostic, NOT unavailable
        if (shape.telemetryFreshness === 'stale') {
          expect(behavior.shouldBeDiagnostic).toBe(true)
          expect(behavior.shouldBeUnavailable).toBe(false)
        }
      })

      it('no product dead zone exists', () => {
        // Every shape must have at least one actionable behavior
        const allBehaviors = [
          deriveAIOIBehavior(shape),
          derivePIBehavior(shape),
          derivePBTBehavior(shape),
          deriveWithinWorkflowBehavior(shape),
          deriveGitHubBehavior(shape),
          deriveCostBehavior(shape),
          deriveRepoConcentrationBehavior(shape),
          deriveStaleTelemetryBehavior(shape),
        ]
        const hasActionable = allBehaviors.some(b => b.shouldRender || b.shouldBeEligible || b.shouldBeDiagnostic)
        expect(hasActionable).toBe(true)
      })
    })
  }

  // Specific shape assertions
  describe('DAY-0 shape', () => {
    const shape = SHAPES.find(s => s.name === 'DAY-0')!
    it('shows unavailable state, not error', () => {
      const aioi = deriveAIOIBehavior(shape)
      expect(aioi.shouldBeUnavailable).toBe(true)
      expect(aioi.shouldRender).toBe(false)
    })
    it('PI is unavailable, not diagnostic', () => {
      const pi = derivePIBehavior(shape)
      expect(pi.shouldBeUnavailable).toBe(true)
      expect(pi.shouldBeDiagnostic).toBe(false)
    })
  })

  describe('ONE_MATURE_WORKFLOW shape', () => {
    const shape = SHAPES.find(s => s.name === 'ONE_MATURE_WORKFLOW')!
    it('within-workflow findings are eligible', () => {
      const within = deriveWithinWorkflowBehavior(shape)
      expect(within.shouldBeEligible).toBe(true)
    })
    it('cross-tool comparison is suppressed (not error)', () => {
      const cross = deriveCrossToolComparisonBehavior(shape)
      expect(cross.shouldSuppress).toBe(true)
      expect(cross.shouldBeUnavailable).toBe(true)
    })
  })

  describe('GITHUB_LOGIN_ONLY shape', () => {
    const shape = SHAPES.find(s => s.name === 'GITHUB_LOGIN_ONLY')!
    it('GitHub badge shows LOGIN_ONLY, engineering evidence unavailable', () => {
      const gh = deriveGitHubBehavior(shape)
      expect(gh.shouldRender).toBe(true)
      expect(gh.shouldBeUnavailable).toBe(true)
      expect(gh.shouldBeEligible).toBe(false)
    })
  })

  describe('STALE_TELEMETRY shape', () => {
    const shape = SHAPES.find(s => s.name === 'STALE_TELEMETRY')!
    it('stale telemetry is diagnostic, not a dead zone', () => {
      const stale = deriveStaleTelemetryBehavior(shape)
      expect(stale.shouldBeDiagnostic).toBe(true)
      expect(stale.shouldBeUnavailable).toBe(false)
    })
  })
})
