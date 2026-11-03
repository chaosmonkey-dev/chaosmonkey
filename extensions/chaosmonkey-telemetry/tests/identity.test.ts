/**
 * ============================================================================
 * CHAOSMONKEY IDENTITY CONTRACT — TEST SUITE (15 tests)
 * ============================================================================
 *
 * Tests the identity contract module directly, including async initialization,
 * persistence, failure handling, privacy, and backward compatibility.
 *
 * Run: npx ts-node tests/identity.test.ts
 * ============================================================================
 */

import * as crypto from 'crypto';

// ─── Mock vscode module ───────────────────────────────────────────────────

const mockGlobalState = new Map<string, any>();

class MockExtensionContext {
  globalState = {
    get: (key: string) => mockGlobalState.get(key),
    update: async (key: string, value: any) => {
      mockGlobalState.set(key, value);
    },
  };
}

let mockConfigValues: Record<string, string | undefined> = {
  'chaosmonkey.developerId': undefined,
  'chaosmonkey.teamId': undefined,
};

let mockPersistenceShouldFail = false;

const mockVscode = {
  ExtensionContext: MockExtensionContext,
  workspace: {
    getConfiguration: () => ({
      inspect: (key: string) => ({
        key,
        globalValue: mockConfigValues[key],
        defaultValue: '',
      }),
      get: (key: string, defaultValue?: any) => mockConfigValues[key] ?? defaultValue,
    }),
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
  },
  version: '1.85.0',
  env: {
    appName: 'Visual Studio Code',
    uriScheme: 'vscode',
  },
  extensions: {
    getExtension: () => ({ packageJSON: { version: '0.4.0' } }),
  },
  window: {
    createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
    showInformationMessage: () => {},
  },
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
  },
  Disposable: class { dispose() {} },
};

// Apply mock for vscode import
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === 'vscode') return mockVscode;
  return originalRequire.apply(this, arguments);
};

