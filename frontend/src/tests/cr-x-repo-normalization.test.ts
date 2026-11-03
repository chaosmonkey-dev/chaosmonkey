/**
 * CR-X F: Repository normalization tests.
 *
 * Verifies that git repository URLs are normalized into canonical
 * owner/repo identities consistently across HTTPS, SSH, SCP, .git,
 * casing, and Azure DevOps variants.
 *
 * This is a query/adapter-level normalization — no DB migration required.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { normalizeRepoUrl, normalizeRepoList, repoLabel } from '../lib/repoNormalization'

describe('CR-X F: normalizeRepoUrl', () => {
  describe('HTTPS variants', () => {
    it('normalizes HTTPS URL', () => {
      expect(normalizeRepoUrl('https://github.com/owner/repo')).toBe('owner/repo')
    })

    it('normalizes HTTPS with .git suffix', () => {
      expect(normalizeRepoUrl('https://github.com/owner/repo.git')).toBe('owner/repo')
    })

    it('normalizes HTTPS with user prefix', () => {
      expect(normalizeRepoUrl('https://user@github.com/owner/repo.git')).toBe('owner/repo')
    })

    it('normalizes HTTPS with token prefix', () => {
      expect(normalizeRepoUrl('https://ghp_xxxxx@github.com/owner/repo.git')).toBe('owner/repo')
    })

    it('normalizes HTTPS with port', () => {
      expect(normalizeRepoUrl('https://github.com:443/owner/repo.git')).toBe('owner/repo')
    })
  })

  describe('SSH variants', () => {
    it('normalizes SSH URL', () => {
      expect(normalizeRepoUrl('git@github.com:owner/repo.git')).toBe('owner/repo')
    })

    it('normalizes SSH without .git', () => {
      expect(normalizeRepoUrl('git@github.com:owner/repo')).toBe('owner/repo')
    })

    it('normalizes SSH with custom host', () => {
      expect(normalizeRepoUrl('git@gitlab.com:owner/repo.git')).toBe('owner/repo')
    })
  })

  describe('SCP-style variants', () => {
    it('normalizes SCP-style URL', () => {
      expect(normalizeRepoUrl('github.com:owner/repo.git')).toBe('owner/repo')
    })
  })

  describe('Casing', () => {
    it('lowercases owner/repo', () => {
      expect(normalizeRepoUrl('https://github.com/Owner/Repo.git')).toBe('owner/repo')
    })

    it('lowercases SSH variant', () => {
      expect(normalizeRepoUrl('git@github.com:Owner/Repo.git')).toBe('owner/repo')
    })
  })

  describe('Azure DevOps', () => {
    it('normalizes Azure DevOps URL', () => {
      expect(normalizeRepoUrl('https://dev.azure.com/org/proj/_git/repo')).toBe('azure:org/repo')
    })

    it('normalizes Azure DevOps with user', () => {
      expect(normalizeRepoUrl('https://user@dev.azure.com/org/proj/_git/repo')).toBe('azure:org/repo')
    })

    // ED PRE-CONVERSION: /api/telemetry/repos returns backend-canonical
    // "azure:org/repo" identities. Re-normalizing one must pass it through
    // unchanged — the SCP-style pattern previously stripped the azure:
    // prefix, so a selected Azure repo filter could never match the backend's
    // canonical identity (0 sessions / "No workflow telemetry yet").
    it('passes through already-normalized azure: identity unchanged', () => {
      expect(normalizeRepoUrl('azure:prioritydispatchnet/arden-server')).toBe('azure:prioritydispatchnet/arden-server')
    })

    it('preserves Azure identity casing (backend does not lowercase)', () => {
      expect(normalizeRepoUrl('azure:IAEDEngineering/Automated%20Q')).toBe('azure:IAEDEngineering/Automated%20Q')
    })

    it('normalizeRepoList keeps azure: ids as dropdown values with display-clean labels', () => {
      const list = normalizeRepoList(['azure:prioritydispatchnet/arden-server'])
      // id stays canonical (join/filter authority); label strips the
      // internal source prefix for customer-facing display.
      expect(list).toEqual([{ id: 'azure:prioritydispatchnet/arden-server', label: 'prioritydispatchnet/arden-server' }])
    })
  })

  describe('Edge cases', () => {
    it('returns null for empty string', () => {
      expect(normalizeRepoUrl('')).toBeNull()
    })

    it('returns null for null', () => {
      expect(normalizeRepoUrl(null)).toBeNull()
    })

    it('returns null for undefined', () => {
      expect(normalizeRepoUrl(undefined)).toBeNull()
    })

    it('handles whitespace', () => {
      expect(normalizeRepoUrl('  https://github.com/owner/repo  ')).toBe('owner/repo')
    })
  })

  describe('Alias collapsing', () => {
    it('SSH and HTTPS produce same canonical identity', () => {
      const ssh = normalizeRepoUrl('git@github.com:owner/repo.git')
      const https = normalizeRepoUrl('https://github.com/owner/repo')
      expect(ssh).toBe(https)
    })

    it('with and without .git produce same canonical identity', () => {
      const withGit = normalizeRepoUrl('https://github.com/owner/repo.git')
      const withoutGit = normalizeRepoUrl('https://github.com/owner/repo')
      expect(withGit).toBe(withoutGit)
    })

    it('with and without user prefix produce same canonical identity', () => {
      const withUser = normalizeRepoUrl('https://user@github.com/owner/repo.git')
      const withoutUser = normalizeRepoUrl('https://github.com/owner/repo.git')
      expect(withUser).toBe(withoutUser)
    })

    it('casing variants produce same canonical identity', () => {
      const upper = normalizeRepoUrl('https://github.com/Owner/Repo.git')
      const lower = normalizeRepoUrl('https://github.com/owner/repo.git')
      expect(upper).toBe(lower)
    })
  })

  // CR-X P0: Already-canonical owner/repo strings from /api/telemetry/repos
  // must pass through normalizeRepoUrl so the PBT repo dropdown populates.
  // Without this, the dropdown is empty and repo filtering is impossible.
  describe('Already-canonical owner/repo passthrough', () => {
    it('passes through owner/repo without protocol', () => {
      expect(normalizeRepoUrl('mattmcclintock/angrymonkey')).toBe('mattmcclintock/angrymonkey')
    })

    it('passes through owner/repo with hyphen', () => {
      expect(normalizeRepoUrl('angrymonkeyparty/am-sim')).toBe('angrymonkeyparty/am-sim')
    })

    it('lowercases already-canonical form', () => {
      expect(normalizeRepoUrl('Owner/Repo')).toBe('owner/repo')
    })

    it('does not match three-segment paths', () => {
      expect(normalizeRepoUrl('team/owner/repo')).toBeNull()
    })

    it('does not match strings with spaces', () => {
      expect(normalizeRepoUrl('owner / repo')).toBeNull()
    })
  })
})

describe('CR-X F: normalizeRepoList', () => {
  it('deduplicates alias variants', () => {
    const rawRepos = [
      'git@github.com:owner/repo.git',
      'https://github.com/owner/repo',
      'https://user@github.com/owner/repo.git',
      'https://github.com/Owner/Repo.git',
    ]
    const result = normalizeRepoList(rawRepos)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('owner/repo')
  })

  it('preserves distinct repos', () => {
    const rawRepos = [
      'git@github.com:owner/repo1.git',
      'https://github.com/owner/repo2',
    ]
    const result = normalizeRepoList(rawRepos)
    expect(result.length).toBe(2)
  })

  it('sorts alphabetically', () => {
    const rawRepos = [
      'git@github.com:zzz/repo.git',
      'https://github.com/aaa/repo',
    ]
    const result = normalizeRepoList(rawRepos)
    expect(result[0].id).toBe('aaa/repo')
    expect(result[1].id).toBe('zzz/repo')
  })

  it('filters out null/empty entries', () => {
    const rawRepos = ['', null as any, 'https://github.com/owner/repo', undefined as any]
    const result = normalizeRepoList(rawRepos)
    expect(result.length).toBe(1)
  })

  it('produces {id, label} objects', () => {
    const result = normalizeRepoList(['https://github.com/owner/repo'])
    expect(result[0]).toHaveProperty('id')
    expect(result[0]).toHaveProperty('label')
  })

  // CR-X P0 REGRESSION: /api/telemetry/repos returns already-normalized
  // owner/repo strings. normalizeRepoList must not drop them.
  it('accepts already-normalized owner/repo strings from /api/telemetry/repos', () => {
    const apiRepos = [
      'angrymonkeyparty/am-sim',
      'mattmcclintock/angrymonkey',
      'mattmcclintock/cm-sim-20251219-1',
      'northstar/auth-service',
      'northstar/backend-api',
    ]
    const result = normalizeRepoList(apiRepos)
    expect(result.length).toBe(5)
    expect(result[0].id).toBe('angrymonkeyparty/am-sim')
    expect(result[1].id).toBe('mattmcclintock/angrymonkey')
  })
})

describe('CR-X F: repoLabel', () => {
  it('returns the canonical id as label', () => {
    expect(repoLabel('owner/repo')).toBe('owner/repo')
  })

  it('handles Azure DevOps format: strips internal azure: prefix for display', () => {
    expect(repoLabel('azure:org/repo')).toBe('org/repo')
  })
})

// ── CR-X P0: PBT repo filter → canonical URL propagation ──────────────
// Source-level regression test: proves that selecting a repo in the PBT
// dropdown causes the repo value to reach the canonical telemetry URL.
// Fails if:
//   - the dropdown visually changes but no repo reaches the API
//   - repo state is dropped in metricsFacade
//   - telemetryToUnified omits repos
//   - normalizeRepoList drops already-canonical strings (the original bug)
describe('CR-X P0: PBT repo filter → canonical URL propagation', () => {
  const pbtPath = resolve(__dirname, '../components/ProductivityByToolV3.vue')
  const pbtSource = readFileSync(pbtPath, 'utf-8')

  const adapterPath = resolve(__dirname, '../lib/adapters/telemetryToUnified.ts')
  const adapterSource = readFileSync(adapterPath, 'utf-8')

  const facadePath = resolve(__dirname, '../services/metricsFacade.ts')
  const facadeSource = readFileSync(facadePath, 'utf-8')

  const adaptivePath = resolve(__dirname, '../lib/productivity/fetchTelemetryWithAdaptiveGranularity.ts')
  const adaptiveSource = readFileSync(adaptivePath, 'utf-8')

  it('selectedRepo watch sets filterStore.setRepos with the repo id', () => {
    const watchBlock = pbtSource.match(/watch\(selectedRepo[^)]*\)[\s\S]*?setRepos\('productivity'[^)]*\)/)
    expect(watchBlock).not.toBeNull()
    expect(watchBlock![0]).toContain('newValue')
  })

  it('productivityQuery includes repos from analysisContext.repoIds (S3 convergence)', () => {
    // CR-X Day 1B S3: PBT now reads repos from shared analysisContext, not filterStore
    const queryBlock = pbtSource.match(/repos:\s*analysisContext\.repoIds/)
    expect(queryBlock).not.toBeNull()
  })

  it('fetchTelemetryWithAdaptiveGranularity destructures repos from query', () => {
    const destructure = adaptiveSource.match(/const\s*\{\s*[^}]*repos[^}]*\}\s*=\s*query/)
    expect(destructure).not.toBeNull()
  })

  it('fetchTelemetryWithAdaptiveGranularity passes repos to fetcher', () => {
    const fetcherCall = adaptiveSource.match(/fetcher\([^)]*repos[^)]*\)/)
    expect(fetcherCall).not.toBeNull()
  })

  it('metricsFacade fetcher passes repos to fetchAndMapTelemetryToUnified', () => {
    const fetcherBlock = facadeSource.match(/async\s*\([^)]*repos[^)]*\)\s*=>\s*{[\s\S]*?fetchAndMapTelemetryToUnified\([^)]*repos[^)]*\)/)
    expect(fetcherBlock).not.toBeNull()
  })

  it('fetchCanonicalTelemetry sets repos= URL param when repos provided', () => {
    const reposParam = adapterSource.match(/url\.searchParams\.set\('repos'[^)]*\)/)
    expect(reposParam).not.toBeNull()
  })

  it('normalizeRepoList does not drop already-canonical owner/repo strings', () => {
    // This was the root cause: /api/telemetry/repos returns 'owner/repo'
    // strings, but normalizeRepoUrl only matched URL patterns and returned
    // null for bare owner/repo, making the dropdown empty.
    const result = normalizeRepoList(['mattmcclintock/angrymonkey'])
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('mattmcclintock/angrymonkey')
  })
})
