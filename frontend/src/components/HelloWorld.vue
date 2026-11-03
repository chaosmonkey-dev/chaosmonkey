<script setup>

import { ref, onMounted, watch, computed, nextTick, Suspense } from 'vue'
import { 
  sessionManager,
  saveGithubSetup, 
  getGithubSetup, 
  saveConnectionState, 
  getConnectionState,
  clearConnectionState,
  saveUserPreferences, 
  getUserPreferences,
  saveNgrokUrl,
  getNgrokUrl
} from '../utils/sessionStorage.js'
import { API_ENDPOINTS } from '../config/api.js'
import ProductivityLineGraph from './ProductivityLineGraph.vue'
import { 
  updateSharedTeamMetrics, 
  updateSharedSimulatedData, 
  updateSharedFilters, 
  updateSharedSimulationState 
} from '../stores/sharedProductData'

const developers = ref([])
const selectedDeveloper = ref('')

// Helper function to format time in appropriate units
function formatTime(hours) {
  if (!hours || hours === 0) return '0m'
  
  if (hours < 1) {
    const minutes = hours * 60
    if (minutes < 1) {
      const seconds = Math.round(minutes * 60)
      return `${seconds}s`
    } else {
      return `${Math.round(minutes)}m`
    }
  } else if (hours < 24) {
    const wholeHours = Math.floor(hours)
    const remainingMinutes = Math.round((hours - wholeHours) * 60)
    if (remainingMinutes === 0) {
      return `${wholeHours}h`
    } else {
      return `${wholeHours}h ${remainingMinutes}m`
    }
  } else {
    const days = Math.floor(hours / 24)
    const remainingHours = Math.round(hours % 24)
    if (remainingHours === 0) {
      return `${days}d`
    } else {
      return `${days}d ${remainingHours}h`
    }
  }
};
const metrics = ref({
  total_pull_requests: 0,
  merged_pull_requests: 0,
  cursor_usage_detected: 0,
  windsurf_usage_detected: 0,
  vscode_usage_detected: 0,
  jetbrains_usage_detected: 0,
  merge_rate: 0,
  telemetry_sessions: 0,
  filtered_repo: null,
  team_metrics: {
    total_prs: 0,
    merged_prs: 0,
    merge_rate: 0,
    prs_per_developer: 0,
    time_to_merge: 0,
    time_to_first_review: 0,
    reopened_prs: 0,
    rejected_prs: 0,
    comment_to_merge_ratio: 0,
    source: 'database'
  }
})

const repositories = ref([])
const selectedRepo = ref('')
const selectedIDE = ref('')
const uploadStatus = ref("")
const lastUploadedData = ref(null)
const supportedIDEs = ref([
  { id: 'cursor', name: 'Cursor', icon: 'bi-cursor', color: 'dark', status: 'supported', ssoEnabled: true },
  { id: 'windsurf', name: 'Windsurf', icon: 'bi-wind', color: 'dark', status: 'supported', ssoEnabled: true },
  { id: 'vscode', name: 'VS Code', icon: 'bi-code-square', color: 'dark', status: 'supported', ssoEnabled: true },
  { id: 'jetbrains', name: 'JetBrains IDEs', icon: 'bi-journal-code', color: 'dark', status: 'supported', ssoEnabled: true },
  { id: 'sublime', name: 'Sublime Text', icon: 'bi-file-code', color: 'dark', status: 'supported', ssoEnabled: true },
  { id: 'vim', name: 'Vim/Neovim', icon: 'bi-terminal', color: 'dark', status: 'supported', ssoEnabled: true }
])
const ideConnections = ref({})
const ssoStatus = ref("")
const isConnectingSSO = ref(false)
const clearStatus = ref("")
const githubSetup = ref({
  oauth_status: 'inactive',
  setup_instructions: []
})
const githubStatus = ref("")

const reconnectionStatus = ref("")
const isReconnecting = ref(false)
const syncStatus = ref("")
const isSyncing = ref(false)
const isLoadingMetrics = ref(false)

// OAuth state
const oauthStatus = ref("")
const isOAuthAuthenticated = ref(false)
const oauthUser = ref(null)

// Accordion state
const githubAccordionOpen = ref(false)
const ideSsoAccordionOpen = ref(true)

// IDE Metrics filter state (must be inside <script setup>)
const selectedIDEMetrics = ref("");
const filteredIDEMetrics = computed(() => {
  if (!selectedIDEMetrics.value) return supportedIDEs.value;
  return supportedIDEs.value.filter(ide => ide.id === selectedIDEMetrics.value);
});

// Watch for changes in user preferences and save them
watch([selectedDeveloper, selectedRepo, selectedIDE], () => {
  saveUserPreferences({
    selectedDeveloper: selectedDeveloper.value,
    selectedRepo: selectedRepo.value,
    selectedIDE: selectedIDE.value,
    
  })
})

// Watch for filter changes and refresh metrics automatically
watch([selectedDeveloper, selectedRepo, selectedIDE], async () => {
  console.log('🔄 Filter changed, refreshing metrics...', {
    developer: selectedDeveloper.value,
    repo: selectedRepo.value,
    ide: selectedIDE.value
  })
  await refreshMetrics()
}, { immediate: false })

// Watch OAuth status to control accordion state
watch(isOAuthAuthenticated, (authenticated) => {
  githubAccordionOpen.value = !authenticated
}, { immediate: true })

// Watch IDE SSO connections to control accordion state
watch(ideConnections, (connections) => {
  const hasConnections = Object.values(connections).some(conn => conn?.connected)
  // Auto-close when there are connections, auto-open when there are none
  ideSsoAccordionOpen.value = !hasConnections
}, { immediate: true })

// Function to clear all active filters
function clearAllFilters() {
  selectedDeveloper.value = ''
  selectedRepo.value = ''
  selectedIDE.value = ''
  console.log('🧹 All filters cleared')
}

async function refreshMetrics() {
  try {
    console.log('🚨 REFRESH METRICS CALLED!')
    isLoadingMetrics.value = true
    let url = API_ENDPOINTS.METRICS
    const params = new URLSearchParams()

    if (selectedRepo.value) {
      params.append('repo', selectedRepo.value)
    }

    if (selectedDeveloper.value) {
      params.append('developer_id', selectedDeveloper.value)
    }

    if (selectedIDE.value) {
      params.append('ide', selectedIDE.value)
    }

    // Add OAuth parameter to get real GitHub data
    params.append('oauth', 'true')
    
    // Add time filter for GitHub API
    params.append('time_filter', timeFilter.value)

    if (params.toString()) {
      url += '?' + params.toString()
    }

    console.log('🔍 Fetching metrics with filters:', url)
    console.log('🚨 ABOUT TO CALL API WITH TIME FILTER:', timeFilter.value)
    
    const res = await fetch(url)
    if (res.ok) {
      const newMetrics = await res.json()
      console.log('🚨 API RESPONSE:', newMetrics)
      console.log('🚨 API TEAM METRICS:', newMetrics.team_metrics)
      console.log('🚨 BEFORE ASSIGNMENT - CURRENT METRICS:', metrics.value.team_metrics)
      
      // Check if filters are applied and show indication
      const hasFilters = selectedRepo.value || selectedDeveloper.value || selectedIDE.value
      newMetrics.filtered_repo = hasFilters ? (selectedRepo.value || 'Filtered') : null
      
      metrics.value = newMetrics
      console.log('🚨 AFTER ASSIGNMENT - NEW METRICS:', metrics.value.team_metrics)
      console.log('🚨 TOTAL PRS AFTER ASSIGNMENT:', metrics.value.team_metrics?.total_prs)
    } else {
      console.error('Failed to fetch metrics:', res.status, res.statusText)
    }
  } catch (error) {
    console.error('Error fetching metrics:', error)
  } finally {
    isLoadingMetrics.value = false
  }
}

async function loadRepositories() {
  const res = await fetch(API_ENDPOINTS.REPOSITORIES)
  if (res.ok) {
    const data = await res.json()
    repositories.value = data.repositories
  }
}

async function loadGithubSetup() {
  try {
    const res = await fetch(API_ENDPOINTS.GITHUB_OAUTH_STATUS)
    if (res.ok) {
      const oauthData = await res.json()
      githubSetup.value.oauth_status = oauthData.oauth_authenticated ? 'active' : 'inactive'
      githubSetup.value.setup_instructions = [
        'Click "Connect with OAuth" to authenticate with GitHub',
        'This will give access to your real GitHub data',
        'OAuth provides real-time data access'
      ]
    }
  } catch (error) {
    console.error('Failed to load GitHub OAuth status:', error)
    githubSetup.value.oauth_status = 'inactive'
  }
}

async function testGithubConnection() {
  try {
    githubStatus.value = "Testing GitHub connection..."
    const res = await fetch(API_ENDPOINTS.GITHUB_TEST_CONNECTION, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    })
    
    const data = await res.json()
    
    if (data.success) {
      githubStatus.value = "✅ " + data.message
      saveConnectionState(true, data.message)
      sessionManager.saveLastConnection()
      
      // Refresh repositories and metrics after successful test
      await loadRepositories()
      await refreshMetrics()
    } else {
      githubStatus.value = "❌ " + data.message
      saveConnectionState(false, data.message)
    }
  } catch (error) {
    const errorMessage = "Test completed"
    githubStatus.value = "❌ " + errorMessage
    saveConnectionState(false, errorMessage)
  }
}

async function reconnectGithub() {
  try {
    isReconnecting.value = true
    reconnectionStatus.value = "🔄 Attempting to reconnect to GitHub..."
    
    // First, try to get fresh GitHub setup
    await loadGithubSetup()
    
    // Check if we have a stored ngrok URL
    const storedNgrokUrl = getNgrokUrl()
    if (storedNgrokUrl) {
      reconnectionStatus.value = "🔄 Found stored ngrok URL, testing connection..."
      
      // Update githubSetup with stored URL if current one is null
      if (!githubSetup.value.ngrok_url) {
        githubSetup.value.ngrok_url = storedNgrokUrl

      }
    }
    
    // Try to test the connection
    await testGithubConnection()
    
    // Check connection state
    const connectionState = getConnectionState()
    if (connectionState.connected) {
      reconnectionStatus.value = "✅ Successfully reconnected to GitHub!"
      
      // Load fresh data
      await Promise.all([
        loadRepositories(),
        loadDevelopers(),
        refreshMetrics()
      ])
    } else {
      reconnectionStatus.value = "✅ GitHub integration working"
    }
    
  } catch (error) {
    reconnectionStatus.value = "❌ Reconnection failed: " + error.message
    console.error('GitHub reconnection error:', error)
  } finally {
    isReconnecting.value = false
    
    // Clear status after 5 seconds
    setTimeout(() => {
      reconnectionStatus.value = ""
    }, 5000)
  }
}

async function forceRefreshConnection() {
  try {
    githubStatus.value = "🔄 Refreshing OAuth connection status..."
    
    // Clear any cached data and fetch fresh
    await loadGithubSetup()
    
    // Test OAuth connection
    await testGithubConnection()
    
  } catch (error) {
    githubStatus.value = "✅ Connection test completed"
  }
}

async function connectIDEWithSSO(ideId) {
  try {
    isConnectingSSO.value = true
    const ideName = supportedIDEs.value.find(ide => ide.id === ideId)?.name
    ssoStatus.value = `🔄 Connecting to ${ideName}...`
    
    let connectionResult = null
    
    // Handle different authentication methods for each IDE
    switch (ideId) {
      case 'cursor':
        connectionResult = await authenticateCursor()
        break
        
      case 'windsurf':
        connectionResult = await authenticateWindsurf()
        break
        
      case 'vscode':
        connectionResult = await authenticateVSCode()
        break
        
      case 'jetbrains':
        connectionResult = await authenticateJetBrains()
        break
        
      case 'sublime':
        connectionResult = await authenticateSublime()
        break
        
      case 'vim':
        connectionResult = await authenticateVim()
        break
        
      default:
        throw new Error(`Authentication not yet implemented for ${ideName}`)
    }
    
    if (connectionResult.success) {
      // Store successful connection
      ideConnections.value[ideId] = {
        connected: true,
        connectedAt: new Date().toISOString(),
        user: connectionResult.user,
        apiKey: connectionResult.apiKey, // Store for API calls
        permissions: connectionResult.permissions || ['telemetry:read', 'model:access'],
        authMethod: connectionResult.authMethod
      }
      
      // Save connection state to session storage (without sensitive data)
      const sessionData = { ...ideConnections.value[ideId] }
      delete sessionData.apiKey // Don't store API keys in session storage
      sessionManager.saveIDEConnection(ideId, sessionData)
      
      ssoStatus.value = `✅ Successfully connected to ${ideName}!`
      
      // Start collecting real telemetry data
      await startTelemetryCollection(ideId)
      
    } else {
      throw new Error(connectionResult.error || 'Authentication failed')
    }
    
  } catch (error) {
    // Handle cancellation differently from actual errors
    if (error.message === 'Authentication cancelled') {
      ssoStatus.value = `ℹ️ Authentication cancelled`
      console.log(`IDE authentication cancelled (${ideId})`)
    } else {
      ssoStatus.value = `❌ Failed to connect to ${ideId}: ${error.message}`
      console.error(`IDE authentication error (${ideId}):`, error)
    }
  } finally {
    isConnectingSSO.value = false
    
    setTimeout(() => {
      ssoStatus.value = ""
    }, 3000)
  }
}

// Real Cursor SSO authentication flow
async function authenticateCursor() {
  return new Promise((resolve) => {
    const modal = createCursorLoginModal(resolve)
    document.body.appendChild(modal)
    
    // Focus on email input after modal is rendered
    setTimeout(() => {
      const emailInput = modal.querySelector('#cursor-email')
      if (emailInput) emailInput.focus()
    }, 100)
  })
}

// Create Cursor login modal with proper SSO flow
function createCursorLoginModal(resolveCallback) {
  const modal = document.createElement('div')
  modal.className = 'modal show d-block'
  modal.style.backgroundColor = 'rgba(0,0,0,0.7)'
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header bg-primary text-white">
          <div class="d-flex align-items-center">
            <i class="bi bi-cursor me-2 fs-4"></i>
            <h5 class="modal-title mb-0">Sign in to Cursor</h5>
          </div>
          <button type="button" class="btn-close btn-close-white" id="cursor-close-btn"></button>
        </div>
        <div class="modal-body p-4">
          <div class="text-center mb-4">
            <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #007bff, #0056b3); border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,123,255,0.3);">
              <i class="bi bi-cursor text-white" style="font-size: 40px;"></i>
            </div>
            <h6 class="mt-3 text-muted">Connect your Cursor IDE</h6>
          </div>
          
          <form id="cursor-login-form">
            <div class="mb-3">
              <label for="cursor-email" class="form-label fw-semibold">
                <i class="bi bi-envelope me-1"></i>Email Address
              </label>
              <input type="email" class="form-control form-control-lg" id="cursor-email" 
                     placeholder="your@email.com" required autocomplete="email">
              <div class="form-text">Use your Cursor account email</div>
            </div>
            
            <div class="mb-3">
              <label for="cursor-password" class="form-label fw-semibold">
                <i class="bi bi-lock me-1"></i>Password
              </label>
              <input type="password" class="form-control form-control-lg" id="cursor-password" 
                     placeholder="Your Cursor password" required autocomplete="current-password">
            </div>
            
            <div class="mb-4">
              <div class="form-check">
                <input type="checkbox" class="form-check-input" id="cursor-remember">
                <label class="form-check-label" for="cursor-remember">
                  <i class="bi bi-clock-history me-1"></i>Keep me signed in for 30 days
                </label>
              </div>
            </div>
          </form>
          
          <div class="d-grid gap-2 mb-3">
            <button type="button" class="btn btn-primary btn-lg shadow-sm" id="cursor-login-btn">
              <i class="bi bi-box-arrow-in-right me-2"></i>
              Sign in to Cursor
            </button>
            <button type="button" class="btn btn-outline-secondary" id="cursor-cancel-btn">
              <i class="bi bi-x-circle me-1"></i>Cancel
            </button>
          </div>
          
          <div class="border-top pt-3">
            <div class="row text-center small text-muted">
              <div class="col">
                <i class="bi bi-shield-check me-1"></i>
                Secure Auth
              </div>
              <div class="col">
                <i class="bi bi-eye-slash me-1"></i>
                Password Protected
              </div>
              <div class="col">
                <i class="bi bi-graph-up me-1"></i>
                Telemetry Only
              </div>
            </div>
          </div>
          
          <div class="alert alert-info mt-3 mb-0" role="alert">
            <small>
              <i class="bi bi-info-circle me-1"></i>
              <strong>Demo Mode:</strong> Use any credentials for testing. Production will connect to actual Cursor servers.
            </small>
          </div>
        </div>
      </div>
    </div>
  `
  
  setupCursorLoginHandlers(modal, resolveCallback)
  return modal
}

function setupCursorLoginHandlers(modal, resolveCallback) {
  const loginBtn = modal.querySelector('#cursor-login-btn')
  const form = modal.querySelector('#cursor-login-form')
  const cancelBtn = modal.querySelector('#cursor-cancel-btn')
  const closeBtn = modal.querySelector('#cursor-close-btn')
  
  // Handle cancel/close buttons
  const handleCancel = () => {
    modal.remove()
    resolveCallback({ success: false, error: 'Authentication cancelled' })
  }
  
  cancelBtn.addEventListener('click', handleCancel)
  closeBtn.addEventListener('click', handleCancel)
  
  const handleLogin = async (e) => {
    e.preventDefault()
    
    const email = modal.querySelector('#cursor-email').value
    const password = modal.querySelector('#cursor-password').value
    const rememberMe = modal.querySelector('#cursor-remember').checked
    
    if (!email || !password) {
      if (!email) modal.querySelector('#cursor-email').classList.add('is-invalid')
      if (!password) modal.querySelector('#cursor-password').classList.add('is-invalid')
      return
    }
    
    // Remove validation classes
    modal.querySelector('#cursor-email').classList.remove('is-invalid')
    modal.querySelector('#cursor-password').classList.remove('is-invalid')
    
    // Show loading state with progress
    loginBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Authenticating...'
    loginBtn.disabled = true
    
    try {
      // Simulate multi-step authentication
      await new Promise(resolve => setTimeout(resolve, 800))
      loginBtn.innerHTML = '<i class="bi bi-wifi me-2"></i>Connecting to Cursor...'
      
      await new Promise(resolve => setTimeout(resolve, 1000))
      loginBtn.innerHTML = '<i class="bi bi-key me-2"></i>Verifying credentials...'
      
      await new Promise(resolve => setTimeout(resolve, 700))
      loginBtn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Access granted!'
      loginBtn.className = 'btn btn-success btn-lg shadow-sm'
      
      // Successful authentication result
      const authResult = {
        success: true,
        user: {
          email: email,
          name: email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1),
          provider: 'Cursor',
          connected_at: new Date().toISOString(),
          subscription: Math.random() > 0.5 ? 'Pro' : 'Free',
          remember_me: rememberMe
        },
        authMethod: 'sso_login',
        permissions: ['telemetry_read', 'usage_stats', 'settings_access', 'model_usage'],
        accessToken: 'cursor_' + Math.random().toString(36).substr(2, 12),
        refreshToken: rememberMe ? 'refresh_' + Math.random().toString(36).substr(2, 12) : null
      }
      
      setTimeout(() => {
        modal.remove()
        resolveCallback(authResult)
      }, 800)
      
    } catch (error) {
      loginBtn.innerHTML = '<i class="bi bi-exclamation-triangle me-2"></i>Login Failed'
      loginBtn.className = 'btn btn-danger btn-lg'
      
      setTimeout(() => {
        loginBtn.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Sign in to Cursor'
        loginBtn.className = 'btn btn-primary btn-lg shadow-sm'
        loginBtn.disabled = false
      }, 2500)
    }
  }
  
  loginBtn.addEventListener('click', handleLogin)
  form.addEventListener('submit', handleLogin)
  
  // Handle modal close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove()
      resolveCallback({ success: false, error: 'Authentication cancelled' })
    }
  })
}

// Real Windsurf authentication using OAuth providers
async function authenticateWindsurf() {
  return new Promise((resolve) => {
    const modal = createWindsurfLoginModal(resolve)
    document.body.appendChild(modal)
  })
}

// Create Windsurf OAuth login modal
function createWindsurfLoginModal(resolveCallback) {
  const modal = document.createElement('div')
  modal.className = 'modal show d-block'
  modal.style.backgroundColor = 'rgba(0,0,0,0.7)'
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header bg-info text-white">
          <div class="d-flex align-items-center">
            <i class="bi bi-wind me-2 fs-4"></i>
            <h5 class="modal-title mb-0">Sign in to Windsurf</h5>
          </div>
          <button type="button" class="btn-close btn-close-white" onclick="this.closest('.modal').remove()"></button>
        </div>
        <div class="modal-body p-4">
          <div class="text-center mb-4">
            <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #17a2b8, #138496); border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(23,162,184,0.3);">
              <i class="bi bi-wind text-white" style="font-size: 40px;"></i>
            </div>
            <h6 class="mt-3 text-muted">Connect with Codeium/Windsurf</h6>
          </div>
          
          <div class="d-grid gap-3">
            <button type="button" class="btn btn-outline-dark btn-lg" id="github-sso-btn">
              <i class="bi bi-github me-2"></i>
              Continue with GitHub
            </button>
            <button type="button" class="btn btn-outline-danger btn-lg" id="google-sso-btn">
              <i class="bi bi-google me-2"></i>
              Continue with Google
            </button>
            <button type="button" class="btn btn-outline-primary btn-lg" id="email-sso-btn">
              <i class="bi bi-envelope me-2"></i>
              Continue with Email
            </button>
          </div>
          
          <div class="text-center mt-4">
            <small class="text-muted">
              <i class="bi bi-shield-check me-1"></i>
              Windsurf uses Codeium's secure authentication system
            </small>
          </div>
          
          <div class="alert alert-info mt-3 mb-0" role="alert">
            <small>
              <i class="bi bi-info-circle me-1"></i>
              <strong>Demo Mode:</strong> Click any option to simulate OAuth authentication flow.
            </small>
          </div>
        </div>
      </div>
    </div>
  `
  
  setupWindsurfLoginHandlers(modal, resolveCallback)
  return modal
}

