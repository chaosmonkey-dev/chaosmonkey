/**
 * RUNTIME EVIDENCE CAPTURE SCRIPT
 * 
 * Execute this in browser console to capture and document the complete production pipeline evidence
 */

(async function() {
  console.log('='.repeat(80));
  console.log('FINAL PI ENGINE RUNTIME AUDIT - COMPLETE PRODUCTION PIPELINE TRACE');
  console.log('='.repeat(80));
  
  const evidence = {
    timestamp: new Date().toISOString(),
    tenantContext: null,
    pipelineStages: {},
    piMatrix: [],
    consoleEvidence: []
  };

  // Capture all console output
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  
  function captureLog(type, ...args) {
    const message = args.join(' ');
    evidence.consoleEvidence.push({
      type,
      message,
      timestamp: Date.now()
    });
    
    // Call original function
    if (type === 'log') originalLog.apply(console, args);
    else if (type === 'warn') originalWarn.apply(console, args);
    else if (type === 'error') originalError.apply(console, args);
  }
  
  console.log = (...args) => captureLog('log', ...args);
  console.warn = (...args) => captureLog('warn', ...args);
  console.error = (...args) => captureLog('error', ...args);

  try {
    // Wait for page to load and execute PI pipeline
    console.log('[CAPTURE][WAITING]', 'Waiting for PI pipeline to execute...');
    
    // Give the page time to execute the PI pipeline
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Extract evidence from console logs
    const runtimeAuditLogs = evidence.consoleEvidence.filter(log => 
      log.message.includes('[PI_TRACE]')
    );
    
    console.log('[CAPTURE][EXTRACTING]', 'Extracting evidence from console logs...');
    
    // Parse registry count
    const registryLog = runtimeAuditLogs.find(log => 
      log.message.includes('[PI_TRACE][REGISTRY]')
    );
    
    if (registryLog) {
      const countMatch = registryLog.message.match(/count=(\d+)/);
      evidence.pipelineStages.registryCount = countMatch ? parseInt(countMatch[1]) : 0;
    }
    
    // Parse final array
    const finalLog = runtimeAuditLogs.find(log => 
      log.message.includes('[PI_TRACE][FINAL]')
    );
    
    if (finalLog) {
      const countMatch = finalLog.message.match(/count=(\d+)/);
      evidence.pipelineStages.engineOutputCount = countMatch ? parseInt(countMatch[1]) : 0;
    }
    
    // Parse per-PI evidence
    const piEvidence = {};
    
    // Process each PI_TRACE log
    runtimeAuditLogs.forEach(log => {
      const message = log.message;
      
      // Parse generator start
      const generatorMatch = message.match(/\[PI_TRACE\]\[GENERATOR_START\] id=(.+)/);
      if (generatorMatch) {
        const piId = generatorMatch[1];
        if (!piEvidence[piId]) piEvidence[piId] = {};
        piEvidence[piId].generatorCalled = true;
        piEvidence[piId].generatorStartLog = message;
      }
      
      // Parse generator result
      const resultMatch = message.match(/\[PI_TRACE\]\[GENERATOR_RESULT\] id=(.+) result=(.+)/);
      if (resultMatch) {
        const piId = resultMatch[1];
        const result = resultMatch[2];
        if (!piEvidence[piId]) piEvidence[piId] = {};
        piEvidence[piId].generatorResult = result;
        piEvidence[piId].generatorResultLog = message;
      }
      
      // Parse validation
      const validationMatch = message.match(/\[PI_TRACE\]\[VALIDATION\] id=(.+) result=(.+)/);
      if (validationMatch) {
        const piId = validationMatch[1];
        const result = validationMatch[2];
        if (!piEvidence[piId]) piEvidence[piId] = {};
        piEvidence[piId].validationResult = result;
        piEvidence[piId].validationLog = message;
      }
      
      // Parse final
      const finalMatch = message.match(/\[PI_TRACE\]\[FINAL\] id=(.+) result=(.+)/);
      if (finalMatch) {
        const piId = finalMatch[1];
        const result = finalMatch[2];
        if (!piEvidence[piId]) piEvidence[piId] = {};
        piEvidence[piId].finalResult = result;
        piEvidence[piId].finalLog = message;
      }
    });
    
    // Build evidence matrix
    Object.entries(piEvidence).forEach(([piId, evidence]) => {
      const rendered = evidence.finalResult === 'RENDERED';
      
      evidence.piMatrix.push({
        pi: piId,
        registered: '✅',
        generatorCalled: evidence.generatorCalled ? '✅' : '❌',
        returnedInsight: evidence.generatorResult === 'INSIGHT' ? '✅' : '❌',
        returnedNull: evidence.generatorResult === 'NULL' ? '✅' : '❌',
        validationPass: evidence.validationResult === 'PASS' ? '✅' : '❌',
        validationFail: evidence.validationResult === 'FAIL' ? '✅' : '❌',
        filtered: evidence.finalResult === 'FILTERED' ? '✅' : '❌',
        rendered: rendered ? '✅' : '❌',
        evidence: {
          generatorStartLog: evidence.generatorStartLog,
          generatorResultLog: evidence.generatorResultLog,
          validationLog: evidence.validationLog,
          finalLog: evidence.finalLog
        }
      });
    });
    
    // Generate summary
    const renderedCount = evidence.piMatrix.filter(pi => pi.rendered === '✅').length;
    const totalCount = evidence.piMatrix.length;
    
    console.log('\n=== RUNTIME AUDIT RESULTS ===');
    console.log('Timestamp:', evidence.timestamp);
    console.log('Tenant Context:', evidence.tenantContext);
    console.log('Registry Count:', evidence.pipelineStages.registryCount);
    console.log('Engine Output Count:', evidence.pipelineStages.engineOutputCount);
    console.log('Rendered Count:', renderedCount);
    console.log('Total Count:', totalCount);
    console.log('Pipeline Efficiency:', `${(renderedCount / totalCount * 100).toFixed(1)}%`);
    
    console.log('\n=== RUNTIME TRUTH TABLE ===');
    console.log('PI_ID | REGISTERED | GENERATOR_CALLED | RETURNED_INSIGHT | RETURNED_NULL | VALIDATION_PASS | VALIDATION_FAIL | FILTERED | RENDERED | EVIDENCE');
    console.log('-'.repeat(200));
    
    evidence.piMatrix.forEach(pi => {
      const evidenceLog = pi.evidence.generatorResultLog || pi.evidence.validationLog || pi.evidence.finalLog || 'No evidence';
      console.log(`${pi.pi} | ${pi.registered} | ${pi.generatorCalled} | ${pi.returnedInsight} | ${pi.returnedNull} | ${pi.validationPass} | ${pi.validationFail} | ${pi.filtered} | ${pi.rendered} | ${evidenceLog}`);
    });
    
    console.log('\n=== EXECUTIVE SUMMARY ===');
    console.log(`Expected PI Count: ${totalCount}`);
    console.log(`Actual PI Count: ${renderedCount}`);
    console.log(`Missing PI Count: ${totalCount - renderedCount}`);
    console.log(`Pipeline Efficiency: ${(renderedCount / totalCount * 100).toFixed(1)}%`);
    
    // Classification summary
    const classifications = {};
    evidence.piMatrix.forEach(pi => {
      let classification = 'UNKNOWN';
      if (pi.rendered === '✅') classification = 'RENDERED';
      else if (pi.failureStage === 'NOT_RENDERED') classification = 'NO_DATA';
      else if (pi.failureReason.includes('error')) classification = 'VALIDATION_FAILED';
      else if (!pi.generatorCalled) classification = 'BUG';
      
      classifications[classification] = (classifications[classification] || 0) + 1;
    });
    
    console.log('Classification Summary:');
    Object.entries(classifications).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
    
    // Identify root causes
    const failureReasons = {};
    evidence.piMatrix.filter(pi => !pi.rendered).forEach(pi => {
      const reason = pi.failureReason;
      failureReasons[reason] = (failureReasons[reason] || 0) + 1;
    });
    
    console.log('\nRoot Cause Analysis:');
    Object.entries(failureReasons).forEach(([reason, count]) => {
      console.log(`  ${reason}: ${count} PIs`);
    });
    
    console.log('\n=== RUNTIME EVIDENCE CAPTURE COMPLETE ===');
    console.log('All evidence captured from actual production pipeline execution');
    
    // Store evidence for documentation
    window.__RUNTIME_AUDIT_EVIDENCE__ = evidence;
    console.log('Evidence stored in window.__RUNTIME_AUDIT_EVIDENCE__');
    
  } catch (error) {
    console.error('RUNTIME EVIDENCE CAPTURE FAILED:', error);
  } finally {
    // Restore original console functions
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
})();
