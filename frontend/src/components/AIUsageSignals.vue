<template>
  <!-- LEGACY COMPONENT - AIUsageSignals.vue -->
  <!-- NOT MOUNTED IN PRODUCTION - Reference implementation only -->
  <!-- ACTIVE CANONICAL COMPONENT: AIUsageSignalsPanel.vue -->
  <div class="ai-executive-signals">
    <div style="color: red; font-weight: bold; padding: 20px;">
      ⚠️ LEGACY COMPONENT - NOT MOUNTED
    </div>
    <!-- Executive Intelligence Header -->
    <div class="signals-header d-flex align-items-center justify-content-between mb-4">
      <div>
        <h5 class="mb-0 fw-light executive-title">AI Operational Intelligence</h5>
        <small class="text-muted executive-subtitle">Upstream AI behavior → Downstream SDLC outcomes</small>
      </div>
      <div class="d-flex align-items-center gap-2">
        <span v-if="hasInsufficientData" class="badge badge-sm bg-warning-subtle text-warning">
          <i class="bi bi-exclamation-triangle me-1"></i>Limited Data
        </span>
        <span v-else class="badge badge-sm bg-success-subtle text-success">
          <i class="bi bi-check-circle me-1"></i>Strong Signal
        </span>
      </div>
    </div>

    <!-- Executive Signal Cards -->
    <div class="row g-3 mb-4">
      <div 
        v-for="signal in computedSignals" 
        :key="signal.id"
        class="col-lg-3 col-md-6 col-12"
      >
        <div 
          class="executive-signal-card"
          :class="[
            `direction-${signal.direction}`,
            { 'insufficient-data': !signal.hasSufficientData }
          ]"
          @click="handleSignalClick(signal)"
        >
          <!-- Signal Header -->
          <div class="signal-header">
            <div class="signal-icon">
              <i :class="getSignalIcon(signal.id)"></i>
            </div>
            <div class="signal-confidence">
              <span class="confidence-badge" :class="`confidence-${signal.confidence}`">
                {{ signal.confidence.toUpperCase() }}
              </span>
            </div>
          </div>

          <!-- Signal Content -->
          <div class="signal-content">
            <div class="signal-headline">{{ signal.executiveHeadline }}</div>
            <div class="signal-metric">{{ signal.metric }}</div>
            <div class="signal-context">{{ signal.context }}</div>
          </div>

          <!-- Signal Footer -->
          <div class="signal-footer">
            <div class="signal-linked-insights">
              <i class="bi bi-link-45deg me-1"></i>
              {{ signal.linkedInsights.length }} insight{{ signal.linkedInsights.length !== 1 ? 's' : '' }}
            </div>
            <div class="signal-chevron">
              <i class="bi bi-chevron-right"></i>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { PerformanceInsight } from '@/lib/insights/types'
import { computeExecutiveSignals, type ComputedSignal } from '@/lib/aiSignals/computeExecutiveSignals'

const props = defineProps<{
  insights?: PerformanceInsight[]
  telemetry?: Record<string, any>
  sessions?: any[]
  scope?: string
}>()

// Emit event for signal click (drilldown to Performance Insights)
const emit = defineEmits<{
  signalClick: [signalId: string, linkedInsights: string[]]
}>()

// Transform telemetry sessions to the format expected by compute layer
const telemetrySessions = computed(() => {
  const sessions = props.sessions || []
  return sessions.map((s: any) => ({
    session_id: s.session_id || s.id,
    tool: s.tool || s.ide || 'unknown',
    ai_burst_count: s.ai_burst_count || s.bursts || 0,
    session_duration_minutes: s.session_duration_minutes || s.duration || 0,
    active_coding_duration_minutes: s.active_coding_duration_minutes || s.active_coding_time || 0,
    time_to_first_commit_ms: s.time_to_first_commit_ms || s.ttfc || null,
    commits: s.commits || 0,
    ttfc_minutes: s.ttfc_minutes || null
  }))
})

// Compute executive signals
const computedSignals = computed((): ComputedSignal[] => {
  const sessions = telemetrySessions.value
  
  // Create GitHub data placeholder (will be populated from real GitHub API)
  const githubData = {
    commits: [],
    prs: [],
    deployments: [],
    reverts: []
  }
  
  // Compute signals with 4-week time window
  const signals = computeExecutiveSignals({
    telemetry: { sessions },
    github: githubData,
    timeWindowDays: 28
  })
  
  return signals
})

// Check if any signal has insufficient data
const hasInsufficientData = computed(() => {
  return computedSignals.value.some(s => !s.hasSufficientData)
})

