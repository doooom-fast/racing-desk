/**
 * mastery safety-net snapshots — locks computeTrackMastery + computeCarAffinity.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeTrackMastery, computeCarAffinity } from '../../src/engines/mastery'
import { singleTrackSpecialist, rookie, veteran, allRounder } from './__helpers__/fixtures'

const REAL_FIXTURES = join(__dirname, '..', 'fixtures', 'real')

interface RealSession {
  id: string
  carModel: string
  manufacturer: string | null
  trackId: string | null
  trackName: string | null
  finishPosition: number | null
  incidentCount: number | null
  metadata: Record<string, unknown> | null
  createdAt: string
  gameName: string | null
}

const realSessionsRaw: RealSession[] = JSON.parse(
  readFileSync(join(REAL_FIXTURES, 'admin-sessions.json'), 'utf8'),
)

// computeTrackMastery / computeCarAffinity expect non-null trackName, manufacturer, gameName,
// and incidentCount. Drop sessions missing those — the module isn't designed to handle them.
const realSessions = realSessionsRaw
  .filter((s) => s.trackName !== null && s.gameName !== null && s.incidentCount !== null)
  .map((s) => ({
    id: s.id,
    carModel: s.carModel,
    manufacturer: s.manufacturer ?? '',
    trackId: s.trackId ?? null,
    trackName: s.trackName!,
    finishPosition: s.finishPosition,
    incidentCount: s.incidentCount!,
    metadata: s.metadata,
    createdAt: new Date(s.createdAt),
    gameName: s.gameName!,
  }))

describe('mastery — real admin fixture', () => {
  it('track mastery matches snapshot', () => {
    expect(computeTrackMastery(realSessions)).toMatchSnapshot()
  })
  it('car affinity matches snapshot', () => {
    expect(computeCarAffinity(realSessions)).toMatchSnapshot()
  })
})

describe('mastery — synthetic edge cases', () => {
  it('empty input returns empty arrays', () => {
    expect(computeTrackMastery([])).toEqual([])
    expect(computeCarAffinity([])).toEqual([])
  })

  it('singleTrackSpecialist: track mastery snapshot', () => {
    expect(computeTrackMastery(singleTrackSpecialist.sessions)).toMatchSnapshot()
  })
  it('singleTrackSpecialist: car affinity snapshot', () => {
    expect(computeCarAffinity(singleTrackSpecialist.sessions)).toMatchSnapshot()
  })

  it('rookie: track mastery snapshot', () => {
    expect(computeTrackMastery(rookie.sessions)).toMatchSnapshot()
  })
  it('rookie: car affinity snapshot', () => {
    expect(computeCarAffinity(rookie.sessions)).toMatchSnapshot()
  })

  it('veteran: track mastery snapshot', () => {
    expect(computeTrackMastery(veteran.sessions)).toMatchSnapshot()
  })
  it('veteran: car affinity snapshot', () => {
    expect(computeCarAffinity(veteran.sessions)).toMatchSnapshot()
  })

  it('allRounder: track mastery snapshot', () => {
    expect(computeTrackMastery(allRounder.sessions)).toMatchSnapshot()
  })
  it('allRounder: car affinity snapshot', () => {
    expect(computeCarAffinity(allRounder.sessions)).toMatchSnapshot()
  })

  // Generic-manufacturer extraction: production data has carModel like
  // "NASCAR Cup Toyota Camry" with manufacturer="Global". The module's
  // extractManufacturer logic strips series prefixes and resolves to "Toyota".
  it('generic-manufacturer car: extracts brand from car model', () => {
    const sessions = [{
      id: 'g1',
      carModel: 'NASCAR Cup Toyota Camry',
      manufacturer: 'Global',
      trackId: null,
      trackName: 'Daytona',
      finishPosition: 5,
      incidentCount: 2,
      metadata: { completedLaps: 30 },
      createdAt: new Date('2026-03-01T12:00:00Z'),
      gameName: 'iracing',
    }]
    expect(computeCarAffinity(sessions)).toMatchSnapshot()
  })
})
