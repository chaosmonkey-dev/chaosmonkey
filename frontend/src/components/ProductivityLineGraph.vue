<template>
  <div class="productivity-line-graph">
    <div class="cicd-section card stage-time-series">
      <div class="card-body">
        <!-- Section Header -->
        <div v-if="!hideHeader" class="cicd-section-header d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-2" style="padding-bottom: 0.25rem; margin-bottom: 0.5rem;">
          <div class="d-flex align-items-center">
            <div class="stage-icon-wrapper me-2 bg-info" style="width: 40px; height: 40px; border-radius: 10px; font-size: 1.1rem;">
              <i class="bi bi-graph-up-arrow text-white"></i>
            </div>
            <div>
              <h5 class="mb-0 fw-bold text-dark" style="font-size: 0.95rem; margin-bottom: 0.125rem; letter-spacing: -0.01em;">
                {{ isDeveloperSeries
                  ? `${scopeLabel} — Developer Performance Over Time`
                  : selectedIDE === 'all'
                    ? (isDeliveryMetric
                      ? 'Delivery Performance Analysis'
                      : `${comparisonMode === 'workflows' ? 'AI Workflow' : comparisonMode === 'ides' ? 'IDE' : 'AI Model'} Performance Analysis`)
                    : `${selectedIDE.charAt(0).toUpperCase() + selectedIDE.slice(1)} Performance Trends`
                }}
              </h5>
              <small class="text-muted fw-medium" style="font-size: 0.7rem; letter-spacing: 0.01em;">
                {{ isDeveloperSeries
                  ? `${getMetricLabel(selectedMetric)} over time across authoritative developers`
                  : selectedIDE === 'all'
                    ? (isDeliveryMetric
                      ? `${getMetricLabel(selectedMetric)} over time — org-level delivery evidence`
                      : `${getMetricLabel(selectedMetric)} over time across ${comparisonMode === 'workflows' ? 'AI workflows' : comparisonMode === 'ides' ? 'development tools' : 'AI models'}`)
                    : `Performance trends across different productivity dimensions`
                }}
              </small>
            </div>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span class="badge bg-info-subtle text-info" style="font-size: 0.6rem; padding: 0.15rem 0.375rem; border-radius: 0.25rem; font-weight: 600; letter-spacing: 0.05em;">
              {{ chartData?.datasets?.length || 0 }} {{ isDeveloperSeries ? 'developers' : isDeliveryMetric ? 'series' : comparisonMode === 'workflows' ? 'workflows' : comparisonMode === 'ides' ? 'IDEs' : 'models' }}
            </span>
            <span class="badge bg-secondary-subtle text-secondary" style="font-size: 0.6rem; padding: 0.15rem 0.375rem; border-radius: 0.25rem; font-weight: 600; letter-spacing: 0.05em;">
              {{ chartData?.labels?.length || 0 }} data points
            </span>
          </div>
        </div>
        
        <!-- Compact Cost Strip (inside graph card) -->
        <div v-if="costOverlay?.enabled" class="chart-cost-strip">
          <div class="cost-strip-header">
            <span class="cost-strip-label">{{ costOverlay.label }}</span>
            <span class="cost-strip-desc">{{ costOverlay.description }}</span>
          </div>
          <div class="cost-strip-pills">
            <div 
              v-for="item in costOverlay.values" 
              :key="item.label" 
              class="cost-strip-pill"
              :class="{ 'cost-strip-pill--no-cost': !item.hasCost }"
            >
              <span class="cost-pill-dot"></span>
              <span class="cost-pill-name">{{ item.label }}</span>
              <span class="cost-pill-value">{{ item.value }}</span>
            </div>
          </div>
        </div>
        
        <!-- Chart Area -->
        <div class="chart-wrapper" style="background: white; border-radius: 0.5rem; border: 1px solid #e9ecef; overflow: hidden;">
          <div v-if="!hasValidData" class="empty-state text-center py-4" style="padding: 2rem 1rem;">
            <div class="empty-state-icon mb-2">
              <i class="bi bi-graph-down text-muted" style="font-size: 2rem;"></i>
            </div>
            <h6 class="text-muted mb-1" style="font-size: 0.875rem;">No Trend Data Available</h6>
            <p class="text-muted small mb-2" style="font-size: 0.75rem;">Showing available data from compatible metrics</p>
            <small class="text-muted" style="font-size: 0.7rem;">
              <i class="bi bi-info-circle me-1"></i>
              Try selecting "All Metrics" or adjusting time range
            </small>
          </div>
          <div v-else class="chart-container" style="padding: 0.75rem;">
            <canvas ref="chartCanvas"></canvas>
          </div>
        </div>
        
        <!-- Chart Legend Enhancement (optional) -->
        <div v-if="hasValidData && chartData?.datasets?.length > 1" class="chart-legend-info mt-2 pt-2 border-top" style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid #e9ecef;">
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <small class="text-muted" style="font-size: 0.7rem;">
              <i class="bi bi-info-circle me-1"></i>
              Comparing <strong>{{ chartData.datasets.length }}</strong> {{ isDeveloperSeries ? 'developers' : comparisonMode === 'workflows' ? 'AI workflows' : comparisonMode === 'ides' ? 'development tools' : 'AI models' }} across <strong>{{ chartData.labels.length }}</strong> time periods
            </small>
            <div class="simulated-indicator" v-if="hasSimulatedData">
              <small class="text-warning" style="font-size: 0.7rem;">
                <i class="bi bi-exclamation-triangle me-1"></i>
                Some IDEs showing simulated data
              </small>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Chart } from 'chart.js/auto'
