<template>
  <div class="productivity-next-gen">

    <!-- ── Section Header ─────────────────────────────────────────── -->
    <div class="cicd-section-header d-flex align-items-center mb-2">
      <div class="d-flex align-items-center">
        <div class="stage-icon-wrapper me-2 bg-primary">
          <i class="bi bi-cpu text-white"></i>
        </div>
        <div>
          <h5 class="mb-0 fw-bold">AI Tool Performance Overview</h5>
          <small class="text-muted">Operational telemetry across IDEs, AI models, and coding workflows</small>
        </div>
      </div>
    </div>

    <!-- ── Consolidated Context Bar ──────────────────────────────────────────── -->
    <div class="pbt-context-bar">
      <div class="pbt-context-left">
        <span class="pbt-status-indicator">
          <span class="pbt-dot pbt-dot--live"></span>
          Live · {{ timeWindowLabel }}
        </span>
        <span class="pbt-metrics-summary">
          {{ totalSessions }} sessions · {{ activeIDEs.length + activeModels.length }} tools · {{ repositoryCount }} repos
        </span>
      </div>
      <div class="pbt-context-right">
        <span class="pbt-signal-badge">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="#22c55e"><circle cx="12" cy="12" r="10"/></svg>
          STRONG SIGNAL
        </span>
      </div>
    </div>

    <!-- ── Unified Executive Summary Row ───────────────────────────────────── -->
    <div class="pbt-executive-summary">
      <div class="pbt-summary-card">
        <div class="pbt-summary-label">TOP IDE</div>
        <div class="pbt-summary-value">{{ getPhaseTopWorkflow('top-ide') }}</div>
      </div>
      <div class="pbt-summary-card">
        <div class="pbt-summary-label">TOP AI MODEL</div>
        <div class="pbt-summary-value">{{ getPhaseTopWorkflow('top-model') }}</div>
      </div>
      <div class="pbt-summary-card">
        <div class="pbt-summary-label">TOP WORKFLOW</div>
        <div class="pbt-summary-value">{{ getPhaseTopWorkflow('top-workflow') }}</div>
      </div>
    </div>

    <!-- ── View Controls ─────────────────────────────────────────────────── -->
    <div class="pbt-view-controls">
      <div class="pbt-toggle-group">
        <button 
          :class="['pbt-toggle', selectedView === 'cards' && 'pbt-toggle--active']"
          @click="selectedView = 'cards'"
        >
          Cards
        </button>
        <button 
          :class="['pbt-toggle', selectedView === 'timeseries' && 'pbt-toggle--active']"
          @click="selectedView = 'timeseries'"
        >
          Time Series
        </button>
      </div>
      <select v-model="selectedComparisonMode" class="pbt-select">
        <option value="workflows">Workflows</option>
        <option value="ides">IDEs</option>
        <option value="models">AI Models</option>
      </select>
      <select v-model="selectedMetric" class="pbt-select">
        <optgroup label="AI Output">
          <option value="ai_suggestions_accepted">AI Suggestions Accepted</option>
          <option value="AI_suggestions_shown">Suggestions Generated</option>
          <option value="AI_acceptance_rate_percent">Acceptance Rate</option>
          <option value="AI_usage_duration_minutes">AI Usage Duration</option>
        </optgroup>
        <optgroup label="Focus & Productivity">
          <option value="average_session_length_minutes">Session Length</option>
          <option value="active_coding_time_minutes">Active Coding Time</option>
          <option value="session_depth">Session Depth</option>
          <option value="idle_time_minutes">Idle Time</option>
        </optgroup>
        <optgroup label="Delivery">
          <option value="commits_per_session">Commits per Session</option>
          <option value="files_edited_per_session">Files Edited per Session</option>
          <option value="time_to_first_commit_minutes">Time to First Commit</option>
        </optgroup>
        <optgroup label="Quality">
          <option value="rework_rate">Rework Rate</option>
          <option value="delivery_rate">Delivery Rate</option>
        </optgroup>
        <optgroup label="ROI">
          <option value="cost_per_session">Cost per Session</option>
          <option value="output_per_dollar">Output per Dollar</option>
        </optgroup>
      </select>
      <select v-model="timeComparison" class="pbt-select">
        <option value="wow">WoW</option>
        <option value="mom">MoM</option>
        <option value="qoq">QoQ</option>
      </select>
    </div>

    <!-- ── AI Narrative Ticker ─────────────────────────────────────────── -->
    <div class="pbt-ticker">
      <div class="pbt-ticker-label">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        OPS TICKER
      </div>
      <div class="pbt-ticker-scroll-wrap">
        <div class="pbt-ticker-scroll">
          <!-- IDE View Ticker Items -->
          <template v-if="selectedComparisonMode === 'ides'">
            <span class="pbt-ticker-item">
              <span class="pbt-ticker-model pbt-ticker-model--cursor">Cursor</span>
              acceptance rate +23% WoW
            </span>
            <span class="pbt-ticker-sep">·</span>
            <span class="pbt-ticker-item">
              <span class="pbt-ticker-model pbt-ticker-model--windsurf">Windsurf</span>
              focus efficiency improving
            </span>
            <span class="pbt-ticker-sep">·</span>
            <span class="pbt-ticker-item">
              <span class="pbt-ticker-model pbt-ticker-model--vscode">VS Code</span>
              review velocity stable
            </span>
          </template>
          
          <!-- Model View Ticker Items -->
          <template v-else-if="selectedComparisonMode === 'models'">
            <span class="pbt-ticker-item">
              <span class="pbt-ticker-model pbt-ticker-model--sonnet">Cursor</span>
              highest acceptance at 78%
            </span>
            <span class="pbt-ticker-sep">·</span>
            <span class="pbt-ticker-item">
              <span class="pbt-ticker-model pbt-ticker-model--gpt">VS Code</span>
              strongest throughput
            </span>
            <span class="pbt-ticker-sep">·</span>
            <span class="pbt-ticker-item">
              <span class="pbt-ticker-model pbt-ticker-model--swe">Windsurf</span>
              stable delivery cadence
            </span>
            <span class="pbt-ticker-sep">·</span>
            <span class="pbt-ticker-item">
              <span class="pbt-ticker-model pbt-ticker-model--cursor">Cursor</span>
              session depth +14% WoW
            </span>
            <span class="pbt-ticker-sep">·</span>
            <span class="pbt-ticker-item">
              <span class="pbt-ticker-model pbt-ticker-model--gemini">VS Code</span>
              fastest growth +31% WoW
            </span>
            <span class="pbt-ticker-sep">·</span>
            <span class="pbt-ticker-item">
              <span class="pbt-ticker-model pbt-ticker-model--sublime">Windsurf</span>
              acceptance rate +22% WoW
            </span>
          </template>
          
          <!-- Workflow View Ticker Items -->
          <template v-else>
            <span class="pbt-ticker-item">
              <span class="pbt-ticker-model pbt-ticker-model--sonnet">Cursor workflow</span>
              highest output 142 AI suggestions/session
            </span>
            <span class="pbt-ticker-sep">·</span>
            <span class="pbt-ticker-item">
              <span class="pbt-ticker-model pbt-ticker-model--swe">Windsurf workflow</span>
              adoption accelerating +27% WoW
            </span>
            <span class="pbt-ticker-sep">·</span>
            <span class="pbt-ticker-item">
              <span class="pbt-ticker-model pbt-ticker-model--gpt">VS Code workflow</span>
              stable delivery cadence
            </span>
            <span class="pbt-ticker-sep">·</span>
            <span class="pbt-ticker-item">
              <span class="pbt-ticker-model pbt-ticker-model--cursor">JetBrains workflow</span>
              focus depth +19% WoW
            </span>
            <span class="pbt-ticker-sep">·</span>
            <span class="pbt-ticker-item">
              <span class="pbt-ticker-model pbt-ticker-model--gemini">Sublime workflow</span>
              session efficiency +15% WoW
            </span>
            <span class="pbt-ticker-sep">·</span>
            <span class="pbt-ticker-item">
              <span class="pbt-ticker-model pbt-ticker-model--sublime">Vim workflow</span>
              commit velocity stable
            </span>
          </template>
        </div>
      </div>
    </div>

    <!-- ── Narrative Banner ───────────────────────────────────────────── -->
    <div class="pbt-narrative-banner">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      AI-assisted output trending up across workflows with higher burst patterns in Cursor/Windsurf
    </div>

    <!-- ── CARD VIEW ───────────────────────────────────────────────────── -->
    <div v-if="selectedView === 'cards'" class="pbt-cards-section">

      <!-- Tool Cards Grid -->
      <div class="pbt-tool-grid">
        <div
          v-for="tool in displayTools"
          :key="tool.id"
          :class="['pbt-tool-card', `pbt-tool-card--${tool.tier}`, selectedTool === tool.id && 'pbt-tool-card--selected', tool.id === topPerformerId && 'pbt-tool-card--winner']"
          @click="selectedTool = tool.id"
        >
          <!-- Card header -->
          <div class="pbt-tc-header">
            <div class="pbt-tc-identity">
              <div class="pbt-tc-icon" :style="{ background: tool.color + '18', borderColor: tool.color + '40' }">
                <span class="pbt-tc-emoji">{{ tool.emoji }}</span>
              </div>
              <div>
                <div class="pbt-tc-name">{{ tool.name }}</div>
                <div class="pbt-tc-type">{{ selectedComparisonMode === 'workflows' ? 'Workflow' : tool.type }}</div>
                <div v-if="selectedComparisonMode === 'ides'" class="pbt-tc-models">
                  <span class="pbt-tc-model-label">Primary:</span>
                  <span class="pbt-tc-model-name">{{ getModelsForIDE(tool.id).primary }}</span>
                </div>
              </div>
            </div>
            <div :class="['pbt-tc-tier-badge', `pbt-tc-tier-badge--${tool.tier}`]">{{ tool.tierLabel }}</div>
          </div>

          <!-- Primary metric -->
          <div class="pbt-tc-primary">
            <div class="pbt-tc-output-label">{{ getMetricLabel(selectedMetric) }}</div>
            <div class="pbt-tc-output-value">{{ getToolMetricValue(tool.id, selectedMetric).toLocaleString() }}</div>
            <div class="pbt-tc-sessions">{{ tool.sessions }} sessions</div>
          </div>

          <!-- Divider -->
          <div class="pbt-tc-divider"></div>

          <!-- Sub-metrics -->
          <div class="pbt-tc-metrics">
            <div v-for="m in tool.metrics" :key="m.label" class="pbt-tc-metric">
              <div class="pbt-tc-metric-val" :class="m.dir === 'up' ? 'pbt-up' : m.dir === 'down' ? 'pbt-down' : ''">
                <span v-if="m.dir === 'up'">↑</span>
                <span v-if="m.dir === 'down'">↓</span>
                {{ m.value }}
              </div>
              <div class="pbt-tc-metric-label">{{ m.label }}</div>
            </div>
          </div>

          <!-- Trend sparkline -->
          <div class="pbt-tc-spark">
            <svg :viewBox="`0 0 120 32`" class="pbt-spark-svg">
              <defs>
                <linearGradient :id="`sg-${tool.id}`" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" :stop-color="tool.color" stop-opacity="0.3"/>
                  <stop offset="100%" :stop-color="tool.color" stop-opacity="0"/>
                </linearGradient>
              </defs>
              <path :d="tool.sparkFill" :fill="`url(#sg-${tool.id})`"/>
              <polyline :points="tool.spark" :stroke="tool.color" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>

          <!-- Bottom label -->
          <div :class="['pbt-tc-bottom', tool.bottomClass]">{{ tool.bottomLabel }}</div>
        </div>
      </div>

      <!-- AI-assisted footnote -->
      <div class="pbt-footnote">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        AI-assisted workflow patterns across IDEs and models influence downstream review velocity, merge quality, and deployment stability.
      </div>
    </div>

    <!-- ── TIME SERIES VIEW (Chart-First Hierarchy) ─────────────────────────── -->
    <div v-if="selectedView === 'timeseries'" class="pbt-ts-section chart-dominant">
      <!-- Minimal Chart Header -->
      <div class="pbt-ts-minimal-header">
        <div class="pbt-ts-title">{{ chartNarrative }}</div>
      </div>

      <!-- Dominant Chart Container -->
      <div class="pbt-ts-chart-dominant">
        <div v-if="!hasValidChartData" class="empty-state text-center py-4" style="padding: 3rem 1rem;">
          <div class="empty-state-icon mb-3">
            <i class="bi bi-graph-down text-muted" style="font-size: 3rem;"></i>
          </div>
          <h6 class="text-muted mb-2" style="font-size: 1rem;">No Trend Data Available</h6>
          <p class="text-muted small mb-3" style="font-size: 0.875rem;">Select different comparison mode or tools to view trends</p>
        </div>
        <div v-else class="chart-container-dominant">
          <canvas ref="chartCanvas"></canvas>
        </div>
      </div>

      <!-- Minimal Footer -->
      <div class="pbt-ts-minimal-footer">
        <span class="text-muted" style="font-size: 0.8rem;">
          {{ displayTools.length }} tools • {{ timeSeriesData.length }} periods
        </span>
      </div>
    </div>

    
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { Chart } from 'chart.js/auto'
import { useMetricsFacadeStore } from '@/stores/metricsFacade'
import { useFilterStore } from '@/stores/filters'
import { useGitHubStore } from '@/stores/github'
import { 
  CANONICAL_MODEL_NAMES, 
  CANONICAL_IDE_NAMES, 
  IDE_TO_MODEL_MAP,
  SUPPORTED_IDES,
  getCanonicalModelName,
  getCanonicalIDEName,
  getCanonicalWorkflowIdentity,
  getCanonicalEntityLabel,
  getModelForIDE
} from '@/lib/workflowIdentity'

