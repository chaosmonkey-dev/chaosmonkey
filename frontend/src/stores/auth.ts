import { defineStore } from 'pinia'
import { ref } from 'vue'
import { API_URL } from '../config/api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref('')
  const isAuthed = ref(false)
  // P0-G Part F: Track auth error state for dashboard truthfulness
  const authError = ref<string | null>(null) // null | 'AUTH_REQUIRED' | 'ACCESS_DENIED' | 'SERVER_UNAVAILABLE'

  const setAuthError = (errorType: string | null) => {
    authError.value = errorType
    if (errorType === 'AUTH_REQUIRED') {
      isAuthed.value = false
    }
    // Do NOT clear isAuthed on ACCESS_DENIED — user is authenticated but not authorized
  }

  const clearAuthError = () => {
    authError.value = null
  }

  const logout = async () => {
    console.log('Auth store logout called')
    try {
      const storedToken = localStorage.getItem('api_token')
      // CR-X: Revoke the dashboard API token (not GitHub OAuth tokens).
      // This invalidates the current session without affecting the org's
      // GitHub engineering integration or other users' tokens.
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(storedToken ? { 'Authorization': `Bearer ${storedToken}` } : {}),
        }
      })
    } catch (error) {
      console.error('Logout API call failed:', error)
      // Continue with logout even if API call fails
    } finally {
      // Clear auth store
      token.value = ''
      isAuthed.value = false
      authError.value = null
      localStorage.removeItem('api_token')

      // Clear onboarding progress
      sessionStorage.removeItem('codesight_onboarding_connect')
      sessionStorage.removeItem('codesight_onboarding_metrics')

      // Clear any other session data
      sessionStorage.removeItem('codesight_github_connection')
      sessionStorage.removeItem('codesight_ide_connections')

      console.log('Auth store logout completed')
    }
  }

  return {
    token,
    isAuthed,
    authError,
    setAuthError,
    clearAuthError,
    logout
  }
})
