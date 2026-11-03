/**
 * ============================================================================
 * CHAOSMONKEY IDENTITY CONTRACT — v1
 * ============================================================================
 *
 * Establishes stable, privacy-aware identity for telemetry attribution.
 *
 * Identity layers (distinct, never conflated):
 *   1. session_id      — ephemeral per-session (existing, unchanged)
 *   2. installation_id — stable per extension install (new, UUID v4)
 *   3. developer_id    — optional, explicitly configured or backend-issued
 *   4. team_id         — optional, explicitly configured or backend-mapped
 *
 * Privacy rules:
 *   - No names, emails, usernames, or Git identities are collected.
 *   - installation_id is a random UUID, not a human identifier.
 *   - developer_id and team_id are null unless explicitly configured.
 *   - Missing mappings remain null, never fabricated.
 *   - The raw installation_id is never written to logs.
 *
 * ============================================================================
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';

/** Identity schema version — increment when the contract changes */
export const IDENTITY_SCHEMA_VERSION = 1;

/** Storage key for persistent installation ID */
const INSTALLATION_ID_KEY = 'chaosmonkey.installation_id';

/**
 * Identity source classification:
 * - generated_installation: installation_id was generated locally (no developer mapping)
 * - configured_developer:    developer_id was explicitly set in extension settings
 * - backend_claimed:         developer_id was issued by the backend (future)
 * - legacy_unknown:          no identity fields present (old extension versions or persistence failure)
 * - persistence_failed:      installation_id was generated but could not be persisted
 */
export type IdentitySource =
  | 'generated_installation'
  | 'configured_developer'
  | 'backend_claimed'
  | 'legacy_unknown'
  | 'persistence_failed';

/**
 * The full identity contract emitted with every telemetry event.
 */
export interface IdentityContract {
  identity_schema_version: number;
  installation_id: string | null;
  developer_id: string | null;
  team_id: string | null;
  identity_source: IdentitySource;
}

/**
 * Cached identity contract — generated once per activation.
 */
let cachedIdentity: IdentityContract | null = null;

/**
 * Generate a cryptographically secure UUID v4.
 *
 * Uses Node.js crypto.randomUUID() when available (Node >= 14.17),
 * falls back to crypto.randomBytes for older runtimes.
 */
