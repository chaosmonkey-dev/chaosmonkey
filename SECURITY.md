# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security reports.

Email: **security@chaosmonkey.dev**

Include a description, reproduction steps, affected component (backend, frontend,
extension/bridge, or packaging), and whether the issue is exploitable in a
default self-hosted install. We aim to acknowledge reports within 72 hours and
will coordinate disclosure with you.

## Scope notes for self-hosted installs

- The application runs behind token/session authentication; telemetry ingestion
  uses installation tokens and connect-code enrollment.
- GitHub OAuth, GitHub App, and Atlassian integrations are **optional** — an
  unconfigured install runs fully local.
- `APP_DEBUG` must be `false` in any deployment reachable by other users.
- `DEMO_MODE` seeds clearly-labeled synthetic data; never enable it on an
  instance that also holds real telemetry.

## Supported versions

| Version | Supported |
|---|---|
| 1.x (latest release) | Yes |
| < 1.0 | No |

Security fixes ship in patch releases on the latest minor line.
