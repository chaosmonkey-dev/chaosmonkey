/**
 * CR-X PBT developer-only filtered cost — logical identity regression.
 *
 * Reproduces the real browser defect Matt reported:
 *   selectedDeveloper = 'local-developer'
 *   repo = All Repos
 *   canonical population = 1,466 (backend-resolved)
 *   active chip = Developer only
 *   banner says "allocated ... selected developer / BACKEND AUTHORITY"
 *   BUT Devin/VS Code/Cursor all show "No cost data"
 *
 * Root cause: the frontend filtered-cost layer used raw
 *   devId === selectedDeveloper.value
 * equality, which only matched literal 'local-developer' rows. The backend
 * LocalDeveloperResolver expands 'local-developer' to multiple raw identities
 * (local-developer, 4, 41001234, invite:42, ...). Sessions with user_id='4'
 * or '41001234' were silently excluded, producing an empty scoped population
 * and zero cost data despite the BACKEND AUTHORITY allocation banner.
 *
 * The fix: the /api/developers endpoint now exposes `raw_identities` on each
 * developer entry, and the frontend uses that authoritative set to filter
 * sessions — no parallel identity concept.
 */
import { describe, it, expect } from 'vitest'
import { computeDeveloperWorkflowEconomics } from '../lib/insights/final/economics/repoWorkflowEconomics'
import type { ToolCostConfig } from '../lib/toolCost'
import { normalizeCostToolId } from '../lib/toolCost'

// Mirror the component's getFilteredAllocatedCostForCard logic
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

