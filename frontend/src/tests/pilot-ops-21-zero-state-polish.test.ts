/**
 * PILOT OPS 21.2 — Patra customer-first zero-state polish.
 *
 * Contracts under test (presentation only — no engine/data changes):
 *
 * AIOI at canonical ZERO telemetry:
 *   - badge reads "No Data" (not "Limited Data")
 *   - no "Historical telemetry loaded" trailing status
 *   - "Ready for your first telemetry" + install guidance + Pilot API preserved
 * AIOI at sparse telemetry (1–9 sessions):
 *   - "Limited Data" preserved
 * Baseline banner (Dashboards):
 *   - hidden when canonical_population_count === 0, shown when > 0
 * PBT Ops Ticker (ProductivityByToolV3):
 *   - entire shell hidden when operationalSignals is empty
 *   - Cards + Time Series zero-state copy preserved
 */
import { describe, it, expect } from 'vitest'
import { ref, computed } from 'vue'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const aioiPanelSrc = readFileSync(
  resolve(__dirname, '../components/performance/AIUsageSignalsPanel.vue'), 'utf8')
const pbtV3Src = readFileSync(
  resolve(__dirname, '../components/ProductivityByToolV3.vue'), 'utf8')
const dashboardsSrc = readFileSync(
  resolve(__dirname, '../pages/Dashboards.vue'), 'utf8')

// ── Simulated derivations (mirror the component logic) ─────────────────────

function deriveAioiBadge(canonicalHydrating: boolean, canonicalSessionPopulation: number) {
  const hasInsufficientData = canonicalSessionPopulation < 10
  if (canonicalHydrating) return 'HYDRATING'
  if (canonicalSessionPopulation === 0) return 'NO_DATA'
  if (hasInsufficientData) return 'LIMITED_DATA'
  return 'EVIDENCE_BADGES'
}

function deriveTrailingStatus(
  evidenceCompleteness: string,
  canonicalSessionPopulation: number,
  evidenceStatusLabel: string | null,
  telemetryStatusLabel: string
) {
  if (evidenceCompleteness === 'loading') return 'Loading historical telemetry…'
  if (canonicalSessionPopulation === 0) return 'Waiting for first telemetry'
  return evidenceStatusLabel || telemetryStatusLabel
}

// Mirrors operationalSignals in ProductivityByToolV3: empty cards → empty array
function deriveOperationalSignals(cards: Array<{ value: number | null }>) {
  const signals: string[] = []
  if (!cards || cards.length === 0) return signals
  cards.forEach(card => {
    if (card.value !== null && card.value !== 0) signals.push(`signal:${card.value}`)
  })
  return signals.slice(0, 4)
}

const canonicalSessionCountFrom = (metadata: any) =>
  Number(metadata?.canonical_population_count) || 0

// ── 1. AIOI zero telemetry ─────────────────────────────────────────────────

describe('PILOT OPS 21.2 — AIOI canonical zero telemetry', () => {
  it('0 sessions → "No Data" badge, not "Limited Data"', () => {
    expect(deriveAioiBadge(false, 0)).toBe('NO_DATA')
  })

  it('0 sessions → trailing status "Waiting for first telemetry", never loaded-state', () => {
    const label = deriveTrailingStatus('full', 0, 'Historical telemetry loaded', 'Live telemetry active')
    expect(label).toBe('Waiting for first telemetry')
    expect(label).not.toContain('loaded')
  })

  it('0 sessions → component source renders "No Data" and "Ready for your first telemetry"', () => {
    expect(aioiPanelSrc).toContain('No Data')
    expect(aioiPanelSrc).toContain('Ready for your first telemetry')
    // Zero branch precedes the sparse Limited Data branch in the badge chain
    expect(aioiPanelSrc.indexOf('No Data')).toBeLessThan(aioiPanelSrc.indexOf('Limited Data'))
  })

  it('empty-state guidance and Pilot API URL are preserved in source', () => {
    expect(aioiPanelSrc).toContain('Install the ChaosMonkey extension')
    expect(aioiPanelSrc).toContain('pilotApiBase')
  })
})

// ── 2. AIOI sparse telemetry — Limited Data preserved ─────────────────────

describe('PILOT OPS 21.2 — AIOI sparse telemetry', () => {
  it('1–9 sessions → "Limited Data" preserved', () => {
    expect(deriveAioiBadge(false, 5)).toBe('LIMITED_DATA')
    expect(deriveAioiBadge(false, 1)).toBe('LIMITED_DATA')
    expect(deriveAioiBadge(false, 9)).toBe('LIMITED_DATA')
  })

  it('sparse sessions → trailing status keeps loaded/live semantics', () => {
    const label = deriveTrailingStatus('full', 5, 'Historical telemetry loaded', 'Live telemetry active')
    expect(label).toBe('Historical telemetry loaded')
  })

  it('>=10 sessions → evidence badges path unchanged', () => {
    expect(deriveAioiBadge(false, 10)).toBe('EVIDENCE_BADGES')
  })
})

// ── 3. PBT zero telemetry — no ticker shell, empty states preserved ───────

describe('PILOT OPS 21.2 — PBT zero telemetry', () => {
  it('0 cards → 0 signals → ticker gate closed', () => {
    expect(deriveOperationalSignals([]).length).toBe(0)
  })

  it('null/zero-value cards produce no signals', () => {
    expect(deriveOperationalSignals([{ value: null }, { value: 0 }]).length).toBe(0)
  })

  it('source: ticker shell is gated on operationalSignals.length > 0', () => {
    expect(pbtV3Src).toMatch(/v-if="operationalSignals\.length > 0"\s+class="v3-ticker"/)
  })

  it('Cards and Time Series empty-state copy preserved', () => {
    expect(pbtV3Src).toContain('No workflow telemetry yet')
    expect(pbtV3Src).toContain('Your IDE and AI-tool trends will appear here after the extension sends the first coding sessions.')
  })
})

// ── 4. Telemetry-present state — banner and ticker return ──────────────────

describe('PILOT OPS 21.2 — telemetry-present restoration', () => {
  it('canonical_population_count > 0 → baseline banner gate open', () => {
    expect(canonicalSessionCountFrom({ canonical_population_count: 42 })).toBeGreaterThan(0)
    expect(canonicalSessionCountFrom({ canonical_population_count: 0 })).toBe(0)
    expect(canonicalSessionCountFrom({})).toBe(0)
    expect(canonicalSessionCountFrom(null)).toBe(0)
  })

  it('source: baseline banner gated on canonicalSessionCount > 0', () => {
    expect(dashboardsSrc).toMatch(/v-if="canonicalSessionCount > 0" class="time-context-chip time-context-chip--primary"/)
    expect(dashboardsSrc).toContain('Baseline: all historical telemetry')
  })

  it('real card values → signals produced → ticker returns', () => {
    const signals = deriveOperationalSignals([{ value: 120 }, { value: 45 }])
    expect(signals.length).toBe(2)
  })
})
