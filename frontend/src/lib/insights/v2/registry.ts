import type { V2PrimitiveRegistry, PrimitiveSpec } from './types';

// README (enablement):
// PI v2 primitives run in shadow mode only. Enable with either:
// - add `?v2=1` to the URL
// - set `localStorage.cm_insights_v2 = 'true'`
// When enabled, v2 results are published to `window.__CM_PI_V2__` and logged to console.

const specs: PrimitiveSpec[] = [
  {
    name: 'session_duration_minutes',
    level: 'session',
    requiredFields: ['sessions.duration_ms'],
    nullabilityRules: 'Null if duration_ms missing or <= 0.',
  },
  {
    name: 'session_ttfc_minutes',
    level: 'session',
    requiredFields: ['sessions.time_to_first_commit_ms'],
    nullabilityRules: 'Null if time_to_first_commit_ms is null/<=0.',
  },
  {
    name: 'session_has_ttfc',
    level: 'session',
    requiredFields: ['sessions.time_to_first_commit_ms'],
    nullabilityRules: 'Boolean; true when time_to_first_commit_ms > 0.',
  },
  {
    name: 'session_ai_burst_count',
    level: 'session',
    requiredFields: ['sessions.ai_burst_count'],
    nullabilityRules: 'Null if ai_burst_count is missing; else numeric (can be 0).',
  },
  {
    name: 'session_ai_active_span_minutes',
    level: 'session',
    requiredFields: ['sessions.ai_active_span_ms'],
    nullabilityRules: 'Null if ai_active_span_ms is null/<=0.',
  },
  {
    name: 'session_ai_chars_per_min',
    level: 'session',
    requiredFields: ['sessions.ai_chars_per_min'],
    nullabilityRules: 'Null if ai_chars_per_min is null/<=0.',
  },
  {
    name: 'session_ai_burst_chars_total',
    level: 'session',
    requiredFields: ['sessions.ai_burst_chars_total'],
    nullabilityRules: 'Null if ai_burst_chars_total missing; else numeric (can be 0).',
  },
  {
    name: 'session_ai_first_burst_minutes',
    level: 'session',
    requiredFields: ['sessions.duration_ms', 'sessions.ai_first_burst_at_ms'],
    nullabilityRules: 'Null if duration_ms missing or ai_first_burst_at_ms missing. Computed as ai_first_burst_at_ms / 60000.',
  },
  {
    name: 'session_ai_last_burst_ratio',
    level: 'session',
    requiredFields: ['sessions.duration_ms', 'sessions.ai_last_burst_at_ms'],
    nullabilityRules: 'Null if duration_ms missing or ai_last_burst_at_ms missing. Computed as ai_last_burst_at_ms / duration_ms.',
  },
  {
    name: 'session_ai_span_ratio',
    level: 'session',
    requiredFields: ['sessions.duration_ms', 'sessions.ai_active_span_ms'],
    nullabilityRules: 'Null if duration_ms missing or ai_active_span_ms missing. Computed as ai_active_span_ms / duration_ms.',
  },
  {
    name: 'session_has_ai_activity',
    level: 'session',
    requiredFields: ['sessions.ai_burst_count', 'sessions.ai_burst_chars_total', 'sessions.ai_chars_per_min'],
    nullabilityRules: 'Boolean; true if any of (ai_burst_count>0, ai_burst_chars_total>0, ai_chars_per_min>0).',
  },
  {
    name: 'session_focus_ratio',
    level: 'session',
    requiredFields: ['sessions.focus_ratio'],
    nullabilityRules: 'Null if focus_ratio missing or outside [0,1].',
  },
  {
    name: 'session_rework_ratio_est',
    level: 'session',
    requiredFields: ['sessions.rework_ratio_est'],
    nullabilityRules: 'Null if rework_ratio_est missing or <0.',
  },
  {
    name: 'session_active_coding_duration_minutes',
    level: 'session',
    requiredFields: ['sessions.active_coding_duration_ms'],
    nullabilityRules: 'Null if active_coding_duration_ms missing or <=0.',
  },
  {
    name: 'session_flow_profile',
    level: 'session',
    requiredFields: ['sessions.flow_profile'],
    nullabilityRules: 'Null if flow_profile missing.',
  },
  {
    name: 'tool_flow_profile_distribution',
    level: 'tool',
    requiredFields: ['sessions.tool', 'sessions.flow_profile'],
    nullabilityRules: 'Null if tool missing; bucket as other. Requires >= 10 sessions per tool for stable distribution.',
    minSampleSizeRules: 'n>=10 sessions per tool to report shares.',
  },
  {
    name: 'org_ttfc_p90_p50_ratio',
    level: 'org',
    requiredFields: ['sessions.time_to_first_commit_ms'],
    nullabilityRules: 'Null if fewer than 8 sessions have ttfc.',
    minSampleSizeRules: 'p50/p90 require n>=8 sessions with ttfc.',
  },
  {
    name: 'tool_ai_chars_per_min_distribution',
    level: 'tool',
    requiredFields: ['sessions.tool', 'sessions.ai_chars_per_min'],
    nullabilityRules: 'Null if ai_chars_per_min missing; requires >= 10 sessions per tool with ai_chars_per_min>0.',
    minSampleSizeRules: 'p50/p90 require n>=10 per tool.',
  },
  {
    name: 'org_rework_ratio_distribution',
    level: 'org',
    requiredFields: ['sessions.rework_ratio_est'],
    nullabilityRules: 'Null if fewer than 10 sessions have rework_ratio_est.',
    minSampleSizeRules: 'p50/p90 require n>=10.',
  },
];

export function getV2PrimitiveRegistry(): V2PrimitiveRegistry {
  const specByName: Record<string, PrimitiveSpec> = {};
  for (const s of specs) {
    specByName[s.name] = s;
  }
  return { specs, specByName };
}
