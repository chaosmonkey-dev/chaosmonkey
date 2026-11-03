import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ============================================================
// CR5 V1 FINAL DEMO CLOSURE — PBT Developer Dropdown
//
// Asserts:
// 1. Developer select renders when availableDevelopers = []
// 2. "All Developers" option exists
// 3. No fake developer options are added
// ============================================================

describe('PBT Developer Dropdown — always visible', () => {
  const componentPath = resolve(__dirname, '../components/ProductivityByToolV3.vue')
  const source = readFileSync(componentPath, 'utf-8')

  it('developer select does NOT have v-if="availableDevelopers.length > 0" gate', () => {
    // The old gate was: v-if="availableDevelopers.length > 0"
    // This must be removed so the dropdown always renders.
    const devSelectMatch = source.match(/<select[^>]*v-model="selectedDeveloper"[^>]*>/)
    expect(devSelectMatch).not.toBeNull()
    const selectTag = devSelectMatch![0]
    expect(selectTag).not.toContain('v-if="availableDevelopers.length')
  })

  it('"All Developers" option exists in the select', () => {
    const devSelectSection = source.match(/<select[^>]*v-model="selectedDeveloper"[^>]*>[\s\S]*?<\/select>/)
    expect(devSelectSection).not.toBeNull()
    expect(devSelectSection![0]).toContain('All Developers')
  })

  it('no fake developer names (Developer 1, Developer 2) are hardcoded', () => {
    const devSelectSection = source.match(/<select[^>]*v-model="selectedDeveloper"[^>]*>[\s\S]*?<\/select>/)
    expect(devSelectSection).not.toBeNull()
    const section = devSelectSection![0]
    expect(section).not.toMatch(/Developer\s+[12]/i)
    // Only real developer options from availableDevelopers should render
    expect(section).toContain('v-for="dev in availableDevelopers"')
  })
})
