<template>
  <div class="manage-teams-page">
    <!-- SVG Filter Definition -->
    <svg width="0" height="0" style="position: absolute;">
      <filter id="chaos-glitch">
        <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" result="turbulence" seed="2" />
        <feDisplacementMap in2="turbulence" in="SourceGraphic" scale="2" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>

    <!-- Header Section -->
    <div class="dashboard-header" style="background-color: #000000;">
      <div class="container-fluid">
        <div class="row align-items-center">
          <div class="col-12 col-md-8">
            <div class="header-content px-3 px-md-4 py-3 py-md-0">
              <div class="d-flex flex-column flex-md-row align-items-start align-items-md-center">
                <img src="../assets/CM-icon.png" alt="ChaosMonkey.dev Logo" class="me-3 dashboard-logo">
                <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet">
                <div>
                  <h1 
                    class="dashboard-title mb-0" 
                    style="font-family: 'Bebas Neue'; filter: url(#chaos-glitch); cursor: pointer;"
                    @click="goToDashboards"
                  >
                    CHAOSMONKEY
                  </h1>
                </div>
              </div>
            </div>
          </div>
          <div class="col-12 col-md-4 text-start text-md-end">
            <div class="px-3 px-md-4 pb-3 pb-md-0 d-flex align-items-center justify-content-md-end gap-3">
              <NavUserAvatar />
              <button @click="handleLogout" class="btn btn-light btn-lg">
                <i class="bi bi-box-arrow-right me-2"></i>Logout
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="container-fluid py-4">
      <div class="row justify-content-center">
        <div class="col-12" style="max-width: 1200px;">
          
          <!-- Team Overview Card -->
          <div class="card border-0 shadow-sm mb-4">
            <div class="card-body p-4">
              <div class="row align-items-center mb-4">
                <div class="col">
                  <h2 class="h4 mb-1">Team Overview</h2>
                  <p class="text-muted mb-0">{{ visibleTeamMembers.length }} members • {{ visibleTeamMembers.filter(m => m.status === 'active').length }} active</p>
                  <p v-if="hiddenSimulatedCount > 0" class="text-muted small mt-1 mb-0">Seeded telemetry users hidden from team management</p>
                </div>
                <div class="col-auto">
                  <button @click="showInviteModal = true" class="btn btn-primary">
                    <i class="bi bi-person-plus me-2"></i>Invite Member
                  </button>
                </div>
              </div>

              <!-- Stats Cards -->
              <div class="row g-3 mb-4">
                <div class="col-md-3">
                  <div class="stat-card bg-light rounded p-3 text-center">
                    <div class="stat-number h3 mb-1">{{ visibleTeamMembers.length }}</div>
                    <div class="stat-label small text-muted">Total Members</div>
                  </div>
                </div>
                <div class="col-md-3">
                  <div class="stat-card bg-light rounded p-3 text-center">
                    <div class="stat-number h3 mb-1">{{ visibleTeamMembers.filter(m => m.status === 'active').length }}</div>
                    <div class="stat-label small text-muted">Active</div>
                  </div>
                </div>
                <div class="col-md-3">
                  <div class="stat-card bg-light rounded p-3 text-center">
                    <div class="stat-number h3 mb-1">{{ visibleTeamMembers.filter(m => m.status === 'pending').length }}</div>
                    <div class="stat-label small text-muted">Pending</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Invite Link Generation Section - Temporarily Disabled for MVP2 Pilots -->
          <div class="card border-0 shadow-sm mb-4">
            <div class="card-body">
              <h5 class="card-title mb-3">Team Invitations</h5>
              <div class="alert alert-info">
                <h6 class="alert-heading">
                  <i class="bi bi-info-circle me-2"></i>
                  Manual Invitations for MVP2 Pilots
                </h6>
                <p class="mb-2">
                  Team invitations are temporarily manual for pilot rollout.
                </p>
                <p class="mb-0">
                  Send each developer their personal enrollment code and use "Copy setup" to share
                  tool-by-tool instructions — IDE extension (VS Code / Cursor / Devin), Claude Code,
                  and Codex. The instructions include the Pilot API base URL:
                  <code>{{ apiBaseUrl }}</code>
                </p>
                <p class="mb-0 mt-2">
                  <strong>Developers do not need dashboard access</strong> — they only need their
                  client configured with the API base URL and their own enrollment code.
                </p>
              </div>
            </div>
          </div>

          <!-- Team Members Table -->
          <div class="card border-0 shadow-sm">
            <div class="card-body p-4">
              <div class="d-flex justify-content-between align-items-center mb-4">
                <h3 class="h5 mb-0">Team Members</h3>
                <div class="d-flex gap-2 flex-wrap">
                  <input 
                    v-model="searchQuery" 
                    type="text" 
                    class="form-control form-control-sm" 
                    placeholder="Search members..."
                    style="width: 200px;"
                  >
                  <select v-model="roleFilter" class="form-select form-select-sm" style="width: 120px;">
                    <option value="">All Roles</option>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                  <select v-model="statusFilter" class="form-select form-select-sm" style="width: 120px;">
                    <option value="">All Status</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
              </div>

              <!-- Loading State -->
              <div v-if="isLoading" class="text-center py-5">
                <div class="spinner-border text-primary" role="status">
                  <span class="visually-hidden">Loading...</span>
                </div>
                <p class="text-muted mt-2">Loading team members...</p>
              </div>

              <!-- Members List -->
              <div v-else class="members-list">
                <!-- Sortable Headers -->
                <div class="member-headers d-flex align-items-center pb-2 mb-2 border-bottom">
                  <div class="member-info flex-grow-1" style="min-width: 180px;">
                    <button @click="toggleSort('name')" class="btn btn-link text-decoration-none p-0 fw-semibold">
                      Developer
                      <i :class="sortBy === 'name' && sortOrder === 'asc' ? 'bi bi-arrow-up' : 'bi bi-arrow-down'"></i>
                    </button>
                  </div>
                  <div class="member-role me-3" style="min-width: 90px;">
                    <button @click="toggleSort('role')" class="btn btn-link text-decoration-none p-0 fw-semibold">
                      Role
                      <i :class="sortBy === 'role' && sortOrder === 'asc' ? 'bi bi-arrow-up' : 'bi bi-arrow-down'"></i>
                    </button>
                  </div>
                  <div class="member-status me-3" style="min-width: 120px;">
                    <button @click="toggleSort('status')" class="btn btn-link text-decoration-none p-0 fw-semibold">
                      Status
                      <i :class="sortBy === 'status' && sortOrder === 'asc' ? 'bi bi-arrow-up' : 'bi bi-arrow-down'"></i>
                    </button>
                  </div>
                  <div class="member-code me-3" style="min-width: 180px;">
                    Enrollment Code
                  </div>
                  <div class="member-setup me-3" style="min-width: 160px;">
                    Setup
                  </div>
                  <div class="member-actions">Actions</div>
                </div>

                <div v-for="member in filteredMembers" :key="member.id" class="member-row">
                  <div class="d-flex align-items-center">
                    <div class="member-avatar me-3">
                      <img 
                        v-if="member.avatar_url" 
                        :src="member.avatar_url" 
                        :alt="member.name"
                        class="rounded-circle"
                        style="width: 40px; height: 40px; object-fit: cover;"
                      >
                      <div 
                        v-else
                        class="rounded-circle bg-secondary d-flex align-items-center justify-content-center"
                        style="width: 40px; height: 40px;"
                      >
                        <i class="bi bi-person text-white"></i>
                      </div>
                    </div>
                    <div class="member-info flex-grow-1" style="min-width: 180px;">
                      <div class="member-name fw-semibold">{{ member.name || member.email }}</div>
                      <div class="member-email small text-muted">{{ member.email }}</div>
                    </div>
                    <div class="member-role me-3" style="min-width: 90px;">
                      <span :class="getRoleBadgeClass(member.role)" class="badge">
                        {{ member.role }}
                      </span>
                    </div>
                    <div class="member-status me-3" style="min-width: 120px;">
                      <span :class="getEnrollmentStatusClass(member)" class="badge">
                        {{ getEnrollmentStatusLabel(member) }}
                      </span>
                    </div>
                    <div class="member-code me-3" style="min-width: 180px;">
                      <code v-if="member.connect_code" class="small text-nowrap">{{ member.connect_code }}</code>
                      <span v-else-if="member.status === 'pending'" class="text-muted small">Not generated</span>
                      <span v-else class="text-muted small">-</span>
                    </div>
                    <div class="member-setup me-3" style="min-width: 160px;">
                      <button v-if="!member.connect_code && member.status === 'pending'" @click="generateConnectCode(member)" class="btn btn-sm btn-outline-primary" :disabled="loadingStates[getLoadingKey('code', member.invite_id)]">
                        <span v-if="loadingStates[getLoadingKey('code', member.invite_id)]" class="spinner-border spinner-border-sm me-1"></span>
                        Generate code
                      </button>
                      <button v-else-if="member.connect_code" @click="copySetupInstructions(member)" class="btn btn-sm btn-outline-secondary text-nowrap">
                        Copy setup
                      </button>
                      <span v-else class="text-muted small">-</span>
                    </div>
                    <div class="member-actions">
                      <div class="dropdown">
                        <button 
                          class="btn btn-sm btn-outline-secondary dropdown-toggle" 
                          type="button"
                          data-bs-toggle="dropdown"
                          :disabled="loadingStates[getLoadingKey('remove', member.id)]"
                        >
                          <span v-if="loadingStates[getLoadingKey('remove', member.id)]" class="spinner-border spinner-border-sm me-1"></span>
                          <i class="bi bi-three-dots"></i>
                        </button>
                        <ul class="dropdown-menu">
                          <li v-if="member.status === 'active'"><button type="button" class="dropdown-item" @click="editMember(member)">Edit Role</button></li>
                          <li><button type="button" class="dropdown-item" @click="resendInvite(member)">Resend Invite</button></li>
                          <li v-if="member.status === 'pending'"><button type="button" class="dropdown-item text-danger" @click="cancelInvite(member)">Cancel Invite</button></li>
                          <li v-if="member.status === 'active'"><button type="button" class="dropdown-item text-danger" @click="removeMember(member)">Remove</button></li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Empty State -->
                <div v-if="filteredMembers.length === 0" class="text-center py-5">
                  <i class="bi bi-people display-4 text-muted mb-3"></i>
                  <p class="text-muted">No team members found</p>
                  <button @click="resetFilters" class="btn btn-outline-primary">Reset Filters</button>
                </div>

                <!-- Pagination -->
                <div v-if="!showAllMembers && totalPages > 1" class="d-flex justify-content-between align-items-center mt-4">
                  <div class="text-muted">
                    Showing {{ (currentPage - 1) * itemsPerPage + 1 }}-{{ Math.min(currentPage * itemsPerPage, visibleTeamMembers.length) }} of {{ visibleTeamMembers.length }} members
                  </div>
                  <div class="btn-group" role="group">
                    <button 
                      @click="changePage(currentPage - 1)" 
                      class="btn btn-outline-secondary" 
                      :disabled="currentPage === 1"
                    >
                      Previous
                    </button>
                    <button 
                      v-for="page in Math.min(5, totalPages)" 
                      :key="page"
                      @click="changePage(page)"
                      class="btn"
                      :class="page === currentPage ? 'btn-primary' : 'btn-outline-secondary'"
                    >
                      {{ page }}
                    </button>
                    <button 
                      @click="changePage(currentPage + 1)" 
                      class="btn btn-outline-secondary" 
                      :disabled="currentPage === totalPages"
                    >
                      Next
                    </button>
                  </div>
                  <button 
                    @click="toggleShowAllMembers" 
                    class="btn btn-outline-primary btn-sm"
                  >
                    View All Members
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Email Invite Section (from Settings.vue) -->
    <div class="container-fluid py-4">
      <div class="row justify-content-center">
        <div class="col-12" style="max-width: 1200px;">
          <div class="card border-0 shadow-sm mb-4">
            <div class="card-body">
              <h5 class="card-title mb-4">Invite via Email</h5>
              <p class="text-muted mb-4">Send an email invitation to join your team.</p>
              
              <div class="row">
                <div class="col-md-6">
                  <div class="mb-3">
                    <label for="settingsInviteEmail" class="form-label">Email Address</label>
                    <input
                      type="email"
                      class="form-control"
                      id="settingsInviteEmail"
                      v-model="settingsInviteForm.email"
                      placeholder="developer@company.com"
                      :disabled="isSendingInvite"
                    />
                  </div>
                </div>
                <div class="col-md-6">
                  <div class="mb-3">
                    <label for="settingsInviteRole" class="form-label">Role</label>
                    <select class="form-select" id="settingsInviteRole" v-model="settingsInviteForm.role" :disabled="isSendingInvite">
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>
              </div>
              
              <!-- Alert Message -->
              <div v-if="emailInviteAlert.show" :class="`alert alert-${emailInviteAlert.type} alert-dismissible fade show`" role="alert">
                <button type="button" class="btn-close" @click="emailInviteAlert.show = false"></button>
                <i :class="getAlertIcon(emailInviteAlert.type)" class="me-2"></i>
                {{ emailInviteAlert.message }}
              </div>
              
              <div class="text-center mb-4">
                <button
                  @click="sendSettingsInvite"
                  :disabled="isSendingInvite || !settingsInviteForm.email"
                  class="btn btn-primary w-100"
                >
                  <span v-if="isSendingInvite" class="spinner-border spinner-border-sm me-2"></span>
                  <i class="bi bi-envelope me-2"></i>
                  <span v-if="isSendingInvite">Sending...</span>
                  <span v-else>Send Invite</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Invite Modal -->
    <div v-if="showInviteModal" class="modal fade show d-block" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Invite Team Member</h5>
            <button type="button" class="btn-close" @click="showInviteModal = false"></button>
          </div>
          <div class="modal-body">
            <form @submit.prevent="sendInvite">
              <div class="mb-3">
                <label for="name" class="form-label">Name</label>
                <input 
                  v-model="inviteForm.name" 
                  type="text" 
                  class="form-control" 
                  id="name"
                  :class="{ 'is-invalid': formErrors.name }"
                  placeholder="Enter full name"
                  required
                >
                <div v-if="formErrors.name" class="invalid-feedback">
                  {{ formErrors.name }}
                </div>
              </div>
              <div class="mb-3">
                <label for="email" class="form-label">Email Address</label>
                <input 
                  v-model="inviteForm.email" 
                  type="email" 
                  class="form-control" 
                  id="email"
                  :class="{ 'is-invalid': formErrors.email }"
                  placeholder="name@company.com"
                  required
                >
                <div v-if="formErrors.email" class="invalid-feedback">
                  {{ formErrors.email }}
                </div>
              </div>
              <div class="mb-3">
                <label for="role" class="form-label">Role</label>
                <select v-model="inviteForm.role" class="form-select" id="role" required>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div class="mb-3">
                <label for="message" class="form-label">Message (optional)</label>
                <textarea 
                  v-model="inviteForm.message" 
                  class="form-control" 
                  id="message"
                  rows="3"
                  placeholder="Add a personal message to the invitation..."
                ></textarea>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="showInviteModal = false">Cancel</button>
            <button 
              type="button" 
              class="btn btn-primary" 
              @click="sendInvite"
              :disabled="isLoading"
            >
              <span v-if="isLoading" class="spinner-border spinner-border-sm me-2"></span>
              Send Invite
            </button>
          </div>
        </div>
      </div>
      <div class="modal-backdrop fade show" @click="showInviteModal = false"></div>
    </div>

    <!-- Edit Role Modal -->
    <div v-if="showEditRoleModal" class="modal fade show d-block" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Edit Member Role</h5>
            <button type="button" class="btn-close" @click="showEditRoleModal = false"></button>
          </div>
          <div class="modal-body">
            <div v-if="selectedMember" class="mb-3">
              <p class="text-muted">Update role for:</p>
              <div class="d-flex align-items-center mb-3">
                <div class="rounded-circle bg-secondary d-flex align-items-center justify-content-center me-3" style="width: 40px; height: 40px;">
                  <i class="bi bi-person text-white"></i>
                </div>
                <div>
                  <div class="fw-semibold">{{ selectedMember.name }}</div>
                  <div class="small text-muted">{{ selectedMember.email }}</div>
                </div>
              </div>
            </div>
            <div class="mb-3">
              <label for="editRole" class="form-label">Role</label>
              <select v-model="selectedMember.role" class="form-select" id="editRole">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="showEditRoleModal = false">Cancel</button>
            <button 
              type="button" 
              class="btn btn-primary" 
              @click="updateMemberRole"
              :disabled="loadingStates[getLoadingKey('role', selectedMember?.id)]"
            >
              <span v-if="loadingStates[getLoadingKey('role', selectedMember?.id)]" class="spinner-border spinner-border-sm me-2"></span>
              Update Role
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Team Management Modal -->
    <div v-if="teamModal.show" class="modal fade show" tabindex="-1" style="display: block; background-color: rgba(0, 0, 0, 0.5);">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i :class="getModalIcon(teamModal.type)" class="me-2"></i>
              {{ teamModal.title }}
            </h5>
            <button type="button" class="btn-close" @click="hideTeamModal">
              <span>&times;</span>
            </button>
          </div>
          <div class="modal-body">
            <p>{{ teamModal.message }}</p>
          </div>
          <div class="modal-footer">
            <button v-if="teamModal.showCancel" type="button" class="btn btn-secondary" @click="handleTeamModalCancel">
              {{ teamModal.cancelText }}
            </button>
            <button type="button" class="btn" :class="getModalButtonClass(teamModal.type)" @click="handleTeamModalConfirm">
              {{ teamModal.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import api, { API_URL } from '../config/api'
import NavUserAvatar from '../components/NavUserAvatar.vue'
import { buildSetupInstructions, probeCursorAgentBridge } from '../lib/setupInstructions'

const router = useRouter()
const authStore = useAuthStore()
const apiBaseUrl = API_URL

const handleLogout = async () => {
  await authStore.logout()
  router.push('/login')
}

const goToDashboards = () => {
  router.push('/dashboards')
}

// Display-only filter: hide obvious simulated/seed/demo users from team management surfaces
// Never hides the current logged-in user or pending real invites
const isSimulatedUser = (member) => {
  // Never hide the current user
  const currentUserId = authStore.user?.id || authStore.user?.userId
  if (currentUserId && member.id === currentUserId) return false
  // Never hide pending invites (they are real people who haven't accepted yet)
  if (member.status === 'pending') return false

  // Check explicit flags if present
  if (member.is_simulated || member.simulated || member.is_demo || member.demo || member.seed || member.is_seed) return true
  if (member.source === 'simulated' || member.source === 'seed' || member.source === 'demo' || member.source === 'test') return true

  // Conservative name/email pattern matching for obvious generated users
  const name = (member.name || '').toLowerCase()
  const email = (member.email || '').toLowerCase()
  const simulatedPatterns = [
    /^dev\d+@/, /^developer\d+@/, /^test\d+@/, /^simulated\d+@/,
    /^seed\d+@/, /^demo\d+@/, /^fake\d+@/,
    /@example\.com$/, /@test\.com$/, /@simulated\.com$/,
    /^simulated\s/i, /^seed\s/i, /^demo\s/i, /^test\s/i,
    /^dev\s\d+/i, /^developer\s\d+/i
  ]
  return simulatedPatterns.some(p => p.test(email) || p.test(name))
}

const visibleTeamMembers = computed(() => teamMembers.value.filter(m => !isSimulatedUser(m)))
const hiddenSimulatedCount = computed(() => teamMembers.value.length - visibleTeamMembers.value.length)

// State
const showInviteModal = ref(false)
const showEditRoleModal = ref(false)
const searchQuery = ref('')
const roleFilter = ref('')
const statusFilter = ref('')
const sortBy = ref('name')
const sortOrder = ref('asc')
const isLoading = ref(false)
const loadingStates = ref({})
const currentPage = ref(1)
const itemsPerPage = ref(10)
const showAllMembers = ref(false)
const selectedMember = ref(null)
const organizationInfo = ref({})

// Team management modal state
const teamModal = ref({
  show: false,
  type: 'info',
  title: '',
  message: '',
  showCancel: false,
  confirmText: 'OK',
  cancelText: 'Cancel',
  onConfirm: null,
  onCancel: null
})

// Invite form
const inviteForm = ref({
  email: '',
  name: '',
  role: 'member',
  message: ''
})

// Invite state
const invite = ref(null)
const inviteEmail = ref('')
const inviteExpires = ref('24')
const generatingInvite = ref(false)

// Form validation errors
const formErrors = ref({})

// Loading states for different actions
const getLoadingKey = (action, memberId) => `${action}_${memberId || 'global'}`

// Real team data from API
const teamMembers = ref([])
const isLoadingTeam = ref(false)

// Email invite form (from Settings.vue)
const settingsInviteForm = ref({
  email: '',
  role: 'member'
})
const emailInviteAlert = ref({ show: false, type: '', message: '' })
const isSendingInvite = ref(false)

// Computed
const filteredMembers = computed(() => {
  let filtered = [...visibleTeamMembers.value]

  // Apply search filter
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    filtered = filtered.filter(member => 
      (member.name || '').toLowerCase().includes(query) ||
      (member.email || '').toLowerCase().includes(query)
    )
  }

  // Apply role filter
  if (roleFilter.value) {
    filtered = filtered.filter(member => member.role === roleFilter.value)
  }

  // Apply status filter
  if (statusFilter.value) {
    filtered = filtered.filter(member => member.status === statusFilter.value)
  }

  // Apply sorting
  filtered.sort((a, b) => {
    let aValue = a[sortBy.value]
    let bValue = b[sortBy.value]
    
    if (typeof aValue === 'string') {
      aValue = aValue.toLowerCase()
      bValue = bValue.toLowerCase()
    }
    
    if (sortOrder.value === 'asc') {
      return aValue > bValue ? 1 : -1
    } else {
      return aValue < bValue ? 1 : -1
    }
  })

  // Apply pagination
  if (!showAllMembers.value) {
    const startIndex = (currentPage.value - 1) * itemsPerPage.value
    const endIndex = startIndex + itemsPerPage.value
    filtered = filtered.slice(startIndex, endIndex)
  }

  return filtered
})

const paginatedMembers = computed(() => {
  if (showAllMembers.value) return filteredMembers.value
  
  const startIndex = (currentPage.value - 1) * itemsPerPage.value
  const endIndex = startIndex + itemsPerPage.value
  return filteredMembers.value.slice(startIndex, endIndex)
})

const totalPages = computed(() => {
  return Math.ceil(visibleTeamMembers.value.length / itemsPerPage.value)
})

const activeMembers = computed(() => 
  visibleTeamMembers.value.filter(member => member.status === 'active')
)

const adminCount = computed(() => 
  teamMembers.value.filter(member => member.role === 'admin').length
)

const memberCount = computed(() => 
  teamMembers.value.filter(member => member.role === 'member').length
)

// Methods
const getRoleBadgeClass = (role) => {
  return role === 'admin' ? 'bg-danger' : 'bg-primary'
}

const getStatusClass = (status) => {
  if (status === 'active') return 'bg-success'
  if (status === 'inactive') return 'bg-secondary'
  if (status === 'pending') return 'bg-warning'
  return 'bg-secondary'
}

const getEnrollmentStatusLabel = (member) => {
  if (member.status === 'active') return 'Active'
  const status = member.enrollment_status || 'not_generated'
  const labels = {
    not_generated: 'Not generated',
    ready: 'Ready',
    connected: 'Connected',
    expired: 'Expired / revoked',
    revoked: 'Expired / revoked'
  }
  return labels[status] || 'Pending'
}

const getEnrollmentStatusClass = (member) => {
  if (member.status === 'active') return 'bg-success'
  const status = member.enrollment_status || 'not_generated'
  const classes = {
    not_generated: 'bg-secondary',
    ready: 'bg-primary',
    connected: 'bg-success',
    expired: 'bg-danger',
    revoked: 'bg-danger'
  }
  return classes[status] || 'bg-secondary'
}

const setupInstructionsText = (member) => {
  return buildSetupInstructions(apiBaseUrl, member.connect_code)
}

const generateConnectCode = async (member) => {
  const inviteId = member.invite_id
  if (!inviteId) return

  const loadingKey = getLoadingKey('code', inviteId)
  loadingStates.value[loadingKey] = true

  try {
    const response = await api.post(`/api/org/invites/${inviteId}/connect-code`)
    member.connect_code = response.data.connect_code
    member.connect_code_expires_at = response.data.expires_at
    // Generating/rotating the bootstrap code must never downgrade a connected
    // enrollment — existing installation tokens are independent of the code.
    member.enrollment_status = (member.installation_count ?? 0) > 0 ? 'connected' : 'ready'
    showSuccessMessage('Enrollment code generated')
  } catch (error) {
    console.error('Failed to generate enrollment code:', error)
    showErrorMessage('Failed to generate enrollment code')
  } finally {
    loadingStates.value[loadingKey] = false
  }
}

const copySetupInstructions = async (member) => {
  if (!member.connect_code) return
  const cursorAgentBridge = (await probeCursorAgentBridge(apiBaseUrl)) !== null
  const text = buildSetupInstructions(apiBaseUrl, member.connect_code, { cursorAgentBridge })
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    showSuccessMessage('Setup instructions copied')
  } catch (error) {
    console.error('Failed to copy setup instructions:', error)
    showErrorMessage('Failed to copy setup instructions')
  }
}

