<template>
  <!-- Filter Control Bar -->
  <div class="w-full bg-gray-50 rounded-xl shadow-sm border border-gray-200 p-3 mb-4">
    <!-- Row 1: Granularity + Global toggle -->
    <div class="flex flex-wrap items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <label class="text-sm font-medium text-gray-600">Granularity:</label>
        <select 
          v-model="localGranularity"
          :disabled="useGlobalFilters"
          class="text-sm border border-gray-300 rounded-md px-2 py-1 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
        >
          <option value="auto">Auto</option>
          <option value="hour">Hour</option>
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
          <option value="quarter">Quarter</option>
        </select>
      </div>
      <label class="flex items-center text-sm text-gray-600">
        <input 
          type="checkbox" 
          v-model="useGlobalFilters" 
          class="mr-2 accent-blue-600"
        />
        Use global filters
      </label>
    </div>

    <!-- Row 2: Metrics + Tools -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <div class="text-xs uppercase text-gray-500 mb-1 tracking-wide">Metrics</div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="metric in metrics"
            :key="metric.id"
            @click="toggleMetric(metric.id)"
            :disabled="useGlobalFilters"
            :class="[
              'px-2 py-1 rounded-md text-xs border transition-all duration-150',
              localSelectedMetrics.includes(metric.id)
                ? 'bg-blue-100 border-blue-300 text-blue-700 font-medium'
                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-100',
              useGlobalFilters ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
            ]">
            {{ metric.label }}
          </button>
        </div>
      </div>

      <div>
        <div class="text-xs uppercase text-gray-500 mb-1 tracking-wide">Tools</div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="tool in tools"
            :key="tool"
            @click="toggleTool(tool)"
            :disabled="useGlobalFilters"
            :class="[
              'px-2 py-1 rounded-md text-xs border transition-all duration-150',
              localSelectedTools.includes(tool)
                ? 'bg-blue-100 border-blue-300 text-blue-700 font-medium'
                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-100',
              useGlobalFilters ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
            ]">
            {{ tool }}
          </button>
        </div>
      </div>
    </div>
    
    <!-- Filter Status -->
    <div class="mt-2 text-xs text-gray-600">
      <span v-if="useGlobalFilters">
        Using global filters: {{ effectiveGranularity }} · {{ effectiveMetrics.length }} metrics · {{ effectiveTools.length }} tools
      </span>
      <span v-else>
        Local filters: {{ effectiveGranularity }} · {{ effectiveMetrics.length }} metrics · {{ effectiveTools.length }} tools
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

// Props for external control
interface Props {
  modelValue?: {
    granularity: string
    metrics: string[]
    tools: string[]
    useGlobal: boolean
  }
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => ({
    granularity: 'auto',
    metrics: ['cycle-time', 'change-failure-rate', 'merge-rate', 'deployment-frequency', 'ai-efficiency'],
    tools: ['cursor', 'vscode', 'jetbrains', 'windsurf', 'sublime', 'vim'],
    useGlobal: true
  })
})

// Emits for parent component
const emit = defineEmits<{
  'update:modelValue': [value: {
    granularity: string
    metrics: string[]
    tools: string[]
    useGlobal: boolean
  }]
  'change': [value: {
    granularity: string
    metrics: string[]
    tools: string[]
    useGlobal: boolean
  }]
}>()

// Local state
const localGranularity = ref<'auto' | 'hour' | 'day' | 'week' | 'month' | 'quarter'>(props.modelValue.granularity as any)
const localSelectedMetrics = ref<string[]>([...props.modelValue.metrics])
const localSelectedTools = ref<string[]>([...props.modelValue.tools])
const useGlobalFilters = ref(props.modelValue.useGlobal)

// Available options
const metrics = [
  { id: 'cycle-time', label: 'Cycle Time' },
  { id: 'change-failure-rate', label: 'CFR' },
  { id: 'merge-rate', label: 'Merge Rate' },
  { id: 'deployment-frequency', label: 'Deploy Freq' },
  { id: 'ai-efficiency', label: 'AI Efficiency' }
]

const tools = ['cursor', 'vscode', 'jetbrains', 'windsurf', 'sublime', 'vim']

// Helper functions for chip interactions
function toggleMetric(id: string) {
  if (localSelectedMetrics.value.includes(id)) {
    localSelectedMetrics.value = localSelectedMetrics.value.filter((m) => m !== id)
  } else {
    localSelectedMetrics.value.push(id)
  }
  emitChange()
}

function toggleTool(name: string) {
  if (localSelectedTools.value.includes(name)) {
    localSelectedTools.value = localSelectedTools.value.filter((t) => t !== name)
  } else {
    localSelectedTools.value.push(name)
  }
  emitChange()
}

// Effective values (what the parent component should use)
const effectiveGranularity = computed(() => {
  if (useGlobalFilters.value) {
    return 'week' // Default when using global
  }
  return localGranularity.value === 'auto' ? 'week' : localGranularity.value
})

const effectiveMetrics = computed(() => {
  if (useGlobalFilters.value) {
    return metrics.map(m => m.id) // All metrics when using global
  }
  return localSelectedMetrics.value
})

const effectiveTools = computed(() => {
  if (useGlobalFilters.value) {
    return tools // All tools when using global
  }
  return localSelectedTools.value
})

// Emit changes to parent
function emitChange() {
  const value = {
    granularity: effectiveGranularity.value,
    metrics: effectiveMetrics.value,
    tools: effectiveTools.value,
    useGlobal: useGlobalFilters.value
  }
  emit('update:modelValue', value)
  emit('change', value)
}

// Watch for prop changes
watch(() => props.modelValue, (newValue) => {
  localGranularity.value = newValue.granularity as any
  localSelectedMetrics.value = [...newValue.metrics]
  localSelectedTools.value = [...newValue.tools]
  useGlobalFilters.value = newValue.useGlobal
}, { deep: true })

// Watch for local changes
watch([localGranularity, useGlobalFilters], emitChange)
</script>

