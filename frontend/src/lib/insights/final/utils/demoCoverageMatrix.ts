/**
 * Demo Mode Coverage Matrix for Canonical Performance Insights
 * 
 * Tracks every registered canonical PI through the entire render pipeline
 * to ensure full coverage in Demo Mode for pilot readiness.
 */

import { CANONICAL_PI_REGISTRY, getCanonicalPIById } from '../canonicalInsights';
import { isStressModeEnabled } from '../devStressFixture';
import type { CanonicalInsight } from '../types';
import { piDebugLog } from './logging';

export interface PICoverageRow {
  id: string;
  title: string;
  stage: string;
  registered: boolean;
  active: boolean;
  generatorExpected: boolean;
  emittedByGenerator: boolean;
  validationPassed: boolean;
  adapterPassed: boolean;
  uiFilterPassed: boolean;
  renderedInSidebar: boolean;
  renderedInDetail: boolean;
  missingReason?: string;
  ownerLayer: 'fixture' | 'generator' | 'validation' | 'adapter' | 'ui-filter' | 'registry' | 'inactive' | 'unknown';
}

export interface PICoverageResult {
  registeredCount: number;
  activeCanonicalCount: number;
  generatorEmittedCount: number;
  validationPassedCount: number;
  adapterPassedCount: number;
  uiInputCount: number;
  sidebarRenderedCount: number;
  detailRenderableCount: number;
  missingIds: string[];
  matrix: PICoverageRow[];
}

/**
 * Create coverage matrix for Demo Mode
 */
export function createDemoCoverageMatrix(
  generatedInsights: CanonicalInsight[],
  adaptedInsights: any[],
  renderedInsights: any[]
): PICoverageResult {
  const registry = CANONICAL_PI_REGISTRY;
  const registeredCount = registry.length;
  
  // Identify disabled PIs
  const disabledPIs = ['revert-rate-by-ide', 'executive-ai-reopen-pressure-risk', 'executive-stable-deployment-acceleration'];
  const activeCanonicalCount = registeredCount - disabledPIs.length;
  
  const generatedIds = new Set(generatedInsights.map(i => i.id));
  const adaptedIds = new Set(adaptedInsights.map(i => i.id));
  const renderedIds = new Set(renderedInsights.map(i => i.id));
  
  const matrix: PICoverageRow[] = [];
  const missingIds: string[] = [];
  
  for (const registryEntry of registry) {
    const isDisabled = disabledPIs.includes(registryEntry.id);
    const isGenerated = generatedIds.has(registryEntry.id);
    const isAdapted = adaptedIds.has(registryEntry.id);
    const isRendered = renderedIds.has(registryEntry.id);
    
    let missingReason: string | undefined;
    let ownerLayer: PICoverageRow['ownerLayer'] = 'unknown';
    
    if (isDisabled) {
      missingReason = 'Disabled - requires backend computation';
      ownerLayer = 'inactive';
    } else if (!isGenerated) {
      missingReason = 'Generator did not emit - missing fixture data or generator logic';
      ownerLayer = 'generator';
    } else if (!isAdapted) {
      missingReason = 'Adapter dropped insight - validation or field mapping issue';
      ownerLayer = 'adapter';
    } else if (!isRendered) {
      missingReason = 'UI filter removed insight - display criteria or filtering issue';
      ownerLayer = 'ui-filter';
    }
    
    if (!isDisabled && !isRendered) {
      missingIds.push(registryEntry.id);
    }
    
    matrix.push({
      id: registryEntry.id,
      title: registryEntry.title,
      stage: registryEntry.stage,
      registered: true,
      active: !isDisabled,
      generatorExpected: true,
      emittedByGenerator: isGenerated,
      validationPassed: isGenerated, // Simplified - assume generation implies validation
      adapterPassed: isAdapted,
      uiFilterPassed: isRendered,
      renderedInSidebar: isRendered,
      renderedInDetail: isRendered,
      missingReason,
      ownerLayer
    });
  }
  
  return {
    registeredCount,
    activeCanonicalCount,
    generatorEmittedCount: generatedIds.size,
    validationPassedCount: generatedIds.size,
    adapterPassedCount: adaptedIds.size,
    uiInputCount: adaptedIds.size,
    sidebarRenderedCount: renderedIds.size,
    detailRenderableCount: renderedIds.size,
    missingIds,
    matrix
  };
}

/**
 * Log Demo Mode coverage results (Demo Mode only)
 */
export function logDemoCoverage(coverage: PICoverageResult): void {
  if (!isStressModeEnabled()) {
    return;
  }
  
  piDebugLog('[DEMO_PI_COVERAGE]', {
    registeredCount: coverage.registeredCount,
    activeCanonicalCount: coverage.activeCanonicalCount,
    generatorEmittedCount: coverage.generatorEmittedCount,
    validationPassedCount: coverage.validationPassedCount,
    adapterPassedCount: coverage.adapterPassedCount,
    uiInputCount: coverage.uiInputCount,
    sidebarRenderedCount: coverage.sidebarRenderedCount,
    detailRenderableCount: coverage.detailRenderableCount,
    missingIds: coverage.missingIds
  });
  
  // Expose matrix globally for debugging
  if (typeof window !== 'undefined') {
    (window as any).__FINAL_PI_COVERAGE_MATRIX__ = coverage.matrix;
    console.table(coverage.matrix);
  }
}

/**
 * Validate Demo Mode coverage completeness
 */
export function validateDemoCoverage(coverage: PICoverageResult): {
  isComplete: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  
  if (coverage.missingIds.length > 0) {
    issues.push(`${coverage.missingIds.length} active canonical PIs missing from Demo Mode: ${coverage.missingIds.join(', ')}`);
  }
  
  if (coverage.sidebarRenderedCount < coverage.activeCanonicalCount) {
    issues.push(`Demo Mode rendered ${coverage.sidebarRenderedCount} PIs, expected ${coverage.activeCanonicalCount}`);
  }
  
  const pipelineLoss = coverage.activeCanonicalCount - coverage.sidebarRenderedCount;
  if (pipelineLoss > 0) {
    issues.push(`Pipeline lost ${pipelineLoss} PIs during generation/adapter/UI filtering`);
  }
  
  return {
    isComplete: issues.length === 0,
    issues
  };
}
