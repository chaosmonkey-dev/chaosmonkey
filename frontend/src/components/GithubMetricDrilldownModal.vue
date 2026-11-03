<template>
  <div v-if="show" class="modal fade show d-block" tabindex="-1" @click.self="closeModal">
    <div class="modal-dialog modal-xl modal-full-width">
      <div class="modal-content">
        <!-- Modal Header -->
        <div class="modal-header">
          <h5 class="modal-title">
            <i class="bi bi-github me-2"></i>
            {{ metricTitle }} - Detailed Records
          </h5>
          <button type="button" class="btn-close" @click="closeModal"></button>
        </div>

        <!-- Modal Body -->
        <div class="modal-body p-3">
          <!-- Loading State -->
          <div v-if="loading" class="text-center py-5">
            <div class="spinner-border text-primary" role="status">
              <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mt-3 text-muted">Loading detailed records...</p>
          </div>

          <!-- Error State -->
          <div v-else-if="error" class="text-center py-5">
            <i class="bi bi-exclamation-triangle text-warning" style="font-size: 3rem;"></i>
            <h5 class="mt-3">Unable to Load Details</h5>
            <p class="text-muted">{{ getErrorMessage() }}</p>
            <button class="btn btn-outline-primary" @click="retryFetch">Retry</button>
            <button class="btn btn-outline-secondary ms-2" @click="closeModal">Close</button>
          </div>

          <!-- Empty State -->
          <div v-else-if="!hasRecords" class="text-center py-5">
            <i class="bi bi-inbox text-muted" style="font-size: 3rem;"></i>
            <h5 class="mt-3">No Detailed Records Available</h5>
            <p class="text-muted">{{ getEmptyMessage() }}</p>
            <button class="btn btn-outline-secondary" @click="closeModal">Close</button>
          </div>

          <!-- Data Table -->
          <div v-else>
            <!-- Modern Summary Bar -->
            <div class="drilldown-summary">
              <div class="summary-content">
                <div class="summary-info">
                  <span class="summary-count">{{ showingCount }}</span>
                  <span class="summary-text">of {{ totalCount }} records</span>
                  <span v-if="isTruncated" class="summary-limit">(showing latest {{ limit }})</span>
                </div>
                <button class="close-btn" @click="closeModal">
                  <i class="bi bi-x-lg"></i>
                </button>
              </div>
            </div>

            <!-- Modern Records Table -->
            <div class="drilldown-table-container">
              <div class="table-wrapper">
                <table class="drilldown-table">
                  <thead>
                    <tr>
                      <th v-for="column in columns" :key="column.key" :class="getColumnClass(column)">
                        <span class="column-header">
                          {{ column.label }}
                          <i v-if="column.sortable" class="bi bi-arrow-down-up sort-icon"></i>
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(record, index) in records" :key="record.id || record.number" :class="getRowClass(index)">
                      <td v-for="column in columns" :key="column.key" :class="getCellClass(column)">
                        <component 
                          :is="column.component || 'span'" 
                          v-bind="getColumnProps(record, column)"
                          class="cell-content"
                          :data-value="column.key === 'state' ? getCellValue(record, column)?.toLowerCase() : null"
                        >
                          {{ getCellValue(record, column) }}
                        </component>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Modal Backdrop -->
  <div v-if="show" class="modal-backdrop fade show"></div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { fetchGitHubMetricDetails } from '../services/githubDrilldown'
import { IMPLEMENTED_METRICS } from '../config/githubDrilldown'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  metricKey: {
    type: String,
    default: ''
  },
  timeFilter: {
    type: String,
    default: 'all'
  },
  limit: {
    type: Number,
    default: 100
  }
})

const emit = defineEmits(['close'])

// Reactive state
const loading = ref(false)
const error = ref(null)
const data = ref(null)
const fetchRequestId = ref(0) // Track request ID to prevent race conditions

