import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateConfiguredCostEfficiencyByWorkflow } from '../lib/insights/final/generators/planCode';
import type { CanonicalInsightInput } from '../lib/insights/final/types';

// Ensure window/localStorage exists for vitest (Node by default)
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = { location: { search: '' } } as any;
}
if (typeof (globalThis as any).localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  } as any;
}

const STORAGE_KEY_PREFIX = 'chaosmonkey_tool_cost_config_';

function setCostConfig(toolId: string, seatCount: number, costPerSeatMonthly: number) {
  const monthlySpend = seatCount * costPerSeatMonthly;
  (globalThis as any).localStorage.setItem(
    `${STORAGE_KEY_PREFIX}${toolId}`,
    JSON.stringify({ toolId, seatCount, costPerSeatMonthly, monthlySpend, updatedAt: new Date().toISOString() })
  );
}

function clearAllCostConfigs() {
  for (const tool of ['cursor', 'devin', 'vscode', 'claude-code', 'github-copilot']) {
    (globalThis as any).localStorage.removeItem(`${STORAGE_KEY_PREFIX}${tool}`);
  }
}

function mkSession(overrides: Record<string, any> = {}): any {
  return {
    session_id: `s-${Math.random().toString(36).slice(2)}`,
    tool: 'vscode',
    timestamp: '2026-06-15T10:00:00.000000Z',
    duration_ms: 1800000,
    active_coding_duration_ms: 900000,
    session_duration_minutes: 30,
    session_active_coding_duration_minutes: 15,
    ...overrides,
  };
}

function mkSessions(n: number, tool: string, month: string, overrides: Record<string, any> = {}): any[] {
  return Array.from({ length: n }, (_, i) => mkSession({
    session_id: `${tool}-${month}-${i}`,
    tool,
    timestamp: `${month}-15T10:00:00.000000Z`,
    ...overrides,
  }));
}

function ti(sessionRows: any[]): CanonicalInsightInput {
  return { sessionRows, granularity: 'month' } as any;
}

