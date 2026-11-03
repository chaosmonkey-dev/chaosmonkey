/**
 * Utility function for building API URLs with proper environment handling
 * 
 * Usage:
 *   const url = buildApiUrl('/telemetry')
 *   // Returns: 'http://<ec2-host>:9010/api/telemetry' on EC2
 *   // Returns: '/api/telemetry' on local dev (uses Vite proxy)
 */

export function buildApiUrl(path: string): string {
  // Remove leading slash if present to avoid double slashes
  const cleanPath = path.startsWith('/') ? path.slice(1) : path

  // If VITE_API_BASE_URL is set (EC2 production), use it
  // Otherwise, use relative path for Vite proxy (local development)
  // Strip trailing slash AND trailing /api to prevent /api/api double-prefix.
  const baseUrl = (import.meta.env.VITE_API_BASE_URL || '')
    .replace(/\/$/, '')
    .replace(/\/api$/, '')

  return `${baseUrl}/api/${cleanPath}`
}

/**
 * Get the base API URL without any path
 */
export function getApiBaseUrl(): string {
  return (import.meta.env.VITE_API_BASE_URL || '')
    .replace(/\/$/, '')
    .replace(/\/api$/, '')
}

/**
 * Check if running in production mode with external API
 */
export function isProductionApi(): boolean {
  return !!import.meta.env.VITE_API_BASE_URL
}
