import { DEFAULT_TZ, getDayInTz, getHourInTz } from './tz.js'

export interface TemporalSlice {
  label: string
  sessionCount: number
  avgPosition: number | null
  avgIRatingDelta: number | null
  avgIncidents: number
  winRate: number
  podiumRate: number
  topTenRate: number
}

export interface WhenInsight {
  type: 'positive' | 'negative' | 'neutral'
  text: string
}

// Tier for a single hour-of-day, derived from where that hour ranks within
// the user's *own* distribution. Replaces the old absolute-threshold scheme
// in race-now-verdict where most hours collapsed to "marginal" — under a
// quantile-based scheme, ~25% of eligible hours are 'good' and ~25% are
// 'risky' regardless of the user's overall cleanliness baseline.
export type SlotTier =
  | 'best'         // rank 0 — the user's single cleanest hour
  | 'good'         // top quartile (excluding best)
  | 'clean-side'   // P50–P75
  | 'messy-side'   // P25–P50
  | 'risky'        // bottom quartile
  | 'insufficient' // sample floor not met for this hour

export interface RankedSlot {
  hour: number                        // 0–23
  // 0-based rank among eligible hour-slots (0 = cleanest). null when this
  // slot didn't meet the sample floor.
  rank: number | null
  // Cleanliness percentile within the user's own eligible slots. 100 = your
  // cleanest hour; 0 = your messiest. null when ineligible.
  percentile: number | null
  tier: SlotTier
  sessionCount: number
  avgIncidents: number
  avgPosition: number | null
}

export interface WhenProfile {
  byHour: TemporalSlice[]          // 24 slots
  byDayOfWeek: TemporalSlice[]     // 7 slots (Mon=0 through Sun=6)
  bySessionLength: TemporalSlice[]  // Short/Medium/Long
  peakHours: string
  peakDays: string
  worstHours: string
  worstDays: string
  peakHourStart: number            // starting hour index of best 3h window
  worstHourStart: number           // starting hour index of worst 3h window
  windowSize: number               // how many hours in each window (3)
  insights: WhenInsight[]
  heatmapData: { day: number; hour: number; score: number; count: number }[]
  // Per-hour rank + tier for relative-to-self verdicts. Computed once at
  // profile-build time so race-now evaluation is a cheap lookup instead of
  // re-sorting all 24 hours per request.
  rankedSlots: RankedSlot[]
}

interface RaceSession {
  id: string
  userId: string
  carModel: string
  manufacturer?: string
  category: string
  gameName: string
  trackName?: string | null
  sessionType?: string | null
  finishPosition: number | null
  incidentCount: number | null
  metadata: Record<string, any> | null
  createdAt: Date | string
}

interface RatingHistoryEntry {
  id: string
  userId: string
  category: string
  iRating: number
  safetyRating: string
  license: string
  prevIRating: number | null
  prevSafetyRating?: string | null
  prevLicense?: string | null
  sessionType?: string | null
  trackName?: string | null
  carModel?: string | null
  createdAt: Date | string
}

function createEmptyTemporalSlice(label: string): TemporalSlice {
  return {
    label,
    sessionCount: 0,
    avgPosition: null,
    avgIRatingDelta: null,
    avgIncidents: 0,
    winRate: 0,
    podiumRate: 0,
    topTenRate: 0,
  }
}

function getHourLabel(hour: number): string {
  if (hour === 0) return '12am'
  if (hour < 12) return `${hour}am`
  if (hour === 12) return '12pm'
  return `${hour - 12}pm`
}

function getDayLabel(day: number): string {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  return days[day] || 'Unknown'
}

function getSessionLengthBucket(completedLaps: number | null | undefined): 'Short' | 'Medium' | 'Long' {
  if (!completedLaps) return 'Short'
  if (completedLaps < 15) return 'Short'
  if (completedLaps <= 30) return 'Medium'
  return 'Long'
}

// Minimum races in an hour-bucket before it can earn a tier. Matches the
// MIN_RACES_FOR_VERDICT floor in race-now-verdict so consumers stay in sync.
const MIN_SAMPLE_FOR_RANK = 3

