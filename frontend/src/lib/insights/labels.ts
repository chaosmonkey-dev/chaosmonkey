/**
 * Label utilities for insights display
 * 
 * Provides human-readable labels for time windows, teams, developers,
 * and tools using data from the identities store.
 */

import type { ComparisonWindow } from '../../types/insights'

/**
 * Generate human-readable time window label
 * @param fromISO - Start date in ISO format
 * @param toISO - End date in ISO format  
 * @param compare - Comparison window type
 * @returns Friendly time range description
 */
export function windowLabel(fromISO: string, toISO: string, compare: ComparisonWindow): string {
  try {
    const fromDate = new Date(fromISO)
    const toDate = new Date(toISO)
    
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return 'Invalid date range'
    }
    
    // Calculate days difference
    const daysDiff = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24))
    
    // Generate base label
    let baseLabel = ''
    if (daysDiff === 1) {
      baseLabel = 'Last 24 hours'
    } else if (daysDiff === 7) {
      baseLabel = 'Last 7 days'
    } else if (daysDiff === 14) {
      baseLabel = 'Last 14 days'
    } else if (daysDiff === 30) {
      baseLabel = 'Last 30 days'
    } else if (daysDiff === 90) {
      baseLabel = 'Last 90 days'
    } else {
      baseLabel = `${daysDiff} days`
    }
    
    // Add comparison context
    const comparisonLabels = {
      'dod': 'Day over Day',
      'wow': 'Week over Week', 
      'mom': 'Month over Month',
      'qoq': 'Quarter over Quarter',
      'all': 'All Time'
    }
    
    const comparisonLabel = comparisonLabels[compare] || 'Unknown'
    
    return `${baseLabel} (${comparisonLabel})`
  } catch (error) {
    console.error('Error generating window label:', error)
    return 'Unknown time range'
  }
}

/**
 * Get friendly team name using identities store
 * @param teamId - Team identifier
 * @param identitiesStore - Optional identities store instance
 * @returns Friendly team name or fallback
 */
export function getTeamLabel(teamId: string, identitiesStore?: any): string {
  if (!teamId) return 'Unknown Team'
  
  // Try to get friendly name from identities store
  if (identitiesStore?.teams) {
    const team = identitiesStore.teams.find((t: any) => t.id === teamId)
    if (team?.name) {
      return team.name
    }
  }
  
  // Fallback to formatted team ID
  return teamId
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Get friendly developer name using identities store
 * @param devId - Developer identifier
 * @param identitiesStore - Optional identities store instance
 * @returns Friendly developer name or fallback
 */
export function getDeveloperLabel(devId: string, identitiesStore?: any): string {
  if (!devId) return 'Unknown Developer'
  
  // Try to get friendly name from identities store
  if (identitiesStore?.developers) {
    const dev = identitiesStore.developers.find((d: any) => d.id === devId)
    if (dev?.name) {
      return dev.name
    }
  }
  
  // Fallback to formatted dev ID
  return devId
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Get friendly tool name
 * @param toolId - Tool identifier
 * @returns Friendly tool name
 */
export function getToolLabel(toolId: string): string {
  if (!toolId) return 'Unknown Tool'
  
  const toolLabels: Record<string, string> = {
    'cursor': 'Cursor',
    'windsurf': 'Devin',  // Display as Devin (Windsurf and Devin are same for product presentation)
    'vscode': 'VS Code',
    'jetbrains': 'JetBrains IDEs',
    'sublime': 'Sublime Text',
    'vim': 'Vim/Neovim'
  }
  
  return toolLabels[toolId] || toolId
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Get friendly metric name
 * @param metricId - Metric identifier
 * @returns Friendly metric name
 */
export function getMetricLabel(metricId: string): string {
  if (!metricId) return 'Unknown Metric'
  
  const metricLabels: Record<string, string> = {
    // GitHub metrics
    'time_to_merge_hours': 'Time to Merge',
    'pr_merge_rate_percent': 'PR Merge Rate',
    'review_comments_per_pr': 'Review Comments per PR',
    'commits_per_day': 'Commits per Day',
    'issues_per_day': 'Issues per Day',
    
    // Productivity metrics
    'ide.ai_suggestions_accepted': 'AI Suggestions Accepted',
    'ide.files_edited_per_session': 'Files per Session',
    'ide.commits_per_session': 'Commits per Session',
    'ide.average_session_length_minutes': 'Average Session Length',
    'ide.time_to_first_commit_minutes': 'Time to First Commit',
    'ide.AI_usage_duration_minutes': 'AI Usage Duration',
    'ide.idle_time_minutes': 'Idle Time'
  }
  
  return metricLabels[metricId] || metricId
    .split('.')
    .pop()
    ?.split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || 'Unknown Metric'
}