// Computed properties
const metricTitle = computed(() => {
  const titles = {
    'total_prs': 'Total Pull Requests',
    'pr_reopens': 'Reopened Pull Requests', 
    'failed_deployments': 'Failed Deployments',
    'total_commits': 'Total Commits',
    'merge_rate': 'Merge Rate',
    'total_repositories': 'Total Repositories',
    'review_count': 'Review Count',
    'unique_reviewers': 'Unique Reviewers',
    'rejected_prs': 'Rejected Pull Requests',
    'latest_deployment': 'Latest Deployment',
    'deployment_status': 'Deployment Status',
    'deployment_environment': 'Deployment Environment',
    'rollback_detected': 'Rollback Detected'
  }
  return titles[props.metricKey] || props.metricKey
})

const hasRecords = computed(() => {
  const result = data.value && data.value.records && data.value.records.length > 0
  console.log('🔧 Modal hasRecords check:', { 
    data: data.value, 
    recordsLength: data.value?.records?.length, 
    hasRecords: result 
  })
  return result
})

const records = computed(() => {
  return data.value?.records || []
})

const totalCount = computed(() => {
  return data.value?.total_count || 0
})

const showingCount = computed(() => {
  return data.value?.records?.length || 0
})

const isTruncated = computed(() => {
  return totalCount.value > showingCount.value
})

const columns = computed(() => {
  return getColumnConfig(props.metricKey)
})

// Methods
function closeModal() {
  // Cancel any pending request
  fetchRequestId.value++
  loading.value = false
  error.value = null
  data.value = null
  emit('close')
}

async function fetchData() {
  if (!props.metricKey) return

  // Cancel any previous request
  const currentRequestId = ++fetchRequestId.value
  
  loading.value = true
  error.value = null
  data.value = null

  console.log('🔧 Modal fetchData called:', { 
    requestId: currentRequestId,
    metricKey: props.metricKey, 
    timeFilter: props.timeFilter, 
    limit: props.limit 
  })

  try {
    const result = await fetchGitHubMetricDetails({
      metric: props.metricKey,
      timeFilter: props.timeFilter,
      limit: props.limit
    })
    
    // Only update if this is still the latest request
    if (currentRequestId === fetchRequestId.value) {
      console.log('🔧 Modal API response (request ' + currentRequestId + '):', result)
      data.value = result
      
      // Handle API-level errors gracefully
      if (result.reason === 'not_authenticated') {
        error.value = 'not_authenticated'
      } else if (result.reason === 'unsupported_metric') {
        error.value = 'unsupported_metric'
      } else if (result.reason === 'insufficient_data') {
        // This is expected for unimplemented metrics, treat as empty state
        data.value = result
      } else if (result.reason === 'api_error') {
        error.value = 'api_error'
      }
    } else {
      console.log('🔧 Modal ignoring stale response (request ' + currentRequestId + ' superseded)')
    }
    
  } catch (err) {
    // Only update error if this is still the latest request
    if (currentRequestId === fetchRequestId.value) {
      console.error('Failed to fetch metric details:', err)
      error.value = 'network_error'
    }
  } finally {
    // Only update loading if this is still the latest request
    if (currentRequestId === fetchRequestId.value) {
      loading.value = false
    }
  }
}

// Safe wrapper for fetchData to prevent unhandled rejections
function safeFetchData() {
  try {
    return fetchData()
  } catch (err) {
    console.error('🔧 Modal fetchData error caught:', err)
    loading.value = false
    error.value = 'network_error'
  }
}

function retryFetch() {
  fetchData()
}

function getErrorMessage() {
  const messages = {
    'not_authenticated': 'Connect GitHub to view detailed records',
    'unsupported_metric': 'This metric is not supported for detailed view',
    'api_error': 'Failed to load data from server',
    'network_error': 'Network error - please check your connection'
  }
  return messages[error.value] || 'An unknown error occurred'
}

function getEmptyMessage() {
  if (!IMPLEMENTED_METRICS.includes(props.metricKey)) {
    return 'Detailed records are not yet available for this metric'
  }
  return 'No records found for the selected time period'
}

