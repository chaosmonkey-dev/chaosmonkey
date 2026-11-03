import { describe, it, expect } from 'vitest'
import { generateMultiDimensionalInsights } from '../lib/insights/final/generators/multiDimensional'
import {
  resolveCanonicalFamilyId,
  isCanonicalInsightId,
  getRuntimeInstanceFamilies,
} from '../lib/insights/final/canonicalInsights'
import { normalizeRepoUrl } from '../lib/repoNormalization'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

/**
 * ============================================================================
 * CR-X Wave 1B — Multi-Dimensional Analysis Families Tests
 * ============================================================================
 *
 * Covers the 16 required test areas:
 *  1. recent-change__* survives canonical runtime-family resolution
 *  2. invalid unknown runtime families still fail
 *  3. repo normalization
 *  4. same-workflow / cross-repo behavior comparison
 *  5. sample/materiality suppression
 *  6. human-interactive metric legality
 *  7. delegated-agent metric legality
 *  8. observed commit provenance
 *  9. observed TTFC provenance
 * 10. temporal prior/recent window comparison
 * 11. repo allocation comparison
 * 12. repo allocation shift
 * 13. insufficient temporal depth suppression
 * 14. insufficient repo diversity suppression
 * 15. no incompatible cross-surface claims
 * 16. new runtime-instance family IDs survive canonical filtering
 * ============================================================================
 */

// ── Test helpers ──────────────────────────────────────────────────────────

