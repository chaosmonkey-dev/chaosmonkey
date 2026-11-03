/**
 * Canonical Workflow Identity System
 * 
 * Single source of truth for all workflow naming across:
 * - Productivity by Tool Over Time
 * - Performance Insights (AI Operational Intelligence, IDE Operational Posture)
 * - All PI expanded views, evidence, recommendations, operational summaries
 * 
 * PREFERRED FORMAT: "Model + Context" (e.g., "Claude Sonnet 4.6 acceleration workflows")
 * 
 * This ensures cross-tab continuity and unified operational intelligence presentation.
 */

// Canonical model naming map - ONE source of truth for all model names
// Models only - modern frontier-style naming (no agent/layer branding)
export const CANONICAL_MODEL_NAMES: Record<string, string> = {
  'sonnet': 'Claude Sonnet 4.6',
  'claude': 'Claude Sonnet 4.6',
  'opus': 'Claude Opus 4.2',
  'gpt4o': 'GPT-5 Coding',
  'gpt': 'GPT-5 Coding',
  'gemini': 'Gemini 2.6 Pro',
  'swe': 'SWE-1.6',
  'composer': 'DeepSeek-Coder V3',
  'codestral': 'Codestral 2',
  'llama': 'Llama 4 Code',
  'kimi': 'Kimi K2.6',
  'grok': 'Grok Code Fast-1',
  'flash': 'Gemini 2.6 Flash'
}

// IDE to model mapping for model mode presentation
// Maps IDEs to unique ACTUAL MODELS (no agent/layer branding)
export const IDE_TO_MODEL_MAP: Record<string, string> = {
  'cursor': 'sonnet',        // Claude Sonnet 4.6
  'windsurf': 'swe',         // SWE-1.6
  'vscode': 'gpt4o',         // GPT-5 Coding
  'claude_code': 'sonnet',   // Claude Sonnet 4.6
  'github_copilot': 'gpt4o', // GPT-5 Coding
  'jetbrains': 'opus',       // Claude Opus 4.2
  'sublime': 'gemini',       // Gemini 2.6 Pro
  'vim': 'composer'          // DeepSeek-Coder V3 (unique model for Vim)
}

// Canonical IDE names
// CR4 FINAL: Windsurf is legacy telemetry for the Devin workflow.
// Product rule (CR1/CR2 accepted and frozen): Windsurf = Devin.
// Evidence: zero temporal overlap (windsurf ends 2026-06-08, devin starts
// 2026-06-25), extension version progression (0.3.7→0.3.8), metadata
// enrichment (gained appName/uriScheme). This is a product rename/migration.
export const CANONICAL_IDE_NAMES: Record<string, string> = {
  'devin': 'Devin',
  'cursor': 'Cursor',
  'windsurf': 'Devin',  // Display as Devin (Windsurf is legacy Devin telemetry)
  'vscode': 'VS Code',
  'claude_code': 'Claude Code',
  'codex': 'Codex',
  'github_copilot': 'GitHub Copilot',
  'jetbrains': 'JetBrains',
  'sublime': 'Sublime',
  'vim': 'Vim',
  'intellij': 'IntelliJ',
  'unknown': 'Unknown'
}

// Get canonical model name
export function getCanonicalModelName(modelId: string): string {
  const normalizedId = modelId.toLowerCase()
  return CANONICAL_MODEL_NAMES[normalizedId] || modelId
}

// Get canonical IDE name
export function getCanonicalIDEName(ideId: string): string {
  const normalizedId = ideId.toLowerCase()
  return CANONICAL_IDE_NAMES[normalizedId] || ideId.charAt(0).toUpperCase() + ideId.slice(1)
}

/**
 * CR-X FINAL (binding edit 4): Centralized workflow display name.
 * Backed by CANONICAL_IDE_NAMES (the existing canonical name authority).
 * Generators import this instead of duplicating hardcoded name maps.
 * A new workflow (e.g. Codex) is named once here.
 */
