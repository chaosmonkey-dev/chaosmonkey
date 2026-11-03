/**
 * FINAL PI ENGINE RUNTIME TRACE
 * 
 * Executable runtime pipeline trace for the FINAL PI engine
 * This is NOT static analysis - this captures actual runtime execution
 */

import type { CanonicalInsightInput, CanonicalInsight } from './types';
import { generateFinalCanonicalInsights } from './index';
import { getCanonicalPIIds } from './canonicalInsights';
import { fetchCanonicalInsightInput } from './dataAccess';
import { buildApiUrl } from '../../../utils/apiUrl';
import { piDebugLog } from './utils/logging';

/**
 * Runtime pipeline stage counts
 */
interface PipelineCounts {
  registry: number;
  dataAccessComplete: boolean;
  sessionRowsCount: number;
  githubDataAvailable: boolean;
  generatorProduced: number;
  validationPassed: number;
  canonicalFiltered: number;
  realismProcessed: number;
  widgetInput: number;
}

/**
 * Per-PI runtime status
 */
interface PIRuntimeStatus {
  id: string;
  stage: string;
  generatorCalled: boolean;
  generatorReturned: boolean;
  validationPassed: boolean;
  canonicalFiltered: boolean;
  realismProcessed: boolean;
  widgetInput: boolean;
  failureReason?: string;
  failurePoint?: string;
  runtimeValues?: Record<string, any>;
}

/**
 * Execute complete runtime pipeline trace
 */
