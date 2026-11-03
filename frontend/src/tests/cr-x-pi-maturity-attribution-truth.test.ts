/**
 * CR-X PI maturity card attribution semantics regression.
 *
 * Matt's browser acceptance caught a contradiction in the pilot-maturity-
 * progression card:
 *
 *   Title: "Pilot status: multi-workflow comparison active
 *           (2139 sessions, 4 mature workflows)"
 *
 *   But the card also rendered:
 *     "IDE ATTRIBUTION / Unavailable / No IDE-level attribution available"
 *     "Not yet attributable by IDE/tool"
 *
 * This contradicts the card's own evidence: 4 mature workflows means
 * workflow/tool attribution IS available. The "IDE attribution Unavailable"
 * tile and "Not yet attributable by IDE/tool" interpretation were stale
 * legacy org-level copy inherited from the generic org-level card type.
 *
 * Root cause: the maturity generator sets presentationKind='org_summary',
 * which maps to cardType='org-level'. The org-level case rendered the
 * "IDE attribution Unavailable" tile for any non-repository-concentration
 * card, and the interpretation fell through to "Not yet attributable by
 * IDE/tool".
 *
 * Fix: the org-level case now has a dedicated pilot-maturity-progression
 * branch that renders truthful maturity evidence (stage, tracked workflows,
 * mature workflows, session population) and uses the generator's
 * whyItMatters as the interpretation — NOT the stale IDE-attribution copy.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { generatePilotMaturityProgression } from '../lib/insights/final/generators/planCode'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

// Ensure window/localStorage exists for vitest (Node by default)
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = { location: { search: '' } } as any
}
if (typeof (globalThis as any).localStorage === 'undefined') {
  const store: Record<string, string> = {}
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
  } as any
}

describe('CR-X PI maturity card: no IDE-attribution contradiction', () => {
  const componentPath = path.resolve(__dirname, '../components/PerformanceRecommendationsView.vue')
  const source = fs.readFileSync(componentPath, 'utf-8')

  function mkSession(workflow: string, overrides: Partial<any> = {}): any {
    return {
      session_id: `s-${Math.random().toString(36).slice(2)}`,
      tool: workflow,
      timestamp: '2026-07-15T10:00:00.000000Z',
      duration_ms: 600000,
      active_coding_duration_ms: 300000,
      session_active_coding_duration_minutes: 5,
      ...overrides,
    }
  }

  beforeEach(() => {
    ;(globalThis as any).localStorage.clear()
  })

  it('generator produces multi-workflow maturity with breakdownByTool when 2+ workflows have 25+ sessions', () => {
    // 4 workflows × 30 sessions each = 120 sessions, 4 mature workflows
    const sessions: any[] = []
    for (const wf of ['cursor', 'vscode', 'devin', 'claude_code']) {
      for (let i = 0; i < 30; i++) sessions.push(mkSession(wf))
    }

    const input = { sessionRows: sessions, granularity: 'month' } as any as CanonicalInsightInput
    const result = generatePilotMaturityProgression(input)
    expect(result).not.toBeNull()

    // Title must say "multi-workflow comparison active" with "mature workflows"
    expect((result as any).title).toContain('multi-workflow comparison active')
    expect((result as any).title).toContain('mature workflows')

    // breakdownByTool must have all 4 workflows
    const bt = (result as any).breakdownByTool
    expect(Object.keys(bt).length).toBe(4)

    // presentationKind is org_summary (maps to org-level card type)
    expect((result as any).presentationKind).toBe('org_summary')
  })

  it('renderer has a pilot-maturity-progression branch in the org-level case', () => {
    // The org-level case must detect pilot-maturity-progression and build
    // maturity-specific evidence — NOT the generic "IDE attribution Unavailable" tile.
    const orgLevelMatch = source.match(
      /case 'org-level': \{[\s\S]*?break\s*\}/
    )
    expect(orgLevelMatch).not.toBeNull()
    const orgLevel = orgLevelMatch![0]

    // Must have a pilot-maturity-progression check
    expect(orgLevel).toContain("pilot-maturity-progression")

    // Must have maturity-specific evidence cells
    expect(orgLevel).toContain('Maturity stage')
    expect(orgLevel).toContain('Tracked workflows')
    expect(orgLevel).toContain('Mature workflows')
    expect(orgLevel).toContain('Session population')
  })

  it('renderer does NOT show "IDE attribution Unavailable" for the maturity card', () => {
    // The maturity-specific evidence block must NOT contain the stale
    // IDE-attribution copy. Extract just the maturity evidence block.
    const maturityStart = source.indexOf("if (insightId === 'pilot-maturity-progression') {")
    expect(maturityStart).toBeGreaterThan(-1)
    // Find the next "evidenceCells =" after the maturity check
    const evidenceStart = source.indexOf('evidenceCells = [', maturityStart)
    expect(evidenceStart).toBeGreaterThan(-1)
    // Find the closing "] } else {" which marks the end of the maturity branch
    const elseIdx = source.indexOf('} else {', evidenceStart)
    expect(elseIdx).toBeGreaterThan(-1)
    const maturityBlock = source.slice(maturityStart, elseIdx)

    // Must NOT contain the stale IDE-attribution copy
    expect(maturityBlock).not.toContain('IDE attribution')
    expect(maturityBlock).not.toContain('No IDE-level attribution available')
  })

  it('renderer interpretation for maturity card uses whyItMatters, not "Not yet attributable"', () => {
    // Find the interpretation block for pilot-maturity-progression.
    // It's the occurrence near "interpretation =" and "whyItMatters".
    const allMatches: number[] = []
    let searchFrom = 0
    while (true) {
      const idx = source.indexOf("insightId === 'pilot-maturity-progression'", searchFrom)
      if (idx === -1) break
      allMatches.push(idx)
      searchFrom = idx + 1
    }
    expect(allMatches.length).toBeGreaterThanOrEqual(3)
    // The interpretation one contains "whyItMatters" within 300 chars
    let interpMatchIdx = -1
    for (const idx of allMatches) {
      const after = source.slice(idx, idx + 300)
      if (after.includes('whyItMatters')) {
        interpMatchIdx = idx
        break
      }
    }
    expect(interpMatchIdx).toBeGreaterThan(-1)
    // Use a narrow window — just the maturity interpretation branch
    const interpBlock = source.slice(interpMatchIdx, interpMatchIdx + 250)
    expect(interpBlock).toContain('whyItMatters')
    expect(interpBlock).not.toContain('Not yet attributable by IDE/tool')
  })
})
