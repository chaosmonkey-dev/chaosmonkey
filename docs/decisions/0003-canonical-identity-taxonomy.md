# ADR-0003: Canonical source, session, and developer identity taxonomy

**Status:** accepted · **Area:** ingest → `TelemetryEvent` → frontend identity resolvers

## Context

ChaosMonkey ingests activity from several tools that report identity
differently: the VS Code/Cursor extension, the Claude Code bridge, the Codex
CLI bridge, and the Cursor Agents bridge. Without a canonical taxonomy the
same engineer would appear as multiple identities, and distinct tools would
be merged into one blob — destroying per-tool attribution.

## Decision

- **Session identity** is the per-installation `session_id` emitted by the
  client — the client owns session boundaries; the server does not infer
  them.
- **Workflow/tool identity** is canonicalized at ingest from
  `source`/`editor_source` (e.g. `codex-cli` → `codex`). Cursor IDE, Cursor
  Agents Window, Claude Code, and Codex are **distinct canonical sources**
  and are never merged (see `frontend/src/lib/toolId.ts`,
  `frontend/src/lib/workflowIdentity.ts`, `frontend/src/lib/surfaceAgentContract.ts`).
- **Developer identity** is org-scoped and bound at enrollment, not reported
  per event.
- **Telemetry identity is not GitHub identity.** A developer observed via
  telemetry and a GitHub actor are separate planes; no UI may conflate them
  (this invariant is written into CONTRIBUTING.md).

## Reasoning

- `backend/app/Models/TelemetryEvent.php` carries the normalized fields;
  `docs/reference/CHAOSMONKEY_TELEMETRY_DATA_DICTIONARY.md` is the
  field-level contract.
- The "separate attribution per tool" rule is a CONTRIBUTING invariant with
  test coverage (`src/tests/cr-x-1b1-capability-gating.test.ts` and
  canonicalization tests) — merging `cursor` with `cursor-agent` breaks
  tests.

## Consequences

- A new client must pick a canonical `source` and enroll via connect codes;
  identity claims inside payloads are ignored (ADR-0002).
- Adding a new tool surface is a taxonomy decision first, a UI decision
  second.
- Limitation: cross-tool identity (the same person using Cursor *and*
  Claude Code) resolves to one developer only through enrollment binding,
  not tool fingerprinting — by design.
