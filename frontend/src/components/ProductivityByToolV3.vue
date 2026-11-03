<template>
  <div class="productivity-v3">
    
    <!-- ── V3 Context Bar (Reused from NextGen) ─────────────────────────────── -->
    <div class="v3-context-bar">
      <div class="v3-context-left">
        <span class="v3-status-indicator">
          <span class="v3-dot v3-dot--live"></span>
          {{ telemetryStatusShort }} · {{ contextWindowLabel }}
        </span>
        <span class="v3-metrics-summary">
          <template v-if="pbtHeaderLoading">Loading…</template>
          <template v-else-if="selectedView === 'timeseries' && selectedWorkflow !== 'compare' && !isDeliveryMetric">{{ selectedWorkflowLabel }} · {{ totalSessions.toLocaleString() }} sessions · {{ developerAttributedSessions.toLocaleString() }} developer-attributed</template>
          <template v-else>{{ primaryWorkflowsCount }} primary workflows · {{ emergingWorkflowsCount }} emerging · {{ totalSessions }} sessions</template>
          <!-- Count source: totalSessions aggregates sessionCount from canonical telemetry endpoint -->
        </span>
        <!-- CR-X Day 1B S1 P0-A: Developer coverage / filter trust UX — BACKEND AUTHORITY
             Denominator = canonical_population_count from backend metadata (scoped).
             Compare mode preserves the accepted invite-backed numerator; a
             developer-grouped drilldown uses the backend's resolver-based
             developer_attributed_sessions over the same scoped query.
             Fails closed when canonical metadata is not yet available. -->
        <span v-if="developerCoverage.available && !pbtHeaderLoading" class="v3-coverage-indicator" :class="developerCoverage.coveragePct >= 50 ? 'v3-coverage--ok' : 'v3-coverage--warn'" :title="developerCoverage.authorityLabel">
          <i class="bi bi-person-check"></i>
          <template v-if="developerCoverage.isDeveloperGrouped">
            {{ developerCoverage.attributed.toLocaleString() }}/{{ developerCoverage.total.toLocaleString() }} developer-attributed ({{ developerCoverage.coveragePct }}%)
            <span v-if="developerCoverage.unattributed > 0" class="v3-coverage-unattributed">· {{ developerCoverage.unattributed.toLocaleString() }} <span>unattributed</span></span>
          </template>
          <template v-else>
            {{ developerCoverage.inviteBacked.toLocaleString() }}/{{ developerCoverage.total.toLocaleString() }} developer-attributed ({{ developerCoverage.coveragePct }}%)
            <span v-if="developerCoverage.unattributed > 0" class="v3-coverage-unattributed">· {{ developerCoverage.unattributed.toLocaleString() }} invite-anonymous</span>
          </template>
        </span>
      </div>
    </div>

    <!-- ── V3 Ops Ticker (Powered by Classic Operational Signals) ───────────── -->
    <!-- Hidden entirely when there are no signals to show — an empty shell
         reads as failed rendering on a zero-telemetry pilot. -->
    <div v-if="operationalSignals.length > 0" class="v3-ticker">
      <div class="v3-ticker-label">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0d6efd" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        OPS TICKER
      </div>
      <div class="v3-ticker-scroll-wrap">
        <div class="v3-ticker-scroll">
          <span v-for="(signal, index) in operationalSignals" :key="index" class="v3-ticker-item">
            {{ signal }}
            <span v-if="index < operationalSignals.length - 1" class="v3-ticker-sep">·</span>
          </span>
        </div>
      </div>
    </div>

    <!-- ── Unified Controls Row (View + Filters) ─────────────────────────────── -->
    <div class="v3-unified-controls">
      <!-- View Toggle -->
      <div class="v3-toggle-group">
        <button 
          :class="['v3-toggle', selectedView === 'cards' && 'v3-toggle--active']"
          :disabled="isDeliveryMetric"
          :title="isDeliveryMetric ? 'Delivery metrics are org-level — Time Series view only' : ''"
          @click="selectedView = 'cards'"
        >
          Cards
        </button>
        <button 
          :class="['v3-toggle', selectedView === 'timeseries' && 'v3-toggle--active']"
          @click="selectedView = 'timeseries'"
        >
          Time Series
        </button>
      </div>
      
      <!-- Metric Selector -->
      <select v-model="localSelectedMetric" class="v3-select">
        <optgroup label="Focus & Productivity">
          <option value="active_coding_time_minutes">Active Coding Time</option>
          <option value="active_coding_ratio">Active Coding Ratio (%)</option>
          <option value="ai_usage_duration_minutes">AI Usage Duration</option>
          <option value="ai_usage_ratio">AI Usage Ratio (%)</option>
          <option value="average_session_length_minutes">Session Length</option>
          <option value="idle_time_minutes">Idle Time</option>
          <option value="idle_ratio">Idle Ratio (%)</option>
          <option value="time_to_first_commit_minutes">Time to First Commit</option>
          <option value="files_edited_per_session">Files Edited / Session</option>
          <option value="commits_per_session">Commits / Session (all sessions)</option>
        </optgroup>
        <optgroup label="Delivery">
          <option value="merged_pr_count">PRs Merged / Week</option>
          <option value="deployment_count">Deployments / Week</option>
          <option value="deploy_success_rate">Deploy Success Rate (%)</option>
          <option value="median_merge_cycle_hours">Merge Cycle Time (hrs)</option>
          <option value="release_count">Releases / Week</option>
          <option value="review_count">Reviews / Week</option>
          <option value="pr_review_cycles">Review Cycles / Week</option>
          <option value="merge_rate">Merge Rate (%)</option>
        </optgroup>
        <optgroup label="AI Output">
          <option value="ai_suggestions_accepted">AI Activity / Session</option>
        </optgroup>
      </select>

      <!-- Cost Layer (visible when cost data exists, hidden in Time Series).
           K1B: hidden under a cohort filter — configured spend is org-level
           and a cohort roll-up would be an estimate we cannot truthfully
           attribute in V1. -->
      <select v-if="hasCostData && selectedView !== 'timeseries' && !isCohortFiltered" v-model="selectedCostLayer" class="v3-select v3-select--cost">
        <option value="off">Cost Layer: Off</option>
        <option value="monthly">Monthly Spend</option>
        <option value="per_session">Spend / Session</option>
        <option value="per_hour">Spend / Active-Coding Hour (additive)</option>
        <option value="per_wallclock">Spend / Session-Hour (additive)</option>
        <option value="cost_adjusted" :disabled="!isOutputMetric">Output / $100</option>
      </select>
      <button v-if="selectedView !== 'timeseries'" @click="showCostEditor = true" class="v3-cost-edit-btn">
        <i class="bi bi-pencil"></i> Edit costs
      </button>

      <!-- Time Filter -->
      <select v-model="selectedTimeFilter" class="v3-select">
        <option value="all">All Time</option>
        <option value="day">Last Day</option>
        <option value="week">Last Week</option>
        <option value="month">Last 30 Days</option>
        <option value="quarter">Last Quarter</option>
      </select>

      <!-- Cohort Filter (K1B: replaces the dead team placeholder; scopes
           canonical telemetry to current cohort membership) -->
      <select v-model="selectedCohort" class="v3-select" :disabled="cohortsLoadError !== null"
        :title="cohortsLoadError ? 'Cohorts unavailable: ' + cohortsLoadError : 'Filter by developer cohort (current membership)'">
        <option value="">All Cohorts</option>
        <option value="unassigned">Unassigned</option>
        <option v-for="c in availableCohorts" :key="c.id" :value="String(c.id)">{{ c.name }} · {{ c.member_count }}</option>
        <option v-if="selectedCohortStale" :value="selectedCohort" disabled>Cohort unavailable (archived or removed)</option>
      </select>

      <!-- Developer Filter — always visible (CR5 V1: control must be present even when no developers are attributed) -->
      <select v-model="selectedDeveloper" class="v3-select">
        <option value="">All Developers</option>
        <option v-for="dev in availableDevelopers" :key="dev.id" :value="dev.id">{{ dev.label }}</option>
      </select>

      <!-- Repo Filter — always visible (CR-X Pass 5: show even when no repos attributed) -->
      <select v-model="selectedRepo" class="v3-select" :disabled="availableRepos.length === 0" :title="availableRepos.length === 0 ? 'No repos attributed in telemetry' : ''">
        <option value="">All Repos</option>
        <option v-for="repo in availableRepos" :key="repo.id" :value="repo.id">{{ repo.label }}</option>
        <option v-if="availableRepos.length === 0" value="" disabled>No repos attributed</option>
      </select>

      <!-- Workflow Filter (within-workflow trend; lives in the control plane
           so switching developer -> workflow -> metric needs no scrolling) -->
      <select v-if="selectedView === 'timeseries' && !isDeliveryMetric" v-model="selectedWorkflow" class="v3-select">
        <option value="compare" :disabled="isDeliveryMetric">Compare workflows</option>
        <option
          v-for="w in workflowOptions"
          :key="w.id"
          :value="w.id"
          :disabled="isDeliveryMetric"
        >{{ w.label }} · {{ workflowOptionSessionCount(w).toLocaleString() }} sessions</option>
      </select>

      <!-- Reset Filters -->
      <button @click="resetFilters" class="v3-filter-reset">Reset</button>
    </div>

    <!-- CR-X Pass 5 (C): Active filter context indicator -->
    <div v-if="activeFilterCount > 0" class="v3-active-filters">
      <span class="v3-active-filters-label">Active filters:</span>
      <span v-if="selectedTimeFilter !== 'all'" class="v3-active-filter-chip">
        Time: {{ timeFilterLabel }}
        <button @click="selectedTimeFilter = 'all'" class="v3-active-filter-remove">×</button>
      </span>
      <span v-if="selectedDeveloper" class="v3-active-filter-chip">
        Developer: {{ selectedDeveloperLabel }}
        <button @click="selectedDeveloper = ''" class="v3-active-filter-remove">×</button>
      </span>
      <span v-if="selectedRepo" class="v3-active-filter-chip">
        Repo: {{ selectedRepoLabel }}
        <button @click="selectedRepo = ''" class="v3-active-filter-remove">×</button>
      </span>
      <span v-if="isCohortFiltered" class="v3-active-filter-chip">
        Cohort: {{ selectedCohortLabel }}
        <button @click="selectedCohort = ''" class="v3-active-filter-remove">×</button>
      </span>
      <span v-if="selectedView === 'timeseries' && selectedWorkflow !== 'compare'" class="v3-active-filter-chip">
        Workflow: {{ selectedWorkflowLabel }}
        <button @click="selectedWorkflow = 'compare'" class="v3-active-filter-remove">×</button>
      </span>
      <button @click="resetFilters" class="v3-active-filters-clear">Clear all</button>
    </div>

    <!-- K1B: current-membership disclosure — cohort scope is
         current-membership semantics, not historical org chart. -->
    <div v-if="isCohortFiltered" class="v3-cohort-disclosure">
      Metrics use current cohort membership across the selected period.
    </div>

    <!-- ── Cost Summary Strip (visible only in Cards mode with cost layer active) ───────────────────────────────── -->
    <div v-if="selectedView === 'cards' && selectedCostLayer !== 'off' && !isDeveloperFiltered && !isRepoFiltered && !isCohortFiltered && selectedWorkflow === 'compare'" class="v3-cost-summary-strip">
      <div v-if="hasCostData" class="v3-cost-summary-active">
        <span class="v3-cost-badge">Configured estimate</span>
        <span class="v3-cost-sep">·</span>
        <span class="v3-cost-total">${{ totalMonthlySpend.toFixed(0) }}/mo configured</span>
        <span class="v3-cost-sep">·</span>
        <span class="v3-cost-highest">Highest configured: {{ highestSpendTool }} ${{ highestSpendAmount.toFixed(0) }}/mo</span>
        <span class="v3-cost-sep">·</span>
        <!-- CR-X Pass 4 (D): Dimensional economics — cost per delivery evidence -->
        <span v-if="costPerDeliveryEvidence" class="v3-cost-delivery">
          {{ costPerDeliveryEvidence }}
        </span>
        <span v-if="costPerDeliveryEvidence" class="v3-cost-sep">·</span>
        <span class="v3-cost-disclaimer">Not billing data</span>
        <button @click="showCostEditor = true" class="v3-cost-summary-edit">
          <i class="bi bi-pencil"></i> Edit costs
        </button>
      </div>
      <div v-else class="v3-cost-summary-neutral">
        <span class="v3-cost-neutral-text">Add tool costs to compare productivity against estimated spend.</span>
        <button @click="showCostEditor = true" class="v3-cost-summary-edit">
          <i class="bi bi-pencil"></i> Edit costs
        </button>
      </div>
    </div>

    <!-- CR-X C6: Allocated configured economics — per-bucket allocation supports repo/developer filters -->
    <div v-if="selectedView === 'cards' && selectedCostLayer !== 'off' && (isDeveloperFiltered || isRepoFiltered) && !isCohortFiltered && hasCostData" class="v3-cost-scope-info">
      <span class="v3-cost-scope-info-icon">ℹ</span>
      <span class="v3-cost-scope-info-text">
        Configured spend allocated by tool cost bucket and observed usage for {{ isRepoFiltered ? 'selected repository' : 'selected developer' }}.
      </span>
      <span v-if="costAuthorityLabel" class="v3-cost-authority-badge" :class="costAuthorityBadgeClass">{{ costAuthorityLabel }}</span>
    </div>

    <!-- CR-X Gate A: Truthful unavailable state when filtered but no authoritative cost config -->
    <div v-if="selectedView === 'cards' && selectedCostLayer !== 'off' && (isDeveloperFiltered || isRepoFiltered) && !hasCostData" class="v3-cost-scope-info v3-cost-scope-unavailable">
      <span class="v3-cost-scope-info-icon">⚠</span>
      <span class="v3-cost-scope-info-text">
        {{ costUnavailableMessage }}
      </span>
    </div>

    <!-- CR-X C6: Time Series allocated economics under repo/developer filter -->
    <div v-if="selectedView === 'time-series' && (isDeveloperFiltered || isRepoFiltered) && hasCostData" class="v3-cost-scope-info">
      <span class="v3-cost-scope-info-icon">ℹ</span>
      <span class="v3-cost-scope-info-text">
        Configured spend allocated by tool cost bucket and observed usage for {{ isRepoFiltered ? 'selected repository' : 'selected developer' }}.
      </span>
      <span v-if="costAuthorityLabel" class="v3-cost-authority-badge" :class="costAuthorityBadgeClass">{{ costAuthorityLabel }}</span>
    </div>

    <!-- ── Cost Editor Modal ───────────────────────────────────────── -->
    <div v-if="showCostEditor" class="v3-cost-modal-overlay" @click.self="showCostEditor = false">
      <div class="v3-cost-modal">
        <div class="v3-cost-modal-header">
          <div class="v3-cost-modal-title">
            <i class="bi bi-currency-dollar"></i>
            <span>Edit estimated AI tool costs</span>
          </div>
          <button @click="showCostEditor = false" class="v3-cost-modal-close">
            <i class="bi bi-x"></i>
          </button>
        </div>
        <div class="v3-cost-modal-subtitle">
          Estimated costs only · Based on configured tool rates · Not billing data · Saved for this organization
        </div>
        <div class="v3-cost-modal-content">
          <div class="table-responsive">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th style="width: 120px;">Active seats</th>
                  <th style="width: 150px;">Cost / seat / month</th>
                  <th style="width: 130px;">Monthly spend</th>
                </tr>
              </thead>
            <tbody>
              <tr>
                <td>Cursor</td>
                <td>
                  <input
                    type="number"
                    class="form-control form-control-sm"
                    v-model.number="costEditorState.cursor.seatCount"
                    placeholder="0"
                    min="0"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    class="form-control form-control-sm"
                    v-model.number="costEditorState.cursor.costPerSeatMonthly"
                    placeholder="0"
                    min="0"
                    step="0.01"
                  />
                </td>
                <td class="text-muted fw-semibold">{{ costEditorMonthlySpendDisplay('cursor') }}</td>
              </tr>
              <tr>
                <td>Devin</td>
                <td>
                  <input
                    type="number"
                    class="form-control form-control-sm"
                    v-model.number="costEditorState.devin.seatCount"
                    placeholder="0"
                    min="0"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    class="form-control form-control-sm"
                    v-model.number="costEditorState.devin.costPerSeatMonthly"
                    placeholder="0"
                    min="0"
                    step="0.01"
                  />
                </td>
                <td class="text-muted fw-semibold">{{ costEditorMonthlySpendDisplay('devin') }}</td>
              </tr>
              <tr>
                <td>VS Code</td>
                <td>
                  <input
                    type="number"
                    class="form-control form-control-sm"
                    v-model.number="costEditorState.vscode.seatCount"
                    placeholder="0"
                    min="0"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    class="form-control form-control-sm"
                    v-model.number="costEditorState.vscode.costPerSeatMonthly"
                    placeholder="0"
                    min="0"
                    step="0.01"
                  />
                </td>
                <td class="text-muted fw-semibold">{{ costEditorMonthlySpendDisplay('vscode') }}</td>
              </tr>
              <tr>
                <td>Claude Code</td>
                <td>
                  <input
                    type="number"
                    class="form-control form-control-sm"
                    v-model.number="costEditorState['claude-code'].seatCount"
                    placeholder="0"
                    min="0"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    class="form-control form-control-sm"
                    v-model.number="costEditorState['claude-code'].costPerSeatMonthly"
                    placeholder="0"
                    min="0"
                    step="0.01"
                  />
                </td>
                <td class="text-muted fw-semibold">{{ costEditorMonthlySpendDisplay('claude-code') }}</td>
              </tr>
              <tr>
                <td>GitHub Copilot</td>
                <td>
                  <input
                    type="number"
                    class="form-control form-control-sm"
                    v-model.number="costEditorState['github-copilot'].seatCount"
                    placeholder="0"
                    min="0"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    class="form-control form-control-sm"
                    v-model.number="costEditorState['github-copilot'].costPerSeatMonthly"
                    placeholder="0"
                    min="0"
                    step="0.01"
                  />
                </td>
                <td class="text-muted fw-semibold">{{ costEditorMonthlySpendDisplay('github-copilot') }}</td>
              </tr>
              <tr>
                <td>Codex</td>
                <td>
                  <input
                    type="number"
                    class="form-control form-control-sm"
                    v-model.number="costEditorState.codex.seatCount"
                    placeholder="0"
                    min="0"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    class="form-control form-control-sm"
                    v-model.number="costEditorState.codex.costPerSeatMonthly"
                    placeholder="0"
                    min="0"
                    step="0.01"
                  />
                </td>
                <td class="text-muted fw-semibold">{{ costEditorMonthlySpendDisplay('codex') }}</td>
              </tr>
            </tbody>
            </table>
          </div>
          <div class="v3-cost-modal-actions">
            <button @click="saveCostEditor" class="btn btn-primary">
              <i class="bi bi-save me-2"></i>Save costs
            </button>
            <button @click="clearCostEditor" class="btn btn-outline-secondary">
              <i class="bi bi-trash me-2"></i>Clear costs
            </button>
            <button @click="showCostEditor = false" class="btn btn-outline-secondary">
              Close
            </button>
          </div>
          <div v-if="costSaveError" class="alert alert-danger mt-2 mb-0 small" role="alert">
            {{ costSaveError }}
          </div>
        </div>
      </div>
    </div>

    <!-- ── CARD VIEW (Next-Gen Layout + Classic Data) ───────────────────────── -->
    <div v-if="selectedView === 'cards'" class="v3-cards-section">
      <!-- CR-X WAVE 2: Delivery metric notice in cards view -->
      <div v-if="isDeliveryMetric" class="v3-ts-delivery-notice" style="margin-bottom: 10px;">
        <i class="bi bi-info-circle"></i>
        <span v-if="deliveryMetricSuppressed">Delivery metrics are not available when a developer is filtered. Delivery evidence is org-level and cannot be attributed to individual developers.</span>
        <span v-else-if="deliveryError">{{ selectedMetricLabel }} delivery evidence is currently unavailable (fetch failed). Telemetry metrics remain available. Switch to Time Series view for details.</span>
        <span v-else>{{ selectedMetricLabel }} is {{ deliveryAttributionAuthority === 'repo' ? 'repo-level' : 'org-level' }} delivery evidence — not per-workflow. Switch to Time Series view to see the delivery trend.</span>
      </div>
      <!-- Workflows excluded from the cards grid because they cannot report
           the selected metric — explicit instrumentation scope, not data loss. -->
      <div v-if="ineligibleWorkflowsForMetric.length > 0 && !isDeliveryMetric" class="v3-ts-delivery-notice" style="margin-bottom: 10px;">
        <i class="bi bi-info-circle"></i>
        <span>
          {{ ineligibleWorkflowsForMetric.map(w => getCanonicalWorkflowIdentity(w.id)).join(', ') }}
          {{ ineligibleWorkflowsForMetric.length === 1 ? 'does' : 'do' }} not report
          {{ selectedMetricLabel }} — no card shown.
        </span>
      </div>
      <!-- Loading State — canonical telemetry hydrating -->
      <div v-if="props.canonicalHydrating && v3Cards.length === 0" class="v3-empty-state">
        <div class="d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
          <span class="text-muted">Loading workflow telemetry…</span>
        </div>
      </div>
      <!-- CR-X AH-3: ERROR != EMPTY — API failure must not masquerade as zero-data -->
      <div v-else-if="hasApiError" class="v3-empty-state v3-error-state">
        <div class="v3-empty-icon">⚠</div>
        <h6 class="v3-empty-title">Telemetry unavailable</h6>
        <p class="v3-empty-text">
          The telemetry service could not be reached. This is a temporary error, not an empty pilot.
          Please refresh the page. If the error persists, check that the backend is running.
        </p>
      </div>
      <!-- Empty State — only after authoritative canonical telemetry returns zero -->
      <div v-else-if="v3Cards.length === 0" class="v3-empty-state">
        <div class="v3-empty-icon">📊</div>
        <h6 class="v3-empty-title">
          {{ totalSessions === 0 ? 'No workflow telemetry yet' : 'Telemetry received' }}
        </h6>
        <p class="v3-empty-text">
          <template v-if="totalSessions === 0">
            Your IDE and AI-tool trends will appear here after the extension sends the first coding sessions.
          </template>
          <template v-else>
            {{ totalSessions }} session{{ totalSessions === 1 ? '' : 's' }} collected. Tool cards unlock at 25 sessions per workflow.
          </template>
        </p>
      </div>
      
      <div v-else class="v3-tool-grid">
        <div
          v-for="card in v3Cards"
          :key="card.id"
          class="v3-tool-card"
          :class="{ 
            'v3-tool-card--leader': card.isLeader,
            'v3-tool-card--laggard': card.isLaggard,
            'v3-tool-card--workflow': card.type === 'Workflow',
            'v3-tool-card--model': card.type === 'AI Model'
          }"
        >
          <!-- Card Header -->
          <div class="v3-tc-header">
            <div class="v3-tc-identity">
              <div class="v3-tc-icon">
                <i :class="card.icon"></i>
              </div>
              <div>
                <div class="v3-tc-name">{{ card.name }}</div>
                <div class="v3-tc-type">{{ card.type }}</div>
              </div>
            </div>
            <!-- CR4 Task 5: Rank badges removed entirely.
                 The metrics themselves communicate the values.
                 No LEADER/LAGGARD/OPPORTUNITY/HIGHEST/LOWEST labels. -->

          </div>

          <!-- Primary Metric -->
          <div class="v3-tc-primary">
            <div class="v3-tc-output-label">{{ card.metricLabel }}</div>
            <div class="v3-tc-output-value">{{ card.displayValue }}</div>
            <div class="v3-tc-sessions">{{ card.timeRangeLabel }}</div>
            <div class="v3-tc-sessions">{{ card.sessionCountLabel }}</div>
          </div>

          <!-- Divider -->
          <div class="v3-tc-divider"></div>

          <!-- Supporting Metrics -->
          <div class="v3-tc-metrics">
            <div v-for="metric in card.supportingMetrics" :key="metric.label" class="v3-tc-metric" :class="{ 'v3-tc-metric--fallback': metric.isFallback, 'v3-tc-metric--lowsample': metric.isLowSample, 'v3-tc-metric--cost': metric.isCost }">
              <div class="v3-tc-metric-val" :class="metric.trendClass">
                <span v-if="metric.trend === 'up'">↑</span>
                <span v-if="metric.trend === 'down'">↓</span>
                {{ metric.value }}
                <span v-if="metric.isFallback" class="v3-fallback-indicator">~</span>
                <span v-if="metric.isLowSample" class="v3-lowsample-indicator">⚠</span>
              </div>
              <div class="v3-tc-metric-label">{{ metric.label }}</div>
            </div>
          </div>

          <!-- Sparkline -->
          <div v-if="card.sparklineData && card.sparklineData.length > 0" class="v3-tc-spark">
            <svg viewBox="0 0 120 32" class="v3-spark-svg">
              <defs>
                <linearGradient :id="`sg-${card.id}`" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#2563eb" stop-opacity="0.3"/>
                  <stop offset="100%" stop-color="#2563eb" stop-opacity="0"/>
                </linearGradient>
              </defs>
              <path
                :d="generateSparklinePath(card.sparklineData)"
                fill="url(#sg-{{ card.id }})"
                stroke="#2563eb"
                stroke-width="2"
                fill-opacity="0.3"
              />
            </svg>
          </div>

          <!-- Performance Tier Label (operational context) -->
          <div v-if="card.bottomLabel" class="v3-tc-bottom" :class="card.bottomClass">
            {{ card.bottomLabel }}
          </div>
        </div>
      </div>
    </div>

    <!-- ── TIME SERIES VIEW (Decision-First Within-Workflow Trend) ──────────── -->
    <div v-if="selectedView === 'timeseries'" class="v3-ts-section" :key="`pbt-ts:${selectedMetric}:${selectedWorkflow || 'compare'}`">
      <!-- CR-X P4: Loading state — PBT time series is fetching. Show loading
           spinner instead of rendering an empty chart that displays
           "No Trend Data Available" during the fetch. Loading != Empty. -->
      <div v-if="pbtHeaderLoading" class="v3-empty-state">
        <div class="d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
          <span class="text-muted">Loading workflow telemetry…</span>
        </div>
      </div>
      <!-- CR-X P0-D: Zero-data state gated by PBT time series loading
           authority, NOT PI session hydration. PBT must not stay in
           zero-data or chart state while waiting for PI sessions. -->
      <div v-else-if="hasZeroDeveloperAttribution" class="v3-empty-state">
        <h6 class="v3-empty-title">No developer-attributed time series available for this workflow.</h6>
        <p class="v3-empty-text">{{ selectedWorkflowPopulation.toLocaleString() }} total sessions · 0/{{ selectedWorkflowPopulation.toLocaleString() }} developer-attributed</p>
      </div>
      <div v-else-if="!timeSeriesLoading && !hasApiError && totalSessions === 0 && availableWorkflows.length === 0 && isCompareMode" class="v3-empty-state">
        <div class="v3-empty-icon">📊</div>
        <h6 class="v3-empty-title">No workflow telemetry yet</h6>
        <p class="v3-empty-text">
          Your IDE and AI-tool trends will appear here after the extension sends the first coding sessions.
        </p>
      </div>
      <!-- CR-X P0-D: API error state gated by PBT loading authority -->
      <div v-else-if="!timeSeriesLoading && hasApiError && !timeSeriesData" class="v3-empty-state v3-error-state">
        <div class="v3-empty-icon">⚠</div>
        <h6 class="v3-empty-title">Telemetry unavailable</h6>
        <p class="v3-empty-text">
          The telemetry service could not be reached. This is a temporary error, not an empty pilot.
          Please refresh the page. If the error persists, check that the backend is running.
        </p>
      </div>

      <template v-else>
      <div class="v3-ts-chart-card">
        <div class="v3-ts-header">
          <div v-if="scopeSummaryLine" class="v3-ts-scope-summary">
            {{ scopeSummaryLine }}
            <span v-if="isDeliveryMetric && deliveryProvenanceLabel" class="v3-delivery-provenance-badge" :class="deliveryProvenanceClass">{{ deliveryProvenanceLabel }}</span>
          </div>
          <div v-if="currentPartialPeriodLabel" class="v3-ts-partial-week">
            {{ currentPartialPeriodLabel.label }} {{ currentPartialPeriodLabel.status }} · {{ currentPartialPeriodLabel.range }} ·
            Data through {{ currentPartialPeriodLabel.dataThrough ? new Date(currentPartialPeriodLabel.dataThrough).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—' }}
            — not used as a completed comparison period.
          </div>
        </div>

        <!-- CR-X R2: Delivery attribution notice -->
        <div v-if="isDeliveryMetric" class="v3-ts-delivery-notice">
          <i class="bi bi-info-circle"></i>
          <span v-if="deliveryMetricSuppressed">Delivery metrics are not available when a developer is filtered. Delivery evidence is org-level and cannot be attributed to individual developers.</span>
          <span v-else>Delivery evidence is {{ deliveryAttributionAuthority === 'repo' ? 'repo-level' : 'org-level' }} — not attributed to individual workflows. Workflow comparison is disabled.</span>
        </div>



        <!-- What-changed decision summary (single-workflow only; compare mode is tautological) -->
        <div v-if="!isCompareMode && !metricNotInstrumentedForWorkflow" class="v3-ts-what-changed">
          <span class="v3-ts-what-changed-label">What changed</span>
          <span class="v3-ts-what-changed-text">{{ whatChangedSummary }}</span>
        </div>


        <!-- Compare mode: name workflows excluded because they cannot report
             the selected metric. Exclusion must not look like data loss. -->
        <div v-if="isCompareMode && ineligibleWorkflowsForMetric.length > 0" class="v3-ts-delivery-notice">
          <i class="bi bi-info-circle"></i>
          <span>
            {{ ineligibleWorkflowsForMetric.map(w => getCanonicalWorkflowIdentity(w.id)).join(', ') }}
            {{ ineligibleWorkflowsForMetric.length === 1 ? 'does' : 'do' }} not report
            {{ selectedMetricLabel }} — excluded from this comparison.
          </span>
        </div>

        <!-- Metric not instrumented for this workflow: no zero series -->
        <div v-if="metricNotInstrumentedForWorkflow" class="v3-ts-not-instrumented">
          <div class="v3-ts-not-instrumented-icon">⊘</div>
          <div>
            <div class="v3-ts-not-instrumented-title">Not instrumented for this workflow</div>
            <div class="v3-ts-not-instrumented-text">
              {{ selectedMetricLabel }} is not captured for
              {{ effectiveWorkflowId ? getCanonicalWorkflowIdentity(effectiveWorkflowId) : 'this workflow' }}.
              Choose a different workflow or metric.
            </div>
          </div>
        </div>

        <!-- Cost Context Strip (Time Series only) — compact single-line provenance -->
        <!-- Suppress when a developer, repo, or cohort is selected: configured spend is
             org/workflow-level, not attributable to a developer, repository, or cohort. -->
        <div v-if="hasCostData && v3Cards.length > 0 && !isDeveloperFiltered && !isRepoFiltered && !isCohortFiltered" class="v3-cost-context-strip">
          <span class="v3-cost-context-badge">Configured estimate</span>
          <span class="v3-cost-context-sep">·</span>
          <span v-if="totalConfiguredSpend > 0" class="v3-cost-context-total">${{ totalConfiguredSpend.toFixed(0) }}/mo</span>
          <span v-else class="v3-cost-context-total">unavailable for selected scope</span>
          <span class="v3-cost-context-sep">·</span>
          <span v-if="lowestSpendPerSession.workflow && lowestSpendPerSession.workflow !== '—'" class="v3-cost-context-superlative">
            Lowest: {{ lowestSpendPerSession.workflow }} ${{ lowestSpendPerSession.value.toFixed(2) }}/session
          </span>
          <span v-if="lowestSpendPerSession.workflow && lowestSpendPerSession.workflow !== '—'" class="v3-cost-context-sep">·</span>
          <span v-if="highestSpendPerSession.workflow && highestSpendPerSession.workflow !== '—'" class="v3-cost-context-superlative">
            Highest: {{ highestSpendPerSession.workflow }} ${{ highestSpendPerSession.value.toFixed(2) }}/session
            <span v-if="highestSpendPerSession.isEmerging" class="v3-cost-context-emerging">Emerging sample</span>
          </span>
          <span v-if="highestSpendPerSession.workflow && highestSpendPerSession.workflow !== '—'" class="v3-cost-context-sep">·</span>
          <span class="v3-cost-context-disclaimer">Not billing data</span>
        </div>

        <!-- ── Compact developer allocated cost row (ONE horizontal line) ────
             Collapses the entire Time Series economic layer into a single
             inline row directly above the chart. Aggregate economics on the
             left, per-workflow economics as inline segments, disclaimer at the
             end. No secondary panel, no vertical workflow rows, no separate
             stat blocks. Formulas and calculations are unchanged — this is
             visual compression only. -->
        <!-- CR-X Phase 3: Developer-scoped cost row suppressed.
             Configured spend is org/workflow-level, not developer-attributable.
             The warning at line 194 explains why. -->
        <div
          v-if="false"
          class="v3-ts-cost-row"
          :title="`Allocated AI spend — ${selectedDeveloperLabel} · Context: ${selectedMetricLabel} · Configured tool spend split across observed developers · Derived metric volume is observational (average × observed sessions) · Not ROI · Not causal attribution`"
        >
          <!-- Aggregate economic context (left/start) — workflow-scoped -->
          <span class="v3-ts-cost-row-label">EST. AI SPEND</span>
          <span class="v3-ts-cost-row-aggregate">
            <template v-if="effectiveCostRowDerivation && effectiveCostRowDerivation.aggregateUnitCost !== null">
              ${{ effectiveCostRowDerivation.totalAllocated.toFixed(0) }}/mo allocated
              <span class="v3-ts-cost-row-sep">·</span>
              ~{{ effectiveCostRowDerivation.totalVolume < 100 ? effectiveCostRowDerivation.totalVolume.toFixed(1) : effectiveCostRowDerivation.totalVolume.toFixed(0) }} {{ effectiveCostRowDerivation.volumeLabel }}
              <span class="v3-ts-cost-row-sep">·</span>
              ${{ effectiveCostRowDerivation.aggregateUnitCost.toFixed(2) }} {{ effectiveCostRowDerivation.unitLabel }}
            </template>
            <template v-else>
              ${{ effectiveAllocatedMonthlyCost.toFixed(0) }}/mo allocated
              <span class="v3-ts-cost-row-sep">·</span>
              <span class="v3-ts-cost-row-na">unit cost N/A — {{ currentMetricSemantic.supported ? 'no valid metric volume' : 'non-additive metric' }}</span>
            </template>
          </span>

          <!-- Per-workflow inline segments (Compare mode) -->
          <template v-if="isCompareMode">
            <span
              v-for="deriv in developerMetricDerivations"
              :key="deriv.workflow"
              class="v3-ts-cost-row-wf"
            >
              <span class="v3-ts-cost-row-wf-sep">│</span>
              <span class="v3-ts-cost-row-wf-name">{{ getCanonicalWorkflowIdentity(deriv.workflow) }}</span>
              <span class="v3-ts-cost-row-wf-spend">${{ deriv.allocatedMonthly.toFixed(0) }}/mo</span>
              <span v-if="deriv.unitCost !== null && deriv.observedVolume !== null" class="v3-ts-cost-row-wf-unit">
                · ${{ deriv.unitCost.toFixed(2) }} {{ deriv.unitLabel }}
              </span>
              <span v-else class="v3-ts-cost-row-wf-unit v3-ts-cost-row-na">· N/A</span>
            </span>
          </template>

          <!-- Single workflow mode: show selected workflow inline -->
          <template v-else-if="effectiveWorkflowId">
            <span class="v3-ts-cost-row-wf">
              <span class="v3-ts-cost-row-wf-sep">│</span>
              <span class="v3-ts-cost-row-wf-name">{{ getCanonicalWorkflowIdentity(effectiveWorkflowId) }}</span>
              <span
                v-for="deriv in developerMetricDerivations.filter(d => d.workflow === effectiveWorkflowId || d.costToolId === workflowToCostToolId(effectiveWorkflowId))"
                :key="deriv.workflow"
                class="v3-ts-cost-row-wf-detail"
              >
                ${{ deriv.allocatedMonthly.toFixed(0) }}/mo
                <span v-if="deriv.unitCost !== null && deriv.observedVolume !== null">
                  · ~{{ deriv.observedVolume < 100 ? deriv.observedVolume.toFixed(1) : deriv.observedVolume.toFixed(0) }} {{ deriv.volumeLabel }} · ${{ deriv.unitCost.toFixed(2) }} {{ deriv.unitLabel }}
                </span>
                <span v-else class="v3-ts-cost-row-na">· N/A</span>
              </span>
            </span>
          </template>

          <!-- Compact disclaimer (inline, end of row) -->
          <span class="v3-ts-cost-row-disclaimer">· Configured estimate · Not billing data</span>
        </div>

        <ProductivityLineGraph
          v-if="!metricNotInstrumentedForWorkflow"
          :lineGraphData="decisionSeriesLineGraphData"
          :selectedMetric="selectedMetric"
          :selectedIDE="effectiveWorkflowId || 'all'"
          :timeFilter="timeRange"
          :comparisonMode="selectedComparisonMode"
          :comparisonEntities="comparisonEntities"
          :seriesDimension="seriesDimension"
          :scopeLabel="selectedWorkflowLabel"
          :hideHeader="false"
          :costOverlay="null"
          :isDeliveryMetric="isDeliveryMetric"
          :bucketPeriod="canonicalMetadata?.period || ''"
        />
      </div>
      </template>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, toRef, type Prop } from 'vue'
import { useFilterStore } from '@/stores/filters'
import { useAnalysisContextStore } from '@/stores/analysisContext'
import { useTimeSeries } from '@/composables/useTimeSeries'
import api, { API_ENDPOINTS } from '@/config/api'
import {
  getCanonicalEntityLabel,
  IDE_TO_MODEL_MAP,
  SUPPORTED_IDES,
  getCanonicalWorkflowIdentity,
  normalizeToCanonicalToolId,
  expandCanonicalToolIds,
  ALL_SUPPORTED_IDES
} from '@/lib/workflowIdentity'
import { resolveTimeSeriesPointField } from '@/lib/productivity/resolveTimeSeriesPointField'
import { deriveCanonicalWorkflowUniverse } from '@/lib/productivity/deriveCanonicalWorkflowUniverse'
import { generateMetricCards, determineLeader, determineLaggard, METRIC_POLARITY, filterPrimaryCards, filterEmergingCards, isPrimaryCardEligible, isMetricInstrumentedForTool } from '@/lib/productivityCards'
import { isMetricInstrumentedForWorkflow } from '@/lib/surfaceAgentContract'
import { formatDurationHoursMinutes } from '@/lib/utils/numberFormatting'
import { normalizeCostToolId, computeWindowSpend, saveOrgToolCostConfig, clearOrgToolCostConfig, clearAllOrgToolCostConfigs, getToolCostConfig, fetchOrgToolCostConfigsWithAuthority, costMonthlySpendDisplay } from '@/lib/toolCost'
import { computeDeveloperWorkflowEconomics, computeRepoWorkflowEconomics } from '@/lib/insights/final/economics/repoWorkflowEconomics'
import { normalizeRepoList, normalizeRepoUrl, repoDisplayLabel } from '@/lib/repoNormalization'
import { isOperatorEnrollmentEmail, isOperatorOnlyRepoIdentity } from '@/lib/operatorIdentities'
import { mapCuratedDevelopers, type CuratedDeveloper, type MappedDeveloper } from '@/lib/pbt/mapCuratedDevelopers'
import { isLocalLabMode, getTelemetryStatusShort, getOperationalSignalText } from '../lib/insights/runtimeMode'
import {
  extractWeeklyPoints,
  compareCompleteWeeks,
  buildWhatChangedSummary,
  buildScopeSummary,
  isCurrentWeekPartial,
  weekStartISO,
} from '@/lib/productivity/decisionSurface'
import ProductivityLineGraph from './ProductivityLineGraph.vue'

// Props
const props = defineProps({
  insights: { type: Array, default: () => [] },
  githubMetrics: { type: Object, default: () => null },
  githubLoading: { type: Boolean, default: false },
  githubError: { type: String, default: null },
  githubConnected: { type: Boolean, default: false },
  githubReady: { type: Boolean, default: false },
  canonicalHydrating: { type: Boolean, default: false },
  // CR-X Gate A: Authoritative canonical session rows (full org population)
  // for PBT cost allocation bucket denominator
  authoritativeSessions: { type: Array, default: () => [] },
  // CR-X Gate A: Resolved cost configs from backend (shared authority)
  resolvedCostConfigs: { type: Array, default: () => [] },
  // CR-X Gate A: Explicit cost-authority contract
  // 'backend_persisted' = backend is authoritative
  // 'backend_empty' = no persisted configs; localStorage is NOT org truth
  // 'backend_unavailable' = local fallback is graceful degradation only
  costConfigAuthority: { type: String as Prop<string>, default: 'backend_unavailable' },
  // CR-X P0: PBT must not fetch telemetry while the tab is inactive/hidden.
  isActive: { type: Boolean, default: false }
})

// CR-X ECON-1: Emit refresh-cost-configs after editor save/clear so Dashboards re-fetches
const emit = defineEmits(['refresh-cost-configs'])

// Stores - Classic functionality source
const filterStore = useFilterStore()
// CR-X Day 1B S3: PBT reads scope from shared analysisContext (same authority as PI)
// filterStore remains the UI/filter writer; analysisContext is the read authority.
const analysisContext = useAnalysisContextStore()

// 🔥 P1: Gate noisy PBT logs behind debug flag
const PBT_DEBUG = (import.meta.env.VITE_PBT_DEBUG ?? 'false') === 'true'

// 🔥 P0: Safe workflow label helper to prevent crash on undefined card.ide
function safeWorkflowLabel(card: any): string {
  const rawId = card?.rawToolId || card?.ide || card?.toolId || card?.workflowId || card?.label || card?.name
  if (!rawId || typeof rawId !== 'string') return 'Unknown workflow'
  return getCanonicalEntityLabel(rawId, 'workflows')
}

// Reactive state
const selectedView = ref('cards')
const telemetryStatusShort = computed(() => getTelemetryStatusShort())
const selectedComparisonMode = computed(() => 'workflows')

// 🔥 Sprint 2E-C: Real developer and repo options from backend
const availableDevelopers = ref<Array<{id: string, label: string, workflows?: string[], raw_identities?: string[]}>>([])
const availableRepos = ref<Array<{id: string, label: string}>>([])
const loadingDevelopers = ref(false)
const loadingRepos = ref(false)
// 🔥 P0-A FIX: timeRange must sync with selectedTimeFilter for correct chart labels
const timeRange = computed(() => {
  // Map selectedTimeFilter to timeRange format expected by ProductivityLineGraph
  const mapping: Record<string, string> = {
    'all': 'all',
    'week': 'wow',
    'month': 'mom',
    'quarter': 'qoq'
  }
  return mapping[selectedTimeFilter.value] || 'wow'
})

// 🔥 P2: Filter state (synced with filter store)
// CR-X P0 microfix: Browser-local calendar date as 'YYYY-MM-DD'.
// See lib/productivity/localDateISO.ts for full rationale.
import { localDateISO } from '../lib/productivity/localDateISO'

// Helper: Derive time filter from store date range
function deriveTimeFilterFromRange(from: string, to: string): 'all' | 'day' | 'week' | 'month' | 'quarter' {
  // Empty strings = all time
  if (from === '' && to === '') return 'all'
  
  // Invalid/missing = all time
  if (!from || !to) return 'all'
  
  try {
    const fromDate = new Date(from)
    const toDate = new Date(to)
    const daysDiff = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24))
    
    if (daysDiff <= 0) return 'day'
    if (daysDiff <= 8) return 'week'
    if (daysDiff <= 35) return 'month'
    if (daysDiff <= 100) return 'quarter'
    return 'all'
  } catch {
    return 'all'
  }
}

