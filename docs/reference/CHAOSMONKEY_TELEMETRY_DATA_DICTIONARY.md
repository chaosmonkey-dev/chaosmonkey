# ChaosMonkey Telemetry Data Dictionary

> **Scope:** This document describes the current standard VS Code-compatible
> IDE-extension telemetry contract.
>
> ChaosMonkey also supports Claude Code terminal telemetry through a separate
> hook-based adapter. Because hook availability differs from IDE APIs, field
> availability can differ by collection surface. This document does not claim
> to be the exact field contract for the Claude Code terminal adapter.
>
> This document inventories every materially transmitted telemetry category
> from the current IDE extension source code and backend ingestion contract.
> All field names are verified against current source. No field is included
> based on older schemas alone.
>
> Example values shown are illustrative shapes only — not real customer data.

---

## 1. Event Types

The extension transmits five event types. The backend validates event types
against an allow-list and rejects any event type not listed below.

| Event type | Description | When emitted |
|---|---|---|
| `session` | One event per continuous activity window | At session end (idle timeout or shutdown) |
| `file_edit` | Aggregated file-edit activity | At flush interval |
| `ai_accept` | AI suggestion acceptance | On manual command |
| `commit` | Git commit detected | When commit hash changes via IDE Git API |
| `test_init` | Manual test event for support/debugging | On manual command |

---

## 2. Top-Level Batch Payload Fields

These fields are sent with every telemetry batch (POST `/api/telemetry`):

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `source` | string | `"vscode"` | IDE source identifier | Raw |
| `editor_source` | string | `"cursor"` | Canonical editor type | Normalized |
| `extension_version` | string | `"<current-version>"` | Extension version | Raw |
| `installation_id` | string (UUID) | `"a1b2c3d4-..."` | Stable per-installation identifier | Pseudonymous |
| `developer_id` | string or null | `"invite:42"` | Backend-issued developer identifier | Pseudonymous |
| `team_id` | string or null | `null` | Backend-issued team identifier (reserved) | Pseudonymous |
| `identity_schema_version` | number | `1` | Identity contract version | Raw |
| `events` | array | `[...]` | Batch of 1–1000 events | — |

**Privacy note:** `installation_id` is a random UUID v4 generated locally —
not a human identifier. `developer_id` is a backend-issued pseudonymous
identifier (format: `invite:{id}` or `user:{id}`). ChaosMonkey does not
intentionally collect developer name/email/username as first-class
developer identity fields. Git author name/email is not collected.
Repository remote strings are separately collected for correlation and
remain subject to the documented sanitizer limitations (see Git Context
section above).

---

## 3. Per-Event Common Fields

Every event in the `events` array carries:

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `event_type` | string | `"session"` | Event type (allow-listed) | Raw |
| `count` | number or null | `1` | Event count | Raw |
| `duration_ms` | number or null | `1800000` | Duration in milliseconds | Raw |
| `timestamp` | string (ISO 8601) | `"2026-08-27T..."` | Event timestamp | Raw |
| `metadata` | object or null | `{...}` | Event metadata (see below) | Mixed |
| `event_id` | string | `"evt_abc12345"` | Deterministic deduplication hash | Derived |

**`event_id` classification:** Derived — deterministic hash of stable event
properties (event_type + timestamp + session_id + count + duration_ms +
segment_type + end_reason + trigger). Used for backend deduplication.

---

## 4. Session Event Metadata Fields

The `session` event carries the richest metadata. All fields below are
verified from the current extension source code (`endSession()` function).

### 4.1 Editor / Tool Identity

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `source` | string | `"vscode"` | Editor source | Raw |
| `extension_version` | string | `"<current-version>"` | Extension version | Raw |
| `vscode_version` | string | `"1.92.0"` | IDE version | Raw |
| `appName` | string | `"Visual Studio Code"` | IDE application name | Raw |
| `uriScheme` | string | `"vscode"` | IDE URI scheme | Raw |
| `segment_type` | string | `"session"` | Always `"session"` (legacy `"interval"` removed) | Raw |

### 4.2 Pseudonymous Identifiers

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `session_id` | string | `"session_1234_abc"` | Unique per-session identifier | Pseudonymous |
| `installation_id` | string (UUID) or null | `"a1b2c3d4-..."` | Stable per-installation identifier | Pseudonymous |
| `developer_id` | string or null | `"invite:42"` | Backend-issued developer identifier | Pseudonymous |
| `team_id` | string or null | `null` | Backend-issued team identifier | Pseudonymous |
| `identity_source` | string | `"backend_claimed"` | How identity was established | Raw |