import { buildProductivityLineGraphData, expandBucketAxis } from '@/lib/productivity/lineGraphChartData'

// 🔥 P1: Gate noisy PBT logs behind debug flag
const PBT_DEBUG = (import.meta.env.VITE_PBT_DEBUG ?? 'false') === 'true'

// Helper function to get metric labels
const getMetricLabel = (metric) => {
  const labels = {
    'ide.ai_suggestions_accepted': 'AI Suggestions Accepted',
    'ide.files_edited_per_session': 'Files Edited / Session',
    'ide.commits_per_session': 'Commits / Session',
    'ide.average_session_length_minutes': 'Session Length',
    'ide.time_to_first_commit_minutes': 'Time to First Commit',
    'ide.AI_usage_duration_minutes': 'AI Usage Duration',
    'ide.active_coding_time_minutes': 'Active Coding Time',
    'ide.idle_time_minutes': 'Idle Time',
    'ide.active_coding_ratio': 'Active Coding Ratio',
    'ide.ai_usage_ratio': 'AI Usage Ratio',
    'ide.idle_ratio': 'Idle Ratio',
    // Legacy metric names (without ide. prefix)
    'AI_suggestions_accepted': 'AI Suggestions Accepted',
    'files_edited_per_session': 'Files Edited / Session',
    'commits_per_session': 'Commits / Session',
    'average_session_length_minutes': 'Session Length',
    'time_to_first_commit_minutes': 'Time to First Commit',
    'AI_usage_duration_minutes': 'AI Usage Duration',
    'active_coding_time_minutes': 'Active Coding Time',
    'idle_time_minutes': 'Idle Time',
    'active_coding_ratio': 'Active Coding Ratio',
    'ai_usage_ratio': 'AI Usage Ratio',
    'idle_ratio': 'Idle Ratio',
    // Other metrics
    'commits': 'Commits',
    'prs_merged': 'PRs Merged',
    'review_comments': 'Review Comments'
  }
  return labels[metric] || 'Value'
}

