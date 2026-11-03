#!/usr/bin/env node
'use strict';

/**
 * ChaosMonkey Claude Code Terminal Bridge
 * Version: 0.4.1-cc-bridge
 *
 * PRIVACY / SECURITY CONTRACT:
 *
 *   Raw file paths and edit text (old_string, new_string, content, new_source)
 *   are transiently processed in-process solely to derive aggregate telemetry
 *   (language ID from file extension, character/line change counts). They are
 *   NOT transmitted, NOT written to state.json, and NOT written to bridge.log.
 *   They are discarded after the hook invocation returns.
 *
 *   The working directory (cwd) from hook input is transiently used locally to
 *   execute Git commands (remote URL, branch, commit count). It is NOT
 *   transmitted, NOT persisted, and NOT logged.
 *
 *   Terminal command text and output are present in the Bash hook payload but
 *   the bridge does NOT inspect, persist, or transmit them. Only a count of
 *   Bash invocations is tracked.
 *
 *   Git remote URLs are sanitized: username, password, query string, and
 *   fragment are stripped before transmission. SSH-style remotes (git@host:...)
 *   are preserved as-is; the SSH username (e.g. "git@") may remain.
 *
 *   Transport is HTTPS only. HTTP is permitted ONLY when the parsed URL
 *   hostname is exactly "localhost", "127.0.0.1", or "::1" (development).
 *   Substring spoofing (e.g. "localhost.evil.example") is rejected.
 *   Authentication via Bearer token (obtained through connect-code exchange).
 *   Pseudonymous identity only (installation_id UUID + backend-issued developer_id).
 *
 *   Telemetry failure never blocks Claude Code — hook invocations always exit 0.
 *   Manual test-event validation MAY exit non-zero to signal failure to the installer.
 *
 * HOOK EVENTS (Claude Code hook contract):
 *   session-start  -> SessionStart hook: records session start, captures git context
 *   session-end    -> SessionEnd hook: sends aggregated session event (timeout: 10s)
 *   post-edit      -> PostToolUse Edit|Write|MultiEdit|NotebookEdit: sends file_edit event
 *   post-bash      -> PostToolUse Bash: increments bash count only
 *   test-event     -> manual: sends a test_init event for connectivity validation
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');

const BRIDGE_VERSION = '0.4.2-cc-bridge';
const SOURCE = 'claude-code';
const VSCODE_VERSION = 'claude-code';
const STATE_DIR = path.join(os.homedir(), '.chaosmonkey-cc-bridge');
const CURSOR_BRIDGE_CONFIG_PATH = path.join(os.homedir(), '.chaosmonkey-cursor-bridge', 'config.json');
const CURSOR_HOOKS_PATH = path.join(os.homedir(), '.cursor', 'hooks.json');

// Platform override — set when a Cursor-originated hook payload invokes this
// bridge through Cursor's third-party hook import (~/.claude/settings.json).
// Cursor's hook envelope carries `cursor_version`; genuine Claude Code
// payloads do not. See main() for the suppress/relabel decision.
let platformOverride = null;
const CONFIG_PATH = path.join(STATE_DIR, 'config.json');
const STATE_PATH = path.join(STATE_DIR, 'state.json');
const LOG_PATH = path.join(STATE_DIR, 'bridge.log');

// ---------------------------------------------------------------------------
// Logging — stderr only, never stdout (stdout is for hook protocol)
// NEVER log file paths, working directories, command text, or edit content.
// ---------------------------------------------------------------------------
function log(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    process.stderr.write(line);
    if (fs.existsSync(STATE_DIR)) {
      // Create log file with 0600 if it doesn't exist yet
      if (!fs.existsSync(LOG_PATH)) {
        fs.writeFileSync(LOG_PATH, '', { mode: 0o600 });
      }
      fs.appendFileSync(LOG_PATH, line, { flag: 'a' });
    }
  } catch (_) { /* fail silent */ }
}

