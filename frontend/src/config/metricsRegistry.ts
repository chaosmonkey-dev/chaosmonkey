export type MetricId = string  // intentionally open to allow new IDs without code changes
export type DashboardKey = 'productivity'|'eng'|'ide'|'other'

export type MetricDef = {
  id: MetricId;
  label: string;
  description?: string;
  dashboard: DashboardKey;
  defaultSelected?: boolean; // if true, new users auto-opt-in
}

export const STATIC_METRICS: MetricDef[] = [
  // Known metrics (seed with our canonical ones)
  { id:'prod.commits',          label:'Commits',             dashboard:'productivity', defaultSelected:true },
  { id:'prod.prs_merged',       label:'PRs Merged',          dashboard:'productivity', defaultSelected:true },
  { id:'prod.review_comments',  label:'Review Comments',     dashboard:'productivity' },
  { id:'prod.ai_suggestions',   label:'AI Suggestions',      dashboard:'productivity' },

  { id:'eng.pr_opened',         label:'PRs Opened',          dashboard:'eng' },
  { id:'eng.pr_merged',         label:'PRs Merged',          dashboard:'eng', defaultSelected:true },
  { id:'eng.lead_time',         label:'Lead Time',           dashboard:'eng', defaultSelected:true },
  { id:'eng.deploy_frequency',  label:'Deploy Frequency',    dashboard:'eng' },

  { id:'ide.coding_time',       label:'Coding Time',         dashboard:'ide', defaultSelected:true },
  { id:'ide.events',            label:'IDE Events',          dashboard:'ide' },
];

