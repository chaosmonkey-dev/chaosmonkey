import { createPinia } from 'pinia'

export const pinia = createPinia()

// Store modules will be imported and configured here later
export * from './auth'
export * from './metrics'
export * from './ideConnections'
export * from './ide'
export * from './github'
