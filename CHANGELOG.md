# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-rc.1] — Unreleased

First open-source release candidate. ChaosMonkey was previously operated as a
private hosted product; this release makes the full stack self-hostable.

### Added

- All-in-one Docker image (nginx + PHP-FPM + Laravel + persistent SQLite) and
  Docker Compose alternative.
- First-run administrator bootstrap (`php artisan chaosmonkey:create-admin`).
- Packaged client downloads served by the backend: VS Code/Cursor extension
  (0.4.1), Claude Code bridge (0.4.1), Cursor Agents bridge (0.4.2), Codex
  bridge (0.4.1).
- Optional GitHub OAuth, GitHub App, and Atlassian integrations via env config.
- Public documentation: install, integrations, operations, privacy, security.

### Security

- Authenticated previously public telemetry read and destructive endpoints.
- Removed default seed credentials; admin accounts are operator-created only.
- GitHub App credentials read via Laravel config (safe under `config:cache`).

[1.0.0-rc.1]: https://github.com/chaosmonkey-dev/chaosmonkey/releases/tag/v1.0.0-rc.1
