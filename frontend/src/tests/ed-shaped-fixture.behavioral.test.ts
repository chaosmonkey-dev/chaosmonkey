import { describe, it, expect } from 'vitest'
import { getEdSessionRows, getEdCanonicalInput, getEdAggregatedRows, ED_TOOLS, ED_SESSION_COUNTS, ED_POPULATION } from './fixtures/ed-shaped-fixture'
import { buildMeasuredWorkflowIntelligence } from '../lib/aioi/buildMeasuredWorkflowIntelligence'
import { generateExecutiveAIYieldOptimization, generatePlanCodeInsights, generateWorkflowQualityCorrelation, generateSessionQualityMergeSuccess } from '../lib/insights/final/generators/planCode'
import { addDerivedSessionFields } from '../lib/insights/final/dataAccess'
import { generateFinalCanonicalInsights } from '../lib/insights/final/index'
import { normalizeToCanonicalToolId } from '../lib/workflowIdentity'

if (typeof globalThis.window === 'undefined') {
  ;(globalThis as any).window = { location: { search: '' } }
}

const rows = getEdSessionRows()
const input = getEdCanonicalInput() as any
const absentProviderNames = ['Cursor', 'Copilot', 'Windsurf', 'Devin', 'GitHub Copilot']

function outputText(value: unknown): string {
  return JSON.stringify(value)
}

function eligibleGithub(): any {
  return {
    github_connected: true,
    github_provenance: { source: 'github_api', historical_data_available: true, db_data_available: true, live_fetch_ok: true },
    pr_analytics: { total_prs: 60, merged_prs: 42, reopened_prs: 6 },
    pr_review_metrics: { total_prs: 60, reviewed_prs: 48, review_count: 48, unique_reviewer_count: 12, pr_reopened_count: 6 },
    deployment_metrics: { success_deployment_count: 60, failed_deployment_count: 6, total_deployment_count: 66 }
  }
}

