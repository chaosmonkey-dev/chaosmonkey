/**
 * ============================================================================
 * CR-X Tranche 1B — Surface × Assistant × Time × Observability Contract
 * ============================================================================
 *
 * Canonical conceptual model for ChaosMonkey's time and workflow semantics.
 *
 * This contract exists because:
 * 1. "VS Code" is a SURFACE/editor, not an AI assistant. It may carry GitHub
 *    Copilot, but telemetry does not prove which assistant is active.
 * 2. Claude Code runs in a TERMINAL and cannot observe the same signals as the
 *    VS Code extension. Comparing them on unequal metrics is invalid.
 * 3. Additive runtime ≠ human wall-clock time. Three concurrent agents running
 *    for one hour = 3 agent-hours additive, 1 hour wall-clock, ≤1 hour human
 *    active time.
 * 4. ai_burst_count=0 means zero OBSERVED AI signals, not "non-AI."
 * 5. Missing terminal instrumentation ≠ zero activity.
 *
 * BACKWARD COMPATIBILITY:
 * This module is additive. It does not modify existing workflow normalization
 * (workflowIdentity.ts) or PBT/PI computation. It provides a capability
 * lookup that PI/PBT MAY consult to suppress invalid cross-surface comparisons.
 *
 * DO NOT classify all VS Code telemetry as GitHub Copilot. That is a
 * hypothesis for customer validation, not source authority.
 * ============================================================================
 */

// ── SURFACE ──────────────────────────────────────────────────────────────────

/**
 * The editor/shell where the developer is working.
 * Derived from: editor_source, source, appName, uriScheme.
 */
export type Surface =
  | 'vscode'    // VS Code editor (may carry Copilot, Cursor extension, etc.)
  | 'cursor'    // Cursor editor
  | 'terminal'  // Terminal-based agent (Claude Code, etc.)
  | 'jetbrains' // JetBrains IDEs
  | 'sublime'   // Sublime Text
  | 'vim'       // Vim/Neovim
  | 'other'     // Unknown/unclassified surface
  | 'unknown';  // No surface signal available

// ── ASSISTANT / AGENT ────────────────────────────────────────────────────────

/**
 * The AI assistant/agent operating on a surface.
 *
 * IMPORTANT: This is NOT the same as the surface. VS Code (surface) may have
 * GitHub Copilot (assistant) running inside it. Claude Code (assistant) runs
 * in a terminal (surface).
 *
 * "unknown_none_observed" means no AI assistant signal was detected. It does
 * NOT mean "no AI was used" — the telemetry simply cannot prove which
 * assistant was active.
 */
export type Assistant =
  | 'github_copilot'
  | 'claude_code'
  | 'devin'
  | 'cursor_ai'
  | 'codex'
  | 'unknown_none_observed'
  | 'future_provider';

// ── OPERATIONAL MODE ─────────────────────────────────────────────────────────

/**
 * CR-X P1B.2 S1 — How the developer interacts with the workflow.
 *
 * This is INDEPENDENT of surface (where code runs) and assistant (what
 * produces the coding). It classifies the OPERATIONAL relationship:
 *
 * - human_interactive: Developer actively codes with AI assistance inline.
 *   The IDE/editor observes human keystroke/cursor activity. Active coding
 *   time, focus ratio, and file saves are meaningful headline metrics.
 *   Examples: VS Code, Cursor, GitHub Copilot.
 *
 * - delegated_agent: Agent operates autonomously; developer reviews/steers.
 *   Active coding time is NOT a human-coding metric (it measures editor-window
 *   focus during agent operation, not human coding). Session runtime is the
 *   correct headline time metric. Examples: Devin, Claude Code.
 *
 * RULE: Never display "active coding/session" or "focus ratio" as a headline
 * metric for a delegated_agent workflow. Use "session runtime/session" or
 * "observed agent-session elapsed time" instead.
 * RULE: Cross-mode comparison is valid for normalized dimensions
 * (cost/session, repo distribution, adoption, delivery with authoritative
 * attribution) but NOT for human-active-coding vs agent-runtime.
 *
 * DO NOT collapse: surface == operational mode, or tool == assistant/model.
 * A delegated agent may run on a vscode surface (Devin) or a terminal surface
 * (Claude Code). The surface determines observability; the operational mode
 * determines metric semantics.
 */
export type OperationalMode = 'human_interactive' | 'delegated_agent' | 'unknown';

/**
 * CR-X FINAL (binding edit 4): Central workflow capability registry.
 *
 * ONE authority for workflow identity + operational mode. Adding a new
 * workflow (e.g. Codex) = ONE entry here. resolveOperationalMode consults
 * this registry; unknown tools return 'unknown' (fail-closed), NOT
 * 'human_interactive'.
 *
 * IMPORTANT (binding edit 1): This registry does NOT own the actual
 * session SURFACE. Surface always comes from observed telemetry
 * (editor_source, source, appName, uriScheme). `supportedSurfaces` is
 * descriptive capability metadata only — it documents which surfaces
 * a workflow MAY run on, but never infers the actual session surface.
 */
export interface WorkflowCapability {
  canonicalId: string;
  displayName: string;
  operationalMode: OperationalMode;
  aliases: string[];
  /** Descriptive only — actual surface comes from telemetry. */
  supportedSurfaces?: Surface[];
}

export const WORKFLOW_CAPABILITY_REGISTRY: WorkflowCapability[] = [
  {
    canonicalId: 'vscode',
    displayName: 'VS Code',
    operationalMode: 'human_interactive',
    aliases: ['vs-code', 'visual studio code'],
    supportedSurfaces: ['vscode'],
  },
  {
    canonicalId: 'cursor',
    displayName: 'Cursor',
    operationalMode: 'human_interactive',
    aliases: [],
    supportedSurfaces: ['cursor'],
  },
  {
    canonicalId: 'github_copilot',
    displayName: 'GitHub Copilot',
    operationalMode: 'human_interactive',
    aliases: ['copilot', 'github-copilot'],
    supportedSurfaces: ['vscode'],
  },
  {
    canonicalId: 'jetbrains',
    displayName: 'JetBrains',
    operationalMode: 'human_interactive',
    aliases: ['intellij'],
    supportedSurfaces: ['jetbrains'],
  },
  {
    canonicalId: 'sublime',
    displayName: 'Sublime',
    operationalMode: 'human_interactive',
    aliases: [],
    supportedSurfaces: ['sublime'],
  },
  {
    canonicalId: 'vim',
    displayName: 'Vim',
    operationalMode: 'human_interactive',
    aliases: [],
    supportedSurfaces: ['vim'],
  },
  {
    canonicalId: 'devin',
    displayName: 'Devin',
    operationalMode: 'delegated_agent',
    aliases: ['windsurf', 'devin-workflow'],
    supportedSurfaces: ['vscode', 'terminal'],
  },
  {
    canonicalId: 'claude_code',
    displayName: 'Claude Code',
    operationalMode: 'delegated_agent',
    aliases: ['claude-code', 'claude-code-workflow'],
    supportedSurfaces: ['terminal', 'vscode'],
  },
  // Codex: terminal-surface delegated agent. The Codex bridge
  // (extensions/codex-bridge) emits source='codex' aggregate lifecycle
  // telemetry only — no editor activity, no git observation, no token usage
  // (token_usage_status: 'unavailable_lifecycle_hooks'). Per-workflow metric
  // exclusions below encode that narrower instrumentation contract.
  {
    canonicalId: 'codex',
    displayName: 'Codex',
    operationalMode: 'delegated_agent',
    aliases: ['codex-cli', 'openai-codex', 'codex_cli'],
    supportedSurfaces: ['terminal'],
  },
];

