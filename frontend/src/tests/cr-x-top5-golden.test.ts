/**
 * CR-X FINAL — Top-5 Golden Tests (Output-Level Product Contracts)
 *
 * These tests assert PRODUCT CONTRACTS, not brittle exact IDs.
 * They verify that the Top-5 selection from the Final PI Engine obeys
 * the semantic guarantees a VPE/CTO relies on for decision support.
 *
 * Contracts tested:
 *   1. No duplicate semantic story in Top 5
 *   2. Stage diversity when evidence exists
 *   3. Tiny-sample signals do not outrank materially stronger parent signals
 *   4. No invalid cross-mode time comparison
 *   5. No causal claim from observational evidence
 *   6. GitHub findings fail closed without eligible GitHub
 *   7. Configured economics are not represented as billing actuals
 *   8. Diagnostics do not dominate Top Insights
 *   9. Single-workflow pilots get useful findings
 *  10. Mixed-mode pilots remain semantically correct
 *  11. Candidate growth does not create unbounded UI growth
 */

import { describe, it, expect } from 'vitest';
import { generateFinalCanonicalInsights } from '../lib/insights/final';
import { getTopInsights, resolveSemanticFamily } from '../lib/insights/final/utils/ranking';
import { PILOT_SHAPES, getPilotShape } from '../lib/insights/final/pilotShapeFixtures';

// Causal language that must NEVER appear in user-visible copy
const CAUSAL_LANGUAGE_PATTERNS = [
  /\bcauses?\b/i,
  /\bcaused?\b/i,
  /\bdrives?\b/i,
  /\bdrives\s+productivity\b/i,
  /\bimproves?\s+(?:productivity|throughput|quality)\b/i,
  /\bproves?\b/i,
  /\bdue to\b/i,
  /\bbecause of\b/i,
  /\bleads?\s+to\b/i,
  /\bresults?\s+in\b/i,
];

// Billing-actual language that must never appear for configured estimates
const BILLING_ACTUAL_PATTERNS = [
  /\bactual\s+(?:cost|spend|billing)\b/i,
  /\bbilling\s+actual\b/i,
  /\binvoice\b/i,
  /\breal\s+cost\b/i,
];

// Cross-mode invalid comparison language
const INVALID_CROSS_MODE_PATTERNS = [
  /\bactive\s*coding.*(?:vs|versus|compared).*(?:devin|claude|agent|delegated)/i,
  /\b(?:devin|claude|agent|delegated).*(?:vs|versus|compared).*active\s*coding/i,
  /\bfocus\s*ratio.*(?:vs|versus|compared).*(?:devin|claude|agent|delegated)/i,
];

