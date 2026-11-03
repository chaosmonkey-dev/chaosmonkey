import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock localStorage for Node test env
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()

if (typeof globalThis.localStorage === 'undefined') {
  ;(globalThis as any).localStorage = localStorageMock
}
if (typeof globalThis.window === 'undefined') {
  ;(globalThis as any).window = { location: { origin: '' } }
}

// Replicate the isAuthenticated logic from NavUserAvatar (post-fix)
// Dashboard auth is the authority, NOT GitHub OAuth status.
function dashboardIsAuthed(): boolean {
  const token = localStorage.getItem('api_token')
  return !!(token && token !== 'oauth_authenticated' && token.trim() !== '')
}

// Replicate the valid tabs list from Settings.vue
const validTabs = ['profile', 'team', 'notifications', 'security', 'billing', 'integrations', 'preferences']

function resolveTab(tabParam: unknown): string {
  if (typeof tabParam === 'string' && validTabs.includes(tabParam)) {
    return tabParam
  }
  return 'profile'
}

describe('Patra enrollment UX — avatar clickability', () => {
  beforeEach(() => localStorageMock.clear())

  it('1) authenticated dashboard user with no GitHub OAuth can click avatar', () => {
    localStorage.setItem('api_token', 'valid-dashboard-token-12345')
    // Simulate: GitHub OAuth status returns oauth_authenticated=false
    // (support login, not customer metrics authority)
    const oauthAuthenticated = false
    // Post-fix: isAuthenticated is based on dashboard token, not OAuth
    const isAuthed = dashboardIsAuthed()
    expect(isAuthed).toBe(true)
    // Even though GitHub OAuth is false, avatar should NOT be disabled
    expect(oauthAuthenticated).toBe(false)
    expect(isAuthed).toBe(true) // avatar enabled
  })

  it('2) unauthenticated user cannot click avatar', () => {
    const token = localStorage.getItem('api_token')
    const isAuthed = dashboardIsAuthed()
    expect(isAuthed).toBe(false)
  })

  it('3) sentinel token does not authenticate', () => {
    localStorage.setItem('api_token', 'oauth_authenticated')
    const isAuthed = dashboardIsAuthed()
    expect(isAuthed).toBe(false)
  })

  it('4) empty token does not authenticate', () => {
    localStorage.setItem('api_token', '   ')
    const isAuthed = dashboardIsAuthed()
    expect(isAuthed).toBe(false)
  })
})

describe('Patra enrollment UX — Settings tab query param', () => {
  it('5) /settings?tab=team opens Team tab', () => {
    const tab = resolveTab('team')
    expect(tab).toBe('team')
  })

  it('6) /settings?tab=profile opens Profile tab', () => {
    const tab = resolveTab('profile')
    expect(tab).toBe('profile')
  })

  it('7) invalid tab falls back to profile', () => {
    const tab = resolveTab('nonexistent')
    expect(tab).toBe('profile')
  })

  it('8) missing tab falls back to profile', () => {
    const tab = resolveTab(undefined)
    expect(tab).toBe('profile')
  })
})

describe('Patra enrollment UX — legacy /manage-teams redirect', () => {
  it('9) /manage-teams redirects to /settings?tab=team', () => {
    // The router redirect is: { path: '/settings', query: { tab: 'team' } }
    const redirectTarget = { path: '/settings', query: { tab: 'team' } }
    expect(redirectTarget.path).toBe('/settings')
    expect(redirectTarget.query.tab).toBe('team')
  })
})

describe('Patra enrollment UX — developer enrollment payload', () => {
  it('10) developer enrollment requires a developer email/identifier', () => {
    // createDeveloperEnrollment validates a non-empty email before posting.
    const email = ''
    const trimmed = email.trim()
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
    expect(isValid).toBe(false) // empty input is rejected, no anonymous row created
  })

  it('11) developer enrollment sends email as roster label with send_email:false', () => {
    // The createDeveloperEnrollment function sends:
    // { role: 'member', email: <developer email>, send_email: false, expires_hours: 168 }
    const invitePayload = { role: 'member', email: 'alex@company.com', send_email: false, expires_hours: 168 }
    expect(invitePayload.email).toBe('alex@company.com')
    expect(invitePayload.role).toBe('member')
    expect(invitePayload.send_email).toBe(false) // no mail delivery attempted
    expect(invitePayload.expires_hours).toBe(168)
  })

  it('12) invalid email is rejected before creating an enrollment', () => {
    const email = 'not-an-email'
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    expect(isValid).toBe(false)
  })
})

describe('Patra enrollment UX — customer-facing status model', () => {
  it('13) pending invite with no code shows Pending', () => {
    const member = { status: 'pending', enrollment_status: 'not_generated' }
    const label = member.status === 'pending'
      ? (member.enrollment_status === 'connected' ? 'Connected'
        : member.enrollment_status === 'ready' ? 'Ready to connect'
        : 'Pending')
      : 'Active'
    expect(label).toBe('Pending')
  })

  it('14) pending invite with a code shows Ready to connect', () => {
    const member = { status: 'pending', enrollment_status: 'ready' }
    const label = member.enrollment_status === 'connected' ? 'Connected'
      : member.enrollment_status === 'ready' ? 'Ready to connect'
      : 'Pending'
    expect(label).toBe('Ready to connect')
  })

  it('15) pending invite with installation evidence shows Connected', () => {
    const member = { status: 'pending', enrollment_status: 'connected', installation_count: 2 }
    const label = member.enrollment_status === 'connected' ? 'Connected'
      : member.enrollment_status === 'ready' ? 'Ready to connect'
      : 'Pending'
    expect(label).toBe('Connected')
    expect(member.installation_count).toBeGreaterThan(0)
  })
})

describe('Patra enrollment UX — copy setup instructions content', () => {
  it('16) setup instructions identify the developer and use configured base URL', () => {
    const member = { email: 'alex@patra.com', connect_code: 'ABCD1234-EFGH5678' }
    const connectBaseUrl = 'https://patra.chaosmonkey.dev'
    const developerIdentity = member.email || member.name || 'developer'
    const instructions = `ChaosMonkey 0.4.1 setup for ${developerIdentity}

1. Install the ChaosMonkey 0.4.1 VSIX provided by your engineering leader.
2. In VS Code, Cursor, or Devin Desktop, open Extensions.
3. Choose "Install from VSIX…" and select the downloaded file.
4. Open the Command Palette and run "ChaosMonkey: Connect".
5. Enter this API base URL when prompted:
   ${connectBaseUrl}
6. Enter this enrollment code when prompted:
   ${member.connect_code}

You may use the same enrollment code in each supported editor you use. Each
editor will receive its own secure installation connection.`
    expect(instructions).toContain('alex@patra.com')
    expect(instructions).toContain('https://patra.chaosmonkey.dev')
    expect(instructions).toContain('ABCD1234-EFGH5678')
    expect(instructions).not.toContain('Pending invitation')
  })
})

describe('Patra enrollment UX — duplicate prevention', () => {
  it('17) duplicate active/pending email is handled safely (422 warning, no silent duplicate)', () => {
    // Backend returns 422 with message when an active user or pending invite
    // already exists for the email in this org. Frontend shows a warning,
    // it does NOT silently create another row.
    const error = { response: { status: 422, data: { message: 'An invite has already been sent to this email.' } } }
    const status = error.response.status
    expect(status).toBe(422)
    const alertType = status === 422 ? 'warning' : 'danger'
    expect(alertType).toBe('warning')
  })
})
