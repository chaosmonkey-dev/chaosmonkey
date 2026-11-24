# ChaosMonkey documentation index

Start here. Each path below is the authoritative document for its audience;
documents are not duplicated — follow the links.

## New engineering contributors

1. [README](../README.md) — product overview and quick start
2. [CONTRIBUTING](../CONTRIBUTING.md) — DCO, conventions, test commands,
   data/attribution invariants
3. [docs/architecture.md](architecture.md) — monorepo layout, request flow,
   identity/enrollment model, deployment model
4. [docs/decisions/](decisions/) — why the evidence, attribution, and data
   contracts exist (read before changing analytics code)
5. `frontend/src/lib/insights/final/README.md` — PI engine internals

## Self-hosted operators

- [docs/installation.md](installation.md) — Docker quick start, manual
  install, configuration, HTTPS, upgrades
- [docs/operations.md](operations.md) — backup, restore, remote hosting,
  monitoring
- [MIGRATION](../MIGRATION.md) — upgrading existing installs, image pinning
- [docs/onboarding.md](onboarding.md) — first admin, invites, connect codes

## Integration developers (new tools / connectors)

- [docs/integrations.md](integrations.md) — per-tool setup for the supported
  clients
- [docs/reference/CHAOSMONKEY_TELEMETRY_DATA_DICTIONARY.md](reference/CHAOSMONKEY_TELEMETRY_DATA_DICTIONARY.md) —
  field-level ingest contract, including what is deliberately not collected
- [docs/reference/CHAOSMONKEY_EXTENSION_ARCHITECTURE.md](reference/CHAOSMONKEY_EXTENSION_ARCHITECTURE.md) —
  client/bridge architecture
- [docs/reference/CHAOSMONKEY_INTEGRATION_SURFACES.md](reference/CHAOSMONKEY_INTEGRATION_SURFACES.md) —
  API surface map
- `extensions/` — source of the four packaged clients

## Performance Insights contributors

- [docs/extending/performance-insights.md](extending/performance-insights.md) —
  generator contract, worked example, merge checklist
- [docs/decisions/0001-evidence-gated-insights.md](decisions/0001-evidence-gated-insights.md)
  and [0007-portfolio-suppression.md](decisions/0007-portfolio-suppression.md)

## Productivity by Tool contributors

- [docs/extending/productivity-by-tool.md](extending/productivity-by-tool.md) —
  telemetry vs delivery planes, point-field resolver, worked examples
- [docs/decisions/0006-configured-cost-not-billing.md](decisions/0006-configured-cost-not-billing.md)

## Telemetry and identity-model contributors

- [docs/architecture.md](architecture.md) §identity and enrollment model,
  §telemetry contract
- [docs/decisions/0002-server-authoritative-ingestion.md](decisions/0002-server-authoritative-ingestion.md)
  and [0003-canonical-identity-taxonomy.md](decisions/0003-canonical-identity-taxonomy.md)

## Security reviewers

- [SECURITY](../SECURITY.md) — vulnerability reporting
- [PRIVACY](../PRIVACY.md) — data handling commitments
- [docs/decisions/0002-server-authoritative-ingestion.md](decisions/0002-server-authoritative-ingestion.md) —
  the telemetry-authentication boundary and its history
- [CHANGELOG](../CHANGELOG.md) — security-relevant release notes
  (e.g. telemetry-auth hardening in 0.1.2)
