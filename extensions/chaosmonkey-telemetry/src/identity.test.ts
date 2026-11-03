import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  initializeIdentity,
  buildIdentityMetadata,
  buildIdentityPayloadFields,
  setBackendClaimedIdentity,
  resetCachedIdentity,
} from './identity';

interface FakeMemento {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): Promise<void>;
  keys(): string[];
}

class InMemoryMemento implements FakeMemento {
  private store = new Map<string, unknown>();

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }

  keys(): string[] {
    return Array.from(this.store.keys());
  }
}

class InMemorySecrets {
  private vault = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.vault.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.vault.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.vault.delete(key);
  }
}

function buildContext() {
  return {
    globalState: new InMemoryMemento() as unknown as any,
    secrets: new InMemorySecrets() as unknown as any,
  };
}

describe('identity', () => {
  it('initializes with a generated installation_id and null pre-connect developer/team', async () => {
    resetCachedIdentity();
    const context = buildContext();
    const identity = await initializeIdentity(context as any);

    assert.strictEqual(typeof identity.installation_id, 'string');
    assert.strictEqual(identity.developer_id, null);
    assert.strictEqual(identity.team_id, null);
    assert.strictEqual(identity.identity_source, 'generated_installation');
    assert.strictEqual(identity.identity_schema_version, 1);
  });

  it('builds safe metadata and payload with no PII before or after backend claim', async () => {
    resetCachedIdentity();
    const context = buildContext();
    await initializeIdentity(context as any);

    const preConnectMeta = buildIdentityMetadata();
    assert.strictEqual(preConnectMeta.developer_id, null);
    assert.strictEqual(preConnectMeta.team_id, null);
    assert.strictEqual(preConnectMeta.identity_source, 'generated_installation');

    setBackendClaimedIdentity({
      developer_id: 'invite:42',
      team_id: 'team-1',
      organization_id: 2,
      identity_source: 'backend_claimed',
    });

    const payload = buildIdentityPayloadFields();
    const payloadKeys = Object.keys(payload);
    assert.ok(!payloadKeys.includes('display_name'), 'payload must not leak display_name');
    assert.ok(!payloadKeys.includes('email'), 'payload must not leak email');
    assert.ok(!payloadKeys.includes('organization_id'), 'payload must not leak organization_id');
    assert.ok(!payloadKeys.includes('extensionPath'), 'payload must not contain extensionPath');
    assert.ok(!payloadKeys.includes('workspace_folders'), 'payload must not contain workspace_folders');
    assert.ok(payloadKeys.includes('installation_id'));
    assert.ok(payloadKeys.includes('developer_id'));
    assert.ok(payloadKeys.includes('team_id'));
    assert.ok(payloadKeys.includes('identity_schema_version'));
    assert.strictEqual(payload.developer_id, 'invite:42');
    assert.strictEqual(payload.team_id, 'team-1');

    const eventMeta = buildIdentityMetadata();
    assert.strictEqual(eventMeta.identity_source, 'backend_claimed');
    assert.strictEqual(eventMeta.developer_id, 'invite:42');
  });
});
