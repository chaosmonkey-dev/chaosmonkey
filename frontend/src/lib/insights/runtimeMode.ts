/**
 * Runtime mode detection
 *
 * Single source of truth for live-pilot vs local-lab mode detection.
 * All UI surfaces, PI engines, and generators should import from here.
 *
 * CR4 FINAL — TWO EVIDENCE MODES:
 *
 * 1. LIVE/CUSTOMER MODE (non-localhost):
 *    - Real telemetry only for telemetry findings
 *    - Real GitHub history only for GitHub findings
 *    - Seeded/synthetic evidence is NEVER eligible
 *    - No simulated fallbacks
 *
 * 2. LOCAL PI LAB MODE (localhost/127.*):
 *    - Seeded telemetry/GitHub MAY be used to exercise PI generators
 *    - MUST be tagged as seeded/simulated/development evidence
 *    - MUST NEVER be represented as customer truth
 *    - Used to test, tune, and verify PI families before pilots arrive
 */

export type PilotMode = 'live' | 'lab'

/**
 * Check if the current host is a localhost/loopback address.
 */
export function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return /^127\./.test(host) || host === 'localhost' || host === '0.0.0.0'
}

/**
 * Check if the current host is a 127.* loopback address.
 */
export function isLoopbackHost(): boolean {
  return isLocalhost()
}

/**
 * Local PI Lab mode: true on localhost/127.* hosts.
 * Seeded evidence is eligible for PI generation but must be labeled.
 */
export function isLocalLabMode(): boolean {
  return isLocalhost()
}

/**
 * Demo mode is disabled in production runtime.
 */
export function isDemoMode(): boolean {
  return false
}

/**
 * Stress mode is disabled in production runtime.
 */
export function isStressModeEnabled(): boolean {
  return false
}

/**
 * Live-pilot mode: true on non-localhost hosts.
 * This guard prevents seeded/fallback data from appearing on production EC2.
 */
export function isLivePilotMode(): boolean {
  if (typeof window === 'undefined') return false
  return !isLocalhost()
}

/**
 * Current pilot mode: 'lab' on localhost, 'live' on production hosts.
 */
export function getCurrentPilotMode(): PilotMode {
  return isLocalLabMode() ? 'lab' : 'live'
}

/**
 * Evidence mode determines whether seeded/synthetic evidence is eligible.
 *
 * - 'live': Only real telemetry + real GitHub evidence is eligible.
 *   Seeded data is rejected by the provenance gate.
 *
 * - 'lab': Seeded telemetry + seeded GitHub evidence is eligible for
 *   PI generation, but MUST be labeled as seeded/simulated.
 *   This is the Local PI Lab development mode.
 */
export type EvidenceMode = 'live' | 'lab'

export function getEvidenceMode(): EvidenceMode {
  return isLocalLabMode() ? 'lab' : 'live'
}

/**
 * CR5 V1 FINAL — Truthful telemetry label for the current environment.
 *
 * Local/Staging demo populations are historical, not live.
 * Ed (production) may continue to say "Live" when its telemetry is current.
 *
 * Use this wherever the UI displays a telemetry status word/phrase.
 */
export function getTelemetryStatusLabel(): string {
  return isLocalLabMode() ? 'Historical' : 'Live'
}

/**
 * Full descriptive label for the telemetry status banner.
 * Local: "Historical operational telemetry across IDE workflows"
 * Ed:    "Live operational telemetry across IDE workflows"
 */
export function getTelemetryStatusPhrase(): string {
  return isLocalLabMode()
    ? 'Historical operational telemetry across coding workflows'
    : 'Live operational telemetry across coding workflows'
}

/**
 * Short label for the PBT status indicator.
 * Local: "Historical · {{ timeWindow }}"
 * Ed:    "Live · {{ timeWindow }}"
 */
export function getTelemetryStatusShort(): string {
  return isLocalLabMode() ? 'Historical' : 'Live'
}

/**
 * Operational signal text for PBT cards.
 * Local: "Historical telemetry loaded"
 * Ed:    "Live telemetry active"
 */
export function getOperationalSignalText(): string {
  return isLocalLabMode() ? 'Historical telemetry loaded' : 'Live telemetry active'
}