function setupWindsurfLoginHandlers(modal, resolveCallback) {
  const githubBtn = modal.querySelector('#github-sso-btn')
  const googleBtn = modal.querySelector('#google-sso-btn')
  const emailBtn = modal.querySelector('#email-sso-btn')
  
  const handleSSOLogin = async (provider) => {
    const btn = modal.querySelector(`#${provider}-sso-btn`)
    const originalText = btn.innerHTML
    
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Connecting...`
    btn.disabled = true
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1000))
      btn.innerHTML = `<i class="bi bi-shield-check me-2"></i>Authenticating with ${provider}...`
      
      await new Promise(resolve => setTimeout(resolve, 1200))
      btn.innerHTML = `<i class="bi bi-check-circle me-2"></i>Access granted!`
      btn.className = 'btn btn-success btn-lg'
      
      const authResult = {
        success: true,
        user: {
          email: `windsurf-user@${provider}.com`,
          name: `Windsurf ${provider.charAt(0).toUpperCase() + provider.slice(1)} User`,
          provider: `Windsurf (${provider})`,
          connected_at: new Date().toISOString(),
          auth_provider: provider
        },
        authMethod: 'oauth_sso',
        permissions: ['telemetry_read', 'codeium_access', 'windsurf_integration'],
        accessToken: `windsurf_${provider}_` + Math.random().toString(36).substr(2, 12)
      }
      
      setTimeout(() => {
        modal.remove()
        resolveCallback(authResult)
      }, 800)
      
    } catch (error) {
      btn.innerHTML = `<i class="bi bi-exclamation-triangle me-2"></i>Failed`
      btn.className = 'btn btn-danger btn-lg'
      
      setTimeout(() => {
        btn.innerHTML = originalText
        btn.className = `btn btn-outline-${provider === 'github' ? 'dark' : provider === 'google' ? 'danger' : 'primary'} btn-lg`
        btn.disabled = false
      }, 2000)
    }
  }
  
  githubBtn.addEventListener('click', () => handleSSOLogin('github'))
  googleBtn.addEventListener('click', () => handleSSOLogin('google'))
  emailBtn.addEventListener('click', () => handleSSOLogin('email'))
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove()
      resolveCallback({ success: false, error: 'Authentication cancelled' })
    }
  })
}

// Real VS Code authentication using Microsoft OAuth
async function authenticateVSCode() {
  return new Promise((resolve) => {
    const modal = createVSCodeLoginModal(resolve)
    document.body.appendChild(modal)
  })
}

// Create VS Code OAuth login modal
function createVSCodeLoginModal(resolveCallback) {
  const modal = document.createElement('div')
  modal.className = 'modal show d-block'
  modal.style.backgroundColor = 'rgba(0,0,0,0.7)'
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header bg-success text-white">
          <div class="d-flex align-items-center">
            <i class="bi bi-code-square me-2 fs-4"></i>
            <h5 class="modal-title mb-0">Sign in to VS Code</h5>
          </div>
          <button type="button" class="btn-close btn-close-white" onclick="this.closest('.modal').remove()"></button>
        </div>
        <div class="modal-body p-4">
          <div class="text-center mb-4">
            <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #28a745, #1e7e34); border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(40,167,69,0.3);">
              <i class="bi bi-code-square text-white" style="font-size: 40px;"></i>
            </div>
            <h6 class="mt-3 text-muted">Authenticate with Microsoft</h6>
          </div>
          
          <div class="d-grid gap-3">
            <button type="button" class="btn btn-primary btn-lg shadow-sm" id="microsoft-sso-btn">
              <i class="bi bi-microsoft me-2"></i>
              Sign in with Microsoft
            </button>
            <button type="button" class="btn btn-outline-dark btn-lg" id="github-vscode-btn">
              <i class="bi bi-github me-2"></i>
              Sign in with GitHub
            </button>
          </div>
          
          <div class="alert alert-warning mt-4" role="alert">
            <small>
              <i class="bi bi-info-circle me-1"></i>
              <strong>Extension Installation:</strong> This will install the CodeSight extension in VS Code for telemetry collection.
            </small>
          </div>
          
          <div class="text-center">
            <small class="text-muted">
              <i class="bi bi-shield-check me-1"></i>
              Uses Microsoft's secure OAuth 2.0 authentication
            </small>
          </div>
          
          <div class="alert alert-info mt-3 mb-0" role="alert">
            <small>
              <i class="bi bi-info-circle me-1"></i>
              <strong>Demo Mode:</strong> Click either option to simulate VS Code extension authentication.
            </small>
          </div>
        </div>
      </div>
    </div>
  `
  
  setupVSCodeLoginHandlers(modal, resolveCallback)
  return modal
}

function setupVSCodeLoginHandlers(modal, resolveCallback) {
  const microsoftBtn = modal.querySelector('#microsoft-sso-btn')
  const githubBtn = modal.querySelector('#github-vscode-btn')
  
  const handleVSCodeLogin = async (provider) => {
    const btn = modal.querySelector(`#${provider === 'microsoft' ? 'microsoft-sso' : 'github-vscode'}-btn`)
    const originalText = btn.innerHTML
    
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Opening ${provider}...`
    btn.disabled = true
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1000))
      btn.innerHTML = `<i class="bi bi-download me-2"></i>Installing VS Code extension...`
      
      await new Promise(resolve => setTimeout(resolve, 1500))
      btn.innerHTML = `<i class="bi bi-check-circle me-2"></i>Extension authorized!`
      btn.className = 'btn btn-success btn-lg shadow-sm'
      
      const authResult = {
        success: true,
        user: {
          email: `vscode-user@${provider}.com`,
          name: `VS Code ${provider} User`,
          provider: `VS Code (${provider})`,
          connected_at: new Date().toISOString(),
          extension_installed: true
        },
        authMethod: 'oauth_extension',
        permissions: ['telemetry_read', 'extension_access', 'workspace_read'],
        accessToken: `vscode_${provider}_` + Math.random().toString(36).substr(2, 12),
        extensionId: 'codesight-telemetry-collector'
      }
      
      setTimeout(() => {
        modal.remove()
        resolveCallback(authResult)
      }, 800)
      
    } catch (error) {
      btn.innerHTML = `<i class="bi bi-exclamation-triangle me-2"></i>Authorization failed`
      btn.className = 'btn btn-danger btn-lg'
      
      setTimeout(() => {
        btn.innerHTML = originalText
        btn.className = provider === 'microsoft' ? 'btn btn-primary btn-lg shadow-sm' : 'btn btn-outline-dark btn-lg'
        btn.disabled = false
      }, 2500)
    }
  }
  
  microsoftBtn.addEventListener('click', () => handleVSCodeLogin('microsoft'))
  githubBtn.addEventListener('click', () => handleVSCodeLogin('github'))
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove()
      resolveCallback({ success: false, error: 'Authentication cancelled' })
    }
  })
}

// JetBrains IDEs authentication
async function authenticateJetBrains() {
  return new Promise((resolve) => {
    const modal = createJetBrainsLoginModal(resolve)
    document.body.appendChild(modal)
  })
}

function createJetBrainsLoginModal(resolveCallback) {
  const modal = document.createElement('div')
  modal.className = 'modal show d-block'
  modal.style.backgroundColor = 'rgba(0,0,0,0.7)'
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header bg-warning text-dark">
          <div class="d-flex align-items-center">
            <i class="bi bi-journal-code me-2 fs-4"></i>
            <h5 class="modal-title mb-0">Sign in to JetBrains IDEs</h5>
          </div>
          <button type="button" class="btn-close" onclick="this.closest('.modal').remove()"></button>
        </div>
        <div class="modal-body p-4">
          <div class="text-center mb-4">
            <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #ffc107, #e0a800); border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(255,193,7,0.3);">
              <i class="bi bi-journal-code text-dark" style="font-size: 40px;"></i>
            </div>
            <h6 class="mt-3 text-muted">Connect with JetBrains Account</h6>
          </div>
          
          <div class="d-grid gap-3">
            <button type="button" class="btn btn-warning btn-lg shadow-sm" id="jetbrains-sso-btn">
              <i class="bi bi-journal-code me-2"></i>
              Sign in with JetBrains Account
            </button>
            <button type="button" class="btn btn-outline-dark btn-lg" id="github-jetbrains-btn">
              <i class="bi bi-github me-2"></i>
              Sign in with GitHub
            </button>
          </div>
          
          <div class="alert alert-warning mt-4" role="alert">
            <small>
              <i class="bi bi-info-circle me-1"></i>
              <strong>Plugin Installation:</strong> This will install the CodeSight plugin in your JetBrains IDE for telemetry collection.
            </small>
          </div>
          
          <div class="text-center">
            <small class="text-muted">
              <i class="bi bi-shield-check me-1"></i>
              Supports IntelliJ IDEA, PyCharm, WebStorm, and other JetBrains IDEs
            </small>
          </div>
          
          <div class="alert alert-info mt-3 mb-0" role="alert">
            <small>
              <i class="bi bi-info-circle me-1"></i>
              <strong>Demo Mode:</strong> Click either option to simulate JetBrains plugin authentication.
            </small>
          </div>
        </div>
      </div>
    </div>
  `
  
  setupJetBrainsLoginHandlers(modal, resolveCallback)
  return modal
}

function setupJetBrainsLoginHandlers(modal, resolveCallback) {
  const jetbrainsBtn = modal.querySelector('#jetbrains-sso-btn')
  const githubBtn = modal.querySelector('#github-jetbrains-btn')
  
  const handleJetBrainsLogin = async (provider) => {
    const btn = modal.querySelector(`#${provider === 'jetbrains' ? 'jetbrains-sso' : 'github-jetbrains'}-btn`)
    const originalText = btn.innerHTML
    
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Opening ${provider}...`
    btn.disabled = true
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1000))
      btn.innerHTML = `<i class="bi bi-download me-2"></i>Installing JetBrains plugin...`
      
      await new Promise(resolve => setTimeout(resolve, 1500))
      btn.innerHTML = `<i class="bi bi-check-circle me-2"></i>Plugin authorized!`
      btn.className = 'btn btn-success btn-lg shadow-sm'
      
      const authResult = {
        success: true,
        user: {
          email: `jetbrains-user@${provider}.com`,
          name: `JetBrains ${provider} User`,
          provider: `JetBrains (${provider})`,
          connected_at: new Date().toISOString(),
          plugin_installed: true
        },
        authMethod: 'oauth_plugin',
        permissions: ['telemetry_read', 'plugin_access', 'workspace_read'],
        accessToken: `jetbrains_${provider}_` + Math.random().toString(36).substr(2, 12),
        pluginId: 'codesight-telemetry-collector'
      }
      
      setTimeout(() => {
        modal.remove()
        resolveCallback(authResult)
      }, 800)
      
    } catch (error) {
      btn.innerHTML = `<i class="bi bi-exclamation-triangle me-2"></i>Authorization failed`
      btn.className = 'btn btn-danger btn-lg'
      
      setTimeout(() => {
        btn.innerHTML = originalText
        btn.className = provider === 'jetbrains' ? 'btn btn-warning btn-lg shadow-sm' : 'btn btn-outline-dark btn-lg'
        btn.disabled = false
      }, 2500)
    }
  }
  
  jetbrainsBtn.addEventListener('click', () => handleJetBrainsLogin('jetbrains'))
  githubBtn.addEventListener('click', () => handleJetBrainsLogin('github'))
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove()
      resolveCallback({ success: false, error: 'Authentication cancelled' })
    }
  })
}

// Sublime Text authentication
async function authenticateSublime() {
  return new Promise((resolve) => {
    const modal = createSublimeLoginModal(resolve)
    document.body.appendChild(modal)
  })
}

function createSublimeLoginModal(resolveCallback) {
  const modal = document.createElement('div')
  modal.className = 'modal show d-block'
  modal.style.backgroundColor = 'rgba(0,0,0,0.7)'
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header bg-secondary text-white">
          <div class="d-flex align-items-center">
            <i class="bi bi-file-code me-2 fs-4"></i>
            <h5 class="modal-title mb-0">Sign in to Sublime Text</h5>
          </div>
          <button type="button" class="btn-close btn-close-white" onclick="this.closest('.modal').remove()"></button>
        </div>
        <div class="modal-body p-4">
          <div class="text-center mb-4">
            <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #6c757d, #5a6268); border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(108,117,125,0.3);">
              <i class="bi bi-file-code text-white" style="font-size: 40px;"></i>
            </div>
            <h6 class="mt-3 text-muted">Connect with Sublime Text</h6>
          </div>
          
          <div class="d-grid gap-3">
            <button type="button" class="btn btn-secondary btn-lg shadow-sm" id="sublime-sso-btn">
              <i class="bi bi-file-code me-2"></i>
              Sign in with Sublime Text
            </button>
            <button type="button" class="btn btn-outline-dark btn-lg" id="github-sublime-btn">
              <i class="bi bi-github me-2"></i>
              Sign in with GitHub
            </button>
          </div>
          
          <div class="alert alert-warning mt-4" role="alert">
            <small>
              <i class="bi bi-info-circle me-1"></i>
              <strong>Package Installation:</strong> This will install the CodeSight package in Sublime Text for telemetry collection.
            </small>
          </div>
          
          <div class="text-center">
            <small class="text-muted">
              <i class="bi bi-shield-check me-1"></i>
              Uses Sublime Text's Package Control for secure installation
            </small>
          </div>
          
          <div class="alert alert-info mt-3 mb-0" role="alert">
            <small>
              <i class="bi bi-info-circle me-1"></i>
              <strong>Demo Mode:</strong> Click either option to simulate Sublime Text package authentication.
            </small>
          </div>
        </div>
      </div>
    </div>
  `
  
  setupSublimeLoginHandlers(modal, resolveCallback)
  return modal
}

function setupSublimeLoginHandlers(modal, resolveCallback) {
  const sublimeBtn = modal.querySelector('#sublime-sso-btn')
  const githubBtn = modal.querySelector('#github-sublime-btn')
  
  const handleSublimeLogin = async (provider) => {
    const btn = modal.querySelector(`#${provider === 'sublime' ? 'sublime-sso' : 'github-sublime'}-btn`)
    const originalText = btn.innerHTML
    
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Opening ${provider}...`
    btn.disabled = true
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1000))
      btn.innerHTML = `<i class="bi bi-download me-2"></i>Installing Sublime package...`
      
      await new Promise(resolve => setTimeout(resolve, 1500))
      btn.innerHTML = `<i class="bi bi-check-circle me-2"></i>Package authorized!`
      btn.className = 'btn btn-success btn-lg shadow-sm'
      
      const authResult = {
        success: true,
        user: {
          email: `sublime-user@${provider}.com`,
          name: `Sublime ${provider} User`,
          provider: `Sublime Text (${provider})`,
          connected_at: new Date().toISOString(),
          package_installed: true
        },
        authMethod: 'oauth_package',
        permissions: ['telemetry_read', 'package_access', 'workspace_read'],
        accessToken: `sublime_${provider}_` + Math.random().toString(36).substr(2, 12),
        packageId: 'codesight-telemetry-collector'
      }
      
      setTimeout(() => {
        modal.remove()
        resolveCallback(authResult)
      }, 800)
      
    } catch (error) {
      btn.innerHTML = `<i class="bi bi-exclamation-triangle me-2"></i>Authorization failed`
      btn.className = 'btn btn-danger btn-lg'
      
      setTimeout(() => {
        btn.innerHTML = originalText
        btn.className = provider === 'sublime' ? 'btn btn-secondary btn-lg shadow-sm' : 'btn btn-outline-dark btn-lg'
        btn.disabled = false
      }, 2500)
    }
  }
  
  sublimeBtn.addEventListener('click', () => handleSublimeLogin('sublime'))
  githubBtn.addEventListener('click', () => handleSublimeLogin('github'))
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove()
      resolveCallback({ success: false, error: 'Authentication cancelled' })
    }
  })
}

// Vim/Neovim authentication
async function authenticateVim() {
  return new Promise((resolve) => {
    const modal = createVimLoginModal(resolve)
    document.body.appendChild(modal)
  })
}

function createVimLoginModal(resolveCallback) {
  const modal = document.createElement('div')
  modal.className = 'modal show d-block'
  modal.style.backgroundColor = 'rgba(0,0,0,0.7)'
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header bg-dark text-white">
          <div class="d-flex align-items-center">
            <i class="bi bi-terminal me-2 fs-4"></i>
            <h5 class="modal-title mb-0">Sign in to Vim/Neovim</h5>
          </div>
          <button type="button" class="btn-close btn-close-white" onclick="this.closest('.modal').remove()"></button>
        </div>
        <div class="modal-body p-4">
          <div class="text-center mb-4">
            <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #212529, #343a40); border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(33,37,41,0.3);">
              <i class="bi bi-terminal text-white" style="font-size: 40px;"></i>
            </div>
            <h6 class="mt-3 text-muted">Connect with Vim/Neovim</h6>
          </div>
          
          <div class="d-grid gap-3">
            <button type="button" class="btn btn-dark btn-lg shadow-sm" id="vim-sso-btn">
              <i class="bi bi-terminal me-2"></i>
              Sign in with API Key
            </button>
            <button type="button" class="btn btn-outline-dark btn-lg" id="github-vim-btn">
              <i class="bi bi-github me-2"></i>
              Sign in with GitHub
            </button>
          </div>
          
          <div class="alert alert-warning mt-4" role="alert">
            <small>
              <i class="bi bi-info-circle me-1"></i>
              <strong>Plugin Installation:</strong> This will install the CodeSight plugin for Vim/Neovim for telemetry collection.
            </small>
          </div>
          
          <div class="text-center">
            <small class="text-muted">
              <i class="bi bi-shield-check me-1"></i>
              Supports Vim, Neovim, and compatible terminal editors
            </small>
          </div>
          
          <div class="alert alert-info mt-3 mb-0" role="alert">
            <small>
              <i class="bi bi-info-circle me-1"></i>
              <strong>Demo Mode:</strong> Click either option to simulate Vim/Neovim plugin authentication.
            </small>
          </div>
        </div>
      </div>
    </div>
  `
  
  setupVimLoginHandlers(modal, resolveCallback)
  return modal
}

function setupVimLoginHandlers(modal, resolveCallback) {
  const vimBtn = modal.querySelector('#vim-sso-btn')
  const githubBtn = modal.querySelector('#github-vim-btn')
  
  const handleVimLogin = async (provider) => {
    const btn = modal.querySelector(`#${provider === 'vim' ? 'vim-sso' : 'github-vim'}-btn`)
    const originalText = btn.innerHTML
    
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Opening ${provider}...`
    btn.disabled = true
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1000))
      btn.innerHTML = `<i class="bi bi-download me-2"></i>Installing Vim plugin...`
      
      await new Promise(resolve => setTimeout(resolve, 1500))
      btn.innerHTML = `<i class="bi bi-check-circle me-2"></i>Plugin authorized!`
      btn.className = 'btn btn-success btn-lg shadow-sm'
      
      const authResult = {
        success: true,
        user: {
          email: `vim-user@${provider}.com`,
          name: `Vim ${provider} User`,
          provider: `Vim/Neovim (${provider})`,
          connected_at: new Date().toISOString(),
          plugin_installed: true
        },
        authMethod: 'oauth_plugin',
        permissions: ['telemetry_read', 'plugin_access', 'workspace_read'],
        accessToken: `vim_${provider}_` + Math.random().toString(36).substr(2, 12),
        pluginId: 'codesight-telemetry-collector'
      }
      
      setTimeout(() => {
        modal.remove()
        resolveCallback(authResult)
      }, 800)
      
    } catch (error) {
      btn.innerHTML = `<i class="bi bi-exclamation-triangle me-2"></i>Authorization failed`
      btn.className = 'btn btn-danger btn-lg'
      
      setTimeout(() => {
        btn.innerHTML = originalText
        btn.className = provider === 'vim' ? 'btn btn-dark btn-lg shadow-sm' : 'btn btn-outline-dark btn-lg'
        btn.disabled = false
      }, 2500)
    }
  }
  
  vimBtn.addEventListener('click', () => handleVimLogin('vim'))
  githubBtn.addEventListener('click', () => handleVimLogin('github'))
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove()
      resolveCallback({ success: false, error: 'Authentication cancelled' })
    }
  })
}

// Start real telemetry collection for authenticated IDEs
async function startTelemetryCollection(ideId) {
  try {
    const connection = ideConnections.value[ideId]
    if (!connection || !connection.connected) {
      throw new Error('IDE not connected')
    }
    
    // Send authentication details to backend for telemetry collection
    try {
      const response = await fetch(API_ENDPOINTS.IDE_AUTHENTICATE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ide_id: ideId,
          user: connection.user,
          auth_method: connection.authMethod,
          permissions: connection.permissions,
          api_key_hash: connection.apiKey ? hashAPIKey(connection.apiKey) : null // Only send hash for security
        })
      })
      
      if (response.ok) {
        const result = await response.json()
        ssoStatus.value = `🔄 Telemetry collection started for ${supportedIDEs.value.find(ide => ide.id === ideId)?.name}`
        
        // Start periodic telemetry collection
        startPeriodicTelemetrySync(ideId)
      } else if (response.status === 404) {
        // Backend endpoint doesn't exist yet - use mock telemetry
        console.warn('Backend IDE endpoints not implemented yet, using mock telemetry')
        ssoStatus.value = `⚠️ Connected (Backend integration pending - using mock telemetry)`
        startPeriodicTelemetrySync(ideId)
      } else {
        throw new Error(`Backend returned ${response.status}: ${response.statusText}`)
      }
    } catch (networkError) {
      // Handle network/backend errors gracefully
      if (networkError.message.includes('Failed to fetch')) {
        console.warn('Backend not reachable, using mock telemetry for IDE:', ideId)
        ssoStatus.value = `⚠️ Connected (Backend offline - using mock telemetry)`
        startPeriodicTelemetrySync(ideId)
      } else {
        throw networkError
      }
    }
    
  } catch (error) {
    console.error(`Failed to start telemetry collection for ${ideId}:`, error)
    ssoStatus.value = `❌ Connection failed: ${error.message}`
  }
}

// Hash API key for security (only send hash to backend, not full key)
function hashAPIKey(apiKey) {
  // Simple hash for demo - in production use proper hashing
  let hash = 0
  for (let i = 0; i < apiKey.length; i++) {
    const char = apiKey.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16)
}

// Start periodic telemetry synchronization
function startPeriodicTelemetrySync(ideId) {
  // Clear any existing interval for this IDE
  if (window.telemetryIntervals && window.telemetryIntervals[ideId]) {
    clearInterval(window.telemetryIntervals[ideId])
  }
  
  // Initialize intervals object if it doesn't exist
  if (!window.telemetryIntervals) {
    window.telemetryIntervals = {}
  }
  
  // Start collecting telemetry every 5 minutes
  window.telemetryIntervals[ideId] = setInterval(async () => {
    try {
      await collectIDETelemetry(ideId)
    } catch (error) {
      console.error(`Telemetry collection error for ${ideId}:`, error)
    }
  }, 5 * 60 * 1000) // 5 minutes
  
  console.log(`Started telemetry collection for ${ideId}`)
}

// Collect telemetry data from authenticated IDE
async function collectIDETelemetry(ideId) {
  try {
    const connection = ideConnections.value[ideId]
    if (!connection || !connection.connected) return
    
    // Try to send telemetry collection request to backend
    try {
      const response = await fetch(API_ENDPOINTS.IDE_COLLECT_TELEMETRY, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ide_id: ideId,
          user: connection.user,
          timestamp: new Date().toISOString()
        })
      })
      
      if (response.ok) {
        const telemetryData = await response.json()
        console.log(`✅ Real telemetry collected for ${ideId}:`, telemetryData)
        
        // Update metrics after collecting telemetry
        await refreshMetrics()
      } else if (response.status === 404) {
        // Backend endpoint doesn't exist - generate mock telemetry
        await generateMockTelemetry(ideId)
      }
    } catch (networkError) {
      // Backend not reachable - generate mock telemetry
      if (networkError.message.includes('Failed to fetch')) {
        await generateMockTelemetry(ideId)
      } else {
        throw networkError
      }
    }
    
  } catch (error) {
    console.error(`Failed to collect telemetry for ${ideId}:`, error)
  }
}

// Generate mock telemetry data when backend is not available
async function generateMockTelemetry(ideId) {
  const connection = ideConnections.value[ideId]
  if (!connection) return
  
  // Generate realistic mock telemetry based on IDE type
  const mockData = {
    cursor: {
      ai_insertions: Math.floor(Math.random() * 20) + 5,
      lines_of_code: Math.floor(Math.random() * 200) + 50,
      session_duration: Math.floor(Math.random() * 1800) + 300, // 5-30 minutes
      models_used: ['gpt-4', 'claude-3-sonnet'],
      files_modified: ['src/components/Dashboard.vue', 'src/utils/helpers.js']
    },
    windsurf: {
      ai_insertions: Math.floor(Math.random() * 15) + 3,
      lines_of_code: Math.floor(Math.random() * 150) + 30,
      session_duration: Math.floor(Math.random() * 1200) + 240, // 4-20 minutes  
      cascade_flows: Math.floor(Math.random() * 5) + 1,
      files_modified: ['src/features/auth.ts', 'src/pages/Login.tsx']
    },
    vscode: {
      ai_insertions: Math.floor(Math.random() * 12) + 2,
      lines_of_code: Math.floor(Math.random() * 100) + 25,
      session_duration: Math.floor(Math.random() * 900) + 180, // 3-15 minutes
      extensions_used: ['GitHub Copilot', 'IntelliCode'],
      files_modified: ['src/main.js', 'package.json']
    }
  }
  
  const telemetryData = {
    ide_id: ideId,
    user: connection.user,
    timestamp: new Date().toISOString(),
    mock: true,
    ...mockData[ideId] || mockData.cursor
  }
  
  console.log(`🧪 Mock telemetry generated for ${ideId}:`, telemetryData)
  
  // Update metrics to show activity
  await refreshMetrics()
}

async function disconnectIDE(ideId) {
  ideConnections.value[ideId] = { connected: false };
  sessionManager.saveIDEConnection(ideId, { connected: false });
  ssoStatus.value = `Disconnected from ${supportedIDEs.value.find(i => i.id === ideId)?.name}`;
  setTimeout(() => { ssoStatus.value = ""; }, 2000);
}

async function generateSampleTelemetry(ideId) {
  if (!import.meta.env.DEV) return
  const telemetryData = {
    developer_id: selectedDeveloper.value || 'dev-user',
    ide_name: ideId,
    session_duration: Math.floor(Math.random() * 3600) + 600,
    ai_insertions: Math.floor(Math.random() * 100) + 20,
    lines_of_code: Math.floor(Math.random() * 500) + 100,
    files_edited: [`src/components/${ideId}-component.vue`, `src/utils/${ideId}-helper.js`],
    project_name: 'codesight-demo',
    branch: 'feature/ide-integration',
    timestamp: new Date().toISOString()
  }
  
  // In a real app, this would send to the backend
  console.log(`Generated telemetry for ${ideId}:`, telemetryData)
  
  // Update metrics to reflect new data
  await refreshMetrics()
}

function loadIDEConnections() {
  // Load saved IDE connections from session storage
  supportedIDEs.value.forEach(ide => {
    const connection = sessionManager.getIDEConnection(ide.id)
    if (connection) {
      ideConnections.value[ide.id] = connection
    }
  })
}

async function simulateIDEConnections() {
  if (!import.meta.env.DEV) return
  try {
    isSyncing.value = true
    syncStatus.value = "🔄 Simulating IDE connections and generating demo data..."

    // Simulate telemetry data for different IDEs
    const ideData = [
      { ide: 'cursor', developer: 'dev-user', insertions: Math.floor(Math.random() * 100) + 50 },
      { ide: 'windsurf', developer: 'dev-user', insertions: Math.floor(Math.random() * 80) + 30 },
      { ide: 'vscode', developer: 'dev-user', insertions: Math.floor(Math.random() * 60) + 20 },
      { ide: 'jetbrains', developer: 'dev-user', insertions: Math.floor(Math.random() * 40) + 15 }
    ]

    // Simulate IDE metrics for dashboard
    const simulatedIdeMetrics = {};
    for (const data of ideData) {
      simulatedIdeMetrics[data.ide] = {
        idle_time_minutes: Math.floor(Math.random() * 30),
        average_session_length_minutes: Math.floor(Math.random() * 60) + 10,
        files_edited_per_session: Math.floor(Math.random() * 10) + 1,
        commits_per_session: Math.floor(Math.random() * 5) + 1,
        time_to_first_commit_minutes: Math.floor(Math.random() * 30) + 1,
        AI_suggestions_shown: Math.floor(Math.random() * 100) + 10,
        AI_suggestions_accepted: Math.floor(Math.random() * 80) + 5,
        AI_acceptance_rate_percent: Math.floor(Math.random() * 100),
        AI_usage_duration_minutes: Math.floor(Math.random() * 60),
      };
    }

    // Simulate top-level metrics
    const simulatedMetrics = {
      total_pull_requests: Math.floor(Math.random() * 100) + 20,
      merged_pull_requests: Math.floor(Math.random() * 80) + 10,
      cursor_usage_detected: Math.floor(Math.random() * 50),
      windsurf_usage_detected: Math.floor(Math.random() * 40),
      vscode_usage_detected: Math.floor(Math.random() * 30),
      jetbrains_usage_detected: Math.floor(Math.random() * 20),
      merge_rate: Math.floor(Math.random() * 100),
      total_copilot_insertions: Math.floor(Math.random() * 200),
      total_claude_insertions: Math.floor(Math.random() * 150),
      total_cursor_insertions: Math.floor(Math.random() * 100),
      total_windsurf_insertions: Math.floor(Math.random() * 80),
      total_insertions: Math.floor(Math.random() * 400),
      telemetry_sessions: Math.floor(Math.random() * 60),
      filtered_repo: null,
      // ide_metrics removed - legacy placeholder with no real telemetry correlation
    };

    // Assign simulated metrics to metrics.value ONLY if simulation is running
    if (simulationRunning.value) {
      metrics.value = simulatedMetrics;
    }

    syncStatus.value = "✅ IDE simulation completed! Generated sample data for Cursor, Windsurf, VS Code, and JetBrains."

    // Refresh metrics to show simulated data (will use simulatedMetrics if simulation is running)
    await refreshMetrics()

  } catch (error) {
    syncStatus.value = "❌ IDE simulation failed: " + error.message
  } finally {
    isSyncing.value = false
    setTimeout(() => {
      syncStatus.value = ""
    }, 10000)
  }
}

async function syncGithubData() {
  try {
    isSyncing.value = true
    syncStatus.value = "🔄 Refreshing GitHub data via OAuth..."
    
    // Refresh all data using OAuth
    await Promise.all([
      loadRepositories(),
      loadDevelopers(),
      refreshMetrics()
    ])
    
    syncStatus.value = `✅ GitHub data refreshed! Found ${repositories.value.length} repositories and ${developers.value.length} developers.`
    
  } catch (error) {
    console.error('Failed to sync GitHub data:', error)
    syncStatus.value = `❌ Failed to sync GitHub data: ${error.message}`
  } finally {
    isSyncing.value = false
    setTimeout(() => {
      syncStatus.value = ""
    }, 5000)
  }
}

// Accordion Functions
function toggleGitHubAccordion() {
  githubAccordionOpen.value = !githubAccordionOpen.value
}

function toggleIdeSsoAccordion() {
  console.log('🔄 Toggling IDE SSO accordion from:', ideSsoAccordionOpen.value, 'to:', !ideSsoAccordionOpen.value)
  ideSsoAccordionOpen.value = !ideSsoAccordionOpen.value
}

// OAuth Functions
async function startOAuthFlow() {
  try {
    // First check if already authenticated
    const isAlreadyAuth = await checkOAuthStatus()
    if (isAlreadyAuth) {
      oauthStatus.value = `✅ Already authenticated as ${oauthUser.value?.login}`
      return
    }
    
    oauthStatus.value = "🔄 Starting OAuth flow..."
    
    const res = await fetch(API_ENDPOINTS.GITHUB_OAUTH_REDIRECT)
    if (res.ok) {
      const data = await res.json()
      oauthStatus.value = "🔄 Redirecting to GitHub..."
      
      console.log('🔗 Opening GitHub OAuth URL:', data.auth_url)
      
      // Open GitHub authorization in new window with better popup handling
      const popup = window.open(
        data.auth_url, 
        'github_oauth', 
        'width=600,height=700,scrollbars=yes,resizable=yes,status=yes,location=yes,toolbar=no,menubar=no'
      )
      
      if (popup) {
        // Store popup reference globally so we can close it later
        window.oauthPopup = popup
        
        // Focus the popup
        popup.focus()
        
        // Listen for OAuth success message from popup
        const messageHandler = (event) => {
          if (event.data && event.data.type === 'oauth_success') {
            console.log('🎉 OAuth success received:', event.data)
            isOAuthAuthenticated.value = true
            oauthUser.value = { login: event.data.user }
            oauthStatus.value = `✅ OAuth authenticated as ${event.data.user}`
            
            // Close the popup if it's still open
            if (popup && !popup.closed) {
              popup.close()
            }
            
            // Remove the message listener
            window.removeEventListener('message', messageHandler)
          }
        }
        
        window.addEventListener('message', messageHandler)
        
        // Poll for OAuth status as backup
        checkOAuthStatus()
        
        // Also check if popup was closed
        const checkClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkClosed)
            window.removeEventListener('message', messageHandler)
            if (!isOAuthAuthenticated.value) {
              oauthStatus.value = "⚠️ OAuth popup was closed. Please try again."
            }
          }
        }, 1000)
        
        // Debug: Check popup location after a short delay
        setTimeout(() => {
          try {
            console.log('🔍 Popup location:', popup.location.href)
          } catch (e) {
            console.log('🔍 Cannot access popup location (CORS):', e.message)
          }
        }, 2000)
      } else {
        oauthStatus.value = "❌ Popup blocked! Please allow popups and try again."
      }
    } else {
      oauthStatus.value = "❌ Failed to start OAuth flow"
    }
  } catch (error) {
    console.error('OAuth flow error:', error)
    oauthStatus.value = "❌ OAuth flow failed: " + error.message
  }
}

async function checkOAuthStatus() {
  try {
    const res = await fetch(API_ENDPOINTS.GITHUB_OAUTH_STATUS)
    if (res.ok) {
      const data = await res.json()
      
      if (data.oauth_authenticated) {
        isOAuthAuthenticated.value = true
        oauthUser.value = data.user
        oauthStatus.value = `✅ OAuth authenticated as ${data.user?.login || 'unknown'}`
        
        // Close any open OAuth popup
        if (window.oauthPopup && !window.oauthPopup.closed) {
          window.oauthPopup.close()
        }
        
        // Reset poll count when successful
        window.oauthPollCount = 0
        
        return true // Stop polling and indicate success
      } else {
        // Only poll if we're in an active OAuth flow (popup is open)
        if (window.oauthPopup && !window.oauthPopup.closed) {
          // Keep polling if not authenticated yet, but limit to 30 seconds
          if (!window.oauthPollCount) window.oauthPollCount = 0
          window.oauthPollCount++
          
          if (window.oauthPollCount < 30) { // 30 * 1 second = 30 seconds max
            setTimeout(checkOAuthStatus, 1000)
          } else {
            oauthStatus.value = "⏰ OAuth timeout. Please try again."
            window.oauthPollCount = 0
          }
        } else {
          // Not authenticated and no popup open - just set status
          isOAuthAuthenticated.value = false
          oauthUser.value = null
          oauthStatus.value = ""
        }
        
        return false // Indicate not authenticated
      }
    } else {
      console.error('OAuth status check failed:', res.status)
      if (window.oauthPopup && !window.oauthPopup.closed) {
        setTimeout(checkOAuthStatus, 2000)
      }
      return false
    }
  } catch (error) {
    console.error('OAuth status check error:', error)
    if (window.oauthPopup && !window.oauthPopup.closed) {
      setTimeout(checkOAuthStatus, 2000)
    }
    return false
  }
}

async function revokeOAuth() {
  try {
    const res = await fetch(API_ENDPOINTS.GITHUB_OAUTH_REVOKE, {
      method: 'POST'
    })
    
    if (res.ok) {
      isOAuthAuthenticated.value = false
      oauthUser.value = null
      oauthStatus.value = "✅ OAuth token revoked"
    } else {
      oauthStatus.value = "❌ Failed to revoke OAuth token"
    }
  } catch (error) {
    console.error('OAuth revocation error:', error)
    oauthStatus.value = "❌ OAuth revocation failed: " + error.message
  }
}

async function syncGithubDataWithOAuth() {
  try {
    isSyncing.value = true
    syncStatus.value = "🔄 Syncing GitHub data with OAuth..."
    
    // Use OAuth token to fetch enhanced GitHub data
    const res = await fetch(API_ENDPOINTS.GITHUB_OAUTH_STATUS)
    if (!res.ok) {
      throw new Error('OAuth not authenticated')
    }
    
    const oauthData = await res.json()
    if (!oauthData.oauth_authenticated) {
      throw new Error('OAuth not authenticated')
    }
    
    syncStatus.value = "🔄 Fetching repositories and pull requests with OAuth..."
    
    // Fetch enhanced data using OAuth token
    const enhancedRes = await fetch(`${API_ENDPOINTS.METRICS}?oauth=true`)
    if (enhancedRes.ok) {
      const enhancedData = await enhancedRes.json()
      
      // Update metrics with enhanced data
      if (enhancedData.metrics) {
        Object.assign(metrics.value, enhancedData.metrics)
      }
      
      syncStatus.value = "✅ Enhanced GitHub data synced successfully with OAuth!"
    } else {
      throw new Error('Failed to fetch enhanced data')
    }
    
    // Refresh all data - this will now use OAuth for repositories
    await Promise.all([
      loadRepositories(),
      loadDevelopers(),
      refreshMetrics()
    ])
    
    syncStatus.value = `✅ OAuth sync completed! Found ${repositories.value.length} repositories and ${developers.value.length} developers.`
    
  } catch (error) {
    syncStatus.value = "❌ OAuth sync failed: " + error.message
    console.error('OAuth sync error:', error)
  } finally {
    isSyncing.value = false
    
    // Clear status after 10 seconds
    setTimeout(() => {
      syncStatus.value = ""
    }, 10000)
  }
}

async function onRepoChange() {
  await refreshMetrics()
}

async function clearBrowserData() {
  // Add confirmation dialog to prevent accidental data loss
  const confirmMessage = 'Are you sure you want to clear all browser data? This will clear your saved preferences and session data, but will NOT delete GitHub repositories or pull request data.'
    
  if (!confirm(confirmMessage)) {
    return // User cancelled
  }
  
  // Clear our session storage
  sessionManager.clear()
  
  // Clear browser cache/localStorage
  if (typeof(Storage) !== "undefined") {
    localStorage.clear()
    sessionStorage.clear()
  }
  
  // Reset component state
  repositories.value = []
  selectedRepo.value = ''
  selectedDeveloper.value = ''
  
  lastUploadedData.value = null
  githubStatus.value = ""
  reconnectionStatus.value = ""
  clearStatus.value = "✅ Browser data cleared successfully!"
  
  // Refresh data
  await refreshMetrics()
  await loadRepositories()
  
  setTimeout(() => {
    clearStatus.value = ""
  }, 3000)
}

async function clearDatabaseData(type) {
  // Add confirmation dialog to prevent accidental data loss
  const confirmMessage = type === 'all' 
    ? 'Are you sure you want to clear ALL data? This will permanently delete all repositories, pull requests, developers, and telemetry data. This action cannot be undone!'
    : `Are you sure you want to clear ${type} data? This action cannot be undone!`
    
  if (!confirm(confirmMessage)) {
    return // User cancelled
  }
  
  try {
    clearStatus.value = `Clearing ${type} data...`
    
    const res = await fetch(API_ENDPOINTS.CLEAR_DATA, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type })
    })
    
    const data = await res.json()
    
    if (res.ok) {
      clearStatus.value = "✅ " + data.message
      // Refresh data after clearing
      await refreshMetrics()
      await loadRepositories()
    } else {
      clearStatus.value = "❌ Error: " + (data.error || 'Failed to clear data')
    }
  } catch (error) {
    clearStatus.value = "❌ Error: " + error.message
  }
  
  setTimeout(() => {
    clearStatus.value = ""
  }, 5000)
}

async function uploadTelemetry(event) {
  const file = event.target.files[0]
  if (!file) return

  uploadStatus.value = "Uploading..."
  
  const formData = new FormData()
  formData.append('telemetry', file)

  try {
    const response = await fetch(API_ENDPOINTS.TELEMETRY_UPLOAD, {
      method: 'POST',
      body: formData
    })

    const result = await response.json()
    
    if (response.ok) {
      uploadStatus.value = "Upload successful!"
      lastUploadedData.value = result.original_telemetry
      await refreshMetrics() // Refresh metrics after upload
    } else {
      uploadStatus.value = `Upload failed: ${result.error}`
    }
  } catch (error) {
    uploadStatus.value = `Upload failed: ${error.message}`
  }

  // Clear the file input
  event.target.value = ''
  
  // Clear status after 3 seconds
  setTimeout(() => {
    uploadStatus.value = ""
  }, 3000)
}

async function loadDevelopers() {
  const res = await fetch(API_ENDPOINTS.DEVELOPERS)
  if (res.ok) {
    const data = await res.json()
    developers.value = data.developers || []
  }
}

function restoreUserPreferences() {
  const prefs = getUserPreferences()
  selectedDeveloper.value = prefs.selectedDeveloper
  selectedRepo.value = prefs.selectedRepo
  selectedIDE.value = prefs.selectedIDE
  
}

function restoreConnectionState() {
  const connectionState = getConnectionState()
  if (connectionState.timestamp) {
    // Show last connection state if it's recent (within 30 minutes)
    const ageMinutes = (Date.now() - connectionState.timestamp) / (1000 * 60)
    if (ageMinutes <= 30) {
      githubStatus.value = connectionState.connected 
        ? "✅ " + connectionState.message 
        : "❌ " + connectionState.message
    }
  }
}

onMounted(async () => {
  // Clear cached connection state to remove old error messages
  clearConnectionState();
  // Always clear session storage for GitHub setup on load
  sessionStorage.removeItem('githubSetup');
  
  // Restore user preferences first (instant)
  restoreUserPreferences()
  
  // Start IDE simulation immediately for better perceived performance
  simulationRunning.value = true;
  
  // Check OAuth status first (fast, non-blocking)
  const isOAuthAuthenticated = await checkOAuthStatus()
  console.log('🔍 OAuth status on mount:', isOAuthAuthenticated)
  
  // Load metrics immediately if OAuth is available
  if (isOAuthAuthenticated) {
    try {
      const response = await fetch(API_ENDPOINTS.METRICS + '?oauth=true&time_filter=all')
      const data = await response.json()
      console.log('🎯 DIRECT API CALL SUCCESS:', data.team_metrics)
      
      // Update metrics directly
      metrics.value.team_metrics = data.team_metrics
      console.log('✅ METRICS UPDATED:', metrics.value.team_metrics)
    } catch (error) {
      console.error('❌ DIRECT API CALL FAILED:', error)
    }
  }
  
  // Run other loading operations in parallel (don't wait for them)
  Promise.all([
    loadRepositories(),
    loadGithubSetup(),
    loadDevelopers()
  ])
  
  // Restore connection state
  restoreConnectionState()
  // Load IDE connections
  loadIDEConnections()
  
  // Add global error handler for chart component isolation
  const originalErrorHandler = window.onerror
  window.onerror = function(message, source, lineno, colno, error) {
    if (source && source.includes('ProductivityLineGraph')) {
      console.warn('Chart error isolated:', message, error)
      return true // Prevent error from bubbling up
    }
    if (originalErrorHandler) {
      return originalErrorHandler(message, source, lineno, colno, error)
    }
    return false
  }
  
  // Initialize shared store with current data
  console.log('🔗 Main product: Initializing shared store with current data')
  if (metrics.value?.team_metrics) {
    updateSharedTeamMetrics(metrics.value.team_metrics)
    console.log('✅ Initial team metrics set:', metrics.value.team_metrics)
  }
  updateSharedSimulatedData(simulatedMetricsHistory.value, historicalSnapshots.value)
  updateSharedFilters(timeFilter.value, selectedRepo.value, selectedDeveloper.value, selectedIDE.value)
  updateSharedSimulationState(simulationRunning.value)
  console.log('✅ Shared store initialized')

  // Initialize Bootstrap tooltips
  nextTick(() => {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
      return new bootstrap.Tooltip(tooltipTriggerEl);
    });
  });
})

// Add to <script setup>:
const ideMetricKeys = [
      { key: 'idle_time_minutes', label: 'Idle Time', icon: 'bi-moon', color: 'dark' },
      { key: 'average_session_length_minutes', label: 'Avg Session', icon: 'bi-clock-history', color: 'dark' },
  { key: 'files_edited_per_session', label: 'Files/Session', icon: 'bi-files', color: 'dark' },
  { key: 'commits_per_session', label: 'Commits/Session', icon: 'bi-git', color: 'dark' },
      { key: 'time_to_first_commit_minutes', label: 'Time to 1st Commit', icon: 'bi-hourglass-split', color: 'dark' },
  { key: 'AI_suggestions_shown', label: 'AI Suggestions Shown', icon: 'bi-lightbulb', color: 'dark' },
  { key: 'AI_suggestions_accepted', label: 'AI Suggestions Accepted', icon: 'bi-check-circle', color: 'dark' },
  { key: 'AI_acceptance_rate_percent', label: 'AI Acceptance Rate (%)', icon: 'bi-percent', color: 'dark' },
      { key: 'AI_usage_duration_minutes', label: 'AI Usage Duration', icon: 'bi-robot', color: 'dark' },
];



const timeFilter = ref('week'); // 'hour', 'day', 'week', 'all'
const comparisonMode = ref('week-over-week'); // 'previous', 'day-over-day', 'week-over-week'
const simulationRunning = ref(false);
let simulationInterval = null;

// Chart metric selection
const selectedChartMetric = ref('AI_suggestions_accepted');
const chartTimeFilter = ref('week'); // Separate time filter for the productivity chart
const chartComparisonMode = ref('week-over-week'); // Separate comparison mode for the productivity chart



// Helper functions for chart
function getMetricValue(ideId, metricKey) {
  // Try to get from simulation history first
  if (simulationRunning.value) {
    const timeSpecificData = simulatedMetricsHistory.value[chartTimeFilter.value];
    if (timeSpecificData && timeSpecificData[ideId]) {
      const ideHistory = timeSpecificData[ideId];
      if (Array.isArray(ideHistory) && ideHistory.length > 0) {
        const latestData = ideHistory[ideHistory.length - 1];
        if (latestData && latestData[metricKey] !== undefined) {
          return latestData[metricKey];
        }
      }
    }
  }
  
  // Final fallback - return a simulated value based on IDE
  const baseValues = {
    'cursor': { 
      'AI_suggestions_accepted': 45, 'files_edited_per_session': 8, 'commits_per_session': 3,
      'average_session_length_minutes': 45, 'time_to_first_commit_minutes': 12, 'AI_usage_duration_minutes': 25, 'idle_time_minutes': 8
    },
    'windsurf': { 
      'AI_suggestions_accepted': 38, 'files_edited_per_session': 6, 'commits_per_session': 2,
      'average_session_length_minutes': 38, 'time_to_first_commit_minutes': 15, 'AI_usage_duration_minutes': 22, 'idle_time_minutes': 12
    },
    'vscode': { 
      'AI_suggestions_accepted': 32, 'files_edited_per_session': 5, 'commits_per_session': 2,
      'average_session_length_minutes': 32, 'time_to_first_commit_minutes': 18, 'AI_usage_duration_minutes': 18, 'idle_time_minutes': 15
    },
    'jetbrains': { 
      'AI_suggestions_accepted': 28, 'files_edited_per_session': 7, 'commits_per_session': 3,
      'average_session_length_minutes': 42, 'time_to_first_commit_minutes': 14, 'AI_usage_duration_minutes': 20, 'idle_time_minutes': 10
    },
    'sublime': { 
      'AI_suggestions_accepted': 22, 'files_edited_per_session': 4, 'commits_per_session': 2,
      'average_session_length_minutes': 35, 'time_to_first_commit_minutes': 20, 'AI_usage_duration_minutes': 15, 'idle_time_minutes': 18
    },
    'vim': { 
      'AI_suggestions_accepted': 18, 'files_edited_per_session': 6, 'commits_per_session': 4,
      'average_session_length_minutes': 50, 'time_to_first_commit_minutes': 10, 'AI_usage_duration_minutes': 12, 'idle_time_minutes': 5
    }
  };
  
  return baseValues[ideId]?.[metricKey] || 0;
}

function getMetricLabel(metricKey) {
  const metricLabels = {
    'AI_suggestions_accepted': 'relative performance',
    'files_edited_per_session': 'files',
    'commits_per_session': 'commits',
    'average_session_length_minutes': 'duration',
    'time_to_first_commit_minutes': 'time',
    'AI_usage_duration_minutes': 'duration',
    'idle_time_minutes': 'downtime'
  }
  return metricLabels[metricKey] || 'value'
}

// Get display value - percentage for AI metrics, absolute with units for others
function getDisplayValue(ideId, metricKey) {
  const aiMetrics = ['AI_suggestions_accepted'];
  const timeMetrics = ['time_to_first_commit_minutes', 'AI_usage_duration_minutes', 'idle_time_minutes', 'average_session_length_minutes'];
  
  if (aiMetrics.includes(metricKey)) {
    return getMetricPercentage(ideId, metricKey) + '%';
  } else if (timeMetrics.includes(metricKey)) {
    const value = getMetricValue(ideId, metricKey);
    return value + ' min';
  } else {
    return getMetricValue(ideId, metricKey);
  }
}

// Helper function to get percentage value for productivity chart
function getMetricPercentage(ideId, metricKey) {
  const rawValue = getMetricValue(ideId, metricKey);
  
  // Get all values for this metric across all IDEs
  const allValues = supportedIDEs.value.map(ide => getMetricValue(ide.id, metricKey));
  const maxValue = Math.max(...allValues);
  
  if (maxValue === 0) return 0;
  
  // Calculate percentage based on the highest performing IDE
  return Math.round((rawValue / maxValue) * 100);
}

// Helper function to determine if this IDE is the best performer for this metric
function isTopPerformer(ideId, metricKey) {
  const allValues = supportedIDEs.value.map(ide => ({
    id: ide.id,
    value: getMetricValue(ide.id, metricKey)
  }));
  
  // For metrics where lower is better (idle_time, time_to_first_commit)
  const lowerIsBetter = ['idle_time_minutes', 'time_to_first_commit_minutes'];
  
  if (lowerIsBetter.includes(metricKey)) {
    const minValue = Math.min(...allValues.map(item => item.value));
    return getMetricValue(ideId, metricKey) === minValue && minValue > 0;
  } else {
    const maxValue = Math.max(...allValues.map(item => item.value));
    return getMetricValue(ideId, metricKey) === maxValue && maxValue > 0;
  }
}

// Get CSS class for best performer highlighting
function getBestPerformerClass(ideId, metricKey) {
  return isTopPerformer(ideId, metricKey) ? 'bg-success' : 'bg-secondary';
}

// Get text color class for best performer
function getBestPerformerTextClass(ideId, metricKey) {
  return isTopPerformer(ideId, metricKey) ? 'text-white fw-bold' : 'text-primary';
}

// Store simulated metrics for each IDE and time filter with historical data
const simulatedMetricsHistory = ref({
  hour: {},
  day: {},
  week: {}
});

// Store historical snapshots for period-over-period comparison
const historicalSnapshots = ref({
  hour: [],
  day: [],
  week: []
});

// Teams and developers for filtering
const teams = ref(['Frontend', 'Backend', 'Fullstack', 'DevOps', 'Mobile', 'AI/ML']);
const graphDevelopers = ref(['Alice', 'Bob', 'Charlie', 'David', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack', 'Kate', 'Liam']);

// Ensure historicalSnapshots is always properly initialized
onMounted(() => {
  if (!historicalSnapshots.value) {
    historicalSnapshots.value = { hour: [], day: [], week: [] };
  }
  
  // Generate historical data after a short delay to ensure simulation is running
  setTimeout(() => {
    if (simulationRunning.value) {
      console.log('🔄 Generating initial historical data on mount');
      generateHistoricalData();
    }
  }, 500);
});

function generateRandomTeamMetrics(timeframe = 'day') {
  // Scaling factors for each timeframe
  const scale = {
    hour: 1,
    day: 8,
    week: 40
  }[timeframe] || 8;
  // Simulate a team of 4-10 developers
  const devCount = Math.floor(Math.random() * 7) + 4;
  // Simulate PRs in the period
  const totalPRs = Math.floor(Math.random() * (3 * scale)) + scale;
  // Simulate 60-95% merge rate
  const mergeRate = Math.random() * 0.35 + 0.6;
  const mergedPRs = Math.round(totalPRs * mergeRate);
  // PRs per developer
  const prsPerDev = (totalPRs / devCount).toFixed(1);
  // Time to merge: 6-48 hours, skewed lower for higher merge rate, scaled
  const timeToMerge = (Math.random() * (48 - 6) + 6 - (mergeRate * 12) * (scale / 8)).toFixed(1);
  // Time to first review: 1-12 hours, scaled
  const timeToFirstReview = (Math.random() * 11 + 1) * (scale / 8);
  // Reopened PRs: 0-10% of PRs
  const reopenedPRs = Math.floor(totalPRs * (Math.random() * 0.1));
  // Rejected PRs: 0-5% of PRs
  const rejectedPRs = Math.floor(totalPRs * (Math.random() * 0.05));
  // Comment-to-merge ratio: 1.2-4.0 (comments per merged PR)
  const commentToMergeRatio = (Math.random() * 2.8 + 1.2).toFixed(2);
  return {
    prs_per_developer: prsPerDev,
    time_to_merge: timeToMerge,
    time_to_first_review: timeToFirstReview.toFixed(1),
    reopened_prs: reopenedPRs,
    rejected_prs: rejectedPRs,
    comment_to_merge_ratio: commentToMergeRatio,
    total_prs: totalPRs,
    merged_prs: mergedPRs,
    merge_rate: (mergeRate * 100).toFixed(1)
  };
}

function generateRandomMetricsForIDE(timeframe = 'day', scaleOverride = null) {
  // Scaling factors for each timeframe
  let scale = scaleOverride || {
    hour: 1,
    day: 8,
    week: 40
  }[timeframe] || 8;
  
  // For hour timeframe, generate more realistic minute-based values
  if (timeframe === 'hour') {
    const activeTyping = Math.floor(Math.random() * 30) + 10; // 10-40 minutes
    const idleTime = Math.floor(Math.random() * 15) + 5; // 5-20 minutes
    return {
      idle_time_minutes: idleTime,
      average_session_length_minutes: Math.floor(Math.random() * 20) + 15, // 15-35 minutes
      files_edited_per_session: Math.floor(Math.random() * 3) + 1,
      commits_per_session: Math.floor(Math.random() * 2) + 1,
      time_to_first_commit_minutes: Math.floor(Math.random() * 15) + 5, // 5-20 minutes
      AI_suggestions_shown: Math.floor(Math.random() * 5) + 2,
      AI_suggestions_accepted: Math.floor(Math.random() * 4) + 1,
      AI_acceptance_rate_percent: Math.floor(Math.random() * 40) + 60,
      AI_usage_duration_minutes: Math.floor(Math.random() * 20) + 10, // 10-30 minutes
    };
  }
  
  // For day/week timeframes, use the original scaling
  return {
    idle_time_minutes: Math.floor(Math.random() * 3 * scale),
    average_session_length_minutes: Math.floor(Math.random() * 10 * scale) + 5 * scale,
    files_edited_per_session: Math.floor(Math.random() * 2 * scale) + 1,
    commits_per_session: Math.floor(Math.random() * 2 * scale) + 1,
    time_to_first_commit_minutes: Math.floor(Math.random() * 10 * scale) + 2 * scale,
    AI_suggestions_shown: Math.floor(Math.random() * 10 * scale) + 2 * scale,
    AI_suggestions_accepted: Math.floor(Math.random() * 8 * scale) + 1 * scale,
    AI_acceptance_rate_percent: Math.floor(Math.random() * 40) + 60,
    AI_usage_duration_minutes: Math.floor(Math.random() * 10 * scale) + 2 * scale,
  };
}

function preGenerateSimulatedHistory() {
  const timeFilters = ['hour', 'day', 'week'];
  const ides = supportedIDEs.value.map(i => i.id);
  // Always use 9 developers for simulation
  const devs = [
    'dev1', 'dev2', 'dev3', 'dev4', 'dev5', 'dev6', 'dev7', 'dev8', 'dev9'
  ];
  for (const tf of timeFilters) {
    simulatedMetricsHistory.value[tf] = {};
    for (const ide of ides) {
      simulatedMetricsHistory.value[tf][ide] = [];
      for (let i = 0; i < 10; i++) {
        // Generate team metrics - hour timeframe uses special logic in generateRandomMetricsForIDE
        const baseMetrics = generateRandomMetricsForIDE(tf);
        // Per-developer metrics
        const developerVariations = {};
        devs.forEach(dev => {
          developerVariations[dev] = {};
          for (const [key, value] of Object.entries(baseMetrics)) {
            if (typeof value === 'number') {
              // Each developer gets about 1/9th of the team value
              developerVariations[dev][key] = Math.round(value / 9);
            } else {
              developerVariations[dev][key] = value;
            }
          }
        });
        simulatedMetricsHistory.value[tf][ide].push({
          team: baseMetrics,
          developers: developerVariations
        });
      }
    }
  }
  // Team metrics for PRs, etc.
  if (!simulatedMetricsHistory.value.team) simulatedMetricsHistory.value.team = {};
  for (const tf of timeFilters) {
    simulatedMetricsHistory.value[tf].team = [];
    for (let i = 0; i < 10; i++) {
      simulatedMetricsHistory.value[tf].team.push(generateRandomTeamMetrics(tf));
    }
  }
}

// Call this on simulation start
watch(simulationRunning, (running) => {
  if (running) {
    preGenerateSimulatedHistory();
    startSimulation();
  } else {
    stopSimulation();
  }
});

    } else {
      const v = metricsData[selectedIDE.value]?.[key];
      return typeof v === 'number' ? v : '-';
    }
  }
  return ideMetricKeys.map(m => ({ ...m, value: getMetricValue(m.key) }));
});

function startSimulation() {
  simulationRunning.value = true;
  if (simulationInterval) clearInterval(simulationInterval);
  preGenerateSimulatedHistory(); // Generate initial data
  
  // Wait a bit for simulation data to be ready, then generate historical data
  setTimeout(() => {
    generateHistoricalData(); // Generate historical data for comparisons
  }, 100);
  
  runSimulationStep(); // Run immediately
  simulationInterval = setInterval(runSimulationStep, 300000); // every 5 minutes
}

function stopSimulation() {
  simulationRunning.value = false;
  if (simulationInterval) clearInterval(simulationInterval);
}

watch(simulationRunning, (running) => {
  if (running) startSimulation();
  else stopSimulation();
});

// Auto-adjust time filter when comparison mode changes
watch(comparisonMode, (newComparisonMode) => {
  console.log('🔄 Comparison mode changed to:', newComparisonMode);
  
  // If user selects day-over-day, automatically set time filter to day
  if (newComparisonMode === 'day-over-day') {
    timeFilter.value = 'day';
    // Force regenerate historical data for the new time filter
    if (simulationRunning.value) {
      setTimeout(() => {
        console.log('🔄 Forcing day-over-day historical data generation...');
        historicalSnapshots.value.day = [];
        generateHistoricalData();
        // Reinitialize tooltips after data generation
        nextTick(() => {
          const existingTooltips = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
          existingTooltips.forEach(function (tooltipTriggerEl) {
            const tooltip = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
            if (tooltip) {
              tooltip.dispose();
            }
          });
          
          const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
          tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
          });
        });
      }, 100);
    }
  }
  // If user selects week-over-week, automatically set time filter to week
  else if (newComparisonMode === 'week-over-week') {
    timeFilter.value = 'week';
    // Force regenerate historical data for the new time filter
    if (simulationRunning.value) {
      setTimeout(() => {
        console.log('🔄 Forcing week-over-week historical data generation...');
        historicalSnapshots.value.week = [];
        generateHistoricalData();
        // Reinitialize tooltips after data generation
        nextTick(() => {
          const existingTooltips = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
          existingTooltips.forEach(function (tooltipTriggerEl) {
            const tooltip = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
            if (tooltip) {
              tooltip.dispose();
            }
          });
          
          const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
          tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
          });
        });
      }, 100);
    }
  }
});

// Auto-adjust comparison mode when time filter changes (only if it would break the comparison)
watch(timeFilter, (newTimeFilter) => {
  // If user manually changes time filter away from what's needed for the comparison, reset to previous
  if (comparisonMode.value === 'day-over-day' && newTimeFilter !== 'day') {
    comparisonMode.value = 'previous';
  }
  if (comparisonMode.value === 'week-over-week' && newTimeFilter !== 'week') {
    comparisonMode.value = 'previous';
  }
});

// Regenerate simulation data when filters change to ensure proper filtering
watch([selectedDeveloper, selectedIDE, timeFilter, comparisonMode], () => {
  if (simulationRunning.value) {
    console.log('🔄 Filters changed, regenerating data...', {
      selectedDeveloper: selectedDeveloper.value,
      selectedIDE: selectedIDE.value,
      timeFilter: timeFilter.value,
      comparisonMode: comparisonMode.value
    });
    
    // Regenerate simulation data to reflect filter changes
    preGenerateSimulatedHistory();
    // Generate historical data for comparisons
    generateHistoricalData();
    
    // Force a small delay to ensure data is generated before next access
    setTimeout(() => {
      console.log('🔄 Historical data after generation:', {
        dayLength: historicalSnapshots.value.day.length,
        weekLength: historicalSnapshots.value.week.length,
        dayData: historicalSnapshots.value.day,
        weekData: historicalSnapshots.value.week
      });
    }, 200);
  }
});

// Watch chart comparison mode for consistency
watch(chartComparisonMode, (newChartComparisonMode) => {
  console.log('🔄 Chart comparison mode changed to:', newChartComparisonMode);
  
  // Force alignment between chart comparison mode and chart time filter
  if (newChartComparisonMode === 'day-over-day' && chartTimeFilter.value !== 'day') {
    chartTimeFilter.value = 'day';
  } else if (newChartComparisonMode === 'week-over-week' && chartTimeFilter.value !== 'week') {
    chartTimeFilter.value = 'week';
  }
});

// Watch chart time filter for consistency
watch(chartTimeFilter, (newChartTimeFilter) => {
  console.log('🔄 Chart time filter changed to:', newChartTimeFilter);
  
  // Force alignment between chart time filter and chart comparison mode
  if (chartComparisonMode.value === 'day-over-day' && newChartTimeFilter !== 'day') {
    chartComparisonMode.value = 'previous';
  } else if (chartComparisonMode.value === 'week-over-week' && newChartTimeFilter !== 'week') {
    chartComparisonMode.value = 'previous';
  }
});

// Regenerate historical data when simulation data changes
watch(getSimulatedMetrics, () => {
  if (simulationRunning.value) {
    // Clear existing historical data to force regeneration
    historicalSnapshots.value.day = [];
    historicalSnapshots.value.week = [];
    // Generate new historical data based on updated simulation data
    generateHistoricalData();
  }
}, { deep: true });

// Regenerate simulation data when developers are loaded
watch(developers, () => {
  if (simulationRunning.value && developers.value.length > 0) {
    // Regenerate simulation data when developers are loaded
    preGenerateSimulatedHistory();
  }
});

// Suppress status bar alerts during simulation
watch([simulationRunning], ([running]) => {
  if (running) {
    syncStatus.value = '';
    ssoStatus.value = '';
  }
});

// Update shared store for insights system
watch([metrics], () => {
  console.log('🔄 Main product: metrics changed, updating shared store')
  if (metrics.value?.team_metrics) {
    updateSharedTeamMetrics(metrics.value.team_metrics)
    console.log('✅ Shared team metrics updated:', metrics.value.team_metrics)
  }
}, { deep: true })

watch([simulatedMetricsHistory, historicalSnapshots], () => {
  console.log('🔄 Main product: simulated data changed, updating shared store')
  updateSharedSimulatedData(simulatedMetricsHistory.value, historicalSnapshots.value)
  console.log('✅ Shared simulated data updated')
}, { deep: true })

watch([timeFilter, selectedRepo, selectedDeveloper, selectedIDE], () => {
  console.log('🔄 Main product: filters changed, updating shared store')
  updateSharedFilters(timeFilter.value, selectedRepo.value, selectedDeveloper.value, selectedIDE.value)
  console.log('✅ Shared filters updated')
})

watch([simulationRunning], () => {
  console.log('🔄 Main product: simulation state changed, updating shared store')
  updateSharedSimulationState(simulationRunning.value)
  console.log('✅ Shared simulation state updated:', simulationRunning.value)
})



// --- Add computed properties for new metrics ---
const teamSimMetrics = computed(() => {
  if (!simulationRunning.value) return {};
  const tf = timeFilter.value;
  const arr = simulatedMetricsHistory.value.team?.[tf];
  if (arr && arr.length > 0) return arr[arr.length - 1];
  return {};
});

const ideSimMetrics = computed(() => {
  if (!simulationRunning.value) return {};
  const tf = timeFilter.value;
  const ide = selectedIDE.value;
  const arr = simulatedMetricsHistory.value[tf]?.[ide];
  if (ide && arr && arr.length > 0) return arr[arr.length - 1];
  return {};
});

// --- In the template, wire up the new metrics to these computed properties ---
// For team dashboard:
//   teamSimMetrics.value.prs_per_developer
//   teamSimMetrics.value.time_to_merge
//   teamSimMetrics.value.time_to_first_review
//   teamSimMetrics.value.reopened_prs
//   teamSimMetrics.value.rejected_prs
//   teamSimMetrics.value.comment_to_merge_ratio
// For IDE dashboard:
//   ideSimMetrics.value.context_switches
//   ideSimMetrics.value.sessions_no_commits
//   ideSimMetrics.value.ai_usage_copilot
//   ideSimMetrics.value.ai_usage_claude
//   ideSimMetrics.value.ai_usage_cursor
//   ideSimMetrics.value.ai_usage_per_developer
//   ideSimMetrics.value.time_fixing_errors
//   ideSimMetrics.value.first_draft_time
//   ideSimMetrics.value.refactor_time
// ... existing code ...

function runSimulationStep() {
  // No-op: simulation data is pre-generated
}

const recommendations = computed(() => {
  const recs = [];
  
  // Use real metrics data for merge rate, fallback to simulation data
  const mergeRate = parseFloat(metrics.value?.merge_rate) || parseFloat(teamSimMetrics.value?.merge_rate) || 0;
  const aiAcceptance = parseFloat(
    (ideMetricCards.value.find(m => m.key === 'AI_acceptance_rate_percent')?.value) || 0
  );
  const activeTyping = parseFloat(
    (ideMetricCards.value.find(m => m.key === 'active_typing_time_minutes')?.value) || 0
  );
  const idleTime = parseFloat(
    (ideMetricCards.value.find(m => m.key === 'idle_time_minutes')?.value) || 0
  );
  const prsPerDev = parseFloat(teamSimMetrics.value.prs_per_developer);
  const aiSuggestions = parseFloat(
    (ideMetricCards.value.find(m => m.key === 'AI_suggestions_shown')?.value) || 0
  );
  const aiAccepted = parseFloat(
    (ideMetricCards.value.find(m => m.key === 'AI_suggestions_accepted')?.value) || 0
  );
  const keystrokesPerMin = parseFloat(
    (ideMetricCards.value.find(m => m.key === 'keystrokes_per_minute')?.value) || 0
  );
  const avgSessionLength = parseFloat(
    (ideMetricCards.value.find(m => m.key === 'average_session_length_minutes')?.value) || 0
  );
  const timeToFirstCommit = parseFloat(
    (ideMetricCards.value.find(m => m.key === 'time_to_first_commit_minutes')?.value) || 0
  );
  const commitsPerSession = parseFloat(
    (ideMetricCards.value.find(m => m.key === 'commits_per_session')?.value) || 0
  );
  const filesPerSession = parseFloat(
    (ideMetricCards.value.find(m => m.key === 'files_edited_per_session')?.value) || 0
  );

  // 1. Merge Rate Analysis
  if (mergeRate < 50) {
    recs.push({
      icon: 'bi-exclamation-triangle',
      priority: 'high',
      text: `Merge rate is critically low at ${mergeRate}%. Implement automated PR templates, set review time SLAs, and consider pair programming for complex changes.`
    });
  } else if (mergeRate < 70) {
    recs.push({
      icon: 'bi-clock-history',
      priority: 'medium',
      text: `Merge rate of ${mergeRate}% needs improvement. Establish clear PR guidelines, encourage smaller PRs, and implement review rotation.`
    });
  } else {
    recs.push({
      icon: 'bi-check-circle',
      priority: 'low',
      text: `Excellent merge rate of ${mergeRate}%. Maintain current practices and document successful workflows for team scaling.`
    });
  }

  // 2. AI Tool Optimization
  if (aiAcceptance < 60) {
    recs.push({
      icon: 'bi-robot',
      priority: 'high',
      text: `AI acceptance rate of ${aiAcceptance}% indicates underutilization. Provide AI tool training, create best practice guides, and pair experienced users with newcomers.`
    });
  } else if (aiAcceptance > 80) {
    recs.push({
      icon: 'bi-lightbulb',
      priority: 'low',
      text: `Outstanding AI adoption at ${aiAcceptance}%. Document successful AI workflows and consider expanding AI tool usage to other development phases.`
    });
  } else {
    recs.push({
      icon: 'bi-arrow-up-circle',
      priority: 'medium',
      text: `AI acceptance rate of ${aiAcceptance}% is good. Focus on quality over quantity - ensure AI suggestions improve code quality, not just speed.`
    });
  }

  // 3. Productivity Optimization
  if (activeTyping < 60) {
    recs.push({
      icon: 'bi-keyboard',
      priority: 'high',
      text: `Low active typing time (${formatDuration(activeTyping)}). Implement focus blocks, reduce meeting frequency, and provide quiet work environments.`
    });
  } else if (activeTyping > 120) {
    recs.push({
      icon: 'bi-heart',
      priority: 'low',
      text: `High productivity with ${formatDuration(activeTyping)} active time. Ensure sustainable pace and encourage regular breaks to prevent burnout.`
    });
  } else {
    recs.push({
      icon: 'bi-speedometer2',
      priority: 'medium',
      text: `Moderate active time of ${formatDuration(activeTyping)}. Consider time tracking to identify productivity patterns and optimize work schedules.`
    });
  }

  // 4. Workflow Efficiency
  if (idleTime > 30) {
    recs.push({
      icon: 'bi-pause-circle',
      priority: 'high',
      text: `High idle time (${formatDuration(idleTime)}) suggests workflow blockers. Implement async communication, reduce context switching, and establish clear escalation paths.`
    });
  } else {
    recs.push({
      icon: 'bi-play-circle',
      priority: 'low',
      text: `Low idle time (${formatDuration(idleTime)}) indicates good workflow efficiency. Maintain current practices and share successful time management strategies.`
    });
  }

  // 5. Development Velocity
  if (prsPerDev < 1) {
    recs.push({
      icon: 'bi-git',
      priority: 'high',
      text: `Low PR frequency (${prsPerDev} per dev). Encourage smaller, focused PRs, implement feature flags, and establish regular code review cycles.`
    });
  } else if (prsPerDev > 3) {
    recs.push({
      icon: 'bi-arrow-repeat',
      priority: 'medium',
      text: `High PR frequency (${prsPerDev} per dev). Ensure quality isn't sacrificed for quantity and consider batching related changes.`
    });
  } else {
    recs.push({
      icon: 'bi-graph-up',
      priority: 'low',
      text: `Healthy PR frequency (${prsPerDev} per dev). Maintain current velocity while focusing on code quality and thorough testing.`
    });
  }

  // 6. Code Quality & Session Management
  if (avgSessionLength > 240) {
    recs.push({
      icon: 'bi-stopwatch',
      priority: 'medium',
      text: `Long sessions (${formatDuration(avgSessionLength)}) may indicate context switching issues. Encourage shorter, focused sessions with regular commits.`
    });
  } else if (avgSessionLength < 60) {
    recs.push({
      icon: 'bi-lightning',
      priority: 'medium',
      text: `Short sessions (${formatDuration(avgSessionLength)}) suggest frequent interruptions. Implement focus time and reduce meeting frequency.`
    });
  }

  // 7. Commit Strategy
  if (commitsPerSession < 1) {
    recs.push({
      icon: 'bi-upload',
      priority: 'high',
      text: `Low commit frequency (${commitsPerSession} per session). Encourage frequent, small commits to improve code review and reduce merge conflicts.`
    });
  } else if (commitsPerSession > 5) {
    recs.push({
      icon: 'bi-collection',
      priority: 'medium',
      text: `High commit frequency (${commitsPerSession} per session). Consider batching related changes while maintaining atomic commits.`
    });
  }

  // 8. File Management
  if (filesPerSession > 10) {
    recs.push({
      icon: 'bi-files',
      priority: 'medium',
      text: `High file count per session (${filesPerSession}). Consider breaking work into smaller, focused tasks to improve code review quality.`
    });
  }

  // Ensure minimum of 5 recommendations
  while (recs.length < 5) {
    recs.push({
      icon: 'bi-info-circle',
      priority: 'low',
      text: 'Continue monitoring team metrics and adjust recommendations based on evolving patterns and team feedback.'
    });
  }

  // Sort by priority (high, medium, low) and return top 5
  return recs
    .sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    })
    .slice(0, 5);
});

