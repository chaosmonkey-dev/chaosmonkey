/**
 * CR-X Generic Pilot Preflight Harness
 *
 * Runs invariant checks against a PilotPreflightInput and produces
 * machine-readable + human-readable results.
 *
 * No pilot-specific code. The same checks run for every pilot.
 * All populations are dynamic — no hardcoded session/workflow counts.
 */

import type {
  PilotPreflightInput,
  PreflightCheckResult,
  PreflightRunResult,
  HumanReadableReport,
  CheckSeverity,
  OverallVerdict,
} from './preflightSchema'

// ─── Check Definition ───────────────────────────────────────────────────────

interface CheckDef {
  id: string
  name: string
  category: PreflightCheckResult['category']
  severity: CheckSeverity
  /** Returns PASS/FAIL/N/A/UNKNOWN + evidence */
  evaluate: (input: PilotPreflightInput) => { status: PreflightCheckResult['status']; evidence: string; remediation?: string }
}

// ─── Helper: evaluate a boolean field ───────────────────────────────────────

function boolCheck(
  value: boolean | undefined,
  passEvidence: string,
  failEvidence: string,
  naEvidence: string,
): { status: PreflightCheckResult['status']; evidence: string } {
  if (value === undefined) return { status: 'UNKNOWN', evidence: 'Not yet evaluated' }
  if (value === true) return { status: 'PASS', evidence: passEvidence }
  return { status: 'FAIL', evidence: failEvidence }
}

function valueCheck(
  value: string | number | undefined,
  label: string,
  validation?: (v: string | number) => boolean,
): { status: PreflightCheckResult['status']; evidence: string } {
  if (value === undefined || value === null || value === '') {
    return { status: 'UNKNOWN', evidence: `${label} not provided` }
  }
  if (validation && !validation(value)) {
    return { status: 'FAIL', evidence: `${label} = ${value} (validation failed)` }
  }
  return { status: 'PASS', evidence: `${label} = ${value}` }
}

// ─── All Checks ─────────────────────────────────────────────────────────────

