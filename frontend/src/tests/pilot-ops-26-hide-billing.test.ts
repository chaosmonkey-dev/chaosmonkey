/**
 * Pilot Ops 26: hide placeholder billing from live pilots.
 *
 * Proves:
 * 1. No customer-visible path into /manage-billing (avatar menu, Settings
 *    nav, or any other CTA) remains in canonical source.
 * 2. /manage-billing is not routable to the placeholder page — the route
 *    is a redirect to the authenticated dashboards surface.
 * 3. The dormant ManageBilling.vue implementation is preserved, not deleted.
 * 4. Legitimate tool-cost configuration ("Edit costs") is untouched.
 * 5. Dashboard/Settings navigation structure is unchanged.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const srcRoot = path.resolve(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.resolve(srcRoot, rel), 'utf-8')

const avatarSource = read('components/NavUserAvatar.vue')
const routerSource = read('router/index.ts')
const settingsSource = read('pages/Settings.vue')
const pbtSource = read('components/ProductivityByToolV3.vue')

describe('Pilot Ops 26 — billing hidden from live pilots', () => {
  it('avatar/profile menu exposes no Manage Billing item', () => {
    expect(avatarSource).not.toContain('Manage Billing')
    expect(avatarSource).not.toContain('handleManageBilling')
    expect(avatarSource).not.toContain('/manage-billing')
    expect(avatarSource).not.toContain('simulatedBilling')
    // Remaining menu entries preserved
    expect(avatarSource).toContain('Manage Team')
    expect(avatarSource).toContain('Settings')
    expect(avatarSource).toContain('Logout')
  })

  it('/manage-billing cannot render the placeholder page', () => {
    // The route must not mount ManageBilling.vue
    expect(routerSource).not.toContain("import('../pages/ManageBilling.vue')")
    expect(routerSource).not.toContain("name: 'ManageBilling'")
  })

  it('/manage-billing redirects safely to an authenticated surface', () => {
    // Route exists as a redirect, mirroring the /manage-teams pattern
    const routeMatch = routerSource.match(
      /path:\s*'\/manage-billing'[\s\S]*?redirect:\s*\{[^}]*path:\s*'\/dashboards'/
    )
    expect(routeMatch).not.toBeNull()
    // /dashboards remains a real route the redirect can land on
    expect(routerSource).toContain("path: '/dashboards'")
  })

  it('no remaining customer-visible path into /manage-billing exists in src', () => {
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'tests' || entry.name === 'node_modules') continue
          walk(full)
        } else if (/\.(vue|ts|js)$/.test(entry.name)) {
          const content = fs.readFileSync(full, 'utf-8')
          // The router's own redirect definition is the only permitted mention.
          if (full.endsWith('router/index.ts')) {
            const stripped = content.replace(
              /\/\/[^\n]*(?:manage-billing|ManageBilling)[^\n]*|path:\s*'\/manage-billing'|to\.path === '\/manage-billing'/g,
              ''
            )
            if (stripped.includes('manage-billing') || stripped.includes('ManageBilling')) {
              hits.push(full)
            }
          } else if (content.includes('/manage-billing') || content.includes('ManageBilling')) {
            hits.push(full)
          }
        }
      }
    }
    walk(srcRoot)
    expect(hits).toEqual([])
  })

  it('ManageBilling.vue dormant implementation is preserved, not deleted', () => {
    expect(fs.existsSync(path.resolve(srcRoot, 'pages/ManageBilling.vue'))).toBe(true)
  })

  it('Settings keeps billing out of functional tabs and exposes no billing nav', () => {
    const functionalMatch = settingsSource.match(/functionalTabs = \[([^\]]*)\]/)
    expect(functionalMatch).not.toBeNull()
    expect(functionalMatch![1]).not.toContain('billing')
    // Billing nav link stays hidden behind v-if="false"
    expect(settingsSource).toContain("setTab('billing')")
    const billingNav = settingsSource.match(
      /v-if="false"[\s\S]{0,200}?setTab\('billing'\)/
    )
    expect(billingNav).not.toBeNull()
  })

  it('Edit costs / tool-cost configuration is preserved', () => {
    expect(pbtSource).toContain('Edit costs')
    expect(pbtSource).toContain('showCostEditor')
    // Cost disclaimers are cost-config semantics, not billing UI
    expect(pbtSource).toContain('Not billing data')
  })
})