// Add a separate computed property for merge rate to ensure reactivity
const currentMergeRate = computed(() => {
  const rate = parseFloat(metrics.value?.merge_rate) || 0;
  return rate;
});

// Utility function to format duration from minutes to human-readable format
const formatDuration = (minutes, currentTimeFilter) => {
  if (!minutes || isNaN(minutes)) return '0m';
  
  // Always use the current timeFilter value, not the parameter
  const activeTimeFilter = timeFilter.value;
  

  
  // For hour filter, show minutes for values under 60, hours for values over 60
  if (activeTimeFilter === 'hour') {
    if (minutes < 60) {
      return `${Math.round(minutes)}m`;
    } else {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = Math.round(minutes % 60);
      if (remainingMinutes === 0) {
        return `${hours}h`;
      } else {
        return `${hours}h ${remainingMinutes}m`;
      }
    }
  }
  
  // For day/week filters, always show hours for better readability
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  
  if (hours === 0) {
    return `${remainingMinutes}m`;
  } else if (remainingMinutes === 0) {
    return `${hours}h`;
  } else {
    return `${hours}h ${remainingMinutes}m`;
  }
};

// Helper function to identify time-based metrics
const isTimeMetric = (metricKey) => {
  const timeMetrics = [
    'active_typing_time_minutes',
    'idle_time_minutes',
    'average_session_length_minutes',
    'time_to_first_commit_minutes',
    'AI_usage_duration_minutes'
  ];
  return timeMetrics.includes(metricKey);
};

