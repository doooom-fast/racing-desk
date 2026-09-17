/**
 * when-engine scoring regressions.
 *
 * Captures two bugs that produced the "peak window with 5.7 incidents,
 * worst window with 3.0 incidents" nonsense on the dashboard:
 *
 *   1. hourScore ignored incidents entirely — so a dirty window could rank
 *      above a clean one just because podium/iR was slightly better.
 *   2. There was no minimum-sample gate — a 4-race sliver could outrank
 *      (or underrank) a 44-race window because single-session noise
 *      dominated the average.
 *
 * Both are now fixed. These tests lock in the new behavior.
 */

import { describe, it, expect } from 'vitest'
import { computeWhenProfile } from '../../src/engines/when-engine'

// Minimal session shape — matches the `RaceSession` interface in when-engine.
type TestSession = {
  id: string
  userId: string
  carModel: string
  category: string
  gameName: string
  trackName: string | null
  sessionType: string | null
  finishPosition: number | null
  incidentCount: number | null
  metadata: Record<string, unknown> | null
  createdAt: Date
}

// Build a session at a specific UTC clock hour on a specific weekday.
// 2026-03-15 is a Sunday (day 0). Offset to target day.
function makeSession(opts: {
  dayOffsetFromSunday: number
  hour: number
  incidents: number
  finishPosition?: number
  completedLaps?: number
}): TestSession {
  const base = new Date('2026-03-15T00:00:00Z') // Sunday
  base.setUTCDate(base.getUTCDate() + opts.dayOffsetFromSunday)
  base.setUTCHours(opts.hour)
  return {
    id: crypto.randomUUID(),
    userId: 'u1',
    carModel: 'BMW M4 GT3',
    category: 'road',
    gameName: 'iracing',
    trackName: 'Spa',
    sessionType: 'race',
    finishPosition: opts.finishPosition ?? 10,
    incidentCount: opts.incidents,
    metadata: { completedLaps: opts.completedLaps ?? 20 },
    createdAt: base,
  }
}

describe('computeWhenProfile — peak window selection', () => {
  it('does not pick a window with only 4 races as "worst" when the sample is below threshold', () => {
    // 44 clean(-ish) Sunday evening races clustered 20:00–22:00 UTC
    const peakSessions = Array.from({ length: 44 }, (_, i) =>
      makeSession({
        dayOffsetFromSunday: 0,
        hour: 20 + (i % 3), // 20, 21, 22
        incidents: 2,
        finishPosition: 10,
      }),
    )
    // Only 4 Monday 04:00–06:00 UTC races with higher incidents
    const scatteredSessions = Array.from({ length: 4 }, (_, i) =>
      makeSession({
        dayOffsetFromSunday: 1,
        hour: 4 + (i % 3),
        incidents: 8,
        finishPosition: 20,
      }),
    )

    const profile = computeWhenProfile(
      [...peakSessions, ...scatteredSessions] as never[],
      [],
      'UTC',
    )

    // The tiny 4-race bucket must NOT be the selected worst window — min N
    // is 5. So worstHourStart should be inside the 44-race cluster, not the
    // sparse 4am block.
    expect(profile.worstHourStart).not.toBe(4)
  })

  it('penalizes high-incident windows even when iRating delta is neutral', () => {
    // Window A: 10 races at 18:00–20:00, clean (0 incidents)
    const cleanWindow = Array.from({ length: 10 }, (_, i) =>
      makeSession({
        dayOffsetFromSunday: 0,
        hour: 18 + (i % 3),
        incidents: 0,
        finishPosition: 10,
      }),
    )
    // Window B: 10 races at 10:00–12:00, dirty (8 incidents)
    const dirtyWindow = Array.from({ length: 10 }, (_, i) =>
      makeSession({
        dayOffsetFromSunday: 0,
        hour: 10 + (i % 3),
        incidents: 8,
        finishPosition: 10,
      }),
    )

    const profile = computeWhenProfile(
      [...cleanWindow, ...dirtyWindow] as never[],
      [],
      'UTC',
    )

    // Clean window must outrank dirty one — they're matched on iR (no rating
    // history) and podium rate (none podium), so the incident penalty is the
    // only thing that separates them. Without incidents in the score, this
    // would swing on tie-breaking.
    //
    // Acceptable peak windows overlap the clean cluster (hours 18-20);
    // acceptable worst windows overlap the dirty cluster (hours 10-12).
    // Sliding 3h windows with any overlap are fine — the important thing
    // is that peak is on the clean side and worst is on the dirty side.
    expect(profile.peakHourStart).toBeGreaterThanOrEqual(16)
    expect(profile.peakHourStart).toBeLessThanOrEqual(20)
    expect(profile.worstHourStart).toBeGreaterThanOrEqual(8)
    expect(profile.worstHourStart).toBeLessThanOrEqual(12)
  })

  it('excludes low-N days from peak/worst day selection', () => {
    // Monday has 1 terrible race. Sundays have 10 mediocre races.
    const sundaySessions = Array.from({ length: 10 }, () =>
      makeSession({ dayOffsetFromSunday: 0, hour: 14, incidents: 3, finishPosition: 15 }),
    )
    const lonelyMonday = [
      makeSession({ dayOffsetFromSunday: 1, hour: 14, incidents: 20, finishPosition: 30 }),
    ]

    const profile = computeWhenProfile(
      [...sundaySessions, ...lonelyMonday] as never[],
      [],
      'UTC',
    )

    // Monday shouldn't be selected as worst — it's below the 5-race threshold.
    // (Monday label = 'Monday' at byDayOfWeek index 0 under Mon=0 convention.)
    expect(profile.worstDays).not.toBe('Monday')
  })
})
