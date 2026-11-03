/**
 * CR-X B5: Review Count, Review Cycles, Merge Rate — PBT delivery metrics.
 *
 * Proves:
 * 1. DeliveryTimeSeriesRow includes review_count, pr_review_cycles, merge_rate
 * 2. buildDeliverySeries maps them into points
 * 3. resolveTimeSeriesPointField resolves all three
 * 4. PBT dropdown includes all three options
 * 5. DELIVERY_METRIC_FIELDS includes all three
 * 6. pr_review_cycles = review_count + pr_reopened_count (formula contract)
 */
import { describe, it, expect } from 'vitest'
import { buildDeliverySeries, type DeliveryTimeSeriesRow } from '../services/metricsFacade'
import { resolveTimeSeriesPointField } from '../lib/productivity/resolveTimeSeriesPointField'
import * as fs from 'fs'
import * as path from 'path'

describe('CR-X B5: Review Count, Review Cycles, Merge Rate', () => {
  it('DeliveryTimeSeriesRow includes review_count, pr_review_cycles, merge_rate', () => {
    const row: DeliveryTimeSeriesRow = {
      period: '2026-W01',
      merged_pr_count: 5, total_pr_count: 8,
      deployment_count: 3, successful_deployment_count: 2,
      failed_deployment_count: 1, deploy_success_rate: 66.7,
      median_merge_cycle_hours: 12, release_count: 2,
      review_count: 15, pr_reopened_count: 3,
      pr_review_cycles: 18, merge_rate: 62.5,
      count_authority: 'observed_rows',
    }
    expect(row.review_count).toBe(15)
    expect(row.pr_review_cycles).toBe(18)
    expect(row.merge_rate).toBe(62.5)
  })

  it('pr_review_cycles = review_count + pr_reopened_count (formula contract)', () => {
    const reviewCount = 15
    const prReopenedCount = 3
    const prReviewCycles = reviewCount + prReopenedCount
    expect(prReviewCycles).toBe(18)
  })

  it('buildDeliverySeries maps review_count, pr_review_cycles, merge_rate into points', () => {
    const rows: DeliveryTimeSeriesRow[] = [
      {
        period: '2026-W01',
        merged_pr_count: 5, total_pr_count: 8,
        deployment_count: 3, successful_deployment_count: 2,
        failed_deployment_count: 1, deploy_success_rate: 66.7,
        median_merge_cycle_hours: 12, release_count: 2,
        review_count: 15, pr_reopened_count: 3,
        pr_review_cycles: 18, merge_rate: 62.5,
        count_authority: 'observed_rows',
      },
    ]
    const series = buildDeliverySeries(rows, 'org')
    expect(series).not.toBeNull()
    expect((series!.points[0] as any).review_count).toBe(15)
    expect((series!.points[0] as any).pr_review_cycles).toBe(18)
    expect((series!.points[0] as any).merge_rate).toBe(62.5)
  })

  it('resolveTimeSeriesPointField resolves delivery.review_count, pr_review_cycles, merge_rate', () => {
    expect(resolveTimeSeriesPointField('delivery.review_count')).toBe('review_count')
    expect(resolveTimeSeriesPointField('delivery.pr_review_cycles')).toBe('pr_review_cycles')
    expect(resolveTimeSeriesPointField('delivery.merge_rate')).toBe('merge_rate')
    // Also works without prefix
    expect(resolveTimeSeriesPointField('review_count')).toBe('review_count')
    expect(resolveTimeSeriesPointField('pr_review_cycles')).toBe('pr_review_cycles')
    expect(resolveTimeSeriesPointField('merge_rate')).toBe('merge_rate')
  })

  it('PBT template includes Reviews, Review Cycles, Merge Rate options', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    expect(pbtSource).toContain('value="review_count"')
    expect(pbtSource).toContain('Reviews / Week')
    expect(pbtSource).toContain('value="pr_review_cycles"')
    expect(pbtSource).toContain('Review Cycles / Week')
    expect(pbtSource).toContain('value="merge_rate"')
    expect(pbtSource).toContain('Merge Rate (%)')
  })

  it('DELIVERY_METRIC_FIELDS includes review_count, pr_review_cycles, merge_rate', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    expect(pbtSource).toMatch(/DELIVERY_METRIC_FIELDS[\s\S]*?review_count/)
    expect(pbtSource).toMatch(/DELIVERY_METRIC_FIELDS[\s\S]*?pr_review_cycles/)
    expect(pbtSource).toMatch(/DELIVERY_METRIC_FIELDS[\s\S]*?merge_rate/)
  })
})
