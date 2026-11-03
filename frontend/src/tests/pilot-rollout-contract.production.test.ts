/**
 * CR-X Pilot Rollout Contract — Canonical Extension Download Authority
 *
 * Production-path tests proving the ONE canonical extension rollout contract:
 *   ONE TENANT URL → ONE ENROLLMENT SURFACE → ONE CURRENT EXTENSION VERSION
 *   → ONE IMMUTABLE INSTALL ARTIFACT → ONE DOWNLOAD AUTHORITY → ONE TESTED CONNECT FLOW
 *
 * These tests verify Local source authority for the extension rollout behavior
 * that was browser/customer-path accepted on Ed (Priority Dispatch) on 2026-08-31.
 *
 * No Ed/customer runtime is touched. All assertions are against Local source files.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const FRONTEND_SRC = join(__dirname, '..') // frontend/src
const PROJECT_ROOT = join(FRONTEND_SRC, '..', '..') // chaosmonkey-v1-rc1
const BACKEND_STORAGE_EXTENSIONS = join(PROJECT_ROOT, 'backend', 'storage', 'app', 'extensions')

// ─── Canonical artifact identity (accepted release manifest) ───
const CANONICAL_VERSION = '0.4.1'
const CANONICAL_FILENAME = 'chaosmonkey-telemetry-0.4.1.vsix'
const CANONICAL_SHA256 = 'b66fc8545fda619c68f9e502a7198307b00a897b991c07bb0f2b1c1291889a94'
const CANONICAL_SIZE = 51657
const CANONICAL_ENDPOINT = '/api/extension/download/latest'

// ─── Helpers ───

function sha256(filePath: string): string {
  const buf = readFileSync(filePath)
  return createHash('sha256').update(buf).digest('hex')
}

function readFile(path: string): string {
  return readFileSync(path, 'utf-8')
}

// ─── Tests ───

describe('CR-X Pilot Rollout Contract — Canonical Extension Download Authority', () => {

  // Test 1: canonical endpoint resolves current artifact
  it('test 1: canonical VSIX artifact exists at storage/app/extensions/', () => {
    const vsixPath = join(BACKEND_STORAGE_EXTENSIONS, CANONICAL_FILENAME)
    expect(existsSync(vsixPath)).toBe(true)
  })

  // Test 2: served filename/version match release authority
  it('test 2: canonical VSIX filename matches release authority', () => {
    const vsixPath = join(BACKEND_STORAGE_EXTENSIONS, CANONICAL_FILENAME)
    expect(existsSync(vsixPath)).toBe(true)
    const stat = statSync(vsixPath)
    expect(stat.size).toBe(CANONICAL_SIZE)
  })

  // Test 3: SHA can be verified against the release artifact
  it('test 3: canonical VSIX SHA-256 matches release authority', () => {
    const vsixPath = join(BACKEND_STORAGE_EXTENSIONS, CANONICAL_FILENAME)
    const hash = sha256(vsixPath)
    expect(hash).toBe(CANONICAL_SHA256)
  })

  // Test 4: InviteController setup reports current extension version
  it('test 4: InviteController reports extension_version 0.4.1', () => {
    const controller = readFile(join(PROJECT_ROOT, 'backend', 'app', 'Http', 'Controllers', 'InviteController.php'))
    expect(controller).toContain("'extension_version' => '0.4.1'")
  })

  // Test 5: InviteController setup reports canonical download endpoint
  it('test 5: InviteController vsix_download_url uses canonical endpoint', () => {
    const controller = readFile(join(PROJECT_ROOT, 'backend', 'app', 'Http', 'Controllers', 'InviteController.php'))
    expect(controller).toContain('/api/extension/download/latest')
    expect(controller).not.toContain('/api/extension/source/download')
  })

  // Test 6: Team instructions use canonical endpoint
  it('test 6: ManageTeams.vue setup instructions use canonical endpoint and version 0.4.1', () => {
    const vue = readFile(join(FRONTEND_SRC, 'pages', 'ManageTeams.vue'))
    expect(vue).not.toContain('/extension/source/download')
    expect(vue).not.toContain('0.4.0 setup')
    // Setup instructions were extracted to lib/setupInstructions.ts for testability
    const setupLib = readFile(join(FRONTEND_SRC, 'lib', 'setupInstructions.ts'))
    expect(setupLib).toContain('/extension/download/latest')
    expect(setupLib).toContain('/bridge/download/latest')
    expect(setupLib).toContain('0.4.1')
    expect(setupLib).not.toContain('/extension/source/download')
  })

  // Test 7: Dashboard button uses canonical endpoint
  it('test 7: Dashboards.vue download button uses canonical endpoint and 0.4.1 filename', () => {
    const vue = readFile(join(FRONTEND_SRC, 'pages', 'Dashboards.vue'))
    expect(vue).toContain('/api/extension/download/latest')
    expect(vue).toContain('chaosmonkey-telemetry-0.4.1.vsix')
    expect(vue).not.toContain('/api/extension/source/download')
  })

  // Test 8: enrollment/invite flows use canonical endpoint
  it('test 8: AcceptInvite.vue and PerformanceInsightsWidget.vue use canonical endpoint', () => {
    const acceptInvite = readFile(join(FRONTEND_SRC, 'pages', 'AcceptInvite.vue'))
    expect(acceptInvite).toContain('/api/extension/download/latest')
    expect(acceptInvite).not.toContain('/api/extension/source/download')

    const piWidget = readFile(join(FRONTEND_SRC, 'components', 'PerformanceInsightsWidget.vue'))
    expect(piWidget).toContain('/api/extension/download/latest')
    expect(piWidget).not.toContain('/api/extension/source/download')
  })

  // Test 9: no active customer-facing source references 0.3.x installers
  it('test 9: no customer-facing Vue source references 0.3.x installers or source/download', () => {
    const customerFiles = [
      'pages/Dashboards.vue',
      'pages/ManageTeams.vue',
      'pages/Enroll.vue',
      'pages/Invite.vue',
      'pages/AcceptInvite.vue',
      'pages/Settings.vue',
      'components/PerformanceInsightsWidget.vue',
    ]
    for (const file of customerFiles) {
      const content = readFile(join(FRONTEND_SRC, file))
      // No source/download references in customer-facing files
      expect(content).not.toContain('extension/source/download')
      // No 0.3.x VSIX references as current install
      expect(content).not.toMatch(/chaosmonkey-extension-3-5|0\.3\.9\.vsix|0\.3\.7\.vsix/)
    }
  })

  // Test 10: no active customer-facing source references temporary rollout HTML/IP URLs
  it('test 10: no customer-facing Vue source references IP-based rollout URLs or cr2-rollout-admin', () => {
    const customerFiles = [
      'pages/Dashboards.vue',
      'pages/ManageTeams.vue',
      'pages/Enroll.vue',
      'pages/Invite.vue',
      'pages/AcceptInvite.vue',
      'pages/Settings.vue',
      'components/PerformanceInsightsWidget.vue',
    ]
    for (const file of customerFiles) {
      const content = readFile(join(FRONTEND_SRC, file))
      // No raw IP URLs (52.15.236.225 etc.)
      expect(content).not.toMatch(/\d+\.\d+\.\d+\.\d+:\d+/)
      // No cr2-rollout-admin references
      expect(content).not.toContain('cr2-rollout-admin')
    }
  })

  // Test 11: existing 0.4.0 → 0.4.1 identity/connect compatibility remains unchanged
  it('test 11: backend ingestion gate accepts >=0.4.0 (includes 0.4.1)', () => {
    const controller = readFile(join(PROJECT_ROOT, 'backend', 'app', 'Http', 'Controllers', 'TelemetryController.php'))
    // The version gate must use >= 0.4.0, which accepts 0.4.1
    expect(controller).toContain("version_compare")
    expect(controller).toContain("'0.4.0', '>='")
  })

  // Test 12: tenant API base derives from runtime tenant configuration, not Ed-specific hardcoding
  it('test 12: InviteController api_base_url derives from config(app.url), not hardcoded hostname', () => {
    const controller = readFile(join(PROJECT_ROOT, 'backend', 'app', 'Http', 'Controllers', 'InviteController.php'))
    // Must use config('app.url') for tenant-derived API base, not a hardcoded hostname
    expect(controller).toContain("config('app.url'")
    // Must NOT hardcode prioritydispatch hostname in generic source
    expect(controller).not.toContain('prioritydispatch.chaosmonkey.dev')
  })

  // ─── Bonus: ExtensionController canonical endpoint serves 0.4.1 ───
  it('bonus: ExtensionController downloadLatest() serves 0.4.1 filename', () => {
    const controller = readFile(join(PROJECT_ROOT, 'backend', 'app', 'Http', 'Controllers', 'ExtensionController.php'))
    expect(controller).toContain('chaosmonkey-telemetry-0.4.1.vsix')
    expect(controller).toContain('downloadLatest')
  })

  // ─── Bonus: route exists ───
  it('bonus: routes/api.php has canonical download/latest route', () => {
    const routes = readFile(join(PROJECT_ROOT, 'backend', 'routes', 'api.php'))
    expect(routes).toContain("extension/download/latest")
    expect(routes).toContain('downloadLatest')
  })

  // ─── Bonus: no 0.3.9 VSIX in public/downloads ───
  it('bonus: no 0.3.9 VSIX in frontend public/downloads', () => {
    const downloadsDir = join(FRONTEND_SRC, 'public', 'downloads')
    const vsixPath = join(downloadsDir, 'chaosmonkey-extension-0.3.9.vsix')
    // The 0.3.9 VSIX must not exist as a customer-facing download
    expect(existsSync(vsixPath)).toBe(false)
  })
})
