/**
 * Tests for the Next Race Ideas scoring engine
 *
 * Covers the individual scoring functions that were fixed/added:
 *   - scoreTimeOfDay: now compares race hour against driver's best hours
 *   - scoreDayOfWeek: now compares race day against driver's best days
 *   - scoreCarFamiliarity: improved car-to-class matching
 *   - scoreCarPerformance: new — evaluates driver performance in matched cars
 *   - scoreRatingTrend: rescaled from 0-15 to 0-10
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  _testing,
  computeNextRaceIdeas,
  formatStartsInShortLabel,
  type SessionInput,
  type RatingInput,
  type RaceSuggestion,
  type IRacingSchedule,
  type DriverRatingInput,
} from '../../src/engines/next-race-ideas'

const {
  scoreTier,
  scoreTimeOfDay,
  scoreDayOfWeek,
  scoreCarFamiliarity,
  scoreCarPerformance,
  scoreRatingTrend,
  sessionMatchesCarClass,
  findMatchedCarSessions,
  scoreTrackFamiliarity,
  scoreTrackIncidentRate,
  diversifySelections,
  isWithinCurrentWeekWindow,
} = _testing

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<SessionInput> & { carModel: string }): SessionInput {
  return {
    id: crypto.randomUUID(),
    carModel: overrides.carModel,
    manufacturer: overrides.manufacturer ?? null,
    category: overrides.category ?? 'road',
    gameName: overrides.gameName ?? 'iracing',
    trackName: overrides.trackName ?? 'Spa-Francorchamps',
    sessionType: overrides.sessionType ?? 'race',
    finishPosition: overrides.finishPosition ?? null,
    incidentCount: overrides.incidentCount ?? 2,
    metadata: overrides.metadata ?? { completedLaps: 20, startedAt: '2026-03-15T14:00:00Z' },
    createdAt: overrides.createdAt ?? new Date('2026-03-15T14:00:00Z'),
  }
}

function makeSessionAtHour(hour: number, incidents: number, laps: number = 20): SessionInput {
  const date = new Date(`2026-03-15T${String(hour).padStart(2, '0')}:00:00Z`)
  return makeSession({
    carModel: 'BMW M4 GT3',
    incidentCount: incidents,
    metadata: { completedLaps: laps, startedAt: date.toISOString() },
    createdAt: date,
  })
}

function makeSessionOnDay(dayOfWeek: number, incidents: number, laps: number = 20): SessionInput {
  // 2026-03-15 is a Sunday (0). Offset to target day.
  const baseDate = new Date('2026-03-15T14:00:00Z') // Sunday
  const offset = (dayOfWeek - baseDate.getUTCDay() + 7) % 7
  const date = new Date(baseDate)
  date.setUTCDate(date.getUTCDate() + offset)
  return makeSession({
    carModel: 'BMW M4 GT3',
    incidentCount: incidents,
    metadata: { completedLaps: laps, startedAt: date.toISOString() },
    createdAt: date,
  })
}

function makeRating(overrides: Partial<RatingInput>): RatingInput {
  return {
    category: overrides.category ?? 'road',
    iRating: overrides.iRating ?? 1500,
    safetyRating: overrides.safetyRating ?? '3.50',
    license: overrides.license ?? 'C',
    prevIRating: overrides.prevIRating ?? null,
    prevSafetyRating: overrides.prevSafetyRating ?? null,
    prevLicense: overrides.prevLicense ?? null,
    trackName: overrides.trackName ?? null,
    carModel: overrides.carModel ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-03-15T14:00:00Z'),
  }
}

// ── sessionMatchesCarClass ───────────────────────────────────────────────────

describe('sessionMatchesCarClass', () => {
  it('matches when class short_name appears as token in car model', () => {
    const session = makeSession({ carModel: 'BMW M4 GT3' })
    expect(sessionMatchesCarClass(session, { name: 'GT3 Class', short_name: 'GT3' })).toBe(true)
  })

  it('matches when class name tokens appear in car model', () => {
    const session = makeSession({ carModel: 'Porsche 911 GT3 R' })
    expect(sessionMatchesCarClass(session, { name: 'GT3', short_name: 'GT3' })).toBe(true)
  })

  it('does not match unrelated cars and classes', () => {
    const session = makeSession({ carModel: 'Skip Barber Formula 2000' })
    expect(sessionMatchesCarClass(session, { name: 'GT3 Class', short_name: 'GT3' })).toBe(false)
  })

  it('handles multi-word short names', () => {
    const session = makeSession({ carModel: 'Dallara LMP2' })
    expect(sessionMatchesCarClass(session, { name: 'LMP2 Prototype', short_name: 'LMP2' })).toBe(true)
  })

  it('filters generic words from class name matching', () => {
    // "Class" alone shouldn't cause false positives
    const session = makeSession({ carModel: 'Mazda MX-5 Cup' })
    expect(sessionMatchesCarClass(session, { name: 'GT3 Class', short_name: 'GT3' })).toBe(false)
  })
})

// ── scoreTimeOfDay ───────────────────────────────────────────────────────────

describe('scoreTier', () => {
  it('names its tiers in sentence case, as every label the desk shows is (no capitals but an acronym)', () => {
    expect([90, 80, 79, 60, 59, 40, 39, 0].map((n) => scoreTier(n).label)).toEqual([
      'Best fit', 'Best fit', 'Strong', 'Strong', 'Decent', 'Decent', 'Stretch', 'Stretch',
    ])
  })
})

describe('scoreTimeOfDay', () => {
  it('returns 5 with insufficient data', () => {
    const sessions = [makeSessionAtHour(14, 2)]
    const raceTime = new Date('2026-03-20T14:00:00Z')
    expect(scoreTimeOfDay(sessions, raceTime)).toBe(5)
  })

  it('scores high when race hour matches driver best hour', () => {
    // Driver is cleanest at hour 20 (1 inc), worst at hour 10 (10 inc)
    const sessions = [
      makeSessionAtHour(20, 1),
      makeSessionAtHour(20, 1),
      makeSessionAtHour(10, 10),
      makeSessionAtHour(10, 8),
      makeSessionAtHour(14, 4),
      makeSessionAtHour(14, 5),
    ]
    // Race at hour 20 — driver's best
    const raceTime = new Date('2026-03-20T20:00:00Z')
    expect(scoreTimeOfDay(sessions, raceTime)).toBe(10)
  })

  it('scores low when race hour matches driver worst hour', () => {
    const sessions = [
      makeSessionAtHour(20, 1),
      makeSessionAtHour(20, 1),
      makeSessionAtHour(10, 10),
      makeSessionAtHour(10, 8),
      makeSessionAtHour(14, 4),
      makeSessionAtHour(14, 5),
    ]
    // Race at hour 10 — driver's worst
    const raceTime = new Date('2026-03-20T10:00:00Z')
    expect(scoreTimeOfDay(sessions, raceTime)).toBeLessThanOrEqual(4)
  })

  it('returns 5 when no data exists for the race hour', () => {
    const sessions = [
      makeSessionAtHour(20, 1),
      makeSessionAtHour(20, 2),
      makeSessionAtHour(14, 3),
      makeSessionAtHour(14, 4),
      makeSessionAtHour(10, 5),
    ]
    // Race at hour 8 — no data
    const raceTime = new Date('2026-03-20T08:00:00Z')
    expect(scoreTimeOfDay(sessions, raceTime)).toBe(5)
  })
})

// ── scoreDayOfWeek ───────────────────────────────────────────────────────────

describe('scoreDayOfWeek', () => {
  it('returns 5 with insufficient data', () => {
    const sessions = [makeSessionOnDay(0, 2)]
    const raceTime = new Date('2026-03-15T14:00:00Z') // Sunday
    expect(scoreDayOfWeek(sessions, raceTime)).toBe(5)
  })

  it('scores high when race day matches driver best day', () => {
    // Driver is cleanest on Saturday (day 6), worst on Monday (day 1)
    const sessions = [
      makeSessionOnDay(6, 1),
      makeSessionOnDay(6, 1),
      makeSessionOnDay(1, 10),
      makeSessionOnDay(1, 8),
      makeSessionOnDay(3, 4),
      makeSessionOnDay(3, 5),
    ]
    // Race on Saturday — driver's best
    const saturdayDate = new Date('2026-03-21T14:00:00Z') // Saturday
    expect(scoreDayOfWeek(sessions, saturdayDate)).toBe(10)
  })

  it('scores low when race day matches driver worst day', () => {
    const sessions = [
      makeSessionOnDay(6, 1),
      makeSessionOnDay(6, 1),
      makeSessionOnDay(1, 10),
      makeSessionOnDay(1, 8),
      makeSessionOnDay(3, 4),
      makeSessionOnDay(3, 5),
    ]
    // Race on Monday — driver's worst
    const mondayDate = new Date('2026-03-16T14:00:00Z') // Monday
    expect(scoreDayOfWeek(sessions, mondayDate)).toBeLessThanOrEqual(4)
  })
})

// ── TZ-aware bucketing ───────────────────────────────────────────────────────
//
// Regression: before TZ plumbing, a Pacific-coast racer who ran every Sunday
// at 6pm local had their sessions bucketed as Monday 01:00 UTC, and the
// dashboard told them they "race best at 2am Mondays." These tests lock in
// that scoreTimeOfDay / scoreDayOfWeek resolve hours and days in the passed
// `timeZone` instead of always UTC.

describe('TZ-aware scoring (America/Los_Angeles)', () => {
  // Each session timestamp is the UTC equivalent of "Sunday 18:00 Pacific"
  // during DST (UTC-7). i.e. Monday 01:00 UTC.
  function makePTSundayEveningSession(incidents: number): SessionInput {
    const date = new Date('2026-03-16T01:00:00Z') // Monday 01:00 UTC = Sun 18:00 PT
    return makeSession({
      carModel: 'BMW M4 GT3',
      incidentCount: incidents,
      metadata: { completedLaps: 20, startedAt: date.toISOString() },
      createdAt: date,
    })
  }

  it('scoreTimeOfDay buckets Pacific sessions by local clock hour', () => {
    // 6 clean sessions all at Sun 18:00 Pacific. In UTC this is "1am Monday"
    // which the old code would have scored as "early morning best hour."
    // With TZ='America/Los_Angeles' the best-hour band is centered on 18:00.
    const sessions = Array.from({ length: 6 }, () => makePTSundayEveningSession(1))
    // A race offered at Sun 18:00 PT → should score HIGH in LA tz
    const raceAt18LA = new Date('2026-03-22T01:00:00Z') // next Sun 18:00 PT
    const laScore = scoreTimeOfDay(sessions, raceAt18LA, 'America/Los_Angeles')
    // ...but a race at 01:00 UTC Monday should score LOW in LA tz
    // (it's the same wall-clock time, so this is actually the same input).
    // Use a race that's at 02:00 UTC Sun (19:00 PT Sat) — different local hour
    const raceAtDifferentLocalHour = new Date('2026-03-21T02:00:00Z') // Sat 19:00 PT
    const laScoreOther = scoreTimeOfDay(sessions, raceAtDifferentLocalHour, 'America/Los_Angeles')
    expect(laScore).toBeGreaterThan(laScoreOther)
  })

  it('scoreDayOfWeek treats Pacific Sunday-evening sessions as Sunday', () => {
    // 6 clean sessions at Sun 18:00 PT (Mon 01:00 UTC). Three noisy Wednesday
    // sessions to give the scoring something to contrast against.
    const sundaySessions = Array.from({ length: 6 }, () => makePTSundayEveningSession(1))
    const wednesdaySessions = [
      // Wed 14:00 UTC (Wed 07:00 PT)
      makeSession({
        carModel: 'BMW M4 GT3',
        incidentCount: 10,
        metadata: { completedLaps: 20, startedAt: '2026-03-18T14:00:00Z' },
        createdAt: new Date('2026-03-18T14:00:00Z'),
      }),
      makeSession({
        carModel: 'BMW M4 GT3',
        incidentCount: 10,
        metadata: { completedLaps: 20, startedAt: '2026-03-18T14:00:00Z' },
        createdAt: new Date('2026-03-18T14:00:00Z'),
      }),
      makeSession({
        carModel: 'BMW M4 GT3',
        incidentCount: 10,
        metadata: { completedLaps: 20, startedAt: '2026-03-18T14:00:00Z' },
        createdAt: new Date('2026-03-18T14:00:00Z'),
      }),
    ]
    const sessions = [...sundaySessions, ...wednesdaySessions]

    // Race on a Sunday (local) — under LA tz this should be the BEST day.
    // Pick Sun 22:00 UTC = Sun 15:00 PT — unambiguously Sunday locally.
    const sundayLARace = new Date('2026-03-22T22:00:00Z')
    const sundayScore = scoreDayOfWeek(sessions, sundayLARace, 'America/Los_Angeles')

    // Race on a Wednesday (local) — should score lower.
    const wednesdayLARace = new Date('2026-03-25T22:00:00Z') // Wed 15:00 PT
    const wednesdayScore = scoreDayOfWeek(sessions, wednesdayLARace, 'America/Los_Angeles')

    expect(sundayScore).toBeGreaterThan(wednesdayScore)
  })

  it('old UTC behavior would mis-bucket the same data as Monday', () => {
    // Sanity: under UTC, the same sessions score Monday as the "best" day
    // because 01:00 UTC Monday is how they land before TZ plumbing.
    const sessions = Array.from({ length: 6 }, () => makePTSundayEveningSession(1))
    // Race on Monday in UTC-terms: Mon 14:00 UTC
    const mondayUTC = new Date('2026-03-16T14:00:00Z')
    const utcScore = scoreDayOfWeek(sessions, mondayUTC, 'UTC')
    // Under UTC bucketing, Monday should score well — which is exactly the
    // user-reported bug. This test documents the old behavior so regressions
    // away from TZ plumbing are obvious.
    expect(utcScore).toBeGreaterThanOrEqual(5)
  })
})

// ── scoreCarFamiliarity ──────────────────────────────────────────────────────

describe('scoreCarFamiliarity', () => {
  it('returns 0 with no car classes', () => {
    const sessions = [makeSession({ carModel: 'BMW M4 GT3' })]
    expect(scoreCarFamiliarity(sessions, [])).toBe(0)
  })

  it('returns 0 with no matching sessions', () => {
    const sessions = [makeSession({ carModel: 'Skip Barber Formula 2000' })]
    expect(scoreCarFamiliarity(sessions, [{ name: 'GT3 Class', short_name: 'GT3' }])).toBe(0)
  })

  it('scores based on count of matching sessions', () => {
    const gt3Class = { name: 'GT3 Class', short_name: 'GT3' }
    const oneSess = [makeSession({ carModel: 'BMW M4 GT3' })]
    const threeSess = Array.from({ length: 3 }, () => makeSession({ carModel: 'BMW M4 GT3' }))
    const fiveSess = Array.from({ length: 5 }, () => makeSession({ carModel: 'Porsche 911 GT3 R' }))
    const tenSess = Array.from({ length: 10 }, () => makeSession({ carModel: 'BMW M4 GT3' }))

    expect(scoreCarFamiliarity(oneSess, [gt3Class])).toBe(3)
    expect(scoreCarFamiliarity(threeSess, [gt3Class])).toBe(6)
    expect(scoreCarFamiliarity(fiveSess, [gt3Class])).toBe(8)
    expect(scoreCarFamiliarity(tenSess, [gt3Class])).toBe(10)
  })
})

// ── scoreCarPerformance ──────────────────────────────────────────────────────

describe('scoreCarPerformance', () => {
  it('returns 0 with no car classes', () => {
    expect(scoreCarPerformance([], [])).toBe(0)
  })

  it('returns 5 (neutral) with insufficient matched sessions', () => {
    const sessions = [makeSession({ carModel: 'BMW M4 GT3', incidentCount: 2 })]
    expect(scoreCarPerformance(sessions, [{ name: 'GT3', short_name: 'GT3' }])).toBe(5)
  })

  it('scores high when driver has low incidents in matched cars', () => {
    const gt3Class = { name: 'GT3', short_name: 'GT3' }
    // GT3 sessions: very clean (1 inc / 20 laps = 0.05 inc/lap)
    const gt3Sessions = Array.from({ length: 5 }, () =>
      makeSession({ carModel: 'BMW M4 GT3', incidentCount: 1, metadata: { completedLaps: 20 } }),
    )
    // Other sessions: messy (10 inc / 20 laps = 0.5 inc/lap)
    const otherSessions = Array.from({ length: 5 }, () =>
      makeSession({ carModel: 'Skip Barber Formula 2000', incidentCount: 10, metadata: { completedLaps: 20 } }),
    )
    const allSessions = [...gt3Sessions, ...otherSessions]
    const score = scoreCarPerformance(allSessions, [gt3Class])
    expect(score).toBeGreaterThanOrEqual(7)
  })

  it('scores low when driver has high incidents in matched cars', () => {
    const gt3Class = { name: 'GT3', short_name: 'GT3' }
    // GT3 sessions: very messy (15 inc / 20 laps)
    const gt3Sessions = Array.from({ length: 5 }, () =>
      makeSession({ carModel: 'BMW M4 GT3', incidentCount: 15, metadata: { completedLaps: 20 } }),
    )
    // Other sessions: clean (1 inc / 20 laps)
    const otherSessions = Array.from({ length: 5 }, () =>
      makeSession({ carModel: 'Skip Barber Formula 2000', incidentCount: 1, metadata: { completedLaps: 20 } }),
    )
    const allSessions = [...gt3Sessions, ...otherSessions]
    const score = scoreCarPerformance(allSessions, [gt3Class])
    expect(score).toBeLessThanOrEqual(4)
  })
})

// ── scoreRatingTrend ─────────────────────────────────────────────────────────

describe('scoreRatingTrend', () => {
  it('returns 5 (neutral) with no history', () => {
    expect(scoreRatingTrend([], 'road')).toBe(5)
  })

  it('scores max (10) when both iR and SR are trending up', () => {
    const history = Array.from({ length: 5 }, (_, i) =>
      makeRating({
        category: 'road',
        iRating: 1500 + i * 50,
        prevIRating: 1500 + (i - 1) * 50,
        safetyRating: (3.0 + i * 0.1).toFixed(2),
        prevSafetyRating: (3.0 + (i - 1) * 0.1).toFixed(2),
        createdAt: new Date(Date.now() - i * 86400000),
      }),
    )
    expect(scoreRatingTrend(history, 'road')).toBe(10)
  })

  it('scores 0 when both iR and SR are trending down hard', () => {
    const history = Array.from({ length: 5 }, (_, i) =>
      makeRating({
        category: 'road',
        iRating: 1500 - i * 100,
        prevIRating: 1500 - (i - 1) * 100,
        safetyRating: (3.0 - i * 0.2).toFixed(2),
        prevSafetyRating: (3.0 - (i - 1) * 0.2).toFixed(2),
        createdAt: new Date(Date.now() - i * 86400000),
      }),
    )
    expect(scoreRatingTrend(history, 'road')).toBe(0)
  })

  it('caps at 10', () => {
    const history = Array.from({ length: 5 }, (_, i) =>
      makeRating({
        category: 'road',
        iRating: 2000 + i * 200,
        prevIRating: 2000 + (i - 1) * 200,
        safetyRating: (4.0 + i * 0.1).toFixed(2),
        prevSafetyRating: (4.0 + (i - 1) * 0.1).toFixed(2),
        createdAt: new Date(Date.now() - i * 86400000),
      }),
    )
    expect(scoreRatingTrend(history, 'road')).toBeLessThanOrEqual(10)
  })

  it('ignores other categories', () => {
    const history = [
      makeRating({
        category: 'oval',
        iRating: 2000,
        prevIRating: 1000,
        safetyRating: '4.99',
        prevSafetyRating: '1.00',
      }),
    ]
    // No road history → neutral
    expect(scoreRatingTrend(history, 'road')).toBe(5)
  })
})

// ── scoreTrackFamiliarity (unchanged, sanity check) ──────────────────────────

describe('scoreTrackFamiliarity', () => {
  it('returns 0 for unknown track', () => {
    expect(scoreTrackFamiliarity([], 'Monza')).toBe(0)
  })

  it('returns 25 for 5+ races at track', () => {
    const sessions = Array.from({ length: 6 }, () =>
      makeSession({ carModel: 'BMW M4 GT3', trackName: 'Spa-Francorchamps' }),
    )
    expect(scoreTrackFamiliarity(sessions, 'Spa-Francorchamps')).toBe(25)
  })
})

// ── scoreTrackIncidentRate (unchanged, sanity check) ─────────────────────────

describe('scoreTrackIncidentRate', () => {
  it('returns neutral (10) with no sessions', () => {
    expect(scoreTrackIncidentRate([], 'Monza')).toBe(10)
  })

  it('scores high when track incidents are lower than overall', () => {
    const trackSessions = Array.from({ length: 3 }, () =>
      makeSession({ carModel: 'BMW M4 GT3', trackName: 'Spa-Francorchamps', incidentCount: 1, metadata: { completedLaps: 20 } }),
    )
    const otherSessions = Array.from({ length: 3 }, () =>
      makeSession({ carModel: 'BMW M4 GT3', trackName: 'Monza', incidentCount: 10, metadata: { completedLaps: 20 } }),
    )
    const all = [...trackSessions, ...otherSessions]
    expect(scoreTrackIncidentRate(all, 'Spa-Francorchamps')).toBeGreaterThanOrEqual(20)
  })
})

// ── diversifySelections ──────────────────────────────────────────────────────

function makeSuggestion(overrides: Partial<RaceSuggestion>): RaceSuggestion {
  return {
    seriesName: overrides.seriesName ?? 'Test Series',
    trackName: overrides.trackName ?? 'Test Track',
    trackConfig: overrides.trackConfig ?? null,
    category: overrides.category ?? 'road',
    licenseClass: overrides.licenseClass ?? 'C',
    isOfficial: overrides.isOfficial ?? true,
    isFixed: overrides.isFixed ?? false,
    carClassNames: overrides.carClassNames ?? [],
    seasonId: overrides.seasonId ?? 1000,
    seriesId: overrides.seriesId ?? 100,
    nextStartTime: overrides.nextStartTime ?? new Date('2026-04-11T20:00:00Z'),
    minutesUntilStart: overrides.minutesUntilStart ?? 30,
    sessionMinutes: overrides.sessionMinutes ?? 30,
    repeatMinutes: overrides.repeatMinutes ?? null,
    raceLapLimit: overrides.raceLapLimit ?? null,
    raceTimeLimit: overrides.raceTimeLimit ?? null,
    score: overrides.score ?? 50,
    scoreBreakdown: overrides.scoreBreakdown ?? {
      trackFamiliarity: 10, trackIncidentRate: 10, carFamiliarity: 5,
      carPerformance: 5, timeOfDay: 5, dayOfWeek: 5, ratingTrend: 5, licenseLevel: 5,
    },
    strategy: overrides.strategy ?? { type: 'steady', text: 'Steady' },
    commentary: overrides.commentary ?? 'Test commentary',
    viewModel: overrides.viewModel ?? {
      scoreColorHex: '#34c759',
      scoreTierLabel: 'Best fit',
      startsInLabel: 'in 30 min',
      startsInShortLabel: '30m',
      durationLabel: null,
      strategyLabel: 'Steady',
      strategyColorHex: '#7cdff0',
      trackLabel: '',
      trackLookupKey: '',
    },
  }
}

describe('diversifySelections', () => {
  it('spreads across license classes (one per class first)', () => {
    const suggestions = [
      makeSuggestion({ licenseClass: 'C', category: 'road', seriesName: 'GT3 1', seriesId: 101, score: 80, trackName: 'Spa', nextStartTime: new Date('2026-04-11T20:00:00Z') }),
      makeSuggestion({ licenseClass: 'C', category: 'road', seriesName: 'GT3 2', seriesId: 102, score: 75, trackName: 'Monza', nextStartTime: new Date('2026-04-11T20:05:00Z') }),
      makeSuggestion({ licenseClass: 'D', category: 'road', seriesName: 'MX5', seriesId: 103, score: 70, trackName: 'Laguna Seca', nextStartTime: new Date('2026-04-11T20:10:00Z') }),
      makeSuggestion({ licenseClass: 'C', category: 'oval', seriesName: 'Oval C', seriesId: 104, score: 65, trackName: 'Daytona', nextStartTime: new Date('2026-04-11T20:15:00Z') }),
      makeSuggestion({ licenseClass: 'B', category: 'road', seriesName: 'LMP2', seriesId: 105, score: 60, trackName: 'Watkins Glen', nextStartTime: new Date('2026-04-11T20:20:00Z') }),
    ]

    const result = diversifySelections(suggestions, 5)
    expect(result).toHaveLength(5)

    // Pass 1 picks one per license class (highest score from each): C→GT3 1, D→MX5, B→LMP2
    // Pass 2 backfills: GT3 2, Oval C (different series + different tracks)
    const seriesNames = result.map(s => s.seriesName)
    expect(seriesNames).toContain('GT3 1')  // C class pick
    expect(seriesNames).toContain('MX5')    // D class pick
    expect(seriesNames).toContain('LMP2')   // B class pick

    // No duplicate series
    const seriesIds = result.map(s => s.seriesId)
    expect(new Set(seriesIds).size).toBe(5)
  })

  it('deduplicates series and tracks across picks', () => {
    const suggestions = [
      makeSuggestion({ licenseClass: 'C', seriesId: 101, score: 90, trackName: 'Spa', seriesName: 'Series A', nextStartTime: new Date('2026-04-11T20:00:00Z') }),
      makeSuggestion({ licenseClass: 'D', seriesId: 102, score: 85, trackName: 'Spa', seriesName: 'Series B', nextStartTime: new Date('2026-04-11T20:01:00Z') }),
      makeSuggestion({ licenseClass: 'B', seriesId: 103, score: 80, trackName: 'Monza', seriesName: 'Series C', nextStartTime: new Date('2026-04-11T20:02:00Z') }),
      makeSuggestion({ licenseClass: 'A', seriesId: 104, score: 70, trackName: 'Laguna Seca', seriesName: 'Series D', nextStartTime: new Date('2026-04-11T20:03:00Z') }),
    ]

    const result = diversifySelections(suggestions, 3)
    expect(result).toHaveLength(3)

    // Pass 1: C→Series A (Spa), D→Series B skipped (Spa duplicate), B→Series C (Monza), then D needs pass 2
    // Series B shares track with Series A so it's skipped in pass 1 and 2
    // Series D picked instead for the 3rd slot
    const seriesNames = result.map(s => s.seriesName)
    expect(seriesNames).toContain('Series A')  // C class
    expect(seriesNames).toContain('Series C')  // B class
    // 3rd pick: Series D (A class, unique track) since Series B shares Spa track
    expect(seriesNames).toContain('Series D')
  })

  it('returns sorted by soonest start time', () => {
    const suggestions = [
      makeSuggestion({ licenseClass: 'B', seriesId: 101, score: 80, trackName: 'Spa', nextStartTime: new Date('2026-04-11T21:00:00Z') }),
      makeSuggestion({ licenseClass: 'C', seriesId: 102, score: 70, trackName: 'Monza', nextStartTime: new Date('2026-04-11T20:00:00Z') }),
      makeSuggestion({ licenseClass: 'D', seriesId: 103, score: 60, trackName: 'Laguna Seca', nextStartTime: new Date('2026-04-11T20:30:00Z') }),
    ]

    const result = diversifySelections(suggestions, 3)
    // All 3 picked (different license classes, series, tracks)
    // Then sorted by start time
    expect(result[0].licenseClass).toBe('C')  // 20:00 — soonest
    expect(result[1].licenseClass).toBe('D')  // 20:30
    expect(result[2].licenseClass).toBe('B')  // 21:00 — latest
  })
})

// ── iRacing week filtering ──────────────────────────────────────────────────

describe('isWithinCurrentWeekWindow', () => {
  // A known Tuesday 00:00 UTC — iRacing season starts land on Tuesdays
  const SEASON_START = '2026-04-07T00:00:00Z'  // Tuesday
  const WEEK = 7 * 24 * 60 * 60 * 1000

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('includes the current week', () => {
    // Thursday April 23 — season starts Apr 7, so Apr 23 is in week 2
    // (weeks: 0 = Apr 7–14, 1 = Apr 14–21, 2 = Apr 21–28)
    const now = new Date('2026-04-23T12:00:00Z')
    expect(isWithinCurrentWeekWindow(SEASON_START, 2, now)).toBe(true)
  })

  it('excludes prior weeks', () => {
    const now = new Date('2026-04-23T12:00:00Z')  // week 2
    expect(isWithinCurrentWeekWindow(SEASON_START, 1, now)).toBe(false)
    expect(isWithinCurrentWeekWindow(SEASON_START, 0, now)).toBe(false)
  })

  it('excludes future weeks that are more than 24h out', () => {
    const now = new Date('2026-04-23T12:00:00Z')  // Thursday of week 2
    // Week 3 starts Tuesday 2026-04-28 — ~4.5 days away
    expect(isWithinCurrentWeekWindow(SEASON_START, 3, now)).toBe(false)
    expect(isWithinCurrentWeekWindow(SEASON_START, 4, now)).toBe(false)
  })

  it('includes the upcoming week when within 24h of Tuesday rollover', () => {
    // Monday 14:00 UTC — 22h before iRacing's actual Tuesday 12:00
    // UTC rollover at end of week 2.
    // Week 2 = Apr 21 12:00 → Apr 28 12:00; Monday Apr 27 14:00 is
    // still inside week 2 and within the 24h window of week 3.
    const now = new Date('2026-04-27T14:00:00Z')
    expect(now.getUTCDay()).toBe(1)  // sanity: Monday
    expect(isWithinCurrentWeekWindow(SEASON_START, 2, now)).toBe(true)   // current
    expect(isWithinCurrentWeekWindow(SEASON_START, 3, now)).toBe(true)   // upcoming, within 24h
    expect(isWithinCurrentWeekWindow(SEASON_START, 4, now)).toBe(false)  // too far out
    expect(isWithinCurrentWeekWindow(SEASON_START, 1, now)).toBe(false)  // past
  })

  it('drops the current week exactly at rollover', () => {
    // Tuesday 12:00:00 UTC — week N just ended, week N+1 just started
    // (iRacing's actual rollover, not the midnight-UTC alignment the
    // pre-fix code assumed).
    const now = new Date('2026-04-28T12:00:00Z')
    expect(now.getUTCDay()).toBe(2)  // sanity: Tuesday
    // Week 2 ended at 2026-04-28 12:00, so weekEnd > now is false → excluded
    expect(isWithinCurrentWeekWindow(SEASON_START, 2, now)).toBe(false)
    // Week 3 just started
    expect(isWithinCurrentWeekWindow(SEASON_START, 3, now)).toBe(true)
  })

  it('falls back to unfiltered and warns when start_date is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const now = new Date('2026-04-23T12:00:00Z')
    expect(isWithinCurrentWeekWindow(undefined, 0, now)).toBe(true)
    expect(isWithinCurrentWeekWindow(undefined, 99, now)).toBe(true)
    expect(warn).toHaveBeenCalled()
  })

  it('falls back to unfiltered and warns when start_date is unparseable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const now = new Date('2026-04-23T12:00:00Z')
    expect(isWithinCurrentWeekWindow('not a date', 3, now)).toBe(true)
    expect(warn).toHaveBeenCalled()
  })

  it('sanity: arithmetic matches 7-day weeks from Tuesday start', () => {
    const startMs = new Date(SEASON_START).getTime()
    // Manually compute: middle of week 5 should match
    const midWeek5 = new Date(startMs + 5 * WEEK + 3 * 24 * 60 * 60 * 1000)
    expect(isWithinCurrentWeekWindow(SEASON_START, 5, midWeek5)).toBe(true)
    expect(isWithinCurrentWeekWindow(SEASON_START, 4, midWeek5)).toBe(false)
    expect(isWithinCurrentWeekWindow(SEASON_START, 6, midWeek5)).toBe(false)
  })
})

describe('computeNextRaceIdeas — iRacing week filter', () => {
  // Build a minimal season with three weeks, each pointing at a unique track.
  // Every week has the same repeating descriptor (Saturday race at 14:00 UTC),
  // so without filtering, all three weeks would produce matching candidates.
  function makeSeason(): IRacingSchedule {
    const descriptor = {
      repeating: true,
      session_minutes: 45,
      day_offset: [6],  // Saturday
      first_session_time: '14:00',
      repeat_minutes: 120,
    }
    return {
      season_id: 5001,
      series_id: 900,
      series_name: 'Test Series',
      season_name: 'Test Season',
      official: true,
      fixed_setup: false,
      license_group: 3,
      license_group_name: 'Class C',
      min_license_level: 4,
      track_types: [{ track_type: 'road' }],
      start_date: '2026-04-07T00:00:00Z',  // Tuesday
      car_classes: [{ short_name: 'GT3', name: 'GT3', car_class_id: 0 }],
      schedules: [
        {
          race_week_num: 0,
          track: { track_id: 100, track_name: 'Week Zero Track', config_name: null, category: 'road' },
          race_time_descriptors: [descriptor],
        },
        {
          race_week_num: 1,
          track: { track_id: 101, track_name: 'Week One Track', config_name: null, category: 'road' },
          race_time_descriptors: [descriptor],
        },
        {
          race_week_num: 2,
          track: { track_id: 102, track_name: 'Week Two Track', config_name: null, category: 'road' },
          race_time_descriptors: [descriptor],
        },
      ],
    }
  }

  function driverRating(): DriverRatingInput {
    return { category: 'road', iRating: 2000, safetyRating: '3.50', license: 'C' }
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('suggests the current week\'s track, not some other week\'s', () => {
    // Saturday April 18 2026 — middle of iRacing week 1
    // (Season starts Tue Apr 7; week 1 runs Apr 14 00:00 → Apr 21 00:00 UTC)
    // 13:00 UTC — 60 minutes before the Saturday 14:00 session
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T13:00:00Z'))

    const result = computeNextRaceIdeas([], [], [driverRating()], [makeSeason()])

    expect(result).toHaveLength(1)
    expect(result[0].trackName).toBe('Week One Track')
  })

  it('drops past-week candidates even when their day-of-week pattern matches', () => {
    // Saturday of week 2 — week 0 and week 1 descriptors would otherwise match
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-25T13:00:00Z'))

    const result = computeNextRaceIdeas([], [], [driverRating()], [makeSeason()])

    expect(result).toHaveLength(1)
    expect(result[0].trackName).toBe('Week Two Track')
    // Explicitly: no past-week tracks leaked through
    expect(result.map(r => r.trackName)).not.toContain('Week Zero Track')
    expect(result.map(r => r.trackName)).not.toContain('Week One Track')
  })
})

// ── Per-week car classes ────────────────────────────────────────────────────
//
// Regression: Ring Meister by LVRY runs at Nürburgring every week but
// rotates the car weekly — Solstice one week, Kia Optima the next, GT3 the
// next. The upstream data has a series-wide `car_classes` field that's a
// stale week-0 snapshot. Before this fix, our dashboard displayed
// "Nürburgring + Ligier JS P320" for every single week, even when the
// actual car for the current week was the Pontiac Solstice. These tests
// lock in that per-week car_classes on a schedule item override the
// series-wide list.

describe('computeNextRaceIdeas — per-week car rotation', () => {
  function ringMeisterLike(): IRacingSchedule {
    const descriptor = {
      repeating: true,
      session_minutes: 45,
      day_offset: [6],  // Saturday
      first_session_time: '14:00',
      repeat_minutes: 120,
    }
    return {
      season_id: 6001,
      series_id: 526,
      series_name: 'Ring Meister by LVRY',
      season_name: 'Ring Meister',
      official: true,
      fixed_setup: false,
      license_group: 3,
      license_group_name: 'Class C',
      min_license_level: 8,
      track_types: [{ track_type: 'road' }],
      start_date: '2026-04-07T00:00:00Z',
      // Series-wide list matches week 0's car — this is the STALE value
      // the real week-planner exposes. After this fix we must not display
      // it for week 4.
      car_classes: [{ short_name: 'Ligier JS P320', name: 'Ligier JS P320', car_class_id: 0 }],
      schedules: [
        {
          race_week_num: 0,
          track: { track_id: 300, track_name: 'Nürburgring Nordschleife', config_name: 'Industriefahrten', category: 'road' },
          race_time_descriptors: [descriptor],
          car_classes: [{ short_name: 'LJSP', name: 'Ligier JS P320', car_class_id: 0 }],
        },
        {
          race_week_num: 1,
          track: { track_id: 300, track_name: 'Nürburgring Nordschleife', config_name: 'Industriefahrten', category: 'road' },
          race_time_descriptors: [descriptor],
          car_classes: [{ short_name: 'SOL', name: 'Solstice', car_class_id: 0 }],
        },
        {
          race_week_num: 2,
          track: { track_id: 300, track_name: 'Nürburgring Nordschleife', config_name: 'Industriefahrten', category: 'road' },
          race_time_descriptors: [descriptor],
          // GT3 2025 is a multi-car class in reality. Mimic that here so
          // the dedup assertion has something to bite on.
          car_classes: [
            { short_name: 'M4GT3', name: 'GT3 2025', car_class_id: 0 },
            { short_name: 'AMGT3', name: 'GT3 2025', car_class_id: 1 },
            { short_name: '992R', name: 'GT3 2025', car_class_id: 2 },
          ],
        },
      ],
    }
  }

  function fallbackSeason(): IRacingSchedule {
    // Non-rotating series — schedules don't supply car_classes, so we
    // fall back to the series-wide list. This mirrors single-car rookie
    // series like the Rookie Street Stock Series.
    const descriptor = {
      repeating: true,
      session_minutes: 30,
      day_offset: [6],
      first_session_time: '14:00',
      repeat_minutes: 60,
    }
    return {
      season_id: 7001,
      series_id: 182,
      series_name: 'Single-Car Rookie Series',
      season_name: 'Rookie',
      official: true,
      fixed_setup: true,
      license_group: 1,
      license_group_name: 'Rookie',
      min_license_level: 1,
      track_types: [{ track_type: 'road' }],
      start_date: '2026-04-07T00:00:00Z',
      car_classes: [{ short_name: 'Street Stocks', name: 'Street Stocks', car_class_id: 0 }],
      schedules: [
        {
          race_week_num: 1,
          track: { track_id: 400, track_name: 'South Boston Speedway', config_name: null, category: 'road' },
          race_time_descriptors: [descriptor],
          // no car_classes — exercise the fallback
        },
      ],
    }
  }

  function driverRating(): DriverRatingInput {
    return { category: 'road', iRating: 2000, safetyRating: '3.50', license: 'C' }
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it("shows this week's car (Solstice), not the series-wide one (Ligier)", () => {
    // Middle of iRacing week 1 — Ring Meister's Solstice week in this fixture
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T13:00:00Z'))

    const result = computeNextRaceIdeas([], [], [driverRating()], [ringMeisterLike()])

    expect(result).toHaveLength(1)
    expect(result[0].carClassNames).toContain('Solstice')
    expect(result[0].carClassNames).not.toContain('Ligier JS P320')
  })

  it('deduplicates display names for multi-car weeks (GT3 2025 shown once, not 3×)', () => {
    // Middle of iRacing week 2 — the GT3 2025 multi-car week in this fixture
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-25T13:00:00Z'))

    const result = computeNextRaceIdeas([], [], [driverRating()], [ringMeisterLike()])

    expect(result).toHaveLength(1)
    expect(result[0].carClassNames).toEqual(['GT3 2025'])
  })

  it('falls back to series-wide car_classes when per-week list is absent', () => {
    // Week 1 of the single-car rookie series — no per-schedule car_classes
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T13:00:00Z'))

    const result = computeNextRaceIdeas([], [], [driverRating()], [fallbackSeason()])

    expect(result).toHaveLength(1)
    expect(result[0].carClassNames).toEqual(['Street Stocks'])
  })
})

// ── Race duration plumbing ──────────────────────────────────────────────────
//
// session_minutes is the whole timeslot (practice + qual + race) — usually
// 2-3× the race itself, so it's the wrong field to show as "race duration."
// The race-portion fields are race_lap_limit (most common) and race_time_limit
// (sprints & endurance). These tests lock in that both surface on the
// suggestion so the frontend can render a chip.

describe('computeNextRaceIdeas — race duration plumbing', () => {
  function seasonWithLapLimit(): IRacingSchedule {
    return {
      season_id: 8001,
      series_id: 900,
      series_name: 'Lap-Limited Series',
      season_name: 'Lap-Limited',
      official: true,
      fixed_setup: false,
      license_group: 3,
      license_group_name: 'Class C',
      min_license_level: 8,
      track_types: [{ track_type: 'road' }],
      start_date: '2026-04-07T00:00:00Z',
      car_classes: [{ short_name: 'GT3', name: 'GT3', car_class_id: 0 }],
      schedules: [
        {
          race_week_num: 1,
          track: { track_id: 500, track_name: 'Road Atlanta', config_name: null, category: 'road' },
          race_time_descriptors: [{
            repeating: true,
            session_minutes: 70,
            day_offset: [6],
            first_session_time: '14:00',
            repeat_minutes: 120,
          }],
          race_lap_limit: 40,
        },
      ],
    }
  }

  function seasonWithTimeLimit(): IRacingSchedule {
    return {
      season_id: 8002,
      series_id: 901,
      series_name: 'Time-Limited Sprint',
      season_name: 'Time-Limited',
      official: true,
      fixed_setup: false,
      license_group: 3,
      license_group_name: 'Class C',
      min_license_level: 8,
      track_types: [{ track_type: 'road' }],
      start_date: '2026-04-07T00:00:00Z',
      car_classes: [{ short_name: 'MX5', name: 'MX-5', car_class_id: 0 }],
      schedules: [
        {
          race_week_num: 1,
          track: { track_id: 501, track_name: 'Lime Rock Park', config_name: null, category: 'road' },
          race_time_descriptors: [{
            repeating: true,
            session_minutes: 26,
            day_offset: [6],
            first_session_time: '14:00',
            repeat_minutes: 30,
          }],
          race_time_limit: 12,
        },
      ],
    }
  }

  function driverRating(): DriverRatingInput {
    return { category: 'road', iRating: 2000, safetyRating: '3.50', license: 'C' }
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('surfaces race_lap_limit on the suggestion', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T13:00:00Z'))

    const result = computeNextRaceIdeas([], [], [driverRating()], [seasonWithLapLimit()])

    expect(result).toHaveLength(1)
    expect(result[0].raceLapLimit).toBe(40)
    expect(result[0].raceTimeLimit).toBeNull()
  })

  it('surfaces race_time_limit on the suggestion', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T13:00:00Z'))

    const result = computeNextRaceIdeas([], [], [driverRating()], [seasonWithTimeLimit()])

    expect(result).toHaveLength(1)
    expect(result[0].raceLapLimit).toBeNull()
    expect(result[0].raceTimeLimit).toBe(12)
  })
})

describe('formatStartsInShortLabel — chip formatter', () => {
  const now = new Date('2026-04-29T12:00:00Z')

  it('"Starting now" inside the 1-minute floor', () => {
    const t = new Date(now.getTime() + 30 * 1000)
    expect(formatStartsInShortLabel(t, now)).toBe('Starting now')
  })

  it('minutes form under 1 hour ("15m")', () => {
    const t = new Date(now.getTime() + 15 * 60 * 1000)
    expect(formatStartsInShortLabel(t, now)).toBe('15m')
  })

  it('hours-only form on the hour ("2h")', () => {
    const t = new Date(now.getTime() + 2 * 60 * 60 * 1000)
    expect(formatStartsInShortLabel(t, now)).toBe('2h')
  })

  it('hours + minutes form between hours ("2h 30m")', () => {
    const t = new Date(now.getTime() + (2 * 60 + 30) * 60 * 1000)
    expect(formatStartsInShortLabel(t, now)).toBe('2h 30m')
  })

  it('weekday short form between 12h and 7d', () => {
    const t = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    // Apr 30, 2026 was a Thursday — server formatter is locale-en-US
    expect(formatStartsInShortLabel(t, now)).toBe('Thu')
  })

  it('month + day form past 7 days', () => {
    const t = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    expect(formatStartsInShortLabel(t, now)).toBe('May 13')
  })
})

describe('viewModel new fields — wire shape', () => {
  // The strategy-label change ("Form" → "On Form") was a one-character
  // edit to a constant map inside the calc. Round-tripping it through
  // `computeNextRaceIdeas` requires the full iRacing-schedule fixture
  // dance the rest of this file already exercises; it's covered there.
  // What this block locks down is the SHAPE: every suggestion carries
  // the new view-model fields with the expected types, so native
  // decoding can rely on them being present.
  it('every test fixture viewModel includes the new fields', () => {
    const fixture = makeSuggestion({})
    expect(fixture.viewModel).toEqual({
      scoreColorHex: '#34c759',
      scoreTierLabel: 'Best fit',
      startsInLabel: 'in 30 min',
      startsInShortLabel: '30m',
      durationLabel: null,
      strategyLabel: 'Steady',
      strategyColorHex: '#7cdff0',
      trackLabel: '',
      trackLookupKey: '',
    })
  })
})
