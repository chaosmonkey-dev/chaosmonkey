/**
 * CR5 WS1 — Shared observed commit/TTFC authority.
 *
 * Single source of truth for per-workflow observed commit and TTFC
 * aggregates derived from enriched canonical session rows that have
 * already been classified by `addDerivedSessionFields`.
 *
 * Provenance contract (CR5-STATUS.md):
 *   - A session is commit-observed when
 *       session_commits_source === 'observed'
 *     (which requires session_has_commit_outcome === true &&
 *      simulated !== true && finite enriched session_commits).
 *   - A session is TTFC-observed when
 *       ttfc_source === 'observed'
 *     (which requires non-simulated + observed commit evidence +
 *      enriched computed TTFC).
 *
 * Both the PI engine generators (per-row gating on session_commits_source
 * / ttfc_source) and AIOI (per-workflow aggregates via this module)
 * derive from the SAME classified rows. Provenance logic is NOT
 * duplicated inside AIOI — AIOI consumes this authority's output.
 *
 * Workflows lacking qualified evidence receive null values. Consumers
 * MUST NOT fall back to canonical aggregated commit_count or rounded
 * TTFC when this authority returns null — they render unavailable.
 */

import { normalizeToCanonicalToolId } from '../../workflowIdentity';

export interface ObservedCommitTtfcByWorkflow {
  commitsPerSession: number | null;
  ttfcMinutes: number | null;
  observedCommitSessionCount: number;
  observedTtfcSessionCount: number;
}

export type ObservedCommitTtfcAuthority = Map<string, ObservedCommitTtfcByWorkflow>;

/**
 * Compute per-workflow observed commit/TTFC aggregates from enriched,
 * classified canonical session rows.
 *
 * @param sessionRows Canonical session rows that have been enriched and
 *   run through addDerivedSessionFields (so session_commits_source and
 *   ttfc_source are set).
 * @returns Map keyed by canonical tool id (windsurf → devin alias
 *   applied). Workflows with zero observed sessions are still present
 *   with null metric values and zero counts, so consumers can
 *   distinguish "no evidence" from "workflow absent".
 */
export function computeObservedCommitTtfcByWorkflow(
  sessionRows: any[]
): ObservedCommitTtfcAuthority {
  const authority: ObservedCommitTtfcAuthority = new Map();

  for (const session of sessionRows) {
    const toolId = normalizeToCanonicalToolId(session.tool ?? session.session_source ?? '');
    if (!toolId) continue;

    let entry = authority.get(toolId);
    if (!entry) {
      entry = {
        commitsPerSession: null,
        ttfcMinutes: null,
        observedCommitSessionCount: 0,
        observedTtfcSessionCount: 0,
      };
      authority.set(toolId, entry);
    }

    const commitObserved = session.session_commits_source === 'observed';
    const ttfcObserved = session.ttfc_source === 'observed';

    if (commitObserved) {
      entry.observedCommitSessionCount++;
      const commits = Number(session.session_commits);
      if (Number.isFinite(commits)) {
        // Accumulate sum; divide by count at the end.
        (entry as any)._commitSum = ((entry as any)._commitSum || 0) + commits;
      }
    }

    if (ttfcObserved) {
      entry.observedTtfcSessionCount++;
      const ttfcMs = Number(session.time_to_first_commit_ms);
      if (Number.isFinite(ttfcMs) && ttfcMs >= 0) {
        (entry as any)._ttfcMsSum = ((entry as any)._ttfcMsSum || 0) + ttfcMs;
      }
    }
  }

  // Finalize averages.
  for (const [, entry] of authority) {
    const commitSum = (entry as any)._commitSum;
    if (entry.observedCommitSessionCount > 0 && Number.isFinite(commitSum)) {
      entry.commitsPerSession = commitSum / entry.observedCommitSessionCount;
    }
    const ttfcMsSum = (entry as any)._ttfcMsSum;
    if (entry.observedTtfcSessionCount > 0 && Number.isFinite(ttfcMsSum)) {
      entry.ttfcMinutes = ttfcMsSum / entry.observedTtfcSessionCount / 60000;
    }
    delete (entry as any)._commitSum;
    delete (entry as any)._ttfcMsSum;
  }

  return authority;
}
