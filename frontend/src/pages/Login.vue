<template>
  <div class="login-container">
    <div class="login-modal">
      <div class="login-header text-center">
        <img src="../assets/CM-cropped.png" alt="ChaosMonkey.dev Logo" class="logo">
     
      </div>
      <div class="login-body text-center">
        <p class="mb-4">Sign in to access your engineering dashboard</p>
        
        <!-- GitHub Authentication Options (hidden when OAuth unconfigured) -->
        <div v-if="githubConfigured" class="github-auth-section mb-4">
          <div class="d-grid gap-2">
            <button 
              @click="signInWithGitHub" 
              class="btn btn-dark btn-lg sign-in-btn"
              :disabled="isLoading"
              aria-label="Sign in with GitHub"
            >
              <i class="bi bi-github me-2" aria-hidden="true"></i>
              {{ isLoading ? 'Redirecting...' : 'Sign in with GitHub' }}
            </button>
            
            <button 
              @click="createAccountWithGitHub" 
              class="btn btn-outline-dark btn-lg sign-in-btn"
              :disabled="isCreatingAccount"
              aria-label="Create account with GitHub"
            >
              <i class="bi bi-person-plus me-2" aria-hidden="true"></i>
              {{ isCreatingAccount ? 'Redirecting...' : 'Create Account with GitHub' }}
            </button>
          </div>
          
          <div class="text-muted small mt-2">
            <i class="bi bi-info-circle me-1"></i>
            New to ChaosMonkey? Use "Create Account" to set up your organization.
          </div>
        </div>

        <div v-if="githubConfigured" class="my-3">or</div>

        <!-- Email/Password Login -->
        <div class="email-auth-section mb-4">
          <form @submit.prevent="signInWithEmail" class="d-flex flex-column gap-2">
            <div class="form-group text-start">
              <label for="email" class="form-label small text-muted">Email</label>
              <input
                id="email"
                v-model="emailForm.email"
                type="email"
                class="form-control form-control-lg"
                placeholder="you@example.com"
                :disabled="isLoadingEmail"
                autocomplete="email"
                required
              />
            </div>
            <div class="form-group text-start">
              <label for="password" class="form-label small text-muted">Password</label>
              <input
                id="password"
                v-model="emailForm.password"
                type="password"
                class="form-control form-control-lg"
                placeholder="Password"
                :disabled="isLoadingEmail"
                autocomplete="current-password"
                required
              />
            </div>
            <div v-if="emailError" class="alert alert-danger py-2 mb-0" role="alert">
              {{ emailError }}
            </div>
            <button
              type="submit"
              class="btn btn-primary btn-lg sign-in-btn"
              :disabled="isLoadingEmail"
            >
              <span v-if="isLoadingEmail" class="spinner-border spinner-border-sm me-2"></span>
              {{ isLoadingEmail ? 'Signing in...' : 'Sign in with Email' }}
            </button>
          </form>
          <div class="text-muted small mt-2">
            <i class="bi bi-info-circle me-1"></i>
            Need access? Ask your organization admin for an invite.
          </div>
        </div>

        <div class="my-3">or</div>

        <!-- SSO options container -->
        <div class="sso-options">
          <button 
            @click="signInWithAtlassian"
            class="btn btn-atlassian btn-lg sign-in-btn"
            :disabled="isLoadingAtlassian"
            :aria-busy="isLoadingAtlassian"
            aria-label="Sign in with Atlassian (SSO)"
          >
              <!-- Official Atlassian logo (inline SVG, clearer mark) -->
              <svg class="me-2 atlassian-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 80" width="20" height="20" aria-hidden="true" focusable="false">
                <g fill="none" fill-rule="evenodd">
                  <path d="M26.8 11.2c-2.52 0-4.56 2.04-4.56 4.56 0 2.51 2.04 4.56 4.56 4.56s4.56-2.05 4.56-4.56c0-2.52-2.04-4.56-4.56-4.56zm33.8 0c-2.52 0-4.56 2.04-4.56 4.56 0 2.51 2.04 4.56 4.56 4.56s4.56-2.05 4.56-4.56c0-2.52-2.04-4.56-4.56-4.56z" fill="#2684FF"/>
                  <path d="M95 5.5c-2.2 0-4 1.78-4 4v40c0 2.2 1.8 4 4 4h18c2.2 0 4-1.8 4-4V9.5c0-2.2-1.8-4-4-4H95z" fill="#2684FF" opacity="0.95"/>
                  <text x="130" y="32" font-family="Inter, Arial, sans-serif" font-size="20" fill="#172B4D">Atlassian</text>
                </g>
              </svg>
            <span v-if="isLoadingAtlassian" class="spinner-wrap" aria-hidden="true">
              <span class="spinner-border spinner-border-sm me-2" role="status"></span>
            </span>
            {{ isLoadingAtlassian ? 'Redirecting...' : 'Sign in with Atlassian' }}
          </button>

          <div class="sso-helper text-muted small mt-2">Use your Atlassian account (SSO) to access org resources.</div>

          <noscript>
            <div class="mt-2">
              <a :href="`${apiBaseUrl}/api/atlassian/oauth/redirect`" class="btn btn-atlassian btn-sm">Sign in with Atlassian (no-JS)</a>
            </div>
          </noscript>

          <!-- Inline error area for Atlassian SSO -->
          <div v-if="atlassianError" class="mt-3" role="alert" aria-live="assertive">
            <div class="alert alert-danger">
              <div class="d-flex align-items-start justify-content-between">
                <div>
                  <strong>SSO failed</strong>
                  <div class="small">{{ atlassianError }}</div>
                </div>
                <div class="d-flex align-items-center gap-2">
                  <button class="btn btn-sm btn-light" @click="retryAtlassian" :disabled="isLoadingAtlassian">Retry</button>
                  <button class="btn btn-sm btn-outline-secondary" @click="dismissAtlassianError" aria-label="Dismiss error">Dismiss</button>
                </div>
              </div>

              <div v-if="atlassianErrorDetail" class="mt-2 small text-monospace text-break">
                <div><strong>Debug:</strong></div>
                <pre style="white-space:pre-wrap">{{ atlassianErrorDetail }}</pre>
                <button class="btn btn-xs btn-outline-secondary mt-1" @click.prevent="copyAtlassianErrorDetail">Copy details</button>
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
import { API_URL } from '../config/api'

