/**
 * Shared formatter layer for Performance Insights display values.
 * Eliminates floating point garbage and ensures consistent units.
 */

export type MetricUnit = 
  | 'commits_per_session'
  | 'minutes'
  | 'hours'
  | 'days'
  | 'percentage'
  | 'deployments_per_week'
  | 'score'
  | 'ratio'
  | 'assists_per_session'
  | 'reopens_per_pr'
  | 'cycle_time_minutes'
  | 'cycle_time_hours'
  | 'unknown';

/**
 * Infer unit from metric title/id
 */
export function inferMetricUnit(title: string, _id: string = ''): MetricUnit {
  const lowerTitle = title.toLowerCase();

  // Commits per session
  if (lowerTitle.includes('commit') && (lowerTitle.includes('session') || lowerTitle.includes('per session'))) {
    return 'commits_per_session';
  }
  
  // AI suggestions/assists
  if (lowerTitle.includes('ai') && (lowerTitle.includes('suggestion') || lowerTitle.includes('assist'))) {
    return 'assists_per_session';
  }

  // Time-based metrics
  if (lowerTitle.includes('time to first') || lowerTitle.includes('ttfc')) {
    return 'minutes';
  }
  
  if (lowerTitle.includes('cycle time') || lowerTitle.includes('pr cycle')) {
    // Determine if likely hours or minutes based on context
    if (lowerTitle.includes('hour') || lowerTitle.includes('day')) {
      return 'cycle_time_hours';
    }
    return 'cycle_time_minutes';
  }

  if (lowerTitle.includes('session length') || lowerTitle.includes('duration')) {
    return 'minutes';
  }

  if (lowerTitle.includes('active coding') || lowerTitle.includes('focus time')) {
    return 'minutes';
  }

  // Percentage-based metrics
  if (lowerTitle.includes('rework') || lowerTitle.includes('revert') || 
      lowerTitle.includes('reopen') || lowerTitle.includes('stagnation')) {
    return 'percentage';
  }

  if (lowerTitle.includes('coverage') || lowerTitle.includes('adoption')) {
    return 'percentage';
  }

  // Deployment metrics
  if (lowerTitle.includes('deployment') && lowerTitle.includes('cadence')) {
    return 'deployments_per_week';
  }

  if (lowerTitle.includes('failure') || lowerTitle.includes('change failure')) {
    return 'percentage';
  }

  // Review latency
  if (lowerTitle.includes('latency') || lowerTitle.includes('review time')) {
    return 'hours';
  }

  // Risk scores
  if (lowerTitle.includes('risk score') || lowerTitle.includes('quality score')) {
    return 'score';
  }

  // Ratios
  if (lowerTitle.includes('ratio') || lowerTitle.includes('yield')) {
    return 'ratio';
  }

  return 'unknown';
}

/**
 * Format a numeric value with proper rounding and unit
 */
export function formatPIValue(
  value: number | string,
  unit: MetricUnit,
  maxDecimals: number = 1
): string {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(numValue) || numValue === null || numValue === undefined) {
    return '—';
  }

  // Round to avoid floating point garbage
  const rounded = Math.round(numValue * Math.pow(10, maxDecimals)) / Math.pow(10, maxDecimals);

  switch (unit) {
    case 'commits_per_session':
      return `${rounded.toFixed(maxDecimals)} commits/session`;
    
    case 'assists_per_session':
      return `${rounded.toFixed(maxDecimals)} assists/session`;
    
    case 'minutes':
    case 'cycle_time_minutes':
      if (rounded >= 60) {
        const hours = Math.floor(rounded / 60);
        const mins = Math.round(rounded % 60);
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
      }
      return `${rounded.toFixed(maxDecimals)} min`;
    
    case 'hours':
    case 'cycle_time_hours':
      if (rounded >= 24) {
        const days = Math.floor(rounded / 24);
        const hours = Math.round(rounded % 24);
        return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
      }
      return `${rounded.toFixed(maxDecimals)} hrs`;
    
    case 'days':
      return `${rounded.toFixed(maxDecimals)} days`;
    
    case 'percentage':
      return `${rounded.toFixed(maxDecimals)}%`;
    
    case 'deployments_per_week':
      return `${rounded.toFixed(maxDecimals)} deployments/week`;
    
    case 'score':
      return `${rounded.toFixed(maxDecimals)} / 100`;
    
    case 'ratio':
      return `${rounded.toFixed(maxDecimals)}x`;
    
    case 'reopens_per_pr':
      return `${rounded.toFixed(maxDecimals)} reopens/PR`;
    
    default:
      // Fallback: just return rounded number
      return rounded.toFixed(maxDecimals);
  }
}

/**
 * Format a delta (change vs baseline)
 */
export function formatPIDelta(delta: number | string, unit: MetricUnit = 'percentage'): string {
  const numDelta = typeof delta === 'string' ? parseFloat(delta) : delta;
  
  if (isNaN(numDelta) || numDelta === null || numDelta === undefined) {
    return '';
  }

  const rounded = Math.round(numDelta * 10) / 10;
  const sign = rounded > 0 ? '+' : '';

  switch (unit) {
    case 'percentage':
      return `${sign}${rounded.toFixed(1)}%`;
    case 'commits_per_session':
      return `${sign}${rounded.toFixed(1)} commits/session`;
    case 'minutes':
      return `${sign}${rounded.toFixed(1)} min`;
    case 'hours':
      return `${sign}${rounded.toFixed(1)} hrs`;
    default:
      return `${sign}${rounded.toFixed(1)}`;
  }
}

/**
 * Get metric-specific section label
 */
export function getMetricSpecificLabel(title: string): string {
  const lowerTitle = title.toLowerCase();

  if (lowerTitle.includes('commit') && lowerTitle.includes('session')) {
    return 'Commits per Session by IDE';
  }
  
  if (lowerTitle.includes('ai') && (lowerTitle.includes('suggestion') || lowerTitle.includes('assist'))) {
    return 'AI Suggestions by IDE';
  }

  if (lowerTitle.includes('time to first') || lowerTitle.includes('ttfc')) {
    return 'Time to First Commit by IDE';
  }

  if (lowerTitle.includes('cycle time')) {
    return 'PR Cycle Time by IDE';
  }

  if (lowerTitle.includes('session length') || lowerTitle.includes('duration')) {
    return 'Session Length by IDE';
  }

  if (lowerTitle.includes('active coding')) {
    return 'Active Coding Time by IDE';
  }

  if (lowerTitle.includes('rework')) {
    return 'Rework Rate by IDE';
  }

  if (lowerTitle.includes('reopen')) {
    return 'PR Reopen Rate by IDE';
  }

  if (lowerTitle.includes('deployment') && lowerTitle.includes('cadence')) {
    return 'Deployment Cadence by IDE';
  }

  if (lowerTitle.includes('failure')) {
    return 'Change Failure Rate by IDE';
  }

  if (lowerTitle.includes('latency') || lowerTitle.includes('review time')) {
    return 'Review Latency by IDE';
  }

  if (lowerTitle.includes('reviewer') && lowerTitle.includes('concentration')) {
    return 'Reviewer Concentration by IDE';
  }

  // Fallback
  return 'Performance by IDE';
}