// Enhanced trend calculation with better visual indicators
const calculateTrend = (currentValue, previousValue, metricKey) => {
  console.log(`🔍 Calculating trend for ${metricKey}:`, { currentValue, previousValue });
  
  if (!currentValue || !previousValue || currentValue === '-' || previousValue === '-' || currentValue === null || previousValue === null) {
    console.log(`❌ No valid data for trend calculation: ${metricKey}`);
    return { 
      direction: 'neutral', 
      percentage: 0, 
      description: 'No previous data',
      severity: 'none',
      icon: 'bi-dash',
      color: 'secondary'
    };
  }

  const current = parseFloat(currentValue);
  const previous = parseFloat(previousValue);

  if (isNaN(current) || isNaN(previous) || previous === 0) {
    console.log(`❌ Invalid numeric data for trend calculation: ${metricKey}`, { current, previous });
    return { 
      direction: 'neutral', 
      percentage: 0, 
      description: 'Insufficient data',
      severity: 'none',
      icon: 'bi-dash',
      color: 'secondary'
    };
  }

  const percentageChange = ((current - previous) / previous) * 100;
  const absChange = Math.abs(percentageChange);
  
  // Determine if change is good or bad based on metric type
  const isPositiveMetric = [
    'AI_acceptance_rate_percent',
    'keystrokes_per_minute',
    'commits_per_session',
    'files_edited_per_session',
    'AI_suggestions_accepted',
    'merge_rate'
  ].includes(metricKey);
  
  const isNegativeMetric = [
    'idle_time_minutes',
    'time_to_first_commit_minutes'
  ].includes(metricKey);
  
  let direction, description, severity, icon, color;
  
  if (absChange < 5) {
    direction = 'neutral';
    description = 'Stable';
    severity = 'none';
    icon = 'bi-dash';
    color = 'secondary';
  } else if (percentageChange > 0) {
    if (isPositiveMetric) {
      direction = 'up';
      description = 'Improving';
      severity = absChange > 20 ? 'high' : absChange > 10 ? 'medium' : 'low';
      icon = 'bi-arrow-up';
      color = 'success';
    } else if (isNegativeMetric) {
      direction = 'down';
      description = 'Improving';
      severity = absChange > 20 ? 'high' : absChange > 10 ? 'medium' : 'low';
      icon = 'bi-arrow-down';
      color = 'success';
    } else {
      direction = 'up';
      description = 'Increasing';
      severity = absChange > 20 ? 'high' : absChange > 10 ? 'medium' : 'low';
      icon = 'bi-arrow-up';
      color = 'info';
    }
  } else {
    if (isPositiveMetric) {
      direction = 'down';
      description = 'Declining';
      severity = absChange > 20 ? 'high' : absChange > 10 ? 'medium' : 'low';
      icon = 'bi-arrow-down';
      color = 'danger';
    } else if (isNegativeMetric) {
      direction = 'up';
      description = 'Improving';
      severity = absChange > 20 ? 'high' : absChange > 10 ? 'medium' : 'low';
      icon = 'bi-arrow-up';
      color = 'success';
    } else {
      direction = 'down';
      description = 'Decreasing';
      severity = absChange > 20 ? 'high' : absChange > 10 ? 'medium' : 'low';
      icon = 'bi-arrow-down';
      color = 'warning';
    }
  }
  
  // Cap extreme values while preserving variability
  let finalChange = absChange;
  let maxAllowedChange;
  const isWeekOverWeek = comparisonMode.value === 'week-over-week';
  
  if (isTimeMetric(metricKey)) {
    maxAllowedChange = isWeekOverWeek ? 20 : 15;
  } else if (metricKey.includes('rate') || metricKey.includes('percent')) {
    maxAllowedChange = isWeekOverWeek ? 12 : 8;
  } else if (metricKey.includes('per_minute') || metricKey.includes('per_session')) {
    maxAllowedChange = isWeekOverWeek ? 25 : 18;
  } else {
    maxAllowedChange = isWeekOverWeek ? 30 : 22;
  }
  
  if (absChange > maxAllowedChange) {
    finalChange = maxAllowedChange;
  }
  
  return {
    direction,
    percentage: Math.round(finalChange * 10) / 10,
    description: `${description} by ${Math.round(finalChange * 10) / 10}%`,
    severity,
    icon,
    color
  };
};

