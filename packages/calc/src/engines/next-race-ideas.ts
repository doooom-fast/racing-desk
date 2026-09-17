import { normalizeForComparison, tokenize, jaccardSimilarity } from './fuzzy-match.js'
import { DEFAULT_TZ, getDayInTz, getHourInTz } from './tz.js'

/**
 * Input types for the scoring engine
 */

export interface SessionInput {
  id: string
  carModel: string
  manufacturer: string | null
  category: string
  gameName: string
  trackName: string | null
  sessionType: string | null
  finishPosition: number | null
  incidentCount: number | null
  metadata: {
    completedLaps?: number
    totalLaps?: number
    bestLapTime?: number
    preRaceIRating?: number
    estimatedIRatingDelta?: number
    startedAt?: string
    finishedAt?: string
  } | null
  createdAt: Date
}

export interface RatingInput {
  category: string
  iRating: number
  safetyRating: string
  license: string
  prevIRating: number | null
  prevSafetyRating: string | null
  prevLicense: string | null
  trackName: string | null
  carModel: string | null
  createdAt: Date
}

export interface DriverRatingInput {
  category: string
  iRating: number
  safetyRating: string
  license: string
}

export interface IRacingSchedule {
  season_id: number
  series_id: number
  series_name: string
  season_name: string
  official: boolean
  fixed_setup: boolean
  license_group: number
  license_group_name: string
  min_license_level: number
  track_types: Array<{ track_type: string }>
  schedules: Array<{
    race_week_num: number
    track: {
      track_id: number
      track_name: string
      config_name: string | null
      category: string
    }
    race_time_descriptors: Array<{
      repeating: boolean
      session_minutes: number
      session_times?: string[]
      day_offset?: number[]
      first_session_time?: string
      repeat_minutes?: number
    }>
    race_lap_limit?: number
    race_time_limit?: number
    // Car(s) in use for THIS specific week. Multi-car series like
    // Ring Meister rotate cars weekly — Solstice one week, GT3 the next —
    // so the series-level `car_classes` below is a stale snapshot and
    // becomes wrong as soon as the season advances past week 0. When this
    // field is populated, it's the truth for the week; fall back to the
    // series-level list only when the upstream source doesn't provide it.
    car_classes?: Array<{
      short_name: string
      name: string
      car_class_id: number
    }>
  }>
  car_classes: Array<{
    short_name: string
    name: string
    car_class_id: number
  }>
  start_date: string
}

/**
 * Output type
 */

export interface RaceSuggestion {
  seriesName: string
  trackName: string
  trackConfig: string | null
  category: string
  licenseClass: string
  isOfficial: boolean
  isFixed: boolean
  carClassNames: string[]
  seasonId: number
  seriesId: number
  nextStartTime: Date
  minutesUntilStart: number
  sessionMinutes: number
  repeatMinutes: number | null
  // Race-portion length (NOT the same as sessionMinutes, which includes practice
  // + qual + race for the whole timeslot). Exactly one of these two is set for
  // most series — lap-limited for typical races, time-limited for sprints and
  // endurance. Both can be null for rare cases where upstream data is missing.
  raceLapLimit: number | null
  raceTimeLimit: number | null
  score: number
  scoreBreakdown: {
    trackFamiliarity: number
    trackIncidentRate: number
    carFamiliarity: number
    carPerformance: number
    timeOfDay: number
    dayOfWeek: number
    ratingTrend: number
    licenseLevel: number
  }
  strategy: {
    type: 'pitlane' | 'conservative' | 'careful' | 'form' | 'steady'
    text: string
  }
  commentary: string
  /**
   * Server-baked presentation strings + colors.
   *
   * Native clients (mac/iOS/tvOS/Windows) and the web React component
   * each used to compute these locally — score color via thresholds,
   * "in 2 hr 15 min" via Swift's RelativeDateTimeFormatter or a JS
   * helper, "20 laps" / "45 min" duration formatting, etc. The
   * implementations drifted: same suggestion rendered with subtly
   * different copy and colors on each platform.
   *
   * This view-model carries the exact strings + hex colors the
   * server has decided are correct for THIS suggestion at THIS
   * moment. Clients render verbatim. The only formatting decision
   * any client still makes is layout (which is platform-native by
   * nature).
   *
   * `startsInLabel` is computed against `Date.now()` at server
   * render time. It will go stale if a client holds the response
   * for many minutes. Clients that need a live countdown should
   * recompute from `nextStartTime` themselves; clients happy with
   * a render-time snapshot use this string as-is.
   */
  viewModel: {
    /** Hex color for the score chip background (e.g. "#34c759"). */
    scoreColorHex: string
    /** Short human label for the score tier (e.g. "BEST FIT"). */
    scoreTierLabel: string
    /** Human countdown ("in 2 hr 15 min" / "Starting now" / "Friday at 7:00 PM"). */
    startsInLabel: string
    /**
     * Compact countdown for the time chip ("15m" / "2h" /
     * "2h 30m" / "Starting now" / day-of-week for further-out).
     * Web's `formatTimeUntilStart()` and the chip both render this.
     */
    startsInShortLabel: string
    /** "20 laps" / "45 min" / null if neither limit set. */
    durationLabel: string | null
    /** Pre-formatted strategy badge text ("Pit lane", "On Form", etc). */
    strategyLabel: string
    /** Hex color for the strategy badge. */
    strategyColorHex: string
    /**
     * Track display label, fully resolved for the card heading —
     * `displayName` from the lookups bundle, with the trackConfig
     * appended when present ("Sebring International Raceway —
     * National"). Populated in `getDashboardData()` once lookups
     * are built; the calc itself emits an empty string and relies
     * on the dashboard query to fill it. Kept here on the calc's
     * type so consumers can rely on the field being present.
     */
    trackLabel: string
    /**
     * Single canonical key the client uses to resolve the track in
     * the dashboard `lookups.tracks` array. Centralises the
     * synonym-folding the web component used to do via
     * `trackKeys()` + `resolveIRacingTrackId()`. Populated in
     * `getDashboardData()` post-processing.
     */
    trackLookupKey: string
  }
}

