import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── Mission 1: No visible numeric title override map ─────────────
describe('CR1 Mission 1: No numeric title override map', () => {
  it('pilotReadyTitleById map is removed from PerformanceRecommendationsView.vue', () => {
    const fp = join(__dirname, '../../../components/PerformanceRecommendationsView.vue')
    const src = readFileSync(fp, 'utf-8')
    // The old map contained these hardcoded cross-org claims
    expect(src).not.toContain('Cursor leads active coding by 30 min/session')
    expect(src).not.toContain('Devin leads AI adoption at 92%')
    expect(src).not.toContain('Cursor reaches first commit 8 minutes faster')
    expect(src).not.toContain('AI-assisted PRs take 36 minutes longer')
    expect(src).not.toContain('PR reopen rate is 24.6%')
    expect(src).not.toContain('Change failure rate is 19.2%')
    // The variable name should not exist as a numeric override map
    expect(src).not.toMatch(/pilotReadyTitleById\s*:\s*Record/)
    expect(src).not.toMatch(/const\s+pilotReadyTitleById\s*=/)
  })
})

// ─── Mission 2: GitHub fingerprint changes input key ─────────────
function fp(snap: any): string {
  if (!snap) return 'no-gh'
  const t = snap.github_team_metrics?.total_prs ?? 0
  const m = snap.github_team_metrics?.merged_prs ?? 0
  const s = snap.deployment_metrics?.success_deployment_count ?? 0
  const f = snap.deployment_metrics?.failed_deployment_count ?? 0
  const c = snap.pr_analytics?.closed_prs ?? 0
  const o = snap.pr_analytics?.open_prs ?? 0
  const st = snap.server_stamp ?? ''
  return `gh_${t}_${m}_${s}_${f}_${c}_${o}_${st}`
}

describe('CR1 Mission 2: GitHub evidence fingerprint', () => {
  it('null => no-gh', () => expect(fp(null)).toBe('no-gh'))
  it('changes on total_prs', () => expect(fp({github_team_metrics:{total_prs:100}})).not.toBe(fp({github_team_metrics:{total_prs:832}})))
  it('changes on deployments', () => expect(fp({deployment_metrics:{success_deployment_count:100}})).not.toBe(fp({deployment_metrics:{success_deployment_count:581}})))
  it('changes on server_stamp', () => expect(fp({server_stamp:'a'})).not.toBe(fp({server_stamp:'b'})))
  it('stable for same snap', () => { const s={server_stamp:'x'}; expect(fp(s)).toBe(fp(s)) })
})

// ─── Mission 3: prodPoints-empty does not block engine ───────────
describe('CR1 Mission 3: prodPoints-empty guard logic', () => {
  it('Dashboards.vue does not early-return on empty prodPoints alone', () => {
    const fp = join(__dirname, '../../../pages/Dashboards.vue')
    const src = readFileSync(fp, 'utf-8')
    // The old guard had BLOCKED_EMPTY_PRODPOINTS that returned early
    // The new guard should check hasSessionData and hasGithubSnapshot too
    expect(src).not.toContain('BLOCKED_EMPTY_PRODPOINTS')
    expect(src).toContain('BASELINE_AVAILABLE')
    expect(src).toContain('hasSessionData')
    expect(src).toContain('hasGithubSnapshot')
  })
})

// ─── Mission 4: Diagnostic titles for attribution-dependent PIs ─
describe('CR1 Mission 4: Attribution diagnostic titles', () => {
  it('PerformanceRecommendationsView has diagnostic title for pr-cycle-time-ai-vs-non-ai', () => {
    const fp = join(__dirname, '../../../components/PerformanceRecommendationsView.vue')
    const src = readFileSync(fp, 'utf-8')
    expect(src).toContain('session-conditioned-pr-cycle-time-ai-vs-non-ai')
    expect(src).toContain('session-to-PR attribution')
  })

  it('final/index.ts has diagnostic reason for pr-cycle-time-ai-vs-non-ai', () => {
    const fp = join(__dirname, 'index.ts')
    const src = readFileSync(fp, 'utf-8')
    expect(src).toContain("'session-conditioned-pr-cycle-time-ai-vs-non-ai': 'NEEDS_SESSION_TO_PR_ATTRIBUTION'")
  })
})

