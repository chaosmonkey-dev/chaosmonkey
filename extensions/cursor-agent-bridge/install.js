#!/usr/bin/env node
'use strict';

/**
 * ChaosMonkey Cursor Agent Bridge — Installer
 * Version: 0.4.2-cursor-bridge
 *
 * Adapted from the Claude Code bridge installer. Registers native Cursor
 * agent hooks in ~/.cursor/hooks.json.
 *
 * SAFETY CONTRACT (same as Claude Code bridge):
 *   1. Collects ChaosMonkey API base URL + connect code
 *   2. Generates a fresh installation_id and exchanges the connect code
 *      for a bearer token via POST /api/ide/connect/exchange
 *   3. Writes bridge config to ~/.chaosmonkey-cursor-bridge/config.json (mode 0600)
 *   4. Merges ChaosMonkey hooks into ~/.cursor/hooks.json
 *      (preserving ALL existing hooks and settings)
 *   5. Sends a REAL test event and validates the API response
 *   6. On ANY failure: rolls back settings and config to pre-install state
 *
 *   - Existing ~/.cursor/hooks.json hooks and settings are ALWAYS preserved
 *   - Malformed hooks.json STOPS installation (never overwrites with fresh {})
 *   - Does NOT modify project-level .cursor/hooks.json in any repository
 *   - Does NOT modify ~/.claude/settings.json
 *   - Removes only ChaosMonkey-owned commands on reinstall
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const readline = require('readline');

const BRIDGE_VERSION = '0.4.2-cursor-bridge';
const STATE_DIR = path.join(os.homedir(), '.chaosmonkey-cursor-bridge');
const CONFIG_PATH = path.join(STATE_DIR, 'config.json');
const RUNTIME_DIR = path.join(STATE_DIR, 'runtime');
const RUNTIME_BRIDGE = path.join(RUNTIME_DIR, 'bridge.js');
const CURSOR_HOOKS_PATH = path.join(os.homedir(), '.cursor', 'hooks.json');
const BRIDGE_SCRIPT = path.resolve(__dirname, 'bridge.js');

// Marker used to identify ChaosMonkey Cursor bridge hook commands
const HOOK_MARKER = 'chaosmonkey-cursor-bridge';

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------
function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function log(msg) {
  process.stdout.write(msg + '\n');
}

// ---------------------------------------------------------------------------
// HTTPS enforcement — HTTP only for exact localhost/127.0.0.1/::1 (parsed)
// ---------------------------------------------------------------------------
function isAllowedLocalDevHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function validateEndpointHttps(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol === 'http:' && isAllowedLocalDevHost(parsed.hostname)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// HTTPS request helper
// ---------------------------------------------------------------------------
function httpRequest(url, opts, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      method: opts.method || 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: opts.headers || {},
      timeout: 10000,
    };
    if (body) {
      reqOpts.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = mod.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Exchange connect code for bearer token (identical protocol to other bridges)
// ---------------------------------------------------------------------------
async function exchangeConnectCode(apiBaseUrl, connectCode, installationId) {
  const url = apiBaseUrl.replace(/\/+$/, '') + '/api/ide/connect/exchange';
  const body = JSON.stringify({
    code: connectCode,
    installation_id: installationId,
    extension_version: BRIDGE_VERSION,
  });

  log(`\nExchanging connect code at ${url} ...`);
  try {
    const res = await httpRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, body);

    if (res.status === 200 || res.status === 201) {
      return res.body;
    }
    log(`ERROR: connect code exchange failed (HTTP ${res.status})`);
    log(`  Response: ${JSON.stringify(res.body).slice(0, 300)}`);
    return null;
  } catch (e) {
    log(`ERROR: network error during connect code exchange: ${e.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// hooks.json merge — preserves all non-CM entries, idempotent reinstall
// ---------------------------------------------------------------------------
function isCmHookCommand(command) {
  if (!command || typeof command !== 'string') return false;
  return command.includes(RUNTIME_BRIDGE) || command.includes(BRIDGE_SCRIPT) || command.includes(HOOK_MARKER);
}

// ---------------------------------------------------------------------------
// Durable runtime — hooks must never point into the download/extraction
// directory. Runtime files are staged then atomically swapped into
// ~/.chaosmonkey-cursor-bridge/runtime/; a prior working runtime is retained
// until the new installation is fully verified.
// ---------------------------------------------------------------------------
function stageRuntime() {
  const staging = `${RUNTIME_DIR}.staging-${process.pid}`;
  fs.mkdirSync(staging, { recursive: true });
  for (const f of ['bridge.js', 'install.js', 'uninstall.js', 'package.json']) {
    fs.copyFileSync(path.resolve(__dirname, f), path.join(staging, f));
  }
  // Prove the staged runtime is executable before swapping it in.
  const probe = require('child_process').spawnSync('node', ['--check', path.join(staging, 'bridge.js')]);
  if (probe.status !== 0) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error('staged runtime failed node --check');
  }
  return staging;
}

function activateRuntime(staging) {
  const prev = `${RUNTIME_DIR}.prev-${process.pid}`;
  const hadPrev = fs.existsSync(RUNTIME_DIR);
  if (hadPrev) fs.renameSync(RUNTIME_DIR, prev);
  try {
    fs.renameSync(staging, RUNTIME_DIR);
  } catch (e) {
    if (hadPrev) fs.renameSync(prev, RUNTIME_DIR);
    throw e;
  }
  return hadPrev ? prev : null;
}

function rollbackRuntime(prevPath) {
  try { fs.rmSync(RUNTIME_DIR, { recursive: true, force: true }); } catch {}
  if (prevPath && fs.existsSync(prevPath)) fs.renameSync(prevPath, RUNTIME_DIR);
}

function retirePrevRuntime(prevPath) {
  if (prevPath && fs.existsSync(prevPath)) {
    fs.rmSync(prevPath, { recursive: true, force: true });
  }
}

function verifyNodeVersion() {
  const probe = require('child_process').spawnSync('node', ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0 || !probe.stdout) return { ok: false, version: null };
  const major = parseInt((probe.stdout.trim().match(/^v(\d+)/) || [])[1] || '0', 10);
  return { ok: major >= 18, version: probe.stdout.trim() };
}

function mergeCursorHooks() {
  const hadExisting = fs.existsSync(CURSOR_HOOKS_PATH);

  let hooksConfig = { version: 1, hooks: {} };
  if (hadExisting) {
    const raw = fs.readFileSync(CURSOR_HOOKS_PATH, 'utf8');
    try {
      hooksConfig = JSON.parse(raw);
    } catch (e) {
      // P0: Malformed hooks.json — STOP, do NOT overwrite
      log(`\nERROR: Existing ${CURSOR_HOOKS_PATH} could not be parsed:`);
      log(`  ${e.message}`);
      log(`\nInstallation STOPPED. The existing file has been left unchanged.`);
      log(`Please fix or remove the file manually, then re-run the installer.`);
      return { success: false, reason: 'malformed_hooks' };
    }
    if (typeof hooksConfig !== 'object' || hooksConfig === null || Array.isArray(hooksConfig)) {
      log(`\nERROR: Existing ${CURSOR_HOOKS_PATH} is not a JSON object. Installation STOPPED.`);
      return { success: false, reason: 'malformed_hooks' };
    }
  }

  // Backup existing config before any modification
  let backupPath = null;
  if (hadExisting) {
    backupPath = CURSOR_HOOKS_PATH + '.backup-' + Date.now();
    fs.copyFileSync(CURSOR_HOOKS_PATH, backupPath);
    fs.chmodSync(backupPath, 0o600);
    log(`  Backed up existing hooks.json`);
  }

  if (!hooksConfig.version) hooksConfig.version = 1;
  if (!hooksConfig.hooks || typeof hooksConfig.hooks !== 'object' || Array.isArray(hooksConfig.hooks)) {
    hooksConfig.hooks = {};
  }

  // ChaosMonkey hook commands — native Cursor event names.
  // Entries use the flat {"command": ...} shape per cursor.com/docs/hooks.
  // Hook commands ALWAYS point at the durable runtime — never the
  // extraction/download directory, which may be cleaned up at any time.
  const cmHooks = {
    sessionStart: [
      { command: `node "${RUNTIME_BRIDGE}" session-start` },
    ],
    sessionEnd: [
      { command: `node "${RUNTIME_BRIDGE}" session-end`, timeout: 15 },
    ],
    afterFileEdit: [
      { command: `node "${RUNTIME_BRIDGE}" post-edit` },
    ],
    afterShellExecution: [
      { command: `node "${RUNTIME_BRIDGE}" post-shell` },
    ],
    stop: [
      { command: `node "${RUNTIME_BRIDGE}" stop` },
    ],
  };

  // Merge: for each CM hook event, remove old CM entries, preserve all others,
  // then append fresh CM entries.
  for (const [hookName, hookEntries] of Object.entries(cmHooks)) {
    if (!Array.isArray(hooksConfig.hooks[hookName])) {
      // Preserve a non-array value by replacing only if it was ours;
      // a foreign non-array value is left alone and CM entries appended
      // cannot merge — treat as malformed for that event and skip.
      if (hooksConfig.hooks[hookName] === undefined) {
        hooksConfig.hooks[hookName] = [];
      } else {
        log(`  WARNING: hooks.${hookName} is not an array — leaving unchanged, CM hooks not added`);
        continue;
      }
    }

    // Drop entries whose command is ChaosMonkey-owned; keep everything else
    // (including unknown-format entries — preserved exactly).
    hooksConfig.hooks[hookName] = hooksConfig.hooks[hookName].filter((entry) => {
      if (!entry) return false;
      if (typeof entry === 'object' && typeof entry.command === 'string') {
        return !isCmHookCommand(entry.command);
      }
      // Unknown-format entry (nested hooks array, prompt type, etc.): preserve
      return true;
    });

    hooksConfig.hooks[hookName].push(...hookEntries);
  }

  // Write merged config using temp-file + atomic rename
  const tmpPath = CURSOR_HOOKS_PATH + '.tmp-' + process.pid;
  fs.mkdirSync(path.dirname(CURSOR_HOOKS_PATH), { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(hooksConfig, null, 2));
  fs.renameSync(tmpPath, CURSOR_HOOKS_PATH);
  log(`  Merged ChaosMonkey hooks into ${CURSOR_HOOKS_PATH}`);
  return { success: true, backupPath, hadExisting };
}

// ---------------------------------------------------------------------------
// Restore hooks.json to pre-install state (on validation failure)
// ---------------------------------------------------------------------------
function restoreHooks(backupPath, hadExisting) {
  if (backupPath && fs.existsSync(backupPath)) {
    try {
      fs.copyFileSync(backupPath, CURSOR_HOOKS_PATH);
      log(`  Restored hooks.json from backup`);
    } catch (e) {
      log(`  WARNING: could not restore hooks.json from backup: ${e.message}`);
    }
  } else if (hadExisting === false) {
    try {
      if (fs.existsSync(CURSOR_HOOKS_PATH)) {
        fs.unlinkSync(CURSOR_HOOKS_PATH);
        log(`  Removed newly created hooks.json (validation failed)`);
      }
    } catch (e) {
      log(`  WARNING: could not remove newly created hooks.json: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Write config — backup existing, mode 0600
// ---------------------------------------------------------------------------
function loadExistingConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch {
    return null;
  }
}

function writeConfig(config) {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  }

  let configBackupPath = null;
  if (fs.existsSync(CONFIG_PATH)) {
    configBackupPath = CONFIG_PATH + '.backup-' + Date.now();
    fs.copyFileSync(CONFIG_PATH, configBackupPath);
    fs.chmodSync(configBackupPath, 0o600);
    log(`  Backed up existing config`);
  }

  const tmpPath = CONFIG_PATH + '.tmp-' + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, CONFIG_PATH);
  log(`  Config written`);
  return configBackupPath;
}

function restoreConfig(configBackupPath) {
  if (configBackupPath && fs.existsSync(configBackupPath)) {
    try {
      fs.copyFileSync(configBackupPath, CONFIG_PATH);
      log(`  Restored config from backup`);
    } catch (e) {
      log(`  WARNING: could not restore config from backup: ${e.message}`);
    }
  } else {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        fs.unlinkSync(CONFIG_PATH);
        log(`  Removed newly created config (validation failed)`);
      }
    } catch (e) {
      log(`  WARNING: could not remove config: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Real connectivity test — sends a test event and validates the response
// ---------------------------------------------------------------------------
async function validateConnectivity(config) {
  const baseUrl = config.api_base_url;
  const url = baseUrl.replace(/\/+$/, '') + '/api/telemetry';

  const sessionId = `install_test_${Date.now()}`;
  const payload = {
    source: 'cursor-agent',
    editor_source: 'cursor',
    extension_version: BRIDGE_VERSION,
    installation_id: config.installation_id,
    developer_id: config.developer_id || null,
    team_id: config.team_id || null,
    identity_schema_version: 1,
    identity_source: config.identity_source || 'backend_claimed',
    events: [{
      event_type: 'test_init',
      timestamp: new Date().toISOString(),
      metadata: {
        source: 'cursor-agent',
        appName: 'Cursor',
        extension_version: BRIDGE_VERSION,
        vscode_version: 'cursor',
        session_id: sessionId,
        installation_id: config.installation_id,
        developer_id: config.developer_id || null,
        team_id: config.team_id || null,
        identity_schema_version: 1,
        identity_source: config.identity_source || 'backend_claimed',
        segment_type: 'event',
        trigger: 'installer_validation',
        test_mode: true,
        bridge_version: BRIDGE_VERSION,
      },
    }],
  };

  const body = JSON.stringify(payload);

  try {
    const res = await httpRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.auth_token}`,
      },
    }, body);

    if (res.status >= 200 && res.status < 300) {
      const respBody = res.body;
      if (!respBody || typeof respBody !== 'object' || Array.isArray(respBody)) {
        log(`  Connectivity test FAILED: HTTP ${res.status} but response is not a JSON object`);
        return { ok: false, status: res.status, body: respBody, reason: 'non_json_object' };
      }
      if (respBody.error || respBody.errors) {
        log(`  Connectivity test FAILED: HTTP ${res.status} but response contains error state`);
        return { ok: false, status: res.status, body: respBody, reason: 'error_in_body' };
      }
      if (typeof respBody.received !== 'number' || respBody.received <= 0) {
        log(`  Connectivity test FAILED: HTTP ${res.status} but received=${respBody.received}`);
        return { ok: false, status: res.status, body: respBody, reason: 'no_receipt' };
      }
      if (respBody.duplicate === true) {
        log(`  Connectivity test FAILED: HTTP ${res.status} but response marked as duplicate`);
        return { ok: false, status: res.status, body: respBody, reason: 'duplicate' };
      }
      log(`  Connectivity test PASSED: HTTP ${res.status}, received=${respBody.received}`);
      return { ok: true, status: res.status, body: respBody };
    } else if (res.status === 401 || res.status === 403) {
      log(`  Connectivity test FAILED: HTTP ${res.status} — authentication error`);
      return { ok: false, status: res.status, body: res.body, reason: 'auth_error' };
    } else if (res.status === 422) {
      log(`  Connectivity test FAILED: HTTP 422 — validation error`);
      return { ok: false, status: res.status, body: res.body, reason: 'validation_error' };
    } else {
      log(`  Connectivity test FAILED: HTTP ${res.status}`);
      return { ok: false, status: res.status, body: res.body, reason: 'http_error' };
    }
  } catch (e) {
    log(`  Connectivity test FAILED: network error — ${e.message}`);
    return { ok: false, status: 0, reason: 'network_error' };
  }
}

// ---------------------------------------------------------------------------
// Main install flow
// ---------------------------------------------------------------------------
async function install() {
  log('========================================');
  log('ChaosMonkey Cursor Agent Bridge');
  log(`Version: ${BRIDGE_VERSION}`);
  log('========================================\n');

  log('This installer will:');
  log('  1. Configure the ChaosMonkey telemetry endpoint');
  log('  2. Authenticate using your connect code');
  log('  3. Merge telemetry hooks into ~/.cursor/hooks.json');
  log('  4. Validate connectivity with a real test event\n');

  log('PRIVACY NOTICE:');
  log('  This bridge collects AGGREGATE telemetry only:');
  log('  - Agent session duration, edit counts, change magnitude, language mix');
  log('  - Agent mode (composer_mode, background-agent flag), model id when provided');
  log('  - Commit counts, time-to-first-commit, git branch/repo URL (sanitized)');
  log('  - Shell invocation COUNTS (command text is NEVER transmitted)');
  log('');
  log('  Raw file paths and edit text are transiently processed locally to');
  log('  derive language and change-magnitude counts. They are not transmitted');
  log('  or persisted. workspace_roots is used transiently to run local Git');
  log('  commands and is not transmitted or persisted.');
  log('');
  log('  The bridge does NOT transmit: file contents, diffs, prompts, agent');
  log('  messages, shell commands, shell output, transcripts, user email,');
  log('  or personal identity.\n');

  // Preflight: hooks invoke bare `node` — the PATH node must be >= 18.
  const nodeCheck = verifyNodeVersion();
  if (!nodeCheck.ok) {
    log(`ERROR: Node.js >= 18 is required ${nodeCheck.version ? `(found ${nodeCheck.version})` : '(node not found on PATH)'}.`);
    log('Install Node.js 18 or newer, then re-run this installer.');
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let configBackupPath = null;
  let prevRuntimePath = null;

  try {
    // Enrollment: reuse an existing valid enrollment on reinstall, or take
    // non-interactive values from CM_API_BASE_URL / CM_CONNECT_CODE env vars
    // (keeps the connect code out of shell history). Prompts are the fallback.
    const existing = loadExistingConfig();
    const canReuse = existing && existing.api_base_url && existing.auth_token;
    let reuseEnrollment = false;
    if (canReuse) {
      if (process.env.CM_CONNECT_CODE) {
        reuseEnrollment = false;
      } else {
        const answer = (await prompt(
          rl,
          `Existing enrollment found (${existing.api_base_url}, developer ${existing.developer_id || 'unknown'}). Reuse it? [Y/n] `
        )).trim().toLowerCase();
        reuseEnrollment = answer !== 'n' && answer !== 'no';
      }
    }

    let config;
    if (reuseEnrollment) {
      config = { ...existing, enabled: existing.enabled !== false, bridge_version: BRIDGE_VERSION };
      configBackupPath = writeConfig(config);
      log('  Reusing existing enrollment — no new token issued.');
    } else {
      let apiBaseUrl = process.env.CM_API_BASE_URL
        ? process.env.CM_API_BASE_URL.trim()
        : await prompt(rl, 'Enter your ChaosMonkey API base URL (e.g. https://gloo.chaosmonkey.dev): ');
      apiBaseUrl = (apiBaseUrl || '').trim().replace(/\/+$/, '');
      if (!apiBaseUrl) {
        log('ERROR: API base URL is required.');
        process.exit(1);
      }
      if (!validateEndpointHttps(apiBaseUrl)) {
        log('ERROR: HTTPS is required. HTTP is only permitted for localhost/127.0.0.1/::1.');
        process.exit(1);
      }

      const connectCode = process.env.CM_CONNECT_CODE
        ? process.env.CM_CONNECT_CODE.trim()
        : (await prompt(rl, 'Enter your connect code: ')).trim();
      if (!connectCode) {
        log('ERROR: connect code is required.');
        process.exit(1);
      }

      const installationId = (existing && existing.installation_id) || crypto.randomUUID();
      log(`\n${existing && existing.installation_id ? 'Reusing' : 'Generated'} installation_id: ${installationId}`);

      const tokenResponse = await exchangeConnectCode(apiBaseUrl, connectCode, installationId);
      if (!tokenResponse || !tokenResponse.token) {
        log('\nERROR: Could not obtain auth token. Please verify your connect code and API URL.');
        process.exit(1);
      }

      log(`\n  Auth token received (expires: ${tokenResponse.expires_at || 'unknown'})`);
      log(`  Organization ID: ${tokenResponse.organization_id}`);
      log(`  Developer ID: ${tokenResponse.developer_id || 'n/a'}`);

      log('\nWriting configuration...');
      config = {
        api_base_url: apiBaseUrl,
        auth_token: tokenResponse.token,
        installation_id: installationId,
        developer_id: tokenResponse.developer_id || null,
        organization_id: tokenResponse.organization_id || null,
        team_id: tokenResponse.team_id || null,
        identity_source: tokenResponse.identity_source || 'backend_claimed',
        identity_schema_version: 1,
        enabled: true,
        bridge_version: BRIDGE_VERSION,
        installed_at: new Date().toISOString(),
      };
      configBackupPath = writeConfig(config);
    }

    log('\nInstalling durable runtime to ~/.chaosmonkey-cursor-bridge/runtime/ ...');
    const staging = stageRuntime();
    prevRuntimePath = activateRuntime(staging);
    log(`  Runtime active at ${RUNTIME_BRIDGE}`);

    log('\nMerging hooks into ~/.cursor/hooks.json...');
    const mergeResult = mergeCursorHooks();
    if (!mergeResult.success) {
      rollbackRuntime(prevRuntimePath);
      if (configBackupPath) restoreConfig(configBackupPath);
      process.exit(1);
    }
    const hooksBackupPath = mergeResult.backupPath;
    const hooksHadExisting = mergeResult.hadExisting;

    log('\nValidating connectivity with a test event...');
    const validationResult = await validateConnectivity(config);

    if (validationResult.ok) {
      retirePrevRuntime(prevRuntimePath);
      if (configBackupPath && fs.existsSync(configBackupPath)) {
        try {
          fs.unlinkSync(configBackupPath);
          log(`  Removed credential backup (install succeeded)`);
        } catch (e) {
          log(`  WARNING: could not remove credential backup: ${e.message}`);
        }
      }
      log('\n========================================');
      log('INSTALLATION SUCCESSFUL');
      log('========================================');
      log('\nTelemetry is now ACTIVE for Cursor agent sessions.');
      log(`Endpoint: ${config.api_base_url}`);
      if (config.organization_id) log(`Organization: ${config.organization_id}`);
      log('\nTo DISABLE telemetry:');
      log(`  Edit ${CONFIG_PATH} and set "enabled": false`);
      log('\nTo UNINSTALL:');
      log(`  node "${path.join(RUNTIME_DIR, 'uninstall.js')}"`);
      log('');
    } else {
      log('\n========================================');
      log('INSTALLATION FAILED');
      log('========================================');
      log(`\nConnectivity validation failed: ${validationResult.reason || 'unknown'}`);
      log('\nRestoring pre-install state...');
      restoreHooks(hooksBackupPath, hooksHadExisting);
      rollbackRuntime(prevRuntimePath);
      if (configBackupPath) restoreConfig(configBackupPath);
      log('\nYour Cursor hooks configuration and bridge config have been restored.');
      log('No telemetry is active. Please check:');
      log('  - Your API base URL is correct');
      log('  - Your connect code is valid and not expired');
      log('  - Network connectivity to the endpoint');
      log('  - The endpoint accepts telemetry events');
      log('');
      process.exit(1);
    }
  } finally {
    rl.close();
  }
}

module.exports = {
  validateEndpointHttps,
  isAllowedLocalDevHost,
  isCmHookCommand,
  mergeCursorHooks,
  validateConnectivity,
  httpRequest,
  loadExistingConfig,
  stageRuntime,
  activateRuntime,
  rollbackRuntime,
  retirePrevRuntime,
  verifyNodeVersion,
  RUNTIME_DIR,
  RUNTIME_BRIDGE,
  CURSOR_HOOKS_PATH,
  BRIDGE_VERSION,
};

if (require.main === module) {
  install().catch((e) => {
    log(`\nFATAL ERROR: ${e.message}`);
    process.exit(1);
  });
}
