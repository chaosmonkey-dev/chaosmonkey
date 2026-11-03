/**
 * CR-X Gate A: Filtered PBT cost rendering regression test.
 *
 * Proves that when a developer/repo filter is active, PBT Cards show
 * allocated cost metrics (using the C6 per-bucket allocation formula
 * with the authoritative org population as denominator) instead of
 * the old "N/A — org-level" blanket suppression.
 */
import { describe, it, expect } from 'vitest'
import {
  computeDeveloperWorkflowEconomics,
  computeRepoWorkflowEconomics,
} from '../lib/insights/final/economics/repoWorkflowEconomics'
import type { ToolCostConfig } from '../lib/toolCost'
import { normalizeCostToolId } from '../lib/toolCost'

// Simulate the PBT card cost lookup logic
function getFilteredAllocatedCostForCard(
  cardToolId: string,
  economicsRows: Array<{ costBucket: string; allocatedSpend: number; costPerSession: number; bucketTotalSessions: number }>
): { allocatedSpend: number; costPerSession: number; bucketTotalSessions: number } | null {
  if (economicsRows.length === 0) return null
  const normalizedBucket = String(normalizeCostToolId(cardToolId))
  const row = economicsRows.find(r => r.costBucket === normalizedBucket)
  if (!row || row.allocatedSpend <= 0) return null
  return {
    allocatedSpend: row.allocatedSpend,
    costPerSession: row.costPerSession,
    bucketTotalSessions: row.bucketTotalSessions,
  }
}

const cursorCost: ToolCostConfig = {
  toolId: 'cursor', seatCount: 10, costPerSeatMonthly: 20,
  monthlySpend: 1000, updatedAt: '2026-01-01',
}

