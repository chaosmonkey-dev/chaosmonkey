/**
 * Focused eligibility-gate test for:
 * - active-coding-time-by-ide
 * - workflow-quality-correlation
 * - session-quality-merge-success
 *
 * Verifies that PI never compares workflows using active-coding or
 * session-quality values when either workflow has no eligible measured
 * samples. Zero/null/missing must not be coerced into a numeric claim,
 * and duration_ms must never be used as an active-coding fallback proxy.
 *
 * Quality cohort source of truth: session_quality_score (finite number),
 * NOT session_quality_band. High = score >= 80, low = score < 60.
 *
 * Run with: ./node_modules/.bin/tsx src/lib/insights/final/generators/planCode.eligibility.test.ts
 */

import {
  generateActiveCodingTimeByIDE,
  generateWorkflowQualityCorrelation,
  generateSessionQualityMergeSuccess,
  generateSessionConditionedPRCycleTimeAIVsNonAI
} from './planCode';
import type { CanonicalInsightInput } from '../types';

let failures = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    failures++;
    console.error(`[FAIL] ${message}`);
  } else {
    console.log(`[PASS] ${message}`);
  }
}

// Fixture 1: Claude Code has 6 sessions with active_coding_duration_ms = 0
// (unmeasured) but positive duration_ms, and session_quality_score = null.
// VS Code has 6 sessions with positive active_coding_duration_ms and
// session_quality_score = null.
function buildNullQualityFixture(): any[] {
  const claudeCodeSessions = Array.from({ length: 6 }, (_, i) => ({
    tool: 'claude_code',
    session_id: `cc-${i}`,
    session_duration_minutes: 140,
    session_active_coding_duration_minutes: 0,
    active_coding_duration_ms: 0,
    session_quality_score: null,
    session_has_ai_activity: true,
    time_to_first_commit_ms: 2_100_000
  }));

  const vscodeSessions = Array.from({ length: 6 }, (_, i) => ({
    tool: 'vscode',
    session_id: `vs-${i}`,
    session_duration_minutes: 14,
    session_active_coding_duration_minutes: 4.26,
    active_coding_duration_ms: 255875,
    session_quality_score: null,
    session_has_ai_activity: false,
    time_to_first_commit_ms: 2_700_000
  }));

  return [...claudeCodeSessions, ...vscodeSessions];
}

// Fixture 2: exactly 6 high-quality sessions (score >= 80), zero low-quality.
// No session_quality_band fields — score is the sole source of truth.
// Must return needs_more_data because low cohort = 0 < 5.
function buildHighQualityOnlyFixture(): any[] {
  return Array.from({ length: 6 }, (_, i) => ({
    tool: i % 2 === 0 ? 'vscode' : 'claude_code',
    session_id: `hq-${i}`,
    session_duration_minutes: 20,
    session_active_coding_duration_minutes: 5,
    active_coding_duration_ms: 300000,
    session_quality_score: 85,
    session_has_ai_activity: true,
    time_to_first_commit_ms: 1_800_000
  }));
}

// Fixture 3: valid two-cohort fixture with 6 high-quality (score >= 80) and
// 6 low-quality (score < 60). No session_quality_band fields.
// Must return hasData=true with a numeric comparison.
function buildValidTwoCohortFixture(): any[] {
  const highSessions = Array.from({ length: 6 }, (_, i) => ({
    tool: 'vscode',
    session_id: `vh-${i}`,
    session_duration_minutes: 20,
    session_active_coding_duration_minutes: 5,
    active_coding_duration_ms: 300000,
    session_quality_score: 85,
    session_has_ai_activity: true,
    time_to_first_commit_ms: 1_800_000
  }));

  const lowSessions = Array.from({ length: 6 }, (_, i) => ({
    tool: 'claude_code',
    session_id: `vl-${i}`,
    session_duration_minutes: 30,
    session_active_coding_duration_minutes: 3,
    active_coding_duration_ms: 180000,
    session_quality_score: 45,
    session_has_ai_activity: false,
    time_to_first_commit_ms: 3_600_000
  }));

  // Add 18 filler sessions to exceed totalSessions >= 30 guard
  const filler = Array.from({ length: 18 }, (_, i) => ({
    tool: 'cursor',
    session_id: `vf-${i}`,
    session_duration_minutes: 15,
    session_active_coding_duration_minutes: 4,
    active_coding_duration_ms: 240000,
    session_quality_score: 70,
    session_has_ai_activity: true,
    time_to_first_commit_ms: 2_000_000
  }));

  return [...highSessions, ...lowSessions, ...filler];
}

