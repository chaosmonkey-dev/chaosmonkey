/**
 * Pilot Health API Fetcher
 *
 * Single fetch layer for the pilot health endpoint (/api/pilot/health).
 * Returns a read-only operational health snapshot for the current org.
 *
 * Backend: PilotHealthController::show()
 */

import api from '../../config/api';

export interface PilotHealthActiveSource {
  editor_source: string;
  event_count: number;
  session_count: number;
  last_seen: string | null;
  last_seen_timezone?: string;
}

export interface PilotHealthInstallation {
  installation_id: string;
  latest_version: string;
  canonical_version: string;
  status: 'CURRENT' | 'OUTDATED' | 'UNKNOWN';
  is_bridge: boolean;
  last_seen: string | null;
  last_seen_timezone?: string;
}

// CR-X Day 1B S2: Remediation contract — actionable next action for degraded/warning states.
// Null for healthy states. Only implemented Local routes/actions are referenced.
// url = browser-navigable GET URL (page or download); null for API mutation endpoints.
export interface PilotHealthRemediation {
  action: string;
  url: string | null;
  runbook_ref: string | null;
}

export interface PilotHealthResponse {
  status: string;
  severity: string;
  checked_at: string;
  checked_at_timezone?: string;
  organization: {
    id: number;
    slug: string | null;
    name: string | null;
  };
  sections?: Record<string, string>;
  telemetry: {
    state: string;
    latest_event_at: string | null;
    latest_event_timezone?: string;
    event_count: number;
    session_count: number;
    freshness_hours: number | null;
    freshness_human?: string | null;
    freshness_threshold_hours: number;
    stale_threshold_hours: number;
    message: string;
    remediation?: PilotHealthRemediation | null;
  };
  extension: {
    state: string;
    expected_versions: string[];
    observed_versions: Array<{
      version: string;
      event_count: number;
      last_seen: string;
      last_seen_timezone?: string;
    }>;
    installations?: PilotHealthInstallation[];
    installation_summary?: {
      total: number;
      current: number;
      outdated: number;
    };
    authority_note?: string;
    message: string;
    remediation?: PilotHealthRemediation | null;
  };
  active_sources: PilotHealthActiveSource[];
  active_sources_authority_note?: string;
  installations: {
    telemetry_installations: number;
    token_installations: number;
    message: string;
  };
  identity_coverage: {
    person_level_identity_coverage: 'AVAILABLE' | 'UNAVAILABLE';
    total_identities: number;
    invite_backed: number;
    total_developers: number | null;
    legacy_or_unknown: number;
    unresolved_identity_classes: string[];
    invite_backed_coverage_pct: number | null;
    message: string;
    remediation?: PilotHealthRemediation | null;
  };
  repository_attribution: {
    events_with_repo: number;
    total_events: number;
    attribution_coverage_pct: number;
    distinct_repos: number;
    message: string;
    remediation?: PilotHealthRemediation | null;
  };
  github_engineering_evidence: {
    state: string;
    login_connected: boolean;
    engineering_evidence_eligible: boolean;
    token_purposes: string[];
    historical_evidence_available: boolean;
    message: string;
    remediation?: PilotHealthRemediation | null;
  };
  auth_credentials: {
    state: string;
    active_tokens: number;
    expired_tokens: number;
    expiring_within_7d: number;
    message: string;
    remediation?: PilotHealthRemediation | null;
  };
  // CR-X Day 2 X3: failure-state expansion
  connect_code_expiry?: {
    state: string;
    expired_unredeemed: number;
    expiring_within_7d: number;
    total_unredeemed: number;
    message: string;
    remediation?: PilotHealthRemediation | null;
  };
  installation_failures?: {
    state: string;
    failure_count: number;
    latest_failure_at: string | null;
    message: string;
    remediation?: PilotHealthRemediation | null;
  };
  cost: {
    state: string;
    authority: string;
    reason_code: string;
    message: string;
    configured_count?: number;
    total_monthly_spend?: number;
    remediation?: PilotHealthRemediation | null;
  };
  product: {
    pi: {
      state: string;
      observable_sessions: number;
      observable_workflows: number;
      reasons: string[];
      remediation?: PilotHealthRemediation | null;
    };
    pbt: {
      state: string;
      observable_sessions: number;
      observable_workflows: number;
      comparison_available: boolean;
      reasons: string[];
      remediation?: PilotHealthRemediation | null;
    };
    decision_intelligence?: {
      state: 'BLOCKED' | 'PARTIAL' | 'AVAILABLE' | 'UNKNOWN';
      dimensions: {
        developer_identity: string;
        workflow: string;
        metric: string;
        cost: string;
      };
      invite_backed_sessions?: number;
      total_sessions?: number;
      reasons: string[];
      authority_note?: string;
      remediation?: PilotHealthRemediation | null;
    };
  };
}

/**
 * Fetch the pilot health snapshot for the current org.
 */
export async function getPilotHealth(): Promise<PilotHealthResponse> {
  const response = await api.get('/api/pilot/health');
  return response.data as PilotHealthResponse;
}
