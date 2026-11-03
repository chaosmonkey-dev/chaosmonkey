import { isV2ShadowEnabled } from './shadow';

// Module-level flag for one-time POINT_4 diagnostic logging
let v2DiagnosticPoint4Logged = false;

export type NormalizedV2Session = {
  session_id: string;
  timestamp: string;
  session_start_timestamp: string | null;
  session_end_timestamp: string | null;
  session_start_timestamp_is_derived: boolean;

  // For compatibility with existing v2 primitives code (which expects v1 SessionDataPoint field names)
  duration_ms: number | null;
  time_to_first_commit_ms: number | null;
  commit_count?: number | null;

  focus_ratio: number | null;
  idle_ratio: number | null;
  rework_ratio_est: number | null;

  ai_chars_per_min: number | null;
  ai_burst_count: number | null;
  ai_burst_chars_total: number | null;
  ai_first_burst_at_ms: number | null;
  ai_last_burst_at_ms: number | null;
  ai_active_span_ms: number | null;
  active_coding_duration_ms: number | null;

  lines_added_total: number | null;
  lines_removed_total_est: number | null;
  chars_added_total?: number | null;
  chars_removed_total_est?: number | null;

  git_repo_url: string | null;
  git_branch: string | null;

  tool?: 'cursor' | 'windsurf' | 'devin' | 'claude_code' | 'vscode' | 'unknown';
  flow_profile?: string | null;
};

export type V2NormalizeDebug = {
  toolRawCounts: Record<string, number>;
  toolCanonicalCounts: Record<string, number>;
  toolDroppedCount: number;
  toolChosenPathCounts: Record<string, number>;
  toolChosenPathBySessionId: Record<string, string>;
  toolRawBySessionId: Record<string, any>;
};

