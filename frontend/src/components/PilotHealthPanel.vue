<template>
  <div class="pilot-health-panel">
    <!-- Header -->
    <div class="ph-header">
      <div class="ph-header-title">
        <h3>Pilot Health</h3>
        <span class="ph-checked-at" v-if="health?.checked_at">
          Checked: {{ formatTime(health.checked_at) }}
        </span>
      </div>
      <button class="ph-refresh-btn" @click="fetchHealth" :disabled="loading" :aria-label="loading ? 'Checking pilot health' : 'Refresh pilot health'">
        <i :class="loading ? 'bi bi-arrow-repeat ph-spin-icon' : 'bi bi-arrow-clockwise'" class="me-1"></i>{{ loading ? 'Checking...' : 'Refresh' }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading && !health" class="ph-loading">
      <div class="ph-loading-spinner"></div>
      <span>Loading pilot health...</span>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="ph-error">
      <div class="ph-error-icon">!</div>
      <div class="ph-error-body">
        <div class="ph-error-title">Failed to load pilot health</div>
        <div class="ph-error-detail">{{ error }}</div>
      </div>
      <button class="ph-retry-btn" @click="fetchHealth">Retry</button>
    </div>

    <!-- Not available (endpoint 404 — backend parity gap) -->
    <div v-else-if="notAvailable" class="ph-not-available">
      <div class="ph-not-available-icon"><i class="bi bi-info-circle"></i></div>
      <div class="ph-not-available-body">
        <div class="ph-not-available-title">Pilot Health not available in this environment</div>
        <div class="ph-not-available-detail">The pilot health endpoint is not deployed on this server. This does not affect developer enrollment or telemetry delivery.</div>
      </div>
    </div>

    <!-- Health snapshot -->
    <div v-else-if="health" class="ph-body">
      <!-- Overall severity banner -->
      <div :class="['ph-severity-banner', `ph-severity-${health.severity.toLowerCase()}`]" title="Operational/ingestion health only — does not attest cost configuration, GitHub repository authority, delivery evidence, or developer attribution completeness.">
        <span class="ph-severity-label">Operational Health: {{ health.severity }}</span>
        <span class="ph-severity-status">{{ health.status }}</span>
        <span v-if="health.severity !== 'GREEN'" class="ph-severity-issues">
          {{ health.status === 'critical' ? 'Critical issues detected' : 'Warnings detected' }}
        </span>
      </div>

      <!-- Two-column grid -->
      <div class="ph-grid">
        <!-- Telemetry freshness -->
        <div class="ph-card">
          <div class="ph-card-header">
            <span class="ph-card-icon">📡</span>
            <span class="ph-card-title">Telemetry Freshness</span>
            <span class="ph-card-authority-tag" title="Raw observed session evidence — not canonical product universe">RAW</span>
          </div>
          <div :class="['ph-state-badge', `ph-state-${health.telemetry.state.toLowerCase()}`]">
            {{ health.telemetry.state }}
          </div>
          <div class="ph-card-metrics">
            <div class="ph-metric">
              <span class="ph-metric-label">Latest event</span>
              <span class="ph-metric-value">{{ formatTime(health.telemetry.latest_event_at) || '—' }}</span>
            </div>
            <div class="ph-metric">
              <span class="ph-metric-label">Freshness</span>
              <span class="ph-metric-value" :title="health.telemetry.latest_event_at || ''">
                {{ formatFreshness(health.telemetry.latest_event_at, health.telemetry.freshness_human) }}
              </span>
            </div>
            <div class="ph-metric">
              <span class="ph-metric-label">Events</span>
              <span class="ph-metric-value">{{ health.telemetry.event_count.toLocaleString() }}</span>
            </div>
            <div class="ph-metric">
              <span class="ph-metric-label">Sessions</span>
              <span class="ph-metric-value">{{ health.telemetry.session_count.toLocaleString() }}</span>
            </div>
          </div>
          <div class="ph-card-message">{{ health.telemetry.message }}</div>
          <div class="ph-card-authority-note">
            Session count is raw observed evidence from all telemetry events. Product Availability below shows the canonical product-analysis universe (may differ due to canonical population filtering).
          </div>
          <div v-if="health.telemetry.remediation" class="ph-remediation">
            <span class="ph-remediation-icon">→</span>
            <span class="ph-remediation-action">{{ health.telemetry.remediation.action }}</span>
            <a v-if="health.telemetry.remediation.url" :href="health.telemetry.remediation.url" class="ph-remediation-link">{{ health.telemetry.remediation.url }}</a>
          </div>
        </div>
        <div class="ph-card">
          <div class="ph-card-header">
            <span class="ph-card-icon">🔌</span>
            <span class="ph-card-title">Extension Versions</span>
          </div>
          <div :class="['ph-state-badge', `ph-state-${health.extension.state.toLowerCase()}`]">
            {{ health.extension.state }}
          </div>
          <div class="ph-card-metrics">
            <div class="ph-metric">
              <span class="ph-metric-label">Expected</span>
              <span class="ph-metric-value">{{ health.extension.expected_versions.join(', ') }}</span>
            </div>
            <div v-if="health.extension.installation_summary" class="ph-metric">
              <span class="ph-metric-label">Installations</span>
              <span class="ph-metric-value">
                {{ health.extension.installation_summary.current }}/{{ health.extension.installation_summary.total }} current
              </span>
            </div>
          </div>
          <!-- P0-D: Installation-level version health (latest observed per installation) -->
          <div v-if="health.extension.installations && health.extension.installations.length > 0" class="ph-installations-list">
            <div v-for="inst in health.extension.installations" :key="inst.installation_id" class="ph-install-row">
              <span class="ph-install-id">{{ inst.installation_id.substring(0, 8) }}…</span>
              <span :class="['ph-install-status', `ph-install-${inst.status.toLowerCase()}`]">{{ inst.status }}</span>
              <span class="ph-install-version">{{ inst.latest_version }}</span>
              <span v-if="inst.is_bridge" class="ph-install-bridge">bridge</span>
            </div>
          </div>
          <!-- Historical version distribution (secondary context) -->
          <details class="ph-version-history">
            <summary>Historical versions ({{ health.extension.observed_versions.length }})</summary>
            <div v-for="v in health.extension.observed_versions" :key="v.version" class="ph-metric">
              <span class="ph-metric-label">{{ v.version }}</span>
              <span class="ph-metric-value">{{ v.event_count }} events</span>
            </div>
          </details>
          <div class="ph-card-message">{{ health.extension.message }}</div>
          <div v-if="health.extension.authority_note" class="ph-card-authority-note">
            {{ health.extension.authority_note }}
          </div>
          <div v-if="health.extension.remediation" class="ph-remediation">
            <span class="ph-remediation-icon">→</span>
            <span class="ph-remediation-action">{{ health.extension.remediation.action }}</span>
            <a v-if="health.extension.remediation.url" :href="health.extension.remediation.url" class="ph-remediation-link">{{ health.extension.remediation.url }}</a>
          </div>
        </div>

        <!-- Active sources (RAW — unnormalized source IDs) -->
        <div class="ph-card">
          <div class="ph-card-header">
            <span class="ph-card-icon">⚡</span>
            <span class="ph-card-title">Active Sources</span>
            <span class="ph-card-authority-tag" title="Raw source IDs (unnormalized)">RAW</span>
          </div>
          <div v-if="health.active_sources.length === 0" class="ph-card-empty">No active sources</div>
          <div v-else class="ph-sources-list">
            <div v-for="src in health.active_sources" :key="src.editor_source" class="ph-source-row">
              <span class="ph-source-name">{{ src.editor_source || 'unknown' }}</span>
              <span class="ph-source-counts">
                {{ src.session_count }} sessions / {{ src.event_count }} events
              </span>
              <span class="ph-source-last">{{ formatTime(src.last_seen) || '—' }}</span>
            </div>
          </div>
          <div v-if="health.active_sources_authority_note" class="ph-card-authority-note">
            {{ health.active_sources_authority_note }}
          </div>
        </div>

        <!-- Installations -->
        <div class="ph-card">
          <div class="ph-card-header">
            <span class="ph-card-icon">📦</span>
            <span class="ph-card-title">Installations</span>
          </div>
          <div class="ph-card-metrics">
            <div class="ph-metric">
              <span class="ph-metric-label">Telemetry</span>
              <span class="ph-metric-value">{{ health.installations.telemetry_installations }}</span>
            </div>
            <div class="ph-metric">
              <span class="ph-metric-label">Tokens</span>
              <span class="ph-metric-value">{{ health.installations.token_installations }}</span>
            </div>
          </div>
          <div class="ph-card-message">{{ health.installations.message }}</div>
          <div v-if="health.installations.authority_note" class="ph-card-authority-note">
            {{ health.installations.authority_note }}
          </div>
        </div>

        <!-- Identity coverage -->
        <div class="ph-card">
          <div class="ph-card-header">
            <span class="ph-card-icon">👤</span>
            <span class="ph-card-title">Developer Identity</span>
            <span v-if="health.identity_coverage.person_level_identity_coverage === 'UNAVAILABLE'" class="ph-card-authority-tag" title="Person-level coverage unavailable because the observed telemetry contains legacy identity formats that cannot be resolved to people.">UNAVAILABLE</span>
            <span v-else-if="health.identity_coverage.person_level_identity_coverage === 'AVAILABLE'" class="ph-card-authority-tag" title="Person-level coverage available because all observed telemetry identities are invite-backed.">AVAILABLE</span>
          </div>
          <div class="ph-card-metrics">
            <div class="ph-metric">
              <span class="ph-metric-label">Observed identities</span>
              <span class="ph-metric-value">{{ health.identity_coverage.total_identities }}</span>
            </div>
            <div class="ph-metric">
              <span class="ph-metric-label">Invite-backed</span>
              <span class="ph-metric-value">{{ health.identity_coverage.invite_backed }}</span>
            </div>
            <div v-if="health.identity_coverage.person_level_identity_coverage === 'AVAILABLE'" class="ph-metric">
              <span class="ph-metric-label">Coverage</span>
              <span class="ph-metric-value">{{ health.identity_coverage.invite_backed_coverage_pct }}%</span>
            </div>
            <div v-else-if="health.identity_coverage.total_identities > 0" class="ph-metric">
              <span class="ph-metric-label">Person-level coverage</span>
              <span class="ph-metric-value">—</span>
            </div>
          </div>
          <div class="ph-card-message">{{ health.identity_coverage.message }}</div>
          <div class="ph-card-authority-note">
            Observed telemetry identities (distinct user_id values in telemetry events). Use <em>identity</em> for counts that have not been authoritatively resolved to people. The Team page shows the curated roster of invite-backed developers.
          </div>
          <div v-if="health.identity_coverage.unresolved_identity_classes && health.identity_coverage.unresolved_identity_classes.length > 0" class="ph-reason">
            Legacy identity formats detected.
          </div>
          <div v-if="health.identity_coverage.remediation" class="ph-remediation">
            <span class="ph-remediation-icon">→</span>
            <span class="ph-remediation-action">{{ health.identity_coverage.remediation.action }}</span>
            <a v-if="health.identity_coverage.remediation.url" :href="health.identity_coverage.remediation.url" class="ph-remediation-link">{{ health.identity_coverage.remediation.url }}</a>
          </div>
        </div>
        <div class="ph-card">
          <div class="ph-card-header">
            <span class="ph-card-icon">📁</span>
            <span class="ph-card-title">Repo Attribution</span>
          </div>
          <div class="ph-card-metrics">
            <div class="ph-metric">
              <span class="ph-metric-label">Events w/ repo</span>
              <span class="ph-metric-value">{{ health.repository_attribution.events_with_repo.toLocaleString() }}</span>
            </div>
            <div class="ph-metric">
              <span class="ph-metric-label">Coverage</span>
              <span class="ph-metric-value">{{ health.repository_attribution.attribution_coverage_pct }}%</span>
            </div>
            <div class="ph-metric">
              <span class="ph-metric-label">Distinct repos</span>
              <span class="ph-metric-value">{{ health.repository_attribution.distinct_repos }}</span>
            </div>
          </div>
          <div class="ph-card-message">{{ health.repository_attribution.message }}</div>
          <div v-if="health.repository_attribution.remediation" class="ph-remediation">
            <span class="ph-remediation-icon">→</span>
            <span class="ph-remediation-action">{{ health.repository_attribution.remediation.action }}</span>
            <a v-if="health.repository_attribution.remediation.url" :href="health.repository_attribution.remediation.url" class="ph-remediation-link">{{ health.repository_attribution.remediation.url }}</a>
          </div>
        </div>

        <!-- GitHub evidence -->
        <div class="ph-card">
          <div class="ph-card-header">
            <span class="ph-card-icon">🐙</span>
            <span class="ph-card-title">GitHub Evidence</span>
          </div>
          <div :class="['ph-state-badge', `ph-state-${health.github_engineering_evidence.state.toLowerCase()}`]">
            {{ health.github_engineering_evidence.state }}
          </div>
          <div class="ph-card-metrics">
            <div class="ph-metric">
              <span class="ph-metric-label">Login connected</span>
              <span class="ph-metric-value">{{ health.github_engineering_evidence.login_connected ? 'Yes' : 'No' }}</span>
            </div>
            <div class="ph-metric">
              <span class="ph-metric-label">Eng. evidence</span>
              <span class="ph-metric-value">{{ health.github_engineering_evidence.engineering_evidence_eligible ? 'Eligible' : 'Not eligible' }}</span>
            </div>
            <div class="ph-metric">
              <span class="ph-metric-label">Historical data</span>
              <span class="ph-metric-value">{{ health.github_engineering_evidence.historical_evidence_available ? 'Available' : 'None' }}</span>
            </div>
          </div>
          <div class="ph-card-message">{{ health.github_engineering_evidence.message }}</div>
          <div v-if="health.github_engineering_evidence.remediation" class="ph-remediation">
            <span class="ph-remediation-icon">→</span>
            <span class="ph-remediation-action">{{ health.github_engineering_evidence.remediation.action }}</span>
            <a v-if="health.github_engineering_evidence.remediation.url" :href="health.github_engineering_evidence.remediation.url" class="ph-remediation-link">{{ health.github_engineering_evidence.remediation.url }}</a>
          </div>
        </div>

        <!-- Auth credentials -->
        <div class="ph-card">
          <div class="ph-card-header">
            <span class="ph-card-icon">🔑</span>
            <span class="ph-card-title">Auth Credentials</span>
          </div>
          <div :class="['ph-state-badge', `ph-state-${health.auth_credentials.state.toLowerCase()}`]">
            {{ health.auth_credentials.state }}
          </div>
          <div class="ph-card-metrics">
            <div class="ph-metric">
              <span class="ph-metric-label">Active tokens</span>
              <span class="ph-metric-value">{{ health.auth_credentials.active_tokens }}</span>
            </div>
            <div class="ph-metric">
              <span class="ph-metric-label">Expired</span>
              <span class="ph-metric-value">{{ health.auth_credentials.expired_tokens }}</span>
            </div>
            <div class="ph-metric">
              <span class="ph-metric-label">Expiring 7d</span>
              <span class="ph-metric-value">{{ health.auth_credentials.expiring_within_7d }}</span>
            </div>
          </div>
          <div class="ph-card-message">{{ health.auth_credentials.message }}</div>
          <div v-if="health.auth_credentials.remediation" class="ph-remediation">
            <span class="ph-remediation-icon">→</span>
            <span class="ph-remediation-action">{{ health.auth_credentials.remediation.action }}</span>
            <a v-if="health.auth_credentials.remediation.url" :href="health.auth_credentials.remediation.url" class="ph-remediation-link">{{ health.auth_credentials.remediation.url }}</a>
          </div>
        </div>

        <!-- Cost configuration -->
        <div class="ph-card">
          <div class="ph-card-header">
            <span class="ph-card-icon">💰</span>
            <span class="ph-card-title">Cost Configuration</span>
            <span class="ph-card-authority-tag" :title="health.cost.authority">{{ health.cost.authority }}</span>
          </div>
          <div :class="['ph-state-badge', `ph-state-${health.cost.state.toLowerCase()}`]">
            {{ health.cost.state }}
          </div>
          <div class="ph-card-metrics">
            <div class="ph-metric">
              <span class="ph-metric-label">Configured tools</span>
              <span class="ph-metric-value">{{ health.cost.configured_count ?? 0 }}</span>
            </div>
            <div v-if="health.cost.total_monthly_spend && health.cost.total_monthly_spend > 0" class="ph-metric">
              <span class="ph-metric-label">Monthly spend</span>
              <span class="ph-metric-value">${{ Number(health.cost.total_monthly_spend).toLocaleString() }}</span>
            </div>
          </div>
          <div class="ph-card-message">{{ health.cost.message }}</div>
          <div v-if="health.cost.remediation" class="ph-remediation">
            <span class="ph-remediation-icon">→</span>
            <span class="ph-remediation-action">{{ health.cost.remediation.action }}</span>
            <a v-if="health.cost.remediation.url" :href="health.cost.remediation.url" class="ph-remediation-link">{{ health.cost.remediation.url }}</a>
          </div>
        </div>

        <!-- CR-X Day 2 X3: Connect-code expiry -->
        <div v-if="health.connect_code_expiry" class="ph-card">
          <div class="ph-card-header">
            <span class="ph-card-icon">🎟️</span>
            <span class="ph-card-title">Connect-Code Expiry</span>
          </div>
          <div :class="['ph-state-badge', `ph-state-${health.connect_code_expiry.state.toLowerCase()}`]">
            {{ health.connect_code_expiry.state }}
          </div>
          <div class="ph-card-metrics">
            <div class="ph-metric">
              <span class="ph-metric-label">Expired unredeemed</span>
              <span class="ph-metric-value">{{ health.connect_code_expiry.expired_unredeemed }}</span>
            </div>
            <div class="ph-metric">
              <span class="ph-metric-label">Expiring 7d</span>
              <span class="ph-metric-value">{{ health.connect_code_expiry.expiring_within_7d }}</span>
            </div>
            <div class="ph-metric">
              <span class="ph-metric-label">Total unredeemed</span>
              <span class="ph-metric-value">{{ health.connect_code_expiry.total_unredeemed }}</span>
            </div>
          </div>
          <div class="ph-card-message">{{ health.connect_code_expiry.message }}</div>
          <div v-if="health.connect_code_expiry.remediation" class="ph-remediation">
            <span class="ph-remediation-icon">→</span>
            <span class="ph-remediation-action">{{ health.connect_code_expiry.remediation.action }}</span>
            <a v-if="health.connect_code_expiry.remediation.url" :href="health.connect_code_expiry.remediation.url" class="ph-remediation-link">{{ health.connect_code_expiry.remediation.url }}</a>
          </div>
        </div>

        <!-- CR-X Day 2 X3: Installation failures -->
        <div v-if="health.installation_failures" class="ph-card">
          <div class="ph-card-header">
            <span class="ph-card-icon">⚠️</span>
            <span class="ph-card-title">Installation Failures</span>
          </div>
          <div :class="['ph-state-badge', `ph-state-${health.installation_failures.state.toLowerCase()}`]">
            {{ health.installation_failures.state }}
          </div>
          <div class="ph-card-metrics">
            <div class="ph-metric">
              <span class="ph-metric-label">Failure count</span>
              <span class="ph-metric-value">{{ health.installation_failures.failure_count }}</span>
            </div>
            <div v-if="health.installation_failures.latest_failure_at" class="ph-metric">
              <span class="ph-metric-label">Latest failure</span>
              <span class="ph-metric-value">{{ health.installation_failures.latest_failure_at }}</span>
            </div>
          </div>
          <div class="ph-card-message">{{ health.installation_failures.message }}</div>
          <div v-if="health.installation_failures.remediation" class="ph-remediation">
            <span class="ph-remediation-icon">→</span>
            <span class="ph-remediation-action">{{ health.installation_failures.remediation.action }}</span>
            <a v-if="health.installation_failures.remediation.url" :href="health.installation_failures.remediation.url" class="ph-remediation-link">{{ health.installation_failures.remediation.url }}</a>
          </div>
        </div>

        <!-- Product availability -->
        <div class="ph-card ph-card-wide">
          <div class="ph-card-header">
            <span class="ph-card-icon">🎯</span>
            <span class="ph-card-title">Product Availability</span>
          </div>
          <div class="ph-product-grid">
            <div class="ph-product-section">
              <div :class="['ph-state-badge', `ph-state-${health.product.pi.state.toLowerCase()}`]">
                PI: {{ health.product.pi.state }}
              </div>
              <div class="ph-card-metrics">
                <div class="ph-metric">
                  <span class="ph-metric-label">Sessions</span>
                  <span class="ph-metric-value">{{ health.product.pi.observable_sessions }}</span>
                </div>
                <div class="ph-metric">
                  <span class="ph-metric-label">Workflows</span>
                  <span class="ph-metric-value">{{ health.product.pi.observable_workflows }}</span>
                </div>
              </div>
              <div v-for="r in health.product.pi.reasons" :key="r" class="ph-reason">{{ r }}</div>
              <div v-if="health.product.pi.remediation" class="ph-remediation">
                <span class="ph-remediation-icon">→</span>
                <span class="ph-remediation-action">{{ health.product.pi.remediation.action }}</span>
                <a v-if="health.product.pi.remediation.url" :href="health.product.pi.remediation.url" class="ph-remediation-link">{{ health.product.pi.remediation.url }}</a>
              </div>
            </div>
            <div class="ph-product-section">
              <div :class="['ph-state-badge', `ph-state-${health.product.pbt.state.toLowerCase()}`]">
                PBT: {{ health.product.pbt.state }}
              </div>
              <div class="ph-card-metrics">
                <div class="ph-metric">
                  <span class="ph-metric-label">Sessions</span>
                  <span class="ph-metric-value">{{ health.product.pbt.observable_sessions }}</span>
                </div>
                <div class="ph-metric">
                  <span class="ph-metric-label">Workflows</span>
                  <span class="ph-metric-value">{{ health.product.pbt.observable_workflows }}</span>
                </div>
                <div class="ph-metric">
                  <span class="ph-metric-label">Comparison</span>
                  <span class="ph-metric-value">{{ health.product.pbt.comparison_available ? 'Available' : 'Single workflow' }}</span>
                </div>
              </div>
              <div v-for="r in health.product.pbt.reasons" :key="r" class="ph-reason">{{ r }}</div>
              <div v-if="health.product.pbt.remediation" class="ph-remediation">
                <span class="ph-remediation-icon">→</span>
                <span class="ph-remediation-action">{{ health.product.pbt.remediation.action }}</span>
                <a v-if="health.product.pbt.remediation.url" :href="health.product.pbt.remediation.url" class="ph-remediation-link">{{ health.product.pbt.remediation.url }}</a>
              </div>
            </div>
          </div>
        </div>

        <!-- P0-F: Decision intelligence (developer×workflow×metric×cost) -->
        <div v-if="health.product.decision_intelligence" class="ph-card ph-card-wide">
          <div class="ph-card-header">
            <span class="ph-card-icon">🧠</span>
            <span class="ph-card-title">Decision Intelligence</span>
            <span class="ph-card-authority-tag" title="PARTIAL by design — never CLOSED/COMPLETE">PARTIAL</span>
          </div>
          <div :class="['ph-state-badge', `ph-state-${health.product.decision_intelligence.state.toLowerCase()}`]">
            {{ health.product.decision_intelligence.state }}
          </div>
          <div class="ph-decision-grid">
            <div class="ph-decision-dim">
              <span class="ph-decision-dim-label">Developer</span>
              <span :class="['ph-decision-dim-state', `ph-dim-${health.product.decision_intelligence.dimensions.developer_identity.toLowerCase()}`]">
                {{ health.product.decision_intelligence.dimensions.developer_identity }}
              </span>
            </div>
            <div class="ph-decision-dim">
              <span class="ph-decision-dim-label">Workflow</span>
              <span :class="['ph-decision-dim-state', `ph-dim-${health.product.decision_intelligence.dimensions.workflow.toLowerCase()}`]">
                {{ health.product.decision_intelligence.dimensions.workflow }}
              </span>
            </div>
            <div class="ph-decision-dim">
              <span class="ph-decision-dim-label">Metric</span>
              <span :class="['ph-decision-dim-state', `ph-dim-${health.product.decision_intelligence.dimensions.metric.toLowerCase()}`]">
                {{ health.product.decision_intelligence.dimensions.metric }}
              </span>
            </div>
            <div class="ph-decision-dim">
              <span class="ph-decision-dim-label">Cost</span>
              <span :class="['ph-decision-dim-state', `ph-dim-${health.product.decision_intelligence.dimensions.cost.toLowerCase()}`]">
                {{ health.product.decision_intelligence.dimensions.cost }}
              </span>
            </div>
          </div>
          <div v-if="health.product.decision_intelligence.invite_backed_sessions !== undefined" class="ph-card-metrics">
            <div class="ph-metric">
              <span class="ph-metric-label">Invite-backed</span>
              <span class="ph-metric-value">{{ health.product.decision_intelligence.invite_backed_sessions }}/{{ health.product.decision_intelligence.total_sessions }}</span>
            </div>
          </div>
          <div v-for="r in health.product.decision_intelligence.reasons" :key="r" class="ph-reason">{{ r }}</div>
          <div v-if="health.product.decision_intelligence.authority_note" class="ph-card-authority-note">
            {{ health.product.decision_intelligence.authority_note }}
          </div>
          <div v-if="health.product.decision_intelligence.remediation" class="ph-remediation">
            <span class="ph-remediation-icon">→</span>
            <span class="ph-remediation-action">{{ health.product.decision_intelligence.remediation.action }}</span>
            <a v-if="health.product.decision_intelligence.remediation.url" :href="health.product.decision_intelligence.remediation.url" class="ph-remediation-link">{{ health.product.decision_intelligence.remediation.url }}</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getPilotHealth, type PilotHealthResponse } from '../lib/api/pilotHealth'
