<template>
  <div class="invite-accept-page">
    <!-- Header -->
    <div class="text-center py-5" style="background-color: #000000;">
      <div class="container">
        <img src="../assets/CM-icon.png" alt="ChaosMonkey.dev Logo" class="mb-3" style="height: 80px;">
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet"></link>
        <h1 class="mb-0" style="font-family: 'Bebas Neue'; font-size: 3.5rem; color: white; letter-spacing: 2px;">CHAOSMONKEY</h1>
        <p class="lead mb-0 text-white">Development Analytics Platform</p>
      </div>
    </div>

    <!-- Main Content -->
    <div class="container py-5">
      <div class="row justify-content-center">
        <div class="col-12" style="max-width: 600px;">
          
          <!-- Loading State -->
          <div v-if="loading" class="text-center py-5">
            <div class="spinner-border text-primary mb-3" style="width: 3rem; height: 3rem;"></div>
            <p class="text-muted">Loading invite details...</p>
          </div>

          <!-- Error State -->
          <div v-else-if="error" class="card border-danger">
            <div class="card-body text-center py-5">
              <div class="text-danger display-1 mb-4">⚠️</div>
              <h2 class="card-title text-danger">Invite Error</h2>
              <p class="card-text text-muted">{{ error }}</p>
              
              <!-- Specific guidance for already redeemed invites -->
              <div v-if="error.includes('already been redeemed')" class="mt-4">
                <div class="alert alert-info">
                  <h5 class="alert-heading">💡 Already Have an Account?</h5>
                  <p class="mb-3">It looks like this invite was already used to create your account.</p>
                  <div class="row text-start">
                    <div class="col-md-6 mb-2">
                      <strong>✅ If you already have an account:</strong>
                      <ol class="mb-0">
                        <li>Go to the <a href="/login" class="alert-link">login page</a></li>
                        <li>Use your email and password to access your account</li>
                        <li>Download the ChaosMonkey extension for your IDE</li>
                      </ol>
                    </div>
                    <div class="col-md-6 mb-2">
                      <strong>📧 If you need a new invite:</strong>
                      <ol class="mb-0">
                        <li>Contact your organization administrator</li>
                        <li>Request a fresh invite link</li>
                        <li>Use the new link to access your account</li>
                      </ol>
                    </div>
                  </div>
                  <div class="mt-3">
                    <a href="/login" class="btn btn-success me-2">
                      <i class="bi bi-box-arrow-in-right me-2"></i>Log In to Your Account
                    </a>
                    <button @click="goHome" class="btn btn-outline-secondary">
                      <i class="bi bi-house me-2"></i>Go to Homepage
                    </button>
                  </div>
                </div>
              </div>
              
              <!-- Default error handling -->
              <div v-else>
                <button @click="goHome" class="btn btn-primary">Go to Homepage</button>
              </div>
            </div>
          </div>

          <!-- Success State (Account Created) -->
          <div v-else-if="accountCreated" class="card border-success">
            <div class="card-body text-center py-5">
              <div class="text-success display-1 mb-4">✅</div>
              <h2 class="card-title text-success">Account Created Successfully!</h2>
              <p class="card-text text-muted mb-4">
                Welcome to {{ organization?.name }}! Your account has been created and you're now a member of the team.
              </p>
              
              <!-- Admin Onboarding -->
              <div v-if="createdUser?.role === 'admin'" class="mb-4">
                <div class="alert alert-warning">
                  <h5 class="alert-heading">� Admin Account Setup</h5>
                  <p class="mb-2">As an <strong>Organization Administrator</strong>, you have access to:</p>
                  <ul class="text-start mb-3">
                    <li>Team management and member invitations</li>
                    <li>Performance analytics and insights</li>
                    <li>Organization settings and configuration</li>
                    <li>GitHub integration management</li>
                  </ul>
                  <p class="mb-0"><strong>Next Steps:</strong></p>
                  <ol class="text-start">
                    <li><a href="/login" class="alert-link">Log in</a> to your admin dashboard</li>
                    <li>Invite team members and manage organization</li>
                    <li>Install ChaosMonkey extension for your development</li>
                  </ol>
                </div>
                
                <div class="bg-light rounded p-3 mb-4">
                  <h6 class="text-muted mb-2">Your Admin Account:</h6>
                  <div class="small">
                    <div><strong>Email:</strong> {{ createdUser?.email }}</div>
                    <div><strong>Organization:</strong> {{ organization?.name }}</div>
                    <div><strong>Role:</strong> <span class="badge bg-warning text-dark">Administrator</span></div>
                  </div>
                </div>
                
                <div class="d-grid gap-2 d-md-flex">
                  <a href="/login" class="btn btn-success btn-lg flex-fill">
                    <i class="bi bi-box-arrow-in-right me-2"></i>Log In to Admin Dashboard
                  </a>
                  <button @click="downloadExtension" class="btn btn-outline-primary btn-lg flex-fill">
                    <i class="bi bi-download me-2"></i>Download Extension
                  </button>
                </div>
              </div>

              <!-- Developer Onboarding (only for developer-enrollment invites) -->
              <div v-else-if="isDeveloperEnrollment" class="mb-4">
                <div class="alert alert-info">
                  <h5 class="alert-heading">💻 Developer Setup</h5>
                  <p class="mb-2">Welcome! You're all set to start contributing analytics data to {{ organization?.name }}.</p>
                  <p class="mb-3"><strong>No login required!</strong> You just need to install the ChaosMonkey extension and configure it.</p>
                  <p class="mb-0"><strong>Quick Setup:</strong></p>
                  <ol class="text-start">
                    <li>Install the ChaosMonkey extension for your IDE</li>
                    <li>Configure it to point to your organization's API</li>
                    <li>Start coding - data will be automatically collected</li>
                  </ol>
                </div>
                
                <div class="bg-light rounded p-3 mb-4">
                  <h6 class="text-muted mb-2">Your Development Account:</h6>
                  <div class="small">
                    <div><strong>Email:</strong> {{ createdUser?.email }}</div>
                    <div><strong>Organization:</strong> {{ organization?.name }}</div>
                    <div><strong>Role:</strong> <span class="badge bg-info text-dark">Developer</span></div>
                  </div>
                </div>
                
                <div class="d-grid gap-2 d-md-flex">
                  <button @click="downloadExtension" class="btn btn-primary btn-lg flex-fill">
                    <i class="bi bi-download me-2"></i>Install ChaosMonkey Extension
                  </button>
                  <button @click="showDevInstructions" class="btn btn-outline-secondary btn-lg flex-fill">
                    <i class="bi bi-gear me-2"></i>Setup Instructions
                  </button>
                </div>
              </div>

              <!-- Dashboard User Onboarding (non-admin, non-developer) -->
              <div v-else class="mb-4">
                <div class="alert alert-success">
                  <h5 class="alert-heading">Welcome to {{ organization?.name }}</h5>
                  <p class="mb-0">Your account has been created. You can now sign in to access your dashboard.</p>
                </div>

                <div class="bg-light rounded p-3 mb-4">
                  <h6 class="text-muted mb-2">Your Account:</h6>
                  <div class="small">
                    <div><strong>Email:</strong> {{ createdUser?.email }}</div>
                    <div><strong>Organization:</strong> {{ organization?.name }}</div>
                    <div><strong>Role:</strong> <span class="badge bg-primary">Member</span></div>
                  </div>
                </div>

                <div class="d-grid gap-2 d-md-flex">
                  <a href="/login" class="btn btn-success btn-lg flex-fill">
                    <i class="bi bi-box-arrow-in-right me-2"></i>Continue to Sign In
                  </a>
                </div>
              </div>
            </div>
          </div>

          <!-- Invite Acceptance Form -->
          <div v-else-if="invite" class="card shadow">
            <div class="card-body p-5">
              
              <!-- Invite Details -->
              <div class="text-center mb-4">
                <h2 class="mb-3">You're Invited to Join</h2>
                <div class="display-6 text-primary mb-3">{{ invite.organization_name }}</div>
                <p class="text-muted">
                  You've been invited to join this team on ChaosMonkey.
                  <br>Create your account below to get started.
                </p>
                <div class="small text-muted">
                  <i class="bi bi-clock me-1"></i>
                  Invite expires: {{ formatDate(invite.expires_at) }}
                </div>
              </div>

              <!-- Account Creation Form -->
              <form @submit.prevent="acceptInvite">
                <div class="mb-3">
                  <label for="email" class="form-label">Email Address</label>
                  <input 
                    type="email" 
                    class="form-control" 
                    id="email" 
                    :value="invite.email"
                    readonly
                    disabled
                  >
                  <div class="form-text">This email was specified in your invite.</div>
                </div>

                <div class="mb-3">
                  <label for="name" class="form-label">Full Name</label>
                  <input 
                    type="text" 
                    class="form-control" 
                    id="name" 
                    v-model="form.name"
                    required
                    placeholder="Enter your full name"
                  >
                </div>

                <div class="mb-3">
                  <label for="password" class="form-label">Password</label>
                  <input 
                    type="password" 
                    class="form-control" 
                    id="password" 
                    v-model="form.password"
                    required
                    minlength="8"
                    placeholder="Create a password (min 8 characters)"
                  >
                </div>

                <div class="mb-4">
                  <label for="password_confirmation" class="form-label">Confirm Password</label>
                  <input 
                    type="password" 
                    class="form-control" 
                    id="password_confirmation" 
                    v-model="form.password_confirmation"
                    required
                    minlength="8"
                    placeholder="Confirm your password"
                  >
                </div>

                <!-- Form Errors -->
                <div v-if="formErrors.length > 0" class="alert alert-danger">
                  <h6 class="alert-heading">Please fix the following:</h6>
                  <ul class="mb-0">
                    <li v-for="error in formErrors" :key="error">{{ error }}</li>
                  </ul>
                </div>

                <!-- Submit Button -->
                <div class="d-grid">
                  <button 
                    type="submit" 
                    class="btn btn-primary btn-lg"
                    :disabled="submitting"
                  >
                    <span v-if="submitting" class="d-flex align-items-center justify-content-center">
                      <div class="spinner-border spinner-border-sm me-2"></div>
                      Creating Account...
                    </span>
                    <span v-else>
                      <i class="bi bi-person-plus me-2"></i>
                      Create Account & Join Team
                    </span>
                  </button>
                </div>
              </form>

              <!-- Organization Info -->
              <div class="mt-4 pt-4 border-top">
                <div class="row text-center">
                  <div class="col-4">
                    <div class="text-muted small">Organization</div>
                    <div class="fw-bold">{{ invite.organization_name }}</div>
                  </div>
                  <div class="col-4">
                    <div class="text-muted small">Your Role</div>
                    <div class="fw-bold">{{ invite.role ? (invite.role.charAt(0).toUpperCase() + invite.role.slice(1)) : 'Member' }}</div>
                  </div>
                  <div class="col-4">
                    <div class="text-muted small">Status</div>
                    <div class="fw-bold text-success">Pending</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../config/api'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const error = ref(null)
