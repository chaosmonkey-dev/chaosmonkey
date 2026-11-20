/**
 * Focused regression test for:
 * - pr-throughput (PR-specific observation window)
 * - change-failure-rate suppression when CFR is unavailable
 *
 * The Nov-19 audit found PR throughput divided all-time synced PRs by
 * deployment-observation weeks (github_by_period), overstating the rate by
 * ~30%. The denominator must be the PR created_at span from pr_by_period.
 *
 * Run with: ./node_modules/.bin/tsx src/lib/insights/final/generators/prThroughput.window.test.ts
 */

import type { CanonicalInsightInput } from '../types';

// Minimal browser globals — config/api.js reads window.location.origin at
// import time, so these must exist before the generator modules evaluate.
// (vitest's setupFiles does this elsewhere; this file runs standalone.)
(globalThis as any).window = { location: { origin: 'http://localhost', search: '' } };
(globalThis as any).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const { generatePrThroughput } = await import('./reviewMerge');
const { generateChangeFailureRateSpikeByIDE } = await import('./deployOperate');

let failures = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`PASS: ${message}`);
  }
}

function baseInput(overrides: Partial<CanonicalInsightInput> = {}): CanonicalInsightInput {
  return {
    sessionRows: [],
    githubSnapshot: {
      github_data_source: 'github_app',
      github_provenance: {
        source: 'github_app',
        historical_data_available: true,
        db_data_available: true,
        live_fetch_ok: false,
      },
      github_team_metrics: { total_prs: 100, merged_prs: 80 },
      deployment_metrics: {
        success_deployment_count: 10,
        failed_deployment_count: 2,
      },
    },
    ...overrides,
  } as CanonicalInsightInput;
}

// --- PR throughput window semantics ---

// 1. Empty prByPeriod -> null (fail closed, not deployment-week fallback)
{
  const insight = generatePrThroughput(baseInput({ prByPeriod: [] }));
  assert(insight === null, 'empty prByPeriod returns null (no deployment-week fallback)');
}

// 2. Missing prByPeriod -> null
{
  const insight = generatePrThroughput(baseInput());
  assert(insight === null, 'missing prByPeriod returns null');
}

// 3. Periods exist but all zero -> null
{
  const insight = generatePrThroughput(
    baseInput({ prByPeriod: [{ period: '2026-09-01', total_pr_count: 0 }] })
  );
  assert(insight === null, 'zero-activity periods return null');
}

// 4. Denominator is the PR created_at span, not period-count or deployment weeks.
//    10 weekly buckets spanning 10 calendar weeks, 100 PRs -> 10/week.
//    If it used deployment weeks (e.g. 5) it would report 20/week.
{
  const prByPeriod = [];
  for (let i = 0; i < 10; i++) {
    const d = new Date(Date.UTC(2026, 8, 1 + i * 7));
    prByPeriod.push({ period: d.toISOString().slice(0, 10), total_pr_count: 10, merged_pr_count: 8 });
  }
  const input = baseInput({ prByPeriod });
  // github_by_period deliberately absent — generator must not need it
  const insight = generatePrThroughput(input);
  assert(insight !== null, 'insight generated without deployment periods');
  assert(
    insight !== null && Math.abs((insight.metricValue as number) - 10) < 0.01,
    `throughput = 10.0/week over 10 created-weeks (got ${insight?.metricValue})`
  );
}

// 5. Long-lived PRs outside the trailing creation-complete window are
//    excluded from the numerator: bucket at 2026-06-01 is >90d before the
//    newest bucket (2026-10-12), so only the 90 in-window PRs count.
{
  const prByPeriod = [
    { period: '2026-06-01', total_pr_count: 10 },
    { period: '2026-10-12', total_pr_count: 90 },
  ];
  const insight = generatePrThroughput(baseInput({ prByPeriod }));
  const windowStart = Math.max(Date.UTC(2026, 9, 12) - 90 * 86400000, Date.UTC(2026, 5, 1));
  const expectedWeeks = Math.max(1, Math.round((Date.UTC(2026, 9, 12) + 7 * 86400000 - windowStart) / (7 * 86400000)));
  assert(
    insight !== null && Math.abs((insight.metricValue as number) - 90 / expectedWeeks) < 0.01,
    `pre-window PRs excluded: 90 in-window PRs / ${expectedWeeks} weeks (got ${insight?.metricValue}/wk)`
  );
}

