/**
 * Surgical regression tests — Priority Dispatch customer-facing cleanup.
 *
 * Covers exactly two defects:
 * 1. Internal canonical repo prefixes ('azure:org/repo') must not leak into
 *    customer-facing text. Display labels strip the source prefix; canonical
 *    identity (joins/filters) is unchanged.
 * 2. monthly-workflow-share: the in-progress partial month must never be
 *    counted as a completed comparison period in titles/counts, while
 *    remaining visible and explicitly labeled in the period strip.
 */
import { describe, it, expect } from 'vitest'
import { normalizeRepoUrl, repoLabel, repoDisplayLabel, normalizeRepoList } from '../lib/repoNormalization'
import { generateMonthlyWorkflowShare } from '../lib/insights/final/generators/planCode'
import { adaptCanonicalToUI } from '../lib/insights/final/adapters/renderAdapter'
import { periodCountEvidenceCell, periodCountClaimPhrase } from '../lib/insights/final/helpers/periodStrip'

// ---------------------------------------------------------------------------
// Repo display boundary
// ---------------------------------------------------------------------------
describe('repoDisplayLabel: azure source prefix stripped at display only', () => {
  it('strips azure: prefix → org/repo', () => {
    expect(repoDisplayLabel('azure:prioritydispatchnet/arden-server')).toBe('prioritydispatchnet/arden-server')
    expect(repoDisplayLabel('azure:prioritydispatchnet/ai-skill-lab-apis')).toBe('prioritydispatchnet/ai-skill-lab-apis')
  })

  it('already-clean owner/repo passes through unchanged (no double-prefix, no mangle)', () => {
    expect(repoDisplayLabel('prioritydispatch/proqa-backend')).toBe('prioritydispatch/proqa-backend')
  })

  it('bare repo name passes through', () => {
    expect(repoDisplayLabel('arden-server')).toBe('arden-server')
  })

  it('unknown/unusual identities degrade safely (pass-through, no throw)', () => {
    expect(repoDisplayLabel('weird-identity')).toBe('weird-identity')
    expect(repoDisplayLabel('org/sub/repo')).toBe('org/sub/repo')
  })

  it('repoLabel delegates to the display formatter', () => {
    expect(repoLabel('azure:org/repo')).toBe('org/repo')
    expect(repoLabel('owner/repo')).toBe('owner/repo')
  })

  it('canonical identity is preserved: normalizeRepoUrl still returns azure: id', () => {
    // The display fix must not alter canonical join/filter identity.
    expect(normalizeRepoUrl('https://dev.azure.com/prioritydispatchnet/DevCore-Arden-Web/_git/arden-server'))
      .toBe('azure:prioritydispatchnet/arden-server')
    expect(normalizeRepoUrl('azure:prioritydispatchnet/arden-server'))
      .toBe('azure:prioritydispatchnet/arden-server')
  })

  it('normalizeRepoList: id stays canonical, label is display-safe, no collisions dropped', () => {
    const list = normalizeRepoList(['azure:prioritydispatchnet/arden-server', 'prioritydispatch/proqa-backend'])
    const azure = list.find(r => r.id === 'azure:prioritydispatchnet/arden-server')
    const gh = list.find(r => r.id === 'prioritydispatch/proqa-backend')
    expect(azure).toBeDefined()
    expect(azure!.label).toBe('prioritydispatchnet/arden-server')
    expect(gh).toBeDefined()
    expect(gh!.label).toBe('prioritydispatch/proqa-backend')
    expect(list.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Partial-period semantics — monthly-workflow-share
// ---------------------------------------------------------------------------
function monthKey(offsetBack: number): string {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() - offsetBack)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function mkSession(tool: string, month: string, i: number): any {
  return {
    session_id: `${tool}-${month}-${i}`,
    timestamp: `${month}-15T12:00:00Z`,
    tool,
    session_source: tool,
    session_duration_minutes: 30,
  }
}

/**
 * Build sessions over `completeCount` complete months (vscode/claude mix with
 * a ≥5pp share move so the retained-dominance card emits) plus an optional
 * partial current month.
 */
function buildRows(completeCount: number, partialCount: number): any[] {
  const rows: any[] = []
  for (let m = 0; m < completeCount; m++) {
    const mk = monthKey(completeCount - m) // oldest first; latest complete = offset 1
    // vscode share rises across months: 60%,70%,80%,... vs claude remainder
    const vscodeShare = 0.50 + m * 0.10
    const perMonth = 20
    const vsc = Math.round(perMonth * vscodeShare)
    for (let i = 0; i < perMonth; i++) rows.push(mkSession(i < vsc ? 'vscode' : 'claude_code', mk, i))
  }
  const cur = monthKey(0)
  for (let i = 0; i < partialCount; i++) rows.push(mkSession('vscode', cur, i))
  return rows
}

describe('monthly-workflow-share partial-period semantics', () => {
  it('3 complete months + partial current month → conclusion counts 3 complete periods', () => {
    const insight = generateMonthlyWorkflowShare({ sessionRows: buildRows(3, 10) } as any)
    expect(insight).not.toBeNull()
    const i: any = Array.isArray(insight) ? insight[0] : insight
    expect(i.title).toContain('3 complete periods')
    expect(i.title).not.toContain('4')
    expect(i.completePeriodCount).toBe(3)
    expect(i.hasPartialCurrentPeriod).toBe(true)
    // Endpoints must be complete months: latest label is last month, not current
    expect(i.currentLabel).toBe(monthKey(1))
    expect(i.baselineLabel).toBe(monthKey(3))
    // Partial month remains visible + labeled in the evidence strip
    const partialRow = i.evidence.find((e: any) => e.metric === monthKey(0))
    expect(partialRow).toBeDefined()
    expect(partialRow.label).toContain('partial month')
  })

  it('no current partial month → "observed periods" phrasing preserved', () => {
    const insight = generateMonthlyWorkflowShare({ sessionRows: buildRows(3, 0) } as any)
    expect(insight).not.toBeNull()
    const i: any = Array.isArray(insight) ? insight[0] : insight
    expect(i.title).toContain('3 observed periods')
    expect(i.hasPartialCurrentPeriod).toBe(false)
    expect(i.completePeriodCount).toBe(3)
  })

  it('2 complete periods + partial → counts 2 complete periods', () => {
    const insight = generateMonthlyWorkflowShare({ sessionRows: buildRows(2, 8) } as any)
    expect(insight).not.toBeNull()
    const i: any = Array.isArray(insight) ? insight[0] : insight
    expect(i.title).toContain('2 complete periods')
    expect(i.completePeriodCount).toBe(2)
    expect(i.hasPartialCurrentPeriod).toBe(true)
  })

  it('current month with tiny sample is still excluded from the count', () => {
    const insight = generateMonthlyWorkflowShare({ sessionRows: buildRows(3, 2) } as any)
    expect(insight).not.toBeNull()
    const i: any = Array.isArray(insight) ? insight[0] : insight
    expect(i.title).toContain('3 complete periods')
    expect(i.currentLabel).toBe(monthKey(1))
  })

  it('title/summary/count fields are internally consistent', () => {
    const i: any = generateMonthlyWorkflowShare({ sessionRows: buildRows(4, 15) } as any)
    expect(i.title).toContain('4 complete periods')
    expect(i.executiveSummary).toContain('4 complete periods')
    expect(i.cohort).toContain('4 complete periods')
    expect(i.confidenceReasoning).toContain('4 complete periods')
    expect(i.whatChanged).toContain('4 complete periods')
    expect(i.description).toContain('4 complete periods')
    expect(i.description).toContain('in-progress month shown for context')
  })
})

// ---------------------------------------------------------------------------
// Adapter boundary + rendered evidence-cell path
// The live defect: the cell fell back to evidence.length (=4) because the
// adapter whitelists fields and dropped completePeriodCount /
// hasPartialCurrentPeriod. These tests exercise the exact boundary and the
// exact renderer copy helpers used by PerformanceRecommendationsView.
// ---------------------------------------------------------------------------
describe('monthly-workflow-share: adapter → evidence-cell path', () => {
  it('adapter carries completePeriodCount / hasPartialCurrentPeriod to the view row', () => {
    const canonical: any = generateMonthlyWorkflowShare({ sessionRows: buildRows(3, 10) } as any)
    expect(canonical).not.toBeNull()
    expect(canonical.evidence.length).toBe(4) // 3 complete + 1 partial shown
    expect(canonical.completePeriodCount).toBe(3)
    expect(canonical.hasPartialCurrentPeriod).toBe(true)

    const adapted: any = adaptCanonicalToUI(canonical)
    expect(adapted.completePeriodCount).toBe(3)
    expect(adapted.hasPartialCurrentPeriod).toBe(true)
    expect(adapted.evidence.length).toBe(4)
  })

  it('evidence cell renders "3 complete + 1 partial", never "4"', () => {
    const canonical: any = generateMonthlyWorkflowShare({ sessionRows: buildRows(3, 10) } as any)
    const adapted: any = adaptCanonicalToUI(canonical)
    const cell = periodCountEvidenceCell(adapted)
    expect(cell.value).toBe('3 complete + 1 partial')
    expect(cell.value).not.toBe('4')
    expect(cell.sub.toLowerCase()).toContain('partial')
    expect(cell.sub.toLowerCase()).toContain('context')
  })

  it('claim phrase matches cell semantics', () => {
    const canonical: any = generateMonthlyWorkflowShare({ sessionRows: buildRows(3, 10) } as any)
    const adapted: any = adaptCanonicalToUI(canonical)
    expect(periodCountClaimPhrase(adapted)).toBe('3 complete periods (+1 partial)')
  })

  it('no partial month: cell counts all observed periods', () => {
    const canonical: any = generateMonthlyWorkflowShare({ sessionRows: buildRows(3, 0) } as any)
    const adapted: any = adaptCanonicalToUI(canonical)
    const cell = periodCountEvidenceCell(adapted)
    expect(cell.value).toBe('3')
    expect(cell.sub).toBe('Months with sufficient sample')
    expect(periodCountClaimPhrase(adapted)).toBe('3 observed periods')
  })

  it('legacy rows without the new fields degrade to evidence.length', () => {
    const cell = periodCountEvidenceCell({ evidence: [{}, {}, {}, {}] })
    expect(cell.value).toBe('4')
    expect(cell.sub).toBe('Months with sufficient sample')
  })
})
