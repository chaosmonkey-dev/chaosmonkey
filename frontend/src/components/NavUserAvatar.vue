<template>
  <div class="nav-user-avatar position-relative">
    <!-- Avatar Button -->
    <button
      @click="toggleDropdown"
      class="btn btn-link p-0 text-decoration-none"
      :disabled="loading || !isAuthenticated"
      :title="avatarTitle"
    >
      <div class="avatar-circle">
        <img 
          v-if="avatarUrl"
          :src="avatarUrl"
          :alt="user?.name || user?.login || 'User avatar'"
          class="avatar-img"
          @error="handleAvatarError"
        />
        <div 
          v-else
          class="avatar-placeholder"
        >
          {{ userInitials }}
        </div>
      </div>
    </button>

    <!-- Dropdown Panel -->
    <div v-if="showDropdown" class="user-dropdown dropdown-menu show position-absolute end-0 mt-2" @click.stop>
      <div class="dropdown-header d-flex align-items-center pb-2 border-bottom">
        <div class="avatar-circle me-3">
          <img 
            v-if="avatarUrl && !avatarLoadFailed"
            :src="avatarUrl"
            :alt="user?.name || user?.login || 'User avatar'"
            class="avatar-img"
            @error="handleAvatarError"
          />
          <div 
            v-else
            class="avatar-placeholder small"
          >
            {{ userInitials }}
          </div>
        </div>
        <div class="flex-grow-1">
          <div class="fw-semibold">
            {{ user?.name || user?.login || 'Admin' }}
          </div>
          <small class="text-muted">@{{ user?.login || 'admin' }}</small>
        </div>
      </div>

      <!-- GitHub Info -->
      <div v-if="user" class="dropdown-item-text px-3 py-1">
        <small class="text-muted d-block">Signed in with</small>
        <span>
          <i class="bi bi-github me-1"></i>
          GitHub
        </span>
      </div>

      <!-- Menu Items -->
      <div class="dropdown-footer border-top pt-2">
        <button 
          @click="handleManageTeam"
          class="dropdown-item"
          type="button"
        >
          <i class="bi bi-people me-2"></i>
          Manage Team
        </button>
        <button
          @click="handleSettings"
          class="dropdown-item"
          type="button"
        >
          <i class="bi bi-gear me-2"></i>
          Settings
        </button>
        <button 
          @click="handleLogout"
          class="dropdown-item text-danger"
          type="button"
        >
          <i class="bi bi-box-arrow-right me-2"></i>
          Logout
        </button>
      </div>
    </div>

    <!-- Click outside to close -->
    <div 
      v-if="showDropdown"
      class="dropdown-backdrop position-fixed top-0 start-0 w-100 h-100"
      style="z-index: 1040;"
      @click="closeDropdown"
    ></div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { API_URL } from '../config/api'

const router = useRouter()
const authStore = useAuthStore()

// State
const showDropdown = ref(false)
const loading = ref(false)
const user = ref(null)
const error = ref(null)
const avatarLoadFailed = ref(false)

// Extract avatar URL from all possible field names in GitHub OAuth payload
const avatarUrl = computed(() => {
  if (!user.value) return null
  const u = user.value
  return u.avatar_url || u.avatarUrl || u.github_avatar_url || 
         u.githubAvatarUrl || u.photo_url || u.picture ||
         u.avatar || null
})

// Simulated data for team (will be replaced with real API later)
const simulatedTeam = ref([
  { id: 1, name: 'Alice', role: 'admin' },
  { id: 2, name: 'Bob', role: 'member' },
  { id: 3, name: 'Carol', role: 'member' },
  { id: 4, name: 'David', role: 'member' },
  { id: 5, name: 'Eve', role: 'admin' }
])

const simulatedUserRole = ref('admin')

// Computed — dashboard authorization (not GitHub OAuth status) determines
// whether the profile menu is available. A user authenticated to the
// dashboard can open settings even if GitHub delivery integration is
// absent or the user is a support login excluded from customer metrics.
const isAuthenticated = computed(() => {
  return !loading.value && authStore.isAuthed
})

const avatarTitle = computed(() => {
  if (user.value) return user.value.name || user.value.login || 'User profile'
  return 'User profile'
})

