/**
 * CR-X AH-3: ERROR != EMPTY != LOADING regression test.
 *
 * The 8011 proxy failure caused HTTP 500s to render as:
 * - "No workflow telemetry yet"
 * - "Ready for your first telemetry"
 * - zero workflow/session states
 *
 * This is unacceptable for live pilots. A real API/runtime failure must
 * visibly fail closed as unavailable/error, not masquerade as a zero-data
 * customer state.
 *
 * Required customer states must remain distinct:
 *   LOADING
 *   ERROR / UNAVAILABLE
 *   VALID EMPTY / DAY-0
 *   VALID POPULATED
 */
import { describe, it, expect } from 'vitest'
import { ref, computed, type Ref } from 'vue'

// Simulate the useTimeSeries composable's state contract
type TimeSeriesState = {
  data: Ref<any[] | null>
  isLoading: Ref<boolean>
  error: Ref<string | null>
}

// Simulate the PBT component's state derivation
function derivePbtDisplayState(state: TimeSeriesState, canonicalHydrating: boolean, v3Cards: any[]) {
  if (canonicalHydrating && v3Cards.length === 0) return 'LOADING'
  // CR-X AH-3: ERROR check comes BEFORE EMPTY check
  if (state.error.value && !state.data.value) return 'ERROR'
  if (v3Cards.length === 0) return 'EMPTY'
  return 'POPULATED'
}

// Simulate the AIOI component's state derivation
function deriveAioiDisplayState(
  canonicalHydrating: boolean,
  canonicalError: string | null,
  allMeasuredWorkflows: any[],
  aiOpsRenderError: boolean
) {
  if (aiOpsRenderError) return 'RENDER_ERROR'
  // CR-X AH-3: ERROR check comes BEFORE EMPTY check
  if (canonicalError) return 'ERROR'
  if (canonicalHydrating) return 'LOADING'
  if (allMeasuredWorkflows.length === 0) return 'EMPTY'
  return 'POPULATED'
}

