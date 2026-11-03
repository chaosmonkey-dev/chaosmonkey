// src/components/InsightsPanel.vue
<script setup lang="ts">
import { computed } from "vue";
import InsightCardContent from "./InsightCardContent.vue";
import { runPerfInsightsHarness } from "../lib/insights/harness";
import type { PerformanceInsight } from "../lib/insights/types";
import type { Insight } from "../types/insights";
import { useGitHubStore } from "../stores/github";
import { useMetricsFacadeStore } from "../stores/metricsFacade";
import { useUnifiedStore } from "../stores/unified";
import { hardenPerformanceInsightForUi } from "../ui/insights/piHardening";

// Accept insights from parent (PerformanceInsightsWidget)
const props = defineProps<{
  items?: PerformanceInsight[]
  allStageInsights?: PerformanceInsight[]
  demoUx?: boolean
}>();

function norm(str?: string | null) {
  return (str ?? "").toString().trim().toLowerCase();
}

function driverFamilyFrom(metric?: string | null) {
  const m = norm(metric);
  // keep in sync with engine mapping if possible
  if (m.includes("productive") || m.includes("coding")) return "ide_productive";
  if (m.includes("ai")) return "ide_ai_usage";
  return "other";
}

// Robust UI-side equivalence key (even if missing on items)
function eqKey(it: PerformanceInsight): string {
  const tm = norm((it as any).targetMetric ?? (it as any).metricId);
  const fam = norm((it as any).driverFamily) || driverFamilyFrom((it as any).driverFamily ?? (it as any).metricId ?? (it as any).targetMetric);
  const lag = String((it as any).lag ?? 0);
  const r = Number((it as any).r ?? 0);
  const sign = r === 0 ? "0" : (r > 0 ? "+" : "-");
  return `${tm}|${fam}|lag${lag}|${sign}`;
}

type Item = PerformanceInsight & { equivalenceKey?: string; alsoObservedIn?: string[] };

// Safe dedupe + merge "Also observed in …"
function dedupeByEquivalenceKey(items: Item[]): Item[] {
  const seen = new Map<string, number>(); // key -> index
  const out: Item[] = [];
  for (const raw of items) {
    const key = raw.equivalenceKey ?? eqKey(raw);
    if (!seen.has(key)) {
      const copy: Item = { ...raw, equivalenceKey: key };
      out.push(copy);
      seen.set(key, out.length - 1);
    } else {
      const idx = seen.get(key)!;
      const existing = out[idx];
      const tool = ((raw as any).tool ?? "").toString().toUpperCase() || "UNKNOWN";
      const add = existing.alsoObservedIn ? [...existing.alsoObservedIn] : [];
      if (tool && !add.includes(tool)) add.push(tool);
      existing.alsoObservedIn = add;
    }
  }
  return out;
}

// Scoring: priorityScore desc, then p asc, then |r| desc
function sortByPriority(a: Item, b: Item) {
  const ap = Number((a as any).priorityScore ?? 0);
  const bp = Number((b as any).priorityScore ?? 0);
  if (ap !== bp) return bp - ap;
  const apv = Number((a as any).p ?? 1);
  const bpv = Number((b as any).p ?? 1);
  if (apv !== bpv) return apv - bpv;
  const ar = Math.abs(Number((a as any).r ?? 0));
  const br = Math.abs(Number((b as any).r ?? 0));
  return br - ar;
}

// Heuristic: what counts as a "lowlight"
function isLowlight(i: Item): boolean {
  if (typeof (i as any).isLowlight === "boolean") return (i as any).isLowlight;
  const m = norm((i as any).metricId ?? (i as any).targetMetric);
  const r = Number((i as any).r ?? 0);
  const badWhenUp = ["cycle-time", "change-failure-rate", "mttr", "bug-rate", "defect-rate"];
  if (badWhenUp.includes(m)) return r > 0; // higher is worse
  return false; // conservative default unless flagged
}

