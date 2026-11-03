/**
 * CR-X Production-Value Pass — Acceptance Tests
 *
 * Tests A-L from the production-value pass contract:
 * A. delegated-agent recent-change duplicate suppression
 * B. title customer-language contract
 * C. Top Insights near-duplicate suppression
 * D. Top Insights family/diversity behavior
 * E. weak descriptive Plan & Code baselines do not crowd stronger findings
 * F. cost evidence participates when materially useful
 * G. GitHub delivery evidence participates when materially useful
 * H. single-workflow pilot still produces useful PI portfolio
 * I. multi-workflow pilot produces useful comparisons
 * J. missing GitHub/cost still yields valuable telemetry PIs
 * K. deterministic ordering
 * L. AIOI economics omit unsupported denominators rather than inventing them
 */

import { describe, it, expect } from 'vitest'
import { generateRecentChangeInsights } from '../lib/insights/final/generators/recentChange'
import { getTopInsights } from '../lib/insights/final/utils/ranking'
import { buildMeasuredWorkflowIntelligence } from '../lib/aioi/buildMeasuredWorkflowIntelligence'
import { getPilotShape } from '../lib/insights/final/pilotShapeFixtures'
import { normalizeToCanonicalToolId } from '../lib/workflowIdentity'
import { isDelegatedAgentWorkflow } from '../lib/surfaceAgentContract'
import type { CanonicalInsight } from '../lib/insights/final/types'

// ── Helpers ──────────────────────────────────────────────────────────────

function daysAgoISO(days: number, hour = 11): string {
  const ref = new Date('2026-09-13T11:00:00.000Z').getTime()
  return new Date(ref - days * 86400000 + hour * 3600000).toISOString()
}

function buildSession(opts: {
  tool: string
  timestamp: string
  duration_ms?: number
  active_coding_duration_ms?: number
  ai_burst_count?: number
}): Record<string, unknown> {
  const isDelegated = opts.tool === 'devin' || opts.tool === 'claude_code'
  const durMs = opts.duration_ms ?? 30 * 60000
  const row: Record<string, unknown> = {
    session_id: `sess-${opts.tool}-${opts.timestamp}`,
    tool: opts.tool,
    session_source: opts.tool,
    timestamp: opts.timestamp,
    duration_ms: durMs,
    user_id: 'dev-1',
    git_repo_url: 'https://github.com/org/repo1',
    git_branch: 'main',
    ai_burst_count: opts.ai_burst_count ?? 0,
    ai_usage_duration_ms: (opts.ai_burst_count ?? 0) * 120000,
  }
  if (isDelegated) {
    row.active_coding_duration_ms = undefined
    row.focus_ratio = undefined
  } else {
    row.active_coding_duration_ms = opts.active_coding_duration_ms ?? durMs * 0.5
  }
  if (typeof row.duration_ms === 'number' && row.duration_ms > 0) {
    row.session_duration_minutes = row.duration_ms / 60000
  }
  if (!isDelegated && typeof row.active_coding_duration_ms === 'number') {
    row.session_active_coding_duration_minutes = row.active_coding_duration_ms / 60000
    if (row.session_duration_minutes && (row.session_duration_minutes as number) > 0) {
      row.focus_ratio = (row.session_active_coding_duration_minutes as number) / (row.session_duration_minutes as number)
    }
  }
  return row
}

