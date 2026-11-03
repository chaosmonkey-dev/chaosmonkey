import { describe, it, expect } from 'vitest'
import {
  buildSessionEvidence,
  buildPullRequestEvidence,
  resolveDeliveryAttribution,
  canAttributeDeliveryToWorkflow,
} from '../lib/insights/final/attribution/attributionIntegration'
import { resolveAttribution } from '../lib/insights/final/attribution/attributionEngine'

describe('CR-X Attribution Integration', () => {
  it('returns org_level_only when no PR evidence is available', () => {
    const summary = resolveDeliveryAttribution(
      [{ session_id: 's1', git_repo_url: 'org/repo', git_branch: 'main', workflow: 'cursor' }],
      { pr_review_metrics: { total_prs: 5 } },
    )
    expect(summary.maxLevel).toBe('L4')
    expect(summary.status).toBe('org_level_only')
    expect(summary.canAttributeToWorkflow).toBe(false)
    expect(summary.prEvidenceCount).toBe(0)
    expect(summary.provenanceLabel).not.toContain('workflow-attributed')
  })

  it('resolves L1 when a session commit SHA is in the PR commit set', () => {
    const sessions = [
      {
        session_id: 's1',
        git_repo_url: 'org/repo',
        git_branch: 'feature',
        workflow: 'cursor',
        session_commit_shas: ['abc1234'],
      },
    ]
    const snapshot = {
      prs: [
        {
          id: 101,
          repo: 'org/repo',
          head_sha: 'abc1234',
          commit_shas: ['abc1234', 'def5678'],
          merged_at: '2026-09-01T10:00:00Z',
          data_source: 'live',
        },
      ],
    }
    const summary = resolveDeliveryAttribution(sessions, snapshot)
    expect(summary.maxLevel).toBe('L1')
    expect(summary.status).toBe('workflow_attributed_l1')
    expect(summary.canAttributeToWorkflow).toBe(true)
    expect(summary.attributedSessionCount).toBe(1)
  })

  it('resolves L3 (directional, not attributed) for repo+temporal only', () => {
    const sessions = [
      {
        session_id: 's1',
        git_repo_url: 'org/repo',
        git_branch: 'feature',
        workflow: 'cursor',
        session_start: '2026-08-30T10:00:00Z',
        session_end: '2026-08-30T12:00:00Z',
      },
    ]
    const snapshot = {
      prs: [
        {
          id: 101,
          repo: 'org/repo',
          head_ref: 'other-branch',
          merged_at: '2026-08-31T10:00:00Z',
          data_source: 'live',
        },
      ],
    }
    const summary = resolveDeliveryAttribution(sessions, snapshot)
    expect(summary.maxLevel).toBe('L3')
    expect(summary.status).toBe('directional_l3')
    expect(summary.canAttributeToWorkflow).toBe(false)
  })

  it('canAttributeDeliveryToWorkflow is false when only aggregates exist', () => {
    expect(
      canAttributeDeliveryToWorkflow(
        [{ git_repo_url: 'org/repo', workflow: 'cursor' }],
        { pr_review_metrics: { total_prs: 10, review_count: 20 } },
      ),
    ).toBe(false)
  })

  it('degrades ambiguous L2 matches to L3 (refuses to guess)', () => {
    const sessions = [
      {
        session_id: 's1',
        git_repo_url: 'org/repo',
        git_branch: 'feature',
        workflow: 'cursor',
        developer_id: 'dev1',
        session_start: '2026-08-30T10:00:00Z',
        session_end: '2026-08-30T12:00:00Z',
        start_head_sha: 'aaa',
      },
    ]
    // Two PRs same repo/branch/compatible dev/temporal -> ambiguous L2 -> L3
    const snapshot = {
      prs: [
        { id: 1, repo: 'org/repo', head_ref: 'feature', author_login: 'dev1', merged_at: '2026-08-30T11:00:00Z', data_source: 'live' },
        { id: 2, repo: 'org/repo', head_ref: 'feature', author_login: 'dev1', merged_at: '2026-08-30T11:30:00Z', data_source: 'live' },
      ],
    }
    const summary = resolveDeliveryAttribution(sessions, snapshot)
    expect(summary.maxLevel).toBe('L3')
    expect(summary.canAttributeToWorkflow).toBe(false)
  })

  it('buildSessionEvidence skips sessions without a repo', () => {
    const out = buildSessionEvidence([
      { session_id: 's1', git_repo_url: 'org/repo' },
      { session_id: 's2' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sessionId).toBe('s1')
  })

  it('buildPullRequestEvidence reads Track-A lineage shape and ignores repo-less PRs', () => {
    const out = buildPullRequestEvidence({
      prs: [
        { id: 1, repo: 'org/repo', head_sha: 'a', commit_shas: ['a'] },
        { id: 2 },
      ],
    })
    expect(out).toHaveLength(1)
    expect(out[0].headSha).toBe('a')
  })

  it('never produces causal language in provenanceLabel', () => {
    const cases = [
      resolveDeliveryAttribution([], {}),
      resolveDeliveryAttribution([{ git_repo_url: 'r' }], { prs: [{ repo: 'r', merged_at: '2026-09-01T00:00:00Z' }] }),
      resolveDeliveryAttribution(
        [{ git_repo_url: 'r', session_commit_shas: ['a'] }],
        { prs: [{ repo: 'r', commit_shas: ['a'] }] },
      ),
    ]
    for (const c of cases) {
      expect(c.provenanceLabel).not.toMatch(/causes?|drives?|leads to/i)
    }
  })

  // ─── CR-X P0-2: L3 directional attribution via prs array + temporal derivation ───

  it('P0-2 A: buildPullRequestEvidence reads backend prs array shape (id, repo, user_login, data_source, created_at, merged_at)', () => {
    const out = buildPullRequestEvidence({
      prs: [
        { id: 1, pr_number: 42, repo: 'org/repo', user_login: 'dev1', data_source: 'cm_activity_sim', created_at: '2026-09-01T00:00:00Z', merged_at: '2026-09-02T00:00:00Z' },
        { id: 2, repo: 'org/repo2', user_login: 'dev2', data_source: 'demo', created_at: '2026-09-03T00:00:00Z', merged_at: null },
        { id: 3 }, // repo-less → dropped
      ],
    })
    expect(out).toHaveLength(2)
    expect(out[0].repo).toBe('org/repo')
    expect(out[0].authorLogin).toBe('dev1')
    expect(out[0].dataProvenance).toBe('cm_activity_sim')
    expect(out[0].createdAt).toBe('2026-09-01T00:00:00Z')
    expect(out[0].mergedAt).toBe('2026-09-02T00:00:00Z')
    expect(out[1].mergedAt).toBeNull()
  })

  it('P0-2 B: L3 positive match — same repo + correct temporal relationship via timestamp(=END)+duration_ms', () => {
    // timestamp = session END. duration_ms = 2h. sessionStart = timestamp - 2h.
    // PR merged_at within 72h of sessionEnd → L3.
    const T = '2026-09-10T14:28:33Z'
    const D = 2 * 3600_000 // 2h in ms
    const sessions = [
      { session_id: 's1', git_repo_url: 'https://github.com/org/repo.git', workflow: 'cursor', timestamp: T, duration_ms: D },
    ]
    const snapshot = {
      prs: [
        { id: 101, repo: 'org/repo', merged_at: '2026-09-10T15:00:00Z', data_source: 'cm_activity_sim' },
      ],
    }
    const summary = resolveDeliveryAttribution(sessions, snapshot)
    expect(summary.maxLevel).toBe('L3')
    expect(summary.status).toBe('directional_l3')
    expect(summary.canAttributeToWorkflow).toBe(false)
    expect(summary.prEvidenceCount).toBe(1)
  })

  it('P0-2 B-dir: TEMPORAL DIRECTION REGRESSION — PR at T+73h is L4 under correct [T-D,T], would be L3 under wrong [T,T+D]', () => {
    // CRITICAL: timestamp = session END. Correct interval = [T-D, T].
    // Wrong forward-shifted interval = [T, T+D].
    // 72h tolerance: correct future boundary = T+72h; wrong = T+D+72h.
    // Discriminating fixture: PR merged_at = T+73h (beyond correct, inside wrong).
    const T = '2026-09-10T14:28:33Z'
    const Tms = Date.parse(T)
    const D = 2 * 3600_000 // 2h
    const prMergedAt = new Date(Tms + 73 * 3600_000).toISOString() // T + 73h

    const sessions = [
      { session_id: 's1', git_repo_url: 'https://github.com/org/repo.git', workflow: 'cursor', timestamp: T, duration_ms: D },
    ]
    const snapshot = {
      prs: [
        { id: 101, repo: 'org/repo', merged_at: prMergedAt, data_source: 'cm_activity_sim' },
      ],
    }
    const summary = resolveDeliveryAttribution(sessions, snapshot)

    // CORRECT derivation: sessionEnd = T, PR at T+73h is beyond T+72h → NO L3
    expect(summary.maxLevel).toBe('L4')
    expect(summary.status).toBe('org_level_only')

    // Direct engine proof: build SessionEvidence with the correct derivation and
    // confirm resolveAttribution returns L4 (not L3). This fails if anyone reverts
    // buildSessionEvidence to sessionStart=timestamp, sessionEnd=timestamp+duration_ms.
    const sessEv = buildSessionEvidence(sessions)[0]
    // Correct: sessionEnd = T, sessionStart = T - 2h
    expect(sessEv.sessionEnd).toBe(T)
    expect(sessEv.sessionStart).toBe(new Date(Tms - D).toISOString())
    const prEv = buildPullRequestEvidence(snapshot)[0]
    const direct = resolveAttribution(sessEv, prEv)
    expect(direct.level).toBe('L4')
  })

  it('P0-2 C: wrong repo → no L3 (L4)', () => {
    const sessions = [
      { session_id: 's1', git_repo_url: 'https://github.com/org/repoA.git', workflow: 'cursor', timestamp: '2026-09-10T14:28:33Z', duration_ms: 3600_000 },
    ]
    const snapshot = {
      prs: [
        { id: 101, repo: 'org/repoB', merged_at: '2026-09-10T15:00:00Z', data_source: 'demo' },
      ],
    }
    const summary = resolveDeliveryAttribution(sessions, snapshot)
    expect(summary.maxLevel).toBe('L4')
    expect(summary.status).toBe('org_level_only')
  })

  it('P0-2 D: outside temporal window → no L3 (L4)', () => {
    // Session end T, PR merged_at = T + 200h (well beyond 72h window)
    const T = '2026-09-10T14:28:33Z'
    const Tms = Date.parse(T)
    const sessions = [
      { session_id: 's1', git_repo_url: 'https://github.com/org/repo.git', workflow: 'cursor', timestamp: T, duration_ms: 3600_000 },
    ]
    const snapshot = {
      prs: [
        { id: 101, repo: 'org/repo', merged_at: new Date(Tms + 200 * 3600_000).toISOString(), data_source: 'demo' },
      ],
    }
    const summary = resolveDeliveryAttribution(sessions, snapshot)
    expect(summary.maxLevel).toBe('L4')
  })

  it('P0-2 E: developer mismatch cannot become L2 (L2 requires compatible developer + branch + Git context)', () => {
    // Same repo + branch + temporal, but developer mismatch and no Git context → L3 (not L2)
    const sessions = [
      { session_id: 's1', git_repo_url: 'https://github.com/org/repo.git', git_branch: 'feature', workflow: 'cursor', developer_id: 'devA', timestamp: '2026-09-10T14:28:33Z', duration_ms: 3600_000 },
    ]
    const snapshot = {
      prs: [
        { id: 101, repo: 'org/repo', head_ref: 'feature', author_login: 'devB', merged_at: '2026-09-10T15:00:00Z', data_source: 'demo' },
      ],
    }
    const summary = resolveDeliveryAttribution(sessions, snapshot)
    expect(summary.maxLevel).toBe('L3')
    expect(summary.canAttributeToWorkflow).toBe(false)
  })

  it('P0-2 F: direct SHA match remains L1 (P0-2 must not downgrade stronger evidence)', () => {
    const sessions = [
      { session_id: 's1', git_repo_url: 'https://github.com/org/repo.git', workflow: 'cursor', session_commit_shas: ['abc1234'], timestamp: '2026-09-10T14:28:33Z', duration_ms: 3600_000 },
    ]
    const snapshot = {
      prs: [
        { id: 101, repo: 'org/repo', commit_shas: ['abc1234', 'def5678'], merged_at: '2026-09-10T15:00:00Z', data_source: 'github_app' },
      ],
    }
    const summary = resolveDeliveryAttribution(sessions, snapshot)
    expect(summary.maxLevel).toBe('L1')
    expect(summary.status).toBe('workflow_attributed_l1')
    expect(summary.canAttributeToWorkflow).toBe(true)
  })

  it('P0-2 G: no session commit SHAs cannot become L1', () => {
    const sessions = [
      { session_id: 's1', git_repo_url: 'https://github.com/org/repo.git', workflow: 'cursor', timestamp: '2026-09-10T14:28:33Z', duration_ms: 3600_000 },
    ]
    const snapshot = {
      prs: [
        { id: 101, repo: 'org/repo', commit_shas: ['abc1234'], merged_at: '2026-09-10T15:00:00Z', data_source: 'github_app' },
      ],
    }
    const summary = resolveDeliveryAttribution(sessions, snapshot)
    expect(summary.maxLevel).not.toBe('L1')
    expect(summary.canAttributeToWorkflow).toBe(false)
  })

  it('P0-2 J: cm_activity_sim provenance remains cm_activity_sim (not relabeled live)', () => {
    const sessions = [
      { session_id: 's1', git_repo_url: 'https://github.com/org/repo.git', workflow: 'cursor', timestamp: '2026-09-10T14:28:33Z', duration_ms: 3600_000 },
    ]
    const snapshot = {
      prs: [
        { id: 101, repo: 'org/repo', merged_at: '2026-09-10T15:00:00Z', data_source: 'cm_activity_sim' },
      ],
    }
    const summary = resolveDeliveryAttribution(sessions, snapshot)
    expect(summary.results.length).toBeGreaterThan(0)
    expect(summary.results[0].provenance).toBe('cm_activity_sim')
  })

  it('P0-2 K: Claude Code session follows the same truthful L3 rule (no special stronger semantics)', () => {
    const sessions = [
      { session_id: 's1', git_repo_url: 'https://github.com/org/repo.git', workflow: 'claude-code', editor_source: 'claude-code', timestamp: '2026-09-10T14:28:33Z', duration_ms: 3600_000 },
    ]
    const snapshot = {
      prs: [
        { id: 101, repo: 'org/repo', merged_at: '2026-09-10T15:00:00Z', data_source: 'cm_activity_sim' },
      ],
    }
    const summary = resolveDeliveryAttribution(sessions, snapshot)
    expect(summary.maxLevel).toBe('L3')
    expect(summary.status).toBe('directional_l3')
    expect(summary.canAttributeToWorkflow).toBe(false)
  })

  it('P0-2 L: no PR/session double-count inflation (prEvidenceCount = #PRs, not sessions×PRs)', () => {
    const sessions = [
      { session_id: 's1', git_repo_url: 'https://github.com/org/repo.git', workflow: 'cursor', timestamp: '2026-09-10T14:28:33Z', duration_ms: 3600_000 },
      { session_id: 's2', git_repo_url: 'https://github.com/org/repo.git', workflow: 'cursor', timestamp: '2026-09-10T14:28:33Z', duration_ms: 3600_000 },
    ]
    const snapshot = {
      prs: [
        { id: 101, repo: 'org/repo', merged_at: '2026-09-10T15:00:00Z', data_source: 'demo' },
      ],
    }
    const summary = resolveDeliveryAttribution(sessions, snapshot)
    expect(summary.prEvidenceCount).toBe(1)
    expect(summary.totalSessions).toBe(2)
  })

  it('P0-2 M: existing org-level R&M/D&O regressions remain valid where no L3 evidence exists (no prs array)', () => {
    // No prs array → buildPullRequestEvidence returns [] → L4 org_level_only (unchanged behavior)
    const sessions = [
      { session_id: 's1', git_repo_url: 'https://github.com/org/repo.git', workflow: 'cursor', timestamp: '2026-09-10T14:28:33Z', duration_ms: 3600_000 },
    ]
    const snapshot = { pr_review_metrics: { total_prs: 5 } }
    const summary = resolveDeliveryAttribution(sessions, snapshot)
    expect(summary.maxLevel).toBe('L4')
    expect(summary.status).toBe('org_level_only')
    expect(summary.canAttributeToWorkflow).toBe(false)
    expect(summary.prEvidenceCount).toBe(0)
  })

  it('P0-2: zero-duration session (missing duration_ms) → start=end=timestamp, still satisfies temporal window', () => {
    const T = '2026-09-10T14:28:33Z'
    const sessions = [
      { session_id: 's1', git_repo_url: 'https://github.com/org/repo.git', workflow: 'cursor', timestamp: T },
    ]
    const snapshot = {
      prs: [
        { id: 101, repo: 'org/repo', merged_at: '2026-09-10T15:00:00Z', data_source: 'demo' },
      ],
    }
    const sessEv = buildSessionEvidence(sessions)[0]
    expect(sessEv.sessionStart).toBe(T)
    expect(sessEv.sessionEnd).toBe(T)
    const summary = resolveDeliveryAttribution(sessions, snapshot)
    expect(summary.maxLevel).toBe('L3')
  })

  it('P0-2: invalid timestamp cannot create Invalid Date (falls back to null, degrades to L4)', () => {
    const sessions = [
      { session_id: 's1', git_repo_url: 'https://github.com/org/repo.git', workflow: 'cursor', timestamp: 'not-a-date', duration_ms: 3600_000 },
    ]
    const snapshot = {
      prs: [
        { id: 101, repo: 'org/repo', merged_at: '2026-09-10T15:00:00Z', data_source: 'demo' },
      ],
    }
    const sessEv = buildSessionEvidence(sessions)[0]
    expect(sessEv.sessionStart).toBeNull()
    expect(sessEv.sessionEnd).toBeNull()
    const summary = resolveDeliveryAttribution(sessions, snapshot)
    expect(summary.maxLevel).toBe('L4')
  })
})
