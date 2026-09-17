/**
 * Drive events → the input shapes the ported engines were written against. The engines stay verbatim;
 * everything local-specific (stints, derived rating changes, iRacing's category names) is resolved here.
 */
import type { SessionInput, RatingInput, DriverRatingInput } from '../engines/next-race-ideas.js'
import type { PreviousRaceInput } from '../engines/previous-races.js'
import type { ComposureSessionInput } from '../engines/composure.js'
import type { ScatterSessionInput } from '../engines/scatter-view.js'
import type { SessionRecord as MomentSession, RatingRecord as MomentRating } from '../engines/moments.js'
import { extractManufacturer } from '../engines/fuzzy-match.js'
import { type DriveEvent, iRatingDelta, safetyRatingDelta } from './events.js'

const GAME = 'iracing'

/** The metadata blob the engines read (keys as the cloud sessions table stored them). */
export function metadataFor(e: DriveEvent): Record<string, any> {
  return {
    completedLaps: e.laps,
    bestLapTime: e.bestLapSeconds ?? undefined,
    preRaceIRating: e.iRating ?? undefined,
    postRaceIRating: e.iRatingAfter ?? undefined,
    estimatedIRatingDelta: iRatingDelta(e) ?? undefined,
    iRatingDelta: iRatingDelta(e) ?? undefined,
    preRaceSR: e.safetyRating ?? undefined,
    postRaceSR: e.safetyRatingAfter ?? undefined,
    srDelta: safetyRatingDelta(e) ?? undefined,
    startedAt: e.startedAt,
    finishedAt: e.finishedAt,
    sessionDuration: e.durationSeconds,
    fieldSize: e.fieldSize ?? undefined,
    strengthOfField: e.strengthOfField ?? undefined,
    startPosition: e.startPosition ?? undefined,
    iracingTrackConfig: e.trackConfig ?? undefined,
    iracingTrackId: e.trackId ?? undefined,
    prodriveTrackId: e.trackId != null ? `iracing:${e.trackId}` : undefined,
    subsessionId: e.subsessionId ?? undefined,
    seriesId: e.seriesId ?? undefined,
    seasonId: e.seasonId ?? undefined,
    officialSession: e.official,
    eventType: e.eventType,
  }
}

// iRacing's car names aren't consistent about brand casing ("Mclaren 570s GT4", "McLaren 720S GT3 EVO").
const BRAND_SPELLING: Record<string, string> = { mclaren: 'McLaren' }

export function manufacturerOf(e: DriveEvent): string {
  if (!e.carName) return ''
  const brand = extractManufacturer(e.carName)
  return BRAND_SPELLING[brand.toLowerCase()] ?? brand
}

export function toSessionInput(e: DriveEvent): SessionInput {
  return {
    id: e.id,
    carModel: e.carName,
    manufacturer: manufacturerOf(e) || null,
    category: e.category ?? 'road',
    gameName: GAME,
    trackName: e.trackDisplayName || null,
    sessionType: e.sessionType || null,
    finishPosition: e.finishPosition,
    incidentCount: e.incidents,
    metadata: metadataFor(e),
    createdAt: new Date(e.finishedAt),
  }
}

/** One rating-history entry per event whose after-ratings are known. */
export function toRatingInputs(events: DriveEvent[]): RatingInput[] {
  return events
    .filter(e => e.iRating != null && e.iRatingAfter != null && e.category)
    .map(e => ({
      category: e.category!,
      iRating: e.iRatingAfter!,
      safetyRating: (e.safetyRatingAfter ?? 0).toFixed(2),
      license: e.licenseClassAfter ?? '',
      prevIRating: e.iRating,
      prevSafetyRating: e.safetyRating != null ? e.safetyRating.toFixed(2) : null,
      prevLicense: e.licenseClass,
      trackName: e.trackDisplayName || null,
      carModel: e.carName || null,
      createdAt: new Date(e.finishedAt),
      sessionType: e.sessionType,
    }))
}

/** The latest ratings iRacing reported in each category. */
export function currentRatings(events: DriveEvent[]): DriverRatingInput[] {
  const latest = new Map<string, DriveEvent>()
  for (const e of events) if (e.iRating != null && e.category) latest.set(e.category, e)
  return [...latest.values()].map(e => ({
    category: e.category!,
    iRating: e.iRating!,
    safetyRating: (e.safetyRating ?? 0).toFixed(2),
    license: e.licenseClass ?? '',
  }))
}

export function toPreviousRaceInput(e: DriveEvent): PreviousRaceInput {
  return {
    id: e.id,
    carModel: e.carName,
    manufacturer: manufacturerOf(e) || null,
    trackName: e.trackDisplayName || null,
    finishPosition: e.finishPosition,
    incidentCount: e.incidents,
    sessionType: e.sessionType || null,
    category: e.category ?? 'road',
    metadata: metadataFor(e),
    gameName: GAME,
    createdAt: e.finishedAt,
  }
}

export function toComposureInputs(events: DriveEvent[]): ComposureSessionInput[] {
  return events
    .filter(e => iRatingDelta(e) != null)
    .map(e => ({ date: e.finishedAt, iRatingDelta: iRatingDelta(e)!, incidents: e.incidents, category: e.category ?? undefined }))
}

export function toScatterInputs(events: DriveEvent[]): ScatterSessionInput[] {
  return events.map(e => ({
    date: e.startedAt,
    iRatingDelta: iRatingDelta(e) ?? 0,
    srDelta: safetyRatingDelta(e) ?? 0,
    incidents: e.incidents,
  }))
}

/** mastery.ts / when-engine.ts / driver-dna.ts session shape (a superset works for all three). */
export function toEngineSession(e: DriveEvent) {
  return {
    id: e.id,
    userId: 'local',
    carModel: e.carName,
    manufacturer: manufacturerOf(e),
    category: e.category ?? 'road',
    gameName: GAME,
    trackId: e.trackId != null ? String(e.trackId) : null,
    trackName: e.trackDisplayName,
    sessionType: e.sessionType,
    finishPosition: e.finishPosition,
    incidentCount: e.incidents,
    metadata: metadataFor(e),
    createdAt: e.finishedAt,
  }
}

export function toMomentSession(e: DriveEvent): MomentSession {
  return {
    id: e.id,
    carModel: e.carName,
    trackName: e.trackDisplayName || 'Unknown Track',
    finishPosition: e.finishPosition ?? undefined,
    incidentCount: e.incidents,
    metadata: metadataFor(e),
    createdAt: new Date(e.finishedAt),
    gameName: GAME,
    sessionType: e.sessionType || 'Race',
  }
}

export function toMomentRatings(ratings: RatingInput[]): MomentRating[] {
  return ratings.map(r => ({
    iRating: r.iRating,
    prevIRating: r.prevIRating ?? 0,
    prevLicense: r.prevLicense ?? undefined,
    license: r.license,
    sessionType: (r as RatingInput & { sessionType?: string }).sessionType,
    createdAt: r.createdAt,
  }))
}
