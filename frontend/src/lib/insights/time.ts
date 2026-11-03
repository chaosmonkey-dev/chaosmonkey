// Granularity-aware period helpers
import { isCMPIDebugEnabled } from '../perf/debugGate'

export type Granularity = 'hour' | 'day' | 'week' | 'month' | 'quarter';

import { toCanonicalPeriodKey } from './engine/period';

const pad = (n:number) => (n < 10 ? `0${n}` : `${n}`);

export function startOfWeekISO(d: Date): string {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Mon=0
  date.setDate(date.getDate() - day);
  date.setHours(0,0,0,0);
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}

export function periodKey(input: any, granularity: Granularity): string | undefined {
  if (!input) return undefined;
  const d = typeof input === 'string' ? new Date(input) : input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return undefined;

  const Y = d.getFullYear();
  const M = pad(d.getMonth()+1);
  const D = pad(d.getDate());
  const H = pad(d.getHours());

  switch (granularity) {
    case 'hour':    return `${Y}-${M}-${D}T${H}`;
    case 'day':     return `${Y}-${M}-${D}`;
    case 'week':    return startOfWeekISO(d);
    case 'month':   return `${Y}-${M}`;
    case 'quarter': return `${Y}-Q${Math.floor(d.getMonth()/3)+1}`;
  }
}

// Heuristic: derive granularity from filter store viewBucket values
export function deriveGranularity(filterStore: any): Granularity {
  // Try to get viewBucket from the filter store's dashboard filters
  const viewBucket = 
    filterStore?.filters?.engineering?.viewBucket ??
    filterStore?.filters?.ideActivity?.viewBucket ??
    filterStore?.filters?.productivity?.viewBucket ??
    filterStore?.engineeringFilters?.viewBucket ??
    filterStore?.ideActivityFilters?.viewBucket ??
    filterStore?.productivityFilters?.viewBucket ??
    filterStore?.filters?.window ??
    filterStore?.filters?.rangeType ??
    filterStore?.filters?.comparison ??
    filterStore?.time?.window ??
    filterStore?.comparison ??
    filterStore?.rangeType ??
    '';

  const s = String(viewBucket).toLowerCase();

  if (s.includes('hour'))    return 'hour';
  if (s.includes('day'))     return 'day';
  if (s.includes('week'))    return 'week';
  if (s.includes('month'))   return 'month';
  if (s.includes('quarter')) return 'quarter';

  // Default to 'day' since that's what the filter store defaults to
  return 'day';
}

// Count non-empty periods
export function countPeriods(arr: any[]): number {
  const s = new Set<string>();
  for (const x of (arr || [])) {
    const p = x?.period;
    if (p) s.add(p);
  }
  return s.size;
}

export function overlapCount(a: any[], b: any[]): number {
  const A = new Set(
    (a || [])
      .map(x => toCanonicalPeriodKey(x?.period ? String(x.period) : undefined))
      .filter(Boolean) as string[]
  );
  const B = new Set(
    (b || [])
      .map(x => toCanonicalPeriodKey(x?.period ? String(x.period) : undefined))
      .filter(Boolean) as string[]
  );
  let n = 0; for (const k of A) if (B.has(k)) n++;
  return n;
}

/**
 * Try preferred granularity first; if there are not enough overlapping points,
 * fall back to coarser granularities in order.
 */
export function pickBestGranularity(
  resolverGH: (g: Granularity) => { data: any[], source: string },
  resolverProd: (g: Granularity) => { data: any[], source: string },
  preferred: Granularity,
  minOverlap = 4
): { granularity: Granularity, gh: {data:any[],source:string}, prod: {data:any[],source:string} } {
  // If preferred is 'day', try 'day' once; if overlap < minOverlap, try 'week' next.
  const order: Granularity[] =
    preferred === 'day'
      ? ['day', 'week', 'month', 'quarter']
      : [preferred, 'day', 'week', 'month', 'quarter'];

  if (isCMPIDebugEnabled()) console.log('🔍 pickBestGranularity - trying granularities:', order);
  if (isCMPIDebugEnabled()) console.log('🔍 pickBestGranularity - preferred:', preferred, 'minOverlap:', minOverlap);

  for (const g of order) {
    const gh = resolverGH(g);
    const prod = resolverProd(g);
    const overlap = overlapCount(gh.data, prod.data);
    
    if (isCMPIDebugEnabled()) console.log(`🔍 pickBestGranularity - ${g}:`, {
      ghDataLength: gh.data.length,
      prodDataLength: prod.data.length,
      overlap,
    });
    
    if (overlap >= minOverlap) {
      if (isCMPIDebugEnabled()) console.log(`🔍 pickBestGranularity - ✅ Found sufficient overlap with ${g}`);
      return { granularity: g, gh, prod };
    }
  }
  
  if (isCMPIDebugEnabled()) console.log('🔍 pickBestGranularity - ⚠️ No granularity met overlap threshold, returning preferred');
  // If nothing meets overlap, return preferred anyway (so UI can show "no data")
  const gh = resolverGH(preferred);
  const prod = resolverProd(preferred);
  return { granularity: preferred, gh, prod };
}
