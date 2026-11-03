import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Mock config/api BEFORE importing modules that depend on authenticatedFetch.
const authenticatedFetchMock = vi.fn()
vi.mock('../config/api', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    authenticatedFetch: (...args: any[]) => authenticatedFetchMock(...args),
  }
})

import { useAnalysisContextStore } from '../stores/analysisContext'
import { fetchAndMapTelemetryToUnified } from '../lib/adapters/telemetryToUnified'
import {
  buildBulkRolloutPayload,
  createBulkRolloutHandler,
  normalizeBulkRolloutResponse,
  type BulkRolloutResult,
} from '../lib/bulkEnrollment'

const SRC = join(__dirname, '..')
const settingsSource = readFileSync(join(SRC, 'pages', 'Settings.vue'), 'utf-8')
const pbtSource = readFileSync(join(SRC, 'components', 'ProductivityByToolV3.vue'), 'utf-8')
const dashboardsSource = readFileSync(join(SRC, 'pages', 'Dashboards.vue'), 'utf-8')
const dataAccessSource = readFileSync(join(SRC, 'lib', 'insights', 'final', 'dataAccess.ts'), 'utf-8')
const unifiedSource = readFileSync(join(SRC, 'lib', 'adapters', 'telemetryToUnified.ts'), 'utf-8')
const useTimeSeriesSource = readFileSync(join(SRC, 'composables', 'useTimeSeries.ts'), 'utf-8')

const okJson = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => data,
  clone() { return this },
})

beforeEach(() => {
  setActivePinia(createPinia())
  authenticatedFetchMock.mockReset()
})

// ── analysisContext cohort scope ─────────────────────────────────────────────

describe('K1B analysisContext — cohort scope state', () => {
  it('defaults to no cohort scope (all developers)', () => {
    const ctx = useAnalysisContextStore()
    expect(ctx.cohortId).toBe('')
    expect(ctx.apiParams.cohort_id).toBeUndefined()
  })

  it('carries a specific cohort id into apiParams as cohort_id', () => {
    const ctx = useAnalysisContextStore()
    ctx.setCohortId('7')
    expect(ctx.cohortId).toBe('7')
    expect(ctx.apiParams.cohort_id).toBe('7')
  })

  it('carries unassigned into apiParams verbatim', () => {
    const ctx = useAnalysisContextStore()
    ctx.setCohortId('unassigned')
    expect(ctx.apiParams.cohort_id).toBe('unassigned')
  })

  it('normalizes all to no scope (same wire identity as absent)', () => {
    const ctx = useAnalysisContextStore()
    ctx.setCohortId('all')
    expect(ctx.cohortId).toBe('')
    expect(ctx.apiParams.cohort_id).toBeUndefined()
  })

  it('marks cohort selection as an active filter and clears on reset', () => {
    const ctx = useAnalysisContextStore()
    ctx.setCohortId('3')
    expect(ctx.hasFilters).toBe(true)
    ctx.reset()
    expect(ctx.cohortId).toBe('')
    expect(ctx.hasFilters).toBe(false)
  })
})

// ── canonical request URL + cache identity ───────────────────────────────────