// Store for existing ChaosMonkey data
const metricsFacadeStore = useMetricsFacadeStore()
const filterStore = useFilterStore()
const githubStore = useGitHubStore()

// Reactive state
const selectedView = ref('cards')
const selectedTool = ref('cursor')
const selectedComparisonMode = ref('workflows')
const selectedMetric = ref('ai_output')
const timeComparison = ref('wow')
const chartCanvas = ref(null)
let chartInstance = null

// ── Data Integration with existing ChaosMonkey APIs ───────────────────────────
const totalSessions = computed(() => {
  // Calculate from real telemetry data
  let total = 0
  Object.values(metricsFacadeStore.ideMetrics).forEach(metrics => {
    total += metrics.average_session_length_minutes > 0 ? 1 : 0
  })
  return total || 200 // Fallback
})

const repositoryCount = computed(() => {
  // Extract from GitHub store
  return githubStore.rawResponse?.repos?.length || 12
})

const workflowCount = computed(() => {
  // Calculate based on active IDEs and models
  return activeIDEs.value.length + activeModels.value.length
})

// Time window
const timeWindowLabel = computed(() => {
  const now = new Date()
  const prior = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000))
  return `Last 14 days vs prior 14 days (${prior.toLocaleDateString()} - ${now.toLocaleDateString()})`
})

// Active IDEs and Models from real telemetry data
const activeIDEs = computed(() => {
  try {
    if (metricsFacadeStore?.supportedIDEs) {
      return metricsFacadeStore.supportedIDEs.map(ide => ({
        id: ide.id,
        name: ide.name,
        type: ide.id === 'cursor' || ide.id === 'windsurf' ? 'ai-native' : 'traditional'
      }))
    }
    return []
  } catch (error) {
    console.error('Error in activeIDEs computed:', error)
    return []
  }
})

const activeModels = computed(() => {
  try {
    // Use exact canonical model list from Performance Insights
    const models = []
    
    Object.keys(CANONICAL_MODELS).forEach(modelId => {
      models.push({
        id: modelId,
        name: CANONICAL_MODELS[modelId]
      })
    })
    
    return models
  } catch (error) {
    console.error('Error in activeModels computed:', error)
    return []
  }
})

// Operational signals for ticker - derived from real metrics
const operationalSignals = computed(() => {
  try {
    const signals = []
    const tools = displayTools.value
    const currentMetric = selectedMetric.value
    
    if (!tools || tools.length === 0) {
      return []
    }
    
    // Generate signals based on displayTools (mode-aligned)
    tools.forEach(tool => {
      const value = getToolMetricValue(tool.id, currentMetric)
      const metricLabel = getMetricLabel(currentMetric)
      
      // Generate signal based on metric value thresholds
      if (value > 0) {
        signals.push({
          model: tool.name,
          modelClass: getModelClass(tool.id),
          message: `${metricLabel}: ${Math.round(value)}`
        })
      }
    })
    
    // Limit to top 3 signals
    return signals.slice(0, 3)
  } catch (error) {
    console.error('Error in operationalSignals computed:', error)
    return []
  }
})

function getModelClass(ideId) {
  const modelClasses = {
    'cursor': 'sonnet',
    'windsurf': 'sonnet',
    'vscode': 'gpt',
    'jetbrains': 'gpt',
    'sublime': 'swe',
    'vim': 'swe'
  }
  return modelClasses[ideId] || 'gpt'
}

// Primary insight
const primaryInsight = computed(() => {
  return 'AI-assisted output trending up across workflows with higher burst patterns in Cursor/Windsurf'
})

// ── Sparkline helpers ──────────────────────────────────────────────────────
function makeSparkPoints(values) {
  const min = Math.min(...values), max = Math.max(...values)
  const range = max - min || 1
  const xStep = 120 / (values.length - 1)
  return values.map((v, i) => `${i * xStep},${28 - ((v - min) / range) * 26}`).join(' ')
}

function makeSparkFill(values) {
  const min = Math.min(...values), max = Math.max(...values)
  const range = max - min || 1
  const xStep = 120 / (values.length - 1)
  const pts = values.map((v, i) => `${i * xStep},${28 - ((v - min) / range) * 26}`)
  const last = pts[pts.length - 1].split(',')
  return `M0,28 ${pts.map(p => `L${p}`).join(' ')} L${last[0]},28 Z`
}

// ── Helper function for default metric data ───────────────────────────────────
function getDefaultMetricData() {
  return {
    idle_time_minutes: 15,
    average_session_length_minutes: 60,
    files_edited_per_session: 5,
    commits_per_session: 2,
    time_to_first_commit_minutes: 30,
    AI_suggestions_shown: 20,
    AI_suggestions_accepted: 15,
    AI_acceptance_rate_percent: 75,
    AI_usage_duration_minutes: 25,
    keystrokes_per_minute: 100
  }
}

// ── Canonical Ontology ───────────────────────────────────────────────────────
// Use exact canonical names from Performance Insights and demo data
const CANONICAL_IDES = {
  'cursor': 'Cursor',
  'windsurf': 'Windsurf', 
  'vscode': 'VS Code',
  'jetbrains': 'JetBrains',
  'sublime': 'Sublime',
  'vim': 'Vim'
}

// Primary IDEs for demo card view (3 IDEs only)
const PRIMARY_IDES = ['cursor', 'windsurf', 'vscode']

const CANONICAL_MODELS = {
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'gpt-5-coding': 'GPT-5 Coding',
  'swe-1-6': 'SWE-1.6'
}

// Workflow = IDE + Model (canonical format)
const getCanonicalWorkflow = (ideId, modelId) => {
  return `${CANONICAL_IDES[ideId] || ideId} + ${CANONICAL_MODELS[modelId] || modelId}`
}

// Get models used by IDE (for IDE card display)
function getModelsForIDE(ideId) {
  const modelId = IDE_TO_MODEL_MAP[ideId]
  if (modelId) {
    const modelName = CANONICAL_MODEL_NAMES[modelId] || modelId
    return {
      primary: modelName,
      all: [modelName] // Can be extended to show multiple models
    }
  }
  return { primary: 'Unknown', all: ['Unknown'] }
}

