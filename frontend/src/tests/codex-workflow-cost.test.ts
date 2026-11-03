/**
 * ============================================================================
 * Codex Product Completeness — Canonical Workflow + Cost Contract Tests
 * ============================================================================
 *
 * Proves:
 * 1. source='codex' resolves to the canonical Codex workflow end-to-end.
 * 2. Codex is a registered delegated_agent on the terminal surface.
 * 3. Codex appears in supported cost configuration with the stable tool_id
 *    'codex' (same tool_cost_configs semantics as other tools).
 * 4. Unconfigured Codex cost is unavailable (null / '—'), never fabricated $0.
 * 5. Codex lifecycle bridge metrics stay unavailable — no token usage, no
 *    AI bursts, no commits, no human-attention metrics are manufactured.
 * 6. Existing workflow mappings (Claude Code, Cursor, VS Code, Devin/Windsurf,
 *    GitHub Copilot) are unchanged.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest'
import {
  resolveOperationalMode,
  resolveSurface,
  resolveAssistant,
  isDelegatedAgentWorkflow,
  isMetricInstrumentedForWorkflow,
  getWorkflowMeasurementSemantic,
  WORKFLOW_CAPABILITY_REGISTRY,
} from '../lib/surfaceAgentContract'
import {
  normalizeToCanonicalToolId,
  expandCanonicalToolIds,
  getWorkflowDisplayName,
  isCanonicalRealWorkflow,
  deriveWorkflowCounts,
  CANONICAL_REAL_WORKFLOWS,
} from '../lib/workflowIdentity'
import { normalizeToolId } from '../lib/insights/toolId'
import {
  COST_SUPPORTED_TOOLS,
  normalizeCostToolId,
  costToolIdToCanonicalWorkflowId,
  normalizeCostConfigInput,
  getToolMonthlySpend,
  costMonthlySpendDisplay,
} from '../lib/toolCost'

describe('Codex — canonical workflow contract', () => {
  it('has a registered workflow capability entry', () => {
    const entry = WORKFLOW_CAPABILITY_REGISTRY.find(c => c.canonicalId === 'codex')
    expect(entry).toBeDefined()
    expect(entry!.displayName).toBe('Codex')
    expect(entry!.operationalMode).toBe('delegated_agent')
    expect(entry!.supportedSurfaces).toEqual(['terminal'])
  })

  it("source='codex' resolves to canonical codex workflow through every normalizer", () => {
    expect(normalizeToolId('codex')).toBe('codex')
    expect(normalizeToCanonicalToolId('codex')).toBe('codex')
    expect(normalizeToCanonicalToolId('codex-cli')).toBe('codex')
    expect(normalizeToCanonicalToolId('openai-codex')).toBe('codex')
  })

  it('is a delegated_agent on the terminal surface', () => {
    expect(resolveOperationalMode('codex')).toBe('delegated_agent')
    expect(resolveOperationalMode('codex-cli')).toBe('delegated_agent')
    expect(isDelegatedAgentWorkflow('codex')).toBe(true)
    expect(resolveSurface('codex')).toBe('terminal')
    expect(resolveAssistant('codex')).toBe('codex')
  })

  it('is in the canonical real workflow universe and renders a display name', () => {
    expect(isCanonicalRealWorkflow('codex')).toBe(true)
    expect(CANONICAL_REAL_WORKFLOWS).toContain('codex')
    expect(getWorkflowDisplayName('codex')).toBe('Codex')
  })

  it('deriveWorkflowCounts includes codex sessions as a tracked workflow', () => {
    const result = deriveWorkflowCounts({
      tools_in_population: ['vscode', 'codex'],
      session_count_by_tool: { vscode: 100, codex: 3 },
    })
    expect(result.universe).toContain('codex')
    expect(result.sessionCountByCanonical['codex']).toBe(3)
    expect(result.trackedCount).toBe(2)
  })
})

describe('Codex — truthful instrumentation boundary', () => {
  it('session runtime is instrumented (duration_ms is observed)', () => {
    expect(isMetricInstrumentedForWorkflow('codex', 'duration_ms')).toBe(true)
    expect(isMetricInstrumentedForWorkflow('codex', 'average_session_length_minutes')).toBe(true)
    expect(isMetricInstrumentedForWorkflow('codex', 'total_session_minutes')).toBe(true)
  })

  it('lifecycle-only metrics are unavailable — no fabricated zeros', () => {
    // The Codex bridge does not observe AI bursts, file saves, git commits,
    // TTFC, or token usage (token_usage_status: 'unavailable_lifecycle_hooks').
    const unavailable = [
      'ai_burst_count',
      'ai_suggestions_accepted',
      'ai_usage_duration_ms',
      'ai_usage_duration_minutes',
      'files_edited_per_session',
      'session_commits',
      'commits_per_session',
      'time_to_first_commit_minutes',
      'active_coding_time_minutes',
      'idle_time_minutes',
      'focus_ratio',
    ]
    for (const m of unavailable) {
      expect(isMetricInstrumentedForWorkflow('codex', m)).toBe(false)
      expect(getWorkflowMeasurementSemantic('codex', m)).toBe('not_measured')
    }
  })

  it('Claude Code retains its own instrumentation contract unchanged', () => {
    // Claude bridge observes ai_suggestions_accepted + commits; codex does not.
    expect(isMetricInstrumentedForWorkflow('claude_code', 'ai_suggestions_accepted')).toBe(true)
    expect(isMetricInstrumentedForWorkflow('claude_code', 'commits_per_session')).toBe(true)
    expect(resolveSurface('claude_code')).toBe('terminal')
  })
})

describe('Codex — cost configuration contract', () => {
  it("codex is in COST_SUPPORTED_TOOLS with stable tool_id 'codex'", () => {
    expect(COST_SUPPORTED_TOOLS).toContain('codex')
  })

  it('cost tool ID normalization maps codex variants to codex', () => {
    expect(normalizeCostToolId('codex')).toBe('codex')
    expect(normalizeCostToolId('Codex')).toBe('codex')
    expect(normalizeCostToolId('codex-cli')).toBe('codex')
    expect(normalizeCostToolId('codex_cli')).toBe('codex')
    expect(normalizeCostToolId('openai-codex')).toBe('codex')
    expect(normalizeCostToolId('codex-workflow')).toBe('codex')
  })

  it('cost tool_id maps to canonical workflow id', () => {
    expect(costToolIdToCanonicalWorkflowId('codex')).toBe('codex')
  })

  it('configured Codex cost normalizes through the same DTO path', () => {
    const normalized = normalizeCostConfigInput({
      tool_id: 'codex',
      tool_name: 'Codex',
      seat_count: 4,
      cost_per_seat_monthly: '20.00',
      monthly_spend: '80.00',
      configured_at: '2026-09-28T00:00:00.000000Z',
    })
    expect(normalized).not.toBeNull()
    expect(normalized!.toolId).toBe('codex')
    expect(normalized!.seatCount).toBe(4)
    expect(normalized!.costPerSeatMonthly).toBe(20)
    expect(normalized!.monthlySpend).toBe(80)
  })

  it('unconfigured Codex cost is null, never fabricated as $0', () => {
    // No persisted config → getToolMonthlySpend returns null (rendered as '—'),
    // never 0 and never another tool's spend.
    expect(getToolMonthlySpend('codex')).toBeNull()
    expect(normalizeCostConfigInput({ tool_id: 'codex' })).toBeNull()
  })

  it('existing cost tool IDs are unchanged', () => {
    expect(costToolIdToCanonicalWorkflowId('claude-code')).toBe('claude_code')
    expect(costToolIdToCanonicalWorkflowId('github-copilot')).toBe('github_copilot')
    expect(costToolIdToCanonicalWorkflowId('vscode')).toBe('vscode')
    expect(costToolIdToCanonicalWorkflowId('cursor')).toBe('cursor')
    expect(costToolIdToCanonicalWorkflowId('devin')).toBe('devin')
    expect(normalizeCostToolId('windsurf')).toBe('devin')
  })
})

describe('Cost editor — shared unconfigured truth rule', () => {
  it('absent Codex config + untouched 0/0 draft renders "Not configured", never "$0.00"', () => {
    const out = costMonthlySpendDisplay({ persisted: false, seatCount: 0, costPerSeatMonthly: 0 })
    expect(out).toBe('Not configured')
    expect(out).not.toBe('$0.00')
  })

  it('absent config for every other tool + untouched 0/0 also renders "Not configured"', () => {
    for (const toolId of COST_SUPPORTED_TOOLS) {
      expect(costMonthlySpendDisplay({ persisted: false, seatCount: 0, costPerSeatMonthly: 0 }))
        .toBe('Not configured')
      void toolId // rule is uniform — not Codex-specific
    }
  })

  it('absent config + entered draft values renders computed preview', () => {
    expect(costMonthlySpendDisplay({ persisted: false, seatCount: 4, costPerSeatMonthly: 20 }))
      .toBe('$80.00')
    expect(costMonthlySpendDisplay({ persisted: false, seatCount: 0, costPerSeatMonthly: 20 }))
      .toBe('$0.00')
  })

  it('persisted nonzero config renders computed spend', () => {
    expect(costMonthlySpendDisplay({ persisted: true, seatCount: 3, costPerSeatMonthly: 250 }))
      .toBe('$750.00')
  })

  it('persisted explicit-zero config renders "$0.00", not "Not configured"', () => {
    expect(costMonthlySpendDisplay({ persisted: true, seatCount: 5, costPerSeatMonthly: 0 }))
      .toBe('$0.00')
    expect(costMonthlySpendDisplay({ persisted: true, seatCount: 0, costPerSeatMonthly: 0 }))
      .toBe('$0.00')
  })

  it('both cost-editor surfaces use the same shared helper', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const pbt = readFileSync(join(__dirname, '..', 'components', 'ProductivityByToolV3.vue'), 'utf8')
    const connect = readFileSync(join(__dirname, '..', 'pages', 'ConnectIDEs.vue'), 'utf8')
    // Shared helper imported by both surfaces
    expect(pbt).toContain('costMonthlySpendDisplay')
    expect(connect).toContain('costMonthlySpendDisplay')
    // Raw "$X.XX configured-zero" preview removed from all six rows in both editors
    expect(pbt).not.toMatch(/\$\{\{ \(costEditorState\.[a-z'\-\[\]"]+\.seatCount/)
    expect(connect).not.toMatch(/\$\{\{ computedMonthlySpend/)
  })
})

describe('Codex — existing workflow mappings preserved', () => {
  it('all pre-existing canonical workflows unchanged', () => {
    expect(resolveOperationalMode('vscode')).toBe('human_interactive')
    expect(resolveOperationalMode('cursor')).toBe('human_interactive')
    expect(resolveOperationalMode('github_copilot')).toBe('human_interactive')
    expect(resolveOperationalMode('devin')).toBe('delegated_agent')
    expect(resolveOperationalMode('windsurf')).toBe('delegated_agent')
    expect(resolveOperationalMode('claude_code')).toBe('delegated_agent')
    expect(resolveOperationalMode('claude-code')).toBe('delegated_agent')
    expect(resolveOperationalMode('unknown')).toBe('unknown')
    expect(normalizeToCanonicalToolId('windsurf')).toBe('devin')
    expect(expandCanonicalToolIds(['devin'])).toContain('windsurf')
  })
})
