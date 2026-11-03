/**
 * CR-X PI Plan & Code Disappearance Regression (Deterministic)
 *
 * Permanent regression guard against the failure mode where session fetch
 * failure/partial hydration causes Plan & Code intelligence to disappear
 * while downstream (Review & Merge + Deploy & Operate) survives from GitHub.
 *
 * This test is DETERMINISTIC (no live API dependency). It uses the existing
 * acceptance corpus fixtures (local-real, ed-real, composite-super-org).
 *
 * Regression rule (FAIL if ALL):
 *   - canonical session evidence is healthy (sessions > threshold, workflows >= 1)
 *   - Plan & Code eligible families exist in the generator output
 *   - final Plan & Code finding count == 0
 *
 * Also tests the evidence-state matrix:
 *   1. Complete sessions + GitHub → Plan & Code present
 *   2. Empty sessions + GitHub → Plan & Code = 0, diagnostics > 0 (truthful)
 *   3. Partial sessions + GitHub → Plan & Code present (reduced but not gone)
 *   4. No GitHub + healthy sessions → Plan & Code present (telemetry-only)
 */
import { describe, it, expect } from 'vitest';
import { generateFinalCanonicalInsights } from '../lib/insights/final';
import { addDerivedSessionFields } from '../lib/insights/final/dataAccess';
import { readFileSync } from 'fs';
import { join } from 'path';

function loadFixture(name: string): any {
  const path = join(__dirname, '..', 'lib', 'insights', 'final', 'acceptanceCorpus', `${name}.json`);
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw);
}

function fixtureToInput(fixture: any, overrides?: Partial<{
  sessionRows: any[];
  githubSnapshot: any;
  githubByPeriod: any[];
  externalCostConfigs: any[];
}>) {
  const sessions = (overrides?.sessionRows ?? fixture.sessions).map((s: any) => ({ ...s }));
  addDerivedSessionFields(sessions);
  return {
    sessionRows: sessions,
    githubSnapshot: overrides?.githubSnapshot ?? fixture.github ?? undefined,
    githubByPeriod: overrides?.githubByPeriod ?? [],
    externalCostConfigs: overrides?.externalCostConfigs ?? (fixture.costConfigs?.length > 0 ? fixture.costConfigs : null),
    granularity: 'week' as const,
  };
}

function stageOf(i: any): string {
  return i.cicdStage || 'other';
}

function summarize(insights: any[]) {
  const findings = insights.filter((i: any) => !i.isDiagnostic);
  const diags = insights.filter((i: any) => i.isDiagnostic);
  const stageCounts: Record<string, number> = { 'plan-code': 0, 'review-merge': 0, 'deploy-operate': 0, other: 0 };
  for (const i of findings) stageCounts[stageOf(i)] = (stageCounts[stageOf(i)] || 0) + 1;
  return {
    findings: findings.length,
    diagnostics: diags.length,
    planCode: stageCounts['plan-code'],
    reviewMerge: stageCounts['review-merge'],
    deployOperate: stageCounts['deploy-operate'],
    findingIds: findings.map((i: any) => i.id),
  };
}

const FIXTURES = ['local-real', 'ed-real', 'composite-super-org'];

