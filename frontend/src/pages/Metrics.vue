<template>
  <div class="metrics-page">
    <div class="container-fluid">
      <div class="row justify-content-center">
        <div class="col-12" style="max-width: 1400px;">
          <div class="onboarding-card">
            <div class="onboarding-header">
              <div class="header-content">
                <div class="text-center">
                  <div class="d-flex flex-column align-items-center justify-content-center">
                    <img src="../assets/CM-icon.png" alt="ChaosMonkey.dev Logo" class="dashboard-logo mb-3">
                    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet">
                    <h1 class="onboarding-title mb-0" style="font-family: 'Bebas Neue'; filter: url(#chaos-glitch);">
                      CHAOSMONKEY
                    </h1>
                  </div>
                  
                  <div class="progress-indicator mb-4 mt-4">
                    <div class="progress-step completed">
                      <div class="step-number">1</div>
                      <div class="step-label">Connected</div>
                    </div>
                    <div class="progress-connector"></div>
                    <div class="progress-step active">
                      <div class="step-number">2</div>
                      <div class="step-label">Configure Metrics</div>
                    </div>
                  </div>
                  
                  <h1 class="onboarding-title mb-3">Configure Your Metrics</h1>
                  <p class="onboarding-subtitle mb-2">Select and configure your productivity metrics</p>
                  <p class="mt-2 text-muted small">
                    Metrics use real GitHub and IDE telemetry where available, and simulated data for IDEs you haven't connected yet.
                  </p>
                  <div class="alert alert-warning mt-3">
                    <i class="bi bi-exclamation-triangle me-2"></i>
                    <strong>Deprecated:</strong> This metric selection onboarding flow is no longer required for MVP2 pilots. Please use the dashboard directly.
                  </div>
                  <div class="mt-3">
                    <button @click="goToDashboards" class="btn btn-primary">
                      <i class="bi bi-graph-up me-2"></i>Go to Dashboards
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div class="onboarding-body">

              <!-- Category Tabs -->
              <ul class="nav nav-tabs mb-4 modern-nav-tabs" id="metricTabs" role="tablist">
                <li class="nav-item" role="presentation">
                  <button class="nav-link active modern-nav-link" id="all-tab" data-bs-toggle="tab" data-bs-target="#all" type="button" role="tab">
                    <i class="bi bi-grid me-2"></i>All Metrics
                  </button>
                </li>
                <li class="nav-item" role="presentation">
                  <button class="nav-link modern-nav-link" id="productivity-tab" data-bs-toggle="tab" data-bs-target="#productivity" type="button" role="tab">
                    <i class="bi bi-lightning me-2"></i>Productivity
                  </button>
                </li>
                <li class="nav-item" role="presentation">
                  <button class="nav-link modern-nav-link" id="engineering-tab" data-bs-toggle="tab" data-bs-target="#engineering" type="button" role="tab">
                    <i class="bi bi-gear me-2"></i>Engineering
                  </button>
                </li>
                <li class="nav-item" role="presentation">
                  <button class="nav-link modern-nav-link" id="ide-tab" data-bs-toggle="tab" data-bs-target="#ide" type="button" role="tab">
                    <i class="bi bi-code-square me-2"></i>IDE Activity
                  </button>
                </li>
                <li class="nav-item" role="presentation">
                  <button class="nav-link modern-nav-link" id="quality-tab" data-bs-toggle="tab" data-bs-target="#quality" type="button" role="tab">
                    <i class="bi bi-shield-check me-2"></i>Quality
                  </button>
                </li>
                <li class="nav-item" role="presentation">
                  <button class="nav-link modern-nav-link" id="collaboration-tab" data-bs-toggle="tab" data-bs-target="#collaboration" type="button" role="tab">
                    <i class="bi bi-people me-2"></i>Collaboration
                  </button>
                </li>
                <li class="nav-item" role="presentation">
                  <button class="nav-link modern-nav-link" id="performance-tab" data-bs-toggle="tab" data-bs-target="#performance" type="button" role="tab">
                    <i class="bi bi-speedometer2 me-2"></i>Performance
                  </button>
                </li>
              </ul>

              <!-- Tab Content -->
              <div class="tab-content" id="metricTabContent">
                <!-- All Metrics Tab -->
                <div class="tab-pane fade show active" id="all" role="tabpanel">
                  <div class="row g-4 px-2 px-md-3">
                    <div 
                      v-for="metric in availableMetrics" 
                      :key="metric.id"
                      class="col-12 col-sm-6 col-lg-4"
                    >
                      <div 
                        class="card h-100 cursor-pointer metric-card"
                        :class="{ 'metric-selected': selectedMetrics.includes(metric.id) }"
                        @click="toggleMetric(metric.id)"
                      >
                        <div class="card-body">
                          <div class="d-flex justify-content-between align-items-start mb-2">
                            <div>
                              <h6 class="card-title mb-1">
                                <i :class="metric.icon + ' me-2'"></i>{{ metric.name }}
                              </h6>
                              <span class="badge bg-secondary me-2">{{ metric.category }}</span>
                              <span v-if="selectedMetrics.includes(metric.id)" class="badge bg-success-subtle text-success">
                                <i class="bi bi-check-circle-fill me-1"></i>Selected
                              </span>
                            </div>
                          </div>
                          <p class="card-text small text-muted mb-0">{{ metric.description }}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Productivity Tab -->
                <div class="tab-pane fade" id="productivity" role="tabpanel">
                  <div class="row g-4">
                    <div 
                      v-for="metric in productivityMetrics" 
                      :key="metric.id"
                      class="col-12 col-sm-6 col-lg-4"
                    >
                      <div 
                        class="card h-100 cursor-pointer metric-card"
                        :class="{ 'metric-selected': selectedMetrics.includes(metric.id) }"
                        @click="toggleMetric(metric.id)"
                      >
                        <div class="card-body">
                          <div class="d-flex justify-content-between align-items-start mb-2">
                            <div>
                              <h6 class="card-title mb-1">
                                <i :class="metric.icon + ' me-2'"></i>{{ metric.name }}
                              </h6>
                              <span v-if="selectedMetrics.includes(metric.id)" class="badge bg-success-subtle text-success">
                                <i class="bi bi-check-circle-fill me-1"></i>Selected
                              </span>
                            </div>
                          </div>
                          <p class="card-text small text-muted mb-0">{{ metric.description }}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Engineering Tab -->
                <div class="tab-pane fade" id="engineering" role="tabpanel">
                  <div class="row g-4">
                    <div 
                      v-for="metric in engineeringMetrics" 
                      :key="metric.id"
                      class="col-12 col-sm-6 col-lg-4"
                    >
                      <div 
                        class="card h-100 cursor-pointer metric-card"
                        :class="{ 'metric-selected': selectedMetrics.includes(metric.id) }"
                        @click="toggleMetric(metric.id)"
                      >
                        <div class="card-body">
                          <div class="d-flex justify-content-between align-items-start mb-2">
                            <div>
                              <h6 class="card-title mb-1">
                                <i :class="metric.icon + ' me-2'"></i>{{ metric.name }}
                              </h6>
                              <span v-if="selectedMetrics.includes(metric.id)" class="badge bg-success-subtle text-success">
                                <i class="bi bi-check-circle-fill me-1"></i>Selected
                              </span>
                            </div>
                          </div>
                          <p class="card-text small text-muted mb-0">{{ metric.description }}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- IDE Activity Tab -->
                <div class="tab-pane fade" id="ide" role="tabpanel">
                  <div class="row g-4">
                    <div 
                      v-for="metric in ideMetrics" 
                      :key="metric.id"
                      class="col-12 col-sm-6 col-lg-4"
                    >
                      <div 
                        class="card h-100 cursor-pointer metric-card"
                        :class="{ 'metric-selected': selectedMetrics.includes(metric.id) }"
                        @click="toggleMetric(metric.id)"
                      >
                        <div class="card-body">
                          <div class="d-flex justify-content-between align-items-start mb-2">
                            <div>
                              <h6 class="card-title mb-1">
                                <i :class="metric.icon + ' me-2'"></i>{{ metric.name }}
                              </h6>
                              <span v-if="selectedMetrics.includes(metric.id)" class="badge bg-success-subtle text-success">
                                <i class="bi bi-check-circle-fill me-1"></i>Selected
                              </span>
                            </div>
                          </div>
                          <p class="card-text small text-muted mb-0">{{ metric.description }}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Quality Tab -->
                <div class="tab-pane fade" id="quality" role="tabpanel">
                  <div class="row g-4">
                    <div 
                      v-for="metric in qualityMetrics" 
                      :key="metric.id"
                      class="col-12 col-sm-6 col-lg-4"
                    >
                      <div 
                        class="card h-100 cursor-pointer metric-card"
                        :class="{ 'metric-selected': selectedMetrics.includes(metric.id) }"
                        @click="toggleMetric(metric.id)"
                      >
                        <div class="card-body">
                          <div class="d-flex justify-content-between align-items-start mb-2">
                            <div>
                              <h6 class="card-title mb-1">
                                <i :class="metric.icon + ' me-2'"></i>{{ metric.name }}
                              </h6>
                              <span v-if="selectedMetrics.includes(metric.id)" class="badge bg-success-subtle text-success">
                                <i class="bi bi-check-circle-fill me-1"></i>Selected
                              </span>
                            </div>
                          </div>
                          <p class="card-text small text-muted mb-0">{{ metric.description }}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Collaboration Tab -->
                <div class="tab-pane fade" id="collaboration" role="tabpanel">
                  <div class="row g-4">
                    <div 
                      v-for="metric in collaborationMetrics" 
                      :key="metric.id"
                      class="col-12 col-sm-6 col-lg-4"
                    >
                      <div 
                        class="card h-100 cursor-pointer metric-card"
                        :class="{ 'metric-selected': selectedMetrics.includes(metric.id) }"
                        @click="toggleMetric(metric.id)"
                      >
                        <div class="card-body">
                          <div class="d-flex justify-content-between align-items-start mb-2">
                            <div>
                              <h6 class="card-title mb-1">
                                <i :class="metric.icon + ' me-2'"></i>{{ metric.name }}
                              </h6>
                              <span v-if="selectedMetrics.includes(metric.id)" class="badge bg-success-subtle text-success">
                                <i class="bi bi-check-circle-fill me-1"></i>Selected
                              </span>
                            </div>
                          </div>
                          <p class="card-text small text-muted mb-0">{{ metric.description }}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Performance Tab -->
                <div class="tab-pane fade" id="performance" role="tabpanel">
                  <div class="row g-4">
                    <div 
                      v-for="metric in performanceMetrics" 
                      :key="metric.id"
                      class="col-12 col-sm-6 col-lg-4"
                    >
                      <div 
                        class="card h-100 cursor-pointer metric-card"
                        :class="{ 'metric-selected': selectedMetrics.includes(metric.id) }"
                        @click="toggleMetric(metric.id)"
                      >
                        <div class="card-body">
                          <div class="d-flex justify-content-between align-items-start mb-2">
                            <div>
                              <h6 class="card-title mb-1">
                                <i :class="metric.icon + ' me-2'"></i>{{ metric.name }}
                              </h6>
                              <span v-if="selectedMetrics.includes(metric.id)" class="badge bg-success-subtle text-success">
                                <i class="bi bi-check-circle-fill me-1"></i>Selected
                              </span>
                            </div>
                          </div>
                          <p class="card-text small text-muted mb-0">{{ metric.description }}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Selection Summary and Continue Button -->
              <div class="row mt-4">
                <div class="col-12">
                  <div class="card bg-light">
                    <div class="card-body text-center">
                      <h6 class="mb-3">
                        <i class="bi bi-check-circle me-2 text-success"></i>
                        Metrics Selection Summary
                      </h6>
                      <p class="mb-3">
                        <strong>{{ selectedMetrics.length }}</strong> of {{ availableMetrics.length }} metrics selected
                      </p>
                      <div v-if="selectedMetrics.length > 0" class="mb-3">
                        <div class="d-flex flex-wrap justify-content-center gap-2">
                          <span 
                            v-for="metricId in selectedMetrics" 
                            :key="metricId"
                            class="badge bg-primary"
                          >
                            {{ getMetricName(metricId) }}
                          </span>
                        </div>
                      </div>
                      <div class="d-flex justify-content-center gap-3">
                        <button type="button" class="btn btn-secondary" data-bs-toggle="modal" data-bs-target="#metricsConfirmationModal">
                          <i class="bi bi-save me-2"></i>Save Selection
                        </button>
                        <button type="button" class="btn btn-primary" @click="goToDashboards">
                          <i class="bi bi-graph-up me-2"></i>
                          Go to Dashboards
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Bootstrap Modal for Confirmation -->
      <div class="modal fade" id="metricsConfirmationModal" tabindex="-1" aria-labelledby="metricsConfirmationModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header bg-success text-white">
              <h5 class="modal-title" id="metricsConfirmationModalLabel">
                <i class="bi bi-check-circle me-2"></i>
                Metrics Configuration Saved!
              </h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <div class="text-center mb-3">
                <i class="bi bi-check-circle-fill text-success" style="font-size: 3rem;"></i>
              </div>
              <h6 class="text-center mb-3">Your metrics configuration has been saved successfully!</h6>
              
              <div class="alert alert-info">
                <strong>{{ selectedMetrics.length }}</strong> of {{ availableMetrics.length }} metrics selected
              </div>
              
              <div v-if="selectedMetrics.length > 0" class="mb-3">
                <strong>Selected metrics:</strong>
                <div class="mt-2">
                  <span 
                    v-for="metricId in selectedMetrics" 
                    :key="metricId"
                    class="badge bg-primary me-1 mb-1"
                  >
                    {{ getMetricName(metricId) }}
                  </span>
                </div>
              </div>
              
              <div class="alert alert-warning">
                <i class="bi bi-info-circle me-2"></i>
                You can modify your metrics selection later from the Settings page.
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
              <button type="button" class="btn btn-primary" @click="goToDashboards" data-bs-dismiss="modal">
                <i class="bi bi-graph-up me-2"></i>
                Go to Dashboards
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useMetricsFacadeStore } from '../stores/metricsFacade'

