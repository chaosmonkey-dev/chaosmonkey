/**
 * Validation Utilities for Final Canonical Performance Insights
 * 
 * This module provides validation functions for the canonical PI system.
 * 
 * INTENDED FUTURE DATA FLOW:
 * 1. Generators produce CanonicalInsight objects
 * 2. Validation ensures output conforms to schema
 * 3. Validation ensures no duplicate IDs
 * 4. Validation ensures correct stage distribution
 * 5. Validation ensures unique renderOrder
 * 
 * No imports from old V2 systems (computeV2PerformanceInsights.ts, piV2Manifest.ts, V2_PREVIEW_ROW_IDS)
 */

import type { CanonicalInsight, CanonicalStage } from '../types';
import { CANONICAL_PI_REGISTRY, isCanonicalInsightId, resolveCanonicalFamilyId, getRuntimeInstanceFamilies } from '../canonicalInsights';

/**
 * Validate that all insights have unique IDs
 * 
 * @param insights - Array of canonical insights to validate
 * @returns true if all IDs are unique, false otherwise
 */
export function validateUniqueIds(insights: CanonicalInsight[]): boolean {
  const ids = insights.map(i => i.id);
  const uniqueIds = new Set(ids);
  return uniqueIds.size === ids.length;
}

/**
 * Validate stage distribution — structural only.
 *
 * CR4 P0-5: NO fixed PI inventory count contract.
 * The registry is the authority for which PIs CAN exist, but generators
 * may return null for PIs that lack sufficient evidence. Validation must
 * NOT require every registry entry to be present.
 *
 * Only validates:
 * - All insights have a legal stage
 * - No unknown stages
 *
 * @param insights - Array of canonical insights to validate
 * @returns Object with validation results for each stage
 */
export function validateStageDistribution(insights: CanonicalInsight[]): {
  valid: boolean;
  stageCounts: Record<CanonicalStage, number>;
  expected: Record<CanonicalStage, number>;
  errors: string[];
} {
  const legalStages = new Set<CanonicalStage>(['plan-code', 'review-merge', 'deploy-operate']);
  const stageCounts: Record<CanonicalStage, number> = {
    'plan-code': 0,
    'review-merge': 0,
    'deploy-operate': 0
  };

  const errors: string[] = [];

  for (const insight of insights) {
    if (!legalStages.has(insight.cicdStage)) {
      errors.push(`Insight ${insight.id} has unknown stage: ${insight.cicdStage}`);
      continue;
    }
    stageCounts[insight.cicdStage]++;
  }

  // Registry-derived expected counts are informational only — NOT enforced.
  const registryByStage: Record<CanonicalStage, number> = {
    'plan-code': 0,
    'review-merge': 0,
    'deploy-operate': 0
  };
  for (const entry of CANONICAL_PI_REGISTRY) {
    registryByStage[entry.stage]++;
  }

  return {
    valid: errors.length === 0,
    stageCounts,
    expected: registryByStage,
    errors
  };
}

/**
 * Validate that renderOrder is unique within each stage
 * 
 * @param insights - Array of canonical insights to validate
 * @returns Object with validation results
 */
export function validateUniqueRenderOrder(insights: CanonicalInsight[]): {
  valid: boolean;
  duplicates: Array<{ stage: CanonicalStage; renderOrder: number; count: number }>;
  errors: string[];
} {
  const runtimeInstanceFamilies = getRuntimeInstanceFamilies();
  const stageRenderOrders: Record<CanonicalStage, Map<number, number>> = {
    'plan-code': new Map(),
    'review-merge': new Map(),
    'deploy-operate': new Map()
  };

  for (const insight of insights) {
    // Runtime-instance families (e.g., recent-change__*, within-workflow-*__*)
    // intentionally share the same renderOrder across instances because they
    // derive from a single canonical registry entry. These are NOT duplicates —
    // they are valid per-workflow/per-dimension instances. Skip them in the
    // uniqueness check to prevent suppressing all runtime-instance findings.
    const familyId = resolveCanonicalFamilyId(insight.id);
    if (familyId && runtimeInstanceFamilies.has(familyId)) continue;

    const currentCount = stageRenderOrders[insight.cicdStage].get(insight.renderOrder) || 0;
    stageRenderOrders[insight.cicdStage].set(insight.renderOrder, currentCount + 1);
  }

  const duplicates: Array<{ stage: CanonicalStage; renderOrder: number; count: number }> = [];
  const errors: string[] = [];

  for (const stage of Object.keys(stageRenderOrders) as CanonicalStage[]) {
    for (const [renderOrder, count] of stageRenderOrders[stage].entries()) {
      if (count > 1) {
        duplicates.push({ stage, renderOrder, count });
        errors.push(
          `Stage ${stage}: renderOrder ${renderOrder} appears ${count} times (should be unique)`
        );
      }
    }
  }

  return {
    valid: duplicates.length === 0,
    duplicates,
    errors
  };
}

