/**
 * RUNTIME AUDIT EXECUTION SCRIPT
 * 
 * Execute this in browser console on http://127.0.0.1:5174/dashboards?v2=1
 * 
 * This will trace the actual production PI pipeline from UI entrypoint to rendered insights
 */

(async function() {
  console.log('='.repeat(80));
  console.log('FINAL PI ENGINE RUNTIME AUDIT - PRODUCTION PIPELINE TRACE');
  console.log('='.repeat(80));
  
  try {
    // Import the runtime audit functions
    const { executeRuntimeAudit, generatePIMatrix, classifyPIStatus } = await import('./runtimeAudit.js');
    
    // Execute the complete runtime audit
    console.log('🔍 EXECUTING RUNTIME AUDIT...');
    const auditResult = await executeRuntimeAudit();
    
    console.log('\n=== TENANT CONTEXT ===');
    console.log('Authenticated User:', auditResult.tenantContext.authenticatedUser ? '✅' : '❌');
    console.log('Active Organization:', auditResult.tenantContext.activeOrganization ? '✅' : '❌');
    console.log('Organization ID:', auditResult.tenantContext.orgId || 'NULL');
    console.log('Tenant Scope:', auditResult.tenantContext.tenantScope ? '✅' : '❌');
    console.log('Telemetry Count:', auditResult.tenantContext.telemetryCount);
    console.log('GitHub Count:', auditResult.tenantContext.githubCount);
    
    console.log('\n=== PIPELINE STAGE COUNTS ===');
    console.log('Registry Count:', auditResult.pipelineCounts.registryCount);
    console.log('Generator Called Count:', auditResult.pipelineCounts.generatorCalledCount);
    console.log('Generator Returned Count:', auditResult.pipelineCounts.generatorReturnedCount);
    console.log('Validation Passed Count:', auditResult.pipelineCounts.validationPassedCount);
    console.log('Threshold Passed Count:', auditResult.pipelineCounts.thresholdPassedCount);
    console.log('Dedup Passed Count:', auditResult.pipelineCounts.dedupPassedCount);
    console.log('Filter Passed Count:', auditResult.pipelineCounts.filterPassedCount);
    console.log('UI Input Count:', auditResult.pipelineCounts.uiInputCount);
    console.log('Rendered Count:', auditResult.pipelineCounts.renderedCount);
    
    console.log('\n=== PI STATUS MATRIX ===');
    const matrix = generatePIMatrix(auditResult.piStatuses);
    matrix.forEach((row, index) => {
      if (index === 0) {
        console.log(row.join(' | '));
        console.log('-'.repeat(120));
      } else {
        console.log(row.join(' | '));
      }
    });
    
    console.log('\n=== CONSOLE EVIDENCE ===');
    console.log('Total console lines captured:', auditResult.consoleEvidence.length);
    
    // Show evidence for each non-rendered PI
    const nonRenderedPIs = auditResult.piStatuses.filter(pi => !pi.rendered);
    console.log('\n=== NON-RENDERED PIs ANALYSIS ===');
    console.log('Total non-rendered PIs:', nonRenderedPIs.length);
    
    for (const pi of nonRenderedPIs) {
      console.log(`\n🔍 ${pi.id}:`);
      console.log(`  Stage: ${pi.failureStage}`);
      console.log(`  Reason: ${pi.failureReason}`);
      
      // Show relevant console evidence
      const relevantEvidence = auditResult.consoleEvidence.filter(line => 
        line.includes(pi.id) && (
          line.includes('[FINAL_PI_TRACE]') || 
          line.includes('[RUNTIME_TRACE]') ||
          line.includes('[FINAL_PI_ENGINE]')
        )
      );
      
      if (relevantEvidence.length > 0) {
        console.log('  Evidence:');
        relevantEvidence.forEach(line => {
          console.log(`    ${line}`);
        });
      } else {
        console.log('  Evidence: NO_CONSOLE_EVIDENCE_FOUND');
      }
    }
    
    console.log('\n=== RENDERED PIs ===');
    const renderedPIs = auditResult.piStatuses.filter(pi => pi.rendered);
    console.log('Total rendered PIs:', renderedPIs.length);
    renderedPIs.forEach(pi => {
      console.log(`✅ ${pi.id}`);
    });
    
    console.log('\n=== CLASSIFICATION SUMMARY ===');
    const classifications = {};
    for (const pi of auditResult.piStatuses) {
      const classification = classifyPIStatus(pi);
      classifications[classification] = (classifications[classification] || 0) + 1;
    }
    
    console.log('Classification counts:');
    Object.entries(classifications).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
    
    console.log('\n=== EXECUTIVE SUMMARY ===');
    console.log(`Expected PI Count: ${auditResult.pipelineCounts.registryCount}`);
    console.log(`Actual PI Count: ${auditResult.pipelineCounts.renderedCount}`);
    console.log(`Missing PI Count: ${auditResult.pipelineCounts.registryCount - auditResult.pipelineCounts.renderedCount}`);
    console.log(`Pipeline Efficiency: ${(auditResult.pipelineCounts.renderedCount / auditResult.pipelineCounts.registryCount * 100).toFixed(1)}%`);
    
    // Identify most common failure stage
    const failureStages = {};
    for (const pi of nonRenderedPIs) {
      failureStages[pi.failureStage] = (failureStages[pi.failureStage] || 0) + 1;
    }
    
    const mostCommonFailure = Object.entries(failureStages)
      .sort(([,a], [,b]) => b - a)[0];
    
    console.log(`Most Common Failure: ${mostCommonFailure ? mostCommonFailure[0] : 'NONE'} (${mostCommonFailure ? mostCommonFailure[1] : 0} PIs)`);
    
    console.log('\n=== RUNTIME AUDIT COMPLETE ===');
    console.log('All evidence captured above is from actual production pipeline execution');
    
  } catch (error) {
    console.error('RUNTIME AUDIT EXECUTION FAILED:', error);
    
    // Fallback: try to capture basic evidence
    console.log('\n=== FALLBACK EVIDENCE CAPTURE ===');
    
    try {
      // Try to call the FINAL PI engine directly
      const { generateFinalCanonicalInsights } = await import('./index.js');
      
      console.log('🔍 Calling generateFinalCanonicalInsights directly...');
      const insights = await generateFinalCanonicalInsights();
      
      console.log(`Direct engine result: ${insights.length} insights`);
      console.log('Insight IDs:', insights.map(i => i.id));
      
      // Try to get registry count
      try {
        const { getCanonicalPIIds } = await import('./canonicalInsights.js');
        const registryCount = getCanonicalPIIds().size;
        console.log(`Registry count: ${registryCount}`);
        console.log(`Pipeline efficiency: ${insights.length}/${registryCount} = ${(insights.length/registryCount*100).toFixed(1)}%`);
      } catch (e) {
        console.log('Registry count: ERROR');
      }
      
    } catch (e) {
      console.error('FALLBACK ALSO FAILED:', e);
    }
  }
})();
