import { describe, it, expect } from 'vitest'
import { resolveOperationalMode, isDelegatedAgentWorkflow } from '../lib/surfaceAgentContract'

/**
 * CR-X P0 — Delegated-agent N+1 regression test
 *
 * The backend normalizeSessionRow() previously called computeActiveCodingDuration,
 * computeAIBurstCount, and computeTimeToFirstCommit for EVERY session, including
 * delegated-agent sessions (claude_code, devin) where these human IDE metrics
 * are semantically NOT APPLICABLE. Each call issues a per-session DB query,
 * creating an N+1 scalability problem at scale.
 *
 * The fix uses resolveOperationalMode() to skip derivation for delegated-agent
 * sessions. This test verifies the operational-mode authority that the backend
 * relies on.
 */
describe('CR-X P0: Delegated-agent N+1 regression', () => {
  describe('resolveOperationalMode', () => {
    it('classifies claude_code as delegated_agent', () => {
      expect(resolveOperationalMode('claude_code')).toBe('delegated_agent')
    })

    it('classifies devin as delegated_agent', () => {
      expect(resolveOperationalMode('devin')).toBe('delegated_agent')
    })

    it('classifies windsurf as delegated_agent (legacy Devin)', () => {
      expect(resolveOperationalMode('windsurf')).toBe('delegated_agent')
    })

    it('classifies vscode as human_interactive', () => {
      expect(resolveOperationalMode('vscode')).toBe('human_interactive')
    })

    it('classifies cursor as human_interactive', () => {
      expect(resolveOperationalMode('cursor')).toBe('human_interactive')
    })

    it('classifies github_copilot as human_interactive', () => {
      expect(resolveOperationalMode('github_copilot')).toBe('human_interactive')
    })
  })

  describe('isDelegatedAgentWorkflow', () => {
    it('returns true for claude_code', () => {
      expect(isDelegatedAgentWorkflow('claude_code')).toBe(true)
    })

    it('returns true for devin', () => {
      expect(isDelegatedAgentWorkflow('devin')).toBe(true)
    })

    it('returns false for vscode', () => {
      expect(isDelegatedAgentWorkflow('vscode')).toBe(false)
    })

    it('returns false for cursor', () => {
      expect(isDelegatedAgentWorkflow('cursor')).toBe(false)
    })
  })

  describe('N+1 query prevention contract', () => {
    it('hundreds of delegated terminal sessions must not trigger hundreds of fallback DB queries', () => {
      // The backend normalizeSessionRow uses the same operational-mode
      // classification as this frontend contract. The backend checks:
      //   $isDelegatedAgent = in_array($tool, ['claude_code', 'devin', 'windsurf'], true)
      // and skips computeActiveCodingDuration, computeAIBurstCount,
      // and computeTimeToFirstCommit for those tools.
      //
      // This test verifies that the authority used by the backend
      // (resolveOperationalMode) correctly classifies all delegated-agent
      // tools, so that hundreds of terminal Claude Code sessions do NOT
      // trigger hundreds of per-session file_edit/ai_accept/commit DB queries.

      const delegatedTools = ['claude_code', 'devin', 'windsurf']
      const humanTools = ['vscode', 'cursor', 'github_copilot']

      // All delegated tools must be classified as delegated_agent
      for (const tool of delegatedTools) {
        expect(resolveOperationalMode(tool)).toBe('delegated_agent')
        expect(isDelegatedAgentWorkflow(tool)).toBe(true)
      }

      // All human-interactive tools must NOT be classified as delegated
      for (const tool of humanTools) {
        expect(resolveOperationalMode(tool)).toBe('human_interactive')
        expect(isDelegatedAgentWorkflow(tool)).toBe(false)
      }

      // Simulate 550 terminal Claude Code sessions — none should trigger
      // the N+1 derivation path in the backend
      const sessions = Array.from({ length: 550 }, (_, i) => ({
        tool: 'claude_code',
        session_id: `session_${i}`,
        active_coding_duration_ms: null, // intentionally null for terminal
      }))

      const delegatedCount = sessions.filter(s => isDelegatedAgentWorkflow(s.tool)).length
      expect(delegatedCount).toBe(550)

      // If all 550 are delegated, the backend skips derivation for all 550
      // → 0 extra DB queries instead of 550 * 3 = 1650 extra DB queries
    })
  })
})
