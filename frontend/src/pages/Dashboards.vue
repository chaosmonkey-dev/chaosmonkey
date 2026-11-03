
<!-- 
  📋 ARCHITECTURE MAP: See /docs/DASHBOARD_METRICS_ARCHITECTURE_MAP.md
  This file is the root dashboard page with:
  - Tab 1: Performance Insights (PerformanceInsightsWidget)
  - Tab 2: Productivity by Tool (ProductivityOverTime)
  
  🔍 PERFORMANCE INSIGHTS FLOW (UNIFIED v2.0):
  - Dashboards.vue calls runPerfInsightsHarness() ONCE in refreshPI()
  - Generates insights from live GitHub + Productivity data
  - Stores result in shared insights ref
  - Passes insights to:
    → PerformanceInsightsWidget (Tab 1) via :insights prop
    → ProductivityOverTime (Tab 2) via :insights prop
    → EngOutput (embedded) via ProductivityOverTime
  - Single source of truth, no duplication, dynamic updates on filter changes
-->
<template>
  <!-- SVG Filters -->
  <svg style="position: absolute; width: 0; height: 0;">
    <defs>
      <filter id="chaos-glitch">
        <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" result="turbulence"/>
        <feDisplacementMap in2="turbulence" in="SourceGraphic" scale="2" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
    </defs>
  </svg>
  
  <div class="dashboard-container">
    <!-- Header Section -->
    <div class="dashboard-header sticky-header" style="background-color: #000000;">
      <div class="container-fluid">
        <div class="row align-items-center">
          <div class="col-12 col-md-8">
            <div class="header-content px-3 px-md-4 py-3 py-md-0">
              <div class="d-flex flex-column flex-md-row align-items-start align-items-md-center">
                <img src="../assets/CM-icon.png" alt="ChaosMonkey.dev Logo" class="me-3 dashboard-logo">
                
                <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet"></link>
                 <div>
                  <h1 class="dashboard-title mb-0" style="font-family: 'Bebas Neue'; filter: url(#chaos-glitch);">
                    CHAOSMONKEY
                  </h1>
                  </div>
                <!--
                <div>
                  <h1 class="dashboard-title mb-0">
                    Engineering Dashboards
                  </h1>
                  <br></br>
                  <p class="dashboard-subtitle mb-0">
                    Monitor development metrics, IDE activity, and productivity trends
                  </p>
                </div>
                -->


              </div>
            </div>
          </div>
          <div class="col-12 col-md-4 text-start text-md-end">
            <div class="px-3 px-md-4 pb-3 pb-md-0 d-flex align-items-center justify-content-md-end gap-3">
              <!-- Dev-only demo mode toggle -->
              <div v-if="showDemoToggle" class="form-check form-switch">
                <input 
                  class="form-check-input" 
                  type="checkbox" 
                  :checked="isDemoMode" 
                  @change="toggleDemoMode"
                  id="demoModeToggle"
                >
                <label class="form-check-label" for="demoModeToggle">
                  <small>Demo Mode</small>
                </label>
              </div>
              <NavUserAvatar />
              <button @click="logout" class="btn btn-light btn-lg">
                <i class="bi bi-box-arrow-right me-2"></i>Logout
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Pilot Setup Banner (hidden on Local when VITE_HIDE_PILOT_SETUP=true) -->
    <div v-if="!hidePilotSetup" class="container-fluid mt-1">
      <div class="pilot-setup-strip">
        <!-- Collapsed state: compact one-line utility -->
        <div v-if="!pilotSetupExpanded" class="d-flex align-items-center justify-content-between flex-wrap gap-1">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <span class="fw-bold small"><i class="bi bi-rocket-takeoff me-1"></i>Pilot setup</span>
            <span class="text-muted" style="font-size: 0.8rem;">IDE extensions · Claude Code · Codex</span>
            <span class="text-muted d-none d-md-inline" style="font-size: 0.75rem;">Install the tools each developer uses.</span>
          </div>
          <button @click="pilotSetupExpanded = true; persistPilotSetup()" class="btn btn-sm btn-link text-decoration-none py-0 px-1">
            Set up developers <i class="bi bi-chevron-down ms-1"></i>
          </button>
        </div>

        <!-- Expanded state: full controls -->
        <div v-else>
          <div class="d-flex align-items-center justify-content-between flex-wrap gap-1 mb-1">
            <span class="fw-bold small"><i class="bi bi-rocket-takeoff me-1"></i>Pilot setup</span>
            <button @click="pilotSetupExpanded = false; showBridgeSetup = false; showCodexSetup = false; showCursorAgentSetup = false; showIdeSetup = false; persistPilotSetup()" class="btn btn-sm btn-link text-decoration-none py-0 px-1">
              Collapse <i class="bi bi-chevron-up ms-1"></i>
            </button>
          </div>

          <p class="mb-1 text-muted" style="font-size: 0.75rem;">Each developer installs the clients for the tools they use, with their own enrollment code.</p>

          <div class="pilot-setup-rows">
            <!-- IDE Extension -->
            <div class="pilot-setup-row">
              <i class="bi bi-code-square pilot-setup-row-icon"></i>
              <div class="pilot-setup-row-text">
                <span class="pilot-setup-row-name">IDE Extension</span>
                <span class="pilot-setup-row-desc">VS Code / Cursor / Devin</span>
              </div>
              <div class="pilot-setup-row-actions">
                <a :href="pilotApiBase + '/api/extension/download/latest'" class="btn btn-sm btn-outline-secondary" download="chaosmonkey-telemetry-0.4.1.vsix">
                  <i class="bi bi-download me-1"></i>Download
                </a>
                <button @click="showIdeSetup = true; showBridgeSetup = false; showCodexSetup = false; showCursorAgentSetup = false" class="btn btn-sm btn-outline-primary" aria-haspopup="dialog">
                  <i class="bi bi-list-task me-1"></i>Setup
                </button>
              </div>
            </div>

            <!-- Claude Code Bridge -->
            <div class="pilot-setup-row">
              <i class="bi bi-terminal pilot-setup-row-icon"></i>
              <div class="pilot-setup-row-text">
                <span class="pilot-setup-row-name">Claude Code</span>
                <span class="pilot-setup-row-desc">Terminal</span>
              </div>
              <div class="pilot-setup-row-actions">
                <a :href="pilotApiBase + '/api/bridge/download/latest'" class="btn btn-sm btn-outline-secondary" download="chaosmonkey-cc-bridge-0.4.1-cc-bridge.tgz">
                  <i class="bi bi-download me-1"></i>Download
                </a>
                <button @click="showBridgeSetup = true; showCodexSetup = false; showCursorAgentSetup = false; showIdeSetup = false" class="btn btn-sm btn-outline-primary" aria-haspopup="dialog">
                  <i class="bi bi-list-task me-1"></i>Setup
                </button>
              </div>
            </div>

            <!-- Codex Bridge -->
            <div class="pilot-setup-row">
              <i class="bi bi-cpu pilot-setup-row-icon"></i>
              <div class="pilot-setup-row-text">
                <span class="pilot-setup-row-name">Codex</span>
                <span class="pilot-setup-row-desc">OpenAI Codex CLI</span>
              </div>
              <div class="pilot-setup-row-actions">
                <a :href="pilotApiBase + '/api/codex-bridge/download/latest'" class="btn btn-sm btn-outline-secondary" download="chaosmonkey-codex-bridge-0.4.1-codex-bridge.tgz">
                  <i class="bi bi-download me-1"></i>Download
                </a>
                <button @click="showCodexSetup = true; showBridgeSetup = false; showCursorAgentSetup = false; showIdeSetup = false" class="btn btn-sm btn-outline-primary" aria-haspopup="dialog">
                  <i class="bi bi-list-task me-1"></i>Setup
                </button>
              </div>
            </div>

            <!-- Cursor Agents companion — subordinate row, only when this
                 pilot's backend advertises the capability -->
            <div v-if="cursorAgentBridgeAvailable" class="pilot-setup-row pilot-setup-row-sub">
              <i class="bi bi-robot pilot-setup-row-icon"></i>
              <div class="pilot-setup-row-text">
                <span class="pilot-setup-row-name">Cursor Agents companion</span>
                <span class="pilot-setup-row-desc">Optional · For Cursor's standalone Agents Window</span>
              </div>
              <div class="pilot-setup-row-actions">
                <button @click="showCursorAgentSetup = true; showBridgeSetup = false; showCodexSetup = false; showIdeSetup = false" class="btn btn-sm btn-outline-primary" aria-haspopup="dialog">
                  <i class="bi bi-gear me-1"></i>Configure
                </button>
              </div>
            </div>
          </div>

          <div class="mt-1 pt-1 border-top">
            <span class="text-muted" style="font-size: 0.75rem;">Pilot API base URL: </span>
            <code style="font-size: 0.75rem;">{{ pilotApiBase }}</code>
          </div>
        </div>
      </div>
    </div>

    <!-- Setup Instructions Modal (IDE / Claude Code / Codex / Cursor companion) -->
    <div v-if="showBridgeSetup || showCodexSetup || showCursorAgentSetup || showIdeSetup" class="modal fade show d-block pilot-setup-modal" tabindex="-1" role="dialog" aria-modal="true" @click.self="showBridgeSetup = false; showCodexSetup = false; showCursorAgentSetup = false; showIdeSetup = false">
      <div class="modal-dialog modal-dialog-centered pilot-setup-dialog">
        <div class="modal-content pilot-setup-card">
          <header class="pilot-setup-modal-header">
            <i :class="showBridgeSetup ? 'bi bi-terminal' : (showCodexSetup ? 'bi bi-cpu' : (showIdeSetup ? 'bi bi-code-square' : 'bi bi-robot'))" class="pilot-setup-modal-icon"></i>
            <div>
              <h5 class="pilot-setup-modal-title">{{ showBridgeSetup ? 'Claude Code Setup' : (showCodexSetup ? 'Codex Setup' : (showIdeSetup ? 'IDE Extension Setup' : 'Cursor Agents Companion')) }}</h5>
              <div class="pilot-setup-modal-subtitle">{{ showCursorAgentSetup ? 'Optional companion for Cursor\u2019s standalone Agents Window' : (showIdeSetup ? 'Connect your editor to your ChaosMonkey pilot' : 'Connect this CLI to your ChaosMonkey pilot') }}</div>
            </div>
            <button type="button" class="pilot-setup-close" aria-label="Close" @click="showBridgeSetup = false; showCodexSetup = false; showCursorAgentSetup = false; showIdeSetup = false">
              <i class="bi bi-x-lg"></i>
            </button>
          </header>
          <div class="pilot-setup-modal-body">
            <ol v-if="showIdeSetup" class="pilot-setup-steps">
              <li><span class="step-num">1</span><div class="step-text">Install the VSIX in VS Code, Cursor, or Devin (Extensions → Install from VSIX…).</div></li>
              <li><span class="step-num">2</span><div class="step-text">Open the Command Palette and run <code>ChaosMonkey: Connect</code>.</div></li>
              <li><span class="step-num">3</span><div class="step-text">When prompted, enter the pilot API base URL:<br><code class="d-inline-block mt-1 user-select-all">{{ pilotApiBase }}</code></div></li>
              <li><span class="step-num">4</span><div class="step-text">Enter your enrollment code when prompted.</div></li>
            </ol>
            <ol v-else-if="showBridgeSetup" class="pilot-setup-steps">
              <li><span class="step-num">1</span><div class="step-text">Download and extract the bridge tarball.</div></li>
              <li><span class="step-num">2</span><div class="step-text">Run <code>node install.js</code> from the extracted <code>package/</code> directory.</div></li>
              <li><span class="step-num">3</span><div class="step-text">When prompted, enter the pilot API base URL:<br><code class="d-inline-block mt-1 user-select-all">{{ pilotApiBase }}</code></div></li>
              <li><span class="step-num">4</span><div class="step-text">Enter your enrollment code when prompted.</div></li>
              <li><span class="step-num">5</span><div class="step-text">Start Claude Code normally.</div></li>
            </ol>
            <ol v-else-if="showCodexSetup" class="pilot-setup-steps">
              <li><span class="step-num">1</span><div class="step-text">Download and extract the bridge tarball.</div></li>
              <li><span class="step-num">2</span><div class="step-text">Run <code>node install.js</code> from the extracted <code>package/</code> directory.</div></li>
              <li><span class="step-num">3</span><div class="step-text">When prompted, enter the pilot API base URL:<br><code class="d-inline-block mt-1 user-select-all">{{ pilotApiBase }}</code></div></li>
              <li><span class="step-num">4</span><div class="step-text">Enter your enrollment code when prompted.</div></li>
              <li><span class="step-num">5</span><div class="step-text">Start Codex, open <code>/hooks</code>, review the ChaosMonkey hook, and trust it.</div></li>
            </ol>
            <ol v-else class="pilot-setup-steps">
              <li><span class="step-num">1</span><div class="step-text">Download the bridge tarball and verify its SHA-256:<br><code class="d-inline-block mt-1 user-select-all">{{ cursorAgentBridgeManifest?.sha256 || '972acbc5c02efccac995484c80534e34f28de837a1e65a72520286353d2bbe21' }}</code></div></li>
              <li><span class="step-num">2</span><div class="step-text">Extract the archive, then from the extraction directory run:
                <div class="pilot-setup-cmd mt-1">
                  <code class="pilot-setup-cmd-text user-select-all">{{ cursorAgentInstallCommand }}</code>
                  <button type="button" class="btn btn-sm btn-link py-0 px-1 text-nowrap text-decoration-none pilot-setup-cmd-copy" @click="copyCompanionInstallCommand">{{ companionCmdCopied ? 'Copied' : 'Copy command' }}</button>
                </div>
              </div></li>
              <li><span class="step-num">3</span><div class="step-text">Use your existing enrollment code — the same code as your other integrations.</div></li>
              <li><span class="step-num">4</span><div class="step-text">A companion to the Cursor IDE extension — it covers the standalone Agents Window only.</div></li>
              <li><span class="step-num">5</span><div class="step-text">The installer sends a connectivity test event. Genuine Cursor agent activity is still required before agent coverage is verified.</div></li>
            </ol>
          </div>
          <footer class="pilot-setup-modal-footer">
            <span class="footnote">Use the enrollment code provided by your ChaosMonkey administrator.</span>
            <a v-if="showCursorAgentSetup" :href="pilotApiBase + '/api/cursor-agent-bridge/download/latest'" class="btn btn-sm btn-outline-secondary text-nowrap" :download="cursorAgentBridgeManifest?.filename || 'chaosmonkey-cursor-agent-bridge-0.4.2-cursor-bridge.tgz'">
              <i class="bi bi-download me-1"></i>Download companion
            </a>
            <button type="button" class="btn btn-sm btn-outline-secondary" @click="showBridgeSetup = false; showCodexSetup = false; showCursorAgentSetup = false; showIdeSetup = false">Done</button>
          </footer>
        </div>
      </div>
    </div>

    <!-- Performance Insights Panel -->
    <!-- Main Dashboard Content -->
    <div class="container-fluid">
      <div class="row">
        <div class="col-12">
          <div class="dashboard-card">
            <div class="card-body p-0">
              <!-- CR-X Pass 2 (A): GitHub engineering-evidence truth badge + Pilot Health link -->
              <div class="d-flex justify-content-end align-items-center gap-3 px-3 pt-2">
                <router-link
                  to="/settings?tab=operator"
                  class="pilot-health-link"
                  title="View pilot health: telemetry freshness, extension versions, auth, GitHub evidence"
                >
                  <i class="bi bi-activity me-1"></i>Pilot Health
                </router-link>
                <span
                  :class="githubEvidenceBadge.class"
                  :title="githubEvidenceBadge.title"
                  style="font-size: 0.75rem;"
                >{{ githubEvidenceBadge.label }}</span>
              </div>

              <!-- Tab Navigation -->
              <ul class="nav nav-tabs" id="dashboardTabs" role="tablist">
                <li class="nav-item" role="presentation">
                  <button
                    class="nav-link"
                    :class="{ active: !pbtActive }"
                    id="insights-tab"
                    data-bs-toggle="tab"
                    data-bs-target="#insights"
                    type="button"
                    role="tab"
                    aria-controls="insights"
                    :aria-selected="!pbtActive"
                  >
                    <i class="bi bi-lightbulb me-2"></i>Performance Insights
                  </button>
                </li>
                <li class="nav-item" role="presentation">
                  <button
                    class="nav-link"
                    :class="{ active: pbtActive }"
                    id="productivity-tab"
                    data-bs-toggle="tab"
                    data-bs-target="#productivity"
                    type="button"
                    role="tab"
                    aria-controls="productivity"
                    :aria-selected="pbtActive"
                  >
                    <i class="bi bi-graph-up me-2"></i>Productivity by Tool Over Time
                  </button>
                </li>
                <!-- AI Spend & ROI tab removed (CR-X closure): the SpendROI mock
                     surface was removed to comply with the evidence/economics
                     doctrine. Do not reintroduce a tab pointing at a mock ROI
                     surface. The accepted unit-economics PIs remain canonical. -->
              </ul>

              <!-- Global Time Context Bar -->
              <div class="time-context-bar">
                <div v-if="canonicalSessionCount > 0" class="time-context-chip time-context-chip--primary">
                  <i class="bi bi-calendar-range me-1"></i>
                  <span>Baseline: all historical telemetry. Longitudinal cards show observed period windows.</span>
                </div>
                <div v-if="canonicalSessionCount > 0" class="time-context-divider"></div>
                <div class="time-context-chip">
                  <i class="bi bi-laptop me-1"></i>
                  <span>{{ trackedWorkflowsCount }} tracked workflows</span>
                </div>
                <div class="time-context-chip">
                  <i class="bi bi-stars me-1"></i>
                  <span>{{ primaryWorkflowsCount }} primary workflows</span>
                </div>
                <div class="time-context-chip">
                  <i class="bi bi-git me-1"></i>
                  <span>{{ repoCount }} repo identities observed</span>
                </div>
                <div class="time-context-live-indicator">
                  <span class="live-dot"></span>
                  <span>{{ telemetryStatusShort }}</span>
                </div>
                <div class="time-context-operational-text">
                  <span>{{ telemetryStatusPhrase }}</span>
                </div>
              </div>

              <!-- Tab Content -->
              <div class="tab-content" id="dashboardTabContent">
                <!-- Performance Insights Tab (First) -->
                <div
                  class="tab-pane fade"
                  :class="{ show: !pbtActive, active: !pbtActive }"
                  id="insights"
                  role="tabpanel"
                  aria-labelledby="insights-tab"
                >
                  <div class="p-2">

                    <!-- K1B: Cohort scope selector — scopes the canonical
                         session population for AI Ops + Performance Insights.
                         Same analysisContext authority as the PBT selector. -->
                    <div class="pi-cohort-scope-row">
                      <label class="pi-cohort-scope-label" for="pi-cohort-select">
                        <i class="bi bi-people me-1"></i>Cohort
                      </label>
                      <select id="pi-cohort-select" v-model="piCohortSelection" class="form-select form-select-sm pi-cohort-select">
                        <option value="">All Cohorts</option>
                        <option value="unassigned">Unassigned</option>
                        <option v-for="c in piCohorts" :key="c.id" :value="String(c.id)">{{ c.name }} · {{ c.member_count }}</option>
                      </select>
                      <span v-if="cohortFilterActive" class="pi-cohort-scope-note">
                        Metrics use current cohort membership across the selected period.
                      </span>
                    </div>

                    <!-- AI Usage Signals + DORA Metrics (UI-only components, mockable) -->
                    <div class="cicd-section mb-1 stage-ai-usage ai-drilldown-secondary">
                      <div class="card-body">
                        <AIUsageSignalsSection
                          :metrics="aiUsageForUI"
                          :doraMetrics="doraForUI"
                          :prodSeries="aiUsageSessionsCurrent"
                          :prevProdSeries="aiUsageSessionsPrev"
                          :sessions="sessionsForUI"
                          :canonicalAggregated="canonicalAggregated"
                          :canonicalAggregatedMetadata="canonicalAggregatedMetadata"
                          :canonicalHydrating="aioiHydrating"
                          :canonicalError="canonicalError"
                          :evidenceCompleteness="evidenceCompleteness"
                          :evidenceStatusLabel="evidenceStatusLabel"
                          :observedAuthority="observedCommitTtfcAuthority"
                          @signal-click="handleAISignalClick"
                        />
                      </div>
                    </div>

                    <!-- Performance Insights Section - unified with AI Ops visual treatment -->
                    <div id="performance-insights" class="cicd-section mb-1 stage-performance-insights">
                      <div class="card-body" style="padding: 0.75rem !important;">
                        <!-- P0-G Part F: Auth Error Banner — distinguishes auth failure from empty data -->
                        <div v-if="authStore.authError === 'AUTH_REQUIRED'" class="alert alert-warning mb-2" role="alert">
                          <strong>Session expired</strong> — Your authentication has expired. Please <a href="#" @click.prevent="handleSessionExpired">log in again</a> to view your data.
                        </div>
                        <div v-else-if="authStore.authError === 'ACCESS_DENIED'" class="alert alert-danger mb-2" role="alert">
                          <strong>Access denied</strong> — Your account does not have access to this data. Contact your administrator.
                        </div>
                        <div v-else-if="authStore.authError === 'SERVER_UNAVAILABLE'" class="alert alert-secondary mb-2" role="alert">
                          <strong>Server unavailable</strong> — The backend could not be reached. Data shown may be incomplete.
                        </div>

                        <!-- Audit Warning Banner (RED for failures) -->
                        <div v-if="piAuditErrors?.length > 0" class="alert alert-danger mb-2" role="alert">
                          <strong>FINAL ENGINE ROUTING FAILURE</strong> — falling back to legacy compute
                          <ul class="mb-0 mt-1">
                            <li v-for="(error, idx) in piAuditErrors" :key="idx">{{ error }}</li>
                          </ul>
                        </div>
                        
                        <!-- CR-X 2B.1: PI Population Scope Banner -->
                        <!-- When PBT developer/repo filters are active, PIs still
                             describe the org-wide canonical population. This banner
                             makes that distinction visible.
                             K1B: cohort scope DOES scope PI — the banner states the
                             actual population instead of claiming org-wide. -->
                        <div v-if="pbtFilterActive || cohortFilterActive" class="pi-population-scope-banner">
                          <span class="pi-population-scope-icon">ℹ</span>
                          <span class="pi-population-scope-text">
                            <template v-if="cohortFilterActive">
                              Performance Insights reflect the selected cohort's current membership
                              across the selected period.<template v-if="pbtFilterActive">
                              Developer and repository filters still apply only to the PBT evidence view below.</template>
                            </template>
                            <template v-else>
                              Performance Insights describe the organization-wide canonical population.
                              Developer and repository filters apply to the PBT evidence view below.
                            </template>
                          </span>
                        </div>

                        <!-- Insights Widget (receives insights from parent) -->
                        <PerformanceInsightsWidget
                          :insights="insightsToPass"
                          :ide-diagnostics="ideDiagnostics"
                          :view-mode="v2ShadowEnabled ? 'strip-v2' : 'strip'"
                          :pi-run-id="piRunId"
                          :selected-p-i-id="selectedPIId"
                          :has-any-data="hasAnyDataForPI"
                          :canonical-hydrating="canonicalHydrating || isRefreshingPI"
                          :evidence-completeness="evidenceCompleteness"
                          :evidence-status-label="evidenceStatusLabel"
                        />
                      </div>
                    </div>

                    <!-- PI Engine Audit Panel (hidden in demo mode) -->
                    <PIEngineAuditPanel v-if="!v2ShadowEnabled" />
                  </div>
                </div>
                
                <!-- Productivity Tab (Second) -->
                <div
                  class="tab-pane fade"
                  :class="{ show: pbtActive, active: pbtActive }"
                  id="productivity"
                  role="tabpanel"
                  aria-labelledby="productivity-tab"
                >
                  <div class="cicd-section mb-1 stage-productivity">
                    <div class="card-body" style="padding: 0.75rem !important;">
                      
                      <!-- Section Header with Toggle -->
                      <div class="d-flex align-items-center justify-content-between mb-2">
                        <div class="d-flex align-items-center gap-2">
                          <div class="stage-icon-wrapper bg-primary">
                            <i class="bi bi-cpu text-white"></i>
                          </div>
                          <div>
                            <h5 class="mb-0 fw-semibold">AI Tool Performance Overview</h5>
                            <small class="text-muted">Operational telemetry across IDEs and coding workflows</small>
                          </div>
                        </div>
                        <!-- Productivity V3 is now the canonical experience - view selector removed -->
                      </div>
                      
                      <div v-if="productivityError" class="card">
                        <div class="card-body text-center py-5">
                          <i class="bi bi-exclamation-triangle text-warning mb-3" style="font-size: 2rem;"></i>
                          <h6 class="text-muted mb-2">Productivity analytics temporarily unavailable</h6>
                          <p class="text-muted small mb-3">Please try refreshing the page</p>
                          <button @click="productivityError = false" class="btn btn-sm btn-outline-primary">Retry</button>
                        </div>
                      </div>
                      
                      <!-- CR-X PERF P0/P1: Lazy-first-mount + retain PBT.
                           v-if gates first mount so PBT does not initialize/fetch
                           on PI hard load. KeepAlive retains the mounted instance
                           after the first visit so subsequent tab switches do not
                           refetch or rebuild. -->
                      <KeepAlive>
                        <Suspense v-if="pbtEverVisited" @error="productivityError = true">
                          <template #default>
                            <!-- Productivity V3 - Canonical Experience -->
                            <ProductivityByToolV3
                              :insights="insights"
                              :github-metrics="githubMetrics"
                              :github-loading="githubLoading"
                              :github-error="githubError"
                              :github-connected="githubConnectedCanonical"
                              :github-ready="githubReady"
                              :canonical-hydrating="canonicalHydrating"
                              :authoritative-sessions="authoritativeCanonicalSessions"
                              :resolved-cost-configs="resolvedCostConfigs"
                              :cost-config-authority="costConfigAuthority"
                              :is-active="pbtActive"
                              @refresh-cost-configs="refreshCostConfigs"
                              @vue:mounted="onPbtMounted"
                            />
                          </template>
                          <template #fallback>
                            <div class="text-center py-5">
                              <div class="spinner-border text-info" role="status">
                                <span class="visually-hidden">Loading...</span>
                              </div>
                              <p class="mt-3 text-muted">Loading Productivity Analytics...</p>
                            </div>
                          </template>
                        </Suspense>
                      </KeepAlive>
                    </div>
                  </div>
                </div>
                
                <!-- AI Spend & ROI tab removed (CR-X closure): the SpendROI component
                     rendered hardcoded mock ROI/productivity scores and a false
                     "Live Data" badge, conflicting with the evidence/economics
                     doctrine. The accepted unit-economics PIs (Review/Merge,
                     Deploy, Successful Deploy) remain the canonical cost surface.
                     Do not reintroduce a mock ROI surface. -->
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
declare global {
  interface Window {
    __CM_PI_PIPELINE_DEBUG__?: any;
  }
}

import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { defineAsyncComponent, ref, computed, onMounted, onUnmounted, watch, watchEffect, onUpdated } from 'vue'
import { raceLog } from '../lib/debugLogs'
import NavUserAvatar from '../components/NavUserAvatar.vue'
import { usePreferencesStore } from '../stores/preferences'
import { error as logError } from '../utils/logger'
import api, { authenticatedFetch, API_URL } from '../config/api'
import { resolveGithubEvidenceState } from '../lib/githubEvidenceState'
import PerformanceInsightsWidget from '../components/PerformanceInsightsWidget.vue'
import InsightChips from '../components/InsightChips.vue'
import AIUsageSignalsSection from '../components/performance/AIUsageSignalsSection.vue'
import { getCanonicalAggregated } from '../lib/api/canonicalTelemetry'
import { fetchSharedEnrichedCanonical, fetchGithubSnapshot, resolveGithubSnapshotForPI, getLastSessionFetchCompleteness, clearSessionPrimitivesCache } from '../lib/insights/final/dataAccess'
import { resolveCanonicalGithubInput } from '../lib/insights/final/canonicalGithubResolver'
import ExecutiveFindingsSection from '../components/ExecutiveFindingsSection.vue'
import { isDebugEnabled } from '../lib/perf/debugGate'
import DoraMetricsSection from '../components/performance/DoraMetricsSection.vue'
import aiUsageMocksJson from '../mocks/ai_usage_signals.mock.json'
import doraMetricsMocksJson from '../mocks/dora_metrics.mock.json'
import { useGitHubStore } from '../stores/github'
import { useMetricsFacadeStore } from '../stores/metricsFacade'
import { useFilterStore } from '../stores/filters'
import { useAnalysisContextStore, ALL_TIME_START } from '../stores/analysisContext'
import { deriveGranularity } from '../lib/insights/time'
import { probeCursorAgentBridge } from '../lib/setupInstructions'
import { mapGitHubToEngOutputByGranularity, mapProductivityToToolsByGranularity } from '../lib/insights/providers'
import { runPerfInsightsHarness } from '../lib/insights/harness'
import { DEMO_MODE } from '../lib/insights/performanceEngine'
import { getProductivitySummary } from '../services/metricsFacade'
import type { PerformanceInsight, EngOutputPoint, ToolProductivityPoint, SessionDataPoint } from '../lib/insights/types'
import { generateFinalCanonicalInsights } from '../lib/insights/final'
import { deriveWorkflowCounts } from '../lib/workflowIdentity'
import { isLivePilotMode as isLivePilotModeCanonical, isLocalLabMode, getEvidenceMode, getTelemetryStatusPhrase, getTelemetryStatusShort } from '../lib/insights/runtimeMode'
import type { CanonicalInsightInput } from '../lib/insights/final/types'
import { getCanonicalPIIds } from '../lib/insights/final'
import { populateWindowPIAudit } from '../lib/insights/final/utils/audit'
import PIEngineAuditPanel from '../components/PIEngineAuditPanel.vue'
import { initializeQAAuditSystem } from '../lib/insights/v2/piQAAudit'
import { getToolLabel } from '../lib/insights/labels'
import { normalizeToolId } from '../lib/insights/toolId'
import { fetchSessionsForTTFC } from '../lib/insights/realDataBridge'
import { buildIdeDiagnostics } from '../lib/insights/ideDiagnostics'
import { isV2ShadowEnabled } from '../lib/insights/v2/shadow'
import { mark, measure, timeAsync, count, logSummary, clear } from '../lib/perf/devPerf'
import { fetchOrgToolCostConfigs, fetchOrgToolCostConfigsWithAuthority, type CostConfigAuthority } from '../lib/toolCost'

// V2 diagnostic logging (one-time per page load)
let v2DiagnosticPoint3Logged = false

// 🔥 RACE CONDITION INSTRUMENTATION
const RACE_DEBUG = (import.meta.env.VITE_RACE_DEBUG ?? 'true') === 'true'
let requestIdCounter = 0

// Local-only demo: hide the Pilot setup banner (API base URL + extension
// download) to recover vertical recording space. Customer/Patra/Ed envs do
// not set this flag, so their banner behavior is unchanged.
// CR-X R2: In dev mode, default to hidden unless explicitly overridden.
const hidePilotSetup = import.meta.env.DEV
  ? (import.meta.env.VITE_HIDE_PILOT_SETUP ?? 'true') === 'true'
  : (import.meta.env.VITE_HIDE_PILOT_SETUP ?? 'false') === 'true'

// CR-X: Pilot Setup collapsible admin utility
// Default: collapsed. Persists admin preference via localStorage.
const PILOT_SETUP_LS_KEY = 'cm_pilot_setup_expanded'
const showBridgeSetup = ref(false)
const showCodexSetup = ref(false)
const showCursorAgentSetup = ref(false)
const showIdeSetup = ref(false)
// Cursor Agents option is capability-gated: shown only when this pilot's
// backend advertises the verified manifest via the authoritative
// /api/cursor-agent-bridge/capability endpoint (promoted route +
// hash-verified immutable artifact + canonicalization support, all
// checked server-side). Default false — fail-closed on any pilot whose
// backend has not been promoted. Result is cached per API base.
const cursorAgentBridgeAvailable = ref(false)
const cursorAgentBridgeManifest = ref<{ version: string; filename: string; sha256: string } | null>(null)
const pilotSetupExpanded = ref(false)

// Load persisted preference on mount
onMounted(() => {
  try {
    const saved = localStorage.getItem(PILOT_SETUP_LS_KEY)
    if (saved === 'true') pilotSetupExpanded.value = true
  } catch {}
  probeCursorAgentBridge(`${pilotApiBase.value}/api`).then((manifest) => {
    cursorAgentBridgeManifest.value = manifest
    cursorAgentBridgeAvailable.value = manifest !== null
  })
})

