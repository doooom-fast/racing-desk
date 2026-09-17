/**
 * race-summary safety-net snapshots — locks generateRaceSummary.
 *
 * Fully synthetic: lap_telemetry and session_behavior are empty database-wide,
 * so there is no real-data path. These snapshots cover the major branches of
 * the generator (verdict selection, strengths/improvements composition, lap
 * analysis, composure report, track context, rating impact).
 */
import { describe, it, expect } from 'vitest'
import {
  generateRaceSummary,
  type RaceSessionInput,
  type LapTelemetryInput,
  type SessionBehaviorInput,
  type TrackHistoryInput,
  type RatingContext,
} from '../../src/engines/race-summary'

const BASE = new Date('2026-03-01T18:00:00Z')

function makeRaceSession(overrides: Partial<RaceSessionInput> = {}): RaceSessionInput {
  return {
    id: 'race-1',
    carModel: 'BMW M4 GT3',
    manufacturer: 'BMW',
    trackName: 'Spa',
    finishPosition: 5,
    incidentCount: 2,
    sessionType: 'race',
    category: 'road',
    metadata: { completedLaps: 20, fieldSize: 24 },
    createdAt: BASE,
    ...overrides,
  }
}

function makeLap(n: number, overrides: Partial<LapTelemetryInput> = {}): LapTelemetryInput {
  return {
    lapNumber: n,
    lapTime: 110.5 + (n % 5) * 0.3,
    sector1: 30.5,
    sector2: 40.0,
    sector3: 40.0 + (n % 5) * 0.3,
    incidentCount: 0,
    isCleanLap: true,
    rageScore: 10,
    throttleAggression: 5,
    steeringErraticism: 3,
    brakingAggression: 4,
    proximityChasing: 2,
    ...overrides,
  }
}

const cleanLaps: LapTelemetryInput[] = Array.from({ length: 20 }, (_, i) => makeLap(i + 1))

const noBehavior: SessionBehaviorInput | null = null
const cleanBehavior: SessionBehaviorInput = {
  hardBrakingEvents: 5,
  closePassCount: 3,
  tailgatingSeconds: 2.5,
  offTrackCount: 0,
  spinCount: 0,
  cleanLaps: 20,
  totalLaps: 20,
  peakRageScore: 18,
  avgRageScore: 8,
  rageSpikes: 0,
  cooldownsTriggered: 0,
  retaliationAttempts: 0,
  incidentsByPhase: { early: 0, mid: 0, late: 0 },
  incidentLocations: [],
  commentaryLog: [],
}
const noTrackHistory: TrackHistoryInput | null = null
const noRatingChange: RatingContext = {
  preRaceIRating: null,
  postRaceIRating: null,
  preRaceSR: null,
  postRaceSR: null,
  irDelta: null,
  srDelta: null,
}

describe('race-summary — branches', () => {
  it('dominant P1 victory with zero incidents', () => {
    const session = makeRaceSession({ finishPosition: 1, incidentCount: 0 })
    const summary = generateRaceSummary(session, cleanLaps, cleanBehavior, noTrackHistory, {
      ...noRatingChange,
      irDelta: 65,
      srDelta: 0.15,
    })
    expect(summary).toMatchSnapshot()
  })

  it('clean podium (P3, 1 incident)', () => {
    const session = makeRaceSession({ finishPosition: 3, incidentCount: 1 })
    expect(
      generateRaceSummary(session, cleanLaps, cleanBehavior, noTrackHistory, {
        ...noRatingChange,
        irDelta: 25,
        srDelta: 0.05,
      }),
    ).toMatchSnapshot()
  })

  it('DNF', () => {
    const session = makeRaceSession({ finishPosition: 0, incidentCount: 6 })
    expect(
      generateRaceSummary(session, cleanLaps.slice(0, 5), null, noTrackHistory, {
        ...noRatingChange,
        irDelta: -45,
        srDelta: -0.18,
      }),
    ).toMatchSnapshot()
  })

  it('practice session', () => {
    const session = makeRaceSession({ sessionType: 'practice', finishPosition: null, incidentCount: 0 })
    expect(
      generateRaceSummary(session, cleanLaps, null, null, noRatingChange),
    ).toMatchSnapshot()
  })

  it('high-incident race (≥8 incidents)', () => {
    const session = makeRaceSession({ finishPosition: 12, incidentCount: 9 })
    expect(
      generateRaceSummary(session, cleanLaps, {
        ...cleanBehavior,
        cleanLaps: 12,
        peakRageScore: 78,
        avgRageScore: 45,
        spinCount: 2,
        offTrackCount: 4,
        incidentsByPhase: { early: 6, mid: 2, late: 1 },
      }, noTrackHistory, {
        ...noRatingChange,
        irDelta: -70,
        srDelta: -0.22,
      }),
    ).toMatchSnapshot()
  })

  it('first-time-at-track narrative (positionTrend: first_time)', () => {
    const session = makeRaceSession({ finishPosition: 8, incidentCount: 1 })
    const trackHistory: TrackHistoryInput = {
      sessions: [],
      bestPosition: null,
      avgPosition: null,
      avgIncidents: 0,
      totalRaces: 1,
    }
    expect(
      generateRaceSummary(session, cleanLaps, cleanBehavior, trackHistory, noRatingChange),
    ).toMatchSnapshot()
  })

  it('personal best at track', () => {
    const session = makeRaceSession({ finishPosition: 2, incidentCount: 0 })
    const trackHistory: TrackHistoryInput = {
      sessions: [
        makeRaceSession({ id: 'h1', finishPosition: 7, createdAt: new Date('2026-02-01T18:00:00Z') }),
        makeRaceSession({ id: 'h2', finishPosition: 5, createdAt: new Date('2026-02-08T18:00:00Z') }),
      ],
      bestPosition: 5,
      avgPosition: 6.0,
      avgIncidents: 2.5,
      totalRaces: 5,
    }
    expect(
      generateRaceSummary(session, cleanLaps, cleanBehavior, trackHistory, {
        ...noRatingChange,
        irDelta: 38,
        srDelta: 0.08,
      }),
    ).toMatchSnapshot()
  })

  it('lap progression: late-race pace drop', () => {
    const degradingLaps: LapTelemetryInput[] = Array.from({ length: 18 }, (_, i) =>
      makeLap(i + 1, { lapTime: 108.0 + i * 0.15 }),
    )
    const session = makeRaceSession({ finishPosition: 6, incidentCount: 1 })
    expect(
      generateRaceSummary(session, degradingLaps, cleanBehavior, noTrackHistory, noRatingChange),
    ).toMatchSnapshot()
  })

  it('composure: high peak rage triggers improvement bullet', () => {
    const session = makeRaceSession({ finishPosition: 8, incidentCount: 4 })
    expect(
      generateRaceSummary(session, cleanLaps, {
        ...cleanBehavior,
        peakRageScore: 82,
        avgRageScore: 42,
        rageSpikes: 4,
      }, noTrackHistory, noRatingChange),
    ).toMatchSnapshot()
  })
})
