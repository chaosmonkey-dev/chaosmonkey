import { describe, it, expect } from 'vitest'
import { enrichCanonicalSessions } from '../lib/insights/final/dataAccess'

/**
 * CR-X 2026-08-30 — Cross-env enrichment join robustness.
 *
 * Proves that enrichCanonicalSessions() enriches correctly in BOTH:
 *   - Local shape: canonical.session_id is numeric DB row id, enriched
 *     rows indexed by `id` (numeric). Join = session_id === id.
 *   - Ed shape: canonical.session_id is string UUID, enriched rows
 *     indexed by `session_id` (UUID). Join = session_id === session_id.
 *
 * The enriched map is dual-indexed (by both `id` and `session_id`), so a
 * single lookup by canonical.session_id resolves in both environments.
 *
 * Discovered via the Ed census (docs/final/CR-X-ED-CENSUS-2026-08-30.md):
 * the prior join (canonical.session_id === enriched.id only) matched 0
 * on Ed because Ed's canonical.session_id is a UUID while enriched.id is
 * numeric. Ed's PI engine was receiving UNENRICHED canonical rows.
 */
describe('CR-X: Cross-env enrichment join robustness', () => {
  it('Local shape (numeric session_id === enriched.id): full enrichment', () => {
    const canonical = [
      { session_id: 40985, tool: 'vscode', duration_ms: 600000 },
      { session_id: 40986, tool: 'claude_code', duration_ms: 1800000 },
    ]
    // Local enriched rows: id is numeric, session_id is UUID string.
    // Map is dual-indexed by both id and session_id.
    const enriched = new Map<number | string, any>()
    enriched.set(40985, { id: 40985, session_id: 'session_local_1', focus_ratio: 0.25, file_save_count: 3, simulated: false })
    enriched.set(40986, { id: 40986, session_id: 'session_local_2', focus_ratio: 0.0, file_save_count: 0, simulated: false })
    // Also index by session_id (as _fetchEnrichedSessionsMapImpl now does)
    enriched.set('session_local_1', { id: 40985, session_id: 'session_local_1', focus_ratio: 0.25, file_save_count: 3, simulated: false })
    enriched.set('session_local_2', { id: 40986, session_id: 'session_local_2', focus_ratio: 0.0, file_save_count: 0, simulated: false })

    const stats = enrichCanonicalSessions(canonical, enriched)
    expect(stats.canonicalCount).toBe(2)
    expect(stats.enrichedMatchCount).toBe(2)
    expect(canonical[0].focus_ratio).toBe(0.25)
    expect(canonical[0].file_save_count).toBe(3)
    expect(canonical[1].focus_ratio).toBe(0.0)
  })

  it('Ed shape (UUID session_id === enriched.session_id): full enrichment', () => {
    const canonical = [
      { session_id: 'session_1788052133367_fktk2an', tool: 'vscode', duration_ms: 600000 },
      { session_id: 'session_1788052133368_abc1234', tool: 'claude_code', duration_ms: 1800000 },
    ]
    // Ed enriched rows: id is numeric, session_id is UUID string.
    // Map is dual-indexed by both id and session_id.
    const enriched = new Map<number | string, any>()
    enriched.set(21931, { id: 21931, session_id: 'session_1788052133367_fktk2an', focus_ratio: 0.235, file_save_count: 2, simulated: false })
    enriched.set(21932, { id: 21932, session_id: 'session_1788052133368_abc1234', focus_ratio: 0.0, file_save_count: 0, simulated: false })
    enriched.set('session_1788052133367_fktk2an', { id: 21931, session_id: 'session_1788052133367_fktk2an', focus_ratio: 0.235, file_save_count: 2, simulated: false })
    enriched.set('session_1788052133368_abc1234', { id: 21932, session_id: 'session_1788052133368_abc1234', focus_ratio: 0.0, file_save_count: 0, simulated: false })

    const stats = enrichCanonicalSessions(canonical, enriched)
    expect(stats.canonicalCount).toBe(2)
    expect(stats.enrichedMatchCount).toBe(2)
    expect(canonical[0].focus_ratio).toBe(0.235)
    expect(canonical[0].file_save_count).toBe(2)
    expect(canonical[1].focus_ratio).toBe(0.0)
  })

  it('Ed shape with OLD single-index (id only) would match 0 — regression guard', () => {
    // Simulate the OLD broken map (only indexed by numeric id, not session_id).
    // This proves the bug: canonical.session_id (UUID) !== enriched.id (numeric).
    const canonical = [
      { session_id: 'session_1788052133367_fktk2an', tool: 'vscode', duration_ms: 600000 },
    ]
    const oldBrokenMap = new Map<number | string, any>()
    // OLD behavior: only indexed by numeric id
    oldBrokenMap.set(21931, { id: 21931, session_id: 'session_1788052133367_fktk2an', focus_ratio: 0.235 })

    const stats = enrichCanonicalSessions(canonical, oldBrokenMap)
    // With the old map, no match (UUID !== numeric id)
    expect(stats.enrichedMatchCount).toBe(0)
    expect(canonical[0].focus_ratio).toBeUndefined()
  })

  it('mixed environment (some numeric, some UUID) resolves each by its own key', () => {
    const canonical = [
      { session_id: 100, tool: 'vscode' },              // numeric (Local-style)
      { session_id: 'session_uuid_2', tool: 'claude_code' }, // UUID (Ed-style)
    ]
    const enriched = new Map<number | string, any>()
    enriched.set(100, { id: 100, session_id: 'session_uuid_1', focus_ratio: 0.3 })
    enriched.set('session_uuid_1', { id: 100, session_id: 'session_uuid_1', focus_ratio: 0.3 })
    enriched.set(200, { id: 200, session_id: 'session_uuid_2', focus_ratio: 0.0 })
    enriched.set('session_uuid_2', { id: 200, session_id: 'session_uuid_2', focus_ratio: 0.0 })

    const stats = enrichCanonicalSessions(canonical, enriched)
    expect(stats.enrichedMatchCount).toBe(2)
    expect(canonical[0].focus_ratio).toBe(0.3)
    expect(canonical[1].focus_ratio).toBe(0.0)
  })

  it('canonical membership is immutable — no rows added or dropped', () => {
    const canonical = [
      { session_id: 'uuid_1', tool: 'vscode' },
      { session_id: 'uuid_2', tool: 'claude_code' },
      { session_id: 'uuid_3', tool: 'vscode' }, // no enriched match
    ]
    const enriched = new Map<number | string, any>()
    enriched.set(1, { id: 1, session_id: 'uuid_1', focus_ratio: 0.2 })
    enriched.set('uuid_1', { id: 1, session_id: 'uuid_1', focus_ratio: 0.2 })
    enriched.set(2, { id: 2, session_id: 'uuid_2', focus_ratio: 0.1 })
    enriched.set('uuid_2', { id: 2, session_id: 'uuid_2', focus_ratio: 0.1 })
    // enriched-only row that must NOT enter canonical
    enriched.set(999, { id: 999, session_id: 'uuid_999', focus_ratio: 0.9 })
    enriched.set('uuid_999', { id: 999, session_id: 'uuid_999', focus_ratio: 0.9 })

    const before = canonical.length
    const stats = enrichCanonicalSessions(canonical, enriched)
    expect(canonical.length).toBe(before)
    expect(stats.canonicalCount).toBe(3)
    expect(stats.enrichedMatchCount).toBe(2)
    expect(canonical.find(r => r.session_id === 'uuid_999')).toBeUndefined()
  })
})
