/**
 * The stored season schedule (as `RacingDesk.Host` serves it at /data/schedule, parsed from iRacing's published
 * PDF) → the `IRacingSchedule` shape next-race-ideas was written against. iRacing's own ids aren't in the PDF,
 * so series, season, track and car-class ids are derived from their names: stable across parses, and only ever
 * compared with each other.
 */
import type { IRacingSchedule } from '../engines/next-race-ideas.js'

export interface ScheduleWeekJson {
  week: number
  startsOn: string | null
  trackName: string | null
  trackConfig: string | null
  raceMinutes: number
  raceLaps: number
  heatFormat: string | null
  cars: string[]
  simTimeOfDay: string | null
  conditions: string | null
}

export interface ScheduleSeriesJson {
  id: number
  season: string | null
  name: string
  category: string | null
  licenseClass: string | null
  minLicenseClass: string | null
  minLicenseLevel: number
  fixedSetup: boolean
  multiclass: boolean
  carsVaryByWeek: boolean
  cars: string[]
  timingText: string | null
  repeatMinutes: number
  minuteOffsets: number[]
  hourParity: string | null
  weeklySlots: string[]
  alternateWeeks: boolean
  minEntries: number
  splitAt: number
  drops: number
  incidentLimit: number
  driveThroughPenalties: boolean
  weeks: ScheduleWeekJson[]
}

export interface SeasonScheduleJson {
  season: string | null
  sourceFile?: string | null
  sourceUrl?: string | null
  fetchedAt?: string | null
  parsedAt?: string | null
  series: ScheduleSeriesJson[]
}

const DAY = 24 * 60 * 60 * 1000
const WEEK = 7 * DAY

/** iRacing's licence classes as the levels next-race-ideas compares against. */
const LICENSE_LEVEL: Record<string, number> = { R: 1, D: 5, C: 9, B: 13, A: 17, P: 21 }
const LICENSE_NAME: Record<string, string> = {
  R: 'Rookie', D: 'Class D', C: 'Class C', B: 'Class B', A: 'Class A', P: 'Pro',
}
const SHORT_DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** A small stable hash, so the same name always yields the same id. */
export function idFor(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 1_000_000_007
}