describe('K1B canonical fetch — cohort_id on the wire', () => {
  it('sends cohort_id for a specific cohort', async () => {
    authenticatedFetchMock.mockResolvedValue(okJson({ data: [], metadata: {} }))
    await fetchAndMapTelemetryToUnified('week', '2026-09-01', '2026-09-20', undefined, undefined, undefined, 'UTC', undefined, 'TEST', undefined, '42')
    const url = authenticatedFetchMock.mock.calls[0][0]
    expect(url).toContain('cohort_id=42')
  })

  it('sends cohort_id=unassigned verbatim', async () => {
    authenticatedFetchMock.mockResolvedValue(okJson({ data: [], metadata: {} }))
    await fetchAndMapTelemetryToUnified('week', '2026-09-01', '2026-09-20', undefined, undefined, undefined, 'UTC', undefined, 'TEST', undefined, 'unassigned')
    const url = authenticatedFetchMock.mock.calls[0][0]
    expect(url).toContain('cohort_id=unassigned')
  })

  it('omits cohort_id for all/absent (identical request to no-filter)', async () => {
    authenticatedFetchMock.mockResolvedValue(okJson({ data: [], metadata: {} }))
    await fetchAndMapTelemetryToUnified('week', '2026-10-01', '2026-10-05', undefined, undefined, undefined, 'UTC', undefined, 'TEST-A', undefined, 'all')
    const urlAll = authenticatedFetchMock.mock.calls[0][0]
    expect(urlAll).not.toContain('cohort_id')
    await fetchAndMapTelemetryToUnified('week', '2026-10-01', '2026-10-05', undefined, undefined, undefined, 'UTC', undefined, 'TEST-A', undefined, undefined)
    // 'all' and absent share the cache key — second call hits the dedupe cache,
    // so authenticatedFetch is still called only once total.
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(1)
  })

  it('separates cache identity per cohort — cohort A result can never render under cohort B', async () => {
    authenticatedFetchMock.mockResolvedValue(okJson({ data: [], metadata: {} }))
    await fetchAndMapTelemetryToUnified('week', '2026-11-01', '2026-11-05', undefined, undefined, undefined, 'UTC', undefined, 'TEST-B', undefined, '1')
    await fetchAndMapTelemetryToUnified('week', '2026-11-01', '2026-11-05', undefined, undefined, undefined, 'UTC', undefined, 'TEST-B', undefined, '2')
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(2)
    const urls = authenticatedFetchMock.mock.calls.map((c: any[]) => c[0])
    expect(urls[0]).toContain('cohort_id=1')
    expect(urls[1]).toContain('cohort_id=2')
  })

  it('fails visibly on 422 INVALID_COHORT — never silently empty or org-wide', async () => {
    authenticatedFetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'INVALID_COHORT', message: 'Cohort not found or archived' }),
      clone() { return this },
    })
    await expect(
      fetchAndMapTelemetryToUnified('week', '2026-12-01', '2026-12-05', undefined, undefined, undefined, 'UTC', undefined, 'TEST-C', undefined, '999')
    ).rejects.toThrow('Cohort not found or archived')
  })
})

// ── PI session fetch cohort propagation (source-pinned wiring) ───────────────

