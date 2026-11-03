<script setup lang="ts">
/**
 * PI Engine Audit Panel
 * 
 * Temporary debug component for verifying final PI engine provenance.
 * Displays comprehensive audit information without requiring console inspection.
 * 
 * NO console dependency - all audit data visible in UI.
 */

import { ref, computed, onMounted } from 'vue'

interface PIAuditData {
  featureFlagEnabled: boolean
  finalEngineCount: number
  legacyEngineCount: number
  idsByEngine: {
    finalEngine: string[]
    legacyEngine: string[]
  }
  stubCount: number
  realCount: number
  stubIds: string[]
  realIds: string[]
  missingCanonicalIds: string[]
  duplicateIds: string[]
  stageCounts: {
    'plan-code': number
    'review-merge': number
    'deploy-operate': number
  }
  fallbackActivated: boolean
  totalInsights: number
  filteredOutCount: number
  errors: string[]
  warnings: string[]
}

const auditData = ref<PIAuditData | null>(null)
const panelVisible = ref(false)

// Expected canonical IDs (14 total)
const EXPECTED_CANONICAL_IDS = [
  'active-coding-time-by-ide',
  'delivery-rate-ai-vs-non-ai',
  'telemetry-ai-focus-imbalance',
  'session-conditioned-pr-cycle-time-ai-vs-non-ai',
  'executive-ai-yield-optimization',
  'reopen-pressure-spike',
  'reviewer-load-concentration',
  'revert-rate-by-ide',
  'executive-ai-reopen-pressure-risk',
  'executive-small-pr-workflow-optimization',
  'delivery-velocity-by-workflow',
  'change-failure-rate-spike-by-ide',
  'synthesized-deployment-cadence',
  'executive-stable-deployment-acceleration'
]

onMounted(() => {
  // Read audit data from window.__PI_AUDIT if available
  const windowAudit = (window as any).__PI_AUDIT
  if (windowAudit) {
    auditData.value = windowAudit
  }
})

const hasErrors = computed(() => {
  return auditData.value && auditData.value.errors.length > 0
})

const hasWarnings = computed(() => {
  return auditData.value && auditData.value.warnings.length > 0
})

const auditStatus = computed(() => {
  if (!auditData.value) return 'No audit data'
  if (auditData.value.errors.length > 0) return 'FAILED'
  if (auditData.value.warnings.length > 0) return 'WARNINGS'
  return 'PASSED'
})

const statusColor = computed(() => {
  if (!auditData.value) return 'gray'
  if (auditData.value.errors.length > 0) return 'red'
  if (auditData.value.warnings.length > 0) return 'orange'
  return 'green'
})

function togglePanel() {
  panelVisible.value = !panelVisible.value
}
</script>