function persistPilotSetup() {
  try {
    localStorage.setItem(PILOT_SETUP_LS_KEY, String(pilotSetupExpanded.value))
  } catch {}
}

function createRequestId(type: string): string {
  const id = `${type}_${++requestIdCounter}_${Date.now()}`
  raceLog('Created requestId', { id })
  return id
}

function logRaceEvent(event: string, data: any) {
  if (!RACE_DEBUG) return
  raceLog(event, {
    timestamp: Date.now(),
    requestId: data.requestId || 'none',
    ...data
  })
}

// ============================================================================
// AI USAGE SIGNALS MAPPING FUNCTION
// ============================================================================
/**
 * Map /api/productivity/summary totals to prodSeries format for AI Usage Signals
 * Transforms totals.{ide}.AI_suggestions_accepted → prodSeries[].aiAssists
 */
function mapSummaryTotalsToProdSeries(totals: Record<string, any>): any[] {
  if (!totals) return []
  
  // Group data by tool (extract tool name from keys like "cursor.AI_suggestions_accepted")
  const toolData: Record<string, Record<string, any>> = {}
  
  Object.entries(totals).forEach(([key, value]) => {
    const [tool, metric] = key.split('.')
    if (!tool || !metric) return
    
    if (!toolData[tool]) {
      toolData[tool] = {}
    }
    
    // Map metric name to field name
    const fieldMap: Record<string, string> = {
      'AI_suggestions_accepted': 'aiAssists',
      'commits_per_session': 'commits', 
      'active_coding_time_minutes': 'codingMinutes',
      'average_session_length_minutes': 'sessionMinutes',
      'AI_usage_duration_minutes': 'aiUsageMinutes',
      'idle_time_minutes': 'idleMinutes',
      'files_edited_per_session': 'filesEdited',
      'time_to_first_commit_minutes': 'ttfcMinutes',
      'AI_suggestions_shown': 'aiSuggestionsShown',
      'AI_acceptance_rate_percent': 'aiAcceptanceRate',
      'focus_ratio': 'focusRatio'
    }
    
    const fieldName = fieldMap[metric] || metric
    toolData[tool][fieldName] = value
  })
  
  // Convert to prodSeries format
  return Object.entries(toolData).map(([tool, data]) => ({
    tool: tool.toLowerCase(),
    aiAssists: Number(data.aiAssists ?? 0),
    commits: Number(data.commits ?? 0),
    codingMinutes: Number(data.codingMinutes ?? 0),
    sessionMinutes: Number(data.sessionMinutes ?? 0),
    source: 'live',
    period: 'current',
    // Include additional fields that might be useful
    aiUsageMinutes: Number(data.aiUsageMinutes ?? 0),
    idleMinutes: Number(data.idleMinutes ?? 0),
    filesEdited: Number(data.filesEdited ?? 0),
    ttfcMinutes: Number(data.ttfcMinutes ?? 0),
    aiSuggestionsShown: Number(data.aiSuggestionsShown ?? 0),
    aiAcceptanceRate: Number(data.aiAcceptanceRate ?? 0),
    focusRatio: Number(data.focusRatio ?? 0)
  }))
}

// =====================================
// Scoped debug logger — declared before any executable use.
// Does NOT mutate global console. Gates all dev trace logging in this file.
// =====================================
const PI_DEBUG_ENV = (import.meta as any).env?.VITE_PI_DEBUG ?? 'false'
const PI_DEBUG = PI_DEBUG_ENV === 'true' || PI_DEBUG_ENV === '1'
const dashLog = (...args: any[]) => { if (PI_DEBUG) console.log(...args) }

// =====================================
// PHASE 3A: SAFE PI BREAKDOWN INSTRUMENTATION
// =====================================
// DEV-only helper to compute stable PI output signature
function piSignature(rows: any[]): string {
  if (!import.meta.env.DEV) return ''
  if (!Array.isArray(rows)) return '[]'
  return rows.map(r => `${r.id}|${r.stage}|${r.ruleId||r.title}`).sort().join(';')
}

// =====================================
// PHASE 0: TRACE HELPERS (INSTRUMENTATION ONLY)
// =====================================
function cmTraceId(prefix = "pi") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cmMark(traceId, label, extra) {
  dashLog(
    `🧭 [CM_TRACE] ${traceId} :: ${label}`,
    extra ?? ""
  );
}

// 🔥 TAB SWITCHING DEBOUNCE (component scope)
let tabSwitchTimeout: number | null = null

// 🔥 REQUIRED VARIABLES: Still used in other parts of the component
const v2ShadowEnabled = ref(true)
const productivityError = ref(false)
// productivityViewMode removed - V3 is now the canonical experience
// CR-X PERF P0/P1: Lazy-first-mount + retain PBT.
// PBT is NOT mounted on hard load (PI is the visible surface). It mounts
// exactly once on the first visit to the Productivity tab, then stays
// alive (KeepAlive) so subsequent PI ↔ PBT switching is instant and does
// not refetch/rebuild. This removes hidden PBT network/reactive work from
// the PI startup critical path.
//
// CR-X 17G.8: Resolve the cold-entry surface synchronously during setup —
// before first render, before watchers, and before any scheduler can
// initiate PI hydration. A #productivity entry marks PBT active
// immediately; the template binds to these refs so there is no transient
// default-to-PI state. The sessionStorage stash covers the unauthenticated
// /dashboards → /login redirect, which drops window.location.hash before
// Dashboards mounts (stashed in main.ts before app.use(router)). Consuming
// it restores the hash so URL truth and [DASH_PI][STARTUP_DECISION].windowHash
// still record '#productivity'.
const initialPbtEntry = (() => {
  try {
    const h = window.location.hash
    if (h === '#productivity') return true
    if (h) {
      // An explicit non-productivity surface hash wins over any stash.
      sessionStorage.removeItem('cm_entry_surface_hash')
      return false
    }
    if (sessionStorage.getItem('cm_entry_surface_hash') === '#productivity') {
      sessionStorage.removeItem('cm_entry_surface_hash')
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}#productivity`
      )
      return true
    }
  } catch {}
  return false
})()
const pbtEverVisited = ref(initialPbtEntry)
const pbtActive = ref(initialPbtEntry)
const pbtMountedCount = ref(0)
// CR-X PERF P0/P1: Instrumentation hook for PBT mount count.
// Called from the @vnode-mounted directive on ProductivityByToolV3 so we
// can prove lazy-first-mount (count=0 on PI hard load) + retain (count
// stays at 1 across subsequent tab switches).
function onPbtMounted() {
  pbtMountedCount.value++
  // 18B.4: PBT owns its cost-config authority fetch. refreshPI (and its
  // cost fetch) is deliberately skipped while the PBT surface is active,
  // so without this the editor hydrates from stale localStorage.
  void refreshCostConfigs()
  if (import.meta.env.DEV) dashLog('[CR-X_PERF][PBT_MOUNTED] count=', pbtMountedCount.value)
}
const piRunId = ref<number>(0)
const currentCycleId = ref<string>('')
const TTFC_DEBUG = (import.meta.env.VITE_TTFC_DEBUG ?? 'false') === 'true'
const PI_PIPELINE_DEBUG = (import.meta.env.VITE_PI_PIPELINE_DEBUG ?? 'false') === 'true'
// CR-X Phase 3: Compact stage timing gate. When enabled, emits a single
// compact single-line timing record per refreshPI. Does NOT log large
// objects, arrays, or per-generator/per-card traces.
const PI_STAGE_TIMING = (import.meta.env.VITE_PI_STAGE_TIMING ?? 'false') === 'true'
// Compact stage timing collector — accumulates per-stage durations and
// emits a single machine-readable line at refreshPI completion.
const _stageTimings: Record<string, number> = {}
function stageMark(stage: string, ms: number): void {
  if (!PI_STAGE_TIMING) return
  _stageTimings[stage] = ms
}
function flushStageTimings(totalMs: number): void {
  if (!PI_STAGE_TIMING) return
  const parts = Object.entries(_stageTimings)
    .map(([k, v]) => `${k}=${Math.round(v)}`)
    .join(' ')
  console.log(`[PI_STAGE] total=${Math.round(totalMs)} ${parts}`)
  for (const k of Object.keys(_stageTimings)) delete _stageTimings[k]
}