function generateUUIDv4(): string {
  try {
    return crypto.randomUUID();
  } catch {
    const bytes = crypto.randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

// 0.4.0: developer_id and team_id are backend-issued only.
// Machine-scoped config for these fields was removed.

/**
 * Initialize the identity contract for this extension installation.
 *
 * ASYNC: Must be awaited by the caller before any telemetry events are built.
 *
 * Behavior:
 * - Generates a new installation_id on first activation.
 * - Persists it via context.globalState.update() (awaited).
 * - If persistence fails, sets identity_source to 'persistence_failed'
 *   and continues with an explicit unavailable state (no silent rotation).
 * - Reads optional developer_id and team_id from machine-scoped settings.
 * - Never logs the raw installation_id value.
 *
 * @param context VS Code extension context (for globalState persistence)
 * @returns The initialized identity contract
 */
export async function initializeIdentity(context: vscode.ExtensionContext): Promise<IdentityContract> {
  // 1. Resolve or generate installation_id
  let installationId = context.globalState.get<string>(INSTALLATION_ID_KEY);
  let persistenceFailed = false;

  if (!installationId) {
    installationId = generateUUIDv4();

    // Await persistence — do not fire-and-forget
    try {
      await context.globalState.update(INSTALLATION_ID_KEY, installationId);
    } catch (err) {
      // Persistence failed — do not silently rotate identifiers
      // Continue with an explicit unavailable/legacy state
      console.error('[ChaosMonkey][identity] Failed to persist installation_id:', err instanceof Error ? err.message : String(err));
      persistenceFailed = true;
      // Keep the generated ID in memory for this session but mark as failed
      // so downstream code knows it may not survive a restart
    }

    // Allowed: generic confirmation without the raw UUID
    if (!persistenceFailed) {
      console.log('[ChaosMonkey][identity] Stable installation identity initialized');
    } else {
      console.log('[ChaosMonkey][identity] Installation identity generated but persistence failed — using ephemeral identity for this session');
    }
  } else {
    // Reusing existing — do not log the raw value
    console.log('[ChaosMonkey][identity] Stable installation identity initialized');
  }

  // 2. Pre-connect developer_id and team_id are always null.
  //    Backend-issued values are applied via setBackendClaimedIdentity() after Connect.
  const developerId: string | null = null;
  const teamId: string | null = null;

  // 3. Determine identity source
  let identitySource: IdentitySource;
  if (persistenceFailed) {
    identitySource = 'persistence_failed';
  } else {
    identitySource = 'generated_installation';
  }

  cachedIdentity = {
    identity_schema_version: persistenceFailed ? 0 : IDENTITY_SCHEMA_VERSION,
    installation_id: persistenceFailed ? null : installationId,
    developer_id: developerId,
    team_id: teamId,
    identity_source: identitySource,
  };

  // Log only metadata about the identity, never the raw installation_id
  console.log('[ChaosMonkey][identity] Identity contract ready:', {
    schema_version: cachedIdentity.identity_schema_version,
    has_installation_id: cachedIdentity.installation_id !== null,
    has_developer_id: cachedIdentity.developer_id !== null,
    has_team_id: cachedIdentity.team_id !== null,
    identity_source: cachedIdentity.identity_source,
  });

  return cachedIdentity;
}

/**
 * Get the cached identity contract.
 * Returns null if identity has not been initialized.
 */
export function getIdentity(): IdentityContract | null {
  return cachedIdentity;
}

/**
 * Reset cached identity state. Intended for test cleanup only.
 */
export function resetCachedIdentity(): void {
  cachedIdentity = null;
}

/**
 * Build identity fields for inclusion in telemetry event metadata.
 *
 * Returns a flat object suitable for merging into the existing metadata dict.
 * Fields with null values are included as null (not omitted) so the backend
 * can distinguish "not set" from "not present in schema".
 */
export function buildIdentityMetadata(): Record<string, unknown> {
  if (!cachedIdentity) {
    return {
      identity_schema_version: 0,
      installation_id: null,
      developer_id: null,
      team_id: null,
      identity_source: 'legacy_unknown' as IdentitySource,
    };
  }

  return {
    identity_schema_version: cachedIdentity.identity_schema_version,
    installation_id: cachedIdentity.installation_id,
    developer_id: cachedIdentity.developer_id,
    team_id: cachedIdentity.team_id,
    identity_source: cachedIdentity.identity_source,
  };
}

/**
 * Build identity fields for the top-level telemetry batch payload.
 *
 * These are included alongside the existing `user_id` field so the backend
 * can correlate installations without conflating them with human identity.
 */
export function buildIdentityPayloadFields(): Record<string, unknown> {
  if (!cachedIdentity) {
    return {
      installation_id: null,
      developer_id: null,
      team_id: null,
      identity_schema_version: 0,
    };
  }

  return {
    installation_id: cachedIdentity.installation_id,
    developer_id: cachedIdentity.developer_id,
    team_id: cachedIdentity.team_id,
    identity_schema_version: cachedIdentity.identity_schema_version,
  };
}

/**
 * Update the cached identity with backend-claimed fields after a successful
 * connect-code exchange. The installation_id is preserved from local generation;
 * developer_id, team_id, and identity_source come from the backend response.
 */
export interface BackendClaimedIdentity {
  developer_id: string;
  team_id: string | null;
  organization_id: number | null;
  identity_source: 'backend_claimed';
}

export function setBackendClaimedIdentity(fields: BackendClaimedIdentity): void {
  if (!cachedIdentity) {
    console.warn('[ChaosMonkey][identity] Cannot set backend identity — identity not initialized');
    return;
  }

  cachedIdentity = {
    ...cachedIdentity,
    developer_id: fields.developer_id,
    team_id: fields.team_id,
    identity_source: 'backend_claimed',
  };

  // The non-secret profile is persisted in extension.ts via context.globalState.

  console.log('[ChaosMonkey][identity] Identity updated to backend_claimed:', {
    has_developer_id: cachedIdentity.developer_id !== null,
    has_team_id: cachedIdentity.team_id !== null,
    identity_source: cachedIdentity.identity_source,
  });
}

/**
 * Check whether the extension has a valid bearer token (connected state).
 */
export async function hasBearerToken(context: vscode.ExtensionContext): Promise<boolean> {
  const token = await context.secrets.get('chaosmonkey.authToken');
  return !!token;
}

/**
 * Get the bearer token from SecretStorage.
 */
export async function getBearerToken(context: vscode.ExtensionContext): Promise<string | null> {
  const token = await context.secrets.get('chaosmonkey.authToken');
  return token ?? null;
}