// Load team data from API
const loadTeamData = async () => {
  isLoadingTeam.value = true
  
  try {
    // Load team data including both users and pending invites
    const response = await api.get('/api/org/users')
    console.log('Organization response:', response.data)
    
    if (response.data) {
      organizationInfo.value = response.data.organization
      teamMembers.value = response.data.users || []
      
      console.log('Team members loaded:', teamMembers.value.length)
      console.log('Team members:', teamMembers.value)
    }
  } catch (error) {
    console.error('Failed to load team data:', error)
    teamMembers.value = []
  } finally {
    isLoadingTeam.value = false
  }
}

// Form validation
const validateInviteForm = () => {
  const errors = {}
  
  if (!inviteForm.value.email) {
    errors.email = 'Email is required'
  } else if (!/\S+@\S+\.\S+/.test(inviteForm.value.email)) {
    errors.email = 'Please enter a valid email address'
  }
  
  if (!inviteForm.value.name) {
    errors.name = 'Name is required'
  } else if (inviteForm.value.name.length < 2) {
    errors.name = 'Name must be at least 2 characters'
  }
  
  formErrors.value = errors
  return Object.keys(errors).length === 0
}

const editMember = (member) => {
  selectedMember.value = { ...member }
  showEditRoleModal.value = true
}

