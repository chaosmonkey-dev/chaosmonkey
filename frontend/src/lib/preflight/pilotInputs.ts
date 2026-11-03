/**
 * CR-X Pilot Preflight Inputs — Dated Read-Only Evidence Fixture
 *
 * FIXTURE AUTHORITY: These inputs are a DATED READ-ONLY EVIDENCE FIXTURE
 * for exercising the generic harness. They are derived from VERIFIED LIVE
 * audit evidence in CR-X-STATUS.md (Phase 0R.1, 2026-08-30 UTC) and
 * CR-X-PILOT-RELEASE-MANIFEST.md.
 *
 * This file is NOT live pilot authority.
 * A production/promotion verdict must ultimately be populated from FRESH
 * runtime/release evidence, not from this fixture.
 *
 * No inference. Missing evidence is left as `undefined` → check returns UNKNOWN.
 *
 * DO NOT use these inputs as hardcoded global assumptions.
 * All populations are dynamic and must be re-verified at actual preflight time.
 */

import type { PilotPreflightInput } from './preflightSchema'

// ─── Ed (Priority Dispatch) ─────────────────────────────────────────────────
// Evidence: VERIFIED LIVE 2026-08-30 UTC via SSH + read-only SQLite/HTTP
// Source: CR-X-STATUS.md Pilot Delta Matrix
//
// NOTE: Tenant hostnames are intentionally omitted from this generic product
// source fixture. Real tenant hostnames belong only in dated evidence docs
// (CR-X-STATUS.md) and regression test fixtures with explicit provenance.
// Populate tenantIdentity.hostname/apiBaseUrl/dashboardLoginUrl from fresh
// runtime evidence at actual preflight time.

export const ED_PREFLIGHT_INPUT: PilotPreflightInput = {
  pilotId: 'ed',
  pilotName: 'Ed (Priority Dispatch)',

  releaseIdentity: {
    extensionVersion: '0.4.1',
    vsixFilename: 'chaosmonkey-telemetry-0.4.1.vsix',
    vsixSha256: 'b66fc8545fda619c68f9e502a7198307b00a897b991c07bb0f2b1c1291889a94',
    vsixSizeBytes: 51657,
    canonicalDownloadEndpoint: '/api/extension/download/latest',
    rollbackArtifact: 'pre-0.4.1 VSIX + git revert to a287c933',
    // localSourceCommit: not recorded in STATUS — UNKNOWN
  },

  tenantIdentity: {
    // hostname/apiBaseUrl/dashboardLoginUrl: populate from fresh runtime evidence.
    // Real tenant hostnames are NOT hardcoded in generic product source.
    hostname: undefined,
    httpsActive: true,
    apiBaseUrl: undefined,
    dashboardLoginUrl: undefined,
    // hasLocalhostInBuild: not checked — UNKNOWN
  },

  apiRuntime: {
    frontendStatus: 200,
    backendApiStatus: 200,
    canonicalTelemetryEndpoint: '/api/telemetry/canonical',
    canonicalPopulation: 2364, // VERIFIED LIVE — dynamic, re-verify at preflight
    workflowCount: 2, // vscode + claude_code (canonical)
    latestTelemetryTimestamp: '2026-08-30T01:19:00Z', // VERIFIED LIVE — re-verify
    hasSyntheticData: false,
    loadingDistinctFromEmpty: undefined, // no browser evidence
  },

  productSurfaces: {
    // No browser evidence for Ed PI/PBT usability
    aioiHydrates: undefined,
    piHydrates: undefined,
    pbtCardsHydrate: undefined,
    pbtTimeSeriesHydrates: undefined,
    sparseBehaviorPreserved: undefined,
    noFatalConsoleExceptions: undefined,
    insightsAccessible: undefined,
    diagnosticsSeparated: undefined,
    metricSwitchingWorks: undefined,
    timeFilteringWorks: undefined,
  },

  evidenceEligibility: {
    githubProvenanceGateActive: undefined, // GitHub connected but 0 PRs
    unsupportedGithubSuppressed: undefined,
    claudeCodeUnsupportedUnavailable: undefined,
    costContextGuarded: undefined,
    noFabricatedDeveloperIdentity: undefined,
    noUnsupportedCausalLanguage: undefined,
  },

  extensionEnrollment: {
    oneCanonicalVsix: true,
    downloadMatchesManifest: undefined, // not browser-verified
    enrollmentWorks: undefined, // 22 invites, 0 redeemed
    setupUsesHttpsApiBase: true,
    upgradeCompatibilityDocumented: true, // 0.4.0 → 0.4.1 safe
    legacyIngestionCompatible: true, // legacy telemetry flowing
    rolloutPreservesTelemetry: undefined, // not yet rolled out
  },

  securityOperations: {
    httpsActive: true,
    corsOriginSane: undefined,
    diskBelowThreshold: true, // OK
    backendProcessHealthy: true, // PM2 online 19D uptime
    frontendProcessHealthy: true, // PM2 online 20D uptime
    dbPreserved: true,
    tokenStatePreserved: undefined,
    rollbackExists: true,
    noDbReplacement: true,
    noCustomerSourceAsBuildAuthority: true,
  },
}

