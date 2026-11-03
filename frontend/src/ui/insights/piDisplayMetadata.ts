/**
 * PI Display Metadata Mapping
 * 
 * Maps Performance Insight IDs and evidence labels to display metadata
 * for consistent formatting across all UI components.
 */

import { PIValueMeta, getPI_METADATA } from './piValueFormatter'

/**
 * Extended metadata mapping for all PI types
 */
export const PI_DISPLAY_METADATA: Record<string, PIValueMeta> = {
  // Plan & Code PI IDs
  'commits-per-session-by-ide': {
    kind: 'ratio',
    denominatorLabel: 'session',
    precision: 1
  },
  'active-coding-time-by-ide': {
    kind: 'duration',
    unit: 'min per session',
    precision: 1
  },
  'ai-suggestions-accepted-by-ide': {
    kind: 'ratio',
    denominatorLabel: 'session',
    precision: 1
  },
  'delivery-rate-ai-vs-non-ai': {
    kind: 'ratio',
    denominatorLabel: 'session',
    precision: 1
  },
  'average-session-length-by-ide': {
    kind: 'duration',
    unit: 'min per session',
    precision: 1
  },
  'time-to-first-commit-by-ide': {
    kind: 'duration',
    unit: 'min',
    precision: 1,
    labelPrefix: 'TTFC'
  },
  'rework-rate-by-ide': {
    kind: 'percent',
    precision: 1
  },
  
  // Review & Merge PI IDs
  'session-conditioned-pr-cycle-time-ai-vs-non-ai': {
    kind: 'duration',
    unit: 'hrs',
    precision: 1
  },
  'branch-stagnation-risk-ai-vs-non-ai': {
    kind: 'percent',
    precision: 1
  },
  'session-conditioned-change-risk-ai-vs-non-ai': {
    kind: 'percent',
    precision: 1
  },
  'revert-rate-by-ide': {
    kind: 'percent',
    precision: 1
  },
  'review-latency-spike-by-ide': {
    kind: 'duration',
    unit: 'hrs',
    precision: 1
  },
  'pr-review-cycles-by-ide': {
    kind: 'cycles',
    precision: 0
  },
  'reviewer-load-concentration': {
    kind: 'count',
    unit: 'PRs',
    precision: 0
  },
  'reopen-pressure-spike': {
    kind: 'percent',
    precision: 1
  },
  'large-pr-mix-risk': {
    kind: 'percent',
    precision: 1
  },
  
  // Deploy & Operate PI IDs
  'deployment-frequency-volatility-by-ide': {
    kind: 'rate',
    denominatorLabel: 'week',
    precision: 1
  },
  'change-failure-rate-spike-by-ide': {
    kind: 'percent',
    precision: 1
  },
  'delivery-velocity-by-workflow': {
    kind: 'duration',
    unit: 'hrs',
    precision: 1
  },
  'mttr-by-ide': {
    kind: 'duration',
    unit: 'hrs',
    precision: 1
  },
  'fast-but-unstable-org': {
    kind: 'percent',
    precision: 1
  },
  'stale-deployment-signal': {
    kind: 'duration',
    unit: 'hrs',
    precision: 1
  },
  'failed-deployment-pressure': {
    kind: 'percent',
    precision: 1
  },
  'latest-deployment-unhealthy': {
    kind: 'score',
    range: '0-1',
    precision: 2
  },
  
  // Telemetry PIs
  'telemetry-session-quality-regression': {
    kind: 'score',
    range: '0-1',
    precision: 2
  },
  'telemetry-ai-focus-imbalance': {
    kind: 'percent',
    precision: 1
  },
  'telemetry-remote-workspace-drag': {
    kind: 'duration',
    unit: 'min',
    precision: 1
  },
  'telemetry-session-idle-time': {
    kind: 'percent',
    precision: 1
  }
}

/**
 * Evidence label to metadata mapping
 */
