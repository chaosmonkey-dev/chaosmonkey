/**
 * ============================================================================
 * CHAOSMONKEY VS CODE EXTENSION - SESSION TELEMETRY MODEL
 * ============================================================================
 * 
 * SESSION MODEL (as of version 0.3.1):
 * 
 * The extension uses an activity-based session tracking model:
 * 
 * 1. Session Start:
 *    - A logical session starts automatically on first meaningful activity:
 *      - file_edit (document changes)
 *      - ai_accept (AI suggestion accepted)
 *      - commit (Git commit recorded)
 *    - Each session has a unique session_id (format: session_<timestamp>_<random>)
 * 
 * 2. Session Duration:
 *    - Tracked from first activity (currentSessionStart) to session end
 *    - lastActivityAt is updated on every activity to detect idle state
 * 
 * 3. Session End:
 *    - Idle timeout: If no activity for 10 minutes, session ends with end_reason = "idle"
 *    - Extension shutdown: On deactivate(), session ends with end_reason = "shutdown"
 * 
 * 4. Session Event Emission:
 *    - Exactly ONE session event is emitted per logical session
 *    - Event structure:
 *      {
 *        event_type: "session",
 *        count: 1,
 *        duration_ms: <total session duration in milliseconds>,
 *        timestamp: <ISO timestamp at session end>,
 *        metadata: {
 *          source: "vscode",
 *          extension_version: "0.3.1",
 *          vscode_version: "<VS Code version>",
 *          segment_type: "session",        // Always "session" (never "interval")
 *          session_id: "session_<...>",    // Unique identifier per session
 *          end_reason: "idle" | "shutdown" // Reason for session termination
 *        }
 *      }
 * 
 * 5. Recognition in Backend:
 *    - Look for: metadata.segment_type === "session"
 *    - Presence of: metadata.session_id and metadata.end_reason
 *    - Absence of: metadata.segment_type === "interval" (legacy, no longer emitted)
 * 
 * LEGACY BEHAVIOR (versions 0.2.x and earlier):
 * - Emitted session events every ~30 seconds with segment_type = "interval"
 * - This behavior has been completely removed as of version 0.3.0
 * 
 * ============================================================================
 */

import * as vscode from 'vscode';
import { getGitDetails, getGitDetailsExtended, registerCommitListener, CommitInfo, GitContextResult, GitContextStatus, GitContextReason } from './gitContext';
import { analyzeEvent } from './aiHeuristics';
import { initializeIdentity, buildIdentityMetadata, buildIdentityPayloadFields, getIdentity, setBackendClaimedIdentity, hasBearerToken, getBearerToken } from './identity';
import { DurableTelemetryQueue, QueuedEvent } from './durableQueue';
import { AuthStateManager, ConnectionState } from './authState';

function detectEditorSource() {
  const app = String(vscode.env.appName || '').toLowerCase();

  if (app.includes('cursor')) return 'cursor';
  if (app.includes('windsurf')) return 'windsurf';
  if (app.includes('devin')) return 'devin';

  return 'vscode';
}

const EDITOR_SOURCE = detectEditorSource();

/**
 * Global extension context for accessing extension metadata
 */
let extensionContext: vscode.ExtensionContext | undefined;

/**
 * Get the extension version from package.json
 */
function getExtensionVersion(): string {
  try {
    const extension = vscode.extensions.getExtension('chaosmonkey.chaosmonkey-telemetry');
    return extension?.packageJSON.version || '0.3.1';
  } catch {
    return '0.3.1';
  }
}

