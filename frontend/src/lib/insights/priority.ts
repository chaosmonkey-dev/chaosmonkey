import type { PerformanceInsight } from './types'
import { DEMO_MODE } from './performanceEngine'

// Per-metric thresholds for statistical gating
/**
 * DEMO_MODE: Lowered thresholds for small datasets.
 * Production mode should use stricter values.
 * Now imported from performanceEngine to ensure consistency.
 */

export function metricThresholds(metricId?: string) {
  const m = (metricId || '').toLowerCase()
  
  // Demo-friendly thresholds (lower requirements)
  if (DEMO_MODE) {
    const def = { minN: 2, pMax: 0.15, minAbsR: 0.25 }
    if (m.includes('cycle'))   return { minN: 2, pMax: 0.15, minAbsR: 0.30 }
    if (m.includes('failure')) return { minN: 2, pMax: 0.15, minAbsR: 0.30 }
    if (m.includes('merge'))   return { minN: 2, pMax: 0.15, minAbsR: 0.25 }
    if (m.includes('deploy'))  return { minN: 2, pMax: 0.15, minAbsR: 0.25 }
    return def
  }
  
  // Production thresholds (strict, original values)
  const def = { minN: 4, pMax: 0.10, minAbsR: 0.35 }
  if (m.includes('cycle'))   return { minN: 6, pMax: 0.08, minAbsR: 0.45 }
  if (m.includes('failure')) return { minN: 6, pMax: 0.08, minAbsR: 0.45 }
  if (m.includes('merge'))   return { minN: 4, pMax: 0.12, minAbsR: 0.30 }
  if (m.includes('deploy'))  return { minN: 4, pMax: 0.12, minAbsR: 0.30 }
  return def
}

// Small, transparent scoring model. Tweak weights as you like.
export function scoreInsight(i: PerformanceInsight): number {
  const sev = (i.severity || 'info').toLowerCase()
  const scope = (i.scope || 'org').toLowerCase()
  const tags = (i.tags || []).map(t => t.toLowerCase())
  const src  = (i.source || 'mixed').toLowerCase()

  const sevW = sev.includes('critical') ? 1.0 : sev.includes('warning') ? 0.7 : 0.4
  const scopeW = scope === 'org' ? 1.0 : scope === 'team' ? 0.8 : 0.6
  const qualityW = tags.includes('quality') ? 1.0 : tags.includes('velocity') ? 0.8 : 0.6
  const srcW = src === 'real' ? 1.0 : src === 'mixed' ? 0.9 : 0.7

  // Pull numeric signals if present (z-score, correlation, trend magnitude)
  const z = getEvidenceNumber(i, ['z', 'z-score', 'zscore']) ?? 0
  const corr = Math.abs(getEvidenceNumber(i, ['correlation', 'r']) ?? 0) // 0..1
  const trendPct = Math.abs(getEvidencePercent(i, ['trend magnitude', 'change over time']) ?? 0) / 100 // 0..1

  // Normalize and cap contributions
  const zC = Math.min(Math.max(z / 3, 0), 1)        // z>3 treated as max impact
  const cC = Math.min(Math.max(corr, 0), 1)
  const tC = Math.min(Math.max(trendPct, 0), 1)

  const base = 50 * sevW * scopeW * qualityW * srcW
  const lift = 50 * (0.50 * zC + 0.35 * cC + 0.15 * tC)

  return Math.round(Math.min(100, base + lift))
}

function getEvidenceNumber(i: PerformanceInsight, keys: string[]): number | undefined {
  const e = (i.evidence || []).find(ev => keys.some(k => (ev.label || '').toLowerCase().includes(k)))
  if (!e) return
  const n = typeof e.value === 'number' ? e.value : parseFloat(String(e.value).replace(/[^\d.-]/g,''))
  return isFinite(n) ? n : undefined
}

function getEvidencePercent(i: PerformanceInsight, keys: string[]): number | undefined {
  const e = (i.evidence || []).find(ev => keys.some(k => (ev.label || '').toLowerCase().includes(k)))
  if (!e) return
  const s = String(e.value)
  const m = s.match(/-?\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) : undefined
}

