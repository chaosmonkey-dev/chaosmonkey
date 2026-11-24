# Architecture decision records

Concise records of the most consequential engineering decisions in
ChaosMonkey. They exist so that future changes respect the product's
evidence, attribution, and data contracts — most of which are enforced by
tests, not convention.

Each ADR states context, decision, reasoning grounded in the codebase and
test suite, and consequences. Historical rationale is stated only where the
record supports it; anything inferred is marked as such.

| ADR | Decision |
|---|---|
| [0001](0001-evidence-gated-insights.md) | Evidence-gated Performance Insights; missing-data semantics |
| [0002](0002-server-authoritative-ingestion.md) | Server-authoritative, authenticated, idempotent ingestion |
| [0003](0003-canonical-identity-taxonomy.md) | Canonical source/session/developer identity taxonomy |
| [0004](0004-sqlite-first.md) | SQLite-first self-hosting architecture |
| [0005](0005-github-app-delivery-evidence.md) | GitHub App delivery evidence and provenance |
| [0006](0006-configured-cost-not-billing.md) | Configured AI-tool costs are estimates, never billing |
| [0007](0007-portfolio-suppression.md) | Portfolio suppression and insight-quality controls |