export const EVIDENCE_LABEL_METADATA: Record<string, PIValueMeta> = {
  // Common evidence labels
  'coverage': {
    kind: 'percent',
    precision: 1
  },
  'sample size': {
    kind: 'count',
    unit: 'sessions',
    precision: 0
  },
  'sessions': {
    kind: 'count',
    unit: 'sessions',
    precision: 0
  },
  'periods': {
    kind: 'count',
    unit: 'periods',
    precision: 0
  },
  'weeks': {
    kind: 'count',
    unit: 'weeks',
    precision: 0
  },
  'confidence': {
    kind: 'score',
    range: '0-1',
    precision: 2
  },
  'correlation': {
    kind: 'ratio',
    precision: 2
  },
  'attempts': {
    kind: 'count',
    unit: 'attempts',
    precision: 1
  },
  'resolution time': {
    kind: 'duration',
    unit: 's',
    precision: 1
  },
  'cycle time': {
    kind: 'duration',
    unit: 'hrs',
    precision: 1
  },
  'deploy frequency': {
    kind: 'rate',
    denominatorLabel: 'week',
    precision: 1
  },
  'cfr': {
    kind: 'percent',
    precision: 1
  },
  'change failure rate': {
    kind: 'percent',
    precision: 1
  },
  'ai usage rate': {
    kind: 'rate',
    denominatorLabel: 'min',
    precision: 2
  },
  'coding time': {
    kind: 'duration',
    unit: 'min',
    precision: 0
  },
  'ai assists': {
    kind: 'count',
    unit: 'assists',
    precision: 0
  },
  'data points': {
    kind: 'count',
    unit: 'points',
    precision: 0
  },
  'stddev': {
    kind: 'ratio',
    precision: 1
  },
  'cv': {
    kind: 'ratio',
    precision: 2
  },
  'efficiency': {
    kind: 'ratio',
    precision: 2
  },
  'time range': {
    kind: 'count',
    unit: 'weeks',
    precision: 0
  },
  
  // IDE-specific values
  'cursor': {
    kind: 'percent',
    precision: 1
  },
  'windsurf': {
    kind: 'percent',
    precision: 1
  },
  'vscode': {
    kind: 'percent',
    precision: 1
  },
  'jetbrains': {
    kind: 'percent',
    precision: 1
  },
  
  // Specific metric patterns
  'poor focus': {
    kind: 'percent',
    precision: 1
  },
  'rework ratio': {
    kind: 'percent',
    precision: 1
  },
  'unresolved context': {
    kind: 'percent',
    precision: 1
  },
  'org': {
    kind: 'percent',
    precision: 1
  }
}

/**
 * Get display metadata for a PI by ID
 */
export function getPIDisplayMetadata(piId: string): PIValueMeta {
  return PI_DISPLAY_METADATA[piId] || getPI_METADATA(piId) || {}
}

/**
 * Get display metadata for an evidence label
 */
export function getEvidenceDisplayMetadata(label: string): PIValueMeta {
  const normalizedLabel = label.toLowerCase().trim()
  
  // Try exact match first
  if (EVIDENCE_LABEL_METADATA[normalizedLabel]) {
    return EVIDENCE_LABEL_METADATA[normalizedLabel]
  }
  
  // Try pattern matching
  for (const [key, metadata] of Object.entries(EVIDENCE_LABEL_METADATA)) {
    if (normalizedLabel.includes(key) || key.includes(normalizedLabel)) {
      return metadata
    }
  }
  
  // Fallback to generic metadata
  return getPI_METADATA(normalizedLabel)
}

/**
 * Get display metadata with fallback logic
 */
export function getDisplayMetadata(
  piId?: string,
  evidenceLabel?: string,
  fallback?: PIValueMeta
): PIValueMeta {
  // Try PI ID first
  if (piId) {
    const piMetadata = getPIDisplayMetadata(piId)
    if (Object.keys(piMetadata).length > 0) {
      return piMetadata
    }
  }
  
  // Try evidence label
  if (evidenceLabel) {
    const evidenceMetadata = getEvidenceDisplayMetadata(evidenceLabel)
    if (Object.keys(evidenceMetadata).length > 0) {
      return evidenceMetadata
    }
  }
  
  // Use fallback or default
  return fallback || { kind: 'count', precision: 1 }
}
