/**
 * CR-X Generic Pilot Preflight Contract — Schema
 *
 * Defines the reusable, tenant-agnostic preflight contract that determines:
 *   "Can the exact accepted ChaosMonkey product be safely and repeatably
 *    promoted to another real pilot without environment-specific improvisation?"
 *
 * Each pilot populates a PilotPreflightInput with tenant-specific values.
 * The harness runs the same invariant checks against every pilot.
 *
 * No pilot-specific code. No hardcoded session/workflow counts.
 * All populations are dynamic.
 */

// ─── Check Status ───────────────────────────────────────────────────────────

export type CheckStatus = 'PASS' | 'FAIL' | 'N/A' | 'UNKNOWN'

export type CheckSeverity = 'blocker' | 'warning' | 'info'

export type OverallVerdict = 'GO' | 'NO-GO' | 'CONDITIONAL'

// ─── Check Categories ───────────────────────────────────────────────────────

export type CheckCategory =
  | 'release-identity'
  | 'tenant-identity'
  | 'api-runtime'
  | 'product-surfaces'
  | 'evidence-eligibility'
  | 'extension-enrollment'
  | 'security-operations'

// ─── Individual Check Result ────────────────────────────────────────────────

export interface PreflightCheckResult {
  /** Stable check ID (e.g., 'release-identity.vsix-sha256') */
  id: string
  /** Human-readable check name */
  name: string
  /** Category grouping */
  category: CheckCategory
  /** PASS / FAIL / N/A / UNKNOWN */
  status: CheckStatus
  /** blocker / warning / info */
  severity: CheckSeverity
  /** Evidence or reason for the status */
  evidence: string
  /** What to fix if FAIL */
  remediation?: string
}

// ─── Pilot Preflight Input (tenant-specific) ────────────────────────────────

export interface PilotPreflightInput {
  /** Pilot identifier (e.g., 'ed', 'kasey', 'patra', 'ryan') */
  pilotId: string
  /** Human-readable pilot name */
  pilotName: string

  // ── Release Identity ──
  releaseIdentity: {
    /** Canonical Local source commit SHA */
    localSourceCommit?: string
    /** Frontend build hash or version */
    frontendBuildId?: string
    /** Current extension version (e.g., '0.4.1') */
    extensionVersion?: string
    /** Canonical VSIX filename */
    vsixFilename?: string
    /** SHA-256 of the canonical VSIX */
    vsixSha256?: string
    /** VSIX file size in bytes */
    vsixSizeBytes?: number
    /** Canonical download endpoint */
    canonicalDownloadEndpoint?: string
    /** Rollback artifact location or reference */
    rollbackArtifact?: string
  }

  // ── Tenant Identity ──
  tenantIdentity: {
    /** Public hostname (e.g., 'pilot.example.com') */
    hostname?: string
    /** Whether HTTPS is active */
    httpsActive?: boolean
    /** API base URL (e.g., 'https://pilot.example.com') */
    apiBaseUrl?: string
    /** Dashboard login URL */
    dashboardLoginUrl?: string
    /** Organization/tenant identity label */
    orgIdentity?: string
    /** Whether built assets contain localhost/wrong-host references */
    hasLocalhostInBuild?: boolean
  }

  // ── API / Runtime ──
  apiRuntime: {
    /** Frontend HTTP status (200 = healthy) */
    frontendStatus?: number
    /** Backend API health status (200 = healthy) */
    backendApiStatus?: number
    /** Canonical telemetry endpoint */
    canonicalTelemetryEndpoint?: string
    /** Current dynamic canonical session population */
    canonicalPopulation?: number
    /** Number of presented workflows */
    workflowCount?: number
    /** Latest telemetry timestamp (ISO 8601) */
    latestTelemetryTimestamp?: string
    /** Whether synthetic/demo runtime data is present */
    hasSyntheticData?: boolean
    /** Loading state is distinguishable from empty/error */
    loadingDistinctFromEmpty?: boolean
  }

