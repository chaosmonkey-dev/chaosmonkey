export type MetricId =
  // Existing productivity metrics
  | 'AI_suggestions_accepted' | 'files_edited_per_session' | 'commits_per_session' | 'average_session_length_minutes'
  | 'time_to_first_commit_minutes' | 'AI_usage_duration_minutes' | 'idle_time_minutes'
  // New productivity metrics
  | 'prod.commits' | 'prod.prs_merged' | 'prod.review_comments' | 'prod.ai_suggestions'
  // Engineering metrics
  | 'eng.pr_opened' | 'eng.pr_merged' | 'eng.lead_time' | 'eng.deploy_frequency'
  // IDE metrics
  | 'ide.coding_time' | 'ide.events';

export type MetricDef = { id: MetricId; label: string; description: string; dashboard: 'productivity'|'eng'|'ide' };

export const METRICS_CATALOG: MetricDef[] = [
  // Existing productivity metrics
  { id: 'AI_suggestions_accepted', label: 'AI Suggestions Accepted', description: 'AI-assisted accepts', dashboard: 'productivity' },
  { id: 'files_edited_per_session', label: 'Files per Session', description: 'Files edited per session', dashboard: 'productivity' },
  { id: 'commits_per_session', label: 'Commits per Session', description: 'Commits per session', dashboard: 'productivity' },
  { id: 'average_session_length_minutes', label: 'Average Session Length', description: 'Average session duration in minutes', dashboard: 'productivity' },
  { id: 'time_to_first_commit_minutes', label: 'Time to First Commit', description: 'Minutes to first commit', dashboard: 'productivity' },
  { id: 'AI_usage_duration_minutes', label: 'AI Usage Duration', description: 'AI usage time in minutes', dashboard: 'productivity' },
  { id: 'idle_time_minutes', label: 'Idle Time', description: 'Idle time in minutes', dashboard: 'productivity' },
  
  // New productivity metrics
  { id: 'prod.commits', label: 'Commits', description: 'Code commits over time', dashboard: 'productivity' },
  { id: 'prod.prs_merged', label: 'PRs Merged', description: 'Pull requests merged', dashboard: 'productivity' },
  { id: 'prod.review_comments', label: 'Review Comments', description: 'Code review activity', dashboard: 'productivity' },
  { id: 'prod.ai_suggestions', label: 'AI Suggestions Accepted (New)', description: 'AI-assisted accepts (new metric)', dashboard: 'productivity' },

  // Engineering metrics
  { id: 'eng.pr_opened', label: 'PRs Opened', description: 'Pull requests opened', dashboard: 'eng' },
  { id: 'eng.pr_merged', label: 'PRs Merged', description: 'Pull requests merged', dashboard: 'eng' },
  { id: 'eng.lead_time', label: 'Lead Time', description: 'Commit → deploy duration', dashboard: 'eng' },
  { id: 'eng.deploy_frequency', label: 'Deploy Frequency', description: 'Deploys per period', dashboard: 'eng' },

  // IDE metrics
  { id: 'ide.coding_time', label: 'Coding Time', description: 'Time spent coding', dashboard: 'ide' },
  { id: 'ide.events', label: 'IDE Events', description: 'Runs, tests, refactors', dashboard: 'ide' },
];

export const DEFAULT_SELECTED: MetricId[] = [
  // Existing productivity metrics
  'AI_suggestions_accepted', 'files_edited_per_session', 'commits_per_session',
  // New productivity metrics
  'prod.commits', 'prod.prs_merged',
  // Engineering metrics
  'eng.pr_merged', 'eng.lead_time',
  // IDE metrics
  'ide.coding_time',
];