function buildSession(opts: {
  tool: string
  timestamp: string
  duration_ms?: number
  active_coding_duration_ms?: number | null
  ai_burst_count?: number
  git_repo_url?: string
  session_commits?: number
  session_commits_source?: string
  time_to_first_commit_ms?: number
  ttfc_source?: string
  user_id?: string
}): Record<string, unknown> {
  const isDelegated = opts.tool === 'devin' || opts.tool === 'claude_code'
  const durMs = opts.duration_ms ?? 30 * 60000
  const row: Record<string, unknown> = {
    session_id: `sess-${opts.tool}-${opts.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
    tool: opts.tool,
    session_source: opts.tool,
    timestamp: opts.timestamp,
    duration_ms: durMs,
    user_id: opts.user_id ?? 'dev-1',
    git_repo_url: opts.git_repo_url ?? 'https://github.com/org/repo1',
    git_branch: 'main',
    ai_burst_count: opts.ai_burst_count ?? 0,
    ai_usage_duration_ms: (opts.ai_burst_count ?? 0) * 120000,
    session_commits: opts.session_commits ?? 0,
    session_commits_source: opts.session_commits_source ?? 'observed',
  }
  if (opts.time_to_first_commit_ms !== undefined) {
    row.time_to_first_commit_ms = opts.time_to_first_commit_ms
    row.ttfc_source = opts.ttfc_source ?? 'observed'
  }
  if (isDelegated) {
    row.active_coding_duration_ms = undefined
    row.focus_ratio = undefined
  } else {
    row.active_coding_duration_ms = opts.active_coding_duration_ms ?? durMs * 0.5
  }
  if (typeof row.duration_ms === 'number' && row.duration_ms > 0) {
    row.session_duration_minutes = row.duration_ms / 60000
  }
  if (!isDelegated && typeof row.active_coding_duration_ms === 'number') {
    row.session_active_coding_duration_minutes = row.active_coding_duration_ms / 60000
  }
  return row
}

function daysAgoISO(days: number, hour = 11): string {
  const ref = new Date('2026-09-13T11:00:00.000Z').getTime()
  return new Date(ref - days * 86400000 + hour * 3600000).toISOString()
}

function buildInput(rows: Record<string, unknown>[]): CanonicalInsightInput {
  return {
    sessionRows: rows,
    githubByPeriod: [],
    prByPeriod: [],
    outcomesByMonth: [],
    githubSnapshot: {},
    productivityByPeriod: [],
    granularity: 'daily',
    externalCostConfigs: [],
    populationContext: { scope: 'org' },
    timeSemantics: { observedThroughMs: new Date('2026-09-13T11:00:00.000Z').getTime() },
  } as unknown as CanonicalInsightInput
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CR-X Wave 1B: recent-change canonical runtime-family fix', () => {
  it('1. recent-change__* survives canonical runtime-family resolution', () => {
    const families = getRuntimeInstanceFamilies()
    expect(families.has('recent-change')).toBe(true)

    const testIds = [
      'recent-change__session_volume__cursor',
      'recent-change__active_coding__vscode',
      'recent-change__agent_runtime__devin',
      'recent-change__repo_concentration__claude_code',
    ]
    for (const id of testIds) {
      expect(resolveCanonicalFamilyId(id)).toBe('recent-change')
      expect(isCanonicalInsightId(id)).toBe(true)
    }
  })

  it('2. invalid unknown runtime families still fail canonical resolution', () => {
    expect(resolveCanonicalFamilyId('nonexistent-family__foo')).toBeNull()
    expect(isCanonicalInsightId('nonexistent-family__foo')).toBe(false)
    expect(resolveCanonicalFamilyId('recent-change__')).toBeNull()
    expect(resolveCanonicalFamilyId('recent-change')).toBe('recent-change')
  })
})

describe('CR-X Wave 1B: new family canonical registration', () => {
  it('16. new runtime-instance family IDs survive canonical filtering', () => {
    const families = getRuntimeInstanceFamilies()
    const newFamilies = [
      'repo-conditioned-behavior',
      'workflow-repo-allocation',
      'within-workflow-temporal-behavior',
      'workflow-repo-allocation-shift',
    ]
    for (const f of newFamilies) {
      expect(families.has(f)).toBe(true)
    }

    const testIds = [
      'repo-conditioned-behavior__cursor__active_coding',
      'workflow-repo-allocation__cursor_vs_vscode',
      'within-workflow-temporal-behavior__commits_per_session__devin',
      'workflow-repo-allocation-shift__claude_code',
    ]
    for (const id of testIds) {
      const baseId = id.split('__')[0]
      expect(resolveCanonicalFamilyId(id)).toBe(baseId)
      expect(isCanonicalInsightId(id)).toBe(true)
    }
  })
})

describe('CR-X Wave 1B: repo normalization', () => {
  it('3. normalizeRepoUrl handles all URL forms', () => {
    expect(normalizeRepoUrl('https://github.com/owner/repo.git')).toBe('owner/repo')
    expect(normalizeRepoUrl('git@github.com:owner/repo.git')).toBe('owner/repo')
    expect(normalizeRepoUrl('https://github.com/owner/repo')).toBe('owner/repo')
    expect(normalizeRepoUrl('https://user@github.com/owner/repo.git')).toBe('owner/repo')
    expect(normalizeRepoUrl('https://dev.azure.com/org/proj/_git/repo')).toBe('azure:org/repo')
    expect(normalizeRepoUrl(null)).toBeNull()
    expect(normalizeRepoUrl('')).toBeNull()
    expect(normalizeRepoUrl('owner/repo')).toBe('owner/repo')
  })
})

describe('CR-X Wave 1B: Family 1 — Repo-Conditioned Behavior (W×R×B)', () => {
  it('4. same-workflow / cross-repo behavior comparison fires on material difference', () => {
    // Cursor with 2 repos, materially different active coding
    const rows: Record<string, unknown>[] = []
    // Repo A: 20 sessions, 60 min active coding each
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        active_coding_duration_ms: 60 * 60000,
        git_repo_url: 'https://github.com/org/repo-a',
      }))
    }
    // Repo B: 20 sessions, 15 min active coding each (4x difference)
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        active_coding_duration_ms: 15 * 60000,
        git_repo_url: 'https://github.com/org/repo-b',
      }))
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const rcb = findings.filter(f => f.id.startsWith('repo-conditioned-behavior__'))
    expect(rcb.length).toBeGreaterThan(0)
    const top = rcb[0]
    expect(top.title).toContain('Cursor')
    // P7: titles now read as conclusions, not database queries
    expect(top.title).toMatch(/more active|more frequently|faster|longer/i)
    expect(top.evidence.length).toBeGreaterThan(0)
    expect(top.lifecycleClass).toBe('decision')
  })

  it('5. sample/materiality suppression — no finding for trivial variation', () => {
    // Cursor with 2 repos, but values are nearly identical
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        active_coding_duration_ms: 30 * 60000,
        git_repo_url: 'https://github.com/org/repo-a',
      }))
    }
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        active_coding_duration_ms: 31 * 60000, // ~3% difference, not material
        git_repo_url: 'https://github.com/org/repo-b',
      }))
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const rcb = findings.filter(f => f.id.startsWith('repo-conditioned-behavior__'))
    expect(rcb.length).toBe(0)
  })

  it('6. human-interactive metric legality — active coding used for cursor, not runtime', () => {
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        active_coding_duration_ms: 60 * 60000,
        git_repo_url: 'https://github.com/org/repo-a',
      }))
    }
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        active_coding_duration_ms: 15 * 60000,
        git_repo_url: 'https://github.com/org/repo-b',
      }))
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const rcb = findings.filter(f => f.id.startsWith('repo-conditioned-behavior__cursor__active_coding'))
    expect(rcb.length).toBeGreaterThan(0)
    // Should NOT have agent_runtime metric for cursor
    const runtimeFindings = findings.filter(f => f.id.startsWith('repo-conditioned-behavior__cursor__agent_runtime'))
    expect(runtimeFindings.length).toBe(0)
  })

  it('7. delegated-agent metric legality — runtime used for devin, not active coding', () => {
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'devin',
        timestamp: daysAgoISO(i % 28),
        duration_ms: 120 * 60000,
        git_repo_url: 'https://github.com/org/repo-a',
      }))
    }
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'devin',
        timestamp: daysAgoISO(i % 28),
        duration_ms: 30 * 60000, // 4x difference in runtime
        git_repo_url: 'https://github.com/org/repo-b',
      }))
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const runtimeFindings = findings.filter(f => f.id.startsWith('repo-conditioned-behavior__devin__agent_runtime'))
    expect(runtimeFindings.length).toBeGreaterThan(0)
    // Should NOT have active_coding metric for devin
    const activeCodingFindings = findings.filter(f => f.id.startsWith('repo-conditioned-behavior__devin__active_coding'))
    expect(activeCodingFindings.length).toBe(0)
  })

  it('8. observed commit provenance — only observed commits used', () => {
    const rows: Record<string, unknown>[] = []
    // Repo A: 20 sessions with observed commits = 3
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        session_commits: 3,
        session_commits_source: 'observed',
        git_repo_url: 'https://github.com/org/repo-a',
      }))
    }
    // Repo B: 20 sessions with observed commits = 1
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        session_commits: 1,
        session_commits_source: 'observed',
        git_repo_url: 'https://github.com/org/repo-b',
      }))
    }
    // Repo C: 20 sessions with synthetic commits (should be excluded)
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        session_commits: 10,
        session_commits_source: 'synthetic',
        git_repo_url: 'https://github.com/org/repo-c',
      }))
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const commitFindings = findings.filter(f => f.id.startsWith('repo-conditioned-behavior__cursor__commits_per_session'))
    if (commitFindings.length > 0) {
      // The finding should compare repo-a and repo-b (both observed), not repo-c
      const desc = commitFindings[0].description || ''
      expect(desc).not.toContain('repo-c')
    }
  })

  it('9. observed TTFC provenance — only observed TTFC used', () => {
    const rows: Record<string, unknown>[] = []
    // Repo A: 20 sessions with observed TTFC = 5 min
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        time_to_first_commit_ms: 5 * 60000,
        ttfc_source: 'observed',
        git_repo_url: 'https://github.com/org/repo-a',
      }))
    }
    // Repo B: 20 sessions with observed TTFC = 30 min (6x difference)
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        time_to_first_commit_ms: 30 * 60000,
        ttfc_source: 'observed',
        git_repo_url: 'https://github.com/org/repo-b',
      }))
    }
    // Repo C: 20 sessions with synthetic TTFC (should be excluded)
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        time_to_first_commit_ms: 1 * 60000,
        ttfc_source: 'synthetic',
        git_repo_url: 'https://github.com/org/repo-c',
      }))
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const ttfcFindings = findings.filter(f => f.id.startsWith('repo-conditioned-behavior__cursor__ttfc'))
    if (ttfcFindings.length > 0) {
      const desc = ttfcFindings[0].description || ''
      expect(desc).not.toContain('repo-c')
    }
  })

  it('14. insufficient repo diversity suppression — single repo produces no finding', () => {
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < 50; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        active_coding_duration_ms: 30 * 60000,
        git_repo_url: 'https://github.com/org/single-repo',
      }))
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const rcb = findings.filter(f => f.id.startsWith('repo-conditioned-behavior__'))
    expect(rcb.length).toBe(0)
  })
})

describe('CR-X Wave 1B: Family 2 — Workflow × Repo Allocation (W×R)', () => {
  it('11. repo allocation comparison fires on material divergence', () => {
    const rows: Record<string, unknown>[] = []
    // Cursor: concentrated in repo-a (90%)
    for (let i = 0; i < 45; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        git_repo_url: 'https://github.com/org/repo-a',
      }))
    }
    for (let i = 0; i < 5; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        git_repo_url: 'https://github.com/org/repo-b',
      }))
    }
    // VS Code: concentrated in repo-b (90%)
    for (let i = 0; i < 45; i++) {
      rows.push(buildSession({
        tool: 'vscode',
        timestamp: daysAgoISO(i % 28),
        git_repo_url: 'https://github.com/org/repo-b',
      }))
    }
    for (let i = 0; i < 5; i++) {
      rows.push(buildSession({
        tool: 'vscode',
        timestamp: daysAgoISO(i % 28),
        git_repo_url: 'https://github.com/org/repo-a',
      }))
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const alloc = findings.filter(f => f.id.startsWith('workflow-repo-allocation__'))
    expect(alloc.length).toBeGreaterThan(0)
    expect(alloc[0].title).toContain('concentrated in')
  })

  it('11b. disjoint repo sets produce a finding', () => {
    const rows: Record<string, unknown>[] = []
    // Cursor: only repo-a
    for (let i = 0; i < 40; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        git_repo_url: 'https://github.com/org/repo-a',
      }))
    }
    // VS Code: only repo-b (disjoint)
    for (let i = 0; i < 40; i++) {
      rows.push(buildSession({
        tool: 'vscode',
        timestamp: daysAgoISO(i % 28),
        git_repo_url: 'https://github.com/org/repo-b',
      }))
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const alloc = findings.filter(f => f.id.startsWith('workflow-repo-allocation__'))
    expect(alloc.length).toBeGreaterThan(0)
    expect(alloc[0].title).toContain('entirely different repositories')
  })

  it('11c. insufficient workflow diversity — single workflow produces no finding', () => {
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < 50; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        git_repo_url: `https://github.com/org/repo-${i % 3}`,
      }))
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const alloc = findings.filter(f => f.id.startsWith('workflow-repo-allocation__'))
    expect(alloc.length).toBe(0)
  })
})

