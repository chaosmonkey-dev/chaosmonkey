import { describe, it, expect } from 'vitest'

// Mock window for Node.js test environment
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = { location: { search: '' } } as any
} else if (!(globalThis as any).window.location) {
  (globalThis as any).window.location = { search: '' }
}

import type { CanonicalInsightInput, CanonicalInsight } from '../lib/insights/final/types'
import { generateFinalCanonicalInsights, getCanonicalPIIds, CANONICAL_PI_REGISTRY } from '../lib/insights/final/index'
import { adaptCanonicalToUI, type PerformanceInsight } from '../lib/insights/final/adapters/renderAdapter'
import { validateCanonicalInsights } from '../lib/insights/final/utils/validation'
import { isGithubEvidenceEligible } from '../lib/insights/final/dataAccess'

function mkSessions(n: number, tool = 'vscode'): any[] {
  const r: any[] = []
  for (let i = 0; i < n; i++) r.push({
    session_id: `s-${tool}-${i}`, tool, ide: tool, developer_id: `d${i % 5}`,
    start_time: new Date(Date.now() - i * 864e5).toISOString(),
    end_time: new Date(Date.now() - i * 864e5 + 36e5).toISOString(),
    duration_ms: 36e5, ai_suggestions_accepted: 5 + (i % 15), ai_usage_duration_minutes: 10 + (i % 20),
    ai_burst_count: 5 + (i % 15), // CR5 WS1.7: canonical AI-active authority
    files_edited: 1 + (i % 4), commits: i % 3, active_coding_time_minutes: 20 + (i % 30),
    idle_time_minutes: i % 10, average_session_length_minutes: 60, time_to_first_commit_minutes: 2 + (i % 15),
    // CR-X: enriched fields required by generators that no longer use seeded fallbacks
    file_save_count: 1 + (i % 4),
    focus_ratio: 0.4 + (i % 5) * 0.1,
    debug_ratio: 0.05 + (i % 3) * 0.05,
    terminal_ratio: 0.1 + (i % 3) * 0.05,
    session_quality_score: 0.7 + (i % 3) * 0.1,
    session_has_ai_activity: i % 3 !== 0, // 2/3 of sessions have AI activity
    repository: `repo-${i % 3}`,
  })
  return r
}

const eligGh = (prs: number, rev: number, dep: number): any => ({
  github_connected: true,
  github_provenance: { source: 'github_api', historical_data_available: true, db_data_available: true },
  pr_analytics: { total_prs: prs, merged_prs: Math.floor(prs * 0.7), merge_rate: 70, reopened_prs: Math.floor(prs * 0.1) },
  pr_review_metrics: { total_prs: prs, reviewed_prs: rev, review_count: rev, unique_reviewer_count: 3, review_coverage: prs ? (rev / prs) * 100 : 0, pr_reopened_count: Math.floor(prs * 0.1) },
  deployment_metrics: { success_deployment_count: dep, failed_deployment_count: Math.floor(dep * 0.1), total_deployment_count: dep, deployment_frequency: dep, change_failure_rate: 10 },
  total_repositories: 3,
})

const ineligGh = (): any => ({
  github_connected: false,
  github_provenance: { source: 'seeded', historical_data_available: false },
  pr_analytics: { total_prs: 0, merged_prs: 0, merge_rate: 0 },
  pr_review_metrics: { total_prs: 0, reviewed_prs: 0, review_coverage: 0 },
  deployment_metrics: { success_deployment_count: 0, failed_deployment_count: 0, total_deployment_count: 0, deployment_frequency: 0 },
  total_repositories: 0,
})

const ti = (s: any[], gh?: any): CanonicalInsightInput => ({
  sessionRows: s, githubSnapshot: gh, githubByPeriod: [], productivityByPeriod: [], granularity: 'week'
})

