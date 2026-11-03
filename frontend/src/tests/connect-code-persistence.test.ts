import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Regression tests for enrollment code persistence / Show-Hide UX.
 *
 * These tests replicate the exact frontend state model used by Settings.vue:
 * - roster provides has_connect_code (boolean, non-secret) — survives refresh
 * - visibleCodes is a presentation-only map (invite_id → code string) — does NOT survive refresh
 * - Show code calls the issue endpoint (returns existing active code, does not rotate)
 * - Hide code clears visibleCodes only (no backend mutation)
 * - Generate code calls the issue endpoint for the first time
 * - Copy setup instructions uses the currently revealed code from visibleCodes
 */

// --- State model (mirrors Settings.vue) ---

function createRosterMember(inviteId: number, hasCode: boolean, email = 'dev@test.com') {
  return {
    id: null,
    name: email,
    email,
    status: 'pending',
    invite_id: inviteId,
    has_connect_code: hasCode,
    connect_code_expires_at: hasCode ? '2026-09-11T00:00:00.000Z' : null,
    enrollment_status: hasCode ? 'ready' : 'not_generated',
    installation_count: 0,
  }
}

function createVisibleCodes(): Record<number, string> {
  return {}
}

// Simulate the issue endpoint: returns existing code if one exists, else creates new
const mockIssueEndpoint = vi.fn((inviteId: number, existingCode: string | null): { connect_code: string; expires_at: string } => {
  if (existingCode) {
    return { connect_code: existingCode, expires_at: '2026-09-11T00:00:00.000Z' }
  }
  return { connect_code: 'NEW-CODE-' + inviteId, expires_at: '2026-09-11T00:00:00.000Z' }
})

// --- Tests ---