const router = useRouter()
const authStore = useAuthStore()

const isLoading = ref(false)
const isCreatingAccount = ref(false)
const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID

// CR-X: Email/password login state
const githubConfigured = ref(true)
const emailForm = ref({ email: '', password: '' })
const isLoadingEmail = ref(false)
const emailError = ref('')

const signInWithEmail = async () => {
  emailError.value = ''
  isLoadingEmail.value = true
  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: emailForm.value.email.trim(),
        password: emailForm.value.password,
      })
    })
    const data = await response.json()
    if (!response.ok) {
      emailError.value = data.message || data.error || 'Login failed'
      return
    }
    if (data.dashboard_token) {
      localStorage.setItem('api_token', data.dashboard_token)
      authStore.token = data.dashboard_token
      authStore.isAuthed = true
      router.push('/dashboards?v2=1')
    } else {
      emailError.value = 'No dashboard token received'
    }
  } catch (e) {
    emailError.value = 'Network error. Please try again.'
  } finally {
    isLoadingEmail.value = false
  }
}

// Check if user is already authenticated
const checkOAuthStatus = async () => {
  try {
    console.log('Checking OAuth status...')
    const response = await fetch(`${API_URL}/github/oauth/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    })
    
    if (response.ok) {
      const data = await response.json()
      console.log('OAuth status response:', data)

      if (data.oauth_configured === false) {
        githubConfigured.value = false
      }

      if (data.oauth_authenticated) {
        console.log('OAuth connected on backend, but no dashboard token — user must complete login flow')
      }
    }
    console.log('User not authenticated, showing login form')
  } catch (error) {
    console.error('Failed to check OAuth status:', error)
  }
}

const signInWithGitHub = async () => {
  isLoading.value = true
  
  try {
    console.log('Starting GitHub OAuth flow for sign in...')
    // Use the existing working OAuth flow from your backend
    const response = await fetch(`${API_URL}/github/oauth/redirect?intent=login`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    })
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const data = await response.json()
    
    if (data.auth_url) {
      console.log('Redirecting to GitHub OAuth URL...')
      // Redirect to the GitHub OAuth URL provided by your backend
      window.location.href = data.auth_url
    } else {
      throw new Error('No auth URL received from backend')
    }
  } catch (error) {
    console.error('OAuth redirect failed:', error)
    // fallback inline error experience: reuse the Atlassian error area for simplicity
    atlassianError.value = 'Failed to start GitHub OAuth. Please try again.'
    isLoading.value = false
  }
}

const createAccountWithGitHub = async () => {
  isCreatingAccount.value = true
  
  try {
    console.log('Starting GitHub OAuth flow for account creation...')
    // Use the same OAuth flow but with account creation flag
    const response = await fetch(`${API_URL}/github/oauth/redirect?intent=login&create_account=true`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    })
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const data = await response.json()
    
    if (data.auth_url) {
      console.log('Redirecting to GitHub OAuth URL for account creation...')
      // Redirect to the GitHub OAuth URL provided by your backend
      window.location.href = data.auth_url
    } else {
      throw new Error('No auth URL received from backend')
    }
  } catch (error) {
    console.error('OAuth redirect failed for account creation:', error)
    // fallback inline error experience: reuse the Atlassian error area for simplicity
    atlassianError.value = 'Failed to start GitHub account creation. Please try again.'
    isCreatingAccount.value = false
  }
}

const isLoadingAtlassian = ref(false)
const atlassianError = ref(null)
const atlassianErrorDetail = ref(null)
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''
const signInWithAtlassian = async () => {
  atlassianError.value = null
  isLoadingAtlassian.value = true
  const url = `${apiBaseUrl}/api/atlassian/oauth/redirect`
  try {
    const response = await fetch(url, { method: 'GET' })
    const status = response.status
    const text = await response.text()
    const bodySnippet = text ? text.slice(0, 300) : ''

    if (!response.ok) {
      // Log structured diagnostic for developers
      console.error('[ATLAS_SSO_START_FAILED]', { url, status, bodySnippet })
      // Friendly user message + short diagnostic in UI
      atlassianError.value = `Couldn't start Atlassian sign-in. Backend responded ${status}. See console for details.`
      // Attach developer detail for copy/paste (visible in UI for devs)
      atlassianErrorDetail.value = { url, status, bodySnippet }
      isLoadingAtlassian.value = false
      return
    }

    // success path
    let data
    try { data = JSON.parse(text) } catch (e) { data = null }
    const authUrl = data?.auth_url ?? data?.url ?? null
    if (authUrl) {
      window.location.href = authUrl
    } else {
      console.error('[ATLAS_SSO_START_FAILED] missing authUrl', { url, status, bodySnippet })
      atlassianError.value = `Couldn't start Atlassian sign-in: invalid response from backend.`
      atlassianErrorDetail.value = { url, status, bodySnippet }
      isLoadingAtlassian.value = false
    }
  } catch (e) {
    // network/other unexpected error
    console.error('[ATLAS_SSO_START_FAILED] network/error', { url, error: e?.message })
    atlassianError.value = `Couldn't start Atlassian sign-in. Network or server error.`
    atlassianErrorDetail.value = { url, error: String(e?.message).slice(0,300) }
    isLoadingAtlassian.value = false
  }
}

