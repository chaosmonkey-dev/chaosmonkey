import type { Ref } from 'vue'

export const BULK_ROLLOUT_MAX_EMAILS = 50

export interface BulkEnrollmentInputSummary {
  entered: number
  emails: string[]
  malformedEntries: string[]
  duplicateCount: number
}

export interface BulkRolloutSummary {
  requested: number
  created: number
  reused: number
  skipped: number
  failed: number
}

export interface BulkRolloutResult {
  rollout_url: string
  summary: BulkRolloutSummary
  /** K1B: authoritative cohort assignment result — present only when a
   *  cohort was requested and the backend returned its bounded summary */
  cohort?: { id: number; name: string; assigned_count: number }
}

export interface BulkRolloutPayload {
  emails: string[]
  delivery_mode: 'shared_link'
  /** K1B: optional cohort assignment for created/reused invites */
  cohort_id?: number
}

export interface BulkRolloutAlert {
  show: boolean
  type: string
  message: string
}

export interface BulkRolloutState {
  bulkEmailsText: Ref<string>
  bulkRolloutError: Ref<string>
  bulkRolloutAlert: Ref<BulkRolloutAlert>
  bulkRolloutFailureSummary: Ref<Record<string, unknown> | null>
  bulkRolloutResult: Ref<BulkRolloutResult | null>
  isCreatingBulkRollout: Ref<boolean>
}

export interface BulkRolloutDependencies {
  isAdmin: () => boolean
  apiPost: (url: string, payload: BulkRolloutPayload) => Promise<{ data?: unknown }>
  refreshOrganizationData: () => Promise<boolean | void>
  onUnauthorized: () => void
  /** K1B: optional cohort target — returns the cohort id or null/undefined */
  getCohortId?: () => number | null | undefined
}

