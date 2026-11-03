import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { API_ENDPOINTS, API_URL } from '../config/api'
import { error as logError } from '../utils/logger'

// Types
export type TimeRange = 'week' | 'month' | 'quarter'

export interface IDEMetrics {
  vscode: {
    activeTime: number
    projects: number
    extensions: number
    productivity: number
  }
  cursor: {
    activeTime: number
    projects: number
    extensions: number
    productivity: number
  }
  windsurf: {
    activeTime: number
    projects: number
    extensions: number
    productivity: number
  }
  jetbrains: {
    activeTime: number
    projects: number
    extensions: number
    productivity: number
  }
  sublime: {
    activeTime: number
    projects: number
    extensions: number
    productivity: number
  }
  vim: {
    activeTime: number
    projects: number
    extensions: number
    productivity: number
  }
}

export interface ProductivityTrends {
  daily: Array<{
    date: string
    productivity: number
    activeTime: number
    projects: number
  }>
  weekly: Array<{
    week: string
    productivity: number
    activeTime: number
    projects: number
  }>
  monthly: Array<{
    month: string
    productivity: number
    activeTime: number
    projects: number
  }>
}

export const useMetricsStore = defineStore('metrics', () => {
  // State
  const ideMetrics = ref<IDEMetrics | null>(null)
  const productivityTrends = ref<ProductivityTrends | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Actions
  const fetchIdeMetrics = async (range: TimeRange = 'week') => {
    loading.value = true
    error.value = null
    
    try {
      const response = await api.get(`${API_ENDPOINTS.IDE_STATUS}/metrics?range=${range}`)
      
      if (response.status === 200) {
        ideMetrics.value = response.data
        return response.data
      } else {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
    } catch (err) {
      logError('Failed to fetch IDE metrics:', err)
      error.value = err instanceof Error ? err.message : 'Failed to fetch IDE metrics'
      
      // For development/testing, return mock data when endpoint doesn't exist
      if (err instanceof Error && err.message.includes('404')) {
        const mockData: IDEMetrics = {
          vscode: { activeTime: 120, projects: 5, extensions: 15, productivity: 85 },
          cursor: { activeTime: 90, projects: 3, extensions: 8, productivity: 78 },
          windsurf: { activeTime: 60, projects: 2, extensions: 5, productivity: 72 },
          jetbrains: { activeTime: 180, projects: 8, extensions: 20, productivity: 88 },
          sublime: { activeTime: 45, projects: 2, extensions: 3, productivity: 65 },
          vim: { activeTime: 75, projects: 4, extensions: 2, productivity: 70 }
        }
        ideMetrics.value = mockData
        return mockData
      }
      
      throw err
    } finally {
      loading.value = false
    }
  }

  const fetchProductivityTrends = async (range: TimeRange = 'week') => {
    loading.value = true
    error.value = null
    
    try {
      const response = await api.get(`${API_URL}/productivity/trends?range=${range}`)
      
      if (response.status === 200) {
        productivityTrends.value = response.data
        return response.data
      } else {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
    } catch (err) {
      logError('Failed to fetch productivity trends:', err)
      error.value = err instanceof Error ? err.message : 'Failed to fetch productivity trends'
      
      // For development/testing, return mock data when endpoint doesn't exist
      if (err instanceof Error && err.message.includes('404')) {
        const mockData: ProductivityTrends = {
          daily: [
            { date: '2024-01-15', productivity: 85, activeTime: 120, projects: 5 },
            { date: '2024-01-16', productivity: 78, activeTime: 95, projects: 4 },
            { date: '2024-01-17', productivity: 92, activeTime: 140, projects: 6 }
          ],
          weekly: [
            { week: '2024-W02', productivity: 82, activeTime: 600, projects: 25 },
            { week: '2024-W03', productivity: 88, activeTime: 720, projects: 30 }
          ],
          monthly: [
            { month: '2024-01', productivity: 85, activeTime: 2800, projects: 120 }
          ]
        }
        productivityTrends.value = mockData
        return mockData
      }
      
      throw err
    } finally {
      loading.value = false
    }
  }

  const clearError = () => {
    error.value = null
  }

  return {
    // State
    ideMetrics,
    productivityTrends,
    loading,
    error,
    
    // Actions
    fetchIdeMetrics,
    fetchProductivityTrends,
    clearError
  }
})
