/**
 * Unified Store Smoke Test Composable
 * 
 * Dev-only composable to test the unified store functionality.
 * Can be used in a playground route or existing Metrics page.
 */

import { ref, onMounted } from 'vue'
import { useUnifiedStore } from '../stores/unified'
import type { UnifiedQuery, UnifiedSeries } from '../types/unified'

export function useUnifiedSmokeTest() {
  const unifiedStore = useUnifiedStore()
  const testResults = ref<{
    query: UnifiedQuery
    series: UnifiedSeries[]
    error: string | null
    isLoading: boolean
  } | null>(null)

  /**
   * Runs a smoke test with sample query
   */
  async function runSmokeTest(): Promise<void> {
    console.log('🧪 Starting unified store smoke test...')
    
    // Create a sample query
    const query: UnifiedQuery = {
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
      to: new Date().toISOString(), // now
      viewBucket: 'daily',
      scope: 'org',
      metrics: [
        'gh.pr_opened',
        'gh.pr_merged', 
        'ide.ai_suggestions_accepted',
        'ide.files_per_session'
      ],
      teamIds: ['team-a'],
      toolIds: ['cursor', 'vscode']
    }

    console.log('📋 Test query:', query)

    try {
      // Test refresh
      console.log('🔄 Testing refresh...')
      await unifiedStore.refresh(query)
      
      // Test getSeries
      console.log('📊 Testing getSeries...')
      const series = unifiedStore.getSeries(query)
      
      // Log results
      console.log('✅ Smoke test completed successfully!')
      console.log('📈 Generated series:', series)
      console.log('📊 Event count:', unifiedStore.eventCount)
      console.log('🔧 Unique metrics:', unifiedStore.uniqueMetrics)
      console.log('🛠️ Unique tools:', unifiedStore.uniqueTools)
      
      // Store results for UI display
      testResults.value = {
        query,
        series,
        error: null,
        isLoading: false
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error('❌ Smoke test failed:', error)
      
      testResults.value = {
        query,
        series: [],
        error: errorMessage,
        isLoading: false
      }
    }
  }

  /**
   * Runs a minimal test with just GitHub metrics
   */
  async function runGitHubOnlyTest(): Promise<void> {
    console.log('🧪 Starting GitHub-only smoke test...')
    
    const query: UnifiedQuery = {
      from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
      to: new Date().toISOString(),
      viewBucket: 'weekly',
      scope: 'org',
      metrics: ['gh.pr_opened', 'gh.pr_merged'],
      repoNames: ['test/repo']
    }

    try {
      await unifiedStore.refresh(query)
      const series = unifiedStore.getSeries(query)
      
      console.log('✅ GitHub test completed!')
      console.log('📈 GitHub series:', series)
      
    } catch (error) {
      console.error('❌ GitHub test failed:', error)
    }
  }

  /**
   * Runs a minimal test with just IDE metrics
   */
  async function runIDEOnlyTest(): Promise<void> {
    console.log('🧪 Starting IDE-only smoke test...')
    
    const query: UnifiedQuery = {
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
      to: new Date().toISOString(),
      viewBucket: 'daily',
      scope: 'org',
      metrics: ['ide.ai_suggestions_accepted', 'ide.files_per_session'],
      toolIds: ['cursor']
    }

    try {
      await unifiedStore.refresh(query)
      const series = unifiedStore.getSeries(query)
      
      console.log('✅ IDE test completed!')
      console.log('📈 IDE series:', series)
      
    } catch (error) {
      console.error('❌ IDE test failed:', error)
    }
  }

  /**
   * Clears the store and runs a fresh test
   */
  async function runFreshTest(): Promise<void> {
    console.log('🧹 Clearing store and running fresh test...')
    unifiedStore.clear()
    await runSmokeTest()
  }

  /**
   * Tests error handling with invalid query
   */
  async function runErrorTest(): Promise<void> {
    console.log('🧪 Testing error handling...')
    
    const invalidQuery = {
      from: 'invalid-date',
      to: 'invalid-date',
      viewBucket: 'invalid-bucket' as any,
      scope: 'invalid-scope' as any,
      metrics: ['invalid-metric' as any]
    }

    try {
      await unifiedStore.refresh(invalidQuery)
      console.log('⚠️ Expected error but got success')
    } catch (error) {
      console.log('✅ Error handling works correctly:', error)
    }
  }

  /**
   * Logs current store state
   */
  function logStoreState(): void {
    console.log('📊 Current store state:')
    console.log('  - Events:', unifiedStore.events.length)
    console.log('  - Loading:', unifiedStore.isLoading)
    console.log('  - Error:', unifiedStore.error)
    console.log('  - Has data:', unifiedStore.hasData)
    console.log('  - Unique metrics:', unifiedStore.uniqueMetrics)
    console.log('  - Unique tools:', unifiedStore.uniqueTools)
  }

  // Auto-run smoke test on mount (dev only)
  onMounted(() => {
    if (import.meta.env.DEV) {
      console.log('🚀 Auto-running smoke test in dev mode...')
      runSmokeTest()
    }
  })

  return {
    // State
    testResults,
    
    // Test functions
    runSmokeTest,
    runGitHubOnlyTest,
    runIDEOnlyTest,
    runFreshTest,
    runErrorTest,
    logStoreState,
    
    // Store access
    unifiedStore
  }
}

/**
 * Simple smoke test function for one-off testing
 */
export async function quickSmokeTest(): Promise<void> {
  const { runSmokeTest } = useUnifiedSmokeTest()
  await runSmokeTest()
}

/**
 * Test all scenarios
 */
export async function runAllSmokeTests(): Promise<void> {
  const { 
    runSmokeTest, 
    runGitHubOnlyTest, 
    runIDEOnlyTest, 
    runErrorTest,
    logStoreState 
  } = useUnifiedSmokeTest()

  console.log('🧪 Running all smoke tests...')
  
  try {
    await runSmokeTest()
    await runGitHubOnlyTest()
    await runIDEOnlyTest()
    await runErrorTest()
    
    logStoreState()
    
    console.log('✅ All smoke tests completed!')
  } catch (error) {
    console.error('❌ Smoke tests failed:', error)
  }
}






