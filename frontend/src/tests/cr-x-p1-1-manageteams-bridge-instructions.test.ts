/**
 * CR-X P1-1: ManageTeams setup-instructions regression.
 *
 * Tests the ACTUAL setup-instructions generation path (buildSetupInstructions)
 * extracted from ManageTeams.vue. Proves:
 * - Claude Code text is present
 * - canonical bridge endpoint is present
 * - URL derives from the active/runtime API base rather than a hardcoded tenant
 * - existing VS Code / enrollment instructions remain present
 * - no customer-specific hostname is introduced
 * - Pilot API base URL shows ROOT URL (without /api) for IDE/bridge installer
 * - Download URLs use /api prefix (actual route path)
 */
import { describe, it, expect, vi } from 'vitest'
import { buildSetupInstructions, probeCursorAgentBridge } from '../lib/setupInstructions'

describe('CR-X P1-1: ManageTeams setup-instructions regression', () => {
  const testApiBase = 'https://test-runtime.chaosmonkey.dev/api'
  const testCode = 'CONNECT-ABC123'

  it('includes Claude Code bridge text', () => {
    const text = buildSetupInstructions(testApiBase, testCode)
    expect(text).toContain('Claude Code')
    expect(text).toContain('Claude Code bridge')
  })

  it('is client-aware: both IDE and Claude Code paths with shared code', () => {
    const text = buildSetupInstructions(testApiBase, testCode)
    // Both client paths are present and labelled
    expect(text).toContain('IDE extension')
    expect(text).toContain('Claude Code')
    // Claude Code install steps
    expect(text).toContain('Extract the archive')
    expect(text).toContain('node install.js')
    expect(text).toContain('Start Claude Code normally')
    // Developer installs clients for the tools they actually use; same code reusable
    expect(text).toContain('Install the client for each tool you actually use')
    expect(text).not.toContain('any combination')
    expect(text).toContain('same enrollment')
    expect(text).toMatch(/secure\s+installation connection/)
    // Personal enrollment code is surfaced up front
    expect(text).toContain('Your personal enrollment code')
    // No internal implementation jargon leaks to the developer
    expect(text).not.toContain('installation token')
    expect(text).not.toContain('bridge installer')
    expect(text).not.toContain('backend_claimed')
  })

  it('organizes instructions around developer tools, one workflow', () => {
    const text = buildSetupInstructions(testApiBase, testCode)
    // One onboarding workflow organized by the developer's tool
    expect(text).toContain('Install the client for each tool you actually use')
    expect(text).toContain('IDE extension — VS Code, Cursor, or Devin Desktop')
    expect(text).toContain('Claude Code')
    expect(text).toContain('Codex CLI')
  })

  it('enrollment code is personal — never suggests sharing across developers', () => {
    const text = buildSetupInstructions(testApiBase, testCode, { cursorAgentBridge: true })
    expect(text).toContain('personal')
    expect(text).toMatch(/do not share/i)
    expect(text).not.toContain('share the code with your team')
    expect(text).not.toContain('team enrollment code')
  })

  it('includes canonical bridge download endpoint', () => {
    const text = buildSetupInstructions(testApiBase, testCode)
    expect(text).toContain('/bridge/download/latest')
  })

  it('URL derives from runtime API base, not hardcoded tenant', () => {
    const text = buildSetupInstructions(testApiBase, testCode)
    // The bridge URL must contain the runtime API base
    expect(text).toContain(testApiBase)
    // The bridge URL is constructed from the runtime base
    expect(text).toContain(`${testApiBase}/bridge/download/latest`)
    // Must NOT contain hardcoded customer hostnames
    expect(text).not.toContain('patra.chaosmonkey.dev')
    expect(text).not.toContain('ryan.chaosmonkey.dev')
    expect(text).not.toContain('prioritydispatch')
  })

  it('existing VS Code / enrollment instructions remain present', () => {
    const text = buildSetupInstructions(testApiBase, testCode)
    expect(text).toContain('VS Code')
    expect(text).toContain('Cursor')
    expect(text).toContain('Devin')
    expect(text).toContain('ChaosMonkey: Connect')
    expect(text).toContain('enrollment code')
    expect(text).toContain(testCode)
    expect(text).toContain('/extension/download/latest')
  })

  it('no customer-specific hostname is introduced', () => {
    const text = buildSetupInstructions(testApiBase, testCode)
    const customerHostnames = [
      'patra.chaosmonkey.dev',
      'ryan.chaosmonkey.dev',
      'prioritydispatch.chaosmonkey.dev',
      '52.15.236.225',
      '18.225.216.252',
    ]
    for (const hostname of customerHostnames) {
      expect(text).not.toContain(hostname)
    }
  })

  it('Pilot API base URL shows ROOT URL without /api suffix', () => {
    const text = buildSetupInstructions(testApiBase, testCode)
    // The IDE extension and Claude Code bridge both append /api/... themselves
    // So the API base URL shown to the developer must be the ROOT (without /api)
    const rootUrl = 'https://test-runtime.chaosmonkey.dev'
    expect(text).toContain('API base URL')
    expect(text).toContain(rootUrl)
    // The API base URL line must show the ROOT URL, not the /api URL
    const lines = text.split('\n')
    const apiLine = lines.find(l => l.includes('API base URL'))
    expect(apiLine).toBeDefined()
    expect(apiLine).toContain(rootUrl)
    expect(apiLine).not.toContain('/api')
  })

  it('download URLs use /api prefix (actual route path)', () => {
    const text = buildSetupInstructions(testApiBase, testCode)
    // Download URLs must include /api because the routes are under /api/
    expect(text).toContain(`${testApiBase}/extension/download/latest`)
    expect(text).toContain(`${testApiBase}/bridge/download/latest`)
  })
})

