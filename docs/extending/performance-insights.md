# Extending Performance Insights

This guide shows how to add a new Performance Insight (PI) using the supported
extension points in the final engine — no reverse engineering required.

The PI engine lives entirely in the frontend:
`frontend/src/lib/insights/final/`. It reads canonical session and delivery
data and produces evidence-gated findings rendered on the dashboard.

---

## Architecture at a glance

```
GET /api/metrics + session primitives
        │
        ▼
fetchCanonicalInsightInput()          final/dataAccess.ts
        │  → CanonicalInsightInput
        ▼
generateFinalCanonicalInsights(input) final/index.ts
        │
        ├── generatePlanCodeInsights(input)        generators/planCode.ts
        ├── generateReviewMergeInsights(input)     generators/reviewMerge.ts
        ├── generateDeployOperateInsights(input)   generators/deployOperate.ts
        ├── early-signal generators                generators/earlySignal.ts
        ├── generateRecentChangeInsights(input)    generators/recentChange.ts
        ├── generateMultiDimensionalInsights(input) generators/multiDimensional.ts
        └── generateExecutiveTemporalSynthesis     generators/executiveSynthesis.ts
        │
        ▼
dedupe → portfolio consolidation → lifecycle classification → render adapter
        │
        ▼
finalAdaptedInsights → PI widget (Dashboards.vue)
```

Every insight flows through three contracts:

| Contract | File | Role |
|---|---|---|
| `CanonicalPIEntry` (registry row) | `final/canonicalInsights.ts` | Declares the insight exists: id, title, stage, priority, render order, maturity |
| Generator function | `final/generators/<stage>.ts` | Computes the finding from `CanonicalInsightInput`; returns `CanonicalInsight`, an array of them, or `null` |
| `CanonicalInsight` (output shape) | `final/types.ts` | The UI contract — what the card can display |

A generator that returns `null` is a **truthful suppression**, not an error:
the canonical-coverage layer may show an honest "needs more data" card, but no
finding is fabricated.

---

## The generator contract

```ts
export function generateMyInsight(input: CanonicalInsightInput): CanonicalInsight | null
```

### Input (`final/types.ts` → `CanonicalInsightInput`)

| Field | Contents | Notes |
|---|---|---|
| `sessionRows` | Canonical session primitives for the active window | One row per session; fields like `tool`, `session_duration_minutes`, `session_ai_burst_count`, `session_has_ai_activity`, `active_coding_time_minutes`, `idle_ratio`, `time_to_first_commit_minutes`, `git_repo_url`, `timestamp` |
| `githubByPeriod` | Delivery series per period | Org/repo-level evidence, **not** session-attributed |
| `prByPeriod` | PR created-week cohort buckets | Authority for windowed PR throughput / merge rate |
| `githubSnapshot` | Org-level GitHub summary (`github_provenance`, `pr_review_metrics`, `deployment_metrics`, …) | Check `github_provenance`/`github_db_data_available` before claiming delivery evidence |
| `productivityByPeriod` | PBT per-period aggregates | |
| `granularity` | `'day' \| 'week' \| 'month' \| 'quarter'` | Respect it in any period math |
| `externalCostConfigs` | Configured spend (estimate only) | Never present as billing |
| `_engineCache` | Prebuilt per-workflow groupings | Use `getSessionsByWorkflow(input._engineCache)` instead of re-grouping `sessionRows` |

### Output essentials

Fill the fields your finding actually has. `CanonicalInsight` (`final/types.ts`)
is wide; the required core is small:

```ts
{
  id: registryEntry.id,
  title: registryEntry.title,
  cicdStage: registryEntry.stage,
  canonicalPriority: registryEntry.canonicalPriority,
  renderOrder: registryEntry.renderOrder,
  presentationType: 'evidence_only',
  current,                      // number | null — the measured value
  confidence,                   // 'high' | 'medium' | 'low'
  hasData: true,
  evidence: [ { metric, value, label? }, … ],
  description, whyItMatters, recommendation,
  urgencyLabel,                 // 'action_required'|'investigate'|'monitor'|'informational'
  recommendationState,          // matching semantic: 'action_required'|'investigate'|'monitor_only'|'no_action'
  engineVersion: 'FINAL_ENGINE_V1',
  dataSource: 'live',
}
```

Optional fields that downstream layers use meaningfully: `breakdownByTool`,
`selectedComparison` (which two workflows control title/gap), `n`,
`coveragePct`, `deltaPct`, `operationalBreadcrumbs`, `metricDefinition`,
`semanticFamily`, `storyKey`, `isExecutiveFinding`, `demoFlag`.

