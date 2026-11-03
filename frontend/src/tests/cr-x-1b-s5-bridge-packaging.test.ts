/**
 * CR-X Day 1B S5: Claude Code bridge packaging tests
 *
 * Tests:
 * 1. package.json exists with correct metadata
 * 2. Version matches BRIDGE_VERSION in bridge.js and install.js
 * 3. Bridge files pass Node syntax check
 * 4. Package contains only expected files (no secrets/junk)
 * 5. SHA-256 can be computed for all bridge files
 * 6. README quickstart covers install/config/connect/verification
 * 7. .gitignore excludes generated artifacts
 * 8. Bridge telemetry semantics are not changed
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'

const bridgeDir = resolve(__dirname, '../../../extensions/claude-code-bridge')

const packageJsonPath = resolve(bridgeDir, 'package.json')
const bridgePath = resolve(bridgeDir, 'bridge.js')
const installPath = resolve(bridgeDir, 'install.js')
const uninstallPath = resolve(bridgeDir, 'uninstall.js')
const readmePath = resolve(bridgeDir, 'README.md')
const gitignorePath = resolve(bridgeDir, '.gitignore')

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
const bridgeSource = readFileSync(bridgePath, 'utf-8')
const installSource = readFileSync(installPath, 'utf-8')
const readmeSource = readFileSync(readmePath, 'utf-8')
const gitignoreSource = readFileSync(gitignorePath, 'utf-8')

describe('CR-X Day 1B S5: package.json metadata', () => {
  it('package.json exists', () => {
    expect(existsSync(packageJsonPath)).toBe(true)
  })

  it('package name is chaosmonkey-cc-bridge', () => {
    expect(packageJson.name).toBe('chaosmonkey-cc-bridge')
  })

  it('package version matches BRIDGE_VERSION', () => {
    expect(packageJson.version).toBe('0.4.1-cc-bridge')
  })

  it('package main is bridge.js', () => {
    expect(packageJson.main).toBe('bridge.js')
  })

  it('package files list includes only bridge source files', () => {
    expect(packageJson.files).toContain('bridge.js')
    expect(packageJson.files).toContain('install.js')
    expect(packageJson.files).toContain('uninstall.js')
    expect(packageJson.files).toContain('README.md')
    // No test files, no secrets, no state files
    expect(packageJson.files).not.toContain('config.json')
    expect(packageJson.files).not.toContain('state.json')
    expect(packageJson.files).not.toContain('bridge.log')
  })

  it('package has check and pack scripts', () => {
    expect(packageJson.scripts).toBeDefined()
    expect(packageJson.scripts.check).toBeDefined()
    expect(packageJson.scripts.package).toBeDefined()
  })

  it('package requires Node >= 18', () => {
    expect(packageJson.engines.node).toBe('>=18.0.0')
  })
})

describe('CR-X Day 1B S5: version consistency', () => {
  it('BRIDGE_VERSION in bridge.js matches package.json version', () => {
    expect(bridgeSource).toContain("BRIDGE_VERSION = '0.4.1-cc-bridge'")
  })

  it('BRIDGE_VERSION in install.js matches package.json version', () => {
    expect(installSource).toContain("BRIDGE_VERSION = '0.4.1-cc-bridge'")
  })
})

describe('CR-X Day 1B S5: syntax validation', () => {
  it('bridge.js passes node --check', () => {
    expect(() => execSync('node --check bridge.js', { cwd: bridgeDir })).not.toThrow()
  })

  it('install.js passes node --check', () => {
    expect(() => execSync('node --check install.js', { cwd: bridgeDir })).not.toThrow()
  })

  it('uninstall.js passes node --check', () => {
    expect(() => execSync('node --check uninstall.js', { cwd: bridgeDir })).not.toThrow()
  })
})

describe('CR-X Day 1B S5: SHA-256 verification', () => {
  it('SHA-256 can be computed for all bridge files', () => {
    const sha = execSync('shasum -a 256 bridge.js install.js uninstall.js', {
      cwd: bridgeDir,
      encoding: 'utf-8',
    })
    expect(sha).toContain('bridge.js')
    expect(sha).toContain('install.js')
    expect(sha).toContain('uninstall.js')
    // Each line should have a 64-char hex hash
    const lines = sha.trim().split('\n')
    expect(lines.length).toBe(3)
    for (const line of lines) {
      const hash = line.split(/\s+/)[0]
      expect(hash.length).toBe(64)
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe('CR-X Day 1B S5: README quickstart', () => {
  it('README exists', () => {
    expect(existsSync(readmePath)).toBe(true)
  })

  it('README covers install instructions', () => {
    expect(readmeSource).toContain('node install.js')
  })

  it('README covers uninstall instructions', () => {
    expect(readmeSource).toContain('node uninstall.js')
  })

  it('README covers connect code configuration', () => {
    expect(readmeSource).toContain('connect code')
    expect(readmeSource).toContain('Settings')
  })

  it('README covers verification', () => {
    expect(readmeSource).toContain('cat ~/.claude/settings.json')
  })

  it('README covers SHA-256 verification', () => {
    expect(readmeSource).toContain('shasum -a 256')
  })

  it('README covers packaging (npm pack)', () => {
    expect(readmeSource).toContain('npm pack')
    expect(readmeSource).toContain('.tgz')
  })

  it('README states version', () => {
    expect(readmeSource).toContain('0.4.1-cc-bridge')
  })

  it('README states it is NOT a VS Code extension', () => {
    expect(readmeSource.toLowerCase()).toContain('not')
    expect(readmeSource.toLowerCase()).toContain('vs code extension')
  })

  it('README covers privacy contract reference', () => {
    expect(readmeSource).toContain('privacy')
  })
})

describe('CR-X Day 1B S5: README recipient installation section', () => {
  it('README has a recipient installation section for distributed tarball', () => {
    expect(readmeSource).toContain('Recipient Installation')
    expect(readmeSource).toContain('tarball')
  })

  it('README covers tarball SHA-256 verification before extraction', () => {
    expect(readmeSource).toContain('shasum -a 256 chaosmonkey-cc-bridge-0.4.1-cc-bridge.tgz')
  })

  it('README directs to published SHA-256 value (not self-referential tarball hash)', () => {
    // The tarball hash cannot be in the README (circular dependency — README is inside tarball)
    // Instead, README directs to release notes / admin for the tarball hash
    expect(readmeSource).toContain('release notes')
  })

  it('README covers extracting the tarball without source repo', () => {
    expect(readmeSource).toContain('tar -xzf')
    expect(readmeSource).toContain('chaosmonkey-cc-bridge-0.4.1-cc-bridge.tgz')
  })

  it('README covers cd into extracted package directory', () => {
    expect(readmeSource).toContain('cd package')
  })

  it('README covers verifying extracted file SHA-256 values', () => {
    expect(readmeSource).toContain('shasum -a 256 bridge.js install.js uninstall.js')
  })

  it('README includes expected bridge.js SHA-256 value', () => {
    expect(readmeSource).toContain('ee472efc164642ddcac3170f8dcb69ce771baacd68c6a7b7c817d62580cd2720')
  })

  it('README includes expected install.js SHA-256 value', () => {
    expect(readmeSource).toContain('cc45a2c1812a63025fe3c279ac36ee5d608f43068228f561891eeee247805bf9')
  })

  it('README includes expected uninstall.js SHA-256 value', () => {
    expect(readmeSource).toContain('7e0f22fdfd4a95c57cf40470c545e43073f85d4a8f374821d439e683f853998c')
  })

  it('README covers running install.js from extracted tarball', () => {
    // The recipient section must mention node install.js
    expect(readmeSource).toContain('node install.js')
  })

  it('README covers connect code flow for recipients', () => {
    expect(readmeSource).toContain('connect code')
    expect(readmeSource).toContain('Settings')
  })

  it('README covers verification for recipients', () => {
    expect(readmeSource).toContain('cat ~/.claude/settings.json')
  })

  it('README has separate source development section', () => {
    expect(readmeSource).toContain('Source Development')
  })

  it('README does not require source repo for recipient install', () => {
    // The recipient section should explicitly state no source repo needed
    // (markdown bold markers stripped for comparison)
    const cleanReadme = readmeSource.replace(/\*\*/g, '').toLowerCase()
    expect(cleanReadme).toContain('not need the chaosmonkey source')
  })
})