// Initialize from filter store, not hardcoded
const initialRange = filterStore.activeDateRange('productivity')
const selectedTimeFilter = ref(deriveTimeFilterFromRange(initialRange.from, initialRange.to))
const selectedTeam = ref('')
// K1B: cohort scope — '' = all developers, 'unassigned', or '<cohort_id>'.
// Backed by shared analysisContext so PI/AIOI/PBT stay convergent.
const selectedCohort = ref<string>(analysisContext.cohortId || '')
const availableCohorts = ref<Array<{ id: number; name: string; member_count: number; archived_at: string | null }>>([])
const cohortsLoadError = ref<string | null>(null)
// CR-X Day 2 X1 FIX: Initialize selectedDeveloper/selectedRepo from analysisContext
// to preserve the invariant: visible filter controls == analysisContext == canonical
// request == metadata.filters_applied. Without this, a component remount resets the
// dropdowns to "All" while the Pinia store retains stale developer/repo filters from
// a previous interaction, causing the UI to visually claim org-wide while the runtime
// query remains scoped.
const selectedDeveloper = ref(analysisContext.developerIds.length > 0 ? analysisContext.developerIds[0] : '')
const selectedRepo = ref(analysisContext.repoIds.length > 0 ? analysisContext.repoIds[0] : '')

// ── PBT DECISION SURFACE: within-workflow time series ─────────────────────
// PBT-CLEANUP-6: The developer filter IS implemented (backend-curated
// /api/developers, invite-backed 0.4.x identity — see fetchDevelopers()
// above). This comment previously claimed it was deferred/not implemented,
// which was stale.
const selectedWorkflow = ref<string>('compare') // 'compare' = all eligible workflows

// Guard flag to prevent infinite watch loops
let isSyncingTimeFilter = false

// 🔥 P3: Cost layer state (separate from performance metrics)
const selectedCostLayer = ref('off')

// Whether a specific developer is selected (vs All Developers).
// When a developer is selected, configured workflow spend is NOT directly
// attributable to that developer. Instead, we show a seat-style allocated
// estimate: configured monthly spend split across observed developers per workflow.
const isDeveloperFiltered = computed(() => {
  return selectedDeveloper.value !== '' && selectedDeveloper.value !== null
})

// CR-X: The backend's LocalDeveloperResolver is the sole authority for
// logical developer identity expansion (e.g. local-developer →
// [local-developer, 4, 18269556, invite:42]). The /api/developers endpoint
// exposes the resolved raw identity set via `raw_identities` on each
// developer entry. This computed consumes that authoritative set so the
// filtered-cost layer matches the same logical developer scope as the
// backend canonical scoped population — no parallel identity concept.
const selectedDeveloperRawIdentities = computed<string[]>(() => {
  if (!isDeveloperFiltered.value) return []
  const dev = availableDevelopers.value.find(d => d.id === selectedDeveloper.value)
  return dev?.raw_identities || [selectedDeveloper.value]
})

// CR-X D: Repo filter active — cost layer must not show org-global spend
// as if it belongs to a single repo. Fail closed: suppress cost strip.
const isRepoFiltered = computed(() => {
  return selectedRepo.value !== '' && selectedRepo.value !== null
})

// Human-readable label for the selected developer (for cost-context headers).
const selectedDeveloperLabel = computed(() => {
  if (!isDeveloperFiltered.value) return 'All Developers'
  const dev = availableDevelopers.value.find(d => d.id === selectedDeveloper.value)
  return dev?.label || 'Selected developer'
})

// CR-X Pass 5 (C): Active filter context indicator computeds
const timeFilterLabel = computed(() => {
  const map: Record<string, string> = {
    'all': 'All Time',
    'day': 'Last Day',
    'week': 'Last Week',
    'month': 'Last 30 Days',
    'quarter': 'Last Quarter',
  }
  return map[selectedTimeFilter.value] || selectedTimeFilter.value
})

// CR-X Pass 4 (D) P4 CORRECTION: Cost pro-rating factor for scope-matched
// numerator/denominator. The configured cost is monthly. The observed volume
// (denominator) is computed from sessions in the current time filter. The
// numerator (cost) MUST be pro-rated to the same period.
// Returns the factor by which to multiply the monthly cost to get the
// scope-matched cost. Returns null for 'all' when date range span cannot
// be determined (unit cost will be null in that case).
const costProRatingFactor = computed<number | null>(() => {
  const filter = selectedTimeFilter.value
  switch (filter) {
    case 'day': return 1 / 30        // daily = monthly / 30
    case 'week': return 1 / 4.345    // weekly = monthly / (52/12)
    case 'month': return 1           // monthly = monthly (as-is)
    case 'quarter': return 3         // quarterly = monthly * 3
    case 'all': {
      // For 'all', compute span from date range if available
      const range = filterStore.productivityFilters?.dateRange
      if (range?.from && range?.to) {
        const from = new Date(range.from)
        const to = new Date(range.to)
        const daysSpan = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
        if (daysSpan > 0 && Number.isFinite(daysSpan)) {
          return daysSpan / 30  // pro-rate to the actual span
        }
      }
      return null  // Cannot scope-match → unit cost will be null
    }
    default: return null
  }
})

const selectedRepoLabel = computed(() => {
  if (!selectedRepo.value) return 'All Repos'
  const repo = availableRepos.value.find(r => r.id === selectedRepo.value)
  return repo?.label || 'Selected repo'
})

const selectedWorkflowLabel = computed(() => {
  if (selectedWorkflow.value === 'compare') return 'Compare workflows'
  const w = workflowOptions.value.find((wf: any) => wf.id === selectedWorkflow.value)
    || availableWorkflows.value.find((wf: any) => wf.id === selectedWorkflow.value)
  return w?.label || selectedWorkflow.value
})

const activeFilterCount = computed(() => {
  let count = 0
  if (selectedTimeFilter.value !== 'all') count++
  if (selectedDeveloper.value) count++
  if (selectedRepo.value) count++
  if (isCohortFiltered.value) count++
  if (selectedView.value === 'timeseries' && selectedWorkflow.value !== 'compare') count++
  return count
})

// ── Developer Cost Allocation (seat-style estimate) ──────────────────────
//
// Formula:
//   eligibleDevelopers(T) = curated developers with >0 sessions in workflow T
//   allocatedMonthlyCost(dev, T) = configuredMonthlySpend(T) / count(eligibleDevelopers(T))
//     IF dev uses T, else 0
//   selectedDeveloperAllocatedMonthlyCost = SUM across workflows used by dev
//
// This is a simple seat-style allocation, NOT activity-weighted.
// Configured spend is org/workflow-level; allocation is an estimate only.

// Map raw workflow IDs from the backend to cost-tool IDs for cost lookup.
// windsurf → devin (shared cost bucket per toolCost.ts).
function workflowToCostToolId(workflow: string): string {
  if (workflow === 'windsurf') return 'devin'
  return workflow
}

// Compute eligible developer count per workflow across all curated developers.
const eligibleDeveloperCountByWorkflow = computed(() => {
  const counts = new Map<string, number>()
  for (const dev of availableDevelopers.value) {
    if (!dev.workflows) continue
    for (const wf of dev.workflows) {
      const costToolId = workflowToCostToolId(wf)
      counts.set(costToolId, (counts.get(costToolId) || 0) + 1)
    }
  }
  return counts
})

// The selected developer's workflow list (raw workflow IDs from backend).
const selectedDeveloperWorkflows = computed(() => {
  if (!isDeveloperFiltered.value) return []
  const dev = availableDevelopers.value.find(d => d.id === selectedDeveloper.value)
  return dev?.workflows || []
})

// Per-workflow allocated cost for the selected developer.
const developerWorkflowAllocations = computed(() => {
  if (!isDeveloperFiltered.value) return []
  const _ = costRefreshKey.value // Reactivity trigger for cost config changes

  const allocations: Array<{ workflow: string; costToolId: string; allocatedMonthly: number; configuredMonthly: number; eligibleDevelopers: number }> = []

  for (const wf of selectedDeveloperWorkflows.value) {
    const costToolId = workflowToCostToolId(wf)
    // CR-X ECON-1: Read from authority-aware pbtCostConfigs, not localStorage
    const resolvedConfig = pbtCostConfigs.value.find(c => c.toolId === costToolId)
    const configuredMonthly = resolvedConfig?.monthlySpend || 0
    const eligibleCount = eligibleDeveloperCountByWorkflow.value.get(costToolId) || 1
    const allocatedMonthly = configuredMonthly > 0 ? configuredMonthly / eligibleCount : 0

    allocations.push({
      workflow: wf,
      costToolId,
      allocatedMonthly,
      configuredMonthly,
      eligibleDevelopers: eligibleCount,
    })
  }

  return allocations.sort((a, b) => b.allocatedMonthly - a.allocatedMonthly)
})

// Total allocated monthly cost for the selected developer.
const developerAllocatedMonthlyCost = computed(() => {
  return developerWorkflowAllocations.value.reduce((sum, a) => sum + a.allocatedMonthly, 0)
})

// Number of observed workflows for the selected developer.
const developerObservedWorkflowCount = computed(() => {
  return developerWorkflowAllocations.value.filter(a => a.configuredMonthly > 0).length
})

// ── CR-X Gate A: C6 Per-Bucket Filtered Cost Allocation ──────────────────
//
// Uses computeDeveloperWorkflowEconomics / computeRepoWorkflowEconomics
// with the AUTHORITATIVE (full org) session population as the bucket
// denominator. The scoped (filtered) population is used for group selection.
// This preserves the C6 filter invariant: filtering selects an allocated
// share; it does NOT redistribute the whole bucket to the selected subset.

// Build cost configs from resolved backend configs (primary) or localStorage (fallback)
const pbtCostConfigs = computed(() => {
  const _ = costRefreshKey.value // Reactivity trigger
  // CR-X Gate A: Explicit cost-authority contract
  if (props.resolvedCostConfigs && props.resolvedCostConfigs.length > 0) {
    // CR-X ECON-1: Use full backend config (seatCount, costPerSeatMonthly) for editor load
    return props.resolvedCostConfigs.map(c => ({
      toolId: c.toolId,
      seatCount: c.seatCount ?? 0,
      costPerSeatMonthly: c.costPerSeatMonthly ?? 0,
      monthlySpend: c.monthlySpend,
      updatedAt: '',
    }))
  }
  // Authority contract: when backend succeeded but has no persisted configs,
  // do NOT silently present localStorage as equivalent org truth.
  if (props.costConfigAuthority === 'backend_empty') {
    return []
  }
  // backend_unavailable: graceful degradation to localStorage fallback
  const configs: any[] = []
  for (const toolId of ['cursor', 'devin', 'vscode', 'claude-code', 'github-copilot', 'codex']) {
    const cfg = getToolCostConfig(toolId)
    if (cfg && cfg.monthlySpend > 0) configs.push(cfg)
  }
  return configs
})

// Filtered developer economics: allocated cost per bucket for the selected developer
const filteredDeveloperEconomics = computed(() => {
  if (!isDeveloperFiltered.value) return []
  if (!props.authoritativeSessions || props.authoritativeSessions.length === 0) return []

  // Scoped rows: filter authoritative sessions to the selected developer
  // using the backend-authoritative raw identity set, not raw equality.
  const rawIds = selectedDeveloperRawIdentities.value
  const scopedRows = props.authoritativeSessions.filter((s: any) => {
    const devId = String(s.developer_id || s.user_id || s.developerId || '')
    return rawIds.includes(devId)
  })
  if (scopedRows.length === 0) return []

  const fromDate = filterStore.productivityFilters?.dateRange?.from || undefined
  const toDate = filterStore.productivityFilters?.dateRange?.to || undefined

  return computeDeveloperWorkflowEconomics(
    scopedRows, pbtCostConfigs.value, fromDate, toDate, props.authoritativeSessions
  )
})

// Filtered repo economics: allocated cost per bucket for the selected repo
const filteredRepoEconomics = computed(() => {
  if (!isRepoFiltered.value) return []
  if (!props.authoritativeSessions || props.authoritativeSessions.length === 0) return []

  // Scoped rows: filter authoritative sessions to the selected repo.
  // CR-X Gate A fix: selectedRepo.value is a normalized canonical ID
  // (e.g. "org/repo") but session rows have raw URLs
  // (e.g. "https://github.com/org/repo").
  // Normalize the session row's repo URL before comparing.
  const scopedRows = props.authoritativeSessions.filter((s: any) => {
    const rawRepo = s.git_repo_url || s.repository || s.repo
    if (!rawRepo) return false
    const normalized = normalizeRepoUrl(String(rawRepo))
    return normalized === selectedRepo.value
  })
  if (scopedRows.length === 0) return []

  const fromDate = filterStore.productivityFilters?.dateRange?.from || undefined
  const toDate = filterStore.productivityFilters?.dateRange?.to || undefined

  return computeRepoWorkflowEconomics(
    scopedRows, pbtCostConfigs.value, fromDate, toDate, props.authoritativeSessions
  )
})

// Combined developer + repo economics: intersection population
const filteredCombinedEconomics = computed(() => {
  if (!isDeveloperFiltered.value || !isRepoFiltered.value) return []
  if (!props.authoritativeSessions || props.authoritativeSessions.length === 0) return []

  // Scoped rows: filter to BOTH developer AND repo.
  // CR-X Gate A fix: normalize repo URL before comparing (same as repo-only filter).
  // CR-X: developer filter uses backend-authoritative raw identity set.
  const rawIds = selectedDeveloperRawIdentities.value
  const scopedRows = props.authoritativeSessions.filter((s: any) => {
    const devId = String(s.developer_id || s.user_id || s.developerId || '')
    const rawRepo = s.git_repo_url || s.repository || s.repo
    if (!rawRepo) return false
    const normalized = normalizeRepoUrl(String(rawRepo))
    return rawIds.includes(devId) && normalized === selectedRepo.value
  })
  if (scopedRows.length === 0) return []

  const fromDate = filterStore.productivityFilters?.dateRange?.from || undefined
  const toDate = filterStore.productivityFilters?.dateRange?.to || undefined

  // Use developer economics with the combined scoped rows
  // The authoritative population remains the full org
  return computeDeveloperWorkflowEconomics(
    scopedRows, pbtCostConfigs.value, fromDate, toDate, props.authoritativeSessions
  )
})