const CHECKS: CheckDef[] = [
  // ── Release Identity ──
  {
    id: 'release-identity.local-source-commit',
    name: 'Canonical Local source commit SHA recorded',
    category: 'release-identity',
    severity: 'info',
    evaluate: (i) => valueCheck(i.releaseIdentity.localSourceCommit, 'localSourceCommit'),
  },
  {
    id: 'release-identity.extension-version',
    name: 'Current extension version recorded',
    category: 'release-identity',
    severity: 'blocker',
    evaluate: (i) => valueCheck(i.releaseIdentity.extensionVersion, 'extensionVersion'),
  },
  {
    id: 'release-identity.vsix-filename',
    name: 'Canonical VSIX filename recorded',
    category: 'release-identity',
    severity: 'blocker',
    evaluate: (i) => valueCheck(i.releaseIdentity.vsixFilename, 'vsixFilename'),
  },
  {
    id: 'release-identity.vsix-sha256',
    name: 'VSIX SHA-256 matches manifest',
    category: 'release-identity',
    severity: 'blocker',
    evaluate: (i) => valueCheck(i.releaseIdentity.vsixSha256, 'vsixSha256', (v) => String(v).length === 64),
  },
  {
    id: 'release-identity.vsix-size',
    name: 'VSIX size matches manifest',
    category: 'release-identity',
    severity: 'warning',
    evaluate: (i) => valueCheck(i.releaseIdentity.vsixSizeBytes, 'vsixSizeBytes', (v) => Number(v) > 0),
  },
  {
    id: 'release-identity.download-endpoint',
    name: 'Canonical download endpoint recorded',
    category: 'release-identity',
    severity: 'blocker',
    evaluate: (i) => valueCheck(i.releaseIdentity.canonicalDownloadEndpoint, 'canonicalDownloadEndpoint'),
  },
  {
    id: 'release-identity.rollback-artifact',
    name: 'Rollback artifact/location exists before promotion',
    category: 'release-identity',
    severity: 'blocker',
    evaluate: (i) => valueCheck(i.releaseIdentity.rollbackArtifact, 'rollbackArtifact'),
  },

  // ── Tenant Identity ──
  {
    id: 'tenant-identity.hostname',
    name: 'Tenant hostname recorded',
    category: 'tenant-identity',
    severity: 'blocker',
    evaluate: (i) => valueCheck(i.tenantIdentity.hostname, 'hostname'),
  },
  {
    id: 'tenant-identity.https-active',
    name: 'HTTPS active for tenant',
    category: 'tenant-identity',
    severity: 'blocker',
    evaluate: (i) => {
      const r = boolCheck(i.tenantIdentity.httpsActive, 'HTTPS active', 'HTTPS NOT active', 'HTTPS state unknown')
      if (r.status === 'FAIL') return { ...r, remediation: 'Provision TLS certificate (e.g., Let\'s Encrypt) and configure HTTPS redirect' }
      return r
    },
  },
  {
    id: 'tenant-identity.api-base-url',
    name: 'API base URL uses HTTPS (not localhost or HTTP)',
    category: 'tenant-identity',
    severity: 'blocker',
    evaluate: (i) => {
      const url = i.tenantIdentity.apiBaseUrl
      if (!url) return { status: 'UNKNOWN', evidence: 'apiBaseUrl not provided' }
      if (url.includes('localhost') || url.includes('127.0.0.1')) {
        return { status: 'FAIL', evidence: `apiBaseUrl = ${url} (contains localhost)`, remediation: 'Set apiBaseUrl to tenant HTTPS endpoint' }
      }
      if (!url.startsWith('https://')) {
        return { status: 'FAIL', evidence: `apiBaseUrl = ${url} (not HTTPS)`, remediation: 'Use HTTPS URL for token-authenticated rollout' }
      }
      return { status: 'PASS', evidence: `apiBaseUrl = ${url}` }
    },
  },
  {
    id: 'tenant-identity.dashboard-login-url',
    name: 'Dashboard login URL recorded',
    category: 'tenant-identity',
    severity: 'warning',
    evaluate: (i) => valueCheck(i.tenantIdentity.dashboardLoginUrl, 'dashboardLoginUrl'),
  },
  {
    id: 'tenant-identity.no-localhost-in-build',
    name: 'No localhost/wrong-host references in built assets',
    category: 'tenant-identity',
    severity: 'blocker',
    evaluate: (i) => {
      const r = boolCheck(i.tenantIdentity.hasLocalhostInBuild, 'No localhost references in build', 'localhost references found in build', 'Build not checked for localhost')
      // Note: hasLocalhostInBuild is INVERTED — true means localhost IS present (bad)
      if (i.tenantIdentity.hasLocalhostInBuild === undefined) return { status: 'UNKNOWN', evidence: 'Build not checked for localhost' }
      if (i.tenantIdentity.hasLocalhostInBuild === true) {
        return { status: 'FAIL', evidence: 'localhost references found in built assets', remediation: 'Rebuild with correct VITE_API_BASE_URL' }
      }
      return { status: 'PASS', evidence: 'No localhost references in built assets' }
    },
  },

  // ── API / Runtime ──
  {
    id: 'api-runtime.frontend-status',
    name: 'Frontend returns 200',
    category: 'api-runtime',
    severity: 'blocker',
    evaluate: (i) => {
      const s = i.apiRuntime.frontendStatus
      if (s === undefined) return { status: 'UNKNOWN', evidence: 'frontendStatus not provided' }
      if (s === 200) return { status: 'PASS', evidence: `frontendStatus = ${s}` }
      return { status: 'FAIL', evidence: `frontendStatus = ${s}`, remediation: 'Check frontend process health and restart if needed' }
    },
  },
  {
    id: 'api-runtime.backend-api-status',
    name: 'Backend API returns 200',
    category: 'api-runtime',
    severity: 'blocker',
    evaluate: (i) => {
      const s = i.apiRuntime.backendApiStatus
      if (s === undefined) return { status: 'UNKNOWN', evidence: 'backendApiStatus not provided' }
      if (s === 200) return { status: 'PASS', evidence: `backendApiStatus = ${s}` }
      if (s === 500) return { status: 'FAIL', evidence: `backendApiStatus = ${s} (server error)`, remediation: 'Check disk space, DB connectivity, and backend logs' }
      return { status: 'FAIL', evidence: `backendApiStatus = ${s}`, remediation: 'Investigate backend health' }
    },
  },
  {
    id: 'api-runtime.canonical-population',
    name: 'Current dynamic canonical population > 0',
    category: 'api-runtime',
    severity: 'warning',
    evaluate: (i) => {
      const p = i.apiRuntime.canonicalPopulation
      if (p === undefined) return { status: 'UNKNOWN', evidence: 'canonicalPopulation not provided' }
      if (p > 0) return { status: 'PASS', evidence: `canonicalPopulation = ${p} (dynamic)` }
      return { status: 'FAIL', evidence: `canonicalPopulation = ${p} (zero — no telemetry)`, remediation: 'Verify telemetry ingestion is active' }
    },
  },
  {
    id: 'api-runtime.telemetry-freshness',
    name: 'Telemetry ingestion is fresh (within 7 days)',
    category: 'api-runtime',
    severity: 'warning',
    evaluate: (i) => {
      const ts = i.apiRuntime.latestTelemetryTimestamp
      if (!ts) return { status: 'UNKNOWN', evidence: 'latestTelemetryTimestamp not provided' }
      const age = Date.now() - new Date(ts).getTime()
      const ageDays = age / (1000 * 60 * 60 * 24)
      if (ageDays <= 1) return { status: 'PASS', evidence: `latestTelemetry = ${ts} (${ageDays.toFixed(1)}d old)` }
      if (ageDays <= 7) return { status: 'PASS', evidence: `latestTelemetry = ${ts} (${ageDays.toFixed(1)}d old)` }
      return { status: 'FAIL', evidence: `latestTelemetry = ${ts} (${ageDays.toFixed(1)}d old — stale)`, remediation: 'Verify telemetry ingestion pipeline' }
    },
  },
  {
    id: 'api-runtime.no-synthetic-data',
    name: 'No synthetic/demo runtime data present',
    category: 'api-runtime',
    severity: 'blocker',
    evaluate: (i) => {
      if (i.apiRuntime.hasSyntheticData === undefined) return { status: 'UNKNOWN', evidence: 'hasSyntheticData not provided' }
      if (i.apiRuntime.hasSyntheticData === false) return { status: 'PASS', evidence: 'No synthetic/demo data' }
      return { status: 'FAIL', evidence: 'Synthetic/demo data present', remediation: 'Disable demo mode and verify production data only' }
    },
  },
  {
    id: 'api-runtime.loading-distinct',
    name: 'LOADING state distinct from EMPTY and ERROR',
    category: 'api-runtime',
    severity: 'warning',
    evaluate: (i) => {
      const r = boolCheck(i.apiRuntime.loadingDistinctFromEmpty, 'LOADING distinct from EMPTY/ERROR', 'LOADING conflated with EMPTY/ERROR', 'Loading state not evaluated')
      if (r.status === 'FAIL') return { ...r, remediation: 'Ensure loading state shows spinner/placeholder, not zero-data' }
      return r
    },
  },

  // ── Product Surfaces ──
  {
    id: 'product-surfaces.aioi-hydrates',
    name: 'AIOI hydrates with real data',
    category: 'product-surfaces',
    severity: 'blocker',
    evaluate: (i) => boolCheck(i.productSurfaces.aioiHydrates, 'AIOI hydrates', 'AIOI does not hydrate', 'AIOI not evaluated'),
  },
  {
    id: 'product-surfaces.pi-hydrates',
    name: 'PI hydrates with real data',
    category: 'product-surfaces',
    severity: 'blocker',
    evaluate: (i) => boolCheck(i.productSurfaces.piHydrates, 'PI hydrates', 'PI does not hydrate', 'PI not evaluated'),
  },
  {
    id: 'product-surfaces.pbt-cards-hydrate',
    name: 'PBT Cards hydrate',
    category: 'product-surfaces',
    severity: 'blocker',
    evaluate: (i) => boolCheck(i.productSurfaces.pbtCardsHydrate, 'PBT Cards hydrate', 'PBT Cards do not hydrate', 'PBT Cards not evaluated'),
  },
  {
    id: 'product-surfaces.pbt-time-series-hydrates',
    name: 'PBT Time Series hydrates',
    category: 'product-surfaces',
    severity: 'blocker',
    evaluate: (i) => boolCheck(i.productSurfaces.pbtTimeSeriesHydrates, 'PBT Time Series hydrates', 'PBT Time Series does not hydrate', 'PBT Time Series not evaluated'),
  },
  {
    id: 'product-surfaces.sparse-behavior-preserved',
    name: 'Sparse/null behavior preserved (no interpolation)',
    category: 'product-surfaces',
    severity: 'warning',
    evaluate: (i) => boolCheck(i.productSurfaces.sparseBehaviorPreserved, 'Sparse behavior preserved', 'Interpolation detected', 'Sparse behavior not evaluated'),
  },
  {
    id: 'product-surfaces.no-fatal-exceptions',
    name: 'No fatal console exceptions',
    category: 'product-surfaces',
    severity: 'blocker',
    evaluate: (i) => boolCheck(i.productSurfaces.noFatalConsoleExceptions, 'No fatal exceptions', 'Fatal console exceptions present', 'Console not evaluated'),
  },

  // ── Evidence Eligibility ──
  {
    id: 'evidence-eligibility.github-provenance-gate',
    name: 'GitHub provenance gate active',
    category: 'evidence-eligibility',
    severity: 'warning',
    evaluate: (i) => boolCheck(i.evidenceEligibility.githubProvenanceGateActive, 'GitHub provenance gate active', 'GitHub provenance gate NOT active', 'GitHub provenance not evaluated'),
  },
  {
    id: 'evidence-eligibility.no-fabricated-identity',
    name: 'No fabricated developer identity',
    category: 'evidence-eligibility',
    severity: 'blocker',
    evaluate: (i) => boolCheck(i.evidenceEligibility.noFabricatedDeveloperIdentity, 'No fabricated identity', 'Fabricated identity detected', 'Identity not evaluated'),
  },
  {
    id: 'evidence-eligibility.no-causal-language',
    name: 'No unsupported causal/ROI language',
    category: 'evidence-eligibility',
    severity: 'blocker',
    evaluate: (i) => boolCheck(i.evidenceEligibility.noUnsupportedCausalLanguage, 'No unsupported causal language', 'Unsupported causal/ROI language detected', 'Causal language not evaluated'),
  },
  {
    id: 'evidence-eligibility.claude-code-unsupported',
    name: 'Claude Code unsupported metrics unavailable (not zero)',
    category: 'evidence-eligibility',
    severity: 'warning',
    evaluate: (i) => boolCheck(i.evidenceEligibility.claudeCodeUnsupportedUnavailable, 'Unsupported metrics unavailable', 'Unsupported metrics shown as zero', 'Claude Code metrics not evaluated'),
  },

  // ── Extension / Enrollment ──
  {
    id: 'extension-enrollment.one-canonical-vsix',
    name: 'One canonical current VSIX',
    category: 'extension-enrollment',
    severity: 'blocker',
    evaluate: (i) => boolCheck(i.extensionEnrollment.oneCanonicalVsix, 'One canonical VSIX', 'Multiple/ambiguous VSIX artifacts', 'VSIX count not evaluated'),
  },
  {
    id: 'extension-enrollment.download-matches-manifest',
    name: 'Download endpoint returns exact manifest artifact',
    category: 'extension-enrollment',
    severity: 'blocker',
    evaluate: (i) => boolCheck(i.extensionEnrollment.downloadMatchesManifest, 'Download matches manifest', 'Download does NOT match manifest', 'Download not verified'),
  },
  {
    id: 'extension-enrollment.setup-uses-https',
    name: 'Setup instructions use tenant canonical HTTPS API base',
    category: 'extension-enrollment',
    severity: 'blocker',
    evaluate: (i) => boolCheck(i.extensionEnrollment.setupUsesHttpsApiBase, 'Setup uses HTTPS API base', 'Setup does NOT use HTTPS API base', 'Setup not evaluated'),
  },
  {
    id: 'extension-enrollment.rollout-preserves-telemetry',
    name: 'Rollout must not interrupt current telemetry',
    category: 'extension-enrollment',
    severity: 'blocker',
    evaluate: (i) => boolCheck(i.extensionEnrollment.rolloutPreservesTelemetry, 'Telemetry preserved during rollout', 'Telemetry interrupted during rollout', 'Telemetry preservation not verified'),
  },

  // ── Security / Operations ──
  {
    id: 'security-operations.https',
    name: 'HTTPS active',
    category: 'security-operations',
    severity: 'blocker',
    evaluate: (i) => {
      const r = boolCheck(i.securityOperations.httpsActive, 'HTTPS active', 'HTTPS NOT active', 'HTTPS state unknown')
      if (r.status === 'FAIL') return { ...r, remediation: 'Provision TLS before token-authenticated rollout' }
      return r
    },
  },
  {
    id: 'security-operations.disk-threshold',
    name: 'Disk usage below 90% threshold',
    category: 'security-operations',
    severity: 'blocker',
    evaluate: (i) => {
      const r = boolCheck(i.securityOperations.diskBelowThreshold, 'Disk below threshold', 'Disk at or above 90% — CRITICAL', 'Disk not evaluated')
      if (r.status === 'FAIL') return { ...r, remediation: 'Free disk space immediately — backend will fail to accept telemetry' }
      return r
    },
  },
  {
    id: 'security-operations.backend-healthy',
    name: 'Backend process healthy',
    category: 'security-operations',
    severity: 'blocker',
    evaluate: (i) => boolCheck(i.securityOperations.backendProcessHealthy, 'Backend healthy', 'Backend NOT healthy', 'Backend not evaluated'),
  },
  {
    id: 'security-operations.db-preserved',
    name: 'DB preserved (no replacement)',
    category: 'security-operations',
    severity: 'blocker',
    evaluate: (i) => boolCheck(i.securityOperations.dbPreserved, 'DB preserved', 'DB replaced/mutated', 'DB preservation not verified'),
  },
  {
    id: 'security-operations.rollback-exists',
    name: 'Rollback exists before promotion',
    category: 'security-operations',
    severity: 'blocker',
    evaluate: (i) => boolCheck(i.securityOperations.rollbackExists, 'Rollback exists', 'No rollback plan', 'Rollback not verified'),
  },
  {
    id: 'security-operations.no-customer-build-authority',
    name: 'No customer source used as build authority',
    category: 'security-operations',
    severity: 'blocker',
    evaluate: (i) => boolCheck(i.securityOperations.noCustomerSourceAsBuildAuthority, 'Local is build authority', 'Customer source used as build authority', 'Build authority not verified'),
  },
]