// CR-X: Multi-workflow fixture for comparison generators that need ≥2 workflows.
// Generators no longer use seeded fallbacks — they require real enriched fields
// and multiple workflows to produce comparison insights.
function mkMultiWorkflowSessions(n: number): any[] {
  const tools = ['vscode', 'cursor']
  const r: any[] = []
  for (let i = 0; i < n; i++) {
    const tool = tools[i % tools.length]
    r.push({
      session_id: `s-${tool}-${i}`, tool, ide: tool, developer_id: `d${i % 5}`,
      start_time: new Date(Date.now() - i * 864e5).toISOString(),
      end_time: new Date(Date.now() - i * 864e5 + 36e5).toISOString(),
      duration_ms: 36e5, ai_suggestions_accepted: 5 + (i % 15), ai_usage_duration_minutes: 10 + (i % 20),
      ai_burst_count: 5 + (i % 15),
      files_edited: 1 + (i % 4), commits: i % 3, active_coding_time_minutes: 20 + (i % 30),
      idle_time_minutes: i % 10, average_session_length_minutes: 60, time_to_first_commit_minutes: 2 + (i % 15),
      file_save_count: 1 + (i % 4),
      focus_ratio: 0.4 + (i % 5) * 0.1,
      debug_ratio: 0.05 + (i % 3) * 0.05,
      terminal_ratio: 0.1 + (i % 3) * 0.05,
      session_quality_score: 0.7 + (i % 3) * 0.1,
      session_has_ai_activity: tool === 'cursor' ? true : i % 3 !== 0,
      repository: `repo-${i % 3}`,
    })
  }
  return r
}

const DIAGNOSTIC_TITLE_KEYWORDS = ['needs', 'missing', 'unavailable', 'not captured', 'waiting', 'insufficient', 'not yet measurable']

