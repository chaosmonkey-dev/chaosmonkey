<template>
  <div class="invite-page">
    <svg width="0" height="0" style="position: absolute;">
      <filter id="chaos-glitch">
        <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" result="turbulence" seed="2" />
        <feDisplacementMap in2="turbulence" in="SourceGraphic" scale="2" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>

    <div class="dashboard-header" style="background-color: #000000;">
      <div class="container-fluid">
        <div class="row align-items-center">
          <div class="col-12">
            <div class="header-content px-3 px-md-4 py-3 py-md-0">
              <div class="d-flex flex-column flex-md-row align-items-start align-items-md-center">
                <img src="../assets/CM-icon.png" alt="ChaosMonkey.dev Logo" class="me-3 dashboard-logo">
                <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet">
                <div>
                  <h1 class="dashboard-title mb-0" style="font-family: 'Bebas Neue'; filter: url(#chaos-glitch);">
                    CHAOSMONKEY
                  </h1>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="container-fluid py-4">
      <div class="row justify-content-center">
        <div class="col-12 col-xl-8 col-xxl-7">

          <div v-if="loading" class="text-center py-20">
            <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
            <p class="text-muted">Loading invite...</p>
          </div>

          <div v-else-if="error" class="card border-danger">
            <div class="card-body text-center py-8">
              <div class="text-danger display-1 mb-4">⚠️</div>
              <h2 class="card-title text-danger">Invite Not Found</h2>
              <p class="card-text text-muted">{{ error }}</p>
            </div>
          </div>

          <div v-else-if="state === 'expired'" class="card border-warning">
            <div class="card-body text-center py-8">
              <div class="text-warning display-1 mb-4">⏰</div>
              <h2 class="card-title text-warning">Invite Expired</h2>
              <p class="card-text text-muted">This invite has expired. Please ask your organization admin to send a new invite.</p>
            </div>
          </div>

          <div v-else-if="state === 'redeemed'" class="card border-info">
            <div class="card-body text-center py-8">
              <div class="text-info display-1 mb-4">✅</div>
              <h2 class="card-title text-info">Invite Already Used</h2>
              <p class="card-text text-muted">This invite has already been redeemed.</p>
            </div>
          </div>

          <div v-else-if="state === 'no_setup'" class="card border-warning">
            <div class="card-body text-center py-8">
              <div class="text-warning display-1 mb-4">⚠️</div>
              <h2 class="card-title text-warning">Setup Not Available</h2>
              <p class="card-text text-muted">This invite is valid, but a setup code is not available. Please contact your organization admin.</p>
            </div>
          </div>

          <div v-else-if="state === 'valid'" class="space-y-4">
            <div class="card border-0 shadow-sm">
              <div class="card-body text-center py-5">
                <h2 class="display-5 mb-3">You've been invited to use ChaosMonkey</h2>
                <p class="lead mb-2">
                  <span class="text-primary fw-bold">{{ invite.organization_name }}</span>
                </p>
                <p class="text-muted mb-0">
                  Invited developer: <code>{{ invite.email }}</code>
                </p>
                <p class="text-muted small mt-2">
                  No ChaosMonkey dashboard account is required.
                </p>
              </div>
            </div>

            <div class="card border-0 shadow-sm">
              <div class="card-body p-5">
                <div class="d-flex align-items-center mb-4">
                  <div class="bg-success text-white rounded d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
                    <i class="bi bi-download fs-4"></i>
                  </div>
                  <div class="ms-3">
                    <h5 class="mb-1">ChaosMonkey {{ setup.extension_version }}</h5>
                    <p class="text-muted small mb-0">Download the extension VSIX for your IDE.</p>
                  </div>
                </div>

                <a :href="setup.vsix_download_url" class="btn btn-primary btn-lg w-100 mb-3" rel="noopener noreferrer" target="_blank">
                  Download ChaosMonkey extension
                </a>

                <p class="text-muted small mb-0">
                  The same enrollment code works in VS Code, Cursor, and Devin. Every editor gets its own secure installation connection.
                </p>
              </div>
            </div>

            <div class="card border-0 shadow-sm">
              <div class="card-body p-5">
                <h3 class="card-title text-center mb-4">Connection Details</h3>

                <div class="mb-4">
                  <label class="form-label fw-bold">API Base URL</label>
                  <pre class="bg-dark text-light rounded p-3 font-monospace small mb-0" style="white-space: pre; overflow-x: auto;">{{ setup.api_base_url }}</pre>
                </div>

                <div class="mb-3">
                  <label class="form-label fw-bold">Personal Enrollment Code</label>
                  <div class="input-group">
                    <pre class="form-control bg-dark text-light font-monospace small mb-0" style="white-space: pre; overflow-x: auto;">{{ setup.connect_code }}</pre>
                    <button class="btn btn-outline-dark" type="button" @click="copyCode">
                      <span v-if="copySuccess">Copied!</span>
                      <span v-else>Copy</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="card border-0 shadow-sm">
              <div class="card-body p-5">
                <h3 class="card-title text-center mb-4">Setup Steps</h3>

                <ol class="list-group list-group-numbered">
                  <li class="list-group-item">Download the VSIX.</li>
                  <li class="list-group-item">In VS Code, Cursor, or Devin, open Extensions.</li>
                  <li class="list-group-item">Select "Install from VSIX…" and choose the file.</li>
                  <li class="list-group-item">Open the Command Palette.</li>
                  <li class="list-group-item">Run <strong>ChaosMonkey: Connect</strong>.</li>
                  <li class="list-group-item">Enter the displayed API Base URL.</li>
                  <li class="list-group-item">Enter the displayed Personal Enrollment Code.</li>
                </ol>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import api, { API_URL } from '../config/api.js'

