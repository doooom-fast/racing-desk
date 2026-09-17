/**
 * Pre-built Previous Races cards.
 *
 * Mirrors the rendering data the web's `RaceCard` + `RaceHistory`
 * components consume — but with all formatting, pairing, position-
 * color resolution, and tab classification baked in server-side so
 * native clients render the result verbatim instead of re-porting the
 * same logic in Swift / Kotlin / etc.
 *
 * The pairing rule (race ↔ practice ↔ qualifying within an 8-hour
 * window on the same track) used to live inline in
 * `apps/web/src/app/drive/dashboard/page.tsx`. Lifted here so both web
 * and native consume the identical pre-paired output.
 *
 * Position color, "of N" copy, best-lap formatting (`1:23.456`),
 * humanised session label, game label, etc. all match what
 * `RaceCard.tsx` produces today — the web component will be migrated
 * to this shape in a follow-up PR so there's a single source of truth.
 */

// ── Inputs ────────────────────────────────────────────────────────────────────

/**
 * Wire-shape session row. Matches what `getDashboardData()` already
 * has from the `raceSessions` table after Drizzle hydration —
 * `createdAt` is ISO 8601, `metadata` is the parsed JSON blob.
 */
export interface PreviousRaceInput {
  id: string
  carModel: string
  manufacturer: string | null
  trackName: string | null
  finishPosition: number | null
  incidentCount: number | null
  sessionType: string | null
  category: string
  metadata: Record<string, unknown> | null
  gameName: string | null
  createdAt: string
}

// ── Outputs ───────────────────────────────────────────────────────────────────

export interface PreviousRaceSession {
  id: string
  carModel: string
  manufacturer: string | null
  trackName: string | null
  trackConfig: string | null
  finishPosition: number | null
  incidentCount: number | null
  /** Race-portion best lap in seconds (decimal). null when unknown. */
  bestLapTime: number | null
  /** Number of cars on the grid for this race. null when unknown. */
  fieldSize: number | null
  completedLaps: number | null
  gameName: string | null
  sessionType: string | null
  category: string
  createdAt: string
}

/**
 * Server-baked presentation strings + colors for a single Previous
 * Races card. Renderers use these verbatim — there is no client-side
 * formatting fallback.
 */
export interface PreviousRaceViewModel {
  /** Which tab the card belongs to in the session-type segmented control. */
  sessionTypeTab: 'races' | 'practices' | 'time_trials'
  /**
   * Pre-resolved label for the giant position badge.
   *   - "P1".."P40" — finished race
   *   - "DNF"       — race with completed laps but no finish position
   *   - "TT"        — time trial
   *   - "—"         — race with zero completed laps (no-show / disconnect)
   *   - null        — practice (no badge shown)
   */
  positionDisplay: string | null
  /** Hex color tied to `positionDisplay`. null mirrors `positionDisplay === null`. */
  positionColorHex: string | null
  /** "of 24" — null when fieldSize unknown or badge is DNF/TT/—. */
  fieldSizeLabel: string | null
  /** Race best lap formatted as "m:ss.fff" or "—". */
  bestLapLabel: string
  /** Paired practice best lap, when present. */
  practiceBestLapLabel: string | null
  /** Paired qualifying best lap, when present. */
  qualifyingBestLapLabel: string | null
  /** Paired qualifying position label "P3", or null. */
  qualifyingPositionLabel: string | null
  /** Date formatted in the user's TZ — e.g. "Apr 28". */
  dateLabel: string
  /** Humanised session label — "Race" / "Time Trial" / "Practice" / etc. */
  sessionLabel: string
  /** "3× incidents" on the headline session, or null. */
  incidentsLabel: string | null
  /** "1× incident" on the paired practice, or null. */
  practiceIncidentsLabel: string | null
  /** Display name of the game — "iRacing" / "ACC" / "rFactor" / etc. */
  gameLabel: string
  /**
   * Track display label suitable for the card heading. Populated by
   * `getDashboardData()` post-processing after lookups are built —
   * uses the lookup's `displayName` (which now title-cases unknown
   * tracks) plus the trackConfig suffix when present. The calc itself
   * emits a raw fallback ("Sebring — National") that the post-process
   * step replaces with the canonical form.
   */
  trackLabel: string
  /**
   * Single canonical key for resolving the track in the dashboard
   * `lookups.tracks` array. Populated by `getDashboardData()`
   * post-processing — clients render `lookups.tracks[key]` directly
   * with no synonym-folding required.
   */
  trackLookupKey: string
}