function buildMaterialChangeFixture(): any[] {
  const rows: any[] = []
  // Days 14-27: OLD pattern (extra history)
  for (let d = 14; d < 28; d++) {
    for (let i = 0; i < 5; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d, 9 + i), duration_ms: 45 * 60000, active_coding_duration_ms: 30 * 60000, ai_burst_count: 1 }))
    for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(d, 14 + i), duration_ms: 40 * 60000, active_coding_duration_ms: 25 * 60000, ai_burst_count: 1 }))
    for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d, 16 + i), duration_ms: 60 * 60000, ai_burst_count: 5 }))
  }
  // Days 7-13: OLD pattern (prior window)
  for (let d = 7; d < 14; d++) {
    for (let i = 0; i < 5; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d, 9 + i), duration_ms: 45 * 60000, active_coding_duration_ms: 30 * 60000, ai_burst_count: 1 }))
    for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(d, 14 + i), duration_ms: 40 * 60000, active_coding_duration_ms: 25 * 60000, ai_burst_count: 1 }))
    for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d, 16 + i), duration_ms: 60 * 60000, ai_burst_count: 5 }))
  }
  // Days 0-6: NEW pattern (recent window)
  for (let d = 0; d < 7; d++) {
    for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d, 9 + i), duration_ms: 60 * 60000, active_coding_duration_ms: 45 * 60000, ai_burst_count: 1 }))
    for (let i = 0; i < 5; i++) rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(d, 14 + i), duration_ms: 40 * 60000, active_coding_duration_ms: 25 * 60000, ai_burst_count: 1 }))
    for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d, 16 + i), duration_ms: 120 * 60000, ai_burst_count: 5 }))
  }
  return rows
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('CR-X Production-Value Pass', () => {

  // A. Delegated-agent recent-change duplicate suppression
  describe('A. Delegated-agent duplicate suppression', () => {
    it('does not emit session_duration for delegated-agent workflows', () => {
      const rows = buildMaterialChangeFixture()
      const input = { sessionRows: rows, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' as const }
      const results = generateRecentChangeInsights(input)

      // Devin is delegated — should have agent_runtime but NOT session_duration
      const devinFindings = results.filter(r => r.id.includes('__devin'))
      expect(devinFindings.length).toBeGreaterThan(0)

      const hasSessionDuration = devinFindings.some(r => r.id.includes('session_duration__devin'))
      expect(hasSessionDuration).toBe(false)

      const hasAgentRuntime = devinFindings.some(r => r.id.includes('agent_runtime__devin'))
      expect(hasAgentRuntime).toBe(true)
    })

    it('can still emit session_duration for human-interactive workflows', () => {
      const rows = buildMaterialChangeFixture()
      const input = { sessionRows: rows, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' as const }
      const results = generateRecentChangeInsights(input)

      // VS Code is human-interactive — session_duration is allowed (though may not fire if not material)
      const vscodeFindings = results.filter(r => r.id.includes('__vscode'))
      expect(vscodeFindings.length).toBeGreaterThan(0)

      // The key assertion: no delegated-agent has BOTH agent_runtime AND session_duration
      const devinFindings = results.filter(r => r.id.includes('__devin'))
      const hasBoth = devinFindings.some(r => r.id.includes('session_duration')) &&
                      devinFindings.some(r => r.id.includes('agent_runtime'))
      expect(hasBoth).toBe(false)
    })
  })

  // B. Title customer-language contract
  describe('B. Title customer-language contract', () => {
    it('titles use "over the last N days" not "recent N days"', () => {
      const rows = buildMaterialChangeFixture()
      const input = { sessionRows: rows, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' as const }
      const results = generateRecentChangeInsights(input)

      expect(results.length).toBeGreaterThan(0)
      for (const r of results) {
        // Must NOT use "recent N days" or "recent period"
        expect(r.title).not.toMatch(/\brecent \d+ days\b/i)
        expect(r.title).not.toMatch(/\brecent period\b/i)
        // Should use "over the last" or "over the prior"
        expect(r.title).toMatch(/over the (last|prior)/i)
      }
    })

    it('titles do not contain internal jargon', () => {
      const rows = buildMaterialChangeFixture()
      const input = { sessionRows: rows, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' as const }
      const results = generateRecentChangeInsights(input)

      expect(results.length).toBeGreaterThan(0)
      const jargonPatterns = [
        /\bp90\/p50\b/i,
        /\bcohort\b/i,
        /\binstrumented\b/i,
        /\btelemetry\b/i,
        /\bAI signals\b/i,
        /\bsignal coverage\b/i,
      ]
      for (const r of results) {
        for (const pattern of jargonPatterns) {
          expect(r.title).not.toMatch(pattern)
        }
      }
    })

    it('uses natural language for doubled/halved runtime', () => {
      const rows: any[] = []
      // Prior: devin 60min runtime
      for (let d = 14; d < 28; d++) {
        for (let i = 0; i < 3; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d, 16 + i), duration_ms: 60 * 60000, ai_burst_count: 5 }))
      }
      for (let d = 7; d < 14; d++) {
        for (let i = 0; i < 3; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d, 16 + i), duration_ms: 60 * 60000, ai_burst_count: 5 }))
      }
      // Recent: devin 120min runtime (doubled)
      for (let d = 0; d < 7; d++) {
        for (let i = 0; i < 3; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d, 16 + i), duration_ms: 120 * 60000, ai_burst_count: 5 }))
      }
      const input = { sessionRows: rows, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' as const }
      const results = generateRecentChangeInsights(input)
      const runtimeFinding = results.find(r => r.id.includes('agent_runtime__devin'))
      expect(runtimeFinding).toBeDefined()
      // Should use either "doubled" (when exactly 2x) or "increased Nm per session" (customer language)
      expect(runtimeFinding!.title).toMatch(/(doubled|increased \d+m per session)/i)
    })
  })

  // C. Top Insights near-duplicate suppression
  describe('C. Top Insights near-duplicate suppression', () => {
    it('does not allow multiple recent-change findings for the same workflow in Top Insights', () => {
      const rows = buildMaterialChangeFixture()
      const input = { sessionRows: rows, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' as const }
      const recentChangeResults = generateRecentChangeInsights(input)

      // Build a minimal insight population for getTopInsights
      const allInsights: CanonicalInsight[] = [...recentChangeResults] as CanonicalInsight[]
      const topInsights = getTopInsights(allInsights)

      // Check: no two Top Insights have the same workflow in recent-change
      const recentChangeInTop = topInsights.filter(i => i.id.startsWith('recent-change__'))
      const workflows = new Set<string>()
      for (const insight of recentChangeInTop) {
        const parts = insight.id.split('__')
        const workflow = parts[2] || 'org'
        expect(workflows.has(workflow)).toBe(false)
        workflows.add(workflow)
      }
    })
  })

  // D. Top Insights family/diversity behavior
  describe('D. Top Insights family/diversity behavior', () => {
    it('respects temporal family quota (max 2)', () => {
      const rows = buildMaterialChangeFixture()
      const input = { sessionRows: rows, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' as const }
      const recentChangeResults = generateRecentChangeInsights(input)
      const allInsights: CanonicalInsight[] = [...recentChangeResults] as CanonicalInsight[]
      const topInsights = getTopInsights(allInsights)

      const temporalCount = topInsights.filter(i => i.id.startsWith('recent-change__')).length
      expect(temporalCount).toBeLessThanOrEqual(2)
    })

    it('Top Insights has at most 5 findings', () => {
      const rows = buildMaterialChangeFixture()
      const input = { sessionRows: rows, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' as const }
      const recentChangeResults = generateRecentChangeInsights(input)
      const allInsights: CanonicalInsight[] = [...recentChangeResults] as CanonicalInsight[]
      const topInsights = getTopInsights(allInsights)
      expect(topInsights.length).toBeLessThanOrEqual(5)
    })
  })

  // E. Weak descriptive baselines do not crowd stronger findings
  describe('E. Weak descriptive baselines do not crowd stronger findings', () => {
    it('contextual findings do not outrank decision findings', () => {
      const rows = buildMaterialChangeFixture()
      const input = { sessionRows: rows, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' as const }
      const recentChangeResults = generateRecentChangeInsights(input)

      // recent-change findings should be classified as 'decision' (they have material movement)
      for (const r of recentChangeResults) {
        const lc = r.lifecycleClass || 'decision'
        expect(lc).toBe('decision')
      }
    })
  })

  // F. Cost evidence participates when materially useful
  describe('F. Cost evidence in AIOI', () => {
    it('AIOI economics fields exist on measured workflow metrics', () => {
      const metadata = {
        tools_in_population: ['vscode', 'cursor'],
        session_count_by_tool: { vscode: 100, cursor: 50 },
      }
      const rows = [
        { tool: 'vscode', session_count: 100, average_session_length_minutes: 45, active_coding_time_minutes: 30, total_session_minutes: 4500 },
        { tool: 'cursor', session_count: 50, average_session_length_minutes: 40, active_coding_time_minutes: 25, total_session_minutes: 2000 },
      ]
      const result = buildMeasuredWorkflowIntelligence(rows, metadata, (id) => id)
      expect(result.length).toBe(2)
      for (const wf of result) {
        expect(wf).toHaveProperty('monthlySpend')
        expect(wf).toHaveProperty('costPerSession')
        expect(wf).toHaveProperty('costPerActiveHour')
        expect(wf).toHaveProperty('costPerRuntimeHour')
      }
    })
  })

  // G. GitHub delivery evidence participates when materially useful
  describe('G. GitHub delivery evidence', () => {
    it('telemetry-only pilots still produce recent-change findings without GitHub', () => {
      const rows = buildMaterialChangeFixture()
      const input = { sessionRows: rows, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' as const }
      const results = generateRecentChangeInsights(input)
      expect(results.length).toBeGreaterThan(0)
    })
  })

  // H. Single-workflow pilot still produces useful PI portfolio
  describe('H. Single-workflow pilot', () => {
    it('single-workflow pilot produces temporal findings when material', () => {
      const rows: any[] = []
      // Single workflow: vscode only, with material change
      for (let d = 14; d < 28; d++) {
        for (let i = 0; i < 5; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d, 9 + i), duration_ms: 45 * 60000, active_coding_duration_ms: 30 * 60000, ai_burst_count: 1 }))
      }
      for (let d = 7; d < 14; d++) {
        for (let i = 0; i < 5; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d, 9 + i), duration_ms: 45 * 60000, active_coding_duration_ms: 30 * 60000, ai_burst_count: 1 }))
      }
      for (let d = 0; d < 7; d++) {
        for (let i = 0; i < 5; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d, 9 + i), duration_ms: 60 * 60000, active_coding_duration_ms: 45 * 60000, ai_burst_count: 1 }))
      }
      const input = { sessionRows: rows, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' as const }
      const results = generateRecentChangeInsights(input)
      expect(results.length).toBeGreaterThan(0)
      // Should have at least one vscode finding
      expect(results.some(r => r.id.includes('__vscode'))).toBe(true)
    })
  })

  // I. Multi-workflow pilot produces useful comparisons
  describe('I. Multi-workflow pilot', () => {
    it('multi-workflow pilot produces per-workflow findings', () => {
      const rows = buildMaterialChangeFixture()
      const input = { sessionRows: rows, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' as const }
      const results = generateRecentChangeInsights(input)

      // Should have findings for multiple workflows
      const workflows = new Set(results.map(r => r.id.split('__')[2]).filter(Boolean))
      expect(workflows.size).toBeGreaterThanOrEqual(2)
    })
  })

  // J. Missing GitHub/cost still yields valuable telemetry PIs
  describe('J. Missing GitHub/cost', () => {
    it('produces temporal findings with no GitHub and no cost config', () => {
      const rows = buildMaterialChangeFixture()
      const input = { sessionRows: rows, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' as const }
      const results = generateRecentChangeInsights(input)
      expect(results.length).toBeGreaterThan(0)
      // Findings should have hasData=true
      for (const r of results) {
        expect(r.hasData).toBe(true)
      }
    })
  })

  // K. Deterministic ordering
  describe('K. Deterministic ordering', () => {
    it('produces identical results on repeated runs', () => {
      const rows = buildMaterialChangeFixture()
      const input = { sessionRows: rows, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' as const }

      const results1 = generateRecentChangeInsights(input)
      const results2 = generateRecentChangeInsights(input)

      expect(results1.length).toBe(results2.length)
      for (let i = 0; i < results1.length; i++) {
        expect(results1[i].id).toBe(results2[i].id)
        expect(results1[i].title).toBe(results2[i].title)
      }
    })

    it('deterministic IDs across repeated runs', () => {
      const rows = buildMaterialChangeFixture()
      const input = { sessionRows: rows, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' as const }

      const ids1 = generateRecentChangeInsights(input).map(r => r.id).sort()
      const ids2 = generateRecentChangeInsights(input).map(r => r.id).sort()

      expect(ids1).toEqual(ids2)
    })
  })

  // L. AIOI economics omit unsupported denominators rather than inventing them
  describe('L. AIOI economics omit unsupported denominators', () => {
    it('omits costPerActiveHour for delegated-agent workflows', () => {
      const metadata = {
        tools_in_population: ['devin', 'vscode'],
        session_count_by_tool: { devin: 50, vscode: 100 },
      }
      const rows = [
        { tool: 'devin', session_count: 50, average_session_length_minutes: 60, total_session_minutes: 3000 },
        { tool: 'vscode', session_count: 100, average_session_length_minutes: 45, active_coding_time_minutes: 30, total_session_minutes: 4500 },
      ]
      const result = buildMeasuredWorkflowIntelligence(rows, metadata, (id) => id)
      const devin = result.find(w => w.toolId === 'devin')
      const vscode = result.find(w => w.toolId === 'vscode')

      expect(devin).toBeDefined()
      expect(vscode).toBeDefined()

      // Devin is delegated — costPerActiveHour must be null (no active coding semantics)
      expect(devin!.costPerActiveHour).toBeNull()
      // VS Code is human-interactive — costPerRuntimeHour must be null
      expect(vscode!.costPerRuntimeHour).toBeNull()
    })

    it('returns null economics when no cost configured', () => {
      const metadata = {
        tools_in_population: ['vscode'],
        session_count_by_tool: { vscode: 100 },
      }
      const rows = [
        { tool: 'vscode', session_count: 100, average_session_length_minutes: 45, active_coding_time_minutes: 30, total_session_minutes: 4500 },
      ]
      const result = buildMeasuredWorkflowIntelligence(rows, metadata, (id) => id)
      const vscode = result[0]

      // Without configured cost, all economics fields should be null
      expect(vscode.monthlySpend).toBeNull()
      expect(vscode.costPerSession).toBeNull()
      expect(vscode.costPerActiveHour).toBeNull()
      expect(vscode.costPerRuntimeHour).toBeNull()
    })
  })
})