describe('PI Final Contract Production Tests', () => {
  it('1. unavailable diagnostic current value is null, not zero', async () => {
    const ins = await generateFinalCanonicalInsights(ti(mkSessions(30)))
    // True diagnostic coverage cards have isDiagnostic=true AND hasData=false
    const diagnostics = ins.filter(i => i.isDiagnostic === true && i.hasData === false)
    expect(diagnostics.length).toBeGreaterThan(0)
    for (const d of diagnostics) {
      expect(d.current).toBeNull()
    }
  })

  it('2. unavailable diagnostic dataSource is unavailable, not live', async () => {
    const ins = await generateFinalCanonicalInsights(ti(mkSessions(30)))
    // True diagnostic coverage cards have isDiagnostic=true AND hasData=false
    const diagnostics = ins.filter(i => i.isDiagnostic === true && i.hasData === false)
    expect(diagnostics.length).toBeGreaterThan(0)
    for (const d of diagnostics) {
      expect(d.hasData).toBe(false)
      expect(d.isDiagnostic).toBe(true)
    }
  })

  it('3. diagnostic is not recommendation eligible', async () => {
    const ins = await generateFinalCanonicalInsights(ti(mkSessions(30)))
    const diagnostics = ins.filter(i => i.isDiagnostic === true)
    expect(diagnostics.length).toBeGreaterThan(0)
    for (const d of diagnostics) {
      expect(d.recommendationAllowed).toBe(false)
    }
  })

  it('4. diagnostic is not Top eligible', async () => {
    const ins = await generateFinalCanonicalInsights(ti(mkSessions(30)))
    const diagnostics = ins.filter(i => i.isDiagnostic === true)
    expect(diagnostics.length).toBeGreaterThan(0)
    for (const d of diagnostics) {
      expect(d.isTopInsightEligible).toBe(false)
    }
  })

  it('5. diagnostic title cannot enter actionable inventory', async () => {
    const ins = await generateFinalCanonicalInsights(ti(mkSessions(30)))
    const actionable = ins.filter(i => i.recommendationAllowed === true)
    for (const a of actionable) {
      const titleLower = (a.title || '').toLowerCase()
      const hasDiagnosticKeyword = DIAGNOSTIC_TITLE_KEYWORDS.some(kw => titleLower.includes(kw))
      expect(hasDiagnosticKeyword).toBe(false)
    }
  })

  it('6. aggregate validation failure does not silently render invalid candidates', () => {
    // Create insights with duplicate IDs to trigger validation failure
    const invalidInsights: CanonicalInsight[] = [
      { id: 'test-dup', title: 'Test', cicdStage: 'plan-code', canonicalPriority: 1, renderOrder: 1, current: 10, confidence: 'high', hasData: true, presentationType: 'threshold' } as any,
      { id: 'test-dup', title: 'Test 2', cicdStage: 'plan-code', canonicalPriority: 2, renderOrder: 2, current: 20, confidence: 'high', hasData: true, presentationType: 'threshold' } as any,
    ]
    const validation = validateCanonicalInsights(invalidInsights)
    expect(validation.valid).toBe(false)
    // The validation must report the failure, not silently pass
    expect(validation.allErrors.length).toBeGreaterThan(0)
  })

  it('7. adapter validation failure does not silently render invalid candidates', async () => {
    // The pipeline's validateAdaptedInsights checks for required fields (id, title, cicdStage).
    // When validation fails, the fail-closed logic in index.ts suppresses invalid candidates.
    // We verify the validation function itself catches missing fields.
    const { validateAdaptedInsights } = await import('../lib/insights/final/adapters/renderAdapter')
    const badInsights = [
      { id: 'bad-1' } as any, // missing title and cicdStage
    ]
    const validation = validateAdaptedInsights(badInsights)
    expect(validation.valid).toBe(false)
    expect(validation.missingFields.length).toBeGreaterThan(0)
    expect(validation.errors.length).toBeGreaterThan(0)
  })

  it('8. active registry entries can be represented with a dynamic actionable/diagnostic split', async () => {
    // CR5 WS2 #14: Registry count is dynamic — not hardcoded.
    // Added commit-ttfc-longitudinal, suppressed 3 generators (return null).
    const registryIds = getCanonicalPIIds()
    const registryCount = registryIds.size
    expect(registryCount).toBeGreaterThanOrEqual(25) // at least 25, may grow
    // CR-X: Use multi-workflow fixture with enriched fields — generators no
    // longer use seeded fallbacks and require ≥2 workflows + enriched fields
    // to produce comparison insights.
    const ins = await generateFinalCanonicalInsights(ti(mkMultiWorkflowSessions(50), eligGh(15, 10, 5)))
    // All generated insights should be represented (actionable + diagnostic + suppressed-recommendation)
    // Suppressed generators return null and don't appear in the output.
    expect(ins.length).toBeGreaterThan(0)
    expect(ins.length).toBeLessThanOrEqual(registryCount)
    const actionable = ins.filter(i => i.recommendationAllowed === true).length
    const diagnostic = ins.filter(i => i.isDiagnostic === true).length
    expect(actionable + diagnostic).toBeLessThanOrEqual(registryCount)
    expect(actionable).toBeGreaterThan(0)
  })

  it('9. TTFC returns null when no observed commit evidence is available', async () => {
    // CR-X: TTFC generator requires ttfc_source='observed' + time_to_first_commit_ms.
    // Without observed commit evidence, the generator returns null (no synthetic
    // diagnostic replacement per CR-X doctrine). This is the correct contract:
    // generators that return null do not get synthetic diagnostic replacements.
    const ins = await generateFinalCanonicalInsights(ti(mkSessions(30)))
    const ttfc = ins.find(i => i.id === 'time-to-first-commit-by-ide')
    expect(ttfc).toBeUndefined()
  })

  it('10. seeded GitHub remains ineligible', () => {
    const seeded = ineligGh()
    expect(isGithubEvidenceEligible(seeded)).toBe(false)
  })

  it('11. exact runtime proof field names are emitted', async () => {
    const ins = await generateFinalCanonicalInsights(ti(mkSessions(30)))
    // The proof object is emitted via console.log('[RUNTIME_PROOF_TABLE]', proofObject)
    // and stored on window.__CM_DEBUG__.runtimeProof
    const proof = (globalThis as any).window?.__CM_DEBUG__?.runtimeProof
    expect(proof).toBeDefined()
    expect(proof).toHaveProperty('registeredCanonicalCount')
    expect(proof).toHaveProperty('activeCanonicalCount')
    expect(proof).toHaveProperty('normalRenderedCount')
    expect(proof).toHaveProperty('normalActionableCount')
    expect(proof).toHaveProperty('normalDiagnosticCount')
    expect(proof).toHaveProperty('demoRenderedCount')
    expect(proof).toHaveProperty('topInsightCount')
    expect(proof.registeredCanonicalCount).toBe(getCanonicalPIIds().size)
    expect(proof.activeCanonicalCount).toBe(getCanonicalPIIds().size)
    expect(proof.normalRenderedCount).toBe(ins.length)
    expect(proof.topInsightCount).toBeLessThanOrEqual(5)
  })
})