// Get icon for signal
const getSignalIcon = (signalId: string): string => {
  const iconMap: Record<string, string> = {
    'ai-delivery-velocity': 'bi-rocket-takeoff',
    'ai-review-efficiency': 'bi-lightning',
    'ai-code-quality': 'bi-shield-check',
    'ai-focus-fragmentation': 'bi-graph-up',
    'ai-workflow-standardization': 'bi-diagram-3',
    'ai-deployment-stability': 'bi-box-seam',
    'ai-small-pr-optimization': 'bi-git-pull-request',
    'ai-yield-optimization': 'bi-graph-up-arrow'
  }
  return iconMap[signalId] || 'bi-activity'
}

// Handle signal click for drilldown
const handleSignalClick = (signal: ComputedSignal) => {
  if (!signal.hasSufficientData) return
  
  emit('signalClick', signal.id, signal.linkedInsights)
}
</script>

<style scoped>
.ai-executive-signals {
  padding: 1.5rem 0;
}

.signals-header {
  margin-bottom: 1.5rem;
}

.executive-title {
  font-size: 1.25rem;
  font-weight: 300;
  letter-spacing: 0.5px;
  color: #111827;
}

.executive-subtitle {
  font-size: 0.875rem;
  color: #6b7280;
  letter-spacing: 0.25px;
}

/* Executive Signal Cards */
.executive-signal-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.25rem;
  cursor: pointer;
  transition: all 0.3s ease;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.executive-signal-card:hover {
  border-color: #d1d5db;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.executive-signal-card.insufficient-data {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Direction-based styling */
.executive-signal-card.direction-positive {
  border-left: 3px solid #10b981;
}

.executive-signal-card.direction-warning {
  border-left: 3px solid #f59e0b;
}

.executive-signal-card.direction-risk {
  border-left: 3px solid #ef4444;
}

.executive-signal-card.direction-neutral {
  border-left: 3px solid #6b7280;
}

/* Signal Header */
.signal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.signal-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  background: #f3f4f6;
  color: #374151;
}

.signal-confidence {
  display: flex;
  align-items: center;
}

.confidence-badge {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  letter-spacing: 0.5px;
}

.confidence-high {
  background: #d1fae5;
  color: #065f46;
}

.confidence-medium {
  background: #fef3c7;
  color: #92400e;
}

.confidence-low {
  background: #fee2e2;
  color: #991b1b;
}

/* Signal Content */
.signal-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.signal-headline {
  font-size: 0.875rem;
  font-weight: 500;
  color: #111827;
  line-height: 1.4;
  min-height: 2.8rem;
}

.signal-metric {
  font-size: 1.5rem;
  font-weight: 600;
  color: #111827;
  letter-spacing: -0.5px;
}

.signal-context {
  font-size: 0.75rem;
  color: #6b7280;
  line-height: 1.3;
}

/* Signal Footer */
.signal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #f3f4f6;
}

.signal-linked-insights {
  font-size: 0.75rem;
  color: #6b7280;
  display: flex;
  align-items: center;
}

.signal-chevron {
  color: #9ca3af;
  font-size: 0.875rem;
}

/* Responsive adjustments */
@media (max-width: 991px) {
  .executive-signal-card {
    padding: 1rem;
  }
  
  .signal-headline {
    font-size: 0.8125rem;
  }
  
  .signal-metric {
    font-size: 1.25rem;
  }
}
</style>
  
  const totalSessions = sessions.length
  const ideCount = toolsWithData.size
  
  // CREDIBILITY FIX: Never show more IDEs than actually have data
  // If we have 0-3 IDEs, show actual count. If more, cap at what's reasonable.
  const displayCount = Math.min(ideCount, 3) // Max 3 IDEs shown in cards
  
  return `${displayCount} IDEs • ${totalSessions} sessions`
}

// Metric selection functions
function onMetricChange() {
  console.log('Metric changed to:', selectedMetric.value)
}

function getSelectedMetricValue(ide: any): string {
  const sessions = props.telemetry?.sessions || []
  const valueMap: Record<string, () => string> = {
    adoption: () => `${ide.adoption.toFixed(1)}% adoption`,
    intensity: () => `${ide.intensity.toFixed(2)} assists/session`,
    'ai-heavy-sessions': () => `${((sessions.filter((s: any) => s.tool === ide.toolId && (s.ai_burst_count || 0) > 5).length / ide.sessions) * 100).toFixed(1)}% heavy sessions`,
    'ai-bursts': () => `${ide.intensity.toFixed(2)} assists/session`,
    'ai-usage-duration': () => `${(ide.activeMinutes / ide.aiSessions).toFixed(1)} min/session`,
    'active-coding-time': () => `${(ide.activeMinutes / ide.sessions).toFixed(1)} focused min/session`,
    'idle-time': () => `${((ide.totalMinutes - ide.activeMinutes) / ide.sessions).toFixed(1)} idle min/session`
  }
  return valueMap[selectedMetric.value]?.() || '0'
}