export function computeRankedSlots(byHour: TemporalSlice[]): RankedSlot[] {
  // Score by avgIncidents only (lower = cleaner). The race-now verdict
  // already weighted incidents 2× over finish position because incidents
  // measure self-inflicted mess while position depends on opponents — for a
  // "headspace" read, incidents alone is the cleanest signal. Position is
  // kept on the slot for downstream display, not used for ranking.
  const eligible = byHour
    .map((slice, hour) => ({ hour, score: slice.avgIncidents, slice }))
    .filter(s => s.slice.sessionCount >= MIN_SAMPLE_FOR_RANK)

  // Ascending by incidents; tiebreak by hour for determinism.
  eligible.sort((a, b) => a.score - b.score || a.hour - b.hour)

  const N = eligible.length
  const ranked = new Map<number, { rank: number; percentile: number; tier: SlotTier }>()
  eligible.forEach((slot, idx) => {
    // Percentile: 100 = cleanest, 0 = messiest. Single-eligible degenerate
    // case → 100 (the only ranked slot is by definition the user's best).
    const percentile = N === 1 ? 100 : ((N - 1 - idx) / (N - 1)) * 100

    let tier: SlotTier
    if (idx === 0) {
      tier = 'best'
    } else if (N < 4) {
      // Quartiles only become meaningful at N≥4. Below that we'd be calling
      // the user's 2nd-cleanest-of-three "risky" off a tiny sample, which
      // misrepresents how confident we actually are. Collapse the middle to
      // 'clean-side' until enough hours qualify.
      tier = 'clean-side'
    } else if (percentile >= 75) {
      tier = 'good'
    } else if (percentile >= 50) {
      tier = 'clean-side'
    } else if (percentile >= 25) {
      tier = 'messy-side'
    } else {
      tier = 'risky'
    }

    ranked.set(slot.hour, { rank: idx, percentile, tier })
  })

  return Array.from({ length: 24 }, (_, hour) => {
    const slice = byHour[hour]
    const entry = ranked.get(hour)
    return entry
      ? {
          hour,
          rank: entry.rank,
          percentile: entry.percentile,
          tier: entry.tier,
          sessionCount: slice.sessionCount,
          avgIncidents: slice.avgIncidents,
          avgPosition: slice.avgPosition,
        }
      : {
          hour,
          rank: null,
          percentile: null,
          tier: 'insufficient' as SlotTier,
          sessionCount: slice.sessionCount,
          avgIncidents: slice.avgIncidents,
          avgPosition: slice.avgPosition,
        }
  })
}

function findClosestRatingHistory(
  sessionDate: Date,
  ratingHistory: RatingHistoryEntry[]
): RatingHistoryEntry | null {
  let closest: RatingHistoryEntry | null = null
  let minDiff = Infinity

  for (const entry of ratingHistory) {
    const entryDate = new Date(entry.createdAt)
    const diff = Math.abs(entryDate.getTime() - sessionDate.getTime())

    if (diff < minDiff) {
      minDiff = diff
      closest = entry
    }
  }

  return closest
}

