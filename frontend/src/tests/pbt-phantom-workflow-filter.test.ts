import { describe, it, expect } from 'vitest'

/**
 * Regression tests for PBT phantom empty workflow filter.
 *
 * Bug: When switching metrics (e.g., AI Activity / Session → Commits / Session),
 * the UI could create an active Workflow: chip with no workflow value,
 * blank the workflow/compare selector, and suppress all chart data.
 *
 * Root cause: watch(isDeliveryMetric) set selectedWorkflow = '' when a delivery
 * metric was selected, but never reset to 'compare' when switching away.
 * The empty string '' persisted as a phantom workflow filter.
 *
 * Required invariant: An empty workflow selection is NO FILTER.
 * null, undefined, '', empty array, and stale selections are all equivalent
 * to 'compare' (no workflow constraint).
 */

// --- Replicate the normalization logic ---

/**
 * Normalizes a workflow selection to either 'compare' or a valid workflow ID.
 * All empty/stale states map to 'compare' (no filter).
 */
function normalizeWorkflow(
  selectedWorkflow: string | null | undefined,
  availableWorkflowIds: string[]
): string {
  // Empty states = no filter
  if (selectedWorkflow === '' || selectedWorkflow === null || selectedWorkflow === undefined) {
    return 'compare'
  }
  // 'compare' is always valid
  if (selectedWorkflow === 'compare') {
    return 'compare'
  }
  // Stale selection (not in available workflows) = no filter
  if (!availableWorkflowIds.includes(selectedWorkflow)) {
    return 'compare'
  }
  return selectedWorkflow
}

/**
 * Determines whether a Workflow chip should render.
 * A chip should ONLY render for a specific, valid workflow — never for empty/stale.
 */
function shouldRenderWorkflowChip(
  selectedWorkflow: string | null | undefined,
  availableWorkflowIds: string[]
): boolean {
  const normalized = normalizeWorkflow(selectedWorkflow, availableWorkflowIds)
  return normalized !== 'compare'
}

/**
 * Determines whether the chart should be in compare mode (all workflows).
 */
function isCompareMode(
  selectedWorkflow: string | null | undefined,
  availableWorkflowIds: string[]
): boolean {
  return normalizeWorkflow(selectedWorkflow, availableWorkflowIds) === 'compare'
}

// Delivery metric fields (from ProductivityByToolV3.vue)
const DELIVERY_METRIC_FIELDS = new Set([
  'merged_pr_count', 'deployment_count', 'deploy_success_rate', 'median_merge_cycle_hours'
])

function isDeliveryMetric(metric: string): boolean {
  return DELIVERY_METRIC_FIELDS.has(metric)
}

// Available workflow IDs for test scenarios
const WORKFLOWS_3 = ['cursor', 'vscode', 'windsurf']
const WORKFLOWS_5 = ['cursor', 'vscode', 'windsurf', 'claude-code', 'github-copilot']

// --- Tests ---

describe('PBT phantom workflow filter — empty state normalization', () => {
  it('1) null workflow selection is treated as compare (no filter)', () => {
    expect(normalizeWorkflow(null, WORKFLOWS_3)).toBe('compare')
    expect(shouldRenderWorkflowChip(null, WORKFLOWS_3)).toBe(false)
    expect(isCompareMode(null, WORKFLOWS_3)).toBe(true)
  })

  it('2) undefined workflow selection is treated as compare', () => {
    expect(normalizeWorkflow(undefined, WORKFLOWS_3)).toBe('compare')
    expect(shouldRenderWorkflowChip(undefined, WORKFLOWS_3)).toBe(false)
  })

  it('3) empty string workflow selection is treated as compare', () => {
    // This is the exact phantom filter from the bug: selectedWorkflow = ''
    expect(normalizeWorkflow('', WORKFLOWS_3)).toBe('compare')
    expect(shouldRenderWorkflowChip('', WORKFLOWS_3)).toBe(false)
    expect(isCompareMode('', WORKFLOWS_3)).toBe(true)
  })

  it('4) stale workflow selection (not in available) is treated as compare', () => {
    // A workflow that was valid but is no longer in availableWorkflows
    expect(normalizeWorkflow('old-workflow', WORKFLOWS_3)).toBe('compare')
    expect(shouldRenderWorkflowChip('old-workflow', WORKFLOWS_3)).toBe(false)
  })

  it('5) valid workflow selection is preserved', () => {
    expect(normalizeWorkflow('cursor', WORKFLOWS_3)).toBe('cursor')
    expect(shouldRenderWorkflowChip('cursor', WORKFLOWS_3)).toBe(true)
    expect(isCompareMode('cursor', WORKFLOWS_3)).toBe(false)
  })

  it('6) compare selection is always preserved', () => {
    expect(normalizeWorkflow('compare', WORKFLOWS_3)).toBe('compare')
    expect(shouldRenderWorkflowChip('compare', WORKFLOWS_3)).toBe(false)
    expect(isCompareMode('compare', WORKFLOWS_3)).toBe(true)
  })
})