/**
 * View-model builders — server-side formatting that all clients
 * render verbatim. Keeping these here (next to the algorithm that
 * produces RaceSuggestion) means they ride along with every change
 * to the underlying data.
 */

const SCORE_TIERS = [
  { min: 80, hex: '#34c759', label: 'BEST FIT' },
  { min: 60, hex: '#c7d93a', label: 'STRONG' },
  { min: 40, hex: '#ffcf4a', label: 'DECENT' },
  { min: 0,  hex: '#ff8c42', label: 'STRETCH' },
] as const

function scoreTier(score: number): { hex: string; label: string } {
  for (const tier of SCORE_TIERS) {
    if (score >= tier.min) return { hex: tier.hex, label: tier.label }
  }
  return { hex: SCORE_TIERS[SCORE_TIERS.length - 1].hex, label: SCORE_TIERS[SCORE_TIERS.length - 1].label }
}

const STRATEGY_LABELS: Record<RaceSuggestion['strategy']['type'], string> = {
  pitlane: 'Pit lane',
  conservative: 'Conservative',
  careful: 'Careful',
  form: 'On Form',
  steady: 'Steady',
}

const STRATEGY_COLORS: Record<RaceSuggestion['strategy']['type'], string> = {
  pitlane: '#e53935',
  conservative: '#ffcf4a',
  careful: '#ffcf4a',
  form: '#34c759',
  steady: '#7cdff0',
}