// Decide positive/negative metric polarity -> normalized severity
// E.g. high cycle time => negative (lowlight/risk), high efficiency => positive (opportunity/highlight)
export function normalizeSeverity(i: PerformanceInsight): 'risk'|'lowlight'|'opportunity'|'highlight' {
  const metric = (i.metricId || '').toLowerCase()
  const title = (i.title || '').toLowerCase()
  const desc  = (i.description || i.summary || '').toLowerCase()

  // Try to read correlation sign from evidence
  const corr = (() => {
    const ev = (i.evidence || []).find(e => /corr|r\)?$/i.test(e?.label || ''))
    const n = typeof ev?.value === 'number' ? ev.value : parseFloat(String(ev?.value ?? '').replace(/[^\d.-]/g,''))
    return isNaN(n) ? undefined : n
  })()

  const saysIncrease = /(increase|higher|rises|longer|up|worse)/i.test(title) || /(increase|higher|rises|longer|up|worse)/i.test(desc)
  const saysDecrease = /(decrease|lower|drops|shorter|down|better)/i.test(title) || /(decrease|lower|drops|shorter|down|better)/i.test(desc)

  // Cycle time: higher = bad, lower = good
  if (metric.includes('cycle') || title.includes('cycle time')) {
    if (typeof corr === 'number') return corr > 0 ? 'lowlight' : 'opportunity'
    if (saysIncrease) return 'lowlight'
    if (saysDecrease) return 'opportunity'
  }

  // Change Failure Rate: higher = bad, lower = good
  if (metric.includes('failure') || title.includes('change failure')) {
    if (typeof corr === 'number') return corr > 0 ? 'lowlight' : 'opportunity'
    if (saysIncrease) return 'lowlight'
    if (saysDecrease) return 'opportunity'
  }

  // Efficiency / Merge rate / Deployment frequency: higher = good
  if (metric.includes('efficiency') || metric.includes('merge') || metric.includes('deploy')) {
    if (typeof corr === 'number') return corr > 0 ? 'opportunity' : 'lowlight'
    if (saysIncrease) return 'opportunity'
    if (saysDecrease) return 'lowlight'
  }

  // Fail-safe: check title for cycle time polarity
  if (/cycle time/i.test(i.title || '')) {
    if (/(increase|higher|longer)/i.test(i.title || '')) return 'lowlight'
    if (/(decrease|lower|shorter)/i.test(i.title || '')) return 'opportunity'
  }

  return (i.severity === 'critical') ? 'risk'
       : (i.severity === 'warning')  ? 'lowlight'
       : 'opportunity'
}

// flag as critical if risk + high score OR certain tags + thresholds
export function isCritical(i: PerformanceInsight): boolean {
  const sev = (i.severity || '').toLowerCase()
  const score = i.priorityScore ?? 0
  const tags = (i.tags || []).map(t => t.toLowerCase())
  const z = getEvidenceNumber(i, ['z', 'z-score', 'zscore']) ?? 0
  const cfr = getEvidenceNumber(i, ['cfr', 'change failure rate']) ?? 0

  if (sev.includes('critical')) return true
  if (tags.includes('quality') && (cfr >= 10 || z >= 2)) return true
  if (score >= 80 && (tags.includes('quality') || tags.includes('velocity'))) return true
  return false
}

function normalizeActions(i: PerformanceInsight): PerformanceInsight {
  const seen = new Set<string>()
  const recs = (i.recommendations || []).map((r) => {
    let text = (r?.text || '').trim()
    if (!text) return null
    // add a default owner + timebox if absent
    if (!/owner:/i.test(text)) text = `${text} (owner: Eng Manager`
    if (!/(within|by)\s+\d+\s*(day|week|month|d|w|m)/i.test(text)) text = `${text}, within 2 weeks)`
    if (!/\)$/.test(text)) text = `${text})`
    const key = text.toLowerCase()
    if (seen.has(key)) return null
    seen.add(key)
    return { ...r, text }
  }).filter(Boolean) as typeof i.recommendations
  return { ...i, recommendations: recs }
}

// Helper functions for action variety
function hash(str:string): number { 
  let h=0; 
  for (let i=0;i<str.length;i++) h=(h*31 + str.charCodeAt(i))|0; 
  return Math.abs(h) 
}

function pick<T>(arr:T[], key:string): T { 
  const idx = Math.abs(hash(key)) % arr.length; 
  return arr[idx] 
}

function sharpenAction(i: PerformanceInsight): PerformanceInsight {
  const m = (i.metricId || '').toLowerCase();
  const tool = (i.tools?.[0] || 'tool').toUpperCase();
  const key = (i.title || '') + '|' + tool + '|' + (i.metricId || '');
  const poolCycleUp = [
    `Auto-assign reviewers + SLA alerts for PRs >24h (owner: Eng Manager, 2w)`,
    `Enforce small PR policy (>400 LOC split) (owner: TL, 1w)`,
    `Enable pre-merge CI cache & linters (owner: DevEx, 2w)`,
  ];
  const poolCFRUp = [
    `Gate merges on unit+e2e for risky paths (owner: QA Lead, 2w)`,
    `Require rollback plan & risk tag in PR template (owner: TL, 1w)`,
    `Add mandatory pair-review on hot modules (owner: Eng Manager, 2w)`,
  ];
  const poolEfficiency = [
    `Publish ${tool} presets and keybinds cheatsheet (owner: DevEx, 2w)`,
    `Run ${tool} office hours to share tips (owner: DevEx, 2w)`,
    `Create ${tool} best-practice screencasts (owner: DevEx, 3w)`,
  ];
  const add = (t:string) => ({ text: t.replace(/\(owner:[^)]+\)/,'').trim().endsWith(')') ? t : `${t}` , actionType: 'process' as const })

  const recs:any[] = [...(i.recommendations || [])]
  if (/(cycle[- ]?time)/i.test(m) || /cycle time/i.test(i.title||'')) {
    recs.push(add(pick(poolCycleUp, key)))
  }
  if (/(failure|cfr)/i.test(m) || /failure rate/i.test(i.title||'')) {
    recs.push(add(pick(poolCFRUp, key)))
  }
  if (/(efficiency|merge[- ]?rate|deployment)/i.test(m)) {
    recs.push(add(pick(poolEfficiency, key)))
  }
  return normalizeActions({ ...i, recommendations: recs })
}

