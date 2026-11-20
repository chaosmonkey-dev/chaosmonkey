# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] — Community Preview

Performance and migration-readiness release. **All users should run `0.1.3`;
`0.1.0`–`0.1.2` are superseded.**

This release carries the corrections needed for self-hosted migration at
established data volumes — see `MIGRATION.md` for the full
hosted→self-hosted procedure.

### Fixed

- **Dashboard responsiveness at large evidence volumes.** The session→PR
  attribution pass evaluated every session against every pull request
  (O(sessions × PRs) — tens of millions of pair evaluations at established
  volumes). PR evidence is now indexed by normalized repository once, and
  only same-repository candidates are evaluated; cross-repository and
  missing-repository pairs are skipped exactly, preserving classification
  semantics. This eliminates a multi-second main-thread block that could
  freeze the browser on the largest dashboards.
- **`/api/metrics` latency.** The metrics path no longer performs
  synchronous GitHub OAuth enrichment when GitHub App evidence is already
  authoritative, and the OAuth repository-authority lookup is cached
  per-organization/token for five minutes instead of re-fetching on every
  request. Metrics requests that previously timed out at ~30s on large
  datasets now complete within budget (rehearsal-verified).
- **Review-count provenance.** `review_count` now counts only submitted
  review records (populated via `github:app-sync --enrich-reviews`), never
  requested reviewers; requested reviewers are pending invites, not
  completed reviews.
- **Metric semantics.** Deployment failure rate (percentage of finalized
  failed deployment outcomes across observed environments) is reported
  separately from DORA change failure rate, which is not derivable from
  deployment status alone and now reports `null` rather than a misleading
  figure. Review-cycle and reopen-history fields likewise report `null`
  when per-review timeline evidence is unavailable, instead of
  fabricating zeroes. Merge rate is a same-cohort retrospective rate
  (PRs created in a week that have merged as of observation time), with
  cohorts under 14 days marked immature. Release counts are `null` when
  release evidence is unavailable (e.g., contents permission absent)
  rather than a false zero. Environment classification is conservative:
  ambiguous values report as `unknown`, not production or non-production.
- **Historical evidence windows** are disclosed via
  `evidence_window_start`, `evidence_window_basis`, and
  `evidence_partial` metadata on metrics responses.

### Added

- **`github:app-sync` artisan command** — historical GitHub evidence
  synchronization via the App installation token (OAuth-independent).
  Idempotent upserts, `--dry-run` inventory mode, resumable via
  `--from-repo`, with `--enrich-reviews`, `--include-deployments`, and
  `--include-releases` options. Required for webhook-gap recovery during
  migration cutover; see `MIGRATION.md`.
- **In-flight OAuth status deduplication** — concurrent dashboard
  components share one `/api/github/oauth/status` request rather than
  firing duplicate calls.
- **`MIGRATION.md`** — customer-facing self-hosted migration guide:
  VM prerequisites, Docker Compose, TLS/reverse proxy, encrypted SQLite
  transfer and restore, customer-owned GitHub App and OAuth setup,
  telemetry endpoint repointing, validation checklist, cutover and
  rollback.

### Security

- Session-primitive cache keys are now tenant-sensitive via a
  non-reversible token fingerprint; token material is never stored or
  logged.
- **Runtime dependencies updated to resolve all locked Composer
  advisories** (56 → 0): `laravel/framework` 12.73, `symfony/*` 7.4,
  `guzzlehttp/*` and `league/commonmark` patch/minor updates within
  existing constraints. A `conflict` bound keeps dependency resolution
  within the PHP 8.2 runtime. `composer audit --locked` reports zero
  advisories at release time.

### Known limitations

- The **first HTTP request on a freshly started container is slow**
  (~20 s at large data volumes) while PHP/Laravel caches warm; steady
  state is sub-second. Subsequent requests are unaffected.

## [0.1.2] — Community Preview

Security hardening release. **All users should run `0.1.2`; `0.1.0` and
`0.1.1` are superseded.**