// 6. Single partial week -> denominator clamps to 1 (no div-by-zero, no
//    fractional-week inflation).
{
  const insight = generatePrThroughput(
    baseInput({ prByPeriod: [{ period: '2026-11-10', total_pr_count: 7 }] })
  );
  assert(
    insight !== null && Math.abs((insight.metricValue as number) - 7) < 0.01,
    `single partial week uses denominator 1 (got ${insight?.metricValue})`
  );
}

// 7. Copy must not claim a deployment-observation window.
{
  const prByPeriod = [
    { period: '2026-09-01', total_pr_count: 20 },
    { period: '2026-09-08', total_pr_count: 20 },
  ];
  const insight = generatePrThroughput(baseInput({ prByPeriod }));
  const text = `${insight?.description} ${insight?.metricDefinition}`.toLowerCase();
  assert(!text.includes('deployment'), 'throughput copy does not reference deployment periods');
}

// --- buildDeliverySeries null preservation (PBT cross-surface fix) ---
// Unavailable evidence must stay null, never coerce to a measured-zero.
{
  const { buildDeliverySeries } = await import('../../../../services/metricsFacade');
  const rows = [{
    period: '2026-11-09',
    merged_pr_count: 208, total_pr_count: 210,
    deployment_count: 63, successful_deployment_count: 61, failed_deployment_count: 2,
    deploy_success_rate: 96.8, median_merge_cycle_hours: 31.2,
    release_count: null,           // permission-gated
    review_count: 829,
    pr_reopened_count: null,       // unfetched
    pr_review_cycles: null,        // unavailable — not a duplicate
    merge_rate: 88.5, merge_rate_mature: false,
    evidence_partial: false,
    count_authority: 'observed_rows',
  }];
  const s = buildDeliverySeries(rows as any, 'org', null);
  const p = s?.points?.[0] as any;
  assert(p?.release_count === null, 'release_count null preserved (no flat-zero releases)');
  assert(p?.pr_review_cycles === null, 'pr_review_cycles null preserved (not duplicated reviews)');
  assert(p?.review_count === 829, 'review_count measured value preserved');
  assert(p?.deployment_count === 63, 'deployment_count measured zero-able value preserved');
}

// --- CFR suppression ---

// 8. change_failure_rate = null (unavailable) -> generator returns null,
//    never fabricates a CFR from deployment failure counts.
{
  const input = baseInput();
  (input.githubSnapshot as any).deployment_metrics = {
    success_deployment_count: 859,
    failed_deployment_count: 128,
    change_failure_rate: null,
    change_failure_rate_unavailable: 'deployment_status failure does not establish production-impacting change failure',
    deployment_failure_rate: 13,
  };
  const insight = generateChangeFailureRateSpikeByIDE(input);
  assert(insight === null, 'CFR unavailable -> insight suppressed (not 0%, not deployment failure rate)');
}

// 9. change_failure_rate absent entirely -> also suppressed (missing != 0%).
{
  const input = baseInput();
  delete (input.githubSnapshot as any).deployment_metrics.change_failure_rate;
  const insight = generateChangeFailureRateSpikeByIDE(input);
  assert(insight === null, 'CFR field absent -> insight suppressed');
}

import { describe, it, expect } from 'vitest'

describe('prThroughput window + CFR suppression (standalone assertions)', () => {
  it('all assertions pass', () => {
    expect(failures).toBe(0)
  })
})
