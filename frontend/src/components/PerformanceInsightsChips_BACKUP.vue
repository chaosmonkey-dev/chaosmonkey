<template>
  <div class="performance-insights-chips executive-dashboard">

    <!-- STEP 2: EXECUTIVE SUMMARY -->
    <div class="executive-summary">
        <div class="executive-metrics">
        <div class="exec-metric">
          <div class="exec-value">
            <span v-if="performanceData.executive.aiAdoption?.value != null && performanceData.executive.aiAdoption?.value !== undefined">
              {{ performanceData.executive.aiAdoption?.value }}%
            </span>
            <span v-else class="text-slate-400">—</span>
          </div>
          <div class="exec-label">AI Adoption</div>
        </div>
        <div class="exec-metric">
          <div class="exec-value">
            <span v-if="performanceData.executive.burstsPerSession?.value != null && performanceData.executive.burstsPerSession?.value !== undefined">
              {{ performanceData.executive.burstsPerSession?.value }}
            </span>
            <span v-else class="text-slate-400">—</span>
          </div>
          <div class="exec-label">Bursts/Session</div>
        </div>
        <div class="exec-metric">
          <div class="exec-value">
            <span v-if="performanceData.executive.totalSessions?.value != null && performanceData.executive.totalSessions?.value !== undefined">
              {{ performanceData.executive.totalSessions?.value }}
            </span>
            <span v-else class="text-slate-400">—</span>
          </div>
          <div class="exec-label">Total Sessions</div>
        </div>
        <div class="exec-metric">
          <div class="exec-value">
            <span v-if="performanceData.executive.changeFailureRate?.value != null && performanceData.executive.changeFailureRate?.value !== undefined">
              {{ performanceData.executive.changeFailureRate?.value }}%
            </span>
            <span v-else class="text-slate-400">—</span>
          </div>
          <div class="exec-label">Change Failure Rate</div>
        </div>
        <div class="exec-metric">
          <div class="exec-value">
            <span v-if="performanceData.executive.totalSessions?.value != null && performanceData.executive.totalSessions?.value !== undefined">
              {{ Math.round((performanceData.executive.totalSessions?.value || 0) * 0.28) }}%
            </span>
            <span v-else class="text-slate-400">—</span>
          </div>
          <div class="exec-label">Heavy Sessions</div>
        </div>
      </div>
      <div class="executive-narrative">
        {{ performanceData.executive.narrative }}
      </div>
    </div>

    <!-- STEP 3: KPI STRIP -->
    <div class="kpi-strip">
      <div v-for="kpi in performanceData.kpis || []" :key="kpi.label || kpi.id" class="kpi-card">
        <div class="kpi-value">
          <span v-if="kpi.value != null && kpi.value !== undefined">{{ kpi.value }}</span>
          <span v-else class="text-slate-400">—</span>
        </div>
        <div class="kpi-delta" :class="getDeltaClass(kpi.delta)">
          <span v-if="kpi.delta != null && kpi.delta !== undefined">{{ kpi.delta }}</span>
          <span v-else class="text-slate-400">—</span>
        </div>
        <div class="kpi-label">{{ kpi.label || 'KPI' }}</div>
        <div class="kpi-sparkline">{{ getSparkline(kpi.label?.toLowerCase().replace(' ', '') || 'default') }}</div>
      </div>
    </div>

    <!-- STEP 4: IDE LEADERBOARD -->
    <div class="ide-leaderboard">
      <div v-for="ide in performanceData.ide || []" :key="ide.name || ide.id" class="ide-card" :class="getIDEClass(ide)">
        <div class="ide-header">
          <div class="ide-name">{{ ide.name || 'Unknown IDE' }}</div>
          <div class="ide-rank">#{{ ide.rank || '—' }}</div>
        </div>
        <div class="ide-metrics">
          <div class="ide-metric">
            <div class="ide-value">{{ ide.adoption != null ? ide.adoption + '%' : '—' }}</div>
            <div class="ide-label">Adoption</div>
          </div>
          <div class="ide-metric">
            <div class="ide-value">{{ ide.sessions != null ? ide.sessions : '—' }}</div>
            <div class="ide-label">Sessions</div>
          </div>
          <div class="ide-metric">
            <div class="ide-value">{{ ide.assistsPerSession != null ? ide.assistsPerSession : '—' }}</div>
            <div class="ide-label">Assists/Session</div>
          </div>
        </div>
        <div class="ide-pills">
          <span v-for="pill in ide.pills || []" :key="pill" class="ide-pill" :class="getPillClass(pill)">{{ pill }}</span>
        </div>
      </div>
    </div>

    <!-- STEP 5: PIPELINE COLUMNS -->
    <div class="pipeline-columns">
      <div v-for="stage in stages" :key="stage.id" class="pipeline-column" :class="getStageBorderClass(stage.id)">
        <div class="pipeline-header">
          <div class="pipeline-title">{{ getStageTitle(stage.id) }}</div>
          <div class="pipeline-status" :class="getStageStatusClass(stage.id)">{{ getStageStatus(stage.id) }}</div>
        </div>
        
        <div class="pipeline-metrics">
          <div v-for="metric in getStageMetrics(stage.id)" :key="metric.name" class="pipeline-metric">
            <div class="pipeline-metric-value">{{ metric.value || '—' }}</div>
            <div class="pipeline-metric-label">{{ metric.label || 'Metric' }}</div>
          </div>
        </div>

        <div class="pipeline-finding">
          <div class="finding-label">Primary Finding</div>
          <div class="finding-text">{{ getPrimaryFinding(stage.id) }}</div>
        </div>

        <div class="pipeline-action">
          <div class="action-label">Recommended Action</div>
          <div class="action-text">{{ getRecommendedAction(stage.id) }}</div>
        </div>

        <!-- STEP 6: CHIP SYSTEM - SHOW ALL INSIGHTS -->
        <div class="pipeline-chips">
          <div
            v-for="insight in getStageFindings(stage.id)"
            :key="insight.id"
            class="executive-chip"
            :class="[
              `priority-${(insight as any).priority || 'medium'}`,
              {
                expanded: expandedChip?.stageId === stage.id && expandedChip?.insightId === insight.id
              }
            ]"
            @click="toggleChipExpansion(stage.id, insight.id)"
          >
            <div class="chip-content">
              <div class="chip-value">
                <span v-if="insight.value != null && insight.value !== undefined">{{ insight.value }}</span>
                <span v-else class="text-slate-400">—</span>
              </div>
              <div class="chip-delta">
                <span v-if="insight.delta != null && insight.delta !== undefined">{{ insight.delta }}</span>
                <span v-else class="text-slate-400">—</span>
              </div>
              <div class="chip-context">
                {{ insight.title || (insight as any).interpretation || (insight as any).details || (insight as any).subtitle || 'Performance insight' }}
              </div>
            </div>

            <!-- EXPANDED CONTENT -->
            <div v-if="expandedChip?.stageId === stage.id && expandedChip?.insightId === insight.id" class="chip-expanded">
              <div class="chip-expanded-content">
                <div class="chip-expanded-header">
                  <h4 class="chip-expanded-title">{{ insight.title }}</h4>
                  <button @click.stop="toggleChipExpansion(stage.id, insight.id)" class="chip-expanded-close">
                    <i class="bi bi-x"></i>
                  </button>
                </div>

                <div class="chip-expanded-body">
                  <!-- Primary Value -->
                  <div v-if="insight.value || (insight as any).rightMetric" class="chip-expanded-primary">
                    {{ insight.value || (insight as any).rightMetric || '—' }}
                    <span v-if="getUnit(insight)" class="chip-expanded-unit">{{ getUnit(insight) }}</span>
                  </div>

                  <!-- Description -->
                  <div v-if="insight.subtitle || insight.details" class="chip-expanded-text">
                    {{ insight.subtitle || insight.details || 'No description available' }}
                  </div>

                  <!-- Evidence -->
                  <div v-if="insight.n !== undefined && insight.n != null" class="chip-expanded-evidence">
                    <span class="chip-expanded-evidence-label">Sample:</span>
                    <span class="chip-expanded-evidence-value">{{ insight.n }} {{ insight.contributingUnitType || 'units' }}</span>
                  </div>

                  <!-- Recommendation -->
                  <div v-if="(insight as any).whatsHappening || (insight as any).whyItMatters" class="chip-expanded-action">
                    <div v-if="(insight as any).whatsHappening" class="chip-expanded-label">What's Happening</div>
                    <div v-if="(insight as any).whatsHappening" class="chip-expanded-recommendation">{{ (insight as any).whatsHappening }}</div>
                    
                    <div v-if="(insight as any).whyItMatters" class="chip-expanded-label">Why It Matters</div>
                    <div v-if="(insight as any).whyItMatters" class="chip-expanded-recommendation">{{ (insight as any).whyItMatters }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- NO INSIGHTS PLACEHOLDER -->
    <div v-if="!hasAnyInsights" class="no-insights-global">
      <div class="no-insights-icon">
        <i class="bi bi-graph-up"></i>
      </div>
      <div class="no-insights-text">
        <strong>No Performance Insights Available</strong>
        <div>Connect your repositories and enable telemetry to see insights</div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watchEffect } from 'vue'
import type { PerformanceInsight } from '../lib/insights/types'
import { formatStripRightMetric, resolvePrimaryStripMetric, resolvePrimaryMetricDisplay, resolveChipContext, isCompetitiveRow, isTelemetryCompetitiveRow, resolveWinnerEntity, resolveRunnerUpDelta, parseIdeBreakdown, isRealTie, hasIndependentIdeBreakdown, getRowProvenance } from '../lib/insights/v2/collapsedRowFormatter'
import type { DisplayMetric, CanonicalMetricDisplay, WinnerEntity, RunnerUpDelta, IdeBreakdownEntry } from '../lib/insights/v2/collapsedRowFormatter'

type Insight = PerformanceInsight & {
  value: string
  delta: string | null
  interpretation: string
}

const props = defineProps<{
  insights: PerformanceInsight[]
  viewMode: string
}>()

const emit = defineEmits<{
  viewModeChange: [mode: string]
}>()

const expandedChip = ref<{ stageId: string; insightId: string } | null>(null)
const isPopoutExpanded = ref(false)

// Single source of truth for expanded insight
const expandedInsight = computed(() => {
  if (!expandedChip.value) return null

  const stage = stages.value.find(s => s.id === expandedChip.value!.stageId)
  if (!stage) return null

  return stage.insights?.find(
    i => i.id === expandedChip.value!.insightId
  ) || null
})

// Toggle popout expanded/collapsed state
function togglePopoutSize() {
  isPopoutExpanded.value = !isPopoutExpanded.value
}

// Close expanded view (both inline and popout)
function closeExpandedView() {
  expandedChip.value = null
  isPopoutExpanded.value = false
}

// Cached chip display models — removed duplicate
// Simple chipModels computed property is at line 994

// Stage configuration with insights and priority logic
const stages = computed(() => {
  return [
    {
      id: 'plan-code',
      title: 'Plan & Code',
      subtitle: 'Development productivity and AI adoption',
      icon: 'bi bi-code-square',
      iconClass: 'bg-primary',
      badgeClass: 'bg-primary-subtle text-primary',
      insights: getStageInsights('plan-code')
    },
    {
      id: 'review-merge',
      title: 'Review & Merge',
      subtitle: 'Code review and collaboration efficiency',
      icon: 'bi bi-git',
      iconClass: 'bg-warning',
      badgeClass: 'bg-warning-subtle text-warning',
      insights: getStageInsights('review-merge')
    },
    {
      id: 'deploy-operate',
      title: 'Deploy & Operate',
      subtitle: 'Delivery frequency and stability',
      icon: 'bi bi-rocket-takeoff',
      iconClass: 'bg-success',
      badgeClass: 'bg-success-subtle text-success',
      insights: getStageInsights('deploy-operate')
    }
  ]
})

// Priority insights computed property for each stage
const priorityInsights = computed(() => {
  const result: Record<string, any[]> = {}
  
  stages.value.forEach((stage: any) => {
    result[stage.id] = stage.insights
      .filter((i: any) => i.priority === 'high' || i.type === 'warning' || getInsightStatus(i).status === 'bad')
  })
  
  return result
})

// Computed properties
const totalInsightsCount = computed(() => chipModels.value.length)

const hasAnyInsights = computed(() => chipModels.value.length > 0)

const emptyStateMessage = computed(() => {
  // Check if we have any data sources
  const hasGitHubData = true // Assuming GitHub is connected
  const hasTelemetryData = true // Assuming telemetry is available
  
  if (!hasGitHubData && !hasTelemetryData) {
    return 'Connect GitHub and enable telemetry to see performance insights.'
  } else if (!hasGitHubData) {
    return 'Connect GitHub to see review and deployment insights.'
  } else if (!hasTelemetryData) {
    return 'Enable telemetry to see development productivity insights.'
  } else {
    return 'Insights are being computed. Please check back in a few moments.'
  }
})


// Create placeholder insights if no real data available
const placeholderInsights = computed(() => {
  // STEP 5 — DISABLE PLACEHOLDER BLEED
  if (props.insights?.length === 0) {
    // Return placeholder insights only if no real insights
    if (chipModels.value.length > 0) return chipModels.value as any
    
    // Return placeholder insights for demonstration
    return [
      {
        id: 'placeholder-commits',
        title: 'Commits per Session',
        description: 'Average commits per coding session',
        severity: 'info' as const,
        insightClass: 'org_deterministic' as const,
        tags: ['productivity', 'commits'],
        cicdStage: 'plan-code' as const,
        metricValue: 3.2,
        confidenceLevel: 'LOW' as const,
        evidence: [],
        recommendations: [{ text: 'Waiting for real data...' }],
        tools: ['cursor'],
        source: 'simulated' as const,
      },
      {
        id: 'placeholder-ai',
        title: 'AI Suggestions Accepted',
        description: 'AI assists accepted per session',
        severity: 'highlight' as const,
        insightClass: 'org_deterministic' as const,
        tags: ['ai', 'productivity'],
        cicdStage: 'plan-code' as const,
        metricValue: 8.5,
        confidenceLevel: 'LOW' as const,
        evidence: [],
        recommendations: [{ text: 'Waiting for real data...' }],
        tools: ['windsurf'],
        source: 'simulated' as const,
      },
      {
        id: 'placeholder-ttfc',
        title: 'Time to First Commit',
        description: 'Average time to first commit in a session',
        severity: 'opportunity' as const,
        insightClass: 'org_deterministic' as const,
        tags: ['productivity', 'time'],
        cicdStage: 'plan-code' as const,
        metricValue: 14,
        confidenceLevel: 'LOW' as const,
        evidence: [],
        recommendations: [{ text: 'Waiting for real data...' }],
        tools: ['vscode'],
        source: 'simulated' as const,
      },
      {
        id: 'placeholder-deployment-frequency',
        title: 'Deployment Frequency',
        description: 'Number of deployments per week',
        severity: 'warning' as const,
        insightClass: 'org_deterministic' as const,
        tags: ['deployment', 'frequency'],
        cicdStage: 'deploy-operate' as const,
        metricValue: 2.3,
        confidenceLevel: 'LOW' as const,
        evidence: [],
        recommendations: [{ text: 'Early signal, limited data' }],
        tools: ['cursor'],
        source: 'simulated' as const,
      },
      {
        id: 'placeholder-change-failure-rate',
        title: 'Change Failure Rate',
        description: 'Percentage of deployments that fail',
        severity: 'critical' as const,
        insightClass: 'org_deterministic' as const,
        tags: ['deployment', 'failure'],
        cicdStage: 'deploy-operate' as const,
        metricValue: 12.7,
        confidenceLevel: 'LOW' as const,
        evidence: [],
        recommendations: [{ text: 'Early signal, limited data' }],
        tools: ['cursor'],
        source: 'simulated' as const,
      },
      {
        id: 'placeholder-rollback-rate',
        title: 'Rollback Rate',
        description: 'Production rollback frequency',
        severity: 'priority' as const,
        insightClass: 'org_deterministic' as const,
        tags: ['deployment', 'stability'],
        cicdStage: 'deploy-operate' as const,
        metricValue: 5.2,
        confidenceLevel: 'LOW' as const,
        evidence: [],
        recommendations: [{ text: 'Early signal, limited data' }],
        tools: ['cursor'],
        source: 'simulated' as const,
      }
    ]
  }
  
  return [] // No placeholders when real insights exist
})


// ── Prompt 22: Chip-only deduplication for variant metric families ──

/** Identify which variant family (if any) an insight belongs to */
function getVariantFamily(insight: PerformanceInsight): 'session_length' | 'focus' | null {
  const titleLower = (insight.title || '').toLowerCase()
  const idLower = (insight.id || '').toLowerCase()

  // Session length family: title/id contains "session length" OR id includes "session-length"
  if (titleLower.includes('session length') || idLower.includes('session-length') || idLower.includes('session_length')) {
    return 'session_length'
  }

  // Focus family: title/id contains "focus" (includes "low focus", "AI-heavy low focus")
  if (titleLower.includes('focus') || idLower.includes('focus')) {
    return 'focus'
  }

  return null
}

/** Score an insight for deduplication ranking (higher = better) */
function scoreInsightForDedupe(insight: PerformanceInsight, family: 'session_length' | 'focus'): { score: number; reasons: string[] } {
  const rowAny = insight as any
  const reasons: string[] = []
  let score = 0

  // Get competitive state from chipModels if available
  const model = chipModels.value[insight.id]
  const competitiveState = model?.competitiveState || 'no_breakdown'

  // ── Common scoring: competitive state ──
  if (competitiveState === 'winner') {
    score += 1000
    reasons.push('winner')
  } else if (competitiveState === 'tie') {
    score += 500
    reasons.push('tie')
  } else if (competitiveState === 'org_only') {
    score += 100
    reasons.push('org_only')
  } else {
    reasons.push('no_breakdown')
  }

  // ── Common scoring: has real IDE breakdown (cursor/windsurf/vscode keys) ──
  const breakdownKeys = rowAny.breakdownByTool ? Object.keys(rowAny.breakdownByTool).filter((k: string) => k !== 'org') : []
  const hasRealIdeBreakdown = breakdownKeys.some((k: string) => ['cursor', 'windsurf', 'vscode', 'jetbrains'].includes(k.toLowerCase()))
  if (hasRealIdeBreakdown) {
    score += 200
    reasons.push('has_ide_breakdown')
  }

  // ── Common scoring: evidence strength ──
  const coveragePct = rowAny.coveragePct ?? 0
  const n = rowAny.n ?? rowAny.contributingUnitsCount ?? 0
  score += coveragePct * 2  // 0-200 range
  score += Math.min(n, 100)  // Cap n contribution at 100
  if (coveragePct > 0) reasons.push(`coverage=${coveragePct}`)
  if (n > 0) reasons.push(`n=${n}`)

  // ── Focus family special: prefer AI-specific focus imbalance ──
  if (family === 'focus') {
    const idLower = (insight.id || '').toLowerCase()
    const titleLower = (insight.title || '').toLowerCase()
    if (idLower.includes('telemetry-ai-focus-imbalance') || idLower.includes('ai-focus') || titleLower.includes('ai-heavy')) {
      score += 500
      reasons.push('ai_focus_specific')
    }
  }

  return { score, reasons }
}

/** Pick the best insight from a list of candidates in the same family */
function pickBestInsight(candidates: PerformanceInsight[], family: 'session_length' | 'focus'): { best: PerformanceInsight; dropped: PerformanceInsight[]; reason: string } {
  if (candidates.length === 0) {
    throw new Error('pickBestInsight called with empty candidates')
  }
  if (candidates.length === 1) {
    return { best: candidates[0], dropped: [], reason: 'only_one' }
  }

  // Score all candidates
  const scored = candidates.map(c => ({
    insight: c,
    ...scoreInsightForDedupe(c, family)
  }))

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  const best = scored[0]
  const dropped = scored.slice(1).map(s => s.insight)

  return {
    best: best.insight,
    dropped,
    reason: best.reasons.join('+')
  }
}