### What `null` means — and what the engine does with it

- `null` → the finding is **omitted** from rendered output; the run records a
  suppression diagnostic (`getSuppressionDiagnostics()` in `final/index.ts`).
- `null` → the canonical-coverage layer *may* render a diagnostic card
  ("needs more telemetry" / "waiting for GitHub") — honest, not fabricated.
- Throwing → same suppression path with the error captured. Generators should
  return `null` for ineligible evidence rather than throwing.

### Doctrine (load-bearing — tests enforce it)

- **Zero is measured data; only null/undefined is missing.** Never synthesize
  values for missing evidence.
- **Don't claim comparisons across different measurement semantics.** Compare
  only workflows with the same AI-signal semantic family
  (`getAISignalSemanticFamily` in `planCode.ts` shows the pattern:
  `editor_activity_heuristic` vs `agent_authored_known` are not comparable).
- **Org-level delivery evidence is not workflow attribution.** PRs, reviews,
  deployments cannot be attributed to a workflow/developer without an
  authoritative join (the attribution layer in
  `final/attribution/`).
- **Minimum samples are gates, not suggestions.** Established conventions:
  ≥30 sessions for any live finding; ≥25 sessions per primary workflow for
  cross-workflow comparisons; ≥10 for breakdown visibility.
- **Healthy coverage is not a finding.** Uniformly-good metrics are suppressed
  (see `HEALTHY_COVERAGE_THRESHOLD` in `generateAIAdoptionRateByIDE`) — PI
  surfaces decision-relevant variance, not measurement inventory.
- **The in-progress period is never a period endpoint.** Velocity/trend
  generators must not compare against a partial week/month.
- **Configured spend ≠ billing.** Cost insights must say so.
- **No cross-tool causal claims**, no DORA claims without the underlying
  evidence (e.g. no change-failure-rate from deployment status alone —
  `change_failure_rate` reports `null` deliberately).

---

## Step-by-step: adding a finding

### 1. Register the capability — `final/canonicalInsights.ts`

Add a `CanonicalPIEntry` to `CANONICAL_PI_REGISTRY` (sorted by
`canonicalPriority`/`renderOrder` within its stage):

```ts
{
  id: 'session-outlier-share-by-workflow',        // stable kebab-case id
  title: 'Session-length outliers by workflow',
  stage: 'plan-code',                             // 'plan-code' | 'review-merge' | 'deploy-operate'
  canonicalPriority: <next free number>,
  renderOrder: <same ordering>,
  generatorKey: 'generateSessionOutlierShareByWorkflow',
  minimumConfidence: 'medium',
  maturity: 'experimental',                        // new insights start here
}
```

`generatorKey` should equal your function name — it is the audit link between
the registry and the run list.

### 2. Write the generator — `final/generators/planCode.ts`

Generators live in the stage file that owns their evidence domain
(`plan-code` = telemetry/session behavior; `review-merge` = PR/review
evidence; `deploy-operate` = deployment/release/outcome evidence). Putting
your function in the stage file gives access to its private helpers
(`groupSessionsByCanonicalWorkflow`, `getAISignalSemanticFamily`, …).