// Active filtered economics based on which filters are applied
const activeFilteredEconomics = computed(() => {
  if (isDeveloperFiltered.value && isRepoFiltered.value) return filteredCombinedEconomics.value
  if (isDeveloperFiltered.value) return filteredDeveloperEconomics.value
  if (isRepoFiltered.value) return filteredRepoEconomics.value
  return []
})

// Look up allocated cost for a card from the active filtered economics
function getFilteredAllocatedCostForCard(card: any): { allocatedSpend: number; costPerSession: number; bucketTotalSessions: number } | null {
  if (activeFilteredEconomics.value.length === 0) return null
  const resolvedToolId = resolveCostToolIdForCard(card)
  // Match by normalized bucket
  const normalizedBucket = String(normalizeCostToolId(resolvedToolId))
  const row = activeFilteredEconomics.value.find(r => r.costBucket === normalizedBucket)
  if (!row || row.allocatedSpend <= 0) return null
  return {
    allocatedSpend: row.allocatedSpend,
    costPerSession: row.costPerSession,
    bucketTotalSessions: row.bucketTotalSessions,
  }
}

// ── Metric-Aware Cost Derivation (DERIVED layer on top of allocation) ────
//
// For supported additive/per-session-average metrics, we derive an economic
// unit cost from the accepted allocated monthly spend:
//
//   observed_metric_volume = selected_metric_average × filtered_session_count
//   metric_unit_cost       = allocated_monthly_spend / observed_metric_volume
//
// The numerator is ALWAYS the accepted allocated developer/workflow monthly
// spend — NEVER full workflow configured spend divided by one developer's
// metric volume.
//
// For non-additive metrics (TTFC, ratios, percentages), no fake unit
// economics are produced. The allocated spend remains visible but the
// derived unit cost is labeled "Not applicable".
//
// Metric volume is observational: calculated from the displayed average ×
// observed sessions. This is NOT ROI, NOT billing, NOT causal attribution.

type MetricCostSemantic = {
  unitLabel: string         // e.g. "$/commit", "$/active coding hour"
  volumeLabel: string       // e.g. "observed commits", "observed active coding hours"
  convertToHours: boolean   // true for time metrics (minutes → hours)
  supported: boolean
  // CR-X Pass 4 (D): Dimensional economics — connects PBT cost to GitHub
  // delivery evidence. When evidenceSource is set, the cost layer can
  // derive $/PR, $/deployment, etc. from GitHub evidence rather than
  // only from telemetry session metrics.
  evidenceSource?: 'github_prs' | 'github_deployments' | 'github_reviews'
  evidenceLabel?: string    // e.g. "merged PRs", "successful deployments"
}

const METRIC_COST_SEMANTICS: Record<string, MetricCostSemantic> = {
  'ai_suggestions_accepted': {
    unitLabel: '$/AI activity',
    volumeLabel: 'observed AI activities',
    convertToHours: false,
    supported: true,
  },
  'files_edited_per_session': {
    unitLabel: '$/file edited',
    volumeLabel: 'observed files edited',
    convertToHours: false,
    supported: true,
  },
  'commits_per_session': {
    unitLabel: '$/commit',
    volumeLabel: 'observed commits',
    convertToHours: false,
    supported: true,
  },
  'average_session_length_minutes': {
    unitLabel: '$/session hour',
    volumeLabel: 'observed session hours',
    convertToHours: true,
    supported: true,
  },
  'active_coding_time_minutes': {
    unitLabel: '$/active coding hour',
    volumeLabel: 'observed active coding hours',
    convertToHours: true,
    supported: true,
  },
  'ai_usage_duration_minutes': {
    unitLabel: '$/AI-use hour',
    volumeLabel: 'observed AI-use hours',
    convertToHours: true,
    supported: true,
  },
  'idle_time_minutes': {
    unitLabel: '$/idle hour',
    volumeLabel: 'observed idle hours',
    convertToHours: true,
    supported: true,
  },
  // Non-additive / unsupported metrics — no fake unit economics
  'time_to_first_commit_minutes': { unitLabel: '', volumeLabel: '', convertToHours: false, supported: false },
  'ai_usage_ratio': { unitLabel: '', volumeLabel: '', convertToHours: false, supported: false },
  'active_coding_ratio': { unitLabel: '', volumeLabel: '', convertToHours: false, supported: false },
  'idle_ratio': { unitLabel: '', volumeLabel: '', convertToHours: false, supported: false },
  // CR-X Pass 4 (D): GitHub delivery evidence economics — connects
  // configured tool spend to GitHub engineering evidence outcomes.
  // These are dimensional economics: $/PR, $/deployment, $/review.
  // Volume comes from GitHub evidence (not telemetry sessions).
  'merged_prs': {
    unitLabel: '$/merged PR',
    volumeLabel: 'observed merged PRs',
    convertToHours: false,
    supported: true,
    evidenceSource: 'github_prs',
    evidenceLabel: 'merged PRs',
  },
  'total_prs': {
    unitLabel: '$/PR',
    volumeLabel: 'observed PRs',
    convertToHours: false,
    supported: true,
    evidenceSource: 'github_prs',
    evidenceLabel: 'PRs',
  },
  'successful_deployments': {
    unitLabel: '$/successful deployment',
    volumeLabel: 'observed successful deployments',
    convertToHours: false,
    supported: true,
    evidenceSource: 'github_deployments',
    evidenceLabel: 'successful deployments',
  },
  // CR-X Slice 1: Delivery metrics — cost semantics
  'merged_pr_count': {
    unitLabel: '$/merged PR',
    volumeLabel: 'merged PRs',
    convertToHours: false,
    supported: true,
    evidenceSource: 'github_prs',
    evidenceLabel: 'merged PRs',
  },
  'deployment_count': {
    unitLabel: '$/deployment',
    volumeLabel: 'deployments',
    convertToHours: false,
    supported: true,
    evidenceSource: 'github_deployments',
    evidenceLabel: 'deployments',
  },
  'deploy_success_rate': {
    unitLabel: '',
    volumeLabel: '',
    convertToHours: false,
    supported: false,
  },
  'median_merge_cycle_hours': {
    unitLabel: '',
    volumeLabel: '',
    convertToHours: false,
    supported: false,
  },
  // CR-X B4: Release metrics — delivery evidence from GitHub releases
  'release_count': {
    unitLabel: '$/release',
    volumeLabel: 'releases',
    convertToHours: false,
    supported: true,
    evidenceSource: 'github_prs',
    evidenceLabel: 'releases',
  },
  // CR-X B5: Review/review-cycle/merge-rate delivery metrics
  'review_count': {
    unitLabel: '$/review',
    volumeLabel: 'reviews',
    convertToHours: false,
    supported: true,
    evidenceSource: 'github_prs',
    evidenceLabel: 'reviews',
  },
  'pr_review_cycles': {
    unitLabel: '$/review cycle',
    volumeLabel: 'review cycles',
    convertToHours: false,
    supported: true,
    evidenceSource: 'github_prs',
    evidenceLabel: 'review cycles (reviews + reopens)',
  },
  'merge_rate': {
    unitLabel: '',
    volumeLabel: '',
    convertToHours: false,
    supported: false,
  },
}

// Current metric semantic for the selected metric (defaults to unsupported).
const currentMetricSemantic = computed<MetricCostSemantic>(() => {
  return METRIC_COST_SEMANTICS[selectedMetric.value] || { unitLabel: '', volumeLabel: '', convertToHours: false, supported: false }
})

// Per-workflow metric-aware cost derivation for the selected developer.
// Matches each allocation to its card in ideMetricCards to get the metric
// average and session count, then computes observed volume and unit cost.
type WorkflowMetricDerivation = {
  workflow: string
  costToolId: string
  allocatedMonthly: number
  configuredMonthly: number
  eligibleDevelopers: number
  metricAverage: number | null
  sessionCount: number
  observedVolume: number | null     // null = not computable (missing/zero metric)
  unitCost: number | null            // null = not computable
  unitLabel: string
  volumeLabel: string
  // P4 CORRECTION: Scope-matched cost for the current time filter.
  // allocatedMonthly is always monthly; scopeMatchedCost is pro-rated
  // to the current time filter period (day/week/month/quarter/all).
  // unitCost = scopeMatchedCost / observedVolume (NOT allocatedMonthly / observedVolume).
  scopeMatchedCost: number | null   // null = cannot scope-match (e.g., 'all' with no date range)
  timeFilterScope: string           // human-readable scope label
}

const developerMetricDerivations = computed<WorkflowMetricDerivation[]>(() => {
  if (!isDeveloperFiltered.value) return []
  const _ = costRefreshKey.value // Reactivity trigger for cost config changes
  const semantic = currentMetricSemantic.value
  const rawCards = ideMetricCards.value
  const proRatingFactor = costProRatingFactor.value

  const derivations: WorkflowMetricDerivation[] = []

  for (const alloc of developerWorkflowAllocations.value) {
    if (alloc.configuredMonthly <= 0) continue

    // Find the matching raw card by workflow ID (raw cards use card.ide)
    const matchingCard = rawCards.find((c: any) => {
      const cardCostToolId = workflowToCostToolId(c.ide)
      return cardCostToolId === alloc.costToolId
    })

    const metricAverage = matchingCard && typeof matchingCard.value === 'number' && Number.isFinite(matchingCard.value)
      ? matchingCard.value
      : null
    const sessionCount = matchingCard?.sessionCount || 0

    let observedVolume: number | null = null
    let unitCost: number | null = null

    // P4 CORRECTION: Use scope-matched cost, not raw monthly cost.
    // scopeMatchedCost = allocatedMonthly * proRatingFactor
    // If proRatingFactor is null (e.g., 'all' with no date range),
    // unit cost CANNOT be computed — numerator/denominator are not scope-matched.
    const scopeMatchedCost = (proRatingFactor !== null && alloc.allocatedMonthly > 0)
      ? alloc.allocatedMonthly * proRatingFactor
      : null

    if (semantic.supported && metricAverage !== null && metricAverage > 0 && sessionCount > 0 && scopeMatchedCost !== null) {
      const rawVolume = metricAverage * sessionCount
      observedVolume = semantic.convertToHours ? rawVolume / 60 : rawVolume
      if (observedVolume > 0) {
        unitCost = scopeMatchedCost / observedVolume
      }
    }

    derivations.push({
      workflow: alloc.workflow,
      costToolId: alloc.costToolId,
      allocatedMonthly: alloc.allocatedMonthly,
      configuredMonthly: alloc.configuredMonthly,
      eligibleDevelopers: alloc.eligibleDevelopers,
      metricAverage,
      sessionCount,
      observedVolume,
      unitCost,
      unitLabel: semantic.unitLabel,
      volumeLabel: semantic.volumeLabel,
      scopeMatchedCost,
      timeFilterScope: timeFilterLabel.value,
    })
  }

  return derivations.sort((a, b) => b.allocatedMonthly - a.allocatedMonthly)
})

// Aggregate derived economic metric across supported workflows.
// Uses SUM(allocated spend) / SUM(observed volume), NOT average of per-workflow
// unit costs. Only includes workflows with valid (non-null) observedVolume.
const developerAggregateMetricDerivation = computed(() => {
  const derivations = developerMetricDerivations.value
  const valid = derivations.filter(d => d.observedVolume !== null && d.unitCost !== null)

  if (valid.length === 0) return null

  // P4 CORRECTION: Use scope-matched cost, not raw monthly allocated.
  const totalScopeMatchedCost = valid.reduce((sum, d) => sum + (d.scopeMatchedCost || 0), 0)
  const totalVolume = valid.reduce((sum, d) => sum + (d.observedVolume || 0), 0)

  if (totalVolume <= 0) return null

  return {
    totalAllocated: totalScopeMatchedCost,
    totalVolume,
    aggregateUnitCost: totalScopeMatchedCost / totalVolume,
    unitLabel: currentMetricSemantic.value.unitLabel,
    volumeLabel: currentMetricSemantic.value.volumeLabel,
    workflowCount: valid.length,
  }
})

// ── Effective cost row derivation (workflow-scoped) ──────────────────────
//
// When Compare Workflows is active: uses the full compare aggregate
// (SUM of valid workflow allocations / SUM of valid observed volumes).
//
// When a single workflow is selected: scopes the headline numerator and
// denominator to ONLY that workflow. No spend belonging to another workflow
// may remain in the headline after the workflow filter is applied.
//
// For unsupported metrics: returns the scoped allocated spend with null
// volume/unitCost so the headline shows "N/A — non-additive metric".
const effectiveCostRowDerivation = computed(() => {
  const derivations = developerMetricDerivations.value
  const semantic = currentMetricSemantic.value

  // Single workflow mode: scope to the selected workflow only
  if (!isCompareMode.value && effectiveWorkflowId.value) {
    const selectedCostToolId = workflowToCostToolId(effectiveWorkflowId.value)
    const selected = derivations.find(d => d.costToolId === selectedCostToolId || d.workflow === effectiveWorkflowId.value)

    if (!selected) return null

    if (semantic.supported && selected.observedVolume !== null && selected.unitCost !== null && selected.observedVolume > 0) {
      return {
        totalAllocated: selected.scopeMatchedCost ?? 0,
        totalVolume: selected.observedVolume,
        aggregateUnitCost: selected.unitCost,
        unitLabel: semantic.unitLabel,
        volumeLabel: semantic.volumeLabel,
        workflowCount: 1,
      }
    }

    // Unsupported metric or no valid volume: return spend with null economics
    return {
      totalAllocated: selected.allocatedMonthly,
      totalVolume: null,
      aggregateUnitCost: null,
      unitLabel: semantic.unitLabel,
      volumeLabel: semantic.volumeLabel,
      workflowCount: 1,
    }
  }

  // Compare mode: use the full aggregate
  return developerAggregateMetricDerivation.value
})

// Effective allocated monthly cost for the headline (workflow-scoped).
// In single-workflow mode, this is the selected workflow's allocation only.
// In compare mode, this is the developer's total allocation.
const effectiveAllocatedMonthlyCost = computed(() => {
  if (!isCompareMode.value && effectiveWorkflowId.value) {
    const selectedCostToolId = workflowToCostToolId(effectiveWorkflowId.value)
    const selected = developerMetricDerivations.value.find(d => d.costToolId === selectedCostToolId || d.workflow === effectiveWorkflowId.value)
    return selected?.allocatedMonthly || 0
  }
  return developerAllocatedMonthlyCost.value
})

// 🔥 P0-B: Cost data detection from localStorage - depends on costRefreshKey for reactivity
const hasCostData = computed(() => {
  // Force dependency on costRefreshKey for reactivity
  const _ = costRefreshKey.value
  // CR-X Gate A: hasCostData must reflect pbtCostConfigs (authority-aware)
  // not just localStorage, so that backend_empty authority correctly hides
  // the "allocated" banner when no authoritative config exists.
  return pbtCostConfigs.value.length > 0
})

// CR-X Gate A: Cost-authority label for the scoped-cost banner
const costAuthorityLabel = computed(() => {
  const authority = props.costConfigAuthority
  if (authority === 'backend_persisted') return 'Backend Authority'
  if (authority === 'backend_unavailable') return 'Local Fallback'
  return '' // backend_empty: no label (banner hidden by hasCostData)
})

const costAuthorityBadgeClass = computed(() => {
  const authority = props.costConfigAuthority
  if (authority === 'backend_persisted') return 'v3-cost-authority-backend'
  if (authority === 'backend_unavailable') return 'v3-cost-authority-fallback'
  return ''
})

// CR-X Gate A: Truthful unavailable message when filtered but no cost data
const costUnavailableMessage = computed(() => {
  const authority = props.costConfigAuthority
  if (authority === 'backend_empty') {
    return 'No persisted tool cost configurations found. Configure tool costs in Settings to enable allocated economics.'
  }
  if (authority === 'backend_unavailable') {
    return 'Backend cost config unavailable and no local fallback configured. Configure tool costs to enable allocated economics.'
  }
  return 'No cost data available for the selected filter scope.'
})

// Cost Context Strip computed properties (Time Series only)
const totalConfiguredSpend = computed(() => {
  return v3Cards.value.reduce((sum, card) => {
    const cost = getMonthlyCostForCard(card)
    return sum + (cost || 0)
  }, 0)
})

const lowestSpendPerSession = computed(() => {
  const MIN_SESSIONS_FOR_COST_SUPERLATIVE = 25
  const cardsWithCost = v3Cards.value
    .map(card => ({
      workflow: safeWorkflowLabel(card),
      value: (() => {
        const cost = getMonthlyCostForCard(card)
        const sessions = card.sessionCount || 0
        if (!cost || sessions < MIN_SESSIONS_FOR_COST_SUPERLATIVE) return Infinity
        return cost / sessions
      })(),
      sessions: card.sessionCount || 0
    }))
    .filter(c => c.value !== Infinity)
  
  if (cardsWithCost.length === 0) return { workflow: '—', value: 0 }
  return cardsWithCost.reduce((min, curr) => curr.value < min.value ? curr : min)
})

const highestSpendPerSession = computed(() => {
  const MIN_SESSIONS_FOR_COST_SUPERLATIVE = 25
  const cardsWithCost = v3Cards.value
    .map(card => ({
      workflow: safeWorkflowLabel(card),
      value: (() => {
        const cost = getMonthlyCostForCard(card)
        const sessions = card.sessionCount || 0
        if (!cost || sessions < MIN_SESSIONS_FOR_COST_SUPERLATIVE) return 0
        return cost / sessions
      })(),
      sessions: card.sessionCount || 0,
      isEmerging: (card.sessionCount || 0) < MIN_SESSIONS_FOR_COST_SUPERLATIVE
    }))
    .filter(c => c.value > 0)
  
  if (cardsWithCost.length === 0) return { workflow: '—', value: 0, isEmerging: false }
  return cardsWithCost.reduce((max, curr) => curr.value > max.value ? curr : max)
})

const highestMonthlySpend = computed(() => {
  const cardsWithCost = v3Cards.value
    .map(card => ({
      workflow: safeWorkflowLabel(card),
      value: getMonthlyCostForCard(card) || 0
    }))
    .filter(c => c.value > 0)
  
  if (cardsWithCost.length === 0) return { workflow: '—', value: 0 }
  return cardsWithCost.reduce((max, curr) => curr.value > max.value ? curr : max)
})

const metricLeader = computed(() => {
  const leader = determineLeader(ideMetricCards.value, selectedMetric.value)
  if (!leader) return { workflow: '—', value: '—' }
  return {
    workflow: safeWorkflowLabel(leader),
    value: formatMetricValue(leader.value, selectedMetric.value)
  }
})

// 🔥 Cost editor state
const showCostEditor = ref(false)
const costSaveError = ref<string | null>(null)
const costRefreshKey = ref(0)
const costEditorState = ref({
  cursor: { seatCount: 0, costPerSeatMonthly: 0 },
  devin: { seatCount: 0, costPerSeatMonthly: 0 },
  vscode: { seatCount: 0, costPerSeatMonthly: 0 },
  'claude-code': { seatCount: 0, costPerSeatMonthly: 0 },
  'github-copilot': { seatCount: 0, costPerSeatMonthly: 0 },
  codex: { seatCount: 0, costPerSeatMonthly: 0 }
})

// Persisted tool IDs (row existence = configured). Absent ≠ configured $0.
// Includes explicit zero-spend rows so they render "$0.00", not "Not configured".
const persistedCostToolIds = ref<Set<string>>(new Set())

function costEditorMonthlySpendDisplay(toolId: string): string {
  const config = (costEditorState.value as any)[toolId]
  return costMonthlySpendDisplay({
    persisted: persistedCostToolIds.value.has(toolId),
    seatCount: config?.seatCount ?? 0,
    costPerSeatMonthly: config?.costPerSeatMonthly ?? 0,
  })
}

// Refresh persisted tool IDs (row existence only — never editor values) so
// explicit zero-spend rows render "$0.00" rather than "Not configured".
// Backend rows are authoritative; localStorage is consulted only in the
// backend_unavailable degraded path where values are already absent.
function refreshPersistedCostToolIds(tools: string[]): void {
  persistedCostToolIds.value = new Set(pbtCostConfigs.value.map(c => c.toolId))
  fetchOrgToolCostConfigsWithAuthority().then(result => {
    const ids = new Set(result.configs.map(c => c.toolId))
    if (result.authority === 'backend_unavailable') {
      for (const toolId of tools) {
        if (getToolCostConfig(toolId)) ids.add(toolId)
      }
    }
    persistedCostToolIds.value = ids
  }).catch(() => {})
}

// Load cost configs into editor when opening
// CR-X ECON-1: Load from backend-resolved authority (pbtCostConfigs), not localStorage
watch(showCostEditor, (isOpen) => {
  if (isOpen) {
    costSaveError.value = null
    const tools = ['cursor', 'devin', 'vscode', 'claude-code', 'github-copilot', 'codex']
    // Build a lookup from the authority-aware resolved configs
    const resolvedByTool = new Map<string, any>()
    for (const c of pbtCostConfigs.value) {
      resolvedByTool.set(c.toolId, c)
    }
    tools.forEach(toolId => {
      const config = resolvedByTool.get(toolId)
      if (config) {
        costEditorState.value[toolId] = {
          seatCount: config.seatCount || 0,
          costPerSeatMonthly: config.costPerSeatMonthly || 0
        }
      } else {
        costEditorState.value[toolId] = { seatCount: 0, costPerSeatMonthly: 0 }
      }
    })
    refreshPersistedCostToolIds(tools)
  }
})

// Save cost editor
// CR-X ECON-1: Save through backend authority, not localStorage
const saveCostEditor = async () => {
  const tools = ['cursor', 'devin', 'vscode', 'claude-code', 'github-copilot', 'codex']
  // 18B.6: 0/0 means UNCONFIGURED. A zeroed row with an existing persisted
  // config must emit a DELETE — otherwise the stale nonzero row survives
  // the save and resurrects on reload.
  const persistedToolIds = new Set(pbtCostConfigs.value.map(c => c.toolId))
  const savePromises: Promise<any>[] = []
  tools.forEach(toolId => {
    const config = costEditorState.value[toolId]
    if (!config) return
    if (config.seatCount > 0 || config.costPerSeatMonthly > 0) {
      savePromises.push(saveOrgToolCostConfig(toolId, {
        seatCount: config.seatCount,
        costPerSeatMonthly: config.costPerSeatMonthly
      }))
    } else if (persistedToolIds.has(toolId)) {
      savePromises.push(clearOrgToolCostConfig(toolId).then(ok => (ok ? { cleared: toolId } : null)))
    }
  })
  costSaveError.value = null
  try {
    const results = await Promise.all(savePromises)
    const failures = results.filter(r => r === null).length
    if (failures > 0) {
      costSaveError.value = `${failures} tool cost(s) could not be saved. Check that you are an admin and the backend is available, then try again.`
      return
    }
    // Persisted state changed: keep the row-existence set truthful so a
    // cleared row flips back to "Not configured" and a saved row counts.
    const nextPersisted = new Set(persistedCostToolIds.value)
    tools.forEach(toolId => {
      const config = costEditorState.value[toolId]
      if (!config) return
      if (config.seatCount > 0 || config.costPerSeatMonthly > 0) {
        nextPersisted.add(toolId)
      } else {
        nextPersisted.delete(toolId)
      }
    })
    persistedCostToolIds.value = nextPersisted
    // CR-X ECON-1: Emit refresh so Dashboards re-fetches backend authority
    emit('refresh-cost-configs')
    // Force local reactivity update
    costRefreshKey.value++
    showCostEditor.value = false
  } catch (err: any) {
    costSaveError.value = err?.message || 'Failed to save cost configuration. Please try again.'
  }
}

// Clear cost editor
// CR-X ECON-1: Clear through backend authority, not localStorage
const clearCostEditor = async () => {
  costSaveError.value = null
  const tools = ['cursor', 'devin', 'vscode', 'claude-code', 'github-copilot', 'codex']
  tools.forEach(toolId => {
    costEditorState.value[toolId] = { seatCount: 0, costPerSeatMonthly: 0 }
  })
  const ok = await clearAllOrgToolCostConfigs()
  if (ok) {
    persistedCostToolIds.value = new Set()
  }
  if (!ok) {
    costSaveError.value = 'Failed to clear cost configuration. Please try again.'
    return
  }
  // CR-X ECON-1: Emit refresh so Dashboards re-fetches backend authority
  emit('refresh-cost-configs')
  // Force local reactivity update
  costRefreshKey.value++
}

// 🔥 P0-B: Cost summary strip computed properties - depend on costRefreshKey
// CR-X ECON-1: Read from authority-aware pbtCostConfigs, not localStorage
const totalMonthlySpend = computed(() => {
  // Force dependency on costRefreshKey for reactivity
  const _ = costRefreshKey.value
  let total = 0
  for (const config of pbtCostConfigs.value) {
    if (config.monthlySpend > 0) {
      total += config.monthlySpend
    }
  }
  return total
})

const highestSpendTool = computed(() => {
  // Force dependency on costRefreshKey for reactivity
  const _ = costRefreshKey.value
  const toolNames: Record<string, string> = {
    'cursor': 'Cursor',
    'devin': 'Devin',
    'vscode': 'VS Code',
    'claude-code': 'Claude Code',
    'github-copilot': 'GitHub Copilot'
  }
  let maxSpend = 0
  let maxTool = ''
  for (const config of pbtCostConfigs.value) {
    if (config.monthlySpend > maxSpend) {
      maxSpend = config.monthlySpend
      maxTool = toolNames[config.toolId] || config.toolId
    }
  }
  return maxTool
})

const highestSpendAmount = computed(() => {
  // Force dependency on costRefreshKey for reactivity
  const _ = costRefreshKey.value
  let maxSpend = 0
  for (const config of pbtCostConfigs.value) {
    if (config.monthlySpend > maxSpend) {
      maxSpend = config.monthlySpend
    }
  }
  return maxSpend
})

// CR-X Pass 4 (D): Dimensional economics — cost per delivery evidence.
// Connects configured tool spend to GitHub engineering evidence outcomes.
// Shows $/commit, $/PR and $/deployment when evidence is available.
// Returns null when no evidence or no configured spend.
// CR-X Day 2 X1: Added $/commit using canonical telemetry commit event count
// as denominator (CR-X-PILOT-READINESS-AUDIT.md:850 — "Cost per commit | YES
// (accepted) | denominator: commit event count").
const costPerDeliveryEvidence = computed(() => {
  const _ = costRefreshKey.value
  const totalSpend = totalMonthlySpend.value
  if (totalSpend <= 0) return null

  // CR-X D: Fail closed when developer or repo filter is active.
  // Org-level configured spend cannot be truthfully attributed to a
  // single developer or repo. Showing the ratio would imply attribution
  // that the data does not support.
  if (isDeveloperFiltered.value || isRepoFiltered.value) return null

  // CR-X Wave 3 Slice B: Fail closed when a single workflow is drilled
  // in. These ratios are org-level (numerator = full configured spend,
  // denominator = org-level commit/PR/deployment counts). Showing them
  // while a single workflow is selected would imply workflow-level cost
  // efficiency that the data does not support.
  if (selectedWorkflow.value !== 'compare') return null

  // CR-X Wave 3 Slice B: Window-match the numerator to the denominator.
  // The denominators (total_commit_count, merged_prs, deployments) are
  // scoped by the active time filter (from/to). The numerator must be
  // pro-rated to the same window via computeWindowSpend, otherwise a
  // "Last Week" filter would show $monthly_spend ÷ weekly_outcomes — a
  // wrong ratio. computeWindowSpend returns the full monthly spend when
  // the range is all-time/empty (matching the existing all-time behavior).
  const range = filterStore.activeDateRange('productivity')
  const windowedSpend = computeWindowSpend(totalSpend, range?.from, range?.to)

  const parts: string[] = []

  // CR-X Day 2 X1: Cost per commit — denominator is total_commit_count from
  // canonical telemetry metadata (event_type='commit' within canonical scope).
  // This is telemetry-derived, not GitHub evidence. Available even without
  // GitHub integration.
  const ts = timeSeriesData.value
  const metadata = (ts && Array.isArray(ts) && ts.length > 0) ? (ts[0] as any)?.metadata : null
  const totalCommits = metadata?.total_commit_count ?? 0
  if (totalCommits > 0) {
    const costPerCommit = windowedSpend / totalCommits
    parts.push(`$${costPerCommit.toFixed(2)}/commit`)
  }

  const gh = props.githubMetrics
  if (gh) {
    const mergedPRs = gh?.github_team_metrics?.merged_prs ?? gh?.pr_analytics?.merged_prs ?? 0
    const successfulDeployments = gh?.deployment_metrics?.success_deployment_count ?? 0

    if (mergedPRs > 0) {
      const costPerPR = windowedSpend / mergedPRs
      parts.push(`$${costPerPR.toFixed(0)}/merged PR`)
    }
    if (successfulDeployments > 0) {
      const costPerDeploy = windowedSpend / successfulDeployments
      parts.push(`$${costPerDeploy.toFixed(0)}/deployment`)
    }
  }

  return parts.length > 0 ? parts.join(' · ') : null
})