function makeId(prefix = 'cycle'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function startNewCycle(source: string): string {
  const cycleId = makeId(source)
  currentCycleId.value = cycleId
  if (RACE_DEBUG) {
    dashLog(`🔍 [CYCLE] Started new cycle: ${cycleId} from ${source}`)
  }
  return cycleId
}

dashLog('[AI_USAGE_DEBUG] build stamp', new Date().toISOString())

function scrollToPerformanceInsights() {
  try {
    const el = document.getElementById('performance-insights')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (e) {
    console.warn('Scroll to performance insights failed', e)
  }
}

// Deterministic mapping from AI Ops signal IDs to PI IDs for demo drilldown
// Maps the 4 canonical signals from AI_SIGNAL_REGISTRY to their primary PIs
function mapSignalToPI(signalId: string): string {
  const signalToPIMap: Record<string, string> = {
    'ai-adoption-standardization': 'active-coding-time-by-ide',
    'workflow-velocity': 'ai-suggestions-accepted-by-ide',
    'review-quality-risk': 'pr-review-cycles-by-ide',
    'tool-fragmentation-variance': 'delivery-rate-ai-vs-non-ai'
  }
  return signalToPIMap[signalId] || ''
}

// Track selected PI for highlighting
const selectedPIId = ref<string>('')

// Handle AI Ops signal click - log event, scroll to PI, and select/highlight
function handleAISignalClick(signalId: string, linkedInsights: string[]) {
  dashLog('[AI_OPS_TO_PI_DRILLDOWN]', {
    signalId,
    linkedInsights,
    timestamp: new Date().toISOString()
  })
  
  // Map signal to PI using deterministic mapping
  const targetPIId = mapSignalToPI(signalId)
  
  if (targetPIId) {
    dashLog('[AI_OPS_TO_PI_DRILLDOWN] Selected PI:', targetPIId)
    selectedPIId.value = targetPIId
    
    // Scroll to Performance Insights section
    scrollToPerformanceInsights()
    
    // Highlight the selected PI briefly
    setTimeout(() => {
      const piElement = document.querySelector(`[data-insight-id="${targetPIId}"]`)
      if (piElement) {
        piElement.classList.add('pi-highlight-flash')
        setTimeout(() => {
          piElement.classList.remove('pi-highlight-flash')
        }, 2000)
      }
    }, 300)
  } else {
    // Fallback: just scroll if no mapping
    scrollToPerformanceInsights()
  }
}

onMounted(() => {
  // CR4 Task 2: Use canonical runtime mode authority
  const isLivePilotRuntime = isLivePilotModeCanonical()

  if (isLivePilotRuntime) {
    dashLog('[LIVE_PILOT_CACHE_CLEAR] Clearing all PI and GitHub cache keys')
    localStorage.removeItem('performance_insights_snapshot')
    localStorage.removeItem('performance_insights_timestamp')
    localStorage.removeItem('performance_insights_demo_snapshot')
    localStorage.removeItem('performance_insights_demo_timestamp')
    localStorage.removeItem('cm_archived_pi_ids')
    Object.keys(sessionStorage).forEach(k => {
      if (
        k.toLowerCase().includes('github') ||
        k.toLowerCase().includes('gh_') ||
        k.toLowerCase().includes('performance_insights') ||
        k.toLowerCase().includes('pi_')
      ) {
        sessionStorage.removeItem(k)
      }
    })
  }

  // Redirect fresh OAuth logins to onboarding/connect if not yet completed
  if (route.query.github === 'connected') {
    const connectCompleted = sessionStorage.getItem('codesight_onboarding_connect')
    if (!connectCompleted) {
      router.replace('/connect')
      return
    }
  }

  // 🎯 PERFORMANCE: Start timing
  mark('dashboards_mount_start')
  count('dashboards_mount')
  
  dashLog('[DASHBOARD_MOUNT_START] onMounted function started');
  dashLog('[DASHBOARD_MOUNT_START] Feature flags:', {
    VITE_FINAL_PI_ENGINE_ENABLED: import.meta.env.VITE_FINAL_PI_ENGINE_ENABLED,
    VITE_PI_QA_DISABLED: import.meta.env.VITE_PI_QA_DISABLED,
    VITE_FEATURE_PERF_INSIGHTS: import.meta.env.VITE_FEATURE_PERF_INSIGHTS,
    VITE_PI_DEBUG: import.meta.env.VITE_PI_DEBUG
  });
  
  v2ShadowEnabled.value = true // Force V2 mode enabled
  dashLog("[DASHBOARDS_STAMP] GH_UI_REF_FIX", window.location.href)
  
  // Initialize QA Audit System (now with bypass support)
  dashLog('[DASHBOARD_MOUNT_QA_INIT] Initializing QA audit system...');
  try {
    initializeQAAuditSystem()
    dashLog('[DASHBOARD_MOUNT_AFTER_QA] QA audit system initialized successfully');
  } catch (error) {
    console.error('[DASHBOARD_MOUNT_QA_ERROR] QA audit system failed:', error);
  }
  
  // 🔥 TAB SWITCHING INSTRUMENTATION (with debouncing to prevent race conditions)
  const TAB_SWITCH_DEBOUNCE_MS = 300 // 300ms debounce
  const ENABLE_TAB_DEBOUNCE = (import.meta.env.VITE_ENABLE_TAB_DEBOUNCE ?? 'true') === 'true'
  
  if (RACE_DEBUG) {
    dashLog(`🔍 [TAB_DEBOUNCE] ${ENABLE_TAB_DEBOUNCE ? 'ENABLED' : 'DISABLED'} (${TAB_SWITCH_DEBOUNCE_MS}ms)`)
  }
  
  const tabButtons = document.querySelectorAll('[data-bs-toggle="tab"]')
  tabButtons.forEach(button => {
    button.addEventListener('shown.bs.tab', (event) => {
      // CR-X PERF P0/P1: Lazy-first-mount PBT. The first time the user
      // clicks the Productivity tab, flip pbtEverVisited so the PBT
      // component mounts. KeepAlive retains it after that.
      const target = event.target as HTMLElement
      const targetPane = target.getAttribute('data-bs-target')
      if (targetPane === '#productivity' && !pbtEverVisited.value) {
        pbtEverVisited.value = true
        if (import.meta.env.DEV) dashLog('[CR-X_PERF][PBT_LAZY_MOUNT] first PBT visit — mounting ProductivityByToolV3')
      }
      // CR-X P0: Live active-state signal so ProductivityByToolV3 can guard
      // useTimeSeries fetches while the tab is hidden or inactive.
      pbtActive.value = (targetPane === '#productivity')

      // 18B.4: Re-fetch org cost authority whenever the PBT surface is
      // activated. refreshPI is skipped while PBT is active, so this is
      // the only path that keeps resolvedCostConfigs honest there.
      if (targetPane === '#productivity') {
        void refreshCostConfigs()
      }

      // CR-X 17F: Persist the active surface in the URL hash so a hard
      // refresh lands on the same surface and can skip inactive PI hydration.
      // Use Vue Router instead of raw history.replaceState so router state
      // remains consistent.
      try {
        const nextHash = targetPane === '#productivity' ? '#productivity' : '#insights'
        if (route.hash !== nextHash) {
          router.replace({ hash: nextHash }).catch(() => {})
        }
      } catch {
        // Non-fatal: tab state is already tracked by pbtActive.
      }

      // CR-X P0: When the user returns to the Performance Insights tab, force
      // PI to rehydrate with the current analysisContext (which may have changed
      // while PBT was active). The buildPIInputKey skip inside refreshPI will
      // still avoid duplicate work if nothing actually changed.
      if (targetPane === '#insights') {
        scheduleRefreshPI('insights-tab-activated', true)
      }

      // Clear any existing timeout
      if (tabSwitchTimeout) {
        clearTimeout(tabSwitchTimeout)
      }
      
      // Only debounce if enabled (default: true)
      if (ENABLE_TAB_DEBOUNCE) {
        // Debounce the tab switch logging
        tabSwitchTimeout = setTimeout(() => {
          const tabId = target.id
          
          logRaceEvent('TAB_SWITCHED', {
            tabId,
            targetPane,
            insightsCount: insights.value.length,
            githubMetricsCount: Object.keys(githubMetrics.value || {}).length,
            githubLoading: githubLoading.value,
            timestamp: Date.now()
          })
        }, TAB_SWITCH_DEBOUNCE_MS)
      } else {
        // No debounce - log immediately
        const tabId = target.id
        
        logRaceEvent('TAB_SWITCHED', {
          tabId,
          targetPane,
          insightsCount: insights.value.length,
          githubMetricsCount: Object.keys(githubMetrics.value || {}).length,
          githubLoading: githubLoading.value,
          timestamp: Date.now()
        })
      }
    })
  })

  // CR-X 17F: If the URL hash selects Productivity by Tool, activate the
  // Bootstrap tab so the visible pane matches the initial pbtActive surface.
  // The shown.bs.tab listener above will keep pbtActive in sync.
  const initialPbtSurface = initialPbtEntry || route.hash === '#productivity' || window.location.hash === '#productivity'
  if (initialPbtSurface) {
    pbtEverVisited.value = true
    pbtActive.value = true
    const productivityTab = document.getElementById('productivity-tab')
    const bootstrapTab = (window as any).bootstrap?.Tab
    if (productivityTab && bootstrapTab) {
      bootstrapTab.getOrCreateInstance(productivityTab).show()
    } else {
      // Fallback for environments where bootstrap is unavailable.
      document.getElementById('insights-tab')?.classList.remove('active')
      document.getElementById('insights')?.classList.remove('show', 'active')
      productivityTab?.classList.add('active')
      document.getElementById('productivity')?.classList.add('show', 'active')
    }
  }

  // 🔥 EXPLORATORY DEBUG: DEV-ONLY structured snapshot (no behavioral impact)
  if (import.meta.env.DEV) {
    dashLog('[DASH_DEBUG]', {
      route: window.location.pathname + window.location.search,
      component: 'Dashboards.vue',
      store_used: 'githubStore + metricsFacadeStore',
      hasOAuth: githubStore.metrics?.github_connected,
      githubKeys: Object.keys(githubStore.metrics || {}),
      total_prs: githubStore.metrics?.github_team_metrics?.total_prs,
      failed_deployments: githubStore.metrics?.deployment_metrics?.failed_deployment_count,
      pi_count: insights.value?.length,
      v2QueryParam: new URLSearchParams(window.location.search).get('v2'),
      v2ShadowEnabled: v2ShadowEnabled.value,
      timestamp: Date.now()
    });
  }
  
  // 🔥 SIMPLIFIED: Just call githubStore.fetchMetrics directly
  if (import.meta.env.DEV) dashLog('[GITHUB_FETCH] About to call githubStore.fetchMetrics()');
  timeAsync('github_fetch_onmount', () => 
    githubStore.fetchMetrics(githubTimeFilter.value, { source: 'Dashboards-onMounted', force: true })
  )
    .then(() => {
      if (import.meta.env.DEV) dashLog('[GITHUB_FETCH] githubStore.fetchMetrics() completed successfully');
      githubMetricsOk.value = true // CR-X P0-D: evidence-completeness tracking
      // Trigger PI recompute so GitHub-dependent PIs upgrade from insufficient→real data
      scheduleRefreshPI('github-fetch-complete')
    })
    .catch((err) => {
      console.error('[GITHUB_FETCH] githubStore.fetchMetrics() failed:', err);
      githubMetricsOk.value = false // CR-X P0-D: evidence-completeness tracking
    });

  // 18G.1: fetch canonical GitHub OAuth authority in parallel with metrics —
  // the header badge is authorized by oauth/status, not metrics success.
  refreshGithubOauthStatus()

  // Telemetry-observed repository identities for the header repo chip.
  // Distinct from GitHub engineering evidence: this counts normalized
  // git_repo_url identities observed in IDE telemetry, not OAuth-visible repos.
  fetchTelemetryRepoCount()

  // 🔥 FIX: MERGED from duplicate onMounted - Set initial mount state
  isInitialMount.value = true

  // 🔥 FIX: MERGED from duplicate onMounted - Prefer live telemetry on dashboards by default
  try {
    const storedMode = window?.localStorage?.getItem('telemetryMode')
    if (!storedMode) {
      metricsFacade.setTelemetryMode('live')
    }
  } catch {
    // ignore
  }

  // 🔥 FIX: MERGED from duplicate onMounted - Trigger PI computation
  if (PI_DEBUG && !didLogCallsiteOnMounted) {
    didLogCallsiteOnMounted = true
    dashLog('[PI_DEBUG][REFRESHPI_CALLSITE]', {
      callsite: 'onMounted',
      reason: 'initial dashboard mount schedules refreshPI',
      preconditions: {
        featureOn,
        VITE_FEATURE_PERF_INSIGHTS: import.meta.env.VITE_FEATURE_PERF_INSIGHTS,
      },
    })
  }

  if (import.meta.env.DEV) {
    // 17F.1: plain console.log under DEV (not PI_DEBUG-gated) so the browser
    // acceptance console always shows the startup decision and the URL it ran under.
    console.log('[DASH_PI][STARTUP_DECISION]', {
      url: window.location.href,
      routeFullPath: route.fullPath,
      routeHash: route.hash,
      windowHash: window.location.hash,
      initialPbtSurface,
      pbtActive: pbtActive.value,
      pbtEverVisited: pbtEverVisited.value,
      scheduleReason: 'initial-mount',
      willSkipBecausePbtActive: pbtActive.value,
    })
  }
  scheduleRefreshPI('initial-mount')

  // K1B: load active cohorts for the PI/AIOI cohort selector
  fetchPiCohorts()

  // CR-X Phase 3 PERF: Preload PBT JS chunk immediately on mount so it's
  // ready when the user clicks the PBT tab. This does NOT mount PBT — it
  // only prefetches the module code via Vite's dynamic import. The JS chunk
  // load does not compete with PHP backend workers.
  import('../components/ProductivityByToolV3.vue').catch(() => {})

  // 🔥 FIX: MERGED from duplicate onMounted - Clear initial mount flag after 3s
  // CR-X Phase 3 PERF: Extended from 1s to 3s to cover the first refreshPI
  // cycle (~2.5s). This prevents the GitHub fingerprint watch from queuing
  // a duplicate refreshPI when the initial fetch completes.
  setTimeout(() => {
    isInitialMount.value = false
  }, 3000)

  if (import.meta.env.DEV) dashLog('[ONMOUNTED] Single canonical onMounted completed');
  
  // 🎯 PERFORMANCE: End timing and log summary
  mark('dashboards_mount_end')
  measure('dashboards_mount', 'dashboards_mount_start', 'dashboards_mount_end')
  
  // Log performance summary after mount settles
  setTimeout(() => {
    logSummary({
      total_mount_time: 'See dashboards_mount measurement above',
      github_fetch_calls: 'See github_fetch measurements',
      pi_compute_time: 'See pi_compute measurements',
      api_calls_observed: 'Count in console logs above',
      // Phase 2B: Refresh coalescing metrics
      refresh_pi_calls: 'Actual refreshPI executions',
      refresh_pi_scheduled: 'Scheduled refresh attempts',
      refresh_pi_skipped_inflight: 'Skipped due to in-flight',
      refresh_pi_skipped_same_key: 'Skipped due to same input key',
      refresh_pi_skipped_unmounting: 'Skipped due to unmounting'
    })
    
    // Phase 2C: Performance ranking after 5 seconds
    setTimeout(() => {
      if (import.meta.env.DEV) {
        dashLog('[CM_PERF] === PHASE 2C RANKING ===')
        dashLog('[CM_PERF] Top bottlenecks by total time and call count:')
        dashLog('[CM_PERF] 1) sessions_fetch: Check sessions_fetch timing measurements')
        dashLog('[CM_PERF] 2) perf_to_panel_adapter: Check adapter processing time')
        dashLog('[CM_PERF] 3) chart_data_construction: Check chart dataset building')
        dashLog('[CM_PERF] See detailed measurements in performance marks above')
      }
    }, 5000)
  }, 2000)
})

// 🎯 PERFORMANCE: Track renders
onUpdated(() => {
  count('dashboards_render')
})

// Clean up on unmount
onUnmounted(() => {
  // Clean up tab switch timeout
  if (tabSwitchTimeout) {
    clearTimeout(tabSwitchTimeout)
    tabSwitchTimeout = null
  }
  
  // Phase 2B: Clean up refresh timeout
  if (refreshTimeoutId) {
    clearTimeout(refreshTimeoutId)
    refreshTimeoutId = null
  }
  
  // Clean up any in-flight requests
  if (githubAbortController) {
    githubAbortController.abort()
    githubAbortController = null
  }
  if (telemetryAbortController) {
    telemetryAbortController.abort()
    telemetryAbortController = null
  }
  if (sessionsAbortController) {
    sessionsAbortController.abort()
    sessionsAbortController = null
  }
  
  // Clear in-flight promises
  githubInFlight = null
  telemetryInFlight = null
  sessionsInFlight = null
  
  // Stop watchers
  if (filterWatcher) {
    filterWatcher.stop()
  }
})

// Legacy Productivity views archived to /frontend/src/components/archive/
// ProductivityOverTime and ProductivityByToolNextGen removed from active UI
// Productivity V3 is now the canonical experience

const ProductivityByToolV3 = defineAsyncComponent({
  loader: () => import('../components/ProductivityByToolV3.vue'),
  loadingComponent: null,
  errorComponent: null,
  delay: 200,
  timeout: 10000
})

const featureOn = import.meta.env.VITE_FEATURE_PERF_INSIGHTS === '1'

// CR-X P0-A FIX: Default to enabled — Final Engine is canonical PI authority.
// Only disabled if explicitly set to 'false'. Prevents worktree/env gaps from
// silently zeroing all Performance Insights.
const finalPiEngineEnabled = import.meta.env.VITE_FINAL_PI_ENGINE_ENABLED !== 'false'

dashLog('[DASHBOARDS_MOUNTED] Component mounted, starting data fetch...');
dashLog('[DASHBOARDS_DEBUG] Feature flags:', {
  VITE_FEATURE_PERF_INSIGHTS: import.meta.env.VITE_FEATURE_PERF_INSIGHTS,
  VITE_FINAL_PI_ENGINE_ENABLED: import.meta.env.VITE_FINAL_PI_ENGINE_ENABLED,
  VITE_LIVE_PILOT_MODE: import.meta.env.VITE_LIVE_PILOT_MODE,
  VITE_DEMO_MODE: import.meta.env.VITE_DEMO_MODE,
  VITE_PI_DEBUG: import.meta.env.VITE_PI_DEBUG,
  finalPiEngineEnabled,
  canonicalRuntimeMode: getEvidenceMode(),
  isLocalLab: isLocalLabMode(),
  isLivePilot: isLivePilotModeCanonical(),
});

// Centralized stores
const filterStore = useFilterStore()
const analysisContext = useAnalysisContextStore()
const githubStore = useGitHubStore()
const metricsFacade = useMetricsFacadeStore()

const granularity = computed(() => deriveGranularity(filterStore))
const scope = computed(() => (filterStore as any)?.scope || 'org')

// CR-X 2B.1: PI population scope visibility.
// PIs are always org-level. When PBT developer/repo filters are active,
// show a banner so the user knows PIs describe the org, not the filtered subset.
const pbtDeveloperFilterActive = computed(() => {
  const ids = filterStore?.filters?.productivity?.developerIds
  return Array.isArray(ids) && ids.length > 0
})
const pbtRepoFilterActive = computed(() => {
  const repos = filterStore?.filters?.productivity?.repos
  return Array.isArray(repos) && repos.length > 0
})
const pbtFilterActive = computed(() => pbtDeveloperFilterActive.value || pbtRepoFilterActive.value)
// K1B: cohort scope DOES apply to PI (unlike dev/repo filters) — the
// canonical session fetch is cohort-scoped when a cohort is selected.
const cohortFilterActive = computed(() => {
  const c = analysisContext.cohortId
  return !!c && c !== 'all' && c !== ''
})

// K1B: PI/AIOI cohort selector — reads/writes the shared analysisContext
// cohort scope (same authority as the PBT select, so the two surfaces can
// never disagree about scope).
const piCohorts = ref<Array<{ id: number; name: string; member_count: number; archived_at: string | null }>>([])
const piCohortSelection = computed({
  get: () => (analysisContext.cohortId === 'all' ? '' : analysisContext.cohortId) || '',
  set: (v: string) => analysisContext.setCohortId(v),
})
async function fetchPiCohorts() {
  try {
    const response = await api.get('/api/org/cohorts')
    const list = response.data.cohorts || response.data || []
    piCohorts.value = (list as any[]).filter(c => c && !c.archived_at)
  } catch {
    piCohorts.value = []
  }
}

// PHASE 1: Use analysis context time range for GitHub data (PI/PBT shared context)
// AIOI remains org-level and does not use this filter
const githubTimeFilter = computed(() => {
  const filter = analysisContext.githubTimeFilter
  dashLog(`[DASHBOARDS] GitHub time filter: ${filter}`)
  return filter
})

// GitHub data readiness guard for UI gating
const githubReady = computed(() => {
  const isConnected = githubStore.connected
  const hasRawResponse = !!githubStore.rawResponse

  // githubEvidenceAvailable: connected AND real eligible PR, review, or deployment evidence exists
  const prAnalyticsTotalPrs = githubStore.rawResponse?.pr_analytics?.total_prs || 0
  const prReviewMetricsTotalPrs = githubStore.rawResponse?.pr_review_metrics?.total_prs || 0
  const deploymentCount = (githubStore.rawResponse?.deployment_metrics?.success_deployment_count || 0) +
    (githubStore.rawResponse?.deployment_metrics?.failed_deployment_count || 0)
  const hasEvidence = prAnalyticsTotalPrs > 0 || prReviewMetricsTotalPrs > 0 || deploymentCount > 0

  const isReady = isConnected && hasRawResponse && hasEvidence

  dashLog('[DASHBOARDS] GitHub ready state:', {
    connected: isConnected,
    hasRawResponse,
    prAnalyticsTotalPrs,
    prReviewMetricsTotalPrs,
    deploymentCount,
    hasEvidence,
    githubReady: isReady
  })

  return isReady
})

const ghSeries = ref<EngOutputPoint[]>([])
const prodSeries = ref<ToolProductivityPoint[]>([])
const insights = ref<PerformanceInsight[]>([])
const lastGoodInsights = ref<PerformanceInsight[]>([])
const ideDiagnostics = ref<PerformanceInsight[]>([])
const sessionsForUI = ref<SessionDataPoint[]>([])
const canonicalAggregated = ref<Record<string, any>[]>([])
const canonicalAggregatedMetadata = ref<Record<string, any>>({})
// CR-X Track P2: Resolved cost configs from backend (shared by PI and PBT)
// CR-X ECON-1: Store full config (seatCount, costPerSeatMonthly) for editor load
const resolvedCostConfigs = ref<Array<{ toolId: string; seatCount: number; costPerSeatMonthly: number; monthlySpend: number; isConfigured: boolean }>>([])
// CR-X Gate A: Explicit cost-authority contract
const costConfigAuthority = ref<CostConfigAuthority>('backend_unavailable')
// CR-X Gate A: Authoritative canonical session rows for PBT cost allocation denominator.
// These are the FULL org population (not filtered) so bucket denominators remain
// correct when developer/repo filters are applied in PBT.
const authoritativeCanonicalSessions = ref<any[]>([])

// CR-X ECON-1: Refresh cost configs from backend (called after PBT editor save/clear)
const refreshCostConfigs = async () => {
  try {
    const costResult = await fetchOrgToolCostConfigsWithAuthority()
    costConfigAuthority.value = costResult.authority
    resolvedCostConfigs.value = costResult.configs
      .filter(c => c.monthlySpend > 0)
      .map(c => ({ toolId: c.toolId, seatCount: c.seatCount, costPerSeatMonthly: c.costPerSeatMonthly, monthlySpend: c.monthlySpend, isConfigured: true }))
  } catch (costErr) {
    if (PI_DEBUG) console.warn('[DASHBOARDS] Failed to refresh org cost configs:', costErr)
    costConfigAuthority.value = 'backend_unavailable'
  }
}
// CR5 WS1 — shared observed commit/TTFC authority for AIOI.
// Per-workflow provenance-qualified commit/TTFC aggregates derived from
// enriched canonical session rows. When populated, AIOI commits/session
// and TTFC render only from this authority; workflows without observed
// evidence render unavailable (no fallback to synthetic aggregated values).
//
// CR5 WS1 P0 FIX: initialized to an EMPTY Map (not null) so that from the
// very first render, before the authority has hydrated, AIOI commits/session
// and TTFC render as unavailable (—) rather than flashing the old synthetic
// canonical aggregated values. An empty Map is a valid authority with zero
// workflows — the builder treats it as "authority present, no evidence yet".
const observedCommitTtfcAuthority = ref<Map<string, any>>(new Map())

// Canonical hydration loading flag — true until authoritative canonical telemetry
// has been fetched. Gates all empty-state rendering so LOADING != EMPTY.
const canonicalHydrating = ref(true)

// CR-X P0-C: AIOI has its own aggregate fetch authority, separate from PI
// session pagination.  AIOI must not stay skeletonized merely because PI
// sessions are still loading.  This ref is cleared when the AIOI aggregate
// fetch completes (success or error), independent of canonicalHydrating.
const aioiHydrating = ref(true)

// CR-X AH-3: ERROR != EMPTY — canonical fetch error must not masquerade as zero-data.
// Set when the canonical telemetry fetch fails (500, network, auth). Cleared on success.
const canonicalError = ref<string | null>(null)

// CR-X P0-D: Evidence-completeness contract.
// Track which authoritative evidence sources succeeded vs failed.
// A canonical session failure must NOT silently produce a seemingly
// complete portfolio. The UI must distinguish FULL / PARTIAL / ERROR.
const sessionsFetchOk = ref<boolean | null>(null)       // null = not yet attempted
const canonicalAggregateOk = ref<boolean | null>(null)  // null = not yet attempted
const githubMetricsOk = ref<boolean | null>(null)       // null = not yet attempted
// CR-X PI FREEZE: Track the PI engine's session fetch completeness
// (complete/partial/error) separately from the UI sessions fetch.
// This is the authority for whether PI can present a complete portfolio.
const piSessionFetchCompleteness = ref<'complete' | 'partial' | 'error' | null>(null)

// Evidence-completeness state: 'full' | 'partial' | 'error' | 'loading'
const evidenceCompleteness = computed<'full' | 'partial' | 'error' | 'loading'>(() => {
  const sessions = sessionsFetchOk.value
  const aggregate = canonicalAggregateOk.value
  const github = githubMetricsOk.value
  const piCompleteness = piSessionFetchCompleteness.value
  // Still loading if any authority hasn't reported yet
  if (sessions === null || aggregate === null) return 'loading'
  // CR-X PI FREEZE: If PI session fetch was partial/error, the PI portfolio
  // is NOT complete even if other authorities succeeded. GitHub success
  // must not conceal telemetry failure.
  if (piCompleteness === 'partial' || piCompleteness === 'error') return 'partial'
  // ERROR: no usable authority succeeded
  if (!sessions && !aggregate && (github === null || !github)) return 'error'
  // PARTIAL: some authorities succeeded, others failed
  if (!sessions || !aggregate) return 'partial'
  // FULL: all attempted authorities succeeded
  return 'full'
})

// Human-readable label for the evidence-completeness badge
const evidenceStatusLabel = computed(() => {
  const piCompleteness = piSessionFetchCompleteness.value
  switch (evidenceCompleteness.value) {
    case 'full': return 'Historical telemetry loaded'
    case 'partial':
      if (piCompleteness === 'partial') return 'Partial evidence — session telemetry incomplete'
      if (piCompleteness === 'error') return 'Partial evidence — session telemetry unavailable'
      return 'Partial evidence — some sources unavailable'
    case 'error': return 'Evidence unavailable'
    case 'loading': return 'Loading historical telemetry…'
  }
})

// 🔥 P2: Detect if we have any data for empty state
const hasAnyDataForPI = computed(() => {
  // CR4 Task 2: Use canonical runtime mode authority
  const isLivePilotRuntime = isLivePilotModeCanonical()

  if (isLivePilotRuntime) {
    // In live-pilot mode, require actual data, not just non-zero metrics
    const hasTelemetry = sessionsForUI.value && sessionsForUI.value.length > 0
    const hasGitHub = githubStore.rawResponse?.github_connected === true &&
                      githubStore.rawResponse?.github_user !== null
    const hasInsertions = (githubStore.rawResponse?.total_insertions || 0) > 0
    const hasPRs = (githubStore.rawResponse?.total_pull_requests || 0) > 0

    const hasRealData = hasTelemetry || (hasGitHub && (hasInsertions || hasPRs))

    dashLog('[LIVE_PILOT_DATA_CHECK]', {
      hasTelemetry,
      hasGitHub,
      hasInsertions,
      hasPRs,
      hasRealData,
      githubConnected: githubStore.rawResponse?.github_connected,
      githubUser: githubStore.rawResponse?.github_user
    })

    return hasRealData
  }

  // Normal mode: existing logic
  const hasTelemetry = sessionsForUI.value && sessionsForUI.value.length > 0
  const hasGitHub = githubStore.metrics && Object.values(githubStore.metrics).some(v => v != null && v !== 0)
  return hasTelemetry || hasGitHub
})

// AI Usage Signals session-based data
const aiUsageSessionsCurrent = ref<any[]>([])
const aiUsageSessionsPrev = ref<any[]>([])

// 🔥 PHASE 0: Capture hard evidence for baseline state
let evidenceLogged = false
const evidenceCapture = computed(() => {
  const evidence = {
    // Filter store state
    filterStoreTimeComparison: filterStore.filters?.productivity?.timeComparison,
    githubTimeFilterValue: githubTimeFilter.value,
    
    // GitHub store state  
    githubConnected: githubStore.connected,
    githubLoading: githubStore.loading,
    githubError: githubStore.error,
    githubRawResponseKeys: Object.keys(githubStore.rawResponse || {}).length,
    
    // Readiness state
    githubReady: githubReady.value,
    
    // Timestamp
    capturedAt: new Date().toISOString()
  }
  
  // One-time log to capture baseline
  if (!evidenceLogged) {
    dashLog('🔍 [PHASE_0_EVIDENCE] BASELINE STATE CAPTURE:', evidence)
    evidenceLogged = true
  }
  
  return evidence
})

// Computed property for PI audit errors (safely accesses window.__PI_AUDIT)
const piAuditErrors = computed(() => {
  return (typeof window !== 'undefined' && (window as any).__PI_AUDIT?.errors) || [];
});

// Computed property to pass insights to widget (directly reactive to insights.value)
const insightsToPass = computed(() => {
  const result = insights.value;

  // CR4 Task 2: Use canonical runtime mode authority
  const isLivePilotRuntime = isLivePilotModeCanonical()

  if (isLivePilotRuntime) {
    // Check if Ryan has any real data
    const canonicalPopulationCount = githubStore.rawResponse?.canonical_population_count || 0
    const sessionsCount = sessionsForUI.value?.length || 0
    const totalPRs = githubStore.rawResponse?.total_pull_requests || 0
    const totalInsertions = githubStore.rawResponse?.total_insertions || 0
    const githubUser = githubStore.rawResponse?.github_user
    const githubConnected = githubStore.rawResponse?.github_connected

    const emptyRyanPilot =
      canonicalPopulationCount === 0 &&
      sessionsCount === 0 &&
      totalPRs === 0 &&
      totalInsertions === 0 &&
      githubUser === null &&
      githubConnected === false

    if (emptyRyanPilot) {
      dashLog('[LIVE_PILOT_HARD_BLOCK] Ryan has no data - blocking all PI', {
        canonicalPopulationCount,
        sessionsCount,
        totalPRs,
        totalInsertions,
        githubUser,
        githubConnected
      })

      // Clear all insights state

      // Return empty array to widget
      return []
    }
  }

  // === RUNTIME TRACE 4: Inside insightsToPass computed ===
  dashLog('[RUNTIME_TRACE][STAGE_4_INSIGHTS_TO_PASS]', {
    count: result?.length || 0,
    ids: result?.map(i => i.id) || [],
    titles: result?.map(i => i.title) || []
  });
  // === END RUNTIME TRACE ===

  const meaningful = result && result.length > 0;
  const hadMeaningful = lastGoodInsights.value && lastGoodInsights.value.length > 0;

  dashLog('[DASHBOARDS_DEBUG] insightsToPass computed:', {
    insightsLength: result?.length || 0,
    meaningful,
    hadMeaningful,
    lastGoodLength: lastGoodInsights.value?.length || 0,
    insightIds: result?.slice(0, 3).map(i => i.id) || []
  });
  
  // CR1 P0 Mission 6: Removed stale "expected 17" assertion.
  // The registry may contain 25 candidates, but rendered cards must be the subset
  // that passes evidence validation plus truthful diagnostics.
  if (result && result.length > 0) {
    const canonicalIds = getCanonicalPIIds();
    const canonicalPis = result.filter(i => canonicalIds.has(i.id));
    const nonCanonicalPis = result.filter(i => !canonicalIds.has(i.id));

    const actualCanonicalCount = canonicalPis.length;
    const actualTotalCount = result.length;

    // Count by stage
    const planCodeCount = result.filter(i => i.cicdStage === 'plan-code' || i.cicdStage === 'plan_code').length;
    const reviewMergeCount = result.filter(i => i.cicdStage === 'review-merge' || i.cicdStage === 'review_merge').length;
    const deployOperateCount = result.filter(i => i.cicdStage === 'deploy-operate').length;

    dashLog('[PI_CANONICAL_RENDER_CONTRACT]', {
      actualCanonical: actualCanonicalCount,
      actualTotal: actualTotalCount,
      nonCanonicalCount: nonCanonicalPis.length,
      stageCounts: {
        'plan-code': planCodeCount,
        'review-merge': reviewMergeCount,
        'deploy-operate': deployOperateCount
      },
      canonicalIds: Array.from(canonicalIds),
      actualCanonicalIds: canonicalPis.map(i => i.id),
      nonCanonicalIds: nonCanonicalPis.map(i => i.id)
    });
  }
  
  // 🔥 GUARD: Preserve last good insights if current result is empty (ONLY in demo/local mode, NOT live-pilot)
  // In live-pilot mode, empty API must mean empty UI - no cached pollution
  if (!meaningful && hadMeaningful && !isLivePilotMode.value) {
    dashLog('[PI_GUARD] preserving lastGoodInsights', { 
      currentLength: result?.length || 0,
      preservedLength: lastGoodInsights.value.length 
    });
    return lastGoodInsights.value;
  }
  
  // CR-X Wave 3 Slice A: Computed purity — do NOT mutate reactive state
  // (lastGoodInsights.value) inside this computed getter. The Ryan EC2
  // browser hang was caused by exactly this pattern (see AGENTS.md
  // "Vue Computed Side Effects" lesson). lastGoodInsights caching is
  // owned by refreshPI() async (lines ~3392, 3400) and the empty-pilot
  // branch (~3277). This computed must be pure: it reads
  // lastGoodInsights.value for the demo-mode preserve branch above,
  // but never writes to it.
  
  dashLog('[PI_WIDGET_INPUT]', {
    inputLength: result?.length || 0,
    inputIds: result?.map(i => i.id) || [],
    newPIsPresent: result?.filter(i => 
      ['telemetry-session-quality-regression', 'telemetry-ai-focus-imbalance', 'reopen-pressure-spike'].includes(i.id)
    ).map(i => i.id) || []
  });
  return result;
})
const prodContext = ref<{ hasLiveProd: boolean; hasSimProd: boolean; liveTools: string[]; simTools: string[] } | null>(null)

// GitHub connection state - use backend github_connected as source of truth
const githubConnectedState = computed(() => {
  const backendState = githubMetrics.value?.github_connected
  if (backendState === true) return 'connected'
  if (backendState === false) return 'disconnected'
  return 'unknown' // loading/undefined state
})

// 18G.1: GitHub OAuth connection authority — same canonical source as
// Settings (/api/github/oauth/status). Connection state must never be
// derived from whether a metrics fetch happened to succeed.
const githubOauthPurpose = ref<string | null>(null)
const githubOauthStatusLoaded = ref(false)
const githubAppInstalled = ref(false)

async function refreshGithubOauthStatus() {
  try {
    const response = await fetch(`${API_URL}/github/oauth/status`)
    if (response.ok) {
      const data = await response.json()
      githubOauthPurpose.value = data.token_purpose ?? null
      githubAppInstalled.value = data.github_app_installed === true
      githubOauthStatusLoaded.value = true
    }
  } catch (err) {
    // Status endpoint unreachable — keep the metrics-derived fallback.
    dashLog('[GITHUB_OAUTH_STATUS] fetch failed, retaining metrics fallback', err)
  }
}

// CR-X Pass 2 (A): Five-state GitHub engineering-evidence truth surface.
// Distinguishes login identity OAuth from engineering-evidence authorization.
// Uses backend github_engineering_evidence_state (CONNECTED/
// CONNECTED_NO_ELIGIBLE_DATA/LOGIN_ONLY/PARTIAL/NOT_CONNECTED) with fallback
// to legacy binary state.
const githubEvidenceState = computed(() => resolveGithubEvidenceState({
  oauthStatusLoaded: githubOauthStatusLoaded.value,
  oauthPurpose: githubOauthPurpose.value,
  metricsState: githubMetrics.value?.github_engineering_evidence_state,
  legacyConnected: githubConnectedCanonical.value,
  appInstalled: githubAppInstalled.value,
}))

const githubEvidenceBadge = computed(() => {
  // LOCAL DEMO PROVENANCE: when the backend reports that the active GitHub
  // evidence source is the sanctioned cm-activity-sim demo dataset, say so
  // explicitly. github_provenance.demo_dataset is only stamped when
  // APP_ENV=local with no customer repo authority, so this can never mask an
  // authority failure in a pilot/production environment.
  const isDemoDataset =
    githubMetrics.value?.github_provenance?.demo_dataset === 'cm-activity-sim' ||
    githubMetrics.value?.github_data_source === 'cm_activity_sim'
  if (isDemoDataset) {
    return {
      label: 'GitHub: Demo dataset',
      class: 'badge bg-info text-dark',
      title: 'Delivery evidence is the sanctioned local demo dataset (cm-activity-sim). The GitHub account is connected but has no customer repository authority.',
    }
  }
  const state = githubEvidenceState.value
  const map: Record<string, { label: string; class: string; title: string }> = {
    CONNECTED: { label: 'GitHub: Connected', class: 'badge bg-success', title: 'Engineering evidence is eligible and data is available.' },
    CONNECTED_NO_ELIGIBLE_DATA: { label: 'GitHub: Connected · Access Required', class: 'badge bg-info text-dark', title: 'Engineering integration authorized. Repository access is required to retrieve PR/deployment/review evidence.' },
    LOGIN_ONLY: { label: 'GitHub: Login Only', class: 'badge bg-warning text-dark', title: 'GitHub login connected but engineering evidence is NOT eligible. Engineering integration requires separate authorization.' },
    PARTIAL: { label: 'GitHub: Partial', class: 'badge bg-warning text-dark', title: 'GitHub token exists but purpose is missing/unknown. Re-authorization recommended.' },
    NOT_CONNECTED: { label: 'GitHub: Not Connected', class: 'badge bg-secondary', title: 'No GitHub OAuth token for this organization.' },
  }
  return map[state] ?? map.NOT_CONNECTED
})

// PHASE 2: Canonical connection flag for stage visibility
const githubConnectedCanonical = computed(() => {
  // Only explicit authority may authorize GitHub-dependent surfaces.
  // 18G.1: engineering OAuth status outranks the metrics-derived flag once
  // resolved, so a failed metrics fetch cannot downgrade a proven
  // connection. Presence of seeded/fallback metrics is not evidence of an
  // authenticated engineering integration.
  if (githubOauthStatusLoaded.value) {
    return githubOauthPurpose.value === 'engineering_integration'
  }
  return githubMetrics.value?.github_connected === true
})

// Development mode check
const isDevMode = computed(() => import.meta.env.DEV)

// Demo mode toggle logic - hidden for pilot
const showDemoToggle = computed(() => false)

const isDemoMode = computed(() => {
  const urlParams = new URLSearchParams(window.location.search)
  return urlParams.has('piStress') || urlParams.has('demoMode')
})

// CR4 Task 2: Use canonical runtimeMode authority — no split-brain.
// runtimeMode.ts is the single source of truth for live vs lab mode.
// The old computed duplicated this logic and contradicted VITE_LIVE_PILOT_MODE checks.
const isLivePilotMode = computed(() => isLivePilotModeCanonical())

// CR5 V1 FINAL — Truthful telemetry labels (Historical on Local, Live on Ed)
// At canonical zero telemetry the descriptive phrase must not claim
// operational telemetry; the Live indicator itself is unchanged.
const telemetryStatusPhrase = computed(() =>
  canonicalHydrating.value
    ? 'Loading telemetry…'
    : canonicalSessionCount.value === 0 ? 'Waiting for first telemetry' : getTelemetryStatusPhrase())
const telemetryStatusShort = computed(() => getTelemetryStatusShort())

const toggleDemoMode = () => {
  const currentUrl = new URL(window.location.href)
  const urlParams = currentUrl.searchParams
  
  if (isDemoMode.value) {
    // Turn off demo mode - remove demo params
    urlParams.delete('piStress')
    urlParams.delete('demoMode')
    urlParams.delete('v2') // Remove v2 to re-add it cleanly
  } else {
    // Turn on demo mode - add demo param
    urlParams.set('piStress', '1')
  }
  
  // Always ensure v2=1 is present
  urlParams.set('v2', '1')
  
  // Navigate to new URL
  window.location.href = currentUrl.toString()
}

let didLogParentInsightsOnce = false
const didTriggerEngineOnThisLoad = ref(false)

let didLogCallsiteOnMounted = false
let didLogCallsiteWatch = false
let didLogCallsiteDebounced = false
let didLogRefreshEnter = false
let didLogExitAlreadyRefreshing = false
let didLogExitException = false
let didLogInsightsAssigned = false
let didLogAuditDatasets = false
let didLogEngineVsAssigned = false

// DISABLED: Potential refresh loop trigger - watchEffect causing continuous re-renders
// watchEffect(() => {
//   if (!PI_DEBUG) return
//   if (didLogParentInsightsOnce) return

//   const list = insightsToPass.value || []
//   const ids = list.map(i => i.id).filter(Boolean)

//   if (list.length === 0) return

//   dashLog('[PI_AUDIT][PARENT_BINDING]', {
//     boundExpr: 'insightsToPass',
//     boundLen: list.length,
//     first5Ids: ids.slice(0, 5),
//   })

//   didLogParentInsightsOnce = true
// })

// Re-entrancy guard to prevent concurrent refreshPI calls
const isRefreshingPI = ref(false)

// Phase 2B: Refresh coalescing state
const piInFlight = ref(false)
let refreshTimeoutId: number | null = null
let lastPIKey = ''
let lastPIRunAt = 0

// CR1: Queued recomputation state — when refreshPI is requested while in flight,
// we queue exactly one rerun instead of silently discarding it.
let pendingRerun: { reason: string } | null = null

// CR-X Phase 3 PERF: PBT API prefetch flag. Set true after the first
// successful PI refresh fires the prefetch of PBT API data.
let pbtApiPrefetched = false

// CR-X P0-6: Productivity time-series late-resolution rerun tracking REMOVED.
// The final PI engine uses sessionRows from sharedEnrichedCanonical, not prodPoints.
// The productivity TS fetch is now fire-and-forget — it populates prodSeries/ideDiagnostics
// in the background but does NOT block PI or schedule reruns. This eliminates the
// 30s→rerun→30s amplification cascade.
const prodTsResolutionVersion = ref(0) // kept for buildPIInputKey compat, never incremented

// Phase 2B: Helper functions for refresh coalescing
function buildGithubEvidenceFingerprint(): string {
  // CR1: Build a stable fingerprint from GitHub evidence so that fresh API
  // responses change the PI input key and bypass the same-key guard.
  const snap = githubStore.rawResponse
  if (!snap) return 'no-gh'
  const totalPrs = snap.github_team_metrics?.total_prs ?? 0
  const mergedPrs = snap.github_team_metrics?.merged_prs ?? 0
  const successDep = snap.deployment_metrics?.success_deployment_count ?? 0
  const failedDep = snap.deployment_metrics?.failed_deployment_count ?? 0
  const closedPrs = snap.pr_analytics?.closed_prs ?? 0
  const openPrs = snap.pr_analytics?.open_prs ?? 0
  const serverStamp = snap.server_stamp ?? ''
  return `gh_${totalPrs}_${mergedPrs}_${successDep}_${failedDep}_${closedPrs}_${openPrs}_${serverStamp}`
}

function buildPIInputKey(): string {
  // Build key from only true inputs that affect PI compute
  // CR-X Track A: Include analysis context (time range, developers, repos, workflows)
  const ctxTime = `${analysisContext.dateRange.from || 'all'}_${analysisContext.dateRange.to || ''}`
  const ctxDevs = analysisContext.developerIds.join(',')
  const ctxRepos = analysisContext.repoIds.join(',')
  const ctxWorkflows = analysisContext.workflowIds.join(',')
  const timeFilter = ctxTime || filterStore?.filters?.engineering?.dateRange?.from || ''
  const granularityValue = granularity.value || ''
  const orgScope = scope.value || ''
  const ghFilter = analysisContext.githubTimeFilter
  const ghFingerprint = buildGithubEvidenceFingerprint()
  // CR-X Phase 1A.3: Include productivity resolution version so that
  // late-resolving productivity data triggers a rerun even if no other
  // input changed.
  const prodTsVersion = prodTsResolutionVersion.value

  // K1B: cohort scope is a PI input — a cohort change must rerun the engine
  // and can never reuse a differently-scoped result.
  const ctxCohort = analysisContext.cohortId || ''
  return `pi_${timeFilter}_${granularityValue}_${orgScope}_${ghFilter}_${ghFingerprint}_prod${prodTsVersion}_ctx_${ctxDevs}_${ctxRepos}_${ctxWorkflows}_${ctxCohort}`
}

function scheduleRefreshPI(reason: string, force = false): void {
  // CR-X P0: Inactive PI must not hydrate merely because the active PBT tab
  // changes shared analysisContext. Tab-activation passes force=true so PI
  // still hydrates with the current scope when the user switches back.
  if (!force && pbtActive.value) {
    // 17F.1: unconditional DEV log (not PI_DEBUG-gated) so browser acceptance
    // can see the skip decision without requiring VITE_PI_DEBUG.
    if (import.meta.env.DEV) console.log('[DASH_PI][SCHEDULE_DECISION]', { reason, force, pbtActive: pbtActive.value, decision: 'skipped-pbt-active' })
    count('refresh_pi_skipped_pbt_active')
    return
  }

  // CR1: If PI is currently in flight, queue a rerun instead of discarding.
  // Only one rerun is queued — the latest reason wins.
  if (piInFlight.value) {
    if (import.meta.env.DEV) console.log('[DASH_PI][SCHEDULE_DECISION]', { reason, force, pbtActive: pbtActive.value, decision: 'queued-pi-in-flight' })
    pendingRerun = { reason }
    count('refresh_pi_queued_rerun')
    return
  }

  if (import.meta.env.DEV) console.log('[DASH_PI][SCHEDULE_DECISION]', { reason, force, pbtActive: pbtActive.value, decision: 'scheduled' })

  // Clear any pending refresh
  if (refreshTimeoutId) {
    clearTimeout(refreshTimeoutId)
    refreshTimeoutId = null
  }

  // Schedule refresh with debounce (75-150ms)
  const debounceMs = 75 + Math.random() * 75 // 75-150ms random
  refreshTimeoutId = setTimeout(() => {
    refreshTimeoutId = null
    refreshPI(`scheduled:${reason}`)
  }, debounceMs) as unknown as number

  count('refresh_pi_scheduled')
}

// 🔥 FIX: Use githubStore rawResponse directly to prevent data source divergence
const githubMetrics = computed(() => {
  const rawResponse = githubStore.rawResponse || {}
  dashLog('🔧 [DASHBOARDS] githubMetrics computed:', {
    rawResponse: rawResponse,
    hasGithubTeamMetrics: !!rawResponse.github_team_metrics,
    hasTeamMetrics: !!rawResponse.team_metrics,
    totalPrsFromGithubTeam: rawResponse.github_team_metrics?.total_prs,
    totalPrsFromTeam: rawResponse.team_metrics?.total_prs
  })
  return rawResponse
})
const githubLoading = computed(() => githubStore.isFetchingMetrics)
const githubError = computed(() => githubStore.error)

// Local mock wiring for AI/DORA UI (UI-only; replaced by real props in integration)
const aiUsageMocks = ref(aiUsageMocksJson || [])
const doraMocks = ref(doraMetricsMocksJson || [])

// Filter AI usage data to only include known IDEs
const knownIDEs = ['cursor', 'vscode', 'intellij', 'windsurf', 'sublime', 'vim', 'jetbrains']
const aiUsageForUI = computed(() => {
  // Use real session data instead of mock data
  // Aggregate from aiUsageSessionsCurrent (mapped from session primitives)
  const sessionData = aiUsageSessionsCurrent.value || []
  
  if (sessionData.length === 0) {
    // Fallback to mock data only if no real session data available
    if (import.meta.env.DEV) {
      return aiUsageMocks.value.filter(ide => knownIDEs.includes(ide.toolId))
    }
    return []
  }
  
  // Aggregate real session data by tool
  const byTool = new Map<string, {
    toolId: string
    sessions: number
    aiAssists: number
    codingMinutes: number
    sessionMinutes: number
  }>()
  
  for (const session of sessionData) {
    const toolId = String(session.tool || 'unknown').toLowerCase()
    if (!knownIDEs.includes(toolId)) continue
    
    if (!byTool.has(toolId)) {
      byTool.set(toolId, {
        toolId,
        sessions: 0,
        aiAssists: 0,
        codingMinutes: 0,
        sessionMinutes: 0
      })
    }
    
    const tool = byTool.get(toolId)!
    tool.sessions++
    tool.aiAssists += Number(session.aiAssists || 0)
    tool.codingMinutes += Number(session.activeCodingMinutes || 0)
    tool.sessionMinutes += Number(session.sessionMinutes || 0)
  }
  
  // Convert to array format expected by AIUsageSignalsSection
  return Array.from(byTool.values()).map(tool => ({
    toolId: tool.toolId,
    sessions: tool.sessions,
    aiAssists: tool.aiAssists,
    codingMinutes: tool.codingMinutes,
    sessionMinutes: tool.sessionMinutes,
    assistRate: tool.codingMinutes > 0 ? (tool.aiAssists / tool.codingMinutes) * 100 : 0
  }))
})
// Extract real DORA metrics from GitHub API response instead of using mock data
const doraForUI = computed(() => {
  const raw = githubStore.rawResponse;
  if (!raw?.deployment_metrics) return [];
  
  // Calculate deployment frequency from success count over time period (month = ~30 days)
  const successCount = raw.deployment_metrics?.success_deployment_count || 0;
  const deploymentFrequency = successCount > 0 ? (successCount / 30).toFixed(2) : 0;
  
  // Calculate change failure rate from failed vs total deployments
  const failedCount = raw.deployment_metrics?.failed_deployment_count || 0;
  const totalDeployments = successCount + failedCount;
  const changeFailureRate = totalDeployments > 0 ? (failedCount / totalDeployments) : 0;
  
  return [{
    lead_time_for_changes: raw.deployment_metrics?.latest_deployment?.deployed_at ? 
      Math.floor((new Date().getTime() - new Date(raw.deployment_metrics.latest_deployment.deployed_at).getTime()) / (1000 * 60 * 60 * 24)) : null,
    deployment_frequency: parseFloat(deploymentFrequency),
    change_failure_rate: changeFailureRate,
    mean_time_to_recovery: raw.deployment_metrics?.deploy_to_incident_time || null,
    change_failures: failedCount,
    deployments: successCount,
    change_failure_rate_percentage: changeFailureRate * 100
  }];
});

// Data-driven time context bar labels (replace hardcoded values)
// Uses canonical aggregated metadata as the single authority for workflow
// universe and session counts, consistent with PBT and AIOI surfaces.
// CR5 WS1.6 P0: LOADING != EMPTY — during initial hydration, render
// "—" instead of "0" so the user doesn't see false-empty state.
const trackedWorkflowsCount = computed(() => {
  if (canonicalHydrating.value) return '—';
  return deriveWorkflowCounts(canonicalAggregatedMetadata.value).trackedCount;
});

const primaryWorkflowsCount = computed(() => {
  if (canonicalHydrating.value) return '—';
  return deriveWorkflowCounts(canonicalAggregatedMetadata.value).primaryCount;
});

// Canonical session population — same metadata authority the AIOI badge uses.
// 0 sessions = pre-telemetry zero state; suppresses historical-baseline
// framing before any history exists.
const canonicalSessionCount = computed(() => {
  return Number(canonicalAggregatedMetadata.value?.canonical_population_count) || 0;
});

// Telemetry-observed repository identity count (distinct normalized
// git_repo_url identities across canonical telemetry). This is the header
// chip's population — it must NOT be read from GitHub engineering metrics
// (github_team_metrics.total_repositories counts OAuth-token-visible repos,
// a different and much smaller population).
const observedRepoCount = ref<number | null>(null)

async function fetchTelemetryRepoCount() {
  try {
    const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || ''
    const res = await authenticatedFetch(`${apiBase}/api/telemetry/repos`)
    if (res?.ok) {
      const body = await res.json()
      const repos = Array.isArray(body?.repositories) ? body.repositories : []
      observedRepoCount.value = repos.length
    }
  } catch {
    // Non-fatal — chip falls back to 'All'
  }
}

const repoCount = computed(() => {
  return observedRepoCount.value !== null && observedRepoCount.value > 0
    ? observedRepoCount.value
    : 'All'
});

// AbortController for canceling in-flight requests
let githubAbortController: AbortController | null = null
let telemetryAbortController: AbortController | null = null
let sessionsAbortController: AbortController | null = null

// Single-flight locks: reuse in-flight promises for same params
let githubInFlight: Promise<any> | null = null
let githubInFlightParams: string | null = null
let telemetryInFlight: Promise<any> | null = null
let telemetryInFlightParams: string | null = null
let sessionsInFlight: Promise<SessionDataPoint[]> | null = null
let sessionsInFlightParams: string | null = null

// Helper: check if insights contain real AI-impact insights (not just fallback)
function hasNonFallback(insightsArray: PerformanceInsight[]): boolean {
  if (!insightsArray || insightsArray.length === 0) return false
  return insightsArray.some(i =>
    !(i.id?.startsWith('fallback-')) &&
    !(i.tags && i.tags.includes('fallback'))
  )
}

// Separate function to fetch GitHub metrics
async function fetchGitHubMetrics() {
  const requestId = createRequestId('github')
  logRaceEvent('GITHUB_FETCH_START', { 
    requestId, 
    caller: 'fetchGitHubMetrics',
    inFlight: !!githubAbortController,
    storeHasData: !!githubStore.rawResponse,
    storeMetricsKeys: Object.keys(githubStore.metrics || {})
  })
  
  dashLog('🔥🔥🔥🔥🔥 [FETCH_GITHUB] fetchGitHubMetrics FUNCTION CALLED!!! 🔥🔥🔥🔥🔥');
  dashLog("[DASHBOARDS] Starting GitHub fetch...")
  dashLog('🔥🔥🔥 [FETCH_GITHUB_START] fetchGitHubMetrics() function started');
  
  // Cancel any in-flight GitHub requests
  if (githubAbortController) {
    githubAbortController.abort()
    githubAbortController = null
  }

  // Create new request with AbortController and timeout
  githubAbortController = new AbortController()
  const signal = githubAbortController.signal
  
  // Set a timeout to abort after 25 seconds
  const timeoutId = setTimeout(() => {
    if (!signal.aborted) {
      githubAbortController?.abort()
    }
  }, 25000)
  
  // 🔥 FIX: Removed illegal assignment to computed ref (githubLoading.value = true)
  // The store's fetchMetrics() manages isFetchingMetrics internally

  const githubStart = performance.now()
  // 🔥 PHASE 1: Use derived time filter instead of hardcoded 'all'
  dashLog(`🔥🔥🔥 [GITHUB_FETCH] refreshPI using time filter: ${githubTimeFilter.value}`)
  const githubPromise = githubStore.fetchMetrics(githubTimeFilter.value, { signal, source: 'Dashboards', force: true })
    .then((result) => {
      clearTimeout(timeoutId)
      githubMetricsOk.value = true // CR-X P0-D: evidence-completeness tracking
      const githubFetchMs = Math.round(performance.now() - githubStart);

      // ============================================================
      // OBSERVABILITY: window.__CM_DEBUG__ GitHub payload summary
      // ============================================================
      if (typeof window !== 'undefined' && (window as any).__CM_DEBUG__) {
        (window as any).__CM_GITHUB_PAYLOAD__ = {
          timeFilter: githubTimeFilter.value,
          githubConnected: result?.github_connected,
          totalPRs: result?.github_team_metrics?.total_prs,
          mergedPRs: result?.github_team_metrics?.merged_prs,
          totalCommits: result?.github_team_metrics?.total_commits,
          uniqueDevelopers: result?.github_team_metrics?.unique_developers,
          hasPRAnalytics: !!result?.pr_analytics,
          hasReviewMetrics: !!result?.pr_review_metrics,
          hasDeploymentMetrics: !!result?.deployment_metrics,
          durationMs: githubFetchMs,
          timestamp: Date.now()
        };
        dashLog('[CM_DEBUG][GITHUB_PAYLOAD]', (window as any).__CM_GITHUB_PAYLOAD__);
      }

      // 🔥 EXPLORATORY DEBUG: DEV-ONLY network request logging
      if (import.meta.env.DEV) {
        dashLog('[DASH_NETWORK]', {
          type: 'github_metrics',
          route: window.location.pathname + window.location.search,
          url: `${import.meta.env.VITE_API_BASE_URL || ''}/api/metrics`,
          queryParams: { oauth: true, time_filter: 'all' },
          credentials: 'cookies',
          durationMs: githubFetchMs,
          responseFields: {
            github_connected: result?.github_connected,
            github_connection_reason: result?.github_connection_reason,
            github_user: result?.github_user,
            total_prs: result?.github_team_metrics?.total_prs,
            reopened_prs: result?.pr_review_metrics?.pr_reopened_count,
            failed_deployments: result?.deployment_metrics?.failed_deployment_count
          },
          timestamp: Date.now()
        });
      }
      
      if (import.meta.env.DEV) {
        dashLog('[PI FETCH] GitHub', {
          url: `${import.meta.env.VITE_API_BASE_URL || ''}/api/github/metrics`,
          queryParams: { oauth: true, time_filter: 'all' },
          durationMs: githubFetchMs,
        });
      }
      
      return result;
    })
    .catch((err) => {
      clearTimeout(timeoutId)
      
      if (err.name === 'AbortError' || err.code === 'ECONNABORTED') {
        if (import.meta.env.DEV) {
          console.warn('[PI FETCH] GitHub timeout/aborted');
        }
      }
      
      throw err;
    })
    .finally(() => {
      githubAbortController = null
      // 🔥 FIX: Removed illegal assignment to computed ref (githubLoading.value = false)
      // The store's fetchMetrics() manages isFetchingMetrics internally
    });

  try {
    const githubResult = await githubPromise
    
    logRaceEvent('GITHUB_FETCH_SUCCESS', { 
      requestId, 
      hasResult: !!githubResult,
      totalPRs: githubResult?.github_team_metrics?.total_prs,
      connected: githubResult?.github_connected,
      responseSize: JSON.stringify(githubResult || {}).length
    })
    
    // STEP 2A: Verify /api/metrics response
    dashLog("[GH_STEP2A] Full API response:", githubResult)
    dashLog("[GH_STEP2A] metrics keys", {
      has_team: !!githubResult?.github_team_metrics,
      team_total_prs: githubResult?.github_team_metrics?.total_prs,
      has_pr_review: !!githubResult?.pr_review_metrics,
      review_count: githubResult?.pr_review_metrics?.review_count,
      has_deploy: !!githubResult?.deployment_metrics,
      deploy_status: githubResult?.deployment_metrics?.latest_deployment?.status,
      github_connected: githubResult?.github_connected
    })
    
    // Extract GitHub metrics for pipeline stages
    // Spread nested objects to root level so EngOutput.vue cards can access them directly
    if (githubResult && typeof githubResult === 'object') {
      const teamMetrics = githubResult.github_team_metrics || {}
      const reviewMetrics = githubResult.pr_review_metrics || {}
      const deployMetrics = githubResult.deployment_metrics || {}

      // 🔥 FIX: Removed illegal assignment to computed ref (githubMetrics.value = githubResult)
      // githubMetrics is a computed ref that reads from githubStore.rawResponse
      // The store's fetchMetrics() already updates rawResponse, so this is redundant and illegal

      // 🔥 PHASE 0 EVIDENCE: Dashboards GitHub result tracing
      dashLog('[DASHBOARDS_GH_RESULT]', {
        hasResult: !!githubResult,
        keys: githubResult ? Object.keys(githubResult).slice(0,20) : null,
        totalPRs: githubResult?.github_team_metrics?.total_prs
      })
      
      // STEP 2B: Verify what we store in githubMetrics.value
      dashLog("[GH_STEP2B] githubMetrics.value", {
        has_team: !!githubMetrics.value?.github_team_metrics,
        team_total_prs: githubMetrics.value?.github_team_metrics?.total_prs,
        has_pr_review: !!githubMetrics.value?.pr_review_metrics,
        review_count: githubMetrics.value?.pr_review_metrics?.review_count,
        has_deploy: !!githubMetrics.value?.deployment_metrics,
        deploy_status: githubMetrics.value?.deployment_metrics?.latest_deployment?.status,
        github_connected: githubMetrics.value?.github_connected
      })
    } else {
      dashLog("[GH_STEP2A] API response is null or not an object")
    }
  } catch (err: any) {
    logRaceEvent('GITHUB_FETCH_ERROR', { 
      requestId, 
      error: err?.message || 'unknown',
      name: err?.name,
      code: err?.code
    })
    
    console.error('🔥🔥🔥 [FETCH_GITHUB_ERROR] fetchGitHubMetrics() error:', err)
    githubMetricsOk.value = false // CR-X P0-D: evidence-completeness tracking
    // 🔥 FIX: Removed illegal assignments to computed refs (githubError.value, githubMetrics.value)
    // The store's fetchMetrics() manages error state internally
  }
}

async function refreshPI(cycleId?: string) {
  // CR5 WS1.4 P0: Cold-path timing attribution
  const _coldPathStart = performance.now();
  dashLog("[PI DEBUG] githubReady:", githubReady.value);
  dashLog("[PI DEBUG] githubMetrics:", githubStore.metrics);
  // 🎯 PERFORMANCE: Start timing
  const piRequestId = `pi_compute_${Date.now()}`
  mark(`${piRequestId}_start`)
  count('refresh_pi_calls')
  
  // Phase 2B: In-flight lock and unmounting guard
  if (!filterStore) {
    count('refresh_pi_skipped_unmounting')
    return
  }
  
  if (piInFlight.value) {
    count('refresh_pi_skipped_inflight')
    return
  }
  
  // Phase 2B: Stable input key skip
  const currentKey = buildPIInputKey()
  const now = Date.now()
  if (lastPIKey === currentKey && (now - lastPIRunAt) < 750) {
    count('refresh_pi_skipped_same_key')
    return
  }
  
  // Update tracking
  lastPIKey = currentKey
  lastPIRunAt = now
  piInFlight.value = true
  
  // =====================================
  // STEP 1A: NON-REENTRANT GUARD LOGIC
  // =====================================
  
  // Generate unique request ID for this call
  const currentRequestId = Math.random().toString(36).substr(2, 9);
  
  // Guard against concurrent execution - IMMEDIATE RETURN
  if (isRefreshingPI.value) {
    dashLog(`🚨 [refreshPI] Skipping concurrent call ${currentRequestId} - already running`);
    return; // Exit immediately, no side effects
  }
  
  // Set guard flag
  isRefreshingPI.value = true;
  
  // Store current request ID globally for stale response checking
  if (typeof window !== 'undefined') {
    (window as any).__CM_CURRENT_REQUEST_ID = currentRequestId;
  }

  // =====================================
  // PHASE 0: refreshPI() INSTRUMENTATION
  // =====================================
  const traceId = cmTraceId("refreshPI");
  const t0 = performance.now();
  cmMark(traceId, "START", {
    route: window.location.pathname + window.location.search,
    requestId: currentRequestId
  });

  // =====================================
  // PHASE 3A: SAFE PI BREAKDOWN TIMING
  // =====================================
  const piBreakdownStart = performance.now();

  // =====================================
  // PHASE 0: SET GLOBAL TRACE ID FOR API CALLS
  // =====================================
  if (typeof window !== 'undefined') {
    (window as any).__CM_TRACE_ID = traceId;
  }

  const requestId = createRequestId('pi')
  logRaceEvent('PI_REFRESH_START', { 
    requestId, 
    isRefreshing: isRefreshingPI.value,
    currentInsightsCount: insights.value.length,
    piRunId: piRunId.value,
    providedCycleId: cycleId || 'none'
  })
  
  // Use provided cycleId or create new one
  const cid = cycleId || startNewCycle('refreshPI')
  
  // Pipeline timings for debugging
  const pipelineTimings: Record<string, number> = {}
  
  didTriggerEngineOnThisLoad.value = true
  dashLog(`🔍 [REFRESH_PI] Running refreshPI ${currentRequestId} with cycle: ${cid}`);
  
  // Cancel any in-flight requests from previous refresh
  if (githubAbortController) {
    githubAbortController.abort()
    githubAbortController = null
  }
  if (telemetryAbortController) {
    telemetryAbortController.abort()
    telemetryAbortController = null
  }
  if (sessionsAbortController) {
    sessionsAbortController.abort()
    sessionsAbortController = null
  }
  
  // Increment run ID at the start of refresh (before any async work)
  // This ensures the run ID increments even if refresh fails early
  piRunId.value++
  
  // Initialize trace object for this refresh (clear previous)
  if (typeof window !== 'undefined') {
    (window as any).__CM_PI_V2_TRACE__ = {};
  }
  
  let metricsError: any = null
  
  try {
    dashLog("🚨 [DEBUG] Entered try block");

    // Use analysis context time range for PI/PBT shared context.
    // Falls back to filter store engineering date range, then 14-day default.
    const fromISO = analysisContext.dateRange.from
      || filterStore?.filters?.engineering?.dateRange?.from
      || new Date(Date.now() - 14*864e5).toISOString().slice(0,10)
    const toISO   = analysisContext.dateRange.to
      || filterStore?.filters?.engineering?.dateRange?.to
      || new Date().toISOString().slice(0,10)

    // 🔥 SIMPLIFIED: Using githubStore directly - no cycle guard needed
    dashLog("🔥🔥🔥 [GITHUB_STORE_DIRECT] Using GitHub data from store:", {
      cycleId: cid,
      hasGithubMetrics: !!githubMetrics.value,
      totalPRs: githubMetrics.value?.github_team_metrics?.total_prs
    });
      
    dashLog("🔥🔥🔥 [GITHUB_STORE_UPDATED] Store now has data:", {
      rawResponse: !!githubStore.rawResponse,
      metrics: !!githubStore.metrics,
      rawResponseValue: githubStore.rawResponse,
      metricsValue: githubStore.metrics
    });
      
    // PHASE 1: Runtime proof - show actual series shapes + period keys (early version with GitHub data)
    if (PI_DEBUG) console.info("[PI_SERIES_PROOF_EARLY]", {
      ghLen: ghSeries.value?.length,
      ghPeriodSample: ghSeries.value?.slice(0, 5).map((p:any)=>p.period),
      ghKeys: ghSeries.value?.[0] ? Object.keys(ghSeries.value[0]).sort() : [],
      note: "Early proof with GitHub data only - telemetry hanging"
    });
      
    // 🔥 SIMPLIFIED: GitHub data handled by githubStore directly
    // No duplicate assignment needed - githubMetrics computed uses store
    dashLog("🔥🔥🔥 [GITHUB_STORE_DIRECT] Skipping duplicate GitHub assignment, using computed store");

    // 🔥 CRITICAL FIX: Use real GitHub API response when available, otherwise use synthetic fallback
    dashLog('[PI_DEBUG][GITHUB_STORE_STATE]', {
      rawResponse: githubStore.rawResponse,
      rawResponseKeys: githubStore.rawResponse ? Object.keys(githubStore.rawResponse).slice(0, 10) : null,
      metrics: githubStore.metrics,
      loading: githubStore.loading,
      error: githubStore.error
    });
    
    // 🔥 STABILIZATION: Prioritize real GitHub data with intelligent fallbacks
    dashLog('🔥🔥🔥 [DASHBOARDS_DEBUG] GitHub data processing:', {
      rawResp: githubStore.rawResponse,
      hasTeamMetrics: !!githubStore.rawResponse?.github_team_metrics,
      totalPrs: githubStore.rawResponse?.github_team_metrics?.total_prs,
      hasByPeriod: Array.isArray(githubStore.rawResponse?.by_period),
      realGitHubDataLength: 0,
      realGitHubDataSample: null
    });
    
    // Try to use real GitHub data first, fall back to cached or minimal synthetic data
    let realGitHubData = [];
    let githubByPeriodSource: 'github_by_period' | 'by_period' | 'single_snapshot' | 'fallback' = 'fallback';
    
    // Priority 1: Use real API response if available and has valid data
    // FIX: Pinia setup stores auto-unwrap refs — githubStore.rawResponse IS the data, not a Ref
    const rawResp = githubStore.rawResponse;
    if (rawResp &&
        rawResp.github_team_metrics?.total_prs > 0) {
      // Prefer github_by_period time-series if backend provides it (>= 2 periods)
      const githubByPeriod = rawResp.github_by_period;
      if (Array.isArray(githubByPeriod) && githubByPeriod.length >= 2) {
        realGitHubData = githubByPeriod;
        githubByPeriodSource = 'github_by_period';
        const sample = githubByPeriod[0] || {};
        dashLog('%c[CM_DEBUG] Using github_by_period time-series from API', 'color: #ff6600; font-weight: bold', {
          periods: githubByPeriod.length,
          sampleKeys: Object.keys(sample),
          samplePeriod: sample.period,
          sampleDeployFreq: sample.deploymentFreqPerWeek,
          samplePrCycle: sample.prCycleTimeHours,
          sampleCFR: sample.changeFailureRatePct,
          sampleMTTR: sample.mttrHours,
        });
      } 
      // Fallback to by_period for legacy compatibility
      else if (Array.isArray(rawResp.by_period) && rawResp.by_period.length >= 2) {
        realGitHubData = rawResp.by_period;
        githubByPeriodSource = 'by_period';
        const byPeriod = rawResp.by_period;
        const sample = byPeriod[0] || {};
        dashLog('%c[CM_DEBUG] Using by_period time-series from API (legacy)', 'color: #ff6600; font-weight: bold', {
          periods: byPeriod.length,
          sampleKeys: Object.keys(sample),
          samplePeriod: sample.period,
          sampleDeployFreq: sample.deploymentFreqPerWeek,
          samplePrCycle: sample.prCycleTimeHours,
          sampleCFR: sample.changeFailureRatePct,
          sampleMTTR: sample.mttrHours,
        });
      } 
      // Fallback to single snapshot
      else {
        realGitHubData = [rawResp];
        githubByPeriodSource = 'single_snapshot';
        dashLog('%c[CM_DEBUG] Using real API response (single snapshot)', 'color: #ff6600; font-weight: bold', {
          githubByPeriodPresent: Array.isArray(githubByPeriod),
          githubByPeriodLength: Array.isArray(githubByPeriod) ? githubByPeriod.length : 0,
          byPeriodPresent: Array.isArray(rawResp.by_period),
          byPeriodLength: Array.isArray(rawResp.by_period) ? rawResp.by_period.length : 0,
        });
      }
    }
    // Priority 2: Use cached data if available (only in demo/local mode, not live pilot)
    else if ((window as any).__GH_CACHED_DATA && !isLivePilotMode.value) {
      realGitHubData = (window as any).__GH_CACHED_DATA;
      dashLog('🔥 [STABILIZATION] Using cached GitHub data');
    }
    // In live-pilot mode, clear stale cached data to ensure only live data is shown
    else if (isLivePilotMode.value && (window as any).__GH_CACHED_DATA) {
      dashLog('🔥 [LIVE_PILOT] Clearing stale cached GitHub data');
      delete (window as any).__GH_CACHED_DATA;
    }
    // Priority 3: Minimal fallback only for essential fields (ONLY in demo/local mode, NOT live-pilot)
    else if (!isLivePilotMode.value) {
      const currentTeamMetrics = githubStore.metrics?.team_metrics || {};
      realGitHubData = [{
        period: new Date().toISOString().split('T')[0],
        prCycleTimeHours: currentTeamMetrics.time_to_merge || 2.0,
        timeToFirstReviewHours: currentTeamMetrics.time_to_first_review || 1.0,
        deploymentFreqPerWeek: 1.0,
        mergeRatePct: currentTeamMetrics.merge_rate || 85.0,
        changeFailureRatePct: 5.0,
        // Use real team metrics if available
        github_team_metrics: {
          total_pull_requests: currentTeamMetrics.total_prs || 10,
          merged_pull_requests: currentTeamMetrics.merged_prs || 8,
          open_pull_requests: (currentTeamMetrics.total_prs - currentTeamMetrics.merged_prs) || 2,
          total_repositories: currentTeamMetrics.total_repositories || 3,
          total_developers: currentTeamMetrics.unique_developers || 2
        },
        pr_analytics: {
          pr_review_metrics: {
            first_review_at: new Date().toISOString(),
            review_count: currentTeamMetrics.total_prs || 10,
            unique_reviewer_count: Math.max(1, Math.floor((currentTeamMetrics.unique_developers || 2) * 0.7)),
            pr_reopened_count: 1
          }
        },
        pr_review_metrics: {
          review_count: currentTeamMetrics.total_prs || 10,
          unique_reviewer_count: Math.max(1, Math.floor((currentTeamMetrics.unique_developers || 2) * 0.7)),
          pr_reopened_count: 1,
          first_review_at: new Date().toISOString()
        },
        deployment_metrics: {
          latest_deployment: {
            status: 'success',
            at: new Date().toISOString(),
            environment: "production",
            deployed_at: new Date().toISOString()
          },
          failed_deployment_count: 0,
          deployment_frequency_per_week: 1.0,
          rollback_detected: false
        }
      }];
      dashLog('🔥 [STABILIZATION] Using minimal fallback with real team metrics');
    }
    
    // Cache the data for future use
    (window as any).__GH_CACHED_DATA = realGitHubData;
    (window as any).__CM_GITHUB_BY_PERIOD_SOURCE = githubByPeriodSource;

    dashLog('[PI_AUDIT][GITHUB_DATA_SOURCE]', {
      usingRealData: realGitHubData.length > 0,
      dataSource: realGitHubData.length > 0 ? 'real_api_response' : 'synthetic_fallback',
      realDataKeys: realGitHubData.length > 0 ? Object.keys(realGitHubData[0]) : [],
      hasTeamMetrics: realGitHubData.length > 0 ? !!realGitHubData[0].github_team_metrics : false,
      githubStoreRawResponse: !!githubStore.rawResponse,
      githubStoreValue: githubStore.rawResponse ? 'exists' : 'null'
    });

    // 🔥 STABILIZATION: Ensure GitHub metrics are always available (only in demo/local mode)
    // In live-pilot mode, do NOT use fallback - show actual data or empty state
    const ensureGitHubMetrics = () => {
      if (isLivePilotMode.value) {
        // In live-pilot mode, do not use fallback - let UI show empty state if no data
        dashLog('🔥 [LIVE_PILOT] Skipping GitHub fallback - using actual data only');
        return;
      }

      if (!realGitHubData.length || !realGitHubData[0]?.github_team_metrics?.total_prs) {
        if (PI_DEBUG) console.warn('🔥 [STABILIZATION] GitHub metrics missing, using fallback');
        // Force minimal GitHub metrics to prevent UI failures
        if (realGitHubData.length === 0) {
          const fallbackData = {
            period: new Date().toISOString().split('T')[0],
            prCycleTimeHours: 2.0,
            timeToFirstReviewHours: 1.0,
            deploymentFreqPerWeek: 1.0,
            mergeRatePct: 85.0,
            changeFailureRatePct: 5.0,
            github_team_metrics: {
              total_pull_requests: githubStore.metrics?.team_metrics?.total_prs || 13,
              merged_pull_requests: githubStore.metrics?.team_metrics?.merged_prs || 12,
              open_pull_requests: 2,
              total_repositories: 3,
              total_developers: 2
            },
            pr_analytics: { pr_review_metrics: { review_count: 13, unique_reviewer_count: 2, pr_reopened_count: 1 } },
            pr_review_metrics: { review_count: 13, unique_reviewer_count: 2, pr_reopened_count: 1 },
            deployment_metrics: { latest_deployment: { status: 'success', at: new Date().toISOString() }, failed_deployment_count: 0 }
          };
          realGitHubData.push(fallbackData);
          
          // 🔥 CRITICAL: Update the store with fallback data so components receive it
          if (githubStore.rawResponse) {
            Object.assign(githubStore.rawResponse, fallbackData);
          } else {
            githubStore.rawResponse = fallbackData;
          }
        }
      }
    };
    
    ensureGitHubMetrics();

    // 🔍 FORENSIC: GitHub Weekly source construction - immediate caller trace
    dashLog('[CM_FORENSIC:GITHUB_WEEKLY_SOURCE]', {
      sourceLocation: 'Dashboards.vue:refreshPI() - mapGitHubToEngOutputByGranularity',
      githubWeeklyCount: Array.isArray(realGitHubData) ? realGitHubData.length : 0,
      githubWeeklyPeriods: Array.isArray(realGitHubData) ? realGitHubData.map(r => r?.period) : [],
      sampleRows: Array.isArray(realGitHubData) ? realGitHubData.slice(0, 3) : [],
      selectedDateRange: {
        granularity: granularity?.value ?? null
      }
    });

    
    const gh = mapGitHubToEngOutputByGranularity(realGitHubData, granularity.value)

    // 2) IDE time series via facade - fetch MULTIPLE metrics for richer insights
    // CRITICAL: We need to fetch these separately to ensure we get data
    const baseQuery = {
      from: fromISO, to: toISO,
      teamIds: filterStore?.filters?.engineering?.teamIds || [],
      developerIds: filterStore?.filters?.engineering?.developerIds || [],
      toolIds: filterStore?.filters?.productivity?.toolIds || ['cursor', 'vscode', 'jetbrains'],
    }
    
    // Single-flight lock: reuse in-flight promise if params match
    const telemetryParamsKey = JSON.stringify(baseQuery)
    let telemetryPromise: Promise<any> | null = null
    
    // FIX: Declare telemetryStart outside the if block so it's accessible later
    const telemetryStart = performance.now();
    
    if (telemetryInFlight && telemetryInFlightParams === telemetryParamsKey) {
      // Reuse existing promise
      telemetryPromise = telemetryInFlight
    } else {
      // Create new request with AbortController
      telemetryAbortController = new AbortController()
      const signal = telemetryAbortController.signal
      
      // Fetch each metric separately to ensure we get all data
      const telemetryRequestId = createRequestId('telemetry')
      logRaceEvent('TELEMETRY_FETCH_START', { 
        requestId: telemetryRequestId, 
        piRequestId: requestId,
        baseQuery,
        inFlight: !!telemetryInFlight
      })
      
      // CR-X P0: The background prodTs fetch has been REMOVED from the PI cold
      // load path. It fired a canonical aggregated request that competed with
      // session pagination on the single-threaded PHP server, causing page 2
      // to time out. The prodTs was NOT required by the final PI engine (it
      // only populated legacy prodSeries/ideDiagnostics display fields). The
      // final engine uses sessionRows from sharedEnrichedCanonical.
      //
      // If prodSeries/ideDiagnostics are needed later, fetch them AFTER
      // session pagination completes, not before.
      telemetryPromise = Promise.resolve([{ points: [] }, { points: [] }, { points: [] }, { points: [] }]);
      
      // Mark telemetry stage as skipped (no background fetch)
      pipelineTimings.telemetry = 0;
      stageMark('telemetryFetch', 0);
      // Store in-flight promise
      telemetryInFlight = telemetryPromise;
      telemetryInFlightParams = telemetryParamsKey;
    }
    
    const [aiSeries, codingSeries, commitsSeries, sessionSeries] = await telemetryPromise;
    
    dashLog("🚨 [DEBUG] Telemetry fetch completed successfully");
    
    // ============================================================================
    // FETCH PRODUCTIVITY SUMMARY FOR AI USAGE SIGNALS
    // ============================================================================
    let aiUsageSummaryData = null
    try {
      dashLog('[AI_USAGE_SIGNALS] Fetching productivity summary for AI data...')
      const summaryResult = await getProductivitySummary(baseQuery, 'PI_AI_USAGE')
      aiUsageSummaryData = summaryResult.totals
      dashLog('[AI_USAGE_SIGNALS] Summary data received:', {
        hasData: !!aiUsageSummaryData,
        tools: aiUsageSummaryData ? Object.keys(aiUsageSummaryData).slice(0, 5) : [],
        sampleData: aiUsageSummaryData ? Object.entries(aiUsageSummaryData).slice(0, 2).map(([tool, data]: [string, any]) => ({
          tool,
          aiAssists: data.AI_suggestions_accepted,
          commits: data.commits_per_session
        })) : []
      })
    } catch (error) {
      console.warn('[AI_USAGE_SIGNALS] Failed to fetch summary data:', error)
      aiUsageSummaryData = null
    }
    
    // Tag each series with its metricId since the series objects don't have it
    // Defensive check: ensure series are arrays before mapping
    const aiSeriesArray = Array.isArray(aiSeries) ? aiSeries : [];
    const codingSeriesArray = Array.isArray(codingSeries) ? codingSeries : [];
    const commitsSeriesArray = Array.isArray(commitsSeries) ? commitsSeries : [];
    const sessionSeriesArray = Array.isArray(sessionSeries) ? sessionSeries : [];
    
    const taggedAiSeries = aiSeriesArray.map(s => ({ ...s, metricId: 'ide.ai_suggestions_accepted' }))
    const taggedCodingSeries = codingSeriesArray.map(s => ({ ...s, metricId: 'ide.active_coding_time_minutes' }))
    const taggedCommitsSeries = commitsSeriesArray.map(s => ({ ...s, metricId: 'ide.commits_per_session' }))
    const taggedSessionSeries = sessionSeriesArray.map(s => ({ ...s, metricId: 'ide.average_session_length_minutes' }))
    
    // Combine all series
    const ideSeries = [...taggedAiSeries, ...taggedCodingSeries, ...taggedCommitsSeries, ...taggedSessionSeries]
    
    // Merge metrics by (period, tool) instead of creating one record per metric
    const prodPointsMap = new Map()
    
    for (const s of (ideSeries || [])) {
      for (const p of (s.points || [])) {
        const period = p.t?.slice(0, 10)
        const tool =
          normalizeToolId(
            String((s as any)?.toolId ?? (s as any)?.tool_id ?? (s as any)?.tool ?? (s as any)?.label ?? '')
          ) || String((s as any)?.label ?? 'unknown').toLowerCase()
        const key = `${period}::${tool}`
        
        const existing = prodPointsMap.get(key) || {
          period,
          tool,
          team: undefined,
          aiAssists: 0,
          codingMinutes: 0,
          commits: 0,
          sessionMinutes: 0,
          source: 'sim'  // Default to sim
        }
        
        // Detect if this metric has live telemetry
        // Check multiple possible flags (series structure varies by metric)
        // 🔥 FIX: IDE metrics from telemetry API are always live data
        const isLive = (s as any).usesTelemetry === true ||
                      (s as any).isLive === true ||
                      (s as any).dataSource === 'Real' ||
                      (s as any).dataSource === 'Hybrid' ||
                      (s.points && s.points.some((pt: any) => pt.isLive || pt.source === 'live')) ||
                      (s.metricId && String(s.metricId).startsWith('ide.')) // IDE metrics from telemetry are live
        
        // Extract value from point
        const value = p.v ?? (p as any).value ?? 0
        
        // Map each metric to the correct field (accumulate if multiple points)
        if (s.metricId === 'ide.ai_suggestions_accepted') {
          existing.aiAssists = (existing.aiAssists || 0) + value
          if (isLive) existing.source = existing.source === 'sim' ? 'live' : 'hybrid'
        } else if (s.metricId === 'ide.active_coding_time_minutes') {
          existing.codingMinutes = (existing.codingMinutes || 0) + value
          if (isLive) existing.source = existing.source === 'sim' ? 'live' : 'hybrid'
        } else if (s.metricId === 'ide.commits_per_session') {
          existing.commits = (existing.commits || 0) + value
          if (isLive) existing.source = existing.source === 'sim' ? 'live' : 'hybrid'
        } else if (s.metricId === 'ide.average_session_length_minutes') {
          existing.sessionMinutes = (existing.sessionMinutes || 0) + value
          if (isLive) existing.source = existing.source === 'sim' ? 'live' : 'hybrid'
        }
        
        prodPointsMap.set(key, existing)
      }
    }
    
    const prodPoints = Array.from(prodPointsMap.values())
    
    // ============================================================================
    // MERGE AI USAGE SUMMARY DATA FOR AI USAGE SIGNALS
    // ============================================================================
    if (aiUsageSummaryData) {
      dashLog('[AI_USAGE_SIGNALS] Merging summary data into prodSeries...')
      const aiUsagePoints = mapSummaryTotalsToProdSeries(aiUsageSummaryData)
      
      // Merge AI usage data into existing prodPoints
      aiUsagePoints.forEach(aiPoint => {
        const existingKey = `${aiPoint.period}::${aiPoint.tool}`
        const existing = prodPointsMap.get(existingKey)
        
        if (existing) {
          // Merge AI usage data into existing point
          existing.aiAssists = aiPoint.aiAssists
          // Update source to reflect real AI usage data
          if (aiPoint.aiAssists > 0) {
            existing.source = existing.source === 'sim' ? 'live' : 'hybrid'
          }
          dashLog(`[AI_USAGE_SIGNALS] Merged AI data for ${aiPoint.tool}: ${aiPoint.aiAssists} assists`)
        } else {
          // Add new point for AI usage data
          prodPointsMap.set(existingKey, aiPoint)
          dashLog(`[AI_USAGE_SIGNALS] Added AI data point for ${aiPoint.tool}: ${aiPoint.aiAssists} assists`)
        }
      })
      
      // Recreate prodPoints with merged data
      prodPoints.length = 0 // Clear array
      prodPoints.push(...Array.from(prodPointsMap.values()))
      
      dashLog('[AI_USAGE_SIGNALS] Merge complete:', {
        totalPoints: prodPoints.length,
        aiPointsAdded: aiUsagePoints.length,
        toolsWithAI: prodPoints.filter(p => p.aiAssists > 0).map(p => p.tool)
      })
    } else {
      if (PI_DEBUG) console.warn('[AI_USAGE_SIGNALS] No summary data available, AI Usage Signals will show "No data"')
    }
    
    // Build IDE diagnostics (additive, derived from prodPoints)
    try {
      ideDiagnostics.value = buildIdeDiagnostics(prodPoints)
    } catch (error) {
      console.warn('[IDE_DIAGNOSTICS][Dashboards] Error building IDE diagnostics (failing closed):', error)
      ideDiagnostics.value = []  // Fail closed - don't break existing PI
    }

  // (moved) sessionsForUI is set after session fetch completes to avoid TDZ
    
    // Calculate productivity data source context
    const prodContextValue = {
      hasLiveProd: prodPoints.some(p => p.source === 'live' || p.source === 'hybrid'),
      hasSimProd: prodPoints.some(p => p.source === 'sim' || p.source === 'hybrid'),
      liveTools: Array.from(new Set(prodPoints.filter(p => p.source === 'live' || p.source === 'hybrid').map(p => p.tool))),
      simTools: Array.from(new Set(prodPoints.filter(p => p.source === 'sim').map(p => p.tool)))
    }
    
    prodContext.value = prodContextValue
    ghSeries.value = gh
    prodSeries.value = prodPoints

    
    if (PI_DEBUG && !didLogAuditDatasets) {
      didLogAuditDatasets = true
      const prodTools = Array.from(new Set((prodPoints || []).map(p => (p as any)?.tool).filter(Boolean))).sort()
      const ghPeriods = Array.from(new Set((gh || []).map(p => (p as any)?.period).filter(Boolean))).slice(0, 8)
      const prodPeriods = Array.from(new Set((prodPoints || []).map(p => (p as any)?.period).filter(Boolean))).slice(0, 8)
      const ghSample = (gh || []).slice(0, 1)[0] as any
      const prodSample = (prodPoints || []).slice(0, 1)[0] as any

      dashLog('[PI_AUDIT][DATASETS]', {
        datasets: {
          productivityLen: (prodPoints || []).length,
          engOutputLen: (gh || []).length,
          githubSnapshotKeys: githubStore?.rawResponse ? Object.keys(githubStore.rawResponse).slice(0, 12) : [],
        },
        toolIdsSeen: {
          productivity: prodTools,
        },
        samplePeriodKeys: {
          productivity: prodPeriods,
          engOutput: ghPeriods,
        },
        sampleKeys: {
          productivity: prodSample ? Object.keys(prodSample).slice(0, 20) : [],
          engOutput: ghSample ? Object.keys(ghSample).slice(0, 20) : [],
        },
      })
    }

    // 3) Use performance engine harness (unified insights source)
    // CRITICAL: Pass RAW prodPoints so harness can map them correctly
    
    // Dev-only: Inspect GitHub series keys to identify repo field name
    if (import.meta.env.DEV) {
      const sample = Array.isArray(ghSeries.value) ? ghSeries.value[0] : null
      if (PI_DEBUG) console.warn('[PI][Dashboards] ghSeries sample keys', sample ? Object.keys(sample) : null)
      if (PI_DEBUG) console.warn('[PI][Dashboards] ghSeries sample', sample)
    }
    
    // 3a) Fetch session data for TTFC and session-based insights
    // Use all-time historical data (daysToFetch = 0) to match "All available telemetry" UI
    const daysToFetch = 0;
    
    let sessionData: SessionDataPoint[] = []
    let sessionsLoaded = false
    const sessionsFetchStart = performance.now();
    
    // Create new request with AbortController
    sessionsAbortController = new AbortController()
    const signal = sessionsAbortController.signal
    
    // CR-X P0: Orchestrate cold load against single-process Local server.
    // AIOI canonical aggregate completes first, then canonical sessions,
    // then shared enrichment. This keeps the php -S queue shallow and
    // prevents the 10s timeout cascade. AIOI is still independent of
    // session enrichment; it just begins earlier in the sequence.
    let sharedEnrichedPromise: Promise<any> | null = null
    const aioiFrom = ALL_TIME_START
    const aioiTo = `${new Date().toISOString().slice(0, 10)}T23:59:59.999Z`
    if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] AIOI getCanonicalAggregated FETCH_START (first critical request)', { from: aioiFrom, to: aioiTo, period: 'week' })
    const _aioiTraceStart = performance.now()
    try {
      const aioiResult = await getCanonicalAggregated({
        from: aioiFrom,
        to: aioiTo,
        period: 'week'
      })
      if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] AIOI getCanonicalAggregated FETCH_END', { durationMs: Math.round(performance.now() - _aioiTraceStart), recordCount: aioiResult?.data?.length || 0 })
      canonicalAggregated.value = aioiResult?.data || []
      canonicalAggregatedMetadata.value = aioiResult?.metadata || {}
      canonicalError.value = null
      aioiHydrating.value = false
      canonicalAggregateOk.value = true
    } catch (canonicalErr: any) {
      if (PI_DEBUG) console.warn('[DASHBOARDS] Failed to fetch canonical aggregated telemetry:', canonicalErr)
      aioiHydrating.value = false
      canonicalAggregateOk.value = false
      if (canonicalErr?.name === 'AuthError') {
        const authStore = useAuthStore()
        authStore.setAuthError(canonicalErr.type)
      }
      canonicalError.value = canonicalErr?.message || 'Canonical telemetry fetch failed'
      canonicalAggregated.value = []
      canonicalAggregatedMetadata.value = {}
    }

    const _sessionsFetchStart = performance.now();
    const sessionsPromise = timeAsync('sessions_fetch', () => fetchSessionsForTTFC(daysToFetch, signal, analysisContext.cohortId || undefined)).then((data) => {
        const _sessionsFetchMs = Math.round(performance.now() - _sessionsFetchStart);
        if (import.meta.env.DEV) dashLog('[CR5_WS1.4][COLD_PATH] fetchSessionsForTTFC:', _sessionsFetchMs, 'ms', (data?.length || 0), 'rows');
        const sessionsFetchMs = Math.round(performance.now() - sessionsFetchStart);
        pipelineTimings.sessions = sessionsFetchMs;
        stageMark('sessionsFetch', sessionsFetchMs);
        
        dashLog('[DEBUG] fetchSessionsForTTFC returned:', {
          dataCount: data?.length || 0,
          sample: data?.[0]
        });
        
        // Structured logging (DEV only)
        if (import.meta.env.DEV) {
          const responseSize = JSON.stringify(data).length;
          dashLog('[PI FETCH] Sessions', {
            url: `${import.meta.env.VITE_API_BASE_URL || ''}/api/telemetry/canonical`,
            queryParams: { from: '2020-01-01', to: new Date().toISOString().split('T')[0], format: 'sessions', per_page: 200 },
            responseSizeBytes: responseSize,
            recordsReturned: data.length,
            durationMs: sessionsFetchMs,
          });
        }
        
        // PHASE 0 - PROVE SESSION PRIMITIVES FIELDS
        if (data.length > 0) {
          const sampleSession = data[0];
          dashLog('[AI_USAGE_SIGNALS_SESSION_PRIMITIVES]', {
            tool: sampleSession.tool,
            session_ai_burst_count: sampleSession.ai_burst_count,
            session_duration_minutes: sampleSession.duration_ms ? sampleSession.duration_ms / 60000 : null,
            session_ai_suggestions_shown: (sampleSession as any).ai_suggestions_shown,
            active_coding_time_minutes: sampleSession.active_coding_duration_ms ? sampleSession.active_coding_duration_ms / 60000 : null,
            focus_ratio: sampleSession.focus_ratio,
            files_edited: (sampleSession as any).files_edited,
            commits: (sampleSession as any).commit_count,
            available_fields: Object.keys(sampleSession).filter(key => 
              key.includes('ai') || key.includes('session') || key.includes('duration') || 
              key.includes('focus') || key.includes('files') || key.includes('commit')
            )
          });
        } else {
          dashLog('[AI_USAGE_SIGNALS_SESSION_PRIMITIVES]', {
            status: 'NO_SESSIONS',
            message: 'No session primitives available for field analysis'
          });
        }
        
        return data;
      }).catch((err) => {
        if (err.name === 'AbortError') {
          throw err; // Re-throw abort errors
        }
        const sessionsFetchMs = Math.round(performance.now() - sessionsFetchStart);
        pipelineTimings.sessions = sessionsFetchMs;
        stageMark('sessionsFetch', sessionsFetchMs);
        throw err;
      });

    // CR-X Track D1 (P0 FIX): Declare sharedEnrichedPromise at function scope,
    // BEFORE the sessions try/catch block. The promise is consumed later at
    // PI engine input construction (outside this try/catch). Declaring it
    // inside the try block caused ReferenceError: sharedEnrichedPromise is
    // not defined when the PI execution path awaited it.
    // The promise does not depend on sessionData — only on analysisContext.

    // CR-X Gate A: Fetch resolved cost configs with explicit authority contract.
    // - backend_persisted: backend is authoritative
    // - backend_empty: no persisted configs; do NOT present localStorage as org truth
    // - backend_unavailable: local fallback is graceful degradation only
    try {
      const costResult = await fetchOrgToolCostConfigsWithAuthority()
      costConfigAuthority.value = costResult.authority
      // CR-X ECON-1: Store full config (seatCount, costPerSeatMonthly) for editor load
      resolvedCostConfigs.value = costResult.configs
        .filter(c => c.monthlySpend > 0)
        .map(c => ({ toolId: c.toolId, seatCount: c.seatCount, costPerSeatMonthly: c.costPerSeatMonthly, monthlySpend: c.monthlySpend, isConfigured: true }))
    } catch (costErr) {
      if (PI_DEBUG) console.warn('[DASHBOARDS] Failed to fetch org cost configs:', costErr)
      costConfigAuthority.value = 'backend_unavailable'
    }

    const _ctxCohort = analysisContext.cohortId || undefined
    const _ctxTimeRange = (analysisContext.isAllTime && !_ctxCohort) ? undefined : {
      from: analysisContext.dateRange.from,
      to: analysisContext.dateRange.to,
      cohortId: _ctxCohort,
    };
    // CR-X PI FREEZE: If the prior session fetch was partial/error, clear the
    // cache so this refreshPI cycle does a FRESH fetch. This is the key fix
    // for the "github-fetch-complete rerun reuses poisoned cache" failure.
    // The prior fetch may have been partial due to concurrent backend load
    // (GitHub metrics + session pages competing for single-threaded PHP).
    // By the time the rerun fires, the backend is no longer contended, so
    // the fresh fetch should succeed completely.
    const _priorCompleteness = getLastSessionFetchCompleteness();
    if (_priorCompleteness && _priorCompleteness.status !== 'complete') {
      if (import.meta.env.DEV) dashLog('[CRX_PI_FREEZE] Prior session fetch was', _priorCompleteness.status, '— clearing cache for fresh fetch');
      clearSessionPrimitivesCache();
    }
    // CR-X P0: AIOI was already awaited and canonicalAggregated set above.

    try {
      sessionData = await sessionsPromise
      sessionsLoaded = true  // Mark as loaded, even if empty array
      sessionsFetchOk.value = true // CR-X P0-D: evidence-completeness tracking
      // CR-X P0: Start shared enrichment only after canonical sessions are
      // complete. This keeps the single-process Local backend queue shallow
      // and prevents the AIOI/session/secondary request thundering herd.
      sharedEnrichedPromise = fetchSharedEnrichedCanonical(_ctxTimeRange)

      dashLog("🚨 [DEBUG] Sessions fetch completed successfully");
      dashLog("🔥🔥🔥 [SESSION_FETCH_RESULT] sessionData after fetch:", {
        length: sessionData?.length || 0,
        isArray: Array.isArray(sessionData),
        type: typeof sessionData,
        firstItem: sessionData?.[0] ? 'exists' : 'none'
      });
      dashLog("🔥🔥🔥 [AIOI_DEBUG] Will set sessionsForUI to", sessionData?.length, "sessions");

      // PHASE 1 - WIRE AI USAGE SIGNALS TO SESSION PRIMITIVES
      // Map session primitives to AIUsageSignalsPanel format
      aiUsageSessionsCurrent.value = sessionData.map(session => ({
        tool: session.tool || 'unknown',
        source: 'live', // All session primitives are live telemetry
        aiAssists: session.ai_burst_count || 0,
        codingMinutes: Math.round((session.duration_ms || 0) / 60000),
        commits: session.commit_count || 0,
        sessionMinutes: Math.round((session.duration_ms || 0) / 60000),
        aiUsageMinutes: Math.round((session.ai_usage_duration_ms || 0) / 60000),
        aiActiveMinutes: Math.round((session.ai_active_span_ms || 0) / 60000),
        aiChars: session.ai_burst_chars_total || 0,
        aiCharsPerMin: session.ai_chars_per_min || 0,
        aiIntensityBand: session.ai_intensity_band || 'none',
        reworkRatio: session.rework_ratio_est || 0,
        reworkBand: session.rework_band || 'low',
        focusRatio: session.focus_ratio || 0,
        idleRatio: session.idle_ratio || 0,
        debugRatio: session.debug_ratio || 0,
        terminalRatio: session.terminal_ratio || 0,
        flowProfile: session.flow_profile || 'mixed',
        sessionId: session.session_id,
        timestamp: session.timestamp,
        userId: session.user_id,
        gitRepoUrl: session.git_repo_url,
        gitBranch: session.git_branch,
        timeToFirstCommitMs: session.time_to_first_commit_ms,
        aiSpanRatio: session.ai_span_ratio,
        aiEfficiencyScore: session.ai_efficiency_score,
        aiConfidenceAvg: session.ai_confidence_avg,
        workflowClassification: session.workflow_classification,
        workflowEfficiencyScore: session.workflow_efficiency_score,
        sessionQualityScore: session.session_quality_score,
        sessionQualityBand: session.session_quality_band,
        gitContextAttempts: session.git_context_attempts,
        gitContextResolutionMs: session.git_context_resolution_ms,
        gitContextResolvedBeforeEnd: session.git_context_resolved_before_end,
        gitContextStatus: session.git_context_status
      }));
      
      dashLog('[AI_USAGE_SIGNALS_CURRENT_MAPPED]', {
        originalSessionsCount: sessionData.length,
        mappedSessionsCount: aiUsageSessionsCurrent.value.length,
        sampleMappedSession: aiUsageSessionsCurrent.value[0]
      });
      
      // Fetch previous period data for comparison
      try {
        // Determine previous period based on current time scope (default to last 7 days)
        const daysForPrev = 7; // TODO: Make this dynamic based on selectedTimeScope
        const _prevSessionsStart = performance.now();
        const prevSessionsData = await timeAsync('sessions_fetch_prev', () => fetchSessionsForTTFC(daysForPrev, signal));
        if (import.meta.env.DEV) dashLog('[CR5_WS1.4][COLD_PATH] fetchSessionsForTTFC(prev 7d):', Math.round(performance.now() - _prevSessionsStart), 'ms', prevSessionsData.length, 'rows');
        aiUsageSessionsPrev.value = prevSessionsData.map(session => ({
          tool: session.tool || 'unknown',
          source: 'live',
          aiAssists: session.ai_burst_count || 0,
          sessionMinutes: session.duration_ms ? session.duration_ms / 60000 : 0,
          activeCodingMinutes: session.active_coding_duration_ms ? session.active_coding_duration_ms / 60000 : null,
          aiShown: (session as any).ai_suggestions_shown || null,
          focusRatio: session.focus_ratio || null,
          filesEdited: (session as any).files_edited || null,
          commits: (session as any).commit_count || null
        }));
        
        dashLog('[AI_USAGE_SIGNALS_PREV_PERIOD]', {
          currentPeriodSessions: aiUsageSessionsCurrent.value.length,
          previousPeriodSessions: aiUsageSessionsPrev.value.length,
          daysForPrev
        });
      } catch (prevErr) {
        if (PI_DEBUG) console.warn('[AI_USAGE_SIGNALS_PREV_PERIOD] Failed to fetch previous period data:', prevErr);
        aiUsageSessionsPrev.value = [];
      }

  // Expose session rows to child components (used for coverage/sample size)
  try {
    sessionsForUI.value = sessionData || []
    dashLog('[DEBUG] sessionsForUI set:', {
      count: sessionsForUI.value.length,
      sample: sessionsForUI.value[0]
    })
    // Add visible debug indicator in DOM (only if VITE_SHOW_PILOT_DEBUG_OVERLAY=true)
    const showDebugOverlay = (import.meta.env.VITE_SHOW_PILOT_DEBUG_OVERLAY ?? 'false') === 'true'
    if (showDebugOverlay) {
      const debugDiv = document.createElement('div')
      debugDiv.id = 'aioi-debug-indicator'
      debugDiv.style.cssText = 'position:fixed;top:0;left:0;background:red;color:white;padding:10px;z-index:99999;font-size:20px;'
      debugDiv.textContent = `AIOI SESSIONS: ${sessionsForUI.value.length}`
      document.body.appendChild(debugDiv)
    }
  } catch (e) {
    sessionsForUI.value = []
    console.error('[DEBUG] Error setting sessionsForUI:', e)
  }

  // CR-X P0: AIOI fetch was already started in parallel with the session
  // fetch (above, before `await sessionsPromise`). Here we just await it.
  // CR5 WS1 P0 FIX #3: AIOI observed commit/TTFC authority is now derived
  // from the SAME shared enriched canonical result as the PI engine
  // (inside refreshPI via fetchSharedEnrichedCanonical). This eliminates
  // the separate fetchObservedCommitTtfcAuthority call and ensures AIOI
  // and PI consume the same provenance-enriched population.
  // The authority ref is initialized to an empty Map (fail-closed from
  // first render) and is populated inside refreshPI when the shared
  // enriched result is available.

  // Await AIOI fetch (sets canonicalAggregated for AIOI cards)
  try {
    const canonicalResponse = { data: canonicalAggregated.value, metadata: canonicalAggregatedMetadata.value }
    if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] AIOI getCanonicalAggregated FETCH_END', { durationMs: Math.round(performance.now() - _aioiTraceStart), recordCount: canonicalResponse?.data?.length || 0 })
    canonicalAggregated.value = canonicalResponse?.data || []
    canonicalAggregatedMetadata.value = canonicalResponse?.metadata || {}
    canonicalError.value = null // CR-X AH-3: clear error on success
    aioiHydrating.value = false // CR-X P0-C: AIOI is ready — independent of PI sessions
    canonicalAggregateOk.value = true // CR-X P0-D: evidence-completeness tracking
    dashLog('[DASHBOARDS] canonicalAggregated fetched (historical baseline)', {
      from: aioiFrom,
      to: aioiTo,
      count: canonicalAggregated.value.length,
      tools: canonicalAggregatedMetadata.value?.tools_in_population
    })
  } catch (canonicalErr) {
    if (PI_DEBUG) console.warn('[DASHBOARDS] Failed to fetch canonical aggregated telemetry:', canonicalErr)
    aioiHydrating.value = false // CR-X P0-C: AIOI failed — show error, not indefinite loading
    canonicalAggregateOk.value = false // CR-X P0-D: evidence-completeness tracking
    // P0-G Part F: Detect auth errors and set authError state
    if (canonicalErr instanceof Error && canonicalErr.name === 'AuthError') {
      const authStore = useAuthStore()
      authStore.setAuthError(canonicalErr.type)
      if (PI_DEBUG) console.warn('[DASHBOARDS] Auth error detected during canonical fetch:', canonicalErr.type)
    }
    // CR-X AH-3: Set canonicalError so AIOI/PI show error state, not false empty.
    canonicalError.value = canonicalErr instanceof Error ? canonicalErr.message : 'Canonical telemetry fetch failed'
    canonicalAggregated.value = []
    canonicalAggregatedMetadata.value = {}
  }

  // CR5 WS1 P0 FIX #3: AIOI observed commit/TTFC authority is now derived
  // from the SAME shared enriched canonical result as the PI engine
  // (inside refreshPI via fetchSharedEnrichedCanonical). This eliminates
  // the separate fetchObservedCommitTtfcAuthority call and ensures AIOI
  // and PI consume the same provenance-enriched population.
  // The authority ref is initialized to an empty Map (fail-closed from
  // first render) and is populated inside refreshPI when the shared
  // enriched result is available.

  // Canonical hydration complete — empty states are now authoritative
  canonicalHydrating.value = false
  if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] canonicalHydrating SET_FALSE (PI hydration complete)')

      // Checkpoint 1: Sessions fetched - single compact log
      if (import.meta.env.DEV) {
        dashLog('[PI CHECKPOINT] sessions fetched', { from: fromISO, to: toISO, sessionsCount: sessionData.length })
      }
      
      if (TTFC_DEBUG) {
        console.warn('[TTFC_DEBUG][Dashboards] Sessions fetched', {
          count: sessionData.length,
          withTTFC: sessionData.filter(s => s.time_to_first_commit_ms !== null).length
        })
      }
    } catch (err: any) {
      sessionsLoaded = true  // Still mark as loaded even on error; data fetch was attempted
      sessionsFetchOk.value = false // CR-X P0-D: evidence-completeness tracking
      // CR5 P0.5: Ensure canonicalHydrating is cleared even on fetch error.
      // Without this, the loading state stays forever if sessions fetch fails.
      canonicalHydrating.value = false
      if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] canonicalHydrating SET_FALSE (sessions fetch error)')
      if (err.name !== 'AbortError') {
        console.warn('[PI][Dashboards] Failed to fetch sessions (continuing without):', err)
        if (TTFC_DEBUG) {
          console.warn('[TTFC_DEBUG][Dashboards] Sessions fetch FAILED:', err)
        }
      }
    }
    
    // Checkpoint 1: After fetch - populate trace object
    if (typeof window !== 'undefined') {
      const trace = (window as any).__CM_PI_V2_TRACE__ || {};
      trace.fetch = {
        sessionsRawCount: sessionData.length,
        githubByPeriodCount: ghSeries.value.length,
        githubMetricsSummary: {
          prs: githubStore.metrics?.total_pull_requests ?? 0,
          deployments: githubStore.metrics?.deployment_frequency ?? 0,
          mttr: githubStore.metrics?.meanTimeToRecovery ?? null,
        }
      };
      (window as any).__CM_PI_V2_TRACE__ = trace;
    }
    
    // Time from both resolved → runV2Shadow() start
    const shadowStart = performance.now();
    const dataReadyToShadowMs = Math.round(performance.now() - telemetryStart);
    pipelineTimings.dataReadyToShadow = dataReadyToShadowMs;
    stageMark('dataReadyToShadow', dataReadyToShadowMs);

    // POINT #3: V2 diagnostic - immediately before runPerfInsightsHarness is called
    if (isV2ShadowEnabled() && !v2DiagnosticPoint3Logged && sessionData.length > 0) {
      v2DiagnosticPoint3Logged = true
      const firstSession = sessionData[0]
      
      // Identity field values
      const identityFields = {
        source: { value: firstSession?.source, type: typeof firstSession?.source, exists: firstSession && 'source' in firstSession },
        tool: { value: firstSession?.tool, type: typeof firstSession?.tool, exists: firstSession && 'tool' in firstSession },
        tool_raw: { value: firstSession?.tool_raw, type: typeof firstSession?.tool_raw, exists: firstSession && 'tool_raw' in firstSession },
        editor_source: { value: firstSession?.editor_source, type: typeof firstSession?.editor_source, exists: firstSession && 'editor_source' in firstSession },
        ide: { value: firstSession?.ide, type: typeof firstSession?.ide, exists: firstSession && 'ide' in firstSession },
        client_source: { value: firstSession?.client_source, type: typeof firstSession?.client_source, exists: firstSession && 'client_source' in firstSession },
        session_source: { value: firstSession?.session_source, type: typeof firstSession?.session_source, exists: firstSession && 'session_source' in firstSession },
      }
      
      const metadataInfo = firstSession?.metadata
        ? (typeof firstSession.metadata === 'string'
          ? { type: 'string', preview: String(firstSession.metadata).slice(0, 200) }
          : { type: typeof firstSession.metadata, keys: Object.keys(firstSession.metadata) })
        : { type: 'missing' }
      
      if (PI_DEBUG) {
      console.group('[V2_DIAGNOSTIC][POINT_3] Before runPerfInsightsHarness (Dashboards.vue)')
      dashLog('sessionData.length:', sessionData.length)
      dashLog('First sessionData row (FULL):', firstSession)
      dashLog('Object.keys(sessionData[0]):', firstSession ? Object.keys(firstSession) : [])
      dashLog('Identity field VALUES:', identityFields)
      dashLog('Metadata info:', metadataInfo)
      if (firstSession?.metadata && typeof firstSession.metadata === 'object' && !Array.isArray(firstSession.metadata)) {
        dashLog('Metadata identity fields:', {
          'metadata.source': { value: firstSession.metadata.source, type: typeof firstSession.metadata.source, exists: 'source' in firstSession.metadata },
          'metadata.tool': { value: firstSession.metadata.tool, type: typeof firstSession.metadata.tool, exists: 'tool' in firstSession.metadata },
          'metadata.editor_source': { value: firstSession.metadata.editor_source, type: typeof firstSession.metadata.editor_source, exists: 'editor_source' in firstSession.metadata },
          'metadata.ide': { value: firstSession.metadata.ide, type: typeof firstSession.metadata.ide, exists: 'ide' in firstSession.metadata },
          'metadata.client_source': { value: firstSession.metadata.client_source, type: typeof firstSession.metadata.client_source, exists: 'client_source' in firstSession.metadata },
          'metadata.session_source': { value: firstSession.metadata.session_source, type: typeof firstSession.metadata.session_source, exists: 'session_source' in firstSession.metadata },
        })
      }
      console.groupEnd()
      }
    }

    if (PI_DEBUG) {
      const sessionsCountByTool: Record<string, number> = {}
      for (const s of (sessionData || [])) {
        const tool = String((s as any)?.tool ?? (s as any)?.tool_id ?? (s as any)?.source ?? 'unknown')
        sessionsCountByTool[tool] = (sessionsCountByTool[tool] ?? 0) + 1
      }

      const productivityPointsByTool: Record<string, number> = {}
      const prodPointsSourceCounts: Record<string, number> = { live: 0, hybrid: 0, sim: 0, unknown: 0 }
      for (const p of (prodPoints || [])) {
        const tool = String((p as any)?.tool ?? 'unknown')
        productivityPointsByTool[tool] = (productivityPointsByTool[tool] ?? 0) + 1
        const src = String((p as any)?.source ?? 'unknown')
        if (src === 'live' || src === 'hybrid' || src === 'sim') {
          prodPointsSourceCounts[src] = (prodPointsSourceCounts[src] ?? 0) + 1
        } else {
          prodPointsSourceCounts.unknown = (prodPointsSourceCounts.unknown ?? 0) + 1
        }
      }

      const toolsSeenInSessions = Object.keys(sessionsCountByTool).sort()
      const toolsSeenInProdPoints = Object.keys(productivityPointsByTool).sort()

      dashLog('[PI_AUDIT][DATA_EVIDENCE]', {
        sessionsCountByTool,
        productivityPointsByTool,
        prodPointsSourceCounts,
        toolsSeen: {
          sessions: toolsSeenInSessions,
          prodPoints: toolsSeenInProdPoints,
        },
      })
    }
    
    const harnessStart = performance.now();

    dashLog("🚨 [DEBUG] About to execute series proof - reached harness start");

    // PHASE 1: Runtime proof - show actual series shapes + period keys
    if (PI_DEBUG) console.info("[PI_SERIES_PROOF]", {
      prodLen: prodPoints?.length,
      prodPeriodSample: prodPoints?.slice(0, 5).map((p:any)=>p.period),
      prodKeys: prodPoints?.[0] ? Object.keys(prodPoints[0]).sort() : [],

      ghLen: ghSeries.value?.length,
      ghPeriodSample: ghSeries.value?.slice(0, 5).map((p:any)=>p.period),
      ghKeys: ghSeries.value?.[0] ? Object.keys(ghSeries.value[0]).sort() : [],

      ghTeamKeys: (ghSeries.value?.[0] as any)?.github_team_metrics
        ? Object.keys((ghSeries.value?.[0] as any).github_team_metrics).sort()
        : [],
    });

    // PHASE 2: Prove the API snapshots actually contain the data before PIs run
    if (PI_DEBUG) console.info("[PI_SNAPSHOT_PROOF]", {
      sessionsLoaded: sessionData.length > 0,
      sessionsCount: sessionData?.length,
      sessionsFirstKeys: sessionData?.[0] ? Object.keys(sessionData[0]).slice(0, 30) : [],
      sessionsHasTTFC: sessionData?.some(s => (s.time_to_first_commit_ms ?? 0) > 0) ?? false,
      sessionsHasAISignals: sessionData?.some(s =>
        (s.ai_usage_duration_ms ?? 0) > 0 ||
        (s.ai_burst_count ?? 0) > 0 ||
        (s.ai_intensity_band != null)
      ) ?? false,

      productivityPoints: prodPoints?.length,
      productivityFirstKeys: prodPoints?.[0] ? Object.keys(prodPoints[0]).slice(0, 30) : [],

      githubTeamKeys: ghSeries.value?.[0] ? Object.keys(ghSeries.value[0]).slice(0, 30) : [],
      githubHasCommitsCount: (() => {
        const p = ghSeries.value?.[0] as any;
        return (p?.github_team_metrics?.commits ?? p?.github_team_metrics?.total_commits ?? null);
      })(),
    });

    const githubSnapshot = githubStore.rawResponse;
    
    if (PI_DEBUG) console.info("SENTINEL_PI_FIXRUN__2026_01_15__A");
    
    // PHASE 1: Runtime proof - show actual series shapes + period keys
    if (PI_DEBUG) console.info("[PI_SERIES_PROOF]", {
      prodLen: prodPoints?.length,
      prodPeriodSample: prodPoints?.slice(0, 5).map((p:any)=>p.period),
      prodKeys: prodPoints?.[0] ? Object.keys(prodPoints[0]).sort() : [],

      ghLen: ghSeries.value?.length,
      ghPeriodSample: ghSeries.value?.slice(0, 5).map((p:any)=>p.period),
      ghKeys: ghSeries.value?.[0] ? Object.keys(ghSeries.value[0]).sort() : [],

      ghTeamKeys: (ghSeries.value?.[0] as any)?.github_team_metrics
        ? Object.keys((ghSeries.value?.[0] as any).github_team_metrics).sort()
        : [],
    });
    
    dashLog('🔥🔥🔥 [REACHED_PRE_HARNESS_SECTION] Code reached this point');
    dashLog('🔥🔥🔥 [PRE_HARNESS] About to start harness section');
    dashLog('🔥🔥🔥 [PRE_HARNESS] sessionData length:', sessionData?.length);
    dashLog('🔥🔥🔥 [PRE_HARNESS] prodPoints length:', prodPoints?.length);
    dashLog('🔥🔥🔥 [PRE_HARNESS] ghSeries.value length:', ghSeries.value?.length);
    
    // PHASE 3: Prove what the harness actually hands to PI compute
    if (PI_DEBUG) console.info("[PI_HARNESS_INPUT]", {
      sessionsCount: sessionData?.length,
      productivityPoints: prodPoints?.length,
      githubPoints: ghSeries.value?.length,
    });
    
    // 🔥 DEBUG: Check session data structure for individual PIs
    dashLog('🔥🔥🔥 [SESSION_DEBUG_CHECK] sessionData:', {
      sessionDataExists: !!sessionData,
      sessionDataLength: sessionData?.length || 0,
      sessionDataType: typeof sessionData,
      sessionDataIsArray: Array.isArray(sessionData),
      // Force this log to always show
      forcedLog: 'SESSION_DEBUG_CHECK_ALWAYS_VISIBLE'
    });
    
    if (sessionData && sessionData.length > 0) {
      dashLog('🔥🔥🔥 [SESSION_DEBUG] Sample session data:', {
        firstSession: sessionData[0],
        sessionKeys: Object.keys(sessionData[0] || {}),
        hasAIFields: {
          ai_usage_duration_ms: sessionData[0]?.ai_usage_duration_ms,
          ai_burst_count: sessionData[0]?.ai_burst_count,
          ai_suggestions_accepted: sessionData[0]?.ai_suggestions_accepted,
        },
        hasCommitFields: {
          commit_count: sessionData[0]?.commit_count,
          lines_added: sessionData[0]?.lines_added,
          lines_removed: sessionData[0]?.lines_removed,
        },
        hasTimingFields: {
          session_duration_minutes: sessionData[0]?.session_duration_minutes,
          active_coding_duration_minutes: sessionData[0]?.active_coding_duration_minutes,
          time_to_first_commit_ms: sessionData[0]?.time_to_first_commit_ms,
        }
      });
    } else {
      dashLog('🔥🔥🔥 [SESSION_DEBUG] NO SESSION DATA - This is why individual PIs are not firing!');
    }
    
    dashLog('🔥🔥🔥 [REACHED_DATA_DEBUG_SECTION] Code reached data debug section');
    dashLog('🔥🔥🔥 [HARNESS_CALL] About to call runPerfInsightsHarness');
    dashLog('🔥🔥🔥 [HARNESS_CALL] ghSeries.value length:', ghSeries.value?.length);
    dashLog('🔥🔥🔥 [HARNESS_CALL] prodPoints length:', prodPoints?.length);
    dashLog('🔥🔥🔥 [HARNESS_CALL] sessionData length:', sessionData?.length);
    
    // 🔥 DEBUG: Check what data types we actually have
    dashLog('🔥🔥🔥 [DATA_DEBUG] Data availability:', {
      hasGitHubData: ghSeries.value && ghSeries.value.length > 0,
      hasProductivityData: prodPoints && prodPoints.length > 0,
      hasSessionData: sessionData && sessionData.length > 0,
      githubSample: ghSeries.value?.[0] ? Object.keys(ghSeries.value[0]).slice(0, 10) : [],
      productivitySample: prodPoints?.[0] ? Object.keys(prodPoints[0]).slice(0, 10) : [],
      sessionSample: sessionData?.[0] ? Object.keys(sessionData[0]).slice(0, 10) : []
    });
    
    // 🔥 CRITICAL: Log the githubSnapshot that was already declared earlier
    dashLog('🔥🔥🔥 [HARNESS_CALL] githubSnapshot available:', !!githubSnapshot);
    dashLog('🔥🔥🔥 [HARNESS_CALL] githubSnapshot keys:', githubSnapshot ? Object.keys(githubSnapshot).slice(0, 10) : null);
    dashLog('🔥🔥🔥 [HARNESS_CALL] has reviewer_load_concentration:', !!githubSnapshot?.reviewer_load_concentration);
    
    // 🔥 CRITICAL: Get the raw GitHub API response for V2 compute functions
    dashLog('🔥🔥🔥 [DASHBOARDS_DEBUG] Starting githubSnapshot extraction');
    dashLog('🔥🔥🔥 [DASHBOARDS_DEBUG] githubStore exists:', !!githubStore);
    dashLog('🔥🔥🔥 [DASHBOARDS_DEBUG] githubStore type:', typeof githubStore);
    
    // 🔥 FORCE: Get the raw response directly from githubStore
    let githubSnapshotForHarness = null;
    
    // 🔥 FIX: Use githubStore.rawResponse which contains the actual API response with PI fields
    if (githubStore && (githubStore as any).rawResponse) {
      githubSnapshotForHarness = (githubStore as any).rawResponse;
      
      // Use githubSnapshot as single source of truth - no manual patching
      dashLog('🔥🔥🔥 [DASHBOARDS_DEBUG] Using githubStore.rawResponse - CORRECT!');
      
      // 🔥 PHASE 1 RAW INPUT SNAPSHOT: Log all Review & Merge and Deploy & Operate fields
      dashLog('🔍 [PHASE1_RAW_INPUT_SNAPSHOT] githubSnapshotForHarness FULL INSPECTION:', {
        exists: !!githubSnapshotForHarness,
        type: typeof githubSnapshotForHarness,
        allKeys: githubSnapshotForHarness && typeof githubSnapshotForHarness === 'object' ? Object.keys(githubSnapshotForHarness) : null,
        
        // Review & Merge fields
        pr_review_metrics: {
          exists: !!githubSnapshotForHarness?.pr_review_metrics,
          type: typeof githubSnapshotForHarness?.pr_review_metrics,
          keys: githubSnapshotForHarness?.pr_review_metrics ? Object.keys(githubSnapshotForHarness.pr_review_metrics) : null,
          total_prs: githubSnapshotForHarness?.pr_review_metrics?.total_prs,
          merged_prs: githubSnapshotForHarness?.pr_review_metrics?.merged_prs,
          pr_reopened_count: githubSnapshotForHarness?.pr_review_metrics?.pr_reopened_count,
          review_count: githubSnapshotForHarness?.pr_review_metrics?.review_count,
          unique_reviewer_count: githubSnapshotForHarness?.pr_review_metrics?.unique_reviewer_count
        },
        
        pr_analytics: {
          exists: !!githubSnapshotForHarness?.pr_analytics,
          type: typeof githubSnapshotForHarness?.pr_analytics,
          keys: githubSnapshotForHarness?.pr_analytics ? Object.keys(githubSnapshotForHarness.pr_analytics) : null,
          total_prs: githubSnapshotForHarness?.pr_analytics?.total_prs,
          merged_pull_requests: githubSnapshotForHarness?.pr_analytics?.merged_pull_requests
        },
        
        reviewer_load_concentration: githubSnapshotForHarness?.reviewer_load_concentration,
        pr_review_cycles: githubSnapshotForHarness?.pr_review_cycles,
        reopen_pressure_spike: githubSnapshotForHarness?.reopen_pressure_spike,
        large_pr_mix_risk: githubSnapshotForHarness?.large_pr_mix_risk,
        
        // Deploy & Operate fields
        deployment_metrics: {
          exists: !!githubSnapshotForHarness?.deployment_metrics,
          type: typeof githubSnapshotForHarness?.deployment_metrics,
          keys: githubSnapshotForHarness?.deployment_metrics ? Object.keys(githubSnapshotForHarness.deployment_metrics) : null,
          failed_deployment_count: githubSnapshotForHarness?.deployment_metrics?.failed_deployment_count,
          success_deployment_count: githubSnapshotForHarness?.deployment_metrics?.success_deployment_count,
          change_failure_rate: githubSnapshotForHarness?.deployment_metrics?.change_failure_rate,
          latest_deployment: githubSnapshotForHarness?.deployment_metrics?.latest_deployment
        },
        
        stale_deployment_signal: githubSnapshotForHarness?.stale_deployment_signal,
        failed_deployment_pressure: githubSnapshotForHarness?.failed_deployment_pressure,
        latest_deployment_unhealthy: githubSnapshotForHarness?.latest_deployment_unhealthy,
        
        // GitHub weekly metrics
        github_team_metrics: {
          exists: !!githubSnapshotForHarness?.github_team_metrics,
          total_prs: githubSnapshotForHarness?.github_team_metrics?.total_prs,
          total_commits: githubSnapshotForHarness?.github_team_metrics?.total_commits,
        }
      });
    } else {
      dashLog('🔥🔥🔥 [DASHBOARDS_DEBUG] No metrics found in githubStore');
    }
    
    dashLog('🔥🔥🔥 [DASHBOARDS_DEBUG] Final githubSnapshotForHarness:', {
      exists: !!githubSnapshotForHarness,
      type: typeof githubSnapshotForHarness,
      keys: githubSnapshotForHarness && typeof githubSnapshotForHarness === 'object' ? Object.keys(githubSnapshotForHarness).slice(0, 15) : null
    });
    
    dashLog('🔥🔥🔥 [HARNESS_CALL] githubSnapshot available:', !!githubSnapshotForHarness);
    dashLog('🔥🔥🔥 [HARNESS_CALL] githubSnapshot keys:', githubSnapshotForHarness ? Object.keys(githubSnapshotForHarness).slice(0, 10) : null);
    dashLog('🔥🔥🔥 [HARNESS_CALL] has reviewer_load_concentration:', !!githubSnapshotForHarness?.reviewer_load_concentration);
    
    // =====================================
    // PHASE 0: HARNESS TIMING MARKERS
    // =====================================
    const tHarness0 = performance.now();
    cmMark(traceId, "HARNESS START");
    
    // 🔥 CRITICAL: Call runPerfInsightsHarness with githubSnapshot
    // 🔥 PHASE 0 EVIDENCE: PI compute entry logging
    const githubRaw = githubStore.rawResponse
    dashLog('[PI_COMPUTE_ENTRY]', {
        route: window.location.pathname + window.location.search,
        timestamp: Date.now(),
        github_data_available: {
          hasRawResponse: !!githubRaw,
          github_connected: githubRaw?.github_connected,
          github_connection_reason: githubRaw?.github_connection_reason,
          total_prs: githubRaw?.team_metrics?.total_prs,
          failed_deployments: githubRaw?.deployment_metrics?.failed_deployment_count,
          has_all_prs_array: Array.isArray(githubRaw?.all_prs_truncated),
          all_prs_length: githubRaw?.all_prs_truncated?.length,
          has_deploy_array: Array.isArray(githubRaw?.deployments_truncated),
          deploy_length: githubRaw?.deployments_truncated?.length
        },
        pi_inputs: {
          ghSeries_length: ghSeries.value?.length,
          prodPoints_length: prodPoints?.length,
          sessionData_length: sessionData?.length,
          hasGithubSnapshot: !!githubSnapshotForHarness,
          githubSnapshot_keys: githubSnapshotForHarness ? Object.keys(githubSnapshotForHarness).slice(0, 10) : null
        }
      });
    
        
        
    // Call the harness for PI computation
    dashLog('[DASHBOARD_DEBUG] About to call runPerfInsightsHarness');
    
    if (PI_DEBUG) console.warn('[PI_PIPELINE_CHECK][INPUT]', {
      telemetryRows: Array.isArray(sessionData) ? sessionData.length : 'not-array',
      sessionsForPI: Array.isArray(sessionData) ? sessionData.length : 'not-array',
      githubKeys: ghSeries.value ? Object.keys(ghSeries.value).length : 0,
      finalPiEngineEnabled,
    });
    
    if (PI_DEBUG) console.warn('[PI_INPUT_CHECK][BEFORE_HARNESS]', {
      aiSeriesPoints: aiSeries?.points?.length ?? 0,
      codingSeriesPoints: codingSeries?.points?.length ?? 0,
      commitsSeriesPoints: commitsSeries?.points?.length ?? 0,
      sessionSeriesPoints: sessionSeries?.points?.length ?? 0,
      ideSeriesCount: Array.isArray(ideSeries) ? ideSeries.length : 0,
      prodPointsCount: Array.isArray(prodPoints) ? prodPoints.length : 0,
      githubSnapshotKeyCount: Object.keys(githubSnapshotForHarness || {}).length,
      githubByPeriodCount: Array.isArray(ghSeries.value) ? ghSeries.value.length : 0,
    });
    
    // CR1 Historical Baseline Contract: prodPoints (recent trend) may be empty
    // when local telemetry ends before the current date window. The final engine
    // uses sessionRows (all-time canonical sessions) as its baseline. An empty
    // recent trend returns an empty trend, not an empty baseline.
    const hasSessionData = Array.isArray(sessionData) && sessionData.length > 0
    const hasGithubSnapshot = githubSnapshotForHarness && Object.keys(githubSnapshotForHarness).length > 0
    const hasProdPoints = Array.isArray(prodPoints) && prodPoints.length > 0

    const baselineSource = hasSessionData
      ? 'all_time_canonical_telemetry'
      : 'empty';

    dashLog('[PI_INPUT_CHECK][BASELINE_SOURCE]', {
      baselineSource,
      baselineTelemetryRecords: sessionData?.length || 0,
      trendTelemetryRecords: prodPoints?.length || 0,
      hasGithubSnapshot,
      githubSnapshotKeys: hasGithubSnapshot ? Object.keys(githubSnapshotForHarness).length : 0,
    });

    if (!hasProdPoints) {
      if (PI_DEBUG) console.warn('[PI_INPUT_CHECK][EMPTY_TREND]', {
        baselineSource,
        reason: 'recent trend prodPoints empty — baseline is separate from trend',
        hasSessionData,
        hasGithubSnapshot,
        sessionDataCount: sessionData?.length || 0,
      });

      // Only block when baseline AND trend AND GitHub are all empty.
      if (!hasSessionData && !hasGithubSnapshot) {
        if (insights.value && insights.value.length > 0) {
          if (PI_DEBUG) console.warn('[PI_INPUT_CHECK][KEEPING_PREVIOUS_INSIGHTS]', {
            previousCount: insights.value.length,
            reason: 'all inputs empty'
          });
          return;
        }
        if (PI_DEBUG) console.warn('[PI_INPUT_CHECK][NO_PREVIOUS_INSIGHTS]', 'All inputs empty - PI will be empty');
      } else {
        dashLog('[PI_INPUT_CHECK][BASELINE_AVAILABLE]', {
          baselineSource,
          reason: 'prodPoints (trend) empty but baseline sessionData or githubSnapshot has data',
          sessionDataCount: sessionData?.length || 0,
        });
      }
    }
    
    // =====================================
    // PI ENGINE SELECTION - Use final engine if enabled
    // =====================================
    let assignedSource = 'none';
    let nextInsights: PerformanceInsight[] = [];
    let finalEngineCount = 0;
    let legacyHarnessCount = 0;
    
    if (finalPiEngineEnabled) {
      dashLog('[PI_ENGINE_SELECTION] Using final canonical PI engine');
      try {
        // CR5 WS1 P0 FIX #3: Use the shared enriched canonical population
        // for the PI engine. This is the SAME enriched result that AIOI
        // derives its observed commit/TTFC authority from. The enriched
        // rows contain provenance fields (session_has_commit_outcome,
        // simulated, ttfc_from_enriched, session_commits_source,
        // ttfc_source) that the PI engine generators need to produce
        // observed findings instead of INSUFFICIENT_IDE_DATA.
        //
        // fetchSessionsForTTFC (realDataBridge) is still used for the
        // UI-facing session data (sessionsForUI, aiUsageSessionsCurrent)
        // but NOT for the PI engine input — it lacks enrichment.
        //
        // The 30s cache + in-flight dedupe in fetchSessionPrimitives
        // ensures this does NOT cause a duplicate fetch if AIOI already
        // fetched the same population.
        const _sharedEnrichedStart = performance.now();
        // CR-X Track D1: Reuse the sharedEnrichedPromise started earlier in
        // refreshPI (parallelized with AIOI fetch). This eliminates the duplicate
        // canonical network fetch — the promise was already in-flight.
        const sharedEnriched = await timeAsync('shared_enriched_fetch', () => sharedEnrichedPromise);
        if (import.meta.env.DEV) dashLog('[CR5_WS1.4][COLD_PATH] fetchSharedEnrichedCanonical:', Math.round(performance.now() - _sharedEnrichedStart), 'ms', sharedEnriched.sessionRows.length, 'rows');

        // CR-X PI FREEZE: Track the PI engine's session fetch completeness.
        // This is the authority for whether PI can present a complete portfolio.
        // GitHub success must not conceal telemetry failure.
        const _piCompleteness = getLastSessionFetchCompleteness();
        piSessionFetchCompleteness.value = _piCompleteness?.status ?? null;
        if (import.meta.env.DEV && _piCompleteness) {
          dashLog('[CRX_PI_FREEZE] PI session fetch completeness:', _piCompleteness);
        }

        // CR-X Gate A: Store authoritative canonical session rows for PBT
        // cost allocation denominator. These are the full org population.
        authoritativeCanonicalSessions.value = sharedEnriched.sessionRows || [];

        // Derive AIOI authority from the SAME enriched result
        observedCommitTtfcAuthority.value = sharedEnriched.observedAuthority;

        // CR5 WS1 P0 FIX #3: Phase timing for cold-path attribution
        const _piEngineStart = performance.now();
        stageMark('toEngineEntry', _piEngineStart - piBreakdownStart);

        // CR-X 3D.4A: Fetch a FRESH authenticated github snapshot for the
        // canonical PI input. PBT uses /api/delivery/timeseries (always fresh
        // via metricsFacade). PI must use the same fresh authority to avoid
        // source-path divergence where PBT shows the extended April–June
        // population while PI shows an older June-era LKG population.
        //
        // CR-X PERF P0: Reuse the already-resolved githubStore.rawResponse
        // when it is eligible, instead of issuing a second forced-fresh
        // /api/metrics?nocache=1&github_nocache=1 request. The store snapshot
        // is the result of the force=true fetch in this same refresh cycle
        // (onMounted + refreshPI both call githubStore.fetchMetrics). We
        // apply the same normalization as fetchGithubSnapshot, so the PI
        // input is byte-equivalent to the network path. Fallback to
        // fetchGithubSnapshot() only when no eligible store snapshot exists.
        //
        // FAIL CLOSED: If the resolved snapshot is ineligible or the
        // fallback fetch fails, do NOT silently substitute a potentially
        // stale githubStore.rawResponse as current canonical PI GitHub
        // evidence. GitHub-derived Review & Merge / Deploy & Operate / Unit
        // Economics findings become unavailable/empty via existing generator
        // evidence gates. Telemetry-only findings continue normally from
        // sessionRows.
        let freshGithubSnapshot: any = null;
        try {
          const _ghStart = performance.now();
          freshGithubSnapshot = await timeAsync('fresh_github_snapshot', () => resolveGithubSnapshotForPI(githubStore.rawResponse));
          stageMark('githubResolve', performance.now() - _ghStart);
        } catch (e) {
          dashLog('[CR-X_3D.4A][FRESH_GH_FETCH_ERROR]', e);
        }
        const ghResolution = resolveCanonicalGithubInput(freshGithubSnapshot, {
          mapByPeriod: mapGitHubToEngOutputByGranularity,
          granularity: granularity.value,
        });
        const piGithubSnapshot = ghResolution.githubSnapshot;
        const piGithubByPeriod = ghResolution.githubByPeriod;
        if (!ghResolution.freshEligible) {
          console.warn('[CR-X_3D.4A] Fresh github snapshot unavailable or ineligible — PI GitHub-derived findings fail closed:', ghResolution.reason);
        }

        const canonicalInput: CanonicalInsightInput = {
          sessionRows: sharedEnriched.sessionRows,
          githubByPeriod: piGithubByPeriod,
          githubSnapshot: piGithubSnapshot,
          productivityByPeriod: prodPoints,
          granularity: 'week',
          // CR-X Track A: Pass population context for PI labeling
          populationContextLabel: analysisContext.populationLabel,
          populationScope: analysisContext.hasFilters ? 'scoped' : 'org_level',
          // CR-X Track P2: Pass resolved cost configs as primary cost authority
          externalCostConfigs: resolvedCostConfigs.value.length > 0 ? resolvedCostConfigs.value : undefined,
        };

        // DEV-only: prove provenance fields exist on PI input rows
        if (import.meta.env.DEV && canonicalInput.sessionRows.length > 0) {
          const sample = canonicalInput.sessionRows[0];
          dashLog('[CR5_WS1][PI_INPUT_PROVENANCE_PROOF]', {
            rowCount: canonicalInput.sessionRows.length,
            sampleHasSessionCommitsSource: 'session_commits_source' in sample,
            sampleHasTtfcSource: 'ttfc_source' in sample,
            sampleHasSessionHasCommitOutcome: 'session_has_commit_outcome' in sample,
            sampleHasSimulated: 'simulated' in sample,
            sampleHasTtfcFromEnriched: 'ttfc_from_enriched' in sample,
            sampleSessionCommitsSource: sample.session_commits_source,
            sampleTtfcSource: sample.ttfc_source,
          });
        }

        dashLog('[DASHBOARDS][CANONICAL_INPUT_BEFORE_ENGINE]', {
          sessionRowsCount: canonicalInput.sessionRows.length,
          githubSnapshotExists: !!canonicalInput.githubSnapshot,
          reviewer_load_concentration: canonicalInput.githubSnapshot?.reviewer_load_concentration,
          pr_review_metrics: canonicalInput.githubSnapshot?.pr_review_metrics
        });
        
        const finalInsights = await generateFinalCanonicalInsights(canonicalInput);
        const _piEngineMs = Math.round(performance.now() - _piEngineStart);
        stageMark('piEngine', _piEngineMs);
        nextInsights = Array.isArray(finalInsights) ? finalInsights : [];
        finalEngineCount = nextInsights.length;
        assignedSource = 'final_engine';

        // CR5 WS1 P0 FIX #3: Log phase timing for cold-path attribution
        if (import.meta.env.DEV) {
          dashLog('[CR5_WS1][PI_PHASE_TIMING]', {
            sharedEnrichedFetchMs: Math.round(performance.now() - _piEngineStart + _piEngineMs), // approximate
            piEngineComputeMs: _piEngineMs,
            insightCount: finalEngineCount,
          });
        }
        
        dashLog('[PI_ENGINE_SELECTION][FINAL_ENGINE_RETURN]', {
          count: finalEngineCount,
          ids: nextInsights.map(i => i.id).slice(0, 25)
        });
      } catch (error) {
        console.error('[PI_ENGINE_SELECTION][FINAL_ENGINE_ERROR]', error);
        // 🔥 P1 FIX: Do NOT use cached results if API is empty
        const hasAnyData = (Array.isArray(sessionData) && sessionData.length > 0) || 
                          (githubStore.metrics && Object.values(githubStore.metrics).some(v => v != null && v !== 0));
        
        if (!hasAnyData) {
          if (PI_DEBUG) console.warn('[PI_ENGINE_SELECTION] Final engine failed AND API is empty, returning empty');
          nextInsights = [];
          assignedSource = 'final_engine_error_empty_api';
        } else if (!isLivePilotMode.value && lastGoodInsights.value && lastGoodInsights.value.length > 0) {
          if (PI_DEBUG) console.warn('[PI_ENGINE_SELECTION] Final engine failed but API has data, keeping prior cached results (demo/local only)');
          nextInsights = [...lastGoodInsights.value];
          assignedSource = 'final_engine_cached';
        } else {
          if (PI_DEBUG) console.warn('[PI_ENGINE_SELECTION] Final engine failed, no cached results available (live-pilot mode or no cache)');
          nextInsights = [];
          assignedSource = 'final_engine_error';
        }
      }
    } else {
      // PILOT LOCKDOWN: Legacy harness disabled for pilot.
      // 🔥 P1 FIX: Do NOT use cached results if API is empty
      const hasAnyData = (Array.isArray(sessionData) && sessionData.length > 0) || 
                        (githubStore.metrics && Object.values(githubStore.metrics).some(v => v != null && v !== 0));
      
      dashLog('[PI_ENGINE_SELECTION] Final engine not enabled', { hasAnyData });
      
      if (!hasAnyData) {
        if (PI_DEBUG) console.warn('[PI_ENGINE_SELECTION] API is empty, returning empty (no cache)');
        nextInsights = [];
        assignedSource = 'no_engine_empty_api';
      } else if (!isLivePilotMode.value && lastGoodInsights.value && lastGoodInsights.value.length > 0) {
        nextInsights = [...lastGoodInsights.value];
        assignedSource = 'final_engine_cached';
      } else {
        nextInsights = [];
        assignedSource = 'no_engine_available';
      }
    }
    
    // Update browser debug object
    window.__CM_PI_PIPELINE_DEBUG__ = {
      finalPiEngineEnabled,
      assignedSource,
      finalEngineCount,
      legacyHarnessCount,
      assignedCount: nextInsights.length,
      inputCounts: {
        telemetryRows: Array.isArray(sessionData) ? sessionData.length : 0,
        sessionsForPI: Array.isArray(sessionData) ? sessionData.length : 0,
        prodPoints: Array.isArray(prodPoints) ? prodPoints.length : 0,
        githubSnapshotKeyCount: Object.keys(githubSnapshotForHarness || {}).length,
        githubByPeriodCount: Array.isArray(ghSeries.value) ? ghSeries.value.length : 0,
        githubByPeriodSource: (typeof window !== 'undefined' && (window as any).__CM_GITHUB_BY_PERIOD_SOURCE) || 'unknown',
      },
      assignedIds: nextInsights.map(i => i.id),
      lastUpdatedAt: new Date().toISOString(),
    };
    
    if (PI_DEBUG) console.warn('[PI_INPUT_CHECK][ENGINE_SELECTION]', {
      finalPiEngineEnabled,
      finalEngineCount,
      legacyHarnessCount,
      assignedSource,
      assignedCount: nextInsights.length,
    });
    
    // 🔥 P1 FIX: Detect empty API data and clear sticky cache
    const hasAnyTelemetryData = Array.isArray(sessionData) && sessionData.length > 0;
    const hasAnyGitHubData = githubStore.metrics && Object.values(githubStore.metrics).some(v => v != null && v !== 0);
    const apiReturnsEmpty = !hasAnyTelemetryData && !hasAnyGitHubData;
    
    if (apiReturnsEmpty) {
      if (PI_DEBUG) console.warn('[PI_EMPTY_DATA_DETECTED]', {
        telemetryRows: sessionData?.length || 0,
        githubMetrics: githubStore.metrics,
        clearingCache: true
      });
      // Clear sticky cache when API is truly empty
      lastGoodInsights.value = [];
      nextInsights = [];
      assignedSource = 'empty_api_data';
    }
    
    // Guard against empty assignment
    if (!Array.isArray(nextInsights) || nextInsights.length === 0) {
      window.__CM_PI_PIPELINE_DEBUG__ = {
        ...window.__CM_PI_PIPELINE_DEBUG__,
        assignedSource,
        assignedCount: 0,
        blockedEmptyAssignment: true,
        apiReturnsEmpty,
        hasAnyTelemetryData,
        hasAnyGitHubData
      };
      
      if (PI_DEBUG) console.warn('[PI_ASSIGNMENT_BLOCKED_EMPTY]', {
        assignedSource,
        finalPiEngineEnabled,
        finalEngineCount,
        legacyHarnessCount,
        apiReturnsEmpty
      });
      
      // 🔥 P1 FIX: Do NOT keep previous insights if API is empty
      if (!apiReturnsEmpty && insights.value && insights.value.length > 0) {
        if (PI_DEBUG) console.warn('[PI_ASSIGNMENT][KEEPING_PREVIOUS]', {
          previousCount: insights.value.length,
          reason: 'API has data but engine returned empty'
        });
        return; // Exit early, keep existing insights
      }
      
      // If API is empty or no previous insights, proceed with empty
      if (PI_DEBUG) console.warn('[PI_ASSIGNMENT][PROCEEDING_EMPTY]', {
        apiReturnsEmpty,
        reason: apiReturnsEmpty ? 'API returns empty data' : 'No previous insights'
      });
    }
    
    // =====================================
    // PHASE 0: HARNESS END MARKER
    // =====================================
    cmMark(traceId, "HARNESS END", {
      ms: Math.round(performance.now() - tHarness0),
      insights: nextInsights?.length ?? null
    });
    
    logRaceEvent('PI_HARNESS_SUCCESS', { 
      requestId, 
      insightsCount: nextInsights?.length || 0,
      githubSeriesCount: ghSeries.value?.length || 0,
      productivitySeriesCount: prodPoints?.length || 0,
      sessionsCount: sessionData?.length || 0,
      totalPipelineMs: Math.round(performance.now() - shadowStart)
    })
    
    // CR5 P1: Distinguish findings from diagnostics in the harness log.
    const _nextInsights = nextInsights || [];
    const _findingCount = _nextInsights.filter((i: any) => i.isDiagnostic !== true).length;
    const _diagnosticCount = _nextInsights.filter((i: any) => i.isDiagnostic === true).length;
    dashLog(`[HARNESS_RESULT] Generated: ${_nextInsights.length} PIs (${_findingCount} findings, ${_diagnosticCount} diagnostics)`);
    
    // =====================================
    // PHASE 3A: SIGNATURE CAPTURE (SAFE POINT A)
    // =====================================
    const signatureRaw = piSignature(nextInsights || []);
    const signatureRawCount = (nextInsights || []).length;

    // === RUNTIME TRACE 3: Immediately before insights.value assignment ===
    dashLog('[RUNTIME_TRACE][STAGE_3_BEFORE_INSIGHTS_ASSIGN]', {
      count: nextInsights?.length || 0,
      ids: nextInsights?.map(i => i.id) || [],
      titles: nextInsights?.map(i => i.title) || []
    });
    // === END RUNTIME TRACE ===
    
    const _stateAssignStart = performance.now();
    insights.value = [...nextInsights];
    stageMark('stateAssign', performance.now() - _stateAssignStart);
    dashLog('[PI_PIPELINE_TRACE][STAGE_11_STATE_ASSIGNMENT]', { 
      insightsAssigned: insights.value.length,
      insightIds: insights.value.map(i => i.id)
    });
    
    // Empty array warning
    if (insights.value.length === 0) {
      if (PI_DEBUG) console.warn('[PI_PIPELINE_TRACE][WARNING] EMPTY ARRAY: No insights assigned to state after merge');
      if (PI_DEBUG) console.warn('[PI_PIPELINE_TRACE][WARNING] This indicates a pipeline failure - all stages returned empty arrays');
    }
    
    const shadowTotalMs = Math.round(performance.now() - shadowStart);
    pipelineTimings.shadowTotal = shadowTotalMs;
    stageMark('shadowTotal', shadowTotalMs);

    // ============================================================
    // AUTOMATED PROVENANCE AUDIT
    // ============================================================
    // Run audit automatically after PI generation
    // Note: legacyInsights tracking removed - using final canonical engine only
    // 4) Store harness result - compute engineInsights once
    const engineInsights = nextInsights || []
    
    // 5) Compute finalInsights based on all conditions (pure computation, no side effects)
    let finalInsights: PerformanceInsight[] = engineInsights
    
    const beforeCount = engineInsights.length;
    
    // Apply DEV-mode productivity skew override (if applicable)
    if (import.meta.env.DEV) {
      const hasProductivitySkew = engineInsights.some(i => 
        i.metricId === 'org.productivity_skew' || 
        i.title?.includes('concentrated in')
      )
      if (hasProductivitySkew) {
        // Use engine insights directly, bypass sticky logic
        finalInsights = engineInsights
        lastGoodInsights.value = engineInsights
      }
    }
    
    // Apply DEMO-mode sticky logic (if not already overridden by DEV path)
    if (DEMO_MODE && finalInsights === engineInsights) {
      if (hasNonFallback(engineInsights)) {
        // Good set with real AI impact → save and use
        lastGoodInsights.value = engineInsights
        finalInsights = engineInsights
      } else if (lastGoodInsights.value.length > 0) {
        // New set is only fallback → keep previous
        finalInsights = lastGoodInsights.value
      } else {
        // First ever run, and we only have fallback → use them
        finalInsights = engineInsights
      }
    }
    // Non-DEMO mode: finalInsights already equals engineInsights (no change needed)
    
    const afterCount = finalInsights.length;
    
    if (PI_DEBUG) console.warn('[PI_PIPELINE_CHECK][POST_PROCESS]', {
      before: beforeCount,
      after: afterCount,
      dropped: beforeCount - afterCount,
    });
    
    // =====================================
    // PHASE 3A: SIGNATURE CAPTURE (SAFE POINT B)
    // =====================================
    const signatureFinal = piSignature(finalInsights);
    const signatureFinalCount = finalInsights.length;
    
    // =====================================
    // STEP 1C: STALE RESPONSE PROTECTION
    // =====================================
    // Check if this response is stale (from an older request)
    const currentGlobalRequestId = (typeof window !== 'undefined') ? (window as any).__CM_CURRENT_REQUEST_ID : null;
    if (currentGlobalRequestId !== currentRequestId) {
      dashLog(`🚨 [refreshPI] Stale response detected - skipping ${currentRequestId}, current is ${currentGlobalRequestId}`);
      // Don't update insights with stale data
      return;
    }
    
    // 6) Single atomic assignment with new array reference for Vue reactivity
    insights.value = [...finalInsights];
    
    if (PI_DEBUG) console.warn('[PI_PIPELINE_CHECK][STATE_ASSIGN]', {
      assigningCount: Array.isArray(finalInsights) ? finalInsights.length : null,
      assigningIds: Array.isArray(finalInsights) ? finalInsights.map(i => i.id).slice(0, 25) : [],
    });
    
    if (PI_DEBUG) console.warn('[PI_PIPELINE_CHECK][STATE_AFTER_TICK]', {
      performanceInsightsCount: Array.isArray(insights.value) ? insights.value.length : null,
    });
    
    logRaceEvent('PI_INSIGHTS_ASSIGNED', { 
      requestId, 
      finalInsightsCount: finalInsights.length,
      engineInsightsCount: engineInsights.length,
      piRunId: piRunId.value,
      totalPipelineMs: Math.round(performance.now() - shadowStart)
    })

    // Phase 5: Confirm UI rendering - Log final insights by stage
    const planCodeIds = finalInsights.filter(i => i.cicdStage === 'plan-code').map(i => i.id);
    const reviewMergeIds = finalInsights.filter(i => i.cicdStage === 'review-merge').map(i => i.id);
    const deployOperateIds = finalInsights.filter(i => i.cicdStage === 'deploy-operate').map(i => i.id);
    
    dashLog('[PI_UI_RENDER]', { 
      planCodeIds, 
      reviewMergeIds, 
      deployOperateIds,
      totalCount: finalInsights.length,
      newPIsPresent: [
        'telemetry-session-quality-regression',
        'telemetry-ai-focus-imbalance', 
        'telemetry-remote-workspace-drag'
      ].filter(id => finalInsights.some(i => i.id === id))
    });

    const refreshPI = async () => {
      dashLog('[PI_PIPELINE_TRACE][REFRESH_PI_START] Starting PI refresh pipeline');
      dashLog('[PI_PIPELINE_TRACE][FEATURE_FLAGS]', {
        VITE_FINAL_PI_ENGINE_ENABLED: import.meta.env.VITE_FINAL_PI_ENGINE_ENABLED,
        VITE_PI_QA_DISABLED: import.meta.env.VITE_PI_QA_DISABLED,
        VITE_FEATURE_PERF_INSIGHTS: import.meta.env.VITE_FEATURE_PERF_INSIGHTS,
        VITE_PI_DEBUG: import.meta.env.VITE_PI_DEBUG
      });
      
      dashLog('🔥🔥🔥 [REFRESH_PI_START] refreshPI function started');
      dashLog('🔥🔥🔥 [PI_DEBUG_CHECK] PI_DEBUG value:', PI_DEBUG);
      dashLog('🔥🔥🔥 [EXECUTION_TRACE] About to enter final engine routing section');
      
      // Helper to determine why a PI has no data
      function determineGateReason(pi: PerformanceInsight, inputs: any): string {
        if (!pi.n || pi.n === 0) {
          if (inputs.sessionsTotal === 0) return 'NO_SESSIONS'
          if (pi.insufficientSignal) {
            // Check what type of PI this is to give specific reason
            if (pi.id?.includes('github') || pi.id?.includes('pr') || pi.id?.includes('deploy')) {
              return inputs.githubPRsTotal === 0 ? 'MISSING_GITHUB_SERIES' : 'INSUFFICIENT_SAMPLE'
            }
            if (pi.id?.includes('session') || pi.id?.includes('coding') || pi.id?.includes('ai')) {
              if (inputs.sessionsWithCommits === 0) return 'NO_MATCHING_FIELDS'
              if (inputs.sessionsWithActiveCodingMinutes === 0) return 'NO_MATCHING_FIELDS'
              if (inputs.sessionsWithAiAccepted === 0) return 'NO_MATCHING_FIELDS'
              return 'INSUFFICIENT_SAMPLE'
            }
            return 'INSUFFICIENT_SAMPLE'
          }
          return 'OTHER'
        }
        return 'DATA_PRESENT'
      }
      
      const proofReport = {
        byId: {} as Record<string, any>,
        summary: {
          totalPis: finalInsights.length,
          withRealData: 0,
          withInsufficientData: 0,
          gateReasons: {} as Record<string, number>
        }
      }
      
      // Time range used for all PIs
      const timeRangeUsed = {
        start: filterStore.dateRange?.[0] || 'unknown',
        end: filterStore.dateRange?.[1] || 'unknown'
      }
      
      // Input counts (what we actually have)
      const inputsSeen = {
        sessionsTotal: sessionData?.length || 0,
        sessionsWithCommits: sessionData?.filter(s => (s as any).chars_added_total && (s as any).chars_added_total > 0).length || 0,
        sessionsWithActiveCodingMinutes: sessionData?.filter(s => (s as any).active_coding_duration_ms && (s as any).active_coding_duration_ms > 0).length || 0,
        sessionsWithAiAccepted: sessionData?.filter(s => (s as any).ai_burst_count && (s as any).ai_burst_count > 0).length || 0,
        githubPRsTotal: ghSeries.value?.reduce((sum, g) => sum + (g.pullRequests || 0), 0) || 0,
        githubMergedPRs: ghSeries.value?.reduce((sum, g) => sum + (g.mergedPRs || 0), 0) || 0,
        deploysTotal: ghSeries.value?.reduce((sum, g) => sum + (g.deployments || 0), 0) || 0
      }
      
      // DEBUG: Check session data structure
      if (sessionData && sessionData.length > 0) {
        dashLog('DEBUG_SESSION_STRUCTURE:', {
          firstSessionKeys: Object.keys(sessionData[0] || {}),
          firstSessionSample: sessionData[0],
          sessionsWithCommitsCount: sessionData.filter(s => (s as any).chars_added_total && (s as any).chars_added_total > 0).length,
          sessionsWithActiveMinutesCount: sessionData.filter(s => (s as any).active_coding_duration_ms && (s as any).active_coding_duration_ms > 0).length,
          sessionsWithAiAcceptancesCount: sessionData.filter(s => (s as any).ai_burst_count && (s as any).ai_burst_count > 0).length
        })
      }
      
      finalInsights.forEach(pi => {
        const hasRealData = pi.n && pi.n > 0 && !pi.insufficientSignal
        const gateReason = determineGateReason(pi, inputsSeen)
        
        // DEBUG: Log first PI structure to understand the issue
        if (pi.id === 'commits-per-session-by-ide') {
          dashLog('DEBUG_SAMPLE_PI:', {
            piId: pi.id,
            n: pi.n,
            insufficientSignal: pi.insufficientSignal,
            coveragePct: pi.coveragePct,
            details: pi.details,
            rightMetric: pi.rightMetric
          })
        }
        
        proofReport.byId[pi.id] = {
          piId: pi.id,
          title: pi.title?.substring(0, 60),
          stage: pi.cicdStage || 'unknown',
          timeRangeUsed,
          inputsSeen,
          gateResult: {
            gatePassed: hasRealData,
            gateReason
          },
          computedRaw: hasRealData ? { n: pi.n, coveragePct: pi.coveragePct } : null,
          displayValue: hasRealData ? pi.rightMetric : (pi.details || 'Insufficient data')
        }
        
        // Update summary
        if (hasRealData) {
          proofReport.summary.withRealData++
        } else {
          proofReport.summary.withInsufficientData++
        }
        proofReport.summary.gateReasons[gateReason] = (proofReport.summary.gateReasons[gateReason] || 0) + 1
      })
      
      dashLog('PI_VALUE_PROOF_REPORT:', proofReport)
      
      dashLog('[PI_PIPELINE_TRACE][REFRESH_PI_COMPLETE]', {
        totalInsights: insights.value.length,
        finalEngineEnabled: import.meta.env.VITE_FINAL_PI_ENGINE_ENABLED === 'true'
      })
    }

    // PROMPT 3: Log counts after refreshPI completes (guarded by VITE_PI_DEBUG)
    if (PI_DEBUG) {
      const v2PreviewCount = (() => {
        try {
          const w = window as any
          const v2 = w?.__CM_PI_V2__
          if (!v2 || !v2.enabled) return 0
          return Number(v2?.debug?.previewRowsCount ?? 0)
        } catch {
          return 0
        }
      })()
      
      dashLog('[PI_DEBUG][REFRESHPI_COMPLETE]', {
        insightsCount: insights.value.length,
        v2PreviewCount: v2PreviewCount,
        viewMode: v2ShadowEnabled.value ? 'strip-v2' : 'strip',
        toolScope: (() => {
          try {
            return String(window.localStorage?.getItem('cm_v2_tool_scope') ?? 'all')
          } catch {
            return 'all'
          }
        })(),
        fromISO: filterStore?.filters?.engineering?.dateRange?.from || 'not set',
        toISO: filterStore?.filters?.engineering?.dateRange?.to || 'not set'
      })
    }

    if (PI_DEBUG && !didLogEngineVsAssigned) {
      didLogEngineVsAssigned = true
      const engineEmittedIds = (engineInsights || []).map(i => i.id).filter(Boolean)
      const assignedIds = (insights.value || []).map(i => i.id).filter(Boolean)

      const engineSet = new Set(engineEmittedIds)
      const assignedSet = new Set(assignedIds)

      const missingFromAssigned = engineEmittedIds.filter(id => !assignedSet.has(id))
      const addedInAssigned = assignedIds.filter(id => !engineSet.has(id))

      const dupIds = assignedIds.filter(id => id.includes('::dup'))
      const hasDup2 = dupIds.some(id => id.includes('::dup2'))

      dashLog('[PI_AUDIT][ENGINE_VS_ASSIGNED]', {
        engineEmittedIds,
        assignedIds,
        missingFromAssigned,
        addedInAssigned,
        hasDup2,
        dupIds,
      })
    }

    if (PI_DEBUG && !didLogInsightsAssigned) {
      didLogInsightsAssigned = true
      const ids = (insights.value || []).map(i => i.id).filter(Boolean)
      dashLog('[PI_DEBUG][INSIGHTS_ASSIGNED]', {
        len: (insights.value || []).length,
        first5Ids: ids.slice(0, 5),
      })
    }
    
    // ========== PI_TRACE: Dashboards state assignment boundary ==========
    const PI_TRACE = ['1', 'true'].includes(
      ((import.meta as any).env?.VITE_PI_TRACE ?? 'false')
    );
    
    if (PI_TRACE) {
      console.group('🔍 [PI_TRACE][DASHBOARDS_ASSIGNED] Insights assigned to state');
      
      // Build detailed table (same format as engine)
      const traceTable = insights.value.map(i => ({
        id: i.id,
        title: i.title?.slice(0, 60) || 'NO_TITLE',
        cicdStage: i.cicdStage || 'missing',
        orgKind: i.orgKind || 'none',
        insightClass: i.insightClass || 'none',
        metricId: i.metricId || 'none',
        tool: i.related?.tools?.[0] || i.tools?.[0] || 'org',
        severity: i.severity || 'info',
        priorityScore: i.priorityScore || 0,
        tags: i.tags?.join(',') || 'none',
        source: i.source || 'unknown',
        hidden: (i as any).hidden || false,
        uiHidden: (i as any).uiHidden || false,
        locked: (i as any).locked || false
      }));
      
      console.table(traceTable);
      
      // Counts by stage
      const byStage: Record<string, number> = {};
      insights.value.forEach(i => {
        const stage = i.cicdStage || 'missing';
        byStage[stage] = (byStage[stage] || 0) + 1;
      });
      dashLog('Counts by stage:', byStage);
      
      // Counts by orgKind
      const byOrgKind: Record<string, number> = {};
      insights.value.forEach(i => {
        const kind = i.orgKind || 'none';
        byOrgKind[kind] = (byOrgKind[kind] || 0) + 1;
      });
      dashLog('Counts by orgKind:', byOrgKind);
      
      // Counts by stage + orgKind
      const byStageType: Record<string, number> = {};
      insights.value.forEach(i => {
        const stage = i.cicdStage || 'missing';
        const kind = i.orgKind || 'none';
        const key = `${stage}|${kind}`;
        byStageType[key] = (byStageType[key] || 0) + 1;
      });
      dashLog('Counts by stage|orgKind:', byStageType);
      
      // List all IDs for verification
      dashLog('All insight IDs:', insights.value.map(i => i.id));
      
      console.groupEnd();
    }
    
    // TEMP: Log insights by stage after assignment
    if (PI_DEBUG) console.debug('[PI][Dashboards] performanceInsights by stage:', {
      total: insights.value.length,
      reviewMerge: insights.value
        .filter(i => i.cicdStage === 'review-merge')
        .map(i => i.title),
      planCode: insights.value
        .filter(i => i.cicdStage === 'plan-code')
        .map(i => i.title),
      deployOperate: insights.value
        .filter(i => i.cicdStage === 'deploy-operate')
        .map(i => i.title),
    });

    // TEMP: Log full Review & Merge objects
    if (PI_DEBUG) console.debug('[PI][Dashboards] review-merge raw objects:',
      insights.value.filter(i => i.cicdStage === 'review-merge')
    );
    
    // TEMP: Log change failure rate insights before passing to widget
    const cfrInsights = insights.value.filter(i => i.id && i.id.includes('change-failure-rate'));
    cfrInsights.forEach(insight => {
      dashLog('[DASHBOARDS_TO_WIDGET] change-failure-rate insight ->', {
        id: insight.id,
        title: insight.title,
        rightMetric: insight.rightMetric
      });
    });
    
    // Output structured pipeline timing log (DEV only, one block per refresh)
    if (PI_PIPELINE_DEBUG) {
      // Get shadow timings from window if available
      const shadowTimings = (window as any).__CM_PI_V2_PIPELINE_TIMINGS__ || {};
      const timingLog = {
        fetch: {
          github: pipelineTimings.github || 0,
          telemetry: pipelineTimings.telemetry || 0,
          sessions: pipelineTimings.sessions || 0,
        },
        shadow: {
          total: pipelineTimings.shadowTotal || shadowTimings.total || 0,
          normalize: shadowTimings.normalize || 0,
          primitives: shadowTimings.primitives || 0,
          compute: shadowTimings.compute || 0,
          publish: shadowTimings.publish || 0,
        },
        widget: {
          map: shadowTimings.widgetMap || 0,
        },
        dataReadyToShadow: pipelineTimings.dataReadyToShadow || 0,
      };
      dashLog('[PI PIPELINE]', timingLog);
      // Also output as compact single-line format
      dashLog(`[PI PIPELINE] fetch github=${timingLog.fetch.github}ms telemetry=${timingLog.fetch.telemetry}ms sessions=${timingLog.fetch.sessions}ms shadowTotal=${timingLog.shadow.total}ms normalize=${timingLog.shadow.normalize}ms primitives=${timingLog.shadow.primitives}ms compute=${timingLog.shadow.compute}ms publish=${timingLog.shadow.publish}ms widgetMap=${timingLog.widget.map}ms`);
    }
    
    // TTFC_DEBUG: Log TTFC-specific diagnostics
    if (TTFC_DEBUG) {
      const ttfcInsights = insights.value.filter(i => i.metricId === 'org.time_to_first_commit')
      console.warn('[TTFC_DEBUG][Dashboards] refreshPI complete', {
        totalInsights: insights.value.length,
        ttfcInsightsCount: ttfcInsights.length,
        ttfcInsights: ttfcInsights.map(i => ({
          id: i.id,
          title: i.title,
          severity: i.severity,
          cicdStage: i.cicdStage
        })),
        sessionDataUsed: sessionData.length,
        allMetricIds: [...new Set(insights.value.map(i => i.metricId))].slice(0, 15)
      })
    }
    
    // =====================================
    // PHASE 3A: SAFE PI BREAKDOWN SUMMARY (DEV-ONLY)
    // =====================================
    if (import.meta.env.DEV) {
      const piBreakdownTotalMs = Math.round(performance.now() - piBreakdownStart);
      flushStageTimings(piBreakdownTotalMs);
      const sessionsLength = sessionData?.length || 0;
      const githubPoints = ghSeries.value?.length || 0;
      
      // Signature verification - check if instrumentation changed output
      const signaturesMatch = signatureRaw === signatureFinal;
      const signatureChanged = !signaturesMatch && signatureRaw && signatureFinal;
      
      // Only show debug if NOT in safe mode
      if (String(piRunId.value) !== 'PI_BREAKDOWN_SAFE') {
        dashLog('[CM_PERF] === PI BREAKDOWN SAFE ===', piRunId.value);
        dashLog('[CM_PERF] Total compute time:', piBreakdownTotalMs, 'ms');
        dashLog('[CM_PERF] Sessions length:', sessionsLength);
        dashLog('[CM_PERF] GitHub points:', githubPoints);
      }
      dashLog('[CM_PERF] Signature A count:', signatureRawCount);
      dashLog('[CM_PERF] Signature B count:', signatureFinalCount);
      
      if (signatureChanged) {
        dashLog('[CM_PERF][RED] PI OUTPUT CHANGED — DISABLING PERF SUMMARY');
        dashLog('[CM_PERF][RED] Signature A:', signatureRaw);
        dashLog('[CM_PERF][RED] Signature B:', signatureFinal);
      } else {
        dashLog('[CM_PERF] ✅ Signatures match - instrumentation safe');
      }
    }
    
    // =====================================
    // PHASE 0: refreshPI() SUCCESS MARKER
    // =====================================
    cmMark(traceId, "END", {
      ms: Math.round(performance.now() - t0)
    });
    
  } catch (e) {
    // =====================================
    // PHASE 0: refreshPI() ERROR MARKER
    // =====================================
    cmMark(traceId, "ERROR", {
      ms: Math.round(performance.now() - t0),
      error: String(e)
    });
    
    console.error('[PI_PAGE_PARENT] refreshPI error', e)
    dashLog("🚨 [DEBUG] Caught error - execution stopped here:", e.message || e);

    if (PI_DEBUG && !didLogExitException) {
      didLogExitException = true
      dashLog('[PI_DEBUG][REFRESHPI_EXIT]', {
        reason: 'exception',
        currentInsightsLen: insights.value.length,
      })
    }

    // On error, only clear if we haven't assigned anything yet (preserve existing insights if assignment succeeded)
    // This ensures errors during post-assignment code don't wipe out valid insights
    if (insights.value.length === 0) {
      insights.value = []
    }
  } finally {
    isRefreshingPI.value = false
    // Phase 2B: Clear in-flight lock
    piInFlight.value = false
    // Note: piRunId is incremented at the start of refreshPI (before try block)
    // This ensures it increments even if the refresh fails or returns early
    
    // 🎯 PERFORMANCE: End timing and measure
    mark(`${piRequestId}_end`)
    measure(`pi_compute_${piRequestId}`, `${piRequestId}_start`, `${piRequestId}_end`)

    // CR5 WS1.4 P0: Cold-path total timing
    if (import.meta.env.DEV) {
      dashLog('[CR5_WS1.4][COLD_PATH] TOTAL refreshPI:', Math.round(performance.now() - _coldPathStart), 'ms');
    }

    // CR1: Execute exactly one queued rerun if pending.
    // The GitHub fingerprint in buildPIInputKey ensures the rerun won't be
    // suppressed by the same-key guard when fresh GitHub data arrived.
    // CR5 WS1 P0 FIX: Skip the queued rerun if the PI input key hasn't
    // actually changed. On Local (no real GitHub data), the fingerprint
    // is 'no-gh' both times — the rerun would produce identical results
    // and waste ~5s of harness compute. The same-key guard's 750ms window
    // expires during the first ~5s compute, so we check here explicitly.
    if (pendingRerun) {
      const queued = pendingRerun
      pendingRerun = null // Clear before scheduling to prevent infinite loop
      const currentKey = buildPIInputKey()
      if (currentKey === lastPIKey) {
        dashLog('[CR1][QUEUED_RERUN] Skipping rerun — PI input key unchanged:', queued.reason, currentKey)
        count('refresh_pi_skipped_same_key')
      } else {
        dashLog('[CR1][QUEUED_RERUN] Executing queued PI rerun for:', queued.reason, 'key changed:', lastPIKey, '→', currentKey)
        // Use setTimeout(0) to let Vue reactivity settle before rerunning
        setTimeout(() => {
          scheduleRefreshPI(`queued:${queued.reason}`)
        }, 0)
      }
    }

    // CR-X Phase 3 PERF: Prefetch PBT API data after first PI completes.
    // PBT JS chunk is preloaded on mount (does not compete with PHP).
    // API data prefetch fires here after PI is done so it doesn't
    // compete with PI for PHP workers. Browser HTTP cache will serve
    // PBT's onMounted fetches.
    if (!pbtApiPrefetched && insights.value.length > 0) {
      pbtApiPrefetched = true
      const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || ''
      ;[
        'api/developers',
        'api/telemetry/repos',
        'api/delivery/timeseries',
      ].forEach((path) => {
        authenticatedFetch(`${apiBase}/${path}`).catch(() => {})
      })
    }
  }
}