function getSelectedMetricLabelText(): string {
  return selectedMetricLabel.value
}

// IDE helper functions
function getToolLabel(toolId: string): string {
  const labels: Record<string, string> = {
    cursor: 'Cursor',
    windsurf: 'Windsurf',
    vscode: 'VS Code',
    unknown: 'Unknown'
  }
  return labels[toolId] || toolId
}

function getIDEIcon(toolId: string): string {
  const icons: Record<string, string> = {
    cursor: 'C',
    windsurf: 'W',
    vscode: 'V',
    unknown: '?'
  }
  return icons[toolId] || '?'
}

function getIDEIconClass(toolId: string): string {
  return `ide-${toolId}`
}

function getIDERank(toolId: string): number {
  const sorted = [...liveIDEData.value].sort((a, b) => b.adoption - a.adoption)
  return sorted.findIndex(ide => ide.toolId === toolId) + 1
}

function isTopPerformer(ide: any): boolean {
  return getIDERank(ide.toolId) === 1
}

function getComparisonClass(value: number): string {
  if (value > 15) return 'tier-top'
  if (value > 5) return 'tier-high'
  if (value > 0) return 'tier-good'
  if (value < -15) return 'tier-low'
  if (value < -5) return 'tier-risk'
  if (value < 0) return 'tier-concern'
  return 'tier-stable'
}

function getComparisonText(value: number): string {
  if (value > 15) return 'Strong workflow consistency'
  if (value > 5) return 'Above org throughput baseline'
  if (value > 0) return 'Above org stability baseline'
  if (value < -15) return 'Elevated fragmentation risk'
  if (value < -5) return 'Lower sustained focus'
  if (value < 0) return 'Higher review variance'
  return 'Within expected range'
}

function getComparisonIcon(value: number): string {
  if (value > 15) return 'bi-trophy-fill'
  if (value > 5) return 'bi-graph-up-arrow'
  if (value > 0) return 'bi-check-circle-fill'
  if (value < -15) return 'bi-exclamation-triangle-fill'
  if (value < -5) return 'bi-exclamation-circle-fill'
  if (value < 0) return 'bi-dash-circle-fill'
  return 'bi-shield-check'
}

function getPerformanceDeltas(toolId: string): any[] {
  return [
    { label: 'Speed', value: '+12%', class: 'positive' },
    { label: 'Quality', value: '+8%', class: 'positive' },
    { label: 'Efficiency', value: '+15%', class: 'positive' }
  ]
}

function getTopPerformerComparison(ide: any): string {
  const topPerformer = liveIDEData.value[0]
  if (!topPerformer || ide.toolId === topPerformer.toolId) return 'Top performer'
  const diff = ((ide.adoption - topPerformer.adoption) / topPerformer.adoption) * 100
  return `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`
}

function getCostPerDeveloper(ide: any): string {
  const mockCost = 29 // $29/month
  const mockUsers = Math.floor(Math.random() * 10) + 5
  return `$${(mockCost / mockUsers).toFixed(2)}`
}

function getProductivityPerUser(ide: any): string {
  const mockProductivity = ide.adoption * 1.5
  return `${mockProductivity.toFixed(1)} units`
}

// ROI Modal functions
function openROIModal(ide: any) {
  selectedIDE.value = ide
  showROIModal.value = true
}

function closeROIModal() {
  showROIModal.value = false
  selectedIDE.value = null
}

function getROIData(ide: any): any {
  return {
    monthlyCost: '$29.00',
    activeUsers: Math.floor(Math.random() * 10) + 5,
    aiIntensity: ide.intensity.toFixed(1),
    roiScore: (ide.adoption * 2.5).toFixed(0),
    totalSpend: '$348.00',
    costPerUser: '$24.00',
    efficiency: 'High',
    costEfficiency: 'Excellent',
    productivityImpact: '+23%',
    recommendation: 'Continue current usage pattern'
  }
}
</script>

<style scoped>
/* AI Usage Signals Panel Styles */
.ai-usage-signals-panel {
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 0;
}

.panel-header {
  margin-bottom: 1rem;
}

/* Signal Tiles */
.signal-tile {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 14px;
  height: 100%;
  transition: all 0.2s ease;
}

