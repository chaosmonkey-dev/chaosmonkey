import { describe, it, expect } from 'vitest'
import { finiteNumberOrNull } from '../lib/workflowIdentity'
import { resolveTimeSeriesPointField } from '../lib/productivity/resolveTimeSeriesPointField'

describe('finiteNumberOrNull — measured value preservation', () => {
  it('preserves finite numeric 0', () => {
    expect(finiteNumberOrNull(0)).toBe(0)
  })

  it('preserves finite positive numbers', () => {
    expect(finiteNumberOrNull(42)).toBe(42)
  })

  it('preserves finite negative numbers', () => {
    expect(finiteNumberOrNull(-3.14)).toBe(-3.14)
  })

  it('converts null to null', () => {
    expect(finiteNumberOrNull(null)).toBeNull()
  })

  it('converts undefined to null', () => {
    expect(finiteNumberOrNull(undefined)).toBeNull()
  })

  it('converts empty string to null', () => {
    expect(finiteNumberOrNull('')).toBeNull()
  })

  it('converts non-numeric string to null', () => {
    expect(finiteNumberOrNull('abc')).toBeNull()
  })

  it('converts NaN to null', () => {
    expect(finiteNumberOrNull(NaN)).toBeNull()
  })

  it('converts Infinity to null', () => {
    expect(finiteNumberOrNull(Infinity)).toBeNull()
  })

  it('converts -Infinity to null', () => {
    expect(finiteNumberOrNull(-Infinity)).toBeNull()
  })

  it('parses numeric strings', () => {
    expect(finiteNumberOrNull('42.5')).toBe(42.5)
  })
})

describe('resolveTimeSeriesPointField — unknown metric must not fall back to v', () => {
  it('resolves known metric to its canonical point field', () => {
    expect(resolveTimeSeriesPointField('ide.commits_per_session')).toBe('commits_per_session')
    expect(resolveTimeSeriesPointField('ide.ai_suggestions_accepted')).toBe('AI_suggestions_accepted')
  })

  it('resolves bare metric name without ide. prefix', () => {
    expect(resolveTimeSeriesPointField('commits_per_session')).toBe('commits_per_session')
  })

  it('returns null for unknown metric ID', () => {
    expect(resolveTimeSeriesPointField('ide.unknown_metric')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(resolveTimeSeriesPointField('')).toBeNull()
  })

  it('returns null for completely unknown metric', () => {
    expect(resolveTimeSeriesPointField('nonexistent_metric_xyz')).toBeNull()
  })
})