// Helper function to get labels based on comparison mode (ENFORCES SINGLE DIMENSION)
const getDimensionalLabel = (entityLabel, comparisonMode) => {
  // Normalize input to lowercase for lookup
  const normalizedLabel = entityLabel?.toLowerCase()?.trim() || ''
  
  if (comparisonMode === 'workflows') {
    // Workflows mode: Show IDE + Model combinations
    const workflowMap = {
      'cursor': 'Cursor',
      'windsurf': 'Windsurf',
      'vscode': 'VS Code',
      'claude_code': 'Claude Code',
      'codex': 'Codex',
      'github_copilot': 'GitHub Copilot',
      'jetbrains': 'JetBrains',
      'sublime': 'Sublime',
      'vim': 'Vim'
    }
    return workflowMap[normalizedLabel] || entityLabel
  } else if (comparisonMode === 'ides') {
    // IDEs mode: Show only IDE names
    const ideMap = {
      'cursor': 'Cursor',
      'windsurf': 'Windsurf',
      'vscode': 'VS Code',
      'claude_code': 'Claude Code',
      'codex': 'Codex',
      'github_copilot': 'GitHub Copilot',
      'jetbrains': 'JetBrains',
      'sublime': 'Sublime',
      'vim': 'Vim'
    }
    return ideMap[normalizedLabel] || entityLabel
  } else if (comparisonMode === 'models') {
    // Models mode: Show IDE names instead of model names (extension doesn't capture active model)
    const modelMap = {
      'sonnet': 'Cursor',
      'swe': 'Windsurf',
      'gpt4o': 'VS Code',
      'gpt': 'VS Code',
      'claude': 'Cursor',
      'claude_code': 'Claude Code',
      'codex': 'Codex',
      'opus': 'JetBrains',
      'gemini': 'Sublime',
      'composer': 'Vim',
      'cursor': 'Cursor',
      'windsurf': 'Windsurf',
      'vscode': 'VS Code',
      'github_copilot': 'GitHub Copilot',
      'jetbrains': 'JetBrains',
      'sublime': 'Sublime',
      'vim': 'Vim'
    }
    return modelMap[normalizedLabel] || entityLabel
  }
  
  return entityLabel
}

// Props
const props = defineProps({
  ideMetricCards: {
    type: Array,
    default: () => []
  },
  lineGraphData: {
    type: Array,
    default: () => []
  },
  selectedMetric: {
    type: String,
    default: 'AI_suggestions_accepted'
  },
  selectedIDE: {
    type: String,
    default: 'all'
  },
  timeFilter: {
    type: String,
    default: 'week'
  },
  comparisonMode: {
    type: String,
    default: 'workflows'
  },
  comparisonEntities: {
    type: Array,
    default: () => []
  },
  seriesDimension: {
    type: String,
    default: 'workflow'
  },
  scopeLabel: {
    type: String,
    default: ''
  },
  hideHeader: {
    type: Boolean,
    default: false
  },
  costOverlay: {
    type: Object,
    default: null
  },
  // CR-X 3D.4: When true, the chart is rendering org-level (or repo-level)
  // delivery evidence — a single series, not a workflow comparison. The
  // title and count label must reflect "Delivery" semantics, not "AI Workflow".
  isDeliveryMetric: {
    type: Boolean,
    default: false
  },
  // Canonical telemetry bucket granularity ('day' | 'week'). When set, the
  // axis includes every bucket position between first and last observation
  // so missing buckets render as gaps (spanGaps:false), not bridged lines.
  bucketPeriod: {
    type: String,
    default: ''
  }
})

const isDeveloperSeries = computed(() => props.seriesDimension === 'developer')

// Chart canvas reference
const chartCanvas = ref(null)
let chartInstance = null

// Check if we have valid data to display
const hasValidData = computed(() => {
  return props.lineGraphData && 
         Array.isArray(props.lineGraphData) && 
         props.lineGraphData.length > 0 &&
         props.lineGraphData.some(series => series && Array.isArray(series.data) && series.data.length > 0)
})

// Check if any datasets have simulated data
const hasSimulatedData = computed(() => {
  return props.lineGraphData && 
         Array.isArray(props.lineGraphData) && 
         props.lineGraphData.some(series => {
           const label = series.label || '';
           const isIDESeries = label.toLowerCase().includes('cursor') || 
                              label.toLowerCase().includes('windsurf') || 
                              label.toLowerCase().includes('vscode') ||
                              label.toLowerCase().includes('jetbrains');
           const hasNoData = !series.data || 
                            !Array.isArray(series.data) || 
                            series.data.length === 0 ||
                            !series.data.some(point => point && typeof point.y === 'number');
           return isIDESeries && hasNoData;
         });
})

