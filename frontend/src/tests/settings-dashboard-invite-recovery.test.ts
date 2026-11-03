/**
 * Settings > Team: pending dashboard-invite recovery regression
 *
 * Proves the admin recovery surface exists and stays correct:
 *  - pending dashboard invites (invite_kind === 'dashboard') render in the
 *    Dashboard Users section, NOT in the developer-enrollment roster
 *  - each pending row exposes Copy invite link + Reissue invite + Cancel
 *  - recovery goes through the single-purpose backend endpoints that emit
 *    the token only on explicit admin request — the roster payload is
 *    never expected to carry invite_token
 *  - reissue confirms before invalidating the previous link
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const settingsPath = resolve(__dirname, '../pages/Settings.vue')
const settingsSource = readFileSync(settingsPath, 'utf-8')

describe('Settings dashboard-invite recovery', () => {
  it('pending dashboard invites are split out of the developer-enrollment roster', () => {
    expect(settingsSource).toContain("m.status === 'pending' && m.invite_kind !== 'dashboard'")
    expect(settingsSource).toContain("m.status === 'pending' && m.invite_kind === 'dashboard'")
  })

  it('pending dashboard invite rows expose recovery actions', () => {
    expect(settingsSource).toContain('pendingDashboardInvites')
    expect(settingsSource).toContain('Copy invite link')
    expect(settingsSource).toContain('Reissue invite')
    expect(settingsSource).toContain('Pending invitations')
  })

  it('copy uses the accept-link endpoint and clipboard, never a stored roster token', () => {
    expect(settingsSource).toContain('accept-link')
    expect(settingsSource).toContain('navigator.clipboard.writeText(url)')
    expect(settingsSource).not.toContain('member.invite_token')
  })

  it('reissue goes through the reissue endpoint behind a confirm dialog', () => {
    expect(settingsSource).toContain('/reissue')
    expect(settingsSource).toContain('showTeamConfirm')
    expect(settingsSource).toContain('previous link will stop working')
  })

  it('roster/pending invite code path does not reference invite_token anymore', () => {
    // The backend no longer emits invite_token in /api/org/users; nothing in
    // Settings should depend on it.
    expect(settingsSource).not.toContain('invite_token')
  })
})