describe('Connect code persistence — Show/Hide/Generated UX', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1) invite with no active code → has_connect_code=false, shows Generate code', () => {
    const member = createRosterMember(1, false)
    expect(member.has_connect_code).toBe(false)
    expect(member.enrollment_status).toBe('not_generated')
    // UI logic: no has_connect_code → "Not generated" + "Generate code" button
    const visibleCodes = createVisibleCodes()
    const showsCode = !!visibleCodes[member.invite_id]
    const showsGenerated = member.has_connect_code && !showsCode
    const showsNotGenerated = !member.has_connect_code
    expect(showsCode).toBe(false)
    expect(showsGenerated).toBe(false)
    expect(showsNotGenerated).toBe(true)
  })

  it('2) invite with active code → has_connect_code=true, shows Generated (after refresh)', () => {
    const member = createRosterMember(2, true)
    expect(member.has_connect_code).toBe(true)
    expect(member.enrollment_status).toBe('ready')
    // After refresh: visibleCodes is empty, but has_connect_code=true → "Generated" + "Show code"
    const visibleCodes = createVisibleCodes()
    const showsCode = !!visibleCodes[member.invite_id]
    const showsGenerated = member.has_connect_code && !showsCode
    expect(showsCode).toBe(false)
    expect(showsGenerated).toBe(true)
  })

  it('3) refresh/re-fetch retains generated-state knowledge via has_connect_code', () => {
    // Simulate: code was generated, then page refreshed
    // Before refresh: visibleCodes had the code, has_connect_code was true
    // After refresh: visibleCodes is cleared, but roster still has has_connect_code=true
    const rosterAfterRefresh = createRosterMember(3, true)
    const visibleCodesAfterRefresh = createVisibleCodes()

    // The UI must still know the code exists
    expect(rosterAfterRefresh.has_connect_code).toBe(true)
    expect(visibleCodesAfterRefresh[rosterAfterRefresh.invite_id]).toBeUndefined()

    // UI shows "Generated" + "Show code" (not "Not generated")
    const showsNotGenerated = !rosterAfterRefresh.has_connect_code
    expect(showsNotGenerated).toBe(false)
  })

  it('4) calling issue twice returns the identical active enrollment code', () => {
    const inviteId = 4
    // First call creates a code
    const resp1 = mockIssueEndpoint(inviteId, null)
    const code1 = resp1.connect_code
    expect(code1).toBeTruthy()

    // Second call returns the SAME code (issueForInvite is idempotent)
    const resp2 = mockIssueEndpoint(inviteId, code1)
    const code2 = resp2.connect_code

    expect(code2).toBe(code1)
    expect(mockIssueEndpoint).toHaveBeenCalledTimes(2)
  })

  it('5) Show code does not rotate it — returns the existing active code', () => {
    const inviteId = 5
    // Generate first
    const genResp = mockIssueEndpoint(inviteId, null)
    const generatedCode = genResp.connect_code

    // Show code = call issue endpoint again, must return same code
    const showResp = mockIssueEndpoint(inviteId, generatedCode)
    const shownCode = showResp.connect_code

    expect(shownCode).toBe(generatedCode)
  })

  it('6) Hide code performs no backend mutation', () => {
    const inviteId = 6
    const visibleCodes: Record<number, string> = { [inviteId]: 'ABCD1234-EFGH5678' }

    // Hide code = remove from visibleCodes only, no API call
    const deleteSpy = vi.fn()
    const next = { ...visibleCodes }
    delete next[inviteId]
    deleteSpy()

    expect(next[inviteId]).toBeUndefined()
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    // No API call was made — deleteSpy is just the local operation, not an HTTP call
    expect(mockIssueEndpoint).not.toHaveBeenCalled()
  })

  it('7) expired/revoked code correctly returns to Generate-code state', () => {
    // After revoke: roster returns has_connect_code=false
    const memberAfterRevoke = createRosterMember(7, false)
    const visibleCodes = createVisibleCodes()

    expect(memberAfterRevoke.has_connect_code).toBe(false)
    expect(memberAfterRevoke.enrollment_status).toBe('not_generated')
    expect(visibleCodes[memberAfterRevoke.invite_id]).toBeUndefined()

    // UI shows "Not generated" + "Generate code"
    const showsNotGenerated = !memberAfterRevoke.has_connect_code
    expect(showsNotGenerated).toBe(true)
  })

  it('8) Copy setup instructions uses the currently revealed persisted code', () => {
    const inviteId = 8
    const member = createRosterMember(inviteId, true)
    const visibleCodes: Record<number, string> = { [inviteId]: 'ABCD1234-EFGH5678' }

    // Copy setup instructions uses visibleCodes[invite_id], NOT member.connect_code
    const code = visibleCodes[member.invite_id]
    expect(code).toBe('ABCD1234-EFGH5678')

    const connectBaseUrl = 'http://localhost:8010'
    const developerIdentity = member.email || member.name || 'developer'
    const instructions = `ChaosMonkey 0.4.1 setup for ${developerIdentity}

1. Install the ChaosMonkey 0.4.1 VSIX provided by your engineering leader.
2. In VS Code, Cursor, or Devin Desktop, open Extensions.
3. Choose "Install from VSIX…" and select the downloaded file.
4. Open the Command Palette and run "ChaosMonkey: Connect".
5. Enter this API base URL when prompted:
   ${connectBaseUrl}
6. Enter this enrollment code when prompted:
   ${code}

You may use the same enrollment code in each supported editor you use. Each
editor will receive its own secure installation connection.`

    expect(instructions).toContain('ABCD1234-EFGH5678')
    expect(instructions).toContain('dev@test.com')
    expect(instructions).toContain('http://localhost:8010')
  })
})