```ts
export function generateSessionOutlierShareByWorkflow(
  input: CanonicalInsightInput
): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('session-outlier-share-by-workflow');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  if (!isStressModeEnabled() && totalSessions < 30) return null;   // min sample

  // Use the prebuilt engine cache — do not re-scan sessionRows per tool.
  const sessionsByWorkflow = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);

  // Compute share of sessions > 90 min per primary workflow (>=25 sessions).
  const shares: Record<string, { rate: number; total: number; outliers: number }> = {};
  for (const [wf, sessions] of Object.entries(sessionsByWorkflow)) {
    const n = sessions.length;
    if (n < 25) continue;                                        // primary gate
    const outliers = sessions.filter(
      s => (s.session_duration_minutes ?? s.session_duration_minutes) > 90
    ).length;
    shares[wf] = { rate: (outliers / n) * 100, total: n, outliers };
  }

  const entries = Object.entries(shares);
  if (entries.length < 2) return null;                           // needs a comparison

  entries.sort((a, b) => b[1].rate - a[1].rate);
  const [hiWf, hi] = entries[0];
  const [loWf, lo] = entries[entries.length - 1];
  const gap = hi.rate - lo.rate;
  if (gap < 10) return null;                                     // not decision-relevant

  return {
    id: registryEntry.id,
    title: registryEntry.title,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    current: hi.rate,
    baseline: lo.rate,
    delta: gap,
    displayValue: formatPct(hi.rate),
    rightMetric: `${formatPct(gap)} spread`,
    rightMetricLabel: 'Outlier share gap',
    confidence: totalSessions >= 50 ? 'high' : 'medium',
    n: totalSessions,
    hasData: true,
    description: `${getCanonicalWorkflowIdentity(hiWf)} has ${formatPct(hi.rate)} of sessions over 90 minutes, ${formatPct(gap)} more than ${getCanonicalWorkflowIdentity(loWf)}.`,
    whyItMatters: 'Long-session share is an observed workload-shape signal, not a measure of productivity or delivery.',
    recommendation: 'Review whether long sessions reflect focus work or friction; do not treat duration alone as a performance metric.',
    metricDefinition: 'Share of sessions lasting > 90 minutes, per workflow',
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed`,
      `${hiWf}: ${hi.outliers}/${hi.total} sessions > 90 min`,
      `${loWf}: ${lo.outliers}/${lo.total} sessions > 90 min`,
    ],
    recommendationState: gap > 25 ? 'investigate' : 'monitor_only',
    urgencyLabel: gap > 25 ? 'investigate' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    dataSource: 'live',
    evidence: [
      { metric: getCanonicalWorkflowIdentity(hiWf), value: formatPct(hi.rate), label: `N=${hi.total}` },
      { metric: getCanonicalWorkflowIdentity(loWf), value: formatPct(lo.rate), label: `N=${lo.total}` },
    ],
    breakdownByTool: Object.fromEntries(entries.map(([wf, d]) => [wf, {
      value: d.rate, count: d.total,
      formatted: `${formatPct(d.rate)} > 90 min`,
      label: `${getCanonicalWorkflowIdentity(wf)} (${d.total} sessions)`,
    }])),
    selectedComparison: { leaderKey: hiWf, baselineKey: loWf },
  };
}
```

### 3. Wire it into the run list

Inside `generatePlanCodeInsights` in the same file, add one row to the
`generatorCalls` array (near the other entries, ~line 8007):

```ts
{ name: 'generateSessionOutlierShareByWorkflow', id: 'session-outlier-share-by-workflow', fn: () => generateSessionOutlierShareByWorkflow(input) },
```

For a `review-merge` or `deploy-operate` finding, add the call inside
`generateReviewMergeInsights` / `generateDeployOperateInsights` in the
matching stage file instead — `index.ts` already calls each stage function;
no engine-entry edits are needed for stage-internal additions.

### 4. Test it — `frontend/src/tests/` or colocated `*.test.ts`

Generators are pure functions — the test harness builds synthetic
`CanonicalInsightInput` objects directly (see
`src/tests/cr-x-track-cd-delivery-outcomes.test.ts` and
`src/tests/pi-semantic-authority.production.test.ts` for fixture style):

```ts
import { describe, it, expect } from 'vitest'
import { generateSessionOutlierShareByWorkflow } from '../lib/insights/final/generators/planCode'

const ti = (s: any[]): CanonicalInsightInput => ({
  sessionRows: s, githubByPeriod: [], granularity: 'week',
})

it('returns null below the 30-session minimum', () => { … })
it('returns null when all primary workflows are within 10pp', () => { … })
it('reports the measured gap when evidence qualifies', () => { … })
```

Run: `cd frontend && npm run test`.

### 5. What you do NOT need to touch

- The render adapter (`adaptCanonicalToUI`), portfolio consolidation,
  lifecycle classification, and the PI widget — they consume
  `CanonicalInsight` generically. `selectedComparison`, `breakdownByTool`,
  `urgencyLabel`, and `recommendationState` drive presentation automatically.
- Any backend code — unless your insight needs a session field that does not
  exist yet in the primitives contract (then that is a data-contract change,
  documented in `docs/reference/CHAOSMONKEY_TELEMETRY_DATA_DICTIONARY.md`).

---

## Checklist for a mergeable insight

- [ ] Registry entry with a unique `id`, correct `stage`, `generatorKey` matching the function name
- [ ] Explicit minimum-sample gates (30 sessions / 25 per primary workflow)
- [ ] `null` returned for ineligible evidence — never fabricated values
- [ ] `hasData: true` only when the finding is backed by measured evidence
- [ ] Same-semantic-family comparisons only (no cross-surface AI-signal gaps)
- [ ] No causal/attribution claims the evidence cannot support
- [ ] `urgencyLabel` and `recommendationState` agree (investigate+investigate, monitor+monitor_only, …)
- [ ] Tests cover: below-minimum null, ineligible-evidence null, measured finding, diagnostic honesty
- [ ] User-visible copy contains no internal ids, debug keys, or engine jargon