// Reverse lookup: alias → capability entry
const ALIAS_TO_CAPABILITY: Record<string, WorkflowCapability> = {};
for (const cap of WORKFLOW_CAPABILITY_REGISTRY) {
  ALIAS_TO_CAPABILITY[cap.canonicalId] = cap;
  for (const alias of cap.aliases) {
    ALIAS_TO_CAPABILITY[alias] = cap;
  }
}

/**
 * Map a canonical tool/workflow ID to its operational mode.
 *
 * CR-X FINAL (binding edit 4): Consults the central workflow capability
 * registry. Unknown tools return 'unknown' (fail-closed), NOT
 * 'human_interactive'. Mode-sensitive generators must gate on the
 * positive classification — unknown workflows get only mode-neutral
 * intelligence (cost/session, repo distribution, adoption), never
 * active-coding or runtime headlines.
 */
export function resolveOperationalMode(toolId: string | null | undefined): OperationalMode {
  if (!toolId) return 'unknown'; // fail-closed: no signal = unknown
  const id = String(toolId).toLowerCase().trim();
  const cap = ALIAS_TO_CAPABILITY[id];
  if (cap) return cap.operationalMode;
  return 'unknown'; // fail-closed: unrecognized = unknown
}

/**
 * Check if a workflow's operational mode supports human-active-coding
 * semantics (active_coding_duration_ms, focus_ratio, file_save_count as
 * headline metrics).
 */
export function isHumanInteractiveWorkflow(toolId: string | null | undefined): boolean {
  return resolveOperationalMode(toolId) === 'human_interactive';
}

/**
 * Check if a workflow's operational mode uses agent-runtime semantics
 * (session runtime as the headline time metric, NOT human active coding).
 */
export function isDelegatedAgentWorkflow(toolId: string | null | undefined): boolean {
  return resolveOperationalMode(toolId) === 'delegated_agent';
}

/**
 * Get the correct headline time metric label for a workflow's operational mode.
 *
 * human_interactive: "Active coding/session"
 * delegated_agent:   "Session runtime/session" (NEVER "human active coding")
 */
export function getHeadlineTimeMetricLabel(toolId: string | null | undefined): string {
  const mode = resolveOperationalMode(toolId);
  if (mode === 'delegated_agent') return 'Session runtime/session';
  if (mode === 'human_interactive') return 'Active coding/session';
  return 'Session time'; // unknown: neutral, no mode-specific assumption
}

/**
 * Get the correct cost-per-hour label for a workflow's operational mode.
 *
 * human_interactive: "Configured cost/active hour"
 * delegated_agent:   "Configured cost/runtime hour"
 */
export function getCostPerHourLabel(toolId: string | null | undefined): string {
  const mode = resolveOperationalMode(toolId);
  if (mode === 'delegated_agent') return 'Configured cost/runtime hour';
  if (mode === 'human_interactive') return 'Configured cost/active hour';
  return 'Configured cost/session'; // unknown: neutral
}

// ── TIME SEMANTICS ───────────────────────────────────────────────────────────

/**
 * Distinct time semantics that must not be conflated.
 *
 * - elapsed_session_time: duration_ms — wall-clock from session start to end
 * - human_active_coding_time: active_coding_duration_ms — observed on VS Code,
 *   NULL on Claude Code bridge (terminal cannot observe this)
 * - agent_runtime: same as elapsed_session_time for agent sessions
 * - additive_agent_runtime: Σ(duration_ms) across sessions — row-additive
 * - unique_wall_clock: UNION of session intervals — overlap-corrected
 * - overlap_time: time where ≥2 sessions overlap
 * - concurrency: max simultaneous sessions/agents
 *
 * RULE: Never label additive_agent_runtime as "human coding time."
 * RULE: Never label unique_wall_clock as "developer active time."
 * RULE: Cost denominators must explicitly state their time basis.
 */
export type TimeSemantic =
  | 'elapsed_session_time'
  | 'human_active_coding_time'
  | 'agent_runtime'
  | 'additive_agent_runtime'
  | 'unique_wall_clock'
  | 'overlap_time'
  | 'concurrency';

// ── OBSERVABILITY ────────────────────────────────────────────────────────────

/**
 * What can be measured on a given surface.
 *
 * - directly_observed: The instrumentation captures this field.
 * - inferred_derived: Computed from other observed fields.
 * - unavailable: The instrumentation cannot observe this on this surface.
 *
 * RULE: "unavailable" ≠ "zero." Missing terminal instrumentation does not
 * mean zero activity. It means we cannot measure it.
 */
export type Observability = 'directly_observed' | 'inferred_derived' | 'unavailable';

// ── MEASUREMENT SEMANTICS ────────────────────────────────────────────────────

/**
 * How a metric is measured on a given surface.
 *
 * A metric can be observed on two surfaces but measured differently.
 * Example: ai_burst_count is directly_observed on both vscode and terminal,
 * but VS Code uses a heuristic (large block insert detection) while
 * Claude Code counts all agent-authored edits. These are not
 * apples-to-apples for direct cross-surface productivity comparison.
 *
 * - editor_activity_heuristic: VS Code extension detects suspicious text
 *   insertions (>15 chars + newlines) via aiHeuristics.ts
 * - agent_authored_known: Claude Code bridge knows all edits are AI-authored
 * - activity_timer: VS Code tracks active coding via window/focus state
 * - session_elapsed: duration_ms from session start to end
 * - commit_observed: directly counted from git operations
 * - file_edit_counted: directly counted from editor events
 * - derived_ratio: computed from two observed values (e.g., active/total)
 * - not_measured: no measurement basis (equivalent to unavailable)
 */
