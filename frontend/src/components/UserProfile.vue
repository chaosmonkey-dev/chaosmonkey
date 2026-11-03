<template>
  <div class="user-profile card border-0 bg-light">
    <div class="card-body">
      <!-- User Avatar and Basic Info -->
      <div class="d-flex align-items-center mb-3">
        <div class="user-avatar me-3">
          <img 
            v-if="user?.avatar_url" 
            :src="user.avatar_url" 
            :alt="user.login || 'User avatar'"
            class="rounded-circle"
            style="width: 48px; height: 48px; object-fit: cover;"
          />
          <div 
            v-else
            class="rounded-circle bg-secondary d-flex align-items-center justify-content-center"
            style="width: 48px; height: 48px;"
          >
            <i class="bi bi-person text-white"></i>
          </div>
        </div>
        <div class="user-info flex-grow-1">
          <h6 class="mb-0 fw-semibold">
            {{ user?.name || user?.login || (isConnected ? 'Connected (profile pending)' : 'GitHub User') }}
          </h6>
          <small class="text-muted">@{{ user?.login || (isConnected ? 'connected' : 'unknown') }}</small>
        </div>
        <div class="user-actions">
          <button 
            v-if="!isConnected"
            class="btn btn-sm btn-primary"
            @click="$emit('connect-github')"
          >
            <i class="bi bi-github me-1"></i>
            Connect GitHub
          </button>
          <div 
            v-else
            class="badge bg-success"
          >
            <i class="bi bi-check-circle me-1"></i>
            Connected
          </div>
        </div>
      </div>

      <!-- User Details (when connected) -->
      <div v-if="isConnected && user" class="user-details">
        <div class="row g-2 text-small">
          <div v-if="user.email" class="col-12">
            <div class="d-flex align-items-center">
              <i class="bi bi-envelope me-2 text-muted"></i>
              <span class="text-truncate">{{ user.email }}</span>
            </div>
          </div>
          <div v-if="user.location" class="col-12">
            <div class="d-flex align-items-center">
              <i class="bi bi-geo-alt me-2 text-muted"></i>
              <span>{{ user.location }}</span>
            </div>
          </div>
          <div v-if="user.company" class="col-12">
            <div class="d-flex align-items-center">
              <i class="bi bi-building me-2 text-muted"></i>
              <span>{{ user.company }}</span>
            </div>
          </div>
          <div v-if="user.bio" class="col-12">
            <div class="d-flex align-items-start">
              <i class="bi bi-info-circle me-2 text-muted mt-1"></i>
              <span class="text-truncate">{{ user.bio }}</span>
            </div>
          </div>
        </div>

        <!-- GitHub Stats -->
        <div class="github-stats mt-3 pt-3 border-top">
          <div class="row g-2 text-center">
            <div class="col-4">
              <div class="stat-item">
                <div class="fw-semibold">{{ user.public_repos || 0 }}</div>
                <small class="text-muted">Repos</small>
              </div>
            </div>
            <div class="col-4">
              <div class="stat-item">
                <div class="fw-semibold">{{ user.followers || 0 }}</div>
                <small class="text-muted">Followers</small>
              </div>
            </div>
            <div class="col-4">
              <div class="stat-item">
                <div class="fw-semibold">{{ user.following || 0 }}</div>
                <small class="text-muted">Following</small>
              </div>
            </div>
          </div>
        </div>

        <!-- Account Age -->
        <div v-if="user.created_at" class="account-age mt-2 text-center">
          <small class="text-muted">
            <i class="bi bi-calendar me-1"></i>
            Joined {{ formatDate(user.created_at) }}
          </small>
        </div>
      </div>

      <!-- Not Connected State -->
      <div v-else-if="!isConnected" class="not-connected text-center py-3">
        <i class="bi bi-github display-6 text-muted mb-2"></i>
        <p class="text-muted mb-0">Connect GitHub to see your profile and metrics</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  user: {
    type: Object,
    default: null
  },
  isConnected: {
    type: Boolean,
    default: false
  },
  loading: {
    type: Boolean,
    default: false
  }
})

defineEmits(['connect-github'])

// Format date helper
const formatDate = (dateString) => {
  if (!dateString) return ''
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short' 
    })
  } catch {
    return dateString
  }
}
</script>

<style scoped>
.user-profile {
  max-width: 100%;
}

.user-avatar img {
  border: 2px solid #fff;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.stat-item {
  font-size: 0.875rem;
}

.github-stats .stat-item {
  border-right: 1px solid #e9ecef;
}

.github-stats .stat-item:last-child {
  border-right: none;
}

.text-truncate {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .user-actions {
    flex-shrink: 0;
  }
  
  .text-truncate {
    max-width: 150px;
  }
}
</style>
