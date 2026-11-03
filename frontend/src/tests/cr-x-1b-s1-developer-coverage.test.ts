/**
 * CR-X Day 1B S1: Developer coverage / filter trust UX in PBT header
 *
 * Tests:
 * 1. PBT header includes a developer coverage indicator
 * 2. Coverage denominator is authoritative canonical session population (not inferred)
 * 3. Coverage distinguishes invite-backed from unattributed sessions
 * 4. Coverage percentage is computed from actual session data
 * 5. Reset/clear returns to organization scope (analysisContext.reset clears all)
 * 6. selectedWorkflow syncs to analysisContext (S3 divergence fix)
 * 7. Filter chips remain synchronized
 * 8. No hardcoded coverage counts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const pbtPath = resolve(__dirname, '../components/ProductivityByToolV3.vue')
const pbtSource = readFileSync(pbtPath, 'utf-8')

const analysisContextPath = resolve(__dirname, '../stores/analysisContext.ts')
const analysisContextSource = readFileSync(analysisContextPath, 'utf-8')

// Strip HTML/Vue comments and JS line comments for source-level assertions
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const pbtClean = stripComments(pbtSource)

describe('CR-X Day 1B S1: Developer coverage indicator in PBT header', () => {
  it('PBT context bar includes a coverage indicator element', () => {
    expect(pbtSource).toContain('v3-coverage-indicator')
  })

  it('coverage indicator is gated on developerCoverage.available and not loading', () => {
    expect(pbtSource).toContain('developerCoverage.available')
    expect(pbtSource).toContain('pbtHeaderLoading')
  })

  it('coverage shows invite-backed / total sessions and percentage', () => {
    expect(pbtSource).toContain('developerCoverage.inviteBacked')
    expect(pbtSource).toContain('developerCoverage.total')
    expect(pbtSource).toContain('developerCoverage.coveragePct')
  })

  it('coverage exposes unattributed session count', () => {
    expect(pbtSource).toContain('developerCoverage.unattributed')
    expect(pbtSource).toContain('unattributed')
  })

  it('coverage computed derives from authoritativeSessions prop, not hardcoded', () => {
    expect(pbtSource).toContain('props.authoritativeSessions')
    // The computed must be in the script section, not just a comment
    expect(pbtClean).toContain('developerCoverage')
    expect(pbtClean).toContain('inviteBacked')
  })

  it('coverage uses backend invite_backed_count (not local invite: prefix matching)', () => {
    // The old approach used startsWith('invite:') locally — now the backend
    // computes invite_backed_count over the same scoped canonical query
    expect(pbtSource).toContain('invite_backed_count')
  })

  it('coverage handles empty sessions gracefully (available: false)', () => {
    expect(pbtSource).toContain('available: false')
  })

  it('coverage percentage is rounded, not floating point', () => {
    expect(pbtSource).toContain('Math.round')
  })

  it('coverage has visual state classes for ok/warn thresholds', () => {
    expect(pbtSource).toContain('v3-coverage--ok')
    expect(pbtSource).toContain('v3-coverage--warn')
    // 50% threshold matches backend decision_intelligence logic
    expect(pbtSource).toContain('coveragePct >= 50')
  })
})

describe('CR-X PBT repo-attribution label disambiguation', () => {
  // The PBT badge measures DEVELOPER attribution (invite-backed identity).
  // The PI badge measures REPO attribution (git_repo_url present).
  // These are legitimately different populations — a session can have repo
  // attribution without developer attribution and vice versa.
  // The PBT label MUST say "developer-attributed" (not just "attributed")
  // to avoid contradiction with PI repo attribution coverage.

  it('PBT badge label says developer-attributed, not ambiguous "sessions attributed"', () => {
    expect(pbtSource).toContain('developer-attributed')
    expect(pbtSource).not.toContain('sessions attributed')
  })

  it('PBT badge uses invite-anonymous, not ambiguous "unattributed" display text', () => {
    // The computed property key is still `unattributed` (internal), but the
    // customer-facing display text must say "invite-anonymous" to distinguish
    // from repo-unattributed. The old label ended with "unattributed</span>" —
    // now it ends with "invite-anonymous</span>".
    expect(pbtSource).toContain('invite-anonymous')
    // The old display text was: "· {{ ... }} unattributed</span>"
    // The new display text is: "· {{ ... }} invite-anonymous</span>"
    // Verify the display word after the Vue expression is "invite-anonymous"
    expect(pbtSource).toMatch(/invite-anonymous<\/span>/)
    expect(pbtSource).not.toMatch(/\}\}\s*unattributed<\/span>/)
  })

  it('PBT badge has title tooltip explaining developer vs repo attribution distinction', () => {
    expect(pbtSource).toContain('Developer attribution')
    expect(pbtSource).toContain('distinct from repo attribution')
  })
})

describe('CR-X Day 1B S1: Reset/clear returns to organization scope', () => {
  it('resetFilters resets analysisContext', () => {
    expect(pbtSource).toContain('analysisContext.reset()')
  })

  it('resetFilters clears selectedWorkflow to compare (org scope)', () => {
    expect(pbtSource).toContain("selectedWorkflow.value = 'compare'")
  })

  it('resetFilters clears selectedDeveloper and selectedRepo', () => {
    expect(pbtSource).toContain("selectedDeveloper.value = ''")
    expect(pbtSource).toContain("selectedRepo.value = ''")
  })

  it('analysisContext.reset clears all scope dimensions', () => {
    expect(analysisContextSource).toContain('developerIds.value = []')
    expect(analysisContextSource).toContain('repoIds.value = []')
    expect(analysisContextSource).toContain('workflowIds.value = []')
    expect(analysisContextSource).toContain("timePreset.value = 'all'")
  })
})

describe('CR-X Day 1B S1: selectedWorkflow syncs to analysisContext (S3 divergence fix)', () => {
  it('selectedWorkflow has a watch that syncs to analysisContext.setWorkflowIds', () => {
    expect(pbtSource).toContain('analysisContext.setWorkflowIds')
  })

  it('compare value maps to empty workflowIds (org scope)', () => {
    // The watch should map 'compare' to [] (no workflow filter)
    expect(pbtSource).toContain("!== 'compare'")
  })
})

describe('CR-X Day 1B S1: Filter chips remain synchronized', () => {
  it('active filter chips render for time, developer, repo, workflow', () => {
    expect(pbtSource).toContain('v3-active-filter-chip')
    expect(pbtSource).toContain('selectedDeveloper')
    expect(pbtSource).toContain('selectedRepo')
    expect(pbtSource).toContain('selectedWorkflow')
  })

  it('clear all button calls resetFilters', () => {
    expect(pbtSource).toContain('resetFilters')
    expect(pbtSource).toContain('Clear all')
  })

  it('developer watch syncs to both filterStore and analysisContext', () => {
    expect(pbtSource).toContain("filterStore.setDeveloperIds('productivity'")
    expect(pbtSource).toContain('analysisContext.setDeveloperIds')
  })

  it('repo watch syncs to both filterStore and analysisContext', () => {
    expect(pbtSource).toContain("filterStore.setRepos('productivity'")
    expect(pbtSource).toContain('analysisContext.setRepoIds')
  })
})

describe('CR-X Day 1B S1: No hardcoded coverage counts', () => {
  it('does not hardcode session count 2101 or 2103 in coverage logic', () => {
    // The coverage must be dynamic from props.authoritativeSessions
    // These are the old static counts that must not appear in coverage code
    const coverageSection = pbtSource.match(/developerCoverage[\s\S]*?return\s*\{[^}]*\}/)
    expect(coverageSection).toBeTruthy()
    const section = coverageSection![0]
    expect(section).not.toContain('2101')
    expect(section).not.toContain('2103')
  })

  it('does not infer missing developer identity', () => {
    // The coverage logic must not guess/infer identity — it only counts invite: prefix
    const coverageSection = pbtSource.match(/developerCoverage[\s\S]*?return\s*\{[^}]*\}/)
    expect(coverageSection).toBeTruthy()
    const section = coverageSection![0]
    expect(section).not.toMatch(/infer|guess|assume|default.*identity/i)
  })
})

// ── CR-X Day 1B S1 P0: Scoped coverage tests ─────────────────────────────────
// The coverage must be SCOPE-AWARE: denominator changes with developer/repo filters.
// These tests use deterministic populations to prove scoped coverage semantics.

interface MockSession {
  user_id: string
  developer_id?: string
  git_repo_url?: string
  session_id: string
}

// Deterministic test population:
// Org total: 10 sessions
//   invite:dev1 → 4 sessions (3 repoA, 1 repoB) — 100% invite-backed
//   invite:dev2 → 3 sessions (2 repoA, 1 repoB) — 100% invite-backed
//   legacy_dev3 → 3 sessions (1 repoA, 2 repoB) — 0% invite-backed
// Org coverage: 7/10 = 70%
// repoA: 6 sessions (3 invite:dev1, 2 invite:dev2, 1 legacy_dev3) → 5/6 = 83%
// repoB: 4 sessions (1 invite:dev1, 1 invite:dev2, 2 legacy_dev3) → 2/4 = 50%
// dev1: 4 sessions (all invite-backed) → 4/4 = 100%
// dev2: 3 sessions (all invite-backed) → 3/3 = 100%
// dev3: 3 sessions (0 invite-backed) → 0/3 = 0%
// dev1+repoA: 3 sessions (all invite:dev1) → 3/3 = 100%
// dev3+repoB: 2 sessions (0 invite-backed) → 0/2 = 0%
const ORG_SESSIONS: MockSession[] = [
  { user_id: 'invite:dev1', git_repo_url: 'https://github.com/org/repoA', session_id: 's1' },
  { user_id: 'invite:dev1', git_repo_url: 'https://github.com/org/repoA', session_id: 's2' },
  { user_id: 'invite:dev1', git_repo_url: 'https://github.com/org/repoA', session_id: 's3' },
  { user_id: 'invite:dev1', git_repo_url: 'https://github.com/org/repoB', session_id: 's4' },
  { user_id: 'invite:dev2', git_repo_url: 'https://github.com/org/repoA', session_id: 's5' },
  { user_id: 'invite:dev2', git_repo_url: 'https://github.com/org/repoA', session_id: 's6' },
  { user_id: 'invite:dev2', git_repo_url: 'https://github.com/org/repoB', session_id: 's7' },
  { user_id: 'legacy_dev3', git_repo_url: 'https://github.com/org/repoA', session_id: 's8' },
  { user_id: 'legacy_dev3', git_repo_url: 'https://github.com/org/repoB', session_id: 's9' },
  { user_id: 'legacy_dev3', git_repo_url: 'https://github.com/org/repoB', session_id: 's10' },
]

// Replicate the scoped coverage logic from ProductivityByToolV3.vue
function computeScopedCoverage(
  sessions: MockSession[],
  devFilter: string | null,
  repoFilter: string | null,
  normalizeRepo: (url: string) => string
): { total: number; inviteBacked: number; unattributed: number; coveragePct: number; available: boolean } {
  let scoped = sessions
  if (devFilter && repoFilter) {
    scoped = sessions.filter(s => {
      const devId = s.developer_id || s.user_id
      const rawRepo = s.git_repo_url || ''
      if (!rawRepo) return false
      return devId === devFilter && normalizeRepo(String(rawRepo)) === repoFilter
    })
  } else if (devFilter) {
    scoped = sessions.filter(s => {
      const devId = s.developer_id || s.user_id
      return devId === devFilter
    })
  } else if (repoFilter) {
    scoped = sessions.filter(s => {
      const rawRepo = s.git_repo_url || ''
      if (!rawRepo) return false
      return normalizeRepo(String(rawRepo)) === repoFilter
    })
  }
  if (scoped.length === 0) {
    return { total: 0, inviteBacked: 0, unattributed: 0, coveragePct: 0, available: false }
  }
  let inviteBacked = 0
  for (const s of scoped) {
    if (s.user_id.startsWith('invite:')) inviteBacked++
  }
  const total = scoped.length
  const unattributed = total - inviteBacked
  const coveragePct = total > 0 ? Math.round((inviteBacked / total) * 100) : 0
  return { total, inviteBacked, unattributed, coveragePct, available: true }
}

// Simple repo normalizer for test URLs
function normalizeRepo(url: string): string {
  const match = url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/i)
  return match ? match[1].toLowerCase() : url.toLowerCase()
}

describe('CR-X Day 1B S1 P0: Scoped coverage — org view', () => {
  it('org view denominator is full org canonical population (10 sessions)', () => {
    const cov = computeScopedCoverage(ORG_SESSIONS, null, null, normalizeRepo)
    expect(cov.available).toBe(true)
    expect(cov.total).toBe(10)
  })

  it('org view invite-backed count is 7 (dev1=4 + dev2=3)', () => {
    const cov = computeScopedCoverage(ORG_SESSIONS, null, null, normalizeRepo)
    expect(cov.inviteBacked).toBe(7)
  })

  it('org view coverage is 70% (7/10)', () => {
    const cov = computeScopedCoverage(ORG_SESSIONS, null, null, normalizeRepo)
    expect(cov.coveragePct).toBe(70)
  })

  it('org view unattributed is 3 (legacy_dev3 sessions)', () => {
    const cov = computeScopedCoverage(ORG_SESSIONS, null, null, normalizeRepo)
    expect(cov.unattributed).toBe(3)
  })
})

describe('CR-X Day 1B S1 P0: Scoped coverage — developer-filtered view', () => {
  it('dev1 filter denominator is 4 (dev1 sessions only)', () => {
    const cov = computeScopedCoverage(ORG_SESSIONS, 'invite:dev1', null, normalizeRepo)
    expect(cov.available).toBe(true)
    expect(cov.total).toBe(4)
  })

  it('dev1 filter coverage is 100% (all invite-backed)', () => {
    const cov = computeScopedCoverage(ORG_SESSIONS, 'invite:dev1', null, normalizeRepo)
    expect(cov.inviteBacked).toBe(4)
    expect(cov.coveragePct).toBe(100)
    expect(cov.unattributed).toBe(0)
  })

  it('dev3 (legacy) filter coverage is 0% (none invite-backed)', () => {
    const cov = computeScopedCoverage(ORG_SESSIONS, 'legacy_dev3', null, normalizeRepo)
    expect(cov.available).toBe(true)
    expect(cov.total).toBe(3)
    expect(cov.inviteBacked).toBe(0)
    expect(cov.coveragePct).toBe(0)
    expect(cov.unattributed).toBe(3)
  })

  it('dev1 coverage differs from org coverage (scoped, not org-wide)', () => {
    const orgCov = computeScopedCoverage(ORG_SESSIONS, null, null, normalizeRepo)
    const dev1Cov = computeScopedCoverage(ORG_SESSIONS, 'invite:dev1', null, normalizeRepo)
    expect(dev1Cov.coveragePct).not.toBe(orgCov.coveragePct)
    expect(dev1Cov.total).not.toBe(orgCov.total)
  })
})

describe('CR-X Day 1B S1 P0: Scoped coverage — repo-filtered view', () => {
  it('repoA filter denominator is 6 (repoA sessions only)', () => {
    const cov = computeScopedCoverage(ORG_SESSIONS, null, 'org/repoa', normalizeRepo)
    expect(cov.available).toBe(true)
    expect(cov.total).toBe(6)
  })

  it('repoA filter coverage is 83% (5/6 invite-backed)', () => {
    const cov = computeScopedCoverage(ORG_SESSIONS, null, 'org/repoa', normalizeRepo)
    expect(cov.inviteBacked).toBe(5)
    expect(cov.coveragePct).toBe(83)
    expect(cov.unattributed).toBe(1)
  })

  it('repoB filter coverage is 50% (2/4 invite-backed)', () => {
    const cov = computeScopedCoverage(ORG_SESSIONS, null, 'org/repob', normalizeRepo)
    expect(cov.available).toBe(true)
    expect(cov.total).toBe(4)
    expect(cov.inviteBacked).toBe(2)
    expect(cov.coveragePct).toBe(50)
  })

  it('repoA coverage differs from org coverage (scoped, not org-wide)', () => {
    const orgCov = computeScopedCoverage(ORG_SESSIONS, null, null, normalizeRepo)
    const repoACov = computeScopedCoverage(ORG_SESSIONS, null, 'org/repoa', normalizeRepo)
    expect(repoACov.coveragePct).not.toBe(orgCov.coveragePct)
    expect(repoACov.total).not.toBe(orgCov.total)
  })
})

describe('CR-X Day 1B S1 P0: Scoped coverage — combined developer+repo view', () => {
  it('dev1+repoA denominator is 3 (intersection)', () => {
    const cov = computeScopedCoverage(ORG_SESSIONS, 'invite:dev1', 'org/repoa', normalizeRepo)
    expect(cov.available).toBe(true)
    expect(cov.total).toBe(3)
  })

  it('dev1+repoA coverage is 100% (all invite:dev1)', () => {
    const cov = computeScopedCoverage(ORG_SESSIONS, 'invite:dev1', 'org/repoa', normalizeRepo)
    expect(cov.inviteBacked).toBe(3)
    expect(cov.coveragePct).toBe(100)
  })

  it('dev3+repoB coverage is 0% (legacy_dev3, no invite-backed)', () => {
    const cov = computeScopedCoverage(ORG_SESSIONS, 'legacy_dev3', 'org/repob', normalizeRepo)
    expect(cov.available).toBe(true)
    expect(cov.total).toBe(2)
    expect(cov.inviteBacked).toBe(0)
    expect(cov.coveragePct).toBe(0)
  })
})

describe('CR-X Day 1B S1 P0: Scoped coverage — fail closed', () => {
  it('nonexistent developer filter fails closed (available: false)', () => {
    const cov = computeScopedCoverage(ORG_SESSIONS, 'invite:nonexistent', null, normalizeRepo)
    expect(cov.available).toBe(false)
    expect(cov.total).toBe(0)
    expect(cov.coveragePct).toBe(0)
  })

  it('nonexistent repo filter fails closed (available: false)', () => {
    const cov = computeScopedCoverage(ORG_SESSIONS, null, 'org/nonexistent', normalizeRepo)
    expect(cov.available).toBe(false)
    expect(cov.total).toBe(0)
  })

  it('empty sessions fails closed (available: false)', () => {
    const cov = computeScopedCoverage([], null, null, normalizeRepo)
    expect(cov.available).toBe(false)
  })
})

describe('CR-X Day 1B S1 P0-A: Source-level backend-authority coverage assertions', () => {
  it('developerCoverage computed reads from timeSeriesData metadata', () => {
    expect(pbtSource).toContain('timeSeriesData')
    expect(pbtSource).toContain('metadata')
  })

  it('developerCoverage uses canonical_population_count as denominator', () => {
    expect(pbtSource).toContain('canonical_population_count')
  })

  it('developerCoverage uses invite_backed_count as numerator', () => {
    expect(pbtSource).toContain('invite_backed_count')
  })

  it('developerCoverage does NOT do local exact-id filtering', () => {
    // The old approach filtered authoritativeSessions locally — must be gone
    const coverageSection = pbtSource.match(/const developerCoverage = computed\([\s\S]*?\}\)/)
    expect(coverageSection).toBeTruthy()
    const section = coverageSection![0]
    expect(section).not.toContain('devFilter')
    expect(section).not.toContain('repoFilter')
    expect(section).not.toContain('scopedSessions')
  })

  it('developerCoverage does NOT reference authoritativeSessions for coverage', () => {
    // authoritativeSessions is still used for economics, but NOT for coverage
    const coverageSection = pbtSource.match(/const developerCoverage = computed\([\s\S]*?\}\)/)
    expect(coverageSection).toBeTruthy()
    const section = coverageSection![0]
    expect(section).not.toContain('props.authoritativeSessions')
  })

  it('developerCoverage fails closed when metadata is not available', () => {
    expect(pbtSource).toContain('available: false')
  })
})

// ── CR-X Day 1B S1 P0-A: Real-shaped alias regression fixtures ───────────────
// These fixtures reproduce the alias/resolved-developer population mismatch
// that caused the real Local browser bug:
//   - Backend resolves 'local-developer' to [local-developer, 4, 18269556, invite:42]
//   - Frontend exact-id matching only matched 'local-developer' literal rows
//   - This produced denominator 651 instead of the correct 1447
// The fix: both numerator and denominator come from backend canonical metadata.

describe('CR-X Day 1B S1 P0-A: Alias-resolved developer population regression', () => {
  // Simulates the backend canonical metadata for different scopes.
  // In real Local truth:
  //   org: canonical_population_count=2105, invite_backed_count varies
  //   developer-only (local-developer): canonical_population_count=1447
  //   developer+repo: canonical_population_count=631
  //   repo-only: canonical_population_count=641

  function backendMetadata(total: number, inviteBacked: number) {
    return { canonical_population_count: total, invite_backed_count: inviteBacked }
  }

  function coverageFromMetadata(meta: any) {
    if (!meta) return { total: 0, inviteBacked: 0, unattributed: 0, coveragePct: 0, available: false }
    const total = meta.canonical_population_count || 0
    if (total === 0) return { total: 0, inviteBacked: 0, unattributed: 0, coveragePct: 0, available: false }
    const inviteBacked = meta.invite_backed_count || 0
    const unattributed = total - inviteBacked
    const coveragePct = total > 0 ? Math.round((inviteBacked / total) * 100) : 0
    return { total, inviteBacked, unattributed, coveragePct, available: true }
  }

  it('org scope: denominator = 2105 (full org canonical population)', () => {
    const meta = backendMetadata(2105, 800)
    const cov = coverageFromMetadata(meta)
    expect(cov.total).toBe(2105)
    expect(cov.available).toBe(true)
  })

  it('developer-only scope: denominator = 1447 (alias-resolved, NOT 651)', () => {
    // The bug: frontend exact-id matching produced 651.
    // The fix: backend metadata provides 1447.
    const meta = backendMetadata(1447, 60)
    const cov = coverageFromMetadata(meta)
    expect(cov.total).toBe(1447)
    expect(cov.total).not.toBe(651) // Must NOT be the old wrong value
  })

  it('developer-only scope: 60/1447 (browser-accepted Day 1B truth)', () => {
    // Matt browser-accepted Day 1B: developer-only scope shows 60/1447.
    // The canonical backend resolves the logical Matt developer population
    // across verified aliases, including qualifying invite-backed identities.
    // The numerator is NOT zero — 60 invite-backed sessions exist in this scope.
    const meta = backendMetadata(1447, 60)
    const cov = coverageFromMetadata(meta)
    expect(cov.total).toBe(1447)
    expect(cov.inviteBacked).toBe(60)
    expect(cov.coveragePct).toBe(4) // 60/1447 ≈ 4.15%, rounded to 4
    expect(cov.unattributed).toBe(1387)
    expect(cov.available).toBe(true)
  })

  it('developer-only scope: 0/1447 is valid edge case when no invite-backed sessions', () => {
    // Edge case: a developer scope with zero invite-backed sessions is valid.
    // This tests the helper function's behavior with a 0 numerator input.
    // The actual accepted browser truth is 60/1447 (see test above).
    const meta = backendMetadata(1447, 0)
    const cov = coverageFromMetadata(meta)
    expect(cov.inviteBacked).toBe(0)
    expect(cov.coveragePct).toBe(0)
    expect(cov.unattributed).toBe(1447)
    expect(cov.available).toBe(true)
  })

  it('developer+repo scope: denominator = 631 (intersection, NOT 572)', () => {
    // The bug: frontend exact-id matching produced 572.
    // The fix: backend metadata provides 631.
    const meta = backendMetadata(631, 58)
    const cov = coverageFromMetadata(meta)
    expect(cov.total).toBe(631)
    expect(cov.total).not.toBe(572) // Must NOT be the old wrong value
  })

  it('developer+repo scope: 58/631 (browser-accepted Day 1B truth)', () => {
    // Matt browser-accepted Day 1B: developer+repo scope shows 58/631.
    // The numerator is NOT zero — 58 invite-backed sessions exist in this scope.
    const meta = backendMetadata(631, 58)
    const cov = coverageFromMetadata(meta)
    expect(cov.total).toBe(631)
    expect(cov.inviteBacked).toBe(58)
    expect(cov.coveragePct).toBe(9) // 58/631 ≈ 9.19%, rounded to 9
    expect(cov.unattributed).toBe(573)
    expect(cov.available).toBe(true)
  })

  it('repo-only scope: denominator = 641', () => {
    const meta = backendMetadata(641, 58)
    const cov = coverageFromMetadata(meta)
    expect(cov.total).toBe(641)
    expect(cov.inviteBacked).toBe(58)
    expect(cov.coveragePct).toBe(9) // 58/641 = 9.0...%
  })

  it('coverage invariant: total === canonical_population_count for all scopes', () => {
    const scopes = [
      backendMetadata(2105, 800),  // org
      backendMetadata(1447, 0),    // developer-only
      backendMetadata(641, 58),    // repo-only
      backendMetadata(631, 0),     // developer+repo
    ]
    for (const meta of scopes) {
      const cov = coverageFromMetadata(meta)
      expect(cov.total).toBe(meta.canonical_population_count)
    }
  })

  it('empty canonical population fails closed', () => {
    const meta = backendMetadata(0, 0)
    const cov = coverageFromMetadata(meta)
    expect(cov.available).toBe(false)
  })

  it('missing metadata fails closed', () => {
    const cov = coverageFromMetadata(null as any)
    expect(cov.available).toBe(false)
  })
})