// 🔥 FIX: Check if we have multiple data points for beginAtZero logic
const hasMultipleDataPoints = computed(() => {
  return props.lineGraphData && 
         Array.isArray(props.lineGraphData) && 
         props.lineGraphData.some(series => series && series.data && Array.isArray(series.data) && series.data.length > 1)
})

// Transform data for Chart.js
const chartData = computed(() => {
  // 🔥 AUDIT: Log period counts at chart component level
  if (props.lineGraphData && Array.isArray(props.lineGraphData)) {
    const periodsByTool = new Map()
    const allTimestamps = new Set()
    props.lineGraphData.forEach((series) => {
      if (series && series.data && Array.isArray(series.data)) {
        periodsByTool.set(series.label, series.data.length)
        series.data.forEach(point => {
          if (point && point.x) {
            allTimestamps.add(point.x)
          }
        })
      }
    })
    if (PBT_DEBUG) console.log('[AUDIT:PRODUCTIVITY_LINE_GRAPH_INPUT]', {
      seriesCount: props.lineGraphData.length,
      periodsByTool: Object.fromEntries(periodsByTool),
      totalPeriods: Array.from(periodsByTool.values()).reduce((sum, count) => sum + count, 0),
      uniqueTimestampsCount: allTimestamps.size,
      uniqueTimestamps: Array.from(allTimestamps).sort(),
      selectedMetric: props.selectedMetric,
      timeFilter: props.timeFilter,
      isWeekView: props.timeFilter === 'week' || props.timeFilter === 'wow',
      isTtfcMetric: props.selectedMetric === 'time_to_first_commit_minutes' || props.selectedMetric === 'ide.time_to_first_commit_minutes'
    })
  }
  
  if (!props.lineGraphData || !Array.isArray(props.lineGraphData)) {
    return { labels: [], datasets: [] }
  }
  
  if (props.lineGraphData.length === 0) {
    return { labels: [], datasets: [] }
  }
  
  // CRITICAL: For ALL metrics in week view, build labels from union of timestamps
  // This ensures alignment even when some series have different point counts
  const isWeekView = props.timeFilter === 'week' || props.timeFilter === 'wow'
  const isTtfcMetric = props.selectedMetric === 'time_to_first_commit_minutes' || 
                        props.selectedMetric === 'ide.time_to_first_commit_minutes';
  
  let labels = []
  let datasets = []
  
  // CRITICAL FIX: Use union of timestamps for week view (not just TTFC)
  // This prevents misalignment when telemetry has different date coverage than simulation
  // 🔥 FIX: Also use union for non-TTFC metrics to preserve all historical periods
  // RATIONALE: Union timestamps ensure all historical periods are preserved across all metrics,
  // preventing data collapse when some workflows have sparse data in certain periods.
  // This is intentional for Productivity V3 to show complete historical context.
  if (isWeekView || isTtfcMetric) {
    // Build labels from union of all timestamps across all series
    // 1. Collect unique timestamps across all series
    const allTimestamps = new Set()
    
    props.lineGraphData.forEach(series => {
      series.data?.forEach(point => {
        if (point && typeof point.x === 'string') {
          allTimestamps.add(point.x)
        }
      })
    })
    
    // CRITICAL: Sort ISO timestamps chronologically (not alphabetically)
    // Include unobserved bucket positions so missing days/weeks render as
    // gaps (spanGaps:false) rather than a line bridging unobserved dates.
    const sortedIsoTimestamps = expandBucketAxis(Array.from(allTimestamps), props.bucketPeriod || undefined)
    
    // Format ISO timestamps for Chart.js display labels
    // CRITICAL: Use UTC timezone to prevent off-by-one date errors
    const formattedLabels = sortedIsoTimestamps.map(isoTs => {
      try {
        const date = new Date(isoTs)
        if (!isNaN(date.getTime())) {
          // CRITICAL FIX: Add timeZone: 'UTC' to prevent local timezone conversion
          // Without this, "2025-12-02T00:00:00.000Z" in PST becomes "Dec 1" instead of "Dec 2"
          if (props.timeFilter === 'week' || props.timeFilter === 'wow') {
            return date.toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric',
              timeZone: 'UTC'  // ← CRITICAL: Force UTC timezone
            })
          } else if (props.timeFilter === 'month' || props.timeFilter === 'mom') {
            return date.toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric',
              timeZone: 'UTC'
            })
          } else {
            return date.toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric',
              timeZone: 'UTC'
            })
          }
        }
      } catch (e) {
        // Date format error - use fallback
      }
      return isoTs.slice(0, 10) // Fallback to YYYY-MM-DD
    })
    
    labels = formattedLabels
    
    // 🔥 AUDIT: Log union timestamp path results
    if (PBT_DEBUG) console.log('[AUDIT:UNION_TIMESTAMP_PATH]', {
      isWeekView,
      isTtfcMetric,
      uniqueTimestampsCount: sortedIsoTimestamps.length,
      labelsCount: formattedLabels.length,
      labels: formattedLabels
    })
    
    // 2. For each series, map its values into these sorted ISO timestamps
    datasets = props.lineGraphData.map((series, index) => {
      if (!series || !Array.isArray(series.data)) {
        return null
      }
      
      const valuesByTs = new Map()
      
      series.data?.forEach(point => {
        if (point && typeof point.x === 'string') {
          // point.x is now ISO timestamp (not formatted string)
          valuesByTs.set(point.x, point.y ?? null)
        }
      })
      
      // Map values to the sorted ISO timestamps (in chronological order)
      const data = sortedIsoTimestamps.map(isoTs => 
        valuesByTs.has(isoTs) ? valuesByTs.get(isoTs) : null
      )
      
      // Check if we have any valid data (non-null values)
      const hasValidData = data.some(v => v != null && !Number.isNaN(v))
      if (!hasValidData) {
        // IMPORTANT: Don't return null for simulated data - keep the series even if all null
        // This prevents IDEs from dropping off when they have simulated data
        if (series.label && (series.label.toLowerCase().includes('cursor') || 
                           series.label.toLowerCase().includes('windsurf') || 
                           series.label.toLowerCase().includes('vscode') ||
                           series.label.toLowerCase().includes('jetbrains'))) {
          // Return the series with null data instead of filtering it out
          return {
            label: getDimensionalLabel(series.label, props.comparisonMode) || `Entity ${index + 1}`,
            data,
            borderColor: series.borderColor || `hsl(${(index * 60) % 360}, 70%, 50%)`,
            backgroundColor: series.backgroundColor || `hsla(${(index * 60) % 360}, 70%, 50%, 0.1)`,
            fill: false,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 6,
            spanGaps: false,
            // Mark as simulated data for special handling
            isSimulated: true
          }
        }
        return null
      }
      
      return {
        label: getDimensionalLabel(series.label, props.comparisonMode) || `Entity ${index + 1}`,
        data,
        borderColor: series.borderColor || `hsl(${(index * 60) % 360}, 70%, 50%)`,
        backgroundColor: series.backgroundColor || `hsla(${(index * 60) % 360}, 70%, 50%, 0.1)`,
        fill: false,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
        // CRITICAL: For Chart.js to handle nulls as gaps, set spanGaps: false
        spanGaps: false
      }
    }).filter(Boolean) // Remove null datasets
  } else {
    const result = buildProductivityLineGraphData({
      lineGraphData: props.lineGraphData,
      timeFilter: props.timeFilter,
      selectedMetric: props.selectedMetric,
      comparisonMode: props.comparisonMode,
      getDimensionalLabel,
      bucketPeriod: props.bucketPeriod || undefined,
    })
    labels = result.labels
    datasets = result.datasets
  }
  
  if (datasets.length === 0) {
    return { labels: [], datasets: [] }
  }
  
  return { labels, datasets }
})