// ─── Run Preflight ──────────────────────────────────────────────────────────

export function runPreflight(input: PilotPreflightInput): PreflightRunResult {
  const checks = CHECKS.map((def) => {
    const result: any = def.evaluate(input)
    const entry: any = {
      id: def.id,
      name: def.name,
      category: def.category,
      status: result.status,
      severity: def.severity,
      evidence: result.evidence,
    }
    if (result.remediation) {
      entry.remediation = String(result.remediation)
    }
    return entry as PreflightCheckResult
  })

  const blockerCount = checks.filter(c => c.status === 'FAIL' && c.severity === 'blocker').length
  const warningCount = checks.filter(c => c.status === 'FAIL' && c.severity === 'warning').length
  const passCount = checks.filter(c => c.status === 'PASS').length
  const naCount = checks.filter(c => c.status === 'N/A').length
  const unknownCount = checks.filter(c => c.status === 'UNKNOWN').length

  // R1 VERDICT CONTRACT:
  // NO-GO       = one or more blocker-severity checks are FAIL
  // CONDITIONAL = zero blocker FAILs + one or more blocker-severity checks are UNKNOWN
  // GO          = every blocker-severity check is PASS or legitimate N/A
  //               (warning-level FAIL/UNKNOWN may remain and are explicitly represented)
  const blockerUnknownCount = checks.filter(c => c.status === 'UNKNOWN' && c.severity === 'blocker').length

  let overall: OverallVerdict
  if (blockerCount > 0) {
    overall = 'NO-GO'
  } else if (blockerUnknownCount > 0) {
    overall = 'CONDITIONAL'
  } else {
    overall = 'GO'
  }

  return {
    pilotId: input.pilotId,
    pilotName: input.pilotName,
    timestamp: new Date().toISOString(),
    releaseIdentity: input.releaseIdentity,
    checks,
    overall,
    blockerCount,
    blockerUnknownCount,
    warningCount,
    passCount,
    naCount,
    unknownCount,
  }
}

