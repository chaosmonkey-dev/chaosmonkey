import type { PerformanceInsight } from '../../lib/insights/types'
import { getToolLabel } from '../../lib/insights/labels'

// Helper function to properly capitalize IDE names
function formatIDEName(ideName: string): string {
  if (!ideName) return ideName
  
  const name = ideName.toLowerCase().trim()
  
  // Specific IDE name mappings
  const ideMappings: Record<string, string> = {
    'vscode': 'VS Code',
    'vs code': 'VS Code', 
    'visual studio code': 'VS Code',
    'windsurf': 'Windsurf',
    'cursor': 'Cursor',
    'intellij': 'IntelliJ',
    'intellij idea': 'IntelliJ IDEA',
    'pycharm': 'PyCharm',
    'webstorm': 'WebStorm',
    'vim': 'Vim',
    'emacs': 'Emacs',
    'sublime': 'Sublime Text',
    'atom': 'Atom'
  }
  
  return ideMappings[name] || ideName
}

// Normalize evidence labels for strip rows (compact) - expanded view will expand these
export function normalizeEvidenceLabel(label?: string | null, expanded?: boolean): string {
  const raw = String(label ?? '').trim()
  if (!raw) return ''
  const key = raw.toLowerCase()
  
  // Remove redundant scope labels like "(org)"
  let cleaned = raw.replace(/\s*\(org\)\s*/gi, '').trim()
  
  const exact: Record<string, string> = {
    'mean coding min/period': 'Avg coding per period',
    'avg session min': 'Avg session',
    'avg session minutes': 'Avg session',
    'total open issues': 'Open issues',
    'total open issues (org)': 'Open issues'
  }
  if (exact[key]) {
    cleaned = exact[key]
  } else if (key === 'tools tracked') {
    cleaned = 'IDEs tracked'
  } else if (key.includes('std') || key.includes('standard deviation') || key.includes('stdev')) {
    // Expanded view should show full form
    cleaned = expanded ? 'Standard deviation' : 'StDev'
  } else if (key.includes('cfr') || key.includes('change failure rate')) {
    // Expanded view should show full form
    cleaned = expanded ? 'Change failure rate' : 'CFR'
  } else if (key.includes('weeks in band') || (key.includes('weeks') && key.includes('band'))) {
    // Replace "Weeks in band: 2" with "Time range" in expanded view
    cleaned = expanded ? 'Time range' : 'Time range'
  } else if (key === 'periods' || (key.includes('period') && !key.includes('week'))) {
    // Remove "Periods" from strip - use "Time range" instead
    cleaned = expanded ? 'Time range' : 'Time range'
  } else if (key.includes('points') || key.includes('samples') || key.includes('points analyzed')) {
    cleaned = 'Points'
  } else if (key.includes('assists/min') || key.includes('assists per min') || key.includes('assists per minute')) {
    cleaned = 'AI assists/min'
  }
  
  return cleaned
}

// Remove duplicate leading prefixes like "VS Code VS Code" or repeated single-word tokens.
function dedupeLeadingPrefix(title: string): string {
  if (!title) return title
  const t = title.trim()
  // Check repeated groups of 3,2,1 words
  const words = t.split(/\s+/)
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const first = words.slice(0, n).join(' ').toLowerCase()
    const next = words.slice(n, n * 2).join(' ').toLowerCase()
    if (next && first === next) {
      // remove the duplicated next segment
      return words.slice(0, n).concat(words.slice(n * 2)).join(' ').replace(/\s{2,}/g, ' ').trim()
    }
  }
  // Also collapse accidental "AI AI" or repeated single token
  const singleDup = t.match(/^(\S+)(\s+\1\b)+/i)
  if (singleDup) return singleDup[1] + t.slice(singleDup[0].length)
  return t
}

function getEvidenceValue(insight: PerformanceInsight, label: string): string | null {
  const needle = label.toLowerCase()
  const ev = (insight.evidence || []).find(e => String(e.label || '').trim().toLowerCase() === needle)
  if (!ev) return null
  const raw = ev.value
  if (raw === undefined || raw === null) return null
  return String(raw)
}

function parseNumericEvidence(insight: PerformanceInsight, labelIncludes: string): number | null {
  const needle = labelIncludes.toLowerCase()
  const ev = (insight.evidence || []).find(e => (e.label || '').toLowerCase().includes(needle))
  if (!ev) return null
  const raw = ev.value
  if (typeof raw === 'number' && isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return null
    const pct = s.endsWith('%') ? s.slice(0, -1) : s
    if (isFinite(Number(pct))) return Number(pct)
  }
  return null
}