function getColumnConfig(metricKey) {
  const configs = {
    'total_prs': [
      { key: 'number', label: 'PR #', sortable: true },
      { key: 'title', label: 'Title', sortable: true },
      { key: 'author', label: 'Author', sortable: true },
      { key: 'state', label: 'State', sortable: true },
      { key: 'created_at', label: 'Created', sortable: true, component: 'time-ago' },
      { key: 'url', label: 'Link', component: 'external-link' }
    ],
    'total_commits': [
      { key: 'sha', label: 'SHA', sortable: true },
      { key: 'message', label: 'Message', sortable: true },
      { key: 'author', label: 'Author', sortable: true },
      { key: 'created_at', label: 'Date', sortable: true, component: 'time-ago' },
      { key: 'repository', label: 'Repository', sortable: true },
      { key: 'url', label: 'Link', component: 'external-link' }
    ],
    'total_repositories': [
      { key: 'name', label: 'Name', sortable: true },
      { key: 'full_name', label: 'Full Name', sortable: true },
      { key: 'description', label: 'Description', sortable: false },
      { key: 'language', label: 'Language', sortable: true },
      { key: 'stars', label: 'Stars', sortable: true },
      { key: 'forks', label: 'Forks', sortable: true },
      { key: 'url', label: 'Link', component: 'external-link' }
    ],
    'merge_rate': [
      { key: 'metric', label: 'Metric', sortable: false },
      { key: 'value', label: 'Value', sortable: true },
      { key: 'percentage', label: 'Percentage', sortable: true },
      { key: 'description', label: 'Description', sortable: false },
      { key: 'created_at', label: 'Calculated', sortable: true, component: 'time-ago' }
    ],
    'review_count': [
      { key: 'pr_number', label: 'PR #', sortable: true },
      { key: 'pr_title', label: 'PR Title', sortable: true },
      { key: 'review_count', label: 'Total Reviews', sortable: true },
      { key: 'comments', label: 'Comments', sortable: true },
      { key: 'review_comments', label: 'Review Comments', sortable: true },
      { key: 'author', label: 'Author', sortable: true },
      { key: 'url', label: 'Link', component: 'external-link' }
    ],
    'unique_reviewers': [
      { key: 'metric', label: 'Metric', sortable: false },
      { key: 'value', label: 'Count', sortable: true },
      { key: 'description', label: 'Description', sortable: false },
      { key: 'created_at', label: 'Calculated', sortable: true, component: 'time-ago' }
    ],
    'rejected_prs': [
      { key: 'number', label: 'PR #', sortable: true },
      { key: 'title', label: 'Title', sortable: true },
      { key: 'author', label: 'Author', sortable: true },
      { key: 'state', label: 'State', sortable: true },
      { key: 'closed_at', label: 'Closed', sortable: true, component: 'time-ago' },
      { key: 'rejection_reason', label: 'Reason', sortable: false },
      { key: 'url', label: 'Link', component: 'external-link' }
    ],
    'commits_per_day': [
      { key: 'metric', label: 'Metric', sortable: false },
      { key: 'value', label: 'Average', sortable: true },
      { key: 'description', label: 'Description', sortable: false },
      { key: 'created_at', label: 'Calculated', sortable: true, component: 'time-ago' }
    ],
    'first_review_at': [
      { key: 'metric', label: 'Metric', sortable: false },
      { key: 'value', label: 'Hours', sortable: true },
      { key: 'unit', label: 'Unit', sortable: false },
      { key: 'description', label: 'Description', sortable: false },
      { key: 'created_at', label: 'Calculated', sortable: true, component: 'time-ago' }
    ],
    'time_to_merge': [
      { key: 'metric', label: 'Metric', sortable: false },
      { key: 'value', label: 'Days', sortable: true },
      { key: 'unit', label: 'Unit', sortable: false },
      { key: 'description', label: 'Description', sortable: false },
      { key: 'created_at', label: 'Calculated', sortable: true, component: 'time-ago' }
    ],
    'pr_reopens': [
      { key: 'number', label: 'PR #', sortable: true },
      { key: 'title', label: 'Title', sortable: true },
      { key: 'author', label: 'Author', sortable: true },
      { key: 'reopened_count', label: 'Reopens', sortable: true },
      { key: 'last_reopened_at', label: 'Last Reopened', sortable: true, component: 'time-ago' },
      { key: 'url', label: 'Link', component: 'external-link' }
    ],
    'failed_deployments': [
      { key: 'repository', label: 'Repository', sortable: true },
      { key: 'environment', label: 'Environment', sortable: true },
      { key: 'deployed_at', label: 'Deployed', sortable: true, component: 'time-ago' },
      { key: 'failure_reason', label: 'Failure Reason', sortable: false },
      { key: 'rollback_detected', label: 'Rollback', sortable: true, component: 'boolean-badge' },
      { key: 'url', label: 'Actions', component: 'external-link' }
    ],
    'success_deployments': [
      { key: 'repository', label: 'Repository', sortable: true },
      { key: 'environment', label: 'Environment', sortable: true },
      { key: 'deployed_at', label: 'Deployed', sortable: true, component: 'time-ago' },
      { key: 'status', label: 'Status', sortable: true },
      { key: 'conclusion', label: 'Conclusion', sortable: true },
      { key: 'url', label: 'Actions', component: 'external-link' }
    ]
  }
  
  return configs[metricKey] || []
}