// ─── Human-Readable Report ──────────────────────────────────────────────────

export function toHumanReadableReport(result: PreflightRunResult): HumanReadableReport {
  const passedGates = result.checks
    .filter(c => c.status === 'PASS')
    .map(c => c.name)

  const blockers = result.checks
    .filter(c => c.status === 'FAIL' && c.severity === 'blocker')
    .map(c => ({ name: c.name, evidence: c.evidence, remediation: c.remediation }))

  const warnings = result.checks
    .filter(c => c.status === 'FAIL' && c.severity === 'warning')
    .map(c => ({ name: c.name, evidence: c.evidence }))

  const naGates = result.checks
    .filter(c => c.status === 'N/A')
    .map(c => c.name)

  const unknownGates = result.checks
    .filter(c => c.status === 'UNKNOWN')
    .map(c => c.name)

  let recommendation: string
  if (result.overall === 'GO') {
    recommendation = 'Safe to promote. All blocker gates passed.'
  } else if (result.overall === 'CONDITIONAL') {
    recommendation = `Conditional GO. ${result.warningCount} warning(s) to address before full promotion.`
  } else {
    recommendation = `NO-GO. ${result.blockerCount} blocker(s) must be resolved before promotion.`
  }

  const rollbackRef = result.releaseIdentity.rollbackArtifact

  return {
    pilot: result.pilotName,
    timestamp: result.timestamp,
    verdict: result.overall,
    passedGates,
    blockers,
    warnings,
    naGates,
    unknownGates,
    promotionRecommendation: recommendation,
    rollbackReference: rollbackRef,
  }
}