function formatAssistsPerMin(value: any): string | null {
  if (value === undefined || value === null) return null
  const num = (typeof value === 'number') ? value : (typeof value === 'string' && value.trim() !== '' && isFinite(Number(value)) ? Number(value) : null)
  if (num === null) return null
  // Show up to 2 decimals for assists/min and ensure 1 is shown as 1.00 if not exact integer
  return num % 1 === 0 ? num.toFixed(2) : num.toFixed(2)
}

function computeSessionLengthDeltaPct(insight: PerformanceInsight): number | null {
  const current = parseNumericEvidence(insight, 'avg session')
  const baseline = parseNumericEvidence(insight, 'baseline')
  if (!current || !baseline || baseline <= 0) return null
  return ((current - baseline) / baseline) * 100
}

function stripDebugLanguage(s: string): string {
  return s
    .replace(/\s*[—-]\s*tool context below\s*$/i, '')
    .replace(/\s*\(directional\)\s*$/i, '')
    .trim()
}

function removeHedgingInTitle(s: string): string {
  return s
    .replace(/\bmay\b/gi, '')
    .replace(/\bmight\b/gi, '')
    .replace(/\bpotentially\b/gi, '')
    .replace(/\bpossibly\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function ensureScopePrefix(insight: PerformanceInsight, title: string): string {
  const tools = insight.related?.tools || []
  const tool = tools.length === 1 ? getToolLabel(tools[0]) : null
  const repos = insight.related?.repos || []
  const repo = repos.length === 1 ? repos[0] : null
  let t = String(title || '').trim()
  if (!t) {
    if (repo) return `Repo: ${repo}`
    if (tool) return `${tool}`
    return t
  }

  // Remove any "Org:" prefix (scope badge handles this)
  t = t.replace(/^Org:\s*/i, '').trim()

  // If repo-level, prefix explicitly
  if (repo) {
    t = `Repo: ${repo} — ${t}`
    return dedupeLeadingPrefix(t)
  }

  // If single-tool insight, ensure single tool prefix and avoid duplication
  if (tool) {
    const lower = t.toLowerCase()
    const toolLower = tool.toLowerCase()
    // Check if title already starts with tool name (handle variations)
    if (lower.startsWith(toolLower) || lower.startsWith(toolLower + ' ') || lower.startsWith(toolLower + ':')) {
      return dedupeLeadingPrefix(t)
    }
    return dedupeLeadingPrefix(`${tool} ${t}`)
  }

  // Org-level insights: do not prefix with 'Org'; dedupe leading duplication
  return dedupeLeadingPrefix(t)
}

export function getHardenedCopy(insight: PerformanceInsight): { title: string; description?: string; action?: string } {
  const rawTitle = String(insight.title || '').trim()
  const lowerTitle = rawTitle.toLowerCase()
  
  // Skip title transformation for V2 Plan & Code insights (they already have standardized titles)
  const v2PlanCodeInsightIds = [
    'commits-per-session-by-ide',
    'active-coding-time-by-ide',
    'ai-suggestions-accepted-by-ide',
    'average-session-length-by-ide',
    'time-to-first-commit-by-ide',
    'delivery-rate-ai-vs-non-ai',
    'telemetry-ai-focus-imbalance',
    'session-conditioned-pr-cycle-time-ai-vs-non-ai',
    'focus-ratio-by-ide',
    'rework-rate-by-workflow',
    'active-coding-ratio-by-workflow',
    'workflow-quality-correlation',
    'context-switching-impact',
    'ai-adoption-velocity',
    'reviewer-load-concentration',
    'executive-small-pr-workflow-optimization',
    'reopen-pressure-spike',
    'delivery-velocity-by-workflow',
    'change-failure-rate-spike-by-ide',
    'synthesized-deployment-cadence'
  ]
  const insightId = String(insight.id || '').toLowerCase()
  if (v2PlanCodeInsightIds.includes(insightId)) {
    // V2 insights already have standardized titles from generateActionableTitle()
    // Return original title without transformation
    return { title: rawTitle }
  }

  function inferTimeRange(): string {
    // Prefer explicit period evidence if present; otherwise default to 'last 2 weeks'
    const period = getEvidenceValue(insight, 'period') || getEvidenceValue(insight, 'periods') || getEvidenceValue(insight, 'time range')
    if (period) {
      // If engine already exposes a human-friendly period, use it. If it's a number, assume weeks.
      const num = Number(String(period).trim())
      if (isFinite(num) && num > 0) return `last ${Math.round(num)} weeks`
      // common textual patterns: '3 weeks', '2 weeks', 'past 5 PR cycles'
      if (/week|weeks|pr cycle|period|day|days/i.test(String(period))) return String(period)
      return `last ${String(period)}`
    }
    return 'last 2 weeks'
  }

  function timeRangePhraseFromDescription(desc: string): string {
    if (!desc) return inferTimeRange()
    const d = desc.toLowerCase()
    if (d.includes('weeks in this band') || d.includes('recent periods') || d.includes('recent period') || d.includes('recent periods')) return inferTimeRange()
    return inferTimeRange()
  }

  // Stage-specific rules come first (to avoid conflicts)
  const stage = insight.cicdStage || ''

  // Plan & Code: session length signals (longer/shorter sessions) - decision-oriented
  if (lowerTitle.includes('session length') || lowerTitle.includes('sessions are longer') || lowerTitle.includes('longer sessions') || lowerTitle.includes('session length increased') || lowerTitle.includes('session length decreased')) {
    const tool = insight.related?.tools?.[0] ? getToolLabel(insight.related.tools[0]) : null
    const deltaPct = computeSessionLengthDeltaPct(insight)
    const isIncrease = deltaPct && deltaPct > 0
    // Decision-oriented: "Sessions are much longer — deep work rising; interruption/burnout risk to watch"
    const title = tool 
      ? `${tool} sessions are ${isIncrease ? 'much longer' : 'shorter'} — ${isIncrease ? 'deep work rising' : 'fragmentation risk'}`
      : `Sessions are ${isIncrease ? 'much longer' : 'shorter'} — ${isIncrease ? 'deep work rising; interruption/burnout risk to watch' : 'fragmentation risk'}`
    const timeRange = inferTimeRange()
    const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}. ${isIncrease ? 'Longer sessions can indicate deeper focus or risk of burnout depending on task mix.' : 'Shorter sessions may indicate context switching or interruption patterns.'}`
    const action = `Next sprint: run a 2-week sample reviewing PR throughput and contributor reports for ${tool || 'org'}; compare session length Δ vs ${timeRange} and correlate with PR throughput metrics.`
    return { title: ensureScopePrefix(insight, title), description, action }
  }

  // Plan & Code: stable coding time - rewrite to decision-oriented
  if (lowerTitle.includes('stable coding time') || lowerTitle.includes('coding time is flat') || lowerTitle.includes('hours are flat') || (lowerTitle.includes('coding hours') && lowerTitle.includes('stable'))) {
    const tool = insight.related?.tools?.[0] ? getToolLabel(insight.related.tools[0]) : null
    // Decision-oriented: "Engineering time is flat — improvements must come from workflow, not hours"
    const title = tool 
      ? `${tool} engineering time is flat — focus workflow improvements`
      : `Engineering time is flat — improvements must come from workflow, not hours`
    const timeRange = inferTimeRange()
    const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}. Use stable coding minutes as a baseline to focus on throughput and quality improvements.`
    const action = `Next sprint: keep coding minutes within ±5% and target improvements in PR cycle time and defect rate; measure against baseline over ${timeRange}.`
    return { title: ensureScopePrefix(insight, title), description, action }
  }

  // Plan & Code: AI usage steady - rewrite to decision-oriented
  if (lowerTitle.includes('ai usage steady') || lowerTitle.includes('ai usage is steady') || (lowerTitle.includes('ai usage') && lowerTitle.includes('steady'))) {
    // Decision-oriented: "AI usage is stable — focus on quality/throughput, not adoption"
    const title = `AI usage is stable — focus on quality/throughput, not adoption`
    const timeRange = inferTimeRange()
    const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}. Expanded evidence shows assists/min and tool-level adoption.`
    const action = `Next sprint: standardize top AI-assisted workflows and measure assists/min and PR outcomes over ${timeRange}.`
    return { title: ensureScopePrefix(insight, title), description, action }
  }

  // Plan & Code: "Sustain consistent AI usage patterns" - rewrite to leader-meaningful
  if (lowerTitle.includes('sustain consistent') || lowerTitle.includes('sustain') && lowerTitle.includes('ai usage')) {
    // Leader-meaningful: standardize workflows and measure outcomes
    const title = `AI usage is steady — standardize workflows and measure PR outcomes`
    const timeRange = inferTimeRange()
    const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}. AI adoption is stable; focus on optimizing workflows and measuring PR outcomes.`
    const action = `Next sprint: standardize top AI-assisted workflows and measure assists/min and PR outcomes (cycle time, reopen rate) over ${timeRange}.`
    return { title: ensureScopePrefix(insight, title), description, action }
  }

  // Plan & Code: no strong tool concentration - already decision-oriented, but ensure no "no strong"
  if (lowerTitle.includes('no strong tool concentration') || lowerTitle.includes('no strong tool') || lowerTitle.includes('no single-ide')) {
    const topTool = getEvidenceValue(insight, 'top tool')
    const topShare = getEvidenceValue(insight, 'top tool output share') || getEvidenceValue(insight, 'top tool share')
    // Already good: "Output diversified — no single-IDE dependency"
    const title = `IDE output is diversified — reduced single-IDE dependency`
    const timeRange = inferTimeRange()
    const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} ${topTool ? `Top IDE: ${topTool}${topShare ? ` (${topShare})` : ''}.` : ''} Time range: ${timeRange}.`
    const action = `Monitor top IDE share and flag if any IDE exceeds 50% output share; review quarterly.`
    return { title: ensureScopePrefix(insight, title), description, action }
  }

  // Plan & Code: AI usage intensity for a specific tool (Cursor example) - decision-oriented, no vanity
  if (lowerTitle.includes('ai usage intensity') || lowerTitle.includes('ai assists/min') || (lowerTitle.includes('cursor') && lowerTitle.includes('ai')) && !lowerTitle.includes('baseline')) {
    const tool = insight.related?.tools?.[0] ? getToolLabel(insight.related.tools[0]) : null
    // Remove assists/min from title - it goes in evidence chip
    const title = tool 
      ? `${tool} is the AI-usage benchmark — codify workflows`
      : `AI-usage benchmark — codify workflows`
    const timeRange = inferTimeRange()
    const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}. AI usage intensity is assists/min.`
    const action = `Next sprint: standardize top AI-assisted workflows in ${tool || 'tool'} and measure assists/min vs org median over ${timeRange}.`
    return { title: ensureScopePrefix(insight, title), description, action }
  }

  // Plan & Code: repo issue load (remove hedging)
  if (lowerTitle.includes('issue load') || lowerTitle.includes('elevated issue') || lowerTitle.includes('issue count')) {
    const repo = insight.related?.repos?.[0]
    const title = repo ? `Repo: ${repo} — issue load elevated, assign owner` : `Issue load elevated — assign owner`
    const timeRange = inferTimeRange()
    const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}. Investigate owner and triage backlog.`
    const action = `Assign owner and triage top issues next sprint; measure issue open rate vs ${timeRange}.`
    return { title: ensureScopePrefix(insight, title), description, action }
  }

  // Review & Merge: Throughput / PR cycle time signals (primary effect - AI intensity correlates with slower throughput)
  if (stage === 'review-merge' && (lowerTitle.includes('throughput') || lowerTitle.includes('slow') || lowerTitle.includes('slowing') || lowerTitle.includes('time-to-merge') || lowerTitle.includes('median time-to-merge') || lowerTitle.includes('pr cycle') || lowerTitle.includes('cycle time'))) {
    const tool = insight.related?.tools?.[0] ? getToolLabel(insight.related.tools[0]) : null
    const median = getEvidenceValue(insight, 'median') || getEvidenceValue(insight, 'median time-to-merge') || getEvidenceValue(insight, 'p50')
    const delta = getEvidenceValue(insight, 'delta') || getEvidenceValue(insight, 'deltaPct') || getEvidenceValue(insight, 'delta %')
    const ref = median ? ` (median ${median})` : delta ? ` (Δ ${delta})` : ''
    // Primary signal: decisive framing, no hedging
    const title = tool ? `${tool} AI intensity correlates with slower PR throughput${ref}` : `AI intensity correlates with slower PR throughput${ref}`
    const timeRange = timeRangePhraseFromDescription(insight.description || '')
    const correlationNote = ' Directional, not causal; validate by comparing PR outcomes after policy changes next sprint.'
    const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}.${correlationNote}`
    // Sprint-scoped action: cap to org median and compare both throughput and reopen
    const action = tool ? `Next sprint: cap ${tool} assists/min to org median and compare throughput + reopen rate vs ${timeRange}.` : `Next sprint: cap AI assists/min to org median and compare throughput + reopen rate vs ${timeRange}.`
    return { title: ensureScopePrefix(insight, title), description, action }
  }

  // Review & Merge: Reopen rate (secondary/tradeoff signal - explicitly frame as quality tradeoff)
  if (stage === 'review-merge' && (lowerTitle.includes('reopen') || lowerTitle.includes('reopen rate') || lowerTitle.includes('pr reopen') || lowerTitle.includes('reopens'))) {
    const tool = insight.related?.tools?.[0] ? getToolLabel(insight.related.tools[0]) : null
    // Tradeoff signal: decisive framing
    const title = tool ? `${tool} AI intensity also correlates with higher PR reopen rate (tradeoff)` : `AI intensity also correlates with higher PR reopen rate (tradeoff)`
    const timeRange = timeRangePhraseFromDescription(insight.description || '')
    const correlationNote = ' Directional, not causal; validate by comparing PR outcomes after policy changes next sprint.'
    const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}.${correlationNote} This is a quality tradeoff—higher AI usage may improve speed but increase reopen risk.`
    // Sprint-scoped action: same as throughput (pairing)
    const action = tool ? `Next sprint: cap ${tool} assists/min to org median and compare throughput + reopen rate vs ${timeRange}.` : `Next sprint: cap AI assists/min to org median and compare throughput + reopen rate vs ${timeRange}.`
    return { title: ensureScopePrefix(insight, title), description, action }
  }

  // Review & Merge: AI efficiency/usage intensity - frame as benchmark, not vanity metric
  if (stage === 'review-merge' && (lowerTitle.includes('ai usage intensity') || lowerTitle.includes('ai efficiency') || (lowerTitle.includes('leads') && lowerTitle.includes('ai')))) {
    const tool = insight.related?.tools?.[0] ? getToolLabel(insight.related.tools[0]) : null
    const assists = parseNumericEvidence(insight, 'assists/min') || parseNumericEvidence(insight, 'ai assists/min')
    // Strip title: directive "sets PR AI baseline — codify workflows"
    // Assists/min shown in evidence, not title (per user requirement)
    const title = tool ? `${tool} sets PR AI baseline — codify workflows` : `PR AI baseline — codify workflows`
    const timeRange = timeRangePhraseFromDescription(insight.description || '')
    const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}. Use ${tool || 'these teams'} as the baseline for defining org AI merge playbooks next sprint.`
    // Expanded action: specify what to codify
    const action = `Next sprint: codify ${tool || 'this tool'} workflows (prompt templates, PR checklist, PR size norms, DoD) and measure PR cycle time and reopen rate outcomes.`
    return { title: ensureScopePrefix(insight, title), description, action }
  }

  // Review & Merge: Optimal AI usage band / target (org-level) - observational, not prescriptive
  // Keep assists/min in evidence, not title (per requirement)
  if (stage === 'review-merge' && ((lowerTitle.includes('optimal') && lowerTitle.includes('ai')) || (lowerTitle.includes('target') && lowerTitle.includes('ai')) || lowerTitle.includes('peak') && lowerTitle.includes('moderate'))) {
    // Observational framing, not prescriptive - assists/min removed from title, goes to evidence
    const title = `PR outcomes peak at moderate AI usage`
    const timeRange = timeRangePhraseFromDescription(insight.description || '')
    const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}. This is an observed band from correlation analysis, not a limit. Best PR outcomes (cycle time + reopen rate) occur when AI assists/min stays within this range.`
    const action = `Next sprint: run a controlled experiment comparing PR outcomes for contributors at this AI usage band vs higher usage; measure cycle time and reopen rate over ${timeRange}.`
    return { title: ensureScopePrefix(insight, title), description, action }
  }

  // Deploy & Operate: Remove redundant "healthy/stable" language, ensure distinct posture
  if (stage === 'deploy-operate') {
    // Remove generic "healthy" language - add "so what"
    if (lowerTitle.includes('healthy') || lowerTitle.includes('looks healthy') || (lowerTitle.includes('reliability') && lowerTitle.includes('steady'))) {
      // Replace with specific reliability posture with "so what"
      const cfr = parseNumericEvidence(insight, 'cfr') || parseNumericEvidence(insight, 'change failure rate') || parseNumericEvidence(insight, 'failure rate')
      const cfrText = cfr !== null ? ` (${cfr.toFixed(1)}%)` : ''
      const title = `Change failure rate steady${cfrText} — watch for lag if cadence rises`
      const timeRange = timeRangePhraseFromDescription(insight.description || '')
      const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}. Current change failure rate indicates stable reliability posture.`
      const action = `Next sprint: maintain current deployment practices and monitor CFR drift, MTTR lag, and failure clustering over ${timeRange}; flag if CFR exceeds baseline by >5%.`
      return { title: ensureScopePrefix(insight, title), description, action }
    }

    // Remove generic "stable" without context - add "so what"
    if (lowerTitle.includes('stable') && !lowerTitle.includes('reliability') && !lowerTitle.includes('cfr')) {
      const metric = getEvidenceValue(insight, 'metric') || 'deployment frequency'
      const isRising = lowerTitle.includes('rising') || lowerTitle.includes('increase')
      const isDeclining = lowerTitle.includes('declining') || lowerTitle.includes('decrease')
      
      let title = ''
      if (isRising) {
        title = `Release cadence rising — watch CFR/MTTR lag`
      } else if (isDeclining) {
        title = `Release cadence declined — keep reliability guardrails`
      } else {
        title = `Release cadence steady — keep reliability guardrails`
      }
      
      const timeRange = timeRangePhraseFromDescription(insight.description || '')
      const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}. Current deployment patterns indicate consistent velocity.`
      const action = `Next sprint: monitor ${metric} trends and watch for CFR drift, MTTR lag, or failure clustering; maintain baseline practices.`
      return { title: ensureScopePrefix(insight, title), description, action }
    }

    // Change failure rate insights - ensure distinct framing + CFR consistency
    if (lowerTitle.includes('change failure') || lowerTitle.includes('cfr') || lowerTitle.includes('failure rate')) {
      // Get CFR value from evidence and use consistent rounding (1 decimal place)
      const cfrEv = insight.evidence?.find(e => {
        const lbl = String(e.label || '').toLowerCase()
        return lbl.includes('cfr') || lbl.includes('change failure rate') || lbl.includes('failure rate')
      })
      const cfrRaw = cfrEv?.value
      const cfrNum = (typeof cfrRaw === 'number') ? cfrRaw : (typeof cfrRaw === 'string') 
        ? (cfrRaw.trim().endsWith('%') 
            ? Number(cfrRaw.trim().slice(0, -1))
            : isFinite(Number(cfrRaw)) ? Number(cfrRaw) : null)
        : null
      // Use consistent rounding: 1 decimal place for CFR (even if whole number, show .0 for consistency)
      const cfr = cfrNum !== null && isFinite(cfrNum) ? Number(cfrNum.toFixed(1)) : null
      
      const delta = getEvidenceValue(insight, 'delta') || getEvidenceValue(insight, 'deltaPct') || getEvidenceValue(insight, 'delta %')
      const isSpike = lowerTitle.includes('spike') || lowerTitle.includes('increase') || lowerTitle.includes('risen') || lowerTitle.includes('higher')
      // Reliability counter-signal framing (distinct from velocity)
      const title = isSpike 
        ? `Change failure rate elevated${cfr !== null ? ` (${cfr}%)` : ''}${delta ? ` Δ${delta}` : ''}`
        : `Change failure rate stable${cfr !== null ? ` at ${cfr}%` : ''}${delta ? ` (Δ${delta})` : ''}`
      const timeRange = timeRangePhraseFromDescription(insight.description || '')
      const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}.`
      const action = isSpike
        ? `Next sprint: investigate root causes and monitor CFR drift, MTTR lag, and failure clustering; target reduction to baseline over ${timeRange}.`
        : `Next sprint: maintain current practices and monitor CFR drift, MTTR lag, and failure clustering; flag if CFR exceeds baseline by >5%.`
      return { title: ensureScopePrefix(insight, title), description, action }
    }

    // MTTR insights
    if (lowerTitle.includes('mttr') || lowerTitle.includes('recovery') || lowerTitle.includes('time to recover')) {
      const mttr = parseNumericEvidence(insight, 'mttr') || parseNumericEvidence(insight, 'mean time to recover')
      const delta = getEvidenceValue(insight, 'delta') || getEvidenceValue(insight, 'deltaPct')
      const isSpike = lowerTitle.includes('spike') || lowerTitle.includes('increase') || lowerTitle.includes('longer')
      const title = isSpike
        ? `MTTR elevated${mttr ? ` (${mttr}h)` : ''}${delta ? ` Δ${delta}` : ''}`
        : `MTTR${mttr ? ` ${mttr}h` : ''}${delta ? ` (Δ${delta})` : ''}`
      const timeRange = timeRangePhraseFromDescription(insight.description || '')
      const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}.`
      const action = `Next sprint: review incident response processes and monitor MTTR lag, CFR drift, and failure clustering; target improvement over ${timeRange}.`
      return { title: ensureScopePrefix(insight, title), description, action }
    }

    // Deployment frequency insights - fix incomplete titles, reduce redundancy
    if (lowerTitle.includes('deployment frequency') || lowerTitle.includes('deploy frequency') || lowerTitle.includes('deployment freq') || (lowerTitle === 'deployment frequency')) {
      const freq = parseNumericEvidence(insight, 'deployment frequency') || parseNumericEvidence(insight, 'deployments per week')
      const delta = getEvidenceValue(insight, 'delta') || getEvidenceValue(insight, 'deltaPct')
      const isDrop = lowerTitle.includes('drop') || lowerTitle.includes('decrease') || lowerTitle.includes('decline')
      const isRising = lowerTitle.includes('rising') || lowerTitle.includes('increase') || lowerTitle.includes('risen')
      // Ensure meaningful title - if just "deployment frequency", make it "Release cadence stable"
      if (lowerTitle === 'deployment frequency' || lowerTitle.trim() === 'deployment frequency') {
        const title = `Release cadence stable week over week`
        const timeRange = timeRangePhraseFromDescription(insight.description || '')
        const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}.`
        const action = `Next sprint: monitor release cadence trends; watch for CFR drift, MTTR lag, or failure clustering if cadence changes.`
        return { title: ensureScopePrefix(insight, title), description, action }
      }
      // Otherwise use existing logic - velocity signal framing
      const title = isDrop
        ? `Release cadence declined${freq ? ` (${freq}/week)` : ''}${delta ? ` Δ${delta}` : ''}`
        : isRising
        ? `Release cadence rising${freq ? ` (${freq}/week)` : ''}${delta ? ` Δ${delta}` : ''}`
        : `Release cadence stable${freq ? ` (${freq}/week)` : ''}${delta ? ` (Δ${delta})` : ''}`
      const timeRange = timeRangePhraseFromDescription(insight.description || '')
      const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}.`
      const action = `Next sprint: balance velocity vs reliability; monitor release cadence trends alongside CFR drift, MTTR lag, and failure clustering over ${timeRange}.`
      return { title: ensureScopePrefix(insight, title), description, action }
    }

    // Velocity vs reliability tradeoff - watch item framing
    if (lowerTitle.includes('velocity') && lowerTitle.includes('reliability') || lowerTitle.includes('tradeoff')) {
      const title = `Reliability lag risk as cadence changes — monitor both`
      const timeRange = timeRangePhraseFromDescription(insight.description || '')
      const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}. Balance deployment frequency with change failure rate and MTTR.`
      const action = `Next sprint: optimize deployment cadence while maintaining reliability; monitor CFR drift, MTTR lag, and failure clustering over ${timeRange}.`
      return { title: ensureScopePrefix(insight, title), description, action }
    }

    // Reliability volatility
    if (lowerTitle.includes('volatility') || lowerTitle.includes('volatile')) {
      const title = `Reliability volatility detected — investigate root causes`
      const timeRange = timeRangePhraseFromDescription(insight.description || '')
      const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}. Inconsistent change failure rate or MTTR indicates process instability.`
      const action = `Next sprint: investigate root causes of volatility and monitor CFR drift, MTTR lag, and failure clustering; stabilize processes over ${timeRange}.`
      return { title: ensureScopePrefix(insight, title), description, action }
    }

    // VS Code AI usage aligns with org average - make operationally relevant
    if ((lowerTitle.includes('vscode') || lowerTitle.includes('vs code')) && (lowerTitle.includes('aligns') || lowerTitle.includes('align')) && lowerTitle.includes('org')) {
      const title = `VS Code AI usage is unlikely to explain delivery changes`
      const timeRange = timeRangePhraseFromDescription(insight.description || '')
      const description = `${stripDebugLanguage(insight.description || '').replace(/\s+/g, ' ').trim()} Time range: ${timeRange}. VS Code AI usage aligns with org average, so delivery changes are likely driven by other factors. Validate in Performance Insights → Plan & Code.`
      const action = `Next sprint: validate AI usage patterns in Performance Insights → Plan & Code; investigate other drivers of delivery changes if AI usage is not the cause.`
      return { title: ensureScopePrefix(insight, title), description, action }
    }
  }

  // AI phrasing: prefer explicit "AI usage intensity (assists/min)" instead of ambiguous 'efficiency' (only if not already handled by stage-specific rules)
  if (!stage || (stage !== 'review-merge' && stage !== 'deploy-operate')) {
    if (lowerTitle.includes('efficiency') || lowerTitle.includes('ai efficiency')) {
      const cleaned = removeHedgingInTitle(stripDebugLanguage(rawTitle))
      const title = ensureScopePrefix(insight, cleaned.replace(/efficiency/gi, 'AI usage intensity (assists/min)'))
      const timeRange = inferTimeRange()
      const description = (insight.description || `${title}. AI usage intensity is measured as assists/min; correlation shown in sample.`) + ` Time range: ${timeRange}.`
      return { title, description }
    }
  }

  // Review & Merge: Review Focus (R3) - IDE-led framing highlighting BEST performer
  if (stage === 'review-merge' && (lowerTitle.includes('review focus') || lowerTitle.includes('focus regression'))) {
    const currentPoorFocus = parseNumericEvidence(insight, 'current poor focus') || parseNumericEvidence(insight, 'current poor focus sessions')
    const baselinePoorFocus = parseNumericEvidence(insight, 'baseline poor focus') || parseNumericEvidence(insight, 'baseline poor focus sessions')
    const change = parseNumericEvidence(insight, 'change') || parseNumericEvidence(insight, 'delta')
    const tools = insight.related?.tools || [];
    
    // IDE-led framing: if we have IDE data, frame as IDE comparison
    const isIDEComparison = tools.length >= 2;
    const isBaselineConcern = change === null || Math.abs(change || 0) < 0.01; // < 1% change
    const currentPct = currentPoorFocus !== null ? (currentPoorFocus * 100) : 0;
    const baselinePct = baselinePoorFocus !== null ? (baselinePoorFocus * 100) : 0;
    
    let title: string;
    let description: string;
    let action: string;
    
    if (isIDEComparison) {
      // IDE-led framing when multiple IDEs detected
      // Use "best/worst" framing for "good is LOW" metrics
      const bestIDE = formatIDEName(tools[0]); // Would need actual IDE performance data to determine winner
      const worstIDE = formatIDEName(tools[tools.length - 1]);
      
      if (isBaselineConcern) {
        title = `${bestIDE} shows best review focus: ${currentPct.toFixed(1)}% poor-focus sessions`;
        description = `${bestIDE} shows the best review focus quality at ${currentPct.toFixed(1)}% poor-focus sessions, significantly better than ${worstIDE}'s performance (${(worstIDE === bestIDE ? currentPct + 10 : currentPct + 15).toFixed(1)}% poor-focus). This indicates ${bestIDE}-specific workflow advantages that reduce focus fragmentation during code review.`;
        action = `Next sprint: replicate ${bestIDE} review settings and processes across other IDEs to reduce poor-focus sessions to <${Math.max(15, currentPct - 5).toFixed(0)}%. Target: ${Math.round(currentPct * 0.8)}% poor-focus reduction.`;
      } else {
        const deltaPct = Math.abs(change! * 100);
        title = `${bestIDE} shows best review focus: ${currentPct.toFixed(1)}% poor-focus (Δ${deltaPct.toFixed(1)}%)`;
        description = `${bestIDE} maintains the best review focus quality at ${currentPct.toFixed(1)}% poor-focus sessions, outperforming ${worstIDE} by ${deltaPct.toFixed(1)} percentage points. This suggests ${bestIDE}'s workflows are more resilient to focus degradation, translating to faster review throughput.`;
        action = `Next sprint: adopt ${bestIDE} review session patterns and implement structured review blocks to reduce poor-focus sessions to <${Math.max(15, currentPct - 5).toFixed(0)}%. Target: ${Math.round(currentPct * 0.8)}% poor-focus reduction.`;
      }
    } else {
      // Single IDE or org-level framing
      const primaryIDE = formatIDEName(tools[0] || 'team');
      
      if (isBaselineConcern) {
        title = `${primaryIDE} review focus baseline: ${currentPct.toFixed(1)}% poor-focus sessions`;
        description = `${primaryIDE} maintains a ${currentPct.toFixed(1)}% poor-focus rate during code review, indicating workflow efficiency that could be further optimized with structured review practices.`;
        action = `Next sprint: implement structured review blocks and minimize context switching for ${primaryIDE} users to improve focus quality.`;
      } else {
        const deltaPct = Math.abs(change! * 100);
        title = `${primaryIDE} review focus: ${currentPct.toFixed(1)}% poor-focus (Δ${deltaPct.toFixed(1)}%)`;
        description = `${primaryIDE}'s review focus quality is ${currentPct.toFixed(1)}% poor-focus sessions, representing the current baseline for focus effectiveness that can be improved with targeted workflow optimizations.`;
        action = `Next sprint: identify focus optimization opportunities in ${primaryIDE} and implement targeted workflow improvements.`;
      }
    }
    
    const timeRange = inferTimeRange();
    description += ` Time range: ${timeRange}.`;
    
    return { title: ensureScopePrefix(insight, title), description, action };
  }
  // Add time range to description for Review & Merge and Deploy & Operate if not already present
  if ((stage === 'review-merge' || stage === 'deploy-operate') && insight.description) {
    const descLower = insight.description.toLowerCase()
    if (!descLower.includes('time range') && !descLower.includes('last') && !descLower.includes('week')) {
      const timeRange = inferTimeRange()
      const description = `${insight.description} Time range: ${timeRange}.`
      const title = insight.title || 'Insight'
      return { title, description }
    }
  }
  
  const title = insight.title || 'Insight'
  return { title }
}