function getCellValue(record, column) {
  const value = record[column.key]
  
  if (column.component === 'boolean-badge') {
    return value ? 'Yes' : 'No'
  }
  
  if (column.key === 'state') {
    return value?.charAt(0).toUpperCase() + value?.slice(1) || 'Unknown'
  }
  
  return value || '--'
}

function getColumnClass(column) {
  const classes = ['table-header']
  if (column.sortable) classes.push('sortable')
  if (column.component === 'external-link') classes.push('action-column')
  return classes.join(' ')
}

function getRowClass(index) {
  return index % 2 === 0 ? 'row-even' : 'row-odd'
}

function getCellClass(column) {
  const classes = ['table-cell']
  if (column.component === 'external-link') classes.push('action-cell')
  if (column.component === 'boolean-badge') classes.push('badge-cell')
  if (column.key === 'state') classes.push('state-cell')
  if (column.key === 'created_at' || column.key === 'deployed_at') classes.push('time-cell')
  return classes.join(' ')
}

function getColumnProps(record, column) {
  if (column.component === 'external-link') {
    return {
      href: record.url,
      target: '_blank',
      title: `View ${column.key === 'url' ? 'in GitHub' : 'in GitHub Actions'}`
    }
  }
  
  if (column.component === 'boolean-badge') {
    return {
      class: record[column.key] ? 'badge-failure' : 'badge-success'
    }
  }
  
  return {}
}

// Watch for prop changes - separate watchers to avoid array destructuring issues
watch(() => props.show, (newShow, oldShow) => {
  console.log('🔧 Modal show watch triggered:', { 
    newShow, oldShow, 
    metricKey: props.metricKey,
    shouldFetch: newShow && props.metricKey && newShow !== oldShow
  })
  
  if (newShow && props.metricKey && newShow !== oldShow) {
    safeFetchData()
  }
}, { immediate: true })

watch(() => props.metricKey, (newMetric, oldMetric) => {
  console.log('🔧 Modal metricKey watch triggered:', { 
    newMetric, oldMetric, 
    show: props.show,
    shouldFetch: props.show && newMetric && newMetric !== oldMetric
  })
  
  if (props.show && newMetric && newMetric !== oldMetric) {
    safeFetchData()
  }
}, { immediate: true })

// Load data when modal opens
onMounted(() => {
  if (props.show && props.metricKey) {
    safeFetchData()
  }
})
</script>

<style scoped>
/* Modal Layout */
.modal-full-width .modal-dialog {
  max-width: 95vw;
  width: 95vw;
  margin: 2rem auto;
}

.modal-content {
  border: none;
  border-radius: 16px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  background: #ffffff;
}

.modal-header {
  border-bottom: 1px solid #f3f4f6;
  padding: 1.5rem;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-radius: 16px 16px 0 0;
}

.modal-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.modal-body {
  padding: 0;
  max-height: 70vh;
  overflow-y: auto;
}

.modal-backdrop {
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

/* Summary Bar */
.drilldown-summary {
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-bottom: 1px solid #e5e7eb;
  padding: 1rem 1.5rem;
}

.summary-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.summary-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #6b7280;
}

.summary-count {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
}

