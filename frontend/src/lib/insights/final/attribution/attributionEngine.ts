/**
 * CR-X Pure Attribution Engine
 *
 * Resolves the attribution level (L1–L4) between a telemetry session and
 * a GitHub pull request using only fixture/evidence objects — no DB access.
 *
 * Attribution ladder:
 *
 * L1 DIRECT
 *   Any session_commit_sha is contained in the PR commit_sha_set.
 *   Evidence: exact Git commit identity.
 *   Use: may drive attributed decision PIs.
 *
 * L2 STRONG (inferred)
 *   Same repo + same branch + compatible developer + bounded temporal overlap
 *   + supporting Git context (start/end HEAD or commit SHAs), but no exact
 *   commit membership.
 *   Use: may drive attributed findings with explicit "strong inferred" label.
 *
 * L3 DIRECTIONAL
 *   Same repo + bounded temporal relationship, but no branch or commit proof.
 *   Use: contextual/directional only. Never call causal.
 *
 * L4 NONE
 *   Only coarse temporal proximity or org-level coincidence.
 *   Use: diagnostic / org-level only.
 */

/** Bounded list of commit SHAs observed during a session. */
export interface SessionEvidence {
  sessionId: string
  workflow: string
  developerId?: string | null
  repo: string
  branch?: string | null
  sessionStart?: string | null  // ISO-8601
  sessionEnd?: string | null    // ISO-8601
  sessionCommitShas?: string[]  // bounded unique SHA list
  startHeadSha?: string | null
  endHeadSha?: string | null
}

/** GitHub pull-request evidence with commit lineage. */
export interface PullRequestEvidence {
  prId: string | number
  repo: string
  headRef?: string | null       // branch name
  baseRef?: string | null
  headSha?: string | null
  mergeSha?: string | null
  commitShas?: string[]         // PR commit set
  authorLogin?: string | null
  authorGithubId?: string | number | null
  createdAt?: string | null
  mergedAt?: string | null
  dataProvenance?: string       // 'live' | 'demo' | 'seeded'
}

/** Result of attribution resolution. */
export interface AttributionEvidence {
  level: 'L1' | 'L2' | 'L3' | 'L4'
  confidence: 'high' | 'medium' | 'low' | 'none'
  joinKeys: string[]
  evidenceDescription: string
  isAttributed: boolean          // true for L1/L2, false for L3/L4
  sessionId: string
  prId: string | number
  workflow: string
  provenance: string
}

// ─── Constants ──────────────────────────────────────────────────────────

/** Maximum commits to attribute per session. */
export const MAX_SESSION_COMMIT_SHAS = 100

/** Temporal overlap window for L2/L3 inference (hours). */
export const TEMPORAL_WINDOW_HOURS = 72

// ─── Helpers ────────────────────────────────────────────────────────────

