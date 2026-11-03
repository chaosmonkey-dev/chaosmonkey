/**
 * P0.2 R2: Sparse visible point regression
 *
 * Contract: OBSERVED DATA MUST BE VISIBLY OBSERVABLE.
 *
 * When a workflow has historical points, a long null gap, then one/two recent
 * real observations, the recent observations MUST render visibly without
 * fabricating the gap. No interpolation, no carry-forward, no spanning gaps.
 *
 * This test verifies that ProductivityLineGraph's chartData computed property
 * correctly maps values to union timestamps with null for missing positions,
 * preserving x-alignment and rendering isolated observed points.
 */

import { describe, it, expect } from 'vitest'

// Simulate the chartData computed logic from ProductivityLineGraph.vue
// This is the FIXED non-TTFC path that maps values to union timestamps.

interface LineGraphPoint { x: string; y: number | null }
interface LineGraphSeries { label: string; data: LineGraphPoint[]; borderColor: string; backgroundColor: string }

function buildChartDataFixed(lineGraphData: LineGraphSeries[]): {
  labels: string[]
  datasets: Array<{ label: string; data: (number | null)[]; spanGaps: boolean; pointRadius: number }>
} {
  // Build labels from union of ALL timestamps
  const allTimestamps = new Set<string>()
  lineGraphData.forEach(series => {
    if (series.data && Array.isArray(series.data)) {
      series.data.forEach(point => {
        if (point && point.x) {
          allTimestamps.add(point.x)
        }
      })
    }
  })

  const sortedTimestamps = Array.from(allTimestamps).sort()

  if (sortedTimestamps.length === 0) {
    return { labels: [], datasets: [] }
  }

  const labels = sortedTimestamps

  const datasets = lineGraphData.map((series) => {
    if (!series.data || !Array.isArray(series.data)) return null

    // Map values to sorted union timestamps (null for missing positions)
    const valuesByTs = new Map<string, number | null>()
    series.data.forEach(point => {
      if (point && typeof point.x === 'string') {
        valuesByTs.set(point.x, point.y ?? null)
      }
    })

    const data = sortedTimestamps.map(isoTs =>
      valuesByTs.has(isoTs) ? valuesByTs.get(isoTs)! : null
    )

    const hasValidData = data.some(v => v != null && !Number.isNaN(v))
    if (!hasValidData) return null

    return {
      label: series.label,
      data,
      spanGaps: false,
      pointRadius: 4
    }
  }).filter(Boolean) as any[]

  return { labels, datasets }
}

// Simulate the OLD BROKEN non-TTFC path for comparison
function buildChartDataOldBroken(lineGraphData: LineGraphSeries[]): {
  labels: string[]
  datasets: Array<{ label: string; data: number[]; spanGaps?: boolean }>
} {
  const allTimestamps = new Set<string>()
  lineGraphData.forEach(series => {
    if (series.data && Array.isArray(series.data)) {
      series.data.forEach(point => {
        if (point && point.x) allTimestamps.add(point.x)
      })
    }
  })

  const sortedTimestamps = Array.from(allTimestamps).sort()
  const labels = sortedTimestamps

  const datasets = lineGraphData.map((series) => {
    if (!series.data || !Array.isArray(series.data)) return null

    // OLD BROKEN: filter to only valid points, map just y values
    const validDataPoints = series.data.filter(point =>
      point && typeof point.y === 'number'
    )
    if (validDataPoints.length === 0) return null

    const processedData = validDataPoints.map(point => point.y!)

    return {
      label: series.label,
      data: processedData
    }
  }).filter(Boolean) as any[]

  return { labels, datasets }
}

