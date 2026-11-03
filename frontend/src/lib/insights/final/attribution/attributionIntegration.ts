/**
 * CR-X Attribution Integration
 *
 * Thin bridge between the pure attribution engine and the Final PI pipeline.
 *
 * Builds SessionEvidence / PullRequestEvidence from pipeline data shapes
 * (sessionRows, githubSnapshot) and resolves an honest attribution summary
 * that generators use to label `attributionStatus`.
 *
 * Attribution ladder (see attributionEngine.ts):
 *   L1 direct commit SHA  -> may drive workflow-attributed findings
 *   L2 strong inferred    -> may drive findings, must disclose provenance
 *   L3 repo + temporal    -> directional/contextual only, NEVER workflow-attributed
 *   L4 none               -> org-level / diagnostic only
 *
 * CURRENT STATE: sessionRows expose git_repo_url / git_branch but NOT a
 * per-session commit SHA list (SHA is buried in telemetry event payload).
 * githubSnapshot carries aggregate pr_review_metrics, not per-PR commit
 * lineage (head_sha / merge_sha / commit_shas). Therefore resolution today
 * is L3/L4 at best. L1/L2 auto-activates when:
 *   - session commit SHAs are surfaced to the pipeline, AND
 *   - Track A GitHub App ingestion populates PR commit lineage.
 *
 * No DB access. No fabrication. Degrades rather than guesses.
 */

import {
  resolveAttributionMulti,
  degradeAmbiguous,
  type SessionEvidence,
  type PullRequestEvidence,
  type AttributionEvidence,
} from './attributionEngine'

/** Honest attribution status string for CanonicalInsight.attributionStatus. */
export type DeliveryAttributionStatus =
  | 'workflow_attributed_l1'
  | 'workflow_attributed_l2'
  | 'directional_l3'
  | 'org_level_only'

export interface DeliveryAttributionSummary {
  /** Highest attribution level achieved across all session/PR pairs. */
  maxLevel: 'L1' | 'L2' | 'L3' | 'L4'
  /** Honest status string for generator labeling. */
  status: DeliveryAttributionStatus
  /** True only when L1 or L2 evidence exists (workflow attribution permitted). */
  canAttributeToWorkflow: boolean
  /** Number of sessions with at least one L1/L2 match. */
  attributedSessionCount: number
  /** Total sessions considered. */
  totalSessions: number
  /** Number of PR evidence objects available. */
  prEvidenceCount: number
  /** Human-readable provenance disclosure (never causal). */
  provenanceLabel: string
  /** Full per-session results (for audit/debug only, never user-visible). */
  results: AttributionEvidence[]
}

/**
 * Build SessionEvidence[] from pipeline sessionRows.
 * Only fields that are actually present are populated; missing fields stay
 * undefined so the engine degrades gracefully.
 */
export function buildSessionEvidence(sessionRows: any[]): SessionEvidence[] {
  if (!Array.isArray(sessionRows)) return []
  return sessionRows
    .filter((s) => s && (s.git_repo_url || s.repo))
    .map((s, i) => {
      // CR-X P0-2: Derive session temporal bounds from timestamp + duration_ms.
      //
      // PROVEN SEMANTICS: `timestamp` = effective SESSION END (not start).
      // Real evidence: session_id epoch + duration_ms ≈ timestamp.
      // Therefore:
      //   sessionEnd   = explicit session_end / ended_at / last_event_at, else timestamp
      //   sessionStart = explicit session_start / started_at, else timestamp - duration_ms
      //
      // The WRONG direction (sessionStart = timestamp, sessionEnd = timestamp + duration_ms)
      // would shift the window forward by duration_ms, causing false L3 matches.
      // See B-dir regression test in cr-x-attribution-integration.test.ts.
      //
      // Guard against Invalid Date: only compute when timestamp parses and
      // duration_ms is a finite positive number. When duration is missing/zero,
      // start = end = timestamp (zero-duration observed interval).
      const tsMs = s.timestamp ? Date.parse(s.timestamp) : null
      const durMs = Number.isFinite(Number(s.duration_ms)) ? Number(s.duration_ms) : 0
      const validTs = tsMs !== null && !isNaN(tsMs)
      const fallbackEnd = validTs ? s.timestamp : null
      const fallbackStart =
        validTs && durMs > 0
          ? new Date(tsMs - durMs).toISOString()
          : validTs
            ? s.timestamp
            : null

      return {
        sessionId: s.session_id ?? s.id ?? `sess-${i}`,
        workflow: s.workflow ?? s.editor_source ?? s.tool_id ?? 'unknown',
        developerId: s.developer_id ?? s.user_id ?? null,
        repo: s.git_repo_url ?? s.repo ?? '',
        branch: s.git_branch ?? s.branch ?? null,
        sessionStart: s.session_start ?? s.started_at ?? fallbackStart,
        sessionEnd: s.session_end ?? s.ended_at ?? s.last_event_at ?? fallbackEnd,
        // sessionCommitShas intentionally NOT populated from sessionRows today:
        // the pipeline does not yet surface per-session commit SHAs. Left
        // undefined so the engine cannot fabricate L1.
        sessionCommitShas: Array.isArray(s.session_commit_shas)
          ? s.session_commit_shas
          : undefined,
        startHeadSha: s.start_head_sha ?? null,
        endHeadSha: s.end_head_sha ?? null,
      }
    })
}