// Track if initial mount has completed to prevent watch from firing on filter initialization
const isInitialMount = ref(true)

// Debounced wrapper to prevent rapid-fire calls during filter initialization
let refreshPITimeout: any = null
const debouncedRefreshPI = (skipIfInitial = false, delayMs = 500) => {
  if (PI_DEBUG && !didLogCallsiteDebounced) {
    didLogCallsiteDebounced = true
    dashLog('[PI_DEBUG][REFRESHPI_CALLSITE]', {
      callsite: 'debouncedRefreshPI',
      reason: `schedule refreshPI via setTimeout(${delayMs}ms)`,
      preconditions: {
        skipIfInitial,
        isInitialMount: isInitialMount.value,
        hasExistingTimeout: !!refreshPITimeout,
        featureOn,
        VITE_FEATURE_PERF_INSIGHTS: import.meta.env.VITE_FEATURE_PERF_INSIGHTS,
      },
    })
  }

  dashLog('🚨🚨🚨 [DEBOUNCED_REFRESHPI] Starting function 🚨🚨🚨');
  dashLog('🚨🚨🚨 [DEBOUNCED_REFRESHPI] skipIfInitial:', skipIfInitial);
  dashLog('🚨🚨🚨 [DEBOUNCED_REFRESHPI] isInitialMount.value:', isInitialMount.value);
  dashLog('🚨🚨🚨 [DEBOUNCED_REFRESHPI] refreshPITimeout:', refreshPITimeout);

  if (skipIfInitial && isInitialMount.value && refreshPITimeout) {
    dashLog('🚨🚨🚨 [DEBOUNCED_REFRESHPI] Returning early due to skipIfInitial condition 🚨🚨🚨');
    return
  }
  
  if (refreshPITimeout) clearTimeout(refreshPITimeout)
  dashLog('🚨🚨🚨 [DEBOUNCED_REFRESHPI] About to set setTimeout 🚨🚨🚨');
  dashLog('🚨🚨🚨 [DEBOUNCED_REFRESHPI] delayMs:', delayMs);
  refreshPITimeout = setTimeout(() => {
    dashLog('🚨🚨🚨 [DEBOUNCED_REFRESHPI] setTimeout callback executed 🚨🚨🚨');
    dashLog('🚨🚨🚨 [DEBOUNCED_REFRESHPI] About to call refreshPI() 🚨🚨🚨');
    refreshPI()
    dashLog('🚨🚨🚨 [DEBOUNCED_REFRESHPI] refreshPI() called 🚨🚨🚨');
  }, delayMs)
  dashLog('🚨🚨🚨 [DEBOUNCED_REFRESHPI] setTimeout scheduled 🚨🚨🚨');
}

