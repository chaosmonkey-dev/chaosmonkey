// CR-X P0 microfix: Browser-local calendar date as 'YYYY-MM-DD'.
//
// `new Date().toISOString().split('T')[0]` converts to UTC, which shifts the
// calendar day forward by 1 in negative-offset timezones (e.g. at 8pm EDT on
// Sep 6, toISOString() returns '2026-09-07T00:..Z' -> '2026-09-07').  Until
// an org reporting timezone exists, PBT customer-facing ranges use the
// browser-local calendar date.  This helper reads local getters and formats
// manually so the canonical date-only string matches the customer's wall
// clock.
export function localDateISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
