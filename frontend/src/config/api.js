/**
 * @typedef {import('axios').AxiosInstance} AxiosInstance
 * @typedef {Object.<string, string>} ApiEndpoints
 */

import axios from 'axios'

/**
 * Centralized API Configuration
 *
 * IMPORTANT:
 * All API calls must use API_URL or API_ENDPOINTS.
 *
 * Do NOT hardcode:
 * - /api/
 * - localhost
 * - EC2 IPs
 * - import.meta.env directly in components
 */

// Use configurable API base URL from environment.
// In dev, fall back to local backend. In production, use same-origin.
// Strip trailing slash AND trailing /api to prevent /api/api double-prefix.
const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL || window.location.origin)
    .replace(/\/$/, "")
    .replace(/\/api$/, "");

export const API_URL = `${BASE_URL}/api`;

export const API_ENDPOINTS = {
  TELEMETRY: `${API_URL}/telemetry`,
  METRICS: `${API_URL}/metrics`,
  REPOSITORIES: `${API_URL}/repositories`,
  DEVELOPERS: `${API_URL}/developers`,
  PRODUCTIVITY_SUMMARY: `${API_URL}/productivity/summary`,
  PRODUCTIVITY_TRENDS: `${API_URL}/productivity/trends`,
  IDE_STATUS: `${API_URL}/ide/status`,
  IDE_CONNECT: `${API_URL}/ide/connect`,
  IDE_DISCONNECT: `${API_URL}/ide/disconnect`,
  IDE_AUTHENTICATE: `${API_URL}/ide/authenticate`,
  IDE_COLLECT_TELEMETRY: `${API_URL}/ide/collect-telemetry`,
  CLEAR_DATA: `${API_URL}/clear-data`,
  TELEMETRY_UPLOAD: `${API_URL}/telemetry/upload`,
  TELEMETRY_SESSIONS: `${API_URL}/telemetry/sessions`,
  GITHUB_SETUP: `${API_URL}/github/setup`,
  GITHUB_TEST_CONNECTION: `${API_URL}/github/test-connection`,
  GITHUB_OAUTH_STATUS: `${API_URL}/github/oauth/status`,
  GITHUB_OAUTH_REDIRECT: `${API_URL}/github/oauth/redirect`,
  GITHUB_OAUTH_REVOKE: `${API_URL}/github/oauth/revoke`,
  GITHUB_METRICS: `${API_URL}/github/metric-details`,
  PILOT_HEALTH: `${API_URL}/pilot/health`,
};

// ============================================================================
// P0-G Part F: Typed Auth Error Contract
// ============================================================================
// Distinguishes auth errors from empty data and network failures.
// Downstream code MUST NOT flatten these into generic empty states.
// ============================================================================

export const AuthErrorType = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',       // 401 — token expired or invalid
  ACCESS_DENIED: 'ACCESS_DENIED',       // 403 — authenticated but not authorized
  SERVER_UNAVAILABLE: 'SERVER_UNAVAILABLE', // 5xx or network error
}

export class AuthError extends Error {
  constructor(type, status, message) {
    super(message)
    this.type = type
    this.status = status
    this.name = 'AuthError'
  }

  isAuthRequired() { return this.type === AuthErrorType.AUTH_REQUIRED }
  isAccessDenied() { return this.type === AuthErrorType.ACCESS_DENIED }
  isServerUnavailable() { return this.type === AuthErrorType.SERVER_UNAVAILABLE }
}

/**
 * Classify an HTTP status code into an AuthErrorType or null (success).
 */
export function classifyHttpStatus(status) {
  if (status === 401) return AuthErrorType.AUTH_REQUIRED
  if (status === 403) return AuthErrorType.ACCESS_DENIED
  if (status >= 500 || status === 0) return AuthErrorType.SERVER_UNAVAILABLE
  return null
}

// Create axios instance with centralized API URL
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  }
})

// Add request interceptor to include Bearer token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('api_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  } else {
    // Skip auth warning for development - many endpoints work without auth
    if (import.meta.env.DEV) {
      console.log('🔧 DEV MODE: No API token, proceeding without auth')
    } else {
      console.warn('No API token found — API calls will fail')
    }
  }
  return config
}, (error) => {
  return Promise.reject(error)
})

// P0-G Part F: Response interceptor — classify 401/403/5xx into AuthError
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const status = error.response.status
      const errorType = classifyHttpStatus(status)
      if (errorType) {
        const authError = new AuthError(errorType, status, `API error ${status}`)
        // Preserve original error data
        authError.response = error.response
        return Promise.reject(authError)
      }
    } else if (error.request) {
      // Network error — no response received
      const authError = new AuthError(AuthErrorType.SERVER_UNAVAILABLE, 0, 'Network error — server unavailable')
      return Promise.reject(authError)
    }
    return Promise.reject(error)
  }
)

export async function authenticatedFetch(url, options = {}) {
  const token = localStorage.getItem('api_token')
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...options.headers,
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const response = await fetch(url, { ...options, headers })

  // P0-G Part F: Classify 401/403/5xx and throw AuthError
  if (!response.ok) {
    const errorType = classifyHttpStatus(response.status)
    if (errorType) {
      const authError = new AuthError(errorType, response.status, `API error ${response.status}`)
      authError.response = response
      throw authError
    }
  }

  return response
}

export default api