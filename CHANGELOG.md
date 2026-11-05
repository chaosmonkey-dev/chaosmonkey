# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
