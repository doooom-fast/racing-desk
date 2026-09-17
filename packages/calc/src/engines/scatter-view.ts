/**
 * Pre-computed buckets for the Race Schedule scatter grid.
 *
 * Extracted from the web's `RaceScatterGrid.tsx`. The web component
 * originally bucketed sessions client-side — that worked fine for the
 * browser but meant native apps either had to re-implement the same
 * bucketing in Swift (drift risk) or receive raw sessions (bandwidth).
 * Pre-computing once on the server and shipping the buckets solves
 * both.
 *
 * Color + sizing rules live in the component layer; this module is
 * purely "turn raw sessions into (day, hour, count, incidents, …)
 * buckets". The web component should be updated to consume this shape
 * too, so both platforms render from identical data.
 */

export interface ScatterSessionInput {
  date: string         // ISO 8601
  iRatingDelta: number
  srDelta: number
  incidents: number
}

export interface ScatterBucket {
  day: number                // 0 = Sunday … 6 = Saturday (JS convention)
  hour: number               // 0 … 23 local-time hour
  count: number
  /** Sum of per-session deltas — consumers compute averages as needed. */
  irDeltaSum: number
  srDeltaSum: number
  incidentsSum: number
  /** Pre-computed convenience: avgIncidents = incidentsSum / count. */
  avgIncidents: number
}

/**
 * Bucket sessions by (dayOfWeek, hour) in the user's timezone. Mirrors
 * the web scatter's `useMemo(buckets)` block line-for-line, using
 * Intl.DateTimeFormat for TZ-safe day/hour extraction (raw
 * Date.getDay/getHours would put Pacific-coast late-night sessions
 * into UTC-early-morning buckets and skew the heatmap).
 */
export function buildScatterBuckets(
  sessions: ScatterSessionInput[],
  timeZone: string = 'UTC',
): ScatterBucket[] {
  const map = new Map<string, ScatterBucket>()

  // Use Intl to resolve day/hour in the user's TZ — the web uses the
  // same helpers via `getDayInTz` / `getHourInTz`.
  const dayFmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  })
  const hourFmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  })
  const dayToIndex: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }

  for (const s of sessions) {
    const d = new Date(s.date)
    if (isNaN(d.getTime())) continue

    const dayLabel = dayFmt.format(d)   // "Mon" / "Tue" / …
    const day = dayToIndex[dayLabel]
    if (day === undefined) continue

    const hourStr = hourFmt.format(d).replace(/\D/g, '')
    const hour = parseInt(hourStr, 10) % 24
    if (!Number.isFinite(hour)) continue

    const key = `${day}-${hour}`
    const existing = map.get(key)
    if (existing) {
      existing.count++
      existing.irDeltaSum += s.iRatingDelta
      existing.srDeltaSum += s.srDelta
      existing.incidentsSum += s.incidents
    } else {
      map.set(key, {
        day,
        hour,
        count: 1,
        irDeltaSum: s.iRatingDelta,
        srDeltaSum: s.srDelta,
        incidentsSum: s.incidents,
        avgIncidents: 0,   // finalized below
      })
    }
  }

  // Finalize derived fields
  const out = Array.from(map.values())
  for (const b of out) {
    b.avgIncidents = b.count > 0 ? b.incidentsSum / b.count : 0
  }
  return out
}
