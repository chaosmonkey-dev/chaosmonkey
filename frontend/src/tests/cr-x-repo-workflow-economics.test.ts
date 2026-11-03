import { describe, it, expect } from 'vitest'
import {
  computeRepoWorkflowEconomics,
  computeDeveloperWorkflowEconomics,
  computeTotalEligibleWindowSpend,
} from '../lib/insights/final/economics/repoWorkflowEconomics'
import type { ToolCostConfig } from '../lib/toolCost'

const cursorCost: ToolCostConfig = {
  toolId: 'cursor', seatCount: 10, costPerSeatMonthly: 20,
  monthlySpend: 200, updatedAt: '2026-01-01',
}
const devinCost: ToolCostConfig = {
  toolId: 'devin', seatCount: 5, costPerSeatMonthly: 100,
  monthlySpend: 500, updatedAt: '2026-01-01',
}
const vscodeCost: ToolCostConfig = {
  toolId: 'vscode', seatCount: 50, costPerSeatMonthly: 0,
  monthlySpend: 0, updatedAt: '2026-01-01',
}
const twoBucketCosts: ToolCostConfig[] = [cursorCost, devinCost]

describe('Track C6: Per-Bucket Repo × Workflow Economics', () => {
  it('returns empty for no session rows', () => {
    expect(computeRepoWorkflowEconomics([], twoBucketCosts)).toEqual([])
  })

  it('returns empty for no cost configs', () => {
    const sessions = [{ git_repo_url: 'https://github.com/org/repo1', tool: 'cursor' }]
    expect(computeRepoWorkflowEconomics(sessions, [])).toEqual([])
  })

  it('returns empty when all cost configs have zero monthly spend', () => {
    const sessions = [{ git_repo_url: 'https://github.com/org/repo1', tool: 'vscode' }]
    expect(computeRepoWorkflowEconomics(sessions, [vscodeCost])).toEqual([])
  })

  it('two workflows with different configured costs and identical session counts do NOT get identical cost/session', () => {
    const sessions = [
      { git_repo_url: 'repo1', tool: 'cursor' },
      { git_repo_url: 'repo2', tool: 'devin' },
    ]
    const result = computeRepoWorkflowEconomics(sessions, twoBucketCosts)
    expect(result).toHaveLength(2)

    const cursorRow = result.find(r => r.costBucket === 'cursor')
    const devinRow = result.find(r => r.costBucket === 'devin')
    expect(cursorRow).toBeDefined()
    expect(devinRow).toBeDefined()

    // Both have 1 session, but cursor costs $200/mo and devin costs $500/mo
    expect(cursorRow!.costPerSession).not.toBe(devinRow!.costPerSession)
    expect(cursorRow!.costPerSession).toBeCloseTo(200, 0)
    expect(devinRow!.costPerSession).toBeCloseTo(500, 0)
  })

  it('repo allocations within a cost bucket sum back to that bucket windowed spend', () => {
    const sessions = [
      { git_repo_url: 'repoA', tool: 'cursor' },
      { git_repo_url: 'repoA', tool: 'cursor' },
      { git_repo_url: 'repoA', tool: 'cursor' },
      { git_repo_url: 'repoA', tool: 'cursor' },
      { git_repo_url: 'repoB', tool: 'cursor' },
      { git_repo_url: 'repoB', tool: 'cursor' },
      { git_repo_url: 'repoB', tool: 'cursor' },
      { git_repo_url: 'repoC', tool: 'cursor' },
      { git_repo_url: 'repoC', tool: 'cursor' },
      { git_repo_url: 'repoC', tool: 'cursor' },
    ]
    const result = computeRepoWorkflowEconomics(sessions, twoBucketCosts)
    const cursorRows = result.filter(r => r.costBucket === 'cursor')
    const totalAllocated = cursorRows.reduce((sum, r) => sum + r.allocatedSpend, 0)
    expect(totalAllocated).toBeCloseTo(200, 0)
  })

  it('all buckets together sum to total eligible configured window spend', () => {
    const sessions = [
      { git_repo_url: 'repo1', tool: 'cursor' },
      { git_repo_url: 'repo1', tool: 'cursor' },
      { git_repo_url: 'repo2', tool: 'devin' },
      { git_repo_url: 'repo2', tool: 'devin' },
      { git_repo_url: 'repo2', tool: 'devin' },
    ]
    const result = computeRepoWorkflowEconomics(sessions, twoBucketCosts)
    const totalAllocated = result.reduce((sum, r) => sum + r.allocatedSpend, 0)
    const totalEligible = computeTotalEligibleWindowSpend(twoBucketCosts)
    expect(totalAllocated).toBeCloseTo(totalEligible, 0)
    expect(totalEligible).toBeCloseTo(700, 0)
  })

  it('Devin + Windsurf share one configured bucket without double counting', () => {
    const sessions = [
      { git_repo_url: 'repo1', tool: 'devin' },
      { git_repo_url: 'repo1', tool: 'windsurf' },
      { git_repo_url: 'repo1', tool: 'windsurf' },
    ]
    const result = computeRepoWorkflowEconomics(sessions, [devinCost])
    expect(result).toHaveLength(1)
    expect(result[0].costBucket).toBe('devin')
    expect(result[0].sessionCount).toBe(3)
    expect(result[0].bucketTotalSessions).toBe(3)
    expect(result[0].costPerSession).toBeCloseTo(166.67, -1)
  })

  it('a tool with no configured cost does not inherit unrelated org spend', () => {
    const sessions = [
      { git_repo_url: 'repo1', tool: 'vscode' },
      { git_repo_url: 'repo1', tool: 'vscode' },
      { git_repo_url: 'repo2', tool: 'cursor' },
    ]
    const result = computeRepoWorkflowEconomics(sessions, [cursorCost])
    expect(result).toHaveLength(1)
    expect(result[0].costBucket).toBe('cursor')
    expect(result[0].sessionCount).toBe(1)
    expect(result[0].costPerSession).toBeCloseTo(200, 0)
  })

  // ── FILTER INVARIANT TESTS ──────────────────────────────────

  it('repo filter preserves org/bucket denominator — filtered repo does NOT get 100% of bucket', () => {
    // 100 cursor sessions across 2 repos
    const allSessions: Array<{ git_repo_url: string; tool: string }> = []
    for (let i = 0; i < 40; i++) allSessions.push({ git_repo_url: 'repoA', tool: 'cursor' })
    for (let i = 0; i < 60; i++) allSessions.push({ git_repo_url: 'repoB', tool: 'cursor' })

    // Org-level: repoA gets 40% of $200 = $80, repoB gets 60% = $120
    const orgResult = computeRepoWorkflowEconomics(allSessions, [cursorCost])
    const orgRepoA = orgResult.find(r => r.repo === 'repoA')!
    const orgRepoB = orgResult.find(r => r.repo === 'repoB')!
    expect(orgRepoA.allocatedSpend).toBeCloseTo(80, 0)
    expect(orgRepoB.allocatedSpend).toBeCloseTo(120, 0)

    // Filtered to repoA only — MUST still show $80, NOT $200
    const scopedRows = allSessions.filter(s => s.git_repo_url === 'repoA')
    const filteredResult = computeRepoWorkflowEconomics(scopedRows, [cursorCost], undefined, undefined, allSessions)
    expect(filteredResult).toHaveLength(1)
    expect(filteredResult[0].repo).toBe('repoA')
    expect(filteredResult[0].allocatedSpend).toBeCloseTo(80, 0)
    expect(filteredResult[0].bucketTotalSessions).toBe(100) // org denominator, not 40

    // Filtered to repoB only — MUST still show $120, NOT $200
    const scopedRowsB = allSessions.filter(s => s.git_repo_url === 'repoB')
    const filteredResultB = computeRepoWorkflowEconomics(scopedRowsB, [cursorCost], undefined, undefined, allSessions)
    expect(filteredResultB[0].allocatedSpend).toBeCloseTo(120, 0)
    expect(filteredResultB[0].bucketTotalSessions).toBe(100)
  })

  it('repo filter WITHOUT authoritative population falls back to scoped denominator (org-level safe)', () => {
    // When no authoritative population is provided, the scoped rows ARE the population.
    // This is correct for org-level (no filter) but would be wrong for filtered views.
    const sessions = [
      { git_repo_url: 'repoA', tool: 'cursor' },
      { git_repo_url: 'repoA', tool: 'cursor' },
      { git_repo_url: 'repoB', tool: 'cursor' },
      { git_repo_url: 'repoB', tool: 'cursor' },
    ]
    // No authoritative → scoped = authoritative → each repo gets 50%
    const result = computeRepoWorkflowEconomics(sessions, [cursorCost])
    expect(result.find(r => r.repo === 'repoA')!.allocatedSpend).toBeCloseTo(100, 0)
  })
})

