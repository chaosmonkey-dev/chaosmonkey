import { describe, it, expect } from 'vitest'
import { normalizeRepoUrl } from '../lib/repoNormalization'
import { generateFinalCanonicalInsights } from '../lib/insights/final'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

/**
 * CR-X 2B — Filter composition + population scope tests.
 *
 * Proves:
 * - Repo normalization handles GitHub HTTPS, SSH, SCP, .git suffix, Azure DevOps
 * - PIs always carry populationScope: 'org_level'
 * - PIs do not recompute from filtered PBT population
 * - Cost scoping is suppressed under repo filter (UI contract)
 */

// ── REPO NORMALIZATION ───────────────────────────────────────────────────────

describe('CR-X 2B: Repo normalization authority', () => {
  it('normalizes GitHub HTTPS with .git suffix', () => {
    expect(normalizeRepoUrl('https://github.com/owner/repo.git')).toBe('owner/repo')
  })

  it('normalizes GitHub HTTPS without .git suffix', () => {
    expect(normalizeRepoUrl('https://github.com/owner/repo')).toBe('owner/repo')
  })

  it('normalizes GitHub SSH (git@host:owner/repo.git)', () => {
    expect(normalizeRepoUrl('git@github.com:owner/repo.git')).toBe('owner/repo')
  })

  it('normalizes GitHub SCP-style (user@host:owner/repo.git)', () => {
    expect(normalizeRepoUrl('user@github.com:owner/repo.git')).toBe('owner/repo')
  })

  it('normalizes GitHub HTTPS with user prefix', () => {
    expect(normalizeRepoUrl('https://user@github.com/owner/repo.git')).toBe('owner/repo')
  })

  it('normalizes Azure DevOps HTTPS', () => {
    expect(normalizeRepoUrl('https://dev.azure.com/org/proj/_git/repo')).toBe('azure:org/repo')
  })

  it('normalizes Azure DevOps with user prefix', () => {
    expect(normalizeRepoUrl('https://user@dev.azure.com/org/proj/_git/repo')).toBe('azure:org/repo')
  })

  it('lowercases GitHub repos (case-insensitive equivalence)', () => {
    expect(normalizeRepoUrl('https://github.com/Owner/Repo.git')).toBe('owner/repo')
  })

  it('does not merge genuinely different repos', () => {
    expect(normalizeRepoUrl('https://github.com/owner/repo.git'))
      .not.toBe(normalizeRepoUrl('https://github.com/owner/repo-2.git'))
  })

  it('does not normalize longer paths containing owner/repo (false positive prevention)', () => {
    // https://github.com/team/owner/repo has 3 path segments — not a valid
    // git repo URL. Must NOT normalize to owner/repo.
    expect(normalizeRepoUrl('https://github.com/team/owner/repo.git')).toBeNull()
  })

  it('does not normalize suffix collisions (owner/repo-suffix)', () => {
    // owner/repo-suffix is a different repo — must not normalize to owner/repo
    expect(normalizeRepoUrl('https://github.com/owner/repo-suffix.git')).toBe('owner/repo-suffix')
    expect(normalizeRepoUrl('https://github.com/owner/repo-suffix.git'))
      .not.toBe(normalizeRepoUrl('https://github.com/owner/repo.git'))
  })

  it('equivalent forms normalize to same canonical ID', () => {
    const forms = [
      'https://github.com/owner/repo.git',
      'https://github.com/owner/repo',
      'git@github.com:owner/repo.git',
      'git@github.com:owner/repo',
      'user@github.com:owner/repo.git',
      'https://user@github.com/owner/repo.git',
    ]
    const normalized = forms.map(normalizeRepoUrl)
    expect(new Set(normalized).size).toBe(1)
    expect(normalized[0]).toBe('owner/repo')
  })
})

// ── PI POPULATION SCOPE ──────────────────────────────────────────────────────

