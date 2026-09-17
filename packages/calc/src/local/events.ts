/**
 * Local store rows → drive events.
 *
 * RaceCor.Host serves `sessions` rows as stored (one per .ibt file × YAML session). iRacing writes a new
 * .ibt every time the driver gets in the car, so one race with a tow or a rejoin is several rows. Events
 * merge those stints back into the session the driver actually took part in, then derive what telemetry
 * can't say directly: how iRating and Safety Rating moved, read from the next session in the same
 * licence category.
 */

/** One row of `GET /racecor-io-pro-drive/data/sessions`. */
export interface LocalSessionRow {
  id: number
  source: string
  ibt_path: string | null
  session_num: number
  subsession_id: number | null
  session_id: number | null
  series_id: number | null
  season_id: number | null
  race_week: number | null
  event_type: string | null
  session_type: string | null
  official: number | null
  category: string | null
  track_id: number | null
  track_name: string | null
  track_display_name: string | null
  track_config: string | null
  track_length_km: number | null
  car_path: string | null
  car_id: number | null
  car_screen_name: string | null
  car_class_id: number | null
  started_at: string
  duration_s: number | null
  driver_cust_id: number | null
  irating: number | null
  license: string | null
  safety_rating: number | null
  laps_completed: number | null
  best_lap_s: number | null
  incidents: number | null
  start_position: number | null
  finish_position: number | null
  finish_position_in_class: number | null
  field_size: number | null
  sof: number | null
}

/** iRacing licence categories, keyed the way the calc engines and the schedule refer to them. */
export type Discipline = 'sports_car' | 'formula_car' | 'oval' | 'dirt_oval' | 'dirt_road' | 'road'

export type EventKind = 'race' | 'qualifying' | 'practice' | 'warmup' | 'test' | 'time_attack' | 'other'

export interface DriveEvent {
  /** `<subsession>:<session_num>` for hosted/official sessions; `row:<id>` for offline ones. */
  id: string
  rowIds: number[]
  kind: EventKind
  sessionType: string
  eventType: string
  official: boolean
  subsessionId: number | null
  seriesId: number | null
  seasonId: number | null
  raceWeek: number | null
  category: Discipline | null
  trackId: number | null
  trackName: string
  trackDisplayName: string
  trackConfig: string | null
  trackLengthKm: number | null
  carId: number | null
  carPath: string | null
  carName: string
  carClassId: number | null
  startedAt: string
  finishedAt: string
  durationSeconds: number
  laps: number
  bestLapSeconds: number | null
  incidents: number
  startPosition: number | null
  finishPosition: number | null
  finishPositionInClass: number | null
  fieldSize: number | null
  strengthOfField: number | null
  /** Ratings as iRacing reported them when the session began. Null offline (iRacing reports 1 / R 0.01). */
  iRating: number | null
  licenseClass: string | null
  safetyRating: number | null
  /**
   * Ratings at the driver's next session in this category — so, after this one. Null when there is no later
   * session yet. Estimates: a race run with disk telemetry off would be folded into the delta.
   */
  iRatingAfter: number | null
  safetyRatingAfter: number | null
  licenseClassAfter: string | null
}

const DISCIPLINES: Record<string, Discipline> = {
  SportsCar: 'sports_car',
  Formula: 'formula_car',
  Oval: 'oval',
  DirtOval: 'dirt_oval',
  DirtRoad: 'dirt_road',
  Road: 'road',
}

export function discipline(category: string | null | undefined): Discipline | null {
  return (category && DISCIPLINES[category]) || null
}

export function eventKind(sessionType: string | null, eventType: string | null): EventKind {
  const t = (sessionType || '').toLowerCase()
  if (t === 'race') return 'race'
  if (t.includes('qualify')) return (eventType || '').toLowerCase() === 'time attack' ? 'time_attack' : 'qualifying'
  if (t.includes('practice')) return 'practice'
  if (t.includes('warmup')) return 'warmup'
  if (t.includes('testing')) return 'test'
  return 'other'
}

/** "C 2.85" → { licenseClass: 'C', safetyRating: 2.85 }. */
export function parseLicense(license: string | null | undefined): { licenseClass: string | null; safetyRating: number | null } {
  const m = /^\s*([A-Z]+)\s+(\d+(?:\.\d+)?)/.exec(license || '')
  return m ? { licenseClass: m[1], safetyRating: Number(m[2]) } : { licenseClass: null, safetyRating: null }
}

const pos = (n: number | null | undefined): number | null => (n != null && n > 0 ? n : null)
const endOf = (r: LocalSessionRow) => Date.parse(r.started_at) + Math.max(0, r.duration_s || 0) * 1000

