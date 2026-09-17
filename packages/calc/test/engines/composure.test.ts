/**
 * Composure & Heat — first cut. Locks the score's anchoring behavior
 * (break-even iR with average incidents → ~50, clean climbers → high,
 * incident bleeders → low) and the Heat direction thresholds against
 * representative fabricated samples. Uses fabricated sessions rather
 * than real fixtures so the test is independent of the live data set
 * and the anchors stay easy to reason about.
 */
import { describe, it, expect } from 'vitest'
import {
  computeComposure,
  computeHeat,
  computeStreaks,
  computeDisciplineMix,
  computeComposureSeries,
  computeTrajectory,
  type ComposureSessionInput,
} from '../../src/engines/composure'

function buildSessions(
  values: { iRatingDelta: number; incidents: number }[],
  startDate = new Date('2026-04-01T18:00:00Z'),
): ComposureSessionInput[] {
  // Synthesize one session per day, oldest → newest left-to-right so
  // the trend computation has predictable ordering after sorting.
  return values.map((v, i) => ({
    date: new Date(startDate.getTime() + i * 86400000).toISOString(),
    iRatingDelta: v.iRatingDelta,
    incidents: v.incidents,
  }))
}

describe('computeComposure', () => {
  it('returns sentinel for empty input', () => {
    const result = computeComposure([])
    expect(result.sampleSize).toBe(0)
    expect(result.score).toBe(50)
    expect(result.band).toBe('steady')
    expect(result.trend).toBe('new')
  })

  it('anchors near 50 for break-even iR with average incidents', () => {
    const sessions = buildSessions(
      Array.from({ length: 20 }, () => ({ iRatingDelta: 0, incidents: 4 })),
    )
    const result = computeComposure(sessions)
    expect(result.score).toBe(50)
    expect(result.band).toBe('steady')
  })

  it('scores high for a clean climber', () => {
    const sessions = buildSessions(
      Array.from({ length: 20 }, () => ({ iRatingDelta: 25, incidents: 1 })),
    )
    const result = computeComposure(sessions)
    expect(result.score).toBeGreaterThanOrEqual(80)
    expect(result.band).toBe('untouchable')
    expect(result.iRatingPerIncident).toBeGreaterThan(0)
  })

  it('scores low for an incident bleeder', () => {
    const sessions = buildSessions(
      Array.from({ length: 20 }, () => ({ iRatingDelta: -25, incidents: 8 })),
    )
    const result = computeComposure(sessions)
    expect(result.score).toBeLessThanOrEqual(20)
    expect(result.band).toBe('gritty')
  })

  it("flags 'improving' when recent races are cleaner than older ones", () => {
    // Older 10: noisy, losing iR. Newer 10: clean, climbing.
    const older = Array.from({ length: 10 }, () => ({ iRatingDelta: -15, incidents: 6 }))
    const newer = Array.from({ length: 10 }, () => ({ iRatingDelta: 20, incidents: 1 }))
    const sessions = buildSessions([...older, ...newer])
    const result = computeComposure(sessions)
    expect(result.trend).toBe('improving')
  })

  it("flags 'declining' when recent races are dirtier than older ones", () => {
    const older = Array.from({ length: 10 }, () => ({ iRatingDelta: 20, incidents: 1 }))
    const newer = Array.from({ length: 10 }, () => ({ iRatingDelta: -15, incidents: 6 }))
    const sessions = buildSessions([...older, ...newer])
    const result = computeComposure(sessions)
    expect(result.trend).toBe('declining')
  })

  it('respects the windowSize option', () => {
    // 30 dirty races followed by 5 clean — full window pulls in the dirt;
    // a tiny window only sees the clean ones.
    const dirty = Array.from({ length: 30 }, () => ({ iRatingDelta: -20, incidents: 6 }))
    const clean = Array.from({ length: 5 }, () => ({ iRatingDelta: 30, incidents: 1 }))
    const sessions = buildSessions([...dirty, ...clean])

    const wide = computeComposure(sessions)              // default 30
    const narrow = computeComposure(sessions, { windowSize: 5 })

    expect(narrow.score).toBeGreaterThan(wide.score)
    expect(narrow.sampleSize).toBe(5)
  })
})

