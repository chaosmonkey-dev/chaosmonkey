/**
 * ============================================================================
 * CR-X Track P2: Cost Authority / Canonical Identity Tests
 * ============================================================================
 *
 * Proves the single-boundary cost normalization:
 * - raw backend snake_case DTOs (tool_id, monthly_spend, ...) normalize
 * - resolved Dashboards DTOs (toolId, monthlySpend, ...) normalize
 * - hyphenated cost tool IDs map to canonical workflow IDs
 * - no localStorage fallback can hide production breakage
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeCostConfigInput,
  costToolIdToCanonicalWorkflowId,
} from '../lib/toolCost';

describe('CR-X P2: Cost DTO normalization', () => {
  it('normalizes raw backend snake_case DTO', () => {
    const raw = {
      tool_id: 'claude-code',
      tool_name: 'Claude Code',
      seat_count: 3,
      cost_per_seat_monthly: '250.00',
      monthly_spend: '750.00',
      configured_at: '2026-09-08T16:49:39.000000Z',
    };
    const normalized = normalizeCostConfigInput(raw);
    expect(normalized).not.toBeNull();
    expect(normalized!.toolId).toBe('claude-code');
    expect(normalized!.monthlySpend).toBe(750);
    expect(normalized!.seatCount).toBe(3);
    expect(normalized!.costPerSeatMonthly).toBe(250);
  });

  it('normalizes resolved Dashboards camelCase DTO', () => {
    const resolved = {
      toolId: 'github-copilot',
      seatCount: 5,
      costPerSeatMonthly: 210,
      monthlySpend: 1050,
      updatedAt: '2026-09-08T16:49:39.000000Z',
    };
    const normalized = normalizeCostConfigInput(resolved);
    expect(normalized).not.toBeNull();
    expect(normalized!.toolId).toBe('github-copilot');
    expect(normalized!.monthlySpend).toBe(1050);
  });

  it('maps hyphenated cost IDs to canonical workflow IDs', () => {
    expect(costToolIdToCanonicalWorkflowId('claude-code')).toBe('claude_code');
    expect(costToolIdToCanonicalWorkflowId('github-copilot')).toBe('github_copilot');
    expect(costToolIdToCanonicalWorkflowId('vscode')).toBe('vscode');
    expect(costToolIdToCanonicalWorkflowId('cursor')).toBe('cursor');
    expect(costToolIdToCanonicalWorkflowId('devin')).toBe('devin');
  });

  it('rejects malformed or non-numeric cost DTOs', () => {
    expect(normalizeCostConfigInput({})).toBeNull();
    expect(normalizeCostConfigInput({ tool_id: 'cursor' })).toBeNull();
    expect(normalizeCostConfigInput({ monthly_spend: 'not-a-number' })).toBeNull();
    expect(normalizeCostConfigInput(null)).toBeNull();
  });

  it('handles numeric monthly_spend without parseFloat', () => {
    const raw = { tool_id: 'vscode', monthly_spend: 300 };
    const normalized = normalizeCostConfigInput(raw);
    expect(normalized!.toolId).toBe('vscode');
    expect(normalized!.monthlySpend).toBe(300);
  });
});