const invite = ref(null)
const organization = ref(null)
const accountCreated = ref(false)
const createdUser = ref(null)
const submitting = ref(false)
const formErrors = ref([])
const isDeveloperEnrollment = ref(false)

const form = ref({
  name: '',
  password: '',
  password_confirmation: ''
})

const formatDate = (dateString) => {
  return new Date(dateString).toLocaleString()
}

const loadInvite = async () => {
  const token = route.params.token
  if (import.meta.env.DEV) console.log('Loading invite with token:', token)
  
  try {
    const response = await api.get(`/api/invites/${token}`)
    if (import.meta.env.DEV) console.log('Invite API response:', response.data)
    
    invite.value = response.data.invite
    organization.value = {
      name: response.data.invite.organization_name,
      id: response.data.invite.organization_id
    }
    
  } catch (err) {
    console.error('Failed to load invite:', err)
    error.value = err.response?.data?.error || 'Failed to load invite'
  } finally {
    loading.value = false
  }
}

const validateForm = () => {
  const errors = []
  
  if (!form.value.name.trim()) {
    errors.push('Name is required')
  }
  
  if (form.value.name.trim().length < 2) {
    errors.push('Name must be at least 2 characters')
  }
  
  if (form.value.password.length < 8) {
    errors.push('Password must be at least 8 characters')
  }
  
  if (form.value.password !== form.value.password_confirmation) {
    errors.push('Passwords do not match')
  }
  
  return errors
}