// Update chart function with better error handling
const updateChart = () => {
  if (!chartCanvas.value) {
    return
  }
  
  // Validate chart data before creating chart
  const data = chartData.value
  
  if (!data || !data.labels || !data.datasets || 
      data.labels.length === 0 || data.datasets.length === 0) {
    return
  }
  
  // Safely destroy existing chart if it exists
  if (chartInstance) {
    try {
      chartInstance.destroy()
      chartInstance = null
    } catch (error) {
      chartInstance = null
    }
  }
  
  // Get the chart context
  const ctx = chartCanvas.value.getContext('2d')
  if (!ctx) {
    return
  }
  
  // Create new chart with error handling
  try {
    
    // Enterprise color palette - calm, muted, operational with enhanced contrast
    const modernColors = [
      { border: '#2563eb', bg: 'rgba(37, 99, 235, 0.1)' },  // Blue (darker for better contrast)
      { border: '#4f46e5', bg: 'rgba(79, 70, 229, 0.1)' },  // Indigo (darker for better contrast)
      { border: '#0891b2', bg: 'rgba(8, 145, 178, 0.1)' },   // Sky (darker for better contrast)
      { border: '#475569', bg: 'rgba(71, 85, 105, 0.1)' },  // Slate (darker for better contrast)
      { border: '#5c5247', bg: 'rgba(92, 82, 71, 0.1)' },   // Stone (darker for better contrast)
      { border: '#44403c', bg: 'rgba(68, 64, 60, 0.1)' }    // Warm Gray (darker for better contrast)
    ];

    // Apply modern colors to datasets with special handling for simulated data
    const styledDatasets = data.datasets.map((dataset, index) => {
      const color = modernColors[index % modernColors.length];
      const isSimulated = dataset.isSimulated || 
                        (dataset.data && dataset.data.length === 0 && 
                         dataset.label && 
                         (dataset.label.toLowerCase().includes('cursor') || 
                          dataset.label.toLowerCase().includes('windsurf') || 
                          dataset.label.toLowerCase().includes('vscode') ||
                          dataset.label.toLowerCase().includes('jetbrains')))
      
      const baseConfig = {
        ...dataset,
        borderColor: color.border,
        backgroundColor: color.bg,
        borderWidth: index === 0 ? 2.8 : 2.0, // Enhanced line distinction
        pointBackgroundColor: color.border,
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2.5, // Thicker point borders for better visibility
        pointHoverBackgroundColor: color.border,
        pointHoverBorderColor: '#ffffff',
        pointHoverBorderWidth: 2.5,
        tension: 0.25, // Slightly smoother curves for better visual flow
        fill: false,
        borderDash: isSimulated ? [5, 5] : [], // Clearer dashed pattern for simulated data
        pointRadius: index === 0 ? 4.0 : 3.0, // Larger points for better visibility
        pointHoverRadius: 6, // Larger hover radius for easier interaction
        opacity: isSimulated ? 0.6 : (index === 0 ? 1 : 0.85) // Enhanced hierarchy
      };
      
      // For simulated data with no real data points, add placeholder data to prevent line from disappearing
      if (isSimulated && (!dataset.data || dataset.data.length === 0)) {
        baseConfig.data = data.labels.map(() => null); // Null data points maintain the line but show gaps
      }
      
      return baseConfig;
    });

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        ...data,
        datasets: styledDatasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 750,
          easing: 'easeInOutQuart'
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              usePointStyle: true,
              padding: 20,
              font: {
                size: 10,
                weight: '500',
                family: 'system-ui, -apple-system, sans-serif'
              },
              boxWidth: 8,
              boxHeight: 8,
              pointStyle: 'circle',
              generateLabels: function(chart) {
                // Deduplicate labels to prevent duplicates in legend
                const seenLabels = new Set()
                return data.datasets.map((dataset, index) => {
                  const color = modernColors[index % modernColors.length];
                  const isSimulated = dataset.isSimulated ||
                                    (dataset.data && dataset.data.length === 0 &&
                                     dataset.label &&
                                     (dataset.label.toLowerCase().includes('cursor') ||
                                      dataset.label.toLowerCase().includes('windsurf') ||
                                      dataset.label.toLowerCase().includes('vscode') ||
                                      dataset.label.toLowerCase().includes('jetbrains')));

                  // Skip duplicate labels
                  if (seenLabels.has(dataset.label)) {
                    return null
                  }
                  seenLabels.add(dataset.label)

                  return {
                    text: dataset.label + (isSimulated ? ' (baseline)' : ''),
                    fillStyle: color.border,
                    strokeStyle: color.border,
                    lineWidth: isSimulated ? 2 : 0,
                    lineDash: isSimulated ? [5, 5] : [],
                    pointStyle: 'circle',
                    hidden: false,
                    index: index,
                    font: {
                      style: isSimulated ? 'italic' : 'normal',
                      weight: index === 0 ? '600' : '500' // Emphasize dominant workflow
                    }
                  };
                }).filter(Boolean);
              }
            },
            title: { display: false },
            tooltip: {
              enabled: true,
              mode: 'index',
              intersect: false,
              backgroundColor: 'rgba(15, 23, 42, 0.96)',
              titleColor: '#f8fafc',
              bodyColor: '#e2e8f0',
              borderColor: 'rgba(148, 163, 184, 0.3)',
              borderWidth: 1,
              cornerRadius: 4,
              padding: 8,
              displayColors: true,
              boxPadding: 2,
              titleFont: {
                size: 10,
                weight: '600',
                family: 'system-ui, -apple-system, sans-serif'
              },
              bodyFont: {
                size: 10,
                weight: '400',
                family: 'system-ui, -apple-system, sans-serif'
              },
              callbacks: {
                title: function(context) {
                  return context[0].label;
                },
                label: function(context) {
                  let label = context.dataset.label || '';
                  if (label) {
                    label += ': ';
                  }
                  if (context.parsed.y !== null) {
                    label += context.parsed.y.toLocaleString();
                  } else {
                    label += 'No data';
                  }

                  if (context.dataset.isSimulated ||
                      (context.dataset.data && context.dataset.data.length === 0 &&
                       context.dataset.label &&
                       (context.dataset.label.toLowerCase().includes('cursor') ||
                        context.dataset.label.toLowerCase().includes('windsurf') ||
                        context.dataset.label.toLowerCase().includes('vscode') ||
                        context.dataset.label.toLowerCase().includes('jetbrains')))) {
                    label += ' (simulated)';
                  }

                  return label;
                }
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: false
            },
            grid: {
              display: true,
              color: 'rgba(226, 232, 240, 0.5)',
              drawBorder: false,
              lineWidth: 1
            },
            ticks: {
              font: {
                size: 10,
                weight: '500',
                family: 'system-ui, -apple-system, sans-serif'
              },
              color: '#64748b',
              padding: 8,
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8
            }
          },
          y: {
            title: {
              display: false
            },
            grid: {
              display: true,
              color: 'rgba(226, 232, 240, 0.5)',
              drawBorder: false,
              lineWidth: 1
            },
            // 🔥 FIX: Only beginAtZero if we have multiple data points. With 1 point, show actual value.
            beginAtZero: hasMultipleDataPoints.value ? true : false,
            ticks: {
              font: {
                size: 10,
                weight: '500',
                family: 'system-ui, -apple-system, sans-serif'
              },
              color: '#64748b',
              padding: 8,
              callback: function(value) {
                if (value >= 1000) {
                  return (value / 1000).toFixed(1) + 'k';
                }
                return value.toLocaleString();
              }
            }
          }
        },
        interaction: {
          mode: 'index',
          intersect: false,
          axis: 'x'
        },
        elements: {
          point: {
            radius: 3,
            hoverRadius: 6,
            hitRadius: 10,
            borderWidth: 2,
            borderColor: '#fff'
          },
          line: {
            tension: 0.3,
            borderJoinStyle: 'round'
          }
        },
        layout: {
          padding: {
            top: 12,
            right: 12,
            bottom: 8,
            left: 8
          }
        }
      }
    })
  } catch (error) {
    chartInstance = null
  }
}