export function discoverMetricsFromCodebase(): MetricDef[] {
  // Safe heuristic to discover metrics from component strings
  // This is a best-effort approach that won't crash if patterns change
  
  const discovered: MetricDef[] = [];
  
  // Common metric patterns found in components
  const metricPatterns = [
    // Productivity patterns
    { pattern: /commits?/gi, id: 'prod.commits', label: 'Commits', dashboard: 'productivity' as DashboardKey },
    { pattern: /prs?_merged/gi, id: 'prod.prs_merged', label: 'PRs Merged', dashboard: 'productivity' as DashboardKey },
    { pattern: /review_comments?/gi, id: 'prod.review_comments', label: 'Review Comments', dashboard: 'productivity' as DashboardKey },
    { pattern: /ai_suggestions?/gi, id: 'prod.ai_suggestions', label: 'AI Suggestions', dashboard: 'productivity' as DashboardKey },
    { pattern: /files_edited/gi, id: 'prod.files_edited', label: 'Files Edited', dashboard: 'productivity' as DashboardKey },
    { pattern: /session_length/gi, id: 'prod.session_length', label: 'Session Length', dashboard: 'productivity' as DashboardKey },
    { pattern: /time_to_commit/gi, id: 'prod.time_to_commit', label: 'Time to Commit', dashboard: 'productivity' as DashboardKey },
    { pattern: /ai_usage/gi, id: 'prod.ai_usage', label: 'AI Usage', dashboard: 'productivity' as DashboardKey },
    { pattern: /idle_time/gi, id: 'prod.idle_time', label: 'Idle Time', dashboard: 'productivity' as DashboardKey },
    { pattern: /keystrokes/gi, id: 'prod.keystrokes', label: 'Keystrokes', dashboard: 'productivity' as DashboardKey },
    
    // Engineering patterns
    { pattern: /prs?_opened/gi, id: 'eng.pr_opened', label: 'PRs Opened', dashboard: 'eng' as DashboardKey },
    { pattern: /lead_time/gi, id: 'eng.lead_time', label: 'Lead Time', dashboard: 'eng' as DashboardKey },
    { pattern: /deploy_frequency/gi, id: 'eng.deploy_frequency', label: 'Deploy Frequency', dashboard: 'eng' as DashboardKey },
    { pattern: /change_failure_rate/gi, id: 'eng.change_failure_rate', label: 'Change Failure Rate', dashboard: 'eng' as DashboardKey },
    { pattern: /mean_time_to_recovery/gi, id: 'eng.mean_time_to_recovery', label: 'Mean Time to Recovery', dashboard: 'eng' as DashboardKey },
    { pattern: /code_review_coverage/gi, id: 'eng.code_review_coverage', label: 'Code Review Coverage', dashboard: 'eng' as DashboardKey },
    { pattern: /merge_rate/gi, id: 'eng.merge_rate', label: 'Merge Rate', dashboard: 'eng' as DashboardKey },
    { pattern: /code_review_time/gi, id: 'eng.code_review_time', label: 'Code Review Time', dashboard: 'eng' as DashboardKey },
    
    // IDE patterns
    { pattern: /coding_time/gi, id: 'ide.coding_time', label: 'Coding Time', dashboard: 'ide' as DashboardKey },
    { pattern: /events/gi, id: 'ide.events', label: 'IDE Events', dashboard: 'ide' as DashboardKey },
    { pattern: /debugging_time/gi, id: 'ide.debugging_time', label: 'Debugging Time', dashboard: 'ide' as DashboardKey },
    { pattern: /refactoring_time/gi, id: 'ide.refactoring_time', label: 'Refactoring Time', dashboard: 'ide' as DashboardKey },
    { pattern: /testing_time/gi, id: 'ide.testing_time', label: 'Testing Time', dashboard: 'ide' as DashboardKey },
    { pattern: /extension_usage/gi, id: 'ide.extension_usage', label: 'Extension Usage', dashboard: 'ide' as DashboardKey },
    { pattern: /project_switches/gi, id: 'ide.project_switches', label: 'Project Switches', dashboard: 'ide' as DashboardKey },
    { pattern: /terminal_usage/gi, id: 'ide.terminal_usage', label: 'Terminal Usage', dashboard: 'ide' as DashboardKey },
    { pattern: /git_operations/gi, id: 'ide.git_operations', label: 'Git Operations', dashboard: 'ide' as DashboardKey },
    
    // Quality patterns
    { pattern: /test_coverage/gi, id: 'quality.test_coverage', label: 'Test Coverage', dashboard: 'quality' as DashboardKey },
    { pattern: /bug_fixes/gi, id: 'quality.bug_fixes', label: 'Bug Fixes', dashboard: 'quality' as DashboardKey },
    { pattern: /technical_debt/gi, id: 'quality.technical_debt', label: 'Technical Debt', dashboard: 'quality' as DashboardKey },
    { pattern: /code_complexity/gi, id: 'quality.code_complexity', label: 'Code Complexity', dashboard: 'quality' as DashboardKey },
    { pattern: /documentation_updates/gi, id: 'quality.documentation_updates', label: 'Documentation Updates', dashboard: 'quality' as DashboardKey },
    
    // Collaboration patterns
    { pattern: /code_reviews_given/gi, id: 'collaboration.code_reviews_given', label: 'Code Reviews Given', dashboard: 'collaboration' as DashboardKey },
    { pattern: /code_reviews_received/gi, id: 'collaboration.code_reviews_received', label: 'Code Reviews Received', dashboard: 'collaboration' as DashboardKey },
    { pattern: /pair_programming/gi, id: 'collaboration.pair_programming', label: 'Pair Programming', dashboard: 'collaboration' as DashboardKey },
    { pattern: /knowledge_sharing/gi, id: 'collaboration.knowledge_sharing', label: 'Knowledge Sharing', dashboard: 'collaboration' as DashboardKey },
    
    // Performance patterns
    { pattern: /build_time/gi, id: 'performance.build_time', label: 'Build Time', dashboard: 'performance' as DashboardKey },
    { pattern: /test_execution_time/gi, id: 'performance.test_execution_time', label: 'Test Execution Time', dashboard: 'performance' as DashboardKey },
    { pattern: /deployment_time/gi, id: 'performance.deployment_time', label: 'Deployment Time', dashboard: 'performance' as DashboardKey },
    { pattern: /page_load_time/gi, id: 'performance.page_load_time', label: 'Page Load Time', dashboard: 'performance' as DashboardKey },
  ];
  
  // For now, return empty array - in a real implementation, this would scan component files
  // This is a safe fallback that won't crash the system
  return discovered;
}

export function buildRegistry(): MetricDef[] {
  const discovered = discoverMetricsFromCodebase();
  // Merge discovered + static by id with static taking precedence for label/dashboard
  const byId = new Map<string, MetricDef>();
  [...discovered, ...STATIC_METRICS].forEach(m => {
    const prior = byId.get(m.id);
    byId.set(m.id, prior ? { ...m, ...prior } : m);
  });
  // Sort by dashboard then label for consistency
  return Array.from(byId.values()).sort((a,b) => (a.dashboard===b.dashboard ? a.label.localeCompare(b.label) : a.dashboard.localeCompare(b.dashboard)));
}

export function splitByDashboard(reg: MetricDef[]) {
  return {
    productivity: reg.filter(m => m.dashboard === 'productivity'),
    eng:          reg.filter(m => m.dashboard === 'eng'),
    ide:          reg.filter(m => m.dashboard === 'ide'),
    other:        reg.filter(m => m.dashboard === 'other'),
  };
}

export function defaultSelectedIds(reg: MetricDef[]): string[] {
  return reg.filter(m => m.defaultSelected).map(m => m.id);
}
