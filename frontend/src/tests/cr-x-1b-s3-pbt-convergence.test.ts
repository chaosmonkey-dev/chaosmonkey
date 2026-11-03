/**
 * CR-X Day 1B S3: PBT scope authority + surface/assistant observability gating
 *
 * Tests:
 * 1. PBT productivityQuery reads from shared analysisContext (not filterStore)
 * 2. Filter chips stay synchronized (developer/repo changes update analysisContext)
 * 3. PBT developer/repo filters apply to the PBT evidence view only
 * 4. Claude Code cannot acquire an editor-only ai_suggestions_accepted comparison value
 * 5. Valid Claude Code metrics continue to work
 * 6. Invalid cross-surface PI comparisons fail closed without deleting legitimate PIs
 *
 * CONTRACT CORRECTION: PI does NOT inherit PBT filters.
 * Performance Insights describe the organization-wide canonical population.
 * Developer and repository filters apply to the PBT evidence view below.
 * PI remains organization-wide canonical intelligence.
 * PBT developer/repo filters remain evidence-view filters.
 * Do not introduce shared cross-tab filtering.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  isMetricInstrumentedForWorkflow,
  isWorkflowMetricComparable,
  getWorkflowComparabilityLevel,
  getMeasurementSemantic,
  resolveSurface,
  getMetricObservability,
} from '../lib/surfaceAgentContract'

const pbtPath = resolve(__dirname, '../components/ProductivityByToolV3.vue')
const pbtSource = readFileSync(pbtPath, 'utf-8')

const cardsPath = resolve(__dirname, '../lib/productivityCards.ts')
const cardsSource = readFileSync(cardsPath, 'utf-8')

const contractPath = resolve(__dirname, '../lib/surfaceAgentContract.ts')
const contractSource = readFileSync(contractPath, 'utf-8')

const analysisContextPath = resolve(__dirname, '../stores/analysisContext.ts')
const analysisContextSource = readFileSync(analysisContextPath, 'utf-8')

describe('CR-X Day 1B S3: PI ↔ PBT scope convergence', () => {
  it('ProductivityByToolV3 imports and uses analysisContext store', () => {
    expect(pbtSource).toContain('useAnalysisContextStore')
    expect(pbtSource).toContain('analysisContext')
  })

  it('productivityQuery dateRange comes from analysisContext.dateRange (PI/PBT-TIME)', () => {
    // CR-X PI/PBT-TIME: Time bounds come from shared analysisContext (same authority as PI).
    // filterStore remains the UI/filter writer for scope (org/team/dev), but
    // analysisContext is the single time authority for both PI and PBT.
    expect(pbtSource).toMatch(/analysisContext\.dateRange/)
    expect(pbtSource).toMatch(/from:\s*ctxRange\.from/)
    expect(pbtSource).toMatch(/to:\s*ctxRange\.to/)
  })

  it('productivityQuery reads developerIds from analysisContext', () => {
    expect(pbtSource).toMatch(/analysisContext\.developerIds/)
  })

  it('productivityQuery reads repoIds from analysisContext', () => {
    expect(pbtSource).toMatch(/analysisContext\.repoIds/)
  })

  it('developer filter watch syncs to analysisContext', () => {
    // The watch on selectedDeveloper should call analysisContext.setDeveloperIds
    expect(pbtSource).toMatch(/watch\(selectedDeveloper[\s\S]*?analysisContext\.setDeveloperIds/s)
  })

  it('repo filter watch syncs to analysisContext', () => {
    expect(pbtSource).toMatch(/watch\(selectedRepo[\s\S]*?analysisContext\.setRepoIds/s)
  })

  it('resetFilters resets analysisContext', () => {
    expect(pbtSource).toMatch(/resetFilters[\s\S]*?analysisContext\.reset/s)
  })

  it('analysisContext store exposes developerIds, repoIds, dateRange, workflowIds', () => {
    expect(analysisContextSource).toContain('developerIds')
    expect(analysisContextSource).toContain('repoIds')
    expect(analysisContextSource).toContain('dateRange')
    expect(analysisContextSource).toContain('workflowIds')
  })
})

// ── CONTRACT: PI does NOT inherit PBT developer/repo filters ──────────────────
// PI remains organization-wide canonical intelligence.
// PBT developer/repo filters remain evidence-view filters.
// Do not introduce shared cross-tab filtering.
// This assertion prevents future "convergence" work from collapsing the
// distinction between PI (org-wide) and PBT (evidence-view scoped).

describe('CR-X Day 1B S3 CONTRACT: PI does NOT inherit PBT developer/repo filters', () => {
  const dashboardsPath = resolve(__dirname, '../pages/Dashboards.vue')
  const dashboardsSource = readFileSync(dashboardsPath, 'utf-8')

  it('fetchSharedEnrichedCanonical receives only a time range, NOT developer/repo filters', () => {
    // The PI session fetch must NOT pass developerIds/repoIds to the enriched
    // canonical fetch. PI remains org-wide.
    const fetchCall = dashboardsSource.match(/fetchSharedEnrichedCanonical\([^)]*\)/g)
    expect(fetchCall).not.toBeNull()
    expect(fetchCall!.length).toBeGreaterThan(0)
    for (const call of fetchCall!) {
      expect(call).not.toContain('developerIds')
      expect(call).not.toContain('repoIds')
      expect(call).not.toContain('developer_ids')
      expect(call).not.toContain('repo_ids')
    }
  })

  it('PI session rows are fetched with time range only (org-wide canonical population)', () => {
    // The enriched canonical fetch takes a time range derived from analysisContext
    // date range, but NOT developer/repo filters.
    expect(dashboardsSource).toMatch(/fetchSharedEnrichedCanonical\(_ctxTimeRange\)/)
  })

  it('PBT uses analysisContext developerIds for its own evidence-view scope', () => {
    // PBT is the only consumer that uses developerIds/repoIds for filtering.
    // PI does not use them for session row fetching.
    expect(pbtSource).toMatch(/analysisContext\.developerIds/)
    expect(pbtSource).toMatch(/analysisContext\.repoIds/)
  })

  it('analysisContext store does NOT export a shared developerFilter applied to PI', () => {
    // The store may hold developerIds/repoIds, but they must not be consumed
    // by the PI fetch path. They are PBT evidence-view filters only.
    expect(analysisContextSource).toContain('developerIds')
    expect(analysisContextSource).toContain('repoIds')
    // The store should not have a method like "applyToPI" or "piDeveloperFilter"
    expect(analysisContextSource).not.toContain('applyToPI')
    expect(analysisContextSource).not.toContain('piDeveloperFilter')
    expect(analysisContextSource).not.toContain('piRepoFilter')
  })
})

describe('CR-X Day 1B S3: Surface/assistant observability gating', () => {
  it('surfaceAgentContract defines ai_suggestions_accepted in SurfaceCapability', () => {
    expect(contractSource).toContain('ai_suggestions_accepted:')
  })

  it('ai_suggestions_accepted is directly_observed on terminal surface (Claude Code) (PI/PBT-TIME P0)', () => {
    // CR-X PI/PBT-TIME P0: The canonical aggregated endpoint returns finite
    // observed ai_suggestions_accepted values for Claude Code sessions.
    // Extract the terminal block from SURFACE_CAPABILITY
    const terminalMatch = contractSource.match(/terminal:\s*\{[\s\S]*?\}/)
    expect(terminalMatch).toBeTruthy()
    expect(terminalMatch![0]).toMatch(/ai_suggestions_accepted:\s*'directly_observed'/)
  })

  it('ai_suggestions_accepted is directly_observed on vscode surface', () => {
    const vscodeMatch = contractSource.match(/vscode:\s*\{[\s\S]*?\}/)
    expect(vscodeMatch).toBeTruthy()
    expect(vscodeMatch![0]).toMatch(/ai_suggestions_accepted:\s*'directly_observed'/)
  })

  it('ai_suggestions_accepted is directly_observed on cursor surface', () => {
    const cursorMatch = contractSource.match(/cursor:\s*\{[\s\S]*?\}/)
    expect(cursorMatch).toBeTruthy()
    expect(cursorMatch![0]).toMatch(/ai_suggestions_accepted:\s*'directly_observed'/)
  })

  it('METRIC_NAME_MAP maps ai_suggestions_accepted', () => {
    expect(contractSource).toMatch(/'ai_suggestions_accepted':\s*'ai_suggestions_accepted'/)
  })

  it('Claude Code is NOT listed as uninstrumented for ai_suggestions_accepted in productivityCards', () => {
    // CR-X PI/PBT-TIME P0: ai_suggestions_accepted is observed for Claude Code
    // via the canonical aggregated endpoint. It must NOT be in the uninstrumented list.
    const claudeBlock = cardsSource.match(/claude_code:\s*\[([\s\S]*?)\]/)
    expect(claudeBlock).toBeTruthy()
    expect(claudeBlock![1]).not.toContain("'ai_suggestions_accepted'")
  })

  it('productivityCards uses isMetricInstrumentedForWorkflow from contract', () => {
    expect(cardsSource).toContain('isMetricInstrumentedForWorkflow')
    // The card generation should use the contract as primary authority
    expect(cardsSource).toMatch(/isMetricInstrumentedForWorkflow\(series\.label/)
  })

  it('Claude Code valid metrics (ai_burst_count, session_commits, time_to_first_commit) remain available', () => {
    // ai_burst_count is directly_observed on terminal — must NOT be in uninstrumented list
    const claudeBlock = cardsSource.match(/claude_code:\s*\[([\s\S]*?)\]/)
    expect(claudeBlock).toBeTruthy()
    expect(claudeBlock![1]).not.toContain("'ai_burst_count'")
    expect(claudeBlock![1]).not.toContain("'commits_per_session'")
    expect(claudeBlock![1]).not.toContain("'time_to_first_commit_minutes'")
  })
})

describe('CR-X Day 1B S3: Contract-level ai_suggestions_accepted gating', () => {
  it('Claude Code (terminal) IS instrumented for ai_suggestions_accepted (CR-X PI/PBT-TIME P0 correction)', () => {
    // CR-X PI/PBT-TIME P0: The canonical aggregated endpoint returns finite
    // observed ai_suggestions_accepted values for Claude Code sessions.
    // AIOI and PBT must show the same metric under the same scope.
    expect(isMetricInstrumentedForWorkflow('claude_code', 'ai_suggestions_accepted')).toBe(true)
  })

  it('VS Code is instrumented for ai_suggestions_accepted', () => {
    expect(isMetricInstrumentedForWorkflow('vscode', 'ai_suggestions_accepted')).toBe(true)
  })

  it('Cursor is instrumented for ai_suggestions_accepted', () => {
    expect(isMetricInstrumentedForWorkflow('cursor', 'ai_suggestions_accepted')).toBe(true)
  })

  it('Claude Code IS instrumented for ai_burst_count (valid metric)', () => {
    expect(isMetricInstrumentedForWorkflow('claude_code', 'ai_burst_count')).toBe(true)
  })

  it('Claude Code IS instrumented for commits_per_session', () => {
    expect(isMetricInstrumentedForWorkflow('claude_code', 'commits_per_session')).toBe(true)
  })

  it('Claude Code IS instrumented for time_to_first_commit_minutes', () => {
    expect(isMetricInstrumentedForWorkflow('claude_code', 'time_to_first_commit_minutes')).toBe(true)
  })

  it('Claude Code is NOT instrumented for active_coding_time_minutes', () => {
    expect(isMetricInstrumentedForWorkflow('claude_code', 'active_coding_time_minutes')).toBe(false)
  })

  it('resolveSurface maps claude_code to terminal', () => {
    expect(resolveSurface('claude_code')).toBe('terminal')
  })

  it('getMetricObservability returns directly_observed for terminal/ai_suggestions_accepted (PI/PBT-TIME P0)', () => {
    expect(getMetricObservability('terminal', 'ai_suggestions_accepted')).toBe('directly_observed')
  })

  it('getMetricObservability returns directly_observed for vscode/ai_suggestions_accepted', () => {
    expect(getMetricObservability('vscode', 'ai_suggestions_accepted')).toBe('directly_observed')
  })
})

describe('CR-X Day 1B S3 P0: Unknown-metric fail-closed contract', () => {
  it('arbitrary unknown metric fails closed (not instrumented) for any tool', () => {
    expect(isMetricInstrumentedForWorkflow('vscode', 'totally_fake_metric_xyz')).toBe(false)
    expect(isMetricInstrumentedForWorkflow('claude_code', 'totally_fake_metric_xyz')).toBe(false)
    expect(isMetricInstrumentedForWorkflow('cursor', 'totally_fake_metric_xyz')).toBe(false)
  })

  it('unknown metric is not comparable across any pair of workflows', () => {
    expect(isWorkflowMetricComparable('vscode', 'cursor', 'totally_fake_metric_xyz')).toBe(false)
    expect(isWorkflowMetricComparable('vscode', 'claude_code', 'totally_fake_metric_xyz')).toBe(false)
  })

  it('unknown metric gets comparability level C (not A)', () => {
    expect(getWorkflowComparabilityLevel('vscode', 'cursor', 'totally_fake_metric_xyz')).toBe('C')
    expect(getWorkflowComparabilityLevel('vscode', 'claude_code', 'totally_fake_metric_xyz')).toBe('C')
  })

  it('empty/null metric name fails closed', () => {
    expect(isMetricInstrumentedForWorkflow('vscode', '')).toBe(false)
    expect(isMetricInstrumentedForWorkflow(null, 'ai_burst_count')).toBe(false)
  })
})

describe('CR-X Day 1B S3 P0: Surface-independent metrics remain Level A', () => {
  it('duration_ms is instrumented on every surface', () => {
    expect(isMetricInstrumentedForWorkflow('vscode', 'duration_ms')).toBe(true)
    expect(isMetricInstrumentedForWorkflow('cursor', 'duration_ms')).toBe(true)
    expect(isMetricInstrumentedForWorkflow('claude_code', 'duration_ms')).toBe(true)
    expect(isMetricInstrumentedForWorkflow('jetbrains', 'duration_ms')).toBe(true)
  })

  it('average_session_length_minutes maps to duration_ms and is instrumented on every surface', () => {
    expect(isMetricInstrumentedForWorkflow('vscode', 'average_session_length_minutes')).toBe(true)
    expect(isMetricInstrumentedForWorkflow('claude_code', 'average_session_length_minutes')).toBe(true)
    expect(isMetricInstrumentedForWorkflow('cursor', 'average_session_length_minutes')).toBe(true)
  })

  it('duration_ms is Level A comparable across vscode and terminal (same session_elapsed semantic)', () => {
    expect(getWorkflowComparabilityLevel('vscode', 'claude_code', 'duration_ms')).toBe('A')
    expect(isWorkflowMetricComparable('vscode', 'claude_code', 'duration_ms')).toBe(true)
  })

  it('average_session_length_minutes is Level A comparable across vscode and terminal', () => {
    expect(getWorkflowComparabilityLevel('vscode', 'claude_code', 'average_session_length_minutes')).toBe('A')
    expect(isWorkflowMetricComparable('vscode', 'claude_code', 'average_session_length_minutes')).toBe(true)
  })

  it('duration_ms uses session_elapsed measurement semantic on all surfaces', () => {
    expect(getMeasurementSemantic('vscode', 'duration_ms')).toBe('session_elapsed')
    expect(getMeasurementSemantic('terminal', 'duration_ms')).toBe('session_elapsed')
  })
})

describe('CR-X Day 1B S3 P0: AIOI obeys Claude observability contract', () => {
  const aioiPath = resolve(__dirname, '../lib/aioi/buildMeasuredWorkflowIntelligence.ts')
  const aioiSource = readFileSync(aioiPath, 'utf-8')
  const rendererPath = resolve(__dirname, '../components/performance/AIUsageSignalsPanel.vue')
  const rendererSource = readFileSync(rendererPath, 'utf-8')

  it('AIOI builder imports isMetricInstrumentedForWorkflow from contract', () => {
    expect(aioiSource).toContain('isMetricInstrumentedForWorkflow')
    expect(aioiSource).toContain("from '../surfaceAgentContract'")
  })

  it('AIOI builder gates aiActivityPerSession with contract', () => {
    expect(aioiSource).toContain("isMetricInstrumentedForWorkflow(toolId, 'ai_suggestions_accepted')")
  })

  it('AIOI renderer does NOT include aiActivityPerSession in human-interactive-only metric set (CR-X PI/PBT-TIME P0)', () => {
    // CR-X PI/PBT-TIME P0: ai_suggestions_accepted is observed for Claude Code.
    // CR-X P1B.2 Wave 0: replaced hardcoded claude_code set with mode-aware gating.
    // It must NOT be in the HUMAN_INTERACTIVE_ONLY_METRICS set.
    const metricsBlock = rendererSource.match(/HUMAN_INTERACTIVE_ONLY_METRICS\s*=\s*new Set\(\[[\s\S]*?\]\)/)
    expect(metricsBlock).not.toBeNull()
    expect(metricsBlock![0]).not.toContain('aiActivityPerSession')
  })

  it('AIOI builder does not hardcode Claude Code bypass for ai_suggestions_accepted', () => {
    // The contract must be the authority, not a hardcoded toolId check
    const hardcodedBypass = aioiSource.match(/toolId\s*===?\s*['"]claude_code['"][\s\S]*?ai_suggestions_accepted/)
    expect(hardcodedBypass).toBeNull()
  })
})

// ── P0-B: AIOI Claude valid-metric regression audit ─────────────────────────
// Audit whether Claude commits/session showing '—' was collateral from
// unknown-metric fail-closed behavior. Conclusion: it was NOT.
// The contract correctly marks session_commits and time_to_first_commit_ms
// as directly_observed for terminal. The AIOI builder sources commits/TTFC
// from observedAuthority, not the contract. The '—' is because the observed
// authority lacks Claude Code commit evidence in current Local data.

describe('CR-X Day 1B P0-B: Claude commits/session and TTFC are authoritative observed metrics', () => {
  it('session_commits is directly_observed for terminal (Claude Code)', () => {
    expect(getMetricObservability('terminal', 'session_commits')).toBe('directly_observed')
  })

  it('time_to_first_commit_ms is directly_observed for terminal (Claude Code)', () => {
    expect(getMetricObservability('terminal', 'time_to_first_commit_ms')).toBe('directly_observed')
  })

  it('isMetricInstrumentedForWorkflow returns true for claude_code session_commits', () => {
    expect(isMetricInstrumentedForWorkflow('claude_code', 'session_commits')).toBe(true)
    expect(isMetricInstrumentedForWorkflow('claude_code', 'commits_per_session')).toBe(true)
  })

  it('isMetricInstrumentedForWorkflow returns true for claude_code time_to_first_commit', () => {
    expect(isMetricInstrumentedForWorkflow('claude_code', 'time_to_first_commit_ms')).toBe(true)
    expect(isMetricInstrumentedForWorkflow('claude_code', 'time_to_first_commit_minutes')).toBe(true)
  })

  it('session_commits uses commit_observed semantic for terminal', () => {
    expect(getMeasurementSemantic('terminal', 'session_commits')).toBe('commit_observed')
  })

  it('time_to_first_commit_ms uses commit_observed semantic for terminal', () => {
    expect(getMeasurementSemantic('terminal', 'time_to_first_commit_ms')).toBe('commit_observed')
  })

  it('session_commits IS workflow-comparable between vscode and claude_code (17G.2 git authority)', () => {
    // The vscode surface still does not observe session_commits (unavailable
    // in the capability matrix), but 17G.2 workflow-level comparability uses
    // Git authority: both workflows share commit_observed semantic → level A.
    expect(getMetricObservability('vscode', 'session_commits')).toBe('unavailable')
    expect(getWorkflowComparabilityLevel('vscode', 'claude_code', 'session_commits')).toBe('A')
  })

  it('time_to_first_commit_ms IS comparable between vscode and terminal (both commit_observed)', () => {
    // Both surfaces observe TTFC via git operations — semantically equivalent
    expect(getMetricObservability('vscode', 'time_to_first_commit_ms')).toBe('directly_observed')
    expect(getWorkflowComparabilityLevel('vscode', 'claude_code', 'time_to_first_commit_ms')).toBe('A')
  })
})

describe('CR-X Day 1B P0-B: AIOI builder uses observedAuthority for commits/TTFC (not contract gating)', () => {
  const aioiPath = resolve(__dirname, '../lib/aioi/buildMeasuredWorkflowIntelligence.ts')
  const aioiSrc = readFileSync(aioiPath, 'utf-8')
  const rendererPath = resolve(__dirname, '../components/performance/AIUsageSignalsPanel.vue')
  const rendererSrc = readFileSync(rendererPath, 'utf-8')

  it('AIOI builder does NOT gate commitsPerSession with isMetricInstrumentedForWorkflow', () => {
    // commitsPerSession comes from observedAuthority, not the contract
    // The contract is NOT the gating mechanism for commits — observed evidence is
    const commitsSection = aioiSrc.match(/commitsPerSession[\s\S]*?(?:\n\s*\n|\n\s*const)/)
    expect(commitsSection).toBeTruthy()
    expect(commitsSection![0]).not.toContain('isMetricInstrumentedForWorkflow')
  })

  it('AIOI builder does NOT gate timeToFirstCommitMinutes with isMetricInstrumentedForWorkflow', () => {
    const ttfcSection = aioiSrc.match(/timeToFirstCommitMinutes[\s\S]*?(?:\n\s*\n|\n\s*const)/)
    expect(ttfcSection).toBeTruthy()
    expect(ttfcSection![0]).not.toContain('isMetricInstrumentedForWorkflow')
  })

  it('AIOI renderer does NOT include commitsPerSession in human-interactive-only metric set', () => {
    // CR-X P1B.2 Wave 0: replaced hardcoded claude_code set with mode-aware gating.
    // Verify commitsPerSession is NOT in the HUMAN_INTERACTIVE_ONLY_METRICS set.
    expect(rendererSrc).toContain('HUMAN_INTERACTIVE_ONLY_METRICS')
    const metricsBlock = rendererSrc.match(/HUMAN_INTERACTIVE_ONLY_METRICS\s*=\s*new Set\(\[[\s\S]*?\]\)/)
    expect(metricsBlock).not.toBeNull()
    expect(metricsBlock![0]).not.toContain('commitsPerSession')
  })

  it('AIOI renderer does NOT include timeToFirstCommitMinutes in human-interactive-only metric set', () => {
    const metricsBlock = rendererSrc.match(/HUMAN_INTERACTIVE_ONLY_METRICS\s*=\s*new Set\(\[[\s\S]*?\]\)/)
    expect(metricsBlock).not.toBeNull()
    expect(metricsBlock![0]).not.toContain('timeToFirstCommitMinutes')
  })
})

describe('CR-X Day 1B P0-B: Unknown fake metrics still fail closed', () => {
  it('fake metric is not instrumented for any workflow', () => {
    expect(isMetricInstrumentedForWorkflow('claude_code', 'totally_fake_metric_xyz')).toBe(false)
    expect(isMetricInstrumentedForWorkflow('vscode', 'totally_fake_metric_xyz')).toBe(false)
    expect(isMetricInstrumentedForWorkflow('cursor', 'totally_fake_metric_xyz')).toBe(false)
  })

  it('fake metric has comparability level C', () => {
    expect(getWorkflowComparabilityLevel('vscode', 'claude_code', 'totally_fake_metric_xyz')).toBe('C')
  })

  it('empty string metric fails closed', () => {
    expect(isMetricInstrumentedForWorkflow('claude_code', '')).toBe(false)
  })

  it('null toolId fails closed', () => {
    expect(isMetricInstrumentedForWorkflow(null, 'session_commits')).toBe(false)
  })
})

describe('CR-X PI/PBT-TIME P0: Claude AI Activity / Session is observed (parity correction)', () => {
  const aioiPath = resolve(__dirname, '../lib/aioi/buildMeasuredWorkflowIntelligence.ts')
  const aioiSrc = readFileSync(aioiPath, 'utf-8')
  const rendererPath = resolve(__dirname, '../components/performance/AIUsageSignalsPanel.vue')
  const rendererSrc = readFileSync(rendererPath, 'utf-8')

  it('ai_suggestions_accepted is directly_observed for terminal (CR-X PI/PBT-TIME P0)', () => {
    expect(getMetricObservability('terminal', 'ai_suggestions_accepted')).toBe('directly_observed')
  })

  it('isMetricInstrumentedForWorkflow returns true for claude_code ai_suggestions_accepted', () => {
    expect(isMetricInstrumentedForWorkflow('claude_code', 'ai_suggestions_accepted')).toBe(true)
  })

  it('AIOI builder gates aiActivityPerSession with contract (now returns observed value for Claude)', () => {
    expect(aioiSrc).toContain("isMetricInstrumentedForWorkflow(toolId, 'ai_suggestions_accepted')")
  })

  it('AIOI renderer does NOT include aiActivityPerSession in human-interactive-only metric set', () => {
    // CR-X P1B.2 Wave 0: replaced hardcoded claude_code set with mode-aware gating.
    const metricsBlock = rendererSrc.match(/HUMAN_INTERACTIVE_ONLY_METRICS\s*=\s*new Set\(\[[\s\S]*?\]\)/)
    expect(metricsBlock).not.toBeNull()
    expect(metricsBlock![0]).not.toContain('aiActivityPerSession')
  })
})
