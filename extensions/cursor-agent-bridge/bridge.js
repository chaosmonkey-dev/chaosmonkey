#!/usr/bin/env node
'use strict';

/**
 * ChaosMonkey Cursor Agent Bridge
 * Version: 0.4.2-cursor-bridge
 *
 * Adapted from the ChaosMonkey Claude Code Terminal Bridge (0.4.1-cc-bridge).
 * Collects authoritative Cursor agent-session telemetry via Cursor's native
 * agent-hook contract (~/.cursor/hooks.json).
 *
 * PRIVACY / SECURITY CONTRACT (same guarantees as the Claude Code bridge):
 *
 *   Raw file paths and edit text (old_string, new_string) are transiently
 *   processed in-process solely to derive aggregate telemetry (language ID
 *   from file extension, character/line change counts). They are NOT
 *   transmitted, NOT written to state.json, and NOT written to bridge.log.
 *   They are discarded after the hook invocation returns.
 *
 *   Shell command text and output present in afterShellExecution payloads are
 *   NEVER inspected, persisted, or transmitted. Only a count is tracked.
 *
 *   Cursor envelope fields user_email and transcript_path are NEVER
 *   transmitted or persisted. They are dropped on parse.
 *
 *   workspace_roots is used transiently to derive local Git context
 *   (remote URL, branch, HEAD sha). The path itself is NOT transmitted,
 *   NOT persisted, and NOT logged.
 *
 *   Git remote URLs are sanitized: username, password, query string, and
 *   fragment are stripped before transmission. Local/relative paths are
 *   rejected outright.
 *
 *   Transport is HTTPS only. HTTP is permitted ONLY when the parsed URL
 *   hostname is exactly "localhost", "127.0.0.1", or "::1" (development).
 *   Authentication via Bearer token (obtained through connect-code exchange).
 *   Pseudonymous identity only (installation_id UUID + backend-issued developer_id).
 *
 *   Telemetry failure never blocks Cursor — hook invocations always exit 0.
 *   Failed sends are queued locally and retried on subsequent invocations.
 *   Manual test-event validation MAY exit non-zero to signal failure to the installer.
 *
 * CURSOR HOOK EVENTS (cursor.com/docs/hooks):
 *   session-start  -> sessionStart: session id, composer_mode, is_background_agent
 *   session-end    -> sessionEnd: authoritative duration_ms + reason
 *   post-edit      -> afterFileEdit: per-file edit magnitude (content dropped)
 *   post-shell     -> afterShellExecution: invocation count only
 *   stop           -> stop: agent-loop turn boundary (counted, not sent)
 *   test-event     -> manual: sends a test_init event for connectivity validation
 *
 * PROVENANCE: events carry source='cursor-agent' and metadata.appName='Cursor'
 * so the backend classifies them as the cursor workflow while preserving the
 * agent-observation plane in the `source` column.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');

const BRIDGE_VERSION = '0.4.2-cursor-bridge';
const SOURCE = 'cursor-agent';
const APP_NAME = 'Cursor';
const STATE_DIR = path.join(os.homedir(), '.chaosmonkey-cursor-bridge');
const CONFIG_PATH = path.join(STATE_DIR, 'config.json');
const STATE_PATH = path.join(STATE_DIR, 'state.json');
const QUEUE_PATH = path.join(STATE_DIR, 'queue.json');
const LOG_PATH = path.join(STATE_DIR, 'bridge.log');

const MAX_QUEUE_EVENTS = 100;

// ---------------------------------------------------------------------------
// Logging — stderr only, never stdout (stdout is for hook protocol)
// NEVER log file paths, working directories, command text, or edit content.
// ---------------------------------------------------------------------------
function log(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    process.stderr.write(line);
    if (fs.existsSync(STATE_DIR)) {
      if (!fs.existsSync(LOG_PATH)) {
        fs.writeFileSync(LOG_PATH, '', { mode: 0o600 });
      }
      fs.appendFileSync(LOG_PATH, line, { flag: 'a' });
    }
  } catch (_) { /* fail silent */ }
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------
function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    log('ERROR: bridge config not found or invalid');
    return null;
  }
}

// ---------------------------------------------------------------------------
// State management — per-session, persisted to disk
// State contains ONLY aggregate counts + provenance flags.
// No file paths, no content, no transcripts. A workspace cwd may be persisted
// locally (0600 file) solely so later hooks can resolve git context; it is
// never transmitted or logged.
// ---------------------------------------------------------------------------
function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch { return {}; }
}

function saveState(state) {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state), { mode: 0o600 });
  } catch (e) {
    log(`ERROR saving state: ${e.message}`);
  }
}

function freshSegmentAccumulators() {
  return {
    seg_edits: 0,
    seg_shells: 0,
    seg_turns: 0,
    seg_chars_added: 0,
    seg_chars_removed: 0,
    seg_lines_added: 0,
    seg_lines_removed: 0,
    seg_language_counts: {},
    seg_ai_first: null,
    seg_ai_last: null,
  };
}

