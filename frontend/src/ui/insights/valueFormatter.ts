/**
 * Shared UI-only value formatter for Performance Insights
 * Ensures consistent formatting of evidence values across Strip, Cards, Expanded, and Chips.
 */

/**
 * Format AI assists/min rate - always 2 decimals with unit
 */
export function formatAssistsPerMin(value: number | string | undefined): string {
  if (value === undefined || value === null) return '--'
  
  const num = (typeof value === 'number')
    ? value
    : (typeof value === 'string' && value.trim() !== '' && isFinite(Number(value)))
      ? Number(value)
      : null
  
  if (num === null || !isFinite(num)) return String(value || '--')
  
  return `${num.toFixed(2)} assists/min`
}

/**
 * Format minutes - <60 => Xm, >=60 => Hh Mm
 */
export function formatMinutes(value: number | string | undefined): string {
  if (value === undefined || value === null) return '--'
  
  const num = (typeof value === 'number')
    ? value
    : (typeof value === 'string' && value.trim() !== '' && isFinite(Number(value)))
      ? Number(value)
      : null
  
  if (num === null || !isFinite(num)) return String(value || '--')
  
  const total = Math.max(0, Math.round(num))
  if (total >= 60) {
    const h = Math.floor(total / 60)
    const m = total % 60
    return `${h}h ${m.toString().padStart(2, '0')}m`
  }
  return `${total}m`
}

/**
 * Format percentage - 1 decimal place for small values (< 10%), whole number for larger
 * Handles both ratio (0-1) and percent (0-100) inputs correctly
 */
export function formatPercentage(value: number | string | undefined, preferDecimals: boolean = false): string {
  if (value === undefined || value === null) return '--'
  
  let num: number | null = null
  let alreadyPercent = false
  
  if (typeof value === 'number') {
    num = value
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.endsWith('%')) {
      num = Number(trimmed.slice(0, -1))
      alreadyPercent = true
    } else {
      num = Number(trimmed)
    }
  }
  
  if (num === null || !isFinite(num)) return String(value || '--')
  
  // DEV WARNING: Check for unreasonable values
  if (num > 200 && !alreadyPercent) {
    console.warn(`[valueFormatter] Suspicious ratio value: ${num} (treating as ratio, converting to %)`)
  }
  if (num > 200) {
    console.warn(`[valueFormatter] Percentage > 200%: ${num}% (clamping for display)`)
    num = Math.min(num, 1000) // Clamp at 1000% for display
  }
  if (num < 0) {
    console.warn(`[valueFormatter] Negative percentage: ${num}% (clamping to 0)`)
    num = 0
  }
  
  // Convert ratio to percentage if needed
  if (!alreadyPercent && num <= 1) {
    num = num * 100
  }
  
  // For CFR and other precision metrics, prefer 1 decimal if preferDecimals or value < 10
  if (preferDecimals || Math.abs(num) < 10) {
    return `${num.toFixed(1)}%`
  }
  
  return `${Math.round(num)}%`
}

/**
 * Format rework ratio specifically - handles ratio (0-1) to percentage conversion with warnings
 */
export function formatReworkRatio(value: number | string | undefined): string {
  if (value === undefined || value === null) return '--'
  
  let num: number | null = null
  
  if (typeof value === 'number') {
    num = value
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.endsWith('%')) {
      num = Number(trimmed.slice(0, -1))
      // If already percent, use as-is (don't convert back to ratio)
      // This prevents double-formatting: 92.0% -> 0.92 -> 92%
      if (num <= 100) {
        return `${num.toFixed(1)}%`
      }
    } else {
      num = Number(trimmed)
    }
  }
  
  if (num === null || !isFinite(num)) return String(value || '--')
  
  // Robust handling: determine if value is ratio or percent
  let reworkPct: number
  if (num <= 1) {
    // Value is a ratio (0-1), convert to percentage
    reworkPct = num * 100
  } else if (num <= 100) {
    // Value is already a percentage (1-100), use as-is
    reworkPct = num
  } else {
    // Value > 100% is suspicious, clamp to reasonable range
    console.warn(`[valueFormatter] Rework ratio > 100%: ${num}% (clamping to 100%)`)
    reworkPct = 100
  }
  
  // Warn if > 100% but still display
  if (reworkPct > 100) {
    console.warn(`[valueFormatter] Rework ratio > 100%: ${reworkPct.toFixed(1)}% (raw ratio: ${num})`)
  }
  
  // Clamp for display but don't hide
  const displayPct = Math.min(reworkPct, 1000)
  
  return `${displayPct.toFixed(1)}%`
}

/**
 * Determine if an evidence item is an AI assists/min rate
 */
