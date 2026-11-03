/**
 * Map a backend-curated developer list into the PBT dropdown shape.
 *
 * The backend (/api/developers) returns the authoritative curated list,
 * already excluding opaque/anonymous/legacy IDs. This function:
 *   - coerces id to string (backend may return integer IDs like 90001)
 *   - preserves the human-readable label
 *   - defaults workflows to [] when absent
 *
 * PBT-CLEANUP-2: Previously the component inlined this mapping and then
 * hard-truncated the result to 12 entries via `.slice(0, 12)`, silently
 * hiding real developers for any org with more than 12. The mapping is
 * extracted here so a behavioral regression can exercise it directly
 * without grepping source text.
 */
export interface CuratedDeveloper {
  id: string | number
  label: string
  workflows?: string[]
  raw_identities?: Array<string | number>
}

export interface MappedDeveloper {
  id: string
  label: string
  workflows: string[]
  raw_identities: string[]
}

export function mapCuratedDevelopers(
  developers: CuratedDeveloper[]
): MappedDeveloper[] {
  return developers.map(({ id, label, workflows, raw_identities }) => ({
    id: String(id),
    label,
    workflows: workflows || [],
    raw_identities: (raw_identities || [id]).map(String),
  }))
}
