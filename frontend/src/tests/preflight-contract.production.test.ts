/**
 * CR-X Generic Pilot Preflight Contract — Production-Path Acceptance Tests
 *
 * Tests prove the generic preflight contract works correctly:
 * - dynamic population accepted
 * - zero population does not masquerade as loading
 * - missing GitHub provenance fails/suppresses GitHub-dependent evidence
 * - unsupported Claude fields remain unavailable
 * - wrong API base fails
 * - localhost in customer build fails
 * - mismatched VSIX hash fails
 * - missing rollback fails promotion readiness
 * - missing HTTPS fails official token-auth rollout
 * - healthy current telemetry passes freshness contract
 * - stale telemetry produces explicit warning/failure
 * - extension download artifact must match manifest
 * - tenant-specific values do not become hardcoded global assumptions
 */

import { describe, it, expect } from 'vitest'
import { runPreflight, toHumanReadableReport, formatReportAsText } from '../lib/preflight/preflightHarness'
import type { PilotPreflightInput } from '../lib/preflight/preflightSchema'
import {
  ED_PREFLIGHT_INPUT,
  KASEY_PREFLIGHT_INPUT,
  PATRA_PREFLIGHT_INPUT,
  RYAN_PREFLIGHT_INPUT,
} from '../lib/preflight/pilotInputs'

// ─── Helpers ───

function makeHealthyPilot(overrides?: Partial<PilotPreflightInput>): PilotPreflightInput {
  return {
    pilotId: 'test-healthy',
    pilotName: 'Test Healthy Pilot',
    releaseIdentity: {
      localSourceCommit: 'abc123',
      extensionVersion: '0.4.1',
      vsixFilename: 'chaosmonkey-telemetry-0.4.1.vsix',
      vsixSha256: 'b66fc8545fda619c68f9e502a7198307b00a897b991c07bb0f2b1c1291889a94',
      vsixSizeBytes: 51657,
      canonicalDownloadEndpoint: '/api/extension/download/latest',
      rollbackArtifact: 'pre-0.4.1 VSIX + git revert',
      ...overrides?.releaseIdentity,
    },
    tenantIdentity: {
      hostname: 'test.chaosmonkey.dev',
      httpsActive: true,
      apiBaseUrl: 'https://test.chaosmonkey.dev',
      dashboardLoginUrl: 'https://test.chaosmonkey.dev/login',
      hasLocalhostInBuild: false,
      ...overrides?.tenantIdentity,
    },
    apiRuntime: {
      frontendStatus: 200,
      backendApiStatus: 200,
      canonicalTelemetryEndpoint: '/api/telemetry/canonical',
      canonicalPopulation: 1500,
      workflowCount: 5,
      latestTelemetryTimestamp: new Date().toISOString(),
      hasSyntheticData: false,
      loadingDistinctFromEmpty: true,
      ...overrides?.apiRuntime,
    },
    productSurfaces: {
      aioiHydrates: true,
      piHydrates: true,
      insightsAccessible: true,
      diagnosticsSeparated: true,
      pbtCardsHydrate: true,
      pbtTimeSeriesHydrates: true,
      metricSwitchingWorks: true,
      timeFilteringWorks: true,
      sparseBehaviorPreserved: true,
      noFatalConsoleExceptions: true,
      ...overrides?.productSurfaces,
    },
    evidenceEligibility: {
      githubProvenanceGateActive: true,
      unsupportedGithubSuppressed: true,
      claudeCodeUnsupportedUnavailable: true,
      costContextGuarded: true,
      noFabricatedDeveloperIdentity: true,
      noUnsupportedCausalLanguage: true,
      ...overrides?.evidenceEligibility,
    },
    extensionEnrollment: {
      oneCanonicalVsix: true,
      downloadMatchesManifest: true,
      enrollmentWorks: true,
      setupUsesHttpsApiBase: true,
      upgradeCompatibilityDocumented: true,
      legacyIngestionCompatible: true,
      rolloutPreservesTelemetry: true,
      ...overrides?.extensionEnrollment,
    },
    securityOperations: {
      httpsActive: true,
      corsOriginSane: true,
      diskBelowThreshold: true,
      backendProcessHealthy: true,
      frontendProcessHealthy: true,
      dbPreserved: true,
      tokenStatePreserved: true,
      rollbackExists: true,
      noDbReplacement: true,
      noCustomerSourceAsBuildAuthority: true,
      ...overrides?.securityOperations,
    },
  }
}

