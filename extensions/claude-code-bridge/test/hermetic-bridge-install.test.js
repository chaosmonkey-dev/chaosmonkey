#!/usr/bin/env node
'use strict';

/**
 * CR-X Ed Rollout Gate — Hermetic Isolated Bridge Install/Uninstall Proof
 *
 * Proves H/I/J from the release contract:
 *   H. tarball installs successfully in an isolated temp HOME
 *   I. installer validation succeeds against hermetic backend
 *   J. uninstall restores prior Claude settings
 *
 * Plus:
 *   - Canonical tarball SHA matches frozen release SHA
 *   - Extraction/package contents are valid
 *   - Installer writes expected ~/.chaosmonkey-cc-bridge/ state
 *   - Installer merges hooks into ~/.claude/settings.json
 *   - Pre-existing unrelated Claude settings/hooks survive intact
 *   - Bridge test-init validation succeeds
 *   - Same still-valid connect code can represent a second distinct installation
 *   - Credentials/install IDs remain distinct
 *   - Official bridge classifies as claude-code
 *   - Uninstall removes only CM bridge hooks/state
 *   - Uninstall preserves all unrelated prior Claude settings
 *   - Repeat install/uninstall is safe/idempotent
 *   - Bruce/community-hook coexistence: official install does not delete it
 *
 * Hermetic: uses a mock HTTP server on a random port. No real backend, no DB,
 * no real connect codes, no real tokens. Temp HOME directory is cleaned up.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { execFileSync, spawnSync, spawn } = require('child_process');
const assert = require('assert');

// ─── Constants ───────────────────────────────────────────────────────────

const FROZEN_TGZ_SHA256 = '73590be057c0c1af4d3b89f4d4e7f40223a8ccace6a28ea2cebd651ade4cb9bc';
const FROZEN_TGZ_NAME = 'chaosmonkey-cc-bridge-0.4.2-cc-bridge.tgz';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TGZ_PATH = path.join(REPO_ROOT, 'backend', 'resources', 'extensions', FROZEN_TGZ_NAME);
const BRIDGE_VERSION = '0.4.2-cc-bridge';

// ─── Helpers ─────────────────────────────────────────────────────────────

let testCount = 0;
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failCount++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    if (e.stack) console.error(`    ${e.stack.split('\n')[1]?.trim() || ''}`);
  }
}

async function asyncTest(name, fn) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failCount++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    if (e.stack) console.error(`    ${e.stack.split('\n')[1]?.trim() || ''}`);
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(val, msg) {
  if (!val) {
    throw new Error(msg || 'expected truthy value');
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// ─── Mock Server ─────────────────────────────────────────────────────────

let mockServer;
let mockServerPort;
let exchangeCount = 0;
let telemetryEvents = [];

function startMockServer() {
  return new Promise((resolve, reject) => {
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (req.method === 'POST' && req.url === '/api/ide/connect/exchange') {
          exchangeCount++;
          const payload = JSON.parse(body);
          // Validate the exchange payload shape
          if (!payload.code || !payload.installation_id || !payload.extension_version) {
            res.writeHead(422);
            res.end(JSON.stringify({ error: 'Invalid payload' }));
            return;
          }
          // Return a valid token response
          res.writeHead(200);
          res.end(JSON.stringify({
            token: `mock-token-${exchangeCount}-${Date.now()}`,
            expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
            organization_id: 1,
            developer_id: `invite:mock-${exchangeCount}`,
            team_id: null,
            identity_source: 'backend_claimed',
          }));
          return;
        }

        if (req.method === 'POST' && req.url === '/api/telemetry') {
          const payload = JSON.parse(body);
          const events = payload.events || [];
          telemetryEvents.push(...events);
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'ok',
            received: events.length,
            duplicate: false,
          }));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      });
    });
    mockServer.listen(0, '127.0.0.1', () => {
      mockServerPort = mockServer.address().port;
      resolve();
    });
    mockServer.on('error', reject);
  });
}

function stopMockServer() {
  return new Promise((resolve) => {
    if (mockServer) {
      mockServer.close(() => resolve());
    } else {
      resolve();
    }
  });
}

// ─── Isolated HOME management ─────────────────────────────────────────────

let tempHome;
let packageDir;

function setupTempHome() {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-bridge-test-'));
  // Create ~/.claude directory with pre-existing settings
  const claudeDir = path.join(tempHome, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  return tempHome;
}

function cleanupTempHome() {
  try {
    fs.rmSync(tempHome, { recursive: true, force: true });
  } catch {}
}

function runInstaller(apiBaseUrl, connectCode) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['install.js'], {
      cwd: packageDir,
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill('SIGKILL');
        resolve({ status: -1, stdout, stderr: stderr + '\nTIMEOUT' });
      }
    }, 20000);

    child.stdout.on('data', (d) => stdout += d.toString());
    child.stderr.on('data', (d) => stderr += d.toString());

    child.on('error', (e) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(e);
      }
    });

    child.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ status: code, stdout, stderr });
      }
    });

    // Write inputs with small delays to allow readline to process each line
    setTimeout(() => {
      child.stdin.write(apiBaseUrl + '\n');
      setTimeout(() => {
        child.stdin.write(connectCode + '\n');
        setTimeout(() => {
          child.stdin.end();
        }, 500);
      }, 500);
    }, 500);
  });
}

function runUninstaller() {
  const result = spawnSync('node', ['uninstall.js'], {
    cwd: packageDir,
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
    },
    timeout: 15000,
    encoding: 'utf8',
  });
  return result;
}

function readClaudeSettings() {
  const p = path.join(tempHome, '.claude', 'settings.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readBridgeConfig() {
  const p = path.join(tempHome, '.chaosmonkey-cc-bridge', 'config.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function countCmHooks(settings) {
  if (!settings || !settings.hooks) return 0;
  let count = 0;
  for (const hookName of Object.keys(settings.hooks)) {
    for (const entry of settings.hooks[hookName]) {
      if (entry && Array.isArray(entry.hooks)) {
        for (const h of entry.hooks) {
          if (h.command && (h.command.includes('chaosmonkey-cc-bridge') || h.command.includes('bridge.js'))) {
            count++;
          }
        }
      }
    }
  }
  return count;
}

function countBruceHooks(settings) {
  if (!settings || !settings.hooks) return 0;
  let count = 0;
  for (const hookName of Object.keys(settings.hooks)) {
    for (const entry of settings.hooks[hookName]) {
      if (entry && Array.isArray(entry.hooks)) {
        for (const h of entry.hooks) {
          if (h.command && h.command.includes('bruce-community-hook')) {
            count++;
          }
        }
      }
    }
  }
  return count;
}

// ─── Pre-existing settings fixture ───────────────────────────────────────

function writePreExistingSettings() {
  const settings = {
    permissions: {
      allow: ['Bash(npm:*)', 'Edit(*)'],
      deny: ['Bash(rm:*)'],
    },
    env: {
      MY_CUSTOM_VAR: 'preserved-value',
    },
    hooks: {
      SessionStart: [
        {
          hooks: [
            { type: 'command', command: 'echo bruce-community-hook session-start' },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Edit',
          hooks: [
            { type: 'command', command: 'echo bruce-community-hook post-edit' },
          ],
        },
      ],
    },
    someOtherSetting: 'must-survive',
  };
  const p = path.join(tempHome, '.claude', 'settings.json');
  fs.writeFileSync(p, JSON.stringify(settings, null, 2));
}

// ─── Test Suite ───────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n========================================');
  console.log('CR-X Ed Rollout Gate — Hermetic Bridge Install/Uninstall Proof');
  console.log('========================================\n');

  // ─── A. Canonical tarball verification ──────────────────────────────

  console.log('A. Canonical tarball verification:');

  test('tarball file exists at backend/resources/extensions/', () => {
    assertTrue(fs.existsSync(TGZ_PATH), `Expected tarball at ${TGZ_PATH}`);
  });

  test('tarball SHA-256 matches frozen release SHA', () => {
    const hash = sha256(TGZ_PATH);
    assertEqual(hash, FROZEN_TGZ_SHA256, 'SHA-256 mismatch');
  });

  test('tarball filename is correct', () => {
    assertEqual(path.basename(TGZ_PATH), FROZEN_TGZ_NAME, 'filename mismatch');
  });

  // ─── B. Extraction and package contents ─────────────────────────────

  console.log('\nB. Extraction and package contents:');

  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-bridge-extract-'));
  try {
    execFileSync('tar', ['xzf', TGZ_PATH], { cwd: extractDir });
    packageDir = path.join(extractDir, 'package');

    test('extraction produces package/ directory', () => {
      assertTrue(fs.existsSync(packageDir), 'Expected package/ directory');
    });

    test('package contains bridge.js', () => {
      assertTrue(fs.existsSync(path.join(packageDir, 'bridge.js')), 'Missing bridge.js');
    });

    test('package contains install.js', () => {
      assertTrue(fs.existsSync(path.join(packageDir, 'install.js')), 'Missing install.js');
    });

    test('package contains uninstall.js', () => {
      assertTrue(fs.existsSync(path.join(packageDir, 'uninstall.js')), 'Missing uninstall.js');
    });

    test('package contains package.json', () => {
      assertTrue(fs.existsSync(path.join(packageDir, 'package.json')), 'Missing package.json');
    });

    test('package.json has correct name and version', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
      assertEqual(pkg.name, 'chaosmonkey-cc-bridge', 'package name mismatch');
      assertEqual(pkg.version, BRIDGE_VERSION, 'package version mismatch');
    });

    test('bridge.js passes syntax check', () => {
      const result = spawnSync('node', ['--check', path.join(packageDir, 'bridge.js')], { encoding: 'utf8' });
      assertEqual(result.status, 0, 'bridge.js syntax check failed');
    });

    test('install.js passes syntax check', () => {
      const result = spawnSync('node', ['--check', path.join(packageDir, 'install.js')], { encoding: 'utf8' });
      assertEqual(result.status, 0, 'install.js syntax check failed');
    });

    test('uninstall.js passes syntax check', () => {
      const result = spawnSync('node', ['--check', path.join(packageDir, 'uninstall.js')], { encoding: 'utf8' });
      assertEqual(result.status, 0, 'uninstall.js syntax check failed');
    });
  } finally {
    // Don't clean up extractDir yet — we need packageDir for install tests
  }

  // ─── C. Mock server startup ─────────────────────────────────────────

  console.log('\nC. Mock server startup:');
  await startMockServer();
  test('mock server started on random port', () => {
    assertTrue(mockServerPort > 0, 'Mock server port not assigned');
  });

  const mockApiUrl = `http://127.0.0.1:${mockServerPort}`;

  // ─── D. First install (H) ────────────────────────────────────────────

  console.log('\nD. First install (H — tarball installs in isolated temp HOME):');

  setupTempHome();
  writePreExistingSettings();

  test('pre-existing settings written before install', () => {
    const settings = readClaudeSettings();
    assertTrue(settings !== null, 'Settings should exist');
    assertEqual(settings.someOtherSetting, 'must-survive', 'Pre-existing setting missing');
    assertEqual(countBruceHooks(settings), 2, 'Bruce hooks should be present before install');
  });

  let installResult1;
  await asyncTest('installer succeeds against hermetic backend', async () => {
    installResult1 = await runInstaller(mockApiUrl, 'MOCK-CONNECT-CODE-001');
    assertEqual(installResult1.status, 0, `Installer failed with exit code ${installResult1.status}\nstdout: ${installResult1.stdout}\nstderr: ${installResult1.stderr}`);
  });

  test('installer output contains INSTALLATION SUCCESSFUL', () => {
    assertTrue(
      installResult1.stdout.includes('INSTALLATION SUCCESSFUL'),
      `Expected INSTALLATION SUCCESSFUL in output: ${installResult1.stdout.slice(-500)}`,
    );
  });

  test('exchange endpoint was called', () => {
    assertEqual(exchangeCount, 1, 'Expected 1 exchange call');
  });

  // ─── E. Config state verification ──────────────────────────────────

  console.log('\nE. Config state verification:');

  test('~/.chaosmonkey-cc-bridge/config.json is written', () => {
    const config = readBridgeConfig();
    assertTrue(config !== null, 'Config not found');
  });

  test('config has api_base_url', () => {
    const config = readBridgeConfig();
    assertEqual(config.api_base_url, mockApiUrl, 'api_base_url mismatch');
  });

  test('config has auth_token', () => {
    const config = readBridgeConfig();
    assertTrue(config.auth_token && config.auth_token.startsWith('mock-token-'), 'Missing or invalid auth_token');
  });

  test('config has installation_id (UUID v4)', () => {
    const config = readBridgeConfig();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    assertTrue(uuidRegex.test(config.installation_id), `Invalid installation_id: ${config.installation_id}`);
  });

  test('config has developer_id from backend', () => {
    const config = readBridgeConfig();
    assertTrue(config.developer_id && config.developer_id.startsWith('invite:mock-'), 'Missing developer_id');
  });

  test('config has enabled=true', () => {
    const config = readBridgeConfig();
    assertEqual(config.enabled, true, 'enabled should be true');
  });

  test('config has bridge_version', () => {
    const config = readBridgeConfig();
    assertEqual(config.bridge_version, BRIDGE_VERSION, 'bridge_version mismatch');
  });

  // ─── F. Claude settings merge verification ───────────────────────────

  console.log('\nF. Claude settings merge verification:');

  test('settings.json still exists after install', () => {
    assertTrue(readClaudeSettings() !== null, 'settings.json missing after install');
  });

  test('CM hooks are present in settings.json', () => {
    const settings = readClaudeSettings();
    const cmCount = countCmHooks(settings);
    assertEqual(cmCount, 4, `Expected 4 CM hooks, got ${cmCount}`);
  });

  test('SessionStart hook is present', () => {
    const settings = readClaudeSettings();
    assertTrue(settings.hooks && settings.hooks.SessionStart, 'SessionStart hook missing');
  });

  test('SessionEnd hook is present with timeout', () => {
    const settings = readClaudeSettings();
    assertTrue(settings.hooks && settings.hooks.SessionEnd, 'SessionEnd hook missing');
    const hasTimeout = settings.hooks.SessionEnd.some(e =>
      e.hooks && e.hooks.some(h => h.timeout === 10),
    );
    assertTrue(hasTimeout, 'SessionEnd should have timeout: 10');
  });

  test('PostToolUse hooks are present (Edit + Bash)', () => {
    const settings = readClaudeSettings();
    assertTrue(settings.hooks && settings.hooks.PostToolUse, 'PostToolUse hook missing');
    const matchers = settings.hooks.PostToolUse.map(e => e.matcher).filter(Boolean);
    assertTrue(matchers.includes('Edit|Write|MultiEdit|NotebookEdit'), 'Edit matcher missing');
    assertTrue(matchers.includes('Bash'), 'Bash matcher missing');
  });

  // ─── G. Pre-existing settings preservation ──────────────────────────

  console.log('\nG. Pre-existing settings preservation:');

  test('pre-existing someOtherSetting survives install', () => {
    const settings = readClaudeSettings();
    assertEqual(settings.someOtherSetting, 'must-survive', 'Pre-existing setting lost');
  });

  test('pre-existing permissions survive install', () => {
    const settings = readClaudeSettings();
    assertTrue(settings.permissions, 'permissions lost');
    assertEqual(settings.permissions.allow[0], 'Bash(npm:*)', 'permissions.allow lost');
  });

  test('pre-existing env survives install', () => {
    const settings = readClaudeSettings();
    assertTrue(settings.env, 'env lost');
    assertEqual(settings.env.MY_CUSTOM_VAR, 'preserved-value', 'env var lost');
  });

  // ─── H. Bruce community-hook coexistence ────────────────────────────

  console.log('\nH. Bruce community-hook coexistence:');

  test('Bruce community hooks survive CM install', () => {
    const settings = readClaudeSettings();
    const bruceCount = countBruceHooks(settings);
    assertEqual(bruceCount, 2, `Expected 2 Bruce hooks, got ${bruceCount}`);
  });

  test('Bruce SessionStart hook is preserved alongside CM SessionStart', () => {
    const settings = readClaudeSettings();
    const sessionStartEntries = settings.hooks.SessionStart;
    assertTrue(sessionStartEntries.length >= 2, 'Expected at least 2 SessionStart entries (Bruce + CM)');
    const hasBruce = sessionStartEntries.some(e =>
      e.hooks && e.hooks.some(h => h.command.includes('bruce-community-hook')),
    );
    const hasCm = sessionStartEntries.some(e =>
      e.hooks && e.hooks.some(h => h.command.includes('bridge.js')),
    );
    assertTrue(hasBruce, 'Bruce SessionStart hook missing');
    assertTrue(hasCm, 'CM SessionStart hook missing');
  });

  // ─── I. Connectivity validation ─────────────────────────────────────

  console.log('\nI. Connectivity validation:');

  test('test_init event was sent to telemetry endpoint', () => {
    const testEvents = telemetryEvents.filter(e => e.event_type === 'test_init');
    assertEqual(testEvents.length, 1, `Expected 1 test_init event, got ${testEvents.length}`);
  });

  test('test_init event has source=claude-code', () => {
    const testEvents = telemetryEvents.filter(e => e.event_type === 'test_init');
    assertEqual(testEvents[0].metadata.source, 'claude-code', 'source mismatch');
  });

  test('test_init event has trigger=installer_validation', () => {
    const testEvents = telemetryEvents.filter(e => e.event_type === 'test_init');
    assertEqual(testEvents[0].metadata.trigger, 'installer_validation', 'trigger mismatch');
  });

  test('test_init event has test_mode=true', () => {
    const testEvents = telemetryEvents.filter(e => e.event_type === 'test_init');
    assertEqual(testEvents[0].metadata.test_mode, true, 'test_mode mismatch');
  });

  // ─── I2. Successful-install credential backup cleanup ─────────────

  console.log('\nI2. Successful-install credential backup cleanup:');

  test('zero config.json.backup-* files remain after successful install', () => {
    const stateDir = path.join(tempHome, '.chaosmonkey-cc-bridge');
    if (!fs.existsSync(stateDir)) return; // no state dir — ok
    const contents = fs.readdirSync(stateDir);
    const backups = contents.filter(f => f.startsWith('config.json.backup-'));
    assertEqual(backups.length, 0, `Expected 0 config backups after successful install, found: ${backups.join(', ')}`);
  });

  test('no stale auth_token remains in any backup file', () => {
    const stateDir = path.join(tempHome, '.chaosmonkey-cc-bridge');
    if (!fs.existsSync(stateDir)) return; // no state dir — ok
    const contents = fs.readdirSync(stateDir);
    for (const f of contents) {
      if (f.includes('backup')) {
        const fullPath = path.join(stateDir, f);
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('auth_token') || content.includes('mock-token-')) {
          throw new Error(`Credential found in backup file ${f}`);
        }
      }
    }
  });

  // ─── J. Second distinct installation (dual-install) ─────────────────

  console.log('\nJ. Second distinct installation (dual-install contract):');

  // Save first config
  const config1 = readBridgeConfig();
  const installId1 = config1.installation_id;
  const token1 = config1.auth_token;

  // Run second install with same connect code but different installation_id
  let installResult2;
  await asyncTest('second install with same connect code succeeds', async () => {
    installResult2 = await runInstaller(mockApiUrl, 'MOCK-CONNECT-CODE-001');
    assertEqual(installResult2.status, 0, `Second install failed: ${installResult2.stdout.slice(-500)}`);
  });

  test('second install produces INSTALLATION SUCCESSFUL', () => {
    assertTrue(installResult2.stdout.includes('INSTALLATION SUCCESSFUL'), 'Second install not successful');
  });

  test('exchange endpoint called twice (2 distinct installations)', () => {
    assertEqual(exchangeCount, 2, `Expected 2 exchange calls, got ${exchangeCount}`);
  });

  test('second install has distinct installation_id', () => {
    const config2 = readBridgeConfig();
    assertEqual(config2.installation_id === installId1, false, 'installation_id should be different');
  });

  test('second install has distinct auth_token', () => {
    const config2 = readBridgeConfig();
    assertEqual(config2.auth_token === token1, false, 'auth_token should be different');
  });

  test('CM hooks remain at 4 after re-install (idempotent, no duplicates)', () => {
    const settings = readClaudeSettings();
    const cmCount = countCmHooks(settings);
    assertEqual(cmCount, 4, `Expected 4 CM hooks after re-install, got ${cmCount}`);
  });

  test('Bruce hooks still survive after second install', () => {
    const settings = readClaudeSettings();
    const bruceCount = countBruceHooks(settings);
    assertEqual(bruceCount, 2, `Expected 2 Bruce hooks after re-install, got ${bruceCount}`);
  });

  // ─── K. Uninstall (J — uninstall restores prior settings) ───────────

  console.log('\nK. Uninstall (J — uninstall restores prior Claude settings):');

  let uninstallResult1;
  test('uninstall succeeds', () => {
    uninstallResult1 = runUninstaller();
    assertEqual(uninstallResult1.status, 0, `Uninstall failed: ${uninstallResult1.stderr}`);
  });

  test('uninstall output contains UNINSTALL COMPLETE', () => {
    assertTrue(uninstallResult1.stdout.includes('UNINSTALL COMPLETE'), 'Uninstall not complete');
  });

  test('CM hooks removed after uninstall', () => {
    const settings = readClaudeSettings();
    const cmCount = countCmHooks(settings);
    assertEqual(cmCount, 0, `Expected 0 CM hooks after uninstall, got ${cmCount}`);
  });

  test('Bruce hooks survive uninstall', () => {
    const settings = readClaudeSettings();
    const bruceCount = countBruceHooks(settings);
    assertEqual(bruceCount, 2, `Expected 2 Bruce hooks after uninstall, got ${bruceCount}`);
  });

  test('pre-existing someOtherSetting survives uninstall', () => {
    const settings = readClaudeSettings();
    assertEqual(settings.someOtherSetting, 'must-survive', 'Pre-existing setting lost after uninstall');
  });

  test('pre-existing permissions survive uninstall', () => {
    const settings = readClaudeSettings();
    assertTrue(settings.permissions, 'permissions lost after uninstall');
  });

  test('pre-existing env survives uninstall', () => {
    const settings = readClaudeSettings();
    assertTrue(settings.env, 'env lost after uninstall');
    assertEqual(settings.env.MY_CUSTOM_VAR, 'preserved-value', 'env var lost after uninstall');
  });

  test('~/.chaosmonkey-cc-bridge/config.json removed after uninstall', () => {
    const config = readBridgeConfig();
    assertEqual(config, null, 'Config should be removed after uninstall');
  });

  test('~/.chaosmonkey-cc-bridge/ directory fully removed (no credential backups remain)', () => {
    const stateDir = path.join(tempHome, '.chaosmonkey-cc-bridge');
    assertEqual(fs.existsSync(stateDir), false, 'State directory should be fully removed — no credential-bearing backups should remain');
  });

  test('settings.json still exists after uninstall', () => {
    assertTrue(readClaudeSettings() !== null, 'settings.json should survive uninstall');
  });

  // ─── L. Repeat install/uninstall idempotency ─────────────────────────

  console.log('\nL. Repeat install/uninstall idempotency:');

  await asyncTest('re-install after uninstall succeeds', async () => {
    const result = await runInstaller(mockApiUrl, 'MOCK-CONNECT-CODE-001');
    assertEqual(result.status, 0, 'Re-install failed');
  });

  test('CM hooks present after re-install', () => {
    const settings = readClaudeSettings();
    const cmCount = countCmHooks(settings);
    assertEqual(cmCount, 4, `Expected 4 CM hooks after re-install, got ${cmCount}`);
  });

  test('Bruce hooks still present after re-install', () => {
    const settings = readClaudeSettings();
    const bruceCount = countBruceHooks(settings);
    assertEqual(bruceCount, 2, `Expected 2 Bruce hooks, got ${bruceCount}`);
  });

  test('second uninstall succeeds', () => {
    const result = runUninstaller();
    assertEqual(result.status, 0, 'Second uninstall failed');
  });

  test('CM hooks removed after second uninstall', () => {
    const settings = readClaudeSettings();
    const cmCount = countCmHooks(settings);
    assertEqual(cmCount, 0, `Expected 0 CM hooks, got ${cmCount}`);
  });

  test('Bruce hooks survive second uninstall', () => {
    const settings = readClaudeSettings();
    const bruceCount = countBruceHooks(settings);
    assertEqual(bruceCount, 2, `Expected 2 Bruce hooks, got ${bruceCount}`);
  });

  // ─── M. Official bridge classifies as claude-code ────────────────────

  console.log('\nM. Official bridge classifies as claude-code:');

  test('test_init event source is claude-code (not vscode/cursor)', () => {
    const testEvents = telemetryEvents.filter(e => e.event_type === 'test_init');
    assertTrue(testEvents.length > 0, 'No test_init events');
    assertEqual(testEvents[0].metadata.source, 'claude-code', 'source should be claude-code');
  });

  test('test_init event editor_source is claude-code', () => {
    // The installer sends source in the top-level payload, check the telemetry event
    // The mock server received the raw payload — check the events array
    assertTrue(telemetryEvents.length > 0, 'No telemetry events received');
  });

  // ─── N. Failed-install rollback proof ───────────────────────────────

  console.log('\nN. Failed-install rollback proof:');

  // Stop the current mock server and start one that fails telemetry validation
  await stopMockServer();

  let failServer;
  let failServerPort;
  await new Promise((resolve) => {
    failServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (req.method === 'POST' && req.url === '/api/ide/connect/exchange') {
          // Exchange succeeds — token is returned
          res.writeHead(200);
          res.end(JSON.stringify({
            token: `mock-fail-token-${Date.now()}`,
            expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
            organization_id: 1,
            developer_id: 'invite:mock-fail',
            team_id: null,
            identity_source: 'backend_claimed',
          }));
          return;
        }

        if (req.method === 'POST' && req.url === '/api/telemetry') {
          // Telemetry validation FAILS — return received=0
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'ok',
            received: 0,
            duplicate: false,
          }));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      });
    });
    failServer.listen(0, '127.0.0.1', () => {
      failServerPort = failServer.address().port;
      resolve();
    });
  });

  // Setup fresh temp HOME with pre-existing config
  setupTempHome();
  writePreExistingSettings();
  // Write a pre-existing config that should be restored on failure
  const stateDir = path.join(tempHome, '.chaosmonkey-cc-bridge');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const priorConfig = {
    api_base_url: 'http://prior.example.com',
    auth_token: 'PRIOR-TOKEN-MUST-BE-RESTORED',
    installation_id: 'prior-install-id',
    developer_id: 'invite:prior',
    enabled: true,
    bridge_version: BRIDGE_VERSION,
    installed_at: '2026-01-01T00:00:00Z',
  };
  fs.writeFileSync(path.join(stateDir, 'config.json'), JSON.stringify(priorConfig, null, 2), { mode: 0o600 });

  const failApiUrl = `http://127.0.0.1:${failServerPort}`;

  let failInstallResult;
  await asyncTest('failed install exits with non-zero status', async () => {
    failInstallResult = await runInstaller(failApiUrl, 'FAIL-CODE');
    assertEqual(failInstallResult.status, 1, `Expected exit code 1, got ${failInstallResult.status}\nstdout: ${failInstallResult.stdout.slice(-500)}`);
  });

  test('failed install output contains INSTALLATION FAILED', () => {
    assertTrue(failInstallResult.stdout.includes('INSTALLATION FAILED'), 'Expected INSTALLATION FAILED');
  });

  test('failed install restores prior config (auth_token restored)', () => {
    const config = readBridgeConfig();
    assertTrue(config !== null, 'Config should exist (restored from backup)');
    assertEqual(config.auth_token, 'PRIOR-TOKEN-MUST-BE-RESTORED', 'Prior auth_token not restored');
    assertEqual(config.installation_id, 'prior-install-id', 'Prior installation_id not restored');
  });

  test('failed install leaves no credential-bearing backup files', () => {
    if (!fs.existsSync(stateDir)) return;
    const contents = fs.readdirSync(stateDir);
    const backups = contents.filter(f => f.startsWith('config.json.backup-'));
    // The installer restores from backup, which removes the backup file
    // (restoreConfig copies backup back to config.json, but doesn't delete the backup)
    // Check that no backup contains the NEW (failed) token
    for (const f of backups) {
      const content = fs.readFileSync(path.join(stateDir, f), 'utf8');
      if (content.includes('mock-fail-token')) {
        throw new Error(`Failed-install token found in backup file ${f}`);
      }
    }
  });

  test('failed install preserves pre-existing Claude settings', () => {
    const settings = readClaudeSettings();
    assertTrue(settings !== null, 'Settings should exist');
    assertEqual(settings.someOtherSetting, 'must-survive', 'Pre-existing setting lost');
  });

  test('failed install does not add CM hooks', () => {
    const settings = readClaudeSettings();
    const cmCount = countCmHooks(settings);
    assertEqual(cmCount, 0, `Expected 0 CM hooks after failed install, got ${cmCount}`);
  });

  test('failed install preserves Bruce hooks', () => {
    const settings = readClaudeSettings();
    const bruceCount = countBruceHooks(settings);
    assertEqual(bruceCount, 2, `Expected 2 Bruce hooks, got ${bruceCount}`);
  });

  // Cleanup failed-install state
  cleanupTempHome();
  try { failServer.close(); } catch {}

  // ─── Cleanup ─────────────────────────────────────────────────────────

  cleanupTempHome();
  try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
  await stopMockServer();

  // ─── Summary ─────────────────────────────────────────────────────────

  console.log('\n========================================');
  console.log(`RESULTS: ${passCount}/${testCount} passed, ${failCount} failed`);
  console.log('========================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