export interface PreviousRaceCard {
  session: PreviousRaceSession
  practiceSession?: PreviousRaceSession
  qualifyingSession?: PreviousRaceSession
  viewModel: PreviousRaceViewModel
}

// ── Predicates ────────────────────────────────────────────────────────────────
//
// Inlined here (rather than importing `@/lib/session-filters` from
// the web app) so the web-api package stays free of inbound deps on
// the web app. Same definitions — kept identical so they can't drift.

function classifySessionType(s: { sessionType: string | null; category: string }): 'race' | 'practice' | 'qualifying' {
  const t = (s.sessionType || s.category || '').toLowerCase()
  if (t.includes('practice') || t.includes('warmup')) return 'practice'
  if (t.includes('qualify') || t.includes('qual')) return 'qualifying'
  return 'race'
}

function isPractice(s: PreviousRaceInput): boolean {
  return classifySessionType(s) === 'practice'
}

function isQualifying(s: PreviousRaceInput): boolean {
  return classifySessionType(s) === 'qualifying'
}

function isRace(s: PreviousRaceInput): boolean {
  return classifySessionType(s) === 'race'
}

// ── Track-id helpers ──────────────────────────────────────────────────────────
//
// Same logic as `sessionTrackId()` in `dashboard/page.tsx` — pair
// races with practice/qual at the SAME track. We can't import the
// web app's resolver into web-api, so we keep a minimal inline form
// that handles the two common shapes found in the metadata blob.

function trackIdFor(s: PreviousRaceInput): string {
  const meta = s.metadata ?? {}
  const prodriveId = meta.prodriveTrackId
  if (typeof prodriveId === 'string' && prodriveId.length > 0) return prodriveId
  // Bare track name + config is good enough for the pairing window —
  // worst case, two visits to the same track within an 8-hour window
  // pair correctly. The web's `resolveIRacingTrackId` adds
  // synonym-folding which doesn't change behavior for the pairing
  // window since the same user typically sees consistent names.
  const cfg = (meta.iracingTrackConfig as string | undefined) ?? ''
  return `${(s.trackName ?? '').toLowerCase()}|${cfg.toLowerCase()}`
}

// ── Position color (matches RaceCard.tsx) ────────────────────────────────────
//
// The web component uses inline `hsl(...)` for these. Pre-converted
// to hex here so native clients render exactly the same shade
// without re-implementing HSL conversion.

const POSITION_COLOR = {
  gold:   '#F5CA47',  // hsl(45, 90%, 62%) — 1st
  silver: '#C7C7C7',  // hsl(0,  0%, 78%)  — 2nd
  bronze: '#DA944E',  // hsl(30, 65%, 58%) — 3rd
  top10:  '#54D483',  // hsl(142,60%, 58%) — 4..10
  dnf:    '#E46767',  // hsl(0,  70%, 65%)
  tt:     '#70B8DB',  // hsl(200,60%, 65%)
  dim:    '#7B7B85',  // var(--text-dim) approximation
} as const

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatLap(t: number | null | undefined): string {
  if (t === null || t === undefined) return '—'
  if (!Number.isFinite(t) || t <= 0) return '—'
  const minutes = Math.floor(t / 60)
  const seconds = t - minutes * 60
  const padded = seconds < 10 ? '0' : ''
  return `${minutes}:${padded}${seconds.toFixed(3)}`
}

function getGameLabel(name: string | null | undefined): string {
  const n = (name ?? '').toLowerCase()
  if (n === '' || n === 'iracing') return 'iRacing'
  if (n === 'acc' || n.includes('assetto corsa')) return 'ACC'
  if (n === 'raceroom') return 'RaceRoom'
  if (n.includes('rfactor')) return 'rFactor'
  if (n.includes('automobilista') || n === 'ams') return 'AMS'
  // Title-case fallback for unknown games.
  return name && name.length > 0 ? name.charAt(0).toUpperCase() + name.slice(1) : 'iRacing'
}