export type MeasurementSemantic =
  | 'editor_activity_heuristic'
  | 'agent_authored_known'
  | 'activity_timer'
  | 'session_elapsed'
  | 'commit_observed'
  | 'file_edit_counted'
  | 'derived_ratio'
  | 'not_measured';

/**
 * Comparability level for a metric across surfaces.
 *
 * - A: AVAILABLE + SEMANTICALLY EQUIVALENT — safe for direct cross-surface comparison
 * - B: AVAILABLE + DIFFERENT MEASUREMENT SEMANTIC — may appear within-workflow
 *   but must NOT silently power a direct cross-surface productivity comparison
 * - C: UNAVAILABLE — not observed on this surface
 */
export type ComparabilityLevel = 'A' | 'B' | 'C';

// ── CAPABILITY MATRIX ────────────────────────────────────────────────────────

/**
 * Telemetry fields that may be surface-dependent.
 */
export interface SurfaceCapability {
  duration_ms: Observability;
  active_coding_duration_ms: Observability;
  ai_burst_count: Observability;
  ai_burst_chars_total: Observability;
  ai_suggestions_accepted: Observability;
  ai_usage_duration_ms: Observability;
  file_save_count: Observability;
  focus_ratio: Observability;
  idle_time_ms: Observability;
  flow_profile: Observability;
  debug_session_count: Observability;
  debug_time_ms: Observability;
  terminal_open_count: Observability;
  terminal_active_time_ms: Observability;
  session_commits: Observability;
  time_to_first_commit_ms: Observability;
  chars_added_total: Observability;
  chars_removed_total_est: Observability;
  lines_added_total: Observability;
  rework_ratio_est: Observability;
  language_id_counts: Observability;
}

/**
 * Capability matrix per surface.
 *
 * Evidence sources:
 * - VS Code extension (extensions/chaosmonkey-telemetry/src/extension.ts):
 *   directly observes active_coding_duration_ms, file_save_count, focus_ratio,
 *   idle_time_ms, flow_profile, debug_session_count, ai_burst_count (via
 *   heuristics in aiHeuristics.ts — large block inserts >15 chars with
 *   newlines). Does NOT observe session_commits (commit_count=0 on Ed).
 *
 * - Claude Code bridge (extensions/claude-code-bridge/bridge.js):
 *   directly observes ai_burst_count, ai_burst_chars_total, session_commits,
 *   time_to_first_commit_ms, chars_added_total, rework_ratio_est.
 *   NULL by contract: active_coding_duration_ms, file_save_count, focus_ratio,
 *   idle_time_ms, flow_profile, debug_session_count, terminal_*.
 *
 * - Other surfaces (cursor, jetbrains, etc.): not yet instrumented.
 */
