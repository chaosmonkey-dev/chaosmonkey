export type GithubEvidenceState =
  | 'CONNECTED'
  | 'CONNECTED_NO_ELIGIBLE_DATA'
  | 'LOGIN_ONLY'
  | 'PARTIAL'
  | 'NOT_CONNECTED'

/**
 * 18G.1: Resolve the dashboard GitHub engineering-evidence state.
 *
 * OAuth status (/api/github/oauth/status) is the canonical connection
 * authority — identical to the Settings surface. Metrics may only refine
 * data-availability sub-states once a connection is proven; a failed or
 * stale metrics fetch can never downgrade a proven connection.
 */
export function resolveGithubEvidenceState(opts: {
  oauthStatusLoaded: boolean
  oauthPurpose: string | null | undefined
  metricsState?: string | null
  legacyConnected?: boolean
  appInstalled?: boolean
}): GithubEvidenceState {
  const { oauthStatusLoaded, oauthPurpose, metricsState, legacyConnected, appInstalled } = opts

  // The backend emits CONNECTED_NO_CUSTOMER_REPO_AUTHORITY when the
  // engineering credential exists but lacks customer repository authority
  // (repo_authority=false, no eligible delivery evidence). That maps to the
  // customer-facing "Connected · No Data" state — never NOT_CONNECTED.
  const isNoDataState = metricsState === 'CONNECTED_NO_ELIGIBLE_DATA'
    || metricsState === 'CONNECTED_NO_CUSTOMER_REPO_AUTHORITY'

  // Dedicated GitHub App: a configured customer installation is itself the
  // engineering-evidence authority — independent of any user's OAuth scope.
  const appState = metricsState === 'CONNECTED'
    ? 'CONNECTED'
    : 'CONNECTED_NO_ELIGIBLE_DATA'

  if (oauthStatusLoaded) {
    if (oauthPurpose === 'engineering_integration') {
      return isNoDataState
        ? 'CONNECTED_NO_ELIGIBLE_DATA'
        : 'CONNECTED'
    }
    if (appInstalled) return appState
    if (oauthPurpose === 'identity_only') return 'LOGIN_ONLY'
    if (oauthPurpose) return 'PARTIAL'
    return 'NOT_CONNECTED'
  }

  // OAuth status unresolved — legacy metrics-derived path.
  if (appInstalled) return appState
  if (isNoDataState) return 'CONNECTED_NO_ELIGIBLE_DATA'
  if (metricsState === 'CONNECTED' || metricsState === 'CONNECTED_NO_ELIGIBLE_DATA'
    || metricsState === 'LOGIN_ONLY' || metricsState === 'PARTIAL'
    || metricsState === 'NOT_CONNECTED') {
    return metricsState
  }
  return legacyConnected ? 'CONNECTED' : 'NOT_CONNECTED'
}
