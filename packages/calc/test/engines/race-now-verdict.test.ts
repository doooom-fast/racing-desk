import { describe, it, expect } from 'vitest'
import {
  evaluateRaceNow,
  buildPracticeAlternatives,
  type AlternativeSessionInput,
  type RaceNowEvaluation,
} from '../../src/engines/race-now-verdict'
// `computeRankedSlots` is the producer that `WhenProfile.rankedSlots` is
// built from in production. The verdict now reads directly from that field,
// so the test fixture has to call the real ranker instead of stubbing every
// hour to 'insufficient' — otherwise every test would just exercise the
// "not enough data" branch.
import { computeRankedSlots } from '../../src/engines/when-engine'
import type { WhenProfile, TemporalSlice } from '../../src/engines/when-engine'

/**
 * Build a WhenProfile whose byHour array has custom incidents/position at
 * specified hours and a flat baseline elsewhere. Keeps tests readable.
 */
function buildProfile(opts: {
  hourOverrides?: Record<number, { sessionCount: number; avgIncidents: number; avgPosition: number | null }>
  dayOverrides?: Record<number, { sessionCount: number; avgIncidents: number; avgPosition: number | null }>
  baselineIncidents?: number
  baselinePosition?: number
  baselineSessions?: number
}): WhenProfile {
  const base = opts.baselineIncidents ?? 3
  const basePos = opts.baselinePosition ?? 10
  const baseCount = opts.baselineSessions ?? 5

  const emptySlice = (label: string): TemporalSlice => ({
    label,
    sessionCount: baseCount,
    avgPosition: basePos,
    avgIRatingDelta: 0,
    avgIncidents: base,
    winRate: 0,
    podiumRate: 0,
    topTenRate: 0,
  })

  const byHour: TemporalSlice[] = Array.from({ length: 24 }, (_, i) => emptySlice(`${i}`))
  const byDayOfWeek: TemporalSlice[] = Array.from({ length: 7 }, (_, i) => emptySlice(String(i)))

  for (const [hourStr, override] of Object.entries(opts.hourOverrides ?? {})) {
    const h = Number(hourStr)
    byHour[h] = {
      label: `${h}`,
      sessionCount: override.sessionCount,
      avgPosition: override.avgPosition,
      avgIRatingDelta: 0,
      avgIncidents: override.avgIncidents,
      winRate: 0,
      podiumRate: 0,
      topTenRate: 0,
    }
  }
  for (const [dayStr, override] of Object.entries(opts.dayOverrides ?? {})) {
    const d = Number(dayStr)
    byDayOfWeek[d] = {
      label: `${d}`,
      sessionCount: override.sessionCount,
      avgPosition: override.avgPosition,
      avgIRatingDelta: 0,
      avgIncidents: override.avgIncidents,
      winRate: 0,
      podiumRate: 0,
      topTenRate: 0,
    }
  }

  return {
    byHour,
    byDayOfWeek,
    bySessionLength: [],
    peakHours: '',
    peakDays: '',
    worstHours: '',
    worstDays: '',
    peakHourStart: 0,
    worstHourStart: 0,
    windowSize: 3,
    insights: [],
    heatmapData: [],
    rankedSlots: computeRankedSlots(byHour),
  }
}

