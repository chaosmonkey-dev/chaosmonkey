/**
 * Shared in-flight GitHub OAuth status request.
 *
 * Dashboards.vue and NavUserAvatar.vue both need GET /api/github/oauth/status
 * on dashboard mount. On the single-process backend, the two concurrent
 * requests serialize and the second one queues behind everything else.
 * Concurrent callers now share one in-flight request.
 *
 * Semantics:
 * - In-flight dedupe only: once the request settles, the promise is cleared
 *   so a later call always gets a FRESH status (permission grants/revocations
 *   and login changes are reflected on the next refresh cycle).
 * - The parsed body is shared (Response.json() is single-consumption).
 * - authenticatedFetch adds the Bearer token so org context is identical to
 *   the previous per-caller requests; credentials:'include' preserves the
 *   cookie path NavUserAvatar relied on.
 * - Dashboard auth vs GitHub OAuth remain distinct: callers decide how to
 *   interpret oauth_authenticated / token_purpose; this helper never
 *   fabricates a status.
 */
import { authenticatedFetch, API_URL } from '../config/api'

export interface GithubOauthStatusResult {
  ok: boolean
  status: number
  data: any
}

let _inFlight: Promise<GithubOauthStatusResult> | null = null

export function getGithubOauthStatus(): Promise<GithubOauthStatusResult> {
  if (!_inFlight) {
    _inFlight = authenticatedFetch(`${API_URL}/github/oauth/status`, { credentials: 'include' })
      .then(async (response) => ({
        ok: response.ok,
        status: response.status,
        data: await response.json().catch(() => null),
      }))
      .finally(() => {
        _inFlight = null
      })
  }
  return _inFlight
}