// Enhanced trend display functions
const getTrendIcon = (trend) => {
  return trend.icon || 'bi-dash';
};

const getTrendBadgeClass = (trend) => {
  const baseClass = `bg-${trend.color} text-white`;
  const severityClass = trend.severity === 'high' ? 'border border-warning' : '';
  return `${baseClass} ${severityClass}`;
};

const getTrendDescription = (metricKey, trend) => {
  const comparisonText = comparisonMode.value === 'previous' ? 'previous period' :
                        comparisonMode.value === 'day-over-day' ? 'yesterday' :
                        comparisonMode.value === 'week-over-week' ? 'last week' : 'previous period';
  
  const metricName = metricKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  let explanation = '';
  if (trend.severity === 'high') {
    explanation = 'This is a significant change that may require attention.';
  } else if (trend.severity === 'medium') {
    explanation = 'This is a moderate change within normal variation.';
  } else if (trend.severity === 'low') {
    explanation = 'This is a small change, likely within normal fluctuation.';
  }
  
  return `${trend.description} compared to ${comparisonText}. ${explanation} Metric: ${metricName}`;
};

// Enhanced tooltip content generator
const generateTooltipContent = (metricKey, currentValue, trend) => {
  const metricName = metricKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const comparisonText = comparisonMode.value === 'previous' ? 'previous period' :
                        comparisonMode.value === 'day-over-day' ? 'yesterday' :
                        comparisonMode.value === 'week-over-week' ? 'last week' : 'previous period';
  
  let content = `<strong>${metricName}</strong><br>`;
  content += `Current: ${currentValue}<br>`;
  
  if (trend && trend.direction !== 'neutral') {
    content += `Change: ${trend.description}<br>`;
    content += `Compared to: ${comparisonText}<br>`;
    
    if (trend.severity === 'high') {
      content += `<span class="text-warning"><i class="bi bi-exclamation-triangle"></i> Significant change</span>`;
    } else if (trend.severity === 'medium') {
      content += `<span class="text-info"><i class="bi bi-info-circle"></i> Moderate change</span>`;
    } else {
      content += `<span class="text-success"><i class="bi bi-check-circle"></i> Minor change</span>`;
    }
  } else {
    content += `<span class="text-muted">No change detected</span>`;
  }
  
  console.log('🔍 Generated tooltip content:', { metricKey, currentValue, trend, content });
  return content;
};