describe('evaluateRaceNow', () => {
  it('returns null when profile is null', () => {
    expect(evaluateRaceNow(null, new Date(), 'UTC')).toBeNull()
  })

  it('returns insufficient verdict when thin sample at current hour and day', () => {
    // Everything is 0 sessions except a single spot far away.
    const profile = buildProfile({
      baselineSessions: 0,
      hourOverrides: { 10: { sessionCount: 5, avgIncidents: 3, avgPosition: 10 } },
      dayOverrides: { 0: { sessionCount: 1, avgIncidents: 2, avgPosition: 5 } },
    })
    // Saturday 20:00 UTC → hour=20, jsDay=6 (profile day 5). Day has 0 races.
    const res = evaluateRaceNow(profile, new Date('2026-04-18T20:00:00Z'), 'UTC')!
    expect(res.verdict).toBe('insufficient')
    expect(res.stats.hourSampleCount).toBe(0)
  })

  it('returns a top-tier verdict when current hour is among the cleanest in the user\'s distribution', () => {
    // Baseline: every hour has 3 inc/race and 10 sessions, so all 24 hours
    // qualify for ranking. Hours 19/20/21 are overridden to 1.5 inc — the
    // three cleanest. They tie, so the ranker breaks ties by hour ascending:
    // rank 0 = hour 19 ('best'), rank 1 = hour 20 ('good'), rank 2 = hour 21
    // ('good'). At 20:00 UTC we expect 'good'.
    const profile = buildProfile({
      baselineIncidents: 3,
      baselinePosition: 10,
      baselineSessions: 10,
      hourOverrides: {
        19: { sessionCount: 10, avgIncidents: 1.5, avgPosition: 5 },
        20: { sessionCount: 10, avgIncidents: 1.5, avgPosition: 5 },
        21: { sessionCount: 10, avgIncidents: 1.5, avgPosition: 5 },
      },
    })
    const res = evaluateRaceNow(profile, new Date('2026-04-18T20:00:00Z'), 'UTC')!
    expect(res.verdict).toBe('good')
    // Human chip copy; deliberately not statistical ("quartile") or pejorative
    // ("marginal"). See TIER_HEADLINE in race-now-verdict.ts.
    expect(res.headline).toMatch(/good to go/i)
  })

  it('returns "best" when current hour is the single cleanest', () => {
    // Hour 20 is strictly the cleanest (1.0 vs 1.5 for everyone else's
    // overrides and 3 for the rest). Tie-broken-by-hour rules don't matter
    // here — the lone minimum wins outright.
    const profile = buildProfile({
      baselineIncidents: 3,
      baselineSessions: 10,
      hourOverrides: {
        20: { sessionCount: 10, avgIncidents: 1.0, avgPosition: 5 },
      },
    })
    const res = evaluateRaceNow(profile, new Date('2026-04-18T20:00:00Z'), 'UTC')!
    expect(res.verdict).toBe('best')
    expect(res.headline).toMatch(/prime time/i)
  })

  it('returns "risky" when current window is in the bottom quartile of the user\'s distribution', () => {
    // Inverse of the top-tier test: hour 19/20/21 are the messiest in the
    // distribution (5 inc vs baseline 2), so they fall into the bottom
    // quartile and earn the 'risky' tier.
    const profile = buildProfile({
      baselineIncidents: 2,
      baselinePosition: 8,
      baselineSessions: 10,
      hourOverrides: {
        19: { sessionCount: 10, avgIncidents: 5, avgPosition: 14 },
        20: { sessionCount: 10, avgIncidents: 5, avgPosition: 14 },
        21: { sessionCount: 10, avgIncidents: 5, avgPosition: 14 },
      },
    })
    const res = evaluateRaceNow(profile, new Date('2026-04-18T20:00:00Z'), 'UTC')!
    expect(res.verdict).toBe('risky')
  })

  it('falls back to a broader window when the exact hour is too thin to rank', () => {
    // Hour 20 itself has 0 sessions, but hours 19 and 21 have plenty. The
    // exact-hour ranker would say 'insufficient'; the ±1h window should
    // produce a real verdict instead.
    const profile = buildProfile({
      baselineIncidents: 3,
      baselineSessions: 10,
      hourOverrides: {
        20: { sessionCount: 0, avgIncidents: 0, avgPosition: null },
        19: { sessionCount: 10, avgIncidents: 1.0, avgPosition: 5 },
        21: { sessionCount: 10, avgIncidents: 1.0, avgPosition: 5 },
      },
    })
    const res = evaluateRaceNow(profile, new Date('2026-04-18T20:00:00Z'), 'UTC')!
    expect(res.verdict).not.toBe('insufficient')
    // The detail names the broader scope so users understand it isn't pinned
    // to the exact hour they're staring at.
    expect(res.detail.toLowerCase()).toMatch(/broader read|window/)
  })

  it('reports the raw stats so the UI can render a details panel', () => {
    const profile = buildProfile({
      baselineIncidents: 3,
      baselinePosition: 10,
      baselineSessions: 10,
      hourOverrides: {
        20: { sessionCount: 8, avgIncidents: 1.2, avgPosition: 4 },
      },
    })
    const res = evaluateRaceNow(profile, new Date('2026-04-18T20:00:00Z'), 'UTC')!
    expect(res.stats.currentHour).toBe(20)
    // Saturday Apr 18 2026 → jsDay=6
    expect(res.stats.currentDay).toBe(6)
    expect(res.stats.currentDayLabel).toBe('Saturday')
    expect(res.stats.hourAvgIncidents).not.toBeNull()
    expect(res.stats.hourSampleCount).toBeGreaterThan(0)
  })
})

// ── buildPracticeAlternatives ───────────────────────────────────────────────

function makeEvaluation(verdict: RaceNowEvaluation['verdict']): RaceNowEvaluation {
  return {
    verdict,
    headline: verdict,
    detail: '',
    stats: {
      currentHour: 20,
      currentDay: 6,
      currentDayLabel: 'Saturday',
      currentHourLabel: '8 PM',
      hourSampleCount: 0,
      hourAvgIncidents: null,
      hourAvgPosition: null,
      daySampleCount: 0,
      dayAvgIncidents: 0,
      dayAvgPosition: null,
      overallAvgIncidents: 0,
      overallAvgPosition: null,
    },
  }
}