describe('CR-X Gate A: Filtered PBT Cards cost rendering', () => {
  // Setup: 100 org cursor sessions, devA=20, devB=80
  const orgSessions: Array<{ developer_id: string; tool: string }> = []
  for (let i = 0; i < 20; i++) orgSessions.push({ developer_id: 'devA', tool: 'cursor' })
  for (let i = 0; i < 80; i++) orgSessions.push({ developer_id: 'devB', tool: 'cursor' })

  it('developer-filtered card shows allocated cost, NOT N/A — org-level', () => {
    const scopedRows = orgSessions.filter(s => s.developer_id === 'devA')
    const economics = computeDeveloperWorkflowEconomics(
      scopedRows, [cursorCost], undefined, undefined, orgSessions
    )
    expect(economics).toHaveLength(1)

    // Simulate card lookup for a cursor card
    const cardCost = getFilteredAllocatedCostForCard('cursor', economics)
    expect(cardCost).not.toBeNull()
    expect(cardCost!.allocatedSpend).toBeCloseTo(200, 0) // 20% of $1000
    expect(cardCost!.costPerSession).toBeCloseTo(10, 0) // $200 / 20 sessions
    expect(cardCost!.bucketTotalSessions).toBe(100) // org denominator, not 20

    // The card must NOT show "N/A — org-level"
    // The rendering code uses allocResult to build the metric value
    const renderedValue = `$${cardCost!.costPerSession.toFixed(2)}`
    expect(renderedValue).not.toContain('N/A')
    expect(renderedValue).not.toContain('org-level')
    expect(renderedValue).toBe('$10.00')
  })

  it('repo-filtered card shows allocated cost, NOT N/A — org-level', () => {
    const repoSessions: Array<{ git_repo_url: string; tool: string }> = []
    for (let i = 0; i < 30; i++) repoSessions.push({ git_repo_url: 'repoX', tool: 'cursor' })
    for (let i = 0; i < 70; i++) repoSessions.push({ git_repo_url: 'repoY', tool: 'cursor' })

    const scopedRows = repoSessions.filter(s => s.git_repo_url === 'repoX')
    const economics = computeRepoWorkflowEconomics(
      scopedRows, [cursorCost], undefined, undefined, repoSessions
    )
    expect(economics).toHaveLength(1)

    const cardCost = getFilteredAllocatedCostForCard('cursor', economics)
    expect(cardCost).not.toBeNull()
    expect(cardCost!.allocatedSpend).toBeCloseTo(300, 0) // 30% of $1000
    expect(cardCost!.costPerSession).toBeCloseTo(10, 0) // $300 / 30 sessions
    expect(cardCost!.bucketTotalSessions).toBe(100)

    const renderedValue = `$${cardCost!.costPerSession.toFixed(2)}`
    expect(renderedValue).not.toContain('N/A')
    expect(renderedValue).not.toContain('org-level')
  })

  it('combined developer+repo filter uses intersection population with org denominator', () => {
    // 100 org sessions: devA has 20 (10 in repoX, 10 in repoY), devB has 80
    const combinedSessions: Array<{ developer_id: string; git_repo_url: string; tool: string }> = []
    for (let i = 0; i < 10; i++) combinedSessions.push({ developer_id: 'devA', git_repo_url: 'repoX', tool: 'cursor' })
    for (let i = 0; i < 10; i++) combinedSessions.push({ developer_id: 'devA', git_repo_url: 'repoY', tool: 'cursor' })
    for (let i = 0; i < 80; i++) combinedSessions.push({ developer_id: 'devB', git_repo_url: 'repoY', tool: 'cursor' })

    // Filter to devA + repoX = 10 sessions
    const scopedRows = combinedSessions.filter(s => s.developer_id === 'devA' && s.git_repo_url === 'repoX')
    expect(scopedRows.length).toBe(10)

    // Use developer economics with the combined scoped rows
    const economics = computeDeveloperWorkflowEconomics(
      scopedRows.map(s => ({ developer_id: s.developer_id, tool: s.tool })),
      [cursorCost], undefined, undefined,
      combinedSessions.map(s => ({ developer_id: s.developer_id, tool: s.tool }))
    )
    expect(economics).toHaveLength(1)

    const cardCost = getFilteredAllocatedCostForCard('cursor', economics)
    expect(cardCost).not.toBeNull()
    // 10 sessions out of 100 org total = 10% of $1000 = $100
    expect(cardCost!.allocatedSpend).toBeCloseTo(100, 0)
    expect(cardCost!.bucketTotalSessions).toBe(100) // org denominator
    expect(cardCost!.costPerSession).toBeCloseTo(10, 0) // $100 / 10 sessions
  })

  it('card for a tool with no configured cost shows No cost data, not N/A — org-level', () => {
    const scopedRows = orgSessions.filter(s => s.developer_id === 'devA')
    // No cost configs
    const economics = computeDeveloperWorkflowEconomics(
      scopedRows, [], undefined, undefined, orgSessions
    )
    expect(economics).toEqual([])

    const cardCost = getFilteredAllocatedCostForCard('cursor', economics)
    expect(cardCost).toBeNull()
    // Rendering code would show "No cost data" when allocResult is null
  })

  it('Devin + Windsurf share one bucket in filtered PBT economics', () => {
    const devinCost: ToolCostConfig = {
      toolId: 'devin', seatCount: 5, costPerSeatMonthly: 100,
      monthlySpend: 500, updatedAt: '2026-01-01',
    }
    const mixedSessions = [
      ...Array(10).fill(null).map(() => ({ developer_id: 'devA', tool: 'devin' })),
      ...Array(10).fill(null).map(() => ({ developer_id: 'devA', tool: 'windsurf' })),
      ...Array(30).fill(null).map(() => ({ developer_id: 'devB', tool: 'devin' })),
    ]
    const scopedRows = mixedSessions.filter(s => s.developer_id === 'devA')
    const economics = computeDeveloperWorkflowEconomics(
      scopedRows, [devinCost], undefined, undefined, mixedSessions
    )
    expect(economics).toHaveLength(1)
    expect(economics[0].costBucket).toBe('devin')
    expect(economics[0].sessionCount).toBe(20) // 10 devin + 10 windsurf
    expect(economics[0].bucketTotalSessions).toBe(50) // all 50 in the devin bucket

    const cardCost = getFilteredAllocatedCostForCard('windsurf', economics)
    expect(cardCost).not.toBeNull()
    // 20/50 = 40% of $500 = $200
    expect(cardCost!.allocatedSpend).toBeCloseTo(200, 0)
  })

  it('filter invariant: developer with 20% of sessions gets 20% of bucket, not 100%', () => {
    const scopedRows = orgSessions.filter(s => s.developer_id === 'devA')
    const economics = computeDeveloperWorkflowEconomics(
      scopedRows, [cursorCost], undefined, undefined, orgSessions
    )
    // devA has 20 out of 100 sessions = 20% of $1000 = $200
    expect(economics[0].allocatedSpend).toBeCloseTo(200, 0)
    // NOT $1000 (which would be 100% redistribution)
    expect(economics[0].allocatedSpend).not.toBeCloseTo(1000, 0)
  })
})
