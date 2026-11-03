import { describe, it, expect } from 'vitest'
import { populateWindowPIAudit } from '../lib/insights/final/utils/audit'
import type { PerformanceInsight } from '../lib/insights/final/adapters/renderAdapter'

// ============================================================
// CR5 V1 FINAL RUNTIME REGRESSION — piDebugLog ReferenceError guard
//
// Proves:
// 1. populateWindowPIAudit does NOT throw ReferenceError for piDebugLog
// 2. The function completes and populates window.__PI_AUDIT
// 3. The audit result has the expected structure
//
// This test exists because a logging cleanup replaced console.log with
// piDebugLog in audit.ts without adding the import, causing a runtime
// ReferenceError that killed the final engine at STEP_6.
// ============================================================

describe('P0 — Runtime regression: piDebugLog import in audit.ts', () => {
  it('populateWindowPIAudit does not throw ReferenceError', () => {
    // Minimal valid PerformanceInsight array
    const mockInsights: PerformanceInsight[] = [
      {
        id: 'test-insight-1',
        title: 'Test Insight',
        category: 'plan-code',
        isDiagnostic: false,
        evidence: [],
        decisionCard: {
          cardType: 'neutral',
          claim: 'Test claim',
          claimSub: 'Test sub',
          evidenceCells: [],
          isLowerBetter: false,
          interpretation: 'Test interpretation',
          actionText: 'Test action',
          footerNote: 'Test footer'
        }
      } as any
    ]

    // This must NOT throw ReferenceError: piDebugLog is not defined
    expect(() => {
      populateWindowPIAudit(mockInsights, true, 0, [])
    }).not.toThrow()
  })

  it('populateWindowPIAudit populates window.__PI_AUDIT', () => {
    const mockInsights: PerformanceInsight[] = [
      {
        id: 'test-insight-2',
        title: 'Test Insight 2',
        category: 'plan-code',
        isDiagnostic: false,
        evidence: [],
        decisionCard: {
          cardType: 'neutral',
          claim: 'Test claim',
          claimSub: 'Test sub',
          evidenceCells: [],
          isLowerBetter: false,
          interpretation: 'Test interpretation',
          actionText: 'Test action',
          footerNote: 'Test footer'
        }
      } as any
    ]

    populateWindowPIAudit(mockInsights, true, 0, [])

    const audit = (window as any).__PI_AUDIT
    expect(audit).toBeDefined()
    expect(audit).not.toBeNull()
    expect(typeof audit).toBe('object')
    expect(audit).toHaveProperty('timestamp')
  })
})
