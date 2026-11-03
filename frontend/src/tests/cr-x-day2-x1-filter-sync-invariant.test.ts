/**
 * CR-X Day 2 X1 FIX: Filter/canonical query synchronization invariant
 *
 * The invariant that must hold at all times:
 *   VISIBLE FILTER CONTROLS
 *   == VISIBLE ACTIVE FILTER CHIPS
 *   == QUERY STORE / ANALYSIS CONTEXT
 *   == CANONICAL REQUEST PARAMETERS
 *   == metadata.filters_applied
 *
 * Bug: On component remount, selectedDeveloper/selectedRepo were hardcoded
 * to '' while analysisContext (Pinia store) retained stale developer/repo
 * filters from a previous interaction. The watchers only sync local→store
 * on *change*, so the store wasn't cleared. Result: dropdowns showed
 * "All Developers" / "All Repos" while the canonical request contained
 * developer_ids and repos from the stale store.
 *
 * Fix: Initialize local refs from analysisContext on setup, and add reverse
 * watchers to sync store→local when the store changes externally.
 *
 * Required regression coverage:
 * - All Developers + All Repos -> no developer_ids/repos in canonical request
 * - developer selected -> control/chip/query all agree
 * - repo selected -> control/chip/query all agree
 * - developer+repo selected -> intersection and all UI state agree
 * - Reset -> controls say All, chips disappear, canonical request omits both
 * - component remount / restored store state cannot visually lie about active scope
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const pbtPath = resolve(__dirname, '../components/ProductivityByToolV3.vue')
const pbtSource = readFileSync(pbtPath, 'utf-8')

const analysisContextPath = resolve(__dirname, '../stores/analysisContext.ts')
const analysisContextSource = readFileSync(analysisContextPath, 'utf-8')

describe('CR-X Day 2 X1 FIX: Filter/canonical query synchronization invariant', () => {
  it('selectedDeveloper initializes from analysisContext.developerIds, not hardcoded ""', () => {
    // The initialization must read from analysisContext, not a hardcoded ''
    expect(pbtSource).toMatch(/selectedDeveloper\s*=\s*ref\(analysisContext\.developerIds/)
  })

  it('selectedRepo initializes from analysisContext.repoIds, not hardcoded ""', () => {
    expect(pbtSource).toMatch(/selectedRepo\s*=\s*ref\(analysisContext\.repoIds/)
  })

  it('reverse watcher: analysisContext.developerIds -> selectedDeveloper exists', () => {
    // There must be a watcher that syncs analysisContext.developerIds back to
    // selectedDeveloper so external store changes (PI, restore) reflect in UI
    expect(pbtSource).toMatch(/watch\(\(\)\s*=>\s*analysisContext\.developerIds/)
  })

  it('reverse watcher: analysisContext.repoIds -> selectedRepo exists', () => {
    expect(pbtSource).toMatch(/watch\(\(\)\s*=>\s*analysisContext\.repoIds/)
  })

  it('reverse watchers have loop guards (only update when value differs)', () => {
    // The reverse watchers must check equality before updating to prevent
    // infinite loops: selectedDeveloper -> analysisContext -> selectedDeveloper
    const reverseWatcherSection = pbtSource.match(
      /watch\(\(\)\s*=>\s*analysisContext\.developerIds[\s\S]*?\}\)/
    )
    expect(reverseWatcherSection).toBeTruthy()
    expect(reverseWatcherSection![0]).toContain('!==')
  })

  it('resetFilters clears analysisContext (not just filterStore)', () => {
    const resetSection = pbtSource.match(/const resetFilters[\s\S]*?analysisContext\.reset\(\)/)
    expect(resetSection).toBeTruthy()
    expect(resetSection![0]).toContain('analysisContext.reset()')
  })

  it('productivityQuery reads developerIds from analysisContext, not filterStore', () => {
    // The query must read from analysisContext (the shared read authority)
    // so PI and PBT describe the same population
    const querySection = pbtSource.match(/const productivityQuery = computed[\s\S]*?\n\}\)/)
    expect(querySection).toBeTruthy()
    expect(querySection![0]).toContain('analysisContext.developerIds')
    expect(querySection![0]).toContain('analysisContext.repoIds')
  })

  it('analysisContext store has reset() that clears developerIds and repoIds', () => {
    expect(analysisContextSource).toMatch(/function reset\(\)[\s\S]*?developerIds\.value\s*=\s*\[\]/)
    expect(analysisContextSource).toMatch(/function reset\(\)[\s\S]*?repoIds\.value\s*=\s*\[\]/)
  })

  it('active filter chips are bound to selectedDeveloper/selectedRepo (not store)', () => {
    // Chips must be v-if="selectedDeveloper" and v-if="selectedRepo"
    // so they disappear when the dropdowns say "All"
    expect(pbtSource).toMatch(/v-if="selectedDeveloper"\s+class="v3-active-filter-chip"/)
    expect(pbtSource).toMatch(/v-if="selectedRepo"\s+class="v3-active-filter-chip"/)
  })

  it('dropdown v-model binds to selectedDeveloper/selectedRepo', () => {
    expect(pbtSource).toMatch(/v-model="selectedDeveloper"/)
    expect(pbtSource).toMatch(/v-model="selectedRepo"/)
  })
})
