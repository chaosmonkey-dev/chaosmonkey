/**
 * Period Key Normalization
 * 
 * Converts various period formats (ISO date, ISO week, etc.) to canonical YYYY-Www format.
 * This is the single source of truth for period alignment across all rules.
 * 
 * Usage:
 *   - GitHub engOutput: period already in YYYY-Www, but call this for consistency
 *   - Productivity data: period in YYYY-MM-DD, will convert to YYYY-Www
 *   - NO_DATA proof: use normalized keys for overlap calculation
 */

/**
 * Convert a period string (any format) to canonical ISO week format (YYYY-Www).
 * 
 * Formats recognized:
 * - Already ISO week: "2025-W48" → "2025-W48" (pass-through)
 * - ISO date: "2025-11-24" → "2025-W48" (convert to week start)
 * - Null/undefined: return as-is (caller must handle)
 * 
 * @param period - The period string to normalize
 * @returns Normalized period in YYYY-Www format, or original if unrecognized
 */
export function normalizePeriodKey(period: string | null | undefined): string | null | undefined {
  if (!period) {
    return period;
  }

  const periodStr = String(period).trim();

  // Already ISO week format: YYYY-Www
  if (/^\d{4}-W\d{2}$/.test(periodStr)) {
    return periodStr;
  }

  // ISO date format: YYYY-MM-DD
  // Convert to ISO week (Monday of that week)
  if (/^\d{4}-\d{2}-\d{2}$/.test(periodStr)) {
    try {
      const date = new Date(periodStr + 'T00:00:00Z');
      if (isNaN(date.getTime())) {
        // Invalid date, return original
        return periodStr;
      }
      return dateToISOWeek(date);
    } catch {
      // Parsing failed, return original
      return periodStr;
    }
  }

  // Unrecognized format: return original and let caller decide
  return periodStr;
}

// Single canonical key helper (preferred name for cross-module contract)
// Canonical format: YYYY-Www
export function toCanonicalPeriodKey(period: string | null | undefined): string | null | undefined {
  return normalizePeriodKey(period);
}

/**
 * Convert a Date object to ISO week string (YYYY-Www).
 * 
 * @param date - The date to convert (assumes UTC)
 * @returns ISO week string in YYYY-Www format
 */
function dateToISOWeek(date: Date): string {
  // Ensure we're working with UTC
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

  // Get ISO week number
  // ISO 8601: Week 1 is the week with the year's first Thursday
  // Monday is day 1, Sunday is day 7
  
  // Calculate Thursday of this week (day 4)
  const dayOfWeek = d.getUTCDay() || 7; // Sunday = 7, Monday = 1, etc.
  const thursdayOfWeek = new Date(d);
  thursdayOfWeek.setUTCDate(d.getUTCDate() - dayOfWeek + 4);

  // Get year and week of that Thursday
  const yearOfThursday = thursdayOfWeek.getUTCFullYear();
  
  // Week 1 is the week with Jan 4th
  const jan4 = new Date(Date.UTC(yearOfThursday, 0, 4));
  const dayOfJan4 = jan4.getUTCDay() || 7;
  const weekStart = new Date(jan4);
  weekStart.setUTCDate(jan4.getUTCDate() - dayOfJan4 + 1); // Monday of week 1

  // Calculate week number
  const diffTime = thursdayOfWeek.getTime() - weekStart.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const weekNumber = Math.floor(diffDays / 7) + 1;

  // Format as YYYY-Www (week number zero-padded)
  return `${yearOfThursday}-W${String(weekNumber).padStart(2, '0')}`;
}

/**
 * Extract the Monday date of an ISO week string.
 * Useful for converting back to date format if needed.
 * 
 * @param isoWeek - ISO week string (YYYY-Www)
 * @returns Date object (Monday of that week, UTC)
 */
export function isoWeekToDate(isoWeek: string): Date {
  const match = isoWeek.match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid ISO week format: ${isoWeek}`);
  }

  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);

  // Week 1 is the week with Jan 4th
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfJan4 = jan4.getUTCDay() || 7;
  const weekStart = new Date(jan4);
  weekStart.setUTCDate(jan4.getUTCDate() - dayOfJan4 + 1); // Monday of week 1

  // Calculate Monday of target week
  const monday = new Date(weekStart);
  monday.setUTCDate(weekStart.getUTCDate() + (week - 1) * 7);

  return monday;
}

/**
 * Test helper: normalize an array of periods.
 * @param periods - Array of period strings
 * @returns Array of normalized periods
 */
export function normalizePeriodKeys(periods: (string | null | undefined)[]): (string | null | undefined)[] {
  return periods.map(p => normalizePeriodKey(p));
}
