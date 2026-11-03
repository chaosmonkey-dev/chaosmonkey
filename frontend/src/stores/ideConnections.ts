import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useIDEConnectionsStore = defineStore('ideConnections', () => {
  // IDE connections state will be moved here later
  const connections = ref({})
  const loading = ref(false)

  return {
    connections,
    loading
  }
})