const route = useRoute()

const loading = ref(true)
const error = ref(null)
const invite = ref(null)
const setup = ref(null)
const copySuccess = ref(false)

const state = computed(() => {
  if (loading.value) return 'loading'
  if (error.value) return 'error'
  if (!invite.value) return 'error'
  if (invite.value.is_expired) return 'expired'
  if (invite.value.is_redeemed) return 'redeemed'
  if (!setup.value || !setup.value.connect_code) return 'no_setup'
  return 'valid'
})

const copyCode = async () => {
  if (!setup.value?.connect_code) return
  try {
    await navigator.clipboard.writeText(setup.value.connect_code)
    copySuccess.value = true
    setTimeout(() => { copySuccess.value = false }, 2000)
  } catch (err) {
    console.error('Failed to copy code:', err)
  }
}

const loadInvite = async () => {
  const token = route.params.token
  if (!token) {
    error.value = 'No invite token provided.'
    loading.value = false
    return
  }

  try {
    const { data } = await api.get(`${API_URL}/invites/${token}`)
    invite.value = data.invite || null
    setup.value = data.setup || null
  } catch (err) {
    if (err.response?.status === 404) {
      error.value = 'This invite link is not valid or has expired.'
    } else {
      error.value = err.response?.data?.error || 'Unable to load this invite. Please try again or contact your organization admin.'
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadInvite()
})
</script>

<style scoped>
.invite-page {
  background-color: #f8f9fa;
  min-height: 100vh;
}

.dashboard-header {
  background: #000000 !important;
  color: white;
  margin-bottom: 2rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.dashboard-logo {
  height: 6.5rem;
  width: auto;
}

.dashboard-title {
  font-size: 3rem;
  font-weight: bold;
  margin: 0;
  color: white;
}

@media (max-width: 768px) {
  .dashboard-title {
    font-size: 2rem;
  }

  .dashboard-logo {
    height: 4rem;
  }
}

.btn-primary {
  background-color: #000;
  border-color: #000;
}

.btn-primary:hover {
  background-color: #333;
  border-color: #333;
}

.btn-outline-dark:hover {
  background-color: #000;
  border-color: #000;
  color: #fff;
}

.card {
  border-radius: 0.5rem;
}

.border-primary {
  border-color: #000 !important;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.animate-spin {
  animation: spin 1s linear infinite;
}

.list-group-item {
  border: none;
  padding: 0.75rem 0;
  background: transparent;
}
</style>