// ---------------------------------------------------------------------------
// Cursor bridge armed-check
// Suppression is only safe when the native cursor-agent bridge can actually
// own the event: a parseable, enabled config with credentials AND a live
// ~/.cursor/hooks.json entry pointing at an existing bridge executable.
// Anything else (missing/stale/malformed/disabled config, missing hooks,
// deleted executable) falls through to the relabel path so telemetry is
// preserved rather than silently discarded.
// ---------------------------------------------------------------------------
function cursorBridgeIsArmed() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CURSOR_BRIDGE_CONFIG_PATH, 'utf8'));
    if (!cfg || cfg.enabled === false) return false;
    if (typeof cfg.api_base_url !== 'string' || !cfg.api_base_url) return false;
    if (typeof cfg.auth_token !== 'string' || !cfg.auth_token) return false;
    const hooks = JSON.parse(fs.readFileSync(CURSOR_HOOKS_PATH, 'utf8'));
    for (const entries of Object.values((hooks && hooks.hooks) || {})) {
      const list = Array.isArray(entries) ? entries : [entries];
      for (const e of list) {
        const cmd = e && typeof e.command === 'string' ? e.command : '';
        if (!cmd.includes('cursor-agent-bridge') && !cmd.includes('chaosmonkey-cursor-bridge')) continue;
        // Executable referenced by the hook command must still exist.
        const match = cmd.match(/"([^"]*bridge\.js)"|'([^']*bridge\.js)'|(\S*bridge\.js)/);
        const scriptPath = match ? (match[1] || match[2] || match[3]) : null;
        if (scriptPath && fs.existsSync(scriptPath)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------
function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    // Do not log the config path — it contains the user's home directory
    log('ERROR: bridge config not found or invalid');
    return null;
  }
}

// ---------------------------------------------------------------------------
// State management — per-session, persisted to disk
// State contains ONLY aggregate counts. No file paths, no content, no cwd.
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

function getSessionState(state, sessionId) {
  if (!state[sessionId]) {
    state[sessionId] = {
      session_id: sessionId,
      start_ms: Date.now(),
      edit_count: 0,
      language_counts: {},
      chars_added_total: 0,
      chars_removed_total_est: 0,
      lines_added_total: 0,
      lines_removed_total_est: 0,
      bash_count: 0,
      ai_burst_count: 0,
      ai_burst_chars_total: 0,
      ai_burst_lines_total: 0,
      ai_first_burst_at_ms: null,
      ai_last_burst_at_ms: null,
      start_head_sha: null,
      git_repo_url: null,
      git_branch: null,
    };
  }
  return state[sessionId];
}

// ---------------------------------------------------------------------------
// Git context — sanitized
// ---------------------------------------------------------------------------
function sanitizeRepoUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // --- Local / file / relative paths → null (never transmit) ---
  // Absolute Unix paths, Windows paths, relative paths, file:// URLs
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return null;
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return null; // Windows absolute path
  if (trimmed.startsWith('file://')) return null;

  // --- URL-parseable remotes (http, https, ssh, git) ---
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Not URL-parseable — could be SCP-style or garbage
    // Check SCP-style: [user@]host:path
    const scpMatch = trimmed.match(/^([^@:/]+@)?([^:/]+):(.+)$/);
    if (scpMatch) {
      // SCP-style remote — strip user portion, retain host:path
      const host = scpMatch[2];
      const repoPath = scpMatch[3];
      // Reject if host or path looks like a local path
      if (host.startsWith('/') || repoPath.startsWith('/')) return null;
      return `${host}:${repoPath}`;
    }
    // Unknown / malformed — do not transmit
    return null;
  }

  const proto = parsed.protocol;

  // file: protocol → null
  if (proto === 'file:') return null;

  // http: / https: — strip credentials, query, fragment
  if (proto === 'http:' || proto === 'https:') {
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }

  // ssh: / git: — strip credentials, query, fragment; retain host + path
  if (proto === 'ssh:' || proto === 'git:') {
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }

  // Any other protocol — reject
  return null;
}

