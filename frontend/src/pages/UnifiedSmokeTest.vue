<template>
  <div class="unified-smoke-test">
    <div class="container-fluid">
      <div class="row">
        <div class="col-12">
          <div class="card">
            <div class="card-header bg-primary text-white">
              <h5 class="mb-0">
                <i class="bi bi-bug me-2"></i>Unified Store Smoke Test
              </h5>
              <small class="text-light">Dev-only testing for unified metrics store</small>
            </div>
            <div class="card-body">
              
              <!-- Test Controls -->
              <div class="row mb-4">
                <div class="col-12">
                  <h6>Test Controls</h6>
                  <div class="btn-group me-2" role="group">
                    <button 
                      @click="runSmokeTest" 
                      class="btn btn-primary"
                      :disabled="unifiedStore.isLoading"
                    >
                      <i class="bi bi-play me-1"></i>Full Test
                    </button>
                    <button 
                      @click="runGitHubOnlyTest" 
                      class="btn btn-success"
                      :disabled="unifiedStore.isLoading"
                    >
                      <i class="bi bi-github me-1"></i>GitHub Only
                    </button>
                    <button 
                      @click="runIDEOnlyTest" 
                      class="btn btn-info"
                      :disabled="unifiedStore.isLoading"
                    >
                      <i class="bi bi-code-square me-1"></i>IDE Only
                    </button>
                    <button 
                      @click="runFreshTest" 
                      class="btn btn-warning"
                      :disabled="unifiedStore.isLoading"
                    >
                      <i class="bi bi-arrow-clockwise me-1"></i>Fresh Test
                    </button>
                    <button 
                      @click="runErrorTest" 
                      class="btn btn-danger"
                      :disabled="unifiedStore.isLoading"
                    >
                      <i class="bi bi-exclamation-triangle me-1"></i>Error Test
                    </button>
                  </div>
                  <button 
                    @click="logStoreState" 
                    class="btn btn-outline-secondary"
                  >
                    <i class="bi bi-info-circle me-1"></i>Log State
                  </button>
                </div>
              </div>

              <!-- Loading State -->
              <div v-if="unifiedStore.isLoading" class="alert alert-info">
                <i class="bi bi-arrow-clockwise me-2"></i>Running test...
              </div>

              <!-- Error State -->
              <div v-if="unifiedStore.error" class="alert alert-danger">
                <i class="bi bi-exclamation-triangle me-2"></i>Error: {{ unifiedStore.error }}
              </div>

              <!-- Test Results -->
              <div v-if="testResults" class="row">
                <div class="col-md-6">
                  <h6>Test Query</h6>
                  <pre class="bg-light p-3 rounded"><code>{{ JSON.stringify(testResults.query, null, 2) }}</code></pre>
                </div>
                <div class="col-md-6">
                  <h6>Generated Series</h6>
                  <div v-if="testResults.series.length === 0" class="text-muted">
                    No series generated
                  </div>
                  <div v-else>
                    <div v-for="(series, index) in testResults.series" :key="index" class="mb-2">
                      <strong>{{ series.label }}</strong>
                      <small class="text-muted ms-2">({{ series.points.length }} points)</small>
                      <div v-if="series.points.length > 0" class="small text-muted">
                        Range: {{ series.points[0].t }} → {{ series.points[series.points.length - 1].t }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Store State -->
              <div class="row mt-4">
                <div class="col-12">
                  <h6>Store State</h6>
                  <div class="row">
                    <div class="col-md-3">
                      <div class="card bg-light">
                        <div class="card-body text-center">
                          <h5 class="text-primary">{{ unifiedStore.eventCount }}</h5>
                          <small>Events</small>
                        </div>
                      </div>
                    </div>
                    <div class="col-md-3">
                      <div class="card bg-light">
                        <div class="card-body text-center">
                          <h5 class="text-success">{{ unifiedStore.uniqueMetrics.length }}</h5>
                          <small>Metrics</small>
                        </div>
                      </div>
                    </div>
                    <div class="col-md-3">
                      <div class="card bg-light">
                        <div class="card-body text-center">
                          <h5 class="text-info">{{ unifiedStore.uniqueTools.length }}</h5>
                          <small>Tools</small>
                        </div>
                      </div>
                    </div>
                    <div class="col-md-3">
                      <div class="card bg-light">
                        <div class="card-body text-center">
                          <h5 :class="unifiedStore.hasData ? 'text-success' : 'text-muted'">
                            {{ unifiedStore.hasData ? 'Yes' : 'No' }}
                          </h5>
                          <small>Has Data</small>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Console Instructions -->
              <div class="alert alert-info mt-4">
                <h6><i class="bi bi-info-circle me-2"></i>Console Output</h6>
                <p class="mb-0">
                  Check the browser console for detailed test output and logs.
                  All test results are logged with emojis for easy identification.
                </p>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useUnifiedSmokeTest } from '../composables/useUnifiedSmokeTest'

const {
  testResults,
  runSmokeTest,
  runGitHubOnlyTest,
  runIDEOnlyTest,
  runFreshTest,
  runErrorTest,
  logStoreState,
  unifiedStore
} = useUnifiedSmokeTest()
</script>

<style scoped>
.unified-smoke-test {
  padding: 20px 0;
}

pre {
  font-size: 0.8rem;
  max-height: 200px;
  overflow-y: auto;
}

.btn-group .btn {
  margin-right: 0;
}

.card {
  box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075);
}
</style>