function getSessionState(state, sessionId) {
  if (!state[sessionId]) {
    state[sessionId] = {
      session_id: sessionId,
      start_ms: Date.now(),
      seq: 0,
      edit_count: 0,
      language_counts: {},
      chars_added_total: 0,
      chars_removed_total_est: 0,
      lines_added_total: 0,
      lines_removed_total_est: 0,
      shell_count: 0,
      turn_count: 0,
      ai_burst_count: 0,
      ai_burst_chars_total: 0,
      ai_burst_lines_total: 0,
      ai_first_burst_at_ms: null,
      ai_last_burst_at_ms: null,
      start_head_sha: null,
      git_repo_url: null,
      git_branch: null,
      composer_mode: null,
      is_background_agent: null,
      model_id: null,
      // Segment reporting — Cursor 3.25 fires sessionEnd rarely (not on
      // quit/archive), so completed work is reported as bounded segments
      // emitted at each turn boundary (stop). These counters track what has
      // already been reported so a segment carries only NEW activity.
      cwd: null,
      last_activity_ms: null,
      last_emit_ms: null,
      segment_seq: 0,
      reported_commits: 0,
      closed: false,
      ...freshSegmentAccumulators(),
    };
  }
  // Backfill fields added after the session was first persisted.
  const s = state[sessionId];
  if (s.seg_edits === undefined) Object.assign(s, freshSegmentAccumulators());
  if (s.reported_commits === undefined) s.reported_commits = 0;
  if (s.segment_seq === undefined) s.segment_seq = 0;
  if (s.last_emit_ms === undefined) s.last_emit_ms = null;
  if (s.last_activity_ms === undefined) s.last_activity_ms = null;
  if (s.cwd === undefined) s.cwd = null;
  if (s.closed === undefined) s.closed = false;
  return s;
}

// ---------------------------------------------------------------------------
// Draft-session correlation
// Cursor fires sessionStart under the placeholder id "empty-state-draft";
// later hooks carry the real conversation UUID. Rekey the draft state onto
// the real id ONLY when the mapping is unambiguous: exactly one draft session,
// zero recorded activity, and the real id is not already tracked.
// ---------------------------------------------------------------------------
function migrateDraftSession(state, sessionId) {
  if (!sessionId || sessionId.startsWith('empty-state')) return;
  const draftIds = Object.keys(state).filter((k) => k.startsWith('empty-state'));
  if (draftIds.length !== 1 || state[sessionId]) return;
  const draft = state[draftIds[0]];
  if (draft.edit_count > 0 || draft.turn_count > 0 || draft.shell_count > 0) return;
  delete state[draftIds[0]];
  draft.session_id = sessionId;
  state[sessionId] = draft;
  log(`SessionStart draft ${draftIds[0]} correlated to real session ${sessionId}`);
}

// ---------------------------------------------------------------------------
// Failed-event queue — retried on subsequent invocations.
// ---------------------------------------------------------------------------
function loadQueue() {
  try {
    if (!fs.existsSync(QUEUE_PATH)) return [];
    const q = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
    return Array.isArray(q) ? q : [];
  } catch { return []; }
}

function saveQueue(queue) {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue), { mode: 0o600 });
  } catch (e) {
    log(`ERROR saving queue: ${e.message}`);
  }
}

function enqueueEvents(events) {
  const queue = loadQueue();
  for (const e of events) {
    queue.push(e);
    if (queue.length > MAX_QUEUE_EVENTS) queue.shift(); // drop oldest, never unbounded
  }
  saveQueue(queue);
  log(`Queued ${events.length} event(s) for retry (depth=${queue.length})`);
}

async function flushQueue(config) {
  const queue = loadQueue();
  if (queue.length === 0) return;
  // One event per request: the backend persists a single row per POST typed
  // by the batch's first event, so a mixed-type batch would bury trailing
  // events (e.g. a session segment behind a file_edit) inside payload.
  let flushed = 0;
  let i = 0;
  for (; i < queue.length; i++) {
    const result = await sendTelemetry(config, [queue[i]]);
    if (!result.ok) break;
    flushed += 1;
  }
  saveQueue(queue.slice(i));
  if (flushed > 0) log(`Flushed ${flushed} queued event(s)`);
  if (i < queue.length) log(`Queue flush deferred (${queue.length - i} pending)`);
}

// ---------------------------------------------------------------------------
// Git context — sanitized
// ---------------------------------------------------------------------------
function sanitizeRepoUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return null;
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return null;
  if (trimmed.startsWith('file://')) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    const scpMatch = trimmed.match(/^([^@:/]+@)?([^:/]+):(.+)$/);
    if (scpMatch) {
      const host = scpMatch[2];
      const repoPath = scpMatch[3];
      if (host.startsWith('/') || repoPath.startsWith('/')) return null;
      return `${host}:${repoPath}`;
    }
    return null;
  }

  const proto = parsed.protocol;
  if (proto === 'file:') return null;
  if (proto === 'http:' || proto === 'https:') {
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }
  if (proto === 'ssh:' || proto === 'git:') {
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }
  return null;
}

function captureGitContext(cwd) {
  const ctx = { repo_url: null, branch: null, head_sha: null };
  // No supported workspace directory → preserve null rather than resolving
  // against the hook process's own CWD (not the project directory).
  if (!cwd) return ctx;
  // cwd is used transiently for local git commands only — never logged/transmitted
  const opts = { cwd, timeout: 3000, encoding: 'utf8' };
  try {
    const remote = execSync('git remote get-url origin 2>/dev/null', opts).trim();
    ctx.repo_url = sanitizeRepoUrl(remote);
  } catch { /* no git or no origin */ }
  try {
    ctx.branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', opts).trim();
    if (ctx.branch === 'HEAD') ctx.branch = null;
  } catch { /* detached or no git */ }
  try {
    ctx.head_sha = execSync('git rev-parse HEAD 2>/dev/null', opts).trim();
  } catch { /* no commits yet */ }
  return ctx;
}

function countCommitsSince(cwd, startSha) {
  if (!cwd || !startSha) return 0;
  try {
    const count = execSync(`git rev-list --count ${startSha}..HEAD 2>/dev/null`, {
      cwd, timeout: 3000, encoding: 'utf8',
    }).trim();
    return parseInt(count, 10) || 0;
  } catch { return 0; }
}