const bestEfficiencyTool = computed(() => {
  // Force dependency on costRefreshKey for reactivity
  const _ = costRefreshKey.value
  const cards = ideMetricCards.value
  if (!cards || cards.length === 0) return null
  
  const toolNames: Record<string, string> = {
    'cursor': 'Cursor',
    'windsurf': 'Windsurf',
    'devin': 'Devin',
    'vscode': 'VS Code',
    'claude-code': 'Claude Code',
    'claude_code': 'Claude Code',
    'github-copilot': 'GitHub Copilot',
    'github_copilot': 'GitHub Copilot'
  }
  
  let bestTool = null
  let bestEfficiency = Infinity
  
  cards.forEach(card => {
    const monthlyCost = getMonthlyCostForCard(card)
    const sessionCount = card.sessionCount || 0
    const MIN_SESSIONS_FOR_COST_SUPERLATIVE = 25
    if (sessionCount < MIN_SESSIONS_FOR_COST_SUPERLATIVE) return

    if (!monthlyCost || monthlyCost <= 0) return

    const costPerSession = monthlyCost / sessionCount
    if (costPerSession < bestEfficiency) {
      bestEfficiency = costPerSession
      const resolvedToolId = resolveCostToolIdForCard(card)
      bestTool = toolNames[resolvedToolId] || card.ide
    }
  })
  
  return bestTool
})

// 🔥 P0-D: Cost overlay for time-series graph (embedded inside graph)
const costOverlayForGraph = computed(() => {
  // Force dependency on costRefreshKey for reactivity
  const _ = costRefreshKey.value

  if (selectedCostLayer.value === 'off' || !hasCostData.value) {
    return null
  }

  const cards = v3Cards.value
  if (!cards || cards.length === 0) {
    return null
  }

  const values = cards.map(card => {
    const monthlyCost = getMonthlyCostForCard(card)
    const hasCost = monthlyCost && monthlyCost > 0
    const value = getCostLayerValue(card, selectedCostLayer.value)

    return {
      label: card.name,
      value: value,
      hasCost: hasCost,
      isBest: bestEfficiencyTool.value === card.name,
      isHighestSpend: highestSpendTool.value === card.name
    }
  })
  
  // Dynamic description based on cost layer
  let description = ''
  if (selectedCostLayer.value === 'monthly') {
    description = 'Estimated cost based on configured tool rates. Not billing data. Metric lines are raw telemetry; cost values are directional estimates from configured monthly spend.'
  } else if (selectedCostLayer.value === 'per_session') {
    description = 'Estimated cost based on configured tool rates. Not billing data. Spend is estimated from configured monthly spend and observed usage.'
  } else if (selectedCostLayer.value === 'per_hour') {
    description = 'Estimated cost based on configured tool rates. Not billing data. Spend is estimated from configured monthly spend and active coding time. Active-coding time is additive (sums per-session without overlap correction).'
  } else if (selectedCostLayer.value === 'per_wallclock') {
    description = 'Estimated cost based on configured tool rates. Not billing data. Spend is estimated from configured monthly spend and additive session duration (Σ session duration_ms). This is NOT overlap-corrected wall-clock time — concurrent sessions are double-counted. For true wall-clock union, use the interval-union concurrency insight.'
  } else if (selectedCostLayer.value === 'cost_adjusted') {
    description = 'Estimated cost based on configured tool rates. Not billing data. Output is directionally estimated against configured monthly spend.'
  }
  
  return {
    enabled: true,
    label: `Cost layer: ${costLayerLabel.value}`,
    description: description,
    values: values
  }
})

// 🔥 P2: Available filter options (from filter store or data)
// Safe defaults to prevent .length of undefined errors
const availableTeams = computed(() => {
  const teams = filterStore.productivityFilters?.teamIds
  return Array.isArray(teams) ? teams : []
})

// K1B: cohort selector state
const isCohortFiltered = computed(() => selectedCohort.value !== '' && selectedCohort.value !== 'all')
const selectedCohortLabel = computed(() => {
  if (selectedCohort.value === 'unassigned') return 'Unassigned'
  const c = availableCohorts.value.find(c => String(c.id) === selectedCohort.value)
  return c ? c.name : `Cohort ${selectedCohort.value}`
})
// A selected cohort that no longer resolves to an active cohort is stale —
// keep it selectable so the backend 422 surfaces a visible error rather
// than silently reverting to org-wide.
const selectedCohortStale = computed(() =>
  isCohortFiltered.value && selectedCohort.value !== 'unassigned'
    && !availableCohorts.value.some(c => String(c.id) === selectedCohort.value)
    && availableCohorts.value.length > 0
)

const fetchCohorts = async () => {
  try {
    const response = await api.get('/api/org/cohorts')
    const list = response.data.cohorts || response.data || []
    // Archived cohorts disappear from the active selector.
    availableCohorts.value = (list as any[]).filter(c => c && !c.archived_at)
    cohortsLoadError.value = null
  } catch (error: any) {
    availableCohorts.value = []
    cohortsLoadError.value = error?.response?.status === 401 || error?.response?.status === 403
      ? 'Cohorts require organization access'
      : 'Failed to load cohorts'
  }
}

// 🔥 Sprint 2E-D: Helper functions for developer dropdown hygiene
const isPilotVisibleDeveloperId = (value: string): boolean => {
  if (!value || value === 'unknown') return false
  
  // Exclude numeric-only IDs
  if (/^\d+$/.test(value)) return false
  
  // Exclude test/demo/sample/local/anonymous patterns
  const excludePatterns = [
    /^anonymous$/,
    /^browser-user$/,
    /^local-/,
    /^test/,
    /^demo/,
    /^sample/,
    /^dev_\d+$/,
    /^senior_dev_\d+$/,
    /^simulation_/,
    /^Cursor Test User/,
    /^VSCode Test User/,
    /^Windsurf Test User/
  ]
  
  for (const pattern of excludePatterns) {
    if (pattern.test(value)) return false
  }
  
  // Include real-looking named IDs (e.g., alex.chen, priya.patel)
  return /^[a-z]+(\.[a-z]+)+$/.test(value)
}

