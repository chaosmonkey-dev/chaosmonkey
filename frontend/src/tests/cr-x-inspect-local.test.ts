import { describe, it, expect } from 'vitest';
import { generateFinalCanonicalInsights } from '../lib/insights/final';
import { getTopInsights } from '../lib/insights/final/utils/ranking';
import { addDerivedSessionFields } from '../lib/insights/final/dataAccess';

describe('CR-X INSPECT LOCAL', () => {
  it('inspects actual Local runtime output', async () => {
    // Auth — this release gate must fail closed if Local backend is unavailable
    const authRes = await fetch('http://127.0.0.1:8010/api/dev/verification-auth');
    expect(authRes.ok, 'Local backend verification-auth must be available for this release gate').toBe(true);
    const auth = await authRes.json();
    const token = auth.token;

    // Fetch sessions
    const allSessions: any[] = [];
    let page = 1;
    const from = '2000-01-01';
    const to = `${new Date().toISOString().split('T')[0]}T23:59:59.999Z`;
    while (page <= 25) {
      const url = `http://127.0.0.1:8010/api/telemetry/canonical?from=${from}&to=${to}&format=sessions&per_page=1000&page=${page}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) break;
      const data = await res.json();
      const sessions = data.data || data.sessions || [];
      if (sessions.length === 0) break;
      allSessions.push(...sessions);
      if (page >= (data.metadata?.total_pages || 1)) break;
      page++;
    }
    console.log('Session rows:', allSessions.length);

    // Fetch GitHub
    const ghRes = await fetch('http://127.0.0.1:8010/api/metrics?time_filter=all&use_all_data=1&nocache=1&github_nocache=1', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const githubRaw = await ghRes.json();

    // Fetch cost configs
    let costConfigs: any[] = [];
    try {
      const costRes = await fetch('http://127.0.0.1:8010/api/org/spend/config', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (costRes.ok) {
        const costData = await costRes.json();
        costConfigs = (costData.configs || []).map((c: any) => ({
          toolId: (c.tool_id || '').replace(/[\s_]+/g, '-').toLowerCase().trim(),
          monthlySpend: parseFloat(c.monthly_spend) || 0,
        })).filter((c: any) => c.monthlySpend > 0);
      }
    } catch { /* no cost configs */ }

    // Enrich sessions (mutates in place)
    addDerivedSessionFields(allSessions);

    const input = {
      sessionRows: allSessions,
      githubSnapshot: githubRaw,
      externalCostConfigs: costConfigs.length > 0 ? costConfigs : null,
    };

    const insights = await generateFinalCanonicalInsights(input) as any[];
    console.log('Total insights:', insights.length);

    // renderOrder === 1
    const ro1 = insights.filter(i => i.renderOrder === 1);
    console.log('\n=== renderOrder === 1 ===');
    for (const i of ro1) {
      console.log(`  id=${i.id} | stage=${i.cicdStage} | title=${i.title?.substring(0, 80)}`);
    }

    // renderOrder === 0
    const ro0 = insights.filter(i => i.renderOrder === 0);
    console.log('\n=== renderOrder === 0 ===');
    for (const i of ro0) {
      console.log(`  id=${i.id} | stage=${i.cicdStage} | title=${i.title?.substring(0, 80)}`);
    }

    // Executive synthesis
    const synth = insights.find(i => i.id === 'executive-workflow-mix-synthesis');
    console.log('\n=== Executive synthesis ===');
    console.log('  Found:', !!synth);
    if (synth) {
      console.log('  title:', synth.title);
      console.log('  renderOrder:', synth.renderOrder);
      console.log('  hasData:', synth.hasData);
      console.log('  isDiagnostic:', synth.isDiagnostic);
    }

    // recent-change session_share findings
    const rcShares = insights.filter(i => i.id.startsWith('recent-change__session_share__'));
    console.log('\n=== recent-change session_share findings ===');
    for (const i of rcShares) {
      console.log(`  id=${i.id} | title=${i.title?.substring(0, 80)} | hasData=${i.hasData} | isDiag=${i.isDiagnostic}`);
    }

    // All recent-change findings
    const rcAll = insights.filter(i => i.id.startsWith('recent-change__'));
    console.log('\n=== ALL recent-change findings ===');
    for (const i of rcAll) {
      console.log(`  id=${i.id} | title=${i.title?.substring(0, 80)} | hasData=${i.hasData}`);
    }

    // Top Insights
    const top = getTopInsights(insights);
    console.log('\n=== Top Insights ===');
    for (let i = 0; i < top.length; i++) {
      console.log(`  ${i+1}. id=${top[i].id} | title=${top[i].title?.substring(0, 80)}`);
    }

    // Check if synthesis is in the scored pool
    console.log('\n=== Synthesis details ===');
    const synth2 = insights.find(i => i.id === 'executive-workflow-mix-synthesis');
    if (synth2) {
      console.log('  deltaPct:', synth2.deltaPct);
      console.log('  confidence:', synth2.confidence);
      console.log('  n:', synth2.n);
      console.log('  isExecutiveFinding:', synth2.isExecutiveFinding);
      console.log('  lifecycleClass:', synth2.lifecycleClass);
      console.log('  presentationKind:', synth2.presentationKind);
      console.log('  comparisonState:', synth2.comparisonState);
      console.log('  cicdStage:', synth2.cicdStage);
    }

    // Show top 10 scored insights
    console.log('\n=== All insights (first 15) ===');
    for (const i of insights.slice(0, 15)) {
      console.log(`  id=${i.id} | deltaPct=${i.deltaPct} | conf=${i.confidence} | n=${i.n} | exec=${i.isExecutiveFinding} | pk=${i.presentationKind}`);
    }

    // Findings vs diagnostics breakdown
    const findings = insights.filter(i => !i.isDiagnostic);
    const diags = insights.filter(i => i.isDiagnostic);
    console.log('\n=== Portfolio counts ===');
    console.log(`  findings=${findings.length} diags=${diags.length} total=${insights.length}`);
    console.log('\n=== DIAGNOSTICS ===');
    for (const d of diags) {
      console.log(`  id=${d.id} | hasData=${d.hasData} | pk=${d.presentationKind} | cs=${d.comparisonState} | title=${d.title?.substring(0, 60)}`);
    }

    // Workflow-repo allocation findings
    const alloc = insights.filter(i => i.id.startsWith('workflow-repo-allocation__'));
    console.log('\n=== workflow-repo-allocation findings ===');
    for (const i of alloc) {
      console.log(`  id=${i.id} | title=${i.title?.substring(0, 80)}`);
      console.log(`    evidence: ${JSON.stringify(i.evidence)?.substring(0, 300)}`);
    }

    // Workflow-repo allocation shift findings
    const allocShift = insights.filter(i => i.id.startsWith('workflow-repo-allocation-shift__'));
    console.log('\n=== workflow-repo-allocation-shift findings ===');
    for (const i of allocShift) {
      console.log(`  id=${i.id} | title=${i.title?.substring(0, 80)}`);
      console.log(`    isDiagnostic=${i.isDiagnostic} | hasData=${i.hasData} | current=${i.current} | diagnosticReason=${(i as any).diagnosticReason} | temporalQuality=${(i as any).temporalQuality}`);
      console.log(`    evidence: ${JSON.stringify(i.evidence)?.substring(0, 300)}`);
    }

    expect(true).toBe(true);
  }, 60000);
});
