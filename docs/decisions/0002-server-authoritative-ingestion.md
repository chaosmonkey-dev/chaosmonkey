# ADR-0002: Server-authoritative, authenticated, idempotent ingestion

**Status:** accepted · **Area:** `backend/app/Http/Controllers/TelemetryController.php`, `backend/app/Http/Middleware/`

## Context

Telemetry arrives from client software the server cannot fully trust:
extensions, CLI bridges, and agent integrations. Two risks had to be closed:
unauthenticated writes polluting another organization's data, and
client-supplied identity claims being used for attribution.

The CHANGELOG records that `v0.1.0`/`v0.1.1` accepted unauthenticated
telemetry writes under some inputs; `v0.1.2` introduced the hardening that
this ADR records.

## Decision

1. **Authentication precedes validation.** Every telemetry write endpoint
   requires a valid per-installation bearer token; unauthenticated requests
   are denied before input validation runs.
2. **Identity is server-resolved.** `developer_id`, `organization_id`, and
   `installation_id` on stored events come from the token's binding, never
   from fields in the request body. A client cannot write rows attributed to
   another developer or org.
3. **Enrollment is explicit.** Clients exchange a connect code
   (`POST /api/ide/connect/exchange`) for an installation-bound token.
   Client versions below 0.4.0 are rejected.
4. **Ingestion is idempotent.** Replay-safe writes allow backfills and
   retries without duplicate rows (the same property used by GitHub App
   evidence sync, ADR-0005).

## Reasoning

- `TelemetryController` and the API auth middleware chain
  (`backend/app/Http/Middleware/ValidateApiToken.php`, `ApiAuth.php`)
  implement the order-of-operations: auth → resolve → validate → store.
- `backend/tests/Feature/OAuthIntentScopesTest.php` and related feature
  tests pin the authentication boundary; the install docs state the
  `v0.1.0`/`v0.1.1` deprecation explicitly.

## Consequences

- Self-hosted installs are safe to expose on a network (behind TLS) —
  unauthorized parties cannot inject telemetry.
- Any new ingest endpoint must implement the same auth-first ordering; do
  not accept client-supplied identity fields.
- Limitation: tokens are per-installation bearer credentials; a leaked token
  permits writes only within that installation's org — revocation is
  org-admin controlled.