describe('Track C6: Filter Invariant — Developer Allocation', () => {
  // Deterministic proof: $1,000 bucket, 100 org sessions, devA=20, devB=80
  const bigBucketCost: ToolCostConfig = {
    toolId: 'cursor', seatCount: 50, costPerSeatMonthly: 20,
    monthlySpend: 1000, updatedAt: '2026-01-01',
  }

  const orgSessions: Array<{ developer_id: string; tool: string }> = []
  for (let i = 0; i < 20; i++) orgSessions.push({ developer_id: 'devA', tool: 'cursor' })
  for (let i = 0; i < 80; i++) orgSessions.push({ developer_id: 'devB', tool: 'cursor' })

  it('org-level: devA gets $200, devB gets $800, total = $1000', () => {
    const result = computeDeveloperWorkflowEconomics(orgSessions, [bigBucketCost])
    const devA = result.find(r => r.developerId === 'devA')!
    const devB = result.find(r => r.developerId === 'devB')!
    expect(devA.allocatedSpend).toBeCloseTo(200, 0)
    expect(devB.allocatedSpend).toBeCloseTo(800, 0)
    expect(devA.allocatedSpend + devB.allocatedSpend).toBeCloseTo(1000, 0)
  })

  it('filtering to devA still shows $200, NOT $1000', () => {
    const scopedRows = orgSessions.filter(s => s.developer_id === 'devA')
    const result = computeDeveloperWorkflowEconomics(scopedRows, [bigBucketCost], undefined, undefined, orgSessions)
    expect(result).toHaveLength(1)
    expect(result[0].developerId).toBe('devA')
    expect(result[0].allocatedSpend).toBeCloseTo(200, 0)
    expect(result[0].bucketTotalSessions).toBe(100) // org denominator, not 20
    expect(result[0].costPerSession).toBeCloseTo(10, 0) // $200 / 20 sessions
  })

  it('filtering to devB still shows $800, NOT $1000', () => {
    const scopedRows = orgSessions.filter(s => s.developer_id === 'devB')
    const result = computeDeveloperWorkflowEconomics(scopedRows, [bigBucketCost], undefined, undefined, orgSessions)
    expect(result).toHaveLength(1)
    expect(result[0].developerId).toBe('devB')
    expect(result[0].allocatedSpend).toBeCloseTo(800, 0)
    expect(result[0].bucketTotalSessions).toBe(100)
    expect(result[0].costPerSession).toBeCloseTo(10, 0) // $800 / 80 sessions
  })

  it('devA + devB allocations sum to $1000 (no double counting)', () => {
    const scopedA = orgSessions.filter(s => s.developer_id === 'devA')
    const scopedB = orgSessions.filter(s => s.developer_id === 'devB')
    const resultA = computeDeveloperWorkflowEconomics(scopedA, [bigBucketCost], undefined, undefined, orgSessions)
    const resultB = computeDeveloperWorkflowEconomics(scopedB, [bigBucketCost], undefined, undefined, orgSessions)
    const total = resultA[0].allocatedSpend + resultB[0].allocatedSpend
    expect(total).toBeCloseTo(1000, 0)
  })

  it('two workflows with different configured costs and identical session counts do NOT get identical cost/session', () => {
    const sessions = [
      { developer_id: 'dev1', tool: 'cursor' },
      { developer_id: 'dev1', tool: 'devin' },
    ]
    const result = computeDeveloperWorkflowEconomics(sessions, twoBucketCosts)
    const cursorRow = result.find(r => r.costBucket === 'cursor')
    const devinRow = result.find(r => r.costBucket === 'devin')
    expect(cursorRow!.costPerSession).not.toBe(devinRow!.costPerSession)
    expect(cursorRow!.costPerSession).toBeCloseTo(200, 0)
    expect(devinRow!.costPerSession).toBeCloseTo(500, 0)
  })

  it('Devin + Windsurf share one bucket without double counting', () => {
    const sessions = [
      { developer_id: 'dev1', tool: 'windsurf' },
      { developer_id: 'dev1', tool: 'devin' },
    ]
    const result = computeDeveloperWorkflowEconomics(sessions, [devinCost])
    expect(result).toHaveLength(1)
    expect(result[0].costBucket).toBe('devin')
    expect(result[0].sessionCount).toBe(2)
  })
})

