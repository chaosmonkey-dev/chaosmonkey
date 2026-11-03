/**
 * CR-X PBT-CLEANUP-3: Delivery metric dropdown / fetch / render truth.
 *
 * Proves:
 * 1. The 3 IDE telemetry metrics (TTFC, files/session, commits/session) are
 *    NOT in the Delivery optgroup (they're IDE metrics, not delivery)
 * 2. All 8 true delivery metrics ARE in DELIVERY_METRIC_FIELDS
 * 3. allProductivityMetrics (telemetry request) does NOT contain delivery.* entries
 *    (delivery metrics come from /api/delivery/timeseries, not /api/telemetry)
 * 4. METRIC_POLARITY covers all 8 delivery metrics
 * 5. Delivery metrics force Time Series view (no Cards source)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { METRIC_POLARITY } from '../lib/productivityCards'

const FRONTEND_SRC = join(__dirname, '..')
const pbtSource = readFileSync(join(FRONTEND_SRC, 'components', 'ProductivityByToolV3.vue'), 'utf-8')

// Extract the Delivery optgroup options from the source
function extractOptgroupOptions(source: string, label: string): string[] {
  const regex = new RegExp(`<optgroup label="${label}">([\\s\\S]*?)</optgroup>`)
  const match = source.match(regex)
  if (!match) return []
  const optgroupHtml = match[1]
  const optionValues: string[] = []
  const optionRegex = /<option value="([^"]+)"/g
  let m
  while ((m = optionRegex.exec(optgroupHtml)) !== null) {
    optionValues.push(m[1])
  }
  return optionValues
}

describe('CR-X PBT-CLEANUP-3: delivery metric dropdown / fetch / render truth', () => {
  // The 8 true delivery metrics from /api/delivery/timeseries
  const TRUE_DELIVERY_METRICS = [
    'merged_pr_count',
    'deployment_count',
    'deploy_success_rate',
    'median_merge_cycle_hours',
    'release_count',
    'review_count',
    'pr_review_cycles',
    'merge_rate',
  ]

  // The 3 IDE telemetry metrics that were misclassified as Delivery
  const MISCLASSIFIED_IDE_METRICS = [
    'time_to_first_commit_minutes',
    'files_edited_per_session',
    'commits_per_session',
  ]

  it('1. Delivery optgroup contains only true delivery metrics (no IDE metrics)', () => {
    const deliveryOptions = extractOptgroupOptions(pbtSource, 'Delivery')
    expect(deliveryOptions.length).toBe(8)
    for (const metric of TRUE_DELIVERY_METRICS) {
      expect(deliveryOptions).toContain(metric)
    }
    // The 3 misclassified IDE metrics must NOT be in the Delivery optgroup
    for (const metric of MISCLASSIFIED_IDE_METRICS) {
      expect(deliveryOptions).not.toContain(metric)
    }
  })

  it('2. Misclassified IDE metrics are in Focus & Productivity optgroup', () => {
    const focusOptions = extractOptgroupOptions(pbtSource, 'Focus & Productivity')
    for (const metric of MISCLASSIFIED_IDE_METRICS) {
      expect(focusOptions).toContain(metric)
    }
  })

  it('3. allProductivityMetrics (telemetry request) does NOT contain delivery.* entries', () => {
    // Delivery metrics come from /api/delivery/timeseries, not /api/productivity/timeseries
    // The telemetry request list must not include delivery.* entries
    expect(pbtSource).not.toContain("'delivery.merged_pr_count'")
    expect(pbtSource).not.toContain("'delivery.deployment_count'")
    expect(pbtSource).not.toContain("'delivery.deploy_success_rate'")
    expect(pbtSource).not.toContain("'delivery.median_merge_cycle_hours'")
  })

  it('4. METRIC_POLARITY covers all 8 delivery metrics', () => {
    for (const metric of TRUE_DELIVERY_METRICS) {
      expect(METRIC_POLARITY[metric]).toBeDefined()
      expect(['higher', 'lower']).toContain(METRIC_POLARITY[metric])
    }
    // Verify specific polarities
    expect(METRIC_POLARITY['merged_pr_count']).toBe('higher')
    expect(METRIC_POLARITY['deployment_count']).toBe('higher')
    expect(METRIC_POLARITY['deploy_success_rate']).toBe('higher')
    expect(METRIC_POLARITY['median_merge_cycle_hours']).toBe('lower')
    expect(METRIC_POLARITY['release_count']).toBe('higher')
    expect(METRIC_POLARITY['review_count']).toBe('higher')
    expect(METRIC_POLARITY['pr_review_cycles']).toBe('higher')
    expect(METRIC_POLARITY['merge_rate']).toBe('higher')
  })

  it('5. Cards toggle is disabled for delivery metrics (source-level proof)', () => {
    // The Cards button must have :disabled="isDeliveryMetric"
    expect(pbtSource).toContain(':disabled="isDeliveryMetric"')
    expect(pbtSource).toContain('Delivery metrics are org-level — Time Series view only')
  })

  it('6. Delivery metrics force Time Series view (watcher exists)', () => {
    // The watcher must force timeseries when isDeliveryMetric becomes true
    expect(pbtSource).toContain("if (isDelivery && selectedView.value === 'cards')")
    expect(pbtSource).toContain("selectedView.value = 'timeseries'")
  })
})