/**
 * Build PullRequestEvidence[] from githubSnapshot.
 * Reads per-PR lineage when present (Track A future output). Today the
 * snapshot carries aggregates only, so this typically returns [] and the
 * engine resolves no PR pairs.
 */
export function buildPullRequestEvidence(githubSnapshot: any): PullRequestEvidence[] {
  if (!githubSnapshot) return []
  // Track A will populate githubSnapshot.prs with per-PR lineage objects.
  const prs = githubSnapshot.prs ?? githubSnapshot.pull_request_evidence
  if (!Array.isArray(prs)) return []
  return prs
    .filter((p) => p && (p.repo || p.repo_name))
    .map((p, i) => ({
      prId: p.id ?? p.pr_id ?? p.pr_number ?? `pr-${i}`,
      repo: p.repo ?? p.repo_name ?? '',
      headRef: p.head_ref ?? p.branch ?? null,
      baseRef: p.base_ref ?? null,
      headSha: p.head_sha ?? null,
      mergeSha: p.merge_sha ?? null,
      commitShas: Array.isArray(p.commit_shas) ? p.commit_shas : undefined,
      authorLogin: p.author_login ?? p.user_login ?? null,
      authorGithubId: p.author_github_id ?? null,
      createdAt: p.created_at ?? null,
      mergedAt: p.merged_at ?? null,
      dataProvenance: p.data_source ?? p.provenance ?? 'unknown',
    }))
}

const LEVEL_ORDER: Record<string, number> = { L1: 0, L2: 1, L3: 2, L4: 3 }

/**
 * Resolve an honest delivery attribution summary for a set of sessions
 * against available PR evidence. Callers use `status` / `canAttributeToWorkflow`
 * to label generator output.
 *
 * When no PR evidence is available (today's common case), returns
 * org_level_only — generators must NOT claim workflow attribution.
 */
export function resolveDeliveryAttribution(
  sessionRows: any[],
  githubSnapshot: any,
): DeliveryAttributionSummary {
  const sessions = buildSessionEvidence(sessionRows)
  const prs = buildPullRequestEvidence(githubSnapshot)

  // No PR evidence -> cannot attribute to workflows. Honest org-level.
  if (prs.length === 0) {
    return {
      maxLevel: 'L4',
      status: 'org_level_only',
      canAttributeToWorkflow: false,
      attributedSessionCount: 0,
      totalSessions: sessions.length,
      prEvidenceCount: 0,
      provenanceLabel: 'Org-level delivery evidence; no workflow attribution (no PR commit lineage available).',
      results: [],
    }
  }

  const allResults: AttributionEvidence[] = []
  for (const session of sessions) {
    const results = degradeAmbiguous(resolveAttributionMulti(session, prs))
    allResults.push(...results)
  }

  // Highest level achieved
  let maxLevel: DeliveryAttributionSummary['maxLevel'] = 'L4'
  for (const r of allResults) {
    if (LEVEL_ORDER[r.level] < LEVEL_ORDER[maxLevel]) maxLevel = r.level
  }

  // Sessions with at least one L1/L2 match
  const attributedSessionIds = new Set(
    allResults.filter((r) => r.isAttributed).map((r) => r.sessionId),
  )

  const canAttribute = maxLevel === 'L1' || maxLevel === 'L2'
  const status: DeliveryAttributionStatus = canAttribute
    ? maxLevel === 'L1'
      ? 'workflow_attributed_l1'
      : 'workflow_attributed_l2'
    : maxLevel === 'L3'
      ? 'directional_l3'
      : 'org_level_only'

  const provenanceLabel = canAttribute
    ? `Workflow-attributed (${maxLevel}: ${maxLevel === 'L1' ? 'direct commit SHA match' : 'strong inferred, repo+branch+developer+temporal'}). ${attributedSessionIds.size} of ${sessions.length} sessions attributed.`
    : maxLevel === 'L3'
      ? `Directional only (L3: repo + temporal). Not workflow-attributed. ${sessions.length} sessions considered.`
      : `Org-level delivery evidence; no workflow attribution (no L1/L2 join available).`

  return {
    maxLevel,
    status,
    canAttributeToWorkflow: canAttribute,
    attributedSessionCount: attributedSessionIds.size,
    totalSessions: sessions.length,
    prEvidenceCount: prs.length,
    provenanceLabel,
    results: allResults,
  }
}

/**
 * Convenience guard for generators: true only when honest L1/L2 workflow
 * attribution is available. Use this before emitting any workflow-attributed
 * delivery finding.
 */
export function canAttributeDeliveryToWorkflow(
  sessionRows: any[],
  githubSnapshot: any,
): boolean {
  return resolveDeliveryAttribution(sessionRows, githubSnapshot).canAttributeToWorkflow
}
