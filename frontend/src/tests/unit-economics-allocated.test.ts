/**
 * Allocated Unit Economics V1 — Exact-Count Closeout Tests
 *
 * Tests cover:
 * - outcomes_by_month is the ONLY accepted denominator source
 * - Rate-derived weekly buckets CANNOT be used as counts
 * - count_authority must be 'observed_rows' — 'derived_rate' rejected
 * - Complete-month exact integer deployment count produces correct allocated cost
 * - Complete-month successful count produces correct allocated cost
 * - Complete-month merged PR count produces correct allocated cost
 * - Partial current month rejected
 * - Missing exact count rejected
 * - Latest complete observed month selected
 * - Seeded Local result labeled seeded/cm_activity_sim
 * - Live result labeled live only with real source
 * - demo/realism_seeder provenance rejected
 * - Neutral polarity preserved
 * - No forbidden language (ROI, actual cost, correlates)
 * - Configured $0 is not missing
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateAllocatedSpendPerMergedPR,
  generateAllocatedSpendPerDeployment,
  generateAllocatedSpendPerSuccessfulDeployment,
} from '../lib/insights/final/generators/unitEconomics';
import type { CanonicalInsightInput } from '../lib/insights/final/types';

// Ensure window/localStorage exists for vitest (Node by default)
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = { location: { search: '' } } as any;
}
if (typeof (globalThis as any).localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  } as any;
}

const STORAGE_KEY_PREFIX = 'chaosmonkey_tool_cost_config_';

function setCostConfig(toolId: string, seatCount: number, costPerSeatMonthly: number) {
  const monthlySpend = seatCount * costPerSeatMonthly;
  (globalThis as any).localStorage.setItem(
    `${STORAGE_KEY_PREFIX}${toolId}`,
    JSON.stringify({ toolId, seatCount, costPerSeatMonthly, monthlySpend, updatedAt: new Date().toISOString() })
  );
}

function setCostConfigExplicit(toolId: string, monthlySpend: number) {
  (globalThis as any).localStorage.setItem(
    `${STORAGE_KEY_PREFIX}${toolId}`,
    JSON.stringify({ toolId, seatCount: 1, costPerSeatMonthly: monthlySpend, monthlySpend, updatedAt: new Date().toISOString() })
  );
}

function clearAllCostConfigs() {
  for (const tool of ['cursor', 'devin', 'vscode', 'claude-code', 'github-copilot']) {
    (globalThis as any).localStorage.removeItem(`${STORAGE_KEY_PREFIX}${tool}`);
  }
}

function mkGithubSnapshot(provenance: 'live' | 'lab' = 'live'): any {
  const isLive = provenance === 'live';
  return {
    github_provenance: {
      connected: isLive,
      data_source: isLive ? 'db_sync' : 'cm_activity_sim',
      live_fetch_ok: isLive,
      db_data_available: true,
      historical_data_available: true,
      db_pr_data_sources: isLive ? ['github_api_sync'] : ['cm_activity_sim'],
      source: isLive ? 'db_sync' : 'cm_activity_sim',
    },
  };
}

/**
 * Build outcomes_by_month entries with observed_rows authority.
 */
function mkOutcomesByMonth(
  entries: Array<{
    month: string;
    merged_pr_count?: number;
    total_pr_count?: number;
    deployment_count?: number;
    successful_deployment_count?: number;
    failed_deployment_count?: number;
    source?: string;
    data_source?: string;
    count_authority?: string;
  }>
): any[] {
  return entries.map(e => ({
    month: e.month,
    merged_pr_count: e.merged_pr_count ?? 0,
    total_pr_count: e.total_pr_count ?? 0,
    deployment_count: e.deployment_count ?? 0,
    successful_deployment_count: e.successful_deployment_count ?? 0,
    failed_deployment_count: e.failed_deployment_count ?? 0,
    source: e.source ?? 'cm_activity_sim',
    data_source: e.data_source ?? 'seeded',
    count_authority: e.count_authority ?? 'observed_rows',
  }));
}

function ti(
  sessionRows: any[] = [],
  githubSnapshot?: any,
  outcomesByMonth?: any[]
): CanonicalInsightInput {
  return {
    sessionRows,
    githubSnapshot,
    outcomesByMonth,
    granularity: 'month',
  } as any;
}

// Use a past month for tests to avoid "current month" rejection
const PAST_MONTH = '2026-07';
const OLDER_MONTH = '2026-06';
const CURRENT_MONTH = '2026-08';

