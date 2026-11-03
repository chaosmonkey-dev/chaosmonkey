#!/usr/bin/env node
'use strict';

/**
 * ChaosMonkey Cursor Agent Bridge — fixture tests
 *
 * All payloads in this file are SYNTHETIC fixtures derived from Cursor's
 * documented hook contract (cursor.com/docs/hooks). Passing these tests
 * verifies bridge logic and transport only — NOT behavior inside a real
 * authenticated Cursor Agents Window (separate acceptance gate).
 *
 * Tests run hermetically: temp HOME dirs, local HTTP sink, temp git repos.
 * Nothing touches real ~/.cursor, ~/.claude, or any network.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, spawnSync, execSync } = require('child_process');

const BRIDGE_DIR = path.resolve(__dirname, '..');
const BRIDGE = path.join(BRIDGE_DIR, 'bridge.js');
const CC_BRIDGE = path.resolve(BRIDGE_DIR, '..', 'claude-code-bridge', 'bridge.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  PASS  ${name}`); })
    .catch((e) => { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`); });
}

// ---------------------------------------------------------------------------
// Hermetic helpers
// ---------------------------------------------------------------------------
function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cmcb-home-'));
}

function writeConfig(home, overrides = {}) {
  const dir = path.join(home, '.chaosmonkey-cursor-bridge');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const cfg = {
    api_base_url: overrides.api_base_url || 'http://127.0.0.1:PORT',
    auth_token: 'test-token-abc',
    installation_id: 'inst-uuid-1',
    developer_id: 'dev-1',
    organization_id: 2,
    team_id: null,
    identity_source: 'backend_claimed',
    enabled: true,
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg), { mode: 0o600 });
  return cfg;
}

function startSink() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch {}
      received.push({ headers: req.headers, body: parsed, raw: body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: parsed && parsed.events ? parsed.events.length : 0, duplicate: false, record_id: 1 }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, received, port: server.address().port });
    });
  });
}

function runBridge(home, hookType, stdinPayload, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', [BRIDGE, hookType], {
      env: { ...process.env, HOME: home, ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => stdout += d);
    child.stderr.on('data', (d) => stderr += d);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(JSON.stringify(stdinPayload));
    child.stdin.end();
  });
}

function runCcBridge(home, hookType, stdinPayload) {
  return new Promise((resolve) => {
    const child = spawn('node', [CC_BRIDGE, hookType], {
      env: { ...process.env, HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => stderr += d);
    child.on('close', (code) => resolve({ code, stderr }));
    child.stdin.write(JSON.stringify(stdinPayload));
    child.stdin.end();
  });
}

function readState(home) {
  const p = path.join(home, '.chaosmonkey-cursor-bridge', 'state.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

function readQueue(home) {
  const p = path.join(home, '.chaosmonkey-cursor-bridge', 'queue.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
}

function makeGitRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t.t && git config user.name t', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x\n');
  execSync('git add -A && git commit -qm init', { cwd: dir });
  execSync('git remote add origin https://user:pw@github.com/Acme/repo.git?token=abc#frag', { cwd: dir });
  return dir;
}

// Synthetic fixtures modeled on cursor.com/docs/hooks payloads.
const ENVELOPE = {
  conversation_id: 'conv-abc-123',
  generation_id: 'gen-1',
  cursor_version: '2.3.1',
  workspace_roots: null, // set per test
  user_email: 'kasey@example.com',          // MUST be dropped
  transcript_path: '/tmp/secret/transcript', // MUST be dropped
};

function payload(overrides) {
  return { ...ENVELOPE, ...overrides };
}

// ---------------------------------------------------------------------------
async function main() {
  console.log('Cursor agent bridge — fixture tests\n');

  // ===== Bridge event handling =====
  await test('sessionStart records state with mode provenance + git ctx', async () => {
    const home = tmpHome();
    const repo = makeGitRepo(path.join(home, 'repo'));
    writeConfig(home, { api_base_url: 'http://127.0.0.1:1' }); // unreachable; state-only test
    const r = await runBridge(home, 'session-start', payload({
      session_id: 'sess-1', composer_mode: 'agent', is_background_agent: true,
      model_id: 'claude-x', workspace_roots: [repo],
    }));
    assert.strictEqual(r.code, 0);
    const s = readState(home)['sess-1'];
    assert(s, 'state missing');
    assert.strictEqual(s.composer_mode, 'agent');
    assert.strictEqual(s.is_background_agent, true);
    assert.strictEqual(s.model_id, 'claude-x');
    assert.strictEqual(s.git_repo_url, 'https://github.com/Acme/repo.git', 'repo url not sanitized');
    assert(s.git_branch, 'branch missing');
    assert(s.start_head_sha, 'head sha missing');
  });

  await test('afterFileEdit emits file_edit: correct provenance + magnitude, no leakage', async () => {
    const home = tmpHome();
    const repo = makeGitRepo(path.join(home, 'repo'));
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    await runBridge(home, 'session-start', payload({ session_id: 'sess-2', composer_mode: 'agent', workspace_roots: [repo] }));
    received.length = 0;
    const SECRET = 'SECRET_MARKER_CONTENT';
    const r = await runBridge(home, 'post-edit', payload({
      session_id: 'sess-2',
      file_path: path.join(repo, 'src', 'deep', 'file.ts'),
      edits: [{ old_string: 'foo', new_string: SECRET + '\nline2\nline3' }, { old_string: 'aaaaaaaaaa', new_string: 'bb' }],
      agent_message: 'agent narration must not be transmitted',
    }));
    assert.strictEqual(r.code, 0);
    assert.strictEqual(received.length, 1, 'no event received');
    const ev = received[0].body.events[0];
    assert.strictEqual(ev.event_type, 'file_edit');
    const m = ev.metadata;
    assert.strictEqual(m.source, 'cursor-agent');
    assert.strictEqual(m.appName, 'Cursor');
    assert.strictEqual(m.tool, undefined, 'metadata.tool must not be set');
    assert.strictEqual(m.language_id, 'typescript');
    assert.strictEqual(m.chars_added, 30, `chars_added ${m.chars_added}`); // (33-3)+(0): 'SECRET...\nline2\nline3' - 'foo'; second edit clamps at 0
    assert.strictEqual(m.agent_verified, true);
    assert.strictEqual(m.ai_authored, true);
    assert(m.event_id, 'event_id missing');
    assert.strictEqual(m.session_id, 'sess-2');
    // privacy: scan raw body
    const raw = received[0].raw;
    for (const bad of [SECRET, 'old_string', 'new_string', 'file_path', 'agent_message', 'user_email', 'transcript_path', 'kasey@example.com', repo]) {
      assert(!raw.includes(bad), `leakage: ${bad} found in payload`);
    }
    server.close();
  });

  await test('afterShellExecution increments count only; no event sent; no command captured', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    await runBridge(home, 'session-start', payload({ session_id: 'sess-3', workspace_roots: [home] }));
    received.length = 0;
    await runBridge(home, 'post-shell', payload({
      session_id: 'sess-3',
      command: 'rm -rf SECRET_CMD', output: 'SECRET_OUTPUT',
    }));
    assert.strictEqual(received.length, 0, 'shell hook must not emit event');
    assert.strictEqual(readState(home)['sess-3'].shell_count, 1);
    server.close();
  });

  await test('stop emits bounded turn-boundary segments; stable session_id; disjoint intervals', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    await runBridge(home, 'session-start', payload({ session_id: 'sess-4', workspace_roots: [home] }));
    received.length = 0;
    await runBridge(home, 'post-edit', payload({
      session_id: 'sess-4', file_path: '/a.ts', edits: [{ old_string: '', new_string: 'aaa' }],
    }));
    received.length = 0;
    await runBridge(home, 'stop', payload({ session_id: 'sess-4', loop_count: 0 }));
    assert.strictEqual(received.length, 1, 'stop must emit a session segment');
    const seg1 = received[0].body.events[0];
    assert.strictEqual(seg1.event_type, 'session');
    const m1 = seg1.metadata;
    assert.strictEqual(m1.event_id, 'ca-sess-4-seg-1');
    assert.strictEqual(m1.session_id, 'sess-4', 'segment must keep stable conversation session_id');
    assert.strictEqual(m1.session_segment, true);
    assert.strictEqual(m1.segment_ordinal, 1);
    assert.strictEqual(m1.is_final_segment, false);
    assert.strictEqual(m1.end_reason, 'turn_boundary');
    assert.strictEqual(m1.duration_source, 'local_measured');
    assert.strictEqual(m1.agent_turn_count, 1);
    assert.strictEqual(m1.ai_burst_count, 1);
    assert.strictEqual(m1.chars_added_total, 3);
    assert(seg1.duration_ms > 0, 'measured segment duration missing');

    // second turn: new work, second stop → second segment, delta-only metrics
    await runBridge(home, 'post-edit', payload({
      session_id: 'sess-4', file_path: '/b.ts', edits: [{ old_string: '', new_string: 'bb' }],
    }));
    received.length = 0;
    await runBridge(home, 'stop', payload({ session_id: 'sess-4', loop_count: 1 }));
    assert.strictEqual(received.length, 1);
    const seg2 = received[0].body.events[0];
    const m2 = seg2.metadata;
    assert.strictEqual(m2.event_id, 'ca-sess-4-seg-2', 'segment ids must be distinct');
    assert.strictEqual(m2.session_id, 'sess-4');
    assert.strictEqual(m2.segment_ordinal, 2);
    assert.strictEqual(m2.chars_added_total, 2, 'segment metrics must be deltas, not cumulative');
    assert.strictEqual(m2.ai_burst_count, 1);
    assert.strictEqual(m2.agent_turn_count, 1);
    assert.strictEqual(readState(home)['sess-4'].turn_count, 2);
    server.close();
  });

  await test('sessionEnd emits session event w/ authoritative duration + reason + aggregates', async () => {
    const home = tmpHome();
    const repo = makeGitRepo(path.join(home, 'repo'));
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    await runBridge(home, 'session-start', payload({
      session_id: 'sess-5', composer_mode: 'agent', is_background_agent: true,
      model_id: 'claude-x', workspace_roots: [repo],
    }));
    await runBridge(home, 'post-edit', payload({
      session_id: 'sess-5', file_path: '/x/y.py', edits: [{ old_string: '', new_string: 'print(1)\n' }],
    }));
    await runBridge(home, 'post-shell', payload({ session_id: 'sess-5', command: 'ls', output: 'x' }));
    await runBridge(home, 'stop', payload({ session_id: 'sess-5' }));
    received.length = 0;
    const r = await runBridge(home, 'session-end', payload({
      session_id: 'sess-5', reason: 'completed', duration_ms: 65432,
      is_background_agent: true, final_status: 'done', workspace_roots: [repo],
    }));
    assert.strictEqual(r.code, 0);
    assert.strictEqual(received.length, 1);
    const ev = received[0].body.events[0];
    assert.strictEqual(ev.event_type, 'session');
    const m = ev.metadata;
    // Authoritative whole-conversation duration is preserved in metadata;
    // duration_ms is the measured remainder so earlier segments don't
    // double-count time.
    assert.strictEqual(m.cursor_session_duration_ms, 65432, 'authoritative duration must be preserved');
    assert(ev.duration_ms === null || ev.duration_ms < 65432, 'remainder duration must not reuse the authoritative total');
    assert.strictEqual(m.end_reason, 'session_end');
    assert.strictEqual(m.duration_source, 'cursor_session_end');
    assert.strictEqual(m.is_final_segment, true);
    assert.strictEqual(m.session_segment, true);
    assert.strictEqual(m.composer_mode, 'agent');
    assert.strictEqual(m.is_background_agent, true);
    assert.strictEqual(m.model_id, 'claude-x');
    // metrics already reported by the earlier stop segment → delta zeros
    assert.strictEqual(m.agent_turn_count, 0);
    assert.strictEqual(m.bash_invocation_count, 0);
    assert.strictEqual(m.ai_burst_count, 0);
    assert.strictEqual(m.source, 'cursor-agent');
    assert.strictEqual(m.appName, 'Cursor');
    assert.strictEqual(m.vscode_version, '2.3.1');
    assert(m.event_id === 'ca-sess-5-seg-2', `event_id ${m.event_id}`);
    // state cleaned up
    assert(!readState(home)['sess-5'], 'session state not cleared');
    // privacy scan
    const raw = received[0].raw;
    for (const bad of ['user_email', 'transcript_path', 'kasey@example.com', 'agent_message', '/x/y.py', 'SECRET']) {
      assert(!raw.includes(bad), `leakage: ${bad}`);
    }
    server.close();
  });

  await test('sessionEnd aborted → end_reason=aborted', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    await runBridge(home, 'session-start', payload({ session_id: 'sess-6', workspace_roots: [home] }));
    received.length = 0;
    await runBridge(home, 'session-end', payload({ session_id: 'sess-6', reason: 'aborted', duration_ms: 1000, workspace_roots: [home] }));
    const ev = received[0].body.events[0];
    assert.strictEqual(ev.metadata.end_reason, 'aborted');
    server.close();
  });

  await test('sessionEnd without sessionStart → end-only event, no crash', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    const r = await runBridge(home, 'session-end', payload({ session_id: 'sess-7', reason: 'window_close', duration_ms: 5000, workspace_roots: [home] }));
    assert.strictEqual(r.code, 0);
    assert.strictEqual(received.length, 1);
    const m = received[0].body.events[0].metadata;
    assert.strictEqual(m.session_start_observed, false);
    assert.strictEqual(m.end_reason, 'window_close');
    server.close();
  });

  await test('concurrent sessions tracked independently', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    await runBridge(home, 'session-start', payload({ session_id: 'A', composer_mode: 'agent', workspace_roots: [home] }));
    await runBridge(home, 'session-start', payload({ session_id: 'B', composer_mode: 'ask', workspace_roots: [home] }));
    await runBridge(home, 'post-edit', payload({ session_id: 'A', file_path: '/a.ts', edits: [{ old_string: '', new_string: 'x' }] }));
    const st = readState(home);
    assert(st['A'] && st['B']);
    assert.strictEqual(st['A'].edit_count, 1);
    assert.strictEqual(st['B'].edit_count, 0);
    assert.strictEqual(st['B'].composer_mode, 'ask');
    server.close();
  });

  await test('draft session correlates to real UUID preserving mode provenance', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    // Live-observed lifecycle: sessionStart arrives under the draft id first.
    await runBridge(home, 'session-start', payload({
      session_id: 'empty-state-draft', composer_mode: 'agent', is_background_agent: false,
      workspace_roots: [home],
    }));
    received.length = 0;
    // Later hooks carry the real conversation UUID.
    const r = await runBridge(home, 'post-edit', payload({
      session_id: 'real-uuid-9', file_path: '/d.ts', edits: [{ old_string: '', new_string: 'zz' }],
    }));
    assert.strictEqual(r.code, 0);
    const m = received[0].body.events[0].metadata;
    assert.strictEqual(m.session_id, 'real-uuid-9');
    assert.strictEqual(m.composer_mode, 'agent', 'draft mode provenance not migrated');
    assert.strictEqual(m.is_background_agent, false);
    const st = readState(home);
    assert(!st['empty-state-draft'], 'draft state not migrated');
    assert(st['real-uuid-9'], 'real session state missing');
    server.close();
  });

  await test('draft not merged when a second draft exists (ambiguity guard)', async () => {
    const home = tmpHome();
    const { server, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    await runBridge(home, 'session-start', payload({ session_id: 'empty-state-draft', composer_mode: 'agent' }));
    await runBridge(home, 'session-start', payload({ session_id: 'empty-state-draft-2', composer_mode: 'chat' }));
    await runBridge(home, 'post-edit', payload({
      session_id: 'real-x', file_path: '/e.ts', edits: [{ old_string: '', new_string: 'x' }],
    }));
    const st = readState(home);
    assert(st['empty-state-draft'], 'ambiguous draft must not merge');
    assert.strictEqual(st['real-x'].composer_mode, null, 'must not inherit mode from ambiguous drafts');
    server.close();
  });

  await test('restart resilience: unreported activity flushed as stale segment on next hook', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    await runBridge(home, 'session-start', payload({ session_id: 'sess-r', workspace_roots: [home] }));
    await runBridge(home, 'post-edit', payload({
      session_id: 'sess-r', file_path: '/r.ts', edits: [{ old_string: '', new_string: 'work' }],
    }));
    // Simulate crash/quit mid-turn: no stop fired. Age the session past the
    // stale threshold by rewriting durable state (as a restart would see it).
    const statePath = path.join(home, '.chaosmonkey-cursor-bridge', 'state.json');
    const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    st['sess-r'].last_activity_ms = Date.now() - 31 * 60 * 1000;
    fs.writeFileSync(statePath, JSON.stringify(st));
    received.length = 0;
    // Next hook (any session) triggers the stale flush.
    await runBridge(home, 'session-start', payload({ session_id: 'sess-new', workspace_roots: [home] }));
    const seg = received.map(r => r.body.events).flat().find(e => e.event_type === 'session');
    assert(seg, 'stale segment not emitted');
    assert.strictEqual(seg.metadata.end_reason, 'stale_flush');
    assert.strictEqual(seg.metadata.session_id, 'sess-r');
    assert.strictEqual(seg.metadata.ai_burst_count, 1, 'mid-turn work must be recovered');
    assert.strictEqual(seg.metadata.duration_source, 'local_measured');
    server.close();
  });

  await test('no workspace metadata → git context stays null, process.cwd never assumed', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    // No cwd / workspace_roots anywhere; process cwd is the repo dir — the
    // bridge must NOT resolve git context from it.
    const r = await runBridge(home, 'session-start', payload({ session_id: 'sess-nogit', workspace_roots: null, cwd: undefined }));
    assert.strictEqual(r.code, 0);
    const s = readState(home)['sess-nogit'];
    assert.strictEqual(s.cwd, null, 'process cwd must not be persisted as workspace');
    assert.strictEqual(s.git_branch, null);
    assert.strictEqual(s.git_repo_url, null);
    received.length = 0;
    await runBridge(home, 'stop', payload({ session_id: 'sess-nogit' }));
    const seg = received[0].body.events[0];
    assert.strictEqual(seg.metadata.git_branch, null);
    assert.strictEqual(seg.metadata.git_repo_url, null);
    server.close();
  });

  await test('workspace cwd persisted at sessionStart; git ctx retained on later hooks', async () => {
    const home = tmpHome();
    const repo = makeGitRepo(path.join(home, 'repo'));
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    await runBridge(home, 'session-start', payload({ session_id: 'sess-cwd', workspace_roots: [repo] }));
    assert.strictEqual(readState(home)['sess-cwd'].cwd, repo);
    received.length = 0;
    // Later hook carries no workspace metadata — segment still resolves git.
    await runBridge(home, 'stop', payload({ session_id: 'sess-cwd', workspace_roots: null, cwd: undefined }));
    const m = received[0].body.events[0].metadata;
    assert.strictEqual(m.git_repo_url, 'https://github.com/Acme/repo.git');
    const actualBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repo, encoding: 'utf8' }).trim();
    assert.strictEqual(m.git_branch, actualBranch);
    server.close();
  });

  await test('sessionEnd with no unreported work still emits final segment with end_reason', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    await runBridge(home, 'session-start', payload({ session_id: 'sess-empty', workspace_roots: [home] }));
    await runBridge(home, 'stop', payload({ session_id: 'sess-empty' }));
    received.length = 0;
    await runBridge(home, 'session-end', payload({ session_id: 'sess-empty', reason: 'window_close' }));
    assert.strictEqual(received.length, 1);
    const m = received[0].body.events[0].metadata;
    assert.strictEqual(m.end_reason, 'window_close');
    assert.strictEqual(m.is_final_segment, true);
    assert.strictEqual(m.duration_source, 'local_measured');
    assert.strictEqual(m.cursor_session_duration_ms, null);
    server.close();
  });

  await test('offline: failed send queues; next invocation flushes', async () => {
    const home = tmpHome();
    writeConfig(home, { api_base_url: 'http://127.0.0.1:1' }); // closed port
    await runBridge(home, 'session-start', payload({ session_id: 'sess-8', workspace_roots: [home] }));
    await runBridge(home, 'post-edit', payload({ session_id: 'sess-8', file_path: '/a.js', edits: [{ old_string: '', new_string: 'q' }] }));
    const q = readQueue(home);
    assert(q.length >= 1, `queue empty after failed send: ${q.length}`);
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    await runBridge(home, 'stop', payload({ session_id: 'sess-8' }));
    assert(received.length >= 1, 'queued events not flushed');
    assert.strictEqual(readQueue(home).length, 0);
    server.close();
  });

  await test('no config → exits 0, sends nothing (fail-safe)', async () => {
    const home = tmpHome();
    const r = await runBridge(home, 'session-start', payload({ session_id: 'x' }));
    assert.strictEqual(r.code, 0);
  });

  // ===== Install/uninstall (module-level, HOME overridden before require) =====
  await test('install merge: creates hooks.json with 5 CM hook events, foreign preserved', async () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(home, '.cursor', 'hooks.json'), JSON.stringify({
      version: 1,
      hooks: {
        afterFileEdit: [{ command: './hooks/format.sh' }],
        preToolUse: [{ command: './guard.sh', matcher: 'Shell' }],
      },
    }));
    process.env.HOME = home;
    delete require.cache[require.resolve('../install.js')];
    const inst = require('../install.js');
    const res = inst.mergeCursorHooks();
    assert(res.success);
    const cfg = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8'));
    assert.strictEqual(cfg.version, 1);
    for (const h of ['sessionStart', 'sessionEnd', 'afterFileEdit', 'afterShellExecution', 'stop']) {
      assert(Array.isArray(cfg.hooks[h]) && cfg.hooks[h].length > 0, `missing ${h}`);
    }
    // foreign preserved
    assert(cfg.hooks.afterFileEdit.some(e => e.command === './hooks/format.sh'), 'foreign afterFileEdit hook lost');
    assert(cfg.hooks.preToolUse.some(e => e.command === './guard.sh'), 'foreign preToolUse hook lost');
    // CM marker present
    assert(cfg.hooks.sessionStart.some(e => /chaosmonkey-cursor-bridge|bridge\.js/.test(e.command)));
  });

  await test('reinstall idempotent: no duplicate CM commands', async () => {
    const home = tmpHome();
    process.env.HOME = home;
    delete require.cache[require.resolve('../install.js')];
    const inst = require('../install.js');
    inst.mergeCursorHooks();
    inst.mergeCursorHooks();
    inst.mergeCursorHooks();
    const cfg = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8'));
    for (const h of ['sessionStart', 'sessionEnd', 'afterFileEdit', 'afterShellExecution', 'stop']) {
      const cm = cfg.hooks[h].filter(e => e.command && (e.command.includes('cursor-agent-bridge') || e.command.includes('bridge.js')));
      assert.strictEqual(cm.length, 1, `${h} has ${cm.length} CM entries`);
    }
  });

  await test('malformed hooks.json → safe stop, file unchanged', async () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(home, '.cursor', 'hooks.json'), '{broken');
    process.env.HOME = home;
    delete require.cache[require.resolve('../install.js')];
    const inst = require('../install.js');
    const res = inst.mergeCursorHooks();
    assert.strictEqual(res.success, false);
    assert.strictEqual(fs.readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8'), '{broken');
  });

  await test('uninstall removes only CM entries, foreign intact', async () => {
    const home = tmpHome();
    process.env.HOME = home;
    delete require.cache[require.resolve('../install.js')];
    const inst = require('../install.js');
    inst.mergeCursorHooks();
    const hooksPath = path.join(home, '.cursor', 'hooks.json');
    const cfg = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    cfg.hooks.afterFileEdit.push({ command: './keep-me.sh' });
    fs.writeFileSync(hooksPath, JSON.stringify(cfg));
    const r = spawnSync('node', [path.join(BRIDGE_DIR, 'uninstall.js')], { env: { ...process.env, HOME: home } });
    const after = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    const cmLeft = JSON.stringify(after).match(/cursor-agent-bridge|chaosmonkey-cursor-bridge/);
    assert(!cmLeft, 'CM commands remain after uninstall');
    assert(after.hooks.afterFileEdit.some(e => e.command === './keep-me.sh'), 'foreign hook lost');
  });

  // ===== Claude Code bridge interop =====
  // These cases exercise the CC bridge's Cursor-envelope handling
  // (platformOverride / cursorBridgeIsArmed), which only exists in the
  // claude-code-bridge 0.4.2 interop release. When the co-located CC bridge
  // predates it, these are dependency-scoped skips — not cursor-bridge
  // failures — because the behavior under test lives in the other bridge.
  const ccBridgeHasInterop = fs.existsSync(CC_BRIDGE)
    && fs.readFileSync(CC_BRIDGE, 'utf8').includes('cursorBridgeIsArmed');
  if (!ccBridgeHasInterop) {
    console.log('  SKIP  CC bridge interop cases — co-located claude-code-bridge predates 0.4.2 interop support');
  }

  const interopTest = (name, fn) => ccBridgeHasInterop ? test(name, fn) : Promise.resolve();

  function writeCcConfig(home, port) {
    const dir = path.join(home, '.chaosmonkey-cc-bridge');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      api_base_url: `http://127.0.0.1:${port}`,
      auth_token: 'cc-tok', installation_id: 'cc-inst', developer_id: 'dev-1',
      identity_source: 'backend_claimed', enabled: true,
    }), { mode: 0o600 });
  }

  await interopTest('CC bridge + Cursor payload (no cursor bridge) → relabeled cursor-agent, appName=Cursor', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeCcConfig(home, port);
    const r = await runCcBridge(home, 'post-edit', {
      session_id: 'cur-1', cursor_version: '2.3.1', hook_event_name: 'postToolUse',
      tool_name: 'Write', tool_input: { file_path: '/secret/x.py', content: 'SECRET_CC' },
      conversation_id: 'cur-1', workspace_roots: [home],
    });
    assert.strictEqual(r.code, 0);
    assert.strictEqual(received.length, 1, 'relabel path should still emit');
    const m = received[0].body.events[0].metadata;
    assert.strictEqual(m.source, 'cursor-agent', 'source not relabeled');
    assert.strictEqual(m.appName, 'Cursor');
    assert.strictEqual(m.imported_via, 'claude-hook-import');
    assert.strictEqual(m.vscode_version, '2.3.1');
    assert.strictEqual(received[0].body.source, 'cursor-agent');
    assert(!received[0].raw.includes('SECRET_CC'), 'content leaked');
    server.close();
  });

  function installCursorHooks(home) {
    process.env.HOME = home;
    delete require.cache[require.resolve('../install.js')];
    const inst = require('../install.js');
    inst.mergeCursorHooks();
    // Simulate the real install order: the runtime exists at the path hooks
    // reference, so the CC bridge's armed check sees a live executable.
    fs.mkdirSync(inst.RUNTIME_DIR, { recursive: true });
    fs.copyFileSync(BRIDGE, inst.RUNTIME_BRIDGE);
  }

  await interopTest('CC bridge + Cursor payload + cursor bridge installed → suppressed', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeCcConfig(home, port);
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    installCursorHooks(home); // armed: config + live hooks + existing executable
    const r = await runCcBridge(home, 'post-edit', {
      session_id: 'cur-2', cursor_version: '2.3.1', tool_name: 'Write',
      tool_input: { file_path: '/x.py', content: 'z' }, workspace_roots: [home],
    });
    assert.strictEqual(r.code, 0);
    assert.strictEqual(received.length, 0, 'suppressed event should not send');
    assert(/suppress/i.test(r.stderr), 'no suppression log');
    server.close();
  });

  await interopTest('CC bridge + stale cursor config (no hooks.json) → relabeled, not suppressed', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeCcConfig(home, port);
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` }); // config only — hooks missing
    const r = await runCcBridge(home, 'post-edit', {
      session_id: 'cur-3', cursor_version: '2.3.1', tool_name: 'Write',
      tool_input: { file_path: '/x.py', content: 'z' }, workspace_roots: [home],
    });
    assert.strictEqual(received.length, 1, 'stale config must not suppress — relabel path expected');
    assert.strictEqual(received[0].body.events[0].metadata.source, 'cursor-agent');
    server.close();
  });

  await interopTest('CC bridge + malformed cursor config → relabeled, not suppressed', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeCcConfig(home, port);
    const dir = path.join(home, '.chaosmonkey-cursor-bridge');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), '{broken');
    installCursorHooks(home);
    const r = await runCcBridge(home, 'post-edit', {
      session_id: 'cur-4', cursor_version: '2.3.1', tool_name: 'Write',
      tool_input: { file_path: '/x.py', content: 'z' }, workspace_roots: [home],
    });
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].body.events[0].metadata.source, 'cursor-agent');
    server.close();
  });

  await interopTest('CC bridge + disabled cursor config → relabeled, not suppressed', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeCcConfig(home, port);
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}`, enabled: false });
    installCursorHooks(home);
    const r = await runCcBridge(home, 'post-edit', {
      session_id: 'cur-5', cursor_version: '2.3.1', tool_name: 'Write',
      tool_input: { file_path: '/x.py', content: 'z' }, workspace_roots: [home],
    });
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].body.events[0].metadata.source, 'cursor-agent');
    server.close();
  });

  await interopTest('CC bridge + hooks pointing at missing executable → relabeled, not suppressed', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeCcConfig(home, port);
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(home, '.cursor', 'hooks.json'), JSON.stringify({
      version: 1,
      hooks: { sessionStart: [{ command: 'node "/nonexistent/cursor-agent-bridge/bridge.js" session-start' }] },
    }));
    const r = await runCcBridge(home, 'post-edit', {
      session_id: 'cur-6', cursor_version: '2.3.1', tool_name: 'Write',
      tool_input: { file_path: '/x.py', content: 'z' }, workspace_roots: [home],
    });
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].body.events[0].metadata.source, 'cursor-agent');
    server.close();
  });

  await test('CC bridge + genuine Claude payload → unchanged claude-code provenance', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeCcConfig(home, port);
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` }); // cursor bridge installed — must NOT affect genuine CC
    const r = await runCcBridge(home, 'post-edit', {
      session_id: 'cc-1', tool_name: 'Edit',
      tool_input: { file_path: '/x.py', old_string: 'a', new_string: 'bb' },
      cwd: home,
    });
    assert.strictEqual(r.code, 0);
    assert.strictEqual(received.length, 1);
    const m = received[0].body.events[0].metadata;
    assert.strictEqual(m.source, 'claude-code');
    assert.strictEqual(m.appName, undefined);
    assert.strictEqual(m.vscode_version, 'claude-code');
    server.close();
  });

  await test('cursor bridge ignores non-cursor envelopes gracefully', async () => {
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    const r = await runBridge(home, 'session-end', { session_id: 'orphan', reason: 'completed' });
    assert.strictEqual(r.code, 0);
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].body.events[0].metadata.source, 'cursor-agent');
    server.close();
  });

  await test('file_edit event_ids are unique across separate hook processes', async () => {
    // Regression: seq must persist between processes or backend event_id
    // dedup silently drops every edit after the first.
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    await runBridge(home, 'session-start', payload({ session_id: 'sess-ids', workspace_roots: [home] }));
    for (let i = 0; i < 3; i++) {
      await runBridge(home, 'post-edit', payload({
        session_id: 'sess-ids', file_path: `/f${i}.ts`, edits: [{ old_string: '', new_string: 'x'.repeat(i + 1) }],
      }));
    }
    const ids = received.map((r) => r.body.events[0].metadata.event_id);
    assert.strictEqual(ids.length, 3, `expected 3 delivered edits, got ${ids.length}`);
    assert.strictEqual(new Set(ids).size, 3, `duplicate event_ids: ${ids.join(',')}`);
    server.close();
  });

  await test('queue flush delivers events one request each (no mixed-type batch)', async () => {
    // Backend persists one row per request typed by its first event; a
    // mixed [file_edit, session] batch would hide the segment in payload.
    const home = tmpHome();
    const { server, received, port } = await startSink();
    writeConfig(home, { api_base_url: 'http://127.0.0.1:1' }); // unreachable → queue
    await runBridge(home, 'session-start', payload({ session_id: 'sess-q', workspace_roots: [home] }));
    await runBridge(home, 'post-edit', payload({ session_id: 'sess-q', file_path: '/q.ts', edits: [{ old_string: '', new_string: 'aa' }] }));
    await runBridge(home, 'stop', payload({ session_id: 'sess-q' }));
    assert.strictEqual(readQueue(home).length, 2);
    // Now reachable — the next hook invocation must flush per-event.
    writeConfig(home, { api_base_url: `http://127.0.0.1:${port}` });
    await runBridge(home, 'post-shell', payload({ session_id: 'sess-q' }));
    assert.strictEqual(readQueue(home).length, 0, 'queue not fully flushed');
    assert.strictEqual(received.length, 2, `expected 2 separate flush requests, got ${received.length}`);
    for (const r of received) assert.strictEqual(r.body.events.length, 1);
    server.close();
  });

  await test('durable install: works after extraction dir is deleted; reinstall idempotent', async () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(home, '.cursor', 'hooks.json'), JSON.stringify({
      version: 1, hooks: { stop: [{ command: '/opt/foreign/hook.sh' }] },
    }));

    // Sink that handles enrollment + telemetry like the real backend.
    const received = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        received.push({ url: req.url, body: (() => { try { return JSON.parse(body); } catch { return null; } })() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.url === '/api/ide/connect/exchange') {
          res.end(JSON.stringify({ token: 'tok-abc', developer_id: 'invite:9', organization_id: 1, expires_at: '2099-01-01' }));
        } else {
          res.end(JSON.stringify({ status: 'ok', received: 1, duplicate: false }));
        }
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    // Fake extraction dir — deleted mid-test to prove durability.
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmcb-extract-'));
    for (const f of ['bridge.js', 'install.js', 'uninstall.js', 'package.json']) {
      fs.copyFileSync(path.join(BRIDGE_DIR, f), path.join(extractDir, f));
    }

    const installEnv = {
      ...process.env, HOME: home,
      CM_API_BASE_URL: `http://127.0.0.1:${port}`,
      CM_CONNECT_CODE: 'TEST-CODE-1',
    };
    // Async spawn — the sink lives in this process's event loop, so a
    // synchronous child would deadlock the HTTP exchange.
    const runChild = (args, input) => new Promise((resolve, reject) => {
      const child = spawn('node', args, { env: installEnv });
      let out = '', err = '';
      child.stdout.on('data', (c) => out += c);
      child.stderr.on('data', (c) => err += c);
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, out, err }));
      if (input) { child.stdin.write(input); }
      child.stdin.end();
    });
    const r1 = await runChild([path.join(extractDir, 'install.js')]);
    assert.strictEqual(r1.code, 0, `install failed: ${r1.out}${r1.err}`);

    const runtimeDir = path.join(home, '.chaosmonkey-cursor-bridge', 'runtime');
    const runtimeBridge = path.join(runtimeDir, 'bridge.js');
    assert(fs.existsSync(runtimeBridge), 'runtime bridge.js missing');

    // Hooks point at the durable runtime, never the extraction dir.
    const cfg1 = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8'));
    for (const h of ['sessionStart', 'sessionEnd', 'afterFileEdit', 'afterShellExecution', 'stop']) {
      const cmds = (cfg1.hooks[h] || []).map((e) => e.command || '');
      assert(cmds.some((c) => c.includes(runtimeBridge)), `${h} not pointing at durable runtime`);
      assert(!cmds.some((c) => c.includes(extractDir)), `${h} still references extraction dir`);
    }

    // Delete the extraction dir — hooks must still work.
    fs.rmSync(extractDir, { recursive: true, force: true });
    assert(!fs.existsSync(extractDir));
    received.length = 0;
    const run = async (hook, payload) => runChild([runtimeBridge, hook], JSON.stringify(payload));
    assert.strictEqual((await run('session-start', { session_id: 'durable-1' })).code, 0);
    assert.strictEqual((await run('post-edit', { session_id: 'durable-1', file_path: '/x.ts', edits: [{ new_string: 'x=1' }] })).code, 0);
    assert.strictEqual((await run('stop', { session_id: 'durable-1' })).code, 0);
    const edits = received.filter((r) => r.url === '/api/telemetry' && r.body?.events?.[0]?.event_type === 'file_edit');
    const segs = received.filter((r) => r.url === '/api/telemetry' && r.body?.events?.[0]?.event_type === 'session');
    assert(edits.length >= 1, 'no file_edit delivered after extraction delete');
    assert(segs.length >= 1, 'no session segment delivered after extraction delete');

    // Reinstall — no duplicated CM hook entries, enrollment preserved path.
    const extract2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cmcb-extract2-'));
    for (const f of ['bridge.js', 'install.js', 'uninstall.js', 'package.json']) {
      fs.copyFileSync(path.join(BRIDGE_DIR, f), path.join(extract2, f));
    }
    const r2 = await runChild([path.join(extract2, 'install.js')]);
    assert.strictEqual(r2.code, 0, `reinstall failed: ${r2.out}${r2.err}`);
    const cfg2 = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8'));
    for (const h of ['sessionStart', 'sessionEnd', 'afterFileEdit', 'afterShellExecution', 'stop']) {
      const cm = (cfg2.hooks[h] || []).filter((e) => e.command && e.command.includes('chaosmonkey-cursor-bridge'));
      assert.strictEqual(cm.length, 1, `${h} has ${cm.length} CM entries after reinstall`);
    }

    // Uninstall — CM gone, foreign preserved, runtime removed.
    const r3 = await runChild([path.join(runtimeDir, 'uninstall.js')]);
    assert.strictEqual(r3.code, 0, `uninstall failed: ${r3.out}${r3.err}`);
    const cfg3 = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8'));
    const allCmds = JSON.stringify(cfg3);
    assert(!allCmds.includes('chaosmonkey-cursor-bridge'), 'CM hooks remain after uninstall');
    assert((cfg3.hooks.stop || []).some((e) => e.command === '/opt/foreign/hook.sh'), 'foreign stop hook lost');
    assert(!fs.existsSync(runtimeDir), 'runtime dir not removed');
    server.close();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
