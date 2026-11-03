/**
 * Unified Sessions Adapter Layer
 * Joins telemetry sessions + GitHub snapshot data into a unified session model
 */

// Types
export type UnifiedSession = {
  sessionId: string
  userId: string | null
  tool: 'cursor' | 'windsurf' | 'devin' | 'vscode' | 'unknown'
  repo: string | null
  branch: string | null
  startMs: number | null
  endMs: number | null
  durationMinutes: number
  activeCodingMinutes: number
  aiBurstCount: number
  hasAI: boolean
  focusRatio: number | null
  idleRatio: number | null
  timeToFirstCommitMinutes: number | null
  charsAdded: number
  charsRemoved: number
  linesAdded: number
  linesRemoved: number
  raw: any

  github: {
    commits: UnifiedCommit[]
    prs: UnifiedPR[]
    deployments: UnifiedDeployment[]
  }
}

export type UnifiedCommit = {
  sha: string | null
  repo: string | null
  message: string
  authorLogin: string | null
  authorName: string | null
  timestampMs: number | null
  raw: any
}

export type UnifiedPR = {
  id: string | number | null
  number: number | null
  title: string
  repo: string | null
  createdMs: number | null
  mergedMs: number | null
  closedMs: number | null
  cycleTimeHours: number | null
  additions: number
  deletions: number
  size: number
  state: string | null
  merged: boolean
  raw: any
}

export type UnifiedDeployment = {
  id: string | number | null
  repo: string | null
  environment: string | null
  status: string | null
  timestampMs: number | null
  success: boolean | null
  raw: any
}

export type UnifiedSessionsResult = {
  unifiedSessions: UnifiedSession[]
  coverage: UnifiedCoverage
  githubEntities: UnifiedGitHubEntities
}

export type UnifiedCoverage = {
  totalSessions: number
  sessionsWithGithub: number
  sessionsWithoutGithub: number
  sessionsWithCommits: number
  sessionsWithPRs: number
  sessionsWithDeployments: number
  totalCommits: number
  totalPRs: number
  totalDeployments: number
  commitAttachRatePct: number
  prAttachRatePct: number
  deploymentAttachRatePct: number
  tools: Record<string, number>
}

export type UnifiedGitHubEntities = {
  commits: UnifiedCommit[]
  prs: UnifiedPR[]
  deployments: UnifiedDeployment[]
}

// Helper Functions
function toMs(value: any): number | null {
  if (!value) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return isNaN(parsed) ? null : parsed
  }
  return null
}

function numberOrZero(value: any): number {
  if (typeof value === 'number' && !isNaN(value)) return value
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    return isNaN(parsed) ? 0 : parsed
  }
  return 0
}

function normalizeTool(tool: any): 'cursor' | 'windsurf' | 'devin' | 'vscode' | 'unknown' {
  if (!tool) return 'unknown'
  const toolStr = String(tool).toLowerCase()
  // Priority: product-specific hosts > generic VS Code host
  if (toolStr.includes('devin')) return 'devin'
  if (toolStr.includes('cursor')) return 'cursor'
  if (toolStr.includes('windsurf')) return 'windsurf'
  if (toolStr.includes('vscode') || toolStr.includes('visual studio code')) return 'vscode'
  return 'unknown'
}

function normalizeRepoKey(repoKey: string | null | undefined): string | null {
  if (!repoKey) return null

  try {
    // remove branch suffix
    let cleaned = repoKey.split('::')[0]

    // remove protocol
    cleaned = cleaned.replace(/^https?:\/\/github\.com\//, '')

    // remove .git
    cleaned = cleaned.replace(/\.git$/, '')

    // trim
    cleaned = cleaned.trim()

    return cleaned.toLowerCase()
  } catch (e) {
    return null
  }
}

function normalizeRepo(repo: any): string | null {
  if (!repo) return null
  if (typeof repo === 'string') {
    // Handle various repo formats
    if (repo.includes('/')) {
      // Extract owner/repo from GitHub URL
      const match = repo.match(/([^\/]+)\/([^\/\s]+)(?:\.git)?$/)
      if (match) return `${match[1]}/${match[2]}`
    }
    return repo
  }
  return String(repo)
}

function getNested(obj: any, path: string): any {
  if (!obj || !path) return null
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : null
  }, obj)
}

