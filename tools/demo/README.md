# Demo & test tooling

## telemetry-simulator.js

Generates **synthetic** telemetry events against a running instance. Use it to
populate a demo or to exercise the ingest pipeline in development.

```bash
node telemetry-simulator.js \
  --url http://localhost:8080/api/telemetry \
  --sessions 10 --count 200 --ides cursor,vscode,claude-code \
  --verbose
```

Options: `--url`, `--count`, `--sessions`, `--ides`, `--delay`, `--batch-size`,
`--verbose`, `--dry-run`.

## Synthetic data rules

- Data from this tool is **synthetic**. If your instance enables `DEMO_MODE`,
  seed data is labeled as demo data in the UI — never enable DEMO_MODE on an
  instance that also receives real telemetry.
- Identities are fake (example.org repos, invented developer names) — do not
  point the simulator at real repository names when generating screenshots
  or public material.

## docs/examples/enhanced-session.json

A canonical example of the enriched session payload the ingest API accepts —
useful when building a new client or bridge.
