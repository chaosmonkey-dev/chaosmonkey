<template>
  <div v-if="chips.length > 0" class="dora-mini-grid">
    <div
      v-for="(chip, idx) in chips"
      :key="idx"
      class="dora-mini-card cursor-pointer"
      @click="handleChipClick(chip)"
    >
      <div class="dora-mini-top">
        <div 
          v-if="chip.badge" 
          :class="['data-source-badge', getBadgeType(chip.badge), 'small']"
        >
          {{ getBadgeLabel(chip.badge) }}
        </div>
      </div>
      <div class="dora-mini-label">
        <i v-if="chip.ideIcon" :class="['bi', chip.ideIcon]"></i>
        {{ chip.label }}
      </div>
      <div class="dora-mini-value text-primary">{{ chip.value }}</div>
      <div v-if="chip.why" class="text-muted text-center" style="font-size: 0.72rem; line-height: 1.1;">
        {{ chip.why }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getToolLabel } from '../lib/insights/labels'
import { normalizeToolId } from '../lib/insights/toolId'
import type { ToolProductivityPoint, PerformanceInsight } from '../lib/insights/types'

interface InsightChip {
  label: string
  value: string
  why?: string
  ide?: string
  ideIcon?: string // Bootstrap icon class (e.g., 'bi-cursor')
  badge?: 'LIVE' | 'HYBRID' | 'SIM'
  cardId?: string
}

interface Props {
  ideDiagnostics?: PerformanceInsight[]
  prodPoints?: ToolProductivityPoint[]
  aiIdeSummary?: {
    highUsage: string[]
    highEfficiency: string[]
    lowEfficiency: string[]
  } | null
}

const props = defineProps<Props>()

/**
 * Executive AI Signal Chips (UI-only)
 *
 * Goals:
 * - 4–6 chips max
 * - Mutual exclusivity for Best/Worst AI efficiency (or "No clear leader")
 * - Explain why it matters (one line)
 * - Click scrolls/highlights relevant Performance Insight (no navigation, no filters)
 */
