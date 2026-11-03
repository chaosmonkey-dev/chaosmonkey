/**
 * PI V2 Collapsed Row Formatter
 *
 * Transforms V2 preview rows to comply with presentation contract:
 * 1. Actionable, declarative titles
 * 2. Single primary metric (ranked comparison or org value) with units
 * 3. No internal metadata in collapsed view
 * 4. Trust badges: source, scope, low-coverage warning
 * 5. Hide collapsed view for rows with non-meaningful values (all zeros, identical placeholders)
 *
 * This is UI responsibility only - does NOT modify compute logic, joins, or eligibility.
 */

import { formatPIValue, inferMetricUnit } from './piValueFormatter'

export interface CollapsedRowPresentation {
  shouldCollapse: boolean // false = hide collapsed view, keep in "Emerging Signals"
  title: string // Actionable, declarative
  subtitle?: string // Technical descriptor (optional)
  rightMetric: string // Single value with units
  trustBadges: string[] // source, scope, coverage warnings
  callout?: string // Coverage warning or data quality note
}

interface V2Row {
  id: string
  title?: string
  subtitle?: string
  rightMetric?: string
  callout?: string
  details?: string
  breakdownByTool?: Record<string, string>
  signalCoveragePct?: number
  contributingUnitsCount?: number
  contributingUnitType?: string
  cicdStage?: string
  [key: string]: any
}

/**
 * Detect if all values in breakdownByTool are identical (placeholder suspicion)
 */
function hasIdenticalValues(breakdownByTool: Record<string, string> | undefined): boolean {
  if (!breakdownByTool || typeof breakdownByTool !== 'object') return false
  
  const values = Object.values(breakdownByTool).map(v => 
    String(v).replace(/[^0-9.]/g, '') // Extract numeric part
  )
  
  if (values.length < 2) return false
  
  const first = values[0]
  return values.every(v => v === first)
}

/**
 * Detect if all values are zero (data pipeline issue)
 */
function hasAllZeroValues(breakdownByTool: Record<string, string> | undefined): boolean {
  if (!breakdownByTool || typeof breakdownByTool !== 'object') return false
  
  const values = Object.values(breakdownByTool).map(v => {
    const numPart = String(v).replace(/[^0-9.]/g, '')
    return parseFloat(numPart) || 0
  })
  
  return values.length > 0 && values.every(v => v === 0)
}

/**
 * Extract numeric value from formatted string (e.g., "4.2 commits/session" → 4.2)
 */
function extractNumericValue(formattedValue: string): number {
  // Return NaN for dash/insufficient placeholders so callers can filter them out
  const s = String(formattedValue).trim()
  if (!s || s === '—' || s === '–' || s === '-' || s === '--' || s.toLowerCase().includes('insufficient')) return NaN
  const match = s.match(/[-+]?[0-9]*\.?[0-9]+/)
  return match ? parseFloat(match[0]) : NaN
}

/**
 * PROMPT 18: Canonical duration formatter for float hours → human-readable format.
 * Converts raw hour floats (e.g., 19.494444) to clean "Xh Ym" or "Xd Yh" format.
 *
 * Examples:
 *   19.4944 → "19h 30m"
 *   0.5 → "30m"
 *   0.0 → "0m"
 *   48.25 → "2d 0h"
 *   null/NaN → "—"
 */
export function formatHoursToHuman(hoursFloat: number | null | undefined): string {
  if (hoursFloat === null || hoursFloat === undefined || isNaN(hoursFloat)) {
    return '—'
  }

  const hours = Math.abs(hoursFloat)

  if (hours >= 24) {
    // Days + hours format
    const days = Math.floor(hours / 24)
    const remainingHours = Math.round(hours % 24)
    if (remainingHours === 0) {
      return `${days}d`
    }
    return `${days}d ${remainingHours}h`
  } else if (hours >= 1) {
    // Hours + minutes format
    const wholeHours = Math.floor(hours)
    const minutes = Math.round((hours - wholeHours) * 60)
    if (minutes === 0) {
      return `${wholeHours}h`
    }
    return `${wholeHours}h ${minutes}m`
  } else {
    // Minutes only
    const minutes = Math.round(hours * 60)
    return `${minutes}m`
  }
}

/**
 * Build actionable title from breakdownByTool
 */
function buildActionableTitle(row: V2Row): string {
  const id = row.id
  const breakdownByTool = row.breakdownByTool
  
  // Org-level rows (no breakdownByTool or single 'org' key)
  if (!breakdownByTool || Object.keys(breakdownByTool).length === 0) {
    return row.title || id
  }
  
  const keys = Object.keys(breakdownByTool)
  if (keys.length === 1 && keys[0] === 'org') {
    // Org-level single value
    return row.title || id
  }
  
  // AI vs Non-AI comparison
  if (keys.includes('ai-assisted') || keys.includes('non-ai')) {
    const aiValue = extractNumericValue(breakdownByTool['ai-assisted'] || '0')
    const nonAiValue = extractNumericValue(breakdownByTool['non-ai'] || '0')
    
    if (aiValue === 0 && nonAiValue === 0) {
      // All zeros - use generic title
      return 'AI and Non-AI sessions show insufficient data'
    }
    
    if (aiValue > nonAiValue) {
      return 'AI-assisted sessions show higher ' + getTitleMetricName(id)
    } else if (nonAiValue > aiValue) {
      return 'Non-AI sessions show higher ' + getTitleMetricName(id)
    } else {
      return 'AI and Non-AI sessions show similar ' + getTitleMetricName(id)
    }
  }
  
  // IDE comparison - find leader
  const ideValues = Object.entries(breakdownByTool)
    .filter(([tool]) => ['cursor', 'windsurf', 'vscode'].includes(tool.toLowerCase()))
    .map(([tool, value]) => {
      const numValue = extractNumericValue(value)
      const unit = inferMetricUnit(row.title || '', id)
      return {
        tool: capitalizeIDE(tool),
        value: numValue,
        formatted: formatPIValue(numValue, unit)
      }
    })
    .sort((a, b) => b.value - a.value)
  
  if (ideValues.length === 0) {
    return row.title || id
  }
  
  // Check if all values are identical
  const uniqueValues = new Set(ideValues.map(v => v.value))
  if (uniqueValues.size === 1) {
    // All identical - use neutral title
    return 'All IDEs show similar ' + getTitleMetricName(id)
  }
  
  const leader = ideValues[0]
  const metricName = getTitleMetricName(id)
  
  // Higher is better by default, except for certain metrics
  const lowerIsBetter = id.includes('time-to-first-commit') || 
                        id.includes('cycle-time') || 
                        id.includes('mttr') ||
                        id.includes('rework')
  
  if (lowerIsBetter) {
    const lowest = ideValues[ideValues.length - 1]
    return `${lowest.tool} has the fastest ${metricName}`
  }
  
  return `${leader.tool} leads in ${metricName}`
}

/**
 * Get human-readable metric name for title
 */
function getTitleMetricName(id: string): string {
  const metricNames: Record<string, string> = {
    'commits-per-session-by-ide': 'commits per session',
    'active-coding-time-by-ide': 'active coding time',
    'ai-suggestions-accepted-by-ide': 'AI suggestions accepted',
    'average-session-length-by-ide': 'session length',
    'pr-review-cycles-by-ide': 'PR review cycles',
    'time-to-first-commit-by-ide': 'time to first commit',
    'ai-rework-burden-ai-vs-non-ai': 'rework burden',
    'delivery-rate-ai-vs-non-ai': 'delivery rate',
    'fast-but-unstable-org': 'velocity vs reliability',
    'pr-cycle-time-by-ide': 'PR cycle time',
    'pr-size-by-ide': 'PR size',
    'revert-rate-by-ide': 'revert rate',
    'mttr-by-ide': 'mean time to recovery'
  }
  
  return metricNames[id] || id.replace(/-/g, ' ')
}

/**
 * Capitalize IDE name
 */
function capitalizeIDE(tool: string): string {
  const lower = tool.toLowerCase()
  if (lower === 'vscode') return 'VSCode'
  if (lower === 'cursor') return 'Cursor'
  if (lower === 'windsurf') return 'Windsurf'
  return tool.charAt(0).toUpperCase() + tool.slice(1).toLowerCase()
}

/**
 * Build trust badges
 */
function buildTrustBadges(row: V2Row): string[] {
  const badges: string[] = []
  
  // Data source badge
  const sources = (row as any).primarySignalsUsed || []
  if (sources.includes('sessions')) {
    badges.push('Sessions')
  } else if (sources.includes('productivityByPeriod')) {
    badges.push('Telemetry')
  } else if (sources.includes('githubByPeriod') || sources.includes('github_periods')) {
    badges.push('GitHub')
  }
  
  // Scope badge
  if (row.id?.includes('-by-ide')) {
    badges.push('IDE-specific')
  } else if (row.id?.includes('-org') || row.id?.includes('-ai-vs-non-ai')) {
    badges.push('Org-wide')
  }
  
  // Low coverage warning
  const coverage = row.signalCoveragePct
  if (typeof coverage === 'number' && coverage < 10) {
    badges.push('Low coverage')
  }
  
  return badges
}

/**
 * Build coverage callout
 * NOTE: Collapsed view should NOT show coverage metadata per presentation contract.
 * Coverage details are preserved in expanded view via original row data.
 */
function buildCoverageCallout(row: V2Row): string | undefined {
  // Do NOT return coverage metadata for collapsed view
  // This keeps the decision surface clean and actionable
  // Expanded view still has full access to contributingUnitsCount, signalCoveragePct, etc.
  return undefined
}

/**
 * Clean rightMetric to remove engineering metadata (Range:, N:, tool breakdowns, ORG:, etc.)
 * Keep only the primary metric value with its unit.
 * 
 * Examples:
 *   "Range: 9 N: 9 windsurf: 3.70 commits/session vscode: 3.10 cursor: 3 ORG: HYBRID" → "3.70 commits/session"
 *   "4.2 commits/session Range: 2.1-8.5" → "4.2 commits/session"
 *   "Sessions: 42 N: 9 org: 1.5 hours" → "1.5 hours"
 *   "AI: 0.0% • Non-AI: 0.0%" → "0.0% vs 0.0%" (comparison format)
 */
export function cleanRightMetric(rawMetric: string | undefined): string {
  if (!rawMetric) return ''
  
  // Special case: AI vs Non-AI comparison format "AI: X% • Non-AI: Y%"
  const aiComparisonMatch = rawMetric.match(/AI:\s*([0-9.]+%?)\s*[•·]\s*Non-AI:\s*([0-9.]+%?)/i)
  if (aiComparisonMatch) {
    return `${aiComparisonMatch[1]} vs ${aiComparisonMatch[2]}`
  }
  
  // Special case: IDE comparison "windsurf: X • vscode: Y • cursor: Z"
  const ideComparison = rawMetric.match(/(windsurf|cursor|vscode|jetbrains):\s*([0-9.]+)\s*[•·]\s*(windsurf|cursor|vscode|jetbrains):\s*([0-9.]+)/i)
  if (ideComparison) {
    // Return the highest value (winner) - try to preserve units from original
    const val1 = parseFloat(ideComparison[2])
    const val2 = parseFloat(ideComparison[4])
    const winner = val1 >= val2 ? ideComparison[2] : ideComparison[4]
    
    // Try to extract units from the original metric
    const unitMatch = rawMetric.match(/([0-9.]+)\s*([a-zA-Z/%]+)/)
    if (unitMatch) {
      return `${winner} ${unitMatch[2]}`
    }
    return winner
  }
  
  // Strategy 1: If there's a clean value BEFORE metadata keywords, use it
  const metadataKeywords = /\b(Range|N|Sessions|cursor|vscode|windsurf|ORG|org|non_ai|ai):/i
  const beforeMetadata = rawMetric.split(metadataKeywords)[0].trim()
  
  if (beforeMetadata && /[0-9]/.test(beforeMetadata)) {
    // Has a number before metadata - this is our primary value, preserve units
    return beforeMetadata
  }
  
  // Strategy 2: String starts with metadata - extract IDE-specific or org values
  // This handles "Range: 9 N: 9 windsurf: 3.70 commits/session vscode: 3.10 cursor: 3"
  
  // Look for IDE-specific values (cursor:, vscode:, windsurf:, jetbrains:) with units
  const ideMatches = rawMetric.match(/(cursor|vscode|windsurf|jetbrains):\s*([0-9]+\.?[0-9]*)\s*([a-zA-Z/%]+)?/gi)
  if (ideMatches && ideMatches.length > 0) {
    // Extract the first IDE value with units
    const match = ideMatches[0].match(/:\s*([0-9]+\.?[0-9]*)\s*([a-zA-Z/%]+)?/)
    if (match) {
      const value = match[1]
      const unit = match[2] || ''
      return unit ? `${value} ${unit}` : value
    }
  }
  
  // Look for "org:" value (org-level metric) with units
  const orgMatch = rawMetric.match(/\borg:\s*([0-9]+\.?[0-9]*)\s*([a-zA-Z/%]+)?/i)
  if (orgMatch) {
    const value = orgMatch[1]
    const unit = orgMatch[2] || ''
    return unit ? `${value} ${unit}` : value
  }
  
  // Strategy 3: Extract any standalone number with units (fallback)
  const valueMatch = rawMetric.match(/([0-9]+\.?[0-9]*)\s*([a-zA-Z/%]+)?/)
  if (valueMatch) {
    const value = valueMatch[1]
    const unit = valueMatch[2] || ''
    return unit ? `${value} ${unit}` : value
  }
  
  // Last resort: return as-is
  return rawMetric
}

