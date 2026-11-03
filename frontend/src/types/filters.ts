export type DateRange = { from: string; to: string };

export type ViewBucket = 'daily' | 'weekly' | 'monthly';

export type Scope = 'org' | 'team' | 'dev';

export interface Filters {
  dateRange: DateRange;
  repos: string[];
  viewBucket: ViewBucket;
  scope: Scope;
  developerIds: string[];
  teamIds: string[];
  toolIds?: string[];
  metricId?: string;
  metricIds?: string[];
  productivityMetricId?: string | 'all';
  productivityMetricIds?: string[];
  viewType?: 'cards' | 'linegraph';
  timeComparison: 'wow' | 'mom' | 'qoq' | 'dod' | 'hoh' | 'all' | 'custom'; // Made non-optional
}

// Validation types for runtime guards
export type ValidViewBucket = ViewBucket;
export type ValidScope = Scope;

// Utility types for filter operations
export interface FilterUpdate {
  dateRange?: Partial<DateRange>;
  repos?: string[];
  viewBucket?: ViewBucket;
  scope?: Scope;
  developerIds?: string[];
  teamIds?: string[];
  toolIds?: string[];
  metricId?: string;
  metricIds?: string[];
  productivityMetricId?: string | 'all';
  productivityMetricIds?: string[];
  viewType?: 'cards' | 'linegraph';
}

// Filter state for different dashboard contexts
export interface DashboardFilters {
  engineering: Filters;
  ideActivity: Filters;
  productivity: Filters;
}

// Filter change event payload
export interface FilterChangeEvent {
  dashboard: keyof DashboardFilters;
  filters: Partial<Filters>;
}