export function computeWhenProfile(
  sessions: RaceSession[],
  ratingHistory: RatingHistoryEntry[],
  timeZone: string = DEFAULT_TZ,
): WhenProfile {
  // Initialize 24-hour slices
  const byHour: TemporalSlice[] = Array.from({ length: 24 }, (_, i) =>
    createEmptyTemporalSlice(getHourLabel(i))
  )

  // Initialize 7-day slices (Mon=0 through Sun=6)
  const byDayOfWeek: TemporalSlice[] = Array.from({ length: 7 }, (_, i) =>
    createEmptyTemporalSlice(getDayLabel(i))
  )

  // Initialize session length slices
  const bySessionLength: TemporalSlice[] = [
    createEmptyTemporalSlice('Short'),
    createEmptyTemporalSlice('Medium'),
    createEmptyTemporalSlice('Long'),
  ]

  // Aggregate data
  const hourData: { positions: number[]; deltas: number[]; incidents: number[] }[] = Array.from({ length: 24 }, () => ({
    positions: [],
    deltas: [],
    incidents: [],
  }))
  const dayData: { positions: number[]; deltas: number[]; incidents: number[] }[] = Array.from({ length: 7 }, () => ({
    positions: [],
    deltas: [],
    incidents: [],
  }))
  const lengthData: { positions: number[]; deltas: number[]; incidents: number[] }[] = [
    { positions: [], deltas: [], incidents: [] },
    { positions: [], deltas: [], incidents: [] },
    { positions: [], deltas: [], incidents: [] },
  ]

  const heatmapDataMap: Map<string, { score: number; count: number; scores: number[] }> = new Map()

  for (const session of sessions) {
    const sessionDate = new Date(session.createdAt)
    // Bucket by the user's local time so hour-of-day and day-of-week
    // insights match what the user actually experiences. Server components
    // call this with a timeZone read from the `tz` cookie; the default
    // `UTC` fallback keeps SSR deterministic if the cookie's missing.
    const hour = getHourInTz(sessionDate, timeZone)
    const day = (getDayInTz(sessionDate, timeZone) + 6) % 7 // Convert Sun=0 to Mon=0
    const completedLaps = session.metadata?.completedLaps as number | null
    const preRaceIRating = session.metadata?.preRaceIRating as number | null

    // Find iRating delta
    let iRatingDelta: number | null = null
    if (preRaceIRating !== null && preRaceIRating !== undefined) {
      const closest = findClosestRatingHistory(sessionDate, ratingHistory)
      if (closest && closest.prevIRating) {
        iRatingDelta = closest.iRating - closest.prevIRating
      }
    }

    // Extract metrics
    const position = session.finishPosition ?? null
    const incidents = session.incidentCount ?? 0
    const lengthBucket = getSessionLengthBucket(completedLaps)
    const lengthIdx = lengthBucket === 'Short' ? 0 : lengthBucket === 'Medium' ? 1 : 2

    // Add to hourly data
    if (position !== null) hourData[hour].positions.push(position)
    if (iRatingDelta !== null) hourData[hour].deltas.push(iRatingDelta)
    hourData[hour].incidents.push(incidents)

    // Add to daily data
    if (position !== null) dayData[day].positions.push(position)
    if (iRatingDelta !== null) dayData[day].deltas.push(iRatingDelta)
    dayData[day].incidents.push(incidents)

    // Add to session length data
    if (position !== null) lengthData[lengthIdx].positions.push(position)
    if (iRatingDelta !== null) lengthData[lengthIdx].deltas.push(iRatingDelta)
    lengthData[lengthIdx].incidents.push(incidents)

    // Add to heatmap
    const heatKey = `${day}-${hour}`
    const existing = heatmapDataMap.get(heatKey) || { score: 0, count: 0, scores: [] }
    if (iRatingDelta !== null) {
      existing.scores.push(iRatingDelta)
    } else if (position !== null) {
      // Fallback: normalize position (lower is better)
      existing.scores.push((100 - Math.min(position, 100)) / 100)
    } else {
      // Fallback: inverse incident rate
      existing.scores.push(1 / (1 + incidents / 10))
    }
    existing.count += 1
    heatmapDataMap.set(heatKey, existing)
  }

  // Compute averages for hour.
  // `incidents` is pushed unconditionally per session (positions/deltas are
  // nullable), so its length is the true session count per bucket. The old
  // sum-of-three overcounted by 2-3x and defeated every minimum-sample gate
  // downstream.
  for (let i = 0; i < 24; i++) {
    const h = hourData[i]
    byHour[i].sessionCount = h.incidents.length
    byHour[i].avgPosition = h.positions.length > 0 ? h.positions.reduce((a, b) => a + b, 0) / h.positions.length : null
    byHour[i].avgIRatingDelta = h.deltas.length > 0 ? h.deltas.reduce((a, b) => a + b, 0) / h.deltas.length : null
    byHour[i].avgIncidents = h.incidents.length > 0 ? h.incidents.reduce((a, b) => a + b, 0) / h.incidents.length : 0
    byHour[i].winRate = h.positions.filter(p => p === 1).length / Math.max(h.positions.length, 1)
    byHour[i].podiumRate = h.positions.filter(p => p >= 1 && p <= 3).length / Math.max(h.positions.length, 1)
    byHour[i].topTenRate = h.positions.filter(p => p >= 1 && p <= 10).length / Math.max(h.positions.length, 1)
  }

  // Compute averages for day of week
  for (let i = 0; i < 7; i++) {
    const d = dayData[i]
    byDayOfWeek[i].sessionCount = d.incidents.length
    byDayOfWeek[i].avgPosition = d.positions.length > 0 ? d.positions.reduce((a, b) => a + b, 0) / d.positions.length : null
    byDayOfWeek[i].avgIRatingDelta = d.deltas.length > 0 ? d.deltas.reduce((a, b) => a + b, 0) / d.deltas.length : null
    byDayOfWeek[i].avgIncidents = d.incidents.length > 0 ? d.incidents.reduce((a, b) => a + b, 0) / d.incidents.length : 0
    byDayOfWeek[i].winRate = d.positions.filter(p => p === 1).length / Math.max(d.positions.length, 1)
    byDayOfWeek[i].podiumRate = d.positions.filter(p => p >= 1 && p <= 3).length / Math.max(d.positions.length, 1)
    byDayOfWeek[i].topTenRate = d.positions.filter(p => p >= 1 && p <= 10).length / Math.max(d.positions.length, 1)
  }

  // Compute averages for session length
  for (let i = 0; i < 3; i++) {
    const l = lengthData[i]
    bySessionLength[i].sessionCount = l.incidents.length
    bySessionLength[i].avgPosition = l.positions.length > 0 ? l.positions.reduce((a, b) => a + b, 0) / l.positions.length : null
    bySessionLength[i].avgIRatingDelta = l.deltas.length > 0 ? l.deltas.reduce((a, b) => a + b, 0) / l.deltas.length : null
    bySessionLength[i].avgIncidents = l.incidents.length > 0 ? l.incidents.reduce((a, b) => a + b, 0) / l.incidents.length : 0
    bySessionLength[i].winRate = l.positions.filter(p => p === 1).length / Math.max(l.positions.length, 1)
    bySessionLength[i].podiumRate = l.positions.filter(p => p >= 1 && p <= 3).length / Math.max(l.positions.length, 1)
    bySessionLength[i].topTenRate = l.positions.filter(p => p >= 1 && p <= 10).length / Math.max(l.positions.length, 1)
  }

  // Compute heatmap data with normalization
  const allScores = Array.from(heatmapDataMap.values()).flatMap(d => d.scores)
  const minScore = Math.min(...allScores, 0)
  const maxScore = Math.max(...allScores, 1)
  const scoreRange = maxScore - minScore || 1

  const heatmapData: { day: number; hour: number; score: number; count: number }[] = []
  heatmapDataMap.forEach((data, key) => {
    const [day, hour] = key.split('-').map(Number)
    const avgScore = data.scores.length > 0 ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length : 0
    const normalizedScore = (avgScore - minScore) / scoreRange
    heatmapData.push({ day, hour, score: Math.max(0, Math.min(1, normalizedScore)), count: data.count })
  })

  // Find best/worst 3-hour windows (sliding window across 24h, wraps around)
  //
  // Scoring ingredients — chosen so the "peak" window reflects how the user
  // actually experiences the session, not just the delta number:
  //   + avgIRatingDelta            → reward rating gains
  //   + podiumRate * 50            → reward top-3 finishes (rare, high signal)
  //   - avgIncidents * 3           → penalize dirty racing; without this the
  //                                  ranker will happily flag a window with
  //                                  5.7 avg incidents as "peak" just because
  //                                  iR/podium was slightly better.
  // And we gate on a minimum sample size so a 4-race sliver with one crash
  // doesn't drown out a 44-race window with meaningful signal.
  const WINDOW = 3
  const MIN_SESSIONS_PER_WINDOW = 5 // same threshold as computeWhenProfile gating
  const INCIDENT_WEIGHT = 3

  function hourScore(slice: TemporalSlice): number {
    if (slice.sessionCount === 0) return 0
    return (
      (slice.avgIRatingDelta ?? 0) +
      slice.podiumRate * 50 -
      slice.avgIncidents * INCIDENT_WEIGHT
    )
  }

  let bestWindowStart = -1, bestWindowScore = -Infinity
  let worstWindowStart = -1, worstWindowScore = Infinity
  for (let start = 0; start < 24; start++) {
    let totalScore = 0, totalSessions = 0
    for (let offset = 0; offset < WINDOW; offset++) {
      const idx = (start + offset) % 24
      totalScore += hourScore(byHour[idx])
      totalSessions += byHour[idx].sessionCount
    }
    // Only windows with enough data are eligible for selection. Without the
    // minimum, we'd routinely flag the user's sleep hours (1-2 stray races)
    // as their "worst" window just because noise dominates the average.
    if (totalSessions < MIN_SESSIONS_PER_WINDOW) continue
    const avgScore = totalScore / WINDOW
    if (avgScore > bestWindowScore) {
      bestWindowScore = avgScore
      bestWindowStart = start
    }
    if (avgScore < worstWindowScore) {
      worstWindowScore = avgScore
      worstWindowStart = start
    }
  }
  // Fall back to the raw argmax if NO window met the threshold (rare — only
  // for accounts with very sparse hour distribution).
  if (bestWindowStart === -1) bestWindowStart = 0
  if (worstWindowStart === -1) worstWindowStart = bestWindowStart

  const peakHoursLabel = `${getHourLabel(bestWindowStart)} – ${getHourLabel((bestWindowStart + WINDOW) % 24)}`
  const worstHoursLabel = `${getHourLabel(worstWindowStart)} – ${getHourLabel((worstWindowStart + WINDOW) % 24)}`

  // Find best/worst days. Same scoring and same minimum-sample gate as the
  // hour window — a day with 3 races and one crash shouldn't outrank a day
  // with 30 clean races.
  const MIN_SESSIONS_PER_DAY = 5
  function dayScore(slice: TemporalSlice): number {
    return (
      (slice.avgIRatingDelta ?? 0) +
      slice.podiumRate * 50 -
      slice.avgIncidents * INCIDENT_WEIGHT
    )
  }

  const eligibleDays = byDayOfWeek
    .map((slice, idx) => ({ slice, idx }))
    .filter(({ slice }) => slice.sessionCount >= MIN_SESSIONS_PER_DAY)

  const peakDayIdx =
    eligibleDays.length > 0
      ? eligibleDays.reduce((best, cur) =>
          dayScore(cur.slice) > dayScore(best.slice) ? cur : best,
        ).idx
      : 0

  const worstDayIdx =
    eligibleDays.length > 0
      ? eligibleDays.reduce((worst, cur) =>
          dayScore(cur.slice) < dayScore(worst.slice) ? cur : worst,
        ).idx
      : peakDayIdx

  return {
    byHour,
    byDayOfWeek,
    bySessionLength,
    peakHours: peakHoursLabel,
    peakDays: byDayOfWeek[peakDayIdx].label,
    worstHours: worstHoursLabel,
    worstDays: byDayOfWeek[worstDayIdx].label,
    peakHourStart: bestWindowStart,
    worstHourStart: worstWindowStart,
    windowSize: WINDOW,
    insights: [],
    heatmapData,
    rankedSlots: computeRankedSlots(byHour),
  }
}

