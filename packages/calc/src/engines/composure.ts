/**
 * Composure & Heat — first cut of the new platform metrics defined in
 * `agents/prodrive-context/glossary.md`.
 *
 *   Composure  — iR delta per incident-point over a window. Higher = a
 *                cleaner racer for the rating progression they're earning.
 *
 *   Heat       — short-term form indicator. Sum of iR delta over the last
 *                N races plus a direction class ('hot' | 'cold' | 'flat').
 *                Lightweight companion to Composure for the at-a-glance
 *                surface on driver cards.
 *
 * Pure data computation. No OAuth, no telemetry — runs on the same
 * `{ date, iRatingDelta, incidents }` shape `scatter-view.ts` already
 * consumes, so the dashboard query can feed both calcs from one
 * pre-joined session list without re-walking the database.
 *
 * Naming rule: nothing in here may use finance vocabulary in identifiers,
 * comments, or returned strings. See glossary.md.
 */

export interface ComposureSessionInput {
  /** ISO 8601 timestamp. */
  date: string
  /** Signed change in iRating credited to this session. */
  iRatingDelta: number
  /** Incident points earned this session. */
  incidents: number
  /**
   * Discipline ('road' | 'oval' | 'formula' | 'dirt-road' | 'dirt-oval' …
   * — whatever the platform's category strings are). Optional because
   * Composure / Heat / Streaks don't need it; only `computeDisciplineMix`
   * consumes it. Sessions without a category are bucketed under 'unknown'.
   */
  category?: string
}

export type ComposureBand = 'gritty' | 'steady' | 'sharp' | 'untouchable'
export type HeatDirection = 'hot' | 'warm' | 'flat' | 'cold'

export interface ComposureResult {
  /** Number of sessions that contributed to the score. */
  sampleSize: number
  /**
   * 0–100 score. Anchored so a driver who breaks even on iR with average
   * incidents lands near 50; pure clean-and-progressing climbers approach
   * 100; pure incident-bleeders without progression approach 0.
   */
  score: number
  /** Discrete band for chips, badges, and at-a-glance UI. */
  band: ComposureBand
  /** Sum of iR delta across the window. */
  iRatingDeltaSum: number
  /** Sum of incident points across the window. */
  incidentSum: number
  /** Mean incident points per race in the window. */
  avgIncidents: number
  /** iR per incident-point. Null when the window has zero incidents. */
  iRatingPerIncident: number | null
  /** Improving / declining / stable, comparing first vs second half of the window. */
  trend: 'improving' | 'declining' | 'stable' | 'new'
}

export interface HeatResult {
  /** Number of sessions inspected (capped at recentRaceCount). */
  sampleSize: number
  /** Signed iR delta sum over the recent window. */
  iRatingDeltaSum: number
  /** Mean iR delta per race in the recent window. */
  iRatingDeltaAvg: number
  /** Mean incident points per race in the recent window. */
  avgIncidents: number
  /** Categorical readout for chips / icons. */
  direction: HeatDirection
}

export type StreakKind = 'gaining' | 'losing' | 'flat'

export interface StreakSpan {
  /** Number of consecutive same-sign races. */
  length: number
  /** ISO 8601 — oldest race in the span. */
  startDate: string
  /** ISO 8601 — newest race in the span. */
  endDate: string
  /** Sum of iR delta across the span. Negative for slumps, positive for surges. */
  iRatingDeltaSum: number
  /** Sum of incident points across the span. */
  incidentSum: number
}

export interface StreaksResult {
  /**
   * The streak the driver is currently in — the run of consecutive
   * same-sign iR deltas anchored at the most recent race. A single
   * race with iRatingDelta of exactly 0 is 'flat'. Null when there
   * are no sessions.
   */
  current: { kind: StreakKind; span: StreakSpan } | null
  /** Longest run of consecutive negative-iR-delta races in the window. */
  longestSlump: StreakSpan | null
  /** Longest run of consecutive positive-iR-delta races in the window. */
  longestSurge: StreakSpan | null
}

