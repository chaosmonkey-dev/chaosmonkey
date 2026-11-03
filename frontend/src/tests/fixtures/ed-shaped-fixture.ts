// Ed-shaped fixture: claude_code + vscode only, ~549 sessions, no GitHub
export const ED_TOOLS = ['claude_code', 'vscode']
export const ED_SESSION_COUNTS = { claude_code: 126, vscode: 423 }
export const ED_POPULATION = 549

export interface EdSessionRow {
  session_id: string
  tool: string
  user_id: number
  duration_ms: number
  active_coding_duration_ms: number | null
  idle_time_ms: number | null
  session_commits: number | null
  session_has_ai_activity: boolean | null
  ai_burst_count: number | null
  ai_usage_duration_ms: number | null
  time_to_first_commit_ms: number | null
  session_quality_score: number | null
  files_edited: number | null
  editor_source: string
}

let _s = 42
function r() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff }
function ri(a: number, b: number) { return Math.floor(r() * (b - a + 1)) + a }

function makeVS(i: number): EdSessionRow {
  const ai = r() > 0.3
  return {
    session_id: `vs-${i}`, tool: 'vscode', user_id: ri(1, 21),
    duration_ms: ri(10, 240) * 60000,
    active_coding_duration_ms: ri(3, 12) * 60000,
    idle_time_ms: ri(1, 30) * 60000,
    session_commits: r() > 0.15 ? ri(0, 8) : null,
    session_has_ai_activity: ai,
    ai_burst_count: ai ? ri(1, 15) : 0,
    ai_usage_duration_ms: ai ? ri(1, 60) * 60000 : 0,
    time_to_first_commit_ms: r() > 0.2 ? ri(5, 120) * 60000 : null,
    session_quality_score: r() > 0.1 ? ri(30, 95) : null,
    files_edited: ri(1, 20),
    editor_source: 'vscode',
  }
}

function makeCC(i: number): EdSessionRow {
  const ai = r() > 0.1
  return {
    session_id: `cc-${i}`, tool: 'claude_code', user_id: ri(1, 21),
    duration_ms: ri(5, 180) * 60000,
    active_coding_duration_ms: null,
    idle_time_ms: null,
    session_commits: r() > 0.4 ? ri(0, 5) : null,
    session_has_ai_activity: ai,
    ai_burst_count: ai ? ri(1, 20) : 0,
    ai_usage_duration_ms: ai ? ri(5, 90) * 60000 : 0,
    time_to_first_commit_ms: r() > 0.5 ? ri(10, 180) * 60000 : null,
    session_quality_score: null,
    files_edited: ri(1, 15),
    editor_source: 'claude-code',
  }
}

export function getEdSessionRows(): EdSessionRow[] {
  const rows: EdSessionRow[] = []
  for (let i = 0; i < ED_SESSION_COUNTS.vscode; i++) rows.push(makeVS(i))
  for (let i = 0; i < ED_SESSION_COUNTS.claude_code; i++) rows.push(makeCC(i))
  return rows
}

export function getEdMetadata() {
  return {
    tools_in_population: ED_TOOLS,
    session_count_by_tool: ED_SESSION_COUNTS,
    canonical_population_count: ED_POPULATION,
  }
}

export function getEdAggregatedRows() {
  return [
    { tool: 'vscode', session_count: 423, active_coding_time_minutes: 2100, idle_time_minutes: 800, ai_suggestions_accepted: 1200, commits_per_session: 3.2, time_to_first_commit_minutes: 18, average_session_length_minutes: 45, total_session_minutes: 19035, ai_usage_duration_minutes: 5000, focus_ratio: 0.72 },
    { tool: 'claude_code', session_count: 126, active_coding_time_minutes: 0, idle_time_minutes: 0, ai_suggestions_accepted: 1260, commits_per_session: 1.5, time_to_first_commit_minutes: 35, average_session_length_minutes: 60, total_session_minutes: 7560, ai_usage_duration_minutes: 8000, focus_ratio: 0 },
  ]
}

export function getEdCanonicalInput() {
  return {
    sessionRows: getEdSessionRows(),
    githubSnapshot: undefined,
    githubByPeriod: [],
    productivityByPeriod: [],
    granularity: 'week' as const,
  }
}
