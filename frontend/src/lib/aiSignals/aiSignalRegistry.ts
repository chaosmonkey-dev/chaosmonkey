/**
 * AI Executive Signals Registry
 *
 * Defines the 4 executive intelligence signals that connect upstream AI behavior
 * to downstream SDLC outcomes. Each signal maps to supporting Performance Insights
 * and provides evidence chains and recommendation flows.
 *
 * Design Principles:
 * - Telemetry-first: Use available session data (sessions, active minutes, AI bursts)
 * - No GitHub dependency: Don't require commits/PRs/deployments for basic signals
 * - Interpretable: Understood in <3 seconds by engineering leaders
 * - Evidence-based: Real data from telemetry + linked PIs
 * - No vanity metrics: Avoid naked telemetry or generic activity indicators
 * - Executive clarity: Each signal answers "what should I pay attention to?"
 */

export type SignalDirection = 'positive' | 'warning' | 'risk' | 'neutral'
export type SignalStage = 'plan-code' | 'review-merge' | 'deploy-operate'
export type ConfidenceLevel = 'high' | 'medium' | 'low'
export type SignalTier = 'primary' | 'secondary'

export interface AISignal {
  id: string
  title: string
  workflowIdentity: string
  workflowAccent: 'blue' | 'amber' | 'slate' | 'purple'
  executiveHeadline: string
  operationalInterpretation: string
  operationalConsequence: string
  evidenceDescription: string
  temporalContext: string
  deltaContext: string
  stage: SignalStage
  tier: SignalTier
  primaryPI: string
  secondaryPIs: string[]
  evidenceChain: EvidenceChain
  recommendationFlow: RecommendationFlow
  dataSources: DataSource[]
  minimumSampleSize: number
  minimumTimeWindow: number // in days
  confidence?: ConfidenceLevel
}

export interface EvidenceChain {
  telemetryFields: string[]
  githubFields: string[]
  computation: string
}

export interface RecommendationFlow {
  positiveCondition: string
  positiveAction: string
  negativeCondition: string
  negativeAction: string
}

export interface DataSource {
  type: 'telemetry' | 'github' | 'dora'
  field: string
  description: string
}

/**
 * SIGNAL TO PI MAPPING
 *
 * Each signal maps to 1 primary PI and 1-2 secondary PIs.
 * This enables click-to-drilldown from signal → Performance Insights.
 */
export const SIGNAL_TO_PI_MAP: Record<string, string[]> = {
  'ai-adoption-standardization': [
    'active-coding-time-by-ide',
    'ai-suggestions-accepted-by-ide'
  ],
  'workflow-velocity': [
    'active-coding-time-by-ide',
    'session-length-by-ide',
    'ai-suggestions-accepted-by-ide'
  ],
  'review-quality-risk': [
    'session-conditioned-pr-cycle-time-ai-vs-non-ai',
    'executive-small-pr-workflow-optimization',
    'revert-rate-by-ide',
    'executive-ai-reopen-pressure-risk'
  ],
  'tool-fragmentation-variance': [
    'delivery-rate-ai-vs-non-ai',
    'executive-stable-deployment-acceleration',
    'active-coding-time-by-ide'
  ]
}

/**
 * PI TO SIGNAL MAPPING (reverse lookup)
 * Used to highlight signals when a PI is expanded
 */
export const PI_TO_SIGNAL_MAP: Record<string, string[]> = {}

// Build reverse mapping
for (const [signalId, piIds] of Object.entries(SIGNAL_TO_PI_MAP)) {
  for (const piId of piIds) {
    if (!PI_TO_SIGNAL_MAP[piId]) {
      PI_TO_SIGNAL_MAP[piId] = []
    }
    PI_TO_SIGNAL_MAP[piId].push(signalId)
  }
}

/**
 * EXECUTIVE SIGNALS REGISTRY
 *
 * The 4 canonical AI operational intelligence signals (telemetry-first).
 * Consolidated from 8 signals to 4 executive categories for clarity.
 */
