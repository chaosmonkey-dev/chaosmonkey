/**
 * ED PRE-CONVERSION ACCEPTANCE (2026-09-25)
 *
 * Surgical regression coverage for the customer-facing defects found on the
 * Priority Dispatch pilot ahead of the paid-conversion call:
 *
 *  1. Developer selectors must exclude known operator/support enrollments
 *     (display-layer only — telemetry and invites remain untouched).
 *  2. "WoW" trend must only render on weekly-bucketed canonical data —
 *     the adaptive-granularity path serves daily buckets for ≤90-day
 *     windows, and comparing two adjacent days produced a false "+500% WoW".
 *  3. The card context label must not call populated DAILY buckets "weeks"
 *     (the "Average (last 56 weeks)" defect on a ~12-week-old pilot).
 *  4. Missing-data/diagnostic insights must never carry HIGH impact.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { isOperatorEnrollmentEmail, isOperatorOnlyRepoIdentity } from '../lib/operatorIdentities'
import { expandBucketAxis, buildProductivityLineGraphData } from '../lib/productivity/lineGraphChartData'

const pbtSource = fs.readFileSync(
  path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
  'utf-8'
)
const settingsSource = fs.readFileSync(
  path.resolve(__dirname, '../pages/Settings.vue'),
  'utf-8'
)
const recsSource = fs.readFileSync(
  path.resolve(__dirname, '../components/PerformanceRecommendationsView.vue'),
  'utf-8'
)
const execSynthSource = fs.readFileSync(
  path.resolve(__dirname, '../lib/insights/final/generators/executiveSynthesis.ts'),
  'utf-8'
)
const dashboardsSource = fs.readFileSync(
  path.resolve(__dirname, '../pages/Dashboards.vue'),
  'utf-8'
)

describe('ED acceptance: operator enrollment exclusion', () => {
  it('flags the known operator emails', () => {
    expect(isOperatorEnrollmentEmail('mattrmclaren@gmail.com')).toBe(true)
    expect(isOperatorEnrollmentEmail('mcclintockmatthieu@gmail.com')).toBe(true)
    expect(isOperatorEnrollmentEmail('  MATTRMCLAREN@gmail.com ')).toBe(true)
  })

  it('never flags customer emails or empty input', () => {
    expect(isOperatorEnrollmentEmail('ed.st.louis@prioritydispatch.net')).toBe(false)
    expect(isOperatorEnrollmentEmail('rob.patterson@prioritydispatch.net')).toBe(false)
    expect(isOperatorEnrollmentEmail(null)).toBe(false)
    expect(isOperatorEnrollmentEmail(undefined)).toBe(false)
    expect(isOperatorEnrollmentEmail('')).toBe(false)
  })

  it('PBT developer fetch filters operator invite entries', () => {
    expect(pbtSource).toContain('isOperatorEnrollmentEmail')
    expect(pbtSource).toMatch(/dev\.source === 'invite' && isOperatorEnrollmentEmail\(dev\.label\)/)
  })

  it('Settings team view filters operator pending enrollments', () => {
    expect(settingsSource).toContain('isOperatorEnrollmentEmail')
    expect(settingsSource).toContain('isOperatorEnrollment')
    expect(settingsSource).toMatch(/!isBlankPendingInvite\(m\) && !isOperatorEnrollment\(m\)/)
  })

  it('Settings hides null-email pending invites (anonymous enrollments)', () => {
    expect(settingsSource).toContain("'pending invitation'")
  })
})

describe('ED acceptance: WoW trend only on weekly buckets', () => {
  it('getTrendData requires canonical weekly granularity', () => {
    // The gate must exist inside getTrendData so daily-bucketed series can
    // never produce a week-over-week claim.
    const fn = pbtSource.slice(pbtSource.indexOf('function getTrendData'))
    expect(fn).toContain("canonicalMetadata.value?.period !== 'week'")
    // Complete-week comparison (partial week excluded) replaces the raw
    // last-two-points comparison.
    expect(fn).toContain('compareCompleteWeeks')
  })

  it('completeWeekComparison is gated to weekly granularity', () => {
    const idx = pbtSource.indexOf('const completeWeekComparison')
    const block = pbtSource.slice(idx, idx + 900)
    expect(block).toContain("canonicalMetadata.value?.period !== 'week'")
    expect(block).toContain('hasEnoughData: false')
  })
})

describe('ED acceptance: truthful card window label', () => {
  it('does not label daily buckets as weeks', () => {
    // The old unconditional `last ${sparklineData.length} weeks` must be gone.
    expect(pbtSource).not.toContain('`Average (last ${sparklineData.length} weeks)`')
    expect(pbtSource).toContain('observedSpanDays')
    expect(pbtSource).toContain("canonicalMetadata.value?.period === 'day'")
  })
})

describe('ED acceptance: diagnostics are not HIGH-impact risks', () => {
  it('getImpactLevel returns Low for diagnostic/no-data insights', () => {
    const fn = recsSource.slice(recsSource.indexOf('function getImpactLevel'))
    const guardIdx = fn.indexOf("isDiagnostic === true || insight.hasData === false")
    const bucketIdx = fn.indexOf('intendedBucket === 2')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(bucketIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(bucketIdx)
  })
})

describe('ED acceptance: workflow-mix volume is window-normalized', () => {
  it('normalizes session volume to sessions/week for unequal windows', () => {
    expect(execSynthSource).toContain('priorWeeks')
    expect(execSynthSource).toContain('recentPerWeek')
    expect(execSynthSource).toContain('sessions/week (window-normalized)')
  })
})

describe('ED acceptance: operator-only repo exclusion', () => {
  it('flags the proven operator-only repo identity', () => {
    // All 11 events / 5 sessions for mattmcclintock/angrymonkey are
    // attributed to invite:29 / invite:32 (verified org-2 telemetry).
    expect(isOperatorOnlyRepoIdentity('mattmcclintock/angrymonkey')).toBe(true)
    expect(isOperatorOnlyRepoIdentity('MattMcClintock/AngryMonkey')).toBe(true)
  })

  it('retains ambiguous and customer repo identities', () => {
    expect(isOperatorOnlyRepoIdentity('prioritydispatchnet/arden-server')).toBe(false)
    expect(isOperatorOnlyRepoIdentity('azure:prioritydispatchnet/arden-server')).toBe(false)
    expect(isOperatorOnlyRepoIdentity('fn-bruce/dotfiles')).toBe(false)
    expect(isOperatorOnlyRepoIdentity('synopse/mORMot')).toBe(false)
    expect(isOperatorOnlyRepoIdentity(null)).toBe(false)
  })

  it('PBT repo fetch filters operator-only identities after normalization', () => {
    expect(pbtSource).toContain('isOperatorOnlyRepoIdentity')
    expect(pbtSource).toMatch(/normalizeRepoList\(allRepos\)[\s\S]{0,200}isOperatorOnlyRepoIdentity/)
  })
})

describe('ED acceptance: GitHub badge communicates access-required', () => {
  it('CONNECTED_NO_ELIGIBLE_DATA renders Access Required, never No Data', () => {
    expect(dashboardsSource).toContain('GitHub: Connected · Access Required')
    expect(dashboardsSource).not.toContain('GitHub: Connected · No Data')
    expect(dashboardsSource).toContain('Repository access is required')
  })
})

describe('ED acceptance: loading is not empty-state', () => {
  it('PBT context label gates "Waiting for first telemetry" on load completion', () => {
    const idx = pbtSource.indexOf('const contextWindowLabel')
    const block = pbtSource.slice(idx, idx + 700)
    expect(block).toContain('pbtHeaderLoading')
    expect(block).toContain('Loading telemetry…')
    expect(block).toContain('Waiting for first telemetry')
    // Loading check must precede the zero-session check.
    expect(block.indexOf('pbtHeaderLoading')).toBeLessThan(block.indexOf("'Waiting for first telemetry'"))
  })

  it('Dashboard status phrase gates on canonicalHydrating', () => {
    const idx = dashboardsSource.indexOf('const telemetryStatusPhrase')
    const block = dashboardsSource.slice(idx, idx + 400)
    expect(block).toContain('canonicalHydrating')
    expect(block).toContain('Loading telemetry…')
    expect(block.indexOf('canonicalHydrating')).toBeLessThan(block.indexOf("'Waiting for first telemetry'"))
  })
})

describe('ED acceptance: sparse series renders temporal gaps', () => {
  it('expandBucketAxis inserts unobserved day positions as axis slots', () => {
    const expanded = expandBucketAxis(['2026-09-14', '2026-09-15', '2026-09-22'], 'day')
    expect(expanded).toContain('2026-09-16')
    expect(expanded).toContain('2026-09-21')
    expect(expanded.length).toBe(9) // Sep 14..22 inclusive
    expect(expanded[0]).toBe('2026-09-14')
    expect(expanded[expanded.length - 1]).toBe('2026-09-22')
  })

  it('expansion never fabricates observed values — inserted slots become null', () => {
    const out = buildProductivityLineGraphData({
      lineGraphData: [{
        label: 'vscode',
        data: [
          { x: '2026-09-15', y: 42 },
          { x: '2026-09-22', y: 55 },
        ],
      }],
      timeFilter: 'all',
      selectedMetric: 'session_minutes',
      comparisonMode: '',
      bucketPeriod: 'day',
    })
    const ds = out.datasets[0] as any
    expect(ds.data.filter((v: any) => v === null).length).toBe(6) // Sep 16-21
    expect(ds.data.filter((v: any) => v === 0).length).toBe(0) // missing != zero
    expect(ds.spanGaps).toBe(false)
    expect(out.labels.length).toBe(8)
  })

  it('weekly buckets expand at 7-day stride; unknown periods are untouched', () => {
    const weekly = expandBucketAxis(['2026-09-01', '2026-09-15'], 'week')
    expect(weekly).toContain('2026-09-08')
    const unknown = expandBucketAxis(['2026-09-01', '2026-09-15'], 'month')
    expect(unknown).toEqual(['2026-09-01', '2026-09-15'])
  })

  it('dense series are unchanged (no positions inserted)', () => {
    const dense = expandBucketAxis(['2026-09-14', '2026-09-15', '2026-09-16'], 'day')
    expect(dense.length).toBe(3)
  })
})

describe('ED acceptance: insufficient-comparison cards are not HIGH', () => {
  it('effectiveImpact forces LOW when workflow comparison lacks evidence', () => {
    expect(recsSource).toContain('effectiveImpact')
    expect(recsSource).toMatch(/!workflowComparison\.hasEnoughComparisonData[\s\S]{0,200}\? 'LOW'/)
    // The card-level impact field consumes effectiveImpact.
    expect(recsSource).toContain('impact: effectiveImpact')
  })
})