function arrayFromSnapshot(snapshot: any, ...keys: string[]): any[] {
  if (!snapshot) return []
  for (const key of keys) {
    const value = getNested(snapshot, key)
    if (Array.isArray(value) && value.length > 0) return value
  }
  return []
}

function overlapsWindow(timestampMs: number | null, startMs: number | null, endMs: number | null, windowMinutes: number = 240): boolean {
  if (!timestampMs || !startMs) return false
  const sessionEnd = endMs || (startMs + windowMinutes * 60 * 1000)
  const windowEndMs = sessionEnd + windowMinutes * 60 * 1000
  return timestampMs >= startMs && timestampMs <= windowEndMs
}

// Main Function
export function buildUnifiedSessions({
  sessionRows,
  githubSnapshot,
  windowMinutes = 240
}: {
  sessionRows: any[]
  githubSnapshot: any
  windowMinutes?: number
}): UnifiedSessionsResult {
  // Extract GitHub entities
  const githubCommits = arrayFromSnapshot(githubSnapshot, 'commits', 'all_commits')
  const githubPRs = arrayFromSnapshot(githubSnapshot, 'prs', 'all_prs', 'pull_requests')
  const githubDeployments = arrayFromSnapshot(githubSnapshot, 'deployment_metrics.deployments', 'deployments')

  // Normalize GitHub entities
  const normalizedCommits: UnifiedCommit[] = githubCommits.map(commit => ({
    sha: getNested(commit, 'sha') || getNested(commit, 'id'),
    repo: normalizeRepoKey(getNested(commit, 'repo') || getNested(commit, 'base.repo.full_name') || getNested(commit, 'repoKey')),
    message: getNested(commit, 'message') || getNested(commit, 'commit.message') || '',
    authorLogin: getNested(commit, 'author.login') || getNested(commit, 'author_name'),
    authorName: getNested(commit, 'author.name') || getNested(commit, 'author_name'),
    timestampMs: toMs(getNested(commit, 'timestamp') || getNested(commit, 'date') || getNested(commit, 'commit.author.date')),
    raw: commit
  })).filter(commit => commit.sha || commit.message)

  const normalizedPRs: UnifiedPR[] = githubPRs.map(pr => ({
    id: getNested(pr, 'id') || getNested(pr, 'number'),
    number: getNested(pr, 'number'),
    title: getNested(pr, 'title') || '',
    repo: normalizeRepoKey(getNested(pr, 'base.repo.full_name') || getNested(pr, 'repo') || getNested(pr, 'repoKey')),
    createdMs: toMs(getNested(pr, 'created_at')),
    mergedMs: toMs(getNested(pr, 'merged_at')),
    closedMs: toMs(getNested(pr, 'closed_at')),
    cycleTimeHours: null, // Will be calculated
    additions: numberOrZero(getNested(pr, 'additions') || getNested(pr, 'stats.additions')),
    deletions: numberOrZero(getNested(pr, 'deletions') || getNested(pr, 'stats.deletions')),
    size: numberOrZero(getNested(pr, 'changed_files') || getNested(pr, 'stats.changed_files')),
    state: getNested(pr, 'state'),
    merged: Boolean(getNested(pr, 'merged')),
    raw: pr
  })).filter(pr => pr.title)

  // Calculate cycle time for PRs
  normalizedPRs.forEach(pr => {
    if (pr.createdMs) {
      const endTime = pr.mergedMs || pr.closedMs
      if (endTime) {
        pr.cycleTimeHours = (endTime - pr.createdMs) / (1000 * 60 * 60)
      }
    }
  })

  const normalizedDeployments: UnifiedDeployment[] = githubDeployments.map(deployment => ({
    id: getNested(deployment, 'id') || getNested(deployment, 'deployment_id'),
    repo: normalizeRepoKey(getNested(deployment, 'repo') || getNested(deployment, 'repository')),
    environment: getNested(deployment, 'environment'),
    status: getNested(deployment, 'status') || getNested(deployment, 'state'),
    timestampMs: toMs(getNested(deployment, 'timestamp') || getNested(deployment, 'created_at')),
    success: getNested(deployment, 'success') !== null ? Boolean(getNested(deployment, 'success')) : null,
    raw: deployment
  })).filter(deployment => deployment.timestampMs || deployment.id)

  // STEP 4 — ADD DEBUG LOG
  console.log('[REPO_MATCH_DEBUG]', {
    sessionRepo: sessionRows[0] ? normalizeRepoKey(getNested(sessionRows[0], 'repoKey') || getNested(sessionRows[0], 'git_repo_url') || getNested(sessionRows[0], 'repo')) : null,
    sampleCommitRepo: normalizedCommits[0]?.repo,
    normalizedCommitRepo: normalizedCommits[0]?.repo
  })

  // Build unified sessions
  const unifiedSessions: UnifiedSession[] = sessionRows.map(session => {
    // Extract session data
    const sessionId = getNested(session, 'session_id') || getNested(session, 'id') || 'unknown'
    const userId = getNested(session, 'user_id')
    const tool = normalizeTool(getNested(session, 'tool') || getNested(session, 'source') || getNested(session, 'editor_source'))
    const sessionRepo = normalizeRepoKey(getNested(session, 'repoKey') || getNested(session, 'git_repo_url') || getNested(session, 'repo'))
    const branch = getNested(session, 'git_branch') || getNested(session, 'branch')
    
    // Timing
    const startMs = toMs(getNested(session, 'timestamp') || getNested(session, 'started_at') || getNested(session, 'start_time') || getNested(session, 'created_at'))
    const durationMinutes = numberOrZero(getNested(session, 'session_duration_minutes') || getNested(session, 'duration_ms') / (1000 * 60))
    const endMs = startMs ? startMs + (durationMinutes * 60 * 1000) : null
    
    // Activity metrics
    const activeCodingMinutes = numberOrZero(getNested(session, 'session_active_coding_duration_minutes'))
    const aiBurstCount = numberOrZero(getNested(session, 'session_ai_burst_count'))
    const hasAI = aiBurstCount > 0
    
    // Focus ratios
    const focusRatio = activeCodingMinutes > 0 && durationMinutes > 0 ? activeCodingMinutes / durationMinutes : null
    const idleRatio = focusRatio !== null ? 1 - focusRatio : null
    
    // Time to first commit
    let timeToFirstCommitMinutes: number | null = null
    const sessionTTFC = numberOrZero(getNested(session, 'session_ttfc_minutes'))
    if (sessionTTFC > 0) {
      timeToFirstCommitMinutes = sessionTTFC
    }
    
    // Code changes
    const charsAdded = numberOrZero(getNested(session, 'chars_added_total'))
    const charsRemoved = numberOrZero(getNested(session, 'chars_removed_total'))
    const linesAdded = numberOrZero(getNested(session, 'lines_added_total'))
    const linesRemoved = numberOrZero(getNested(session, 'lines_removed_total_est') || getNested(session, 'lines_removed_total'))

    // Attach GitHub entities
    const sessionCommits: UnifiedCommit[] = []
    const sessionPRs: UnifiedPR[] = []
    const sessionDeployments: UnifiedDeployment[] = []

    // Attach commits
    normalizedCommits.forEach(commit => {
      if ((!sessionRepo || commit.repo === sessionRepo) && overlapsWindow(commit.timestampMs, startMs, endMs, windowMinutes)) {
        sessionCommits.push(commit)
        
        // Calculate TTFC if not already available
        if (timeToFirstCommitMinutes === null && commit.timestampMs && startMs) {
          timeToFirstCommitMinutes = (commit.timestampMs - startMs) / (1000 * 60)
        }
      }
    })

    // Attach PRs
    normalizedPRs.forEach(pr => {
      if ((!sessionRepo || pr.repo === sessionRepo) && (
        overlapsWindow(pr.createdMs, startMs, endMs, windowMinutes) ||
        overlapsWindow(pr.mergedMs, startMs, endMs, windowMinutes) ||
        overlapsWindow(pr.closedMs, startMs, endMs, windowMinutes)
      )) {
        sessionPRs.push(pr)
      }
    })

    // Attach deployments
    normalizedDeployments.forEach(deployment => {
      if ((!sessionRepo || deployment.repo === sessionRepo) && deployment.timestampMs && startMs) {
        const deploymentWindowMs = 7 * 24 * 60 * 60 * 1000 // 7 days
        if (deployment.timestampMs >= startMs && deployment.timestampMs <= startMs + deploymentWindowMs) {
          sessionDeployments.push(deployment)
        }
      }
    })

    return {
      sessionId,
      userId,
      tool,
      repo: sessionRepo,
      branch,
      startMs,
      endMs,
      durationMinutes,
      activeCodingMinutes,
      aiBurstCount,
      hasAI,
      focusRatio,
      idleRatio,
      timeToFirstCommitMinutes,
      charsAdded,
      charsRemoved,
      linesAdded,
      linesRemoved,
      raw: session,
      github: {
        commits: sessionCommits,
        prs: sessionPRs,
        deployments: sessionDeployments
      }
    }
  })

  // Calculate coverage
  const totalSessions = unifiedSessions.length
  const sessionsWithGithub = unifiedSessions.filter(s => 
    s.github.commits.length > 0 || s.github.prs.length > 0 || s.github.deployments.length > 0
  ).length
  const sessionsWithoutGithub = totalSessions - sessionsWithGithub
  const sessionsWithCommits = unifiedSessions.filter(s => s.github.commits.length > 0).length
  const sessionsWithPRs = unifiedSessions.filter(s => s.github.prs.length > 0).length
  const sessionsWithDeployments = unifiedSessions.filter(s => s.github.deployments.length > 0).length
  const totalCommits = unifiedSessions.reduce((sum, s) => sum + s.github.commits.length, 0)
  const totalPRs = unifiedSessions.reduce((sum, s) => sum + s.github.prs.length, 0)
  const totalDeployments = unifiedSessions.reduce((sum, s) => sum + s.github.deployments.length, 0)

  const tools: Record<string, number> = {}
  unifiedSessions.forEach(session => {
    tools[session.tool] = (tools[session.tool] || 0) + 1
  })

  const coverage: UnifiedCoverage = {
    totalSessions,
    sessionsWithGithub,
    sessionsWithoutGithub,
    sessionsWithCommits,
    sessionsWithPRs,
    sessionsWithDeployments,
    totalCommits,
    totalPRs,
    totalDeployments,
    commitAttachRatePct: totalSessions > 0 ? (sessionsWithCommits / totalSessions) * 100 : 0,
    prAttachRatePct: totalSessions > 0 ? (sessionsWithPRs / totalSessions) * 100 : 0,
    deploymentAttachRatePct: totalSessions > 0 ? (sessionsWithDeployments / totalSessions) * 100 : 0,
    tools
  }

  // STEP 3 — TRACE SESSION ROWS → UNIFIED SESSIONS
  console.log('[UNIFIED_SESSIONS_BUILD]', {
    inputSessions: sessionRows.length,
    outputSessions: unifiedSessions.length,
    sample: unifiedSessions.slice(0, 3)
  })

  // Debug logging for data scope verification
  console.log('[PI_DATA_SCOPE]', {
    totalSessions,
    withGithub: sessionsWithGithub,
    withoutGithub: sessionsWithoutGithub,
    commitAttachRate: `${totalSessions > 0 ? ((sessionsWithCommits / totalSessions) * 100).toFixed(1) : '0.0'}%`,
    prAttachRate: `${totalSessions > 0 ? ((sessionsWithPRs / totalSessions) * 100).toFixed(1) : '0.0'}%`,
    deploymentAttachRate: `${totalSessions > 0 ? ((sessionsWithDeployments / totalSessions) * 100).toFixed(1) : '0.0'}%`
  })

  const githubEntities: UnifiedGitHubEntities = {
    commits: normalizedCommits,
    prs: normalizedPRs,
    deployments: normalizedDeployments
  }

  return {
    unifiedSessions,
    coverage,
    githubEntities
  }
}
