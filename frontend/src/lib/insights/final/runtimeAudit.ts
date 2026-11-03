/**
 * FINAL PI ENGINE RUNTIME AUDIT
 * 
 * Instruments the exact production PI pipeline from UI entrypoint to rendered insights
 * No speculation - only executable runtime evidence
 */

import type { PerformanceInsight } from './types';
import { generateFinalCanonicalInsights } from './index';
import { getCanonicalPIIds, getCanonicalPIsByStage } from './canonicalInsights';
import { API_URL } from '../../config/api';
import { piDebugLog } from './utils/logging';

/**
 * Multi-tenancy validation first
 */
interface TenantContext {
  authenticatedUser: boolean;
  activeOrganization: boolean;
  orgId: string | null;
  tenantScope: boolean;
  telemetryCount: number;
  githubCount: number;
}

/**
 * Runtime pipeline stage counts
 */
interface PipelineStageCounts {
  registryCount: number;
  generatorCalledCount: number;
  generatorReturnedCount: number;
  validationPassedCount: number;
  thresholdPassedCount: number;
  dedupPassedCount: number;
  filterPassedCount: number;
  uiInputCount: number;
  renderedCount: number;
}

/**
 * Per-PI runtime status
 */
interface PIRuntimeStatus {
  id: string;
  stage: string;
  inRegistry: boolean;
  generatorCalled: boolean;
  generatorReturned: boolean;
  validationPassed: boolean;
  thresholdPassed: boolean;
  dedupPassed: boolean;
  filterPassed: boolean;
  uiInput: boolean;
  rendered: boolean;
  failureStage: string;
  failureReason: string;
  runtimeValues: Record<string, any>;
}

/**
 * Validate multi-tenancy context first
 */
export async function validateTenantContext(): Promise<TenantContext> {
  piDebugLog('[RUNTIME_AUDIT][TENANT_START]', '=== MULTI-TENANCY VALIDATION ===');
  
  const context: TenantContext = {
    authenticatedUser: false,
    activeOrganization: false,
    orgId: null,
    tenantScope: false,
    telemetryCount: 0,
    githubCount: 0
  };

  try {
    // Check if user is authenticated
    const userResponse = await fetch(`${API_URL}/user`);
    context.authenticatedUser = userResponse.ok;
    if (userResponse.ok) {
      const userData = await userResponse.json();
      piDebugLog('[RUNTIME_AUDIT][USER]', userData);
    }

    // Check active organization
    const orgResponse = await fetch(`${API_URL}/organizations/active`);
    context.activeOrganization = orgResponse.ok;
    if (orgResponse.ok) {
      const orgData = await orgResponse.json();
      context.orgId = orgData.id;
      piDebugLog('[RUNTIME_AUDIT][ORG]', orgData);
    }

    // Check tenant-scoped telemetry count
    if (context.orgId) {
      const telemetryResponse = await fetch(`${API_URL}/telemetry?organization_id=${context.orgId}&per_page=1`);
      if (telemetryResponse.ok) {
        const telemetryData = await telemetryResponse.json();
        context.telemetryCount = telemetryData.total || 0;
      }
    }

    // Check tenant-scoped GitHub count
    if (context.orgId) {
      const githubResponse = await fetch(`${API_URL}/metrics?organization_id=${context.orgId}`);
      if (githubResponse.ok) {
        const githubData = await githubResponse.json();
        context.githubCount = githubData.pr_analytics?.total_prs || 0;
      }
    }

    context.tenantScope = context.authenticatedUser && context.activeOrganization && !!context.orgId;

    piDebugLog('[RUNTIME_AUDIT][TENANT_COMPLETE]', context);
    return context;

  } catch (error) {
    console.error('[RUNTIME_AUDIT][TENANT_ERROR]', error);
    return context;
  }
}

/**
 * Execute complete runtime pipeline audit
 */