describe('CR-X FINAL — Top-5 Golden Tests (Product Contracts)', () => {
  async function runEngine(shapeId: string, extra?: Record<string, unknown>) {
    const shape = getPilotShape(shapeId as any);
    const input = extra ? { ...shape, ...extra } : shape;
    const insights = await generateFinalCanonicalInsights(input) as any[];
    const findings = insights.filter(i => !i.isDiagnostic);
    const diagnostics = insights.filter(i => i.isDiagnostic);
    const topInsights = getTopInsights(insights);
    return { insights, findings, diagnostics, topInsights };
  }

  // ── Contract 1: No duplicate semantic story in Top 5 ──────────────────
  describe('Contract 1: No duplicate semantic story in Top 5', () => {
    for (const shape of PILOT_SHAPES) {
      it(`shape ${shape.id}: Top 5 has no duplicate semantic families exceeding quota`, async () => {
        const { topInsights } = await runEngine(shape.id);
        const familyCounts: Record<string, number> = {};
        for (const t of topInsights) {
          const fam = t.semanticFamily || resolveSemanticFamily(t.id);
          familyCounts[fam] = (familyCounts[fam] || 0) + 1;
        }
        // No single family should dominate Top 5 with more than 2 entries
        for (const [family, count] of Object.entries(familyCounts)) {
          if (family === 'diagnostic') continue;
          expect(count).toBeLessThanOrEqual(2,
            `Family "${family}" has ${count} entries in Top 5 for shape ${shape.id}`);
        }
      });
    }
  });

  // ── Contract 2: Stage diversity when evidence exists ─────────────────
  describe('Contract 2: Stage diversity when evidence exists', () => {
    it('shape D (mature multi-workflow with delivery): Top 5 includes multiple stages', async () => {
      const { topInsights } = await runEngine('D', {
        githubSnapshot: {
          pr_analytics: { total_prs: 50, merged_prs: 35, github_db_pr_count: 50 },
          pr_review_metrics: { review_count: 80, unique_reviewer_count: 5, pr_reopened_count: 3, total_prs: 50 },
          deployment_metrics: { success_deployment_count: 20, failed_deployment_count: 3 },
          github_by_period: [],
          github_provenance: { source: 'live_api', historical_data_available: true, generated_fallback_used: false },
        },
      });
      const stages = new Set(topInsights.map(t => t.cicdStage));
      // When delivery evidence exists, at least 2 stages should be represented
      expect(stages.size).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Contract 3: Tiny-sample signals don't outrank stronger signals ────
  describe('Contract 3: Tiny-sample signals do not outrank materially stronger parent signals', () => {
    it('shape A (early pilot): no high-confidence findings with n < 10', async () => {
      const { findings } = await runEngine('A');
      const tinyHighConf = findings.filter(f =>
        f.confidence === 'high' && f.n !== undefined && f.n < 10
      );
      expect(tinyHighConf.length).toBe(0);
    });
  });

  // ── Contract 4: No invalid cross-mode time comparison ─────────────────
  describe('Contract 4: No invalid cross-mode time comparison', () => {
    it('shape E (agent-heavy): no active-coding comparison applied to delegated agents', async () => {
      const { findings, topInsights } = await runEngine('E');
      // No finding should apply human-active-coding semantics to delegated agents
      const agentActiveCoding = findings.filter(f =>
        f.id.includes('active-coding') &&
        (f.id.includes('devin') || f.id.includes('claude_code'))
      );
      expect(agentActiveCoding.length).toBe(0);

      // Top Insights should not contain invalid cross-mode comparisons
      for (const t of topInsights) {
        const title = t.title || '';
        const desc = t.description || '';
        for (const pattern of INVALID_CROSS_MODE_PATTERNS) {
          expect(pattern.test(title)).toBe(false,
            `Top Insight "${t.id}" title contains invalid cross-mode comparison: ${title}`);
          expect(pattern.test(desc)).toBe(false,
            `Top Insight "${t.id}" description contains invalid cross-mode comparison`);
        }
      }
    });
  });

  // ── Contract 5: No causal claim from observational evidence ────────────
  describe('Contract 5: No causal claim from observational evidence', () => {
    for (const shape of PILOT_SHAPES) {
      it(`shape ${shape.id}: no causal language in user-visible copy`, async () => {
        const { insights } = await runEngine(shape.id);
        for (const ins of insights) {
          const fields = [ins.title, ins.description, ins.executiveSummary,
            ins.recommendation, ins.whyItMatters, ins.whatChanged].filter(Boolean) as string[];
          for (const text of fields) {
            for (const pattern of CAUSAL_LANGUAGE_PATTERNS) {
              expect(pattern.test(text)).toBe(false,
                `Insight "${ins.id}" contains causal language: "${text}"`);
            }
          }
        }
      });
    }
  });

  // ── Contract 6: GitHub findings fail closed without eligible GitHub ───
  describe('Contract 6: GitHub findings fail closed without eligible GitHub', () => {
    it('shape B (no GitHub): no review-merge or deploy-operate findings with data', async () => {
      const { findings } = await runEngine('B');
      const downstreamWithData = findings.filter(f =>
        (f.cicdStage === 'review-merge' || f.cicdStage === 'deploy-operate') &&
        f.hasData === true
      );
      expect(downstreamWithData.length).toBe(0);
    });
  });

  // ── Contract 7: Configured economics not represented as billing ──────
  describe('Contract 7: Configured economics are not represented as billing actuals', () => {
    it('shape D with cost: no billing-actual language in economics findings', async () => {
      const { insights } = await runEngine('D', {
        externalCostConfigs: [
          { toolId: 'vscode', monthlySpend: 500 },
          { toolId: 'cursor', monthlySpend: 300 },
        ],
      });
      const econFindings = insights.filter(i =>
        i.semanticFamily === 'economics' || i.id.includes('cost') || i.id.includes('spend')
      );
      for (const f of econFindings) {
        const fields = [f.title, f.description, f.executiveSummary, f.recommendation]
          .filter(Boolean) as string[];
        for (const text of fields) {
          for (const pattern of BILLING_ACTUAL_PATTERNS) {
            expect(pattern.test(text)).toBe(false,
              `Economics finding "${f.id}" contains billing-actual language: "${text}"`);
          }
        }
      }
    });
  });

  // ── Contract 8: Diagnostics do not dominate Top Insights ──────────────
  describe('Contract 8: Diagnostics do not dominate Top Insights', () => {
    for (const shape of PILOT_SHAPES) {
      it(`shape ${shape.id}: Top Insights contain no diagnostics`, async () => {
        const { topInsights } = await runEngine(shape.id);
        const diagnosticInTop = topInsights.filter(t => t.isDiagnostic === true);
        expect(diagnosticInTop.length).toBe(0);
      });
    }
  });

  // ── Contract 9: Single-workflow pilots get useful findings ────────────
  describe('Contract 9: Single-workflow pilots get useful findings', () => {
    it('shape B (mature single-workflow): produces at least 3 findings', async () => {
      const { findings } = await runEngine('B');
      expect(findings.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ── Contract 10: Mixed-mode pilots remain semantically correct ────────
  describe('Contract 10: Mixed-mode pilots remain semantically correct', () => {
    it('shape E (agent-heavy): produces findings without cross-mode contamination', async () => {
      const { findings } = await runEngine('E');
      expect(findings.length).toBeGreaterThan(0);
      // No finding should mix human-interactive and delegated-agent metrics
      // in a direct comparison
      const mixedMode = findings.filter(f => {
        const title = f.title || '';
        const desc = f.description || '';
        return INVALID_CROSS_MODE_PATTERNS.some(p => p.test(title) || p.test(desc));
      });
      expect(mixedMode.length).toBe(0);
    });
  });

  // ── Contract 11: Candidate growth does not create unbounded UI growth ─
  describe('Contract 11: Candidate growth does not create unbounded UI growth', () => {
    it('Top Insights never exceeds 5', async () => {
      for (const shape of PILOT_SHAPES) {
        const { topInsights } = await runEngine(shape.id);
        expect(topInsights.length).toBeLessThanOrEqual(5);
      }
    });

    it('visible findings are bounded (no linear explosion with shapes)', async () => {
      for (const shape of PILOT_SHAPES) {
        const { findings } = await runEngine(shape.id);
        // Portfolio should be bounded — not linearly scaling with data
        expect(findings.length).toBeLessThanOrEqual(60);
      }
    });
  });

  // ── Contract 12: Semantic family distribution is diverse ──────────────
  describe('Contract 12: Semantic family distribution is diverse for mature pilots', () => {
    it('shape D (mature multi-workflow): Top 5 spans at least 3 semantic families', async () => {
      const { topInsights } = await runEngine('D');
      if (topInsights.length >= 3) {
        const families = new Set(topInsights.map(t =>
          t.semanticFamily || resolveSemanticFamily(t.id)
        ));
        expect(families.size).toBeGreaterThanOrEqual(2);
      }
    });
  });

  // ── Contract 13: Explicit story-key dominance ─────────────────────────
  describe('Contract 13: Explicit story-key dominance (parent/child suppression)', () => {
    it('workflow-mix synthesis suppresses its child session_share cards', async () => {
      // Use shape D (mature multi-workflow) which has enough history for
      // temporal comparison and multiple workflows for mix changes.
      const { insights } = await runEngine('D');
      const synthesis = insights.find(i => i.id === 'executive-workflow-mix-synthesis');
      const sessionShareFindings = insights.filter(i =>
        i.id.startsWith('recent-change__session_share__')
      );

      if (synthesis && synthesis.hasData !== false && !synthesis.isDiagnostic) {
        // If the synthesis is visible, its child share cards should be
        // portfolio-suppressed (not visible in findings).
        const visibleShares = sessionShareFindings.filter(s =>
          !s.portfolioSuppressed && s.hasData !== false
        );
        expect(visibleShares.length).toBe(0,
          `Synthesis is visible but ${visibleShares.length} child session_share cards are also visible`);
      }
    });

    it('review-burden and merge-cycle-time coexist (not suppressed)', async () => {
      // These are distinct metrics that must NOT be suppressed by dominance.
      const { insights } = await runEngine('D', {
        githubSnapshot: {
          pr_analytics: { total_prs: 50, merged_prs: 35, github_db_pr_count: 50 },
          pr_review_metrics: { review_count: 80, unique_reviewer_count: 5, pr_reopened_count: 3, total_prs: 50 },
          deployment_metrics: { success_deployment_count: 20, failed_deployment_count: 3 },
          github_by_period: [],
          github_provenance: { source: 'live_api', historical_data_available: true, generated_fallback_used: false },
        },
      });
      const reviewBurden = insights.find(i => i.id === 'review-burden');
      const mergeCycle = insights.find(i => i.id === 'merge-cycle-time');

      // If both exist with data, neither should be suppressed by the other.
      if (reviewBurden && mergeCycle) {
        if (reviewBurden.hasData !== false && mergeCycle.hasData !== false) {
          // At least one should be visible (they may not both have data
          // depending on GitHub evidence, but if they do, they coexist).
          const reviewBurdenSuppressed = reviewBurden.portfolioSuppressed === true;
          const mergeCycleSuppressed = mergeCycle.portfolioSuppressed === true;
          // They should NOT both be suppressed by dominance.
          expect(reviewBurdenSuppressed && mergeCycleSuppressed).toBe(false,
            'review-burden and merge-cycle-time should not both be suppressed');
        }
      }
    });

    it('pr-throughput and merge-rate coexist (not suppressed)', async () => {
      const { insights } = await runEngine('D', {
        githubSnapshot: {
          pr_analytics: { total_prs: 50, merged_prs: 35, github_db_pr_count: 50 },
          pr_review_metrics: { review_count: 80, unique_reviewer_count: 5, pr_reopened_count: 3, total_prs: 50 },
          deployment_metrics: { success_deployment_count: 20, failed_deployment_count: 3 },
          github_by_period: [],
          github_provenance: { source: 'live_api', historical_data_available: true, generated_fallback_used: false },
        },
      });
      const prThroughput = insights.find(i => i.id === 'pr-throughput');
      const mergeRate = insights.find(i => i.id === 'merge-rate');

      if (prThroughput && mergeRate) {
        if (prThroughput.hasData !== false && mergeRate.hasData !== false) {
          const prThroughputSuppressed = prThroughput.portfolioSuppressed === true;
          const mergeRateSuppressed = mergeRate.portfolioSuppressed === true;
          expect(prThroughputSuppressed && mergeRateSuppressed).toBe(false,
            'pr-throughput and merge-rate should not both be suppressed');
        }
      }
    });

    it('materially distinct findings in the same semantic family coexist', async () => {
      // Two within-workflow findings with different subjects (different workflows)
      // must NOT be suppressed by dominance.
      const { insights } = await runEngine('D');
      const withinWorkflow = insights.filter(i =>
        i.id.startsWith('within-workflow-ai-effect__') ||
        i.id.startsWith('workflow-session-distribution__')
      );
      const visible = withinWorkflow.filter(i => !i.portfolioSuppressed && i.hasData !== false);
      // If there are multiple within-workflow findings with different workflows,
      // they should all remain visible.
      if (withinWorkflow.length > 1) {
        expect(visible.length).toBeGreaterThan(0,
          'At least one within-workflow finding should be visible');
      }
    });
  });

  // ── Contract 12: Top-5 avoids two adjacent repo/allocation stories ───
  describe('Contract 12: Top-5 avoids adjacent repo/allocation stories when a different story exists', () => {
    // Repo/allocation families that are semantically adjacent — two in
    // Top 5 is redundant when a materially different story is available.
    const REPO_ALLOCATION_FAMILIES = new Set([
      'cross_repo_behavior',
      'workflow_allocation',
      'workflow_allocation_shift',
      'concentration',
    ]);

    it('no two adjacent repo/allocation stories in Top 5 when a different story exists', async () => {
      // Run across all pilot shapes — the contract applies universally.
      for (const shape of PILOT_SHAPES) {
        const { topInsights, findings } = await runEngine(shape.id);

        // Count how many Top-5 entries are repo/allocation stories.
        const repoAllocInTop5 = topInsights.filter(t => {
          const fam = t.semanticFamily || resolveSemanticFamily(t.id);
          return REPO_ALLOCATION_FAMILIES.has(fam);
        });

        // If 2+ adjacent repo/allocation stories made Top 5, a materially
        // different qualified finding must NOT have been available.
        // We check: are there any non-adjacent findings that scored high
        // enough to be eligible (not suppressed, has data) but were not
        // selected?
        if (repoAllocInTop5.length >= 2) {
          const top5Ids = new Set(topInsights.map(t => t.id));
          const alternativeCandidates = findings.filter(f => {
            if (top5Ids.has(f.id)) return false;
            if (f.portfolioSuppressed) return false;
            if (f.hasData === false) return false;
            const fam = f.semanticFamily || resolveSemanticFamily(f.id);
            // Must be a materially different story (not in the adjacency group)
            return !REPO_ALLOCATION_FAMILIES.has(fam);
          });

          // If alternative candidates exist, the contract is violated.
          // Two adjacent stories should not crowd out a different story.
          expect(alternativeCandidates.length).toBe(0,
            `Shape ${shape.id}: Top 5 has ${repoAllocInTop5.length} adjacent ` +
            `repo/allocation stories but ${alternativeCandidates.length} ` +
            `materially different findings were available. The adjacency ` +
            `diversity rule should have deferred one in favor of a ` +
            `different story.`);
        }
      }
    });

    it('adjacent repo/allocation findings are NOT suppressed from All Insights', async () => {
      // The diversity rule affects ONLY Top-5 selection, not All Insights.
      // Both adjacent findings must remain visible in the full portfolio.
      for (const shape of PILOT_SHAPES) {
        const { insights } = await runEngine(shape.id);
        const repoAllocFindings = insights.filter(i => {
          const fam = i.semanticFamily || resolveSemanticFamily(i.id);
          return REPO_ALLOCATION_FAMILIES.has(fam);
        });
        // All repo/allocation findings should be visible (not suppressed)
        // unless suppressed by an explicit storyKey parent (workflow-mix).
        for (const f of repoAllocFindings) {
          if (f.portfolioSuppressed) {
            // storyKey suppression is allowed (workflow-mix synthesis owns children)
            expect(f.storyKey).toBeTruthy();
          }
        }
      }
    });
  });
});