const updateMemberRole = async () => {
  if (!selectedMember.value) return
  
  const loadingKey = getLoadingKey('role', selectedMember.value.id)
  loadingStates.value[loadingKey] = true
  
  try {
    await api.post(`/api/org/users/${selectedMember.value.id}/role`, {
      role: selectedMember.value.role
    })
    
    // Update local state
    const index = teamMembers.value.findIndex(m => m.id === selectedMember.value.id)
    if (index > -1) {
      teamMembers.value[index] = { ...selectedMember.value }
    }
    
    const memberName = selectedMember.value?.name || 'member'
    showEditRoleModal.value = false
    selectedMember.value = null
    
    showSuccessMessage(`Role updated for ${memberName}`)
  } catch (error) {
    console.error('Failed to update role:', error)
    showSuccessMessage('Failed to update role')
  } finally {
    loadingStates.value[loadingKey] = false
  }
}

const removeMember = async (member) => {
  if (!member.id) {
    console.error('No user ID found for member:', member)
    return
  }
  
  showTeamConfirm(
    'Remove Team Member',
    `Are you sure you want to remove ${member.name} from the team?`,
    async () => {
      console.log('Removing member:', member.id)
      
      const loadingKey = getLoadingKey('remove', member.id)
      loadingStates.value[loadingKey] = true
      
      try {
        const response = await api.delete(`/api/org/users/${member.id}`)
        console.log('Member removal response:', response.data)
        
        showSuccessMessage(`Member removed: ${member.name}`)
        
        // Refresh team data to update the display
        await loadTeamData()
      } catch (error) {
        console.error('Failed to remove member:', error)
        showSuccessMessage('Failed to remove team member')
      } finally {
        loadingStates.value[loadingKey] = false
      }
    }
  )
}