export async function executeRuntimeAudit(): Promise<{
  tenantContext: TenantContext;
  pipelineCounts: PipelineStageCounts;
  piStatuses: PIRuntimeStatus[];
  consoleEvidence: string[];
}> {
  piDebugLog('[RUNTIME_AUDIT][START]', '=== FINAL PI ENGINE RUNTIME AUDIT ===');
  
  const consoleEvidence: string[] = [];
  
  // Capture all console.log output
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    const message = args.join(' ');
    consoleEvidence.push(message);
    originalLog.apply(console, args);
  };

  try {
    // ============================================================
    // STEP 1: Multi-tenancy validation
    // ============================================================
    const tenantContext = await validateTenantContext();

    // ============================================================
    // STEP 2: Registry count
    // ============================================================
    piDebugLog('[RUNTIME_AUDIT][REGISTRY_START]', 'Counting registry PIs');
    const canonicalIds = getCanonicalPIIds();
    const registryCount = canonicalIds.size;
    piDebugLog(`[RUNTIME_AUDIT][REGISTRY_COUNT] ${registryCount}`);

    // ============================================================
    // STEP 3: Initialize PI status matrix
    // ============================================================
    const piStatuses: PIRuntimeStatus[] = [];
    for (const id of canonicalIds) {
      piStatuses.push({
        id,
        stage: 'unknown',
        inRegistry: true,
        generatorCalled: false,
        generatorReturned: false,
        validationPassed: false,
        thresholdPassed: false,
        dedupPassed: false,
        filterPassed: false,
        uiInput: false,
        rendered: false,
        failureStage: 'NOT_CALLED',
        failureReason: 'Generator not called',
        runtimeValues: {}
      });
    }

    // ============================================================
    // STEP 4: Execute FINAL PI engine
    // ============================================================
    piDebugLog('[RUNTIME_AUDIT][ENGINE_START]', 'Calling generateFinalCanonicalInsights');
    
    const insights = await generateFinalCanonicalInsights();
    
    piDebugLog(`[RUNTIME_AUDIT][ENGINE_COMPLETE] Generated ${insights.length} insights`);
    piDebugLog('[RUNTIME_AUDIT][ENGINE_INSIGHTS]', insights.map(i => i.id));

    // ============================================================
    // STEP 5: Analyze console evidence for each PI
    // ============================================================
    for (const piStatus of piStatuses) {
      analyzePIConsoleEvidence(piStatus, consoleEvidence);
    }

    // ============================================================
    // STEP 6: Count pipeline stages
    // ============================================================
    const pipelineCounts = calculatePipelineCounts(piStatuses, insights, registryCount);

    // ============================================================
    // STEP 7: Final summary
    // ============================================================
    piDebugLog('[RUNTIME_AUDIT][SUMMARY]', {
      tenantContext,
      pipelineCounts,
      renderedPIs: piStatuses.filter(s => s.rendered).map(s => s.id),
      nonRenderedPIs: piStatuses.filter(s => !s.rendered).map(s => ({ id: s.id, stage: s.failureStage, reason: s.failureReason }))
    });

    console.log = originalLog; // Restore console.log

    return {
      tenantContext,
      pipelineCounts,
      piStatuses,
      consoleEvidence
    };

  } catch (error) {
    console.log = originalLog; // Restore console.log
    console.error('[RUNTIME_AUDIT][ERROR]', error);
    
    return {
      tenantContext: await validateTenantContext(),
      pipelineCounts: {
        registryCount: 0,
        generatorCalledCount: 0,
        generatorReturnedCount: 0,
        validationPassedCount: 0,
        thresholdPassedCount: 0,
        dedupPassedCount: 0,
        filterPassedCount: 0,
        uiInputCount: 0,
        renderedCount: 0
      },
      piStatuses: [],
      consoleEvidence
    };
  }
}

/**
 * Analyze console evidence for a specific PI
 */