interface TelemetryEvent {
  event_type: string;
  count?: number;
  duration_ms?: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface ExtensionConfig {
  apiBaseUrl: string;
  enabled: boolean;
  flushInterval: number;
}

// ============================================================================
// CONNECTION STATE (0.4.0+ / P0-G)
// ============================================================================
// Auth state is managed by AuthStateManager (persistent in globalState).
// Telemetry collection continues even when AUTH_REQUIRED — events are queued
// for later delivery after reconnect.
// ============================================================================
let isConnected: boolean = false;
let authStateManager: AuthStateManager | undefined;
let durableQueue: DurableTelemetryQueue | undefined;
let statusBar: vscode.StatusBarItem | undefined;

let outputChannel: vscode.OutputChannel;
let probeOutputChannel: vscode.OutputChannel | undefined;
let telemetryQueue: TelemetryEvent[] = []; // kept for backward-compat references; durableQueue is authoritative
let flushTimer: NodeJS.Timeout | undefined;
let config: ExtensionConfig;
let lastProbeResult: Record<string, any> | null = null;
let pendingFileEditCount = 0;
let editedDocumentUris = new Set<string>();
let fileEditListener: vscode.Disposable | undefined;
let sessionCommitCount = 0;

// ============================================================================
// USER AUTHENTICATION STATE — removed in 0.4.0
// ============================================================================

// ============================================================================
// RELIABLE DELIVERY STATE (v1.1)
// ============================================================================
// Implements requeue-on-failure with bounded queue and exponential backoff.
// Events include a deterministic event_id for deduplication safety.
// ============================================================================

/** Maximum events to hold in queue before dropping oldest (memory bound) */
const MAX_QUEUE_EVENTS = 5000;

/** Base backoff interval in milliseconds (5 seconds) */
const BACKOFF_BASE_MS = 5000;

/** Maximum backoff interval in milliseconds (2 minutes) */
const BACKOFF_MAX_MS = 120000;

/** Consecutive flush failures (reset on success) */
let consecutiveFlushFailures = 0;

/** Timestamp when next flush is allowed (0 = no restriction) */
let nextAllowedFlushAt = 0;

/**
 * Generate a deterministic event_id for deduplication
 * 
 * The event_id is a hash of stable event properties that uniquely identify
 * the event. This allows the backend to detect duplicates if the same event
 * is accidentally sent twice (e.g., due to requeue after timeout where the
 * backend actually received it).
 * 
 * Hash input: event_type + timestamp + session_id + count + stable metadata subset
 * 
 * @param event The telemetry event to generate an ID for
 * @returns A deterministic string ID (hex hash)
 */
function generateEventId(event: TelemetryEvent): string {
  // Build a stable string representation of the event
  // We use a subset of fields that are guaranteed to be stable and unique
  const parts = [
    event.event_type,
    event.timestamp,
    event.metadata?.session_id ?? 'no_session',
    String(event.count ?? 0),
    String(event.duration_ms ?? 0),
    // Include stable metadata fields (excluding any that might change)
    event.metadata?.segment_type ?? '',
    event.metadata?.end_reason ?? '',
    event.metadata?.trigger ?? '',
  ];
  
  const input = parts.join('|');
  
  // Simple hash function (djb2 variant)
  // We don't need cryptographic security, just uniqueness
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  
  // Convert to positive hex string
  const hashValue = (hash >>> 0).toString(16).padStart(8, '0');
  
  // Include a short timestamp component for extra uniqueness
  const timestampPart = Date.parse(event.timestamp).toString(36).slice(-6);
  
  return `evt_${timestampPart}_${hashValue}`;
}

/**
 * Enforce queue bounds by dropping oldest events if necessary
 * 
 * When the queue exceeds MAX_QUEUE_EVENTS, the oldest events are dropped
 * to prevent unbounded memory growth. This is a safety valve for scenarios
 * where the backend is down for extended periods.
 * 
 * @returns Number of events dropped (0 if within bounds)
 */
function enforceQueueBounds(): number {
  if (telemetryQueue.length <= MAX_QUEUE_EVENTS) {
    return 0;
  }
  
  const excessCount = telemetryQueue.length - MAX_QUEUE_EVENTS;
  
  // Drop oldest events (from the front of the queue)
  telemetryQueue.splice(0, excessCount);
  
  log(`[CM] ⚠️ Queue overflow: dropped ${excessCount} oldest events`, {
    dropped_count: excessCount,
    queue_size: telemetryQueue.length,
    max_queue_events: MAX_QUEUE_EVENTS,
  });
  
  return excessCount;
}

/**
 * Calculate backoff delay based on consecutive failures
 * 
 * Uses exponential backoff: delay = min(2^failures * base, max)
 * 
 * @param failures Number of consecutive failures
 * @returns Delay in milliseconds
 */
function calculateBackoff(failures: number): number {
  const delay = Math.min(
    Math.pow(2, failures) * BACKOFF_BASE_MS,
    BACKOFF_MAX_MS
  );
  return delay;
}

/**
 * Check if flush is currently allowed (not in backoff)
 * 
 * @returns true if flush is allowed, false if in backoff
 */
function isFlushAllowed(): boolean {
  if (nextAllowedFlushAt === 0) {
    return true;
  }
  return Date.now() >= nextAllowedFlushAt;
}

/**
 * Reset backoff state after successful delivery
 */
function resetBackoffState(): void {
  if (consecutiveFlushFailures > 0) {
    log(`[CM] ✅ Backoff reset after ${consecutiveFlushFailures} consecutive failures`);
  }
  consecutiveFlushFailures = 0;
  nextAllowedFlushAt = 0;
}

/**
 * Apply backoff after failed delivery
 */
function applyBackoff(): void {
  consecutiveFlushFailures++;
  const backoffMs = calculateBackoff(consecutiveFlushFailures);
  nextAllowedFlushAt = Date.now() + backoffMs;
  
  log(`[CM] ⏳ Backoff applied: ${backoffMs}ms (failure #${consecutiveFlushFailures}, next attempt at ${new Date(nextAllowedFlushAt).toISOString()})`);
}

// ============================================================================
// SESSION TRACKER STATE
// ============================================================================
// Prior versions (0.2.x and earlier) emitted 30-second 'interval' session segments.
// As of version 0.3.0, we emit one 'session' event per continuous activity window.

let currentSessionId: string | null = null;
let currentSessionStart: number | null = null; // Date.now() in ms
let lastActivityAt: number | null = null;
let firstCommitAt: number | null = null; // Date.now() in ms - timestamp of first commit in current session
let hasAiUsage: boolean = false; // Track if AI was used in the current session (for ai_usage_duration_ms)
let activeCodingDurationMs: number = 0; // Track active coding time (for active_coding_duration_ms)
let lastCodingActivityAt: number | null = null; // Track last coding activity time for active coding calculation
let idleTimeoutTimer: NodeJS.Timeout | undefined;
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const ACTIVE_GAP_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes - max gap to count as continuous active coding

// Git Context State for current session
let currentRepoUrl: string | null = null;
let currentBranch: string | null = null;

// Git Context Resolution Tracking (for diagnostics)
let gitContextRequestedAt: number | null = null;   // When we first requested Git context
let gitContextResolvedAt: number | null = null;    // When Git context was successfully resolved
let gitContextStatus: GitContextStatus | 'skipped' | null = null;
let gitContextReason: GitContextReason | null = null;  // Reason code for status
let gitContextAttemptInProgress: boolean = false;  // Debounce flag to prevent duplicate calls
let gitContextAttemptCount: number = 0;            // Number of attempts made this session

// Retry configuration for transient failures
const GIT_CONTEXT_MAX_ATTEMPTS = 3;
const GIT_CONTEXT_RETRY_WINDOW_MS = 15_000; // 15 seconds since first request

// AI Heuristic State for current session
let aiBurstCount: number = 0;

// ============================================================================
// AI ACTIVITY MODEL (v1.3)
// ============================================================================
// Tracks AI burst timing and magnitude for defensible AI usage metrics.
// Unlike the old "hasAiUsage" boolean, this model measures:
// - WHEN AI activity happened (first/last burst timestamps relative to session start)
// - HOW MUCH AI-generated content entered the editor (chars + lines)
// - SPAN of AI activity (time between first and last burst, not session duration)
// ============================================================================

/** Timestamp of first AI burst (ms relative to session start), null if no AI activity */
let aiFirstBurstAtMs: number | null = null;

/** Timestamp of last AI burst (ms relative to session start), null if no AI activity */
let aiLastBurstAtMs: number | null = null;

/** Total characters inserted via AI bursts in this session */
let aiBurstCharsTotal: number = 0;

/** Total lines inserted via AI bursts in this session */
let aiBurstLinesTotal: number = 0;

// ============================================================================
// LANGUAGE MIX TRACKING (v1.3)
// ============================================================================
// Tracks language IDs of edited documents to understand:
// - AI intensity by language
// - Productivity differences by language
// - Where AI is actually used across the org
// 
// Privacy: Only languageId is tracked (e.g., "typescript", "python").
// No file names, paths, workspace folder names, URIs, or content.
// ============================================================================

/** Per-session count of edits by VS Code languageId */
let languageIdCounts: Record<string, number> = {};

/** Maximum number of distinct language IDs before collapsing to "other" */
const MAX_LANGUAGE_IDS = 50;

// ============================================================================
// CHANGE MAGNITUDE TRACKING (v1.4)
// ============================================================================
// Tracks how much code changed during a session:
// - Added: Exact from inserted text
// - Removed: Estimated from change range (we don't have removed text)
// 
// This enables:
// - Throughput vs AI adoption analysis
// - Rework detection (lots of remove + add)
// - Language productivity comparisons
// 
// Privacy: No content, filenames, or paths stored. Only counts.
// ============================================================================

/** Total characters added (exact, from inserted text) */
let charsAddedTotal = 0;

/** Total characters removed (estimated from change range, single-line only) */
let charsRemovedTotalEst = 0;

/** Total lines added (exact, count of newlines in inserted text) */
let linesAddedTotal = 0;

/** Total lines removed (estimated from change range) */
let linesRemovedTotalEst = 0;

/** Maximum allowed value for change magnitude totals (sanity guardrail) */
const CHANGE_MAGNITUDE_MAX = 50_000_000;

// ============================================================================
// DEBUG ACTIVITY TRACKING (v1.5)
// ============================================================================
// Tracks debug sessions during a ChaosMonkey session:
// - debug_session_count: Number of debug sessions started
// - debug_time_ms: Total time spent debugging
// 
// Privacy: No debug config name, args, env vars, or launch.json details.
// ============================================================================

/** Number of debug sessions started during this session */
let debugSessionCount = 0;

/** Total debug time in milliseconds */
let debugTimeMs = 0;

/** Timestamp when current debug session started (null if not debugging) */
let debugActiveStartAt: number | null = null;

// ============================================================================
// WORKSPACE CONTEXT TRACKING (v1.0)
// ============================================================================
// Tracks workspace context to explain productivity variance:
// - Remote vs local development (SSH/WSL/Codespaces/Dev Containers)
// - Single-folder vs multi-root workspaces
// 
// Privacy: No folder names, paths, URIs, or repo names.
// Only booleans and a small safe remote type identifier.
// ============================================================================

/** Whether the current workspace is remote */
let isRemoteWorkspace = false;

/** Safe remote type identifier (e.g., "ssh-remote", "wsl", "dev-container", "codespaces", null) */
let remoteName: string | null = null;

/** Whether the workspace has multiple root folders */
let isMultiRootWorkspace = false;

/** Number of workspace folders */
let workspaceFolderCount = 0;

// ============================================================================
// SAVE + FORMAT-ON-SAVE TRACKING (v1.1)
// ============================================================================
// Tracks file saves and infers format-on-save behavior:
// - file_save_count: Total saves during session
// - will_save_total_count: Total onWillSave events
// - will_save_format_likely_count: Saves where formatting likely occurred
// 
// Format-likely is inferred when a text edit occurs within 250ms of onWillSave.
// This is a heuristic - we cannot access formatter internals.
// 
// Privacy: No filenames, paths, URIs, or formatter/extension names.
// ============================================================================

/** Total file saves during this session */
let fileSaveCount = 0;

/** Total onWillSave events during this session */
let willSaveTotalCount = 0;

/** Saves where formatting likely occurred (edit within 250ms of will-save) */
let willSaveFormatLikelyCount = 0;

/** Timestamp of last onWillSave event */
let lastWillSaveAt: number | null = null;

/** Gate to allow at most 1 format-likely increment per will-save */
let willSaveFormatGateOpen = false;

/** Window in ms after onWillSave to detect format-likely edits */
const WILL_SAVE_FORMAT_WINDOW_MS = 250;

// ============================================================================
// TERMINAL ACTIVITY TRACKING (v1.2)
// ============================================================================
// Tracks terminal intensity as a proxy for build/test/ops work:
// - terminal_open_count: Number of terminals opened
// - terminal_active_time_ms: Time spent with terminal active
// 
// Privacy: No commands, titles, cwd, shell, or env captured.
// Only counts and time intervals.
// ============================================================================

/** Number of terminals opened during this session */
let terminalOpenCount = 0;

/** Total time in ms with a terminal as active window */
let terminalActiveTimeMs = 0;

/** Timestamp when terminal became active (null if no terminal active) */
let terminalBecameActiveAt: number | null = null;

/**
 * Normalize remote name to a safe, small set of identifiers
 * 
 * @param rawRemoteName The raw remoteName from vscode.env.remoteName
 * @returns Normalized safe identifier
 */
function normalizeRemoteName(rawRemoteName: string): string {
  const lower = rawRemoteName.toLowerCase();
  
  if (lower.includes('ssh')) {
    return 'ssh-remote';
  }
  if (lower.includes('wsl')) {
    return 'wsl';
  }
  if (lower.includes('container') || lower.includes('docker')) {
    return 'dev-container';
  }
  if (lower.includes('codespaces') || lower.includes('codespace')) {
    return 'codespaces';
  }
  if (lower.includes('tunnel')) {
    return 'tunnel';
  }
  
  return 'unknown';
}

/**
 * Capture workspace context (remote status, folder count)
 * 
 * Called on session start. Safe to call multiple times.
 * Does not capture folder names, paths, or URIs.
 */
function captureWorkspaceContext(): void {
  try {
    // Detect remote workspace
    const rawRemoteName = vscode.env.remoteName;
    isRemoteWorkspace = !!rawRemoteName;
    remoteName = rawRemoteName ? normalizeRemoteName(rawRemoteName) : null;
    
    // Detect workspace folders (count only, no names)
    const folders = vscode.workspace.workspaceFolders || [];
    workspaceFolderCount = folders.length;
    isMultiRootWorkspace = workspaceFolderCount > 1;
    
    log(`[ChaosMonkey][Workspace] Context captured: remote=${isRemoteWorkspace}, remoteName=${remoteName}, multiRoot=${isMultiRootWorkspace}, folderCount=${workspaceFolderCount}`);
  } catch (err) {
    // Fail silently - workspace context is optional
    console.error('[CM] Workspace context capture failed:', err);
    isRemoteWorkspace = false;
    remoteName = null;
    isMultiRootWorkspace = false;
    workspaceFolderCount = 0;
  }
}

/**
 * Collapse rare languages into "other" if too many distinct language IDs
 * 
 * This prevents huge payloads in edge cases (e.g., generated docs, many
 * file types). Keeps top 49 by count + collapses rest into "other".
 * 
 * @param counts Raw language ID counts
 * @returns Collapsed counts (max 50 keys)
 */
function collapseRareLanguages(counts: Record<string, number>): Record<string, number> {
  const keys = Object.keys(counts);
  
  // If within limit, return as-is
  if (keys.length <= MAX_LANGUAGE_IDS) {
    return counts;
  }
  
  // Sort by count descending
  const sorted = keys.sort((a, b) => counts[b] - counts[a]);
  
  // Keep top (MAX_LANGUAGE_IDS - 1) languages
  const result: Record<string, number> = {};
  let otherCount = 0;
  
  for (let i = 0; i < sorted.length; i++) {
    const lang = sorted[i];
    if (i < MAX_LANGUAGE_IDS - 1) {
      result[lang] = counts[lang];
    } else {
      otherCount += counts[lang];
    }
  }
  
  // Add "other" bucket if there are collapsed languages
  if (otherCount > 0) {
    result['other'] = otherCount;
  }
  
  return result;
}

/**
 * Read configuration from VS Code settings
 */
function loadConfiguration(): ExtensionConfig {
  const vscodeConfig = vscode.workspace.getConfiguration('chaosmonkey');
  
  return {
    apiBaseUrl: vscodeConfig.get<string>('apiBaseUrl', ''),
    enabled: vscodeConfig.get<boolean>('enabled', true),
    flushInterval: vscodeConfig.get<number>('flushInterval', 30)
  };
}

/**
 * Log message to both console and Output Channel
 */
function log(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  
  console.log(logMessage, data || '');
  outputChannel.appendLine(logMessage);
  
  if (data) {
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    outputChannel.appendLine(dataStr);
  }
}

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Debounced Git context resolver with transient/terminal failure classification
 * 
 * Supports:
 * - Transient failures (no_repos_yet, git_not_ready): retry up to MAX_ATTEMPTS or 15s window
 * - Terminal failures (no_git_extension, exception): no retry
 * - Partial resolution (no_remote, detached_head): stop retrying, partial success
 * 
 * @param trigger - What triggered this call (for logging)
 */
function ensureGitContext(trigger: 'session_start' | 'file_edit' | 'ai_accept' | 'ai_burst' | 'commit' | 'debug'): void {
  // Guard 1: No active session
  if (currentSessionId === null) {
    return;
  }

  // Guard 2: Already have full Git context - no need to retry
  if (currentRepoUrl !== null && currentBranch !== null) {
    return;
  }

  // Guard 3: Attempt already in progress (debounce)
  if (gitContextAttemptInProgress) {
    log(`[ChaosMonkey][GitContext] Skipping duplicate call (trigger: ${trigger}, already in progress)`);
    return;
  }

  // Guard 4: Already in a terminal or partial-resolved state - don't retry
  // Terminal: failed (no_git_extension, exception)
  // Partial: resolved_partial (no_remote, detached_head) - we got what we can get
  if (gitContextStatus === 'resolved_full' || gitContextStatus === 'resolved_partial') {
    log(`[ChaosMonkey][GitContext] Skipping retry (trigger: ${trigger}, status: ${gitContextStatus}, reason: ${gitContextReason})`);
    return;
  }

  // Guard 5: Terminal failure - don't retry
  if (gitContextStatus === 'failed') {
    log(`[ChaosMonkey][GitContext] Skipping retry - terminal failure (trigger: ${trigger}, reason: ${gitContextReason})`);
    return;
  }

  // Guard 6: Transient failure retry limits
  // Only retry transient failures within the retry window and attempt limit
  if (gitContextStatus === 'pending' && gitContextRequestedAt !== null) {
    const timeSinceFirstRequest = Date.now() - gitContextRequestedAt;
    
    // Check attempt count
    if (gitContextAttemptCount >= GIT_CONTEXT_MAX_ATTEMPTS) {
      log(`[ChaosMonkey][GitContext] Retry limit reached (attempts: ${gitContextAttemptCount}/${GIT_CONTEXT_MAX_ATTEMPTS}, trigger: ${trigger})`);
      // Mark as failed after exhausting retries
      gitContextStatus = 'failed';
      gitContextReason = 'timeout' as GitContextReason;
      return;
    }
    
    // Check time window
    if (timeSinceFirstRequest > GIT_CONTEXT_RETRY_WINDOW_MS) {
      log(`[ChaosMonkey][GitContext] Retry window expired (${timeSinceFirstRequest}ms > ${GIT_CONTEXT_RETRY_WINDOW_MS}ms, trigger: ${trigger})`);
      // Mark as failed after window expires
      gitContextStatus = 'failed';
      gitContextReason = 'timeout' as GitContextReason;
      return;
    }
  }

  // Mark attempt in progress (debounce lock)
  gitContextAttemptInProgress = true;
  gitContextAttemptCount++;
  
  // Only set requestedAt on first attempt
  if (gitContextRequestedAt === null) {
    gitContextRequestedAt = Date.now();
  }
  gitContextStatus = 'pending';

  log(`[ChaosMonkey][GitContext] Starting capture (trigger: ${trigger}, attempt: ${gitContextAttemptCount}/${GIT_CONTEXT_MAX_ATTEMPTS})`);

  // Fire-and-forget Git capture (non-blocking)
  getGitDetailsExtended()
    .then((result: GitContextResult) => {
      // Release debounce lock
      gitContextAttemptInProgress = false;

      // Check if session ended before we got a response
      if (currentSessionId === null) {
        gitContextStatus = 'skipped';
        gitContextReason = null;
        log(`[ChaosMonkey][GitContext] Session ended before resolution (trigger: ${trigger})`);
        return;
      }

      // Calculate resolution time
      const resolvedAt = Date.now();
      const resolutionMs = gitContextRequestedAt ? resolvedAt - gitContextRequestedAt : 0;
      gitContextResolvedAt = resolvedAt;

      // Update global state with whatever we got
      if (result.repoUrl !== null) {
        currentRepoUrl = result.repoUrl;
      }
      if (result.branch !== null) {
        currentBranch = result.branch;
      }

      // Set status and reason from the result
      gitContextStatus = result.status;
      gitContextReason = result.reason;

      // Log based on status
      if (result.status === 'resolved_full') {
        log(`[ChaosMonkey][GitContext] ✅ Full context in ${resolutionMs}ms (trigger: ${trigger}, attempts: ${gitContextAttemptCount})`, {
          branch: currentBranch,
          repoUrl: currentRepoUrl,
          status: gitContextStatus,
          reason: gitContextReason,
        });
      } else if (result.status === 'resolved_partial') {
        log(`[ChaosMonkey][GitContext] ⚡ Partial context in ${resolutionMs}ms (trigger: ${trigger}, attempts: ${gitContextAttemptCount})`, {
          branch: currentBranch,
          repoUrl: currentRepoUrl,
          status: gitContextStatus,
          reason: gitContextReason,
          message: result.message,
        });
      } else if (result.isTransient) {
        // Transient failure - keep status as pending so retries are allowed
        gitContextStatus = 'pending';
        log(`[ChaosMonkey][GitContext] ⏳ Transient failure after ${resolutionMs}ms - will retry (trigger: ${trigger}, attempts: ${gitContextAttemptCount}/${GIT_CONTEXT_MAX_ATTEMPTS})`, {
          reason: result.reason,
          message: result.message,
        });
      } else if (result.isTerminal) {
        // Terminal failure - no retry
        gitContextStatus = 'failed';
        log(`[ChaosMonkey][GitContext] ❌ Terminal failure after ${resolutionMs}ms (trigger: ${trigger})`, {
          reason: result.reason,
          message: result.message,
        });
      }
    })
    .catch(err => {
      // Release debounce lock
      gitContextAttemptInProgress = false;

      const resolvedAt = Date.now();
      const resolutionMs = gitContextRequestedAt ? resolvedAt - gitContextRequestedAt : 0;
      gitContextResolvedAt = resolvedAt;
      gitContextStatus = 'failed';
      gitContextReason = 'exception';

      log(`[ChaosMonkey][GitContext] ❌ Exception after ${resolutionMs}ms (trigger: ${trigger}): ${err instanceof Error ? err.message : String(err)}`);
    });
}

/**
 * Start a new session if one doesn't exist
 */
function startSessionIfNeeded(): void {
  if (currentSessionId !== null) {
    return; // Session already active
  }

  if (!isConnected) {
    log('⚠️ Not connected — session will not start.');
    return;
  }

  currentSessionId = generateSessionId();
  currentSessionStart = Date.now();
  lastActivityAt = Date.now();
  firstCommitAt = null; // Reset first commit timestamp for new session
  hasAiUsage = false; // Reset AI usage flag for new session
  activeCodingDurationMs = 0; // Reset active coding time for new session
  lastCodingActivityAt = null; // Reset last coding activity timestamp for new session
  
  // Reset Git context for new session
  currentRepoUrl = null;
  currentBranch = null;
  
  // Reset Git context resolution tracking
  gitContextRequestedAt = null;
  gitContextResolvedAt = null;
  gitContextStatus = null;
  gitContextReason = null;
  gitContextAttemptInProgress = false;
  gitContextAttemptCount = 0;
  
  // Reset AI heuristic state for new session
  aiBurstCount = 0;
  
  // Reset AI activity model (v1.3) state for new session
  aiFirstBurstAtMs = null;
  aiLastBurstAtMs = null;
  aiBurstCharsTotal = 0;
  aiBurstLinesTotal = 0;
  
  // Reset language mix tracking for new session
  languageIdCounts = {};
  
  // Reset change magnitude tracking for new session
  charsAddedTotal = 0;
  charsRemovedTotalEst = 0;
  linesAddedTotal = 0;
  linesRemovedTotalEst = 0;
  
  // Reset debug activity tracking for new session
  debugSessionCount = 0;
  debugTimeMs = 0;
  debugActiveStartAt = null;
  
  // Reset and capture workspace context for new session
  isRemoteWorkspace = false;
  remoteName = null;
  isMultiRootWorkspace = false;
  workspaceFolderCount = 0;
  captureWorkspaceContext();
  
  // Reset save tracking for new session
  pendingFileEditCount = 0;
  editedDocumentUris = new Set<string>();
  sessionCommitCount = 0;
  willSaveTotalCount = 0;
  willSaveFormatLikelyCount = 0;
  lastWillSaveAt = null;
  willSaveFormatGateOpen = false;
  
  // Reset terminal activity tracking for new session
  terminalOpenCount = 0;
  terminalActiveTimeMs = 0;
  terminalBecameActiveAt = null;

  log(`[ChaosMonkey] Session started: id=${currentSessionId}, start=${new Date(currentSessionStart).toISOString()}`);
  
  // Trigger debounced Git context capture
  ensureGitContext('session_start');
}

/**
 * Mark activity - call this whenever user performs an action (file_edit, ai_accept, commit, debug)
 * 
 * @param trigger - Optional trigger type for Git context retry logic
 */
function markActivity(trigger?: 'file_edit' | 'ai_accept' | 'ai_burst' | 'commit' | 'debug'): void {
  if (!config.enabled) {
    return;
  }

  if (!isConnected) {
    log('⚠️ Not connected — run ChaosMonkey: Connect first. Activity not tracked.');
    return;
  }

  startSessionIfNeeded();
  const now = Date.now();
  lastActivityAt = now;
  
  // Track active coding time: measure gaps between coding activities
  // Only gaps < ACTIVE_GAP_THRESHOLD_MS count as continuous active coding
  if (lastCodingActivityAt !== null) {
    const delta = now - lastCodingActivityAt;
    const activeDelta = Math.min(delta, ACTIVE_GAP_THRESHOLD_MS);
    activeCodingDurationMs += activeDelta;
  }
  lastCodingActivityAt = now;
  
  // If Git context is still null, attempt to capture it again
  // ensureGitContext has its own debouncing to prevent duplicate calls
  if (trigger && (currentRepoUrl === null || currentBranch === null)) {
    ensureGitContext(trigger);
  }
}

// ============================================================================
// SESSION QUALITY SCORING (v1.2)
// ============================================================================
// Computes a confidence score for each session based on data completeness
// and session characteristics. Used to gate insights and explain missing data.
// ============================================================================

/**
 * Session quality score result
 */
interface SessionQualityResult {
  /** Score from 0-100 (higher = better quality) */
  score: number;
  /** Quality band: 'high' | 'medium' | 'low' */
  band: 'high' | 'medium' | 'low';
  /** List of penalty factors applied (for explainability) */
  factors: string[];
}

/**
 * Compute session quality score with explainability
 * 
 * Scoring model (v1.2):
 * - Start at 100, subtract penalties
 * - Git Context Reliability:
 *   - -30 if git_context_status === 'failed'
 *   - -15 if git_context_status === 'resolved_partial'
 *   - -10 if git_context_resolution_ms > 3000
 *   - -5 if git_context_attempts > 1
 * - Session Robustness:
 *   - -10 if duration_ms < 60_000
 *   - -10 if active_coding_duration_ms < 30_000
 *   - -5 if end_reason === 'shutdown' AND duration_ms < 60_000
 * 
 * @param params Session parameters for scoring
 * @returns SessionQualityResult with score, band, and factors
 */
function computeSessionQuality(params: {
  gitContextStatus: string | null;
  gitContextResolutionMs: number | null;
  gitContextAttempts: number;
  durationMs: number;
  activeCodingDurationMs: number;
  endReason: 'idle' | 'shutdown';
}): SessionQualityResult {
  let score = 100;
  const factors: string[] = [];

  // =========================================================================
  // GIT CONTEXT RELIABILITY PENALTIES
  // =========================================================================
  
  // -30 if git_context_status === 'failed'
  if (params.gitContextStatus === 'failed') {
    score -= 30;
    factors.push('git_context_failed');
  }
  
  // -15 if git_context_status === 'resolved_partial'
  if (params.gitContextStatus === 'resolved_partial') {
    score -= 15;
    factors.push('git_context_partial');
  }
  
  // -10 if git_context_resolution_ms > 3000
  if (params.gitContextResolutionMs !== null && params.gitContextResolutionMs > 3000) {
    score -= 10;
    factors.push('slow_git_resolution');
  }
  
  // -5 if git_context_attempts > 1
  if (params.gitContextAttempts > 1) {
    score -= 5;
    factors.push('multiple_git_attempts');
  }

  // =========================================================================
  // SESSION ROBUSTNESS PENALTIES
  // =========================================================================
  
  // -10 if duration_ms < 60_000 (less than 1 minute)
  if (params.durationMs < 60_000) {
    score -= 10;
    factors.push('short_session');
  }
  
  // -10 if active_coding_duration_ms < 30_000 (less than 30 seconds)
  if (params.activeCodingDurationMs < 30_000) {
    score -= 10;
    factors.push('low_active_coding_time');
  }
  
  // -5 if end_reason === 'shutdown' AND duration_ms < 60_000
  // (Short sessions ending in shutdown are often incomplete)
  if (params.endReason === 'shutdown' && params.durationMs < 60_000) {
    score -= 5;
    factors.push('short_shutdown_session');
  }

  // =========================================================================
  // CLAMP AND BAND
  // =========================================================================
  
  // Clamp score to [0, 100]
  score = Math.max(0, Math.min(100, score));
  
  // Determine band
  let band: 'high' | 'medium' | 'low';
  if (score >= 80) {
    band = 'high';
  } else if (score >= 50) {
    band = 'medium';
  } else {
    band = 'low';
  }

  return { score, band, factors };
}

/**
 * End the current session and emit a session telemetry event
 */
function endSession(reason: 'idle' | 'shutdown'): void {
  if (currentSessionId === null || currentSessionStart === null || lastActivityAt === null) {
    console.log('[ChaosMonkey] endSession called with no active session, skipping');
    log('[ChaosMonkey] endSession called with no active session, skipping');
    return; // No active session
  }

  const now = Date.now();
  const durationMs = now - currentSessionStart;

  console.log(
    `[ChaosMonkey] Session ending: id=${currentSessionId}, durationMs=${durationMs}, reason=${reason}`
  );

  if (durationMs > 0) {
    const extensionVersion = getExtensionVersion();

    // Calculate time to first commit (TTFC) if a commit occurred in this session
    // TTFC = timestamp_of_first_commit_in_session - session_start_time
    let timeToFirstCommitMs: number | null = null;
    if (sessionCommitCount > 0 && firstCommitAt !== null && currentSessionStart !== null) {
      timeToFirstCommitMs = firstCommitAt - currentSessionStart;
      if (timeToFirstCommitMs < 0) {
        // Sanity check: commit timestamp should not be before session start
        console.warn(`[ChaosMonkey] Invalid TTFC: commit at ${firstCommitAt} before session start ${currentSessionStart}`);
        timeToFirstCommitMs = null;
      }
    }

    const sessionMetadata: Record<string, unknown> = {
      source: EDITOR_SOURCE,
      extension_version: extensionVersion,
      vscode_version: vscode.version,
      segment_type: 'session', // Always 'session' - never 'interval' (legacy removed in 0.3.0)
      session_id: currentSessionId,
      end_reason: reason,
      git_repo_url: currentRepoUrl,
      git_branch: currentBranch,
      // Editor identification metadata for proper classification
      appName: vscode.env.appName,
      uriScheme: vscode.env.uriScheme,
      // Identity contract (v1) — same helper consumed by buildEventMetadata()
      ...buildIdentityMetadata(),
    };

    // Real measured commit and edit evidence (no paths/filenames)
    sessionMetadata.files_edited_count = editedDocumentUris.size;
    sessionMetadata.session_commits = sessionCommitCount;
    sessionMetadata.session_has_commit_outcome = sessionCommitCount > 0;

    // Include time_to_first_commit_ms only if a commit occurred (null if no commit)
    if (timeToFirstCommitMs !== null) {
      sessionMetadata.time_to_first_commit_ms = timeToFirstCommitMs;
    }

    // =========================================================================
    // AI ACTIVITY MODEL (v1.3) - Metrics Emission
    // =========================================================================
    // Emit timing and magnitude metrics for defensible AI usage reporting.
    // The old "AI used during session = full duration" semantic is replaced with
    // measured span between first and last AI burst.
    // =========================================================================
    
    // Include AI burst count from heuristic detection
    sessionMetadata.ai_burst_count = aiBurstCount;
    
    // Emit AI timing (relative to session start, null if no AI activity)
    sessionMetadata.ai_first_burst_at_ms = aiFirstBurstAtMs;
    sessionMetadata.ai_last_burst_at_ms = aiLastBurstAtMs;
    
    // Emit AI magnitude (0 if no AI activity)
    sessionMetadata.ai_burst_chars_total = aiBurstCharsTotal;
    sessionMetadata.ai_burst_lines_total = aiBurstLinesTotal;
    
    // Compute AI active span (time between first and last burst)
    // This is the defensible "AI usage duration" - not the full session duration
    let aiActiveSpanMs: number | null = null;
    if (aiFirstBurstAtMs !== null) {
      aiActiveSpanMs = aiLastBurstAtMs !== null
        ? aiLastBurstAtMs - aiFirstBurstAtMs
        : 0; // Single burst = 0 span (instantaneous)
    }
    sessionMetadata.ai_active_span_ms = aiActiveSpanMs;
    
    // =========================================================================
    // BACKWARD COMPATIBILITY: ai_usage_duration_ms
    // =========================================================================
    // Redefine (not remove) ai_usage_duration_ms to use the new AI active span.
    // This preserves existing dashboards while fixing the semantic meaning.
    // Previously: ai_usage_duration_ms = full session duration if any AI was used
    // Now: ai_usage_duration_ms = span between first and last AI burst (defensible)
    // =========================================================================
    sessionMetadata.ai_usage_duration_ms = aiActiveSpanMs ?? 0;
    sessionMetadata.ai_usage_duration_definition = 'span_between_first_and_last_ai_burst';
    
    // Log AI activity summary if any AI was used
    if (aiBurstCount > 0) {
      log(`[ChaosMonkey][AI] Session AI summary: bursts=${aiBurstCount}, chars=${aiBurstCharsTotal}, lines=${aiBurstLinesTotal}, span=${aiActiveSpanMs}ms`);
    }
    
    // =========================================================================
    // AI INTENSITY PROXY (v1.0) - Derived from AI Burst Data
    // =========================================================================
    // Computes AI characters per minute during AI activity span.
    // Easy to chart and compare across sessions.
    // =========================================================================
    let aiCharsPerMin: number | null = null;
    let aiIntensityBand: 'none' | 'low' | 'medium' | 'high' = 'none';
    
    if (aiActiveSpanMs !== null && aiActiveSpanMs > 0 && aiBurstCharsTotal > 0) {
      const spanMin = Math.max(0.001, aiActiveSpanMs / 60000); // Prevent divide-by-zero
      aiCharsPerMin = aiBurstCharsTotal / spanMin;
      
      // Banding: < 200 = low, 200-800 = medium, > 800 = high
      if (aiCharsPerMin > 800) {
        aiIntensityBand = 'high';
      } else if (aiCharsPerMin >= 200) {
        aiIntensityBand = 'medium';
      } else {
        aiIntensityBand = 'low';
      }
    }
    
    sessionMetadata.ai_chars_per_min = aiCharsPerMin === null ? null : Math.round(aiCharsPerMin * 10) / 10;
    sessionMetadata.ai_intensity_band = aiIntensityBand;
    sessionMetadata.ai_intensity_definition = 'ai_burst_chars_total divided by ai_active_span_ms (span between first/last AI burst)';
    
    // Log AI intensity if any AI activity occurred
    if (aiCharsPerMin !== null) {
      log(`[ChaosMonkey][AI] Session AI intensity: ${aiCharsPerMin.toFixed(1)} chars/min, band=${aiIntensityBand}`);
    }
    
    // =========================================================================
    // LANGUAGE MIX TRACKING (v1.3) - Emit at Session End
    // =========================================================================
    // Emit language_id_counts as session metadata. Apply guardrail to collapse
    // rare languages into "other" if more than 50 distinct language IDs.
    // =========================================================================
    const collapsedLanguageCounts = collapseRareLanguages(languageIdCounts);
    sessionMetadata.language_id_counts = collapsedLanguageCounts;
    
    // Log language mix summary if any edits occurred
    const languageCount = Object.keys(collapsedLanguageCounts).length;
    if (languageCount > 0) {
      const topLanguages = Object.entries(collapsedLanguageCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([lang, count]) => `${lang}:${count}`)
        .join(', ');
      log(`[ChaosMonkey][Language] Session language mix: ${languageCount} languages, top: ${topLanguages}`);
    }
    
    // =========================================================================
    // CHANGE MAGNITUDE TRACKING (v1.4) - Emit at Session End
    // =========================================================================
    // Emit chars/lines added and removed estimates. Apply sanity guardrail
    // to clamp runaway totals from pathological events.
    // =========================================================================
    
    // Sanity guardrail: clamp all totals to prevent pathological payloads
    let changeMagnitudeClamped = false;
    
    if (charsAddedTotal > CHANGE_MAGNITUDE_MAX) {
      charsAddedTotal = CHANGE_MAGNITUDE_MAX;
      changeMagnitudeClamped = true;
    }
    if (charsRemovedTotalEst > CHANGE_MAGNITUDE_MAX) {
      charsRemovedTotalEst = CHANGE_MAGNITUDE_MAX;
      changeMagnitudeClamped = true;
    }
    if (linesAddedTotal > CHANGE_MAGNITUDE_MAX) {
      linesAddedTotal = CHANGE_MAGNITUDE_MAX;
      changeMagnitudeClamped = true;
    }
    if (linesRemovedTotalEst > CHANGE_MAGNITUDE_MAX) {
      linesRemovedTotalEst = CHANGE_MAGNITUDE_MAX;
      changeMagnitudeClamped = true;
    }
    
    sessionMetadata.chars_added_total = charsAddedTotal;
    sessionMetadata.chars_removed_total_est = charsRemovedTotalEst;
    sessionMetadata.lines_added_total = linesAddedTotal;
    sessionMetadata.lines_removed_total_est = linesRemovedTotalEst;
    sessionMetadata.change_magnitude_definition = 'added: exact_from_inserted_text; removed: estimated_from_change_range';
    
    if (changeMagnitudeClamped) {
      sessionMetadata.change_magnitude_clamped = true;
      log(`[ChaosMonkey][Magnitude] ⚠️ Change magnitude clamped to ${CHANGE_MAGNITUDE_MAX}`);
    }
    
    // Log change magnitude summary
    if (charsAddedTotal > 0 || charsRemovedTotalEst > 0) {
      log(`[ChaosMonkey][Magnitude] Session change magnitude: +${charsAddedTotal} chars, -${charsRemovedTotalEst} chars (est), +${linesAddedTotal} lines, -${linesRemovedTotalEst} lines (est)`);
    }
    
    // =========================================================================
    // REWORK INDEX (v1.0) - Derived from Change Magnitude
    // =========================================================================
    // Computes a churn proxy from removed/added ratio.
    // Uses existing magnitude totals - no new listeners needed.
    // =========================================================================
    const addedForRework = Math.max(1, charsAddedTotal); // Prevent divide-by-zero
    const removedEstForRework = Math.max(0, charsRemovedTotalEst);
    const reworkRatioEst = removedEstForRework / addedForRework;
    
    // Banding: < 0.20 = low, 0.20-0.60 = medium, > 0.60 = high
    let reworkBand: 'low' | 'medium' | 'high' = 'low';
    if (reworkRatioEst > 0.60) {
      reworkBand = 'high';
    } else if (reworkRatioEst >= 0.20) {
      reworkBand = 'medium';
    }
    
    sessionMetadata.rework_ratio_est = Math.round(reworkRatioEst * 1000) / 1000; // Round to 3 decimal places
    sessionMetadata.rework_band = reworkBand;
    sessionMetadata.rework_definition = 'removed/added using chars_removed_total_est (range-based estimate) over chars_added_total (exact)';
    
    // Log rework summary
    if (charsAddedTotal > 0) {
      log(`[ChaosMonkey][Rework] Session rework: ratio=${reworkRatioEst.toFixed(3)}, band=${reworkBand}`);
    }
    
    // =========================================================================
    // DEBUG ACTIVITY TRACKING (v1.5) - Session End Handling
    // =========================================================================
    // If session ends while debug is still active, capture elapsed time.
    // Then emit debug metrics in session metadata.
    // =========================================================================
    if (debugActiveStartAt !== null) {
      debugTimeMs += now - debugActiveStartAt;
      debugActiveStartAt = null;
      log(`[ChaosMonkey][Debug] Debug session still active at session end, captured elapsed time`);
    }
    
    sessionMetadata.debug_session_count = debugSessionCount;
    sessionMetadata.debug_time_ms = debugTimeMs;
    
    // Log debug activity summary if any debugging occurred
    if (debugSessionCount > 0) {
      log(`[ChaosMonkey][Debug] Session debug activity: ${debugSessionCount} debug sessions, ${debugTimeMs}ms total debug time`);
    }
    
    // =========================================================================
    // WORKSPACE CONTEXT TRACKING (v1.0) - Emit at Session End
    // =========================================================================
    // Emit workspace context captured at session start.
    // No folder names, paths, or URIs - only booleans and safe identifiers.
    // =========================================================================
    sessionMetadata.is_remote_workspace = isRemoteWorkspace;
    sessionMetadata.remote_name = remoteName;
    sessionMetadata.is_multi_root_workspace = isMultiRootWorkspace;
    sessionMetadata.workspace_folder_count = workspaceFolderCount;
    
    // =========================================================================
    // SAVE + FORMAT-ON-SAVE TRACKING (v1.1) - Emit at Session End
    // =========================================================================
    sessionMetadata.file_save_count = fileSaveCount;
    sessionMetadata.will_save_total_count = willSaveTotalCount;
    sessionMetadata.will_save_format_likely_count = willSaveFormatLikelyCount;
    sessionMetadata.save_format_definition = 'format_likely inferred when a text edit occurs within 250ms after onWillSave (max 1 per will-save)';
    
    // Log save summary if any saves occurred
    if (fileSaveCount > 0) {
      log(`[ChaosMonkey][Save] Session save activity: ${fileSaveCount} saves, ${willSaveTotalCount} will-save events, ${willSaveFormatLikelyCount} format-likely`);
    }
    
    // =========================================================================
    // TERMINAL ACTIVITY TRACKING (v1.2) - Session End Handling
    // =========================================================================
    // Close active terminal interval if one is open at session end.
    // =========================================================================
    if (terminalBecameActiveAt !== null) {
      terminalActiveTimeMs += now - terminalBecameActiveAt;
      terminalBecameActiveAt = null;
      log(`[ChaosMonkey][Terminal] Terminal still active at session end, captured elapsed time`);
    }
    
    sessionMetadata.terminal_open_count = terminalOpenCount;
    sessionMetadata.terminal_active_time_ms = terminalActiveTimeMs;
    sessionMetadata.terminal_definition = 'active_time approximated via onDidChangeActiveTerminal intervals; no commands/titles/cwd captured';
    
    // Log terminal summary if any terminal activity occurred
    if (terminalOpenCount > 0 || terminalActiveTimeMs > 0) {
      log(`[ChaosMonkey][Terminal] Session terminal activity: ${terminalOpenCount} opened, ${terminalActiveTimeMs}ms active time`);
    }
    
    // Calculate active coding time and idle time
    // Active coding time: time spent actively coding (based on activity gaps)
    // Add final stretch from last activity to session end (capped by active gap threshold)
    let finalActiveCodingDurationMs = activeCodingDurationMs;
    if (lastCodingActivityAt !== null && currentSessionStart !== null) {
      const finalDelta = now - lastCodingActivityAt;
      const finalActiveDelta = Math.min(finalDelta, ACTIVE_GAP_THRESHOLD_MS);
      finalActiveCodingDurationMs += finalActiveDelta;
    }
    
    // Ensure active coding time doesn't exceed session duration
    finalActiveCodingDurationMs = Math.min(finalActiveCodingDurationMs, durationMs);
    
    // Idle time = session duration - active coding time
    const idleTimeMs = Math.max(0, durationMs - finalActiveCodingDurationMs);
    
    sessionMetadata.active_coding_duration_ms = finalActiveCodingDurationMs;
    sessionMetadata.idle_time_ms = idleTimeMs;
    
    // =========================================================================
    // FLOW PROFILE (v1.0) - Derived from Session Aggregates
    // =========================================================================
    // Computes explainable session "flow profile" labels + ratios.
    // Uses already-captured aggregates: duration, active coding, idle, debug, terminal.
    // =========================================================================
    const dur = Math.max(1, durationMs); // Prevent divide-by-zero
    const round3 = (x: number) => Math.round(x * 1000) / 1000;
    
    const focusRatio = Math.min(1, Math.max(0, finalActiveCodingDurationMs / dur));
    const debugRatio = Math.min(1, Math.max(0, debugTimeMs / dur));
    const terminalRatio = Math.min(1, Math.max(0, terminalActiveTimeMs / dur));
    const idleRatio = Math.min(1, Math.max(0, idleTimeMs / dur));
    
    // Deterministic ordered rules (do not change order)
    let flowProfile: 'idle-heavy' | 'debug-heavy' | 'terminal-heavy' | 'coding-heavy' | 'mixed' = 'mixed';
    if (idleRatio > 0.50) {
      flowProfile = 'idle-heavy';
    } else if (debugRatio >= 0.25) {
      flowProfile = 'debug-heavy';
    } else if (terminalRatio >= 0.25) {
      flowProfile = 'terminal-heavy';
    } else if (focusRatio >= 0.70) {
      flowProfile = 'coding-heavy';
    }
    
    sessionMetadata.focus_ratio = round3(focusRatio);
    sessionMetadata.debug_ratio = round3(debugRatio);
    sessionMetadata.terminal_ratio = round3(terminalRatio);
    sessionMetadata.idle_ratio = round3(idleRatio);
    sessionMetadata.flow_profile = flowProfile;
    sessionMetadata.flow_definition = 'profile chosen by ordered rules: idle>debug>terminal>coding>mixed using ratios of duration_ms';
    
    log(`[ChaosMonkey][Flow] Session flow: profile=${flowProfile}, focus=${round3(focusRatio)}, debug=${round3(debugRatio)}, terminal=${round3(terminalRatio)}, idle=${round3(idleRatio)}`);
    
    // Include Git context resolution diagnostics
    // This tells us whether Git context was captured and how long it took
    sessionMetadata.git_context_status = gitContextStatus || 'not_attempted';
    sessionMetadata.git_context_reason = gitContextReason;
    sessionMetadata.git_context_attempts = gitContextAttemptCount;
    
    // Calculate Git context resolution timing
    let gitContextResolutionMs: number | null = null;
    if (gitContextRequestedAt !== null) {
      gitContextResolutionMs = gitContextResolvedAt 
        ? gitContextResolvedAt - gitContextRequestedAt 
        : now - gitContextRequestedAt; // Still pending at session end
      sessionMetadata.git_context_resolution_ms = gitContextResolutionMs;
      sessionMetadata.git_context_resolved_before_end = gitContextResolvedAt !== null && gitContextResolvedAt < now;
      
      // Log timing diagnostics
      log(`[ChaosMonkey][GitContext] Session end timing: requested=${gitContextRequestedAt}, resolved=${gitContextResolvedAt}, duration=${gitContextResolutionMs}ms, resolvedBeforeEnd=${sessionMetadata.git_context_resolved_before_end}, attempts=${gitContextAttemptCount}`);
    }

    // =========================================================================
    // SESSION QUALITY SCORE (v1.2)
    // =========================================================================
    // Compute confidence score based on data completeness and session characteristics.
    // This enables:
    // - Suppressing low-quality sessions in dashboards
    // - Explaining missing data to users
    // - Gating executive insights safely
    // =========================================================================
    const qualityResult = computeSessionQuality({
      gitContextStatus: gitContextStatus as string | null,
      gitContextResolutionMs: gitContextResolutionMs,
      gitContextAttempts: gitContextAttemptCount,
      durationMs: durationMs,
      activeCodingDurationMs: finalActiveCodingDurationMs,
      endReason: reason,
    });
    
    sessionMetadata.session_quality_score = qualityResult.score;
    sessionMetadata.session_quality_band = qualityResult.band;
    sessionMetadata.session_quality_factors = qualityResult.factors;
    
    log(`[ChaosMonkey][Quality] Session quality: score=${qualityResult.score}, band=${qualityResult.band}, factors=[${qualityResult.factors.join(', ')}]`);

    queueEvent({
      event_type: 'session',
      count: 1,
      duration_ms: durationMs,
      timestamp: new Date(now).toISOString(),
      metadata: sessionMetadata
    });

    const durationMinutes = (durationMs / 60000).toFixed(2);
    log(`[ChaosMonkey] Session ended`, {
      sessionId: currentSessionId,
      durationMs: durationMs,
      durationMinutes: `${durationMinutes} min`,
      reason: reason,
      quality_score: qualityResult.score,
      quality_band: qualityResult.band,
    });
    console.log(
      `[ChaosMonkey] Session event queued: id=${currentSessionId}, durationMs=${durationMs}, reason=${reason}, quality=${qualityResult.band}(${qualityResult.score})`
    );
  }

  // Reset session state (guard against double-sending)
  currentSessionId = null;
  currentSessionStart = null;
  lastActivityAt = null;
  firstCommitAt = null;
  hasAiUsage = false;
  activeCodingDurationMs = 0;
  lastCodingActivityAt = null;
  currentRepoUrl = null;
  currentBranch = null;
  aiBurstCount = 0;
  editedDocumentUris = new Set<string>();
  sessionCommitCount = 0;
  
  // Reset AI activity model (v1.3) state
  aiFirstBurstAtMs = null;
  aiLastBurstAtMs = null;
  aiBurstCharsTotal = 0;
  aiBurstLinesTotal = 0;
  
  // Reset language mix tracking
  languageIdCounts = {};
  
  // Reset change magnitude tracking
  charsAddedTotal = 0;
  charsRemovedTotalEst = 0;
  linesAddedTotal = 0;
  linesRemovedTotalEst = 0;
  
  // Reset debug activity tracking
  debugSessionCount = 0;
  debugTimeMs = 0;
  debugActiveStartAt = null;
  
  // Reset workspace context tracking
  isRemoteWorkspace = false;
  remoteName = null;
  isMultiRootWorkspace = false;
  workspaceFolderCount = 0;
  
  // Reset save tracking
  fileSaveCount = 0;
  willSaveTotalCount = 0;
  willSaveFormatLikelyCount = 0;
  lastWillSaveAt = null;
  willSaveFormatGateOpen = false;
  
  // Reset terminal activity tracking
  terminalOpenCount = 0;
  terminalActiveTimeMs = 0;
  terminalBecameActiveAt = null;
  
  // Reset Git context resolution tracking
  gitContextRequestedAt = null;
  gitContextResolvedAt = null;
  gitContextStatus = null;
  gitContextReason = null;
  gitContextAttemptInProgress = false;
  gitContextAttemptCount = 0;
}

/**
 * Start idle timeout checker timer
 */
function startIdleTimeoutTimer(): void {
  if (idleTimeoutTimer) {
    clearInterval(idleTimeoutTimer);
  }

  // Check every 60 seconds for idle timeout
  idleTimeoutTimer = setInterval(() => {
    if (!currentSessionId || !lastActivityAt) {
      return; // No active session
    }

    const now = Date.now();
    if (now - lastActivityAt > SESSION_IDLE_TIMEOUT_MS) {
      log(`[ChaosMonkey] Session idle timeout detected (${SESSION_IDLE_TIMEOUT_MS}ms), ending session`);
      endSession('idle');
    }
  }, 60000); // Check every 60 seconds

  log('[ChaosMonkey] Idle timeout timer started (checks every 60s, timeout: 10min)');
}

/**
 * Stop idle timeout checker timer
 */
function stopIdleTimeoutTimer(): void {
  if (idleTimeoutTimer) {
    clearInterval(idleTimeoutTimer);
    idleTimeoutTimer = undefined;
    log('[ChaosMonkey] Idle timeout timer stopped');
  }
}

/**
 * Build consistent metadata for all telemetry events
 * 
 * This ensures every event includes:
 * - session_id: Primary join key for correlating events within a session
 * - segment_type: 'event' for individual events, 'session' for session summaries
 * - Git context: repo URL and branch (when available)
 * - Standard fields: source, extension_version, vscode_version
 * 
 * @param eventType - The type of event being created
 * @param additionalMetadata - Event-specific metadata to merge
 * @returns Complete metadata object
 */
function buildEventMetadata(
  eventType: string,
  additionalMetadata: Record<string, unknown> = {},
  context?: vscode.ExtensionContext
): Record<string, unknown> {
  // Base metadata present on ALL events
  const baseMetadata: Record<string, unknown> = {
    source: EDITOR_SOURCE,
    extension_version: getExtensionVersion(),
    vscode_version: vscode.version,
    
    // Primary join key - allows correlating all events within a session
    session_id: currentSessionId,
    
    // Segment type distinguishes event types:
    // - 'event': Individual activity events (file_edit, ai_accept, commit)
    // - 'session': Session summary event (emitted once per session on end)
    segment_type: eventType === 'session' ? 'session' : 'event',
    
    // Git context - available after ensureGitContext resolves
    git_repo_url: currentRepoUrl,
    git_branch: currentBranch,
    
    // Editor identification metadata for proper classification
    // These fields allow backend to distinguish Devin from VS Code, Windsurf from VS Code, etc.
    appName: vscode.env.appName,
    uriScheme: vscode.env.uriScheme,

    // Identity contract (v1) — stable installation identity
    // See src/identity.ts for the full contract specification
    ...buildIdentityMetadata(),
  };
  
  // Merge additional metadata (event-specific fields override base if present)
  return { ...baseMetadata, ...additionalMetadata };
}

/**
 * Add event to telemetry queue
 * 
 * Events are enriched with a deterministic event_id for deduplication.
 * Queue bounds are enforced to prevent unbounded memory growth.
 */
function queueEvent(event: TelemetryEvent): void {
  if (!config.enabled) {
    log('⚠️ Telemetry disabled in settings, skipping event');
    return;
  }

  // P0-G: Events continue queuing even when AUTH_REQUIRED or AUTHORIZATION_DENIED.
  // Only skip if there is no stored token at all (never connected).
  if (authStateManager && authStateManager.isAuthRequired()) {
    log('⚠️ Auth required — event queued for later delivery (will flush after reconnect)');
  } else if (authStateManager && authStateManager.isAuthorizationDenied()) {
    log('⚠️ Authorization denied — event queued for later delivery');
  } else if (!isConnected) {
    log('⚠️ Not connected — run ChaosMonkey: Connect first. Event skipped.');
    return;
  }

  // Ensure metadata exists
  if (!event.metadata) {
    event.metadata = {};
  }

  // Generate deterministic event_id for deduplication
  // This is added to metadata so the backend can use it for dedupe
  const eventId = generateEventId(event);
  (event.metadata as Record<string, unknown>).event_id = eventId;

  // P0-G: Use durable queue if available, fall back to in-memory
  if (durableQueue) {
    durableQueue.enqueue(event);
    const queueLen = durableQueue.length();
    log(`📊 Event queued: ${event.event_type} (durable queue length: ${queueLen})`);
  } else {
    telemetryQueue.push(event);
    const dropped = enforceQueueBounds();
    if (dropped > 0) {
      log(`📊 Event queued: ${event.event_type} (queue: ${telemetryQueue.length}, dropped: ${dropped})`);
    } else {
      log(`📊 Event queued: ${event.event_type} (queue length: ${telemetryQueue.length})`);
    }
  }
}

/**
 * Send telemetry batch to backend via HTTP POST
 */
async function sendTelemetryBatch(
  events: TelemetryEvent[],
  apiBaseUrl: string
): Promise<{ ok: boolean; status: number; body?: any; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

  try {
    // 0.4.0+: Bearer token comes exclusively from SecretStorage
    let effectiveToken: string | undefined;
    if (extensionContext) {
      effectiveToken = await extensionContext.secrets.get('chaosmonkey.authToken');
    }

    if (!effectiveToken) {
      log('[CM] ⚠️ No bearer token in SecretStorage — cannot send telemetry');
      return { ok: false, status: 401, error: 'No bearer token' };
    }

    const payload = {
      source: EDITOR_SOURCE,
      editor_source: EDITOR_SOURCE,
      extension_version: getExtensionVersion(),
      ...buildIdentityPayloadFields(), // installation_id, developer_id, team_id, identity_schema_version
      events: events
    };

    const firstEventType = events[0]?.event_type ?? 'unknown';
    const firstSessionId =
      (events[0]?.metadata as Record<string, unknown> | undefined)?.session_id ??
      currentSessionId ??
      null;

    log(
      `[CM][telemetry][send] ${JSON.stringify({
        ide: EDITOR_SOURCE,
        sessionId: firstSessionId,
        eventType: firstEventType,
        url: `${apiBaseUrl}/api/telemetry`,
      })}`
    );

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (effectiveToken) {
      headers['Authorization'] = `Bearer ${effectiveToken}`;
    }

    const response = await fetch(`${apiBaseUrl}/api/telemetry`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const responseBody = await response.json().catch(() => null);

    if (response.ok) {
      log(`[CM] ✅ Telemetry delivered (status ${response.status})`, responseBody);
      return { ok: true, status: response.status, body: responseBody };
    } else {
      log(`[CM] ⚠️ Telemetry delivery failed: HTTP ${response.status}`, responseBody);
      return { ok: false, status: response.status, body: responseBody };
    }
  } catch (error) {
    clearTimeout(timeoutId);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('aborted')) {
      log(`[CM] ⚠️ Telemetry delivery failed: request timeout (5s)`);
      return { ok: false, status: 0, error: 'timeout' };
    }
    
    log(`[CM] ⚠️ Telemetry delivery failed: ${errorMessage}`);
    return { ok: false, status: 0, error: errorMessage };
  }
}

/**
 * Enrichment statistics for logging
 */
interface EnrichmentStats {
  flushEventCount: number;
  enrichedSessionIdCount: number;
  enrichedRepoUrlCount: number;
  enrichedBranchCount: number;
  skippedOverwriteCount: number;
}

/**
 * Flush-time enrichment: Best-effort population of session_id and Git context
 * 
 * This function runs immediately before POSTing the queued telemetry batch.
 * It enriches events that were queued before Git context resolved, using the
 * current global state (currentSessionId, currentRepoUrl, currentBranch).
 * 
 * Rules:
 * - Only enriches fields that are null/undefined in the event
 * - Never overwrites non-null values already set on the event
 * - Non-blocking: no async operations, just in-memory mutation
 * - Does not add any sensitive data (paths, filenames, code)
 * 
 * @param events Array of events to enrich (mutated in place)
 * @returns Enrichment statistics for logging
 */
function enrichEventsBeforeFlush(events: TelemetryEvent[]): EnrichmentStats {
  const stats: EnrichmentStats = {
    flushEventCount: events.length,
    enrichedSessionIdCount: 0,
    enrichedRepoUrlCount: 0,
    enrichedBranchCount: 0,
    skippedOverwriteCount: 0,
  };

  for (const event of events) {
    // Ensure metadata object exists
    if (!event.metadata) {
      event.metadata = {};
    }

    const metadata = event.metadata as Record<string, unknown>;

    // Enrich session_id if missing and global state is available
    if ((metadata.session_id === null || metadata.session_id === undefined) && currentSessionId !== null) {
      metadata.session_id = currentSessionId;
      stats.enrichedSessionIdCount++;
    } else if (metadata.session_id !== null && metadata.session_id !== undefined) {
      // Already has value, don't overwrite
      stats.skippedOverwriteCount++;
    }

    // Enrich git_repo_url if missing and global state is available
    if ((metadata.git_repo_url === null || metadata.git_repo_url === undefined) && currentRepoUrl !== null) {
      metadata.git_repo_url = currentRepoUrl;
      stats.enrichedRepoUrlCount++;
    } else if (metadata.git_repo_url !== null && metadata.git_repo_url !== undefined) {
      // Already has value, don't overwrite
      stats.skippedOverwriteCount++;
    }

    // Enrich git_branch if missing and global state is available
    if ((metadata.git_branch === null || metadata.git_branch === undefined) && currentBranch !== null) {
      metadata.git_branch = currentBranch;
      stats.enrichedBranchCount++;
    } else if (metadata.git_branch !== null && metadata.git_branch !== undefined) {
      // Already has value, don't overwrite
      stats.skippedOverwriteCount++;
    }
  }

  return stats;
}

/**
 * Flush telemetry queue and send to backend (internal implementation)
 * 
 * Implements reliable delivery with:
 * - Requeue-on-failure: Failed batches are prepended back to the queue
 * - Exponential backoff: Delays between retries increase after failures
 * - Queue bounds: Oldest events are dropped if queue exceeds MAX_QUEUE_EVENTS
 * - Deterministic event_id: Each event has a unique ID for deduplication
 * 
 * @param force If true, bypass backoff check (used for shutdown flush)
 */
async function flushQueueInternal(force: boolean = false): Promise<void> {
  // P0-G: Only flush if CONNECTED. If AUTH_REQUIRED or AUTHORIZATION_DENIED,
  // skip flush but keep events queued.
  if (authStateManager && !authStateManager.isConnected()) {
    log('⚠️ Not connected (auth state) — flush skipped, queue retained.');
    return;
  }

  if (!isConnected) {
    log('⚠️ Not connected — flush skipped.');
    return;
  }

  // =========================================================================
  // BACKOFF CHECK
  // =========================================================================
  // Skip flush if we're in backoff period (unless forced for shutdown)
  if (!force && !isFlushAllowed()) {
    const remainingMs = nextAllowedFlushAt - Date.now();
    log(`[CM] ⏳ Flush skipped: in backoff (${Math.ceil(remainingMs / 1000)}s remaining, failures: ${consecutiveFlushFailures})`);
    return;
  }

  // Check if we have pending file edits to add
  if (pendingFileEditCount > 0 && config.enabled && isConnected) {
    const fileEditEvent: TelemetryEvent = {
      event_type: 'file_edit',
      count: pendingFileEditCount,
      timestamp: new Date().toISOString(),
      metadata: buildEventMetadata('file_edit', {}, extensionContext)
    };

    // Generate event_id for the file_edit event
    const eventId = generateEventId(fileEditEvent);
    (fileEditEvent.metadata as Record<string, unknown>).event_id = eventId;

    log(`[CM] 📤 Adding aggregated file_edit event with count=${pendingFileEditCount}`);
    if (durableQueue) {
      durableQueue.enqueue(fileEditEvent);
    } else {
      telemetryQueue.push(fileEditEvent);
    }
    pendingFileEditCount = 0; // Reset counter after adding to queue
  }

  // NOTE: Session events are now managed by the activity-based session tracker.
  // Prior versions (0.2.x and earlier) emitted 30-second 'interval' session segments.
  // As of version 0.3.0, we emit one 'session' event per continuous activity window.

  // P0-G: Check durable queue
  const currentQueueLength = durableQueue ? durableQueue.length() : telemetryQueue.length;
  if (currentQueueLength === 0) {
    log('✨ Queue empty, nothing to flush');
    return;
  }

  // =========================================================================
  // CAPTURE BATCH (snapshot queue — do NOT clear until server accepts)
  // P0-G: Events leave the queue ONLY after confirmed server acceptance.
  // =========================================================================
  let batchToSend: TelemetryEvent[];
  if (durableQueue) {
    batchToSend = durableQueue.snapshot() as TelemetryEvent[];
  } else {
    batchToSend = [...telemetryQueue];
    telemetryQueue = [];
  }

  // =========================================================================
  // FLUSH-TIME ENRICHMENT
  // =========================================================================
  const enrichmentStats = enrichEventsBeforeFlush(batchToSend);

  // Log enrichment statistics (debug level - not spammy)
  const hasEnrichment = enrichmentStats.enrichedSessionIdCount > 0 ||
                        enrichmentStats.enrichedRepoUrlCount > 0 ||
                        enrichmentStats.enrichedBranchCount > 0;

  if (hasEnrichment) {
    log(`[CM] 🔧 Flush-time enrichment:`, {
      flush_event_count: enrichmentStats.flushEventCount,
      enriched_session_id_count: enrichmentStats.enrichedSessionIdCount,
      enriched_repo_url_count: enrichmentStats.enrichedRepoUrlCount,
      enriched_branch_count: enrichmentStats.enrichedBranchCount,
      skipped_overwrite_count: enrichmentStats.skippedOverwriteCount,
      current_repo_url: currentRepoUrl ? '(available)' : '(null)',
      current_branch: currentBranch ? '(available)' : '(null)',
      current_session_id: currentSessionId ? '(available)' : '(null)',
    });
  }
  // =========================================================================

  log(`🔄 Flushing queue (${batchToSend.length} events, failures: ${consecutiveFlushFailures}):`);

  batchToSend.forEach((event, index) => {
    const eventId = (event.metadata as Record<string, unknown>)?.event_id || 'no_id';
    outputChannel.appendLine(`  ${index + 1}. ${event.event_type} @ ${event.timestamp} (count: ${event.count || 'n/a'}, id: ${eventId})`);
  });

  // =========================================================================
  // ATTEMPT DELIVERY
  // =========================================================================
  try {
    const result = await sendTelemetryBatch(batchToSend, config.apiBaseUrl);

    if (result.ok) {
      // =====================================================================
      // SUCCESS: Remove accepted batch from queue, reset backoff
      // P0-G: Events leave the queue ONLY after confirmed server acceptance.
      // =====================================================================
      log(`✅ Queue flushed successfully (${batchToSend.length} events delivered)`);
      if (durableQueue) {
        durableQueue.removeAccepted(batchToSend.length);
      } else {
        // In-memory: already cleared above
      }
      resetBackoffState();
    } else if (result.status === 401) {
      // =====================================================================
      // 401: AUTH REQUIRED — retain batch, set persistent auth state
      // P0-G: Do NOT drop the batch. Do NOT call endSession.
      // =====================================================================
      log(`[CM] 🔒 401 Unauthorized — entering AUTH_REQUIRED state. Batch retained (${batchToSend.length} events).`);
      if (durableQueue) {
        // Batch was only snapshotted, not removed — it's still in the queue.
        // No action needed: the queue still has all events.
      } else {
        // In-memory: requeue the batch
        telemetryQueue = [...batchToSend, ...telemetryQueue];
      }
      if (authStateManager) {
        authStateManager.setState('AUTH_REQUIRED');
      }
      isConnected = false;
      stopFlushTimer();
      vscode.window.showWarningMessage('ChaosMonkey: Authentication required. Click the status bar to reconnect.');
    } else if (result.status === 403) {
      // =====================================================================
      // 403: AUTHORIZATION DENIED — retain batch, set distinct state
      // P0-G: Do NOT drop the batch. Do NOT clear credentials. Do NOT call endSession.
      // =====================================================================
      log(`[CM] 🚫 403 Forbidden — entering AUTHORIZATION_DENIED state. Batch retained (${batchToSend.length} events).`);
      if (durableQueue) {
        // Batch was only snapshotted — still in queue.
      } else {
        telemetryQueue = [...batchToSend, ...telemetryQueue];
      }
      if (authStateManager) {
        authStateManager.setState('AUTHORIZATION_DENIED');
      }
      // Do NOT set isConnected = false — token may still be valid for other scopes.
      // Stop flush timer to avoid hammering the server.
      stopFlushTimer();
      vscode.window.showErrorMessage('ChaosMonkey: Access denied. Your account does not have access to this telemetry.');
    } else {
      // =====================================================================
      // RETRIABLE FAILURE (network/5xx): Requeue batch and apply backoff
      // P0-G: Do NOT mark authentication invalid due to transport/server failure.
      // =====================================================================
      log(`⚠️ Delivery failed (HTTP ${result.status}), requeuing ${batchToSend.length} events`);

      if (durableQueue) {
        // Batch was only snapshotted — still in queue. No requeue needed.
      } else {
        // Prepend failed batch back to queue (preserve order)
        telemetryQueue = [...batchToSend, ...telemetryQueue];
      }

      // Enforce queue bounds after requeue
      const dropped = enforceQueueBounds();

      // Apply backoff
      applyBackoff();

      log(`[CM] 🔄 Requeue complete`, {
        requeued_count: batchToSend.length,
        queue_size: durableQueue ? durableQueue.length() : telemetryQueue.length,
        dropped_count: dropped,
        consecutive_failures: consecutiveFlushFailures,
        next_attempt_at: new Date(nextAllowedFlushAt).toISOString(),
      });
    }
  } catch (error) {
    // =========================================================================
    // EXCEPTION: Requeue batch and apply backoff
    // =========================================================================
    // Should rarely happen (sendTelemetryBatch catches most errors)
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`⚠️ Unexpected error during flush: ${errorMessage}`);

    if (durableQueue) {
      // Batch was only snapshotted — still in queue.
    } else {
      // Prepend failed batch back to queue (preserve order)
      telemetryQueue = [...batchToSend, ...telemetryQueue];
    }

    // Enforce queue bounds after requeue
    const dropped = enforceQueueBounds();

    // Apply backoff
    applyBackoff();

    log(`[CM] 🔄 Requeue after exception`, {
      requeued_count: batchToSend.length,
      queue_size: telemetryQueue.length,
      dropped_count: dropped,
      consecutive_failures: consecutiveFlushFailures,
      error: errorMessage,
    });
  }
}

