/**
 * 18G.1: Dashboard GitHub connection badge — OAuth status authority.
 *
 * Proves:
 * 1. Connection state stays CONNECTED when engineering OAuth status is valid
 *    even if the metrics fetch fails or is absent.
 * 2. Metrics may only refine data-availability sub-states once connection
 *    is proven — never downgrade a proven connection.
 * 3. identity_only OAuth can never read as engineering CONNECTED.
 * 4. Dashboards.vue sources authority from /api/github/oauth/status
 *    (same canonical endpoint as Settings), not metrics success.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { resolveGithubEvidenceState } from '../lib/githubEvidenceState'

describe('18G.1: dashboard GitHub connection authority', () => {
  it('stays CONNECTED when engineering OAuth is valid and metrics fetch failed', () => {
    // metricsState undefined = metrics request failed / never resolved
    expect(resolveGithubEvidenceState({
      oauthStatusLoaded: true,
      oauthPurpose: 'engineering_integration',
      metricsState: undefined,
      legacyConnected: false,
    })).toBe('CONNECTED')
  })

  it('metrics cannot downgrade a proven connection to NOT_CONNECTED', () => {
    // Even a stale metrics payload claiming NOT_CONNECTED must not override
    // OAuth authority.
    expect(resolveGithubEvidenceState({
      oauthStatusLoaded: true,
      oauthPurpose: 'engineering_integration',
      metricsState: 'NOT_CONNECTED',
      legacyConnected: false,
    })).toBe('CONNECTED')
  })

  it('metrics may refine proven connection to CONNECTED_NO_ELIGIBLE_DATA', () => {
    expect(resolveGithubEvidenceState({
      oauthStatusLoaded: true,
      oauthPurpose: 'engineering_integration',
      metricsState: 'CONNECTED_NO_ELIGIBLE_DATA',
      legacyConnected: true,
    })).toBe('CONNECTED_NO_ELIGIBLE_DATA')
  })

  it('identity_only never resolves as engineering CONNECTED', () => {
    expect(resolveGithubEvidenceState({
      oauthStatusLoaded: true,
      oauthPurpose: 'identity_only',
      metricsState: 'CONNECTED',
      legacyConnected: true,
    })).toBe('LOGIN_ONLY')
  })

  it('unknown purpose resolves PARTIAL, absent token NOT_CONNECTED', () => {
    expect(resolveGithubEvidenceState({
      oauthStatusLoaded: true,
      oauthPurpose: 'legacy_unknown',
      metricsState: null,
    })).toBe('PARTIAL')
    expect(resolveGithubEvidenceState({
      oauthStatusLoaded: true,
      oauthPurpose: null,
      metricsState: null,
    })).toBe('NOT_CONNECTED')
  })

  it('maps CONNECTED_NO_CUSTOMER_REPO_AUTHORITY to Connected · No Data (OAuth path)', () => {
    // Ed backend truth: engineering_integration OAuth valid, repo_authority
    // false → /api/metrics emits CONNECTED_NO_CUSTOMER_REPO_AUTHORITY.
    // That must never resolve to NOT_CONNECTED and never read as plain
    // CONNECTED (which would imply eligible delivery evidence).
    expect(resolveGithubEvidenceState({
      oauthStatusLoaded: true,
      oauthPurpose: 'engineering_integration',
      metricsState: 'CONNECTED_NO_CUSTOMER_REPO_AUTHORITY',
      legacyConnected: false,
    })).toBe('CONNECTED_NO_ELIGIBLE_DATA')
  })

  it('maps CONNECTED_NO_CUSTOMER_REPO_AUTHORITY in the metrics fallback path', () => {
    expect(resolveGithubEvidenceState({
      oauthStatusLoaded: false,
      oauthPurpose: null,
      metricsState: 'CONNECTED_NO_CUSTOMER_REPO_AUTHORITY',
      legacyConnected: false,
    })).toBe('CONNECTED_NO_ELIGIBLE_DATA')
  })

  it('falls back to metrics state only while OAuth status is unresolved', () => {
    expect(resolveGithubEvidenceState({
      oauthStatusLoaded: false,
      oauthPurpose: null,
      metricsState: 'LOGIN_ONLY',
      legacyConnected: true,
    })).toBe('LOGIN_ONLY')
    expect(resolveGithubEvidenceState({
      oauthStatusLoaded: false,
      oauthPurpose: null,
      metricsState: undefined,
      legacyConnected: true,
    })).toBe('CONNECTED')
  })

  it('installed GitHub App is an independent engineering-evidence authority', () => {
    // App installed + identity-only OAuth → engineering evidence exists via
    // the App installation; must never resolve LOGIN_ONLY or NOT_CONNECTED.
    expect(resolveGithubEvidenceState({
      oauthStatusLoaded: true,
      oauthPurpose: 'identity_only',
      metricsState: 'CONNECTED',
      appInstalled: true,
    })).toBe('CONNECTED')
    // No OAuth at all + App installed + no rows yet → Connected · No Data.
    expect(resolveGithubEvidenceState({
      oauthStatusLoaded: true,
      oauthPurpose: null,
      metricsState: 'CONNECTED_NO_ELIGIBLE_DATA',
      appInstalled: true,
    })).toBe('CONNECTED_NO_ELIGIBLE_DATA')
    // OAuth status fetch failed — App flag from the same payload is absent,
    // so the metrics-derived state still applies.
    expect(resolveGithubEvidenceState({
      oauthStatusLoaded: false,
      oauthPurpose: null,
      metricsState: 'CONNECTED',
      appInstalled: true,
    })).toBe('CONNECTED')
    // App absent + no OAuth → unchanged NOT_CONNECTED.
    expect(resolveGithubEvidenceState({
      oauthStatusLoaded: true,
      oauthPurpose: null,
      metricsState: null,
      appInstalled: false,
    })).toBe('NOT_CONNECTED')
  })

  it('Dashboards.vue sources connection authority from /api/github/oauth/status', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../pages/Dashboards.vue'),
      'utf-8'
    )
    expect(source).toContain('/github/oauth/status')
    expect(source).toContain('refreshGithubOauthStatus')
    expect(source).toContain('resolveGithubEvidenceState')
    expect(source).toContain('engineering_integration')
  })
})