import { parseTimestamp, formatLocalWithZone, humanizeFreshness } from '../lib/timestampUtils'

const health = ref<PilotHealthResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const notAvailable = ref(false)

async function fetchHealth() {
  loading.value = true
  error.value = null
  notAvailable.value = false
  try {
    health.value = await getPilotHealth()
  } catch (e: any) {
    if (e?.response?.status === 404) {
      notAvailable.value = true
    } else {
      error.value = e?.message || String(e)
    }
  } finally {
    loading.value = false
  }
}

// P0-B: Use the shared timestamp utility that correctly interprets all
// timestamps as UTC (regardless of Z suffix presence) and converts to
// browser-local time for display. This fixes the defect where a UTC
// value like "22:07" was displayed as "10:07 PM" (local) without
// conversion, making the event appear hours in the future.
function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return formatLocalWithZone(iso) || iso
}

// P0-E: Humanized freshness for display (e.g., "8 min ago", "2h ago").
// Falls back to the backend's freshness_human field if available.
function formatFreshness(iso: string | null | undefined, backendHuman: string | null | undefined): string {
  if (backendHuman) return backendHuman
  if (!iso) return '—'
  return humanizeFreshness(iso)
}

onMounted(() => {
  fetchHealth()
})
</script>

<style scoped>
.pilot-health-panel {
  max-width: 900px;
}