// Watch for data changes with debouncing
let updateTimeout = null
watch(chartData, (newData) => {
  // Clear existing timeout
  if (updateTimeout) {
    clearTimeout(updateTimeout)
  }
  
  // Debounce chart updates to prevent rapid changes
  updateTimeout = setTimeout(() => {
    try {
      if (newData && newData.labels && newData.datasets && 
          newData.labels.length > 0 && newData.datasets.length > 0) {
        updateChart()
      }
    } catch (error) {
      // Chart data watcher error
    }
  }, 100)
}, { deep: true })

// Watch for filter changes with debouncing
watch([() => props.selectedMetric, () => props.selectedIDE, () => props.timeFilter], () => {
  // Clear existing timeout
  if (updateTimeout) {
    clearTimeout(updateTimeout)
  }
  
  // Debounce chart updates to prevent rapid changes
  updateTimeout = setTimeout(() => {
    try {
      if (chartData.value && chartData.value.labels && chartData.value.datasets && 
          chartData.value.labels.length > 0 && chartData.value.datasets.length > 0) {
        updateChart()
      }
    } catch (error) {
      // Filter watcher error
    }
  }, 150)
})

// Lifecycle
onMounted(() => {
  try {
    // Wait a bit for the canvas to be ready
    setTimeout(() => {
      try {
        updateChart()
      } catch (error) {
        // Chart mount update error
      }
    }, 100)
  } catch (error) {
    // Component mount error
  }
})

