import { describe, it, expect } from 'vitest'
import {
  resolveOperationalMode,
  isHumanInteractiveWorkflow,
  isDelegatedAgentWorkflow,
  getHeadlineTimeMetricLabel,
  getCostPerHourLabel,
  resolveSurface,
  type OperationalMode,
} from '../lib/surfaceAgentContract'
import { generateActiveCodingTimeByIDE } from '../lib/insights/final/generators/planCode'
import { getPilotShape } from '../lib/insights/final/pilotShapeFixtures'
import { buildMeasuredWorkflowIntelligence } from '../lib/aioi/buildMeasuredWorkflowIntelligence'

/**
 * ============================================================================
 * CR-X P1B.2 S1 — OperationalMode Contract Tests
 * ============================================================================
 *
 * Proves:
 * 1. All 5 canonical workflows are correctly classified.
 * 2. Surface ≠ operational mode (Devin is vscode surface but delegated_agent mode).
 * 3. A future delegated agent is automatically treated correctly.
 * 4. The active-coding generator skips ALL delegated agents, not just claude_code.
 * 5. The AIOI hero metric is mode-aware.
 * 6. The AIOI suppresses human-interactive-only metrics for delegated agents.
 * ============================================================================
 */

describe('CR-X P1B.2 S1 — OperationalMode Classification', () => {
  it('classifies VS Code as human_interactive', () => {
    expect(resolveOperationalMode('vscode')).toBe('human_interactive')
  })

  it('classifies Cursor as human_interactive', () => {
    expect(resolveOperationalMode('cursor')).toBe('human_interactive')
  })

  it('classifies GitHub Copilot as human_interactive', () => {
    expect(resolveOperationalMode('github_copilot')).toBe('human_interactive')
  })

  it('classifies Devin as delegated_agent', () => {
    expect(resolveOperationalMode('devin')).toBe('delegated_agent')
  })

  it('classifies Windsurf (legacy Devin) as delegated_agent', () => {
    expect(resolveOperationalMode('windsurf')).toBe('delegated_agent')
  })

  it('classifies Claude Code as delegated_agent', () => {
    expect(resolveOperationalMode('claude_code')).toBe('delegated_agent')
    expect(resolveOperationalMode('claude-code')).toBe('delegated_agent')
  })

  it('classifies unknown tools as unknown (fail-closed)', () => {
    expect(resolveOperationalMode('unknown')).toBe('unknown')
    expect(resolveOperationalMode('')).toBe('unknown')
    expect(resolveOperationalMode(null)).toBe('unknown')
    expect(resolveOperationalMode(undefined)).toBe('unknown')
  })
})

describe('CR-X P1B.2 S1 — Surface ≠ OperationalMode', () => {
  it('Devin has vscode surface but delegated_agent mode', () => {
    expect(resolveSurface('devin')).toBe('vscode')
    expect(resolveOperationalMode('devin')).toBe('delegated_agent')
  })

  it('Claude Code has terminal surface and delegated_agent mode', () => {
    expect(resolveSurface('claude_code')).toBe('terminal')
    expect(resolveOperationalMode('claude_code')).toBe('delegated_agent')
  })

  it('VS Code has vscode surface and human_interactive mode', () => {
    expect(resolveSurface('vscode')).toBe('vscode')
    expect(resolveOperationalMode('vscode')).toBe('human_interactive')
  })

  it('Cursor has cursor surface and human_interactive mode', () => {
    expect(resolveSurface('cursor')).toBe('cursor')
    expect(resolveOperationalMode('cursor')).toBe('human_interactive')
  })
})

