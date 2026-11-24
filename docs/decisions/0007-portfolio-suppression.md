# ADR-0007: Portfolio suppression and insight-quality controls

**Status:** accepted · **Area:** `frontend/src/lib/insights/final/index.ts` (consolidation + lifecycle), render adapter

## Context

Evidence-gating (ADR-0001) prevents fabricated findings, but a second
quality problem remained: multiple generators can produce true-but-redundant
findings from the same evidence (e.g. two variations of "PR throughput is
up"). Rendering all of them floods the surface with duplicates; dropping
them silently destroys auditability.

## Decision

Findings have three lifecycle states:

1. **Visible finding** — measured, decision-relevant, rendered.
2. **Diagnostic/data gap** (`isDiagnostic: true` + `hasData: false`) —
   honestly missing or ineligible evidence.
3. **Portfolio-suppressed** — supported evidence omitted because a stronger
   or redundant candidate won consolidation. Suppressed candidates must NOT
   set `isDiagnostic`/`hasData: false` (they are not gaps), are excluded
   from `finalAdaptedInsights` (the rendered output), and are retained in an
   internal debug collection for audit.

Quality controls on top:

- Family consolidation selects by a confidence/sample-aware materiality
  score, not raw delta size.
- User-visible copy must never contain suppression markers or internal IDs
  (`__cursor`, `__devin`, engine jargon).
- Uniformly-healthy coverage is suppressed — PI surfaces decision-relevant
  variance, not measurement inventory.

## Reasoning

- The pipeline (`generators → dedupe → portfolio consolidation → lifecycle
  classification → render adapter`) and `getSuppressionDiagnostics()` in
  `final/index.ts` implement the three states.
- `docs/extending/performance-insights.md` documents the contract; the
  gauntlet and semantic-authority test files exercise suppression paths.

## Consequences

- Dashboard PI output stays small and meaningful without hiding *why*
  findings were dropped — operators can audit the suppression log.
- A generator returning a valid finding is not guaranteed render; that is
  correct behavior, not a bug.
- Limitation: suppression tuning affects perceived "insight count"; teams
  changing it should consult the debug diagnostics rather than counting
  cards.
