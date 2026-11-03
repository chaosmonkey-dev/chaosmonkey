<script setup lang="ts">
import { computed } from 'vue'
import { runPerfInsightsHarness } from '../lib/insights/harness'
import { pickBestGranularity, deriveGranularity, type Granularity } from '../lib/insights/time'
import { resolveGithubByGranularityWithRollup, resolveProductivityByGranularityWithRollup } from '../lib/insights/resolvers'
import { useGitHubStore } from '../stores/github'
import { useMetricsFacadeStore } from '../stores/metricsFacade'
import { useUnifiedStore } from '../stores/unified'

const featureOn = import.meta.env.VITE_FEATURE_PERF_INSIGHTS === '1'
const github = useGitHubStore()
const metrics = useMetricsFacadeStore()
const unified = useUnifiedStore()

const preferred = computed<Granularity>(() => deriveGranularity(unified))

const chosen = computed(() => pickBestGranularity(
  (g) => resolveGithubByGranularityWithRollup(github, g),
  (g) => resolveProductivityByGranularityWithRollup(metrics, g),
  preferred.value,
  4
))

const g = computed<Granularity>(() => chosen.value.granularity)
const ghResolved = computed(() => chosen.value.gh)
const prodResolved = computed(() => chosen.value.prod)

const insights = computed(() => runPerfInsightsHarness({
  githubWeekly: ghResolved.value.data,
  productivityWeekly: prodResolved.value.data,
  granularity: g.value,
  githubSnapshot: (github as any)?.rawResponse?.value ?? (github as any)?.rawResponse,
}))
</script>

<template>
  <div class="p-4" v-if="featureOn">
    <div class="text-[11px] text-slate-500 mb-1">
      <span title="r: Pearson correlation [-1..+1]; p: significance (lower is stronger); N: periods used. Correlation ≠ causation.">
        r/p/N guide
      </span>
    </div>
    <div class="text-[11px] text-slate-500 mb-2">
      Granularity: <code>{{ g }}</code> ·
      GH: <code>{{ ghResolved.source || 'none' }}</code> ({{ ghResolved.data.length }}) ·
      Prod: <code>{{ prodResolved.source || 'none' }}</code> ({{ prodResolved.data.length }})
    </div>

    <details open><summary>Counts</summary>
      Eng points: {{ ghResolved.data.length }} · Prod points: {{ prodResolved.data.length }} · Insights: {{ insights.length }}
    </details>

    <details><summary>Insights (raw)</summary>
      <pre class="text-xs bg-slate-50 p-3 rounded overflow-auto">{{ JSON.stringify(insights, null, 2) }}</pre>
    </details>
  </div>
  <div v-else>Set <code>VITE_FEATURE_PERF_INSIGHTS=1</code> to enable.</div>
</template>