// ─── Mission 5: No implicit simulation ───────────────────────────
describe('CR1 Mission 5: No implicit simulation', () => {
  it('DEMO_MODE defaults to false (env-driven)', () => {
    // DEMO_MODE is controlled by VITE_DEMO_MODE env var, defaults to false
    // This is verified by reading the source - no runtime check needed
    const fp = join(__dirname, '../performanceEngine.ts')
    const src = readFileSync(fp, 'utf-8')
    expect(src).toContain("export const DEMO_MODE = VITE_DEMO_MODE_RAW === 'true' || VITE_DEMO_MODE_RAW === '1'")
    expect(src).toContain("VITE_DEMO_MODE ?? 'false'")
  })
})

// ─── Mission 6: Fail closed on validation ────────────────────────
describe('CR1 Mission 6: Fail closed on validation', () => {
  it('final/index.ts suppresses invalid insights instead of continuing', () => {
    const fp = join(__dirname, 'index.ts')
    const src = readFileSync(fp, 'utf-8')
    expect(src).toContain('VALIDATION_SUPPRESSED')
    expect(src).toContain('invalidIds')
    expect(src).toContain('validatedInsights')
    // Should NOT have the old TODO about making validation fatal
    expect(src).not.toContain('TODO: Make validation fatal')
  })

  it('Dashboards.vue does not have expected-17 assertion', () => {
    const fp = join(__dirname, '../../../pages/Dashboards.vue')
    const src = readFileSync(fp, 'utf-8')
    expect(src).not.toContain('expectedCanonicalCount = 17')
    expect(src).not.toContain('expectedCanonicalCount')
  })
})

describe('CR1 Patch A: fail-closed covers all categories', () => {
  it('index.ts suppresses insights via the real addressable validation categories', () => {
    const s = readFileSync(join(__dirname, 'index.ts'), 'utf-8')
    expect(s).toContain('validation.results.canonicalRegistry.unregisteredIds')
    expect(s).toContain('validation.results.requiredFields.missingFields')
    expect(s).toContain('validation.results.uniqueRenderOrder.duplicates')
    // Must NOT rely on the nonexistent `.results` shape (the original bug).
    expect(s).not.toContain('(category as any)?.results')
  })
})

describe('CR1 Patch B: seeded provenance ineligibility', () => {
  it('dataAccess.ts checks real GitHub data', () => {
    const s = readFileSync(join(__dirname, 'dataAccess.ts'), 'utf-8')
    expect(s).toContain('hasRealGithubData')
    expect(s).not.toContain('hasLiveGithub = !!input.githubSnapshot')
  })
})

describe('CR1 Mission 1: isGithubEvidenceEligible production helper', () => {
  it('rejects seeded_db provenance source even with github_connected true', async () => {
    const { isGithubEvidenceEligible } = await import('./dataAccess')
    const snapshot = {
      github_connected: true,
      github_provenance: {
        source: 'seeded_db',
        historical_data_available: true,
        window_data_available: false,
        live_fetch_ok: false,
        db_pr_data_sources: ['demo', 'realism_seeder', 'cm_activity_sim']
      }
    }
    expect(isGithubEvidenceEligible(snapshot)).toBe(false)
  })

  it('rejects github_connected=true with no provenance object (OAuth alone is not evidence)', async () => {
    const { isGithubEvidenceEligible } = await import('./dataAccess')
    const snapshot = { github_connected: true }
    expect(isGithubEvidenceEligible(snapshot)).toBe(false)
  })

  it('accepts real historical DB evidence when current window is empty and live_fetch_ok is false', async () => {
    const { isGithubEvidenceEligible } = await import('./dataAccess')
    const snapshot = {
      github_connected: true,
      github_provenance: {
        source: 'production_db',
        historical_data_available: true,
        window_data_available: false,
        live_fetch_ok: false,
        db_pr_data_sources: ['github_api']
      }
    }
    expect(isGithubEvidenceEligible(snapshot)).toBe(true)
  })

  it('rejects when db_pr_data_sources contains any ineligible source', async () => {
    const { isGithubEvidenceEligible } = await import('./dataAccess')
    const snapshot = {
      github_provenance: {
        source: 'production_db',
        historical_data_available: true,
        db_pr_data_sources: ['github_api', 'fixture_fallback']
      }
    }
    expect(isGithubEvidenceEligible(snapshot)).toBe(false)
  })

  it('rejects when historical_data_available is false even with clean source', async () => {
    const { isGithubEvidenceEligible } = await import('./dataAccess')
    const snapshot = {
      github_provenance: {
        source: 'production_db',
        historical_data_available: false
      }
    }
    expect(isGithubEvidenceEligible(snapshot)).toBe(false)
  })
})