describe('computeHeat', () => {
  it('returns flat sentinel for empty input', () => {
    const result = computeHeat([])
    expect(result.direction).toBe('flat')
    expect(result.sampleSize).toBe(0)
  })

  it("calls a strong recent run 'hot'", () => {
    const sessions = buildSessions(
      Array.from({ length: 10 }, () => ({ iRatingDelta: 30, incidents: 1 })),
    )
    expect(computeHeat(sessions).direction).toBe('hot')
  })

  it("calls a steady losing run 'cold'", () => {
    const sessions = buildSessions(
      Array.from({ length: 10 }, () => ({ iRatingDelta: -30, incidents: 5 })),
    )
    expect(computeHeat(sessions).direction).toBe('cold')
  })

  it('only inspects the recent window', () => {
    // 30 cold races followed by 10 hot ones — with the default
    // recentRaceCount of 10, Heat should see only the 10 hot ones
    // (newest after sortByDateDesc) and ignore the older cold tail.
    const cold = Array.from({ length: 30 }, () => ({ iRatingDelta: -30, incidents: 5 }))
    const hot = Array.from({ length: 10 }, () => ({ iRatingDelta: 30, incidents: 1 }))
    const sessions = buildSessions([...cold, ...hot])
    const result = computeHeat(sessions)
    expect(result.direction).toBe('hot')
    expect(result.iRatingDeltaAvg).toBeGreaterThan(20)
    expect(result.sampleSize).toBe(10)
  })
})

describe('computeStreaks', () => {
  it('returns all-null sentinel for empty input', () => {
    const result = computeStreaks([])
    expect(result.current).toBeNull()
    expect(result.longestSlump).toBeNull()
    expect(result.longestSurge).toBeNull()
  })

  it('classifies the current streak based on the most recent races', () => {
    // Older 5 gaining, then 4 most-recent races losing → current = losing run of 4.
    const older = Array.from({ length: 5 }, () => ({ iRatingDelta: 20, incidents: 1 }))
    const recentSlump = Array.from({ length: 4 }, () => ({ iRatingDelta: -15, incidents: 5 }))
    const sessions = buildSessions([...older, ...recentSlump])
    const result = computeStreaks(sessions)

    expect(result.current).not.toBeNull()
    expect(result.current!.kind).toBe('losing')
    expect(result.current!.span.length).toBe(4)
    expect(result.current!.span.iRatingDeltaSum).toBe(-60)
  })

  it('finds the longest slump and surge across the window', () => {
    // Sequence: surge(3) | slump(5) | surge(2) | slump(2) | surge(1)
    // (all oldest → newest). Longest slump = 5, longest surge = 3.
    const seq: { iRatingDelta: number; incidents: number }[] = [
      ...Array(3).fill({ iRatingDelta: 15, incidents: 1 }),
      ...Array(5).fill({ iRatingDelta: -10, incidents: 4 }),
      ...Array(2).fill({ iRatingDelta: 12, incidents: 2 }),
      ...Array(2).fill({ iRatingDelta: -8, incidents: 3 }),
      ...Array(1).fill({ iRatingDelta: 20, incidents: 0 }),
    ]
    const sessions = buildSessions(seq)
    const result = computeStreaks(sessions)

    expect(result.longestSlump).not.toBeNull()
    expect(result.longestSlump!.length).toBe(5)
    expect(result.longestSlump!.iRatingDeltaSum).toBe(-50)

    expect(result.longestSurge).not.toBeNull()
    expect(result.longestSurge!.length).toBe(3)
    expect(result.longestSurge!.iRatingDeltaSum).toBe(45)

    // Current = the most recent run, which is the trailing 1-race surge.
    expect(result.current!.kind).toBe('gaining')
    expect(result.current!.span.length).toBe(1)
  })

  it("treats a zero-delta race as 'flat' and breaks runs around it", () => {
    // Two gaining races, then a flat one, then two more gaining.
    // The flat breaks the run, so the longest gaining run is length 2,
    // and current = gaining (the trailing two), not a length-5 mega-run.
    const sessions = buildSessions([
      { iRatingDelta: 10, incidents: 1 },
      { iRatingDelta: 10, incidents: 1 },
      { iRatingDelta: 0, incidents: 0 },
      { iRatingDelta: 10, incidents: 1 },
      { iRatingDelta: 10, incidents: 1 },
    ])
    const result = computeStreaks(sessions)
    expect(result.longestSurge!.length).toBe(2)
    expect(result.current!.kind).toBe('gaining')
    expect(result.current!.span.length).toBe(2)
  })

  it('records date ranges from the underlying session timestamps', () => {
    // 3 losses on consecutive days → span should run from oldest to newest.
    const sessions = buildSessions(
      Array.from({ length: 3 }, () => ({ iRatingDelta: -20, incidents: 5 })),
      new Date('2026-04-10T18:00:00Z'),
    )
    const result = computeStreaks(sessions)

    expect(result.longestSlump!.startDate).toBe('2026-04-10T18:00:00.000Z')
    expect(result.longestSlump!.endDate).toBe('2026-04-12T18:00:00.000Z')
  })
})

