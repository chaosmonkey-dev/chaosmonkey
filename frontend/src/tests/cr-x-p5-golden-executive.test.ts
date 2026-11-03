/**
 * ============================================================================
 * CR-X P5: Golden Executive Expectations
 * ============================================================================
 *
 * Do NOT assert exact finding counts as the main contract.
 * Assert executive questions instead:
 *
 *   WHAT CHANGED?
 *   WHAT WORKFLOWS DIFFER?
 *   WHERE ARE TOOLS BEING USED DIFFERENTLY?
 *   WHAT BEHAVIOR DIFFERS BY REPO?
 *   WHAT IS CONCENTRATED?
 *   WHAT COSTS DIFFER?
 *   WHAT DELIVERY BOTTLENECK EXISTS?
 *   WHAT SHOULD I INVESTIGATE?
 *   WHAT EVIDENCE IS STILL MISSING?
 *
 * For mature/high-evidence fixtures, require coverage of multiple distinct
 * questions when supporting evidence exists.
 *
 * For early/low-evidence fixtures, require truthful reduced coverage rather
 * than fake completeness.
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

// ── Executive question detection ──────────────────────────────────────────

interface ExecutiveQuestionResult {
  question: string;
  answered: boolean;
  findingIds: string[];
}

function detectExecutiveQuestions(insights: any[]): ExecutiveQuestionResult[] {
  const findings = insights.filter(i => !i.isDiagnostic);
  const diags = insights.filter(i => i.isDiagnostic);

  return [
    {
      question: 'WHAT CHANGED?',
      answered: findings.some(f => f.id.includes('recent-change') || f.id.includes('executive-workflow-mix')),
      findingIds: findings.filter(f => f.id.includes('recent-change') || f.id.includes('executive-workflow-mix')).map(f => f.id),
    },
    {
      question: 'WHAT WORKFLOWS DIFFER?',
      answered: findings.some(f =>
        f.id.includes('active-coding-time-by-ide') ||
        f.id.includes('cross_tool_behavior') ||
        f.id.includes('workflow-repo-allocation')
      ),
      findingIds: findings.filter(f =>
        f.id.includes('active-coding-time-by-ide') ||
        f.id.includes('cross_tool_behavior') ||
        f.id.includes('workflow-repo-allocation')
      ).map(f => f.id),
    },
    {
      question: 'WHERE ARE TOOLS BEING USED DIFFERENTLY?',
      answered: findings.some(f =>
        f.id.includes('workflow-repo-allocation') ||
        f.id.includes('repository-distribution') ||
        f.id.includes('repo-conditioned-behavior')
      ),
      findingIds: findings.filter(f =>
        f.id.includes('workflow-repo-allocation') ||
        f.id.includes('repository-distribution') ||
        f.id.includes('repo-conditioned-behavior')
      ).map(f => f.id),
    },
    {
      question: 'WHAT BEHAVIOR DIFFERS BY REPO?',
      answered: findings.some(f => f.id.includes('repo-conditioned-behavior')),
      findingIds: findings.filter(f => f.id.includes('repo-conditioned-behavior')).map(f => f.id),
    },
    {
      question: 'WHAT IS CONCENTRATED?',
      answered: findings.some(f =>
        f.id.includes('repository-concentration') ||
        f.id.includes('concentration') ||
        f.id.includes('deployment-failure-concentration')
      ),
      findingIds: findings.filter(f =>
        f.id.includes('repository-concentration') ||
        f.id.includes('concentration') ||
        f.id.includes('deployment-failure-concentration')
      ).map(f => f.id),
    },
    {
      question: 'WHAT COSTS DIFFER?',
      answered: findings.some(f => f.id.includes('allocated-spend') || f.id.includes('unit_economics')),
      findingIds: findings.filter(f => f.id.includes('allocated-spend') || f.id.includes('unit_economics')).map(f => f.id),
    },
    {
      question: 'WHAT DELIVERY BOTTLENECK EXISTS?',
      answered: findings.some(f =>
        f.cicdStage === 'review-merge' || f.cicdStage === 'deploy-operate'
      ),
      findingIds: findings.filter(f =>
        f.cicdStage === 'review-merge' || f.cicdStage === 'deploy-operate'
      ).map(f => f.id),
    },
    {
      question: 'WHAT SHOULD I INVESTIGATE?',
      answered: findings.some(f =>
        f.id.includes('executive-small-pr-workflow-optimization') ||
        f.id.includes('deployment-failure-concentration') ||
        f.id.includes('workflow-session-distribution')
      ),
      findingIds: findings.filter(f =>
        f.id.includes('executive-small-pr-workflow-optimization') ||
        f.id.includes('deployment-failure-concentration') ||
        f.id.includes('workflow-session-distribution')
      ).map(f => f.id),
    },
    {
      question: 'WHAT EVIDENCE IS STILL MISSING?',
      answered: diags.length > 0,
      findingIds: diags.map(d => d.id),
    },
  ];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CR-X P5: Golden Executive Expectations', () => {
  it('LOCAL_REAL: mature/high-evidence fixture covers multiple executive questions', async () => {
    const fixture = loadFixture('local-real');
    const input = fixtureToInput(fixture);
    const insights = await generateFinalCanonicalInsights(input) as any[];
    const questions = detectExecutiveQuestions(insights);

    console.log('\n=== LOCAL_REAL EXECUTIVE QUESTION COVERAGE ===');
    for (const q of questions) {
      console.log(`  ${q.question} — ${q.answered ? 'YES' : 'NO'} ${q.findingIds.length > 0 ? '(' + q.findingIds.join(', ') + ')' : ''}`);
    }

    // Mature fixture should answer multiple distinct questions
    const answeredCount = questions.filter(q => q.answered).length;
    console.log(`\n  Answered: ${answeredCount}/${questions.length}`);

    // For mature/high-evidence fixtures, require coverage of multiple distinct questions
    expect(answeredCount).toBeGreaterThanOrEqual(5);
  }, 120000);

  it('ED_REAL: low-evidence fixture has truthful reduced coverage', async () => {
    const fixture = loadFixture('ed-real');
    const input = fixtureToInput(fixture);
    const insights = await generateFinalCanonicalInsights(input) as any[];
    const questions = detectExecutiveQuestions(insights);

    console.log('\n=== ED_REAL EXECUTIVE QUESTION COVERAGE ===');
    for (const q of questions) {
      console.log(`  ${q.question} — ${q.answered ? 'YES' : 'NO'} ${q.findingIds.length > 0 ? '(' + q.findingIds.join(', ') + ')' : ''}`);
    }

    const answeredCount = questions.filter(q => q.answered).length;
    console.log(`\n  Answered: ${answeredCount}/${questions.length}`);

    // Low-evidence fixture should NOT answer all questions (truthful reduced coverage)
    expect(answeredCount).toBeLessThan(questions.length);

    // But should still answer SOME questions (useful intelligence)
    expect(answeredCount).toBeGreaterThan(0);

    // Must answer WHAT CHANGED? (Ed has temporal data)
    const whatChanged = questions.find(q => q.question === 'WHAT CHANGED?');
    expect(whatChanged?.answered).toBe(true);

    // Must answer WHAT EVIDENCE IS MISSING? (truthful about gaps)
    const missingEvidence = questions.find(q => q.question === 'WHAT EVIDENCE IS STILL MISSING?');
    expect(missingEvidence?.answered).toBe(true);
  }, 120000);

  it('COMPOSITE_SUPER_ORG: full-evidence fixture covers most executive questions', async () => {
    let fixture: any;
    try {
      fixture = loadFixture('composite-super-org');
    } catch {
      console.log('  COMPOSITE_SUPER_ORG fixture not yet available — skipping');
      return;
    }

    const input = fixtureToInput(fixture);
    const insights = await generateFinalCanonicalInsights(input) as any[];
    const questions = detectExecutiveQuestions(insights);

    console.log('\n=== COMPOSITE_SUPER_ORG EXECUTIVE QUESTION COVERAGE ===');
    for (const q of questions) {
      console.log(`  ${q.question} — ${q.answered ? 'YES' : 'NO'} ${q.findingIds.length > 0 ? '(' + q.findingIds.join(', ') + ')' : ''}`);
    }

    const answeredCount = questions.filter(q => q.answered).length;
    console.log(`\n  Answered: ${answeredCount}/${questions.length}`);

    // Full-evidence fixture should answer most questions
    expect(answeredCount).toBeGreaterThanOrEqual(6);
  }, 120000);
});