function captureGitContext(cwd) {
  const ctx = { repo_url: null, branch: null, head_sha: null };
  // cwd is used transiently for local git commands only — never logged/transmitted
  const opts = { cwd: cwd || process.cwd(), timeout: 3000, encoding: 'utf8' };
  try {
    const remote = execSync('git remote get-url origin 2>/dev/null', opts).trim();
    ctx.repo_url = sanitizeRepoUrl(remote);
  } catch { /* no git or no origin */ }
  try {
    ctx.branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', opts).trim();
    if (ctx.branch === 'HEAD') ctx.branch = null; // detached
  } catch { /* detached or no git */ }
  try {
    ctx.head_sha = execSync('git rev-parse HEAD 2>/dev/null', opts).trim();
  } catch { /* no commits yet */ }
  return ctx;
}

function countCommitsSince(cwd, startSha) {
  if (!startSha) return 0;
  try {
    const count = execSync(`git rev-list --count ${startSha}..HEAD 2>/dev/null`, {
      cwd: cwd || process.cwd(), timeout: 3000, encoding: 'utf8',
    }).trim();
    return parseInt(count, 10) || 0;
  } catch { return 0; }
}

function getFirstCommitTimeSince(cwd, startSha) {
  if (!startSha) return null;
  try {
    const ts = execSync(
      `git log --reverse --format=%ct ${startSha}..HEAD 2>/dev/null | head -1`,
      { cwd: cwd || process.cwd(), timeout: 3000, encoding: 'utf8' }
    ).trim();
    if (!ts) return null;
    return parseInt(ts, 10) * 1000; // git uses seconds, we use ms
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Language detection from file extension
// File path is transiently inspected to extract the extension, then discarded.
// The path itself is NOT transmitted, persisted, or logged.
// ---------------------------------------------------------------------------
const EXTENSION_LANG_MAP = {
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.py': 'python', '.ipynb': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.swift': 'swift',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.scala': 'scala',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.fish': 'shell',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.json': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.md': 'markdown',
  '.dart': 'dart',
  '.lua': 'lua',
  '.r': 'r',
  '.pl': 'perl',
  '.ex': 'elixir', '.exs': 'elixir',
  '.erl': 'erlang',
  '.clj': 'clojure',
  '.hs': 'haskell',
  '.ml': 'ocaml',
  '.nim': 'nim',
  '.zig': 'zig',
  '.sol': 'solidity',
  '.tf': 'terraform',
  '.gradle': 'gradle',
  '.groovy': 'groovy',
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
// old_string/new_string/content/new_source are inspected in-process to compute
// character/line counts, then discarded. They are NOT transmitted or persisted.
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

function computeWriteMagnitude(content) {
  const len = (content || '').length;
  const lines = (content || '').split('\n').length;
  return { chars_added: len, chars_removed: 0, lines_added: lines, lines_removed: 0 };
}

// ---------------------------------------------------------------------------
// HTTPS enforcement — shared validator (bridge.js and install.js use the same logic)
// HTTP is permitted ONLY when parsed hostname is exactly localhost/127.0.0.1/::1.
// Substring spoofing (localhost.evil.example, 127.0.0.1.evil.example, ?host=localhost)
// is rejected because we compare the parsed hostname, not the raw string.
// ---------------------------------------------------------------------------
function isAllowedLocalDevHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function validateEndpointHttps(baseUrl) {
  // Returns true if the endpoint is acceptable (HTTPS, or HTTP to exact localhost)
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

    // Enforce HTTPS — HTTP only for exact localhost/127.0.0.1/::1 (parsed, not substring)
    if (!validateEndpointHttps(baseUrl)) {
      log('ERROR: refusing non-HTTPS endpoint');
      resolve({ ok: false, status: 0 });
      return;
    }

    const payload = {
      source: platformOverride ? platformOverride.source : SOURCE,
      editor_source: platformOverride ? platformOverride.appName.toLowerCase() : SOURCE,
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
          resolve({ ok: false, status: res.statusCode, body: parsed });
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

// ---------------------------------------------------------------------------
// Event builders
// ---------------------------------------------------------------------------
function buildBaseMetadata(config, sessionId, gitCtx) {
  return {
    source: platformOverride ? platformOverride.source : SOURCE,
    appName: platformOverride ? platformOverride.appName : undefined,
    imported_via: platformOverride ? platformOverride.imported_via : undefined,
    extension_version: BRIDGE_VERSION,
    vscode_version: platformOverride ? platformOverride.vscode_version : VSCODE_VERSION,
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

function buildFileEditEvent(config, sessionId, gitCtx, editData) {
  return {
    event_type: 'file_edit',
    timestamp: new Date().toISOString(),
    count: 1,
    metadata: {
      ...buildBaseMetadata(config, sessionId, gitCtx),
      segment_type: 'event',
      language_id: editData.language_id,
      chars_added: editData.chars_added,
      chars_removed: editData.chars_removed,
      lines_added: editData.lines_added,
      lines_removed: editData.lines_removed,
      ai_authored: true, // All Claude Code edits are AI-authored
    },
  };
}

function buildSessionEvent(config, sessState, gitCtx, sessionCwd) {
  const now = Date.now();
  const durationMs = now - sessState.start_ms;

  // Compute commit metrics using the SESSION's cwd (from hook input), not process.cwd()
  // sessionCwd is used transiently for local git commands only — never logged/transmitted
  const commitCount = countCommitsSince(sessionCwd, sessState.start_head_sha);
  let ttfcMs = null;
  if (commitCount > 0) {
    const firstCommitMs = getFirstCommitTimeSince(sessionCwd, sessState.start_head_sha);
    if (firstCommitMs) {
      ttfcMs = firstCommitMs - sessState.start_ms;
      if (ttfcMs < 0) ttfcMs = null; // guard against invalid negative TTFC
    }
  }

  // AI burst span
  const aiActiveSpanMs = (sessState.ai_first_burst_at_ms && sessState.ai_last_burst_at_ms)
    ? sessState.ai_last_burst_at_ms - sessState.ai_first_burst_at_ms
    : null;

  // Rework estimate (range-based)
  const reworkRatio = sessState.chars_added_total > 0
    ? sessState.chars_removed_total_est / sessState.chars_added_total
    : 0;

  return {
    event_type: 'session',
    timestamp: new Date(now).toISOString(),
    duration_ms: durationMs,
    metadata: {
      ...buildBaseMetadata(config, sessState.session_id, gitCtx),
      segment_type: 'session',
      end_reason: 'session_end',
      // files_edited_count is null because the privacy contract intentionally
      // avoids retaining file identity. A correct distinct-file count cannot be
      // obtained without persisting file paths or hashes, which we do not do.
      files_edited_count: null,
      session_commits: commitCount,
      time_to_first_commit_ms: ttfcMs,
      session_has_commit_outcome: commitCount > 0,
      // AI metrics — all Claude Code edits are AI-authored
      ai_burst_count: sessState.ai_burst_count,
      ai_burst_chars_total: sessState.ai_burst_chars_total,
      ai_burst_lines_total: sessState.ai_burst_lines_total,
      ai_first_burst_at_ms: sessState.ai_first_burst_at_ms,
      ai_last_burst_at_ms: sessState.ai_last_burst_at_ms,
      ai_active_span_ms: aiActiveSpanMs,
      ai_usage_duration_ms: aiActiveSpanMs || 0,
      ai_usage_duration_definition: 'span_between_first_and_last_ai_burst',
      ai_chars_per_min: aiActiveSpanMs && aiActiveSpanMs > 0
        ? Math.round((sessState.ai_burst_chars_total / aiActiveSpanMs) * 60000)
        : null,
      // Change magnitude — counts only, NO content
      chars_added_total: sessState.chars_added_total,
      chars_removed_total_est: sessState.chars_removed_total_est,
      lines_added_total: sessState.lines_added_total,
      lines_removed_total_est: sessState.lines_removed_total_est,
      change_magnitude_definition: 'added: exact_from_inserted_text; removed: estimated_from_change_range',
      // Language mix — language IDs only, NO file paths
      language_id_counts: sessState.language_counts,
      // Rework
      rework_ratio_est: Math.round(reworkRatio * 1000) / 1000,
      // Unsupported by terminal hooks — intentionally null (NOT zero)
      debug_session_count: null,
      debug_time_ms: null,
      terminal_open_count: null,
      terminal_active_time_ms: null,
      terminal_definition: 'not observable from Claude Code hooks; null by contract',
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
      flow_definition: 'not observable from Claude Code hooks; null by contract',
      session_quality_score: null,
      session_quality_band: null,
      session_quality_factors: null,
      // Workspace — NO names/paths transmitted
      is_remote_workspace: null,
      remote_name: null,
      is_multi_root_workspace: null,
      workspace_folder_count: null,
      // Git context status
      git_context_status: gitCtx && gitCtx.repo_url ? 'resolved_full' : (gitCtx ? 'resolved_partial' : 'failed'),
      git_context_reason: gitCtx && gitCtx.repo_url ? 'full_context' : (gitCtx ? 'no_remote' : 'no_git'),
      // Bash/tool invocations — count only, NO command text
      bash_invocation_count: sessState.bash_count,
      // Bridge provenance
      bridge_version: BRIDGE_VERSION,
      bridge_transport: 'https',
    },
  };
}

// ---------------------------------------------------------------------------
// Hook handlers
// ---------------------------------------------------------------------------
async function handleSessionStart(config, hookData) {
  const sessionId = hookData.session_id || `cc_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  // cwd is used transiently for local git commands only — never logged/transmitted
  const cwd = hookData.cwd || process.cwd();
  const state = loadState();
  const sessState = getSessionState(state, sessionId);
  sessState.start_ms = Date.now();
  sessState.session_id = sessionId;

  // Capture git context at session start
  const gitCtx = captureGitContext(cwd);
  sessState.git_repo_url = gitCtx.repo_url;
  sessState.git_branch = gitCtx.branch;
  sessState.start_head_sha = gitCtx.head_sha;

  state[sessionId] = sessState;
  saveState(state);
  // Log does NOT include cwd or any path
  log(`SessionStart: ${sessionId} git=${gitCtx.repo_url ? 'yes' : 'no'}`);
}

async function handleSessionEnd(config, hookData) {
  const sessionId = hookData.session_id;
  if (!sessionId) { log('SessionEnd: no session_id in hook data'); return; }

  const state = loadState();
  const sessState = state[sessionId];
  if (!sessState) {
    log(`SessionEnd: no state for session ${sessionId}`);
    return;
  }

  // Use the SESSION's cwd from hook input for git/commit queries
  // cwd is used transiently for local git commands only — never logged/transmitted/persisted
  const sessionCwd = hookData.cwd || process.cwd();

  // Re-capture git context (branch may have changed)
  const gitCtx = captureGitContext(sessionCwd);

  // Build and send session event
  const event = buildSessionEvent(config, sessState, gitCtx, sessionCwd);
  await sendTelemetry(config, [event]);

  // Clean up session state
  delete state[sessionId];
  saveState(state);
  log(`SessionEnd: ${sessionId} duration=${event.duration_ms}ms edits=${sessState.edit_count} commits=${event.metadata.session_commits}`);
}

async function handlePostEdit(config, hookData) {
  const sessionId = hookData.session_id;
  if (!sessionId) { log('PostEdit: no session_id'); return; }

  const state = loadState();
  const sessState = getSessionState(state, sessionId);

  const toolName = hookData.tool_name || '';
  const toolInput = hookData.tool_input || {};

  // Extract file path for language detection ONLY — path is NOT transmitted/persisted/logged
  // It is discarded after detectLanguage() returns
  const filePath = toolInput.file_path || toolInput.notebook_path || '';
  const languageId = detectLanguage(filePath);

  // Compute change magnitude from edit text — counts only
  // old_string/new_string/content/new_source are inspected in-process, then discarded
  // They are NOT transmitted, persisted, or logged
  let magnitude;
  if (toolName === 'Write') {
    magnitude = computeWriteMagnitude(toolInput.content);
  } else if (toolName === 'MultiEdit') {
    magnitude = { chars_added: 0, chars_removed: 0, lines_added: 0, lines_removed: 0 };
    const edits = toolInput.edits || [];
    for (const edit of edits) {
      const m = computeEditMagnitude(edit.old_string, edit.new_string);
      magnitude.chars_added += m.chars_added;
      magnitude.chars_removed += m.chars_removed;
      magnitude.lines_added += m.lines_added;
      magnitude.lines_removed += m.lines_removed;
    }
  } else if (toolName === 'NotebookEdit') {
    magnitude = computeWriteMagnitude(toolInput.new_source);
  } else {
    // Edit (default)
    magnitude = computeEditMagnitude(toolInput.old_string, toolInput.new_string);
  }

  // Update session state — aggregate counts only, no file paths or content
  sessState.edit_count += 1;
  sessState.language_counts[languageId] = (sessState.language_counts[languageId] || 0) + 1;
  sessState.chars_added_total += magnitude.chars_added;
  sessState.chars_removed_total_est += magnitude.chars_removed;
  sessState.lines_added_total += magnitude.lines_added;
  sessState.lines_removed_total_est += magnitude.lines_removed;

  // AI burst tracking (all Claude Code edits are AI bursts)
  const now = Date.now();
  sessState.ai_burst_count += 1;
  sessState.ai_burst_chars_total += magnitude.chars_added;
  sessState.ai_burst_lines_total += magnitude.lines_added;
  if (sessState.ai_first_burst_at_ms === null) sessState.ai_first_burst_at_ms = now;
  sessState.ai_last_burst_at_ms = now;

  state[sessionId] = sessState;
  saveState(state);

  // Send file_edit event — counts + magnitude only, NO path/content
  const gitCtx = { repo_url: sessState.git_repo_url, branch: sessState.git_branch };
  const event = buildFileEditEvent(config, sessionId, gitCtx, {
    language_id: languageId,
    chars_added: magnitude.chars_added,
    chars_removed: magnitude.chars_removed,
    lines_added: magnitude.lines_added,
    lines_removed: magnitude.lines_removed,
  });
  await sendTelemetry(config, [event]);
  // Log does NOT include file path or content
  log(`PostEdit: ${sessionId} tool=${toolName} lang=${languageId} +${magnitude.chars_added}/-${magnitude.chars_removed} chars`);
}

async function handlePostBash(config, hookData) {
  const sessionId = hookData.session_id;
  if (!sessionId) { log('PostBash: no session_id'); return; }

  // SECURITY: Do NOT read tool_input.command or tool_response.output
  // Only increment the bash invocation count
  const state = loadState();
  const sessState = getSessionState(state, sessionId);
  sessState.bash_count += 1;
  state[sessionId] = sessState;
  saveState(state);
  log(`PostBash: ${sessionId} count=${sessState.bash_count} (command text NOT captured)`);
}

// ---------------------------------------------------------------------------
// Test event — used by installer for connectivity validation
// Unlike hook invocations, this MAY exit non-zero on failure
// ---------------------------------------------------------------------------
async function sendTestEvent(config, hookData) {
  const sessionId = hookData.session_id || `test_${Date.now()}`;
  const event = {
    event_type: 'test_init',
    timestamp: new Date().toISOString(),
    metadata: {
      ...buildBaseMetadata(config, sessionId, null),
      segment_type: 'event',
      trigger: 'manual_test',
      test_mode: true,
      bridge_version: BRIDGE_VERSION,
    },
  };
  const result = await sendTelemetry(config, [event]);
  if (result.ok) {
    process.stdout.write(
      `ChaosMonkey bridge test event sent successfully.\n` +
      `Session: ${sessionId}\n` +
      `Endpoint: ${config.api_base_url}\n`
    );
    process.exit(0);
  } else {
    process.stdout.write(
      `ChaosMonkey bridge test event FAILED (HTTP ${result.status}). Check ${LOG_PATH}\n`
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
    process.exit(0); // fail-safe: don't block Claude Code
  }

  const config = loadConfig();
  if (!config) {
    log('ERROR: no config — bridge not installed. Run install.js first.');
    // test-event exits non-zero so installer can detect failure; hooks exit 0
    if (hookType === 'test-event') process.exit(1);
    process.exit(0); // fail-safe
  }

  if (config.enabled === false) {
    log('Bridge disabled (config.enabled=false)');
    if (hookType === 'test-event') process.exit(1);
    process.exit(0);
  }

  if (!config.auth_token) {
    log('ERROR: no auth_token in config — run install.js to enroll');
    if (hookType === 'test-event') process.exit(1);
    process.exit(0); // fail-safe
  }

  // Read hook data from stdin
  let hookData = {};
  try {
    const stdin = fs.readFileSync(0, 'utf8');
    if (stdin.trim()) hookData = JSON.parse(stdin);
  } catch (e) {
    log(`WARNING: could not parse stdin JSON: ${e.message}`);
  }

  // Cursor interoperability: Cursor auto-imports hooks from
  // ~/.claude/settings.json (third-party imports, on by default). A
  // Cursor-originated invocation carries `cursor_version` in its hook
  // envelope; genuine Claude Code payloads never do.
  if (hookData && typeof hookData.cursor_version === 'string' && hookData.cursor_version) {
    if (cursorBridgeIsArmed()) {
      // The native cursor-agent bridge owns Cursor-originated events.
      // Emitting here would double-report the same agent operation.
      log('Cursor-origin hook; native cursor bridge armed — suppressing');
      process.exit(0);
    }
    // No native bridge — relabel provenance so Cursor-originated events are
    // classified as the cursor workflow, not mislabeled as claude-code.
    platformOverride = {
      source: 'cursor-agent',
      appName: 'Cursor',
      vscode_version: hookData.cursor_version,
      imported_via: 'claude-hook-import',
    };
    log('Cursor-origin hook; relabeling provenance to cursor-agent');
  }

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
      case 'post-bash':
        await handlePostBash(config, hookData);
        break;
      case 'test-event':
        await sendTestEvent(config, hookData);
        break; // sendTestEvent handles its own exit
      default:
        log(`WARNING: unknown hook type: ${hookType}`);
    }
  } catch (e) {
    log(`ERROR in handler ${hookType}: ${e.message}`);
    if (hookType === 'test-event') process.exit(1);
  }

  // Hook invocations always exit 0 — telemetry failure must never block Claude Code
  // test-event handles its own exit above
  process.exit(0);
}

// Export functions for testing (when required, not run as main)
module.exports = {
  sanitizeRepoUrl,
  validateEndpointHttps,
  isAllowedLocalDevHost,
  detectLanguage,
  computeEditMagnitude,
  computeWriteMagnitude,
  buildBaseMetadata,
  buildFileEditEvent,
  buildSessionEvent,
  BRIDGE_VERSION,
  SOURCE,
};

// Run main only when invoked directly (not when required by tests)
if (require.main === module) {
  main();
}