/**
 * ============================================================================
 * CR-X P7: Local + Composite Acceptance Matrix
 * ============================================================================
 *
 * Run the engine against:
 *   - LOCAL_REAL
 *   - COMPOSITE_SUPER_ORG
 *   - all pilot-shape fixtures
 *
 * Produce a compact matrix:
 *   shape | findings | diagnostics | executive questions answered | top 5 |
 *   unexpected duplication | missing expected intelligence
 *
 * Do not browser-accept until this matrix is clean.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { generateFinalCanonicalInsights } from '../lib/insights/final';
import { addDerivedSessionFields } from '../lib/insights/final/dataAccess';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── Fixture loaders ────────────────────────────────────────────────────────

function loadFixture(name: string): any {
  const path = join(__dirname, '..', 'lib', 'insights', 'final', 'acceptanceCorpus', `${name}.json`);
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw);
}

function fixtureToInput(fixture: any) {
  const sessions = fixture.sessions.map((s: any) => ({ ...s }));
  addDerivedSessionFields(sessions);
  return {
    sessionRows: sessions,
    githubSnapshot: fixture.github || undefined,
    githubByPeriod: [],
    externalCostConfigs: fixture.costConfigs?.length > 0 ? fixture.costConfigs : null,
    granularity: 'week' as const,
  };
}

// ── Matrix row builder ─────────────────────────────────────────────────────

interface MatrixRow {
  fixture: string;
  findings: number;
  diagnostics: number;
  top5: string[];
  executiveQuestionsAnswered: number;
  duplicateStories: number;
  hasCostPIWithoutCost: boolean;
  hasDeliveryPIWithoutEvidence: boolean;
  passed: boolean;
  issues: string[];
}

async function runFixture(fixtureName: string): Promise<MatrixRow> {
  const fixture = loadFixture(fixtureName);
  const input = fixtureToInput(fixture);
  const insights = await generateFinalCanonicalInsights(input) as any[];

  const findings = insights.filter(i => !i.isDiagnostic);
  const diagnostics = insights.filter(i => i.isDiagnostic);
  const top = insights
    .filter(i => i.isTopInsightEligible)
    .sort((a, b) => (a.topInsightRank || 999) - (b.topInsightRank || 999))
    .slice(0, 5);

  // Check for duplicate stories
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
  const duplicateStories = Object.entries(titleGroups).filter(([, g]) => g.length > 1).length;

  // Executive questions answered
  const hasChange = findings.some(f => f.id.includes('recent-change') || f.id.includes('executive-workflow-mix'));
  const hasWorkflowDiff = findings.some(f => f.id.includes('active-coding-time-by-ide') || f.id.includes('cross_tool_behavior') || f.id.includes('workflow-repo-allocation'));
  const hasRepoAllocation = findings.some(f => f.id.includes('workflow-repo-allocation') || f.id.includes('repository-distribution') || f.id.includes('repo-conditioned-behavior'));
  const hasConcentration = findings.some(f => f.id.includes('concentration'));
  const hasCost = findings.some(f => f.id.includes('allocated-spend') || f.id.includes('unit_economics'));
  const hasDelivery = findings.some(f => f.cicdStage === 'review-merge' || f.cicdStage === 'deploy-operate');
  const hasInvestigation = findings.some(f => f.id.includes('executive-small-pr-workflow-optimization') || f.id.includes('deployment-failure-concentration') || f.id.includes('workflow-session-distribution'));

  // What evidence is missing? It may be answered by a diagnostic (sparse)
  // or by the truthful absence of diagnostics (full evidence).
  const isFullEvidence = (fixture.sessions?.length > 0)
    && (fixture.github)
    && (fixture.costConfigs?.length > 0);
  const hasEvidenceCompletenessAnswered = diagnostics.length > 0 || isFullEvidence;

  const executiveQuestionsAnswered = [hasChange, hasWorkflowDiff, hasRepoAllocation, hasConcentration, hasCost, hasDelivery, hasInvestigation, hasEvidenceCompletenessAnswered].filter(Boolean).length;

  // Cost PI without cost
  const hasCostPIWithoutCost = findings.some(f => f.id.includes('allocated-spend')) && !fixture.costConfigs?.length;
  // Delivery PI without evidence
  const hasDeliveryPIWithoutEvidence = findings.some(f => (f.cicdStage === 'review-merge' || f.cicdStage === 'deploy-operate') && !f.isDiagnostic) && !fixture.github;

  const issues: string[] = [];
  if (duplicateStories > 0) issues.push(`${duplicateStories} duplicate stories`);
  if (hasCostPIWithoutCost) issues.push('cost PI without cost config');
  if (hasDeliveryPIWithoutEvidence) issues.push('delivery PI without GitHub evidence');

  return {
    fixture: fixtureName,
    findings: findings.length,
    diagnostics: diagnostics.length,
    top5: top.map(t => `${t.topInsightRank}:${t.id}`),
    executiveQuestionsAnswered,
    duplicateStories,
    hasCostPIWithoutCost,
    hasDeliveryPIWithoutEvidence,
    passed: issues.length === 0,
    issues,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CR-X P7: Local + Composite Acceptance Matrix', () => {
  const fixtures = ['local-real', 'ed-real', 'composite-super-org'];
  const matrix: MatrixRow[] = [];

  for (const fixtureName of fixtures) {
    it(`${fixtureName}: produces clean acceptance matrix row`, async () => {
      const row = await runFixture(fixtureName);
      matrix.push(row);

      console.log(`\n=== ${fixtureName} ===`);
      console.log(`  findings: ${row.findings}`);
      console.log(`  diagnostics: ${row.diagnostics}`);
      console.log(`  top5: ${row.top5.join(' | ')}`);
      console.log(`  executive questions answered: ${row.executiveQuestionsAnswered}/8`);
      console.log(`  duplicate stories: ${row.duplicateStories}`);
      console.log(`  issues: ${row.issues.length === 0 ? 'NONE' : row.issues.join(', ')}`);

      // No duplicate stories allowed
      expect(row.duplicateStories).toBe(0);

      // No cost PI without cost config
      expect(row.hasCostPIWithoutCost).toBe(false);

      // No delivery PI without GitHub evidence
      expect(row.hasDeliveryPIWithoutEvidence).toBe(false);
    }, 120000);
  }

  it('prints compact acceptance matrix', () => {
    console.log('\n========== CR-X PI ACCEPTANCE MATRIX ==========');
    console.log('fixture | findings | diag | exec_q | top5 | issues');
    console.log('---');
    for (const row of matrix) {
      console.log(`${row.fixture} | ${row.findings} | ${row.diagnostics} | ${row.executiveQuestionsAnswered}/8 | ${row.top5.length} | ${row.issues.length === 0 ? 'CLEAN' : row.issues.join(', ')}`);
    }
    console.log('========== END MATRIX ==========\n');

    // All rows must be clean
    const dirtyRows = matrix.filter(r => !r.passed);
    expect(dirtyRows.length).toBe(0);
  });
});