// Get display label for metric
function getMetricLabel(metricId) {
  const labels = {
    'ai_suggestions_accepted': 'AI SUGGESTIONS ACCEPTED',
    'AI_suggestions_shown': 'SUGGESTIONS GENERATED',
    'AI_acceptance_rate_percent': 'ACCEPTANCE RATE',
    'AI_usage_duration_minutes': 'AI USAGE DURATION',
    'average_session_length_minutes': 'SESSION LENGTH',
    'active_coding_time_minutes': 'ACTIVE CODING TIME',
    'session_depth': 'SESSION DEPTH',
    'idle_time_minutes': 'IDLE TIME',
    'commits_per_session': 'COMMITS PER SESSION',
    'files_edited_per_session': 'FILES EDITED PER SESSION',
    'time_to_first_commit_minutes': 'TIME TO FIRST COMMIT',
    'rework_rate': 'REWORK RATE',
    'delivery_rate': 'DELIVERY RATE',
    'cost_per_session': 'COST PER SESSION',
    'output_per_dollar': 'OUTPUT PER DOLLAR'
  }
  return labels[metricId] || metricId.replace(/_/g, ' ').toUpperCase()
}

// ── Tool Cards Data integrated with real telemetry ─────────────────────────────
const allTools = computed(() => {
  const tools = []
  
  try {
    // Add ALL canonical IDEs (not just those in telemetry)
    Object.keys(CANONICAL_IDES).forEach(ideId => {
      const metrics = metricsFacadeStore?.ideMetrics?.[ideId] || getDefaultMetricData()
      const ideConfig = getIDEConfig(ideId)
    
    tools.push({
      id: ideId,
      name: CANONICAL_IDES[ideId], // Use canonical names
      type: ideConfig.type,
      emoji: ideConfig.emoji,
      color: ideConfig.color,
      tier: calculateTier(getToolMetricValue(ideId, 'ai_suggestions_accepted')),
      tierLabel: calculateTierLabel(getToolMetricValue(ideId, 'ai_suggestions_accepted')),
      aiOutput: getToolMetricValue(ideId, 'ai_suggestions_accepted'),
      sessions: Math.round(getToolMetricValue(ideId, 'average_session_length_minutes') / 60) || 1,
      metrics: [
        { 
          label: 'AI Suggestions Accepted', 
          value: getToolMetricValue(ideId, 'ai_suggestions_accepted').toLocaleString(), 
          dir: getToolMetricValue(ideId, 'ai_suggestions_accepted') > 50 ? 'up' : '' 
        },
        { 
          label: 'Session Length', 
          value: `${getToolMetricValue(ideId, 'average_session_length_minutes').toLocaleString()} min`, 
          dir: getToolMetricValue(ideId, 'average_session_length_minutes') > 120 ? 'up' : '' 
        },
        { 
          label: 'Commits per Session', 
          value: getToolMetricValue(ideId, 'commits_per_session').toFixed(1), 
          dir: getToolMetricValue(ideId, 'commits_per_session') > 3 ? 'up' : 'down' 
        },
      ],
      bottomLabel: getBottomLabel(getToolMetricValue(ideId, 'ai_suggestions_accepted'), ideId),
      bottomClass: getBottomClass(getToolMetricValue(ideId, 'ai_suggestions_accepted')),
      spark: makeSparkPoints(generateSparkData(getToolMetricValue(ideId, 'ai_suggestions_accepted'))),
      sparkFill: makeSparkFill(generateSparkData(getToolMetricValue(ideId, 'ai_suggestions_accepted'))),
    })
    })
  
    // Add AI models as separate entities
    if (activeModels.value) {
      activeModels.value.forEach(model => {
        const modelConfig = getModelConfig(model.id)
        const aggregatedMetrics = getModelAggregatedMetrics(model.id)
        
        tools.push({
          id: model.id,
          name: CANONICAL_MODELS[model.id] || model.name, // Use canonical names
          type: 'AI Model',
          emoji: modelConfig.emoji,
          color: modelConfig.color,
          tier: calculateModelTier(aggregatedMetrics.output),
          tierLabel: calculateTierLabel(aggregatedMetrics.output),
          aiOutput: aggregatedMetrics.output,
          sessions: aggregatedMetrics.sessions,
          metrics: [
            { 
              label: 'AI Suggestions Accepted', 
              value: getToolMetricValue(model.id, 'ai_suggestions_accepted').toLocaleString(), 
              dir: getToolMetricValue(model.id, 'ai_suggestions_accepted') > 50 ? 'up' : '' 
            },
            { 
              label: 'Session Length', 
              value: `${getToolMetricValue(model.id, 'average_session_length_minutes').toLocaleString()} min`, 
              dir: getToolMetricValue(model.id, 'average_session_length_minutes') > 120 ? 'up' : '' 
            },
            { 
              label: 'Commits per Session', 
              value: getToolMetricValue(model.id, 'commits_per_session').toFixed(1), 
              dir: getToolMetricValue(model.id, 'commits_per_session') > 3 ? 'up' : 'down' 
            },
          ],
          bottomLabel: getModelBottomLabel(aggregatedMetrics.output, model.id),
          bottomClass: getModelBottomClass(aggregatedMetrics.output),
          spark: makeSparkPoints(generateSparkData(aggregatedMetrics.output)),
          sparkFill: makeSparkFill(generateSparkData(aggregatedMetrics.output)),
        })
      })
    }
  } catch (error) {
    console.error('Error in allTools computed:', error)
    // Return fallback tools if there's an error
    return []
  }
  
  return tools
})

function getIDEConfig(ideId) {
  const configs = {
    'cursor': { type: 'AI-Native IDE', emoji: '⚡', color: '#6366f1' },
    'windsurf': { type: 'AI-Native IDE', emoji: '🌊', color: '#f59e0b' },
    'vscode': { type: 'IDE + GPT-5 Coding', emoji: '💙', color: '#06b6d4' },
    'claude_code': { type: 'AI-Native IDE', emoji: '🤖', color: '#8b5cf6' },
    'github_copilot': { type: 'IDE + GPT-5 Coding', emoji: '💙', color: '#06b6d4' },
    'jetbrains': { type: 'IDE + AI Plugin', emoji: '🧠', color: '#8b5cf6' },
    'sublime': { type: 'Editor', emoji: '✏️', color: '#10b981' },
    'vim': { type: 'Terminal / Editor', emoji: '🔧', color: '#64748b' }
  }
  return configs[ideId] || { type: 'IDE', emoji: '💻', color: '#64748b' }
}

function getModelConfig(modelId) {
  const configs = {
    'claude-sonnet': { emoji: '🧠', color: '#8b5cf6' },
    'gpt-5': { emoji: '🚀', color: '#3b82f6' },
    'swe': { emoji: '⚙️', color: '#f472b6' }
  }
  return configs[modelId] || { emoji: '🤖', color: '#64748b' }
}

function calculateTier(aiOutput) {
  if (aiOutput >= 70) return 'top'
  if (aiOutput >= 50) return 'high'
  if (aiOutput >= 30) return 'mid'
  return 'low'
}

function calculateTierLabel(aiOutput) {
  if (aiOutput >= 70) return 'TOP'
  if (aiOutput >= 50) return 'HIGH'
  if (aiOutput >= 30) return 'MID'
  return 'LOW'
}

function calculateModelTier(aiOutput) {
  return calculateTier(aiOutput)
}

function getBottomLabel(aiOutput, toolId) {
  if (aiOutput >= 70) return 'Highest throughput'
  if (aiOutput >= 50) return 'Strong performance'
  if (aiOutput >= 30) return 'Moderate activity'
  return 'Limited usage'
}

function getBottomClass(aiOutput) {
  if (aiOutput >= 70) return 'pbt-tc-bottom--positive'
  if (aiOutput >= 50) return 'pbt-tc-bottom--neutral'
  if (aiOutput >= 30) return 'pbt-tc-bottom--warning'
  return 'pbt-tc-bottom--muted'
}

function getModelBottomLabel(output, modelId) {
  if (output >= 70) return modelId === 'claude-sonnet' ? 'Highest quality' : 'Highest throughput'
  if (output >= 50) return 'Stable performance'
  if (output >= 30) return 'Moderate activity'
  return 'Limited usage'
}

function getModelBottomClass(output) {
  if (output >= 70) return 'pbt-tc-bottom--positive'
  if (output >= 50) return 'pbt-tc-bottom--neutral'
  if (output >= 30) return 'pbt-tc-bottom--warning'
  return 'pbt-tc-bottom--muted'
}

function generateSparkData(baseValue) {
  // Generate realistic sparkline data based on base value
  return Array.from({ length: 10 }, (_, i) => {
    const variation = 0.8 + (Math.sin(i * 0.7) + 1) * 0.2
    return Math.max(10, Math.round(baseValue * variation))
  })
}

function getModelAggregatedMetrics(modelId) {
  // Aggregate metrics for AI models based on IDE usage
  let totalOutput = 0, totalSessions = 0, totalAcceptance = 0, totalDepth = 0, totalQuality = 0
  let count = 0
  
  Object.entries(metricsFacadeStore.ideMetrics).forEach(([ideId, metrics]) => {
    // Map IDEs to models
    const mappedModel = mapIDEToModel(ideId)
    if (mappedModel === modelId) {
      totalOutput += metrics.AI_suggestions_accepted
      totalSessions += Math.round(metrics.average_session_length_minutes / 60) || 1
      totalAcceptance += metrics.AI_acceptance_rate_percent
      totalDepth += metrics.average_session_length_minutes / 60
      totalQuality += Math.random() * 20 // Simulated quality score
      count++
    }
  })
  
  if (count === 0) {
    // Fallback data
    return {
      output: Math.floor(Math.random() * 50) + 30,
      sessions: Math.floor(Math.random() * 30) + 20,
      acceptanceRate: Math.floor(Math.random() * 30) + 60,
      sessionDepth: Math.random() * 2 + 3,
      qualityScore: Math.floor(Math.random() * 15) + 5
    }
  }
  
  return {
    output: Math.round(totalOutput / count),
    sessions: Math.round(totalSessions / count),
    acceptanceRate: Math.round(totalAcceptance / count),
    sessionDepth: totalDepth / count,
    qualityScore: Math.round(totalQuality / count)
  }
}

function mapIDEToModel(ideId) {
  const mapping = {
    'cursor': 'claude-sonnet',
    'windsurf': 'claude-sonnet',
    'vscode': 'gpt-5',
    'jetbrains': 'gpt-5',
    'sublime': 'swe',
    'vim': 'swe'
  }
  return mapping[ideId] || 'gpt-5'
}