// Fixture 4: contradictory-metadata case. Score = 85 but band = 'low'.
// Must count as high-quality (score >= 80), not low.
function buildContradictoryBandFixture(): any[] {
  const contradictory = Array.from({ length: 6 }, (_, i) => ({
    tool: 'vscode',
    session_id: `cb-h-${i}`,
    session_duration_minutes: 20,
    session_active_coding_duration_minutes: 5,
    active_coding_duration_ms: 300000,
    session_quality_score: 85,
    session_quality_band: 'low',
    session_has_ai_activity: true,
    time_to_first_commit_ms: 1_800_000
  }));

  const lowSessions = Array.from({ length: 6 }, (_, i) => ({
    tool: 'claude_code',
    session_id: `cb-l-${i}`,
    session_duration_minutes: 30,
    session_active_coding_duration_minutes: 3,
    active_coding_duration_ms: 180000,
    session_quality_score: 40,
    session_quality_band: 'high',
    session_has_ai_activity: false,
    time_to_first_commit_ms: 3_600_000
  }));

  // Add 18 filler to exceed totalSessions >= 30
  const filler = Array.from({ length: 18 }, (_, i) => ({
    tool: 'cursor',
    session_id: `cb-f-${i}`,
    session_duration_minutes: 15,
    session_active_coding_duration_minutes: 4,
    active_coding_duration_ms: 240000,
    session_quality_score: 70,
    session_has_ai_activity: true,
    time_to_first_commit_ms: 2_000_000
  }));

  return [...contradictory, ...lowSessions, ...filler];
}

function makeInput(rows: any[]): CanonicalInsightInput {
  return {
    sessionRows: rows,
    githubSnapshot: {},
    githubByPeriod: [],
    productivityByPeriod: [],
    granularity: 'week'
  } as any;
}

function checkForbiddenStrings(text: string, label: string) {
  assert(!text.includes('136 min'), `${label}: no "136 min" in output`);
  assert(!text.includes('140 min'), `${label}: no "140 min" in output`);
  assert(!text.includes('0/100'), `${label}: no "0/100" in output`);
  assert(!text.includes('100% vs 0%'), `${label}: no "100% vs 0%" in output`);
  assert(!text.includes('0% vs 100%'), `${label}: no "0% vs 100%" in output`);
}

