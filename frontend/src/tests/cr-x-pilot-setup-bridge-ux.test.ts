/**
 * CR-X Pilot Setup Bridge UX — Source contract tests.
 *
 * Verifies the Dashboards.vue Pilot Setup banner is a compact collapsible
 * admin utility organized as rows around THREE developer tools:
 *   1. IDE Extension (VSIX) — Download + Setup
 *   2. Claude Code — Download + Setup
 *   3. Codex — Download + Setup
 * plus an optional, visually subordinate Cursor Agents companion row
 * (Configure → modal with download + install contract), gated on the
 * backend capability endpoint. Cursor Agents is NOT a fourth product.
 *
 * Proves:
 * - Default state is collapsed (pilotSetupExpanded = ref(false))
 * - Collapsed state contains summary text + expand control
 * - Expanded state contains both download buttons + setup instructions
 * - localStorage persistence key exists
 * - Download URLs remain unchanged
 * - VITE_HIDE_PILOT_SETUP behavior remains unchanged
 * - No customer-specific hostname is hardcoded
 * - Mobile-friendly layout classes are present
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FRONTEND_SRC = join(__dirname, '..')
const DASHBOARDS_VUE = join(FRONTEND_SRC, 'pages', 'Dashboards.vue')

function readDashboards(): string {
  return readFileSync(DASHBOARDS_VUE, 'utf-8')
}

describe('CR-X Pilot Setup Bridge UX — Collapsed/Expanded Contract', () => {

  // ─── Default collapsed state ───

  it('defaults to collapsed (pilotSetupExpanded = ref(false))', () => {
    const src = readDashboards()
    expect(src).toMatch(/const pilotSetupExpanded\s*=\s*ref\(false\)/)
  })

  it('collapsed state contains "Pilot setup" label', () => {
    const src = readDashboards()
    expect(src).toContain('Pilot setup')
  })

  it('collapsed state uses concise tool-oriented language', () => {
    const src = readDashboards()
    expect(src).toContain('IDE extensions · Claude Code · Codex')
  })

  it('collapsed state does not advertise Cursor Agents as a fourth product', () => {
    const src = readDashboards()
    // The collapsed strip is a static tool summary — no capability
    // conditional, no Cursor Agents mention at top level.
    expect(src).not.toContain('Cursor Agents available')
    expect(src).not.toContain('cursorAgentBridgeAvailable ?')
  })

  it('collapsed state has tools-they-use semantics text (no unqualified combination claim)', () => {
    const src = readDashboards()
    expect(src).toContain('Install the tools each developer uses')
    expect(src).not.toContain('any combination')
  })

  it('companion modal renders a scrollable command block with a Copy command action', () => {
    const src = readDashboards()
    expect(src).toContain('pilot-setup-cmd-text')
    expect(src).toContain('Copy command')
    expect(src).toContain('copyCompanionInstallCommand')
    // Copy produces the full untruncated command with a placeholder code, not a real one
    expect(src).toContain('CM_CONNECT_CODE="<your enrollment code>"')
    expect(src).toContain('node package/install.js')
    expect(src).not.toMatch(/CM_CONNECT_CODE="[a-zA-Z0-9-]{6,}"/)
    // Footer download stays single-line and wraps only at the container level
    expect(src).toContain('Download companion')
    expect(src).toMatch(/Download companion[\s\S]{0,120}text-nowrap|text-nowrap[\s\S]{0,300}Download companion/)
    expect(src).toContain('flex-wrap: wrap')
  })

  it('collapsed state has expand control ("Set up developers" + chevron)', () => {
    const src = readDashboards()
    expect(src).toContain('Set up developers')
    expect(src).toContain('chevron-down')
  })

  // ─── Expanded state ───

  it('expanded state has collapse control (chevron-up)', () => {
    const src = readDashboards()
    expect(src).toContain('Collapse')
    expect(src).toContain('chevron-up')
  })

  it('expanded state renders exactly three primary rows plus a subordinate companion row', () => {
    const src = readDashboards()
    // Three primary integration rows — no cards, no grid columns
    const primaryRows = src.match(/class="pilot-setup-row"/g) ?? []
    expect(primaryRows.length).toBe(3)
    expect(src).not.toContain('pilot-client-card')
    expect(src).not.toMatch(/v-if="cursorAgentBridgeAvailable"[^>]*col-md-4/)
    // The companion row exists but is visually subordinate
    expect(src).toContain('pilot-setup-row pilot-setup-row-sub')
  })

  it('expanded state includes IDE Extension download with correct endpoint', () => {
    const src = readDashboards()
    expect(src).toContain('/api/extension/download/latest')
    expect(src).toContain('chaosmonkey-telemetry-0.4.1.vsix')
    expect(src).toContain('IDE Extension')
    expect(src).toContain('VS Code / Cursor / Devin')
  })

  it('expanded state includes Claude Code Bridge download with correct endpoint', () => {
    const src = readDashboards()
    expect(src).toContain('/api/bridge/download/latest')
    expect(src).toContain('chaosmonkey-cc-bridge-0.4.1-cc-bridge.tgz')
    expect(src).toContain('Terminal')
  })

  it('expanded state includes Codex Bridge download with correct endpoint', () => {
    const src = readDashboards()
    expect(src).toContain('/api/codex-bridge/download/latest')
    expect(src).toContain('chaosmonkey-codex-bridge-0.4.1-codex-bridge.tgz')
  })

  it('expanded state includes Download + Setup actions for all primary rows', () => {
    const src = readDashboards()
    expect(src).toContain('showIdeSetup')
    expect(src).toContain('showBridgeSetup')
    expect(src).toContain('showCodexSetup')
    const downloadButtons = src.match(/bi-download me-1"><\/i>Download/g) ?? []
    expect(downloadButtons.length).toBeGreaterThanOrEqual(3)
    const setupButtons = src.match(/bi-list-task me-1"><\/i>Setup/g) ?? []
    expect(setupButtons.length).toBeGreaterThanOrEqual(3)
  })

  it('rows keep tool labels left and actions right-aligned without wrapping', () => {
    const src = readDashboards()
    expect(src).toContain('.pilot-setup-row')
    expect(src).toContain('.pilot-setup-row-actions')
    // Right-aligned action group, no-wrapping buttons
    expect(src).toMatch(/\.pilot-setup-row-actions\s*\{[^}]*margin-left:\s*auto/)
    expect(src).toMatch(/\.pilot-setup-row-actions \.btn\s*\{[^}]*white-space:\s*nowrap/)
    // Equal visual rhythm — consistent row padding and border separators
    expect(src).toMatch(/\.pilot-setup-row\s*\+\s*\.pilot-setup-row\s*\{[^}]*border-top/)
  })

  it('expanded state includes per-developer enrollment code semantics', () => {
    const src = readDashboards()
    expect(src).toContain('the tools they use')
    expect(src).toContain('own enrollment code')
  })

  it('expanded state includes Pilot API base URL', () => {
    const src = readDashboards()
    expect(src).toContain('Pilot API base URL')
    expect(src).toContain('pilotApiBase')
  })

  it('Claude Code setup instructions include 5 operational steps', () => {
    const src = readDashboards()
    expect(src).toContain('Download and extract')
    expect(src).toContain('node install.js')
    expect(src).toContain('pilot API base URL')
    expect(src).toContain('enrollment code')
    expect(src).toContain('Start Claude Code')
  })

  it('Codex setup instructions include install + hook trust steps', () => {
    const src = readDashboards()
    expect(src).toContain('Codex Setup')
    expect(src).toContain('node install.js')
    expect(src).toContain('/hooks')
    expect(src).toContain('trust')
  })

  it('instructions render in a contained modal, not inline expansion', () => {
    const src = readDashboards()
    expect(src).toContain('modal fade show d-block')
    expect(src).toContain('modal-dialog')
    expect(src).toContain('aria-modal="true"')
    expect(src).toContain('pilot-setup-close')
    expect(src).toContain('aria-label="Close"')
    expect(src).toContain('@click.self')
    // Instructions no longer expand the banner vertically inline
    expect(src).not.toContain('v-if="showBridgeSetup" class="mt-2 pt-2 border-top"')
    expect(src).not.toContain('v-if="showCodexSetup" class="mt-2 pt-2 border-top"')
  })

  it('modal shows IDE, Claude Code, Codex, or Cursor companion title from the same shared surface', () => {
    const src = readDashboards()
    expect(src).toContain('IDE Extension Setup')
    expect(src).toContain('Claude Code Setup')
    expect(src).toContain('Codex Setup')
    expect(src).toContain('Cursor Agents Companion')
  })

  // ─── Cursor Agents option (capability-gated) ───

  it('Cursor Agents companion is gated on backend-advertised capability, default-disabled', () => {
    const src = readDashboards()
    // Default false — fail closed until a live probe of THIS pilot's backend succeeds
    expect(src).toMatch(/const cursorAgentBridgeAvailable\s*=\s*ref\(false\)/)
    expect(src).toContain('v-if="cursorAgentBridgeAvailable"')
    // Capability is a runtime probe of the actual distribution route,
    // not a frontend version flag or a build-time constant
    expect(src).toContain('probeCursorAgentBridge')
    expect(src).toContain('/cursor-agent-bridge/download/latest')
  })

  it('Cursor Agents companion row is visually subordinate, not a fourth product', () => {
    const src = readDashboards()
    expect(src).toContain('Cursor Agents companion')
    expect(src).toContain("Optional · For Cursor's standalone Agents Window")
    // Single Configure action — no top-level download button in the row
    const rowStart = src.indexOf('pilot-setup-row-sub')
    const rowEnd = src.indexOf('Configure', rowStart)
    expect(rowStart).toBeGreaterThan(-1)
    expect(rowEnd).toBeGreaterThan(rowStart)
    expect(src.slice(rowStart, rowEnd)).not.toContain('Download')
    // Subordinate styling: lighter name weight and muted icon
    expect(src).toMatch(/\.pilot-setup-row-sub \.pilot-setup-row-name\s*\{[^}]*font-weight:\s*500/)
  })

  it('Cursor companion Configure opens the modal which exposes download + install contract', () => {
    const src = readDashboards()
    // The modal footer carries the companion download action
    expect(src).toContain('v-if="showCursorAgentSetup" :href="pilotApiBase + \'/api/cursor-agent-bridge/download/latest\'"')
    expect(src).toContain('chaosmonkey-cursor-agent-bridge-0.4.2-cursor-bridge.tgz')
    expect(src).toContain('Download companion')
    expect(src).toContain('Cursor Agents Companion')
  })

  it('Cursor Agents setup instructions use the verified install contract', () => {
    const src = readDashboards()
    expect(src).toContain('Cursor Agents Companion')
    // Immutable artifact verification is part of the customer-facing steps
    expect(src).toContain('972acbc5c02efccac995484c80534e34f28de837a1e65a72520286353d2bbe21')
    expect(src).toContain('CM_API_BASE_URL')
    expect(src).toContain('CM_CONNECT_CODE')
    expect(src).toContain('node package/install.js')
    // No false coverage claim
    expect(src).toContain('Genuine Cursor agent activity is still required before agent coverage is verified')
    // Clearly scoped as an IDE-extension companion for the Agents Window only —
    // no unqualified Claude Code interoperability claim
    expect(src).toContain('companion to the Cursor IDE extension')
    expect(src).toContain('standalone Agents Window only')
  })

  it('modal close handlers clear all four setup flags', () => {
    const src = readDashboards()
    expect(src).toContain('showBridgeSetup = false; showCodexSetup = false; showCursorAgentSetup = false; showIdeSetup = false')
    expect(src).toMatch(/const showIdeSetup\s*=\s*ref\(false\)/)
  })

  it('does not promote Claude Code 0.4.2 in the UI', () => {
    const src = readDashboards()
    expect(src).not.toContain('0.4.2-cc-bridge')
  })

  it('cursor install wording agrees across all three surfaces (extraction dir + node package/install.js)', () => {
    const surfaces = [
      readDashboards(),
      readFileSync(join(FRONTEND_SRC, 'pages', 'Enroll.vue'), 'utf-8'),
      readFileSync(join(FRONTEND_SRC, 'lib', 'setupInstructions.ts'), 'utf-8'),
    ]
    for (const src of surfaces) {
      // Command is executed from the extraction directory (which CONTAINS
      // package/), never from inside package/ — the verified contract.
      expect(src).toContain('extraction directory')
      expect(src).toContain('node package/install.js')
      expect(src).not.toMatch(/from the extracted\s*`?package\/?`?\s*directory[\s\S]{0,80}package\/install/)
    }
  })

  it('capability probe uses the authoritative endpoint, not the download route', () => {
    const lib = readFileSync(join(FRONTEND_SRC, 'lib', 'setupInstructions.ts'), 'utf-8')
    expect(lib).toContain('/cursor-agent-bridge/capability')
    // HTTP 200 on the artifact alone is not capability proof
    expect(lib).not.toContain("method: 'HEAD'")
  })

  it('modal uses purpose-built ChaosMonkey presentation (not modal-sm default list)', () => {
    const src = readDashboards()
    expect(src).not.toContain('modal-sm')
    expect(src).toContain('pilot-setup-dialog')
    expect(src).toContain('pilot-setup-steps')
    expect(src).toContain('step-num')
    expect(src).toContain('pilot-setup-modal-footer')
    expect(src).toContain('Connect this CLI to your ChaosMonkey pilot')
    expect(src).toContain('enrollment code provided by your ChaosMonkey administrator')
  })

  it('IDE setup modal covers the verified VSIX install path', () => {
    const src = readDashboards()
    expect(src).toContain('Install the VSIX in VS Code, Cursor, or Devin')
    expect(src).toContain('ChaosMonkey: Connect')
  })

  // ─── Collapse / persistence ───

  it('uses localStorage for persistence', () => {
    const src = readDashboards()
    expect(src).toContain('PILOT_SETUP_LS_KEY')
    expect(src).toContain('localStorage.getItem')
    expect(src).toContain('localStorage.setItem')
  })

  it('persistence key is cm_pilot_setup_expanded', () => {
    const src = readDashboards()
    expect(src).toContain("'cm_pilot_setup_expanded'")
  })

  it('persistPilotSetup function exists and is called on toggle', () => {
    const src = readDashboards()
    expect(src).toContain('function persistPilotSetup()')
    expect(src).toContain('persistPilotSetup()')
  })

  it('loads persisted preference on mount', () => {
    const src = readDashboards()
    expect(src).toContain('onMounted')
    expect(src).toContain("localStorage.getItem(PILOT_SETUP_LS_KEY)")
  })

  // ─── Layout / responsiveness ───

  it('uses flexible row layout that stacks safely on narrow viewports', () => {
    const src = readDashboards()
    expect(src).toContain('pilot-setup-rows')
    // Rows wrap in a controlled way on narrow screens — no fixed widths,
    // no horizontal-overflow-prone grid inside the setup rows container.
    expect(src).toMatch(/\.pilot-setup-row\s*\{[^}]*flex-wrap:\s*wrap/)
    const rowsBlock = src.slice(src.indexOf('pilot-setup-rows'), src.indexOf('Pilot API base URL'))
    expect(rowsBlock).not.toContain('col-12 col-md-4')
    expect(rowsBlock).not.toContain('pilot-client-card')
  })

  it('uses compact strip CSS class (not large banner)', () => {
    const src = readDashboards()
    expect(src).toContain('pilot-setup-strip')
    // Old large banner class should not be the primary style
    expect(src).not.toContain('pilot-setup-banner {')
  })

  it('pilot-setup-strip has compact padding', () => {
    const src = readDashboards()
    // The strip should have smaller padding than the old banner (0.4rem not 1rem)
    expect(src).toMatch(/\.pilot-setup-strip\s*\{[^}]*padding:\s*0\.4rem/)
  })

  // ─── No hardcoded hostnames ───

  it('does not hardcode customer-specific hostnames', () => {
    const src = readDashboards()
    expect(src).not.toContain('prioritydispatch.chaosmonkey.dev')
    expect(src).not.toContain('patra.chaosmonkey.dev')
    expect(src).not.toContain('ryan.chaosmonkey.dev')
    expect(src).not.toContain('52.15.236.225')
  })

  // ─── VITE_HIDE_PILOT_SETUP unchanged ───

  it('VITE_HIDE_PILOT_SETUP behavior remains unchanged', () => {
    const src = readDashboards()
    expect(src).toContain('VITE_HIDE_PILOT_SETUP')
    expect(src).toContain("?? 'true'")
    expect(src).toContain("?? 'false'")
  })

  // ─── pilotApiBase unchanged ───

  it('pilotApiBase computed derives ROOT URL (no /api suffix)', () => {
    const src = readDashboards()
    expect(src).toContain("const pilotApiBase = computed")
    expect(src).toContain("replace(/\\/api$/, '')")
  })

  // ─── CR-X: no :8010 in production fallback ───

  it('pilotApiBase fallback uses window.location.origin, never hardcodes :8010', () => {
    const src = readDashboards()
    // The fallback must be origin-based, not a hardcoded backend port.
    expect(src).toContain('window.location.origin')
    // The old :8010 fallback expression must be gone from the computed body.
    // (Comments may mention 8010 for context, but no runtime return of :8010)
    const computedBlock = src.match(/const pilotApiBase = computed\(\(\) => \{([\s\S]*?)\n\}\)/)
    expect(computedBlock).toBeDefined()
    const body = computedBlock![1]
    expect(body).not.toMatch(/return\s+`http:\/\/\$\{hostname\}:8010`/)
    expect(body).not.toMatch(/:8010/)
  })
})

/**
 * CR-X: Production setup output must never contain :8010.
 *
 * The Pilot Setup banner and copied setup instructions are customer-facing.
 * A production HTTPS hostname must produce origin + /api/... URLs with no
 * backend port. This guards against the build-env-mismatch regression where
 * a locally-built bundle (without .env.production) fell back to :8010.
 */