const sendInvite = async () => {
  if (!validateInviteForm()) return
  
  console.log('Sending email invite:', inviteForm.value)
  isLoading.value = true
  
  try {
    const response = await api.post('/api/org/invites', inviteForm.value)
    
    console.log('Email invite response:', response.data)
    
    // Reset form
    inviteForm.value = {
      email: '',
      name: '',
      role: 'member',
      message: ''
    }
    formErrors.value = {}
    showInviteModal.value = false
    
    showSuccessMessage(`Invite sent to ${response.data.email}`)
  } catch (error) {
    console.error('Failed to send invite:', error)
    
    // Handle duplicate email error
    if (error.response && error.response.status === 422) {
      showSuccessMessage('Invite already sent. You can resend it from team management page.')
    } else {
      showSuccessMessage('Failed to send invite. Please try again.')
    }
  } finally {
    isLoading.value = false
  }
}

const showSuccessMessage = (message) => {
  // Create a simple success notification
  const notification = document.createElement('div')
  notification.className = 'alert alert-success position-fixed top-0 end-0 m-3'
  notification.style.zIndex = '9999'
  notification.innerHTML = `
    <i class="bi bi-check-circle me-2"></i>${message}
  `
  document.body.appendChild(notification)
  
  setTimeout(() => {
    notification.remove()
  }, 3000)
}