export function isAssistsPerMinRate(label: string, metricId?: string, value?: any): boolean {
  const labelLower = String(label || '').toLowerCase()
  const metricLower = String(metricId || '').toLowerCase()
  
  // Explicit label check - MUST check this FIRST before any "min" checks
  if (labelLower.includes('assists/min') || labelLower.includes('ai assists/min') || 
      labelLower.includes('assists per min') || labelLower.includes('assists per minute')) {
    return true
  }
  
  // Metric ID check (for cases where label might not include "assists/min" explicitly)
  if (metricLower.includes('ai') && (metricLower.includes('assists') || metricLower.includes('suggestion') || metricLower.includes('efficiency'))) {
    // Only if it's a rate-like value (typically 0-10 for assists/min, not minutes)
    if (typeof value === 'number' && value >= 0 && value <= 10) {
      // Additional guard: if label explicitly says "minute" or "coding time" without "assists", it's NOT a rate
      if (labelLower.includes('minute') && !labelLower.includes('assists')) {
        return false
      }
      if (labelLower.includes('coding time') || labelLower.includes('session')) {
        return false
      }
      return true
    }
  }
  
  return false
}

/**
 * Determine if an evidence item is a time value in minutes
 */
export function isMinutesValue(label: string, metricId?: string): boolean {
  const labelLower = String(label || '').toLowerCase()
  const metricLower = String(metricId || '').toLowerCase()
  
  // Explicit time/minute indicators
  if (labelLower.includes('minute') || labelLower.includes('min') && !labelLower.includes('assists/min')) {
    return true
  }
  if (labelLower.includes('coding time') || labelLower.includes('session length') || labelLower.includes('session time')) {
    return true
  }
  if (labelLower.includes('coding') && labelLower.includes('period') && !labelLower.includes('assists')) {
    return true
  }
  
  // Metric ID checks
  if (metricLower.includes('coding_time') || metricLower.includes('session_length') || metricLower.includes('active_coding')) {
    return true
  }
  
  return false
}

/**
 * Format evidence value with proper type detection
 */
