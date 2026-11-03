/**
 * Title Authority Safeguard
 * 
 * Prevents content contract titles from overriding canonical PI titles.
 * Provides runtime protection against accidental title authority violations.
 */

import { resolvePITitle } from './titleResolver';

/**
 * Safeguard insight object to enforce canonical title authority
 * 
 * Removes any non-canonical title fields and ensures canonical title is used.
 * Logs warnings when title overrides are detected.
 * 
 * @param insight - Insight object that may have mixed title sources
 * @returns Safeguarded insight with canonical title only
 */
export function safeguardCanonicalTitle(insight: any): any {
  // Track if any title overrides were present
  const hadFinalTitle = !!insight.finalTitle;
  const hadOperationalTitle = !!insight.operationalTitle;
  const hadNonCanonicalTitle = insight.title && insight.title !== resolvePITitle(insight.id);

  // Log warnings for title authority violations
  if (hadFinalTitle) {
    console.warn(`[TITLE_SAFEGUARD] Removed finalTitle override for ${insight.id}`);
  }
  if (hadOperationalTitle) {
    console.warn(`[TITLE_SAFEGUARD] Removed operationalTitle override for ${insight.id}`);
  }
  if (hadNonCanonicalTitle) {
    console.warn(`[TITLE_SAFEGUARD] Fixed non-canonical title for ${insight.id}:`, {
      nonCanonical: insight.title,
      canonical: resolvePITitle(insight.id)
    });
  }

  // Return safeguarded insight with canonical title only
  return {
    ...insight,
    // ALWAYS enforce canonical title
    title: resolvePITitle(insight.id),
    // Remove all title override fields
    finalTitle: undefined,
    operationalTitle: undefined
  };
}

/**
 * Validate that an insight uses canonical title authority
 * 
 * @param insight - Insight to validate
 * @returns true if insight uses canonical title, false otherwise
 */
export function validateTitleAuthority(insight: any): boolean {
  const canonicalTitle = resolvePITitle(insight.id);
  const usesCanonicalTitle = insight.title === canonicalTitle;
  const hasNoTitleOverrides = !insight.finalTitle && !insight.operationalTitle;

  if (!usesCanonicalTitle || !hasNoTitleOverrides) {
    console.warn(`[TITLE_SAFEGUARD] Title authority violation detected for ${insight.id}:`, {
      usesCanonicalTitle,
      hasNoTitleOverrides,
      currentTitle: insight.title,
      canonicalTitle,
      hasFinalTitle: !!insight.finalTitle,
      hasOperationalTitle: !!insight.operationalTitle
    });
    return false;
  }

  return true;
}

/**
 * Batch safeguard array of insights
 * 
 * @param insights - Array of insights to safeguard
 * @returns Array of safeguarded insights with canonical titles only
 */
export function batchSafeguardTitles(insights: any[]): any[] {
  return insights.map(insight => safeguardCanonicalTitle(insight));
}