  // ── Product Surfaces ──
  productSurfaces: {
    /** AIOI hydrates with real data */
    aioiHydrates?: boolean
    /** PI hydrates with real data */
    piHydrates?: boolean
    /** Top Insights / All Insights accessible */
    insightsAccessible?: boolean
    /** Diagnostics/data gaps separated from findings */
    diagnosticsSeparated?: boolean
    /** PBT Cards hydrate */
    pbtCardsHydrate?: boolean
    /** PBT Time Series hydrate */
    pbtTimeSeriesHydrates?: boolean
    /** Metric switching works */
    metricSwitchingWorks?: boolean
    /** Time filtering works */
    timeFilteringWorks?: boolean
    /** Sparse/null behavior preserved (no interpolation) */
    sparseBehaviorPreserved?: boolean
    /** No fatal console exceptions */
    noFatalConsoleExceptions?: boolean
  }

  // ── Evidence Eligibility ──
  evidenceEligibility: {
    /** GitHub provenance gate active */
    githubProvenanceGateActive?: boolean
    /** Unsupported GitHub outcomes suppressed */
    unsupportedGithubSuppressed?: boolean
    /** Claude Code unsupported metrics unavailable (not zero) */
    claudeCodeUnsupportedUnavailable?: boolean
    /** Cost context only when configured and valid */
    costContextGuarded?: boolean
    /** No fabricated developer identity */
    noFabricatedDeveloperIdentity?: boolean
    /** No unsupported causal/ROI language */
    noUnsupportedCausalLanguage?: boolean
  }

  // ── Extension / Enrollment ──
  extensionEnrollment: {
    /** One canonical current VSIX */
    oneCanonicalVsix?: boolean
    /** Download endpoint returns exact manifest artifact */
    downloadMatchesManifest?: boolean
    /** Per-developer enrollment works */
    enrollmentWorks?: boolean
    /** Setup instructions use tenant canonical HTTPS API base */
    setupUsesHttpsApiBase?: boolean
    /** Upgrade compatibility documented */
    upgradeCompatibilityDocumented?: boolean
    /** Legacy ingestion compatibility checked */
    legacyIngestionCompatible?: boolean
    /** Rollout must not interrupt current telemetry */
    rolloutPreservesTelemetry?: boolean
  }

  // ── Security / Operations ──
  securityOperations: {
    /** HTTPS active */
    httpsActive?: boolean
    /** CORS/API origin sane */
    corsOriginSane?: boolean
    /** Disk usage below threshold (e.g., < 90%) */
    diskBelowThreshold?: boolean
    /** Backend process healthy */
    backendProcessHealthy?: boolean
    /** Frontend process healthy */
    frontendProcessHealthy?: boolean
    /** DB preserved (no replacement) */
    dbPreserved?: boolean
    /** OAuth/token state preserved */
    tokenStatePreserved?: boolean
    /** Rollback exists before promotion */
    rollbackExists?: boolean
    /** No DB replacement */
    noDbReplacement?: boolean
    /** No customer source used as build authority */
    noCustomerSourceAsBuildAuthority?: boolean
  }
}

// ─── Preflight Run Result ───────────────────────────────────────────────────

export interface PreflightRunResult {
  /** Pilot identifier */
  pilotId: string
  /** Pilot name */
  pilotName: string
  /** ISO 8601 timestamp of the run */
  timestamp: string
  /** Release identity snapshot */
  releaseIdentity: PilotPreflightInput['releaseIdentity']
  /** All check results */
  checks: PreflightCheckResult[]
  /** Overall verdict */
  overall: OverallVerdict
  /** Count of blocker-severity FAILs */
  blockerCount: number
  /** Count of blocker-severity UNKNOWNs (required evidence not yet supplied) */
  blockerUnknownCount: number
  /** Count of warning-severity FAILs */
  warningCount: number
  /** Count of PASS checks */
  passCount: number
  /** Count of N/A checks */
  naCount: number
  /** Count of UNKNOWN checks */
  unknownCount: number
}

// ─── Human-Readable Report ──────────────────────────────────────────────────

export interface HumanReadableReport {
  /** Pilot name */
  pilot: string
  /** Timestamp */
  timestamp: string
  /** Overall verdict */
  verdict: OverallVerdict
  /** Passed gates (concise list) */
  passedGates: string[]
  /** Blockers (with remediation) */
  blockers: Array<{ name: string; evidence: string; remediation?: string }>
  /** Warnings */
  warnings: Array<{ name: string; evidence: string }>
  /** N/A gates */
  naGates: string[]
  /** UNKNOWN gates */
  unknownGates: string[]
  /** Promotion recommendation */
  promotionRecommendation: string
  /** Rollback reference */
  rollbackReference?: string
}
