import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BULK_ROLLOUT_MAX_EMAILS,
  buildBulkRolloutPayload,
  createBulkRolloutHandler,
  normalizeBulkRolloutResponse,
  parseBulkEnrollmentInput,
  type BulkRolloutResult,
} from '../lib/bulkEnrollment'

const SRC = join(__dirname, '..')
const settingsSource = readFileSync(join(SRC, 'pages', 'Settings.vue'), 'utf-8')
const routerSource = readFileSync(join(SRC, 'router', 'index.ts'), 'utf-8')
const bulkEnrollmentSource = readFileSync(join(SRC, 'lib', 'bulkEnrollment.ts'), 'utf-8')
const createBulkRolloutSource = bulkEnrollmentSource.slice(bulkEnrollmentSource.indexOf('export const createBulkRolloutHandler'))

const functionSource = (name: string): string => {
  const start = settingsSource.indexOf(`const ${name}`)
  expect(start).toBeGreaterThanOrEqual(0)
  const rest = settingsSource.slice(start)
  const next = rest.indexOf('\nconst ', 1)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('bulk developer rollout — input parsing', () => {
  it('parses newline-separated developer emails', () => {
    const parsed = parseBulkEnrollmentInput('dev1@example.com\ndev2@example.com')
    expect(parsed.emails).toEqual(['dev1@example.com', 'dev2@example.com'])
  })

  it('parses comma-separated developer emails', () => {
    const parsed = parseBulkEnrollmentInput('dev1@example.com,dev2@example.com')
    expect(parsed.emails).toEqual(['dev1@example.com', 'dev2@example.com'])
  })

  it('parses semicolon-separated developer emails', () => {
    const parsed = parseBulkEnrollmentInput('dev1@example.com;dev2@example.com')
    expect(parsed.emails).toEqual(['dev1@example.com', 'dev2@example.com'])
  })

  it('normalizes whitespace around pasted entries', () => {
    const parsed = parseBulkEnrollmentInput('  dev1@example.com ,  dev2@example.com ; dev3@example.com  ')
    expect(parsed.emails).toEqual(['dev1@example.com', 'dev2@example.com', 'dev3@example.com'])
  })

  it('deduplicates emails case-insensitively and reports duplicates', () => {
    const parsed = parseBulkEnrollmentInput('Dev1@Example.com, dev1@example.COM; dev2@example.com')
    expect(parsed.entered).toBe(3)
    expect(parsed.emails).toEqual(['dev1@example.com', 'dev2@example.com'])
    expect(parsed.duplicateCount).toBe(1)
  })

  it('reports malformed entries without treating them as valid', () => {
    const parsed = parseBulkEnrollmentInput('dev1@example.com, not-an-email; dev2@example.com')
    expect(parsed.emails).toEqual(['dev1@example.com', 'dev2@example.com'])
    expect(parsed.malformedEntries).toEqual(['not-an-email'])
  })

  it('keeps entered, unique, duplicate, and malformed counts truthful', () => {
    const parsed = parseBulkEnrollmentInput('dev1@example.com, DEV1@example.com, bad-address, dev2@example.com')
    expect(parsed.entered).toBe(4)
    expect(parsed.emails).toHaveLength(2)
    expect(parsed.duplicateCount).toBe(1)
    expect(parsed.malformedEntries).toHaveLength(1)
  })

  it('produces no API-ready emails for an empty submission', () => {
    expect(parseBulkEnrollmentInput(' \n , ; ').emails).toEqual([])
  })
})

describe('bulk developer rollout — canonical request contract', () => {
  it('builds only the canonical shared-link payload', () => {
    const payload = buildBulkRolloutPayload(['dev1@example.com', 'dev2@example.com'])
    expect(payload).toEqual({
      emails: ['dev1@example.com', 'dev2@example.com'],
      delivery_mode: 'shared_link',
    })
    expect(Object.keys(payload).sort()).toEqual(['delivery_mode', 'emails'])
  })

  it('submits exactly the existing bulk endpoint', () => {
    expect(createBulkRolloutSource).toContain("dependencies.apiPost(\n      '/api/org/invites/bulk'")
    expect(createBulkRolloutSource).toContain('buildBulkRolloutPayload(inputSummary.emails, dependencies.getCohortId?.() ?? null)')
    expect(settingsSource).toContain('apiPost: (url, payload) => api.post(url, payload)')
    expect((bulkEnrollmentSource.match(/\/api\/org\/invites\/bulk/g) || [])).toHaveLength(1)
  })

  it('sends no organization, identity, token, or lifetime authority fields', () => {
    for (const forbiddenField of [
      'organization_id',
      'invite_id',
      'installation_id',
      'developer_id',
      'user_id',
      'expires_at',
      'expires_hours',
      'token',
    ]) {
      expect(createBulkRolloutSource).not.toContain(forbiddenField)
    }
  })

  it('does not call alternate invite, connect, exchange, renewal, or token endpoints', () => {
    expect(createBulkRolloutSource).not.toMatch(/connect-code|ide\/connect|renew|api-token|exchange/i)
    expect(createBulkRolloutSource).not.toContain("api.post('/api/org/invites'")
    expect(createBulkRolloutSource).not.toContain('api.delete(')
  })
})

describe('bulk developer rollout — Settings integration and UX contract', () => {
  it('extends the existing Developer Enrollments surface before the roster', () => {
    const singleIndex = settingsSource.indexOf('Create developer enrollment')
    const bulkIndex = settingsSource.indexOf('Roll out to multiple developers')
    const rosterIndex = settingsSource.indexOf('Developer enrollment roster')
    expect(settingsSource).toContain('Developer Enrollments')
    expect(singleIndex).toBeGreaterThan(-1)
    expect(bulkIndex).toBeGreaterThan(singleIndex)
    expect(rosterIndex).toBeGreaterThan(bulkIndex)
  })

  it('renders the bulk control only for admins', () => {
    expect(settingsSource).toContain('v-if="isAdmin" class="border-top pt-3 mt-3"')
    expect(settingsSource).toContain('Add multiple developers')
    expect(settingsSource).toContain('Hide multiple developers')
  })

  it('keeps the existing individual enrollment endpoint and flow', () => {
    const createIndividualSource = functionSource('createDeveloperEnrollment')
    expect(createIndividualSource).toContain("api.post('/api/org/invites'")
    expect(createIndividualSource).toContain("purpose: 'developer_enrollment'")
    expect(createIndividualSource).toContain("send_email: false")
  })

  it('shows local input counts without presenting them as server results', () => {
    expect(settingsSource).toContain('bulkInputSummary.entered')
    expect(settingsSource).toContain('bulkInputSummary.emails.length')
    expect(settingsSource).toContain('bulkInputSummary.duplicateCount')
    expect(settingsSource).toContain('bulkInputSummary.malformedEntries.length')
    expect(settingsSource).toContain('Malformed: {{ bulkInputSummary.malformedEntries.join')
  })

  it('rejects an empty submission locally before any API call', () => {
    expect(createBulkRolloutSource).toContain('inputSummary.entered === 0')
    expect(createBulkRolloutSource.indexOf('inputSummary.entered === 0')).toBeLessThan(createBulkRolloutSource.indexOf('dependencies.apiPost'))
  })

  it('enforces the backend 50 unique-valid-email limit locally', () => {
    expect(BULK_ROLLOUT_MAX_EMAILS).toBe(50)
    expect(createBulkRolloutSource).toContain('inputSummary.emails.length > BULK_ROLLOUT_MAX_EMAILS')
    expect(createBulkRolloutSource.indexOf('inputSummary.emails.length > BULK_ROLLOUT_MAX_EMAILS')).toBeLessThan(createBulkRolloutSource.indexOf('dependencies.apiPost'))
  })

  it('renders the returned rollout URL and a copy action', () => {
    expect(settingsSource).toContain('bulkRolloutResult.rollout_url')
    expect(settingsSource).toContain('Copy rollout link')
    expect(settingsSource).toContain('copyBulkRolloutLink')
  })

  it('warns the admin to copy/save the non-retrievable link', () => {
    expect(settingsSource).toContain('it is not shown again later')
    expect(settingsSource).toContain('Copy and save it now')
  })

  it('renders only the aggregate backend summary', () => {
    for (const field of ['requested', 'created', 'reused', 'skipped', 'failed']) {
      expect(settingsSource).toContain(`bulkRolloutResult.summary.${field}`)
    }
    expect(settingsSource).not.toContain('bulkRolloutResult.results')
    expect(settingsSource).not.toContain('bulkRolloutResult.result')
    expect(settingsSource).not.toContain('per-email status')
  })

  it('uses the existing /enroll/:token claim architecture instead of a new page', () => {
    expect(routerSource).toContain("path: '/enroll/:token'")
    expect(routerSource).toContain("to.path.startsWith('/enroll/')")
    expect(createBulkRolloutSource).not.toContain('router.push')
    expect(createBulkRolloutSource).not.toContain('/enroll/')
  })

  it('preserves the entered email list after a failed request', () => {
    expect(createBulkRolloutSource).not.toContain("bulkEmailsText.value = ''")
    expect(createBulkRolloutSource).not.toContain('bulkEmailsText.value = ""')
    expect(functionSource('resetBulkRollout')).toContain("bulkEmailsText.value = ''")
  })

  it('prevents double submission while a rollout request is in flight', () => {
    expect(createBulkRolloutSource).toContain('if (state.isCreatingBulkRollout.value) return')
    expect(createBulkRolloutSource).toContain('state.isCreatingBulkRollout.value = true')
    expect(createBulkRolloutSource).toContain('state.isCreatingBulkRollout.value = false')
    expect(settingsSource).toContain(':disabled="isCreatingBulkRollout"')
  })

  it('uses a silent refresh that cannot hide the generated rollout result', () => {
    const fetchOrganizationSource = functionSource('fetchOrganizationData')
    expect(settingsSource).toContain('refreshOrganizationData: () => fetchOrganizationData({ silent: true })')
    expect(fetchOrganizationSource).toContain('const silent = options?.silent === true')
    expect(fetchOrganizationSource).toContain('if (!silent) isLoadingTeam.value = true')
    expect(fetchOrganizationSource).toContain('if (!silent) isLoadingTeam.value = false')
    expect(fetchOrganizationSource).toContain('if (!silent) {')
  })
})

describe('bulk developer rollout — failure contract', () => {
  it('maps 401 to the existing session-expired behavior', () => {
    expect(createBulkRolloutSource).toContain('response.status === 401')
    expect(createBulkRolloutSource).toContain('dependencies.onUnauthorized()')
    expect(settingsSource).toContain("teamLoadError.value = 'session_expired'")
    expect(settingsSource).toContain('handleSessionExpired')
  })

  it('maps 403 to admin/access-denied feedback', () => {
    expect(createBulkRolloutSource).toContain('response.status === 403')
    expect(createBulkRolloutSource).toContain('Only organization admins can create bulk developer rollouts.')
  })

  it('maps 422 to backend validation feedback and supplied summary', () => {
    expect(createBulkRolloutSource).toContain('response.status === 422')
    expect(createBulkRolloutSource).toContain('response.summary')
    expect(createBulkRolloutSource).toContain('response.message')
    expect(settingsSource).toContain('bulkRolloutFailureSummary.requested')
    expect(settingsSource).toContain('bulkRolloutFailureSummary.failed')
  })

  it('maps server/network failures to retryable feedback', () => {
    expect(createBulkRolloutSource).toContain('} else {')
    expect(createBulkRolloutSource).toContain('The rollout link could not be generated. Please try again.')
  })
})

const createBulkRolloutState = () => ({
  bulkEmailsText: ref('dev1@example.com\ndev2@example.com'),
  bulkRolloutError: ref(''),
  bulkRolloutAlert: ref({ show: false, type: 'success', message: '' }),
  bulkRolloutFailureSummary: ref<Record<string, unknown> | null>(null),
  bulkRolloutResult: ref<BulkRolloutResult | null>(null),
  isCreatingBulkRollout: ref(false),
})

const validBulkResponse = {
  delivery_mode: 'shared_link',
  rollout_url: 'https://local.chaosmonkey.test/enroll/test-rollout-token',
  summary: {
    requested: 2,
    created: 1,
    reused: 1,
    skipped: 0,
    failed: 0,
  },
}

describe('bulk developer rollout — behavioral state transitions', () => {
  it('submits the canonical request and preserves the complete aggregate result', async () => {
    const state = createBulkRolloutState()
    const apiPost = vi.fn().mockResolvedValue({ data: validBulkResponse })
    const refreshOrganizationData = vi.fn().mockResolvedValue(true)
    const submit = createBulkRolloutHandler(state, {
      isAdmin: () => true,
      apiPost,
      refreshOrganizationData,
      onUnauthorized: vi.fn(),
    })

    await submit()

    expect(apiPost).toHaveBeenCalledTimes(1)
    expect(apiPost).toHaveBeenCalledWith('/api/org/invites/bulk', {
      emails: ['dev1@example.com', 'dev2@example.com'],
      delivery_mode: 'shared_link',
    })
    expect(state.bulkRolloutResult.value).toEqual({
      rollout_url: validBulkResponse.rollout_url,
      summary: validBulkResponse.summary,
    })
    expect(state.bulkRolloutResult.value?.summary.created).toBe(1)
    expect(state.bulkRolloutAlert.value.type).toBe('success')
    expect(refreshOrganizationData).toHaveBeenCalledTimes(1)
    expect(state.isCreatingBulkRollout.value).toBe(false)
  })

  it.each([
    ['missing summary field', {
      delivery_mode: 'shared_link',
      rollout_url: 'https://local.chaosmonkey.test/enroll/token',
      summary: { requested: 2, reused: 1, skipped: 0, failed: 0 },
    }],
    ['non-string rollout URL', {
      delivery_mode: 'shared_link',
      rollout_url: 12345,
      summary: validBulkResponse.summary,
    }],
    ['empty rollout URL', {
      delivery_mode: 'shared_link',
      rollout_url: '   ',
      summary: validBulkResponse.summary,
    }],
    ['wrong delivery mode', {
      delivery_mode: 'email',
      rollout_url: 'https://local.chaosmonkey.test/enroll/token',
      summary: validBulkResponse.summary,
    }],
  ])('rejects a malformed success response: %s', async (_label, responseData) => {
    const state = createBulkRolloutState()
    state.bulkEmailsText.value = ' Dev1@Example.com, dev2@example.com '
    const apiPost = vi.fn().mockResolvedValue({ data: responseData })
    const refreshOrganizationData = vi.fn().mockResolvedValue(true)
    const submit = createBulkRolloutHandler(state, {
      isAdmin: () => true,
      apiPost,
      refreshOrganizationData,
      onUnauthorized: vi.fn(),
    })

    await submit()

    expect(normalizeBulkRolloutResponse(responseData)).toBeNull()
    expect(state.bulkRolloutResult.value).toBeNull()
    expect(state.bulkRolloutAlert.value).toEqual({
      show: true,
      type: 'danger',
      message: 'The rollout link could not be generated. Please try again.',
    })
    expect(state.bulkEmailsText.value).toBe(' Dev1@Example.com, dev2@example.com ')
    expect(refreshOrganizationData).not.toHaveBeenCalled()
    expect(state.isCreatingBulkRollout.value).toBe(false)
  })

  it('keeps the generated rollout available when post-success refresh fails', async () => {
    const state = createBulkRolloutState()
    const apiPost = vi.fn().mockResolvedValue({ data: validBulkResponse })
    const refreshOrganizationData = vi.fn().mockRejectedValue(new Error('refresh unavailable'))
    const submit = createBulkRolloutHandler(state, {
      isAdmin: () => true,
      apiPost,
      refreshOrganizationData,
      onUnauthorized: vi.fn(),
    })

    await submit()

    expect(state.bulkRolloutResult.value?.rollout_url).toBe(validBulkResponse.rollout_url)
    expect(state.bulkRolloutResult.value?.summary).toEqual(validBulkResponse.summary)
    expect(state.bulkRolloutAlert.value.type).toBe('warning')
    expect(state.bulkRolloutAlert.value.message).toContain('Copy and save it now')
    expect(state.isCreatingBulkRollout.value).toBe(false)
  })

  it('prevents a second request while the first bulk request is in flight', async () => {
    const state = createBulkRolloutState()
    let resolveRequest: ((value: { data: typeof validBulkResponse }) => void) | undefined
    const apiPost = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve
    }))
    const submit = createBulkRolloutHandler(state, {
      isAdmin: () => true,
      apiPost,
      refreshOrganizationData: vi.fn().mockResolvedValue(true),
      onUnauthorized: vi.fn(),
    })

    const firstSubmit = submit()
    await submit()
    expect(apiPost).toHaveBeenCalledTimes(1)

    resolveRequest?.({ data: validBulkResponse })
    await firstSubmit
    expect(state.isCreatingBulkRollout.value).toBe(false)
    expect(state.bulkRolloutResult.value?.rollout_url).toBe(validBulkResponse.rollout_url)
  })
})
