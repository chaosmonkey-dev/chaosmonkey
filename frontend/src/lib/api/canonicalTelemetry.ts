/**
 * Canonical Telemetry API Fetcher
 *
 * Single fetch layer for the canonical telemetry endpoint (/api/telemetry/canonical)
 * Provides typed methods for sessions and aggregated formats with shared query building,
 * error handling, and response validation.
 *
 * See: docs/final/telemetry-canonical-design.md
 */

import api from '../../config/api';
import type {
  CanonicalTelemetryQueryParams,
  CanonicalTelemetrySessionsResponse,
  CanonicalTelemetryAggregatedResponse,
} from '../../types/canonicalTelemetry';

/**
 * Build query string from params object
 */
function buildQueryString(params: Record<string, any>): string {
  const searchParams = new URLSearchParams();
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  });
  
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

/**
 * Validate canonical telemetry response structure
 */
function validateCanonicalResponse(response: any, format: 'sessions' | 'aggregated'): boolean {
  if (!response || typeof response !== 'object') {
    console.error('[CanonicalTelemetry] Invalid response: not an object');
    return false;
  }

  if (!Array.isArray(response.data)) {
    console.error('[CanonicalTelemetry] Invalid response: data is not an array');
    return false;
  }

  if (!response.metadata || typeof response.metadata !== 'object') {
    console.error('[CanonicalTelemetry] Invalid response: metadata is missing or not an object');
    return false;
  }

  const requiredMetadataFields = [
    'canonical_population_count',
    'session_count_by_tool',
    'time_range',
    'tools_in_population',
    'filters_applied',
    'query_hash',
    'source_table',
    'generated_at',
  ];

  for (const field of requiredMetadataFields) {
    if (!(field in response.metadata)) {
      console.error(`[CanonicalTelemetry] Invalid response: missing metadata field: ${field}`);
      return false;
    }
  }

  if (format === 'sessions') {
    const sessionsMetadataFields = ['page', 'per_page', 'total_pages', 'format'];
    for (const field of sessionsMetadataFields) {
      if (!(field in response.metadata)) {
        console.error(`[CanonicalTelemetry] Invalid response: missing sessions metadata field: ${field}`);
        return false;
      }
    }
  }

  if (format === 'aggregated') {
    const aggregatedMetadataFields = ['tools_returned', 'periods_returned', 'period', 'format'];
    for (const field of aggregatedMetadataFields) {
      if (!(field in response.metadata)) {
        console.error(`[CanonicalTelemetry] Invalid response: missing aggregated metadata field: ${field}`);
        return false;
      }
    }
  }

  return true;
}

/**
 * Handle API errors with consistent error reporting
 */
function handleApiError(error: any, context: string): never {
  if (error.response) {
    // Server responded with error status
    console.error(`[CanonicalTelemetry] ${context} - Server error:`, {
      status: error.response.status,
      data: error.response.data,
    });
    throw new Error(`API error ${error.response.status}: ${error.response.data?.message || 'Unknown error'}`);
  } else if (error.request) {
    // Request made but no response
    console.error(`[CanonicalTelemetry] ${context} - Network error:`, error.message);
    throw new Error(`Network error: ${error.message}`);
  } else {
    // Error in request setup
    console.error(`[CanonicalTelemetry] ${context} - Request error:`, error.message);
    throw new Error(`Request error: ${error.message}`);
  }
}

/**
 * Fetch canonical telemetry in sessions format
 *
 * @param params - Query parameters for the canonical endpoint
 * @returns Canonical telemetry sessions response
 */
export async function getCanonicalSessions(
  params: Omit<CanonicalTelemetryQueryParams, 'format' | 'period'> & { format?: 'sessions' }
): Promise<CanonicalTelemetrySessionsResponse> {
  const queryParams: CanonicalTelemetryQueryParams = {
    ...params,
    format: 'sessions',
    period: undefined,
  };

  const queryString = buildQueryString(queryParams);
  const url = `/api/telemetry/canonical${queryString}`;

  if (import.meta.env.DEV) console.log('[CANONICAL_REQUEST] purpose=AIOI_AGGREGATE', { from: queryParams.from, to: queryParams.to, period: queryParams.period, toolIds: queryParams.tool_ids })

  try {
    const response = await api.get(url);
    
    if (!validateCanonicalResponse(response.data, 'sessions')) {
      throw new Error('Invalid canonical sessions response structure');
    }

    return response.data as CanonicalTelemetrySessionsResponse;
  } catch (error) {
    handleApiError(error, 'getCanonicalSessions');
  }
}

/**
 * Fetch canonical telemetry in aggregated format
 *
 * @param params - Query parameters for the canonical endpoint
 * @returns Canonical telemetry aggregated response
 */
export async function getCanonicalAggregated(
  params: Omit<CanonicalTelemetryQueryParams, 'format'> & { format?: 'aggregated'; period: 'day' | 'week' | 'month' }
): Promise<CanonicalTelemetryAggregatedResponse> {
  const queryParams: CanonicalTelemetryQueryParams = {
    ...params,
    format: 'aggregated',
  };

  const queryString = buildQueryString(queryParams);
  const url = `/api/telemetry/canonical${queryString}`;

  if (import.meta.env.DEV) console.log('[CANONICAL_REQUEST] purpose=AIOI_AGGREGATE', { from: queryParams.from, to: queryParams.to, period: queryParams.period, toolIds: queryParams.tool_ids })

  try {
    const response = await api.get(url);
    
    if (!validateCanonicalResponse(response.data, 'aggregated')) {
      throw new Error('Invalid canonical aggregated response structure');
    }

    return response.data as CanonicalTelemetryAggregatedResponse;
  } catch (error) {
    handleApiError(error, 'getCanonicalAggregated');
  }
}

/**
 * Build canonical telemetry query parameters with defaults
 *
 * @param overrides - Optional parameter overrides
 * @returns Complete query parameters with defaults applied
 */
export function buildCanonicalQueryParams(
  overrides: Partial<CanonicalTelemetryQueryParams> = {}
): CanonicalTelemetryQueryParams {
  const defaults: Partial<CanonicalTelemetryQueryParams> = {
    format: 'sessions',
    page: 1,
    per_page: 200,
    include_raw_metadata: false,
  };

  return { ...defaults, ...overrides } as CanonicalTelemetryQueryParams;
}

/**
 * Convenience method to fetch canonical telemetry with automatic format detection
 *
 * @param params - Query parameters (format will be auto-detected if not specified)
 * @returns Canonical telemetry response (sessions or aggregated)
 */
export async function getCanonicalTelemetry(
  params: CanonicalTelemetryQueryParams
): Promise<CanonicalTelemetrySessionsResponse | CanonicalTelemetryAggregatedResponse> {
  if (params.format === 'aggregated') {
    return getCanonicalAggregated(params as any);
  } else {
    return getCanonicalSessions(params as any);
  }
}
