#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  BRIDGE_VERSION,
  BRIDGE_SCHEMA_VERSION,
  SOURCE,
  stateDir,
  validateEndpointHttps,
  httpRequest,
  ensureStateDir,
  readJsonFile,
  writeJsonAtomic,
  sha256,
  buildTelemetryEnvelope,
  sleepSync,
} = require('./lib');

const CONFIG_PATH = () => path.join(stateDir(), 'config.json');
const QUEUE_PATH = () => path.join(stateDir(), 'queue.json');
const INFLIGHT_QUEUE_PATH = () => path.join(stateDir(), 'queue-inflight.json');
const SESSIONS_PATH = () => path.join(stateDir(), 'sessions.json');
const LOG_PATH = () => path.join(stateDir(), 'bridge.log');
const STATE_LOCK_PATH = () => path.join(stateDir(), '.state.lock');
const FLUSH_LOCK_PATH = () => path.join(stateDir(), '.flush.lock');
const REQUEST_PENDING_PATH = () => path.join(stateDir(), '.request_pending');

const MAX_QUEUE = 100;
const MAX_SESSIONS = 500;
const REQUEST_TIMEOUT_MS = 5000;
const PAYLOAD_LIMIT_BYTES = 1024 * 1024;

const SUPPORTED_EVENTS = new Set([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SessionEnd',
]);

const PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'plan',
  'dontAsk',
  'bypassPermissions',
]);

const SESSION_SOURCES = new Set(['startup', 'resume', 'clear', 'compact']);
const END_REASONS = new Set(['other']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeIdentifier(value, required = true) {
  if (typeof value !== 'string') return required ? null : undefined;
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:\-]{0,127}$/.test(normalized)) {
    return required ? null : undefined;
  }
  return normalized;
}

function safeModel(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:\-]{0,127}$/.test(normalized) ? normalized : undefined;
}

function safeToolName(value) {
  if (value === 'Bash') return 'Bash';
  if (typeof value === 'string' && value.startsWith('mcp__')) return 'mcp_tool';
  return value === undefined ? undefined : 'other_tool';
}

function enumValue(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : undefined;
}

function sanitizeHookPayload(raw) {
  if (!isObject(raw)) return null;
  const eventName = enumValue(raw.hook_event_name, SUPPORTED_EVENTS);
  const sessionId = safeIdentifier(raw.session_id);
  if (!eventName || !sessionId) return null;

  const fields = {
    model: safeModel(raw.model),
    permission_mode: enumValue(raw.permission_mode, PERMISSION_MODES),
  };

  switch (eventName) {
    case 'SessionStart':
      fields.session_source = enumValue(raw.source, SESSION_SOURCES);
      break;
    case 'UserPromptSubmit':
      fields.turn_id = safeIdentifier(raw.turn_id, false);
      break;
    case 'PreToolUse':
    case 'PostToolUse':
      fields.turn_id = safeIdentifier(raw.turn_id, false);
      fields.tool_use_id = safeIdentifier(raw.tool_use_id, false);
      fields.tool_name = safeToolName(raw.tool_name);
      break;
    case 'Stop':
      fields.turn_id = safeIdentifier(raw.turn_id, false);
      if (typeof raw.stop_hook_active === 'boolean') fields.stop_hook_active = raw.stop_hook_active;
      break;
    case 'SessionEnd':
      fields.end_reason = enumValue(raw.reason, END_REASONS);
      break;
  }

  return { eventName, sessionId, fields };
}

function removeUndefined(object) {
  const result = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function newSessionRecord(sessionId, now) {
  return {
    session_id: sessionId,
    created_ms: now,
    lifecycle_event_counts: {},
    turn_ids: [],
    completed_turn_ids: [],
    pre_tool_use_ids: [],
    post_tool_use_ids: [],
    tool_counts: {},
  };
}

function pushUnique(array, value) {
  if (value !== undefined && !array.includes(value)) array.push(value);
}

function increment(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function removeStaleDirectoryLock(lockPath, staleMs = 30000) {
  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs > staleMs) fs.rmdirSync(lockPath);
  } catch {}
}