/**
 * Validate that all insights are in the canonical registry
 *
 * CR5 P1: Supports per-workflow instance keys. An insight ID may be a
 * base registry ID followed by `__` and a workflow identifier (e.g.,
 * `within-workflow-ai-effect__devin`). The base ID must be in the
 * registry; the full instance key must be unique (checked by
 * validateUniqueIds).
 *
 * @param insights - Array of canonical insights to validate
 * @returns Object with validation results
 */
export function validateCanonicalRegistry(insights: CanonicalInsight[]): {
  valid: boolean;
  unregisteredIds: string[];
  errors: string[];
} {
  const unregisteredIds: string[] = [];

  for (const insight of insights) {
    // CR5 P1.2: Use the SINGLE authority for canonical family resolution.
    // This handles both exact registry IDs and per-workflow instance keys.
    if (!isCanonicalInsightId(insight.id)) {
      unregisteredIds.push(insight.id);
    }
  }

  const errors = unregisteredIds.map(id => 
    `Insight ${id} is not in the canonical registry`
  );

  return {
    valid: unregisteredIds.length === 0,
    unregisteredIds,
    errors
  };
}

/**
 * Validate that all required fields are present on insights
 * 
 * @param insights - Array of canonical insights to validate
 * @returns Object with validation results
 */
export function validateRequiredFields(insights: CanonicalInsight[]): {
  valid: boolean;
  missingFields: Array<{ id: string; missing: string[] }>;
  errors: string[];
} {
  const requiredFields = [
    'id',
    'title',
    'cicdStage',
    'canonicalPriority',
    'renderOrder',
    'current',
    'confidence',
    'hasData'
  ];

  const missingFields: Array<{ id: string; missing: string[] }> = [];
  const errors: string[] = [];

  for (const insight of insights) {
    const missing: string[] = [];
    
    for (const field of requiredFields) {
      if (insight[field as keyof CanonicalInsight] === undefined) {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      missingFields.push({ id: insight.id, missing });
      errors.push(
        `Insight ${insight.id} is missing required fields: ${missing.join(', ')}`
      );
    }
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
    errors
  };
}

/**
 * Run all validations on an array of canonical insights
 * 
 * @param insights - Array of canonical insights to validate
 * @returns Object with overall validation results
 */
export function validateCanonicalInsights(insights: CanonicalInsight[]): {
  valid: boolean;
  results: {
    uniqueIds: boolean;
    stageDistribution: ReturnType<typeof validateStageDistribution>;
    uniqueRenderOrder: ReturnType<typeof validateUniqueRenderOrder>;
    canonicalRegistry: ReturnType<typeof validateCanonicalRegistry>;
    requiredFields: ReturnType<typeof validateRequiredFields>;
  };
  allErrors: string[];
} {
  const uniqueIds = validateUniqueIds(insights);
  const stageDistribution = validateStageDistribution(insights);
  const uniqueRenderOrder = validateUniqueRenderOrder(insights);
  const canonicalRegistry = validateCanonicalRegistry(insights);
  const requiredFields = validateRequiredFields(insights);

  const allErrors: string[] = [
    ...(uniqueIds ? [] : ['Duplicate IDs found']),
    ...stageDistribution.errors,
    ...uniqueRenderOrder.errors,
    ...canonicalRegistry.errors,
    ...requiredFields.errors
  ];

  return {
    valid: allErrors.length === 0,
    results: {
      uniqueIds,
      stageDistribution,
      uniqueRenderOrder,
      canonicalRegistry,
      requiredFields
    },
    allErrors
  };
}