.ph-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.ph-header-title h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.ph-checked-at {
  font-size: 0.8rem;
  color: #6b7280;
  margin-left: 8px;
}

.ph-refresh-btn {
  padding: 6px 16px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #374151;
  cursor: pointer;
  font-size: 0.85rem;
  display: inline-flex;
  align-items: center;
}

.ph-spin-icon {
  animation: ph-spin 0.8s linear infinite;
}

.ph-refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ph-refresh-btn:hover:not(:disabled) {
  background: #f3f4f6;
}

.ph-loading {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 40px;
  color: #6b7280;
}

.ph-loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: ph-spin 0.8s linear infinite;
}

@keyframes ph-spin {
  to { transform: rotate(360deg); }
}

.ph-error {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
}

.ph-not-available {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.ph-not-available-icon {
  color: #64748b;
  font-size: 1.5rem;
  flex-shrink: 0;
}

.ph-not-available-title {
  font-weight: 600;
  color: #475569;
}

.ph-not-available-detail {
  font-size: 0.875rem;
  color: #64748b;
  margin-top: 4px;
}

.ph-error-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #ef4444;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  flex-shrink: 0;
}

.ph-error-body {
  flex: 1;
}

.ph-error-title {
  font-weight: 600;
  color: #991b1b;
}

