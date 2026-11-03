import type { TimeSeries, SeriesPoint, ProductivityQuery } from '../../types/metrics'
import { CANONICAL_REAL_WORKFLOWS } from '../workflowIdentity'

/**
 * Deterministic hash function for seeding PRNG
 * @param str - String to hash
 * @returns Numeric hash value
 */
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash)
}

/**
 * Seeded random number generator for deterministic simulation
 * @param seed - Seed value
 * @returns Function that generates random numbers
 */
function createSeededRandom(seed: number) {
  let currentSeed = seed
  
  return function(min: number = 0, max: number = 1): number {
    // Simple but effective seeded random
    currentSeed = (currentSeed * 9301 + 49297) % 233280
    const random = currentSeed / 233280
    return min + random * (max - min)
  }
}

/**
 * Generate time buckets based on query parameters
 * @param query - Productivity query with date range and view bucket
 * @returns Array of ISO timestamp strings
 */
function generateTimeBuckets(query: ProductivityQuery): string[] {
  const { from, to, viewBucket } = query
  
  try {
    // CRITICAL: Use UTC timezone consistently to avoid timezone interpretation issues
    // Force UTC by appending T00:00:00.000Z to YYYY-MM-DD strings
    const startDate = new Date(from.includes('T') ? from : from + 'T00:00:00.000Z')
    const endDate = new Date(to.includes('T') ? to : to + 'T23:59:59.999Z')  // End of day, inclusive
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error('[generateTimeBuckets] Invalid date range:', { from, to })
      throw new Error('Invalid date range')
    }
    
    const buckets: string[] = []
    const currentDate = new Date(startDate)
    
    // Ensure we're working with UTC midnight for consistent bucketing
    currentDate.setUTCHours(0, 0, 0, 0)
    
    // Use date-only comparison to ensure we include the end date
    const endDateOnly = new Date(endDate)
    endDateOnly.setUTCHours(0, 0, 0, 0)
    
    while (currentDate <= endDateOnly) {
      buckets.push(currentDate.toISOString())
      
      // Increment based on view bucket
      switch (viewBucket) {
        case 'daily':
          currentDate.setUTCDate(currentDate.getUTCDate() + 1)
          break
        case 'weekly':
          // CRITICAL FIX: Was currentDate.setDate(currentDate.setDate() + 7) - double setDate bug!
          currentDate.setUTCDate(currentDate.getUTCDate() + 7)
          break
        case 'monthly':
          currentDate.setUTCMonth(currentDate.getUTCMonth() + 1)
          break
      }
    }
    
    console.debug('[simulateProductivityTS] Generated time buckets', {
      from,
      to,
      viewBucket,
      bucketCount: buckets.length,
      firstBucket: buckets[0],
      lastBucket: buckets[buckets.length - 1],
      allBuckets: buckets.map(b => b.slice(0, 10)), // Show dates only
      endDateUsed: endDateOnly.toISOString(),
      includesToday: buckets.some(b => b.startsWith(to))
    })
    
    return buckets
  } catch (error) {
    console.error('Error generating time buckets:', error)
    // Fallback to daily buckets for last 14 days
    const fallbackBuckets: string[] = []
    const now = new Date()
    for (let i = 13; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      fallbackBuckets.push(date.toISOString())
    }
    return fallbackBuckets
  }
}

/**
 * Apply weekend dampening to productivity values
 * @param date - Date to check
 * @param value - Base productivity value
 * @returns Dampened value for weekends
 */
function applyWeekendDampening(date: Date, value: number): number {
  const dayOfWeek = date.getDay()
  // Saturday (6) or Sunday (0) get 0.2x multiplier
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return value * 0.2
  }
  return value
}

/**
 * Apply sprint pulse pattern (14-day cycle with peak productivity)
 * @param date - Date to check
 * @param value - Base productivity value
 * @returns Value with sprint pulse applied
 */