export async function executeRuntimeTrace(): Promise<{
  pipelineCounts: PipelineCounts;
  piStatuses: PIRuntimeStatus[];
  signalTrace: Record<string, any>;
  evidence: Record<string, any>;
}> {
  piDebugLog('[RUNTIME_TRACE][START]', '=== FINAL PI ENGINE RUNTIME TRACE ===');
  
  const pipelineCounts: PipelineCounts = {
    registry: 0,
    dataAccessComplete: false,
    sessionRowsCount: 0,
    githubDataAvailable: false,
    generatorProduced: 0,
    validationPassed: 0,
    canonicalFiltered: 0,
    realismProcessed: 0,
    widgetInput: 0
  };

  const piStatuses: PIRuntimeStatus[] = [];
  const signalTrace: Record<string, any> = {};
  const evidence: Record<string, any> = {};

  // ============================================================
  // STAGE 1: REGISTRY COUNT
  // ============================================================
  const canonicalIds = getCanonicalPIIds();
  pipelineCounts.registry = canonicalIds.size;
  piDebugLog('[RUNTIME_TRACE][REGISTRY]', `Registry contains ${pipelineCounts.registry} canonical PIs`);
  piDebugLog('[RUNTIME_TRACE][REGISTRY_IDS]', Array.from(canonicalIds));

  // Initialize PI statuses
  for (const id of canonicalIds) {
    piStatuses.push({
      id,
      stage: 'unknown', // Will be determined from registry
      generatorCalled: false,
      generatorReturned: false,
      validationPassed: false,
      canonicalFiltered: false,
      realismProcessed: false,
      widgetInput: false
    });
  }

  // ============================================================
  // STAGE 2: DATA ACCESS
  // ============================================================
  piDebugLog('[RUNTIME_TRACE][DATA_ACCESS_START]', 'Fetching live data...');
  
  // Check if we're in stress/demo mode - if so, skip real API calls
  const isStressMode = typeof window !== 'undefined' && (
    window.location.search.includes('piStress=1') || 
    window.location.search.includes('demoMode=1')
  );
  
  let inputData: CanonicalInsightInput;
  try {
    if (isStressMode) {
      piDebugLog('[RUNTIME_TRACE][DEMO_MODE]', 'Skipping real API calls in stress/demo mode');
      inputData = {
        sessionRows: [],
        githubSnapshot: undefined,
        githubByPeriod: [],
        productivityByPeriod: [],
        granularity: 'week'
      };
    } else {
      inputData = await fetchCanonicalInsightInput('week');
    }
    pipelineCounts.dataAccessComplete = true;
    pipelineCounts.sessionRowsCount = inputData.sessionRows?.length || 0;
    pipelineCounts.githubDataAvailable = !!inputData.githubSnapshot;
    
    piDebugLog('[RUNTIME_TRACE][DATA_ACCESS_COMPLETE]', {
      sessionRowsCount: pipelineCounts.sessionRowsCount,
      githubDataAvailable: pipelineCounts.githubDataAvailable,
      githubByPeriodCount: inputData.githubByPeriod?.length || 0
    });

    // Capture signal trace from raw data
    if (inputData.sessionRows?.length > 0) {
      const sampleSession = inputData.sessionRows[0];
      signalTrace.rawTelemetryFields = Object.keys(sampleSession);
      signalTrace.sessionRowCount = inputData.sessionRows.length;
      
      // Check for critical fields
      const criticalFields = [
        'session_active_coding_duration_minutes',
        'session_duration_minutes',
        'ai_burst_count',
        'time_to_first_commit_ms',
        'lines_added_total',
        'lines_removed_total_est',
        'tool',
        'session_quality_band',
        'focus_ratio',
        'debug_time_ms',
        'terminal_active_time_ms',
        'session_commits'
      ];
      
      signalTrace.criticalFieldAvailability = {};
      for (const field of criticalFields) {
        signalTrace.criticalFieldAvailability[field] = {
          available: field in sampleSession,
          sampleValue: sampleSession[field],
          nonZeroCount: inputData.sessionRows.filter(s => s[field] && s[field] !== 0).length,
          totalCount: inputData.sessionRows.length
        };
      }
      
      piDebugLog('[RUNTIME_TRACE][SIGNAL_TRACE]', signalTrace.criticalFieldAvailability);
    }
    
  } catch (error) {
    console.error('[RUNTIME_TRACE][DATA_ACCESS_ERROR]', error);
    pipelineCounts.dataAccessComplete = false;
    return { pipelineCounts, piStatuses, signalTrace, evidence };
  }

  // ============================================================
  // STAGE 3: GENERATOR EXECUTION
  // ============================================================
  piDebugLog('[RUNTIME_TRACE][GENERATOR_START]', 'Calling generateFinalCanonicalInsights...');
  
  // Temporarily patch console.log to capture generator execution
  const originalLog = console.log;
  const generatorLogs: string[] = [];
  
  console.log = (...args: any[]) => {
    generatorLogs.push(args.join(' '));
    originalLog.apply(console, args);
  };
  
  try {
    const insights = await generateFinalCanonicalInsights(inputData);
    console.log = originalLog; // Restore console.log
    
    pipelineCounts.generatorProduced = insights.length;
    piDebugLog('[RUNTIME_TRACE][GENERATOR_COMPLETE]', `Generated ${insights.length} insights`);
    
    // Parse generator logs to extract per-PI execution details
    for (const log of generatorLogs) {
      if (log.includes('[FINAL_PI_TRACE][GENERATOR_SUCCESS]')) {
        const piId = log.split(' ').pop();
        const piStatus = piStatuses.find(s => s.id === piId);
        if (piStatus) {
          piStatus.generatorCalled = true;
          piStatus.generatorReturned = true;
        }
      } else if (log.includes('[FINAL_PI_TRACE][GENERATOR_NULL]')) {
        const piId = log.split(' ').pop();
        const piStatus = piStatuses.find(s => s.id === piId);
        if (piStatus) {
          piStatus.generatorCalled = true;
          piStatus.generatorReturned = false;
          piStatus.failureReason = 'GENERATOR_RETURNED_NULL';
        }
      } else if (log.includes('[FINAL_PI_TRACE][GENERATOR_ERROR]')) {
        const parts = log.split(' ');
        const piId = parts[2];
        const piStatus = piStatuses.find(s => s.id === piId);
        if (piStatus) {
          piStatus.generatorCalled = true;
          piStatus.generatorReturned = false;
          piStatus.failureReason = 'GENERATOR_THREW_ERROR';
          piStatus.failurePoint = parts.slice(3).join(' ');
        }
      }
    }
    
    // ============================================================
    // STAGE 4: VALIDATION
    // ============================================================
    // All insights that reached this point passed validation
    pipelineCounts.validationPassed = insights.length;
    for (const insight of insights) {
      const piStatus = piStatuses.find(s => s.id === insight.id);
      if (piStatus) {
        piStatus.validationPassed = true;
      }
    }
    
    // ============================================================
    // STAGE 5: CANONICAL FILTERING
    // ============================================================
    // All insights from generateFinalCanonicalInsights are canonical by definition
    pipelineCounts.canonicalFiltered = insights.length;
    for (const insight of insights) {
      const piStatus = piStatuses.find(s => s.id === insight.id);
      if (piStatus) {
        piStatus.canonicalFiltered = true;
      }
    }
    
    // ============================================================
    // STAGE 6: REALISM PIPELINE
    // ============================================================
    // Insights that passed through realism pipeline
    pipelineCounts.realismProcessed = insights.length;
    for (const insight of insights) {
      const piStatus = piStatuses.find(s => s.id === insight.id);
      if (piStatus) {
        piStatus.realismProcessed = true;
      }
    }
    
    // ============================================================
    // STAGE 7: WIDGET INPUT
    // ============================================================
    pipelineCounts.widgetInput = insights.length;
    for (const insight of insights) {
      const piStatus = piStatuses.find(s => s.id === insight.id);
      if (piStatus) {
        piStatus.widgetInput = true;
      }
    }
    
    piDebugLog('[RUNTIME_TRACE][COMPLETE]', {
      pipelineCounts,
      renderedInsights: insights.map(i => i.id),
      nonRenderedInsights: piStatuses.filter(s => !s.widgetInput).map(s => s.id)
    });
    
    return { pipelineCounts, piStatuses, signalTrace, evidence };
    
  } catch (error) {
    console.log = originalLog; // Restore console.log
    console.error('[RUNTIME_TRACE][GENERATOR_ERROR]', error);
    return { pipelineCounts, piStatuses, signalTrace, evidence };
  }
}

