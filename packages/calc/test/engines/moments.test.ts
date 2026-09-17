/**
 * moments safety-net snapshots — locks detectMoments.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectMoments } from '../../src/engines/moments'
import { makeSession, makeRating } from './__helpers__/fixtures'

const REAL_FIXTURES = join(__dirname, '..', 'fixtures', 'real')

interface RealSession {
  id: string
  carModel: string
  trackName: string | null
  finishPosition: number | null
  incidentCount: number | null
  metadata: Record<string, unknown> | null
  createdAt: string
  gameName: string | null
  sessionType: string | null
}
interface RealRating {
  iRating: number
  prevIRating: number | null
  license: string
  prevLicense: string | null
  sessionType: string | null
  createdAt: string
}

const realSessionsRaw: RealSession[] = JSON.parse(
  readFileSync(join(REAL_FIXTURES, 'admin-sessions.json'), 'utf8'),
)
const realRatingsRaw: RealRating[] = JSON.parse(
  readFileSync(join(REAL_FIXTURES, 'admin-rating-history.json'), 'utf8'),
)

// detectMoments expects non-null trackName, gameName, sessionType, incidentCount.
// Drop invalid rows.
const realSessions = realSessionsRaw
  .filter((s) => s.trackName !== null && s.gameName !== null && s.sessionType !== null && s.incidentCount !== null)
  .map((s) => ({
    id: s.id,
    carModel: s.carModel,
    trackName: s.trackName!,
    finishPosition: s.finishPosition ?? undefined,
    incidentCount: s.incidentCount!,
    metadata: s.metadata as any,
    createdAt: new Date(s.createdAt),
    gameName: s.gameName!,
    sessionType: s.sessionType!,
  }))

const realRatings = realRatingsRaw
  .filter((r) => r.prevIRating !== null && r.prevLicense !== null)
  .map((r) => ({
    iRating: r.iRating,
    prevIRating: r.prevIRating!,
    license: r.license,
    prevLicense: r.prevLicense!,
    sessionType: r.sessionType ?? undefined,
    createdAt: new Date(r.createdAt),
  }))

describe('moments — real admin fixture', () => {
  it('detected moments match snapshot', () => {
    expect(detectMoments(realSessions, realRatings)).toMatchSnapshot()
  })
})

describe('moments — synthetic edge cases', () => {
  it('empty inputs return empty array', () => {
    expect(detectMoments([], [])).toEqual([])
  })

  it('win streak (3 wins in a row): snapshot', () => {
    const sessions = [
      makeSession({ index: 0, finishPosition: 1, incidents: 0 }),
      makeSession({ index: 1, finishPosition: 1, incidents: 1 }),
      makeSession({ index: 2, finishPosition: 1, incidents: 0 }),
      makeSession({ index: 3, finishPosition: 5, incidents: 2 }),
    ].map((s) => ({
      id: s.id,
      carModel: s.carModel,
      trackName: s.trackName,
      finishPosition: s.finishPosition ?? undefined,
      incidentCount: s.incidentCount,
      metadata: { completedLaps: 20 },
      createdAt: s.createdAt,
      gameName: s.gameName,
      sessionType: s.sessionType,
    }))
    expect(detectMoments(sessions, [])).toMatchSnapshot()
  })

  it('iRating milestone (2000): snapshot', () => {
    const ratings = [
      makeRating({ index: 0, iRating: 1900, prevIRating: 1850 }),
      makeRating({ index: 1, iRating: 2050, prevIRating: 1900 }),
    ].map((r) => ({
      iRating: r.iRating,
      prevIRating: r.prevIRating!,
      license: r.license,
      prevLicense: r.prevLicense ?? r.license,
      sessionType: r.sessionType ?? undefined,
      createdAt: r.createdAt,
    }))
    expect(detectMoments([], ratings)).toMatchSnapshot()
  })

  it('license promotion (D → C): snapshot', () => {
    const ratings = [
      makeRating({ index: 0, iRating: 1000, prevIRating: 950, license: 'C', prevLicense: 'D' }),
    ].map((r) => ({
      iRating: r.iRating,
      prevIRating: r.prevIRating!,
      license: r.license,
      prevLicense: r.prevLicense!,
      sessionType: r.sessionType ?? undefined,
      createdAt: r.createdAt,
    }))
    expect(detectMoments([], ratings)).toMatchSnapshot()
  })

  it('time-trial license noise is filtered: snapshot', () => {
    const ratings = [
      makeRating({ index: 0, iRating: 1000, prevIRating: 950, license: 'C', prevLicense: 'D', sessionType: 'time trial' }),
    ].map((r) => ({
      iRating: r.iRating,
      prevIRating: r.prevIRating!,
      license: r.license,
      prevLicense: r.prevLicense!,
      sessionType: r.sessionType ?? undefined,
      createdAt: r.createdAt,
    }))
    // No license_promotion moment should be emitted from time-trial data
    expect(detectMoments([], ratings)).toMatchSnapshot()
  })
})
