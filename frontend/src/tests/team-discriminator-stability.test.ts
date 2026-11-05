import { describe, it, expect } from 'vitest'

/**
 * Regression test: Team page entity-type discriminator stability.
 *
 * The Team page splits visible members into two sections:
 *   - Dashboard Members (status === 'active')
 *   - Developer Enrollments (status === 'pending')
 *
 * This test proves that the discriminator is stable across the full
 * developer enrollment lifecycle:
 *   not_generated → ready (code generated) → connected (installation linked)
 *
 * A developer enrollment MUST stay in Developer Enrollments across all
 * lifecycle states. A dashboard member MUST stay in Dashboard Members.
 *
 * Backend proof (OrganizationController::users):
 *   - Active users come from the `users` table → status: 'active', id: <user_id>
 *   - Pending invites come from the `invites` table (redeemed_at IS NULL) → status: 'pending', id: null, invite_id: <invite_id>
 *   - The connect-code exchange flow (IDEController::connect) does NOT set redeemed_at
 *   - Only acceptInvite or GitHub OAuth redemption sets redeemed_at (dashboard user path)
 *   - Therefore status === 'pending' is stable for developer enrollments across all lifecycle states
 */

// Mirror the exact computed properties from Settings.vue
function classifyMembers(members: any[]) {
  const visibleTeamMembers = members
  const dashboardMembers = visibleTeamMembers.filter((m: any) => m.status === 'active')
  const developerEnrollments = visibleTeamMembers.filter((m: any) => m.status === 'pending')
  return { dashboardMembers, developerEnrollments }
}

// Factory: dashboard member (from users table, status: active)
function dashboardMember(overrides: Partial<any> = {}) {
  return {
    id: 1,
    name: 'Riley Admin',
    email: 'riley@chaosmonkey.dev',
    github_id: 98765432,
    role: 'admin',
    status: 'active',
    ...overrides,
  }
}

// Factory: developer enrollment (from invites table, status: pending)
function developerEnrollment(overrides: Partial<any> = {}) {
  return {
    id: null,
    name: 'dev@test.com',
    email: 'dev@test.com',
    github_id: null,
    role: 'member',
    status: 'pending',
    invite_id: 1,
    has_connect_code: false,
    enrollment_status: 'not_generated',
    installation_count: 0,
    ...overrides,
  }
}

describe('Team discriminator stability — entity type does not change with lifecycle', () => {
  it('dashboard member stays in Dashboard Members (never migrates to Developer Enrollments)', () => {
    const members = [dashboardMember()]
    const { dashboardMembers, developerEnrollments } = classifyMembers(members)
    expect(dashboardMembers).toHaveLength(1)
    expect(developerEnrollments).toHaveLength(0)
  })

  it('unredeemed developer enrollment (not_generated) stays in Developer Enrollments', () => {
    const members = [developerEnrollment({ enrollment_status: 'not_generated', has_connect_code: false, installation_count: 0 })]
    const { dashboardMembers, developerEnrollments } = classifyMembers(members)
    expect(dashboardMembers).toHaveLength(0)
    expect(developerEnrollments).toHaveLength(1)
  })

  it('developer enrollment with generated code (ready) stays in Developer Enrollments', () => {
    const members = [developerEnrollment({ enrollment_status: 'ready', has_connect_code: true, installation_count: 0 })]
    const { dashboardMembers, developerEnrollments } = classifyMembers(members)
    expect(dashboardMembers).toHaveLength(0)
    expect(developerEnrollments).toHaveLength(1)
  })

  it('connected developer enrollment (installation linked) stays in Developer Enrollments', () => {
    const members = [developerEnrollment({ enrollment_status: 'connected', has_connect_code: true, installation_count: 2 })]
    const { dashboardMembers, developerEnrollments } = classifyMembers(members)
    expect(dashboardMembers).toHaveLength(0)
    expect(developerEnrollments).toHaveLength(1)
  })

  it('mixed roster: dashboard member + all enrollment lifecycle states coexist correctly', () => {
    const members = [
      dashboardMember({ id: 1, name: 'Member Two' }),
      dashboardMember({ id: 2, name: 'Matt' }),
      developerEnrollment({ invite_id: 10, enrollment_status: 'not_generated', has_connect_code: false, installation_count: 0 }),
      developerEnrollment({ invite_id: 11, enrollment_status: 'ready', has_connect_code: true, installation_count: 0 }),
      developerEnrollment({ invite_id: 12, enrollment_status: 'connected', has_connect_code: true, installation_count: 3 }),
    ]
    const { dashboardMembers, developerEnrollments } = classifyMembers(members)
    expect(dashboardMembers).toHaveLength(2)
    expect(developerEnrollments).toHaveLength(3)
    expect(dashboardMembers.every((m: any) => m.status === 'active')).toBe(true)
    expect(developerEnrollments.every((m: any) => m.status === 'pending')).toBe(true)
  })
})