/**
 * Display Metric type for strip view formatting
 */
export type DisplayMetric = {
  value: number
  label: string        // e.g., "Focus", "Low focus", "Session length", "Risk score"
  unit?: string        // e.g., "%", "min", "hr", "cycles", "commits/session", "assists/session"
  kind?: "percent" | "duration_min" | "duration_hr" | "count" | "rate" | "score" | "ratio" | "days_hours" | "status"
}

type Kind = "percent" | "duration_min" | "duration_hr" | "count" | "rate" | "score" | "ratio" | "days_hours" | "status";
type DisplayMetricSpec = { label: string; kind: Kind; unit?: string; };

/**
 * Deterministic mapping for actual PI IDs from debug logs
 */
const STRIP_ID_MAP: Record<string, DisplayMetricSpec> = {
  // Plan & Code — telemetry
  "telemetry-session-quality-regression": { label: "Focus", kind: "percent" },
  "telemetry-ai-focus-imbalance": { label: "Low focus", kind: "percent" },
  "telemetry-remote-workspace-drag": { label: "Session length", kind: "duration_min" },
  "telemetry-session-idle-time": { label: "Idle", kind: "percent" },

  // Plan & Code — IDE comparison
  "active-coding-time-by-ide": { label: "Active coding", kind: "duration_min" },
  "time-to-first-commit-by-ide": { label: "TTFC", kind: "duration_min" },
  "average-session-length-by-ide": { label: "Session length", kind: "duration_min" },
  "commits-per-session-by-ide": { label: "Commits/session", kind: "rate", unit: "commits/session" },
  "ai-suggestions-accepted-by-ide": { label: "AI assists", kind: "rate", unit: "assists/session" },
  "branches-per-session-by-ide": { label: "Branches/session", kind: "rate", unit: "branches/session" },
  "code-churn-by-ide": { label: "Churn", kind: "percent" },
  "rework-rate-by-ide": { label: "Rework rate", kind: "percent" },
  "fast-but-unstable-org": { label: "Performance delta", kind: "score" },
  "fast-but-unstable-by-ide": { label: "Performance delta", kind: "score" },

  // Plan & Code — AI vs Non-AI
  "delivery-rate-ai-vs-non-ai": { label: "Delivery rate", kind: "percent" },
  "ai-rework-burden-ai-vs-non-ai": { label: "Rework burden", kind: "percent" },
  "ai-yield-ratio-ai-vs-non-ai": { label: "AI yield", kind: "ratio" },
  "branch-stagnation-risk-ai-vs-non-ai": { label: "Stagnation", kind: "percent" },
  "commit-abandonment-rate-ai-vs-non-ai": { label: "Abandonment", kind: "percent" },
  "ai-assisted-delivery-impact": { label: "AI delivery lift", kind: "ratio" },

  // Review & Merge
  "pr-cycle-time-by-ide": { label: "PR cycle time", kind: "duration_hr" },
  "pr-review-cycles-by-ide": { label: "Review cycles", kind: "count", unit: "cycles/PR" },
  "pr-size-by-ide": { label: "PR size", kind: "count", unit: "lines" },
  "revert-rate-by-ide": { label: "Revert rate", kind: "percent" },
  "reviewer-load-concentration": { label: "Reviews/reviewer", kind: "ratio", unit: "reviews/reviewer" },
  "large-pr-mix-risk": { label: "Large PRs", kind: "percent" },
  "reopen-pressure-spike": { label: "Reopen rate", kind: "percent" },
  "review-latency-spike-by-ide": { label: "Review latency", kind: "duration_hr" },
  "pr-cycle-time-bottleneck-by-ide": { label: "Bottleneck", kind: "duration_hr" },
  "session-conditioned-pr-cycle-time-ai-vs-non-ai": { label: "PR cycle time", kind: "duration_hr" },
  "session-conditioned-change-risk-ai-vs-non-ai": { label: "Risk lift", kind: "ratio" },

  // GitHub-backed org-level insights
  "org-review-latency-spike": { label: "Review latency", kind: "duration_hr" },
  "org-pr-cycle-time-bottleneck": { label: "PR cycle time", kind: "duration_hr" },

  // Deploy & Operate
  "change-failure-rate-trend-org": { label: "CFR trend", kind: "percent" },
  "change-failure-rate-trend-by-ide": { label: "CFR", kind: "percent" },
  "change-failure-rate-spike-by-ide": { label: "CFR", kind: "percent" },
  "deployment-frequency-volatility-by-ide": { label: "Deploy freq CV", kind: "ratio" },
  "delivery-velocity-by-workflow": { label: "Deploys/week", kind: "rate", unit: "deploys/week" },
  "latest-deployment-unhealthy": { label: "Deployment status", kind: "status" },
  "latest-deployment-succeeded": { label: "Deployment status", kind: "status" },
  "stale-deployment-signal": { label: "Stale deployments", kind: "days_hours" },
  "failed-deployment-pressure": { label: "Failed deployments", kind: "count", unit: "failed" },
  "mttr-by-ide": { label: "MTTR", kind: "duration_hr" },
};

/**
 * Extract status value from insight evidence or displayValue for deployment metrics
 */
function extractStatusValue(insight: V2Row): string | null {
  // Check rightMetric first — compute functions set this to "Success • Jan 27, 10:15 AM"
  if (insight.rightMetric) {
    const rm = String(insight.rightMetric).toLowerCase();
    if (rm.startsWith('success') || rm.includes('succeeded')) return 'success';
    if (rm.startsWith('fail') || rm.startsWith('error') || rm.includes('unhealthy')) return 'failed';
    if (rm === 'unknown' || rm === 'no data') return null;
  }

  // Check evidence — may be array of strings (from compute) or {label,value} objects
  const evidence = insight.evidence;
  if (evidence && Array.isArray(evidence)) {
    for (const ev of evidence) {
      const str = typeof ev === 'string' ? ev : (ev as any)?.value != null ? String((ev as any).value) : null;
      if (!str) continue;
      const lower = str.toLowerCase();
      if (lower.includes('status')) {
        if (lower.includes('success')) return 'success';
        if (lower.includes('fail') || lower.includes('error')) return 'failed';
      }
    }
  }

  // Fallback to displayValue
  if (insight.displayValue) {
    const displayStr = String(insight.displayValue).toLowerCase();
    if (displayStr.includes('success') || displayStr.includes('succeeded')) return 'success';
    if (displayStr.includes('fail') || displayStr.includes('failed') || displayStr.includes('unhealthy')) return 'failed';
  }

  // Fallback to title
  if (insight.title) {
    const titleLower = String(insight.title).toLowerCase();
    if (titleLower.includes('succeeded')) return 'success';
    if (titleLower.includes('failed') || titleLower.includes('unhealthy')) return 'failed';
  }

  return null;
}

/**
 * Resolve primary strip metric with deterministic rules
 * Returns DisplayMetric object or null
 */