const formatDeveloperLabel = (value: string): string => {
  // Convert dot.case to Title Case: alex.chen → Alex Chen
  return value
    .split('.')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

const rankDeveloperOption = (value: string): number => {
  // Prefer specific named developers for pilot UX
  const priorityNames = [
    'alex.chen', 'priya.patel', 'marcus.kim', 'sarah.rodriguez',
    'jordan.taylor', 'riley.park', 'chris.walker'
  ]
  const index = priorityNames.indexOf(value)
  return index >= 0 ? index : 999
}

// 🔥 Sprint 2E-C: Fetch real developer options from /api/developers
// Backend now resolves invite-backed identities (invite:<id>) to human-readable
// labels (invite email, or "Developer (invite #<id>)") and excludes opaque
// legacy/anonymous identifiers (cm-dev-*, dev-user-*, raw numeric IDs, "anonymous").
// Response shape: { developers: [{ id, label, source }] }
const fetchDevelopers = async () => {
  loadingDevelopers.value = true
  try {
    const response = await api.get(API_ENDPOINTS.DEVELOPERS)
    const developers = (response.data.developers || [])
      // Operator/support enrollments are never customer developer options.
      // Display-layer exclusion only — telemetry and enrollment records are
      // preserved on the backend; only the selectable-person list is filtered.
      .filter((dev: any) => !(dev && dev.source === 'invite' && isOperatorEnrollmentEmail(dev.label)))

    if (developers.length > 0 && typeof developers[0] === 'object' && developers[0] !== null) {
      // New shape: already human-readable and pre-filtered by the backend.
      // Coerce id to string — backend may return integer IDs (e.g. 90001)
      // which would break the developer filter chain (setDeveloperIds,
      // user_id param, etc.) if left as numbers.
      // Include workflows array for cost allocation.
      // PBT-CLEANUP-2: The backend already curates and filters this list
      // (excludes opaque/anonymous/legacy IDs) — it is the authoritative
      // developer inventory. A client-side cap of twelve entries previously
      // silently hid real developers beyond that count for any org with
      // more developers than that, with no indication to the user. Render
      // the full authoritative list.
      availableDevelopers.value = mapCuratedDevelopers(developers as CuratedDeveloper[])
      return
    }

    // Backward-compatible path: old flat string list from an unpatched backend
    const pilotSafeDevelopers = (developers as Array<string | number>)
      .map((dev) => String(dev))
      .filter(isPilotVisibleDeveloperId)
      .map((dev: string) => ({
        id: dev,
        label: formatDeveloperLabel(dev),
        rank: rankDeveloperOption(dev)
      }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 12) // Limit to 12 developers for pilot UX

    // Fallback: if no pilot-safe developers found, show first 10 non-empty strings (excluding test/demo/sample/local/anonymous)
    if (pilotSafeDevelopers.length === 0) {
      const fallbackDevelopers = (developers as Array<string | number>)
        .map((dev) => String(dev))
        .filter(value => value && value !== 'unknown' && !/^\d+$/.test(value))
        .filter(value => !isPilotVisibleDeveloperId(value) && !value.match(/^(test|demo|sample|local|anonymous)/))
        .slice(0, 10)
        .map((dev: string) => ({
          id: dev,
          label: dev
        }))
      
      availableDevelopers.value = fallbackDevelopers
    } else {
      availableDevelopers.value = pilotSafeDevelopers.map(({ id, label }) => ({ id, label }))
    }
  } catch (error) {
    console.error('[PBT] Failed to fetch developers:', error)
    availableDevelopers.value = []
  } finally {
    loadingDevelopers.value = false
  }
}

// CR-X P0.2: Fetch repos from TELEMETRY ATTRIBUTION (not GitHub-gated endpoint).
// ChaosMonkey has two distinct repo evidence concepts:
//   1. TELEMETRY REPO IDENTITY — git_repo_url from IDE telemetry (always available)
//   2. GITHUB ENGINEERING EVIDENCE — PR/review/merge repos (requires eng integration)
// A pilot does NOT need GitHub engineering integration to filter IDE telemetry by repo.
// Primary source: /api/telemetry/repos (telemetry attribution, always available)
// Secondary source: /api/repositories (GitHub-gated, for delivery evidence repos)
const fetchRepos = async () => {
  loadingRepos.value = true
  try {
    // Primary: telemetry-attributed repos (no GitHub connection required)
    const telemetryResponse = await api.get('/api/telemetry/repos')
    const telemetryRepos: string[] = telemetryResponse.data.repositories || []

    // Secondary: GitHub engineering-evidence repos (may be empty if not connected)
    let githubRepos: string[] = []
    try {
      const ghResponse = await api.get(API_ENDPOINTS.REPOSITORIES)
      githubRepos = ghResponse.data.repositories || []
    } catch {
      // GitHub endpoint failure is non-fatal — telemetry repos are sufficient
    }

    // Merge both sources, normalize, and deduplicate
    const allRepos = [...telemetryRepos, ...githubRepos]
    // Exclude identities proven operator-only (all sessions credited to
    // configured operator enrollments).
    // Display-layer only — raw telemetry is preserved. Ambiguous or
    // unresolved identities are retained.
    availableRepos.value = normalizeRepoList(allRepos)
      .filter((r: { id: string; label: string }) => !isOperatorOnlyRepoIdentity(r.id))
  } catch (error) {
    console.error('[PBT] Failed to fetch repositories:', error)
    availableRepos.value = []
  } finally {
    loadingRepos.value = false
  }
}

// 🔥 P2: Reset filters function
const resetFilters = () => {
  // Use single sync path: set local state, let watch handle store update
  selectedTimeFilter.value = 'all'
  selectedTeam.value = ''
  selectedCohort.value = ''
  selectedDeveloper.value = ''
  selectedRepo.value = ''
  selectedWorkflow.value = 'compare'

  // Also reset store filters that don't have local refs
  filterStore.setRepos('productivity', [])
  filterStore.setTeamIds('productivity', [])
  filterStore.setDeveloperIds('productivity', [])
  // CR-X Day 1B S3: Reset shared analysisContext for PI/PBT convergence
  analysisContext.reset()
}

// 🔥 FORWARD SYNC: selectedTimeFilter → analysisContext (canonical) + filterStore (display)
// CR-X PI/PBT-TIME: analysisContext is the single time authority for PI and PBT.
// filterStore is mirrored so display functions (computeWindowSpend, timeWindowLabel)
// continue to work without changes.
watch(selectedTimeFilter, (newValue) => {
  if (isSyncingTimeFilter) return // Prevent loop
  
  if (PBT_DEBUG) console.log('[PBT_TIME_FILTER_FORWARD]', { newValue, willSetEmptyStrings: newValue === 'all' })
  
  isSyncingTimeFilter = true
  
  // CR-X PI/PBT-TIME: Map PBT dropdown to analysisContext preset (canonical time authority).
  // PBT 'day' → '1d' (single calendar day), 'week' → '7d', 'month' → '30d', 'quarter' → '90d'.
  // analysisContext.getPresetRange uses local calendar dates (not UTC) to match PBT semantics.
  const pbtPresetMap: Record<string, string> = {
    'all': 'all',
    'day': '1d',
    'week': '7d',
    'month': '30d',
    'quarter': '90d',
  }
  const acPreset = pbtPresetMap[newValue] || 'all'
  analysisContext.setTimePreset(acPreset as any)

  // Mirror to filterStore for display/debug compatibility (computeWindowSpend, timeWindowLabel, etc.)
  if (newValue === 'all') {
    filterStore.setDateRange('productivity', { from: '', to: '' })
  } else {
    const ctxRange = analysisContext.dateRange
    filterStore.setDateRange('productivity', { from: ctxRange.from, to: ctxRange.to })
  }
  
  setTimeout(() => { isSyncingTimeFilter = false }, 0)
}, { immediate: true })

// 🔥 REVERSE SYNC: analysisContext → selectedTimeFilter
// CR-X PI/PBT-TIME: analysisContext is the canonical time authority.
// When analysisContext changes externally (e.g. UnifiedFilters sets it),
// update the PBT dropdown to reflect the same time window.
watch(
  () => analysisContext.dateRange,
  (newRange) => {
    if (isSyncingTimeFilter) return // Prevent loop
    if (!newRange) return
    
    const derivedFilter = deriveTimeFilterFromRange(newRange.from, newRange.to)
    
    // Only update if different to avoid unnecessary re-renders
    if (derivedFilter !== selectedTimeFilter.value) {
      if (PBT_DEBUG) console.log('[PBT_TIME_FILTER_REVERSE]', {
        ctxRange: newRange,
        derivedFilter,
        currentDropdown: selectedTimeFilter.value
      })
      
      isSyncingTimeFilter = true
      selectedTimeFilter.value = derivedFilter
      setTimeout(() => { isSyncingTimeFilter = false }, 0)
    }
  },
  { deep: true }
)

watch(selectedTeam, (newValue) => {
  filterStore.setTeamIds('productivity', newValue ? [newValue] : [])
})

// K1B: cohort select → shared analysisContext (single scope authority).
watch(selectedCohort, (newValue) => {
  analysisContext.setCohortId(newValue)
})

// K1B COST: configured spend is org-level. A cohort-scoped cost roll-up is
// unavailable in V1, so the cost layer is forced off while a cohort filter
// is active (prevents org-wide spend being rendered under a cohort label).
watch(isCohortFiltered, (active) => {
  if (active && selectedCostLayer.value !== 'off') {
    selectedCostLayer.value = 'off'
  }
})

// Reverse sync: analysisContext → cohort control (e.g. store reset, PI scope).
watch(() => analysisContext.cohortId, (newId) => {
  const normalized = newId === 'all' ? '' : newId
  if (normalized !== selectedCohort.value) {
    selectedCohort.value = normalized
  }
})

watch(selectedDeveloper, (newValue) => {
  filterStore.setDeveloperIds('productivity', newValue ? [newValue] : [])
  // CR-X Day 1B S3: Sync to shared analysisContext for PI/PBT convergence
  analysisContext.setDeveloperIds(newValue ? [newValue] : [])
})

watch(selectedRepo, (newValue) => {
  filterStore.setRepos('productivity', newValue ? [newValue] : [])
  // CR-X Day 1B S3: Sync to shared analysisContext for PI/PBT convergence
  analysisContext.setRepoIds(newValue ? [newValue] : [])
})

// CR-X Day 2 X1 FIX: Reverse sync — analysisContext → local refs.
// When analysisContext changes externally (e.g., PI sets filters, or store
// is restored from a previous session), the dropdown controls must reflect
// the same scope. This preserves the invariant:
//   visible filter controls == analysisContext == canonical request
// Guard against infinite loops: only update when the value actually differs.
watch(() => analysisContext.developerIds, (newIds) => {
  const storeDev = newIds.length > 0 ? newIds[0] : ''
  if (storeDev !== selectedDeveloper.value) {
    selectedDeveloper.value = storeDev
  }
}, { deep: true })

watch(() => analysisContext.repoIds, (newIds) => {
  const storeRepo = newIds.length > 0 ? newIds[0] : ''
  if (storeRepo !== selectedRepo.value) {
    selectedRepo.value = storeRepo
  }
}, { deep: true })

// CR-X Day 1B S3: Sync selectedWorkflow to shared analysisContext
// 'compare' = no workflow filter (all workflows). Any other value = single workflow.
watch(selectedWorkflow, (newValue) => {
  // CR-X Day 1B S3: Sync to shared analysisContext for PI/PBT convergence
  analysisContext.setWorkflowIds(newValue && newValue !== 'compare' ? [newValue] : [])
})

watch(selectedView, (newView) => {
  if (newView === 'cards' && (selectedWorkflow.value !== 'compare' || analysisContext.workflowIds.length > 0)) {
    selectedWorkflow.value = 'compare'
    analysisContext.setWorkflowIds([])
  }
}, { immediate: true })

// Read selectedMetric from filter store (same as Classic)
const selectedMetric = computed(() => {
  const productivityMetricId = filterStore.productivityFilters?.productivityMetricId
  if (!productivityMetricId || productivityMetricId === 'all') return 'ai_suggestions_accepted'
  // Convert from filter store format (ide.metric_name or delivery.metric_name) to dropdown format (metric_name)
  return productivityMetricId.replace('ide.', '').replace('delivery.', '')
})

// Check if current metric is output-like (for Estimated Output / $100 guardrail)
// Only allow Output / $100 for higher-is-better output/count metrics
const isOutputMetric = computed(() => {
  const metric = selectedMetric.value
  const polarity = METRIC_POLARITY[metric]
  const outputMetrics = ['ai_suggestions_accepted', 'commits_per_session', 'files_edited_per_session']
  return polarity === 'higher' && outputMetrics.includes(metric)
})

// Watch for metric changes to fallback cost layer if Output / $100 becomes invalid
watch(selectedMetric, (newMetric) => {
  if (selectedCostLayer.value === 'cost_adjusted' && !isOutputMetric.value) {
    // Fallback to Monthly Spend if Output / $100 is no longer valid
    selectedCostLayer.value = 'monthly'
  }
})

// Local dropdown state for two-way binding
// Initialize with default metric from filter store to ensure sync
const localSelectedMetric = ref('ai_suggestions_accepted')

// PERF: Track rerender counts
let ideMetricCardsRerenderCount = 0
let v3CardsRerenderCount = 0
let initialRenderStart = performance.now()
let firstCardRenderTime: number | null = null

// Sync local dropdown with filter store (two-way binding)
watch(() => filterStore.productivityFilters?.productivityMetricId, (newMetricId) => {
  if (newMetricId && newMetricId !== 'all') {
    localSelectedMetric.value = newMetricId.replace('ide.', '').replace('delivery.', '')
  }
}, { immediate: true })

// Initialize local dropdown on mount to ensure sync
onMounted(() => {
  const metricId = filterStore.productivityFilters?.productivityMetricId
  if (metricId && metricId !== 'all') {
    localSelectedMetric.value = metricId.replace('ide.', '').replace('delivery.', '')
  }
  
  // 🔥 Sprint 2E-C: Fetch developer and repo options on mount
  fetchDevelopers()
  fetchRepos()
  // K1B: active cohort options for the cohort selector
  fetchCohorts()
})

// CR-X Slice 1: Delivery metric field names (from /api/delivery/timeseries)
const DELIVERY_METRIC_FIELDS = new Set([
  'merged_pr_count', 'deployment_count', 'deploy_success_rate', 'median_merge_cycle_hours', 'release_count',
  'review_count', 'pr_review_cycles', 'merge_rate'
])

// CR-X R2: Delivery attribution authority — delivery metrics are org-level
// (or repo-level if a single repo is selected). They are NOT per-workflow.
// Compare-workflow mode is suppressed for delivery metrics.
// Developer filtering suppresses delivery metrics entirely (fail closed).
const isDeliveryMetric = computed(() => DELIVERY_METRIC_FIELDS.has(selectedMetric.value))
// isDeveloperFiltered already defined above (line 768) — reused here.
const deliveryMetricSuppressed = computed(() => isDeliveryMetric.value && isDeveloperFiltered.value)
const deliverySeriesLabel = computed(() => {
  if (deliveryAttributionAuthority.value === 'repo') {
    const repoLabel = availableRepos.value.find(r => r.id === selectedRepo.value)?.label || repoDisplayLabel(selectedRepo.value)
    return `${repoLabel} delivery`
  }
  return 'Org delivery'
})

// CR-X C: Delivery provenance label — must not visually resemble connected GitHub
// CR-X PBT-CLEANUP-4: When deliveryError is set, show explicit unavailable state
const deliveryProvenanceLabel = computed(() => {
  if (deliveryError.value) return 'Delivery unavailable'
  const src = deliverySource.value
  if (src === 'cm_activity_sim') return 'Historical delivery data'
  if (src === 'live') return 'GitHub engineering evidence'
  if (src === 'error') return 'Delivery fetch error'
  return ''
})

const deliveryProvenanceClass = computed(() => {
  if (deliveryError.value) return 'v3-provenance-error'
  const src = deliverySource.value
  if (src === 'cm_activity_sim') return 'v3-provenance-demo'
  if (src === 'live') return 'v3-provenance-live'
  return 'v3-provenance-unknown'
})

// CR-X R2: When a delivery metric is selected, force out of Compare mode.
// Delivery data is org-level — per-workflow comparison is not authoritative.
// When switching AWAY from a delivery metric, reset to 'compare' (no filter).
// An empty string workflow selection is a phantom filter — it must never persist.
watch(isDeliveryMetric, (isDelivery) => {
  if (isDelivery && selectedWorkflow.value === 'compare') {
    selectedWorkflow.value = '' // exit compare mode
  }
  if (!isDelivery && selectedWorkflow.value === '') {
    selectedWorkflow.value = 'compare' // reset phantom empty filter
  }
  // CR-X PBT-CLEANUP-3: Delivery metrics have no Cards source — force Time Series
  if (isDelivery && selectedView.value === 'cards') {
    selectedView.value = 'timeseries'
  }
})

// Normalize empty/stale workflow selections on metric change.
// An empty workflow selection (null, undefined, '') is NO FILTER — treat as 'compare'.
// A stale selection (workflow no longer in availableWorkflows) is also NO FILTER.
// This prevents phantom Workflow chips and blank selectors when switching metrics.
watch(selectedMetric, () => {
  const sw = selectedWorkflow.value
  if (sw === '' || sw === null || sw === undefined) {
    selectedWorkflow.value = 'compare'
  }
})

// Sync dropdown changes to filter store (RE-ENABLED for metric dropdown functionality)
// Since we fetch all metrics on initial load, dropdown changes update the filter store
// to ensure consistent metric selection across the component
watch(localSelectedMetric, (newMetric) => {
  const start = performance.now()
  // Use delivery. prefix for delivery metrics, ide. prefix for IDE telemetry metrics
  const metricId = newMetric === 'all' ? 'all'
    : DELIVERY_METRIC_FIELDS.has(newMetric) ? `delivery.${newMetric}`
    : `ide.${newMetric}`
  filterStore.setProductivityMetricId('productivity', metricId)
  const end = performance.now()
  if (PBT_DEBUG) console.log(`[PERF] Metric Dropdown | ${(end - start).toFixed(2)}ms | 1 | ${newMetric}`)
})

// ── CLASSIC DATA FETCHING PATTERN (useTimeSeries composable) ─────────────

// Construct productivity query with filters (same as Classic line 672-690)
// PERF FIX: Always fetch all metrics to avoid refetch on dropdown change
const productivityQuery = computed(() => {
  // Always fetch all productivity metrics to enable instant dropdown switching
  // CR-X PBT-CLEANUP-3: Delivery metrics are fetched from /api/delivery/timeseries
  // (via useTimeSeries), NOT from /api/productivity/timeseries. The delivery.*
  // entries were removed from this telemetry request list because the telemetry
  // endpoint does not return delivery fields — including them was a no-op that
  // masked the real delivery fetch path.
  const allProductivityMetrics = [
    'ide.ai_suggestions_accepted',
    'ide.files_edited_per_session',
    'ide.commits_per_session',
    'ide.average_session_length_minutes',
    'ide.time_to_first_commit_minutes',
    'ide.AI_usage_duration_minutes',
    'ide.idle_time_minutes',
    'ide.active_coding_time_minutes',
    'ide.active_coding_ratio',
    'ide.ai_usage_ratio',
    'ide.idle_ratio',
  ]
  
  const activeRange = filterStore.activeDateRange('productivity')
  // CR-X PI/PBT-TIME: Read time bounds from shared analysisContext (same authority as PI).
  // filterStore remains the UI/filter writer for scope (org/team/dev), but
  // analysisContext is the single time authority for both PI and PBT.
  const ctxRange = analysisContext.dateRange
  const query: any = {
    // CR-X PI/PBT-TIME: Time bounds come from analysisContext, not filterStore.
    // This ensures PI and PBT send identical from/to to the backend.
    from: ctxRange.from,
    to: ctxRange.to,
    repos: analysisContext.repoIds,
    scope: filterStore.activeScope('productivity'), // scope is org/team/dev — not in analysisContext
    // CR-X P0: Time Series is an explicit visualization intent.
    // Always request canonical period=day for the non-delivery Time Series view
    // regardless of the filter store's default; Cards view keeps the store bucket.
    viewBucket: selectedView.value === 'timeseries' ? 'daily' : filterStore.activeViewBucket('productivity'),
    developerIds: analysisContext.developerIds,
    // K1B: cohort scope — intersects with developerIds on the backend.
    cohortId: analysisContext.cohortId || undefined,
    teamIds: filterStore.activeTeamIds('productivity'), // teamIds not in analysisContext
    // Expand canonical workflow IDs to raw tool IDs — the canonical endpoint's
    // `tools` filter matches raw source/editor_source, so 'devin' must also
    // request 'windsurf' (legacy Devin telemetry) or the scoped series would
    // silently drop those sessions.
    toolIds: analysisContext.workflowIds.length > 0 ? expandCanonicalToolIds(analysisContext.workflowIds) : filterStore.activeToolIds('productivity'),
    // Always request all metrics to avoid refetch on dropdown change
    metricIds: allProductivityMetrics,
    groupBy: selectedView.value === 'timeseries' && selectedWorkflow.value !== 'compare' && !isDeliveryMetric.value
      ? 'developer'
      : undefined,
    // 🔥 REMOVED: metricId is NOT included in query to prevent refetch on metric-only changes
    // metricId is now used only for field selection in cards/graph, not for query identity
  }
  
  
  return query as any
})

// Use time series composable with the constructed query (same as Classic line 693)
const { data: timeSeriesData, isLoading: timeSeriesLoading, latestObservedAt, canonicalMetadata, error: timeSeriesError, deliverySeries, deliveryAttributionAuthority, deliverySource, deliveryError } = useTimeSeries(productivityQuery, toRef(props, 'isActive'))

// Clear stale time series data immediately when developer filter changes
// to prevent showing previous developer's data during the debounced fetch
watch(selectedDeveloper, () => {
  timeSeriesData.value = null
})

// RUNTIME PROOF: Log query state for All Time debugging
watch(productivityQuery, (newQuery) => {
  if (PBT_DEBUG) console.log('[PBT_RUNTIME_QUERY]', {
    from: newQuery.from,
    to: newQuery.to,
    fromIsEmpty: newQuery.from === '',
    toIsEmpty: newQuery.to === '',
    selectedTimeFilter: selectedTimeFilter.value,
    metricId: newQuery.metricId
  })
}, { immediate: true })

// Debug: Log time series data when it changes
watch(timeSeriesData, (newData) => {
  if (PBT_DEBUG) {
    console.info('[ProductivityByToolV3] TIME SERIES DATA RECEIVED:', {
      hasData: !!newData,
      seriesCount: newData?.length || 0,
      seriesLabels: newData?.map(s => s.label) || [],
      totalPoints: newData?.reduce((sum, s) => sum + (s.points?.length || 0), 0) || 0,
      sampleSeries: newData?.[0] || null
    })

    // 🔥 AUDIT: Log period counts at ProductivityByToolV3 level
    if (newData && Array.isArray(newData)) {
      const periodsByTool = new Map()
      const allTimestamps = new Set()
      newData.forEach(series => {
        if (series && series.points && Array.isArray(series.points)) {
          periodsByTool.set(series.label, series.points.length)
          series.points.forEach(point => {
            if (point && point.t) {
              allTimestamps.add(point.t)
            }
          })
        }
      })
      console.log('[AUDIT:PRODUCTIVITY_V3_TIME_SERIES_RECEIVED]', {
        seriesCount: newData.length,
        periodsByTool: Object.fromEntries(periodsByTool),
        totalPeriods: Array.from(periodsByTool.values()).reduce((sum, count) => sum + count, 0),
        uniqueTimestampsCount: allTimestamps.size,
        uniqueTimestamps: Array.from(allTimestamps).sort(),
        metadataAttached: !!(newData[0] && (newData[0] as any).metadata),
        canonicalPopulationCount: (newData[0] && (newData[0] as any).metadata) ? (newData[0] as any).metadata.canonical_population_count : null
      })
    }
  }

  // Runtime guardrail: Warn if zero series returned (likely configuration issue)
  if (PBT_DEBUG && (!newData || newData.length === 0)) {
    console.warn('[PRODUCTIVITY_GUARD] Zero series returned. Check viewBucket and API configuration.')
  }
}, { immediate: true })

// ── CLASSIC DATA IMPORTS (No new calculations) ───────────────────────────

// Time window label from Classic
const timeWindowLabel = computed(() => {
  const range = filterStore.activeDateRange('productivity')
  if (!range) return 'All historical telemetry'
  
  // 🔥 FIX: Handle empty strings (All Time)
  if (range.from === '' || range.to === '' || !range.from || !range.to) {
    return 'All historical telemetry'
  }
  
  // CR-X P0 microfix: range.from/to are canonical date-only 'YYYY-MM-DD'
  // strings. `new Date('YYYY-MM-DD')` parses them as UTC midnight, so a
  // bare toLocaleDateString() in a negative-offset timezone shifts the
  // rendered calendar day back by one (e.g. 2026-09-06 -> 9/5/2026 in EDT).
  // Render in UTC so the visible calendar day matches the canonical query.
  const from = new Date(range.from)
  const to = new Date(range.to)

  // Guard against invalid dates
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return 'All historical telemetry'
  }

  return `${from.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} - ${to.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
})

// Header context label: at canonical zero telemetry (totalSessions is the
// canonical PBT authority) the window copy must not claim historical data.
// timeWindowLabel itself is preserved for all other consumers.
const contextWindowLabel = computed(() =>
  // During the fetch totalSessions is still 0 — that is a loading state,
  // not proven-empty. "Waiting for first telemetry" is reserved for a
  // completed response that returned zero telemetry.
  pbtHeaderLoading.value
    ? 'Loading telemetry…'
    : totalSessions.value === 0 ? 'Waiting for first telemetry' : timeWindowLabel.value
)

// ── CONTEXT BAR DATA (Reused from NextGen) ───────────────────────────────

// CR-X R2: PBT header loading should reflect PBT-specific data readiness,
// NOT the unrelated canonical PI hydration. A populated chart can coexist
// with canonicalHydrating=true (PI is still loading) — that is not a PBT
// loading state. Only show Loading… when PBT's own time series is loading
// AND there is no data yet.
const pbtHeaderLoading = computed(() => {
  return timeSeriesLoading.value && (!timeSeriesData.value || timeSeriesData.value.length === 0)
})

// CR-X AH-3: ERROR != EMPTY != LOADING
// When the API returns an error (500, network failure, etc.), we must NOT
// show "No workflow telemetry yet" — that is a valid zero-session state.
// An API failure must visibly fail closed as unavailable/error.
// Only show error state when there is no prior good data to preserve.
const hasApiError = computed(() => {
  return !!timeSeriesError.value && !timeSeriesData.value
})

const totalSessions = computed(() => {
  // 🔥 FIX: Use canonical metadata for session count, not card sum
  // Per Productivity V3 data contract: header uses metadata.canonical_population_count
  const timeSeries = timeSeriesData.value
  let canonicalSessionCount = 0
  let metadataSource = 'none'
  
  if (timeSeries && Array.isArray(timeSeries) && timeSeries.length > 0) {
    // Check if any series has metadata attached
    const firstSeries = timeSeries[0]
    if (firstSeries && (firstSeries as any).metadata) {
      const metadata = (firstSeries as any).metadata
      canonicalSessionCount = metadata.canonical_population_count || 0
      
      // 🔥 FIX: If canonical_population_count is 0, sum session_count_by_tool as fallback
      if (canonicalSessionCount === 0 && metadata.session_count_by_tool) {
        const toolCounts = metadata.session_count_by_tool
        canonicalSessionCount = Object.values(toolCounts).reduce((sum: number, count: any) => sum + (count || 0), 0)
        metadataSource = 'session_count_by_tool_sum'
      } else {
        metadataSource = 'canonical_population_count'
      }
    } else {
      metadataSource = 'no_metadata_on_series'
    }
  } else {
    metadataSource = 'no_time_series'
  }
  
  const finalTotal = canonicalSessionCount
  
  if (PBT_DEBUG) console.log('[AUDIT:TOTAL_SESSIONS_CALCULATION]', {
    canonicalSessionCount,
    finalTotal,
    source: metadataSource,
    metadataSource,
    hasTimeSeries: !!timeSeries,
    timeSeriesLength: timeSeries?.length || 0,
    firstSeriesHasMetadata: !!(timeSeries && timeSeries[0] && (timeSeries[0] as any).metadata),
    firstSeriesMetadata: (timeSeries && timeSeries[0]) ? (timeSeries[0] as any).metadata : null
  })
  
  return finalTotal
})

const activeToolsCount = computed(() => {
  // Count unique tools from cards
  const cards = ideMetricCards.value
  if (!cards || cards.length === 0) return 0
  const count = new Set(cards.map(c => c.ide)).size
  return count || 0
})

// 🔥 P0 FIX: Calculate primary and emerging workflow counts for header
// CR-X R2: Count UNIQUE NORMALIZED WORKFLOW IDs, not aggregated card array length.
// Using filterPrimaryCards(cards).length would count cards, not workflows,
// which can produce inflated counts when multiple cards exist per workflow.
const primaryWorkflowsCount = computed(() => {
  const cards = ideMetricCards.value
  if (!cards || cards.length === 0) return 0
  const primaryCards = filterPrimaryCards(cards)
  // Count unique normalized workflow IDs
  const ids = new Set(primaryCards.map(c => normalizeToCanonicalToolId(c.ide)))
  return ids.size
})

const emergingWorkflowsCount = computed(() => {
  const cards = ideMetricCards.value
  if (!cards || cards.length === 0) return 0
  const emergingCards = filterEmergingCards(cards)
  const ids = new Set(emergingCards.map(c => normalizeToCanonicalToolId(c.ide)))
  return ids.size
})

const repositoryCount = computed(() => {
  // Extract from filter store
  return filterStore.activeRepos('productivity')?.length || 0
})

// CR-X Day 1B S1 P0-A: Developer coverage / filter trust UX — BACKEND AUTHORITY
// Both numerator and denominator come from the canonical telemetry metadata
// returned by the backend for the CURRENT scoped query. This guarantees:
//   coverage.total === canonical scoped session population
// The backend's LocalDeveloperResolver is the sole authority for alias
// expansion (e.g. local-developer → all verified raw identities). The
// frontend does NOT maintain a second, weaker developer-resolution implementation.
//   org view → denominator = org canonical population (from metadata)
//   developer-filtered → denominator = backend-resolved scoped population
//   repo-filtered → denominator = backend-resolved scoped population
//   combined → denominator = backend-resolved intersection population
// invite_backed_count is computed by the backend over the SAME scoped query.
// unattributed = scoped total − scoped invite-backed.
// If canonical metadata is not yet available, fail closed.
const developerCoverage = computed(() => {
  const unavailable = { total: 0, inviteBacked: 0, attributed: 0, unattributed: 0, coveragePct: 0, available: false, isDeveloperGrouped: false, authorityLabel: '' }
  const timeSeries = timeSeriesData.value
  if (!timeSeries || !Array.isArray(timeSeries) || timeSeries.length === 0) return unavailable

  const firstSeries = timeSeries[0] as any
  const metadata = firstSeries?.metadata
  if (!metadata) return unavailable

  const total = Number(metadata.canonical_population_count || 0)
  if (total === 0) return unavailable

  const isDeveloperGrouped = metadata.group_by === 'developer'
  const inviteBacked = Number(metadata.invite_backed_count || 0)
  const attributed = isDeveloperGrouped
    ? Number(metadata.developer_attributed_sessions || 0)
    : inviteBacked
  const unattributed = isDeveloperGrouped && typeof metadata.developer_unattributed_sessions === 'number'
    ? metadata.developer_unattributed_sessions
    : Math.max(total - attributed, 0)
  const coveragePct = total > 0 ? Math.round((attributed / total) * 100) : 0

  return {
    total,
    inviteBacked,
    attributed,
    unattributed,
    coveragePct,
    available: true,
    isDeveloperGrouped,
    authorityLabel: isDeveloperGrouped
      ? 'Developer attribution = sessions resolved by the authoritative developer identity resolver. This is distinct from repo attribution.'
      : 'Developer attribution = sessions with an invite-backed developer identity. This is distinct from repo attribution (sessions with git_repo_url), which is shown in Performance Insights.',
  }
})

// Supported IDEs with AI model combinations (same as Classic line 759)
const supportedIDEs = ref(SUPPORTED_IDES)

// Comparison entities derived only from actual canonical series labels
const comparisonEntities = computed(() => {
  const data = timeSeriesDataWithFallback.value.data
  if (!data || !Array.isArray(data)) return []

  const seen = new Set<string>()
  const entities: Array<{ id: string; name: string; icon: string; color: string }> = []

  for (const series of data) {
    if (!series || !series.label) continue
    const label = series.label
    if (seen.has(label)) continue
    seen.add(label)
    entities.push({
      id: label,
      name: seriesDimension.value === 'developer' ? (developerLabelById.value.get(label) || '') : getCanonicalWorkflowIdentity(label),
      icon: 'bi-lightning',
      color: 'dark'
    })
  }

  return entities
})

// ── CLASSIC WINNER CALCULATIONS (Mode-specific) ─────────────────────────────

// Top IDE from IDE comparison mode cards (now uses polarity-aware leader logic)
const topIDE = computed(() => {
  const cards = ideMetricCards.value
  if (!cards || cards.length === 0) return 'No data'

  // 🔥 P0: Use canonical workflow universe constant
  const ideCards = cards.filter(card => {
    const ideId = card.ide.toLowerCase()
    return ALL_SUPPORTED_IDES.includes(ideId as any)
  })

  const leader = determineLeader(ideCards, selectedMetric.value)
  return leader ? getCanonicalEntityLabel(leader.ide, 'ides') : 'No data'
})

// Top Model from Model comparison mode cards (now uses polarity-aware leader logic)
const topModel = computed(() => {
  const cards = ideMetricCards.value
  if (!cards || cards.length === 0) return 'No data'
  
  // Aggregate by model using IDE_TO_MODEL_MAP
  const modelValues: Record<string, number> = {}
  cards.forEach(card => {
    const ideId = card.ide.toLowerCase()
    const modelId = IDE_TO_MODEL_MAP[ideId]
    if (modelId && card.value !== null) {
      if (!modelValues[modelId]) modelValues[modelId] = 0
      modelValues[modelId] += card.value
    }
  })
  
  // Use polarity-aware leader selection
  const modelCards = Object.entries(modelValues).map(([modelId, value]) => ({
    ide: modelId,
    value,
    isLive: cards.some(c => IDE_TO_MODEL_MAP[c.ide.toLowerCase()] === modelId && c.isLive),
    usesTelemetry: cards.some(c => IDE_TO_MODEL_MAP[c.ide.toLowerCase()] === modelId && c.usesTelemetry),
    dataSource: 'aggregated',
    telemetryPointCount: cards.filter(c => IDE_TO_MODEL_MAP[c.ide.toLowerCase()] === modelId).reduce((sum, c) => sum + (c.telemetryPointCount || 0), 0),
    totalPointCount: cards.filter(c => IDE_TO_MODEL_MAP[c.ide.toLowerCase()] === modelId).reduce((sum, c) => sum + (c.totalPointCount || 0), 0),
    hasValue: true
  }))
  
  const leader = determineLeader(modelCards, selectedMetric.value)
  return leader ? getCanonicalEntityLabel(leader.ide, 'models') : 'No data'
})

// Top Workflow from Workflow comparison mode cards (now uses polarity-aware leader logic)
const topWorkflow = computed(() => {
  const cards = ideMetricCards.value
  if (!cards || cards.length === 0) return 'No data'
  
  // Find leading IDE and convert to workflow identity
  const leader = determineLeader(cards, selectedMetric.value)
  if (!leader) return 'No data'
  
  // Convert IDE leader to workflow identity
  return getCanonicalWorkflowIdentity(leader.ide)
})

// ── WORST PERFORMER CALCULATIONS (per metric polarity) ─────────────

// Determine the correct label for worst performer based on metric polarity
// CR4 P1: Neutral framing — no LEADER/LAGGARD subjective labels.
// Use factual "LOWEST" for both polarities (the badge already says HIGHEST
// for the top performer; the bottom performer is simply "LOWEST").
const worstPerformerLabel = computed(() => {
  return 'LOWEST'
})

// Bottom IDE (worst performer)
const bottomIDE = computed(() => {
  const cards = ideMetricCards.value
  if (!cards || cards.length === 0) return null

  // 🔥 P0: Use canonical workflow universe constant
  const ideCards = cards.filter(card => {
    const ideId = card.ide.toLowerCase()
    return ALL_SUPPORTED_IDES.includes(ideId as any)
  })

  const laggard = determineLaggard(ideCards, selectedMetric.value)
  return laggard ? getCanonicalEntityLabel(laggard.ide, 'ides') : null
})

// Bottom Model (worst performer)
const bottomModel = computed(() => {
  const cards = ideMetricCards.value
  if (!cards || cards.length === 0) return null
  
  const modelValues: Record<string, number> = {}
  cards.forEach(card => {
    const ideId = card.ide.toLowerCase()
    const modelId = IDE_TO_MODEL_MAP[ideId]
    if (modelId && card.value !== null) {
      if (!modelValues[modelId]) modelValues[modelId] = 0
      modelValues[modelId] += card.value
    }
  })
  
  const modelCards = Object.entries(modelValues).map(([modelId, value]) => ({
    ide: modelId,
    value,
    hasValue: true
  }))
  
  const laggard = determineLaggard(modelCards, selectedMetric.value)
  return laggard ? getCanonicalEntityLabel(laggard.ide, 'models') : null
})

// Bottom Workflow (worst performer)
const bottomWorkflow = computed(() => {
  const cards = ideMetricCards.value
  if (!cards || cards.length === 0) return null
  
  const laggard = determineLaggard(cards, selectedMetric.value)
  if (!laggard) return null
  
  return getCanonicalWorkflowIdentity(laggard.ide)
})

// ── EXECUTIVE INTERPRETATION LAYER ─────────────────────────────────────────────

// Generate executive interpretation based on leader/laggard and metric
const executiveInterpretation = computed(() => {
  const leader = selectedComparisonMode.value === 'ides' ? topIDE.value :
                 selectedComparisonMode.value === 'models' ? topModel.value :
                 topWorkflow.value
  const laggard = selectedComparisonMode.value === 'ides' ? bottomIDE.value :
                  selectedComparisonMode.value === 'models' ? bottomModel.value :
                  bottomWorkflow.value
  
  if (!leader || leader === 'No data') return null
  
  const metric = selectedMetricLabel.value
  const polarity = METRIC_POLARITY[selectedMetric.value] || 'higher'
  
  // Get actual values for evidence-based narratives
  const cards = ideMetricCards.value
  const leaderCard = cards.find(c => {
    const name = selectedComparisonMode.value === 'workflows' ? getCanonicalWorkflowIdentity(c.ide) :
                 selectedComparisonMode.value === 'ides' ? getCanonicalEntityLabel(c.ide, 'ides') :
                 getCanonicalEntityLabel(IDE_TO_MODEL_MAP[c.ide.toLowerCase()] || c.ide, 'models')
    return name === leader
  })
  const laggardCard = laggard ? cards.find(c => {
    const name = selectedComparisonMode.value === 'workflows' ? getCanonicalWorkflowIdentity(c.ide) :
                 selectedComparisonMode.value === 'ides' ? getCanonicalEntityLabel(c.ide, 'ides') :
                 getCanonicalEntityLabel(IDE_TO_MODEL_MAP[c.ide.toLowerCase()] || c.ide, 'models')
    return name === laggard
  }) : null
  
  const leaderValue = leaderCard?.value
  const laggardValue = laggardCard?.value
  
  // Calculate percentage difference for evidence
  let percentDiff = 0
  if (leaderValue && laggardValue && laggardValue !== 0) {
    percentDiff = Math.abs((leaderValue - laggardValue) / laggardValue * 100)
  }
  
  // 🔥 P0-B FIX: Never compare an entity to itself
  // If leader === laggard, it means only one entity is eligible
  if (leader === laggard || !laggard) {
    // Single entity case: show leader only, no comparison
    return `${leader} has the only currently eligible sample for ${metric.toLowerCase()}.`
  }
  
  // Generate evidence-based interpretation
  // Use absolute comparison when percentage is absurd (> 200%)
  // This prevents "628% higher" type narratives that damage credibility
  if (laggard && leaderValue && laggardValue) {
    const ABSURD_PERCENTAGE_THRESHOLD = 200
    
    if (percentDiff > ABSURD_PERCENTAGE_THRESHOLD) {
      // Use absolute comparison instead of percentage
      const leaderFormatted = formatMetricValue(leaderValue, selectedMetric.value)
      const laggardFormatted = formatMetricValue(laggardValue, selectedMetric.value)
      
      if (polarity === 'higher') {
        return `${leader} (${leaderFormatted}) vs ${laggard} (${laggardFormatted}) for ${metric.toLowerCase()}.`
      } else {
        return `${leader} (${leaderFormatted}) vs ${laggard} (${laggardFormatted}) for ${metric.toLowerCase()}.`
      }
    } else {
      // Use percentage comparison for reasonable differences
      const diff = percentDiff.toFixed(0)
      if (polarity === 'higher') {
        return `${leader} achieved ${diff}% higher ${metric.toLowerCase()} than ${laggard} during this period.`
      } else {
        return `${leader} reached ${metric.toLowerCase()} ${diff}% faster than ${laggard} during this period.`
      }
    }
  } else if (leaderValue) {
    return `${leader} leads in ${metric.toLowerCase()} across all ${selectedComparisonMode.value === 'ides' ? 'IDEs' : selectedComparisonMode.value === 'models' ? 'AI models' : 'workflows'}.`
  }
  
  return null
})

// ── CLASSIC OPERATIONAL SIGNALS (Data-driven, not decorative) ─────────────

// Shared helper: Map selected metric to point field
function getPointMetricValue(point: any, metricKey: string): number | null {
  const pointField = resolveTimeSeriesPointField(metricKey)
  if (!pointField) return null
  const value = point[pointField]

  // Reject NaN/Infinity/null/undefined
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null
  }

  return value
}

// Helper: Get WoW trend data from the weekly time series.
// WoW is only meaningful on weekly-bucketed data. When the canonical response
// used daily buckets (adaptive granularity for ≤90-day windows), the last two
// points are consecutive DAYS — not weeks — so a "WoW" claim would be false.
// The comparison also excludes the current partial week via
// compareCompleteWeeks (the previous implementation compared the last two raw
// points, which could include the in-progress week or adjacent days).
function getTrendData(ideId: string, metricKey: string): number | null {
  try {
    if (canonicalMetadata.value?.period !== 'week') return null
    const dataSource = timeSeriesDataWithFallback.value.data
    if (!dataSource || !Array.isArray(dataSource)) {
      return null
    }

    const series = dataSource.find(s => s.label === ideId || s.label === ideId.toLowerCase())
    if (!series || !series.points || series.points.length < 2) {
      return null
    }

    const pointField = resolveTimeSeriesPointField(metricKey)
    if (!pointField) return null
    const comparison = compareCompleteWeeks(extractWeeklyPoints(series, pointField))
    if (!comparison.hasEnoughData || comparison.percentDelta === null) return null

    const trend = Math.max(-500, Math.min(500, comparison.percentDelta)) // Cap at 500%
    return Math.round(trend * 10) / 10
  } catch (e) {
    return null
  }
}

const operationalSignals = computed(() => {
  // Borrow from Next Gen's operational signal pattern with real trend data
  const signals: string[] = []
  const cards = ideMetricCards.value
  
  if (!cards || cards.length === 0) return signals
  
  // Generate mode-specific observations with trend data from time series
  cards.forEach(card => {
    if (card.value !== null && card.value !== 0) {
      const metricLabel = selectedMetricLabel.value
      const value = formatMetricValue(card.value, selectedMetric.value)
      
      // CR-X FINAL: For emerging/low-sample workflows (< 25 sessions), label trend
      // as directional only, not mature-workflow authority.
      const cardSessionCount = (card as any).sessionCount || 0
      const isLowSampleCard = cardSessionCount > 0 && cardSessionCount < 25
      
      // Get trend data from time series
      let trendText = ''
      const trend = getTrendData(card.ide, selectedMetric.value)
      if (trend !== null && !isNaN(trend)) {
        const trendDirection = trend > 0 ? '+' : ''
        const trendVal = `${trendDirection}${trend.toFixed(0)}% WoW`
        // Label emerging-sample trends as directional only
        trendText = isLowSampleCard ? ` ${trendVal} (directional, emerging sample)` : ` ${trendVal}`
      }
      
      // Generate workflow-specific observations (workflow performance, throughput)
      if (selectedComparisonMode.value === 'workflows') {
        // Single-workflow Time Series is developer-grouped: card.ide is a
        // canonical developer id, not a workflow. The authoritative developer
        // label map (same as chart/drilldown) is MANDATORY here — an
        // unmapped id is omitted entirely, never rendered verbatim
        // (e.g. 90005, local-demo-matt-overlay, invite:* must not display).
        if (seriesDimension.value === 'developer') {
          const devName = developerLabelById.value.get(String(card.ide))
          if (!devName) return // omit signal for unmapped developer ids
          signals.push(`${devName} ${metricLabel}: ${value}${trendText}`)
        } else {
          const workflowName = getCanonicalWorkflowIdentity(card.ide)
          signals.push(`${workflowName} ${metricLabel}: ${value}${trendText}`)
        }
      }
      // Generate model-specific observations (AI model adoption, acceptance)
      else if (selectedComparisonMode.value === 'models') {
        const modelName = getCanonicalEntityLabel(card.ide, 'models')
        signals.push(`${modelName} ${metricLabel}: ${value}${trendText}`)
      }
      // Generate IDE-specific observations (IDE adoption, coding efficiency)
      else {
        const ideName = getCanonicalEntityLabel(card.ide, 'ides')
        signals.push(`${ideName} ${metricLabel}: ${value}${trendText}`)
      }
    }
  })
  
  // Limit to top 4 signals for rotation
  return signals.slice(0, 4)
})

// ── CLASSIC CARD DATA (No new calculations) ───────────────────────────────

// Use Classic's time series data with fallback (same as Classic line 716-751)
const timeSeriesDataWithFallback = computed(() => {
  // Live data wins if available
  if (timeSeriesData.value && Array.isArray(timeSeriesData.value) && timeSeriesData.value.length > 0) {
    return {
      data: timeSeriesData.value,
      source: 'live',
      timestamp: Date.now()
    }
  }
  return { data: [], source: 'none', timestamp: null }
})

// ── PBT DECISION SURFACE COMPUTEDS (Time Series view only) ────────────────
//
// These computeds turn the existing weekly-bucketed time series into a
// decision view. They do NOT introduce new data sources.
// Contracts:
//  - Default to Compare workflows (all eligible instrumented workflows shown).
//  - Explicit workflow selection shows that single workflow only.
//  - Never render a zero series for missing instrumentation.
//  - Compare mode excludes workflows not instrumented for the selected metric.
//  - Never use the current partial week as a completed WoW comparison period.

// Workflows that have at least one canonical series in the current data.
const availableWorkflows = computed(() => {
  if (selectedWorkflow.value !== 'compare') return [] as Array<{ id: string; label: string; sessions: number }>
  const data = timeSeriesDataWithFallback.value.data
  if (!data || !Array.isArray(data)) return [] as Array<{ id: string; label: string; sessions: number }>
  const seen = new Set<string>()
  const out: Array<{ id: string; label: string; sessions: number }> = []
  for (const s of data) {
    if (!s || !s.label) continue
    const id = s.label
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      label: getCanonicalWorkflowIdentity(id),
      sessions: s.sessionCount || 0,
    })
  }
  // Strongest evidence first (most sessions)
  out.sort((a, b) => b.sessions - a.sessions)
  return out
})

// The selector's option list. Held stable while a single-workflow selection
// narrows the fetched series; refreshed whenever unfiltered data resolves.
const workflowOptions = ref<Array<{ id: string; label: string; sessions: number }>>([])

// Clean up stale workflow selections when available workflows change.
// If selectedWorkflow is not 'compare' and not in the current availableWorkflows,
// reset to 'compare' (no filter). This prevents phantom chips when data changes.
watch(availableWorkflows, (workflows) => {
  // Refresh the selector's option universe only from unfiltered (compare-mode)
  // responses. A workflow-scoped response must not collapse the dropdown to
  // just the selected workflow — the user must be able to switch directly
  // between workflows without returning to Compare first.
  if (selectedWorkflow.value === 'compare' && workflows.length > 0) {
    workflowOptions.value = workflows
  }
  const sw = selectedWorkflow.value
  if (sw === '' || sw === null || sw === undefined) {
    selectedWorkflow.value = 'compare'
    return
  }
  // A workflow selection triggers a scoped refetch; useTimeSeries clears
  // timeSeriesData to null on every query change, so availableWorkflows is
  // transiently empty while that request is in flight. Do not treat the
  // transient empty state as a stale selection — only reset once the fetch
  // has resolved and the workflow is still absent.
  if (timeSeriesLoading.value) return
  if (sw !== 'compare' && workflowOptions.value.length > 0 && !workflowOptions.value.some(w => w.id === sw)) {
    selectedWorkflow.value = 'compare'
  }
})

// Is the selected metric actually instrumented for a given workflow?
// Keep the exact Cards authority: surfaceAgentContract plus the PBT fallback list.
function workflowInstrumentedForMetric(workflowId: string, metricKey: string): boolean {
  return isMetricInstrumentedForWorkflow(workflowId, metricKey)
    && isMetricInstrumentedForTool(workflowId, metricKey)
}

// Whether the Time Series is in Compare mode (all eligible workflows).
const isCompareMode = computed(() => selectedWorkflow.value === 'compare')
const seriesDimension = computed<'workflow' | 'developer'>(() => isCompareMode.value ? 'workflow' : 'developer')
const developerLabelById = computed(() => new Map(availableDevelopers.value.map(dev => [String(dev.id), dev.label])))
const authoritativeDeveloperSeries = computed(() => {
  if (seriesDimension.value !== 'developer') return []
  return timeSeriesDataWithFallback.value.data
    .filter(series => developerLabelById.value.has(String(series.label ?? '')))
    .map(series => ({ ...series, label: developerLabelById.value.get(String(series.label ?? '')) as string }))
})
const developerAttributedSessions = computed(() => Number(canonicalMetadata.value?.developer_attributed_sessions || 0))
const selectedWorkflowPopulation = computed(() => Number(canonicalMetadata.value?.canonical_population_count || 0))

function workflowOptionSessionCount(workflow: { id: string; sessions: number }): number {
  if (!isCompareMode.value && workflow.id === selectedWorkflow.value) {
    const scoped = canonicalMetadata.value?.canonical_population_count
    if (scoped !== null && scoped !== undefined && scoped !== '') {
      const sessions = Number(scoped)
      if (Number.isFinite(sessions)) return sessions
    }
  }
  return workflow.sessions
}

const hasZeroDeveloperAttribution = computed(() =>
  seriesDimension.value === 'developer' && !timeSeriesLoading.value && selectedWorkflowPopulation.value > 0 && developerAttributedSessions.value === 0
)

// The selected workflow identity when not in Compare mode. Identity is
// independent of metric capability; instrumentation is gated separately.
const effectiveWorkflowId = computed(() => {
  if (isCompareMode.value) return ''
  const workflows = workflowOptions.value
  if (workflows.length === 0) return ''

  const userPick = selectedWorkflow.value
  if (userPick && workflows.some(w => w.id === userPick)) return userPick
  return ''
})

// Workflows eligible for the current metric (instrumented + has series).
// In Compare mode, the chart shows all of these.
const eligibleWorkflowsForMetric = computed(() => {
  const metricKey = selectedMetric.value
  return availableWorkflows.value.filter(w => workflowInstrumentedForMetric(w.id, metricKey))
})

// Workflows in the current scope that cannot report the selected metric.
// They are excluded from compare-mode charts and the cards grid — name them
// explicitly so a missing workflow reads as instrumentation scope, not data
// loss (e.g. Codex lifecycle telemetry does not emit Active Coding Time).
const ineligibleWorkflowsForMetric = computed(() => {
  const metricKey = selectedMetric.value
  return availableWorkflows.value.filter(w => !workflowInstrumentedForMetric(w.id, metricKey))
})

// The single series object for the effective workflow (or null).
const effectiveWorkflowSeries = computed(() => {
  const id = effectiveWorkflowId.value
  if (!id) return null
  const data = timeSeriesDataWithFallback.value.data
  if (!data || !Array.isArray(data)) return null
  return data.find(s => s && s.label === id) || null
})

// True when a specific workflow is selected and the metric is NOT instrumented
// for it. In Compare mode, this is always false (ineligible workflows are
// simply excluded from the chart).
const metricNotInstrumentedForWorkflow = computed(() => {
  if (isCompareMode.value) return false
  const id = effectiveWorkflowId.value
  if (!id) return false
  return !workflowInstrumentedForMetric(id, selectedMetric.value)
})

// Weekly points for the effective workflow + selected metric.
const effectiveWeeklyPoints = computed(() => {
  const series = effectiveWorkflowSeries.value
  const pointField = resolveTimeSeriesPointField(selectedMetric.value)
  if (!series || !pointField) return [] as ReturnType<typeof extractWeeklyPoints>
  return extractWeeklyPoints(series, pointField)
})

// Latest two COMPLETE weeks comparison (current partial week excluded).
// Only valid when the canonical response used weekly buckets — a daily series
// has no "complete weeks" to compare, so report insufficient data rather than
// comparing two adjacent days as if they were weeks.
const completeWeekComparison = computed(() => {
  if (canonicalMetadata.value?.period !== 'week') {
    return {
      latestValue: null,
      previousValue: null,
      latestSessions: 0,
      previousSessions: 0,
      absoluteDelta: null,
      percentDelta: null,
      hasEnoughData: false,
    }
  }
  return compareCompleteWeeks(effectiveWeeklyPoints.value)
})

// Does the chart include the current (partial) week?
// Checks both single-workflow points and compare-mode line graph data
// so the partial-week label renders in ALL view modes.
const chartIncludesCurrentPartialWeek = computed(() => {
  // Single-workflow mode: check effective weekly points
  const pts = effectiveWeeklyPoints.value
  if (pts.length > 0) {
    const last = pts[pts.length - 1]
    if (isCurrentWeekPartial(last.t)) return true
  }
  // Compare mode (or single): check decisionSeriesLineGraphData points
  const chartData = decisionSeriesLineGraphData.value
  if (chartData && chartData.length > 0) {
    for (const series of chartData) {
      if (!series.data || !Array.isArray(series.data)) continue
      const finitePts = series.data.filter(d => d && d.x)
      if (finitePts.length > 0) {
        const last = finitePts[finitePts.length - 1]
        if (last.x && isCurrentWeekPartial(last.x)) return true
      }
    }
  }
  return false
})

// CR-X (C): Current partial-period truth label.
// Surfaces the distinction between PERIOD KEY (week-start bucket) and
// DATA THROUGH (latest observed telemetry timestamp from canonical metadata).
// Uses latestObservedAt from the canonical API response, NOT the bucket
// timestamp, so Sep 1-3 telemetry inside the Aug 31 weekly bucket is
// truthfully represented as "Data through Sep 3".
const currentPartialPeriodLabel = computed(() => {
  if (!chartIncludesCurrentPartialWeek.value) return null

  // Latest observed from canonical metadata, then the chart data itself.
  let latestObserved: string | null = latestObservedAt.value ?? null
  if (!latestObserved) {
    const allTimestamps: string[] = []
    const pts = effectiveWeeklyPoints.value
    if (pts.length > 0) {
      for (const p of pts) { if (p?.t) allTimestamps.push(p.t) }
    }
    const chartData = decisionSeriesLineGraphData.value
    if (chartData && chartData.length > 0) {
      for (const series of chartData) {
        if (!series?.data || !Array.isArray(series.data)) continue
        for (const d of series.data) { if (d?.x) allTimestamps.push(d.x) }
      }
    }
    if (allTimestamps.length > 0) {
      latestObserved = allTimestamps.sort().reverse()[0]
    }
  }

  if (!latestObserved) return null

  // Robust date parse: handle 'YYYY-MM-DD HH:MM:SS' (backend) and ISO formats
  const parseObservedDate = (s: string): Date | null => {
    const iso = s.replace(' ', 'T')
    const d = new Date(iso)
    return isNaN(d.getTime()) ? null : d
  }

  const rawDate = parseObservedDate(latestObserved)
  if (!rawDate) return null

  // Clamp to the current browser-local calendar day; never project a future
  // observed-through date.  CR-X P0 microfix: the previous code used
  // `now.setUTCHours(0,0,0,0)` which produces UTC midnight.  At e.g. 8pm EDT
  // on Sep 6, UTC midnight is already Sep 7, so a latest_observed_at of
  // Sep 7 00:05Z would NOT be clamped and the label would wrongly show
  // "Data through Sep 7" while the customer's local calendar date is Sep 6.
  // Fix: compute the browser-local calendar date and compare against that.
  const now = new Date()
  const localTodayUTC = new Date(`${localDateISO(now)}T00:00:00.000Z`)
  const latestDay = new Date(rawDate)
  latestDay.setUTCHours(0, 0, 0, 0)
  if (latestDay.getTime() > localTodayUTC.getTime()) {
    latestDay.setTime(localTodayUTC.getTime())
  }

  // The current week starts on the Monday of the latest-evidence week.
  const currentWeekStart = weekStartISO(latestDay)
  const weekStart = new Date(`${currentWeekStart}T00:00:00Z`)

  const weekStartLabel = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const latestLabel = latestDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

  return {
    range: `${weekStartLabel} – ${latestLabel}`,
    label: 'Current week',
    status: 'Partial',
    dataThrough: latestDay.toISOString(),
  }
})

// Scope summary line shown above the chart.
const scopeSummaryLine = computed(() => {
  const metricLabel = selectedMetricLabel.value
  const timeRangeLabel = timeWindowLabel.value
  const repoLabel = selectedRepo.value
    ? (availableRepos.value.find(r => r.id === selectedRepo.value)?.label || repoDisplayLabel(selectedRepo.value))
    : 'All repos'

  if (isCompareMode.value) {
    const eligible = eligibleWorkflowsForMetric.value
    if (eligible.length === 0) return ''
    const workflowLabel = `${eligible.length} workflow${eligible.length > 1 ? 's' : ''}`
    const sessions = eligible.reduce((sum, w) => sum + w.sessions, 0)
    return buildScopeSummary({ workflowLabel, metricLabel, timeRangeLabel, repoLabel, sessionCount: sessions })
  }

  const id = effectiveWorkflowId.value
  if (!id) return ''
  const workflowLabel = getCanonicalWorkflowIdentity(id)
  const sessions = selectedWorkflowPopulation.value
  const summary = buildScopeSummary({ workflowLabel, metricLabel, timeRangeLabel, repoLabel, sessionCount: sessions })
  return `${summary} · ${developerAttributedSessions.value.toLocaleString()}/${sessions.toLocaleString()} developer-attributed`
})

// Neutral "what changed" summary shown above/below the chart.
const whatChangedSummary = computed(() => {
  if (metricNotInstrumentedForWorkflow.value) {
    return 'Not instrumented for this workflow.'
  }
  if (isCompareMode.value) {
    const eligible = eligibleWorkflowsForMetric.value
    if (eligible.length === 0) return 'No workflows instrumented for this metric.'
    return `Comparing ${eligible.length} workflow${eligible.length > 1 ? 's' : ''} for ${selectedMetricLabel.value}.`
  }
  const metricLabel = selectedMetricLabel.value
  return buildWhatChangedSummary(
    metricLabel,
    completeWeekComparison.value,
    (v: number) => formatMetricValue(v, selectedMetric.value)
  )
})

// Time-series chart data for the Time Series view.
// Compare mode: all eligible instrumented workflows overlaid.
// Single-workflow mode: only the selected workflow.
const decisionSeriesLineGraphData = computed(() => {
  if (metricNotInstrumentedForWorkflow.value) return []
  const pointField = resolveTimeSeriesPointField(selectedMetric.value)
  if (!pointField) return []

  // CR-X R2: Delivery metrics — render a single org/repo-level delivery series.
  // Do NOT render per-workflow lines (org delivery is not workflow-attributed).
  // If developer-filtered, suppress entirely (fail closed).
  if (isDeliveryMetric.value) {
    if (deliveryMetricSuppressed.value) return [] // fail closed for developer filter
    const ds = deliverySeries.value
    if (!ds || !ds.points || !Array.isArray(ds.points)) return []
    const points = ds.points.map(p => {
      const raw = p?.[pointField]
      const y = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
      return { x: p?.t, y }
    })
    if (!points.some(d => d.y !== null && Number.isFinite(d.y))) return []
    return [{
      label: deliverySeriesLabel.value,
      data: points,
      borderColor: '#2563eb',
      backgroundColor: '#2563eb20',
      fill: false,
      tension: 0.3,
    }]
  }

  const data = timeSeriesDataWithFallback.value.data
  if (!data || !Array.isArray(data)) return []

  const palette = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2']

  if (isCompareMode.value) {
    const eligible = eligibleWorkflowsForMetric.value
    const result: any[] = []
    eligible.forEach((w, idx) => {
      const series = data.find(s => s && s.label === w.id)
      if (!series || !series.points || !Array.isArray(series.points)) return
      const color = palette[idx % palette.length]
      const points = series.points.map(p => {
        const raw = p?.[pointField]
        const y = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
        return { x: p?.t, y }
      })
      if (points.some(d => d.y !== null && Number.isFinite(d.y))) {
        result.push({
          label: getCanonicalWorkflowIdentity(w.id),
          data: points,
          borderColor: color,
          backgroundColor: `${color}20`,
          fill: false,
          tension: 0.3,
        })
      }
    })
    return result
  }

  const result: any[] = []
  authoritativeDeveloperSeries.value.forEach((series, idx) => {
    if (!series.points || !Array.isArray(series.points)) return
    const color = palette[idx % palette.length]
    const points = series.points.map(p => {
      const raw = p?.[pointField]
      const y = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
      return { x: p?.t, y }
    })
    if (!points.some(d => d.y !== null && Number.isFinite(d.y))) return
    result.push({
      label: series.label,
      data: points,
      borderColor: color,
      backgroundColor: `${color}20`,
      fill: false,
      tension: 0.3,
    })
  })
  return result
})

// Transform time series data to chart format (same as Classic lineGraphData)
const lineGraphData = computed(() => {
  try {
    const dataSource = timeSeriesDataWithFallback.value.data
    
    if (!dataSource || !Array.isArray(dataSource) || dataSource.length === 0) {
      return []
    }
    
    // 🔥 AUDIT: Log period counts before lineGraphData transformation
    const periodsByToolBeforeTransform = new Map()
    const allTimestampsBeforeTransform = new Set()
    dataSource.forEach(series => {
      if (series && series.points && Array.isArray(series.points)) {
        periodsByToolBeforeTransform.set(series.label, series.points.length)
        series.points.forEach(point => {
          if (point && point.t) {
            allTimestampsBeforeTransform.add(point.t)
          }
        })
      }
    })
    if (PBT_DEBUG) console.log('[AUDIT:LINE_GRAPH_DATA_BEFORE_TRANSFORM]', {
      seriesCount: dataSource.length,
      periodsByTool: Object.fromEntries(periodsByToolBeforeTransform),
      totalPeriods: Array.from(periodsByToolBeforeTransform.values()).reduce((sum, count) => sum + count, 0),
      uniqueTimestampsCount: allTimestampsBeforeTransform.size,
      uniqueTimestamps: Array.from(allTimestampsBeforeTransform).sort()
    })
    
    // 🔥 DEDUPE: Canonicalize and deduplicate workflows before transformation
    // Preserve Devin and Windsurf as distinct workflows; canonicalize by tool identity only
    const canonicalSeriesMap = new Map()
    
    dataSource.forEach((series) => {
      if (!series || !series.label || !series.points || !Array.isArray(series.points)) {
        return
      }
      
      // Get canonical label based on comparison mode
      let canonicalLabel = series.label
      if (selectedComparisonMode.value === 'workflows') {
        canonicalLabel = getCanonicalWorkflowIdentity(series.label)
      } else if (selectedComparisonMode.value === 'ides') {
        canonicalLabel = getCanonicalEntityLabel(series.label, 'ides')
      } else if (selectedComparisonMode.value === 'models') {
        const modelId = IDE_TO_MODEL_MAP[series.label.toLowerCase()]
        canonicalLabel = modelId ? getCanonicalEntityLabel(modelId, 'models') : series.label
      }
      
      // Calculate metrics for deduplication decision
      const sessionCount = series.points?.length || 0
      const telemetryPointCount = series.points?.length || 0
      
      // Check if canonical label already exists
      if (canonicalSeriesMap.has(canonicalLabel)) {
        const existing = canonicalSeriesMap.get(canonicalLabel)
        const byTs = new Map()
        existing.points?.forEach(p => { if (p?.t) byTs.set(p.t, p) })
        for (const p of (series.points || [])) {
          if (!p?.t) continue
          const ex = byTs.get(p.t)
          if (!ex) { byTs.set(p.t, p); continue }
          const merged = { ...ex }
          for (const k of Object.keys(p)) {
            if (k !== 't' && ex[k] == null && p[k] != null) merged[k] = p[k]
          }
          byTs.set(p.t, merged)
        }
        existing.points = Array.from(byTs.values()).sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
      } else {
        canonicalSeriesMap.set(canonicalLabel, series)
      }
    })
    
    // Transform canonical series to chart.js format
    const canonicalSeries = Array.from(canonicalSeriesMap.values())
    
    // 🔥 NEW: Map metric ID to point field for instant switching
    const metricId = filterStore.productivityFilters?.productivityMetricId || 'ide.ai_suggestions_accepted'
    const pointField = resolveTimeSeriesPointField(metricId)
    if (!pointField) return []

    const selectedMetricKey = selectedMetric.value

    const transformed = canonicalSeries
      .filter((series) => workflowInstrumentedForMetric(series.label, selectedMetricKey))
      .map((series, index) => {
      const colorMap = ['#2563eb', '#4f46e5', '#0891b2', '#475569', '#5c5247', '#44403c']
      const color = colorMap[index % colorMap.length]
      
      // Use canonical label based on comparison mode to match cards
      let label = series.label
      if (selectedComparisonMode.value === 'workflows') {
        label = getCanonicalWorkflowIdentity(series.label)
      } else if (selectedComparisonMode.value === 'ides') {
        label = getCanonicalEntityLabel(series.label, 'ides')
      } else if (selectedComparisonMode.value === 'models') {
        const modelId = IDE_TO_MODEL_MAP[series.label.toLowerCase()]
        label = modelId ? getCanonicalEntityLabel(modelId, 'models') : series.label
      }
      
      const data = series.points.map(point => {
        const raw = point[pointField]
        const y = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
        return { x: point.t, y }
      })

      const hasFiniteData = data.some(d => d.y !== null && Number.isFinite(d.y))
      if (!hasFiniteData) return null

      return {
        label,
        data,
        borderColor: color,
        backgroundColor: `${color}20`,
        fill: false,
        tension: 0.3
      }
    }).filter(Boolean)
    
    return transformed
  } catch (error) {
    return []
  }
})

// Use shared utility for card generation (same as Classic)
const ideMetricCards = computed(() => {
  // PERF: Start timing
  const start = performance.now()
  ideMetricCardsRerenderCount++

  try {
    const dataSource = timeSeriesDataWithFallback.value.data

    // Use shared utility for card generation
    // Match Classic's implementation: use filter store's metric ID
    const activeMetricId = filterStore.productivityFilters?.productivityMetricId || 'ide.ai_suggestions_accepted'
    const cards = generateMetricCards({
      dataSource,
      activeMetricId,
      comparisonMode: selectedComparisonMode.value,
      selectedMetric: selectedMetric.value,
      getCanonicalEntityLabel,
      getCanonicalWorkflowIdentity
    })

    // Debug logging for card validation
    if (PBT_DEBUG) {
      console.info('[ProductivityByToolV3] IDE METRIC CARDS GENERATED:', {
        activeMetricId,
        selectedMetric: selectedMetric.value,
        cardCount: cards.length,
        cardValues: cards.map(c => ({
          ide: c.ide,
          value: c.value, 
        sessionCount: c.sessionCount || 0,
        activeCodingMinutes: c.activeCodingMinutes || 0,
        rawToolId: c.rawToolId
      })),
      dataSourceReceived: dataSource ? `${dataSource.length} series` : 'null',
      dataSourceLabels: dataSource?.map(s => s.label) || []
    })

    // Write to console for programmatic inspection
    try {
      const debugData = {
        stage: 'ideMetricCards-output',
        timestamp: new Date().toISOString(),
        output: {
          cardCount: cards.length,
          cardValues: cards.map(c => ({ ide: c.ide, value: c.value, sessionCount: c.telemetryPointCount || c.totalPointCount || 0 })),
          dataSourceReceived: dataSource ? `${dataSource.length} series` : 'null',
          dataSourceLabels: dataSource?.map(s => s.label) || []
        }
      }
      if (PBT_DEBUG) console.log('[PIPELINE-LOG]', JSON.stringify(debugData))
    } catch (e) {
      // Ignore logging errors
    }
    }

    const end = performance.now()
    const duration = end - start
    if (PBT_DEBUG) console.log(`[PERF] ideMetricCards Computed | ${duration.toFixed(2)}ms | ${ideMetricCardsRerenderCount} | ${cards.length} cards`)

    return cards
  } catch (error) {
    return []
  }
})

// ── COST/ROI HELPER FUNCTIONS ─────────────────────────────────────────────

// CR-X ECON-1: Authority-aware cost config lookup.
// Reads from pbtCostConfigs (backend-resolved), which already handles
// backend_persisted / backend_empty / backend_unavailable (localStorage fallback).
function getResolvedCostConfig(toolId: string): any | null {
  const normalized = normalizeCostToolId(toolId)
  const config = pbtCostConfigs.value.find(c => c.toolId === normalized)
  return config || null
}

// 🔥 Sprint 2F-B: Canonical cost resolver for cards
// Tries multiple identity candidates and returns the first one with configured cost
function resolveCostToolIdForCard(card: any): string {
  const candidates = [
    card?.rawToolId,
    card?.id,
    card?.ide,
    card?.name,
    typeof card?.name === 'string' ? card.name.replace(/\s+workflow$/i, '') : null
  ].filter(Boolean)

  for (const candidate of candidates) {
    const normalized = normalizeCostToolId(String(candidate))
    const config = getResolvedCostConfig(normalized)
    if (config && config.monthlySpend > 0) {
      return normalized
    }
  }

  return normalizeCostToolId(String(candidates[0] || ''))
}

// 🔥 Sprint 2F-B: Get monthly cost for a card using canonical resolver
function getMonthlyCostForCard(card: any): number | null {
  const resolvedToolId = resolveCostToolIdForCard(card)
  const config = getResolvedCostConfig(resolvedToolId)
  if (!config || config.monthlySpend <= 0) return null
  return config.monthlySpend
}

// ── Developer-allocated monthly cost for a card ──────────────────────────
//
// When a developer is selected, card cost must use the seat-style allocation
// (configuredMonthlySpend / eligibleDevelopers), NOT the full workflow
// configured spend. Workflows the developer does not use have no allocation
// entry, so this returns null and the card shows "No cost data" — we never
// invent spend for unused workflows.
//
// Match is by cost-tool id (windsurf → devin shared bucket), mirroring
// developerWorkflowAllocations.
function getAllocatedMonthlyCostForCard(card: any): number | null {
  if (!isDeveloperFiltered.value) return null
  const resolvedToolId = resolveCostToolIdForCard(card)
  const alloc = developerWorkflowAllocations.value.find(a => a.costToolId === resolvedToolId)
  if (!alloc || alloc.allocatedMonthly <= 0) return null
  return alloc.allocatedMonthly
}

// 🔥 P1: Get monthly cost for IDE
// CR-X ECON-1: Uses authority-aware getResolvedCostConfig (not localStorage)
// Uses normalizeCostToolId to ensure Devin and Windsurf share the same cost bucket
function getIDEMonthlyCost(ide: string): number | null {
  const config = getResolvedCostConfig(ide)
  if (!config || config.monthlySpend <= 0) return null
  return config.monthlySpend
}

// 🔥 P1: Compute cost per active session
// Formula: configured monthly spend / observed sessions in selected window
function computeCostPerActiveSession(ide: string, sessionCount: number): string {
  const monthlyCost = getIDEMonthlyCost(ide)
  if (!monthlyCost || sessionCount === 0) return 'Needs more data'
  const costPerSession = monthlyCost / sessionCount
  return `$${costPerSession.toFixed(2)}`
}

// 🔥 P1: Compute cost per active coding hour
// Formula: configured monthly spend / active coding hours in selected window
function computeCostPerActiveCodingHour(ide: string, activeCodingMinutes: number): string {
  const monthlyCost = getIDEMonthlyCost(ide)
  if (!monthlyCost || activeCodingMinutes === 0) return 'Needs more data'
  const activeCodingHours = activeCodingMinutes / 60
  const costPerHour = monthlyCost / activeCodingHours
  return `$${costPerHour.toFixed(2)}`
}

// 🔥 P1: Compute cost per AI suggestion
function computeCostPerAISuggestion(ide: string, aiSuggestions: number): string {
  const monthlyCost = getIDEMonthlyCost(ide)
  if (!monthlyCost || aiSuggestions === 0) return 'Needs more data'
  const costPerSuggestion = monthlyCost / aiSuggestions
  return `$${costPerSuggestion.toFixed(2)}`
}

// 🔥 P1: Get cost efficiency label
function getCostEfficiencyLabel(ide: string, sessionCount: number): string {
  const monthlyCost = getIDEMonthlyCost(ide)
  if (!monthlyCost) return 'Cost data not configured'
  if (sessionCount === 0) return 'No usage data'
  
  const costPerSession = monthlyCost / sessionCount
  if (costPerSession < 1) return 'Excellent'
  if (costPerSession < 2) return 'Good'
  if (costPerSession < 5) return 'Fair'
  return 'Review'
}

// 🔥 P3: Cost layer label
const costLayerLabel = computed(() => {
  const labels: Record<string, string> = {
    'off': 'Off',
    'monthly': 'Monthly Spend',
    'efficiency': 'Cost Efficiency',
    'per_session': 'Spend / Session',
    'per_hour': 'Spend / Active-Coding Hour (additive)',
    'per_wallclock': 'Spend / Session-Hour (additive)',
    'cost_adjusted': 'Output / $100'
  }
  return labels[selectedCostLayer.value] || 'Off'
})

// 🔥 P3: Get cost layer value for a card (accepts card object directly)
function getCostLayerValue(card: any, layer: string): string {
  if (!card) return 'Needs more data'

  const sessionCount = card.sessionCount || 0
  const monthlyCost = getMonthlyCostForCard(card)

  if (!monthlyCost) return '—'

  if (layer === 'monthly') {
    return `$${monthlyCost.toFixed(2)}`
  } else if (layer === 'efficiency') {
    if (sessionCount === 0) return 'No usage'
    // Use canonical cost path: compute efficiency from monthlyCost directly
    const costPerSession = monthlyCost / sessionCount
    if (costPerSession < 1) return 'Excellent'
    if (costPerSession < 2) return 'Good'
    if (costPerSession < 5) return 'Fair'
    return 'Review'
  } else if (layer === 'per_session') {
    if (sessionCount === 0) return 'Configured, no usage'
    const costPerSession = monthlyCost / sessionCount
    return `$${costPerSession.toFixed(2)}`
  } else if (layer === 'per_hour') {
    // CR-X 1B.1: Active-coding hour is unavailable for terminal-based workflows
    // (Claude Code) per surfaceAgentContract. Even if the DB has a value, the
    // contract is authority. Show "Not instrumented" instead of a fake value.
    const activeCodingMinutes = card.activeCodingMinutes || 0
    if (!isMetricInstrumentedForWorkflow(card.ide || card.label || '', 'active_coding_time_minutes')) {
      return 'Not instrumented'
    }
    if (activeCodingMinutes === 0) return 'Configured, no usage'
    const activeCodingHours = activeCodingMinutes / 60
    const costPerHour = monthlyCost / activeCodingHours
    return `$${costPerHour.toFixed(2)}`
  } else if (layer === 'per_wallclock') {
    // CR-X Tranche 1B: Session-hour (additive) — uses Σ(session duration_ms),
    // NOT true wall-clock union. This is additive: concurrent sessions are
    // double-counted. The label was previously "Wall-Clock Hour" which was
    // misleading. For true wall-clock union, see intervalUnion.ts
    // computeConcurrency().unique_session_wall_clock_span_ms.
    const sessionMinutes = card.totalMinutes || card.sessionMinutes || 0
    if (sessionMinutes === 0) return 'Configured, no usage'
    const sessionHours = sessionMinutes / 60
    const costPerHour = monthlyCost / sessionHours
    return `$${costPerHour.toFixed(2)}`
  } else if (layer === 'cost_adjusted') {
    const metricValue = card.value || 0
    if (metricValue === 0) return '—'

    // Check metric polarity
    const polarity = METRIC_POLARITY[selectedMetric.value]
    if (!polarity) return '—'

    // Only support higher-is-better output/count metrics
    if (polarity !== 'higher') return '—'

    // Safe metrics for cost adjustment
    const safeMetrics = ['ai_suggestions_accepted', 'commits_per_session', 'files_edited_per_session']
    if (!safeMetrics.includes(selectedMetric.value)) return '—'

    // Show metric per $100 spend consistently
    const costPer100 = monthlyCost / 100
    if (costPer100 > 0 && metricValue / costPer100 > 0.1) {
      return `${(metricValue / costPer100).toFixed(2)} / $100`
    } else {
      return `<0.1 / $100`
    }
  }

  return 'Needs more data'
}

// Helper: Extract average of a specific metric from a time series
// Tries multiple field names to find the metric in point data
function extractMetricAverageFromSeries(series: any, fieldNames: string[]): number | null {
  if (!series || !series.points || !Array.isArray(series.points) || series.points.length === 0) {
    return null
  }
  const validValues: number[] = []
  series.points.forEach((p: any) => {
    for (const field of fieldNames) {
      if (p[field] !== undefined && p[field] !== null && typeof p[field] === 'number' && Number.isFinite(p[field])) {
        validValues.push(p[field])
        break
      }
    }
  })
  if (validValues.length === 0) return null
  return validValues.reduce((a, b) => a + b, 0) / validValues.length
}

// ── V3 CARD TRANSFORMATION (Presentation layer only - no new logic) ─────────

// Transform Classic card data to V3 card structure (purely visual transformation)
const v3Cards = computed(() => {
  // PERF: Start timing
  const start = performance.now()
  v3CardsRerenderCount++

  const classicCards = ideMetricCards.value
  if (!classicCards || classicCards.length === 0) return []

  // 🔥 P0 FIX: Show all 5 real canonical workflows (no 25-session filter)
  // Low-sample workflows (< 25 sessions) are labeled as "Emerging" but remain visible
  // Per Productivity V3 data contract: preserve all 5 real workflows
  const allCards = classicCards.filter(c =>
    workflowInstrumentedForMetric(c.rawToolId || c.ide, selectedMetric.value)
  )
  
  // Classify as primary vs emerging for labeling only (not filtering)
  const primaryCards = allCards.filter(c => isPrimaryCardEligible(c))
  const emergingCards = allCards.filter(c => !isPrimaryCardEligible(c))
  
  if (PBT_DEBUG) console.log('[AUDIT:V3_CARDS_CLASSIFICATION]', {
    totalCards: allCards.length,
    primaryCardsCount: primaryCards.length,
    emergingCardsCount: emergingCards.length,
    primaryCards: primaryCards.map(c => ({ ide: c.ide, sessionCount: c.sessionCount })),
    emergingCards: emergingCards.map(c => ({ ide: c.ide, sessionCount: c.sessionCount }))
  })

  // 🔥 Sprint 2F: Primary workflows first, then emerging workflows
  // Within each group, sort by sessionCount descending
  const sortedCards = [
    ...primaryCards.sort((a, b) => (b.sessionCount || 0) - (a.sessionCount || 0)),
    ...emergingCards.sort((a, b) => (b.sessionCount || 0) - (a.sessionCount || 0))
  ]

  // Map Classic card structure to V3 card structure
  // This is purely structural transformation - no new calculations
  // Use sortedCards (primary first, then emerging) to preserve all 5 workflows
  const result = sortedCards.map(card => {
    // Determine if card is primary or emerging for labeling
    const isPrimary = isPrimaryCardEligible(card)
    const sampleLabel = isPrimary ? 'Primary' : 'Emerging'
    
    // Filter cards by mode to match hero logic (ensures consistency)
    let modeFilteredCards = classicCards
    if (selectedComparisonMode.value === 'ides') {
      // 🔥 P0: Use canonical workflow universe constant
      modeFilteredCards = classicCards.filter(c => {
        const ideId = c.ide.toLowerCase()
        return ALL_SUPPORTED_IDES.includes(ideId as any)
      })
    } else if (selectedComparisonMode.value === 'models') {
      // Aggregate by model for consistency with hero
      const modelValues: Record<string, number> = {}
      classicCards.forEach(c => {
        const ideId = c.ide.toLowerCase()
        const modelId = IDE_TO_MODEL_MAP[ideId]
        if (modelId && c.value !== null) {
          if (!modelValues[modelId]) modelValues[modelId] = 0
          modelValues[modelId] += c.value
        }
      })
      modeFilteredCards = Object.entries(modelValues).map(([modelId, value]) => ({
        ide: modelId,
        value,
        hasValue: true
      }))
    }
    // Workflow mode uses all cards (no filtering)
    
    // Determine leader/laggard status using polarity-aware logic on mode-filtered cards
    const leader = determineLeader(modeFilteredCards, selectedMetric.value)
    const laggard = determineLaggard(modeFilteredCards, selectedMetric.value)
    
    // For model mode, need to check if card's model matches leader/laggard
    let isLeader = false
    let isLaggard = false
    if (selectedComparisonMode.value === 'models') {
      const cardModelId = IDE_TO_MODEL_MAP[card.ide.toLowerCase()]
      isLeader = leader && leader.ide === cardModelId
      isLaggard = laggard && laggard.ide === cardModelId
    } else {
      isLeader = leader && leader.ide === card.ide
      isLaggard = laggard && laggard.ide === card.ide
    }
    
    // Get icon from Classic's entity mapping
    const iconMap: Record<string, string> = {
      'cursor': 'bi-cursor',
      'windsurf': 'bi-wind',
      'vscode': 'bi-code-square',
      'jetbrains': 'bi-journal-code',
      'sublime': 'bi-file-code',
      'vim': 'bi-terminal',
      'sonnet': 'bi-cpu',
      'gpt': 'bi-lightning',
      'swe': 'bi-robot',
      'opus': 'bi-stars',
      'gemini': 'bi-gem'
    }
    
    const icon = iconMap[card.ide.toLowerCase()] || 'bi-box'
    
    // Get type based on comparison mode
    const type = selectedComparisonMode.value === 'workflows' ? 'Workflow' : 
                 selectedComparisonMode.value === 'ides' ? 'IDE' : 'AI Model'
    
    // Get canonical name based on type
    let name = card.ide
    if (type === 'Workflow') {
      name = getCanonicalWorkflowIdentity(card.ide)
    } else if (type === 'IDE') {
      name = getCanonicalEntityLabel(card.ide, 'ides')
    } else if (type === 'AI Model') {
      const modelId = IDE_TO_MODEL_MAP[card.ide.toLowerCase()]
      name = modelId ? getCanonicalEntityLabel(modelId, 'models') : card.ide
    }
    
    // Get session count from Classic data
    const sessionCount = card.sessionCount || 0
    
    // 🔥 P0 FIX: Never label workflows with canonical telemetry as "Demo data"
    // If a workflow has telemetryPointCount > 0, it has canonical telemetry
    // Use accurate session count label based on actual data
    let sessionCountLabel: string
    if (card.usesTelemetry && sessionCount > 0) {
      // Real telemetry from canonical aggregated endpoint
      sessionCountLabel = `${sessionCount} sessions`
    } else {
      // No telemetry data available
      sessionCountLabel = 'Needs more data'
    }
    
    // Find the original series to extract trend data for sparkline
    const originalSeries = timeSeriesDataWithFallback.value.data?.find((s: any) => 
      s.label === card.ide || s.label === card.ide.toLowerCase()
    )
    
    // Extract sparkline data from series points
    let sparklineData: number[] = []

    if (originalSeries && originalSeries.points && Array.isArray(originalSeries.points) && card.availability === 'available') {
      sparklineData = originalSeries.points
        .map((p: any) => {
          const value = getPointMetricValue(p, selectedMetric.value)
          return value !== null && Number.isFinite(value) ? value : null
        })
        .filter((v: number | null): v is number => v !== null && Number.isFinite(v))
    }
    
    // PRODUCT CONTRACT: Use historical average for display value (not latest snapshot)
    // card.value now contains historical average from productivityCards.ts
    const headlineValue = card.value
    const hasSessions = sessionCount > 0

    const displayValue = card.availability === 'not_instrumented'
      ? 'Not instrumented'
      : card.availability === 'no_data'
        ? 'Needs more data'
        : formatMetricValue(headlineValue, selectedMetric.value)

    // Calculate from sparkline data for supporting metrics (with NaN/Infinity guards)
    const validSparkline = sparklineData.filter((v: number) => Number.isFinite(v))
    const avgValue = validSparkline.length > 0 
      ? validSparkline.reduce((a, b) => a + b, 0) / validSparkline.length 
      : 0
    const maxValue = validSparkline.length > 0 ? Math.max(...validSparkline) : 0
    
    // Contextual label beneath primary value.
    // The sparkline point count equals the number of populated buckets — its
    // unit is the canonical response granularity ('week' or 'day'), not always
    // weeks. Label the observed window truthfully: weekly buckets count as
    // weeks; daily buckets describe the observed span they cover.
    const seriesTs = (originalSeries?.points || [])
      .map((p: any) => new Date(p?.t).getTime())
      .filter((t: number) => Number.isFinite(t))
    const observedSpanDays = seriesTs.length > 0
      ? Math.round((Math.max(...seriesTs) - Math.min(...seriesTs)) / 86400000) + 1
      : 0
    const bucketIsDaily = canonicalMetadata.value?.period === 'day'
    const observedWindowLabel = (() => {
      if (bucketIsDaily) {
        if (observedSpanDays <= 0) return null
        if (observedSpanDays < 14) return `last ${observedSpanDays} day${observedSpanDays === 1 ? '' : 's'}`
        const weeks = Math.max(1, Math.round(observedSpanDays / 7))
        return `last ${weeks} week${weeks === 1 ? '' : 's'}`
      }
      const weeks = sparklineData.length
      return `last ${weeks} week${weeks === 1 ? '' : 's'}`
    })()
    const contextLabel = card.availability === 'not_instrumented'
      ? 'Metric unavailable for this workflow'
      : card.availability === 'no_data'
        ? 'Needs more data'
        : sparklineData.length > 0 && observedWindowLabel
          ? `Average (${observedWindowLabel})`
          : card.sessionCount > 0
            ? 'Average, last 4 weeks'
            : 'Needs more data'
    
    // Build contextual supporting metrics with cross-metric context for executives
    let supportingMetrics = []
    
    // Get WoW trend for primary metric (only when available)
    const trend = card.availability === 'available' ? getTrendData(card.ide, selectedMetric.value) : null
    const trendDirection = trend !== null && !isNaN(trend) ? (trend > 0 ? 'up' : trend < 0 ? 'down' : 'neutral') : 'neutral'
    const trendValue = trend !== null && !isNaN(trend) ? `${trend > 0 ? '+' : ''}${trend.toFixed(0)}% WoW` : ''
    
    // 1. Sessions (sample size)
    const isLowSample = sessionCount < 25 && sessionCount > 0
    supportingMetrics.push({
      label: 'Sessions',
      value: `${sessionCount} (${sampleLabel})`,
      trend: 'neutral',
      trendClass: '',
      isFallback: false,
      isLowSample
    })

    // 2. Trend (only when metric is available)
    // CR-X FINAL: For emerging/low-sample workflows (< 25 sessions), do NOT present
    // red/green directional trend with mature-workflow visual authority.
    // Either suppress trend entirely or label it explicitly as low-sample/directional.
    // Preserve the underlying observed values — change presentation eligibility only.
    if (trendValue && card.availability === 'available') {
      if (isLowSample) {
        // Emerging sample: show trend value but neutral styling + low-sample flag
        supportingMetrics.push({
          label: 'Trend (emerging)',
          value: trendValue,
          trend: 'neutral', // No directional arrow for low-sample
          trendClass: '', // No v3-up/v3-down color
          isLowSample: true,
        })
      } else {
        // Mature workflow: show directional trend with color
        supportingMetrics.push({
          label: 'Trend',
          value: trendValue,
          trend: trendDirection,
          trendClass: trendDirection === 'up' ? 'v3-up' : trendDirection === 'down' ? 'v3-down' : ''
        })
      }
    }

    // 3. Historical average and Peak from sparkline (only when available)
    // CR5 V1: Label truthfully as "Hist. avg" to avoid contradicting the
    // headline "Average (last N weeks)" label. The arrow shows whether the
    // current headline is above or below this historical sparkline average.
    if (card.availability !== 'available') {
      supportingMetrics.push({
        label: 'Hist. avg',
        value: '—',
        trend: 'neutral',
        trendClass: ''
      })
      supportingMetrics.push({
        label: 'Peak',
        value: '—',
        trend: 'neutral',
        trendClass: ''
      })
    } else if (validSparkline.length > 0) {
      const isRateMetric = selectedMetric.value.includes('rate') || selectedMetric.value.includes('percent')

      supportingMetrics.push({
        label: 'Hist. avg',
        value: formatMetricValue(avgValue, selectedMetric.value),
        trend: avgValue > headlineValue ? 'down' : avgValue < headlineValue ? 'up' : 'neutral',
        trendClass: avgValue > headlineValue ? 'v3-down' : avgValue < headlineValue ? 'v3-up' : ''
      })

      if (!isRateMetric && Number.isFinite(maxValue)) {
        supportingMetrics.push({
          label: 'Peak',
          value: formatMetricValue(maxValue, selectedMetric.value),
          trend: 'neutral',
          trendClass: ''
        })
      }
    }
    
    // 🔥 P0-C: EVERY card must show exactly one cost row when cost layer is active.
    // When All Developers: use full workflow configured spend (unchanged).
    // When a developer is selected: use that developer's allocated monthly
    // workflow spend (configuredMonthlySpend / eligibleDevelopers), and divide
    // by that developer's observed session count for the workflow.
    // NEVER divide full workflow configured spend by one developer's sessions,
    // and never invent spend for workflows the developer does not use.
    // CR-X 2B.1: When a repo filter is active, suppress cost ratios entirely.
    // Org-global configured spend cannot be attributed to a specific repo.
    // Do not invent allocation formulas — suppress is correct.
    // CR-X Phase 3: When a developer filter is active, suppress per-session/per-hour
    // cost ratios. Configured spend is org/workflow-level, not developer-attributable.
    // Show "N/A — org-level" instead of misleading dollar ratios.
    if (selectedCostLayer.value !== 'off' && hasCostData.value && !isRepoFiltered.value && !isDeveloperFiltered.value) {
      const monthlyCost = getMonthlyCostForCard(card)
      const hasCost = monthlyCost && monthlyCost > 0

      if (selectedCostLayer.value === 'monthly') {
        supportingMetrics.push({
          label: 'Monthly Spend',
          value: hasCost ? `$${monthlyCost.toFixed(0)}/mo` : 'No cost data',
          trend: 'neutral',
          trendClass: '',
          isCost: true
        })
      } else if (selectedCostLayer.value === 'per_session') {
        if (!hasCost) {
          supportingMetrics.push({
            label: 'Spend / Session',
            value: 'No cost data',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else if (sessionCount === 0) {
          supportingMetrics.push({
            label: 'Spend / Session',
            value: 'Configured, no usage',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else {
          const costPerSession = monthlyCost / sessionCount
          supportingMetrics.push({
            label: 'Spend / Session',
            value: `$${costPerSession.toFixed(2)}`,
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        }
      } else if (selectedCostLayer.value === 'per_hour') {
        // CR-X 1B.1: Gate by instrumentation — terminal workflows cannot
        // observe active_coding_duration_ms per bridge contract
        const activeCodingMinutes = card.activeCodingMinutes || 0
        const isActiveCodingInstrumented = isMetricInstrumentedForWorkflow(card.ide || card.label || '', 'active_coding_time_minutes')
        if (!hasCost) {
          supportingMetrics.push({
            label: 'Spend / Active-Coding Hour (additive)',
            value: 'No cost data',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else if (!isActiveCodingInstrumented) {
          supportingMetrics.push({
            label: 'Spend / Active-Coding Hour (additive)',
            value: 'Not instrumented',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else if (activeCodingMinutes === 0) {
          supportingMetrics.push({
            label: 'Spend / Active-Coding Hour (additive)',
            value: 'Configured, no usage',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else {
          const activeCodingHours = activeCodingMinutes / 60
          const costPerHour = monthlyCost / activeCodingHours
          supportingMetrics.push({
            label: 'Spend / Active-Coding Hour (additive)',
            value: `$${costPerHour.toFixed(2)}`,
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        }
      } else if (selectedCostLayer.value === 'per_wallclock') {
        // CR-X Tranche 1B: Session-hour (additive) cost layer
        const sessionMinutes = card.totalMinutes || card.sessionMinutes || 0
        if (!hasCost) {
          supportingMetrics.push({
            label: 'Spend / Session-Hour (additive)',
            value: 'No cost data',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else if (sessionMinutes === 0) {
          supportingMetrics.push({
            label: 'Spend / Session-Hour (additive)',
            value: 'Configured, no usage',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else {
          const sessionHours = sessionMinutes / 60
          const costPerHour = monthlyCost / sessionHours
          supportingMetrics.push({
            label: 'Spend / Session-Hour (additive)',
            value: `$${costPerHour.toFixed(2)}`,
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        }
      } else if (selectedCostLayer.value === 'cost_adjusted') {
        const metricValue = card.value || 0
        const polarity = METRIC_POLARITY[selectedMetric.value]
        const safeMetrics = ['ai_suggestions_accepted', 'commits_per_session', 'files_edited_per_session']

        if (!hasCost) {
          supportingMetrics.push({
            label: 'Output / $100',
            value: 'No cost data',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else if (polarity !== 'higher' || !safeMetrics.includes(selectedMetric.value)) {
          supportingMetrics.push({
            label: 'Est. Cost-adjusted',
            value: 'Not applicable',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else if (metricValue === 0) {
          supportingMetrics.push({
            label: 'Est. Cost-adjusted',
            value: 'No metric data',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else {
          const costPer100 = monthlyCost / 100
          if (costPer100 > 0 && metricValue / costPer100 > 0.1) {
            supportingMetrics.push({
              label: 'Output / $100',
              value: `${(metricValue / costPer100).toFixed(1)} / $100`,
              trend: 'neutral',
              trendClass: '',
              isCost: true
            })
          } else {
            supportingMetrics.push({
              label: 'Output / $100',
              value: `<0.1 / $100`,
              trend: 'neutral',
              trendClass: '',
              isCost: true
            })
          }
        }
      } else if (selectedCostLayer.value === 'efficiency') {
        if (!hasCost) {
          supportingMetrics.push({
            label: 'Est. Cost Efficiency',
            value: 'No cost data',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else {
          // Use canonical cost path: compute efficiency from monthlyCost directly
          const costPerSession = monthlyCost / sessionCount
          let costEfficiency = 'Fair'
          if (costPerSession < 1) costEfficiency = 'Excellent'
          else if (costPerSession < 2) costEfficiency = 'Good'
          else if (costPerSession < 5) costEfficiency = 'Fair'
          else costEfficiency = 'Review'
          supportingMetrics.push({
            label: 'Est. Cost Efficiency',
            value: costEfficiency,
            trend: 'neutral',
            trendClass: costEfficiency === 'Excellent' ? 'v3-up' : costEfficiency === 'Review' ? 'v3-down' : '',
            isCost: true
          })
        }
      }
    }

    // CR-X Gate A: When developer/repo-filtered, show ALLOCATED cost metrics
    // using the C6 per-bucket allocation formula with the authoritative org
    // population as the bucket denominator. This replaces the old N/A — org-level
    // blanket suppression with truthful allocated economics.
    if (selectedCostLayer.value !== 'off' && hasCostData.value && (isDeveloperFiltered.value || isRepoFiltered.value)) {
      const allocResult = getFilteredAllocatedCostForCard(card)
      const costLabel = selectedCostLayer.value === 'monthly' ? 'Allocated Monthly'
        : selectedCostLayer.value === 'per_session' ? 'Spend / Session'
        : selectedCostLayer.value === 'per_hour' ? 'Spend / Session-Hour'
        : selectedCostLayer.value === 'cost_adjusted' ? 'Output / $100'
        : 'Est. Cost Efficiency'

      if (!allocResult) {
        // No configured cost for this bucket, or no sessions in the scoped population
        supportingMetrics.push({
          label: costLabel,
          value: 'No cost data',
          trend: 'neutral',
          trendClass: '',
          isCost: true
        })
      } else if (selectedCostLayer.value === 'monthly') {
        supportingMetrics.push({
          label: 'Allocated Monthly',
          value: `$${allocResult.allocatedSpend.toFixed(0)}/mo`,
          trend: 'neutral',
          trendClass: '',
          isCost: true
        })
      } else if (selectedCostLayer.value === 'per_session') {
        if (sessionCount === 0) {
          supportingMetrics.push({
            label: 'Spend / Session',
            value: 'Configured, no usage',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else {
          supportingMetrics.push({
            label: 'Spend / Session',
            value: `$${allocResult.costPerSession.toFixed(2)}`,
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        }
      } else if (selectedCostLayer.value === 'per_hour') {
        const activeCodingMinutes = card.activeCodingMinutes || 0
        const isActiveCodingInstrumented = isMetricInstrumentedForWorkflow(card.ide || card.label || '', 'active_coding_time_minutes')
        if (!isActiveCodingInstrumented) {
          supportingMetrics.push({
            label: 'Spend / Active-Coding Hour (additive)',
            value: 'Not instrumented',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else if (activeCodingMinutes === 0) {
          supportingMetrics.push({
            label: 'Spend / Active-Coding Hour (additive)',
            value: 'Configured, no usage',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else {
          const activeCodingHours = activeCodingMinutes / 60
          const costPerHour = allocResult.allocatedSpend / activeCodingHours
          supportingMetrics.push({
            label: 'Spend / Active-Coding Hour (additive)',
            value: `$${costPerHour.toFixed(2)}`,
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        }
      } else if (selectedCostLayer.value === 'per_wallclock') {
        if (sessionCount === 0) {
          supportingMetrics.push({
            label: 'Spend / Session-Hour (additive)',
            value: 'Configured, no usage',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else {
          const sessionHours = (card.totalDurationMinutes || 0) / 60
          if (sessionHours > 0) {
            const costPerHour = allocResult.allocatedSpend / sessionHours
            supportingMetrics.push({
              label: 'Spend / Session-Hour (additive)',
              value: `$${costPerHour.toFixed(2)}`,
              trend: 'neutral',
              trendClass: '',
              isCost: true
            })
          } else {
            supportingMetrics.push({
              label: 'Spend / Session-Hour (additive)',
              value: 'No duration data',
              trend: 'neutral',
              trendClass: '',
              isCost: true
            })
          }
        }
      } else if (selectedCostLayer.value === 'cost_adjusted') {
        if (sessionCount === 0 || !card.value) {
          supportingMetrics.push({
            label: 'Output / $100',
            value: 'No usage data',
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        } else {
          const outputPer100 = (card.value * 100) / allocResult.allocatedSpend
          supportingMetrics.push({
            label: 'Output / $100',
            value: outputPer100.toFixed(1),
            trend: 'neutral',
            trendClass: '',
            isCost: true
          })
        }
      }
    }

    // Get operational signal — truthful label per environment
    const operationalSignal = card.isLive ? getOperationalSignalText() : 'Data available'

    // Determine signal class based on Classic's operational posture
    const signalClass = card.isLive ? 'v3-tc-bottom--positive' : 'v3-tc-bottom--neutral'

    // Generate operational interpretation (use Classic's operational posture)
    // V3 should not create its own narrative logic
    const operationalInterpretation = card.isLive
      ? getOperationalSignalText()
      : 'Data available'

    // Generate performance tier label (simplified for credibility)
    // Removed arbitrary thresholds - only shows operational signal
    // VP Engineering prefers data over gamification
    let bottomLabel = ''
    let bottomClass = ''
    if (card.isLive) {
      bottomLabel = isLocalLabMode() ? 'Historical telemetry' : 'Live telemetry'
      bottomClass = 'v3-tc-bottom--positive'
    } else if (card.value !== null && card.value !== 0) {
      bottomLabel = 'Data available'
      bottomClass = 'v3-tc-bottom--neutral'
    }
    
    return {
      id: card.ide,
      name,
      type,
      icon,
      metricLabel: selectedMetricLabel.value,
      displayValue,
      timeRangeLabel: hasSessions ? contextLabel : 'Needs more data',
      sessionCountLabel: hasSessions ? sessionCountLabel : 'Needs more data',
      supportingMetrics: hasSessions ? supportingMetrics : [],
      sparklineData: hasSessions ? sparklineData : [],
      operationalSignal: hasSessions ? operationalSignal : 'Needs more data',
      signalClass: hasSessions ? signalClass : 'v3-tc-bottom--muted',
      operationalInterpretation: hasSessions ? operationalInterpretation : 'Needs more data',
      bottomLabel: hasSessions ? bottomLabel : 'Needs more data',
      bottomClass: hasSessions ? bottomClass : 'v3-tc-bottom--muted',
      isLeader: hasSessions && isLeader,
      isLaggard: hasSessions && isLaggard,
      hasSessions,
      rawToolId: card.rawToolId,
      sessionCount: card.sessionCount || 0,
      activeCodingMinutes: card.activeCodingMinutes || 0
    }
  })

  const end = performance.now()
  const duration = end - start
  if (PBT_DEBUG) console.log(`[PERF] v3Cards Computed | ${duration.toFixed(2)}ms | ${v3CardsRerenderCount} | ${result.length} cards`)

  // Track first card render time
  if (firstCardRenderTime === null && result.length > 0) {
    firstCardRenderTime = end - initialRenderStart
    if (PBT_DEBUG) console.log(`[PERF] First Card Render | ${firstCardRenderTime.toFixed(2)}ms | 1 | from component init`)
  }

  return result
})

// Helper: Generate SVG sparkline path from data points
function generateSparklinePath(data: number[]): string {
  if (!data || data.length === 0) return ''
  
  const validData = data.filter(v => typeof v === 'number' && Number.isFinite(v))
  if (validData.length === 0) return ''
  
  const width = 120
  const height = 32
  const padding = 2
  
  const max = Math.max(...validData)
  const min = Math.min(...validData)
  const range = max - min || 1
  
  const stepX = (width - padding * 2) / (data.length - 1 || 1)
  
  let path = ''
  data.forEach((value, index) => {
    const x = padding + index * stepX
    const y = height - padding - ((value - min) / range) * (height - padding * 2)
    path += index === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`
  })
  
  return path
}

