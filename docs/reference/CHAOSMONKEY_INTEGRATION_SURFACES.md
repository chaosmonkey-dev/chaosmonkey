# ChaosMonkey Integration Surfaces

> This document identifies ChaosMonkey data fields that could serve as
> correlation or integration surfaces with external systems, and describes
> potential integration categories and shapes.
>
> **No integrations with external systems are claimed to exist today unless
> explicitly stated.** All potential directions are conceptual.

---

## 1. Available Correlation Context Today

The following ChaosMonkey fields are source-proven and available in the
current telemetry schema. These fields could potentially be used to
correlate ChaosMonkey developer-workflow data with external systems.

ChaosMonkey's workflow context can originate from two collection paths:
VS Code-compatible IDE workflows (via the standard IDE extension) and
Claude Code terminal workflows (via a separate hook-based adapter). Field
availability may differ by collection surface; see the
[Telemetry Data Dictionary](./CHAOSMONKEY_TELEMETRY_DATA_DICTIONARY.md)
for the standard IDE extension contract.

### Strong Correlation Keys

| Field | Type | Example | Correlation potential |
|---|---|---|---|
| `git_commit_hash` | string (full SHA) | `"abc123def456..."` | Strongest potential correlation key when the downstream system also carries deploy/commit context |
| `git_repo_url` | string (sanitized) | `"https://github.com/org/repo"` | Repository identity — could match service/repo context in downstream systems if present |
| `git_branch` | string | `"main"` | Branch identity — could match deploy/trace context if present |
| `timestamp` | ISO 8601 | `"2026-08-27T14:30:00Z"` | Temporal correlation — could align with event windows in downstream systems |

### Pseudonymous Identifiers

| Field | Type | Example | Correlation potential |
|---|---|---|---|
| `session_id` | string | `"session_1234_abc"` | Session correlation within ChaosMonkey |
| `installation_id` | UUID | `"a1b2c3d4-..."` | Installation correlation within ChaosMonkey |
| `developer_id` | string | `"invite:42"` | Developer correlation within ChaosMonkey (pseudonymous) |

### Workflow Context Fields

These fields provide developer-workflow context that has no runtime
equivalent:

| Field | Type | What it tells you |
|---|---|---|
| `editor_source` | string | Editor/tool used (vscode, cursor, windsurf) |
| `ai_burst_count` | number | How many AI-assisted insertions occurred |
| `ai_burst_chars_total` | number | How much code was AI-inserted (by char count) |
| `ai_burst_lines_total` | number | How many lines were AI-inserted |
| `ai_active_span_ms` | number | Time span of AI activity within session |
| `ai_intensity_band` | string | AI usage intensity (none/low/medium/high) |
| `active_coding_duration_ms` | number | Time spent actively coding |
| `idle_time_ms` | number | Idle time within session |
| `files_edited_count` | number | Distinct files touched (count only) |
| `chars_added_total` | number | Characters added |
| `chars_removed_total_est` | number | Characters removed (estimated) |
| `rework_ratio_est` | number | Churn proxy (removed/added ratio) |
| `debug_session_count` | number | Debug sessions started |
| `debug_time_ms` | number | Time spent debugging |
| `terminal_open_count` | number | Terminals opened |
| `terminal_active_time_ms` | number | Terminal active time |
| `file_save_count` | number | File saves |
| `session_commits` | number | Commits during session |
| `time_to_first_commit_ms` | number | Time from session start to first commit |
| `flow_profile` | string | Session profile (coding-heavy, debug-heavy, etc.) |
| `session_quality_score` | number | Data quality confidence (0–1) |
| `is_remote_workspace` | boolean | Whether development was remote |
| `remote_name` | string | Remote type (ssh-remote, wsl, codespaces, etc.) |
| `language_id_counts` | object | Language mix (e.g., `{"typescript": 12}`) |

See the
[Telemetry Data Dictionary](./CHAOSMONKEY_TELEMETRY_DATA_DICTIONARY.md) for
the complete field inventory.

---

## 2. Potential Integration Categories

ChaosMonkey's developer-workflow context could potentially complement
several categories of external systems. None of these integrations exist
today.

