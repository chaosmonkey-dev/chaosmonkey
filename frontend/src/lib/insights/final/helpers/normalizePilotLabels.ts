/**
 * Normalization function for PI display labels in pilot mode
 * Ensures only real model labels are used in normal/live mode
 */

export type PilotMode = 'live' | 'demo'

/**
 * Normalizes workflow labels for PI display
 * @param raw - Raw workflow identifier (e.g., 'cursor', 'windsurf', 'vscode')
 * @param mode - Current mode ('live' for normal mode, 'demo' for demo mode)
 * @returns Normalized label safe for the current mode
 */
export function normalizePilotWorkflowLabel(raw: string, mode: PilotMode): string {
  const normalizedRaw = raw.toLowerCase()
  
  // Real workflow mappings for both modes
  const realWorkflowMappings: Record<string, string> = {
    'cursor': 'Cursor',
    'windsurf': 'Devin',  // Display as Devin (Windsurf and Devin are same for product presentation)
    'vscode': 'VS Code',
    'claude_code': 'Claude Code',
    'codex': 'Codex',
    'github_copilot': 'GitHub Copilot'
  }
  
  // In live mode, only return real labels or safe generic labels
  if (mode === 'live') {
    return realWorkflowMappings[normalizedRaw] || 'the selected workflow'
  }
  
  // In demo mode, allow more flexibility for demonstration purposes
  return realWorkflowMappings[normalizedRaw] || 'this workflow'
}

/**
 * Normalizes model labels for PI display
 * @param raw - Raw model identifier
 * @param mode - Current mode
 * @returns Normalized model label safe for the current mode
 */
export function normalizePilotModelLabel(raw: string, mode: PilotMode): string {
  const normalizedRaw = raw.toLowerCase()
  
  // Workflow/tool mappings (ChaosMonkey collects editor/tool, not active model)
  const workflowMappings: Record<string, string> = {
    'cursor': 'Cursor',
    'windsurf': 'Devin',  // Display as Devin (Windsurf and Devin are same for product presentation)
    'vscode': 'VS Code',
    'claude_code': 'Claude Code',
    'codex': 'Codex',
    'github_copilot': 'GitHub Copilot'
  }
  
  // In live mode, return workflow/tool labels instead of model names
  // since ChaosMonkey only collects editor/tool telemetry, not active model telemetry
  if (mode === 'live') {
    return workflowMappings[normalizedRaw] || 'the selected workflow'
  }
  
  // In demo mode, allow more flexibility for demonstration purposes
  return workflowMappings[normalizedRaw] || 'this workflow'
}

/**
 * Gets the current pilot mode from window context
 * @returns Current mode ('live' or 'demo')
 */
export function getCurrentPilotMode(): PilotMode {
  if (typeof window === 'undefined') return 'live'
  
  const isDemoMode = window.location.search.includes('piStress=1') ||
                   window.location.search.includes('demoMode=1')
  
  return isDemoMode ? 'demo' : 'live'
}

/**
 * Normalizes workflow labels to IDE/tool name only (no model)
 * This is the default for live mode since ChaosMonkey collects editor/tool, not active model
 * @param raw - Raw workflow identifier (e.g., 'cursor', 'windsurf', 'vscode')
 * @param mode - Current mode ('live' for normal mode, 'demo' for demo mode)
 * @returns IDE/tool label only (e.g., 'Cursor', 'Windsurf', 'VS Code')
 */
export function normalizePilotWorkflowOnlyLabel(raw: string, mode: PilotMode): string {
  const normalizedRaw = raw.toLowerCase()
  
  // IDE/tool mappings only (no model names)
  const toolMappings: Record<string, string> = {
    'cursor': 'Cursor',
    'windsurf': 'Devin',  // Display as Devin (Windsurf and Devin are same for product presentation)
    'vscode': 'VS Code',
    'claude_code': 'Claude Code',
    'codex': 'Codex',
    'github_copilot': 'GitHub Copilot'
  }
  
  return toolMappings[normalizedRaw] || 'the selected workflow'
}

/**
 * Convenience function to normalize labels based on current context
 * @param raw - Raw identifier
 * @param type - Type of identifier ('workflow', 'model', or 'workflow-only')
 * @returns Normalized label
 */
export function normalizePilotLabel(raw: string, type: 'workflow' | 'model' | 'workflow-only' = 'workflow'): string {
  const mode = getCurrentPilotMode()
  
  if (type === 'model') {
    return normalizePilotModelLabel(raw, mode)
  }
  
  if (type === 'workflow-only') {
    return normalizePilotWorkflowOnlyLabel(raw, mode)
  }
  
  return normalizePilotWorkflowLabel(raw, mode)
}