// AI Impact Summary computed properties
const aiInsights = computed(() => {
  const list = insights.value || []
  return list.filter((i) => {
    const tags = i.tags || []
    const metricId = i.metricId || ''
    return (
      tags.includes('ai-impact') ||
      tags.includes('ai-usage') ||
      tags.includes('ai') ||
      metricId.includes('ai') ||
      metricId.includes('AI')
    )
  })
})

// Tool label mapping
const toolLabels: Record<string, string> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  windsurf: 'Devin',
  jetbrains: 'JetBrains',
  sublime: 'Sublime Text',
  vim: 'Vim',
}

// Helper to format tool list
const formatToolList = (toolIds: string[]): string => {
  const unique = Array.from(new Set(toolIds.filter(Boolean)))
  return unique
    .map((id) => toolLabels[id.toLowerCase()] || getToolLabel(id))
    .join(', ')
}

// IDE AI usage summary from productivity data
type AiIdeSummary = {
  highUsage: string[];       // tools with highest total AI assists
  highEfficiency: string[];  // tools with highest assists per minute
  lowEfficiency: string[];   // tools with lowest assists per minute
}

const aiIdeSummary = computed<AiIdeSummary | null>(() => {
  const points = prodSeries.value || []
  if (!points.length) return null

  // Aggregate per-tool stats
  const perTool: Record<string, { ai: number; minutes: number; points: number }> = {}

  for (const p of points) {
    if (!p.tool) continue
    if (p.aiAssists == null || p.codingMinutes == null) continue
    if (p.codingMinutes <= 0) continue

    if (!perTool[p.tool]) {
      perTool[p.tool] = { ai: 0, minutes: 0, points: 0 }
    }
    perTool[p.tool].ai += p.aiAssists
    perTool[p.tool].minutes += p.codingMinutes
    perTool[p.tool].points += 1
  }

  const entries = Object.entries(perTool)
    // require at least a minimal signal so tiny/noisy tools don't show up
    .filter(([_, s]) => s.points >= 1 && s.minutes > 0)

  if (!entries.length) return null

  const withRatios = entries.map(([tool, s]) => ({
    tool,
    ai: s.ai,
    minutes: s.minutes,
    aiPerMinute: s.ai / s.minutes,
  }))

  // sort helpers (don't mutate original)
  const byUsageDesc = [...withRatios].sort((a, b) => b.ai - a.ai)
  const byEffDesc = [...withRatios].sort((a, b) => b.aiPerMinute - a.aiPerMinute)
  const byEffAsc = [...withRatios].sort((a, b) => a.aiPerMinute - b.aiPerMinute)

  const takeTop = (arr: typeof withRatios, n = 2) =>
    arr.slice(0, n).map((x) => x.tool)

  const takeBottom = (arr: typeof withRatios, n = 2) =>
    arr.slice(0, n).map((x) => x.tool)

  const highUsage = takeTop(byUsageDesc)
  const highEfficiency = takeTop(byEffDesc)

  // initial low efficiency candidates (bottom of assists/min)
  const lowCandidates = takeBottom(byEffAsc)

  // remove any tools already in highUsage or highEfficiency
  const highSet = new Set([...highUsage, ...highEfficiency])
  const lowEfficiency = lowCandidates.filter((t) => !highSet.has(t))

  // if nothing remains or every tool is effectively "high", drop lowEfficiency
  if (!lowEfficiency.length || lowEfficiency.length === withRatios.length) {
    return {
      highUsage,
      highEfficiency,
      lowEfficiency: [],
    }
  }

  return {
    highUsage,
    highEfficiency,
    lowEfficiency,
  }
})