const showErrorMessage = (message) => {
  const notification = document.createElement('div')
  notification.className = 'alert alert-danger position-fixed top-0 end-0 m-3'
  notification.style.zIndex = '9999'
  notification.innerHTML = `
    <i class="bi bi-exclamation-circle me-2"></i>${message}
  `
  document.body.appendChild(notification)
  
  setTimeout(() => {
    notification.remove()
  }, 3000)
}

// Invite methods
const inviteLink = computed(() => {
  return invite.value ? `${window.location.origin}/invite/${invite.value.token}` : ''
})

const formatDate = (dateString) => {
  return new Date(dateString).toLocaleString()
}

const generateInvite = async () => {
  generatingInvite.value = true
  
  try {
    console.log('Generating invite with data:', {
      email: inviteEmail.value || null,
      expires_hours: parseInt(inviteExpires.value)
    })
    
    const response = await api.post('/api/org/invites', {
      email: inviteEmail.value || null,
      expires_hours: parseInt(inviteExpires.value)
    })
    
    if (import.meta.env.DEV) console.log('Invite API response:', response.data)
    
    if (response.data.invite) {
      invite.value = response.data.invite
      if (import.meta.env.DEV) console.log('Invite created successfully:', response.data.invite)
      showSuccessMessage('Invite link generated successfully!')
    } else {
      console.error('Invite API returned no invite data:', response.data)
      showErrorMessage('Failed to generate invite link — server did not return invite data')
    }
  } catch (error) {
    console.error('Failed to generate invite:', error)
    showErrorMessage('Failed to generate invite link')
  } finally {
    generatingInvite.value = false
  }
}