/**
 * Flush telemetry queue and send to backend (called by timer)
 */
async function flushQueue(): Promise<void> {
  return flushQueueInternal();
}

/**
 * Flush telemetry queue immediately and await completion
 * Used during deactivate to ensure shutdown session events are sent
 * 
 * This bypasses backoff restrictions since shutdown is the last chance
 * to deliver any queued events.
 */
async function flushQueueNow(): Promise<void> {
  try {
    console.log('[ChaosMonkey] flushQueueNow() called explicitly');
    log('[ChaosMonkey] flushQueueNow() called explicitly');
    // Force=true bypasses backoff for shutdown flush
    await flushQueueInternal(true);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('[ChaosMonkey] flushQueueNow() failed', err);
    log(`[ChaosMonkey] ⚠️ flushQueueNow() failed: ${errorMessage}`);
  }
}

/**
 * Start periodic queue flush timer
 */
function startFlushTimer(): void {
  if (!isConnected) {
    log('[CM] ⏹️ Not connected — flush timer will not start');
    return;
  }

  if (flushTimer) {
    clearInterval(flushTimer);
  }

  const intervalMs = config.flushInterval * 1000;
  log(`⏱️ Starting flush timer (interval: ${config.flushInterval}s)`);

  flushTimer = setInterval(() => {
    flushQueue();
  }, intervalMs);
}

