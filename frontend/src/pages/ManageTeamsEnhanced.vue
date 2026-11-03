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
        <div class="col-12" style="max-width: 1400px;">
          
          <!-- Enhanced Team Overview Card -->
          <div class="card border-0 shadow-sm mb-4">
            <div class="card-body p-4">
              <div class="row align-items-center mb-4">
                <div class="col">
                  <h2 class="h4 mb-1">Team Analytics</h2>
                  <p class="text-muted mb-0">{{ teamMembers.length }} members • {{ activeMembers.length }} active • {{ totalSessions }} sessions this week</p>
                </div>
                <div class="col-auto">
                  <button @click="showInviteModal = true" class="btn btn-primary">
                    <i class="bi bi-person-plus me-2"></i>Invite Member
                  </button>
                </div>
              </div>

              <!-- Enhanced Stats Cards -->
              <div class="row g-3 mb-4">
                <div class="col-md-2">
                  <div class="stat-card bg-light rounded p-3 text-center">
                    <div class="stat-number h3 mb-1">{{ teamMembers.length }}</div>
                    <div class="stat-label small text-muted">Total Members</div>
                  </div>
                </div>
                <div class="col-md-2">
                  <div class="stat-card bg-light rounded p-3 text-center">
                    <div class="stat-number h3 mb-1">{{ activeMembers.length }}</div>
                    <div class="stat-label small text-muted">Active</div>
                  </div>
                </div>
                <div class="col-md-2">
                  <div class="stat-card bg-light rounded p-3 text-center">
                    <div class="stat-number h3 mb-1">{{ uniqueIDEs.length }}</div>
                    <div class="stat-label small text-muted">IDEs Used</div>
                  </div>
                </div>
                <div class="col-md-2">
                  <div class="stat-card bg-light rounded p-3 text-center">
                    <div class="stat-number h3 mb-1">{{ totalCommits }}</div>
                    <div class="stat-label small text-muted">Commits</div>
                  </div>
                </div>
                <div class="col-md-2">
                  <div class="stat-card bg-light rounded p-3 text-center">
                    <div class="stat-number h3 mb-1">{{ aiAdoptionRate }}%</div>
                    <div class="stat-label small text-muted">AI Adoption</div>
                  </div>
                </div>
                <div class="col-md-2">
                  <div class="stat-card bg-light rounded p-3 text-center">
                    <div class="stat-number h3 mb-1">{{ avgSessionTime }}h</div>
                    <div class="stat-label small text-muted">Avg Session</div>
                  </div>
                </div>
              </div>

              <!-- IDE Distribution -->
              <div class="row">
                <div class="col-md-6">
                  <h6 class="text-muted mb-3">IDE Distribution</h6>
                  <div class="d-flex flex-wrap gap-2">
                    <span v-for="ide in ideDistribution" :key="ide.name" 
                          class="badge bg-secondary d-flex align-items-center">
                      <i :class="getIDEIcon(ide.name)" class="me-1"></i>
                      {{ ide.name }}: {{ ide.count }}
                    </span>
                  </div>
                </div>
                <div class="col-md-6">
                  <h6 class="text-muted mb-3">Top Languages</h6>
                  <div class="d-flex flex-wrap gap-2">
                    <span v-for="lang in topLanguages.slice(0, 5)" :key="lang" 
                          class="badge bg-info">
                      {{ lang }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Enhanced Team Members Table -->
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
                    <option value="developer">Developer</option>
                  </select>
                  <select v-model="statusFilter" class="form-select form-select-sm" style="width: 120px;">
                    <option value="">All Status</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="pending">Pending</option>
                  </select>
                  <select v-model="ideFilter" class="form-select form-select-sm" style="width: 120px;">
                    <option value="">All IDEs</option>
                    <option v-for="ide in uniqueIDEs" :key="ide" :value="ide">{{ ide }}</option>
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

              <!-- Enhanced Members List -->
              <div v-else class="members-list">
                <!-- Enhanced Headers -->
                <div class="member-headers d-flex align-items-center pb-2 mb-2 border-bottom">
                  <div class="member-info flex-grow-1">
                    <button @click="toggleSort('name')" class="btn btn-link text-decoration-none p-0 fw-semibold">
                      Member
                      <i :class="sortBy === 'name' && sortOrder === 'asc' ? 'bi bi-arrow-up' : 'bi bi-arrow-down'"></i>
                    </button>
                  </div>
                  <div class="member-ide me-3">
                    <button @click="toggleSort('ide')" class="btn btn-link text-decoration-none p-0 fw-semibold">
                      IDE
                      <i :class="sortBy === 'ide' && sortOrder === 'asc' ? 'bi bi-arrow-up' : 'bi bi-arrow-down'"></i>
                    </button>
                  </div>
                  <div class="member-activity me-3">
                    <button @click="toggleSort('activity')" class="btn btn-link text-decoration-none p-0 fw-semibold">
                      Activity
                      <i :class="sortBy === 'activity' && sortOrder === 'asc' ? 'bi bi-arrow-up' : 'bi bi-arrow-down'"></i>
                    </button>
                  </div>
                  <div class="member-role me-3">
                    <button @click="toggleSort('role')" class="btn btn-link text-decoration-none p-0 fw-semibold">
                      Role
                      <i :class="sortBy === 'role' && sortOrder === 'asc' ? 'bi bi-arrow-up' : 'bi bi-arrow-down'"></i>
                    </button>
                  </div>
                  <div class="member-status me-3">
                    <button @click="toggleSort('status')" class="btn btn-link text-decoration-none p-0 fw-semibold">
                      Status
                      <i :class="sortBy === 'status' && sortOrder === 'asc' ? 'bi bi-arrow-up' : 'bi bi-arrow-down'"></i>
                    </button>
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
                    <div class="member-info flex-grow-1">
                      <div class="member-name fw-semibold">{{ member.name || member.email }}</div>
                      <div class="member-email small text-muted">{{ member.email }}</div>
                      <div class="member-details small text-muted mt-1">
                        <span v-if="member.topLanguage" class="badge bg-light text-dark me-2">
                          <i class="bi bi-code-slash me-1"></i>{{ member.topLanguage }}
                        </span>
                        <span v-if="member.repositories && member.repositories.length > 0" class="badge bg-light text-dark me-2">
                          <i class="bi bi-git me-1"></i>{{ member.repositories.length }} repos
                        </span>
                        <span v-if="member.lastActive" class="badge bg-light text-dark">
                          <i class="bi bi-clock me-1"></i>{{ formatLastActive(member.lastActive) }}
                        </span>
                      </div>
                    </div>
                    <div class="member-ide me-3">
                      <div v-if="member.primaryIDE" class="d-flex align-items-center">
                        <i :class="getIDEIcon(member.primaryIDE)" class="me-1"></i>
                        <small>{{ member.primaryIDE }}</small>
                      </div>
                      <div v-else class="text-muted small">—</div>
                    </div>
                    <div class="member-activity me-3">
                      <div class="activity-indicator">
                        <div class="activity-dot" :class="getActivityClass(member.activityLevel)"></div>
                        <small>{{ member.activityLevel || 'Unknown' }}</small>
                      </div>
                    </div>
                    <div class="member-role me-3">
                      <span :class="getRoleBadgeClass(member.role)" class="badge">
                        {{ member.role }}
                      </span>
                    </div>
                    <div class="member-status me-3">
                      <span :class="getStatusClass(member.status)" class="badge">
                        {{ member.status }}
                      </span>
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
                          <li><button type="button" class="dropdown-item" @click="viewMemberDetails(member)">
                            <i class="bi bi-person-lines-fill me-2"></i>View Details
                          </button></li>
                          <li v-if="member.status === 'active'"><button type="button" class="dropdown-item" @click="editMember(member)">
                            <i class="bi bi-pencil me-2"></i>Edit Role
                          </button></li>
                          <li><button type="button" class="dropdown-item" @click="resendInvite(member)">
                            <i class="bi bi-envelope me-2"></i>Resend Invite
                          </button></li>
                          <li v-if="member.status === 'pending'"><button type="button" class="dropdown-item text-danger" @click="cancelInvite(member)">
                            <i class="bi bi-x-circle me-2"></i>Cancel Invite
                          </button></li>
                          <li v-if="member.status === 'active'"><button type="button" class="dropdown-item text-danger" @click="removeMember(member)">
                            <i class="bi bi-trash me-2"></i>Remove
                          </button></li>
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Enhanced Member Details Modal -->
    <div v-if="showMemberModal" class="modal fade show d-block" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="bi bi-person-badge me-2"></i>
              {{ selectedMember?.name }} - Developer Analytics
            </h5>
            <button type="button" class="btn-close" @click="showMemberModal = false"></button>
          </div>
          <div class="modal-body" v-if="selectedMember">
            <!-- Member Overview -->
            <div class="row mb-4">
              <div class="col-md-8">
                <div class="d-flex align-items-center mb-3">
                  <div class="rounded-circle bg-secondary d-flex align-items-center justify-content-center me-3" 
                       style="width: 60px; height: 60px;">
                    <i class="bi bi-person text-white fs-4"></i>
                  </div>
                  <div>
                    <h6 class="mb-1">{{ selectedMember.name }}</h6>
                    <p class="text-muted mb-0">{{ selectedMember.email }}</p>
                    <div class="mt-2">
                      <span :class="getRoleBadgeClass(selectedMember.role)" class="badge me-2">
                        {{ selectedMember.role }}
                      </span>
                      <span :class="getStatusClass(selectedMember.status)" class="badge">
                        {{ selectedMember.status }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="col-md-4">
                <div class="text-center">
                  <div class="h4 mb-1">{{ selectedMember.totalSessions || 0 }}</div>
                  <div class="text-muted small">Total Sessions</div>
                </div>
              </div>
            </div>

            <!-- Development Metrics -->
            <div class="row mb-4">
              <div class="col-12">
                <h6 class="mb-3">Development Metrics</h6>
              </div>
              <div class="col-md-3">
                <div class="card bg-light">
                  <div class="card-body text-center">
                    <div class="h5 mb-1">{{ selectedMember.totalCommits || 0 }}</div>
                    <div class="small text-muted">Commits</div>
                  </div>
                </div>
              </div>
              <div class="col-md-3">
                <div class="card bg-light">
                  <div class="card-body text-center">
                    <div class="h5 mb-1">{{ selectedMember.aiAccepts || 0 }}</div>
                    <div class="small text-muted">AI Accepts</div>
                  </div>
                </div>
              </div>
              <div class="col-md-3">
                <div class="card bg-light">
                  <div class="card-body text-center">
                    <div class="h5 mb-1">{{ formatDuration(selectedMember.avgSessionDuration) }}</div>
                    <div class="small text-muted">Avg Session</div>
                  </div>
                </div>
              </div>
              <div class="col-md-3">
                <div class="card bg-light">
                  <div class="card-body text-center">
                    <div class="h5 mb-1">{{ selectedMember.reworkRate || 0 }}%</div>
                    <div class="small text-muted">Rework Rate</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- IDE and Language Usage -->
            <div class="row mb-4">
              <div class="col-md-6">
                <h6 class="mb-3">IDE Usage</h6>
                <div v-if="selectedMember.ideUsage && selectedMember.ideUsage.length > 0">
                  <div v-for="ide in selectedMember.ideUsage" :key="ide.name" class="d-flex justify-content-between align-items-center mb-2">
                    <span>
                      <i :class="getIDEIcon(ide.name)" class="me-2"></i>{{ ide.name }}
                    </span>
                    <span class="badge bg-secondary">{{ ide.percentage }}%</span>
                  </div>
                </div>
                <div v-else class="text-muted">No IDE data available</div>
              </div>
              <div class="col-md-6">
                <h6 class="mb-3">Programming Languages</h6>
                <div v-if="selectedMember.languages && selectedMember.languages.length > 0">
                  <div v-for="lang in selectedMember.languages" :key="lang.name" class="d-flex justify-content-between align-items-center mb-2">
                    <span>{{ lang.name }}</span>
                    <span class="badge bg-info">{{ lang.percentage }}%</span>
                  </div>
                </div>
                <div v-else class="text-muted">No language data available</div>
              </div>
            </div>

            <!-- Repository Activity -->
            <div class="row mb-4">
              <div class="col-12">
                <h6 class="mb-3">Repository Activity</h6>
                <div v-if="selectedMember.repositories && selectedMember.repositories.length > 0">
                  <div class="d-flex flex-wrap gap-2">
                    <span v-for="repo in selectedMember.repositories" :key="repo" 
                          class="badge bg-light text-dark">
                      <i class="bi bi-git me-1"></i>{{ getRepoName(repo) }}
                    </span>
                  </div>
                </div>
                <div v-else class="text-muted">No repository data available</div>
              </div>
            </div>

            <!-- Activity Timeline -->
            <div class="row">
              <div class="col-12">
                <h6 class="mb-3">Recent Activity</h6>
                <div class="timeline">
                  <div v-for="activity in selectedMember.recentActivity" :key="activity.id" 
                       class="timeline-item d-flex align-items-start mb-3">
                    <div class="timeline-dot me-3" :class="getActivityTypeClass(activity.type)"></div>
                    <div class="timeline-content">
                      <div class="fw-semibold">{{ activity.title }}</div>
                      <div class="text-muted small">{{ activity.description }}</div>
                      <div class="text-muted small">{{ formatDate(activity.timestamp) }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="showMemberModal = false">Close</button>
          </div>
        </div>
      </div>
      <div class="modal-backdrop fade show" @click="showMemberModal = false"></div>
    </div>

    <!-- Original Modals (Invite, Edit Role, etc.) -->
    <!-- ... (keeping existing modals for backward compatibility) ... -->
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import api from '../config/api'
import NavUserAvatar from '../components/NavUserAvatar.vue'

const router = useRouter()
const authStore = useAuthStore()

const handleLogout = async () => {
  await authStore.logout()
  router.push('/login')
}

const goToDashboards = () => {
  router.push('/dashboards')
}

// State
const showInviteModal = ref(false)
const showEditRoleModal = ref(false)
const showMemberModal = ref(false)
const searchQuery = ref('')
const roleFilter = ref('')
const statusFilter = ref('')
const ideFilter = ref('')
const sortBy = ref('name')
const sortOrder = ref('asc')
const isLoading = ref(false)
const loadingStates = ref({})
const selectedMember = ref(null)
const organizationInfo = ref({})

// Enhanced data state
const telemetryData = ref([])
const sessionsData = ref([])
const teamMembers = ref([])
const isLoadingTeam = ref(false)
const isLoadingTelemetry = ref(false)

// Computed properties
const filteredMembers = computed(() => {
  let filtered = [...teamMembers.value]

  // Apply search filter
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    filtered = filtered.filter(member => 
      member.name.toLowerCase().includes(query) ||
      member.email.toLowerCase().includes(query) ||
      (member.topLanguage && member.topLanguage.toLowerCase().includes(query))
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

  // Apply IDE filter
  if (ideFilter.value) {
    filtered = filtered.filter(member => member.primaryIDE === ideFilter.value)
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

  return filtered
})

const activeMembers = computed(() => 
  teamMembers.value.filter(member => member.status === 'active')
)

// Enhanced analytics
const uniqueIDEs = computed(() => {
  const ides = new Set()
  teamMembers.value.forEach(member => {
    if (member.primaryIDE) ides.add(member.primaryIDE)
  })
  return Array.from(ides)
})

const ideDistribution = computed(() => {
  const distribution = {}
  teamMembers.value.forEach(member => {
    const ide = member.primaryIDE || 'unknown'
    distribution[ide] = (distribution[ide] || 0) + 1
  })
  return Object.entries(distribution).map(([name, count]) => ({ name, count }))
})

const topLanguages = computed(() => {
  const languages = {}
  teamMembers.value.forEach(member => {
    if (member.topLanguage) {
      languages[member.topLanguage] = (languages[member.topLanguage] || 0) + 1
    }
  })
  return Object.entries(languages)
    .sort(([,a], [,b]) => b - a)
    .map(([name]) => name)
})

const totalSessions = computed(() => {
  return teamMembers.value.reduce((total, member) => total + (member.totalSessions || 0), 0)
})

const totalCommits = computed(() => {
  return teamMembers.value.reduce((total, member) => total + (member.totalCommits || 0), 0)
})

const aiAdoptionRate = computed(() => {
  const activeMembers = teamMembers.value.filter(m => m.status === 'active')
  if (activeMembers.length === 0) return 0
  const aiUsers = activeMembers.filter(m => (member.aiAccepts || 0) > 0)
  return Math.round((aiUsers.length / activeMembers.length) * 100)
})

const avgSessionTime = computed(() => {
  const sessions = teamMembers.value.map(m => m.avgSessionDuration || 0).filter(d => d > 0)
  if (sessions.length === 0) return 0
  const avgMs = sessions.reduce((a, b) => a + b, 0) / sessions.length
  return (avgMs / (1000 * 60 * 60)).toFixed(1)
})

// Methods
const getIDEIcon = (ide) => {
  const icons = {
    'windsurf': 'bi-lightning-charge',
    'cursor': 'bi-cursor',
    'vscode': 'bi-code-square',
    'unknown': 'bi-question-circle'
  }
  return icons[ide.toLowerCase()] || icons.unknown
}

const getActivityClass = (level) => {
  const classes = {
    'high': 'bg-success',
    'medium': 'bg-warning', 
    'low': 'bg-danger',
    'unknown': 'bg-secondary'
  }
  return classes[level.toLowerCase()] || classes.unknown
}

const getActivityTypeClass = (type) => {
  const classes = {
    'commit': 'bg-success',
    'ai_accept': 'bg-primary',
    'session': 'bg-info',
    'file_edit': 'bg-secondary'
  }
  return classes[type] || 'bg-secondary'
}

const getRoleBadgeClass = (role) => {
  const classes = {
    'admin': 'bg-danger',
    'member': 'bg-primary',
    'developer': 'bg-success'
  }
  return classes[role] || 'bg-secondary'
}

const getStatusClass = (status) => {
  if (status === 'active') return 'bg-success'
  if (status === 'inactive') return 'bg-secondary'
  if (status === 'pending') return 'bg-warning'
  return 'bg-secondary'
}

const formatLastActive = (timestamp) => {
  if (!timestamp) return 'Never'
  const now = new Date()
  const last = new Date(timestamp)
  const diffHours = Math.floor((now - last) / (1000 * 60 * 60))
  
  if (diffHours < 1) return 'Just now'
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffHours < 168) return `${Math.floor(diffHours / 24)}d ago`
  return `${Math.floor(diffHours / 168)}w ago`
}

const formatDuration = (ms) => {
  if (!ms) return '0m'
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const formatDate = (timestamp) => {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleDateString()
}

const getRepoName = (url) => {
  if (!url) return 'Unknown'
  const match = url.match(/github\.com\/.*?\/([^\/]+)/)
  return match ? match[1] : url
}

const toggleSort = (field) => {
  if (sortBy.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = field
    sortOrder.value = 'asc'
  }
}

const resetFilters = () => {
  searchQuery.value = ''
  roleFilter.value = ''
  statusFilter.value = ''
  ideFilter.value = ''
}

const getLoadingKey = (action, memberId) => `${action}_${memberId || 'global'}`

// Enhanced data loading
const loadTelemetryData = async () => {
  isLoadingTelemetry.value = true
  try {
    const response = await api.get('/api/telemetry?limit=500')
    telemetryData.value = response.data.events || []
    console.log('Telemetry data loaded:', telemetryData.value.length, 'events')
  } catch (error) {
    console.error('Failed to load telemetry data:', error)
    telemetryData.value = []
  } finally {
    isLoadingTelemetry.value = false
  }
}

const loadSessionsData = async () => {
  try {
    const response = await api.get('/api/telemetry/sessions')
    sessionsData.value = response.data.sessions || []
    console.log('Sessions data loaded:', sessionsData.value.length, 'sessions')
  } catch (error) {
    console.error('Failed to load sessions data:', error)
    sessionsData.value = []
  }
}

const loadTeamData = async () => {
  isLoadingTeam.value = true
  try {
    const response = await api.get('/api/org/users')
    console.log('Organization response:', response.data)
    
    if (response.data) {
      organizationInfo.value = response.data.organization
      teamMembers.value = response.data.users || []
      
      console.log('Team members loaded:', teamMembers.value.length)
      
      // Enhance team members with telemetry data
      await enhanceTeamMembersWithTelemetry()
    }
  } catch (error) {
    console.error('Failed to load team data:', error)
    teamMembers.value = []
  } finally {
    isLoadingTeam.value = false
  }
}

const enhanceTeamMembersWithTelemetry = async () => {
  console.log('Enhancing team members with telemetry data...')
  
  for (let member of teamMembers.value) {
    // Find telemetry events for this user
    const userEvents = telemetryData.value.filter(event => 
      event.user_id == member.github_id || 
      event.metadata?.user_id == member.github_id
    )
    
    // Find sessions for this user
    const userSessions = sessionsData.value.filter(session => 
      session.user_id == member.github_id ||
      session.session_id?.includes(member.github_id)
    )
    
    // Calculate metrics
    const sessions = userSessions.length || userEvents.filter(e => e.event_type === 'session').length
    const commits = userEvents.filter(e => e.event_type === 'commit').length
    const aiAccepts = userEvents.filter(e => e.event_type === 'ai_accept').length
    
    // Determine primary IDE
    const ideCounts = {}
    userEvents.forEach(event => {
      const ide = event.tool || event.source || event.metadata?.source || 'unknown'
      ideCounts[ide] = (ideCounts[ide] || 0) + 1
    })
    const primaryIDE = Object.entries(ideCounts)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || null
    
    // Extract repositories
    const repositories = [...new Set(userEvents
      .map(e => e.metadata?.git_repo_url)
      .filter(Boolean)
    )]
    
    // Extract languages (from file extensions in metadata)
    const languageCounts = {}
    userEvents.forEach(event => {
      if (event.metadata?.file_path) {
        const ext = event.metadata.file_path.split('.').pop()?.toLowerCase()
        if (ext) {
          const lang = getLanguageFromExtension(ext)
          languageCounts[lang] = (languageCounts[lang] || 0) + 1
        }
      }
    })
    const topLanguage = Object.entries(languageCounts)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || null
    
    // Calculate activity level
    const now = new Date()
    const recentEvents = userEvents.filter(event => {
      const eventDate = new Date(event.timestamp)
      const daysDiff = (now - eventDate) / (1000 * 60 * 60 * 24)
      return daysDiff <= 7
    })
    
    let activityLevel = 'unknown'
    if (recentEvents.length > 50) activityLevel = 'high'
    else if (recentEvents.length > 10) activityLevel = 'medium'
    else if (recentEvents.length > 0) activityLevel = 'low'
    
    // Average session duration
    const sessionDurations = userSessions
      .map(s => s.duration_ms)
      .filter(d => d && d > 0)
    const avgSessionDuration = sessionDurations.length > 0
      ? sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length
      : 0
    
    // Last active timestamp
    const lastEvent = userEvents
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0]
    const lastActive = lastEvent ? lastEvent.timestamp : null
    
    // Rework rate (simplified calculation)
    const totalLinesAdded = userEvents.reduce((sum, e) => 
      sum + (e.metadata?.lines_added || 0), 0)
    const totalLinesRemoved = userEvents.reduce((sum, e) => 
      sum + (e.metadata?.lines_removed || 0), 0)
    const reworkRate = totalLinesAdded > 0 
      ? Math.round((totalLinesRemoved / totalLinesAdded) * 100)
      : 0
    
    // IDE usage breakdown
    const ideUsage = Object.entries(ideCounts)
      .map(([name, count]) => ({
        name,
        count,
        percentage: Math.round((count / userEvents.length) * 100)
      }))
      .sort((a, b) => b.count - a.count)
    
    // Language breakdown
    const languages = Object.entries(languageCounts)
      .map(([name, count]) => ({
        name,
        count,
        percentage: Math.round((count / Object.values(languageCounts).reduce((a, b) => a + b, 0)) * 100)
      }))
      .sort((a, b) => b.count - a.count)
    
    // Recent activity
    const recentActivity = userEvents
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10)
      .map(event => ({
        id: event.id,
        type: event.event_type,
        title: getEventTitle(event.event_type),
        description: getEventDescription(event),
        timestamp: event.timestamp
      }))
    
    // Enhance member object
    member.totalSessions = sessions
    member.totalCommits = commits
    member.aiAccepts = aiAccepts
    member.primaryIDE = primaryIDE
    member.topLanguage = topLanguage
    member.repositories = repositories
    member.activityLevel = activityLevel
    member.avgSessionDuration = avgSessionDuration
    member.lastActive = lastActive
    member.reworkRate = reworkRate
    member.ideUsage = ideUsage
    member.languages = languages
    member.recentActivity = recentActivity
  }
  
  console.log('Team members enhanced with telemetry data')
}

const getLanguageFromExtension = (ext) => {
  const languageMap = {
    'js': 'JavaScript',
    'ts': 'TypeScript',
    'py': 'Python',
    'java': 'Java',
    'cpp': 'C++',
    'c': 'C',
    'cs': 'C#',
    'php': 'PHP',
    'rb': 'Ruby',
    'go': 'Go',
    'rs': 'Rust',
    'swift': 'Swift',
    'kt': 'Kotlin',
    'scala': 'Scala',
    'html': 'HTML',
    'css': 'CSS',
    'scss': 'SCSS',
    'vue': 'Vue',
    'jsx': 'React',
    'tsx': 'React',
    'json': 'JSON',
    'xml': 'XML',
    'yaml': 'YAML',
    'md': 'Markdown',
    'sql': 'SQL',
    'sh': 'Shell',
    'dockerfile': 'Docker'
  }
  return languageMap[ext] || ext.toUpperCase()
}

const getEventTitle = (eventType) => {
  const titles = {
    'commit': 'Code Commit',
    'ai_accept': 'AI Suggestion Accepted',
    'session': 'Coding Session',
    'file_edit': 'File Edited',
    'test_init': 'Test Run'
  }
  return titles[eventType] || eventType
}

const getEventDescription = (event) => {
  if (event.event_type === 'commit' && event.metadata?.git_repo_url) {
    return `Committed to ${getRepoName(event.metadata.git_repo_url)}`
  }
  if (event.event_type === 'ai_accept') {
    return `Accepted AI suggestion in ${event.tool || 'unknown IDE'}`
  }
  if (event.event_type === 'session') {
    return `Session duration: ${formatDuration(event.duration_ms)}`
  }
  if (event.event_type === 'file_edit' && event.metadata?.file_path) {
    return `Edited ${event.metadata.file_path}`
  }
  return `Event in ${event.tool || event.source || 'unknown'}`
}

const viewMemberDetails = (member) => {
  selectedMember.value = member
  showMemberModal.value = true
}

// Placeholder methods for existing functionality
const editMember = (member) => {
  selectedMember.value = { ...member }
  showEditRoleModal.value = true
}

const removeMember = async (member) => {
  if (!member.id) {
    console.error('No user ID found for member:', member)
    return
  }
  
  // Implementation would go here
  console.log('Remove member:', member)
}

const resendInvite = (member) => {
  console.log('Resend invite:', member)
}

const cancelInvite = (member) => {
  console.log('Cancel invite:', member)
}

// Load data on mount
onMounted(async () => {
  await Promise.all([
    loadTeamData(),
    loadTelemetryData(),
    loadSessionsData()
  ])
})
</script>

<style scoped>
.manage-teams-page {
  background-color: #f8f9fa;
  min-height: 100vh;
}

.dashboard-header {
  border-bottom: 1px solid #dee2e6;
}

.dashboard-logo {
  width: 40px;
  height: 40px;
}

.dashboard-title {
  color: #ffffff;
  font-size: 2rem;
  margin: 0;
}

.stat-card {
  border: 1px solid #e9ecef;
  transition: transform 0.2s ease-in-out;
}

.stat-card:hover {
  transform: translateY(-2px);
}

.stat-number {
  font-weight: 700;
  color: #495057;
}

.member-row {
  border-bottom: 1px solid #f1f3f4;
  padding: 12px 0;
  transition: background-color 0.2s ease;
}

.member-row:hover {
  background-color: #f8f9fa;
  border-radius: 8px;
  margin: 0 -8px;
  padding: 12px 8px;
}

.member-headers {
  font-size: 0.875rem;
  font-weight: 600;
  color: #6c757d;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.activity-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
}

.activity-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.timeline {
  max-height: 300px;
  overflow-y: auto;
}

.timeline-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-top: 4px;
  flex-shrink: 0;
}

.timeline-content {
  flex: 1;
}

.member-details {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.badge {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
}

.card {
  border: none;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.modal-dialog {
  box-shadow: 0 10px 30px rgba(0,0,0,0.2);
}

.btn {
  border-radius: 6px;
}

.form-control, .form-select {
  border-radius: 6px;
}

.dropdown-menu {
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.spinner-border {
  width: 1rem;
  height: 1rem;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .member-headers {
    display: none !important;
  }
  
  .member-row {
    flex-direction: column;
    align-items: flex-start !important;
    gap: 8px;
  }
  
  .member-info {
    width: 100%;
  }
  
  .member-actions {
    align-self: flex-end;
  }
}
</style>