// Helper: Format metric value using Classic's formatting logic
function formatMetricValue(value: number | null, metric: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Needs more data'

  // Ratio metrics are stored as fractions (0-1), convert to percentage
  if (metric.includes('_ratio') || metric.includes('rate') || metric.includes('percent')) {
    // For ratio metrics, multiply by 100 to convert fraction to percentage
    const percentageValue = metric.includes('_ratio') ? value * 100 : value
    // Clamp to realistic range (0-100%) for demo credibility
    const clampedValue = Math.min(100, Math.max(0, percentageValue))
    return `${clampedValue.toFixed(1)}%`
  }
  if (metric.includes('minutes') || metric.includes('time')) {
    // Use canonical PI hour/minute formatter
    return formatDurationHoursMinutes(value)
  }
  if (value >= 1000) {
    return value.toLocaleString()
  }
  return value.toFixed(1)
}

const selectedMetricLabel = computed(() => {
  // Import from Classic's metric label mapping (pilot-ready subset only)
  const labels: Record<string, string> = {
    'AI_suggestions_accepted': 'AI Activity / Session',
    'ai_burst_count': 'AI Burst Count',
    'AI_usage_duration_minutes': 'AI Usage Duration',
    'average_session_length_minutes': 'Session Length',
    'active_coding_time_minutes': 'Active Coding Time',
    'idle_time_minutes': 'Idle Time',
    'commits_per_session': 'Commits per Session',
    'files_edited_per_session': 'Files Edited per Session',
    'time_to_first_commit_minutes': 'Time to First Commit',
    'focus_ratio': 'Focus Ratio',
    'rework_rate': 'Rework Rate',
    'active_coding_ratio': 'Active Coding Ratio (%)',
    'ai_usage_ratio': 'AI Usage Ratio (%)',
    'idle_ratio': 'Idle Ratio (%)',
    // CR-X Slice 1: Delivery metrics
    'merged_pr_count': 'PRs Merged / Week',
    'deployment_count': 'Deployments / Week',
    'deploy_success_rate': 'Deploy Success Rate (%)',
    'median_merge_cycle_hours': 'Merge Cycle Time (hrs)',
    'release_count': 'Releases / Week',
    'review_count': 'Reviews / Week',
    'pr_review_cycles': 'Review Cycles / Week',
    'merge_rate': 'Merge Rate (%)'
  }
  // Case-insensitive lookup to handle any case mismatches
  const normalizedKey = Object.keys(labels).find(key => key.toLowerCase() === selectedMetric.value.toLowerCase())
  return normalizedKey ? labels[normalizedKey] : selectedMetric.value
})