const copyInviteLink = async (event) => {
  const button = event?.target?.closest?.('button')
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(inviteLink.value)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = inviteLink.value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    if (button) {
      const originalHTML = button.innerHTML
      button.innerHTML = '<i class="bi bi-check me-2"></i>Copied!'
      button.classList.add('btn-success')
      button.classList.remove('btn-outline-secondary')
      
      setTimeout(() => {
        button.innerHTML = originalHTML
        button.classList.remove('btn-success')
        button.classList.add('btn-outline-secondary')
      }, 2000)
    } else {
      showSuccessMessage('Invite link copied to clipboard')
    }
  } catch (error) {
    console.error('Failed to copy invite link:', error)
    showSuccessMessage('Failed to copy invite link')
  }
}

const resendInvite = async (member) => {
  console.log('Resending invite to:', member.email, 'Status:', member.status)
  
  try {
    let response
    if (member.status === 'pending') {
      // Resend existing pending invite
      response = await api.post('/api/org/invites/resend', { 
        email: member.email,
        role: member.role || 'member'
      })
      showSuccessMessage('Invite resent successfully!')
    } else {
      // Create new invite for active user (sends them a new invite link)
      response = await api.post('/api/org/invites', { 
        email: member.email,
        role: member.role || 'member',
        expires_hours: 24
      })
      showSuccessMessage(`New invite sent to ${member.email}!`)
    }
    
    console.log('Resend response:', response.data)
    
    // Refresh team data to update invites
    await loadTeamData()
  } catch (error) {
    console.error('Failed to resend invite:', error)
    const errorMessage = error.response?.data?.message || error.message || 'Failed to resend invite. Please try again.'
    showSuccessMessage(errorMessage)
  }
}