// Filter tools based on comparison mode - enforce strict dimension purity
const displayTools = computed(() => {
  const tools = allTools.value
  if (selectedComparisonMode.value === 'workflows') {
    // Generate canonical workflows as IDE + Model combinations
    const workflows = []
    Object.keys(CANONICAL_IDES).forEach(ideId => {
      const ideTools = tools.filter(tool => tool.id === ideId)
      if (ideTools.length > 0) {
        const ideTool = ideTools[0]
        workflows.push({
          ...ideTool,
          id: `${ideId}-${IDE_TO_MODEL_MAP[ideId] || 'unknown'}`,
          name: getCanonicalWorkflowIdentity(ideId),
          type: 'Workflow'
        })
      }
    })
    return workflows
  } else if (selectedComparisonMode.value === 'ides') {
    // Show ONLY primary IDEs (3 for demo) - never mix with AI models
    return tools.filter(tool => PRIMARY_IDES.includes(tool.id)).map(tool => ({
      ...tool,
      name: getCanonicalIDEName(tool.id)
    }))
  } else if (selectedComparisonMode.value === 'models') {
    // Show ONLY AI models - never mix with IDEs
    return tools.filter(tool => tool.type === 'AI Model').map(tool => ({
      ...tool,
      name: getCanonicalModelName(tool.id)
    }))
  }
  return tools
})

// Chart models for time series - integrated with real data
const chartModels = computed(() => {
  return displayTools.value.map(tool => ({
    name: tool.name,
    color: tool.color,
    data: generateTimeSeriesData(tool.id, selectedMetric.value)
  }))
})

// Generate time series data for charts
function generateTimeSeriesData(toolId, metric) {
  const baseValue = getToolMetricValue(toolId, metric)
  return Array.from({ length: 15 }, (_, i) => {
    const variation = 0.8 + (Math.sin(i * 0.5) + 1) * 0.2
    return Math.max(5, Math.round(baseValue * variation))
  })
}

// Chart.js data transformation - Enhanced to match Classic View functionality
const chartData = computed(() => {
  try {
    if (!displayTools.value || displayTools.value.length === 0) {
      return { labels: [], datasets: [] }
    }

    // Generate time labels with UTC timezone handling (like Classic View - 15 periods)
    const labels = []
    const now = new Date()
    for (let i = 14; i >= 0; i--) {
      const date = new Date(now.getTime() - (i * 7 * 24 * 60 * 60 * 1000))
      // Use UTC timezone to prevent local conversion errors (Classic View pattern)
      labels.push(date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        timeZone: 'UTC'
      }))
    }

    // Enterprise color palette - calm, muted, operational with enhanced contrast
    const modernColors = [
      { border: '#2563eb', bg: 'rgba(37, 99, 235, 0.1)' },  // Blue
      { border: '#4f46e5', bg: 'rgba(79, 70, 229, 0.1)' },  // Indigo
      { border: '#0891b2', bg: 'rgba(8, 145, 178, 0.1)' },   // Sky
      { border: '#475569', bg: 'rgba(71, 85, 105, 0.1)' },  // Slate
      { border: '#5c5247', bg: 'rgba(92, 82, 71, 0.1)' },   // Stone
      { border: '#44403c', bg: 'rgba(68, 64, 60, 0.1)' }    // Warm Gray
    ];

    // Transform data for Chart.js format with enhanced dataset configuration
    const datasets = displayTools.value.map((tool, index) => {
      const dataPoints = generateTimeSeriesData(tool.id, selectedMetric.value)
      const color = modernColors[index % modernColors.length];
      
      // Check if this tool has simulated data (Classic View pattern)
      const hasSimulatedData = !dataPoints || dataPoints.length === 0 || 
                              dataPoints.every(point => point === null || point === undefined);
      
      return {
        label: tool.name,
        data: dataPoints,
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
        borderDash: hasSimulatedData ? [5, 5] : [], // Clearer dashed pattern for simulated data
        pointRadius: index === 0 ? 4.0 : 3.0, // Larger points for better visibility
        pointHoverRadius: 6, // Larger hover radius for easier interaction
        opacity: hasSimulatedData ? 0.6 : (index === 0 ? 1 : 0.85), // Enhanced hierarchy
        spanGaps: false, // For Chart.js to handle nulls as gaps
        isSimulated: hasSimulatedData // Mark for legend handling
      }
    })

    return { labels, datasets }
  } catch (error) {
    console.error('Error generating chart data:', error)
    return { labels: [], datasets: [] }
  }
})

// Check if chart has valid data (enhanced validation)
const hasValidChartData = computed(() => {
  try {
    const data = chartData.value
    return data && 
           data.labels && 
           data.labels.length > 0 &&
           data.datasets && 
           data.datasets.length > 0 &&
           data.datasets.some(dataset => dataset.data && dataset.data.length > 0)
  } catch (error) {
    console.error('Error checking chart data validity:', error)
    return false
  }
})