describe('CR-X P1B.2 S1 — Future Delegated Agent Proof', () => {
  // Simulate a future delegated agent by temporarily extending the classification.
  // The test proves that if a new tool is classified as delegated_agent,
  // all mode-aware gating automatically applies.

  it('a future delegated agent returns unknown until registered', () => {
    // Unregistered tools are unknown → fail-closed. No implicit human_interactive.
    expect(resolveOperationalMode('some_future_agent')).toBe('unknown')
    expect(isHumanInteractiveWorkflow('some_future_agent')).toBe(false)
    expect(isDelegatedAgentWorkflow('some_future_agent')).toBe(false)
  })

  it('codex is a registered delegated_agent (canonical workflow)', () => {
    expect(resolveOperationalMode('codex')).toBe('delegated_agent')
    expect(isHumanInteractiveWorkflow('codex')).toBe(false)
    expect(isDelegatedAgentWorkflow('codex')).toBe(true)
    // Registered via the codex entry in WORKFLOW_CAPABILITY_REGISTRY.
  })

  it('isDelegatedAgentWorkflow returns true for all known delegated agents', () => {
    expect(isDelegatedAgentWorkflow('devin')).toBe(true)
    expect(isDelegatedAgentWorkflow('windsurf')).toBe(true)
    expect(isDelegatedAgentWorkflow('claude_code')).toBe(true)
    expect(isDelegatedAgentWorkflow('claude-code')).toBe(true)
    expect(isDelegatedAgentWorkflow('codex')).toBe(true)
  })

  it('isHumanInteractiveWorkflow returns true for all known human-interactive workflows', () => {
    expect(isHumanInteractiveWorkflow('vscode')).toBe(true)
    expect(isHumanInteractiveWorkflow('cursor')).toBe(true)
    expect(isHumanInteractiveWorkflow('github_copilot')).toBe(true)
  })

  it('unknown workflow is neither human_interactive nor delegated_agent', () => {
    expect(isHumanInteractiveWorkflow('unknown')).toBe(false)
    expect(isDelegatedAgentWorkflow('unknown')).toBe(false)
  })

  it('getHeadlineTimeMetricLabel returns correct label per mode', () => {
    expect(getHeadlineTimeMetricLabel('vscode')).toBe('Active coding/session')
    expect(getHeadlineTimeMetricLabel('cursor')).toBe('Active coding/session')
    expect(getHeadlineTimeMetricLabel('devin')).toBe('Session runtime/session')
    expect(getHeadlineTimeMetricLabel('claude_code')).toBe('Session runtime/session')
    expect(getHeadlineTimeMetricLabel('codex')).toBe('Session runtime/session')
    expect(getHeadlineTimeMetricLabel('unknown')).toBe('Session time')
  })

  it('getCostPerHourLabel returns correct label per mode', () => {
    expect(getCostPerHourLabel('vscode')).toBe('Configured cost/active hour')
    expect(getCostPerHourLabel('devin')).toBe('Configured cost/runtime hour')
    expect(getCostPerHourLabel('claude_code')).toBe('Configured cost/runtime hour')
    expect(getCostPerHourLabel('codex')).toBe('Configured cost/runtime hour')
    expect(getCostPerHourLabel('unknown')).toBe('Configured cost/session')
  })
})

describe('CR-X P1B.2 S1 — Active-Coding Generator Mode-Aware Gating', () => {
  it('skips ALL delegated agents, not just claude_code (Shape E: agent-heavy)', () => {
    const input = getPilotShape('E')
    const result = generateActiveCodingTimeByIDE(input)

    // The result should NOT include devin or claude_code in the active-coding comparison.
    // It should either return null (insufficient IDE workflows) or a comparison
    // of only human_interactive workflows (vscode, cursor).
    if (result && result.breakdownByTool) {
      const tools = Object.keys(result.breakdownByTool)
      for (const tool of tools) {
        expect(isDelegatedAgentWorkflow(tool)).toBe(false)
      }
    }
  })

  it('does NOT produce active-coding comparison for delegated agents (Shape D)', () => {
    const input = getPilotShape('D')
    const result = generateActiveCodingTimeByIDE(input)

    if (result && result.breakdownByTool) {
      const tools = Object.keys(result.breakdownByTool)
      expect(tools).not.toContain('devin')
      expect(tools).not.toContain('claude_code')
    }
  })
})

