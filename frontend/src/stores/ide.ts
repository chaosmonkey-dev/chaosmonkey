import { defineStore } from 'pinia'
import { ref } from 'vue'
import { API_URL } from '../config/api'

export interface IDEStatus {
  connected: boolean
  name?: string
  type?: string
}

export const useIDEStore = defineStore('ide', () => {
  // State
  const status = ref<Record<string, IDEStatus>>({})
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Actions
  const fetchStatus = async () => {
    isLoading.value = true
    error.value = null
    
    try {
      const response = await fetch(`${API_URL}/ide/status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      status.value = data
    } catch (err) {
      console.error('Failed to fetch IDE status:', err)
      error.value = err instanceof Error ? err.message : 'Failed to fetch IDE status'
      
      // For development/testing, show some mock data when the endpoint doesn't exist
      if (err instanceof Error && err.message.includes('404')) {
        status.value = {
          'vscode': { connected: true, name: 'Visual Studio Code', type: 'editor' },
          'intellij': { connected: false, name: 'IntelliJ IDEA', type: 'ide' },
          'vim': { connected: true, name: 'Vim', type: 'editor' },
          'sublime': { connected: false, name: 'Sublime Text', type: 'editor' }
        }
        error.value = null
      }
    } finally {
      isLoading.value = false
    }
  }

  const connectWithTokens = async (key: string, payload: any) => {
    isLoading.value = true
    error.value = null
    
    try {
      const response = await fetch(`${API_URL}/ide/${key}/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      
      // Update local status after successful connection
      if (data.success) {
        await fetchStatus()
      }
      
      return data
    } catch (err) {
      console.error(`Failed to connect IDE ${key}:`, err)
      error.value = err instanceof Error ? err.message : `Failed to connect ${key}`
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const startOauth = async (key: string) => {
    try {
      // This will redirect the user to the OAuth flow
      window.location.href = `${API_URL}/ide/${key}/oauth/start`
    } catch (err) {
      console.error(`Failed to start OAuth for IDE ${key}:`, err)
      error.value = err instanceof Error ? err.message : `Failed to start OAuth for ${key}`
      throw err
    }
  }

  const clearError = () => {
    error.value = null
  }

  const refreshStatus = async () => {
    await fetchStatus()
  }

  const updateIDEStatus = (ideName: string, connected: boolean) => {
    if (status.value[ideName]) {
      status.value[ideName].connected = connected
    } else {
      status.value[ideName] = { connected, name: ideName, type: 'editor' }
    }
  }

  const setIDEStatuses = (statuses: Record<string, IDEStatus>) => {
    status.value = statuses
  }

  return {
    // State
    status,
    isLoading,
    error,
    
    // Actions
    fetchStatus,
    connectWithTokens,
    startOauth,
    clearError,
    refreshStatus,
    updateIDEStatus,
    setIDEStatuses
  }
})