function formatDurationLabel(lapLimit: number | null, timeLimit: number | null): string | null {
  if (lapLimit && lapLimit > 0) return `${lapLimit} laps`
  if (timeLimit && timeLimit > 0) {
    if (timeLimit >= 60) {
      const hours = Math.floor(timeLimit / 60)
      const mins = timeLimit % 60
      return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`
    }
    return `${timeLimit} min`
  }
  return null
}

function formatStartsInLabel(nextStartTime: Date, now: Date = new Date()): string {
  const diffMs = nextStartTime.getTime() - now.getTime()
  if (diffMs <= 60_000) return 'Starting now' // <=1 minute or in the past
  const totalMinutes = Math.floor(diffMs / 60_000)
  // <12 hours — relative copy ("in 2 hr 15 min")
  if (totalMinutes < 12 * 60) {
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    if (hours === 0) return `in ${minutes} min`
    if (minutes === 0) return `in ${hours} hr`
    return `in ${hours} hr ${minutes} min`
  }
  // 12 hours – 7 days — day name + time ("Friday at 7:00 PM")
  const sevenDays = 7 * 24 * 60
  const formatter = totalMinutes < sevenDays
    ? new Intl.DateTimeFormat('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true })
    : new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  return formatter.format(nextStartTime)
}

/**
 * Compact countdown for the time chip overlay on each card.
 * Mirrors the web's previous local `formatTimeUntilStart()` exactly:
 *   <1 min → "Starting now"
 *   <1 hr → "Nm" (e.g. "15m")
 *   <12 hr → "Nh" / "Nh Mm" (e.g. "2h 30m")
 *   <7 d → "Wed" (weekday short)
 *   else → "Apr 28" (month + day)
 *
 * Native + web both render this string verbatim — no client-side
 * counting math, no per-platform "15 min" vs "15m" drift.
 */
export function formatStartsInShortLabel(nextStartTime: Date, now: Date = new Date()): string {
  const diffMs = nextStartTime.getTime() - now.getTime()
  if (diffMs <= 60_000) return 'Starting now'
  const totalMinutes = Math.floor(diffMs / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  if (totalMinutes < 12 * 60) {
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
  }
  const sevenDays = 7 * 24 * 60
  const formatter = totalMinutes < sevenDays
    ? new Intl.DateTimeFormat('en-US', { weekday: 'short' })
    : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
  return formatter.format(nextStartTime)
}

function buildViewModel(input: {
  score: number
  strategyType: RaceSuggestion['strategy']['type']
  nextStartTime: Date
  raceLapLimit: number | null
  raceTimeLimit: number | null
}): RaceSuggestion['viewModel'] {
  const tier = scoreTier(input.score)
  return {
    scoreColorHex: tier.hex,
    scoreTierLabel: tier.label,
    startsInLabel: formatStartsInLabel(input.nextStartTime),
    startsInShortLabel: formatStartsInShortLabel(input.nextStartTime),
    durationLabel: formatDurationLabel(input.raceLapLimit, input.raceTimeLimit),
    strategyLabel: STRATEGY_LABELS[input.strategyType],
    strategyColorHex: STRATEGY_COLORS[input.strategyType],
    // Filled in by `getDashboardData()` once the lookups bundle is
    // resolved. The calc itself doesn't have track-display data.
    trackLabel: '',
    trackLookupKey: '',
  }
}

/**
 * Internal helper types
 */

interface TimeOfDayScore {
  hour: number
  avgIncidentsPerLap: number
  sessionCount: number
}

interface DayOfWeekScore {
  dayOfWeek: number
  avgIncidentsPerLap: number
  sessionCount: number
}

interface RatingTrendData {
  avgIRatingDelta: number
  avgSafetyRatingDelta: number
  count: number
}

/**
 * Helper: License-class letter (R/D/C/B/A/P) → numeric license-level (1-25)
 *
 * IMPORTANT: this maps the LICENSE CLASS letter, NOT safety rating.
 * License class and safety rating are independent fields in iRacing:
 *
 *   • License class = categorical class earned by promotion (R/D/C/B/A/P)
 *   • Safety rating = decimal score 0.00–4.99 within your current class
 *
 * A driver can have a B license with SR 1.30 — that is valid and common.
 * SR ≥ 3.0 is the iRacing PROMOTION threshold, not a definition of "B".
 * Never derive license from SR. The series-eligibility gate below uses
 * license only; SR feeds scoring (scoreRatingTrend), never the gate.
 *
 * The integers below match iRacing's `min_license_level` field on each
 * series so we can compare directly: a series with min_license_level=13
 * requires the driver to be ≥ B (level 13).
 */
function licenseTolevel(license: string): number {
  const mapping: Record<string, number> = {
    R: 1,
    D: 5,
    C: 9,
    B: 13,
    A: 17,
    P: 25, // Pro license
  }
  return mapping[license] || 0
}

/**
 * Helper: Convert iRacing license level (1-20) to license class name
 */
function licenseLevelToClass(level: number): string {
  if (level <= 4) return 'Rookie'
  if (level <= 8) return 'D'
  if (level <= 12) return 'C'
  if (level <= 16) return 'B'
  return 'A'
}

/**
 * Score license level: higher-licensed series get a boost (0-15).
 * This rewards progression and surfaces more competitive races.
 */
function scoreLicenseLevel(minLicenseLevel: number): number {
  // min_license_level: 1-4=Rookie, 5-8=D, 9-12=C, 13-16=B, 17+=A
  if (minLicenseLevel >= 17) return 15   // A class
  if (minLicenseLevel >= 13) return 12   // B class
  if (minLicenseLevel >= 9) return 9     // C class
  if (minLicenseLevel >= 5) return 5     // D class
  return 2                                // Rookie
}

/**
 * Helper: Fuzzy track name matching
 */
function tracksMatch(track1: string | null, track2: string | null): boolean {
  if (!track1 || !track2) return false
  const norm1 = normalizeForComparison(track1)
  const norm2 = normalizeForComparison(track2)
  return norm1 === norm2
}

/**
 * Helper: Fuzzy car model matching via Jaccard similarity
 */
function carsMatch(car1: string, car2: string, threshold = 0.6): boolean {
  const tokens1 = tokenize(car1)
  const tokens2 = tokenize(car2)
  const similarity = jaccardSimilarity(tokens1, tokens2)
  return similarity >= threshold
}

/**
 * Compute incidents per lap for a session
 */
function incidentsPerLap(session: SessionInput): number {
  const completedLaps = session.metadata?.completedLaps || 1
  const incidentCount = session.incidentCount || 0
  return incidentCount / Math.max(completedLaps, 1)
}

/**
 * Count races at a specific track
 */
function countTracksRaces(
  sessions: SessionInput[],
  targetTrack: string | null,
): number {
  if (!targetTrack) return 0
  return sessions.filter(s => tracksMatch(s.trackName, targetTrack)).length
}

/**
 * Compute Track Familiarity score (0-25)
 */
function scoreTrackFamiliarity(
  sessions: SessionInput[],
  targetTrack: string | null,
): number {
  const count = countTracksRaces(sessions, targetTrack)
  if (count === 0) return 0
  if (count >= 5) return 25
  if (count >= 3) return 20
  if (count === 2) return 15
  return 8
}

/**
 * Compute Track Incident Rate score (0-25)
 * Compares incidents/lap at track vs overall average
 */
function scoreTrackIncidentRate(
  sessions: SessionInput[],
  targetTrack: string | null,
): number {
  // Overall avg incidents/lap
  if (sessions.length === 0) return 10 // neutral
  const overallAvg =
    sessions.reduce((sum, s) => sum + incidentsPerLap(s), 0) / sessions.length

  // Track-specific avg
  const trackSessions = sessions.filter(s => tracksMatch(s.trackName, targetTrack))
  if (trackSessions.length === 0) return 10 // neutral

  const trackAvg =
    trackSessions.reduce((sum, s) => sum + incidentsPerLap(s), 0) /
    trackSessions.length

  if (overallAvg === 0) return 15 // can't compute ratio

  const ratio = trackAvg / overallAvg

  if (ratio < 0.5) return 25
  if (ratio < 0.8) return 20
  if (ratio < 1.0) return 15
  if (ratio < 1.2) return 10
  if (ratio < 1.5) return 5
  return 0
}

/**
 * Helper: Check if a session's car model belongs to a car class.
 * Uses two strategies:
 *   1. Check if the class short_name or key tokens from class name appear
 *      as whole tokens in the car model (e.g., "GT3" in "BMW M4 GT3")
 *   2. Fall back to Jaccard similarity with a lower threshold
 */
function sessionMatchesCarClass(
  session: SessionInput,
  carClass: { name: string; short_name?: string },
): boolean {
  const modelTokens = tokenize(session.carModel)

  // Strategy 1: class short_name appears as a token in the car model
  if (carClass.short_name) {
    const shortTokens = tokenize(carClass.short_name)
    if (shortTokens.length > 0 && shortTokens.every(t => modelTokens.includes(t))) {
      return true
    }
  }

  // Strategy 2: key tokens from class name appear in car model
  const classTokens = tokenize(carClass.name)
  // Filter out generic words that don't help with matching
  const genericWords = new Set(['class', 'cars', 'car', 'series', 'group', 'racing'])
  const meaningfulClassTokens = classTokens.filter(t => !genericWords.has(t) && t.length > 1)
  if (meaningfulClassTokens.length > 0 && meaningfulClassTokens.every(t => modelTokens.includes(t))) {
    return true
  }

  // Strategy 3: Jaccard fallback (original approach, lower threshold)
  return carsMatch(session.carModel, carClass.name, 0.4)
}

/**
 * Find sessions where the driver raced a car matching any of the given classes
 */
function findMatchedCarSessions(
  sessions: SessionInput[],
  carClasses: Array<{ name: string; short_name?: string }>,
): SessionInput[] {
  return sessions.filter(session =>
    carClasses.some(carClass => sessionMatchesCarClass(session, carClass)),
  )
}

/**
 * Compute Car Familiarity score (0-10)
 * Check if any car in history matches car classes in series
 */
function scoreCarFamiliarity(
  sessions: SessionInput[],
  carClasses: Array<{ name: string; short_name?: string }>,
): number {
  if (carClasses.length === 0) return 0

  const matchedSessions = findMatchedCarSessions(sessions, carClasses)
  const count = matchedSessions.length

  if (count >= 10) return 10
  if (count >= 5) return 8
  if (count >= 3) return 6
  if (count >= 1) return 3
  return 0
}

/**
 * Compute Car Performance score (0-10)
 * Evaluates how the driver performs in matching cars:
 * incidents/lap relative to their overall average, plus finish position trend
 */
function scoreCarPerformance(
  sessions: SessionInput[],
  carClasses: Array<{ name: string; short_name?: string }>,
): number {
  if (carClasses.length === 0) return 0

  const matchedSessions = findMatchedCarSessions(sessions, carClasses)
  if (matchedSessions.length < 2) return 5 // insufficient data, neutral

  // Compare incidents/lap in matched cars vs overall
  const overallAvg = sessions.length > 0
    ? sessions.reduce((sum, s) => sum + incidentsPerLap(s), 0) / sessions.length
    : 0
  const matchedAvg = matchedSessions.reduce((sum, s) => sum + incidentsPerLap(s), 0) / matchedSessions.length

  let incidentScore = 0
  if (overallAvg === 0) {
    incidentScore = 3
  } else {
    const ratio = matchedAvg / overallAvg
    if (ratio < 0.6) incidentScore = 5
    else if (ratio < 0.9) incidentScore = 4
    else if (ratio < 1.1) incidentScore = 3
    else if (ratio < 1.4) incidentScore = 1
    else incidentScore = 0
  }

  // Finish position trend in matched car sessions (top half vs bottom half)
  const withFinish = matchedSessions.filter(s => s.finishPosition !== null)
  let finishScore = 2 // neutral if no data
  if (withFinish.length >= 3) {
    const sorted = [...withFinish].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    const recentHalf = sorted.slice(0, Math.ceil(sorted.length / 2))
    const olderHalf = sorted.slice(Math.ceil(sorted.length / 2))

    const recentAvgFinish = recentHalf.reduce((s, r) => s + (r.finishPosition || 0), 0) / recentHalf.length
    const olderAvgFinish = olderHalf.length > 0
      ? olderHalf.reduce((s, r) => s + (r.finishPosition || 0), 0) / olderHalf.length
      : recentAvgFinish

    // Lower finish position = better (1st place < 10th place)
    if (recentAvgFinish < olderAvgFinish - 1) finishScore = 5  // improving
    else if (recentAvgFinish <= olderAvgFinish + 1) finishScore = 3  // stable
    else finishScore = 1  // declining
  }

  return Math.min(incidentScore + finishScore, 10)
}

/**
 * Compute Time-of-Day Factor score (0-10)
 * Compares the upcoming race hour against the driver's historical
 * incident rate per hour. Lower incidents at this hour = higher score.
 */
function scoreTimeOfDay(
  sessions: SessionInput[],
  raceStartTime: Date,
  timeZone: string = DEFAULT_TZ,
): number {
  if (sessions.length < 5) return 5 // insufficient data

  const hourBuckets: Record<number, number[]> = {}

  for (const session of sessions) {
    const startDate = new Date(
      session.metadata?.startedAt || session.createdAt.toISOString(),
    )
    // Bucket by the user's local hour — otherwise a driver who races at 6 PM
    // Pacific gets their history lumped under 02:00 UTC and the scoring is
    // technically consistent (both sides UTC) but any downstream hour-label
    // is meaningless to the user.
    const hour = getHourInTz(startDate, timeZone)
    const ipl = incidentsPerLap(session)

    if (!hourBuckets[hour]) {
      hourBuckets[hour] = []
    }
    hourBuckets[hour].push(ipl)
  }

  // Compute avg incidents/lap per hour
  const hourScores: TimeOfDayScore[] = Object.entries(hourBuckets).map(
    ([hour, incidents]) => ({
      hour: parseInt(hour, 10),
      avgIncidentsPerLap: incidents.reduce((a, b) => a + b, 0) / incidents.length,
      sessionCount: incidents.length,
    }),
  )

  if (hourScores.length === 0) return 5

  // Sort by avg incidents/lap ascending (lowest = best)
  hourScores.sort((a, b) => a.avgIncidentsPerLap - b.avgIncidentsPerLap)

  // Find where the upcoming race hour ranks in the driver's history
  const raceHour = getHourInTz(raceStartTime, timeZone)
  const raceHourIndex = hourScores.findIndex(h => h.hour === raceHour)

  // No data for this hour — neutral score
  if (raceHourIndex === -1) return 5

  const percentile = raceHourIndex / hourScores.length

  if (percentile <= 0.25) return 10
  if (percentile <= 0.5) return 7
  if (percentile <= 0.75) return 4
  return 0
}

/**
 * Compute Day-of-Week Factor score (0-10)
 * Compares the upcoming race day against the driver's historical
 * incident rate per day. Lower incidents on this day = higher score.
 */
function scoreDayOfWeek(
  sessions: SessionInput[],
  raceStartTime: Date,
  timeZone: string = DEFAULT_TZ,
): number {
  if (sessions.length < 5) return 5 // insufficient data

  const dayBuckets: Record<number, number[]> = {}

  for (const session of sessions) {
    const startDate = new Date(
      session.metadata?.startedAt || session.createdAt.toISOString(),
    )
    // Bucket by the user's local day. A 10 PM Sunday session on the U.S.
    // west coast is 05:00 UTC Monday — counting it as "Monday" would both
    // distort the scoring and, worse, surface "you race well on Mondays"
    // when the user knows they race Sundays.
    const dayOfWeek = getDayInTz(startDate, timeZone) // 0=Sunday, 1=Monday, ... 6=Saturday
    const ipl = incidentsPerLap(session)

    if (!dayBuckets[dayOfWeek]) {
      dayBuckets[dayOfWeek] = []
    }
    dayBuckets[dayOfWeek].push(ipl)
  }

  // Compute avg incidents/lap per day
  const dayScores: DayOfWeekScore[] = Object.entries(dayBuckets).map(
    ([day, incidents]) => ({
      dayOfWeek: parseInt(day, 10),
      avgIncidentsPerLap: incidents.reduce((a, b) => a + b, 0) / incidents.length,
      sessionCount: incidents.length,
    }),
  )

  if (dayScores.length === 0) return 5

  // Sort by avg incidents/lap ascending (lowest = best)
  dayScores.sort((a, b) => a.avgIncidentsPerLap - b.avgIncidentsPerLap)

  // Find where the upcoming race day ranks in the driver's history
  const raceDay = getDayInTz(raceStartTime, timeZone)
  const raceDayIndex = dayScores.findIndex(d => d.dayOfWeek === raceDay)

  // No data for this day — neutral score
  if (raceDayIndex === -1) return 5

  const percentile = raceDayIndex / dayScores.length

  if (percentile <= 0.25) return 10
  if (percentile <= 0.5) return 7
  if (percentile <= 0.75) return 4
  return 0
}

/**
 * Compute Rating Trend score (0-10)
 * From last 5 rating history entries in matching category
 */
function scoreRatingTrend(
  ratingHistory: RatingInput[],
  category: string,
): number {
  const categoryHistory = ratingHistory
    .filter(r => r.category === category)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)

  if (categoryHistory.length === 0) return 5 // unknown

  // Compute avg iR and SR deltas
  let totalIRDelta = 0
  let totalSRDelta = 0
  let validEntries = 0

  for (const entry of categoryHistory) {
    if (entry.prevIRating !== null) {
      totalIRDelta += entry.iRating - entry.prevIRating
      validEntries++
    }
    if (entry.prevSafetyRating !== null) {
      const srCurrent = parseFloat(entry.safetyRating)
      const srPrev = parseFloat(entry.prevSafetyRating)
      if (!isNaN(srCurrent) && !isNaN(srPrev)) {
        totalSRDelta += srCurrent - srPrev
      }
    }
  }

  const avgIRDelta = validEntries > 0 ? totalIRDelta / validEntries : 0
  const avgSRDelta = validEntries > 0 ? totalSRDelta / validEntries : 0

  let score = 0

  // iR trend scoring (0-5)
  if (avgIRDelta >= 0) {
    score += 5
  } else if (avgIRDelta >= -30) {
    score += 3
  }
  // else score += 0

  // SR trend scoring (0-5)
  if (avgSRDelta >= 0) {
    score += 5
  } else if (avgSRDelta >= -0.05) {
    score += 2
  }
  // else score += 0

  return Math.min(score, 10)
}

/**
 * Determine strategy based on rating history
 */
function computeStrategy(
  ratingHistory: RatingInput[],
  category: string,
): { type: 'pitlane' | 'conservative' | 'careful' | 'form' | 'steady'; text: string } {
  const categoryHistory = ratingHistory
    .filter(r => r.category === category)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)

  if (categoryHistory.length === 0) {
    return {
      type: 'steady',
      text: 'Steady approach — focus on finishing well',
    }
  }

  let totalIRDelta = 0
  let totalSRDelta = 0
  let validIREntries = 0
  let validSREntries = 0

  for (const entry of categoryHistory) {
    if (entry.prevIRating !== null) {
      totalIRDelta += entry.iRating - entry.prevIRating
      validIREntries++
    }
    if (entry.prevSafetyRating !== null) {
      const srCurrent = parseFloat(entry.safetyRating)
      const srPrev = parseFloat(entry.prevSafetyRating)
      if (!isNaN(srCurrent) && !isNaN(srPrev)) {
        totalSRDelta += srCurrent - srPrev
        validSREntries++
      }
    }
  }

  const avgIRDelta = validIREntries > 0 ? totalIRDelta / validIREntries : 0
  const avgSRDelta = validSREntries > 0 ? totalSRDelta / validSREntries : 0

  if (avgIRDelta < -30 && avgSRDelta < 0) {
    return {
      type: 'pitlane',
      text: 'Start from pit lane — focus on clean, incident-free laps',
    }
  }

  if (avgIRDelta < -30 && avgSRDelta >= 0) {
    return {
      type: 'conservative',
      text: 'Conservative start — avoid lap-1 chaos, build rhythm',
    }
  }

  if (avgIRDelta >= -30 && avgSRDelta < -0.05) {
    return {
      type: 'careful',
      text: 'Careful with contact — pace is there but incidents are costly',
    }
  }

  if (avgIRDelta >= 0 && avgSRDelta >= 0) {
    return {
      type: 'form',
      text: 'You\'re on form — fight for position from the grid',
    }
  }

  return {
    type: 'steady',
    text: 'Steady approach — focus on finishing well',
  }
}

/**
 * Generate commentary for a race suggestion
 */
function generateCommentary(
  suggestion: Omit<RaceSuggestion, 'commentary' | 'viewModel'>,
  trackFamiliarityCount: number,
): string {
  const familiarityLevel =
    trackFamiliarityCount === 0
      ? 'new track'
      : trackFamiliarityCount === 1
        ? 'familiar'
        : 'well-known'

  const incidentStatus =
    suggestion.scoreBreakdown.trackIncidentRate >= 25
      ? 'strong track record'
      : suggestion.scoreBreakdown.trackIncidentRate >= 15
        ? 'solid record'
        : suggestion.scoreBreakdown.trackIncidentRate >= 10
          ? 'variable record'
          : 'needs improvement'

  const raceInterval =
    suggestion.repeatMinutes === null
      ? `next race in ${Math.round(suggestion.minutesUntilStart)} minutes`
      : `races repeat every ${Math.round(suggestion.repeatMinutes)} minutes`

  return `${suggestion.licenseClass}-class series with a ${familiarityLevel}. You have a ${incidentStatus} here — ${raceInterval}.`
}

/**
 * Parse session time from iRacing format (HH:MM:SS UTC)
 */
function parseUTCTime(timeStr: string | undefined): number {
  if (!timeStr) return 0 // midnight UTC
  const [hours, minutes, seconds] = timeStr.split(':').map(Number)
  return (hours || 0) * 60 + (minutes || 0) + (seconds || 0) / 60
}

/**
 * Find next race start time from race_time_descriptor
 */
function findNextRaceStart(
  descriptor: IRacingSchedule['schedules'][0]['race_time_descriptors'][0],
  now: Date,
  /**
   * The iRacing-week start timestamp this descriptor belongs to.
   * Candidates strictly before this are rejected: they correspond
   * to recurring day-of-week patterns that LOOK like they fit the
   * descriptor, but the iRacing week the descriptor actually
   * indexes hasn't opened yet — so the race isn't registrable.
   *
   * Without this clamp, a next-week scheduleItem evaluated during
   * the 24h pre-rollover lookahead window would synthesize a
   * "race in 12 minutes" time at, say, Mon 9pm UTC by matching a
   * Mon-evening day_offset pattern — but iRacing won't have that
   * race up until Tue 12pm UTC rollover. User-visible symptom:
   * "Next Race tab is changing weeks 12-18 hours early".
   *
   * Pass `null` to skip the clamp (caller couldn't compute weekStart;
   * fall back to legacy behavior).
   */
  weekStartMs: number | null,
): { nextStart: Date; repeatMinutes: number | null } | null {
  const nowMs = now.getTime()
  const earliestAllowedMs = weekStartMs !== null ? Math.max(nowMs, weekStartMs) : nowMs

  // For repeating sessions
  if (descriptor.repeating && descriptor.day_offset && descriptor.first_session_time) {
    const dayOffset = descriptor.day_offset
    const firstSessionMinutes = parseUTCTime(descriptor.first_session_time)
    const repeatMinutes = descriptor.repeat_minutes || 0

    // Find next matching day and time
    for (let daysAhead = 0; daysAhead < 14; daysAhead++) {
      const checkDate = new Date(now)
      checkDate.setUTCDate(checkDate.getUTCDate() + daysAhead)
      const checkDayOfWeek = checkDate.getUTCDay()

      if (dayOffset.includes(checkDayOfWeek)) {
        // Check if we can fit a session start on this day
        const candidateDate = new Date(checkDate)
        candidateDate.setUTCHours(Math.floor(firstSessionMinutes / 60))
        candidateDate.setUTCMinutes(firstSessionMinutes % 60)
        candidateDate.setUTCSeconds(0)

        // If it's today, check if we need a future session
        if (daysAhead === 0) {
          // Try to find a future session time on this day,
          // honoring the iRacing-week start clamp.
          let sessionTime = candidateDate.getTime()
          while (sessionTime < earliestAllowedMs) {
            if (repeatMinutes <= 0) {
              sessionTime = -Infinity // no recurrence to advance; bail
              break
            }
            sessionTime += repeatMinutes * 60 * 1000
          }
          if (sessionTime === -Infinity) continue
          const minutesUntil = (sessionTime - nowMs) / (60 * 1000)
          if (minutesUntil >= 5 && minutesUntil <= 480) {
            return {
              nextStart: new Date(sessionTime),
              repeatMinutes: repeatMinutes || null,
            }
          }
        } else {
          // Future day: use first session time, but reject if it
          // falls before the iRacing-week start clamp.
          if (candidateDate.getTime() < earliestAllowedMs) continue
          const minutesUntil = (candidateDate.getTime() - nowMs) / (60 * 1000)
          if (minutesUntil >= 5 && minutesUntil <= 480) {
            return {
              nextStart: candidateDate,
              repeatMinutes: repeatMinutes || null,
            }
          }
        }
      }
    }
  }

  // For non-repeating sessions
  if (!descriptor.repeating && descriptor.session_times) {
    for (const sessionTimeStr of descriptor.session_times) {
      const sessionStart = new Date(sessionTimeStr)
      if (sessionStart.getTime() < earliestAllowedMs) continue
      const minutesUntil = (sessionStart.getTime() - nowMs) / (60 * 1000)
      if (minutesUntil >= 5 && minutesUntil <= 480) {
        return {
          nextStart: sessionStart,
          repeatMinutes: null,
        }
      }
    }
  }

  return null
}

/**
 * iRacing week filtering
 *
 * Each `scheduleItem` in a `season.schedules[]` belongs to a specific iRacing
 * week (0-indexed `race_week_num`). iRacing weeks are exactly 7 days long and
 * roll over at **Tuesday 12:00 UTC** (long-running iRacing convention).
 *
 * `season.start_date` is a YYYY-MM-DD string — `new Date(...).getTime()`
 * gives midnight UTC, so we add `IRACING_ROLLOVER_OFFSET_MS = 12h` to
 * land on the actual rollover boundary. Otherwise our `weekStart`
 * would be 12 hours too early, causing next-week content to surface
 * half a day before iRacing actually flips over.
 *
 * Without this filter, `computeNextRaceIdeas` would evaluate every week's
 * scheduleItem for every series, and since weekly race patterns repeat by
 * day-of-week, multiple weeks' entries would match and compete — typically
 * causing suggestions to be drawn from the wrong (earlier) iRacing week.
 */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const IRACING_ROLLOVER_OFFSET_MS = 12 * 60 * 60 * 1000 // Tue 12:00 UTC, not 00:00
const ROLLOVER_LOOKAHEAD_MS = 24 * 60 * 60 * 1000

/**
 * Compute the actual iRacing rollover timestamp for a given
 * (season, raceWeekNum). Returns null when start_date is missing
 * or unparseable so callers can fall back gracefully.
 */
function iracingWeekStartMs(startDate: string | undefined, raceWeekNum: number): number | null {
  if (!startDate) return null
  const baseMs = new Date(startDate).getTime()
  if (Number.isNaN(baseMs)) return null
  return baseMs + IRACING_ROLLOVER_OFFSET_MS + raceWeekNum * WEEK_MS
}

function isWithinCurrentWeekWindow(
  startDate: string | undefined,
  raceWeekNum: number,
  now: Date,
): boolean {
  const weekStart = iracingWeekStartMs(startDate, raceWeekNum)
  if (weekStart === null) {
    console.warn(
      '[next-race-ideas] season.start_date missing/unparseable; skipping iRacing-week filter',
    )
    return true
  }
  const weekEnd = weekStart + WEEK_MS
  const nowMs = now.getTime()
  // Current week: weekStart <= now < weekEnd  → both conditions hold
  // Upcoming week (within 24h of rollover): weekStart in (now, now + 24h]
  //   → weekEnd > now is trivially true, weekStart <= now + 24h captures it
  //
  // Even when an upcoming-week item passes this window filter, its
  // race candidates are clamped to >= weekStart inside
  // `findNextRaceStart`, so we don't synthesize "race in 12 min"
  // times that fall before the iRacing week has actually opened.
  return weekEnd > nowMs && weekStart <= nowMs + ROLLOVER_LOOKAHEAD_MS
}

/**
 * Main export function
 */
export function computeNextRaceIdeas(
  sessions: SessionInput[],
  ratingHistory: RatingInput[],
  driverRatings: DriverRatingInput[],
  schedule: IRacingSchedule[],
  activeCategories?: string[],
  timeZone: string = DEFAULT_TZ,
): RaceSuggestion[] {
  const now = new Date()
  const suggestions: RaceSuggestion[] = []

  // If activeCategories is provided, only generate suggestions for those.
  const allowedCategories = activeCategories
    ? new Set(activeCategories)
    : null

  // Build a license-level lookup from the driver's current ratings
  const driverLicenseByCategory = new Map<string, number>()
  for (const dr of driverRatings) {
    driverLicenseByCategory.set(dr.category, licenseTolevel(dr.license))
  }

  for (const season of schedule) {
    for (const scheduleItem of season.schedules) {
      // Only consider the current iRacing week, or the upcoming week when
      // we're within 24h of the Tuesday 00:00 UTC rollover. Without this,
      // every week's entry in this season would match and compete — leading
      // to suggestions from earlier (already-over) weeks.
      if (
        !isWithinCurrentWeekWindow(
          season.start_date,
          scheduleItem.race_week_num,
          now,
        )
      ) {
        continue
      }

      const track = scheduleItem.track
      const category = track.category || 'road'

      // Skip categories the user doesn't race
      if (allowedCategories && !allowedCategories.has(category)) continue

      // Skip series the driver's license can't enter
      const driverLevel = driverLicenseByCategory.get(category) || 0
      if (driverLevel > 0 && season.min_license_level > driverLevel) continue

      // Find next race start time from race time descriptors.
      // `weekStartMs` clamps candidates to the iRacing week the
      // scheduleItem actually belongs to — so a next-week item
      // surfaced via the 24h lookahead window can't synthesize a
      // "race starting in 12 minutes" before iRacing has opened
      // that week.
      const weekStartMs = iracingWeekStartMs(season.start_date, scheduleItem.race_week_num)
      let bestNextStart: { nextStart: Date; repeatMinutes: number | null } | null = null
      for (const descriptor of scheduleItem.race_time_descriptors) {
        const candidate = findNextRaceStart(descriptor, now, weekStartMs)
        if (candidate) {
          if (
            !bestNextStart ||
            candidate.nextStart.getTime() < bestNextStart.nextStart.getTime()
          ) {
            bestNextStart = candidate
          }
        }
      }

      if (!bestNextStart) {
        continue
      }

      // Get sessions for this category only
      const categorySessions = sessions.filter(s => s.category === category)

      // Prefer this-week's car list over the series-wide one. For rotating
      // series (Ring Meister, Draft Master, …) the series-wide `car_classes`
      // is a stale week-0 snapshot and would display "Ligier JS P320" for
      // a week that is actually running the Pontiac Solstice. Fall back to
      // the series-wide list for series that don't rotate, or when the
      // upstream data doesn't provide per-week info.
      const weekCarClasses = scheduleItem.car_classes ?? season.car_classes

      // Compute all scoring components
      const trackFamiliarityScore = scoreTrackFamiliarity(
        categorySessions,
        track.track_name,
      )
      const trackIncidentScore = scoreTrackIncidentRate(
        categorySessions,
        track.track_name,
      )
      const carFamiliarityScore = scoreCarFamiliarity(categorySessions, weekCarClasses)
      const carPerformanceScore = scoreCarPerformance(categorySessions, weekCarClasses)
      const timeOfDayScore = scoreTimeOfDay(categorySessions, bestNextStart.nextStart, timeZone)
      const dayOfWeekScore = scoreDayOfWeek(categorySessions, bestNextStart.nextStart, timeZone)
      const ratingTrendScore = scoreRatingTrend(ratingHistory, category)
      const licenseLevelScore = scoreLicenseLevel(season.min_license_level)

      const totalScore =
        trackFamiliarityScore +
        trackIncidentScore +
        carFamiliarityScore +
        carPerformanceScore +
        timeOfDayScore +
        dayOfWeekScore +
        ratingTrendScore +
        licenseLevelScore

      const minutesUntilStart =
        Math.round((bestNextStart.nextStart.getTime() - now.getTime()) / (60 * 1000))

      const strategy = computeStrategy(ratingHistory, category)

      const licenseClass = licenseLevelToClass(season.min_license_level)

      const trackFamiliarityCount = countTracksRaces(categorySessions, track.track_name)

      // Deduplicate display names. For multi-car weeks we fan the class
      // name out across every car short-code (so session→class matching
      // works per-car), which would otherwise produce
      // ["GT3 2025","GT3 2025",…] in the UI.
      const carClassNames = Array.from(new Set(weekCarClasses.map(c => c.name)))

      const suggestion: RaceSuggestion = {
        seriesName: season.series_name,
        trackName: track.track_name,
        trackConfig: track.config_name,
        category,
        licenseClass,
        isOfficial: season.official,
        isFixed: season.fixed_setup,
        carClassNames,
        seasonId: season.season_id,
        seriesId: season.series_id,
        nextStartTime: bestNextStart.nextStart,
        minutesUntilStart,
        sessionMinutes: scheduleItem.race_time_descriptors[0].session_minutes || 60,
        repeatMinutes: bestNextStart.repeatMinutes,
        raceLapLimit: scheduleItem.race_lap_limit ?? null,
        raceTimeLimit: scheduleItem.race_time_limit ?? null,
        score: Math.round(totalScore),
        scoreBreakdown: {
          trackFamiliarity: trackFamiliarityScore,
          trackIncidentRate: trackIncidentScore,
          carFamiliarity: carFamiliarityScore,
          carPerformance: carPerformanceScore,
          timeOfDay: timeOfDayScore,
          dayOfWeek: dayOfWeekScore,
          ratingTrend: ratingTrendScore,
          licenseLevel: licenseLevelScore,
        },
        strategy,
        commentary: generateCommentary(
          {
            seriesName: season.series_name,
            trackName: track.track_name,
            trackConfig: track.config_name,
            category,
            licenseClass,
            isOfficial: season.official,
            isFixed: season.fixed_setup,
            carClassNames,
            seasonId: season.season_id,
            seriesId: season.series_id,
            nextStartTime: bestNextStart.nextStart,
            minutesUntilStart,
            sessionMinutes: scheduleItem.race_time_descriptors[0].session_minutes || 60,
            repeatMinutes: bestNextStart.repeatMinutes,
            raceLapLimit: scheduleItem.race_lap_limit ?? null,
            raceTimeLimit: scheduleItem.race_time_limit ?? null,
            score: Math.round(totalScore),
            scoreBreakdown: {
              trackFamiliarity: trackFamiliarityScore,
              trackIncidentRate: trackIncidentScore,
              carFamiliarity: carFamiliarityScore,
              carPerformance: carPerformanceScore,
              timeOfDay: timeOfDayScore,
              dayOfWeek: dayOfWeekScore,
              ratingTrend: ratingTrendScore,
              licenseLevel: licenseLevelScore,
            },
            strategy,
          },
          trackFamiliarityCount,
        ),
        viewModel: buildViewModel({
          score: Math.round(totalScore),
          strategyType: strategy.type,
          nextStartTime: bestNextStart.nextStart,
          raceLapLimit: scheduleItem.race_lap_limit ?? null,
          raceTimeLimit: scheduleItem.race_time_limit ?? null,
        }),
      }

      suggestions.push(suggestion)
    }
  }

  // Sort by soonest start time
  suggestions.sort((a, b) => a.nextStartTime.getTime() - b.nextStartTime.getTime())

  // Diversify: pick up to 5 suggestions per category so each discipline gets its own column.
  return diversifyByCategory(suggestions, 5)
}

/**
 * Diversify per category — returns up to `perCategory` suggestions for each
 * category. Within each category, `diversifySelections` spreads picks across
 * license classes, series, and tracks.
 */
function diversifyByCategory(
  timeSorted: RaceSuggestion[],
  perCategory: number,
): RaceSuggestion[] {
  // Group candidates by category only
  const byCategory = new Map<string, RaceSuggestion[]>()
  for (const s of timeSorted) {
    const cat = s.category || 'road'
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat)!.push(s)
  }

  const all: RaceSuggestion[] = []
  for (const [, candidates] of byCategory) {
    all.push(...diversifySelections(candidates, perCategory))
  }

  return all
}

/**
 * Greedy diversity selection.
 *
 * Goals: no duplicate series, no duplicate tracks, spread across license classes.
 * Higher-scored candidates are preferred, but diversity constraints come first.
 *
 * Pass 1: Score-sorted. Pick the highest-scoring candidate for each unique
 *          license class, skipping if we already have that series or track.
 * Pass 2: Backfill remaining slots from score-sorted candidates,
 *          still enforcing no duplicate series/track.
 * Pass 3: If still short (very few eligible races), relax the track constraint.
 *
 * Final output sorted by start time.
 */
function diversifySelections(
  timeSorted: RaceSuggestion[],
  count: number,
): RaceSuggestion[] {
  // Work from a score-sorted copy so we prefer higher-quality picks
  const scoreSorted = [...timeSorted].sort((a, b) => b.score - a.score)

  const selected: RaceSuggestion[] = []
  const selectedIds = new Set<number>() // seriesId dedup
  const seenLicenseClasses = new Set<string>()
  const seenSeriesIds = new Set<number>()
  const seenTracks = new Set<string>()

  const canPick = (s: RaceSuggestion, relaxTrack = false): boolean => {
    if (seenSeriesIds.has(s.seriesId)) return false
    if (!relaxTrack && seenTracks.has(s.trackName.toLowerCase())) return false
    return true
  }

  const pick = (s: RaceSuggestion) => {
    selected.push(s)
    selectedIds.add(s.seriesId)
    seenSeriesIds.add(s.seriesId)
    seenLicenseClasses.add(s.licenseClass)
    seenTracks.add(s.trackName.toLowerCase())
  }

  // Pass 1: one per license class (highest scoring from each)
  for (const s of scoreSorted) {
    if (selected.length >= count) break
    if (seenLicenseClasses.has(s.licenseClass)) continue
    if (!canPick(s)) continue
    pick(s)
  }

  // Pass 2: backfill from remaining, enforcing no duplicate series/track
  if (selected.length < count) {
    for (const s of scoreSorted) {
      if (selected.length >= count) break
      if (selectedIds.has(s.seriesId)) continue
      if (!canPick(s)) continue
      pick(s)
    }
  }

  // Pass 3: if still short, relax track constraint (allow same track, different series)
  if (selected.length < count) {
    for (const s of scoreSorted) {
      if (selected.length >= count) break
      if (selectedIds.has(s.seriesId)) continue
      if (!canPick(s, true)) continue
      pick(s)
    }
  }

  // Final sort by soonest start time
  return selected.sort((a, b) => a.nextStartTime.getTime() - b.nextStartTime.getTime())
}

/**
 * Exported for unit testing — not part of the public API
 */
export const _testing = {
  scoreTrackFamiliarity,
  scoreTrackIncidentRate,
  scoreCarFamiliarity,
  scoreCarPerformance,
  scoreTimeOfDay,
  scoreDayOfWeek,
  scoreRatingTrend,
  sessionMatchesCarClass,
  findMatchedCarSessions,
  incidentsPerLap,
  diversifySelections,
  isWithinCurrentWeekWindow,
}