.summary-text {
  color: #6b7280;
}

.summary-limit {
  color: #9ca3af;
  font-size: 0.75rem;
}

.close-btn {
  background: none;
  border: none;
  color: #6b7280;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 8px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  background-color: #f3f4f6;
  color: #1f2937;
}

/* Table Container */
.drilldown-table-container {
  background: #ffffff;
}

.table-wrapper {
  overflow-x: auto;
  border-radius: 0;
}

/* Modern Table Styles */
.drilldown-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.875rem;
}

/* Table Headers */
.table-header {
  background: #f8fafc;
  padding: 0.75rem 1rem;
  font-weight: 600;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
  border-bottom: 2px solid #e5e7eb;
  text-align: left;
  vertical-align: middle;
}

.table-header.sortable {
  cursor: pointer;
  transition: background-color 0.2s;
}

.table-header.sortable:hover {
  background-color: #f1f5f9;
}

.column-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.sort-icon {
  font-size: 0.625rem;
  opacity: 0.5;
  transition: opacity 0.2s;
}

.table-header.sortable:hover .sort-icon {
  opacity: 0.8;
}

.action-column {
  text-align: center;
  min-width: 100px;
}

/* Table Cells */
.table-cell {
  padding: 0.875rem 1rem;
  border-bottom: 1px solid #f3f4f6;
  vertical-align: middle;
  color: #374151;
}

.cell-content {
  display: block;
  line-height: 1.5;
}

/* Row Styling */
.row-even {
  background-color: #ffffff;
}

.row-odd {
  background-color: #fafbfc;
}

.row-even:hover,
.row-odd:hover {
  background-color: #f8fafc;
  transition: background-color 0.2s;
}

/* Special Cell Types */
.action-cell {
  text-align: center;
  padding: 0.75rem 0.5rem;
}

.badge-cell {
  text-align: center;
}

.state-cell {
  font-weight: 500;
}

.time-cell {
  font-size: 0.8125rem;
  color: #6b7280;
}

/* Custom Components */
.external-link {
  color: #3b82f6;
  text-decoration: none;
  font-weight: 500;
  padding: 0.375rem 0.75rem;
  border-radius: 6px;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.external-link::before {
  content: '↗';
  font-size: 0.75rem;
}

.external-link:hover {
  background-color: #eff6ff;
  color: #2563eb;
  text-decoration: none;
}

.time-ago {
  color: #6b7280;
  font-size: 0.8125rem;
}

.boolean-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.badge-success {
  background-color: #dcfce7;
  color: #166534;
}

.badge-failure {
  background-color: #fef2f2;
  color: #dc2626;
}

/* State Styling */
.state-cell .cell-content {
  font-weight: 500;
}

.state-cell .cell-content[data-value="merged"] {
  color: #059669;
}

.state-cell .cell-content[data-value="open"] {
  color: #3b82f6;
}

.state-cell .cell-content[data-value="closed"] {
  color: #6b7280;
}

/* Loading and Empty States */
.loading-state,
.empty-state {
  padding: 3rem 1.5rem;
  text-align: center;
  color: #6b7280;
}

.loading-state i,
.empty-state i {
  font-size: 3rem;
  margin-bottom: 1rem;
  opacity: 0.5;
}

.error-state {
  padding: 2rem 1.5rem;
  text-align: center;
  background-color: #fef2f2;
  border-left: 4px solid #dc2626;
  margin: 1rem;
  border-radius: 8px;
}

/* Responsive Design */
@media (max-width: 768px) {
  .modal-full-width .modal-dialog {
    max-width: 100vw;
    width: 100vw;
    margin: 0;
    border-radius: 0;
  }
  
  .modal-content {
    border-radius: 0;
    height: 100vh;
  }
  
  .modal-header {
    border-radius: 0;
  }
  
  .table-header {
    font-size: 0.6875rem;
    padding: 0.5rem 0.75rem;
  }
  
  .table-cell {
    padding: 0.75rem 0.5rem;
    font-size: 0.8125rem;
  }
  
  .summary-content {
    flex-direction: column;
    gap: 0.75rem;
    align-items: flex-start;
  }
}
</style>