import { buildSetupInstructions } from '../lib/setupInstructions'

describe('CR-X: no :8010 in production setup output', () => {
  const prodApiBase = 'https://prioritydispatch.chaosmonkey.dev/api'
  const prodCode = 'CONNECT-PROD-XYZ'

  it('production copied setup instructions contain no :8010', () => {
    const text = buildSetupInstructions(prodApiBase, prodCode)
    expect(text).not.toContain(':8010')
  })

  it('production IDE setup instructions contain no :8010', () => {
    const text = buildSetupInstructions(prodApiBase, prodCode)
    expect(text).not.toContain(':8010')
    expect(text).toContain('https://prioritydispatch.chaosmonkey.dev')
  })

  it('production Claude Code setup instructions contain no :8010', () => {
    const text = buildSetupInstructions(prodApiBase, prodCode)
    expect(text).not.toContain(':8010')
    expect(text).toContain('/api/bridge/download/latest')
  })

  it('production VSIX URL is origin + /api/extension/download/latest', () => {
    const text = buildSetupInstructions(prodApiBase, prodCode)
    expect(text).toContain('https://prioritydispatch.chaosmonkey.dev/api/extension/download/latest')
    expect(text).not.toContain(':8010')
  })

  it('production bridge URL is origin + /api/bridge/download/latest', () => {
    const text = buildSetupInstructions(prodApiBase, prodCode)
    expect(text).toContain('https://prioritydispatch.chaosmonkey.dev/api/bridge/download/latest')
    expect(text).not.toContain(':8010')
  })

  it('no pilot-specific hostname is hardcoded in the builder', () => {
    // The builder must derive from its apiBaseUrl argument, not hardcode any tenant.
    const text = buildSetupInstructions('https://other-tenant.chaosmonkey.dev/api', 'CODE')
    expect(text).toContain('https://other-tenant.chaosmonkey.dev')
    expect(text).not.toContain('prioritydispatch')
  })

  it('local behavior remains correct (localhost:8010 is valid for local)', () => {
    const localText = buildSetupInstructions('http://localhost:8010/api', 'LOCAL-CODE')
    // Local may use :8010 — this is the legitimate local dev surface.
    expect(localText).toContain('http://localhost:8010')
  })

  it('Dashboards.vue source has no runtime :8010 fallback in pilotApiBase', () => {
    const src = readDashboards()
    const computedBlock = src.match(/const pilotApiBase = computed\(\(\) => \{([\s\S]*?)\n\}\)/)
    expect(computedBlock).toBeDefined()
    expect(computedBlock![1]).not.toMatch(/:8010/)
  })
})
