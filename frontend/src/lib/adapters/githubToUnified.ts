/**
 * GitHub to Unified Metrics Adapter
 * 
 * Pure adapter that maps GitHub snapshot data into UnifiedEvent format.
 * No side effects, no store imports, no network calls.
 */

import { UnifiedEvent, UnifiedMetricId, metricKind, Scope } from '../../types/unified'

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Minimal shape of GitHub data after transformation in github store
 */
export interface GithubSnapshot {
  total_pull_requests: number
  merged_pull_requests: number
  reopened_pull_requests?: number
  rejected_pull_requests?: number
  avg_time_to_merge_hours?: number
  comment_to_merge_ratio?: number
  deployments?: number
  mttr_hours?: number
  ts: string            // ISO bucket time
  repo?: string
}

/**
 * Parameters for mapping GitHub snapshots to unified events
 */
export interface MapParams {
  snapshots: GithubSnapshot[]
  scope: Scope                  // 'org' | 'team' | 'dev'
  orgId?: string
  teamId?: string
  developerId?: string
  repo?: string
}

// ============================================================================
// MAPPING LOGIC
// ============================================================================

/**
 * Maps GitHub snapshot data to unified events
 */
export function mapGithubSnapshotToUnified(params: MapParams): UnifiedEvent[] {
  const { snapshots, scope, orgId, teamId, developerId, repo } = params
  const events: UnifiedEvent[] = []

  // Runtime guard: ensure snapshots is an array
  if (!Array.isArray(snapshots)) {
    console.warn('mapGithubSnapshotToUnified: snapshots must be an array')
    return []
  }

  for (const snapshot of snapshots) {
    // Runtime guard: ensure snapshot is an object
    if (!snapshot || typeof snapshot !== 'object') {
      console.warn('mapGithubSnapshotToUnified: skipping invalid snapshot', snapshot)
      continue
    }

    // Runtime guard: ensure timestamp exists
    if (!snapshot.ts || typeof snapshot.ts !== 'string') {
      console.warn('mapGithubSnapshotToUnified: skipping snapshot without valid timestamp', snapshot)
      continue
    }

    // Map each metric that exists in the snapshot
    const metricMappings: Array<{ metric: UnifiedMetricId; value: number }> = [
      { metric: 'gh.pr_opened', value: snapshot.total_pull_requests },
      { metric: 'gh.pr_merged', value: snapshot.merged_pull_requests },
      { metric: 'gh.pr_reopened', value: snapshot.reopened_pull_requests },
      { metric: 'gh.pr_rejected', value: snapshot.rejected_pull_requests },
      { metric: 'gh.time_to_merge_hours', value: snapshot.avg_time_to_merge_hours },
      { metric: 'gh.comment_to_merge_ratio', value: snapshot.comment_to_merge_ratio },
      { metric: 'gh.deployments', value: snapshot.deployments },
      { metric: 'gh.mttr_hours', value: snapshot.mttr_hours }
    ]

    for (const mapping of metricMappings) {
      // Skip metrics that are undefined or null
      if (mapping.value === undefined || mapping.value === null) {
        continue
      }

      // Runtime guard: ensure value is a number
      if (typeof mapping.value !== 'number' || isNaN(mapping.value)) {
        console.warn('mapGithubSnapshotToUnified: skipping invalid value for metric', mapping.metric, mapping.value)
        continue
      }

      // Create the unified event
      const event: UnifiedEvent = {
        metric: mapping.metric,
        kind: metricKind(mapping.metric),
        value: mapping.value,
        timestamp: snapshot.ts,
        source: 'github',
        scope,
        orgId,
        teamId,
        developerId,
        repo: snapshot.repo || repo
      }

      events.push(event)
    }
  }

  return events
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validates that a snapshot has the minimum required fields
 */
export function isValidGithubSnapshot(snapshot: unknown): snapshot is GithubSnapshot {
  if (!snapshot || typeof snapshot !== 'object') {
    return false
  }

  const s = snapshot as Record<string, unknown>
  
  return (
    typeof s.total_pull_requests === 'number' &&
    typeof s.merged_pull_requests === 'number' &&
    typeof s.ts === 'string'
  )
}

/**
 * Filters out invalid snapshots from an array
 */
export function filterValidSnapshots(snapshots: unknown[]): GithubSnapshot[] {
  return snapshots.filter(isValidGithubSnapshot)
}

/**
 * Gets the count of events that would be generated from snapshots
 */
export function getEventCount(snapshots: GithubSnapshot[]): number {
  let count = 0
  
  for (const snapshot of snapshots) {
    const metrics = [
      snapshot.total_pull_requests,
      snapshot.merged_pull_requests,
      snapshot.reopened_pull_requests,
      snapshot.rejected_pull_requests,
      snapshot.avg_time_to_merge_hours,
      snapshot.comment_to_merge_ratio,
      snapshot.deployments,
      snapshot.mttr_hours
    ]
    
    count += metrics.filter(value => value !== undefined && value !== null && !isNaN(value)).length
  }
  
  return count
}

/**
 * Groups events by metric for analysis
 */
export function groupEventsByMetric(events: UnifiedEvent[]): Record<UnifiedMetricId, UnifiedEvent[]> {
  const grouped: Record<string, UnifiedEvent[]> = {}
  
  for (const event of events) {
    if (!grouped[event.metric]) {
      grouped[event.metric] = []
    }
    grouped[event.metric].push(event)
  }
  
  return grouped as Record<UnifiedMetricId, UnifiedEvent[]>
}

/**
 * Gets unique repositories from events
 */
export function getUniqueRepos(events: UnifiedEvent[]): string[] {
  const repos = new Set<string>()
  
  for (const event of events) {
    if (event.repo) {
      repos.add(event.repo)
    }
  }
  
  return Array.from(repos)
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Creates a mock GitHub snapshot for testing
 */
export function createMockGithubSnapshot(overrides: Partial<GithubSnapshot> = {}): GithubSnapshot {
  return {
    total_pull_requests: 10,
    merged_pull_requests: 8,
    reopened_pull_requests: 1,
    rejected_pull_requests: 1,
    avg_time_to_merge_hours: 24.5,
    comment_to_merge_ratio: 3.2,
    deployments: 5,
    mttr_hours: 2.1,
    ts: new Date().toISOString(),
    repo: 'test/repo',
    ...overrides
  }
}

/**
 * Creates mock map parameters for testing
 */
export function createMockMapParams(overrides: Partial<MapParams> = {}): MapParams {
  return {
    snapshots: [createMockGithubSnapshot()],
    scope: 'org',
    orgId: 'test-org',
    teamId: 'test-team',
    developerId: 'test-dev',
    repo: 'test/repo',
    ...overrides
  }
}