onUnmounted(() => {
  // Clear any pending timeouts
  if (updateTimeout) {
    clearTimeout(updateTimeout)
  }
  
  // Safely destroy chart instance
  if (chartInstance) {
    try {
      chartInstance.destroy()
      chartInstance = null
    } catch (error) {
      // Chart unmount error
    }
  }
})
</script>

<style scoped>
.productivity-line-graph {
  width: 100%;
}

.chart-container {
  position: relative;
  height: 320px;
  width: 100%;
  max-width: 100%;
  min-height: 320px;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  border-radius: 0.5rem;
}

.chart-wrapper {
  background: white;
  border-radius: 0.5rem;
  border: 1px solid #e9ecef;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

/* Compact Cost Strip Styles */
.chart-cost-strip {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
}

.cost-strip-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  padding-bottom: 0.375rem;
  border-bottom: 1px solid #e2e8f0;
}

.cost-strip-label {
  font-size: 0.65rem;
  font-weight: 700;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.cost-strip-desc {
  font-size: 0.6rem;
  color: #64748b;
  font-style: italic;
}

.cost-strip-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.cost-strip-pill {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  background: white;
  border: 1px solid #cbd5e1;
  border-radius: 0.25rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.65rem;
}

.cost-strip-pill--no-cost {
  opacity: 0.6;
  font-style: italic;
}

.cost-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #64748b;
}

