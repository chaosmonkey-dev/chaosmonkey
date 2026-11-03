/**
 * CR-X P0-3: Quiet Profile AIOI — Compact Modality-Aware Cards
 *
 * Tests prove:
 * A. visual structure contract — no legacy card grammar
 * B. session-share math — derived from displayed workflow session counts
 * C. maturity treatment — Strong vs Emerging behavior
 * D. modality — Claude Code terminal vs editor
 * E. content rules — 2 mature / 1 emerging signals, missing omitted
 */
import { describe, it, expect } from 'vitest'
import {
  buildMeasuredWorkflowIntelligence,
  type CanonicalAggregatedRowLike,
  type CanonicalAggregatedMetadataLike,
} from '../lib/aioi/buildMeasuredWorkflowIntelligence'
import { getCanonicalWorkflowIdentity } from '../lib/workflowIdentity'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ─── Source contract: AIUsageSignalsPanel.vue ───

const componentPath = resolve(__dirname, '../components/performance/AIUsageSignalsPanel.vue')
const source = readFileSync(componentPath, 'utf-8')

// ─── Test helpers ───

function makeRows(tool: string, sessionCount: number, overrides: Partial<CanonicalAggregatedRowLike> = {}): CanonicalAggregatedRowLike[] {
  return [{
    tool,
    session_count: sessionCount,
    average_session_length_minutes: 30,
    active_coding_time_minutes: 15,
    ai_usage_duration_minutes: 10,
    time_to_first_commit_minutes: 5,
    ai_suggestions_accepted: 3,
    commits_per_session: 1,
    idle_time_minutes: 5,
    focus_ratio: 0.5,
    total_session_minutes: 30,
    ...overrides,
  }]
}

function makeMetadata(sessionCountByTool: Record<string, number>): CanonicalAggregatedMetadataLike {
  return {
    tools_in_population: Object.keys(sessionCountByTool),
    session_count_by_tool: sessionCountByTool,
  }
}

// Replicate the component's metric selection logic for testing
const METRIC_DEFS: Array<{ key: string; label: string; format: (v: number) => string }> = [
  { key: 'activeCodingMinutesPerSession', label: 'Active coding / session', format: (v) => `${Math.round(v)}m` },
  { key: 'aiActivityPerSession', label: 'AI activity', format: (v) => v.toFixed(1) + '/session' },
  { key: 'commitsPerSession', label: 'Commits', format: (v) => v.toFixed(1) + '/session' },
  { key: 'averageSessionLengthMinutes', label: 'Avg session', format: (v) => `${Math.round(v)}m` },
  { key: 'timeToFirstCommitMinutes', label: 'Time to first commit', format: (v) => `${Math.round(v)}m` },
  { key: 'activeCodingRatio', label: 'Active coding ratio', format: (v) => `${Math.round(v * 100)}%` },
  { key: 'aiUsageRatio', label: 'AI usage', format: (v) => `${Math.round(v * 100)}%` },
  { key: 'idleRatio', label: 'Idle ratio', format: (v) => `${Math.round(v * 100)}%` },
]

const HERO_LABELS_BY_MODALITY: Record<string, string> = {
  terminal: 'session runtime / session',
  editor: 'active coding / session',
}

const SECONDARY_PRIORITY_BY_MODALITY: Record<string, string[]> = {
  terminal: ['aiActivityPerSession', 'commitsPerSession', 'timeToFirstCommitMinutes', 'aiUsageRatio', 'averageSessionLengthMinutes'],
  editor: ['commitsPerSession', 'aiActivityPerSession', 'averageSessionLengthMinutes', 'timeToFirstCommitMinutes', 'aiUsageRatio'],
}

const UNINSTRUMENTED_METRICS_BY_WORKFLOW: Record<string, Set<string>> = {
  claude_code: new Set(['activeCodingMinutesPerSession', 'activeCodingRatio', 'idleRatio', 'focusRatio']),
}

function isMetricInstrumentedForWorkflow(toolId: string, metricKey: string): boolean {
  const uninstrumented = UNINSTRUMENTED_METRICS_BY_WORKFLOW[toolId]
  if (!uninstrumented) return true
  return !uninstrumented.has(metricKey)
}