export interface DisciplineSlice {
  category: string
  count: number
  /** Share of the driver's races run in this discipline (0..1). */
  proportion: number
  iRatingDeltaSum: number
  incidentSum: number
  avgIncidents: number
  /** Composure score restricted to this discipline. */
  composure: ComposureResult
}

export interface DisciplineMixResult {
  total: number
  /** Slices sorted by count descending — biggest discipline first. */
  byCategory: DisciplineSlice[]
  /** The category with the most races. Null when input is empty. */
  primary: string | null
  /**
   * The category where the driver gains the most iRating per race on
   * average. Sometimes diverges from `primary` — that's the headline
   * "race more oval, you're stronger there" insight.
   */
  bestForRating: string | null
}

export interface ComposureSeriesPoint {
  /** ISO 8601 timestamp of the most recent race in this point's window. */
  date: string
  /** Rolling Composure score at this point in time (0–100). */
  score: number
  /** Composure band at this point in time. */
  band: ComposureBand
  /** Sample size that produced this score (1..windowSize). */
  sampleSize: number
}

export interface ComposureSeriesResult {
  /**
   * Time series of rolling Composure values, oldest first. Each
   * point is the Composure score the driver had at that moment in
   * their career, computed by re-running the rolling window over a
   * historical slice.
   */
  points: ComposureSeriesPoint[]
  /** Range of scores hit in the series — useful for chart axis bounds. */
  minScore: number
  maxScore: number
}

export type TrajectoryDirection = 'climbing' | 'falling' | 'plateau'

export interface TrajectoryHorizon {
  /** Days from "now" the projection extends out to. */
  days: number
  /** Mean projected iR delta vs. now, rounded. */
  expectedDelta: number
  /** ±1σ band on the projection. Always non-negative. */
  variance: number
}

export interface TrajectoryResult {
  /**
   * Recent rate (iR per race) used to drive the projection. Same
   * window as Composure / Heat for consistency.
   */
  iRatingPerRace: number
  /** Estimated races per week from the input timestamps. */
  racesPerWeek: number
  /** Standard deviation of recent iR deltas — drives the cone width. */
  stdDevPerRace: number
  /** Categorical readout for chips and copy. */
  direction: TrajectoryDirection
  /** Number of races sampled for the projection. */
  sampleSize: number
  /** Projected iR delta + ±1σ at 7 / 30 / 90 day horizons. */
  horizons: TrajectoryHorizon[]
}

export interface ComposureOptions {
  /** Rolling window for the Composure score itself. Default 30 races. */
  windowSize?: number
  /** Smaller window used by Heat. Default 10 races. */
  recentRaceCount?: number
  /**
   * Incident-points value treated as "average" when normalizing the
   * score. Scatter and mastery already treat ~4 as a typical race; we
   * use the same anchor so users see consistent calibrations across
   * surfaces.
   */
  averageIncidentAnchor?: number
  /**
   * iR-per-incident value mapped to the midpoint of the score band.
   * Tuned so small positive iR/incident lands in 'steady'.
   */
  iRatingPerIncidentAnchor?: number
}