function eventKey(r: LocalSessionRow): string {
  return r.subsession_id && r.subsession_id > 0 ? `${r.subsession_id}:${r.session_num}` : `row:${r.id}`
}

/** Merges stints and derives rating changes. Returns events oldest first. */
export function buildEvents(rows: LocalSessionRow[]): DriveEvent[] {
  const groups = new Map<string, LocalSessionRow[]>()
  for (const r of rows) {
    if (!r.started_at || Number.isNaN(Date.parse(r.started_at))) continue
    const key = eventKey(r)
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }

  const events: DriveEvent[] = []
  for (const [id, stints] of groups) {
    stints.sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
    const first = stints[0]
    const last = stints[stints.length - 1]
    // The last stint carries the most complete results table; the first one saw the grid.
    const finisher = [...stints].reverse().find(s => pos(s.finish_position) != null) ?? last
    const starter = stints.find(s => pos(s.start_position) != null) ?? first
    const bests = stints.map(s => s.best_lap_s ?? 0).filter(t => t > 0)
    const finishedMs = Math.max(...stints.map(endOf))
    const official = stints.some(s => !!s.official)
    const rated = official && (first.irating ?? 0) > 1
    const lic = parseLicense(first.license)

    events.push({
      id,
      rowIds: stints.map(s => s.id),
      kind: eventKind(first.session_type, first.event_type),
      sessionType: first.session_type || '',
      eventType: first.event_type || '',
      official,
      subsessionId: pos(first.subsession_id),
      seriesId: pos(first.series_id),
      seasonId: pos(first.season_id),
      raceWeek: first.race_week ?? null,
      category: discipline(first.category),
      trackId: pos(first.track_id),
      trackName: first.track_name || '',
      trackDisplayName: first.track_display_name || first.track_name || '',
      trackConfig: first.track_config || null,
      trackLengthKm: first.track_length_km ?? null,
      carId: pos(first.car_id),
      carPath: first.car_path,
      carName: first.car_screen_name || first.car_path || '',
      carClassId: pos(first.car_class_id),
      startedAt: new Date(Date.parse(first.started_at)).toISOString(),
      finishedAt: new Date(finishedMs).toISOString(),
      durationSeconds: (finishedMs - Date.parse(first.started_at)) / 1000,
      laps: stints.reduce((n, s) => n + (s.laps_completed || 0), 0),
      bestLapSeconds: bests.length ? Math.min(...bests) : null,
      incidents: stints.reduce((n, s) => n + (s.incidents || 0), 0),
      startPosition: pos(starter.start_position),
      finishPosition: pos(finisher.finish_position),
      finishPositionInClass: pos(finisher.finish_position_in_class),
      fieldSize: pos(Math.max(...stints.map(s => s.field_size || 0))),
      strengthOfField: pos([...stints].reverse().find(s => pos(s.sof) != null)?.sof),
      iRating: rated ? first.irating : null,
      licenseClass: rated ? lic.licenseClass : null,
      safetyRating: rated ? (first.safety_rating ?? lic.safetyRating) : null,
      iRatingAfter: null,
      safetyRatingAfter: null,
      licenseClassAfter: null,
    })
  }

  events.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id))
  deriveRatingChanges(events)
  return events
}

/**
 * For each rated event, the ratings at the next rated event in the same category that belongs to a
 * different subsession (sessions of one subsession all report the ratings it started with).
 */
function deriveRatingChanges(events: DriveEvent[]): void {
  const byCategory = new Map<Discipline, DriveEvent[]>()
  for (const e of events) {
    if (e.iRating == null || !e.category) continue
    const list = byCategory.get(e.category)
    if (list) list.push(e)
    else byCategory.set(e.category, [e])
  }
  for (const list of byCategory.values()) {
    for (let i = 0; i < list.length; i++) {
      const e = list[i]
      const ownGroup = e.subsessionId ?? e.id
      const next = list.slice(i + 1).find(n => (n.subsessionId ?? n.id) !== ownGroup)
      if (!next) continue
      e.iRatingAfter = next.iRating
      e.safetyRatingAfter = next.safetyRating
      e.licenseClassAfter = next.licenseClass
    }
  }
}

export const iRatingDelta = (e: DriveEvent): number | null =>
  e.iRating != null && e.iRatingAfter != null ? e.iRatingAfter - e.iRating : null

/** Null across a licence promotion or demotion, where the SR number restarts in the new class. */
export const safetyRatingDelta = (e: DriveEvent): number | null =>
  e.safetyRating != null && e.safetyRatingAfter != null && e.licenseClass === e.licenseClassAfter
    ? Math.round((e.safetyRatingAfter - e.safetyRating) * 100) / 100
    : null

/** Official races — what every recommendation, verdict and score is about. */
export const isRatedRace = (e: DriveEvent): boolean => e.kind === 'race' && e.official