const cancelInvite = async (invite) => {
  const inviteId = invite.invite_id || invite.id
  
  if (!inviteId) {
    console.error('No invite ID found for invite:', invite)
    return
  }
  
  showTeamConfirm(
    'Remove Team Member',
    `Are you sure you want to remove this team member?`,
    async () => {
      console.log('Cancelling invite:', inviteId)
      
      try {
        const response = await api.delete(`/api/org/invites/${inviteId}`)
        console.log('Invite cancellation response:', response.data)
        
        showSuccessMessage('Invite cancelled')
        
        // Refresh team data to update the display
        await loadTeamData()
      } catch (error) {
        console.error('Failed to cancel invite:', error)
        showSuccessMessage('Failed to cancel invite')
      }
    }
  )
}

const sendSettingsInvite = async () => {
  if (!settingsInviteForm.value.email) {
    emailInviteAlert.value = {
      show: true,
      type: 'danger',
      message: 'Please enter an email address'
    }
    return
  }
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(settingsInviteForm.value.email)) {
    emailInviteAlert.value = {
      show: true,
      type: 'danger',
      message: 'Please enter a valid email address'
    }
    return
  }
  
  console.log('Sending email invite:', settingsInviteForm.value)
  isSendingInvite.value = true
  
  try {
    const response = await api.post('/api/org/invites', settingsInviteForm.value)
    
    console.log('Email invite response:', response.data)
    
    // Reset form
    settingsInviteForm.value = { email: '', role: 'member' }
    emailInviteAlert.value = { show: false, type: '', message: '' }
    
    showSuccessMessage(`Invite sent to ${response.data.email}`)
    
    // Refresh team data
    await loadTeamData()
  } catch (error) {
    console.error('Failed to send invite:', error)
    
    // Handle duplicate email error
    if (error.response && error.response.status === 422) {
      emailInviteAlert.value = {
        show: true,
        type: 'warning',
        message: 'Invite already sent. You can resend it from team management page.'
      }
    } else {
      emailInviteAlert.value = {
        show: true,
        type: 'danger',
        message: 'Failed to send invite. Please try again.'
      }
    }
  } finally {
    isSendingInvite.value = false
  }
}

const getAlertIcon = (type) => {
  switch (type) {
    case 'success': return 'bi-check-circle-fill'
    case 'danger': return 'bi-exclamation-triangle-fill'
    case 'warning': return 'bi-exclamation-triangle-fill'
    default: return 'bi-info-circle-fill'
  }
}

// Team management modal functions
const showTeamModal = (type, title, message, options = {}) => {
  teamModal.value = {
    show: true,
    type,
    title,
    message,
    showCancel: options.showCancel !== false,
    confirmText: options.confirmText || 'OK',
    cancelText: options.cancelText || 'Cancel',
    onConfirm: options.onConfirm || null,
    onCancel: options.onCancel || null
  }
}

const showTeamAlert = (type, title, message) => {
  showTeamModal(type, title, message, { showCancel: false })
}

const showTeamConfirm = (title, message, onConfirm, onCancel = null) => {
  console.log('showTeamConfirm called with:', { title, message, onConfirm, onCancel })
  showTeamModal('warning', title, message, {
    showCancel: true,
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    onConfirm,
    onCancel
  })
}

const hideTeamModal = () => {
  console.log('hideTeamModal called')
  teamModal.value.show = false
  teamModal.value.onConfirm = null
  teamModal.value.onCancel = null
  teamModal.value.title = ''
  teamModal.value.message = ''
  teamModal.value.type = 'info'
  teamModal.value.showCancel = false
  teamModal.value.confirmText = 'OK'
  teamModal.value.cancelText = 'Cancel'
}

const handleTeamModalConfirm = () => {
  console.log('handleTeamModalConfirm called, teamModal.onConfirm:', teamModal.value.onConfirm)
  console.log('teamModal.value:', teamModal.value)
  if (teamModal.value.onConfirm && typeof teamModal.value.onConfirm === 'function') {
    console.log('Executing onConfirm function...')
    teamModal.value.onConfirm()
    hideTeamModal()
  } else {
    console.error('No valid onConfirm function found')
  }
}