// ─── Kasey (Gloo) ───────────────────────────────────────────────────────────
// Evidence: VERIFIED LIVE 2026-08-30 UTC
// Status: YELLOW — editor telemetry exists but insufficient sustained population

export const KASEY_PREFLIGHT_INPUT: PilotPreflightInput = {
  pilotId: 'kasey',
  pilotName: 'Kasey (Gloo)',

  releaseIdentity: {
    extensionVersion: undefined, // UNKNOWN
    vsixFilename: undefined,
    vsixSha256: undefined,
    vsixSizeBytes: undefined,
    canonicalDownloadEndpoint: '/api/extension/download/latest',
    rollbackArtifact: undefined,
  },

  tenantIdentity: {
    hostname: undefined, // not recorded
    httpsActive: false, // HTTP only — VERIFIED
    apiBaseUrl: undefined, // HTTP only, not recorded
    dashboardLoginUrl: undefined,
    hasLocalhostInBuild: undefined,
  },

  apiRuntime: {
    frontendStatus: 200,
    backendApiStatus: 200,
    canonicalTelemetryEndpoint: '/api/telemetry/canonical',
    canonicalPopulation: undefined, // not queried with proper contract
    workflowCount: 1, // cursor 100%
    latestTelemetryTimestamp: '2026-08-27T21:10:00Z', // VERIFIED — 3 days stale at audit
    hasSyntheticData: false,
    loadingDistinctFromEmpty: undefined,
  },

  productSurfaces: {
    aioiHydrates: undefined,
    piHydrates: undefined, // insufficient data
    pbtCardsHydrate: undefined,
    pbtTimeSeriesHydrates: undefined,
    sparseBehaviorPreserved: undefined,
    noFatalConsoleExceptions: undefined,
    insightsAccessible: undefined,
    diagnosticsSeparated: undefined,
    metricSwitchingWorks: undefined,
    timeFilteringWorks: undefined,
  },

  evidenceEligibility: {
    githubProvenanceGateActive: undefined,
    unsupportedGithubSuppressed: undefined,
    claudeCodeUnsupportedUnavailable: undefined,
    costContextGuarded: undefined,
    noFabricatedDeveloperIdentity: undefined,
    noUnsupportedCausalLanguage: undefined,
  },

  extensionEnrollment: {
    oneCanonicalVsix: undefined,
    downloadMatchesManifest: undefined,
    enrollmentWorks: undefined, // 0 invites
    setupUsesHttpsApiBase: false, // HTTP only
    upgradeCompatibilityDocumented: undefined,
    legacyIngestionCompatible: undefined,
    rolloutPreservesTelemetry: undefined,
  },

  securityOperations: {
    httpsActive: false, // HTTP only — VERIFIED
    corsOriginSane: undefined,
    diskBelowThreshold: true, // OK
    backendProcessHealthy: true,
    frontendProcessHealthy: true,
    dbPreserved: true,
    tokenStatePreserved: undefined,
    rollbackExists: undefined,
    noDbReplacement: true,
    noCustomerSourceAsBuildAuthority: true,
  },
}

// ─── Patra ──────────────────────────────────────────────────────────────────
// Evidence: HISTORICAL DOC ONLY — pre-rollout
// Status: GREEN (historical) — but no current runtime evidence