export function getWorkflowDisplayName(toolId: string | null | undefined): string {
  if (!toolId) return 'Unknown'
  const normalized = String(toolId).toLowerCase().trim()
  return CANONICAL_IDE_NAMES[normalized]
    || CANONICAL_IDE_NAMES[CANONICAL_TOOL_ALIASES[normalized] ?? '']
    || normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

// Get canonical tool name (alias for getCanonicalIDEName for backward compatibility)
export function getCanonicalToolName(ideId: string): string {
  return getCanonicalIDEName(ideId)
}

// Get canonical workflow identity (IDE-only format)
// NOTE: Telemetry captures IDE/tool/editor source, not active coding model
// For pilot credibility, we only show IDE/tool labels
export function getCanonicalWorkflowIdentity(ideId: string): string {
  const normalizedIdeId = ideId.toLowerCase()
  const ideName = getCanonicalIDEName(normalizedIdeId)

  // Return IDE-only label - no model attribution
  // Model attribution is not captured by extension telemetry
  return `${ideName} workflow`
}


// Get canonical entity label for different comparison modes
// Used in Productivity by Tool for dropdowns, legends, cards
export function getCanonicalEntityLabel(entityId: string, mode: string): string {
  const normalizedId = entityId.toLowerCase()
  
  if (mode === 'models') {
    // Model mode: Always use full canonical model names
    return getCanonicalModelName(normalizedId)
  }
  
  if (mode === 'ides') {
    // IDEs mode: Use canonical IDE names
    return getCanonicalIDEName(normalizedId)
  }
  
  if (mode === 'workflows') {
    // Workflows mode: Use IDE + Model format (preferred)
    return getCanonicalWorkflowIdentity(normalizedId)
  }
  
  // Default fallback
  return entityId.charAt(0).toUpperCase() + entityId.slice(1)
}

// Supported IDEs with canonical names
// Used in Productivity by Tool for comparison entities
export const SUPPORTED_IDES = [
  { id: 'cursor', name: 'Cursor', icon: 'bi-cursor', color: 'dark', status: 'supported' },
  { id: 'windsurf', name: 'Devin', icon: 'bi-wind', color: 'dark', status: 'supported' },  // Display as Devin
  { id: 'vscode', name: 'VS Code', icon: 'bi-code-square', color: 'dark', status: 'supported' },
  { id: 'claude_code', name: 'Claude Code', icon: 'bi-robot', color: 'dark', status: 'supported' },
  { id: 'codex', name: 'Codex', icon: 'bi-terminal', color: 'dark', status: 'supported' },
  { id: 'github_copilot', name: 'GitHub Copilot', icon: 'bi-github', color: 'dark', status: 'supported' },
  { id: 'jetbrains', name: 'JetBrains', icon: 'bi-journal-code', color: 'dark', status: 'supported' },
  { id: 'sublime', name: 'Sublime', icon: 'bi-file-code', color: 'dark', status: 'supported' },
  { id: 'vim', name: 'Vim', icon: 'bi-terminal', color: 'dark', status: 'supported' }
]

// Get model for IDE (used in Performance Insights)
export function getModelForIDE(toolId: string): string {
  const modelId = IDE_TO_MODEL_MAP[toolId.toLowerCase()]
  return modelId ? getCanonicalModelName(modelId) : 'Unknown'
}

/**
 * Canonical tool ID normalization map.
 * Aliases are collapsed to a single canonical ID before any aggregation,
 * grouping, or card rendering. This prevents duplicate cards for the same
 * product workflow (e.g. legacy 'windsurf' telemetry → canonical 'devin').
 *
 * CR4 FINAL: Windsurf is legacy telemetry for the Devin workflow.
 * Product rule (CR1/CR2 accepted and frozen): Windsurf = Devin.
 * Evidence: zero temporal overlap (windsurf ends 2026-06-08, devin starts
 * 2026-06-25), extension version progression (0.3.7→0.3.8), metadata
 * enrichment (gained appName/uriScheme). This is a product rename/migration.
 *
 * Required compatibility:
 *   devin         → devin
 *   windsurf      → devin
 *   cursor        → cursor
 *   vscode        → vscode
 *   claude_code   → claude_code
 *   github_copilot → github_copilot
 *   codex         → codex
 */
export const CANONICAL_TOOL_ALIASES: Record<string, string> = {
  'windsurf': 'devin',
  'codex-cli': 'codex',
  'codex_cli': 'codex',
  'openai-codex': 'codex',
}

/**
 * Normalize a raw tool ID to its canonical form.
 * Returns the canonical ID (e.g. 'devin' for 'windsurf'),
 * or the lowercased original if no alias exists.
 */
export function normalizeToCanonicalToolId(rawToolId: string | null | undefined): string {
  if (rawToolId == null) return ''
  const normalized = String(rawToolId).toLowerCase().trim()
  if (!normalized) return ''
  return CANONICAL_TOOL_ALIASES[normalized] ?? normalized
}

/**
 * Expand canonical workflow IDs to every raw tool ID that maps to them
 * (inverse of CANONICAL_TOOL_ALIASES). Endpoints that filter on raw
 * source/editor_source values (e.g. /api/telemetry/canonical `tools`)
 * must receive the full raw set — 'devin' alone would miss the legacy
 * 'windsurf' telemetry that canonically belongs to the Devin workflow.
 */
export function expandCanonicalToolIds(canonicalIds: string[]): string[] {
  const out = new Set<string>()
  for (const id of canonicalIds) {
    const canonical = normalizeToCanonicalToolId(id)
    if (!canonical) continue
    out.add(canonical)
    for (const [raw, target] of Object.entries(CANONICAL_TOOL_ALIASES)) {
      if (target === canonical) out.add(raw)
    }
  }
  return Array.from(out)
}

// ============================================================================
// CANONICAL WORKFLOW UNIVERSE - Single Source of Truth for All Surfaces
// ============================================================================

/**
 * Canonical real workflows - the workflows with actual telemetry data
 * Used across: AI Ops, Performance Insights, Productivity V3
 * Excludes: test-browser (non-real/test tool only)
 */
export const CANONICAL_REAL_WORKFLOWS = [
  'claude_code',
  'codex',
  'cursor',
  'devin',
  'github_copilot',
  'vscode',
] as const

/**
 * Excluded workflows - tools to exclude from canonical universe
 * Currently: test-browser (non-real/test tool only)
 */
export const EXCLUDED_WORKFLOWS = [
  'test-browser'
] as const

/**
 * All supported IDEs (including legacy IDEs without canonical telemetry)
 * Used for comparison mode dropdowns and IDE-specific features
 * NOTE: This is broader than CANONICAL_REAL_WORKFLOWS for legacy support
 */
export const ALL_SUPPORTED_IDES = [
  'claude_code',
  'codex',
  'cursor',
  'github_copilot',
  'vscode',
  'windsurf',
  'jetbrains',
  'sublime',
  'vim'
] as const

/**
 * Check if a workflow is in the canonical real workflow universe
 */
export function isCanonicalRealWorkflow(workflowId: string): boolean {
  return CANONICAL_REAL_WORKFLOWS.includes(workflowId as any)
}

/**
 * Check if a workflow should be excluded from canonical universe
 */
export function isExcludedWorkflow(workflowId: string): boolean {
  return EXCLUDED_WORKFLOWS.includes(workflowId as any)
}

/**
 * Filter array to canonical real workflows only
 */
export function filterToCanonicalWorkflows<T extends { ide?: string; label?: string; id?: string }>(
  items: T[],
  key: 'ide' | 'label' | 'id' = 'ide'
): T[] {
  return items.filter(item => {
    const workflowId = item[key]?.toLowerCase()
    return workflowId && isCanonicalRealWorkflow(workflowId)
  })
}

// ============================================================================
// CANONICAL WORKFLOW COUNT AUTHORITY
// ============================================================================

export const PRIMARY_SESSION_THRESHOLD = 25

const EXCLUDED_FROM_UNIVERSE = new Set<string>([
  'unknown',
  'extension',
  'test_browser',
  'test-browser',
  'testbrowser',
  ...EXCLUDED_WORKFLOWS,
])

export interface CanonicalCountMetadata {
  tools_in_population?: string[]
  session_count_by_tool?: Record<string, number>
  [key: string]: unknown
}

export interface WorkflowCountResult {
  universe: string[]
  sessionCountByCanonical: Record<string, number>
  trackedCount: number
  primaryCount: number
  emergingCount: number
}

/**
 * Derive the displayed workflow universe and session counts from canonical
 * metadata. Raw tool IDs are normalized via normalizeToCanonicalToolId (e.g.
 * windsurf → devin) and all raw identities that map to the same canonical ID
 * are summed together.
 *
 * This is the single production authority for tracked/primary/emerging counts
 * across Dashboards, AIOI, and PBT surfaces.
 */
export function deriveWorkflowCounts(
  metadata: CanonicalCountMetadata | null | undefined
): WorkflowCountResult {
  const empty: WorkflowCountResult = {
    universe: [],
    sessionCountByCanonical: {},
    trackedCount: 0,
    primaryCount: 0,
    emergingCount: 0,
  }

  if (!metadata) return empty

  const counts = metadata.session_count_by_tool
  if (!counts || typeof counts !== 'object') return empty

  const sessionCountByCanonical: Record<string, number> = {}
  const universe = new Set<string>()

  for (const [rawToolId, rawCount] of Object.entries(counts)) {
    const canonical = normalizeToCanonicalToolId(rawToolId)
    if (!canonical || EXCLUDED_FROM_UNIVERSE.has(canonical)) continue
    if (typeof rawCount !== 'number' || !Number.isFinite(rawCount) || rawCount <= 0) continue

    universe.add(canonical)
    sessionCountByCanonical[canonical] = (sessionCountByCanonical[canonical] || 0) + rawCount
  }

  const population = Array.isArray(metadata.tools_in_population) ? metadata.tools_in_population : []
  for (const rawId of population) {
    const canonical = normalizeToCanonicalToolId(String(rawId ?? ''))
    if (!canonical || EXCLUDED_FROM_UNIVERSE.has(canonical)) continue
    if (!universe.has(canonical) && !(canonical in sessionCountByCanonical)) {
      universe.add(canonical)
      if (!(canonical in sessionCountByCanonical)) {
        sessionCountByCanonical[canonical] = 0
      }
    }
  }

  const universeArr = Array.from(universe)
  let primaryCount = 0
  let emergingCount = 0

  for (const toolId of universeArr) {
    const sessionCount = sessionCountByCanonical[toolId] || 0
    if (sessionCount >= PRIMARY_SESSION_THRESHOLD) {
      primaryCount++
    } else {
      emergingCount++
    }
  }

  return {
    universe: universeArr,
    sessionCountByCanonical,
    trackedCount: universeArr.length,
    primaryCount,
    emergingCount,
  }
}

// ============================================================================
// MEASURED VALUE PRESERVATION
// ============================================================================

/**
 * Preserve finite numeric values (including 0) and convert all non-finite
 * or missing values to null.
 *
 * - finite numeric 0 → 0
 * - finite positive/negative number → that number
 * - null → null
 * - undefined → null
 * - empty string → null
 * - non-numeric string → null
 * - NaN / Infinity / -Infinity → null
 *
 * This prevents fabricating zero for unavailable measurements while
 * preserving legitimate measured zero values.
 */
export function finiteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
