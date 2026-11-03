/**
 * CR-X Day 2 X3: Pilot Health failure-state expansion
 *
 * Two new customer-success dimensions:
 *   - connect_code_expiry: expired/expiring unredeemed connect codes
 *   - installation_failures: install_failure telemetry events
 *
 * Both must be rendered in PilotHealthPanel.vue with:
 *   - state badge
 *   - metrics
 *   - message
 *   - remediation (when degraded)
 *
 * Source contract: PilotHealthController::computeConnectCodeExpiry()
 * and computeInstallationFailures(). No customer data mutation —
 * backend tests use fixtures (RefreshDatabase).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const panelPath = resolve(__dirname, '../components/PilotHealthPanel.vue')
const panelSource = readFileSync(panelPath, 'utf-8')

const apiPath = resolve(__dirname, '../lib/api/pilotHealth.ts')
const apiSource = readFileSync(apiPath, 'utf-8')

describe('CR-X Day 2 X3: Pilot Health failure-state expansion', () => {
  it('PilotHealthPanel renders connect_code_expiry card', () => {
    expect(panelSource).toContain('connect_code_expiry')
    expect(panelSource).toContain('Connect-Code Expiry')
  })

  it('PilotHealthPanel renders installation_failures card', () => {
    expect(panelSource).toContain('installation_failures')
    expect(panelSource).toContain('Installation Failures')
  })

  it('connect_code_expiry card shows expired_unredeemed and expiring_within_7d metrics', () => {
    expect(panelSource).toContain('expired_unredeemed')
    expect(panelSource).toContain('expiring_within_7d')
    expect(panelSource).toContain('total_unredeemed')
  })

  it('installation_failures card shows failure_count metric', () => {
    expect(panelSource).toContain('failure_count')
  })

  it('both cards render remediation when present', () => {
    // Both cards must have v-if remediation blocks
    const connectRemedation = panelSource.match(/connect_code_expiry[\s\S]*?remediation[\s\S]*?ph-remediation-action/)
    expect(connectRemedation).toBeTruthy()
    const installRemedation = panelSource.match(/installation_failures[\s\S]*?remediation[\s\S]*?ph-remediation-action/)
    expect(installRemedation).toBeTruthy()
  })

  it('both cards are guarded with v-if to fail closed when backend omits them', () => {
    // The cards must use v-if="health.connect_code_expiry" and
    // v-if="health.installation_failures" so they don't render
    // when the backend response doesn't include them
    expect(panelSource).toMatch(/v-if="health\.connect_code_expiry"/)
    expect(panelSource).toMatch(/v-if="health\.installation_failures"/)
  })

  it('pilotHealth API types include connect_code_expiry and installation_failures', () => {
    expect(apiSource).toContain('connect_code_expiry')
    expect(apiSource).toContain('installation_failures')
  })

  it('API types mark both fields as optional (fail-closed for older backends)', () => {
    expect(apiSource).toMatch(/connect_code_expiry\?/)
    expect(apiSource).toMatch(/installation_failures\?/)
  })
})
