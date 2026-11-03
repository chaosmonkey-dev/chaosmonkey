/// <reference types="vite/client" />

declare interface ImportMetaEnv {
  readonly VITE_FEATURE_PERF_INSIGHTS?: string;
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_PI_DEBUG?: string;
  readonly VITE_PI_TRACE?: string;
  readonly VITE_PI_VALUE_MODE?: string;
  readonly VITE_PI_DEMO_UX?: string;
  readonly VITE_PI_STAGE_EXTRA?: string;
  readonly VITE_PI_STAGE_LIMIT?: string;
  readonly VITE_PI_TOTAL_LIMIT?: string;
  readonly VITE_PI_MAX_SUMMARIES_PER_STAGE?: string;
  readonly VITE_PI_MIN_DIAGNOSTICS_PER_STAGE?: string;
  readonly VITE_PI_MIN_TELEMETRY_DIAGNOSTICS?: string;
  readonly VITE_PI_MIN_REPO_DIAGNOSTICS?: string;
  readonly VITE_PI_MAX_PER_METRIC?: string;
  readonly VITE_PI_DEDUPE_MODE?: string;
  readonly VITE_PI_ALLOW_MIN_LEN_1?: string;
  readonly VITE_PI_BYPASS_P_VALUE?: string;
  readonly VITE_PI_MIN_N_FOR_P_VALUE?: string;
  readonly VITE_PI_RELAXED_MIN_ABS_R?: string;
  readonly VITE_PERF_INSIGHTS_COVERAGE?: string;
  readonly VITE_PERF_INSIGHTS_P_MAX?: string;
  readonly VITE_PERF_INSIGHTS_MIN_PERIODS?: string;
  readonly VITE_PERF_INSIGHTS_MAX?: string;
  readonly VITE_PERF_INSIGHTS_DEDUPE?: string;
  readonly VITE_PERF_INSIGHTS_ALLOW_SYNTH?: string;
  readonly VITE_PERF_INSIGHTS_SYNTH_WEEKS?: string;
  readonly VITE_TTFC_DEBUG?: string;
  readonly VITE_FEATURE_GITHUB_DRILLDOWN?: string;
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv;
}
