import type { PerformanceInsight } from '../lib/insights/types';

// Normalize individual metrics to a "driver family" so we can compare across tools.
export function driverFamily(driverMetric: string): string {
  if (/productive[_\s]?time|coding[_\s]?minutes/i.test(driverMetric)) return "ide_productive_time";
  if (/ai[_\s]?usage|copilot|assistant|ai[_\s]?assists/i.test(driverMetric)) return "ide_ai_usage";
  return driverMetric.toLowerCase();
}

// Extract correlation info from evidence
function getCorrelationInfo(insight: PerformanceInsight): { r: number; p: number; lagWeeks?: number } {
  const rEvidence = insight.evidence.find(e => e.label.toLowerCase().includes('correlation') && e.label.includes('r'));
  const pEvidence = insight.evidence.find(e => e.label.toLowerCase().includes('p'));
  const periodsEvidence = insight.evidence.find(e => e.label.toLowerCase().includes('periods'));
  
  const r = typeof rEvidence?.value === 'number' ? rEvidence.value : 
            typeof rEvidence?.value === 'string' ? parseFloat(rEvidence.value) : 0;
  const p = typeof pEvidence?.value === 'number' ? pEvidence.value : 
            typeof pEvidence?.value === 'string' ? parseFloat(pEvidence.value) : 1;
  const lagWeeks = typeof periodsEvidence?.value === 'number' ? periodsEvidence.value : undefined;
  
  return { r, p, lagWeeks };
}

// Extract target metric from insight
function getTargetMetric(insight: PerformanceInsight): string {
  // Try to extract from metricId if available, otherwise infer from title/description
  const title = insight.title.toLowerCase();
  const desc = insight.description.toLowerCase();
  
  if (title.includes('merge rate') || desc.includes('merge rate')) return 'merge_rate';
  if (title.includes('cycle time') || desc.includes('cycle time')) return 'cycle_time';
  if (title.includes('deployment') || desc.includes('deployment')) return 'deployment_frequency';
  if (title.includes('failure rate') || desc.includes('failure rate')) return 'change_failure_rate';
  
  return 'unknown';
}

// Extract driver metric from insight
function getDriverMetric(insight: PerformanceInsight): string {
  const title = insight.title.toLowerCase();
  const desc = insight.description.toLowerCase();
  
  if (title.includes('ai') || desc.includes('ai') || title.includes('assist')) return 'ai_usage';
  if (title.includes('coding') || desc.includes('coding') || title.includes('minutes')) return 'productive_time';
  
  return 'unknown';
}

// Equivalence definition: same stage, same target metric, same driver family, same lag, same sign, same rule.
// ⚠️ CRITICAL: Include cicdStage and ruleId to prevent cross-stage deduplication and rule collapse!
export function equivalenceKey(insight: PerformanceInsight): string {
  const stage = insight.cicdStage || 'other';
  const ruleId = (insight as any).ruleId || insight.metricId || 'unknown';
  const targetMetric = getTargetMetric(insight);
  const driverMetric = getDriverMetric(insight);
  const fam = driverFamily(driverMetric);
  const { r, lagWeeks } = getCorrelationInfo(insight);
  const lag = lagWeeks ?? -1;
  const sign = r >= 0 ? "pos" : "neg";
  // Include ruleId to prevent different rules from collapsing into one generic insight
  return `${stage}|${ruleId}|${targetMetric}|${fam}|lag${lag}|${sign}`;
}

// Choose the "best" (primary) representative: prefer lowest p, then highest |r|.
function pickPrimary(group: PerformanceInsight[]): PerformanceInsight {
  return group
    .slice()
    .sort((a, b) => {
      const aInfo = getCorrelationInfo(a);
      const bInfo = getCorrelationInfo(b);
      
      // 1) lower p is better
      if (aInfo.p !== bInfo.p) return aInfo.p - bInfo.p;
      // 2) tie-breaker: stronger absolute correlation
      const absDiff = Math.abs(bInfo.r) - Math.abs(aInfo.r);
      if (absDiff !== 0) return absDiff;
      // 3) stable fallback: by tool name to avoid nondeterminism
      const aTool = a.related?.tools?.[0] || '';
      const bTool = b.related?.tools?.[0] || '';
      return String(aTool).localeCompare(String(bTool));
    })[0];
}

export function dedupeKeepPrimaryTool(insights: PerformanceInsight[]): PerformanceInsight[] {
  const groups = new Map<string, PerformanceInsight[]>();
  for (const ins of insights) {
    const key = equivalenceKey(ins);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ins);
  }

  const result: PerformanceInsight[] = [];
  for (const [_, group] of groups.entries()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    const primary = pickPrimary(group);

    // Note other tools that had the same finding (optional — for evidence/tooltip only)
    const others = group
      .filter(g => g !== primary && g.related?.tools?.[0] && g.related.tools[0] !== primary.related?.tools?.[0])
      .map(g => String(g.related?.tools?.[0] || '').toUpperCase())
      .filter(Boolean);

    const alsoObservedInTools = Array.from(new Set(others));

    const note =
      alsoObservedInTools.length > 0
        ? ` Also observed in ${alsoObservedInTools.join(", ")}.`
        : "";

    // Add note to description
    const enhancedDescription = primary.description + note;

    result.push({
      ...primary,
      description: enhancedDescription,
      // Keep tool-specific title/action exactly as-is — this remains IDE-specific.
    });
  }
  return result;
}
