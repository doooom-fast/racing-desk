/**
 * Everything the desk window shows, computed from the local store's session rows in one pass. Same gating
 * as the cloud dashboard had (When needs 5 races, DNA 3), same race-only rule for scores and verdicts.
 */
import { computeComposure, computeHeat, computeStreaks, computeDisciplineMix, computeTrajectory } from '../engines/composure.js'
import { computeWhenProfile } from '../engines/when-engine.js'
import { buildWhenPanelView } from '../engines/when-panel-view.js'
import { evaluateRaceNow } from '../engines/race-now-verdict.js'
import { buildPreviousRaceCards } from '../engines/previous-races.js'
import { computeTrackMastery, computeCarAffinity } from '../engines/mastery.js'
import { computeDriverDNA, getDriverArchetype, generateInsights } from '../engines/driver-dna.js'
import { detectMoments } from '../engines/moments.js'
import { buildScatterBuckets } from '../engines/scatter-view.js'
import { computeNextRaceIdeas } from '../engines/next-race-ideas.js'
import { toIRacingSchedule, eligible, type SeasonScheduleJson } from './schedule.js'
import { type LocalSessionRow, type DriveEvent, buildEvents, isRatedRace, iRatingDelta, safetyRatingDelta } from './events.js'
import {
  toRatingInputs, currentRatings, toPreviousRaceInput, toComposureInputs, toScatterInputs, toEngineSession,
  toMomentSession, toMomentRatings, toSessionInput,
} from './adapters.js'

export interface DeskOptions {
  now?: Date
  timeZone?: string
  /** The stored season schedule (/data/schedule). Next-race ideas are empty without it. */
  schedule?: SeasonScheduleJson | null
}

export interface CareerStats {
  races: number
  laps: number
  tracks: number
  cars: number
  wins: number
  podiums: number
  firstRaceAt: string | null
  lastRaceAt: string | null
  sessions: number
}

function careerStats(events: DriveEvent[], races: DriveEvent[]): CareerStats {
  return {
    races: races.length,
    laps: races.reduce((n, e) => n + e.laps, 0),
    tracks: new Set(races.map(e => e.trackId ?? e.trackName)).size,
    cars: new Set(races.map(e => e.carId ?? e.carName)).size,
    wins: races.filter(e => e.finishPosition === 1).length,
    podiums: races.filter(e => e.finishPosition != null && e.finishPosition <= 3).length,
    firstRaceAt: races[0]?.startedAt ?? null,
    lastRaceAt: races[races.length - 1]?.startedAt ?? null,
    sessions: events.length,
  }
}

/** Runs one section, so a throw in one engine leaves the rest of the desk intact. */
function section<T>(errors: Record<string, string>, name: string, fn: () => T): T | null {
  try {
    return fn()
  } catch (err) {
    errors[name] = err instanceof Error ? err.message : String(err)
    return null
  }
}

/** The disciplines the driver actually races, so suggestions don't wander into dirt they've never touched. */
export function activeCategories(races: DriveEvent[], now: Date, months = 12): string[] {
  const since = now.getTime() - months * 30 * 24 * 3600e3
  const counts = new Map<string, number>()
  for (const race of races) {
    if (!race.category || Date.parse(race.startedAt) < since) continue
    counts.set(race.category, (counts.get(race.category) ?? 0) + 1)
  }
  const active = [...counts].filter(([, n]) => n >= 3).map(([category]) => category)
  return active.length > 0 ? active : [...counts.keys()]
}

export function buildDesk(rows: LocalSessionRow[], options: DeskOptions = {}) {
  const now = options.now ?? new Date()
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  const errors: Record<string, string> = {}

  const events = buildEvents(rows)
  const races = events.filter(isRatedRace)
  const ratingHistory = toRatingInputs(races)
  const engineSessions = races.map(toEngineSession)
  const composureInputs = toComposureInputs(races)

  const when = races.length >= 5
    ? section(errors, 'when', () => computeWhenProfile(engineSessions, ratingHistory.map(r => ({ ...r, id: r.createdAt.toISOString(), userId: 'local' })), timeZone))
    : null
  const dna = races.length >= 3
    ? section(errors, 'dna', () => {
        const sessions = engineSessions.map(s => ({ ...s, trackName: s.trackName || null }))
        const ratings = ratingHistory.map(r => ({ iRating: r.iRating, prevIRating: r.prevIRating, createdAt: r.createdAt.toISOString() }))
        const profile = computeDriverDNA(sessions, ratings)
        return { profile, archetype: getDriverArchetype(profile), insights: generateInsights(profile, sessions, ratings) }
      })
    : null

  return {
    generatedAt: now.toISOString(),
    timeZone,
    stats: careerStats(events, races),
    ratings: currentRatings(events),
    raceNow: when ? section(errors, 'raceNow', () => evaluateRaceNow(when, now, timeZone)) : null,
    when,
    whenPanel: when ? section(errors, 'whenPanel', () => buildWhenPanelView(when)) : null,
    composure: section(errors, 'composure', () => ({
      score: computeComposure(composureInputs),
      heat: computeHeat(composureInputs),
      streaks: computeStreaks(composureInputs),
      disciplines: computeDisciplineMix(composureInputs),
      trajectory: computeTrajectory(composureInputs),
    })),
    previousRaces: section(errors, 'previousRaces', () => {
      const byId = new Map(events.map(e => [e.id, e]))
      return buildPreviousRaceCards(events.filter(e => e.official && e.kind !== 'test').slice(-600).map(toPreviousRaceInput), timeZone)
        .slice(0, 200)
        .map(card => {
          const event = byId.get(card.session.id)!
          return { ...card, event: { ...event, iRatingDelta: iRatingDelta(event), safetyRatingDelta: safetyRatingDelta(event) } }
        })
    }),
    mastery: section(errors, 'mastery', () => ({
      tracks: computeTrackMastery(engineSessions.map(s => ({ ...s, createdAt: new Date(s.createdAt) }))),
      cars: computeCarAffinity(engineSessions.map(s => ({ ...s, createdAt: new Date(s.createdAt) }))),
    })),
    dna,
    moments: section(errors, 'moments', () => detectMoments(races.map(toMomentSession), toMomentRatings(ratingHistory))),
    scatter: section(errors, 'scatter', () => buildScatterBuckets(toScatterInputs(races), timeZone)),
    nextRaceIdeas: options.schedule?.series?.length
      ? section(errors, 'nextRaceIdeas', () => {
          const ratings = currentRatings(events)
          // Only what this licence can enter: a suggestion the driver can't register for is noise.
          const season = eligible(toIRacingSchedule(options.schedule), ratings)
          return computeNextRaceIdeas(races.map(toSessionInput), ratingHistory, ratings, season, activeCategories(races, now), timeZone)
        })
      : null,
    schedule: options.schedule
      ? { season: options.schedule.season, parsedAt: options.schedule.parsedAt ?? null, series: options.schedule.series.length }
      : null,
    recentRaces: races.slice(-50).reverse().map(e => ({ ...e, iRatingDelta: iRatingDelta(e), safetyRatingDelta: safetyRatingDelta(e) })),
    errors,
  }
}

export type DeskModel = ReturnType<typeof buildDesk>