function humaniseSessionLabel(sessionType: string | null, category: string): string {
  const raw = (sessionType ?? category ?? '').trim()
  if (!raw) return 'Race'
  // "openPractice" → "open Practice" → " " split → "Open Practice"
  const spaced = raw.replace(/([a-z])([A-Z])/g, '$1 $2')
  return spaced
    .split(/\s+/)
    .map(w => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

function formatDateInTz(iso: string, timeZone: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' })
  return fmt.format(d)
}

function metaNumber(meta: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!meta) return null
  const v = meta[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function metaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!meta) return null
  const v = meta[key]
  return typeof v === 'string' ? v : null
}

function toSession(s: PreviousRaceInput): PreviousRaceSession {
  const meta = s.metadata ?? null
  return {
    id: s.id,
    carModel: s.carModel,
    manufacturer: s.manufacturer,
    trackName: s.trackName,
    trackConfig: metaString(meta, 'iracingTrackConfig') ?? metaString(meta, 'trackConfig'),
    finishPosition: s.finishPosition,
    incidentCount: s.incidentCount,
    bestLapTime: metaNumber(meta, 'bestLapTime'),
    fieldSize: metaNumber(meta, 'fieldSize'),
    completedLaps: metaNumber(meta, 'completedLaps'),
    gameName: s.gameName,
    sessionType: s.sessionType,
    category: s.category,
    createdAt: s.createdAt,
  }
}

// ── View-model builder ────────────────────────────────────────────────────────

/**
 * Time-trial detection. Web's `RaceCard` reads `metadata.eventType`
 * (set by the iRacing import path to "Time Trial" / "Lone Qualifying"
 * for those event kinds). The tab classifier in `RaceHistory.tsx`
 * also looks at `sessionType` strings — we union both so a TT shows
 * up consistently regardless of which field carries the marker.
 */
function detectTimeTrial(s: PreviousRaceInput): boolean {
  const sessionTypeLower = (s.sessionType ?? s.category ?? '').toLowerCase()
  const eventType = (metaString(s.metadata, 'eventType') ?? '').toLowerCase()
  return (
    sessionTypeLower.includes('time trial') ||
    sessionTypeLower.includes('time_trial') ||
    sessionTypeLower.includes('timetrial') ||
    sessionTypeLower.includes('lone qual') ||
    eventType.includes('time trial') ||
    eventType.includes('time_trial') ||
    eventType.includes('lone qualifying')
  )
}

function buildViewModel(
  session: PreviousRaceSession,
  practice: PreviousRaceSession | undefined,
  qualifying: PreviousRaceSession | undefined,
  timeZone: string,
  sessionTypeKind: 'race' | 'practice' | 'qualifying',
  isTT: boolean,
): PreviousRaceViewModel {
  const isPracticeRow = sessionTypeKind === 'practice'
  const completed = session.completedLaps ?? 0
  const pos = session.finishPosition

  const isDNF = !isPracticeRow && !isTT && (!pos || pos === 0) && completed > 0
  const isNoPosition = !isPracticeRow && !isTT && (!pos || pos === 0) && completed === 0

  // sessionTypeTab — drives the session-type tab grouping
  let sessionTypeTab: PreviousRaceViewModel['sessionTypeTab']
  if (isPracticeRow) sessionTypeTab = 'practices'
  else if (isTT) sessionTypeTab = 'time_trials'
  else sessionTypeTab = 'races'

  // Position display + color
  let positionDisplay: string | null = null
  let positionColorHex: string | null = null
  if (isPracticeRow) {
    positionDisplay = null
    positionColorHex = null
  } else if (isTT) {
    positionDisplay = 'TT'
    positionColorHex = POSITION_COLOR.tt
  } else if (isDNF) {
    positionDisplay = 'DNF'
    positionColorHex = POSITION_COLOR.dnf
  } else if (isNoPosition) {
    positionDisplay = '—'
    positionColorHex = POSITION_COLOR.dim
  } else if (pos === 1) {
    positionDisplay = `P${pos}`
    positionColorHex = POSITION_COLOR.gold
  } else if (pos === 2) {
    positionDisplay = `P${pos}`
    positionColorHex = POSITION_COLOR.silver
  } else if (pos === 3) {
    positionDisplay = `P${pos}`
    positionColorHex = POSITION_COLOR.bronze
  } else if (pos && pos <= 10) {
    positionDisplay = `P${pos}`
    positionColorHex = POSITION_COLOR.top10
  } else if (pos) {
    positionDisplay = `P${pos}`
    positionColorHex = POSITION_COLOR.dim
  }

  // Field size — only meaningful for an ordinary race finish
  const fieldSizeLabel =
    !isPracticeRow && !isTT && !isDNF && !isNoPosition && session.fieldSize && session.fieldSize > 0
      ? `of ${session.fieldSize}`
      : null

  // Best laps
  const bestLapLabel = formatLap(session.bestLapTime)
  const practiceBestLapLabel = practice ? formatLap(practice.bestLapTime) : null
  const qualifyingBestLapLabel = qualifying ? formatLap(qualifying.bestLapTime) : null
  const qualifyingPositionLabel =
    qualifying?.finishPosition && qualifying.finishPosition > 0
      ? `P${qualifying.finishPosition}`
      : null

  // Incidents
  const incidentsLabel =
    session.incidentCount && session.incidentCount > 0 ? `${session.incidentCount}× incidents` : null
  const practiceIncidentsLabel =
    practice?.incidentCount && practice.incidentCount > 0
      ? `${practice.incidentCount}× incidents`
      : null

  // Track label — config suffix when present
  const baseTrack = session.trackName ?? 'Unknown Track'
  const trackLabel = session.trackConfig ? `${baseTrack} — ${session.trackConfig}` : baseTrack

  return {
    sessionTypeTab,
    positionDisplay,
    positionColorHex,
    fieldSizeLabel,
    bestLapLabel,
    practiceBestLapLabel,
    qualifyingBestLapLabel,
    qualifyingPositionLabel,
    dateLabel: formatDateInTz(session.createdAt, timeZone),
    sessionLabel: humaniseSessionLabel(session.sessionType, session.category),
    incidentsLabel,
    practiceIncidentsLabel,
    gameLabel: getGameLabel(session.gameName),
    trackLabel,
    // Filled in by `getDashboardData()` after lookups are built —
    // the calc itself doesn't have lookup data. Empty string is the
    // explicit "not yet resolved" sentinel.
    trackLookupKey: '',
  }
}

// ── Pairing + grouping (Pass 1 / Pass 2 from page.tsx) ───────────────────────

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000

/**
 * Build the Previous Races card list from the user's full session
 * history. Pairs each race with the most-recent same-track practice
 * + qualifying inside an 8-hour window (matching `dashboard/page.tsx`),
 * then bakes per-card view-model strings.
 *
 * Returns newest-first — ready for the renderer to slice / paginate.
 */
export function buildPreviousRaceCards(
  sessions: PreviousRaceInput[],
  timeZone: string = 'UTC',
): PreviousRaceCard[] {
  if (sessions.length === 0) return []

  // Sort ascending so the "look back" pass scans chronologically.
  const sortedAsc = [...sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

  const consumed = new Set<string>()
  const practiceForRace = new Map<string, PreviousRaceInput>()
  const qualifyingForRace = new Map<string, PreviousRaceInput>()

  // Pass 1: pair each race with the immediately preceding practice
  // and qualifying on the same track inside the 8-hour window.
  for (let i = 0; i < sortedAsc.length; i++) {
    const race = sortedAsc[i]
    if (!isRace(race)) continue
    const raceTrackId = trackIdFor(race)
    const raceMs = new Date(race.createdAt).getTime()

    for (let j = i - 1; j >= 0; j--) {
      const prev = sortedAsc[j]
      if (consumed.has(prev.id)) continue
      const prevMs = new Date(prev.createdAt).getTime()
      if (raceMs - prevMs >= EIGHT_HOURS_MS) break
      if (trackIdFor(prev) !== raceTrackId) continue

      if (isQualifying(prev) && !qualifyingForRace.has(race.id)) {
        qualifyingForRace.set(race.id, prev)
        consumed.add(prev.id)
      } else if (isPractice(prev) && !practiceForRace.has(race.id)) {
        practiceForRace.set(race.id, prev)
        consumed.add(prev.id)
      }
    }
  }

  // Pass 2: emit cards. Consumed practice/qual rows fold into their
  // owning race card; everything else stands alone.
  const cards: PreviousRaceCard[] = []
  for (const s of sortedAsc) {
    if (consumed.has(s.id)) continue
    const sessionKind = classifySessionType(s)
    const practiceRaw = sessionKind === 'race' ? practiceForRace.get(s.id) : undefined
    const qualifyingRaw = sessionKind === 'race' ? qualifyingForRace.get(s.id) : undefined

    const session = toSession(s)
    const practice = practiceRaw ? toSession(practiceRaw) : undefined
    const qualifying = qualifyingRaw ? toSession(qualifyingRaw) : undefined

    cards.push({
      session,
      practiceSession: practice,
      qualifyingSession: qualifying,
      viewModel: buildViewModel(session, practice, qualifying, timeZone, sessionKind, detectTimeTrial(s)),
    })
  }

  // Newest first.
  return cards.reverse()
}
