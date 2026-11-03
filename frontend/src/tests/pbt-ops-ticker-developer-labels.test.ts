/**
 * PBT OPS TICKER: developer-label resolution regression
 *
 * Single-workflow Time Series is developer-grouped, so ticker cards carry
 * canonical developer ids. The ticker must use the authoritative
 * developerLabelById map and MUST NEVER render a raw internal id:
 *  - '90005' must resolve to 'Daniel Kim' (via the same map as the dropdown)
 *  - unknown developer ids are omitted, not rendered verbatim
 *  - 'local-demo-matt-overlay' / invite:* / raw aliases cannot appear
 *  - workflow-grouped ticker entries still use getCanonicalWorkflowIdentity
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const pbtPath = resolve(__dirname, '../components/ProductivityByToolV3.vue')
const pbtSource = readFileSync(pbtPath, 'utf-8')

// Isolate the operationalSignals computed block for scoped assertions
const tickerMatch = pbtSource.match(/const operationalSignals = computed\([\s\S]*?\n\}\)/)
const tickerBlock = tickerMatch ? tickerMatch[0] : ''

describe('PBT OPS TICKER developer-label authority', () => {
  it('ticker block exists', () => {
    expect(tickerBlock.length).toBeGreaterThan(0)
  })

  it('developer-grouped entries resolve through the authoritative developerLabelById map', () => {
    expect(tickerBlock).toContain("seriesDimension.value === 'developer'")
    expect(tickerBlock).toContain('developerLabelById.value.get(String(card.ide))')
  })

  it('unmapped developer ids are omitted — signal is skipped, never rendered verbatim', () => {
    expect(tickerBlock).toMatch(/if \(!devName\) return/)
  })

  it('no raw-id fallback remains in the developer branch', () => {
    // The previous defect: `?? String(card.ide)` let raw ids like 90005 render.
    expect(tickerBlock).not.toContain('?? String(card.ide)')
    expect(tickerBlock).not.toContain('|| String(card.ide)')
    // card.ide must never be interpolated into a signal directly.
    expect(tickerBlock).not.toMatch(/`\$\{card\.ide\}/)
  })

  it('workflow-grouped entries still use the canonical workflow identity label', () => {
    expect(tickerBlock).toContain('getCanonicalWorkflowIdentity(card.ide)')
  })

  it('developer display names come from the shared authoritative map, not a second identity system', () => {
    // developerLabelById is derived from availableDevelopers (the same source
    // used by the developer dropdown, filter chip, and drilldown).
    expect(pbtSource).toContain('developerLabelById = computed(() => new Map(availableDevelopers')
  })
})