export function resolvePrimaryStripMetric(insight: V2Row): DisplayMetric | null {
  // ── PROMPT 1 DIAGNOSTIC: Log GitHub PI resolution ──
  const isGitHubPI = ['reviewer-load-concentration', 'reopen-pressure-spike', 'large-pr-mix-risk',
                      'stale-deployment-signal', 'failed-deployment-pressure', 'latest-deployment-unhealthy',
                      'delivery-velocity-by-workflow', 'change-failure-rate-spike-by-ide',
                      'deployment-frequency-volatility-by-ide', 'revert-rate-by-ide', 'pr-review-cycles-by-ide'].includes(insight.id)
  if ((import.meta as any)?.env?.DEV && isGitHubPI) {
    console.log('[STRIP_METRIC][ENTRY]', {
      id: insight.id,
      displayValue: insight.displayValue,
      rightMetric: insight.rightMetric,
      hasDisplayValue: insight.displayValue !== undefined && insight.displayValue !== null && insight.displayValue !== '',
      hasRightMetric: insight.rightMetric !== undefined && insight.rightMetric !== null && insight.rightMetric !== ''
    })
  }

  // Priority 1: Use deterministic mapping for known PI IDs
  const mappedSpec = STRIP_ID_MAP[insight.id];
  if (mappedSpec) {
    // Special handling for status-type metrics (deployment status)
    if (mappedSpec.kind === 'status') {
      // For status metrics, extract the status from evidence or displayValue
      const statusValue = extractStatusValue(insight);
      if (statusValue) {
        const result = {
          value: statusValue === 'success' ? 1 : 0, // Convert to numeric for display
          label: mappedSpec.label,
          kind: mappedSpec.kind,
          unit: ''
        };
        return result;
      }
    }
    
    // Parse value from displayValue first, then rightMetric
    let value: number | null = null;
    let source = '';
    
    if (insight.displayValue !== undefined && insight.displayValue !== null && insight.displayValue !== '') {
      value = parseFloat(String(insight.displayValue));
      source = 'displayValue';
    } else if (insight.rightMetric !== undefined && insight.rightMetric !== null && insight.rightMetric !== '') {
      value = parseValueFromRightMetric(insight.rightMetric, insight.id);
      source = 'rightMetric';
    }
    
    if (value !== null && !isNaN(value)) {
      const result = {
        value,
        label: mappedSpec.label,
        kind: mappedSpec.kind,
        unit: mappedSpec.unit
      };
      // ── PROMPT 1 DIAGNOSTIC: Log successful resolution ──
      if ((import.meta as any)?.env?.DEV && isGitHubPI) {
        console.log('[STRIP_METRIC][RESOLVED]', { id: insight.id, source, result })
      }
      return result;
    }
    // ── PROMPT 1 DIAGNOSTIC: Log failed resolution ──
    if ((import.meta as any)?.env?.DEV && isGitHubPI) {
      console.log('[STRIP_METRIC][FAILED_TO_RESOLVE]', { id: insight.id, value, source, mappedSpec })
    }
  }

  // Priority 2: Fallback to existing logic for unmapped PIs
  if (insight.displayValue !== undefined && insight.displayValue !== null && insight.displayValue !== '') {
    const value = parseFloat(String(insight.displayValue));
    if (!isNaN(value)) {
      const unit = insight.displayUnit || '';
      const kind = inferKindFromUnit(unit);
      const label = inferLabelFromInsightId(insight.id);
      const result = {
        value,
        label: label,
        kind: kind,
        unit: unit
      };
      return result;
    }
  }

  // Priority 3: Known metric fields by PI type / rule key (existing logic)
  const idLower = insight.id.toLowerCase();
  
  // commits/session
  if (idLower.includes('commits-per-session') || idLower.includes('commit') && idLower.includes('session')) {
    const value = extractNumericFromField(insight, ['commitsPerSession', 'commitRate', 'commits']);
    if (value !== null) {
      const result = { value, label: 'Commits per session', kind: 'rate' as const, unit: 'commits/session' };
      return result;
    }
  }

  // active coding time
  if (idLower.includes('active-coding-time') || idLower.includes('coding-time') || idLower.includes('active-coding')) {
    const value = extractNumericFromField(insight, ['activeCodingTime', 'codingTime', 'codingMinutes']);
    if (value !== null) {
      const result = { value, label: 'Active coding time', kind: 'duration_min' as const };
      return result;
    }
  }

  // AI assists/session
  if (idLower.includes('ai-assists') || idLower.includes('assists') && idLower.includes('session')) {
    const value = extractNumericFromField(insight, ['aiAssistsPerSession', 'assistsPerSession', 'aiAssists']);
    if (value !== null) {
      const result = { value, label: 'AI assists', kind: 'rate' as const, unit: 'assists/session' };
      return result;
    }
  }

  // TTFC (time-to-first-commit)
  if (idLower.includes('time-to-first-commit') || idLower.includes('ttfc') || idLower.includes('first-commit')) {
    const value = extractNumericFromField(insight, ['ttfc', 'timeToFirstCommit', 'firstCommitTime']);
    if (value !== null) {
      const result = { value, label: 'TTFC', kind: 'duration_min' as const };
      return result;
    }
  }

  // Focus %
  if (idLower.includes('focus') || idLower.includes('concentration')) {
    const value = extractNumericFromField(insight, ['focus', 'concentration', 'focusRatio']);
    if (value !== null) {
      const result = { value, label: 'Focus', kind: 'percent' as const };
      return result;
    }
  }

  // Cycles
  if (idLower.includes('cycle') || idLower.includes('review-cycle')) {
    const value = extractNumericFromField(insight, ['cycles', 'reviewCycles', 'prCycles']);
    if (value !== null) {
      const result = { value, label: 'Review cycles', kind: 'count' as const, unit: 'cycles' };
      return result;
    }
  }

  // Risk score
  if (idLower.includes('risk') || idLower.includes('lag')) {
    const value = extractNumericFromField(insight, ['risk', 'riskScore', 'lagRisk']);
    if (value !== null) {
      const result = { value, label: 'Risk score', kind: 'score' as const };
      return result;
    }
  }

  // Deployment age
  if (idLower.includes('deployment') && (idLower.includes('age') || idLower.includes('stale'))) {
    const value = extractNumericFromField(insight, ['deploymentAge', 'staleHours', 'deploymentHours']);
    if (value !== null) {
      const result = { value, label: 'Stale deployments', kind: 'duration_hr' as const };
      return result;
    }
  }

  // Session length
  if (idLower.includes('session-length') || idLower.includes('session') && idLower.includes('length')) {
    const value = extractNumericFromField(insight, ['sessionLength', 'avgSessionLength']);
    if (value !== null) {
      const result = { value, label: 'Session length', kind: 'duration_min' as const };
      return result;
    }
  }

  // Priority 4: Evidence "Value" field
  const evidence = insight.evidence as Array<{ label: string; value: any }>;
  if (evidence && Array.isArray(evidence)) {
    const valueRow = evidence.find(ev => 
      ev.label?.toLowerCase().includes('value') ||
      ev.label?.toLowerCase().includes('metric') ||
      ev.label?.toLowerCase().includes('total') ||
      ev.label?.toLowerCase().includes('average')
    );
    
    if (valueRow && valueRow.value !== undefined) {
      const numValue = parseFloat(String(valueRow.value));
      if (!isNaN(numValue)) {
        const label = valueRow.label;
        const kind = inferKindFromEvidenceLabel(label);
        const unit = inferUnitFromEvidenceLabel(label);
        const result = { 
          value: numValue, 
          label: label,
          kind: kind,
          unit: unit
        };
        return result;
      }
    }
  }

  // Priority 5: Last-resort numeric fallback from rightMetric
  if (insight.rightMetric !== undefined && insight.rightMetric !== null && insight.rightMetric !== '') {
    const numericValue = extractNumericFromString(String(insight.rightMetric));
    if (numericValue !== null) {
      const label = inferLabelFromInsightId(insight.id);
      const kind = inferKindFromInsightId(insight.id);
      const unit = inferUnitFromInsightId(insight.id);
      const result = {
        value: numericValue,
        label: label,
        kind: kind,
        unit: unit
      };
      return result;
    }
  }

  // Priority 6: Data rescue from breakdownByTool — extract winner value when
  // rightMetric is unparseable (e.g. "Insufficient data") but per-tool numerics exist.
  const breakdown = (insight as any).breakdownByTool
  if (breakdown && typeof breakdown === 'object') {
    const toolKeys = competitiveKeys(breakdown)
    const numericEntries = toolKeys
      .map(k => ({ key: k, value: extractNumericValue(String(breakdown[k])) }))
      .filter(e => !isNaN(e.value))
    if (numericEntries.length > 0) {
      // Pick the best value using directionality
      const lowerBetter = isLowerBetter(insight.id)
      numericEntries.sort((a, b) => lowerBetter ? a.value - b.value : b.value - a.value)
      const spec = STRIP_ID_MAP[insight.id]
      const label = spec?.label || inferLabelFromInsightId(insight.id)
      const kind = spec?.kind || inferKindFromInsightId(insight.id)
      const unit = spec?.unit
      return { value: numericEntries[0].value, label, kind, unit }
    }
  }

  // Priority 7 (Prompt 17, Step 1): GitHub org-only fallback — extract from breakdownByTool.org
  // when no competitive IDE keys exist but org has a value
  if (breakdown && typeof breakdown === 'object' && breakdown.org) {
    const orgValue = extractNumericValue(String(breakdown.org))
    if (!isNaN(orgValue)) {
      const spec = STRIP_ID_MAP[insight.id]
      const label = spec?.label || inferLabelFromInsightId(insight.id)
      const kind = spec?.kind || inferKindFromInsightId(insight.id)
      const unit = spec?.unit
      return { value: orgValue, label, kind, unit }
    }
  }

  return null;
}

/**
 * Parse numeric value from rightMetric string with special handling for by-ide metrics
 */
function parseValueFromRightMetric(rightMetric: string, insightId: string): number | null {
  // Special handling for *-by-ide metrics - pick the first IDE value (winner)
  if (insightId.includes('-by-ide')) {
    const segments = rightMetric.split('•');
    if (segments.length > 0) {
      const firstSegment = segments[0].trim();
      const match = firstSegment.match(/([-+]?\d*\.?\d+)/);
      if (match) {
        return parseFloat(match[1]);
      }
    }
  }

  // For percent-kind rows, prefer a value adjacent to "%" (e.g. "3/45 PRs (7%)" → 7)
  const spec = STRIP_ID_MAP[insightId]
  if (spec?.kind === 'percent') {
    const pctMatch = rightMetric.match(/([-+]?\d*\.?\d+)\s*%/)
    if (pctMatch) {
      return parseFloat(pctMatch[1])
    }
  }

  // Standard parsing for other metrics
  const match = rightMetric.match(/([-+]?\d*\.?\d+)/);
  if (match) {
    return parseFloat(match[1]);
  }

  return null;
}

/**
 * Infer kind from unit string
 */
function inferKindFromUnit(unit: string): DisplayMetric['kind'] {
  if (unit.includes('%')) return 'percent';
  if (unit.includes('min')) return 'duration_min';
  if (unit.includes('hour') || unit.includes('hr')) return 'duration_hr';
  if (unit.includes('/')) return 'rate';
  if (unit.includes('score')) return 'score';
  if (unit.includes('cycle')) return 'count';
  return 'count';
}

/**
 * Infer kind from evidence label
 */
function inferKindFromEvidenceLabel(label: string): DisplayMetric['kind'] {
  const labelLower = label.toLowerCase();
  if (labelLower.includes('%') || labelLower.includes('percent') || labelLower.includes('focus') || labelLower.includes('concentration')) return 'percent';
  if (labelLower.includes('min') || labelLower.includes('minute') || labelLower.includes('time') || labelLower.includes('ttfc')) return 'duration_min';
  if (labelLower.includes('hour') || labelLower.includes('hr') || labelLower.includes('day')) return 'duration_hr';
  if (labelLower.includes('cycle')) return 'count';
  if (labelLower.includes('risk') || labelLower.includes('score')) return 'score';
  if (labelLower.includes('rate') || labelLower.includes('per')) return 'rate';
  return 'count';
}

/**
 * Infer unit from evidence label
 */
function inferUnitFromEvidenceLabel(label: string): string | undefined {
  const labelLower = label.toLowerCase();
  if (labelLower.includes('%')) return '%';
  if (labelLower.includes('min') || labelLower.includes('minute')) return 'min';
  if (labelLower.includes('hour') || labelLower.includes('hr')) return 'hr';
  if (labelLower.includes('cycle')) return 'cycles';
  if (labelLower.includes('commit') && labelLower.includes('session')) return 'commits/session';
  if (labelLower.includes('assist') && labelLower.includes('session')) return 'assists/session';
  return undefined;
}

/**
 * Infer kind from insight ID
 */
function inferKindFromInsightId(insightId: string): DisplayMetric['kind'] {
  const idLower = insightId.toLowerCase();
  if (idLower.includes('idle') || idLower.includes('focus') || idLower.includes('concentration')) return 'percent';
  if (idLower.includes('failure-rate') || idLower.includes('cfr') || idLower.includes('revert') || idLower.includes('rework') || idLower.includes('churn') || idLower.includes('reopen') || idLower.includes('abandon') || idLower.includes('stagnation')) return 'percent';
  if (idLower.includes('mttr') || idLower.includes('latency') || idLower.includes('cycle-time') || idLower.includes('bottleneck')) return 'duration_hr';
  if (idLower.includes('min') || idLower.includes('coding-time') || idLower.includes('ttfc') || idLower.includes('session-length')) return 'duration_min';
  if (idLower.includes('hour') || idLower.includes('hr') || idLower.includes('day')) return 'duration_hr';
  if (idLower.includes('yield') || idLower.includes('risk-lift') || idLower.includes('volatility')) return 'ratio';
  if (idLower.includes('risk') || idLower.includes('score') || idLower.includes('fast-but-unstable')) return 'score';
  if (idLower.includes('commit') && idLower.includes('session')) return 'rate';
  if (idLower.includes('assist') && idLower.includes('session')) return 'rate';
  if (idLower.includes('deploy') && (idLower.includes('freq') || idLower.includes('velocity'))) return 'rate';
  if (idLower.includes('cycle')) return 'count';
  return 'count';
}

/**
 * Infer unit from insight ID
 */
function inferUnitFromInsightId(insightId: string): string | undefined {
  const idLower = insightId.toLowerCase();
  if (idLower.includes('commit') && idLower.includes('session')) return 'commits/session';
  if (idLower.includes('assist') && idLower.includes('session')) return 'assists/session';
  if (idLower.includes('failure-rate') || idLower.includes('revert') || idLower.includes('rework') || idLower.includes('churn') || idLower.includes('reopen') || idLower.includes('abandon') || idLower.includes('stagnation') || idLower.includes('idle') || idLower.includes('focus')) return '%';
  if (idLower.includes('cycle') && idLower.includes('review')) return 'cycles/PR';
  if (idLower.includes('cycle')) return 'cycles';
  if (idLower.includes('deploy') && (idLower.includes('freq') || idLower.includes('velocity'))) return 'deploys/week';
  if (idLower.includes('pr-size') || idLower.includes('large-pr')) return 'lines';
  if (idLower.includes('yield') || idLower.includes('risk') && idLower.includes('lift')) return '×';
  if (idLower.includes('mttr') || idLower.includes('latency') || idLower.includes('bottleneck')) return 'hr';
  if (idLower.includes('min') || idLower.includes('coding-time') || idLower.includes('session-length')) return 'min';
  if (idLower.includes('hour') || idLower.includes('hr')) return 'hr';
  return undefined;
}