function getByDotPath(obj: any, path: string): any {
  if (!obj) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function getFirstDefined(obj: any, paths: string[]): any {
  for (const p of paths) {
    const v = getByDotPath(obj, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function asNumberOrNull(v: any): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNumber(v: any): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStringOrNull(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s.length > 0 ? s : null;
}

function parseTimestamp(v: any): string | null {
  if (v === undefined || v === null) return null;
  try {
    const d = typeof v === 'string' ? new Date(v) : (v instanceof Date ? v : new Date(String(v)));
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

function normalizeToolValue(v: any, metadata?: any): 'cursor' | 'windsurf' | 'devin' | 'claude_code' | 'vscode' | 'unknown' {
  const s = asStringOrNull(v);
  if (!s) return 'unknown';
  const trimmed = s.trim();
  if (!trimmed) return 'unknown';
  const key = trimmed.toLowerCase();
  
  // DEBUG: Log unknown tool values for investigation
  if (import.meta.env.DEV) {
    if (!key.includes('cursor') && !key.includes('windsurf') && !key.includes('devin') &&
        !key.includes('vscode') && !key.includes('visual studio') && !key.includes('vs-code') &&
        !key.includes('claude') && !key.includes('claude_code') && !key.includes('claude-code')) {
      console.log('[TOOL_NORMALIZATION_DEBUG] Unknown tool value:', { 
        original: v, 
        normalized: key, 
        length: key.length 
      });
    }
  }
  
  // Map to exactly: devin, cursor, windsurf, claude_code, vscode, or unknown
  // Priority: product-specific hosts > generic VS Code host
  
  // Devin variants - highest priority
  if (key === 'devin' || key.startsWith('devin-') || key.includes('devin') ||
      key === 'devin-editor' || key.startsWith('devin_')) {
    return 'devin';
  }
  
  // Cursor variants
  if (key === 'cursor' || key.startsWith('cursor-') || key.includes('cursor') ||
      key === 'cursor-editor' || key.startsWith('cursor_')) {
    return 'cursor';
  }
  
  // Windsurf variants
  if (key === 'windsurf' || key.startsWith('windsurf-') || 
      key === 'codeium-windsurf' || key.includes('windsurf') ||
      key === 'windsurf-editor' || key.startsWith('windsurf_')) {
    return 'windsurf';
  }
  
  // Claude Code variants - check metadata for Claude Code signals
  // Priority: explicit claude_code tool > metadata signals > vscode
  if (key === 'claude_code' || key === 'claude-code' || key === 'claudecode' ||
      key.includes('claude_code') || key.includes('claude-code')) {
    return 'claude_code';
  }
  
  // Check metadata for Claude Code signals when tool is vscode
  if (metadata) {
    const vscodeVersion = asStringOrNull(metadata.vscode_version);
    const extensionVersion = asStringOrNull(metadata.extension_version);
    
    // If vscode_version is claude-code or extension_version contains cc-bridge, treat as Claude Code
    if (vscodeVersion === 'claude-code' || 
        (extensionVersion && extensionVersion.includes('cc-bridge'))) {
      return 'claude_code';
    }
  }
  
  // VS Code variants - only when no product-specific signal exists
  if (key === 'vscode' || key === 'vs-code' || key === 'vs code' || 
      key === 'visual studio code' || key === 'visual-studio-code' ||
      key.includes('vscode') || key.includes('visual-studio') ||
      key === 'vs_code' || key === 'vs-code-editor' ||
      key.startsWith('vscode') || key.startsWith('visual-studio')) {
    return 'vscode';
  }
  
  // Everything else maps to unknown
  return 'unknown';
}

function bumpCount(m: Record<string, number>, k: any) {
  const key = (k === undefined || k === null) ? 'null' : String(k);
  m[key] = (m[key] || 0) + 1;
}

function isNonEmptyString(v: any): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

function getFirstDefinedWithPath(obj: any, paths: string[]): { value: any; path?: string } {
  for (const p of paths) {
    const v = getByDotPath(obj, p);
    if (isNonEmptyString(v)) return { value: v, path: p };
  }
  return { value: undefined };
}

function normalizeV2SessionsInternal(
  inputRows: any[],
  collectDebug: boolean
): { sessions: NormalizedV2Session[]; debug?: V2NormalizeDebug } {
  const rows = Array.isArray(inputRows) ? inputRows : [];
  const debug: V2NormalizeDebug | undefined = collectDebug ? {
    toolRawCounts: {},
    toolCanonicalCounts: {},
    toolDroppedCount: 0,
    toolChosenPathCounts: {},
    toolChosenPathBySessionId: {},
    toolRawBySessionId: {},
  } : undefined;

  const sessions = rows.map((r, idx) => {
    // Defensive: sometimes metadata can be a JSON string. Normalize to a plain object when possible.
    let metadataObj: any = {};
    try {
      const m = (r as any)?.metadata;
      if (m && typeof m === 'object' && !Array.isArray(m)) {
        metadataObj = m;
      } else if (typeof m === 'string') {
        const parsed = JSON.parse(m);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          metadataObj = parsed;
        }
      }
    } catch {
      metadataObj = {};
    }

    const row = (r && typeof r === 'object') ? { ...r, metadata: metadataObj } : { metadata: metadataObj };

    const sessionId = getFirstDefined(row, [
      'session_id',
      'sessionId',
      'metadata.session_id',
      'metadata.sessionId',
    ]);

    const timestamp = getFirstDefined(row, [
      'timestamp',
      'time',
      'metadata.timestamp',
      'metadata.time',
    ]);

    const toolPaths = [
      // explicit tool-ish fields (treat row.tool as top priority)
      'tool',
      'tool_raw',
      'editor_source',
      'source',
      'ide',
      'client',
      'appName',
      'uriScheme',
      'client_source',
      'session_source',

      // nested metadata candidates
      'metadata.tool',
      'metadata.tool_raw',
      'metadata.editor_source',
      'metadata.source',
      'metadata.ide',
      'metadata.client',
      'metadata.appName',
      'metadata.uriScheme',
      'metadata.client_source',
      'metadata.session_source',
    ];

    const toolPick = getFirstDefinedWithPath(row, toolPaths);
    const toolRaw = toolPick.value;
    const toolCanonical = normalizeToolValue(toolRaw, metadataObj);

    // POINT #4: V2 diagnostic - first normalized session tool inputs (DISABLED to prevent infinite recursion)
    if (false && isV2ShadowEnabled() && !v2DiagnosticPoint4Logged && idx === 0) {
      v2DiagnosticPoint4Logged = true
      
      // Collect all candidate values
      const candidates: Record<string, { value: any; type: string; exists: boolean }> = {}
      for (const path of toolPaths) {
        const value = getByDotPath(row, path)
        candidates[path] = {
          value,
          type: typeof value,
          exists: value !== undefined
        }
      }
      
      // DISABLED: console.groupCollapsed('[V2_DIAGNOSTIC][POINT_4] First normalized session tool inputs')
      // DISABLED: console.log('Row (first session being normalized):', row)
      // DISABLED: console.log('All candidate values:', candidates)
      // DISABLED: console.log('Chosen path:', toolPick.path || 'none')
      // DISABLED: console.log('Chosen raw value:', toolRaw)
      // DISABLED: console.log('Final canonical tool result:', toolCanonical)
      // DISABLED: console.log('Session ID:', sessionId)
      // DISABLED: console.groupEnd()
    }

    const durationMs = getFirstDefined(row, [
      'session_duration_ms',
      'sessionDurationMs',
      'duration_ms',
      'durationMs',
      'metadata.session_duration_ms',
      'metadata.sessionDurationMs',
      'metadata.duration_ms',
      'metadata.durationMs',
    ]);

    const ttfcMs = getFirstDefined(row, [
      'time_to_first_commit_ms',
      'timeToFirstCommitMs',
      'metadata.time_to_first_commit_ms',
      'metadata.timeToFirstCommitMs',
    ]);

    const commitCount = getFirstDefined(row, [
      'commit_count',
      'commitCount',
      'commits',
      'metadata.commit_count',
      'metadata.commitCount',
      'metadata.commits',
    ]);

    const focusRatio = getFirstDefined(row, [
      'focus_ratio',
      'focusRatio',
      'metadata.focus_ratio',
      'metadata.focusRatio',
    ]);

    const idleRatio = getFirstDefined(row, [
      'idle_ratio',
      'idleRatio',
      'metadata.idle_ratio',
      'metadata.idleRatio',
    ]);

    const reworkRatio = getFirstDefined(row, [
      'rework_ratio_est',
      'reworkRatioEst',
      'metadata.rework_ratio_est',
      'metadata.reworkRatioEst',
    ]);

    const aiCharsPerMin = getFirstDefined(row, [
      'ai_chars_per_min',
      'aiCharsPerMin',
      'metadata.ai_chars_per_min',
      'metadata.aiCharsPerMin',
    ]);

    const aiBurstCount = getFirstDefined(row, [
      'ai_burst_count',
      'aiBurstCount',
      'metadata.ai_burst_count',
      'metadata.aiBurstCount',
    ]);

    const aiBurstCharsTotal = getFirstDefined(row, [
      'ai_burst_chars_total',
      'aiBurstCharsTotal',
      'metadata.ai_burst_chars_total',
      'metadata.aiBurstCharsTotal',
    ]);

    const aiFirstBurstAtMs = getFirstDefined(row, [
      'ai_first_burst_at_ms',
      'aiFirstBurstAtMs',
      'metadata.ai_first_burst_at_ms',
      'metadata.aiFirstBurstAtMs',
    ]);

    const aiLastBurstAtMs = getFirstDefined(row, [
      'ai_last_burst_at_ms',
      'aiLastBurstAtMs',
      'metadata.ai_last_burst_at_ms',
      'metadata.aiLastBurstAtMs',
    ]);

    const aiActiveSpanMs = getFirstDefined(row, [
      'ai_active_span_ms',
      'aiActiveSpanMs',
      'metadata.ai_active_span_ms',
      'metadata.aiActiveSpanMs',
    ]);

    const activeCodingDurationMs = getFirstDefined(row, [
      'active_coding_duration_ms',
      'activeCodingDurationMs',
      'metadata.active_coding_duration_ms',
      'metadata.activeCodingDurationMs',
    ]);

    const gitRepoUrl = getFirstDefined(row, [
      'git_repo_url',
      'gitRepoUrl',
      'metadata.git_repo_url',
      'metadata.gitRepoUrl',
    ]);

    const gitBranch = getFirstDefined(row, [
      'git_branch',
      'gitBranch',
      'metadata.git_branch',
      'metadata.gitBranch',
    ]);

    const flowProfile = getFirstDefined(row, [
      'flow_profile',
      'flowProfile',
      'metadata.flow_profile',
      'metadata.flowProfile',
    ]);

    const linesAddedTotal = getFirstDefined(row, [
      'lines_added_total',
      'linesAddedTotal',
      'metadata.lines_added_total',
      'metadata.linesAddedTotal',
    ]);

    const linesRemovedTotalEst = getFirstDefined(row, [
      'lines_removed_total_est',
      'linesRemovedTotalEst',
      'metadata.lines_removed_total_est',
      'metadata.linesRemovedTotalEst',
    ]);

    const charsAddedTotal = getFirstDefined(row, [
      'chars_added_total',
      'charsAddedTotal',
      'metadata.chars_added_total',
      'metadata.charsAddedTotal',
    ]);

    const charsRemovedTotalEst = getFirstDefined(row, [
      'chars_removed_total_est',
      'charsRemovedTotalEst',
      'metadata.chars_removed_total_est',
      'metadata.charsRemovedTotalEst',
    ]);

    // Session start/end timestamp support
    const sessionStartTimestampRaw = getFirstDefined(row, [
      'metadata.session_start_timestamp',
      'metadata.sessionStartTimestamp',
      'session_start_timestamp',
      'sessionStartTimestamp',
    ]);
    const sessionEndTimestampRaw = getFirstDefined(row, [
      'metadata.session_end_timestamp',
      'metadata.sessionEndTimestamp',
      'session_end_timestamp',
      'sessionEndTimestamp',
      'timestamp',
      'time',
    ]);

    const sessionEndTimestamp = parseTimestamp(sessionEndTimestampRaw);
    const sessionStartTimestampRawParsed = parseTimestamp(sessionStartTimestampRaw);
    const durationMsNum = toNumber(durationMs);

    let sessionStartTimestamp: string | null = sessionStartTimestampRawParsed;
    let sessionStartTimestampIsDerived = false;

    if (!sessionStartTimestamp && sessionEndTimestamp && durationMsNum != null && durationMsNum > 0) {
      try {
        const endDate = new Date(sessionEndTimestamp);
        if (!isNaN(endDate.getTime())) {
          const startDate = new Date(endDate.getTime() - durationMsNum);
          sessionStartTimestamp = startDate.toISOString();
          sessionStartTimestampIsDerived = true;
        }
      } catch {
        // keep null
      }
    }

    const idKey = String(sessionId ?? idx);
    if (debug) {
      bumpCount(debug.toolRawCounts, toolRaw);
      bumpCount(debug.toolCanonicalCounts, toolCanonical);
      if (toolRaw !== undefined && toolRaw !== null && String(toolRaw).trim() !== '' && toolCanonical === 'unknown') {
        debug.toolDroppedCount += 1;
      }
      const p = toolPick.path || 'none';
      debug.toolChosenPathCounts[p] = (debug.toolChosenPathCounts[p] || 0) + 1;
      debug.toolChosenPathBySessionId[idKey] = p;
      debug.toolRawBySessionId[idKey] = toolRaw;
    }

    return {
      session_id: idKey,
      timestamp: String(timestamp ?? ''),
      session_start_timestamp: sessionStartTimestamp,
      session_end_timestamp: sessionEndTimestamp,
      session_start_timestamp_is_derived: sessionStartTimestampIsDerived,
      duration_ms: durationMsNum,
      time_to_first_commit_ms: toNumber(ttfcMs),
      commit_count: toNumber(commitCount),
      focus_ratio: toNumber(focusRatio),
      idle_ratio: toNumber(idleRatio),
      rework_ratio_est: toNumber(reworkRatio),
      ai_chars_per_min: toNumber(aiCharsPerMin),
      ai_burst_count: toNumber(aiBurstCount),
      ai_burst_chars_total: toNumber(aiBurstCharsTotal),
      ai_first_burst_at_ms: toNumber(aiFirstBurstAtMs),
      ai_last_burst_at_ms: toNumber(aiLastBurstAtMs),
      ai_active_span_ms: toNumber(aiActiveSpanMs),
      active_coding_duration_ms: toNumber(activeCodingDurationMs),
      lines_added_total: toNumber(linesAddedTotal),
      lines_removed_total_est: toNumber(linesRemovedTotalEst),
      git_repo_url: asStringOrNull(gitRepoUrl),
      git_branch: asStringOrNull(gitBranch),
      tool: toolCanonical,
      flow_profile: flowProfile != null ? String(flowProfile).trim() : null,
      chars_added_total: toNumber(charsAddedTotal),
      chars_removed_total_est: toNumber(charsRemovedTotalEst),
    };
  });

  return { sessions, debug };
}

/**
 * V2 normalizer exists because session telemetry may arrive in different shapes
 * (flat fields vs nested metadata; alternate naming conventions).
 * This is v2-preview-only and must not affect v1 behavior.
 */
export function normalizeV2Sessions(inputRows: any[]): NormalizedV2Session[] {
  return normalizeV2SessionsInternal(inputRows, false).sessions;
}

export function normalizeV2SessionsWithDebug(inputRows: any[]): { sessions: NormalizedV2Session[]; debug: V2NormalizeDebug } {
  const res = normalizeV2SessionsInternal(inputRows, true);
  return { sessions: res.sessions, debug: res.debug as V2NormalizeDebug };
}

// Export tool normalization for use in computeSessionPrimitives
export { normalizeToolValue };