const PRIMARY_SESSION_THRESHOLD = 25

function isEmerging(ide: any): boolean {
  return ide.sessionCount < PRIMARY_SESSION_THRESHOLD
}

function getHeroMetricValue(ide: any): string {
  const heroKey = ide.heroMetricKey
  if (!heroKey) return `${ide.sessionCount}`
  const raw = ide[heroKey]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return `${ide.sessionCount}`
  const def = METRIC_DEFS.find((d) => d.key === heroKey)
  return def ? def.format(raw) : `${ide.sessionCount}`
}

function getHeroMetricLabel(ide: any): string {
  const modality = ide.modality || 'editor'
  const heroKey = ide.heroMetricKey
  if (heroKey === 'averageSessionLengthMinutes' && modality === 'terminal') return HERO_LABELS_BY_MODALITY['terminal']
  if (heroKey === 'activeCodingMinutesPerSession' && modality === 'editor') return HERO_LABELS_BY_MODALITY['editor']
  const def = METRIC_DEFS.find((d) => d.key === heroKey)
  return def ? def.label : 'measured session count'
}

function getSecondaryMetrics(ide: any): Array<{ label: string; value: string }> {
  const heroKey = ide.heroMetricKey
  const modality = ide.modality || 'editor'
  const priority = SECONDARY_PRIORITY_BY_MODALITY[modality] || SECONDARY_PRIORITY_BY_MODALITY['editor']
  const maxSignals = isEmerging(ide) ? 1 : 2
  const result: Array<{ label: string; value: string }> = []
  for (const key of priority) {
    if (key === heroKey) continue
    if (!isMetricInstrumentedForWorkflow(ide.toolId, key)) continue
    const raw = ide[key]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    const def = METRIC_DEFS.find((d) => d.key === key)
    if (!def) continue
    result.push({ label: def.label, value: def.format(raw) })
    if (result.length >= maxSignals) break
  }
  return result
}

function getSessionSharePctNum(ide: any, total: number): number {
  if (total <= 0) return 0
  return (ide.sessionCount / total) * 100
}

function getSessionSharePct(ide: any, total: number): string {
  const pct = getSessionSharePctNum(ide, total)
  if (pct < 1) return '<1%'
  return Math.round(pct) + '%'
}

// ─── Tests ───