.signal-tile:hover {
  border-color: #d1d5db;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.signal-tile.priority-tile {
  border: 3px solid #2563eb;
  background: linear-gradient(135deg, #eff6ff 0%, #ffffff 100%);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.15);
  transform: translateY(-2px);
}

.signal-tile.priority-tile .tile-value {
  color: #1e40af;
  font-size: 1.75rem;
  font-weight: 700;
}

.signal-tile.priority-tile .tile-delta {
  color: #059669;
  font-weight: 600;
  font-size: 0.85rem;
}

.tile-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.tile-icon {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: white;
}

.tile-icon.intensity { background: #3b82f6; }
.tile-icon.efficiency { background: #10b981; }
.tile-icon.productivity { background: #8b5cf6; }
.tile-icon.velocity { background: #f59e0b; }
.tile-icon.coverage { background: #06b6d4; }
.tile-icon.cadence { background: #6366f1; }
.tile-icon.risk { background: #ef4444; }

.tile-status {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.tile-status.live {
  background: #dcfce7;
  color: #166534;
}

.tile-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.tile-delta {
  font-size: 0.75rem;
  color: #6b7280;
  margin-bottom: 0.25rem;
}

.tile-interpretation {
  font-size: 0.7rem;
  color: #374151;
  margin-bottom: 0.5rem;
  line-height: 1.2;
}

.tile-label {
  font-size: 0.875rem;
  color: #374151;
  font-weight: 500;
  margin-bottom: 0.25rem;
}

.tile-time {
  font-size: 0.75rem;
  color: #9ca3af;
}

.tile-description {
  font-size: 0.75rem;
  color: #6b7280;
}

/* Productivity Metrics Section */
.productivity-metrics-section {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.5rem;
}

.metrics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.header-content {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
}

.section-subtitle {
  font-size: 0.875rem;
  color: #6b7280;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.metric-selector-wrapper {
  position: relative;
}

.metric-selector {
  appearance: none;
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.5rem 2.5rem 0.5rem 1rem;
  font-size: 0.875rem;
  color: #374151;
  cursor: pointer;
}

.selector-icon {
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  color: #6b7280;
  pointer-events: none;
}

.collapse-toggle-btn {
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  color: #374151;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.collapse-toggle-btn:hover {
  background: #e5e7eb;
}

/* IDE Comparison Grid */
.ide-comparison-wrapper {
  margin-top: 1rem;
}

.ai-adoption-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1rem;
}

.ide-comparison-card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1.25rem;
  transition: all 0.2s ease;
  /* CREDIBILITY FIX: Ensure consistent card height across all IDE cards */
  min-height: 320px;
  display: flex;
  flex-direction: column;
}

.ide-comparison-card:hover {
  border-color: #d1d5db;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.ide-comparison-card.top-performer {
  border-color: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 84, 0.3);
}

.ide-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.ide-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.ide-icon {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: white;
}

.ide-icon.ide-cursor { background: #0891b2; }
.ide-icon.ide-windsurf { background: #3b82f6; }
.ide-icon.ide-vscode { background: #007acc; }
.ide-icon.ide-unknown { background: #6b7280; }

.ide-name {
  font-size: 1rem;
  font-weight: 600;
  color: #1f2937;
}

.ide-rank {
  font-size: 0.875rem;
  font-weight: 600;
  color: #6b7280;
  background: #f3f4f6;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.ide-rank.top-performer {
  background: #dcfce7;
  color: #166534;
}

.primary-metric-display {
  text-align: center;
  margin-bottom: 1rem;
}

.metric-value-large {
  font-size: 2rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.metric-label-large {
  font-size: 0.875rem;
  color: #6b7280;
}

.metrics-grid-compact {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.metric-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  border-radius: 4px;
}

.metric-row.primary {
  background: #f0f9ff;
}

.metric-row.sessions {
  background: #f9fafb;
}

.metric-row.comparison {
  background: #f9fafb;
}

.metric-row.rank {
  background: #f9fafb;
}

.metric-label {
  font-size: 0.75rem;
  color: #6b7280;
  font-weight: 500;
}

.metric-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: #1f2937;
}

.metric-value.positive {
  color: #10b981;
}

.metric-value.negative {
  color: #ef4444;
}

.metric-value.neutral {
  color: #6b7280;
}

.performance-deltas-section {
  margin-bottom: 1rem;
}

.insights-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: #374151;
  margin-bottom: 0.75rem;
}

.insights-icon {
  color: #6b7280;
}

.delta-items {
  display: flex;
  gap: 0.5rem;
}

.delta-item {
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.delta-item.positive {
  background: #dcfce7;
  color: #166534;
}

.delta-item.negative {
  background: #fef2f2;
  color: #dc2626;
}

/* IDE Card Content Layout */
.ide-card-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  /* CREDIBILITY FIX: Ensure content fills card height for consistent button alignment */
  flex: 1;
}

/* ROI Analysis Button */
.roi-analysis-button {
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  border: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.roi-button-container {
  margin-top: auto;
  padding-top: 1rem;
  /* CREDIBILITY FIX: Ensure ROI buttons align at bottom of all cards */
  width: 100%;
  text-align: center;
}

.roi-analysis-button {
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  border: none;
  border-radius: 8px;
  padding: 0.75rem 1.5rem;
  color: white;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: all 0.2s ease;
  /* CREDIBILITY FIX: Ensure button width consistency across cards */
  width: 100%;
  white-space: nowrap;
}

.roi-analysis-button:hover {
  background: linear-gradient(135deg, #2563eb, #1e40af);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

/* ROI Modal */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-dialog {
  background: white;
  border-radius: 12px;
  max-width: 800px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.modal-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
}

.btn-close {
  background: none;
  border: none;
  font-size: 1.25rem;
  color: #6b7280;
  cursor: pointer;
}

.modal-body {
  padding: 1.5rem;
}

.modal-footer {
  padding: 1.5rem;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
}

.btn-secondary {
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.5rem 1rem;
  color: #374151;
  cursor: pointer;
}

.btn-secondary:hover {
  background: #e5e7eb;
}

/* ROI Details Sections */
.executive-summary-section,
.ai-spend-section,
.comparison-section,
.insights-section {
  margin-bottom: 2rem;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.section-icon {
  color: #6b7280;
}

.section-title {
  font-size: 1rem;
  font-weight: 600;
  color: #1f2937;
}

.executive-metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.executive-metric {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
}

.metric-icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 0.75rem;
  color: white;
}

.metric-icon-wrapper.cost { background: #3b82f6; }
.metric-icon-wrapper.users { background: #10b981; }
.metric-icon-wrapper.intensity { background: #f59e0b; }
.metric-icon-wrapper.roi { background: #8b5cf6; }

.metric-content .metric-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.metric-content .metric-label {
  font-size: 0.75rem;
  color: #6b7280;
}

.spend-metrics-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
}

.spend-metric {
  text-align: center;
}

.spend-value {
  font-size: 1.125rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.spend-label {
  font-size: 0.75rem;
  color: #6b7280;
}

.comparison-compact-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.comparison-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  background: #f9fafb;
  border-radius: 6px;
}

.comparison-label {
  font-size: 0.875rem;
  color: #6b7280;
}

.comparison-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: #1f2937;
}

.comparison-value.cost-value {
  color: #3b82f6;
}

.comparison-value.productivity-value {
  color: #10b981;
}

.comparison-value.tier-top {
  color: #059669;
  background: rgba(5, 150, 105, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
}

.comparison-value.tier-high {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
}

.comparison-value.tier-good {
  color: #34d399;
  background: rgba(52, 211, 153, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
}

.comparison-value.tier-stable {
  color: #6b7280;
  background: rgba(107, 114, 128, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
}

.comparison-value.tier-concern {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
}

.comparison-value.tier-risk {
  color: #ea580c;
  background: rgba(234, 88, 12, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
}

.comparison-value.tier-low {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
}

.insights-content {
  background: #f9fafb;
  border-radius: 8px;
  padding: 1rem;
}

.insight-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1rem;
}

.insight-row:last-child {
  margin-bottom: 0;
}

.insight-item {
  background: white;
  border-radius: 6px;
  padding: 0.75rem;
}

.insight-label {
  font-size: 0.75rem;
  color: #6b7280;
  margin-bottom: 0.25rem;
}

.insight-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: #1f2937;
}

/* Responsive Design */
@media (max-width: 768px) {
  .metrics-header {
    flex-direction: column;
    gap: 1rem;
    align-items: flex-start;
  }
  
  .header-controls {
    width: 100%;
    justify-content: space-between;
  }
  
  .ai-adoption-grid {
    grid-template-columns: 1fr;
  }
  
  .executive-metrics-grid {
    grid-template-columns: 1fr;
  }
  
  .spend-metrics-row {
    grid-template-columns: 1fr;
  }
  
  .comparison-compact-grid {
    grid-template-columns: 1fr;
  }
  
  .insight-row {
    grid-template-columns: 1fr;
  }
}
</style>