export const SURFACE_CAPABILITY: Record<Surface, SurfaceCapability> = {
  vscode: {
    duration_ms: 'directly_observed',
    active_coding_duration_ms: 'directly_observed',
    ai_burst_count: 'directly_observed',
    ai_burst_chars_total: 'directly_observed',
    ai_suggestions_accepted: 'directly_observed',
    ai_usage_duration_ms: 'directly_observed',
    file_save_count: 'directly_observed',
    focus_ratio: 'directly_observed',
    idle_time_ms: 'directly_observed',
    flow_profile: 'directly_observed',
    debug_session_count: 'directly_observed',
    debug_time_ms: 'directly_observed',
    terminal_open_count: 'directly_observed',
    terminal_active_time_ms: 'directly_observed',
    session_commits: 'unavailable',
    time_to_first_commit_ms: 'directly_observed',
    chars_added_total: 'unavailable',
    chars_removed_total_est: 'unavailable',
    lines_added_total: 'unavailable',
    rework_ratio_est: 'unavailable',
    language_id_counts: 'unavailable',
  },
  cursor: {
    duration_ms: 'directly_observed',
    active_coding_duration_ms: 'directly_observed',
    ai_burst_count: 'directly_observed',
    ai_burst_chars_total: 'directly_observed',
    ai_suggestions_accepted: 'directly_observed',
    ai_usage_duration_ms: 'directly_observed',
    file_save_count: 'directly_observed',
    focus_ratio: 'directly_observed',
    idle_time_ms: 'directly_observed',
    flow_profile: 'directly_observed',
    debug_session_count: 'directly_observed',
    debug_time_ms: 'directly_observed',
    terminal_open_count: 'directly_observed',
    terminal_active_time_ms: 'directly_observed',
    session_commits: 'unavailable',
    time_to_first_commit_ms: 'directly_observed',
    chars_added_total: 'unavailable',
    chars_removed_total_est: 'unavailable',
    lines_added_total: 'unavailable',
    rework_ratio_est: 'unavailable',
    language_id_counts: 'unavailable',
  },
  terminal: {
    duration_ms: 'directly_observed',
    active_coding_duration_ms: 'unavailable',
    ai_burst_count: 'directly_observed',
    ai_burst_chars_total: 'directly_observed',
    // CR-X PI/PBT-TIME P0: The canonical aggregated endpoint returns finite
    // observed ai_suggestions_accepted values for Claude Code sessions
    // (e.g. period 2026-34: 6, period 2026-33: 4). AIOI and PBT must show
    // the same metric under the same scope when eligible. Only metrics that
    // genuinely depend on unavailable terminal observability
    // (active-coding/focus/idle) remain unavailable.
    ai_suggestions_accepted: 'directly_observed',
    ai_usage_duration_ms: 'directly_observed',
    file_save_count: 'unavailable',
    focus_ratio: 'unavailable',
    idle_time_ms: 'unavailable',
    flow_profile: 'unavailable',
    debug_session_count: 'unavailable',
    debug_time_ms: 'unavailable',
    terminal_open_count: 'unavailable',
    terminal_active_time_ms: 'unavailable',
    session_commits: 'directly_observed',
    time_to_first_commit_ms: 'directly_observed',
    chars_added_total: 'directly_observed',
    chars_removed_total_est: 'directly_observed',
    lines_added_total: 'directly_observed',
    rework_ratio_est: 'directly_observed',
    language_id_counts: 'directly_observed',
  },
  jetbrains: {
    duration_ms: 'directly_observed',
    active_coding_duration_ms: 'unavailable',
    ai_burst_count: 'unavailable',
    ai_burst_chars_total: 'unavailable',
    ai_suggestions_accepted: 'unavailable',
    ai_usage_duration_ms: 'unavailable',
    file_save_count: 'unavailable',
    focus_ratio: 'unavailable',
    idle_time_ms: 'unavailable',
    flow_profile: 'unavailable',
    debug_session_count: 'unavailable',
    debug_time_ms: 'unavailable',
    terminal_open_count: 'unavailable',
    terminal_active_time_ms: 'unavailable',
    session_commits: 'unavailable',
    time_to_first_commit_ms: 'unavailable',
    chars_added_total: 'unavailable',
    chars_removed_total_est: 'unavailable',
    lines_added_total: 'unavailable',
    rework_ratio_est: 'unavailable',
    language_id_counts: 'unavailable',
  },
  sublime: {
    duration_ms: 'directly_observed',
    active_coding_duration_ms: 'unavailable',
    ai_burst_count: 'unavailable',
    ai_burst_chars_total: 'unavailable',
    ai_suggestions_accepted: 'unavailable',
    ai_usage_duration_ms: 'unavailable',
    file_save_count: 'unavailable',
    focus_ratio: 'unavailable',
    idle_time_ms: 'unavailable',
    flow_profile: 'unavailable',
    debug_session_count: 'unavailable',
    debug_time_ms: 'unavailable',
    terminal_open_count: 'unavailable',
    terminal_active_time_ms: 'unavailable',
    session_commits: 'unavailable',
    time_to_first_commit_ms: 'unavailable',
    chars_added_total: 'unavailable',
    chars_removed_total_est: 'unavailable',
    lines_added_total: 'unavailable',
    rework_ratio_est: 'unavailable',
    language_id_counts: 'unavailable',
  },
  vim: {
    duration_ms: 'directly_observed',
    active_coding_duration_ms: 'unavailable',
    ai_burst_count: 'unavailable',
    ai_burst_chars_total: 'unavailable',
    ai_suggestions_accepted: 'unavailable',
    ai_usage_duration_ms: 'unavailable',
    file_save_count: 'unavailable',
    focus_ratio: 'unavailable',
    idle_time_ms: 'unavailable',
    flow_profile: 'unavailable',
    debug_session_count: 'unavailable',
    debug_time_ms: 'unavailable',
    terminal_open_count: 'unavailable',
    terminal_active_time_ms: 'unavailable',
    session_commits: 'unavailable',
    time_to_first_commit_ms: 'unavailable',
    chars_added_total: 'unavailable',
    chars_removed_total_est: 'unavailable',
    lines_added_total: 'unavailable',
    rework_ratio_est: 'unavailable',
    language_id_counts: 'unavailable',
  },
  other: {
    duration_ms: 'directly_observed',
    active_coding_duration_ms: 'unavailable',
    ai_burst_count: 'unavailable',
    ai_burst_chars_total: 'unavailable',
    ai_suggestions_accepted: 'unavailable',
    ai_usage_duration_ms: 'unavailable',
    file_save_count: 'unavailable',
    focus_ratio: 'unavailable',
    idle_time_ms: 'unavailable',
    flow_profile: 'unavailable',
    debug_session_count: 'unavailable',
    debug_time_ms: 'unavailable',
    terminal_open_count: 'unavailable',
    terminal_active_time_ms: 'unavailable',
    session_commits: 'unavailable',
    time_to_first_commit_ms: 'unavailable',
    chars_added_total: 'unavailable',
    chars_removed_total_est: 'unavailable',
    lines_added_total: 'unavailable',
    rework_ratio_est: 'unavailable',
    language_id_counts: 'unavailable',
  },
  unknown: {
    duration_ms: 'directly_observed',
    active_coding_duration_ms: 'unavailable',
    ai_burst_count: 'unavailable',
    ai_burst_chars_total: 'unavailable',
    ai_suggestions_accepted: 'unavailable',
    ai_usage_duration_ms: 'unavailable',
    file_save_count: 'unavailable',
    focus_ratio: 'unavailable',
    idle_time_ms: 'unavailable',
    flow_profile: 'unavailable',
    debug_session_count: 'unavailable',
    debug_time_ms: 'unavailable',
    terminal_open_count: 'unavailable',
    terminal_active_time_ms: 'unavailable',
    session_commits: 'unavailable',
    time_to_first_commit_ms: 'unavailable',
    chars_added_total: 'unavailable',
    chars_removed_total_est: 'unavailable',
    lines_added_total: 'unavailable',
    rework_ratio_est: 'unavailable',
    language_id_counts: 'unavailable',
  },
};

// ── MEASUREMENT SEMANTIC MATRIX ──────────────────────────────────────────────

/**
 * Measurement semantic per surface per metric.
 *
 * This is the SMALLEST backward-compatible addition needed to distinguish:
 * A. AVAILABLE + SEMANTICALLY EQUIVALENT
 * B. AVAILABLE + DIFFERENT MEASUREMENT SEMANTIC
 * C. UNAVAILABLE
 *
 * Key differences:
 * - ai_burst_count: VS Code uses editor_activity_heuristic (large block
 *   detection), Claude Code uses agent_authored_known (all edits are AI).
 *   Both observe it, but the measurement basis is different.
 * - active_coding_duration_ms: VS Code uses activity_timer (window/focus
 *   state), Claude Code is not_measured (NULL by bridge contract).
 * - session_commits: Claude Code uses commit_observed (git operations),
 *   VS Code is not_measured (commit_count=0 on Ed).
 * - time_to_first_commit_ms: both use commit_observed — semantically
 *   equivalent.
 * - duration_ms: both use session_elapsed — semantically equivalent.
 */
