import type { PerformanceInsight } from '../lib/insights/types';
import { equivalenceKey } from './dedupe';

/**
 * Inputs:
 *  - raw: ALL insights before dedupe (already gated by N and p if your rules do that)
 *  - deduped: result of dedupeKeepPrimaryTool(raw) — IDE-specific, no cross-tool duplicates
 *  - totalLimit: max insights to return (e.g., 16)
 *  - perToolMin: floor per tool (>=1 ensures one per tool when available)
 *  - sigP: significance threshold; only floor-fill from insights with p <= sigP
 */
export function selectWithPerToolFloor(params: {
  raw: PerformanceInsight[];
  deduped: PerformanceInsight[];
  totalLimit: number;
  perToolMin: number;       // recommend 1
  sigP: number;             // e.g., 0.10 (your VITE_PERF_INSIGHTS_P_MAX)
}): PerformanceInsight[] {
  const { raw, deduped, totalLimit, perToolMin, sigP } = params;

  // Helper: tool name normalize
  const toolName = (t?: string | null) => (t || "").toLowerCase();

  // Helper: extract p-value from evidence
  const getPValue = (insight: PerformanceInsight): number => {
    const pEvidence = insight.evidence.find(e => e.label.toLowerCase().includes('p'));
    return typeof pEvidence?.value === 'number' ? pEvidence.value : 
           typeof pEvidence?.value === 'string' ? parseFloat(pEvidence.value) : 1;
  };

  // Helper: extract r-value from evidence
  const getRValue = (insight: PerformanceInsight): number => {
    const rEvidence = insight.evidence.find(e => e.label.toLowerCase().includes('correlation') && e.label.includes('r'));
    return typeof rEvidence?.value === 'number' ? rEvidence.value : 
           typeof rEvidence?.value === 'string' ? parseFloat(rEvidence.value) : 0;
  };

  // Index raw by tool and by equivalence to allow non-duplicate selection.
  const rawByTool = new Map<string, PerformanceInsight[]>();
  for (const r of raw) {
    const t = toolName(r.related?.tools?.[0]);
    if (!rawByTool.has(t)) rawByTool.set(t, []);
    rawByTool.get(t)!.push(r);
  }

  // Sort raw candidates per tool by evidence strength (lower p, then higher |r|)
  for (const [t, arr] of rawByTool.entries()) {
    arr.sort((a, b) => {
      const pa = getPValue(a), pb = getPValue(b);
      if (pa !== pb) return pa - pb;                          // lower p first
      const ar = Math.abs(getRValue(b)) - Math.abs(getRValue(a)); // stronger |r| next
      if (ar !== 0) return ar;
      // stable tie-breaker to avoid flicker:
      return String(a.title).localeCompare(String(b.title));
    });
  }

  // Start from deduped set (already picked a primary tool per equivalence class)
  const selected: PerformanceInsight[] = [];
  const usedKeys = new Set<string>();
  const countByTool = new Map<string, number>();

  function addIfNew(ins: PerformanceInsight) {
    const key = equivalenceKey(ins);
    const t = toolName(ins.related?.tools?.[0]);
    if (usedKeys.has(key)) return false;                      // avoid duplicates by equivalence
    selected.push(ins);
    usedKeys.add(key);
    countByTool.set(t, (countByTool.get(t) ?? 0) + 1);
    return true;
  }

  // 1) Seed with deduped insights, in their existing priority order
  for (const d of deduped) {
    if (selected.length >= totalLimit) break;
    addIfNew(d);
  }

  // Identify which tools exist in the *raw* pool and have at least one significant candidate.
  const toolsNeedingFloor: string[] = [];
  for (const [t, arr] of rawByTool.entries()) {
    const hasSig = arr.some(x => getPValue(x) <= sigP);
    if (!t || !hasSig) continue; // skip empty tool name or no significant candidates
    const have = countByTool.get(t) ?? 0;
    if (have < perToolMin) toolsNeedingFloor.push(t);
  }

  // 2) Floor-filling pass: ensure ≥ perToolMin per tool from significant, non-duplicate insights
  for (const t of toolsNeedingFloor) {
    const pool = rawByTool.get(t)!;
    for (const cand of pool) {
      if (getPValue(cand) > sigP) continue;                   // maintain statistical floor
      const added = addIfNew(cand);
      if (added && (countByTool.get(t) ?? 0) >= perToolMin) break;
    }
  }

  // 3) If we still have headroom, top-up by global strength (non-duplicate)
  if (selected.length < totalLimit) {
    // Build a global candidate list excluding already-used equivalence classes
    const global = deduped
      .slice()
      .sort((a, b) => {
        const pa = getPValue(a), pb = getPValue(b);
        if (pa !== pb) return pa - pb;
        const ar = Math.abs(getRValue(b)) - Math.abs(getRValue(a));
        if (ar !== 0) return ar;
        return String(a.related?.tools?.[0] || "").localeCompare(String(b.related?.tools?.[0] || ""));
      });

    for (const cand of global) {
      if (selected.length >= totalLimit) break;
      addIfNew(cand);
    }
  }

  return selected.slice(0, totalLimit);
}



