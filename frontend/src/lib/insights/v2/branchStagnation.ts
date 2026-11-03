/**
 * Branch Stagnation Risk - Exploratory Computation
 * 
 * This is exploratory code for computing branch stagnation risk.
 * DO NOT add to preview rows yet. Gate behind debug flag if surfaced anywhere.
 * 
 * Purpose: Identify long-lived branches that may indicate workflow stagnation.
 * 
 * Definition: % of sessions working on branches with many sessions over multiple periods.
 * 
 * Data Available:
 * - git_repo_url (nullable)
 * - git_branch (nullable)
 * - repoKey (computed: repoUrl::branch)
 * - timestamp (for period grouping)
 * - periodKey (YYYY-MM-DD format)
 * 
 * Limitations:
 * - No branch creation events (only current branch name)
 * - No branch age (only session count over time)
 * - Proxy: Branches with many sessions over multiple periods = "long-lived"
 */

import type { V2SessionPrimitiveRow } from './types';
import { toCanonicalPeriodKey } from '../engine/period';

export interface BranchStagnationResult {
  /** Percentage of sessions on long-lived branches (0-100) */
  stagnationRiskPct: number;
  /** Total sessions analyzed */
  totalSessions: number;
  /** Sessions on long-lived branches */
  sessionsOnLongLivedBranches: number;
  /** Breakdown by IDE (if stable) */
  breakdownByTool: Record<string, {
    stagnationRiskPct: number;
    sessionsOnLongLived: number;
    totalSessions: number;
  }>;
  /** Branch details (for debugging) */
  branchDetails: Array<{
    repoKey: string;
    sessionCount: number;
    periodCount: number;
    isLongLived: boolean;
  }>;
}

/**
 * Compute branch stagnation risk
 * 
 * @param sessionRows - Session rows with Git context
 * @param sessionCountThreshold - Minimum sessions to consider branch "long-lived" (default: 10)
 * @param periodCountThreshold - Minimum periods to consider branch "long-lived" (default: 2)
 * @returns Branch stagnation metrics
 */
export function computeBranchStagnationRisk(
  sessionRows: V2SessionPrimitiveRow[],
  sessionCountThreshold: number = 10,
  periodCountThreshold: number = 2
): BranchStagnationResult {
  const totalSessions = sessionRows.length;
  
  if (totalSessions === 0) {
    return {
      stagnationRiskPct: 0,
      totalSessions: 0,
      sessionsOnLongLivedBranches: 0,
      breakdownByTool: {},
      branchDetails: [],
    };
  }

  // Group sessions by repoKey (repo::branch)
  const sessionsByBranch = new Map<string, V2SessionPrimitiveRow[]>();
  for (const row of sessionRows) {
    if (!row.repoKey) continue; // Skip sessions without Git context
    
    const arr = sessionsByBranch.get(row.repoKey) || [];
    arr.push(row);
    sessionsByBranch.set(row.repoKey, arr);
  }

  // Compute branch metrics
  const branchDetails: Array<{
    repoKey: string;
    sessionCount: number;
    periodCount: number;
    isLongLived: boolean;
  }> = [];

  for (const [repoKey, sessions] of sessionsByBranch.entries()) {
    const sessionCount = sessions.length;
    
    // Count unique periods for this branch
    const periods = new Set<string>();
    for (const session of sessions) {
      // Use canonical period key for consistency
      const canonicalPeriod = toCanonicalPeriodKey(session.timestamp, 'week');
      if (canonicalPeriod) {
        periods.add(canonicalPeriod);
      }
    }
    const periodCount = periods.size;

    // Determine if branch is "long-lived"
    const isLongLived = sessionCount >= sessionCountThreshold || periodCount >= periodCountThreshold;

    branchDetails.push({
      repoKey,
      sessionCount,
      periodCount,
      isLongLived,
    });
  }

  // Count sessions on long-lived branches
  let sessionsOnLongLivedBranches = 0;
  for (const detail of branchDetails) {
    if (detail.isLongLived) {
      const branchSessions = sessionsByBranch.get(detail.repoKey) || [];
      sessionsOnLongLivedBranches += branchSessions.length;
    }
  }

  const stagnationRiskPct = totalSessions > 0
    ? (sessionsOnLongLivedBranches / totalSessions) * 100
    : 0;

  // Breakdown by IDE (if stable)
  const breakdownByTool: Record<string, {
    stagnationRiskPct: number;
    sessionsOnLongLived: number;
    totalSessions: number;
  }> = {};

  const sessionsByTool = new Map<string, V2SessionPrimitiveRow[]>();
  for (const row of sessionRows) {
    const tool = row.tool || 'unknown';
    const arr = sessionsByTool.get(tool) || [];
    arr.push(row);
    sessionsByTool.set(tool, arr);
  }

  for (const [tool, toolSessions] of sessionsByTool.entries()) {
    // Count sessions on long-lived branches for this tool
    let toolSessionsOnLongLived = 0;
    for (const session of toolSessions) {
      if (!session.repoKey) continue;
      
      const branchDetail = branchDetails.find(d => d.repoKey === session.repoKey);
      if (branchDetail?.isLongLived) {
        toolSessionsOnLongLived++;
      }
    }

    const toolTotalSessions = toolSessions.length;
    const toolStagnationRiskPct = toolTotalSessions > 0
      ? (toolSessionsOnLongLived / toolTotalSessions) * 100
      : 0;

    breakdownByTool[tool] = {
      stagnationRiskPct: toolStagnationRiskPct,
      sessionsOnLongLived: toolSessionsOnLongLived,
      totalSessions: toolTotalSessions,
    };
  }

  return {
    stagnationRiskPct,
    totalSessions,
    sessionsOnLongLivedBranches,
    breakdownByTool,
    branchDetails,
  };
}