**`identity_source` values:** `generated_installation`, `configured_developer`,
`backend_claimed`, `legacy_unknown`, `persistence_failed`.

### 4.3 Session Duration / State

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `end_reason` | string | `"idle"` | Why session ended (`"idle"` or `"shutdown"`) | Raw |
| `active_coding_duration_ms` | number | `1200000` | Time spent actively coding | Derived |
| `idle_time_ms` | number | `600000` | Session duration minus active coding | Derived |

### 4.4 File Edit / Change Magnitude

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `files_edited_count` | number | `5` | Distinct files edited (count only, no names) | Raw |
| `chars_added_total` | number | `3200` | Total characters added (exact, from inserted text) | Raw |
| `chars_removed_total_est` | number | `800` | Total characters removed (estimated from change range) | Estimated |
| `lines_added_total` | number | `45` | Total lines added (exact, count of newlines) | Raw |
| `lines_removed_total_est` | number | `12` | Total lines removed (estimated) | Estimated |
| `change_magnitude_definition` | string | `"added: exact_..."` | Definition of measurement methodology | Raw |
| `change_magnitude_clamped` | boolean | `false` | Whether totals were clamped to sanity bound | Derived |

**Privacy note:** Only character/line counts are transmitted. No inserted or
removed text content, file names, or file paths are collected.

### 4.5 AI Activity

AI activity is detected via local heuristics (large block insertions with
newlines). The extension does not access AI tool APIs or capture prompt/
completion text.

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `ai_burst_count` | number | `3` | Number of AI-like insertions detected | Raw |
| `ai_first_burst_at_ms` | number or null | `60000` | First AI burst time relative to session start | Raw |
| `ai_last_burst_at_ms` | number or null | `180000` | Last AI burst time relative to session start | Raw |
| `ai_burst_chars_total` | number | `1500` | Total characters inserted via AI bursts | Raw |
| `ai_burst_lines_total` | number | `25` | Total lines inserted via AI bursts | Raw |
| `ai_active_span_ms` | number or null | `120000` | Time between first and last AI burst | Derived |
| `ai_usage_duration_ms` | number | `120000` | Redefined to AI active span (not full session) | Derived |
| `ai_usage_duration_definition` | string | `"span_between_..."` | Definition of the metric | Raw |
| `ai_chars_per_min` | number or null | `750.0` | AI characters per minute during active span | Derived |
| `ai_intensity_band` | string | `"medium"` | Intensity band: `none`, `low`, `medium`, `high` | Derived |
| `ai_intensity_definition` | string | `"ai_burst_chars_..."` | Definition of intensity calculation | Raw |

**Privacy note:** AI detection is heuristic-based (insertion size and newline
pattern). No prompt text, AI responses, tool names, or completion content
are captured.

### 4.6 Language Mix

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `language_id_counts` | object | `{"typescript": 12, "python": 3}` | Per-session edit counts by IDE language ID | Raw |

**Privacy note:** Only IDE language IDs (e.g., `typescript`, `python`) are
tracked. No file names, paths, workspace folder names, URIs, or content.
Rare languages are collapsed into `"other"` if more than 50 distinct
language IDs appear.

### 4.7 Debug Activity

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `debug_session_count` | number | `2` | Number of debug sessions started | Raw |
| `debug_time_ms` | number | `300000` | Total time spent debugging | Raw |

**Privacy note:** No debug config name, arguments, environment variables, or
launch.json details are captured. Only counts and durations.

### 4.8 Terminal Activity

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `terminal_open_count` | number | `3` | Number of terminals opened | Raw |
| `terminal_active_time_ms` | number | `450000` | Total time with terminal as active window | Raw |
| `terminal_definition` | string | `"active_time..."` | Definition of measurement | Raw |

**Privacy note:** No commands, titles, current working directory, shell type,
or environment variables are captured. Only counts and time intervals.

### 4.9 Save / Format-on-Save

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `file_save_count` | number | `8` | Total file saves during session | Raw |
| `will_save_total_count` | number | `8` | Total onWillSave events | Raw |
| `will_save_format_likely_count` | number | `5` | Saves where formatting likely occurred | Derived |
| `save_format_definition` | string | `"format_likely..."` | Definition of format inference | Raw |

