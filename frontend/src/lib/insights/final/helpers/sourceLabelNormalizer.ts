/**
 * Source Label Normalizer — Presentation-Layer Provenance Boundary
 *
 * CR-X 3D.2B/3D.2C: Centralized normalization that strips internal fixture/provenance
 * terminology from customer-facing DISPLAY labels while preserving full provenance
 * in the data layer (data_source, seed_batch, demoFlag, dataSource enum, etc.).
 *
 * Contract:
 *   DATA LAYER = provenance-rich (data_source, seed_batch, demoFlag, dataSource enum)
 *   PRESENTATION LAYER = customer-meaningful (sourceLabel, breadcrumbs, badge text)
 *
 * This is the single normalization boundary. Generators and backend may
 * continue returning rich provenance; this helper transforms DISPLAY labels
 * to customer-facing copy at the render adapter boundary.
 *
 * CR-X 3D.2C: This normalizer MUST NOT be used on machine-semantic fields
 * (dataSource, source, provenance, mode, kind, type). It is restricted to
 * presentation-only fields (sourceLabel, operationalBreadcrumbs, badge labels).
 */

/**
 * Internal fixture/provenance strings that must NOT appear in customer-facing UI.
 * Maps to their neutral customer-facing equivalents.
 */
const INTERNAL_TO_NEUTRAL: Record<string, string> = {
  'GitHub demo dataset · cm-activity-sim': 'GitHub delivery · all-time baseline',
  'GitHub demo dataset': 'GitHub delivery',
  'cm-activity-sim': 'GitHub delivery',
  'cm_activity_sim': 'GitHub delivery',
  'demo baseline': 'all-time baseline',
  'demo dataset': 'delivery data',
  'Local demo dataset': 'Historical delivery data',
  'seeded data': 'observed delivery data',
  'seeded': 'observed',
}

/**
 * Normalize a single source label string for customer-facing display.
 * Replaces internal fixture/provenance terminology with neutral semantic labels.
 * Returns the original string if no normalization is needed.
 *
 * This is PRESENTATION-ONLY. Do NOT use on machine-semantic fields.
 */
export function normalizeSourceLabel(label: string | undefined | null): string | undefined {
  if (!label || typeof label !== 'string') return label as undefined

  let result = label

  // Direct mapping for exact matches
  if (INTERNAL_TO_NEUTRAL[label.trim()]) {
    return INTERNAL_TO_NEUTRAL[label.trim()]
  }

  // Substring replacements for composite labels (e.g., footer notes)
  for (const [internal, neutral] of Object.entries(INTERNAL_TO_NEUTRAL)) {
    // Skip exact-match entries already handled above
    if (label.trim() === internal) continue
    // Replace substring occurrences
    result = result.split(internal).join(neutral)
  }

  return result
}

/**
 * Normalize an array of operational breadcrumb strings for customer-facing display.
 * Each breadcrumb is normalized individually.
 *
 * This is PRESENTATION-ONLY. Do NOT use on machine-semantic fields.
 */
export function normalizeBreadcrumbs(breadcrumbs: string[] | undefined | null): string[] | undefined {
  if (!breadcrumbs || !Array.isArray(breadcrumbs)) return breadcrumbs as undefined
  return breadcrumbs.map(crumb => normalizeSourceLabel(crumb) || crumb)
}

/**
 * CR-X FINAL: Compute customer-facing provenance label from canonical evidence kinds.
 *
 * Authority stays at the canonical→UI boundary. Generators set `dataDomain`
 * (string or string[]) to the authoritative evidence kinds; the adapter
 * converts that set into a truthful, compact provenance string.
 *
 * Kinds:
 *   telemetry      → Telemetry
 *   github_review  → GitHub
 *   github_delivery→ GitHub
 *   configured_cost→ Configured estimate
 *   attribution_gap→ Telemetry (it is telemetry that lacks attribution)
 *
 * Mixed arrays are joined with ' · '.  Any configured-cost component carries
 * the explicit 'Not billing data' caveat.
 */
export function computeProvenanceLabel(insight: any): string {
  const raw = (insight as any).dataDomain;
  const domains: string[] = Array.isArray(raw)
    ? raw
    : raw != null
      ? [String(raw)]
      : [];

  if (domains.length === 0) {
    // Fallback by stage / metric kind.  Used for generators that have not
    // yet adopted dataDomain; new generators should set dataDomain explicitly.
    if (insight.cicdStage === 'review-merge' || insight.cicdStage === 'deploy-operate') return 'GitHub';
    if ((insight.metricKind || '').includes('cost') || (insight.valueType || '') === 'currency') return 'Configured estimate';
    return 'Telemetry';
  }

  const kindToLabel: Record<string, string> = {
    telemetry: 'Telemetry',
    github_review: 'GitHub',
    github_delivery: 'GitHub',
    configured_cost: 'Configured estimate',
    attribution_gap: 'Telemetry',
  };

  const seen = new Set<string>();
  const labels: string[] = [];
  for (const d of domains) {
    const label = kindToLabel[d] ?? d;
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }

  const configured = domains.includes('configured_cost');
  const joined = labels.join(' · ');
  return configured ? `${joined} · Not billing data` : joined;
}

/**
 * CR-X FINAL: Compute customer-facing scope label from canonical structure.
 *
 * Scope is orthogonal to provenance.  It describes the population the
 * finding is about, not the source of the evidence.
 */
export function computeScopeLabel(insight: any): string {
  if (insight.isOrgLevelMetric) return 'Org-level';
  if (insight.presentationKind === 'org_summary') return 'Org-level';
  if (insight.comparisonState === 'org_level_only') return 'Org-level';

  const scopeMap: Record<string, string> = {
    org_level: 'Org-level',
    workflow_scoped: 'Workflow-level',
    developer_scoped: 'Developer-level',
    repo_scoped: 'Repo-level',
    scoped: 'Scoped',
  };
  if (insight.populationScope && scopeMap[insight.populationScope]) {
    return scopeMap[insight.populationScope];
  }

  const bt = insight.breakdownByTool as Record<string, any> | undefined;
  const btKeys = bt ? Object.keys(bt).filter(k => !k.endsWith('_nonai')) : [];
  if (btKeys.length === 0) return 'Org-level';
  if (btKeys.length === 1) return 'Workflow-level';
  return 'Cross-workflow';
}
