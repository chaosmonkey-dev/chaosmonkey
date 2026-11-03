<template>
  <div class="enroll-page">
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

          <div v-if="!state" class="card border-0 shadow-sm">
            <div class="card-body p-5">
              <h2 class="text-center mb-3">Set up ChaosMonkey</h2>
              <p class="text-muted text-center mb-4">
                Enter the work email address your engineering leader included in this rollout.
              </p>
              <form @submit.prevent="submitEmail">
                <div class="mb-3">
                  <label for="enrollEmail" class="form-label">Work email address</label>
                  <input
                    v-model="emailInput"
                    type="email"
                    id="enrollEmail"
                    class="form-control"
                    placeholder="developer@company.com"
                    :disabled="submitting"
                    required
                  >
                </div>
                <button
                  type="submit"
                  class="btn btn-primary btn-lg w-100"
                  :disabled="submitting"
                >
                  <span v-if="submitting" class="spinner-border spinner-border-sm me-2"></span>
                  <span v-if="submitting">Checking...</span>
                  <span v-else>Continue</span>
                </button>
              </form>
            </div>
          </div>

          <div v-else-if="state === 'loading'" class="text-center py-5">
            <div class="spinner-border text-primary" role="status">
              <span class="visually-hidden">Loading setup...</span>
            </div>
            <p class="text-muted mt-2">Loading setup...</p>
          </div>

          <div v-else-if="state === 'error'" class="card border-danger">
            <div class="card-body text-center py-5">
              <div class="text-danger display-1 mb-4">
                <i class="bi bi-exclamation-triangle-fill"></i>
              </div>
              <h2 class="card-title text-danger">Not included or unavailable</h2>
              <p class="card-text text-muted mt-3">
                This email is not included in this rollout, or the rollout link has been revoked.
                Check the email address or contact your engineering leader.
              </p>
            </div>
          </div>

          <div v-else-if="state === 'success'" class="space-y-4">
            <div class="card border-0 shadow-sm">
              <div class="card-body text-center py-5">
                <h2 class="display-5 mb-3">You're ready to set up ChaosMonkey</h2>
                <p class="lead mb-2">
                  <span class="text-primary fw-bold">{{ invite.organization_name }}</span>
                </p>
                <p class="text-muted mb-0">
                  Developer: <code>{{ invite.email }}</code>
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

                <a :href="setup.vsix_download_url" class="btn btn-primary btn-lg w-100 mb-3" rel="noopener noreferrer">
                  Download ChaosMonkey {{ setup.extension_version }}
                </a>

                <p class="text-muted small mb-0">
                  The same enrollment code works in VS Code, Cursor, and Devin. Every editor gets its own secure installation connection.
                </p>

                <div v-if="setup.cursor_agent_bridge" class="mt-4 pt-4 border-top">
                  <div class="d-flex align-items-center mb-2">
                    <i class="bi bi-robot me-2"></i>
                    <h6 class="mb-0">Using Cursor's Agents Window?</h6>
                  </div>
                  <p class="text-muted small mb-3">
                    The IDE extension captures supported Cursor editor activity. If you also use Cursor's separate Agents Window, install the Cursor Agents companion to capture that activity.
                  </p>
                  <a :href="setup.cursor_agent_bridge.download_url" class="btn btn-outline-primary w-100 mb-3" rel="noopener noreferrer" :download="setup.cursor_agent_bridge.filename">
                    Download Cursor Agents companion
                  </a>
                  <p class="text-muted small mb-0">
                    Verify the download SHA-256: <code>{{ setup.cursor_agent_bridge.sha256 }}</code><br>
                    Installation sends a connectivity test — genuine Cursor agent activity is still required before agent coverage is verified.
                  </p>
                </div>
              </div>
            </div>

            <div class="card border-0 shadow-sm">
              <div class="card-body p-5">
                <h3 class="card-title text-center mb-4">Connection Details</h3>

                <div class="mb-4">
                  <label class="form-label fw-bold">API Base URL</label>
                  <div class="input-group">
                    <pre class="form-control bg-dark text-light font-monospace small mb-0" style="white-space: pre; overflow-x: auto;">{{ setup.api_base_url }}</pre>
                    <button class="btn btn-outline-dark" type="button" @click="copyApiBaseUrl">
                      <span v-if="copiedUrl">Copied!</span>
                      <span v-else>Copy</span>
                    </button>
                  </div>
                </div>

                <div class="mb-3">
                  <label class="form-label fw-bold">Enrollment Code</label>
                  <div class="input-group">
                    <pre class="form-control bg-dark text-light font-monospace small mb-0" style="white-space: pre; overflow-x: auto;">{{ setup.connect_code }}</pre>
                    <button class="btn btn-outline-dark" type="button" @click="copyCode">
                      <span v-if="copiedCode">Copied!</span>
                      <span v-else>Copy</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="card border-0 shadow-sm">
              <div class="card-body p-5">
                <h3 class="card-title text-center mb-4">Setup Steps</h3>

                <ol class="list-group list-group-numbered mb-4">
                  <li class="list-group-item">Download the ChaosMonkey VSIX.</li>
                  <li class="list-group-item">Open Extensions in VS Code, Cursor, or Devin.</li>
                  <li class="list-group-item">Choose "Install from VSIX…" and select the downloaded file.</li>
                  <li class="list-group-item">Open the Command Palette.</li>
                  <li class="list-group-item">Run <strong>ChaosMonkey: Connect</strong>.</li>
                  <li class="list-group-item">Enter the displayed API base URL.</li>
                  <li class="list-group-item">Enter the displayed enrollment code.</li>
                </ol>

                <button class="btn btn-primary w-100" @click="copyInstructions">
                  <span v-if="copiedInstructions">Copied!</span>
                  <span v-else>Copy complete setup instructions</span>
                </button>

                <p class="text-muted small mt-3 mb-0 text-center">
                  You may use the same enrollment code in every supported editor you use. Each editor receives its own secure installation connection.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import api, { API_URL } from '../config/api.js'