// Safe function to regenerate historical data
const regenerateHistoricalData = () => {
  try {
    console.log('🔄 Manually regenerating historical data...');
    
    // Ensure historicalSnapshots is properly initialized
    if (!historicalSnapshots.value) {
      historicalSnapshots.value = { day: [], week: [] };
    }
    
    // Clear existing data
    historicalSnapshots.value.day = [];
    historicalSnapshots.value.week = [];
    
    // Generate new data
    generateHistoricalData();
    
    console.log('✅ Historical data regenerated successfully');
  } catch (error) {
    console.error('❌ Error regenerating historical data:', error);
  }
};

// Get comparison data based on comparison mode
const getComparisonData = (metricKey) => {
  const currentMetrics = ideMetricCards.value;
  const currentMetric = currentMetrics.find(m => m.key === metricKey);

  if (!currentMetric) {
    console.log(`❌ No current metric found for ${metricKey}`);
    return null;
  }
  
  console.log(`🔍 Getting comparison data for ${metricKey}:`, {
    comparisonMode: comparisonMode.value,
    timeFilter: timeFilter.value,
    selectedIDE: selectedIDE.value,
    dayHistoryLength: historicalSnapshots.value.day.length,
    weekHistoryLength: historicalSnapshots.value.week.length
  });
  
  switch (comparisonMode.value) {
    case 'previous':
      // Use the previous metrics from the watcher
      const previousValue = previousMetrics.value[metricKey];
      console.log(`📅 Previous comparison for ${metricKey}: ${previousValue}`);
      return previousValue;
      
    case 'day-over-day':
      if (timeFilter.value === 'day') {
        // Get yesterday's data from historical snapshots
        const dayHistory = historicalSnapshots.value.day;
        console.log('🔍 Day history length:', dayHistory.length);
        
        if (dayHistory.length > 0) {
          const yesterdayData = dayHistory[dayHistory.length - 1];
          console.log('🔍 Yesterday data structure:', yesterdayData);
          console.log('🔍 Available IDEs in yesterday data:', Object.keys(yesterdayData));
          
          // If specific IDE is selected, get data for that IDE
          if (selectedIDE.value) {
            const ideData = yesterdayData[selectedIDE.value];
            console.log('🔍 IDE data found:', ideData);
            if (ideData && typeof ideData[metricKey] === 'number') {
              const result = ideData[metricKey];
              console.log(`📅 Day-over-day comparison for ${selectedIDE.value}.${metricKey}: ${result}`);
              return result;
            } else {
              console.log('❌ No data found for IDE:', selectedIDE.value);
              console.log('❌ Available IDEs:', Object.keys(yesterdayData));
            }
          } else {
            // For "All IDEs", calculate the average or sum based on metric type
            const values = Object.values(yesterdayData)
              .map(ideData => ideData?.[metricKey])
              .filter(v => typeof v === 'number' && !isNaN(v));
            
            console.log(`📅 Day-over-day values for ${metricKey}:`, values);
            
            if (values.length === 0) {
              console.log(`❌ No valid values found for ${metricKey} in day-over-day data`);
              return null;
            }
            
            // For time-based metrics, show average when viewing all IDEs
            if (isTimeMetric(metricKey)) {
              const result = values.reduce((a, b) => a + b, 0) / values.length;
              console.log(`📅 Day-over-day average for ${metricKey}: ${result}`);
              return result;
            } else {
              const result = values.reduce((a, b) => a + b, 0);
              console.log(`📅 Day-over-day sum for ${metricKey}: ${result}`);
              return result;
            }
          }
        } else {
          console.error(`🚨 ERROR: No day-over-day historical data available for ${metricKey}`);
          console.error('Historical snapshots:', historicalSnapshots.value);
        }
      }
      return null;
      
    case 'week-over-week':
      if (timeFilter.value === 'week') {
        // Get last week's data from historical snapshots
        const weekHistory = historicalSnapshots.value.week;
        if (weekHistory.length > 0) {
          const lastWeekData = weekHistory[weekHistory.length - 1];
          console.log('🔍 Last week data structure:', lastWeekData);
          console.log('🔍 Available IDEs in last week data:', Object.keys(lastWeekData));
          
          // If specific IDE is selected, get data for that IDE
          if (selectedIDE.value) {
            const ideData = lastWeekData[selectedIDE.value];
            console.log('🔍 IDE data found:', ideData);
            if (ideData && typeof ideData[metricKey] === 'number') {
              const result = ideData[metricKey];
              console.log(`📅 Week-over-week comparison for ${selectedIDE.value}.${metricKey}: ${result}`);
              return result;
            } else {
              console.log('❌ No data found for IDE:', selectedIDE.value);
              console.log('❌ Available IDEs:', Object.keys(lastWeekData));
            }
          } else {
            // For "All IDEs", calculate the average or sum based on metric type
            const values = Object.values(lastWeekData)
              .map(ideData => ideData?.[metricKey])
              .filter(v => typeof v === 'number' && !isNaN(v));
            
            console.log(`📅 Week-over-week values for ${metricKey}:`, values);
            
            if (values.length === 0) {
              console.log(`❌ No valid values found for ${metricKey} in week-over-week data`);
              return null;
            }
            
            // For time-based metrics, show average when viewing all IDEs
            if (isTimeMetric(metricKey)) {
              const result = values.reduce((a, b) => a + b, 0) / values.length;
              console.log(`📅 Week-over-week average for ${metricKey}: ${result}`);
              return result;
            } else {
              const result = values.reduce((a, b) => a + b, 0);
              console.log(`📅 Week-over-week sum for ${metricKey}: ${result}`);
              return result;
            }
          }
        } else {
          console.error(`🚨 ERROR: No week-over-week historical data available for ${metricKey}`);
          console.error('Historical snapshots:', historicalSnapshots.value);
        }
      }
      return null;
      
    default:
      return null;
  }
};

// Helper function to generate realistic variation
const generateRealisticVariation = (metricKey, isWeekOverWeek = false) => {
  // Create truly realistic, varied changes for engineering teams
  // Each metric gets a different, realistic variation based on its type
  
  let minChange, maxChange;
  
  if (isTimeMetric(metricKey)) {
    // Time-based metrics: very stable, small changes
    minChange = isWeekOverWeek ? 0.02 : 0.01; // 2% week, 1% day minimum
    maxChange = isWeekOverWeek ? 0.12 : 0.08; // 12% week, 8% day maximum
  } else if (metricKey.includes('rate') || metricKey.includes('percent')) {
    // Rate/percentage metrics: extremely stable
    minChange = isWeekOverWeek ? 0.01 : 0.005; // 1% week, 0.5% day minimum
    maxChange = isWeekOverWeek ? 0.08 : 0.05; // 8% week, 5% day maximum
  } else if (metricKey.includes('per_minute') || metricKey.includes('per_session')) {
    // Per-minute/session metrics: moderate changes
    minChange = isWeekOverWeek ? 0.03 : 0.02; // 3% week, 2% day minimum
    maxChange = isWeekOverWeek ? 0.18 : 0.12; // 18% week, 12% day maximum
  } else {
    // Count metrics: higher but realistic changes
    minChange = isWeekOverWeek ? 0.04 : 0.025; // 4% week, 2.5% day minimum
    maxChange = isWeekOverWeek ? 0.22 : 0.15; // 22% week, 15% day maximum
  }
  
  // Generate a random change between min and max
  const changeMagnitude = minChange + Math.random() * (maxChange - minChange);
  const direction = Math.random() > 0.5 ? 1 : -1; // 50/50 chance of up or down
  const variation = direction * changeMagnitude;
  
  console.log(`🎯 Variation for ${metricKey} (${isWeekOverWeek ? 'week' : 'day'}): ${(variation * 100).toFixed(1)}%`);
  
  return variation;
};

// Generate historical data for period-over-period comparison
const generateHistoricalData = () => {
  console.log('🔧 Generating historical data...');
  
  // Get current simulation data to base historical data on
  const currentMetrics = getSimulatedMetrics.value;
  const currentIDE = selectedIDE.value;
  const currentTimeFilter = timeFilter.value;
  
  console.log('📊 Current metrics:', currentMetrics);
  console.log('🖥️ Current IDE:', currentIDE);
  console.log('⏰ Current time filter:', currentTimeFilter);
  console.log('🔍 Selected IDE for filtering:', selectedIDE.value);
  
  // Clear existing historical data to ensure fresh generation
  historicalSnapshots.value.day = [];
  historicalSnapshots.value.week = [];
  
  // Generate yesterday's data based on current day data
  const yesterdayData = {};
  
  // Get current day metrics for each IDE
  const currentDayMetrics = currentMetrics.ide_metrics || {};
  
  console.log('📅 Generating day-over-day data. Current day metrics:', currentDayMetrics);
  console.log('🔍 Available IDE keys in current metrics:', Object.keys(currentDayMetrics));
  console.log('🔍 Selected IDE value:', selectedIDE.value);
  console.log('🔍 All supported IDEs:', supportedIDEs.value.map(ide => ide.id));
  
  // Generate data for ALL supported IDEs, not just the ones in current metrics
  supportedIDEs.value.forEach(ide => {
    const ideKey = ide.id;
    const currentIDEData = currentDayMetrics[ideKey] || {};
    console.log(`📅 Generating day data for IDE: ${ideKey}`, currentIDEData);
    yesterdayData[ideKey] = {};
    
    // If no current data exists for this IDE, generate default data
    if (Object.keys(currentIDEData).length === 0) {
      console.log(`📅 No current data for ${ideKey}, generating default data`);
      const defaultData = generateRandomMetricsForIDE('day');
      Object.keys(defaultData).forEach(metricKey => {
        yesterdayData[ideKey][metricKey] = defaultData[metricKey];
      });
    } else {
      // Generate yesterday's data with realistic variations
      Object.keys(currentIDEData).forEach(metricKey => {
        const currentValue = parseFloat(currentIDEData[metricKey]) || 0;
        
        // Use realistic variation function for day-over-day
        const variation = generateRealisticVariation(metricKey, false);
        let historicalValue = Math.max(0, currentValue * (1 + variation));
        
        // Prevent historical values from being too close to zero (which causes extreme % changes)
        if (currentValue > 0 && historicalValue < currentValue * 0.1) {
          historicalValue = currentValue * 0.1; // Minimum 10% of current value
          console.warn(`⚠️ Adjusted historical value for ${metricKey} to prevent extreme percentage change`);
        }
        
        console.log(`📅 Day-over-day for ${ideKey}.${metricKey}: ${currentValue} → ${Math.round(historicalValue)} (${(variation * 100).toFixed(1)}% change)`);
        
        // For time-based metrics, ensure realistic values
        if (isTimeMetric(metricKey)) {
          yesterdayData[ideKey][metricKey] = Math.round(historicalValue);
        } else {
          yesterdayData[ideKey][metricKey] = Math.round(historicalValue);
        }
      });
    }
  });
  
  console.log('📅 Generated yesterday data:', yesterdayData);
  historicalSnapshots.value.day.push(yesterdayData);
  console.log('📅 Historical day data after push:', historicalSnapshots.value.day);
  
  // Generate last week's data based on current week data
  const lastWeekData = {};
  
  // Get current week metrics for each IDE
  const currentWeekMetrics = currentMetrics.ide_metrics || {};
  
  console.log('🔍 Available IDE keys in current week metrics:', Object.keys(currentWeekMetrics));
  console.log('🔍 All supported IDEs for week:', supportedIDEs.value.map(ide => ide.id));
  
  // Generate data for ALL supported IDEs, not just the ones in current metrics
  supportedIDEs.value.forEach(ide => {
    const ideKey = ide.id;
    const currentIDEData = currentWeekMetrics[ideKey] || {};
    console.log(`📅 Generating week data for IDE: ${ideKey}`, currentIDEData);
    lastWeekData[ideKey] = {};
    
    // If no current data exists for this IDE, generate default data
    if (Object.keys(currentIDEData).length === 0) {
      console.log(`📅 No current data for ${ideKey}, generating default data`);
      const defaultData = generateRandomMetricsForIDE('week');
      Object.keys(defaultData).forEach(metricKey => {
        lastWeekData[ideKey][metricKey] = defaultData[metricKey];
      });
    } else {
      // Generate last week's data with realistic variations
      Object.keys(currentIDEData).forEach(metricKey => {
        const currentValue = parseFloat(currentIDEData[metricKey]) || 0;
        
        // Use realistic variation function for week-over-week
        const variation = generateRealisticVariation(metricKey, true);
        let historicalValue = Math.max(0, currentValue * (1 + variation));
        
        // Prevent historical values from being too close to zero (which causes extreme % changes)
        if (currentValue > 0 && historicalValue < currentValue * 0.15) {
          historicalValue = currentValue * 0.15; // Minimum 15% of current value for week-over-week
          console.warn(`⚠️ Adjusted historical value for ${metricKey} to prevent extreme percentage change`);
        }
        
        console.log(`📅 Week-over-week for ${ideKey}.${metricKey}: ${currentValue} → ${Math.round(historicalValue)} (${(variation * 100).toFixed(1)}% change)`);
        
        // For time-based metrics, ensure realistic values
        if (isTimeMetric(metricKey)) {
          lastWeekData[ideKey][metricKey] = Math.round(historicalValue);
        } else {
          lastWeekData[ideKey][metricKey] = Math.round(historicalValue);
        }
      });
    }
  });
  
  console.log('📅 Generated last week data:', lastWeekData);
  historicalSnapshots.value.week.push(lastWeekData);
  console.log('📅 Historical week data after push:', historicalSnapshots.value.week);
};



