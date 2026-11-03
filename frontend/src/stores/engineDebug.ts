import { ref } from 'vue'

interface EngineFixLog {
  timestamp: string
  ruleId: string
  message: string
  data?: any
}

const engineFixLogs = ref<EngineFixLog[]>([])

export function addEngineFixLog(ruleId: string, message: string, data?: any) {
  engineFixLogs.value.push({
    timestamp: new Date().toLocaleTimeString(),
    ruleId,
    message,
    data
  })
  
  // Keep only last 20 logs
  if (engineFixLogs.value.length > 20) {
    engineFixLogs.value = engineFixLogs.value.slice(-20)
  }
}

export function clearEngineFixLogs() {
  engineFixLogs.value = []
}

export function useEngineDebug() {
  return {
    logs: engineFixLogs,
    addLog: addEngineFixLog,
    clear: clearEngineFixLogs
  }
}
