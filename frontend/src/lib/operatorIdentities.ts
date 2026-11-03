/**
 * Operator/support enrollment identities.
 *
 * Operator-created developer enrollments (pilot setup, acceptance testing,
 * support accounts) must not be presented as customer developers in
 * analytics selectors or team management. This is a display-layer exclusion:
 * the underlying invites, telemetry, and session attribution are preserved
 * untouched — only the human-selectable "identified developer" surfaces hide
 * them.
 *
 * The list is explicit and narrow by design. Do NOT add broad email-domain
 * rules here — a customer developer enrolled with a personal email must
 * never be hidden by a domain heuristic.
 */
const OPERATOR_ENROLLMENT_EMAILS = new Set<string>([
  'mattrmclaren@gmail.com',
  'mcclintockmatthieu@gmail.com',
])

/**
 * Returns true when an invite/member email belongs to a known operator
 * enrollment that should not appear as a customer developer identity.
 */
export function isOperatorEnrollmentEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== 'string') return false
  return OPERATOR_ENROLLMENT_EMAILS.has(email.trim().toLowerCase())
}

/**
 * Telemetry-observed repository identities whose sessions are exclusively
 * attributed to known operator enrollments (invite:29 / invite:32 on the
 * Priority Dispatch pilot — verified 2026-09-25: all 11 events / 5 sessions
 * for mattmcclintock/angrymonkey carry user_id invite:29 or invite:32).
 *
 * Display-layer exclusion only: raw telemetry rows are preserved. Identities
 * here must be re-verified as operator-only before adding anything.
 */
const OPERATOR_ONLY_REPO_IDENTITIES = new Set<string>([
  'mattmcclintock/angrymonkey',
])

/**
 * Returns true when a normalized repo identity is proven operator-only and
 * must not appear in customer-facing repository selectors/analytics.
 */
export function isOperatorOnlyRepoIdentity(normalizedRepoId: string | null | undefined): boolean {
  if (!normalizedRepoId || typeof normalizedRepoId !== 'string') return false
  return OPERATOR_ONLY_REPO_IDENTITIES.has(normalizedRepoId.trim().toLowerCase())
}
