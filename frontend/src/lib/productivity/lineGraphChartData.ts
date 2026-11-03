/**
 * Timestamp-aligned chart data builder for ProductivityLineGraph.
 *
 * Eliminates the previous positional-y bug where sparse workflows caused
 * `dataset.data.length < labels.length` and later y values were plotted
 * against earlier x labels.
 */

export interface LineGraphPoint {
  x: string
  y: number | null | undefined
}

export interface LineGraphSeries {
  label?: string
  data?: LineGraphPoint[]
  borderColor?: string
  backgroundColor?: string
}

export interface ProductivityLineGraphInput {
  lineGraphData: LineGraphSeries[]
  timeFilter: string
  selectedMetric: string
  comparisonMode: string
  getDimensionalLabel?: (label: string, comparisonMode: string) => string
  /**
   * Canonical bucket granularity ('day' | 'week') from the telemetry
   * response metadata. When provided, the axis is expanded to include every
   * bucket position between the first and last observation so that
   * unobserved buckets render as gaps (null) rather than being bridged by
   * a continuous line. Missing ≠ zero — inserted positions carry null y.
   */
  bucketPeriod?: string
}

const DAY_MS = 86400000
// Safety bound: never synthesize more than this many axis positions.
const MAX_AXIS_BUCKETS = 400

/**
 * Expands an observed-timestamp axis to include every bucket position
 * between the first and last observation for day/week granularity.
 * Observed keys are preserved verbatim; inserted positions are null-gaps
 * (they never match any series' valuesByTs map). Returns the input
 * unchanged for unknown periods, degenerate spans, or oversized ranges.
 */
export function expandBucketAxis(timestamps: string[], bucketPeriod?: string): string[] {
  const strideMs = bucketPeriod === 'day' ? DAY_MS : bucketPeriod === 'week' ? 7 * DAY_MS : 0
  if (!strideMs || !Array.isArray(timestamps) || timestamps.length < 2) return timestamps
  const parsed = timestamps
    .map(ts => new Date(ts).getTime())
    .filter(ms => Number.isFinite(ms))
  if (parsed.length < 2) return timestamps
  const min = Math.min(...parsed)
  const max = Math.max(...parsed)
  const spanBuckets = Math.floor((max - min) / strideMs)
  if (spanBuckets <= 0 || spanBuckets > MAX_AXIS_BUCKETS) return timestamps
  const observedDays = new Set(parsed.map(ms => Math.floor(ms / DAY_MS)))
  const hasTimeComponent = timestamps.some(ts => ts.includes('T'))
  const out = new Set(timestamps)
  for (let ms = min; ms <= max; ms += strideMs) {
    if (observedDays.has(Math.floor(ms / DAY_MS))) continue
    const iso = new Date(ms).toISOString()
    out.add(hasTimeComponent ? iso : iso.slice(0, 10))
  }
  return Array.from(out).sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
}

export interface ProductivityLineGraphOutput {
  labels: string[]
  datasets: Array<Record<string, unknown>>
}

function defaultGetDimensionalLabel(label: string, _comparisonMode: string): string {
  return label
}

function isIDESeries(label: string): boolean {
  if (!label) return false
  const lower = label.toLowerCase()
  return lower.includes('cursor') ||
         lower.includes('windsurf') ||
         lower.includes('vscode') ||
         lower.includes('jetbrains')
}

function formatTimestamp(ts: string): string {
  if (!ts) return 'Unknown'
  try {
    const date = new Date(ts)
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC'
      })
    }
  } catch {
    // Date format error - use fallback
  }
  return ts.slice(0, 10)
}

export function buildProductivityLineGraphData({
  lineGraphData,
  timeFilter,
  selectedMetric,
  comparisonMode,
  getDimensionalLabel = defaultGetDimensionalLabel,
  bucketPeriod
}: ProductivityLineGraphInput): ProductivityLineGraphOutput {
  if (!lineGraphData || !Array.isArray(lineGraphData)) {
    return { labels: [], datasets: [] }
  }

  if (lineGraphData.length === 0) {
    return { labels: [], datasets: [] }
  }

  const isWeekView = timeFilter === 'week' || timeFilter === 'wow'
  const isTtfcMetric =
    selectedMetric === 'time_to_first_commit_minutes' ||
    selectedMetric === 'ide.time_to_first_commit_minutes'

  const allTimestamps = new Set<string>()
  lineGraphData.forEach(series => {
    if (series && series.data && Array.isArray(series.data)) {
      series.data.forEach(point => {
        if (point && typeof point.x === 'string') {
          allTimestamps.add(point.x)
        }
      })
    }
  })

  // Expand the axis to include unobserved bucket positions so missing
  // days/weeks render as gaps instead of a bridged continuous line.
  const sortedTimestamps = expandBucketAxis(Array.from(allTimestamps), bucketPeriod)
  if (isWeekView || isTtfcMetric || bucketPeriod) {
    sortedTimestamps.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
  } else {
    sortedTimestamps.sort()
  }

  const labels = sortedTimestamps.map(formatTimestamp).filter(label => label !== 'Unknown')

  const datasets = lineGraphData.map((series, index) => {
    if (!series || !Array.isArray(series.data)) {
      return null
    }

    const valuesByTs = new Map<string, number | null>()
    series.data.forEach(point => {
      if (point && typeof point.x === 'string') {
        valuesByTs.set(point.x, point.y ?? null)
      }
    })

    const data = sortedTimestamps.map(isoTs =>
      valuesByTs.has(isoTs) ? valuesByTs.get(isoTs) : null
    )

    const hasValidData = data.some(v => v != null && !Number.isNaN(v))
    const seriesIsIDE = isIDESeries(series.label || '')

    if (!hasValidData) {
      if (seriesIsIDE) {
        return {
          label: getDimensionalLabel(series.label || '', comparisonMode) || `Entity ${index + 1}`,
          data,
          borderColor: series.borderColor || `hsl(${(index * 60) % 360}, 70%, 50%)`,
          backgroundColor: series.backgroundColor || `hsla(${(index * 60) % 360}, 70%, 50%, 0.1)`,
          fill: false,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          spanGaps: false,
          isSimulated: true
        }
      }
      return null
    }

    return {
      label: getDimensionalLabel(series.label || '', comparisonMode) || `Entity ${index + 1}`,
      data,
      borderColor: series.borderColor || `hsl(${(index * 60) % 360}, 70%, 50%)`,
      backgroundColor: series.backgroundColor || `hsla(${(index * 60) % 360}, 70%, 50%, 0.1)`,
      fill: false,
      tension: 0.4,
      pointRadius: 4,
      pointHoverRadius: 6,
      spanGaps: false
    }
  }).filter((dataset): dataset is Record<string, unknown> => dataset !== null)

  if (datasets.length === 0) {
    return { labels: [], datasets: [] }
  }

  return { labels, datasets }
}