describe('CR-X Day 1B S5: .gitignore excludes generated artifacts', () => {
  it('.gitignore exists', () => {
    expect(existsSync(gitignorePath)).toBe(true)
  })

  it('.gitignore excludes *.tgz', () => {
    expect(gitignoreSource).toContain('*.tgz')
  })

  it('.gitignore excludes node_modules', () => {
    expect(gitignoreSource).toContain('node_modules')
  })

  it('.gitignore excludes .DS_Store', () => {
    expect(gitignoreSource).toContain('.DS_Store')
  })
})

describe('CR-X Day 1B S5: bridge telemetry semantics unchanged', () => {
  it('bridge SOURCE is still claude-code', () => {
    expect(bridgeSource).toContain("SOURCE = 'claude-code'")
  })

  it('bridge VSCODE_VERSION is still claude-code', () => {
    expect(bridgeSource).toContain("VSCODE_VERSION = 'claude-code'")
  })

  it('bridge still uses HTTPS with localhost exception', () => {
    expect(bridgeSource).toContain('https')
    expect(bridgeSource).toContain('localhost')
  })

  it('bridge still exits 0 on telemetry failure (never blocks Claude Code)', () => {
    expect(bridgeSource).toContain('exit 0')
    expect(bridgeSource).toContain('never blocks')
  })

  it('bridge still sanitizes git remote URLs', () => {
    expect(bridgeSource).toContain('sanitize')
  })
})
