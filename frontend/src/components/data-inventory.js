// DATA INVENTORY SCRIPT
// Run this in browser console on Performance Insights page

console.log('=== PERFORMANCE INSIGHTS DATA INVENTORY ===');

// 1. INSPECT PROPS
console.log('\n📊 PROPS DATA:');
console.log('props.insights:', props.insights);
console.log('props.metrics:', props.metrics);
console.log('props.telemetry:', props.telemetry);
console.log('props.ideDiagnostics:', props.ideDiagnostics);

// 2. SAMPLE FIRST INSIGHT
if (props.insights && props.insights.length > 0) {
  console.log('\n🔍 SAMPLE INSIGHT STRUCTURE:');
  const sample = props.insights[0];
  console.log('Sample insight keys:', Object.keys(sample));
  console.log('Sample insight:', JSON.stringify(sample, null, 2));
}

// 3. CALL API ENDPOINTS DIRECTLY
async function inventoryAPIs() {
  console.log('\n🌐 API ENDPOINT INVENTORY:');
  
  try {
    // Telemetry
    const telemetry = await fetch('/api/telemetry');
    console.log('TELEMETRY RESPONSE:', await telemetry.clone().json());
    
    // Sessions
    const sessions = await fetch('/api/telemetry/sessions');
    console.log('SESSIONS RESPONSE:', await sessions.clone().json());
    
    // Metrics
    const metrics = await fetch('/api/metrics');
    console.log('METRICS RESPONSE:', await metrics.clone().json());
    
  } catch (error) {
    console.error('API ERROR:', error);
  }
}

// 4. RUN INVENTORY
inventoryAPIs();

// 5. DATA MODEL ANALYSIS
console.log('\n📋 DATA MODEL ANALYSIS:');
console.log('EXPECTED LAYER MAPPING:');
console.log('Executive Summary → metrics.ai_score + insights[0]');
console.log('KPI Strip → metrics fields + telemetry sessions');
console.log('Pipeline → metrics + insights by cicdStage');
console.log('IDE Cards → telemetry grouped by editor_source');
console.log('Recommendations → insights[].recommendations');

console.log('\n=== INVENTORY COMPLETE ===');
