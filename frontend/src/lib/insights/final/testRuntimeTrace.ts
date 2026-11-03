/**
 * RUNTIME TRACE TEST HARNESS
 * 
 * Execute runtime trace and capture pipeline evidence
 */

import { executeRuntimeTrace, executeSignalTrace, classifyPIStatus } from './runtimeTrace';

/**
 * Execute complete runtime trace and log results
 */
export async function runRuntimeTraceTest(): Promise<void> {
  console.log('='.repeat(80));
  console.log('FINAL PI ENGINE RUNTIME TRACE TEST');
  console.log('='.repeat(80));
  
  try {
    // Execute runtime pipeline trace
    const pipelineResult = await executeRuntimeTrace();
    
    console.log('\n=== PIPELINE COUNTS ===');
    console.log(`Registry: ${pipelineResult.pipelineCounts.registry}`);
    console.log(`Data Access Complete: ${pipelineResult.pipelineCounts.dataAccessComplete}`);
    console.log(`Session Rows Count: ${pipelineResult.pipelineCounts.sessionRowsCount}`);
    console.log(`GitHub Data Available: ${pipelineResult.pipelineCounts.githubDataAvailable}`);
    console.log(`Generator Produced: ${pipelineResult.pipelineCounts.generatorProduced}`);
    console.log(`Validation Passed: ${pipelineResult.pipelineCounts.validationPassed}`);
    console.log(`Canonical Filtered: ${pipelineResult.pipelineCounts.canonicalFiltered}`);
    console.log(`Realism Processed: ${pipelineResult.pipelineCounts.realismProcessed}`);
    console.log(`Widget Input: ${pipelineResult.pipelineCounts.widgetInput}`);
    
    console.log('\n=== PI STATUS MATRIX ===');
    console.log('PI ID | Stage | Generator Called | Generator Returned | Status | Failure Reason');
    console.log('-'.repeat(100));
    
    for (const status of pipelineResult.piStatuses) {
      const classification = classifyPIStatus(status);
      console.log(`${status.id} | ${status.stage} | ${status.generatorCalled} | ${status.generatorReturned} | ${classification} | ${status.failureReason || '-'}`);
    }
    
    console.log('\n=== RENDERED PIs ===');
    const renderedPIs = pipelineResult.piStatuses.filter(s => classifyPIStatus(s) === 'RENDERED');
    console.log(`Count: ${renderedPIs.length}`);
    renderedPIs.forEach(pi => console.log(`- ${pi.id}`));
    
    console.log('\n=== NON-RENDERED PIs ===');
    const nonRenderedPIs = pipelineResult.piStatuses.filter(s => classifyPIStatus(s) !== 'RENDERED');
    console.log(`Count: ${nonRenderedPIs.length}`);
    nonRenderedPIs.forEach(pi => {
      console.log(`- ${pi.id}: ${pi.failureReason || 'UNKNOWN'}`);
    });
    
    console.log('\n=== SIGNAL TRACE ===');
    console.log('Critical Field Availability:');
    if (pipelineResult.signalTrace.criticalFieldAvailability) {
      for (const [field, availability] of Object.entries(pipelineResult.signalTrace.criticalFieldAvailability)) {
        const info = availability as any;
        console.log(`${field}: ${info.available ? '✅' : '❌'} (${info.nonZeroCount}/${info.totalCount} non-zero)`);
      }
    }
    
    // Execute signal trace
    console.log('\n=== SIGNAL PIPELINE TRACE ===');
    const signalResult = await executeSignalTrace();
    
    console.log('Raw Telemetry:', signalResult.rawTelemetry.available ? '✅' : '❌');
    console.log('Session Aggregation:', signalResult.sessionAggregation.available ? '✅' : '❌');
    console.log('Canonical Session:', signalResult.canonicalSession.available ? '✅' : '❌');
    
    console.log('\n=== FIELD LOSS ANALYSIS ===');
    console.log('Raw Telemetry Fields:', signalResult.rawTelemetry.sampleFields?.length || 0);
    console.log('Session Aggregation Fields:', signalResult.sessionAggregation.sampleFields?.length || 0);
    console.log('Canonical Session Fields:', signalResult.canonicalSession.sampleFields?.length || 0);
    
    // Identify field loss
    const rawFields = new Set(signalResult.rawTelemetry.sampleFields || []);
    const sessionFields = new Set(signalResult.sessionAggregation.sampleFields || []);
    const canonicalFields = new Set(signalResult.canonicalSession.sampleFields || []);
    
    const lostInSession = [...rawFields].filter(f => !sessionFields.has(f));
    const lostInCanonical = [...sessionFields].filter(f => !canonicalFields.has(f));
    
    if (lostInSession.length > 0) {
      console.log('Fields lost in session aggregation:', lostInSession);
    }
    if (lostInCanonical.length > 0) {
      console.log('Fields lost in canonical aggregation:', lostInCanonical);
    }
    
    console.log('\n=== EXECUTION COMPLETE ===');
    
  } catch (error) {
    console.error('RUNTIME TRACE TEST FAILED:', error);
  }
}

/**
 * Execute runtime trace and return structured results for programmatic use
 */
export async function getRuntimeTraceResults(): Promise<{
  pipelineCounts: any;
  piStatuses: any;
  signalTrace: any;
  signalPipeline: any;
  summary: {
    renderedCount: number;
    nonRenderedCount: number;
    totalRegistered: number;
    pipelineEfficiency: number;
    mainBlockers: string[];
  };
}> {
  const pipelineResult = await executeRuntimeTrace();
  const signalResult = await executeSignalTrace();
  
  const renderedPIs = pipelineResult.piStatuses.filter(s => classifyPIStatus(s) === 'RENDERED');
  const nonRenderedPIs = pipelineResult.piStatuses.filter(s => classifyPIStatus(s) !== 'RENDERED');
  
  // Analyze main blockers
  const failureReasons = new Map<string, number>();
  for (const pi of nonRenderedPIs) {
    const reason = pi.failureReason || 'UNKNOWN';
    failureReasons.set(reason, (failureReasons.get(reason) || 0) + 1);
  }
  
  const mainBlockers = Array.from(failureReasons.entries())
    .sort(([,a], [,b]) => b - a)
    .map(([reason]) => reason);
  
  return {
    pipelineCounts: pipelineResult.pipelineCounts,
    piStatuses: pipelineResult.piStatuses,
    signalTrace: pipelineResult.signalTrace,
    signalPipeline: signalResult,
    summary: {
      renderedCount: renderedPIs.length,
      nonRenderedCount: nonRenderedPIs.length,
      totalRegistered: pipelineResult.pipelineCounts.registry,
      pipelineEfficiency: pipelineResult.pipelineCounts.widgetInput / pipelineResult.pipelineCounts.registry,
      mainBlockers
    }
  };
}
