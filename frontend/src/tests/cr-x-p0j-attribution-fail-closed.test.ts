import { describe, it, expect } from 'vitest'
import { generateWorkflowCostDeliveryComparison, generateWorkflowDeliveryEfficiency } from '../lib/insights/final/generators/earlySignal'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

/**
 * P0-J: Attribution contract — don't invent L3/L4, fail closed.
 *
 * The attribution hierarchy:
 *   L1 = raw telemetry (session events)
 *   L2 = canonical telemetry (normalized sessions)
 *   L3 = GitHub engineering evidence (PRs, reviews, merges)
 *   L4 = delivery outcomes (deployments, successful deployments)
 *
 * L3 and L4 are org-level — there is no authoritative workflow-level
 * delivery attribution today. Generators that would require L3/L4
 * attribution MUST fail closed (return null) rather than inventing
 * per-workflow delivery attribution.
 */

function makeMinimalInput(overrides: Partial<CanonicalInsightInput> = {}): CanonicalInsightInput {
  return {
    sessionRows: [],
    outcomesByMonth: [],
    ...overrides,
  } as unknown as CanonicalInsightInput
}

describe('P0-J: Attribution contract — fail closed for L3/L4', () => {
  it('generateWorkflowCostDeliveryComparison returns null (FAIL CLOSED)', () => {
    const input = makeMinimalInput({
      sessionRows: [
        { tool: 'cursor', session_id: 's1', duration_ms: 60000, user_id: 'invite:1' },
        { tool: 'cursor', session_id: 's2', duration_ms: 60000, user_id: 'invite:1' },
      ] as any,
      outcomesByMonth: [
        { count_authority: 'observed_rows', merged_pr_count: 5, deployment_count: 3, successful_deployment_count: 2 },
      ] as any,
    })
    // MUST return null — no workflow-level delivery attribution authority
    const result = generateWorkflowCostDeliveryComparison(input)
    expect(result).toBeNull()
  })

  it('generateWorkflowDeliveryEfficiency returns null (FAIL CLOSED)', () => {
    const input = makeMinimalInput({
      sessionRows: [
        { tool: 'cursor', session_id: 's1', duration_ms: 60000, user_id: 'invite:1' },
        { tool: 'vscode', session_id: 's2', duration_ms: 60000, user_id: 'invite:2' },
        { tool: 'cursor', session_id: 's3', duration_ms: 60000, user_id: 'invite:1' },
        { tool: 'vscode', session_id: 's4', duration_ms: 60000, user_id: 'invite:2' },
      ] as any,
      outcomesByMonth: [
        { count_authority: 'observed_rows', merged_pr_count: 5, deployment_count: 3, successful_deployment_count: 2 },
      ] as any,
    })
    // MUST return null — no workflow-level delivery attribution authority
    const result = generateWorkflowDeliveryEfficiency(input)
    expect(result).toBeNull()
  })

  it('FAIL CLOSED even when sufficient data exists for L1/L2', () => {
    // Even with plenty of sessions and observed outcomes, the generators
    // MUST NOT invent per-workflow delivery attribution.
    const sessions = Array.from({ length: 50 }, (_, i) => ({
      tool: i % 2 === 0 ? 'cursor' : 'vscode',
      session_id: `s${i}`,
      duration_ms: 60000,
      user_id: `invite:${i % 5}`,
    }))
    const input = makeMinimalInput({
      sessionRows: sessions as any,
      outcomesByMonth: [
        { count_authority: 'observed_rows', merged_pr_count: 20, deployment_count: 10, successful_deployment_count: 8 },
      ] as any,
    })
    expect(generateWorkflowCostDeliveryComparison(input)).toBeNull()
    expect(generateWorkflowDeliveryEfficiency(input)).toBeNull()
  })
})
