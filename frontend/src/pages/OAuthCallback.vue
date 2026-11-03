<template>
  <div class="container mt-5">
    <div class="row justify-content-center">
      <div class="col-md-8">
        <div class="card">
          <div class="card-header text-center">
            <img src="../assets/logo-2.png" alt="ChaosMonkey.dev Logo" style="height: 6rem; width: auto;" class="mb-3">
            <h2>Processing OAuth...</h2>
          </div>
          <div class="card-body text-center">
            <div v-if="isLoading" class="mb-4">
              <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
              </div>
              <p class="mt-3">Completing authentication...</p>
            </div>
            <div v-else-if="error" class="mb-4">
              <div class="alert alert-danger">
                <h4>❌ Authentication Failed</h4>
                <p>{{ error }}</p>
                <button @click="goToLogin" class="btn btn-primary">Return to Login</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useGitHubStore } from '../stores/github'
import { useMetricsFacadeStore } from '../stores/metricsFacade'
import { error as logError } from '../utils/logger'
import { API_URL } from '../config/api'

const router = useRouter()
const authStore = useAuthStore()

const isLoading = ref(true)
const error = ref(null)

const goToLogin = () => {
  router.push('/login')
}

const handleOAuthCallback = async () => {
  try {
    const urlParams = new URLSearchParams(window.location.search)
    const oauthSuccess = urlParams.get('oauth_success')
    const handoffCode = urlParams.get('handoff_code')

    if (oauthSuccess === 'true' && handoffCode) {
      // Exchange the one-time handoff code for a real dashboard token
      const response = await fetch(`${API_URL}/github/oauth/dashboard-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handoff_code: handoffCode }),
      })

      if (!response.ok) {
        throw new Error('Handoff exchange failed')
      }

      const data = await response.json()
      const dashboardToken = data.dashboard_token

      if (!dashboardToken) {
        throw new Error('No dashboard token returned')
      }

      // Store the real credential
      authStore.isAuthed = true
      authStore.token = dashboardToken
      localStorage.setItem('api_token', dashboardToken)

      // Remove all OAuth/handoff parameters from the address bar
      const cleanUrl = window.location.origin + window.location.pathname
      window.history.replaceState({}, document.title, cleanUrl)

      // Pre-warm GitHub store after OAuth success
      try {
        const githubStore = useGitHubStore()
        githubStore.fetchMetrics('week').catch(() => {})
      } catch (err) {
        console.warn('[OAUTH_CALLBACK] failed to prewarm github store:', err)
      }

      // Pre-warm AI signals telemetry after OAuth success
      try {
        const metricsFacadeStore = useMetricsFacadeStore()
        const today = new Date().toISOString().split('T')[0]
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

        metricsFacadeStore.getProductivityTimeSeries({
          from: weekAgo,
          to: today,
          metrics: ['AI_suggestions_accepted', 'average_session_length_minutes', 'commits_per_session']
        }).catch(() => {})
      } catch (err) {
        console.warn('[OAUTH_CALLBACK] failed to prewarm AI signals:', err)
      }

      router.push('/dashboards?v2=1')
      return
    }

    // If no success parameters, check OAuth status from backend
    const statusResponse = await fetch(`${API_URL}/github/oauth/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (statusResponse.ok) {
      const statusData = await statusResponse.json()

      if (statusData.oauth_authenticated) {
        // No handoff code available — redirect to login for re-authentication
        authStore.isAuthed = false
        authStore.token = null
        localStorage.removeItem('api_token')

        router.push('/login')
        return
      }
    }

    throw new Error('OAuth authentication failed or incomplete')

  } catch (err) {
    logError('OAuth callback error:', err)
    // Clear any stale credentials on failure
    authStore.isAuthed = false
    authStore.token = null
    localStorage.removeItem('api_token')
    error.value = err.message || 'Authentication failed. Please try again.'
    isLoading.value = false
  }
}

onMounted(() => {
  handleOAuthCallback()
})
</script>

<style scoped>
/* Component-specific styles will be added later */
</style>