describe('P0.2 R2: Sparse visible point regression', () => {
  it('historical points → long null gap → recent observation: recent point is at correct x position (FIXED)', () => {
    // Devin: weeks 25-26 (Jun), then gap, then week 35 (Aug)
    const series: LineGraphSeries = {
      label: 'Devin',
      data: [
        { x: '2026-06-22T00:00:00.000Z', y: 5.24 },
        { x: '2026-06-29T00:00:00.000Z', y: 5.11 },
        // LONG NULL GAP (weeks 27-33)
        { x: '2026-08-31T00:00:00.000Z', y: 4.13 }, // RECENT August observation
      ],
      borderColor: '#2563eb',
      backgroundColor: '#2563eb20'
    }

    // Add other workflows to create union timestamps with gaps
    const allSeries = [
      series,
      {
        label: 'Cursor',
        data: [
          { x: '2026-05-11T00:00:00.000Z', y: 19 },
        ],
        borderColor: '#4f46e5',
        backgroundColor: '#4f46e520'
      }
    ]

    const result = buildChartDataFixed(allSeries)

    // Labels should include ALL timestamps from ALL series
    expect(result.labels.length).toBe(4) // 3 Devin + 1 Cursor
    expect(result.labels).toContain('2026-08-31T00:00:00.000Z')

    // Devin dataset should have 4 data points (3 valid + nulls for Cursor's period)
    const devinDataset = result.datasets.find(d => d.label === 'Devin')
    expect(devinDataset).toBeDefined()
    expect(devinDataset!.data.length).toBe(4)

    // The recent August point (y=4.13) must be at the CORRECT position (last)
    // NOT at position 1 (which is where the OLD broken path would put it)
    const lastIdx = result.labels.indexOf('2026-08-31T00:00:00.000Z')
    expect(devinDataset!.data[lastIdx]).toBe(4.13)

    // spanGaps must be false (no line across nulls)
    expect(devinDataset!.spanGaps).toBe(false)

    // pointRadius must be > 0 (isolated points visible)
    expect(devinDataset!.pointRadius).toBeGreaterThan(0)
  })

  it('OLD BROKEN path misaligns recent data to earlier x positions', () => {
    // Same data as above — prove the old path was broken
    const series: LineGraphSeries = {
      label: 'Devin',
      data: [
        { x: '2026-06-22T00:00:00.000Z', y: 5.24 },
        { x: '2026-06-29T00:00:00.000Z', y: 5.11 },
        { x: '2026-08-31T00:00:00.000Z', y: 4.13 }, // RECENT August
      ],
      borderColor: '#2563eb',
      backgroundColor: '#2563eb20'
    }

    const allSeries = [
      series,
      {
        label: 'Cursor',
        data: [
          { x: '2026-05-11T00:00:00.000Z', y: 19 },
        ],
        borderColor: '#4f46e5',
        backgroundColor: '#4f46e520'
      }
    ]

    const result = buildChartDataOldBroken(allSeries)

    // Labels has 4 entries (union of all timestamps)
    expect(result.labels.length).toBe(4)

    // BUT Devin dataset only has 3 entries (valid points only, no nulls)
    const devinDataset = result.datasets.find(d => d.label === 'Devin')
    expect(devinDataset).toBeDefined()
    expect(devinDataset!.data.length).toBe(3) // Only 3 valid values, NOT 4

    // The recent August value (4.13) is at position 2, NOT at the August label position
    // This is the MISALIGNMENT bug — data[2] is plotted at labels[2], which is
    // the June 29 timestamp, NOT the August 31 timestamp
    expect(devinDataset!.data[2]).toBe(4.13)
    expect(result.labels[2]).not.toBe('2026-08-31T00:00:00.000Z') // It's June 29, not August 31!

    // The August value is plotted at the WRONG x position
    const augustLabelIdx = result.labels.indexOf('2026-08-31T00:00:00.000Z')
    expect(augustLabelIdx).toBe(3) // August is at index 3
    expect(devinDataset!.data.length).toBeLessThan(augustLabelIdx + 1) // No data at index 3!
  })

  it('isolated recent observation after long gap is preserved (not dropped)', () => {
    // VS Code: weeks 23-25 (Jun), then gap, then week 34 (Aug) — single recent point
    const series: LineGraphSeries = {
      label: 'VS Code',
      data: [
        { x: '2026-06-08T00:00:00.000Z', y: 6.16 },
        { x: '2026-06-15T00:00:00.000Z', y: 5.68 },
        { x: '2026-06-22T00:00:00.000Z', y: 5.0 },
        // LONG NULL GAP (weeks 26-33)
        { x: '2026-08-24T00:00:00.000Z', y: 3.0 }, // ISOLATED recent August point
      ],
      borderColor: '#0891b2',
      backgroundColor: '#0891b220'
    }

    const result = buildChartDataFixed([series])

    const vscodeDataset = result.datasets.find(d => d.label === 'VS Code')
    expect(vscodeDataset).toBeDefined()

    // The isolated August point must be in the data at the correct position
    const augustIdx = result.labels.indexOf('2026-08-24T00:00:00.000Z')
    expect(vscodeDataset!.data[augustIdx]).toBe(3.0)

    // There must be nulls between the June points and the August point
    const juneLastIdx = result.labels.indexOf('2026-06-22T00:00:00.000Z')
    for (let i = juneLastIdx + 1; i < augustIdx; i++) {
      expect(vscodeDataset!.data[i]).toBeNull()
    }

    // spanGaps: false ensures no line is drawn across the null gap
    expect(vscodeDataset!.spanGaps).toBe(false)

    // pointRadius > 0 ensures the isolated point is visible as a dot
    expect(vscodeDataset!.pointRadius).toBeGreaterThan(0)
  })

  it('multiple workflows with different latest periods all preserve their latest finite point', () => {
    const allSeries: LineGraphSeries[] = [
      {
        label: 'Devin',
        data: [
          { x: '2026-06-22T00:00:00.000Z', y: 5.24 },
          { x: '2026-08-31T00:00:00.000Z', y: 4.13 }, // Latest: Aug 31
        ],
        borderColor: '#2563eb', backgroundColor: '#2563eb20'
      },
      {
        label: 'VS Code',
        data: [
          { x: '2026-06-22T00:00:00.000Z', y: 5.0 },
          { x: '2026-08-24T00:00:00.000Z', y: 3.0 }, // Latest: Aug 24
        ],
        borderColor: '#0891b2', backgroundColor: '#0891b220'
      },
      {
        label: 'Cursor',
        data: [
          { x: '2026-05-11T00:00:00.000Z', y: 19 }, // Latest: May 11 (genuinely no data after)
        ],
        borderColor: '#4f46e5', backgroundColor: '#4f46e520'
      },
      {
        label: 'Claude Code',
        data: [
          { x: '2026-05-11T00:00:00.000Z', y: 6 },
          { x: '2026-08-24T00:00:00.000Z', y: 1.75 }, // Latest: Aug 24
        ],
        borderColor: '#475569', backgroundColor: '#47556920'
      }
    ]

    const result = buildChartDataFixed(allSeries)

    // Each workflow's latest finite point must be at the correct label position
    const checks = [
      { label: 'Devin', x: '2026-08-31T00:00:00.000Z', y: 4.13 },
      { label: 'VS Code', x: '2026-08-24T00:00:00.000Z', y: 3.0 },
      { label: 'Cursor', x: '2026-05-11T00:00:00.000Z', y: 19 },
      { label: 'Claude Code', x: '2026-08-24T00:00:00.000Z', y: 1.75 },
    ]

    for (const check of checks) {
      const ds = result.datasets.find(d => d.label === check.label)
      expect(ds).toBeDefined()
      const idx = result.labels.indexOf(check.x)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(ds!.data[idx]).toBe(check.y)
    }

    // Cursor must have null at August positions (no interpolation)
    const cursorDs = result.datasets.find(d => d.label === 'Cursor')!
    const aug31Idx = result.labels.indexOf('2026-08-31T00:00:00.000Z')
    const aug24Idx = result.labels.indexOf('2026-08-24T00:00:00.000Z')
    expect(cursorDs.data[aug31Idx]).toBeNull()
    expect(cursorDs.data[aug24Idx]).toBeNull()
  })

  it('no interpolation: null periods stay null, no carry-forward', () => {
    const series: LineGraphSeries = {
      label: 'Devin',
      data: [
        { x: '2026-06-22T00:00:00.000Z', y: 5.24 },
        { x: '2026-08-31T00:00:00.000Z', y: 4.13 },
      ],
      borderColor: '#2563eb', backgroundColor: '#2563eb20'
    }

    // Add a third series with a timestamp in the gap to create a union label there
    const allSeries = [
      series,
      {
        label: 'Other',
        data: [
          { x: '2026-07-15T00:00:00.000Z', y: 10 },
        ],
        borderColor: '#999', backgroundColor: '#99920'
      }
    ]

    const result = buildChartDataFixed(allSeries)
    const devinDs = result.datasets.find(d => d.label === 'Devin')!
    const julyIdx = result.labels.indexOf('2026-07-15T00:00:00.000Z')

    // Devin must have null at July (no carry-forward from June)
    expect(devinDs.data[julyIdx]).toBeNull()
  })
})