export const SURFACE_MEASUREMENT_SEMANTIC: Record<Surface, Record<keyof SurfaceCapability, MeasurementSemantic>> = {
  vscode: {
    duration_ms: 'session_elapsed',
    active_coding_duration_ms: 'activity_timer',
    ai_burst_count: 'editor_activity_heuristic',
    ai_burst_chars_total: 'editor_activity_heuristic',
    ai_suggestions_accepted: 'editor_activity_heuristic',
    ai_usage_duration_ms: 'activity_timer',
    file_save_count: 'file_edit_counted',
    focus_ratio: 'derived_ratio',
    idle_time_ms: 'activity_timer',
    flow_profile: 'derived_ratio',
    debug_session_count: 'activity_timer',
    debug_time_ms: 'activity_timer',
    terminal_open_count: 'activity_timer',
    terminal_active_time_ms: 'activity_timer',
    session_commits: 'not_measured',
    time_to_first_commit_ms: 'commit_observed',
    chars_added_total: 'not_measured',
    chars_removed_total_est: 'not_measured',
    lines_added_total: 'not_measured',
    rework_ratio_est: 'not_measured',
    language_id_counts: 'not_measured',
  },
  cursor: {
    duration_ms: 'session_elapsed',
    active_coding_duration_ms: 'activity_timer',
    ai_burst_count: 'editor_activity_heuristic',
    ai_burst_chars_total: 'editor_activity_heuristic',
    ai_suggestions_accepted: 'editor_activity_heuristic',
    ai_usage_duration_ms: 'activity_timer',
    file_save_count: 'file_edit_counted',
    focus_ratio: 'derived_ratio',
    idle_time_ms: 'activity_timer',
    flow_profile: 'derived_ratio',
    debug_session_count: 'activity_timer',
    debug_time_ms: 'activity_timer',
    terminal_open_count: 'activity_timer',
    terminal_active_time_ms: 'activity_timer',
    session_commits: 'not_measured',
    time_to_first_commit_ms: 'commit_observed',
    chars_added_total: 'not_measured',
    chars_removed_total_est: 'not_measured',
    lines_added_total: 'not_measured',
    rework_ratio_est: 'not_measured',
    language_id_counts: 'not_measured',
  },
  terminal: {
    duration_ms: 'session_elapsed',
    active_coding_duration_ms: 'not_measured',
    ai_burst_count: 'agent_authored_known',
    ai_burst_chars_total: 'agent_authored_known',
    // CR-X PI/PBT-TIME P0: ai_suggestions_accepted is observed for Claude
    // Code via the canonical aggregated endpoint. Use the same semantic as
    // ai_burst_count (agent_authored_known) since both reflect agent-authored
    // AI activity observed by the terminal bridge.
    ai_suggestions_accepted: 'agent_authored_known',
    ai_usage_duration_ms: 'agent_authored_known',
    file_save_count: 'not_measured',
    focus_ratio: 'not_measured',
    idle_time_ms: 'not_measured',
    flow_profile: 'not_measured',
    debug_session_count: 'not_measured',
    debug_time_ms: 'not_measured',
    terminal_open_count: 'not_measured',
    terminal_active_time_ms: 'not_measured',
    session_commits: 'commit_observed',
    time_to_first_commit_ms: 'commit_observed',
    chars_added_total: 'agent_authored_known',
    chars_removed_total_est: 'agent_authored_known',
    lines_added_total: 'agent_authored_known',
    rework_ratio_est: 'derived_ratio',
    language_id_counts: 'agent_authored_known',
  },
  jetbrains: {
    duration_ms: 'session_elapsed',
    active_coding_duration_ms: 'not_measured',
    ai_burst_count: 'not_measured',
    ai_burst_chars_total: 'not_measured',
    ai_suggestions_accepted: 'not_measured',
    ai_usage_duration_ms: 'not_measured',
    file_save_count: 'not_measured',
    focus_ratio: 'not_measured',
    idle_time_ms: 'not_measured',
    flow_profile: 'not_measured',
    debug_session_count: 'not_measured',
    debug_time_ms: 'not_measured',
    terminal_open_count: 'not_measured',
    terminal_active_time_ms: 'not_measured',
    session_commits: 'not_measured',
    time_to_first_commit_ms: 'not_measured',
    chars_added_total: 'not_measured',
    chars_removed_total_est: 'not_measured',
    lines_added_total: 'not_measured',
    rework_ratio_est: 'not_measured',
    language_id_counts: 'not_measured',
  },
  sublime: {
    duration_ms: 'session_elapsed', active_coding_duration_ms: 'not_measured', ai_burst_count: 'not_measured', ai_burst_chars_total: 'not_measured', ai_suggestions_accepted: 'not_measured', ai_usage_duration_ms: 'not_measured', file_save_count: 'not_measured', focus_ratio: 'not_measured', idle_time_ms: 'not_measured', flow_profile: 'not_measured', debug_session_count: 'not_measured', debug_time_ms: 'not_measured', terminal_open_count: 'not_measured', terminal_active_time_ms: 'not_measured', session_commits: 'not_measured', time_to_first_commit_ms: 'not_measured', chars_added_total: 'not_measured', chars_removed_total_est: 'not_measured', lines_added_total: 'not_measured', rework_ratio_est: 'not_measured', language_id_counts: 'not_measured',
  },
  vim: {
    duration_ms: 'session_elapsed', active_coding_duration_ms: 'not_measured', ai_burst_count: 'not_measured', ai_burst_chars_total: 'not_measured', ai_suggestions_accepted: 'not_measured', ai_usage_duration_ms: 'not_measured', file_save_count: 'not_measured', focus_ratio: 'not_measured', idle_time_ms: 'not_measured', flow_profile: 'not_measured', debug_session_count: 'not_measured', debug_time_ms: 'not_measured', terminal_open_count: 'not_measured', terminal_active_time_ms: 'not_measured', session_commits: 'not_measured', time_to_first_commit_ms: 'not_measured', chars_added_total: 'not_measured', chars_removed_total_est: 'not_measured', lines_added_total: 'not_measured', rework_ratio_est: 'not_measured', language_id_counts: 'not_measured',
  },
  other: {
    duration_ms: 'session_elapsed', active_coding_duration_ms: 'not_measured', ai_burst_count: 'not_measured', ai_burst_chars_total: 'not_measured', ai_suggestions_accepted: 'not_measured', ai_usage_duration_ms: 'not_measured', file_save_count: 'not_measured', focus_ratio: 'not_measured', idle_time_ms: 'not_measured', flow_profile: 'not_measured', debug_session_count: 'not_measured', debug_time_ms: 'not_measured', terminal_open_count: 'not_measured', terminal_active_time_ms: 'not_measured', session_commits: 'not_measured', time_to_first_commit_ms: 'not_measured', chars_added_total: 'not_measured', chars_removed_total_est: 'not_measured', lines_added_total: 'not_measured', rework_ratio_est: 'not_measured', language_id_counts: 'not_measured',
  },
  unknown: {
    duration_ms: 'session_elapsed', active_coding_duration_ms: 'not_measured', ai_burst_count: 'not_measured', ai_burst_chars_total: 'not_measured', ai_suggestions_accepted: 'not_measured', ai_usage_duration_ms: 'not_measured', file_save_count: 'not_measured', focus_ratio: 'not_measured', idle_time_ms: 'not_measured', flow_profile: 'not_measured', debug_session_count: 'not_measured', debug_time_ms: 'not_measured', terminal_open_count: 'not_measured', terminal_active_time_ms: 'not_measured', session_commits: 'not_measured', time_to_first_commit_ms: 'not_measured', chars_added_total: 'not_measured', chars_removed_total_est: 'not_measured', lines_added_total: 'not_measured', rework_ratio_est: 'not_measured', language_id_counts: 'not_measured',
  },
};