describe('K1B PI/AIOI wiring — cohort propagates through canonical session fetch', () => {
  it('session fetch cache key includes cohort', () => {
    expect(dataAccessSource).toContain('timeRange.cohortId')
  })

  it('canonical session URLs carry cohort_id on every paginated page', () => {
    const canonicalHits = dataAccessSource.match(/telemetry\/canonical\?[^`]*\$\{cohortParam\}/g) || []
    expect(canonicalHits.length).toBeGreaterThanOrEqual(3)
  })

  it('PI input key includes cohort scope', () => {
    expect(dashboardsSource).toContain('ctxCohort')
    expect(dashboardsSource).toContain('analysisContext.cohortId')
  })

  it('AIOI sessions fetch forwards cohort to the canonical endpoint', () => {
    expect(dashboardsSource).toContain('fetchSessionsForTTFC(daysToFetch, signal, analysisContext.cohortId')
  })
})

// ── PBT selector + delivery suppression ──────────────────────────────────────

describe('K1B PBT — cohort selector wiring', () => {
  it('replaces the dead team placeholder with a live cohort select', () => {
    expect(pbtSource).not.toContain('Team filter coming soon')
    expect(pbtSource).toContain('v-model="selectedCohort"')
    expect(pbtSource).toContain('availableCohorts')
  })

  it('feeds cohortId into the canonical productivity query', () => {
    expect(pbtSource).toContain('cohortId: analysisContext.cohortId')
  })

  it('syncs the selector to shared analysisContext in both directions', () => {
    expect(pbtSource).toContain('analysisContext.setCohortId(newValue)')
    expect(pbtSource).toContain('() => analysisContext.cohortId')
  })

  it('renders the current-membership disclosure under a cohort filter', () => {
    expect(pbtSource).toContain('Metrics use current cohort membership across the selected period')
  })

  it('marks a stale cohort selection instead of silently reverting', () => {
    expect(pbtSource).toContain('selectedCohortStale')
    expect(pbtSource).toContain('archived or removed')
  })

  it('suppresses org-scoped delivery numbers under a cohort filter', () => {
    expect(useTimeSeriesSource).toContain('cohortActive')
    expect(useTimeSeriesSource).toContain('not available for cohort filters')
  })

  it('does not render org-level configured spend as a cohort cost', () => {
    expect(pbtSource).toContain('!isCohortFiltered')
  })
})

// ── bulk rollout cohort payload ──────────────────────────────────────────────

describe('K1B bulk rollout — cohort payload contract', () => {
  it('keeps the legacy payload byte-identical when no cohort is selected', () => {
    expect(buildBulkRolloutPayload(['a@b.com'])).toEqual({
      emails: ['a@b.com'],
      delivery_mode: 'shared_link',
    })
    expect(buildBulkRolloutPayload(['a@b.com'], null)).toEqual({
      emails: ['a@b.com'],
      delivery_mode: 'shared_link',
    })
  })

  it('adds cohort_id when a cohort is selected', () => {
    expect(buildBulkRolloutPayload(['a@b.com'], 12)).toEqual({
      emails: ['a@b.com'],
      delivery_mode: 'shared_link',
      cohort_id: 12,
    })
  })

  it('omits cohort_id for non-numeric/invalid input', () => {
    expect(buildBulkRolloutPayload(['a@b.com'], NaN)).toEqual({
      emails: ['a@b.com'],
      delivery_mode: 'shared_link',
    })
  })

  it('preserves strict response validation and surfaces the cohort result', () => {
    const withCohort = normalizeBulkRolloutResponse({
      delivery_mode: 'shared_link',
      rollout_url: 'https://local.test/enroll/tok',
      summary: { requested: 2, created: 1, reused: 1, skipped: 0, failed: 0 },
      cohort: { id: 4, name: 'Platform', assigned_count: 2 },
    })
    expect(withCohort?.cohort).toEqual({ id: 4, name: 'Platform', assigned_count: 2 })

    // Missing cohort is a valid legacy response — key omitted entirely
    const legacy = normalizeBulkRolloutResponse({
      delivery_mode: 'shared_link',
      rollout_url: 'https://local.test/enroll/tok',
      summary: { requested: 1, created: 1, reused: 0, skipped: 0, failed: 0 },
    })
    expect(legacy).toEqual({
      rollout_url: 'https://local.test/enroll/tok',
      summary: { requested: 1, created: 1, reused: 0, skipped: 0, failed: 0 },
    })
    expect('cohort' in legacy!).toBe(false)

    // Malformed cohort field is ignored, does not poison the result
    const malformed = normalizeBulkRolloutResponse({
      delivery_mode: 'shared_link',
      rollout_url: 'https://local.test/enroll/tok',
      summary: { requested: 1, created: 1, reused: 0, skipped: 0, failed: 0 },
      cohort: 'bogus',
    })
    expect(malformed?.rollout_url).toBe('https://local.test/enroll/tok')
    expect('cohort' in malformed!).toBe(false)
  })

  it('sends cohort_id through the rollout handler when selected', async () => {
    const state = {
      bulkEmailsText: ref('dev1@example.com'),
      bulkRolloutError: ref(''),
      bulkRolloutAlert: ref({ show: false, type: 'success', message: '' }),
      bulkRolloutFailureSummary: ref<Record<string, unknown> | null>(null),
      bulkRolloutResult: ref<BulkRolloutResult | null>(null),
      isCreatingBulkRollout: ref(false),
    }
    const apiPost = vi.fn().mockResolvedValue({
      data: {
        delivery_mode: 'shared_link',
        rollout_url: 'https://local.test/enroll/tok',
        summary: { requested: 1, created: 1, reused: 0, skipped: 0, failed: 0 },
        cohort: { id: 9, name: 'Pilot', assigned_count: 1 },
      },
    })
    const submit = createBulkRolloutHandler(state, {
      isAdmin: () => true,
      apiPost,
      refreshOrganizationData: vi.fn().mockResolvedValue(true),
      onUnauthorized: vi.fn(),
      getCohortId: () => 9,
    })
    await submit()
    expect(apiPost).toHaveBeenCalledWith('/api/org/invites/bulk', {
      emails: ['dev1@example.com'],
      delivery_mode: 'shared_link',
      cohort_id: 9,
    })
    expect(state.bulkRolloutResult.value?.cohort?.assigned_count).toBe(1)
  })
})

// ── Settings → Team cohort UX contract (source-pinned) ───────────────────────

describe('K1B Settings — cohort administration UX', () => {
  it('renders the cohorts card inside the existing Team surface', () => {
    const teamTab = settingsSource.indexOf('Team Management')
    const cohortCard = settingsSource.indexOf('Developer cohorts')
    const roster = settingsSource.indexOf('Developer enrollment roster')
    expect(teamTab).toBeGreaterThan(-1)
    expect(cohortCard).toBeGreaterThan(teamTab)
    expect(cohortCard).toBeLessThan(roster)
    // No separate Settings page/route was created
    expect(settingsSource).not.toContain('cohorts.vue')
  })

  it('gates all mutation controls behind isAdmin', () => {
    // create form
    expect(settingsSource).toContain('v-if="isAdmin" class="d-flex align-items-center gap-2 flex-wrap mb-3"')
    // rename/archive buttons
    expect(settingsSource).toContain('v-if="isAdmin">\n                                        <button')
    // roster cohort select only for admins; members see a static label
    expect(settingsSource).toContain('v-if="isAdmin"\n                                    class="form-select form-select-sm"')
    expect(settingsSource).toContain('member.cohort_name || \'Unassigned\'')
  })

  it('supports create, rename, archive, members, and unassign', () => {
    for (const fn of ['createCohort', 'renameCohort', 'archiveCohort', 'loadCohortMembers', 'setMemberCohort']) {
      expect(settingsSource).toContain(`const ${fn}`)
    }
    expect(settingsSource).toContain("api.post('/api/org/cohorts'")
    expect(settingsSource).toContain('api.patch(`/api/org/cohorts/${cohort.id}`')
    expect(settingsSource).toContain('api.post(`/api/org/cohorts/${cohort.id}/archive`)')
    expect(settingsSource).toContain('api.get(`/api/org/cohorts/${cohort.id}/members`)')
    expect(settingsSource).toContain('api.post(`/api/org/cohorts/${cohortId}/members`, { invite_ids: [member.invite_id] })')
    expect(settingsSource).toContain('api.delete(`/api/org/cohorts/${member.cohort_id}/members/${member.invite_id}`)')
  })

  it('shows archived cohorts as history, never as assignable options', () => {
    expect(settingsSource).toContain('archivedCohorts')
    expect(settingsSource).toContain('Archived')
    // Assign selects iterate only active cohorts
    expect(settingsSource).toContain('v-for="c in activeCohorts"')
  })

  it('adds an optional cohort selector to single enrollment', () => {
    expect(settingsSource).toContain('v-model="enrollCohortId"')
    expect(settingsSource).toContain('payload.cohort_id = Number(enrollCohortId.value)')
  })

  it('adds an optional cohort selector to the bulk rollout', () => {
    expect(settingsSource).toContain('v-model="bulkCohortId"')
    expect(settingsSource).toContain('getCohortId: () => bulkCohortId.value')
    expect(settingsSource).toContain('bulkRolloutResult.cohort')
  })

  it('renders cohort membership on the enrollment roster', () => {
    expect(settingsSource).toContain('member.cohort_id')
    expect(settingsSource).toContain('>Cohort</div>')
  })
})