function getFirstCommitTimeSince(cwd, startSha) {
  if (!cwd || !startSha) return null;
  try {
    const ts = execSync(
      `git log --reverse --format=%ct ${startSha}..HEAD 2>/dev/null | head -1`,
      { cwd, timeout: 3000, encoding: 'utf8' }
    ).trim();
    if (!ts) return null;
    return parseInt(ts, 10) * 1000;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Language detection from file extension — path discarded after detection.
// ---------------------------------------------------------------------------
const EXTENSION_LANG_MAP = {
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.py': 'python', '.ipynb': 'python',
  '.rb': 'ruby', '.go': 'go', '.rs': 'rust', '.java': 'java',
  '.kt': 'kotlin', '.kts': 'kotlin', '.swift': 'swift',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
  '.cs': 'csharp', '.php': 'php', '.scala': 'scala',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.fish': 'shell',
  '.ps1': 'powershell', '.sql': 'sql',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',
  '.vue': 'vue', '.svelte': 'svelte',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.xml': 'xml',
  '.md': 'markdown', '.dart': 'dart', '.lua': 'lua', '.r': 'r', '.pl': 'perl',
  '.ex': 'elixir', '.exs': 'elixir', '.erl': 'erlang', '.clj': 'clojure',
  '.hs': 'haskell', '.ml': 'ocaml', '.nim': 'nim', '.zig': 'zig',
  '.sol': 'solidity', '.tf': 'terraform', '.gradle': 'gradle', '.groovy': 'groovy',
  '.jl': 'julia',
};

function detectLanguage(filePath) {
  if (!filePath) return 'unknown';
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) {
    const base = path.basename(filePath).toLowerCase();
    if (base === 'dockerfile') return 'dockerfile';
    if (base === 'makefile') return 'makefile';
    return 'unknown';
  }
  return EXTENSION_LANG_MAP[ext] || 'other';
}

// ---------------------------------------------------------------------------
// Change magnitude — counts only, derived from transient edit text inspection.
// old_string/new_string are inspected in-process, then discarded.
// ---------------------------------------------------------------------------
function computeEditMagnitude(oldStr, newStr) {
  const oldLen = (oldStr || '').length;
  const newLen = (newStr || '').length;
  const oldLines = (oldStr || '').split('\n').length;
  const newLines = (newStr || '').split('\n').length;
  return {
    chars_added: Math.max(0, newLen - oldLen),
    chars_removed: Math.max(0, oldLen - newLen),
    lines_added: Math.max(0, newLines - oldLines),
    lines_removed: Math.max(0, oldLines - newLines),
  };
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
// Telemetry delivery — HTTPS, Bearer auth, fail-safe
// ---------------------------------------------------------------------------
function sendTelemetry(config, events) {
  return new Promise((resolve) => {
    const baseUrl = config.api_base_url;
    if (!baseUrl) { log('ERROR: no api_base_url in config'); resolve({ ok: false, status: 0 }); return; }

    if (!validateEndpointHttps(baseUrl)) {
      log('ERROR: refusing non-HTTPS endpoint');
      resolve({ ok: false, status: 0 });
      return;
    }

    const payload = {
      source: SOURCE,
      editor_source: APP_NAME.toLowerCase(),
      extension_version: BRIDGE_VERSION,
      installation_id: config.installation_id,
      developer_id: config.developer_id || null,
      team_id: config.team_id || null,
      identity_schema_version: 1,
      identity_source: config.identity_source || 'generated_installation',
      events: events,
    };

    const body = JSON.stringify(payload);
    const url = new URL(baseUrl.replace(/\/+$/, '') + '/api/telemetry');
    const mod = url.protocol === 'https:' ? https : http;

    const reqOpts = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${config.auth_token}`,
      },
      timeout: 5000,
    };

    const req = mod.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) {
          log(`OK: ${res.statusCode} — ${events.length} event(s) sent`);
          resolve({ ok: true, status: res.statusCode, body: parsed });
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          log(`AUTH ERROR: ${res.statusCode} — token may be revoked or expired`);
          resolve({ ok: false, status: res.statusCode, body: parsed, auth: true });
        } else {
          log(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`);
          resolve({ ok: false, status: res.statusCode, body: parsed });
        }
      });
    });

    req.on('error', (e) => { log(`NETWORK ERROR: ${e.message}`); resolve({ ok: false, status: 0 }); });
    req.on('timeout', () => { log('TIMEOUT: 5s exceeded'); req.destroy(); resolve({ ok: false, status: 0 }); });
    req.write(body);
    req.end();
  });
}

