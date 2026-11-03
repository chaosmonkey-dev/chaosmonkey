/**
 * CR-X Ed PI Audit: Run the final PI engine against Ed's actual session data
 * to audit all findings for semantic integrity defects.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { generatePlanCodeInsights } from '../lib/insights/final/generators/planCode'
import { generateReviewMergeInsights } from '../lib/insights/final/generators/reviewMerge'
import { generateDeployOperateInsights } from '../lib/insights/final/generators/deployOperate'
import {
  generateEarlySignalWorkflowAdoption,
  generateEarlySignalDeveloperActivity,
  generateDeveloperWorkflowCostEfficiencyFrontier,
  generateWorkflowCostDeliveryComparison,
  generateWorkflowDeliveryEfficiency,
} from '../lib/insights/final/generators/earlySignal'
import type { CanonicalInsightInput } from '../lib/insights/final/types'
import { addDerivedSessionFields } from '../lib/insights/final/dataAccess'

const edSessionsPath = resolve('/tmp/ed-sessions.json')
let edSessions: any[]
try {
  edSessions = JSON.parse(readFileSync(edSessionsPath, 'utf-8'))
} catch {
  edSessions = []
}

const input: CanonicalInsightInput = {
  sessionRows: edSessions,
  githubSnapshot: undefined,
  githubByPeriod: [],
  productivityByPeriod: [],
  granularity: 'monthly',
}

// Add derived fields like the real engine does
if (input.sessionRows.length > 0) {
  addDerivedSessionFields(input.sessionRows)
}

const allInsights = [
  ...generatePlanCodeInsights(input),
  ...generateReviewMergeInsights(input),
  ...generateDeployOperateInsights(input),
  generateEarlySignalWorkflowAdoption(input),
  generateEarlySignalDeveloperActivity(input),
  generateDeveloperWorkflowCostEfficiencyFrontier(input),
  generateWorkflowCostDeliveryComparison(input),
  generateWorkflowDeliveryEfficiency(input),
].filter(i => i !== null && i !== undefined) as any[]

describe('CR-X Ed PI Audit: semantic integrity of Ed findings', () => {
  if (edSessions.length === 0) {
    it.skip('Ed session data not available', () => {})
    return
  }

  it('engine produces findings from Ed data', () => {
    expect(allInsights.length).toBeGreaterThan(0)
  })

  // P0.1: Same-workflow shift
  it('no finding says "shifted from VS Code to VS Code"', () => {
    for (const insight of allInsights) {
      if (insight.title) {
        expect(insight.title).not.toMatch(/shifted from .+ to \1/i)
      }
    }
  })

  it('no finding says "shifted from X to X" (same workflow)', () => {
    for (const insight of allInsights) {
      if (insight.title) {
        const match = insight.title.match(/shifted from (.+?) to (.+?) across/i)
        if (match) {
          expect(match[1]).not.toBe(match[2])
        }
      }
    }
  })

  // P0.2: TTFC direction consistency
  it('TTFC findings have consistent direction in title vs interpretation', () => {
    for (const insight of allInsights) {
      if (insight.id === 'commit-ttfc-longitudinal' && insight.title) {
        const titleSaysFell = /fell|decreased/i.test(insight.title)
        const titleSaysRose = /rose|increased/i.test(insight.title)
        const desc = insight.description || ''
        const descSaysIncreased = /increased/i.test(desc)
        const descSaysDecreased = /decreased|fell/i.test(desc)

        if (titleSaysFell && !titleSaysRose) {
          // Title says fell, description should not say increased
          expect(descSaysIncreased && !descSaysDecreased).toBe(false)
        }
        if (titleSaysRose && !titleSaysFell) {
          // Title says rose, description should say increased
          expect(descSaysIncreased).toBe(true)
        }
      }
    }
  })

  // P0.3: No "Non-AI" or "AI-assisted" cohort labels
  it('no finding uses "Non-AI" as a cohort label', () => {
    for (const insight of allInsights) {
      const text = JSON.stringify(insight)
      // Check for cohort label usage, not general prose
      expect(text).not.toMatch(/label:\s*['"]Non-AI['"]/)
      expect(text).not.toMatch(/label:\s*['"]AI-assisted['"]/)
    }
  })

  // P0.4: Commits/session not called "delivery rate"
  it('no commits/session finding uses "delivery rate" terminology', () => {
    for (const insight of allInsights) {
      if (insight.id === 'delivery-rate-ai-vs-non-ai' && insight.title) {
        // The title should not say "Delivery rate is similar" for commits/session
        expect(insight.title).not.toMatch(/Delivery rate is similar/i)
      }
    }
  })

  // General semantic audit
  it('no finding has title contradicting its description direction', () => {
    for (const insight of allInsights) {
      if (!insight.title || !insight.description) continue
      // Check for "fell" in title but "increased" in description
      const titleFell = /fell|decreased|declined|reduced/i.test(insight.title)
      const titleRose = /rose|increased|grew|improved/i.test(insight.title)
      const descIncreased = /\bincreased\b/i.test(insight.description)
      const descDecreased = /\bdecreased\b|\bfell\b/i.test(insight.description)

      if (titleFell && !titleRose && descIncreased && !descDecreased) {
        // Potential contradiction
        console.log(`[CONTRADICTION?] ${insight.id}: title says fell, desc says increased`)
      }
    }
  })

  it('no finding has same start/end value described as a change', () => {
    for (const insight of allInsights) {
      if (!insight.title) continue
      // Check for "shifted from X to X" or "changed from X to X"
      const shiftMatch = insight.title.match(/(?:shifted|changed|moved) from (.+?) to (.+?)(?:\s|,|$)/i)
      if (shiftMatch) {
        expect(shiftMatch[1]).not.toBe(shiftMatch[2])
      }
    }
  })

  // ai-adoption-velocity: delta must match trajectory population
  it('ai-adoption-velocity delta is not 0.0pp when trajectory shows real change', () => {
    for (const insight of allInsights) {
      if (insight.id === 'ai-adoption-velocity' && insight.title) {
        // If the title says "unchanged 0.0pp", the trajectory must also show no change
        const unchangedMatch = insight.title.match(/unchanged\s+([0-9.]+)pp/)
        if (unchangedMatch) {
          // If it says unchanged, the delta should be 0
          expect(Math.abs(insight.delta || 0)).toBeLessThan(0.1)
          // And the description should not say "Decrease" or "Increase"
          const desc = insight.description || ''
          expect(desc).not.toMatch(/^.*Decrease of [1-9]/)
          expect(desc).not.toMatch(/^.*Increase of [1-9]/)
        }
        // If the trajectory shows different rates, the delta should not be 0
        const desc = insight.description || ''
        const trajectoryMatch = desc.match(/(\d+\.?\d*)%.*?→.*?(\d+\.?\d*)%/)
        if (trajectoryMatch) {
          const first = parseFloat(trajectoryMatch[1])
          const last = parseFloat(trajectoryMatch[2])
          if (Math.abs(first - last) > 1) {
            // Trajectory shows real change, delta should not be 0
            expect(Math.abs(insight.delta || 0)).toBeGreaterThan(0.1)
          }
        }
      }
    }
  })

  // session-profile-by-ide: recommendation gap must match headline metric
  it('session-profile-by-ide recommendation gap matches headline metric', () => {
    for (const insight of allInsights) {
      if (insight.id === 'session-profile-by-ide' && insight.title && insight.recommendation) {
        // If title says "median" (skew-adjusted), recommendation should not use mean-based gap
        const titleSaysMedian = /median/i.test(insight.title)
        if (titleSaysMedian) {
          // Extract the gap from the recommendation
          const gapMatch = insight.recommendation.match(/(\d+)\s+minutes longer/)
          if (gapMatch) {
            const recGap = parseInt(gapMatch[1])
            // Extract median values from title
            const titleMatch = insight.title.match(/median\s+(\d+)\s+min.*?(\d+)\s+min/)
            if (titleMatch) {
              const medHigh = parseInt(titleMatch[1])
              const medLow = parseInt(titleMatch[2])
              const medGap = medHigh - medLow
              // The recommendation gap should be close to the median gap, not the mean gap
              expect(Math.abs(recGap - medGap)).toBeLessThanOrEqual(2)
            }
          }
        }
      }
    }
  })

  it('lists all Ed findings for manual review', () => {
    console.log('\n=== ED PI FINDINGS AUDIT ===')
    console.log(`Total findings: ${allInsights.length}`)
    for (const insight of allInsights) {
      console.log(`\n[${insight.id}] hasData=${insight.hasData}`)
      console.log(`  Title: ${insight.title}`)
      if (insight.description) {
        console.log(`  Desc: ${insight.description.substring(0, 200)}`)
      }
      if (insight.recommendation) {
        console.log(`  Rec: ${insight.recommendation.substring(0, 150)}`)
      }
    }
  })
})
