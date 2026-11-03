'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const BRIDGE_VERSION = '0.4.1-codex-bridge';
const BRIDGE_SCHEMA_VERSION = 1;
const SOURCE = 'codex';
const HOOK_MARKER = 'chaosmonkey-codex-bridge';

function stateDir() {
  return process.env.CM_CODEX_BRIDGE_HOME || path.join(os.homedir(), '.chaosmonkey-codex-bridge');
}

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function codexHooksPath() {
  return path.join(codexHome(), 'hooks.json');
}

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

function httpRequest(url, opts, body, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      method: opts.method || 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: opts.headers || {},
      timeout: timeoutMs,
    };
    if (body) reqOpts.headers['Content-Length'] = Buffer.byteLength(body);

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
    req.on('timeout', () => { req.destroy(); reject(new Error('request_timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function ensureStateDir() {
  const dir = stateDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value, mode = 0o600) {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), { mode });
  fs.renameSync(tmpPath, filePath);
}

function copyFileMode0600(source, target) {
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o600);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isCmHookCommand(command, bridgeScript) {
  if (!command || typeof command !== 'string') return false;
  return command.includes(bridgeScript) || command.includes(HOOK_MARKER);
}

function removeCmCommandsFromHooks(hooksArray, bridgeScript) {
  if (!Array.isArray(hooksArray)) return 0;
  let removed = 0;
  const filtered = hooksArray.filter((h) => {
    if (isCmHookCommand(h && h.command, bridgeScript)) {
      removed++;
      return false;
    }
    return true;
  });
  hooksArray.length = 0;
  hooksArray.push(...filtered);
  return removed;
}

function codexHookDefinitions(bridgeScript) {
  const cmd = `node "${bridgeScript}" hook --${HOOK_MARKER}`;
  const command = { type: 'command', command: cmd, timeout: 2 };
  const entry = (hooks) => ({ hooks: [command] });
  const matcherEntry = (matcher) => ({ matcher, hooks: [command] });

  return {
    SessionStart: [matcherEntry('startup|resume|clear|compact')],
    UserPromptSubmit: [entry()],
    PreToolUse: [matcherEntry('.*')],
    PostToolUse: [matcherEntry('.*')],
    Stop: [entry()],
    SessionEnd: [matcherEntry('other')],
  };
}

function mergeCodexHooks(bridgeScript) {
  const hooksPath = codexHooksPath();
  const codexDir = path.dirname(hooksPath);
  if (!fs.existsSync(codexDir)) fs.mkdirSync(codexDir, { recursive: true, mode: 0o700 });

  let settings = {};
  const hadExisting = fs.existsSync(hooksPath);
  if (hadExisting) {
    let raw;
    try {
      raw = fs.readFileSync(hooksPath, 'utf8');
      settings = JSON.parse(raw);
    } catch {
      return { success: false, reason: 'malformed_hooks' };
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return { success: false, reason: 'malformed_hooks' };
    }
    if (settings.hooks !== undefined && (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks))) {
      return { success: false, reason: 'malformed_hooks' };
    }
  }

  let backupPath = null;
  if (hadExisting) {
    backupPath = `${hooksPath}.backup-${Date.now()}`;
    copyFileMode0600(hooksPath, backupPath);
  }

  if (!settings.hooks) settings.hooks = {};
  const cmHooks = codexHookDefinitions(bridgeScript);

  for (const [eventName, entries] of Object.entries(cmHooks)) {
    if (!Array.isArray(settings.hooks[eventName])) settings.hooks[eventName] = [];

    for (const hookEntry of settings.hooks[eventName]) {
      if (hookEntry && Array.isArray(hookEntry.hooks)) {
        removeCmCommandsFromHooks(hookEntry.hooks, bridgeScript);
      }
    }

    settings.hooks[eventName] = settings.hooks[eventName].filter((hookEntry) => {
      if (!hookEntry) return false;
      if (Array.isArray(hookEntry.hooks)) return hookEntry.hooks.length > 0;
      return true;
    });

    settings.hooks[eventName].push(...entries.map((hookEntry) => JSON.parse(JSON.stringify(hookEntry))));
  }

  writeJsonAtomic(hooksPath, settings, 0o600);
  return { success: true, hooksPath, backupPath, hadExisting };
}

function removeCodexHooks(bridgeScript) {
  const hooksPath = codexHooksPath();
  if (!fs.existsSync(hooksPath)) return { removed: 0, hooksPath };

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  } catch {
    return { removed: 0, hooksPath, reason: 'malformed_hooks' };
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) || !settings.hooks || typeof settings.hooks !== 'object') {
    return { removed: 0, hooksPath };
  }

  let removed = 0;
  for (const eventName of Object.keys(settings.hooks)) {
    const entries = settings.hooks[eventName];
    if (!Array.isArray(entries)) continue;
    for (const hookEntry of entries) {
      if (hookEntry && Array.isArray(hookEntry.hooks)) {
        removed += removeCmCommandsFromHooks(hookEntry.hooks, bridgeScript);
      }
    }
    settings.hooks[eventName] = entries.filter((hookEntry) => {
      if (!hookEntry) return false;
      if (Array.isArray(hookEntry.hooks)) return hookEntry.hooks.length > 0;
      return true;
    });
    if (settings.hooks[eventName].length === 0) delete settings.hooks[eventName];
  }

  if (removed > 0) {
    const backupPath = `${hooksPath}.backup-uninstall-${Date.now()}`;
    copyFileMode0600(hooksPath, backupPath);
    writeJsonAtomic(hooksPath, settings, 0o600);
    return { removed, hooksPath, backupPath };
  }
  return { removed, hooksPath };
}

function buildTelemetryEnvelope(config, events, batchHash) {
  return {
    source: SOURCE,
    editor_source: SOURCE,
    extension_version: BRIDGE_VERSION,
    installation_id: config.installation_id,
    developer_id: config.developer_id || null,
    team_id: config.team_id || null,
    identity_schema_version: 1,
    identity_source: config.identity_source || 'backend_claimed',
    batch_hash: batchHash,
    events: events,
  };
}

function sleepSync(ms) {
  const shared = new SharedArrayBuffer(4);
  const int32 = new Int32Array(shared);
  Atomics.wait(int32, 0, 0, ms);
}

module.exports = {
  BRIDGE_VERSION,
  BRIDGE_SCHEMA_VERSION,
  SOURCE,
  HOOK_MARKER,
  stateDir,
  codexHome,
  codexHooksPath,
  isAllowedLocalDevHost,
  validateEndpointHttps,
  httpRequest,
  ensureStateDir,
  readJsonFile,
  writeJsonAtomic,
  copyFileMode0600,
  sha256,
  isCmHookCommand,
  removeCmCommandsFromHooks,
  codexHookDefinitions,
  mergeCodexHooks,
  removeCodexHooks,
  buildTelemetryEnvelope,
  sleepSync,
};