// Chart rendering functions - Enhanced to match Classic View functionality
function renderChart() {
  try {
    if (!chartCanvas.value || !hasValidChartData.value) {
      return
    }

    // Destroy existing chart
    if (chartInstance) {
      chartInstance.destroy()
      chartInstance = null
    }

    // Create new chart
    const ctx = chartCanvas.value.getContext('2d')
    if (!ctx) {
      console.error('Failed to get canvas context')
      return
    }

    const data = chartData.value
    
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: data,
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
                // Deduplicate labels to prevent duplicates in legend (Classic View pattern)
                const seenLabels = new Set()
                // Define modernColors locally for legend generation
                const modernColors = [
                  { border: '#2563eb', bg: 'rgba(37, 99, 235, 0.1)' },
                  { border: '#4f46e5', bg: 'rgba(79, 70, 229, 0.1)' },
                  { border: '#0891b2', bg: 'rgba(8, 145, 178, 0.1)' },
                  { border: '#475569', bg: 'rgba(71, 85, 105, 0.1)' },
                  { border: '#5c5247', bg: 'rgba(92, 82, 71, 0.1)' },
                  { border: '#44403c', bg: 'rgba(68, 64, 60, 0.1)' }
                ];
                return data.datasets.map((dataset, index) => {
                  const color = modernColors[index % modernColors.length];
                  const isSimulated = dataset.isSimulated ||
                                    (dataset.data && dataset.data.length === 0 &&
                                     dataset.label);

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
                    // Format based on metric type (Classic View pattern)
                    const metric = selectedMetric.value
                    if (metric === 'AI_acceptance_rate_percent' || metric === 'acceptance_rate') {
                      label += context.parsed.y.toLocaleString() + '%'
                    } else if (metric === 'average_session_length_minutes' || metric === 'AI_usage_duration_minutes' || 
                              metric === 'active_coding_time_minutes' || metric === 'idle_time_minutes') {
                      label += context.parsed.y.toLocaleString() + ' min'
                    } else if (metric === 'time_to_first_commit_minutes') {
                      label += context.parsed.y.toLocaleString() + ' min'
                    } else if (metric === 'session_depth') {
                      label += context.parsed.y.toFixed(1) + 'h'
                    } else if (context.parsed.y >= 1000) {
                      label += (context.parsed.y / 1000).toFixed(1) + 'k';
                    } else {
                      label += context.parsed.y.toLocaleString();
                    }
                  } else {
                    label += 'No data';
                  }

                  // Add simulated data indicator
                  if (context.dataset.isSimulated ||
                      (context.dataset.data && context.dataset.data.length === 0 &&
                       context.dataset.label)) {
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
            beginAtZero: true,
            ticks: {
              font: {
                size: 10,
                weight: '500',
                family: 'system-ui, -apple-system, sans-serif'
              },
              color: '#64748b',
              padding: 8,
              callback: function(value) {
                // Format based on metric type (Classic View pattern)
                const metric = selectedMetric.value
                if (metric === 'AI_acceptance_rate_percent' || metric === 'acceptance_rate') {
                  return value + '%'
                } else if (metric === 'average_session_length_minutes' || metric === 'AI_usage_duration_minutes' || 
                          metric === 'active_coding_time_minutes' || metric === 'idle_time_minutes' ||
                          metric === 'time_to_first_commit_minutes') {
                  return value + ' min'
                } else if (metric === 'session_depth') {
                  return value + 'h'
                } else if (value >= 1000) {
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
    console.error('Error rendering chart:', error)
  }
}

function getToolMetricValue(toolId, metric) {
  if (toolId in metricsFacadeStore.ideMetrics) {
    const metrics = metricsFacadeStore.ideMetrics[toolId]
    switch (metric) {
      case 'ai_suggestions_accepted': return metrics.AI_suggestions_accepted || 0
      case 'files_edited_per_session': return metrics.files_edited_per_session || 0
      case 'commits_per_session': return metrics.commits_per_session || 0
      case 'average_session_length_minutes': return metrics.average_session_length_minutes || 0
      case 'time_to_first_commit_minutes': return metrics.time_to_first_commit_minutes || 0
      case 'AI_usage_duration_minutes': return metrics.AI_usage_duration_minutes || 0
      case 'active_coding_time_minutes': return metrics.active_coding_time_minutes || 0
      case 'idle_time_minutes': return metrics.idle_time_minutes || 0
      // Legacy metric names for backward compatibility
      case 'ai_output': return metrics.AI_suggestions_accepted || 0
      case 'acceptance_rate': return metrics.AI_acceptance_rate_percent || 0
      case 'session_depth': return (metrics.average_session_length_minutes || 0) / 60
      case 'throughput': return metrics.commits_per_session || 0
      default: return 50
    }
  }
  
  // For AI models, return aggregated values
  const modelMetrics = getModelAggregatedMetrics(toolId)
  switch (metric) {
    case 'ai_suggestions_accepted': return modelMetrics.output || 0
    case 'files_edited_per_session': return modelMetrics.output || 0
    case 'commits_per_session': return modelMetrics.qualityScore || 0
    case 'average_session_length_minutes': return modelMetrics.sessionDepth * 60 || 0
    case 'time_to_first_commit_minutes': return modelMetrics.sessionDepth || 0
    case 'AI_usage_duration_minutes': return modelMetrics.sessionDepth || 0
    case 'active_coding_time_minutes': return modelMetrics.sessionDepth * 0.8 || 0
    case 'idle_time_minutes': return modelMetrics.sessionDepth * 0.2 || 0
    // Legacy metric names for backward compatibility
    case 'ai_output': return modelMetrics.output || 0
    case 'acceptance_rate': return modelMetrics.acceptanceRate || 0
    case 'session_depth': return modelMetrics.sessionDepth || 0
    case 'throughput': return modelMetrics.qualityScore || 0
    default: return 50
  }
}

// Time series data
const timeSeriesData = computed(() => chartModels.value.map(model => model.data))

// Winner calculation for card grid highlighting
const topPerformerId = computed(() => {
  try {
    const tools = displayTools.value
    if (!tools || tools.length === 0) {
      return null
    }
    
    let topTool = tools[0]
    let topValue = getToolMetricValue(topTool.id, selectedMetric.value)
    
    tools.forEach(tool => {
      const value = getToolMetricValue(tool.id, selectedMetric.value)
      if (value > topValue) {
        topTool = tool
        topValue = value
      }
    })
    
    return topTool.id
  } catch (error) {
    return null
  }
})

// Dynamic executive-quality chart titles derived from Dimension, Metric, and Time Window
const chartNarrative = computed(() => {
  try {
    const tools = displayTools.value
    if (!tools || tools.length === 0) {
      return 'No chart data available'
    }
    
    // Find top performer by current metric
    let topTool = tools[0]
    let topValue = getToolMetricValue(topTool.id, selectedMetric.value)
    
    tools.forEach(tool => {
      const value = getToolMetricValue(tool.id, selectedMetric.value)
      if (value > topValue) {
        topTool = tool
        topValue = value
      }
    })
    
    // Get time window context
    const timeWindow = 'last 8 weeks'
    
    // Generate executive-quality titles based on metric type
    const metric = selectedMetric.value
    const dimension = selectedComparisonMode.value
    
    if (metric === 'ai_suggestions_accepted') {
      if (dimension === 'ides') {
        return `${topTool.name} maintained highest focus time with ${Math.round(topValue)} AI suggestions per session`
      } else if (dimension === 'models') {
        return `${topTool.name} sustained highest acceptance rate at ${Math.round(topValue)}% across ${timeWindow}`
      } else {
        return `${topTool.name} generated strongest throughput with ${Math.round(topValue)} AI suggestions per session`
      }
    } else if (metric === 'commits_per_session') {
      if (dimension === 'ides') {
        return `${topTool.name} achieved highest commit velocity at ${topValue.toFixed(1)} commits per session`
      } else if (dimension === 'models') {
        return `${topTool.name} delivered strongest code quality with ${topValue.toFixed(1)} commits per session`
      } else {
        return `${topTool.name} maintained highest delivery efficiency at ${topValue.toFixed(1)} commits per session`
      }
    } else if (metric === 'average_session_length_minutes') {
      if (dimension === 'ides') {
        return `${topTool.name} maintained longest deep-work sessions at ${Math.round(topValue)} minutes average`
      } else if (dimension === 'models') {
        return `${topTool.name} enabled sustained focus time at ${Math.round(topValue)} minutes per session`
      } else {
        return `${topTool.name} achieved strongest session consistency at ${Math.round(topValue)} minutes average`
      }
    } else if (metric === 'time_to_first_commit_minutes') {
      if (dimension === 'ides') {
        return `${topTool.name} achieved fastest onboarding at ${Math.round(topValue)} minutes to first commit`
      } else if (dimension === 'models') {
        return `${topTool.name} accelerated time-to-value at ${Math.round(topValue)} minutes to first commit`
      } else {
        return `${topTool.name} maintained highest development velocity at ${Math.round(topValue)} minutes to first commit`
      }
    } else if (metric === 'AI_acceptance_rate_percent') {
      if (dimension === 'ides') {
        return `${topTool.name} achieved highest AI adoption at ${Math.round(topValue)}% acceptance rate`
      } else if (dimension === 'models') {
        return `${topTool.name} sustained highest code quality at ${Math.round(topValue)}% acceptance rate`
      } else {
        return `${topTool.name} maintained strongest AI integration at ${Math.round(topValue)}% acceptance rate`
      }
    } else {
      // Fallback for other metrics
      if (dimension === 'ides') {
        return `${topTool.name} led performance with ${Math.round(topValue)} ${metric.replace(/_/g, ' ')}`
      } else if (dimension === 'models') {
        return `${topTool.name} achieved highest efficiency with ${Math.round(topValue)} ${metric.replace(/_/g, ' ')}`
      } else {
        return `${topTool.name} maintained strongest performance at ${Math.round(topValue)} ${metric.replace(/_/g, ' ')}`
      }
    }
  } catch (error) {
    return 'Chart analysis unavailable'
  }
})

// ── Executive Signal Summary - Operational Findings ─────────────────────────
const highestAdoptionShift = computed(() => {
  try {
    const tools = displayTools.value
    if (!tools || tools.length === 0) {
      return 'Claude Sonnet 4.6 adoption up 14% WoW'
    }
    
    // Find tool with highest WoW change
    let topTool = tools[0]
    let maxChange = 0
    
    tools.forEach(tool => {
      const currentValue = getToolMetricValue(tool.id, selectedMetric.value)
      const previousValue = currentValue * 0.86 // Simulate WoW change
      const change = ((currentValue - previousValue) / previousValue) * 100
      
      if (change > maxChange) {
        maxChange = change
        topTool = tool
      }
    })
    
    return `${topTool.name} adoption up ${Math.round(maxChange)}% WoW`
  } catch (error) {
    return 'Claude Sonnet 4.6 adoption up 14% WoW'
  }
})

const largestThroughputGain = computed(() => {
  try {
    const tools = displayTools.value
    const currentMetric = selectedMetric.value
    if (!tools || tools.length === 0) {
      return 'No data available'
    }
    
    // Find tool with highest value for selected metric
    let topTool = tools[0]
    let maxGain = 0
    
    tools.forEach(tool => {
      const value = getToolMetricValue(tool.id, currentMetric)
      if (value > maxGain) {
        maxGain = value
        topTool = tool
      }
    })
    
    const metricLabel = getMetricLabel(currentMetric)
    return `${topTool.name} at ${Math.round(maxGain)} ${metricLabel}`
  } catch (error) {
    return 'Error loading data'
  }
})

const highestAcceptanceRate = computed(() => {
  try {
    const tools = displayTools.value
    // FIXED METRIC: Always use AI_acceptance_rate_percent for semantic correctness
    const fixedMetric = 'AI_acceptance_rate_percent'
    if (!tools || tools.length === 0) {
      return 'No data available'
    }
    
    // Find tool with highest acceptance rate
    let topTool = tools[0]
    let maxRate = 0
    
    tools.forEach(tool => {
      const value = getToolMetricValue(tool.id, fixedMetric)
      if (value > maxRate) {
        maxRate = value
        topTool = tool
      }
    })
    
    return `${topTool.name} at ${Math.round(maxRate)}% acceptance rate`
  } catch (error) {
    return 'Error loading data'
  }
})

const deepestSessionDepth = computed(() => {
  try {
    const tools = displayTools.value
    // FIXED METRIC: Always use average_session_length_minutes for semantic correctness
    const fixedMetric = 'average_session_length_minutes'
    if (!tools || tools.length === 0) {
      return 'No data available'
    }
    
    // Find tool with deepest session depth
    let topTool = tools[0]
    let maxDepth = 0
    
    tools.forEach(tool => {
      const value = getToolMetricValue(tool.id, fixedMetric)
      if (value > maxDepth) {
        maxDepth = value
        topTool = tool
      }
    })
    
    return `${topTool.name} at ${Math.round(maxDepth)} minutes/session`
  } catch (error) {
    return 'Error loading data'
  }
})

const strongestThroughput = computed(() => {
  try {
    const tools = displayTools.value
    const currentMetric = selectedMetric.value
    if (!tools || tools.length === 0) {
      return 'No data available'
    }
    
    // Find tool with highest value for selected metric
    let topTool = tools[0]
    let maxThroughput = 0
    
    tools.forEach(tool => {
      const value = getToolMetricValue(tool.id, currentMetric)
      if (value > maxThroughput) {
        maxThroughput = value
        topTool = tool
      }
    })
    
    const metricLabel = getMetricLabel(currentMetric)
    return `${topTool.name} at ${Math.round(maxThroughput)} ${metricLabel}`
  } catch (error) {
    return 'Error loading data'
  }
})

const highestOutput = computed(() => {
  try {
    const tools = displayTools.value
    const currentMetric = selectedMetric.value
    if (!tools || tools.length === 0) {
      return 'No data available'
    }
    
    // Find tool with highest value for selected metric
    let topTool = tools[0]
    let maxOutput = 0
    
    tools.forEach(tool => {
      const value = getToolMetricValue(tool.id, currentMetric)
      if (value > maxOutput) {
        maxOutput = value
        topTool = tool
      }
    })
    
    const metricLabel = getMetricLabel(currentMetric)
    return `${topTool.name} at ${Math.round(maxOutput)} ${metricLabel}`
  } catch (error) {
    return 'Error loading data'
  }
})

const strongestDeliveryEfficiency = computed(() => {
  try {
    const tools = displayTools.value
    // FIXED METRIC: Always use commits_per_session for semantic correctness
    const fixedMetric = 'commits_per_session'
    if (!tools || tools.length === 0) {
      return 'No data available'
    }
    
    // Find tool with strongest delivery efficiency
    let topTool = tools[0]
    let maxEfficiency = 0
    
    tools.forEach(tool => {
      const value = getToolMetricValue(tool.id, fixedMetric)
      if (value > maxEfficiency) {
        maxEfficiency = value
        topTool = tool
      }
    })
    
    return `${topTool.name} at ${maxEfficiency.toFixed(1)} commits/session`
  } catch (error) {
    return 'Error loading data'
  }
})

// ── Phase Operational Summary Functions ───────────────────────────────────────
function getPhaseTopWorkflow(phaseId) {
  try {
    const currentMetric = selectedMetric.value
    // Use allTools for mode-independent executive summary
    const tools = allTools.value
    
    if (!tools || tools.length === 0) {
      return 'No data available'
    }
    
    switch (phaseId) {
      case 'top-ide':
        // Filter allTools for IDEs (mode-independent)
        const ideTools = tools.filter(tool => 
          tool.type.includes('IDE') || tool.type.includes('AI-Native')
        )
        if (ideTools && ideTools.length > 0) {
          let topTool = ideTools[0]
          let topValue = getToolMetricValue(topTool.id, currentMetric)
          
          for (const tool of ideTools) {
            const value = getToolMetricValue(tool.id, currentMetric)
            if (value > topValue) {
              topTool = tool
              topValue = value
            }
          }
          const metricLabel = getMetricLabel(currentMetric)
          return `${topTool.name} generated the highest ${metricLabel} during the selected period`
        }
        return 'No IDE data available'
        
      case 'top-model':
        // Filter allTools for AI Models (mode-independent)
        const modelTools = tools.filter(tool => tool.type === 'AI Model')
        if (modelTools && modelTools.length > 0) {
          let topTool = modelTools[0]
          let topValue = getToolMetricValue(topTool.id, currentMetric)
          
          for (const tool of modelTools) {
            const value = getToolMetricValue(tool.id, currentMetric)
            if (value > topValue) {
              topTool = tool
              topValue = value
            }
          }
          const metricLabel = getMetricLabel(currentMetric)
          return `${topTool.name} maintained the strongest ${metricLabel} across active coding sessions`
        }
        return 'No model data available'
        
      case 'top-workflow':
        // Generate workflows from allTools (mode-independent)
        const workflowTools = []
        Object.keys(CANONICAL_IDES).forEach(ideId => {
          const ideTool = tools.find(tool => tool.id === ideId)
          if (ideTool) {
            workflowTools.push({
              ...ideTool,
              id: `${ideId}-${IDE_TO_MODEL_MAP[ideId] || 'unknown'}`,
              name: getCanonicalWorkflowIdentity(ideId),
              type: 'Workflow'
            })
          }
        })
        
        if (workflowTools && workflowTools.length > 0) {
          let topTool = workflowTools[0]
          let topValue = getToolMetricValue(topTool.id, currentMetric)
          
          for (const tool of workflowTools) {
            const value = getToolMetricValue(tool.id, currentMetric)
            if (value > topValue) {
              topTool = tool
              topValue = value
            }
          }
          const metricLabel = getMetricLabel(currentMetric)
          return `${topTool.name} delivered the highest ${metricLabel} across the engineering organization`
        }
        return 'No workflow data available'
        
      default:
        return 'No data available'
    }
  } catch (error) {
    console.error('Error in getPhaseTopWorkflow:', error)
    return 'Error loading data'
  }
}

function getPhaseSignal(phaseId) {
  try {
    const currentMetric = selectedMetric.value
    // Use allTools for mode-independent executive summary
    const tools = allTools.value
    
    if (!tools || tools.length === 0) {
      return 'No data available'
    }
    
    switch (phaseId) {
      case 'top-ide':
        const ideTools = tools.filter(tool => 
          tool.type.includes('IDE') || tool.type.includes('AI-Native')
        )
        if (ideTools && ideTools.length > 0) {
          let topTool = ideTools[0]
          let topValue = getToolMetricValue(topTool.id, currentMetric)
          
          for (const tool of ideTools) {
            const value = getToolMetricValue(tool.id, currentMetric)
            if (value > topValue) {
              topTool = tool
              topValue = value
            }
          }
          const metricLabel = getMetricLabel(currentMetric)
          return `Consistently outperformed with ${Math.round(topValue)} ${metricLabel}`
        }
        return 'No IDE data available'
        
      case 'top-model':
        const modelTools = tools.filter(tool => tool.type === 'AI Model')
        if (modelTools && modelTools.length > 0) {
          let topTool = modelTools[0]
          let topValue = getToolMetricValue(topTool.id, currentMetric)
          
          for (const tool of modelTools) {
            const value = getToolMetricValue(tool.id, currentMetric)
            if (value > topValue) {
              topTool = tool
              topValue = value
            }
          }
          const metricLabel = getMetricLabel(currentMetric)
          return `Achieved ${Math.round(topValue)} ${metricLabel} with consistent quality`
        }
        return 'No model data available'
        
      case 'top-workflow':
        // Generate workflows from allTools (mode-independent)
        const workflowTools = []
        Object.keys(CANONICAL_IDES).forEach(ideId => {
          const ideTool = tools.find(tool => tool.id === ideId)
          if (ideTool) {
            workflowTools.push({
              ...ideTool,
              id: `${ideId}-${IDE_TO_MODEL_MAP[ideId] || 'unknown'}`,
              name: getCanonicalWorkflowIdentity(ideId),
              type: 'Workflow'
            })
          }
        })
        
        if (workflowTools && workflowTools.length > 0) {
          let topTool = workflowTools[0]
          let topValue = getToolMetricValue(topTool.id, currentMetric)
          
          for (const tool of workflowTools) {
            const value = getToolMetricValue(tool.id, currentMetric)
            if (value > topValue) {
              topTool = tool
              topValue = value
            }
          }
          const metricLabel = getMetricLabel(currentMetric)
          return `Delivered ${Math.round(topValue)} ${metricLabel} with strong operational efficiency`
        }
        return 'No workflow data available'
        
      default:
        return 'No data available'
    }
  } catch (error) {
    console.error('Error in getPhaseSignal:', error)
    return 'Error loading data'
  }
}

function getPhaseKPI(phaseId) {
  try {
    const currentMetric = selectedMetric.value
    // Use allTools for mode-independent executive summary
    const tools = allTools.value
    
    if (!tools || tools.length === 0) {
      return 'No data available'
    }
    
    switch (phaseId) {
      case 'top-ide':
        const ideTools = tools.filter(tool => 
          tool.type.includes('IDE') || tool.type.includes('AI-Native')
        )
        if (ideTools && ideTools.length > 0) {
          let topTool = ideTools[0]
          let topValue = getToolMetricValue(topTool.id, currentMetric)
          
          for (const tool of ideTools) {
            const value = getToolMetricValue(tool.id, currentMetric)
            if (value > topValue) {
              topTool = tool
              topValue = value
            }
          }
          const metricLabel = getMetricLabel(currentMetric)
          return `${topTool.name}: ${Math.round(topValue)} ${metricLabel} (top performer)`
        }
        return 'No IDE data available'
        
      case 'top-model':
        const modelTools = tools.filter(tool => tool.type === 'AI Model')
        if (modelTools && modelTools.length > 0) {
          let topTool = modelTools[0]
          let topValue = getToolMetricValue(topTool.id, currentMetric)
          
          for (const tool of modelTools) {
            const value = getToolMetricValue(tool.id, currentMetric)
            if (value > topValue) {
              topTool = tool
              topValue = value
            }
          }
          const metricLabel = getMetricLabel(currentMetric)
          return `${topTool.name}: ${Math.round(topValue)} ${metricLabel} (leading model)`
        }
        return 'No model data available'
        
      case 'top-workflow':
        // Generate workflows from allTools (mode-independent)
        const workflowTools = []
        Object.keys(CANONICAL_IDES).forEach(ideId => {
          const ideTool = tools.find(tool => tool.id === ideId)
          if (ideTool) {
            workflowTools.push({
              ...ideTool,
              id: `${ideId}-${IDE_TO_MODEL_MAP[ideId] || 'unknown'}`,
              name: getCanonicalWorkflowIdentity(ideId),
              type: 'Workflow'
            })
          }
        })
        
        if (workflowTools && workflowTools.length > 0) {
          let topTool = workflowTools[0]
          let topValue = getToolMetricValue(topTool.id, currentMetric)
          
          for (const tool of workflowTools) {
            const value = getToolMetricValue(tool.id, currentMetric)
            if (value > topValue) {
              topTool = tool
              topValue = value
            }
          }
          const metricLabel = getMetricLabel(currentMetric)
          return `${topTool.name}: ${Math.round(topValue)} ${metricLabel} (highest efficiency)`
        }
        return 'No workflow data available'
        
      default:
        return 'No data available'
    }
  } catch (error) {
    console.error('Error in getPhaseKPI:', error)
    return 'Error loading data'
  }
}

// ── Top Performers (aligned with page purpose) ───────────────────────────────
// Static metadata only - all dynamic values computed by getPhaseTopWorkflow, getPhaseSignal, getPhaseKPI
const operationalPhases = reactive([
  {
    id: 'top-ide', name: 'Top IDE', sub: 'Highest Performing Development Environment',
    emoji: '💻', color: '#3b82f6'
  },
  {
    id: 'top-model', name: 'Top AI Model', sub: 'Highest Performing AI Assistant',
    emoji: '🤖', color: '#6366f1'
  },
  {
    id: 'top-workflow', name: 'Top Workflow', sub: 'Most Effective AI-Enhanced Workflow',
    emoji: '⚡', color: '#22c55e'
  },
])

// ── Lifecycle ─────────────────────────────────────────────────────────────
onMounted(() => {
  try {
    // Initialize chart after component is mounted
    nextTick(() => {
      renderChart()
    })
  } catch (error) {
    console.error('Error during component mount:', error)
  }
})

onUnmounted(() => {
  try {
    // Clean up chart instance
    if (chartInstance) {
      chartInstance.destroy()
      chartInstance = null
    }
  } catch (error) {
    console.error('Error during component unmount:', error)
  }
})

// Watch for data changes with debouncing (Classic View pattern)
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
        renderChart()
      }
    } catch (error) {
      console.error('Error in debounced chart update:', error)
    }
  }, 150) // 150ms debounce
}, { deep: true })

