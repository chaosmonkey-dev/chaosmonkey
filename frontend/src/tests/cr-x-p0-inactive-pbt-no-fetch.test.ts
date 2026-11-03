import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

/**
 * CR-X P0 — Inactive PBT does not fetch canonical telemetry while PI is active.
 *
 * The PI background prodTs fetch (metricsFacade.getProductivityTimeSeries) was
 * firing a canonical aggregated request during the PI cold load, competing with
 * session pagination on the single-threaded PHP server. This test verifies
 * that the background prodTs fetch has been removed from the PI cold load path.
 */
describe('CR-X P0: Inactive PBT does not fetch while PI is active', () => {
  it('Dashboards.vue does not fire getProductivityTimeSeries during PI cold load', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../pages/Dashboards.vue', import.meta.url)),
      'utf-8'
    )

    // The background prodTs fetch pattern must NOT be present in the PI
    // cold load path. Look for the specific pattern that was removed.
    const prodTsPattern = /metricsFacade\.getProductivityTimeSeries\s*\(\s*\{\s*\.\.\.baseQuery/
    expect(prodTsPattern.test(source)).toBe(false)

    // The fire-and-forget pattern that populated prodSeries from the
    // background fetch must also NOT be present.
    const fireAndForgetPattern = /realProdTsPromise/
    expect(fireAndForgetPattern.test(source)).toBe(false)
  })

  it('ProductivityByToolV3 is gated by pbtEverVisited (lazy mount)', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../pages/Dashboards.vue', import.meta.url)),
      'utf-8'
    )

    // pbtEverVisited must be defined as a ref
    expect(source).toContain('pbtEverVisited')

    // The v-if gate must use pbtEverVisited
    expect(source).toMatch(/v-if="pbtEverVisited"/)

    // pbtEverVisited/pbtActive initialize from the setup-time entry surface
    // (17G.8), so a #productivity cold start is PBT-active before any
    // lifecycle hook, watcher, or scheduler can run.
    expect(source).toMatch(/pbtEverVisited\s*=\s*ref\(initialPbtEntry\)/)
    expect(source).toMatch(/pbtActive\s*=\s*ref\(initialPbtEntry\)/)
    expect(source).toMatch(/initialPbtSurface[\s\S]*route\.hash\s*===\s*'#productivity'/)

    // pbtEverVisited is also set to true when the user clicks the PBT tab
    expect(source).toMatch(/targetPane\s*===\s*'#productivity'\s*&&\s*!pbtEverVisited\.value/)
  })

  it('17G.8: #productivity initial state suppresses PI startup', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../pages/Dashboards.vue', import.meta.url)),
      'utf-8'
    )

    // Setup-time surface resolution must read window.location.hash and
    // recover the stashed entry hash dropped by the /login redirect.
    expect(source).toMatch(
      /const initialPbtEntry = \(\(\) => \{[\s\S]*?window\.location\.hash[\s\S]*?cm_entry_surface_hash/
    )

    // The resolution must be declared before the onMounted initial-mount
    // schedule, so pbtActive is already true when it runs.
    const initIdx = source.indexOf('const initialPbtEntry')
    const schedIdx = source.indexOf("scheduleRefreshPI('initial-mount')")
    expect(initIdx).toBeGreaterThan(-1)
    expect(schedIdx).toBeGreaterThan(-1)
    expect(initIdx).toBeLessThan(schedIdx)

    // The template must not hard-code PI as the active surface; both panes
    // bind to pbtActive so there is no transient default-to-PI state.
    expect(source).not.toMatch(/class="tab-pane fade show active"\s+id="insights"/)
    expect(source).toMatch(/:class="\{ show: pbtActive, active: pbtActive \}"[\s\S]*?id="productivity"/)
    expect(source).toMatch(/:class="\{ show: !pbtActive, active: !pbtActive \}"[\s\S]*?id="insights"/)

    // The scheduler still skips non-forced work while PBT is active.
    expect(source).toMatch(/if \(!force && pbtActive\.value\)/)
    expect(source).toContain("decision: 'skipped-pbt-active'")

    // [DASH_PI][STARTUP_DECISION] still records window.location.hash.
    expect(source).toMatch(/windowHash:\s*window\.location\.hash/)
  })

  it('17G.8: normal PI initial state still schedules PI', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../pages/Dashboards.vue', import.meta.url)),
      'utf-8'
    )

    // initialPbtEntry only returns true for '#productivity' (direct hash or
    // restored stash); every other entry leaves pbtActive=false so the
    // initial-mount schedule still reaches the 'scheduled' decision.
    expect(source).toMatch(/if \(h === '#productivity'\) return true/)
    expect(source).toMatch(/sessionStorage\.getItem\('cm_entry_surface_hash'\) === '#productivity'/)
    expect(source).toContain("decision: 'scheduled'")
    expect(source).toMatch(/refreshPI\(`scheduled:\$\{reason\}`\)/)
  })

  it('17G.8: entry surface hash is stashed before the router initial navigation', () => {
    const mainSrc = readFileSync(
      fileURLToPath(new URL('../main.ts', import.meta.url)),
      'utf-8'
    )

    // app.use(router) fires vue-router's initial navigation, which can
    // redirect /dashboards → /login and drop the hash before the dev-auth
    // token lands. The stash must be captured before that call (comments
    // may mention it earlier, so search after the stash index).
    const stashIdx = mainSrc.indexOf("sessionStorage.setItem('cm_entry_surface_hash'")
    const routerIdx = mainSrc.indexOf('app.use(router)', stashIdx)
    expect(stashIdx).toBeGreaterThan(-1)
    expect(routerIdx).toBeGreaterThan(stashIdx)
  })

  it('PI cold load path does not contain useTimeSeries or fetchAndMapTelemetryToUnified calls', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../pages/Dashboards.vue', import.meta.url)),
      'utf-8'
    )

    // The PI cold load path (refreshPI function) should NOT directly call
    // useTimeSeries or fetchAndMapTelemetryToUnified. These are PBT/legacy
    // paths that hit the canonical aggregated endpoint and compete with
    // session pagination on the single-threaded PHP server.
    //
    // Note: getProductivitySummary calls fetchAndMapTelemetryToUnified
    // internally, but it's awaited BEFORE session pagination starts
    // (sequential, not concurrent), so it doesn't cause contention.

    // Find the refreshPI function
    const refreshPIStart = source.indexOf('async function refreshPI')
    expect(refreshPIStart).toBeGreaterThan(-1)

    // Find the session fetch start (sessionsPromise)
    const sessionsPromiseLine = source.indexOf('sessionsPromise', refreshPIStart)
    expect(sessionsPromiseLine).toBeGreaterThan(refreshPIStart)

    // The code BEFORE sessionsPromise should NOT contain
    // getProductivityTimeSeries (the background prodTs fetch)
    const preSessionCode = source.substring(refreshPIStart, sessionsPromiseLine)
    expect(preSessionCode).not.toContain('getProductivityTimeSeries')
    expect(preSessionCode).not.toContain('realProdTsPromise')
  })
})