function applySprintPulse(date: Date, value: number): number {
  // Calculate days since epoch to create 14-day cycles
  const daysSinceEpoch = Math.floor(date.getTime() / (24 * 60 * 60 * 1000))
  const dayInCycle = daysSinceEpoch % 14
  
  // Last 3 days of 14-day cycle get 1.3x boost
  if (dayInCycle >= 11 && dayInCycle <= 13) {
    return value * 1.3
  }
  
  return value
}

/**
 * Apply scope scaling (org > team > dev)
 * @param scope - Scope level
 * @param value - Base productivity value
 * @returns Scaled value based on scope
 */
function applyScopeScaling(scope: 'org' | 'team' | 'dev', value: number): number {
  switch (scope) {
    case 'org':
      return value * 1.0 // Base level
    case 'team':
      return value * 0.8 // Team level is 80% of org
    case 'dev':
      return value * 0.6 // Dev level is 60% of org
    default:
      return value
  }
}

/**
 * Generate realistic productivity metrics with sensible ranges
 * @param metricType - Type of metric to generate
 * @param baseValue - Base value for the metric
 * @param random - Seeded random function
 * @returns Realistic metric value
 */
function generateMetricValue(metricType: string, baseValue: number, random: (min: number, max: number) => number): number {
  // Define sensible ranges for different metric types
  const ranges: Record<string, { min: number; max: number; unit: number }> = {
    commits: { min: 0, max: 50, unit: 1 },
    prs_merged: { min: 0, max: 20, unit: 1 },
    ai_suggestions: { min: 5, max: 100, unit: 1 },
    review_comments: { min: 0, max: 30, unit: 1 },
    deployment_frequency: { min: 0, max: 5, unit: 1 },
    lead_time: { min: 2, max: 72, unit: 1 }, // hours
    change_failure_rate: { min: 0, max: 25, unit: 0.1 } // percentage
  }
  
  const range = ranges[metricType] || { min: 0, max: 100, unit: 1 }
  
  // Apply mild noise (±10-15%)
  const noise = 1 + random(-0.15, 0.15)
  let value = baseValue * noise
  
  // Clamp to sensible range
  value = Math.max(range.min, Math.min(range.max, value))
  
  // Round to appropriate unit
  return Math.round(value / range.unit) * range.unit
}

/**
 * Simulate productivity time series data
 * @param query - Productivity query parameters
 * @returns Simulated time series and totals
 */