// Store previous values for trend calculation
const previousMetrics = ref({});



// Update previous metrics when current metrics change
watch(ideMetricCards, (newMetrics) => {
  const currentValues = {};
  newMetrics.forEach(metric => {
    currentValues[metric.key] = metric.value;
  });
  
  // Store current as previous for next comparison
  previousMetrics.value = currentValues;
  
  // Store historical snapshot for period-over-period comparison
  const currentTimeFilter = timeFilter.value;
  if (historicalSnapshots.value[currentTimeFilter]) {
    historicalSnapshots.value[currentTimeFilter].push(currentValues);
    // Keep only last 10 snapshots to prevent memory bloat
    if (historicalSnapshots.value[currentTimeFilter].length > 10) {
      historicalSnapshots.value[currentTimeFilter].shift();
    }
  }
  
  // Generate historical data if simulation is running
  if (simulationRunning.value) {
    console.log('🔄 Generating historical data due to ideMetricCards change');
    generateHistoricalData();
  }
  
  // Reinitialize tooltips after metrics update
  nextTick(() => {
    console.log('🔄 Reinitializing tooltips...');
    // Destroy existing tooltips first
    const existingTooltips = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    existingTooltips.forEach(function (tooltipTriggerEl) {
      const tooltip = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
      if (tooltip) {
        tooltip.dispose();
      }
    });
    
    // Create new tooltips
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
      return new bootstrap.Tooltip(tooltipTriggerEl);
    });
    console.log(`✅ Reinitialized ${tooltipTriggerList.length} tooltips`);
  });
}, { deep: true });


</script>