function withTelemetryLock(callback) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      fs.mkdirSync(STATE_LOCK_PATH(), 0o700);
      try {
        return { acquired: true, result: callback() };
      } finally {
        try { fs.rmdirSync(STATE_LOCK_PATH()); } catch {}
      }
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        removeStaleDirectoryLock(STATE_LOCK_PATH());
        sleepSync(10);
        continue;
      }
      break;
    }
  }
  return { acquired: false };
}

function acquireFlushLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(FLUSH_LOCK_PATH(), 0o700);
      return true;
    } catch (error) {
      if (error && error.code === 'EEXIST') removeStaleDirectoryLock(FLUSH_LOCK_PATH());
    }
  }
  return false;
}

function loadSessions() {
  const sessions = readJsonFile(SESSIONS_PATH(), {});
  return isObject(sessions) ? sessions : {};
}

function saveSessions(sessions) {
  const entries = Object.entries(sessions)
    .filter(([sessionId, record]) => safeIdentifier(sessionId) && isObject(record))
    .sort((a, b) => (b[1].created_ms || 0) - (a[1].created_ms || 0))
    .slice(0, MAX_SESSIONS);
  writeJsonAtomic(SESSIONS_PATH(), Object.fromEntries(entries), 0o600);
}

function processHookPayload(raw, now = Date.now()) {
  try { ensureStateDir(); } catch {}
  const sanitized = sanitizeHookPayload(raw);
  if (!sanitized) return { accepted: false };

  const locked = withTelemetryLock(() => {
    const sessions = loadSessions();
    const record = isObject(sessions[sanitized.sessionId])
      ? sessions[sanitized.sessionId]
      : newSessionRecord(sanitized.sessionId, now);
    sessions[sanitized.sessionId] = record;

    increment(record.lifecycle_event_counts, sanitized.eventName);
    if (sanitized.fields.model !== undefined) record.model = sanitized.fields.model;
    if (sanitized.fields.permission_mode !== undefined) record.permission_mode = sanitized.fields.permission_mode;
    if (sanitized.fields.session_source !== undefined) record.session_source = sanitized.fields.session_source;
    if (sanitized.fields.end_reason !== undefined) record.end_reason = sanitized.fields.end_reason;
    if (sanitized.fields.stop_hook_active !== undefined) record.stop_hook_active = sanitized.fields.stop_hook_active;

    if (sanitized.eventName === 'SessionStart') {
      if (record.start_ms === undefined) record.start_ms = now;
    } else if (sanitized.eventName === 'UserPromptSubmit') {
      pushUnique(record.turn_ids, sanitized.fields.turn_id);
    } else if (sanitized.eventName === 'PreToolUse') {
      pushUnique(record.turn_ids, sanitized.fields.turn_id);
      pushUnique(record.pre_tool_use_ids, sanitized.fields.tool_use_id);
    } else if (sanitized.eventName === 'PostToolUse') {
      pushUnique(record.turn_ids, sanitized.fields.turn_id);
      pushUnique(record.post_tool_use_ids, sanitized.fields.tool_use_id);
      if (sanitized.fields.tool_name !== undefined) increment(record.tool_counts, sanitized.fields.tool_name);
    } else if (sanitized.eventName === 'Stop') {
      pushUnique(record.turn_ids, sanitized.fields.turn_id);
      pushUnique(record.completed_turn_ids, sanitized.fields.turn_id);
    } else if (sanitized.eventName === 'SessionEnd') {
      record.end_ms = now;
    }

    let queued = false;
    if (sanitized.eventName === 'SessionEnd' && !record.emitted_event_id) {
      queued = enqueueSessionEvent(record, now);
    }

    try {
      saveSessions(sessions);
    } catch {
      // Telemetry state is best-effort only.
    }
    return queued;
  });

  const queued = locked.acquired ? locked.result === true : false;
  if (queued) scheduleFlush();
  return { accepted: true, queued };
}

