<template>
  <teleport to="body">
    <div v-if="open" class="v2-evidence-overlay" @click="onBackdropClick">
      <div
        class="v2-evidence-drawer"
        role="dialog"
        aria-modal="true"
        @click.stop
      >
        <div class="v2-evidence-header">
          <div class="min-w-0">
            <div class="v2-evidence-title text-truncate">
              {{ row?.title || 'Insight evidence' }}
            </div>
            <div v-if="row?.subtitle" class="text-muted" style="font-size: 0.85rem; line-height: 1.2;">
              {{ row.subtitle }}
            </div>
          </div>

          <div class="d-flex align-items-center" style="gap: 0.5rem;">
            <button
              type="button"
              class="btn btn-sm"
              :class="copied ? 'btn-success' : 'btn-outline-primary'"
              @click="copySummary"
            >
              {{ copied ? 'Copied' : 'Copy summary' }}
            </button>

            <button
              type="button"
              class="btn btn-sm"
              :class="copiedCsv ? 'btn-success' : 'btn-outline-primary'"
              @click="copyEvidenceCsv"
            >
              {{ copiedCsv ? 'Copied' : 'Copy evidence CSV' }}
            </button>

            <button type="button" class="btn btn-sm btn-outline-secondary" @click="close">
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>

        <div class="v2-evidence-body">
          <div class="d-flex align-items-center justify-content-between mb-2" style="gap: 0.75rem;">
            <div class="text-muted" style="font-size: 0.8rem;">Tool scope</div>
            <div class="btn-group btn-group-sm" role="group" aria-label="Tool scope">
              <button type="button" class="btn" :class="toolScope === 'all' ? 'btn-primary' : 'btn-outline-primary'" @click="toolScope = 'all'">All</button>
              <button type="button" class="btn" :class="toolScope === 'cursor' ? 'btn-primary' : 'btn-outline-primary'" @click="toolScope = 'cursor'">Cursor</button>
              <button type="button" class="btn" :class="toolScope === 'windsurf' ? 'btn-primary' : 'btn-outline-primary'" @click="toolScope = 'windsurf'">Windsurf</button>
              <button type="button" class="btn" :class="toolScope === 'vscode' ? 'btn-primary' : 'btn-outline-primary'" @click="toolScope = 'vscode'">VSCode</button>
            </div>
          </div>

          <div class="d-flex align-items-center justify-content-between mb-2" style="gap: 0.75rem;">
            <div class="text-muted" style="font-size: 0.8rem;">Compare</div>
            <div class="d-flex align-items-center" style="gap: 0.5rem;">
              <div class="btn-group btn-group-sm" role="group" aria-label="Compare mode">
                <button
                  type="button"
                  class="btn"
                  :class="compareMode === 'off' ? 'btn-primary' : 'btn-outline-primary'"
                  @click="compareMode = 'off'"
                >
                  Off
                </button>
                <button
                  type="button"
                  class="btn"
                  :class="compareMode === 'baseline' ? 'btn-primary' : 'btn-outline-primary'"
                  :disabled="toolScope !== 'all' || !selectedBaselineTool"
                  @click="compareMode = 'baseline'"
                >
                  vs Baseline
                </button>
              </div>

              <select
                v-if="toolScope === 'all'"
                class="form-select form-select-sm"
                style="width: auto; min-width: 140px;"
                v-model="baselineTool"
                :disabled="availableTools.length === 0"
                aria-label="Baseline tool"
              >
                <option v-for="t in availableTools" :key="t" :value="t">Baseline: {{ t }}</option>
              </select>
            </div>
          </div>

          <div class="d-flex align-items-start justify-content-between" style="gap: 0.75rem;">
            <div>
              <div class="text-muted" style="font-size: 0.8rem;">Primary</div>
              <div style="font-weight: 700; font-size: 1.1rem;">
                {{ getFormattedRightMetric() }}
              </div>
              <div v-if="row?.secondaryRightMetric" class="text-muted" style="font-size: 0.85rem; margin-top: 0.15rem;">
                {{ row.secondaryRightMetric }}
              </div>
            </div>

            <span
              v-if="row?.confidence"
              class="badge"
              :class="row.confidence === 'high' ? 'bg-success-subtle text-success' : (row.confidence === 'medium' ? 'bg-warning-subtle text-warning' : 'bg-danger-subtle text-danger')"
              style="font-size: 0.7rem; height: fit-content;"
            >
              {{ row.confidence }}
            </span>
          </div>

          <hr />

          <div v-if="row?.detail?.definition" class="mb-3">
            <div class="text-muted" style="font-size: 0.8rem;">Definition</div>
            <div style="white-space: pre-wrap; font-size: 0.9rem;">
              {{ row.detail.definition }}
            </div>
          </div>

          <div v-if="row?.detail?.coverage" class="mb-3">
            <div class="d-flex align-items-center justify-content-between">
              <div class="text-muted" style="font-size: 0.8rem;">Coverage</div>
              <div style="font-size: 0.8rem;">
                {{ row.detail.coverage.computableRows }}/{{ row.detail.coverage.totalRows }} ({{ row.detail.coverage.coveragePct }}%)
              </div>
            </div>
            <div class="progress" style="height: 0.5rem;">
              <div
                class="progress-bar"
                role="progressbar"
                :style="{ width: Math.max(0, Math.min(100, row.detail.coverage.coveragePct)) + '%' }"
              ></div>
            </div>
            <div v-if="row.detail.coverage.notes" class="text-muted" style="font-size: 0.78rem; margin-top: 0.25rem;">
              {{ row.detail.coverage.notes }}
            </div>
          </div>

          <div v-if="breakdownByTool.length > 0" class="mb-3">
            <div class="text-muted" style="font-size: 0.8rem;">Breakdown by tool</div>
            <div v-if="compareMode === 'baseline' && toolScope === 'all' && selectedBaselineTool" class="text-muted" style="font-size: 0.8rem; margin-top: 0.15rem;">
              Baseline: {{ selectedBaselineTool }}
            </div>
            <div class="table-responsive">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Value</th>
                    <th class="text-end">n</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(t, i) in breakdownByTool" :key="i">
                    <td style="font-weight: 600;">{{ t.tool }}</td>
                    <td>{{ formatBreakdownMetricWithDelta(t.tool, t.metric) }}</td>
                    <td class="text-end">{{ t.n }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="breakdownByPeriod.length > 0" class="mb-3">
            <div class="text-muted" style="font-size: 0.8rem;">Breakdown by period</div>
            <div class="table-responsive">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Value</th>
                    <th class="text-end">n</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(p, i) in breakdownByPeriod" :key="i">
                    <td style="font-weight: 600;">{{ p.period }}</td>
                    <td>{{ p.metric }}</td>
                    <td class="text-end">{{ p.n }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="row?.detail?.evidenceSample && row.detail.evidenceSample.length > 0" class="mb-3">
            <div class="text-muted" style="font-size: 0.8rem;">Evidence sample</div>
            <div class="v2-evidence-sample">
              <div
                v-for="(ev, i) in row.detail.evidenceSample"
                :key="i"
                class="v2-evidence-sample-row"
              >
                <div class="d-flex align-items-center justify-content-between" style="gap: 0.5rem;">
                  <div class="text-muted" style="font-size: 0.78rem;">
                    {{ ev.timestamp }}
                    <span v-if="ev.tool">• {{ ev.tool }}</span>
                  </div>
                  <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 0.75rem;">
                    {{ shortenId(ev.session_id) }}
                  </div>
                </div>

                <div class="v2-evidence-chips">
                  <span
                    v-for="(v, k) in getEvidenceRowExtraFields(ev)"
                    :key="String(k)"
                    class="badge bg-light text-dark border"
                    style="font-size: 0.7rem; font-weight: 500;"
                  >
                    {{ k }}: {{ formatAny(v) }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="row?.detail?.recommendation" class="mb-2">
            <div class="text-muted" style="font-size: 0.8rem;">Recommendation</div>
            <div style="font-size: 0.9rem; white-space: pre-wrap;">
              {{ row.detail.recommendation }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, watch, onMounted, onUnmounted, ref } from 'vue'
import { formatPIValue } from '../../ui/insights/piValueFormatter'

type DrawerRow = {
  id?: string
  title: string
  subtitle?: string
  callout?: string
  rightMetric?: string
  secondaryRightMetric?: string
  confidence?: 'high' | 'medium' | 'low'
  detail?: {
    definition: string
    coverage: { computableRows: number; totalRows: number; coveragePct: number; notes?: string }
    breakdowns: {
      byTool?: Array<{ tool: string; metric: string; n: number }>
      byPeriod?: Array<{ period: string; metric: string; n: number }>
    }
    evidenceSample: Array<Record<string, any>>
    recommendation: string
  }
}

interface Props {
  open: boolean
  row: DrawerRow | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ (e: 'close'): void }>()

const compareMode = ref<'off' | 'baseline'>('off')
const copied = ref(false)
const copiedCsv = ref(false)
let copiedTimer: any = null
let copiedCsvTimer: any = null

const toolScope = ref<'all' | 'cursor' | 'windsurf' | 'vscode'>('all')
const baselineTool = ref<string>('')

watch(
  () => props.open,
  (next) => {
    if (next) {
      compareMode.value = 'off'
      toolScope.value = 'all'
      copied.value = false
      copiedCsv.value = false
      if (copiedTimer) {
        clearTimeout(copiedTimer)
        copiedTimer = null
      }
      if (copiedCsvTimer) {
        clearTimeout(copiedCsvTimer)
        copiedCsvTimer = null
      }
    }
  }
)

function close() {
  emit('close')
}

function onBackdropClick() {
  close()
}

function getFormattedRightMetric(): string {
  if (!props.row?.rightMetric) return '—'
  
  const rightMetric = props.row.rightMetric
  
  // Check if it's already formatted (has units/labels)
  if (rightMetric.includes('%') || rightMetric.includes('min') || rightMetric.includes('hr') || 
      rightMetric.includes('hour') || rightMetric.includes('day') || rightMetric.includes('session') ||
      rightMetric.includes('commit') || rightMetric.includes('assist') || rightMetric.includes('cycle') ||
      rightMetric.includes('risk') || rightMetric.includes('Focus') || rightMetric.includes('Concentration') ||
      rightMetric.includes('/week') || rightMetric.includes('/day')) {
    return rightMetric
  }
  
  // Extract numeric value
  const numericMatch = rightMetric.match(/[-+]?[0-9]*\.?[0-9]+/)
  if (!numericMatch) return rightMetric
  
  const value = parseFloat(numericMatch[0])
  const id = props.row.id || ''
  const idLower = id.toLowerCase()
  
  // Apply formatting based on insight ID - use centralized formatter to avoid raw floats
  if (idLower.includes('focus') || idLower.includes('concentration')) {
    return formatPIValue(value, { kind: 'percent', precision: 1, labelPrefix: 'Focus' })
  }
  if (idLower.includes('session-length') || (idLower.includes('session') && idLower.includes('length'))) {
    return formatPIValue(value, { kind: 'duration', unit: 'min', precision: 0, labelPrefix: 'Session length' })
  }
  if (idLower.includes('active-coding-time') || idLower.includes('coding-time')) {
    return formatPIValue(value, { kind: 'duration', unit: 'min', precision: 0, labelPrefix: 'Active coding time' })
  }
  if (idLower.includes('time-to-first-commit') || idLower.includes('ttfc')) {
    return formatPIValue(value, { kind: 'duration', unit: 'min', precision: 1, labelPrefix: 'TTFC' })
  }
  if (idLower.includes('commits-per-session') || (idLower.includes('commit') && idLower.includes('session'))) {
    return formatPIValue(value, { kind: 'ratio', denominatorLabel: 'session', precision: 1, labelPrefix: 'Commits per session' })
  }
  if (idLower.includes('ai-assists') || (idLower.includes('assist') && idLower.includes('session'))) {
    return formatPIValue(value, { kind: 'ratio', denominatorLabel: 'session', precision: 1, labelPrefix: 'AI assists' })
  }
  if (idLower.includes('cycle') || idLower.includes('review-cycle')) {
    return formatPIValue(value, { kind: 'cycles', precision: 0, labelPrefix: 'Review cycles' })
  }
  if (idLower.includes('risk') || idLower.includes('lag')) {
    return formatPIValue(value, { kind: 'score', precision: 0, labelPrefix: 'Risk score' })
  }
  if (idLower.includes('deployment') && (idLower.includes('age') || idLower.includes('stale'))) {
    return formatPIValue(value, { kind: 'duration', unit: 'hr', precision: 1, labelPrefix: 'Stale deployments' })
  }
  if (idLower.includes('deploy') && idLower.includes('frequency')) {
    return formatPIValue(value, { kind: 'deploy_frequency', denominatorLabel: 'week', precision: 1, labelPrefix: 'Deploy frequency' })
  }
  if (idLower.includes('throughput') || idLower.includes('velocity')) {
    return formatPIValue(value, { kind: 'throughput', denominatorLabel: 'week', precision: 1, labelPrefix: 'Throughput' })
  }
  if (idLower.includes('failure') && idLower.includes('rate')) {
    return formatPIValue(value, { kind: 'percent', precision: 1, labelPrefix: 'Failure rate' })
  }
  
  // Default: try to infer from the rightMetric string itself
  if (rightMetric.includes('min') || rightMetric.includes('minute')) {
    return formatPIValue(value, { kind: 'duration', unit: 'min', precision: 0, labelPrefix: 'Time' })
  }
  if (rightMetric.includes('hour') || rightMetric.includes('hr')) {
    return formatPIValue(value, { kind: 'duration', unit: 'hr', precision: 1, labelPrefix: 'Time' })
  }
  if (rightMetric.includes('%')) {
    return formatPIValue(value, { kind: 'percent', precision: 0, labelPrefix: 'Value' })
  }
  
  // Last resort - use centralized formatter with count kind
  return formatPIValue(value, { kind: 'count', precision: 1, labelPrefix: 'Value' })
}

function onKeyDown(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') close()
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
})

const breakdownByToolRaw = computed(() => props.row?.detail?.breakdowns?.byTool || [])
const breakdownByPeriod = computed(() => props.row?.detail?.breakdowns?.byPeriod || [])

const availableTools = computed(() => {
  const tools = breakdownByToolRaw.value.map(x => String(x.tool || '')).filter(Boolean)
  const uniq: string[] = []
  for (const t of tools) {
    if (!uniq.includes(t)) uniq.push(t)
  }
  return uniq
})

const defaultBaselineTool = computed(() => {
  const toolsLower = availableTools.value.map(t => String(t).toLowerCase())
  if (toolsLower.includes('vscode')) return availableTools.value[toolsLower.indexOf('vscode')]
  return availableTools.value[0] || ''
})

watch(
  () => [props.open, props.row?.id, availableTools.value.join('|')],
  ([open]) => {
    if (!open) return
    baselineTool.value = defaultBaselineTool.value
  }
)

watch(
  () => toolScope.value,
  (s) => {
    if (s !== 'all' && compareMode.value === 'baseline') compareMode.value = 'off'
  }
)

const selectedBaselineTool = computed(() => {
  if (toolScope.value !== 'all') return ''
  if (!baselineTool.value) return ''
  if (!availableTools.value.includes(baselineTool.value)) return ''
  return baselineTool.value
})

const breakdownByTool = computed(() => {
  if (toolScope.value === 'all') return breakdownByToolRaw.value
  return breakdownByToolRaw.value.filter(x => String(x.tool || '').toLowerCase() === toolScope.value)
})

function parseMetricNumber(s: string): { value: number; kind: 'minutes' | 'percent' | 'number' } | null {
  const raw = String(s ?? '').trim().toLowerCase()
  if (!raw) return null

  const mMin = raw.match(/(-?\d+(?:\.\d+)?)\s*(?:min|m)\b/)
  if (mMin && mMin[1] != null) {
    const v = Number(mMin[1])
    if (!Number.isFinite(v)) return null
    return { value: v, kind: 'minutes' }
  }

  const mPct = raw.match(/(-?\d+(?:\.\d+)?)\s*%/)
  if (mPct && mPct[1] != null) {
    const v = Number(mPct[1])
    if (!Number.isFinite(v)) return null
    return { value: v, kind: 'percent' }
  }

  const mNum = raw.match(/-?\d+(?:\.\d+)?/)
  if (mNum && mNum[0] != null) {
    const v = Number(mNum[0])
    if (!Number.isFinite(v)) return null
    return { value: v, kind: 'number' }
  }

  return null
}

function formatBreakdownMetricWithDelta(tool: string, metric: string): string {
  if (compareMode.value !== 'baseline') return metric
  if (toolScope.value !== 'all') return metric
  if (!selectedBaselineTool.value) return metric
  const t = String(tool || '')
  if (String(t).toLowerCase() === String(selectedBaselineTool.value).toLowerCase()) return metric

  const baselineRow = breakdownByToolRaw.value.find(x => String(x.tool || '').toLowerCase() === String(selectedBaselineTool.value).toLowerCase())
  if (!baselineRow) return metric

  const baseParsed = parseMetricNumber(baselineRow.metric)
  const vParsed = parseMetricNumber(metric)
  if (!baseParsed || !vParsed) return metric
  if (baseParsed.kind !== vParsed.kind) return metric

  const delta = vParsed.value - baseParsed.value
  const sign = delta > 0 ? '+' : ''
  const unit = vParsed.kind === 'minutes' ? 'm' : (vParsed.kind === 'percent' ? '%' : '')
  return `${metric} (Δ${sign}${delta.toFixed(1)}${unit} vs ${selectedBaselineTool.value})`
}

function buildSummaryText(): string {
  const title = props.row?.title || 'V2 insight'
  const definition = props.row?.detail?.definition ? `Definition: ${props.row.detail.definition}` : undefined
  const headline = props.row?.rightMetric ? `Metric: ${getFormattedRightMetric()}` : undefined
  const coverage = props.row?.detail?.coverage
    ? `Coverage: ${props.row.detail.coverage.computableRows}/${props.row.detail.coverage.totalRows} (${props.row.detail.coverage.coveragePct}%)`
    : undefined
  const rec = props.row?.detail?.recommendation ? `Recommendation: ${props.row.detail.recommendation}` : undefined

  const chunks = [
    title,
    headline,
    definition,
    coverage,
    rec,
  ].filter(Boolean)

  return chunks.join('\n')
}

function escapeCsvCell(v: any): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (/[\n\r,\"]/g.test(s)) return '"' + s.replace(/\"/g, '""') + '"'
  return s
}

function buildEvidenceCsv(maxRows = 10): string {
  const rows = Array.isArray(props.row?.detail?.evidenceSample) ? props.row!.detail!.evidenceSample.slice(0, maxRows) : []
  const keys: string[] = []
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    for (const k of Object.keys(r)) {
      if (!keys.includes(k)) keys.push(k)
    }
  }
  if (keys.length === 0) return ''

  const header = keys.join(',')
  const lines = rows.map(r => keys.map(k => escapeCsvCell((r as any)[k])).join(','))
  return [header, ...lines].join('\n')
}

function getEvidenceRowExtraFields(ev: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const k of Object.keys(ev || {})) {
    if (k === 'session_id' || k === 'timestamp' || k === 'tool') continue
    out[k] = (ev as any)[k]
  }
  return out
}

async function copySummary() {
  const text = buildSummaryText()
  const ok = await copyToClipboard(text)

  if (ok) {
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
      copiedTimer = null
    }, 1500)
  }
}