// ─── Test framework ───────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(message);
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertEqual(actual: any, expected: any, message: string): void {
  const equal = JSON.stringify(actual) === JSON.stringify(expected);
  assert(equal, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

function assertNull(value: any, message: string): void {
  assert(value === null, `${message} (expected null, got ${JSON.stringify(value)})`);
}

function assertNotNull(value: any, message: string): void {
  assert(value !== null && value !== undefined, `${message} (expected non-null, got ${JSON.stringify(value)})`);
}

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resetTestState(): void {
  mockGlobalState.clear();
  mockConfigValues = { 'chaosmonkey.developerId': undefined, 'chaosmonkey.teamId': undefined };
  mockPersistenceShouldFail = false;
}

// ─── Import identity module after mocks are set up ─────────────────────────

const {
  initializeIdentity,
  buildIdentityMetadata,
  buildIdentityPayloadFields,
  getIdentity,
  IDENTITY_SCHEMA_VERSION,
  resetCachedIdentity,
} = require('../src/identity');

// ─── Capture console.log to verify no raw UUID is leaked ──────────────────

let consoleLogCapture: string[] = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

function startLogCapture(): void {
  consoleLogCapture = [];
  console.log = (...args: any[]) => {
    consoleLogCapture.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
  };
}

function stopLogCapture(): void {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
}

function getCapturedLogs(): string[] {
  return consoleLogCapture;
}

// ─── TESTS ────────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log('\n========================================');
  console.log('ChaosMonkey Identity Contract — Test Suite');
  console.log('========================================\n');

  // TEST 1: First activation generates a UUID
  console.log('Test 1: First activation generates a UUID');
  {
    resetTestState();
    resetCachedIdentity();
    const ctx = new MockExtensionContext();
    const identity = await initializeIdentity(ctx as any);
    assertNotNull(identity.installation_id, 'installation_id should be non-null after first activation');
    assert(UUID_V4_REGEX.test(identity.installation_id!), 'installation_id should be a valid UUID v4');
  }

  // TEST 2: Persistence is awaited
  console.log('Test 2: Persistence is awaited');
  {
    resetTestState();
    resetCachedIdentity();
    let updateCalled = false;
    let updateResolved = false;

    const ctx = new MockExtensionContext();
    // Override update to track async behavior
    const originalUpdate = ctx.globalState.update;
    ctx.globalState.update = async (key: string, value: any) => {
      updateCalled = true;
      // Simulate async storage delay
      await new Promise(resolve => setTimeout(resolve, 10));
      updateResolved = true;
      mockGlobalState.set(key, value);
    };

    await initializeIdentity(ctx as any);
    assert(updateCalled, 'globalState.update should have been called');
    assert(updateResolved, 'globalState.update should have resolved before initializeIdentity returned');
  }

  // TEST 3: Restart reuses the UUID
  console.log('Test 3: Restart reuses the UUID');
  {
    resetTestState();
    resetCachedIdentity();
    const ctx1 = new MockExtensionContext();
    const identity1 = await initializeIdentity(ctx1 as any);
    const id1 = identity1.installation_id;

    // Simulate restart — same globalState persists
    resetCachedIdentity();
    const ctx2 = new MockExtensionContext();
    const identity2 = await initializeIdentity(ctx2 as any);
    assertEqual(identity2.installation_id, id1, 'installation_id should be identical across restarts');
  }

  // TEST 4: Extension upgrade reuses the UUID
  console.log('Test 4: Extension upgrade reuses the UUID');
  {
    resetTestState();
    resetCachedIdentity();
    const ctx1 = new MockExtensionContext();
    const identity1 = await initializeIdentity(ctx1 as any);
    const id1 = identity1.installation_id;

    // Simulate upgrade — same globalState, new context
    resetCachedIdentity();
    const ctx2 = new MockExtensionContext();
    const identity2 = await initializeIdentity(ctx2 as any);
    assertEqual(identity2.installation_id, id1, 'installation_id should survive extension upgrade');
  }

  // TEST 5: Two independent global-state stores generate different UUIDs
  console.log('Test 5: Two independent global-state stores generate different UUIDs');
  {
    resetTestState();
    resetCachedIdentity();
    const ctx1 = new MockExtensionContext();
    const id1 = (await initializeIdentity(ctx1 as any)).installation_id;

    // Completely separate state (different machine)
    const savedState = new Map(mockGlobalState);
    mockGlobalState.clear();
    resetCachedIdentity();

    const ctx2 = new MockExtensionContext();
    const id2 = (await initializeIdentity(ctx2 as any)).installation_id;

    assert(id1 !== id2, 'Two independent installations should have different UUIDs');

    // Restore for cleanup
    mockGlobalState.clear();
    for (const [k, v] of savedState) mockGlobalState.set(k, v);
  }

  // TEST 6: developer_id defaults null
  console.log('Test 6: developer_id defaults null');
  {
    resetTestState();
    resetCachedIdentity();
    mockConfigValues['chaosmonkey.developerId'] = undefined;
    const ctx = new MockExtensionContext();
    const identity = await initializeIdentity(ctx as any);
    assertNull(identity.developer_id, 'developer_id should be null when not configured');
  }

  // TEST 7: team_id defaults null
  console.log('Test 7: team_id defaults null');
  {
    resetTestState();
    resetCachedIdentity();
    mockConfigValues['chaosmonkey.teamId'] = undefined;
    const ctx = new MockExtensionContext();
    const identity = await initializeIdentity(ctx as any);
    assertNull(identity.team_id, 'team_id should be null when not configured');
  }

  // TEST 8: developer_id is null pre-connect (0.4.0+ contract)
  // SUPERSEDED: The pre-0.4.0 contract allowed machine-scoped config for
  // developer_id (chaosmonkey.developerId setting). The 0.4.0 identity contract
  // removed this — developer_id is now backend-issued only, applied via
  // setBackendClaimedIdentity() after invite-backed enrollment/Connect.
  // Source: identity.ts:82-83 — "0.4.0: developer_id and team_id are
  // backend-issued only. Machine-scoped config for these fields was removed."
  // Source: identity.ts:132-135 — "Pre-connect developer_id and team_id are
  // always null. Backend-issued values are applied via setBackendClaimedIdentity()
  // after Connect."
  // The old Test 8 expected developer_id='dev_abc123' from config — that
  // contract is superseded. The current contract requires null pre-connect.
  console.log('Test 8: developer_id is null pre-connect (0.4.0+ contract supersedes machine-scoped config)');
  {
    resetTestState();
    resetCachedIdentity();
    // Even if a stale machine-scoped config value exists, the 0.4.0+ contract
    // must NOT read it — developer_id is backend-issued only.
    mockConfigValues['chaosmonkey.developerId'] = 'dev_abc123';
    const ctx = new MockExtensionContext();
    const identity = await initializeIdentity(ctx as any);
    assertNull(identity.developer_id, 'developer_id must be null pre-connect (0.4.0+ backend-issued only, not machine-scoped config)');
    assertEqual(identity.identity_source, 'generated_installation', 'identity_source must be generated_installation (not configured_developer — that source was removed in 0.4.0)');
  }

  // TEST 9: team_id is null pre-connect (0.4.0+ contract)
  // SUPERSEDED: Same as Test 8 — team_id was machine-scoped pre-0.4.0,
  // now backend-issued only. The old Test 9 expected team_id='team_alpha'
  // from config — that contract is superseded.
  console.log('Test 9: team_id is null pre-connect (0.4.0+ contract supersedes machine-scoped config)');
  {
    resetTestState();
    resetCachedIdentity();
    mockConfigValues['chaosmonkey.teamId'] = 'team_alpha';
    const ctx = new MockExtensionContext();
    const identity = await initializeIdentity(ctx as any);
    assertNull(identity.team_id, 'team_id must be null pre-connect (0.4.0+ backend-issued only, not machine-scoped config)');
  }

  // TEST 10: No email/name/Git username is inferred
  console.log('Test 10: No email/name/Git username is inferred');
  {
    resetTestState();
    resetCachedIdentity();
    mockConfigValues['chaosmonkey.developerId'] = 'dev_pseudonymous_123';
    mockConfigValues['chaosmonkey.teamId'] = 'team_alpha';
    const ctx = new MockExtensionContext();
    const identity = await initializeIdentity(ctx as any);

    const allValues = JSON.stringify(identity).toLowerCase();
    assert(!allValues.includes('email'), 'No email-like strings in identity');
    assert(!allValues.includes('@'), 'No @ symbol in identity');
    assert(!allValues.includes('username'), 'No "username" in identity values');
    assert(UUID_V4_REGEX.test(identity.installation_id!), 'installation_id should be a UUID, not PII');
  }

  // TEST 11: Raw UUID is not written to logs
  console.log('Test 11: Raw UUID is not written to logs');
  {
    resetTestState();
    resetCachedIdentity();
    const ctx = new MockExtensionContext();
    startLogCapture();
    const identity = await initializeIdentity(ctx as any);
    stopLogCapture();

    const logs = getCapturedLogs();
    const allLogText = logs.join('\n');
    const rawUuid = identity.installation_id!;

    assert(!allLogText.includes(rawUuid), 'Raw installation_id UUID must not appear in console logs');
    assert(allLogText.includes('Stable installation identity initialized'), 'Log should say "Stable installation identity initialized"');
  }

  // TEST 12: Every telemetry event includes identity metadata
  console.log('Test 12: Every telemetry event includes identity metadata');
  {
    resetTestState();
    resetCachedIdentity();
    const ctx = new MockExtensionContext();
    await initializeIdentity(ctx as any);
    const metadata = buildIdentityMetadata();

    assert('identity_schema_version' in metadata, 'Event metadata must include identity_schema_version');
    assert('installation_id' in metadata, 'Event metadata must include installation_id');
    assert('developer_id' in metadata, 'Event metadata must include developer_id');
    assert('team_id' in metadata, 'Event metadata must include team_id');
    assert('identity_source' in metadata, 'Event metadata must include identity_source');
    assertEqual(metadata.identity_schema_version, 1, 'Event metadata schema version should be 1');
  }

  // TEST 13: Every batch includes identity fields
  console.log('Test 13: Every batch includes identity fields');
  {
    resetTestState();
    resetCachedIdentity();
    const ctx = new MockExtensionContext();
    await initializeIdentity(ctx as any);
    const payloadFields = buildIdentityPayloadFields();

    assert('installation_id' in payloadFields, 'Batch payload must include installation_id');
    assert('developer_id' in payloadFields, 'Batch payload must include developer_id');
    assert('team_id' in payloadFields, 'Batch payload must include team_id');
    assert('identity_schema_version' in payloadFields, 'Batch payload must include identity_schema_version');
    assertNotNull(payloadFields.installation_id, 'Batch payload installation_id should be non-null after init');
  }

  // TEST 14: Existing 0.3.9 payload fields remain intact
  console.log('Test 14: Existing 0.3.9 payload fields remain intact');
  {
    resetTestState();
    resetCachedIdentity();
    const ctx = new MockExtensionContext();
    await initializeIdentity(ctx as any);
    const identityFields = buildIdentityPayloadFields();
    const metadataFields = buildIdentityMetadata();

    // The identity module must not remove or alter existing fields
    // It only adds new fields — existing source, editor_source, user_id, events, session_id etc.
    // are untouched by the identity module
    assert(!('source' in identityFields), 'Identity payload fields must not include source (separate concern)');
    assert(!('editor_source' in identityFields), 'Identity payload fields must not include editor_source (separate concern)');
    assert(!('user_id' in identityFields), 'Identity payload fields must not include user_id (separate concern)');
    assert(!('events' in identityFields), 'Identity payload fields must not include events (separate concern)');
    assert(!('source' in metadataFields), 'Identity metadata must not include source (separate concern)');
    assert(!('session_id' in metadataFields), 'Identity metadata must not include session_id (separate concern)');
  }

  // TEST 15: Failed persistence produces an explicit unavailable/legacy state
  console.log('Test 15: Failed persistence produces an explicit unavailable/legacy state');
  {
    resetTestState();
    resetCachedIdentity();
    mockPersistenceShouldFail = true;

    const ctx = new MockExtensionContext();
    // Override update to simulate failure
    ctx.globalState.update = async () => {
      throw new Error('Storage unavailable');
    };

    const identity = await initializeIdentity(ctx as any);

    assertEqual(identity.identity_source, 'persistence_failed', 'identity_source should be persistence_failed on storage error');
    assertEqual(identity.identity_schema_version, 0, 'schema_version should be 0 on persistence failure');
    assertNull(identity.installation_id, 'installation_id should be null on persistence failure');
    // developer_id and team_id can still be read from config
    // but installation identity is unavailable

    // Verify buildIdentityMetadata reflects the failed state
    const metadata = buildIdentityMetadata();
    assertEqual(metadata.identity_source, 'persistence_failed', 'metadata should reflect persistence_failed');
    assertNull(metadata.installation_id, 'metadata installation_id should be null on failure');
  }

  // =====================================================================
  // PRODUCTION-PATH TEST: Session event identity via buildIdentityMetadata()
  // =====================================================================
  // This test calls the exact same helper consumed by both:
  //   - buildEventMetadata() (ordinary events)
  //   - endSession() (session summary events)
  // It proves that the session-event production path includes identity fields
  // without requiring a full VS Code runtime.
  // =====================================================================

  console.log('Test 16 (production-path): Session metadata includes all identity fields');
  {
    resetTestState();
    resetCachedIdentity();
    const ctx = new MockExtensionContext();
    await initializeIdentity(ctx as any);

    // Simulate what endSession() does: build sessionMetadata with ...buildIdentityMetadata()
    const identityFields = buildIdentityMetadata();
    const sessionMetadata: Record<string, unknown> = {
      source: 'vscode',
      extension_version: '0.4.0',
      segment_type: 'session',
      session_id: 'session_test_123',
      end_reason: 'idle',
      ...identityFields,
    };

    // Prove all identity fields are present in session metadata
    assert('identity_schema_version' in sessionMetadata, 'Session metadata must include identity_schema_version');
    assert('installation_id' in sessionMetadata, 'Session metadata must include installation_id');
    assert('developer_id' in sessionMetadata, 'Session metadata must include developer_id');
    assert('team_id' in sessionMetadata, 'Session metadata must include team_id');
    assert('identity_source' in sessionMetadata, 'Session metadata must include identity_source');
    assertEqual(sessionMetadata.identity_schema_version, 1, 'Session metadata schema version should be 1');
    assertNotNull(sessionMetadata.installation_id, 'Session metadata installation_id should be non-null');
    assertNull(sessionMetadata.developer_id, 'Session metadata developer_id should be null when unconfigured');
    assertNull(sessionMetadata.team_id, 'Session metadata team_id should be null when unconfigured');
    assertEqual(sessionMetadata.identity_source, 'generated_installation', 'Session metadata identity_source should be generated_installation');
  }

  console.log('Test 17 (production-path): Ordinary event metadata includes same identity fields');
  {
    resetTestState();
    resetCachedIdentity();
    const ctx = new MockExtensionContext();
    await initializeIdentity(ctx as any);

    // Simulate what buildEventMetadata() does
    const identityFields = buildIdentityMetadata();
    const eventMetadata: Record<string, unknown> = {
      source: 'vscode',
      extension_version: '0.4.0',
      segment_type: 'event',
      session_id: 'session_test_456',
      ...identityFields,
    };

    // Prove identity fields match between session and event paths
    assert('identity_schema_version' in eventMetadata, 'Event metadata must include identity_schema_version');
    assert('installation_id' in eventMetadata, 'Event metadata must include installation_id');
    assert('developer_id' in eventMetadata, 'Event metadata must include developer_id');
    assert('team_id' in eventMetadata, 'Event metadata must include team_id');
    assert('identity_source' in eventMetadata, 'Event metadata must include identity_source');
  }

  console.log('Test 18 (production-path): session_id remains separate from identity fields');
  {
    resetTestState();
    resetCachedIdentity();
    const ctx = new MockExtensionContext();
    await initializeIdentity(ctx as any);

    const identityFields = buildIdentityMetadata();
    const sessionMetadata = {
      session_id: 'session_unique_789',
      ...identityFields,
    };

    // session_id must not be part of identity contract
    assert(!('session_id' in identityFields), 'Identity fields must NOT include session_id (separate concern)');
    assertEqual(sessionMetadata.session_id, 'session_unique_789', 'session_id must remain independent of identity');
  }

  console.log('Test 19 (production-path): source/editor identity remains unchanged');
  {
    resetTestState();
    resetCachedIdentity();
    const ctx = new MockExtensionContext();
    await initializeIdentity(ctx as any);

    const identityFields = buildIdentityMetadata();
    // Identity fields must not include source, editor_source, appName, uriScheme
    assert(!('source' in identityFields), 'Identity fields must NOT include source');
    assert(!('editor_source' in identityFields), 'Identity fields must NOT include editor_source');
    assert(!('appName' in identityFields), 'Identity fields must NOT include appName');
    assert(!('uriScheme' in identityFields), 'Identity fields must NOT include uriScheme');
  }

  console.log('Test 20 (production-path): persistence_failed emits schema 0 and null installation_id in session metadata');
  {
    resetTestState();
    resetCachedIdentity();
    const ctx = new MockExtensionContext();
    ctx.globalState.update = async () => { throw new Error('Storage unavailable'); };
    await initializeIdentity(ctx as any);

    const identityFields = buildIdentityMetadata();
    const sessionMetadata = {
      segment_type: 'session',
      session_id: 'session_failed_000',
      ...identityFields,
    };

    assertEqual(sessionMetadata.identity_schema_version, 0, 'Failed-persistence session should have schema version 0');
    assertNull(sessionMetadata.installation_id, 'Failed-persistence session should have null installation_id');
    assertEqual(sessionMetadata.identity_source, 'persistence_failed', 'Failed-persistence session should have persistence_failed source');
  }

  // ─── CR-X Day 2 X4: Upgrade identity-persistence proof (0.4.0 → 0.4.1) ───
  //
  // Source authority:
  //   docs/final/CR-X-PILOT-RELEASE-MANIFEST.md:68
  //     "upgrade_compatibility | 0.4.0 → 0.4.1 safe (no re-enrollment, identity preserved)"
  //   .devin/DEVIN_PROJECT_MEMORY.md:1161 (same claim)
  //
  // This test closes the documented but previously untested safety claim
  // that installation identity survives the 0.4.0 → 0.4.1 extension upgrade.
  // It uses an isolated mock fixture (MockExtensionContext with shared
  // globalState), NOT a customer environment. No destructive install test.
  //
  // Proves:
  //   1. installation_id generated under 0.4.0 persists into 0.4.1
  //   2. identity_schema_version remains unchanged across the upgrade
  //   3. identity_source remains 'generated_installation' (not reset)
  //   4. No new UUID is generated during the upgrade

  console.log('TEST X4: Upgrade identity-persistence 0.4.0 → 0.4.1');
  {
    resetTestState();
    resetCachedIdentity();

    // Simulate extension version 0.4.0
    mockVscode.extensions.getExtension = () => ({ packageJSON: { version: '0.4.0' } }) as any;

    // Initialize identity under 0.4.0
    const ctx040 = new MockExtensionContext();
    const identity040 = await initializeIdentity(ctx040 as any);
    const id040 = identity040.installation_id;
    const schema040 = identity040.identity_schema_version;
    const source040 = identity040.identity_source;

    assertNotNull(id040, '0.4.0 installation_id must be generated');
    assert(UUID_V4_REGEX.test(id040!), '0.4.0 installation_id must be a valid UUID v4');
    assertEqual(schema040, IDENTITY_SCHEMA_VERSION, '0.4.0 identity_schema_version must match current');
    assertEqual(source040, 'generated_installation', '0.4.0 identity_source must be generated_installation');

    // Simulate upgrade to 0.4.1 — same globalState persists, new context
    // (VS Code preserves globalState across extension updates)
    mockVscode.extensions.getExtension = () => ({ packageJSON: { version: '0.4.1' } }) as any;
    resetCachedIdentity();

    const ctx041 = new MockExtensionContext();
    const identity041 = await initializeIdentity(ctx041 as any);
    const id041 = identity041.installation_id;

    // PROOF 1: installation_id is identical across the upgrade
    assertEqual(id041, id040, 'installation_id must survive 0.4.0 → 0.4.1 upgrade (identity preserved)');

    // PROOF 2: identity_schema_version unchanged
    assertEqual(identity041.identity_schema_version, schema040, 'identity_schema_version must not change across 0.4.0 → 0.4.1 upgrade');

    // PROOF 3: identity_source remains generated_installation (not reset)
    assertEqual(identity041.identity_source, 'generated_installation', 'identity_source must remain generated_installation after upgrade');

    // PROOF 4: No new UUID was generated (same ID, not a fresh one)
    assertEqual(id041, id040, 'No new UUID should be generated during 0.4.0 → 0.4.1 upgrade');

    // PROOF 5: developer_id and team_id remain null (no re-enrollment)
    assertNull(identity041.developer_id, 'developer_id must remain null across upgrade (no re-enrollment)');
    assertNull(identity041.team_id, 'team_id must remain null across upgrade (no re-enrollment)');
  }

  // ─── RESULTS ─────────────────────────────────────────────────────────────

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  }
  console.log('========================================\n');

  // Restore original require
  Module.prototype.require = originalRequire;

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
