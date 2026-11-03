/**
 * Format Helpers for Performance Insights
 * 
 * Centralized formatting functions to ensure consistent, production-grade
 * numeric display across all 14 canonical PIs.
 */

/**
 * Format a percentage with consistent precision and intelligent rounding
 * Prevents excessive precision rendering (e.g., 68.39999999999999)
 * @param value - The percentage value (e.g., 0.123 for 12.3%)
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string (e.g., "12.3%")
 */
export function formatPct(value: number, decimals: number = 1): string {
  const rounded = Math.round(value * Math.pow(10, decimals + 2)) / Math.pow(10, decimals + 2);
  return `${rounded.toFixed(decimals)}%`;
}

/**
 * Format a rate (commits per session, etc.) with intelligent rounding
 * Prevents excessive precision rendering
 * @param value - The rate value
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted rate string (e.g., "3.2")
 */
export function formatRate(value: number, decimals: number = 1): string {
  const rounded = Math.round(value * Math.pow(10, decimals + 2)) / Math.pow(10, decimals + 2);
  return rounded.toFixed(decimals);
}

/**
 * Format hours with consistent precision and intelligent rounding
 * Prevents excessive precision rendering
 * @param value - The hours value
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted hours string (e.g., "4.5h")
 */
export function formatHours(value: number, decimals: number = 1): string {
  const rounded = Math.round(value * Math.pow(10, decimals + 2)) / Math.pow(10, decimals + 2);
  return `${rounded.toFixed(decimals)}h`;
}

/**
 * Format days with consistent precision and intelligent rounding
 * Prevents excessive precision rendering
 * @param value - The days value
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted days string (e.g., "2.3 days")
 */
export function formatDays(value: number, decimals: number = 1): string {
  const rounded = Math.round(value * Math.pow(10, decimals + 2)) / Math.pow(10, decimals + 2);
  return `${rounded.toFixed(decimals)} days`;
}

/**
 * Format a delta (change) with direction indicator and intelligent rounding
 * Prevents excessive precision rendering
 * @param value - The delta value
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted delta string (e.g., "+12.3%" or "-5.2%")
 */
export function formatDelta(value: number, decimals: number = 1): string {
  const rounded = Math.round(value * Math.pow(10, decimals + 2)) / Math.pow(10, decimals + 2);
  const sign = rounded >= 0 ? '+' : '';
  return `${sign}${rounded.toFixed(decimals)}%`;
}

/**
 * Format a tool comparison (IDE vs IDE)
 * @param tool1 - First tool name
 * @param value1 - First tool value
 * @param tool2 - Second tool name
 * @param value2 - Second tool value
 * @param unit - Unit of measurement
 * @returns Formatted comparison string
 */
export function formatToolComparison(
  tool1: string,
  value1: number,
  tool2: string,
  value2: number,
  unit: string
): string {
  return `${tool1}: ${value1.toFixed(1)}${unit}, ${tool2}: ${value2.toFixed(1)}${unit}`;
}

/**
 * Format minutes with consistent precision and intelligent rounding
 * Prevents excessive precision rendering
 * @param value - The minutes value
 * @param decimals - Number of decimal places (default: 0)
 * @returns Formatted minutes string (e.g., "158 min")
 */
export function formatMinutes(value: number, decimals: number = 0): string {
  const rounded = Math.round(value * Math.pow(10, decimals + 2)) / Math.pow(10, decimals + 2);
  return `${rounded.toFixed(decimals)} min`;
}

/**
 * Format a count with commas for large numbers
 * @param value - The count value
 * @returns Formatted count string (e.g., "1,234")
 */
export function formatCount(value: number): string {
  return value.toLocaleString();
}

/**
 * Format a frequency (deployments per week, etc.)
 * @param value - The frequency value
 * @param unit - Unit (default: "/week")
 * @returns Formatted frequency string (e.g., "12/week")
 */