describe('Cursor Agent companion section — capability-gated', () => {
  const testApiBase = 'https://test-runtime.chaosmonkey.dev/api'
  const testCode = 'CONNECT-ABC123'

  it('omits the Cursor Agents section when capability is disabled (default)', () => {
    const text = buildSetupInstructions(testApiBase, testCode)
    expect(text).not.toContain('Cursor Agents')
    expect(text).not.toContain('cursor-agent-bridge')
    expect(text).not.toContain('CM_CONNECT_CODE')
  })

  it('omits the Cursor Agents section when capability is explicitly false', () => {
    const text = buildSetupInstructions(testApiBase, testCode, { cursorAgentBridge: false })
    expect(text).not.toContain('Cursor Agents')
    expect(text).not.toContain('cursor-agent-bridge')
  })

  it('includes the Cursor Agents companion section when capability is enabled', () => {
    const text = buildSetupInstructions(testApiBase, testCode, { cursorAgentBridge: true })
    expect(text).toContain('Cursor Agents companion')
    expect(text).toContain(`${testApiBase}/cursor-agent-bridge/download/latest`)
    // Companion is framed as an add-on for Agents Window users, not a
    // separate fourth tool or an alternative to the IDE extension.
    expect(text).toContain("Cursor's standalone Agents Window")
    expect(text).toContain('alongside the extension, not instead of it')
  })

  it('companion instructions sit directly beneath the IDE extension steps', () => {
    const text = buildSetupInstructions(testApiBase, testCode, { cursorAgentBridge: true })
    // Cursor users see: IDE extension steps, then the companion section,
    // then Claude Code — one coherent Cursor path, not a section after Codex.
    const ideIdx = text.indexOf('IDE extension — VS Code, Cursor, or Devin Desktop')
    const companionIdx = text.indexOf('Cursor Agents companion (')
    const claudeIdx = text.indexOf('\nClaude Code\n')
    const codexIdx = text.indexOf('\nCodex CLI\n')
    expect(ideIdx).toBeGreaterThan(-1)
    expect(companionIdx).toBeGreaterThan(ideIdx)
    expect(companionIdx).toBeLessThan(claudeIdx)
    expect(companionIdx).toBeLessThan(codexIdx)
    // Neither integration auto-installs the other
    expect(text).not.toContain('automatically installs')
    expect(text).not.toContain('auto-install')
  })

  it('cursor section carries the verified install contract and artifact hash', () => {
    const text = buildSetupInstructions(testApiBase, testCode, { cursorAgentBridge: true })
    expect(text).toContain('972acbc5c02efccac995484c80534e34f28de837a1e65a72520286353d2bbe21')
    expect(text).toContain('node package/install.js')
    // Tenant-specific values come from the runtime arguments, not constants
    expect(text).toContain('CM_API_BASE_URL="https://test-runtime.chaosmonkey.dev"')
    expect(text).toContain(`CM_CONNECT_CODE="${testCode}"`)
  })

  it('cursor section distinguishes IDE extension and claims no verified coverage', () => {
    const text = buildSetupInstructions(testApiBase, testCode, { cursorAgentBridge: true })
    expect(text).toContain('separate from the Cursor IDE extension')
    expect(text).toContain('standalone Agents Window')
    expect(text).toContain('connectivity test')
    expect(text).toContain('Genuine Cursor agent')
    expect(text).toContain('coverage is verified')
  })

  it('cursor section does not introduce hardcoded pilot hostnames', () => {
    const text = buildSetupInstructions(testApiBase, testCode, { cursorAgentBridge: true })
    expect(text).not.toContain('gloo.chaosmonkey.dev')
    expect(text).not.toContain('patra.chaosmonkey.dev')
    expect(text).not.toContain('prioritydispatch')
    expect(text).not.toContain('52.15.236.225')
  })

  it('cursor section does not leak internal token terminology', () => {
    const text = buildSetupInstructions(testApiBase, testCode, { cursorAgentBridge: true })
    expect(text).not.toContain('installation token')
    expect(text).not.toContain('backend_claimed')
    expect(text).not.toContain('auth_token')
  })
})

describe('Cursor Agent capability probe — authoritative contract', () => {
  it('returns the verified manifest when the backend advertises capability', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        available: true,
        version: '0.4.2-cursor-bridge',
        filename: 'chaosmonkey-cursor-agent-bridge-0.4.2-cursor-bridge.tgz',
        sha256: '972acbc5c02efccac995484c80534e34f28de837a1e65a72520286353d2bbe21',
      }),
    })))
    const manifest = await probeCursorAgentBridge('https://probe-a.example/api')
    expect(manifest).not.toBeNull()
    expect(manifest!.sha256).toBe('972acbc5c02efccac995484c80534e34f28de837a1e65a72520286353d2bbe21')
    expect(fetch).toHaveBeenCalledWith('https://probe-a.example/api/cursor-agent-bridge/capability')
    vi.unstubAllGlobals()
  })

  it('fails closed (null) when the backend reports available=false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ available: false }) })))
    expect(await probeCursorAgentBridge('https://probe-b.example/api')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('fails closed (null) when the endpoint is absent (unpromoted pilot)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    expect(await probeCursorAgentBridge('https://probe-c.example/api')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('fails closed (null) on network error or malformed payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    expect(await probeCursorAgentBridge('https://probe-d.example/api')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ available: true }) })))
    expect(await probeCursorAgentBridge('https://probe-e.example/api')).toBeNull()
    vi.unstubAllGlobals()
  })
})
