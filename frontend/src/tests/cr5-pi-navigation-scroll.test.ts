import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ============================================================
// CR5 V1 — PI Navigation Scroll Regression
//
// P0 defect: Performance Insights previous/next arrow navigation
// caused the browser viewport (window.scrollY) to jump because
// scrollToActiveInsight() used document-level scrollIntoView().
//
// Fix: scrollToActiveInsight() now uses container-local scroll
// logic that only adjusts .pi-insight-list.scrollTop, never
// touching window.scrollY. The .pi-insight-list container is now
// a scroll container (overflow-y: auto, max-height).
//
// This test verifies the source contract:
// 1. No scrollIntoView call in scrollToActiveInsight
// 2. Container-local scroll logic uses scrollTop adjustment
// 3. The .pi-insight-list CSS makes it a scroll container
// 4. navigateToPreviousInsight / navigateToNextInsight exist
// 5. selectInsightById calls scrollToActiveInsight
// ============================================================

const componentPath = resolve(__dirname, '../components/PerformanceRecommendationsView.vue')
const source = readFileSync(componentPath, 'utf-8')

describe('PI Navigation Scroll — source contract', () => {
  it('1. scrollToActiveInsight does NOT use document-level scrollIntoView', () => {
    // The old code used: activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    // This must be gone from the scrollToActiveInsight function body
    const funcMatch = source.match(/function scrollToActiveInsight\(\)[\s\S]*?\n\}/)
    expect(funcMatch).not.toBeNull()
    const funcBody = funcMatch![0]
    expect(funcBody).not.toContain('scrollIntoView')
  })

  it('2. scrollToActiveInsight uses container-local scrollTop adjustment', () => {
    const funcMatch = source.match(/function scrollToActiveInsight\(\)[\s\S]*?\n\}/)
    expect(funcMatch).not.toBeNull()
    const funcBody = funcMatch![0]
    // Must query the container, not just the active element
    expect(funcBody).toContain('.pi-insight-list')
    // Must adjust container.scrollTop, not call scrollIntoView
    expect(funcBody).toContain('container.scrollTop')
  })

  it('3. .pi-insight-list CSS makes it a scroll container', () => {
    // Must have overflow-y: auto (or scroll) and max-height
    const cssMatch = source.match(/\.pi-insight-list\s*\{[^}]*overflow-y:\s*auto[^}]*\}/)
    expect(cssMatch).not.toBeNull()
    expect(cssMatch![0]).toContain('max-height')
  })

  it('4. navigateToPreviousInsight and navigateToNextInsight exist', () => {
    expect(source).toContain('navigateToPreviousInsight')
    expect(source).toContain('navigateToNextInsight')
  })

  it('5. selectInsightById calls scrollToActiveInsight', () => {
    const selectMatch = source.match(/function selectInsightById[\s\S]*?\n\}/)
    expect(selectMatch).not.toBeNull()
    expect(selectMatch![0]).toContain('scrollToActiveInsight')
  })

  it('6. no other scrollIntoView calls remain in the component', () => {
    // The only acceptable scrollIntoView would be in comments, not in active code
    // Check that no active code line contains scrollIntoView
    const lines = source.split('\n')
    const activeLines = lines.filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    const scrollIntoViewLines = activeLines.filter(l => l.includes('scrollIntoView'))
    // The fix should have removed all active scrollIntoView calls
    expect(scrollIntoViewLines.length).toBe(0)
  })

  it('7. scrollToActiveInsight guards against null container and null active element', () => {
    const funcMatch = source.match(/function scrollToActiveInsight\(\)[\s\S]*?\n\}/)
    expect(funcMatch).not.toBeNull()
    const funcBody = funcMatch![0]
    expect(funcBody).toContain('if (!container)')
    expect(funcBody).toContain('if (!activeElement)')
  })
})