function metadataWithOptional(record, config, eventId) {
  const metadata = {
    tool: 'codex',
    segment_type: 'session',
    session_id: safeIdentifier(record.session_id),
    extension_version: BRIDGE_VERSION,
    event_id: eventId,
    installation_id: config.installation_id || null,
    telemetry_contract: 'codex_lifecycle_hooks_v1',
    hook_schema_version: BRIDGE_SCHEMA_VERSION,
    lifecycle_event_counts: record.lifecycle_event_counts || {},
    turn_count: Array.isArray(record.turn_ids) ? record.turn_ids.length : 0,
    completed_turn_count: Array.isArray(record.completed_turn_ids) ? record.completed_turn_ids.length : 0,
    tool_attempt_count: Array.isArray(record.pre_tool_use_ids) ? record.pre_tool_use_ids.length : 0,
    tool_call_count: Array.isArray(record.post_tool_use_ids) ? record.post_tool_use_ids.length : 0,
    tool_counts: isObject(record.tool_counts) ? record.tool_counts : {},
    token_usage: null,
    token_usage_status: 'unavailable_lifecycle_hooks',
    duration_observation: 'bridge_local_receipt',
  };

  const optional = removeUndefined({
    codex_cli_version: config.codex_cli_version,
    model: safeModel(record.model),
    permission_mode: enumValue(record.permission_mode, PERMISSION_MODES),
    session_source: enumValue(record.session_source, SESSION_SOURCES),
    end_reason: enumValue(record.end_reason, END_REASONS),
    stop_hook_active: typeof record.stop_hook_active === 'boolean' ? record.stop_hook_active : undefined,
  });
  Object.assign(metadata, optional);
  return metadata;
}

function buildSessionEvent(record, config) {
  const sessionId = safeIdentifier(record.session_id);
  if (!sessionId) return null;
  const eventId = `codex-session-${sha256(sessionId).slice(0, 24)}`;
  const event = {
    event_type: 'session',
    count: 1,
    timestamp: new Date(record.end_ms || Date.now()).toISOString(),
    session_id: sessionId,
    metadata: metadataWithOptional(record, config, eventId),
  };
  if (
    typeof record.start_ms === 'number' &&
    typeof record.end_ms === 'number' &&
    record.end_ms >= record.start_ms
  ) {
    event.duration_ms = record.end_ms - record.start_ms;
  }
  return event;
}

function enqueueSessionEvent(record, now = Date.now()) {
  const config = readJsonFile(CONFIG_PATH(), {});
  if (isObject(config) && config.enabled === false) return false;
  const event = buildSessionEvent(record, isObject(config) ? config : {});
  if (!event) return false;
  const batchHash = sha256(`${SOURCE}:${event.session_id}:${event.metadata.event_id}`).slice(0, 32);
  const queue = readJsonFile(QUEUE_PATH(), []);
  const records = Array.isArray(queue) ? queue : [];
  records.push({ queued_at: new Date(now).toISOString(), batch_hash: batchHash, event });
  while (records.length > MAX_QUEUE) records.shift();
  try {
    ensureStateDir();
    writeJsonAtomic(QUEUE_PATH(), records, 0o600);
    record.emitted_event_id = event.metadata.event_id;
    return true;
  } catch {
    return false;
  }
}