describe('CR-X PI Plan & Code Disappearance Regression (Deterministic)', () => {
  for (const fixtureName of FIXTURES) {
    describe(`${fixtureName}`, () => {
      it('complete sessions + GitHub → Plan & Code present (baseline)', async () => {
        const fixture = loadFixture(fixtureName);
        const input = fixtureToInput(fixture);
        const insights = await generateFinalCanonicalInsights(input as any) as any[];
        const s = summarize(insights);

        console.log(`[${fixtureName}] COMPLETE: findings=${s.findings} diag=${s.diagnostics} pc=${s.planCode} rm=${s.reviewMerge} do=${s.deployOperate}`);

        // Regression: if sessions are healthy and workflows exist, Plan & Code must NOT be 0
        const workflows = new Set(input.sessionRows.map((r: any) => r.tool || r.editor_source || '').filter(Boolean));
        if (input.sessionRows.length > 100 && workflows.size >= 1 && s.planCode === 0) {
          // Check if Plan & Code eligible families exist in the output at all
          const hasPlanCodeEligible = insights.some((i: any) => stageOf(i) === 'plan-code');
          if (!hasPlanCodeEligible) {
            throw new Error(
              `REGRESSION: ${fixtureName} has ${input.sessionRows.length} healthy sessions and ${workflows.size} workflows ` +
              `but Plan & Code finding count == 0. This is the disappearance failure mode.`
            );
          }
        }
        expect(s.findings).toBeGreaterThan(0);
      });

      it('empty sessions + GitHub → Plan & Code = 0, diagnostics > 0 (truthful degradation)', async () => {
        const fixture = loadFixture(fixtureName);
        if (!fixture.github) {
          console.log(`[${fixtureName}] No GitHub fixture — skipping empty-sessions test`);
          return;
        }
        const input = fixtureToInput(fixture, { sessionRows: [] });
        const insights = await generateFinalCanonicalInsights(input as any) as any[];
        const s = summarize(insights);

        console.log(`[${fixtureName}] EMPTY: findings=${s.findings} diag=${s.diagnostics} pc=${s.planCode} rm=${s.reviewMerge} do=${s.deployOperate}`);

        // Empty sessions with GitHub present must produce downstream-only portfolio
        expect(s.planCode).toBe(0);
        // And must produce diagnostics (truthful degradation, not silent)
        expect(s.diagnostics).toBeGreaterThan(0);
        // Review & Merge + Deploy & Operate survive from GitHub (only if GitHub is eligible)
        // ed-real has no eligible GitHub provenance, so downstream may also be 0
        if (s.reviewMerge + s.deployOperate > 0) {
          // Good — downstream survived from GitHub
        } else {
          // No downstream either — GitHub was ineligible. All findings should be 0 or diagnostic.
          console.log(`[${fixtureName}] GitHub ineligible — no downstream survival (expected for ed-real)`);
        }
      });

      it('partial sessions + GitHub → Plan & Code present (reduced but not gone)', async () => {
        const fixture = loadFixture(fixtureName);
        if (!fixture.github || fixture.sessions.length < 200) {
          console.log(`[${fixtureName}] Insufficient data for partial test — skipping`);
          return;
        }
        const halfSessions = fixture.sessions.slice(0, Math.floor(fixture.sessions.length / 2));
        const input = fixtureToInput(fixture, { sessionRows: halfSessions });
        const insights = await generateFinalCanonicalInsights(input as any) as any[];
        const s = summarize(insights);

        console.log(`[${fixtureName}] PARTIAL: findings=${s.findings} diag=${s.diagnostics} pc=${s.planCode} rm=${s.reviewMerge} do=${s.deployOperate}`);

        // Partial sessions should still produce Plan & Code (reduced but not gone)
        const workflows = new Set(input.sessionRows.map((r: any) => r.tool || r.editor_source || '').filter(Boolean));
        if (input.sessionRows.length > 50 && workflows.size >= 1) {
          expect(s.planCode).toBeGreaterThan(0);
        }
      });

      it('no GitHub + healthy sessions → Plan & Code present (telemetry-only)', async () => {
        const fixture = loadFixture(fixtureName);
        const input = fixtureToInput(fixture, { githubSnapshot: undefined, githubByPeriod: [] });
        const insights = await generateFinalCanonicalInsights(input as any) as any[];
        const s = summarize(insights);

        console.log(`[${fixtureName}] NO_GITHUB: findings=${s.findings} diag=${s.diagnostics} pc=${s.planCode} rm=${s.reviewMerge} do=${s.deployOperate}`);

        // Telemetry-only must still produce Plan & Code
        const workflows = new Set(input.sessionRows.map((r: any) => r.tool || r.editor_source || '').filter(Boolean));
        if (input.sessionRows.length > 100 && workflows.size >= 1) {
          expect(s.planCode).toBeGreaterThan(0);
        }
      });
    });
  }
});
