import { ref, computed, nextTick, onUnmounted, type Ref } from 'vue'
import { Chart, type ChartOptions, type ChartData, type ChartConfiguration } from 'chart.js'

/**
 * Chart.js lifecycle management composable
 * Prevents chart blanking and double-initialization on filter changes
 * @param elRef - Reference to canvas element
 * @param baseOptions - Base chart configuration options
 * @param initialData - Initial chart data
 * @returns Chart management functions
 */
export function useChartJs(
  elRef: Ref<HTMLCanvasElement | null>,
  baseOptions: ChartOptions,
  initialData: ChartData
) {
  // Chart instance reference
  const chartInstance = ref<Chart | null>(null)
  
  // Runtime guard: validate chart data structure
  const validateChartData = (data: ChartData): ChartData => {
    if (!data || typeof data !== 'object') {
      console.error('Invalid chart data provided')
      return { labels: [], datasets: [] }
    }
    
    // Ensure labels array exists
    if (!Array.isArray(data.labels)) {
      console.warn('Chart data missing labels array, using empty array')
      data.labels = []
    }
    
    // Ensure datasets array exists
    if (!Array.isArray(data.datasets)) {
      console.warn('Chart data missing datasets array, using empty array')
      data.datasets = []
    }
    
    // Validate and align dataset lengths with labels
    const labelsLength = data.labels.length
    const validatedDatasets = data.datasets.map((dataset, index) => {
      if (!dataset || typeof dataset !== 'object') {
        console.warn(`Invalid dataset at index ${index}, skipping`)
        return null
      }
      
      // Ensure data array exists
      if (!Array.isArray(dataset.data)) {
        console.warn(`Dataset ${index} missing data array, using empty array`)
        dataset.data = []
      }
      
      const dataLength = dataset.data.length
      
      // Align dataset length with labels length
      if (dataLength !== labelsLength) {
        console.warn(
          `Dataset ${index} length (${dataLength}) doesn't match labels length (${labelsLength}), aligning...`
        )
        
        if (dataLength > labelsLength) {
          // Truncate dataset data
          dataset.data = dataset.data.slice(0, labelsLength)
        } else if (dataLength < labelsLength) {
          // Zero-fill dataset data
          const padding = new Array(labelsLength - dataLength).fill(0)
          dataset.data = [...dataset.data, ...padding]
        }
      }
      
      return dataset
    }).filter(Boolean) // Remove null datasets
    
    // Ensure we have at least one valid dataset
    if (validatedDatasets.length === 0) {
      console.warn('No valid datasets found, creating empty dataset')
      validatedDatasets.push({
        label: 'No Data',
        data: new Array(labelsLength).fill(0),
        borderColor: '#6c757d',
        backgroundColor: 'rgba(108, 117, 125, 0.1)',
        fill: false
      })
    }
    
    return {
      labels: data.labels,
      datasets: validatedDatasets
    }
  }
  
  // Runtime guard: validate chart options
  const validateChartOptions = (options: ChartOptions): ChartOptions => {
    if (!options || typeof options !== 'object') {
      console.error('Invalid chart options provided')
      return {}
    }
    
    // Create safe copy of options
    const safeOptions = { ...options }
    
    // Ensure critical performance options are set
    safeOptions.animation = false
    safeOptions.parsing = false
    safeOptions.normalized = true
    
    // Ensure responsive and maintainAspectRatio are set for proper sizing
    if (safeOptions.responsive === undefined) {
      safeOptions.responsive = true
    }
    
    if (safeOptions.maintainAspectRatio === undefined) {
      safeOptions.maintainAspectRatio = false
    }
    
    // Ensure plugins configuration exists
    if (!safeOptions.plugins) {
      safeOptions.plugins = {}
    }
    
    // Ensure legend configuration
    if (!safeOptions.plugins.legend) {
      safeOptions.plugins.legend = {
        display: true,
        position: 'top'
      }
    }
    
    // Ensure tooltip configuration
    if (!safeOptions.plugins.tooltip) {
      safeOptions.plugins.tooltip = {
        enabled: true,
        mode: 'index',
        intersect: false
      }
    }
    
    return safeOptions
  }
  
  // Runtime guard: validate canvas element
  const validateCanvasElement = (): boolean => {
    if (!elRef.value) {
      console.error('Canvas element reference is null')
      return false
    }
    
    if (!(elRef.value instanceof HTMLCanvasElement)) {
      console.error('Element reference is not a canvas element')
      return false
    }
    
    return true
  }
  
  /**
   * Update chart with new data
   * Safely destroys existing instance and creates new one
   * @param data - New chart data
   */
  const update = async (data: ChartData): Promise<void> => {
    try {
      // Runtime guard: validate canvas element
      if (!validateCanvasElement()) {
        return
      }
      
      // Runtime guard: validate and align chart data
      const validatedData = validateChartData(data)
      
      // Runtime guard: validate chart options
      const validatedOptions = validateChartOptions(baseOptions)
      
      // Destroy existing chart instance if it exists
      if (chartInstance.value) {
        try {
          chartInstance.value.destroy()
          chartInstance.value = null
        } catch (destroyError) {
          console.warn('Error destroying existing chart:', destroyError)
        }
      }
      
      // Wait for next tick to ensure DOM is updated
      await nextTick()
      
      // Runtime guard: validate canvas element again after nextTick
      if (!validateCanvasElement()) {
        return
      }
      
      // Create new chart instance
      const ctx = elRef.value!.getContext('2d')
      if (!ctx) {
        console.error('Failed to get 2D context from canvas')
        return
      }
      
      const chartConfig: ChartConfiguration = {
        type: 'line',
        data: validatedData,
        options: validatedOptions
      }
      
      chartInstance.value = new Chart(ctx, chartConfig)
      
      console.log('✅ Chart updated successfully:', {
        labels: validatedData.labels.length,
        datasets: validatedData.datasets.length,
        dataPoints: validatedData.datasets.reduce((sum, ds) => sum + ds.data.length, 0)
      })
      
    } catch (error) {
      console.error('❌ Failed to update chart:', error)
      
      // Clear instance reference on error
      chartInstance.value = null
    }
  }
  
  /**
   * Dispose of chart instance and clean up resources
   */
  const dispose = (): void => {
    try {
      if (chartInstance.value) {
        chartInstance.value.destroy()
        chartInstance.value = null
        console.log('🗑️ Chart disposed successfully')
      }
    } catch (error) {
      console.error('❌ Error disposing chart:', error)
      // Ensure instance is cleared even on error
      chartInstance.value = null
    }
  }
  
  /**
   * Check if chart instance exists
   */
  const hasInstance = (): boolean => {
    return chartInstance.value !== null
  }
  
  /**
   * Get current chart instance (for advanced operations)
   */
  const getInstance = (): Chart | null => {
    return chartInstance.value
  }
  
  /**
   * Force chart resize (useful for container changes)
   */
  const resize = (): void => {
    if (chartInstance.value) {
      try {
        chartInstance.value.resize()
        console.log('📏 Chart resized')
      } catch (error) {
        console.warn('Failed to resize chart:', error)
      }
    }
  }
  
  // Auto-dispose on component unmount
  onUnmounted(() => {
    dispose()
  })
  
  return {
    // Core functions
    update,
    dispose,
    
    // Utility functions
    hasInstance,
    getInstance,
    resize,
    
    // Internal state (for debugging)
    chartInstance: computed(() => chartInstance.value)
  }
}
