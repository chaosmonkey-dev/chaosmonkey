import { describe, it, expect } from 'vitest'
import { normalizeToCanonicalToolId } from '../lib/workflowIdentity'

function normalizePeriodToISO(period: string): string | null {
  if (!period) return null
  const m = period.match(/^(\d{4})-(\d{2})$/)
  if (m) {
    const year = parseInt(m[1], 10)
    const week = parseInt(m[2], 10)
    const ew = week === 0 ? 1 : week
    const ft = new Date(year, 0, 4)
    ft.setDate(ft.getDate() - (ft.getDay() + 6) % 7)
    const ws = new Date(ft)
    ws.setDate(ws.getDate() + (ew - 1) * 7)
    ws.setHours(0, 0, 0, 0)
    if (!Number.isNaN(ws.getTime())) return ws.toISOString()
  }
  const d = new Date(period)
  if (!Number.isNaN(d.getTime())) return d.toISOString()
  const f = new Date(`${period}T00:00:00Z`)
  if (!Number.isNaN(f.getTime())) return f.toISOString()
  return null
}

describe('ISO week conversion', () => {
  it('converts 2026-25 to correct date', () => {
    expect(normalizePeriodToISO('2026-25')).toContain('2026-06-15')
  })
  it('converts 2026-26 to correct date', () => {
    expect(normalizePeriodToISO('2026-26')).toContain('2026-06-22')
  })
  it('converts 2026-00 (week zero) without null', () => {
    expect(normalizePeriodToISO('2026-00')).not.toBeNull()
  })
  it('returns null for invalid period', () => {
    expect(normalizePeriodToISO('garbage')).toBeNull()
  })
})

describe('Windsurf+Devin canonical normalization', () => {
  it('normalizes windsurf to devin (CR1 canonical contract)', () => {
    expect(normalizeToCanonicalToolId('windsurf')).toBe('devin')
  })
  it('keeps devin as devin', () => {
    expect(normalizeToCanonicalToolId('devin')).toBe('devin')
  })
  it('keeps cursor as cursor', () => {
    expect(normalizeToCanonicalToolId('cursor')).toBe('cursor')
  })
  it('returns empty string for null/undefined input (null-safe)', () => {
    expect(normalizeToCanonicalToolId(null)).toBe('')
    expect(normalizeToCanonicalToolId(undefined)).toBe('')
    expect(normalizeToCanonicalToolId('')).toBe('')
  })
})

describe('Dedup merge preserves unique periods', () => {
  it('merges points from two series with same label', () => {
    const seriesA = {
      label: 'Devin workflow',
      points: [
        { t: '2026-06-15T00:00:00.000Z', v: 5 },
        { t: '2026-06-22T00:00:00.000Z', v: 6 },
      ],
    }
    const seriesB = {
      label: 'Devin workflow',
      points: [
        { t: '2026-05-25T00:00:00.000Z', v: 4 },
        { t: '2026-06-15T00:00:00.000Z', v: null },
      ],
    }
    const byTs = new Map<string, any>()
    seriesA.points.forEach(p => { if (p?.t) byTs.set(p.t, p) })
    for (const p of seriesB.points) {
      if (!p?.t) continue
      const ex = byTs.get(p.t)
      if (!ex) { byTs.set(p.t, p); continue }
      const merged = { ...ex }
      for (const k of Object.keys(p)) {
        if (k !== 't' && ex[k] == null && p[k] != null) merged[k] = p[k]
      }
      byTs.set(p.t, merged)
    }
    const merged = Array.from(byTs.values()).sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
    expect(merged).toHaveLength(3)
    expect(merged[0].t).toBe('2026-05-25T00:00:00.000Z')
    expect(merged[1].t).toBe('2026-06-15T00:00:00.000Z')
    expect(merged[1].v).toBe(5)
    expect(merged[2].t).toBe('2026-06-22T00:00:00.000Z')
  })
})
