/**
 * Test script to validate FINAL PI API path fix
 * Execute this in browser console on http://127.0.0.1:5174/dashboards?v2=1
 */

(async function() {
  console.log('=== FINAL PI API PATH FIX VALIDATION ===');
  
  try {
    // Import the FINAL PI engine
    const { generateFinalCanonicalInsights } = await import('./index.js');
    
    console.log('🔍 Testing FINAL PI generation after API path fix...');
    
    // Execute FINAL PI generation
    const startTime = Date.now();
    const insights = await generateFinalCanonicalInsights();
    const endTime = Date.now();
    
    console.log('=== RESULTS ===');
    console.log(`Execution time: ${endTime - startTime}ms`);
    console.log(`Total insights generated: ${insights.length}`);
    console.log(`Insight IDs:`, insights.map(i => i.id));
    
    // Validate against registry
    try {
      const { getCanonicalPIIds } = await import('./canonicalInsights.js');
      const registryCount = getCanonicalPIIds().size;
      
      console.log('\n=== PIPELINE ANALYSIS ===');
      console.log(`Registry count: ${registryCount}`);
      console.log(`Generated count: ${insights.length}`);
      console.log(`Pipeline efficiency: ${(insights.length / registryCount * 100).toFixed(1)}%`);
      
      // Analyze by stage
      const stages = {
        'plan-code': 0,
        'review-merge': 0,
        'deploy-operate': 0
      };
      
      insights.forEach(insight => {
        if (stages[insight.stage] !== undefined) {
          stages[insight.stage]++;
        }
      });
      
      console.log('\n=== STAGE BREAKDOWN ===');
      console.log(`Plan & Code: ${stages['plan-code']} insights`);
      console.log(`Review & Merge: ${stages['review-merge']} insights`);
      console.log(`Deploy & Operate: ${stages['deploy-operate']} insights`);
      
      // Identify missing PIs
      const generatedIds = new Set(insights.map(i => i.id));
      const allIds = getCanonicalPIIds();
      const missingIds = Array.from(allIds).filter(id => !generatedIds.has(id));
      
      if (missingIds.length > 0) {
        console.log('\n=== MISSING PIS ===');
        console.log(`Total missing: ${missingIds.length}`);
        missingIds.forEach(id => console.log(`- ${id}`));
      } else {
        console.log('\n✅ ALL REGISTRY PIs GENERATED');
      }
      
    } catch (e) {
      console.log('Registry analysis failed:', e.message);
    }
    
    console.log('\n=== API PATH FIX VALIDATION COMPLETE ===');
    
  } catch (error) {
    console.error('❌ FINAL PI generation failed:', error);
    
    // Check for API path issues
    if (error.message.includes('fetch') || error.message.includes('CORS')) {
      console.log('\n🔍 Possible API path issue detected');
      console.log('Check browser network tab for failed requests');
    }
  }
})();
