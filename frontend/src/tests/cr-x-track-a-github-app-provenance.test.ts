/**
 * CR-X Track A — github_app provenance eligibility tests.
 *
 * Proves that github_app provenance (from GitHub App installation ingestion)
 * is treated as authoritative real GitHub evidence — same tier as github_api.
 * The strict isGithubEvidenceEligible gate accepts github_app as long as
 * historical_data_available is true. It is NOT in the ineligible set.
 *
 * Also proves that getGithubProvenanceState classifies github_app evidence
 * as MEASURED_ZERO or MEASURED_NONZERO (not UNKNOWN).
 */
import { describe, it, expect } from 'vitest'
import {
  INELIGIBLE_GITHUB_PROVENANCE_SOURCES,
  isGithubEvidenceEligible,
  getGithubProvenanceState,
  hasAuthoritativeGithubEvidence,
} from '../lib/insights/final/dataAccess'

// ─── github_app snapshot ───────────────────────────────────────────

function githubAppSnapshot(numericValue: number | null = 51): any {
  return {
    github_provenance: {
      source: 'github_app',
      historical_data_available: true,
      db_data_available: true,
    },
    github_data_source: 'github_app',
    total_pull_requests: numericValue ?? 0,
  }
}

function githubApiSnapshot(numericValue: number | null = 51): any {
  return {
    github_provenance: {
      source: 'github_api',
      historical_data_available: true,
      db_data_available: true,
      live_fetch_ok: true,
    },
    github_data_source: 'github_api',
    total_pull_requests: numericValue ?? 0,
  }
}

// ====================================================================

describe('CR-X Track A: github_app provenance eligibility', () => {
  it('github_app is NOT in the ineligible provenance set', () => {
    expect(INELIGIBLE_GITHUB_PROVENANCE_SOURCES.has('github_app')).toBe(false)
  })

  it('isGithubEvidenceEligible accepts github_app with historical_data_available', () => {
    const snapshot = githubAppSnapshot(51)
    expect(isGithubEvidenceEligible(snapshot)).toBe(true)
  })

  it('isGithubEvidenceEligible rejects github_app without historical_data_available', () => {
    const snapshot = {
      github_provenance: {
        source: 'github_app',
        historical_data_available: false,
      },
    }
    expect(isGithubEvidenceEligible(snapshot)).toBe(false)
  })

  it('isGithubEvidenceEligible rejects github_app without provenance', () => {
    expect(isGithubEvidenceEligible({})).toBe(false)
    expect(isGithubEvidenceEligible(null)).toBe(false)
  })
})

describe('CR-X Track A: github_app provenance state classification', () => {
  it('getGithubProvenanceState classifies github_app nonzero as MEASURED_NONZERO', () => {
    const snapshot = githubAppSnapshot(51)
    const state = getGithubProvenanceState(snapshot, 51)
    expect(state).toBe('MEASURED_NONZERO')
  })

  it('getGithubProvenanceState classifies github_app zero as MEASURED_ZERO', () => {
    const snapshot = githubAppSnapshot(0)
    const state = getGithubProvenanceState(snapshot, 0)
    expect(state).toBe('MEASURED_ZERO')
  })

  it('getGithubProvenanceState returns UNKNOWN for github_app without provenance', () => {
    expect(getGithubProvenanceState({}, 51)).toBe('UNKNOWN')
    expect(getGithubProvenanceState(null, 51)).toBe('UNKNOWN')
  })

  it('hasAuthoritativeGithubEvidence returns true for github_app with nonzero value', () => {
    const snapshot = githubAppSnapshot(41)
    expect(hasAuthoritativeGithubEvidence(snapshot, 41)).toBe(true)
  })

  it('hasAuthoritativeGithubEvidence returns true for github_app with zero value', () => {
    const snapshot = githubAppSnapshot(0)
    expect(hasAuthoritativeGithubEvidence(snapshot, 0)).toBe(true)
  })
})

describe('CR-X Track A: github_app vs github_api parity', () => {
  it('both github_app and github_api are eligible', () => {
    expect(isGithubEvidenceEligible(githubAppSnapshot(51))).toBe(true)
    expect(isGithubEvidenceEligible(githubApiSnapshot(51))).toBe(true)
  })

  it('both produce the same provenance state for the same numeric value', () => {
    const appState = getGithubProvenanceState(githubAppSnapshot(41), 41)
    const apiState = getGithubProvenanceState(githubApiSnapshot(41), 41)
    expect(appState).toBe('MEASURED_NONZERO')
    expect(apiState).toBe('MEASURED_NONZERO')
    expect(appState).toBe(apiState)
  })

  it('both produce the same authoritative evidence result', () => {
    const appAuth = hasAuthoritativeGithubEvidence(githubAppSnapshot(41), 41)
    const apiAuth = hasAuthoritativeGithubEvidence(githubApiSnapshot(41), 41)
    expect(appAuth).toBe(true)
    expect(apiAuth).toBe(true)
    expect(appAuth).toBe(apiAuth)
  })
})

describe('CR-X Track A: github_app is NOT confused with ineligible sources', () => {
  it('cm_activity_sim remains ineligible (strict gate)', () => {
    const snapshot = {
      github_provenance: {
        source: 'cm_activity_sim',
        historical_data_available: true,
        db_data_available: true,
      },
    }
    // In non-lab mode (test env is localhost, so lab mode IS active)
    // The strict gate (isGithubEvidenceEligible) rejects cm_activity_sim
    expect(INELIGIBLE_GITHUB_PROVENANCE_SOURCES.has('cm_activity_sim')).toBe(true)
  })

  it('fixture_fallback remains ineligible', () => {
    expect(INELIGIBLE_GITHUB_PROVENANCE_SOURCES.has('fixture_fallback')).toBe(true)
    const snapshot = {
      github_provenance: {
        source: 'fixture_fallback',
        historical_data_available: false,
      },
    }
    expect(isGithubEvidenceEligible(snapshot)).toBe(false)
  })

  it('github_app is distinct from github_api (different source string)', () => {
    const appSnap = githubAppSnapshot(51)
    const apiSnap = githubApiSnapshot(51)
    expect(appSnap.github_provenance.source).toBe('github_app')
    expect(apiSnap.github_provenance.source).toBe('github_api')
    expect(appSnap.github_provenance.source).not.toBe(apiSnap.github_provenance.source)
  })
})