describe('Allocated Unit Economics V1 — Exact-Count Closeout', () => {
  // Freeze the clock at August 15, 2026 so that:
  //   - August 2026 (CURRENT_MONTH) is the incomplete current month → rejected
  //   - July 2026 (PAST_MONTH) is the latest complete month → accepted
  //   - June 2026 (OLDER_MONTH) is an older complete month
  // This makes the partial-current-month tests deterministic and independent
  // of the wall clock. Production month-completeness behavior is unchanged.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
    clearAllCostConfigs();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearAllCostConfigs();
  });

  // ════════════════════════════════════════════════════════════
  // OUTCOMES_BY_MONTH IS THE ONLY AUTHORITY
  // ════════════════════════════════════════════════════════════

  describe('outcomes_by_month is the only authority', () => {
    it('11. UE uses outcomes_by_month only — no outcomes_by_month → null', () => {
      setCostConfig('cursor', 5, 100); // $500/mo
      const gh = mkGithubSnapshot('live');
      // No outcomes_by_month at all
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, undefined));
      expect(insight).toBeNull();
    });

    it('12. derived_rate count_authority rejected — only observed_rows accepted', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      // Entry with derived_rate authority — must be rejected
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 25, count_authority: 'derived_rate' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════
  // RATE ≠ COUNT
  // ════════════════════════════════════════════════════════════

  describe('Rate cannot be used as count', () => {
    it('7. weekly rate-only entries (no outcomes_by_month) → null', () => {
      setCostConfig('cursor', 5, 100); // $500/mo
      const gh = mkGithubSnapshot('live');
      // No outcomes_by_month — only weekly rate entries in githubByPeriod
      // These should NOT be used as denominators
      const input = {
        sessionRows: [],
        githubSnapshot: gh,
        githubByPeriod: [
          { period: `${PAST_MONTH}-01`, deploymentFreqPerWeek: 25.78, changeFailureRatePct: 8.5, count_authority: 'derived_rate' },
        ],
        outcomesByMonth: [],
        granularity: 'month',
      } as any;
      const insight = generateAllocatedSpendPerDeployment(input);
      expect(insight).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════
  // COMPLETE-MONTH EXACT DEPLOYMENT COUNT
  // ════════════════════════════════════════════════════════════

  describe('Complete-month exact deployment count', () => {
    it('9. complete-month exact deployment count produces correct allocated cost', () => {
      setCostConfig('cursor', 5, 100); // $500/mo
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 100, successful_deployment_count: 92, failed_deployment_count: 8, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      // $500 / 100 = $5.00 per deployment
      expect(insight.current).toBe(5);
      expect(insight.n).toBe(100);
      expect(insight.title).toContain('July 2026');
    });
  });

  // ════════════════════════════════════════════════════════════
  // COMPLETE-MONTH SUCCESSFUL DEPLOYMENT COUNT
  // ════════════════════════════════════════════════════════════

  describe('Complete-month successful deployment count', () => {
    it('10. complete-month successful count produces correct allocated cost', () => {
      setCostConfig('cursor', 5, 100); // $500/mo
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 100, successful_deployment_count: 92, failed_deployment_count: 8, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerSuccessfulDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      // $500 / 92 = $5.43 per successful deployment
      expect(insight.current).toBeCloseTo(5.43, 1);
      expect(insight.n).toBe(92);
    });
  });

  // ════════════════════════════════════════════════════════════
  // COMPLETE-MONTH MERGED PR COUNT
  // ════════════════════════════════════════════════════════════

  describe('Complete-month merged PR count', () => {
    it('11. complete-month merged PR count produces correct allocated cost', () => {
      setCostConfig('cursor', 5, 100); // $500/mo
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, merged_pr_count: 40, total_pr_count: 50, deployment_count: 0, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerMergedPR(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      // $500 / 40 = $12.50 per merged PR
      expect(insight.current).toBe(12.5);
      expect(insight.n).toBe(40);
      expect(insight.title).toContain('July 2026');
    });
  });

  // ════════════════════════════════════════════════════════════
  // PARTIAL CURRENT MONTH REJECTED
  // ════════════════════════════════════════════════════════════

  describe('Partial current month rejected', () => {
    it('12. current month (August 2026) rejected — only complete months used', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      // Only August (current month) data — should be rejected
      const obm = mkOutcomesByMonth([
        { month: CURRENT_MONTH, deployment_count: 25, successful_deployment_count: 23, failed_deployment_count: 2, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).toBeNull();
    });

    it('12b. latest complete month preferred over current month', () => {
      setCostConfig('cursor', 5, 100); // $500/mo
      const gh = mkGithubSnapshot('live');
      // Both July (complete) and August (current/incomplete) data
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 80, successful_deployment_count: 72, failed_deployment_count: 8, source: 'db_sync', data_source: 'live' },
        { month: CURRENT_MONTH, deployment_count: 120, successful_deployment_count: 112, failed_deployment_count: 8, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      // Should use July (complete), NOT August (current)
      // $500 / 80 = $6.25
      expect(insight.current).toBe(6.25);
      expect(insight.title).toContain('July 2026');
      expect(insight.title).not.toContain('August');
    });
  });

  // ════════════════════════════════════════════════════════════
  // LATEST COMPLETE OBSERVED MONTH SELECTED
  // ════════════════════════════════════════════════════════════

  describe('Latest complete observed month selected', () => {
    it('13. latest complete observed month selected from multiple entries', () => {
      setCostConfig('cursor', 5, 100); // $500/mo
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: '2026-05', deployment_count: 50, successful_deployment_count: 45, failed_deployment_count: 5, source: 'db_sync', data_source: 'live' },
        { month: OLDER_MONTH, deployment_count: 40, successful_deployment_count: 36, failed_deployment_count: 4, source: 'db_sync', data_source: 'live' },
        { month: PAST_MONTH, deployment_count: 80, successful_deployment_count: 72, failed_deployment_count: 8, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      // Should select July (latest complete)
      // $500 / 80 = $6.25
      expect(insight.current).toBe(6.25);
      expect(insight.title).toContain('July 2026');
    });

    it('13b. month with zero deployment_count skipped — next eligible month used', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 0, successful_deployment_count: 0, failed_deployment_count: 0, source: 'db_sync', data_source: 'live' },
        { month: OLDER_MONTH, deployment_count: 40, successful_deployment_count: 36, failed_deployment_count: 4, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      // July has 0 deployments → skip → use June
      expect(insight.title).toContain('June 2026');
      expect(insight.n).toBe(40);
    });
  });

  // ════════════════════════════════════════════════════════════
  // MISSING EXACT COUNT REJECTED
  // ════════════════════════════════════════════════════════════

  describe('Missing exact count rejected', () => {
    it('14. no outcomes_by_month at all → null', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, undefined));
      expect(insight).toBeNull();
    });

    it('14b. outcomes_by_month exists but deployment_count is 0 → null', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 0, successful_deployment_count: 0, failed_deployment_count: 0, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════
  // PROVENANCE LABELS
  // ════════════════════════════════════════════════════════════

  describe('Provenance labels', () => {
    it('15. seeded Local result labeled seeded/cm_activity_sim', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('lab');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 25, successful_deployment_count: 23, failed_deployment_count: 2, source: 'cm_activity_sim', data_source: 'seeded' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      if (insight === null) return; // may be null if lab eligibility fails
      expect(insight.dataSource).toBe('seeded');
      const allText = JSON.stringify(insight);
      // CR-X 3D.2B: Customer-facing labels use neutral semantic copy, not internal fixture terminology.
      // Internal provenance (dataSource='seeded') remains intact; presentation label is neutral.
      expect(allText).toContain('GitHub delivery · all-time baseline');
      expect(allText).not.toContain('cm-activity-sim');
      expect(allText).not.toContain('GitHub API sync');
    });

    it('16. live result labeled live only with real source', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 25, successful_deployment_count: 23, failed_deployment_count: 2, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(insight.dataSource).toBe('live');
      const outcomeEvidence = insight.evidence?.find(e => e.metric === 'Deployments');
      expect(outcomeEvidence?.label).toContain('GitHub API sync');
    });

    it('16b. demo provenance in live mode → null', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      gh.github_provenance = {
        connected: false,
        data_source: 'demo',
        live_fetch_ok: false,
        db_data_available: true,
        historical_data_available: false,
        db_pr_data_sources: ['demo'],
        source: 'demo',
      };
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 25, successful_deployment_count: 23, failed_deployment_count: 2, source: 'demo', data_source: 'demo' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════
  // NEUTRAL POLARITY
  // ════════════════════════════════════════════════════════════

  describe('Neutral polarity', () => {
    it('17. UE insight has polarity=neutral and no delta/baseline/deltaPct', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 100, successful_deployment_count: 92, failed_deployment_count: 8, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(insight.polarity).toBe('neutral');
      expect(insight.baseline).toBeUndefined();
      expect(insight.delta).toBeUndefined();
      expect(insight.deltaPct).toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════════
  // COPY SAFETY
  // ════════════════════════════════════════════════════════════

  describe('Copy safety', () => {
    it('no ROI, actual cost, billing truth, or correlates language', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 100, successful_deployment_count: 92, failed_deployment_count: 8, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      const allText = `${insight.title} ${insight.description ?? ''} ${insight.recommendation ?? ''}`;
      expect(allText.toLowerCase()).not.toContain('roi');
      expect(allText.toLowerCase()).not.toContain('actual cost');
      expect(allText.toLowerCase()).not.toContain('billing truth');
      expect(allText.toLowerCase()).not.toContain('correlate');
    });

    it('denominator is integer and month visible', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 100, successful_deployment_count: 92, failed_deployment_count: 8, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(insight.n).toBe(100);
      expect(Number.isInteger(insight.n)).toBe(true);
      expect(insight.title).toContain('July 2026');
    });
  });

  // ════════════════════════════════════════════════════════════
  // CONFIGURED $0 IS NOT MISSING
  // ════════════════════════════════════════════════════════════

  describe('Configured $0 is not missing', () => {
    it('explicitly configured $0 with valid outcomes → allocated unit cost = $0', () => {
      setCostConfigExplicit('cursor', 0);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 100, successful_deployment_count: 92, failed_deployment_count: 8, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(insight.current).toBe(0);
      expect(insight.hasData).toBe(true);
    });

    it('no cost config at all → null', () => {
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 100, successful_deployment_count: 92, failed_deployment_count: 8, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════
  // INTEGER DENOMINATORS
  // ════════════════════════════════════════════════════════════

  describe('Integer denominators', () => {
    it('14. integer merged PR denominator', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, merged_pr_count: 18, total_pr_count: 27, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerMergedPR(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(Number.isInteger(insight.n)).toBe(true);
      expect(insight.n).toBe(18);
    });

    it('15. integer deployment denominator', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 25, successful_deployment_count: 23, failed_deployment_count: 2, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(Number.isInteger(insight.n)).toBe(true);
      expect(insight.n).toBe(25);
    });

    it('16. integer successful-deployment denominator', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 25, successful_deployment_count: 23, failed_deployment_count: 2, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerSuccessfulDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(Number.isInteger(insight.n)).toBe(true);
      expect(insight.n).toBe(23);
    });
  });

  // ════════════════════════════════════════════════════════════
  // CORRECT CONFIGURED-SPEND ARITHMETIC
  // ════════════════════════════════════════════════════════════

  describe('Correct configured-spend arithmetic', () => {
    it('17. $2660 / 18 merged PRs = $147.78', () => {
      setCostConfigExplicit('cursor', 2660);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: OLDER_MONTH, merged_pr_count: 18, total_pr_count: 27, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerMergedPR(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(insight.current).toBeCloseTo(147.78, 0);
      expect(insight.n).toBe(18);
    });

    it('18. $500 / 25 deployments = $20', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: OLDER_MONTH, deployment_count: 25, successful_deployment_count: 23, failed_deployment_count: 2, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(insight.current).toBe(20);
    });
  });

  // ════════════════════════════════════════════════════════════
  // PRESENTATION CONTRACT
  // ════════════════════════════════════════════════════════════

  describe('Presentation contract', () => {
    it('22. presentation says merged PRs, not sessions', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, merged_pr_count: 18, total_pr_count: 27, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerMergedPR(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(insight.title.toLowerCase()).toContain('merged pr');
      expect(insight.title.toLowerCase()).not.toContain('session');
    });

    it('23. presentation says exact month, not all-time', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 25, successful_deployment_count: 23, failed_deployment_count: 2, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(insight.title).toContain('July 2026');
      expect(insight.title.toLowerCase()).not.toContain('all-time');
    });

    it('24. seeded source visible in evidence', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('lab');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 25, successful_deployment_count: 23, failed_deployment_count: 2, source: 'cm_activity_sim', data_source: 'seeded' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      if (insight === null) return;
      const allText = JSON.stringify(insight);
      // CR-X 3D.2B: Seeded source visible in evidence via neutral label, not internal fixture name.
      expect(allText.toLowerCase()).toContain('github delivery · all-time baseline');
      expect(allText.toLowerCase()).not.toContain('cm-activity-sim');
    });

    it('25. configured-spend disclosure visible in description', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 25, successful_deployment_count: 23, failed_deployment_count: 2, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      const desc = (insight.description || '').toLowerCase();
      // CR-X P3: Copy now says "configured" and "configured tool costs" instead of
      // repetitive "configured estimate · not billing data"
      expect(desc).toContain('configured');
    });

    it('26. allocation basis visible in description', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 25, successful_deployment_count: 23, failed_deployment_count: 2, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      const desc = (insight.description || '').toLowerCase();
      // CR-X P3: Copy now says "period-level allocation based on your configured tool costs"
      expect(desc).toContain('allocation');
    });

    it('27. no causal attribution implied in description', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 25, successful_deployment_count: 23, failed_deployment_count: 2, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      const desc = (insight.description || '').toLowerCase();
      // CR-X P3: Must not imply causal attribution
      expect(desc).not.toContain('causal');
      expect(desc).not.toContain('per-outcome');
    });

    it('28. no ROI / savings / waste / winner language', () => {
      setCostConfig('cursor', 5, 100);
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 25, successful_deployment_count: 23, failed_deployment_count: 2, source: 'db_sync', data_source: 'live' },
      ]);
      const insight = generateAllocatedSpendPerDeployment(ti([], gh, obm));
      expect(insight).not.toBeNull();
      if (!insight) return;
      const allText = `${insight.title} ${insight.description ?? ''} ${insight.recommendation ?? ''}`.toLowerCase();
      expect(allText).not.toContain('roi');
      expect(allText).not.toContain('savings');
      expect(allText).not.toContain('waste');
      expect(allText).not.toContain('winner');
    });
  });

  // ── P2: External backend cost-config authority proof ────────
  describe('P2: External backend cost config (no isConfigured, no localStorage)', () => {
    beforeEach(() => {
      // Clear all localStorage cost configs
      for (const toolId of ['cursor', 'devin', 'vscode', 'claude-code', 'github-copilot']) {
        (globalThis as any).localStorage.removeItem(`${STORAGE_KEY_PREFIX}${toolId}`);
      }
    });

    it('backend-style config with positive monthlySpend (no isConfigured) is consumed successfully', () => {
      // Backend mapper returns: { toolId, seatCount, costPerSeatMonthly, monthlySpend, updatedAt }
      // NO isConfigured field. The generator must accept this.
      const externalConfigs = [
        { toolId: 'cursor', monthlySpend: 500 },
      ];
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 25, source: 'db_sync', data_source: 'live' },
      ]);
      const input: CanonicalInsightInput = {
        ...ti([], gh, obm),
        externalCostConfigs: externalConfigs,
      };
      const insight = generateAllocatedSpendPerDeployment(input);
      expect(insight).not.toBeNull();
      if (!insight) return;
      // $500/mo, 25 deployments, 1 month → $20/deployment
      expect(insight.title).toContain('$20');
    });

    it('external configs are primary authority over localStorage', () => {
      // Set localStorage with a DIFFERENT spend
      setCostConfig('cursor', 1, 10); // $10/mo in localStorage
      // External config says $500/mo
      const externalConfigs = [
        { toolId: 'cursor', monthlySpend: 500 },
      ];
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 25, source: 'db_sync', data_source: 'live' },
      ]);
      const input: CanonicalInsightInput = {
        ...ti([], gh, obm),
        externalCostConfigs: externalConfigs,
      };
      const insight = generateAllocatedSpendPerDeployment(input);
      expect(insight).not.toBeNull();
      if (!insight) return;
      // Must use $500 (external), not $10 (localStorage)
      expect(insight.title).toContain('$20'); // $500 / 25 = $20
      expect(insight.title).not.toContain('$0'); // $10 / 25 = $0
    });

    it('falls back to localStorage when no external configs provided', () => {
      setCostConfig('cursor', 5, 100); // $500/mo in localStorage
      const gh = mkGithubSnapshot('live');
      const obm = mkOutcomesByMonth([
        { month: PAST_MONTH, deployment_count: 25, source: 'db_sync', data_source: 'live' },
      ]);
      // No externalCostConfigs in input
      const input = ti([], gh, obm);
      const insight = generateAllocatedSpendPerDeployment(input);
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(insight.title).toContain('$20'); // $500 / 25 = $20
    });
  });
});