function run() {
  // ===== Fixture 1: all-null quality scores =====
  const rows1 = buildNullQualityFixture();
  const input1 = makeInput(rows1);

  // --- active-coding-time-by-ide ---
  const activeCoding = generateActiveCodingTimeByIDE(input1);
  assert(activeCoding !== null, 'F1 active-coding: returns diagnostic insight, not null');
  if (activeCoding) {
    assert(
      activeCoding.comparisonState === 'needs_more_data' || activeCoding.hasData === false,
      'F1 active-coding: uses needs-more-data semantics'
    );
    const text = `${activeCoding.title} ${activeCoding.description ?? ''} ${activeCoding.rightMetric ?? ''} ${activeCoding.evidenceAndContext ?? ''}`;
    assert(
      !/claude.?code.*\d+\s*min/i.test(text),
      'F1 active-coding: no numeric minutes/session value for Claude Code'
    );
    assert(
      !text.includes('140') && !text.includes('136'),
      'F1 active-coding: duration_ms does not leak as active-coding fallback'
    );
    assert(
      text.includes('claude_code=0'),
      'F1 active-coding: Claude Code recognized with zero eligible count in evidence'
    );
    checkForbiddenStrings(text, 'F1 active-coding');
  }

  // --- workflow-quality-correlation ---
  const qualityCorrelation = generateWorkflowQualityCorrelation(input1);
  assert(qualityCorrelation !== null, 'F1 workflow-quality: returns diagnostic insight, not null');
  if (qualityCorrelation) {
    assert(
      qualityCorrelation.comparisonState === 'needs_more_data' || qualityCorrelation.hasData === false,
      'F1 workflow-quality: uses needs-more-data semantics'
    );
    const text = `${qualityCorrelation.title} ${qualityCorrelation.description ?? ''}`;
    assert(!text.includes('0/100'), 'F1 workflow-quality: no 0/100 claim');
    assert(!/vscode\s+\d+\/100/i.test(text), 'F1 workflow-quality: no numeric VS Code score');
    checkForbiddenStrings(text, 'F1 workflow-quality');
  }

  // --- session-quality-merge-success ---
  const mergeSuccess = generateSessionQualityMergeSuccess(input1);
  assert(mergeSuccess !== null, 'F1 session-quality-merge: returns diagnostic insight, not null');
  if (mergeSuccess) {
    assert(
      mergeSuccess.comparisonState === 'needs_more_data' || mergeSuccess.hasData === false,
      'F1 session-quality-merge: uses needs-more-data semantics'
    );
    assert(mergeSuccess.rightMetric === '—', 'F1 session-quality-merge: rightMetric is dash');
    assert(mergeSuccess.hasData === false, 'F1 session-quality-merge: hasData is false');
    const text = `${mergeSuccess.title} ${mergeSuccess.description ?? ''}`;
    assert(!text.includes('0%'), 'F1 session-quality-merge: no false 0% split');
    checkForbiddenStrings(text, 'F1 session-quality-merge');
  }

  // ===== Fixture 2: 6 high-quality, 0 low-quality (no band fields) =====
  const rows2 = buildHighQualityOnlyFixture();
  const input2 = makeInput(rows2);

  const mergeSuccess2 = generateSessionQualityMergeSuccess(input2);
  assert(mergeSuccess2 !== null, 'F2 session-quality-merge: returns diagnostic insight, not null');
  if (mergeSuccess2) {
    assert(
      mergeSuccess2.comparisonState === 'needs_more_data' || mergeSuccess2.hasData === false,
      'F2 session-quality-merge: uses needs-more-data semantics (low cohort = 0 < 5)'
    );
    assert(mergeSuccess2.rightMetric === '—', 'F2 session-quality-merge: rightMetric is dash');
    assert(mergeSuccess2.hasData === false, 'F2 session-quality-merge: hasData is false');
    const text = `${mergeSuccess2.title} ${mergeSuccess2.description ?? ''} ${mergeSuccess2.operationalBreadcrumbs?.join(' ') ?? ''}`;
    assert(!text.includes('100% vs 0%'), 'F2 session-quality-merge: no 100% vs 0%');
    assert(!text.includes('0% vs 100%'), 'F2 session-quality-merge: no 0% vs 100%');
    checkForbiddenStrings(text, 'F2 session-quality-merge');
  }

  // ===== Fixture 3: valid two-cohort (6 high, 6 low, no band fields) =====
  const rows3 = buildValidTwoCohortFixture();
  const input3 = makeInput(rows3);

  const mergeSuccess3 = generateSessionQualityMergeSuccess(input3);
  assert(mergeSuccess3 !== null, 'F3 session-quality-merge: returns an insight');
  if (mergeSuccess3) {
    assert(
      mergeSuccess3.hasData === true,
      'F3 session-quality-merge: hasData is true (both cohorts >= 5)'
    );
    assert(
      mergeSuccess3.comparisonState !== 'needs_more_data',
      'F3 session-quality-merge: not needs_more_data (valid cohorts present)'
    );
    assert(
      mergeSuccess3.rightMetric !== '—',
      'F3 session-quality-merge: rightMetric is numeric, not dash'
    );
    assert(
      typeof mergeSuccess3.current === 'number' && mergeSuccess3.current > 0,
      'F3 session-quality-merge: current is a positive number'
    );
    assert(
      typeof mergeSuccess3.baseline === 'number' && mergeSuccess3.baseline > 0,
      'F3 session-quality-merge: baseline is a positive number'
    );
  }

  // ===== Fixture 4: contradictory band (score=85, band='low') =====
  // Score is source of truth: must count as high, not low.
  const rows4 = buildContradictoryBandFixture();
  const input4 = makeInput(rows4);

  const mergeSuccess4 = generateSessionQualityMergeSuccess(input4);
  assert(mergeSuccess4 !== null, 'F4 session-quality-merge: returns an insight');
  if (mergeSuccess4) {
    assert(
      mergeSuccess4.hasData === true,
      'F4 session-quality-merge: hasData is true (contradictory band does not block — score is source of truth)'
    );
    assert(
      mergeSuccess4.comparisonState !== 'needs_more_data',
      'F4 session-quality-merge: not needs_more_data (score-based cohorts are valid)'
    );
    // The 6 sessions with score=85 must be in high cohort despite band='low'.
    // The 6 sessions with score=40 must be in low cohort despite band='high'.
    // So both cohorts have 6 each → valid comparison.
    assert(
      typeof mergeSuccess4.current === 'number' && mergeSuccess4.current > 0,
      'F4 session-quality-merge: current is positive (score=85 counted as high despite band=low)'
    );
    assert(
      typeof mergeSuccess4.baseline === 'number' && mergeSuccess4.baseline > 0,
      'F4 session-quality-merge: baseline is positive (score=40 counted as low despite band=high)'
    );
  }

  // ===== PR Cycle Time AI vs Non-AI: diagnostic title parity =====

  // Fixture 5: 30 sessions, 15 AI + 15 non-AI, but NO GitHub PR data
  // → hasLiveData=false → diagnostic title, no numeric gap
  function buildNoGitHubPRFixture(): any[] {
    const ai = Array.from({ length: 15 }, (_, i) => ({
      tool: 'vscode',
      session_id: `ai-${i}`,
      session_duration_minutes: 30,
      session_has_ai_activity: true,
      time_to_first_commit_ms: 1_800_000
    }));
    const nonAi = Array.from({ length: 15 }, (_, i) => ({
      tool: 'vscode',
      session_id: `nai-${i}`,
      session_duration_minutes: 45,
      session_has_ai_activity: false,
      time_to_first_commit_ms: 2_700_000
    }));
    return [...ai, ...nonAi];
  }

  // Fixture 6: 30 sessions, 15 AI + 15 non-AI, WITH GitHub PR data
  // → hasLiveData=true → numeric comparison title
  function buildWithGitHubPRFixture(): any[] {
    const ai = Array.from({ length: 15 }, (_, i) => ({
      tool: 'vscode',
      session_id: `ai-${i}`,
      session_duration_minutes: 30,
      session_has_ai_activity: true,
      time_to_first_commit_ms: 1_800_000
    }));
    const nonAi = Array.from({ length: 15 }, (_, i) => ({
      tool: 'vscode',
      session_id: `nai-${i}`,
      session_duration_minutes: 45,
      session_has_ai_activity: false,
      time_to_first_commit_ms: 2_700_000
    }));
    return [...ai, ...nonAi];
  }

  function makeInputWithGithub(rows: any[]): CanonicalInsightInput {
    return {
      sessionRows: rows,
      githubSnapshot: { pr_review_metrics: { total_prs: 10 } },
      githubByPeriod: [],
      productivityByPeriod: [],
      granularity: 'week'
    } as any;
  }

  // --- Test 1: Missing GitHub PR data (both cohorts lack linkage) ---
  const rows5 = buildNoGitHubPRFixture();
  const input5 = makeInput(rows5);
  const prCycleNoGithub = generateSessionConditionedPRCycleTimeAIVsNonAI(input5);
  assert(prCycleNoGithub !== null, 'F5 pr-cycle: returns diagnostic insight, not null');
  if (prCycleNoGithub) {
    assert(
      prCycleNoGithub.comparisonState === 'needs_more_data',
      'F5 pr-cycle: comparisonState is needs_more_data'
    );
    assert(prCycleNoGithub.hasData === false, 'F5 pr-cycle: hasData is false');
    assert(prCycleNoGithub.rightMetric === '—', 'F5 pr-cycle: rightMetric is dash');
    const text = `${prCycleNoGithub.title} ${prCycleNoGithub.description ?? ''} ${prCycleNoGithub.whatChanged ?? ''} ${prCycleNoGithub.operationalImpact ?? ''} ${prCycleNoGithub.operationalRead ?? ''}`;
    assert(
      !/minutes?\s+(longer|faster)/i.test(text),
      'F5 pr-cycle: no "minutes longer" or "minutes faster" in any text'
    );
    assert(
      !/\d+\s*%/i.test(prCycleNoGithub.title),
      'F5 pr-cycle: no numeric percentage in title'
    );
    assert(
      text.includes('needs more data') || text.includes('—'),
      'F5 pr-cycle: diagnostic language present'
    );
    assert(
      prCycleNoGithub.recommendationState !== 'action_required',
      'F5 pr-cycle: not action_required (insufficient data)'
    );
    assert(
      prCycleNoGithub.demoNarrativePriority === undefined || prCycleNoGithub.demoNarrativePriority !== 80,
      'F5 pr-cycle: not promoted to top insights (demoNarrativePriority not set to 80)'
    );
  }

  // --- Test 2: With GitHub PR data (both cohorts eligible) ---
  const rows6 = buildWithGitHubPRFixture();
  const input6 = makeInputWithGithub(rows6);
  const prCycleWithGithub = generateSessionConditionedPRCycleTimeAIVsNonAI(input6);
  assert(prCycleWithGithub !== null, 'F6 pr-cycle: returns an insight');
  if (prCycleWithGithub) {
    assert(
      prCycleWithGithub.hasData === true,
      'F6 pr-cycle: hasData is true (both cohorts eligible)'
    );
    assert(
      prCycleWithGithub.comparisonState === 'ai_non_ai_comparable',
      'F6 pr-cycle: comparisonState is ai_non_ai_comparable'
    );
    assert(
      prCycleWithGithub.rightMetric !== '—',
      'F6 pr-cycle: rightMetric is numeric, not dash'
    );
    assert(
      typeof prCycleWithGithub.current === 'number' && prCycleWithGithub.current > 0,
      'F6 pr-cycle: current is a positive number'
    );
    assert(
      typeof prCycleWithGithub.baseline === 'number' && prCycleWithGithub.baseline > 0,
      'F6 pr-cycle: baseline is a positive number'
    );
    const titleText = prCycleWithGithub.title;
    assert(
      !titleText.includes('needs more data'),
      'F6 pr-cycle: title does not say "needs more data" (eligible)'
    );
  }

  // --- Test 3: No AI cohort (all non-AI sessions) ---
  // 30 non-AI sessions, 0 AI sessions → returns null (aiPRCount < 5 guard)
  const allNonAi = Array.from({ length: 30 }, (_, i) => ({
    tool: 'vscode',
    session_id: `nai-only-${i}`,
    session_duration_minutes: 45,
    session_has_ai_activity: false,
    time_to_first_commit_ms: 2_700_000
  }));
  const inputNoAi = makeInputWithGithub(allNonAi);
  const prCycleNoAi = generateSessionConditionedPRCycleTimeAIVsNonAI(inputNoAi);
  assert(
    prCycleNoAi === null,
    'F7 pr-cycle: returns null when AI cohort < 5 (no numeric claim possible)'
  );

  // --- Test 4: No non-AI cohort (all AI sessions) ---
  const allAi = Array.from({ length: 30 }, (_, i) => ({
    tool: 'vscode',
    session_id: `ai-only-${i}`,
    session_duration_minutes: 30,
    session_has_ai_activity: true,
    time_to_first_commit_ms: 1_800_000
  }));
  const inputNoNonAi = makeInputWithGithub(allAi);
  const prCycleNoNonAi = generateSessionConditionedPRCycleTimeAIVsNonAI(inputNoNonAi);
  assert(
    prCycleNoNonAi === null,
    'F8 pr-cycle: returns null when non-AI cohort < 5 (no numeric claim possible)'
  );

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  } else {
    console.log('\nAll eligibility-gate assertions passed.');
    process.exit(0);
  }
}

run();