const userInitials = computed(() => {
  if (!user.value) return 'A'
  const name = user.value.name || user.value.login || ''
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.substring(0, 2).toUpperCase()
})

// Methods
const handleAvatarError = () => {
  avatarLoadFailed.value = true
}

// Methods
const toggleDropdown = () => {
  showDropdown.value = !showDropdown.value
}

const closeDropdown = () => {
  showDropdown.value = false
}

const handleLogout = async () => {
  closeDropdown()
  await authStore.logout()
}

const handleManageTeam = () => {
  closeDropdown()
  router.push('/settings?tab=team')
}

const handleSettings = () => {
  closeDropdown()
  router.push('/settings')
}

const handleManageTeams = () => {
  closeDropdown()
  router.push('/manage-teams')
}

const fetchUser = async () => {
  if (loading.value) return

  loading.value = true
  error.value = null

  // Dashboard auth is the authority for whether the avatar is interactive.
  // GitHub OAuth status is a separate concern (delivery integration / metrics
  // authority) and must not disable the profile menu.
  const hasRealCredential = (t) => t && t !== 'oauth_authenticated' && t.trim() !== ''
  authStore.isAuthed = hasRealCredential(authStore.token) || hasRealCredential(localStorage.getItem('api_token'))

  try {
    const response = await fetch(`${API_URL}/github/oauth/status`, {
      credentials: 'include'
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()

    // Use GitHub user info for display only when available.
    // Do NOT null out user or set isAuthed=false when oauth_authenticated
    // is false — the user may be a dashboard-authenticated support/admin.
    if (data.oauth_authenticated && data.user) {
      user.value = data.user
    }
  } catch (err) {
    console.error('Failed to fetch user status:', err)
    error.value = err.message
    // Do NOT set authStore.isAuthed = false on GitHub status fetch error.
    // Dashboard auth is independent of GitHub OAuth status.
  } finally {
    loading.value = false
  }
}

// Handle click outside
const handleClickOutside = (event) => {
  if (!event.target.closest('.nav-user-avatar')) {
    closeDropdown()
  }
}

// Lifecycle
onMounted(() => {
  fetchUser()
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.nav-user-avatar {
  z-index: 1050;
}

.avatar-circle {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.avatar-circle:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  background-color: #6c757d;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.avatar-placeholder.small {
  width: 32px;
  height: 32px;
  font-size: 14px;
}

.user-dropdown {
  min-width: 280px;
  max-width: 320px;
  max-height: 400px;
  overflow-y: auto;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  background: #fff;
  z-index: 1051;
}

.dropdown-header {
  padding: 12px 16px 8px;
}

.dropdown-body {
  font-size: 14px;
}

.dropdown-item-text {
  font-size: 13px;
  line-height: 1.4;
}

.dropdown-item-text small {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.dropdown-footer {
  padding: 8px 16px;
}

.dropdown-item {
  border-radius: 4px;
  font-size: 13px;
  padding: 6px 12px;
}

.dropdown-item:hover {
  background-color: #f8f9fa;
}

.dropdown-item.text-danger:hover {
  background-color: #fff5f5;
  color: #dc3545 !important;
}

.dropdown-backdrop {
  background: transparent;
}

/* Button disabled state */
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn:disabled .avatar-circle:hover {
  transform: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

/* New styles for expanded dropdown sections */
.dropdown-section {
  max-height: 150px;
  overflow-y: auto;
}

.team-member {
  font-size: 13px;
}

.member-role {
  font-size: 11px;
  text-transform: uppercase;
}

.plan-badge {
  color: #0d6efd;
}

.status-badge {
  font-size: 11px;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 12px;
}

.status-badge.active {
  background-color: #d1e7dd;
  color: #0f5132;
}

.status-badge.trial {
  background-color: #fff3cd;
  color: #664d03;
}

.status-badge.expired {
  background-color: #f8d7da;
  color: #721c24;
}

/* Scrollbar styling for dropdown sections and main dropdown */
.dropdown-section::-webkit-scrollbar,
.user-dropdown::-webkit-scrollbar {
  width: 4px;
}

.dropdown-section::-webkit-scrollbar-track,
.user-dropdown::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.dropdown-section::-webkit-scrollbar-thumb,
.user-dropdown::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 2px;
}

.dropdown-section::-webkit-scrollbar-thumb:hover,
.user-dropdown::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
</style>