const route = useRoute()

const state = ref('')
const emailInput = ref('')
const submitting = ref(false)
const invite = ref(null)
const setup = ref(null)
const copiedCode = ref(false)
const copiedUrl = ref(false)
const copiedInstructions = ref(false)

const copyText = async (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  const copied = document.execCommand('copy')
  textarea.remove()

  if (!copied) {
    throw new Error('Clipboard copy failed')
  }
}

const normalizedEmail = computed(() => emailInput.value.trim().toLowerCase())

const submitEmail = async () => {
  if (!normalizedEmail.value) return
  submitting.value = true
  state.value = 'loading'

  try {
    const token = route.params.token
    const { data } = await api.post(`${API_URL}/rollouts/${encodeURIComponent(token)}/claim`, {
      email: normalizedEmail.value,
    })

    invite.value = data.invite || null
    setup.value = data.setup || null
    state.value = 'success'
  } catch (err) {
    state.value = 'error'
  } finally {
    submitting.value = false
  }
}

const copyCode = async () => {
  if (!setup.value?.connect_code) return
  try {
    await copyText(setup.value.connect_code)
    copiedCode.value = true
    setTimeout(() => { copiedCode.value = false }, 2000)
  } catch (err) {
    console.error('Failed to copy code:', err)
  }
}

const copyApiBaseUrl = async () => {
  if (!setup.value?.api_base_url) return
  try {
    await copyText(setup.value.api_base_url)
    copiedUrl.value = true
    setTimeout(() => { copiedUrl.value = false }, 2000)
  } catch (err) {
    console.error('Failed to copy API base URL:', err)
  }
}

const copyInstructions = async () => {
  if (!setup.value || !invite.value) return
  const cb = setup.value.cursor_agent_bridge
  const cursorSection = cb
    ? `

Cursor Agents companion (Cursor's standalone Agents Window — separate from
the IDE extension above; install it alongside, not instead of):
8. Download the companion: ${cb.download_url}
9. Verify the download SHA-256: ${cb.sha256}
10. Extract the archive, then from the extraction directory run:
    CM_API_BASE_URL="${setup.value.api_base_url}" CM_CONNECT_CODE="${setup.value.connect_code}" node package/install.js
11. The installer sends a connectivity test event. Genuine Cursor agent
    activity is still required before agent coverage is verified.`
    : ''
  const text = `ChaosMonkey ${setup.value.extension_version} setup for ${invite.value.email}

1. Download the ChaosMonkey VSIX: ${setup.value.vsix_download_url}
2. Open Extensions in VS Code, Cursor, or Devin.
3. Choose "Install from VSIX…" and select the downloaded file.
4. Open the Command Palette.
5. Run "ChaosMonkey: Connect".
6. Enter this API base URL: ${setup.value.api_base_url}
7. Enter this enrollment code: ${setup.value.connect_code}

You may use the same enrollment code in every supported editor you use. Each editor receives its own secure installation connection.${cursorSection}`
  try {
    await copyText(text)
    copiedInstructions.value = true
    setTimeout(() => { copiedInstructions.value = false }, 2000)
  } catch (err) {
    console.error('Failed to copy instructions:', err)
  }
}
</script>

<style scoped>
.enroll-page {
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

.list-group-item {
  border: none;
  padding: 0.75rem 0;
  background: transparent;
}

.space-y-4 > * + * {
  margin-top: 1.5rem;
}
</style>