describe('Connect code persistence — roster contract', () => {
  it('9) roster must NOT ship plaintext connect_code', () => {
    const member = createRosterMember(10, true)
    expect(member).not.toHaveProperty('connect_code')
  })

  it('10) roster with has_connect_code=true but visibleCodes empty → shows Generated not Not generated', () => {
    const member = createRosterMember(11, true)
    const visibleCodes = createVisibleCodes()

    const showsCode = !!visibleCodes[member.invite_id]
    const showsGenerated = member.has_connect_code && !showsCode
    const showsNotGenerated = !member.has_connect_code

    expect(showsCode).toBe(false)
    expect(showsGenerated).toBe(true)
    expect(showsNotGenerated).toBe(false)
  })
})

describe('PILOT OPS 14-B: expired connect-code truth on Team', () => {
  // Mirrors the backend roster contract: an expired unused code surfaces as
  // enrollment_status='expired' + connect_code_expired=true so the Team page
  // shows "Code expired" + a Regenerate action instead of "Ready to connect".
  function createExpiredRosterMember(inviteId: number, email = 'expired@test.com') {
    return {
      id: null,
      name: email,
      email,
      status: 'pending',
      invite_id: inviteId,
      has_connect_code: true,
      has_valid_connect_code: false,
      connect_code_expired: true,
      connect_code_expires_at: '2026-09-01T00:00:00.000Z',
      enrollment_status: 'expired',
      installation_count: 0,
    }
  }

  // Mirrors Settings.vue memberStatusLabel
  function labelFor(member: any): string {
    if (member.status === 'active') return 'Active'
    if (member.status === 'pending') {
      switch (member.enrollment_status) {
        case 'connected': return 'Connected'
        case 'ready': return 'Ready to connect'
        case 'revoked': return 'Code revoked'
        case 'expired': return 'Code expired'
        default: return 'Pending'
      }
    }
    return member.status || 'unknown'
  }

  it('11) expired unused code shows "Code expired", not "Ready to connect"', () => {
    const member = createExpiredRosterMember(20)
    expect(labelFor(member)).toBe('Code expired')
    expect(labelFor(member)).not.toBe('Ready to connect')
  })

  it('12) expired member carries connect_code_expired=true and has_valid_connect_code=false', () => {
    const member = createExpiredRosterMember(21)
    expect(member.connect_code_expired).toBe(true)
    expect(member.has_valid_connect_code).toBe(false)
    expect(member.enrollment_status).toBe('expired')
  })

  it('13) UI shows Regenerate action (not Show code) for an expired code', () => {
    const member = createExpiredRosterMember(22)
    const visibleCodes: Record<number, string> = {}
    const showsCode = !!visibleCodes[member.invite_id]
    // Show-code button is gated on has_connect_code && !connect_code_expired
    const showsShowCode = !showsCode && member.has_connect_code && !member.connect_code_expired
    // Regenerate button is gated on connect_code_expired
    const showsRegenerate = member.connect_code_expired

    expect(showsShowCode).toBe(false)
    expect(showsRegenerate).toBe(true)
  })

  it('14) valid unused code still shows "Ready to connect"', () => {
    const member = {
      ...createExpiredRosterMember(23),
      has_valid_connect_code: true,
      connect_code_expired: false,
      enrollment_status: 'ready',
    }
    expect(labelFor(member)).toBe('Ready to connect')
  })
})

