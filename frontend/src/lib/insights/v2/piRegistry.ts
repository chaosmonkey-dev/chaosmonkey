// PI Registry - Canonical registry of all Performance Insights
export const PI_REGISTRY = {
  // MVP PIs (existing)
  'telemetry-ttfc-first-20-sessions': { stage: 'v2-preview', sourceEngine: 'v2' },
  
  // New additive PIs - Plan & Code Stage
  'telemetry-session-quality-regression': { stage: 'v2-preview', sourceEngine: 'v2' },
  'telemetry-ai-focus-imbalance': { stage: 'v2-preview', sourceEngine: 'v2' },
  'telemetry-remote-workspace-drag': { stage: 'v2-preview', sourceEngine: 'v2' },
  'telemetry-session-idle-time': { stage: 'v2-preview', sourceEngine: 'v2' },
  'telemetry-session-multitasking': { stage: 'v2-preview', sourceEngine: 'v2' },
  'telemetry-session-context-switching': { stage: 'v2-preview', sourceEngine: 'v2' },
  'telemetry-session-productivity-banding': { stage: 'v2-preview', sourceEngine: 'v2' },
  'telemetry-session-ai-intensity': { stage: 'v2-preview', sourceEngine: 'v2' },
  'telemetry-session-work-patterns': { stage: 'v2-preview', sourceEngine: 'v2' },
  
  // Review & Merge Stage additions
  'reviewer-load-concentration': { stage: 'v2-preview', sourceEngine: 'v2' },
  'reopen-pressure-spike': { stage: 'v2-preview', sourceEngine: 'v2' },
  'large-pr-mix-risk': { stage: 'v2-preview', sourceEngine: 'v2' },
  'review-latency-spike-detection': { stage: 'v2-preview', sourceEngine: 'v2' },
  
  // Deploy & Operate Stage additions
  'stale-deployment-signal': { stage: 'v2-preview', sourceEngine: 'v2' },
  'failed-deployment-pressure': { stage: 'v2-preview', sourceEngine: 'v2' },
  'latest-deployment-unhealthy': { stage: 'v2-preview', sourceEngine: 'v2' },
  'deploy-frequency-regression': { stage: 'v2-preview', sourceEngine: 'v2' },
  'deploy-failure-rate-spike': { stage: 'v2-preview', sourceEngine: 'v2' },
} as const;

export const logRegistryProof = () => {
  console.log('[PI_REGISTRY_PROOF]', PI_REGISTRY);
  console.log('[PI_REGISTRY_COUNT]', Object.keys(PI_REGISTRY).length);
};
