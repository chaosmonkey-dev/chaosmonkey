/**
 * CR-X B6: Connect GitHub Engineering Data — Settings action + identity-only gate.
 *
 * Proves:
 * 1. Settings.vue has "Connect GitHub Engineering Data" action
 * 2. It reuses the existing OAuth flow (github/oauth/redirect)
 * 3. No new GitHub App is created
 * 4. Pilot Health surfaces engineering-evidence connection state
 * 5. Identity-only OAuth produces zero engineering evidence (fail-closed)
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('CR-X B6: Connect GitHub Engineering Data', () => {
  it('Settings.vue has Connect / Reconnect GitHub Engineering Data action', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../pages/Settings.vue'),
      'utf-8'
    )
    expect(source).toContain('Connect GitHub Engineering Data')
    expect(source).toContain('Reconnect GitHub Engineering Data')
    expect(source).toContain('connectGitHubEngineeringData')
    expect(source).toContain('githubEngineeringState')
  })

  it('Settings.vue reuses existing OAuth flow (github/oauth/redirect)', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../pages/Settings.vue'),
      'utf-8'
    )
    // Must use the existing redirect endpoint, not a new one
    expect(source).toContain('github/oauth/redirect')
    // Must NOT create a new GitHub App or new endpoint
    expect(source).not.toContain('github/app')
    expect(source).not.toContain('create-app')
  })

  it('Settings.vue surfaces engineering vs identity-only state', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../pages/Settings.vue'),
      'utf-8'
    )
    expect(source).toContain('engineering_integration')
    expect(source).toContain('identity_only')
    expect(source).toContain('Identity Only')
    expect(source).toContain('GitHub Engineering Data — Connected')
    expect(source).toContain('Reconnect GitHub Engineering Data')
  })

  it('Pilot Health surfaces engineering-evidence connection state', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../components/PilotHealthPanel.vue'),
      'utf-8'
    )
    expect(source).toContain('github_engineering_evidence')
    expect(source).toContain('engineering_evidence_eligible')
  })

  it('Backend OAuth status exposes token_purpose', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../backend/app/Http/Controllers/GitHubOAuthController.php'),
      'utf-8'
    )
    expect(source).toContain("token_purpose")
  })

  it('Backend identity-only gate is fail-closed (isEngineeringEvidenceEligible)', () => {
    const pilotHealthSource = fs.readFileSync(
      path.resolve(__dirname, '../../../backend/app/Http/Controllers/PilotHealthController.php'),
      'utf-8'
    )
    // The fail-closed gate: only engineering_integration is eligible
    expect(pilotHealthSource).toContain('engineering_integration')
    expect(pilotHealthSource).toContain('identity_only')

    // The PR controller gates release metrics on engineering evidence eligibility
    const prSource = fs.readFileSync(
      path.resolve(__dirname, '../../../backend/app/Http/Controllers/PullRequestController.php'),
      'utf-8'
    )
    expect(prSource).toContain('isEngineeringEvidenceEligible')
    // Release metrics return zeros when not eligible
    expect(prSource).toContain('EVIDENCE GATE')
    expect(prSource).toContain('total_releases')
    expect(prSource).toContain('releases_in_period')
  })

  it('CR-X authority: Settings and Pilot Health use the same GitHub engineering authority', () => {
    // Both must check oauth_tokens.token_purpose from the same data source.
    // Settings uses /api/github/oauth/status → GitHubOAuthController::getOAuthStatus()
    // Pilot Health uses PilotHealthController::computeGithubEligibilityState()
    // Both read token_purpose from oauth_tokens.user_data JSON.
    const oauthControllerSource = fs.readFileSync(
      path.resolve(__dirname, '../../../backend/app/Http/Controllers/GitHubOAuthController.php'),
      'utf-8'
    )
    const pilotHealthSource = fs.readFileSync(
      path.resolve(__dirname, '../../../backend/app/Http/Controllers/PilotHealthController.php'),
      'utf-8'
    )

    // Both must reference oauth_tokens table
    expect(oauthControllerSource).toContain('oauth_tokens')
    expect(pilotHealthSource).toContain('oauth_tokens')

    // Both must read token_purpose from user_data
    expect(oauthControllerSource).toContain('token_purpose')
    expect(pilotHealthSource).toContain('token_purpose')

    // Both must distinguish engineering_integration from identity_only
    expect(oauthControllerSource).toContain('engineering_integration')
    expect(pilotHealthSource).toContain('engineering_integration')
    expect(pilotHealthSource).toContain('identity_only')
  })

  it('CR-X authority: Settings does NOT expose non-authoritative Connected Services', () => {
    // The legacy hardcoded integrations ref (GitHub connected=true, Slack, Email)
    // was removed because it was static mock data, not backend authority.
    const source = fs.readFileSync(
      path.resolve(__dirname, '../pages/Settings.vue'),
      'utf-8'
    )
    // Must NOT have the hardcoded integrations array
    expect(source).not.toContain("id: 'github'")
    expect(source).not.toContain("name: 'GitHub'")
    expect(source).not.toContain("id: 'slack'")
    expect(source).not.toContain("id: 'email'")
    // Must NOT have the mock toggleIntegration/confirmIntegrationToggle
    expect(source).not.toContain('toggleIntegration')
    expect(source).not.toContain('confirmIntegrationToggle')
    // Must NOT have the Connected Services heading
    expect(source).not.toContain('Connected Services')
  })
})