// IDE-centric AI Impact Narrative
type AiImpactNarrative = {
  cycleImpact?: string;             // e.g. "~95% slower"
  cycleTools: string[];             // ['vscode']
  reopenImpact?: string;            // e.g. "4.2% → 7.3%"
  reopenTools: string[];            // ['vscode', 'cursor']
  neutralCycleTools: string[];      // tools with data but no cycle-time impact
  neutralReopenTools: string[];    // tools with data but no reopen-rate impact
  positiveTools: string[];          // tools with positive AI signals
  riskTools: string[];              // tools with negative AI signals
  orgHighAiTools: string[];         // org-level high-AI tools (from aiIdeSummary.highUsage)
}

const aiImpactNarrative = computed<AiImpactNarrative | null>(() => {
  const items = aiInsights.value || []
  if (!items.length) return null

  const hasTag = (i: PerformanceInsight, t: string) => (i.tags || []).includes(t)

  // Group insights by theme
  const cycle = items.filter((i) => hasTag(i, 'cycle-time'))
  const reopen = items.filter((i) => hasTag(i, 'reopen-rate') || hasTag(i, 'quality'))

  // Extract impact strings from evidence
  const extractImpact = (ins: PerformanceInsight[], labelMatch: (label: string) => boolean): string | undefined => {
    for (const i of ins) {
      const ev = (i.evidence || []).find((e) => labelMatch(e.label || ''))
      if (ev && ev.value != null) return String(ev.value)
    }
    return undefined
  }

  // Extract reopen range and format with arrow
  const reopenRaw = extractImpact(reopen, (l) => l.toLowerCase().includes('reopen range') || l.toLowerCase().includes('reopen'))
  let reopenImpact: string | undefined = reopenRaw
  if (reopenRaw && reopenRaw.includes('-')) {
    const [from, to] = reopenRaw.split('-').map((s) => s.trim())
    if (from && to) reopenImpact = `${from} → ${to}`
  }

  // Extract cycle impact
  const cycleImpact = extractImpact(cycle, (l) => l.toLowerCase().includes('est. impact') || l.toLowerCase().includes('impact'))

  // Collect tools from cycle-time insights
  const cycleTools = Array.from(
    new Set(
      cycle
        .filter(i => i.tools && i.tools.length > 0)
        .flatMap(i => i.tools || [])
    )
  )

  // Collect tools from reopen/quality insights
  const reopenTools = Array.from(
    new Set(
      reopen
        .filter(i => i.tools && i.tools.length > 0)
        .flatMap(i => i.tools || [])
    )
  )

  // Derive neutral tools (tools with productivity data but no cycle/reopen insights)
  const allTools = Array.from(
    new Set(
      (prodSeries.value || [])
        .map((p) => p.tool)
        .filter(Boolean) as string[]
    )
  )

  const neutralCycleTools = allTools.filter(
    (t) => !cycleTools.includes(t)
  )

  const neutralReopenTools = allTools.filter(
    (t) => !reopenTools.includes(t)
  )

  // Tool-level insights relevant for AI / productivity comparison
  // Use broader set from all insights, not just AI-impact subset
  const toolInsights = (insights.value || []).filter(i => {
    // Must be tool-scoped
    if (i.toolScope !== 'single-ide' && i.toolScope !== 'cross-ide') return false
    if (!i.tools || i.tools.length === 0) return false

    const tags = i.tags || []
    const hasAiTag = tags.some(tag =>
      ['ai', 'ai-impact', 'ai-usage', 'coverage', 'productivity'].includes(tag)
    )

    const aiMetric =
      (i.metricId && i.metricId.toLowerCase().includes('ai')) ||
      (i.metricId && i.metricId.toLowerCase().includes('productivity'))

    return hasAiTag || aiMetric
  })

  // Collect positive tools from broader tool insights set
  const positiveTools = Array.from(
    new Set(
      toolInsights
        .filter(i => ['opportunity', 'highlight'].includes(i.severity))
        .flatMap(i => i.tools || [])
    )
  )

  // Collect risk tools from broader tool insights set
  const riskTools = Array.from(
    new Set(
      toolInsights
        .filter(i => ['risk', 'lowlight', 'warning'].includes(i.severity))
        .flatMap(i => i.tools || [])
    )
  )

  // Collect tools implicated directly in AI-impact insights
  const impactTools = Array.from(
    new Set([...cycleTools, ...reopenTools].filter(Boolean))
  )

  // Collect tools with highest AI usage from productivity data
  const highUsageTools =
    aiIdeSummary.value?.highUsage && aiIdeSummary.value.highUsage.length
      ? aiIdeSummary.value.highUsage
      : []

  // Merge: impact tools first (ensures VS Code shows up), then high usage tools
  let orgHighAiTools = Array.from(
    new Set([...impactTools, ...highUsageTools].filter(Boolean))
  )

  // Cap list to 3 tools for readability
  if (orgHighAiTools.length > 3) {
    orgHighAiTools = orgHighAiTools.slice(0, 3)
  }

  return {
    cycleImpact,
    cycleTools,
    reopenImpact,
    reopenTools,
    neutralCycleTools,
    neutralReopenTools,
    positiveTools,
    riskTools,
    orgHighAiTools,
  }
})

