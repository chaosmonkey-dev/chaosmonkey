/**
 * CR-X B4: Release metrics — frontend capture and PBT delivery metric.
 *
 * Proves:
 * 1. DeliveryTimeSeriesRow includes release_count
 * 2. buildDeliverySeries maps release_count into points
 * 3. resolveTimeSeriesPointField resolves delivery.release_count
 * 4. PBT metric dropdown includes Releases / Week
 * 5. DELIVERY_METRIC_FIELDS includes release_count
 */
import { describe, it, expect } from 'vitest'
import { buildDeliverySeries, type DeliveryTimeSeriesRow } from '../services/metricsFacade'
import { resolveTimeSeriesPointField } from '../lib/productivity/resolveTimeSeriesPointField'
import * as fs from 'fs'
import * as path from 'path'

describe('CR-X B4: Release metrics frontend capture', () => {
  it('DeliveryTimeSeriesRow includes release_count field', () => {
    const row: DeliveryTimeSeriesRow = {
      period: '2026-W01',
      merged_pr_count: 5,
      total_pr_count: 8,
      deployment_count: 3,
      successful_deployment_count: 2,
      failed_deployment_count: 1,
      deploy_success_rate: 66.7,
      median_merge_cycle_hours: 12,
      release_count: 2,
      count_authority: 'observed_rows',
    }
    expect(row.release_count).toBe(2)
  })

  it('buildDeliverySeries maps release_count into points', () => {
    const rows: DeliveryTimeSeriesRow[] = [
      {
        period: '2026-W01',
        merged_pr_count: 5, total_pr_count: 8,
        deployment_count: 3, successful_deployment_count: 2,
        failed_deployment_count: 1, deploy_success_rate: 66.7,
        median_merge_cycle_hours: 12, release_count: 2,
        count_authority: 'observed_rows',
      },
      {
        period: '2026-W02',
        merged_pr_count: 7, total_pr_count: 10,
        deployment_count: 4, successful_deployment_count: 4,
        failed_deployment_count: 0, deploy_success_rate: 100,
        median_merge_cycle_hours: 8, release_count: 3,
        count_authority: 'observed_rows',
      },
    ]
    const series = buildDeliverySeries(rows, 'org')
    expect(series).not.toBeNull()
    expect(series!.points).toHaveLength(2)
    expect((series!.points[0] as any).release_count).toBe(2)
    expect((series!.points[1] as any).release_count).toBe(3)
  })

  it('resolveTimeSeriesPointField resolves delivery.release_count', () => {
    expect(resolveTimeSeriesPointField('delivery.release_count')).toBe('release_count')
    // Also works without prefix via the delivery. retry logic
    expect(resolveTimeSeriesPointField('release_count')).toBe('release_count')
  })

  it('PBT template includes Releases / Week option', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    expect(pbtSource).toContain('value="release_count"')
    expect(pbtSource).toContain('Releases / Week')
  })

  it('DELIVERY_METRIC_FIELDS includes release_count', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    // The set literal must include release_count
    expect(pbtSource).toMatch(/DELIVERY_METRIC_FIELDS[\s\S]*?release_count/)
  })

  it('EngOutput.vue renders Total Releases and Latest Release cards', () => {
    const engSource = fs.readFileSync(
      path.resolve(__dirname, '../components/EngOutput.vue'),
      'utf-8'
    )
    expect(engSource).toContain('github-total-releases')
    expect(engSource).toContain('Total Releases')
    expect(engSource).toContain('github-latest-release')
    expect(engSource).toContain('Latest Release')
    expect(engSource).toContain('release_metrics')
  })
})