.ph-error-detail {
  font-size: 0.85rem;
  color: #7f1d1d;
}

.ph-retry-btn {
  padding: 6px 14px;
  border: 1px solid #dc2626;
  border-radius: 6px;
  background: #fff;
  color: #dc2626;
  cursor: pointer;
}

.ph-severity-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  font-weight: 600;
}

.ph-severity-green {
  background: #d1fae5;
  color: #065f46;
}

.ph-severity-yellow {
  background: #fef3c7;
  color: #92400e;
}

.ph-severity-red {
  background: #fee2e2;
  color: #991b1b;
}

.ph-severity-label {
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.ph-severity-status {
  text-transform: capitalize;
}

.ph-severity-issues {
  margin-left: auto;
  font-size: 0.85rem;
  font-weight: 400;
}

.ph-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.ph-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 14px;
  background: #fff;
}

.ph-card-wide {
  grid-column: span 2;
}

.ph-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.ph-card-icon {
  font-size: 1.1rem;
}

.ph-card-title {
  font-weight: 600;
  font-size: 0.95rem;
}

.ph-state-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  margin-bottom: 8px;
  background: #e5e7eb;
  color: #374151;
}

.ph-state-healthy, .ph-state-up_to_date, .ph-state-connected, .ph-state-available, .ph-state-ok {
  background: #d1fae5;
  color: #065f46;
}

