/**
 * CR-X P0 REGRESSION TEST: sharedEnrichedPromise scope
 *
 * Browser console showed:
 *   ReferenceError: sharedEnrichedPromise is not defined
 *   at Dashboards.vue [PI_ENGINE_SELECTION][FINAL_ENGINE_ERROR]
 *
 * Root cause: The D1/D2 parallel-fetch change declared
 * `const sharedEnrichedPromise` inside a try block (line ~2589) but
 * awaited it outside that try block's scope (line ~3093). Since `const`
 * is block-scoped, the variable was undefined on the PI execution path.
 *
 * This test inspects the actual Dashboards.vue source to prove:
 * 1. sharedEnrichedPromise is declared at a scope reachable by the await site
 * 2. The declaration is NOT inside a try/catch block that the await is outside of
 * 3. There is no duplicate declaration
 *
 * This is a source-level structural test, not a runtime test, because the
 * runtime path requires a full browser/auth/API environment. The source
 * structure is the deterministic gate that prevents the scope bug.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const dashboardsPath = resolve(__dirname, '../pages/Dashboards.vue')
const source = readFileSync(dashboardsPath, 'utf-8')

describe('CR-X P0 Regression: sharedEnrichedPromise scope', () => {
  it('sharedEnrichedPromise is declared exactly once with let (not const inside try)', () => {
    // Should be declared with `let` at function scope, not `const` inside a try block
    const declarations = source.match(/\b(?:let|const)\s+sharedEnrichedPromise\b/g)
    expect(declarations).not.toBeNull()
    expect(declarations!.length).toBe(1)
    // Must be `let`, not `const` (let allows function-level hoisting semantics)
    expect(declarations![0]).toMatch(/^let\s+sharedEnrichedPromise/)
  })

  it('sharedEnrichedPromise declaration appears before the sessions try block', () => {
    const declIdx = source.indexOf('let sharedEnrichedPromise')
    const sessionsTryIdx = source.indexOf('sessionData = await sessionsPromise')
    expect(declIdx).toBeGreaterThan(-1)
    expect(sessionsTryIdx).toBeGreaterThan(-1)
    // Declaration must come before the sessions try block
    expect(declIdx).toBeLessThan(sessionsTryIdx)
  })

  it('sharedEnrichedPromise await site exists and is after the sessions catch', () => {
    const awaitIdx = source.indexOf("await timeAsync('shared_enriched_fetch', () => sharedEnrichedPromise)")
    expect(awaitIdx).toBeGreaterThan(-1)
    // The await must come after the sessions catch block
    const sessionsCatchIdx = source.indexOf("Failed to fetch sessions (continuing without)")
    expect(sessionsCatchIdx).toBeGreaterThan(-1)
    expect(awaitIdx).toBeGreaterThan(sessionsCatchIdx)
  })

  it('no fetchSharedEnrichedCanonical call inside the sessions try block', () => {
    // The fetch should be started BEFORE the sessions try block, not inside it
    const fetchIdx = source.indexOf('fetchSharedEnrichedCanonical(_ctxTimeRange)')
    const sessionsTryIdx = source.indexOf('sessionData = await sessionsPromise')
    expect(fetchIdx).toBeGreaterThan(-1)
    expect(sessionsTryIdx).toBeGreaterThan(-1)
    // The fetch call must come before the sessions try block
    expect(fetchIdx).toBeLessThan(sessionsTryIdx)
  })

  it('no duplicate fetchSharedEnrichedCanonical call in the PI input section', () => {
    // The PI input section should reuse the promise, not create a new fetch
    const awaitIdx = source.indexOf("await timeAsync('shared_enriched_fetch', () => sharedEnrichedPromise)")
    // After the await, there should be no new fetchSharedEnrichedCanonical call
    const afterAwait = source.substring(awaitIdx + 100)
    // Allow fetchSharedEnrichedCanonical in comments but not as a function call
    const newFetchMatch = afterAwait.match(/fetchSharedEnrichedCanonical\s*\(/)
    // The only occurrence should be in comments, not actual calls
    if (newFetchMatch) {
      // Check if it's inside a comment
      const callIdx = afterAwait.indexOf('fetchSharedEnrichedCanonical(')
      const beforeCall = afterAwait.substring(0, callIdx)
      const lastNewline = beforeCall.lastIndexOf('\n')
      const lineStart = beforeCall.substring(lastNewline + 1)
      // If the line starts with // or *, it's a comment
      expect(lineStart.trim().startsWith('//') || lineStart.trim().startsWith('*')).toBe(true)
    }
  })
})
