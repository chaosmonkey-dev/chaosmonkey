/**
 * CR-X Gate C: Claude Code AI Activity / Session metric-label authority.
 *
 * CR-X PI/PBT-TIME P0 correction: The canonical aggregated endpoint returns
 * finite observed ai_suggestions_accepted values for Claude Code sessions.
 * AIOI and PBT must show the same metric under the same scope when eligible.
 * Only metrics that genuinely depend on unavailable terminal observability
 * (active-coding/focus/idle) remain gated.
 */
import { describe, it, expect } from 'vitest'
import { isMetricInstrumentedForTool } from '../lib/productivityCards'
import { isMetricInstrumentedForWorkflow, getMetricObservability } from '../lib/surfaceAgentContract'

describe('CR-X Gate C: Claude Code AI Activity / Session label authority', () => {
  it('ai_suggestions_accepted IS instrumented for Claude Code in PBT (PI/PBT-TIME P0 correction)', () => {
    // CR-X PI/PBT-TIME P0: The canonical aggregated endpoint returns finite
    // observed ai_suggestions_accepted values for Claude Code sessions.
    expect(isMetricInstrumentedForTool('claude_code', 'ai_suggestions_accepted')).toBe(true)
    expect(isMetricInstrumentedForTool('claude-code', 'ai_suggestions_accepted')).toBe(true)
  })

  it('surfaceAgentContract marks ai_suggestions_accepted directly_observed for Claude Code (PI/PBT-TIME P0)', () => {
    expect(isMetricInstrumentedForWorkflow('claude_code', 'ai_suggestions_accepted')).toBe(true)
    const obs = getMetricObservability('terminal', 'ai_suggestions_accepted')
    expect(obs).toBe('directly_observed')
  })

  it('active_coding_time_minutes remains NOT instrumented for Claude Code', () => {
    // This is a genuine instrumentation gap — the bridge does not capture
    // active_coding_duration_ms. This must remain "Not instrumented".
    expect(isMetricInstrumentedForTool('claude_code', 'active_coding_time_minutes')).toBe(false)
  })

  it('ai_suggestions_accepted IS instrumented for editor surfaces', () => {
    expect(isMetricInstrumentedForTool('cursor', 'ai_suggestions_accepted')).toBe(true)
    expect(isMetricInstrumentedForTool('vscode', 'ai_suggestions_accepted')).toBe(true)
  })

  it('surfaceAgentContract marks ai_suggestions_accepted as directly_observed for editor surfaces', () => {
    expect(isMetricInstrumentedForWorkflow('cursor', 'ai_suggestions_accepted')).toBe(true)
    expect(isMetricInstrumentedForWorkflow('vscode', 'ai_suggestions_accepted')).toBe(true)
    const cursorObs = getMetricObservability('vscode', 'ai_suggestions_accepted')
    expect(cursorObs).toBe('directly_observed')
  })

  it('PBT still offers ai_suggestions_accepted as a metric option for editor workflows', () => {
    const fs = require('fs')
    const path = require('path')

    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    expect(pbtSource).toContain('value="ai_suggestions_accepted"')
    expect(pbtSource).toContain('AI Activity / Session')
  })
})
