# Privacy Notice

ChaosMonkey is designed for **self-hosted, aggregate telemetry**. When you run
your own instance, telemetry data is stored on infrastructure you control —
nothing is sent to the ChaosMonkey maintainers.

## What clients collect

The IDE extension and agent bridges send **aggregate activity events**:

- Event type (e.g. file edit, AI suggestion), timestamps, and durations
- Tool identity and version (e.g. `cursor`, `claude-code`, `codex`, `cursor-agent`)
- Repository *name/identity* for grouping (not file contents)
- Session metadata used to build canonical sessions

They are designed **not** to collect: source code, file contents, commit
message bodies, keystrokes, or credentials.

## What the server stores

- Telemetry events and derived session aggregates
- User accounts, organizations, and invites you create
- If configured: GitHub delivery evidence (PR/deploy/review metadata via OAuth
  or GitHub App you own)

## Operator responsibilities

If you host ChaosMonkey for a team:

- Tell your team what telemetry is collected and where it lives.
- Secure the instance (HTTPS, `APP_DEBUG=false`, strong admin credentials).
- There is **no automatic retention or pruning** — telemetry events are kept
  until you delete them. An authenticated admin can clear telemetry via
  `POST /api/clear-data`; database-level deletion is also possible since the
  SQLite file is yours. Plan your own retention/deletion policy.
- `tools/demo/telemetry-simulator.js` can generate clearly-labeled synthetic
  events for evaluation — keep demo data out of instances holding real
  telemetry.

## Third-party services

Entirely optional. GitHub OAuth/GitHub App and Atlassian OAuth are only used if
you configure your own credentials; tokens are stored in your instance's
database. No third-party analytics or tracking is embedded in the project.