const router = useRouter()
const metricsStore = useMetricsFacadeStore()

// Reactive state for form checkboxes
const selectedMetrics = ref([])

// Available metrics data
const availableMetrics = ref([
  {
    id: 'productive_time',
    name: 'Productive Time',
    description: 'Time spent actively coding and developing',
    icon: 'bi-clock',
    category: 'Productivity'
  },
  {
    id: 'code_churn',
    name: 'Code Churn',
    description: 'Lines of code added and deleted over time',
    icon: 'bi-arrow-repeat',
    category: 'Engineering'
  },
  {
    id: 'pull_requests',
    name: 'Pull Requests',
    description: 'Number of pull requests created and merged',
    icon: 'bi-git',
    category: 'Collaboration'
  },
  {
    id: 'code_reviews',
    name: 'Code Reviews',
    description: 'Time spent reviewing code changes',
    icon: 'bi-eye',
    category: 'Quality'
  },
  {
    id: 'build_time',
    name: 'Build Time',
    description: 'Time taken for builds to complete',
    icon: 'bi-gear',
    category: 'Performance'
  },
  {
    id: 'test_coverage',
    name: 'Test Coverage',
    description: 'Percentage of code covered by tests',
    icon: 'bi-shield-check',
    category: 'Quality'
  },
  {
    id: 'ai_suggestions_accepted',
    name: 'AI Suggestions Accepted',
    description: 'Number of AI suggestions accepted',
    icon: 'bi-robot',
    category: 'IDE Activity'
  },
  {
    id: 'files_edited_per_session',
    name: 'Files Edited Per Session',
    description: 'Average number of files edited per coding session',
    icon: 'bi-file-earmark',
    category: 'IDE Activity'
  },
  {
    id: 'commits_per_session',
    name: 'Commits Per Session',
    description: 'Average number of commits per coding session',
    icon: 'bi-git',
    category: 'IDE Activity'
  }
])

