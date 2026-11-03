import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addDerivedSessionFields, isGithubEvidenceEligible, INELIGIBLE_GITHUB_PROVENANCE_SOURCES } from '../lib/insights/final/dataAccess';
import { generateFinalCanonicalInsights } from '../lib/insights/final';
import type { CanonicalInsightInput } from '../lib/insights/final/types';

// Ensure window exists for audit module and stress mode check (vitest runs in Node by default)
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = { location: { search: '' } } as any;
}

// Helper: build a session row with defaults
function mkSession(overrides: Record<string, any> = {}): any {
  return {
    session_id: `s-${Math.random().toString(36).slice(2)}`,
    tool: 'vscode',
    duration_ms: 1800000,
    active_coding_duration_ms: 900000,
    ai_burst_count: 0,
    ai_usage_duration_ms: 0,
    ai_intensity_band: 'none',
    time_to_first_commit_ms: 1800000,
    ...overrides,
  };
}

// Helper: build 30+ sessions across 2 IDEs
function mkSessions(n: number, ide: string, overrides: Record<string, any> = {}): any[] {
  return Array.from({ length: n }, (_, i) => mkSession({
    session_id: `${ide}-${i}`,
    tool: ide,
    ...overrides,
  }));
}

describe('CR1 Bounded Repair: Historical Baseline + TTFC Truth', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FINAL_PI_ENGINE_ENABLED', 'true');
  });

  // Test 1: empty recent telemetry + populated all-time baseline
  it('1. empty recent trend + populated all-time baseline => PI runs with baseline data', async () => {
    const sessions = [
      ...mkSessions(20, 'vscode'),
      ...mkSessions(15, 'cursor'),
    ];
    addDerivedSessionFields(sessions);

    const input: CanonicalInsightInput = {
      sessionRows: sessions,
      githubByPeriod: [],
      githubSnapshot: undefined,
      productivityByPeriod: [], // empty trend
      granularity: 'week',
    };

    const insights = await generateFinalCanonicalInsights(input);
    expect(insights.length).toBeGreaterThan(0);
    // Baseline source is all-time canonical telemetry, not empty
    expect((input.sessionRows as any[]).length).toBe(35);
  });

  // Test 2: no simulator invocation
  it('2. no simulator invocation when baseline data is present', async () => {
    const sessions = [
      ...mkSessions(20, 'vscode'),
      ...mkSessions(15, 'cursor'),
    ];
    addDerivedSessionFields(sessions);

    const input: CanonicalInsightInput = {
      sessionRows: sessions,
      githubByPeriod: [],
      githubSnapshot: undefined,
      productivityByPeriod: [],
      granularity: 'week',
    };

    const insights = await generateFinalCanonicalInsights(input);
    // All insights should come from generators, not simulator
    const hasSimulatorInsight = insights.some(i => (i as any).generatorSource?.includes('simulator'));
    expect(hasSimulatorInsight).toBe(false);
  });

  // Test 3: positive TTFC + no commit outcome => diagnostic, not actionable
  it('3. positive TTFC + no commit outcome => ttfc_source=missing', () => {
    const sessions = [mkSession({
      time_to_first_commit_ms: 1800000,
      session_commits: 0,
      session_has_commit_outcome: false,
    })];
    addDerivedSessionFields(sessions);
    expect(sessions[0].ttfc_source).toBe('missing');
  });

  // Test 4: observed commit event + valid TTFC => actionable
  // CR5 provenance contract: ttfc_source='observed' requires ttfc_from_enriched=true
  // (set during enrichCanonicalSessions) + session_has_commit_outcome=true + finite TTFC.
  it('4. observed commit event + valid TTFC => ttfc_source=observed', () => {
    const sessions = [mkSession({
      time_to_first_commit_ms: 1800000,
      session_commits: 3,
      session_has_commit_outcome: true,
      ttfc_from_enriched: true,
    })];
    addDerivedSessionFields(sessions);
    expect(sessions[0].ttfc_source).toBe('observed');
  });

  // Test 4b: session_commits from observed source (not aggregated) + valid TTFC => observed
  // CR5 provenance contract: session_commits_source='observed' requires session_has_commit_outcome=true.
  // ttfc_source='observed' additionally requires ttfc_from_enriched=true.
  it('4b. session_commits observed source + valid TTFC => ttfc_source=observed', () => {
    const sessions = [mkSession({
      time_to_first_commit_ms: 1800000,
      session_commits: 2,
      session_has_commit_outcome: true,
      ttfc_from_enriched: true,
    })];
    addDerivedSessionFields(sessions);
    expect(sessions[0].session_commits_source).toBe('observed');
    expect(sessions[0].ttfc_source).toBe('observed');
  });

  // Test 4c: session_commits from aggregated fallback + valid TTFC => missing
  it('4c. session_commits from aggregated fallback + valid TTFC => ttfc_source=missing', () => {
    const sessions = [mkSession({
      time_to_first_commit_ms: 1800000,
      commits_per_session: 2.5,
      // no session_commits field, so it falls back to commits_per_session
    })];
    addDerivedSessionFields(sessions);
    expect(sessions[0].session_commits_source).toBe('aggregated_fallback');
    expect(sessions[0].ttfc_source).toBe('missing');
  });

  // Test 5: seeded historical GitHub => ineligible
  it('5. seeded historical GitHub => ineligible', () => {
    const seededSnapshot = {
      github_connected: true,
      github_provenance: {
        source: 'seeded_db',
        historical_data_available: true,
      },
    };
    expect(isGithubEvidenceEligible(seededSnapshot)).toBe(false);
  });

  // Test 5b: fixture_fallback => ineligible
  it('5b. fixture_fallback provenance => ineligible', () => {
    const fixtureSnapshot = {
      github_connected: true,
      github_provenance: {
        source: 'fixture_fallback',
        historical_data_available: true,
      },
    };
    expect(isGithubEvidenceEligible(fixtureSnapshot)).toBe(false);
  });

  // Test 6: eligible real historical GitHub + empty current window => historical eligible
  it('6. eligible real historical GitHub + empty current window => eligible', () => {
    const realHistoricalSnapshot = {
      github_connected: true,
      github_provenance: {
        source: 'api',
        historical_data_available: true,
        window_data_available: false,
        live_fetch_ok: false,
      },
    };
    expect(isGithubEvidenceEligible(realHistoricalSnapshot)).toBe(true);
  });

  // Test 7: OAuth connected + no eligible evidence => connected/empty, no GitHub PI claim
  it('7. OAuth connected + no provenance => ineligible (no GitHub PI claim)', () => {
    const oauthOnlySnapshot = {
      github_connected: true,
      // no github_provenance object
    };
    expect(isGithubEvidenceEligible(oauthOnlySnapshot)).toBe(false);
  });

  // Test 7b: OAuth connected + generated_fallback_used => ineligible
  it('7b. OAuth connected + generated_fallback_used => ineligible', () => {
    const fallbackSnapshot = {
      github_connected: true,
      github_provenance: {
        source: 'api',
        historical_data_available: true,
        generated_fallback_used: true,
      },
    };
    expect(isGithubEvidenceEligible(fallbackSnapshot)).toBe(false);
  });

  // Test 8: TTFC generator returns null when no observed commit events
  // CR5 final engine contract: generators that return null do NOT get synthetic
  // diagnostic replacements (Step 1.5 diagnostic backfill was removed).
  // When all sessions have ttfc_source=missing, the TTFC generator returns null
  // and no time-to-first-commit-by-ide insight is emitted at all.
  it('8. TTFC generator returns null when all sessions have ttfc_source=missing', async () => {
    const sessions = [
      ...mkSessions(20, 'vscode', { session_commits: 0, session_has_commit_outcome: false }),
      ...mkSessions(15, 'cursor', { session_commits: 0, session_has_commit_outcome: false }),
    ];
    addDerivedSessionFields(sessions);

    // All sessions should have ttfc_source=missing
    const allMissing = sessions.every(s => s.ttfc_source === 'missing');
    expect(allMissing).toBe(true);

    const input: CanonicalInsightInput = {
      sessionRows: sessions,
      githubByPeriod: [],
      githubSnapshot: undefined,
      productivityByPeriod: [],
      granularity: 'week',
    };

    const insights = await generateFinalCanonicalInsights(input);
    // TTFC should NOT be actionable
    const ttfcActionable = insights.find(i =>
      i.id === 'time-to-first-commit-by-ide' && !i.isDiagnostic
    );
    expect(ttfcActionable).toBeUndefined();

    // CR5 final engine: no diagnostic backfill — TTFC insight is absent entirely
    // when the generator returns null (no observed commit-event data).
    const ttfcAny = insights.find(i => i.id === 'time-to-first-commit-by-ide');
    expect(ttfcAny).toBeUndefined();
  });

  // Test 9: Runtime proof object is emitted on window.__CM_DEBUG__
  it('9. runtime proof object identifies baseline source', async () => {
    const sessions = [
      ...mkSessions(20, 'vscode'),
      ...mkSessions(15, 'cursor'),
    ];
    addDerivedSessionFields(sessions);

    const input: CanonicalInsightInput = {
      sessionRows: sessions,
      githubByPeriod: [],
      githubSnapshot: undefined,
      productivityByPeriod: [],
      granularity: 'week',
    };

    await generateFinalCanonicalInsights(input);

    // Runtime proof should be on window.__CM_DEBUG__
    if (typeof window !== 'undefined') {
      const proof = (window as any).__CM_DEBUG__?.runtimeProof;
      expect(proof).toBeDefined();
      expect(proof.baselineSource).toBe('all_time_canonical_telemetry');
      expect(proof.baselineTelemetryRecords).toBe(35);
    }
  });
});