describe('CR-X Wave 1B: Family 3 — Within-Workflow Temporal Behavior (W×B×T)', () => {
  it('10. temporal prior/recent window comparison fires on material change', () => {
    const rows: Record<string, unknown>[] = []
    // 28 days of cursor sessions. Recent 7 days: 5 commits/session. Prior 7 days: 2 commits/session.
    // Need enough sessions in each window (≥5 per workflow per window)
    for (let d = 0; d < 7; d++) {
      // Recent window: days 0-6
      for (let s = 0; s < 3; s++) {
        rows.push(buildSession({
          tool: 'cursor',
          timestamp: daysAgoISO(d, s * 3),
          session_commits: 5,
          session_commits_source: 'observed',
          git_repo_url: 'https://github.com/org/repo-a',
        }))
      }
    }
    for (let d = 7; d < 14; d++) {
      // Prior window: days 7-13
      for (let s = 0; s < 3; s++) {
        rows.push(buildSession({
          tool: 'cursor',
          timestamp: daysAgoISO(d, s * 3),
          session_commits: 2,
          session_commits_source: 'observed',
          git_repo_url: 'https://github.com/org/repo-a',
        }))
      }
    }
    // Extra history to ensure 7d-vs-7d window selection
    for (let d = 14; d < 28; d++) {
      for (let s = 0; s < 2; s++) {
        rows.push(buildSession({
          tool: 'cursor',
          timestamp: daysAgoISO(d, s * 3),
          session_commits: 2,
          session_commits_source: 'observed',
          git_repo_url: 'https://github.com/org/repo-a',
        }))
      }
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const temporal = findings.filter(f => f.id.startsWith('within-workflow-temporal-behavior__'))
    expect(temporal.length).toBeGreaterThan(0)
    const commitFinding = temporal.find(f => f.id.includes('commits_per_session'))
    if (commitFinding) {
      expect(commitFinding.title).toContain('Cursor')
      expect(commitFinding.title).toContain('commits per session')
      // P7: within-workflow temporal uses its own presentationKind
      expect(commitFinding.presentationKind).toBe('within_workflow_temporal')
    }
  })

  it('10b. TTFC temporal change fires with material difference', () => {
    const rows: Record<string, unknown>[] = []
    for (let d = 0; d < 7; d++) {
      for (let s = 0; s < 3; s++) {
        rows.push(buildSession({
          tool: 'cursor',
          timestamp: daysAgoISO(d, s * 3),
          time_to_first_commit_ms: 30 * 60000, // 30 min recent
          ttfc_source: 'observed',
          git_repo_url: 'https://github.com/org/repo-a',
        }))
      }
    }
    for (let d = 7; d < 14; d++) {
      for (let s = 0; s < 3; s++) {
        rows.push(buildSession({
          tool: 'cursor',
          timestamp: daysAgoISO(d, s * 3),
          time_to_first_commit_ms: 5 * 60000, // 5 min prior
          ttfc_source: 'observed',
          git_repo_url: 'https://github.com/org/repo-a',
        }))
      }
    }
    for (let d = 14; d < 28; d++) {
      for (let s = 0; s < 2; s++) {
        rows.push(buildSession({
          tool: 'cursor',
          timestamp: daysAgoISO(d, s * 3),
          time_to_first_commit_ms: 5 * 60000,
          ttfc_source: 'observed',
          git_repo_url: 'https://github.com/org/repo-a',
        }))
      }
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const temporal = findings.filter(f => f.id.startsWith('within-workflow-temporal-behavior__ttfc__'))
    expect(temporal.length).toBeGreaterThan(0)
  })

  it('13. insufficient temporal depth suppression — <3 observed days produces no temporal finding', () => {
    const rows: Record<string, unknown>[] = []
    // Only 2 days of data
    for (let d = 0; d < 2; d++) {
      for (let s = 0; s < 20; s++) {
        rows.push(buildSession({
          tool: 'cursor',
          timestamp: daysAgoISO(d),
          session_commits: 5,
          session_commits_source: 'observed',
          git_repo_url: 'https://github.com/org/repo-a',
        }))
      }
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const temporal = findings.filter(f => f.id.startsWith('within-workflow-temporal-behavior__'))
    expect(temporal.length).toBe(0)
  })

  it('10c. no material change produces no temporal finding', () => {
    const rows: Record<string, unknown>[] = []
    for (let d = 0; d < 28; d++) {
      for (let s = 0; s < 3; s++) {
        rows.push(buildSession({
          tool: 'cursor',
          timestamp: daysAgoISO(d, s * 3),
          session_commits: 3, // Same in both windows
          session_commits_source: 'observed',
          git_repo_url: 'https://github.com/org/repo-a',
        }))
      }
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const temporal = findings.filter(f => f.id.startsWith('within-workflow-temporal-behavior__'))
    expect(temporal.length).toBe(0)
  })
})

describe('CR-X Wave 1B: Family 4 — Workflow × Repo Allocation Shift (W×R×T)', () => {
  it('12. repo allocation shift fires on material share change', () => {
    const rows: Record<string, unknown>[] = []
    // Recent 7 days: cursor 80% in repo-a, 20% in repo-b
    for (let d = 0; d < 7; d++) {
      for (let s = 0; s < 8; s++) {
        rows.push(buildSession({
          tool: 'cursor',
          timestamp: daysAgoISO(d, s * 2),
          git_repo_url: 'https://github.com/org/repo-a',
        }))
      }
      for (let s = 0; s < 2; s++) {
        rows.push(buildSession({
          tool: 'cursor',
          timestamp: daysAgoISO(d, s * 2 + 1),
          git_repo_url: 'https://github.com/org/repo-b',
        }))
      }
    }
    // Prior 7 days: cursor 20% in repo-a, 80% in repo-b (reversed)
    for (let d = 7; d < 14; d++) {
      for (let s = 0; s < 2; s++) {
        rows.push(buildSession({
          tool: 'cursor',
          timestamp: daysAgoISO(d, s * 2),
          git_repo_url: 'https://github.com/org/repo-a',
        }))
      }
      for (let s = 0; s < 8; s++) {
        rows.push(buildSession({
          tool: 'cursor',
          timestamp: daysAgoISO(d, s * 2 + 1),
          git_repo_url: 'https://github.com/org/repo-b',
        }))
      }
    }
    // Extra history
    for (let d = 14; d < 28; d++) {
      for (let s = 0; s < 5; s++) {
        rows.push(buildSession({
          tool: 'cursor',
          timestamp: daysAgoISO(d, s * 2),
          git_repo_url: 'https://github.com/org/repo-b',
        }))
      }
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const shift = findings.filter(f => f.id.startsWith('workflow-repo-allocation-shift__'))
    expect(shift.length).toBeGreaterThan(0)
    expect(shift[0].title).toMatch(/moved|shifted/i)
  })

  it('12b. no material shift produces no finding', () => {
    const rows: Record<string, unknown>[] = []
    // Consistent allocation across both windows
    for (let d = 0; d < 28; d++) {
      for (let s = 0; s < 5; s++) {
        rows.push(buildSession({
          tool: 'cursor',
          timestamp: daysAgoISO(d, s * 2),
          git_repo_url: d % 2 === 0 ? 'https://github.com/org/repo-a' : 'https://github.com/org/repo-b',
        }))
      }
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const shift = findings.filter(f => f.id.startsWith('workflow-repo-allocation-shift__'))
    expect(shift.length).toBe(0)
  })
})

describe('CR-X Wave 1B: Mode / Comparability Contract', () => {
  it('15. no incompatible cross-surface claims — devin never uses active_coding metric', () => {
    const rows: Record<string, unknown>[] = []
    // Devin across 2 repos with materially different runtime
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'devin',
        timestamp: daysAgoISO(i % 28),
        duration_ms: 120 * 60000,
        git_repo_url: 'https://github.com/org/repo-a',
      }))
    }
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'devin',
        timestamp: daysAgoISO(i % 28),
        duration_ms: 30 * 60000,
        git_repo_url: 'https://github.com/org/repo-b',
      }))
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    // Devin should have agent_runtime findings, NOT active_coding
    const activeCodingForDevin = findings.filter(f =>
      f.id.includes('devin') && f.id.includes('active_coding')
    )
    expect(activeCodingForDevin.length).toBe(0)

    const runtimeForDevin = findings.filter(f =>
      f.id.includes('devin') && f.id.includes('agent_runtime')
    )
    expect(runtimeForDevin.length).toBeGreaterThan(0)
  })

  it('15b. cursor never uses agent_runtime metric', () => {
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        duration_ms: 120 * 60000,
        active_coding_duration_ms: 60 * 60000,
        git_repo_url: 'https://github.com/org/repo-a',
      }))
    }
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({
        tool: 'cursor',
        timestamp: daysAgoISO(i % 28),
        duration_ms: 30 * 60000,
        active_coding_duration_ms: 15 * 60000,
        git_repo_url: 'https://github.com/org/repo-b',
      }))
    }

    const findings = generateMultiDimensionalInsights(buildInput(rows))
    const runtimeForCursor = findings.filter(f =>
      f.id.includes('cursor') && f.id.includes('agent_runtime')
    )
    expect(runtimeForCursor.length).toBe(0)
  })
})

describe('CR-X Wave 1B: empty input safety', () => {
  it('empty session rows produces no findings', () => {
    const findings = generateMultiDimensionalInsights(buildInput([]))
    expect(findings).toEqual([])
  })

  it('null session rows produces no findings', () => {
    const input = buildInput([])
    input.sessionRows = null as unknown as any[]
    const findings = generateMultiDimensionalInsights(input)
    expect(findings).toEqual([])
  })
})