// Lifecycle
onMounted(() => {
  // Initialize with Classic data
})

// Runtime state assignment for validation (safe, no template modifications)
// Uses only computed refs available at component scope, not variables scoped inside other computed
function publishProductivityRuntimeState() {
  if (typeof window === 'undefined') return

  const cards = Array.isArray(v3Cards.value) ? v3Cards.value : []
  const classicCards = Array.isArray(ideMetricCards.value) ? ideMetricCards.value : []
  const series = Array.isArray(lineGraphData.value) ? lineGraphData.value : []
  const timeSeries = Array.isArray(timeSeriesData.value) ? timeSeriesData.value : []

  const primaryCount = classicCards.filter(c => isPrimaryCardEligible(c)).length
  const emergingCount = classicCards.filter(c => !isPrimaryCardEligible(c)).length

  // Derive validation universe from canonical telemetry metadata already available in component runtime.
  const canonicalWorkflows = deriveCanonicalWorkflowUniverse(timeSeries)
  const renderedCardIds = cards.map(c => c.id || c.ide || c.workflowId || c.displayLabel || c.title || c.label)
  const missingCanonicalWorkflows = canonicalWorkflows.filter(w => !renderedCardIds.includes(w))

  const allPeriods = new Set(
    series.flatMap(s => (s.data || []).map(d => d.x || d.period || d.t))
  )

  const runtimeState = {
    totalSessions: totalSessions.value,
    primaryWorkflowsCount: primaryCount,
    emergingWorkflowsCount: emergingCount,
    renderedCardCount: cards.length,
    renderedCardIds,
    allCanonicalWorkflowIds: canonicalWorkflows,
    missingCanonicalWorkflowIds: missingCanonicalWorkflows,
    lineGraphSeriesCount: series.length,
    lineGraphSeriesLabels: series.map(s => s.label),
    lineGraphUniquePeriodsCount: allPeriods.size,
    lineGraphUniquePeriods: Array.from(allPeriods).sort(),
    selectedMetric: selectedMetric.value,
    selectedMetricLabel: selectedMetricLabel.value,
    timeSeriesDataReceived: timeSeries.length,
    timeSeriesDataLabels: timeSeries.map(s => s.label),
    timestamp: new Date().toISOString()
  }

  ;(window as any).PRODUCTIVITY_V3_RUNTIME_STATE = runtimeState
}

watch(
  [v3Cards, ideMetricCards, lineGraphData, selectedMetric, timeSeriesData],
  publishProductivityRuntimeState,
  { immediate: true, deep: false }
)

// 🔥 P0-A: Comprehensive filter debug object for All Time verification
function publishFilterDebugState() {
  if (typeof window === 'undefined') return

  const storeDateRange = filterStore.productivityFilters?.dateRange || { from: '', to: '' }
  const activeDateRange = filterStore.activeDateRange('productivity')
  const query = productivityQuery.value
  
  // Extract periods from time series data
  const periods: string[] = []
  if (timeSeriesData.value && Array.isArray(timeSeriesData.value)) {
    timeSeriesData.value.forEach(series => {
      if (series && series.points && Array.isArray(series.points)) {
        series.points.forEach(point => {
          if (point && point.t && !periods.includes(point.t)) {
            periods.push(point.t)
          }
        })
      }
    })
  }
  periods.sort()
  
  // Extract card labels
  const cardLabels = v3Cards.value.map(card => ({
    name: card.name,
    timeRangeLabel: card.timeRangeLabel,
    sessionCountLabel: card.sessionCountLabel
  }))
  
  // Build API endpoint URL
  const params = new URLSearchParams()
  if (query.from) params.append('from', query.from)
  if (query.to) params.append('to', query.to)
  if (query.viewBucket) params.append('viewBucket', query.viewBucket)
  const endpoint = `/api/telemetry/canonical?${params.toString()}`

  const debugState = {
    selectedTimeFilter: selectedTimeFilter.value,
    storeDateRange,
    activeDateRange,
    productivityQuery: {
      from: query.from,
      to: query.to,
      fromIsEmpty: query.from === '',
      toIsEmpty: query.to === '',
      viewBucket: query.viewBucket,
      metricId: query.metricId
    },
    endpoint,
    timeRange: timeRange.value,
    timeWindowLabel: timeWindowLabel.value,
    totalSessions: totalSessions.value,
    cardLabels,
    periods: {
      count: periods.length,
      first: periods[0] || null,
      last: periods[periods.length - 1] || null,
      all: periods
    },
    syncGuard: isSyncingTimeFilter,
    timestamp: new Date().toISOString()
  }

  ;(window as any).PRODUCTIVITY_FILTER_DEBUG = debugState

  // Log on changes for easy inspection
  if (PBT_DEBUG) console.log('[PRODUCTIVITY_FILTER_DEBUG]', debugState)
}

