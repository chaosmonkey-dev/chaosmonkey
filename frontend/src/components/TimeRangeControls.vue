<template>
  <div class="time-range-controls">
    <div class="card mb-4 shadow-sm">
      <div class="card-header bg-dark text-white">
        <h5 class="mb-0">
          <i class="bi bi-clock me-2"></i>Time Range & Comparison Controls
        </h5>
        <small class="text-light">Configure time periods and comparison modes</small>
      </div>
      <div class="card-body">
        <div class="row g-3">
          <!-- Time Range Selection -->
          <div class="col-md-6">
            <label class="form-label fw-semibold text-dark">
              <i class="bi bi-calendar-range me-1"></i>Time Range
            </label>
            <select 
              v-model="selectedRange" 
              class="form-select" 
              @change="handleRangeChange"
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
              <option value="all">All Time</option>
            </select>
            <div class="form-text text-muted">
              <i class="bi bi-info-circle me-1"></i>
              {{ getRangeDescription(selectedRange) }}
            </div>
          </div>
          
          <!-- Comparison Mode Selection -->
          <div class="col-md-6">
            <label class="form-label fw-semibold text-dark">
              <i class="bi bi-graph-up me-1"></i>Comparison Mode
            </label>
            <select 
              v-model="selectedComparison" 
              class="form-select" 
              @change="handleComparisonChange"
            >
              <option value="wow">Week-over-Week (WoW)</option>
              <option value="mom">Month-over-Month (MoM)</option>
              <option value="qoq">Quarter-over-Quarter (QoQ)</option>
              <option value="none">No Comparison</option>
            </select>
            <div class="form-text text-muted">
              <i class="bi bi-info-circle me-1"></i>
              {{ getComparisonDescription(selectedComparison) }}
            </div>
          </div>
        </div>
        
        <!-- Active Selection Display -->
        <div class="row mt-3">
          <div class="col-12">
            <div class="alert alert-light border">
              <div class="d-flex align-items-center justify-content-between">
                <div>
                  <i class="bi bi-funnel-fill me-2 text-primary"></i>
                  <strong>Active Settings:</strong>
                  <span class="badge bg-primary ms-2">{{ selectedRange }}</span>
                  <span v-if="selectedComparison !== 'none'" class="badge bg-info ms-2">{{ selectedComparison.toUpperCase() }}</span>
                </div>
                <div>
                  <button @click="resetToDefaults" class="btn btn-outline-secondary btn-sm">
                    <i class="bi bi-arrow-clockwise me-1"></i>Reset to Defaults
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'

// Props
const props = defineProps({
  initialRange: {
    type: String,
    default: 'week'
  },
  initialComparison: {
    type: String,
    default: 'wow'
  }
})

// Emits
const emit = defineEmits(['change'])

// Reactive data
const selectedRange = ref(props.initialRange)
const selectedComparison = ref(props.initialComparison)

// Local storage keys
const STORAGE_KEYS = {
  TIME_RANGE: 'codesight_time_range',
  COMPARISON: 'codesight_comparison'
}

// Load saved preferences from localStorage
function loadSavedPreferences() {
  try {
    const savedRange = localStorage.getItem(STORAGE_KEYS.TIME_RANGE)
    const savedComparison = localStorage.getItem(STORAGE_KEYS.COMPARISON)
    
    if (savedRange) {
      selectedRange.value = savedRange
    }
    if (savedComparison) {
      selectedComparison.value = savedComparison
    }
  } catch (error) {
    console.warn('Failed to load time range preferences:', error)
  }
}

// Save preferences to localStorage
function savePreferences() {
  try {
    localStorage.setItem(STORAGE_KEYS.TIME_RANGE, selectedRange.value)
    localStorage.setItem(STORAGE_KEYS.COMPARISON, selectedComparison.value)
  } catch (error) {
    console.warn('Failed to save time range preferences:', error)
  }
}

// Handle range change
function handleRangeChange() {
  savePreferences()
  emitChange()
}

// Handle comparison change
function handleComparisonChange() {
  savePreferences()
  emitChange()
}

// Emit change event with current values
function emitChange() {
  emit('change', {
    range: selectedRange.value,
    comparison: selectedComparison.value
  })
}

// Reset to default values
function resetToDefaults() {
  selectedRange.value = props.initialRange
  selectedComparison.value = props.initialComparison
  savePreferences()
  emitChange()
}

// Get range description
function getRangeDescription(range) {
  const descriptions = {
    week: 'Last 7 days of data',
    month: 'Last 30 days of data',
    quarter: 'Last 90 days of data',
    all: 'Complete historical data'
  }
  return descriptions[range] || ''
}

// Get comparison description
function getComparisonDescription(comparison) {
  const descriptions = {
    wow: 'Compare with previous week',
    mom: 'Compare with previous month',
    qoq: 'Compare with previous quarter',
    none: 'No comparison data'
  }
  return descriptions[comparison] || ''
}

// Watch for prop changes and update local state
watch(() => props.initialRange, (newRange) => {
  if (newRange && newRange !== selectedRange.value) {
    selectedRange.value = newRange
    savePreferences()
  }
})

watch(() => props.initialComparison, (newComparison) => {
  if (newComparison && newComparison !== selectedComparison.value) {
    selectedComparison.value = newComparison
    savePreferences()
  }
})

// Lifecycle
onMounted(() => {
  loadSavedPreferences()
  // Emit initial values
  emitChange()
})
</script>

<style scoped>
.time-range-controls .form-select {
  border: 1px solid #dee2e6;
  transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
}

.time-range-controls .form-select:focus {
  border-color: #86b7fe;
  box-shadow: 0 0 0 0.25rem rgba(13, 110, 253, 0.25);
}

.time-range-controls .form-label {
  color: #495057;
  font-weight: 600;
}

.time-range-controls .form-text {
  font-size: 0.875rem;
  color: #6c757d !important;
}

.time-range-controls .alert {
  background-color: #f8f9fa;
  border-color: #dee2e6;
}

.time-range-controls .badge {
  font-size: 0.875rem;
  padding: 0.5rem 0.75rem;
}

.time-range-controls .btn-outline-secondary:hover {
  background-color: #6c757d;
  border-color: #6c757d;
  color: white;
}
</style>
