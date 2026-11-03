export type SeriesPoint = {
  ts: string;
  value: number;
  seriesId?: string;
};

export type ToolSeriesPoint = {
  t: string;
  v: number;
};

export type ToolSeries = {
  label: string;
  points: ToolSeriesPoint[];
  usesTelemetry?: boolean;
  isLive?: boolean;
  dataSource?: 'Real' | 'Hybrid' | 'Simulated';
  telemetryPointCount?: number; // Number of chart points with telemetry
  totalPointCount?: number; // Total number of chart points
  sessionCount?: number; // Actual session count from aggregated telemetry
};

// Productivity-by-tool time series returned by metricsFacade + simulator + telemetry overlay.
export type TimeSeries = ToolSeries[];

export type DataSource = 'Real' | 'Simulated';

export type ProductivityQuery = {
  from: string;
  to: string;
  repos: string[];
  scope: 'org' | 'team' | 'dev';
  viewBucket: 'daily' | 'weekly' | 'monthly';
  developerIds?: string[];
  /** K1B: cohort scope — '<id>' | 'unassigned' | 'all' | '' (absent = all) */
  cohortId?: string;
  teamIds?: string[];
  toolIds?: string[];
  metricId?: string;
  metricIds?: string[];
  groupBy?: 'developer';
};

export type TSResult = {
  dataSource: DataSource;
  series: TimeSeries;
  latest_observed_at?: string | null;
  metadata?: Record<string, any> | null;
};

export type SummaryResult = { 
  dataSource: DataSource; 
  totals: Record<string, number>;
  avgTimeToFirstCommitMinutes?: number | null;
};

// Additional types for comprehensive metrics
export type MetricType = 
  | 'commits'
  | 'prs_merged'
  | 'ai_suggestions'
  | 'review_comments'
  | 'deployment_frequency'
  | 'lead_time'
  | 'change_failure_rate';

export type MetricSeries = {
  metricType: MetricType;
  series: TimeSeries;
  metadata?: {
    unit?: string;
    description?: string;
    minValue?: number;
    maxValue?: number;
  };
};

export type ProductivityMetrics = {
  timeSeries: MetricSeries[];
  summary: SummaryResult;
  query: ProductivityQuery;
  lastUpdated: string;
};

// Error types for API responses
export type APIError = {
  status: number;
  message: string;
  code?: string;
  details?: any;
};

export type APIResponse<T> = {
  success: boolean;
  data?: T;
  error?: APIError;
  status: 'available' | 'unavailable' | 'not_implemented' | 'error';
};