// 🔥 FIX: REMOVED DUPLICATE onMounted block that was causing race conditions
// All initialization logic has been MERGED into the canonical onMounted at line ~294
// This elimination prevents: (1) double GitHub fetch, (2) double PI refresh, (3) race conditions

// DISABLED: Watch for GitHub metrics to be populated, then trigger PI computation
// This was causing infinite refresh loops
// watch(
//   () => githubMetrics.value,
//   (newValue) => {
//     // Only trigger refreshPI if we're not already refreshing and we have no insights yet
//     if (newValue && Object.keys(newValue).length > 0 && insights.value.length === 0 && !isRefreshingPI.value) {
//       dashLog('[PI_DEBUG][GITHUB_STORE_POPULATED] GitHub metrics now populated, triggering PI computation');
//       refreshPI();
//     }
//   },
//   { immediate: false }
// )

// 🔥 CYCLE GUARD: Conservative store-to-local sync watcher
// Only sync if local ref is empty AND store has meaningful data
// 🔥 REMOVED: No longer needed since githubMetrics is now a computed property
// The computed property automatically tracks githubStore.rawResponse,

// Watch only specific filter values (not entire objects) to reduce false triggers
const filterWatcher = watch(
  () => [
    granularity.value,
    filterStore?.filters?.engineering?.dateRange?.from,
    filterStore?.filters?.engineering?.dateRange?.to,
    // Only watch specific productivity filter properties, not entire object
    filterStore?.filters?.productivity?.toolIds?.join(','),
    filterStore?.filters?.engineering?.teamIds?.join(','),
    filterStore?.filters?.engineering?.developerIds?.join(',')
  ],
  (newVals, oldVals) => {
    // Skip if component is unmounting
    if (!isInitialMount.value && !filterStore) {
      return
    }
    
    // Skip if still in initial mount phase
    if (isInitialMount.value) {
      if (isDebugEnabled('DASH')) {
        if (PI_DEBUG) console.warn('[DASH_PI] Watch triggered during initial mount - skipping')
      }
      return
    }
    
    // Skip if oldVals is undefined (first watch fire on setup)
    if (JSON.stringify(newVals) !== JSON.stringify(oldVals)) {
      if (PI_DEBUG && !didLogCallsiteWatch) {
        didLogCallsiteWatch = true
        dashLog('[PI_DEBUG][REFRESHPI_CALLSITE]', {
          callsite: 'watch:filters',
          reason: 'filter values changed → schedule refreshPI',
          preconditions: {
            isInitialMount: isInitialMount.value,
            newVals,
            oldVals,
            featureOn,
            VITE_FEATURE_PERF_INSIGHTS: import.meta.env.VITE_FEATURE_PERF_INSIGHTS,
          },
        })
      }

      if (isDebugEnabled('DASH')) {
        if (PI_DEBUG) console.warn('[DASH_PI] watch triggered - filter values changed, scheduling refreshPI', {
          newVals,
          oldVals,
          currentInsightsCount: insights.value.length
        })
      }
      // CR-X P0: Filter changes from the active PBT surface must not hydrate
      // the inactive PI/AIOI surfaces. The guard lives in scheduleRefreshPI
      // for a single source of truth.
      scheduleRefreshPI('filter-change')
    } else {
      if (isDebugEnabled('DASH')) {
        if (PI_DEBUG) console.warn('[DASH_PI] Watch fired but values unchanged - skipping')
      }
    }
  },
  { deep: false, immediate: false } // Don't fire on initial setup
)

