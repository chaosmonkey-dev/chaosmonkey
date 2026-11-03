/**
 * CR-X closure regression: the active dashboard must not render or import the
 * mock SpendROI surface.
 *
 * The SpendROI component rendered hardcoded ROI scores, hardcoded productivity
 * gains, a false "Live Data" badge, and "Expand adoption"/"Increase investment"
 * recommendations — conflicting with the CR-X evidence/economics doctrine.
 *
 * This test protects runtime visibility by asserting that the canonical
 * Dashboards.vue source does not import, mount, or wire SpendROI, and that the
 * active template/script (excluding explanatory comments) does not re-introduce
 * the mock causal-claim strings.
 *
 * The SpendROI.vue file itself may be retained as unused historical source;
 * this test only proves the active dashboard does not reach it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const dashboardsPath = resolve(__dirname, '../pages/Dashboards.vue')
const rawSource = readFileSync(dashboardsPath, 'utf-8')

/**
 * Strip HTML comments (<!-- ... -->) and JS line comments (// ...) so the
 * regression assertions target active template/script code, not the
 * explanatory comments that document the removal.
 */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

const source = stripComments(rawSource)

describe('CR-X closure — SpendROI mock surface removed from active dashboard', () => {
  it('Dashboards.vue does not import SpendROI', () => {
    expect(source).not.toMatch(/import\s+SpendROI\s+from/)
  })

  it('Dashboards.vue does not mount <SpendROI', () => {
    expect(source).not.toMatch(/<SpendROI[\s>]/)
  })

  it('Dashboards.vue does not reference spendROIRef', () => {
    expect(source).not.toContain('spendROIRef')
  })

  it('Dashboards.vue does not reference refreshSpendData', () => {
    expect(source).not.toContain('refreshSpendData')
  })

  it('Dashboards.vue does not reference seedSpendDemoData', () => {
    expect(source).not.toContain('seedSpendDemoData')
  })

  it('Dashboards.vue active code does not render an "AI Spend & ROI" section header', () => {
    expect(source).not.toMatch(/AI Spend & ROI/)
  })

  it('Dashboards.vue active code does not render hardcoded Average ROI claims', () => {
    expect(source).not.toMatch(/Average ROI/)
  })

  it('Dashboards.vue active code does not render hardcoded Productivity Gain claims', () => {
    expect(source).not.toMatch(/Productivity Gain/)
  })

  it('Dashboards.vue active code does not render the false "Live Data" SpendROI badge', () => {
    expect(source).not.toMatch(/Live Data/)
  })

  it('Dashboards.vue active code does not render "Expand adoption" recommendations', () => {
    expect(source).not.toMatch(/Expand .*adoption/)
  })

  it('Dashboards.vue active code does not render "Increase investment" recommendations', () => {
    expect(source).not.toMatch(/Increase .*investment/)
  })

  it('Dashboards.vue does not wire an adspend tab pane', () => {
    expect(source).not.toMatch(/id="adspend"/)
  })

  it('SpendROI.vue is no longer reachable from any active frontend source', () => {
    // Defensive: scan all .vue/.ts files under src for an active import of SpendROI.
    // The component file may exist as historical source, but nothing may import it.
    const { execSync } = require('child_process')
    let grepResult = ''
    try {
      grepResult = execSync(
        `grep -rl "from.*SpendROI\\|import.*SpendROI" --include="*.vue" --include="*.ts" src/ || true`,
        { cwd: resolve(__dirname, '..') },
      ).toString()
    } catch {
      grepResult = ''
    }
    // No file under src/ should import SpendROI.
    const importers = grepResult
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0)
    expect(importers).toEqual([])
  })
})

// ── CR-X Day 1A: PI count-label contract ─────────────────────────────────────

describe('CR-X Day 1A: PI count-label contract — findings not total', () => {
  const widgetPath = resolve(__dirname, '../components/PerformanceInsightsWidget.vue')
  const widgetRaw = readFileSync(widgetPath, 'utf-8')
  const widgetSource = stripComments(widgetRaw)

  it('header badge says "findings" not "total" for the finding count', () => {
    // The finding count badge must label itself as "findings", not "total".
    // Diagnostics are additional items beyond the finding count, so "total"
    // is misleading.
    expect(widgetSource).toContain('findings')
    expect(widgetSource).not.toMatch(/\{\{\s*performanceFindingCount\s*\}\}\s*total/)
  })

  it('diagnostic count badge remains labeled "diagnostics"', () => {
    expect(widgetSource).toMatch(/\{\{\s*diagnosticCount\s*\}\}\s*diagnostics/)
  })
})

// ── CR-X Day 1A: Pilot Health label contracts ────────────────────────────────

describe('CR-X Day 1A: Pilot Health authority labels', () => {
  const panelPath = resolve(__dirname, '../components/PilotHealthPanel.vue')
  const panelRaw = readFileSync(panelPath, 'utf-8')
  const panelSource = stripComments(panelRaw)

  it('Telemetry Freshness card has RAW authority tag', () => {
    // The session count in Telemetry Freshness is raw observed evidence,
    // not the canonical product universe. Must be labeled as RAW.
    expect(panelSource).toContain('RAW')
    // The RAW tag must be in the Telemetry Freshness card header
    expect(panelSource).toMatch(/Telemetry Freshness[\s\S]*?ph-card-authority-tag[\s\S]*?RAW/)
  })

  it('Developer Identity card says "Observed identities" not "Total developers"', () => {
    // The count is distinct user_id values from telemetry events, NOT
    // organization roster membership. Must be labeled as observed identities,
    // not people/developers, until authoritatively resolved.
    expect(panelSource).toContain('Observed identities')
    expect(panelSource).not.toMatch(/Total developers/)
  })

  it('refresh button has visible icon and text, not blank', () => {
    // The refresh button must have an icon and text — no blank controls.
    expect(panelSource).toMatch(/bi-arrow-clockwise|bi-arrow-repeat/)
    expect(panelSource).toMatch(/Refresh|Checking/)
    // Must have an accessible label
    expect(panelSource).toMatch(/aria-label/)
  })
})

// ── CR-X Day 1A: Residual ROI language scrub ─────────────────────────────────

describe('CR-X Day 1A: Final Engine generators do not present configured-cost analytics as ROI', () => {
  const generatorsDir = resolve(__dirname, '../lib/insights/final/generators')

  it('planCode.ts has no customer-visible ROI strings (only documentation comment)', () => {
    const src = readFileSync(join(generatorsDir, 'planCode.ts'), 'utf-8')
    // Strip comments (// lines) so only active code is checked
    const activeCode = src.replace(/^[ \t]*\/\/.*$/gm, '')
    expect(activeCode).not.toMatch(/\bROI\b/)
  })

  it('reviewMerge.ts has no customer-visible ROI strings', () => {
    const src = readFileSync(join(generatorsDir, 'reviewMerge.ts'), 'utf-8')
    const activeCode = src.replace(/^[ \t]*\/\/.*$/gm, '')
    expect(activeCode).not.toMatch(/\bROI\b/)
  })

  it('all other generator files have no customer-visible ROI strings', () => {
    const files = readdirSync(generatorsDir).filter(f => f.endsWith('.ts') && f !== 'planCode.ts' && f !== 'reviewMerge.ts')
    for (const f of files) {
      const src = readFileSync(join(generatorsDir, f), 'utf-8')
      const activeCode = src.replace(/^[ \t]*\/\/.*$/gm, '')
      expect(activeCode, `${f} should not contain ROI in active code`).not.toMatch(/\bROI\b/)
    }
  })
})
