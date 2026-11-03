/**
 * CR-X PI Browser-Parity Diagnostic (Phase 0)
 *
 * PURPOSE: Isolate why the test harness (cr-x-dump-local) produces 24
 * findings / 0 diagnostics while the browser shows 10 findings / 5
 * diagnostics (Plan & Code gone). Both run the SAME engine code, so the
 * divergence is in the DATA PATH.
 *
 * Four populations through generateFinalCanonicalInsights:
 *   A. TEST PATH — raw canonical sessions (no enrichment) + raw GitHub + cost
 *   B. BROWSER PATH (enriched) — fetchSharedEnrichedCanonical + resolveCanonicalGithubInput + cost
 *   C. BROWSER PATH (forced empty sessions) — Pop B but sessionRows=[], GitHub present
 *   D. BROWSER PATH (partial sessions) — Pop B but sessionRows = first page only
 *
 * If Pop C reproduces 10/5 → root cause is session fetch failure/partial hydration.
 * If Pop B differs from Pop A → enrichment field mutation is a contributor.
 * If Pop D differs from Pop B → partial hydration has a distinct effect.
 *
 * This test is LIVE-API-GATED (like cr-x-dump-local): if the backend is not
 * available, it no-ops. It is NOT the only permanent guard — deterministic
 * corpus-backed regression guards live in cr-x-pi-plan-code-disappearance-regression.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';

// Stub VITE_API_BASE_URL so buildApiUrl() produces absolute URLs that
// Node's fetch can parse (in the browser, Vite proxy handles relative URLs).
vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8010');

import { generateFinalCanonicalInsights } from '../lib/insights/final';
import { addDerivedSessionFields, fetchSharedEnrichedCanonical, resolveGithubSnapshotForPI } from '../lib/insights/final/dataAccess';
import { resolveCanonicalGithubInput } from '../lib/insights/final/canonicalGithubResolver';
import { resolveFamilyForDiversity } from '../lib/insights/final/utils/ranking';
import { resolveCanonicalFamilyId } from '../lib/insights/final/canonicalInsights';

// Strip PHP notices/HTML before JSON parsing
function safeJson(res: Response): Promise<any> {
  return res.text().then((text: string) => {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < 0) throw new Error('No JSON found in response');
    return JSON.parse(text.substring(jsonStart, jsonEnd + 1));
  });
}

interface PopulationResult {
  name: string;
  sessionCount: number;
  findings: number;
  diagnostics: number;
  stageCounts: { 'plan-code': number; 'review-merge': number; 'deploy-operate': number; other: number };
  top5: string[];
  findingIds: string[];
  fieldPresence: Record<string, number>;
}

function stageOf(i: any): string {
  return i.cicdStage || 'other';
}

function summarize(name: string, sessionRows: any[], insights: any[]): PopulationResult {
  const findings = insights.filter((i: any) => !i.isDiagnostic);
  const diags = insights.filter((i: any) => i.isDiagnostic);
  const stageCounts: any = { 'plan-code': 0, 'review-merge': 0, 'deploy-operate': 0, other: 0 };
  for (const i of findings) stageCounts[stageOf(i)] = (stageCounts[stageOf(i)] || 0) + 1;
  const top5 = findings
    .filter((i: any) => i.isTopInsightEligible === true)
    .sort((a: any, b: any) => (a.topInsightRank || 999) - (b.topInsightRank || 999))
    .slice(0, 5)
    .map((i: any) => i.id);

  // Field presence counts across session rows
  const fields = [
    'simulated', 'session_has_commit_outcome', 'session_commits', 'session_commits_source',
    'time_to_first_commit_ms', 'ttfc_source', 'ttfc_from_enriched', 'focus_ratio',
    'user_id', 'tool', 'git_repo_url', 'duration_ms', 'active_coding_duration_ms',
    'ai_burst_count', 'session_has_ai_activity',
  ];
  const fieldPresence: Record<string, number> = {};
  for (const f of fields) {
    fieldPresence[f] = sessionRows.filter((s: any) => s[f] !== undefined && s[f] !== null).length;
  }
  // session_commits_source distribution
  const sourceDist: Record<string, number> = {};
  for (const s of sessionRows) {
    const src = s.session_commits_source || 'unset';
    sourceDist[src] = (sourceDist[src] || 0) + 1;
  }
  fieldPresence['_session_commits_source_dist'] = JSON.stringify(sourceDist) as any;

  return {
    name,
    sessionCount: sessionRows.length,
    findings: findings.length,
    diagnostics: diags.length,
    stageCounts,
    top5,
    findingIds: findings.map((i: any) => i.id),
    fieldPresence,
  };
}

function printResult(r: PopulationResult) {
  console.log(`\n--- ${r.name} ---`);
  console.log(`  sessions: ${r.sessionCount}`);
  console.log(`  findings: ${r.findings} | diagnostics: ${r.diagnostics}`);
  console.log(`  stages: plan-code=${r.stageCounts['plan-code']} review-merge=${r.stageCounts['review-merge']} deploy-operate=${r.stageCounts['deploy-operate']} other=${r.stageCounts.other}`);
  console.log(`  top5: ${r.top5.join(', ')}`);
  console.log(`  fieldPresence:`, r.fieldPresence);
  console.log(`  findingIds: ${r.findingIds.join(', ')}`);
}

describe('CR-X PI Browser-Parity Diagnostic', () => {
  it('diffs 4 populations to isolate 24/0-vs-10/5 root cause', async () => {
    const BASE = 'http://127.0.0.1:8010';
    const authRes = await fetch(`${BASE}/api/dev/verification-auth`);
    if (!authRes.ok) { console.log('API not available — diagnostic no-ops'); expect(true).toBe(true); return; }
    const auth = await safeJson(authRes);
    const token = auth.token;
    const headers = { Authorization: `Bearer ${token}` };

    // Set up globalThis.localStorage so authenticatedFetch (used by
    // fetchSharedEnrichedCanonical and resolveGithubSnapshotForPI) can read
    // the api_token. The test setup.ts only puts localStorage on window;
    // authenticatedFetch references the global localStorage directly.
    if (!(globalThis as any).localStorage) {
      (globalThis as any).localStorage = {
        _store: {} as Record<string, string>,
        getItem(key: string) { return this._store[key] ?? null; },
        setItem(key: string, value: string) { this._store[key] = String(value); },
        removeItem(key: string) { delete this._store[key]; },
        clear() { this._store = {}; },
      };
    }
    (globalThis as any).localStorage.setItem('api_token', token);

    // ── Fetch raw canonical sessions (all pages) — TEST PATH input ──
    const allSessions: any[] = [];
    let page = 1;
    const from = '2000-01-01';
    const to = `${new Date().toISOString().split('T')[0]}T23:59:59.999Z`;
    const PER_PAGE = 500;
    while (page <= 50) {
      const url = `${BASE}/api/telemetry/canonical?from=${from}&to=${to}&format=sessions&per_page=${PER_PAGE}&page=${page}`;
      let success = false;
      for (let attempt = 0; attempt < 2 && !success; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 45000);
        try {
          const res = await fetch(url, { headers, signal: ctrl.signal });
          clearTimeout(timer);
          if (!res.ok) { page = 999; break; }
          const data = await safeJson(res);
          const sessions = data.data || data.sessions || [];
          if (sessions.length === 0) { page = 999; break; }
          allSessions.push(...sessions);
          const totalPages = data.metadata?.total_pages || 1;
          success = true;
          if (page >= totalPages) { page = 999; break; }
          page++;
        } catch (e) {
          clearTimeout(timer);
          if (attempt === 1) { console.log(`Page ${page} fetch failed:`, (e as Error).message); page = 999; break; }
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      if (page === 999) break;
    }

    // ── Fetch raw GitHub (TEST PATH) ──
    const ghRes = await fetch(`${BASE}/api/metrics?time_filter=all&use_all_data=1&nocache=1&github_nocache=1`, { headers });
    const githubRaw = await safeJson(ghRes);

    // ── Fetch cost configs ──
    let costConfigs: any[] = [];
    try {
      const costRes = await fetch(`${BASE}/api/org/spend/config`, { headers });
      if (costRes.ok) {
        const costData = await safeJson(costRes);
        costConfigs = (costData.configs || []).map((c: any) => ({
          toolId: (c.tool_id || '').replace(/[\s_]+/g, '-').toLowerCase().trim(),
          monthlySpend: parseFloat(c.monthly_spend) || 0,
        })).filter((c: any) => c.monthlySpend > 0);
      }
    } catch { /* no cost configs */ }

    // ── Fetch BROWSER PATH enriched sessions ──
    const sharedEnriched = await fetchSharedEnrichedCanonical();
    const enrichedSessionRows = sharedEnriched.sessionRows;

    // ── Fetch BROWSER PATH GitHub (resolveGithubSnapshotForPI with no store → fetchGithubSnapshot fallback) ──
    const freshGithubSnapshot = await resolveGithubSnapshotForPI();
    const ghResolution = resolveCanonicalGithubInput(freshGithubSnapshot, { granularity: 'week' });
    const piGithubSnapshot = ghResolution.githubSnapshot;
    const piGithubByPeriod = ghResolution.githubByPeriod;

    // ── POP A: TEST PATH (raw canonical, no enrichment, raw GitHub) ──
    const popASessions = [...allSessions];
    addDerivedSessionFields(popASessions);
    const popAInput = {
      sessionRows: popASessions,
      githubSnapshot: githubRaw,
      externalCostConfigs: costConfigs.length > 0 ? costConfigs : null,
    };
    const popAInsights = await generateFinalCanonicalInsights(popAInput as any) as any[];
    const popA = summarize('POP_A_TEST_PATH_unenriched', popASessions, popAInsights);

    // ── POP B: BROWSER PATH (enriched sessions, canonical GitHub) ──
    const popBInput = {
      sessionRows: enrichedSessionRows,
      githubSnapshot: piGithubSnapshot,
      githubByPeriod: piGithubByPeriod,
      externalCostConfigs: costConfigs.length > 0 ? costConfigs : null,
      granularity: 'week' as const,
    };
    const popBInsights = await generateFinalCanonicalInsights(popBInput as any) as any[];
    const popB = summarize('POP_B_BROWSER_PATH_enriched', enrichedSessionRows, popBInsights);

    // ── POP C: BROWSER PATH (forced empty sessions, GitHub present) ──
    const popCInput = {
      sessionRows: [],
      githubSnapshot: piGithubSnapshot,
      githubByPeriod: piGithubByPeriod,
      externalCostConfigs: costConfigs.length > 0 ? costConfigs : null,
      granularity: 'week' as const,
    };
    const popCInsights = await generateFinalCanonicalInsights(popCInput as any) as any[];
    const popC = summarize('POP_C_BROWSER_PATH_empty_sessions', [], popCInsights);

    // ── POP D: BROWSER PATH (partial sessions = first 1000 only) ──
    const partialSessions = enrichedSessionRows.slice(0, 1000);
    const popDInput = {
      sessionRows: partialSessions,
      githubSnapshot: piGithubSnapshot,
      githubByPeriod: piGithubByPeriod,
      externalCostConfigs: costConfigs.length > 0 ? costConfigs : null,
      granularity: 'week' as const,
    };
    const popDInsights = await generateFinalCanonicalInsights(popDInput as any) as any[];
    const popD = summarize('POP_D_BROWSER_PATH_partial_sessions', partialSessions, popDInsights);

    // ── Print side-by-side diff ──
    console.log('\n========================================');
    console.log('CR-X PI BROWSER-PARITY DIAGNOSTIC — 4-POPULATION DIFF');
    console.log('========================================');
    printResult(popA);
    printResult(popB);
    printResult(popC);
    printResult(popD);

    // ── Diff summary ──
    console.log('\n=== DIFF SUMMARY ===');
    console.log(`A vs B (enrichment effect):    findings ${popA.findings}→${popB.findings}, plan-code ${popA.stageCounts['plan-code']}→${popB.stageCounts['plan-code']}`);
    console.log(`B vs C (empty-sessions effect): findings ${popB.findings}→${popC.findings}, plan-code ${popB.stageCounts['plan-code']}→${popC.stageCounts['plan-code']}`);
    console.log(`B vs D (partial-sessions eff):  findings ${popB.findings}→${popD.findings}, plan-code ${popB.stageCounts['plan-code']}→${popD.stageCounts['plan-code']}`);
    console.log(`A vs C (test vs empty):         findings ${popA.findings}→${popC.findings}, plan-code ${popA.stageCounts['plan-code']}→${popC.stageCounts['plan-code']}`);

    // ── Verdict ──
    console.log('\n=== VERDICT ===');
    if (popC.findings === 10 && popC.stageCounts['plan-code'] === 0) {
      console.log('>>> Pop C reproduces 10/5 with Plan & Code GONE → ROOT CAUSE = session fetch failure/partial hydration');
    } else if (popC.findings < popB.findings && popC.stageCounts['plan-code'] === 0) {
      console.log('>>> Pop C drops Plan & Code → session fetch failure is a contributor');
    } else {
      console.log('>>> Pop C does NOT reproduce the symptom → session fetch failure is NOT the sole cause');
    }
    if (popA.findings !== popB.findings || popA.stageCounts['plan-code'] !== popB.stageCounts['plan-code']) {
      console.log('>>> Pop A ≠ Pop B → ENRICHMENT is a contributor (field mutation changes generator output)');
    } else {
      console.log('>>> Pop A == Pop B → enrichment has no effect on finding counts');
    }
    if (popD.findings !== popB.findings || popD.stageCounts['plan-code'] !== popB.stageCounts['plan-code']) {
      console.log('>>> Pop D ≠ Pop B → PARTIAL HYDRATION has a distinct effect');
    }

    // ── Assertions (soft — diagnostic, not hard gates) ──
    expect(popA.findings).toBeGreaterThan(0);
    expect(popB.findings).toBeGreaterThan(0);
    // The diagnostic must produce a clear signal
    console.log('\n=== FIELD PRESENCE DIFF (A vs B) ===');
    const allFields = new Set([...Object.keys(popA.fieldPresence), ...Object.keys(popB.fieldPresence)]);
    for (const f of allFields) {
      const a = popA.fieldPresence[f] || 0;
      const b = popB.fieldPresence[f] || 0;
      if (a !== b) console.log(`  ${f}: A=${a} B=${b} (delta=${b - a})`);
    }
  }, 180000);
});
