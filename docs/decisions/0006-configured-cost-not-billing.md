# ADR-0006: Configured AI-tool costs are estimates, never billing

**Status:** accepted · **Area:** `frontend/src/lib/toolCost.ts`, `final/generators/unitEconomics.ts`, org cost-config API

## Context

Teams want AI-tool spend shown next to observed usage. ChaosMonkey does not
integrate with vendor billing APIs — the only spend data available is what
an org admin types in. Presenting configured numbers as "cost" without
qualification would misstate them as measured billing.

## Decision

- Cost figures are **configured estimates** entered per-tool by an org admin
  and persisted org-side. UI copy, PI generators, and PBT surfaces must
  label them as configured/estimated — never as billing or causal cost.
- **Backend is the cost authority.** `frontend/src/lib/toolCost.ts` does not
  fall back to `localStorage` on backend failure — a save failure surfaces
  as an error rather than silently diverging (enforced by
  `src/tests/cr-x-econ-1-backend-cost-authority.test.ts`, 45 tests).
- Cost insights must pass the evidence gates like everything else: they
  compare configured spend to *observed* usage and state both provenances.

## Reasoning

- The CONTRIBUTING data rules include "Configured spend is an estimate;
  never present it as billing data" alongside the telemetry/GitHub identity
  separation — these are the same honesty contract applied to economics.
- `final/generators/unitEconomics.ts` and `final/economics/` keep the
  estimate framing inside generated copy.

## Consequences

- Org cost config travels with the org, not the browser; there is no
  client-side cost store to reconcile.
- Limitation: estimates age — the product shows what was configured, and it
  is the admin's responsibility to keep figures current. There is no
  billing-API integration by design.
