# Extending Productivity by Tool (PBT) metrics

This guide shows how to add a metric to the PBT dropdown so it works correctly
across the dashboard — time series, workflow comparison, cohorts, and evidence
disclosures.

PBT has **two data planes**, and choosing the right one is the first decision:

| Plane | Scope | Data source | Metric prefix |
|---|---|---|---|
| Telemetry (IDE/workflow) | per-workflow | client session primitives → unified-record points | `ide.<metric>` |
| Delivery | org-level only | `GET /api/delivery/timeseries` | `delivery.<metric>` |

Delivery metrics are **org-level** — they describe pull requests, deployments,
and releases for the whole org/repo scope. They are deliberately *not*
duplicated into per-workflow series: sessions cannot be attributed to delivery
outcomes without an authoritative join. If your metric is workflow-attributable
session behavior, it belongs on the telemetry plane; if it is an org delivery
aggregate, it belongs on the delivery plane.

---

## The pipeline

### Telemetry plane

```
session events (POST /api/telemetry)
  → canonical session rows
  → unified-record points (per workflow, per period) — services/metricsFacade.ts
  → series per workflow — composables/useTimeSeries.ts
  → point[field] lookup — lib/productivity/resolveTimeSeriesPointField.ts
  → chart/table rendering — components/ProductivityByToolV3.vue
```

### Delivery plane

```
pull_requests / deployments / releases tables
  → PullRequestController::deliveryTimeseries  (backend/app/Http/Controllers/)
  → GET /api/delivery/timeseries → series[org].points[field]
  → buildDeliverySeries / mergeDeliveryIntoSeries — services/metricsFacade.ts
  → same point[field] resolver → same rendering
```

## The four supported touch-points

### 1. Point-field resolver — `frontend/src/lib/productivity/resolveTimeSeriesPointField.ts`

This is the single source of truth mapping a metric id to the exact field name
on a point object. Add one entry:

```ts
const METRIC_ID_TO_POINT_FIELD: Record<string, string> = {
  // …existing…
  'ide.my_new_metric': 'my_new_metric',          // telemetry plane
  'delivery.my_delivery_metric': 'my_delivery_metric', // delivery plane
}
```

Two important contract rules enforced here:

- The point field name must be **exactly** what the aggregation produces —
  including case (`AI_usage_duration_minutes` keeps its capital `AI`).
- Unknown metrics resolve to `null`, and callers must treat `null` as
  "metric unavailable" — never silently fall back to another field.

### 2. Dropdown registration — `components/ProductivityByToolV3.vue`

Add one `<option>` inside the correct `<optgroup>` (search for
`v-model="localSelectedMetric"`, ~line 76):

```html
<option value="my_new_metric">My Metric Label</option>
```

For **delivery-plane** metrics, also add the key to the
`DELIVERY_METRIC_FIELDS` set (~line 2448):

```ts
const DELIVERY_METRIC_FIELDS = new Set([
  'merged_pr_count', 'deployment_count', 'deploy_success_rate',
  'median_merge_cycle_hours', 'release_count', 'review_count',
  'pr_review_cycles', 'merge_rate',
  'my_delivery_metric',
])
```

This set is load-bearing: it controls which series the metric can be read
from (`delivery.*` vs `ide.*`), the org-level evidence disclosures, and the
"not workflow-attributable" copy.

### 3. Data production

**Telemetry plane:** the point field must be produced when unified records are
aggregated in `services/metricsFacade.ts` (look for the `metricFields` list,
~line 424, and the per-point population blocks). The field must exist on the
session primitives the ingest contract provides — if it doesn't, adding the
metric is a **data-contract change**, not a UI change; see
`docs/reference/CHAOSMONKEY_TELEMETRY_DATA_DICTIONARY.md` for the field-level
contract and add the field end-to-end (client emit → ingest → primitive →
aggregate) before registering the option.