// Send + queue-on-failure. Never throws.
async function deliver(config, events) {
  const result = await sendTelemetry(config, events);
  if (!result.ok && !result.auth) {
    // Transient failure → queue for retry. Auth errors are not retried
    // (they would fail identically on every retry until re-enrollment).
    enqueueEvents(events);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Event builders
// ---------------------------------------------------------------------------
function nextEventId(sessState, suffix) {
  sessState.seq += 1;
  return `ca-${sessState.session_id}-${sessState.seq}${suffix ? '-' + suffix : ''}`;
}

function buildBaseMetadata(config, sessionId, gitCtx) {
  return {
    // REQUIRED PROVENANCE: agent-observation plane + Cursor host product.
    // appName='Cursor' routes tool classification to the cursor workflow;
    // source='cursor-agent' preserves the observation surface distinction.
    // metadata.tool is intentionally NOT set — it would bypass resolution.
    source: SOURCE,
    appName: APP_NAME,
    extension_version: BRIDGE_VERSION,
    vscode_version: (config._lastCursorVersion) || 'cursor',
    session_id: sessionId,
    installation_id: config.installation_id,
    developer_id: config.developer_id || null,
    team_id: config.team_id || null,
    identity_schema_version: 1,
    identity_source: config.identity_source || 'generated_installation',
    git_repo_url: gitCtx ? gitCtx.repo_url : null,
    git_branch: gitCtx ? gitCtx.branch : null,
  };
}

function buildFileEditEvent(config, sessState, gitCtx, editData) {
  return {
    event_type: 'file_edit',
    timestamp: new Date().toISOString(),
    count: 1,
    metadata: {
      ...buildBaseMetadata(config, sessState.session_id, gitCtx),
      event_id: nextEventId(sessState, 'edit'),
      segment_type: 'event',
      language_id: editData.language_id,
      chars_added: editData.chars_added,
      chars_removed: editData.chars_removed,
      lines_added: editData.lines_added,
      lines_removed: editData.lines_removed,
      // VERIFIED provenance: this edit was produced by the Cursor agent loop —
      // the hook only fires inside an agent session. This is authoritative
      // AI-authored evidence, not a heuristic inference.
      ai_authored: true,
      agent_verified: true,
      composer_mode: sessState.composer_mode,
      is_background_agent: sessState.is_background_agent,
      bridge_version: BRIDGE_VERSION,
    },
  };
}

const SESSION_END_REASON_MAP = {
  completed: 'session_end',
  aborted: 'aborted',
  error: 'error',
  window_close: 'window_close',
  user_close: 'user_close',
};

function buildSessionEvent(config, sessState, gitCtx, sessionCwd, endData) {
  // Authoritative duration from sessionEnd payload when provided;
  // fall back to locally measured span. Never fabricate.
  const authoritativeMs = (endData && typeof endData.duration_ms === 'number' && endData.duration_ms >= 0)
    ? endData.duration_ms : null;
  const durationMs = authoritativeMs !== null ? authoritativeMs : (Date.now() - sessState.start_ms);

  const reason = endData && endData.reason;
  const endReason = SESSION_END_REASON_MAP[reason] || 'session_end';

  const commitCount = countCommitsSince(sessionCwd, sessState.start_head_sha);
  let ttfcMs = null;
  if (commitCount > 0) {
    const firstCommitMs = getFirstCommitTimeSince(sessionCwd, sessState.start_head_sha);
    if (firstCommitMs) {
      ttfcMs = firstCommitMs - sessState.start_ms;
      if (ttfcMs < 0) ttfcMs = null;
    }
  }

  const aiActiveSpanMs = (sessState.ai_first_burst_at_ms && sessState.ai_last_burst_at_ms)
    ? sessState.ai_last_burst_at_ms - sessState.ai_first_burst_at_ms
    : null;

  const reworkRatio = sessState.chars_added_total > 0
    ? sessState.chars_removed_total_est / sessState.chars_added_total
    : 0;

  return {
    event_type: 'session',
    timestamp: new Date().toISOString(),
    duration_ms: durationMs,
    metadata: {
      ...buildBaseMetadata(config, sessState.session_id, gitCtx),
      event_id: `ca-${sessState.session_id}-session`,
      segment_type: 'session',
      end_reason: endReason,
      duration_source: authoritativeMs !== null ? 'cursor_session_end' : 'local_measured',
      // Cursor agent-mode provenance — authoritative, from hook payload
      composer_mode: sessState.composer_mode,
      is_background_agent: sessState.is_background_agent,
      model_id: sessState.model_id,
      agent_turn_count: sessState.turn_count,
      files_edited_count: null, // privacy: file identities are not retained
      session_commits: commitCount,
      time_to_first_commit_ms: ttfcMs,
      session_has_commit_outcome: commitCount > 0,
      // AI metrics — every afterFileEdit is verified agent-authored
      ai_burst_count: sessState.ai_burst_count,
      ai_burst_chars_total: sessState.ai_burst_chars_total,
      ai_burst_lines_total: sessState.ai_burst_lines_total,
      ai_first_burst_at_ms: sessState.ai_first_burst_at_ms,
      ai_last_burst_at_ms: sessState.ai_last_burst_at_ms,
      ai_active_span_ms: aiActiveSpanMs,
      ai_usage_duration_ms: aiActiveSpanMs || 0,
      ai_usage_duration_definition: 'span_between_first_and_last_agent_edit',
      ai_chars_per_min: aiActiveSpanMs && aiActiveSpanMs > 0
        ? Math.round((sessState.ai_burst_chars_total / aiActiveSpanMs) * 60000)
        : null,
      chars_added_total: sessState.chars_added_total,
      chars_removed_total_est: sessState.chars_removed_total_est,
      lines_added_total: sessState.lines_added_total,
      lines_removed_total_est: sessState.lines_removed_total_est,
      change_magnitude_definition: 'added: exact_from_inserted_text; removed: estimated_from_change_range',
      language_id_counts: sessState.language_counts,
      rework_ratio_est: Math.round(reworkRatio * 1000) / 1000,
      // Not observable from Cursor hooks — intentionally null (NOT zero)
      debug_session_count: null,
      debug_time_ms: null,
      terminal_open_count: null,
      terminal_active_time_ms: null,
      terminal_definition: 'not observable from Cursor agent hooks; null by contract',
      file_save_count: null,
      will_save_total_count: null,
      will_save_format_likely_count: null,
      active_coding_duration_ms: null,
      idle_time_ms: null,
      focus_ratio: null,
      debug_ratio: null,
      terminal_ratio: null,
      idle_ratio: null,
      flow_profile: null,
      flow_definition: 'not observable from Cursor agent hooks; null by contract',
      session_quality_score: null,
      session_quality_band: null,
      session_quality_factors: null,
      is_remote_workspace: null,
      remote_name: null,
      is_multi_root_workspace: null,
      workspace_folder_count: null,
      git_context_status: gitCtx && gitCtx.repo_url ? 'resolved_full' : (gitCtx ? 'resolved_partial' : 'failed'),
      git_context_reason: gitCtx && gitCtx.repo_url ? 'full_context' : (gitCtx ? 'no_remote' : 'no_git'),
      bash_invocation_count: sessState.shell_count,
      bridge_version: BRIDGE_VERSION,
      bridge_transport: 'https',
    },
  };
}

// ---------------------------------------------------------------------------
// Session-segment reporting
// Cursor 3.25 rarely fires sessionEnd (not on quit, window close, or
// archive). Completed work must still become reportable without waiting for
// a future hook, so each `stop` (agent-turn boundary) emits a bounded
// segment event. All segments share the stable conversation session_id;
// metric fields carry DELTAS since the last emitted segment so aggregates
// never double-count. A genuine sessionEnd emits the final remainder
// segment carrying the authoritative total in cursor_session_duration_ms.
// ---------------------------------------------------------------------------
function buildSessionSegmentEvent(config, sessState, gitCtx, o) {
  const spanMs = o.now - (sessState.last_emit_ms || sessState.start_ms);
  const durationMs = spanMs > 0 ? spanMs : null;
  const segAiSpan = (sessState.seg_ai_first && sessState.seg_ai_last)
    ? sessState.seg_ai_last - sessState.seg_ai_first
    : null;
  const segRework = sessState.seg_chars_added > 0
    ? sessState.seg_chars_removed / sessState.seg_chars_added
    : 0;

  // TTFC only on the first segment in which new commits are observed.
  let ttfcMs = null;
  if (o.segCommits > 0 && (sessState.reported_commits || 0) === 0) {
    const firstCommitMs = getFirstCommitTimeSince(o.effectiveCwd, sessState.start_head_sha);
    if (firstCommitMs) {
      ttfcMs = firstCommitMs - sessState.start_ms;
      if (ttfcMs < 0) ttfcMs = null;
    }
  }
  const firstEditMs = (sessState.segment_seq === 1 && sessState.seg_ai_first)
    ? sessState.seg_ai_first - sessState.start_ms
    : null;

  return {
    event_type: 'session',
    timestamp: new Date().toISOString(),
    duration_ms: durationMs,
    metadata: {
      ...buildBaseMetadata(config, sessState.session_id, gitCtx),
      event_id: `ca-${sessState.session_id}-seg-${sessState.segment_seq}`,
      segment_type: 'session',
      // Segment provenance — the session_id is the stable Cursor conversation
      // ID; ordinal + deltas keep each emitted interval distinct and disjoint.
      session_segment: true,
      segment_ordinal: sessState.segment_seq,
      is_final_segment: !!o.isFinal,
      end_reason: o.endReason,
      duration_source: o.durationSource,
      // Authoritative whole-conversation duration when Cursor supplies it —
      // recorded for reference only; duration_ms above remains the measured
      // segment remainder so intervals never double-count.
      cursor_session_duration_ms: o.authoritativeMs ?? null,
      composer_mode: sessState.composer_mode,
      is_background_agent: sessState.is_background_agent,
      model_id: sessState.model_id,
      // Verified-agent provenance: every edit in this segment was observed via
      // Cursor's native afterFileEdit hook inside an agent session.
      ai_authored: true,
      agent_verified: true,
      agent_turn_count: sessState.seg_turns,
      files_edited_count: null, // privacy: file identities are not retained
      session_commits: o.segCommits,
      time_to_first_commit_ms: ttfcMs,
      session_has_commit_outcome: o.segCommits > 0,
      merge_state_status: o.segCommits > 0 ? 'merged' : 'no_head_change',
      merge_state_reason: o.segCommits > 0 ? 'head_advanced' : 'no_new_commits',
      ai_burst_count: sessState.seg_edits,
      ai_burst_chars_total: sessState.seg_chars_added,
      ai_burst_lines_total: sessState.seg_lines_added,
      ai_first_burst_at_ms: sessState.seg_ai_first,
      ai_last_burst_at_ms: sessState.seg_ai_last,
      ai_active_span_ms: segAiSpan,
      ai_usage_duration_ms: segAiSpan || 0,
      ai_usage_duration_definition: 'span_between_first_and_last_agent_edit',
      ai_chars_per_min: segAiSpan && segAiSpan > 0
        ? Math.round((sessState.seg_chars_added / segAiSpan) * 60000)
        : null,
      chars_added_total: sessState.seg_chars_added,
      chars_removed_total_est: sessState.seg_chars_removed,
      lines_added_total: sessState.seg_lines_added,
      lines_removed_total_est: sessState.seg_lines_removed,
      change_magnitude_definition: 'added: exact_from_inserted_text; removed: estimated_from_change_range',
      language_id_counts: sessState.seg_language_counts,
      rework_ratio_est: Math.round(segRework * 1000) / 1000,
      time_to_first_edit_ms: firstEditMs,
      time_to_first_ai_edit_ms: firstEditMs,
      session_start_observed: true,
      // Not observable from Cursor hooks — intentionally null (NOT zero)
      debug_session_count: null,
      debug_time_ms: null,
      terminal_open_count: null,
      terminal_active_time_ms: null,
      terminal_definition: 'not observable from Cursor agent hooks; null by contract',
      file_save_count: null,
      will_save_total_count: null,
      will_save_format_likely_count: null,
      active_coding_duration_ms: null,
      idle_time_ms: null,
      focus_ratio: null,
      debug_ratio: null,
      terminal_ratio: null,
      idle_ratio: null,
      flow_profile: null,
      flow_definition: 'not observable from Cursor agent hooks; null by contract',
      session_quality_score: null,
      session_quality_band: null,
      session_quality_factors: null,
      is_remote_workspace: null,
      remote_name: null,
      is_multi_root_workspace: null,
      workspace_folder_count: null,
      git_context_status: gitCtx && gitCtx.repo_url ? 'resolved_full' : (gitCtx ? 'resolved_partial' : 'failed'),
      git_context_reason: gitCtx && gitCtx.repo_url ? 'full_context' : (gitCtx ? 'no_remote' : 'no_git'),
      bash_invocation_count: sessState.seg_shells,
      bridge_version: BRIDGE_VERSION,
      bridge_transport: 'https',
    },
  };
}

// Emit one segment event for the unreported portion of a session, then mark
// it reported in durable state. git context is refreshed at emit time from
// the best available workspace directory; resolution failures stay null.
async function emitSessionSegment(config, state, sessState, effectiveCwd, o) {
  const cwd = effectiveCwd || sessState.cwd || null;
  const gitCtx = captureGitContext(cwd);
  if (!sessState.git_repo_url && gitCtx.repo_url) sessState.git_repo_url = gitCtx.repo_url;
  if (!sessState.git_branch && gitCtx.branch) sessState.git_branch = gitCtx.branch;

  const cumulativeCommits = countCommitsSince(cwd, sessState.start_head_sha);
  const segCommits = Math.max(0, cumulativeCommits - (sessState.reported_commits || 0));

  sessState.segment_seq = (sessState.segment_seq || 0) + 1;
  const event = buildSessionSegmentEvent(config, sessState, gitCtx, {
    ...o, segCommits, effectiveCwd: cwd, now: Date.now(),
  });
  await deliver(config, [event]);

  Object.assign(sessState, freshSegmentAccumulators());
  sessState.last_emit_ms = Date.now();
  sessState.reported_commits = cumulativeCommits;
  state[sessState.session_id] = sessState;
  saveState(state);
  log(`Segment ${sessState.segment_seq} for ${sessState.session_id}: ${o.endReason}`);
}

function sessionHasUnreportedActivity(sessState, effectiveCwd) {
  if (sessState.seg_edits > 0 || sessState.seg_shells > 0 || sessState.seg_turns > 0) return true;
  const cwd = effectiveCwd || sessState.cwd || null;
  const commits = countCommitsSince(cwd, sessState.start_head_sha) - (sessState.reported_commits || 0);
  return commits > 0;
}

// Sessions idle beyond this threshold with unreported activity are flushed
// on the next hook invocation. Per-turn segments make work reportable at
// each stop; this only covers residue from a mid-turn crash/quit.
const STALE_SEGMENT_MS = 30 * 60 * 1000;

async function flushStaleSegments(config, excludeSessionId) {
  const state = loadState();
  const now = Date.now();
  for (const sid of Object.keys(state)) {
    if (sid === excludeSessionId) continue;
    const sessState = getSessionState(state, sid); // backfills old persisted shape
    if (sessState.closed) continue;
    const last = sessState.last_activity_ms || sessState.start_ms;
    if (now - last < STALE_SEGMENT_MS) continue;
    if (!sessionHasUnreportedActivity(sessState, null)) continue;
    await emitSessionSegment(config, state, sessState, null, {
      endReason: 'stale_flush', durationSource: 'local_measured', isFinal: false,
    });
    log(`StaleFlush: ${sid}`);
  }
}
// Derive the session's working directory from the Cursor hook payload.
// sessionStart/sessionEnd may not carry `cwd`; workspace_roots is the
// authoritative workspace list. Used transiently for local git commands only.
// Returns null when the payload carries no workspace metadata — the hook
// process's own CWD is NOT the project directory and must not be assumed.
function sessionCwdFromPayload(hookData) {
  if (hookData.cwd && typeof hookData.cwd === 'string') return hookData.cwd;
  if (Array.isArray(hookData.workspace_roots) && hookData.workspace_roots.length > 0) {
    return hookData.workspace_roots[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook handlers
// ---------------------------------------------------------------------------
async function handleSessionStart(config, hookData) {
  const sessionId = hookData.session_id
    || hookData.conversation_id
    || `ca_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const cwd = sessionCwdFromPayload(hookData);
  const state = loadState();
  const sessState = getSessionState(state, sessionId);
  sessState.start_ms = Date.now();
  sessState.session_id = sessionId;
  // Workspace cwd persisted locally (never transmitted) so later hooks can
  // resolve git context even when their payloads lack workspace metadata.
  if (cwd) sessState.cwd = cwd;
  // Authoritative agent-mode provenance from the hook payload
  if (hookData.composer_mode !== undefined) sessState.composer_mode = hookData.composer_mode;
  if (hookData.is_background_agent !== undefined) sessState.is_background_agent = hookData.is_background_agent;
  if (hookData.model_id) sessState.model_id = hookData.model_id;
  else if (hookData.model) sessState.model_id = hookData.model;

  const gitCtx = captureGitContext(cwd);
  sessState.git_repo_url = gitCtx.repo_url;
  sessState.git_branch = gitCtx.branch;
  sessState.start_head_sha = gitCtx.head_sha;

  state[sessionId] = sessState;
  saveState(state);
  log(`SessionStart: ${sessionId} mode=${sessState.composer_mode || 'unknown'} bg=${sessState.is_background_agent}`);
}

async function handleSessionEnd(config, hookData) {
  const sessionId = hookData.session_id || hookData.conversation_id;
  if (!sessionId) { log('SessionEnd: no session_id in hook data'); return; }

  const state = loadState();
  migrateDraftSession(state, sessionId);
  const sessState = state[sessionId];
  if (!sessState) {
    // Session ended without a recorded start (bridge installed mid-session,
    // crash, or state loss). We do NOT fabricate a session event — emit a
    // minimal session_end event carrying only authoritative payload fields.
    log(`SessionEnd: no state for session ${sessionId} — emitting end-only event`);
    const cwd = sessionCwdFromPayload(hookData);
    const gitCtx = captureGitContext(cwd);
    const event = {
      event_type: 'session',
      timestamp: new Date().toISOString(),
      duration_ms: (typeof hookData.duration_ms === 'number' && hookData.duration_ms >= 0)
        ? hookData.duration_ms : null,
      metadata: {
        ...buildBaseMetadata(config, sessionId, gitCtx),
        event_id: `ca-${sessionId}-session`,
        segment_type: 'session',
        end_reason: SESSION_END_REASON_MAP[hookData.reason] || 'session_end',
        duration_source: 'cursor_session_end',
        composer_mode: hookData.composer_mode ?? null,
        is_background_agent: hookData.is_background_agent ?? null,
        model_id: hookData.model_id || hookData.model || null,
        session_start_observed: false,
        bridge_version: BRIDGE_VERSION,
        bridge_transport: 'https',
      },
    };
    await deliver(config, [event]);
    return;
  }
  // Backfill fields added after the session was first persisted.
  getSessionState(state, sessionId);

  // Genuine sessionEnd: emit the final remainder segment. Authoritative
  // whole-conversation duration is recorded in cursor_session_duration_ms;
  // duration_ms stays the measured remainder so prior segments are not
  // double-counted.
  const authoritativeMs = (typeof hookData.duration_ms === 'number' && hookData.duration_ms >= 0)
    ? hookData.duration_ms : null;
  const effectiveCwd = sessionCwdFromPayload(hookData) || sessState.cwd;
  await emitSessionSegment(config, state, sessState, effectiveCwd, {
    endReason: SESSION_END_REASON_MAP[hookData.reason] || 'session_end',
    durationSource: authoritativeMs !== null ? 'cursor_session_end' : 'local_measured',
    isFinal: true,
    authoritativeMs,
  });

  delete state[sessionId];
  saveState(state);
  log(`SessionEnd: ${sessionId} edits=${sessState.edit_count} shells=${sessState.shell_count} turns=${sessState.turn_count}`);
}

async function handlePostEdit(config, hookData) {
  const sessionId = hookData.session_id || hookData.conversation_id;
  if (!sessionId) { log('PostEdit: no session_id'); return; }

  const state = loadState();
  migrateDraftSession(state, sessionId);
  const sessState = getSessionState(state, sessionId);

  const payloadCwd = sessionCwdFromPayload(hookData);
  if (payloadCwd && !sessState.cwd) sessState.cwd = payloadCwd;

  // afterFileEdit payload: { file_path, edits: [{old_string, new_string}] }
  // file_path is transiently inspected for language detection ONLY —
  // it is NOT transmitted, persisted, or logged.
  const filePath = hookData.file_path || '';
  const languageId = detectLanguage(filePath);

  // Edit text is transiently inspected to compute magnitude, then discarded.
  const magnitude = { chars_added: 0, chars_removed: 0, lines_added: 0, lines_removed: 0 };
  const edits = Array.isArray(hookData.edits) ? hookData.edits : [];
  for (const edit of edits) {
    const m = computeEditMagnitude(edit && edit.old_string, edit && edit.new_string);
    magnitude.chars_added += m.chars_added;
    magnitude.chars_removed += m.chars_removed;
    magnitude.lines_added += m.lines_added;
    magnitude.lines_removed += m.lines_removed;
  }

  sessState.edit_count += 1;
  sessState.language_counts[languageId] = (sessState.language_counts[languageId] || 0) + 1;
  sessState.chars_added_total += magnitude.chars_added;
  sessState.chars_removed_total_est += magnitude.chars_removed;
  sessState.lines_added_total += magnitude.lines_added;
  sessState.lines_removed_total_est += magnitude.lines_removed;

  // Segment accumulators — deltas reported at the next turn boundary.
  sessState.seg_edits += 1;
  sessState.seg_chars_added += magnitude.chars_added;
  sessState.seg_chars_removed += magnitude.chars_removed;
  sessState.seg_lines_added += magnitude.lines_added;
  sessState.seg_lines_removed += magnitude.lines_removed;
  sessState.seg_language_counts[languageId] = (sessState.seg_language_counts[languageId] || 0) + 1;

  // Verified-agent burst tracking — hook-fired edits are agent-authored.
  const now = Date.now();
  sessState.last_activity_ms = now;
  sessState.ai_burst_count += 1;
  sessState.ai_burst_chars_total += magnitude.chars_added;
  sessState.ai_burst_lines_total += magnitude.lines_added;
  if (sessState.ai_first_burst_at_ms === null) sessState.ai_first_burst_at_ms = now;
  sessState.ai_last_burst_at_ms = now;
  if (sessState.seg_ai_first === null) sessState.seg_ai_first = now;
  sessState.seg_ai_last = now;

  const gitCtx = { repo_url: sessState.git_repo_url, branch: sessState.git_branch };
  const event = buildFileEditEvent(config, sessState, gitCtx, {
    language_id: languageId,
    chars_added: magnitude.chars_added,
    chars_removed: magnitude.chars_removed,
    lines_added: magnitude.lines_added,
    lines_removed: magnitude.lines_removed,
  });

  // Persist AFTER nextEventId incremented sessState.seq — each bridge
  // invocation is a fresh process, so an unpersisted seq would reuse the
  // same event_id and be silently dropped by backend event_id dedup.
  state[sessionId] = sessState;
  saveState(state);

  await deliver(config, [event]);
  log(`PostEdit: ${sessionId} lang=${languageId} +${magnitude.chars_added}/-${magnitude.chars_removed} chars`);
}

async function handlePostShell(config, hookData) {
  const sessionId = hookData.session_id || hookData.conversation_id;
  if (!sessionId) { log('PostShell: no session_id'); return; }

  // SECURITY: Do NOT read the shell command text or its output.
  // Only increment the invocation count.
  const state = loadState();
  migrateDraftSession(state, sessionId);
  const sessState = getSessionState(state, sessionId);
  const payloadCwd = sessionCwdFromPayload(hookData);
  if (payloadCwd && !sessState.cwd) sessState.cwd = payloadCwd;
  sessState.shell_count += 1;
  sessState.seg_shells += 1;
  sessState.last_activity_ms = Date.now();
  state[sessionId] = sessState;
  saveState(state);
  log(`PostShell: ${sessionId} count=${sessState.shell_count} (command text NOT captured)`);
}

async function handleStop(config, hookData) {
  const sessionId = hookData.session_id || hookData.conversation_id;
  if (!sessionId) { log('Stop: no session_id'); return; }

  // Agent-loop turn boundary — NOT a conversation end. Cursor may fire stop
  // multiple times within one conversation, and sessionEnd may never fire at
  // all. Emit a bounded segment for the unreported interval so completed
  // work is visible to canonical analytics without inventing a session end.
  const state = loadState();
  migrateDraftSession(state, sessionId);
  const sessState = getSessionState(state, sessionId);
  const payloadCwd = sessionCwdFromPayload(hookData);
  if (payloadCwd && !sessState.cwd) sessState.cwd = payloadCwd;
  sessState.turn_count += 1;
  sessState.seg_turns += 1;
  sessState.last_activity_ms = Date.now();
  state[sessionId] = sessState;

  await emitSessionSegment(config, state, sessState, payloadCwd, {
    endReason: 'turn_boundary', durationSource: 'local_measured', isFinal: false,
  });
}

// ---------------------------------------------------------------------------
// Test event — used by installer for connectivity validation
// ---------------------------------------------------------------------------
async function sendTestEvent(config, hookData) {
  const sessionId = hookData.session_id || `test_${Date.now()}`;
  const event = {
    event_type: 'test_init',
    timestamp: new Date().toISOString(),
    metadata: {
      ...buildBaseMetadata(config, sessionId, null),
      event_id: `ca-${sessionId}-test`,
      segment_type: 'event',
      trigger: 'manual_test',
      test_mode: true,
      bridge_version: BRIDGE_VERSION,
    },
  };
  const result = await sendTelemetry(config, [event]);
  if (result.ok) {
    process.stdout.write(
      `ChaosMonkey Cursor agent bridge test event sent successfully.\n` +
      `Session: ${sessionId}\n` +
      `Endpoint: ${config.api_base_url}\n`
    );
    process.exit(0);
  } else {
    process.stdout.write(
      `ChaosMonkey Cursor agent bridge test event FAILED (HTTP ${result.status}). Check the bridge log.\n`
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
async function main() {
  const hookType = process.argv[2];
  if (!hookType) {
    log('ERROR: no hook type argument provided');
    process.exit(0); // fail-safe: never block Cursor
  }

  const config = loadConfig();
  if (!config) {
    log('ERROR: no config — bridge not installed. Run install.js first.');
    if (hookType === 'test-event') process.exit(1);
    process.exit(0);
  }

  if (config.enabled === false) {
    log('Bridge disabled (config.enabled=false)');
    if (hookType === 'test-event') process.exit(1);
    process.exit(0);
  }

  if (!config.auth_token) {
    log('ERROR: no auth_token in config — run install.js to enroll');
    if (hookType === 'test-event') process.exit(1);
    process.exit(0);
  }

  // Read hook data from stdin
  let hookData = {};
  try {
    const stdin = fs.readFileSync(0, 'utf8');
    if (stdin.trim()) hookData = JSON.parse(stdin);
  } catch (e) {
    log(`WARNING: could not parse stdin JSON: ${e.message}`);
  }

  // Capture the Cursor version from the envelope for version provenance.
  config._lastCursorVersion = typeof hookData.cursor_version === 'string' ? hookData.cursor_version : null;

  // Diagnostic: payload FIELD NAMES only (never values) so real-run payload
  // schema can be verified without touching content.
  log(`Hook ${hookType} fields: ${Object.keys(hookData).sort().join(',') || '(empty)'}`);

  // Best-effort flush of previously queued events before handling this hook.
  // Never blocks on failure — sendTelemetry is bounded at 5s.
  try { await flushQueue(config); } catch {}

  try {
    switch (hookType) {
      case 'session-start':
        await handleSessionStart(config, hookData);
        break;
      case 'session-end':
        await handleSessionEnd(config, hookData);
        break;
      case 'post-edit':
        await handlePostEdit(config, hookData);
        break;
      case 'post-shell':
        await handlePostShell(config, hookData);
        break;
      case 'stop':
        await handleStop(config, hookData);
        break;
      case 'test-event':
        await sendTestEvent(config, hookData);
        break;
      default:
        log(`WARNING: unknown hook type: ${hookType}`);
    }
  } catch (e) {
    log(`ERROR in handler ${hookType}: ${e.message}`);
    if (hookType === 'test-event') process.exit(1);
  }

  // Flush stale sessions whose unreported activity predates the idle
  // threshold — covers work left unreported by a mid-turn crash or quit.
  try { await flushStaleSegments(config, null); } catch {}

  // Hook invocations always exit 0 — telemetry failure must never block Cursor.
  process.exit(0);
}

module.exports = {
  sanitizeRepoUrl,
  validateEndpointHttps,
  isAllowedLocalDevHost,
  detectLanguage,
  computeEditMagnitude,
  sessionCwdFromPayload,
  buildBaseMetadata,
  buildFileEditEvent,
  buildSessionEvent,
  buildSessionSegmentEvent,
  getSessionState,
  freshSegmentAccumulators,
  migrateDraftSession,
  sessionHasUnreportedActivity,
  STALE_SEGMENT_MS,
  SESSION_END_REASON_MAP,
  SOURCE,
  APP_NAME,
  BRIDGE_VERSION,
};

if (require.main === module) {
  main();
}