export const AI_SIGNAL_REGISTRY: ReadonlyArray<AISignal> = [
  // ============================================================
  // SIGNAL 1: AI Adoption & Standardization
  // ============================================================
  {
    id: 'ai-adoption-standardization',
    title: 'Cursor workflows delivering 19% faster PR velocity',
    workflowIdentity: 'Cursor workflow',
    workflowAccent: 'blue',
    executiveHeadline: 'AI adoption is strong; standardization opportunity exists',
    operationalInterpretation: 'Longer focus windows, lower review churn',
    operationalConsequence: 'Delivery throughput +19% in critical paths',
    evidenceDescription: '200 sessions analyzed',
    temporalContext: 'Last 14 days',
    deltaContext: '↑ 19% vs prior sprint',
    stage: 'plan-code',
    tier: 'primary',
    primaryPI: 'active-coding-time-by-ide',
    secondaryPIs: ['ai-suggestions-accepted-by-ide'],
    evidenceChain: {
      telemetryFields: ['ai_burst_count', 'session_id', 'tool'],
      githubFields: [],
      computation: 'Calculate % of sessions with AI activity, segment by IDE'
    },
    recommendationFlow: {
      positiveCondition: 'AI adoption ≥ 70% with balanced IDE distribution',
      positiveAction: 'Strong adoption with diverse tooling; maintain flexibility',
      negativeCondition: 'AI adoption < 50% or single IDE > 80% share',
      negativeAction: 'Encourage AI adoption or standardize on dominant workflow'
    },
    dataSources: [
      { type: 'telemetry', field: 'ai_burst_count', description: 'AI suggestions per session' },
      { type: 'telemetry', field: 'session_id', description: 'Session identifier' },
      { type: 'telemetry', field: 'tool', description: 'IDE identifier' }
    ],
    minimumSampleSize: 20,
    minimumTimeWindow: 7,
    confidence: 'high'
  },

  // ============================================================
  // SIGNAL 2: Workflow Velocity
  // ============================================================
  {
    id: 'workflow-velocity',
    title: 'Devin workflows show 15% higher AI intensity but 14% more context switching',
    workflowIdentity: 'Devin workflow',
    workflowAccent: 'amber',
    executiveHeadline: 'AI intensity varies by workflow with tradeoffs',
    operationalInterpretation: 'Higher AI throughput, more review variance',
    operationalConsequence: 'Reviewer variance +14% in exploratory workflows',
    evidenceDescription: '3 IDE workflows analyzed',
    temporalContext: 'Last 14 days',
    deltaContext: '↑ 15% week-over-week',
    stage: 'plan-code',
    tier: 'primary',
    primaryPI: 'ai-suggestions-accepted-by-ide',
    secondaryPIs: ['active-coding-time-by-ide', 'session-length-by-ide'],
    evidenceChain: {
      telemetryFields: ['ai_burst_count', 'session_id', 'tool', 'active_coding_duration_minutes'],
      githubFields: [],
      computation: 'Calculate assists per session and focus time, segment by IDE'
    },
    recommendationFlow: {
      positiveCondition: 'Balanced AI intensity (5-15 assists/session) with sustained focus (>30 min)',
      positiveAction: 'Optimal AI workflow patterns; maintain current approach',
      negativeCondition: 'High AI intensity (>20 assists) with fragmented focus (<15 min)',
      negativeAction: 'Review AI usage patterns; encourage focused coding windows'
    },
    dataSources: [
      { type: 'telemetry', field: 'ai_burst_count', description: 'AI suggestions per session' },
      { type: 'telemetry', field: 'session_id', description: 'Session identifier' },
      { type: 'telemetry', field: 'tool', description: 'IDE identifier' },
      { type: 'telemetry', field: 'active_coding_duration_minutes', description: 'Active coding time' }
    ],
    minimumSampleSize: 20,
    minimumTimeWindow: 7,
    confidence: 'medium'
  },

  // ============================================================
  // SIGNAL 3: Review / Quality Risk
  // ============================================================
  {
    id: 'review-quality-risk',
    title: 'Review variance eroding ~15% of delivery gains in AI-heavy workflows',
    workflowIdentity: 'VS Code workflow',
    workflowAccent: 'slate',
    executiveHeadline: 'AI speed may be creating review bottlenecks',
    operationalInterpretation: 'Faster merge times, elevated rework rates',
    operationalConsequence: 'Review stability -15% in AI-heavy paths',
    evidenceDescription: '148 PR review events',
    temporalContext: 'Last 14 days',
    deltaContext: '↓ 15% vs prior sprint',
    stage: 'review-merge',
    tier: 'primary',
    primaryPI: 'pr-review-cycles-by-ide',
    secondaryPIs: ['executive-small-pr-workflow-optimization', 'revert-rate-by-ide', 'executive-ai-reopen-pressure-risk'],
    evidenceChain: {
      telemetryFields: ['ai_burst_count', 'session_id', 'tool'],
      githubFields: [],
      computation: 'Link AI sessions to review cycle time and rework PIs'
    },
    recommendationFlow: {
      positiveCondition: 'AI-assisted PRs show faster review times with stable rework rates',
      positiveAction: 'AI improving review efficiency; monitor patterns',
      negativeCondition: 'AI-assisted PRs show slower review times or elevated rework',
      negativeAction: 'Implement PR batching and review guardrails for AI-heavy workflows'
    },
    dataSources: [
      { type: 'telemetry', field: 'ai_burst_count', description: 'AI suggestions per session' },
      { type: 'telemetry', field: 'session_id', description: 'Session identifier' }
    ],
    minimumSampleSize: 10,
    minimumTimeWindow: 7,
    confidence: 'low'
  },

  // ============================================================
  // SIGNAL 4: Tool Fragmentation / Workflow Variance
  // ============================================================
  {
    id: 'tool-fragmentation-variance',
    title: '3 AI workflows active; delivery variance increasing across IDEs',
    workflowIdentity: 'Mixed + Multi-Model',
    workflowAccent: 'purple',
    executiveHeadline: 'Tool diversity creating delivery variance',
    operationalInterpretation: 'Accelerating output, inconsistent delivery patterns',
    operationalConsequence: 'Merge consistency improving, bottlenecks lowering',
    evidenceDescription: '3 IDE workflows analyzed',
    temporalContext: 'Last 14 days',
    deltaContext: '→ variance narrowing vs prior period',
    stage: 'deploy-operate',
    tier: 'primary',
    primaryPI: 'delivery-rate-ai-vs-non-ai',
    secondaryPIs: ['executive-stable-deployment-acceleration', 'active-coding-time-by-ide'],
    evidenceChain: {
      telemetryFields: ['tool', 'session_id', 'ai_burst_count'],
      githubFields: [],
      computation: 'Count unique IDEs with AI activity and link to delivery PIs'
    },
    recommendationFlow: {
      positiveCondition: 'Diverse tooling with consistent delivery patterns',
      positiveAction: 'Healthy tool diversity with stable delivery; maintain flexibility',
      negativeCondition: 'High tool diversity with delivery variance or single-tool dependency',
      negativeAction: 'Standardize workflows for delivery-critical work; reserve diverse tools for exploration'
    },
    dataSources: [
      { type: 'telemetry', field: 'tool', description: 'IDE identifier' },
      { type: 'telemetry', field: 'session_id', description: 'Session identifier' },
      { type: 'telemetry', field: 'ai_burst_count', description: 'AI suggestions per session' }
    ],
    minimumSampleSize: 10,
    minimumTimeWindow: 7,
    confidence: 'high'
  }
]

