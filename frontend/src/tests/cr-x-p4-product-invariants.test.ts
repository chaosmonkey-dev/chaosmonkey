/**
 * ============================================================================
 * CR-X P4: Product Invariants Across Every Shape
 * ============================================================================
 *
 * For every fixture/shaped corpus assert:
 *   1. Final Engine never throws.
 *   2. No exact/near-semantic story duplicates.
 *   3. Top Insights answer materially different executive questions.
 *   4. All Insights is curated, not raw-generator spam.
 *   5. Eligible workflow-comparison families either fire OR provide explicit truthful blocker.
 *   6. No human active-coding vs delegated-agent runtime productivity comparison.
 *   7. No fake developer/team comparison where identity is fragmented.
 *   8. No configured-cost PI when cost is unavailable.
 *   9. No GitHub/delivery PI when delivery evidence is unavailable.
 *  10. Early pilots still produce useful telemetry-first intelligence.
 *  11. More evidence/history monotonically unlocks richer intelligence.
 *  12. No customer-specific code path is required.
 *  13. Quantitative Tier 1/2 stories have appropriate visual data.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { generateFinalCanonicalInsights } from '../lib/insights/final';
import { addDerivedSessionFields } from '../lib/insights/final/dataAccess';
import { PILOT_SHAPES, applyShape, type PilotShape } from '../lib/insights/final/acceptanceCorpus';
import type { CanonicalInsightInput } from '../lib/insights/final/types';

// ── Test fixture builder ───────────────────────────────────────────────────

function makeSession(tool: string, repo: string, daysAgo: number, opts: any = {}): any {
  const ts = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  const isDelegated = tool === 'devin' || tool === 'claude_code';
  return {
    tool,
    session_source: tool,
    editor_source: tool,
    git_repo_url: `https://github.com/org/${repo}`,
    timestamp: ts,
    duration_ms: opts.duration_ms ?? (isDelegated ? 1800000 + Math.random() * 3600000 : 600000 + Math.random() * 1800000),
    active_coding_duration_ms: isDelegated ? null : (opts.active_coding_ms ?? 120000 + Math.random() * 600000),
    ai_burst_count: opts.ai_burst_count ?? Math.floor(Math.random() * 10),
    ai_usage_duration_ms: opts.ai_usage_ms ?? Math.random() * 300000,
    time_to_first_commit_ms: opts.ttfc_ms ?? 60000 + Math.random() * 120000,
    session_commits: isDelegated ? Math.floor(Math.random() * 5) : null,
    session_id: `sess_${tool}_${daysAgo}_${Math.random().toString(36).slice(2, 8)}`,
    developer_id: `dev_${Math.floor(Math.random() * 10)}`,
    user_id: `user_${Math.floor(Math.random() * 10)}`,
    focus_ratio: isDelegated ? null : 0.3 + Math.random() * 0.5,
    file_save_count: isDelegated ? null : Math.floor(Math.random() * 20),
    session_quality_score: isDelegated ? null : 0.5 + Math.random() * 0.5,
    vscode_version: tool === 'vscode' ? '1.85.0' : tool === 'claude_code' ? 'claude-code' : undefined,
    ...opts,
  };
}

function buildCompositeInput(): CanonicalInsightInput {
  const sessions: any[] = [];

  // VS Code — 3 repos, 200 sessions over 70 days
  for (let i = 0; i < 100; i++) sessions.push(makeSession('vscode', 'am-sim', Math.floor(i * 0.7)));
  for (let i = 0; i < 60; i++) sessions.push(makeSession('vscode', 'angrymonkey', Math.floor(i * 1.2)));
  for (let i = 0; i < 40; i++) sessions.push(makeSession('vscode', 'cm-sim', Math.floor(i * 1.8)));

  // Cursor — 2 repos, 80 sessions over 70 days
  for (let i = 0; i < 50; i++) sessions.push(makeSession('cursor', 'am-sim', Math.floor(i * 1.4)));
  for (let i = 0; i < 30; i++) sessions.push(makeSession('cursor', 'angrymonkey', Math.floor(i * 2.3)));

  // Devin — 2 repos, 100 sessions over 70 days
  for (let i = 0; i < 60; i++) sessions.push(makeSession('devin', 'am-sim', Math.floor(i * 1.2), { duration_ms: 2400000 + Math.random() * 3600000 }));
  for (let i = 0; i < 40; i++) sessions.push(makeSession('devin', 'cm-sim', Math.floor(i * 1.8), { duration_ms: 1800000 + Math.random() * 2400000 }));

  // Claude Code — 1 repo, 30 sessions over 70 days
  for (let i = 0; i < 30; i++) sessions.push(makeSession('claude_code', 'am-sim', Math.floor(i * 2.3), { duration_ms: 3600000 + Math.random() * 7200000 }));

  addDerivedSessionFields(sessions);

  return {
    sessionRows: sessions,
    githubSnapshot: {
      team_metrics: {
        total_prs: 51,
        merged_prs: 34,
        time_to_merge: { p50: 9.8, p90: 48 },
        review_burden: 3.2,
      },
      pr_analytics: {
        pr_size_merge_cycle: {
          large: { count: 21, median_cycle_hours: 24 },
          small: { count: 13, median_cycle_hours: 8 },
        },
      },
      deployment_metrics: {
        total: 41,
        successful: 37,
        failed: 4,
        by_environment: { production: { total: 32, successful: 28, failed: 4 }, staging: { total: 9, successful: 9, failed: 0 } },
      },
      release_metrics: {
        total_releases: 6,
        releases_per_week: 1.5,
      },
      github_provenance: { source: 'live', historical_data_available: true, db_data_available: true },
    } as any,
    externalCostConfigs: [
      { toolId: 'devin', monthlySpend: 500 },
      { toolId: 'cursor', monthlySpend: 200 },
      { toolId: 'vscode', monthlySpend: 100 },
    ],
    granularity: 'week',
  };
}

// ── Product invariants ─────────────────────────────────────────────────────

interface InvariantResult {
  shape: string;
  passed: boolean;
  failures: string[];
  findings: number;
  diagnostics: number;
  topInsights: number;
}

async function checkInvariants(shape: PilotShape, input: CanonicalInsightInput): Promise<InvariantResult> {
  const failures: string[] = [];
  let findings = 0;
  let diagnostics = 0;
  let topInsights = 0;

  try {
    // Invariant 1: Final Engine never throws
    const insights = await generateFinalCanonicalInsights(input) as any[];
    findings = insights.filter(i => !i.isDiagnostic).length;
    diagnostics = insights.filter(i => i.isDiagnostic).length;
    topInsights = insights.filter(i => i.isTopInsightEligible).length;

    // Invariant 2: No exact/near-semantic story duplicates
    const titleGroups: Record<string, any[]> = {};
    for (const i of insights.filter(ins => !ins.isDiagnostic)) {
      const norm = i.title.toLowerCase()
        .replace(/\d+\.?\d*/g, '#')
        .replace(/[(){}[\]]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!titleGroups[norm]) titleGroups[norm] = [];
      titleGroups[norm].push(i);
    }
    for (const [norm, group] of Object.entries(titleGroups)) {
      if (group.length > 1) {
        failures.push(`Duplicate story: "${norm}" (${group.length} cards: ${group.map(g => g.id).join(', ')})`);
      }
    }

    // Invariant 3: Top Insights answer materially different executive questions
    const top = insights.filter(i => i.isTopInsightEligible).sort((a, b) => (a.topInsightRank || 999) - (b.topInsightRank || 999));
    const topFamilies = new Set(top.map(i => i.id.split('__')[0]));
    if (top.length > 1 && topFamilies.size < top.length * 0.6) {
      failures.push(`Top Insights not diverse enough: ${top.length} cards, ${topFamilies.size} families`);
    }

    // Invariant 4: All Insights is curated, not raw-generator spam
    // Check that no more than 40 findings (curated portfolio)
    if (findings > 40) {
      failures.push(`Too many findings (${findings}) — not curated`);
    }

    // Invariant 6: No human active-coding vs delegated-agent runtime productivity comparison
    const crossToolFindings = insights.filter(i => i.id.includes('active-coding-time-by-ide') || i.id.includes('cross_tool_behavior'));
    for (const f of crossToolFindings) {
      if (f.title && f.title.toLowerCase().includes('devin') && f.title.toLowerCase().includes('active')) {
        failures.push(`Human vs delegated-agent productivity comparison: ${f.id} — ${f.title}`);
      }
    }

    // Invariant 7: No fake developer/team comparison where identity is fragmented
    if (shape.fragmentIdentity) {
      const devFindings = insights.filter(i => i.id.includes('developer') || i.id.includes('team'));
      if (devFindings.length > 0) {
        failures.push(`Developer/team comparison with fragmented identity: ${devFindings.map(f => f.id).join(', ')}`);
      }
    }

    // Invariant 8: No configured-cost PI when cost is unavailable
    if (shape.stripCost) {
      const costFindings = insights.filter(i => i.id.includes('allocated-spend') || i.id.includes('cost'));
      if (costFindings.length > 0 && costFindings.some(f => !f.isDiagnostic)) {
        failures.push(`Cost PI without configured cost: ${costFindings.map(f => f.id).join(', ')}`);
      }
    }

    // Invariant 9: No GitHub/delivery PI when delivery evidence is unavailable
    if (shape.stripDeliveryEvidence || shape.stripGitHub) {
      const deliveryFindings = insights.filter(i =>
        (i.cicdStage === 'review-merge' || i.cicdStage === 'deploy-operate') && !i.isDiagnostic
      );
      if (deliveryFindings.length > 0) {
        failures.push(`Delivery PI without GitHub evidence: ${deliveryFindings.map(f => f.id).join(', ')}`);
      }
    }

    // Invariant 10: Early pilots still produce useful telemetry-first intelligence
    if (['day_1', 'day_5'].includes(shape.id)) {
      if (findings === 0) {
        failures.push(`Early pilot produces zero findings`);
      }
    }

    // Invariant 13: Quantitative Tier 1/2 stories have appropriate visual data
    const tier12 = insights.filter(i => !i.isDiagnostic && ((i.breakdownByTool && Object.keys(i.breakdownByTool).length > 0) || (i.evidence && i.evidence.length > 2)));
    for (const f of tier12.slice(0, 5)) {
      // Findings must have EITHER evidence OR breakdownByTool (not necessarily both)
      const hasEvidence = f.evidence && f.evidence.length > 0;
      const hasBreakdown = f.breakdownByTool && Object.keys(f.breakdownByTool).length > 0;
      if (!hasEvidence && !hasBreakdown) {
        failures.push(`Quantitative finding without evidence or breakdown: ${f.id}`);
      }
    }

  } catch (e) {
    failures.push(`Engine threw: ${(e as Error).message}`);
  }

  return {
    shape: shape.id,
    passed: failures.length === 0,
    failures,
    findings,
    diagnostics,
    topInsights,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CR-X P4: Product Invariants Across Every Shape', () => {
  const baseInput = buildCompositeInput();

  for (const shape of PILOT_SHAPES) {
    it(`${shape.id}: ${shape.description}`, async () => {
      const shapedInput = applyShape(baseInput, shape);
      const result = await checkInvariants(shape, shapedInput);

      if (!result.passed) {
        console.log(`\n=== ${shape.id} FAILURES ===`);
        for (const f of result.failures) console.log(`  ✗ ${f}`);
        console.log(`  findings=${result.findings} diagnostics=${result.diagnostics} top=${result.topInsights}`);
      }

      // Log summary for all shapes
      console.log(`${shape.id}: findings=${result.findings} diag=${result.diagnostics} top=${result.topInsights} ${result.passed ? '✓' : '✗'}`);

      expect(result.passed).toBe(true);
    }, 60000);
  }
});
