<template>
  <div class="empty-state">
    <div class="empty-state-content">
      <div class="empty-state-icon">
        <i :class="`bi bi-${icon}`"></i>
      </div>
      <h5 class="empty-state-title">{{ title }}</h5>
      <p class="empty-state-message">{{ message }}</p>
      <div v-if="steps && steps.length > 0" class="empty-state-steps">
        <p class="steps-label">Next steps:</p>
        <ol class="steps-list">
          <li v-for="(step, index) in steps" :key="index">{{ step }}</li>
        </ol>
      </div>
      <div v-if="actionLabel && actionUrl" class="empty-state-action">
        <a :href="actionUrl" class="btn btn-primary">
          {{ actionLabel }}
        </a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  icon?: string
  title: string
  message: string
  steps?: string[]
  actionLabel?: string
  actionUrl?: string
}>()
</script>

<style scoped>
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  padding: 1.5rem;
  text-align: center;
}

.empty-state-content {
  max-width: 500px;
}

.empty-state-icon {
  font-size: 2.5rem;
  color: #6c757d;
  margin-bottom: 1rem;
}

.empty-state-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #212529;
  margin-bottom: 0.75rem;
}

.empty-state-message {
  font-size: 0.95rem;
  color: #6c757d;
  margin-bottom: 1.5rem;
  line-height: 1.6;
}

.empty-state-steps {
  text-align: left;
  margin: 1.5rem auto;
  max-width: 400px;
}

.steps-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: #495057;
  margin-bottom: 0.5rem;
}

.steps-list {
  font-size: 0.9rem;
  color: #6c757d;
  padding-left: 1.5rem;
  margin: 0;
}

.steps-list li {
  margin-bottom: 0.5rem;
  line-height: 1.5;
}

.empty-state-action {
  margin-top: 1.5rem;
}
</style>
