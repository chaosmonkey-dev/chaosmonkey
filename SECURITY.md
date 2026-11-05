# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security reports.

Use GitHub's **private vulnerability reporting** ("Report a vulnerability" under
the repository's Security tab) so details stay private until a fix is ready.

Include a description, reproduction steps, affected component (backend, frontend,
extension/bridge, or packaging), and whether the issue is exploitable in a
default self-hosted install. Reports are reviewed on a best-effort basis by the
maintainers; this is a community project without a staffed security team, so we
cannot guarantee response times. We will coordinate disclosure with you.

## Scope notes for self-hosted installs

- The application runs behind token/session authentication; telemetry ingestion
  uses installation tokens and connect-code enrollment.
- GitHub OAuth, GitHub App, and Atlassian integrations are **optional** — an
  unconfigured install runs fully local.
- `APP_DEBUG` must be `false` in any deployment reachable by other users (the
  Docker entrypoint forces it off).
- Keep synthetic/demo data out of instances that hold real telemetry — there is
  no runtime separation between the two.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x (Community Preview) | Security fixes on the latest release only |

During the `0.x` Community Preview, security fixes ship in the newest release;
earlier versions are not maintained. Upgrade to the latest release to receive
fixes.
