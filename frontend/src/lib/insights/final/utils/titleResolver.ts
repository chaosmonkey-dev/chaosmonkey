/**
 * Canonical PI Title Resolver
 * 
 * Enforces strict canonical ownership of Performance Insight titles.
 * The canonical registry is the SINGLE source of truth for PI identity.
 * 
 * This resolver ensures:
 * - Display titles ALWAYS come from canonicalInsights.ts
 * - Content contract titles are NEVER used for identity
 * - No narrative variation in PI headers
 * - Content contracts enrich but don't define identity
 */

import type { CanonicalPIEntry } from '../types';
import { getCanonicalPIById } from '../canonicalInsights';

/**
 * Resolve PI title with strict canonical authority
 * 
 * @param piId - The canonical PI identifier
 * @returns Canonical title from registry (never from content contracts)
 */
export function resolvePITitle(piId: string): string {
  const registryEntry = getCanonicalPIById(piId);
  
  if (!registryEntry) {
    console.warn(`[TITLE_RESOLVER] No canonical entry found for PI ID: ${piId}`);
    return `Unknown PI: ${piId}`;
  }
  
  // ALWAYS return canonical registry title
  // Ignore any content contract titles, operational titles, or derived narratives
  return registryEntry.title;
}

/**
 * Get canonical PI entry with title authority enforcement
 * 
 * @param piId - The canonical PI identifier
 * @returns Complete canonical PI entry
 */
export function getCanonicalPIWithAuthority(piId: string): CanonicalPIEntry | undefined {
  const entry = getCanonicalPIById(piId);
  
  if (!entry) {
    return undefined;
  }
  
  // Ensure title authority is canonical
  // This is defensive - the registry should already be canonical
  return {
    ...entry,
    title: entry.title // Explicitly use registry title
  };
}

/**
 * Validate that a title is present and non-generic.
 *
 * CR4 P0-6: The canonical registry title is a FALLBACK, not a mandate.
 * Generators produce data-driven titles that are the authority for the
 * specific data context (e.g. "Cursor averages 83 min/session vs VS Code 31 min/session").
 * These will never exactly match the registry's static title — and they shouldn't.
 *
 * This validator now only flags:
 * - Empty/undefined titles
 * - Titles that are generic placeholders ("Unknown PI", "Metric")
 *
 * @param piId - The canonical PI identifier
 * @param candidateTitle - Title to validate
 * @returns true if title is acceptable, false if empty/generic
 */
export function validateCanonicalTitle(piId: string, candidateTitle: string): boolean {
  if (!candidateTitle || candidateTitle.trim().length === 0) {
    console.warn(`[TITLE_RESOLVER] Empty title for ${piId}`);
    return false;
  }
  if (candidateTitle.startsWith('Unknown PI:') || candidateTitle === 'Metric') {
    console.warn(`[TITLE_RESOLVER] Generic/placeholder title for ${piId}:`, candidateTitle);
    return false;
  }
  return true;
}

/**
 * Extract canonical title from insight object (defensive)
 * 
 * Safeguards against accidental content contract title overrides
 * in insight objects that may have mixed title sources.
 * 
 * @param insight - Insight object that may have mixed title sources
 * @returns Canonical title only
 */
export function extractCanonicalTitle(insight: { id: string; title?: string; finalTitle?: string }): string {
  // ALWAYS prefer canonical registry, ignore any insight-level title overrides
  return resolvePITitle(insight.id);
}
