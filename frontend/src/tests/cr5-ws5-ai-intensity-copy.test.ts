import { describe, it, expect } from 'vitest';
import { generateReviewBurdenByAIPattern } from '../lib/insights/final/generators/planCode';
import { getCanonicalPIById } from '../lib/insights/final/canonicalInsights';
import type { CanonicalInsightInput } from '../lib/insights/final/types';

function mkSession(tool: string, intensityBand: 'high' | 'low', chars: number = 5000, lines: number = 50): any {
  return {
    session_id: `s-${tool}-${Math.random().toString(36).slice(2)}`,
    tool,
    timestamp: '2026-06-15T10:00:00.000000Z',
    duration_ms: 1800000,
    active_coding_duration_ms: 900000,
    ai_burst_count: intensityBand === 'high' ? 15 : 2,
    ai_burst_chars_total: chars,
    ai_burst_lines_total: lines,
    ai_intensity_band: intensityBand,
    session_duration_minutes: 30,
    session_active_coding_duration_minutes: 15,
  };
}

function ti(sessionRows: any[]): CanonicalInsightInput {
  return { sessionRows, granularity: 'month' } as any;
}

describe('CR5 WS5: AI-intensity cross-workflow copy correction', () => {
  // Build sessions that produce a ~19.4pp gap (45.3% vs 25.9%)
  // Devin: 150 sessions, ~68 high-intensity (ai_burst_count > 10) → ~45.3%
  // Claude Code: 50 sessions, ~13 high-intensity → ~25.9%
  function buildSessions(): any[] {
    const sessions: any[] = [];
    // Devin: 150 sessions, 68 high-intensity, 82 low
    for (let i = 0; i < 68; i++) sessions.push(mkSession('devin', 'high', 5000, 50));
    for (let i = 0; i < 82; i++) sessions.push(mkSession('devin', 'low', 500, 5));
    // Claude Code: 50 sessions, 13 high-intensity, 37 low
    for (let i = 0; i < 13; i++) sessions.push(mkSession('claude_code', 'high', 5000, 50));
    for (let i = 0; i < 37; i++) sessions.push(mkSession('claude_code', 'low', 500, 5));
    return sessions;
  }

  it('N1. description does NOT contain "workflow workflows" double-noun', () => {
    const insight = generateReviewBurdenByAIPattern(ti(buildSessions()));
    expect(insight).not.toBeNull();
    if (!insight) return;
    const desc = insight.description ?? '';
    expect(desc).not.toContain('workflow workflows');
    expect(desc).not.toContain('workflows workflows');
  });

  it('N2. description does NOT use "similar to" framing for a material gap', () => {
    const insight = generateReviewBurdenByAIPattern(ti(buildSessions()));
    expect(insight).not.toBeNull();
    if (!insight) return;
    const desc = insight.description ?? '';
    // A ~19.4pp gap is material — "similar to" contradicts the finding
    expect(desc.toLowerCase()).not.toContain('similar to');
  });

  it('N3. description contains neutral observational copy with exact values', () => {
    const insight = generateReviewBurdenByAIPattern(ti(buildSessions()));
    expect(insight).not.toBeNull();
    if (!insight) return;
    const desc = insight.description ?? '';
    // Must contain the observational framing
    expect(desc.toLowerCase()).toContain('observational');
    expect(desc.toLowerCase()).toContain('telemetry-only');
    // Must contain the pp difference
    expect(desc).toMatch(/\d+\.\d+pp/);
  });

  it('N4. whatChanged does NOT use "similar" for a material gap', () => {
    const insight = generateReviewBurdenByAIPattern(ti(buildSessions()));
    expect(insight).not.toBeNull();
    if (!insight) return;
    const wc = insight.whatChanged ?? '';
    expect(wc.toLowerCase()).not.toContain('similar');
    // Must contain the pp difference
    expect(wc).toMatch(/\d+\.\d+pp/);
  });

  it('N5. recommendation does NOT say "balanced" for a material gap', () => {
    const insight = generateReviewBurdenByAIPattern(ti(buildSessions()));
    expect(insight).not.toBeNull();
    if (!insight) return;
    const rec = insight.recommendation ?? '';
    expect(rec.toLowerCase()).not.toContain('balanced');
  });

  it('N6. operationalImpact does NOT say "Balanced" for a material gap', () => {
    const insight = generateReviewBurdenByAIPattern(ti(buildSessions()));
    expect(insight).not.toBeNull();
    if (!insight) return;
    const oi = insight.operationalImpact ?? '';
    expect(oi).not.toContain('Balanced');
  });

  it('N7. operationalRead does NOT use "similar" for a material gap', () => {
    const insight = generateReviewBurdenByAIPattern(ti(buildSessions()));
    expect(insight).not.toBeNull();
    if (!insight) return;
    const or = insight.operationalRead ?? '';
    expect(or.toLowerCase()).not.toContain('similar');
  });

  it('N8. no "workflow workflows" in any customer-visible field', () => {
    const insight = generateReviewBurdenByAIPattern(ti(buildSessions()));
    expect(insight).not.toBeNull();
    if (!insight) return;
    const allText = `${insight.title} ${insight.description ?? ''} ${insight.recommendation ?? ''} ${insight.executiveSummary ?? ''} ${insight.evidenceAndContext ?? ''} ${insight.whyItMatters ?? ''} ${insight.primaryRisk ?? ''} ${insight.operationalImpact ?? ''} ${insight.operationalRead ?? ''} ${insight.whatChanged ?? ''}`;
    expect(allText).not.toContain('workflow workflows');
  });

  it('N9. title preserves the finding (varies + pp + workflow pair)', () => {
    const insight = generateReviewBurdenByAIPattern(ti(buildSessions()));
    expect(insight).not.toBeNull();
    if (!insight) return;
    expect(insight.title).toContain('varies');
    expect(insight.title).toMatch(/\d+\.\d+pp/);
  });

  it('N10. evidence metrics do NOT contain "workflow" suffix', () => {
    const insight = generateReviewBurdenByAIPattern(ti(buildSessions()));
    expect(insight).not.toBeNull();
    if (!insight) return;
    if (!insight.evidence) return;
    for (const e of insight.evidence) {
      // Evidence metrics should use clean workflow names (e.g. "Devin", not "Devin workflow")
      if (e.metric.includes('Devin') || e.metric.includes('Claude Code')) {
        expect(e.metric).not.toContain('workflow');
      }
    }
  });
});