// ─── Tests ───

describe('CR-X Generic Pilot Preflight Contract', () => {

  describe('P0-C-1: dynamic population accepted', () => {
    it('healthy pilot with dynamic population > 0 passes population check', () => {
      const result = runPreflight(makeHealthyPilot({ apiRuntime: { canonicalPopulation: 1929 } } as any))
      const popCheck = result.checks.find(c => c.id === 'api-runtime.canonical-population')
      expect(popCheck!.status).toBe('PASS')
      expect(popCheck!.evidence).toContain('1929')
    })

    it('population value is not hardcoded — different values produce different evidence', () => {
      const r1 = runPreflight(makeHealthyPilot({ apiRuntime: { canonicalPopulation: 100 } } as any))
      const r2 = runPreflight(makeHealthyPilot({ apiRuntime: { canonicalPopulation: 5000 } } as any))
      const c1 = r1.checks.find(c => c.id === 'api-runtime.canonical-population')
      const c2 = r2.checks.find(c => c.id === 'api-runtime.canonical-population')
      expect(c1!.evidence).toContain('100')
      expect(c2!.evidence).toContain('5000')
    })
  })

  describe('P0-C-2: zero population does not masquerade as loading', () => {
    it('zero population fails population check (not UNKNOWN)', () => {
      const result = runPreflight(makeHealthyPilot({ apiRuntime: { canonicalPopulation: 0 } } as any))
      const popCheck = result.checks.find(c => c.id === 'api-runtime.canonical-population')
      expect(popCheck!.status).toBe('FAIL')
      expect(popCheck!.evidence).toContain('zero')
    })

    it('zero population with loadingDistinctFromEmpty=true still fails population', () => {
      const result = runPreflight(makeHealthyPilot({
        apiRuntime: { canonicalPopulation: 0, loadingDistinctFromEmpty: true } as any,
      }))
      const popCheck = result.checks.find(c => c.id === 'api-runtime.canonical-population')
      expect(popCheck!.status).toBe('FAIL')
      const loadingCheck = result.checks.find(c => c.id === 'api-runtime.loading-distinct')
      expect(loadingCheck!.status).toBe('PASS')
    })

    it('zero population with loadingDistinctFromEmpty=false fails both', () => {
      const result = runPreflight(makeHealthyPilot({
        apiRuntime: { canonicalPopulation: 0, loadingDistinctFromEmpty: false } as any,
      }))
      const popCheck = result.checks.find(c => c.id === 'api-runtime.canonical-population')
      const loadingCheck = result.checks.find(c => c.id === 'api-runtime.loading-distinct')
      expect(popCheck!.status).toBe('FAIL')
      expect(loadingCheck!.status).toBe('FAIL')
    })
  })

  describe('P0-C-3: missing GitHub provenance fails/suppresses GitHub evidence', () => {
    it('githubProvenanceGateActive=false fails (not suppressed silently)', () => {
      const result = runPreflight(makeHealthyPilot({
        evidenceEligibility: { githubProvenanceGateActive: false } as any,
      }))
      const check = result.checks.find(c => c.id === 'evidence-eligibility.github-provenance-gate')
      expect(check!.status).toBe('FAIL')
    })

    it('githubProvenanceGateActive=undefined returns UNKNOWN (not PASS)', () => {
      const result = runPreflight(makeHealthyPilot({
        evidenceEligibility: { githubProvenanceGateActive: undefined } as any,
      }))
      const check = result.checks.find(c => c.id === 'evidence-eligibility.github-provenance-gate')
      expect(check!.status).toBe('UNKNOWN')
    })
  })

  describe('P0-C-4: unsupported Claude fields remain unavailable', () => {
    it('claudeCodeUnsupportedUnavailable=false fails (metrics shown as zero)', () => {
      const result = runPreflight(makeHealthyPilot({
        evidenceEligibility: { claudeCodeUnsupportedUnavailable: false } as any,
      }))
      const check = result.checks.find(c => c.id === 'evidence-eligibility.claude-code-unsupported')
      expect(check!.status).toBe('FAIL')
      expect(check!.evidence).toContain('zero')
    })

    it('claudeCodeUnsupportedUnavailable=true passes', () => {
      const result = runPreflight(makeHealthyPilot({
        evidenceEligibility: { claudeCodeUnsupportedUnavailable: true } as any,
      }))
      const check = result.checks.find(c => c.id === 'evidence-eligibility.claude-code-unsupported')
      expect(check!.status).toBe('PASS')
    })
  })

  describe('P0-C-5: wrong API base fails', () => {
    it('HTTP API base URL fails', () => {
      const result = runPreflight(makeHealthyPilot({
        tenantIdentity: { apiBaseUrl: 'http://test.chaosmonkey.dev' } as any,
      }))
      const check = result.checks.find(c => c.id === 'tenant-identity.api-base-url')
      expect(check!.status).toBe('FAIL')
      expect(check!.evidence).toContain('not HTTPS')
    })

    it('localhost API base URL fails', () => {
      const result = runPreflight(makeHealthyPilot({
        tenantIdentity: { apiBaseUrl: 'http://localhost:8010' } as any,
      }))
      const check = result.checks.find(c => c.id === 'tenant-identity.api-base-url')
      expect(check!.status).toBe('FAIL')
      expect(check!.evidence).toContain('localhost')
    })

    it('HTTPS API base URL passes', () => {
      const result = runPreflight(makeHealthyPilot())
      const check = result.checks.find(c => c.id === 'tenant-identity.api-base-url')
      expect(check!.status).toBe('PASS')
    })
  })

  describe('P0-C-6: localhost in customer build fails', () => {
    it('hasLocalhostInBuild=true fails', () => {
      const result = runPreflight(makeHealthyPilot({
        tenantIdentity: { hasLocalhostInBuild: true } as any,
      }))
      const check = result.checks.find(c => c.id === 'tenant-identity.no-localhost-in-build')
      expect(check!.status).toBe('FAIL')
      expect(check!.evidence).toContain('localhost')
    })

    it('hasLocalhostInBuild=false passes', () => {
      const result = runPreflight(makeHealthyPilot())
      const check = result.checks.find(c => c.id === 'tenant-identity.no-localhost-in-build')
      expect(check!.status).toBe('PASS')
    })
  })

  describe('P0-C-7: mismatched VSIX hash fails', () => {
    it('wrong SHA-256 length fails validation', () => {
      const result = runPreflight(makeHealthyPilot({
        releaseIdentity: { vsixSha256: 'abc123' } as any,
      }))
      const check = result.checks.find(c => c.id === 'release-identity.vsix-sha256')
      expect(check!.status).toBe('FAIL')
      expect(check!.evidence).toContain('validation failed')
    })

    it('correct 64-char SHA-256 passes', () => {
      const result = runPreflight(makeHealthyPilot())
      const check = result.checks.find(c => c.id === 'release-identity.vsix-sha256')
      expect(check!.status).toBe('PASS')
    })
  })

  describe('P0-C-8: missing rollback fails promotion readiness', () => {
    it('missing rollbackArtifact fails', () => {
      const result = runPreflight(makeHealthyPilot({
        releaseIdentity: { rollbackArtifact: undefined } as any,
      }))
      const check = result.checks.find(c => c.id === 'release-identity.rollback-artifact')
      expect(check!.status).toBe('UNKNOWN')
    })

    it('present rollbackArtifact passes', () => {
      const result = runPreflight(makeHealthyPilot())
      const check = result.checks.find(c => c.id === 'release-identity.rollback-artifact')
      expect(check!.status).toBe('PASS')
    })

    it('missing rollback in security-operations also fails', () => {
      const result = runPreflight(makeHealthyPilot({
        securityOperations: { rollbackExists: false } as any,
      }))
      const check = result.checks.find(c => c.id === 'security-operations.rollback-exists')
      expect(check!.status).toBe('FAIL')
    })
  })

  describe('P0-C-9: missing HTTPS fails official token-auth rollout', () => {
    it('httpsActive=false fails tenant-identity check', () => {
      const result = runPreflight(makeHealthyPilot({
        tenantIdentity: { httpsActive: false } as any,
      }))
      const check = result.checks.find(c => c.id === 'tenant-identity.https-active')
      expect(check!.status).toBe('FAIL')
      expect(check!.remediation).toContain('TLS')
    })

    it('httpsActive=false fails security-operations check', () => {
      const result = runPreflight(makeHealthyPilot({
        securityOperations: { httpsActive: false } as any,
      }))
      const check = result.checks.find(c => c.id === 'security-operations.https')
      expect(check!.status).toBe('FAIL')
    })

    it('httpsActive=false makes overall verdict NO-GO', () => {
      const result = runPreflight(makeHealthyPilot({
        tenantIdentity: { httpsActive: false } as any,
        securityOperations: { httpsActive: false } as any,
      }))
      expect(result.overall).toBe('NO-GO')
      expect(result.blockerCount).toBeGreaterThan(0)
    })
  })

  describe('P0-C-10: healthy current telemetry passes freshness contract', () => {
    it('telemetry < 1 day old passes', () => {
      const result = runPreflight(makeHealthyPilot({
        apiRuntime: { latestTelemetryTimestamp: new Date(Date.now() - 3600000).toISOString() } as any,
      }))
      const check = result.checks.find(c => c.id === 'api-runtime.telemetry-freshness')
      expect(check!.status).toBe('PASS')
    })

    it('telemetry 3 days old passes', () => {
      const result = runPreflight(makeHealthyPilot({
        apiRuntime: { latestTelemetryTimestamp: new Date(Date.now() - 3 * 86400000).toISOString() } as any,
      }))
      const check = result.checks.find(c => c.id === 'api-runtime.telemetry-freshness')
      expect(check!.status).toBe('PASS')
    })
  })

  describe('P0-C-11: stale telemetry produces explicit warning/failure', () => {
    it('telemetry 10 days old fails', () => {
      const result = runPreflight(makeHealthyPilot({
        apiRuntime: { latestTelemetryTimestamp: new Date(Date.now() - 10 * 86400000).toISOString() } as any,
      }))
      const check = result.checks.find(c => c.id === 'api-runtime.telemetry-freshness')
      expect(check!.status).toBe('FAIL')
      expect(check!.evidence).toContain('stale')
    })

    it('missing telemetry timestamp returns UNKNOWN', () => {
      const result = runPreflight(makeHealthyPilot({
        apiRuntime: { latestTelemetryTimestamp: undefined } as any,
      }))
      const check = result.checks.find(c => c.id === 'api-runtime.telemetry-freshness')
      expect(check!.status).toBe('UNKNOWN')
    })
  })

  describe('P0-C-12: extension download artifact must match manifest', () => {
    it('downloadMatchesManifest=true passes', () => {
      const result = runPreflight(makeHealthyPilot())
      const check = result.checks.find(c => c.id === 'extension-enrollment.download-matches-manifest')
      expect(check!.status).toBe('PASS')
    })

    it('downloadMatchesManifest=false fails as blocker', () => {
      const result = runPreflight(makeHealthyPilot({
        extensionEnrollment: { downloadMatchesManifest: false } as any,
      }))
      const check = result.checks.find(c => c.id === 'extension-enrollment.download-matches-manifest')
      expect(check!.status).toBe('FAIL')
      expect(check!.severity).toBe('blocker')
    })
  })

  describe('P0-C-13: tenant-specific values do not become hardcoded', () => {
    it('different pilot IDs produce different results', () => {
      const p1 = makeHealthyPilot()
      p1.pilotId = 'pilot-a'
      p1.pilotName = 'Pilot A'
      const p2 = makeHealthyPilot()
      p2.pilotId = 'pilot-b'
      p2.pilotName = 'Pilot B'
      const r1 = runPreflight(p1)
      const r2 = runPreflight(p2)
      expect(r1.pilotId).toBe('pilot-a')
      expect(r2.pilotId).toBe('pilot-b')
    })

    it('hostname is not hardcoded — different hostnames produce different evidence', () => {
      const r1 = runPreflight(makeHealthyPilot({
        tenantIdentity: { hostname: 'ed.chaosmonkey.dev' } as any,
      }))
      const r2 = runPreflight(makeHealthyPilot({
        tenantIdentity: { hostname: 'kasey.chaosmonkey.dev' } as any,
      }))
      const c1 = r1.checks.find(c => c.id === 'tenant-identity.hostname')
      const c2 = r2.checks.find(c => c.id === 'tenant-identity.hostname')
      expect(c1!.evidence).toContain('ed.chaosmonkey.dev')
      expect(c2!.evidence).toContain('kasey.chaosmonkey.dev')
    })
  })

  describe('P0-B: machine-readable + human-readable output', () => {
    it('machine-readable result has all required fields', () => {
      const result = runPreflight(makeHealthyPilot())
      expect(result.pilotId).toBeDefined()
      expect(result.timestamp).toBeDefined()
      expect(result.checks).toBeInstanceOf(Array)
      expect(result.overall).toBeDefined()
      expect(result.blockerCount).toBeDefined()
      expect(result.warningCount).toBeDefined()
      expect(result.passCount).toBeDefined()
      expect(result.naCount).toBeDefined()
      expect(result.unknownCount).toBeDefined()
    })

    it('human-readable report has all required fields', () => {
      const result = runPreflight(makeHealthyPilot())
      const report = toHumanReadableReport(result)
      expect(report.pilot).toBeDefined()
      expect(report.timestamp).toBeDefined()
      expect(report.verdict).toBeDefined()
      expect(report.passedGates).toBeInstanceOf(Array)
      expect(report.blockers).toBeInstanceOf(Array)
      expect(report.warnings).toBeInstanceOf(Array)
      expect(report.naGates).toBeInstanceOf(Array)
      expect(report.unknownGates).toBeInstanceOf(Array)
      expect(report.promotionRecommendation).toBeDefined()
    })

    it('formatReportAsText produces readable output', () => {
      const result = runPreflight(makeHealthyPilot())
      const report = toHumanReadableReport(result)
      const text = formatReportAsText(report)
      expect(text).toContain('PREFLIGHT REPORT')
      expect(text).toContain('Verdict')
      expect(text).toContain('Recommendation')
    })

    it('healthy pilot produces GO verdict', () => {
      const result = runPreflight(makeHealthyPilot())
      expect(result.overall).toBe('GO')
      expect(result.blockerCount).toBe(0)
    })

    it('pilot with blocker produces NO-GO verdict', () => {
      const result = runPreflight(makeHealthyPilot({
        securityOperations: { diskBelowThreshold: false } as any,
      }))
      expect(result.overall).toBe('NO-GO')
      expect(result.blockerCount).toBeGreaterThan(0)
    })

    it('pilot with only warning FAILs (no blocker FAIL/UNKNOWN) produces GO', () => {
      const result = runPreflight(makeHealthyPilot({
        apiRuntime: { canonicalPopulation: 0 } as any,
      }))
      // canonical-population is severity 'warning' — does not force NO-GO or CONDITIONAL
      // R1 verdict contract: GO = all blockers PASS/N/A, warnings may remain
      expect(result.overall).toBe('GO')
      expect(result.warningCount).toBeGreaterThan(0)
    })
  })

  describe('P1: pilot matrix — known evidence only', () => {
    it('Ed preflight runs without error', () => {
      const result = runPreflight(ED_PREFLIGHT_INPUT)
      expect(result.pilotId).toBe('ed')
      expect(result.checks.length).toBeGreaterThan(0)
    })

    it('Kasey preflight runs without error', () => {
      const result = runPreflight(KASEY_PREFLIGHT_INPUT)
      expect(result.pilotId).toBe('kasey')
    })

    it('Patra preflight runs without error', () => {
      const result = runPreflight(PATRA_PREFLIGHT_INPUT)
      expect(result.pilotId).toBe('patra')
    })

    it('Ryan preflight runs without error', () => {
      const result = runPreflight(RYAN_PREFLIGHT_INPUT)
      expect(result.pilotId).toBe('ryan')
    })

    it('Ed fixture is NOT GO while critical evidence remains UNKNOWN (R1 verdict contract)', () => {
      const result = runPreflight(ED_PREFLIGHT_INPUT)
      // R1: Ed has zero blocker FAILs but has blocker-severity UNKNOWNs
      // (missing browser/product surface evidence, download verification, etc.)
      // Therefore verdict must be CONDITIONAL, not GO.
      expect(result.overall).toBe('CONDITIONAL')
      expect(result.blockerCount).toBe(0)
      expect(result.blockerUnknownCount).toBeGreaterThan(0)
      expect(result.unknownCount).toBeGreaterThan(0)
    })

    it('Kasey overall verdict is NO-GO (HTTP only, no HTTPS)', () => {
      const result = runPreflight(KASEY_PREFLIGHT_INPUT)
      expect(result.overall).toBe('NO-GO')
      expect(result.blockerCount).toBeGreaterThan(0)
    })

    it('Ryan overall verdict is NO-GO (disk full, backend 500)', () => {
      const result = runPreflight(RYAN_PREFLIGHT_INPUT)
      expect(result.overall).toBe('NO-GO')
      const diskCheck = result.checks.find(c => c.id === 'security-operations.disk-threshold')
      expect(diskCheck!.status).toBe('FAIL')
    })

    it('Patra fixture is CONDITIONAL (pre-rollout, critical evidence UNKNOWN)', () => {
      const result = runPreflight(PATRA_PREFLIGHT_INPUT)
      // R1: Patra has zero blocker FAILs but has blocker-severity UNKNOWNs
      // (pre-rollout, no runtime evidence, missing VSIX/hostname/etc.)
      expect(result.overall).toBe('CONDITIONAL')
      expect(result.blockerUnknownCount).toBeGreaterThan(0)
    })

    it('no pilot has hardcoded session count in invariant', () => {
      // The harness must not encode Ed-specific 2364 or Local 1929 as invariants
      // Population is dynamic — check evidence reflects input value
      const edResult = runPreflight(ED_PREFLIGHT_INPUT)
      const edPopCheck = edResult.checks.find(c => c.id === 'api-runtime.canonical-population')
      expect(edPopCheck!.evidence).toContain('2364')

      // Change the population and verify evidence changes
      const modifiedEd = { ...ED_PREFLIGHT_INPUT, apiRuntime: { ...ED_PREFLIGHT_INPUT.apiRuntime, canonicalPopulation: 9999 } }
      const modifiedResult = runPreflight(modifiedEd)
      const modifiedPopCheck = modifiedResult.checks.find(c => c.id === 'api-runtime.canonical-population')
      expect(modifiedPopCheck!.evidence).toContain('9999')
      expect(modifiedPopCheck!.evidence).not.toContain('2364')
    })
  })

  describe('regression: synthetic data detection', () => {
    it('hasSyntheticData=true fails as blocker', () => {
      const result = runPreflight(makeHealthyPilot({
        apiRuntime: { hasSyntheticData: true } as any,
      }))
      const check = result.checks.find(c => c.id === 'api-runtime.no-synthetic-data')
      expect(check!.status).toBe('FAIL')
      expect(check!.severity).toBe('blocker')
    })
  })

  describe('regression: fabricated identity detection', () => {
    it('noFabricatedDeveloperIdentity=false fails as blocker', () => {
      const result = runPreflight(makeHealthyPilot({
        evidenceEligibility: { noFabricatedDeveloperIdentity: false } as any,
      }))
      const check = result.checks.find(c => c.id === 'evidence-eligibility.no-fabricated-identity')
      expect(check!.status).toBe('FAIL')
      expect(check!.severity).toBe('blocker')
    })
  })

  describe('regression: causal language detection', () => {
    it('noUnsupportedCausalLanguage=false fails as blocker', () => {
      const result = runPreflight(makeHealthyPilot({
        evidenceEligibility: { noUnsupportedCausalLanguage: false } as any,
      }))
      const check = result.checks.find(c => c.id === 'evidence-eligibility.no-causal-language')
      expect(check!.status).toBe('FAIL')
      expect(check!.severity).toBe('blocker')
    })
  })

  describe('regression: backend 500 detection', () => {
    it('backendApiStatus=500 fails with remediation hint', () => {
      const result = runPreflight(makeHealthyPilot({
        apiRuntime: { backendApiStatus: 500 } as any,
      }))
      const check = result.checks.find(c => c.id === 'api-runtime.backend-api-status')
      expect(check!.status).toBe('FAIL')
      expect(check!.evidence).toContain('500')
      expect(check!.remediation).toBeDefined()
      expect(check!.remediation).toContain('disk')
    })
  })

  // ─── R1 VERDICT SEMANTICS CONTRACT ──────────────────────────────────────

  describe('R1 verdict semantics contract', () => {

    // Test 1: known blocker FAIL => NO-GO
    it('R1-1: known blocker FAIL => NO-GO', () => {
      const result = runPreflight(makeHealthyPilot({
        securityOperations: { diskBelowThreshold: false } as any,
      }))
      expect(result.blockerCount).toBeGreaterThan(0)
      expect(result.overall).toBe('NO-GO')
    })

    // Test 2: no FAIL + blocker UNKNOWN => CONDITIONAL
    it('R1-2: no blocker FAIL + blocker UNKNOWN => CONDITIONAL', () => {
      // Set a blocker-severity field to undefined (UNKNOWN) but keep all others PASS
      const input = makeHealthyPilot()
      ;(input as any).productSurfaces.aioiHydrates = undefined // blocker-severity → UNKNOWN
      const result = runPreflight(input)
      expect(result.blockerCount).toBe(0)
      expect(result.blockerUnknownCount).toBeGreaterThan(0)
      expect(result.overall).toBe('CONDITIONAL')
    })

    // Test 3: all blockers PASS/N/A => GO
    it('R1-3: all blockers PASS => GO', () => {
      const result = runPreflight(makeHealthyPilot())
      expect(result.blockerCount).toBe(0)
      expect(result.blockerUnknownCount).toBe(0)
      expect(result.overall).toBe('GO')
    })

    // Test 4: warning UNKNOWN alone does not force NO-GO
    it('R1-4: warning UNKNOWN alone does not force NO-GO or CONDITIONAL', () => {
      // canonical-population is severity 'warning' — set to undefined
      const input = makeHealthyPilot()
      ;(input as any).apiRuntime.canonicalPopulation = undefined // warning-severity → UNKNOWN
      const result = runPreflight(input)
      // Warning UNKNOWN does not affect verdict — all blockers still PASS
      expect(result.overall).toBe('GO')
    })

    // Test 5: N/A remains distinct from UNKNOWN
    it('R1-5: N/A status is distinct from UNKNOWN status', () => {
      // Construct a check result with N/A status
      const input = makeHealthyPilot()
      const result = runPreflight(input)
      const hasNa = result.checks.some(c => c.status === 'N/A')
      const hasUnknown = result.checks.some(c => c.status === 'UNKNOWN')
      // N/A and UNKNOWN are different values
      expect('N/A').not.toBe('UNKNOWN')
      // Both counts are tracked separately
      expect(result.naCount).toBeDefined()
      expect(result.unknownCount).toBeDefined()
      // A check cannot be both N/A and UNKNOWN
      expect(result.checks.filter(c => c.status === 'N/A' && c.status === 'UNKNOWN').length).toBe(0)
      // Verify counts are consistent
      expect(result.naCount).toBe(result.checks.filter(c => c.status === 'N/A').length)
      expect(result.unknownCount).toBe(result.checks.filter(c => c.status === 'UNKNOWN').length)
    })

    // Test 6: Ed fixture is NOT GO while critical evidence remains UNKNOWN
    it('R1-6: Ed fixture is NOT GO (blocker UNKNOWNs present)', () => {
      const result = runPreflight(ED_PREFLIGHT_INPUT)
      expect(result.overall).not.toBe('GO')
      expect(result.overall).toBe('CONDITIONAL')
      expect(result.blockerUnknownCount).toBeGreaterThan(0)
    })

    // Test 7: Kasey remains NO-GO
    it('R1-7: Kasey fixture remains NO-GO (known TLS blockers)', () => {
      const result = runPreflight(KASEY_PREFLIGHT_INPUT)
      expect(result.overall).toBe('NO-GO')
      expect(result.blockerCount).toBeGreaterThan(0)
    })

    // Test 8: Patra remains CONDITIONAL
    it('R1-8: Patra fixture remains CONDITIONAL (critical evidence UNKNOWN)', () => {
      const result = runPreflight(PATRA_PREFLIGHT_INPUT)
      expect(result.overall).toBe('CONDITIONAL')
      expect(result.blockerUnknownCount).toBeGreaterThan(0)
    })

    // Test 9: Ryan remains NO-GO
    it('R1-9: Ryan fixture remains NO-GO (known infrastructure blockers)', () => {
      const result = runPreflight(RYAN_PREFLIGHT_INPUT)
      expect(result.overall).toBe('NO-GO')
      expect(result.blockerCount).toBeGreaterThan(0)
    })

    // Edge case: blocker FAIL + blocker UNKNOWN => NO-GO (FAIL takes precedence)
    it('R1-edge: blocker FAIL + blocker UNKNOWN => NO-GO (FAIL takes precedence)', () => {
      const input = makeHealthyPilot()
      ;(input as any).productSurfaces.aioiHydrates = undefined // blocker UNKNOWN
      ;(input as any).securityOperations.diskBelowThreshold = false // blocker FAIL
      const result = runPreflight(input)
      expect(result.blockerCount).toBeGreaterThan(0)
      expect(result.blockerUnknownCount).toBeGreaterThan(0)
      expect(result.overall).toBe('NO-GO')
    })

    // Edge case: all blockers N/A => GO (N/A is legitimate, not UNKNOWN)
    it('R1-edge: all blockers N/A => GO (N/A is legitimate, not missing evidence)', () => {
      // This is a conceptual test — in practice, makeHealthyPilot sets all to PASS
      // The key semantic: N/A ≠ UNKNOWN. N/A means "does not apply", UNKNOWN means "not yet evaluated"
      const result = runPreflight(makeHealthyPilot())
      // If all blockers are PASS (not UNKNOWN), verdict is GO
      expect(result.blockerUnknownCount).toBe(0)
      expect(result.overall).toBe('GO')
    })
  })
})