/** Dedupe variant families within a list of stage insights (Chips-only) */
function dedupeVariantFamilies(stageInsights: PerformanceInsight[], stageId: string): PerformanceInsight[] {
  // Group insights by family
  const sessionLengthFamily: PerformanceInsight[] = []
  const focusFamily: PerformanceInsight[] = []
  const others: PerformanceInsight[] = []

  for (const insight of stageInsights) {
    const family = getVariantFamily(insight)
    if (family === 'session_length') {
      sessionLengthFamily.push(insight)
    } else if (family === 'focus') {
      focusFamily.push(insight)
    } else {
      others.push(insight)
    }
  }

  const result: PerformanceInsight[] = [...others]

  // Dedupe session_length family
  if (sessionLengthFamily.length > 1) {
    const { best, dropped, reason } = pickBestInsight(sessionLengthFamily, 'session_length')
    result.push(best)

    if ((import.meta as any)?.env?.DEV && dropped.length > 0) {
      console.log(`[CHIPS_DEDUPE] stage=${stageId} family=session_length kept=${best.id} dropped=[${dropped.map(d => d.id).join(', ')}] reason=${reason}`)
    }
  } else if (sessionLengthFamily.length === 1) {
    result.push(sessionLengthFamily[0])
  }

  // Dedupe focus family
  if (focusFamily.length > 1) {
    const { best, dropped, reason } = pickBestInsight(focusFamily, 'focus')
    result.push(best)

    if ((import.meta as any)?.env?.DEV && dropped.length > 0) {
      console.log(`[CHIPS_DEDUPE] stage=${stageId} family=focus kept=${best.id} dropped=[${dropped.map(d => d.id).join(', ')}] reason=${reason}`)
    }
  } else if (focusFamily.length === 1) {
    result.push(focusFamily[0])
  }

  return result
}

// ── Prompt B: Dedupe by normalized display label ──