export function generateWhenInsights(profile: WhenProfile): WhenInsight[] {
  const insights: WhenInsight[] = []

  const activeHours = profile.byHour.filter(h => h.sessionCount > 0)
  const activeDays = profile.byDayOfWeek.filter(d => d.sessionCount >= 3)

  // ── Weekday vs weekend ─────────────────────────────────────────────────────
  // (Not shown in the badges, so this is new information)
  const weekdayDays = profile.byDayOfWeek.filter((_, i) => i < 5)
  const weekendDays = profile.byDayOfWeek.filter((_, i) => i >= 5)
  const weekdayRaces = weekdayDays.reduce((n, d) => n + d.sessionCount, 0)
  const weekendRaces = weekendDays.reduce((n, d) => n + d.sessionCount, 0)

  if (weekdayRaces > 3 && weekendRaces > 3) {
    const weekdayAvgPodium = weekdayDays.reduce((sum, d) => sum + d.podiumRate, 0) / weekdayDays.length
    const weekendAvgPodium = weekendDays.reduce((sum, d) => sum + d.podiumRate, 0) / weekendDays.length
    const diff = weekendAvgPodium - weekdayAvgPodium

    if (Math.abs(diff) > 0.08) {
      const better = diff > 0 ? 'weekends' : 'weekdays'
      const betterRate = diff > 0 ? weekendAvgPodium : weekdayAvgPodium
      const worseRate = diff > 0 ? weekdayAvgPodium : weekendAvgPodium
      insights.push({
        type: 'positive',
        text: `Stronger on ${better}: ${(betterRate * 100).toFixed(0)}% podium rate vs ${(worseRate * 100).toFixed(0)}%`,
      })
    }
  }

  // ── Session length comparison ──────────────────────────────────────────────
  const buckets = profile.bySessionLength.filter(b => b.sessionCount >= 3)
  if (buckets.length >= 2) {
    const scored = buckets.map(b => ({
      label: b.label,
      score: (b.avgIRatingDelta ?? 0) / 50 + b.podiumRate + b.topTenRate * 0.5,
      delta: b.avgIRatingDelta ?? 0,
      podium: b.podiumRate,
      count: b.sessionCount,
    }))
    scored.sort((a, b) => b.score - a.score)
    const best = scored[0]
    const worst = scored[scored.length - 1]

    if (best.score - worst.score > 0.15) {
      const format = best.label === 'Short' ? 'sprint' : best.label === 'Long' ? 'endurance' : 'mid-length'
      insights.push({
        type: 'neutral',
        text: `Better in ${format} races: ${(best.podium * 100).toFixed(0)}% podium rate across ${best.count} races`,
      })
    }
  }

  // ── Incident patterns ──────────────────────────────────────────────────────
  const hoursWithData = profile.byHour.filter(h => h.sessionCount > 0 && h.avgIncidents > 0)
  if (hoursWithData.length >= 3) {
    const avgInc = hoursWithData.reduce((sum, h) => sum + h.avgIncidents, 0) / hoursWithData.length
    const worstIncHour = hoursWithData.reduce((worst, h) => h.avgIncidents > worst.avgIncidents ? h : worst)

    if (worstIncHour.avgIncidents > avgInc * 1.4 && worstIncHour.sessionCount >= 3) {
      insights.push({
        type: 'negative',
        text: `Incident rate spikes at ${worstIncHour.label} (${worstIncHour.avgIncidents.toFixed(1)} on average). Watch for fatigue or traffic`,
      })
    }
  }

  // ── Consistency / trending ─────────────────────────────────────────────────
  const allDeltas = activeHours
    .filter(h => h.avgIRatingDelta !== null)
    .map(h => h.avgIRatingDelta!)
  if (allDeltas.length >= 4) {
    const avgDelta = allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length
    if (avgDelta > 15) {
      insights.push({
        type: 'positive',
        text: `Trending upward: averaging +${avgDelta.toFixed(0)} iRating per session across all time slots`,
      })
    } else if (avgDelta < -15) {
      insights.push({
        type: 'negative',
        text: `iRating slipping: averaging ${avgDelta.toFixed(0)} per session. Consider reviewing replays`,
      })
    }
  }

  // ── Volume insight ─────────────────────────────────────────────────────────
  if (activeDays.length >= 5) {
    const totalRaces = activeDays.reduce((n, d) => n + d.sessionCount, 0)
    const racesPerDay = totalRaces / activeDays.length
    if (racesPerDay > 2) {
      const highVolumeDays = activeDays.filter(d => d.sessionCount > racesPerDay * 1.5)
      if (highVolumeDays.length > 0) {
        const heavyDay = highVolumeDays[0]
        const heavyDayDelta = heavyDay.avgIRatingDelta ?? 0
        if (heavyDayDelta < -5) {
          insights.push({
            type: 'negative',
            text: `High volume on ${heavyDay.label} but an average of ${heavyDayDelta.toFixed(0)} iRating. Quality over quantity`,
          })
        }
      }
    }
  }

  // Pull in detailed insights from the extended generator
  try {
    const { generateDetailedInsights } = require('./insights/when-generator')
    const detailed = generateDetailedInsights(profile) as WhenInsight[]
    const existingTexts = new Set(insights.map(i => i.text.toLowerCase().slice(0, 40)))
    for (const d of detailed) {
      const key = d.text.toLowerCase().slice(0, 40)
      if (!existingTexts.has(key)) {
        insights.push(d)
        existingTexts.add(key)
      }
    }
  } catch {
    // Detailed insights are optional
  }

  // Split into good (positive + neutral) and bad (negative), return exactly 3 of each
  const good = insights.filter(i => i.type === 'positive' || i.type === 'neutral')
  const bad = insights.filter(i => i.type === 'negative')

  while (good.length < 3) {
    good.push({ type: 'neutral', text: pickFallbackGood(good.length, profile) })
  }
  while (bad.length < 3) {
    bad.push({ type: 'negative', text: pickFallbackBad(bad.length, profile) })
  }

  return [...good.slice(0, 3), ...bad.slice(0, 3)]
}

