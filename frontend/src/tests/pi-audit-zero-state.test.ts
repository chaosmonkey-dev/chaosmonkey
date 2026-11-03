/**
 * Pilot Ops 20B Blocker 1 — zero-state audit classification.
 *
 * A fresh pilot with zero telemetry/GitHub evidence legitimately produces
 * zero final-engine insights. That is truthful fail-closed empty state and
 * must NOT be classified as an engine routing failure. Genuine failures
 * (evidence present, zero output) must still error.
 */
import { describe, it, expect } from 'vitest';
import { runFinalPIAudit } from '../lib/insights/final/utils/audit';

const ROUTING_ERROR = 'Feature flag enabled but final engine count is 0 - all canonical PIs missing';

const fakeInsight = (id: string) => ({
  id,
  engineVersion: 'FINAL_ENGINE_V1',
  title: 't',
});

describe('PI audit zero-state classification (Pilot Ops 20B)', () => {
  it('zero-evidence + flag on + zero insights → NO routing failure, pass, no fallback', () => {
    const r = runFinalPIAudit([], true, [], true);
    expect(r.errors).not.toContain(ROUTING_ERROR);
    expect(r.errors).toHaveLength(0);
    expect(r.pass).toBe(true);
    expect(r.fallbackActivated).toBe(false);
  });

  it('evidence-present + flag on + zero insights → routing failure preserved', () => {
    const r = runFinalPIAudit([], true, [], false);
    expect(r.errors).toContain(ROUTING_ERROR);
    expect(r.pass).toBe(false);
    expect(r.fallbackActivated).toBe(true);
  });

  it('default param (legacy callers) still errors on flag-on zero count', () => {
    const r = runFinalPIAudit([], true);
    expect(r.errors).toContain(ROUTING_ERROR);
  });

  it('flag off + zero insights → no error regardless of evidence', () => {
    expect(runFinalPIAudit([], false, [], true).errors).toHaveLength(0);
    expect(runFinalPIAudit([], false, [], false).errors).toHaveLength(0);
  });

  it('flag on + nonzero insights → pass unaffected by zeroEvidence', () => {
    const insights = [fakeInsight('a') as any, fakeInsight('b') as any];
    const r = runFinalPIAudit(insights, true, [], true);
    expect(r.errors).toHaveLength(0);
    expect(r.fallbackActivated).toBe(false);
    expect(r.engineBreakdown.finalEngineCount).toBe(2);
  });
});