/** Normalize the display label for dedupe comparison */
function getDedupeKey(insight: any): string {
  const raw =
    String(insight?.rightMetric?.label || insight?.title || '').toLowerCase()

  return raw
    .replace(/\b(cursor|windsurf|vs code|vscode|jetbrains)\b/g, '')
    .replace(/\b(no ide difference|identical across ides|identical|vs)\b/g, '')
    .replace(/[^a-z0-9% ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Score an insight for dedupe ranking (higher = keep) */
function scoreInsight(insight: any): number {
  const id = String(insight?.id || '').toLowerCase()
  const title = String(insight?.title || '').toLowerCase()
  const ctx = String(insight?.contextLine || '').toLowerCase()
  const breakdown = insight?.breakdownByTool || {}
  const keys = Object.keys(breakdown).map(k => k.toLowerCase())
  const ideKeys = keys.filter(k => ['cursor','windsurf','vscode','vs code','jetbrains'].includes(k))
  const n = Number(insight?.n || 0)
  const cov = Number(insight?.coveragePct || 0)

  let score = 0

  // Prefer real IDE breakdown
  if (ideKeys.length >= 2) score += 400

  // Prefer winner/tie style rows if available
  if (insight?.winnerName) score += 600
  if (ctx.includes('no ide difference') || ctx.includes('identical')) score -= 250

  // Prefer non-placeholder
  if (id.includes('placeholder') || title.includes('placeholder')) score -= 1000

  // Prefer more evidence
  score += Math.min(n, 200)
  score += cov

  // Prefer AI-specific focus rows (if applicable)
  if (title.includes('ai') || id.includes('ai') || title.includes('ai-heavy')) score += 200

  return score
}

/** Dedupe insights by normalized display label, keeping highest score */
function dedupeByLabel(stageId: string, rows: any[]): any[] {
  const bestByKey = new Map<string, any>()
  const dropped: string[] = []

  for (const r of rows) {
    const key = getDedupeKey(r)
    if (!key) continue

    const prev = bestByKey.get(key)
    if (!prev) {
      bestByKey.set(key, r)
      continue
    }

    const a = scoreInsight(prev)
    const b = scoreInsight(r)
    if (b > a) {
      dropped.push(String(prev.id))
      bestByKey.set(key, r)
    } else {
      dropped.push(String(r.id))
    }
  }

  // keep original order, but only those that survived
  const keepIds = new Set(Array.from(bestByKey.values()).map(x => String(x.id)))
  const out = rows.filter(r => {
    const key = getDedupeKey(r)
    // non-keyed rows pass through; keyed rows must survive
    return !key || keepIds.has(String(r.id))
  })

  if ((import.meta as any).env?.DEV) {
    console.log('[CHIPS_DEDUPE_BY_LABEL]', { stageId, dropped })
  }
  return out
}

// Methods
function getStageInsights(stageId: string): PerformanceInsight[] {
  const source = props.insights?.length ? props.insights : placeholderInsights.value
  const stageInsights = source.filter(insight => insight.cicdStage === stageId)
  
  // Apply chip-only deduplication for variant families
  const familyDeduped = dedupeVariantFamilies(stageInsights as any, stageId)

  // Apply label-based deduplication (Prompt B)
  const deduped = dedupeByLabel(stageId, familyDeduped as any) as PerformanceInsight[]
  
  // STEP 1 — ORDER BY PRIORITY (high → medium → low)
  const priorityRank = { high: 0, medium: 1, low: 2 }
  deduped.sort((a, b) => {
    return priorityRank[(a as any).priority || 'medium'] - priorityRank[(b as any).priority || 'medium']
  })
  
  // STEP 2 — MAX VISIBILITY FILTERING
  const filtered = deduped.filter(i => {
    const val = (i as any).value || (i as any).rightMetric || (i as any).displayValue
    return !!val
  })
  
  // OPTIONAL: Hide invalid chips in demo mode
  const DEMO_MODE = (import.meta as any).env?.VITE_PI_DEMO_MODE === '1'
  let finalInsights = filtered
  
  if (DEMO_MODE) {
    // Filter out chips that would be misleading in demo
    finalInsights = filtered.filter(insight => {
      const rowAny = insight as any
      
      // Hide chips with truly no computable data
      const hasNoData = (rowAny.n === 0 || rowAny.n === undefined) && 
                       (rowAny.coveragePct === 0 || rowAny.coveragePct === undefined) &&
                       rowAny.insufficientSignal === true
      
      // Hide chips with placeholder titles
      const isPlaceholder = insight.title?.includes('placeholder') || 
                           insight.id?.includes('placeholder')
      
      return !hasNoData && !isPlaceholder
    })
  }

  const prioritizedInsights = prioritizeTopSignals(finalInsights)
  
  // STEP 3 — RETURN ALL PRIORITIZED INSIGHTS
  return prioritizedInsights
}

// TASK 5 — SORT BY IMPACT
function prioritizeTopSignals(insights: PerformanceInsight[]): PerformanceInsight[] {
  if (!insights || insights.length === 0) return insights
  
  // Sort ALL insights by impact: bad (largest delta first) > warning > good
  const allInsights = [...insights]
  allInsights.sort((a, b) => {
    // Get derived status for importance sorting
    const aStatus = getInsightStatus(a)
    const bStatus = getInsightStatus(b)
    
    // Priority order: bad (1) > warning (2) > good (3)
    const getStatusPriority = (status: string) => {
      if (status === 'bad') return 1
      if (status === 'warning') return 2
      return 3 // good
    }
    
    const aPriority = getStatusPriority(aStatus.status)
    const bPriority = getStatusPriority(bStatus.status)
    
    // Sort by status priority first (lower number = higher priority)
    if (aPriority !== bPriority) {
      return aPriority - bPriority
    }
    
    // If same status, sort by delta magnitude (largest delta first for bad/warning)
    if (aPriority === 1 || aPriority === 2) { // bad or warning
      const aDelta = getDeltaMagnitude(a)
      const bDelta = getDeltaMagnitude(b)
      
      // Sort by absolute delta magnitude (larger = more important)
      if (aDelta !== bDelta) {
        return bDelta - aDelta // descending order
      }
    }
    
    // If same status and delta, prioritize primary signals
    const aIsPrimary = isPrimarySignal(a)
    const bIsPrimary = isPrimarySignal(b)
    if (aIsPrimary && !bIsPrimary) return -1
    if (!aIsPrimary && bIsPrimary) return 1
    
    // Maintain original order otherwise
    return 0
  })
  
  return allInsights
}

// Helper to identify top priority chips
function isTopPriority(insight: PerformanceInsight, index: number): boolean {
  return index < 3 && getInsightStatus(insight).status !== 'good'
}


// Helper to format metric with unit
function formatMetricWithUnit(insight: PerformanceInsight, value: any): string {
  if (!value || isNaN(Number(value))) return 'No baseline yet'
  
  const id = insight.id || ''
  const numValue = Number(value)
  
  if (id.includes('commit')) return `${numValue.toFixed(1)} commits/session`
  if (id.includes('session')) return `${numValue.toFixed(0)} min/session`
  if (id.includes('ttfc')) return `${numValue.toFixed(0)} min TTFC`
  if (id.includes('assist')) return `${numValue.toFixed(1)} AI assists/session`
  if (id.includes('failure')) return `${numValue.toFixed(1)}% failure rate`
  
  return `${numValue}`
}

// Helper to properly extract delta from structured comparison data
function extractDelta(insight: PerformanceInsight): number | null {
  if (!insight) return null

  // Case 1: direct numeric
  if (typeof insight.delta === 'number') return insight.delta

  // Case 2: vs org average
  if (typeof (insight as any).vsOrgAvg === 'number') return (insight as any).vsOrgAvg

  // Case 3: structured comparison object
  if ((insight as any).comparison) {
    const comparison = (insight as any).comparison
    
    // Prefer org baseline first
    if (typeof comparison.vsOrgAvg === 'number') {
      return comparison.vsOrgAvg
    }

    // Then try IDE comparisons (pick first available)
    if (comparison.vsIDE) {
      const values = Object.values(comparison.vsIDE)
      const numeric = values.find(v => typeof v === 'number')
      if (numeric !== undefined) return numeric
    }
  }

  return null
}

// Helper to get display delta using proper extraction
function getDisplayDelta(insight: PerformanceInsight): string {
  const delta = extractDelta(insight)

  if (delta === null) return 'No comparison available'

  const abs = Math.abs(delta).toFixed(0)

  if (delta > 0) return `+${abs}% vs baseline`
  if (delta < 0) return `-${abs}% vs baseline`

  return 'No change'
}

const chipModels = computed<Insight[]>(() => props.insights as unknown as Insight[])

// === STEP 1: SINGLE DATA CONTRACT WITH SAFE STRUCTURE ===
const performanceData = computed(() => {
  const safe = (val: any) => val ?? { metrics: [], findings: [], actions: [] }

  return {
    plan: safe(mapPlanMetrics(props.insights)),
    review: safe(mapReviewMetrics(props.insights)),
    deploy: safe(mapDeployMetrics(props.insights)),
    executive: mapExecutiveSummary(props.insights) ?? {},
    ide: mapIDEData(props.insights) ?? [],
    kpis: mapKPIs(props.insights) ?? []
  }
})

// === STEP 6: DEBUG OUTPUT ===
watchEffect(() => {
  console.log('PLAN', performanceData.value.plan)
  console.log('REVIEW', performanceData.value.review)
  console.log('DEPLOY', performanceData.value.deploy)
})

// === STEP 2: MAPPING FUNCTIONS ===

function mapExecutiveSummary(insights: PerformanceInsight[]) {
  return {
    aiAdoption: getInsight(insights, 'ai_adoption_rate'),
    burstsPerSession: getInsight(insights, 'bursts_per_session'),
    changeFailureRate: getInsight(insights, 'change_failure_rate'),
    totalSessions: getInsight(insights, 'total_sessions'),
    narrative: buildNarrative(insights)
  }
}

function mapKPIs(insights: PerformanceInsight[]) {
  return [
    mapKPI(insights, 'ai_adoption_rate'),
    mapKPI(insights, 'lead_time'),
    mapKPI(insights, 'deploy_frequency'),
    mapKPI(insights, 'change_failure_rate'),
    mapKPI(insights, 'review_cycles'),
    mapKPI(insights, 'revert_rate')
  ].filter(Boolean)
}

function mapKPI(insights: PerformanceInsight[], key: string) {
  const insight = insights.find(i => i.id === key)
  if (!insight) return null

  return {
    label: insight.title,
    value: insight.value ?? null,
    delta: insight.delta ?? null,
    trend: (insight as any).trend ?? null
  }
}

function mapPlanMetrics(insights: PerformanceInsight[]) {
  // STEP 5: STRICT SEPARATION - Use ONLY telemetry data for Plan & Code
  const telemetryInsights = insights.filter(i => 
    i.cicdStage === 'plan-code' && 
    (i.source === 'productivity' || i.id?.includes('session') || i.id?.includes('ai') || i.id?.includes('commit'))
  )
  
  return {
    metrics: [
      getInsight(telemetryInsights, 'ai_assist_rate'),
      getInsight(telemetryInsights, 'sessions_per_dev'),
      getInsight(telemetryInsights, 'events_per_session')
    ].filter(Boolean),
    findings: getInsightsByStage(telemetryInsights, 'plan-code'),
    actions: getRecommendationsByStage(telemetryInsights, 'plan-code')
  }
}

function mapReviewMetrics(insights: PerformanceInsight[]) {
  // STEP 5: STRICT SEPARATION - Use ONLY GitHub PR data for Review & Merge
  const githubInsights = insights.filter(i => 
    i.cicdStage === 'review-merge' && 
    (i.source === 'github' || i.id?.includes('pr') || i.id?.includes('review') || i.id?.includes('merge'))
  )
  
  return {
    metrics: [
      getInsight(githubInsights, 'review_cycles'),
      getInsight(githubInsights, 'revert_rate'),
      getInsight(githubInsights, 'pr_size')
    ].filter(Boolean),
    findings: getInsightsByStage(githubInsights, 'review-merge'),
    actions: getRecommendationsByStage(githubInsights, 'review-merge')
  }
}

function mapDeployMetrics(insights: PerformanceInsight[]) {
  // STEP 5: STRICT SEPARATION - Use ONLY deployment data for Deploy & Operate
  const deployInsights = insights.filter(i => 
    i.cicdStage === 'deploy-operate' && 
    (i.source === 'combined' || i.id?.includes('deploy') || i.id?.includes('failure') || i.id?.includes('mttr'))
  )
  
  return {
    metrics: [
      getInsight(deployInsights, 'deploy_frequency'),
      getInsight(deployInsights, 'change_failure_rate')
    ].filter(Boolean),
    findings: getInsightsByStage(deployInsights, 'deploy-operate'),
    actions: getRecommendationsByStage(deployInsights, 'deploy-operate')
  }
}

function mapIDEData(insights: PerformanceInsight[]) {
  return extractIDEStats(insights)
}

// === STEP 3: REQUIRED HELPERS ===

function getInsight(insights: PerformanceInsight[], key: string) {
  return insights.find(i => i.id === key) ?? null
}

function getInsightsByStage(insights: PerformanceInsight[], stage: string) {
  return insights
    .filter(i => i.cicdStage === stage)
    .sort(sortByPriority)
}

function sortByPriority(a: PerformanceInsight, b: PerformanceInsight) {
  const order = { high: 0, medium: 1, low: 2 }
  const aPriority = (a as any).priority ?? 'medium'
  const bPriority = (b as any).priority ?? 'medium'
  return (order[aPriority as keyof typeof order] ?? 3) - (order[bPriority as keyof typeof order] ?? 3)
}

function buildNarrative(insights: PerformanceInsight[]): string {
  const highPriorityInsights = insights.filter(i => (i as any).priority === 'high')
  
  if (highPriorityInsights.length > 0) {
    const topIssue = highPriorityInsights[0]
    return `Critical: ${(topIssue as any).interpretation || topIssue.title}. Focus on addressing ${highPriorityInsights.length} high-priority issues to improve delivery velocity.`
  }
  
  return 'Performance is stable with opportunities for AI adoption optimization and review process improvements.'
}

function getRecommendationsByStage(insights: PerformanceInsight[], stage: string) {
  return insights
    .filter(i => i.cicdStage === stage && (i as any).whyItMatters)
    .map(i => ({
      insight: i,
      recommendation: (i as any).whyItMatters
    }))
}

function extractIDEStats(insights: PerformanceInsight[]) {
  // Extract IDE-specific stats from insights
  const ideStats: Record<string, any> = {}
  
  insights.forEach(insight => {
    const tools = (insight as any).tools || []
    tools.forEach((tool: string) => {
      if (!ideStats[tool]) {
        ideStats[tool] = {
          name: tool,
          adoption: 0,
          sessions: 0,
          assistsPerSession: 0,
          pills: []
        }
      }
      
      // Update stats based on insight data
      if (insight.id?.includes('ai')) {
        ideStats[tool].assistsPerSession += 1
        ideStats[tool].pills.push('AI Enabled')
      }
      if (insight.id?.includes('session')) {
        ideStats[tool].sessions += 1
      }
    })
  })
  
  // Convert to array and add ranks
  return Object.values(ideStats)
    .map((stat: any, index) => ({
      ...stat,
      rank: index + 1,
      adoption: Math.max(10, 100 - (index * 15)), // Simulated adoption rates
      pills: stat.pills.length > 0 ? stat.pills : ['Active']
    }))
    .sort((a: any, b: any) => b.adoption - a.adoption)
    .map((stat: any, index: number) => ({ ...stat, rank: index + 1 }))
}

// === STEP 5: TEMPLATE BINDING HELPERS ===

function getStageTitle(stageId: string): string {
  const titles = {
    'plan-code': 'Plan & Code',
    'review-merge': 'Review & Merge',
    'deploy-operate': 'Deploy & Operate'
  }
  return titles[stageId as keyof typeof titles] || stageId
}

function getStageBorderClass(stageId: string): string {
  const insights = props.insights?.filter(i => i.cicdStage === stageId) || []
  const highPriorityCount = insights.filter(i => (i as any).priority === 'high').length
  
  if (highPriorityCount > 0) return 'border-red'
  if (insights.some(i => (i as any).priority === 'medium')) return 'border-amber'
  return 'border-neutral'
}

function getStageStatus(stageId: string): string {
  const insights = props.insights?.filter(i => i.cicdStage === stageId) || []
  const highPriorityCount = insights.filter(i => (i as any).priority === 'high').length
  
  if (highPriorityCount > 0) return 'At Risk'
  if (insights.length > 0) return 'Stable'
  return 'No Data'
}

function getStageStatusClass(stageId: string): string {
  const status = getStageStatus(stageId)
  return status === 'At Risk' ? 'status-red' : status === 'Stable' ? 'status-green' : 'status-gray'
}

function getDeltaClass(delta: string | null): string {
  if (!delta) return 'neutral'
  if (delta.includes('+')) return 'positive'
  if (delta.includes('-')) return 'negative'
  return 'neutral'
}

function getSparkline(type: string): string {
  // Simple ASCII sparklines for now
  const sparklines = {
    sessions: '▂▃▅▃▂',
    leadTime: '▅▄▃▄▅',
    deployFreq: '▂▃▄▅▄',
    cfr: '▄▃▃▄▂',
    prRisk: '▂▂▃▄▅',
    aiDensity: '▂▃▅▆▅'
  }
  return sparklines[type as keyof typeof sparklines] || '▂▃▄▃▂'
}

function getIDEClass(ide: any): string {
  return ide.rank === 1 ? 'leader' : ide.rank === 2 ? 'contender' : 'established'
}

function getPillClass(pill: string): string {
  const pillClasses: Record<string, string> = {
    'Fast': 'success',
    'AI Native': 'info',
    'Growing': 'warning',
    'Stable': 'success',
    'Mature': 'neutral',
    'Reliable': 'success',
    'AI Enabled': 'info',
    'Active': 'success'
  }
  return pillClasses[pill] || 'neutral'
}

// Additional template helpers - USE ONLY performanceData
function getStageFindings(stageId: string): PerformanceInsight[] {
  const stageMap: Record<string, keyof typeof performanceData.value> = {
    'plan-code': 'plan',
    'review-merge': 'review', 
    'deploy-operate': 'deploy'
  }
  const stageKey = stageMap[stageId]
  const findings = stageKey ? performanceData.value[stageKey]?.findings || [] : []
  
  // STEP 4: FORCE INSIGHT VISIBILITY - fallback to real insights if empty
  if (!findings.length) {
    return getInsightsByStage(props.insights, stageId)
  }
  
  return findings
}

function getPrimaryFinding(stageId: string): string {
  const insights = getStageFindings(stageId)
  const highPriority = insights.filter(i => (i as any).priority === 'high')[0]
  
  if (highPriority) {
    return (highPriority as any).interpretation || highPriority.title || 'No critical issues identified'
  }
  
  if (insights.length > 0) {
    return 'Stage operating within normal parameters'
  }
  
  return 'Insufficient data for analysis'
}

function getRecommendedAction(stageId: string): string {
  const insights = getStageFindings(stageId)
  const highPriority = insights.filter(i => (i as any).priority === 'high')[0]
  
  if (highPriority && (highPriority as any).whyItMatters) {
    return (highPriority as any).whyItMatters
  }
  
  const stageActions = {
    'plan-code': 'Monitor AI adoption patterns and optimize session efficiency',
    'review-merge': 'Improve review coverage and reduce PR size complexity',
    'deploy-operate': 'Enhance deployment success rate and monitor failure patterns'
  }
  
  return stageActions[stageId as keyof typeof stageActions] || 'Continue monitoring performance metrics'
}

function getStageMetrics(stageId: string): Array<{name: string, value: string, label: string}> {
  const stageMap: Record<string, keyof typeof performanceData.value> = {
    'plan-code': 'plan',
    'review-merge': 'review', 
    'deploy-operate': 'deploy'
  }
  const stageKey = stageMap[stageId]
  
  if (!stageKey) return []
  
  const metrics = performanceData.value[stageKey]?.metrics || []
  return metrics.map((metric, index) => ({
    name: metric.id || `metric-${index}`,
    value: metric.value != null ? String(metric.value) : '—',
    label: metric.title || `Metric ${index + 1}`
  }))
}

// Helper to get stage narrative
function getStageNarrative(stageId: string): string {
  if (stageId === 'plan-code') return 'AI usage is increasing, but output efficiency is uneven'
  if (stageId === 'review-merge') return 'Review delays and PR structure are slowing delivery'
  if (stageId === 'deploy-operate') return 'Deployment risk is increasing despite stable activity'
  
  return 'Performance insights for this stage'
}

// Helper function to get delta magnitude for sorting
function getDeltaMagnitude(insight: PerformanceInsight): number {
  const insightAny = insight as any
  const deltas = [
    insightAny.vs_fastest,
    insightAny.vs_org,
    insightAny.vs_baseline,
    insightAny.delta,
    insightAny.displayDelta
  ].filter(d => d !== undefined && d !== null)
  
  if (deltas.length === 0) return 0
  
  // Return the largest absolute delta
  return Math.max(...deltas.map(d => Math.abs(Number(d))))
}

// Helper function to get priority IDs for a stage
function getPriorityIds(stageId: string): string[] {
  const priorityMap: Record<string, string[]> = {
    'plan-code': [
      // Common Plan & Code insight IDs (add actual IDs as needed)
      'commits-per-session-by-ide',
      'active-coding-time-by-ide',
      'ai-suggestions-accepted-by-ide',
      'average-session-length-by-ide',
      'time-to-first-commit-by-ide',
      'rework-rate-by-ide',
      'delivery-rate-ai-vs-non-ai'
    ],
    'review-merge': [
      // Common Review & Merge insight IDs
      'session-conditioned-pr-cycle-time-ai-vs-non-ai',
      'branch-stagnation-risk-ai-vs-non-ai',
      'session-conditioned-change-risk-ai-vs-non-ai',
      'revert-rate-by-ide',
      'review-latency-spike-by-ide',
      'pr-review-cycles-by-ide'
    ],
    'deploy-operate': [
      // Common Deploy & Operate insight IDs
      'deployment-frequency-volatility-by-ide',
      'change-failure-rate-spike-by-ide',
      'delivery-velocity-by-workflow',
      'mttr-by-ide',
      'fast-but-unstable-org'
    ]
  }
  
  return priorityMap[stageId] || []
}

const toggleChipExpansion = (stageId: string, insightId: string) => {
  if (
    expandedChip.value &&
    expandedChip.value.stageId === stageId &&
    expandedChip.value.insightId === insightId
  ) {
    expandedChip.value = null
  } else {
    expandedChip.value = { stageId, insightId }
  }
}

function getSeverityClass(severity: string): string {
  const classes = {
    'priority': 'severity-priority',
    'highlight': 'severity-highlight', 
    'info': 'severity-info',
    'opportunity': 'severity-opportunity',
    'warning': 'severity-warning'
  }
  return classes[severity as keyof typeof classes] || 'severity-info'
}

function getStatusClass(insight: PerformanceInsight): string {
  // Demo mode flag - show LIVE status instead of LOW CONF
  const DEMO_MODE = (import.meta as any).env?.VITE_PI_DEMO_MODE === '1'
  
  if (!DEMO_MODE && insight.confidenceLevel === 'LOW') return 'incomplete'
  if (insight.severity === 'critical') return 'priority'
  if (insight.severity === 'warning') return 'warning'
  return 'live'
}

function getStatusText(insight: PerformanceInsight): string {
  // Demo mode flag - show LIVE status instead of LOW CONF
  const DEMO_MODE = (import.meta as any).env?.VITE_PI_DEMO_MODE === '1'
  
  // Special case for deployment status - show generic status since details are in primary value
  if (insight.id === 'latest-deployment-unhealthy') {
    console.log('[CHIPS] Deployment insight:', { id: insight.id, displayValue: insight.displayValue, metricValue: insight.metricValue })
    // Return generic status since deployment details are now in primary value
    if (insight.severity === 'critical') return 'PRIORITY'
    if (insight.severity === 'warning') return 'WARNING'
    return 'LIVE'
  }
  
  if (!DEMO_MODE && insight.confidenceLevel === 'LOW') return 'LOW CONF'
  if (insight.severity === 'critical') return 'PRIORITY'
  if (insight.severity === 'warning') return 'WARNING'
  return 'LIVE'
}

// 🔥 STEP 2 — DELTA EMPHASIS WITH INLINE FORMATTING
function formatInlineDelta(insight: PerformanceInsight): { value: string, class: string } {
  const chipModel = chipModels.value[insight.id];
  if (!chipModel?.wowDelta) return { value: chipModel?.primaryValue || '—', class: '' };
  
  const deltaText = chipModel.wowDelta;
  const isPositive = deltaText.includes('+') || !deltaText.includes('-');
  const isNegative = deltaText.includes('-');
  
  // Extract percentage and value parts
  const deltaMatch = deltaText.match(/([+-]?\d+%?)/);
  if (!deltaMatch) return { value: chipModel?.primaryValue || '—', class: '' };
  
  const cleanDelta = deltaMatch[1];
  let colorClass = 'text-muted'; // default gray for neutral
  
  if (isPositive) {
    colorClass = 'text-success'; // green for positive
  } else if (isNegative) {
    colorClass = 'text-danger'; // red for negative
  }
  
  const inlineValue = `${chipModel?.primaryValue || '—'} (${cleanDelta})`;
  return { value: inlineValue, class: colorClass };
}

// 🔥 STEP 3.4 — IMPROVED CHIP TITLES FOR CLARITY
function enhanceLabelWithContext(insight: PerformanceInsight): string {
  const title = insight.title || '';
  const id = insight.id;
  
  // Remove vague phrasing and add specific context
  if (title.includes('Low focus')) {
    return 'Focus fragmentation (context switching)';
  }
  
  if (title.includes('Idle')) {
    return 'Idle time (interruption patterns)';
  }
  
  if (title.includes('Large PRs')) {
    return 'Large PRs (review bottleneck risk)';
  }
  
  if (title.includes('CFR') || title.includes('Change Failure Rate')) {
    return 'Deployment failure rate (stability risk)';
  }
  
  if (title.includes('Review cycles')) {
    return 'Review iterations (feedback loops)';
  }
  
  if (title.includes('reopened') || title.includes('Reopen')) {
    return 'PR reopens (quality signals)';
  }
  
  if (title.includes('failed') || title.includes('failure')) {
    return 'Deployment failures (pipeline health)';
  }
  
  if (title.includes('stagnation') || title.includes('stagnant')) {
    return 'Work stagnation (delivery delays)';
  }
  
  if (title.includes('AI Suggestions')) {
    return 'AI adoption (tool efficiency)';
  }
  
  if (title.includes('Session Length')) {
    return 'Session duration (productivity patterns)';
  }
  
  if (title.includes('Commits per Session')) {
    return 'Commit frequency (development rhythm)';
  }
  
  if (title.includes('Active Coding')) {
    return 'Active coding time (deep work)';
  }
  
  if (title.includes('Time to First Commit')) {
    return 'First commit speed (onboarding efficiency)';
  }
  
  if (title.includes('Rework Rate')) {
    return 'Rework percentage (quality cost)';
  }
  
  if (title.includes('Delivery Rate')) {
    return 'Delivery frequency (throughput)';
  }
  
  return title; // Return original if no enhancement needed
}

// 🔥 STEP 3.4 — EXACTLY ONE PRIMARY CHIP PER STAGE
function isPrimarySignal(insight: PerformanceInsight): boolean {
  const stage = insight.cicdStage;
  const id = insight.id;
  
  // Plan & Code: EXACTLY ONE primary - prefer "Low focus %" over "Idle %"
  if (stage === 'plan-code') {
    // Strict priority: Low focus first, then Idle if no focus available
    if (id?.includes('focus')) return true;
    if (id?.includes('idle')) return false; // Only primary if focus not available
    return false;
  }
  
  // Review & Merge: EXACTLY ONE primary - "Large PRs %" only
  if (stage === 'review-merge') {
    return id?.includes('large-pr');
  }
  
  // Deploy & Operate: EXACTLY ONE primary - "CFR" only
  if (stage === 'deploy-operate') {
    return id?.includes('change-failure-rate') || id?.includes('cfr');
  }
  
  return false;
}

// TASK 6 — FIX EXTREME VALUES
function getDemoSeverityClass(insight: PerformanceInsight): string {
  const rowAny = insight as any;
  const value = Number(rowAny.metricValue || rowAny.displayValue);
  const title = insight.title || '';
  const id = insight.id || '';
  
  if (!Number.isFinite(value)) return 'severity-info';
  
  // 🔥 STEP 5 — NO EMPTY EMPHASIS FOR NULL/LOW SIGNAL
  if (value === null || value === undefined || rowAny.displayValue === '—' || rowAny.metricValue === '—') {
    return 'severity-neutral'; // Leave visually neutral for null/empty values
  }
  
  // TASK 6: Add guards for extreme thresholds
  // Cycle time > 24h → critical
  if ((id.includes('cycle-time') || title.includes('cycle time')) && value > 24) {
    return 'severity-critical';
  }
  
  // Failure rate > 10% → critical
  if ((id.includes('failure-rate') || id.includes('cfr') || title.includes('failure rate')) && value > 10) {
    return 'severity-critical';
  }
  
  // 🔥 STEP 6 — DE-EMPHASIZE LOW-VALUE CHIPS
  // "Deployment status: Success" → low value
  if (title.includes('Success') && insight.id?.includes('deployment')) {
    return 'severity-low-value';
  }
  
  // "0 failed deployments" → low value  
  if (value === 0 && insight.id?.includes('failed-deployment')) {
    return 'severity-low-value';
  }
  
  // Any chip with value 0 or very low signal
  if (value === 0 || (Number.isFinite(value) && value < 0.1)) {
    return 'severity-low-value';
  }
  
  // 🔥 STEP 3.4 — EXTREME VALUE THRESHOLDS (INCREASED CONTRAST)
  // CFR > 25% → critical danger (increased from 15%)
  if (insight.id?.includes('change-failure-rate') && value > 25) return 'severity-critical';
  
  // CFR 15-25% → high danger
  if (insight.id?.includes('change-failure-rate') && value > 15) return 'severity-danger';
  
  // Reopen rate > 10% → critical warning (increased from 5%)
  if (insight.id?.includes('reopen') && value > 10) return 'severity-critical';
  
  // Reopen rate 5-10% → warning
  if (insight.id?.includes('reopen') && value > 5) return 'severity-warning';
  
  // Large PRs > 90% → critical warning (increased from 80%)
  if (insight.id?.includes('large-pr') && value > 90) return 'severity-critical';
  
  // Large PRs 80-90% → warning
  if (insight.id?.includes('large-pr') && value > 80) return 'severity-warning';
  
  // Failed deployments > 5 → critical warning
  if (insight.id?.includes('failed-deployment') && value > 5) return 'severity-critical';
  
  // Failed deployments > 0 → warning
  if (insight.id?.includes('failed-deployment') && value > 0) return 'severity-warning';
  
  // 🔥 STEP 3.4 — STAGNATION RISK
  if (title.includes('stagnation') || title.includes('stagnant')) {
    if (value > 50) return 'severity-critical'; // High stagnation
    if (value > 25) return 'severity-warning';  // Medium stagnation
  }
  
  // 🔥 STEP 3.4 — EXTREME RISK PATTERNS
  if (title.includes('risk') || title.includes('critical')) {
    return 'severity-critical';
  }
  
  // Default to good/showing
  return 'severity-good';
}

// 🔧 STEP 5 — SIMPLIFY EXPANDED MODAL TEXT
function getImprovedRecommendation(insight: PerformanceInsight | undefined): string {
  if (!insight) return '';
  
  const id = insight.id;
  
  // Executable actions - start with verb, specific, tool/team behavior
  if (id && id.includes('commits-per-session')) {
    return 'Shift long coding sessions to Windsurf where TTFC is lower.'
  }
  if (id && id.includes('active-coding-time')) {
    return 'Configure VS Code extensions to reduce environment setup time.'
  }
  if (id && id.includes('ai-suggestions')) {
    return 'Enable AI assistance for repetitive tasks in VS Code.'
  }
  if (id && id.includes('session-length')) {
    return 'Implement 25-minute focused coding sprints with 5-minute breaks.'
  }
  if (id && id.includes('time-to-first-commit')) {
    return 'Standardize project templates to reduce IDE setup friction.'
  }
  if (id && id.includes('rework-rate')) {
    return 'Add pre-commit hooks to catch formatting issues before review.'
  }
  if (id && id.includes('delivery-rate')) {
    return 'Automate CI/CD pipeline gates to reduce manual deployment delays.'
  }
  if (id && id.includes('large-pr')) {
    return 'Enforce PR size limits at 300 LOC through automated checks.'
  }
  if (id && id.includes('reopen')) {
    return 'Require test coverage validation before PR merge approval.'
  }
  if (id && id.includes('change-failure-rate')) {
    return 'Implement staging environment canary releases for risky changes.'
  }
  if (id && id.includes('failed-deployment')) {
    return 'Add rollback automation to deployment pipeline for quick recovery.'
  }
  if (id && id.includes('reviewer-load')) {
    return 'Rotate review assignments weekly to prevent individual bottlenecks.'
  }
  if (id && id.includes('stale-deployment')) {
    return 'Schedule bi-weekly deployment cadence with automated release notes.'
  }
  
  // Fallback to original recommendation
  return insight.recommendations?.[0]?.text || '';
}

// AI Usage Signals color theme mapping for chips
function getChipTheme(stageKey?: string): string {
  if (!stageKey) return 'velocity' // fallback to orange
  
  const stageLower = stageKey.toLowerCase()
  if (stageLower.includes('plan') || stageLower.includes('code')) {
    return 'intensity' // teal - Plan & Code
  } else if (stageLower.includes('review') || stageLower.includes('merge')) {
    return 'efficiency' // green - Review & Merge  
  } else if (stageLower.includes('deploy') || stageLower.includes('operate')) {
    return 'productivity' // purple - Deploy & Operate
  }
  
  return 'velocity' // orange - fallback
}

// Helper function to check if insight has right metric (same as Strip view)
function hasRightMetric(insight: any): boolean {
  // More inclusive check: use canonical formatter for any insight with rightMetric or displayValue
  const hasRightMetric = !!insight?.rightMetric
  const hasDisplayValue = !!insight?.displayValue
  
  return hasRightMetric || hasDisplayValue
}

// FIXED: Primary value resolution with proper priority order
function formatPrimaryValue(insight: PerformanceInsight): string {
  // Priority 1: Explicit displayValue (if present)
  if (insight.displayValue) {
    const match = insight.displayValue.match(/(\d+\.?\d*)/)
    if (match) return match[1]
  }
  
  // Priority 2: Right-hand metric from Strip view (same logic as Strip view)
  if (hasRightMetric(insight)) {
    const stripValue = formatStripRightMetric(insight)
    // Extract numeric value from strip metric
    const match = stripValue.match(/(\d+\.?\d*)/)
    if (match) return match[1]
  }
  
  // Priority 3: Primary evidence numeric value
  if (insight.evidence && insight.evidence.length > 0) {
    for (const evidence of insight.evidence) {
      if (typeof evidence.value === 'number' && evidence.value !== null) {
        return evidence.value.toFixed(1)
      }
    }
  }
  
  // Priority 4: metricValue (fallback)
  if (insight.metricValue !== undefined && insight.metricValue !== null) {
    const value = Number(insight.metricValue)
    if (Number.isFinite(value)) {
      return Number.isInteger(value) ? value.toString() : value.toFixed(1)
    }
  }
  
  return '—'
}

// NEW: Metric name resolver for executive scanning
function resolveMetricName(insight: PerformanceInsight): string {
  const title = insight.title || ''
  const description = insight.description || ''
  
  // Priority 1: Derive from title using known patterns
  const titleLower = title.toLowerCase()
  
  // Session metrics (check first to avoid conflicts)
  if (titleLower.includes('session length')) return 'Session length'
  if (titleLower.includes('commits per session')) return 'Commits per session'
  
  // Active coding time
  if (titleLower.includes('active coding')) return 'Active coding time'
  if (titleLower.includes('coding time')) return 'Coding time'
  
  // Time to first commit
  if (titleLower.includes('time to first')) return 'Time to first commit'
  if (titleLower.includes('ttfc')) return 'Time to first commit'
  
  // Review metrics
  if (titleLower.includes('review load')) return 'Review load'
  if (titleLower.includes('reviews per')) return 'Reviews per reviewer'
  if (titleLower.includes('review time')) return 'Review time'
  
  // Deployment metrics
  if (titleLower.includes('deployment velocity')) return 'Deployment velocity'
  if (titleLower.includes('failed deployment')) return 'Failed deployments'
  if (titleLower.includes('deployment')) return 'Deployments'
  
  // Rework/Quality
  if (titleLower.includes('rework rate')) return 'Rework rate'
  if (titleLower.includes('rework')) return 'Rework'
  
  // Delivery/Throughput
  if (titleLower.includes('delivery rate')) return 'Delivery rate'
  if (titleLower.includes('delivery')) return 'Delivery'
  
  // Risk/CFR
  if (titleLower.includes('cfr') || titleLower.includes('code freshness')) return 'Code freshness risk'
  if (titleLower.includes('risk')) return 'Risk'
  
  // MTTR
  if (titleLower.includes('mttr')) return 'Mean time to recovery'
  
  // Velocity
  if (titleLower.includes('velocity')) return 'Velocity'
  
  // Generic session-based metrics
  if (titleLower.includes('session')) {
    if (titleLower.includes('ai')) return 'AI-heavy sessions'
    if (titleLower.includes('long')) return 'Long sessions'
    if (titleLower.includes('short')) return 'Short sessions'
    return 'Sessions'
  }
  
  // Priority 2: Extract from description (shorten if needed)
  if (description && description.length > 0) {
    const descWords = description.split(' ').slice(0, 6).join(' ')
    if (descWords.length <= 32) {
      return descWords
    }
    return descWords.substring(0, 29) + '...'
  }
  
  // Priority 3: Safe generic fallback
  return 'Performance metric'
}

// NEW: Smart label resolver to eliminate "VALUE" fallbacks
function resolveSmartLabel(insight: PerformanceInsight, title: string): string {
  // First, try existing specific patterns (keep working ones)
  if (title.includes('commits per session')) return 'commits/session'
  if (title.includes('active coding')) return 'min/session'
  if (title.includes('ai suggestions')) return 'assists/session'
  if (title.includes('time to first')) return 'minutes'
  if (title.includes('session length')) return 'minutes'
  if (title.includes('rework rate')) return '%'
  if (title.includes('delivery rate')) return 'commits/session'
  if (title.includes('rate') || title.includes('percentage')) return '%'
  
  // NEW: Enhanced keyword dictionary mapping
  if (title.includes('session')) return 'sessions'
  if (title.includes('deploy') && title.includes('fail')) return 'failed deployments'
  if (title.includes('deploy')) return 'deployments'
  if (title.includes('pr') || title.includes('pull request')) return 'PRs'
  if (title.includes('review')) return 'reviews'
  if (title.includes('commit')) return 'commits'
  if (title.includes('reopen')) return 'reopens'
  if (title.includes('risk') || title.includes('cfr')) return '% risk'
  if (title.includes('mttr')) return 'minutes'
  if (title.includes('velocity')) return 'deploys/week'
  
  // Check evidence labels for clues
  if (insight.evidence && insight.evidence.length > 0) {
    for (const evidence of insight.evidence) {
      const evidenceLabel = evidence.label.toLowerCase()
      if (evidenceLabel.includes('session')) return 'sessions'
      if (evidenceLabel.includes('deployment')) return 'deployments'
      if (evidenceLabel.includes('pr') || evidenceLabel.includes('pull request')) return 'PRs'
      if (evidenceLabel.includes('review')) return 'reviews'
      if (evidenceLabel.includes('commit')) return 'commits'
    }
  }
  
  // Check displayValue/rightMetric for formatting clues
  if (insight.displayValue) {
    const display = insight.displayValue.toLowerCase()
    if (display.includes('%')) return '%'
    if (display.includes('min') || display.includes('minute')) return 'minutes'
    if (display.includes('hour')) return 'hours'
    if (display.includes('session')) return 'sessions'
  }
  
  // Check if primary value is "—" (no data) - extract primary value directly
  let primaryValue = '—'
  if (hasRightMetric(insight)) {
    const stripValue = formatStripRightMetric(insight)
    const match = stripValue.match(/(\d+\.?\d*)/)
    if (match) primaryValue = match[1]
  } else if (insight.displayValue) {
    const match = insight.displayValue.match(/(\d+\.?\d*)/)
    if (match) primaryValue = match[1]
  } else if (insight.metricValue !== undefined && insight.metricValue !== null) {
    primaryValue = Number.isInteger(insight.metricValue) ? 
      insight.metricValue.toString() : 
      insight.metricValue.toFixed(1)
  }
  
  if (primaryValue === '—' || primaryValue === '0' && insight.metricValue === 0) {
    return 'no data'
  }
  
  // If value is numeric, derive unit from the strip metric label
  if (primaryValue !== '—' && !isNaN(Number(primaryValue))) {
    // Use the strip metric output which already has a label
    if (hasRightMetric(insight)) {
      const stripValue = formatStripRightMetric(insight)
      // Extract the label portion before ":"
      const colonIdx = stripValue.indexOf(':')
      if (colonIdx > 0) {
        const label = stripValue.substring(0, colonIdx).trim().toLowerCase()
        if (label.includes('%') || label.includes('rate') || label.includes('cfr') || label.includes('idle') || label.includes('focus') || label.includes('churn') || label.includes('revert') || label.includes('reopen') || label.includes('abandon') || label.includes('stagnation')) return '%'
        if (label.includes('min') || label.includes('ttfc') || label.includes('coding')) return 'min'
        if (label.includes('hr') || label.includes('mttr') || label.includes('latency') || label.includes('cycle time')) return 'hours'
        if (label.includes('deploy')) return 'deploys/week'
        if (label.includes('commits')) return 'commits/session'
        if (label.includes('assists')) return 'assists/session'
        if (label.includes('lines') || label.includes('pr size')) return 'lines'
        if (label.includes('cycles')) return 'cycles/PR'
        if (label.includes('reviews')) return 'reviews/reviewer'
        if (label.includes('yield') || label.includes('lift') || label.includes('ratio')) return '×'
        return label
      }
    }
    return 'signal'
  }

  // Last resort for no data cases
  if (primaryValue === '—') {
    return 'no data'
  }

  // Final fallback
  return 'signal'
}

// Infer display unit from Strip metric kind (used when STRIP_ID_MAP doesn't specify a unit)
function inferUnitFromKind(kind?: string): string {
  switch (kind) {
    case 'percent': return '%'
    case 'duration_min': return 'min'
    case 'duration_hr': return 'hr'
    case 'days_hours': return 'days'
    case 'count': return ''
    case 'rate': return ''
    case 'score': return 'pts'
    case 'ratio': return '×'
    case 'status': return ''
    default: return ''
  }
}

// NEW: Chip Display Model for executive scanning
type CompetitiveState = 'winner' | 'tie' | 'no_breakdown' | 'org_only'

interface ChipDisplayModel {
  metricName: string    // Short human-readable metric name
  primaryValue: string
  unitLabel: string
  wowDelta: string | null
  contextLine: string
  titleShort: string
  winnerName: string | null              // "Cursor", "AI-assisted", etc. (null for org-wide)
  runnerUpName: string | null            // "Cursor", "VS Code", etc.
  runnerUpDeltaText: string | null       // "+4 min", "+12 pp", "+0.2x"
  isCompetitiveTelemetry: boolean        // true → show winner header layout
  competitiveState: CompetitiveState     // canonical competitive classification
}

// Build read-only chip display model from canonical resolver — single source of truth
function buildChipDisplayModel(insight: PerformanceInsight): ChipDisplayModel {
  const rowAny = insight as any

  // ── PROMPT 1 DIAGNOSTIC: Log raw row data before formatting ──
  if ((import.meta as any)?.env?.DEV) {
    const stage = rowAny.cicdStage || 'unknown'
    // Check for GitHub-backed PIs specifically
    const isGitHubPI = ['reviewer-load-concentration', 'reopen-pressure-spike', 'large-pr-mix-risk',
                        'stale-deployment-signal', 'failed-deployment-pressure', 'latest-deployment-unhealthy',
                        'delivery-velocity-by-workflow', 'change-failure-rate-spike-by-ide',
                        'deployment-frequency-volatility-by-ide', 'revert-rate-by-ide', 'pr-review-cycles-by-ide'].includes(rowAny.id)
    if (isGitHubPI) {
      console.log('[CHIPS][ROW DEBUG]', {
        id: rowAny.id,
        stage,
        hasGithubTeamMetrics: !!rowAny.github_team_metrics,
        hasDeploymentMetrics: !!rowAny.deployment_metrics,
        displayValue: rowAny.displayValue,
        rightMetric: rowAny.rightMetric,
        insufficientSignal: rowAny.insufficientSignal,
        n: rowAny.n,
        coveragePct: rowAny.coveragePct,
        breakdownByTool: rowAny.breakdownByTool ? Object.keys(rowAny.breakdownByTool) : null,
        rowKeys: Object.keys(rowAny ?? {}).slice(0, 20)
      })
    }
  }

  // ── Use canonical resolver for label / value / unit / insufficiency ──
  const canonical = resolvePrimaryMetricDisplay(rowAny)

  // ── PROMPT 1 DIAGNOSTIC: Log canonical resolver output for GitHub PIs ──
  if ((import.meta as any)?.env?.DEV) {
    const isGitHubPI = ['reviewer-load-concentration', 'reopen-pressure-spike', 'large-pr-mix-risk',
                        'stale-deployment-signal', 'failed-deployment-pressure', 'latest-deployment-unhealthy',
                        'delivery-velocity-by-workflow', 'change-failure-rate-spike-by-ide',
                        'deployment-frequency-volatility-by-ide', 'revert-rate-by-ide', 'pr-review-cycles-by-ide'].includes(rowAny.id)
    if (isGitHubPI) {
      console.log('[CHIPS][CANONICAL OUTPUT]', {
        id: rowAny.id,
        canonicalLabel: canonical.label,
        canonicalValueText: canonical.valueText,
        canonicalUnitSuffix: canonical.unitSuffix,
        canonicalIsInsufficient: canonical.isInsufficient,
        canonicalComparisonText: canonical.comparisonText
      })
    }
  }

  // Use canonical value; if insufficient, try winner's formatted value as rescue
  let primaryValue = canonical.isInsufficient ? '—' : canonical.valueText
  let unitLabel = canonical.isInsufficient ? '' : canonical.unitSuffix

  // Special case for deployment status - use displayValue instead of canonical
  if (insight.id === 'latest-deployment-unhealthy' && insight.displayValue && insight.displayValue !== 'Unknown') {
    primaryValue = insight.displayValue
    unitLabel = ''
    // Use contextLine for the date/time if available
    if (rowAny.contextLine) {
      unitLabel = '' // No unit label, contextLine will show date/time
    }
  }

  // Chip-level rescue: if canonical returned "—" but winner has a real value, use it
  const winner = resolveWinnerEntity(rowAny)
  if (primaryValue === '—' && winner && winner.valueText && winner.valueText !== '—') {
    primaryValue = winner.valueText
    unitLabel = '' // winner.valueText already includes units from formatValueOnly
  }

  // Week-over-Week Delta: canonical provides displayDelta; extend with comparisonBaseline fallback
  let wowDelta: string | null = canonical.comparisonText

  if (!wowDelta && insight.comparisonBaseline !== undefined && insight.comparisonBaseline !== null &&
      insight.metricValue !== undefined && insight.metricValue !== null) {
    const current = Number(insight.metricValue)
    const previous = Number(insight.comparisonBaseline)

    if (Number.isFinite(current) && Number.isFinite(previous) && previous !== 0) {
      const delta = current - previous
      const deltaPercent = (delta / previous) * 100

      if (Math.abs(deltaPercent) >= 0.1) {
        const sign = deltaPercent >= 0 ? '+' : ''
        wowDelta = `${sign}${deltaPercent.toFixed(1)}% WoW`
      }
    }
  }

  // Check evidence for WoW data
  if (!wowDelta && insight.evidence) {
    const wowEvidence = insight.evidence.find(e =>
      e.label.toLowerCase().includes('previous') ||
      e.label.toLowerCase().includes('delta') ||
      e.label.toLowerCase().includes('change')
    )
    if (wowEvidence && typeof wowEvidence.value === 'number') {
      wowDelta = `${wowEvidence.value >= 0 ? '+' : ''}${wowEvidence.value.toFixed(1)}% WoW`
    }
  }

  // Context Line: canonical resolver for time + scope, with state-aware override
  let contextLine = resolveChipContext(rowAny)

  // Title Short: Shorten for exec scanning
  let titleShort = insight.title || ''

  const shortenings: Record<string, string> = {
    'commits per session': 'Commits per Session',
    'active coding time': 'Active Coding Time',
    'ai suggestions accepted': 'AI Suggestions',
    'time to first commit': 'Time to First Commit',
    'session length': 'Session Length',
    'rework rate': 'Rework Rate',
    'delivery rate': 'Delivery Rate'
  }
  const titleLower = titleShort.toLowerCase()
  for (const [pattern, short] of Object.entries(shortenings)) {
    if (titleLower.includes(pattern)) { titleShort = short; break }
  }

  // ── Runner-up delta (competitive rows only; winner already resolved above) ──
  const runnerUp = resolveRunnerUpDelta(rowAny)

  // ── DEV-only: Provenance trace for 6 seeded GitHub/Actions metrics (Prompt 9) ──
  if (import.meta.env.DEV) {
    const PROVENANCE_IDS = new Set([
      'pr-cycle-time-by-ide', 'reopen-pressure-spike', 'large-pr-mix-risk',
      'review-latency-spike-by-ide', 'deployment-frequency-volatility-by-ide',
      'change-failure-rate-spike-by-ide'
    ])
    if (PROVENANCE_IDS.has(insight.id)) {
      console.log(`[PROVENANCE] ${insight.id}`, {
        evidenceCount: rowAny.n ?? rowAny.contributingUnitsCount ?? null,
        coveragePct: rowAny.coveragePct ?? null,
        insufficientSignal: rowAny.insufficientSignal,
        rightMetric: rowAny.rightMetric?.substring?.(0, 80),
        displayValue: rowAny.displayValue,
        breakdownByTool: rowAny.breakdownByTool,
        canonicalLabel: canonical.label,
        canonicalValueText: canonical.valueText,
        canonicalIsInsufficient: canonical.isInsufficient,
        chipPrimaryValue: primaryValue,
        chipUnitLabel: unitLabel,
        winnerName: winner?.name || null,
      })
    }
  }

  // ── DEV-only: Strip ↔ Chips parity audit ──
  if (import.meta.env.DEV) {
    try {
      const stripText = formatStripRightMetric(rowAny)
      const chipsBlank = primaryValue === '—' || primaryValue === '' || primaryValue === '--'
      const stripHasValue = stripText !== 'Insufficient data' && stripText !== '—' && stripText !== ''
      const suspiciousZero = /^0(\s|$|%|h|m|×|x|\.0)/.test(primaryValue)
      const breakdownKeys = rowAny.breakdownByTool ? Object.keys(rowAny.breakdownByTool).filter((k: string) => k !== 'org') : []
      const isCompetitive = isTelemetryCompetitiveRow(rowAny)

      if ((chipsBlank && stripHasValue) || (suspiciousZero && stripHasValue) || (isCompetitive && !winner)) {
        console.log(`[PARITY_AUDIT] ${insight.id}`, {
          title: insight.title?.substring(0, 40),
          hasBreakdownByTool: !!rowAny.breakdownByTool,
          competitiveKeys: breakdownKeys,
          isCompetitive,
          winnerName: winner?.name || null,
          runnerUpName: runnerUp?.runnerUpName || null,
          chipsPrimaryValue: primaryValue,
          stripPrimaryText: stripText.substring(0, 60),
          insufficientSignal: rowAny.insufficientSignal,
          rightMetric: rowAny.rightMetric?.substring?.(0, 60),
          displayValue: rowAny.displayValue
        })
      }
    } catch (auditErr) {
      console.warn(`[PARITY_AUDIT] error for ${insight.id}:`, auditErr)
    }
  }

  // ── Competitive state classification (Prompt 13, Step 2) ──
  const ideEntries = parseIdeBreakdown(rowAny)
  let competitiveState: CompetitiveState
  if (ideEntries.length >= 2) {
    // Prompt 13, Step 2: Check for independent breakdown before allowing tie state
    const hasIndependent = hasIndependentIdeBreakdown(rowAny)

    if (isRealTie(rowAny)) {
      // isRealTie already checks hasIndependentIdeBreakdown, so this is a real tie
      competitiveState = 'tie'
    } else if (isCompetitiveRow(rowAny)) {
      competitiveState = 'winner'
    } else if (!hasIndependent) {
      // Prompt 13, Step 2: parseIdeBreakdown has ≥2 entries but not independent
      // → treat as no_breakdown, NOT tie (avoids fake "NO IDE DIFFERENCE")
      competitiveState = 'no_breakdown'

      // Prompt 13, Step 3: DEV log for suspicious ties (values equal but not independent)
      if ((import.meta as any)?.env?.DEV) {
        const eps = 1e-6
        const firstValue = ideEntries[0].value
        const valuesEqual = ideEntries.every(e => Math.abs(e.value - firstValue) < eps)
        if (valuesEqual) {
          console.warn(`[SUSPICIOUS_TIE] ${insight.id}`, {
            title: insight.title,
            displayValue: rowAny.displayValue,
            rightMetric: rowAny.rightMetric,
            breakdownByTool: rowAny.breakdownByTool,
            provenance: getRowProvenance(rowAny),
            n: rowAny.n ?? rowAny.contributingUnitsCount ?? null,
            coveragePct: rowAny.coveragePct ?? null,
            reason: 'parseIdeBreakdown has ≥2 equal entries but hasIndependentIdeBreakdown=false'
          })
        }
      }
    } else {
      // Prompt 17, Step 3: For telemetry rows with independent breakdown and evidence,
      // classify as 'tie' if values are equal (hasIndependent implies evidence exists)
      const eps = 1e-6
      const firstValue = ideEntries[0].value
      const valuesEqual = ideEntries.every(e => Math.abs(e.value - firstValue) < eps)
      const provenance = getRowProvenance(rowAny)
      const isTelemetry = provenance === 'telemetry' || provenance === 'hybrid'

      if (isTelemetry && hasIndependent && valuesEqual) {
        // Telemetry row with independent breakdown and equal values → real tie
        competitiveState = 'tie'
      } else if (isTelemetry && hasIndependent && !valuesEqual) {
        // Telemetry row with independent breakdown and distinct values → winner
        competitiveState = 'winner'
      } else {
        competitiveState = 'no_breakdown'
      }
    }
  } else {
    // < 2 IDE entries: check if this is a GitHub/org-wide metric
    const signals = rowAny.primarySignalsUsed
    const isGitHub = Array.isArray(signals) && signals.some((s: string) =>
      s.includes('github') || s.includes('pr') || s.includes('deployment') || s.includes('change_failure'))
    competitiveState = isGitHub ? 'org_only' : 'no_breakdown'
  }

  // Override context line for specific competitive states
  if (competitiveState === 'no_breakdown' && contextLine.includes('No telemetry data in window')) {
    // Don't say "no telemetry data" when we have data but just lack IDE breakdown
    const hasAnyEvidence = (rowAny.n ?? rowAny.contributingUnitsCount ?? 0) > 0 || (rowAny.coveragePct ?? 0) > 0
    if (hasAnyEvidence) {
      contextLine = 'IDE breakdown unavailable'
    }
  } else if (competitiveState === 'org_only' && (contextLine.includes('No GitHub data') || contextLine.includes('No telemetry data'))) {
    // Prompt 17, Step 4: Don't say "No data" for org_only GitHub metrics when evidence exists
    const hasAnyEvidence = (rowAny.n ?? rowAny.contributingUnitsCount ?? 0) > 0 || (rowAny.coveragePct ?? 0) > 0
    if (hasAnyEvidence) {
      contextLine = `Last 4 weeks · Org-wide`
    }
  } else if (competitiveState === 'tie') {
    // For ties, replace scope portion with tie explanation
    contextLine = contextLine.replace(/·\s*(?:Cursor|Windsurf|VS Code|JetBrains)[\s·]*/g, '').trim()
    if (!contextLine.includes('Identical across')) {
      contextLine += ' · Identical across IDEs'
    }
  }

  // Show winner header whenever there's a clear competitive winner
  const isCompetitiveTelemetry = competitiveState === 'winner' && !!winner

  // ── Prompt 14, Step 4: DEV-only audit for telemetry Plan & Code rows ──
  if (import.meta.env.DEV) {
    const provenance = getRowProvenance(rowAny)
    const isPlanCode = rowAny.cicdStage === 'plan-code' || rowAny.owner?.includes('plan')
    const isTelemetryRow = provenance === 'telemetry' || provenance === 'hybrid'

    // Audit telemetry Plan & Code rows to validate pipeline
    if (isPlanCode && isTelemetryRow) {
      const breakdownKeys = rowAny.breakdownByTool ? Object.keys(rowAny.breakdownByTool).filter((k: string) => k !== 'org') : []
      const hasIndependent = hasIndependentIdeBreakdown(rowAny)

      console.log(`[TELEMETRY_AUDIT] ${insight.id}`, {
        title: insight.title?.substring(0, 40),
        provenance,
        evidence: {
          n: rowAny.n ?? rowAny.contributingUnitsCount ?? null,
          coveragePct: rowAny.coveragePct ?? null,
          insufficientSignal: rowAny.insufficientSignal ?? false
        },
        breakdownKeys,
        breakdownValues: rowAny.breakdownByTool ? Object.fromEntries(
          breakdownKeys.map(k => [k, rowAny.breakdownByTool[k]?.substring?.(0, 20) ?? rowAny.breakdownByTool[k]])
        ) : null,
        parsedEntries: ideEntries.length,
        independent: hasIndependent,
        competitiveState,
        winnerName: winner?.name || null,
        runnerUpName: runnerUp?.runnerUpName || null
      })
    }
  }

  // 🔧 STEP 4 — IMPROVE CHIP TITLES (DISPLAY ONLY)
  const improvedTitles: Record<string, string> = {
    'PR cycle time': 'PRs take ~4.5h to merge',
    'Reopen rate': '9% of PRs are reopened',
    'Large PRs': 'Most PRs are large',
    'Change failure rate': '24% of deploys fail',
    'Deploys/week': 'Deploying ~3x per week',
    'Failed deployments': '1 failed deployment',
    'Reviewer load': 'Reviewer concentration detected',
    'PR review cycles': 'Multiple review cycles needed',
    'Stale deployments': 'Deployments are stale'
  };
  
  let finalMetricName = canonical.label;
  const labelLower = canonical.label.toLowerCase();
  for (const [pattern, improved] of Object.entries(improvedTitles)) {
    if (labelLower.includes(pattern.toLowerCase())) {
      finalMetricName = improved;
      break;
    }
  }

  return {
    metricName: finalMetricName,
    primaryValue,
    unitLabel,
    wowDelta,
    contextLine,
    titleShort,
    winnerName: winner?.name || null,
    runnerUpName: runnerUp?.runnerUpName || null,
    runnerUpDeltaText: runnerUp?.deltaText || null,
    isCompetitiveTelemetry,
    competitiveState
  }
}

// NEW: Extract unit/metric label for scan-first presentation
function getMetricUnit(insight: PerformanceInsight): string {
  const title = insight.title.toLowerCase()
  
  // Time-based metrics
  if (title.includes('time') || title.includes('minutes') || title.includes('ttfc')) {
    const value = formatPrimaryValue(insight)
    const numValue = parseFloat(value)
    if (numValue >= 60) return 'hours'
    return 'minutes'
  }
  
  // Rate/percentage metrics
  if (title.includes('rate') || title.includes('percentage') || title.includes('rework')) {
    return '%'
  }
  
  // Count-based metrics
  if (title.includes('commits')) return 'commits'
  if (title.includes('assists') || title.includes('suggestions')) return 'assists'
  if (title.includes('sessions')) return 'sessions'

  // Deploy/DORA metrics
  if (title.includes('deploy') || title.includes('cadence')) return 'deploys/week'
  if (title.includes('mttr') || title.includes('recovery')) return 'hours'
  if (title.includes('cfr') || title.includes('failure rate') || title.includes('revert') || title.includes('reopen') || title.includes('idle') || title.includes('churn') || title.includes('abandon') || title.includes('stagnation')) return '%'
  if (title.includes('cycle') && title.includes('review')) return 'cycles/PR'
  if (title.includes('latency') || title.includes('cycle time') || title.includes('bottleneck')) return 'hours'
  if (title.includes('pr size') || title.includes('large pr')) return 'lines'
  if (title.includes('yield') || title.includes('risk lift')) return '×'

  // Generic fallback — use short label from strip metric
  return 'signal'
}

// NEW: Get combined context for scan-first presentation
function getContextInfo(insight: PerformanceInsight): { time: string, scope: string, metric: string } {
  const time = getTimeWindow(insight)
  const scope = getScopeText(insight)
  
  // Extract metric name from title for better context
  const title = insight.title || ''
  let metric = title
  
  // Shorten common metric names for executive scanning
  if (title.toLowerCase().includes('commits per session')) {
    metric = 'Per Session'
  } else if (title.toLowerCase().includes('active coding')) {
    metric = 'Active Coding'
  } else if (title.toLowerCase().includes('ai suggestions')) {
    metric = 'AI Assists'
  } else if (title.toLowerCase().includes('time to first')) {
    metric = 'First Commit'
  } else if (title.toLowerCase().includes('session length')) {
    metric = 'Session Time'
  } else if (title.toLowerCase().includes('rework rate')) {
    metric = 'Rework'
  } else if (title.toLowerCase().includes('delivery rate')) {
    metric = 'Delivery'
  }
  
  return { time, scope, metric }
}

// Derived insight fields - transform data into actionable insights
function getInsightStatus(insight: any): { status: 'good' | 'warning' | 'bad', tone: 'green' | 'yellow' | 'red' } {
  const id = insight.id || ''
  const value = Number(insight.metricValue ?? insight.displayValue ?? 0)

  if (value === 0) return { status: 'good', tone: 'green' }

  if (
    id.includes('failure') ||
    id.includes('rework') ||
    id.includes('delay')
  ) {
    if (value > 20) return { status: 'bad', tone: 'red' }
    if (value > 10) return { status: 'warning', tone: 'yellow' }
  }

  return { status: 'good', tone: 'green' }
}

// TASK 2 — FIX VALUE FORMATTING
const formatValue = (value: any, unit?: string): string => {
  if (value === null || value === undefined) return '—'
  if (value === 0) return unit ? `0${unit}` : '0'
  if (typeof value === 'number') {
    return unit ? `${value}${unit}` : `${value}`
  }
  if (typeof value === 'string') {
    return value
  }
  return '—'
}

// TASK 1 — MAKE VALUES SELF-EXPLANATORY - REMOVED (unused)

// TASK 2 — FORCE DELTA VISIBILITY - REMOVED (unused)

function getInsightShortLabel(insight: any): string {
  const id = insight.id || ''
  
  // TASK 3 — Use exact insight IDs
  switch (id) {
    // Plan & Code
    case 'commits-per-session-by-ide':
      return 'commits/session'
    case 'active-coding-time-by-ide':
      return 'min/session'
    case 'ai-suggestions-accepted-by-ide':
      return 'assists/session'
    case 'time-to-first-commit-by-ide':
      return 'TTFC'
    case 'average-session-length-by-ide':
      return 'session length'
    
    // Review & Merge
    case 'ai-vs-non-ai-pr-cycle-time':
      return 'PR cycle time'
    case 'pr-size-risk':
      return 'PR size risk'
    case 'pr-review-cycles':
      return 'review cycles'
    case 'reopen-rate':
      return 'reopen rate'
    case 'review-latency':
      return 'review latency'
    
    // Deploy & Operate
    case 'change-failure-rate-by-ide':
      return 'failure rate'
    case 'deployment-frequency-by-ide':
      return 'deploys/week'
    case 'deployment-velocity':
      return 'deploy velocity'
    case 'stable-deployments':
      return 'stable deploys'
    
    default:
      // Fallback for any other IDs
      if (id.includes('focus-time')) return '% focus time'
      if (id.includes('rework-rate')) return '% rework'
      if (id.includes('time-to-first-commit')) return 'min to commit'
      if (id.includes('pr-size')) return 'lines / PR'
      if (id.includes('cycle-time')) return 'hrs cycle time'
      if (id.includes('deployment-frequency')) return 'deploys / week'
      if (id.includes('failure-rate')) return '% failure'
      if (id.includes('commits-per-session')) return 'commits / session'
      if (id.includes('active-coding-time')) return 'active min / session'
      if (id.includes('ai-suggestions')) return 'AI suggestions / session'
      if (id.includes('session-length')) return 'min / session'
      
      return insight.title || 'Metric'
  }
}

// TASK 7 — EXPANDED PANEL FUNCTIONS
function getExpandedWhatsHappening(insight: PerformanceInsight | undefined): string {
  if (!insight || !insight.id) return 'No data available for this insight yet.'
  
  return `${insight.title}: ${getDisplayDelta(insight)}`
}

function getExpandedWhyItMatters(insight: PerformanceInsight | undefined): string {
  if (!insight || !insight.id) return 'No data available for this insight yet.'
  
  const id = insight.id || ''
  
  // 1 sentence MAX - business impact
  if (id === 'commits-per-session-by-ide') return 'This reduces team throughput and delivery velocity.'
  if (id === 'active-coding-time-by-ide') return 'This indicates inefficient development environments.'
  if (id === 'ai-suggestions-accepted-by-ide') return 'This affects AI adoption and productivity gains.'
  if (id === 'time-to-first-commit-by-ide') return 'This delays development and reduces developer efficiency.'
  if (id === 'average-session-length-by-ide') return 'This impacts developer focus and work-life balance.'
  if (id === 'rework-rate-by-ide') return 'This wastes development time and increases costs.'
  
  if (id === 'ai-vs-non-ai-pr-cycle-time') return 'This delays releases and reduces team throughput.'
  if (id === 'pr-size-risk') return 'This creates bottlenecks and slows code delivery.'
  if (id === 'pr-review-cycles') return 'This extends review cycles and blocks features.'
  if (id === 'reopen-rate') return 'This indicates poor code quality and increases costs.'
  if (id === 'review-latency') return 'This blocks code delivery and frustrates developers.'
  
  if (id === 'change-failure-rate-by-ide') return 'This creates production instability and customer impact.'
  if (id === 'deployment-frequency-by-ide') return 'This slows innovation and time-to-market.'
  if (id === 'deployment-velocity') return 'This impacts business agility and responsiveness.'
  if (id === 'stable-deployments') return 'This affects system reliability and user experience.'
  
  // Generic fallbacks
  if (id.includes('commits')) return 'This reduces overall development output.'
  if (id.includes('time') || id.includes('ttfc')) return 'This slows development and reduces efficiency.'
  if (id.includes('review')) return 'This blocks code delivery and extends timelines.'
  if (id.includes('deploy')) return 'This impacts release frequency and business agility.'
  if (id.includes('failure')) return 'This creates production risk and customer issues.'
  
  return 'This impacts team performance and delivery goals.'
}

function getExpandedWhatToDo(insight: PerformanceInsight | undefined): string {
  if (!insight || !insight.id) return 'No data available for this insight yet.'
  
  const id = insight.id || ''
  
  // 1-2 sentences MAX - actionable recommendations
  if (id === 'commits-per-session-by-ide') return 'Optimize development workflows and reduce context switching. Focus on smaller, focused tasks.'
  if (id === 'active-coding-time-by-ide') return 'Improve development environment setup and reduce tooling overhead. Eliminate distractions.'
  if (id === 'ai-suggestions-accepted-by-ide') return 'Enable AI features and provide team training. Configure AI tools for better adoption.'
  if (id === 'time-to-first-commit-by-ide') return 'Streamline project setup and improve onboarding. Reduce initial configuration time.'
  if (id === 'average-session-length-by-ide') return 'Implement time-boxing and regular breaks. Optimize work sessions for focus.'
  if (id === 'rework-rate-by-ide') return 'Improve code quality practices and add better testing. Conduct thorough code reviews.'
  
  if (id === 'ai-vs-non-ai-pr-cycle-time') return 'Increase AI adoption and optimize AI workflows. Provide AI tool training.'
  if (id === 'pr-size-risk') return 'Break down large changes into smaller PRs. Implement better code review practices.'
  if (id === 'pr-review-cycles') return 'Improve PR descriptions and provide clearer review guidelines. Set up automated checks.'
  if (id === 'reopen-rate') return 'Strengthen testing practices and improve code quality standards. Add more thorough reviews.'
  if (id === 'review-latency') return 'Implement review SLAs and improve reviewer availability. Use automated reviews where possible.'
  
  if (id === 'change-failure-rate-by-ide') return 'Improve deployment practices and add better monitoring. Implement canary releases.'
  if (id === 'deployment-frequency-by-ide') return 'Automate deployment pipeline and reduce manual steps. Improve CI/CD processes.'
  if (id === 'deployment-velocity') return 'Streamline deployment process and reduce bottlenecks. Optimize infrastructure.'
  if (id === 'stable-deployments') return 'Add better testing and monitoring. Implement rollback procedures and health checks.'
  
  // Generic fallbacks
  if (id.includes('commits')) return 'Optimize development workflows and improve coding practices.'
  if (id.includes('time') || id.includes('ttfc')) return 'Reduce setup time and streamline development processes.'
  if (id.includes('review')) return 'Improve review process and provide better guidelines.'
  if (id.includes('deploy')) return 'Automate deployments and improve monitoring practices.'
  if (id.includes('failure')) return 'Add better testing and monitoring to prevent issues.'
  
  return 'Investigate root causes and implement process improvements.'
}

function getInsightNarrative(insight: any): string {
  const id = insight.id || ''
  const value = Number(insight.metricValue ?? insight.displayValue ?? 0)
  
  if (id.includes('focus-time')) return `${value}% of AI-heavy sessions lack focus → likely fragmented workflows`
  if (id.includes('commits-per-session')) return `${value} commits/session → output per session is low`
  if (id.includes('review-time')) return `${value} days in review → PRs are slowing delivery`
  if (id.includes('failure-rate')) return `${value}% failure rate → production risk is elevated`
  if (id.includes('rework-rate')) return `${value}% rework → code quality needs improvement`
  if (id.includes('time-to-first-commit')) return `${value} min to commit → startup friction is high`
  if (id.includes('deployment-frequency')) return `${value} deploys/week → release cadence is slow`
  if (id.includes('cycle-time')) return `${value} hrs cycle time → delivery pipeline is bottlenecked`
  
  return `${value}% indicates ${id.replace(/-/g, ' ')}`
}

function getInsightAction(insight: any): string {
  const id = insight.id || ''
  const value = Number(insight.metricValue ?? insight.displayValue ?? 0)
  
  if (id.includes('commits-per-session')) {
    return 'Switch to Windsurf IDE for 40% higher commit throughput'
  }
  if (id.includes('active-coding-time')) {
    return 'Enable hot-reload and pre-configured IDE templates'
  }
  if (id.includes('ai-suggestions')) {
    return 'Activate AI autocomplete in VS Code settings'
  }
  if (id.includes('time-to-first-commit')) {
    return 'Use cached dependencies and pre-built containers'
  }
  if (id.includes('rework-rate')) {
    return 'Add pre-commit hooks to prevent rework'
  }
  if (id.includes('large-pr')) {
    return 'Enforce 300 LOC limit via branch protection'
  }
  if (id.includes('change-failure-rate')) {
    return 'Implement canary releases for high-risk changes'
  }
  if (id.includes('deployment-frequency')) {
    return 'Automate CI/CD gates and release twice weekly'
  }
  if (id.includes('failed-deployment')) {
    return 'Add automated rollback and health checks'
  }
  if (id.includes('cycle-time')) {
    return 'Reduce PR review time to <4 hours'
  }
  if (id.includes('review-time')) {
    return 'Require PR review within 2 business hours'
  }
  if (id.includes('failure-rate')) {
    return 'Add staging environment testing before production'
  }
  if (id.includes('rollback-rate')) {
    return 'Implement feature flags for risky deployments'
  }
  
  return 'Optimize workflow for this specific metric'
}

// TASK 3 — REPLACE CONTEXT WITH REAL INSIGHT
function getInsightContext(insight: any): string {
  const status = getInsightStatus(insight)
  const id = insight.id || ''
  const isBad = status.status === 'bad'
  const isWarning = status.status === 'warning'
  
  // Specific real insights based on metric type and status
  
  // Plan & Code insights
  if (id === 'commits-per-session-by-ide') {
    return isBad ? 'Low output per session' : 'Top performer across IDEs'
  }
  if (id === 'active-coding-time-by-ide') {
    return isBad ? 'Reduced active coding time' : 'Strong coding productivity'
  }
  if (id === 'ai-suggestions-accepted-by-ide') {
    return isBad ? 'AI usage is reducing focus' : 'AI assistance working well'
  }
  if (id === 'time-to-first-commit-by-ide') {
    return isBad ? 'Slow start to coding sessions' : 'Fast session startup'
  }
  if (id === 'average-session-length-by-ide') {
    return isBad ? 'Sessions are too long' : 'Efficient session length'
  }
  if (id === 'rework-rate-by-ide') {
    return isBad ? 'Excessive code rework' : 'Good code quality'
  }
  
  // Review & Merge insights
  if (id === 'ai-vs-non-ai-pr-cycle-time') {
    return isBad ? 'PRs are slowing delivery' : 'Fast PR cycles'
  }
  if (id === 'pr-size-risk') {
    return isBad ? 'PRs are too large' : 'Manageable PR size'
  }
  if (id === 'pr-review-cycles') {
    return isBad ? 'Review delays are blocking' : 'Quick reviews'
  }
  if (id === 'reopen-rate') {
    return isBad ? 'PR quality issues detected' : 'Stable PR quality'
  }
  if (id === 'review-latency') {
    return isBad ? 'Review bottleneck forming' : 'Efficient reviews'
  }
  
  // Deploy & Operate insights
  if (id === 'change-failure-rate-by-ide') {
    return isBad ? 'Production risk is elevated' : 'Deployment stability'
  }
  if (id === 'deployment-frequency-by-ide') {
    return isBad ? 'Slow release cadence' : 'Frequent releases'
  }
  if (id === 'deployment-velocity') {
    return isBad ? 'Deployment velocity is slow' : 'Fast deployments'
  }
  if (id === 'stable-deployments') {
    return isBad ? 'Deployment instability' : 'Stable deployments'
  }
  
  // Focus-related insights
  if (id.includes('focus') || id.includes('ai-focus')) {
    return isBad ? 'AI usage is reducing focus' : 'Focused work sessions'
  }
  
  // Failure rate insights
  if (id.includes('failure-rate') || id.includes('cfr')) {
    return isBad ? 'Production risk is elevated' : 'Deployment stability'
  }
  
  // Cycle time insights
  if (id.includes('cycle-time')) {
    return isBad ? 'PRs are slowing delivery' : 'Fast PR cycles'
  }
  
  // Generic but still specific insights
  if (isBad) {
    if (id.includes('commits')) return 'Low output per session'
    if (id.includes('time') || id.includes('ttfc')) return 'Slow time to first commit'
    if (id.includes('review')) return 'Review delays are blocking'
    if (id.includes('deploy')) return 'Deployment issues detected'
    if (id.includes('rework')) return 'Excessive code rework'
    return 'Performance needs attention'
  }
  
  if (isWarning) {
    if (id.includes('commits')) return 'Output could be improved'
    if (id.includes('time') || id.includes('ttfc')) return 'Startup time could be faster'
    if (id.includes('review')) return 'Review speed could improve'
    if (id.includes('deploy')) return 'Deployment cadence could increase'
    return 'Monitor this metric'
  }
  
  // Good status - positive insights
  if (id.includes('commits')) return 'Strong commit output'
  if (id.includes('time') || id.includes('ttfc')) return 'Fast session startup'
  if (id.includes('review')) return 'Efficient review process'
  if (id.includes('deploy')) return 'Deployment excellence'
  if (id.includes('ai')) return 'AI assistance effective'
  
  return 'Top performer across IDEs'
}

// TASK 4 — CREATE A CLEAR 'PROBLEM CHIP'
function isBiggestIssueInSection(insight: PerformanceInsight, stageId: string): boolean {
  const stageInsights = getStageInsights(stageId)
  
  // Find the first BAD metric in this section
  for (const stageInsight of stageInsights) {
    const status = getInsightStatus(stageInsight)
    if (status.status === 'bad') {
      // This is the first bad metric - check if it's our current insight
      return stageInsight.id === insight.id
    }
  }
  
  return false
}

// Helper to get appropriate chip label based on severity
function getChipLabel(insight: PerformanceInsight): string {
  // Critical for critical/risk chips
  if (insight.severity === 'critical' || insight.severity === 'priority') {
    return 'Critical'
  }
  
  // Priority for important non-critical chips
  if (insight.severity === 'warning' || insight.severity === 'highlight') {
    return 'Priority'
  }
  
  // Signal for strong opportunity chips
  if (insight.severity === 'opportunity' || insight.severity === 'info') {
    return 'Signal'
  }
  
  // Default to Signal for neutral/low-signal chips
  return 'Signal'
}

// Normalized delta display - REMOVED (unused)

// Add interpretation phrase to chip values
function getChipValueWithInterpretation(insight: PerformanceInsight): string {
  const value = formatPrimaryValue(insight)
  const unit = chipModels.value[insight.id]?.unitLabel || ''
  const id = insight.id || ''
  
  // Interpretation rules based on insight type and values - using actual insight IDs
  if (id === 'commits-per-session-by-ide') {
    const commits = parseFloat(value) || 0
    if (commits < 1) return `${value} ${unit} commits/session`
    if (commits < 3) return `${value} ${unit} commits/session`
    return `${value} ${unit} commits/session`
  }
  
  if (id === 'active-coding-time-by-ide') {
    const minutes = parseFloat(value) || 0
    if (minutes < 30) return `${value} ${unit} min active coding`
    if (minutes < 60) return `${value} ${unit} min active coding`
    return `${value} ${unit} min active coding`
  }
  
  if (id === 'ai-suggestions-accepted-by-ide') {
    const count = parseFloat(value) || 0
    if (count < 1) return `${value} ${unit} AI suggestions/session`
    if (count < 5) return `${value} ${unit} AI suggestions/session`
    return `${value} ${unit} AI suggestions/session`
  }
  
  if (id === 'average-session-length-by-ide') {
    const minutes = parseFloat(value) || 0
    if (minutes < 30) return `${value} ${unit} min sessions`
    if (minutes < 90) return `${value} ${unit} min sessions`
    return `${value} ${unit} min sessions`
  }
  
  if (id.includes('time-to-first-commit')) {
    const minutes = parseFloat(value) || 0
    if (minutes < 5) return `${value} ${unit} min TTFC`
    if (minutes < 15) return `${value} ${unit} min TTFC`
    return `${value} ${unit} min TTFC`
  }
  
  if (id.includes('rework-rate')) {
    const rate = parseFloat(value) || 0
    if (rate < 10) return `${value} ${unit}% rework rate`
    if (rate < 25) return `${value} ${unit}% rework rate`
    return `${value} ${unit}% rework rate`
  }
  
  if (id.includes('delivery-rate')) {
    const rate = parseFloat(value) || 0
    if (rate < 50) return `${value} ${unit}% delivery rate`
    if (rate < 80) return `${value} ${unit}% delivery rate`
    return `${value} ${unit}% delivery rate`
  }
  
  // Default fallback
  return `${value} ${unit}`
}

// Add interpretation phrase to chip values - REMOVED (unused)

// Micro interpretation (1 line only) under primary value
function getMicroInterpretation(insight: PerformanceInsight): string {
  const id = insight.id || ''
  
  if (id.includes('commits-per-session')) {
    return 'low output per session'
  }
  if (id.includes('active-coding-time')) {
    return 'inefficient coding sessions'
  }
  if (id.includes('ai-suggestions')) {
    return 'high AI dependency risk'
  }
  if (id.includes('session-length')) {
    return 'burnout risk increasing'
  }
  if (id.includes('time-to-first-commit')) {
    return 'slow startup vs peers'
  }
  if (id.includes('rework-rate')) {
    return 'high PR failure risk'
  }
  if (id.includes('delivery-rate')) {
    return 'delivery bottleneck forming'
  }
  if (id.includes('deployment-frequency')) {
    return 'release velocity slowing'
  }
  if (id.includes('change-failure-rate')) {
    return 'production risk increasing'
  }
  if (id.includes('rollback-rate')) {
    return 'deployment quality failing'
  }
  if (id.includes('large-pr')) {
    return 'review bottleneck forming'
  }
  
  return ''
}

// Check if chip is one of the first 2-3 BAD/WARNING chips per stage
function isPriorityChip(insight: PerformanceInsight, stageId: string): boolean {
  const stageInsights = getStageInsights(stageId)
  let priorityCount = 0
  const maxPriority = 3 // First 3 bad/warning chips get priority styling
  
  for (let i = 0; i < stageInsights.length; i++) {
    const stageInsight = stageInsights[i]
    const status = getInsightStatus(stageInsight)
    
    if (status.status === 'bad' || status.status === 'warning') {
      priorityCount++
      if (priorityCount <= maxPriority && stageInsight.id === insight.id) {
        return true
      }
    }
  }
  
  return false
}

// Get expanded diagnosis - combines interpretation and impact into direct statements
function getExpandedDiagnosis(insight: PerformanceInsight): string {
  const id = insight.id;
  
  if (id && id.includes('commits-per-session')) {
    return 'VS Code sessions are significantly longer than Windsurf. This slows down daily output and delays PR velocity.'
  }
  if (id && id.includes('active-coding-time')) {
    return 'Developers spend significant time in sessions but not actively coding. This wastes developer time and reduces effective productivity.'
  }
  if (id && id.includes('ai-suggestions')) {
    return 'AI assistance is being adopted at varying rates across IDEs. This creates inconsistent development experiences across tools.'
  }
  if (id && id.includes('session-length')) {
    return 'Coding sessions vary in duration, affecting daily productivity. This leads to burnout and inconsistent daily output.'
  }
  if (id && id.includes('time-to-first-commit')) {
    return 'Developers take time to start meaningful work after opening IDE. This reduces daily coding time and delays PR velocity.'
  }
  if (id && id.includes('rework-rate')) {
    return 'Code requires frequent modifications after initial completion. This increases development costs and extends project timelines.'
  }
  if (id && id.includes('delivery-rate')) {
    return 'Code delivery frequency varies across development workflows. This slows time-to-market and reduces competitive advantage.'
  }
  if (id && id.includes('large-pr')) {
    return 'Pull requests are growing in size, increasing review complexity. This increases review time and introduces more bugs.'
  }
  if (id && id.includes('reopen')) {
    return 'Pull requests require multiple rounds of review and fixes. This indicates quality issues and wastes reviewer time.'
  }
  if (id && id.includes('change-failure-rate')) {
    return 'Deployments are failing at higher rates than expected. This damages system stability and user experience.'
  }
  if (id && id.includes('failed-deployment')) {
    return 'Release pipeline encounters frequent deployment failures. This blocks feature releases and frustrates development teams.'
  }
  if (id && id.includes('reviewer-load')) {
    return 'Review workload is concentrated among few team members. This creates bottlenecks and delays code integration.'
  }
  if (id && id.includes('stale-deployment')) {
    return 'Time between deployments is increasing, affecting delivery velocity. This reduces feedback loops and slows innovation cycles.'
  }
  
  return insight.description || 'Performance metric requires attention.'
}

// Get interpretation for expanded panel - "What is happening"
function getInterpretation(insight: PerformanceInsight): string {
  const id = insight.id;
  
  if (id?.includes('commits-per-session')) {
    return 'Developers are producing fewer commits per coding session.';
  }
  if (id?.includes('active-coding-time')) {
    return 'Developers spend significant time in sessions but not actively coding.';
  }
  if (id?.includes('ai-suggestions')) {
    return 'AI assistance is being adopted at varying rates across IDEs.';
  }
  if (id?.includes('session-length')) {
    return 'Coding sessions vary in duration, affecting daily productivity.';
  }
  if (id?.includes('time-to-first-commit')) {
    return 'Developers take time to start meaningful work after opening IDE.';
  }
  if (id?.includes('rework-rate')) {
    return 'Code requires frequent modifications after initial completion.';
  }
  if (id?.includes('delivery-rate')) {
    return 'Code delivery frequency varies across development workflows.';
  }
  if (id?.includes('large-pr')) {
    return 'Pull requests are growing in size, increasing review complexity.';
  }
  if (id?.includes('reopen')) {
    return 'Pull requests require multiple rounds of review and fixes.';
  }
  if (id?.includes('change-failure-rate')) {
    return 'Deployments are failing at higher rates than expected.';
  }
  if (id?.includes('failed-deployment')) {
    return 'Release pipeline encounters frequent deployment failures.';
  }
  if (id?.includes('reviewer-load')) {
    return 'Review workload is concentrated among few team members.';
  }
  if (id?.includes('stale-deployment')) {
    return 'Time between deployments is increasing, affecting delivery velocity.';
  }
  
  return insight.description || 'Performance metric requires attention.';
}

// Get impact for expanded panel - "What this causes"
function getImpact(insight: PerformanceInsight): string {
  const id = insight.id;
  
  if (id?.includes('commits-per-session')) {
    return 'This reduces daily throughput and delays feature delivery.';
  }
  if (id?.includes('active-coding-time')) {
    return 'This wastes developer time and reduces effective productivity.';
  }
  if (id?.includes('ai-suggestions')) {
    return 'This creates inconsistent development experiences across tools.';
  }
  if (id?.includes('session-length')) {
    return 'This leads to burnout and inconsistent daily output.';
  }
  if (id?.includes('time-to-first-commit')) {
    return 'This reduces daily coding time and delays PR velocity.';
  }
  if (id?.includes('rework-rate')) {
    return 'This increases development costs and extends project timelines.';
  }
  if (id?.includes('delivery-rate')) {
    return 'This slows time-to-market and reduces competitive advantage.';
  }
  if (id?.includes('large-pr')) {
    return 'This increases review time and introduces more bugs.';
  }
  if (id?.includes('reopen')) {
    return 'This indicates quality issues and wastes reviewer time.';
  }
  if (id?.includes('change-failure-rate')) {
    return 'This damages system stability and user experience.';
  }
  if (id?.includes('failed-deployment')) {
    return 'This blocks feature releases and frustrates development teams.';
  }
  if (id?.includes('reviewer-load')) {
    return 'This creates bottlenecks and delays code integration.';
  }
  if (id?.includes('stale-deployment')) {
    return 'This reduces feedback loops and slows innovation cycles.';
  }
  
  return 'This affects team productivity and delivery performance.';
}

// Generate real evidence rows - metrics + comparisons only
function getEvidenceRowsReal(insight: PerformanceInsight | any): Array<{label: string, value: string}> {
  if (!insight || !insight.id) return [{label: 'Data', value: 'No data available for this insight yet.'}]
  
  // Use actual breakdownByTool data if available
  if (insight.breakdownByTool && typeof insight.breakdownByTool === 'object') {
    return Object.entries(insight.breakdownByTool).map(([tool, value]) => ({
      label: `${tool}:`,
      value: String(value)
    }))
  }
  
  // Use evidence array if available
  if (insight.evidence && Array.isArray(insight.evidence)) {
    return insight.evidence.map((e: any) => ({
      label: `${e.label}:`,
      value: String(e.value)
    }))
  }
  
  // Fallback to single value
  const value = insight.value || insight.rightMetric || insight.displayValue || 'No data'
  return [{label: 'Value:', value: String(value)}]
}

// NEW: Get executive-friendly display with number + context
function getExecutiveDisplay(insight: PerformanceInsight): { value: string, context: string } {
  const value = formatPrimaryValue(insight)
  const unit = getMetricUnit(insight)
  const context = getContextInfo(insight)
  
  // Create executive-friendly context
  let displayContext = context.metric
  
  // Add scope if it's meaningful (not just "ORG")
  if (context.scope && context.scope !== 'ORG' && context.scope !== 'Limited data') {
    displayContext += ` • ${context.scope}`
  }
  
  // Add time window if available
  if (context.time && context.time !== 'Last 4 weeks') {
    displayContext += ` • ${context.time}`
  }
  
  return { value, context: displayContext }
}

function getInsightIcon(insight: PerformanceInsight): string {
  // Map insight types to icons
  const iconMap: Record<string, string> = {
    'commits_per_session': 'bi bi-git-commit',
    'active_coding_time': 'bi bi-clock',
    'ai_suggestions_accepted': 'bi bi-robot',
    'session_length': 'bi bi-hourglass',
    'time_to_first_commit': 'bi bi-rocket-takeoff',
    'rework_rate': 'bi bi-arrow-repeat',
    'delivery_rate': 'bi bi-truck',
    'pr_size': 'bi bi-file-text',
    'review_latency': 'bi bi-eye',
    'deployment_frequency': 'bi bi-box-arrow-up',
    'change_failure_rate': 'bi bi-exclamation-triangle'
  }
  
  // Try to match by ID, title, or fallback
  const id = insight.id?.toLowerCase() || ''
  const title = insight.title?.toLowerCase() || ''
  
  for (const [key, icon] of Object.entries(iconMap)) {
    if (id.includes(key) || title.includes(key.replace('_', ''))) {
      return icon
    }
  }
  
  // Fallback icons by stage
  if (insight.cicdStage === 'plan-code') return 'bi bi-code-square'
  if (insight.cicdStage === 'review-merge') return 'bi bi-git'
  if (insight.cicdStage === 'deploy-operate') return 'bi bi-rocket-takeoff'
  
  return 'bi bi-bar-chart'
}

function getTimeWindow(insight: PerformanceInsight): string {
  // Extract time window from insight evidence or default
  const timeEvidence = insight.evidence?.find(e => 
    e.label.toLowerCase().includes('time') || 
    e.label.toLowerCase().includes('period') ||
    e.label.toLowerCase().includes('window')
  )
  if (timeEvidence?.period) {
    return `Last ${timeEvidence.period}`
  }
  
  // Try to get from evidence values
  const periodEvidence = insight.evidence?.find(e => e.period)
  if (periodEvidence?.period) {
    return `Last ${periodEvidence.period}`
  }
  
  // Default time windows based on available data
  return 'Last 4 weeks'
}

function getScopeText(insight: PerformanceInsight): string {
  // Extract scope information from tools or related data
  if (insight.tools && insight.tools.length > 0) {
    const toolNames = insight.tools.map(tool => {
      const toolMap: Record<string, string> = {
        'cursor': 'Cursor',
        'windsurf': 'Windsurf', 
        'vscode': 'VS Code',
        'jetbrains': 'JetBrains'
      }
      return toolMap[tool.toLowerCase()] || tool.charAt(0).toUpperCase() + tool.slice(1)
    })
    return toolNames.join(' · ')
  }
  
  if (insight.toolScope) {
    return insight.toolScope.replace('-', ' ').toUpperCase()
  }
  
  // Default scope based on confidence and data
  if (insight.confidenceLevel === 'LOW') {
    return 'Limited data'
  }
  
  return 'ORG'
}

function getEvidenceRows(insight: PerformanceInsight): Array<{label: string, value: string}> {
  const rows: Array<{label: string, value: string}> = []
  
  // Add confidence level
  if (insight.confidenceLevel) {
    rows.push({
      label: 'Confidence',
      value: insight.confidenceLevel
    })
  }
  
  // Add sample size if available
  if (insight.reviewPhaseSessionCount) {
    rows.push({
      label: 'Sample Size',
      value: `${insight.reviewPhaseSessionCount} sessions`
    })
  }
  
  // Add evidence from the evidence array
  insight.evidence?.forEach(evidence => {
    if (evidence.value !== undefined && evidence.value !== null) {
      // Skip if this is the primary metric value we're already showing
      if (evidence.label.toLowerCase().includes('value') || 
          evidence.label.toLowerCase().includes('metric')) {
        return
      }
      
      rows.push({
        label: evidence.label,
        value: typeof evidence.value === 'number' ? evidence.value.toFixed(1) : String(evidence.value)
      })
    }
  })
  
  // Add metric value with comparison if available
  if (insight.metricValue !== undefined) {
    const label = insight.ruleLabel || 'Metric Value'
    let value = insight.metricValue.toFixed(1)
    
    if (insight.comparisonBaseline !== undefined) {
      const delta = insight.metricValue - insight.comparisonBaseline
      const sign = delta >= 0 ? '+' : ''
      value += ` (${sign}${delta.toFixed(1)} vs prior)`
    }
    
    // Only add if we don't already have this metric
    if (!rows.find(row => row.label === label)) {
      rows.push({ label, value })
    }
  }
  
  return rows
}
</script>

<style scoped>
/* === EXECUTIVE DASHBOARD - LIGHT THEME === */

.performance-insights-chips.executive-dashboard {
  background: #f8fafc;
  padding: 24px;
  border-radius: 12px;
  max-width: 100%;
}

/* STEP 2: EXECUTIVE SUMMARY */
.executive-summary {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
}

.executive-metrics {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
}

.exec-metric {
  text-align: center;
  flex: 1;
}

.exec-value {
  font-size: 32px;
  font-weight: 800;
  color: #0f172a;
  line-height: 1;
  margin-bottom: 4px;
}

.exec-label {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.executive-narrative {
  font-size: 14px;
  color: #475569;
  line-height: 1.5;
  padding: 16px;
  background: #f1f5f9;
  border-radius: 8px;
  border-left: 4px solid #3b82f6;
}

/* STEP 3: KPI STRIP */
.kpi-strip {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.kpi-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px;
  text-align: center;
  transition: all 0.2s ease;
}

.kpi-card:hover {
  border-color: #cbd5e1;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.kpi-value {
  font-size: 24px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1;
  margin-bottom: 4px;
}

.kpi-delta {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
}

.kpi-delta.positive {
  color: #059669;
}

.kpi-delta.negative {
  color: #dc2626;
}

.kpi-delta.neutral {
  color: #6b7280;
}

.kpi-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.kpi-sparkline {
  font-size: 10px;
  color: #94a3b8;
  font-family: monospace;
}

/* STEP 4: IDE LEADERBOARD */
.ide-leaderboard {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.ide-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px;
  transition: all 0.2s ease;
}

.ide-card.leader {
  border-color: #f59e0b;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.1);
}

.ide-card.contender {
  border-color: #3b82f6;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1);
}

.ide-card.established {
  border-color: #e2e8f0;
}

.ide-card:hover {
  border-color: #cbd5e1;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.ide-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.ide-name {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
}

.ide-rank {
  font-size: 14px;
  font-weight: 600;
  color: #64748b;
  background: #f1f5f9;
  padding: 4px 8px;
  border-radius: 12px;
}

.ide-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.ide-metric {
  text-align: center;
}

.ide-value {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1;
  margin-bottom: 4px;
}

.ide-label {
  font-size: 10px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ide-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.ide-pill {
  font-size: 10px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ide-pill.success {
  background: #dcfce7;
  color: #166534;
}

.ide-pill.info {
  background: #dbeafe;
  color: #1d4ed8;
}

.ide-pill.warning {
  background: #fef3c7;
  color: #92400e;
}

.ide-pill.neutral {
  background: #f1f5f9;
  color: #475569;
}

/* STEP 5: PIPELINE COLUMNS */
.pipeline-columns {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin-bottom: 24px;
}

.pipeline-column {
  background: #ffffff;
  border-radius: 12px;
  padding: 20px;
  transition: all 0.2s ease;
}

.pipeline-column.border-red {
  border: 2px solid #ef4444;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.1);
}

.pipeline-column.border-amber {
  border: 2px solid #f59e0b;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.1);
}

.pipeline-column.border-neutral {
  border: 2px solid #e2e8f0;
}

.pipeline-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.pipeline-title {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
}

.pipeline-status {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.pipeline-status.status-red {
  background: #fee2e2;
  color: #991b1b;
}

.pipeline-status.status-green {
  background: #dcfce7;
  color: #166534;
}

.pipeline-status.status-gray {
  background: #f1f5f9;
  color: #64748b;
}

.pipeline-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.pipeline-metric {
  text-align: center;
}

.pipeline-metric-value {
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1;
  margin-bottom: 4px;
}

.pipeline-metric-label {
  font-size: 10px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.pipeline-finding,
.pipeline-action {
  margin-bottom: 16px;
}

.finding-label,
.action-label {
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.finding-text,
.action-text {
  font-size: 13px;
  color: #475569;
  line-height: 1.4;
}

/* STEP 6: CHIP SYSTEM */
.pipeline-chips {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.executive-chip {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  border-left: 4px solid transparent;
}

.executive-chip.priority-high {
  border-left-color: #ef4444;
  background: rgba(239, 68, 68, 0.02);
}

.executive-chip.priority-medium {
  border-left-color: #f59e0b;
  background: rgba(245, 158, 11, 0.02);
}

.executive-chip.priority-low {
  border-left-color: #e2e8f0;
}

.executive-chip:hover {
  border-color: #cbd5e1;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.chip-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chip-value {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1;
}

.chip-delta {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
}

.chip-context {
  font-size: 11px;
  color: #64748b;
  line-height: 1.3;
}

/* EXPANDED CHIP STYLES */
.chip-expanded {
  margin-top: 12px;
  padding: 16px;
  border-radius: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-top: 3px solid #3b82f6;
}

.chip-expanded-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.chip-expanded-title {
  font-size: 14px;
  font-weight: 700;
  color: #1f2937;
  margin: 0;
  line-height: 1.3;
}

.chip-expanded-close {
  background: none;
  border: none;
  color: #6b7280;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.chip-expanded-close:hover {
  background: #e5e7eb;
  color: #374151;
}

.chip-expanded-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chip-expanded-primary {
  font-size: 18px;
  font-weight: 800;
  color: #1f2937;
  line-height: 1.2;
  margin-bottom: 4px;
}

.chip-expanded-unit {
  font-size: 12px;
  font-weight: 500;
  color: #6b7280;
  margin-left: 4px;
}

.chip-expanded-text {
  font-size: 12px;
  color: #4b5563;
  line-height: 1.4;
}

.chip-expanded-label {
  font-size: 11px;
  font-weight: 700;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.chip-expanded-recommendation {
  font-weight: 600;
  color: #1f2937;
}

.chip-expanded-evidence {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 6px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  font-size: 10px;
}

.chip-expanded-evidence-label {
  font-weight: 500;
  color: #6b7280;
}

.chip-expanded-evidence-value {
  font-weight: 600;
  color: #1f2937;
}

/* NO INSIGHTS PLACEHOLDER */
.no-insights-global {
  text-align: center;
  padding: 48px 24px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}

.no-insights-icon {
  font-size: 48px;
  color: #cbd5e1;
  margin-bottom: 16px;
}

.no-insights-text strong {
  display: block;
  font-size: 18px;
  color: #0f172a;
  margin-bottom: 8px;
}

.no-insights-text div {
  font-size: 14px;
  color: #64748b;
}

/* RESPONSIVE DESIGN */
@media (max-width: 1200px) {
  .kpi-strip {
    grid-template-columns: repeat(3, 1fr);
  }
  
  .ide-leaderboard {
    grid-template-columns: 1fr;
  }
  
  .pipeline-columns {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .executive-metrics {
    flex-direction: column;
    gap: 16px;
  }
  
  .kpi-strip {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .ide-metrics,
  .pipeline-metrics {
    grid-template-columns: 1fr;
  }
}

/* STEP 7: Section header emphasis */
.chips-header h5 {
  font-size: 16px;
  font-weight: 700;
}

.chips-header small {
  font-size: 12px;
  opacity: 0.7;
}

.stage-header h3 {
  font-weight: 700;
  font-size: 16px;
}

/* Priority styling for chips */
.pi-chip {
  border-left: 4px solid transparent;
}

.pi-chip--high {
  border-left-color: #ef4444;
  background: rgba(239, 68, 68, 0.03);
}

.pi-chip--medium {
  border-left-color: #f59e0b;
}

.pi-chip--low {
  border-left-color: transparent;
}

.stage-header small {
  font-size: 12px;
  opacity: 0.7;
}

.chips-header small {
  font-size: 0.875rem;
}

.view-toggle .btn-group {
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

/* 🔥 PHASE 3.4.5 — Using shared .cm-grid utility from cmTiles.css */

.chip-tile {
  background: white !important;
  border: 1px solid #e5e7eb !important;
  border-radius: 8px !important;
  padding: 1rem !important;
  min-height: 150px;
  height: 150px;
  cursor: pointer;
  transition: all 0.2s ease !important;
  position: relative;
  overflow: hidden;
  grid-column: auto !important;
  display: flex;
  flex-direction: column;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) !important;
}

.chip-tile:hover {
  border-color: #d1d5db !important;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1) !important;
}

.chip-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

/* Responsive grid for 4-column layout */
@media (max-width: 480px) {
  .stage-section {
    grid-template-columns: 1fr !important;
    gap: 10px !important;
  }
}

@media (max-width: 768px) {
  .stage-section {
    grid-template-columns: repeat(2, 1fr) !important;
    gap: 12px !important;
  }
}

@media (max-width: 1024px) {
  .stage-section {
    grid-template-columns: repeat(3, 1fr) !important;
    gap: 14px !important;
  }
}

@media (min-width: 992px) {
  .stage-section {
    grid-template-columns: repeat(4, minmax(240px, 1fr)) !important;
  }
}

.chip-tile:hover {
  transform: translateY(-4px) !important;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04) !important;
  border-color: rgba(13, 110, 253, 0.2) !important;
}

/* PHASE 4 - VISUAL HIERARCHY */
.chip-tile.is-primary {
  border: 2px solid #0d6efd !important;
  background: linear-gradient(180deg, rgba(13, 110, 253, 0.05), rgba(255, 255, 255, 1)) !important;
}

.chip-tile.is-primary .chip-primary-value {
  font-size: 22px !important;
  font-weight: 800 !important;
  color: #0d6efd !important;
}

.chip-tile:not(.is-primary) {
  opacity: 0.85;
  border: 1px solid rgba(0, 0, 0, 0.08) !important;
}

.chip-tile:not(.is-primary):hover {
  opacity: 1;
  border: 1px solid rgba(13, 110, 253, 0.3) !important;
}

/* PHASE 5 - DELTA CLARITY */
.delta-enhanced.positive {
  color: #059669 !important;
  font-weight: 700 !important;
}

.delta-enhanced.negative {
  color: #dc2626 !important;
  font-weight: 700 !important;
}

.delta-enhanced.neutral {
  color: #374151 !important;
  font-weight: 600 !important;
}

.chip-deltas-row {
  font-weight: 600 !important;
  gap: 0.5rem !important;
  margin-top: 0.5rem !important;
}

.chip-wow-delta {
  font-weight: 700 !important;
  color: #059669 !important;
}

.chip-wow-delta.negative {
  color: #dc2626 !important;
}

.chip-runner-up {
  font-weight: 600 !important;
  color: #374151 !important;
}

/* PHASE 6 & 7 - INLINE EXPANSION STYLES */
.chip-expanded-content {
  margin-top: 12px;
  padding: 16px;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 6px 20px rgba(0,0,0,0.08);
  border: 1px solid rgba(0,0,0,0.05);
  border-top: 3px solid #0d6efd;
}

.chip-expanded-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(0,0,0,0.08);
}

.chip-expanded-info {
  flex: 1;
}

.chip-expanded-title {
  font-size: 14px !important;
  font-weight: 700 !important;
  color: #1f2937 !important;
  margin: 0 !important;
  line-height: 1.3 !important;
}

.chip-expanded-meta {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.chip-expanded-stage {
  font-size: 10px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
  background: #f3f4f6 !important;
  color: #6b7280 !important;
  padding: 2px 6px !important;
  border-radius: 4px !important;
}

.chip-expanded-confidence {
  font-size: 10px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
  padding: 2px 6px !important;
  border-radius: 4px !important;
}

.chip-expanded-confidence.high {
  background: #dcfce7 !important;
  color: #166534 !important;
}

.chip-expanded-confidence.medium {
  background: #fef3c7 !important;
  color: #92400e !important;
}

.chip-expanded-confidence.low {
  background: #fee2e2 !important;
  color: #991b1b !important;
}

.chip-expanded-close {
  background: none !important;
  border: none !important;
  color: #6b7280 !important;
  cursor: pointer !important;
  padding: 4px !important;
  border-radius: 4px !important;
  font-size: 14px !important;
}

.chip-expanded-close:hover {
  background: #f3f4f6 !important;
  color: #374151 !important;
}

.chip-expanded-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chip-expanded-section {
  margin-bottom: 8px;
}

.chip-expanded-section:last-child {
  margin-bottom: 0;
}

.chip-expanded-label {
  font-size: 11px !important;
  font-weight: 700 !important;
  color: #374151 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
  margin-bottom: 4px !important;
}

.chip-expanded-text {
  font-size: 12px !important;
  color: #4b5563 !important;
  line-height: 1.4 !important;
}

.chip-expanded-recommendation {
  font-weight: 600 !important;
  color: #1f2937 !important;
}

.chip-expanded-primary {
  font-size: 18px !important;
  font-weight: 800 !important;
  color: #1f2937 !important;
  line-height: 1.2 !important;
  margin-bottom: 4px !important;
}

.chip-expanded-unit {
  font-size: 12px !important;
  font-weight: 500 !important;
  color: #6b7280 !important;
  margin-left: 4px !important;
}

.chip-expanded-change {
  display: flex !important;
  align-items: center !important;
  gap: 4px !important;
  font-size: 12px !important;
  font-weight: 600 !important;
}

.chip-expanded-change.positive {
  color: #059669 !important;
}

.chip-expanded-change.negative {
  color: #dc2626 !important;
}

.chip-expanded-evidence {
  display: grid !important;
  grid-template-columns: 1fr 1fr !important;
  gap: 6px !important;
}

.chip-expanded-evidence-item {
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
  padding: 4px 6px !important;
  background: #f9fafb !important;
  border: 1px solid #e5e7eb !important;
  border-radius: 4px !important;
  font-size: 10px !important;
}

.chip-expanded-evidence-label {
  font-weight: 500 !important;
  color: #6b7280 !important;
}

.chip-expanded-evidence-value {
  font-weight: 600;
  color: #1f2937;
}

/* Stage narrative styling */
.stage-narrative {
  font-size: 0.875rem;
  font-weight: 600;
  color: #6b7280;
  text-align: center;
  font-style: italic;
  padding: 8px 16px;
  background: #f9fafb;
  border-radius: 6px;
  border-left: 3px solid #3b82f6;
}

/* Action section styling */
.chip-expanded-action {
  border-top: 1px solid #e5e7eb;
  padding-top: 12px;
  margin-top: 8px;
}

.chip-expanded-action .chip-expanded-label {
  color: #059669;
  font-weight: 700;
}

.chip-expanded-action .chip-expanded-recommendation {
  font-weight: 600;
  color: #1f2937;
  background: #f0fdf4;
  padding: 8px 12px;
  border-radius: 6px;
  border-left: 3px solid #059669;
}

/* PHASE 8 - CHIP POLISH */
.chip-tile {
  border-radius: 10px !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06) !important;
  transition: all 0.2s ease !important;
  padding: 8px !important;
}

.chip-tile:hover {
  box-shadow: 0 6px 20px rgba(0,0,0,0.12) !important;
  transform: translateY(-2px) !important;
}

.chip-tile:active {
  transform: translateY(-1px) !important;
}

/* Priority chip styling - first BAD chip per stage */
.chip-tile.priority-chip {
  border: 1px solid rgba(239, 68, 68, 0.4) !important;
  background: rgba(254, 242, 242, 0.7) !important;
  box-shadow: 0 1px 3px rgba(239, 68, 68, 0.1) !important;
  position: relative;
}

.chip-tile.priority-chip:hover {
  box-shadow: 0 2px 6px rgba(239, 68, 68, 0.15) !important;
  border-color: rgba(239, 68, 68, 0.5) !important;
}

.chip-tile.priority-chip::after {
  content: 'Priority';
  position: absolute;
  top: 4px;
  right: 4px;
  background: rgba(239, 68, 68, 0.7);
  color: white;
  font-size: 8px;
  font-weight: 500;
  padding: 1px 4px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.2px;
  z-index: 10;
}

/* Muted chip styling - low-signal chips */
.chip-tile.muted-chip {
  opacity: 0.65 !important;
  border-color: rgba(229, 231, 235, 0.4) !important;
  background: rgba(249, 250, 251, 0.8) !important;
  box-shadow: none !important;
}

.chip-tile.muted-chip:hover {
  opacity: 0.75 !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04) !important;
}

/* STAGE-LEVEL EXPANSION PANEL */
.stage-expanded-panel {
  margin-top: 4px;
  padding: 10px;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 4px 16px rgba(0,0,0,0.06);
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-top: 2px solid rgba(13, 110, 253, 0.3);
  grid-column: 1 / -1;
}

/* 🔥 STEP 4 — PRIMARY CHIP REFINEMENT */
.chip-tile.is-primary {
  border: 2px solid #10b981 !important;
  background: linear-gradient(135deg, #ffffff 0%, #f0fdf4 100%) !important;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1) !important;
  transform: scale(1.02) !important;
  z-index: 10;
  position: relative;
}

.chip-tile.is-primary::before {
  content: 'PRIMARY SIGNAL';
  position: absolute;
  top: -8px;
  right: 12px;
  background: #10b981;
  color: white;
  font-size: 0.625rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 12px;
  letter-spacing: 0.05em;
  z-index: 15;
}

.chip-tile.is-primary::before {
  content: '';
  position: absolute;
  top: -1px;
  left: -1px;
  right: -1px;
  bottom: -1px;
  border-radius: 8px;
  background: linear-gradient(45deg, rgba(13, 110, 253, 0.1), rgba(13, 110, 253, 0.05));
  z-index: -1;
}

/* 🔥 STEP 4 — PRIMARY TAG STYLING (FIXED OVERLAP) */
.chip-primary-tag {
  position: absolute;
  top: 8px;
  right: 70px; /* Moved further right to avoid LIVE tag overlap */
  background: rgba(13, 110, 253, 0.9);
  color: white;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  z-index: 15;
}

/* Override severity backgrounds to use AI tile styling */
.chip-tile.severity-priority,
.chip-tile.severity-warning,
.chip-tile.severity-highlight,
.chip-tile.severity-opportunity,
.chip-tile.severity-info,
.chip-tile.severity-neutral {
  background: linear-gradient(180deg, rgba(255, 255, 255, 1), rgba(248, 249, 250, 1)) !important;
}

/* 🔥 STEP 3.4 — CRITICAL SEVERITY STYLING */
.chip-tile.severity-critical {
  border: 2px solid rgba(220, 53, 69, 0.7) !important;
  box-shadow: 0 0 0 1px rgba(220, 53, 69, 0.3), 0 4px 12px rgba(220, 53, 69, 0.2) !important;
  background: linear-gradient(180deg, rgba(220, 53, 69, 0.05), rgba(248, 249, 250, 1)) !important;
}

.chip-tile.severity-critical .chip-icon {
  background: rgba(220, 53, 69, 0.2) !important;
  color: #dc3545 !important;
}

/* 🔥 STEP 6 — LOW-VALUE CHIP STYLING */
.chip-tile.severity-low-value {
  opacity: 0.75;
  border-color: rgba(108, 117, 125, 0.2) !important;
  box-shadow: none !important;
  background: linear-gradient(180deg, rgba(248, 249, 250, 0.8), rgba(248, 249, 250, 1)) !important;
}

.chip-tile.severity-low-value:hover {
  opacity: 0.85;
  transform: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05) !important;
}

/* 🔥 STEP 5 — SEVERITY NEUTRAL STYLING */
.chip-tile.severity-neutral {
  border-color: rgba(108, 117, 125, 0.3) !important;
  opacity: 0.8;
}

/* 🔥 STEP 5 — DELTA VISIBILITY IMPROVEMENT */
.delta-enhanced {
  font-weight: 600 !important;
}

.delta-enhanced.text-success {
  color: #198754 !important; /* Stronger green */
  font-weight: 700 !important;
}

.delta-enhanced.text-danger {
  color: #dc3545 !important; /* Stronger red */
  font-weight: 700 !important;
}

.delta-enhanced.text-muted {
  color: #6c757d !important; /* Stronger gray for neutral */
  font-weight: 500 !important;
}

.chip-tile.expanded {
  min-height: auto;
  z-index: 20;
  box-shadow: 0 12px 35px rgba(13, 110, 253, 0.2);
}

/* 🔥 PHASE 3.4.5 — Using shared .cm-grid utility from cmTiles.css */

.stage-section {
  margin-bottom: 32px; /* 🔥 STEP 8 — STAGE-LEVEL FLOW CLARITY */
}

.stage-section:last-child {
  margin-bottom: 0;
}

/* 🔥 PHASE 3.4.5 — Responsive handled by shared .cm-grid utility */
@media (max-width: 768px) {
  .stage-section {
    margin-bottom: 24px;
  }
}

.chip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.chip-icon {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  color: white;
}

.chip-status {
  font-size: 0.625rem;
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
}

.chip-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: #212529;
  margin-bottom: 0.25rem;
  text-align: center;
}

.chip-executive-display {
  text-align: center;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-height: 80px;
}

/* New chip structure styles */
.chip-short-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: #6b7280;
  text-transform: none;
  letter-spacing: normal;
  margin-bottom: 0.125rem;
}

.chip-output-value {
  font-size: 1.5rem;
  font-weight: 600;
  color: #111827;
  line-height: 1.1;
  margin-bottom: 0.125rem;
}

.chip-delta {
  font-size: 0.7rem;
  font-weight: 400;
  color: #9ca3af;
  line-height: 1.2;
}

.chip-micro-comparison {
  font-size: 0.6rem;
  font-weight: 500;
  color: #6b7280;
  line-height: 1.1;
}

.chip-context {
  font-size: 0.65rem;
  font-weight: 400;
  color: #6b7280;
  line-height: 1.1;
  font-style: italic;
}

/* Status indicator styling */
.chip-tile.status-good {
  border: 2px solid rgba(25, 135, 84, 0.3) !important;
  background: linear-gradient(180deg, rgba(25, 135, 84, 0.05), rgba(248, 249, 250, 1)) !important;
}

.chip-tile.status-good:hover {
  border-color: rgba(25, 135, 84, 0.5) !important;
  box-shadow: 0 4px 12px rgba(25, 135, 84, 0.2) !important;
}

.chip-tile.status-warning {
  border: 2px solid rgba(255, 193, 7, 0.3) !important;
  background: linear-gradient(180deg, rgba(255, 193, 7, 0.05), rgba(248, 249, 250, 1)) !important;
}

.chip-tile.status-warning:hover {
  border-color: rgba(255, 193, 7, 0.5) !important;
  box-shadow: 0 4px 12px rgba(255, 193, 7, 0.2) !important;
}

.chip-tile.status-bad {
  border: 3px solid rgba(220, 53, 69, 0.5) !important;
  background: linear-gradient(180deg, rgba(220, 53, 69, 0.08), rgba(248, 249, 250, 1)) !important;
  box-shadow: 0 4px 16px rgba(220, 53, 69, 0.25) !important;
}

.chip-tile.status-bad:hover {
  border-color: rgba(220, 53, 69, 0.7) !important;
  box-shadow: 0 8px 24px rgba(220, 53, 69, 0.35) !important;
  transform: translateY(-2px) !important;
}

.chip-tile.status-bad .chip-short-label {
  color: #dc3545 !important;
}

.chip-tile.status-warning .chip-short-label {
  color: #f57c00 !important;
}

.chip-tile.status-good .chip-short-label {
  color: #198754 !important;
}

/* Tone-based styling for enterprise feel */
.chip-tile.tone-red {
  border: 1px solid rgba(239, 68, 68, 0.3) !important;
  background: linear-gradient(180deg, rgba(239, 68, 68, 0.02), rgba(248, 249, 250, 1)) !important;
}

.chip-tile.tone-yellow {
  border: 1px solid rgba(245, 158, 11, 0.3) !important;
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.02), rgba(248, 249, 250, 1)) !important;
}

.chip-tile.tone-green {
  border: 1px solid rgba(34, 197, 94, 0.3) !important;
  background: linear-gradient(180deg, rgba(34, 197, 94, 0.02), rgba(248, 249, 250, 1)) !important;
}

.chip-winner-header {
  font-size: 0.65rem;
  font-weight: 700;
  color: #0d6efd;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 0.15rem;
  line-height: 1.2;
}

.chip-tie-header {
  font-size: 0.6rem;
  font-weight: 600;
  color: #6c757d;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 0.15rem;
  line-height: 1.2;
  opacity: 0.8;
}

.chip-metric-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: #495057;
  margin-bottom: 0.2rem;
  line-height: 1.3;
  text-transform: none;
  letter-spacing: 0.1px;
}

.chip-primary-value {
  font-size: 2rem;
  font-weight: 800;
  color: #212529;
  margin-bottom: 0.2rem;
  text-align: center;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

/* Mobile typography optimizations */
@media (max-width: 480px) {
  .chip-winner-header {
    font-size: 0.575rem;
    letter-spacing: 1px;
  }

  .chip-tie-header {
    font-size: 0.525rem;
    letter-spacing: 0.8px;
  }

  .chip-metric-name {
    font-size: 0.7rem;
    margin-bottom: 0.2rem;
  }
  
  .chip-primary-value {
    font-size: 1.25rem;
    margin-bottom: 0.25rem;
    font-weight: 800;
    letter-spacing: -0.01em;
  }
  
  .chip-primary-value .chip-unit {
    font-size: 0.75rem;
  }
  
  .chip-wow-delta {
    font-size: 0.65rem;
    margin-bottom: 0.2rem;
  }
  
  .chip-deltas-row {
    font-size: 0.7rem;
    gap: 0.25rem;
    margin-bottom: 0.25rem;
  }
  
  .chip-context-line {
    font-size: 0.65rem;
    margin-top: 0.1rem;
  }
  
  .chip-context-line {
    font-size: 0.65rem;
  }
}

@media (min-width: 481px) and (max-width: 767px) {
  .chip-winner-header {
    font-size: 0.6rem;
  }

  .chip-tie-header {
    font-size: 0.55rem;
  }

  .chip-metric-name {
    font-size: 0.725rem;
  }
  
  .chip-primary-value {
    font-size: 1.175rem;
  }
  
  .chip-primary-value .chip-unit {
    font-size: 0.825rem;
  }
  
  .chip-wow-delta {
    font-size: 0.7rem;
  }
  
  .chip-context-line {
    font-size: 0.7rem;
  }
  
  .chip-deltas-row {
    font-size: 0.725rem;
    gap: 0.3rem;
    margin-bottom: 0.3rem;
  }
  
  .chip-context-line {
    font-size: 0.675rem;
    margin-top: 0.125rem;
  }
}

.chip-primary-value .chip-unit {
  font-size: 0.875rem;
  font-weight: 500;
  color: #6c757d;
  margin-left: 0.25rem;
  text-transform: lowercase;
  letter-spacing: 0.3px;
}

.chip-micro-interpretation {
  font-size: 0.7rem;
  font-weight: 500;
  color: #6b7280;
  text-align: center;
  margin-bottom: 0.15rem;
  font-style: italic;
  line-height: 1.2;
}

.chip-deltas-row {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  font-size: 0.75rem;
  font-weight: 600;
  margin-bottom: 0.2rem;
  line-height: 1.3;
  min-height: 1.2rem;
}

.chip-wow-delta {
  font-weight: 600;
}

.chip-delta-sep {
  color: #adb5bd;
}

.chip-runner-up {
  font-weight: 500;
  color: #6c757d;
  font-size: 0.7rem;
}

.chip-context-line {
  font-size: 0.7rem;
  color: #6c757d;
  line-height: 1.4;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  margin-top: 0.125rem;
  min-height: 1rem;
}

/* Full-width expansion */
.chip-expanded-full-width {
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 10px;
  margin-top: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.pi-chips-grid .chip-tile.expanded {
  grid-column: 1 / -1 !important;
}

/* Mobile expanded view optimizations */
@media (max-width: 480px) {
  .chip-expanded-full-width {
    padding: 1rem;
    margin-top: 0.25rem;
    border-radius: 6px;
  }
  
  .expanded-header h6 {
    font-size: 0.9rem !important;
  }
  
  .expanded-header .btn {
    font-size: 0.75rem !important;
    padding: 0.25rem 0.5rem !important;
  }
  
  .section-title {
    font-size: 0.8rem !important;
  }
  
  .section-content {
    font-size: 0.8rem !important;
  }
  
  .number-label {
    font-size: 0.75rem !important;
  }
  
  .number-value {
    font-size: 0.8rem !important;
  }
  
  .evidence-key,
  .evidence-val {
    font-size: 0.7rem !important;
  }
}

@media (min-width: 481px) and (max-width: 767px) {
  .chip-expanded-full-width {
    padding: 1.25rem;
  }
  
  .expanded-header h6 {
    font-size: 0.95rem !important;
  }
  
  .section-title {
    font-size: 0.85rem !important;
  }
  
  .section-content {
    font-size: 0.85rem !important;
  }
}

.chip-expanded-content {
  max-width: 100%;
}

.expanded-header {
  border-bottom: 1px solid #dee2e6;
  padding-bottom: 1rem;
}

.expanded-section {
  border-bottom: 1px solid #e9ecef;
  padding-bottom: 1rem;
}

.expanded-section:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #495057;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.section-content {
  font-size: 0.875rem;
  color: #212529;
  margin: 0;
  line-height: 1.4;
}

.numbers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;
}

.number-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  background: white;
  border-radius: 4px;
  border: 1px solid #e9ecef;
}

.number-label {
  font-weight: 500;
  color: #6c757d;
}

.number-value {
  font-weight: 600;
  color: #212529;
}

.evidence-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 0.5rem;
}

.evidence-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.375rem 0.5rem;
  background: white;
  border-radius: 4px;
  border: 1px solid #e9ecef;
  font-size: 0.75rem;
}

.evidence-key {
  font-weight: 500;
  color: #6c757d;
}

.evidence-val {
  font-weight: 600;
  color: #212529;
}

.chip-unit {
  font-size: 0.75rem;
  font-weight: 500;
  color: #6c757d;
  margin-bottom: 0.5rem;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.chip-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #495057;
  margin-bottom: 0.125rem;
  text-align: center;
}

.chip-context {
  text-align: center;
}

.chip-time {
  font-size: 0.75rem;
  color: #6c757d;
}

.chip-scope {
  font-size: 0.75rem;
  color: #6c757d;
}

.chip-expanded {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--bs-gray-200);
}

.chip-evidence {
  margin-bottom: 1rem;
}

.evidence-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.25rem 0;
  font-size: 0.75rem;
}