| Category | Potential correlation |
|---|---|
| **Runtime observability** | Associate how software was produced with what happened when it ran (errors, latency, regressions) |
| **CI/CD and deployment systems** | Correlate development workflow with build/deploy outcomes |
| **Code review / SCM platforms** | Enrich PR/review context with developer-workflow metadata |
| **Engineering intelligence platforms** | Combine workflow signals with delivery/quality metrics |
| **FinOps / AI cost systems** | Correlate AI usage intensity with cost data |
| **Incident / reliability systems** | Provide development-workflow context for incidents |
| **Data warehouses / BI** | Export workflow data for custom analytics joins |

---

## 3. Possible Integration Shapes

> **CONCEPTUAL — NOT IMPLEMENTED** unless current implementation proves
> otherwise.

### A. API / Event Exchange

ChaosMonkey could expose an API endpoint that returns workflow context for a
given commit SHA / repo / branch, or an external system could call
ChaosMonkey to retrieve developer-workflow context. Alternatively, an
external system could expose data that ChaosMonkey joins into its
delivery-evidence pipeline.

**Status:** CONCEPTUAL — NOT IMPLEMENTED.

### B. Shared Correlation Identifiers

Both systems could use shared identifiers (commit SHA, repo URL, branch) as
correlation keys. ChaosMonkey already collects these fields. If the
downstream system also carries deploy/commit context, the correlation key
would be present in both datasets.

**Status:** The correlation keys (commit SHA, repo URL, branch) are already
available in ChaosMonkey today. The joining mechanism is CONCEPTUAL — NOT
IMPLEMENTED.

### C. OpenTelemetry Mapping / Enrichment

ChaosMonkey's event schema could potentially be mapped into OpenTelemetry
semantic conventions or OTel GenAI semantic conventions, allowing
developer-workflow context to be carried as span attributes or resource
attributes in an OTel pipeline.

**Status:** CONCEPTUAL — NOT IMPLEMENTED. Would require schema mapping
design and validation.

### D. Dashboard / Deep-Link Handoff

An external system's investigation view could deep-link to a ChaosMonkey
session view for the commit being investigated, or vice versa. This would
allow an engineer to click through from a runtime event to the
developer-workflow context for that change.

**Status:** CONCEPTUAL — NOT IMPLEMENTED.

### E. Joint Reporting / Warehouse Joins

A combined report could join ChaosMonkey workflow metrics with external
system outcomes by commit SHA / time window, producing a
development-to-production evidence chain.

**Status:** CONCEPTUAL — NOT IMPLEMENTED.

---

## 4. Correlation vs Causation

When discussing potential joint analysis between ChaosMonkey and any
external system, use:

- **"correlate"** — two datasets share a common key
- **"associate"** — link a workflow event with an outcome event
- **"provide context"** — one dataset enriches understanding of the other
- **"enable investigation"** — combined data supports human investigation

**Do not assume:**

- **"prove X caused Y"** — correlation does not establish causation without
  a specific validated methodology
- **Automatic attribution** — any attribution methodology would need to be
  separately designed and validated

---

## 5. OpenTelemetry

ChaosMonkey currently uses its own authenticated event schema for telemetry
ingestion.

It does **not** currently:

- Emit native OpenTelemetry
- Expose an OTLP endpoint
- Claim use of OpenTelemetry GenAI semantic conventions

unless source changes in the future prove otherwise.

Mapping ChaosMonkey context into OpenTelemetry is a **potential integration
surface** — not an implemented capability.

---

## 6. Key Considerations for Any Integration

1. **Privacy preservation.** Any integration must preserve ChaosMonkey's
   privacy model — no source code, file contents, diffs, or AI prompt/
   completion text would be shared. Only metadata, counts, and correlation
   keys.

2. **Pseudonymous identity.** ChaosMonkey developer identity is pseudonymous
   (UUID + backend-issued ID). Any integration would need to agree on
   whether and how developer identity is shared or mapped.

3. **Customer isolation.** ChaosMonkey data is scoped to each customer's
   organization. Any integration would need to respect customer boundaries
   and be authorized per customer.

4. **Correlation key availability.** The strongest potential correlation key
   is commit SHA (full hash), which ChaosMonkey already collects. This key
   is most useful when the downstream system also carries deploy/commit
   context.

5. **No causation without methodology.** Correlation between workflow
   patterns and outcomes does not automatically establish causation. Any
   causal claims would require a separately designed and validated
   statistical methodology.