// Watch for data changes and re-render chart
watch([displayTools, selectedMetric, selectedComparisonMode], () => {
  try {
    nextTick(() => {
      renderChart()
    })
  } catch (error) {
    console.error('Error during data change watch:', error)
  }
}, { deep: true })

// Watch for view changes to render chart when switching to time series
watch(selectedView, (newView) => {
  try {
    if (newView === 'timeseries') {
      nextTick(() => {
        renderChart()
      })
    }
  } catch (error) {
    console.error('Error during view change watch:', error)
  }
})
</script>

<style scoped>
/* ── Root ─────────────────────────────────────────────────────────────────── */
.productivity-next-gen {
  font-family: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif;
  background: #ffffff;
  color: #1e293b;
  min-height: 100vh;
  padding: 0 0 40px;
}

/* ── Context Bar ─────────────────────────────────────────────────────────── */
.pbt-context-bar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
  position: sticky; top: 0; z-index: 10; backdrop-filter: blur(8px);
}
.pbt-context-left {
  display: flex; align-items: center; gap: 20px;
}
.pbt-status-indicator {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 600; color: #1e293b;
}
.pbt-metrics-summary {
  font-size: 11px; color: #64748b; font-weight: 500;
}
.pbt-dot {
  width: 6px; height: 6px; border-radius: 50%;
}
.pbt-dot--live { background: #22c55e; animation: pulse 2s infinite; }
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.pbt-context-right {
  display: flex; align-items: center;
}
.pbt-signal-badge {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; background: #22c55e18; color: #16a34a;
  border: 1px solid #22c55e40; border-radius: 6px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
}

/* ── Ticker ──────────────────────────────────────────────────────────────── */
.pbt-ticker {
  display: flex; align-items: center; gap: 0;
  background: #f8fafc; border-bottom: 1px solid #e2e8f0;
  overflow: hidden; height: 34px;
}
.pbt-ticker-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
  color: #6366f1; background: #f1f5f9;
  border-right: 1px solid #e2e8f0;
  padding: 0 14px; height: 100%; white-space: nowrap; flex-shrink: 0;
}
.pbt-ticker-scroll-wrap { flex: 1; overflow: hidden; }
.pbt-ticker-scroll {
  display: flex; align-items: center; gap: 0;
  white-space: nowrap;
  animation: ticker 32s linear infinite;
}
@keyframes ticker { from { transform: translateX(0) } to { transform: translateX(-50%) } }
.pbt-ticker-item { font-size: 11.5px; color: #64748b; padding: 0 20px; }
.pbt-ticker-sep { color: #cbd5e1; }
.pbt-ticker-model { font-weight: 700; font-size: 11px; padding: 1px 6px; border-radius: 3px; margin-right: 5px; }
.pbt-ticker-model--sonnet { background: #6366f120; color: #6366f1; }
.pbt-ticker-model--swe { background: #f472b620; color: #f472b6; }
.pbt-ticker-model--gpt { background: #3b82f620; color: #3b82f6; }
.pbt-ticker-model--cursor { background: #2563eb20; color: #2563eb; }
.pbt-ticker-model--windsurf { background: #0891b220; color: #0891b2; }
.pbt-ticker-model--vscode { background: #47556920; color: #475569; }
.pbt-ticker-model--jetbrains { background: #5c524720; color: #5c5247; }
.pbt-ticker-model--sublime { background: #f59e0b20; color: #f59e0b; }
.pbt-ticker-model--vim { background: #10b98120; color: #10b981; }
.pbt-ticker-model--gemini { background: #8b5cf620; color: #8b5cf6; }

/* ── View Header ─────────────────────────────────────────────────────────── */
.pbt-view-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 12px 24px 8px;
  flex-wrap: wrap; gap: 8px;
}

.pbt-view-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pbt-section-title { font-size: 15px; font-weight: 700; color: #1e293b; margin: 0; }
.pbt-section-sub { font-size: 11px; color: #64748b; margin: 0; }
.pbt-view-controls { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.pbt-toggle-group {
  display: flex; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 7px; overflow: hidden;
}
.pbt-toggle {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 14px; font-size: 12.5px; font-weight: 500;
  background: none; border: none; color: #64748b; cursor: pointer;
  transition: all 0.15s;
}
.pbt-toggle--active { background: #e2e8f0; color: #1e293b; }
.pbt-select {
  background: #f1f5f9; border: 1px solid #e2e8f0;
  border-radius: 6px; color: #64748b; font-size: 11px;
  padding: 6px 10px; cursor: pointer; outline: none;
}

/* ── Cards Section ───────────────────────────────────────────────────────── */
.pbt-cards-section { padding: 12px 24px 0; }

/* ── Stage Icon Wrapper (match Performance Insights) ───────────────────── */
.stage-icon-wrapper {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.pbt-ai-callout {
  display: flex; align-items: center; gap: 6px;
  background: #f1f5f9; border: 1px solid #6366f130;
  border-left: 3px solid #6366f1;
  color: #64748b; font-size: 11px;
  padding: 7px 12px; border-radius: 5px;
  margin-bottom: 12px;
}

.pbt-tool-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 8px;
}
@media (max-width: 900px) { .pbt-tool-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .pbt-tool-grid { grid-template-columns: 1fr; } }

/* Tool Card */
.pbt-tool-card {
  background: #ffffff; border: 1px solid #e2e8f0;
  border-radius: 8px; padding: 12px;
  cursor: pointer; transition: border-color 0.2s, box-shadow 0.2s;
  display: flex; flex-direction: column; gap: 10px;
}
.pbt-tool-card:hover { border-color: #cbd5e1; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
.pbt-tool-card--selected { border-color: #6366f1; box-shadow: 0 0 0 1px #6366f140; }
.pbt-tool-card--winner { border-color: #22c55e; box-shadow: 0 0 0 2px #22c55e40; }

.pbt-tc-header { display: flex; justify-content: space-between; align-items: flex-start; }
.pbt-tc-identity { display: flex; align-items: center; gap: 8px; }
.pbt-tc-icon {
  width: 32px; height: 32px; border-radius: 6px; border: 1px solid;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; flex-shrink: 0;
}
.pbt-tc-name { font-size: 13px; font-weight: 700; color: #1e293b; }
.pbt-tc-type { font-size: 10px; color: #64748b; margin-top: 1px; }
.pbt-tc-models { font-size: 9px; color: #6366f1; margin-top: 2px; }
.pbt-tc-model-label { font-weight: 600; margin-right: 2px; }
.pbt-tc-model-name { font-weight: 500; }

.pbt-tc-tier-badge {
  font-size: 9px; font-weight: 800; letter-spacing: 0.08em;
  padding: 2px 6px; border-radius: 3px;
}
.pbt-tc-tier-badge--top { background: #22c55e18; color: #16a34a; border: 1px solid #22c55e40; }
.pbt-tc-tier-badge--high { background: #f59e0b18; color: #d97706; border: 1px solid #f59e0b40; }
.pbt-tc-tier-badge--mid { background: #3b82f618; color: #2563eb; border: 1px solid #3b82f640; }
.pbt-tc-tier-badge--low { background: #64748b18; color: #475569; border: 1px solid #64748b40; }

.pbt-tc-primary { display: flex; flex-direction: column; gap: 2px; }
.pbt-tc-output-label { font-size: 9.5px; font-weight: 700; letter-spacing: 0.1em; color: #64748b; }
.pbt-tc-output-value { font-size: 36px; font-weight: 800; color: #1e293b; line-height: 1; }
.pbt-tc-sessions { font-size: 11px; color: #64748b; }

.pbt-tc-divider { height: 1px; background: #e2e8f0; }

.pbt-tc-metrics { display: flex; flex-direction: column; gap: 7px; }
.pbt-tc-metric { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
.pbt-tc-metric-val { font-weight: 700; color: #64748b; }
.pbt-tc-metric-label { color: #64748b; }

.pbt-tc-spark { width: 100%; }
.pbt-spark-svg { width: 100%; height: 32px; overflow: visible; }

.pbt-tc-bottom { font-size: 11px; font-weight: 600; padding: 5px 0 0; border-top: 1px solid #e2e8f0; }
.pbt-tc-bottom--positive { color: #16a34a; }
.pbt-tc-bottom--warning { color: #d97706; }
.pbt-tc-bottom--neutral { color: #2563eb; }
.pbt-tc-bottom--muted { color: #64748b; }

/* Colors */
.pbt-up { color: #16a34a; }
.pbt-down { color: #dc2626; }

.pbt-footnote {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: #64748b;
  padding: 8px 0 4px;
}

/* ── Executive Signal Summary ─────────────────────────────────────────────── */
.pbt-executive-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 16px 24px 0;
  margin-bottom: 16px;
}

.pbt-summary-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 12px 16px;
  position: relative;
  overflow: hidden;
}

.pbt-summary-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: #f1f5f9;
}

.pbt-summary-card--top-performer::before {
  background: linear-gradient(90deg, #10b981 0%, #34d399 100%);
}

.pbt-summary-card--fastest-mover::before {
  background: linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%);
}

.pbt-summary-card--operational-risk::before {
  background: linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%);
}

.pbt-summary-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 4px;
}

.pbt-summary-value {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  line-height: 1.3;
}

/* ── Time Series Section ─────────────────────────────────────────────────── */
.pbt-ts-section { padding: 16px 24px 0; }
.pbt-ts-callout {
  display: flex; align-items: center; gap: 7px;
  background: #f1f5f9; border: 1px solid #6366f130;
  border-left: 3px solid #6366f1;
  color: #64748b; font-size: 12px;
  padding: 9px 14px; border-radius: 6px;
  margin-bottom: 16px;
}

.pbt-ts-chart-card {
  background: #ffffff; border: 1px solid #e2e8f0;
  border-radius: 10px; padding: 20px;
}

.pbt-ts-legend {
  display: flex; gap: 16px; margin-bottom: 16px;
}
.pbt-ts-legend-item {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: #64748b;
}
.pbt-ts-legend-dot {
  width: 8px; height: 8px; border-radius: 50%;
}

.pbt-ts-chart-container {
  min-height: 300px; border: 1px solid #e2e8f0; border-radius: 6px;
  background: #fafbfc; padding: 16px;
}

.pbt-ts-chart-container .chart-container {
  width: 100%;
  height: 300px;
  position: relative;
}

.pbt-ts-chart-container .empty-state {
  min-height: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f8fafc;
  border-radius: 6px;
  border: 1px dashed #e2e8f0;
}

.pbt-ts-chart-container canvas {
  max-height: 300px;
}

.pbt-ts-footnote {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: #64748b;
  margin-top: 12px; padding-top: 12px; border-top: 1px solid #f1f5f9;
}

/* ── Phase Sections ───────────────────────────────────────────────────────── */
.pbt-phases { padding: 16px 24px 0; }
.pbt-phase {
  background: #ffffff; border: 1px solid #e2e8f0;
  border-radius: 10px; margin-bottom: 12px;
  overflow: hidden;
}

/* Compact Phase Summary */
.pbt-phase-summary {
  display: grid;
  grid-template-columns: 280px 1fr 1fr 1fr;
  gap: 20px;
  padding: 16px 20px;
  align-items: center;
}

.pbt-phase-identity {
  display: flex; align-items: center; gap: 12px;
}
.pbt-phase-icon {
  width: 40px; height: 40px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; color: white;
}
.pbt-phase-name { font-size: 14px; font-weight: 700; color: #1e293b; }
.pbt-phase-sub { font-size: 11px; color: #64748b; margin-top: 1px; }

/* Phase Section Components */
.pbt-phase-top-workflow,
.pbt-phase-signal,
.pbt-phase-kpi {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pbt-phase-section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94a3b8;
}

.pbt-phase-section-value {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  line-height: 1.3;
}

/* Responsive adjustments */
@media (max-width: 1024px) {
  .pbt-phase-summary {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  
  .pbt-phase-identity {
    grid-column: 1;
  }
  
  .pbt-phase-top-workflow,
  .pbt-phase-signal,
  .pbt-phase-kpi {
    grid-column: 1;
  }
}

.pbt-insights-strip {
  border-top: 1px solid #f1f5f9; padding: 12px 20px;
}
.pbt-insights-strip-header {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: #6366f1;
  margin-bottom: 8px;
}
.pbt-insights-count { background: #6366f118; color: #6366f1; padding: 2px 6px; border-radius: 3px; }
.pbt-insight-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: #64748b; padding: 4px 0;
}
.pbt-ins-model { font-weight: 700; font-size: 11px; padding: 2px 6px; border-radius: 3px; }
.pbt-ins-model--sonnet { background: #6366f120; color: #6366f1; }
.pbt-ins-model--gpt { background: #3b82f620; color: #3b82f6; }
.pbt-ins-model--swe { background: #f472b620; color: #f472b6; }
.pbt-ins-model--dora { background: #22c55e20; color: #16a34a; }
.pbt-ins-model--flow { background: #f59e0b20; color: #d97706; }

.pbt-metrics-section {
  border-top: 1px solid #f1f5f9; padding: 12px 20px;
}
.pbt-metrics-header {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: #64748b;
  margin-bottom: 12px;
}
.pbt-metrics-count { background: #f1f5f9; color: #64748b; padding: 2px 6px; border-radius: 3px; }
.pbt-metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}
.pbt-metric-card {
  background: #f8fafc; border: 1px solid #e2e8f0;
  border-radius: 8px; padding: 12px;
}
.pbt-metric-card-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 8px;
}
.pbt-metric-icon { font-size: 16px; }
.pbt-metric-tag {
  font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
  padding: 2px 6px; border-radius: 3px;
}
.pbt-metric-tag--live { background: #22c55e18; color: #16a34a; }
.pbt-metric-value { font-size: 20px; font-weight: 800; color: #1e293b; margin-bottom: 4px; }
.pbt-metric-change { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
.pbt-metric-label { font-size: 11px; color: #64748b; }

/* ── Bottom Actions ───────────────────────────────────────────────────────── */
.pbt-bottom-bar {
  display: flex; justify-content: center; gap: 12px;
  padding: 24px;
}
.pbt-create-btn, .pbt-reset-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 600;
  border: 1px solid #e2e8f0; background: #ffffff; color: #64748b;
  cursor: pointer; transition: all 0.15s;
}
.pbt-create-btn:hover, .pbt-reset-btn:hover {
  background: #f8fafc; border-color: #cbd5e1;
}
.pbt-create-btn {
  background: #6366f1; color: white; border-color: #6366f1;
}
.pbt-create-btn:hover {
  background: #5558e3; border-color: #5558e3;
}

/* ── Chart-First Hierarchy Styles ───────────────────────────────────────────── */
.pbt-ts-section.chart-dominant {
  padding: 1rem;
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid #f1f5f9;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.pbt-ts-minimal-header {
  margin-bottom: 1rem;
  text-align: center;
}

.pbt-ts-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1e293b;
  line-height: 1.4;
}

.pbt-ts-chart-dominant {
  position: relative;
  min-height: 400px;
  background: #ffffff;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  padding: 1rem;
  margin-bottom: 1rem;
}

.chart-container-dominant {
  position: relative;
  height: 380px;
  width: 100%;
}

.chart-container-dominant canvas {
  max-height: 380px !important;
}

.pbt-ts-minimal-footer {
  text-align: center;
  padding-top: 0.5rem;
  border-top: 1px solid #f1f5f9;
}

/* Hide competing elements when chart is dominant */
.chart-dominant .pbt-phases {
  display: none;
}

.chart-dominant .pbt-executive-summary {
  display: none;
}

.chart-dominant .pbt-context-bar {
  display: none;
}

/* Responsive adjustments for chart dominance */
@media (max-width: 768px) {
  .pbt-ts-chart-dominant {
    min-height: 300px;
  }
  
  .chart-container-dominant {
    height: 280px;
  }
  
  .chart-container-dominant canvas {
    max-height: 280px !important;
  }
}

/* ── Performance Insights Visual Continuity ─────────────────────────────────── */
.pbt-container {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  line-height: 1.5;
  color: #1e293b;
}

/* Enterprise spacing system */
.pbt-section {
  padding: 1.5rem 0;
}

.pbt-subsection {
  padding: 1rem 0;
}

.pbt-compact {
  padding: 0.75rem 0;
}

/* Typography hierarchy matching Performance Insights */
.pbt-h1 {
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.25;
  color: #0f172a;
  margin-bottom: 1rem;
}

.pbt-h2 {
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.25;
  color: #1e293b;
  margin-bottom: 0.75rem;
}

.pbt-h3 {
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.25;
  color: #334155;
  margin-bottom: 0.5rem;
}

.pbt-body {
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.5;
  color: #475569;
}

.pbt-small {
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.4;
  color: #64748b;
}

.pbt-caption {
  font-size: 0.625rem;
  font-weight: 500;
  line-height: 1.4;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Enterprise color palette */
.pbt-surface {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.pbt-surface-elevated {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
}

.pbt-surface-muted {
  background: #f8fafc;
  border: 1px solid #f1f5f9;
  border-radius: 6px;
}

/* Enterprise density adjustments */
.pbt-dense {
  gap: 0.5rem;
}

.pbt-comfortable {
  gap: 1rem;
}

.pbt-spacious {
  gap: 1.5rem;
}

/* Executive summary treatment */
.pbt-executive-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 1rem;
  position: relative;
  overflow: hidden;
}

.pbt-executive-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #3b82f6 0%, #6366f1 100%);
}

.pbt-executive-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
  margin-bottom: 0.5rem;
}

.pbt-executive-value {
  font-size: 1.125rem;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.2;
}

.pbt-executive-subtitle {
  font-size: 0.75rem;
  font-weight: 400;
  color: #64748b;
  margin-top: 0.25rem;
}

/* Consistent with Performance Insights metrics styling */
.pbt-metric-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 0.75rem;
  transition: all 0.15s ease;
}

.pbt-metric-card:hover {
  border-color: #cbd5e1;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.pbt-metric-label {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
  margin-bottom: 0.25rem;
}

.pbt-metric-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.2;
}

.pbt-metric-change {
  font-size: 0.75rem;
  font-weight: 500;
  margin-top: 0.25rem;
}

.pbt-metric-change--positive {
  color: #059669;
}

.pbt-metric-change--negative {
  color: #dc2626;
}

.pbt-metric-change--neutral {
  color: #64748b;
}

/* ── Operational Ticker Styles ─────────────────────────────────────────── */
.pbt-ticker {
  display: flex; align-items: center; gap: 0;
  background: #f8fafc; border-bottom: 1px solid #e2e8f0;
  overflow: hidden; height: 36px;
}

.pbt-ticker-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
  color: #6366f1; background: #f1f5f9;
  border-right: 1px solid #e2e8f0;
  padding: 0 14px; height: 100%; white-space: nowrap; flex-shrink: 0;
}

.pbt-ticker-scroll-wrap { flex: 1; overflow: hidden; }
.pbt-ticker-scroll {
  display: flex; align-items: center; gap: 0;
  white-space: nowrap;
  animation: ticker 30s linear infinite;
}

@keyframes ticker { 
  from { transform: translateX(0) } 
  to { transform: translateX(-50%) } 
}

.pbt-ticker-item { 
  font-size: 11.5px; 
  color: #475569; 
  padding: 0 20px; 
}

.pbt-ticker-sep { 
  color: #cbd5e1; 
  font-weight: bold;
}

.pbt-ticker-model { 
  font-weight: 700; 
  font-size: 11px; 
  padding: 2px 6px; 
  border-radius: 4px; 
  margin-right: 6px; 
}

.pbt-ticker-model--sonnet { 
  background: #e0e7ff; 
  color: #6366f1; 
}

.pbt-ticker-model--swe { 
  background: #fce7f3; 
  color: #ec4899; 
}

.pbt-ticker-model--gpt { 
  background: #dbeafe; 
  color: #3b82f6; 
}

.pbt-ticker-model--cursor { 
  background: #f3e8ff; 
  color: #9333ea; 
}

.pbt-ticker-model--windsurf { 
  background: #fef3c7; 
  color: #f59e0b; 
}

/* ── Narrative Banner Styles ─────────────────────────────────────────── */
.pbt-narrative-banner {
  display: flex; align-items: center; gap: 8px;
  background: #f8fafc; border: 1px solid #e2e8f0;
  border-left: 3px solid #6366f1;
  color: #475569; font-size: 13px; font-weight: 500;
  padding: 12px 20px; margin: 16px 24px;
  border-radius: 8px;
}
</style>