async function copyEvidenceCsv() {
  const text = buildEvidenceCsv(10)
  const ok = await copyToClipboard(text)
  if (ok) {
    copiedCsv.value = true
    if (copiedCsvTimer) clearTimeout(copiedCsvTimer)
    copiedCsvTimer = setTimeout(() => {
      copiedCsv.value = false
      copiedCsvTimer = null
    }, 1500)
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  let ok = false
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      ok = true
    }
  } catch {
    ok = false
  }

  if (!ok) {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      ok = document.execCommand('copy')
      document.body.removeChild(ta)
    } catch {
      ok = false
    }
  }

  return ok
}

function shortenId(id: string): string {
  const s = String(id || '')
  if (s.length <= 12) return s
  return s.slice(0, 6) + '…' + s.slice(-4)
}

function formatAny(v: any): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—'
  if (typeof v === 'string') return v.length > 60 ? v.slice(0, 60) + '…' : v
  try {
    const s = JSON.stringify(v)
    return s.length > 60 ? s.slice(0, 60) + '…' : s
  } catch {
    return String(v)
  }
}
</script>

<style scoped>
.v2-evidence-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 9999;
  display: flex;
  justify-content: flex-end;
}

.v2-evidence-drawer {
  width: min(520px, 92vw);
  height: 100vh;
  background: #ffffff;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
}

.v2-evidence-header {
  padding: 0.75rem 0.9rem;
  border-bottom: 1px solid #e9ecef;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.v2-evidence-title {
  font-weight: 700;
  font-size: 1rem;
}

.v2-evidence-body {
  padding: 0.9rem;
  overflow: auto;
}

.v2-evidence-sample {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.v2-evidence-sample-row {
  border: 1px solid #e9ecef;
  border-radius: 0.5rem;
  padding: 0.6rem;
}

.v2-evidence-chips {
  margin-top: 0.35rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

@media (max-width: 768px) {
  .v2-evidence-drawer {
    width: 100vw;
  }
}
</style>
