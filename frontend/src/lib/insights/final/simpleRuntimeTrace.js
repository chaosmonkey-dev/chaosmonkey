/**
 * Simple Runtime Trace Script
 * Execute this in browser console on http://127.0.0.1:5174/dashboards?v2=1
 */

(async function() {
  console.log('=== FINAL PI RUNTIME TRACE ===');
  
  try {
    // Import the FINAL PI engine
    const { generateFinalCanonicalInsights } = await import('./index.js');
    
    console.log('🔍 Executing FINAL PI generation with runtime trace...');
    
    // Execute FINAL PI generation - this will trigger all [PI_TRACE] logs
    const startTime = Date.now();
    const insights = await generateFinalCanonicalInsights();
    const endTime = Date.now();
    
    console.log('\n=== RUNTIME RESULTS ===');
    console.log(`Execution time: ${endTime - startTime}ms`);
    console.log(`Total insights generated: ${insights.length}`);
    console.log(`Insight IDs:`, insights.map(i => i.id));
    
    // Get registry for comparison
    try {
      const { getCanonicalPIIds } = await import('./canonicalInsights.js');
      const registryIds = Array.from(getCanonicalPIIds());
      
      console.log('\n=== REGISTRY vs RENDERED ===');
      console.log(`Registry count: ${registryIds.length}`);
      console.log(`Rendered count: ${insights.length}`);
      
      // Identify missing PIs
      const renderedIds = insights.map(i => i.id);
      const missingIds = registryIds.filter(id => !renderedIds.includes(id));
      
      console.log('\n=== MISSING PIs ===');
      console.log(`Total missing: ${missingIds.length}`);
      missingIds.forEach(id => console.log(`- ${id}`));
      
      console.log('\n=== EVIDENCE ANALYSIS ===');
      console.log('Check console logs above for [PI_TRACE] entries:');
      console.log('1. [PI_TRACE][REGISTRY] count=X');
      console.log('2. [PI_TRACE][GENERATOR_START] id=...');
      console.log('3. [PI_TRACE][GENERATOR_RESULT] id=... result=INSIGHT|NULL');
      console.log('4. [PI_TRACE][VALIDATION] id=... result=PASS|FAIL');
      console.log('5. [PI_TRACE][FINAL] id=... result=RENDERED|FILTERED');
      console.log('6. [PI_TRACE][FINAL] count=X');
      console.log('7. [PI_TRACE][FINAL_IDS] [...array]');
      
      console.log('\n=== RUNTIME TRACE COMPLETE ===');
      console.log('All evidence captured from console logs above');
      
    } catch (e) {
      console.log('Registry analysis failed:', e.message);
    }
    
  } catch (error) {
    console.error('❌ Runtime trace failed:', error);
  }
})();
