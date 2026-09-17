import { describe, it, expect } from 'vitest'
import { toIRacingSchedule, eligible, idFor, type SeasonScheduleJson } from '../../src/local/schedule'

function week(over: Partial<SeasonScheduleJson['series'][0]['weeks'][0]> = {}) {
  return {
    week: 1,
    startsOn: '2026-09-15',
    trackName: 'Oulton Park Circuit',
    trackConfig: 'Fosters',
    raceMinutes: 15,
    raceLaps: 0,
    heatFormat: null,
    cars: [],
    simTimeOfDay: '2026-09-19 12:00 1x',
    conditions: '69°F/20°C, Rain chance None, 15 mins',
    ...over,
  }
}

function series(over: Partial<SeasonScheduleJson['series'][0]> = {}): SeasonScheduleJson['series'][0] {
  return {
    id: 1,
    season: '2026 Season 4',
    name: 'Caterham Academy Challenge',
    category: 'sports_car',
    licenseClass: 'D',
    minLicenseClass: 'Rookie',
    minLicenseLevel: 4,
    fixedSetup: false,
    multiclass: false,
    carsVaryByWeek: false,
    cars: ['Caterham Academy'],
    timingText: 'Races every hour at :00',
    repeatMinutes: 60,
    minuteOffsets: [0],
    hourParity: null,
    weeklySlots: [],
    alternateWeeks: false,
    minEntries: 6,
    splitAt: 24,
    drops: 4,
    incidentLimit: 17,
    driveThroughPenalties: false,
    weeks: [week()],
    ...over,
  }
}

const schedule = (over: Partial<SeasonScheduleJson> = {}): SeasonScheduleJson => ({
  season: '2026 Season 4',
  series: [series()],
  ...over,
})

describe('toIRacingSchedule', () => {
  it('maps a weekly series into the engine shape', () => {
    const [s] = toIRacingSchedule(schedule())
    expect(s.series_name).toBe('Caterham Academy Challenge')
    expect(s.official).toBe(true)
    expect(s.fixed_setup).toBe(false)
    expect(s.license_group_name).toBe('Class D')
    expect(s.min_license_level).toBe(1) // "Rookie (4.0)" — a rookie may enter
    expect(s.start_date).toBe('2026-09-15')
    expect(s.car_classes).toEqual([{ short_name: 'Caterham Academy', name: 'Caterham Academy', car_class_id: idFor('Caterham Academy') }])

    const [item] = s.schedules
    expect(item.race_week_num).toBe(0)
    expect(item.track).toEqual({ track_id: idFor('Oulton Park Circuit|Fosters'), track_name: 'Oulton Park Circuit', config_name: 'Fosters', category: 'sports_car' })
    expect(item.race_time_limit).toBe(15)
    expect(item.race_lap_limit).toBeUndefined()
    expect(item.race_time_descriptors).toEqual([
      { repeating: true, session_minutes: 15, repeat_minutes: 60, first_session_time: '00:00:00', day_offset: [0, 1, 2, 3, 4, 5, 6] },
    ])
  })

  it('numbers weeks from the season start, so fortnightly series keep their gaps', () => {
    const [s] = toIRacingSchedule(schedule({
      series: [series({
        weeks: [week({ week: 1, startsOn: '2026-03-21' }), week({ week: 2, startsOn: '2026-04-04' }), week({ week: 3, startsOn: '2026-04-25' })],
      })],
    }))
    expect(s.schedules.map(x => x.race_week_num)).toEqual([0, 2, 5])
  })

  it('turns an every-two-hours-at-:15 series into one repeating descriptor', () => {
    const [s] = toIRacingSchedule(schedule({ series: [series({ repeatMinutes: 120, minuteOffsets: [15], timingText: 'Races every 2 hours at :15 past' })] }))
    expect(s.schedules[0].race_time_descriptors).toEqual([
      { repeating: true, session_minutes: 15, repeat_minutes: 120, first_session_time: '00:15:00', day_offset: [0, 1, 2, 3, 4, 5, 6] },
    ])
  })

  it('starts odd-hour series at 01:00', () => {
    const [s] = toIRacingSchedule(schedule({ series: [series({ repeatMinutes: 120, minuteOffsets: [0], hourParity: 'odd' })] }))
    expect(s.schedules[0].race_time_descriptors[0].first_session_time).toBe('01:00:00')
  })

  it('expands a weekend series\' GMT slots into that week\'s actual times', () => {
    const [s] = toIRacingSchedule(schedule({
      series: [series({
        repeatMinutes: 0,
        minuteOffsets: [],
        timingText: 'Races on Saturday at 7 & 17:00 GMT & Sunday at 0 & 13 GMT',
        weeklySlots: ['Sat 07:00', 'Sat 17:00', 'Sun 00:00', 'Sun 13:00'],
        weeks: [week({ startsOn: '2026-09-15', raceMinutes: 240 })],
      })],
    }))
    const [descriptor] = s.schedules[0].race_time_descriptors
    expect(descriptor.repeating).toBe(false)
    expect(descriptor.session_minutes).toBe(240)
    // The week is dated Tuesday 15 September; its Saturday is the 19th and its Sunday the 20th.
    expect(descriptor.session_times).toEqual([
      '2026-09-19T07:00:00.000Z',
      '2026-09-19T17:00:00.000Z',
      '2026-09-20T00:00:00.000Z',
      '2026-09-20T13:00:00.000Z',
    ])
  })

  it('leaves championship series with no computable start time', () => {
    const [s] = toIRacingSchedule(schedule({
      series: [series({ repeatMinutes: 0, minuteOffsets: [], weeklySlots: [], timingText: '5 Timeslots Per Week' })],
    }))
    expect(s.schedules[0].race_time_descriptors).toEqual([])
  })

  it('carries a rotating series\' car of the week', () => {
    const [s] = toIRacingSchedule(schedule({
      series: [series({ cars: [], carsVaryByWeek: true, weeks: [week({ cars: ['Caterham 420R'], raceMinutes: 0, raceLaps: 3 })] })],
    }))
    expect(s.schedules[0].car_classes).toEqual([{ short_name: 'Caterham 420R', name: 'Caterham 420R', car_class_id: idFor('Caterham 420R') }])
    expect(s.schedules[0].race_lap_limit).toBe(3)
  })

  it('is empty for no schedule', () => {
    expect(toIRacingSchedule(null)).toEqual([])
    expect(toIRacingSchedule({ season: null, series: [] })).toEqual([])
  })
})

describe('eligible', () => {
  it('drops series above the driver\'s licence in that category', () => {
    const all = toIRacingSchedule(schedule({
      series: [
        series({ name: 'Rookie Cup', licenseClass: 'R', minLicenseClass: 'Rookie', minLicenseLevel: 1 }),
        series({ name: 'Class B Sprint', licenseClass: 'B', minLicenseClass: 'Class C', minLicenseLevel: 4 }),
      ],
    }))
    const names = eligible(all, [{ category: 'sports_car', license: 'D' }]).map(s => s.series_name)
    expect(names).toEqual(['Rookie Cup'])
    expect(eligible(all, [{ category: 'sports_car', license: 'A' }]).map(s => s.series_name)).toEqual(['Rookie Cup', 'Class B Sprint'])
  })
})