/**
 * Stop flush timer
 */
function stopFlushTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = undefined;
    log('⏹️ Flush timer stopped');
  }
}

/**
 * Register file-edit listener to track document changes
 */
function registerFileEditListener(context: vscode.ExtensionContext): void {
  if (!config.enabled) {
    log('[CM] ⚠️ Telemetry disabled; skipping file-edit instrumentation');
    return;
  }
  
  // Register document change listener
  fileEditListener = vscode.workspace.onDidChangeTextDocument((event) => {
    // Ignore if telemetry is disabled (runtime check)
    if (!config.enabled) {
      return;
    }
    
    // Only track file:// scheme (ignore untitled, git, output, etc.)
    if (event.document.uri.scheme !== 'file') {
      return;
    }
    
    // Ignore if there are no actual content changes
    if (event.contentChanges.length === 0) {
      return;
    }
    
    // Mark activity for session tracking (with trigger for Git context retry)
    markActivity('file_edit');

    // Track distinct edited documents (count only, paths never emitted)
    editedDocumentUris.add(event.document.uri.toString());

    // Increment the counter
    pendingFileEditCount++;
    
    // =========================================================================
    // LANGUAGE MIX TRACKING (v1.3)
    // =========================================================================
    // Track languageId for this edit. O(1) per edit, no paths/content.
    // =========================================================================
    const languageId = event.document.languageId || 'unknown';
    languageIdCounts[languageId] = (languageIdCounts[languageId] || 0) + 1;
    
    // =========================================================================
    // CHANGE MAGNITUDE TRACKING (v1.4)
    // =========================================================================
    // Track chars/lines added and removed (estimated) per change.
    // O(number_of_changes) per document change event. No content stored.
    // =========================================================================
    for (const change of event.contentChanges) {
      // Added (accurate): Count inserted text
      const addedText = change.text ?? '';
      charsAddedTotal += addedText.length;
      
      // Count newlines in added text
      const addedNewlines = (addedText.match(/\n/g) || []).length;
      linesAddedTotal += addedNewlines;
      
      // Removed (estimated): We don't have removed text, estimate from range
      // Lines removed: difference in line numbers
      const removedLines = change.range.end.line - change.range.start.line;
      linesRemovedTotalEst += Math.max(0, removedLines);
      
      // Chars removed: only safe to estimate on single-line changes
      // Multi-line removals would require document content access
      if (change.range.start.line === change.range.end.line) {
        const removedChars = change.range.end.character - change.range.start.character;
        charsRemovedTotalEst += Math.max(0, removedChars);
      }
    }
    
    // =========================================================================
    // SAVE + FORMAT-ON-SAVE TRACKING (v1.1) - Format-likely Detection
    // =========================================================================
    // Infer "format-likely" when an edit occurs within 250ms of onWillSave.
    // Gate ensures max 1 increment per will-save event.
    // =========================================================================
    if (willSaveFormatGateOpen && lastWillSaveAt !== null) {
      const timeSinceWillSave = Date.now() - lastWillSaveAt;
      if (timeSinceWillSave <= WILL_SAVE_FORMAT_WINDOW_MS) {
        willSaveFormatLikelyCount += 1;
        willSaveFormatGateOpen = false; // Close gate after one increment
      } else {
        // Window expired, close gate
        willSaveFormatGateOpen = false;
      }
    }
    
    // Log milestone (every 10 edits to avoid spam)
    if (pendingFileEditCount % 10 === 0) {
      log(`[CM] ✏️ Recorded ${pendingFileEditCount} file-edit changes`);
    }
  });
  
  context.subscriptions.push(fileEditListener);
  log('[CM] 🧩 File-edit listener registered');
}

