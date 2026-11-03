import { describe, it, expect } from 'vitest'
import {
  generateActiveCodingTimeByIDE,
  generateTimeToFirstCommitByIDE,
  generateDebugTimeByIDE,
  generateTerminalTimeByIDE,
  generateWorkflowBehaviorComparison,
} from '../lib/insights/final/generators/planCode'

function mk(session_id: string, overrides: Record<string, any> = {}): any {
  return { session_id, tool: 'vscode', ...overrides }
}

function acMins(v: number): number {
  return v * 60000
}

describe('CR-X portfolio capability census', () => {
  it('cross-workflow active coding emits with two qualified human workflows', () => {
    const sessions = [
      ...Array.from({ length: 30 }, (_, i) =>
        mk(`ac-c-${i}`, { tool: 'cursor', editor_source: 'cursor', session_active_coding_duration_minutes: 50 })
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        mk(`ac-v-${i}`, { tool: 'vscode', editor_source: 'vscode', session_active_coding_duration_minutes: 20 })
      ),
    ]
    const result = generateActiveCodingTimeByIDE({ sessionRows: sessions } as any)
    expect(result).not.toBeNull()
    expect((result as any).title.toLowerCase()).toContain('cursor')
    expect((result as any).workflowContext || '').toBe('')
  })

  it('active coding is a data-gap diagnostic when no measurements are instrumented', () => {
    const sessions = [
      ...Array.from({ length: 30 }, (_, i) =>
        mk(`ac-mc-${i}`, { tool: 'cursor', session_active_coding_duration_minutes: undefined })
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        mk(`ac-mv-${i}`, { tool: 'vscode', session_active_coding_duration_minutes: undefined })
      ),
    ]
    const result = generateActiveCodingTimeByIDE({ sessionRows: sessions } as any)
    expect(result).not.toBeNull()
    expect((result as any).isDiagnostic).toBe(true)
    expect((result as any).title.toLowerCase()).toContain('needs more data')
  })

  it('cross-workflow TTFC emits with two workflows having sufficient observed TTFC', () => {
    const sessions = [
      ...Array.from({ length: 15 }, (_, i) =>
        mk(`ttfc-c-${i}`, { tool: 'cursor', time_to_first_commit_ms: acMins(15), ttfc_source: 'observed' })
      ),
      ...Array.from({ length: 15 }, (_, i) =>
        mk(`ttfc-v-${i}`, { tool: 'vscode', time_to_first_commit_ms: acMins(45), ttfc_source: 'observed' })
      ),
    ]
    const result = generateTimeToFirstCommitByIDE({ sessionRows: sessions } as any)
    expect(result).not.toBeNull()
    expect((result as any).title.toLowerCase()).toContain('time-to-first-commit')
  })

  it('TTFC stays absent with only one qualified workflow', () => {
    const sessions = Array.from({ length: 30 }, (_, i) =>
      mk(`ttfc-only-${i}`, { tool: 'vscode', time_to_first_commit_ms: acMins(45), ttfc_source: 'observed' })
    )
    const result = generateTimeToFirstCommitByIDE({ sessionRows: sessions } as any)
    expect(result).toBeNull()
  })

  it('debug-time-by-ide emits only with qualifying instrumented fields', () => {
    const sessions = [
      ...Array.from({ length: 15 }, (_, i) =>
        mk(`dbg-c-${i}`, { tool: 'cursor', debug_time_ms: acMins(10) })
      ),
      ...Array.from({ length: 15 }, (_, i) =>
        mk(`dbg-v-${i}`, { tool: 'vscode', debug_time_ms: acMins(2) })
      ),
    ]
    const result = generateDebugTimeByIDE({ sessionRows: sessions } as any)
    expect(result).not.toBeNull()
  })

  it('debug-time-by-ide stays absent without qualifying instrumented fields', () => {
    const sessions = [
      ...Array.from({ length: 15 }, (_, i) => mk(`ndg-c-${i}`, { tool: 'cursor' })),
      ...Array.from({ length: 15 }, (_, i) => mk(`ndg-v-${i}`, { tool: 'vscode' })),
    ]
    const result = generateDebugTimeByIDE({ sessionRows: sessions } as any)
    expect(result).toBeNull()
  })

  it('terminal-time-by-ide emits only with qualifying instrumented fields', () => {
    const sessions = [
      ...Array.from({ length: 15 }, (_, i) =>
        mk(`trm-c-${i}`, { tool: 'cursor', terminal_active_time_ms: acMins(15) })
      ),
      ...Array.from({ length: 15 }, (_, i) =>
        mk(`trm-v-${i}`, { tool: 'vscode', terminal_active_time_ms: acMins(3) })
      ),
    ]
    const result = generateTerminalTimeByIDE({ sessionRows: sessions } as any)
    expect(result).not.toBeNull()
  })

  it('workflow-behavior comparison respects operational modes (no cross-mode finding)', () => {
    const sessions = [
      ...Array.from({ length: 30 }, (_, i) =>
        mk(`wb-c-${i}`, { tool: 'vscode', editor_source: 'vscode', session_active_coding_duration_minutes: 50 })
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        mk(`wb-d-${i}`, { tool: 'devin', session_duration_minutes: 500 })
      ),
    ]
    const result = generateWorkflowBehaviorComparison({ sessionRows: sessions } as any)
    expect(result).toBeDefined()
    // Should not produce a cross-mode human-vs-delegated comparison
    expect(
      result.some((insight: any) =>
        (insight.title || '').toLowerCase().includes('devin') &&
        (insight.title || '').toLowerCase().includes('vscode')
      )
    ).toBe(false)
  })

  it('workflow-behavior comparison stays suppressed below material gap', () => {
    const sessions = [
      ...Array.from({ length: 30 }, (_, i) =>
        mk(`wbc-v-${i}`, { tool: 'vscode', editor_source: 'vscode', session_active_coding_duration_minutes: 22 })
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        mk(`wbc-c-${i}`, { tool: 'cursor', editor_source: 'cursor', session_active_coding_duration_minutes: 20 })
      ),
    ]
    const result = generateWorkflowBehaviorComparison({ sessionRows: sessions } as any)
    expect(result.length).toBe(0)
  })
})