describe('computeDisciplineMix', () => {
  function withCategory(
    values: { iRatingDelta: number; incidents: number; category: string }[],
  ): ComposureSessionInput[] {
    const start = new Date('2026-04-01T18:00:00Z').getTime()
    return values.map((v, i) => ({
      date: new Date(start + i * 86400000).toISOString(),
      iRatingDelta: v.iRatingDelta,
      incidents: v.incidents,
      category: v.category,
    }))
  }

  it('returns empty sentinel for empty input', () => {
    const result = computeDisciplineMix([])
    expect(result.total).toBe(0)
    expect(result.byCategory).toEqual([])
    expect(result.primary).toBeNull()
    expect(result.bestForRating).toBeNull()
  })

  it('groups by category and sums totals', () => {
    const sessions = withCategory([
      ...Array(6).fill({ iRatingDelta: 10, incidents: 2, category: 'road' }),
      ...Array(3).fill({ iRatingDelta: 30, incidents: 1, category: 'oval' }),
      ...Array(1).fill({ iRatingDelta: -5, incidents: 4, category: 'formula' }),
    ])
    const result = computeDisciplineMix(sessions)

    expect(result.total).toBe(10)
    expect(result.byCategory).toHaveLength(3)
    // Sorted by count desc.
    expect(result.byCategory[0].category).toBe('road')
    expect(result.byCategory[0].count).toBe(6)
    expect(result.byCategory[0].proportion).toBeCloseTo(0.6)
    expect(result.byCategory[1].category).toBe('oval')
    expect(result.byCategory[1].count).toBe(3)
  })

  it('reports primary by count and bestForRating by avg iR delta', () => {
    // Driver races a lot of road for modest gains, but their oval
    // average (where they have 3+ races) is much stronger per race.
    const sessions = withCategory([
      ...Array(20).fill({ iRatingDelta: 5, incidents: 2, category: 'road' }),
      ...Array(5).fill({ iRatingDelta: 40, incidents: 1, category: 'oval' }),
    ])
    const result = computeDisciplineMix(sessions)

    expect(result.primary).toBe('road')
    expect(result.bestForRating).toBe('oval')
  })

  it('ignores low-sample disciplines for bestForRating', () => {
    // 1 fluke +200 race in 'dirt-oval' shouldn't claim bestForRating
    // over the steady road history.
    const sessions = withCategory([
      ...Array(20).fill({ iRatingDelta: 10, incidents: 2, category: 'road' }),
      { iRatingDelta: 200, incidents: 0, category: 'dirt-oval' },
    ])
    const result = computeDisciplineMix(sessions)
    expect(result.primary).toBe('road')
    expect(result.bestForRating).toBe('road')
  })

  it("buckets sessions without a category under 'unknown'", () => {
    const sessions: ComposureSessionInput[] = [
      { date: '2026-04-01T18:00:00Z', iRatingDelta: 10, incidents: 1 },
      { date: '2026-04-02T18:00:00Z', iRatingDelta: 10, incidents: 1 },
    ]
    const result = computeDisciplineMix(sessions)
    expect(result.byCategory).toHaveLength(1)
    expect(result.byCategory[0].category).toBe('unknown')
  })

  it('embeds a per-discipline Composure score in each slice', () => {
    const sessions = withCategory([
      // Road: clean climber → high composure
      ...Array(10).fill({ iRatingDelta: 25, incidents: 1, category: 'road' }),
      // Oval: dirty bleeder → low composure
      ...Array(10).fill({ iRatingDelta: -25, incidents: 8, category: 'oval' }),
    ])
    const result = computeDisciplineMix(sessions)

    const road = result.byCategory.find((s) => s.category === 'road')!
    const oval = result.byCategory.find((s) => s.category === 'oval')!

    expect(road.composure.score).toBeGreaterThan(oval.composure.score)
    expect(road.composure.band).toBe('untouchable')
    expect(oval.composure.band).toBe('gritty')
  })
})