const isValidEnrollmentEmail = (value: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const parseBulkEnrollmentInput = (input: string): BulkEnrollmentInputSummary => {
  const seen = new Set<string>()
  const emails: string[] = []
  const malformedEntries: string[] = []
  let entered = 0
  let duplicateCount = 0

  for (const rawEntry of input.split(/[\n,;]+/)) {
    const trimmed = rawEntry.trim()
    if (!trimmed) continue

    entered += 1
    const normalized = trimmed.toLowerCase()

    if (seen.has(normalized)) {
      duplicateCount += 1
      continue
    }
    seen.add(normalized)

    if (isValidEnrollmentEmail(normalized)) {
      emails.push(normalized)
    } else {
      malformedEntries.push(trimmed)
    }
  }

  return { entered, emails, malformedEntries, duplicateCount }
}

export const buildBulkRolloutPayload = (emails: string[], cohortId?: number | null): BulkRolloutPayload => {
  const payload: BulkRolloutPayload = {
    emails,
    delivery_mode: 'shared_link',
  }
  if (typeof cohortId === 'number' && Number.isFinite(cohortId)) {
    payload.cohort_id = cohortId
  }
  return payload
}

export const normalizeBulkRolloutResponse = (data: unknown): BulkRolloutResult | null => {
  if (!isPlainObject(data)) return null
  if (data.delivery_mode !== undefined && data.delivery_mode !== 'shared_link') return null

  const rolloutUrl = data.rollout_url
  const summary = data.summary
  if (typeof rolloutUrl !== 'string' || !rolloutUrl.trim() || !isPlainObject(summary)) return null

  const summaryFields: Array<keyof BulkRolloutSummary> = ['requested', 'created', 'reused', 'skipped', 'failed']
  for (const field of summaryFields) {
    if (typeof summary[field] !== 'number' || !Number.isFinite(summary[field])) return null
  }

  const result: BulkRolloutResult = {
    rollout_url: rolloutUrl,
    summary: {
      requested: summary.requested as number,
      created: summary.created as number,
      reused: summary.reused as number,
      skipped: summary.skipped as number,
      failed: summary.failed as number,
    },
  }

  // K1B: bounded cohort result — only surfaced when present and well-formed.
  // Absent/malformed → key omitted entirely so the legacy shape is unchanged.
  if (isPlainObject(data.cohort)
      && typeof data.cohort.id === 'number'
      && typeof data.cohort.name === 'string'
      && typeof data.cohort.assigned_count === 'number') {
    result.cohort = {
      id: data.cohort.id,
      name: data.cohort.name,
      assigned_count: data.cohort.assigned_count,
    }
  }

  return result
}

const errorResponse = (error: unknown): { status?: number; message?: string; summary?: Record<string, unknown> } => {
  if (!isPlainObject(error) || !isPlainObject(error.response)) return {}
  const data = isPlainObject(error.response.data) ? error.response.data : {}
  const message = typeof data.message === 'string'
    ? data.message
    : typeof data.error === 'string'
      ? data.error
      : undefined

  return {
    status: typeof error.response.status === 'number' ? error.response.status : undefined,
    message,
    summary: isPlainObject(data.summary) ? data.summary : undefined,
  }
}

export const createBulkRolloutHandler = (
  state: BulkRolloutState,
  dependencies: BulkRolloutDependencies,
) => async (): Promise<void> => {
  if (state.isCreatingBulkRollout.value) return

  state.bulkRolloutError.value = ''
  state.bulkRolloutAlert.value = { show: false, type: 'success', message: '' }
  state.bulkRolloutFailureSummary.value = null

  if (!dependencies.isAdmin()) {
    state.bulkRolloutAlert.value = {
      show: true,
      type: 'danger',
      message: 'Only organization admins can create bulk developer rollouts.'
    }
    return
  }

  const inputSummary = parseBulkEnrollmentInput(state.bulkEmailsText.value)
  if (inputSummary.entered === 0) {
    state.bulkRolloutError.value = 'Enter at least one developer email address.'
    return
  }
  if (inputSummary.emails.length === 0) {
    state.bulkRolloutError.value = 'Enter at least one valid developer email address.'
    return
  }
  if (inputSummary.emails.length > BULK_ROLLOUT_MAX_EMAILS) {
    state.bulkRolloutError.value = `Bulk rollout supports at most ${BULK_ROLLOUT_MAX_EMAILS} unique valid developer emails.`
    return
  }

  state.isCreatingBulkRollout.value = true

  try {
    const response = await dependencies.apiPost(
      '/api/org/invites/bulk',
      buildBulkRolloutPayload(inputSummary.emails, dependencies.getCohortId?.() ?? null),
    )
    const rolloutResult = normalizeBulkRolloutResponse(response?.data)

    if (!rolloutResult) {
      state.bulkRolloutAlert.value = {
        show: true,
        type: 'danger',
        message: 'The rollout link could not be generated. Please try again.'
      }
      return
    }

    state.bulkRolloutResult.value = rolloutResult

    let refreshed = true
    try {
      refreshed = (await dependencies.refreshOrganizationData()) !== false
    } catch {
      refreshed = false
    }

    state.bulkRolloutAlert.value = {
      show: true,
      type: refreshed ? 'success' : 'warning',
      message: refreshed
        ? 'Shared rollout link generated. Copy and save it before dismissing this result.'
        : 'Shared rollout link generated. Copy and save it now; the team list could not refresh.'
    }
  } catch (error) {
    const response = errorResponse(error)
    state.bulkRolloutFailureSummary.value = response.summary || null

    if (response.status === 401) {
      dependencies.onUnauthorized()
    } else if (response.status === 403) {
      state.bulkRolloutAlert.value = {
        show: true,
        type: 'danger',
        message: 'Only organization admins can create bulk developer rollouts.'
      }
    } else if (response.status === 422) {
      state.bulkRolloutAlert.value = {
        show: true,
        type: 'warning',
        message: response.message || 'Some developer emails could not be included in this rollout.'
      }
    } else {
      state.bulkRolloutAlert.value = {
        show: true,
        type: 'danger',
        message: response.message || 'The rollout link could not be generated. Please try again.'
      }
    }
  } finally {
    state.isCreatingBulkRollout.value = false
  }
}