describe('Track C6: Filter Invariant — Repo Allocation (deterministic)', () => {
  const bigBucketCost: ToolCostConfig = {
    toolId: 'cursor', seatCount: 50, costPerSeatMonthly: 20,
    monthlySpend: 1000, updatedAt: '2026-01-01',
  }

  const orgSessions: Array<{ git_repo_url: string; tool: string }> = []
  for (let i = 0; i < 30; i++) orgSessions.push({ git_repo_url: 'repoX', tool: 'cursor' })
  for (let i = 0; i < 70; i++) orgSessions.push({ git_repo_url: 'repoY', tool: 'cursor' })

  it('org-level: repoX gets $300, repoY gets $700, total = $1000', () => {
    const result = computeRepoWorkflowEconomics(orgSessions, [bigBucketCost])
    const repoX = result.find(r => r.repo === 'repoX')!
    const repoY = result.find(r => r.repo === 'repoY')!
    expect(repoX.allocatedSpend).toBeCloseTo(300, 0)
    expect(repoY.allocatedSpend).toBeCloseTo(700, 0)
  })

  it('filtering to repoX still shows $300, NOT $1000', () => {
    const scopedRows = orgSessions.filter(s => s.git_repo_url === 'repoX')
    const result = computeRepoWorkflowEconomics(scopedRows, [bigBucketCost], undefined, undefined, orgSessions)
    expect(result).toHaveLength(1)
    expect(result[0].repo).toBe('repoX')
    expect(result[0].allocatedSpend).toBeCloseTo(300, 0)
    expect(result[0].bucketTotalSessions).toBe(100)
  })

  it('filtering to repoY still shows $700, NOT $1000', () => {
    const scopedRows = orgSessions.filter(s => s.git_repo_url === 'repoY')
    const result = computeRepoWorkflowEconomics(scopedRows, [bigBucketCost], undefined, undefined, orgSessions)
    expect(result).toHaveLength(1)
    expect(result[0].repo).toBe('repoY')
    expect(result[0].allocatedSpend).toBeCloseTo(700, 0)
    expect(result[0].bucketTotalSessions).toBe(100)
  })
})