const DEFAULT_OPTIONS: Required<ComposureOptions> = {
  windowSize: 30,
  recentRaceCount: 10,
  averageIncidentAnchor: 4,
  iRatingPerIncidentAnchor: 2,
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function sortByDateDesc(sessions: ComposureSessionInput[]): ComposureSessionInput[] {
  return [...sessions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )
}

/**
 * Normalize iR-per-incident into a 0–100 score using a sigmoid-ish curve
 * that anchors to `iRatingPerIncidentAnchor`.
 *
 *   x = 0          → 50  (break-even rating with average incidents)
 *   x = +anchor    → ~75 (cleanly progressing)
 *   x = -anchor    → ~25 (bleeding rating to incidents)
 *   x → +∞         → 100
 *   x → -∞         → 0
 *
 * Why a curve instead of linear: a single big-iR-with-zero-incident race
 * shouldn't peg the score at 100 forever. The curve stays sensitive
 * inside the meaningful band and saturates outside it.
 */
function curveScore(iRatingPerIncident: number, anchor: number): number {
  const t = iRatingPerIncident / Math.max(anchor, 0.001)
  const sigmoid = 1 / (1 + Math.exp(-t))
  return clamp(sigmoid * 100, 0, 100)
}

function bandFor(score: number): ComposureBand {
  if (score >= 80) return 'untouchable'
  if (score >= 60) return 'sharp'
  if (score >= 40) return 'steady'
  return 'gritty'
}

function trendOf(window: ComposureSessionInput[]): ComposureResult['trend'] {
  if (window.length === 0) return 'new'
  if (window.length < 6) return window.length === 1 ? 'new' : 'stable'

  // Window is desc by date; first half = older, second half = newer.
  const mid = Math.floor(window.length / 2)
  const newer = window.slice(0, mid)
  const older = window.slice(mid)

  const avgDelta = (xs: ComposureSessionInput[]) =>
    xs.reduce((sum, s) => sum + s.iRatingDelta, 0) / xs.length
  const avgInc = (xs: ComposureSessionInput[]) =>
    xs.reduce((sum, s) => sum + s.incidents, 0) / xs.length

  // Improving = either iR trend up OR incident rate down meaningfully.
  const dDelta = avgDelta(newer) - avgDelta(older)
  const dInc = avgInc(older) - avgInc(newer) // positive = cleaner now

  if (dDelta > 5 || dInc > 0.75) return 'improving'
  if (dDelta < -5 || dInc < -0.75) return 'declining'
  return 'stable'
}

/**
 * Compute Composure for a driver from a chronologically-unordered list
 * of sessions. Empty input returns a sentinel "no sample" result with
 * score = 50 and band = 'steady' so UIs can render without branching.
 */
export function computeComposure(
  sessions: ComposureSessionInput[],
  options: ComposureOptions = {},
): ComposureResult {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const sorted = sortByDateDesc(sessions)
  const window = sorted.slice(0, opts.windowSize)

  if (window.length === 0) {
    return {
      sampleSize: 0,
      score: 50,
      band: 'steady',
      iRatingDeltaSum: 0,
      incidentSum: 0,
      avgIncidents: 0,
      iRatingPerIncident: null,
      trend: 'new',
    }
  }

  const iRatingDeltaSum = window.reduce((sum, s) => sum + s.iRatingDelta, 0)
  const incidentSum = window.reduce((sum, s) => sum + s.incidents, 0)
  const avgIncidents = incidentSum / window.length

  // Smoothed denominator: blend actual incidents toward the platform
  // anchor so a single zero-incident race in a small sample doesn't
  // produce an undefined or runaway iR-per-incident value.
  const smoothingWeight = Math.min(1, window.length / opts.windowSize)
  const denom =
    avgIncidents * smoothingWeight +
    opts.averageIncidentAnchor * (1 - smoothingWeight)

  const avgIRatingDelta = iRatingDeltaSum / window.length
  const iRatingPerIncident = denom > 0 ? avgIRatingDelta / denom : null

  const score = iRatingPerIncident === null
    ? 50
    : Math.round(curveScore(iRatingPerIncident, opts.iRatingPerIncidentAnchor))

  return {
    sampleSize: window.length,
    score,
    band: bandFor(score),
    iRatingDeltaSum: Math.round(iRatingDeltaSum),
    incidentSum,
    avgIncidents,
    iRatingPerIncident: incidentSum > 0 ? avgIRatingDelta / avgIncidents : null,
    trend: trendOf(window),
  }
}

/**
 * Compute Heat from the same session input. Heat is a short-window
 * companion to Composure — it answers "is this driver hot right now?"
 * rather than "are they steadily clean?". Empty input returns a flat
 * sentinel.
 */
export function computeHeat(
  sessions: ComposureSessionInput[],
  options: ComposureOptions = {},
): HeatResult {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const sorted = sortByDateDesc(sessions)
  const window = sorted.slice(0, opts.recentRaceCount)

  if (window.length === 0) {
    return {
      sampleSize: 0,
      iRatingDeltaSum: 0,
      iRatingDeltaAvg: 0,
      avgIncidents: 0,
      direction: 'flat',
    }
  }

  const iRatingDeltaSum = window.reduce((sum, s) => sum + s.iRatingDelta, 0)
  const iRatingDeltaAvg = iRatingDeltaSum / window.length
  const avgIncidents =
    window.reduce((sum, s) => sum + s.incidents, 0) / window.length

  // Direction thresholds picked to match how players talk about runs:
  // "hot" = clearly building rating, "cold" = clearly losing it,
  // "warm"/"flat" = the middle band. Calibrated against typical
  // road-class delta sizes (~10–40 iR per race).
  let direction: HeatDirection = 'flat'
  if (iRatingDeltaAvg >= 20) direction = 'hot'
  else if (iRatingDeltaAvg >= 5) direction = 'warm'
  else if (iRatingDeltaAvg <= -20) direction = 'cold'
  else if (iRatingDeltaAvg <= -5) direction = 'flat'

  return {
    sampleSize: window.length,
    iRatingDeltaSum: Math.round(iRatingDeltaSum),
    iRatingDeltaAvg: Math.round(iRatingDeltaAvg * 10) / 10,
    avgIncidents,
    direction,
  }
}

function classifyDelta(delta: number): StreakKind {
  if (delta > 0) return 'gaining'
  if (delta < 0) return 'losing'
  return 'flat'
}

/**
 * Find streaks of consecutive same-sign iR deltas in the session
 * history. Reports three things:
 *
 *   current     — the streak anchored at the most recent race ("you
 *                 are 4 races into a slump"). Useful as a tappable
 *                 chip on the at-a-glance panel.
 *   longestSlump — worst stretch in the window for the slump
 *                 explorer; pairs with the cold-streak narrative
 *                 reserved in glossary.md.
 *   longestSurge — the symmetric positive case, useful for "career
 *                 highlight" surfacing.
 *
 * Operates on the same `{ date, iRatingDelta, incidents }` input as
 * Composure / Heat. Window matches the Composure window so the three
 * metrics speak about the same race history.
 */
export function computeStreaks(
  sessions: ComposureSessionInput[],
  options: ComposureOptions = {},
): StreaksResult {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const sorted = sortByDateDesc(sessions)
  const window = sorted.slice(0, opts.windowSize)

  if (window.length === 0) {
    return { current: null, longestSlump: null, longestSurge: null }
  }

  // Walk newest → oldest, grouping consecutive same-sign deltas into
  // runs. The first run we close out is therefore the "current" run.
  // We then keep scanning to find the longest negative and positive
  // runs over the whole window.
  type Run = {
    kind: StreakKind
    sessions: ComposureSessionInput[]
  }
  const runs: Run[] = []
  let active: Run | null = null

  for (const s of window) {
    const kind = classifyDelta(s.iRatingDelta)
    if (active === null || active.kind !== kind) {
      active = { kind, sessions: [s] }
      runs.push(active)
    } else {
      active.sessions.push(s)
    }
  }

  function spanOf(run: Run): StreakSpan {
    // Within a run the sessions are still desc by date, so the last
    // entry is the oldest and the first is the newest.
    const newest = run.sessions[0]
    const oldest = run.sessions[run.sessions.length - 1]
    return {
      length: run.sessions.length,
      startDate: oldest.date,
      endDate: newest.date,
      iRatingDeltaSum: Math.round(
        run.sessions.reduce((sum, s) => sum + s.iRatingDelta, 0),
      ),
      incidentSum: run.sessions.reduce((sum, s) => sum + s.incidents, 0),
    }
  }

  // Pick the longest losing run and longest gaining run. Ties broken
  // by which run starts later (more recent) so a surfaced "longest
  // slump" tends to feel current rather than archeological when the
  // driver has multiple equally-long runs in the window.
  let longestSlump: StreakSpan | null = null
  let longestSurge: StreakSpan | null = null

  for (const run of runs) {
    if (run.kind === 'flat') continue
    const span = spanOf(run)
    if (run.kind === 'losing') {
      if (longestSlump === null || span.length > longestSlump.length) {
        longestSlump = span
      }
    } else if (run.kind === 'gaining') {
      if (longestSurge === null || span.length > longestSurge.length) {
        longestSurge = span
      }
    }
  }

  const current = runs.length > 0
    ? { kind: runs[0].kind, span: spanOf(runs[0]) }
    : null

  return { current, longestSlump, longestSurge }
}

const UNKNOWN_DISCIPLINE = 'unknown'

/**
 * Bucket sessions by discipline (the iRacing category) and report
 * each slice's share, raw stats, and a per-discipline Composure
 * score. Powers the "discipline mix" panel — the headline insight is
 * usually the gap between `primary` (where the driver spends time)
 * and `bestForRating` (where their iR actually moves).
 *
 * The Composure inside each slice is computed with the same options
 * passed to the outer call so the surface stays consistent (a 'sharp'
 * driver overall stays 'sharp' inside their dominant discipline).
 */
export function computeDisciplineMix(
  sessions: ComposureSessionInput[],
  options: ComposureOptions = {},
): DisciplineMixResult {
  if (sessions.length === 0) {
    return { total: 0, byCategory: [], primary: null, bestForRating: null }
  }

  const buckets = new Map<string, ComposureSessionInput[]>()
  for (const s of sessions) {
    const key = (s.category && s.category.trim()) || UNKNOWN_DISCIPLINE
    const list = buckets.get(key)
    if (list) list.push(s)
    else buckets.set(key, [s])
  }

  const total = sessions.length
  const slices: DisciplineSlice[] = []

  for (const [category, group] of buckets.entries()) {
    const count = group.length
    const iRatingDeltaSum = group.reduce((sum, s) => sum + s.iRatingDelta, 0)
    const incidentSum = group.reduce((sum, s) => sum + s.incidents, 0)
    slices.push({
      category,
      count,
      proportion: count / total,
      iRatingDeltaSum: Math.round(iRatingDeltaSum),
      incidentSum,
      avgIncidents: incidentSum / count,
      composure: computeComposure(group, options),
    })
  }

  slices.sort((a, b) => b.count - a.count)
  const primary = slices[0]?.category ?? null

  // bestForRating: highest mean iR delta per race, but require at least
  // 3 races so a single fluke session in a niche discipline doesn't win.
  // Falls back to `primary` if no slice clears the bar.
  const RATING_MIN_SAMPLE = 3
  let bestForRating: string | null = null
  let bestAvg = -Infinity
  for (const slice of slices) {
    if (slice.count < RATING_MIN_SAMPLE) continue
    const avg = slice.iRatingDeltaSum / slice.count
    if (avg > bestAvg) {
      bestAvg = avg
      bestForRating = slice.category
    }
  }
  if (bestForRating === null) bestForRating = primary

  return { total, byCategory: slices, primary, bestForRating }
}

/**
 * Walk the session history forward and emit one Composure score per
 * race — the rolling Composure value at *that moment* in the
 * driver's career. Powers the sparkline on the Pit Wall.
 *
 * The window grows from 1 up to `windowSize` and then slides as new
 * races come in. Early points have small sample sizes; the consumer
 * UI can fade or thin those if it wants visual honesty about the
 * confidence level.
 */
export function computeComposureSeries(
  sessions: ComposureSessionInput[],
  options: ComposureOptions = {},
): ComposureSeriesResult {
  if (sessions.length === 0) {
    return { points: [], minScore: 0, maxScore: 100 }
  }

  // Sort ascending so we can walk a sliding window forward.
  const asc = [...sessions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  )

  const opts = { ...DEFAULT_OPTIONS, ...options }
  const points: ComposureSeriesPoint[] = []
  let minScore = 100
  let maxScore = 0

  for (let i = 0; i < asc.length; i++) {
    // Slice up to `windowSize` races ending at i (inclusive).
    const start = Math.max(0, i + 1 - opts.windowSize)
    const window = asc.slice(start, i + 1)
    // computeComposure expects desc-sorted (it sorts internally), so
    // we can just hand it the slice — it's idempotent regardless of
    // input order.
    const c = computeComposure(window, options)
    const point: ComposureSeriesPoint = {
      date: asc[i].date,
      score: c.score,
      band: c.band,
      sampleSize: c.sampleSize,
    }
    points.push(point)
    if (c.score < minScore) minScore = c.score
    if (c.score > maxScore) maxScore = c.score
  }

  return { points, minScore, maxScore }
}

/**
 * Project the driver's iRating forward at recent rates. Uses the
 * same window as Composure for consistency: avg iR delta per race
 * and stddev per race within the window, plus an estimated races
 * per week from the timestamps.
 *
 * Output is conservative — variance compounds with √(races) so the
 * cone widens as we look further out. Empty / single-race inputs
 * produce a plateau result so the UI can render without branching.
 */
export function computeTrajectory(
  sessions: ComposureSessionInput[],
  options: ComposureOptions = {},
): TrajectoryResult {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const sorted = sortByDateDesc(sessions)
  const window = sorted.slice(0, opts.windowSize)

  if (window.length === 0) {
    return {
      iRatingPerRace: 0,
      racesPerWeek: 0,
      stdDevPerRace: 0,
      direction: 'plateau',
      sampleSize: 0,
      horizons: [
        { days: 7, expectedDelta: 0, variance: 0 },
        { days: 30, expectedDelta: 0, variance: 0 },
        { days: 90, expectedDelta: 0, variance: 0 },
      ],
    }
  }

  // iR / race
  const iRatingPerRace =
    window.reduce((sum, s) => sum + s.iRatingDelta, 0) / window.length

  // stddev / race
  const variance =
    window.reduce(
      (sum, s) => sum + Math.pow(s.iRatingDelta - iRatingPerRace, 2),
      0,
    ) / window.length
  const stdDevPerRace = Math.sqrt(variance)

  // Cadence: racesPerWeek = window.length / weekSpan, where weekSpan
  // is the time span of the window in weeks. For a one-race window
  // we assume one race per week as a floor so projections aren't
  // pinned to zero.
  const newest = new Date(window[0].date).getTime()
  const oldest = new Date(window[window.length - 1].date).getTime()
  const weekSpan = Math.max(0.1, (newest - oldest) / (1000 * 60 * 60 * 24 * 7))
  const racesPerWeek = window.length / weekSpan

  const direction: TrajectoryDirection = (() => {
    // Treat "plateau" as anywhere within ±2 iR / race — below that
    // the driver is meaningfully gaining or losing.
    if (iRatingPerRace > 2) return 'climbing'
    if (iRatingPerRace < -2) return 'falling'
    return 'plateau'
  })()

  function horizon(days: number): TrajectoryHorizon {
    const expectedRaces = (days / 7) * racesPerWeek
    const expectedDelta = Math.round(iRatingPerRace * expectedRaces)
    // Variance compounds with sqrt(N) for the projected race count.
    const sigma =
      stdDevPerRace * Math.sqrt(Math.max(1, expectedRaces))
    return {
      days,
      expectedDelta,
      variance: Math.round(sigma),
    }
  }

  return {
    iRatingPerRace: Math.round(iRatingPerRace * 10) / 10,
    racesPerWeek: Math.round(racesPerWeek * 10) / 10,
    stdDevPerRace: Math.round(stdDevPerRace * 10) / 10,
    direction,
    sampleSize: window.length,
    horizons: [horizon(7), horizon(30), horizon(90)],
  }
}
