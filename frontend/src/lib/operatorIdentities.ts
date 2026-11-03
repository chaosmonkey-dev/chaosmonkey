/**
 * Operator/support enrollment identities.
 *
 * Operator-created developer enrollments (instance setup, acceptance testing,
 * support accounts) can be excluded from the human-selectable "identified
 * developer" surfaces in analytics and team management. This is a
 * display-layer exclusion: the underlying invites, telemetry, and session
 * attribution are preserved untouched.
 *
 * The lists are explicit and narrow by design. Do NOT add broad email-domain
 * rules here — a team developer enrolled with a personal email must never be
 * hidden by a domain heuristic.
 *
 * Configure via the VITE_OPERATOR_EMAILS / VITE_OPERATOR_REPOS env vars
 * (comma-separated) at build time. Both default to empty.
 */
const envList = (key: string): string[] =>
  ((import.meta.env[key] as string | undefined) ?? '')
    .split(',')
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean)

const OPERATOR_ENROLLMENT_EMAILS = new Set<string>(envList('VITE_OPERATOR_EMAILS'))

/**
 * Returns true when an invite/member email belongs to a configured operator
 * enrollment that should not appear as a developer identity.
 */
export function isOperatorEnrollmentEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== 'string') return false
  return OPERATOR_ENROLLMENT_EMAILS.has(email.trim().toLowerCase())
}

const OPERATOR_ONLY_REPO_IDENTITIES = new Set<string>(envList('VITE_OPERATOR_REPOS'))

/**
 * Returns true when a normalized repo identity is configured as operator-only
 * and must not appear in repository selectors/analytics.
 */
export function isOperatorOnlyRepoIdentity(normalizedRepoId: string | null | undefined): boolean {
  if (!normalizedRepoId || typeof normalizedRepoId !== 'string') return false
  return OPERATOR_ONLY_REPO_IDENTITIES.has(normalizedRepoId.trim().toLowerCase())
}
