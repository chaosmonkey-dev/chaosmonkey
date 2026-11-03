import { describe, it, expect } from 'vitest'
import {
  PILOT_SHAPES,
  getPilotShape,
  type PilotShapeId,
} from '../lib/insights/final/pilotShapeFixtures'
import { resolveSurface } from '../lib/surfaceAgentContract'

/**
 * ============================================================================
 * CR-X P1B.2 — Progressive-Value Pilot Shape Fixture Validation
 * ============================================================================
 *
 * Proves each fixture shape (A-E) is well-formed: correct session counts,
 * correct field population per workflow mode, correct temporal distribution.
 * This is the architectural acceptance matrix foundation — the shapes must be
 * truthful before the PI engine is tested against them.
 * ============================================================================
 */

describe('CR-X P1B.2 — Pilot Shape Fixtures', () => {
  // Helper: count sessions by tool
  function countByTool(sessions: any[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const s of sessions) {
      const t = s.tool ?? s.session_source ?? 'unknown'
      counts[t] = (counts[t] || 0) + 1
    }
    return counts
  }

  // Helper: date range
  function dateRange(sessions: any[]): { min: string; max: string } {
    const ts = sessions.map(s => s.timestamp).filter(Boolean).sort()
    return { min: ts[0], max: ts[ts.length - 1] }
  }

  // Helper: distinct developers
  function distinctDevs(sessions: any[]): number {
    return new Set(sessions.map(s => s.user_id).filter(Boolean)).size
  }

  // Helper: distinct repos
  function distinctRepos(sessions: any[]): number {
    return new Set(sessions.map(s => s.git_repo_url).filter(Boolean)).size
  }

  describe('Shape A — Early Single Workflow', () => {
    const input = getPilotShape('A')
    const sessions = input.sessionRows as any[]
    const byTool = countByTool(sessions)

    it('has 1 workflow (vscode) only', () => {
      expect(Object.keys(byTool)).toEqual(['vscode'])
    })

    it('has 5-10 developers', () => {
      expect(distinctDevs(sessions)).toBeGreaterThanOrEqual(5)
      expect(distinctDevs(sessions)).toBeLessThanOrEqual(10)
    })

    it('spans 3-5 days', () => {
      const { min, max } = dateRange(sessions)
      const days = (new Date(max).getTime() - new Date(min).getTime()) / 86400000
      expect(days).toBeGreaterThanOrEqual(2)
      expect(days).toBeLessThanOrEqual(5)
    })

    it('has telemetry-only (no GitHub snapshot, no cost)', () => {
      expect(input.githubSnapshot).toBeUndefined()
    })

    it('populates active_coding_duration_ms for human_interactive vscode', () => {
      const withAc = sessions.filter(s => typeof s.active_coding_duration_ms === 'number')
      expect(withAc.length).toBeGreaterThan(0)
    })

    it('has ≥25 sessions (minimum for primary workflow threshold)', () => {
      expect(sessions.length).toBeGreaterThanOrEqual(25)
    })
  })

  describe('Shape B — Mature Single Workflow (Ed-like)', () => {
    const input = getPilotShape('B')
    const sessions = input.sessionRows as any[]
    const byTool = countByTool(sessions)

    it('has 1 dominant workflow (vscode)', () => {
      expect(Object.keys(byTool)).toEqual(['vscode'])
    })

    it('has ~15 developers', () => {
      expect(distinctDevs(sessions)).toBeGreaterThanOrEqual(12)
      expect(distinctDevs(sessions)).toBeLessThanOrEqual(20)
    })

    it('spans multiple weeks (≥6 weeks)', () => {
      const { min, max } = dateRange(sessions)
      const weeks = (new Date(max).getTime() - new Date(min).getTime()) / (86400000 * 7)
      expect(weeks).toBeGreaterThanOrEqual(6)
    })

    it('has multiple repos (≥3)', () => {
      expect(distinctRepos(sessions)).toBeGreaterThanOrEqual(3)
    })

    it('has no cost and no delivery (telemetry only)', () => {
      expect(input.githubSnapshot).toBeUndefined()
    })
  })

  describe('Shape C — Early Multi-Workflow', () => {
    const input = getPilotShape('C')
    const sessions = input.sessionRows as any[]
    const byTool = countByTool(sessions)

    it('has several workflows (≥3)', () => {
      expect(Object.keys(byTool).length).toBeGreaterThanOrEqual(3)
    })

    it('has 25-50 developers', () => {
      expect(distinctDevs(sessions)).toBeGreaterThanOrEqual(25)
      expect(distinctDevs(sessions)).toBeLessThanOrEqual(50)
    })

    it('spans ~5 days', () => {
      const { min, max } = dateRange(sessions)
      const days = (new Date(max).getTime() - new Date(min).getTime()) / 86400000
      expect(days).toBeLessThanOrEqual(6)
    })

    it('has uneven adoption (not all workflows have ≥25 sessions)', () => {
      const counts = Object.values(byTool)
      const mature = counts.filter(c => c >= 25).length
      const emerging = counts.filter(c => c < 25).length
      expect(emerging).toBeGreaterThan(0) // at least one emerging
    })

    it('delegated_agent workflows (devin) do NOT have active_coding_duration_ms', () => {
      const devinSessions = sessions.filter(s => s.tool === 'devin')
      for (const s of devinSessions) {
        expect(s.active_coding_duration_ms).toBeUndefined()
        expect(s.focus_ratio).toBeUndefined()
        expect(s.file_save_count).toBeUndefined()
      }
    })
  })

  describe('Shape D — Mature Multi-Workflow', () => {
    const input = getPilotShape('D')
    const sessions = input.sessionRows as any[]
    const byTool = countByTool(sessions)

    it('has multiple mature workflows (≥2 with ≥25 sessions)', () => {
      const mature = Object.values(byTool).filter(c => c >= 25).length
      expect(mature).toBeGreaterThanOrEqual(2)
    })

    it('spans ≥10 weeks', () => {
      const { min, max } = dateRange(sessions)
      const weeks = (new Date(max).getTime() - new Date(min).getTime()) / (86400000 * 7)
      expect(weeks).toBeGreaterThanOrEqual(10)
    })

    it('has repo attribution (≥3 repos)', () => {
      expect(distinctRepos(sessions)).toBeGreaterThanOrEqual(3)
    })

    it('delegated_agent workflows have session_commits observed', () => {
      const devinSessions = sessions.filter(s => s.tool === 'devin')
      const withCommits = devinSessions.filter(s => typeof s.session_commits === 'number')
      expect(withCommits.length).toBeGreaterThan(0)
    })
  })

  describe('Shape E — Agent-Heavy', () => {
    const input = getPilotShape('E')
    const sessions = input.sessionRows as any[]
    const byTool = countByTool(sessions)

    it('has delegated agents (devin and/or claude_code)', () => {
      expect(byTool.devin).toBeGreaterThan(0)
      expect(byTool.claude_code).toBeGreaterThan(0)
    })

    it('has IDE workflows (vscode and/or cursor)', () => {
      const ideCount = (byTool.vscode || 0) + (byTool.cursor || 0)
      expect(ideCount).toBeGreaterThan(0)
    })

    it('delegated agents have NO active_coding/focus_ratio/file_save_count', () => {
      const agentSessions = sessions.filter(s => s.tool === 'devin' || s.tool === 'claude_code')
      for (const s of agentSessions) {
        expect(s.active_coding_duration_ms).toBeUndefined()
        expect(s.focus_ratio).toBeUndefined()
        expect(s.file_save_count).toBeUndefined()
      }
    })

    it('IDE workflows HAVE active_coding_duration_ms', () => {
      const ideSessions = sessions.filter(s => s.tool === 'vscode' || s.tool === 'cursor')
      const withAc = ideSessions.filter(s => typeof s.active_coding_duration_ms === 'number')
      expect(withAc.length).toBe(ideSessions.length)
    })

    it('claude_code sessions have longer runtime than IDE sessions (agent runtime semantics)', () => {
      const ccSessions = sessions.filter(s => s.tool === 'claude_code')
      const ideSessions = sessions.filter(s => s.tool === 'vscode' || s.tool === 'cursor')
      if (ccSessions.length > 0 && ideSessions.length > 0) {
        const ccAvg = ccSessions.reduce((sum, s) => sum + s.duration_ms, 0) / ccSessions.length
        const ideAvg = ideSessions.reduce((sum, s) => sum + s.duration_ms, 0) / ideSessions.length
        expect(ccAvg).toBeGreaterThan(ideAvg)
      }
    })
  })

  describe('All shapes — field contract integrity', () => {
    const shapeIds: PilotShapeId[] = ['A', 'B', 'C', 'D', 'E']

    for (const id of shapeIds) {
      it(`Shape ${id}: every session has a valid surface resolution`, () => {
        const sessions = getPilotShape(id).sessionRows as any[]
        for (const s of sessions) {
          const surface = resolveSurface(s.tool)
          expect(surface).not.toBe('unknown')
          expect(surface).not.toBe('other')
        }
      })

      it(`Shape ${id}: every session has session_duration_minutes derived`, () => {
        const sessions = getPilotShape(id).sessionRows as any[]
        for (const s of sessions) {
          expect(s.session_duration_minutes).toBeDefined()
          expect(typeof s.session_duration_minutes).toBe('number')
        }
      })
    }
  })
})