export function formatEvidenceValueTyped(
  label?: string | null,
  value?: any,
  metricId?: string | null
): string {
  // DEBUG: Log what's being formatted
  console.log('🔧 [FORMATTER] Processing:', {
    label,
    value,
    metricId,
    valueType: typeof value
  });

  // Handle null/undefined values
  if (value === undefined || value === null) return '--'
  
  // PHASE 3: Normalize evidence values to numbers
  const normalizedValue = (() => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const numValue = Number(value);
      if (!isNaN(numValue) && isFinite(numValue)) {
        console.log('🔧 [FORMATTER] Converted string to number:', { original: value, converted: numValue })
        return numValue;
      }
      // DEV WARNING: String that should be numeric but isn't
      if (!isNaN(parseFloat(value)) || value.match(/^\d+\.?\d*$/)) {
        console.warn('🚨 [FORMATTER] DEV WARNING: String value could not be normalized to number:', value);
      }
    }
    return value;
  })();
  
  // Update value reference for the rest of the function
  value = normalizedValue;
  
  const labelLower = String(label || '').toLowerCase()
  
  // STEP 2.2: MetricId-based formatting rules (more reliable than label matching)
  const metricIdLower = String(metricId || '').toLowerCase()
  
  // R3 Review Focus - poor_focus_ratio (0-1) => percentage
  if (metricIdLower === 'org.review_focus_regression') {
    if (labelLower.includes('poor focus') || labelLower.includes('current poor focus') || labelLower.includes('baseline poor focus')) {
      const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
      if (num !== null && isFinite(num)) {
        const percentage = num > 1 ? num : num * 100
        const result = `${percentage.toFixed(1)}%`
        console.log('🔧 [FORMATTER] R3 poor focus result:', result)
        return result
      }
    }
    if (labelLower.includes('change')) {
      const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
      if (num !== null && isFinite(num)) {
        const percentage = num > 1 ? num : num * 100
        const sign = num >= 0 ? '+' : ''
        const result = `Δ ${sign}${percentage.toFixed(1)} pp`
        console.log('🔧 [FORMATTER] R3 change result:', result)
        return result
      }
    }
    if (labelLower.includes('sessions') && labelLower.includes('analyzed')) {
      const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
      if (num !== null && isFinite(num)) {
        const result = `${Math.round(num)} sessions`
        console.log('🔧 [FORMATTER] R3 sessions result:', result)
        return result
      }
    }
  }
  
  // R4 Git Context - median_attempts and resolution time
  if (metricIdLower === 'org.review_git_context') {
    if (labelLower.includes('attempts') || labelLower.includes('median attempts')) {
      const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
      if (num !== null && isFinite(num)) {
        const result = `${num.toFixed(1)} attempts`
        console.log('🔧 [FORMATTER] R4 attempts result:', result)
        return result
      }
    }
    if (labelLower.includes('resolution') && (labelLower.includes('time') || labelLower.includes('median resolution'))) {
      const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
      if (num !== null && isFinite(num)) {
        // Convert ms to seconds if >= 1000
        const seconds = num >= 1000 ? num / 1000 : num
        const result = `${seconds.toFixed(1)}s`
        console.log('🔧 [FORMATTER] R4 resolution result:', result)
        return result
      }
    }
    if (labelLower.includes('unresolved') && labelLower.includes('context')) {
      const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
      if (num !== null && isFinite(num)) {
        const percentage = num > 1 ? num : num * 100
        const result = `${percentage.toFixed(1)}%`
        console.log('🔧 [FORMATTER] R4 unresolved result:', result)
        return result
      }
    }
    if (labelLower.includes('sessions') && labelLower.includes('analyzed')) {
      const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
      if (num !== null && isFinite(num)) {
        const result = `${Math.round(num)} sessions`
        console.log('🔧 [FORMATTER] R4 sessions result:', result)
        return result
      }
    }
  }
  
  // D5 Deploy Efficiency - correlation, cycle time, frequency
  if (metricIdLower === 'org.deploy_time_efficiency') {
    if (labelLower.includes('correlation') && (labelLower.includes('current') || labelLower.includes('baseline'))) {
      const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
      if (num !== null && isFinite(num)) {
        const result = `r=${num.toFixed(2)}`
        console.log('🔧 [FORMATTER] D5 correlation result:', result)
        return result
      }
    }
    if (labelLower.includes('change')) {
      const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
      if (num !== null && isFinite(num)) {
        const sign = num >= 0 ? '+' : ''
        const result = `Δ ${sign}${num.toFixed(2)}`
        console.log('🔧 [FORMATTER] D5 change result:', result)
        return result
      }
    }
    if (labelLower.includes('cycle time') || labelLower.includes('avg cycle time')) {
      const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
      if (num !== null && isFinite(num)) {
        const result = `${num.toFixed(1)}h`
        console.log('🔧 [FORMATTER] D5 cycle time result:', result)
        return result
      }
    }
    if (labelLower.includes('deploy frequency') || labelLower.includes('avg deploy frequency')) {
      const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
      if (num !== null && isFinite(num)) {
        const result = `${num.toFixed(1)}/week`
        console.log('🔧 [FORMATTER] D5 frequency result:', result)
        return result
      }
    }
    if (labelLower.includes('periods') && labelLower.includes('analyzed')) {
      const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
      if (num !== null && isFinite(num)) {
        const result = `${Math.round(num)} periods`
        console.log('🔧 [FORMATTER] D5 periods result:', result)
        return result
      }
    }
  }
  
  // Plan & Code PIs - Add formatting for IDE-specific metrics
  if (metricIdLower === 'rework-rate-by-ide' || metricIdLower === 'commits-per-session-by-ide' || 
      metricIdLower === 'active-coding-time-by-ide' || metricIdLower === 'ai-suggestions-accepted-by-ide' ||
      metricIdLower === 'average-session-length-by-ide' || metricIdLower === 'time-to-first-commit-by-ide' ||
      metricIdLower === 'pr-review-cycles-by-ide') {
    
    // If value is already a formatted string, return as-is
    if (typeof value === 'string') {
      console.log('🔧 [FORMATTER] Using pre-formatted string:', value)
      return value
    }
    
    // IDE names (cursor, windsurf, vscode) should show cycles as count
    if (labelLower === 'cursor' || labelLower === 'windsurf' || labelLower === 'vscode' || labelLower === 'jetbrains') {
      const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
      if (num !== null && isFinite(num)) {
        // For review cycles, show as count, not percentage
        if (metricIdLower === 'pr-review-cycles-by-ide') {
          const result = `${Math.round(num)} cycles`
          console.log('🔧 [FORMATTER] Review cycles result:', result)
          return result
        }
        // For other IDE metrics, show as percentage
        const result = `${num.toFixed(1)}%`
        console.log('🔧 [FORMATTER] Plan & Code IDE result:', result)
        return result
      }
    }
    
    // Sessions should show as count
    if (labelLower === 'sessions') {
      const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
      if (num !== null && isFinite(num)) {
        const result = `${Math.round(num)} sessions`
        console.log('🔧 [FORMATTER] Plan & Code sessions result:', result)
        return result
      }
    }
  }
  
  // Deploy & Operate PIs - Add formatting for org-level metrics
  if (metricIdLower === 'fast-but-unstable-org') {
    if (labelLower === 'org') {
      const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
      if (num !== null && isFinite(num)) {
        const result = `${num.toFixed(1)}%`
        console.log('🔧 [FORMATTER] Fast unstable org result:', result)
        return result
      }
    }
  }
  
  // Check for rework ratio FIRST (before general percentage)
  if (labelLower.includes('rework ratio')) {
    return formatReworkRatio(value)
  }
  
  // Check for AI assists/min (before minutes check)
  if (isAssistsPerMinRate(label, metricId, value)) {
    return formatAssistsPerMin(value)
  }
  
  // Check for minutes (time values)
  if (isMinutesValue(label, metricId)) {
    return formatMinutes(value)
  }
  
  // Hours (cycle time)
  if (labelLower.includes('cycle time') || labelLower.includes('avg cycle time')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      return `${num.toFixed(1)}h`
    }
  }
  
  // Resolution time (git context, typically in seconds or milliseconds)
  if (labelLower.includes('resolution time') || labelLower.includes('median resolution time')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      // If it's in milliseconds (>= 1000), convert to seconds
      if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}s`
      }
      // If it's in seconds (< 1000), show as seconds
      return `${num.toFixed(1)}s`
    }
  }
  
  // Attempts (git context attempts)
  if (labelLower.includes('attempts') || labelLower.includes('median attempts')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      return `${num.toFixed(1)} attempts`
    }
  }
  
  // Frequency (per week)
  if (labelLower.includes('deploy frequency') || labelLower.includes('avg deploy frequency')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      return `${num.toFixed(1)}/week`
    }
  }
  
  // Attempts (git context)
  if (labelLower.includes('attempts') || labelLower.includes('median attempts')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      const result = `${num.toFixed(1)} attempts`
      console.log('🔧 [FORMATTER] Attempts result:', result)
      return result
    }
  }
  
  // PHASE 4: Comprehensive label-driven formatting
  
  // Resolution time (ms to seconds)
  if (labelLower.includes('resolution time') || labelLower.includes('median resolution time')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}s`
      }
      return `${num.toFixed(1)}s`
    }
  }
  
  // Correlation
  if (labelLower.includes('correlation') || labelLower.includes('r)')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      return `r=${num.toFixed(2)}`
    }
  }
  
  // Poor focus and rework (ratio to percentage)
  if (labelLower.includes('poor focus') || labelLower.includes('rework') || labelLower.includes('poor-focus')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      const percentage = num > 1 ? num : num * 100
      return `${percentage.toFixed(1)}%`
    }
  }
  
  // Weeks, sessions, periods
  if (labelLower.includes('weeks') || labelLower.includes('week') || labelLower.includes('sessions') || labelLower.includes('session') || labelLower.includes('periods') || labelLower.includes('period')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      if (labelLower.includes('week')) return `${Math.round(num)} weeks`
      if (labelLower.includes('session')) return `${Math.round(num)} sessions`
      if (labelLower.includes('period')) return `${Math.round(num)} periods`
      return `${Math.round(num)} units`
    }
  }
  
  // Hours (cycle time)
  if (labelLower.includes('cycle time') || labelLower.includes('avg cycle time')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      return `${num.toFixed(1)}h`
    }
  }
  
  // Check for percentage
  if (labelLower.includes('%') || labelLower.includes('percent') || labelLower.includes('pct') || 
      labelLower.includes('cfr') || labelLower.includes('change failure rate') ||
      labelLower.includes('rate') && labelLower.includes('failure')) {
    return formatPercentage(value, false) // preferDecimalsForPercent = false for now
  }
  
  // Correlation coefficient
  if (labelLower.includes('correlation') || labelLower.includes('r)')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      return `r=${num.toFixed(2)}`
    }
  }
  
  // Change/Delta values - add proper context
  if (labelLower.includes('change') || labelLower.includes('delta') || labelLower.includes('regression')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      // For correlation changes, show as Δ-0.03
      if (labelLower.includes('correlation')) {
        return `Δ${num.toFixed(2)}`
      }
      // For percentage changes, show as Δ+12.3%
      if (Math.abs(num) > 1) {
        return `Δ${num > 0 ? '+' : ''}${num.toFixed(1)}%`
      }
      // For small changes, show as Δ+0.03
      return `Δ${num > 0 ? '+' : ''}${num.toFixed(2)}`
    }
  }
  
  // Count/Period values - add proper units
  if (labelLower.includes('periods analyzed') || labelLower.includes('weeks analyzed') || labelLower.includes('sessions analyzed') || labelLower.includes('data points')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      if (labelLower.includes('period')) {
        return `${Math.round(num)} periods`
      }
      if (labelLower.includes('session')) {
        return `${Math.round(num)} sessions`
      }
      if (labelLower.includes('week')) {
        return `${Math.round(num)} weeks`
      }
      return `${Math.round(num)}`
    }
  }
  
  // CFR (Change Failure Rate) - always percentage
  if (labelLower.includes('cfr') || labelLower.includes('change failure rate') || labelLower.includes('subsequent avg cfr')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      return `${num.toFixed(1)}%`
    }
  }
  
  // AI usage rate - always assists/min
  if (labelLower.includes('ai usage rate') || labelLower.includes('ai usage')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      return `${num.toFixed(2)} assists/min`
    }
  }
  
  // Coding time - always minutes
  if (labelLower.includes('coding time') || labelLower.includes('mean coding min') || labelLower.includes('avg coding time')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      if (num >= 60) {
        const hours = Math.floor(num / 60)
        const mins = Math.round(num % 60)
        return `${hours}h ${mins}m`
      }
      return `${Math.round(num)}m`
    }
  }
  
  // AI assists - always count with unit
  if (labelLower.includes('ai assists') || labelLower.includes('total ai assists') || labelLower.includes('average ai assists')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      return `${Math.round(num)} assists`
    }
  }
  
  // Data points - always count
  if (labelLower.includes('data points') || labelLower.includes('data points analyzed')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      return `${Math.round(num)} points`
    }
  }
  
  // Stddev - always with unit
  if (labelLower.includes('stddev') || labelLower.includes('standard deviation')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      return `${num.toFixed(1)} σ`
    }
  }
  
  // CV (Coefficient of Variation) - always ratio
  if (labelLower.includes('cv') || labelLower.includes('coefficient of variation')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      return `${num.toFixed(2)} CV`
    }
  }
  
  // Efficiency - always ratio with context
  if (labelLower.includes('efficiency') || labelLower.includes('ai efficiency')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num)) {
      if (labelLower.includes('ai')) {
        return `${num.toFixed(2)} assists/min`
      }
      return `${num.toFixed(2)} efficiency`
    }
  }
  
  // Time range (weeks)
  if (labelLower.includes('time range') || labelLower.includes('weeks') || labelLower.includes('periods')) {
    const num = (typeof value === 'number') ? value : (typeof value === 'string' && isFinite(Number(value))) ? Number(value) : null
    if (num !== null && isFinite(num) && num > 0) {
      return `${Math.round(num)}w`
    }
  }
  
  // Default: try to format as number with comprehensive unit inference
  const num = (typeof value === 'number')
    ? value
    : (typeof value === 'string' && value.trim() !== '' && isFinite(Number(value)))
      ? Number(value)
      : null
  
  if (num !== null && isFinite(num)) {
    // If it's a decimal, show 2 decimals; if integer, show as-is
    const formatted = num % 1 === 0 ? num.toString() : num.toFixed(2)
    
    // Comprehensive unit inference based on label context
    if (labelLower.includes('count') || labelLower.includes('analyzed') || labelLower.includes('total')) {
      return `${formatted} items`
    }
    if (labelLower.includes('ratio') && !labelLower.includes('rework')) {
      return formatted // Ratios will be handled by percentage formatter
    }
    if (labelLower.includes('score') || labelLower.includes('rating')) {
      return `${formatted} score`
    }
    if (labelLower.includes('index') || labelLower.includes('benchmark')) {
      return `${formatted} index`
    }
    if (labelLower.includes('rate') && !labelLower.includes('percent') && !labelLower.includes('failure')) {
      return `${formatted}/sec`
    }
    if (labelLower.includes('size') || labelLower.includes('length')) {
      return `${formatted} units`
    }
    if (labelLower.includes('volume') || labelLower.includes('amount')) {
      return `${formatted} units`
    }
    if (labelLower.includes('level') || labelLower.includes('depth')) {
      return `${formatted} level`
    }
    if (labelLower.includes('ratio') && !labelLower.includes('rework')) {
      return `${formatted}:1`
    }
    
    // Last resort: provide basic unit based on value magnitude
    if (Math.abs(num) < 1) {
      return `${formatted} ratio`
    }
    if (Math.abs(num) > 1000) {
      return `${formatted} units`
    }
    
    // If all else fails, at least add "value" to indicate it's a measurement
    const result = `${formatted} value`
    
    // DEBUG: Log final result
    console.log('🔧 [FORMATTER] Result:', formatted)
    
    return formatted
  }
  
  return String(value)
}
