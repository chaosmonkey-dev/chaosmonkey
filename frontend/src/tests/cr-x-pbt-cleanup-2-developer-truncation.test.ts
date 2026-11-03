/**
 * CR-X PBT-CLEANUP-2 behavioral regression test.
 *
 * fetchDevelopers() in ProductivityByToolV3.vue previously hard-truncated
 * the backend-curated developer list to the first 12 entries via
 * `.slice(0, 12)`. The backend (/api/developers) already excludes
 * opaque/anonymous/legacy IDs and returns the authoritative curated list —
 * a client-side cap silently hid real developers for any org with more
 * than 12 developers, with no indication to the user.
 *
 * The mapping logic is now extracted into mapCuratedDevelopers() so it can
 * be exercised behaviorally with real fixtures rather than grepping source
 * text for the absence of a string.
 */
import { describe, it, expect } from 'vitest'
import { mapCuratedDevelopers, type CuratedDeveloper } from '../lib/pbt/mapCuratedDevelopers'

describe('CR-X PBT-CLEANUP-2: developer dropdown does not truncate (behavioral)', () => {
  // Build a fixture with 15 curated developers — above the old 12-cap.
  const fixture: CuratedDeveloper[] = Array.from({ length: 15 }, (_, i) => ({
    id: 90001 + i,
    label: `Developer ${i + 1}`,
    workflows: i % 2 === 0 ? ['devin', 'vscode'] : ['cursor'],
  }))

  it('all 15 developers remain available after mapping (no truncation)', () => {
    const result = mapCuratedDevelopers(fixture)
    expect(result).toHaveLength(15)
    // Verify every fixture entry is present by id
    for (let i = 0; i < 15; i++) {
      expect(result[i].id).toBe(String(90001 + i))
    }
  })

  it('IDs are string-normalized (not left as numbers)', () => {
    const result = mapCuratedDevelopers(fixture)
    for (const dev of result) {
      expect(typeof dev.id).toBe('string')
      // A numeric id coerced to string must not be 'NaN' or empty
      expect(dev.id).not.toBe('')
      expect(dev.id).not.toBe('NaN')
    }
  })

  it('workflow metadata is preserved for every developer', () => {
    const result = mapCuratedDevelopers(fixture)
    for (let i = 0; i < 15; i++) {
      const expected = i % 2 === 0 ? ['devin', 'vscode'] : ['cursor']
      expect(result[i].workflows).toEqual(expected)
    }
  })

  it('absent workflows field defaults to empty array, not undefined', () => {
    const withoutWorkflows: CuratedDeveloper[] = [
      { id: 1, label: 'Dev A' },
      { id: 2, label: 'Dev B' },
    ]
    const result = mapCuratedDevelopers(withoutWorkflows)
    expect(result[0].workflows).toEqual([])
    expect(result[1].workflows).toEqual([])
  })

  it('selecting a developer by id from the mapped list drives the filter path', () => {
    // The PBT component uses selectedDeveloper.value to filter sessions:
    //   const devId = s.developer_id || s.user_id || s.developerId
    //   return devId === selectedDeveloper.value
    // This proves the mapped id is usable as a filter key against sessions
    // that carry the same developer_id as a string.
    const result = mapCuratedDevelopers(fixture)
    const selectedId = result[7].id // pick the 8th developer

    // Simulate session rows that carry developer_id as a string
    const sessions = [
      { developer_id: result[3].id, duration_ms: 1000 },
      { developer_id: selectedId, duration_ms: 2000 },
      { developer_id: result[12].id, duration_ms: 3000 },
    ]

    const filtered = sessions.filter(s => s.developer_id === selectedId)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].duration_ms).toBe(2000)
  })

  it('a list of 20+ developers is also fully preserved', () => {
    const largeFixture: CuratedDeveloper[] = Array.from({ length: 25 }, (_, i) => ({
      id: `dev-${i + 1}`,
      label: `Dev ${i + 1}`,
      workflows: ['vscode'],
    }))
    const result = mapCuratedDevelopers(largeFixture)
    expect(result).toHaveLength(25)
  })
})
