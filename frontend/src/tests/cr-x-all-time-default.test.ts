// CR-X PI/PBT-TIME: All-time sentinel convergence test.
// Verifies that PI (dataAccess.ts) and PBT (telemetryToUnified.ts) use the
// same ALL_TIME_START constant when no explicit from/to is provided.
import { describe, it, expect } from 'vitest'
import { ALL_TIME_START } from '../stores/analysisContext'

describe('CR-X PI/PBT-TIME: all-time sentinel convergence', () => {
  it('ALL_TIME_START is exported from analysisContext', () => {
    expect(ALL_TIME_START).toBeDefined()
    expect(typeof ALL_TIME_START).toBe('string')
    expect(ALL_TIME_START.length).toBe(10) // YYYY-MM-DD
  })

  it('ALL_TIME_START is 2020-01-01 (not 2000-01-01)', () => {
    // Previously PBT used 2000-01-01 and PI used 2020-01-01.
    // After convergence, both must use the same sentinel.
    expect(ALL_TIME_START).toBe('2020-01-01')
  })

  it('ALL_TIME_START is a valid ISO date', () => {
    // Parse as UTC to avoid timezone shifting the year
    const d = new Date(ALL_TIME_START + 'T00:00:00.000Z')
    expect(d.getUTCFullYear()).toBe(2020)
    expect(d.getUTCMonth()).toBe(0) // January
    expect(d.getUTCDate()).toBe(1)
  })

  it('dataAccess.ts imports ALL_TIME_START (source-level proof)', async () => {
    // Read the source file and verify the import exists
    const fs = await import('fs')
    const path = await import('path')
    const dataAccessPath = path.resolve(__dirname, '../lib/insights/final/dataAccess.ts')
    const source = fs.readFileSync(dataAccessPath, 'utf8')
    expect(source).toContain('ALL_TIME_START')
    expect(source).toContain("from '../../../stores/analysisContext'")
    // Verify old hardcoded sentinel is gone
    expect(source).not.toContain("'2020-01-01'")
  })

  it('telemetryToUnified.ts imports ALL_TIME_START (source-level proof)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const telemetryPath = path.resolve(__dirname, '../lib/adapters/telemetryToUnified.ts')
    const source = fs.readFileSync(telemetryPath, 'utf8')
    expect(source).toContain('ALL_TIME_START')
    expect(source).toContain("from '../../stores/analysisContext'")
    // Verify old hardcoded sentinel is gone
    expect(source).not.toContain("'2000-01-01'")
  })

  it('Dashboards.vue imports ALL_TIME_START and does not use 2000-01-01 sentinel (source-level proof)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const dashboardsPath = path.resolve(__dirname, '../pages/Dashboards.vue')
    const source = fs.readFileSync(dashboardsPath, 'utf8')
    expect(source).toContain('ALL_TIME_START')
    expect(source).toContain("from '../stores/analysisContext'")
    // Verify old hardcoded sentinel is gone
    expect(source).not.toContain("'2000-01-01'")
  })
})