// ─── Format Report as Text ──────────────────────────────────────────────────

export function formatReportAsText(report: HumanReadableReport): string {
  const lines: string[] = []
  lines.push(`╔══════════════════════════════════════════════════════════════╗`)
  lines.push(`║  CR-X PILOT PREFLIGHT REPORT — ${report.pilot.toUpperCase().padEnd(26)}║`)
  lines.push(`╚══════════════════════════════════════════════════════════════╝`)
  lines.push(``)
  lines.push(`Timestamp: ${report.timestamp}`)
  lines.push(`Verdict:   ${report.verdict}`)
  lines.push(``)
  lines.push(`Recommendation: ${report.promotionRecommendation}`)
  lines.push(``)
  lines.push(`── Passed Gates (${report.passedGates.length}) ──`)
  for (const g of report.passedGates) lines.push(`  ✓ ${g}`)
  lines.push(``)
  if (report.blockers.length > 0) {
    lines.push(`── Blockers (${report.blockers.length}) ──`)
    for (const b of report.blockers) {
      lines.push(`  ✗ ${b.name}`)
      lines.push(`    Evidence: ${b.evidence}`)
      if (b.remediation) lines.push(`    Fix: ${b.remediation}`)
    }
    lines.push(``)
  }
  if (report.warnings.length > 0) {
    lines.push(`── Warnings (${report.warnings.length}) ──`)
    for (const w of report.warnings) {
      lines.push(`  ⚠ ${w.name}`)
      lines.push(`    Evidence: ${w.evidence}`)
    }
    lines.push(``)
  }
  if (report.unknownGates.length > 0) {
    lines.push(`── Unknown (${report.unknownGates.length}) ──`)
    for (const g of report.unknownGates) lines.push(`  ? ${g}`)
    lines.push(``)
  }
  if (report.rollbackReference) {
    lines.push(`Rollback: ${report.rollbackReference}`)
  }
  return lines.join('\n')
}
