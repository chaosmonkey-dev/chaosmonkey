import { describe, it, expect } from 'vitest'
import {
  resolveAttribution,
  resolveAttributionMulti,
  degradeAmbiguous,
  normalizeRepo,
  MAX_SESSION_COMMIT_SHAS,
  type SessionEvidence,
  type PullRequestEvidence,
} from '../lib/insights/final/attribution/attributionEngine'

// ─── Fixtures ───────────────────────────────────────────────────────────

const baseSession: SessionEvidence = {
  sessionId: 'sess-001',
  workflow: 'cursor',
  developerId: 'invite:1',
  repo: 'github.com/acme/api',
  branch: 'feature/auth',
  sessionStart: '2026-07-15T10:00:00Z',
  sessionEnd: '2026-07-15T12:00:00Z',
  sessionCommitShas: ['abc123def456789012345678901234567890abcd'],
  startHeadSha: 'aaa111bbb222333444555666777888999000ffff',
  endHeadSha: 'abc123def456789012345678901234567890abcd',
}

const basePr: PullRequestEvidence = {
  prId: 42,
  repo: 'github.com/acme/api',
  headRef: 'feature/auth',
  baseRef: 'main',
  headSha: 'abc123def456789012345678901234567890abcd',
  mergeSha: 'merge99988877766655544433322211100000aaabbb',
  commitShas: [
    'abc123def456789012345678901234567890abcd',
    'def4567890abcdef1234567890abcdef12345678',
  ],
  authorLogin: 'invite:1',
  createdAt: '2026-07-15T09:00:00Z',
  mergedAt: '2026-07-15T14:00:00Z',
  dataProvenance: 'live',
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('attributionEngine', () => {
  describe('normalizeRepo', () => {
    it('strips protocol and .git suffix', () => {
      expect(normalizeRepo('https://github.com/acme/api.git')).toBe('acme/api')
    })
    it('handles git@ SSH URLs', () => {
      expect(normalizeRepo('git@github.com:acme/api.git')).toBe('acme/api')
    })
    it('handles bare repo names', () => {
      expect(normalizeRepo('acme/api')).toBe('acme/api')
    })
    it('handles empty/null', () => {
      expect(normalizeRepo(null)).toBe('')
      expect(normalizeRepo('')).toBe('')
    })
    it('strips trailing slashes', () => {
      expect(normalizeRepo('https://github.com/acme/api/')).toBe('acme/api')
    })
  })

  describe('L1 — direct commit SHA membership', () => {
    it('attributes L1 when session commit SHA is in PR commit set', () => {
      const result = resolveAttribution(baseSession, basePr)
      expect(result.level).toBe('L1')
      expect(result.confidence).toBe('high')
      expect(result.isAttributed).toBe(true)
      expect(result.joinKeys).toContain('session_commit_shas')
      expect(result.joinKeys).toContain('pr_commit_shas')
    })

    it('attributes L1 when multiple session SHAs match PR', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [
          'abc123def456789012345678901234567890abcd',
          'def4567890abcdef1234567890abcdef12345678',
          'fff000eee111ddd222ccc333bbb444aaa555666',
        ],
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).toBe('L1')
      expect(result.evidenceDescription).toContain('2 matching SHA')
    })

    it('attributes L1 regardless of branch/repo when SHA matches and repos match', () => {
      const session: SessionEvidence = {
        ...baseSession,
        branch: 'different-branch',
      }
      const result = resolveAttribution(session, basePr)
      // L1 is commit identity; branch mismatch doesn't override
      expect(result.level).toBe('L1')
    })

    it('degrades to L4 when SHA matches but repos differ', () => {
      const session: SessionEvidence = {
        ...baseSession,
        repo: 'github.com/other/repo',
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).toBe('L4')
      expect(result.isAttributed).toBe(false)
      expect(result.evidenceDescription).toContain('repos differ')
    })

    it('does not attribute L1 when no session commit SHAs', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).not.toBe('L1')
    })

    it('does not attribute L1 when PR has no commit SHAs', () => {
      const pr: PullRequestEvidence = {
        ...basePr,
        commitShas: [],
      }
      const result = resolveAttribution(baseSession, pr)
      expect(result.level).not.toBe('L1')
    })

    it('handles SHA case insensitivity', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: ['ABC123DEF456789012345678901234567890ABCD'],
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).toBe('L1')
    })
  })

  describe('L2 — strong inferred', () => {
    it('attributes L2 when repo+branch+developer+temporal+git context match, no SHA', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
        startHeadSha: 'aaa111bbb222333444555666777888999000ffff',
        endHeadSha: 'bbb222ccc333ddd444eee555fff666777888999a',
      }
      const pr: PullRequestEvidence = {
        ...basePr,
        commitShas: ['fff000eee111ddd222ccc333bbb444aaa555666'],
      }
      const result = resolveAttribution(session, pr)
      expect(result.level).toBe('L2')
      expect(result.confidence).toBe('medium')
      expect(result.isAttributed).toBe(true)
      expect(result.joinKeys).toContain('repo')
      expect(result.joinKeys).toContain('branch')
      expect(result.joinKeys).toContain('developer_id')
    })

    it('does not attribute L2 when branch differs', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
        branch: 'feature/other',
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).not.toBe('L2')
    })

    it('does not attribute L2 when developer differs', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
        developerId: 'invite:99',
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).not.toBe('L2')
    })

    it('does not attribute L2 when no temporal overlap', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
        sessionStart: '2026-01-01T00:00:00Z',
        sessionEnd: '2026-01-01T02:00:00Z',
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).not.toBe('L2')
    })

    it('does not attribute L2 when no git context (no start/end HEAD, no commit SHAs)', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
        startHeadSha: null,
        endHeadSha: null,
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).not.toBe('L2')
    })
  })

  describe('L3 — directional', () => {
    it('attributes L3 when same repo + temporal overlap, but no branch/dev match', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
        branch: 'different-branch',
        developerId: 'invite:99',
        startHeadSha: null,
        endHeadSha: null,
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).toBe('L3')
      expect(result.confidence).toBe('low')
      expect(result.isAttributed).toBe(false)
    })

    it('does not attribute L3 when repo differs', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
        repo: 'github.com/other/repo',
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).toBe('L4')
    })

    it('does not attribute L3 when no temporal overlap', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
        sessionStart: '2026-01-01T00:00:00Z',
        sessionEnd: '2026-01-01T02:00:00Z',
        branch: 'different-branch',
        developerId: 'invite:99',
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).toBe('L4')
    })
  })

  describe('L4 — none', () => {
    it('returns L4 when repo differs', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
        repo: 'github.com/other/repo',
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).toBe('L4')
      expect(result.confidence).toBe('none')
      expect(result.isAttributed).toBe(false)
    })

    it('returns L4 when all fields missing', () => {
      const session: SessionEvidence = {
        sessionId: 'sess-empty',
        workflow: 'cursor',
        repo: '',
        sessionCommitShas: [],
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).toBe('L4')
    })
  })

  describe('edge cases — same SHA wrong repo', () => {
    it('degrades to L4 when SHA matches but repo is different', () => {
      const session: SessionEvidence = {
        ...baseSession,
        repo: 'github.com/other/repo',
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).toBe('L4')
      expect(result.evidenceDescription).toContain('repos differ')
    })
  })

  describe('edge cases — same branch wrong repo', () => {
    it('does not attribute when branch matches but repo differs', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
        repo: 'github.com/other/repo',
        branch: 'feature/auth',
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).toBe('L4')
    })
  })

  describe('edge cases — same developer wrong repo', () => {
    it('does not attribute when developer matches but repo differs', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
        repo: 'github.com/other/repo',
        developerId: 'invite:1',
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).toBe('L4')
    })
  })

  describe('edge cases — multiple candidate PRs', () => {
    it('returns all L1 matches sorted by level', () => {
      const pr1: PullRequestEvidence = { ...basePr, prId: 42 }
      const pr2: PullRequestEvidence = {
        ...basePr,
        prId: 43,
        commitShas: ['abc123def456789012345678901234567890abcd'],
      }
      const results = resolveAttributionMulti(baseSession, [pr1, pr2])
      expect(results.length).toBe(2)
      expect(results[0].level).toBe('L1')
      expect(results[1].level).toBe('L1')
    })

    it('returns mixed levels sorted L1 first', () => {
      const pr1: PullRequestEvidence = { ...basePr, prId: 42 }
      const pr2: PullRequestEvidence = {
        ...basePr,
        prId: 43,
        commitShas: ['fff000eee111ddd222ccc333bbb444aaa555666'],
      }
      const results = resolveAttributionMulti(baseSession, [pr1, pr2])
      expect(results[0].level).toBe('L1')
      expect(results[1].level).toBe('L2')
    })
  })

  describe('edge cases — one session feeding multiple PRs', () => {
    it('a session with multiple commits can match multiple PRs', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [
          'abc123def456789012345678901234567890abcd',
          'fff000eee111ddd222ccc333bbb444aaa555666',
        ],
      }
      const pr1: PullRequestEvidence = {
        ...basePr,
        prId: 42,
        commitShas: ['abc123def456789012345678901234567890abcd'],
      }
      const pr2: PullRequestEvidence = {
        ...basePr,
        prId: 43,
        commitShas: ['fff000eee111ddd222ccc333bbb444aaa555666'],
      }
      const results = resolveAttributionMulti(session, [pr1, pr2])
      expect(results[0].level).toBe('L1')
      expect(results[1].level).toBe('L1')
    })
  })

  describe('edge cases — squash merge', () => {
    it('L1 attributes when session SHA matches squash commit SHA', () => {
      const squashSha = 'squash1112223334445556667778889990000aaabbb'
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [squashSha],
      }
      const pr: PullRequestEvidence = {
        ...basePr,
        commitShas: [squashSha],  // squash: PR commit set = [squash SHA]
        mergeSha: squashSha,
      }
      const result = resolveAttribution(session, pr)
      expect(result.level).toBe('L1')
    })
  })

  describe('edge cases — rebase merge', () => {
    it('L1 attributes when session SHA matches rebased commit SHA', () => {
      const rebasedSha = 'rebased1112223334445556667778889990000aaabb'
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [rebasedSha],
      }
      const pr: PullRequestEvidence = {
        ...basePr,
        commitShas: [rebasedSha],
        mergeSha: rebasedSha,
      }
      const result = resolveAttribution(session, pr)
      expect(result.level).toBe('L1')
    })
  })

  describe('edge cases — ambiguous candidate degrades', () => {
    it('degrades multiple L2 matches to L3', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
        startHeadSha: 'aaa111bbb222333444555666777888999000ffff',
        endHeadSha: 'bbb222ccc333ddd444eee555fff666777888999a',
      }
      const pr1: PullRequestEvidence = {
        ...basePr,
        prId: 42,
        commitShas: ['fff000eee111ddd222ccc333bbb444aaa555666'],
      }
      const pr2: PullRequestEvidence = {
        ...basePr,
        prId: 43,
        commitShas: ['eee000ddd111ccc222bbb333aaa444999888777'],
      }
      const results = resolveAttributionMulti(session, [pr1, pr2])
      const degraded = degradeAmbiguous(results)
      const l2Count = degraded.filter(r => r.level === 'L2').length
      const l3Count = degraded.filter(r => r.level === 'L3').length
      expect(l2Count).toBe(0)
      expect(l3Count).toBeGreaterThanOrEqual(2)
    })

    it('does not degrade single L2 match', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
        startHeadSha: 'aaa111bbb222333444555666777888999000ffff',
        endHeadSha: 'bbb222ccc333ddd444eee555fff666777888999a',
      }
      const pr1: PullRequestEvidence = {
        ...basePr,
        prId: 42,
        commitShas: ['fff000eee111ddd222ccc333bbb444aaa555666'],
      }
      const pr2: PullRequestEvidence = {
        ...basePr,
        prId: 43,
        commitShas: ['eee000ddd111ccc222bbb333aaa444999888777'],
        branch: 'other-branch',
        headRef: 'other-branch',
      }
      const results = resolveAttributionMulti(session, [pr1, pr2])
      const degraded = degradeAmbiguous(results)
      const l2Count = degraded.filter(r => r.level === 'L2').length
      expect(l2Count).toBe(1)
    })
  })

  describe('edge cases — missing fields degrade', () => {
    it('degrades to L4 when session repo is empty', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
        repo: '',
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).toBe('L4')
    })

    it('degrades to L4 when PR repo is empty', () => {
      const pr: PullRequestEvidence = {
        ...basePr,
        repo: '',
      }
      const result = resolveAttribution(baseSession, pr)
      expect(result.level).toBe('L4')
    })

    it('degrades when session has no commits and no HEAD SHAs', () => {
      const session: SessionEvidence = {
        ...baseSession,
        sessionCommitShas: [],
        startHeadSha: null,
        endHeadSha: null,
      }
      const result = resolveAttribution(session, basePr)
      // Should be L3 at best (repo + temporal, no git context for L2)
      expect(result.level).not.toBe('L2')
    })

    it('does not fabricate L1 when fields are null', () => {
      const session: SessionEvidence = {
        sessionId: 'sess-null',
        workflow: 'cursor',
        repo: 'github.com/acme/api',
        sessionCommitShas: [],
        startHeadSha: null,
        endHeadSha: null,
        developerId: null,
        branch: null,
      }
      const result = resolveAttribution(session, basePr)
      expect(result.level).not.toBe('L1')
      expect(result.level).not.toBe('L2')
    })
  })

  describe('MAX_SESSION_COMMIT_SHAS', () => {
    it('is set to a sane maximum', () => {
      expect(MAX_SESSION_COMMIT_SHAS).toBe(100)
      expect(MAX_SESSION_COMMIT_SHAS).toBeGreaterThan(0)
    })
  })

  describe('provenance preservation', () => {
    it('preserves PR data provenance in result', () => {
      const pr: PullRequestEvidence = { ...basePr, dataProvenance: 'demo' }
      const result = resolveAttribution(baseSession, pr)
      expect(result.provenance).toBe('demo')
    })

    it('defaults to unknown when provenance missing', () => {
      const pr: PullRequestEvidence = { ...basePr, dataProvenance: undefined }
      const result = resolveAttribution(baseSession, pr)
      expect(result.provenance).toBe('unknown')
    })
  })

  describe('workflow preservation', () => {
    it('preserves session workflow in result', () => {
      const session: SessionEvidence = { ...baseSession, workflow: 'claude_code' }
      const result = resolveAttribution(session, basePr)
      expect(result.workflow).toBe('claude_code')
    })
  })
})
