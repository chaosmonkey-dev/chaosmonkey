import { describe, it, expect } from 'vitest'
import { resolveTimeSeriesPointField } from '../lib/productivity/resolveTimeSeriesPointField'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const pbtSource = readFileSync(join(__dirname, '../components/ProductivityByToolV3.vue'), 'utf-8')

describe('PBT time-series point-field resolver', () => {
  it('resolves prefixed AI activity metrics to the unified-record casing', () => {
    expect(resolveTimeSeriesPointField('ide.ai_suggestions_accepted')).toBe('AI_suggestions_accepted')
    expect(resolveTimeSeriesPointField('ide.AI_suggestions_accepted')).toBe('AI_suggestions_accepted')
    expect(resolveTimeSeriesPointField('ide.ai_usage_duration_minutes')).toBe('AI_usage_duration_minutes')
    expect(resolveTimeSeriesPointField('ide.AI_usage_duration_minutes')).toBe('AI_usage_duration_minutes')
  })

  it('resolves bare metric IDs by adding the ide. prefix automatically', () => {
    expect(resolveTimeSeriesPointField('ai_suggestions_accepted')).toBe('AI_suggestions_accepted')
    expect(resolveTimeSeriesPointField('commits_per_session')).toBe('commits_per_session')
    expect(resolveTimeSeriesPointField('files_edited_per_session')).toBe('files_edited_per_session')
    expect(resolveTimeSeriesPointField('average_session_length_minutes')).toBe('average_session_length_minutes')
    expect(resolveTimeSeriesPointField('time_to_first_commit_minutes')).toBe('time_to_first_commit_minutes')
    expect(resolveTimeSeriesPointField('active_coding_time_minutes')).toBe('active_coding_time_minutes')
    expect(resolveTimeSeriesPointField('active_coding_ratio')).toBe('active_coding_ratio')
    expect(resolveTimeSeriesPointField('ai_usage_ratio')).toBe('ai_usage_ratio')
    expect(resolveTimeSeriesPointField('idle_ratio')).toBe('idle_ratio')
    expect(resolveTimeSeriesPointField('idle_time_minutes')).toBe('idle_time_minutes')
    expect(resolveTimeSeriesPointField('ai_usage_duration_minutes')).toBe('AI_usage_duration_minutes')
  })

  it('returns null for unknown metrics so callers must handle them explicitly', () => {
    expect(resolveTimeSeriesPointField('ide.unsupported_metric')).toBeNull()
    expect(resolveTimeSeriesPointField('unsupported_metric')).toBeNull()
    expect(resolveTimeSeriesPointField('')).toBeNull()
  })

  it('no longer contains duplicated inline metric maps in the PBT component', () => {
    expect(pbtSource).not.toContain('METRIC_TO_POINT_FIELD')
    expect(pbtSource).not.toContain('METRIC_ID_TO_POINT_FIELD')
  })
})