export const PATRA_PREFLIGHT_INPUT: PilotPreflightInput = {
  pilotId: 'patra',
  pilotName: 'Patra',

  releaseIdentity: {
    extensionVersion: '0.4.0', // HISTORICAL — staged, not deployed
    vsixFilename: undefined,
    vsixSha256: undefined,
    vsixSizeBytes: undefined,
    canonicalDownloadEndpoint: '/api/extension/download/latest',
    rollbackArtifact: undefined,
  },

  tenantIdentity: {
    hostname: undefined, // not recorded in STATUS
    httpsActive: true, // HISTORICAL — TLS active
    apiBaseUrl: undefined,
    dashboardLoginUrl: undefined,
    hasLocalhostInBuild: undefined,
  },

  apiRuntime: {
    frontendStatus: undefined, // pre-rollout
    backendApiStatus: undefined,
    canonicalTelemetryEndpoint: undefined,
    canonicalPopulation: 0, // pre-rollout
    workflowCount: 0,
    latestTelemetryTimestamp: undefined, // N/A pre-rollout
    hasSyntheticData: undefined,
    loadingDistinctFromEmpty: undefined,
  },

  productSurfaces: {
    aioiHydrates: undefined,
    piHydrates: undefined,
    pbtCardsHydrate: undefined,
    pbtTimeSeriesHydrates: undefined,
    sparseBehaviorPreserved: undefined,
    noFatalConsoleExceptions: undefined,
    insightsAccessible: undefined,
    diagnosticsSeparated: undefined,
    metricSwitchingWorks: undefined,
    timeFilteringWorks: undefined,
  },

  evidenceEligibility: {
    githubProvenanceGateActive: undefined,
    unsupportedGithubSuppressed: undefined,
    claudeCodeUnsupportedUnavailable: undefined,
    costContextGuarded: undefined,
    noFabricatedDeveloperIdentity: undefined,
    noUnsupportedCausalLanguage: undefined,
  },

  extensionEnrollment: {
    oneCanonicalVsix: undefined,
    downloadMatchesManifest: undefined,
    enrollmentWorks: undefined, // ready (invite-backed) but pre-rollout
    setupUsesHttpsApiBase: undefined,
    upgradeCompatibilityDocumented: undefined,
    legacyIngestionCompatible: undefined,
    rolloutPreservesTelemetry: undefined,
  },

  securityOperations: {
    httpsActive: true, // HISTORICAL
    corsOriginSane: undefined,
    diskBelowThreshold: undefined,
    backendProcessHealthy: undefined,
    frontendProcessHealthy: undefined,
    dbPreserved: undefined,
    tokenStatePreserved: undefined,
    rollbackExists: undefined,
    noDbReplacement: undefined,
    noCustomerSourceAsBuildAuthority: undefined,
  },
}

// ─── Ryan (Decisions) ───────────────────────────────────────────────────────
// Evidence: VERIFIED LIVE 2026-08-30 UTC
// Status: RED — disk 100% full, backend 500

export const RYAN_PREFLIGHT_INPUT: PilotPreflightInput = {
  pilotId: 'ryan',
  pilotName: 'Ryan (Decisions)',

  releaseIdentity: {
    extensionVersion: '0.3.9', // VERIFIED — old version
    vsixFilename: undefined,
    vsixSha256: undefined,
    vsixSizeBytes: undefined,
    canonicalDownloadEndpoint: '/api/extension/download/latest',
    rollbackArtifact: undefined,
  },

  tenantIdentity: {
    hostname: undefined,
    httpsActive: false, // HTTP only — VERIFIED
    apiBaseUrl: undefined,
    dashboardLoginUrl: undefined,
    hasLocalhostInBuild: undefined,
  },

  apiRuntime: {
    frontendStatus: 200,
    backendApiStatus: 500, // VERIFIED — disk full
    canonicalTelemetryEndpoint: '/api/telemetry/canonical',
    canonicalPopulation: 0, // VERIFIED — 0 events
    workflowCount: 0,
    latestTelemetryTimestamp: undefined, // N/A — 0 events
    hasSyntheticData: undefined,
    loadingDistinctFromEmpty: undefined,
  },

  productSurfaces: {
    aioiHydrates: undefined,
    piHydrates: false, // backend 500
    pbtCardsHydrate: false, // backend 500
    pbtTimeSeriesHydrates: false, // backend 500
    sparseBehaviorPreserved: undefined,
    noFatalConsoleExceptions: undefined,
    insightsAccessible: undefined,
    diagnosticsSeparated: undefined,
    metricSwitchingWorks: undefined,
    timeFilteringWorks: undefined,
  },

  evidenceEligibility: {
    githubProvenanceGateActive: undefined,
    unsupportedGithubSuppressed: undefined,
    claudeCodeUnsupportedUnavailable: undefined,
    costContextGuarded: undefined,
    noFabricatedDeveloperIdentity: undefined,
    noUnsupportedCausalLanguage: undefined,
  },

  extensionEnrollment: {
    oneCanonicalVsix: undefined,
    downloadMatchesManifest: undefined,
    enrollmentWorks: undefined, // 27 invites
    setupUsesHttpsApiBase: false, // HTTP only
    upgradeCompatibilityDocumented: undefined,
    legacyIngestionCompatible: undefined,
    rolloutPreservesTelemetry: undefined,
  },

  securityOperations: {
    httpsActive: false, // HTTP only
    corsOriginSane: undefined,
    diskBelowThreshold: false, // 100% FULL — CRITICAL
    backendProcessHealthy: false, // 500 error
    frontendProcessHealthy: true, // 200 OK
    dbPreserved: true, // DB cleaned July 10, not replaced
    tokenStatePreserved: undefined,
    rollbackExists: undefined,
    noDbReplacement: true,
    noCustomerSourceAsBuildAuthority: true,
  },
}

// ─── All Pilot Inputs ───────────────────────────────────────────────────────

export const ALL_PILOT_INPUTS: PilotPreflightInput[] = [
  ED_PREFLIGHT_INPUT,
  KASEY_PREFLIGHT_INPUT,
  PATRA_PREFLIGHT_INPUT,
  RYAN_PREFLIGHT_INPUT,
]