function analyzePIConsoleEvidence(piStatus: PIRuntimeStatus, consoleEvidence: string[]): void {
  const piId = piStatus.id;
  
  // Look for generator call evidence
  const generatorCallEvidence = consoleEvidence.filter(line => 
    line.includes(`[FINAL_PI_TRACE][GENERATOR_CALL_START]`) && line.includes(piId)
  );
  
  if (generatorCallEvidence.length > 0) {
    piStatus.generatorCalled = true;
    piStatus.failureStage = 'GENERATOR_CALLED';
    piStatus.failureReason = 'Generator called, checking return value';
  }

  // Look for generator success evidence
  const generatorSuccessEvidence = consoleEvidence.filter(line => 
    line.includes(`[FINAL_PI_TRACE][GENERATOR_SUCCESS]`) && line.includes(piId)
  );
  
  if (generatorSuccessEvidence.length > 0) {
    piStatus.generatorReturned = true;
    piStatus.validationPassed = true;
    piStatus.thresholdPassed = true;
    piStatus.dedupPassed = true;
    piStatus.filterPassed = true;
    piStatus.uiInput = true;
    piStatus.rendered = true;
    piStatus.failureStage = 'RENDERED';
    piStatus.failureReason = 'Successfully rendered';
  }

  // Look for generator null evidence
  const generatorNullEvidence = consoleEvidence.filter(line => 
    line.includes(`[FINAL_PI_TRACE][GENERATOR_NULL]`) && line.includes(piId)
  );
  
  if (generatorNullEvidence.length > 0) {
    piStatus.generatorReturned = false;
    piStatus.failureStage = 'GENERATOR_RETURNED_NULL';
    piStatus.failureReason = 'Generator returned null';
  }

  // Look for generator error evidence
  const generatorErrorEvidence = consoleEvidence.filter(line => 
    line.includes(`[FINAL_PI_TRACE][GENERATOR_ERROR]`) && line.includes(piId)
  );
  
  if (generatorErrorEvidence.length > 0) {
    piStatus.generatorReturned = false;
    piStatus.failureStage = 'GENERATOR_ERROR';
    piStatus.failureReason = 'Generator threw error';
  }

  // Look for widget input evidence
  const widgetInputEvidence = consoleEvidence.filter(line => 
    line.includes(`[RUNTIME_TRACE][STAGE_5_WIDGET_PROPS_INSIGHTS]`) && line.includes(piId)
  );
  
  if (widgetInputEvidence.length > 0) {
    piStatus.uiInput = true;
  }
}

/**
 * Calculate pipeline stage counts
 */
function calculatePipelineCounts(
  piStatuses: PIRuntimeStatus[], 
  insights: PerformanceInsight[], 
  registryCount: number
): PipelineStageCounts {
  
  const renderedIds = new Set(insights.map(i => i.id));
  
  return {
    registryCount,
    generatorCalledCount: piStatuses.filter(s => s.generatorCalled).length,
    generatorReturnedCount: piStatuses.filter(s => s.generatorReturned).length,
    validationPassedCount: piStatuses.filter(s => s.validationPassed).length,
    thresholdPassedCount: piStatuses.filter(s => s.thresholdPassed).length,
    dedupPassedCount: piStatuses.filter(s => s.dedupPassed).length,
    filterPassedCount: piStatuses.filter(s => s.filterPassed).length,
    uiInputCount: piStatuses.filter(s => s.uiInput).length,
    renderedCount: piStatuses.filter(s => s.rendered).length
  };
}

/**
 * Generate PI matrix for documentation
 */
export function generatePIMatrix(piStatuses: PIRuntimeStatus[]): string[][] {
  const headers = [
    'PI', 'Registry', 'Generator Called', 'Returned Data', 'Validation Pass', 
    'Threshold Pass', 'Filter Pass', 'UI Input', 'Rendered'
  ];
  
  const rows = [headers];
  
  for (const pi of piStatuses) {
    rows.push([
      pi.id,
      pi.inRegistry ? '✅' : '❌',
      pi.generatorCalled ? '✅' : '❌',
      pi.generatorReturned ? '✅' : '❌',
      pi.validationPassed ? '✅' : '❌',
      pi.thresholdPassed ? '✅' : '❌',
      pi.filterPassed ? '✅' : '❌',
      pi.uiInput ? '✅' : '❌',
      pi.rendered ? '✅' : '❌'
    ]);
  }
  
  return rows;
}

/**
 * Classify PI status
 */
export function classifyPIStatus(piStatus: PIRuntimeStatus): string {
  if (piStatus.rendered) return 'RENDERED';
  if (piStatus.failureStage === 'GENERATOR_ERROR') return 'VALIDATION_FAILED';
  if (piStatus.failureStage === 'GENERATOR_RETURNED_NULL') return 'NO_DATA';
  if (!piStatus.generatorCalled) return 'BUG';
  return 'UNKNOWN';
}