async function sendTelemetry(config, events, batchHash) {
  if (config.enabled === false) return false;
  if (!config.api_base_url || !validateEndpointHttps(config.api_base_url)) return false;
  if (!config.auth_token) return false;
  const url = `${String(config.api_base_url).replace(/\/+$/, '')}/api/telemetry`;
  const body = JSON.stringify(buildTelemetryEnvelope(config, events, batchHash));
  const res = await httpRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.auth_token}`,
    },
  }, body, REQUEST_TIMEOUT_MS);
  return res.status >= 200 && res.status < 300;
}

function appendLog(level, code) {
  try {
    ensureStateDir();
    const line = `${new Date().toISOString()} ${level} ${String(code).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80)}\n`;
    fs.appendFileSync(LOG_PATH(), line, { mode: 0o600 });
  } catch {}
}

function scheduleFlush() {
  if (process.env.CM_CODEX_BRIDGE_NO_SPAWN === '1') return;
  try {
    ensureStateDir();
    if (fs.existsSync(REQUEST_PENDING_PATH())) return;
    fs.writeFileSync(REQUEST_PENDING_PATH(), String(Date.now()), { mode: 0o600 });
    const child = spawn(process.execPath, [__filename, 'flush'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.on('error', () => {
      try { fs.unlinkSync(REQUEST_PENDING_PATH()); } catch {}
    });
    child.unref();
  } catch {
    try { fs.unlinkSync(REQUEST_PENDING_PATH()); } catch {}
  }
}

function claimQueueRecords() {
  const locked = withTelemetryLock(() => {
    const inflight = readJsonFile(INFLIGHT_QUEUE_PATH(), []);
    const pending = readJsonFile(QUEUE_PATH(), []);
    const records = [
      ...(Array.isArray(inflight) ? inflight : []),
      ...(Array.isArray(pending) ? pending : []),
    ].slice(-MAX_QUEUE);
    writeJsonAtomic(INFLIGHT_QUEUE_PATH(), records, 0o600);
    writeJsonAtomic(QUEUE_PATH(), [], 0o600);
    return records;
  });
  return locked.acquired ? locked.result : [];
}

function completeInflight(remaining) {
  withTelemetryLock(() => {
    const pending = readJsonFile(QUEUE_PATH(), []);
    const merged = [
      ...remaining,
      ...(Array.isArray(pending) ? pending : []),
    ].slice(-MAX_QUEUE);
    try {
      writeJsonAtomic(QUEUE_PATH(), merged, 0o600);
      fs.unlinkSync(INFLIGHT_QUEUE_PATH());
    } catch {}
  });
}

async function flushQueue() {
  try { ensureStateDir(); } catch { return; }
  if (!acquireFlushLock()) return;
  try {
    const config = readJsonFile(CONFIG_PATH(), null);
    if (!config) return;

    const records = claimQueueRecords();
    const remaining = [];
    for (const record of records) {
      const event = isObject(record) ? record.event : null;
      const batchHash = isObject(record) ? record.batch_hash : null;
      if (!event || !batchHash) continue;
      try {
        const sent = await sendTelemetry(config, [event], batchHash);
        if (!sent) remaining.push(record);
      } catch (error) {
        appendLog('WARN', error && (error.code || error.name) ? (error.code || error.name) : 'telemetry_send_failed');
        remaining.push(record);
      }
    }
    completeInflight(remaining);
  } finally {
    try { fs.rmdirSync(FLUSH_LOCK_PATH()); } catch {}
    try { fs.unlinkSync(REQUEST_PENDING_PATH()); } catch {}
  }
}

async function sendTestEvent() {
  const config = readJsonFile(CONFIG_PATH(), null);
  if (!config) return false;
  const eventId = `codex-test-${Date.now()}`;
  const event = {
    event_type: 'test_init',
    count: 1,
    timestamp: new Date().toISOString(),
    metadata: {
      tool: 'codex',
      extension_version: BRIDGE_VERSION,
      event_id: eventId,
      installation_id: config.installation_id || null,
      codex_cli_version: config.codex_cli_version || undefined,
      token_usage: null,
      token_usage_status: 'unavailable_lifecycle_hooks',
    },
  };
  return sendTelemetry(config, [event], sha256(eventId).slice(0, 32));
}

function readHookInput() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data) > PAYLOAD_LIMIT_BYTES) {
        data = data.slice(0, PAYLOAD_LIMIT_BYTES);
      }
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
    setTimeout(() => resolve(data), 2000).unref();
  });
}

async function runHook() {
  const input = await readHookInput();
  try {
    const parsed = JSON.parse(input);
    processHookPayload(parsed);
  } catch {
    appendLog('WARN', 'hook_payload_rejected');
  }
}

async function main() {
  const command = process.argv[2] || 'help';
  if (command === 'hook') {
    await runHook();
    return 0;
  }
  if (command === 'flush') {
    await flushQueue();
    return 0;
  }
  if (command === 'test-event') {
    const ok = await sendTestEvent();
    return ok ? 0 : 1;
  }
  console.log('chaosmonkey-codex-bridge commands: hook | flush | test-event');
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch(() => process.exit(0));
}

module.exports = {
  sanitizeHookPayload,
  processHookPayload,
  buildSessionEvent,
  metadataWithOptional,
  enqueueSessionEvent,
  sendTelemetry,
  flushQueue,
  sendTestEvent,
};