function carClasses(names: string[]) {
  return names.map(name => ({ short_name: name, name, car_class_id: idFor(name) }))
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "2026-09-15" + Saturday 09:00 → the Saturday inside that iRacing week, in UTC. */
function slotTime(weekStart: string, slot: string): string | null {
  const parsed = /^(?<day>[A-Za-z]{3})\s+(?<h>\d{1,2}):(?<m>\d{2})$/.exec(slot.trim())
  const startMs = Date.parse(`${weekStart}T00:00:00Z`)
  if (!parsed || Number.isNaN(startMs)) return null
  const day = SHORT_DAYS[parsed.groups!.day]
  if (day === undefined) return null
  // A week begins on the Tuesday it is dated; a Sunday slot is five days later, not two days earlier.
  const offset = (day - new Date(startMs).getUTCDay() + 7) % 7
  return new Date(startMs + offset * DAY + Number(parsed.groups!.h) * 3600e3 + Number(parsed.groups!.m) * 60e3).toISOString()
}

function descriptors(series: ScheduleSeriesJson, week: ScheduleWeekJson) {
  const sessionMinutes = week.raceMinutes || 0
  if (series.repeatMinutes > 0) {
    const offsets = series.minuteOffsets.length ? series.minuteOffsets : [0]
    // Offsets an interval apart are the same recurrence seen from different starting points; keep the first.
    const starts = series.repeatMinutes <= 60 ? offsets.slice(0, 1) : offsets
    const firstHour = series.hourParity === 'odd' ? 1 : 0
    return starts.map(minute => ({
      repeating: true,
      session_minutes: sessionMinutes,
      repeat_minutes: series.repeatMinutes,
      first_session_time: `${pad(firstHour)}:${pad(minute)}:00`,
      day_offset: [0, 1, 2, 3, 4, 5, 6],
    }))
  }
  if (series.weeklySlots.length > 0 && week.startsOn) {
    const times = series.weeklySlots.map(slot => slotTime(week.startsOn!, slot)).filter((t): t is string => !!t)
    return times.length ? [{ repeating: false, session_minutes: sessionMinutes, session_times: times }] : []
  }
  // Championship series print "5 Timeslots Per Week" without saying when: nothing to compute a next start from.
  return []
}

export function toIRacingSchedule(schedule: SeasonScheduleJson | null | undefined): IRacingSchedule[] {
  if (!schedule?.series?.length) return []
  const seasonId = idFor(schedule.season ?? 'unknown')

  return schedule.series.map(series => {
    const weeks = [...series.weeks].sort((a, b) => a.week - b.week)
    const startDate = weeks.find(w => w.startsOn)?.startsOn ?? null
    const startMs = startDate ? Date.parse(`${startDate}T00:00:00Z`) : NaN
    const licenseClass = series.licenseClass ?? 'R'

    return {
      season_id: seasonId + series.id,
      series_id: idFor(series.name),
      series_name: series.name,
      season_name: `${series.name} - ${schedule.season ?? ''}`.trim(),
      official: true,
      fixed_setup: series.fixedSetup,
      license_group: LICENSE_LEVEL[licenseClass] ?? 1,
      license_group_name: LICENSE_NAME[licenseClass] ?? licenseClass,
      // The PDF's licence range is the floor to enter, which is what a suggestion has to respect.
      min_license_level: series.minLicenseLevel > 0 && series.minLicenseClass
        ? (LICENSE_LEVEL[classLetter(series.minLicenseClass)] ?? 1)
        : LICENSE_LEVEL[licenseClass] ?? 1,
      track_types: [{ track_type: series.category ?? 'road' }],
      car_classes: carClasses(series.cars),
      start_date: startDate ?? '',
      schedules: weeks.map(week => ({
        // Weeks are numbered from the season's first, so a series that races fortnightly keeps its real gaps.
        race_week_num: Number.isNaN(startMs) || !week.startsOn
          ? week.week - 1
          : Math.round((Date.parse(`${week.startsOn}T00:00:00Z`) - startMs) / WEEK),
        track: {
          track_id: idFor(`${week.trackName ?? ''}|${week.trackConfig ?? ''}`),
          track_name: week.trackName ?? '',
          config_name: week.trackConfig,
          category: series.category ?? 'road',
        },
        race_time_descriptors: descriptors(series, week),
        ...(week.raceLaps > 0 ? { race_lap_limit: week.raceLaps } : {}),
        ...(week.raceMinutes > 0 ? { race_time_limit: week.raceMinutes } : {}),
        ...(week.cars.length > 0 ? { car_classes: carClasses(week.cars) } : {}),
      })),
    }
  })
}

/** "Rookie" → R, "Class D" → D. */
function classLetter(minLicenseClass: string): string {
  const named = Object.entries(LICENSE_NAME).find(([, name]) => name.toLowerCase() === minLicenseClass.toLowerCase())
  if (named) return named[0]
  const letter = /\b([RDCBAP])\b/.exec(minLicenseClass.toUpperCase())
  return letter ? letter[1] : 'R'
}

/** The series a driver is eligible for, given their current licence in each category. */
export function eligible(
  schedule: IRacingSchedule[],
  ratings: Array<{ category: string; license: string }>,
): IRacingSchedule[] {
  const byCategory = new Map(ratings.map(r => [r.category, LICENSE_LEVEL[classLetter(r.license)] ?? 1]))
  return schedule.filter(series => {
    const category = series.track_types[0]?.track_type ?? 'road'
    const level = byCategory.get(category)
    return level === undefined || level >= series.min_license_level
  })
}
