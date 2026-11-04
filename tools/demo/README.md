# Demo & test tooling

## telemetry-simulator.js

Generates **synthetic** telemetry events against a running instance. Use it to
populate a demo or to exercise the ingest pipeline in development.

Telemetry ingest is authenticated: the simulator needs a bearer token and the
installation ID it was registered under. Obtain them through the same
connect-code flow the real clients use:

1. In the dashboard, invite a developer and copy their connect code
   (or create one via the admin API / `php artisan tinker`).
2. Exchange the code for a token:

```bash
curl -X POST http://localhost:8080/api/ide/connect/exchange \
  -H 'Content-Type: application/json' \
  -d '{"code":"<CONNECT_CODE>","installation_id":"<uuid>","extension_version":"0.4.1"}'
# => {"token":"<token>", "installation_id":"<uuid>", ...}
```

3. Run the simulator with that token and installation ID:

```bash
node telemetry-simulator.js \
  --url http://localhost:8080 \
  --token <token> --installation-id <uuid> \
  --sessions 10 --count 200 --ides cursor,vscode,claude-code \
  --verbose
```

Options: `--url` (base URL), `--token`, `--installation-id`, `--count`,
`--sessions`, `--ides`, `--delay`, `--batch-size`, `--verbose`, `--dry-run`.

## Synthetic data rules

- Data from this tool is **synthetic**. It is intended for demos, screenshots,
  and development only — do not mix it into an instance that also receives
  real telemetry.
- Identities are fake (`example.com` developers, `github.com/company/*` repos).
  Do not point the simulator at real repository names when generating
  screenshots or public material.

## docs/examples/enhanced-session.json

A canonical example of the enriched session payload the ingest API accepts —
useful when building a new client or bridge.
