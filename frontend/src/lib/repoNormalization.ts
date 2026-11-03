/**
 * CR-X F: Canonical repository normalization.
 *
 * Shared authority for normalizing git repository URLs into canonical
 * owner/repo identity. Used by:
 * - PI engine (repository concentration, repository distribution)
 * - PBT repo filter dropdown (alias-proof filtering)
 * - Telemetry adapter (canonical repo identity for display)
 *
 * Handles:
 * - HTTPS with optional user: https://[user@]host/owner/repo.git
 * - SSH: git@host:owner/repo.git
 * - SCP-style: host:owner/repo.git
 * - Azure DevOps: https://user@dev.azure.com/org/project/_git/repo
 * - trailing .git suffix
 * - casing (lowercased for canonical identity)
 *
 * This is a query/adapter-level normalization — no DB migration required.
 * The backend still stores raw git_repo_url; this function collapses aliases
 * at display/filter/PI-generation time.
 */

/**
 * Normalize a git repository URL into a canonical owner/repo identity.
 * Returns null for empty/invalid input.
 *
 * Examples:
 *   'git@github.com:owner/repo.git' → 'owner/repo'
 *   'https://github.com/owner/repo' → 'owner/repo'
 *   'https://user@github.com/owner/repo.git' → 'owner/repo'
 *   'https://dev.azure.com/org/proj/_git/repo' → 'azure:org/repo'
 */
export function normalizeRepoUrl(repoUrl: string | null | undefined): string | null {
  if (!repoUrl || typeof repoUrl !== 'string') return null
  const url = repoUrl.trim()
  if (!url) return null

  // Azure DevOps: https://user@dev.azure.com/org/project/_git/repo
  const azureMatch = url.match(/^https?:\/\/(?:[^@]+@)?dev\.azure\.com\/([^/]+)\/[^/]+\/_git\/([^/]+)/i)
  if (azureMatch) return `azure:${azureMatch[1]}/${azureMatch[2]}`

  // Already-normalized Azure identity (e.g. from /api/telemetry/repos, which
  // returns backend-canonical "azure:org/repo" identities). Must be checked
  // BEFORE the SCP-style pattern below — otherwise the azure: prefix is
  // treated as an SCP host and stripped, breaking the repo filter match
  // against the backend's canonical identity. Casing preserved: the backend
  // does not lowercase Azure org/repo segments.
  const azureIdentityMatch = url.match(/^azure:([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (azureIdentityMatch) return `azure:${azureIdentityMatch[1]}/${azureIdentityMatch[2]}`

  // HTTPS with optional user: https://[user@]host/owner/repo.git
  const httpsMatch = url.match(/^https?:\/\/(?:[^@/?]+@)?[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/i)
  if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`.toLowerCase()

  // SSH: git@host:owner/repo.git or user@host:owner/repo.git
  const sshMatch = url.match(/^[^@:/]+@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`.toLowerCase()

  // SCP-style without user: host:owner/repo.git
  const scpMatch = url.match(/^[^:/]+:([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (scpMatch) return `${scpMatch[1]}/${scpMatch[2]}`.toLowerCase()

  // Already-canonical owner/repo (e.g. from /api/telemetry/repos which returns
  // pre-normalized strings). Pass through lowercased — no URL parsing needed.
  // Must match exactly two segments separated by a single slash, no protocol.
  const canonicalMatch = url.match(/^([^:/@\s]+)\/([^:/@\s]+)$/)
  if (canonicalMatch) return `${canonicalMatch[1]}/${canonicalMatch[2]}`.toLowerCase()

  // Fallback: accept bare single-segment repo identifiers (e.g. sanitized
  // fixture names like "repo-ed-001" or pre-normalized repo names). These
  // are not URLs and don't match any git URL pattern, but they are valid
  // canonical repo identities for fixtures and pre-normalized data.
  // Only accept strings that are clearly not URLs (no : / @).
  if (/^[\w.-]+$/.test(url)) {
    return url.toLowerCase()
  }

  // Fallback: for URLs that don't match any known pattern, return null.
  // This is safer than taking the last 2 path segments, which can create
  // false positives (e.g. "team/owner/repo" → "owner/repo").
  // The specific patterns above handle all valid git URL forms.
  return null
}

/**
 * Customer-facing display label for a canonical repo identity.
 *
 * Canonical ids carry an internal source prefix for host-disambiguated
 * providers ('azure:org/repo'). That prefix is join/attribution authority —
 * it must NOT appear in customer-facing text. Strip it here at the display
 * boundary only: 'azure:org/repo' → 'org/repo'. All other canonical
 * identities ('owner/repo', bare names) pass through unchanged.
 */
export function repoDisplayLabel(canonicalId: string): string {
  if (typeof canonicalId === 'string' && canonicalId.startsWith('azure:')) {
    return canonicalId.slice('azure:'.length)
  }
  return canonicalId
}

/**
 * Get a human-readable label for a canonical repo identity.
 * 'owner/repo' → 'owner/repo' (already readable)
 * 'azure:org/repo' → 'org/repo' (internal source prefix stripped for display)
 */
export function repoLabel(canonicalId: string): string {
  return repoDisplayLabel(canonicalId)
}

/**
 * True when a repo identity or display label is safe to interpolate into
 * customer-facing prose. Fails closed on empty strings and placeholder
 * identities — literal "undefined"/"null" inputs, "unknown"/"unattributed"
 * markers, engine sentinels like "__unattributed__", and malformed segments
 * (leading/trailing/double slashes) that would render as blank names.
 *
 * Insight generators must check this before emitting repo-comparison titles:
 * a missing label means suppress the finding, never emit malformed prose.
 */
export function isRenderableRepoLabel(label: string | null | undefined): boolean {
  if (typeof label !== 'string') return false
  const trimmed = label.trim()
  if (!trimmed) return false
  const lowered = trimmed.toLowerCase()
  if (
    lowered === 'undefined' ||
    lowered === 'null' ||
    lowered === 'unknown' ||
    lowered === 'unattributed' ||
    lowered === '__unattributed__' ||
    lowered === 'n/a' ||
    lowered === 'none'
  ) {
    return false
  }
  if (trimmed.startsWith('/') || trimmed.endsWith('/') || trimmed.includes('//')) return false
  return true
}

/**
 * Normalize a list of raw repo URLs into unique canonical identities
 * with labels, suitable for a dropdown.
 */
export function normalizeRepoList(rawRepos: string[]): Array<{ id: string; label: string }> {
  const seen = new Set<string>()
  const result: Array<{ id: string; label: string }> = []

  for (const raw of rawRepos) {
    const canonical = normalizeRepoUrl(raw)
    if (!canonical) continue
    if (seen.has(canonical)) continue
    seen.add(canonical)
    result.push({ id: canonical, label: repoLabel(canonical) })
  }

  return result.sort((a, b) => a.label.localeCompare(b.label))
}