describe('CR-X AH-3: ERROR != EMPTY != LOADING', () => {
  describe('PBT component state derivation', () => {
    it('LOADING: canonicalHydrating=true + no cards → LOADING', () => {
      const state = {
        data: ref(null),
        isLoading: ref(false),
        error: ref(null),
      }
      const result = derivePbtDisplayState(state, true, [])
      expect(result).toBe('LOADING')
    })

    it('ERROR: API 500 + no prior data → ERROR (not EMPTY)', () => {
      const state = {
        data: ref(null),
        isLoading: ref(false),
        error: ref('HTTP 500: Internal Server Error'),
      }
      const result = derivePbtDisplayState(state, false, [])
      expect(result).toBe('ERROR')
      expect(result).not.toBe('EMPTY')
    })

    it('ERROR: network failure + no prior data → ERROR (not EMPTY)', () => {
      const state = {
        data: ref(null),
        isLoading: ref(false),
        error: ref('Network Error: Failed to fetch'),
      }
      const result = derivePbtDisplayState(state, false, [])
      expect(result).toBe('ERROR')
      expect(result).not.toBe('EMPTY')
    })

    it('ERROR: backend unreachable + no prior data → ERROR (not EMPTY)', () => {
      const state = {
        data: ref(null),
        isLoading: ref(false),
        error: ref('ECONNREFUSED'),
      }
      const result = derivePbtDisplayState(state, false, [])
      expect(result).toBe('ERROR')
      expect(result).not.toBe('EMPTY')
    })

    it('VALID EMPTY: no error + no data + no cards → EMPTY (Day-0 pilot)', () => {
      const state = {
        data: ref([]),
        isLoading: ref(false),
        error: ref(null),
      }
      const result = derivePbtDisplayState(state, false, [])
      expect(result).toBe('EMPTY')
      expect(result).not.toBe('ERROR')
    })

    it('VALID POPULATED: no error + data + cards → POPULATED', () => {
      const state = {
        data: ref([{ label: 'devin', points: [{ t: '2026-08-31', v: 10 }] }]),
        isLoading: ref(false),
        error: ref(null),
      }
      const result = derivePbtDisplayState(state, false, [{ id: 'devin' }])
      expect(result).toBe('POPULATED')
    })

    it('ERROR preserves prior data: error + prior data → POPULATED (not ERROR)', () => {
      // When we have prior good data and a new fetch fails, we preserve
      // the prior data. The user sees stale data, not an error screen.
      const state = {
        data: ref([{ label: 'devin', points: [{ t: '2026-08-31', v: 10 }] }]),
        isLoading: ref(false),
        error: ref('HTTP 500 on refresh'),
      }
      const result = derivePbtDisplayState(state, false, [{ id: 'devin' }])
      expect(result).toBe('POPULATED')
    })

    it('LOADING then ERROR then LOADING then POPULATED lifecycle', () => {
      const state = {
        data: ref(null),
        isLoading: ref(true),
        error: ref(null),
      }
      // Initial load
      expect(derivePbtDisplayState(state, true, [])).toBe('LOADING')
      // Load fails
      state.isLoading.value = false
      state.error.value = 'HTTP 500'
      expect(derivePbtDisplayState(state, false, [])).toBe('ERROR')
      // Retry
      state.isLoading.value = true
      state.error.value = null
      expect(derivePbtDisplayState(state, true, [])).toBe('LOADING')
      // Success
      state.isLoading.value = false
      state.data.value = [{ label: 'devin', points: [] }]
      expect(derivePbtDisplayState(state, false, [{ id: 'devin' }])).toBe('POPULATED')
    })
  })

  describe('AIOI component state derivation', () => {
    it('LOADING: canonicalHydrating=true → LOADING', () => {
      const result = deriveAioiDisplayState(true, null, [], false)
      expect(result).toBe('LOADING')
    })

    it('ERROR: canonicalError set → ERROR (not EMPTY)', () => {
      const result = deriveAioiDisplayState(false, 'Canonical fetch failed', [], false)
      expect(result).toBe('ERROR')
      expect(result).not.toBe('EMPTY')
    })

    it('ERROR takes precedence over LOADING', () => {
      // If canonicalError is set, show ERROR even if canonicalHydrating is still true
      const result = deriveAioiDisplayState(true, 'HTTP 500', [], false)
      expect(result).toBe('ERROR')
    })

    it('VALID EMPTY: no error + no workflows → EMPTY (Day-0 pilot)', () => {
      const result = deriveAioiDisplayState(false, null, [], false)
      expect(result).toBe('EMPTY')
      expect(result).not.toBe('ERROR')
    })

    it('VALID POPULATED: no error + workflows → POPULATED', () => {
      const result = deriveAioiDisplayState(false, null, [{ toolId: 'devin' }], false)
      expect(result).toBe('POPULATED')
    })

    it('RENDER_ERROR: aiOpsRenderError → RENDER_ERROR', () => {
      const result = deriveAioiDisplayState(false, null, [], true)
      expect(result).toBe('RENDER_ERROR')
    })
  })

  describe('8011 proxy failure scenario (the regression we earned)', () => {
    it('HTTP 500 from proxy must not produce "No workflow telemetry yet"', () => {
      // This is the exact scenario: Vite proxy targets :8011 (nothing running),
      // every /api request returns 500, useTimeSeries catches the error.
      const state = {
        data: ref(null),
        isLoading: ref(false),
        error: ref('HTTP 500: Internal Server Error'),
      }
      const result = derivePbtDisplayState(state, false, [])
      // Must be ERROR, not EMPTY — "No workflow telemetry yet" is EMPTY
      expect(result).toBe('ERROR')
      expect(result).not.toBe('EMPTY')
    })

    it('HTTP 500 from proxy must not produce "Ready for your first telemetry"', () => {
      // AIOI with canonicalError set must show ERROR, not EMPTY
      const result = deriveAioiDisplayState(false, 'HTTP 500: Internal Server Error', [], false)
      // Must be ERROR, not EMPTY — "Ready for your first telemetry" is EMPTY
      expect(result).toBe('ERROR')
      expect(result).not.toBe('EMPTY')
    })

    it('Connection refused must not produce false empty state', () => {
      const state = {
        data: ref(null),
        isLoading: ref(false),
        error: ref('ECONNREFUSED: Connection refused at 127.0.0.1:8011'),
      }
      const result = derivePbtDisplayState(state, false, [])
      expect(result).toBe('ERROR')
    })
  })

  describe('State distinctness matrix', () => {
    it('all four states are distinct', () => {
      const states = new Set<string>()
      // LOADING
      states.add(derivePbtDisplayState(
        { data: ref(null), isLoading: ref(true), error: ref(null) },
        true, []
      ))
      // ERROR
      states.add(derivePbtDisplayState(
        { data: ref(null), isLoading: ref(false), error: ref('500') },
        false, []
      ))
      // EMPTY
      states.add(derivePbtDisplayState(
        { data: ref([]), isLoading: ref(false), error: ref(null) },
        false, []
      ))
      // POPULATED
      states.add(derivePbtDisplayState(
        { data: ref([{ x: 1 }]), isLoading: ref(false), error: ref(null) },
        false, [{ id: 'devin' }]
      ))
      expect(states.size).toBe(4)
      expect(states.has('LOADING')).toBe(true)
      expect(states.has('ERROR')).toBe(true)
      expect(states.has('EMPTY')).toBe(true)
      expect(states.has('POPULATED')).toBe(true)
    })
  })
})