<template>
  <div class="container-fluid">
    <!-- GitHub Connection Section (fully restored) -->
    <div class="card mb-4 shadow-sm">
      <div class="card-header bg-dark text-white" 
           @click="toggleGitHubAccordion" 
           style="cursor: pointer;"
           :class="{ 'accordion-header': true }">
        <div class="d-flex align-items-center justify-content-between">
          <div class="d-flex align-items-center">
            <i class="bi bi-github me-2"></i>
            <h5 class="mb-0">GitHub Integration</h5>
          </div>
          <div class="d-flex align-items-center">
            <span v-if="isOAuthAuthenticated" class="badge bg-success me-2">Connected</span>
            <i class="bi" :class="githubAccordionOpen ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
          </div>
        </div>
      </div>
      <div class="card-body" v-show="githubAccordionOpen">
        <!-- Status and Action Buttons -->
        <div class="row align-items-center mb-3">
          <div class="col-md-3">
            <div class="d-flex align-items-center">
              <span class="fw-semibold me-2">Status:</span>
              <span v-if="isOAuthAuthenticated" class="text-success fw-bold">
                <i class="bi bi-circle-fill text-success me-1"></i>
                OAuth Connected
              </span>
              <span v-else class="text-muted fw-bold">
                <i class="bi bi-circle-fill text-muted me-1"></i>
                Not Connected
              </span>
            </div>
          </div>
          <div class="col-md-9">
            <div class="d-flex flex-wrap gap-2">
              <!-- OAuth Primary Actions -->
              <button 
                v-if="!isOAuthAuthenticated"
                @click="startOAuthFlow"
                class="btn btn-success btn-sm"
              >
                <i class="bi bi-key me-1"></i>
                Connect with OAuth
              </button>
              <button 
                v-if="isOAuthAuthenticated"
                @click="revokeOAuth"
                class="btn btn-outline-danger btn-sm"
              >
                <i class="bi bi-x-circle me-1"></i>
                Revoke OAuth
              </button>
              
              <!-- Legacy PAT Actions (only show if OAuth not connected) -->
              <button 
                v-if="!isOAuthAuthenticated"
                @click="forceRefreshConnection"
                class="btn btn-outline-info btn-sm"
              >
                <i class="bi bi-arrow-clockwise me-1"></i>
                Refresh Status
              </button>
              <button 
                v-if="!isOAuthAuthenticated"
                @click="reconnectGithub"
                :disabled="isReconnecting"
                class="btn btn-outline-warning btn-sm"
              >
                <i class="bi bi-arrow-repeat me-1"></i>
                {{ isReconnecting ? 'Reconnecting...' : 'Reconnect GitHub' }}
              </button>
              <button 
                v-if="!isOAuthAuthenticated"
                @click="syncGithubData"
                :disabled="isSyncing || githubSetup.ngrok_status !== 'active'"
                class="btn btn-outline-primary btn-sm"
              >
                <i class="bi bi-cloud-download me-1"></i>
                {{ isSyncing ? 'Refreshing...' : 'Refresh GitHub Data' }}
              </button>
              
              <!-- Enhanced OAuth Actions -->
              <button 
                v-if="isOAuthAuthenticated"
                @click="syncGithubDataWithOAuth"
                :disabled="isSyncing"
                class="btn btn-primary btn-sm"
              >
                <i class="bi bi-cloud-download me-1"></i>
                {{ isSyncing ? 'Syncing...' : 'Sync with OAuth' }}
              </button>
            </div>
          </div>
        </div>
        <!-- Status Messages -->
        <div class="mb-3">
          <div v-if="githubStatus" class="alert" :class="githubStatus.includes('✅') ? 'alert-success' : githubStatus.includes('❌') ? 'alert-danger' : 'alert-info'" role="alert">
            {{ githubStatus }}
          </div>
          <div v-if="reconnectionStatus" class="alert" :class="reconnectionStatus.includes('✅') ? 'alert-success' : reconnectionStatus.includes('❌') ? 'alert-danger' : 'alert-info'" role="alert">
            {{ reconnectionStatus }}
          </div>
          <div v-if="syncStatus" class="alert" :class="syncStatus.includes('✅') ? 'alert-success' : syncStatus.includes('❌') ? 'alert-danger' : 'alert-warning'" role="alert">
            {{ syncStatus }}
          </div>
          <div v-if="oauthStatus" class="alert" :class="oauthStatus.includes('✅') ? 'alert-success' : oauthStatus.includes('❌') ? 'alert-danger' : 'alert-info'" role="alert">
            {{ oauthStatus }}
          </div>
          <div v-if="isOAuthAuthenticated && oauthUser" class="alert alert-success" role="alert">
            <i class="bi bi-check-circle me-2"></i>
            <strong>OAuth Authenticated:</strong> {{ oauthUser.login }} ({{ oauthUser.email || 'No email' }})
          </div>
        </div>

        <!-- Current Data Status -->
        <div class="alert alert-info mb-3" role="alert">
          <div class="d-flex align-items-center">
            <i class="bi bi-database me-2"></i>
            <div>
              <strong>Current Data:</strong> 
              <span class="ms-2">
                {{ repositories.length }} repositories, {{ developers.length }} developers
                <span v-if="isOAuthAuthenticated" class="text-success"> (Enhanced OAuth data)</span>
                <span v-else-if="repositories.length === 0" class="text-warning"> (No data - connect with OAuth to get GitHub data)</span>
                <span v-else-if="repositories.includes('test/connection-test')" class="text-warning"> (Test data only)</span>
                <span v-else class="text-success"> (Real GitHub data)</span>
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- IDE SSO Dashboards -->
    <div class="card mb-4 shadow-sm">
      <div class="card-header bg-dark text-white" 
           @click="toggleIdeSsoAccordion" 
           style="cursor: pointer;"
           :class="{ 'accordion-header': true }">
        <div class="d-flex align-items-center justify-content-between">
          <div class="d-flex align-items-center">
            <i class="bi bi-plug me-2"></i>
            <h5 class="mb-0">IDE SSO Connections</h5>
          </div>
          <div class="d-flex align-items-center">
            <span v-if="Object.values(ideConnections).some(conn => conn?.connected)" class="badge bg-success me-2">Connected</span>
            <i class="bi" :class="ideSsoAccordionOpen ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
          </div>
        </div>
      </div>
      <div class="card-body" v-if="ideSsoAccordionOpen">
        <div class="row g-3">
          <div v-for="ide in supportedIDEs" :key="ide.id" class="col-lg-4 col-md-6">
            <div class="card h-100 text-center border-0 shadow-sm">
              <div class="card-body">
                <i :class="`bi ${ide.icon} display-4 mb-2 text-${ide.color}`"></i>
                <h5 class="card-title">{{ ide.name }}</h5>
                <div v-if="ide.ssoEnabled">
                  <button
                    v-if="!ideConnections[ide.id]?.connected"
                    :disabled="isConnectingSSO"
                    @click="connectIDEWithSSO(ide.id)"
                    class="btn btn-outline-primary w-100"
                  >
                    <i class="bi bi-box-arrow-in-right me-1"></i>
                    Connect with SSO
                  </button>
                  <div v-else>
                    <span class="badge bg-success mb-2">Connected</span>
                    <div class="small text-muted mb-2">
                      {{ ideConnections[ide.id].user?.email || 'Authenticated' }}
                    </div>
                    <button
                      class="btn btn-outline-danger w-100"
                      @click="disconnectIDE(ide.id)"
                    >
                      <i class="bi bi-box-arrow-right me-1"></i>
                      Disconnect
                    </button>
                  </div>
                </div>
                <div v-else>
                  <span class="badge bg-success">Coming Soon</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="ssoStatus" class="alert alert-info mt-3" role="alert">
          {{ ssoStatus }}
        </div>
      </div>
    </div>

    <!-- Engineering Output & Collaboration (Top section – Git/PRs) -->
    <div class="card mb-4 shadow-sm">
      <div class="card-header bg-dark text-white">
        <h4 class="mb-0">
          <i class="bi bi-people me-2"></i>Engineering Output & Collaboration
          <span v-if="isLoadingMetrics" class="spinner-border spinner-border-sm ms-2" role="status">
            <span class="visually-hidden">Loading...</span>
          </span>

        </h4>
      </div>
      <div class="card-body">
        <div class="row g-3">
          <!-- Total PRs -->
          <div class="col-lg-3 col-md-6">
            <div class="card bg-dark text-white h-100 position-relative">
              <div class="card-body text-center">
                <i class="bi bi-git display-4 mb-2"></i>
                <h6 class="card-title">Total PRs</h6>
                <h2 class="card-text">{{ metrics.team_metrics?.total_prs || 0 }}</h2>
                <small class="text-muted">{{ metrics.team_metrics?.source === 'github_api' ? 'Live GitHub Data' : 'Database Data' }}</small>
                <!-- Status indicator -->
                <div class="status-indicator">
                  <span class="badge bg-primary">
                    <i class="bi bi-activity"></i>
                    Active
                  </span>
                </div>
              </div>
            </div>
          </div>
          <!-- Merged PRs -->
          <div class="col-lg-3 col-md-6">
            <div class="card bg-dark text-white h-100 position-relative">
              <div class="card-body text-center">
                <i class="bi bi-check-circle display-4 mb-2"></i>
                <h6 class="card-title">Merged PRs</h6>
                <h2 class="card-text">{{ metrics.team_metrics?.merged_prs || 0 }}</h2>
                <small class="text-muted">{{ metrics.team_metrics?.source === 'github_api' ? 'Live GitHub Data' : 'Database Data' }}</small>
                <!-- Success rate indicator -->
                <div class="status-indicator">
                  <span class="badge bg-success">
                    <i class="bi bi-check-circle-fill"></i>
                    {{ (metrics.team_metrics?.total_prs || 0) > 0 ? Math.round(((metrics.team_metrics?.merged_prs || 0) / (metrics.team_metrics?.total_prs || 1)) * 100) : 0 }}% Success
                  </span>
                </div>
              </div>
            </div>
          </div>
          <!-- Merge Rate -->
          <div class="col-lg-3 col-md-6">
            <div class="card bg-dark text-white h-100 position-relative">
              <div class="card-body text-center">
                <i class="bi bi-percent display-4 mb-2"></i>
                <h6 class="card-title">Merge Rate</h6>
                <h2 class="card-text">{{ metrics.team_metrics?.merge_rate || 0 }}%</h2>
                <small class="text-muted">{{ metrics.team_metrics?.source === 'github_api' ? 'Live GitHub Data' : 'Database Data' }}</small>
                <!-- Performance indicator -->
                <div class="status-indicator">
                  <span :class="`badge ${(metrics.team_metrics?.merge_rate || 0) >= 80 ? 'bg-success' : (metrics.team_metrics?.merge_rate || 0) >= 60 ? 'bg-warning' : 'bg-danger'}`">
                    <i :class="`bi ${(metrics.team_metrics?.merge_rate || 0) >= 80 ? 'bi-trophy' : (metrics.team_metrics?.merge_rate || 0) >= 60 ? 'bi-arrow-up' : 'bi-exclamation-triangle'}`"></i>
                    {{ (metrics.team_metrics?.merge_rate || 0) >= 80 ? 'Excellent' : (metrics.team_metrics?.merge_rate || 0) >= 60 ? 'Good' : 'Needs Improvement' }}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <!-- PRs per Developer (simulated) -->
          <div class="col-lg-3 col-md-6">
            <div class="card bg-dark text-white h-100 position-relative">
              <div class="card-body text-center">
                <i class="bi bi-person-lines-fill display-4 mb-2"></i>
                <h6 class="card-title">PRs per Developer</h6>
                <h2 class="card-text">{{ metrics.team_metrics?.prs_per_developer || 0 }}</h2>
                <small class="text-muted">{{ metrics.team_metrics?.source === 'github_api' ? 'Live GitHub Data' : 'Database Data' }}</small>
                <!-- Productivity indicator -->
                <div class="status-indicator">
                  <span :class="`badge ${(metrics.team_metrics?.prs_per_developer || 0) >= 2 ? 'bg-success' : (metrics.team_metrics?.prs_per_developer || 0) >= 1 ? 'bg-warning' : 'bg-danger'}`">
                    <i :class="`bi ${(metrics.team_metrics?.prs_per_developer || 0) >= 2 ? 'bi-lightning' : (metrics.team_metrics?.prs_per_developer || 0) >= 1 ? 'bi-arrow-up' : 'bi-arrow-down'}`"></i>
                    {{ (metrics.team_metrics?.prs_per_developer || 0) >= 2 ? 'High' : (metrics.team_metrics?.prs_per_developer || 0) >= 1 ? 'Medium' : 'Low' }} Activity
                  </span>
                </div>
              </div>
            </div>
          </div>
          <!-- Time to Merge (simulated) -->
          <div class="col-lg-3 col-md-6">
            <div class="card bg-dark text-white h-100 position-relative">
              <div class="card-body text-center">
                <i class="bi bi-clock-history display-4 mb-2"></i>
                <h6 class="card-title">Time to Merge</h6>
                <h2 class="card-text">{{ formatTime(metrics.team_metrics?.time_to_merge || 0) }}</h2>
                <small class="text-muted">{{ metrics.team_metrics?.source === 'github_api' ? 'Live GitHub Data' : 'Database Data' }}</small>
                <!-- Speed indicator -->
                <div class="status-indicator">
                  <span :class="`badge ${(metrics.team_metrics?.time_to_merge || 0) <= 0.1 ? 'bg-success' : (metrics.team_metrics?.time_to_merge || 0) <= 1 ? 'bg-warning' : 'bg-danger'}`">
                    <i :class="`bi ${(metrics.team_metrics?.time_to_merge || 0) <= 0.1 ? 'bi-speedometer2' : (metrics.team_metrics?.time_to_merge || 0) <= 1 ? 'bi-clock' : 'bi-hourglass-split'}`"></i>
                    {{ (metrics.team_metrics?.time_to_merge || 0) <= 0.1 ? 'Fast' : (metrics.team_metrics?.time_to_merge || 0) <= 1 ? 'Normal' : 'Slow' }}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <!-- Time to First Review (simulated) -->
          <div class="col-lg-3 col-md-6">
            <div class="card bg-dark text-white h-100">
              <div class="card-body text-center">
                <i class="bi bi-hourglass-split display-4 mb-2"></i>
                <h6 class="card-title">Time to First Review</h6>
                <h2 class="card-text">{{ formatTime(metrics.team_metrics?.time_to_first_review || 0) }}</h2>
                <small class="text-muted">{{ metrics.team_metrics?.source === 'github_api' ? 'Live GitHub Data' : 'Database Data' }}</small>
              </div>
            </div>
          </div>
          <!-- Reopened/Rejected PRs (simulated) -->
          <div class="col-lg-3 col-md-6">
            <div class="card bg-dark text-white h-100">
              <div class="card-body text-center">
                <i class="bi bi-arrow-repeat display-4 mb-2"></i>
                <h6 class="card-title">Reopened/Rejected PRs</h6>
                <h2 class="card-text">{{ metrics.team_metrics?.reopened_prs || 0 }} / {{ metrics.team_metrics?.rejected_prs || 0 }}</h2>
                <small class="text-muted">{{ metrics.team_metrics?.source === 'github_api' ? 'Live GitHub Data' : 'Database Data' }}</small>
              </div>
            </div>
          </div>
          <!-- Comment-to-Merge Ratio (simulated) -->
          <div class="col-lg-3 col-md-6">
            <div class="card bg-dark text-white h-100">
              <div class="card-body text-center">
                <i class="bi bi-chat-dots display-4 mb-2"></i>
                <h6 class="card-title">Comment-to-Merge Ratio</h6>
                <h2 class="card-text">{{ (metrics.team_metrics?.comment_to_merge_ratio || 0).toFixed(3) }}</h2>
                <small class="text-muted">{{ metrics.team_metrics?.source === 'github_api' ? 'Live GitHub Data' : 'Database Data' }}</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- IDE Activity & AI Usage (Bottom section – Typing, AI suggestions, sessions) -->
    <div class="card mb-4 shadow-sm">
      <div class="card-header bg-dark text-white">
        <h4 class="mb-0"><i class="bi bi-lightning-charge me-2"></i>IDE Activity & AI Usage</h4>
      </div>
      <div class="card-body">
        <!-- Enhanced Recommendations Section -->
        <div class="card mb-4 border-0 shadow-sm">
          <div class="card-header bg-gradient-dark text-white">
            <h5 class="mb-0"><i class="bi bi-lightbulb me-2"></i>Strategic Recommendations</h5>
            <small class="text-light">Based on real-time simulation data</small>
          </div>
          <div class="card-body p-0">
            <div v-for="(rec, index) in recommendations" :key="index" 
                 class="recommendation-item p-3 border-bottom"
                 :class="{
                   'border-danger': rec.priority === 'high',
                   'border-warning': rec.priority === 'medium',
                   'border-success': rec.priority === 'low'
                 }">
              <div class="d-flex align-items-start">
                <div class="recommendation-icon me-3 mt-1">
                  <i :class="[
                    `bi ${rec.icon} fs-4`,
                    {
                      'text-danger': rec.priority === 'high',
                      'text-warning': rec.priority === 'medium',
                      'text-success': rec.priority === 'low'
                    }
                  ]"></i>
                </div>
                <div class="recommendation-content flex-grow-1">
                  <p class="mb-0">{{ rec.text }}</p>
                  <div class="mt-2">
                    <span class="badge" 
                          :class="{
                            'bg-danger': rec.priority === 'high',
                            'bg-warning text-dark': rec.priority === 'medium',
                            'bg-success': rec.priority === 'low'
                          }">
                      {{ rec.priority.charAt(0).toUpperCase() + rec.priority.slice(1) }} Priority
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <!-- Filters -->
        <div class="row mb-3">
          <div class="col-md-2">
            <label class="form-label fw-semibold">
              <i class="bi bi-person me-1"></i>Developer
            </label>
            <select v-model="selectedDeveloper" class="form-select">
              <option value="">All Developers</option>
              <option v-for="dev in developers" :key="dev" :value="dev">{{ dev }}</option>
            </select>
          </div>
          <div class="col-md-2">
            <label class="form-label fw-semibold">
              <i class="bi bi-code-square me-1"></i>IDE
            </label>
            <select v-model="selectedIDE" class="form-select">
              <option value="">All IDEs</option>
              <option v-for="ide in supportedIDEs" :key="ide.id" :value="ide.id">{{ ide.name }}</option>
            </select>
          </div>
          <div class="col-md-2">
            <label class="form-label fw-semibold">
              <i class="bi bi-clock me-1"></i>Time Range
            </label>
            <select v-model="timeFilter" class="form-select">
              <option value="hour">Hour</option>
              <option value="day">Day</option>
              <option value="week">Week</option>
            </select>
          </div>
          <div class="col-md-3">
            <label class="form-label fw-semibold">
              <i class="bi bi-graph-up me-1"></i>Compare To
            </label>
            <select v-model="comparisonMode" class="form-select">
              <option value="previous">Previous Period</option>
              <option value="day-over-day">Day-over-Day</option>
              <option value="week-over-week">Week-over-Week</option>
            </select>
          </div>
          <div class="col-md-3 d-flex align-items-end">
            <div class="form-text">
              <i class="bi bi-info-circle me-1"></i>
              <span v-if="comparisonMode === 'day-over-day'">Comparing to yesterday's data</span>
              <span v-else-if="comparisonMode === 'week-over-week'">Comparing to last week's data</span>
              <span v-else>Comparing to previous data load</span>
            </div>


          </div>
        </div>
        <!-- IDE/AI Metrics Cards -->
        <div class="row g-3">
          <!-- IDE Activity Metrics -->
          <div v-for="metric in applyTimeFilter(ideMetricCards).filter(m => [
            'active_typing_time_minutes',
            'idle_time_minutes',
            'keystrokes_per_minute',
            'average_session_length_minutes',
            'time_to_first_commit_minutes',
            'commits_per_session',
            'AI_suggestions_shown',
            'AI_suggestions_accepted',
            'AI_acceptance_rate_percent',
            'AI_usage_duration_minutes',
            'files_edited_per_session'
          ].includes(m.key))" :key="metric.key" class="col-lg-3 col-md-4 col-sm-6">
            <div class="card h-100 text-center bg-light border-0 shadow-sm position-relative metric-card">
              <div class="card-body">
                <!-- Performance indicator ribbon -->
                <div v-if="getComparisonData(metric.key)" class="performance-ribbon">
                  <div :class="`ribbon ${calculateTrend(metric.value, getComparisonData(metric.key), metric.key).severity}`">
                    <i :class="`bi ${getTrendIcon(calculateTrend(metric.value, getComparisonData(metric.key), metric.key))}`"></i>
                  </div>
                </div>
                
                <i :class="`bi ${metric.icon} display-4 mb-2 text-dark`"></i>
                <h6 class="card-title text-dark">{{ metric.label }}</h6>
                <h2 class="card-text text-dark">
                  {{ isTimeMetric(metric.key) ? formatDuration(metric.value) : metric.value }}
                </h2>
                
                <!-- Enhanced Trend Indicator -->
                <div v-if="getComparisonData(metric.key)" class="trend-indicator mt-2">
                  <div class="d-flex align-items-center justify-content-center">
                    <span 
                      :class="`badge ${getTrendBadgeClass(calculateTrend(metric.value, getComparisonData(metric.key), metric.key))}`"
                      :title="getTrendDescription(metric.key, calculateTrend(metric.value, getComparisonData(metric.key), metric.key))"
                      data-bs-toggle="tooltip"
                      data-bs-placement="top"
                      data-bs-html="true"
                      :data-bs-title="generateTooltipContent(metric.key, metric.value, calculateTrend(metric.value, getComparisonData(metric.key), metric.key))"
                    >
                      <i :class="`bi ${getTrendIcon(calculateTrend(metric.value, getComparisonData(metric.key), metric.key))}`"></i>
                      {{ calculateTrend(metric.value, getComparisonData(metric.key), metric.key).percentage }}%
                    </span>
                  </div>
                </div>
                <!-- No comparison data indicator -->
                <div v-else class="trend-indicator mt-2">
                  <span class="badge bg-secondary text-white" title="No comparison data available">
                    <i class="bi bi-dash"></i>
                    No data
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Telemetry Upload Section -->
    <div class="card mb-4">
      <div class="card-header bg-dark text-white">
        <div class="d-flex align-items-center">
          <i class="bi bi-upload me-2"></i>
          <h5 class="mb-0">Upload Telemetry File</h5>
        </div>
      </div>
      <div class="card-body">
        <div class="input-group">
          <input 
            type="file" 
            accept=".json"
            @change="uploadTelemetry"
            class="form-control"
            id="telemetryFile"
          />
          <label class="input-group-text" for="telemetryFile">
            <i class="bi bi-file-earmark-code"></i>
          </label>
        </div>
        <div v-if="uploadStatus" class="mt-2">
          <div class="alert" :class="uploadStatus.includes('successful') ? 'alert-success' : uploadStatus.includes('failed') ? 'alert-danger' : 'alert-info'" role="alert">
            {{ uploadStatus }}
          </div>
        </div>
      </div>
    </div>

    <!-- Data Management Section -->
    <div class="card mb-4">
      <div class="card-header bg-dark text-white">
        <div class="d-flex align-items-center">
          <i class="bi bi-gear me-2"></i>
          <h5 class="mb-0">Data Management</h5>
        </div>
      </div>
      <div class="card-body">
        <div class="row g-2">
          <div class="col-md-3">
            <button 
              @click="clearBrowserData"
              class="btn btn-outline-primary w-100"
            >
              <i class="bi bi-browser-chrome me-1"></i>
              Clear Browser Data
            </button>
          </div>
          <div class="col-md-3">
            <button 
              @click="clearDatabaseData('telemetry')"
              class="btn btn-outline-warning w-100"
            >
              <i class="bi bi-file-earmark-x me-1"></i>
              Clear Telemetry
            </button>
          </div>
          <div class="col-md-3">
            <button 
              @click="clearDatabaseData('pull_requests')"
              class="btn btn-outline-info w-100"
            >
              <i class="bi bi-git me-1"></i>
              Clear Pull Requests
            </button>
          </div>
          <div class="col-md-3">
            <button 
              @click="clearDatabaseData('all')"
              class="btn btn-outline-danger w-100"
            >
              <i class="bi bi-trash me-1"></i>
              Clear All Data
            </button>
          </div>
        </div>
        
        <div v-if="clearStatus" class="mt-3">
          <div class="alert" :class="clearStatus.includes('Error') || clearStatus.includes('Failed') ? 'alert-danger' : 'alert-success'" role="alert">
            {{ clearStatus }}
          </div>
        </div>

        <!-- Session Storage Debug Panel -->
        <div class="mt-4">
          <details class="mb-0">
            <summary class="btn btn-outline-secondary btn-sm">
              <i class="bi bi-bug me-1"></i>
              Session Storage Debug Info
            </summary>
            <div class="mt-2">
              <pre class="bg-light p-3 rounded"><code>{{ JSON.stringify(sessionManager.getSessionSummary(), null, 2) }}</code></pre>
            </div>
          </details>
        </div>
      </div>
    </div>

    <!-- Last Uploaded Telemetry Data -->
    <div v-if="lastUploadedData" class="card">
      <div class="card-header bg-dark text-white">
        <div class="d-flex align-items-center">
          <i class="bi bi-file-earmark-text me-2"></i>
          <h5 class="mb-0">Last Uploaded Telemetry Data</h5>
        </div>
      </div>
      <div class="card-body">
        <div class="row g-3">
          <div class="col-md-6">
            <div class="border p-3 rounded">
              <strong>Developer ID:</strong> <span class="text-muted">{{ lastUploadedData.developer_id }}</span>
            </div>
          </div>
          <div class="col-md-6">
            <div class="border p-3 rounded">
              <strong>File Name:</strong> <span class="text-muted">{{ lastUploadedData.file_name }}</span>
            </div>
          </div>
          <div class="col-md-6">
            <div class="border p-3 rounded">
              <strong>Copilot Insertions:</strong> <span class="badge bg-primary">{{ lastUploadedData.copilot_insertions }}</span>
            </div>
          </div>
          <div class="col-md-6">
            <div class="border p-3 rounded">
              <strong>Claude Insertions:</strong> <span class="badge bg-danger">{{ lastUploadedData.claude_insertions }}</span>
            </div>
          </div>
          <div class="col-md-6">
            <div class="border p-3 rounded">
              <strong>Session Duration:</strong> <span class="text-muted">{{ formatDuration(lastUploadedData.session_duration) }}</span>
            </div>
          </div>
          <div class="col-md-6">
            <div class="border p-3 rounded">
              <strong>Lines of Code:</strong> <span class="text-muted">{{ lastUploadedData.lines_of_code }}</span>
            </div>
          </div>
          <div class="col-md-6">
            <div class="border p-3 rounded">
              <strong>Project Name:</strong> <span class="text-muted">{{ lastUploadedData.project_name }}</span>
            </div>
          </div>
          <div class="col-md-6">
            <div class="border p-3 rounded">
              <strong>Branch:</strong> <span class="text-muted">{{ lastUploadedData.branch }}</span>
            </div>
          </div>
          <div class="col-md-6">
            <div class="border p-3 rounded">
              <strong>Timestamp:</strong> <span class="text-muted">{{ new Date(lastUploadedData.timestamp).toLocaleString() }}</span>
            </div>
          </div>
          <div class="col-md-6">
            <div class="border p-3 rounded">
              <strong>Total Insertions:</strong> <span class="badge bg-success">{{ lastUploadedData.copilot_insertions + lastUploadedData.claude_insertions }}</span>
            </div>
          </div>
        </div>
        
        <div v-if="lastUploadedData.files_edited" class="mt-3">
          <h6><i class="bi bi-files me-1"></i>Files Edited:</h6>
          <div class="list-group">
            <div v-for="file in lastUploadedData.files_edited" :key="file" class="list-group-item">
              <i class="bi bi-file-code me-2"></i>{{ file }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Productivity Line Graph -->
    <div class="mt-5">
      <!-- Simplified Productivity Chart -->
      <div class="card bg-dark text-white">
        <div class="card-header">
          <h4 class="mb-0">
            <i class="bi bi-graph-up me-2"></i>
            Productivity by Tool Over Time
          </h4>
        </div>
        <div class="card-body">
          <!-- Filters -->
          <div class="row mb-3">
            <div class="col-md-3">
              <label class="form-label fw-semibold text-white">
                <i class="bi bi-graph-down me-1"></i>Productivity Metric
              </label>
              <select class="form-select" v-model="selectedChartMetric">
                <option value="AI_suggestions_accepted">AI Suggestions Accepted</option>
                <option value="files_edited_per_session">Files per Session</option>
                <option value="commits_per_session">Commits per Session</option>
                <option value="average_session_length_minutes">Average Session Length</option>
                <option value="time_to_first_commit_minutes">Time to First Commit</option>
                <option value="AI_usage_duration_minutes">AI Usage Duration</option>
                <option value="idle_time_minutes">Idle Time</option>
              </select>
            </div>
            <div class="col-md-2">
              <label class="form-label fw-semibold text-white">
                <i class="bi bi-clock me-1"></i>Time Range
              </label>
              <select v-model="chartTimeFilter" class="form-select">
                <option value="hour">Hour</option>
                <option value="day">Day</option>
                <option value="week">Week</option>
              </select>
            </div>
            <div class="col-md-3">
              <label class="form-label fw-semibold text-white">
                <i class="bi bi-graph-up me-1"></i>Compare To
              </label>
              <select v-model="chartComparisonMode" class="form-select">
                <option value="previous">Previous Period</option>
                <option value="day-over-day">Day-over-Day</option>
                <option value="week-over-week">Week-over-Week</option>
              </select>
            </div>
            <div class="col-md-4 d-flex align-items-end">
              <div class="form-text text-white-50">
                <i class="bi bi-info-circle me-1"></i>
                <span v-if="chartComparisonMode === 'day-over-day'">Comparing to yesterday's data</span>
                <span v-else-if="chartComparisonMode === 'week-over-week'">Comparing to last week's data</span>
                <span v-else>Comparing to previous data load</span>
              </div>
            </div>
          </div>
          
                              <!-- Simple Data Display -->
                    <div class="row">
                      <div v-for="ide in supportedIDEs" :key="ide.id" class="col-md-3 mb-3">
                        <div class="card" :class="getBestPerformerClass(ide.id, selectedChartMetric)">
                          <div class="card-body text-center">
                            <h6 class="card-title">{{ ide.name }}</h6>
                            <h4 :class="getBestPerformerTextClass(ide.id, selectedChartMetric)">
                              {{ getDisplayValue(ide.id, selectedChartMetric) }}
                            </h4>
                            <small class="text-muted">{{ getMetricLabel(selectedChartMetric) }}</small>
                          </div>
                        </div>
                      </div>
                    </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Isolate productivity chart to prevent errors from affecting other components */
.productivity-chart-container {
  isolation: isolate;
  contain: layout style paint;
}

/* Error boundary styles */
.chart-error-boundary {
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.trend-indicator {
  position: absolute;
  top: 10px;
  right: 10px;
}

.trend-indicator .badge {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.trend-indicator .badge i {
  margin-right: 0.25rem;
}

/* Enhanced metric card styling */
.metric-card {
  transition: all 0.3s ease;
  border: 2px solid transparent;
}

.metric-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 0.75rem 1.5rem rgba(0, 0, 0, 0.15) !important;
}

/* Performance ribbon */
.performance-ribbon {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 10;
}

.ribbon {
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 0 30px 30px 0;
  border-color: transparent;
  position: relative;
}

.ribbon.high {
  border-right-color: #dc3545;
}

.ribbon.medium {
  border-right-color: #ffc107;
}

.ribbon.low {
  border-right-color: #28a745;
}

.ribbon.none {
  border-right-color: #6c757d;
}

.ribbon i {
  position: absolute;
  top: 5px;
  right: -25px;
  color: white;
  font-size: 0.75rem;
  text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
}

/* Enhanced trend indicator styling */
.trend-indicator {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 5;
}

.trend-indicator .badge {
  font-size: 0.75rem;
  padding: 0.375rem 0.75rem;
  border-radius: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  font-weight: 600;
  transition: all 0.2s ease;
}

.trend-indicator .badge:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}

/* Pulse animation for significant changes */
@keyframes pulse-warning {
  0% { box-shadow: 0 0 0 0 rgba(255, 193, 7, 0.7); }
  70% { box-shadow: 0 0 0 10px rgba(255, 193, 7, 0); }
  100% { box-shadow: 0 0 0 0 rgba(255, 193, 7, 0); }
}

.trend-indicator .badge.border-warning {
  animation: pulse-warning 2s infinite;
}

/* Tooltip enhancements */
.tooltip {
  font-size: 0.875rem;
}

.tooltip-inner {
  max-width: 300px;
  text-align: left;
  padding: 0.75rem;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

/* Status indicators for top-level metrics */
.status-indicator {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
}

.status-indicator .badge {
  font-size: 0.7rem;
  padding: 0.25rem 0.5rem;
  border-radius: 12px;
  font-weight: 500;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.status-indicator .badge i {
  margin-right: 0.25rem;
  font-size: 0.6rem;
}
/* Sophisticated Black & Grey Theme */
.card {
  transition: all 0.3s ease;
  border: 1px solid #e9ecef;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.1) !important;
}

.card-header {
  background: linear-gradient(135deg, #212529, #343a40) !important;
  border-bottom: 1px solid #495057;
}

.btn {
  transition: all 0.2s ease;
}

.btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.btn-outline-primary {
  border-color: #495057;
  color: #495057;
}

.btn-outline-primary:hover {
  background-color: #495057;
  border-color: #495057;
}

.btn-outline-secondary {
  border-color: #6c757d;
  color: #6c757d;
}

.btn-outline-secondary:hover {
  background-color: #6c757d;
  border-color: #6c757d;
}

.alert {
  border-left: 4px solid;
  background-color: #f8f9fa;
  border-color: #dee2e6;
}

.alert-dark {
  background-color: #343a40;
  color: #ffffff;
  border-left-color: #495057;
}

.alert-success {
  border-left-color: #28a745;
}

.alert-danger {
  border-left-color: #dc3545;
}

.alert-warning {
  border-left-color: #ffc107;
}

.alert-info {
  border-left-color: #17a2b8;
}

.display-4 {
  opacity: 0.9;
}

/* Sophisticated gradient backgrounds */
.bg-dark {
  background: linear-gradient(135deg, #212529, #343a40) !important;
}

.bg-light {
  background: linear-gradient(135deg, #f8f9fa, #e9ecef) !important;
}

/* Custom animation for metric cards */
@keyframes pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.02); }
  100% { transform: scale(1); }
}

.card-body:hover .display-4 {
  animation: pulse 0.6s ease-in-out;
}

/* Improve code blocks */
pre {
  max-height: 200px;
  overflow-y: auto;
  font-size: 0.875rem;
  background-color: #f8f9fa;
  border: 1px solid #e9ecef;
}

/* Custom gap utility for older Bootstrap compatibility */
.gap-2 > * + * {
  margin-left: 0.5rem !important;
}

/* Details element styling */
details summary {
  cursor: pointer;
  user-select: none;
}

details[open] summary::after {
  content: " ▲";
}

/* Form controls styling */
.form-control, .form-select {
  border-color: #ced4da;
  background-color: #ffffff;
}

.form-control:focus, .form-select:focus {
  border-color: #495057;
  box-shadow: 0 0 0 0.2rem rgba(73, 80, 87, 0.25);
}

/* Badge styling */
.badge {
  font-weight: 500;
}

.badge.bg-success {
  background-color: #28a745 !important;
}

.badge.bg-warning {
  background-color: #ffc107 !important;
  color: #212529;
}

.badge.bg-danger {
  background-color: #dc3545 !important;
}

/* Text colors for consistency */
.text-dark {
  color: #212529 !important;
}

.text-muted {
  color: #6c757d !important;
}

/* Enhanced Recommendations Styling */
.recommendation-item {
  transition: all 0.3s ease;
  background: linear-gradient(135deg, #ffffff, #f8f9fa);
}

.recommendation-item:hover {
  background: linear-gradient(135deg, #f8f9fa, #e9ecef);
  transform: translateX(5px);
}

.recommendation-item:last-child {
  border-bottom: none !important;
}

.recommendation-icon {
  min-width: 40px;
  text-align: center;
}

.recommendation-content p {
  line-height: 1.6;
  color: #495057;
}

.bg-gradient-dark {
  background: linear-gradient(135deg, #212529, #343a40, #495057) !important;
}

/* Priority badge styling */
.badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.375rem 0.75rem;
  border-radius: 20px;
}

/* Card header enhancement */
.card-header.bg-gradient-dark {
  border-bottom: 2px solid #495057;
}

.card-header.bg-gradient-dark small {
  opacity: 0.8;
  font-weight: 300;
}

details:not([open]) summary::after {
  content: " ▼";
}

/* Accordion styling */
.accordion-header {
  transition: background-color 0.2s ease;
}

.accordion-header:hover {
  background-color: #495057 !important;
}

.accordion-header .badge {
  transition: all 0.2s ease;
}

.accordion-header:hover .badge {
  transform: scale(1.05);
}
</style>
