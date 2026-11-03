/**
 * P0-G Part C & E: Durable telemetry queue and auth state tests.
 *
 * Tests that:
 * - The durable queue persists events to disk and reloads them on restart
 * - Events leave the queue ONLY after confirmed server acceptance
 * - Auth state transitions are persistent and distinct (CONNECTED, AUTH_REQUIRED, AUTHORIZATION_DENIED)
 * - 401/403 does NOT drop the queued batch
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We need to mock vscode before importing modules that depend on it
const mockGlobalState: Map<string, any> = new Map();
const mockSecrets: Map<string, string> = new Map();

const mockVscode = {
  ExtensionContext: class {
    globalState = {
      get: (key: string) => mockGlobalState.get(key),
      update: async (key: string, value: any) => { mockGlobalState.set(key, value); },
    };
    secrets = {
      get: async (key: string) => mockSecrets.get(key) ?? undefined,
      store: async (key: string, value: string) => { mockSecrets.set(key, value); },
    };
    globalStorageUri = { fsPath: path.join(os.tmpdir(), `cm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`) };
    subscriptions: any[] = [];
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  StatusBarItem: class {
    text = '';
    tooltip = '';
    command: string | undefined;
    backgroundColor: any;
    color: any;
    show() {}
    hide() {}
    dispose() {}
  },
  ThemeColor: class {
    constructor(public id: string) {}
  },
  window: {
    createStatusBarItem: () => new (mockVscode.StatusBarItem as any)(),
  },
};

// Set up module mock
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id: string) {
  if (id === 'vscode') return mockVscode;
  return originalRequire.apply(this, arguments);
};

import { DurableTelemetryQueue } from '../src/durableQueue';
import { AuthStateManager } from '../src/authState';

// Restore require
Module.prototype.require = originalRequire;

describe('DurableTelemetryQueue', () => {
  let tmpDir: string;
  let context: any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-queue-test-'));
    context = {
      globalStorageUri: { fsPath: tmpDir },
    };
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore
    }
  });

  it('should start empty', () => {
    const queue = new DurableTelemetryQueue(context);
    queue.load();
    assert.strictEqual(queue.length(), 0);
    assert.strictEqual(queue.isEmpty(), true);
  });

  it('should persist events to disk and reload them', () => {
    const queue1 = new DurableTelemetryQueue(context);
    queue1.load();
    queue1.enqueue({ event_type: 'file_edit', count: 1, timestamp: new Date().toISOString(), metadata: { event_id: 'evt_1' } });
    queue1.enqueue({ event_type: 'file_edit', count: 2, timestamp: new Date().toISOString(), metadata: { event_id: 'evt_2' } });
    assert.strictEqual(queue1.length(), 2);

    // Create a new queue instance (simulates restart)
    const queue2 = new DurableTelemetryQueue(context);
    queue2.load();
    assert.strictEqual(queue2.length(), 2);
    const events = queue2.toArray();
    assert.strictEqual(events[0].metadata?.event_id, 'evt_1');
    assert.strictEqual(events[1].metadata?.event_id, 'evt_2');
  });

  it('should remove accepted events only after server acceptance', () => {
    const queue = new DurableTelemetryQueue(context);
    queue.load();
    queue.enqueue({ event_type: 'file_edit', count: 1, timestamp: new Date().toISOString(), metadata: { event_id: 'evt_1' } });
    queue.enqueue({ event_type: 'file_edit', count: 2, timestamp: new Date().toISOString(), metadata: { event_id: 'evt_2' } });
    queue.enqueue({ event_type: 'file_edit', count: 3, timestamp: new Date().toISOString(), metadata: { event_id: 'evt_3' } });

    // Snapshot for sending
    const batch = queue.snapshot();
    assert.strictEqual(batch.length, 3);

    // Queue should still have all events (snapshot doesn't remove)
    assert.strictEqual(queue.length(), 3);

    // Server accepts — remove accepted
    queue.removeAccepted(3);
    assert.strictEqual(queue.length(), 0);
  });

  it('should retain events on 401 (snapshot does not remove)', () => {
    const queue = new DurableTelemetryQueue(context);
    queue.load();
    queue.enqueue({ event_type: 'file_edit', count: 1, timestamp: new Date().toISOString(), metadata: { event_id: 'evt_1' } });

    // Snapshot for sending
    const batch = queue.snapshot();
    assert.strictEqual(batch.length, 1);

    // Simulate 401 — do NOT removeAccepted
    // Queue should still have the event
    assert.strictEqual(queue.length(), 1);
  });

  it('should enforce max queue size', () => {
    const queue = new DurableTelemetryQueue(context);
    queue.load();
    for (let i = 0; i < 5005; i++) {
      queue.enqueue({ event_type: 'file_edit', count: 1, timestamp: new Date().toISOString(), metadata: { event_id: `evt_${i}` } });
    }
    assert.strictEqual(queue.length(), 5000);
    // Oldest events should be dropped
    const events = queue.toArray();
    assert.strictEqual(events[0].metadata?.event_id, 'evt_5');
  });

  it('should handle corrupt queue file gracefully', () => {
    const queuePath = path.join(tmpDir, 'pending-telemetry-v1.json');
    fs.writeFileSync(queuePath, 'not valid json {{{', 'utf-8');

    const queue = new DurableTelemetryQueue(context);
    queue.load();
    assert.strictEqual(queue.length(), 0);
  });

  it('should clear the queue', () => {
    const queue = new DurableTelemetryQueue(context);
    queue.load();
    queue.enqueue({ event_type: 'file_edit', count: 1, timestamp: new Date().toISOString(), metadata: { event_id: 'evt_1' } });
    assert.strictEqual(queue.length(), 1);
    queue.clear();
    assert.strictEqual(queue.length(), 0);
  });
});

describe('AuthStateManager', () => {
  let context: any;

  beforeEach(() => {
    mockGlobalState.clear();
    context = new (mockVscode.ExtensionContext as any)();
  });

  it('should default to AUTH_REQUIRED when no state is stored', () => {
    const manager = new AuthStateManager(context);
    assert.strictEqual(manager.getState(), 'AUTH_REQUIRED');
    assert.strictEqual(manager.isConnected(), false);
    assert.strictEqual(manager.isAuthRequired(), true);
  });

  it('should persist CONNECTED state', () => {
    const manager = new AuthStateManager(context);
    manager.setState('CONNECTED');
    assert.strictEqual(manager.isConnected(), true);

    // Create new manager (simulates restart)
    const manager2 = new AuthStateManager(context);
    assert.strictEqual(manager2.getState(), 'CONNECTED');
    assert.strictEqual(manager2.isConnected(), true);
  });

  it('should persist AUTH_REQUIRED state', () => {
    const manager = new AuthStateManager(context);
    manager.setState('AUTH_REQUIRED');
    assert.strictEqual(manager.isAuthRequired(), true);
    assert.strictEqual(manager.isConnected(), false);

    const manager2 = new AuthStateManager(context);
    assert.strictEqual(manager2.getState(), 'AUTH_REQUIRED');
  });

  it('should persist AUTHORIZATION_DENIED state distinctly from AUTH_REQUIRED', () => {
    const manager = new AuthStateManager(context);
    manager.setState('AUTHORIZATION_DENIED');
    assert.strictEqual(manager.isAuthorizationDenied(), true);
    assert.strictEqual(manager.isAuthRequired(), false);
    assert.strictEqual(manager.isConnected(), false);

    const manager2 = new AuthStateManager(context);
    assert.strictEqual(manager2.getState(), 'AUTHORIZATION_DENIED');
  });

  it('should throttle renewal attempts (5-minute minimum)', () => {
    const manager = new AuthStateManager(context);
    assert.strictEqual(manager.isRenewalAllowed(), true);
    manager.recordRenewalAttempt();
    assert.strictEqual(manager.isRenewalAllowed(), false);
  });

  it('should update status bar text based on state', () => {
    const manager = new AuthStateManager(context);
    const item: any = new (mockVscode.StatusBarItem as any)();
    manager.setStatusBar(item);

    manager.setState('CONNECTED');
    assert.ok(item.text.includes('Connected'));

    manager.setState('AUTH_REQUIRED');
    assert.ok(item.text.includes('Reconnect'));

    manager.setState('AUTHORIZATION_DENIED');
    assert.ok(item.text.includes('Access denied'));
  });
});
