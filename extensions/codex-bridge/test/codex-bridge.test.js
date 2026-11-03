'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const EXTENSION_DIR = path.resolve(__dirname, '..');
const BRIDGE = path.join(EXTENSION_DIR, 'bridge.js');
const INSTALL = path.join(EXTENSION_DIR, 'install.js');
const SENTINEL = 'CM_C0_SENTINEL_SECRET_9f4b_do_not_transmit';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-codex-bridge-test-'));
let passed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`ok ${passed} - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      console.error(error.stack || error);
      process.exitCode = 1;
      throw error;
    });
}

function tmpDir(name) {
  const dir = path.join(testRoot, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function bridgeEnv(stateDir, extra = {}) {
  return {
    ...process.env,
    CM_CODEX_BRIDGE_HOME: stateDir,
    CM_CODEX_BRIDGE_NO_SPAWN: '1',
    ...extra,
  };
}

function runBridge(stateDir, args, input, extraEnv = {}) {
  return spawnSync(process.execPath, [BRIDGE, ...args], {
    input,
    encoding: 'utf8',
    timeout: 10000,
    env: bridgeEnv(stateDir, extraEnv),
  });
}

function runBridgeAsync(stateDir, args, input, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BRIDGE, ...args], {
      env: bridgeEnv(stateDir, extraEnv),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => stdout += chunk);
    child.stderr.on('data', (chunk) => stderr += chunk);
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

function runInstallAsync(stateDir, codexHome, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [INSTALL, ...args], {
      env: bridgeEnv(stateDir, { CODEX_HOME: codexHome, ...extraEnv }),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => stdout += chunk);
    child.stderr.on('data', (chunk) => stderr += chunk);
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end('');
  });
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function fileTextIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function writeConfig(stateDir, apiBaseUrl) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(stateDir, 'config.json'), JSON.stringify({
    api_base_url: apiBaseUrl,
    auth_token: 'test-token',
    installation_id: 'install-test-1',
    developer_id: 'dev-test-1',
    team_id: 'team-test-1',
    organization_id: 'org-test-1',
    identity_source: 'backend_claimed',
    identity_schema_version: 1,
    enabled: true,
    codex_cli_version: 'codex-cli 0.150.0-alpha.8',
  }), { mode: 0o600 });
}

function lifecyclePayloads(sessionId = 'session-c0-001') {
  return [
    {
      hook_event_name: 'SessionStart',
      session_id: sessionId,
      source: 'startup',
      model: 'gpt-5.6-sol',
      permission_mode: 'bypassPermissions',
      cwd: `/tmp/${SENTINEL}/workspace`,
      transcript_path: `/tmp/${SENTINEL}/transcript.jsonl`,
    },
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      turn_id: 'turn-c0-001',
      prompt: `Please inspect ${SENTINEL}`,
      model: 'gpt-5.6-sol',
      permission_mode: 'bypassPermissions',
      cwd: `/tmp/${SENTINEL}/workspace`,
      transcript_path: `/tmp/${SENTINEL}/transcript.jsonl`,
    },
    {
      hook_event_name: 'PreToolUse',
      session_id: sessionId,
      turn_id: 'turn-c0-001',
      tool_use_id: 'tool-c0-001',
      tool_name: 'Bash',
      tool_input: { command: `echo ${SENTINEL}` },
      model: 'gpt-5.6-sol',
      permission_mode: 'bypassPermissions',
      cwd: `/tmp/${SENTINEL}/workspace`,
      transcript_path: `/tmp/${SENTINEL}/transcript.jsonl`,
    },
    {
      hook_event_name: 'PostToolUse',
      session_id: sessionId,
      turn_id: 'turn-c0-001',
      tool_use_id: 'tool-c0-001',
      tool_name: 'Bash',
      tool_input: { command: `echo ${SENTINEL}` },
      tool_response: { stdout: SENTINEL, stderr: 'private output' },
      model: 'gpt-5.6-sol',
      permission_mode: 'bypassPermissions',
      cwd: `/tmp/${SENTINEL}/workspace`,
      transcript_path: `/tmp/${SENTINEL}/transcript.jsonl`,
    },
    {
      hook_event_name: 'Stop',
      session_id: sessionId,
      turn_id: 'turn-c0-001',
      last_assistant_message: `assistant says ${SENTINEL}`,
      stop_hook_active: false,
      model: 'gpt-5.6-sol',
      permission_mode: 'bypassPermissions',
      cwd: `/tmp/${SENTINEL}/workspace`,
      transcript_path: `/tmp/${SENTINEL}/transcript.jsonl`,
    },
    {
      hook_event_name: 'SessionEnd',
      session_id: sessionId,
      reason: 'other',
      cwd: `/tmp/${SENTINEL}/workspace`,
      transcript_path: `/tmp/${SENTINEL}/transcript.jsonl`,
    },
  ];
}

function runLifecycle(stateDir, sessionId) {
  for (const payload of lifecyclePayloads(sessionId)) {
    const result = runBridge(stateDir, ['hook'], JSON.stringify(payload));
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, '');
  }
}

function queuedEvents(stateDir) {
  return readJson(path.join(stateDir, 'queue.json'), []);
}

async function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      const request = { method: req.method, url: req.url, headers: req.headers, body };
      requests.push(request);
      handler(request, res);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function main() {
  await test('C0 lifecycle produces one sanitized aggregate Codex session event', async () => {
    const stateDir = tmpDir('lifecycle');
    writeConfig(stateDir, 'http://127.0.0.1:9');
    runLifecycle(stateDir);

    const queue = queuedEvents(stateDir);
    assert.strictEqual(queue.length, 1);
    const event = queue[0].event;
    assert.strictEqual(event.event_type, 'session');
    assert.strictEqual(event.count, 1);
    assert.strictEqual(event.session_id, 'session-c0-001');
    assert(Number.isInteger(event.duration_ms));
    assert(event.timestamp.endsWith('Z'));

    const metadata = event.metadata;
    assert.strictEqual(metadata.tool, 'codex');
    assert.strictEqual(metadata.segment_type, 'session');
    assert.strictEqual(metadata.session_id, event.session_id);
    assert.strictEqual(metadata.extension_version, '0.4.1-codex-bridge');
    assert.strictEqual(metadata.codex_cli_version, 'codex-cli 0.150.0-alpha.8');
    assert.strictEqual(metadata.model, 'gpt-5.6-sol');
    assert.strictEqual(metadata.permission_mode, 'bypassPermissions');
    assert.strictEqual(metadata.session_source, 'startup');
    assert.strictEqual(metadata.end_reason, 'other');
    assert.strictEqual(metadata.turn_count, 1);
    assert.strictEqual(metadata.completed_turn_count, 1);
    assert.strictEqual(metadata.tool_attempt_count, 1);
    assert.strictEqual(metadata.tool_call_count, 1);
    assert.deepStrictEqual(metadata.tool_counts, { Bash: 1 });
    assert.strictEqual(metadata.token_usage, null);
    assert.strictEqual(metadata.token_usage_status, 'unavailable_lifecycle_hooks');
    assert.strictEqual(metadata.duration_observation, 'bridge_local_receipt');
    assert.deepStrictEqual(metadata.lifecycle_event_counts, {
      SessionStart: 1,
      UserPromptSubmit: 1,
      PreToolUse: 1,
      PostToolUse: 1,
      Stop: 1,
      SessionEnd: 1,
    });
  });

  await test('concurrent lifecycle hooks aggregate safely and duplicate SessionEnd is idempotent', async () => {
    const stateDir = tmpDir('concurrent');
    writeConfig(stateDir, 'http://127.0.0.1:9');
    const sessionId = 'session-concurrent-001';
    const firstFive = lifecyclePayloads(sessionId).slice(0, 5);
    await Promise.all(firstFive.map((payload) => runBridgeAsync(stateDir, ['hook'], JSON.stringify(payload))));
    const endPayload = lifecyclePayloads(sessionId)[5];
    assert.strictEqual((await runBridgeAsync(stateDir, ['hook'], JSON.stringify(endPayload))).status, 0);
    assert.strictEqual((await runBridgeAsync(stateDir, ['hook'], JSON.stringify(endPayload))).status, 0);

    const sessions = readJson(path.join(stateDir, 'sessions.json'), {});
    const record = sessions[sessionId];
    assert(record, 'session record missing');
    assert.deepStrictEqual(record.lifecycle_event_counts, {
      SessionStart: 1,
      UserPromptSubmit: 1,
      PreToolUse: 1,
      PostToolUse: 1,
      Stop: 1,
      SessionEnd: 2,
    });
    assert.strictEqual(queuedEvents(stateDir).length, 1);
  });

  await test('sentinel developer content never reaches sanitized object, state, queue, request, or logs', async () => {
    const stateDir = tmpDir('sentinel');
    const receiver = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    try {
      writeConfig(stateDir, `http://127.0.0.1:${receiver.port}`);
      runLifecycle(stateDir, 'session-sentinel-001');

      const flush = await runBridgeAsync(stateDir, ['flush'], '');
      assert.strictEqual(flush.status, 0, flush.stderr);
      assert.strictEqual(receiver.requests.length, 1, JSON.stringify({ stderr: flush.stderr, queue: queuedEvents(stateDir) }));
      const request = receiver.requests[0];
      assert.strictEqual(request.url, '/api/telemetry');
      assert.strictEqual(request.headers.authorization, 'Bearer test-token');
      const outbound = JSON.parse(request.body);
      assert.strictEqual(outbound.source, 'codex');
      assert.strictEqual(outbound.editor_source, 'codex');
      assert.strictEqual(outbound.events.length, 1);

      const persisted = [
        fileTextIfExists(path.join(stateDir, 'sessions.json')),
        fileTextIfExists(path.join(stateDir, 'queue.json')),
        fileTextIfExists(path.join(stateDir, 'bridge.log')),
        request.body,
        flush.stdout,
        flush.stderr,
      ].join('\n');
      assert(!persisted.includes(SENTINEL));
      for (const prohibited of ['prompt', 'tool_input', 'tool_response', 'last_assistant_message', 'transcript_path', 'cwd']) {
        assert(!Object.prototype.hasOwnProperty.call(outbound.events[0].metadata, prohibited), prohibited);
        assert(!Object.prototype.hasOwnProperty.call(outbound.events[0], prohibited), prohibited);
      }
    } finally {
      await receiver.close();
    }
  });

  await test('missing optional fields remain absent and unavailable metrics are not fabricated', async () => {
    const stateDir = tmpDir('optional');
    writeConfig(stateDir, 'http://127.0.0.1:9');
    const minimal = [
      { hook_event_name: 'SessionStart', session_id: 'session-minimal-001' },
      { hook_event_name: 'SessionEnd', session_id: 'session-minimal-001' },
    ];
    for (const payload of minimal) {
      const result = runBridge(stateDir, ['hook'], JSON.stringify(payload));
      assert.strictEqual(result.status, 0);
    }
    const event = queuedEvents(stateDir)[0].event;
    assert(!Object.prototype.hasOwnProperty.call(event.metadata, 'model'));
    assert(!Object.prototype.hasOwnProperty.call(event.metadata, 'permission_mode'));
    assert(!Object.prototype.hasOwnProperty.call(event.metadata, 'session_source'));
    assert(!Object.prototype.hasOwnProperty.call(event.metadata, 'end_reason'));
    assert(!Object.prototype.hasOwnProperty.call(event.metadata, 'cost_usd'));
    assert(!Object.prototype.hasOwnProperty.call(event.metadata, 'input_tokens'));
    assert(!Object.prototype.hasOwnProperty.call(event.metadata, 'output_tokens'));
    assert.strictEqual(event.metadata.token_usage, null);
  });

  await test('canonical source and bounded tool identity are truthful', async () => {
    const stateDir = tmpDir('identity');
    writeConfig(stateDir, 'http://127.0.0.1:9');
    const payloads = [
      { hook_event_name: 'SessionStart', session_id: 'session-tools-001', source: 'startup' },
      { hook_event_name: 'PreToolUse', session_id: 'session-tools-001', turn_id: 'turn-1', tool_use_id: 'tool-mcp', tool_name: 'mcp__private__raw_tool' },
      { hook_event_name: 'PostToolUse', session_id: 'session-tools-001', turn_id: 'turn-1', tool_use_id: 'tool-mcp', tool_name: 'mcp__private__raw_tool' },
      { hook_event_name: 'PreToolUse', session_id: 'session-tools-001', turn_id: 'turn-1', tool_use_id: 'tool-other', tool_name: `Secret_${SENTINEL}` },
      { hook_event_name: 'PostToolUse', session_id: 'session-tools-001', turn_id: 'turn-1', tool_use_id: 'tool-other', tool_name: `Secret_${SENTINEL}` },
      { hook_event_name: 'SessionEnd', session_id: 'session-tools-001', reason: 'other' },
    ];
    for (const payload of payloads) {
      assert.strictEqual(runBridge(stateDir, ['hook'], JSON.stringify(payload)).status, 0);
    }
    const event = queuedEvents(stateDir)[0].event;
    assert.strictEqual(event.metadata.tool, 'codex');
    assert.deepStrictEqual(event.metadata.tool_counts, { mcp_tool: 1, other_tool: 1 });
    assert(!JSON.stringify(event).includes('mcp__private__raw_tool'));
    assert(!JSON.stringify(event).includes(SENTINEL));
  });

  await test('malformed and unsupported payloads fail closed for telemetry and open for Codex', async () => {
    const stateDir = tmpDir('malformed');
    const invalid = runBridge(stateDir, ['hook'], '{not json');
    assert.strictEqual(invalid.status, 0);
    const unsupported = runBridge(stateDir, ['hook'], JSON.stringify({
      hook_event_name: 'Interrupt',
      session_id: 'session-interrupt-001',
      prompt: SENTINEL,
    }));
    assert.strictEqual(unsupported.status, 0);
    assert.deepStrictEqual(readJson(path.join(stateDir, 'sessions.json'), {}), {});
    assert.deepStrictEqual(queuedEvents(stateDir), []);
    const persisted = fileTextIfExists(path.join(stateDir, 'bridge.log'));
    assert(!persisted.includes(SENTINEL));
  });

  await test('endpoint unavailable leaves sanitized event queued and exits zero', async () => {
    const stateDir = tmpDir('unavailable');
    writeConfig(stateDir, 'http://127.0.0.1:9');
    runLifecycle(stateDir, 'session-offline-001');
    const before = queuedEvents(stateDir);
    assert.strictEqual(before.length, 1);
    const flush = runBridge(stateDir, ['flush'], '');
    assert.strictEqual(flush.status, 0);
    assert.strictEqual(queuedEvents(stateDir).length, 1);
  });

  await test('queue or session write failure does not fail the hook process', async () => {
    const stateDir = tmpDir('write-failure');
    fs.mkdirSync(path.join(stateDir, 'queue.json'), { recursive: true });
    fs.mkdirSync(path.join(stateDir, 'sessions.json'), { recursive: true });
    const result = runBridge(stateDir, ['hook'], JSON.stringify({
      hook_event_name: 'SessionEnd',
      session_id: 'session-write-failure-001',
      reason: 'other',
      prompt: SENTINEL,
    }));
    assert.strictEqual(result.status, 0);
    assert(!result.stderr.includes(SENTINEL));
  });

  await test('hook merge preserves existing Codex settings and is idempotent', async () => {
    const codexHome = tmpDir('codex-home');
    process.env.CODEX_HOME = codexHome;
    const lib = require('../lib');
    const hooksPath = path.join(codexHome, 'hooks.json');
    const existing = {
      description: 'user hooks',
      hooks: {
        Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: 'user-stop-hook', timeout: 7 }] }],
        CustomEvent: [{ hooks: [{ type: 'command', command: 'user-custom' }] }],
      },
      other_setting: { keep: true },
    };
    fs.writeFileSync(hooksPath, JSON.stringify(existing, null, 2));

    const first = lib.mergeCodexHooks(BRIDGE);
    assert.strictEqual(first.success, true);
    const second = lib.mergeCodexHooks(BRIDGE);
    assert.strictEqual(second.success, true);

    const merged = readJson(hooksPath, null);
    assert.strictEqual(merged.description, 'user hooks');
    assert.deepStrictEqual(merged.other_setting, { keep: true });
    assert.strictEqual(merged.hooks.CustomEvent.length, 1);
    assert.strictEqual(merged.hooks.Stop.length, 2);
    const cmCommands = JSON.stringify(merged.hooks).match(/bridge\.js/g) || [];
    assert.strictEqual(cmCommands.length, 6);
    assert.strictEqual((JSON.stringify(merged.hooks).match(/chaosmonkey-codex-bridge/g) || []).length, 6);
    for (const eventName of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd']) {
      assert.strictEqual(merged.hooks[eventName].filter((entry) => JSON.stringify(entry).includes(BRIDGE)).length, 1);
    }

    const removed = lib.removeCodexHooks(BRIDGE);
    assert.strictEqual(removed.removed, 6);
    const afterRemove = readJson(hooksPath, null);
    assert.strictEqual(afterRemove.hooks.Stop.length, 1);
    assert.strictEqual(afterRemove.hooks.Stop[0].hooks[0].command, 'user-stop-hook');
    assert.strictEqual(afterRemove.hooks.CustomEvent.length, 1);
    assert.deepStrictEqual(afterRemove.other_setting, { keep: true });
  });

  await test('malformed Codex hooks configuration stops install without mutation', async () => {
    const codexHome = tmpDir('bad-hooks');
    process.env.CODEX_HOME = codexHome;
    const lib = require('../lib');
    const hooksPath = path.join(codexHome, 'hooks.json');
    fs.writeFileSync(hooksPath, '{malformed');
    const before = fs.readFileSync(hooksPath, 'utf8');
    const result = lib.mergeCodexHooks(BRIDGE);
    assert.strictEqual(result.success, false);
    assert.strictEqual(fs.readFileSync(hooksPath, 'utf8'), before);
  });

  await test('installer exchanges canonical connect-code fields, registers hooks once, and validates telemetry', async () => {
    const stateDir = tmpDir('install-state');
    const codexHome = tmpDir('install-codex');
    const server = await startServer((req, res) => {
      if (req.url === '/api/ide/connect/exchange') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          token: 'install-token',
          organization_id: 'org-install',
          developer_id: 'dev-install',
          team_id: 'team-install',
          identity_source: 'backend_claimed',
        }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      }
    });
    try {
      const args = [
        `--api-base-url=http://127.0.0.1:${server.port}`,
        '--connect-code=CONNECT-CODE-1',
        '--codex-bin=/bin/false',
      ];
      const first = await runInstallAsync(stateDir, codexHome, args);
      assert.strictEqual(first.status, 0, first.stderr + first.stdout);
      const second = await runInstallAsync(stateDir, codexHome, args);
      assert.strictEqual(second.status, 0, second.stderr + second.stdout);
      assert(first.stdout.includes('/hooks'));
      assert(first.stdout.includes('--dangerously-bypass-hook-trust'));

      const exchange = server.requests.find((req) => req.url === '/api/ide/connect/exchange');
      const exchangeBody = JSON.parse(exchange.body);
      assert.strictEqual(exchangeBody.code, 'CONNECT-CODE-1');
      assert.strictEqual(exchangeBody.installation_id.length, 36);
      assert.strictEqual(exchangeBody.extension_version, '0.4.1-codex-bridge');

      const telemetry = server.requests.filter((req) => req.url === '/api/telemetry');
      assert.strictEqual(telemetry.length, 2);
      const testBody = JSON.parse(telemetry[0].body);
      assert.strictEqual(testBody.source, 'codex');
      assert.strictEqual(testBody.events[0].event_type, 'test_init');

      const hooks = readJson(path.join(codexHome, 'hooks.json'), null);
      for (const eventName of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd']) {
        const ours = hooks.hooks[eventName].filter((entry) => JSON.stringify(entry).includes('chaosmonkey-codex-bridge') || JSON.stringify(entry).includes(BRIDGE));
        assert.strictEqual(ours.length, 1, eventName);
      }
      const config = readJson(path.join(stateDir, 'config.json'), null);
      assert.strictEqual(config.auth_token, 'install-token');
      assert.strictEqual(config.codex_hooks_existed, false);
      assert.strictEqual(fs.statSync(path.join(stateDir, 'config.json')).mode & 0o777, 0o600);
    } finally {
      await server.close();
    }
  });

  await test('failed install rolls back config and byte-for-byte existing hooks', async () => {
    const stateDir = tmpDir('rollback-state');
    const codexHome = tmpDir('rollback-codex');
    const hooksPath = path.join(codexHome, 'hooks.json');
    const originalHooks = '{"hooks":{"Stop":[{"matcher":".*","hooks":[{"type":"command","command":"user-stop","timeout":9}]}]}},"other_setting":true}';
    fs.writeFileSync(hooksPath, originalHooks);
    const server = await startServer((req, res) => {
      if (req.url === '/api/ide/connect/exchange') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"token":"rollback-token","organization_id":"org-rollback"}');
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end('{"ok":false}');
      }
    });
    try {
      const result = await runInstallAsync(stateDir, codexHome, [
        `--api-base-url=http://127.0.0.1:${server.port}`,
        '--connect-code=ROLLBACK-CODE',
      ]);
      assert.strictEqual(result.status, 1);
      assert.strictEqual(fs.readFileSync(hooksPath, 'utf8'), originalHooks);
      assert(!fs.existsSync(path.join(stateDir, 'config.json')));
      assert(!fs.readdirSync(codexHome).some((file) => file.includes('.backup-')));
    } finally {
      await server.close();
    }
  });

  console.log(`\n${passed} Codex bridge tests passed`);
}

main().catch(() => {
  try { fs.rmSync(testRoot, { recursive: true, force: true }); } catch {}
  process.exit(1);
}).then(() => {
  try { fs.rmSync(testRoot, { recursive: true, force: true }); } catch {}
});
