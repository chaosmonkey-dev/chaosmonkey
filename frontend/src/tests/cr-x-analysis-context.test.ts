import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAnalysisContextStore } from '../stores/analysisContext'

describe('AnalysisContext Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('defaults to all-time, auto granularity, no filters', () => {
    const ctx = useAnalysisContextStore()
    expect(ctx.timePreset).toBe('all')
    expect(ctx.isAllTime).toBe(true)
    expect(ctx.hasFilters).toBe(false)
    expect(ctx.developerIds).toEqual([])
    expect(ctx.repoIds).toEqual([])
    expect(ctx.workflowIds).toEqual([])
  })

  it('setTimePreset("30d") sets a 30-date inclusive range', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('30d')
    expect(ctx.timePreset).toBe('30d')
    expect(ctx.isAllTime).toBe(false)
    expect(ctx.dateRange.from).toBeTruthy()
    expect(ctx.dateRange.to).toBeTruthy()
    // CR-X PI/PBT-TIME: 30 calendar dates inclusive (from = today-29, to = today)
    const fromMs = new Date(ctx.dateRange.from + 'T00:00:00.000Z').getTime()
    const toMs = new Date(ctx.dateRange.to + 'T00:00:00.000Z').getTime()
    const daysDiff = Math.round((toMs - fromMs) / 86400000)
    const includedDates = daysDiff + 1
    expect(includedDates).toBe(30)
  })

  it('setTimePreset("7d") sets a 7-date inclusive range', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('7d')
    const fromMs = new Date(ctx.dateRange.from + 'T00:00:00.000Z').getTime()
    const toMs = new Date(ctx.dateRange.to + 'T00:00:00.000Z').getTime()
    const daysDiff = Math.round((toMs - fromMs) / 86400000)
    const includedDates = daysDiff + 1
    expect(includedDates).toBe(7)
  })

  it('setTimePreset("all") clears date range', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('30d')
    expect(ctx.isAllTime).toBe(false)
    ctx.setTimePreset('all')
    expect(ctx.isAllTime).toBe(true)
    expect(ctx.dateRange.from).toBe('')
    expect(ctx.dateRange.to).toBe('')
  })

  it('setCustomDateRange sets custom preset', () => {
    const ctx = useAnalysisContextStore()
    ctx.setCustomDateRange('2026-01-01', '2026-06-30')
    expect(ctx.timePreset).toBe('custom')
    expect(ctx.dateRange.from).toBe('2026-01-01')
    expect(ctx.dateRange.to).toBe('2026-06-30')
    expect(ctx.isAllTime).toBe(false)
  })

  it('auto granularity returns daily for <=14 days', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('7d')
    expect(ctx.effectiveGranularity).toBe('daily')
  })

  it('auto granularity returns weekly for <=90 days', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('30d')
    expect(ctx.effectiveGranularity).toBe('weekly')
  })

  it('auto granularity returns monthly for >90 days', () => {
    const ctx = useAnalysisContextStore()
    ctx.setCustomDateRange('2026-01-01', '2026-12-31')
    expect(ctx.effectiveGranularity).toBe('monthly')
  })

  it('auto granularity returns weekly for all-time', () => {
    const ctx = useAnalysisContextStore()
    expect(ctx.effectiveGranularity).toBe('weekly')
  })

  it('explicit granularity overrides auto', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('7d')
    expect(ctx.effectiveGranularity).toBe('daily')
    ctx.setGranularity('monthly')
    expect(ctx.effectiveGranularity).toBe('monthly')
  })

  it('setDeveloperIds filters empty strings', () => {
    const ctx = useAnalysisContextStore()
    ctx.setDeveloperIds(['dev1', '', 'dev2', '  '])
    expect(ctx.developerIds).toEqual(['dev1', 'dev2'])
    expect(ctx.hasFilters).toBe(true)
  })

  it('setRepoIds filters empty strings', () => {
    const ctx = useAnalysisContextStore()
    ctx.setRepoIds(['owner/repo1', '', 'owner/repo2'])
    expect(ctx.repoIds).toEqual(['owner/repo1', 'owner/repo2'])
    expect(ctx.hasFilters).toBe(true)
  })

  it('setWorkflowIds filters empty strings', () => {
    const ctx = useAnalysisContextStore()
    ctx.setWorkflowIds(['cursor', '', 'vscode'])
    expect(ctx.workflowIds).toEqual(['cursor', 'vscode'])
  })

  it('populationLabel for all-time no filters', () => {
    const ctx = useAnalysisContextStore()
    expect(ctx.populationLabel).toBe('All Time')
  })

  it('populationLabel for 30d with developer and repo', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('30d')
    ctx.setDeveloperIds(['dev1'])
    ctx.setRepoIds(['owner/repo1'])
    expect(ctx.populationLabel).toBe('Last 30d · Developer dev1 · Repo owner/repo1')
  })

  it('populationLabel for custom range with multiple developers', () => {
    const ctx = useAnalysisContextStore()
    ctx.setCustomDateRange('2026-01-01', '2026-06-30')
    ctx.setDeveloperIds(['dev1', 'dev2'])
    expect(ctx.populationLabel).toBe('2026-01-01 to 2026-06-30 · 2 developers')
  })

  it('apiParams empty for all-time no filters', () => {
    const ctx = useAnalysisContextStore()
    expect(ctx.apiParams).toEqual({})
  })

  it('apiParams populated for 30d with filters', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('30d')
    ctx.setDeveloperIds(['dev1'])
    ctx.setRepoIds(['owner/repo1'])
    ctx.setWorkflowIds(['cursor'])
    const params = ctx.apiParams
    expect(params.from).toBeTruthy()
    expect(params.to).toBeTruthy()
    expect(params.developer_ids).toBe('dev1')
    expect(params.repo_ids).toBe('owner/repo1')
    expect(params.tool_ids).toBe('cursor')
  })

  it('githubTimeFilter returns "all" for all-time', () => {
    const ctx = useAnalysisContextStore()
    expect(ctx.githubTimeFilter).toBe('all')
  })

  it('githubTimeFilter returns from,to for bounded range', () => {
    const ctx = useAnalysisContextStore()
    ctx.setCustomDateRange('2026-01-01', '2026-06-30')
    expect(ctx.githubTimeFilter).toBe('2026-01-01,2026-06-30')
  })

  it('reset clears everything', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('30d')
    ctx.setDeveloperIds(['dev1'])
    ctx.setRepoIds(['repo1'])
    ctx.setGranularity('daily')
    ctx.reset()
    expect(ctx.timePreset).toBe('all')
    expect(ctx.isAllTime).toBe(true)
    expect(ctx.developerIds).toEqual([])
    expect(ctx.repoIds).toEqual([])
    expect(ctx.granularity).toBe('auto')
  })
})
