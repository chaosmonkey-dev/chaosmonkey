# ADR-0001: Evidence-gated Performance Insights and missing-data semantics

**Status:** accepted · **Area:** `frontend/src/lib/insights/final/`

## Context

Performance Insights renders findings about engineering behavior. Early
iterations could surface plausible-looking statements that the underlying
telemetry did not actually support — a worse failure mode than showing
nothing, because users act on the cards.

## Decision

PI is evidence-gated. Every finding must be produced by a generator that
returns a measured `CanonicalInsight` from observed `CanonicalInsightInput`,
or `null`. `null` is a truthful suppression, not an error. Where coverage
exists but evidence is insufficient, the engine emits an honest
diagnostic/data-gap state (`isDiagnostic: true` + `hasData: false`) instead
of a finding.

Missingness is three-valued and the distinction is load-bearing:

- **Unavailable** — the evidence plane cannot produce the metric (no
  integration, missing permission) → `null`, rendered as unavailable.
- **Zero** — a measured value of zero → rendered as `0`. Zero is data.
- **Missing** — no rows in the window → no points; the empty state must not
  look like a zero line.

## Reasoning

Enforced by contract and tests, not convention:

- The generator contract and doctrine are documented in
  `docs/extending/performance-insights.md` (minimum-sample gates,
  same-semantic-family comparisons, no causal claims).
- `getSuppressionDiagnostics()` in `final/index.ts` records why findings
  were omitted.
- Test coverage includes `src/tests/pi-semantic-authority.production.test.ts`,
  `src/tests/cr-x-pilot-shape-gauntlet.test.ts` (227 tests), and the
  semantic-authority fixtures — they assert `null` for ineligible evidence
  and forbid fabricated findings.

## Consequences

- PI count is an output, not an input — the rendered set varies with
  evidence availability.
- New insights require gates and tests proving `null` behavior; see the
  merge checklist in the extending guide.
- Limitation: sparse telemetry yields few or no findings even when the
  underlying engineering activity exists — the product chooses honesty over
  surface area.