// Post-processor applied to the whole list
export function diversifyInsights(
  ins: PerformanceInsight[], 
  kPerMetric = 2, 
  maxTotal = 12,
  opts?: { lockedEquivalenceKeys?: Set<string> }
): PerformanceInsight[] {
  const locked = opts?.lockedEquivalenceKeys ?? new Set<string>();
  
  console.log('🔍 diversifyInsights - input:', ins.length, 'locked:', locked.size, 'kPerMetric:', kPerMetric, 'maxTotal:', maxTotal);
  
  const byMetric = new Map<string, PerformanceInsight[]>();
  for (const i of ins) {
    const m = (i.metricId || 'unknown').toLowerCase();
    const arr = byMetric.get(m) || [];
    arr.push(i);
    byMetric.set(m, arr);
    console.log('🔍 diversifyInsights - grouping insight:', i.id, 'metricId:', i.metricId, 'grouped as:', m);
  }
  
  console.log('🔍 diversifyInsights - by metric:', Array.from(byMetric.entries()).map(([m, arr]) => `${m}: ${arr.length}`));
  
  const out: PerformanceInsight[] = [];
  // round-robin pull: top-1 of each metric, then second pass, etc.
  let round = 0;
  while (out.length < maxTotal) {
    let added = 0;
    for (const [m, arr] of byMetric) {
      const sorted = [...arr].sort((a,b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
      const pick = sorted[round];
      if (pick && out.filter(x => (x.metricId || 'unknown') === m).length < kPerMetric) {
        out.push(pick);
        added++;
      }
    }
    if (!added) break;
    round++;
  }
  
  console.log('🔍 diversifyInsights - after round-robin:', out.length);
  
  // If we have locked items, ensure they're included and not removed
  if (locked.size > 0) {
    const lockedItems = ins.filter(i => {
      // Use a simple approach - check if the insight is in the locked set by ID
      // This is a simplified approach since we can't easily import equivalenceKey here
      return locked.has(i.id);
    });
    
    console.log('🔍 diversifyInsights - locked items found:', lockedItems.length);
    
    // Add locked items that aren't already in the output
    for (const lockedItem of lockedItems) {
      if (!out.some(item => item.id === lockedItem.id)) {
        out.push(lockedItem);
        console.log('🔍 diversifyInsights - added locked item:', lockedItem.id);
      }
    }
  }
  
  const result = out.slice(0, maxTotal);
  console.log('🔍 diversifyInsights - final result:', result.length);
  return result;
}

// ⬇️ Add near bottom of file (export it)
export function dedupeInsights(list: PerformanceInsight[]): PerformanceInsight[] {
  const mode = (import.meta.env.VITE_PERF_INSIGHTS_DEDUPE || 'soft').toLowerCase()
  
  if (mode === 'off') {
    return list || []
  }
  
  const byKey = new Map<string, PerformanceInsight>()
  for (const i of list || []) {
    let key: string
    
    if (mode === 'soft') {
      // Soft dedupe: only near-identical titles + ~same correlation + SAME STAGE get merged
      // ⚠️ CRITICAL: Include cicdStage to prevent cross-stage deduplication!
      const stage = (i.cicdStage || 'other').toLowerCase()
      const title = (i.title || '').toLowerCase().replace(/[^\w\s]/g, '').trim()
      const corrEv = (i.evidence || []).find(e => /corr|\br\)?$/i.test(e?.label || ''))
      const corr = typeof corrEv?.value === 'number' ? corrEv.value : parseFloat(String(corrEv?.value ?? '').replace(/[^\d.-]/g,''))
      const corrBucket = isNaN(corr) ? 'unknown' : (Math.abs(corr) > 0.7 ? 'high' : (Math.abs(corr) > 0.3 ? 'med' : 'low'))
      key = `${stage}::${title}::${corrBucket}`
    } else {
      // Hard dedupe: at most one per (metric, tool, lag-sign, stage)
      // ⚠️ CRITICAL: Include cicdStage to prevent cross-stage deduplication!
      const stage = (i.cicdStage || 'other').toLowerCase()
      const metric = (i.metricId || 'unknown').toLowerCase()
      const tool = (i.tools?.[0]?.toLowerCase?.() ?? '')
      // capture lag sign if present in evidence (neg/zero/pos)
      const lagLabel = (i.evidence || []).find(e => /lag/i.test(e?.label || ''))
      const lagVal = typeof lagLabel?.value === 'number'
        ? lagLabel.value
        : parseFloat(String(lagLabel?.value ?? '').replace(/[^\d.-]/g,''))
      const lagSign = isNaN(lagVal) ? '' : (lagVal === 0 ? 'zero' : (lagVal > 0 ? 'pos' : 'neg'))
      key = `${stage}::${metric}::${tool}::${lagSign}`
    }
    
    const existing = byKey.get(key)
    if (!existing) { byKey.set(key, i); continue }

    // prefer higher |correlation|, then higher priorityScore
    const corrAbs = (x: PerformanceInsight) => {
      const ev = (x.evidence || []).find(e => /corr|\br\)?$/i.test(e?.label || ''))
      const n = typeof ev?.value === 'number' ? ev.value : parseFloat(String(ev?.value ?? '').replace(/[^\d.-]/g,''))
      return isNaN(n) ? undefined : Math.abs(n)
    }
    const a = corrAbs(i) ?? Math.abs((i as any).priorityScore ?? 0)
    const b = corrAbs(existing) ?? Math.abs((existing as any).priorityScore ?? 0)
    if (a >= b) byKey.set(key, i)
  }
  return Array.from(byKey.values())
}