/**
 * Helper functions for registry queries
 */
export const getSignalById = (id: string): AISignal | undefined => {
  return AI_SIGNAL_REGISTRY.find(signal => signal.id === id)
}

export const getSignalsByStage = (stage: SignalStage): AISignal[] => {
  return AI_SIGNAL_REGISTRY
    .filter(signal => signal.stage === stage)
    .sort((a, b) => a.id.localeCompare(b.id))
}

export const getSignalsForPI = (piId: string): AISignal[] => {
  const signalIds = PI_TO_SIGNAL_MAP[piId] || []
  return signalIds
    .map(id => getSignalById(id))
    .filter((signal): signal is AISignal => signal !== undefined)
}

export const getAllSignalIds = (): Set<string> => {
  return new Set(AI_SIGNAL_REGISTRY.map(signal => signal.id))
}

export const getPrimaryPIForSignal = (signalId: string): string | undefined => {
  return getSignalById(signalId)?.primaryPI
}

export const getSecondaryPIsForSignal = (signalId: string): string[] => {
  return getSignalById(signalId)?.secondaryPIs || []
}

export const getAllPIsForSignal = (signalId: string): string[] => {
  const signal = getSignalById(signalId)
  if (!signal) return []
  return [signal.primaryPI, ...signal.secondaryPIs]
}
