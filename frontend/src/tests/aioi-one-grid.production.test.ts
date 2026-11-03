import { describe, it, expect } from 'vitest'
import {
  buildMeasuredWorkflowIntelligence,
  type CanonicalAggregatedRowLike,
  type CanonicalAggregatedMetadataLike,
} from '../lib/aioi/buildMeasuredWorkflowIntelligence'
import { getCanonicalWorkflowIdentity, normalizeToCanonicalToolId } from '../lib/workflowIdentity'

const PRIMARY_SESSION_THRESHOLD = 25

const makeRows = (tools: string[], sessionCount = 10): CanonicalAggregatedRowLike[] =>
  tools.map((tool) => ({
    tool,
    session_count: sessionCount,
    average_session_length_minutes: 30,
    active_coding_time_minutes: 15,
    ai_usage_duration_minutes: 10,
    time_to_first_commit_minutes: 5,
    ai_suggestions_accepted: 3,
    commits_per_session: 1,
    idle_time_minutes: 5,
    focus_ratio: 0.5,
    total_session_minutes: 30,
  }))

const localMetadata: CanonicalAggregatedMetadataLike = {
  tools_in_population: ['claude_code', 'cursor', 'devin', 'github_copilot', 'vscode', 'windsurf'],
  session_count_by_tool: {
    claude_code: 54,
    cursor: 274,
    devin: 131,
    github_copilot: 6,
    vscode: 548,
    windsurf: 842,
  },
}

const localRows: CanonicalAggregatedRowLike[] = [
  ...makeRows(['windsurf'], 842),
  ...makeRows(['devin'], 131),
  ...makeRows(['vscode'], 548),
  ...makeRows(['cursor'], 274),
  ...makeRows(['claude_code'], 54),
  ...makeRows(['github_copilot'], 6),
]

function buildLocal() {
  return buildMeasuredWorkflowIntelligence(localRows, localMetadata, getCanonicalWorkflowIdentity)
}

function orderedWorkflows(workflows: ReturnType<typeof buildMeasuredWorkflowIntelligence>) {
  return workflows
    .filter(w => w.sessionCount > 0)
    .sort((a, b) => {
      const aEmerging = a.sessionCount < PRIMARY_SESSION_THRESHOLD
      const bEmerging = b.sessionCount < PRIMARY_SESSION_THRESHOLD
      if (aEmerging !== bEmerging) return aEmerging ? 1 : -1
      return b.sessionCount - a.sessionCount
    })
}

function isEmerging(w: { sessionCount: number }): boolean {
  return w.sessionCount < PRIMARY_SESSION_THRESHOLD
}

function sessionsToPrimary(w: { sessionCount: number }): number {
  return Math.max(PRIMARY_SESSION_THRESHOLD - w.sessionCount, 0)
}

describe('AIOI One-Grid Production Tests', () => {
  it('1. 4 primary + 1 emerging produces one ordered five-card collection', () => {
    const all = buildLocal()
    const ordered = orderedWorkflows(all)
    expect(ordered).toHaveLength(5)
  })

  it('2. primary cards precede emerging cards', () => {
    const all = buildLocal()
    const ordered = orderedWorkflows(all)
    const firstEmergingIdx = ordered.findIndex(w => isEmerging(w))
    // All items before first emerging must be primary
    for (let i = 0; i < firstEmergingIdx; i++) {
      expect(isEmerging(ordered[i])).toBe(false)
    }
    // All items from firstEmergingIdx onward must be emerging
    for (let i = firstEmergingIdx; i < ordered.length; i++) {
      expect(isEmerging(ordered[i])).toBe(true)
    }
  })

  it('3. one emerging workflow does not create a second grid', () => {
    const all = buildLocal()
    const ordered = orderedWorkflows(all)
    const emergingCount = ordered.filter(isEmerging).length
    expect(emergingCount).toBe(1)
    // The ordered collection is a single array — no second grid
    expect(Array.isArray(ordered)).toBe(true)
    expect(ordered.length).toBe(5)
  })

  it('4. six sessions derives 19 remaining', () => {
    const all = buildLocal()
    const copilot = all.find(w => w.toolId === 'github_copilot')
    expect(copilot).toBeDefined()
    expect(copilot!.sessionCount).toBe(6)
    expect(sessionsToPrimary(copilot!)).toBe(19)
  })

  it('5. 25 sessions is primary with zero remaining', () => {
    const metadata: CanonicalAggregatedMetadataLike = {
      tools_in_population: ['vscode', 'github_copilot'],
      session_count_by_tool: { vscode: 100, github_copilot: 25 },
    }
    const rows = [
      ...makeRows(['vscode'], 100),
      ...makeRows(['github_copilot'], 25),
    ]
    const result = buildMeasuredWorkflowIntelligence(rows, metadata, getCanonicalWorkflowIdentity)
    const copilot = result.find(w => w.toolId === 'github_copilot')
    expect(copilot).toBeDefined()
    expect(copilot!.sessionCount).toBe(25)
    expect(isEmerging(copilot!)).toBe(false)
    expect(sessionsToPrimary(copilot!)).toBe(0)
  })

  it('6. all five workflows remain present', () => {
    const all = buildLocal()
    const toolIds = all.map(w => w.toolId).sort()
    expect(toolIds).toEqual(['claude_code', 'cursor', 'devin', 'github_copilot', 'vscode'])
  })

  it('7. Claude Code unsupported metrics remain null/not instrumented', () => {
    const all = buildLocal()
    const claude = all.find(w => w.toolId === 'claude_code')
    expect(claude).toBeDefined()
    expect(claude!.activeCodingMinutesPerSession).toBeNull()
    expect(claude!.activeCodingRatio).toBeNull()
    expect(claude!.focusRatio).toBeNull()
    expect(claude!.idleRatio).toBeNull()
  })

  it('8. Claude Code AI activity (ai_suggestions_accepted) is observed — CR-X PI/PBT-TIME P0 parity correction', () => {
    const all = buildLocal()
    const claude = all.find(w => w.toolId === 'claude_code')
    expect(claude).toBeDefined()
    // CR-X PI/PBT-TIME P0: The canonical aggregated endpoint returns finite
    // observed ai_suggestions_accepted values for Claude Code sessions.
    // AIOI and PBT must show the same metric under the same scope.
    expect(claude!.aiActivityPerSession).not.toBeNull()
    // Valid Claude Code metrics remain available
    expect(claude!.averageSessionLengthMinutes).not.toBeNull()
    expect(claude!.aiUsageRatio).not.toBeNull()
  })

  it('9. Windsurf remains normalized to Devin', () => {
    expect(normalizeToCanonicalToolId('windsurf')).toBe('devin')
    const all = buildLocal()
    const devin = all.find(w => w.toolId === 'devin')
    expect(devin).toBeDefined()
    expect(devin!.sessionCount).toBe(973) // 842 + 131
    // No separate windsurf card
    const windsurf = all.find(w => w.toolId === 'windsurf')
    expect(windsurf).toBeUndefined()
  })
})