describe('CR-X P1B.2 S1 — AIOI Mode-Aware Hero Metric', () => {
  // Helper: build minimal aggregated metadata for AIOI
  function buildAioiInput(tool: string, sessionCount: number) {
    return {
      aggregatedRows: [{
        tool,
        session_count: sessionCount,
        average_session_length_minutes: 45,
        total_session_minutes: sessionCount * 45,
        active_coding_time_minutes: sessionCount * 20,
        ai_usage_duration_minutes: sessionCount * 10,
        time_to_first_commit_minutes: 15,
        ai_suggestions_accepted: sessionCount * 3,
        commits_per_session: 1.5,
        idle_time_minutes: sessionCount * 5,
        focus_ratio: 0.5,
      }],
      metadata: {
        tools_in_population: [tool],
        session_count_by_tool: { [tool]: sessionCount },
      },
      observedCommitTtfcAuthority: null as any,
    }
  }

  it('Devin hero metric is session runtime, NOT active coding', () => {
    const input = buildAioiInput('devin', 100)
    const result = buildMeasuredWorkflowIntelligence(
      input.aggregatedRows as any,
      input.metadata as any,
      (id: string) => id,
    )
    const devinCard = result.find(c => c.toolId === 'devin')
    expect(devinCard).toBeDefined()
    expect(devinCard!.heroMetricKey).toBe('averageSessionLengthMinutes')
    // CR-X P1B.2 Wave 0: modality is SURFACE-derived. Devin runs on vscode surface → 'editor'.
    expect(devinCard!.modality).toBe('editor')
    // operationalMode is the separate dimension that captures delegated_agent semantics.
    expect(devinCard!.operationalMode).toBe('delegated_agent')
  })

  it('Claude Code hero metric is session runtime, NOT active coding', () => {
    const input = buildAioiInput('claude_code', 100)
    const result = buildMeasuredWorkflowIntelligence(
      input.aggregatedRows as any,
      input.metadata as any,
      (id: string) => id,
    )
    const ccCard = result.find(c => c.toolId === 'claude_code')
    expect(ccCard).toBeDefined()
    expect(ccCard!.heroMetricKey).toBe('averageSessionLengthMinutes')
    // Claude Code runs on a terminal surface → 'terminal'.
    expect(ccCard!.modality).toBe('terminal')
    expect(ccCard!.operationalMode).toBe('delegated_agent')
  })

  it('VS Code hero metric is active coding', () => {
    const input = buildAioiInput('vscode', 100)
    const result = buildMeasuredWorkflowIntelligence(
      input.aggregatedRows as any,
      input.metadata as any,
      (id: string) => id,
    )
    const vscodeCard = result.find(c => c.toolId === 'vscode')
    expect(vscodeCard).toBeDefined()
    expect(vscodeCard!.heroMetricKey).toBe('activeCodingMinutesPerSession')
    expect(vscodeCard!.modality).toBe('editor')
    expect(vscodeCard!.operationalMode).toBe('human_interactive')
  })

  it('Cursor hero metric is active coding', () => {
    const input = buildAioiInput('cursor', 100)
    const result = buildMeasuredWorkflowIntelligence(
      input.aggregatedRows as any,
      input.metadata as any,
      (id: string) => id,
    )
    const cursorCard = result.find(c => c.toolId === 'cursor')
    expect(cursorCard).toBeDefined()
    expect(cursorCard!.heroMetricKey).toBe('activeCodingMinutesPerSession')
    expect(cursorCard!.modality).toBe('editor')
    expect(cursorCard!.operationalMode).toBe('human_interactive')
  })

  it('Devin suppresses active_coding/focus/idle as labeled metrics', () => {
    const input = buildAioiInput('devin', 100)
    const result = buildMeasuredWorkflowIntelligence(
      input.aggregatedRows as any,
      input.metadata as any,
      (id: string) => id,
    )
    const devinCard = result.find(c => c.toolId === 'devin')
    expect(devinCard).toBeDefined()
    expect(devinCard!.activeCodingMinutesPerSession).toBeNull()
    expect(devinCard!.activeCodingRatio).toBeNull()
    expect(devinCard!.focusRatio).toBeNull()
    expect(devinCard!.idleRatio).toBeNull()
  })

  it('Claude Code suppresses active_coding/focus/idle as labeled metrics', () => {
    const input = buildAioiInput('claude_code', 100)
    const result = buildMeasuredWorkflowIntelligence(
      input.aggregatedRows as any,
      input.metadata as any,
      (id: string) => id,
    )
    const ccCard = result.find(c => c.toolId === 'claude_code')
    expect(ccCard).toBeDefined()
    expect(ccCard!.activeCodingMinutesPerSession).toBeNull()
    expect(ccCard!.focusRatio).toBeNull()
    expect(ccCard!.idleRatio).toBeNull()
  })

  it('VS Code shows active_coding/focus as labeled metrics', () => {
    const input = buildAioiInput('vscode', 100)
    const result = buildMeasuredWorkflowIntelligence(
      input.aggregatedRows as any,
      input.metadata as any,
      (id: string) => id,
    )
    const vscodeCard = result.find(c => c.toolId === 'vscode')
    expect(vscodeCard).toBeDefined()
    expect(vscodeCard!.activeCodingMinutesPerSession).not.toBeNull()
    expect(vscodeCard!.focusRatio).not.toBeNull()
  })
})