function makeAltSession(overrides: Partial<AlternativeSessionInput> = {}): AlternativeSessionInput {
  return {
    trackName: 'Watkins Glen',
    carModel: 'Porsche 911 GT3 Cup',
    category: 'road',
    incidentCount: 2,
    completedLaps: 10,
    ...overrides,
  }
}

describe('buildPracticeAlternatives', () => {
  it('returns no alternatives for top-tier verdicts (best, good)', () => {
    // The old behavior was "skip when verdict is 'good'" — under the new
    // tier set both 'best' and 'good' are top-quartile, so neither should
    // trigger a redirect.
    const sessions = Array.from({ length: 5 }, () => makeAltSession({ trackName: 'Spa', incidentCount: 8 }))
    expect(buildPracticeAlternatives(sessions, makeEvaluation('best'))).toEqual([])
    expect(buildPracticeAlternatives(sessions, makeEvaluation('good'))).toEqual([])
  })

  it('returns no alternatives when evaluation is null', () => {
    const sessions = Array.from({ length: 5 }, () => makeAltSession())
    const alts = buildPracticeAlternatives(sessions, null)
    expect(alts).toEqual([])
  })

  it('picks the worst track as a practice suggestion', () => {
    // Spa: 3 races × 10 laps × 8 inc = 0.8/lap (messy)
    // Watkins: 3 races × 10 laps × 1 inc = 0.1/lap (clean)
    const sessions = [
      ...Array.from({ length: 3 }, () =>
        makeAltSession({ trackName: 'Spa', carModel: 'Porsche', incidentCount: 8, completedLaps: 10 }),
      ),
      ...Array.from({ length: 3 }, () =>
        makeAltSession({ trackName: 'Watkins Glen', carModel: 'Porsche', incidentCount: 1, completedLaps: 10 }),
      ),
    ]
    const alts = buildPracticeAlternatives(sessions, makeEvaluation('messy-side'))
    expect(alts.length).toBeGreaterThan(0)
    const trackAlt = alts.find(a => a.kind === 'practice' && a.trackName)
    expect(trackAlt?.trackName).toBe('Spa')
  })

  it('picks the worst car when it differs from the worst-track name', () => {
    // Worst track = Spa, but worst car = BMW (tried elsewhere too) — should surface both
    const sessions = [
      ...Array.from({ length: 3 }, () =>
        makeAltSession({ trackName: 'Spa', carModel: 'Porsche', incidentCount: 8, completedLaps: 10 }),
      ),
      ...Array.from({ length: 3 }, () =>
        makeAltSession({ trackName: 'Monza', carModel: 'BMW', incidentCount: 9, completedLaps: 10 }),
      ),
      ...Array.from({ length: 3 }, () =>
        makeAltSession({ trackName: 'Watkins', carModel: 'Porsche', incidentCount: 1, completedLaps: 10 }),
      ),
    ]
    const alts = buildPracticeAlternatives(sessions, makeEvaluation('risky'))
    const carAlt = alts.find(a => a.kind === 'time-trial')
    expect(carAlt?.carModel).toBe('BMW')
  })

  it('falls back to a generic practice suggestion when data is too thin', () => {
    // Only 2 sessions at each track/car — below MIN_SESSIONS_FOR_ALT (3)
    const sessions = [
      makeAltSession({ trackName: 'Spa', carModel: 'Porsche', incidentCount: 5, completedLaps: 10 }),
      makeAltSession({ trackName: 'Watkins', carModel: 'BMW', incidentCount: 5, completedLaps: 10 }),
    ]
    const alts = buildPracticeAlternatives(sessions, makeEvaluation('messy-side'))
    expect(alts.length).toBe(1)
    expect(alts[0].kind).toBe('practice')
    // Fallback has no track/car attached
    expect(alts[0].trackName).toBeUndefined()
    expect(alts[0].carModel).toBeUndefined()
  })

  it('skips buckets with zero completed laps', () => {
    // 5 races at Spa, but every one is 0 laps — should not nominate Spa
    // regardless of incident count.
    const sessions = [
      ...Array.from({ length: 5 }, () =>
        makeAltSession({ trackName: 'Spa', carModel: 'Porsche', incidentCount: 50, completedLaps: 0 }),
      ),
      ...Array.from({ length: 3 }, () =>
        makeAltSession({ trackName: 'Monza', carModel: 'BMW', incidentCount: 3, completedLaps: 10 }),
      ),
    ]
    const alts = buildPracticeAlternatives(sessions, makeEvaluation('messy-side'))
    const trackAlt = alts.find(a => a.kind === 'practice' && a.trackName)
    expect(trackAlt?.trackName).toBe('Monza')
  })
})