.ph-state-aging, .ph-state-mixed, .ph-state-login_only, .ph-state-partial, .ph-state-expiring_soon, .ph-state-warning, .ph-state-unknown {
  background: #fef3c7;
  color: #92400e;
}

.ph-state-stale, .ph-state-no_data, .ph-state-all_expired, .ph-state-outdated, .ph-state-not_connected, .ph-state-blocked, .ph-state-critical {
  background: #fee2e2;
  color: #991b1b;
}

.ph-card-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
}

.ph-metric {
  display: flex;
  flex-direction: column;
}

.ph-metric-label {
  font-size: 0.75rem;
  color: #6b7280;
}

.ph-metric-value {
  font-size: 0.9rem;
  font-weight: 600;
}

.ph-card-message {
  font-size: 0.8rem;
  color: #4b5563;
  line-height: 1.4;
}

.ph-card-empty {
  font-size: 0.85rem;
  color: #9ca3af;
  padding: 8px 0;
}

.ph-sources-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ph-source-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  padding: 4px 0;
  border-bottom: 1px solid #f3f4f6;
}

.ph-source-row:last-child {
  border-bottom: none;
}

.ph-source-name {
  font-weight: 600;
  min-width: 100px;
}

.ph-source-counts {
  color: #6b7280;
  flex: 1;
}

