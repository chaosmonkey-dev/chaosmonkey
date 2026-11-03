import { describe, it, expect } from 'vitest';
import { generateFinalCanonicalInsights } from '../lib/insights/final';
import { resolveFamilyForDiversity } from '../lib/insights/final/utils/ranking';
import { addDerivedSessionFields } from '../lib/insights/final/dataAccess';
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

describe('CR-X DUMP LOCAL', () => {
  it('dumps exact Local final findings in UI order', async () => {
    const BASE = 'http://127.0.0.1:8010';
    const authRes = await fetch(`${BASE}/api/dev/verification-auth`);
    if (!authRes.ok) { console.log('API not available'); expect(true).toBe(true); return; }
    const auth = await safeJson(authRes);
    const token = auth.token;
    const headers = { Authorization: `Bearer ${token}` };

    // Fetch sessions (all pages) — use smaller pages to reduce per-request load
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
          if (attempt === 1) { console.log(`Page ${page} fetch failed after retries:`, (e as Error).message); page = 999; break; }
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      if (page === 999) break;
    }
    console.log('Session rows:', allSessions.length);

    // Fetch GitHub
    const ghRes = await fetch(`${BASE}/api/metrics?time_filter=all&use_all_data=1&nocache=1&github_nocache=1`, { headers });
    const githubRaw = await safeJson(ghRes);

    // Fetch cost configs
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

    addDerivedSessionFields(allSessions);

    const input = {
      sessionRows: allSessions,
      githubSnapshot: githubRaw,
      externalCostConfigs: costConfigs.length > 0 ? costConfigs : null,
    };

    const insights = await generateFinalCanonicalInsights(input) as any[];
    const findings = insights.filter((i: any) => !i.isDiagnostic);
    const diags = insights.filter((i: any) => i.isDiagnostic);

    console.log('\n========================================');
    console.log('TOTAL INSIGHTS:', insights.length);
    console.log('FINDINGS:', findings.length, '| DIAGNOSTICS:', diags.length);
    console.log('========================================');

    // Dump ALL findings in final UI order with required columns
    console.log('\n=== ALL FINDINGS (final UI order) ===');
    console.log('id | family | title | storyKey | stage | topRank | evidenceDimensions');
    console.log('---');
    for (const i of insights) {
      const baseId = resolveCanonicalFamilyId(i.id) ?? i.id;
      const family = resolveFamilyForDiversity(i.id) || baseId;
      const storyKey = (i as any).storyKey || '';
      const topRank = i.isTopInsightEligible ? `#${i.topInsightRank}` : '';
      const evidenceDims = (i.evidence || []).map((e: any) => e?.label || e?.dimension || '').filter(Boolean).join('; ');
      const diag = i.isDiagnostic ? '[DIAG] ' : '';
      console.log(`${diag}${i.id} | ${family} | ${i.title} | ${storyKey} | ${i.cicdStage} | ${topRank} | ${evidenceDims}`);
    }

    // Top 5 — use the engine-stamped topInsightRank (NOT re-ranked)
    // CR-X P0: The engine stamps topInsightRank during the pipeline based on
    // customerVisibleCanonical. Re-calling getTopInsights() on the adapted
    // output produces different rankings because the adapter may modify
    // materiality scores. Use the stamped ranks for consistency.
    const top = findings
      .filter((i: any) => i.isTopInsightEligible === true)
      .sort((a: any, b: any) => (a.topInsightRank || 999) - (b.topInsightRank || 999))
      .slice(0, 5);
    console.log('\n=== TOP 5 ===');
    for (let idx = 0; idx < top.length; idx++) {
      const t = top[idx] as any;
      const family = resolveFamilyForDiversity(t.id) || resolveCanonicalFamilyId(t.id) || t.id;
      console.log(`${idx + 1}. id=${t.id} | family=${family} | title=${t.title}`);
    }

    // Diagnostics
    console.log('\n=== DIAGNOSTICS ===');
    for (const d of diags) {
      console.log(`  id=${d.id} | reason=${(d as any).diagnosticReason} | title=${d.title}`);
    }

    // Semantic duplication check — group by similar titles
    console.log('\n=== SEMANTIC DUPLICATION CHECK ===');
    const titleGroups: Record<string, any[]> = {};
    for (const i of findings) {
      // Normalize title for grouping: lowercase, remove numbers/special chars
      const norm = i.title.toLowerCase()
        .replace(/\d+\.?\d*/g, '#')
        .replace(/[(){}[\]]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!titleGroups[norm]) titleGroups[norm] = [];
      titleGroups[norm].push(i);
    }
    for (const [norm, group] of Object.entries(titleGroups)) {
      if (group.length > 1) {
        console.log(`\nDUPLICATE GROUP (${group.length} cards): "${norm}"`);
        for (const i of group) {
          console.log(`  id=${i.id} | title=${i.title}`);
        }
      }
    }

    // Repo/allocation story check
    console.log('\n=== REPO/ALLOCATION FINDINGS ===');
    const repoAllocFindings = findings.filter((i: any) => {
      const fam = resolveFamilyForDiversity(i.id);
      return ['cross_repo_behavior', 'workflow_allocation', 'workflow_allocation_shift', 'concentration'].includes(fam);
    });
    for (const i of repoAllocFindings) {
      console.log(`  id=${i.id} | family=${resolveFamilyForDiversity(i.id)} | title=${i.title}`);
    }

    // Pairwise comparison findings
    console.log('\n=== PAIRWISE COMPARISON FINDINGS (vs/_vs_ in id) ===');
    const pairwise = findings.filter((i: any) => i.id.includes('_vs_') || i.id.includes('__vs__'));
    for (const i of pairwise) {
      console.log(`  id=${i.id} | title=${i.title}`);
    }

    expect(insights.length).toBeGreaterThan(0);
  }, 120000);
});
