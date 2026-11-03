/**
 * Pure production helper: resolves the controlling comparison pair for a
 * decision card from the adapter's comparisonAuthority (via
 * workflowComparison.winner / runnerUp), and reorders the display rows so
 * the selected leader and baseline come first.
 *
 * Consumed by PerformanceRecommendationsView.vue buildDecisionCard.
 */

export interface RankedWorkflow {
  name: string
  value: number
  formattedValue: string
  sampleSize: number
  rank: number
  coverageLabel: string
}

export interface ComparisonPair {
  leader: RankedWorkflow | null
  baseline: RankedWorkflow | null
  displayOrder: RankedWorkflow[]
}

/**
 * Given the full ranked workflow list and the adapter-selected winner/runnerUp
 * (which carry name/value/formattedValue but not sampleSize), resolve the
 * full RankedWorkflow entries and produce a display order where:
 *   1. selected leader
 *   2. selected comparison baseline
 *   3. remaining eligible primary workflows (>=25 sessions, excluding leader/baseline)
 *   4. low-sample workflows (<25 sessions)
 */
export function resolveDecisionCardComparisonPair(
  rankedWorkflows: RankedWorkflow[],
  winner: { name: string; value: number; formattedValue: string } | null,
  runnerUp: { name: string; value: number; formattedValue: string } | null
): ComparisonPair {
  if (!winner || !runnerUp) {
    return { leader: null, baseline: null, displayOrder: rankedWorkflows }
  }

  // Find full ranked entries matching winner and runnerUp by name
  const findByName = (name: string) =>
    rankedWorkflows.find(w => w.name === name) || null

  const leader = findByName(winner.name)
  const baseline = findByName(runnerUp.name)

  if (!leader || !baseline) {
    return { leader: null, baseline: null, displayOrder: rankedWorkflows }
  }

  // Build display order: leader, baseline, remaining eligible, then low-sample
  const selectedNames = new Set([leader.name, baseline.name])
  const remaining = rankedWorkflows.filter(w => !selectedNames.has(w.name))
  const eligible = remaining.filter(w => w.sampleSize >= 25)
  const lowSample = remaining.filter(w => w.sampleSize < 25)

  return {
    leader,
    baseline,
    displayOrder: [leader, baseline, ...eligible, ...lowSample]
  }
}