.ph-source-last {
  font-size: 0.75rem;
  color: #9ca3af;
}

.ph-product-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.ph-product-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ph-reason {
  font-size: 0.8rem;
  color: #6b7280;
  font-style: italic;
}

@media (max-width: 640px) {
  .ph-grid {
    grid-template-columns: 1fr;
  }
  .ph-card-wide {
    grid-column: span 1;
  }
  .ph-product-grid {
    grid-template-columns: 1fr;
  }
}

/* P0-C/P0-D: Authority tags and installation version display */
.ph-card-authority-tag {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  background: #fef3c7;
  color: #92400e;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.ph-card-authority-note {
  font-size: 0.75rem;
  color: #6b7280;
  font-style: italic;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid #f3f4f6;
}

/* CR-X Day 1B S2: Remediation contract rendering */
.ph-remediation {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin-top: 8px;
  padding: 8px 10px;
  background: #fef3c7;
  border-left: 3px solid #f59e0b;
  border-radius: 4px;
  font-size: 0.78rem;
}

.ph-remediation-icon {
  color: #d97706;
  font-weight: 700;
  flex-shrink: 0;
}

.ph-remediation-action {
  color: #78350f;
  flex: 1 1 auto;
  min-width: 200px;
}

.ph-remediation-link {
  color: #1d4ed8;
  text-decoration: none;
  font-size: 0.72rem;
  font-family: monospace;
  white-space: nowrap;
}