describe('computeComposureSeries', () => {
  it('returns empty result for empty input', () => {
    const result = computeComposureSeries([])
    expect(result.points).toEqual([])
    expect(result.minScore).toBe(0)
    expect(result.maxScore).toBe(100)
  })

  it('emits one point per session in chronological order', () => {
    const sessions = buildSessions([
      { iRatingDelta: 10, incidents: 1 },
      { iRatingDelta: 15, incidents: 1 },
      { iRatingDelta: 5,  incidents: 2 },
    ])
    const result = computeComposureSeries(sessions)
    expect(result.points).toHaveLength(3)
    // Series is asc by date — first point is the oldest race.
    const dates = result.points.map((p) => new Date(p.date).getTime())
    expect(dates).toEqual([...dates].sort((a, b) => a - b))
  })

  it('sample size grows up to windowSize then plateaus', () => {
    const sessions = buildSessions(
      Array.from({ length: 10 }, () => ({ iRatingDelta: 10, incidents: 1 })),
    )
    const result = computeComposureSeries(sessions, { windowSize: 5 })
    const sizes = result.points.map((p) => p.sampleSize)
    // Grows 1..5, then stays at 5.
    expect(sizes).toEqual([1, 2, 3, 4, 5, 5, 5, 5, 5, 5])
  })

  it('reflects an improving trajectory in score progression', () => {
    // Start with dirty races, end clean — last point should beat first.
    const sessions = buildSessions([
      ...Array(8).fill({ iRatingDelta: -20, incidents: 6 }),
      ...Array(8).fill({ iRatingDelta:  20, incidents: 1 }),
    ])
    const result = computeComposureSeries(sessions, { windowSize: 4 })
    expect(result.points[result.points.length - 1].score)
      .toBeGreaterThan(result.points[0].score)
    expect(result.maxScore).toBeGreaterThanOrEqual(result.minScore)
  })
})

describe('computeTrajectory', () => {
  it('returns plateau sentinel for empty input', () => {
    const result = computeTrajectory([])
    expect(result.direction).toBe('plateau')
    expect(result.sampleSize).toBe(0)
    expect(result.iRatingPerRace).toBe(0)
    expect(result.horizons).toHaveLength(3)
    expect(result.horizons.map((h) => h.days)).toEqual([7, 30, 90])
    for (const h of result.horizons) {
      expect(h.expectedDelta).toBe(0)
      expect(h.variance).toBe(0)
    }
  })

  it("flags 'climbing' when recent average is positive", () => {
    const sessions = buildSessions(
      Array.from({ length: 12 }, () => ({ iRatingDelta: 18, incidents: 1 })),
    )
    const result = computeTrajectory(sessions)
    expect(result.direction).toBe('climbing')
    expect(result.iRatingPerRace).toBeCloseTo(18, 0)
    // 30-day expected delta should be positive and 90-day should be larger.
    const h30 = result.horizons.find((h) => h.days === 30)!
    const h90 = result.horizons.find((h) => h.days === 90)!
    expect(h30.expectedDelta).toBeGreaterThan(0)
    expect(h90.expectedDelta).toBeGreaterThan(h30.expectedDelta)
  })

  it("flags 'falling' when recent average is meaningfully negative", () => {
    const sessions = buildSessions(
      Array.from({ length: 12 }, () => ({ iRatingDelta: -22, incidents: 5 })),
    )
    const result = computeTrajectory(sessions)
    expect(result.direction).toBe('falling')
    expect(result.iRatingPerRace).toBeLessThan(0)
    expect(result.horizons.find((h) => h.days === 30)!.expectedDelta).toBeLessThan(0)
  })

  it('plateaus around zero rate', () => {
    // Mix of small +/- moves; mean rate well within ±2 iR / race.
    const sessions = buildSessions([
      { iRatingDelta:  1, incidents: 2 },
      { iRatingDelta: -1, incidents: 2 },
      { iRatingDelta:  2, incidents: 2 },
      { iRatingDelta: -1, incidents: 2 },
      { iRatingDelta:  1, incidents: 2 },
      { iRatingDelta: -2, incidents: 2 },
    ])
    const result = computeTrajectory(sessions)
    expect(result.direction).toBe('plateau')
  })

  it('variance widens with horizon length', () => {
    const sessions = buildSessions(
      // High variance: 50 / -50 / 50 / -50 — same mean as 0, big sigma.
      Array.from({ length: 10 }, (_, i) => ({
        iRatingDelta: i % 2 === 0 ? 50 : -50,
        incidents: 3,
      })),
    )
    const result = computeTrajectory(sessions)
    const h7  = result.horizons.find((h) => h.days === 7)!
    const h30 = result.horizons.find((h) => h.days === 30)!
    const h90 = result.horizons.find((h) => h.days === 90)!
    expect(h30.variance).toBeGreaterThan(h7.variance)
    expect(h90.variance).toBeGreaterThan(h30.variance)
  })
})
