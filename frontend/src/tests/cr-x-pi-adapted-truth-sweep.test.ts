/**
 * ============================================================================
 * CR-X Final PI Adapted Truth Sweep
 * ============================================================================
 *
 * Runs the final PI engine through the canonical → render-adapter boundary for
 * the three required acceptance shapes (local-real, ed-real, composite-super-org)
 * and enforces customer-facing truth invariants:
 *
 *   1. No malformed quantitative constructions: —% in …, —%, NaN%, undefined,
 *      null, or percentage where a repo/workflow label belongs.
 *   2. No source/scope contradictions: telemetry-only findings cannot be
 *      labeled with GitHub provenance; configured-cost findings must carry the
 *      explicit "Configured estimate · Not billing data" caveat.
 *   3. Structured allocation fields: synthesized workflow-repo-allocation
 *      findings carry `dominantRepo` and `allocationSynthesis`, and never need
 *      the renderer to parse display strings for repository identity.
 *
 * This is a deterministic validation gate that does NOT require a browser.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { generateFinalCanonicalInsights } from '../lib/insights/final';
import { addDerivedSessionFields } from '../lib/insights/final/dataAccess';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES = ['local-real', 'ed-real', 'composite-super-org'];

function loadFixture(name: string): any {
  const path = join(__dirname, '..', 'lib', 'insights', 'final', 'acceptanceCorpus', `${name}.json`);
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw);
}

function fixtureToInput(fixture: any): any {
  const sessions = fixture.sessions.map((s: any) => ({ ...s }));
  addDerivedSessionFields(sessions);
  return {
    sessionRows: sessions,
    githubSnapshot: fixture.github || undefined,
    githubByPeriod: [],
    prByPeriod: fixture.prByPeriod || [],
    outcomesByMonth: fixture.outcomesByMonth || [],
    productivityByPeriod: fixture.productivityByPeriod || [],
    externalCostConfigs: fixture.costConfigs?.length > 0 ? fixture.costConfigs : null,
    granularity: 'week' as const,
  };
}

/**
 * Collect customer-visible text fields from an adapted PerformanceInsight for
 * blanket malformed-value scanning.
 */
function collectCustomerFacingStrings(insight: any): string[] {
  const strings: string[] = [];
  const textFields = [
    'title', 'description', 'executiveSummary', 'whatChanged', 'whyItMatters',
    'evidenceAndContext', 'operationalImpact', 'confidenceReasoning',
    'displayValue', 'displayDeltaPct', 'rightMetric', 'rightMetricLabel',
    'provenanceLabel', 'scopeLabel', 'dominantRepo', 'diagnosticReason',
    'cohort', 'metricDefinition', 'sampleUnit'
  ];
  for (const key of textFields) {
    if (insight[key] != null) strings.push(String(insight[key]));
  }
  for (const ev of (insight.evidence || [])) {
    if (ev.metric != null) strings.push(String(ev.metric));
    if (ev.value != null) strings.push(String(ev.value));
    if (ev.label != null) strings.push(String(ev.label));
    if (ev.context != null) strings.push(String(ev.context));
    if (ev.comparison != null) strings.push(String(ev.comparison));
  }
  const bt = insight.breakdownByTool || {};
  for (const [, v] of Object.entries(bt)) {
    if (v && typeof v === 'object') {
      const d = v as any;
      if (d.formatted != null) strings.push(String(d.formatted));
      if (d.label != null) strings.push(String(d.label));
      if (d.value != null) strings.push(String(d.value));
    }
  }
  if (insight.comparisonAuthority?.leader) {
    const d = insight.comparisonAuthority.leader;
    if (d.formattedValue != null) strings.push(String(d.formattedValue));
    if (d.displayName != null) strings.push(String(d.displayName));
  }
  if (insight.comparisonAuthority?.runnerUp) {
    const d = insight.comparisonAuthority.runnerUp;
    if (d.formattedValue != null) strings.push(String(d.formattedValue));
    if (d.displayName != null) strings.push(String(d.displayName));
  }
  return strings;
}

const BAD_PATTERNS = [
  '—% in',        // malformed "—% in 70%" from reversed/missing operands
  '—%',           // em dash with a percent sign
  'NaN%',
  'undefined',
  'null',
  'Organization-wide GitHub metric',
  'Org-wide GitHub signal',
  'Org-wide signal',
];

function isConfiguredCost(insight: any): boolean {
  if (insight.metricKind && String(insight.metricKind).includes('cost')) return true;
  if (insight.valueType === 'currency') return true;
  if (insight.presentationKind === 'unit_economics') return true;
  if (Array.isArray(insight.dataDomain) && insight.dataDomain.includes('configured_cost')) return true;
  if (insight.dataDomain === 'configured_cost') return true;
  return false;
}

function isTelemetryOnly(insight: any): boolean {
  if (insight.dataDomain === 'telemetry') return true;
  if (Array.isArray(insight.dataDomain) && insight.dataDomain.length === 1 && insight.dataDomain[0] === 'telemetry') return true;
  // Fallback: plan-code stage without GitHub or configured_cost markers is telemetry
  if (insight.cicdStage === 'plan-code' && !isConfiguredCost(insight)) {
    if (Array.isArray(insight.dataDomain) && insight.dataDomain.some((d: string) => d.includes('github'))) return false;
    if (typeof insight.dataDomain === 'string' && insight.dataDomain.includes('github')) return false;
    return true;
  }
  return false;
}

describe('CR-X Final PI adapted truth sweep', () => {
  for (const fixture of FIXTURES) {
    it(`[${fixture}] produces no malformed quantitative or provenance strings`, async () => {
      const input = fixtureToInput(loadFixture(fixture));
      const insights = await generateFinalCanonicalInsights(input);
      expect(insights.length).toBeGreaterThan(0);

      const issues: string[] = [];
      const seen = new Set<string>();

      for (const insight of insights) {
        if (insight.isDiagnostic) continue; // diagnostics are allowed to explain missing data

        const strings = collectCustomerFacingStrings(insight);
        for (const s of strings) {
          for (const pattern of BAD_PATTERNS) {
            if (s.includes(pattern)) {
              const key = `${insight.id}||${s}||${pattern}`;
              if (!seen.has(key)) {
                seen.add(key);
                issues.push(`${insight.id}: contains malformed pattern "${pattern}" in "${s}"`);
              }
            }
          }
        }

        // Provenance / scope truth
        const prov = String(insight.provenanceLabel || '');
        if (isTelemetryOnly(insight) && (prov.includes('GitHub') || prov.includes('Delivery'))) {
          issues.push(`${insight.id}: telemetry-only insight has GitHub provenance "${prov}"`);
        }

        if (isConfiguredCost(insight)) {
          if (!prov.includes('Configured estimate') || !prov.includes('Not billing data')) {
            issues.push(`${insight.id}: configured-cost insight missing estimate caveats "${prov}"`);
          }
        }

        // Structured allocation authority
        if (insight.presentationKind === 'workflow_repo_allocation' && insight.allocationSynthesis === true) {
          if (!insight.dominantRepo) {
            issues.push(`${insight.id}: synthesized allocation missing dominantRepo`);
          }
          // The synthesized title/claim must not use a hardcoded repo name
          if (insight.title && insight.title.includes('am-sim') && !insight.dominantRepo?.includes('am-sim')) {
            issues.push(`${insight.id}: title hardcodes repo that does not match dominantRepo`);
          }
        }
      }

      console.log(`[${fixture}] ${insights.length} adapted insights, ${issues.length} truth issues`);
      expect(issues).toEqual([]);
    });
  }
});
