/**
 * CR-X P0.2 R2: ProductivityLineGraph timestamp-alignment regression.
 *
 * Verifies that the renderer builds a union x-axis and maps each workflow's
 * y values by exact timestamp, not by filtered-position. Sparse workflows
 * must not shift later values onto earlier labels.
 *
 * Fixture mirrors the actual Ed failure for 2026-08-24 through 2026-09-04.
 */
import { describe, it, expect } from 'vitest'
import { buildProductivityLineGraphData } from '../lib/productivity/lineGraphChartData'

const LABELS = [
  '2026-08-24T00:00:00.000Z',
  '2026-08-25T00:00:00.000Z',
  '2026-08-26T00:00:00.000Z',
  '2026-08-27T00:00:00.000Z',
  '2026-08-28T00:00:00.000Z',
  '2026-08-30T00:00:00.000Z',
  '2026-08-31T00:00:00.000Z',
  '2026-09-01T00:00:00.000Z',
  '2026-09-02T00:00:00.000Z',
  '2026-09-03T00:00:00.000Z',
  '2026-09-04T00:00:00.000Z'
]

const claudeData = [
  { x: '2026-08-25T00:00:00.000Z', y: 2 },
  { x: '2026-08-26T00:00:00.000Z', y: 0 },
  { x: '2026-08-27T00:00:00.000Z', y: 30 },
  { x: '2026-08-28T00:00:00.000Z', y: 67 },
  { x: '2026-08-31T00:00:00.000Z', y: 0 },
  { x: '2026-09-01T00:00:00.000Z', y: 3 },
  { x: '2026-09-02T00:00:00.000Z', y: 0 },
  { x: '2026-09-03T00:00:00.000Z', y: 0 },
  { x: '2026-09-04T00:00:00.000Z', y: 0 }
]

const vsCodeData = [
  { x: '2026-08-24T00:00:00.000Z', y: 4 },
  { x: '2026-08-25T00:00:00.000Z', y: 2 },
  { x: '2026-08-26T00:00:00.000Z', y: 3 },
  { x: '2026-08-27T00:00:00.000Z', y: 2 },
  { x: '2026-08-28T00:00:00.000Z', y: 2 },
  { x: '2026-08-30T00:00:00.000Z', y: 4 },
  { x: '2026-08-31T00:00:00.000Z', y: 3 },
  { x: '2026-09-01T00:00:00.000Z', y: 5 },
  { x: '2026-09-02T00:00:00.000Z', y: 2 },
  { x: '2026-09-03T00:00:00.000Z', y: 3 },
  { x: '2026-09-04T00:00:00.000Z', y: 4 }
]

const lineGraphData = [
  { label: 'Claude Code workflow', data: claudeData },
  { label: 'VS Code workflow', data: vsCodeData }
]

function expectAlignment(result: { labels: string[], datasets: any[] }) {
  const claude = result.datasets.find(d => d.label === 'Claude Code workflow')
  const vscode = result.datasets.find(d => d.label === 'VS Code workflow')

  expect(result.labels).toHaveLength(11)
  expect(claude).toBeDefined()
  expect(vscode).toBeDefined()
  expect(claude.data).toHaveLength(11)
  expect(vscode.data).toHaveLength(11)

  // Claude: Aug 24 missing (index 0), Aug 27 = 30, Aug 28 = 67, zeros preserved
  expect(claude.data[0]).toBeNull()
  expect(claude.data[1]).toBe(2)
  expect(claude.data[2]).toBe(0)
  expect(claude.data[3]).toBe(30)
  expect(claude.data[4]).toBe(67)
  expect(claude.data[5]).toBeNull() // Aug 30 missing for Claude
  expect(claude.data[6]).toBe(0)
  expect(claude.data[7]).toBe(3)
  expect(claude.data[8]).toBe(0)
  expect(claude.data[9]).toBe(0)
  expect(claude.data[10]).toBe(0)

  // VS Code: all present, no left-shift of the Sep 4 value
  expect(vscode.data[0]).toBe(4)
  expect(vscode.data[10]).toBe(4)
}

describe('CR-X P0.2 R2: ProductivityLineGraph timestamp alignment', () => {
  it('aligns sparse workflows for timeFilter=all', () => {
    const result = buildProductivityLineGraphData({
      lineGraphData,
      timeFilter: 'all',
      selectedMetric: 'AI_suggestions_accepted',
      comparisonMode: 'workflows',
      getDimensionalLabel: (label: string) => label
    })

    expectAlignment(result)
  })

  it('aligns sparse workflows for timeFilter=mom (month-over-month)', () => {
    const result = buildProductivityLineGraphData({
      lineGraphData,
      timeFilter: 'mom',
      selectedMetric: 'AI_suggestions_accepted',
      comparisonMode: 'workflows',
      getDimensionalLabel: (label: string) => label
    })

    expectAlignment(result)
  })

  it('aligns sparse workflows for timeFilter=wow (week-over-week)', () => {
    const result = buildProductivityLineGraphData({
      lineGraphData,
      timeFilter: 'wow',
      selectedMetric: 'AI_suggestions_accepted',
      comparisonMode: 'workflows',
      getDimensionalLabel: (label: string) => label
    })

    expectAlignment(result)
  })

  it('rejects the positional/left-shift bug by asserting no value appears before its own timestamp', () => {
    const result = buildProductivityLineGraphData({
      lineGraphData,
      timeFilter: 'all',
      selectedMetric: 'AI_suggestions_accepted',
      comparisonMode: 'workflows',
      getDimensionalLabel: (label: string) => label
    })

    const claude = result.datasets.find(d => d.label === 'Claude Code workflow')
    // The earliest Claude value is for Aug 25 (index 1), not index 0
    expect(claude.data[0]).toBeNull()
    expect(claude.data[1]).toBe(2)
  })
})
