import { describe, it, expect } from 'vitest'
import { buildEvents, eventKind, parseLicense, iRatingDelta, safetyRatingDelta, isRatedRace, type LocalSessionRow } from '../../src/local/events'
import { buildDesk } from '../../src/local/desk'

let nextId = 1
function row(over: Partial<LocalSessionRow>): LocalSessionRow {
  return {
    id: nextId++, source: 'ibt', ibt_path: 'x.ibt', session_num: 2, subsession_id: 1000, session_id: 1, series_id: 526,
    season_id: 6454, race_week: 0, event_type: 'Race', session_type: 'Race', official: 1, category: 'SportsCar',
    track_id: 249, track_name: 'nurburgring nordschleife', track_display_name: 'Nordschleife', track_config: null,
    track_length_km: 20.8, car_path: 'caterham caterham420r', car_id: 218, car_screen_name: 'Caterham 420R', car_class_id: 4113,
    started_at: '2026-09-01T18:00:00.000Z', duration_s: 1200, driver_cust_id: 1, irating: 800, license: 'C 2.50',
    safety_rating: 2.5, laps_completed: 3, best_lap_s: 480, incidents: 2, start_position: 10, finish_position: 8,
    finish_position_in_class: 8, field_size: 24, sof: 1400,
    ...over,
  }
}

describe('eventKind / parseLicense', () => {
  it('classifies iRacing session types', () => {
    expect(eventKind('Race', 'Race')).toBe('race')
    expect(eventKind('Lone Qualify', 'Race')).toBe('qualifying')
    expect(eventKind('Lone Qualify', 'Time Attack')).toBe('time_attack')
    expect(eventKind('Practice', 'Practice')).toBe('practice')
    expect(eventKind('Warmup', 'Race')).toBe('warmup')
    expect(eventKind('Offline Testing', 'Test')).toBe('test')
  })
  it('splits licence class and SR', () => {
    expect(parseLicense('C 2.85')).toEqual({ licenseClass: 'C', safetyRating: 2.85 })
    expect(parseLicense('')).toEqual({ licenseClass: null, safetyRating: null })
  })
})

describe('buildEvents', () => {
  it('merges the stints of one session (a tow or rejoin writes a second .ibt)', () => {
    const events = buildEvents([
      row({ started_at: '2026-09-01T18:00:00.000Z', duration_s: 300, laps_completed: 1, best_lap_s: 490, incidents: 4, start_position: 10, finish_position: 0 }),
      row({ started_at: '2026-09-01T18:08:00.000Z', duration_s: 900, laps_completed: 2, best_lap_s: 481, incidents: 1, start_position: 0, finish_position: 12, field_size: 25 }),
    ])
    expect(events).toHaveLength(1)
    const e = events[0]
    expect(e.id).toBe('1000:2')
    expect(e.rowIds).toHaveLength(2)
    expect(e.laps).toBe(3)
    expect(e.incidents).toBe(5)
    expect(e.bestLapSeconds).toBe(481)
    expect(e.startPosition).toBe(10)
    expect(e.finishPosition).toBe(12)
    expect(e.fieldSize).toBe(25)
    expect(e.finishedAt).toBe('2026-09-01T18:23:00.000Z')
  })

  it('keeps offline sessions separate and unrated', () => {
    const events = buildEvents([
      row({ subsession_id: 0, official: 0, irating: 1, license: 'R 0.01', session_type: 'Offline Testing', event_type: 'Test' }),
      row({ subsession_id: 0, official: 0, irating: 1, license: 'R 0.01', session_type: 'Offline Testing', event_type: 'Test', started_at: '2026-09-01T19:00:00.000Z' }),
    ])
    expect(events).toHaveLength(2)
    expect(events.every(e => e.iRating == null && !isRatedRace(e))).toBe(true)
  })

  it('reads a race\'s rating change from the next session in the same category, skipping its own subsession', () => {
    const events = buildEvents([
      row({ subsession_id: 1, session_num: 0, session_type: 'Practice', started_at: '2026-09-01T17:50:00.000Z', irating: 800 }),
      row({ subsession_id: 1, session_num: 2, started_at: '2026-09-01T18:00:00.000Z', irating: 800, license: 'C 2.50', safety_rating: 2.5 }),
      // A formula race in between doesn't tell us anything about sports car ratings.
      row({ subsession_id: 2, category: 'Formula', started_at: '2026-09-02T18:00:00.000Z', irating: 1200, license: 'B 3.10', safety_rating: 3.1 }),
      row({ subsession_id: 3, session_num: 0, session_type: 'Practice', started_at: '2026-09-03T18:00:00.000Z', irating: 823, license: 'C 2.71', safety_rating: 2.71 }),
    ])
    const race = events.find(e => e.id === '1:2')!
    expect(iRatingDelta(race)).toBe(23)
    expect(safetyRatingDelta(race)).toBe(0.21)
    expect(iRatingDelta(events.find(e => e.id === '2:2')!)).toBeNull()
  })

  it('has no SR delta across a licence promotion', () => {
    const events = buildEvents([
      row({ subsession_id: 1, irating: 800, license: 'C 3.99', safety_rating: 3.99 }),
      row({ subsession_id: 2, started_at: '2026-09-02T18:00:00.000Z', irating: 810, license: 'B 3.00', safety_rating: 3.0 }),
    ])
    expect(iRatingDelta(events[0])).toBe(10)
    expect(safetyRatingDelta(events[0])).toBeNull()
    expect(events[0].licenseClassAfter).toBe('B')
  })
})

describe('buildDesk', () => {
  it('computes every section from local rows without engine errors', () => {
    const rows: LocalSessionRow[] = []
    const tracks = [['Nordschleife', 249], ['Oulton Park', 432], ['Virginia', 395]] as const
    for (let i = 0; i < 12; i++) {
      const [name, id] = tracks[i % 3]
      rows.push(row({
        subsession_id: 100 + i, track_display_name: name, track_id: id, irating: 800 + i * 5,
        started_at: new Date(Date.UTC(2026, 7, 1 + i, 1 + (i % 4))).toISOString(),
        finish_position: 1 + (i % 9), incidents: i % 5, car_screen_name: i % 2 ? 'Mclaren 570s GT4' : 'McLaren 720S GT3 EVO',
      }))
    }
    const desk = buildDesk(rows, { now: new Date('2026-09-01T02:00:00Z'), timeZone: 'America/Denver' })
    expect(desk.errors).toEqual({})
    expect(desk.stats.races).toBe(12)
    expect(desk.ratings).toEqual([{ category: 'sports_car', iRating: 855, safetyRating: '2.50', license: 'C' }])
    expect(desk.raceNow?.verdict).toBeTruthy()
    expect(desk.composure?.score.sampleSize).toBe(11)
    expect(desk.previousRaces).toHaveLength(12)
    expect(desk.mastery?.tracks).toHaveLength(3)
    expect(desk.mastery?.cars.map(c => c.manufacturer)).toEqual(['McLaren'])
    expect(desk.dna?.archetype.major).toBeTruthy()
    expect(desk.nextRaceIdeas).toBeNull()
  })
})