.cost-pill-name {
  color: #334155;
  font-weight: 500;
}

.cost-pill-value {
  color: #059669;
  font-weight: 600;
}

.cost-strip-pill--no-cost .cost-pill-value {
  color: #94a3b8;
}

/* ====== CI/CD Section Styles (matching other components) ====== */

.cicd-section {
  border-radius: 0.5rem;
  border-left: 3px solid transparent;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
  transition: all 0.2s ease;
  background: linear-gradient(135deg, #ffffff 0%, #f9fafb 100%);
}

.cicd-section:hover {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}

.cicd-section.stage-time-series {
  border-left-color: #0d6efd; /* primary blue for consistency */
}

.cicd-section-header {
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e9ecef;
}

.stage-icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.3), 0 2px 4px -1px rgba(99, 102, 241, 0.2);
  font-size: 1.25rem;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
}

/* Empty state */
.empty-state {
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-radius: 1rem;
  padding: 3rem 2rem;
  border: 1px solid rgba(229, 231, 235, 0.8);
}

.empty-state-icon {
  font-size: 4rem;
  opacity: 0.4;
  color: #6366f1;
}

/* Chart legend info */
.chart-legend-info {
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  padding: 1rem 1.25rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(229, 231, 235, 0.8);
  font-size: 0.875rem;
}

/* Badge utilities */
.bg-info-subtle {
  background-color: rgba(13, 202, 240, 0.1) !important;
  color: #0dcaf0 !important;
}

.bg-secondary-subtle {
  background-color: rgba(108, 117, 125, 0.1) !important;
  color: #6c757d !important;
}

.text-info {
  color: #0dcaf0 !important;
}

.text-secondary {
  color: #6c757d !important;
}

/* Fade-in animation */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Mobile responsive adjustments */
@media (max-width: 576px) {
  .chart-container {
    height: 300px;
    min-height: 300px;
    padding: 0.5rem;
  }
  
  .productivity-line-graph .card-body {
    padding: 1rem;
  }
}
</style> 