const acceptInvite = async () => {
  const token = route.params.token
  formErrors.value = validateForm()
  
  if (formErrors.value.length > 0) {
    return
  }
  
  submitting.value = true
  
  try {
    if (import.meta.env.DEV) console.log('Accepting invite with token:', token)
    
    const response = await api.post(`/api/invites/${token}/accept`, form.value)
    
    createdUser.value = response.data.user
    organization.value = response.data.organization
    isDeveloperEnrollment.value = response.data.is_developer_enrollment === true
    accountCreated.value = true
    
  } catch (err) {
    console.error('Failed to accept invite:', err)
    
    if (err.response?.data?.error) {
      if (typeof err.response.data.error === 'object') {
        // Laravel validation errors
        formErrors.value = Object.values(err.response.data.error).flat()
      } else {
        formErrors.value = [err.response.data.error]
      }
    } else {
      formErrors.value = ['Failed to create account. Please try again.']
    }
  } finally {
    submitting.value = false
  }
}

const apiBaseUrl = computed(() => {
  const base = import.meta.env.VITE_API_BASE_URL
  if (base && !/^https?:\/\/127\./.test(base)) {
    return base.replace(/\/$/, '')
  }
  return import.meta.env.DEV ? 'http://' + window.location.hostname + ':8010' : window.location.origin
})