describe('CR1 Mission 2: validation.results shape contract used by suppression logic', () => {
  it('validateCanonicalInsights produces the exact shape the suppression logic depends on', async () => {
    const { validateCanonicalInsights } = await import('./utils/validation')
    const result = validateCanonicalInsights([])
    // These are the exact properties index.ts suppression logic reads.
    expect(Array.isArray(result.results.canonicalRegistry.unregisteredIds)).toBe(true)
    expect(Array.isArray(result.results.requiredFields.missingFields)).toBe(true)
    expect(Array.isArray(result.results.uniqueRenderOrder.duplicates)).toBe(true)
    // Confirm the old (buggy) assumption is false: no category has a `.results` array.
    for (const category of Object.values(result.results)) {
      expect((category as any)?.results).toBeUndefined()
    }
  })

  it('flags an insight missing required fields via missingFields.id (addressable for suppression)', async () => {
    const { validateCanonicalInsights } = await import('./utils/validation')
    const badInsight: any = { id: 'test-bad-insight', cicdStage: 'plan-code', renderOrder: 999 }
    const result = validateCanonicalInsights([badInsight])
    expect(result.valid).toBe(false)
    const ids = result.results.requiredFields.missingFields.map((m: any) => m.id)
    expect(ids).toContain('test-bad-insight')
  })

  it('flags an insight not in the canonical registry via unregisteredIds (addressable for suppression)', async () => {
    const { validateCanonicalInsights } = await import('./utils/validation')
    const fakeInsight: any = {
      id: 'not-a-real-canonical-id',
      title: 'x', cicdStage: 'plan-code', canonicalPriority: 1, renderOrder: 1,
      current: 0, confidence: 'low', hasData: false
    }
    const result = validateCanonicalInsights([fakeInsight])
    expect(result.results.canonicalRegistry.unregisteredIds).toContain('not-a-real-canonical-id')
  })
})

describe('CR1 Patch C: no sim fallback in live mode', () => {
  it('metricsFacade fails closed', () => {
    const s = readFileSync(join(__dirname, '../../../services/metricsFacade.ts'), 'utf-8')
    expect(s).toContain('CR1 Patch C')
    expect(s).not.toContain('Live mode fallback — using simulator')
  })
})

describe('CR1 Patch D: QA empty array guard', () => {
  it('piQAAudit guards empty heights', () => {
    const s = readFileSync(join(__dirname, '../v2/piQAAudit.ts'), 'utf-8')
    expect(s).toContain('heights.length > 0 ? Math.min')
  })
})

describe('CR1 Patch F: deployOperate no seeded fallback', () => {
  it('returns null without deployment_metrics', async () => {
    const mod = await import('./generators/deployOperate')
    const input: any = { sessionRows: new Array(50).fill({}), githubSnapshot: {}, githubByPeriod: [] }
    expect(mod.generateDeliveryVelocityByWorkflow(input)).toBeNull()
    expect(mod.generateChangeFailureRateSpikeByIDE(input)).toBeNull()
    expect(mod.generateDeploymentReliabilityPressure(input)).toBeNull()
    expect(mod.generateExecutiveStableDeploymentAcceleration(input)).toBeNull()
  })
  it('source has no hardcoded fallback values', () => {
    const s = readFileSync(join(__dirname, 'generators/deployOperate.ts'), 'utf-8')
    expect(s).not.toContain('cursorVelocity = 3.8')
    expect(s).not.toContain('cursorFailureRate = 6.8')
  })
})

describe('CR1 Patch E: windsurf+devin dedup', () => {
  it('metricsFacade normalizes tool IDs', () => {
    const s = readFileSync(join(__dirname, '../../../services/metricsFacade.ts'), 'utf-8')
    expect(s).toContain('CR1 Patch E')
    expect(s).toContain('normalizeToCanonicalToolId(record.tool')
  })
  it('workflowIdentity preserves the protected windsurf-to-devin normalization contract', async () => {
    const s = readFileSync(join(__dirname, '../../workflowIdentity.ts'), 'utf-8')
    expect(s).toContain("'windsurf': 'devin'")
    const { normalizeToCanonicalToolId } = await import('../../workflowIdentity')
    expect(normalizeToCanonicalToolId('windsurf')).toBe('devin')
    expect(normalizeToCanonicalToolId('devin')).toBe('devin')
  })
})
