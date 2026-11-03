/**
 * CR-X FINAL — Shared Engine Cache
 *
 * Pre-computes workflow grouping, repo grouping, and temporal windows ONCE
 * per engine run so generators don't repeatedly scan sessionRows.
 *
 * This does NOT change evidence semantics — it only avoids redundant
 * computation of identical results.
 */

import { normalizeToCanonicalToolId } from '../../../workflowIdentity';
import { selectComparisonWindows, isInWindow } from './temporalWindows';
import { resolveDeliveryAttribution } from '../attribution/attributionIntegration';
import type { SharedEngineCache } from '../types';

/**
 * Normalize a repo URL to a canonical form for grouping.
 * Matches the normalization used across generators.
 */
function normalizeRepoUrl(url: any): string {
  if (!url || typeof url !== 'string') return '__unattributed__';
  const trimmed = url.trim().replace(/\.git$/, '').replace(/\/$/, '');
  // Strip protocol and www
  const noProto = trimmed.replace(/^https?:\/\//, '').replace(/^www\./, '');
  return noProto.toLowerCase();
}

/**
 * Build the shared engine cache from session rows.
 * Computes:
 *   - sessionsByWorkflow (single pass)
 *   - sessionsByRepo (single pass)
 *   - temporalWindows (single pass via selectComparisonWindows)
 *   - recentRows / priorRows (single pass each)
 *
 * All computed in a combined pass where possible to minimize full scans.
 */
export function buildEngineCache(sessionRows: any[]): SharedEngineCache {
  // ── Combined pass 1: workflow grouping + repo grouping + timestamp pre-parse ──
  const sessionsByWorkflow: Record<string, any[]> = {};
  const sessionsByRepo: Record<string, any[]> = {};
  const tsMsCache = new Map<string, number>(); // session_id → timestamp ms

  for (const session of sessionRows) {
    // Workflow grouping (mirrors groupSessionsByCanonicalWorkflow)
    const rawTool = session.tool ?? session.session_source ?? session.editor_source ?? session.source;
    const workflow = normalizeToCanonicalToolId(rawTool);
    if (workflow && workflow !== 'unknown' && workflow !== 'extension' && workflow !== 'undefined') {
      (sessionsByWorkflow[workflow] ??= []).push(session);
    }

    // Repo grouping
    const repoKey = normalizeRepoUrl(session.git_repo_url);
    (sessionsByRepo[repoKey] ??= []).push(session);

    // Pre-parse timestamp for temporal window filtering
    const ts = session.timestamp ?? session.session_start ?? session.created_at;
    if (ts) {
      const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
      if (Number.isFinite(ms)) {
        const sid = session.session_id ?? `${session.tool}-${session.user_id}-${ts}`;
        tsMsCache.set(sid, ms);
      }
    }
  }

  // ── Temporal windows (uses selectComparisonWindows which does its own scans) ──
  const temporalWindows = selectComparisonWindows(sessionRows);

  // ── Recent / prior row splits (single pass each, using pre-parsed timestamps) ──
  let recentRows: any[] = [];
  let priorRows: any[] = [];

  if (temporalWindows) {
    const recentStart = temporalWindows.recent.startMs;
    const recentEnd = temporalWindows.recent.endMs;
    const priorStart = temporalWindows.prior.startMs;
    const priorEnd = temporalWindows.prior.endMs;

    recentRows = [];
    priorRows = [];

    for (const session of sessionRows) {
      const ts = session.timestamp ?? session.session_start ?? session.created_at;
      if (!ts) continue;
      const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
      if (!Number.isFinite(ms)) continue;

      if (ms >= recentStart && ms < recentEnd) {
        recentRows.push(session);
      } else if (ms >= priorStart && ms < priorEnd) {
        priorRows.push(session);
      }
    }
  }

  return {
    sessionsByWorkflow,
    sessionsByRepo,
    temporalWindows,
    recentRows,
    priorRows,
  };
}

/**
 * Get sessions by workflow from cache or compute on demand.
 * Generators should call this instead of their own grouping function
 * when the cache is available.
 */
export function getSessionsByWorkflow(
  sessionRows: any[],
  cache?: SharedEngineCache
): Record<string, any[]> {
  if (cache?.sessionsByWorkflow) return cache.sessionsByWorkflow;
  // Fallback: compute on demand (same logic as groupSessionsByCanonicalWorkflow)
  const groups: Record<string, any[]> = {};
  for (const session of sessionRows) {
    const rawTool = session.tool ?? session.session_source ?? session.editor_source ?? session.source;
    const workflow = normalizeToCanonicalToolId(rawTool);
    if (!workflow || workflow === 'unknown' || workflow === 'extension' || workflow === 'undefined') continue;
    (groups[workflow] ??= []).push(session);
  }
  return groups;
}

/**
 * Get temporal windows from cache or compute on demand.
 */
export function getTemporalWindows(
  sessionRows: any[],
  cache?: SharedEngineCache
): any {
  if (cache?.temporalWindows !== undefined) return cache.temporalWindows;
  return selectComparisonWindows(sessionRows);
}

/**
 * Get recent/prior rows from cache or compute on demand.
 */
export function getRecentPriorRows(
  sessionRows: any[],
  cache?: SharedEngineCache
): { recentRows: any[]; priorRows: any[] } {
  if (cache?.recentRows && cache?.priorRows) {
    return { recentRows: cache.recentRows, priorRows: cache.priorRows };
  }
  // Fallback: compute on demand
  const windows = selectComparisonWindows(sessionRows);
  if (!windows) return { recentRows: [], priorRows: [] };
  const recentRows = sessionRows.filter(r => isInWindow(r, windows.recent));
  const priorRows = sessionRows.filter(r => isInWindow(r, windows.prior));
  return { recentRows, priorRows };
}

/**
 * CR-X FINAL: Memoized delivery attribution.
 * resolveDeliveryAttribution is called 7 times with the same arguments
 * across reviewMerge.ts and deployOperate.ts. This wrapper caches the
 * result on the engine cache so it's computed once per engine run.
 */
export function getDeliveryAttribution(
  sessionRows: any[],
  githubSnapshot: any,
  cache?: SharedEngineCache
): any {
  if (cache?.deliveryAttribution !== undefined) return cache.deliveryAttribution;
  const result = resolveDeliveryAttribution(sessionRows, githubSnapshot);
  if (cache) cache.deliveryAttribution = result;
  return result;
}