// wrappers that never throw
function safeScore(i: PerformanceInsight): number {
  try { 
    return scoreInsight(i); 
  } catch { 
    return 0; 
  }
}

function safeNormalize(i: PerformanceInsight): PerformanceInsight['normalizedSeverity'] {
  try { 
    return normalizeSeverity(i); 
  } catch { 
    return 'opportunity'; 
  }
}

function safeCritical(i: PerformanceInsight): boolean {
  try { 
    return isCritical(i); 
  } catch { 
    return false; 
  }
}

// Impact scoring for better ordering (severity × correlation × recency)
export function impactScore(i: PerformanceInsight) {
  const sev   = i.normalizedSeverity === 'risk' ? 1.0 : i.normalizedSeverity === 'lowlight' ? 0.8 : 0.5
  const rAbs  = Math.min(1, Math.abs(Number((i.evidence||[]).find(e => /Correlation/.test(e.label||''))?.value) || i['r'] || 0))
  const rec   = Number((i.evidence||[]).find(e => /Periods/i.test(e.label||''))?.value) || 0
  const recencyBoost = Math.min(1, rec/8) // up to 8 periods
  return (sev * 60) + (rAbs * 30) + (recencyBoost * 10)
}

// Cap per-tool & guarantee cross-tool variety in priority strip
export function capPerTool(ins: PerformanceInsight[], maxPerTool = 1) {
  const seen = new Map<string, number>()
  const out: PerformanceInsight[] = []
  for (const i of ins) {
    const tool = (i.tools?.[0] || 'unknown').toLowerCase()
    const cnt = seen.get(tool) || 0
    if (cnt < maxPerTool) {
      out.push(i)
      seen.set(tool, cnt + 1)
    }
  }
  return out
}

// Post-processor applied to the whole list
export function postProcessInsights(list: PerformanceInsight[]): PerformanceInsight[] {
  const out: PerformanceInsight[] = [];
  for (const i of (list || [])) {
    try {
      const normalizedSeverity = safeNormalize(i);
      const priorityScore = safeScore(i);
      const critical = safeCritical({ ...i, priorityScore, normalizedSeverity });
      // ⬇️ apply action sharpening and normalization
      const enriched = sharpenAction({ ...i, normalizedSeverity, priorityScore, critical });
      out.push(enriched);
    } catch (e) {
      // If one item misbehaves, keep the original item rather than dropping it.
      console.warn('[insights] postProcess item skipped:', i?.id || i?.title, e);
      out.push(i);
    }
  }
  // ⬇️ apply dedupe (diversity already handled in engine)
  const deduped = dedupeInsights(out);
  
  // NOTE: diversifyInsights is now called in performanceEngine.ts BEFORE postProcess
  // to avoid double-limiting. We used to call it here, but that created a second
  // bottleneck (kPerMetric=2) that cut insights from 4→2.
  // Now we just dedupe and return.
  
  if (import.meta.env.DEV) {
    console.debug('[postProcessInsights] After dedupe:', deduped.length, '(diversity already applied in engine)')
  }
  
  return deduped;
}