// Computed properties for filtered metrics by category
const productivityMetrics = computed(() => 
  availableMetrics.value.filter(m => m.category === 'Productivity')
)

const engineeringMetrics = computed(() => 
  availableMetrics.value.filter(m => m.category === 'Engineering')
)

const ideMetrics = computed(() => 
  availableMetrics.value.filter(m => m.category === 'IDE Activity')
)

const qualityMetrics = computed(() => 
  availableMetrics.value.filter(m => m.category === 'Quality')
)

const collaborationMetrics = computed(() => 
  availableMetrics.value.filter(m => m.category === 'Collaboration')
)

const performanceMetrics = computed(() => 
  availableMetrics.value.filter(m => m.category === 'Performance')
)

// Methods
const toggleMetric = (metricId) => {
  const index = selectedMetrics.value.indexOf(metricId)
  if (index > -1) {
    selectedMetrics.value.splice(index, 1)
  } else {
    selectedMetrics.value.push(metricId)
  }
}

const getMetricName = (metricId) => {
  const metric = availableMetrics.value.find(m => m.id === metricId)
  return metric ? metric.name : metricId
}

const goBack = () => {
  router.push('/connect')
}

const goToDashboards = () => {
  // Save selected metrics to store
  metricsStore.updateSelectedMetrics(selectedMetrics.value)
  router.push('/dashboards')
}

