// Minimal week rollup for EngOutputPoint + ToolProductivityPoint
// Assumes inputs have a .period that is parseable as Date/ISO.
// Period output is Monday-start YYYY-MM-DD.

import type { EngOutputPoint, ToolProductivityPoint } from './types'

function toDate(x: any): Date | undefined {
  try {
    if (!x) return
    if (x instanceof Date && !isNaN(x.getTime())) return x
    if (typeof x === 'number') return new Date(x)
    if (typeof x === 'string') return new Date(x)
  } catch {}
  return
}

function pad2(n:number){ return n < 10 ? `0${n}` : `${n}` }
function mondayStart(d: Date): Date {
  const nd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = nd.getUTCDay() || 7 // Monday=1..Sunday=7
  if (dow > 1) nd.setUTCDate(nd.getUTCDate() - (dow - 1))
  return nd
}
function isoDay(d: Date){ return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}` }

type Group<T> = Record<string, T[]>

function groupByWeek<T extends { period?: any }>(arr: T[]): Group<T> {
  const g: Group<T> = {}
  for (const x of (arr || [])) {
    const d = toDate((x as any).period)
    if (!d) continue
    const k = isoDay(mondayStart(d))
    ;(g[k] ||= []).push(x)
  }
  return g
}

export function rollupEngToWeeks(points: EngOutputPoint[]): EngOutputPoint[] {
  const g = groupByWeek(points || [])
  const out: EngOutputPoint[] = []
  for (const k of Object.keys(g).sort()) {
    const bucket = g[k]
    if (!bucket.length) continue
    const sum = (f: keyof EngOutputPoint) =>
      bucket.reduce((acc, p) => acc + (typeof p[f] === 'number' ? (p[f] as number) : 0), 0)
    const avg = (f: keyof EngOutputPoint) => {
      const vals = bucket.map(p => (typeof p[f] === 'number' ? (p[f] as number) : undefined)).filter(v => v !== undefined) as number[]
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : undefined
    }
    out.push({
      period: k,
      // sums
      prMerged: sum('prMerged') || undefined,
      prOpened: sum('prOpened') || undefined,
      prClosed: sum('prClosed') || undefined,
      prReopened: sum('prReopened') || undefined,
      // averages
      prCycleTimeHours: avg('prCycleTimeHours'),
      timeToFirstReviewHours: avg('timeToFirstReviewHours'),
      deploymentFreqPerWeek: avg('deploymentFreqPerWeek'),
      mergeRatePct: avg('mergeRatePct'),
      changeFailureRatePct: avg('changeFailureRatePct'),
      // passthrough optional ids (leave undefined at week level)
    })
  }
  return out
}

export function rollupProdToWeeks(points: ToolProductivityPoint[]): ToolProductivityPoint[] {
  // Roll up per (tool) per week
  const grouped: Record<string, ToolProductivityPoint[]> = {}
  for (const p of (points || [])) {
    const d = toDate(p.period)
    if (!d) continue
    const week = isoDay(mondayStart(d))
    const key = `${p.tool || 'unknown'}||${week}`
    ;(grouped[key] ||= []).push(p)
  }

  const out: ToolProductivityPoint[] = []
  for (const key of Object.keys(grouped)) {
    const bucket = grouped[key]
    const [tool, week] = key.split('||')
    const sum = (f: keyof ToolProductivityPoint) =>
      bucket.reduce((acc, p) => acc + (typeof p[f] === 'number' ? (p[f] as number) : 0), 0)
    const avg = (f: keyof ToolProductivityPoint) => {
      const vals = bucket.map(p => (typeof p[f] === 'number' ? (p[f] as number) : undefined)).filter(v => v !== undefined) as number[]
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : undefined
    }
    out.push({
      period: week,
      tool,
      aiAssists: sum('aiAssists') || 0,
      codingMinutes: sum('codingMinutes') || 0,
      // carry through optional fields if needed later; use avg for rates
      // team/repo/developer omitted at rollup for safety
    })
  }
  return out
}