function pickFallbackGood(index: number, profile: WhenProfile): string {
  const activeHours = profile.byHour.filter(h => h.sessionCount > 0)
  const avgPodium = activeHours.length > 0
    ? activeHours.reduce((sum, h) => sum + h.podiumRate, 0) / activeHours.length
    : 0
  const avgTopTen = activeHours.length > 0
    ? activeHours.reduce((sum, h) => sum + h.topTenRate, 0) / activeHours.length
    : 0
  const cleanHours = activeHours.filter(h => h.avgIncidents <= 1)

  const fallbacks = [
    avgPodium > 0 ? `${(avgPodium * 100).toFixed(0)}% podium rate across all time slots` : `Building a solid data set with more races`,
    avgTopTen > 0 ? `Top 10 in ${(avgTopTen * 100).toFixed(0)}% of races. Consistently competitive` : `Racing regularly is the best way to improve`,
    cleanHours.length > 0 ? `${cleanHours.length} racing hours average 1 or fewer incidents` : `More insights will appear with more races`,
  ]
  return fallbacks[index % fallbacks.length]
}

function pickFallbackBad(index: number, profile: WhenProfile): string {
  const activeHours = profile.byHour.filter(h => h.sessionCount > 0)
  const activeDays = profile.byDayOfWeek.filter(d => d.sessionCount > 0)
  const avgIncidents = activeHours.length > 0
    ? activeHours.reduce((sum, h) => sum + h.avgIncidents, 0) / activeHours.length
    : 0
  const lowWinHours = activeHours.filter(h => h.winRate === 0 && h.sessionCount >= 2)
  const highIncHours = activeHours.filter(h => h.avgIncidents > avgIncidents * 1.2)

  const fallbacks = [
    avgIncidents > 0 ? `${avgIncidents.toFixed(1)} incidents a session on average. Room to improve` : `Not enough data to find patterns yet`,
    lowWinHours.length > 0 ? `${lowWinHours.length} time slots with zero wins despite multiple races` : `No major red flags yet. Stay consistent`,
    highIncHours.length > 0 ? `${highIncHours.length} hours show above-average incidents. Fatigue or traffic` : `More laps will reveal track-specific weaknesses`,
  ]
  return fallbacks[index % fallbacks.length]
}
