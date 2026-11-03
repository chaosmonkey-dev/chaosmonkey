/**
 * RUNTIME TRACE EXECUTION SCRIPT
 * 
 * Execute this in browser console to capture runtime evidence
 * 
 * Usage:
 * 1. Open http://127.0.0.1:5174/dashboards?v2=1
 * 2. Open browser console
 * 3. Copy-paste this script and execute
 */

(async function() {
  console.log('=== FINAL PI ENGINE RUNTIME TRACE EXECUTION ===');
  
  try {
    // Import the runtime trace functions
    const { runRuntimeTraceTest } = await import('./runtimeTrace.js');
    
    // Execute the test
    await runRuntimeTraceTest();
    
  } catch (error) {
    console.error('RUNTIME TRACE EXECUTION FAILED:', error);
    
    // Fallback: manually trace the pipeline
    console.log('=== FALLBACK MANUAL TRACE ===');
    
    try {
      // Import the final PI engine
      const { generateFinalCanonicalInsights } = await import('./index.js');
      
      console.log('1. Calling generateFinalCanonicalInsights...');
      const insights = await generateFinalCanonicalInsights();
      
      console.log('2. Pipeline Results:');
      console.log(`   - Generated: ${insights.length}`);
      console.log(`   - IDs: ${insights.map(i => i.id).join(', ')}`);
      
      // Try to get registry count
      try {
        const { getCanonicalPIIds } = await import('./canonicalInsights.js');
        const registryCount = getCanonicalPIIds().size;
        console.log(`   - Registry Count: ${registryCount}`);
        console.log(`   - Pipeline Efficiency: ${insights.length}/${registryCount} = ${(insights.length/registryCount*100).toFixed(1)}%`);
      } catch (e) {
        console.log('   - Registry Count: ERROR');
      }
      
      // Try to get data access info
      try {
        // Check if we're in stress/demo mode - if so, skip real API calls
        const isStressMode = typeof window !== 'undefined' && (
          window.location.search.includes('piStress=1') || 
          window.location.search.includes('demoMode=1')
        );
        
        const { fetchCanonicalInsightInput } = await import('./dataAccess.js');
        const input = isStressMode ? {
          sessionRows: [],
          githubSnapshot: undefined,
          githubByPeriod: [],
          productivityByPeriod: [],
          granularity: 'week'
        } : await fetchCanonicalInsightInput('week');
        console.log(`   - Session Rows: ${input.sessionRows?.length || 0}`);
        console.log(`   - GitHub Data: ${!!input.githubSnapshot}`);
        console.log(`   - Sample Session Fields: ${input.sessionRows?.[0] ? Object.keys(input.sessionRows[0]).length : 0}`);
        
        // Check critical fields
        if (input.sessionRows?.[0]) {
          const sample = input.sessionRows[0];
          const criticalFields = [
            'session_active_coding_duration_minutes',
            'session_duration_minutes',
            'ai_burst_count',
            'time_to_first_commit_ms',
            'lines_added_total',
            'lines_removed_total_est',
            'tool',
            'session_quality_band',
            'focus_ratio',
            'debug_time_ms',
            'terminal_active_time_ms',
            'session_commits'
          ];
          
          console.log('   - Critical Field Availability:');
          criticalFields.forEach(field => {
            const available = field in sample;
            const nonZero = sample[field] && sample[field] !== 0;
            console.log(`     ${field}: ${available ? '✅' : '❌'} ${nonZero ? '(non-zero)' : '(zero/missing)'}`);
          });
        }
        
      } catch (e) {
        console.log('   - Data Access: ERROR');
      }
      
    } catch (e) {
      console.error('FALLBACK TRACE FAILED:', e);
    }
  }
})();