// ── SURFACE RESOLUTION ───────────────────────────────────────────────────────

/**
 * Map a canonical tool/workflow ID to a surface.
 *
 * This is backward-compatible with existing workflow normalization.
 * It does NOT change the tool ID — it adds a surface dimension.
 *
 * - claude_code → terminal (Claude Code runs in a terminal)
 * - codex → terminal (Codex CLI runs in a terminal)
 * - cursor → cursor (Cursor is both surface and assistant)
 * - devin → vscode (Devin/Windsurf runs as a VS Code extension)
 * - github_copilot → vscode (Copilot runs inside VS Code)
 * - vscode → vscode (VS Code without a specific assistant signal)
 */
export function resolveSurface(toolId: string | null | undefined): Surface {
  if (!toolId) return 'unknown';
  const id = String(toolId).toLowerCase().trim();
  switch (id) {
    case 'claude_code':
    case 'claude-code':
    case 'codex':
    case 'codex-cli':
    case 'openai-codex':
      return 'terminal';
    case 'cursor':
      return 'cursor';
    case 'devin':
    case 'windsurf':
      return 'vscode';
    case 'github_copilot':
      return 'vscode';
    case 'vscode':
      return 'vscode';
    case 'jetbrains':
    case 'intellij':
      return 'jetbrains';
    case 'sublime':
      return 'sublime';
    case 'vim':
      return 'vim';
    default:
      return 'other';
  }
}

/**
 * Map a canonical tool/workflow ID to an assistant/agent.
 *
 * IMPORTANT: This does NOT infer Copilot from VS Code. VS Code without
 * an explicit Copilot signal returns 'unknown_none_observed'.
 *
 * - claude_code → claude_code (proven from cc-bridge, vscode_version, appName)
 * - codex → codex (proven from codex-bridge source='codex')
 * - cursor → cursor_ai (Cursor has built-in AI)
 * - devin → devin (Devin is the agent)
 * - github_copilot → github_copilot (proven from appName "GitHub Copilot")
 * - vscode → unknown_none_observed (no assistant signal — NOT assumed Copilot)
 */
export function resolveAssistant(toolId: string | null | undefined): Assistant {
  if (!toolId) return 'unknown_none_observed';
  const id = String(toolId).toLowerCase().trim();
  switch (id) {
    case 'claude_code':
    case 'claude-code':
      return 'claude_code';
    case 'codex':
    case 'codex-cli':
    case 'openai-codex':
      return 'codex';
    case 'cursor':
      return 'cursor_ai';
    case 'devin':
    case 'windsurf':
      return 'devin';
    case 'github_copilot':
      return 'github_copilot';
    case 'vscode':
      // VS Code is a surface. Without an explicit Copilot/assistant signal,
      // we cannot prove which assistant (if any) is active.
      return 'unknown_none_observed';
    default:
      return 'unknown_none_observed';
  }
}

// ── CROSS-SURFACE COMPARABILITY ──────────────────────────────────────────────

/**
 * Determine the comparability level of a metric between two surfaces.
 *
 * - 'A': Both surfaces observe the metric with the SAME measurement semantic.
 *         Safe for direct cross-surface comparison.
 * - 'B': Both surfaces observe the metric but with DIFFERENT measurement
 *         semantics. May appear as a within-workflow metric but must NOT
 *         silently power a direct cross-surface productivity comparison.
 * - 'C': At least one surface does not observe the metric (unavailable).
 */
export function getComparabilityLevel(
  surfaceA: Surface,
  surfaceB: Surface,
  metric: keyof SurfaceCapability
): ComparabilityLevel {
  const capA = SURFACE_CAPABILITY[surfaceA]?.[metric];
  const capB = SURFACE_CAPABILITY[surfaceB]?.[metric];
  if (!capA || !capB) return 'C';
  if (capA === 'unavailable' || capB === 'unavailable') return 'C';

  const semA = SURFACE_MEASUREMENT_SEMANTIC[surfaceA]?.[metric];
  const semB = SURFACE_MEASUREMENT_SEMANTIC[surfaceB]?.[metric];
  if (!semA || !semB || semA === 'not_measured' || semB === 'not_measured') return 'C';
  if (semA === semB) return 'A';
  return 'B';
}

/**
 * Determine whether a metric is safely comparable between two surfaces.
 *
 * A metric is comparable only if BOTH surfaces observe it AND use the same
 * measurement semantic (level 'A').
 *
 * RULE: A terminal Claude Code session must not be compared against an editor
 * session on a metric that the bridge cannot observe equivalently.
 * RULE: ai_burst_count is observed on both vscode and terminal, but VS Code
 * uses a heuristic while Claude Code knows all edits are AI-authored. These
 * are NOT automatically apples-to-apples.
 */
export function isMetricComparableAcrossSurfaces(
  surfaceA: Surface,
  surfaceB: Surface,
  metric: keyof SurfaceCapability
): boolean {
  return getComparabilityLevel(surfaceA, surfaceB, metric) === 'A';
}

/**
 * Check if a metric is semantically compatible (level A or B) — i.e., observed
 * on both surfaces, regardless of whether the measurement basis is identical.
 * Level B metrics may appear within-workflow but must not power direct
 * cross-surface comparative claims.
 */
export function isMetricSemanticallyObserved(
  surfaceA: Surface,
  surfaceB: Surface,
  metric: keyof SurfaceCapability
): boolean {
  const level = getComparabilityLevel(surfaceA, surfaceB, metric);
  return level === 'A' || level === 'B';
}

/**
 * Get the measurement semantic for a metric on a surface.
 */
export function getMeasurementSemantic(
  surface: Surface,
  metric: keyof SurfaceCapability
): MeasurementSemantic {
  return SURFACE_MEASUREMENT_SEMANTIC[surface]?.[metric] ?? 'not_measured';
}

/**
 * Get the observability of a metric on a given surface.
 */
export function getMetricObservability(
  surface: Surface,
  metric: keyof SurfaceCapability
): Observability {
  return SURFACE_CAPABILITY[surface]?.[metric] ?? 'unavailable';
}

/**
 * Check if a metric is available (not unavailable) on a surface.
 */
export function isMetricAvailable(
  surface: Surface,
  metric: keyof SurfaceCapability
): boolean {
  return getMetricObservability(surface, metric) !== 'unavailable';
}

// ── EVIDENCE AUTHORITY ───────────────────────────────────────────────────────