export function formatFrequency(value: number, unit: string = '/week'): string {
  // Round to 1 decimal max to prevent raw floats like 161.3953488372093
  const rounded = Math.round(value * 10) / 10;
  // Ensure we don't have excessive precision
  const formatted = rounded.toFixed(1);
  return `${formatted}${unit}`;
}

/**
 * Format a concentration metric with context
 * Prevents naked integer exposure for concentration scores
 * @param value - The concentration value (0-100)
 * @param context - Context description (e.g., "reviewer", "deployment")
 * @param topCount - Number of top entities (default: 3)
 * @returns Formatted concentration string with context
 */
export function formatConcentration(value: number, context: string = 'reviewer', topCount: number = 3): string {
  const rounded = Math.round(value * 10) / 10;
  return `Top ${topCount} ${context}s handled ${rounded}%`;
}

/**
 * Format a failure rate with proper percentage and context
 * @param value - The failure rate (0-100)
 * @returns Formatted failure rate string
 */
export function formatFailureRate(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}% failure rate`;
}

/**
 * Format a deployment cadence with proper units
 * @param value - The deployment frequency
 * @param period - Time period (default: "week")
 * @returns Formatted deployment cadence string
 */
export function formatDeploymentCadence(value: number, period: string = 'week'): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} deployments/${period}`;
}

/**
 * Format a ratio as a percentage
 * @param value - The ratio value (0-1)
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string
 */
export function formatRatioAsPct(value: number, decimals: number = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Convert any model/tool identifier to user-facing IDE/tool label
 * 
 * This is the single source of truth for all user-facing Performance Insights labels.
 * Ensures consistent tool/editor naming and eliminates unsupported model attribution.
 * 
 * MAPPING RULES:
 * - cursor / Claude Sonnet 4.6 / claude-sonnet-4.6 -> Cursor
 * - windsurf / SWE-1.6 / swe-1.6 -> Windsurf
 * - vscode / VS Code / GPT-5 Coding / gpt-5-coding -> VS Code
 * - claude_code / Claude Code -> Claude Code
 * - github_copilot / GitHub Copilot -> GitHub Copilot
 * 
 * @param value - Any tool/model identifier (internal ID, canonical name, or raw label)
 * @returns User-facing IDE/tool label
 */
export function toPilotToolLabel(value: string): string {
  if (!value || typeof value !== 'string') {
    return value;
  }

  const normalized = value.toLowerCase().trim();

  // Cursor mappings
  if (normalized === 'cursor' || 
      normalized === 'claude-sonnet-4.6' || 
      normalized === 'claude sonnet 4.6' ||
      normalized === 'claude' ||
      normalized === 'sonnet') {
    return 'Cursor';
  }

  // Windsurf mappings
  if (normalized === 'windsurf' || 
      normalized === 'swe-1.6' || 
      normalized === 'swe-1.6' ||
      normalized === 'swe') {
    return 'Windsurf';
  }

  // VS Code mappings
  if (normalized === 'vscode' || 
      normalized === 'vs code' || 
      normalized === 'gpt-5-coding' ||
      normalized === 'gpt-5 coding' ||
      normalized === 'gpt-5' ||
      normalized === 'gpt5') {
    return 'VS Code';
  }

  // Claude Code mappings
  if (normalized === 'claude_code' || 
      normalized === 'claude code' ||
      normalized === 'claude-code') {
    return 'Claude Code';
  }

  // Codex mappings (canonical workflow id is 'codex')
  if (normalized === 'codex' ||
      normalized === 'codex cli' ||
      normalized === 'codex-cli' ||
      normalized === 'openai codex' ||
      normalized === 'openai-codex') {
    return 'Codex';
  }

  // GitHub Copilot mappings
  if (normalized === 'github_copilot' || 
      normalized === 'github copilot' ||
      normalized === 'copilot') {
    return 'GitHub Copilot';
  }

  // If no mapping found, return original value (capitalized)
  // This handles unknown tools gracefully
  return value.charAt(0).toUpperCase() + value.slice(1);
}