.ph-remediation-link:hover {
  text-decoration: underline;
}

.ph-installations-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0;
}

.ph-install-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  padding: 3px 0;
}

.ph-install-id {
  font-family: monospace;
  color: #6b7280;
}

.ph-install-status {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
}

.ph-install-current {
  background: #d1fae5;
  color: #065f46;
}

.ph-install-outdated {
  background: #fee2e2;
  color: #991b1b;
}

.ph-install-unknown {
  background: #e5e7eb;
  color: #374151;
}

.ph-install-version {
  font-weight: 600;
}

.ph-install-bridge {
  font-size: 0.65rem;
  padding: 1px 4px;
  border-radius: 3px;
  background: #dbeafe;
  color: #1e40af;
}

.ph-version-history {
  margin-top: 8px;
  font-size: 0.8rem;
}

.ph-version-history summary {
  cursor: pointer;
  color: #6b7280;
  font-size: 0.75rem;
}

/* P0-F: Decision intelligence dimensions */
.ph-decision-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin: 8px 0;
}

.ph-decision-dim {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.ph-decision-dim-label {
  font-size: 0.7rem;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.ph-decision-dim-state {
  font-size: 0.8rem;
  font-weight: 600;
  margin-top: 2px;
}

.ph-dim-available {
  color: #065f46;
}

.ph-dim-partial {
  color: #92400e;
}

.ph-dim-blocked {
  color: #991b1b;
}

.ph-dim-unknown {
  color: #6b7280;
}
</style>