const MAX_PRIORITY = 4; // Default value, can be made configurable later

// Convert PerformanceInsight to Insight for UI compatibility
function convertToInsight(item: Item): Insight {
  const hardened = hardenPerformanceInsightForUi(item)
  return {
    id: item.id,
    title: hardened.title,
    summary: hardened.summary,
    severity: item.severity as any,
    scope: 'org' as any,
    entityId: item.related?.tools?.[0] || item.related?.teams?.[0],
    metricId: item.metricId || 'unknown',
    metricKind: 'github' as any,
    value: null,
    baseline: null,
    deltaPct: null,
    evidence: hardened.evidence.map(e => ({
      label: e.label || '',
      value: e.value ?? ''
    })),
    recommendedAction: hardened.recommendedAction,
    recommendedOwners: [],
    tags: item.tags || [],
    dataSource: item.source === 'github' ? 'Real' : item.source === 'simulated' ? 'Simulated' : 'Mixed',
    alsoObservedIn: item.alsoObservedIn,
    timeRangeLabel: 'Recent period'
  };
}

// Get stores for data
const github = useGitHubStore();
const metrics = useMetricsFacadeStore();
const unified = useUnifiedStore();

const finalFromEngine = computed<Item[]>(() => {
  // If parent (PerformanceInsightsWidget) provides items, use those
  if (props.items && props.items.length > 0) {
    if (import.meta.env.DEV) {
      console.debug('[INSIGHTS_PANEL] Using items from parent:', props.items.length);
    }
    return props.items as Item[];
  }
  
  // Otherwise, return empty (PerformanceInsightsWidget should provide insights)
  if (import.meta.env.DEV) {
    console.debug('[INSIGHTS_PANEL] No items from parent, returning empty');
  }
  return [];
});

const safeFinal = computed<Item[]>(() => {
  const uiDedupe = dedupeByEquivalenceKey(finalFromEngine.value);
  return [...uiDedupe].sort(sortByPriority);
});

const priorityInsights = computed<Insight[]>(() => {
  return safeFinal.value.slice(0, MAX_PRIORITY).map(convertToInsight);
});

const lowlights = computed<Insight[]>(() => {
  return safeFinal.value.filter(isLowlight).map(convertToInsight);
});

const opportunities = computed<Insight[]>(() => {
  const lowIds = new Set(lowlights.value.map(i => i.id));
  return safeFinal.value.filter(i => !lowIds.has(i.id)).map(convertToInsight);
});

// Debug: verify counts and keys
console.info("[UI] engine final length", finalFromEngine.value.length);
console.info("[UI] safeFinal length", safeFinal.value.length);
console.table(safeFinal.value.map(x => ({
  id: (x as any).id, tool: (x as any).tool, metricId: (x as any).metricId, key: x.equivalenceKey, p: (x as any).p, r: (x as any).r, prio: (x as any).priorityScore
})));
console.info("[UI] priority:", priorityInsights.value.length, "opp:", opportunities.value.length, "low:", lowlights.value.length);
</script>

<template>
  <div class="row g-2 g-md-2 g-lg-3 insights-cards-row">
    <div v-for="it in props.items" :key="it.id" class="col-12 col-md-6 col-lg-4 col-xl-4">
      <InsightCardContent
        :insight="convertToInsight(it)"
        :demo-ux="props.demoUx"
        :data-pi-id="it.id"
        data-pi-region="card"
        :all-stage-insights="props.allStageInsights && props.allStageInsights.length > 0 ? props.allStageInsights : (props.items || [])"
      />
    </div>
  </div>
</template>

<style scoped>
/* Bootstrap handles grid: 1/2/3 columns up to xl (3 columns at ≥1200px) */
/* Custom breakpoint: 4 columns only at very large screens (≥1800px) */
@media (min-width: 1800px) {
  .insights-cards-row > div {
    flex: 0 0 auto;
    width: 25%; /* 4 columns - Bootstrap gap handles spacing */
  }
}
</style>