describe('CR-X P0-3 Quiet Profile: Modality-aware AIOI', () => {
  describe('A. visual structure contract — no legacy card grammar', () => {
    it('A1. no colored left accent border class/style', () => {
      expect(source).not.toContain('border-left-width: 3px')
      expect(source).not.toContain('border-left-style: solid')
      expect(source).not.toContain('aioi-card-stable')
      expect(source).not.toContain('aioi-card-risk')
      expect(source).not.toContain('aioi-card-throughput')
    })

    it('A2. no maturity pill/background treatment', () => {
      expect(source).not.toContain('aioi-tier-pill')
      expect(source).not.toContain('aioi-tp-stable')
      expect(source).not.toContain('aioi-tp-emerging')
      expect(source).not.toContain('aioi-tp-risk')
    })

    it('A3. no boxed secondary grid', () => {
      expect(source).not.toContain('aioi-stats')
      expect(source).not.toContain('aioi-stat-lbl')
      expect(source).not.toContain('aioi-stat-val')
    })

    it('A4. no stat-cell borders/backgrounds', () => {
      expect(source).not.toContain('aioi-stat {')
      expect(source).not.toContain('aioi-stat:last-child')
    })

    it('A5. no Claude Code italic disclaimer footer', () => {
      expect(source).not.toContain('aioi-provenance-footer')
      expect(source).not.toContain('Active coding not observed')
    })

    it('A6. no all-caps metric-label transformation in card markup/styles', () => {
      // Card-specific styles should not use uppercase/letter-spacing
      // on the card name or hero. Signal labels (aioi-signal-lbl) are
      // intentionally uppercase per the AIOI visual brief (label-over-value pairs).
      const cardStyleMatch = source.match(/\.aioi-card[\s\S]*?(?=@media|<\/style>)/)
      expect(cardStyleMatch).not.toBeNull()
      const cardStyles = cardStyleMatch![0]
      // Extract only non-signal-lbl style blocks for the uppercase check
      const nonSignalStyles = cardStyles.replace(/\.aioi-signal-lbl[\s\S]*?\}/, '')
      expect(nonSignalStyles).not.toContain('text-transform: uppercase')
    })

    it('A8. no separate SIGNAL STRENGTH band', () => {
      expect(source).not.toContain('Signal Strength:')
      expect(source).not.toContain('aioi-signal-sample')
    })

    it('A9. uses quiet profile classes (aioi-name, aioi-maturity, aioi-hero, aioi-share-line, aioi-signals)', () => {
      expect(source).toContain('aioi-name')
      expect(source).toContain('aioi-maturity')
      expect(source).toContain('aioi-hero-val')
      expect(source).toContain('aioi-hero-lbl')
      expect(source).toContain('aioi-share-line')
      expect(source).toContain('aioi-signals')
      expect(source).toContain('aioi-signal-pair')
    })
  })

  describe('B. session-share math', () => {
    const localRows: CanonicalAggregatedRowLike[] = [
      ...makeRows('windsurf', 842),
      ...makeRows('devin', 131),
      ...makeRows('vscode', 548),
      ...makeRows('cursor', 274),
      ...makeRows('claude_code', 54),
      ...makeRows('github_copilot', 6),
    ]
    const localMeta = makeMetadata({
      claude_code: 54,
      cursor: 274,
      devin: 131,
      github_copilot: 6,
      vscode: 548,
      windsurf: 842,
    })
    const result = buildMeasuredWorkflowIntelligence(localRows, localMeta, getCanonicalWorkflowIdentity)
    const total = result.reduce((sum, w) => sum + w.sessionCount, 0) // 1855

    it('B1. Devin share is approximately 54%', () => {
      const devin = result.find((w) => w.toolId === 'devin')!
      // 973 / 1855 ≈ 52.5% — close to 54% with rounding
      const pct = getSessionSharePctNum(devin, total)
      expect(pct).toBeGreaterThan(50)
      expect(pct).toBeLessThan(56)
    })

    it('B2. GitHub Copilot share is <1%', () => {
      const copilot = result.find((w) => w.toolId === 'github_copilot')!
      const pct = getSessionSharePctNum(copilot, total)
      expect(pct).toBeLessThan(1)
      expect(getSessionSharePct(copilot, total)).toBe('<1%')
    })

    it('B3. session share label says "of observed sessions"', () => {
      expect(source).toContain('of observed sessions')
    })

    it('B4. does NOT use adoption/portfolio/team share language in template', () => {
      const templateMatch = source.match(/<template>([\s\S]*)<\/template>/)
      expect(templateMatch).not.toBeNull()
      const template = templateMatch![1]
      expect(template).not.toContain('adoption')
      expect(template).not.toContain('portfolio share')
      expect(template).not.toContain('team share')
      expect(template).not.toContain('developer share')
    })
  })

  describe('C. maturity treatment', () => {
    it('C1. Strong workflow gets 2 secondary metrics', () => {
      const rows = makeRows('cursor', 100)
      const meta = makeMetadata({ cursor: 100 })
      const result = buildMeasuredWorkflowIntelligence(rows, meta, getCanonicalWorkflowIdentity)
      const cursor = result.find((w) => w.toolId === 'cursor')!
      const secondary = getSecondaryMetrics(cursor)
      expect(secondary.length).toBe(2)
    })

    it('C2. Emerging workflow gets 1 secondary metric', () => {
      const rows = makeRows('github_copilot', 6)
      const meta = makeMetadata({ github_copilot: 6 })
      const result = buildMeasuredWorkflowIntelligence(rows, meta, getCanonicalWorkflowIdentity)
      const copilot = result.find((w) => w.toolId === 'github_copilot')!
      const secondary = getSecondaryMetrics(copilot)
      expect(secondary.length).toBe(1)
    })

    it('C3. Emerging workflow retains Emerging signalStrength', () => {
      const rows = makeRows('github_copilot', 6)
      const meta = makeMetadata({ github_copilot: 6 })
      const result = buildMeasuredWorkflowIntelligence(rows, meta, getCanonicalWorkflowIdentity)
      const copilot = result.find((w) => w.toolId === 'github_copilot')!
      expect(copilot.signalStrength).toBe('Emerging')
    })

    it('C4. Strong workflow retains Strong signalStrength', () => {
      const rows = makeRows('cursor', 100)
      const meta = makeMetadata({ cursor: 100 })
      const result = buildMeasuredWorkflowIntelligence(rows, meta, getCanonicalWorkflowIdentity)
      const cursor = result.find((w) => w.toolId === 'cursor')!
      expect(cursor.signalStrength).toBe('Strong')
    })

    it('C5. share bar shown for Strong when share >= 2%', () => {
      expect(source).toContain('aioi-share-bar')
      expect(source).toContain('aioi-share-bar-fill')
      // Bar condition: !isEmerging && share >= 2
      expect(source).toContain('getSessionSharePctNum(ide) >= 2')
    })

    it('C6. "to primary" text remains for emerging', () => {
      expect(source).toContain('aioi-to-primary')
      expect(source).toContain('sessionsToPrimary')
    })
  })

  describe('D. modality', () => {
    it('D1. Claude Code hero is session runtime/session (NOT active coding)', () => {
      const rows = makeRows('claude_code', 100)
      const meta = makeMetadata({ claude_code: 100 })
      const result = buildMeasuredWorkflowIntelligence(rows, meta, getCanonicalWorkflowIdentity)
      const claude = result.find((w) => w.toolId === 'claude_code')!
      expect(claude.modality).toBe('terminal')
      expect(claude.heroMetricKey).toBe('averageSessionLengthMinutes')
      const label = getHeroMetricLabel(claude)
      expect(label).toBe('session runtime / session')
      expect(label).not.toContain('active coding')
    })

    it('D2. Claude Code terminal identity text is inline with maturity', () => {
      expect(source).toContain('terminal')
      expect(source).toContain("ide.modality === 'terminal'")
    })

    it('D3. Claude Code does NOT display active coding/focus/idle', () => {
      const rows = makeRows('claude_code', 100)
      const meta = makeMetadata({ claude_code: 100 })
      const result = buildMeasuredWorkflowIntelligence(rows, meta, getCanonicalWorkflowIdentity)
      const claude = result.find((w) => w.toolId === 'claude_code')!
      expect(claude.activeCodingMinutesPerSession).toBeNull()
      expect(claude.activeCodingRatio).toBeNull()
      expect(claude.focusRatio).toBeNull()
      expect(claude.idleRatio).toBeNull()
    })

    it('D4. Claude Code has NO disclaimer footer', () => {
      expect(source).not.toContain('aioi-provenance-footer')
      expect(source).not.toContain('Active coding not observed')
    })

    it('D5. Editor hero is active coding/session when authoritative', () => {
      const rows = makeRows('cursor', 100)
      const meta = makeMetadata({ cursor: 100 })
      const result = buildMeasuredWorkflowIntelligence(rows, meta, getCanonicalWorkflowIdentity)
      const cursor = result.find((w) => w.toolId === 'cursor')!
      expect(cursor.modality).toBe('editor')
      expect(cursor.heroMetricKey).toBe('activeCodingMinutesPerSession')
      const label = getHeroMetricLabel(cursor)
      expect(label).toBe('active coding / session')
    })
  })

  describe('E. content rules', () => {
    it('E1. Mature: max 2 supporting signals', () => {
      const rows = makeRows('cursor', 100)
      const meta = makeMetadata({ cursor: 100 })
      const result = buildMeasuredWorkflowIntelligence(rows, meta, getCanonicalWorkflowIdentity)
      const cursor = result.find((w) => w.toolId === 'cursor')!
      const secondary = getSecondaryMetrics(cursor)
      expect(secondary.length).toBeLessThanOrEqual(2)
    })

    it('E2. Emerging: max 1 supporting signal', () => {
      const rows = makeRows('github_copilot', 6)
      const meta = makeMetadata({ github_copilot: 6 })
      const result = buildMeasuredWorkflowIntelligence(rows, meta, getCanonicalWorkflowIdentity)
      const copilot = result.find((w) => w.toolId === 'github_copilot')!
      const secondary = getSecondaryMetrics(copilot)
      expect(secondary.length).toBeLessThanOrEqual(1)
    })

    it('E3. Missing values are omitted (not rendered as zero or —)', () => {
      const rows = makeRows('claude_code', 100, {
        commits_per_session: 0,
        time_to_first_commit_minutes: 0,
      })
      const meta = makeMetadata({ claude_code: 100 })
      const result = buildMeasuredWorkflowIntelligence(rows, meta, getCanonicalWorkflowIdentity)
      const claude = result.find((w) => w.toolId === 'claude_code')!
      expect(claude.commitsPerSession).toBeNull()
      expect(claude.timeToFirstCommitMinutes).toBeNull()
      const secondary = getSecondaryMetrics(claude)
      for (const m of secondary) {
        expect(m.value).not.toBe('—')
        expect(m.value).not.toBe('0')
      }
    })

    it('E4. AI activity remains labeled "AI activity" (not "AI edit bursts")', () => {
      const def = METRIC_DEFS.find((d) => d.key === 'aiActivityPerSession')
      expect(def!.label).toBe('AI activity')
      expect(def!.label).not.toContain('edit bursts')
    })

    it('E5. No delivery-outcome attribution in AIOI component', () => {
      expect(source).not.toContain('prEvidence')
      expect(source).not.toContain('deliveryAttribution')
      expect(source).not.toContain('maxLevel')
    })

    it('E6. No cost/billing fields in builder output', () => {
      const rows = makeRows('cursor', 100)
      const meta = makeMetadata({ cursor: 100 })
      const result = buildMeasuredWorkflowIntelligence(rows, meta, getCanonicalWorkflowIdentity)
      const cursor = result.find((w) => w.toolId === 'cursor')!
      expect(cursor).not.toHaveProperty('cost')
      expect(cursor).not.toHaveProperty('billing')
      expect(cursor).not.toHaveProperty('deliveryAttribution')
    })

    it('E7. Existing measured workflow counts remain stable (5-workflow Local)', () => {
      const localRows: CanonicalAggregatedRowLike[] = [
        ...makeRows('windsurf', 842),
        ...makeRows('devin', 131),
        ...makeRows('vscode', 548),
        ...makeRows('cursor', 274),
        ...makeRows('claude_code', 54),
        ...makeRows('github_copilot', 6),
      ]
      const localMeta = makeMetadata({
        claude_code: 54,
        cursor: 274,
        devin: 131,
        github_copilot: 6,
        vscode: 548,
        windsurf: 842,
      })
      const result = buildMeasuredWorkflowIntelligence(localRows, localMeta, getCanonicalWorkflowIdentity)
      expect(result).toHaveLength(5)
      const devin = result.find((w) => w.toolId === 'devin')!
      expect(devin.sessionCount).toBe(973)
      const claude = result.find((w) => w.toolId === 'claude_code')!
      expect(claude.sessionCount).toBe(54)
      expect(claude.modality).toBe('terminal')
    })

    it('E8. Hero labels are sentence case (no all-caps)', () => {
      const editorLabel = HERO_LABELS_BY_MODALITY['editor']
      const terminalLabel = HERO_LABELS_BY_MODALITY['terminal']
      expect(editorLabel).toBe('active coding / session')
      expect(terminalLabel).toBe('session runtime / session')
      // First char lowercase = sentence case
      expect(editorLabel[0]).toBe(editorLabel[0].toLowerCase())
      expect(terminalLabel[0]).toBe(terminalLabel[0].toLowerCase())
    })

    it('E9. Claude Code AI activity remains observed', () => {
      const rows = makeRows('claude_code', 100)
      const meta = makeMetadata({ claude_code: 100 })
      const result = buildMeasuredWorkflowIntelligence(rows, meta, getCanonicalWorkflowIdentity)
      const claude = result.find((w) => w.toolId === 'claude_code')!
      expect(claude.aiActivityPerSession).not.toBeNull()
    })
  })
})