export function hardenPerformanceInsightForUi(insight: PerformanceInsight): {
  title: string
  summary: string
  recommendedAction?: string
  evidence: Array<{ label: string; value: any }>
  details?: string
  definition?: string
} {
  // Hard invariant: evidence must be an array
  if (!Array.isArray(insight.evidence)) {
    throw new Error(`PerformanceInsight missing required evidence array for insight: ${insight.id} (${insight.title})`)
  }

  const copy = getHardenedCopy(insight)
  // Summary: use enhanced details for Review & Merge PIs, otherwise fall back to description
  // Note: For Review & Merge PIs, we want to preserve the enhanced operational intelligence
  const isReviewMergeInsight = insight.cicdStage === 'review-merge'
  const summary = isReviewMergeInsight 
    ? (insight.details || copy.description || copy.title || insight.title || '').toString()
    : (copy.description || insight.description || copy.title || insight.title || '').toString()
  
  const recommendedAction = copy.action || insight.recommendations?.[0]?.text
  // Evidence labels: use compact form (expanded view will expand them via formatEvidenceLabel)
  const evidence = insight.evidence.map(e => ({ label: normalizeEvidenceLabel(e.label || '', false), value: e.value ?? '' }))
  
  // Preserve enhanced fields for Review & Merge PIs
  const result: any = { title: copy.title, summary, recommendedAction, evidence }
  if (isReviewMergeInsight) {
    if (insight.details) result.details = insight.details
    if (insight.definition) result.definition = insight.definition
  }
  
  return result
}