const chips = computed<InsightChip[]>(() => {
  const result: InsightChip[] = []

  if (!props.prodPoints || props.prodPoints.length === 0) {
    return result
  }

  // Aggregate per-tool metrics
  const perTool = new Map<string, {
    aiAssists: number
    codingMinutes: number
    aiPerMin: number
    hasTelemetry: boolean
    dataSource: 'real' | 'mixed' | 'sim' | 'unknown'
  }>()

  for (const p of props.prodPoints) {
    const toolId = normalizeToolId(p.tool) || String(p.tool || '').toLowerCase()
    if (!toolId || p.codingMinutes == null || p.codingMinutes <= 0) continue

    const existing = perTool.get(toolId) || {
      aiAssists: 0,
      codingMinutes: 0,
      aiPerMin: 0,
      hasTelemetry: false,
      dataSource: 'sim' as const,
    }

    existing.aiAssists += p.aiAssists || 0
    existing.codingMinutes += p.codingMinutes
    
    const src = (p.source || '').toLowerCase()
    if (src === 'live' || src === 'hybrid') {
      existing.hasTelemetry = true
      existing.dataSource = src === 'live' ? 'real' : 'mixed'
    }

    perTool.set(toolId, existing)
  }

  for (const data of perTool.values()) {
    data.aiPerMin = data.codingMinutes > 0 ? data.aiAssists / data.codingMinutes : 0
  }

  const mainIDEs = ['cursor', 'windsurf', 'vscode']
  const candidates = mainIDEs
    .map(tool => {
      const d = perTool.get(tool)
      if (!d || !d.aiPerMin) return null
      return {
        tool,
        label: getToolLabel(tool),
        ideIcon: getIDEIcon(tool),
        badge: getDataSourceBadge(d.dataSource, d.hasTelemetry),
        aiPerMin: d.aiPerMin,
        aiAssists: d.aiAssists,
        codingMinutes: d.codingMinutes,
      }
    })
    .filter(Boolean) as Array<{ tool: string; label: string; ideIcon?: string; badge?: 'LIVE' | 'HYBRID' | 'SIM'; aiPerMin: number; aiAssists: number; codingMinutes: number }>

  if (candidates.length === 0) return result

  const byEffDesc = [...candidates].sort((a, b) => b.aiPerMin - a.aiPerMin)
  const byEffAsc = [...candidates].sort((a, b) => a.aiPerMin - b.aiPerMin)
  const best = byEffDesc[0]
  const worstDistinct = byEffAsc.find(x => x.tool !== best.tool) || byEffAsc[0]

  // PART E: ORG chip: Adoption leader (rate-based, not absolute counts)
  // Show % AI-active sessions or assists/min with time context
  const byUsage = [...candidates].sort((a, b) => b.aiAssists - a.aiAssists)
  const topUsage = byUsage[0]
  
  // Calculate adoption rate: sessions with AI activity / total sessions
  // For now, use assists/min as proxy (higher = more adoption)
  // In future, could compute actual % AI-active sessions from session data
  const adoptionRate = topUsage.codingMinutes > 0 
    ? (topUsage.aiAssists / topUsage.codingMinutes).toFixed(2)
    : '0.00'

  result.push({
    label: `${topUsage.label} above org AI adoption baseline`,
    value: `${adoptionRate} assists/min`,
    why: 'Higher AI usage rate indicates stronger adoption; validate it translates to delivery outcomes.',
    badge: topUsage.badge,
    ide: topUsage.tool,
    ideIcon: topUsage.ideIcon,
    cardId: findDiagnosticCard(topUsage.tool, 'ai-efficiency-leader')?.id,
  })

  // AI efficiency leader (always pick the top tool, even if the margin is small)
  const bestCard = findDiagnosticCard(best.tool, 'ai-efficiency-leader')
  result.push({
    label: `${best.label} above org AI efficiency baseline`,
    value: `${best.aiPerMin.toFixed(2)} assists/min`,
    why: 'Higher assists per coding minute suggests stronger AI adoption in daily workflow.',
    badge: best.badge,
    ide: best.tool,
    ideIcon: best.ideIcon,
    cardId: bestCard?.id,
  })

  // AI efficiency laggard (always pick the lowest tool, excluding the leader if possible)
  if (worstDistinct) {
    const worstCard = findDiagnosticCard(worstDistinct.tool, 'ai-efficiency-laggard')
    result.push({
      label: `${worstDistinct.label} below org AI efficiency baseline`,
      value: `${worstDistinct.aiPerMin.toFixed(2)} assists/min`,
      why: 'Opportunity: tune model/settings and training to reduce workflow friction.',
      badge: worstDistinct.badge,
      ide: worstDistinct.tool,
      ideIcon: worstDistinct.ideIcon,
      cardId: worstCard?.id,
    })
  }

  // Keep the set compact (max 4; current spec emits 3).
  return result.slice(0, 4)
})

/**
 * Find IDE diagnostic card by tool and detector type
 */
function findDiagnosticCard(tool: string, detectorType: string): PerformanceInsight | undefined {
  if (!props.ideDiagnostics) return undefined
  const detectorKeywords = detectorType.replace(/-/g, ' ').split(' ')
  const titleSearch = detectorType.replace(/-/g, ' ')
  return props.ideDiagnostics.find(i => {
    if (!i.related?.tools?.includes(tool)) return false
    // Check if tags include detector type
    const hasDetectorTag = i.tags?.some(tag => 
      tag === detectorType || 
      tag.includes(detectorType) || 
      detectorKeywords.some(kw => tag.toLowerCase().includes(kw.toLowerCase()))
    )
    // Check if title contains relevant keywords
    const titleMatches = i.title?.toLowerCase().includes(titleSearch.toLowerCase())
    return hasDetectorTag || (i.tags?.includes('ide-diagnostic') && titleMatches)
  })
}

function findAnyMetric(metricId: string): PerformanceInsight | undefined {
  if (!props.ideDiagnostics) return undefined
  return props.ideDiagnostics.find(i => i.metricId === metricId)
}

function findAnyDiagnosticCard(detectorTypeOrKeyword: string[]): PerformanceInsight | undefined {
  if (!props.ideDiagnostics) return undefined
  const needles = detectorTypeOrKeyword.map(s => s.toLowerCase())
  return props.ideDiagnostics.find(i => {
    const tags = (i.tags || []).map(t => t.toLowerCase())
    const title = (i.title || '').toLowerCase()
    return needles.some(n => tags.includes(n) || tags.some(t => t.includes(n)) || title.includes(n))
  })
}

/**
 * Get data source badge
 */