// Lifecycle
onMounted(() => {
  // Initialize form with current selections from store
  selectedMetrics.value = [...metricsStore.selectedMetrics]
})
</script>

<style scoped>
/* Onboarding Card Structure */
.onboarding-card {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 24px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  overflow: hidden;
  margin: 2rem 0;
}

.onboarding-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 3rem 2.5rem;
  position: relative;
}

.onboarding-header::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
}

.dashboard-logo {
  height: 6rem;
  width: auto;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
}

.onboarding-title {
  font-size: 2.4rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-bottom: 0.25rem;
  color: white;
}

.onboarding-subtitle {
  font-size: 1.05rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.9);
  margin: 0;
  line-height: 1.6;
}

/* Progress Indicator */
.progress-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.progress-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.step-number {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  border: 2px solid rgba(255, 255, 255, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.9rem;
  transition: all 0.3s ease;
}

.progress-step.completed .step-number {
  background: #28a745;
  border-color: #28a745;
  color: white;
}

.progress-step.active .step-number {
  background: white;
  color: #667eea;
  border-color: white;
  transform: scale(1.1);
}

.step-label {
  font-size: 0.8rem;
  opacity: 0.8;
  font-weight: 500;
  color: white;
}

.progress-connector {
  width: 60px;
  height: 2px;
  background: rgba(255, 255, 255, 0.2);
}

/* Onboarding Body */
.onboarding-body {
  padding: 2rem;
}

/* Modern Tabs */
.modern-nav-tabs {
  border: none;
  background: #f8f9fa;
  border-radius: 12px;
  padding: 0.5rem;
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.modern-nav-link {
  border: none;
  background: transparent;
  color: #6c757d;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  white-space: nowrap;
}

.modern-nav-link:hover {
  background: rgba(102, 126, 234, 0.1);
  color: #667eea;
  transform: translateY(-1px);
}

.modern-nav-link.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

/* Metric Cards */
.metric-card {
  border: 2px solid #e9ecef;
  border-radius: 12px;
  transition: all 0.3s ease;
  cursor: pointer;
  background: white;
}

.metric-card:hover {
  border-color: #667eea;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
  transform: translateY(-2px);
}

.metric-card.metric-selected {
  border-color: #667eea;
  background: linear-gradient(135deg, #f8f9ff 0%, #ffffff 100%);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
}

/* Buttons */
.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  font-weight: 600;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.btn-outline-secondary {
  border-color: rgba(255, 255, 255, 0.5);
  color: white;
  background: rgba(255, 255, 255, 0.1);
}

.btn-outline-secondary:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: white;
  color: white;
}

/* Responsive Design */
@media (max-width: 768px) {
  .onboarding-header {
    padding: 2rem 1.5rem;
  }
  
  .onboarding-title {
    font-size: 2rem;
  }
  
  .onboarding-subtitle {
    font-size: 1rem;
  }
  
  .progress-indicator {
    gap: 0.5rem;
  }
  
  .progress-connector {
    width: 40px;
  }
  
  .step-label {
    font-size: 0.7rem;
  }
  
  .modern-nav-tabs {
    flex-direction: column;
    gap: 0.25rem;
  }
  
  .modern-nav-link {
    width: 100%;
    justify-content: center;
  }
  
  .onboarding-body {
    padding: 1rem;
  }
}

/* Ensure buttons are clickable */
.btn {
  position: relative;
  z-index: 10;
}
</style>
