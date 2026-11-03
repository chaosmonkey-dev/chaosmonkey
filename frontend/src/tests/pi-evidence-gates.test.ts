import { describe, it, expect } from 'vitest';

// Mock window for Node.js test environment (PI audit and stress fixture access window)
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = { location: { search: '' } } as any;
} else if (!(globalThis as any).window.location) {
  (globalThis as any).window.location = { search: '' };
}
import type { CanonicalInsightInput } from '../lib/insights/final/types';
import { generateFinalCanonicalInsights } from '../lib/insights/final/index';
import { isGithubEvidenceEligible } from '../lib/insights/final/dataAccess';

function mkSessions(n: number, tool = 'vscode'): any[] {
  const r: any[] = [];
  // CR-X: Use multi-workflow sessions with enriched fields — generators no
  // longer use seeded fallbacks and require ≥2 workflows + enriched fields
  // to produce comparison insights.
  const tools = ['vscode', 'cursor'];
  for (let i = 0; i < n; i++) {
    const t = tool === 'vscode' ? tools[i % tools.length] : tool;
    r.push({
    session_id: `s-${t}-${i}`, tool: t, ide: t, developer_id: `d${i%5}`,
    start_time: new Date(Date.now()-i*864e5).toISOString(), end_time: new Date(Date.now()-i*864e5+36e5).toISOString(),
    duration_ms: 36e5, ai_suggestions_accepted: 5+(i%15), ai_usage_duration_minutes: 10+(i%20),
    ai_burst_count: 5+(i%15),
    files_edited: 1+(i%4), commits: i%3, active_coding_time_minutes: 20+(i%30),
    idle_time_minutes: i%10, average_session_length_minutes: 60, time_to_first_commit_minutes: 2+(i%15),
    file_save_count: 1+(i%4), focus_ratio: 0.4+(i%5)*0.1,
    debug_ratio: 0.05+(i%3)*0.05, terminal_ratio: 0.1+(i%3)*0.05,
    session_quality_score: 0.7+(i%3)*0.1, session_has_ai_activity: t==='cursor'?true:i%3!==0,
    repository: `repo-${i%3}`,
    });
  }
  return r;
}
const eligGh = (prs:number,rev:number,dep:number):any => ({
  github_connected:true, github_provenance:{source:'github_api',historical_data_available:true,db_data_available:true},
  pr_analytics:{total_prs:prs,merged_prs:Math.floor(prs*0.7),merge_rate:70,reopened_prs:Math.floor(prs*0.1)},
  pr_review_metrics:{total_prs:prs,reviewed_prs:rev,review_count:rev,unique_reviewer_count:3,review_coverage:prs?(rev/prs)*100:0,pr_reopened_count:Math.floor(prs*0.1)},
  deployment_metrics:{success_deployment_count:dep,failed_deployment_count:Math.floor(dep*0.1),total_deployment_count:dep,deployment_frequency:dep,change_failure_rate:10},
  total_repositories:3,
});
const ineligGh = ():any => ({
  github_connected:false, github_provenance:{source:'seeded',historical_data_available:false},
  pr_analytics:{total_prs:0,merged_prs:0,merge_rate:0},
  pr_review_metrics:{total_prs:0,reviewed_prs:0,review_coverage:0},
  deployment_metrics:{success_deployment_count:0,failed_deployment_count:0,total_deployment_count:0,deployment_frequency:0},
  total_repositories:0,
});
const ti = (s:any[],gh?:any):CanonicalInsightInput => ({sessionRows:s,githubSnapshot:gh,githubByPeriod:[],productivityByPeriod:[],granularity:'week'});

describe('PI Evidence Gates', () => {
  it('A: eligible telemetry produces actionable PIs', async () => {
    const ins = await generateFinalCanonicalInsights(ti(mkSessions(50)));
    expect(ins.filter(i=>!i.isDiagnostic).length).toBeGreaterThan(0);
  });
  it('B: empty telemetry produces no actionable PIs', async () => {
    const ins = await generateFinalCanonicalInsights(ti([]));
    const actionable = ins.filter(i => !i.isDiagnostic && i.hasData);
    expect(actionable.length).toBe(0);
  });
  it('C: eligible GitHub produces review-merge insights', async () => {
    // CR-X: With eligible GitHub evidence, review-merge generators produce
    // insights. Without workflow-attributed breakdown data, these are
    // org-level diagnostic findings (comparisonState=org_level_only or
    // instrumentation_gap). The test verifies insights EXIST, not that
    // they are actionable — actionable requires workflow attribution.
    const ins = await generateFinalCanonicalInsights(ti(mkSessions(30),eligGh(15,10,5)));
    expect(ins.filter(i=>i.cicdStage==='review-merge').length).toBeGreaterThan(0);
  });
  it('D: eligible deployment produces deploy-operate insights', async () => {
    // CR-X: With eligible deployment evidence, deploy-operate generators
    // produce insights. Without workflow-attributed deployment breakdown,
    // these are org-level diagnostic findings.
    const ins = await generateFinalCanonicalInsights(ti(mkSessions(30),eligGh(10,5,20)));
    expect(ins.filter(i=>i.cicdStage==='deploy-operate').length).toBeGreaterThan(0);
  });
  it('E: disconnected GitHub produces no actionable GitHub PIs', async () => {
    const ins = await generateFinalCanonicalInsights(ti(mkSessions(30),ineligGh()));
    expect(ins.filter(i=>!i.isDiagnostic&&(i.cicdStage==='review-merge'||i.cicdStage==='deploy-operate')).length).toBe(0);
  });
  it('E: isGithubEvidenceEligible rejects seeded, accepts real', () => {
    expect(isGithubEvidenceEligible(ineligGh())).toBe(false);
    expect(isGithubEvidenceEligible(eligGh(5,3,2))).toBe(true);
  });
  it('F: transition from null to present when GitHub evidence added', async () => {
    // CR-X: Without GitHub evidence, GitHub-dependent review-merge generators
    // (reopen-pressure-spike, reviewer-load-concentration) return null.
    // With GitHub evidence, they produce diagnostic insights (org-level
    // until workflow attribution). session-conditioned-pr-cycle-time is
    // session-based and may appear without GitHub evidence.
    const without = await generateFinalCanonicalInsights(ti(mkSessions(30)));
    const rmGhWithout = without.filter(i=>i.cicdStage==='review-merge'&&(i.id==='reopen-pressure-spike'||i.id==='reviewer-load-concentration'));
    expect(rmGhWithout.length).toBe(0);
    const withGh = await generateFinalCanonicalInsights(ti(mkSessions(30),eligGh(15,10,5)));
    const rmGhWith = withGh.filter(i=>i.cicdStage==='review-merge'&&(i.id==='reopen-pressure-spike'||i.id==='reviewer-load-concentration'));
    expect(rmGhWith.length).toBeGreaterThan(0);
  });
});