/**
 * Check if insight indicates "no data" scenario
 */
function isNoDataInsight(insight: V2Row): boolean {
  const title = (insight as any).title || '';
  const subtitle = (insight as any).subtitle || '';
  const idLower = insight.id.toLowerCase();
  
  // Check for explicit "no data" indicators in title/subtitle
  if (title.includes('(no data)') || subtitle.includes('(no data)') || 
      title.includes('no data') || subtitle.includes('no data')) {
    return true;
  }
  
  // Check for specific no-data patterns
  if (idLower.includes('no-data') || idLower.includes('no_data')) {
    return true;
  }
  
  return false;
}
function extractNumericFromField(insight: V2Row, fieldNames: string[]): number | null {
  for (const fieldName of fieldNames) {
    const value = insight[fieldName as keyof V2Row];
    if (value !== undefined && value !== null && value !== '') {
      const numValue = parseFloat(String(value));
      if (!isNaN(numValue)) {
        return numValue;
      }
    }
  }
  return null;
}

/**
 * Extract numeric value from string
 */
function extractNumericFromString(str: string): number | null {
  const match = str.match(/[-+]?[0-9]*\.?[0-9]+/);
  return match ? parseFloat(match[0]) : null;
}

/**
 * Infer label from insight ID for fallback cases
 */
