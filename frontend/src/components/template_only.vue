<template>
  <div class="performance-insights-chips">
    <!-- Chips Grid by Stage - NO DUPLICATE HEADERS (handled by parent widget) -->
    <template v-for="stage in stages" :key="stage.id">
      
      <!-- 🎯 CLEAN DECISION PANEL - STRIPE/DATADOG STYLE -->
      <div
        v-if="expandedChipId && getExpandedInsightForStage(stage.id)"
        class="decision-panel"
      >
        <!-- Clean Header -->
        <div class="decision-header">
          <div class="decision-title-area">
            <div class="decision-icon" :class="getChipTheme(getExpandedInsightForStage(stage.id)!.cicdStage)">
              <i :class="getInsightIcon(getExpandedInsightForStage(stage.id)!)"></i>
            </div>

                          <div>
              <h3 class="decision-title">{{ getConclusionTitle(getExpandedInsightForStage(stage.id)!) }}</h3>
              <div class="decision-subtitle">{{ getExpandedInsightForStage(stage.id)!.description || 'Performance analysis' }}</div>
            </div>

                        </div>

                        <button type="button" class="decision-close" @click.stop="expandedChipId = null">
            <i class="bi bi-x"></i>
          </button>
        </div>

        <!-- Primary Metric Section -->
        <div class="primary-metric-section">
          <div class="metric-main">
            <div class="metric-value">{{ getExpandedInsightValue(getExpandedInsightForStage(stage.id)!) }}</div>

                          <div class="metric-label">{{ getCompleteContext(getExpandedInsightForStage(stage.id)!) }}</div>

                        </div>

          <div v-if="getExpandedInsightForStage(stage.id)!.displayDelta" class="metric-change">
            {{ getExpandedInsightForStage(stage.id)!.displayDelta }} vs baseline
          </div>

        </div>

        <!-- Data Quality & Impact -->
        <div class="data-quality-section">
          <div class="quality-item">
            <div class="quality-label">Confidence</div>

            <div class="quality-value">{{ getExpandedInsightForStage(stage.id)!.confidenceLevel || 'Medium' }}</div>
          </div>

          <div class="quality-item">
            <div class="quality-label">Impact</div>

            <div class="quality-value">{{ getExpandedInsightForStage(stage.id)!.severity === 'critical' ? 'High' : getExpandedInsightForStage(stage.id)!.severity === 'warning' ? 'Medium' : 'Low' }}</div>
          </div>
        </div>

        <!-- Tool Breakdown -->
        <div v-if="getToolBreakdown(getExpandedInsightForStage(stage.id))" class="tool-breakdown-section">
          <div class="section-label">Performance by Tool</div>

          <div class="tool-list">
            <div 
              v-for="(tool, index) in getToolBreakdown(getExpandedInsightForStage(stage.id))" 
              :key="tool.tool"
              class="tool-item"
              :class="{ 'tool-best': index === 0 }"
            >
              <div class="tool-name">{{ tool.tool }}</div>

              <div class="tool-value">{{ tool.value }}</div>

              <div v-if="index !== 0" class="tool-diff">+{{ calculateDelta(tool.value, getToolBreakdown(getExpandedInsightForStage(stage.id))[0].value) }}</div>
            </div>
          </div>
        </div>

              
        <!-- Decision Content -->
        <div class="decision-content">
          <div v-if="getSimpleTakeaway(getExpandedInsightForStage(stage.id)!)" class="decision-section">
            <div class="section-label">What Changed</div>

                          <div class="section-text">{{ getSimpleTakeaway(getExpandedInsightForStage(stage.id)!) }}</div>

                        </div>

              
          <div v-if="getDynamicRecommendation(getExpandedInsightForStage(stage.id)!) && getDynamicRecommendation(getExpandedInsightForStage(stage.id)!) !== 'No specific recommendation available.'" class="decision-section">
            <div class="section-label">Why It Matters</div>

                          <div class="section-text">{{ getExpandedInsightForStage(stage.id)!.description || 'This impacts your development workflow efficiency.' }}</div>

                        </div>

              
          <div v-if="getDynamicRecommendation(getExpandedInsightForStage(stage.id)!) && getDynamicRecommendation(getExpandedInsightForStage(stage.id)!) !== 'No specific recommendation available.'" class="decision-section">
            <div class="section-label">What to Do Next</div>

                          <div class="section-text">{{ getDynamicRecommendation(getExpandedInsightForStage(stage.id)!) }}</div>

                        </div>

                      </div>

                    </div>
                  </div>

                </div>

              <div
                v-if="getStageInsights(stage.id).length > 0"
                class="stage-section mb-4"
                :data-stage="stage.id"
              >

        <!-- PRIMARY INSIGHT BLOCK -->
        <div class="primary-insight-block mb-4">
          <div class="primary-insight-icon">
            <i :class="stage.icon"></i>
          </div>

          <div class="primary-insight-text">
            {{ getPrimaryInsightText(stage.id) }}
          </div>
        </div>

      <!-- 🎯 CAUSAL CONNECTOR BETWEEN STAGES -->
      <div
        v-if="stage.id !== 'deploy-operate' && getStageInsights(stage.id).length > 0"
        class="causal-connector"
      >
        <div class="causal-connector-text">
          {{ getCausalConnectorText(stage.id) }}
        </div>
      </div>

      <!-- SUPPORTING ROW -->
      <div
        v-if="getSupportingChips(stage.id).length > 0"
        class="supporting-row mb-3"
      >
        <div
          v-for="insight in getSupportingChips(stage.id)"
          :key="insight.id"
          class="chip-tile chip-container supporting-chip"
        >
          <div class="chip-executive-display">
            <div class="chip-primary-value chip-value">
              {{ insight.displayValue }}
            </div>
          </div>
        </div>
      </div>

      <!-- CONTEXT GRID -->
      <div
        v-if="getContextChips(stage.id).length > 0"
        class="context-grid chip-grid"
      >
        <div
          v-for="insight in getContextChips(stage.id)"
          :key="insight.id"
          class="chip-tile chip-container context-chip"
        >
          <div class="chip-executive-display">
            <div class="chip-primary-value chip-value">
              {{ insight.displayValue }}
            </div>
          </div>
        </div>
      </div>
    </div>
    </template>

    <!-- RIGHT-SIDE POPOUT EXPANDED VIEW (COMMENTED OUT - NOW USING INLINE PANEL) -->
    <!-- Teleport to="body" removed - modal replaced with inline panel -->

    <!-- Empty State -->
    <div v-if="totalInsightsCount === 0 && placeholderInsights.length === 0" class="empty-state text-center py-4">
      <div class="empty-icon mb-3">
        <i class="bi bi-hourglass-split text-muted" style="font-size: 3rem;"></i>
      </div>

                    <h6 class="text-muted">Computing Performance Insights</h6>
      <small class="text-muted">
        {{ emptyStateMessage }}
      </small>
      <div class="mt-3">
        <div class="spinner-border spinner-border-sm text-muted" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
    </div>
  </div>