/** Normalize a repo URL or name to a canonical form for comparison. */
export function normalizeRepo(repo: string | null | undefined): string {
  if (!repo) return ''
  const lower = repo.toLowerCase().trim()
  // Strip protocol, domain, trailing .git, trailing slashes
  return lower
    .replace(/^https?:\/\//, '')
    .replace(/^git@/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .replace(/^github\.com[:/]/, '')
}

/** Normalize a branch name for comparison. */
function normalizeBranch(branch: string | null | undefined): string {
  if (!branch) return ''
  return branch.toLowerCase().trim().replace(/^refs\/heads\//, '')
}

/** Normalize a Git SHA to lowercase 40-char form. */
function normalizeSha(sha: string | null | undefined): string {
  if (!sha) return ''
  return sha.toLowerCase().trim().substring(0, 40)
}

/** Parse an ISO-8601 timestamp to epoch ms. */
function toEpochMs(ts: string | null | undefined): number | null {
  if (!ts) return null
  const ms = Date.parse(ts)
  return isNaN(ms) ? null : ms
}

/** Check if two timestamps are within a bounded window. */
function withinTemporalWindow(
  startA?: string | null,
  endA?: string | null,
  timeB?: string | null,
  windowHours = TEMPORAL_WINDOW_HOURS,
): boolean {
  const bMs = toEpochMs(timeB)
  if (bMs === null) return false
  const aStart = toEpochMs(startA)
  const aEnd = toEpochMs(endA)
  if (aStart !== null && aEnd !== null) {
    // Session spans a range; check if timeB falls within [aStart - window, aEnd + window]
    const windowMs = windowHours * 3600_000
    return bMs >= aStart - windowMs && bMs <= aEnd + windowMs
  }
  if (aEnd !== null) {
    const windowMs = windowHours * 3600_000
    return Math.abs(bMs - aEnd) <= windowMs
  }
  return false
}

/** Check if developer identities are compatible (same or derivable). */
function compatibleDeveloper(
  sessionDev?: string | null,
  prAuthor?: string | null,
): boolean {
  if (!sessionDev || !prAuthor) return false
  // Exact match
  if (sessionDev === prAuthor) return true
  // invite:{id} vs user_login — not directly compatible
  // This is a known gap; the identity bridge is a separate concern
  return false
}

// ─── Attribution Resolver ───────────────────────────────────────────────

/**
 * Resolve attribution between a single session and a single PR.
 *
 * Returns the highest-confidence level achievable from the evidence.
 * Degrades rather than guesses when fields are missing.
 */
export function resolveAttribution(
  session: SessionEvidence,
  pr: PullRequestEvidence,
): AttributionEvidence {
  const sessionRepo = normalizeRepo(session.repo)
  const prRepo = normalizeRepo(pr.repo)
  const sessionShas = (session.sessionCommitShas || [])
    .map(normalizeSha)
    .filter(Boolean)
  const prShas = (pr.commitShas || [])
    .map(normalizeSha)
    .filter(Boolean)
  const sessionBranch = normalizeBranch(session.branch)
  const prBranch = normalizeBranch(pr.headRef)

  const baseResult: Omit<AttributionEvidence, 'level' | 'confidence' | 'joinKeys' | 'evidenceDescription' | 'isAttributed'> = {
    sessionId: session.sessionId,
    prId: pr.prId,
    workflow: session.workflow,
    provenance: pr.dataProvenance || 'unknown',
  }

  // ─── L1: Direct commit SHA membership ──────────────────────────────
  if (sessionShas.length > 0 && prShas.length > 0) {
    const prShaSet = new Set(prShas)
    const matchingShas = sessionShas.filter(sha => prShaSet.has(sha))
    if (matchingShas.length > 0) {
      // L1 requires repo verification — degrade rather than fabricate
      // if either repo is missing or they differ.
      if (!sessionRepo || !prRepo) {
        return {
          ...baseResult,
          level: 'L4',
          confidence: 'none',
          joinKeys: ['commit_sha'],
          evidenceDescription: `Commit SHA ${matchingShas[0].substring(0, 7)} matches but repo identity is missing (session repo: '${sessionRepo || 'unknown'}', PR repo: '${prRepo || 'unknown'}') — cannot verify, refusing to attribute.`,
          isAttributed: false,
        }
      }
      if (sessionRepo !== prRepo) {
        // Same SHA, different repo — degrade to L4, do not attribute
        return {
          ...baseResult,
          level: 'L4',
          confidence: 'none',
          joinKeys: ['commit_sha'],
          evidenceDescription: `Commit SHA ${matchingShas[0].substring(0, 7)} matches but repos differ (${sessionRepo} vs ${prRepo}) — possible SHA collision, refusing to attribute.`,
          isAttributed: false,
        }
      }
      return {
        ...baseResult,
        level: 'L1',
        confidence: 'high',
        joinKeys: ['session_commit_shas', 'pr_commit_shas'],
        evidenceDescription: `Session commit SHA ${matchingShas[0].substring(0, 7)} is contained in PR #${pr.prId} commit set (${matchingShas.length} matching SHA(s), repo: ${sessionRepo}).`,
        isAttributed: true,
      }
    }
  }

  // ─── L2: Strong inferred ───────────────────────────────────────────
  // Requires: same repo + same branch + compatible developer + bounded temporal overlap
  // Plus supporting Git context (start/end HEAD or commit SHAs present but no exact match)
  const sameRepo = sessionRepo && prRepo && sessionRepo === prRepo
  const sameBranch = sessionBranch && prBranch && sessionBranch === prBranch
  const temporalOverlap = withinTemporalWindow(
    session.sessionStart,
    session.sessionEnd,
    pr.mergedAt || pr.createdAt,
  )
  const devCompatible = compatibleDeveloper(session.developerId, pr.authorLogin)
  const hasGitContext = !!(session.startHeadSha || session.endHeadSha || sessionShas.length > 0)

  if (sameRepo && sameBranch && temporalOverlap && devCompatible && hasGitContext) {
    return {
      ...baseResult,
      level: 'L2',
      confidence: 'medium',
      joinKeys: ['repo', 'branch', 'developer_id', 'temporal_overlap'],
      evidenceDescription: `Same repo (${sessionRepo}), same branch (${sessionBranch}), compatible developer, bounded temporal overlap, Git context present but no exact commit SHA match.`,
      isAttributed: true,
    }
  }

  // ─── L3: Directional ───────────────────────────────────────────────
  // Requires: same repo + bounded temporal relationship
  if (sameRepo && temporalOverlap) {
    return {
      ...baseResult,
      level: 'L3',
      confidence: 'low',
      joinKeys: ['repo', 'temporal_overlap'],
      evidenceDescription: `Same repo (${sessionRepo}) with bounded temporal overlap, but no branch match, developer match, or commit SHA evidence.`,
      isAttributed: false,
    }
  }

  // ─── L4: None ──────────────────────────────────────────────────────
  return {
    ...baseResult,
    level: 'L4',
    confidence: 'none',
    joinKeys: [],
    evidenceDescription: `No authoritative join: repo mismatch or no temporal overlap (session repo: ${sessionRepo || 'unknown'}, PR repo: ${prRepo || 'unknown'}).`,
    isAttributed: false,
  }
}

/**
 * Resolve attribution for a session against multiple candidate PRs.
 *
 * Returns ALL results sorted by level (L1 first). If multiple L1 matches
 * exist, returns all of them (a session can contribute to multiple PRs).
 * Does NOT pick a single "best" — the caller decides how to handle
 * ambiguous attribution.
 */
export function resolveAttributionMulti(
  session: SessionEvidence,
  prs: PullRequestEvidence[],
): AttributionEvidence[] {
  const results = prs.map(pr => resolveAttribution(session, pr))
  // Sort by level: L1 > L2 > L3 > L4
  const levelOrder = { L1: 0, L2: 1, L3: 2, L4: 3 }
  results.sort((a, b) => levelOrder[a.level] - levelOrder[b.level])
  return results
}

/**
 * Degrade ambiguous L1 matches: if a session matches multiple PRs at L1
 * via the same SHA, that's fine (the commit is in multiple PRs). But if
 * a session matches multiple PRs at L2 with different evidence, degrade
 * to L3 to avoid guessing.
 */
export function degradeAmbiguous(
  results: AttributionEvidence[],
): AttributionEvidence[] {
  const l1Results = results.filter(r => r.level === 'L1')
  const l2Results = results.filter(r => r.level === 'L2')
  const l3Results = results.filter(r => r.level === 'L3')
  const l4Results = results.filter(r => r.level === 'L4')

  // L1: keep all (a session can contribute commits to multiple PRs)
  // L2: if more than one L2 match, degrade all to L3
  if (l2Results.length > 1) {
    return [
      ...l1Results,
      ...l2Results.map(r => ({
        ...r,
        level: 'L3' as const,
        confidence: 'low' as const,
        evidenceDescription: `Degraded from L2 to L3: multiple L2 candidates found, refusing to guess. ${r.evidenceDescription}`,
        isAttributed: false,
      })),
      ...l3Results,
      ...l4Results,
    ]
  }

  return results
}