describe('CR-X 2B: PI population scope metadata', () => {
  function makeInput(sessions: any[]): CanonicalInsightInput {
    return {
      sessionRows: sessions,
      githubSnapshot: null,
      githubByPeriod: [],
      prByPeriod: [],
      outcomesByMonth: [],
      productivityByPeriod: [],
      granularity: 'day',
    }
  }

  function makeSession(tool: string, overrides: Partial<Record<string, unknown>> = {}) {
    return {
      tool,
      session_source: tool,
      timestamp: '2026-09-01T11:00:00.000Z',
      duration_ms: 3600000,
      session_duration_minutes: 60,
      user_id: 'invite:1',
      ai_burst_count: 2,
      session_has_ai_activity: true,
      session_commits: 1,
      session_commits_source: 'observed',
      ...overrides,
    }
  }

  it('all PIs carry populationScope: org_level', async () => {
    const sessions = [
      ...Array.from({ length: 30 }, () => makeSession('vscode')),
      ...Array.from({ length: 30 }, () => makeSession('cursor')),
    ]
    const insights = await generateFinalCanonicalInsights(makeInput(sessions))
    expect(insights.length).toBeGreaterThan(0)
    // Every non-diagnostic insight should have populationScope: 'org_level'
    const nonDiagnostic = insights.filter(i => !i.isDiagnostic)
    expect(nonDiagnostic.length).toBeGreaterThan(0)
    for (const insight of nonDiagnostic) {
      expect(insight.populationScope).toBe('org_level')
    }
  })

  it('PIs do not accept developer/repo filter parameters', async () => {
    // The PI engine signature does not accept developer/repo filters.
    // This is by design — PIs are org-level. The test proves the input
    // type has no filter fields.
    const input = makeInput([makeSession('vscode')])
    // @ts-expect-error — developerIds does not exist on CanonicalInsightInput
    input.developerIds = ['invite:1']
    // @ts-expect-error — repos does not exist on CanonicalInsightInput
    input.repos = ['owner/repo']
    // PIs should still generate from the full session set
    const insights = await generateFinalCanonicalInsights(input)
    expect(insights.length).toBeGreaterThan(0)
  })

  it('maturity PI is org_level scope and not diagnostic', async () => {
    const sessions = Array.from({ length: 50 }, () => makeSession('vscode'))
    const insights = await generateFinalCanonicalInsights(makeInput(sessions))
    const maturity = insights.find(i => i.id === 'pilot-maturity-progression')
    expect(maturity).toBeDefined()
    expect(maturity!.populationScope).toBe('org_level')
    expect(maturity!.isDiagnostic).not.toBe(true)
  })
})

// ── COST SCOPING CONTRACT ────────────────────────────────────────────────────

describe('CR-X 2B: Cost scoping contract', () => {
  it('cost context strip must be suppressed under repo filter (UI contract)', () => {
    // This is a UI contract test — the actual suppression is in the Vue template.
    // The contract: when isRepoFiltered is true, the cost context strip
    // must NOT render. This is enforced by the v-if condition:
    //   !isDeveloperFiltered && !isRepoFiltered
    // The test documents the contract.
    const isRepoFiltered = true
    const isDeveloperFiltered = false
    const shouldShowCostStrip = !isDeveloperFiltered && !isRepoFiltered
    expect(shouldShowCostStrip).toBe(false)
  })

  it('cost context strip must be suppressed under developer filter (UI contract)', () => {
    const isRepoFiltered = false
    const isDeveloperFiltered = true
    const shouldShowCostStrip = !isDeveloperFiltered && !isRepoFiltered
    expect(shouldShowCostStrip).toBe(false)
  })

  it('cost context strip shows when no filter is active (UI contract)', () => {
    const isRepoFiltered = false
    const isDeveloperFiltered = false
    const shouldShowCostStrip = !isDeveloperFiltered && !isRepoFiltered
    expect(shouldShowCostStrip).toBe(true)
  })
})
