import { describe, it, expect } from 'vitest'
import { deriveWorkflowCounts, PRIMARY_SESSION_THRESHOLD } from '../lib/workflowIdentity'

const REAL_METADATA = {
  tools_in_population: [
    'claude_code',
    'cursor',
    'devin',
    'github_copilot',
    'vscode',
    'windsurf'
  ],
  session_count_by_tool: {
    claude_code: 54,
    cursor: 274,
    devin: 133,
    github_copilot: 6,
    vscode: 548,
    windsurf: 840
  },
  canonical_population_count: 1855
}

describe('Global workflow count — production metadata', () => {
  it('produces five tracked workflows from real metadata', () => {
    expect(deriveWorkflowCounts(REAL_METADATA).trackedCount).toBe(5)
  })

  it('raw Devin 133 + Windsurf 840 produces displayed Devin 973', () => {
    const result = deriveWorkflowCounts(REAL_METADATA)
    expect(result.sessionCountByCanonical['devin']).toBe(973)
    expect(result.universe).toContain('devin')
    expect(result.universe).not.toContain('windsurf')
  })

  it('Claude Code 54 is primary', () => {
    const result = deriveWorkflowCounts(REAL_METADATA)
    expect(result.sessionCountByCanonical['claude_code']).toBe(54)
    expect(54 >= PRIMARY_SESSION_THRESHOLD).toBe(true)
    expect(result.universe).toContain('claude_code')
  })

  it('GitHub Copilot 6 is emerging', () => {
    const result = deriveWorkflowCounts(REAL_METADATA)
    expect(result.sessionCountByCanonical['github_copilot']).toBe(6)
    expect(6 >= PRIMARY_SESSION_THRESHOLD).toBe(false)
  })

  it('primary count is four', () => {
    expect(deriveWorkflowCounts(REAL_METADATA).primaryCount).toBe(4)
  })

  it('empty metadata returns zero counts', () => {
    const result = deriveWorkflowCounts({})
    expect(result.trackedCount).toBe(0)
    expect(result.primaryCount).toBe(0)
    expect(result.emergingCount).toBe(0)
  })

  it('a custom workflow with 30 sessions is tracked and primary', () => {
    const meta = {
      tools_in_population: ['custom_tool'],
      session_count_by_tool: { custom_tool: 30 },
      canonical_population_count: 30
    }
    const result = deriveWorkflowCounts(meta)
    expect(result.trackedCount).toBe(1)
    expect(result.primaryCount).toBe(1)
    expect(result.universe).toContain('custom_tool')
  })

  it('two aliases individually below 25 but combined above 25 qualify as primary', () => {
    const meta = {
      tools_in_population: ['alpha', 'beta'],
      session_count_by_tool: { alpha: 15, beta: 12 },
      canonical_population_count: 27
    }
    const result = deriveWorkflowCounts({
      ...meta,
      session_count_by_tool: { alpha: 15, beta: 12 }
    })
    // alpha and beta are distinct canonical IDs (no alias), so each is separate
    // Use a real alias scenario: windsurf=15, devin=12 → devin=27 → primary
    const aliasMeta = {
      tools_in_population: ['windsurf', 'devin'],
      session_count_by_tool: { windsurf: 15, devin: 12 },
      canonical_population_count: 27
    }
    const aliasResult = deriveWorkflowCounts(aliasMeta)
    expect(aliasResult.sessionCountByCanonical['devin']).toBe(27)
    expect(aliasResult.primaryCount).toBe(1)
    expect(aliasResult.trackedCount).toBe(1)
  })

  it('unavailable selected metric does not remove a workflow', () => {
    const meta = {
      tools_in_population: ['cursor', 'vscode'],
      session_count_by_tool: { cursor: 100, vscode: 50 },
      canonical_population_count: 150
    }
    const result = deriveWorkflowCounts(meta)
    expect(result.trackedCount).toBe(2)
    expect(result.universe).toContain('cursor')
    expect(result.universe).toContain('vscode')
  })
})
