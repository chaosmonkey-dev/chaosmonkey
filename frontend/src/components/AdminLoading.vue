<template>
  <div class="admin-loading" :class="containerClass">
    <!-- Full page loading -->
    <div v-if="type === 'full'" class="full-page-loading">
      <div class="loading-content">
        <div class="spinner-border text-primary" :style="spinnerStyle" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
        <p class="loading-text mt-3">{{ text || 'Loading...' }}</p>
        <p v-if="subtext" class="loading-subtext text-muted">{{ subtext }}</p>
      </div>
    </div>

    <!-- Card loading -->
    <div v-else-if="type === 'card'" class="card-loading">
      <div class="card-body text-center py-5">
        <div class="spinner-border text-primary" :style="spinnerStyle" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
        <p class="loading-text mt-3 mb-0">{{ text || 'Loading...' }}</p>
      </div>
    </div>

    <!-- Inline loading -->
    <div v-else-if="type === 'inline'" class="inline-loading d-flex align-items-center">
      <div class="spinner-border spinner-border-sm text-primary me-2" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      <span class="loading-text">{{ text || 'Loading...' }}</span>
    </div>

    <!-- Skeleton loading -->
    <div v-else-if="type === 'skeleton'" class="skeleton-loading">
      <div v-for="i in skeletonLines" :key="i" class="skeleton-line" :style="getSkeletonStyle(i)"></div>
    </div>

    <!-- Button loading -->
    <div v-else-if="type === 'button'" class="button-loading">
      <div class="spinner-border spinner-border-sm" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  type: {
    type: String,
    default: 'inline', // full, card, inline, skeleton, button
    validator: (value) => ['full', 'card', 'inline', 'skeleton', 'button'].includes(value)
  },
  text: {
    type: String,
    default: ''
  },
  subtext: {
    type: String,
    default: ''
  },
  size: {
    type: String,
    default: 'medium', // small, medium, large
    validator: (value) => ['small', 'medium', 'large'].includes(value)
  },
  skeletonLines: {
    type: Number,
    default: 3
  },
  center: {
    type: Boolean,
    default: true
  }
})

const containerClass = computed(() => {
  const classes = []
  if (props.center && props.type !== 'full') {
    classes.push('text-center')
  }
  return classes.join(' ')
})

const spinnerStyle = computed(() => {
  const sizeMap = {
    small: 'width: 1rem; height: 1rem;',
    medium: 'width: 2rem; height: 2rem;',
    large: 'width: 3rem; height: 3rem;'
  }
  return sizeMap[props.size]
})

const getSkeletonStyle = (index) => {
  const widths = ['100%', '85%', '60%', '90%', '75%']
  const delays = ['0s', '0.1s', '0.2s', '0.3s', '0.4s']
  
  return {
    width: widths[(index - 1) % widths.length],
    animationDelay: delays[(index - 1) % delays.length]
  }
}
</script>

<style scoped>
.admin-loading {
  width: 100%;
}

.full-page-loading {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.loading-content {
  text-align: center;
}

.loading-text {
  font-weight: 500;
  color: #000;
  margin: 0;
}

.loading-subtext {
  font-size: 0.875rem;
  margin-top: 0.5rem;
}

.card-loading {
  background: #f8f9fa;
  border-radius: 0.5rem;
}

.inline-loading {
  gap: 0.5rem;
}

.skeleton-loading {
  width: 100%;
}

.skeleton-line {
  height: 1rem;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s infinite;
  border-radius: 0.25rem;
  margin-bottom: 0.5rem;
}

.skeleton-line:last-child {
  margin-bottom: 0;
}

@keyframes skeleton-loading {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.button-loading {
  display: inline-block;
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
  .skeleton-line {
    background: linear-gradient(90deg, #333 25%, #444 50%, #333 75%);
    background-size: 200% 100%;
  }
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .loading-text {
    font-size: 0.9rem;
  }
  
  .loading-subtext {
    font-size: 0.8rem;
  }
}
</style>