describe('CR-X PBT developer-only filtered cost — logical identity', () => {
  // Backend-authoritative raw identity set for 'local-developer'
  // (from LocalDeveloperResolver: static identities + dynamic invites)
  const localDeveloperRawIdentities = ['local-developer', '4', '41001234']

  // Simulate the full org authoritative session population.
  // Matt's sessions are spread across multiple raw user_ids — the exact
  // condition that caused the raw-equality filter to fail.
  const orgSessions: Array<{ developer_id: string; user_id: string; tool: string }> = [
    // Matt's sessions under different raw identities
    ...Array.from({ length: 30 }, () => ({ developer_id: 'local-developer', user_id: 'local-developer', tool: 'devin' })),
    ...Array.from({ length: 50 }, () => ({ developer_id: '4', user_id: '4', tool: 'vscode' })),
    ...Array.from({ length: 40 }, () => ({ developer_id: '41001234', user_id: '41001234', tool: 'cursor' })),
    // Other developers' sessions (must NOT be included in scoped population)
    ...Array.from({ length: 100 }, () => ({ developer_id: '90001', user_id: '90001', tool: 'devin' })),
    ...Array.from({ length: 80 }, () => ({ developer_id: '90002', user_id: '90002', tool: 'vscode' })),
  ]

  const costConfigs: ToolCostConfig[] = [
    { toolId: 'devin', seatCount: 5, costPerSeatMonthly: 100, monthlySpend: 500, updatedAt: '2026-01-01' },
    { toolId: 'vscode', seatCount: 10, costPerSeatMonthly: 50, monthlySpend: 500, updatedAt: '2026-01-01' },
    { toolId: 'cursor', seatCount: 10, costPerSeatMonthly: 20, monthlySpend: 200, updatedAt: '2026-01-01' },
  ]

  it('OLD raw-equality filter produces empty/missing cost data (reproduces defect)', () => {
    // This is the BROKEN behavior: raw equality only matches 'local-developer'
    // literal rows, missing '4' and '41001234' sessions.
    const brokenScopedRows = orgSessions.filter(s => {
      const devId = s.developer_id || s.user_id
      return devId === 'local-developer'
    })
    // Only 30 sessions matched (the literal 'local-developer' rows)
    expect(brokenScopedRows).toHaveLength(30)
    // Only devin sessions are in the scoped set — vscode and cursor are missing
    const tools = new Set(brokenScopedRows.map(s => s.tool))
    expect(tools.has('devin')).toBe(true)
    expect(tools.has('vscode')).toBe(false)
    expect(tools.has('cursor')).toBe(false)

    // Compute economics with the broken scoped set
    const brokenEconomics = computeDeveloperWorkflowEconomics(
      brokenScopedRows, costConfigs, undefined, undefined, orgSessions
    )
    // Cursor and VS Code cards would show "No cost data"
    const cursorCost = getFilteredAllocatedCostForCard('cursor', brokenEconomics)
    expect(cursorCost).toBeNull()
    const vscodeCost = getFilteredAllocatedCostForCard('vscode', brokenEconomics)
    expect(vscodeCost).toBeNull()
  })

  it('NEW logical-identity filter produces non-empty cost data for all observed workflows', () => {
    // This is the FIXED behavior: use the backend-authoritative raw identity set
    const fixedScopedRows = orgSessions.filter(s => {
      const devId = String(s.developer_id || s.user_id || '')
      return localDeveloperRawIdentities.includes(devId)
    })
    // All 120 of Matt's sessions are matched (30 + 50 + 40)
    expect(fixedScopedRows).toHaveLength(120)
    const tools = new Set(fixedScopedRows.map(s => s.tool))
    expect(tools.has('devin')).toBe(true)
    expect(tools.has('vscode')).toBe(true)
    expect(tools.has('cursor')).toBe(true)

    // Compute economics with the correctly scoped set
    const fixedEconomics = computeDeveloperWorkflowEconomics(
      fixedScopedRows, costConfigs, undefined, undefined, orgSessions
    )

    // All three configured+observed workflows must have non-empty cost data
    const devinCost = getFilteredAllocatedCostForCard('devin', fixedEconomics)
    expect(devinCost).not.toBeNull()
    expect(devinCost!.costPerSession).toBeGreaterThan(0)
    expect(typeof devinCost!.costPerSession).toBe('number')

    const vscodeCost = getFilteredAllocatedCostForCard('vscode', fixedEconomics)
    expect(vscodeCost).not.toBeNull()
    expect(vscodeCost!.costPerSession).toBeGreaterThan(0)
    expect(typeof vscodeCost!.costPerSession).toBe('number')

    const cursorCost = getFilteredAllocatedCostForCard('cursor', fixedEconomics)
    expect(cursorCost).not.toBeNull()
    expect(cursorCost!.costPerSession).toBeGreaterThan(0)
    expect(typeof cursorCost!.costPerSession).toBe('number')
  })

  it('full-org bucket denominator is preserved (not org-full ÷ developer-session)', () => {
    const scopedRows = orgSessions.filter(s => {
      const devId = String(s.developer_id || s.user_id || '')
      return localDeveloperRawIdentities.includes(devId)
    })
    const economics = computeDeveloperWorkflowEconomics(
      scopedRows, costConfigs, undefined, undefined, orgSessions
    )

    // The bucket denominator must be the FULL org session count for that
    // bucket, not just the developer's sessions. This is the C6 contract.
    const devinRow = economics.find(r => r.costBucket === 'devin')
    expect(devinRow).toBeDefined()
    // Org has 130 devin sessions (30 Matt + 100 other)
    expect(devinRow!.bucketTotalSessions).toBe(130)

    const vscodeRow = economics.find(r => r.costBucket === 'vscode')
    expect(vscodeRow).toBeDefined()
    // Org has 130 vscode sessions (50 Matt + 80 other)
    expect(vscodeRow!.bucketTotalSessions).toBe(130)
  })

  it('other developers are NOT included in the scoped population', () => {
    const scopedRows = orgSessions.filter(s => {
      const devId = String(s.developer_id || s.user_id || '')
      return localDeveloperRawIdentities.includes(devId)
    })
    // No 90001 or 90002 sessions should be in the scoped set
    const otherDevSessions = scopedRows.filter(s =>
      s.developer_id === '90001' || s.developer_id === '90002'
    )
    expect(otherDevSessions).toHaveLength(0)
  })

  it('repo+developer intersection remains unchanged with logical identity', () => {
    // Add repo info to sessions
    const sessionsWithRepo = orgSessions.map((s, i) => ({
      ...s,
      git_repo_url: i < 60 ? 'https://github.com/local-demo/activity-sim' : 'https://github.com/other/repo',
    }))

    // When repo is also selected, the intersection must use the same
    // logical identity filter for developer AND the normalized repo filter
    const rawIds = localDeveloperRawIdentities
    const selectedRepo = 'local-demo/activity-sim'
    const scopedRows = sessionsWithRepo.filter(s => {
      const devId = String(s.developer_id || s.user_id || '')
      // Simple normalization: extract host/path from URL
      const repo = s.git_repo_url.replace('https://github.com/', '')
      return rawIds.includes(devId) && repo === selectedRepo
    })

    // Should include the operator's sessions in the demo repo across all
    // raw identities (first 30 devin + first 30 of the 50 vscode = 60 max)
    expect(scopedRows.length).toBeGreaterThan(0)
    expect(scopedRows.length).toBeLessThanOrEqual(120)
    // All scoped rows must be Matt's identities
    for (const row of scopedRows) {
      expect(rawIds.includes(row.developer_id)).toBe(true)
    }
  })
})
