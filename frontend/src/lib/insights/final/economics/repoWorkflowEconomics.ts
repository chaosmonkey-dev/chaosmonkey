/**
 * CR-X Track C6: Repo × Workflow Economics — Per-Bucket Allocation
 *
 * Configured cost is per tool/cost bucket. Allocation must begin with
 * the configured spend for that tool bucket, not total org spend.
 *
 * For each configured cost bucket:
 *   bucket_window_spend = computeWindowSpend(bucket_monthly_spend, from, to)
 *   bucket_population = ALL eligible canonical sessions for that bucket
 *                       in the authoritative org/time-window population
 *   group_allocated_spend = bucket_window_spend × group_sessions / bucket_population_sessions
 *
 * FILTER INVARIANT: Developer/repository filters select an allocated share;
 * they must NOT redistribute the whole configured bucket to the selected subset.
 * The denominator authority remains the full eligible bucket population
 * even when the UI filters to one developer/repository.
 *
 * Canonical cost normalization:
 *   Cursor → Cursor bucket
 *   VS Code → VS Code bucket
 *   Claude Code → Claude Code bucket
 *   GitHub Copilot → Copilot bucket
 *   Devin + Windsurf share the Devin cost bucket (no double counting)
 *
 * Usage basis: canonical session count.
 * This is observed-usage allocation, not causal attribution.
 */

import type { ToolCostConfig } from '../../../toolCost'
import { computeWindowSpend, normalizeCostToolId } from '../../../toolCost'

export interface RepoWorkflowSessionRow {
  git_repo_url?: string | null
  tool?: string | null
}

export interface RepoWorkflowEconomicsRow {
  repo: string
  workflow: string
  costBucket: string
  sessionCount: number
  bucketTotalSessions: number
  allocatedSpend: number
  costPerSession: number
}

export interface DeveloperWorkflowSessionRow {
  developer_id?: string | null
  tool?: string | null
}

export interface DeveloperWorkflowEconomicsRow {
  developerId: string
  workflow: string
  costBucket: string
  sessionCount: number
  bucketTotalSessions: number
  allocatedSpend: number
  costPerSession: number
}

/**
 * Build cost bucket map: bucketId → monthlySpend
 * Uses normalizeCostToolId so Devin+Windsurf share one bucket.
 */
function buildCostBucketMap(costConfigs: ToolCostConfig[]): Map<string, number> {
  const bucketMap = new Map<string, number>()
  for (const config of costConfigs) {
    if (config.monthlySpend > 0) {
      const bucketId = String(normalizeCostToolId(config.toolId))
      const existing = bucketMap.get(bucketId) || 0
      // If multiple configs map to the same bucket (shouldn't happen with
      // unique constraint, but be safe), take the max, not the sum
      bucketMap.set(bucketId, Math.max(existing, config.monthlySpend))
    }
  }
  return bucketMap
}

/**
 * Map a session tool to its cost bucket using canonical normalization.
 */
function sessionToolToBucket(tool: string | null | undefined): string {
  if (!tool) return 'unknown'
  return String(normalizeCostToolId(tool))
}

/**
 * Compute bucket total sessions from the AUTHORITATIVE (full org) population.
 * This is the denominator for allocation — it must NOT be computed from
 * filtered/scoped rows.
 */
function computeBucketTotals(
  authoritativeRows: Array<{ tool?: string | null }>,
  bucketMap: Map<string, number>
): Map<string, number> {
  const bucketTotals = new Map<string, number>()
  for (const row of authoritativeRows) {
    const bucket = sessionToolToBucket(row.tool)
    if (!bucketMap.has(bucket)) continue
    bucketTotals.set(bucket, (bucketTotals.get(bucket) || 0) + 1)
  }
  return bucketTotals
}

/**
 * Compute repo × workflow economics from canonical session rows
 * and configured tool cost configs.
 *
 * @param scopedSessionRows - The filtered/scoped session rows (e.g. developer-selected)
 * @param costConfigs - Tool cost configs (monthly spend per tool)
 * @param fromDate - Window start date (ISO YYYY-MM-DD) or undefined for all-time
 * @param toDate - Window end date (ISO YYYY-MM-DD) or undefined for all-time
 * @param authoritativeSessionRows - Full org population for bucket denominator.
 *        If not provided, scopedSessionRows is used as the authoritative population
 *        (correct for org-level, incorrect for filtered views).
 */