// CR-X Track A: Watch analysis context changes → trigger PI refresh
// This ensures PI/PBT recompute when user changes time range, developer, repo, or workflow
watch(
  () => ({
    timePreset: analysisContext.timePreset,
    from: analysisContext.dateRange.from,
    to: analysisContext.dateRange.to,
    granularity: analysisContext.granularity,
    developerIds: [...analysisContext.developerIds],
    repoIds: [...analysisContext.repoIds],
    workflowIds: [...analysisContext.workflowIds],
    cohortId: analysisContext.cohortId,
  }),
  (newVals, oldVals) => {
    if (JSON.stringify(newVals) !== JSON.stringify(oldVals)) {
      dashLog('[DASH_PI] analysis context changed, scheduling refreshPI', { newVals })
      scheduleRefreshPI('analysis-context-change')
    }
  },
  { deep: true, immediate: false }
)

// CR-X 3D.4: Watch githubStore.rawResponse evidence fingerprint → trigger
// PI refresh when fresh GitHub data arrives. This is a safety net that
// ensures PI recomputes whenever the store's rawResponse changes (e.g.,
// when the on-mount fetchMetrics completes and overwrites the stale LKG
// hydration). Without this, PI could remain on the stale LKG population
// if the scheduleRefreshPI('github-fetch-complete') callback is skipped
// by the same-key guard or if the fetch is throttled.
watch(
  () => buildGithubEvidenceFingerprint(),
  (newFp, oldFp) => {
    // CR-X Phase 3 PERF: Skip during initial mount to prevent duplicate
    // refreshPI. The first refreshPI already fetches GitHub data, which
    // changes the fingerprint and triggers this watch. Without this guard,
    // a second refresh is queued behind the first, wasting ~800ms of
    // duplicate work (sessions fetch, telemetry fetch, PI engine).
    if (isInitialMount.value) return
    if (newFp !== oldFp && newFp !== 'no-gh') {
      dashLog('[CR-X_3D.4] GitHub evidence fingerprint changed, scheduling refreshPI', { oldFp, newFp })
      scheduleRefreshPI('github-evidence-fingerprint-change')
    }
  },
  { immediate: false }
)

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const prefs = usePreferencesStore?.()
prefs?.loadFromStorage?.()

// Pilot API base URL for banner links (origin only, no /api, no :8010 in production).
// Mirrors the canonical resolution in config/api.js: prefer VITE_API_BASE_URL,
// then fall back to window.location.origin. Never hardcodes a backend port.
const pilotApiBase = computed(() => {
  const base = import.meta.env.VITE_API_BASE_URL
  if (base) {
    return base.replace(/\/$/, '').replace(/\/api$/, '')
  }
  // No build-time API base: use the current origin (same as config/api.js).
  // In production this is the public HTTPS origin (e.g. https://host.example).
  // In local dev the Vite proxy routes /api to the backend transparently,
  // so the frontend origin is the correct surface to show.
  return window.location.origin
})

const cursorAgentInstallCommand = computed(() =>
  `CM_API_BASE_URL="${pilotApiBase.value}" CM_CONNECT_CODE="<your enrollment code>" node package/install.js`
)

const companionCmdCopied = ref(false)
async function copyCompanionInstallCommand() {
  const text = cursorAgentInstallCommand.value
  let ok = false
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      ok = true
    }
  } catch {
    ok = false
  }
  if (!ok) {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      ok = document.execCommand('copy')
      document.body.removeChild(ta)
    } catch {
      ok = false
    }
  }
  if (ok) {
    companionCmdCopied.value = true
    setTimeout(() => { companionCmdCopied.value = false }, 2000)
  }
}

// Styling helper functions for insights display
function getSeverityBadgeClass(insight: PerformanceInsight | any) {
  const severity = String((insight as any).severity || (insight as any).normalizedSeverity || 'info').toLowerCase()
  const severityMap: Record<string, string> = {
    'critical': 'bg-danger text-white',
    'risk': 'bg-danger text-white',
    'warning': 'bg-warning text-dark',
    'info': 'bg-info text-white',
    'opportunity': 'bg-success text-white',
    'highlight': 'bg-primary text-white'
  }
  return severityMap[severity] || 'bg-secondary text-white'
}

function getInsightIcon(insight: PerformanceInsight | any) {
  const severity = String((insight as any).severity || (insight as any).normalizedSeverity || 'info').toLowerCase()
  const iconMap: Record<string, string> = {
    'critical': 'bi-exclamation-triangle-fill',
    'risk': 'bi-exclamation-circle-fill',
    'warning': 'bi-exclamation-diamond-fill',
    'info': 'bi-info-circle-fill',
    'opportunity': 'bi-arrow-up-circle-fill',
    'highlight': 'bi-star-fill'
  }
  return iconMap[severity] || 'bi-lightbulb-fill'
}

function getInsightBorderClass(insight: PerformanceInsight | any) {
  const severity = String((insight as any).severity || (insight as any).normalizedSeverity || 'info').toLowerCase()
  return `insight-${severity}`
}

function getSeverityColor(insight: PerformanceInsight | any) {
  const severity = String((insight as any).severity || (insight as any).normalizedSeverity || 'info').toLowerCase()
  const colorMap: Record<string, string> = {
    'critical': '#dc3545',
    'risk': '#dc3545',
    'warning': '#ffc107',
    'info': '#0dcaf0',
    'opportunity': '#198754',
    'highlight': '#0d6efd'
  }
  return colorMap[severity] || '#6c757d'
}

// Format time to merge properly - convert hours to appropriate units
const formatTimeToMerge = (hours: number | undefined | null): string => {
  if (!hours || hours === 0) return '--'
  
  if (hours < 1) {
    return `${Math.round(hours * 60)}m` // Show in minutes if less than 1 hour
  } else if (hours < 24) {
    return `${hours}h` // Show in hours if less than 1 day
  } else {
    const days = Math.round(hours / 24 * 10) / 10 // Round to 1 decimal place
    return `${days}d` // Show in days
  }
}

const logout = async () => {
  await authStore.logout()
  router.push('/login')
}

// P0-G Part F: Handle session expired — clear auth and redirect to login
const handleSessionExpired = async () => {
  await authStore.logout()
  router.push('/login')
}

const goBack = () => {
  router.push("/connect")
}

// AI Spend & ROI methods removed (CR-X closure): the SpendROI component and its
// mock refresh/seed wiring were removed from the active dashboard. The accepted
// unit-economics PIs remain the canonical cost surface.
</script>

<style scoped>
/* Pilot Health link — compact dashboard-level operator visibility */
.pilot-health-link {
  font-size: 0.75rem;
  color: #6b7280;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  transition: color 0.15s;
}
.pilot-health-link:hover {
  color: #3b82f6;
  text-decoration: underline;
}

/* Dashboard Container */
.dashboard-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
}

/* Pilot Setup — compact collapsible admin utility */
.pilot-setup-strip {
  background: #f0f4ff;
  border: 1px solid #c8d6f5;
  border-radius: 0.5rem;
  padding: 0.4rem 0.75rem;
}

/* Compact row-based setup list — one line per tool, actions right-aligned */
.pilot-setup-rows {
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid #d8e2f0;
  border-radius: 0.375rem;
  padding: 0 0.6rem;
}

.pilot-setup-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.35rem 0;
  flex-wrap: wrap;
}

.pilot-setup-row + .pilot-setup-row {
  border-top: 1px solid #e2e9f4;
}

.pilot-setup-row-icon {
  font-size: 0.85rem;
  color: #475569;
  flex: 0 0 auto;
}

.pilot-setup-row-text {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
  min-width: 0;
}

.pilot-setup-row-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
}

.pilot-setup-row-desc {
  font-size: 0.72rem;
  color: #64748b;
}

.pilot-setup-row-actions {
  margin-left: auto;
  display: flex;
  gap: 0.3rem;
  flex: 0 0 auto;
}

.pilot-setup-row-actions .btn {
  white-space: nowrap;
  padding: 0.15rem 0.55rem;
  font-size: 0.75rem;
}

/* Subordinate companion row — visually secondary, not a fourth product */
.pilot-setup-row-sub .pilot-setup-row-name {
  font-weight: 500;
  color: #334155;
}

.pilot-setup-row-sub .pilot-setup-row-icon {
  color: #94a3b8;
}

.pilot-setup-row-sub .btn {
  color: #475569;
  border-color: #cbd5e1;
}

.pilot-setup-modal {
  background: rgba(15, 23, 42, 0.45);
}

.pilot-setup-dialog {
  max-width: 520px;
}

.pilot-setup-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.18);
  overflow: hidden;
}

.pilot-setup-modal-header {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.85rem 1rem 0.7rem;
}

.pilot-setup-modal-icon {
  font-size: 1.05rem;
  color: #2563eb;
  margin-top: 0.15rem;
}

.pilot-setup-modal-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: #0f172a;
}

.pilot-setup-modal-subtitle {
  font-size: 0.75rem;
  color: #64748b;
}

.pilot-setup-close {
  margin-left: auto;
  background: none;
  border: 0;
  color: #64748b;
  font-size: 0.85rem;
  line-height: 1;
  padding: 0.35rem;
  border-radius: 0.375rem;
}

.pilot-setup-close:hover {
  background: #f1f5f9;
  color: #0f172a;
}

.pilot-setup-modal-body {
  padding: 0.35rem 1rem 0.5rem;
}

.pilot-setup-steps {
  list-style: none;
  margin: 0;
  padding: 0;
}

.pilot-setup-steps li {
  display: flex;
  gap: 0.65rem;
  padding: 0.45rem 0;
  align-items: flex-start;
}

.pilot-setup-steps li + li {
  border-top: 1px solid #f1f5f9;
}

.pilot-setup-steps .step-num {
  flex: 0 0 1.35rem;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 999px;
  background: #eff4ff;
  color: #2563eb;
  font-size: 0.72rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 0.05rem;
}

.pilot-setup-steps code {
  word-break: break-all;
}

.pilot-setup-steps .step-text {
  font-size: 0.83rem;
  color: #334155;
  line-height: 1.45;
  min-width: 0;
}

.pilot-setup-steps .step-text code {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 0.3rem;
  padding: 0.05rem 0.35rem;
  font-size: 0.78rem;
  color: #0f172a;
}

.pilot-setup-cmd {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  max-width: 100%;
}

.pilot-setup-steps .step-text code.pilot-setup-cmd-text {
  display: block;
  overflow-x: auto;
  white-space: nowrap;
  word-break: normal;
  font-size: 0.78rem;
  padding: 0.35rem 0.5rem;
  max-width: 100%;
  min-width: 0;
  flex: 1 1 auto;
}

.pilot-setup-cmd-copy {
  font-size: 0.72rem;
  flex: none;
}

.pilot-setup-modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.6rem 1rem;
  border-top: 1px solid #f1f5f9;
}

.pilot-setup-modal-footer .footnote {
  font-size: 0.72rem;
  color: #64748b;
}

/* Dashboard Header */
.dashboard-header {
  background: #000000 !important;
  color: white;
  /*padding: 2rem 0;*/
  margin-bottom: 2rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  position: sticky;
  top: 0;
  z-index: 1000;
  transition: all 0.3s ease;
}

.sticky-header {
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  background: rgba(0, 0, 0, 0.95) !important;
}

.header-content {
  padding: 0 1.5rem;
}

.dashboard-title {
  font-size: 3rem;
  font-weight: 700;
  margin: 0;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  color: white;
}

.dashboard-subtitle {
  font-size: 1.1rem;
  margin: 0;
  opacity: 0.9;
  font-weight: 300;
  color: #e9ecef;
}

/* Insights Card */
.insights-card {
  background: white;
  border-radius: 1rem;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  border: none;
  overflow: hidden;
}

.insights-card .card-header {
  background: linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%);
  border-bottom: 1px solid #e9ecef;
  padding: 1.5rem;
}

.insights-card .card-title {
  color: #495057;
  font-weight: 600;
}

/* Dashboard Card */
.dashboard-card {
  background: white;
  border-radius: 1rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  border: none;
  overflow: hidden;
}

/* Enhanced Tab Navigation */
.nav-tabs {
  border-bottom: 1px solid #dee2e6;
  background: #f8f9fa;
  padding: 0 1rem;
}

.nav-tabs .nav-link {
  border: none;
  border-bottom: 3px solid transparent;
  color: #6c757d;
  font-weight: 500;
  padding: 1rem 1.5rem;
  transition: all 0.2s ease;
}

.nav-tabs .nav-link:hover {
  border-color: transparent;
  color: #495057;
  background-color: #f8f9fa;
}

.nav-tabs .nav-link.active {
  color: #0d6efd;
  border-bottom-color: #0d6efd;
  background-color: transparent;
}

/* Global Time Context Bar */
.time-context-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-bottom: 1px solid #e2e8f0;
  font-size: 0.75rem;
  color: #64748b;
  flex-wrap: wrap;
}

.time-context-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.625rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 500;
  color: #475569;
  transition: all 0.15s ease;
}

.time-context-chip:hover {
  border-color: #cbd5e1;
  background: #f8fafc;
}

.time-context-chip--primary {
  background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
  border-color: #bfdbfe;
  color: #1e40af;
}

.time-context-chip i {
  font-size: 0.8rem;
  opacity: 0.7;
}

.time-context-divider {
  width: 1px;
  height: 16px;
  background: #cbd5e1;
  margin: 0 0.25rem;
}

.time-context-live-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.625rem;
  background: #dcfce7;
  border: 1px solid #bbf7d0;
  border-radius: 6px;
  font-size: 0.68rem;
  font-weight: 600;
  color: #166534;
}

.time-context-operational-text {
  margin-left: auto;
  font-size: 0.7rem;
  color: #64748b;
  font-weight: 500;
  letter-spacing: 0.02em;
  opacity: 0.8;
}

.live-dot {
  width: 6px;
  height: 6px;
  background: #22c55e;
  border-radius: 50%;
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.tab-content {
  min-height: 400px;
}

.card {
  border: none;
  box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075);
}

.card-header {
  background-color: #fff;
  border-bottom: 1px solid #dee2e6;
  padding: 1rem 1.5rem;
}

.spinner-border {
  width: 3rem;
  height: 3rem;
}

/* Back Button Styling */
.btn-outline-secondary:hover {
  background-color: #6c757d;
  border-color: #6c757d;
  color: white;
}

.btn-lg {
  padding: 12px 24px;
  font-size: 1.1rem;
}

/* ====== CI/CD Section Styles (matching ProductivityOverTime & EngOutput) ====== */

/* Section card container */
.cicd-section {
  border-radius: 1rem;
  border-left: 4px solid transparent;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
  animation: fadeInUp 0.5s ease-out;
  margin-bottom: 0.5rem;
}

.cicd-section:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}

/* Performance Insights - unified with AI Ops visual treatment */
.stage-performance-insights {
  border-left-color: #e5e7eb; /* softened contrast for visual continuity */
  border-left-width: 2px;
  box-shadow: none; /* Remove shadow to reduce separation feel */
  border-radius: 0.5rem 0.5rem 0 0; /* Match AI Ops rounded corners */
  border-top: none; /* Remove top border to blend with AI Ops */
  margin-top: 0; /* Remove margin to blend with AI Ops */
}

.stage-ai-usage {
  border-bottom: none; /* Remove bottom border to blend with PI */
  border-radius: 0.5rem 0.5rem 0 0; /* Only round top corners */
  margin-bottom: 0; /* Remove margin to blend with PI */
}

/* Productivity by Tool - match Performance Insights container styling */
.stage-productivity {
  border-left-color: #e5e7eb;
  border-left-width: 2px;
  box-shadow: none;
  border-radius: 0.5rem;
}

.performance-insights-section {
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  padding: 0;
  margin: 0;
  border-left: none;
  padding-left: 0;
}

/* Ensure PI header aligns with AI Ops header */
.performance-insights-section .cicd-section-header {
  padding-left: 0;
  margin-left: 0;
}

/* Ensure consistent section spacing */
.cicd-section.stage-ai-usage {
  margin-bottom: 0.5rem;
}

.cicd-section.stage-performance-insights {
  margin-bottom: 0.5rem;
}

/* Section border styling */
.cicd-section.stage-ai-usage {
  border-left-color: #0dcaf0; /* info/cyan for AI usage */
}

.cicd-section.stage-ai-spend {
  border-left-color: #198754; /* success/green for spend */
}

/* 🔥 STEP 1 — NARRATIVE BRIDGE STYLING */
.narrative-bridge {
  padding-top: 8px;
  padding-bottom: 10px;
}

.narrative-bridge p {
  font-size: 12px;
  color: #6c757d !important;
  font-weight: 400;
  text-align: center;
  margin: 0;
}

/* 🔥 STEP 3.4 — FURTHER REDUCE AI USAGE SIGNALS VISUAL WEIGHT */
.ai-adoption-drilldown p {
  font-size: 11px;
  color: #adb5bd !important;
  font-weight: 300;
  text-align: center;
  margin: 0;
  opacity: 0.8;
}

.ai-drilldown-secondary {
  opacity: 1;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03) !important;
  border: 1px solid rgba(0, 0, 0, 0.05) !important;
  transform: none;
}

.ai-drilldown-secondary .card-body {
  padding: 0.75rem !important;
}

.ai-drilldown-secondary .cicd-section-header h5 {
  font-weight: 400 !important;
  font-size: 0.9rem !important;
  color: #6c757d !important;
}

.ai-drilldown-secondary .cicd-section-header small {
  font-size: 0.75rem !important;
  opacity: 0.7;
}

/* 🔥 STEP 3 — PERFORMANCE INSIGHTS CONTAINER */
.performance-insights-container {
  margin-top: 4px !important;
  margin-bottom: 4px !important;
}

/* CR-X 2B.1: PI Population Scope Banner */
.pi-population-scope-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 8px;
  background: #f0f7ff;
  border: 1px solid #d0e3ff;
  border-radius: 6px;
  font-size: 0.8125rem;
  color: #2c5282;
}
.pi-population-scope-icon {
  flex-shrink: 0;
  font-weight: bold;
  font-size: 0.875rem;
  line-height: 1.2;
}
.pi-population-scope-text {
  line-height: 1.4;
}

/* K1B: PI/AIOI cohort scope row */
.pi-cohort-scope-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  margin-bottom: 6px;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 6px;
}
.pi-cohort-scope-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: #495057;
  margin: 0;
  white-space: nowrap;
}
.pi-cohort-select {
  width: auto;
  min-width: 180px;
  font-size: 0.78rem;
}
.pi-cohort-scope-note {
  font-size: 0.72rem;
  color: #6c757d;
}

.performance-insights-primary {
  margin-top: 16px !important;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06) !important;
  border: 1px solid rgba(0, 0, 0, 0.04) !important;
}

.performance-insights-primary h5 {
  font-weight: 700 !important;
  color: #212529 !important;
}

.performance-insights-primary .cicd-subtitle {
  color: #495057 !important;
  font-weight: 400 !important;
}

/* ========================================
   DENSITY TOKENS - Performance Insights Tab
   ========================================
   Reusable utility classes for consistent dense spacing
   across DORA Metrics, AI Impact Summary, and Performance Insights sections
   */

/* Dense section card - reduced padding for wrapper cards */
.cm-section-dense {
  padding: 0.75rem 1rem;
}

/* Dense header - reduced margin, padding, and border */
.cm-header-dense {
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #e9ecef;
  margin-bottom: 0.5rem; /* mb-2 equivalent */
}

/* Dense subtitle - smaller font, tighter line-height */
.cm-subtitle-dense {
  font-size: 0.8rem;
  line-height: 1.3;
  display: block;
  margin-top: 0.15rem;
}

/* Dense icon wrapper - smaller size, reduced margin */
.cm-icon-dense {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  font-size: 1.1rem;
  margin-right: 0.5rem; /* me-2 equivalent */
}

.chaos-text {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 90px;
  letter-spacing: -1px; /* The logo is tightly packed */
  text-transform: uppercase;
  color: #000000; /* Use #FFFFFF for dark backgrounds */
  line-height: 1.7;
  margin-top: 0px;
  margin-bottom:0px;
  padding-top:0px;
  padding-bottom:0px;
  /* Optional: Adds a subtle 'rough' feel to mimic the logo's texture */
  filter: contrast(150%) brightness(110%);
}

/* Tight stack spacing - reduced margin between stacked blocks */
.cm-stack-tight {
  margin-bottom: var(--cm-space-lg); /* mb-3 equivalent, but tighter */
}

/* Legacy compatibility - map old classes to density tokens */
.cicd-section-header {
  padding-bottom: var(--cm-space-sm);
  border-bottom: var(--cm-border-light);
}

.cicd-subtitle {
  font-size: var(--cm-font-sm);
  line-height: 1.3;
  display: block;
  margin-top: var(--cm-space-xs);
}

.stage-icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: var(--cm-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--cm-shadow-sm);
  font-size: var(--cm-font-lg);
}

.compact-card-body {
  padding: var(--cm-space-sm) var(--cm-space-md);
}

/* Individual insight cards */
.insight-item {
  padding: var(--cm-space-md);
  border-radius: var(--cm-radius-md);
  background: var(--cm-white);
  border-left: 3px solid var(--cm-gray-300);
  border: var(--cm-border-light);
  transition: all 0.2s ease;
  height: 100%;
}

.insight-item:hover {
  transform: translateY(-2px);
  box-shadow: var(--cm-shadow-lg);
}

.insight-item.insight-critical,
.insight-item.insight-risk {
  border-left-color: var(--cm-red-600);
  background: var(--cm-red-50);
}

.insight-item.insight-warning {
  border-left-color: var(--cm-yellow-600);
  background: var(--cm-yellow-50);
}

.insight-item.insight-info {
  border-left-color: var(--cm-cyan-600);
  background: var(--cm-cyan-50);
}

.insight-item.insight-opportunity {
  border-left-color: var(--cm-green-600);
  background: var(--cm-green-50);
}

.insight-severity-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

/* Evidence tags */
.evidence-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--cm-space-sm);
  margin-top: var(--cm-space-sm);
}

.evidence-tag {
  background: var(--cm-gray-100);
  padding: var(--cm-space-xs) var(--cm-space-sm);
  border-radius: var(--cm-radius-sm);
  font-size: var(--cm-font-xs);
}

/* Badge utilities */
.badge-sm {
  font-size: 0.7rem;
  padding: 0.25rem 0.5rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.bg-warning-subtle {
  background-color: rgba(255, 193, 7, 0.1) !important;
  color: #ffc107 !important;
}

.text-warning {
  color: #ffc107 !important;
}

/* Fade-in animation */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* DORA Metrics data-source-badge styles */
.data-source-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: white;
  margin-bottom: 0.5rem;
}

/* DORA mini-card grid (compact) */
.dora-mini-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.35rem;
}

.dora-mini-card {
  background: #ffffff;
  border: 1px solid #e9ecef;
  border-radius: 0.6rem;
  padding: 0.75rem 0.75rem;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  min-height: 96px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.dora-mini-top {
  display: flex;
  justify-content: center;
  margin-bottom: 0.35rem;
}

.dora-mini-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: #6c757d;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-align: center;
  line-height: 1.1;
  margin-right: 0;
}

.dora-mini-value {
  text-align: center;
  font-weight: 800;
  font-size: 1.1rem;
  line-height: 1.1;
  margin-top: 0.25rem;
  margin-bottom: 0.25rem;
}

.dora-mini-why {
  text-align: center;
  margin-top: 0.15rem;
}

.data-source-badge.small {
  font-size: 0.65rem;
  padding: 0.2rem 0.4rem;
}

/* AI Impact Summary row-based styling */
.ai-impact-rows {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ai-impact-row {
  display: flex;
  align-items: flex-start;
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  background: #f8f9fa;
  border-left: 3px solid #0d6efd;
}

.ai-impact-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  color: #6c757d;
  min-width: 140px;
  margin-right: 1rem;
  flex-shrink: 0;
}

.ai-impact-text {
  font-size: 0.9rem;
  color: #343a40;
  flex: 1;
}

.data-source-badge.real {
  background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
}

.data-source-badge.simulated {
  background: linear-gradient(135deg, #ffc107 0%, #fd7e14 100%);
  color: #212529;
}

/* Dashboard logo responsive sizing */
.dashboard-logo {
  height: 6.5rem;
  width: auto;
}

/* Mobile responsive adjustments */
@media (max-width: 576px) {
  .dashboard-logo {
    height: 3.5rem;
  }
  
  .dashboard-header .header-content {
    padding: 1rem !important;
  }
  
  .dashboard-card .card-body {
    padding: 0 !important;
  }
  
  .dashboard-card .tab-content {
    padding: 0 !important;
  }
  
  /* Remove side gutters on mobile */
  .container-fluid {
    padding-left: 0.5rem;
    padding-right: 0.5rem;
  }
  
  /* Ensure full-width cards on mobile */
  .dashboard-card {
    border-radius: 0.5rem;
    margin-left: 0;
    margin-right: 0;
  }
  
  /* Reduce DORA metrics card padding on mobile */
  .cicd-section.card .card-body {
    padding: 0.75rem !important;
  }

  .dora-mini-grid {
    grid-template-columns: 1fr;
  }
  
  .dora-mini-card {
    padding: 0.7rem 0.7rem;
    border-radius: 0.55rem;
  }

  .cicd-section.card .compact-card-body {
    padding: 0.5rem 0.75rem !important;
  }
}

/* Enhanced mobile responsiveness for tablets and phones */
@media (max-width: 768px) {
  /* Header adjustments */
  .dashboard-header {
    padding: 0.5rem 0 !important;
  }
  
  .dashboard-header .header-content {
    padding: 0.75rem 0.5rem !important;
    flex-direction: column;
    align-items: flex-start !important;
    gap: 0.5rem;
  }
  
  .dashboard-title {
    font-size: 1.25rem !important;
  }
  
  .dashboard-subtitle {
    font-size: 0.875rem !important;
  }
  
  /* Navigation tabs */
  .nav-tabs .nav-link {
    font-size: 0.875rem;
    padding: 0.5rem 0.75rem;
  }
  
  /* Container adjustments */
  .container-fluid {
    padding-left: 0.75rem;
    padding-right: 0.75rem;
  }
  
  /* Card adjustments */
  .dashboard-card {
    margin-bottom: 1rem;
  }
  
  .cicd-section.card .card-body {
    padding: 0.5rem !important;
  }
  
  /* AI Usage Signals specific mobile fixes */
  .ai-usage-signals-section .cicd-section-header {
    flex-direction: column !important;
    align-items: flex-start !important;
    gap: 0.5rem !important;
    padding: 0.75rem !important;
  }
  
  .ai-usage-signals-section .stage-icon-wrapper {
    width: 32px !important;
    height: 32px !important;
    font-size: 0.75rem;
  }
  
  .ai-usage-signals-section h5 {
    font-size: 0.9rem !important;
  }
  
  .ai-usage-signals-section .text-muted {
    font-size: 0.75rem !important;
  }
  
  /* Performance Insights mobile adjustments */
  .performance-insights .cicd-section-header {
    flex-direction: column !important;
    align-items: flex-start !important;
    gap: 0.5rem !important;
    padding: 0.75rem !important;
  }
  
  .performance-insights .stage-icon-wrapper {
    width: 32px !important;
    height: 32px !important;
    font-size: 0.75rem;
  }
  
  .performance-insights h5 {
    font-size: 0.9rem !important;
  }

  /* Narrative Bridge Styling */
  .narrative-bridge {
    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
    border-radius: 6px;
    padding: 0.4rem 0.75rem;
    border: 1px solid #e2e8f0;
  }

  .bridge-content {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .bridge-arrow {
    font-size: 1.1rem;
    color: #6366f1;
    font-weight: bold;
  }

  .bridge-text {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
  }

  .bridge-label {
    font-weight: 600;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }

  .bridge-desc {
    color: #64748b;
  }
  
  /* Tab content padding */
  .tab-content > .tab-pane {
    padding: 0.5rem !important;
  }

  /* PI highlight flash animation for drilldown - restrained but clear */
  .pi-highlight-flash {
    animation: piFlash 2s ease-in-out;
    position: relative;
  }

  @keyframes piFlash {
    0% {
      background-color: #f8fafc;
      box-shadow: 0 0 0 2px #64748b, 0 2px 8px rgba(100, 116, 139, 0.15);
    }
    30% {
      background-color: #f1f5f9;
      box-shadow: 0 0 0 2px #64748b, 0 2px 8px rgba(100, 116, 139, 0.2);
    }
    100% {
      background-color: transparent;
      box-shadow: none;
    }
  }

  /* Performance Insights section - prevent overflow */
  .performance-insights-section {
    overflow-x: hidden;
    max-width: 100%;
  }

  .performance-insights-section .card-body {
    overflow-x: hidden;
    max-width: 100%;
  }

  /* Ensure PI cards don't overflow */
  .performance-insights-section .insight-item,
  .performance-insights-section .decision-card {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Prevent metric/unit clipping */
  .performance-insights-section .metric-value,
  .performance-insights-section .metric-unit {
    white-space: nowrap;
    overflow: visible;
  }

  /* PRIORITY 2: Reduce PI section visual weight to match telemetry surface */
  .performance-insights-section .card {
    background: #fafbfc;
    border-color: #f3f4f6;
  }

  .performance-insights-section .cicd-section-header {
    padding: 0.5rem 0.75rem;
  }

  .performance-insights-section h5 {
    font-size: 0.875rem;
    font-weight: 600;
  }

  .performance-insights-section .cm-subtitle-dense {
    font-size: 0.6875rem;
  }

  /* Tighten vertical rhythm in PI section */
  .performance-insights-section .card-body {
    padding: 0.75rem;
  }

  .performance-insights-section .insight-item {
    padding: 0.5rem 0.625rem;
    margin-bottom: 0.375rem;
    border: 1px solid #f3f4f6;
    border-radius: 0.375rem;
  }

  .performance-insights-section .insight-item:hover {
    border-color: #e5e7eb;
  }

  .performance-insights-section .decision-card {
    padding: 0.75rem;
    border: 1px solid #e5e7eb;
    border-radius: 0.375rem;
  }
}

/* Extra small mobile devices */
@media (max-width: 480px) {
  /* Ultra compact header */
  .dashboard-header .header-content {
    padding: 0.5rem !important;
  }
  
  .dashboard-title {
    font-size: 1.1rem !important;
  }
  
  .dashboard-subtitle {
    font-size: 0.8rem !important;
  }
  
  .dashboard-logo {
    height: 2.5rem;
  }
  
  /* Navigation */
  .nav-tabs .nav-link {
    font-size: 0.8rem;
    padding: 0.4rem 0.6rem;
  }
  
  /* Container */
  .container-fluid {
    padding-left: 0.5rem;
    padding-right: 0.5rem;
  }
  
  /* Cards */
  .dashboard-card {
    margin-bottom: 0.75rem;
  }
  
  .cicd-section.card .card-body {
    padding: 0.25rem !important;
  }
  
  /* AI Usage Signals ultra mobile */
  .ai-usage-signals-section .cicd-section-header {
    padding: 0.5rem !important;
  }
  
  .ai-usage-signals-section .stage-icon-wrapper {
    width: 28px !important;
    height: 28px !important;
    font-size: 0.7rem;
  }
  
  .ai-usage-signals-section h5 {
    font-size: 0.85rem !important;
  }
  
  .ai-usage-signals-section .text-muted {
    font-size: 0.7rem !important;
  }
  
  /* Performance Insights ultra mobile */
  .performance-insights .cicd-section-header {
    padding: 0.5rem !important;
  }
  
  .performance-insights .stage-icon-wrapper {
    width: 28px !important;
    height: 28px !important;
    font-size: 0.7rem;
  }
  
  .performance-insights h5 {
    font-size: 0.85rem !important;
  }
  
  /* Tab content */
  .tab-content > .tab-pane {
    padding: 0.25rem !important;
  }
  
  /* Buttons */
  .btn-lg {
    font-size: 0.9rem;
    padding: 0.5rem 1rem;
  }
}

/* Reduce AI Impact Summary padding on mobile */
@media (max-width: 480px) {
  .ai-impact-row {
    padding: 0.5rem 0.75rem !important;
  }

  .ai-impact-label {
    min-width: 120px;
    font-size: 0.7rem;
    margin-right: 0.75rem;
  }

  .ai-impact-text {
    font-size: 0.85rem;
  }

  /* Ensure compact spacing on mobile */
  .cicd-section-header {
    padding-bottom: 0.5rem !important;
    margin-bottom: 0.5rem !important;
  }
  
  .org-summary-strip {
    padding: 0.25rem 0.5rem !important;
  }
}

/* AI Ops to PI linking - highlight animation */
.pi-highlight-flash {
  animation: piFlash 2s ease-in-out;
}

@keyframes piFlash {
  0% {
    background-color: #fff3cd;
    transform: scale(1);
  }
  50% {
    background-color: #ffc107;
    transform: scale(1.02);
  }
  100% {
    background-color: transparent;
    transform: scale(1);
  }
}
</style>