const handleTeamModalCancel = () => {
  if (teamModal.value.onCancel) {
    teamModal.value.onCancel()
  }
  hideTeamModal()
}

// Modal helper functions
const getModalIcon = (type) => {
  switch (type) {
    case 'success': return 'bi-check-circle-fill'
    case 'warning': return 'bi-exclamation-triangle-fill'
    case 'danger': return 'bi-x-circle-fill'
    default: return 'bi-info-circle-fill'
  }
}

const getModalButtonClass = (type) => {
  switch (type) {
    case 'success': return 'btn-success'
    case 'warning': return 'btn-warning'
    case 'danger': return 'btn-danger'
    default: return 'btn-primary'
  }
}

const toggleSort = (field) => {
  if (sortBy.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = field
    sortOrder.value = 'asc'
  }
}

const changePage = (page) => {
  currentPage.value = page
}

const toggleShowAllMembers = () => {
  showAllMembers.value = !showAllMembers.value
  currentPage.value = 1
}

const resetFilters = () => {
  searchQuery.value = ''
  roleFilter.value = ''
  statusFilter.value = ''
  sortBy.value = 'name'
  sortOrder.value = 'asc'
  currentPage.value = 1
}

// Load team data on component mount
onMounted(() => {
  loadTeamData()
})
</script>

<style scoped>
.manage-teams-page {
  background-color: #f8f9fa;
  min-height: 100vh;
}

/* Dashboard Header */
.dashboard-header {
  background: #000000 !important;
  color: white;
  margin-bottom: 2rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.header-content {
  padding: 0 1.5rem;
}

.dashboard-logo {
  height: 6.5rem;
  width: auto;
}

.dashboard-title {
  font-size: 3rem;
  font-weight: 700;
  margin: 0;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  color: white;
  transition: transform 0.2s ease, text-shadow 0.2s ease;
}

.dashboard-title:hover {
  transform: scale(1.02);
  text-shadow: 0 4px 8px rgba(0, 0, 0, 0.7);
}

.stat-card {
  border: 1px solid #e9ecef;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.stat-number {
  color: #000;
  font-weight: 700;
}

.member-row {
  padding: 1rem 0;
  border-bottom: 1px solid #e9ecef;
}

.member-row:last-child {
  border-bottom: none;
}

.member-avatar img {
  border: 2px solid #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.member-name {
  color: #000;
  font-size: 0.95rem;
}

.member-email {
  font-size: 0.85rem;
}

.badge {
  font-size: 0.75rem;
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
  text-transform: uppercase;
  font-weight: 500;
}

.modal {
  background-color: rgba(0, 0, 0, 0.5);
}

.modal-content {
  border: none;
  border-radius: 0.5rem;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
}

.form-control, .form-select {
  border: 1px solid #dee2e6;
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
}

.form-control:focus, .form-select:focus {
  border-color: #000;
  box-shadow: 0 0 0 0.2rem rgba(0, 0, 0, 0.25);
}

.btn {
  border-radius: 0.375rem;
  font-weight: 500;
  padding: 0.5rem 1rem;
}

.btn-primary {
  background-color: #000;
  border-color: #000;
}

.btn-primary:hover {
  background-color: #333;
  border-color: #333;
}

.btn-outline-secondary {
  border-color: #dee2e6;
  color: #6c757d;
}

.btn-outline-secondary:hover {
  background-color: #6c757d;
  border-color: #6c757d;
}

.member-headers {
  border-bottom: 2px solid #e9ecef;
  font-weight: 600;
  color: #000;
}

.member-headers .btn-link {
  color: inherit;
  border: none;
  background: none;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  transition: background-color 0.2s ease;
}

.member-headers .btn-link:hover {
  background-color: #f8f9fa;
  color: #000;
}

.member-headers i {
  font-size: 0.75rem;
  margin-left: 0.25rem;
}

.spinner-border-sm {
  width: 1rem;
  height: 1rem;
}

.alert {
  border: none;
  border-radius: 0.5rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.alert-success {
  background-color: #d1e7dd;
  color: #0f5132;
}

.invalid-feedback {
  display: block;
  font-size: 0.875rem;
  color: #dc3545;
  margin-top: 0.25rem;
}

.form-control.is-invalid {
  border-color: #dc3545;
}

.form-control.is-invalid:focus {
  border-color: #dc3545;
  box-shadow: 0 0 0 0.2rem rgba(220, 53, 69, 0.25);
}

.btn-group .btn {
  border-radius: 0;
}

.btn-group .btn:first-child {
  border-top-left-radius: 0.375rem;
  border-bottom-left-radius: 0.375rem;
}

.btn-group .btn:last-child {
  border-top-right-radius: 0.375rem;
  border-bottom-right-radius: 0.375rem;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .dashboard-title {
    font-size: 1.5rem;
  }
  
  .member-row {
    padding: 0.75rem 0;
  }
  
  .member-actions {
    margin-top: 0.5rem;
  }
  
  .member-headers {
    display: none;
  }
  
  .d-flex.gap-2.flex-wrap {
    gap: 0.5rem !important;
  }
  
  .form-control-sm, .form-select-sm {
    font-size: 0.875rem;
  }
}
</style>