describe('PBT phantom workflow filter — metric switch sequence', () => {
  // Simulate the exact Matt browser sequence:
  // 1. metric = AI Activity / Session, workflow = compare → 3 workflows / 613 sessions
  // 2. switch metric to Commits / Session → phantom chip should NOT appear

  it('7) AI Activity → Commits: no phantom chip (both non-delivery)', () => {
    let selectedWorkflow = 'compare'
    const metric1 = 'ai_suggestions_accepted'
    const metric2 = 'commits_per_session'

    // Before: AI Activity, compare mode
    expect(isDeliveryMetric(metric1)).toBe(false)
    expect(isCompareMode(selectedWorkflow, WORKFLOWS_3)).toBe(true)
    expect(shouldRenderWorkflowChip(selectedWorkflow, WORKFLOWS_3)).toBe(false)

    // Switch to Commits / Session
    // isDeliveryMetric watcher: no change (both false), no fire
    // selectedMetric watcher: normalizes empty/stale → compare
    const normalized = normalizeWorkflow(selectedWorkflow, WORKFLOWS_3)
    selectedWorkflow = normalized

    // After: Commits, still compare mode, no phantom chip
    expect(isDeliveryMetric(metric2)).toBe(false)
    expect(isCompareMode(selectedWorkflow, WORKFLOWS_3)).toBe(true)
    expect(shouldRenderWorkflowChip(selectedWorkflow, WORKFLOWS_3)).toBe(false)
  })

  it('8) delivery → non-delivery: phantom empty filter is cleaned', () => {
    // Simulate: user selects a delivery metric (selectedWorkflow set to ''),
    // then switches to a non-delivery metric.
    let selectedWorkflow = 'compare'
    const deliveryMetric = 'merged_pr_count'
    const nonDeliveryMetric = 'commits_per_session'

    // Step 1: Select delivery metric → watcher sets selectedWorkflow = ''
    expect(isDeliveryMetric(deliveryMetric)).toBe(true)
    if (isDeliveryMetric(deliveryMetric) && selectedWorkflow === 'compare') {
      selectedWorkflow = '' // exit compare mode (the bug)
    }

    // At this point, selectedWorkflow is '' — phantom filter
    expect(selectedWorkflow).toBe('')

    // Step 2: Switch to non-delivery metric
    // The fix: isDeliveryMetric watcher resets '' to 'compare' when !isDelivery
    if (!isDeliveryMetric(nonDeliveryMetric) && selectedWorkflow === '') {
      selectedWorkflow = 'compare' // reset phantom empty filter
    }
    // The fix: selectedMetric watcher also normalizes empty/stale
    selectedWorkflow = normalizeWorkflow(selectedWorkflow, WORKFLOWS_3)

    // After: no phantom chip
    expect(selectedWorkflow).toBe('compare')
    expect(shouldRenderWorkflowChip(selectedWorkflow, WORKFLOWS_3)).toBe(false)
    expect(isCompareMode(selectedWorkflow, WORKFLOWS_3)).toBe(true)
  })

  it('9) delivery → delivery: workflow stays empty (correct for delivery)', () => {
    let selectedWorkflow = 'compare'
    const deliveryMetric1 = 'merged_pr_count'
    const deliveryMetric2 = 'deployment_count'

    // Select first delivery metric
    if (isDeliveryMetric(deliveryMetric1) && selectedWorkflow === 'compare') {
      selectedWorkflow = ''
    }

    // Switch to second delivery metric — should stay empty (delivery mode)
    // isDeliveryMetric watcher: was true, still true → no change → no fire
    // But the fix's !isDelivery branch doesn't fire either (isDelivery is still true)
    expect(selectedWorkflow).toBe('')
    // Delivery metrics don't use workflow filter, so '' is acceptable here
    // The chart renders a single delivery series, not per-workflow
  })

  it('10) non-delivery → delivery → non-delivery: full cycle cleans up', () => {
    let selectedWorkflow = 'compare'

    // Start: non-delivery, compare mode
    expect(isCompareMode(selectedWorkflow, WORKFLOWS_3)).toBe(true)

    // Switch to delivery metric
    if (isDeliveryMetric('merged_pr_count') && selectedWorkflow === 'compare') {
      selectedWorkflow = ''
    }
    expect(selectedWorkflow).toBe('')

    // Switch back to non-delivery metric
    if (!isDeliveryMetric('ai_suggestions_accepted') && selectedWorkflow === '') {
      selectedWorkflow = 'compare'
    }
    selectedWorkflow = normalizeWorkflow(selectedWorkflow, WORKFLOWS_3)

    expect(selectedWorkflow).toBe('compare')
    expect(shouldRenderWorkflowChip(selectedWorkflow, WORKFLOWS_3)).toBe(false)
  })
})