function inferLabelFromInsightId(insightId: string): string {
  const idLower = insightId.toLowerCase();

  // Specific patterns first (more specific → less specific)
  if (idLower.includes('idle')) return 'Idle';
  if (idLower.includes('churn')) return 'Churn';
  if (idLower.includes('rework')) return 'Rework rate';
  if (idLower.includes('revert')) return 'Revert rate';
  if (idLower.includes('failure-rate') || idLower.includes('cfr')) return 'CFR';
  if (idLower.includes('mttr')) return 'MTTR';
  if (idLower.includes('latency') || idLower.includes('spike')) return 'Latency';
  if (idLower.includes('stale') && idLower.includes('deploy')) return 'Stale deploys';
  if (idLower.includes('deploy') && idLower.includes('freq')) return 'Deploy freq';
  if (idLower.includes('deploy') && idLower.includes('velocity')) return 'Deploys/week';
  if (idLower.includes('abandon')) return 'Abandonment';
  if (idLower.includes('stagnation')) return 'Stagnation';
  if (idLower.includes('yield')) return 'Yield';
  if (idLower.includes('bottleneck')) return 'Bottleneck';
  if (idLower.includes('pr-size') || idLower.includes('large-pr')) return 'PR size';
  if (idLower.includes('reopen')) return 'Reopen rate';
  if (idLower.includes('cycle-time') || idLower.includes('cycle')) return 'Cycle time';
  if (idLower.includes('review-load') || idLower.includes('concentration')) return 'Reviewer load';
  if (idLower.includes('commit') && idLower.includes('session')) return 'Commits/session';
  if (idLower.includes('commit')) return 'Commits';
  if (idLower.includes('delivery-rate') || idLower.includes('delivery')) return 'Delivery rate';
  if (idLower.includes('session-length') || idLower.includes('session') && idLower.includes('length')) return 'Session length';
  if (idLower.includes('session')) return 'Sessions';
  if (idLower.includes('assist') || idLower.includes('ai-suggest')) return 'AI assists';
  if (idLower.includes('focus')) return 'Focus';
  if (idLower.includes('risk')) return 'Risk lift';
  if (idLower.includes('deployment')) return 'Deployment';
  if (idLower.includes('review')) return 'Review';
  if (idLower.includes('pr-')) return 'PR';

  // Fallback — use the ID as a readable label
  return insightId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
export function formatStripRightMetric(insight: V2Row): string {
  // Demo mode flag - relax gating to prevent contradictions
  const DEMO_MODE = (import.meta as any).env?.VITE_PI_DEMO_MODE === '1'
  
  // Check for "no data" scenarios first - but relax in demo mode if real values exist
  if (!DEMO_MODE && isNoDataInsight(insight)) {
    return 'Insufficient data';
  }
  
  // Use deterministic primary metric resolution
  const primaryMetric = resolvePrimaryStripMetric(insight);
  
  // Strip view may return "Insufficient data" ONLY IF:
  // resolvePrimaryStripMetric() returns null (relaxed in demo mode)
  if (primaryMetric === null && !DEMO_MODE) {
    return 'Insufficient data';
  }
  
  // Format the resolved metric with unit-aware formatting
  const formatted = formatDisplayMetric(primaryMetric);
  
  return formatted;
}

/**
 * Format DisplayMetric to string with unit-aware formatting.
 * Delegates to formatValueOnly() so the value logic is shared with
 * resolvePrimaryMetricDisplay().
 */
function formatDisplayMetric(metric: DisplayMetric): string {
  const { valueText } = formatValueOnly(metric)
  return `${metric.label}: ${valueText}`
}

/**
 * Canonical Metric Display — single source of truth for all PI views.
 *
 * Every view (Strip / Chips / Cards) MUST use this model instead of
 * doing its own value formatting, unit inference, or insufficiency checks.
 */
export interface CanonicalMetricDisplay {
  label: string              // "Commits/session", "Focus", "Active coding", etc.
  valueText: string          // Formatted value only: "3.5", "45 min", "85%", "Succeeded", "—"
  unitSuffix: string         // Standalone unit for views that render it separately: "%", "min", "", etc.
  comparisonText: string | null // "(+12% vs IDE avg)" or null
  isInsufficient: boolean    // true → valueText will be "—"
}

/**
 * Format the value portion of a DisplayMetric (without label prefix).
 * Extracts the value-formatting logic from formatDisplayMetric so both
 * the combined string and the decomposed model share one code path.
 */
function formatValueOnly(metric: DisplayMetric): { valueText: string; unitSuffix: string } {
  const { value, label, kind, unit } = metric
  
  // Demo mode flag - handle null vs zero properly
  const DEMO_MODE = (import.meta as any).env?.VITE_PI_DEMO_MODE === '1'
  
  // Null/undefined handling - return dash for truly missing data
  if (value === null || value === undefined) {
    return { valueText: '—', unitSuffix: '' }
  }

  if (kind === 'duration_min') {
    return { valueText: formatDuration(value, 'minutes'), unitSuffix: '' }
  }
  if (kind === 'duration_hr') {
    return { valueText: formatDuration(value, 'hours'), unitSuffix: '' }
  }
  if (kind === 'days_hours') {
    // Prompt 18: Use canonical formatHoursToHuman for consistent duration display
    if (unit && unit.includes('d') && unit.includes('h')) {
      return { valueText: unit, unitSuffix: '' }
    }
    // Use formatHoursToHuman for clean "Xd Yh" or "Xh Ym" format
    return { valueText: formatHoursToHuman(value), unitSuffix: '' }
  }
  if (kind === 'percent') {
    // Guard: non-zero value that rounds to 0% → show <1%
    if (value > 0 && value < 0.5) return { valueText: '<1%', unitSuffix: '' }
    return { valueText: `${Math.round(value)}%`, unitSuffix: '' }
  }
  if (kind === 'rate') {
    const labelLower = label.toLowerCase()
    const unitLower = (unit || '').toLowerCase()
    const labelContainsUnit = unitLower && (
      labelLower.includes(unitLower.split('/')[0]) ||
      labelLower.replace(/\//g, ' per ').includes(unitLower.replace(/\//g, ' per '))
    )
    if (labelContainsUnit) {
      return { valueText: value.toFixed(1), unitSuffix: '' }
    }
    // Unit embedded in valueText → unitSuffix empty
    return { valueText: unit ? `${value.toFixed(1)} ${unit}` : value.toFixed(1), unitSuffix: '' }
  }
  if (kind === 'count') {
    const labelLower = label.toLowerCase()
    const unitLower = (unit || '').toLowerCase()
    const labelContainsUnit = unitLower && labelLower.includes(unitLower.split('/')[0])
    if (labelContainsUnit) {
      return { valueText: `${Math.round(value)}`, unitSuffix: '' }
    }
    // Unit embedded in valueText → unitSuffix empty
    return { valueText: unit ? `${Math.round(value)} ${unit}` : `${Math.round(value)}`, unitSuffix: '' }
  }
  if (kind === 'score') {
    return { valueText: `${Math.round(value)}`, unitSuffix: 'pts' }
  }
  if (kind === 'ratio') {
    const labelLower = label.toLowerCase()
    const unitLower = (unit || '').toLowerCase()
    const labelContainsUnit = unitLower && labelLower.includes(unitLower.split('/')[0])
    // Guard: non-zero ratio that rounds to 0.0 → show with extra precision
    const ratioText = value > 0 && value < 0.05 ? value.toFixed(2) : value.toFixed(1)
    if (labelContainsUnit) {
      return { valueText: ratioText, unitSuffix: '' }
    }
    return { valueText: unit ? `${ratioText} ${unit}` : `${ratioText}×`, unitSuffix: '' }
  }
  if (kind === 'status') {
    const statusText = value === 1 ? 'Succeeded' : value === 0 ? 'Failed' : 'Unknown'
    return { valueText: statusText, unitSuffix: '' }
  }
  // Default — unit embedded in valueText → unitSuffix empty
  return { valueText: unit ? `${value} ${unit}` : `${value}`, unitSuffix: '' }
}

/**
 * Rescue display value from breakdownByTool winner for telemetry-competitive rows.
 *
 * When the standard resolver chain fails (returns null/zero) but the row has
 * a valid breakdownByTool with ≥2 distinct numeric IDE values, derive the
 * primary display from the winner's value formatted via formatValueOnly().
 *
 * Returns null if the row is not competitive or winner value is zero.
 */
function rescueFromBreakdownWinner(
  row: V2Row,
  spec: DisplayMetricSpec | undefined,
  fallbackLabel: string
): CanonicalMetricDisplay | null {
  const breakdown = row.breakdownByTool
  if (!breakdown || typeof breakdown !== 'object') return null

  const keys = competitiveKeys(breakdown)
  if (keys.length < 2) return null

  const numericEntries = keys
    .map(k => ({ key: k, value: extractNumericValue(String(breakdown[k])) }))
    .filter(e => !isNaN(e.value) && e.value !== 0)

  if (numericEntries.length < 1) return null

  // Need at least 2 distinct values to be competitive (not a tie)
  const distinctValues = new Set(numericEntries.map(e => e.value))
  if (distinctValues.size < 2 && numericEntries.length >= 2) return null

  // Pick winner using directionality
  const lowerBetter = isLowerBetter(row.id)
  numericEntries.sort((a, b) => lowerBetter ? a.value - b.value : b.value - a.value)

  const winnerValue = numericEntries[0].value
  const label = spec?.label || fallbackLabel
  const kind = spec?.kind || inferKindFromInsightId(row.id)
  const unit = spec?.unit

  const { valueText, unitSuffix } = formatValueOnly({ value: winnerValue, label, kind, unit })

  let comparisonText: string | null = null
  if ((row as any).displayDelta) {
    comparisonText = (row as any).displayDelta
  }

  return {
    label,
    valueText,
    unitSuffix,
    comparisonText,
    isInsufficient: false
  }
}

/**
 * Check GitHub PI metadata to determine if a zero value is legitimate
 * 
 * Uses backend metadata flags to distinguish between:
 * - has_data=false, is_computable=false: No underlying data (show insufficient signal)
 * - has_data=true, is_computable=true, value=0: Legitimate zero (show 0)
 */
function checkGitHubMetadataFlags(row: V2Row): { hasData: boolean; isComputable: boolean; value: number | null } {
  // Map row IDs to their corresponding metadata field names
  const metadataFieldMap: Record<string, string> = {
    'pr-review-cycles-by-ide': 'pr_review_cycles_metadata',
    'reviewer-load-concentration': 'reviewer_load_concentration_metadata', 
    'reopen-pressure-spike': 'reopen_pressure_spike_metadata',
    'large-pr-mix-risk': 'large_pr_mix_risk_metadata',
    'stale-deployment-signal': 'stale_deployment_signal_metadata',
    'failed-deployment-pressure': 'failed_deployment_pressure_metadata',
    'deployment-frequency-volatility-by-ide': 'deployment_frequency_volatility_metadata',
    'change-failure-rate-trend-org': 'change_failure_rate_metadata'
  }
  
  const metadataField = metadataFieldMap[row.id]
  if (!metadataField) {
    return { hasData: false, isComputable: false, value: null }
  }
  
  // Access metadata from the raw githubSnapshot (passed through from backend)
  const githubSnapshot = (row as any).githubSnapshot
  if (!githubSnapshot || !githubSnapshot[metadataField]) {
    return { hasData: false, isComputable: false, value: null }
  }
  
  const metadata = githubSnapshot[metadataField]
  return {
    hasData: metadata.has_data === true,
    isComputable: metadata.is_computable === true,
    value: metadata.value !== null ? Number(metadata.value) : null
  }
}

/**
 * Canonical resolver: single entry point for all PI views.
 *
 * Returns a CanonicalMetricDisplay that every view renders from,
 * so label/value/unit/insufficiency logic is never duplicated.
 *
 * INVARIANT: If Strip renders a non-"—" value for a row, Chips must also
 * render a non-"—" value for the same row under the same filters. Both
 * views call this function on identical objects, so parity is guaranteed
 * as long as no view applies additional suppression after this resolver.
 */
export function resolvePrimaryMetricDisplay(row: V2Row): CanonicalMetricDisplay {
  const spec = STRIP_ID_MAP[row.id]
  const fallbackLabel = spec?.label || inferLabelFromInsightId(row.id)

  // Always attempt metric resolution first — data rescue may have populated
  // displayValue/rightMetric even when insufficientSignal was set at compute time.
  let primaryMetric = resolvePrimaryStripMetric(row)

  // ══════════════════════════════════════════════════════════════════════════════
  // GitHub primaryMetric promotion (Prompt 3)
  //
  // PROBLEM: resolvePrimaryStripMetric() checks displayValue first, then rightMetric.
  // If displayValue is "0" or "0%", it returns 0 even if rightMetric has real data.
  // Example: displayValue="0%", rightMetric="3/45 PRs (7%)" → returns 0, not 7.
  //
  // FIX: For GitHub-backed rows with primaryMetric.value === 0, try to parse a
  // non-zero value from rightMetric. This mirrors Strip's implicit behavior where
  // it renders the rightMetric string directly (which shows the real value).
  //
  // ROLLBACK: Remove this block to revert to pre-fix behavior.
  // ══════════════════════════════════════════════════════════════════════════════
  if (primaryMetric !== null && primaryMetric.value === 0) {
    const provenance = getRowProvenance(row)
    const isGitHubBacked = provenance === 'github' || provenance === 'hybrid' || isGitHubBackedRow(row)

    if (isGitHubBacked && row.rightMetric) {
      // Try to get non-zero value from rightMetric
      const rightMetricValue = parseValueFromRightMetric(String(row.rightMetric), row.id)

      if (rightMetricValue !== null && !isNaN(rightMetricValue) && rightMetricValue !== 0) {
        // Promote the rightMetric value to primaryMetric
        primaryMetric = {
          ...primaryMetric,
          value: rightMetricValue
        }

        // DIAGNOSTIC: Log promotion for verification
        if ((import.meta as any)?.env?.DEV) {
          console.log('[CHIPS][GITHUB_PROMOTION]', {
            id: row.id,
            originalValue: 0,
            promotedValue: rightMetricValue,
            rightMetric: row.rightMetric,
            source: 'rightMetric promotion (Prompt 3)'
          })
        }
      }
    }
  }
  // ══════════════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════════════
  // GitHub-backed Chips override (parity with Strip view)
  //
  // RATIONALE: Strip view uses formatStripRightMetric() which ONLY checks if
  // resolvePrimaryStripMetric() returns null. It does NOT apply evidence guards.
  // Chips was suppressing valid GitHub metrics due to stricter guards below.
  //
  // RULE: If primaryMetric resolved successfully AND row is GitHub-backed,
  // immediately return the formatted value WITHOUT applying evidence guards.
  // This ensures Chips ≡ Strip for GitHub metrics.
  //
  // ROLLBACK: Remove this block to revert to pre-fix behavior.
  // ══════════════════════════════════════════════════════════════════════════════
  if (primaryMetric !== null) {
    const provenance = getRowProvenance(row)
    const isGitHubBacked = provenance === 'github' || provenance === 'hybrid' || isGitHubBackedRow(row)

    if (isGitHubBacked) {
      const { valueText, unitSuffix } = formatValueOnly(primaryMetric)

      // Resolve comparison text from V2 displayDelta
      let comparisonText: string | null = null
      if ((row as any).displayDelta) {
        comparisonText = (row as any).displayDelta
      }

      return {
        label: primaryMetric.label,
        valueText,
        unitSuffix,
        comparisonText,
        isInsufficient: false
      }
    }
  }
  // ══════════════════════════════════════════════════════════════════════════════

  // Check GitHub metadata flags for precise data availability
  const gitHubMetadata = checkGitHubMetadataFlags(row)
  
  // If insufficient signal AND resolver found no data OR rescued value is exactly 0 → "—"
  // UNLESS row is telemetry-competitive with a real non-zero winner value.
  // 🔥 FIX: Use GitHub metadata to distinguish no data vs legitimate zero
  if ((row as any).insufficientSignal === true && (primaryMetric === null || primaryMetric.value === 0)) {
    // Rescue attempt: if breakdownByTool has a real non-zero winner, use it
    if (primaryMetric === null || primaryMetric.value === 0) {
      const rescued = rescueFromBreakdownWinner(row, spec, fallbackLabel)
      if (rescued) return rescued
    }
    
    // 🔥 FIX: Check GitHub metadata for precise data availability
    if (gitHubMetadata.hasData && gitHubMetadata.isComputable && gitHubMetadata.value === 0) {
      // Backend says: data exists AND computable AND value is legitimately 0
      // Show 0 instead of insufficient signal
      const { valueText, unitSuffix } = formatValueOnly({ value: 0, label: fallbackLabel })
      return {
        label: primaryMetric?.label || fallbackLabel,
        valueText,
        unitSuffix,
        comparisonText: null,
        isInsufficient: false
      }
    }
    
    // 🔥 FIX: SOFT FALLBACK - Check if GitHub is connected and has data
  const githubSnapshot = (row as any).githubSnapshot
  const githubConnected = githubSnapshot?.github_connected === true
  const githubDataFallback = githubSnapshot?.github_data_fallback === true
  const hasCoarseSignal = (githubSnapshot?.all_commits_total ?? 0) > 0 || (githubSnapshot?.total_repositories ?? 0) > 0
    
    if ((githubConnected || githubDataFallback) && hasCoarseSignal) {
      // GitHub is connected and we have some signal, but insufficient specific data
      // Show soft fallback instead of hard "No GitHub data in window"
      let softFallbackMessage = 'Limited GitHub signal'
      
      // Map specific chips to appropriate soft fallback messages
      if (row.id.includes('pr-review') || row.id.includes('reviewer-load') || row.id.includes('large-pr-mix')) {
        softFallbackMessage = 'Insufficient PR activity'
      } else if (row.id.includes('deployment') || row.id.includes('change-failure-rate') || row.id.includes('deploy-freq')) {
        softFallbackMessage = 'Not enough deployment history'
      }
      
      return {
        label: fallbackLabel,
        valueText: softFallbackMessage,
        unitSuffix: '',
        comparisonText: null,
        isInsufficient: true
      }
    }
    
    // 🔥 FIX: Check for real GitHub data before showing "—" (fallback for non-metadata rows)
    const hasRealGitHubData = hasRealGitHubMetrics(row)
    if (hasRealGitHubData && primaryMetric !== null) {
      // We have real GitHub data, use the resolved value instead of "—"
      const { valueText, unitSuffix } = formatValueOnly(primaryMetric)
      return {
        label: primaryMetric.label,
        valueText,
        unitSuffix,
        comparisonText: null,
        isInsufficient: false
      }
    }
    
    return {
      label: fallbackLabel,
      valueText: 'No GitHub data in window',
      unitSuffix: '',
      comparisonText: null,
      isInsufficient: true
    }
  }

  // No data title AND resolver found nothing → "—"
  if (isNoDataInsight(row) && primaryMetric === null) {
    // Rescue attempt for telemetry-competitive rows
    const rescued = rescueFromBreakdownWinner(row, spec, fallbackLabel)
    if (rescued) return rescued
    
    // 🔥 FIX: Check for real GitHub data before showing "—"
    const hasRealGitHubData = hasRealGitHubMetrics(row)
    if (hasRealGitHubData) {
      // We have real GitHub data, don't show "—"
      return {
        label: fallbackLabel,
        valueText: 'Data available',
        unitSuffix: '',
        comparisonText: null,
        isInsufficient: false
      }
    }
    
    return {
      label: fallbackLabel,
      valueText: '—',
      unitSuffix: '',
      comparisonText: null,
      isInsufficient: true
    }
  }

  // Resolver found no data (but no insufficient flag) → "—"
  if (primaryMetric === null) {
    // Rescue attempt for telemetry-competitive rows
    const rescued = rescueFromBreakdownWinner(row, spec, fallbackLabel)
    if (rescued) return rescued
    
    // 🔥 FIX: Check for real GitHub data before showing "—"
    const hasRealGitHubData = hasRealGitHubMetrics(row)
    if (hasRealGitHubData) {
      // We have real GitHub data, don't show "—"
      return {
        label: fallbackLabel,
        valueText: 'Data available',
        unitSuffix: '',
        comparisonText: null,
        isInsufficient: false
      }
    }
    
    return {
      label: fallbackLabel,
      valueText: '—',
      unitSuffix: '',
      comparisonText: null,
      isInsufficient: true
    }
  }

  // Format using shared value formatter
  const { valueText, unitSuffix } = formatValueOnly(primaryMetric)

  // ── Zero-value + no-evidence guard (Prompt 9, Step 3 + Prompt 12, Step 2) ──
  // If resolved value is 0 AND the row has no evidence of real data
  // (n=0, coveragePct=0), display "—" instead of "0 min"/"0%"/"0.0×".
  // Genuine zeros (e.g., 0% reopen rate with 45 PRs) have n > 0 and pass through.
  if (primaryMetric.value === 0) {
    const evidenceCount = (row as any).n ?? (row as any).contributingUnitsCount ?? 0
    const coverage = (row as any).coveragePct ?? 0
    
    // 🔥 FIX: Check for real GitHub data before suppressing display
    const hasRealGitHubData = hasRealGitHubMetrics(row)
    
    if (evidenceCount === 0 && coverage === 0 && !hasRealGitHubData) {
      return {
        label: primaryMetric.label,
        valueText: '—',
        unitSuffix: '',
        comparisonText: null,
        isInsufficient: true
      }
    }

    // ── Prompt 12, Step 2: Strengthen "zero is real" for GitHub metrics ──
    // For GitHub-derived metrics with tiny evidence, prefer "—" over 0
    // to avoid misleading early zeros (e.g., 0 min PR cycle time from 1 PR).
    const provenance = getRowProvenance(row)
    if (provenance === 'github' || provenance === 'hybrid') {
      const unitType = (row as any).contributingUnitType || ''
      const minThreshold = getMinEvidenceThreshold(unitType, row.id)
      if (evidenceCount < minThreshold) {
        return {
          label: primaryMetric.label,
          valueText: '—',
          unitSuffix: '',
          comparisonText: null,
          isInsufficient: true
        }
      }
    }
  }

  // Resolve comparison text from V2 displayDelta
  let comparisonText: string | null = null
  if ((row as any).displayDelta) {
    comparisonText = (row as any).displayDelta
  }

  return {
    label: primaryMetric.label,
    valueText,
    unitSuffix,
    comparisonText,
    isInsufficient: false
  }
}

/**
 * 🔥 FIX: Check if row has real GitHub metrics data (not null/undefined/0)
 * This prevents valid GitHub values from being suppressed by evidence counting logic
 */
function hasRealGitHubMetrics(row: V2Row): boolean {
  // Check for real deployment metrics
  const deploymentMetrics = (row as any).deployment_metrics
  if (deploymentMetrics) {
    const failedCount = deploymentMetrics.failed_deployment_count
    const successCount = deploymentMetrics.success_deployment_count
    if ((typeof failedCount === 'number' && failedCount > 0) || 
        (typeof successCount === 'number' && successCount > 0)) {
      return true
    }
  }

  // Check for real team metrics
  const teamMetrics = (row as any).github_team_metrics
  if (teamMetrics) {
    const totalPRs = teamMetrics.total_prs
    const timeToMerge = teamMetrics.time_to_merge
    const timeToFirstReview = teamMetrics.time_to_first_review
    if ((typeof totalPRs === 'number' && totalPRs > 0) ||
        (typeof timeToMerge === 'number' && timeToMerge > 0) ||
        (typeof timeToFirstReview === 'number' && timeToFirstReview > 0)) {
      return true
    }
  }

  // Check for real PR review metrics
  const reviewMetrics = (row as any).pr_review_metrics
  if (reviewMetrics) {
    const reviewCount = reviewMetrics.pr_review_count
    if (typeof reviewCount === 'number' && reviewCount > 0) {
      return true
    }
  }

  return false
}

/**
 * GitHub-backed Chips override (parity with Strip view)
 *
 * Check if a row is GitHub-backed based on:
 * 1. Known GitHub-backed PI IDs
 * 2. Presence of GitHub-related data fields
 * 3. metricSource field
 *
 * ROLLBACK: Remove this function to revert to pre-fix behavior.
 */
function isGitHubBackedRow(row: V2Row): boolean {
  const idLower = row.id.toLowerCase()

  // Known GitHub-backed PI IDs
  const gitHubBackedIds = [
    // Review & Merge
    'pr-cycle-time', 'session-conditioned-pr-cycle-time',
    'review-latency', 'v2-first-review-latency', 'review-latency-spike',
    'pr-review-cycles', 'revert-rate', 'reopen-pressure-spike', 'reopen-rate',
    'reviewer-load-concentration', 'large-pr-mix-risk', 'branch-stagnation',
    'pr-size', 'session-conditioned-change-risk',
    // Deploy & Operate
    'deployment-frequency', 'deploy-freq', 'delivery-velocity',
    'change-failure-rate', 'cfr', 'stale-deployment',
    'failed-deployment', 'latest-deployment', 'deployment-status',
    'mttr'
  ]

  // Check if ID matches any known GitHub-backed pattern
  for (const pattern of gitHubBackedIds) {
    if (idLower.includes(pattern)) {
      return true
    }
  }

  // Check for GitHub-related data fields
  const rowAny = row as any
  if (rowAny.github_team_metrics || rowAny.deployment_metrics ||
      rowAny.pr_review_metrics || rowAny.metricSource === 'github') {
    return true
  }

  return false
}

/**
 * Resolve chip context subtitle — "Last 4 weeks • Cursor · Windsurf · VS Code"
 *
 * Rules:
 *  - Always include time window (from evidence or default "Last 4 weeks")
 *  - If row compares IDEs: list IDE names (max 3, then "Across IDEs")
 *  - If row compares AI vs Non-AI: "AI-assisted · Non-AI"
 *  - If org-wide: "Org"
 */
export function resolveChipContext(row: V2Row): string {
  // Demo mode flag - prevent contradictory context messages
  const DEMO_MODE = (import.meta as any).env?.VITE_PI_DEMO_MODE === '1'
  
  // ── No-data shortcut: if zero evidence and insufficient signal, surface clear reason ──
  const evidenceCount = (row as any).n ?? (row as any).contributingUnitsCount ?? 0
  const coverage = (row as any).coveragePct ?? 0
  
  // 🔧 STEP 3 — REMOVE "NO DATA" LANGUAGE
  // In demo mode, never show "no data" messages
  if (!DEMO_MODE && evidenceCount === 0 && coverage === 0 && (row as any).insufficientSignal === true) {
    // Use canonical provenance classifier (Prompt 12, Step 1)
    const provenance = getRowProvenance(row)
    switch (provenance) {
      case 'github': return '' // Empty string instead of "No GitHub data in window"
      case 'hybrid': return '' // Empty string instead of "No GitHub/telemetry data in window"
      case 'telemetry':
      default: return '' // Empty string instead of "No telemetry data in window"
    }
  }

  // ── Time window ──
  let timeWindow = 'Last 4 weeks'
  const evidence = (row as any).evidence
  if (Array.isArray(evidence)) {
    for (const ev of evidence) {
      const period = typeof ev === 'object' ? ev?.period : null
      if (period) { timeWindow = `Last ${period}`; break }
      const label = typeof ev === 'object' ? String(ev?.label || '') : ''
      if (label.toLowerCase().includes('time') || label.toLowerCase().includes('period')) {
        if (period) { timeWindow = `Last ${period}`; break }
      }
    }
  }

  // ── Scope ──
  const breakdown = row.breakdownByTool
  let scope = 'Org'

  if (breakdown && typeof breakdown === 'object') {
    const keys = Object.keys(breakdown).filter(k => k !== 'org')

    if (keys.length > 0) {
      // Detect AI vs Non-AI comparison
      const hasAI = keys.some(k => k.toLowerCase() === 'ai-assisted' || k.toLowerCase() === 'ai')
      const hasNonAI = keys.some(k => k.toLowerCase() === 'non-ai' || k.toLowerCase() === 'non-ai-assisted')

      if (hasAI && hasNonAI) {
        scope = 'AI-assisted · Non-AI'
      } else {
        // IDE comparison
        const IDE_NAMES: Record<string, string> = {
          cursor: 'Cursor', windsurf: 'Windsurf', vscode: 'VS Code',
          jetbrains: 'JetBrains', 'vs code': 'VS Code'
        }
        const ideNames = keys.map(k => IDE_NAMES[k.toLowerCase()] || k)

        if (ideNames.length > 3) {
          scope = 'Across IDEs'
        } else {
          scope = ideNames.join(' · ')
        }
      }
    }
  } else if ((row as any).tools && Array.isArray((row as any).tools) && (row as any).tools.length > 0) {
    const IDE_NAMES: Record<string, string> = {
      cursor: 'Cursor', windsurf: 'Windsurf', vscode: 'VS Code',
      jetbrains: 'JetBrains'
    }
    const names = ((row as any).tools as string[]).map(t => IDE_NAMES[t.toLowerCase()] || t)
    scope = names.length > 3 ? 'Across IDEs' : names.join(' · ')
  }

  // STEP 4: Make headlines punchier - shorter, faster format
  if (scope.includes('vs ')) {
    // Convert "Cursor leads in commits per session (+15% vs VS Code)"
    // TO: "Cursor +15% commits/session vs VS Code"
    const parts = scope.split('vs ')
    if (parts.length === 2) {
      const winner = parts[0].trim()
      const loser = parts[1].trim()
      const deltaMatch = loser.match(/([+-]\d+%)/)
      if (deltaMatch) {
        // Extract metric type from context if available
        let metricShort = ''
        const rowAny = row as any
        if (rowAny.titleShort) {
          // Shorten common metric names
          if (rowAny.titleShort.toLowerCase().includes('commits per session')) {
            metricShort = 'commits/session'
          } else if (rowAny.titleShort.toLowerCase().includes('active coding')) {
            metricShort = 'active coding'
          } else if (rowAny.titleShort.toLowerCase().includes('session length')) {
            metricShort = 'session length'
          } else if (rowAny.titleShort.toLowerCase().includes('ai suggestions')) {
            metricShort = 'AI suggestions'
          }
        }
        
        const cleanLoser = loser.replace(/([+-]\d+%)/, '').trim()
        return metricShort ? 
          `${winner} ${deltaMatch[1]} ${metricShort} vs ${cleanLoser}` :
          `${winner} ${deltaMatch[1]} vs ${cleanLoser}`
      }
    }
  }
  
  return `${timeWindow} · ${scope}`
}

/**
 * Shared directionality helper: returns true when lower metric values indicate
 * better performance (e.g. cycle time, failure rate, churn).
 */
function isLowerBetter(id: string): boolean {
  const s = id.toLowerCase()
  return s.includes('time-to-first-commit') || s.includes('cycle-time') ||
    s.includes('mttr') || s.includes('rework') || s.includes('latency') ||
    s.includes('revert') || s.includes('reopen') || s.includes('abandon') ||
    s.includes('stagnation') || s.includes('failure-rate') || s.includes('cfr') ||
    s.includes('churn') || s.includes('bottleneck') || s.includes('idle') ||
    s.includes('risk') || s.includes('volatility') || s.includes('review-cycles') ||
    s.includes('pr-size') || s.includes('unstable')
}

/**
 * Metric IDs that are primarily GitHub/Actions-derived (not IDE telemetry).
 * Used to show correct "No GitHub data" vs "No telemetry data" context lines.
 */
const GITHUB_DERIVED_IDS = new Set([
  'pr-cycle-time-by-ide',
  'session-conditioned-pr-cycle-time-ai-vs-non-ai',
  'review-latency-spike-by-ide',
  'reopen-pressure-spike',
  'large-pr-mix-risk',
  'deployment-frequency-volatility-by-ide',
  'change-failure-rate-spike-by-ide',
  'change-failure-rate-trend-org',
  'change-failure-rate-trend-by-ide',
  'revert-rate-by-ide',
  'failed-deployment-pressure',
  'stale-deployment-signal',  // Prompt 15: GitHub-only deployment metric
  'latest-deployment-unhealthy',  // Prompt 16: GitHub-only deployment metric
  'session-conditioned-change-failure-risk-ai-vs-non-ai',
  'fast-but-unstable-org',
  'pr-size-by-ide',
  'pr-review-cycles-by-ide',
])

/**
 * Signal patterns in primarySignalsUsed that indicate GitHub data source.
 */
const GITHUB_SIGNAL_PATTERNS = [
  'github', 'pr_', 'deployment', 'change_failure', 'cfr', 'reopen', 'revert'
]

/**
 * Canonical provenance classifier (Prompt 12, Step 1).
 *
 * Returns 'github' | 'telemetry' | 'hybrid' based on the row's data source.
 * Used by resolveChipContext to show correct "No data" messages.
 *
 * Priority:
 *  1. primarySignalsUsed field (most reliable)
 *  2. GITHUB_DERIVED_IDS lookup (fallback for well-known IDs)
 *  3. ID heuristics as last resort
 */
export type RowProvenance = 'github' | 'telemetry' | 'hybrid'

export function getRowProvenance(row: V2Row): RowProvenance {
  const signals = (row as any).primarySignalsUsed

  // Priority 1: Check primarySignalsUsed array
  if (Array.isArray(signals) && signals.length > 0) {
    const hasGitHub = signals.some((s: string) =>
      GITHUB_SIGNAL_PATTERNS.some(pat => s.toLowerCase().includes(pat))
    )
    const hasTelemetry = signals.some((s: string) =>
      s.toLowerCase().includes('session') ||
      s.toLowerCase().includes('telemetry') ||
      s === 'sessions'
    )

    if (hasGitHub && hasTelemetry) return 'hybrid'
    if (hasGitHub) return 'github'
    if (hasTelemetry) return 'telemetry'
  }

  // Priority 2: Check well-known GitHub-derived IDs
  if (GITHUB_DERIVED_IDS.has(row.id)) {
    return 'github'
  }

  // Priority 3: ID heuristics
  const idLower = row.id.toLowerCase()
  const isGitHubId = idLower.includes('pr-') || idLower.includes('deploy') ||
    idLower.includes('change-failure') || idLower.includes('cfr') ||
    idLower.includes('reopen') || idLower.includes('revert') ||
    idLower.includes('review-latency') || idLower.includes('review-cycles')

  if (isGitHubId) return 'github'

  // Default: telemetry (IDE session-based)
  return 'telemetry'
}

/**
 * Minimum evidence threshold for "zero is real" validation (Prompt 12, Step 2).
 *
 * For GitHub-derived metrics, we require a minimum sample size before
 * displaying "0" as a real value. This prevents misleading early zeros
 * like "0 min PR cycle time" from 1 PR or "0% CFR" from 2 deployments.
 *
 * @param unitType - The contributingUnitType (e.g., 'prs', 'deployments', 'periods')
 * @param id - The metric ID for ID-specific overrides
 */
function getMinEvidenceThreshold(unitType: string, id: string): number {
  const u = unitType.toLowerCase()
  const idLower = id.toLowerCase()

  // PR-based metrics: need at least 3 PRs for meaningful zero
  if (u === 'prs' || idLower.includes('pr-') || idLower.includes('reopen')) {
    return 3
  }

  // Deployment-based metrics: need at least 2 deployments
  if (u === 'deployments' || idLower.includes('deploy') || idLower.includes('cfr') || idLower.includes('change-failure')) {
    return 2
  }

  // Period-based metrics (weekly aggregates): need at least 2 periods
  if (u === 'periods') {
    return 2
  }

  // Default: at least 1 unit of evidence
  return 1
}

/**
 * Keys to ignore in competitive comparisons — not real IDE/entity names.
 */
const IGNORED_BREAKDOWN_KEYS = new Set(['org', 'unknown', 'empty', 'null', ''])

/**
 * Filter breakdownByTool keys to only IDE/entity names (exclude org, unknown, etc.).
 */
function competitiveKeys(breakdown: Record<string, string>): string[] {
  return Object.keys(breakdown).filter(k => !IGNORED_BREAKDOWN_KEYS.has(k.toLowerCase().trim()))
}

/**
 * Placeholder strings that should be treated as "no data", not as values.
 */
const NO_DATA_PATTERNS = /^(—|–|-|--|no\s+data|insufficient|n\/a|null|undefined)$/i

/**
 * Canonical IDE breakdown parser (Prompt 10, Step 0).
 *
 * Parses breakdownByTool into an array of { ide, value } entries where value
 * is a clean numeric. Handles:
 *  - "—", null, undefined, NaN, empty, "Insufficient…", "No data…" → skipped
 *  - "7%"  → 7
 *  - "11 min" → 11  |  "2h" → 120  |  "0.3h" → 18  |  "1d 3h" → 1620
 *  - "0.3x" / "0.3 CV" → 0.3
 *  - Plain numeric "42", "3.5 days" → extracted number
 */
export interface IdeBreakdownEntry { ide: string; value: number }

export function parseIdeBreakdown(row: V2Row): IdeBreakdownEntry[] {
  const breakdown = row.breakdownByTool
  if (!breakdown || typeof breakdown !== 'object') return []

  const keys = competitiveKeys(breakdown)
  const result: IdeBreakdownEntry[] = []

  for (const key of keys) {
    const raw = String(breakdown[key] ?? '').trim()
    if (!raw || NO_DATA_PATTERNS.test(raw)) continue

    const parsed = parseBreakdownValue(raw)
    if (parsed !== null && Number.isFinite(parsed)) {
      result.push({ ide: key, value: parsed })
    }
  }

  return result
}

/**
 * Canonical breakdown integrity guard (Prompt 13, Step 0 + Prompt 14, Step 2).
 *
 * Returns true only when the IDE breakdown is independently computed per-IDE,
 * NOT copied/smeared from a single org-wide value.
 *
 * Rules:
 *  - Requires ≥2 parsed IDE entries (via parseIdeBreakdown)
 *  - Requires evidence: n > 0 OR coveragePct > 0
 *  - For TELEMETRY/HYBRID provenance: trust breakdown if evidence exists
 *    (displayValue is the winner's value, not org-wide; no smear check needed)
 *  - For GITHUB provenance: apply org-value smear check (GitHub data often
 *    copies org-wide value across all IDE keys without per-IDE computation)
 *
 * Used to prevent "NO IDE DIFFERENCE" from appearing for smeared org-level data
 * while ensuring telemetry PIs with valid breakdown show winner headers.
 */
export function hasIndependentIdeBreakdown(row: V2Row): boolean {
  const entries = parseIdeBreakdown(row)
  if (entries.length < 2) return false

  // Require evidence
  const evidenceCount = (row as any).n ?? (row as any).contributingUnitsCount ?? 0
  const coverage = (row as any).coveragePct ?? 0
  if (evidenceCount === 0 && coverage === 0) return false

  // Check provenance to determine smear detection strategy
  const provenance = getRowProvenance(row)

  // Prompt 14, Step 2: For telemetry/hybrid rows, trust breakdown when evidence exists.
  // Telemetry rows compute per-IDE values from session data; displayValue is the
  // winner's value (not org-wide), so org-value smear check would incorrectly
  // reject valid competitive breakdowns.
  if (provenance === 'telemetry' || provenance === 'hybrid') {
    // Telemetry with evidence + ≥2 entries = independent by definition
    return true
  }

  // For GitHub provenance: apply smear detection
  // GitHub metrics without per-IDE telemetry join often copy org-wide value
  // across all IDE keys, which is not a real breakdown.

  // First check: if all IDE values are identical, it's likely a smear
  const firstValue = entries[0].value
  const allIdentical = entries.every(e => Math.abs(e.value - firstValue) < 1e-6)
  if (allIdentical) {
    // Pure GitHub with identical IDE values = smeared org-level data
    return false
  }

  // Second check: if all IDE values equal the org-wide displayValue/rightMetric
  const orgValue = extractOrgWideValue(row)
  if (orgValue !== null) {
    const eps = 1e-6
    const allMatchOrg = entries.every(e => Math.abs(e.value - orgValue) < eps)
    if (allMatchOrg) {
      return false
    }
  }

  return true
}

/**
 * Extract the org-wide numeric value from displayValue or rightMetric.
 * Used to detect smearing where IDE breakdown equals org value.
 */
function extractOrgWideValue(row: V2Row): number | null {
  // Try displayValue first
  const displayValue = (row as any).displayValue
  if (displayValue !== undefined && displayValue !== null) {
    const parsed = typeof displayValue === 'number' ? displayValue : extractNumericValue(String(displayValue))
    if (!isNaN(parsed)) return parsed
  }

  // Try rightMetric
  const rightMetric = row.rightMetric
  if (rightMetric && typeof rightMetric === 'string') {
    // Skip placeholder values
    if (NO_DATA_PATTERNS.test(rightMetric)) return null
    const parsed = extractNumericValue(rightMetric)
    if (!isNaN(parsed)) return parsed
  }

  // Try breakdownByTool.org
  const breakdown = row.breakdownByTool
  if (breakdown && breakdown.org) {
    const parsed = extractNumericValue(String(breakdown.org))
    if (!isNaN(parsed)) return parsed
  }

  return null
}

/**
 * Parse a single breakdown value string into a canonical number.
 * Returns null if the string is not parseable as a meaningful numeric value.
 */
function parseBreakdownValue(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null

  // Duration: "1d 3h 15m" / "2d" / "3h 10m" / "45m" / "11 min" / "2h" / "0.3h"
  const durDHM = s.match(/(?:(\d+(?:\.\d+)?)\s*d)?\s*(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in)?)?/i)
  if (durDHM && (durDHM[1] || durDHM[2] || durDHM[3])) {
    const d = parseFloat(durDHM[1] || '0')
    const h = parseFloat(durDHM[2] || '0')
    const m = parseFloat(durDHM[3] || '0')
    const totalMin = d * 1440 + h * 60 + m
    // Only accept if the match covers the bulk of the string (not a stray digit)
    if (totalMin > 0 || (d === 0 && h === 0 && m === 0)) return totalMin
  }

  // Duration with unit word: "2.3 days", "5.1 hours", "11 minutes"
  const durWord = s.match(/([-+]?\d+(?:\.\d+)?)\s*(days?|hours?|hrs?|minutes?|mins?)$/i)
  if (durWord) {
    const v = parseFloat(durWord[1])
    const u = durWord[2].toLowerCase()
    if (u.startsWith('day')) return v * 1440
    if (u.startsWith('hour') || u.startsWith('hr')) return v * 60
    return v // minutes
  }

  // Percent: "7%", "33.3%"
  const pct = s.match(/([-+]?\d+(?:\.\d+)?)\s*%/)
  if (pct) return parseFloat(pct[1])

  // Ratio/CV: "0.3x", "0.45 CV"
  const ratio = s.match(/([-+]?\d+(?:\.\d+)?)\s*(?:×|x|CV)/i)
  if (ratio) return parseFloat(ratio[1])

  // Plain numeric (possibly with trailing unit text we ignore): "42", "3.5 commits/session"
  const num = s.match(/^([-+]?\d+(?:\.\d+)?)/)
  if (num) return parseFloat(num[1])

  return null
}

/**
 * Returns true when the parsed IDE breakdown represents a real tie:
 *  - hasIndependentIdeBreakdown(row) is true (Prompt 13, Step 1)
 *  - ≥2 IDE entries survive parsing
 *  - All parsed numbers are equal within epsilon
 *  - Evidence exists (n > 0 OR coveragePct > 0) — not an empty-window artifact
 *
 * Returns false for smeared org-wide values or placeholder equality.
 */
export function isRealTie(row: V2Row): boolean {
  // Prompt 13, Step 1: Require independent IDE breakdown (not smeared org values)
  if (!hasIndependentIdeBreakdown(row)) {
    return false
  }

  const entries = parseIdeBreakdown(row)
  if (entries.length < 2) return false

  const evidenceCount = (row as any).n ?? (row as any).contributingUnitsCount ?? 0
  const coverage = (row as any).coveragePct ?? 0
  if (evidenceCount === 0 && coverage === 0) return false

  const eps = 1e-6
  const first = entries[0].value
  return entries.every(e => Math.abs(e.value - first) < eps)
}

/**
 * Canonical single-source-of-truth: is this row a telemetry-competitive row?
 *
 * True when breakdownByTool has ≥2 IDE/entity keys with distinct numeric values.
 * Used by: winner header, runner-up delta, breakdown rescue, parity audit.
 */
export function isTelemetryCompetitiveRow(row: V2Row): boolean {
  return isCompetitiveRow(row)
}

/**
 * Determine if a V2 row is competitive (IDE comparison with ≥2 distinct values).
 *
 * Returns true only when:
 *  - ≥2 IDE keys survive parseIdeBreakdown (valid numeric, not placeholder)
 *  - The parsed values are NOT all equal (not a tie)
 *
 * Returns false for: org-wide rows, < 2 valid IDE entries, real ties, missing data.
 */
export function isCompetitiveRow(row: V2Row): boolean {
  const entries = parseIdeBreakdown(row)
  if (entries.length < 2) return false

  // Real tie → not competitive (no winner to pick)
  const eps = 1e-6
  const first = entries[0].value
  if (entries.every(e => Math.abs(e.value - first) < eps)) return false

  // DEV-only diagnostic: log rows that look like ties but have invalid/missing IDE breakdown
  if ((import.meta as any)?.env?.DEV) {
    const breakdown = row.breakdownByTool
    if (breakdown) {
      const allKeys = competitiveKeys(breakdown)
      const invalidCount = allKeys.length - entries.length
      if (invalidCount > 0) {
        console.log(`[TIE_DIAG] ${row.id}`, {
          rawBreakdown: breakdown,
          parsedEntries: entries,
          skippedKeys: allKeys.filter(k => !entries.some(e => e.ide === k)),
          n: (row as any).n ?? null,
          coveragePct: (row as any).coveragePct ?? null,
        })
      }
    }
  }

  return true
}

/**
 * Winner entity for competitive (multi-IDE or AI vs Non-AI) rows.
 */
export interface WinnerEntity {
  name: string       // "Cursor", "Windsurf", "AI-assisted", etc.
  valueText: string  // Formatted winner value: "11 min", "3.5", "85%"
}

/**
 * Resolve winner entity from a competitive V2 row.
 *
 * Uses breakdownByTool (same data buildActionableTitle uses for Strip titles).
 * Returns null for org-wide rows, ties, or rows without breakdown data.
 */
export function resolveWinnerEntity(row: V2Row): WinnerEntity | null {
  if (!isCompetitiveRow(row)) return null

  const breakdown = row.breakdownByTool!
  const keys = competitiveKeys(breakdown)

  const lowerIsBetter = isLowerBetter(row.id)

  const IDE_NAMES: Record<string, string> = {
    cursor: 'Cursor', windsurf: 'Windsurf', vscode: 'VS Code',
    jetbrains: 'JetBrains', 'vs code': 'VS Code',
    'ai-assisted': 'AI-assisted', 'non-ai': 'Non-AI',
    ai: 'AI-assisted', 'non-ai-assisted': 'Non-AI'
  }

  const entries = keys.map(k => ({
    key: k,
    name: IDE_NAMES[k.toLowerCase()] || k,
    value: extractNumericValue(String(breakdown[k]))
  })).filter(e => !isNaN(e.value))

  if (entries.length < 2) return null

  entries.sort((a, b) => lowerIsBetter ? a.value - b.value : b.value - a.value)

  // Format the winner's value using the row's canonical spec
  const spec = STRIP_ID_MAP[row.id]
  let valueText: string
  if (spec) {
    const { valueText: vt } = formatValueOnly({
      value: entries[0].value,
      label: spec.label,
      kind: spec.kind,
      unit: spec.unit
    })
    valueText = vt
  } else {
    valueText = String(entries[0].value)
  }

  return {
    name: entries[0].name,
    valueText
  }
}

/**
 * Runner-up delta for competitive rows.
 */
export interface RunnerUpDelta {
  text: string            // "vs Cursor: +4 min", "vs VS Code: +12 pp"
  runnerUpName: string    // "Cursor", "VS Code", "Non-AI", etc.
  deltaText: string       // "+4 min", "+12 pp", "+0.2x"
  deltaValue: number      // Raw numeric delta (absolute)
}

/**
 * Resolve runner-up delta for competitive V2 rows.
 *
 * Computes the gap between winner (#1) and runner-up (#2), formatted using
 * the same canonical unit rules as formatValueOnly.
 */
export function resolveRunnerUpDelta(row: V2Row): RunnerUpDelta | null {
  if (!isCompetitiveRow(row)) return null

  const breakdown = row.breakdownByTool!
  const keys = competitiveKeys(breakdown)

  const lowerIsBetter = isLowerBetter(row.id)

  const IDE_NAMES: Record<string, string> = {
    cursor: 'Cursor', windsurf: 'Windsurf', vscode: 'VS Code',
    jetbrains: 'JetBrains', 'vs code': 'VS Code',
    'ai-assisted': 'AI-assisted', 'non-ai': 'Non-AI',
    ai: 'AI-assisted', 'non-ai-assisted': 'Non-AI'
  }

  const entries = keys.map(k => ({
    key: k,
    name: IDE_NAMES[k.toLowerCase()] || k,
    value: extractNumericValue(String(breakdown[k]))
  })).filter(e => !isNaN(e.value))

  if (entries.length < 2) return null

  entries.sort((a, b) => lowerIsBetter ? a.value - b.value : b.value - a.value)

  const winner = entries[0].value
  const runnerUp = entries[1]
  const rawDelta = Math.abs(winner - runnerUp.value)

  if (rawDelta === 0) return null

  // Use the row's STRIP_ID_MAP spec to format the delta with the correct unit
  const spec = STRIP_ID_MAP[row.id]
  const kind = spec?.kind
  const unit = spec?.unit
  let deltaText: string

  if (kind === 'percent') {
    // Calculate percentage difference relative to runner-up value
    const runnerUpValue = runnerUp.value
    const percentDiff = runnerUpValue > 0 ? (rawDelta / runnerUpValue) * 100 : 0
    deltaText = `+${percentDiff.toFixed(1)}%`
  } else if (kind === 'duration_min') {
    deltaText = rawDelta < 60 ? `+${Math.round(rawDelta)} min` : `+${(rawDelta / 60).toFixed(1)}h`
  } else if (kind === 'duration_hr') {
    deltaText = rawDelta < 1 ? `+${Math.round(rawDelta * 60)} min` : `+${rawDelta.toFixed(1)}h`
  } else if (kind === 'rate') {
    deltaText = unit ? `+${rawDelta.toFixed(1)} ${unit}` : `+${rawDelta.toFixed(1)}`
  } else if (kind === 'ratio') {
    deltaText = `+${rawDelta.toFixed(1)}x`
  } else if (kind === 'count') {
    deltaText = unit ? `+${Math.round(rawDelta)} ${unit}` : `+${Math.round(rawDelta)}`
  } else if (kind === 'score') {
    deltaText = `+${Math.round(rawDelta)} pts`
  } else {
    deltaText = `+${rawDelta.toFixed(1)}`
  }

  return {
    text: `vs ${runnerUp.name}: ${deltaText}`,
    runnerUpName: runnerUp.name,
    deltaText,
    deltaValue: rawDelta
  }
}

/**
 * Format value with unit based on PI type and context
 */
function formatValueWithUnit(value: number, unit: string, insightId: string): string {
  // Rule 4: Unit + Label rules
  const idLower = insightId.toLowerCase();
  
  // Handle time values (Rule 5)
  if (unit.includes('hour') || idLower.includes('hour') || idLower.includes('time')) {
    return formatDuration(value, 'hours');
  }
  if (unit.includes('min') || unit.includes('minute') || idLower.includes('min')) {
    return formatDuration(value, 'minutes');
  }
  
  // Handle percentages
  if (unit.includes('%') || idLower.includes('focus') || idLower.includes('concentration')) {
    return `Focus: ${Math.round(value)}%`;
  }
  
  // Handle sessions
  if (unit.includes('session') || idLower.includes('session')) {
    return `${Math.round(value)} sessions`;
  }
  
  // Handle commits
  if (unit.includes('commit') || idLower.includes('commit')) {
    return `${value.toFixed(1)} commits/session`;
  }
  
  // Handle assists
  if (unit.includes('assist') || idLower.includes('assist') || idLower.includes('ai')) {
    return `${value.toFixed(1)} assists/session`;
  }
  
  // Handle cycles - PRESERVE ZERO as valid
  if (unit.includes('cycle') || idLower.includes('cycle')) {
    return `${Math.round(value)} cycles`;
  }
  
  // Handle lines
  if (unit.includes('line') || idLower.includes('pr-size')) {
    return `${Math.round(value)} lines`;
  }
  
  // Handle review concentration (not focus)
  if (idLower.includes('review-load') || idLower.includes('concentration')) {
    return `Concentration: ${Math.round(value)}%`;
  }
  
  // Handle risk scores - PRESERVE ZERO as valid
  if (idLower.includes('risk') || idLower.includes('lag')) {
    return `Risk score: ${Math.round(value)}`;
  }
  
  // Handle boolean-like success/failure
  if (value === 1 && idLower.includes('succeeded')) {
    return 'Succeeded';
  }
  if (value === 0 && idLower.includes('failed')) {
    return 'Failed';
  }
  
  // Default with unit if available
  if (unit) {
    return `${value} ${unit}`;
  }
  
  // Last resort — use insight ID to derive a meaningful label, include value
  const label = inferLabelFromInsightId(insightId);
  return `${label}: ${value}`;
}

/**
 * Format duration with human-readable format (Rule 5)
 */
function formatDuration(value: number, unit: 'minutes' | 'hours'): string {
  if (unit === 'minutes') {
    if (value > 0 && value < 0.5) {
      return '<1 min';
    }
    if (value < 60) {
      return `${Math.round(value)} min`;
    }
    // Convert minutes to hours
    const hours = Math.floor(value / 60);
    const minutes = Math.round(value % 60);
    
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      if (remainingHours > 0 && minutes > 0) {
        return `${days}d ${remainingHours}h ${minutes}m`;
      } else if (remainingHours > 0) {
        return `${days}d ${remainingHours}h`;
      } else if (minutes > 0) {
        return `${days}d ${minutes}m`;
      } else {
        return `${days}d`;
      }
    }
    
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  
  if (unit === 'hours') {
    // Prompt 18: Use formatHoursToHuman for consistent duration display
    return formatHoursToHuman(value);
  }
  
  return `${value} ${unit}`;
}

/**
 * Extract known metric from insight payload
 */
function extractKnownMetric(insight: V2Row): string | null {
  // Look for common metric fields in the insight
  const metricFields = ['metricValue', 'value', 'primaryMetric'];
  
  for (const field of metricFields) {
    if (insight[field as keyof V2Row] !== undefined) {
      const value = parseFloat(String(insight[field as keyof V2Row]));
      if (!isNaN(value)) {
        return formatValueWithUnit(value, '', insight.id);
      }
    }
  }
  
  return null;
}

/**
 * Extract value from evidence array
 */
function extractEvidenceValue(insight: V2Row): string | null {
  const evidence = insight.evidence as Array<{ label: string; value: any }>;
  if (!evidence || !Array.isArray(evidence)) return null;
  
  // Look for "Value" row or primary metric
  const valueRow = evidence.find(ev => 
    ev.label?.toLowerCase().includes('value') ||
    ev.label?.toLowerCase().includes('metric') ||
    ev.label?.toLowerCase().includes('total')
  );
  
  if (valueRow && valueRow.value !== undefined) {
    const numValue = parseFloat(String(valueRow.value));
    if (!isNaN(numValue)) {
      return formatValueWithUnit(numValue, '', insight.id);
    }
  }
  
  return null;
}

/**
 * Fix naked numbers with context inference
 */
function formatNakedNumberWithInference(value: number, insight: V2Row): string {
  const idLower = insight.id.toLowerCase();
  
  // Infer unit from insight ID
  if (idLower.includes('focus') || idLower.includes('concentration')) {
    return `Focus: ${Math.round(value)}%`;
  }
  if (idLower.includes('session') && !idLower.includes('length')) {
    return `${Math.round(value)} sessions`;
  }
  if (idLower.includes('min') || idLower.includes('time') || idLower.includes('length')) {
    return formatDuration(value, 'minutes');
  }
  if (idLower.includes('hour')) {
    return formatDuration(value, 'hours');
  }
  if (idLower.includes('commit')) {
    return `${value.toFixed(1)} commits/session`;
  }
  if (idLower.includes('assist') || idLower.includes('ai')) {
    return `${value.toFixed(1)} assists/session`;
  }
  if (idLower.includes('cycle')) {
    return `${Math.round(value)} cycles`;
  }
  if (idLower.includes('risk')) {
    return `Risk score: ${Math.round(value)}`;
  }
  
  // Last resort — derive label from insight ID
  const label = inferLabelFromInsightId(insight.id);
  return `${label}: ${value}`;
}
export function formatCollapsedRow(row: V2Row): CollapsedRowPresentation {
  // Check for non-meaningful values (all zeros or identical placeholders)
  const hasIdentical = hasIdenticalValues(row.breakdownByTool)
  const hasAllZeros = hasAllZeroValues(row.breakdownByTool)
  
  // If all zeros or identical (except for intentional org-level single values)
  const isOrgLevel = !row.breakdownByTool || 
                     Object.keys(row.breakdownByTool).length === 0 ||
                     (Object.keys(row.breakdownByTool).length === 1 && Object.keys(row.breakdownByTool)[0] === 'org')
  
  const shouldHideCollapsed = !isOrgLevel && (hasIdentical || hasAllZeros)
  
  // Build actionable title
  const title = buildActionableTitle(row)
  
  // Keep technical subtitle
  const subtitle = row.subtitle
  
  // USE CANONICAL FORMATTER for strip right metric
  const rightMetric = formatStripRightMetric(row);
  
  // Build trust badges
  const trustBadges = buildTrustBadges(row)
  
  // Build coverage callout
  const callout = buildCoverageCallout(row)
  
  const result = {
    shouldCollapse: !shouldHideCollapsed,
    title,
    subtitle,
    rightMetric,
    trustBadges,
    callout
  }
  
  return result
}