/**
 * CR-X 17G.2: Metrics whose authority is Git observation, not the editor
 * surface. The VS Code extension and Claude Code bridge both observe commit
 * evidence via Git (HEAD-change listener / rev-list), not by inferring it
 * from editor activity. These bypass surface-observability gating: a
 * delegated agent on a vscode surface is still eligible for commit metrics.
 *
 * Eligibility is still fail-closed for unrecognized workflows.
 */
const GIT_AUTHORITY_METRICS: ReadonlySet<string> = new Set([
  'session_commits',
  'commits_per_session',
  'time_to_first_commit_ms',
  'time_to_first_commit_minutes',
])

/**
 * CR-X 17G.2: Human-attention metrics that are only semantically valid for
 * human_interactive workflows. On delegated_agent workflows (Claude Code,
 * Devin) the fields may be physically present if the agent ran in an editor,
 * but rendering them as "human active coding" or "idle" is materially
 * misleading. These fail closed by operational mode, not by surface.
 */
const HUMAN_ATTENTION_METRICS: ReadonlySet<string> = new Set([
  'active_coding_time_minutes',
  'active_coding_duration_ms',
  'active_coding_ratio',
  'idle_time_minutes',
  'idle_time_ms',
  'idle_ratio',
  'focus_ratio',
])

/**
 * Per-workflow metric exclusions for instruments that are narrower than
 * their surface capability. Two workflows may share a surface while having
 * different instrumentation contracts.
 *
 * - codex: The Codex bridge emits aggregate lifecycle telemetry only
 *   (duration_ms, session/turn/tool counts in metadata). It does NOT observe
 *   AI bursts/suggestions/usage duration, file saves, git commits, or token
 *   usage (token_usage_status: 'unavailable_lifecycle_hooks'). Although its
 *   terminal surface is the same as Claude Code's, these metrics are
 *   unavailable for Codex and must never render as measured zeros.
 */
const WORKFLOW_METRIC_EXCLUSIONS: Record<string, ReadonlySet<string>> = {
  codex: new Set([
    'ai_burst_count',
    'ai_burst_chars_total',
    'ai_suggestions_accepted',
    'ai_usage_duration_ms',
    'ai_usage_duration_minutes',
    'ai_usage_ratio',
    'file_save_count',
    'files_edited_per_session',
    'session_commits',
    'commits_per_session',
    'time_to_first_commit_ms',
    'time_to_first_commit_minutes',
    'chars_added_total',
    'chars_removed_total_est',
    'lines_added_total',
    'rework_ratio_est',
    'language_id_counts',
    'terminal_open_count',
    'terminal_active_time_ms',
  ]),
}

// ── TOOL-LEVEL GATING (unified entry point for PBT/PI) ───────────────────────

/**
 * Map PBT/PI metric names to SurfaceCapability keys.
 * This is the single mapping that PBT and PI use to check instrumentation.
 */
const METRIC_NAME_MAP: Record<string, keyof SurfaceCapability> = {
  // PBT metric keys (from productivityCards UNINSTRUMENTED_METRICS_BY_TOOL)
  'active_coding_time_minutes': 'active_coding_duration_ms',
  'active_coding_ratio': 'active_coding_duration_ms',
  'idle_time_minutes': 'idle_time_ms',
  'idle_ratio': 'idle_time_ms',
  // PI session primitive keys
  'active_coding_duration_ms': 'active_coding_duration_ms',
  'idle_time_ms': 'idle_time_ms',
  'file_save_count': 'file_save_count',
  'files_edited_per_session': 'file_save_count',
  'focus_ratio': 'focus_ratio',
  'flow_profile': 'flow_profile',
  'ai_burst_count': 'ai_burst_count',
  'ai_suggestions_accepted': 'ai_suggestions_accepted',
  'ai_usage_duration_ms': 'ai_usage_duration_ms',
  'ai_usage_duration_minutes': 'ai_usage_duration_ms',
  'ai_usage_ratio': 'ai_usage_duration_ms',
  'session_commits': 'session_commits',
  'commits_per_session': 'session_commits',
  'time_to_first_commit_ms': 'time_to_first_commit_ms',
  'time_to_first_commit_minutes': 'time_to_first_commit_ms',
  'chars_added_total': 'chars_added_total',
  'chars_removed_total_est': 'chars_removed_total_est',
  'lines_added_total': 'lines_added_total',
  'rework_ratio_est': 'rework_ratio_est',
  'debug_session_count': 'debug_session_count',
  'debug_time_ms': 'debug_time_ms',
  'language_id_counts': 'language_id_counts',
  // CR-X Day 1B S3 P0: Surface-independent session primitives — Level A across all surfaces
  // duration_ms is the wall-clock session elapsed time, observed on every surface
  // with the same measurement semantic (session_elapsed).
  'duration_ms': 'duration_ms',
  'average_session_length_minutes': 'duration_ms',
  'total_session_minutes': 'duration_ms',
};

/**
 * Check if a metric is instrumented for a given tool/workflow ID.
 * This is the unified entry point that PBT and PI should use.
 *
 * It resolves the tool to a surface, maps the metric name to a capability
 * key, and checks the capability matrix.
 *
 * This REPLACES the hardcoded UNINSTRUMENTED_METRICS_BY_TOOL in
 * productivityCards.ts and the isClaudeCode checks in dataAccess.ts.
 * Those remain as fallbacks for backward compatibility.
 */
export function isMetricInstrumentedForWorkflow(
  toolId: string | null | undefined,
  metricName: string
): boolean {
  const capKey = METRIC_NAME_MAP[metricName];
  // CR-X Day 1B S3 P0: Unknown metric → fail closed (unavailable), not fail open.
  if (!capKey) return false;

  // Per-workflow instrumentation exclusions apply before every other gate,
  // including Git-authority eligibility: a workflow whose instrument cannot
  // observe the metric is unavailable regardless of surface.
  const workflowExclusions = WORKFLOW_METRIC_EXCLUSIONS[String(toolId ?? '').toLowerCase().trim()];
  if (workflowExclusions?.has(metricName)) return false;

  // CR-X 17G.2: Git-authority metrics (commit evidence) are measured by Git,
  // not by the editor surface. Any recognized workflow is eligible; canonical
  // evidence governs the actual numeric rendering. Unknown workflows fail closed.
  if (GIT_AUTHORITY_METRICS.has(metricName)) {
    return resolveOperationalMode(toolId) !== 'unknown';
  }

  // CR-X 17G.2: Human-attention metrics are only meaningful for human-interactive
  // workflows. Delegated agents must not render them under human-coding labels,
  // even when an editor host physically emitted the field.
  if (HUMAN_ATTENTION_METRICS.has(metricName) && resolveOperationalMode(toolId) !== 'human_interactive') {
    return false;
  }

  const surface = resolveSurface(toolId);
  return isMetricAvailable(surface, capKey);
}