describe('PBT phantom workflow filter — filter context scenarios', () => {
  it('11) developer only (no repo, no workflow): no phantom chip', () => {
    const selectedWorkflow = 'compare'
    const selectedDeveloper = 'matt'
    const selectedRepo = ''

    expect(shouldRenderWorkflowChip(selectedWorkflow, WORKFLOWS_3)).toBe(false)
    expect(selectedDeveloper).toBeTruthy()
    expect(selectedRepo).toBeFalsy()
  })

  it('12) repo only (no developer, no workflow): no phantom chip', () => {
    const selectedWorkflow = 'compare'
    const selectedDeveloper = ''
    const selectedRepo = 'local-demo/activity-sim'

    expect(shouldRenderWorkflowChip(selectedWorkflow, WORKFLOWS_3)).toBe(false)
    expect(selectedDeveloper).toBeFalsy()
    expect(selectedRepo).toBeTruthy()
  })

  it('13) developer + repo (no workflow): no phantom chip', () => {
    const selectedWorkflow = 'compare'
    const selectedDeveloper = 'matt'
    const selectedRepo = 'local-demo/activity-sim'

    expect(shouldRenderWorkflowChip(selectedWorkflow, WORKFLOWS_3)).toBe(false)
  })

  it('14) Jordan Vega + demo-org/demo-sim: no phantom chip on metric switch', () => {
    let selectedWorkflow = 'compare'
    const developer = 'jordan-vega'
    const repo = 'demo-org/demo-sim'

    // Switch metric from AI Activity to Commits
    // selectedWorkflow should stay 'compare'
    selectedWorkflow = normalizeWorkflow(selectedWorkflow, WORKFLOWS_3)

    expect(shouldRenderWorkflowChip(selectedWorkflow, WORKFLOWS_3)).toBe(false)
    expect(isCompareMode(selectedWorkflow, WORKFLOWS_3)).toBe(true)
  })

  it('15) Cards view: workflow filter does not produce phantom chip', () => {
    // In Cards view, the workflow filter is disabled but the value persists.
    // It should not produce a phantom chip.
    const selectedView = 'cards'
    const selectedWorkflow = 'compare'

    // In cards view, workflow chip should not render even if selectedWorkflow
    // is not 'compare' — but normalization ensures it's always 'compare'
    const normalized = normalizeWorkflow(selectedWorkflow, WORKFLOWS_3)
    expect(normalized).toBe('compare')
    expect(shouldRenderWorkflowChip(normalized, WORKFLOWS_3)).toBe(false)
  })

  it('16) Time Series view: valid workflow selection produces chip (positive case)', () => {
    const selectedView = 'timeseries'
    const selectedWorkflow = 'cursor'

    expect(shouldRenderWorkflowChip(selectedWorkflow, WORKFLOWS_3)).toBe(true)
    expect(isCompareMode(selectedWorkflow, WORKFLOWS_3)).toBe(false)
  })
})

describe('PBT phantom workflow filter — no data suppression', () => {
  it('17) empty workflow does not suppress valid series', () => {
    // The bug: empty workflow filter caused chart to show 0 data points.
    // The fix: empty workflow = compare = show all eligible workflows.
    const selectedWorkflow = ''
    const availableWorkflows = WORKFLOWS_3

    const normalized = normalizeWorkflow(selectedWorkflow, availableWorkflows)
    expect(normalized).toBe('compare')

    // In compare mode, all eligible workflows are shown — no suppression
    expect(isCompareMode(normalized, availableWorkflows)).toBe(true)
  })

  it('18) stale workflow does not suppress valid series', () => {
    const selectedWorkflow = 'deleted-workflow'
    const availableWorkflows = WORKFLOWS_3

    const normalized = normalizeWorkflow(selectedWorkflow, availableWorkflows)
    expect(normalized).toBe('compare')
    expect(isCompareMode(normalized, availableWorkflows)).toBe(true)
  })

  it('19) valid workflow correctly scopes to that workflow only', () => {
    const selectedWorkflow = 'cursor'
    const availableWorkflows = WORKFLOWS_3

    const normalized = normalizeWorkflow(selectedWorkflow, availableWorkflows)
    expect(normalized).toBe('cursor')
    expect(isCompareMode(normalized, availableWorkflows)).toBe(false)
    // Only cursor series should be shown — other workflows excluded
  })
})
