<template>
  <div v-if="show" class="modal fade show d-block" tabindex="-1">
    <div class="modal-dialog" :class="sizeClass">
      <div class="modal-content">
        <div class="modal-header" v-if="!hideHeader">
          <h5 class="modal-title">{{ title }}</h5>
          <button type="button" class="btn-close" @click="close"></button>
        </div>
        <div class="modal-body">
          <div v-if="loading" class="text-center py-4">
            <div class="spinner-border text-primary" role="status">
              <span class="visually-hidden">Loading...</span>
            </div>
            <p class="text-muted mt-2">{{ loadingText || 'Loading...' }}</p>
          </div>
          <div v-else>
            <slot name="body">
              <p>{{ content }}</p>
            </slot>
          </div>
        </div>
        <div class="modal-footer" v-if="!hideFooter">
          <slot name="footer">
            <button type="button" class="btn btn-secondary" @click="close">
              {{ cancelText || 'Cancel' }}
            </button>
            <button 
              type="button" 
              class="btn" 
              :class="confirmButtonClass"
              @click="confirm"
              :disabled="confirmDisabled || confirmLoading"
            >
              <span v-if="confirmLoading" class="spinner-border spinner-border-sm me-2"></span>
              {{ confirmText || 'Confirm' }}
            </button>
          </slot>
        </div>
      </div>
    </div>
    <div class="modal-backdrop fade show" @click="close"></div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: 'Modal Title'
  },
  content: {
    type: String,
    default: ''
  },
  size: {
    type: String,
    default: 'medium', // small, medium, large, extra-large
    validator: (value) => ['small', 'medium', 'large', 'extra-large'].includes(value)
  },
  loading: {
    type: Boolean,
    default: false
  },
  loadingText: {
    type: String,
    default: ''
  },
  confirmText: {
    type: String,
    default: 'Confirm'
  },
  cancelText: {
    type: String,
    default: 'Cancel'
  },
  confirmButtonClass: {
    type: String,
    default: 'btn-primary'
  },
  confirmDisabled: {
    type: Boolean,
    default: false
  },
  confirmLoading: {
    type: Boolean,
    default: false
  },
  hideHeader: {
    type: Boolean,
    default: false
  },
  hideFooter: {
    type: Boolean,
    default: false
  },
  closeOnBackdrop: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['close', 'confirm'])

const sizeClass = computed(() => {
  const sizeMap = {
    small: 'modal-sm',
    medium: '',
    large: 'modal-lg',
    'extra-large': 'modal-xl'
  }
  return sizeMap[props.size]
})

const close = () => {
  emit('close')
}

const confirm = () => {
  emit('confirm')
}

// Handle ESC key
const handleKeydown = (event) => {
  if (event.key === 'Escape' && props.show) {
    close()
  }
}

// Add and remove event listener
import { onMounted, onUnmounted } from 'vue'

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.modal {
  background-color: rgba(0, 0, 0, 0.5);
}

.modal-content {
  border: none;
  border-radius: 0.5rem;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
}

.modal-header {
  border-bottom: 1px solid #e9ecef;
  padding: 1rem 1.5rem;
}

.modal-body {
  padding: 1.5rem;
}

.modal-footer {
  border-top: 1px solid #e9ecef;
  padding: 1rem 1.5rem;
}

.btn-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  line-height: 1;
  color: #000;
  opacity: 0.5;
}

.btn-close:hover {
  opacity: 1;
}

.spinner-border-sm {
  width: 1rem;
  height: 1rem;
}
</style>
