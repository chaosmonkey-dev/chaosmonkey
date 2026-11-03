import { describe, it, expect } from 'vitest'
import { addDerivedSessionFields, enrichCanonicalSessions } from '../lib/insights/final/dataAccess'
import { computeObservedCommitTtfcByWorkflow } from '../lib/insights/final/observedCommitAuthority'
import { normalizeToCanonicalToolId } from '../lib/workflowIdentity'

/**
 * CR5 WS1 P0 FIX #3 — Shared enriched canonical result tests.
 *
 * Proves that the PI engine and AIOI consume the SAME enriched canonical
 * population, with exact membership preservation and provenance fields
 * present on PI input rows.
 */
describe('CR5 WS1 P0 #3: Shared enriched canonical result', () => {
  it('shared enriched result preserves exact canonical membership (no rows added/dropped)', () => {
    const canonical = [
      { session_id: 1, tool: 'cursor', commit_count: 2 },
      { session_id: 2, tool: 'vscode', commit_count: 0 },
      { session_id: 3, tool: 'devin', commit_count: 5 },
      { session_id: 4, tool: 'windsurf', commit_count: 3 },
      { session_id: 5, tool: 'claude_code', commit_count: 1 },
    ]
    const enriched = new Map([
      [1, { id: 1, session_has_commit_outcome: true, simulated: false, session_commits: 2 }],
      [2, { id: 2, session_has_commit_outcome: false, simulated: false, session_commits: 0 }],
      [3, { id: 3, session_has_commit_outcome: true, simulated: false, session_commits: 4 }],
      [4, { id: 4, session_has_commit_outcome: true, simulated: false, session_commits: 3 }],
      // 5 has no enriched match
    ])
    const before = canonical.length
    const stats = enrichCanonicalSessions(canonical, enriched)
    expect(canonical.length).toBe(before) // exact membership preserved
    expect(stats.canonicalCount).toBe(5)
    expect(stats.enrichedMatchCount).toBe(4)
  })

  it('no enriched-only rows enter canonical population', () => {
    const canonical = [
      { session_id: 1, tool: 'cursor' },
      { session_id: 2, tool: 'vscode' },
    ]
    const enriched = new Map([
      [1, { id: 1, session_has_commit_outcome: true, simulated: false, session_commits: 2 }],
      [2, { id: 2, session_has_commit_outcome: false, simulated: false, session_commits: 0 }],
      [99, { id: 99, session_has_commit_outcome: true, simulated: false, session_commits: 10 }], // enriched-only
    ])
    enrichCanonicalSessions(canonical, enriched)
    expect(canonical.length).toBe(2) // no enriched-only rows added
    expect(canonical.find(r => r.session_id === 99)).toBeUndefined()
  })

  it('PI input rows contain provenance fields after enrichment + classification', () => {
    const canonical = [
      { session_id: 1, tool: 'cursor', commit_count: 2 },
    ]
    const enriched = new Map([
      [1, { id: 1, session_has_commit_outcome: true, simulated: false, session_commits: 3, time_to_first_commit_ms: 120000 }],
    ])
    enrichCanonicalSessions(canonical, enriched)
    addDerivedSessionFields(canonical)

    const row = canonical[0]
    expect('session_commits_source' in row).toBe(true)
    expect('ttfc_source' in row).toBe(true)
    expect('session_has_commit_outcome' in row).toBe(true)
    expect('simulated' in row).toBe(true)
    expect('ttfc_from_enriched' in row).toBe(true)
    expect(row.session_commits_source).toBe('observed')
  })

  it('AIOI authority is derived from the same enriched result', () => {
    const canonical = [
      { session_id: 1, tool: 'cursor', commit_count: 2 },
      { session_id: 2, tool: 'cursor', commit_count: 0 },
      { session_id: 3, tool: 'devin', commit_count: 5 },
    ]
    const enriched = new Map([
      [1, { id: 1, session_has_commit_outcome: true, simulated: false, session_commits: 2, time_to_first_commit_ms: 120000 }],
      [2, { id: 2, session_has_commit_outcome: true, simulated: false, session_commits: 4, time_to_first_commit_ms: 180000 }],
      [3, { id: 3, session_has_commit_outcome: true, simulated: false, session_commits: 3, time_to_first_commit_ms: 1320000 }],
    ])
    enrichCanonicalSessions(canonical, enriched)
    addDerivedSessionFields(canonical)

    // AIOI authority derived from the SAME enriched rows
    const authority = computeObservedCommitTtfcByWorkflow(canonical)

    // Cursor: (2+4)/2 = 3.0 commits/session, (120000+180000)/2/60000 = 2.5 min
    const cursor = authority.get('cursor')!
    expect(cursor.commitsPerSession).toBeCloseTo(3.0, 5)
    expect(cursor.ttfcMinutes).toBeCloseTo(2.5, 5)
    expect(cursor.observedCommitSessionCount).toBe(2)

    // Devin: 3 commits/session, 22 min TTFC
    const devin = authority.get('devin')!
    expect(devin.commitsPerSession).toBeCloseTo(3.0, 5)
    expect(devin.ttfcMinutes).toBeCloseTo(22.0, 5)
    expect(devin.observedCommitSessionCount).toBe(1)
  })

  it('workflow aliasing (windsurf→devin) remains unchanged in shared result', () => {
    const canonical = [
      { session_id: 1, tool: 'windsurf', commit_count: 2 },
      { session_id: 2, tool: 'devin', commit_count: 5 },
    ]
    const enriched = new Map([
      [1, { id: 1, session_has_commit_outcome: true, simulated: false, session_commits: 2 }],
      [2, { id: 2, session_has_commit_outcome: true, simulated: false, session_commits: 4 }],
    ])
    enrichCanonicalSessions(canonical, enriched)
    addDerivedSessionFields(canonical)
    const authority = computeObservedCommitTtfcByWorkflow(canonical)

    expect(authority.has('devin')).toBe(true)
    expect(authority.has('windsurf')).toBe(false) // aliased to devin
    const devin = authority.get('devin')!
    expect(devin.observedCommitSessionCount).toBe(2) // windsurf + devin
    expect(devin.commitsPerSession).toBeCloseTo(3.0, 5) // (2+4)/2
  })

  it('normalizeToCanonicalToolId: windsurf→devin alias invariant', () => {
    expect(normalizeToCanonicalToolId('windsurf')).toBe('devin')
    expect(normalizeToCanonicalToolId('devin')).toBe('devin')
    expect(normalizeToCanonicalToolId('cursor')).toBe('cursor')
    expect(normalizeToCanonicalToolId('vscode')).toBe('vscode')
    expect(normalizeToCanonicalToolId('claude_code')).toBe('claude_code')
    expect(normalizeToCanonicalToolId('github_copilot')).toBe('github_copilot')
  })

  it('canonical rows without enriched match still preserved (provenance falls back)', () => {
    const canonical = [
      { session_id: 1, tool: 'cursor', commit_count: 2 },
      { session_id: 2, tool: 'vscode', commit_count: 0 }, // no enriched match
    ]
    const enriched = new Map([
      [1, { id: 1, session_has_commit_outcome: true, simulated: false, session_commits: 2 }],
    ])
    enrichCanonicalSessions(canonical, enriched)
    addDerivedSessionFields(canonical)

    expect(canonical.length).toBe(2) // both preserved
    expect(canonical[0].session_commits_source).toBe('observed') // enriched
    expect(canonical[1].session_commits_source).not.toBe('observed') // fallback
  })
})