export function computeRepoWorkflowEconomics(
  scopedSessionRows: RepoWorkflowSessionRow[],
  costConfigs: ToolCostConfig[],
  fromDate?: string,
  toDate?: string,
  authoritativeSessionRows?: RepoWorkflowSessionRow[]
): RepoWorkflowEconomicsRow[] {
  if (!scopedSessionRows || scopedSessionRows.length === 0) return []
  if (!costConfigs || costConfigs.length === 0) return []

  const bucketMap = buildCostBucketMap(costConfigs)
  if (bucketMap.size === 0) return []

  // Denominator: use authoritative population if provided, else scoped rows
  // (authoritative is required for correct filtered allocation)
  const denomRows = authoritativeSessionRows || scopedSessionRows
  const bucketTotalSessions = computeBucketTotals(denomRows, bucketMap)

  // Count sessions per (repo × workflow × bucket) in the SCOPED population
  const groupCounts = new Map<string, { repo: string; workflow: string; bucket: string; count: number }>()

  for (const row of scopedSessionRows) {
    const repo = row.git_repo_url || 'unattributed'
    const bucket = sessionToolToBucket(row.tool)
    const workflow = bucket
    const key = `${repo}||${workflow}||${bucket}`

    if (!bucketMap.has(bucket)) continue

    const existing = groupCounts.get(key)
    if (existing) {
      existing.count++
    } else {
      groupCounts.set(key, { repo, workflow, bucket, count: 1 })
    }
  }

  if (groupCounts.size === 0) return []

  const rows: RepoWorkflowEconomicsRow[] = []
  for (const { repo, workflow, bucket, count } of groupCounts.values()) {
    const bucketMonthlySpend = bucketMap.get(bucket) || 0
    const bucketWindowSpend = computeWindowSpend(bucketMonthlySpend, fromDate, toDate)
    const bucketTotal = bucketTotalSessions.get(bucket) || 1
    const groupShare = count / bucketTotal
    const allocatedSpend = bucketWindowSpend * groupShare
    const costPerSession = count > 0 ? allocatedSpend / count : 0

    rows.push({
      repo,
      workflow,
      costBucket: bucket,
      sessionCount: count,
      bucketTotalSessions: bucketTotal,
      allocatedSpend,
      costPerSession,
    })
  }

  rows.sort((a, b) => b.allocatedSpend - a.allocatedSpend)
  return rows
}

/**
 * Compute developer × workflow economics from canonical session rows
 * and configured tool cost configs.
 *
 * @param scopedSessionRows - The filtered/scoped session rows (e.g. developer-selected)
 * @param costConfigs - Tool cost configs (monthly spend per tool)
 * @param fromDate - Window start date or undefined for all-time
 * @param toDate - Window end date or undefined for all-time
 * @param authoritativeSessionRows - Full org population for bucket denominator.
 *        If not provided, scopedSessionRows is used as the authoritative population
 *        (correct for org-level, incorrect for filtered views).
 */
export function computeDeveloperWorkflowEconomics(
  scopedSessionRows: DeveloperWorkflowSessionRow[],
  costConfigs: ToolCostConfig[],
  fromDate?: string,
  toDate?: string,
  authoritativeSessionRows?: DeveloperWorkflowSessionRow[]
): DeveloperWorkflowEconomicsRow[] {
  if (!scopedSessionRows || scopedSessionRows.length === 0) return []
  if (!costConfigs || costConfigs.length === 0) return []

  const bucketMap = buildCostBucketMap(costConfigs)
  if (bucketMap.size === 0) return []

  const denomRows = authoritativeSessionRows || scopedSessionRows
  const bucketTotalSessions = computeBucketTotals(denomRows, bucketMap)

  const groupCounts = new Map<string, { dev: string; workflow: string; bucket: string; count: number }>()

  for (const row of scopedSessionRows) {
    const dev = row.developer_id || 'unattributed'
    const bucket = sessionToolToBucket(row.tool)
    const workflow = bucket
    const key = `${dev}||${workflow}||${bucket}`

    if (!bucketMap.has(bucket)) continue

    const existing = groupCounts.get(key)
    if (existing) {
      existing.count++
    } else {
      groupCounts.set(key, { dev, workflow, bucket, count: 1 })
    }
  }

  if (groupCounts.size === 0) return []

  const rows: DeveloperWorkflowEconomicsRow[] = []
  for (const { dev, workflow, bucket, count } of groupCounts.values()) {
    const bucketMonthlySpend = bucketMap.get(bucket) || 0
    const bucketWindowSpend = computeWindowSpend(bucketMonthlySpend, fromDate, toDate)
    const bucketTotal = bucketTotalSessions.get(bucket) || 1
    const groupShare = count / bucketTotal
    const allocatedSpend = bucketWindowSpend * groupShare
    const costPerSession = count > 0 ? allocatedSpend / count : 0

    rows.push({
      developerId: dev,
      workflow,
      costBucket: bucket,
      sessionCount: count,
      bucketTotalSessions: bucketTotal,
      allocatedSpend,
      costPerSession,
    })
  }

  rows.sort((a, b) => b.allocatedSpend - a.allocatedSpend)
  return rows
}

/**
 * Compute the total eligible configured window spend across all buckets.
 */
export function computeTotalEligibleWindowSpend(
  costConfigs: ToolCostConfig[],
  fromDate?: string,
  toDate?: string
): number {
  const bucketMap = buildCostBucketMap(costConfigs)
  let total = 0
  for (const monthlySpend of bucketMap.values()) {
    total += computeWindowSpend(monthlySpend, fromDate, toDate)
  }
  return total
}
