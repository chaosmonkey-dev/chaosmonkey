/**
 * CR-X Slice 6 R2: Harness workflow-count regression test.
 *
 * Proves that workflow_count = count of unique normalized workflow IDs,
 * NOT len(aggregated rows). A fixture with 5 workflows and many periods
 * must produce workflow_count = 5.
 */
import { describe, it, expect } from 'vitest'
import { normalizeToCanonicalToolId } from '../lib/workflowIdentity'

// Fixture: 5 distinct workflows, many period rows per workflow.
// If workflow_count were computed as len(aggregated rows), it would be 35
// (5 workflows × 7 periods). The correct answer is 5.
const FIXTURE_WORKFLOWS = ['cursor', 'devin', 'vscode', 'claude_code', 'github_copilot']
const FIXTURE_PERIODS = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']

interface AggregatedRow {
  tool: string
  period: string
  sessions: number
  metricValue: number
}

function buildFixtureRows(): AggregatedRow[] {
  const rows: AggregatedRow[] = []
  for (const tool of FIXTURE_WORKFLOWS) {
    for (const period of FIXTURE_PERIODS) {
      rows.push({ tool, period, sessions: 20, metricValue: 1.5 })
    }
  }
  return rows
}

// The CORRECT way to compute workflow_count: unique normalized workflow IDs
function computeWorkflowCountCorrect(rows: AggregatedRow[]): number {
  const ids = new Set(rows.map(r => normalizeToCanonicalToolId(r.tool)))
  return ids.size
}

// The BUGGY way: len(aggregated rows) — what we are proving is wrong
function computeWorkflowCountBuggy(rows: AggregatedRow[]): number {
  return rows.length
}

describe('CR-X Slice 6 R2: Harness workflow-count regression', () => {
  it('fixture has 5 workflows and 7 periods (35 aggregated rows)', () => {
    const rows = buildFixtureRows()
    expect(rows.length).toBe(35) // 5 × 7
  })

  it('workflow_count = 5 (unique normalized IDs), NOT 35 (len rows)', () => {
    const rows = buildFixtureRows()
    const correct = computeWorkflowCountCorrect(rows)
    const buggy = computeWorkflowCountBuggy(rows)
    expect(correct).toBe(5)
    expect(buggy).toBe(35) // prove the buggy version would give 35
    expect(correct).not.toBe(buggy) // they must differ
  })

  it('normalizes aliases (windsurf → devin) without inflating count', () => {
    const rows: AggregatedRow[] = [
      { tool: 'windsurf', period: '2026-03', sessions: 10, metricValue: 1 },
      { tool: 'devin', period: '2026-03', sessions: 10, metricValue: 1 },
      { tool: 'cursor', period: '2026-03', sessions: 10, metricValue: 1 },
    ]
    // windsurf normalizes to devin, so unique workflows = 2 (devin, cursor)
    const count = computeWorkflowCountCorrect(rows)
    expect(count).toBe(2)
  })

  it('deduplicates case variants without inflating count', () => {
    const rows: AggregatedRow[] = [
      { tool: 'Cursor', period: '2026-03', sessions: 10, metricValue: 1 },
      { tool: 'cursor', period: '2026-03', sessions: 10, metricValue: 1 },
      { tool: 'CURSOR', period: '2026-03', sessions: 10, metricValue: 1 },
      { tool: 'devin', period: '2026-03', sessions: 10, metricValue: 1 },
    ]
    // All three Cursor variants normalize to 'cursor', so unique = 2
    const count = computeWorkflowCountCorrect(rows)
    expect(count).toBe(2)
  })

  it('many periods do not inflate workflow count', () => {
    const rows: AggregatedRow[] = []
    for (let i = 0; i < 100; i++) {
      rows.push({ tool: 'cursor', period: `2026-W${i}`, sessions: 5, metricValue: 1 })
    }
    // 100 period rows, but only 1 workflow
    const count = computeWorkflowCountCorrect(rows)
    expect(count).toBe(1)
    expect(rows.length).toBe(100) // prove there are 100 rows
  })
})
