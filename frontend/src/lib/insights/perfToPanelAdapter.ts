// frontend/src/lib/insights/perfToPanelAdapter.ts
import type { PerformanceInsight } from './types'
// Use the local project types from your panel:
import type { Insight, InsightSeverity as PanelSeverity, InsightScope as PanelScope } from '@/types/insights'
import { timeAsync, count, mark, measure } from '../perf/devPerf'

// ⬇️ add near the top
const sevMap = {
  critical: 'risk',
  warning: 'lowlight',
  info: 'opportunity',
} as const

/** Map new severity → panel severity */
const mapSeverity = (s: 'critical'|'warning'|'info'): PanelSeverity => {
  // Your panel supports: 'risk' | 'lowlight' | 'opportunity' | 'highlight'
  switch (s) {
    case 'critical': return 'risk'
    case 'warning':  return 'lowlight'
    case 'info':     return 'opportunity' // info = opportunity by default
    default:         return 'opportunity'
  }
}

/** Heuristic: infer scope; default to org */
const inferScope = (ins: PerformanceInsight): PanelScope => {
  // If related.tools only → 'tool'; if teams present → 'team'; else 'org'
  const hasTools = Boolean(ins.related?.tools?.length)
  const hasTeams = Boolean(ins.related?.teams?.length)
  // (If you later add developers/repos, you can refine this)
  if (hasTools && !hasTeams) return 'tool' as PanelScope
  if (hasTeams) return 'team' as PanelScope
  return 'org' as PanelScope
}

/** Heuristic: choose a display entity id if any */
const pickEntityId = (ins: PerformanceInsight): string | undefined => {
  return ins.related?.tools?.[0]
      || ins.related?.teams?.[0]
      || ins.related?.repos?.[0]
      || undefined
}

/** Map PerformanceInsight -> panel Insight */
export const mapPerfToPanel = (insights: PerformanceInsight[]): Insight[] => {
  const inLen = insights?.length || 0
  count('perf_to_panel_items_processed')
  
  const startMark = `perf_to_panel_adapter_start`
  const endMark = `perf_to_panel_adapter_end`
  mark(startMark)
  
  const mapped = insights?.map(i => {
    // 1) severity: prefer normalized/critical from post-processor
    const normalized = (i as any).normalizedSeverity as ('risk'|'lowlight'|'opportunity'|'highlight'|undefined)
    const isCritical = !!(i as any).critical

    // fallbacks: if post-processed fields missing, map original severity
    let panelSeverity: PanelSeverity =
      (normalized as any) ||
      (i.severity && (sevMap as any)[i.severity]) ||
      'opportunity'

    if (isCritical) {
      panelSeverity = 'risk'
    }

    // 2) tags: add CRITICAL + priority tag if present
    const tags = Array.isArray(i.tags) ? [...i.tags] : []
    const priorityScore = (i as any).priorityScore as number | undefined
    if (isCritical) tags.unshift('CRITICAL')
    if (typeof priorityScore === 'number') tags.push(`P:${Math.round(priorityScore)}`)

    // 3) rest of your existing mapping (keep defensive defaults)
    return {
      id: i.id || crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      title: i.title || 'Insight',
      summary: i.description || i.summary || '',
      severity: panelSeverity,
      scope: (function() {
        // infer scope if missing
        if (i.scope) return i.scope as any
        const hasTools = Array.isArray(i.tools) && i.tools.length > 0
        const hasTeams = Array.isArray(i.teams) && i.teams.length > 0
        if (hasTools && !hasTeams) return 'tool'
        if (hasTeams) return 'team'
        return 'org'
      })() as PanelScope,
      entityId: (i.tools?.[0] || i.teams?.[0] || i.repos?.[0] || undefined) as string | undefined,
      metricId: (i.metricId || 'cross-dataset') as string,
      metricKind: 'github', // default to github, can be refined later
      value: null, // no specific value from PerformanceInsight
      baseline: null,
      deltaPct: null,
      tags,
      evidence: (i.evidence || []).map(e => ({
        label: e?.label ?? '',
        value: (typeof e?.value === 'number' || typeof e?.value === 'string') ? e!.value : ''
      })),
      dataSource: (i.source === 'github' ? 'Real' : i.source === 'simulated' ? 'Simulated' : 'Mixed'),
      recommendedAction: (i.recommendations?.[0]?.text ?? ''),
      recommendedOwners: (i.recommendations?.[0]?.owners ?? []),
      timeRangeLabel: 'Recent period',
      alsoObservedIn: i.alsoObservedIn
    }
  })

  mark(endMark)
  measure('perf_to_panel_adapter', startMark, endMark)

  if (import.meta.env.VITE_FEATURE_PERF_INSIGHTS === '1') {
    console.info('[perf-insights][adapter] in:', inLen, 'out:', mapped.length)
  }
  return mapped as any
}
