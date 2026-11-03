/**
 * PILOT OPS 21.3 — Patra final customer-credibility pass.
 *
 * Contracts under test (presentation/default-state only):
 *
 * PBT context bar at canonical zero telemetry:
 *   - header reads "Live · Waiting for first telemetry"
 *   - "All historical telemetry" is NOT rendered at 0 sessions
 *   - totalSessions > 0 → existing timeWindowLabel preserved exactly
 *   - totalSessions (canonical_population_count metadata) is the authority
 * Global dashboard phrase (Dashboards):
 *   - canonicalSessionCount === 0 → "Waiting for first telemetry"
 *   - canonicalSessionCount > 0 → getTelemetryStatusPhrase() unchanged
 *   - Live chip/indicator preserved
 * Profile (Settings):
 *   - no fabricated default bio anywhere in source
 *   - no user-entered bio => blank (not fabricated)
 *   - user-entered values preserved when present
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const pbtV3Src = readFileSync(
  resolve(__dirname, '../components/ProductivityByToolV3.vue'), 'utf8')
const dashboardsSrc = readFileSync(
  resolve(__dirname, '../pages/Dashboards.vue'), 'utf8')
const settingsSrc = readFileSync(
  resolve(__dirname, '../pages/Settings.vue'), 'utf8')
const runtimeModeSrc = readFileSync(
  resolve(__dirname, '../lib/insights/runtimeMode.ts'), 'utf8')

// ── Simulated derivations (mirror component logic) ────────────────────────

// Mirrors contextWindowLabel in ProductivityByToolV3
function deriveContextWindowLabel(totalSessions: number, timeWindowLabel: string) {
  return totalSessions === 0 ? 'Waiting for first telemetry' : timeWindowLabel
}

// Mirrors telemetryStatusPhrase computed in Dashboards.vue
function deriveTelemetryStatusPhrase(canonicalSessionCount: number, livePhrase: string) {
  return canonicalSessionCount === 0 ? 'Waiting for first telemetry' : livePhrase
}

// Mirrors the Settings.vue saved-profile hydrate path (post-fix)
function deriveProfileBio(savedBio: string | undefined | null) {
  return savedBio || ''
}

// ── 1. PBT zero-state context bar ─────────────────────────────────────────

describe('PILOT OPS 21.3 — PBT zero-state context', () => {
  it('0 sessions → "Waiting for first telemetry", never "All historical telemetry"', () => {
    const label = deriveContextWindowLabel(0, 'All historical telemetry')
    expect(label).toBe('Waiting for first telemetry')
    expect(label).not.toContain('historical')
  })

  it('>0 sessions → existing timeWindowLabel preserved ("All historical telemetry" for All Time)', () => {
    expect(deriveContextWindowLabel(42, 'All historical telemetry')).toBe('All historical telemetry')
    expect(deriveContextWindowLabel(7, '9/1/2026 - 9/18/2026')).toBe('9/1/2026 - 9/18/2026')
  })

  it('source: header composes Live indicator + contextWindowLabel', () => {
    expect(pbtV3Src).toMatch(/\{\{\s*telemetryStatusShort\s*\}\}\s*·\s*\{\{\s*contextWindowLabel\s*\}\}/)
  })

  it('source: contextWindowLabel gates on the canonical totalSessions authority', () => {
    expect(pbtV3Src).toMatch(/totalSessions\.value === 0 \? 'Waiting for first telemetry' : timeWindowLabel\.value/)
    // totalSessions itself derives from canonical_population_count metadata
    expect(pbtV3Src).toContain('canonical_population_count')
  })

  it('source: Live indicator element unchanged', () => {
    expect(pbtV3Src).toContain('v3-dot v3-dot--live')
  })
})

// ── 2. Global dashboard operational phrase ────────────────────────────────

describe('PILOT OPS 21.3 — global operational phrase', () => {
  it('0 canonical sessions → "Waiting for first telemetry"', () => {
    expect(deriveTelemetryStatusPhrase(0, 'Live operational telemetry across coding workflows'))
      .toBe('Waiting for first telemetry')
  })

  it('>0 canonical sessions → existing operational phrase unchanged', () => {
    expect(deriveTelemetryStatusPhrase(12, 'Live operational telemetry across coding workflows'))
      .toBe('Live operational telemetry across coding workflows')
  })

  it('source: Dashboards gates phrase on canonicalSessionCount, keeping Live chip separate', () => {
    expect(dashboardsSrc).toMatch(/canonicalSessionCount\.value === 0 \? 'Waiting for first telemetry' : getTelemetryStatusPhrase\(\)/)
    // Live indicator still renders telemetryStatusShort separately
    expect(dashboardsSrc).toContain('live-dot')
    expect(dashboardsSrc).toContain('telemetryStatusShort')
  })

  it('source: runtimeMode live phrase itself is unchanged', () => {
    expect(runtimeModeSrc).toContain("'Live operational telemetry across coding workflows'")
  })
})

// ── 3. Profile synthetic bio ──────────────────────────────────────────────

describe('PILOT OPS 21.3 — Profile synthetic bio removal', () => {
  it('fabricated bio string no longer exists anywhere in Settings.vue', () => {
    expect(settingsSrc).not.toContain('Software engineer passionate about productivity')
  })

  it('no user-entered bio => blank, never fabricated', () => {
    expect(deriveProfileBio(undefined)).toBe('')
    expect(deriveProfileBio(null)).toBe('')
    expect(deriveProfileBio('')).toBe('')
    expect(settingsSrc).toContain("bio: profile.bio || ''")
    expect(settingsSrc).toContain("bio: profileForm.value.bio || ''")
  })

  it('genuinely user-entered bios are preserved', () => {
    expect(deriveProfileBio('Real user bio')).toBe('Real user bio')
    // Saved profile values still hydrate the form
    expect(settingsSrc).toContain('profile.bio ||')
  })

  it('no fabricated name/email defaults remain in the hydrate path', () => {
    expect(settingsSrc).not.toContain("'John'")
    expect(settingsSrc).not.toContain("'Doe'")
    expect(settingsSrc).not.toContain('john.doe@company.com')
  })

  it('GitHub identity prefill for fresh users is preserved', () => {
    expect(settingsSrc).toContain('userInfo.value?.name')
    expect(settingsSrc).toContain('userInfo.value.email')
  })
})