const downloadExtension = () => {
  window.open(apiBaseUrl.value + '/api/extension/download/latest', '_blank')
}

const goHome = () => {
  router.push('/')
}

const showDevInstructions = () => {
  // Create a modal or navigate to instructions page
  const instructions = `
🔧 DEVELOPER SETUP INSTRUCTIONS

1. INSTALL EXTENSION
   • VS Code: Search "ChaosMonkey" in Extensions
   • Cursor: Install from ChaosMonkey.dev/install
   • Windsurf: Install from ChaosMonkey.dev/install

2. CONFIGURE API ENDPOINT
   • Extension Settings → API Endpoint
   • Enter: ${apiBaseUrl.value}/api
   • Organization ID: ${organization.value?.id}

3. VERIFY CONNECTION
   • Extension should show "Connected to ${organization.value?.name}"
   • Data will automatically flow to your organization

4. START CODING
   • No login required to ChaosMonkey website
   • All activity tracked automatically
   • Analytics available to your organization admins

Need help? Contact your organization administrator.
  `
  
  alert(instructions)
}

onMounted(() => {
  loadInvite()
})
</script>

<style scoped>
.invite-accept-page {
  background-color: #f8f9fa;
  min-height: 100vh;
}

.card {
  border: none;
  border-radius: 1rem;
  box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075);
}

.btn-primary {
  background-color: #000;
  border-color: #000;
}

.btn-primary:hover {
  background-color: #333;
  border-color: #333;
}

.form-control:focus {
  border-color: #000;
  box-shadow: 0 0 0 0.2rem rgba(0, 0, 0, 0.25);
}

.display-6 {
  font-size: 2.5rem;
  font-weight: 700;
}

.spinner-border {
  border-width: 0.3em;
}

.alert {
  border-radius: 0.5rem;
}

.text-primary {
  color: #000 !important;
}

/* Remove the conflicting background override */
</style>