**Privacy note:** No file names, paths, URIs, or formatter/extension names.
Format-likely is inferred when a text edit occurs within 250ms of onWillSave.

### 4.10 Workspace Context

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `is_remote_workspace` | boolean | `true` | Whether workspace is remote | Raw |
| `remote_name` | string or null | `"ssh-remote"` | Normalized remote type | Normalized |
| `is_multi_root_workspace` | boolean | `false` | Whether workspace has multiple root folders | Raw |
| `workspace_folder_count` | number | `1` | Number of workspace folders (count only) | Raw |

**`remote_name` values:** `ssh-remote`, `wsl`, `dev-container`, `codespaces`,
`tunnel`, `unknown`, or null.

**Privacy note:** No folder names, paths, URIs, or repo names. Only booleans
and a small safe remote type identifier.

### 4.11 Git Context

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `git_repo_url` | string or null | `"https://github.com/org/repo"` | Sanitized repository remote URL | Normalized |
| `git_branch` | string or null | `"main"` | Current Git branch | Raw |

**Commit events** additionally carry:

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `git_commit_hash` | string | `"abc123def456..."` | Full commit SHA | Raw |
| `trigger` | string | `"git_api"` | How commit was detected | Raw |

**Repository URL sanitization:** For HTTP/HTTPS URLs, embedded userinfo
(username and password/token in the userinfo component) is stripped before
transmission using the WHATWG URL parser. The host, path, and query string
are preserved for repository correlation. SSH/scp-style remotes (e.g.,
`git@host:org/repo.git`) are not parseable by the URL parser and are returned
unchanged.

**Current sanitizer behavior and limitations (source-verified):**
- The sanitizer clears the `username` and `password` fields of URLs
  parseable by the WHATWG `URL` constructor (HTTP/HTTPS and other
  URL-parseable schemes).
- The query string is preserved. If a repository remote URL contains
  query parameters (e.g., `?token=...`), those parameters are not stripped
  by the current sanitizer.
- SSH/scp-style remotes (e.g., `git@host:org/repo.git`) are not parseable
  by `URL()` and are returned unchanged. The protocol username (e.g.,
  `git` in `git@host:...`) is a transport identifier, not a developer
  credential.
- This is the only sanitization applied to repository remote strings
  before telemetry emission.

**Privacy note:** No commit messages, diffs, file change lists, or Git author
name/email are collected. Only commit SHA, branch, and sanitized repo URL.

### 4.12 Git Context Diagnostics

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `git_context_status` | string | `"resolved_full"` | Whether Git context was captured | Raw |
| `git_context_reason` | string or null | `null` | Reason code if status is not resolved | Raw |
| `git_context_attempts` | number | `1` | Number of resolution attempts | Raw |
| `git_context_resolution_ms` | number or null | `150` | Time to resolve Git context | Raw |
| `git_context_resolved_before_end` | boolean | `true` | Whether context resolved before session end | Derived |

### 4.13 Delivery / Workflow Counts

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `session_commits` | number | `2` | Commits during this session | Raw |
| `session_has_commit_outcome` | boolean | `true` | Whether any commit occurred | Derived |
| `time_to_first_commit_ms` | number or null | `300000` | Time from session start to first commit | Derived |

### 4.14 Derived Flow Profile

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `focus_ratio` | number | `0.667` | Active coding / session duration | Derived |
| `debug_ratio` | number | `0.167` | Debug time / session duration | Derived |
| `terminal_ratio` | number | `0.250` | Terminal time / session duration | Derived |
| `idle_ratio` | number | `0.333` | Idle time / session duration | Derived |
| `flow_profile` | string | `"coding-heavy"` | Session profile label | Derived |
| `flow_definition` | string | `"profile chosen..."` | Definition of profile rules | Raw |

**`flow_profile` values:** `idle-heavy`, `debug-heavy`, `terminal-heavy`,
`coding-heavy`, `mixed`.

### 4.15 Rework Index

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `rework_ratio_est` | number | `0.250` | Estimated removed/added ratio | Derived |
| `rework_band` | string | `"medium"` | Rework band: `low`, `medium`, `high` | Derived |
| `rework_definition` | string | `"removed/added..."` | Definition of rework calculation | Raw |