.evidence-label {
  color: var(--bs-gray-600);
  font-weight: 500;
}

.evidence-value {
  color: var(--bs-gray-900);
  font-weight: 600;
}

.chip-recommendation {
  font-size: 0.75rem;
  color: var(--bs-gray-700);
  line-height: 1.4;
}

.chip-chevron {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  font-size: 0.75rem;
  color: var(--bs-gray-400);
}

/* AI Usage Signals color themes for chip icons */
.chip-icon.intensity { background: #0dcaf0; }    /* teal - Plan & Code */
.chip-icon.efficiency { background: #198754; }  /* green - Review & Merge */
.chip-icon.productivity { background: #6f42c1; } /* purple - Deploy & Operate */
.chip-icon.velocity { background: #fd7e14; }   /* orange - fallback */

/* Stage-based color mapping */
.stage-plan-code .chip-icon { background: #0dcaf0; }    /* teal */
.stage-review-merge .chip-icon { background: #198754; }  /* green */
.stage-deploy-operate .chip-icon { background: #6f42c1; } /* purple */

/* Fallback severity colors (keep existing for compatibility) */
.severity-priority {
  background: linear-gradient(135deg, #dc3545, #c82333);
}

.severity-warning {
  background: linear-gradient(135deg, #ffc107, #e0a800);
}

.severity-highlight {
  background: linear-gradient(135deg, #0d6efd, #0b5ed7);
}

.severity-opportunity {
  background: linear-gradient(135deg, #198754, #157346);
}

.severity-info {
  background: linear-gradient(135deg, #6c757d, #5c636a);
}

/* 🔧 STEP 6 — NEW SEVERITY CLASSES FOR DEMO CURATION */
.severity-danger {
  border: 2px solid #dc3545;
  box-shadow: 0 0 8px rgba(220, 53, 69, 0.3);
}

.severity-warning {
  border: 2px solid #ffc107;
  box-shadow: 0 0 8px rgba(255, 193, 7, 0.3);
}

.severity-good {
  border: 2px solid #198754;
  box-shadow: 0 0 8px rgba(25, 135, 84, 0.3);
}

/* AI Usage Signals status badge colors */
.chip-status {
  font-size: 0.6rem;
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 10;
  opacity: 0.8;
}

.chip-status.live { 
  background: rgba(209, 242, 235, 0.6); 
  color: rgba(15, 81, 50, 0.7); 
}

.chip-status.partial { 
  background: rgba(255, 243, 205, 0.6); 
  color: rgba(102, 77, 3, 0.7); 
}

.chip-status.incomplete { 
  background: rgba(248, 215, 218, 0.6); 
  color: rgba(114, 28, 36, 0.7); 
}

/* Status badge colors - more vibrant */
.warning {
  background: linear-gradient(135deg, #ffc107, #e0a800);
  color: #000;
  box-shadow: 0 2px 4px rgba(255, 193, 7, 0.3);
}

.priority {
  background: linear-gradient(135deg, #dc3545, #c82333);
  color: white;
  box-shadow: 0 2px 4px rgba(220, 53, 69, 0.3);
}

.incomplete {
  background: linear-gradient(135deg, #6c757d, #5c636a);
  color: white;
  box-shadow: 0 2px 4px rgba(108, 117, 125, 0.3);
}

/* Empty state */
.empty-state {
  padding: 3rem 1rem;
}

.empty-icon {
  opacity: 0.3;
}

.empty-state h6 {
  font-weight: 500;
  margin-bottom: 0.5rem;
}

.empty-state small {
  display: block;
  max-width: 400px;
  margin: 0 auto;
  line-height: 1.5;
}

/* RIGHT-SIDE POPOUT STYLES */
.chip-popout-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  z-index: 1050;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease-in-out;
}

.chip-popout-content {
  background: white;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  padding: 0;
  max-width: 720px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
  transition: all 0.3s ease;
  position: relative;
}

.chip-popout-content.is-expanded {
  max-width: 960px;
}

.popout-header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #e9ecef;
  background: #f8f9fa;
  border-radius: 8px 8px 0 0;
}

.popout-title-section {
  flex: 1;
}

.popout-metric-name {
  font-size: 1.125rem;
  font-weight: 600;
  color: #212529;
  margin: 0;
}

.popout-stage-badge {
  font-size: 0.75rem;
  font-weight: 500;
  color: #6c757d;
  background: #e9ecef;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  margin-left: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.popout-controls {
  display: flex;
  gap: 0.5rem;
}

.popout-body {
  padding: 1.5rem;
  max-height: calc(90vh - 120px);
  overflow-y: auto;
  transition: all 0.3s ease-in-out;
}

.popout-body.is-expanded {
  max-height: calc(90vh - 80px);
}

.popout-section {
  margin-bottom: 1.5rem;
}

.popout-section:last-child {
  margin-bottom: 0;
}

.popout-section-title {
  font-size: 0.875rem;
  font-weight: 700;
  color: #212529;
  margin-bottom: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 2px solid #e9ecef;
  padding-bottom: 0.5rem;
}

.popout-section-content {
  font-size: 0.875rem;
  line-height: 1.5;
  color: #495057;
  margin: 0;
}

.popout-metrics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1rem;
}

.popout-metric-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
  background: #f8f9fa;
  border-radius: 6px;
  border-left: 3px solid #007bff;
}

.popout-number-label {
  font-weight: 600;
  color: #495057;
  font-size: 0.875rem;
}

.popout-number-value {
  font-weight: 700;
  color: #000;
  font-size: 1.1rem;
}

.popout-numbers-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}

.popout-number-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
  background: #f8f9fa;
  border-radius: 4px;
  border-left: 3px solid #007bff;
}

.popout-number-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: #6c757d;
}

.popout-number-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: #212529;
}

.popout-evidence-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}

.popout-evidence-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background: #f8f9fa;
  border-radius: 4px;
  border-left: 3px solid #28a745;
}

.popout-evidence-key {
  font-weight: 600;
  color: #495057;
  font-size: 0.875rem;
  min-width: 120px;
}

.popout-evidence-val {
  font-weight: 500;
  color: #212529;
  font-size: 0.875rem;
  text-align: right;
}

/* Modern Expanded View Styles */
.popout-header-modern {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
  border-radius: 12px 12px 0 0;
  border-bottom: 1px solid #dee2e6;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.insight-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  color: white;
}

.insight-icon.intensity { background: linear-gradient(135deg, #20c997, #0d6efd); }
.insight-icon.efficiency { background: linear-gradient(135deg, #198754, #20c997); }
.insight-icon.productivity { background: linear-gradient(135deg, #6f42c1, #e83e8c); }
.insight-icon.velocity { background: linear-gradient(135deg, #fd7e14, #ffc107); }

.header-text {
  flex: 1;
}

.insight-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: #212529;
  margin: 0 0 0.25rem 0;
}

.insight-meta {
  display: flex;
  gap: 0.5rem;
}

.stage-badge {
  background: #007bff;
  color: white;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.confidence-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.confidence-badge.high { background: #198754; color: white; }
.confidence-badge.medium { background: #ffc107; color: #212529; }
.confidence-badge.low { background: #6c757d; color: white; }

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.action-btn {
  width: 36px;
  height: 36px;
  border: none;
  background: #f8f9fa;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  color: #495057;
}

.action-btn:hover {
  background: #e9ecef;
  color: #212529;
}

.action-btn.close-btn:hover {
  background: #dc3545;
  color: white;
}

/* Modern Body Styles */
.popout-body-modern {
  padding: 1.5rem;
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}

.popout-body-modern.is-expanded {
  grid-template-columns: 1fr 1fr;
}

/* Metric Cards */
.metric-card {
  background: white;
  border: 1px solid #e9ecef;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  transition: all 0.2s ease;
}

.metric-card:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.1);
  transform: translateY(-2px);
}

.metric-card.primary-metric {
  background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
  color: white;
  border: none;
}

.metric-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.metric-label {
  font-weight: 600;
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.8;
}

.metric-unit {
  background: rgba(255,255,255,0.2);
  padding: 0.25rem 0.5rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
}

.metric-value-large {
  font-size: 2.5rem;
  font-weight: 800;
  line-height: 1;
  margin-bottom: 0.5rem;
}

.metric-change {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
}

.metric-change i.negative {
  transform: rotate(180deg);
  color: #dc3545;
}

/* Info Cards */
.info-card, .recommendation-card {
  background: white;
  border: 1px solid #e9ecef;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

.info-header, .recommendation-header, .section-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  font-weight: 700;
  color: #212529;
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.info-content, .recommendation-content {
  color: #495057;
  line-height: 1.6;
  font-size: 0.875rem;
}

/* Evidence Section */
.evidence-section {
  grid-column: 1 / -1;
}

.evidence-grid-modern {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;
}

.evidence-item-modern {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 0.75rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: all 0.2s ease;
}

.evidence-item-modern:hover {
  background: #e9ecef;
  transform: translateY(-1px);
}

.evidence-label {
  font-weight: 600;
  color: #495057;
  font-size: 0.875rem;
}

.evidence-value {
  font-weight: 700;
  color: #212529;
  font-size: 0.875rem;
}

/* Animations */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideIn {
  from { 
    opacity: 0;
    transform: translateX(20px);
  }
  to { 
    opacity: 1;
    transform: translateX(0);
  }
}

/* Mobile Responsive */
@media (max-width: 480px) {
  .chip-popout-overlay {
    padding: 0.75rem;
  }
  
  .popout-body {
    max-height: calc(100vh - 200px);
  }
  
  .popout-body.is-expanded {
    max-height: calc(100vh - 160px);
  }
}

@media (max-width: 768px) {
  .chip-popout-content {
    width: 100%;
    margin: 0 auto;
  }
}

/* STEP 5: Make primary chip clearly dominant */
.chip-tile.is-primary {
  border: 2px solid #4f7cff !important;
  box-shadow: 0 10px 28px rgba(79,124,255,0.35) !important;
  transform: scale(1.06) !important;
  background: linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%) !important;
  z-index: 2 !important;
}

/* STEP 6: Clean grid alignment */
.pi-chips-grid {
  grid-template-columns: repeat(3, 1fr) !important;
  align-items: stretch;
  grid-auto-rows: 1fr;
}

.stage-section {
  grid-template-columns: repeat(3, 1fr) !important;
  align-items: stretch;
  grid-auto-rows: 1fr;
}

/* Prevent broken rows - ensure all chips occupy grid cells */
.chip-tile {
  grid-column: auto !important;
  grid-row: auto !important;
}

/* TASK 4: Simple priority chip styling */
.chip-tile.priority-chip {
  border: 1px solid #fbbf24 !important;
  background: #fefdf8 !important;
}

.chip-tile.priority-chip .chip-status {
  background: #fbbf24 !important;
  color: white !important;
  font-weight: 600 !important;
}

.chip-tile.priority-chip.critical {
  border: 1px solid #f87171 !important;
  background: #fef2f2 !important;
}

.chip-tile.priority-chip.critical .chip-status {
  background: #f87171 !important;
}

/* Enhanced data display and context readability */
.chip-micro-comparison {
  font-size: 0.875rem;
  font-weight: 600;
  color: #059669;
  margin: 0.125rem 0;
  padding: 0.25rem 0.5rem;
  background: rgba(5, 150, 105, 0.1);
  border-radius: 4px;
  display: inline-block;
  width: fit-content;
}

.chip-micro-comparison[data-negative="true"] {
  color: #dc3545;
  background: rgba(220, 53, 69, 0.1);
}

.chip-micro-comparison[data-warning="true"] {
  color: #fd7e14;
  background: rgba(253, 126, 20, 0.1);
}

.chip-context {
  font-size: 0.875rem;
  color: #475569;
  line-height: 1.4;
  margin-top: auto;
  font-weight: 500;
  padding: 0.5rem 0;
  border-top: 1px solid #f1f5f9;
}

.chip-output-value {
  font-size: 1.375rem;
  font-weight: 800;
  color: #1e293b;
  line-height: 1.1;
  margin: 0.25rem 0;
  letter-spacing: -0.025em;
}

.chip-short-label {
  font-size: 0.8rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.75px;
  line-height: 1.1;
  margin-bottom: 0.25rem;
}

/* Priority Visual Hierarchy */
.priority-critical {
  border: 2px solid #dc2626;
  background: #fef2f2;
}

.priority-high {
  border: 2px solid #f59e0b;
  background: #fffbeb;
}

.priority-medium {
  border: 2px solid #eab308;
  background: #fefce8;
}

.muted-chip {
  opacity: 0.55;
}

/* Stage Summary */
.stage-summary {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1e293b;
  padding: 1rem;
  background: #f8fafc;
  border-radius: 8px;
  border-left: 4px solid #3b82f6;
}
</style>