describe('Ed-shaped CR1 behavioral acceptance', () => {
  it('contains exactly the supplied Ed workflow population after normalization', () => {
    expect(rows).toHaveLength(ED_POPULATION)
    expect(new Set(rows.map(row => normalizeToCanonicalToolId(row.tool)))).toEqual(new Set(ED_TOOLS))
    expect(ED_SESSION_COUNTS).toEqual({ claude_code: 126, vscode: 423 })
  })

  it('AIOI derives only VS Code and Claude Code and preserves Claude Code unsupported metrics as unavailable', () => {
    const result = buildMeasuredWorkflowIntelligence(getEdAggregatedRows() as any, {
      tools_in_population: ED_TOOLS,
      session_count_by_tool: ED_SESSION_COUNTS
    })
    expect(result.map(row => row.toolId).sort()).toEqual(['claude_code', 'vscode'])
    const claude = result.find(row => row.toolId === 'claude_code')!
    const vscode = result.find(row => row.toolId === 'vscode')!
    expect(claude.activeCodingMinutesPerSession).toBeNull()
    expect(claude.activeCodingRatio).toBeNull()
    expect(claude.focusRatio).toBeNull()
    expect(claude.idleRatio).toBeNull()
    // CR-X PI/PBT-TIME P0: ai_suggestions_accepted is observed for Claude Code
    // via the canonical aggregated endpoint. AIOI and PBT must show the same
    // metric under the same scope. Only genuinely unavailable terminal
    // metrics (active-coding/focus/idle) remain null.
    expect(claude.aiActivityPerSession).not.toBeNull()
    expect(vscode.activeCodingMinutesPerSession).toBeGreaterThan(0)
  })

  it('does not emit phantom providers, absent providers, or self-comparisons in Ed-shaped Plan & Code output', () => {
    const text = outputText(generatePlanCodeInsights(input))
    for (const name of absentProviderNames) expect(text).not.toContain(name)
    expect(text).not.toMatch(/VS Code[^\\n]{0,80}VS Code/)
    expect(text).not.toMatch(/Claude Code[^\\n]{0,80}Claude Code/)
  })

  // CR-X Pass 3: addDerivedSessionFields no longer coerces missing
  // ai_burst_count to false. Sessions with null/undefined
  // session_has_ai_activity AND missing ai_burst_count are excluded from
  // the AI/non-AI split, not classified as non-AI. Zero is measured data,
  // not missing — only undefined/null/NaN is missing.
  it('uses explicit AI and non-AI flags and excludes null or undefined status', () => {
    const cohortRows = [
      ...Array.from({ length: 6 }, (_, i) => ({ tool: 'vscode', session_id: `ai-${i}`, session_has_ai_activity: true, session_commits: 4, session_has_commit_outcome: true })),
      ...Array.from({ length: 6 }, (_, i) => ({ tool: 'vscode', session_id: `non-ai-${i}`, session_has_ai_activity: false, session_commits: 2, session_has_commit_outcome: true })),
      { tool: 'vscode', session_id: 'null-status', session_has_ai_activity: null, session_commits: 100, session_has_commit_outcome: true },
      { tool: 'vscode', session_id: 'undefined-status', session_commits: 100, session_has_commit_outcome: true }
    ]
    addDerivedSessionFields(cohortRows)
    const result = generateExecutiveAIYieldOptimization({ ...input, sessionRows: cohortRows } as any)
    expect(result).not.toBeNull()
    expect(result!.breakdownByTool?.ai?.count).toBe(6)
    // null/undefined status rows with missing ai_burst_count are excluded
    // from both AI and non-AI cohorts (not coerced to non-AI)
    expect(result!.breakdownByTool?.non_ai?.count).toBe(6)
  })

  it('excludes missing and non-finite commits while preserving measured zero', () => {
    const cohortRows = [
      ...Array.from({ length: 6 }, (_, i) => ({ tool: 'vscode', session_id: `ai-${i}`, session_has_ai_activity: true, session_commits: i === 0 ? 0 : 4, session_has_commit_outcome: true })),
      ...Array.from({ length: 6 }, (_, i) => ({ tool: 'claude_code', session_id: `non-ai-${i}`, session_has_ai_activity: false, session_commits: i === 0 ? null : 2, session_has_commit_outcome: true })),
      { tool: 'vscode', session_has_ai_activity: true, session_commits: Number.NaN, session_has_commit_outcome: true },
      { tool: 'vscode', session_has_ai_activity: false, session_has_commit_outcome: true }
    ]
    addDerivedSessionFields(cohortRows)
    const result = generateExecutiveAIYieldOptimization({ ...input, sessionRows: cohortRows } as any)
    expect(result).not.toBeNull()
    expect(result!.breakdownByTool?.ai?.count).toBe(6)
    expect(result!.breakdownByTool?.non_ai?.count).toBe(5)
    expect(result!.breakdownByTool?.ai?.value).toBeCloseTo(20 / 6)
    expect(result!.breakdownByTool?.non_ai?.value).toBe(2)
  })

  it('fails closed when either AI/non-AI cohort lacks sufficient measured commits', () => {
    const result = generateExecutiveAIYieldOptimization({ ...input, sessionRows: [
      ...Array.from({ length: 5 }, (_, i) => ({ tool: 'vscode', session_id: `ai-${i}`, session_has_ai_activity: true, session_commits: 3 })),
      ...Array.from({ length: 4 }, (_, i) => ({ tool: 'vscode', session_id: `non-ai-${i}`, session_has_ai_activity: false, session_commits: 2 }))
    ] } as any)
    expect(result).toBeNull()
  })

  it('does not render or rank missing session quality as zero', () => {
    // CR5 WS2 #14 P0-4c: generateWorkflowQualityCorrelation is now suppressed
    // (consolidated into session-quality-merge-success). Use that generator instead.
    const result = generateSessionQualityMergeSuccess({ ...input, sessionRows: rows.map(row => ({ ...row, session_quality_score: null })) } as any)
    expect(result).not.toBeNull()
    expect(result!.hasData).toBe(false)
    expect(outputText(result)).not.toContain('0/100')
    expect(result!.rightMetric).toBe('—')
  })

  it('preserves a legitimate measured zero for an instrumented metric', () => {
    const zeroRows = rows.map(row => ({ ...row, session_active_coding_duration_minutes: row.tool === 'vscode' ? 0 : null }))
    const measured = buildMeasuredWorkflowIntelligence([
      { tool: 'vscode', session_count: 10, active_coding_time_minutes: 0, focus_ratio: 0, total_session_minutes: 100 },
      { tool: 'claude_code', session_count: 10, active_coding_time_minutes: 0, focus_ratio: 0, total_session_minutes: 100 }
    ] as any, { tools_in_population: ED_TOOLS, session_count_by_tool: { vscode: 10, claude_code: 10 } })
    expect(measured.find(workflow => workflow.toolId === 'vscode')!.activeCodingMinutesPerSession).toBe(0)
    expect(measured.find(workflow => workflow.toolId === 'vscode')!.focusRatio).toBe(0)
    expect(measured.find(workflow => workflow.toolId === 'claude_code')!.activeCodingMinutesPerSession).toBeNull()
    expect(zeroRows.find(row => row.tool === 'vscode')!.session_active_coding_duration_minutes).toBe(0)
  })

  it('eligible cohort evidence produces a complete actionable yield PI', () => {
    const eligibleRows = [
      ...Array.from({ length: 6 }, (_, i) => ({ tool: 'vscode', session_has_ai_activity: true, session_commits: 4, session_id: `a-${i}`, session_has_commit_outcome: true })),
      ...Array.from({ length: 6 }, (_, i) => ({ tool: 'vscode', session_has_ai_activity: false, session_commits: 2, session_id: `n-${i}`, session_has_commit_outcome: true }))
    ]
    addDerivedSessionFields(eligibleRows)
    const result = generateExecutiveAIYieldOptimization({ ...input, sessionRows: eligibleRows } as any)
    expect(result?.hasData).toBe(true)
    expect(result?.isDiagnostic).not.toBe(true)
    expect(result?.current).toBe(100)
    expect(result?.evidenceAndContext).toContain('Observed AI signals: 6 sessions')
    expect(result?.evidenceAndContext).toContain('Zero observed AI signals: 6 sessions')
  })

  it('transitions from diagnostic to actionable when GitHub evidence is added', async () => {
    const without = await generateFinalCanonicalInsights({ ...input, sessionRows: rows, githubSnapshot: undefined } as any)
    const withEvidence = await generateFinalCanonicalInsights({ ...input, sessionRows: rows, githubSnapshot: eligibleGithub() } as any)
    expect(without.some(insight => insight.cicdStage === 'review-merge' && !insight.isDiagnostic)).toBe(false)
    expect(withEvidence.some(insight => insight.cicdStage === 'review-merge' && !insight.isDiagnostic)).toBe(true)
  })

  it('transitions from actionable to diagnostic when required GitHub evidence is removed', async () => {
    const withEvidence = await generateFinalCanonicalInsights({ ...input, sessionRows: rows, githubSnapshot: eligibleGithub() } as any)
    const without = await generateFinalCanonicalInsights({ ...input, sessionRows: rows, githubSnapshot: undefined } as any)
    expect(withEvidence.some(insight => insight.cicdStage === 'deploy-operate' && !insight.isDiagnostic)).toBe(true)
    expect(without.some(insight => insight.cicdStage === 'deploy-operate' && !insight.isDiagnostic)).toBe(false)
  })
})
