import api, { API_ENDPOINTS } from '../config/api'
import { GITHUB_DRILLDOWN_ENABLED, isSupportedGitHubMetric } from '../config/githubDrilldown'

export interface GitHubMetricDetailsResponse {
  metric: string
  total_count: number
  showing_count: number
  records: any[]
  reason: 'feature_disabled' | 'unsupported_metric' | 'api_error' | 'timeout' | 'rate_limit' | null
}

export interface GitHubMetricDetailParams {
  metric: string
  timeFilter?: string
  limit?: number
}

/**
 * Fetch detailed records for a GitHub metric
 * Only works when GitHub drilldown feature is enabled
 */
export async function fetchGitHubMetricDetails(params: GitHubMetricDetailParams): Promise<GitHubMetricDetailsResponse> {
  // Feature guard - return empty response if disabled
  if (!GITHUB_DRILLDOWN_ENABLED) {
    return {
      metric: params.metric,
      total_count: 0,
      showing_count: 0,
      records: [],
      reason: 'feature_disabled'
    }
  }

  // Validate metric is supported
  if (!isSupportedGitHubMetric(params.metric)) {
    return {
      metric: params.metric,
      total_count: 0,
      showing_count: 0,
      records: [],
      reason: 'unsupported_metric'
    }
  }

  // Retry logic for timeouts
  const maxRetries = 2
  let lastError: any = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const queryParams = new URLSearchParams({
        metric: params.metric,
        time_filter: params.timeFilter || 'week', // 🔥 PHASE C: Safety default - changed from 'all' to 'week'
        limit: String(params.limit || 50), // Reduced from 100 for better performance
        dev_mode: '1' // Development mode bypass for now
      })

      const url = `${API_ENDPOINTS.GITHUB_METRICS}?${queryParams}`
      console.log(`🔧 GitHub drilldown API call (attempt ${attempt}/${maxRetries}):`, { url, params })
      console.log('🔧 API base URL:', api.defaults.baseURL)
      
      // Add timeout-specific configuration for drilldown calls
      const response = await api.get(url, {
        timeout: 15000, // Reduced to 15 seconds for faster failure
      })
      
      // Defensive check for HTML responses (proxy mismatch)
      if (typeof response.data === 'string' && response.data.includes('<!doctype html>')) {
        console.error('🚨 Drilldown API returned HTML instead of JSON:', {
          requestedUrl: url,
          responsePreview: response.data.substring(0, 80),
          hint: 'Likely missing /api prefix or proxy mismatch'
        })
        return {
          metric: params.metric,
          total_count: 0,
          showing_count: 0,
          records: [],
          reason: 'api_error'
        }
      }
      
      console.log('🔧 GitHub drilldown API response:', response.data)
      return response.data
    } catch (error: any) {
      lastError = error
      console.error(`Failed to fetch GitHub metric details (attempt ${attempt}/${maxRetries}):`, error)
      
      // Don't retry on non-timeout errors
      if (error.code !== 'ECONNABORTED' && error.code !== 'ETIMEDOUT') {
        break
      }
      
      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000) // 1s, 2s, 4s max
        console.log(`🔄 Retrying GitHub drilldown API call in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  // Determine error reason based on final error
  let errorReason: 'api_error' | 'timeout' | 'rate_limit' = 'api_error'
  if (lastError?.code === 'ECONNABORTED' || lastError?.code === 'ETIMEDOUT') {
    errorReason = 'timeout'
  } else if (lastError?.response?.status === 429) {
    errorReason = 'rate_limit'
  }

  console.error('All GitHub drilldown API attempts failed:', {
    attempts: maxRetries,
    finalError: {
      message: lastError?.message,
      code: lastError?.code,
      status: lastError?.response?.status,
      statusText: lastError?.response?.statusText,
      data: lastError?.response?.data
    }
  })
  
  // Return safe error response
  return {
    metric: params.metric,
    total_count: 0,
    showing_count: 0,
    records: [],
    reason: errorReason
  }
}