**Delivery plane:** add the per-period field in
`PullRequestController::deliveryTimeseries` (backend). Follow the existing
provenance rules: populate `null` when the evidence is unavailable (e.g. a
permission is missing), never fabricate a zero; the delivery `meta` block
already carries `evidence_window_*`/`evidence_partial` disclosures for the UI.

### 4. Semantics — labels, units, missingness

- **Label** must state what is measured. If a metric is a created-week cohort
  rate or an unavailable capability, the option label/`title` must say so —
  see the `merge_rate` and `pr_review_cycles` options for the pattern.
- **Unavailable vs zero vs missing** are three distinct states:
  - *unavailable* — the evidence plane can't produce the metric (missing
    GitHub permission, no integration) → `null` on points; render the
    disabled/"unavailable" option pattern, not a zero line.
  - *zero* — measured value of zero → render 0. Zero is real data.
  - *missing* — no rows in the window → no points; the empty state must not
    look like a zero.
- **Instrumentation-aware filtering** is handled by
  `isMetricInstrumentedForWorkflow` (surface agent contract) — workflows that
  cannot produce a metric are excluded from that metric's compare view rather
  than shown as zeros. If your metric is only instrumented for some sources,
  wire it through that contract instead of hardcoding tool lists.
- **Units/formatting** flow through the point field value + existing
  `formatPct`/`formatMinutes` helpers — ratio metrics (`*_ratio`) are
  rendered as percentages by convention.

## Example — adding an org-level delivery metric

Say you want "Reopened PRs / Week" (reopened PR count exists in
`pr_review_metrics` / re-synced reopen evidence):

1. **Backend:** in `deliveryTimeseries`, bucket reopened PRs by the existing
   period logic and add `reopened_pr_count` to each point row; when reopen
   evidence is unavailable (`reopen_history` unavailable), emit `null`.
2. **Resolver:** `'delivery.reopened_pr_count': 'reopened_pr_count'`.
3. **Component:** add `'reopened_pr_count'` to `DELIVERY_METRIC_FIELDS`, then:

   ```html
   <option value="reopened_pr_count" title="Reopened PRs per week — requires per-PR reopen evidence from GitHub sync">Reopened PRs / Week</option>
   ```

4. **Tests:** a timeseries/aggregation test that asserts (a) the field appears
   on delivery points, (b) `null` propagates when reopen evidence is
   unavailable, (c) zero stays zero.

## Example — adding a telemetry-plane metric

Say sessions gain a new primitive `focus_session_ratio` (fraction of session
in sustained focus) — the ingest contract already carries it:

1. **Aggregation:** add `focus_session_ratio` to the unified-record field list
   and `metricFields` aggregation in `metricsFacade.ts` so each
   workflow-period point carries it.
2. **Resolver:** `'ide.focus_session_ratio': 'focus_session_ratio'`.
3. **Component:** option in the Focus & Productivity optgroup:

   ```html
   <option value="focus_session_ratio">Focus Session Ratio (%)</option>
   ```

4. Ratio metrics render as percent — no `DELIVERY_METRIC_FIELDS` entry.
5. If only some clients report the field, mark the option's `title` with the
   instrumentation caveat and let `isMetricInstrumentedForWorkflow` exclude
   uninstrumented workflows.

## Regression-test requirements

Any new metric must have:

- a resolver unit test (`resolveTimeSeriesPointField` returns the field for
  bare and prefixed ids; `null` for unknown),
- an aggregation test proving the field reaches point rows (and `null`
  propagates for unavailable evidence),
- for delivery metrics, a backend test on `deliveryTimeseries` covering
  bucketing + unavailable-evidence `null`,
- a component-level check that the option label/tooltip states the metric's
  true semantic (cohort, unavailable, instrumented-scope).

## What not to do

- Do not reuse an existing field as a proxy and label it something else.
- Do not put delivery metrics in the telemetry optgroup or vice versa.
- Do not render `0` for evidence the plane cannot produce — use the
  unavailable pattern.
- Do not introduce DORA-style claims (e.g. change failure rate) that the
  underlying evidence cannot support.
