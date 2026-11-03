/**
 * Derive the canonical workflow universe from PBT time-series metadata.
 *
 * Accepts one or more PBT time-series objects and returns the unique,
 * canonical tool IDs that have actual telemetry.
 *
 * Excludes empty IDs, 'unknown', and 'test-browser'. Returns an empty
 * array when no metadata is present or when no valid workflows exist.
 *
 * This is the only production source for the PBT runtime validation universe.
 */

import { normalizeToCanonicalToolId } from '../workflowIdentity'

export type PBTTimeSeriesWithMetadata = {
  metadata?: {
    tools_in_population?: string[]
    session_count_by_tool?: Record<string, number>
  } | null
} | null | undefined

export function deriveCanonicalWorkflowUniverse(
  series: PBTTimeSeriesWithMetadata[] | null | undefined
): string[] {
  const validToolId = (id: string) =>
    id && id.trim() !== '' && id !== 'unknown' && id !== 'test-browser'

  const canonicalWorkflows = new Set<string>()

  for (const s of series || []) {
    if (!s || !s.metadata) continue

    const population = s.metadata.tools_in_population
    if (Array.isArray(population)) {
      for (const tool of population) {
        if (validToolId(tool)) canonicalWorkflows.add(normalizeToCanonicalToolId(tool))
      }
    }

    const counts = s.metadata.session_count_by_tool
    if (counts && typeof counts === 'object') {
      for (const [tool, count] of Object.entries(counts)) {
        if (validToolId(tool) && Number(count) > 0) canonicalWorkflows.add(normalizeToCanonicalToolId(tool))
      }
    }
  }

  return Array.from(canonicalWorkflows)
}