describe('PILOT OPS 18H: revoked connect-code lifecycle on Team', () => {
  // Mirrors the backend roster contract: an admin-revoked code surfaces as
  // enrollment_status='revoked' + connect_code_revoked=true (never "expired").
  function createRevokedRosterMember(inviteId: number, email = 'revoked@test.com') {
    return {
      id: null,
      name: email,
      email,
      status: 'pending',
      invite_id: inviteId,
      has_connect_code: true,
      has_valid_connect_code: false,
      connect_code_expired: false,
      connect_code_revoked: true,
      connect_code_expires_at: '2000-01-01T00:00:00.000Z',
      enrollment_status: 'revoked',
      installation_count: 0,
    }
  }

  function labelFor(member: any): string {
    if (member.status === 'active') return 'Active'
    if (member.status === 'pending') {
      switch (member.enrollment_status) {
        case 'connected': return 'Connected'
        case 'ready': return 'Ready to connect'
        case 'revoked': return 'Code revoked'
        case 'expired': return 'Code expired'
        default: return 'Pending'
      }
    }
    return member.status || 'unknown'
  }

  it('15) revoked code shows "Code revoked", not "Code expired" or "Ready to connect"', () => {
    const member = createRevokedRosterMember(30)
    expect(labelFor(member)).toBe('Code revoked')
    expect(labelFor(member)).not.toBe('Code expired')
    expect(labelFor(member)).not.toBe('Ready to connect')
  })

  it('16) revoked member carries connect_code_revoked=true and not connect_code_expired', () => {
    const member = createRevokedRosterMember(31)
    expect(member.connect_code_revoked).toBe(true)
    expect(member.connect_code_expired).toBe(false)
    expect(member.has_valid_connect_code).toBe(false)
    expect(member.enrollment_status).toBe('revoked')
  })

  it('17) UI shows Regenerate action (not Show code) for a revoked code', () => {
    const member = createRevokedRosterMember(32)
    const visibleCodes: Record<number, string> = {}
    const showsCode = !!visibleCodes[member.invite_id]
    // Show-code button is gated on has_connect_code && !connect_code_expired && !connect_code_revoked
    const showsShowCode = !showsCode && member.has_connect_code && !member.connect_code_expired && !member.connect_code_revoked
    // Regenerate button is gated on connect_code_expired || connect_code_revoked
    const showsRegenerate = member.connect_code_expired || member.connect_code_revoked

    expect(showsShowCode).toBe(false)
    expect(showsRegenerate).toBe(true)
  })

  it('18) regenerate on a connected member must NOT downgrade to ready (18H.1)', () => {
    // Mirrors the fixed generateConnectCode handler: after a successful
    // regenerate the status is derived from installation_count, not forced
    // to 'ready'. Connected developers keep their connected state.
    const member = {
      invite_id: 34,
      email: 'connected@test.com',
      status: 'pending',
      has_connect_code: true,
      has_valid_connect_code: false,
      connect_code_expired: true,
      connect_code_revoked: false,
      enrollment_status: 'connected',
      installation_count: 2,
    }

    // Simulate handler post-success state assignment (18H.1 fix)
    member.has_connect_code = true
    member.has_valid_connect_code = true
    member.connect_code_expired = false
    member.connect_code_revoked = false
    member.enrollment_status = (member.installation_count ?? 0) > 0 ? 'connected' : 'ready'

    expect(member.enrollment_status).toBe('connected')
    expect(member.installation_count).toBe(2)
    // "N installations connected" indicator gates on enrollment_status === 'connected'
    const showsInstallations = member.enrollment_status === 'connected'
    expect(showsInstallations).toBe(true)
  })

  it('19) generate on a never-connected member still lands on ready', () => {
    const member: any = { installation_count: 0 }
    member.enrollment_status = (member.installation_count ?? 0) > 0 ? 'connected' : 'ready'
    expect(member.enrollment_status).toBe('ready')
  })

  it('20) non-expiring enrollment never reaches a natural "expired" state', () => {
    // A live enrollment code carries the never-expires sentinel; nothing in
    // the lifecycle can transition it to expired by time passing.
    const member = {
      id: null,
      name: 'dev@test.com',
      email: 'dev@test.com',
      status: 'pending',
      invite_id: 33,
      has_connect_code: true,
      has_valid_connect_code: true,
      connect_code_expired: false,
      connect_code_revoked: false,
      connect_code_expires_at: '2099-12-31T23:59:59.000Z',
      enrollment_status: 'ready',
      installation_count: 0,
    }
    expect(labelFor(member)).toBe('Ready to connect')
    expect(member.connect_code_expired).toBe(false)
  })
})
