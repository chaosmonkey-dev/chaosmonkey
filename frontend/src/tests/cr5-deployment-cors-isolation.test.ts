/**
 * Phase 0.6 regression: CORS source must not contain customer-specific
 * production origin fallbacks (Ryan/Ed/Staging/Kasey IPs).
 *
 * Verifies that backend/app/Http/Middleware/Cors.php has zero hardcoded
 * prior-pilot IP addresses in its allowedOrigins() fallback list.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('Phase 0.6 — CORS customer-neutral source', () => {
  it('Cors.php contains no customer-specific production IP fallbacks', () => {
    const corsPath = resolve(__dirname, '../../../backend/app/Http/Middleware/Cors.php')
    const source = readFileSync(corsPath, 'utf-8')

    const pilotIPs = [
      '18.225.216.252', // Ryan
      '18.220.128.31',  // Staging
      '52.15.236.225',  // Ed
      '52.15.220.143',  // Ed alt
      '3.15.44.219',    // Kasey
    ]

    for (const ip of pilotIPs) {
      expect(source).not.toContain(ip)
    }
  })

  it('Cors.php allowedOrigins() fallback list only uses env/config sources', () => {
    const corsPath = resolve(__dirname, '../../../backend/app/Http/Middleware/Cors.php')
    const source = readFileSync(corsPath, 'utf-8')

    // The foreach loop in allowedOrigins() should only reference env() calls
    // and NOT contain any hardcoded URL literals (other than the env fallbacks
    // in config/cors.php which are localhost dev origins).
    const allowedOriginsBlock = source.match(/foreach\s*\(\s*\[([\s\S]*?)\]\s*as\s*\$value/s)
    expect(allowedOriginsBlock).not.toBeNull()

    const blockContent = allowedOriginsBlock![1]
    // Should not contain any http:// literal that is NOT env() or localhost
    const httpLiterals = blockContent.match(/'https?:\/\/[^']+'/g) || []
    for (const literal of httpLiterals) {
      // Only localhost/127.0.0.1 dev origins are acceptable
      expect(literal).toMatch(/localhost|127\.0\.0\.1/)
    }
  })
})
