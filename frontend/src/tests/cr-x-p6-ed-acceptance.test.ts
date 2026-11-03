/**
 * ============================================================================
 * CR-X P6: Ed Acceptance — Run Current Local Engine Against ED_REAL
 * ============================================================================
 *
 * Runs the ACTUAL Final Engine against the ED_REAL fixture (read-only export
 * from Ed, sanitized). Proves the engine generalizes without per-customer
 * custom work.
 *
 * Ed fixture represents:
 * - VS Code + Claude Code
 * - Telemetry-only (no configured cost, no GitHub delivery evidence)
 * - Fragmented developer identity
 * - Multiple repos
 * - ~10 weeks history
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateFinalCanonicalInsights } from '../lib/insights/final';
import { addDerivedSessionFields } from '../lib/insights/final/dataAccess';

const ED_FIXTURE_PATH = join(__dirname, '..', 'lib', 'insights', 'final', 'acceptanceCorpus', 'ed-real.json');

function loadEdFixture() {
  const raw = readFileSync(ED_FIXTURE_PATH, 'utf-8');
  const data = JSON.parse(raw);
  return data;
}

describe('CR-X P6: Ed Acceptance — Engine Against ED_REAL', () => {
  let engineOutput: any[] = [];
  let edData: any;

  it('loads ED_REAL fixture', () => {
    edData = loadEdFixture();
    expect(edData.sessions).toBeDefined();
    expect(edData.sessions.length).toBeGreaterThan(0);
    console.log(`\n=== ED_REAL FIXTURE ===`);
    console.log(`Sessions: ${edData.sessions.length}`);
    console.log(`Workflow counts: ${JSON.stringify(edData.metadata?.workflowCounts)}`);
    console.log(`Time range: ${edData.metadata?.timeRange?.start} → ${edData.metadata?.timeRange?.end}`);
    console.log(`Has cost: ${edData.metadata?.hasCost}`);
    console.log(`Has GitHub: ${edData.metadata?.hasGitHub}`);
  });

  it('runs Final Engine against ED_REAL without throwing', async () => {
    const sessions = edData.sessions.map((s: any) => ({ ...s }));
    addDerivedSessionFields(sessions);

    const input = {
      sessionRows: sessions,
      githubSnapshot: undefined, // Ed has no GitHub delivery evidence
      githubByPeriod: [],
      externalCostConfigs: null, // Ed has no configured cost
      granularity: 'week' as const,
    };

    engineOutput = await generateFinalCanonicalInsights(input) as any[];
    expect(engineOutput.length).toBeGreaterThan(0);
  });

  it('DUMPS exact Ed engine output', () => {
    const findings = engineOutput.filter(i => !i.isDiagnostic);
    const diagnostics = engineOutput.filter(i => i.isDiagnostic);
    const top = engineOutput.filter(i => i.isTopInsightEligible).sort((a, b) => (a.topInsightRank || 999) - (b.topInsightRank || 999));

    console.log('\n========== ED_REAL ENGINE OUTPUT ==========');
    console.log(`Total adapted insights: ${engineOutput.length}`);
    console.log(`Findings (non-diagnostic): ${findings.length}`);
    console.log(`Diagnostics: ${diagnostics.length}`);

    console.log('\n--- ALL ADAPTED INSIGHTS (engine output order) ---');
    for (const i of engineOutput) {
      const rank = i.isTopInsightEligible ? ` [TOP#${i.topInsightRank}]` : '';
      const diag = i.isDiagnostic ? ' [DIAGNOSTIC]' : '';
      console.log(`  ${i.id}${rank}${diag} (${i.cicdStage}): ${i.title?.substring(0, 120)}`);
    }

    console.log('\n--- TOP INSIGHTS (engine ranking) ---');
    for (const t of top) {
      console.log(`  #${t.topInsightRank}: ${t.id} — ${t.title?.substring(0, 140)}`);
    }

    console.log('\n--- DIAGNOSTICS ---');
    for (const d of diagnostics) {
      console.log(`  ${d.id}: ${d.title} (reason: ${d.diagnosticReason})`);
    }

    console.log('========== END ED ENGINE OUTPUT ==========\n');
  });

  it('verifies Ed-specific executive questions surface', () => {
    const findings = engineOutput.filter(i => !i.isDiagnostic);
    const diags = engineOutput.filter(i => i.isDiagnostic);
    const allTitles = findings.map(f => f.title?.toLowerCase() || '').join(' ');
    const allIds = findings.map(f => f.id).join(' ');

    // Ed has VS Code + Claude Code — engine should discover usage differences
    console.log('\n=== ED EXECUTIVE QUESTION COVERAGE ===');

    // WHAT CHANGED?
    const hasChange = findings.some(f => f.id.includes('recent-change'));
    console.log(`WHAT CHANGED? — ${hasChange ? 'YES' : 'NO'}`);

    // WHAT WORKFLOWS DIFFER?
    const hasWorkflowComparison = findings.some(f =>
      f.id.includes('active-coding-time-by-ide') ||
      f.id.includes('cross_tool_behavior') ||
      f.id.includes('workflow-repo-allocation')
    );
    console.log(`WHAT WORKFLOWS DIFFER? — ${hasWorkflowComparison ? 'YES' : 'NO (truthful: Claude Code is delegated agent, active-coding comparison unavailable)'}`);

    // WHERE ARE TOOLS BEING USED DIFFERENTLY?
    const hasRepoAllocation = findings.some(f =>
      f.id.includes('workflow-repo-allocation') ||
      f.id.includes('repository-concentration') ||
      f.id.includes('repository-distribution')
    );
    console.log(`WHERE ARE TOOLS USED DIFFERENTLY? — ${hasRepoAllocation ? 'YES' : 'NO (truthful: needs more telemetry)'}`);

    // WHAT IS CONCENTRATED?
    const hasConcentration = findings.some(f =>
      f.id.includes('repository-concentration') ||
      f.id.includes('concentration')
    );
    console.log(`WHAT IS CONCENTRATED? — ${hasConcentration ? 'YES' : 'NO (truthful: needs more telemetry)'}`);

    // WHAT EVIDENCE IS STILL MISSING?
    const hasMissingEvidence = diags.length > 0;
    console.log(`WHAT EVIDENCE IS MISSING? — ${hasMissingEvidence ? 'YES' : 'NO'}`);

    // No cost PI (Ed has no cost)
    const hasCostPI = findings.some(f => f.id.includes('allocated-spend') || f.id.includes('cost'));
    console.log(`No cost PI (correct) — ${!hasCostPI ? 'YES' : 'NO (BUG)'}`);
    expect(hasCostPI).toBe(false);

    // No GitHub/delivery PI (Ed has no delivery evidence)
    const hasDeliveryPI = findings.some(f =>
      (f.cicdStage === 'review-merge' || f.cicdStage === 'deploy-operate') && !f.isDiagnostic
    );
    console.log(`No delivery PI (correct) — ${!hasDeliveryPI ? 'YES' : 'NO (BUG)'}`);
    expect(hasDeliveryPI).toBe(false);

    // Engine must produce SOME useful intelligence from Ed (not zero findings)
    expect(findings.length).toBeGreaterThan(0);

    // Engine must truthfully report missing evidence (diagnostics)
    expect(diags.length).toBeGreaterThan(0);
  });

  it('P5: verifies strengthened ED acceptance — CLEAN only if evidence preserved + language correct', () => {
    const findings = engineOutput.filter(i => !i.isDiagnostic);
    const diags = engineOutput.filter(i => i.isDiagnostic);
    const issues: string[] = [];

    console.log('\n=== P5: STRENGTHENED ED ACCEPTANCE ===');

    // 1. Fixture faithfully preserves available evidence
    // (verified by P0 reconciliation — 3335 sessions, 617 Claude Code, 58 repos)
    const hasRepoFindings = findings.some(f =>
      f.id.includes('repository-concentration') ||
      f.id.includes('repository-distribution') ||
      f.id.includes('workflow-repo-allocation') ||
      f.id.includes('repo-conditioned-behavior')
    );
    console.log(`1. Fixture preserves evidence (repo findings fire) — ${hasRepoFindings ? 'YES' : 'NO (BUG)'}`);
    if (!hasRepoFindings) issues.push('Repo evidence not preserved — repo findings missing');

    // 2. Operational-mode language is correct
    const hasInteractiveForDelegated = findings.some(f =>
      f.title?.toLowerCase().includes('interactive') &&
      (f.id.includes('claude') || f.id.includes('devin'))
    );
    console.log(`2. Operational-mode language correct (no "interactive" for delegated) — ${!hasInteractiveForDelegated ? 'YES' : 'NO (BUG)'}`);
    if (hasInteractiveForDelegated) issues.push('Delegated agent called "interactive"');

    // 3. Mode-neutral cross-workflow comparisons are evaluated
    const hasCrossWorkflow = findings.some(f =>
      f.id.includes('workflow-repo-allocation') ||
      f.id.includes('repository-distribution-by-workflow') ||
      f.id.includes('workflow-repo-allocation-shift')
    );
    console.log(`3. Mode-neutral cross-workflow comparisons — ${hasCrossWorkflow ? 'YES' : 'NO (BUG)'}`);
    if (!hasCrossWorkflow) issues.push('No mode-neutral cross-workflow comparisons');

    // 4. Available repo intelligence is evaluated
    const hasRepoIntelligence = findings.some(f =>
      f.id.includes('repository-concentration') ||
      f.id.includes('repository-distribution') ||
      f.id.includes('repo-conditioned-behavior')
    );
    console.log(`4. Repo intelligence evaluated — ${hasRepoIntelligence ? 'YES' : 'NO (BUG)'}`);
    if (!hasRepoIntelligence) issues.push('Repo intelligence not evaluated');

    // 5. Temporal intelligence is truthful
    const hasTemporal = findings.some(f => f.id.includes('recent-change'));
    console.log(`5. Temporal intelligence truthful — ${hasTemporal ? 'YES' : 'NO'}`);
    if (!hasTemporal) issues.push('No temporal intelligence');

    // 6. No misleading AI-language exists
    const hasMisleadingAI = findings.some(f =>
      f.title?.toLowerCase().includes('ai usage in') &&
      (f.id.includes('claude') || f.id.includes('devin'))
    );
    console.log(`6. No misleading AI-language — ${!hasMisleadingAI ? 'YES' : 'NO (BUG)'}`);
    if (hasMisleadingAI) issues.push('Misleading AI language for AI workflow');

    // 7. Diagnostics represent truly missing evidence (not adapter loss)
    // Ed has only 2 truthful diagnostics: active-coding comparison (delegated agent) and within-workflow AI effect
    const diagnosticIds = diags.map(d => d.id);
    const expectedDiags = ['active-coding-time-by-ide', 'within-workflow-ai-effect'];
    const hasAdapterLoss = diagnosticIds.some(id =>
      id.includes('repository-concentration') || id.includes('repository-distribution')
    );
    console.log(`7. Diagnostics are truthful (no adapter loss) — ${!hasAdapterLoss ? 'YES' : 'NO (BUG)'}`);
    if (hasAdapterLoss) issues.push('Diagnostics represent adapter loss, not missing evidence');

    // 8. Top Insights are genuinely useful to a VPE
    const top = engineOutput.filter(i => i.isTopInsightEligible).sort((a, b) => (a.topInsightRank || 999) - (b.topInsightRank || 999));
    const hasUsefulTop = top.length >= 3 && top.some(t =>
      t.id.includes('workflow-repo-allocation') ||
      t.id.includes('repository-distribution') ||
      t.id.includes('recent-change')
    );
    console.log(`8. Top Insights useful to VPE (${top.length} top, ${hasUsefulTop ? 'meaningful' : 'not meaningful'}) — ${hasUsefulTop ? 'YES' : 'NO'}`);
    if (!hasUsefulTop) issues.push('Top Insights not useful to VPE');

    console.log(`\n  CLEAN status: ${issues.length === 0 ? 'CLEAN' : 'NOT CLEAN'}`);
    if (issues.length > 0) {
      for (const issue of issues) console.log(`  ✗ ${issue}`);
    }

    expect(issues.length).toBe(0);
  });

  it('verifies no semantic duplicates in Ed output', () => {
    const findings = engineOutput.filter(i => !i.isDiagnostic);
    const titleGroups: Record<string, any[]> = {};
    for (const i of findings) {
      const norm = i.title.toLowerCase()
        .replace(/\d+\.?\d*/g, '#')
        .replace(/[(){}[\]]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!titleGroups[norm]) titleGroups[norm] = [];
      titleGroups[norm].push(i);
    }

    const duplicates = Object.entries(titleGroups).filter(([, group]) => group.length > 1);
    if (duplicates.length > 0) {
      console.log('\n=== ED SEMANTIC DUPLICATES ===');
      for (const [norm, group] of duplicates) {
        console.log(`  DUPLICATE: "${norm}" (${group.length} cards: ${group.map(g => g.id).join(', ')})`);
      }
    }
    expect(duplicates.length).toBe(0);
  });
});
