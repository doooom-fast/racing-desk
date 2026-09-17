/**
 * Shared synthetic-fixture builders for the calc-module safety-net snapshot tests.
 *
 * Real-data fixtures live as JSON under __fixtures__/real/ and are loaded
 * directly by individual tests. The builders here cover edge cases real
 * data can't hit reliably: empty driver, single-track specialist, rookie,
 * veteran, max-iRating, etc.
 *
 * All builders are deterministic — same inputs produce identical output —
 * so snapshots are stable across runs.
 */

const BASE_DATE = new Date('2026-03-01T12:00:00Z')

export interface SyntheticSession {
  id: string
  carModel: string
  manufacturer: string
  category: string
  gameName: string
  trackId: string | null
  trackName: string
  sessionType: string
  finishPosition: number | null
  incidentCount: number
  metadata: Record<string, unknown> | null
  createdAt: Date
}

export interface SyntheticRating {
  category: string
  iRating: number
  safetyRating: string
  license: string
  prevIRating: number | null
  prevSafetyRating: string | null
  prevLicense: string | null
  sessionType: string | null
  trackName: string | null
  carModel: string | null
  createdAt: Date
}

interface SessionOpts {
  index?: number
  car?: string
  manufacturer?: string
  category?: string
  game?: string
  track?: string
  type?: string
  finishPosition?: number | null
  incidents?: number
  completedLaps?: number
  daysOffset?: number
  hourUtc?: number
}

/**
 * Build a synthetic session. Every option has a sensible default so tests
 * only have to specify what matters for the case they're locking down.
 */
export function makeSession(opts: SessionOpts = {}): SyntheticSession {
  const i = opts.index ?? 0
  const created = new Date(BASE_DATE)
  created.setUTCDate(created.getUTCDate() + (opts.daysOffset ?? i))
  if (opts.hourUtc !== undefined) created.setUTCHours(opts.hourUtc)

  return {
    id: `synth-sess-${String(i).padStart(4, '0')}`,
    carModel: opts.car ?? 'BMW M4 GT3',
    manufacturer: opts.manufacturer ?? 'BMW',
    category: opts.category ?? 'road',
    gameName: opts.game ?? 'iracing',
    trackId: null,
    trackName: opts.track ?? 'Spa',
    sessionType: opts.type ?? 'race',
    finishPosition: opts.finishPosition ?? 10,
    incidentCount: opts.incidents ?? 2,
    metadata: { completedLaps: opts.completedLaps ?? 20 },
    createdAt: created,
  }
}

interface RatingOpts {
  index?: number
  category?: string
  iRating: number
  prevIRating?: number | null
  license?: string
  prevLicense?: string | null
  sessionType?: string
  daysOffset?: number
}

export function makeRating(opts: RatingOpts): SyntheticRating {
  const i = opts.index ?? 0
  const created = new Date(BASE_DATE)
  created.setUTCDate(created.getUTCDate() + (opts.daysOffset ?? i))

  return {
    category: opts.category ?? 'road',
    iRating: opts.iRating,
    safetyRating: '3.50',
    license: opts.license ?? 'B',
    prevIRating: opts.prevIRating ?? null,
    prevSafetyRating: '3.50',
    prevLicense: opts.prevLicense ?? null,
    sessionType: opts.sessionType ?? 'race',
    trackName: 'Spa',
    carModel: 'BMW M4 GT3',
    createdAt: created,
  }
}

// ── Pre-baked driver profiles ──────────────────────────────────────────────

/** Driver with no sessions and no ratings. Tests every "what if N=0" branch. */
export const emptyDriver = {
  sessions: [] as SyntheticSession[],
  ratings: [] as SyntheticRating[],
}

/** Single-track specialist: 30 races at one track in one car. */
export const singleTrackSpecialist = {
  sessions: Array.from({ length: 30 }, (_, i) =>
    makeSession({
      index: i,
      track: 'Watkins Glen',
      car: 'Mazda MX-5',
      manufacturer: 'Mazda',
      finishPosition: 4 + (i % 6),
      incidents: i % 3,
      completedLaps: 18,
    }),
  ),
  ratings: Array.from({ length: 30 }, (_, i) =>
    makeRating({
      index: i,
      iRating: 1500 + i * 10,
      prevIRating: i === 0 ? null : 1500 + (i - 1) * 10,
    }),
  ),
}

/** Rookie: 5 sessions, low experience, no rating history. */
export const rookie = {
  sessions: Array.from({ length: 5 }, (_, i) =>
    makeSession({
      index: i,
      track: ['Lime Rock', 'Summit Point', 'Oran Park'][i % 3],
      car: 'Mazda MX-5',
      manufacturer: 'Mazda',
      finishPosition: 12 + (i % 5),
      incidents: 4 + (i % 3),
      completedLaps: 8,
    }),
  ),
  ratings: [] as SyntheticRating[],
}

/** Veteran: 80 sessions across many tracks/cars, long rating history. */
export const veteran = {
  sessions: Array.from({ length: 80 }, (_, i) => {
    const tracks = ['Spa', 'Monza', 'Suzuka', 'Watkins Glen', 'Road America', 'Nordschleife', 'Bathurst', 'Daytona', 'Sebring', 'Le Mans']
    const cars = ['BMW M4 GT3', 'Ferrari 296 GT3', 'Porsche 911 GT3 R', 'Audi R8 LMS', 'Mercedes-AMG GT3']
    const mfrs = ['BMW', 'Ferrari', 'Porsche', 'Audi', 'Mercedes-AMG']
    const carIdx = i % cars.length
    return makeSession({
      index: i,
      track: tracks[i % tracks.length],
      car: cars[carIdx],
      manufacturer: mfrs[carIdx],
      finishPosition: i % 11 === 0 ? 1 : (i % 7 === 0 ? 2 : 3 + (i % 8)),
      incidents: i % 5,
      completedLaps: 22 + (i % 30),
    })
  }),
  ratings: Array.from({ length: 80 }, (_, i) =>
    makeRating({
      index: i,
      iRating: 2500 + Math.floor(i * 5.5),
      prevIRating: i === 0 ? null : 2500 + Math.floor((i - 1) * 5.5),
      license: 'A',
    }),
  ),
}

/** All-rounder: even spread across cars, tracks, and finish positions. */
export const allRounder = {
  sessions: Array.from({ length: 40 }, (_, i) => {
    const tracks = ['Spa', 'Monza', 'Suzuka', 'Watkins Glen']
    const cars = ['BMW M4 GT3', 'Ferrari 296 GT3', 'Porsche 911 GT3 R', 'Audi R8 LMS']
    const mfrs = ['BMW', 'Ferrari', 'Porsche', 'Audi']
    return makeSession({
      index: i,
      track: tracks[i % 4],
      car: cars[i % 4],
      manufacturer: mfrs[i % 4],
      finishPosition: 5 + (i % 10),
      incidents: 1 + (i % 4),
      completedLaps: 25,
    })
  }),
  ratings: Array.from({ length: 40 }, (_, i) =>
    makeRating({
      index: i,
      iRating: 2000,
      prevIRating: i === 0 ? null : 2000,
    }),
  ),
}
