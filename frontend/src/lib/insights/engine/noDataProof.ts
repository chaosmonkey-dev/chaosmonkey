/**
 * NO_DATA Proof System
 * 
 * Diagnoses why rules are blocked by NO_DATA:
 * - MISSING_DATASET: Dataset doesn't exist or is empty
 * - MISSING_FIELD: Dataset exists but required fields are missing
 * - PERIOD_KEY_MISMATCH: Datasets exist but periods don't overlap
 * - SPARSE_OVERLAP: Datasets exist but overlap is too sparse (1-2 periods)
 */

import type { EngOutputPoint, ToolProductivityPoint } from '../types';
import { normalizePeriodKey } from './period';

export type NoDataVerdict = 
  | 'MISSING_DATASET'
  | 'MISSING_FIELD'
  | 'PERIOD_KEY_MISMATCH'
  | 'SPARSE_OVERLAP';

export interface NoDataProof {
  ruleId: string;
  verdict: NoDataVerdict;
  datasetChecked?: 'productivity' | 'engOutput' | 'sessions';
  prodLen: number;
  engLen: number;
  overlapN: number;
  missingFields: string[];
  sampleProdKeys?: string[];  // Only if PERIOD_KEY_MISMATCH or SPARSE_OVERLAP
  sampleEngKeys?: string[];   // Only if PERIOD_KEY_MISMATCH or SPARSE_OVERLAP
}

// Global collection for proofs (cleared each run)
let globalNoDataProofs: NoDataProof[] = [];

export function getNoDataProofs(): NoDataProof[] {
  return globalNoDataProofs;
}

export function addNoDataProof(proof: NoDataProof): void {
  globalNoDataProofs.push(proof);
}

export function clearNoDataProofs(): void {
  globalNoDataProofs = [];
}

interface RequiredDatasets {
  productivity?: boolean;
  engOutput?: boolean;
  sessions?: boolean;
}

interface RequiredFields {
  productivity?: string[];
  engOutput?: string[];
  sessions?: string[];
}

// Input type definition (mirrors performanceEngine.ts PerformanceInputs)
interface PerformanceInputsForProof {
  engOutput?: EngOutputPoint[];
  productivity?: ToolProductivityPoint[];
  sessions?: any[];
  granularity?: string;
  overlap?: number;
  prodGlobalSource?: string;
  ghSeries?: EngOutputPoint[];
  prodSeries?: ToolProductivityPoint[];
  githubSnapshot?: any;
}

export function proveNoData(
  ruleId: string,
  input: PerformanceInputsForProof,
  required: {
    datasets: RequiredDatasets;
    fields: RequiredFields;
    periodKeyExtractor?: {
      productivity?: (p: ToolProductivityPoint) => string | null;
      engOutput?: (p: EngOutputPoint) => string | null;
    };
  }
): NoDataProof {
  const result: NoDataProof = {
    ruleId,
    verdict: 'MISSING_DATASET',
    prodLen: 0,
    engLen: 0,
    overlapN: 0,
    missingFields: []
  };

  // Check dataset availability
  const prodLen = input.productivity?.length || 0;
  const engLen = input.engOutput?.length || 0;
  const sessionsLen = input.sessions?.length || 0;

  result.prodLen = prodLen;
  result.engLen = engLen;

  // Check if required datasets exist
  if (required.datasets.productivity && prodLen === 0) {
    result.verdict = 'MISSING_DATASET';
    result.datasetChecked = 'productivity';
    return result;
  }
  if (required.datasets.engOutput && engLen === 0) {
    result.verdict = 'MISSING_DATASET';
    result.datasetChecked = 'engOutput';
    return result;
  }
  if (required.datasets.sessions && sessionsLen === 0) {
    result.verdict = 'MISSING_DATASET';
    result.datasetChecked = 'sessions';
    return result;
  }

  // Check for missing fields
  const missingFields: string[] = [];

  if (required.datasets.productivity && prodLen > 0 && required.fields.productivity) {
    const sample = input.productivity?.[0];
    if (sample) {
      for (const field of required.fields.productivity) {
        if (sample[field as keyof typeof sample] === undefined || sample[field as keyof typeof sample] === null) {
          missingFields.push(`productivity.${field}`);
        }
      }
    }
  }

  if (required.datasets.engOutput && engLen > 0 && required.fields.engOutput) {
    const sample = input.engOutput?.[0];
    if (sample) {
      for (const field of required.fields.engOutput) {
        if (sample[field as keyof typeof sample] === undefined || sample[field as keyof typeof sample] === null) {
          missingFields.push(`engOutput.${field}`);
        }
      }
    }
  }

  if (required.datasets.sessions && sessionsLen > 0 && required.fields.sessions) {
    const sample = input.sessions?.[0];
    if (sample) {
      for (const field of required.fields.sessions) {
        if (sample[field as keyof typeof sample] === undefined || sample[field as keyof typeof sample] === null) {
          missingFields.push(`sessions.${field}`);
        }
      }
    }
  }

  if (missingFields.length > 0) {
    result.verdict = 'MISSING_FIELD';
    result.missingFields = missingFields;
    return result;
  }

  // Check period overlap (only if both productivity and engOutput are required)
  if (required.datasets.productivity && required.datasets.engOutput && prodLen > 0 && engLen > 0) {
    // Use provided extractors or default to 'period' property
    const prodExtractor = required.periodKeyExtractor?.productivity || ((p: any) => p.period || null);
    const engExtractor = required.periodKeyExtractor?.engOutput || ((p: any) => p.period || null);

    const prodKeys = new Set<string>();
    const engKeys = new Set<string>();

    input.productivity?.forEach(p => {
      const key = prodExtractor(p);
      // Normalize period key to canonical format (YYYY-Www)
      const normalizedKey = key ? normalizePeriodKey(String(key)) : null;
      if (normalizedKey) prodKeys.add(String(normalizedKey));
    });

    input.engOutput?.forEach(e => {
      const key = engExtractor(e);
      // Normalize period key to canonical format (YYYY-Www)
      const normalizedKey = key ? normalizePeriodKey(String(key)) : null;
      if (normalizedKey) engKeys.add(String(normalizedKey));
    });

    // Calculate overlap
    let overlapCount = 0;
    for (const key of prodKeys) {
      if (engKeys.has(key)) {
        overlapCount++;
      }
    }

    result.overlapN = overlapCount;

    // Sample keys for diagnosis
    result.sampleProdKeys = Array.from(prodKeys).slice(0, 5);
    result.sampleEngKeys = Array.from(engKeys).slice(0, 5);

    if (overlapCount === 0) {
      result.verdict = 'PERIOD_KEY_MISMATCH';
      return result;
    }

    if (overlapCount <= 2) {
      result.verdict = 'SPARSE_OVERLAP';
      return result;
    }
  }

  // If we get here, datasets and fields exist, and overlap is sufficient
  // The rule may still be blocked by a guard not expressible by these diagnostics.
  // IMPORTANT: do NOT label this as MISSING_DATASET when datasets are present.
  result.verdict = 'MISSING_FIELD';
  result.missingFields = ['(blocked by rule guard; datasets present)'];
  return result;
}
