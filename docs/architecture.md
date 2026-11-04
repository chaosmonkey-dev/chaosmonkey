# Architecture

ChaosMonkey is a monorepo: a Laravel backend, a Vue 3 dashboard, four packaged
clients, and an all-in-one Docker image.

```
extensions/  Packaged clients (each versioned independently)
  chaosmonkey-telemetry/   VS Code/Cursor extension (VSIX)
  claude-code-bridge/      Claude Code terminal bridge (tgz)
  cursor-agent-bridge/     Cursor Agents Window bridge (tgz)
  codex-bridge/            Codex CLI bridge (tgz)
frontend/    Vue 3 + TypeScript + Vite + Pinia + Tailwind
backend/     Laravel 12 (PHP 8.2+), token + session auth, SQLite or MySQL
docker/      nginx config + container entrypoint (single-image deploy)
tools/demo/  Synthetic telemetry simulator for demos and development
docs/        Install / integrations / operations / reference material
```

## Request flow

```
client (extension/bridge)
  → POST /api/telemetry            (bearer token, batched events)
  → Laravel resolves organization + developer identity from the token
  → telemetry_events (SQLite on /data)

dashboard (Vue SPA served by nginx)
  → /api/* read endpoints          (dashboard token, org-scoped)
  → canonical sessions → AIOI / Productivity-by-Tool / Performance Insights
```

## Identity and enrollment model

- An admin creates **invites**; each invite can issue a **connect code**.
- A client exchanges the code (`POST /api/ide/connect/exchange`, with
  `installation_id` + `extension_version`) for a per-installation bearer
  token bound to the invite's organization.
- Ingest is **server-authoritative**: `developer_id`, `organization_id`, and
  `installation_id` on stored events come from the token, not from client
  claims. Versions below 0.4.0 are rejected.
- Session identity is per-installation `session_id`; workflows are attributed
  from `source`/`editor_source` canonicalization (e.g. `codex-cli` → `codex`).

## Telemetry contract

Clients send batches of aggregate events — session boundaries, edit/tool
counts, durations, language mix. Source code, file contents, prompts, diffs,
and shell command text are never transmitted. The field-level contract and
what is deliberately not collected are specified in
[docs/reference/CHAOSMONKEY_TELEMETRY_DATA_DICTIONARY.md](reference/CHAOSMONKEY_TELEMETRY_DATA_DICTIONARY.md).

## GitHub integration (optional)

- **OAuth** (`GITHUB_CLIENT_ID`/`SECRET`/`GITHUB_OAUTH_REDIRECT`) — per-user
  consent; identity scopes for login, `repo` scope only for an admin's
  engineering-data connection.
- **GitHub App** (`GITHUB_APP_*`) — org-level delivery evidence
  (PRs, deployments) via signature-verified webhooks at
  `POST /api/github/app/webhook`.
- Both are optional; a telemetry-only install works fully without them.

## Extension points

- **New clients**: the ingest API is documented in
  [docs/reference/](reference/README.md); attribute via a canonical `source`
  and enroll through the connect-code flow.
- **New metrics**: dashboard metrics are computed in
  `frontend/src/lib/insights/final/` (the Performance Insights engine) from
  canonical session data served by the backend.
- **Storage**: SQLite by default; `DB_*` env vars allow MySQL for larger
  installs (migrations are driver-aware).

## Deployment model

Single container: nginx (SPA + `/api` reverse proxy) → PHP-FPM → Laravel →
SQLite at `/data`. No queues, workers, or external services. See
[docs/operations.md](operations.md) for backup, upgrade, and rollback.