function getDataSourceBadge(dataSource: 'real' | 'mixed' | 'sim' | 'unknown', hasTelemetry: boolean): 'LIVE' | 'HYBRID' | 'SIM' | undefined {
  if (!hasTelemetry) return 'SIM'
  if (dataSource === 'real') return 'LIVE'
  if (dataSource === 'mixed') return 'HYBRID'
  return 'SIM'
}

/**
 * Get badge type for data-source-badge class (matches DORA Metrics styling)
 * Note: DORA Metrics uses 'real' and 'simulated', so we map HYBRID to 'real' for now
 */
function getBadgeType(badge?: 'LIVE' | 'HYBRID' | 'SIM'): string {
  if (!badge) return 'simulated'
  if (badge === 'LIVE' || badge === 'HYBRID') return 'real' // Map both LIVE and HYBRID to 'real' for DORA styling
  return 'simulated'
}

/**
 * Get badge label text (matches DORA Metrics format)
 */
function getBadgeLabel(badge?: 'LIVE' | 'HYBRID' | 'SIM'): string {
  if (!badge) return 'GitHub delivery'
  if (badge === 'LIVE') return 'LIVE'
  if (badge === 'HYBRID') return 'HYBRID'
  return 'SIM'
}

/**
 * Get Bootstrap icon class for IDE
 */
function getIDEIcon(toolId?: string): string | undefined {
  if (!toolId) return undefined
  
  const iconMap: Record<string, string> = {
    'cursor': 'bi-cursor',
    'windsurf': 'bi-wind',
    'vscode': 'bi-code-square',
    'jetbrains': 'bi-journal-code',
    'sublime': 'bi-file-code',
    'vim': 'bi-terminal',
    'neovim': 'bi-terminal'
  }
  
  return iconMap[toolId.toLowerCase()] || undefined
}

/**
 * Handle chip click
 */
function handleChipClick(chip: InsightChip) {
  // Always scroll within the same page to Performance Insights and highlight a matching insight.
  const targetId = chip.cardId
  const container = document.querySelector('.stage-performance-insights') as HTMLElement
  if (container) {
    container.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (!targetId) return

  setTimeout(() => {
    const el = document.querySelector(`[data-pi-id="${CSS.escape(targetId)}"]`) as HTMLElement | null
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('insight-card-highlight')
    setTimeout(() => {
      el.classList.remove('insight-card-highlight')
    }, 2000)
  }, 300)
}
</script>

<style>
/* Exact DORA Metrics CSS - copied from Dashboards.vue to ensure proper styling */

/* DORA mini-card grid (compact) */
.dora-mini-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.35rem;
}

.dora-mini-card {
  background: #ffffff;
  border: 1px solid #e9ecef;
  border-radius: 0.6rem;
  padding: 0.75rem 0.75rem;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  min-height: 96px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.dora-mini-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  transform: translateY(-1px);
}

.dora-mini-top {
  display: flex;
  justify-content: center;
  margin-bottom: 0.25rem;
}

.dora-mini-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: #6c757d;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-align: center;
  line-height: 1.1;
}

.dora-mini-label i {
  font-size: 0.9rem;
  opacity: 0.8;
  margin-right: 0.25rem;
}

.dora-mini-value {
  text-align: center;
  font-weight: 800;
  font-size: 1.1rem;
  line-height: 1.1;
  margin-top: 0.2rem;
  margin-bottom: 0.25rem;
}

.data-source-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: white;
  margin-bottom: 0.5rem;
}

.data-source-badge.small {
  font-size: 0.65rem;
  padding: 0.2rem 0.4rem;
}

.data-source-badge.real {
  background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
}

.data-source-badge.simulated {
  background: linear-gradient(135deg, #ffc107 0%, #fd7e14 100%);
  color: #212529;
}

/* Highlight animation for cards */
.insight-card-highlight {
  animation: highlight-pulse 2s ease-in-out;
  border-color: #0d6efd !important;
  box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.25) !important;
}

@keyframes highlight-pulse {
  0%, 100% {
    box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.25);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(13, 110, 253, 0.4);
  }
}

/* Responsive - matches DORA Metrics */
@media (max-width: 768px) {
  .dora-mini-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 576px) {
  .dora-mini-grid {
    grid-template-columns: 1fr;
  }
  
  .dora-mini-card {
    padding: 0.5rem 0.55rem;
    border-radius: 0.55rem;
  }
}
</style>
