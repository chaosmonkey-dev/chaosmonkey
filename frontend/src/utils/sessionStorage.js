// Session Storage Utility for CodeSight Dashboard
// Handles persistent storage of GitHub connection state and user preferences

class SessionManager {
  constructor() {
    this.storagePrefix = 'codesight_'
    this.keys = {
      GITHUB_SETUP: 'github_setup',
      GITHUB_CONNECTION: 'github_connection', 
      USER_PREFERENCES: 'user_preferences',
      NGROK_URL: 'ngrok_url',
      LAST_CONNECTION: 'last_connection',
      IDE_CONNECTIONS: 'ide_connections'
    }
  }

  // Generic storage methods
  set(key, value) {
    try {
      window.localStorage.setItem(this.storagePrefix + key, JSON.stringify(value))
      return true
    } catch (e) {
      // console.warn('Failed to set localStorage', key, e)
      return false
    }
  }

  get(key, defaultValue = null) {
    try {
      const item = window.localStorage.getItem(this.storagePrefix + key)
      if (item === null) return defaultValue
      return JSON.parse(item)
    } catch (e) {
      // console.warn('Failed to get localStorage', key, e)
      return defaultValue
    }
  }

  remove(key) {
    try {
      window.localStorage.removeItem(this.storagePrefix + key)
      return true
    } catch (e) {
      // console.warn('Failed to remove localStorage', key, e)
      return false
    }
  }

  clear() {
    // Only clear keys with our prefix
    Object.keys(window.localStorage).forEach(key => {
      if (key.startsWith(this.storagePrefix)) {
        window.localStorage.removeItem(key)
      }
    })
  }

  // GitHub-specific methods
  saveGithubSetup(setup) {
    const githubData = {
      ngrok_status: setup.ngrok_status,
      ngrok_url: setup.ngrok_url,
      webhook_url: setup.webhook_url,
      lastUpdated: Date.now()
    }
    return this.set(this.keys.GITHUB_SETUP, githubData)
  }

  getGithubSetup() {
    return this.get(this.keys.GITHUB_SETUP, {
      ngrok_status: 'inactive',
      ngrok_url: null,
      webhook_url: null,
      lastUpdated: null
    })
  }

  saveConnectionState(isConnected, message = '') {
    const connectionData = {
      connected: isConnected,
      message,
      timestamp: Date.now()
    }
    return this.set(this.keys.GITHUB_CONNECTION, connectionData)
  }

  getConnectionState() {
    return this.get(this.keys.GITHUB_CONNECTION, {
      connected: false,
      message: '',
      timestamp: null
    })
  }

  clearConnectionState() {
    return this.remove(this.keys.GITHUB_CONNECTION)
  }

  // User preferences methods
  saveUserPreferences(preferences) {
    const current = this.getUserPreferences()
    const updated = { ...current, ...preferences }
    return this.set(this.keys.USER_PREFERENCES, updated)
  }

  getUserPreferences() {
    return this.get(this.keys.USER_PREFERENCES, {
      selectedDeveloper: '',
      selectedRepo: '',
      showGithubSetup: false,
      lastActiveTab: 'dashboard'
    })
  }

  saveNgrokUrl(url) {
    return this.set(this.keys.NGROK_URL, {
      url,
      savedAt: Date.now()
    })
  }

  getNgrokUrl() {
    const data = this.get(this.keys.NGROK_URL)
    return data ? data.url : null
  }

  // Check if stored data is recent (within last hour)
  isDataFresh(key, maxAgeMinutes = 60) {
    const data = this.get(key)
    if (!data || !data.timestamp) return false
    
    const age = (Date.now() - data.timestamp) / (1000 * 60) // age in minutes
    return age <= maxAgeMinutes
  }

  // Store last successful connection details
  saveLastConnection() {
    return this.set(this.keys.LAST_CONNECTION, {
      timestamp: Date.now(),
      url: window.location.href
    })
  }

  getLastConnection() {
    return this.get(this.keys.LAST_CONNECTION)
  }

  // IDE Connection Management
  saveIDEConnection(ideId, connectionData) {
    const connections = this.getIDEConnections()
    connections[ideId] = {
      ...connectionData,
      savedAt: Date.now()
    }
    return this.set(this.keys.IDE_CONNECTIONS, connections)
  }

  getIDEConnection(ideId) {
    const connections = this.getIDEConnections()
    return connections[ideId] || null
  }

  getIDEConnections() {
    return this.get(this.keys.IDE_CONNECTIONS, {})
  }

  removeIDEConnection(ideId) {
    const connections = this.getIDEConnections()
    delete connections[ideId]
    return this.set(this.keys.IDE_CONNECTIONS, connections)
  }

  // Get session summary for debugging
  getSessionSummary() {
    return {
      githubSetup: this.getGithubSetup(),
      connectionState: this.getConnectionState(),
      userPreferences: this.getUserPreferences(),
      ngrokUrl: this.getNgrokUrl(),
      lastConnection: this.getLastConnection(),
      ideConnections: this.getIDEConnections()
    }
  }
}

// Export singleton instance
export const sessionManager = new SessionManager()

// Export helper functions for easier usage
export const saveGithubSetup = (setup) => sessionManager.saveGithubSetup(setup)
export const getGithubSetup = () => sessionManager.getGithubSetup()
export const saveConnectionState = (connected, message) => sessionManager.saveConnectionState(connected, message)
export const getConnectionState = () => sessionManager.getConnectionState()
export const clearConnectionState = () => sessionManager.clearConnectionState()
export const saveUserPreferences = (prefs) => sessionManager.saveUserPreferences(prefs)
export const getUserPreferences = () => sessionManager.getUserPreferences()
export const saveNgrokUrl = (url) => sessionManager.saveNgrokUrl(url)
export const getNgrokUrl = () => sessionManager.getNgrokUrl()
export const clearSession = () => sessionManager.clear() 