### Security

- **Unauthenticated telemetry requests are denied before input
  validation.** In `0.1.1`, request validation ran before the
  authentication check, so a caller could distinguish valid inputs — such
  as probing `organization_id` existence via the `exists:organizations`
  rule — from the 401-vs-validation-error differential, and malformed
  anonymous payloads received a redirect rather than an authorization
  error. Bearer-token resolution and the anonymous-ingest guard now run
  first: every unauthenticated write attempt uniformly returns `401`
  before any validation executes.

## [0.1.1] — Community Preview

> **Superseded by `0.1.2`** for the validation-ordering hardening above.
> `0.1.1` closes the unauthenticated-ingestion vulnerability itself; the
> tag and image remain available and unmodified for historical reference.

Security fix release. **All users should run `0.1.1`; `0.1.0` is superseded.**

### Security

- **Unauthenticated telemetry ingestion is now rejected on every install.**
  `v0.1.0` accepted anonymous `POST /api/telemetry` and
  `POST /api/telemetry/upload` requests when a caller supplied a valid
  `organization_id`, a `user_id` matching an existing account, or when a
  migrated database contained the legacy `chaosmonkey` organization —
  allowing unauthorized parties to write telemetry into an instance and, in
  the forged-organization case, into a specific tenant. All telemetry write
  endpoints now require a valid bearer token or authenticated dashboard
  session (`401` when absent/invalid), caller-supplied organization and
  developer identifiers no longer determine tenant attribution, and
  session-authenticated writes are scoped to the caller's own organization
  (`403` on cross-tenant attempts). No database records are altered; valid
  authenticated ingestion is unchanged.

## [0.1.0] — Community Preview

> **Superseded by `0.1.1`** due to the telemetry-ingestion authorization
> issue described above. The tag and published image remain available and
> unmodified for historical reference; do not use for new installs.

First public open-source release. ChaosMonkey was independently developed
over ~16 months and operated as a hosted product with real engineering
teams; this release makes the full stack self-hostable under Apache-2.0.

### Added

- All-in-one Docker image (nginx + PHP-FPM + Laravel + persistent SQLite),
  published to GHCR as `ghcr.io/chaosmonkey-dev/chaosmonkey` (amd64 + arm64).
- First-run administrator bootstrap (`php artisan chaosmonkey:create-admin`).
- Packaged client downloads served by the backend: VS Code/Cursor telemetry
  extension (0.4.1), Claude Code bridge (0.4.2), Cursor Agents bridge
  (0.4.2), Codex bridge (0.4.1) — see `docs/release-manifest.md` for
  checksums.
- Invite + connect-code developer enrollment; per-installation tokens with
  server-authoritative identity.
- Optional GitHub OAuth, GitHub App, and Atlassian integrations via env
  config; telemetry works fully without them.
- Public documentation: install, integrations, operations, architecture,
  privacy, security.

### Security

- Authenticated previously public telemetry read and destructive endpoints.
- Removed default seed credentials; admin accounts are operator-created only.
- Telemetry ingest fails closed without installation ID + token (0.4.0+).
- GitHub OAuth/App credentials read via Laravel config (safe under
  `config:cache`); unconfigured OAuth fails closed with a clear error.
- Self-contained `/up` health page and vendored frontend assets — no
  outbound CDN calls on a default install.

### Known limitations

- VS Code/Cursor extension verified at package + ingest level; GitHub OAuth
  and GitHub App are config/callback tested but not exercised against live
  GitHub.
- Codex bridge requires a manual hook-trust step in the Codex UI by design.
- No automatic telemetry retention — operators own deletion policy.
- Cost figures are configured estimates, not billing data.

[0.1.2]: https://github.com/chaosmonkey-dev/chaosmonkey/releases/tag/v0.1.2
[0.1.1]: https://github.com/chaosmonkey-dev/chaosmonkey/releases/tag/v0.1.1
[0.1.0]: https://github.com/chaosmonkey-dev/chaosmonkey/releases/tag/v0.1.0
