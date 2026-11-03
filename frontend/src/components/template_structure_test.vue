<template>
  <div class="performance-insights-chips">
    <!-- Chips Grid by Stage -->
    <template v-for="stage in stages" :key="stage.id">
      <!-- Decision Panel -->
      <div v-if="expandedChipId && getExpandedInsightForStage(stage.id)" class="decision-panel">
        <div class="decision-header">
          <div class="decision-title-area">
            <div class="decision-icon">
              <i></i>
            </div>
            <div>
              <h3></h3>
              <div></div>
            </div>
          </div>
          <button type="button" class="decision-close">
            <i></i>
          </button>
        </div>
        <div class="primary-metric-section">
          <div class="metric-main">
            <div class="metric-value"></div>
            <div class="metric-label"></div>
          </div>
          <div class="metric-change"></div>
        </div>
        <div class="data-quality-section">
          <div class="quality-item">
            <div class="quality-label"></div>
            <div class="quality-value"></div>
          </div>
          <div class="quality-item">
            <div class="quality-label"></div>
            <div class="quality-value"></div>
          </div>
        </div>
        <div class="tool-breakdown-section">
          <div class="section-label"></div>
          <div class="tool-list">
            <div class="tool-item">
              <div class="tool-name"></div>
              <div class="tool-value"></div>
              <div class="tool-diff"></div>
            </div>
          </div>
        </div>
        <div class="decision-content">
          <div class="decision-section">
            <div class="section-label"></div>
            <div class="section-text"></div>
          </div>
          <div class="decision-section">
            <div class="section-label"></div>
            <div class="section-text"></div>
          </div>
          <div class="decision-section">
            <div class="section-label"></div>
            <div class="section-text"></div>
          </div>
        </div>
      </div>
      
      <!-- Stage Section -->
      <div v-if="getStageInsights(stage.id).length > 0" class="stage-section mb-4">
        <div class="primary-insight-block mb-4">
          <div class="primary-insight-icon">
            <i></i>
          </div>
          <div class="primary-insight-text"></div>
        </div>
        <div class="causal-connector">
          <div class="causal-connector-text"></div>
        </div>
        <div class="supporting-row mb-3">
          <div class="chip-tile chip-container supporting-chip">
            <div class="chip-executive-display">
              <div class="chip-primary-value chip-value"></div>
            </div>
          </div>
        </div>
        <div class="context-grid chip-grid">
          <div class="chip-tile chip-container context-chip">
            <div class="chip-executive-display">
              <div class="chip-primary-value chip-value"></div>
            </div>
          </div>
        </div>
      </div>
    </template>
    
    <!-- Empty State -->
    <div v-if="totalInsightsCount === 0 && placeholderInsights.length === 0" class="empty-state text-center py-4">
      <div class="empty-icon mb-3">
        <i></i>
      </div>
      <h6 class="text-muted"></h6>
      <small class="text-muted"></small>
      <div class="mt-3">
        <div class="spinner-border spinner-border-sm text-muted" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Test script
</script>