### 4.16 Session Quality Score

| Field | Type | Example | Purpose | Classification |
|---|---|---|---|---|
| `session_quality_score` | number | `0.85` | Confidence score (0–1) | Derived |
| `session_quality_band` | string | `"high"` | Quality band: `high`, `medium`, `low` | Derived |
| `session_quality_factors` | array | `["short_session"]` | Factors affecting score | Derived |

---

## 5. Backend-Stored Fields (Telemetry Events Table)

The backend stores the following columns per ingested event:

| Column | Type | Purpose |
|---|---|---|
| `id` | auto-increment | Row ID |
| `user_id` | string, nullable | Developer identifier (server-authoritative) |
| `organization_id` | foreign key, nullable | Organization scope (server-authoritative) |
| `session_id` | string, nullable | Session correlation |
| `source` | string | Original source field |
| `editor_source` | string, nullable | Canonical tool identifier |
| `event_type` | string, nullable | Event type |
| `count` | integer | Event count |
| `duration_ms` | integer, nullable | Duration |
| `timestamp` | timestamp, nullable | Event timestamp |
| `metadata` | JSON, nullable | Full event metadata |
| `payload` | JSON | Full event payload |
| `batch_hash` | string, unique | Deduplication hash |
| `session_prs_created` | integer | PR creation count (from GitHub integration) |
| `session_prs_merged` | integer | PR merge count |
| `session_pr_reopen_count` | integer | PR reopen count |
| `session_deployment_successes` | integer | Deployment success count |

**Server-authoritative identity override:** When a valid bearer token is
present, the server overrides `user_id` (developer_id), `organization_id`,
and writes `identity_source = 'backend_claimed'` into every event's metadata.
Client-supplied identity fields do not override credential authority.

---

## 6. What ChaosMonkey Does NOT Collect

The following are verified as **not collected** by the current extension
source code:

| Data category | Collected? | Evidence |
|---|---|---|
| Source code | **No** | No file contents ever accessed or transmitted |
| File contents | **No** | Change magnitude counts only characters/lines, not text |
| Code diffs / patches | **No** | Only range-based line/char deltas as counts |
| AI prompt text | **No** | AI detection is heuristic (size/newline pattern); no prompt text captured |
| AI completion/output text | **No** | Only char/line counts from insertions |
| Keystroke text | **No** | Keystrokes aggregated to counts |
| Terminal/shell command text | **No** | Terminal activity is counts/durations only |
| Terminal output | **No** | No terminal content captured |
| File names | **No** | Edited documents tracked as a count only (`Set<string>` used for counting, URIs never emitted) |
| Local file paths | **No** | Not transmitted |
| Workspace folder names | **No** | Only folder count and normalized remote type |
| Commit messages | **No** | Only commit SHA, branch, and sanitized repo URL |
| Git author name/email | **No** | Not collected by the extension |
| Developer name/email/username | **Not intentionally / not a first-class field** | Not intentionally collected as developer identity by the extension; identity is pseudonymous (UUID + backend-issued ID); repository remote strings are separately collected for correlation and remain subject to the documented sanitizer limitations |
| Passwords / secrets | **Not intentionally / subject to sanitizer limitations** | Not intentionally collected; HTTP/HTTPS embedded userinfo is sanitized from repository remote URLs before transmission; repository remote strings remain subject to the documented sanitizer behavior (see Git Context section above) |
| Debug configuration names | **No** | Only debug session count and time |
| Formatter / extension names | **No** | Format-on-save inferred heuristically |

---

## 7. Data Classification Summary

| Classification | Meaning | Examples |
|---|---|---|
| **Raw** | Directly measured, not transformed | `event_type`, `count`, `duration_ms`, `timestamp`, `ai_burst_count` |
| **Normalized** | Transformed to a canonical form | `editor_source`, `remote_name`, `git_repo_url` (sanitized) |
| **Estimated** | Approximated from available signals | `chars_removed_total_est`, `lines_removed_total_est` |
| **Derived** | Computed from other captured fields | `focus_ratio`, `flow_profile`, `ai_intensity_band`, `rework_ratio_est`, `session_quality_score` |
| **Pseudonymous** | Random or backend-issued identifier, not human-identifiable | `installation_id`, `developer_id`, `session_id` |
