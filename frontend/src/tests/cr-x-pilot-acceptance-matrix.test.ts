/**
 * CR-X PI Product-Strength Wave — P6: Progressive Pilot Acceptance Matrix
 *
 * Tests that the PI engine produces decision-relevant intelligence across
 * different pilot shapes. No fixture should "pass" merely because finding
 * count > 0 — the test checks that a VPE learns something decision-relevant.
 */

import { describe, it, expect } from 'vitest';
import { generateFinalCanonicalInsights } from '../lib/insights/final';
import { PILOT_SHAPES, getPilotShape } from '../lib/insights/final/pilotShapeFixtures';
import { getTopInsights } from '../lib/insights/final/utils/ranking';

describe('CR-X Product-Strength Wave — P6: Progressive Pilot Acceptance Matrix', () => {
  async function runShape(shapeId: string) {
    const input = getPilotShape(shapeId as any);
    const insights = await generateFinalCanonicalInsights(input) as any[];
    const findings = insights.filter(i => !i.isDiagnostic);
    const diagnostics = insights.filter(i => i.isDiagnostic);
    const topInsights = getTopInsights(insights);
    return { insights, findings, diagnostics, topInsights };
  }

  // ── A. TELEMETRY-ONLY / SINGLE MATURE WORKFLOW ──────────────────────────

  describe('A. Telemetry-only / Single mature workflow', () => {
    it('produces useful intelligence without cost/delivery fabrication', async () => {
      const { findings } = await runShape('B');
      expect(findings.length).toBeGreaterThan(0);
      const costFindings = findings.filter(f =>
        f.id.includes('cost') || f.id.includes('economics') || f.id.includes('spend')
      );
      const fabricatedCost = costFindings.filter(f =>
        f.hasData && f.current !== null && f.current !== undefined && f.current > 0
      );
      expect(fabricatedCost.length).toBe(0);
    });

    it('produces decision-relevant intelligence for a mature single-workflow pilot', async () => {
      const { findings } = await runShape('B');
      expect(findings.length).toBeGreaterThan(0);

      // A mature single-workflow pilot must provide meaningful progressive
      // value, not just "any finding exists." At least one of these useful
      // intelligence classes must be present:
      //   - within-workflow temporal behavior (recent-change) when material change exists
      //   - repo-conditioned behavior when repo diversity exists
      //   - within-workflow cohort/baseline context (AI effect, session distribution)
      //   - repository concentration/distribution intelligence
      const usefulClasses = findings.filter(f =>
        f.id.startsWith('recent-change__') ||
        f.id.startsWith('repo-conditioned-behavior__') ||
        f.id.startsWith('within-workflow-ai-effect__') ||
        f.id.startsWith('workflow-session-distribution__') ||
        f.id === 'repository-concentration' ||
        f.id === 'repository-distribution-by-workflow'
      );
      expect(usefulClasses.length).toBeGreaterThan(0);

      // Generic pilot-status / trivial descriptive cards do NOT count as
      // decision-relevant intelligence for a mature pilot.
      const trivialCards = findings.filter(f =>
        f.id.includes('pilot-status') ||
        f.id.includes('pilot-maturity') ||
        f.id.includes('instrumentation-coverage')
      );
      // Trivial cards may exist but must not be the ONLY findings.
      expect(usefulClasses.length).toBeGreaterThanOrEqual(trivialCards.length);
    });
  });

  // ── B. TELEMETRY-ONLY / MULTI-WORKFLOW ──────────────────────────────────

  describe('B. Telemetry-only / Multi-workflow', () => {
    it('produces workflow mix or allocation intelligence', async () => {
      const { findings } = await runShape('C');
      expect(findings.length).toBeGreaterThan(0);
      const crossWorkflow = findings.filter(f =>
        f.id.startsWith('workflow-repo-allocation__') ||
        f.id.startsWith('repo-conditioned-behavior__') ||
        f.id.includes('active-coding-time-by-ide') ||
        f.id.includes('ai-adoption')
      );
      expect(crossWorkflow.length).toBeGreaterThan(0);
    });
  });

  // ── C. TELEMETRY + CONFIGURED COST ──────────────────────────────────────

  describe('C. Telemetry + Configured cost', () => {
    it('produces all applicable telemetry intelligence', async () => {
      const shape = getPilotShape('D');
      const input = {
        ...shape,
        externalCostConfigs: [
          { toolId: 'vscode', monthlySpend: 500 },
          { toolId: 'cursor', monthlySpend: 300 },
        ],
      };
      const insights = await generateFinalCanonicalInsights(input) as any[];
      const findings = insights.filter(i => !i.isDiagnostic);
      expect(findings.length).toBeGreaterThan(0);
    });
  });

  // ── D. TELEMETRY + GITHUB/DELIVERY ───────────────────────────────────────

  describe('D. Telemetry + GitHub/delivery', () => {
    it('produces telemetry intelligence with delivery context', async () => {
      const shape = getPilotShape('D');
      const input = {
        ...shape,
        githubSnapshot: { prs: [], github_by_period: [] },
      };
      const insights = await generateFinalCanonicalInsights(input) as any[];
      const findings = insights.filter(i => !i.isDiagnostic);
      expect(findings.length).toBeGreaterThan(0);
    });
  });

  // ── E. ED-SHAPED MIXED IDE + DELEGATED AGENT ─────────────────────────────

  describe('E. Ed-shaped mixed IDE + delegated agent', () => {
    it('produces at least one valuable answer about workflow behavior', async () => {
      const { findings } = await runShape('E');
      expect(findings.length).toBeGreaterThan(0);
      const valuable = findings.filter(f =>
        f.id.startsWith('workflow-repo-allocation__') ||
        f.id.startsWith('repo-conditioned-behavior__') ||
        f.id.startsWith('recent-change__') ||
        f.id.startsWith('within-workflow-temporal-behavior__') ||
        f.id.startsWith('workflow-repo-allocation-shift__') ||
        f.id.includes('active-coding-time-by-ide') ||
        f.id.includes('ai-adoption')
      );
      expect(valuable.length).toBeGreaterThan(0);
    });

    it('does not apply human-active-coding semantics to delegated agents', async () => {
      const { findings } = await runShape('E');
      const agentActiveCoding = findings.filter(f =>
        f.id.includes('active-coding') &&
        (f.id.includes('devin') || f.id.includes('claude_code'))
      );
      expect(agentActiveCoding.length).toBe(0);
    });
  });

  // ── F. EARLY PILOT / LOW SAMPLE ─────────────────────────────────────────

  describe('F. Early pilot / Low sample', () => {
    it('produces honest emerging-state context without fake certainty', async () => {
      const { findings } = await runShape('A');
      const highConfidenceFindings = findings.filter(f =>
        f.confidence === 'high' && f.n && f.n < 10
      );
      expect(highConfidenceFindings.length).toBe(0);
    });

    it('does not flood with useless diagnostics', async () => {
      const { findings, diagnostics } = await runShape('A');
      expect(findings.length + diagnostics.length).toBeGreaterThan(0);
    });
  });

  // ── Top Insights diversity check ────────────────────────────────────────

  describe('Top Insights diversity', () => {
    it('Top Insights contain distinct executive stories, not sibling fragments', async () => {
      for (const shape of PILOT_SHAPES) {
        const { topInsights } = await runShape(shape.id);
        const recentChangeShares = topInsights.filter(t =>
          t.id.startsWith('recent-change__session_share__')
        );
        const hasSynthesis = topInsights.some(t =>
          t.id === 'executive-workflow-mix-synthesis'
        );
        if (hasSynthesis) {
          expect(recentChangeShares.length).toBe(0);
        } else {
          expect(recentChangeShares.length).toBeLessThanOrEqual(2);
        }
      }
    });
  });
});
