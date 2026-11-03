/**
 * Test harness for running Final PI Engine against runtime data
 * Used for optimization sprint to capture actual rendered output
 */

// Mock environment for Node.js execution
if (typeof import.meta === 'undefined') {
  (global as any).import = { 
    meta: { 
      env: { 
        VITE_FINAL_PI_ENGINE_ENABLED: 'true', 
        VITE_API_BASE_URL: 'http://mock-backend/api',
        VITE_PI_DEBUG: 'true'
      } 
    } 
  };
}

import { fetchCanonicalInsightInput } from './dataAccess';
import { generatePlanCodeInsights } from './generators/planCode';
import { generateReviewMergeInsights } from './generators/reviewMerge';
import { generateDeployOperateInsights } from './generators/deployOperate';

async function runFinalPIHarness() {
  console.log('[TEST_HARNESS][START] Running Final PI Engine against runtime data');
  
  try {
    // Check if we're in stress/demo mode - if so, skip real API calls
    const isStressMode = typeof window !== 'undefined' && (
      window.location.search.includes('piStress=1') || 
      window.location.search.includes('demoMode=1')
    );
    
    // Fetch actual runtime data
    console.log('[TEST_HARNESS][FETCHING_INPUT]');
    const input = isStressMode ? {
      sessionRows: [],
      githubSnapshot: undefined,
      githubByPeriod: [],
      productivityByPeriod: [],
      granularity: 'week' as const
    } : await fetchCanonicalInsightInput('week');
    console.log('[TEST_HARNESS][INPUT]', {
      sessionRowsCount: input.sessionRows?.length || 0,
      githubByPeriodCount: input.githubByPeriod?.length || 0,
      hasGithubSnapshot: !!input.githubSnapshot,
      productivityByPeriodCount: input.productivityByPeriod?.length || 0,
    });

    // Check if sessions have derived fields
    if (input.sessionRows && input.sessionRows.length > 0) {
      const sampleSession = input.sessionRows[0];
      console.log('[TEST_HARNESS][SAMPLE_SESSION_FIELDS]', {
        has_rework_ratio: sampleSession.session_rework_ratio_est !== undefined,
        has_quality_score: sampleSession.session_quality_score !== undefined,
        has_flow_profile: sampleSession.flow_profile !== undefined,
        has_ai_intensity: sampleSession.ai_intensity_band !== undefined,
        has_user_id: sampleSession.user_id !== undefined,
      });
    }

    // Run generators directly (bypass feature flag)
    console.log('[TEST_HARNESS][RUNNING_GENERATORS]');
    const planCodeInsights = generatePlanCodeInsights(input);
    const reviewMergeInsights = generateReviewMergeInsights(input);
    const deployOperateInsights = generateDeployOperateInsights(input);
    
    const allInsights = [...planCodeInsights, ...reviewMergeInsights, ...deployOperateInsights];
    
    console.log('[TEST_HARNESS][GENERATOR_OUTPUT]', {
      planCodeCount: planCodeInsights.length,
      reviewMergeCount: reviewMergeInsights.length,
      deployOperateCount: deployOperateInsights.length,
      totalInsights: allInsights.length,
    });

    // Identify weak metrics
    const weakMetrics = allInsights.filter((i: any) => {
      const metric = i.rightMetric || '';
      return metric.includes('0%') || metric.includes('0.0') || metric.includes('0/') || metric === '—';
    });
    
    console.log('[TEST_HARNESS][WEAK_METRICS]', {
      count: weakMetrics.length,
      insights: weakMetrics.map((i: any) => ({ id: i.id, metric: i.rightMetric }))
    });

    // Detailed inspection of first 5 insights
    allInsights.slice(0, 5).forEach((insight, idx) => {
      console.log(`[TEST_HARNESS][INSIGHT_${idx}]`, {
        id: insight.id,
        title: insight.title,
        rightMetric: insight.rightMetric,
        confidence: insight.confidence,
      });
    });

    return allInsights;
  } catch (error) {
    console.error('[TEST_HARNESS][ERROR]', error);
    throw error;
  }
}

// Run if executed directly
if (typeof window === 'undefined') {
  runFinalPIHarness()
    .then(() => console.log('[TEST_HARNESS][COMPLETE]'))
    .catch(err => console.error('[TEST_HARNESS][FAILED]', err));
}

export { runFinalPIHarness };