<template>
  <div class="pi-audit-panel-container">
    <!-- Toggle Button -->
    <button 
      @click="togglePanel"
      class="pi-audit-toggle"
      :style="{ backgroundColor: statusColor }"
    >
      📊 PI Audit: {{ auditStatus }}
    </button>

    <!-- Audit Panel -->
    <div v-if="panelVisible && auditData" class="pi-audit-panel">
      <div class="pi-audit-header">
        <h3>PI Engine Audit Panel</h3>
        <div class="audit-status" :style="{ color: statusColor }">
          Status: {{ auditStatus }}
        </div>
      </div>

      <!-- Errors Section -->
      <div v-if="hasErrors" class="audit-section errors">
        <h4>❌ ERRORS</h4>
        <ul>
          <li v-for="(error, idx) in auditData.errors" :key="idx">{{ error }}</li>
        </ul>
      </div>

      <!-- Warnings Section -->
      <div v-if="hasWarnings" class="audit-section warnings">
        <h4> WARNINGS</h4>
        <ul>
          <li v-for="(warning, idx) in auditData.warnings" :key="idx">{{ warning }}</li>
        </ul>
      </div>

      <!-- Summary Section -->
      <div class="audit-section summary">
        <h4> Summary</h4>
        <div class="audit-grid">
          <div class="audit-item">
            <span class="label">Total Insights:</span>
            <span class="value">{{ auditData.totalInsights }}</span>
          </div>
          <div class="audit-item">
            <span class="label">Final Engine:</span>
            <span class="value">{{ auditData.finalEngineCount }}</span>
          </div>
          <div class="audit-item">
            <span class="label">Legacy Engine:</span>
            <span class="value">{{ auditData.legacyEngineCount }}</span>
          </div>
          <div class="audit-item">
            <span class="label">Filtered Duplicates:</span>
            <span class="value">{{ auditData.filteredOutCount || 0 }}</span>
          </div>
          <div class="audit-item">
            <span class="label">Stub PIs:</span>
            <span class="value text-warning">{{ auditData.stubCount || 0 }}</span>
          </div>
          <div class="audit-item">
            <span class="label">Real Migrated PIs:</span>
            <span class="value text-success">{{ auditData.realCount || 0 }}</span>
          </div>
          <div class="audit-item">
            <span class="label">Feature Flag:</span>
            <span class="value">{{ auditData.featureFlagEnabled ? 'ENABLED' : 'DISABLED' }}</span>
          </div>
          <div class="audit-item">
            <span class="label">Fallback Activated:</span>
            <span class="value">{{ auditData.fallbackActivated ? 'YES' : 'NO' }}</span>
          </div>
        </div>
      </div>

      <!-- Implementation Details Section -->
      <div v-if="auditData.stubIds?.length || auditData.realIds?.length" class="audit-section">
        <h4> Implementation Status</h4>
        <div class="engine-breakdown">
          <div v-if="auditData.stubIds?.length">
            <strong class="text-warning">Stub PIs ({{ auditData.stubIds.length }}):</strong>
            <ul>
              <li v-for="id in auditData.stubIds" :key="id" class="text-warning">{{ id }}</li>
            </ul>
          </div>
          <div v-if="auditData.realIds?.length">
            <strong class="text-success">Real Migrated PIs ({{ auditData.realIds.length }}):</strong>
            <ul>
              <li v-for="id in auditData.realIds" :key="id" class="text-success">{{ id }}</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- IDs by Engine Section -->
      <div class="audit-section">
        <h4> IDs by Engine</h4>
        <div class="engine-breakdown">
          <div>
            <strong>Final Engine ({{ auditData.idsByEngine.finalEngine.length }}):</strong>
            <ul v-if="auditData.idsByEngine.finalEngine.length > 0">
              <li v-for="id in auditData.idsByEngine.finalEngine" :key="id">{{ id }}</li>
            </ul>
            <div v-else class="empty">None</div>
          </div>
          <div>
            <strong>Legacy Engine ({{ auditData.idsByEngine.legacyEngine.length }}):</strong>
            <ul v-if="auditData.idsByEngine.legacyEngine.length > 0">
              <li v-for="id in auditData.idsByEngine.legacyEngine" :key="id">{{ id }}</li>
            </ul>
            <div v-else class="empty">None</div>
          </div>
        </div>
      </div>

      <!-- Missing Canonical IDs Section -->
      <div v-if="auditData.missingCanonicalIds.length > 0" class="audit-section missing">
        <h4> Missing Canonical IDs ({{ auditData.missingCanonicalIds.length }})</h4>
        <ul>
          <li v-for="id in auditData.missingCanonicalIds" :key="id">{{ id }}</li>
        </ul>
      </div>

      <!-- Duplicate IDs Section -->
      <div v-if="auditData.duplicateIds.length > 0" class="audit-section duplicates">
        <h4> Duplicate IDs ({{ auditData.duplicateIds.length }})</h4>
        <ul>
          <li v-for="id in auditData.duplicateIds" :key="id">{{ id }}</li>
        </ul>
      </div>

      <!-- Stage Counts Section -->
      <div class="audit-section">
        <h4> Stage Counts</h4>
        <div class="stage-breakdown">
          <div>Plan & Code: {{ auditData.stageCounts['plan-code'] }}</div>
          <div>Review & Merge: {{ auditData.stageCounts['review-merge'] }}</div>
          <div>Deploy & Operate: {{ auditData.stageCounts['deploy-operate'] }}</div>
        </div>
      </div>
    </div>

    <div v-if="panelVisible && !auditData" class="pi-audit-panel">
      <p>No audit data available. Ensure window.__PI_AUDIT is populated after PI generation.</p>
    </div>
  </div>
</template>

<style scoped>
.pi-audit-panel-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
  font-family: monospace;
  font-size: 12px;
}

.pi-audit-toggle {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  color: white;
  cursor: pointer;
  font-weight: bold;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.pi-audit-panel {
  background: white;
  border: 2px solid #333;
  border-radius: 8px;
  padding: 16px;
  margin-top: 8px;
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.pi-audit-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #ddd;
}

.pi-audit-header h3 {
  margin: 0;
  font-size: 16px;
}

.audit-status {
  font-weight: bold;
  font-size: 14px;
}

.audit-section {
  margin-bottom: 16px;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.audit-section h4 {
  margin: 0 0 8px 0;
  font-size: 14px;
}

.audit-section.errors {
  background: #fee;
  border-color: #f88;
}

.audit-section.warnings {
  background: #fff8e1;
  border-color: #ffc107;
}

.audit-section.missing {
  background: #fff3cd;
  border-color: #ffc107;
}

.audit-section.duplicates {
  background: #f8d7da;
  border-color: #dc3545;
}

.audit-section ul {
  margin: 0;
  padding-left: 20px;
}

.audit-section li {
  margin-bottom: 4px;
}

.audit-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.audit-item {
  display: flex;
  justify-content: space-between;
  padding: 4px 8px;
  background: #f5f5f5;
  border-radius: 4px;
}

.audit-item .label {
  font-weight: bold;
}

.audit-item .value {
  color: #333;
}

.engine-breakdown {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.engine-breakdown ul {
  margin: 4px 0 0 0;
}

.engine-breakdown li {
  font-size: 11px;
}

.empty {
  color: #999;
  font-style: italic;
}

.stage-breakdown {
  display: flex;
  gap: 16px;
}

.stage-breakdown div {
  padding: 4px 8px;
  background: #f5f5f5;
  border-radius: 4px;
}
</style>