function dismissAtlassianError() { atlassianError.value = null; atlassianErrorDetail.value = null }
function retryAtlassian() { signInWithAtlassian() }

function copyAtlassianErrorDetail() {
  try {
    const payload = typeof atlassianErrorDetail.value === 'string' ? atlassianErrorDetail.value : JSON.stringify(atlassianErrorDetail.value, null, 2)
    navigator.clipboard.writeText(payload)
    console.log('[ATLAS_SSO_COPY] copied diagnostic to clipboard')
  } catch (e) {
    console.warn('Copy failed', e)
  }
}

// Check OAuth status when component mounts
onMounted(() => {
  console.log('Login component mounted, checking OAuth status...')
  checkOAuthStatus()
})
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000000;
  padding: 20px;
}

.login-modal {
  background: white;
  border-radius: 20px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
  padding: 40px;
  width: 100%;
  max-width: 500px;
  text-align: center;
}

.login-header {
  margin-bottom: 0px;
}

.logo {
  height: 10rem;
  width: auto;
  margin-bottom: 0;
}

.login-header h2 {
  color: #333;
  font-weight: 600;
  margin-bottom: 0;
}

.login-body p {
  color: #666;
  font-size: 1.1rem;
  margin-bottom: 2rem;
}

.sign-in-btn {
  padding: 12px 30px;
  font-size: 1.1rem;
  border-radius: 10px;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
}

.sign-in-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
}

.sign-in-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  transform: none;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
}

/* SSO styles */
.sso-options { display:flex; flex-direction:column; align-items:center; gap:0.5rem }
.btn-atlassian { background: linear-gradient(180deg,#2684FF,#0052CC); color: white; border: none }
.btn-atlassian:hover { filter: brightness(0.95) }

.sso-helper { max-width: 320px }

/* GitHub Auth Section Styles */
.github-auth-section {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #e9ecef;
}

/* Email Auth Section Styles */
.email-auth-section {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #e9ecef;
}

.github-auth-section .btn-dark {
  background: #24292e;
  border: none;
}

.github-auth-section .btn-outline-dark {
  border: 2px solid #24292e;
  color: #24292e;
}

.github-auth-section .btn-outline-dark:hover {
  background: #24292e;
  color: white;
}

/* Inline alert tweaks */
.alert { border-radius: 10px; padding: 10px 14px }

/* Responsive adjustments */
@media (max-width: 576px) {
  .login-modal {
    padding: 30px 20px;
    margin: 20px;
  }
  
  .logo {
    height: 5rem;
  }
  
  .login-header h2 {
    font-size: 1.5rem;
  }
}

/* Atlassian mark sizing tweak */
.atlassian-mark { width: 18px; height: 18px; }
</style>
