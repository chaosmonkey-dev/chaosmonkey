// src/ui/insights/uiDedupe.ts
import type { PerformanceInsight } from "@/lib/insights/types";

export function dedupeByEquivalenceKey(
  items: PerformanceInsight[]
): PerformanceInsight[] {
  const seen = new Set<string>();
  const out: PerformanceInsight[] = [];
  
  for (const it of items) {
    // Create equivalence key from available fields
    // ⚠️ CRITICAL: Include cicdStage AND orgKind to prevent cross-stage and org-level deduplication!
    // This ensures "Org AI ROI" and "AI Impact" can coexist even if they share metricId/stage
    const stage = it.cicdStage || 'other';
    const orgKind = it.orgKind || 'none';
    const tool = it.related?.tools?.[0] ?? 'unknown';
    const key = it.equivalenceKey ?? `${stage}|${orgKind}|${it.metricId ?? 'unknown'}|${tool}|${it.id}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      out.push(it);
    } else {
      // Merge "also observed in" metadata if present
      const existing = out.find(
        x => {
          const existingKey = x.equivalenceKey ?? `${x.cicdStage || 'other'}|${x.orgKind || 'none'}|${x.metricId ?? 'unknown'}|${x.related?.tools?.[0] ?? 'unknown'}|${x.id}`;
          return existingKey === key;
        }
      );
      if (existing) {
        // Add tool to alsoObservedIn if not already present
        const toolUpper = tool.toUpperCase?.() ?? tool;
        const existingTool = existing.related?.tools?.[0]?.toUpperCase?.() ?? existing.related?.tools?.[0] ?? "UNKNOWN";
        
        if (toolUpper !== existingTool) {
          // Add to alsoObservedIn metadata
          if (!existing.alsoObservedIn) {
            existing.alsoObservedIn = [];
          }
          if (!existing.alsoObservedIn.includes(toolUpper)) {
            existing.alsoObservedIn.push(toolUpper);
          }
        }
      }
    }
  }
  
  return out;
}
