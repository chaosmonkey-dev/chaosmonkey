import { describe, it, expect } from 'vitest'
import {
  buildMeasuredWorkflowIntelligence,
  deriveMeasuredWorkflowUniverse,
  type CanonicalAggregatedRowLike,
  type CanonicalAggregatedMetadataLike,
} from '../lib/aioi/buildMeasuredWorkflowIntelligence'
import { normalizeToCanonicalToolId } from '../lib/workflowIdentity'

const makeRows = (tools: string[]): CanonicalAggregatedRowLike[] =>
  tools.map((tool) => ({
    tool,
    session_count: 10,
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

describe('AIOI measured workflow universe — canonical normalization', () => {
  it('windsurf and devin collapse to a single devin entry', () => {
    const metadata: CanonicalAggregatedMetadataLike = {
      tools_in_population: ['windsurf', 'devin', 'cursor'],
      session_count_by_tool: { windsurf: 840, devin: 131, cursor: 274 },
    }
    const universe = deriveMeasuredWorkflowUniverse(metadata)
    expect(universe.sort()).toEqual(['cursor', 'devin'])
  })

  it('windsurf-only metadata yields devin as canonical ID', () => {
    const metadata: CanonicalAggregatedMetadataLike = {
      tools_in_population: ['windsurf'],
      session_count_by_tool: { windsurf: 840 },
    }
    const universe = deriveMeasuredWorkflowUniverse(metadata)
    expect(universe).toEqual(['devin'])
  })

  it('no duplicate devin cards when both windsurf and devin rows exist', () => {
    const metadata: CanonicalAggregatedMetadataLike = {
      tools_in_population: ['windsurf', 'devin'],
      session_count_by_tool: { windsurf: 840, devin: 131 },
    }
    const rows: CanonicalAggregatedRowLike[] = [
      ...makeRows(['windsurf']),
      ...makeRows(['devin']),
    ]
    const result = buildMeasuredWorkflowIntelligence(rows, metadata)
    const devinCards = result.filter((r) => r.toolId === 'devin')
    expect(devinCards).toHaveLength(1)
    expect(devinCards[0].sessionCount).toBe(971) // 840 + 131
  })

  it('all six raw tool IDs produce five canonical workflows', () => {
    const metadata: CanonicalAggregatedMetadataLike = {
      tools_in_population: ['claude_code', 'cursor', 'devin', 'github_copilot', 'vscode', 'windsurf'],
      session_count_by_tool: { claude_code: 14, cursor: 274, devin: 131, github_copilot: 6, vscode: 548, windsurf: 840 },
    }
    const universe = deriveMeasuredWorkflowUniverse(metadata)
    expect(universe.sort()).toEqual(['claude_code', 'cursor', 'devin', 'github_copilot', 'vscode'])
  })

  it('unknown, extension, and test-browser are excluded', () => {
    const metadata: CanonicalAggregatedMetadataLike = {
      tools_in_population: ['vscode', 'unknown', 'extension', 'test-browser', 'test_browser'],
      session_count_by_tool: { vscode: 10, unknown: 5, extension: 3, 'test-browser': 2, test_browser: 1 },
    }
    const universe = deriveMeasuredWorkflowUniverse(metadata)
    expect(universe).toEqual(['vscode'])
  })

  it('empty metadata yields no workflows', () => {
    expect(deriveMeasuredWorkflowUniverse(null)).toEqual([])
    expect(deriveMeasuredWorkflowUniverse(undefined)).toEqual([])
    expect(deriveMeasuredWorkflowUniverse({})).toEqual([])
  })

  it('merged session count uses both windsurf and devin metadata counts', () => {
    const metadata: CanonicalAggregatedMetadataLike = {
      tools_in_population: ['windsurf', 'devin'],
      session_count_by_tool: { windsurf: 840, devin: 131 },
    }
    const rows: CanonicalAggregatedRowLike[] = [
      { tool: 'windsurf', session_count: 840, total_session_minutes: 100 },
      { tool: 'devin', session_count: 131, total_session_minutes: 50 },
    ]
    const result = buildMeasuredWorkflowIntelligence(rows, metadata)
    const devin = result.find((r) => r.toolId === 'devin')
    expect(devin).toBeDefined()
    expect(devin!.sessionCount).toBe(971)
  })

  it('normalizeToCanonicalToolId maps correctly', () => {
    expect(normalizeToCanonicalToolId('windsurf')).toBe('devin')
    expect(normalizeToCanonicalToolId('devin')).toBe('devin')
    expect(normalizeToCanonicalToolId('cursor')).toBe('cursor')
    expect(normalizeToCanonicalToolId('vscode')).toBe('vscode')
    expect(normalizeToCanonicalToolId('claude_code')).toBe('claude_code')
    expect(normalizeToCanonicalToolId('github_copilot')).toBe('github_copilot')
    expect(normalizeToCanonicalToolId('Windsurf')).toBe('devin')
    expect(normalizeToCanonicalToolId('  windsurf  ')).toBe('devin')
  })
})