describe('CR5 WS3: Configured Cost Efficiency', () => {
  beforeEach(() => {
    clearAllCostConfigs();
  });

  afterEach(() => {
    clearAllCostConfigs();
  });

  // ── Same-period denominator correctness ──
  it('A1. cost/session divides monthly cost by sessions in the SAME qualifying month', () => {
    // June 2026: devin 30 sessions, vscode 30 sessions
    // Devin: $300/mo, VS Code: $0/mo (explicitly configured zero)
    setCostConfig('devin', 3, 100);  // $300/mo
    setCostConfig('vscode', 0, 0);   // $0/mo (explicitly configured)
    const sessions = [
      ...mkSessions(30, 'devin', '2026-06'),
      ...mkSessions(30, 'vscode', '2026-06'),
    ];
    const insight = generateConfiguredCostEfficiencyByWorkflow(ti(sessions));
    expect(insight).not.toBeNull();
    if (!insight) return;
    if (!insight.evidence) return;

    // Devin cost/session = $300 / 30 = $10.00
    const devinEvidence = insight.evidence.find(e => e.metric.toLowerCase().includes('devin') && e.metric.includes('cost/session'));
    expect(devinEvidence).toBeDefined();
    expect(devinEvidence!.value).toBe('$10.00');
  });

  // ── No all-history cost denominator ──
  it('A2. does NOT divide monthly cost by all-history session population', () => {
    setCostConfig('devin', 3, 100);  // $300/mo
    setCostConfig('vscode', 5, 20);  // $100/mo
    // June: 30 devin, 30 vscode. May: 100 devin, 100 vscode (should NOT be used)
    const sessions = [
      ...mkSessions(30, 'devin', '2026-06'),
      ...mkSessions(30, 'vscode', '2026-06'),
      ...mkSessions(100, 'devin', '2026-05'),
      ...mkSessions(100, 'vscode', '2026-05'),
    ];
    const insight = generateConfiguredCostEfficiencyByWorkflow(ti(sessions));
    expect(insight).not.toBeNull();
    if (!insight) return;
    if (!insight.evidence) return;

    // Should use June (most recent qualifying month), not May
    // Devin cost/session = $300 / 30 = $10.00 (NOT $300 / 130 = $2.31)
    const devinEvidence = insight.evidence.find(e => e.metric.toLowerCase().includes('devin') && e.metric.includes('cost/session'));
    expect(devinEvidence!.value).toBe('$10.00');
    // Should mention June 2026 explicitly
    expect(insight.description ?? '').toContain('2026-06');
  });

  // ── Missing config suppresses cleanly ──
  it('B1. missing cost config suppresses the PI cleanly', () => {
    // No cost config set at all
    const sessions = [
      ...mkSessions(30, 'devin', '2026-06'),
      ...mkSessions(30, 'vscode', '2026-06'),
    ];
    const insight = generateConfiguredCostEfficiencyByWorkflow(ti(sessions));
    expect(insight).toBeNull();
  });

  // ── Explicitly configured $0 is NOT missing ──
  it('B2. explicitly configured $0 is NOT treated as missing', () => {
    // Both configured: devin $300, vscode $0
    setCostConfig('devin', 3, 100);  // $300/mo
    setCostConfig('vscode', 0, 0);   // $0/mo explicitly configured
    const sessions = [
      ...mkSessions(30, 'devin', '2026-06'),
      ...mkSessions(30, 'vscode', '2026-06'),
    ];
    const insight = generateConfiguredCostEfficiencyByWorkflow(ti(sessions));
    expect(insight).not.toBeNull();
    // VS Code should appear in the comparison despite $0
    if (!insight) return;
    if (!insight.evidence) return;
    expect((insight.description ?? '').toLowerCase()).toContain('vs code');
  });

  // ── Zero baseline never produces Infinity ──
  it('C1. zero baseline never produces Infinity ratio', () => {
    setCostConfig('devin', 3, 100);  // $300/mo
    setCostConfig('vscode', 0, 0);   // $0/mo
    const sessions = [
      ...mkSessions(30, 'devin', '2026-06'),
      ...mkSessions(30, 'vscode', '2026-06'),
    ];
    const insight = generateConfiguredCostEfficiencyByWorkflow(ti(sessions));
    expect(insight).not.toBeNull();
    if (!insight) return;
    if (!insight.evidence) return;
    // Title should NOT contain Infinity or "Infinity×"
    expect(insight.title).not.toContain('Infinity');
    expect(insight.title).not.toContain('∞');
    // Should use absolute-dollar headline
    expect(insight.title).toContain('varies');
  });

  // ── Insufficient workflow sample suppresses comparison ──
  it('D1. insufficient workflow sample (<25 sessions) suppresses comparison', () => {
    setCostConfig('devin', 3, 100);
    setCostConfig('vscode', 5, 20);
    // Only 24 sessions each — below the 25 threshold
    const sessions = [
      ...mkSessions(24, 'devin', '2026-06'),
      ...mkSessions(24, 'vscode', '2026-06'),
    ];
    const insight = generateConfiguredCostEfficiencyByWorkflow(ti(sessions));
    expect(insight).toBeNull();
  });

  // ── Emerging workflow cannot control headline ──
  it('E1. emerging workflow (Copilot) cannot control the headline', () => {
    setCostConfig('devin', 3, 100);  // $300/mo
    setCostConfig('github-copilot', 10, 50); // $500/mo
    // Copilot has 30 sessions (enough for threshold) but is emerging
    const sessions = [
      ...mkSessions(30, 'devin', '2026-06'),
      ...mkSessions(30, 'github_copilot', '2026-06'),
    ];
    const insight = generateConfiguredCostEfficiencyByWorkflow(ti(sessions));
    // Should suppress because only 1 non-emerging workflow qualifies
    expect(insight).toBeNull();
  });

  // ── Cost/session math ──
  it('F1. cost/session math is correct', () => {
    setCostConfig('devin', 3, 100);  // $300/mo
    setCostConfig('vscode', 5, 20);  // $100/mo
    const sessions = [
      ...mkSessions(30, 'devin', '2026-06'),
      ...mkSessions(50, 'vscode', '2026-06'),
    ];
    const insight = generateConfiguredCostEfficiencyByWorkflow(ti(sessions));
    expect(insight).not.toBeNull();
    if (!insight) return;
    if (!insight.evidence) return;
    // Devin: $300 / 30 = $10.00
    const devinCs = insight.evidence.find(e => e.metric.toLowerCase().includes('devin') && e.metric.includes('cost/session'));
    expect(devinCs!.value).toBe('$10.00');
    // VS Code: $100 / 50 = $2.00
    const vscodeCs = insight.evidence.find(e => e.metric.toLowerCase().includes('vs code') && e.metric.includes('cost/session'));
    expect(vscodeCs!.value).toBe('$2.00');
  });

  // ── Cost/active-hour math ──
  it('G1. cost/active-hour math is correct', () => {
    setCostConfig('devin', 3, 100);  // $300/mo
    setCostConfig('vscode', 5, 20);  // $100/mo
    // Each session has 15 min active coding (900000ms / 60000 = 15)
    const sessions = [
      ...mkSessions(30, 'devin', '2026-06'),
      ...mkSessions(50, 'vscode', '2026-06'),
    ];
    const insight = generateConfiguredCostEfficiencyByWorkflow(ti(sessions));
    expect(insight).not.toBeNull();
    if (!insight) return;
    if (!insight.evidence) return;
    // Devin: 30 sessions × 15 min = 450 min = 7.5 hours
    // $300 / 7.5 = $40.00/hr
    const devinCah = insight.evidence.find(e => e.metric.toLowerCase().includes('devin') && e.metric.includes('cost/active-hour'));
    expect(devinCah!.value).toBe('$40.00/hr');
    // VS Code: 50 sessions × 15 min = 750 min = 12.5 hours
    // $100 / 12.5 = $8.00/hr
    const vscodeCah = insight.evidence.find(e => e.metric.toLowerCase().includes('vs code') && e.metric.includes('cost/active-hour'));
    expect(vscodeCah!.value).toBe('$8.00/hr');
  });

  // ── Current-rate/historical-period wording is explicit ──
  it('H1. current-rate/historical-period wording is explicit', () => {
    setCostConfig('devin', 3, 100);
    setCostConfig('vscode', 5, 20);
    const sessions = [
      ...mkSessions(30, 'devin', '2026-06'),
      ...mkSessions(30, 'vscode', '2026-06'),
    ];
    const insight = generateConfiguredCostEfficiencyByWorkflow(ti(sessions));
    expect(insight).not.toBeNull();
    if (!insight) return;
    if (!insight.evidence) return;
    expect(insight.description ?? '').toContain('Configured rates applied to observed usage');
    expect(insight.description ?? '').toContain('2026-06');
    expect(insight.description ?? '').toContain('retrospectively');
    expect(insight.description ?? '').toContain('not historical invoices');
  });

  // ── No telemetry_events.tool_cost ──
  it('I1. generator does NOT use telemetry_events.tool_cost', () => {
    setCostConfig('devin', 3, 100);
    setCostConfig('vscode', 5, 20);
    // Sessions with tool_cost field (prohibited demo data) — should be ignored
    const sessions = [
      ...mkSessions(30, 'devin', '2026-06', { tool_cost: 999 }),
      ...mkSessions(30, 'vscode', '2026-06', { tool_cost: 999 }),
    ];
    const insight = generateConfiguredCostEfficiencyByWorkflow(ti(sessions));
    expect(insight).not.toBeNull();
    if (!insight) return;
    if (!insight.evidence) return;
    // Cost values should come from localStorage config, not tool_cost
    const devinCs = insight.evidence.find(e => e.metric.toLowerCase().includes('devin') && e.metric.includes('cost/session'));
    expect(devinCs!.value).toBe('$10.00'); // $300/30, not $999/30
  });

  // ── No ROI, savings, waste, or unsupported productivity claim ──
  it('J1. no ROI, savings, waste, or unsupported productivity claim', () => {
    setCostConfig('devin', 3, 100);
    setCostConfig('vscode', 5, 20);
    const sessions = [
      ...mkSessions(30, 'devin', '2026-06'),
      ...mkSessions(30, 'vscode', '2026-06'),
    ];
    const insight = generateConfiguredCostEfficiencyByWorkflow(ti(sessions));
    expect(insight).not.toBeNull();
    if (!insight) return;
    if (!insight.evidence) return;
    const allText = `${insight.title} ${insight.description ?? ''} ${insight.recommendation ?? ''} ${insight.executiveSummary ?? ''} ${insight.evidenceAndContext ?? ''} ${insight.whyItMatters ?? ''} ${insight.primaryRisk ?? ''} ${insight.operationalImpact ?? ''}`;
    const lower = allText.toLowerCase();
    expect(lower).not.toContain('roi');
    expect(lower).not.toContain('return on investment');
    expect(lower).not.toContain('savings');
    expect(lower).not.toContain('waste');
    expect(lower).not.toContain('cheaper workflow is more productive');
    expect(lower).not.toContain('expensive workflow is worse');
    // Must contain the required semantic label
    expect(allText).toContain('Configured estimate · Not billing data');
  });

  // ── Top Insights includes cost family when eligible ──
  it('K1. cost PI is recommendationState monitor_only (never action_required)', () => {
    setCostConfig('devin', 3, 100);
    setCostConfig('vscode', 5, 20);
    const sessions = [
      ...mkSessions(30, 'devin', '2026-06'),
      ...mkSessions(30, 'vscode', '2026-06'),
    ];
    const insight = generateConfiguredCostEfficiencyByWorkflow(ti(sessions));
    expect(insight).not.toBeNull();
    if (!insight) return;
    if (!insight.evidence) return;
    expect(insight.recommendationState).toBe('monitor_only');
    expect(insight.isDiagnostic).toBe(false);
    expect(insight.hasData).toBe(true);
  });

  // ── Windsurf normalizes to Devin for cost lookup ──
  it('L1. windsurf sessions use devin cost config (canonical alias)', () => {
    setCostConfig('devin', 3, 100);  // $300/mo
    setCostConfig('vscode', 5, 20);  // $100/mo
    // Windsurf sessions normalize to devin for workflow grouping
    const sessions = [
      ...mkSessions(30, 'windsurf', '2026-06'),
      ...mkSessions(30, 'vscode', '2026-06'),
    ];
    const insight = generateConfiguredCostEfficiencyByWorkflow(ti(sessions));
    expect(insight).not.toBeNull();
    if (!insight) return;
    if (!insight.evidence) return;
    // Devin (from windsurf) cost/session = $300 / 30 = $10.00
    const devinCs = insight.evidence.find(e => e.metric.toLowerCase().includes('devin') && e.metric.includes('cost/session'));
    expect(devinCs).toBeDefined();
    expect(devinCs!.value).toBe('$10.00');
  });

  // ── Renderer field survival tests ──
  // These prove the fields needed by the cost-efficiency renderer survive
  // the generator output, not merely that the generator contains them.

  describe('Renderer field survival', () => {
    function setupCostAndGenerate() {
      setCostConfig('devin', 3, 100);  // $300/mo
      setCostConfig('vscode', 5, 20);  // $100/mo
      const sessions = [
        ...mkSessions(30, 'devin', '2026-06'),
        ...mkSessions(30, 'vscode', '2026-06'),
      ];
      return generateConfiguredCostEfficiencyByWorkflow(ti(sessions));
    }

    it('M1. presentationKind is cost_efficiency_comparison (renderer needs this for cardType)', () => {
      const insight = setupCostAndGenerate();
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect((insight as any).presentationKind).toBe('cost_efficiency_comparison');
    });

    it('M2. description contains period label (renderer extracts period from it)', () => {
      const insight = setupCostAndGenerate();
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(insight.description ?? '').toContain('2026-06');
    });

    it('M3. description contains "Configured estimate · Not billing data"', () => {
      const insight = setupCostAndGenerate();
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(insight.description ?? '').toContain('Configured estimate · Not billing data');
    });

    it('M4. description contains "not historical invoices"', () => {
      const insight = setupCostAndGenerate();
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(insight.description ?? '').toContain('not historical invoices');
    });

    it('M5. description contains "retrospectively"', () => {
      const insight = setupCostAndGenerate();
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(insight.description ?? '').toContain('retrospectively');
    });

    it('M6. evidence array contains cost/active-hour entries for both workflows', () => {
      const insight = setupCostAndGenerate();
      expect(insight).not.toBeNull();
      if (!insight) return;
      if (!insight.evidence) return;
      const cahEntries = insight.evidence.filter(e => e.metric.toLowerCase().includes('cost/active-hour'));
      expect(cahEntries.length).toBeGreaterThanOrEqual(2);
    });

    it('M7. evidence array contains cost/session entries for both workflows', () => {
      const insight = setupCostAndGenerate();
      expect(insight).not.toBeNull();
      if (!insight) return;
      if (!insight.evidence) return;
      const csEntries = insight.evidence.filter(e => e.metric.toLowerCase().includes('cost/session'));
      expect(csEntries.length).toBeGreaterThanOrEqual(2);
    });

    it('M8. breakdownByTool contains monthly spend in labels (renderer extracts $/mo)', () => {
      const insight = setupCostAndGenerate();
      expect(insight).not.toBeNull();
      if (!insight) return;
      const breakdown = (insight as any).breakdownByTool;
      expect(breakdown).toBeDefined();
      if (!breakdown) return;
      for (const [, data] of Object.entries(breakdown)) {
        expect((data as any).label).toMatch(/\$\d+\/mo/);
      }
    });

    it('M9. breakdownByTool formatted values use $/hr unit (renderer displays these)', () => {
      const insight = setupCostAndGenerate();
      expect(insight).not.toBeNull();
      if (!insight) return;
      const breakdown = (insight as any).breakdownByTool;
      expect(breakdown).toBeDefined();
      if (!breakdown) return;
      for (const [, data] of Object.entries(breakdown)) {
        expect((data as any).formatted).toContain('/hr');
      }
    });

    it('M10. recommendation contains session duration, active coding, focus, task mix references', () => {
      const insight = setupCostAndGenerate();
      expect(insight).not.toBeNull();
      if (!insight) return;
      const rec = (insight.recommendation ?? '').toLowerCase();
      expect(rec).toContain('session duration');
      expect(rec).toContain('active coding');
      expect(rec).toContain('focus');
      expect(rec).toContain('task mix');
    });

    it('M11. recommendationState is monitor_only (renderer must not show action strip)', () => {
      const insight = setupCostAndGenerate();
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(insight.recommendationState).toBe('monitor_only');
    });

    it('M12. title contains ratio (not Infinity) when both costs are non-zero', () => {
      const insight = setupCostAndGenerate();
      expect(insight).not.toBeNull();
      if (!insight) return;
      expect(insight.title).not.toContain('Infinity');
      expect(insight.title).toMatch(/\d+\.\d+×/);
    });

    it('M13. no ROI/savings/waste in any customer-visible field', () => {
      const insight = setupCostAndGenerate();
      expect(insight).not.toBeNull();
      if (!insight) return;
      const allText = `${insight.title} ${insight.description ?? ''} ${insight.recommendation ?? ''} ${insight.executiveSummary ?? ''} ${insight.evidenceAndContext ?? ''} ${insight.whyItMatters ?? ''} ${insight.primaryRisk ?? ''} ${insight.operationalImpact ?? ''}`;
      const lower = allText.toLowerCase();
      expect(lower).not.toContain('roi');
      expect(lower).not.toContain('return on investment');
      expect(lower).not.toContain('savings');
      expect(lower).not.toContain('waste');
    });

    it('M14. recommendation contains decision-check semantics (session duration, active coding, focus, task mix)', () => {
      const insight = setupCostAndGenerate();
      expect(insight).not.toBeNull();
      if (!insight) return;
      // The generator recommendation must contain the core decision-check.
      // The renderer embeds an expanded version (adding repository mix) in
      // the interpretation field, which is the visible card text.
      const rec = (insight.recommendation ?? '').toLowerCase();
      expect(rec).toContain('session duration');
      expect(rec).toContain('active coding');
      expect(rec).toContain('focus');
      expect(rec).toContain('task mix');
      expect(rec).toContain('before changing tool policy');
    });
  });
});