// ── P0.2 R2: 5-stage runtime freshness trace ──
// Serializes the latest FINITE observed point per workflow at each pipeline stage
// as JSON (not collapsed Object logs) for browser acceptance proof.
function publishFreshnessTrace() {
  if (typeof window === 'undefined') return

  const metricId = filterStore.productivityFilters?.productivityMetricId || 'ide.ai_suggestions_accepted'
  const pointField = resolveTimeSeriesPointField(metricId)
  if (!pointField) return

  if (seriesDimension.value !== 'workflow') {
    const traceOutput = {
      metric: metricId,
      pointField,
      seriesDimension: seriesDimension.value,
      skipped: true,
      timestamp: new Date().toISOString(),
      workflows: {}
    }
    ;(window as any).PBT_FRESHNESS_TRACE = traceOutput
    if (PBT_DEBUG) console.log('[PBT_FRESHNESS_TRACE_JSON]', JSON.stringify(traceOutput, null, 2))
    return
  }

  const WORKFLOWS = ['devin', 'vscode', 'cursor', 'claude_code', 'github_copilot']

  const trace: Record<string, any> = {}

  for (const wf of WORKFLOWS) {
    const stage: any = {}

    // STAGE 3: METRICS_FACADE — from timeSeriesData (the composable output)
    const tsData = timeSeriesData.value
    const series = Array.isArray(tsData) ? tsData.find((s: any) => {
      const label = String(s?.label ?? '').toLowerCase()
      return label === wf || label === wf.replace(/_/g, ' ') ||
             (wf === 'devin' && (label === 'devin' || label === 'windsurf'))
    }) : null

    if (series && series.points && Array.isArray(series.points)) {
      // Find latest point where the selected metric field is finite/non-null
      const finitePoints = series.points.filter((p: any) =>
        p && p[pointField] != null && typeof p[pointField] === 'number' && Number.isFinite(p[pointField])
      )
      const sortedFinite = [...finitePoints].sort((a: any, b: any) =>
        new Date(a.t).getTime() - new Date(b.t).getTime()
      )
      const latest = sortedFinite[sortedFinite.length - 1]
      stage.METRICS_FACADE = latest ? {
        timestamp: latest.t,
        value: latest[pointField],
        totalFinitePoints: sortedFinite.length,
        totalPoints: series.points.length
      } : null
    } else {
      stage.METRICS_FACADE = null
    }

    // STAGE 4: LINE_GRAPH_INPUT — from decisionSeriesLineGraphData (render authority)
    const lgData = decisionSeriesLineGraphData.value
    // Build canonical label set for this workflow (decisionSeriesLineGraphData
    // uses getCanonicalWorkflowIdentity which returns "Devin workflow" etc.)
    const canonicalLabel = String(getCanonicalWorkflowIdentity(wf) ?? '').toLowerCase()
    const wfLabel = wf.replace(/_/g, ' ')
    const lgSeries = Array.isArray(lgData) ? lgData.find((s: any) => {
      const label = String(s?.label ?? '').toLowerCase()
      return label === canonicalLabel || label === wf || label === wfLabel ||
             (wf === 'devin' && (label === 'devin workflow' || label === 'windsurf workflow' || label === 'devin' || label === 'windsurf'))
    }) : null

    if (lgSeries && lgSeries.data && Array.isArray(lgSeries.data)) {
      const finitePts = lgSeries.data.filter((p: any) =>
        p && p.y != null && typeof p.y === 'number' && Number.isFinite(p.y)
      )
      const sortedFinite = [...finitePts].sort((a: any, b: any) =>
        new Date(a.x).getTime() - new Date(b.x).getTime()
      )
      const latest = sortedFinite[sortedFinite.length - 1]
      stage.LINE_GRAPH_INPUT = latest ? {
        x: latest.x,
        y: latest.y,
        totalFinitePoints: sortedFinite.length,
        totalNullPoints: lgSeries.data.filter((p: any) => p.y == null || !Number.isFinite(p.y)).length
      } : null
    } else {
      stage.LINE_GRAPH_INPUT = null
    }

    trace[wf] = stage
  }

  const traceOutput = {
    metric: metricId,
    pointField,
    timestamp: new Date().toISOString(),
    workflows: trace
  }

  ;(window as any).PBT_FRESHNESS_TRACE = traceOutput
  // CR-X Phase 3 PERF: Gate freshness trace behind PBT_DEBUG to avoid
  // large console.log payloads in normal product runtime.
  if (PBT_DEBUG) console.log('[PBT_FRESHNESS_TRACE_JSON]', JSON.stringify(traceOutput, null, 2))
}

watch(
  [decisionSeriesLineGraphData, timeSeriesData, () => filterStore.productivityFilters?.productivityMetricId],
  () => {
    try {
      publishFreshnessTrace()
    } catch (traceError) {
      ;(window as any).PBT_FRESHNESS_TRACE = {
        skipped: true,
        error: 'freshness_trace_unavailable',
        timestamp: new Date().toISOString()
      }
      if (PBT_DEBUG) console.warn('[PBT_FRESHNESS_TRACE] skipped', traceError)
    }
  },
  { immediate: true, deep: false }
)

watch(
  [selectedTimeFilter, () => filterStore.productivityFilters?.dateRange, productivityQuery, timeWindowLabel, totalSessions, v3Cards, timeSeriesData],
  publishFilterDebugState,
  { immediate: true, deep: false }
)

// 🔥 P0-K: Runtime cost debug object - DISABLED
// Debug publisher removed because it caused runtime setup crashes.
// Dashboard rendering is essential; debug telemetry is nonessential for pilot.

onUnmounted(() => {
  // Cleanup
})
</script>

<style scoped>
/* ── V3 Styles (Light Theme, Next-Gen Structure) ─────────────────────────── */

.productivity-v3 {
  background: #ffffff;
  color: #212529;
  font-family: system-ui, -apple-system, sans-serif;
}

/* Context Bar */
.v3-context-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 5px 12px;
  margin-bottom: 8px;
  gap: 10px;
}

.v3-context-left {
  display: flex;
  gap: 8px;
  align-items: center;
}

.v3-status-indicator {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #495057;
  font-weight: 500;
}

.v3-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.v3-dot--live {
  background: #22c55e;
  box-shadow: 0 0 6px #22c55e80;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1 }
  50% { opacity: 0.5 }
}

.v3-metrics-summary {
  font-size: 12px;
  color: #6c757d;
}

.v3-context-right {
  display: flex;
  align-items: center;
}

.v3-signal-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  background: #d4edda;
  border: 1px solid #c3e6cb;
  color: #155724;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 4px 10px;
  border-radius: 5px;
}

/* Context Bar (Compressed telemetry strip) */
.v3-context-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 10px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 8px;
  font-size: 10px;
}

.v3-context-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.v3-status-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  color: #1e293b;
}

.v3-metrics-summary {
  font-size: 10px;
  color: #64748b;
  font-weight: 500;
}

/* CR-X Day 1B S1: Developer coverage indicator */
.v3-coverage-indicator {
  font-size: 10px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 10px;
}

.v3-coverage--ok {
  background: #e6f4ea;
  color: #1e7e34;
}

.v3-coverage--warn {
  background: #fff3cd;
  color: #856404;
}

.v3-coverage-unattributed {
  color: inherit;
  opacity: 0.8;
}

.v3-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}

.v3-dot--live {
  background: #22c55e;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Executive Summary Row */
.v3-executive-summary {
  display: flex;
  gap: 10px;
  margin-bottom: 8px;
}

.v3-summary-card {
  flex: 1;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 8px 12px;
  text-align: center;
}

.v3-summary-card--laggard {
  background: #fef2f2;
  border: 1px solid #fecaca;
}

.v3-summary-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #6c757d;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.v3-summary-card--laggard .v3-summary-label {
  color: #dc2626;
}

.v3-summary-value {
  font-size: 14px;
  font-weight: 700;
  color: #212529;
}

/* Executive Interpretation Layer */
.v3-executive-interpretation {
  background: #f0f9ff;
  border-left: 3px solid #0d6efd;
  padding: 6px 12px;
  margin-bottom: 10px;
  font-size: 12px;
  color: #1e293b;
  line-height: 1.5;
  border-radius: 0 4px 4px 0;
}

/* Ops Ticker */
.v3-ticker {
  display: flex;
  align-items: center;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 6px 0;
  margin-bottom: 10px;
  overflow: hidden;
}

.v3-ticker-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #0d6efd;
  background: #e7f1ff;
  border-right: 1px solid #e9ecef;
  padding: 0 14px;
  height: 100%;
  white-space: nowrap;
  flex-shrink: 0;
}

.v3-ticker-scroll-wrap {
  flex: 1;
  overflow: hidden;
}

.v3-ticker-scroll {
  display: flex;
  align-items: center;
  white-space: nowrap;
  animation: ticker 32s linear infinite;
}

@keyframes ticker {
  from { transform: translateX(0) }
  to { transform: translateX(-50%) }
}

.v3-ticker-item {
  font-size: 12px;
  color: #495057;
  padding: 0 20px;
}

.v3-ticker-sep {
  color: #dee2e6;
}

/* Unified Controls Row (View + Filters in one compact row) */
/* Sticky within the PBT content so developer -> workflow -> metric switches
   need no scrolling during demos. Wraps to two compact rows on narrow widths. */
.v3-unified-controls {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 4px;
  padding: 8px 12px;
  background: #f8f9fa;
  border-radius: 8px;
  flex-wrap: wrap;
  position: sticky;
  top: 0;
  z-index: 20;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
}

.v3-select--disabled {
  opacity: 0.55;
}

.v3-filter-reset {
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  color: #6c757d;
  font-size: 12px;
  font-weight: 500;
  padding: 6px 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.v3-filter-reset:hover {
  background: #f8f9fa;
  border-color: #adb5bd;
  color: #495057;
}

/* CR-X Pass 5 (C): Active filter context indicator */
.v3-active-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  background: #f0f7ff;
  border-bottom: 1px solid #d0e1ff;
  font-size: 0.75rem;
  flex-wrap: wrap;
}

.v3-active-filters-label {
  color: #495057;
  font-weight: 600;
}

.v3-active-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: white;
  border: 1px solid #b8d4ff;
  border-radius: 12px;
  padding: 2px 8px;
  color: #0d6efd;
  font-size: 0.7rem;
}

.v3-cohort-disclosure {
  padding: 4px 16px;
  font-size: 0.7rem;
  color: #6c757d;
  background: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
}

.v3-active-filter-remove {
  background: none;
  border: none;
  color: #6c757d;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  margin-left: 2px;
}

.v3-active-filter-remove:hover {
  color: #dc3545;
}

.v3-active-filters-clear {
  background: none;
  border: none;
  color: #6c757d;
  cursor: pointer;
  font-size: 0.7rem;
  text-decoration: underline;
  margin-left: auto;
}

.v3-active-filters-clear:hover {
  color: #dc3545;
}

.v3-toggle-group {
  display: flex;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 7px;
  overflow: hidden;
}

.v3-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 500;
  background: none;
  border: none;
  color: #6c757d;
  cursor: pointer;
  transition: all 0.15s;
}

.v3-toggle--active {
  background: #e9ecef;
  color: #212529;
}

.v3-select {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 7px;
  color: #495057;
  font-size: 12px;
  padding: 7px 12px;
  cursor: pointer;
  outline: none;
}

.v3-select--cost {
  border-color: #22c55e;
  background: #f0fdf4;
}

.v3-select--cost:hover {
  border-color: #16a34a;
}

.v3-cost-edit-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #6c757d;
  padding: 7px 12px;
  border: 1px solid #e9ecef;
  border-radius: 7px;
  background: white;
  transition: all 0.15s;
  cursor: pointer;
}

.v3-cost-edit-btn:hover {
  color: #0d6efd;
  border-color: #0d6efd;
  background: #f0f9ff;
}

/* Cost Summary Strip */
.v3-cost-summary-strip {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 6px 12px;
  margin-bottom: 10px;
  font-size: 12px;
}

.v3-cost-summary-active {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.v3-cost-summary-neutral {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.v3-cost-scope-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
  margin: 8px 0;
}

.v3-cost-scope-warning-icon {
  font-size: 16px;
  color: #d97706;
}

.v3-cost-scope-warning-text {
  font-size: 12px;
  color: #92400e;
}

/* CR-X C6: Info style for allocated economics (replaces warning) */
.v3-cost-scope-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  margin: 8px 0;
}

.v3-cost-scope-info-icon {
  font-size: 16px;
  color: #2563eb;
}

.v3-cost-scope-info-text {
  font-size: 12px;
  color: #1e40af;
}

/* CR-X Gate A: Cost-authority badge */
.v3-cost-authority-badge {
  margin-left: 8px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.v3-cost-authority-backend {
  background: #dcfce7;
  color: #166534;
}
.v3-cost-authority-fallback {
  background: #fef3c7;
  color: #92400e;
}
.v3-cost-scope-unavailable {
  background: #fef2f2;
  border: 1px solid #fecaca;
}
.v3-cost-scope-unavailable .v3-cost-scope-info-text {
  color: #991b1b;
}

.v3-cost-badge {
  background: #22c55e;
  color: white;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
}

.v3-cost-sep {
  color: #dee2e6;
}

.v3-cost-total {
  color: #1f2937;
  font-weight: 600;
}

.v3-cost-highest {
  color: #6c757d;
}

.v3-cost-best {
  color: #22c55e;
  font-weight: 500;
}

.v3-cost-neutral-text {
  color: #6c757d;
}

.v3-cost-disclaimer {
  color: #6c757d;
  font-size: 0.75rem;
  font-style: italic;
}

/* CR-X Pass 4 (D): Dimensional economics delivery evidence */
.v3-cost-delivery {
  color: #0d6efd;
  font-size: 0.75rem;
  font-weight: 600;
}

.v3-cost-summary-edit {
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  color: #6c757d;
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.v3-cost-summary-edit:hover {
  background: #f8f9fa;
  border-color: #0d6efd;
  color: #0d6efd;
}

/* Cost Modal Overlay */
.v3-cost-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 20px;
}

.v3-cost-modal {
  background: white;
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  max-width: 700px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
}

.v3-cost-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px 16px;
  border-bottom: 1px solid #e9ecef;
}

.v3-cost-modal-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 700;
  color: #1f2937;
}

.v3-cost-modal-title i {
  font-size: 20px;
  color: #22c55e;
}

.v3-cost-modal-close {
  background: none;
  border: none;
  color: #6c757d;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  transition: all 0.15s;
  font-size: 20px;
  line-height: 1;
}

.v3-cost-modal-close:hover {
  background: #f3f4f6;
  color: #1f2937;
}

.v3-cost-modal-subtitle {
  padding: 12px 24px;
  background: #f8f9fa;
  color: #6c757d;
  font-size: 13px;
  border-bottom: 1px solid #e9ecef;
}

.v3-cost-modal-content {
  padding: 20px 24px;
}

.v3-cost-modal-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #e9ecef;
}

/* Cards Section */
.v3-cards-section {
  margin-bottom: 10px;
}

.v3-tool-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

@media (max-width: 900px) {
  .v3-tool-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .v3-tool-grid {
    grid-template-columns: 1fr;
  }
}

/* Tool Card */
.v3-tool-card {
  background: #ffffff;
  border: 1px solid #e9ecef;
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.v3-tool-card:hover {
  border-color: #0d6efd;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.v3-tool-card--leader {
  border-color: #22c55e;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.1);
}

.v3-tool-card--laggard {
  border-color: #dc2626;
  box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.1);
}

.v3-tool-card--workflow {
  border-color: #6366f1;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15);
  background: linear-gradient(135deg, #ffffff 0%, #f8f9ff 100%);
}

.v3-tool-card--model {
  border-color: #f59e0b;
  box-shadow: 0 2px 8px rgba(245, 158, 11, 0.1);
}

.v3-tc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.v3-tc-identity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.v3-tc-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid #e9ecef;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
  background: #f8f9fa;
}

.v3-tc-name {
  font-size: 14px;
  font-weight: 700;
  color: #212529;
}

.v3-tc-type {
  font-size: 11px;
  color: #6c757d;
  margin-top: 1px;
}

.v3-tc-tier-badge {
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  padding: 2px 7px;
  border-radius: 4px;
}

.v3-tc-tier-badge--leader {
  background: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.v3-tc-tier-badge--laggard {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}

.v3-tc-primary {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.v3-tc-output-label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #6c757d;
}

.v3-tc-output-value {
  font-size: 36px;
  font-weight: 800;
  color: #212529;
  line-height: 1;
}

.v3-tc-sessions {
  font-size: 11px;
  color: #6c757d;
}

.v3-tc-divider {
  height: 1px;
  background: #e2e8f0;
}

.v3-tc-metrics {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.v3-tc-metric {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.v3-tc-metric-val {
  font-weight: 700;
  color: #495057;
}

.v3-tc-metric-val.v3-up {
  color: #22c55e;
}

.v3-tc-metric-val.v3-down {
  color: #dc3545;
}

.v3-tc-metric-label {
  color: #6c757d;
}

.v3-tc-metric--fallback .v3-tc-metric-val {
  color: #f59e0b;
}

.v3-fallback-indicator {
  font-size: 9px;
  color: #f59e0b;
  margin-left: 2px;
  opacity: 0.7;
}

.v3-lowsample-indicator {
  font-size: 9px;
  color: #dc2626;
  margin-left: 2px;
  opacity: 0.8;
}

.v3-tc-metric--lowsample {
  opacity: 0.8;
}

.v3-tc-metric--cost {
  background: #f0fdf4;
  padding: 4px 8px;
  border-radius: 4px;
  margin: -4px -8px;
}

.v3-tc-metric--cost .v3-tc-metric-val {
  color: #16a34a;
  font-weight: 700;
}

.v3-tc-metric--cost .v3-tc-metric-label {
  color: #15803d;
}

.v3-tc-spark {
  width: 100%;
  margin-top: 8px;
}

.v3-spark-svg {
  width: 100%;
  height: 32px;
  overflow: visible;
}

.v3-tc-bottom {
  font-size: 11px;
  font-weight: 600;
  padding: 5px 0 0;
  border-top: 1px solid #e9ecef;
}

.v3-tc-bottom--positive {
  color: #22c55e;
}

.v3-tc-bottom--warning {
  color: #ffc107;
}

.v3-tc-bottom--neutral {
  color: #0d6efd;
}

.v3-tc-bottom--muted {
  color: #6c757d;
}

/* Time Series Section */
.v3-ts-section {
  margin-bottom: 10px;
}

.v3-ts-chart-card {
  background: #ffffff;
  border: 1px solid #e9ecef;
  border-radius: 10px;
  padding: 10px;
}

.v3-ts-header {
  margin-bottom: 6px;
}

.v3-ts-title {
  font-size: 16px;
  font-weight: 700;
  color: #212529;
  margin: 0 0 4px;
}

/* CR-X C: Delivery provenance badge */
.v3-delivery-provenance-badge {
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  vertical-align: middle;
}
.v3-provenance-demo {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
}
.v3-provenance-live {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #86efac;
}
.v3-provenance-unknown {
  background: #f3f4f6;
  color: #6b7280;
}
.v3-provenance-error {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fca5a5;
}

.v3-ts-subtitle {
  font-size: 12px;
  color: #6c757d;
  margin: 0;
}

/* CR-X R2: Delivery attribution notice */
.v3-ts-delivery-notice {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  margin-bottom: 6px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 6px;
  font-size: 11px;
  color: #1e40af;
}

/* Phase Architecture */
.v3-phases {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.v3-phase {
  background: #ffffff;
  border: 1px solid #e9ecef;
  border-radius: 10px;
  overflow: hidden;
}

.v3-phase-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
}

.v3-phase-identity {
  display: flex;
  align-items: center;
  gap: 12px;
}

.v3-phase-icon {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  flex-shrink: 0;
  color: white;
}

.v3-phase-name {
  font-size: 14px;
  font-weight: 700;
  color: #212529;
}

.v3-phase-sub {
  font-size: 11.5px;
  color: #6c757d;
  margin-top: 1px;
}

.v3-phase-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.v3-phase-metric-count {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #0d6efd;
  background: #e7f1ff;
  border: 1px solid #b8d4fe;
  padding: 3px 9px;
  border-radius: 4px;
}

/* Insights Strip */
.v3-insights-strip {
  margin: 0 16px 12px;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-left: 3px solid #0d6efd;
  border-radius: 6px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.v3-insights-strip-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #0d6efd;
  margin-bottom: 4px;
}

.v3-insights-count {
  background: #e7f1ff;
  color: #0d6efd;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
}

.v3-insight-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #495057;
}

.v3-ins-model {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
}

.v3-ins-model--sonnet {
  background: #e7f1ff;
  color: #0d6efd;
}

.v3-ins-model--gpt {
  background: #e7f5ff;
  color: #0ea5e9;
}

/* GitHub Metrics */
.v3-github-metrics {
  padding: 0 16px 16px;
}

.v3-metrics-header {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 600;
  color: #6c757d;
  margin-bottom: 12px;
  letter-spacing: 0.04em;
}

.v3-metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}

.v3-metric-card {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 13px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.v3-metric-value {
  font-size: 20px;
  font-weight: 800;
  color: #212529;
  line-height: 1.1;
}

.v3-metric-label {
  font-size: 11px;
  color: #6c757d;
}

/* Cost Layer Panel */
.v3-cost-layer-panel {
  background: #f0fdf4;
  border: 1px solid #22c55e;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
}

.v3-cost-layer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #16a34a;
  margin-bottom: 12px;
}

.v3-cost-layer-content {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
}

.v3-cost-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: white;
  border: 1px solid #bbf7d0;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
}

.v3-cost-item-name {
  color: #495057;
  font-weight: 500;
}

.v3-cost-item-value {
  color: #16a34a;
  font-weight: 700;
}

/* Old time-series cost styles removed - cost now embedded inside ProductivityLineGraph */

/* Cost Context Strip (Time Series) */
/* Cost Context Strip (Time Series) — compact single-line provenance */
.v3-cost-context-strip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 12px;
}

.v3-cost-context-badge {
  background: #22c55e;
  color: white;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  white-space: nowrap;
}

.v3-cost-context-sep {
  color: #cbd5e1;
  white-space: nowrap;
}

.v3-cost-context-total {
  color: #1f2937;
  font-weight: 600;
  white-space: nowrap;
}

.v3-cost-context-superlative {
  color: #334155;
  font-weight: 500;
  white-space: nowrap;
}

.v3-cost-context-disclaimer {
  color: #64748b;
  font-size: 11px;
  font-style: italic;
  margin-left: auto;
}

.v3-cost-context-emerging {
  font-size: 10px;
  color: #f59e0b;
  font-weight: 500;
  margin-left: 6px;
  background: #fef3c7;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

/* Allocated cost estimate (developer-scope) */
.v3-cost-context-allocated {
  background: #f0f9ff;
  border-color: #bae6fd;
}

.v3-cost-context-detail {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #e2e8f0;
}

.v3-cost-context-detail-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}

.v3-cost-context-detail-workflow {
  font-weight: 600;
  color: #334155;
  min-width: 140px;
}

.v3-cost-context-detail-value {
  color: #0f172a;
  font-weight: 500;
}

.v3-cost-context-detail-meta {
  color: #94a3b8;
  font-size: 11px;
  margin-left: auto;
}

.v3-cost-context-disclaimer-row {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #e2e8f0;
  font-size: 11px;
  color: #64748b;
}

/* Metric-aware aggregate derived economic layer */
.v3-cost-context-aggregate {
  margin: 8px 0;
  padding: 8px 12px;
  background: #e0f2fe;
  border-radius: 6px;
  border: 1px solid #bae6fd;
}

.v3-cost-context-aggregate-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 13px;
}

.v3-cost-context-aggregate-spend {
  font-weight: 600;
  color: #0f172a;
}

.v3-cost-context-aggregate-sep {
  color: #94a3b8;
}

.v3-cost-context-aggregate-volume {
  color: #334155;
  font-weight: 500;
}

.v3-cost-context-aggregate-unitcost {
  color: #0c4a6e;
  font-weight: 600;
}

/* Per-workflow metric detail */
.v3-cost-context-detail-row--metric {
  flex-wrap: wrap;
  gap: 4px 8px;
}

.v3-cost-context-detail-metric {
  font-size: 11px;
  color: #475569;
  flex-basis: 100%;
  padding-left: 0;
}

.v3-cost-context-detail-metric--muted {
  color: #94a3b8;
  font-style: italic;
}

/* ── Compact Time Series cost row (ONE horizontal line) ──────────────────
   Collapses the entire developer allocated economic layer into a single
   inline row. Aggregate on the left, per-workflow segments inline,
   disclaimer at the end. Wraps gracefully on narrow widths but targets
   one row at normal desktop/demo width. */
.v3-ts-cost-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 6px;
  padding: 7px 12px;
  margin-bottom: 10px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.3;
}

.v3-ts-cost-row-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #0369a1;
  margin-right: 2px;
}

.v3-ts-cost-row-aggregate {
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
}

.v3-ts-cost-row-sep {
  color: #94a3b8;
}

.v3-ts-cost-row-na {
  color: #94a3b8;
  font-style: italic;
  font-weight: 400;
}

.v3-ts-cost-row-wf {
  white-space: nowrap;
}

.v3-ts-cost-row-wf-sep {
  color: #cbd5e1;
  margin: 0 2px;
}

.v3-ts-cost-row-wf-name {
  font-weight: 600;
  color: #334155;
}

.v3-ts-cost-row-wf-spend {
  color: #0f172a;
  font-weight: 500;
  margin-left: 3px;
}

.v3-ts-cost-row-wf-unit {
  color: #475569;
  font-weight: 400;
}

.v3-ts-cost-row-wf-detail {
  color: #0f172a;
  font-weight: 500;
  margin-left: 3px;
}

.v3-ts-cost-row-disclaimer {
  color: #64748b;
  font-size: 11px;
  font-weight: 400;
  white-space: nowrap;
}

/* Empty State */
.v3-empty-state {
  text-align: center;
  padding: 60px 20px;
  background: #f8f9fa;
  border: 1px dashed #dee2e6;
  border-radius: 8px;
  margin: 20px 0;
}

.v3-error-state {
  background: #fff5f5;
  border-color: #fca5a5;
}

.v3-error-state .v3-empty-icon {
  color: #dc2626;
  opacity: 0.8;
}

.v3-error-state .v3-empty-title {
  color: #991b1b;
}

.v3-empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.v3-empty-title {
  font-size: 18px;
  font-weight: 600;
  color: #495057;
  margin-bottom: 8px;
}

.v3-empty-text {
  font-size: 14px;
  color: #6c757d;
  margin: 0;
}

/* ── PBT Decision Surface (Time Series) ──────────────────────────────── */
.v3-ts-workflow-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 6px;
  flex-wrap: wrap;
}
.v3-ts-workflow-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: #495057;
  letter-spacing: 0.02em;
}
.v3-ts-workflow-select {
  min-width: 220px;
}
.v3-ts-active-workflow {
  font-size: 0.72rem;
  color: #0d6efd;
  font-weight: 600;
}
.v3-ts-scope-summary {
  font-size: 0.78rem;
  color: #1e293b;
  font-weight: 600;
  margin-bottom: 2px;
}
.v3-ts-what-changed {
  display: flex;
  gap: 8px;
  align-items: baseline;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 6px 10px;
  margin-bottom: 6px;
}
.v3-ts-what-changed-label {
  font-size: 0.68rem;
  font-weight: 700;
  color: #b45309;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.v3-ts-what-changed-text {
  font-size: 0.78rem;
  color: #78350f;
}
.v3-ts-partial-week {
  font-size: 0.72rem;
  color: #6b7280;
  margin-bottom: 4px;
}
.v3-ts-not-instrumented {
  display: flex;
  gap: 12px;
  align-items: center;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 16px;
  margin: 8px 0;
}
.v3-ts-not-instrumented-icon {
  font-size: 1.6rem;
  color: #dc2626;
}
.v3-ts-not-instrumented-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: #991b1b;
}
.v3-ts-not-instrumented-text {
  font-size: 0.78rem;
  color: #7f1d1d;
  margin-top: 2px;
}
</style>
