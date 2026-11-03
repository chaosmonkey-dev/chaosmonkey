/**
 * Universal "MAX VALUE MODE" Configuration
 * 
 * Single source of truth for Performance Insights value optimization.
 * Used by BOTH engine and widget to ensure consistent limits and prioritization.
 * 
 * Why this exists:
 * - Widget had hard-coded caps that overrode engine's Value Mode limits
 * - Rules were being silently suppressed without visibility
 * - No unified contract for "what makes an insight valuable"
 * 
 * What changed:
 * - Centralized config ensures engine and widget use same limits
 * - Prioritizes diagnostics (telemetry/repo/tool) over summaries
 * - Relaxes diversity constraints to allow more unique insights
 * - Enforces minimum diagnostics per stage when candidates exist
 */

export interface PIValueConfig {
  // Stage limits
  stageLimit: number;
  totalLimit: number;
  
  // Summary constraints
  maxSummariesPerStage: number;
  
  // Diagnostic guarantees
  minDiagnosticsPerStage: number;
  minTelemetryDiagnosticsGlobal: number;
  minRepoDiagnosticsGlobal: number;
  
  // Diversity/selection
  maxPerMetric: number;
  dedupeMode: 'stage-aware' | 'strict';
  
  // Guard relaxation (value mode only)
  allowMinLen1: boolean;
  bypassPValueForSmallN: boolean;
  minNForPValue: number;
  relaxedMinAbsR: number;
}

/**
 * Default Value Mode configuration
 * Optimizes for perceived value and coverage, not conservative stats purity
 */
export const DEFAULT_VALUE_CONFIG: PIValueConfig = {
  stageLimit: 6,
  totalLimit: 18,
  maxSummariesPerStage: 2,
  minDiagnosticsPerStage: 2,
  minTelemetryDiagnosticsGlobal: 2,
  minRepoDiagnosticsGlobal: 1,
  maxPerMetric: 3,
  dedupeMode: 'stage-aware',
  allowMinLen1: true,
  bypassPValueForSmallN: true,
  minNForPValue: 8,
  relaxedMinAbsR: 0.3
};

/**
 * Standard (non-value) mode configuration
 * More conservative, production-ready limits
 */
export const STANDARD_CONFIG: PIValueConfig = {
  stageLimit: 4,
  totalLimit: 16,
  maxSummariesPerStage: 2,
  minDiagnosticsPerStage: 1,
  minTelemetryDiagnosticsGlobal: 0,
  minRepoDiagnosticsGlobal: 0,
  maxPerMetric: 2,
  dedupeMode: 'strict',
  allowMinLen1: false,
  bypassPValueForSmallN: false,
  minNForPValue: 4,
  relaxedMinAbsR: 0.6
};

/**
 * Get active configuration based on environment
 */
export function getValueConfig(): PIValueConfig {
  const valueMode = ((import.meta as any).env?.VITE_PI_VALUE_MODE ?? '0') === '1';
  
  if (!valueMode) {
    return STANDARD_CONFIG;
  }
  
  // Value Mode with optional overrides
  return {
    stageLimit: Number((import.meta as any).env?.VITE_PI_STAGE_LIMIT ?? DEFAULT_VALUE_CONFIG.stageLimit),
    totalLimit: Number((import.meta as any).env?.VITE_PI_TOTAL_LIMIT ?? DEFAULT_VALUE_CONFIG.totalLimit),
    maxSummariesPerStage: Number((import.meta as any).env?.VITE_PI_MAX_SUMMARIES_PER_STAGE ?? DEFAULT_VALUE_CONFIG.maxSummariesPerStage),
    minDiagnosticsPerStage: Number((import.meta as any).env?.VITE_PI_MIN_DIAGNOSTICS_PER_STAGE ?? DEFAULT_VALUE_CONFIG.minDiagnosticsPerStage),
    minTelemetryDiagnosticsGlobal: Number((import.meta as any).env?.VITE_PI_MIN_TELEMETRY_DIAGNOSTICS ?? DEFAULT_VALUE_CONFIG.minTelemetryDiagnosticsGlobal),
    minRepoDiagnosticsGlobal: Number((import.meta as any).env?.VITE_PI_MIN_REPO_DIAGNOSTICS ?? DEFAULT_VALUE_CONFIG.minRepoDiagnosticsGlobal),
    maxPerMetric: Number((import.meta as any).env?.VITE_PI_MAX_PER_METRIC ?? DEFAULT_VALUE_CONFIG.maxPerMetric),
    dedupeMode: ((import.meta as any).env?.VITE_PI_DEDUPE_MODE ?? DEFAULT_VALUE_CONFIG.dedupeMode) as 'stage-aware' | 'strict',
    allowMinLen1: ((import.meta as any).env?.VITE_PI_ALLOW_MIN_LEN_1 ?? '1') === '1',
    bypassPValueForSmallN: ((import.meta as any).env?.VITE_PI_BYPASS_P_VALUE ?? '1') === '1',
    minNForPValue: Number((import.meta as any).env?.VITE_PI_MIN_N_FOR_P_VALUE ?? DEFAULT_VALUE_CONFIG.minNForPValue),
    relaxedMinAbsR: Number((import.meta as any).env?.VITE_PI_RELAXED_MIN_ABS_R ?? DEFAULT_VALUE_CONFIG.relaxedMinAbsR)
  };
}

/**
 * Check if Value Mode is enabled
 */
export function isValueMode(): boolean {
  return ((import.meta as any).env?.VITE_PI_VALUE_MODE ?? '0') === '1';
}

/**
 * Adaptive minPoints for Value Mode
 * In Value Mode: allows 2 periods minimum (or 1 if that's all available, for insufficient-history diagnostic)
 * In Standard Mode: uses defaultMin (strict)
 */
export function valueModeMinPoints(defaultMin: number, availableN: number): number {
  if (!isValueMode()) {
    return defaultMin;
  }
  // Value Mode: allow 2 if possible, else 1 (for insufficient-history diagnostic)
  return Math.min(defaultMin, Math.max(2, Math.min(availableN, 3)));
}

/**
 * Check if we have enough data for trend analysis
 */
export function hasEnoughForTrend(n: number, defaultMin: number): boolean {
  if (!isValueMode()) {
    return n >= defaultMin;
  }
  return n >= 2; // Value Mode: 2 periods is enough for basic trend
}

/**
 * Check if data is sparse (used for copy/severity adjustments)
 */
export function isSparse(n: number): boolean {
  return n < 3;
}

/**
 * Pick first available number field from object
 * Returns { keyUsed: string | null, value: number | null }
 * Used to handle SHAPE_MISMATCH when alternate field names exist
 */
export function pickFirstNumberField(
  obj: any,
  keys: string[]
): { keyUsed: string | null; value: number | null } {
  for (const key of keys) {
    const val = obj?.[key];
    if (val !== undefined && val !== null && typeof val === 'number' && isFinite(val)) {
      return { keyUsed: key, value: val };
    }
  }
  return { keyUsed: null, value: null };
}