/**
 * Classify PI runtime status
 */
export function classifyPIStatus(status: PIRuntimeStatus): string {
  if (status.widgetInput) return 'RENDERED';
  if (status.failureReason === 'GENERATOR_RETURNED_NULL') return 'NULL_RETURN';
  if (status.failureReason === 'GENERATOR_THREW_ERROR') return 'VALIDATION_FAIL';
  if (!status.generatorCalled) return 'DATA_MISSING';
  return 'UNKNOWN';
}

/**
 * Execute signal trace from raw telemetry
 */
export async function executeSignalTrace(): Promise<{
  rawTelemetry: any;
  sessionAggregation: any;
  canonicalSession: any;
  generatorAccess: any;
}> {
  piDebugLog('[SIGNAL_TRACE][START]', '=== SIGNAL TRACE PIPELINE ===');
  
  const signalTrace = {
    rawTelemetry: {},
    sessionAggregation: {},
    canonicalSession: {},
    generatorAccess: {}
  };
  
  try {
    // Fetch raw telemetry
    const rawResponse = await fetch(buildApiUrl('telemetry?days=all&per_page=10'));
    const rawData = await rawResponse.json();
    
    signalTrace.rawTelemetry = {
      available: rawResponse.ok,
      count: rawData.data?.length || 0,
      sampleFields: rawData.data?.[0] ? Object.keys(rawData.data[0]) : [],
      sampleEvent: rawData.data?.[0] || null
    };
    
    // Fetch session aggregation
    const sessionResponse = await fetch(buildApiUrl('telemetry/sessions?days=all&per_page=10'));
    const sessionData = await sessionResponse.json();
    
    signalTrace.sessionAggregation = {
      available: sessionResponse.ok,
      count: sessionData.sessions?.length || 0,
      sampleFields: sessionData.sessions?.[0] ? Object.keys(sessionData.sessions[0]) : [],
      sampleSession: sessionData.sessions?.[0] || null
    };
    
    // Fetch canonical endpoint
    const canonicalResponse = await fetch(buildApiUrl('telemetry/canonical?format=sessions&per_page=10'));
    const canonicalData = await canonicalResponse.json();
    
    signalTrace.canonicalSession = {
      available: canonicalResponse.ok,
      count: canonicalData.sessions?.length || 0,
      sampleFields: canonicalData.sessions?.[0] ? Object.keys(canonicalData.sessions[0]) : [],
      sampleCanonical: canonicalData.sessions?.[0] || null
    };
    
    piDebugLog('[SIGNAL_TRACE][COMPLETE]', signalTrace);
    return signalTrace;
    
  } catch (error) {
    console.error('[SIGNAL_TRACE][ERROR]', error);
    return signalTrace;
  }
}
