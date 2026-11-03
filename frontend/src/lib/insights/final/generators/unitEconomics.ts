/**
 * Allocated Unit Economics Generators — V1 Exact-Count Closeout
 *
 * CONTRACT:
 * - ONE latest complete calendar month at a time (not current incomplete month)
 * - Numerator = configured monthly spend for that exact month
 * - Denominator = EXACT INTEGER outcome count from outcomes_by_month
 * - Denominators come ONLY from outcomes_by_month (observed_rows authority)
 * - Rate-derived weekly buckets are NEVER used as denominators
 * - If exact same-period integer denominator cannot be proven → RETURN NULL
 * - Provenance labels match reality (live vs seeded)
 * - Configured $0 is NOT missing — it's a valid configured value
 * - Neutral polarity — never directional
 * - No fake delta/baseline/deltaPct
 *
 * MONTH AUTHORITY:
 * The UE month comes from outcomes_by_month entries, which are computed
 * DIRECTLY from actual dated rows grouped by calendar month.
 * NOT derived from weekly buckets, rates, or fallbacks.
 * Each entry has count_authority = 'observed_rows'.
 */
import type { CanonicalInsightInput, CanonicalInsight, ConfidenceLevel } from '../types';
import { getCanonicalPIById } from '../canonicalInsights';
import { piDebugLog } from '../utils/logging';
import { isGithubEvidenceEligibleCombined } from '../dataAccess';
import { selectRecentCompleteMonths, buildPeriodStrip, type PeriodStripData } from '../helpers/periodStrip';

// ─── Cost Config ─────────────────────────────────────────────

import { normalizeCostConfigInput, costToolIdToCanonicalWorkflowId, type ToolCostConfig } from '../../../toolCost';

/**
 * CR-X FINAL (Wave 3): Cost config as consumed by the Final PI engine.
 *
 * Accepts raw backend DTOs (tool_id, monthly_spend, ...), resolved DTOs
 * (toolId, monthlySpend, ...), or Dashboards-resolved ToolCostConfig[].
 *
 * The engine normalizes to the canonical workflow ID (underscore) at this
 * ONE boundary. Storage/API may remain hyphenated; PI-facing cost identity
 * is canonical workflow identity.
 */
interface CostConfig {
  toolId: string;  // canonical workflow ID (e.g. 'claude_code')
  monthlySpend: number;
  isConfigured: boolean;
}

interface CostConfigSummary {
  configs: CostConfig[];
  totalMonthlySpend: number;
  hasAnyConfigured: boolean;
}

/**
 * CR-X FINAL (Wave 3): Single production cost authority.
 *
 * - No localStorage fallback. Production cost must come from the backend
 *   /api/org/spend/config (via Dashboards.vue resolvedCostConfigs) OR a
 *   deterministic test fixture that matches the backend contract.
 * - Accepts both raw backend snake_case and resolved camelCase DTOs.
 * - Maps cost tool IDs (hyphenated) to canonical workflow IDs (underscore).
 */
function readAllCostConfigs(externalConfigs?: any[]): CostConfigSummary {
  if (!externalConfigs || externalConfigs.length === 0) {
    return { configs: [], totalMonthlySpend: 0, hasAnyConfigured: false };
  }

  const configs: CostConfig[] = [];
  for (const raw of externalConfigs) {
    const normalized = normalizeCostConfigInput(raw);
    if (!normalized) continue;
    const canonicalWorkflowId = costToolIdToCanonicalWorkflowId(normalized.toolId);
    if (normalized.monthlySpend > 0) {
      configs.push({
        toolId: canonicalWorkflowId,
        monthlySpend: normalized.monthlySpend,
        isConfigured: true,
      });
    }
  }

  return {
    configs,
    totalMonthlySpend: configs.reduce((sum, c) => sum + c.monthlySpend, 0),
    hasAnyConfigured: configs.length > 0,
  };
}

// ─── Month Helpers ───────────────────────────────────────────

/**
 * Get the current month key (YYYY-MM) in UTC.
 */
function getCurrentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[parseInt(m) - 1]} ${y}`;
}

// ─── Outcomes By Month Contract ──────────────────────────────

interface OutcomeMonthEntry {
  month: string;
  merged_pr_count: number;
  total_pr_count: number;
  review_cycle_count: number;
  deployment_count: number;
  successful_deployment_count: number;
  failed_deployment_count: number;
  release_count: number;
  source: string;
  data_source: string;
  count_authority: string;
}

/**
 * Extract validated outcomes_by_month entries from the input.
 *
 * Only entries with count_authority = 'observed_rows' are accepted.
 * Rate-derived or synthetic entries are rejected.
 */
function getObservedOutcomeMonths(input: CanonicalInsightInput): OutcomeMonthEntry[] {
  const raw = input.outcomesByMonth || input.githubSnapshot?.outcomes_by_month || [];
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const validated: OutcomeMonthEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    // MUST have observed_rows authority — reject derived_rate or anything else
    if (entry.count_authority !== 'observed_rows') continue;

    const month = entry.month;
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) continue;

    validated.push({
      month,
      merged_pr_count: Number(entry.merged_pr_count) || 0,
      total_pr_count: Number(entry.total_pr_count) || 0,
      review_cycle_count: Number(entry.review_cycle_count) || 0,
      deployment_count: Number(entry.deployment_count) || 0,
      successful_deployment_count: Number(entry.successful_deployment_count) || 0,
      failed_deployment_count: Number(entry.failed_deployment_count) || 0,
      release_count: Number(entry.release_count) || 0,
      source: String(entry.source || ''),
      data_source: String(entry.data_source || ''),
      count_authority: 'observed_rows',
    });
  }

  return validated;
}

/**
 * Select the latest complete calendar month from observed outcome entries.
 *
 * "Complete" means the month has fully passed (NOT the current month).
 * The month must have at least one eligible outcome count > 0 for the
 * specified count field.
 */
function selectLatestCompleteMonth(
  months: OutcomeMonthEntry[],
  countField: keyof OutcomeMonthEntry
): OutcomeMonthEntry | null {
  if (months.length === 0) return null;

  const currentMonth = getCurrentMonthKey();

  // Sort by month descending (most recent first)
  const sorted = [...months].sort((a, b) => b.month.localeCompare(a.month));

  for (const entry of sorted) {
    // Skip current month (incomplete)
    if (entry.month >= currentMonth) continue;

    const count = entry[countField];
    if (typeof count === 'number' && count > 0) {
      return entry;
    }
  }

  return null;
}

// ─── Provenance ──────────────────────────────────────────────

type UEProvenance = 'live' | 'seeded' | 'none';

interface ProvenanceInfo {
  dataSource: UEProvenance;
  sourceLabel: string;
  provenanceDescription: string;
}

function deriveProvenanceFromOutcome(entry: OutcomeMonthEntry): ProvenanceInfo {
  const source = entry.source;
  const dataSource = entry.data_source;

  if (source === 'cm_activity_sim' || dataSource === 'seeded') {
    return {
      dataSource: 'seeded',
      sourceLabel: 'GitHub delivery · all-time baseline',
      provenanceDescription: 'Historical delivery evidence — configured spend allocation',
    };
  }

  if (source === 'db_sync' || source === 'github_api_sync' || dataSource === 'live') {
    return {
      dataSource: 'live',
      sourceLabel: 'GitHub API sync',
      provenanceDescription: 'Real GitHub API sync data',
    };
  }

  return {
    dataSource: 'none',
    sourceLabel: 'Unknown source',
    provenanceDescription: 'Provenance not recognized',
  };
}

// ─── Allocation Logic ────────────────────────────────────────

interface AllocationResult {
  monthlySpend: number;
  outcomeCount: number;
  allocatedUnitCost: number;
  monthKey: string;
  monthLabel: string;
  provenance: ProvenanceInfo;
  outcomeComposition?: {
    primary: number;
    secondary?: number;
    total: number;
    primaryLabel: string;
    secondaryLabel?: string;
    totalLabel: string;
  };
}

type OutcomeCountField = 'merged_pr_count' | 'deployment_count' | 'successful_deployment_count' | 'failed_deployment_count' | 'review_cycle_count' | 'release_count';

interface OutcomeSpec {
  countField: OutcomeCountField;
  outcomeLabel: string;
  outcomeSingular: string;
}

function computeAllocation(
  input: CanonicalInsightInput,
  spec: OutcomeSpec,
  externalCostConfigs?: ExternalCostConfig[]
): AllocationResult | null {
  // 1. Read configured cost (P2: use external configs if provided, else localStorage)
  // Check both the parameter and input.externalCostConfigs (parameter takes precedence)
  const resolvedExternal = externalCostConfigs || input.externalCostConfigs;
  const costSummary = readAllCostConfigs(resolvedExternal);
  if (!costSummary.hasAnyConfigured) {
    piDebugLog('[UNIT_ECONOMICS][NO_COST_CONFIG]', { reason: 'no tools configured' });
    return null;
  }

  // 2. Provenance gate — still check overall GitHub eligibility
  const githubSnapshot = input.githubSnapshot;
  if (!githubSnapshot) {
    piDebugLog('[UNIT_ECONOMICS][NO_GITHUB_SNAPSHOT]', {});
    return null;
  }

  const isEligible = isGithubEvidenceEligibleCombined(githubSnapshot);
  if (!isEligible) {
    piDebugLog('[UNIT_ECONOMICS][PROVENANCE_REJECTED]', { reason: 'GitHub evidence not eligible' });
    return null;
  }

  // 3. Get observed outcome months from the monthly contract
  const outcomeMonths = getObservedOutcomeMonths(input);
  if (outcomeMonths.length === 0) {
    piDebugLog('[UNIT_ECONOMICS][NO_OUTCOME_MONTHS]', {
      reason: 'no outcomes_by_month entries with observed_rows authority',
    });
    return null;
  }

  // 4. Select latest complete calendar month with eligible outcome count
  const selectedMonth = selectLatestCompleteMonth(outcomeMonths, spec.countField);
  if (!selectedMonth) {
    piDebugLog('[UNIT_ECONOMICS][NO_COMPLETE_MONTH]', {
      reason: 'no complete calendar month with observed outcome counts',
      countField: spec.countField,
      availableMonths: outcomeMonths.map(m => m.month),
    });
    return null;
  }

  // 5. Get exact integer outcome count for that month
  const outcomeCount = selectedMonth[spec.countField];
  if (typeof outcomeCount !== 'number' || !Number.isInteger(outcomeCount) || outcomeCount <= 0) {
    piDebugLog('[UNIT_ECONOMICS][NO_EXACT_COUNT]', {
      month: selectedMonth.month,
      countField: spec.countField,
      reason: 'no exact integer count for this month',
    });
    return null;
  }

  // 6. Derive provenance from the outcome entry itself
  const provenance = deriveProvenanceFromOutcome(selectedMonth);
  if (provenance.dataSource === 'none') {
    piDebugLog('[UNIT_ECONOMICS][PROVENANCE_UNKNOWN]', {
      reason: 'unrecognized provenance source in outcome entry',
      source: selectedMonth.source,
      data_source: selectedMonth.data_source,
    });
    return null;
  }

  // 7. Compute allocated unit cost
  const monthlySpend = costSummary.totalMonthlySpend;
  const allocatedUnitCost = monthlySpend / outcomeCount;

  piDebugLog('[UNIT_ECONOMICS][ALLOCATION_SUCCESS]', {
    month: selectedMonth.month,
    monthlySpend,
    outcomeCount,
    allocatedUnitCost,
    provenance: provenance.dataSource,
    countField: spec.countField,
    source: selectedMonth.source,
    count_authority: selectedMonth.count_authority,
  });

  return {
    monthlySpend,
    outcomeCount,
    allocatedUnitCost,
    monthKey: selectedMonth.month,
    monthLabel: monthLabel(selectedMonth.month),
    provenance,
    outcomeComposition: buildOutcomeComposition(spec.countField, selectedMonth),
  };
}

// ─── Outcome Composition ─────────────────────────────────────

function buildOutcomeComposition(
  countField: OutcomeCountField,
  month: ObservedOutcomeMonth
): AllocationResult['outcomeComposition'] {
  if (countField === 'merged_pr_count') {
    const merged = month.merged_pr_count ?? 0;
    const total = month.total_pr_count ?? 0;
    if (total <= 0) return undefined;
    return {
      primary: merged,
      total,
      primaryLabel: 'merged',
      totalLabel: 'PRs observed',
    };
  }
  if (countField === 'deployment_count' || countField === 'successful_deployment_count') {
    const success = month.successful_deployment_count ?? 0;
    const failed = month.failed_deployment_count ?? 0;
    const total = month.deployment_count ?? 0;
    if (total <= 0) return undefined;
    return {
      primary: success,
      secondary: failed,
      total,
      primaryLabel: 'successful',
      secondaryLabel: 'failed',
      totalLabel: 'deployments',
    };
  }
  return undefined;
}

// ─── Language Helpers ────────────────────────────────────────

function formatCurrency(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatCurrencyPrecise(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  if (value >= 100) return `$${value.toFixed(0)}`;
  return `$${value.toFixed(2)}`;
}

// ─── Common Insight Builder ──────────────────────────────────

function buildInsight(
  registryId: string,
  stage: 'review-merge' | 'deploy-operate',
  result: AllocationResult,
  spec: OutcomeSpec
): CanonicalInsight {
  const registryEntry = getCanonicalPIById(registryId)!;
  const { monthlySpend, outcomeCount, allocatedUnitCost, monthLabel, monthKey, provenance, outcomeComposition } = result;

  const title = `${formatCurrency(allocatedUnitCost)} configured AI spend per ${spec.outcomeSingular} · ${monthLabel}`;
  const provenanceNote = provenance.dataSource === 'seeded'
    ? 'Historical delivery data. '
    : '';

  const description = `${formatCurrency(monthlySpend)} configured monthly AI-tool spend across ${outcomeCount} ${spec.outcomeLabel} during ${monthLabel}. ` +
    `Allocated unit cost = ${formatCurrencyPrecise(allocatedUnitCost)} per ${spec.outcomeSingular}. ` +
    `${provenanceNote}` +
    `Period-level allocation based on your configured tool costs.`;

  const recommendation = `Compare configured cost against observed utilization and ${stage === 'review-merge' ? 'delivery volume' : 'deployment reliability'}. Inspect seat/tool configuration if unit economics are materially high. ${stage === 'review-merge' ? 'Compare with active-hour/session economics where available.' : 'Compare with active-hour/session economics where available.'}`;
  const whyItMatters = `Configured AI-tool spend normalized by ${spec.outcomeLabel}. This is a configured estimate, not billing data. Period-level allocation, not per-outcome causal attribution. Use to assess whether configured spend aligns with observed delivery output.`;

  const executiveSummary = `${formatCurrency(allocatedUnitCost)} configured AI spend per ${spec.outcomeSingular} · ${monthLabel}`;

  const confidence: ConfidenceLevel = outcomeCount >= 20 ? 'high' : outcomeCount >= 10 ? 'medium' : 'low';

  const evidence = [
    {
      metric: 'Configured monthly AI spend',
      value: formatCurrency(monthlySpend),
      label: `${monthLabel} · Configured estimate`,
    },
    {
      metric: spec.outcomeLabel.charAt(0).toUpperCase() + spec.outcomeLabel.slice(1),
      value: String(outcomeCount),
      label: `${provenance.sourceLabel} · ${monthLabel}`,
    },
    {
      metric: `Allocated spend per ${spec.outcomeSingular}`,
      value: formatCurrencyPrecise(allocatedUnitCost),
      label: 'Period-level allocation · Configured estimate',
    },
  ];

  return {
    id: registryId,
    title,
    cicdStage: stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'synthesized',
    presentationKind: 'unit_economics',
    comparisonMode: 'absolute',
    comparisonState: 'org_level_only',
    current: allocatedUnitCost,
    displayValue: formatCurrencyPrecise(allocatedUnitCost),
    rightMetric: formatCurrencyPrecise(allocatedUnitCost),
    rightMetricLabel: `Configured spend / ${spec.outcomeSingular}`,
    metricDefinition: `Configured monthly AI-tool spend for ${monthLabel} divided by ${spec.outcomeLabel} count for the same month. Period-level allocation, not per-outcome causal attribution.`,
    polarity: 'neutral',
    confidence,
    n: outcomeCount,
    hasData: true,
    description,
    recommendation,
    whyItMatters,
    executiveSummary,
    evidence,
    isExecutiveFinding: true,
    outcomeComposition: outcomeComposition as any,
    dataSource: provenance.dataSource,
    dataDomain: [stage === 'review-merge' ? 'github_review' : 'github_delivery', 'configured_cost'],
    recommendationState: 'monitor_only',
    urgencyLabel: 'informational',
    generatorSource: `generate${registryId.replace(/-/g, '').replace(/([a-z])([a-z]*)/g, (_, p1, p2) => p1.toUpperCase() + p2)}`,
    engineVersion: 'FINAL_ENGINE_V1',
  };
}

// ─── Period Strip ─────────────────────────────────────────────

/**
 * Build a Period Strip for unit-economics cards from outcomes_by_month.
 *
 * Computes allocated unit cost (configured monthly spend / outcome count)
 * for each complete past month with a positive outcome count.
 * Returns undefined if fewer than 2 eligible months exist.
 *
 * Uses the SAME cost config and outcome-month authority as computeAllocation.
 */
function buildUnitEconomicsPeriodStrip(
  input: CanonicalInsightInput,
  spec: OutcomeSpec,
  externalCostConfigs?: ExternalCostConfig[]
): PeriodStripData | undefined {
  const resolvedExternal = externalCostConfigs || input.externalCostConfigs;
  const costSummary = readAllCostConfigs(resolvedExternal);
  if (!costSummary.hasAnyConfigured) return undefined;

  const outcomeMonths = getObservedOutcomeMonths(input);
  if (outcomeMonths.length < 2) return undefined;

  const selected = selectRecentCompleteMonths(outcomeMonths, spec.countField, 6);
  if (selected.length < 2) return undefined;

  const monthlySpend = costSummary.totalMonthlySpend;
  const monthlyValues = selected.map(m => ({
    monthKey: m.month,
    value: monthlySpend / (m[spec.countField] as number),
  }));

  return buildPeriodStrip(
    monthlyValues,
    (v) => formatCurrencyPrecise(v),
    (diff) => diff > 0 ? `+${formatCurrencyPrecise(diff)}` : `−${formatCurrencyPrecise(Math.abs(diff))}`,
    `Cost per ${spec.outcomeSingular} by month`
  );
}

// ─── Generators ──────────────────────────────────────────────

/**
 * P0-A: Configured AI spend per merged PR
 *
 * Denominator: exact integer merged_pr_count from outcomes_by_month
 */
export function generateAllocatedSpendPerMergedPR(input: CanonicalInsightInput, externalCostConfigs?: ExternalCostConfig[]): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('allocated-spend-per-merged-pr');
  if (!registryEntry) return null;

  const spec: OutcomeSpec = {
    countField: 'merged_pr_count',
    outcomeLabel: 'merged PRs',
    outcomeSingular: 'merged PR',
  };

  const result = computeAllocation(input, spec, externalCostConfigs);
  if (!result) return null;

  const insight = buildInsight('allocated-spend-per-merged-pr', 'review-merge', result, spec);
  (insight as any).periodStrip = buildUnitEconomicsPeriodStrip(input, spec, externalCostConfigs);
  return insight;
}

/**
 * P0-B: Configured AI spend per deployment
 *
 * Denominator: exact integer deployment_count from outcomes_by_month
 */
export function generateAllocatedSpendPerDeployment(input: CanonicalInsightInput, externalCostConfigs?: ExternalCostConfig[]): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('allocated-spend-per-deployment');
  if (!registryEntry) return null;

  const spec: OutcomeSpec = {
    countField: 'deployment_count',
    outcomeLabel: 'deployments',
    outcomeSingular: 'deployment',
  };

  const result = computeAllocation(input, spec, externalCostConfigs);
  if (!result) return null;

  const insight = buildInsight('allocated-spend-per-deployment', 'deploy-operate', result, spec);
  (insight as any).periodStrip = buildUnitEconomicsPeriodStrip(input, spec, externalCostConfigs);
  return insight;
}

/**
 * P0-C: Configured AI spend per successful deployment
 *
 * Denominator: exact integer successful_deployment_count from outcomes_by_month
 */
export function generateAllocatedSpendPerSuccessfulDeployment(input: CanonicalInsightInput, externalCostConfigs?: ExternalCostConfig[]): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('allocated-spend-per-successful-deployment');
  if (!registryEntry) return null;

  const spec: OutcomeSpec = {
    countField: 'successful_deployment_count',
    outcomeLabel: 'successful deployments',
    outcomeSingular: 'successful deployment',
  };

  const result = computeAllocation(input, spec, externalCostConfigs);
  if (!result) return null;

  const insight = buildInsight('allocated-spend-per-successful-deployment', 'deploy-operate', result, spec);
  (insight as any).periodStrip = buildUnitEconomicsPeriodStrip(input, spec, externalCostConfigs);
  return insight;
}

/**
 * P0-D: Configured AI spend per failed deployment
 *
 * Denominator: exact integer failed_deployment_count from outcomes_by_month
 */
export function generateAllocatedSpendPerFailedDeployment(input: CanonicalInsightInput, externalCostConfigs?: ExternalCostConfig[]): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('allocated-spend-per-failed-deployment');
  if (!registryEntry) return null;

  const spec: OutcomeSpec = {
    countField: 'failed_deployment_count',
    outcomeLabel: 'failed deployments',
    outcomeSingular: 'failed deployment',
  };

  const result = computeAllocation(input, spec, externalCostConfigs);
  if (!result) return null;

  const insight = buildInsight('allocated-spend-per-failed-deployment', 'deploy-operate', result, spec);
  (insight as any).periodStrip = buildUnitEconomicsPeriodStrip(input, spec, externalCostConfigs);
  return insight;
}

/**
 * P0-E: Configured AI spend per review cycle
 *
 * Denominator: exact integer review_cycle_count from outcomes_by_month
 * (review_count + pr_reopened_count per merged PR)
 */
export function generateAllocatedSpendPerReviewCycle(input: CanonicalInsightInput, externalCostConfigs?: ExternalCostConfig[]): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('allocated-spend-per-review-cycle');
  if (!registryEntry) return null;

  const spec: OutcomeSpec = {
    countField: 'review_cycle_count',
    outcomeLabel: 'review burden events',
    outcomeSingular: 'review burden event',
  };

  const result = computeAllocation(input, spec, externalCostConfigs);
  if (!result) return null;

  const insight = buildInsight('allocated-spend-per-review-cycle', 'review-merge', result, spec);
  (insight as any).periodStrip = buildUnitEconomicsPeriodStrip(input, spec, externalCostConfigs);
  return insight;
}

/**
 * P0-F: Configured AI spend per release
 *
 * Denominator: exact integer release_count from outcomes_by_month
 */
export function generateAllocatedSpendPerRelease(input: CanonicalInsightInput, externalCostConfigs?: ExternalCostConfig[]): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('allocated-spend-per-release');
  if (!registryEntry) return null;

  const spec: OutcomeSpec = {
    countField: 'release_count',
    outcomeLabel: 'releases',
    outcomeSingular: 'release',
  };

  const result = computeAllocation(input, spec, externalCostConfigs);
  if (!result) return null;

  const insight = buildInsight('allocated-spend-per-release', 'deploy-operate', result, spec);
  (insight as any).periodStrip = buildUnitEconomicsPeriodStrip(input, spec, externalCostConfigs);
  return insight;
}