/**
 * Get the measurement semantic for a metric on a workflow's surface.
 */
export function getWorkflowMeasurementSemantic(
  toolId: string | null | undefined,
  metricName: string
): MeasurementSemantic {
  const capKey = METRIC_NAME_MAP[metricName];
  if (!capKey) return 'not_measured';

  // Per-workflow instrumentation exclusions: not measured for this workflow
  // regardless of surface capability.
  const semanticExclusions = WORKFLOW_METRIC_EXCLUSIONS[String(toolId ?? '').toLowerCase().trim()];
  if (semanticExclusions?.has(metricName)) return 'not_measured';

  // CR-X 17G.2: Git-authority metrics use the same commit_observed semantic
  // on every recognized workflow.
  if (GIT_AUTHORITY_METRICS.has(metricName)) {
    return resolveOperationalMode(toolId) !== 'unknown' ? 'commit_observed' : 'not_measured';
  }

  // CR-X 17G.2: Human-attention metrics are not measured on delegated agents.
  if (HUMAN_ATTENTION_METRICS.has(metricName) && resolveOperationalMode(toolId) !== 'human_interactive') {
    return 'not_measured';
  }

  const surface = resolveSurface(toolId);
  return getMeasurementSemantic(surface, capKey);
}

/**
 * Check if two workflows can be directly compared on a metric.
 * Uses the full comparability level (A = same semantic, B = different semantic).
 */
export function isWorkflowMetricComparable(
  toolIdA: string | null | undefined,
  toolIdB: string | null | undefined,
  metricName: string
): boolean {
  const surfaceA = resolveSurface(toolIdA);
  const surfaceB = resolveSurface(toolIdB);
  const capKey = METRIC_NAME_MAP[metricName];
  // CR-X Day 1B S3 P0: Unknown metric → fail closed (not comparable), not fail open.
  if (!capKey) return false;
  return isMetricComparableAcrossSurfaces(surfaceA, surfaceB, capKey);
}

/**
 * Get the comparability level between two workflows for a metric.
 */
export function getWorkflowComparabilityLevel(
  toolIdA: string | null | undefined,
  toolIdB: string | null | undefined,
  metricName: string
): ComparabilityLevel {
  const capKey = METRIC_NAME_MAP[metricName];
  // CR-X Day 1B S3 P0: Unknown metric → fail closed (level C), not fail open (level A).
  if (!capKey) return 'C';

  // CR-X 17G.2: Workflow comparability must use workflow-level semantics
  // (git authority / human-attention mode gate), not surface semantics.
  const semA = getWorkflowMeasurementSemantic(toolIdA, metricName);
  const semB = getWorkflowMeasurementSemantic(toolIdB, metricName);
  if (semA === 'not_measured' || semB === 'not_measured') return 'C';
  if (semA === semB) return 'A';
  return 'B';
}

// ── COST DENOMINATOR LABELS ──────────────────────────────────────────────────

/**
 * Explicit cost denominator labels that state their time basis.
 *
 * RULE: Cost denominators must explicitly state their time basis.
 * Do not call one simply "cost/hour" when ambiguous.
 */
export const COST_DENOMINATOR_LABELS = {
  per_active_coding_hour: 'Spend / Active-Coding Hour (additive)',
  per_session_hour: 'Spend / Session-Hour (additive)',
  per_session: 'Spend / Session',
  per_agent_runtime_hour: 'Spend / Agent Runtime Hour (additive)',
  per_wall_clock_hour: 'Spend / Wall-Clock Hour (union, overlap-corrected)',
} as const;

/**
 * Time basis description for each cost denominator.
 */
export const COST_DENOMINATOR_TIME_BASIS: Record<string, TimeSemantic> = {
  per_hour: 'human_active_coding_time',
  per_wallclock: 'additive_agent_runtime', // CR-X 1B: corrected — was labeled "wall_clock" but is additive
  per_session: 'elapsed_session_time',
  per_agent_runtime_hour: 'additive_agent_runtime',
  per_wall_clock_hour: 'unique_wall_clock',
};

// ── CORE PRODUCT RULES (encoded as runtime checks) ───────────────────────────

/**
 * Rule 1: Missing terminal instrumentation ≠ zero activity.
 * A NULL active_coding_duration_ms on a terminal session means "unavailable,"
 * not "zero." Never treat NULL as 0 for capability-gated metrics.
 */
export function isMissingNotZero(
  surface: Surface,
  metric: keyof SurfaceCapability,
  value: unknown
): boolean {
  if (value === null || value === undefined) {
    return getMetricObservability(surface, metric) === 'unavailable';
  }
  return false;
}

/**
 * Rule 2: ai_burst_count=0 means zero OBSERVED AI signals, not "non-AI."
 * A zero value is measured data. Only null/undefined means "not observed."
 */
export function isZeroAiBurstObserved(value: unknown): boolean {
  return value === 0 || value === '0';
}

/**
 * Rule 4: Additive runtime ≠ human wall-clock time.
 * Returns true if the given time semantic is additive (sums per-session
 * without overlap correction).
 */
export function isAdditiveTimeSemantic(semantic: TimeSemantic): boolean {
  return semantic === 'additive_agent_runtime' || semantic === 'human_active_coding_time';
}

/**
 * Rule 4b: Three concurrent agents for one hour = 3 agent-hours additive,
 * 1 hour wall-clock, ≤1 hour human active time.
 * This function computes all three from a set of sessions.
 */
export function computeTimeBasis(sessions: Array<{ timestamp: string; duration_ms: number; active_coding_duration_ms?: number | null }>): {
  additive_agent_runtime_ms: number;
  unique_wall_clock_ms: number;
  additive_active_coding_ms: number;
} {
  let additiveRuntime = 0;
  let additiveActiveCoding = 0;

  for (const s of sessions) {
    if (typeof s.duration_ms === 'number' && s.duration_ms > 0 && s.duration_ms <= 86400000) {
      additiveRuntime += s.duration_ms;
    }
    if (typeof s.active_coding_duration_ms === 'number' && s.active_coding_duration_ms > 0) {
      additiveActiveCoding += s.active_coding_duration_ms;
    }
  }

  // Unique wall-clock requires interval union — delegate to intervalUnion.ts
  // For now, return additive as placeholder; the caller should use
  // computeConcurrency() from intervalUnion.ts for the true union.
  return {
    additive_agent_runtime_ms: additiveRuntime,
    unique_wall_clock_ms: 0, // Must be computed via intervalUnion.computeConcurrency()
    additive_active_coding_ms: additiveActiveCoding,
  };
}
