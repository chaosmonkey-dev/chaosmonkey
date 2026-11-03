// Canonical MVP keys — stable identifiers (NOT raw emitted IDs)
export const MVP_PI_CANONICAL = new Set<string>([
  // Plan & Code (5)
  'time-to-first-commit-by-ide',
  'commits-per-session-by-ide',
  'active-coding-time-by-ide',
  'ai-suggestions-accepted-by-ide',
  'average-session-length-by-ide',

  // Review & Merge (4)
  'review-merge-git-context',
  'pr-review-cycles-by-ide',
  'v2-first-review-latency',
  'pr-cycle-time-by-ide',

  // Deploy & Operate (3)
  'change-failure-rate-trend-org',
  'v2-release-risk-index',
  'reliability-lag-risk-org',
])
