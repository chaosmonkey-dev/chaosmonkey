# ChaosMonkey External Technical Documentation

This directory contains the canonical reusable external technical
documentation for ChaosMonkey. These documents are not branded for any
specific partner or customer.

> **Scope note for the open-source release.** These documents were written
> while ChaosMonkey ran as hosted per-customer deployments, and use
> "customer environment" language for the deployment boundary. In the
> self-hosted model, your own instance plays that role — every reference to
> "the customer's ChaosMonkey API/database" means your own installation.
> The telemetry contract, identity model, and data classifications described
> here are unchanged and still authoritative.

## Documents

| # | Document | Purpose |
|---|---|---|
| 1 | [ChaosMonkey Technical Overview](./CHAOSMONKEY_TECHNICAL_OVERVIEW.md) | What ChaosMonkey measures, development surfaces (IDE + Claude Code terminal), position in the SDLC, architecture, security posture, and relationship to runtime observability |
| 2 | [ChaosMonkey Telemetry Data Dictionary](./CHAOSMONKEY_TELEMETRY_DATA_DICTIONARY.md) | Field-level inventory of the standard IDE-extension telemetry contract, what is NOT collected, and data classification |
| 3 | [ChaosMonkey Extension Architecture](./CHAOSMONKEY_EXTENSION_ARCHITECTURE.md) | Standard IDE extension runtime, enrollment, token handling, queue/retry, Git API usage, and sequence diagrams |
| 4 | [ChaosMonkey Integration Surfaces](./CHAOSMONKEY_INTEGRATION_SURFACES.md) | Available correlation context, potential integration categories and shapes, OpenTelemetry status |

## Audience

These documents are useful for:

- Technical partners evaluating integration
- Prospective customers conducting technical diligence
- Security and procurement conversations
- Engineering leadership diligence
- Investor technical diligence
- Future integration discussions

## Reading Order

1. **Technical Overview** — start here for the big picture
2. **Telemetry Data Dictionary** — the most important technical document; read this to understand exactly what data exists
3. **Extension Architecture** — for understanding how the extension works on developer machines
4. **Integration Surfaces** — for exploring correlation and integration potential

## Partner-Specific Layers

Partner-specific documents live in `docs/partners/<partner-name>/` and
reference these canonical documents rather than duplicating technical
content.
