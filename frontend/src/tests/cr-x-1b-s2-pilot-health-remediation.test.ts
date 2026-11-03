/**
 * CR-X Day 1B S2: Pilot Health remediation contract — frontend rendering tests
 *
 * Tests:
 * 1. PilotHealthPanel renders remediation blocks for degraded states
 * 2. Remediation includes action text, route link, and runbook reference
 * 3. Healthy states do not render remediation (no misleading urgency)
 * 4. Remediation routes are implemented frontend URLs or API endpoints
 * 5. TypeScript type includes PilotHealthRemediation interface
 * 6. All health dimensions have remediation field in the type
 * 7. No broken or invented destinations
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const panelPath = resolve(__dirname, '../components/PilotHealthPanel.vue')
const panelSource = readFileSync(panelPath, 'utf-8')

const apiPath = resolve(__dirname, '../lib/api/pilotHealth.ts')
const apiSource = readFileSync(apiPath, 'utf-8')

function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const panelClean = stripComments(panelSource)
const apiClean = stripComments(apiSource)

describe('CR-X Day 1B S2: PilotHealthRemediation type contract', () => {
  it('defines PilotHealthRemediation interface', () => {
    expect(apiSource).toContain('PilotHealthRemediation')
    expect(apiSource).toContain('action: string')
    expect(apiSource).toContain('url: string | null')
    expect(apiSource).toContain('runbook_ref: string | null')
  })

  it('telemetry type includes remediation field', () => {
    expect(apiSource).toMatch(/telemetry:\s*\{[\s\S]*?remediation/)
  })

  it('extension type includes remediation field', () => {
    expect(apiSource).toMatch(/extension:\s*\{[\s\S]*?remediation/)
  })

  it('identity_coverage type includes remediation field', () => {
    expect(apiSource).toMatch(/identity_coverage:\s*\{[\s\S]*?remediation/)
  })

  it('github_engineering_evidence type includes remediation field', () => {
    expect(apiSource).toMatch(/github_engineering_evidence:\s*\{[\s\S]*?remediation/)
  })

  it('auth_credentials type includes remediation field', () => {
    expect(apiSource).toMatch(/auth_credentials:\s*\{[\s\S]*?remediation/)
  })

  it('cost type includes remediation field', () => {
    expect(apiSource).toMatch(/cost:\s*\{[\s\S]*?remediation/)
  })

  it('product pi and pbt types include remediation field', () => {
    expect(apiSource).toMatch(/pi:\s*\{[\s\S]*?remediation/)
    expect(apiSource).toMatch(/pbt:\s*\{[\s\S]*?remediation/)
  })

  it('decision_intelligence type includes remediation field', () => {
    expect(apiSource).toMatch(/decision_intelligence\?:\s*\{[\s\S]*?remediation/)
  })
})

describe('CR-X Day 1B S2: PilotHealthPanel renders remediation blocks', () => {
  it('has ph-remediation CSS class', () => {
    expect(panelSource).toContain('.ph-remediation')
  })

  it('renders remediation for telemetry dimension', () => {
    expect(panelClean).toContain('health.telemetry.remediation')
    expect(panelClean).toContain('ph-remediation-action')
  })

  it('renders remediation for extension dimension', () => {
    expect(panelClean).toContain('health.extension.remediation')
  })

  it('renders remediation for identity_coverage dimension', () => {
    expect(panelClean).toContain('health.identity_coverage.remediation')
  })

  it('renders remediation for repository_attribution dimension', () => {
    expect(panelClean).toContain('health.repository_attribution.remediation')
  })

  it('renders remediation for github_engineering_evidence dimension', () => {
    expect(panelClean).toContain('health.github_engineering_evidence.remediation')
  })

  it('renders remediation for auth_credentials dimension', () => {
    expect(panelClean).toContain('health.auth_credentials.remediation')
  })

  it('renders cost dimension card with state and remediation', () => {
    expect(panelClean).toContain('health.cost')
    expect(panelClean).toContain('health.cost.state')
    expect(panelClean).toContain('health.cost.remediation')
    expect(panelClean).toContain('Cost Configuration')
  })

  it('cost remediation does NOT render clickable URL when url is null', () => {
    // The cost remediation has url: null (PUT endpoint). The v-if on the
    // anchor must prevent rendering a broken link.
    expect(panelSource).toContain('v-if="health.cost.remediation.url"')
  })

  it('renders remediation for product pi dimension', () => {
    expect(panelClean).toContain('health.product.pi.remediation')
  })

  it('renders remediation for product pbt dimension', () => {
    expect(panelClean).toContain('health.product.pbt.remediation')
  })

  it('renders remediation for decision_intelligence dimension', () => {
    expect(panelClean).toContain('health.product.decision_intelligence.remediation')
  })

  it('remediation block includes action text', () => {
    expect(panelSource).toContain('ph-remediation-action')
  })

  it('remediation block includes url link (when url exists)', () => {
    expect(panelSource).toContain('ph-remediation-link')
    expect(panelSource).toContain('v-if=')
  })

  it('remediation block does NOT render internal runbook reference in customer copy', () => {
    // PILOT OPS 14-A: internal provenance/reference IDs (CANONICAL##, ONBOARDING##)
    // must never reach customer-visible Pilot Health output. The runbook_ref is
    // retained in the backend response + TypeScript type for internal diagnostics
    // only, and must not be rendered by the panel template.
    expect(panelSource).not.toContain('ph-remediation-runbook')
    expect(panelClean).not.toMatch(/runbook_ref/)
  })

  it('remediation is gated with v-if (only shown when present)', () => {
    // Every remediation block must be conditional
    const remediationBlocks = panelSource.match(/v-if="[^"]*\.remediation"/g)
    expect(remediationBlocks).toBeTruthy()
    expect(remediationBlocks!.length).toBeGreaterThanOrEqual(9)
  })
})

describe('PILOT OPS 14-A: internal provenance IDs never reach Pilot Health customer copy', () => {
  it('panel template does not render runbook_ref in any remediation block', () => {
    expect(panelClean).not.toMatch(/runbook_ref/)
    expect(panelSource).not.toContain('ph-remediation-runbook')
  })

  it('panel template does not interpolate any CANONICAL/ONBOARDING internal reference', () => {
    // The customer-facing template must contain no literal internal provenance
    // tokens and no binding that could surface them.
    expect(panelClean).not.toMatch(/CANONICAL/)
    expect(panelClean).not.toMatch(/ONBOARDING/)
  })

  it('backend retains runbook_ref internally for diagnostics (not removed)', () => {
    // The internal reference is preserved in the backend controller so support
    // diagnostics can still map a remediation to its runbook section; it is just
    // not rendered to customers.
    const controllerPath = resolve(__dirname, '../../../backend/app/Http/Controllers/PilotHealthController.php')
    const controllerSource = readFileSync(controllerPath, 'utf-8')
    expect(controllerSource).toContain('runbook_ref')
    expect(controllerSource).toContain('CANONICAL##')
    expect(controllerSource).toContain('ONBOARDING##')
  })

  it('TypeScript type still carries runbook_ref for internal diagnostics', () => {
    // The API type keeps the field so internal/diagnostic consumers can read it;
    // only the customer-facing panel stops rendering it.
    expect(apiSource).toContain('runbook_ref: string | null')
  })
})

describe('CR-X Day 1B S2: Remediation urls are browser-navigable GET URLs, not mutation endpoints', () => {
  it('urls use /settings, /api/extension/download, or /api/telemetry/canonical prefixes only', () => {
    const controllerPath = resolve(__dirname, '../../../backend/app/Http/Controllers/PilotHealthController.php')
    const controllerSource = readFileSync(controllerPath, 'utf-8')

    // Extract all url values from buildRemediation
    const urlMatches = controllerSource.matchAll(/'url'\s*=>\s*('([^']*)'|null)/g)
    const urls: string[] = []
    for (const match of urlMatches) {
      if (match[2] !== undefined) {
        urls.push(match[2])
      }
    }

    expect(urls.length).toBeGreaterThan(0)
    // Valid browser-navigable GET URLs only
    const validPrefixes = ['/settings', '/api/extension/download', '/api/telemetry/canonical']
    for (const url of urls) {
      const valid = validPrefixes.some(p => url.startsWith(p))
      expect(valid).toBe(true)
    }
  })

  it('cost remediation has url: null (PUT endpoint is not browser-navigable)', () => {
    const controllerPath = resolve(__dirname, '../../../backend/app/Http/Controllers/PilotHealthController.php')
    const controllerSource = readFileSync(controllerPath, 'utf-8')

    // Find the cost section in the remediations array
    const costSection = controllerSource.match(/'cost'\s*=>\s*\[([\s\S]*?)\],\s*'product_pi'/)
    expect(costSection).toBeTruthy()
    const costBlock = costSection![1]
    expect(costBlock).toContain("'url' => null")
    // Must NOT contain a raw /api/org/spend/config link as a url
    expect(costBlock).not.toContain("'url' => '/api/org/spend/config'")
  })

  it('no remediation references nonexistent product surfaces', () => {
    const controllerPath = resolve(__dirname, '../../../backend/app/Http/Controllers/PilotHealthController.php')
    const controllerSource = readFileSync(controllerPath, 'utf-8')

    // These are routes that do NOT exist and must never be referenced
    const forbiddenRoutes = [
      '/api/api-token/',
      '/api/user/settings',
      '/api/user/profile',
      '/billing',
      '/notifications',
      '/security',
      '/preferences',
    ]

    for (const forbidden of forbiddenRoutes) {
      expect(controllerSource).not.toContain(forbidden)
    }
  })
})

describe('CR-X Day 1B S2: Day 1A authority semantics preserved', () => {
  it('telemetry authority note still distinguishes raw vs canonical', () => {
    expect(panelSource).toContain('raw observed evidence')
    expect(panelSource).toContain('canonical product-analysis')
  })

  it('identity coverage says "Observed identities" for unresolved counts', () => {
    expect(panelSource).toContain('Observed identities')
    expect(panelSource).toContain('Use <em>identity</em> for counts that have not been authoritatively resolved to people')
  })

  it('identity coverage authority note still distinguishes telemetry vs roster', () => {
    expect(panelSource).toContain('Team page shows the curated roster of invite-backed developers')
  })
})
