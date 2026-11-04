#!/usr/bin/env node
'use strict';

/**
 * ChaosMonkey Claude Code Terminal Bridge — Installer
 * Version: 0.4.2-cc-bridge
 *
 * Performs:
 *   1. Collects API base URL + connect code from the developer
 *   2. Exchanges connect code for a Bearer token (POST /api/ide/connect/exchange)
 *   3. Generates a pseudonymous installation_id (UUID v4)
 *   4. Writes config to ~/.chaosmonkey-cc-bridge/config.json (mode 0600, backup existing)
 *   5. Merges ChaosMonkey hooks into ~/.claude/settings.json (preserving ALL existing hooks/settings)
 *   6. Validates connectivity by sending a real test event and checking the HTTP response
 *   7. On validation failure: restores pre-install state and reports INSTALLATION FAILED
 *   8. Reports status + disable/uninstall instructions
 *
 * Security:
 *   - Never hardcodes credentials or endpoint in distributable source
 *   - Connect code is exchanged once; only the resulting token is stored locally
 *   - Existing ~/.claude/settings.json hooks and settings are ALWAYS preserved
 *   - Malformed settings.json STOPS installation (never overwrites with fresh {})
 *   - Config file is mode 0600 (owner read/write only)
 *   - All file writes are backed up before modification
 *   - Settings writes use temp-file + atomic rename
 *   - On validation failure, pre-install state is restored
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const readline = require('readline');

const BRIDGE_VERSION = '0.4.2-cc-bridge';
const STATE_DIR = path.join(os.homedir(), '.chaosmonkey-cc-bridge');
const CONFIG_PATH = path.join(STATE_DIR, 'config.json');
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const BRIDGE_SCRIPT = path.resolve(__dirname, 'bridge.js');

// Marker used to identify ChaosMonkey bridge hook commands
const HOOK_MARKER = 'chaosmonkey-cc-bridge';

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
// HTTPS enforcement — shared validator (same logic as bridge.js)
// HTTP is permitted ONLY when parsed hostname is exactly localhost/127.0.0.1/::1.
// Substring spoofing (localhost.evil.example, 127.0.0.1.evil.example, ?host=localhost)
// is rejected because we compare the parsed hostname, not the raw string.
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
// Exchange connect code for bearer token
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
    } else {
      log(`ERROR: connect code exchange failed (HTTP ${res.status})`);
      log(`  Response: ${JSON.stringify(res.body).slice(0, 300)}`);
      return null;
    }
  } catch (e) {
    log(`ERROR: network error during connect code exchange: ${e.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Check if a hook command belongs to ChaosMonkey bridge
// ---------------------------------------------------------------------------
function isCmHookCommand(command) {
  if (!command || typeof command !== 'string') return false;
  return command.includes(BRIDGE_SCRIPT) || command.includes(HOOK_MARKER);
}

// ---------------------------------------------------------------------------
// Remove ChaosMonkey commands from a single hook entry's hooks array.
// Preserves all non-ChaosMonkey commands in the same entry.
// Returns the number of CM commands removed.
// ---------------------------------------------------------------------------
function removeCmCommandsFromHooks(hooksArray) {
  if (!Array.isArray(hooksArray)) return 0;
  let removed = 0;
  const filtered = hooksArray.filter((h) => {
    if (isCmHookCommand(h.command)) {
      removed++;
      return false; // remove CM command
    }
    return true; // keep everything else
  });
  // Mutate in place
  hooksArray.length = 0;
  hooksArray.push(...filtered);
  return removed;
}

// ---------------------------------------------------------------------------
// Merge hooks into ~/.claude/settings.json — preserving ALL existing settings
//
// Rules:
//   - Preserve every unrelated Claude Code hook exactly
//   - Remove only previously installed ChaosMonkey bridge hook commands
//   - If an entry contains multiple commands, remove only CM commands, keep others
//   - Unknown hook formats are untouched
//   - Re-install is idempotent (no duplicate CM entries)
//   - If settings.json exists but cannot be parsed: STOP, do NOT overwrite
// ---------------------------------------------------------------------------
function mergeClaudeSettings() {
  // Ensure ~/.claude directory exists
  const claudeDir = path.dirname(CLAUDE_SETTINGS_PATH);
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  // Load existing settings
  let settings = {};
  let hadExisting = false;

  if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
    hadExisting = true;
    const raw = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8');
    try {
      settings = JSON.parse(raw);
    } catch (e) {
      // P0: Malformed settings.json — STOP, do NOT overwrite
      log(`\nERROR: Existing ${CLAUDE_SETTINGS_PATH} could not be parsed:`);
      log(`  ${e.message}`);
      log(`\nInstallation STOPPED. The existing file has been left unchanged.`);
      log(`Please fix or remove the file manually, then re-run the installer.`);
      return { success: false, reason: 'malformed_settings' };
    }
  }

  // Backup existing settings before any modification (mode 0600 for safety)
  let backupPath = null;
  if (hadExisting) {
    backupPath = CLAUDE_SETTINGS_PATH + '.backup-' + Date.now();
    fs.copyFileSync(CLAUDE_SETTINGS_PATH, backupPath);
    fs.chmodSync(backupPath, 0o600);
    log(`  Backed up existing settings`);
  }

  // Ensure hooks object exists
  if (!settings.hooks) settings.hooks = {};

  // Define ChaosMonkey bridge hooks
  // SessionEnd needs timeout: 10 because the default is 1.5s (per Claude Code docs)
  const cmHooks = {
    SessionStart: [
      { hooks: [{ type: 'command', command: `node "${BRIDGE_SCRIPT}" session-start` }] },
    ],
    SessionEnd: [
      { hooks: [{ type: 'command', command: `node "${BRIDGE_SCRIPT}" session-end`, timeout: 10 }] },
    ],
    PostToolUse: [
      {
        matcher: 'Edit|Write|MultiEdit|NotebookEdit',
        hooks: [{ type: 'command', command: `node "${BRIDGE_SCRIPT}" post-edit` }],
      },
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: `node "${BRIDGE_SCRIPT}" post-bash` }],
      },
    ],
  };

  // Merge: for each CM hook event, remove old CM entries/commands, then add fresh ones
  for (const [hookName, hookEntries] of Object.entries(cmHooks)) {
    if (!settings.hooks[hookName]) {
      settings.hooks[hookName] = [];
    }

    // Remove previous ChaosMonkey bridge commands from each entry
    // This preserves non-CM commands in mixed entries
    for (const entry of settings.hooks[hookName]) {
      if (entry && Array.isArray(entry.hooks)) {
        removeCmCommandsFromHooks(entry.hooks);
      }
      // Unknown-format entries (no hooks array) are untouched
    }

    // Remove entries that are now empty (had only CM commands removed)
    // BUT preserve entries that do not have an array `hooks` property (unknown formats)
    settings.hooks[hookName] = settings.hooks[hookName].filter((entry) => {
      if (!entry) return false; // drop null/undefined entries
      if (Array.isArray(entry.hooks)) {
        // Standard entry: keep only if it still has commands after CM removal
        return entry.hooks.length > 0;
      }
      // Unknown-format entry (no hooks array): preserve EXACTLY
      return true;
    });

    // Add fresh ChaosMonkey bridge entries
    settings.hooks[hookName].push(...hookEntries);
  }

  // Write merged settings using temp-file + atomic rename
  const tmpPath = CLAUDE_SETTINGS_PATH + '.tmp-' + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2));
  fs.renameSync(tmpPath, CLAUDE_SETTINGS_PATH);
  log(`  Merged ChaosMonkey hooks into ${CLAUDE_SETTINGS_PATH}`);
  return { success: true, backupPath, hadExisting };
}

// ---------------------------------------------------------------------------
// Restore settings to pre-install state (on validation failure)
// If backupPath exists: restore from backup
// If hadExisting is false: remove the newly created settings.json
// ---------------------------------------------------------------------------
function restoreSettings(backupPath, hadExisting) {
  if (backupPath && fs.existsSync(backupPath)) {
    // Settings existed before — restore exact backup
    try {
      fs.copyFileSync(backupPath, CLAUDE_SETTINGS_PATH);
      log(`  Restored settings from backup`);
    } catch (e) {
      log(`  WARNING: could not restore settings from backup: ${e.message}`);
    }
  } else if (hadExisting === false) {
    // Settings did NOT exist before install — remove the newly created file
    try {
      if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
        fs.unlinkSync(CLAUDE_SETTINGS_PATH);
        log(`  Removed newly created settings.json (validation failed)`);
      }
    } catch (e) {
      log(`  WARNING: could not remove newly created settings.json: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Write config — backup existing, mode 0600
// ---------------------------------------------------------------------------
function writeConfig(config) {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  }

  // Backup existing config if present (mode 0600 — contains bearer token)
  let configBackupPath = null;
  if (fs.existsSync(CONFIG_PATH)) {
    configBackupPath = CONFIG_PATH + '.backup-' + Date.now();
    fs.copyFileSync(CONFIG_PATH, configBackupPath);
    fs.chmodSync(configBackupPath, 0o600);
    log(`  Backed up existing config`);
  }

  // Write new config with temp-file + atomic rename
  const tmpPath = CONFIG_PATH + '.tmp-' + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, CONFIG_PATH);
  log(`  Config written to ${CONFIG_PATH}`);
  return configBackupPath;
}

// ---------------------------------------------------------------------------
// Restore config from backup (on validation failure)
// ---------------------------------------------------------------------------
function restoreConfig(configBackupPath) {
  if (configBackupPath && fs.existsSync(configBackupPath)) {
    try {
      fs.copyFileSync(configBackupPath, CONFIG_PATH);
      log(`  Restored config from ${configBackupPath}`);
    } catch (e) {
      log(`  WARNING: could not restore config from backup: ${e.message}`);
    }
  } else {
    // No prior config — remove the newly created one
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
// Real connectivity test — sends a test event via direct HTTP and validates response
// Does NOT rely on bridge.js exit code (which is always 0 for hooks)
// ---------------------------------------------------------------------------
async function validateConnectivity(config) {
  const baseUrl = config.api_base_url;
  const url = baseUrl.replace(/\/+$/, '') + '/api/telemetry';

  const sessionId = `install_test_${Date.now()}`;
  const payload = {
    source: 'claude-code',
    editor_source: 'claude-code',
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
        source: 'claude-code',
        extension_version: BRIDGE_VERSION,
        vscode_version: 'claude-code',
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
      // STRICT validation: must be a JSON object with received > 0, not duplicate, no error
      const respBody = res.body;

      // Must be a JSON object (not HTML string, not empty)
      if (!respBody || typeof respBody !== 'object' || Array.isArray(respBody)) {
        log(`  Connectivity test FAILED: HTTP ${res.status} but response is not a JSON object`);
        return { ok: false, status: res.status, body: respBody, reason: 'non_json_object' };
      }

      // Must not contain an explicit error state
      if (respBody.error || respBody.errors) {
        log(`  Connectivity test FAILED: HTTP ${res.status} but response contains error state`);
        return { ok: false, status: res.status, body: respBody, reason: 'error_in_body' };
      }

      // received must be numeric and > 0
      if (typeof respBody.received !== 'number' || respBody.received <= 0) {
        log(`  Connectivity test FAILED: HTTP ${res.status} but received=${respBody.received}`);
        return { ok: false, status: res.status, body: respBody, reason: 'no_receipt' };
      }

      // Must not be marked as duplicate
      if (respBody.duplicate === true) {
        log(`  Connectivity test FAILED: HTTP ${res.status} but response marked as duplicate`);
        return { ok: false, status: res.status, body: respBody, reason: 'duplicate' };
      }

      // All checks passed
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
  log('ChaosMonkey Claude Code Terminal Bridge');
  log(`Version: ${BRIDGE_VERSION}`);
  log('========================================\n');

  log('This installer will:');
  log('  1. Configure the ChaosMonkey telemetry endpoint');
  log('  2. Authenticate using your connect code');
  log('  3. Merge telemetry hooks into ~/.claude/settings.json');
  log('  4. Validate connectivity with a real test event\n');

  log('PRIVACY NOTICE:');
  log('  This bridge collects AGGREGATE telemetry only:');
  log('  - Session duration, edit counts, change magnitude, language mix');
  log('  - Commit counts, time-to-first-commit, git branch/repo URL (sanitized)');
  log('  - Bash invocation COUNTS (command text is NEVER transmitted)');
  log('');
  log('  Raw file paths and edit text are transiently processed locally to');
  log('  derive language and change-magnitude counts. They are not transmitted');
  log('  or persisted. The working directory is used transiently to run local');
  log('  Git commands and is not transmitted or persisted.');
  log('');
  log('  The bridge does NOT transmit: file contents, diffs, prompts,');
  log('  completions, terminal commands, terminal output, or personal identity.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    // 1. Collect API base URL — CM_API_BASE_URL / CM_CONNECT_CODE env vars
    // enable non-interactive (headless/CI) installs; prompts are the fallback.
    let apiBaseUrl = process.env.CM_API_BASE_URL
      ? process.env.CM_API_BASE_URL.trim()
      : await prompt(rl, 'Enter your ChaosMonkey API base URL (e.g. https://chaosmonkey.example.com): ');
    apiBaseUrl = (apiBaseUrl || '').trim().replace(/\/+$/, '');
    if (!apiBaseUrl) {
      log('ERROR: API base URL is required.');
      process.exit(1);
    }
    // Enforce HTTPS — HTTP only for exact localhost/127.0.0.1/::1 (parsed, not substring)
    if (!validateEndpointHttps(apiBaseUrl)) {
      log('ERROR: HTTPS is required. HTTP is only permitted for localhost/127.0.0.1/::1.');
      process.exit(1);
    }

    // 2. Collect connect code
    const connectCode = process.env.CM_CONNECT_CODE
      ? process.env.CM_CONNECT_CODE.trim()
      : (await prompt(rl, 'Enter your connect code: ')).trim();
    if (!connectCode) {
      log('ERROR: connect code is required.');
      process.exit(1);
    }

    // 3. Generate installation_id
    const installationId = crypto.randomUUID();
    log(`\nGenerated installation_id: ${installationId}`);

    // 4. Exchange connect code for bearer token
    const tokenResponse = await exchangeConnectCode(apiBaseUrl, connectCode, installationId);
    if (!tokenResponse || !tokenResponse.token) {
      log('\nERROR: Could not obtain auth token. Please verify your connect code and API URL.');
      process.exit(1);
    }

    log(`\n  Auth token received (expires: ${tokenResponse.expires_at || 'unknown'})`);
    log(`  Organization ID: ${tokenResponse.organization_id}`);
    log(`  Developer ID: ${tokenResponse.developer_id || 'n/a'}`);

    // 5. Write config (with backup of existing)
    log('\nWriting configuration...');
    const config = {
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
    const configBackupPath = writeConfig(config);

    // 6. Merge hooks into Claude settings
    log('\nMerging hooks into Claude Code settings...');
    const mergeResult = mergeClaudeSettings();
    if (!mergeResult.success) {
      // Malformed settings — config was written but hooks were not
      // Restore config to pre-install state
      restoreConfig(configBackupPath);
      process.exit(1);
    }
    const settingsBackupPath = mergeResult.backupPath;
    const settingsHadExisting = mergeResult.hadExisting;

    // 7. Validate with REAL connectivity test (direct HTTP, not exit code)
    log('\nValidating connectivity with a test event...');
    const validationResult = await validateConnectivity(config);

    if (validationResult.ok) {
      // P0: Successful install — delete credential-bearing config backup
      // The backup exists only for rollback during failed installation.
      // After success, no stale auth_token should remain on disk.
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
      log('\nTelemetry is now ACTIVE for Claude Code terminal sessions.');
      log(`Endpoint: ${apiBaseUrl}`);
      log(`Organization: ${tokenResponse.organization_id}`);
      log('\nTo DISABLE telemetry:');
      log(`  Edit ${CONFIG_PATH} and set "enabled": false`);
      log('\nTo UNINSTALL:');
      log(`  node "${path.resolve(__dirname, 'uninstall.js')}"`);
      log('');
    } else {
      // P0: Validation failed — restore pre-install state
      log('\n========================================');
      log('INSTALLATION FAILED');
      log('========================================');
      log(`\nConnectivity validation failed: ${validationResult.reason || 'unknown'}`);
      log('\nRestoring pre-install state...');
      restoreSettings(settingsBackupPath, settingsHadExisting);
      restoreConfig(configBackupPath);
      log('\nYour Claude Code settings and bridge config have been restored.');
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

// Export functions for testing (when required, not run as main)
module.exports = {
  validateEndpointHttps,
  isAllowedLocalDevHost,
  isCmHookCommand,
  removeCmCommandsFromHooks,
  validateConnectivity,
  httpRequest,
  BRIDGE_VERSION,
};

// Run install only when invoked directly (not when required by tests)
if (require.main === module) {
  install().catch((e) => {
    log(`\nFATAL ERROR: ${e.message}`);
    process.exit(1);
  });
}
