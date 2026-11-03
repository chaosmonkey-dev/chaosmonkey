import { describe, it, expect } from 'vitest'
import { classifyLifecycleClass, classifyAllLifecycleClasses } from '../lib/insights/final/classifyLifecycleClass'
import type { CanonicalInsight } from '../lib/insights/final/types'

/**
 * CR-X 2026-08-30 — Lifecycle classification (A/B/C/D) tests.
 *
 * Proves the four-class lifecycle system:
 *   A. decision   — measured pattern warranting a decision/action
 *   B. contextual — truthful observation, not actionable on its own
 *   C. diagnostic — missing/ineligible evidence
 *   D. suppress   — weak/noisy signal, monitor-only
 */
describe('CR-X: Lifecycle classification', () => {
  it('classifies diagnostic insights as diagnostic', () => {
    const insight: CanonicalInsight = {
      id: 'test-1', title: 'Test', cicdStage: 'plan-code',
      canonicalPriority: 1, renderOrder: 1, presentationType: 'evidence_only',
      comparisonMode: 'absolute', current: 0, confidence: 'low',
      hasData: false, isDiagnostic: true,
    } as CanonicalInsight
    expect(classifyLifecycleClass(insight)).toBe('diagnostic')
  })

  it('classifies hasData=false as diagnostic', () => {
    const insight: CanonicalInsight = {
      id: 'test-2', title: 'Test', cicdStage: 'plan-code',
      canonicalPriority: 1, renderOrder: 1, presentationType: 'evidence_only',
      comparisonMode: 'absolute', current: 0, confidence: 'low',
      hasData: false,
    } as CanonicalInsight
    expect(classifyLifecycleClass(insight)).toBe('diagnostic')
  })

  it('respects generator-set lifecycleClass', () => {
    const insight: CanonicalInsight = {
      id: 'test-3', title: 'Test', cicdStage: 'plan-code',
      canonicalPriority: 1, renderOrder: 1, presentationType: 'evidence_only',
      comparisonMode: 'absolute', current: 50, confidence: 'high',
      hasData: true, lifecycleClass: 'contextual',
    } as CanonicalInsight
    expect(classifyLifecycleClass(insight)).toBe('contextual')
  })

  it('classifies informational urgency as contextual', () => {
    const insight: CanonicalInsight = {
      id: 'test-4', title: 'Sessions span 34 repos', cicdStage: 'plan-code',
      canonicalPriority: 1, renderOrder: 1, presentationType: 'evidence_only',
      comparisonMode: 'absolute', current: 22.4, confidence: 'high',
      hasData: true, urgencyLabel: 'informational',
    } as CanonicalInsight
    expect(classifyLifecycleClass(insight)).toBe('contextual')
  })

  it('classifies monitor-only with weak effect as suppress', () => {
    const insight: CanonicalInsight = {
      id: 'test-5', title: 'AI adoption +1.4pp', cicdStage: 'plan-code',
      canonicalPriority: 1, renderOrder: 1, presentationType: 'evidence_only',
      comparisonMode: 'absolute', current: 65, deltaPct: 1.4, confidence: 'medium',
      hasData: true, recommendationState: 'monitor_only', urgencyLabel: 'monitor',
    } as CanonicalInsight
    expect(classifyLifecycleClass(insight)).toBe('suppress')
  })

  it('classifies monitor-only with strong effect as contextual (not decision)', () => {
    const insight: CanonicalInsight = {
      id: 'test-6', title: 'AI adoption +12pp', cicdStage: 'plan-code',
      canonicalPriority: 1, renderOrder: 1, presentationType: 'evidence_only',
      comparisonMode: 'absolute', current: 65, deltaPct: 12, confidence: 'medium',
      hasData: true, recommendationState: 'monitor_only', urgencyLabel: 'monitor',
    } as CanonicalInsight
    expect(classifyLifecycleClass(insight)).toBe('contextual')
  })

  it('classifies "no material concentration" title as contextual', () => {
    const insight: CanonicalInsight = {
      id: 'test-7', title: 'Sessions span 34 repositories with no material concentration (top-2 = 22.4%)',
      cicdStage: 'plan-code', canonicalPriority: 1, renderOrder: 1,
      presentationType: 'evidence_only', comparisonMode: 'absolute',
      current: 22.4, confidence: 'high', hasData: true,
      urgencyLabel: 'informational',
    } as CanonicalInsight
    expect(classifyLifecycleClass(insight)).toBe('contextual')
  })

  it('classifies action_required with material evidence as decision', () => {
    const insight: CanonicalInsight = {
      id: 'test-8', title: 'Claude bimodal usage pattern',
      cicdStage: 'plan-code', canonicalPriority: 1, renderOrder: 1,
      presentationType: 'evidence_only', comparisonMode: 'absolute',
      current: 38.6, deltaPct: 30.2, confidence: 'high', hasData: true,
      recommendationState: 'action_required', urgencyLabel: 'action_required',
    } as CanonicalInsight
    expect(classifyLifecycleClass(insight)).toBe('decision')
  })

  it('classifies no_action recommendation as contextual', () => {
    const insight: CanonicalInsight = {
      id: 'test-9', title: 'Active coding ratio baseline',
      cicdStage: 'plan-code', canonicalPriority: 1, renderOrder: 1,
      presentationType: 'evidence_only', comparisonMode: 'absolute',
      current: 23.5, confidence: 'high', hasData: true,
      recommendationState: 'no_action',
    } as CanonicalInsight
    expect(classifyLifecycleClass(insight)).toBe('contextual')
  })

  it('classifyAllLifecycleClasses mutates insights to set lifecycleClass', () => {
    const insights: CanonicalInsight[] = [
      { id: 'a', title: 'T', cicdStage: 'plan-code', canonicalPriority: 1, renderOrder: 1, presentationType: 'evidence_only', comparisonMode: 'absolute', current: 0, confidence: 'low', hasData: false, isDiagnostic: true } as CanonicalInsight,
      { id: 'b', title: 'T', cicdStage: 'plan-code', canonicalPriority: 1, renderOrder: 1, presentationType: 'evidence_only', comparisonMode: 'absolute', current: 50, confidence: 'high', hasData: true, urgencyLabel: 'action_required' } as CanonicalInsight,
    ]
    classifyAllLifecycleClasses(insights)
    expect(insights[0].lifecycleClass).toBe('diagnostic')
    expect(insights[1].lifecycleClass).toBe('decision')
  })
})