/**
 * Unregister file-edit listener
 */
function unregisterFileEditListener(): void {
  if (fileEditListener) {
    fileEditListener.dispose();
    fileEditListener = undefined;
    log('[CM] 🧩 File-edit listener unregistered');
  }
}

/**
 * Probe AI Model Configuration
 * Scans VS Code configuration APIs for model-related settings
 */
// NOTE: probeAiModel and its related debug output were intentionally removed.
// The probe introduced a developer-only command `chaosmonkeyTelemetry.probeAiModel`
// which should not be exposed in release builds. The implementation and
// registration were removed from the activation flow and documentation.

/**
 * P0-G: Attempt proactive token renewal before expiry.
 *
 * Called when the token is within 14 days of expiry.
 * Throttled by lastRenewalAttempt to prevent renewal storms (5-min minimum).
 * On success, updates the connection profile with the new expires_at.
 * On failure, the existing token remains usable until it actually expires.
 */
async function attemptProactiveRenewal(context: vscode.ExtensionContext): Promise<void> {
  if (!authStateManager || !authStateManager.isRenewalAllowed()) {
    log('[CM] 🔄 Renewal skipped: throttle active');
    return;
  }

  authStateManager.recordRenewalAttempt();

  const token = await context.secrets.get('chaosmonkey.authToken');
  if (!token) {
    log('[CM] 🔄 Renewal skipped: no token in SecretStorage');
    return;
  }

  const apiBaseUrl = config.apiBaseUrl;
  if (!apiBaseUrl) {
    log('[CM] 🔄 Renewal skipped: no API base URL configured');
    return;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/ide/connect/renew`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (response.ok) {
      const body = await response.json() as { expires_at?: string; renewed?: boolean };
      if (body.expires_at) {
        // Update the connection profile with the new expires_at
        const profile = context.globalState.get<any>('chaosmonkey.connectionProfile');
        if (profile) {
          profile.expires_at = body.expires_at;
          await context.globalState.update('chaosmonkey.connectionProfile', profile);
        }
        log(`[CM] 🔄 Renewal successful (renewed: ${body.renewed}, expires_at: ${body.expires_at})`);
      }
    } else if (response.status === 401) {
      // Token is no longer valid — enter AUTH_REQUIRED
      log('[CM] 🔄 Renewal failed: 401 — entering AUTH_REQUIRED');
      if (authStateManager) {
        authStateManager.setState('AUTH_REQUIRED');
      }
      isConnected = false;
    } else if (response.status === 403) {
      // Not an installation token or other authorization issue
      log('[CM] 🔄 Renewal failed: 403 — token may not be renewable');
      // Don't change auth state — token may still work for telemetry
    } else {
      log(`[CM] 🔄 Renewal failed: HTTP ${response.status}`);
      // Transient failure — token remains usable
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`[CM] 🔄 Renewal failed (network): ${errorMessage}`);
    // Transient failure — token remains usable
  }
}

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext) {
  // Store extension context globally for metadata access
  extensionContext = context;

  // Initialize stable identity contract (installation_id, optional developer_id, team_id)
  // MUST be awaited before any telemetry events are built or listeners are registered
  await initializeIdentity(context);

  // Create output channel
  outputChannel = vscode.window.createOutputChannel('ChaosMonkey Telemetry');
  context.subscriptions.push(outputChannel);

  log('[CM] Editor detected', {
    editor_source: EDITOR_SOURCE,
    appName: vscode.env.appName,
    uriScheme: vscode.env.uriScheme
  });
  
  // STEP 2: Extension metadata diagnostics
  const ext = vscode.extensions.getExtension('chaosmonkey.chaosmonkey-telemetry');
  log('[CM] Extension meta', {
    id: ext?.id,
    version: ext?.packageJSON?.version,
    hasProbeContribution: !!ext?.packageJSON?.contributes?.commands?.some(
      (c: any) => c.command === 'chaosmonkeyTelemetry.probeAiModel'
    )
  });
  
  const extensionVersion = getExtensionVersion();
  log(`🚀 ChaosMonkey Telemetry Extension Activated (version ${extensionVersion})`);
  console.log(`[ChaosMonkey] VS Code extension activated, version ${extensionVersion}`);
  
  // Load configuration
  config = loadConfiguration();
  log('⚙️ Configuration loaded:', {
    apiBaseUrl: config.apiBaseUrl,
    enabled: config.enabled,
    flushInterval: config.flushInterval
  });

  // Phase 4: Restore connection state from SecretStorage
  // P0-G: Initialize durable queue and auth state manager
  durableQueue = new DurableTelemetryQueue(context);
  durableQueue.load();
  log(`📦 Durable telemetry queue loaded (${durableQueue.length()} pending events)`);

  authStateManager = new AuthStateManager(context);

  // Create persistent status bar item
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  context.subscriptions.push(statusBar);
  authStateManager.setStatusBar(statusBar);

  const storedToken = await context.secrets.get('chaosmonkey.authToken');
  if (storedToken) {
    const profile = context.globalState.get<any>('chaosmonkey.connectionProfile');
    if (profile) {
      // Restore apiBaseUrl from profile if config doesn't have it
      if (!config.apiBaseUrl && profile.apiBaseUrl) {
        config.apiBaseUrl = profile.apiBaseUrl;
      }
      // Restore backend-claimed identity
      setBackendClaimedIdentity({
        developer_id: profile.developer_id,
        team_id: profile.team_id,
        organization_id: profile.organization_id ?? null,
        identity_source: 'backend_claimed'
      });
      log('[CM] ✅ Connection restored from SecretStorage', {
        developer_id: profile.developer_id,
        identity_source: profile.identity_source,
      });
    }

    // P0-G: Check if token is expired before setting connected
    const profileData = context.globalState.get<any>('chaosmonkey.connectionProfile');
    const expiresAt = profileData?.expires_at;
    if (expiresAt) {
      const expiryDate = new Date(expiresAt);
      if (expiryDate <= new Date()) {
        // Token expired — enter AUTH_REQUIRED, but keep queue
        log('[CM] ⚠️ Stored token has expired — entering AUTH_REQUIRED state');
        isConnected = false;
        authStateManager.setState('AUTH_REQUIRED');
      } else {
        isConnected = true;
        authStateManager.setState('CONNECTED');
        // P0-G: Check if proactive renewal is needed
        const daysUntilExpiry = (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        if (daysUntilExpiry <= 14) {
          log(`[CM] 🔄 Token expires in ${daysUntilExpiry.toFixed(1)} days — will attempt proactive renewal`);
          attemptProactiveRenewal(context).catch((err) => {
            log(`[CM] ⚠️ Proactive renewal failed: ${err.message}`);
          });
        }
      }
    } else {
      // No expiry info — assume connected
      isConnected = true;
      authStateManager.setState('CONNECTED');
    }
  } else {
    log('[CM] Not connected — run ChaosMonkey: Connect to start sending telemetry');
    authStateManager.setState('AUTH_REQUIRED');
  }

  // Initialize telemetry queue and reliable delivery state
  telemetryQueue = []; // P0-G: durableQueue is authoritative now
  consecutiveFlushFailures = 0;
  nextAllowedFlushAt = 0;
  log('📦 Telemetry queue initialized (reliable delivery v1.1 / P0-G durable)');
  
  // Initialize activity-based session tracking
  // Sessions start automatically on first activity (file_edit, ai_accept, commit)
  // and end after 10 minutes of idle time or on extension deactivation
  
  // Register test command
  const testCommand = vscode.commands.registerCommand(
    'chaosmonkeyTelemetry.sendTestEvent',
    () => {
      if (!isConnected) {
        vscode.window.showWarningMessage('ChaosMonkey: Run ChaosMonkey: Connect first');
        log('⚠️ Send Test Event invoked but not connected');
        return;
      }

      const testEvent: TelemetryEvent = {
        event_type: 'test_init',
        count: 1,
        timestamp: new Date().toISOString(),
        metadata: buildEventMetadata('test_init', {
          test_mode: true
        }, extensionContext)
      };
      
      queueEvent(testEvent);
      
      vscode.window.showInformationMessage(
        `ChaosMonkey: Test event queued (${telemetryQueue.length} events in queue)`
      );
    }
  );
  context.subscriptions.push(testCommand);
  log('✅ Command registered: chaosmonkeyTelemetry.sendTestEvent');

  // Register flush-now command (manual trigger for evidence capture)
  const flushNowCommand = vscode.commands.registerCommand(
    'chaosmonkeyTelemetry.flushNow',
    async () => {
      await flushQueueNow();
      vscode.window.showInformationMessage('ChaosMonkey: Flush requested');
    }
  );
  context.subscriptions.push(flushNowCommand);
  log('✅ Command registered: chaosmonkeyTelemetry.flushNow');
  
  // Register AI accept command
  const aiAcceptCommand = vscode.commands.registerCommand(
    'chaosmonkeyTelemetry.recordAiAccept',
    () => {
      if (!config.enabled) {
        vscode.window.showWarningMessage('ChaosMonkey: Telemetry is disabled in settings');
        log('⚠️ AI accept command invoked but telemetry is disabled');
        return;
      }

      // Mark activity for session tracking (with trigger for Git context retry)
      markActivity('ai_accept');
      
      // CRITICAL: Mark that AI was used in this session (for ai_usage_duration_ms calculation)
      hasAiUsage = true;

      const aiAcceptEvent: TelemetryEvent = {
        event_type: 'ai_accept',
        count: 1,
        timestamp: new Date().toISOString(),
        metadata: buildEventMetadata('ai_accept', {
          trigger: 'command',
          test_mode: true
        }, extensionContext)
      };
      
      queueEvent(aiAcceptEvent);
      
      vscode.window.showInformationMessage(
        `ChaosMonkey: AI accept event queued (${telemetryQueue.length} events in queue)`
      );
      
      log(`[CM] 📊 AI accept event queued`, aiAcceptEvent);
    }
  );
  context.subscriptions.push(aiAcceptCommand);
  log('✅ Command registered: chaosmonkeyTelemetry.recordAiAccept');
  
  // Register commit command
  const commitCommand = vscode.commands.registerCommand(
    'chaosmonkeyTelemetry.recordCommit',
    () => {
      if (!config.enabled) {
        vscode.window.showWarningMessage('ChaosMonkey: Telemetry is disabled in settings');
        log('⚠️ Commit command invoked but telemetry is disabled');
        return;
      }

      // Mark activity for session tracking (with trigger for Git context retry)
      markActivity('commit');

      // Track real commit evidence
      sessionCommitCount++;

      // Track first commit timestamp for Time to First Commit (TTFC) calculation
      if (firstCommitAt === null && currentSessionStart !== null) {
        firstCommitAt = Date.now();
        log(`[ChaosMonkey] First commit in session ${currentSessionId}: TTFC will be ${firstCommitAt - currentSessionStart}ms`);
      }

      const commitEvent: TelemetryEvent = {
        event_type: 'commit',
        count: 1,
        timestamp: new Date().toISOString(),
        metadata: buildEventMetadata('commit', {
          trigger: 'command',
          test_mode: true
        }, extensionContext)
      };
      
      queueEvent(commitEvent);
      
      vscode.window.showInformationMessage(
        `ChaosMonkey: Commit event queued (${telemetryQueue.length} events in queue)`
      );
      
      log(`[CM] 📊 Commit event queued`, commitEvent);
    }
  );
  context.subscriptions.push(commitCommand);
  log('✅ Command registered: chaosmonkeyTelemetry.recordCommit');
  
  // [New Side-Car Command] - Git Context Test
  const gitTestCommand = vscode.commands.registerCommand(
    'chaosmonkeyTelemetry.testGitCapture',
    async () => {
      log('[CM] 🧪 Running manual Git Context Test...');
      try {
        const details = await getGitDetails();
        const msg = `Git Context: Branch=${details.branch}, URL=${details.repoUrl}`;
        log(msg);
        vscode.window.showInformationMessage(msg);
      } catch (err) {
        log(`[CM] ⚠️ Git Test Failed: ${err}`);
        vscode.window.showErrorMessage(`Git Test Failed: ${err}`);
      }
    }
  );
  context.subscriptions.push(gitTestCommand);
  log('✅ Command registered: chaosmonkeyTelemetry.testGitCapture');
  
  // Connect ChaosMonkey command — 0.4.0 invite-backed exchange flow
  const connectCommand = vscode.commands.registerCommand(
    'chaosmonkeyTelemetry.connect',
    async () => {
      log('[CM] 🔗 Connecting to ChaosMonkey...');
      try {
        const identity = getIdentity();
        if (!identity || !identity.installation_id) {
          vscode.window.showErrorMessage('Installation identity not initialized. Please reload the window.');
          return;
        }

        const currentConfig = vscode.workspace.getConfiguration('chaosmonkey');
        const currentApiBaseUrl = currentConfig.get<string>('apiBaseUrl') || '';
        const apiBaseUrl = await vscode.window.showInputBox({
          prompt: 'ChaosMonkey API base URL (e.g., https://your-chaosmonkey-server)',
          value: currentApiBaseUrl,
          placeHolder: 'https://your-chaosmonkey-server'
        });

        if (apiBaseUrl === undefined) {
          log('[CM] ❌ Connection cancelled by user');
          return;
        }

        try {
          new URL(apiBaseUrl);
        } catch {
          vscode.window.showErrorMessage('Invalid URL format. Please enter a valid URL.');
          return;
        }

        let connectCode = await vscode.window.showInputBox({
          prompt: 'Enter your ChaosMonkey connect code (e.g., ABCDEFGH-12345678)',
          placeHolder: 'ABCDEFGH-12345678',
          password: true
        });

        if (connectCode === undefined) {
          log('[CM] ❌ Connect code entry cancelled by user');
          return;
        }

        // Normalize connect code on client
        connectCode = connectCode.trim().toUpperCase();

        const extVersion = getExtensionVersion();
        const installationId = identity.installation_id;

        log('[CM] 🔗 Exchanging connect code for bearer token...', {
          apiBaseUrl,
          extension_version: extVersion,
          has_installation_id: true
        });

        const exchangeUrl = `${apiBaseUrl.replace(/\/+$/, '')}/api/ide/connect/exchange`;
        const response = await fetch(exchangeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: connectCode,
            installation_id: installationId,
            extension_version: extVersion
          })
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ error: 'Unknown error' }));
          const errorMsg = (errorBody as { error?: string }).error || `HTTP ${response.status}`;
          log('[CM] ❌ Connect code exchange failed', { status: response.status, error: errorMsg });
          vscode.window.showErrorMessage(`Connection failed: ${errorMsg}`);
          return;
        }

        const body = await response.json() as {
          token: string;
          developer_id: string;
          organization_id: number;
          team_id: string | null;
          installation_id: string;
          identity_source: string;
          expires_at: string;
        };

        await context.secrets.store('chaosmonkey.authToken', body.token);

        const vscodeConfig = vscode.workspace.getConfiguration('chaosmonkey');
        await vscodeConfig.update('apiBaseUrl', apiBaseUrl, vscode.ConfigurationTarget.Global);

        // Phase 5: Persist non-secret connection profile in globalState
        await context.globalState.update('chaosmonkey.connectionProfile', {
          apiBaseUrl,
          installation_id: body.installation_id,
          developer_id: body.developer_id,
          organization_id: body.organization_id,
          team_id: body.team_id,
          identity_source: body.identity_source,
          expires_at: body.expires_at,
        });

        setBackendClaimedIdentity({
          developer_id: body.developer_id,
          team_id: body.team_id,
          organization_id: body.organization_id,
          identity_source: 'backend_claimed'
        });

        // Reset every session counter and pending-event counter; begin from a clean session
        telemetryQueue = [];
        currentSessionId = null;
        currentSessionStart = null;
        lastActivityAt = null;
        firstCommitAt = null;
        pendingFileEditCount = 0;
        editedDocumentUris = new Set<string>();
        sessionCommitCount = 0;

        isConnected = true;

        // P0-G: Set auth state to CONNECTED and start backlog flush
        if (authStateManager) {
          authStateManager.setState('CONNECTED');
        }

        // Start telemetry timers exactly once now that we're connected
        if (config.enabled) {
          startFlushTimer();
          startIdleTimeoutTimer();
        }

        // P0-G: Flush any backlog from the durable queue (e.g. events queued while AUTH_REQUIRED)
        if (durableQueue && durableQueue.length() > 0) {
          log(`[CM] 🔄 Flushing backlog (${durableQueue.length()} events) after reconnect`);
          flushQueueNow().catch((err) => {
            log(`[CM] ⚠️ Backlog flush failed: ${err.message}`);
          });
        }

        log('[CM] ✅ Connect successful — token stored in SecretStorage, connected', {
          developer_id: body.developer_id,
          identity_source: body.identity_source,
          expires_at: body.expires_at
        });

        vscode.window.showInformationMessage(
          'Connected to ChaosMonkey. Telemetry will now be sent with server-authoritative identity.'
        );

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`[CM] ❌ Connection failed: ${errorMessage}`);
        vscode.window.showErrorMessage(`Failed to connect to ChaosMonkey: ${errorMessage}`);
      }
    }
  );
  context.subscriptions.push(connectCommand);
  log('✅ Command registered: chaosmonkeyTelemetry.connect');
  
  // Probe command and watcher removed in release build.
  
  // [New Side-Car Listener] - AI/Paste Detection
  // We use a separate listener to keep the original file tracking logic isolated.
  const aiListener = vscode.workspace.onDidChangeTextDocument((event) => {
    try {
      // Only analyze file:// schemes
      if (event.document.uri.scheme !== 'file') {
        return;
      }

      const analysis = analyzeEvent(event);

      if (analysis.isSuspicious) {
        // Mark activity to keep session alive and track active coding time (with trigger for Git context retry)
        markActivity('ai_burst');
        
        // Mark session as AI-assisted (legacy flag for backward compatibility)
        hasAiUsage = true;
        
        // Increment burst counter
        aiBurstCount++;
        
        // =====================================================================
        // AI ACTIVITY MODEL (v1.3) - Timing & Magnitude Tracking
        // =====================================================================
        // Track WHEN AI activity happened and HOW MUCH content was inserted.
        // This enables defensible AI usage metrics (span, not presence).
        // =====================================================================
        
        // Accumulate magnitude (chars and lines from this burst)
        aiBurstCharsTotal += analysis.charCount;
        aiBurstLinesTotal += analysis.lineCount;
        
        // Track timing (relative to session start for consistency)
        if (currentSessionStart !== null) {
          const nowRelativeMs = Date.now() - currentSessionStart;
          
          // First burst: set first timestamp
          if (aiFirstBurstAtMs === null) {
            aiFirstBurstAtMs = nowRelativeMs;
          }
          
          // Always update last burst timestamp
          aiLastBurstAtMs = nowRelativeMs;
        }
        
        const msg = `[CM] 🤖 AI/Paste Behavior Detected! Reason: ${analysis.reason} (${analysis.lineCount} lines, ${analysis.charCount} chars)`;
        log(msg);
        log(`[CM] 🤖 AI Burst recorded. Session totals: count=${aiBurstCount}, chars=${aiBurstCharsTotal}, lines=${aiBurstLinesTotal}`);

        // Visual Cue: Show a temporary status bar message
        vscode.window.setStatusBarMessage(`ChaosMonkey: 🤖 ${analysis.reason} Detected`, 2000);
      }
    } catch (err) {
      // Fail silently to not disrupt user
      console.error('[CM] AI Heuristic Failed:', err);
    }
  });
  context.subscriptions.push(aiListener);
  log('✅ AI Heuristic Listener registered');
  
  // =========================================================================
  // DEBUG ACTIVITY TRACKING (v1.5) - Debug Session Listeners
  // =========================================================================
  // Track debug sessions started/stopped during ChaosMonkey session.
  // Privacy: No debug config name, args, env vars, or launch.json details.
  // =========================================================================
  
  const debugStartListener = vscode.debug.onDidStartDebugSession(() => {
    try {
      if (!config.enabled) {
        return;
      }
      
      // Increment debug session count
      debugSessionCount += 1;
      
      // Track debug start time (only if not already debugging)
      if (debugActiveStartAt === null) {
        debugActiveStartAt = Date.now();
      }
      
      // Keep telemetry session alive
      markActivity('debug');
      
      log(`[CM] 🐛 Debug session started (session count: ${debugSessionCount})`);
    } catch (err) {
      // Fail silently to not disrupt debugging
      console.error('[CM] Debug start listener failed:', err);
    }
  });
  context.subscriptions.push(debugStartListener);
  
  const debugTerminateListener = vscode.debug.onDidTerminateDebugSession(() => {
    try {
      if (!config.enabled) {
        return;
      }
      
      // Accumulate debug time
      if (debugActiveStartAt !== null) {
        const elapsed = Date.now() - debugActiveStartAt;
        debugTimeMs += elapsed;
        debugActiveStartAt = null;
        log(`[CM] 🐛 Debug session ended (+${elapsed}ms, total: ${debugTimeMs}ms)`);
      } else {
        // Null-safe: terminate without recorded start
        log(`[CM] 🐛 Debug session ended (no active start recorded)`);
      }
    } catch (err) {
      // Fail silently to not disrupt debugging
      console.error('[CM] Debug terminate listener failed:', err);
    }
  });
  context.subscriptions.push(debugTerminateListener);
  
  log('✅ Debug Session Listeners registered');
  
  // =========================================================================
  // SAVE + FORMAT-ON-SAVE TRACKING (v1.1) - Save Listeners
  // =========================================================================
  // Track file saves and infer format-on-save behavior.
  // Privacy: No filenames, paths, URIs, or formatter/extension names.
  // =========================================================================
  
  // onWillSaveTextDocument: opens the format-likely gate
  const willSaveListener = vscode.workspace.onWillSaveTextDocument((event) => {
    try {
      if (!config.enabled) {
        return;
      }
      
      // Only track file:// scheme
      if (event.document.uri.scheme !== 'file') {
        return;
      }
      
      willSaveTotalCount += 1;
      lastWillSaveAt = Date.now();
      willSaveFormatGateOpen = true;
    } catch (err) {
      // Fail silently
      console.error('[CM] Will-save listener failed:', err);
    }
  });
  context.subscriptions.push(willSaveListener);
  
  // onDidSaveTextDocument: counts successful saves
  const didSaveListener = vscode.workspace.onDidSaveTextDocument((document) => {
    try {
      if (!config.enabled) {
        return;
      }
      
      // Only track file:// scheme
      if (document.uri.scheme !== 'file') {
        return;
      }
      
      fileSaveCount += 1;
      
      // Keep session alive (uses existing trigger type)
      markActivity('file_edit');
    } catch (err) {
      // Fail silently
      console.error('[CM] Did-save listener failed:', err);
    }
  });
  context.subscriptions.push(didSaveListener);
  
  log('✅ Save + Format-on-Save Listeners registered');
  
  // =========================================================================
  // TERMINAL ACTIVITY TRACKING (v1.2) - Terminal Listeners
  // =========================================================================
  // Track terminal opens and active time as proxy for build/test/ops work.
  // Privacy: No commands, titles, cwd, shell, or env captured.
  // =========================================================================
  
  // onDidOpenTerminal: counts terminal opens
  const terminalOpenListener = vscode.window.onDidOpenTerminal(() => {
    try {
      if (!config.enabled) {
        return;
      }
      
      terminalOpenCount += 1;
      markActivity('debug'); // Keep session alive
      
      log(`[CM] 💻 Terminal opened (count: ${terminalOpenCount})`);
    } catch (err) {
      // Fail silently
      console.error('[CM] Terminal open listener failed:', err);
    }
  });
  context.subscriptions.push(terminalOpenListener);
  
  // onDidChangeActiveTerminal: tracks time spent with terminal active
  const terminalChangeListener = vscode.window.onDidChangeActiveTerminal((terminal) => {
    try {
      if (!config.enabled) {
        return;
      }
      
      const now = Date.now();
      
      // Close prior interval if one was open
      if (terminalBecameActiveAt !== null) {
        const elapsed = now - terminalBecameActiveAt;
        terminalActiveTimeMs += elapsed;
        terminalBecameActiveAt = null;
      }
      
      // Open new interval if a terminal is now active
      if (terminal) {
        terminalBecameActiveAt = now;
        markActivity('debug'); // Keep session alive
      }
    } catch (err) {
      // Fail silently
      console.error('[CM] Terminal change listener failed:', err);
    }
  });
  context.subscriptions.push(terminalChangeListener);
  
  log('✅ Terminal Activity Listeners registered');
  
  // [New Side-Car Listener] - Automated Git Commit Detection
  // Fires when HEAD.commit changes in any watched repository
  console.log('[ChaosMonkey] About to register commit listener...');
  const commitListenerDisposables = await registerCommitListener((info: CommitInfo) => {
    try {
      if (!config.enabled || !isConnected) {
        return;
      }

      console.log(`[ChaosMonkey] ✅ COMMIT DETECTED IN CALLBACK: ${info.commitHash.substring(0, 7)}`);
      log(`[CM] 🟢 Real Git Commit Detected! Hash: ${info.commitHash.substring(0, 7)}`);

      // Mark activity for session tracking (with trigger for Git context retry)
      markActivity('commit');

      // Track real commit evidence
      sessionCommitCount++;

      // Track first commit timestamp for Time to First Commit (TTFC) calculation
      if (firstCommitAt === null && currentSessionStart !== null) {
        firstCommitAt = Date.now();
        log(`[ChaosMonkey] First commit in session ${currentSessionId}: TTFC will be ${firstCommitAt - currentSessionStart}ms`);
      }

      // Queue commit telemetry event
      const commitEvent: TelemetryEvent = {
        event_type: 'commit',
        count: 1,
        timestamp: new Date().toISOString(),
        metadata: buildEventMetadata('commit', {
          trigger: 'auto', // Automated detection (not manual command)
          git_commit_hash: info.commitHash,
          // Override Git context with commit-specific values (more accurate)
          git_branch: info.branch,
          git_repo_url: info.repoUrl
        }, extensionContext)
      };
      
      queueEvent(commitEvent);
      
      log(`[CM] 📊 Commit event queued`, commitEvent);

      // Visual feedback
      vscode.window.showInformationMessage(`ChaosMonkey: Commit Recorded 🟢`);

    } catch (err) {
      console.error('[CM] Commit listener callback failed:', err);
    }
  });
  
  // Register disposables for cleanup
  commitListenerDisposables.forEach(d => context.subscriptions.push(d));
  console.log(`[ChaosMonkey] ✅ Commit listener registered with ${commitListenerDisposables.length} disposables`);
  log(`✅ Git Commit Listener registered (${commitListenerDisposables.length} disposables)`);
  
  // Register file-edit listener
  registerFileEditListener(context);
  
  // Start periodic flush timer (only if connected)
  if (config.enabled && isConnected) {
    startFlushTimer();
    startIdleTimeoutTimer();
  } else if (config.enabled && !isConnected) {
    log('⚠️ Telemetry enabled but not connected — timers will start after Connect');
  } else {
    log('⚠️ Telemetry disabled in settings, flush timer not started');
  }
  
  // Watch for configuration changes
  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('chaosmonkey')) {
      log('🔄 Configuration changed, reloading...');
      const oldConfig = { ...config };
      config = loadConfiguration();
      
      log('⚙️ New configuration:', {
        apiBaseUrl: config.apiBaseUrl,
        enabled: config.enabled,
        flushInterval: config.flushInterval
      });
      
      // Restart flush timer if interval changed
      if (oldConfig.flushInterval !== config.flushInterval) {
        log(`⏰ Flush interval changed: ${oldConfig.flushInterval}s → ${config.flushInterval}s`);
        if (flushTimer) {
          clearInterval(flushTimer);
        }
        startFlushTimer();
      }
      
      // Restart timer if interval changed or enabled/disabled
      if (
        oldConfig.enabled !== config.enabled ||
        oldConfig.flushInterval !== config.flushInterval
      ) {
        stopFlushTimer();
        if (config.enabled) {
          startFlushTimer();
        }
      }
    }
  });
  context.subscriptions.push(configWatcher);
  
  // Show output channel (optional - user can open manually)
  log('💡 Extension ready! Open "ChaosMonkey Telemetry" in Output panel to see logs.');
  log('💡 Try: Ctrl/Cmd+Shift+P → "ChaosMonkey: Send Test Event"');
  log('💡 Try: Ctrl/Cmd+Shift+P → "ChaosMonkey: Record AI Suggestion Accepted"');
}

/**
 * Extension deactivation
 * 
 * NOTE: VS Code may kill the extension host shortly after deactivate().
 * We explicitly end any active session and synchronously flush the queue
 * so the final "shutdown" session event is not lost.
 */
export async function deactivate(): Promise<void> {
  console.log('[ChaosMonkey] Extension deactivating – cleaning up sessions and flushing queue');
  log('🛑 Extension Deactivating...');
  
  // Stop idle timeout timer
  if (idleTimeoutTimer) {
    clearInterval(idleTimeoutTimer);
    idleTimeoutTimer = undefined;
    console.log('[ChaosMonkey] Idle timeout timer cleared during deactivate()');
    log('[ChaosMonkey] Idle timeout timer cleared during deactivate()');
  }
  
  // Stop flush timer
  stopFlushTimer();
  
  // Unregister file-edit listener
  unregisterFileEditListener();
  
  // End active session, if any
  if (currentSessionId !== null) {
    console.log('[ChaosMonkey] Active session detected during deactivate(), ending with reason="shutdown"');
    log('[ChaosMonkey] Active session detected during deactivate(), ending with reason="shutdown"');
    try {
      endSession('shutdown');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[ChaosMonkey] Error during deactivate session logging:', err);
      log(`[CM] ⚠️ Error during deactivate session logging: ${errorMessage}`);
    }
  } else {
    console.log('[ChaosMonkey] No active session during deactivate()');
    log('[ChaosMonkey] No active session during deactivate()');
  }
  
  // Flush any queued events (including the session event) synchronously
  // This ensures the shutdown session event is sent before VS Code kills the extension host
  await flushQueueNow();
  
  console.log('[ChaosMonkey] deactivate() complete – session (if any) ended and queue flushed');
  log('👋 ChaosMonkey Telemetry Extension Deactivated');
}

