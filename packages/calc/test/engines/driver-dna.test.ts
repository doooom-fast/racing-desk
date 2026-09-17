/**
 * driver-dna safety-net snapshots.
 *
 * Locks the current behavior of computeDriverDNA + getDriverArchetype + generateInsights
 * so the upcoming web → web-api migration can be validated against deterministic
 * outputs. If a snapshot changes, the migration changed observable behavior — that's
 * either a bug or an intentional change that must be reviewed and re-locked.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeDriverDNA, getDriverArchetype, generateInsights } from '../../src/engines/driver-dna'
import { emptyDriver, singleTrackSpecialist, rookie, veteran, allRounder } from './__helpers__/fixtures'

const REAL_FIXTURES = join(__dirname, '..', 'fixtures', 'real')

interface RealSession {
  carModel: string
  trackName: string | null
  gameName: string | null
  finishPosition: number | null
  incidentCount: number | null
  metadata: Record<string, unknown> | null
  createdAt: string
}
interface RealRating {
  iRating: number
  prevIRating: number | null
  createdAt: string
}

const realSessions: RealSession[] = JSON.parse(
  readFileSync(join(REAL_FIXTURES, 'admin-sessions.json'), 'utf8'),
)
const realRatings: RealRating[] = JSON.parse(
  readFileSync(join(REAL_FIXTURES, 'admin-rating-history.json'), 'utf8'),
)

// driver-dna's RatingData expects { iRating, prevIRating, createdAt } — admin-rating-history.json
// has those plus extras. Strip down so we exercise only the fields the calc uses.
const realRatingInput = realRatings.map((r) => ({
  iRating: r.iRating,
  prevIRating: r.prevIRating,
  createdAt: r.createdAt,
}))

// Synthetic builders return Date objects; driver-dna's interface declares createdAt: string.
// The implementation just feeds it into new Date(), so either works at runtime, but the typed
// interface prefers strings. Coerce for synthetic fixtures.
function toDnaSessions<T extends { createdAt: Date }>(sessions: T[]) {
  return sessions.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }))
}
function toDnaRatings<T extends { createdAt: Date }>(ratings: T[]) {
  return ratings.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
}

describe('driver-dna — real admin fixture', () => {
  const dna = computeDriverDNA(realSessions, realRatingInput)
  const archetype = getDriverArchetype(dna)
  const insights = generateInsights(dna, realSessions, realRatingInput)

  it('DNA scores match snapshot', () => {
    expect(dna).toMatchSnapshot()
  })
  it('archetype matches snapshot', () => {
    expect(archetype).toMatchSnapshot()
  })
  it('insights match snapshot', () => {
    expect(insights).toMatchSnapshot()
  })
})

describe('driver-dna — synthetic edge cases', () => {
  it('emptyDriver: no sessions, no ratings → all defaults', () => {
    const dna = computeDriverDNA(toDnaSessions(emptyDriver.sessions), toDnaRatings(emptyDriver.ratings))
    expect(dna).toMatchSnapshot()
    expect(getDriverArchetype(dna)).toMatchSnapshot()
  })

  it('singleTrackSpecialist: 30 races at one track', () => {
    const dna = computeDriverDNA(toDnaSessions(singleTrackSpecialist.sessions), toDnaRatings(singleTrackSpecialist.ratings))
    expect(dna).toMatchSnapshot()
    expect(getDriverArchetype(dna)).toMatchSnapshot()
  })

  it('rookie: 5 sessions, no rating history', () => {
    const dna = computeDriverDNA(toDnaSessions(rookie.sessions), toDnaRatings(rookie.ratings))
    expect(dna).toMatchSnapshot()
    expect(getDriverArchetype(dna)).toMatchSnapshot()
  })

  it('veteran: 80 sessions, long rating history', () => {
    const dna = computeDriverDNA(toDnaSessions(veteran.sessions), toDnaRatings(veteran.ratings))
    expect(dna).toMatchSnapshot()
    expect(getDriverArchetype(dna)).toMatchSnapshot()
  })

  it('allRounder: even spread, flat rating', () => {
    const dna = computeDriverDNA(toDnaSessions(allRounder.sessions), toDnaRatings(allRounder.ratings))
    expect(dna).toMatchSnapshot()
    expect(getDriverArchetype(dna)).toMatchSnapshot()
  })
})