export function simulateProductivityTS(query: ProductivityQuery): { 
  series: Array<{ label: string; points: Array<{ t: string; v: number }> }>; 
  dataSource: 'Simulated'
} {
  try {
    // Runtime guard: validate query
    if (!query || typeof query !== 'object') {
      throw new Error('Invalid query parameter')
    }
    
    const { from, to, repos, scope, viewBucket, developerIds, teamIds, toolIds, metricId, metricIds } = query

    // Defensive guard for undefined arrays
    if (!Array.isArray(repos)) {
      return {
        series: [],
        dataSource: 'Simulated'
      }
    }

    // Determine which metrics to simulate
    const metricsToSimulate = metricIds && Array.isArray(metricIds) && metricIds.length > 0 ? metricIds : [metricId || 'ide.ai_suggestions_accepted']

    // Create deterministic seed from query parameters
    const seedString = `${from}_${to}_${scope}_${viewBucket}_${repos.length}_${developerIds?.length || 0}_${teamIds?.length || 0}_${toolIds?.length || 0}_${metricsToSimulate.join('_')}`
    const seed = hashString(seedString)
    const random = createSeededRandom(seed)
    
    // Generate time buckets
    const timeBuckets = generateTimeBuckets(query)
    
    // Use the first metric for now (we'll enhance this later)
    const selectedMetric = metricsToSimulate[0]
    
    // Calculate time range multiplier to make different periods show different absolute values
    const startDate = new Date(from)
    const endDate = new Date(to)
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    const timeRangeMultiplier = Math.round(daysDiff / 7) // 7 days = 1x, 30 days = 4x
    
    // Generate series for each tool/IDE
    // 🔥 P0: Use canonical workflow universe constant as fallback
    const tools = toolIds && toolIds.length > 0 ? toolIds : [...CANONICAL_REAL_WORKFLOWS]
    const series: Array<{ label: string; points: Array<{ t: string; v: number }> }> = []
    
    // Apply team filtering - if specific teams are selected, modify performance
    let teamModifier = 1.0
    if (teamIds && teamIds.length > 0) {
      // Create team-specific modifiers
      const teamModifiers: Record<string, number> = {
        'team-a': 1.2,
        'team-b': 1.1,
        'frontend': 1.2,
        'backend': 1.1,
        'devops': 0.9,
        'qa': 0.8,
        'mobile': 1.15
      }
      // If specific teams are selected, average their modifiers
      const modifiers = teamIds.map(teamId => teamModifiers[teamId] || 1.0)
      teamModifier = modifiers.reduce((sum, mod) => sum + mod, 0) / modifiers.length
    }
    
    // Apply developer filtering - if specific developers are selected, modify performance
    let developerModifier = 1.0
    if (developerIds && developerIds.length > 0) {
      // Create developer-specific modifiers
      const developerModifiers: Record<string, number> = {
        'dev-a': 1.3,
        'dev-b': 1.1,
        'dev-c': 0.9,
        'dev-d': 1.2,
        'alice': 1.3,
        'bob': 1.1,
        'charlie': 0.9,
        'diana': 1.2,
        'eve': 0.8,
        'frank': 1.0
      }
      // If specific developers are selected, average their modifiers
      const modifiers = developerIds.map(devId => developerModifiers[devId] || 1.0)
      developerModifier = modifiers.reduce((sum, mod) => sum + mod, 0) / modifiers.length
    }
    
    // Define metric-specific tool performance profiles with realistic variance
    const metricProfiles: Record<string, Record<string, { base: number; variance: number; range: [number, number] }>> = {
      'ide.ai_suggestions_accepted': {
        cursor: { base: 45, variance: 0.3, range: [35, 55] },
        windsurf: { base: 40, variance: 0.3, range: [30, 50] },
        vscode: { base: 25, variance: 0.3, range: [18, 32] },
        claude_code: { base: 50, variance: 0.3, range: [40, 60] },
        github_copilot: { base: 30, variance: 0.3, range: [22, 38] },
        jetbrains: { base: 20, variance: 0.3, range: [15, 25] },
        sublime: { base: 15, variance: 0.3, range: [10, 20] },
        vim: { base: 12, variance: 0.3, range: [8, 16] }
      },
      'ide.files_edited_per_session': {
        cursor: { base: 12, variance: 0.3, range: [9, 15] },
        windsurf: { base: 11, variance: 0.3, range: [8, 14] },
        vscode: { base: 8, variance: 0.3, range: [6, 10] },
        claude_code: { base: 13, variance: 0.3, range: [10, 16] },
        github_copilot: { base: 9, variance: 0.3, range: [7, 11] },
        jetbrains: { base: 7, variance: 0.3, range: [5, 9] },
        sublime: { base: 6, variance: 0.3, range: [4, 8] },
        vim: { base: 5, variance: 0.3, range: [3, 7] }
      },
      'ide.commits_per_session': {
        cursor: { base: 3.5, variance: 0.3, range: [2.5, 4.5] },
        windsurf: { base: 3.2, variance: 0.3, range: [2.2, 4.2] },
        vscode: { base: 2.8, variance: 0.3, range: [2.0, 3.6] },
        claude_code: { base: 3.8, variance: 0.3, range: [2.8, 4.8] },
        github_copilot: { base: 3.0, variance: 0.3, range: [2.2, 3.8] },
        jetbrains: { base: 2.5, variance: 0.3, range: [1.8, 3.2] },
        sublime: { base: 2.2, variance: 0.3, range: [1.5, 2.9] },
        vim: { base: 2.0, variance: 0.3, range: [1.4, 2.6] }
      },
      'ide.average_session_length_minutes': {
        cursor: { base: 180, variance: 0.3, range: [140, 220] },
        windsurf: { base: 170, variance: 0.3, range: [130, 210] },
        vscode: { base: 150, variance: 0.3, range: [115, 185] },
        claude_code: { base: 190, variance: 0.3, range: [150, 230] },
        github_copilot: { base: 160, variance: 0.3, range: [125, 195] },
        jetbrains: { base: 140, variance: 0.3, range: [105, 175] },
        sublime: { base: 120, variance: 0.3, range: [90, 150] },
        vim: { base: 110, variance: 0.3, range: [80, 140] }
      },
      'ide.time_to_first_commit_minutes': {
        cursor: { base: 15, variance: 0.3, range: [10, 20] },
        windsurf: { base: 18, variance: 0.3, range: [12, 24] },
        vscode: { base: 25, variance: 0.3, range: [18, 32] },
        claude_code: { base: 12, variance: 0.3, range: [8, 16] },
        github_copilot: { base: 20, variance: 0.3, range: [15, 25] },
        jetbrains: { base: 28, variance: 0.3, range: [20, 36] },
        sublime: { base: 35, variance: 0.3, range: [25, 45] },
        vim: { base: 40, variance: 0.3, range: [28, 52] }
      },
      'ide.AI_usage_duration_minutes': {
        cursor: { base: 120, variance: 0.3, range: [90, 150] },
        windsurf: { base: 110, variance: 0.3, range: [80, 140] },
        vscode: { base: 60, variance: 0.3, range: [45, 75] },
        claude_code: { base: 130, variance: 0.3, range: [100, 160] },
        github_copilot: { base: 70, variance: 0.3, range: [50, 90] },
        jetbrains: { base: 50, variance: 0.3, range: [35, 65] },
        sublime: { base: 20, variance: 0.3, range: [15, 25] },
        vim: { base: 15, variance: 0.3, range: [10, 20] }
      },
      'ide.idle_time_minutes': {
        cursor: { base: 12, variance: 0.4, range: [8, 20] },
        windsurf: { base: 15, variance: 0.4, range: [10, 25] },
        vscode: { base: 18, variance: 0.3, range: [12, 28] },
        claude_code: { base: 10, variance: 0.4, range: [7, 18] },
        github_copilot: { base: 14, variance: 0.3, range: [10, 22] },
        jetbrains: { base: 22, variance: 0.3, range: [15, 35] },
        sublime: { base: 25, variance: 0.3, range: [18, 40] },
        vim: { base: 28, variance: 0.25, range: [20, 45] }
      }
    }
    
    tools.forEach((tool, toolIndex) => {
      // Pre-calculate all points for this tool to enable trend continuity
      const points: Array<{ t: string; v: number }> = []
      
      timeBuckets.forEach((timestamp, index) => {
        const date = new Date(timestamp)
        
        // Get metric-specific profile for this tool
        const profile = metricProfiles[selectedMetric]?.[tool] || {
          base: 50,
          variance: 0.2,
          range: [20, 80]
        }
        
        let baseValue = profile.base
        
        // Apply time range scaling first
        baseValue = baseValue * timeRangeMultiplier
          
          // Apply weekend dampening
        baseValue = applyWeekendDampening(date, baseValue)
          
          // Apply sprint pulse
        baseValue = applySprintPulse(date, baseValue)
        
        // Apply scope scaling
        baseValue = applyScopeScaling(scope, baseValue)
        
        // Apply team modifier
        baseValue = baseValue * teamModifier
        
        // Apply developer modifier
        baseValue = baseValue * developerModifier
        
        // Add realistic trend continuity with momentum - each point should be close to the previous one
        let finalValue
        let lastStep = 0 // Track momentum for continuity
        
        if (index === 0) {
          // First point: use scaled base value with some randomness
          const randomFactor = 1 + random(-profile.variance * 0.5, profile.variance * 0.5)
          finalValue = baseValue * randomFactor
        } else {
          // Subsequent points: build on previous value with momentum
          const previousValue = points[index - 1].v
          
          // Generate step change with momentum: curr = prev * (1 + step)
          // step = clamp(randn()*0.06 + lastStep*0.35, -0.14, 0.14)
          const randn = () => (random() - 0.5) * 2 // Normal distribution approximation
          const step = Math.max(-0.14, Math.min(0.14, randn() * 0.06 + lastStep * 0.35))
          lastStep = step
          
          finalValue = previousValue * (1 + step)
          
          // Add small random variation
          const randomFactor = 1 + random(-profile.variance * 0.1, profile.variance * 0.1)
          finalValue = finalValue * randomFactor
          
          // Ensure minimum trend variation to avoid 0% changes
          const minChangePercent = 0.05 // Minimum 5% change
          const minChange = previousValue * minChangePercent
          const actualChange = Math.abs(finalValue - previousValue)
          
          if (actualChange < minChange) {
            // Force a minimum change in a random direction
            const direction = random(-1, 1) > 0 ? 1 : -1
            finalValue = previousValue + (direction * minChange)
          }
          
          // Double-check: ensure we never have exactly the same value
          if (finalValue === previousValue) {
            const direction = random(-1, 1) > 0 ? 1 : -1
            finalValue = previousValue + (direction * Math.max(minChange, 1))
          }
        }
        
        // Clamp to metric-specific range (scaled by time range)
        const scaledRange = [profile.range[0] * timeRangeMultiplier, profile.range[1] * timeRangeMultiplier]
        finalValue = Math.max(scaledRange[0], Math.min(scaledRange[1], finalValue))
        
        // Round to appropriate precision based on metric type
        if (selectedMetric.includes('minutes')) {
          finalValue = Math.round(finalValue)
        } else if (selectedMetric.includes('commits') || selectedMetric.includes('files')) {
          finalValue = Math.round(finalValue * 10) / 10 // 1 decimal place
        } else {
          finalValue = Math.round(finalValue)
        }
        
        // Final check: ensure no 0% change after rounding
        if (index > 0) {
          const previousValue = points[index - 1].v
          const changePercent = Math.abs((finalValue - previousValue) / previousValue) * 100
          
          // If change is within ±2% of baseline, nudge by ±4%
          if (changePercent < 2) {
            const direction = random(-1, 1) > 0 ? 1 : -1
            const nudgeAmount = previousValue * 0.04 // 4% nudge
            finalValue = previousValue + (direction * nudgeAmount)
          }
          
          // Ensure we never have exactly the same value
          if (finalValue === previousValue) {
            const direction = random(-1, 1) > 0 ? 1 : -1
            finalValue = previousValue + (direction * Math.max(previousValue * 0.01, 1))
          }
        }
        
        // CRITICAL: Normalize bucket key to YYYY-MM-DD format for daily buckets
        // This ensures simulation buckets match telemetry bucket keys exactly
        const bucketKey = viewBucket === 'daily' 
          ? timestamp.split('T')[0] + 'T00:00:00.000Z' // Normalize to midnight UTC
          : timestamp
        
        points.push({
          t: bucketKey,
          v: finalValue
        })
      })
      
      const toolSeries = {
        label: tool,
        points: points
      }
      
      series.push(toolSeries)
    })
    
    return { series, dataSource: 'Simulated' }
  } catch (error) {
    console.error('Error in simulateProductivityTS:', error)
    
    // Return fallback data
    const fallbackSeries: Array<{ label: string; points: Array<{ t: string; v: number }> }> = [
      {
        label: 'cursor',
        points: [
          { t: new Date().toISOString(), v: 50 }
        ]
      }
    ]
    
    return { series: fallbackSeries, dataSource: 'Simulated' }
  }
}