describe('CR5 WS5: session-quality-merge-success diagnostic title', () => {
  it('O1. diagnostic title does NOT contain "successfulness"', () => {
    const entry = getCanonicalPIById('session-quality-merge-success');
    expect(entry).not.toBeNull();
    if (!entry) return;
    expect(entry.title.toLowerCase()).not.toContain('successfulness');
  });

  it('O2. diagnostic title uses "workflow outcomes" not "workflow effectiveness"', () => {
    const entry = getCanonicalPIById('session-quality-merge-success');
    expect(entry).not.toBeNull();
    if (!entry) return;
    expect(entry.title).toContain('workflow outcomes');
    expect(entry.title).not.toContain('workflow effectiveness');
  });
});

describe('CR5 WS5 Pre-Demo: TTFC parity and diagnostic subline', () => {
  it('P1. AIOI TTFC label says "Avg" (mean, not median)', () => {
    // AIOI uses observedCommitAuthority which computes MEAN
    // PI uses median. Label must distinguish.
    const fs = require('fs');
    const path = require('path');
    const panel = fs.readFileSync(
      path.resolve(__dirname, '../components/performance/AIUsageSignalsPanel.vue'),
      'utf-8'
    );
    // The TTFC label must contain "Avg" to distinguish from PI's median
    expect(panel).toContain('Avg time to first commit');
  });

  it('P2. PI TTFC title contains "median"', () => {
    const fs = require('fs');
    const path = require('path');
    const planCode = fs.readFileSync(
      path.resolve(__dirname, '../lib/insights/final/generators/planCode.ts'),
      'utf-8'
    );
    // The PI title must say "median time-to-first-commit"
    expect(planCode).toContain('median time-to-first-commit');
  });

  it('P3. diagnostic subline does NOT say "Insufficient sample size for comparison"', () => {
    const fs = require('fs');
    const path = require('path');
    const adapter = fs.readFileSync(
      path.resolve(__dirname, '../lib/insights/final/adapters/renderAdapter.ts'),
      'utf-8'
    );
    expect(adapter).not.toContain('Insufficient sample size for comparison');
  });

  it('P4. diagnostic subline uses "Required evidence not available" for needs_more_data fallback', () => {
    const fs = require('fs');
    const path = require('path');
    const adapter = fs.readFileSync(
      path.resolve(__dirname, '../lib/insights/final/adapters/renderAdapter.ts'),
      'utf-8'
    );
    expect(adapter).toContain('Required evidence not available');
  });

  it('P5. renderAdapter prefers generator-provided diagnosticReason over generic text', () => {
    const fs = require('fs');
    const path = require('path');
    const adapter = fs.readFileSync(
      path.resolve(__dirname, '../lib/insights/final/adapters/renderAdapter.ts'),
      'utf-8'
    );
    // The generator's diagnosticReason should be checked first (||)
    // before the comparisonState-based generic text
    expect(adapter).toContain('(sanitizedInsight as any).diagnosticReason');
  });
});
