/**
 * "Should I race right now?" verdict
 *
 * Given the user's `WhenProfile` (which already carries quantile-ranked hour
 * slots in `profile.rankedSlots`) plus the current moment, surface the tier
 * the current hour falls into. Returns a verdict plus the raw numbers so the
 * UI can both show a single chip and surface the data behind it.
 *
 * History: this used to compute its own absolute-threshold verdict
 * (good/marginal/risky), which collapsed nearly every hour to "marginal" for
 * any driver whose hours don't differ much from their overall baseline. The
 * quantile-ranked tiers live on the WhenProfile now (`SlotTier`), so this
 * file just looks them up. Implementation is intentionally thin — all the
 * stats-vs-baseline gathering remains because the expanded panel still wants
 * to render those numbers.
 *
 * Tradeoffs:
 *   - The tier is purely relative-to-self. A driver who averages 5 inc/lap
 *     can still have a 'best' hour even if it's messier than another
 *     driver's 'risky'. That's the goal — this is a "headspace" read, not a
 *     leaderboard.
 *   - Day-of-week is no longer part of the verdict (the new ranking is
 *     hour-only, matching the original quantile design). It's still surfaced
 *     in the stats so the expanded panel keeps showing day context.
 */

import type { WhenProfile, TemporalSlice, SlotTier } from './when-engine.js'
import { DEFAULT_TZ, getDayInTz, getHourInTz } from './tz.js'

// Verdict mirrors SlotTier 1:1 — every tier is a possible verdict, plus the
// `insufficient` sentinel when the current hour doesn't meet the sample
// floor used by the ranker.
export type RaceNowVerdict = SlotTier

export interface RaceNowEvaluation {
  verdict: RaceNowVerdict
  // Short verdict text for the chip itself.
  headline: string
  // One-sentence explanation suitable for a subtitle.
  detail: string
  // Raw numbers — exposed so the UI can render a details panel with the
  // actual stats the verdict is based on.
  stats: {
    currentHour: number          // 0-23 in user TZ
    currentDay: number           // 0=Sun..6=Sat in user TZ (standard JS convention)
    currentDayLabel: string      // "Sunday"
    currentHourLabel: string     // "2 PM"
    // At-this-hour slice. Uses the ±1h window around the current hour to
    // smooth out thin data — if you've only raced at exactly 19:00, we'd
    // rather give you credit at 18:00 and 20:00 than refuse a verdict.
    hourSampleCount: number
    hourAvgIncidents: number | null
    hourAvgPosition: number | null
    // At-this-day slice.
    daySampleCount: number
    dayAvgIncidents: number
    dayAvgPosition: number | null
    // Your own overall baseline.
    overallAvgIncidents: number
    overallAvgPosition: number | null
  }
}

// Kept for the day-level stats fallback only — the verdict itself comes from
// the pre-computed quantile rank on `profile.rankedSlots`.
const MIN_RACES_FOR_DAY_STATS = 3

// Sample floor for the broadened-window fallback. Same as the per-hour ranker
// in when-engine — keeps "verdict from a wider window" honest by requiring
// at least a few races in that window before we'll rank it.
const MIN_SAMPLE_FOR_FALLBACK = 3

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Headline copy per tier. Deliberately human and action-oriented — earlier
// versions said things like "Top quartile" and "Bottom quartile" which read
// like a stats lecture instead of a coach. The detail line below still
// surfaces the percentile / inc-vs-avg numbers for users who want them.
const TIER_HEADLINE: Record<Exclude<RaceNowVerdict, 'insufficient'>, string> = {
  best: 'Prime time',
  good: 'Good to go',
  'clean-side': 'Worth a shot',
  'messy-side': 'Tread carefully',
  risky: 'Hit pause',
}

// Progressive scopes the verdict falls back to when the exact-hour bucket is
// too thin to rank. We rank sliding windows of `size` hours centered on each
// hour the same way `computeRankedSlots` ranks single hours; the answer then
// reads as "how does your N-hour window here compare to your N-hour windows
// elsewhere?" — a coarser but still relative-to-self read.
const FALLBACK_WINDOWS: { size: number; label: string }[] = [
  { size: 3, label: '±1h window' },
  { size: 5, label: '±2h window' },
  { size: 7, label: '±3h window' },
]

function formatHour(hour: number): string {
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  const ampm = hour < 12 ? 'AM' : 'PM'
  return `${h12} ${ampm}`
}

/**
 * Aggregate a ±1h window around `hour`. When the user has thin data, looking
 * only at the exact hour drops us under MIN_RACES_FOR_VERDICT too often; the
 * window widens gracefully without losing enough resolution to matter.
 */
function aggregateHourWindow(byHour: TemporalSlice[], hour: number) {
  let sessions = 0
  let incSum = 0
  let incCount = 0
  let posSum = 0
  let posCount = 0
  for (const offset of [-1, 0, 1]) {
    const idx = (hour + offset + 24) % 24
    const slice = byHour[idx]
    sessions += slice.sessionCount
    if (slice.sessionCount > 0) {
      incSum += slice.avgIncidents * slice.sessionCount
      incCount += slice.sessionCount
      if (slice.avgPosition !== null) {
        posSum += slice.avgPosition * slice.sessionCount
        posCount += slice.sessionCount
      }
    }
  }
  return {
    sessions,
    avgIncidents: incCount > 0 ? incSum / incCount : null,
    avgPosition: posCount > 0 ? posSum / posCount : null,
  }
}

interface BroadenedRank {
  tier: Exclude<RaceNowVerdict, 'insufficient'>
  sessions: number
  avgIncidents: number
  percentile: number
  rank: number
  eligibleCount: number
}

/**
 * Fallback ranker. Builds a sliding window of `windowSize` hours centered on
 * each hour-of-day, ranks them by avgIncidents, and returns the tier for the
 * window centered on `hour`. Returns null when the user doesn't have enough
 * data anywhere — we let the caller decide what to do (try a wider window,
 * or finally show "not enough data").
 */
function rankWindowAtHour(
  byHour: TemporalSlice[],
  windowSize: number,
  hour: number,
  minSampleSize: number,
): BroadenedRank | null {
  const half = Math.floor(windowSize / 2)
  const windows = Array.from({ length: 24 }, (_, center) => {
    let sessions = 0
    let incTotal = 0
    let incCount = 0
    for (let off = -half; off <= half; off++) {
      const idx = (center + off + 24) % 24
      const slice = byHour[idx]
      sessions += slice.sessionCount
      if (slice.sessionCount > 0) {
        incTotal += slice.avgIncidents * slice.sessionCount
        incCount += slice.sessionCount
      }
    }
    return {
      center,
      sessions,
      avgIncidents: incCount > 0 ? incTotal / incCount : null,
    }
  })

  const eligible = windows.filter(w => w.sessions >= minSampleSize && w.avgIncidents !== null)
  if (eligible.length === 0) return null
  // Ascending by incidents (cleaner first); deterministic tiebreak by center.
  eligible.sort((a, b) => a.avgIncidents! - b.avgIncidents! || a.center - b.center)

  const targetIdx = eligible.findIndex(w => w.center === hour)
  if (targetIdx < 0) return null

  const target = eligible[targetIdx]
  const N = eligible.length
  const percentile = N === 1 ? 100 : ((N - 1 - targetIdx) / (N - 1)) * 100

  let tier: Exclude<RaceNowVerdict, 'insufficient'>
  if (targetIdx === 0) tier = 'best'
  else if (N < 4) tier = 'clean-side'
  else if (percentile >= 75) tier = 'good'
  else if (percentile >= 50) tier = 'clean-side'
  else if (percentile >= 25) tier = 'messy-side'
  else tier = 'risky'

  return {
    tier,
    sessions: target.sessions,
    avgIncidents: target.avgIncidents!,
    percentile,
    rank: targetIdx,
    eligibleCount: N,
  }
}

function overallBaseline(byHour: TemporalSlice[]) {
  let totalInc = 0
  let incCount = 0
  let totalPos = 0
  let posCount = 0
  for (const slice of byHour) {
    if (slice.sessionCount > 0) {
      totalInc += slice.avgIncidents * slice.sessionCount
      incCount += slice.sessionCount
      if (slice.avgPosition !== null) {
        totalPos += slice.avgPosition * slice.sessionCount
        posCount += slice.sessionCount
      }
    }
  }
  return {
    avgIncidents: incCount > 0 ? totalInc / incCount : 0,
    avgPosition: posCount > 0 ? totalPos / posCount : null,
    totalSessions: incCount,
  }
}

export function evaluateRaceNow(
  profile: WhenProfile | null,
  now: Date,
  timeZone: string = DEFAULT_TZ,
): RaceNowEvaluation | null {
  if (!profile) return null

  const hour = getHourInTz(now, timeZone)
  // getDayInTz returns 0=Sun..6=Sat (std JS). WhenProfile.byDayOfWeek is
  // keyed Mon=0..Sun=6, so we remap.
  const jsDay = getDayInTz(now, timeZone)
  const profileDayIdx = (jsDay + 6) % 7

  const hourWindow = aggregateHourWindow(profile.byHour, hour)
  const daySlice = profile.byDayOfWeek[profileDayIdx]
  const baseline = overallBaseline(profile.byHour)

  const stats: RaceNowEvaluation['stats'] = {
    currentHour: hour,
    currentDay: jsDay,
    currentDayLabel: DAY_LABELS[jsDay],
    currentHourLabel: formatHour(hour),
    hourSampleCount: hourWindow.sessions,
    hourAvgIncidents: hourWindow.avgIncidents,
    hourAvgPosition: hourWindow.avgPosition,
    daySampleCount: daySlice.sessionCount,
    dayAvgIncidents: daySlice.avgIncidents,
    dayAvgPosition: daySlice.avgPosition,
    overallAvgIncidents: baseline.avgIncidents,
    overallAvgPosition: baseline.avgPosition,
  }

  // The verdict is a direct lookup into the pre-computed quantile ranking.
  // `profile.rankedSlots[hour]` is keyed by hour (the array is always 24
  // entries, with `tier: 'insufficient'` for hours that didn't meet the
  // sample floor). No tolerance math here — that's the whole point of the
  // quantile rewrite.
  const slot = profile.rankedSlots?.[hour]
  const verdict: RaceNowVerdict = slot?.tier ?? 'insufficient'

  if (verdict === 'insufficient') {
    // Walk up to coarser scopes before giving up. Each step ranks sliding
    // windows of increasing size — the answer is still relative-to-self,
    // just answered against a bigger chunk of the day. This handles the
    // common case where a driver hasn't raced at *exactly* this hour but
    // has plenty of data on either side of it.
    const exactHourSessions = profile.byHour[hour]?.sessionCount ?? 0
    for (const scope of FALLBACK_WINDOWS) {
      const broadened = rankWindowAtHour(profile.byHour, scope.size, hour, MIN_SAMPLE_FOR_FALLBACK)
      if (!broadened) continue
      const detail = formatFallbackDetail(scope.label, broadened, stats, baseline, exactHourSessions)
      return {
        verdict: broadened.tier,
        headline: TIER_HEADLINE[broadened.tier],
        detail,
        stats,
      }
    }

    return {
      verdict: 'insufficient',
      headline: 'Not enough data yet',
      detail: `Only ${exactHourSessions} race${exactHourSessions === 1 ? '' : 's'} near ${stats.currentHourLabel} so far — verdict appears once you've logged a few more in this part of the day.`,
      stats,
    }
  }

  const eligibleCount = profile.rankedSlots.filter(s => s.tier !== 'insufficient').length
  const { headline, detail } = formatTierMessage(
    verdict,
    slot,
    eligibleCount,
    stats,
    hourWindow,
    daySlice,
    baseline,
  )
  return { verdict, headline, detail, stats }
}

interface RankedSlotForFormatting {
  rank: number | null
  percentile: number | null
  sessionCount: number
  avgIncidents: number
}

function formatTierMessage(
  tier: Exclude<RaceNowVerdict, 'insufficient'>,
  slot: RankedSlotForFormatting,
  eligibleCount: number,
  stats: RaceNowEvaluation['stats'],
  hourWindow: ReturnType<typeof aggregateHourWindow>,
  daySlice: TemporalSlice,
  baseline: ReturnType<typeof overallBaseline>,
): { headline: string; detail: string } {
  // Headline: a short, tier-flavoured chip label. We deliberately don't say
  // "marginal" anywhere — the prior tier set's biggest UX problem was that
  // every middle-of-the-road hour collapsed to that one word. We also avoid
  // statistical jargon ("quartile", "cleaner half") in the chip itself; the
  // detail line below is where the numbers live.
  const headline = TIER_HEADLINE[tier]

  // Detail: lead with the rank/percentile (the new signal), then back it up
  // with the same incidents/finish numbers we already gathered for the
  // expanded panel. Falls back to day-level stats when the hour bucket has
  // no usable numbers (rare — would require the slot to be ranked but have
  // null avgIncidents, which `computeRankedSlots` filters out).
  const pieces: string[] = []

  if (slot.percentile !== null) {
    if (tier === 'best') {
      pieces.push(
        eligibleCount > 1
          ? `Your single cleanest hour out of ${eligibleCount} ranked`
          : 'Your single cleanest hour',
      )
    } else {
      const pctRounded = Math.round(slot.percentile)
      pieces.push(`P${pctRounded} cleanliness in your own history`)
    }
  }

  if (hourWindow.avgIncidents !== null) {
    const diff = hourWindow.avgIncidents - baseline.avgIncidents
    const sign = diff <= 0 ? '' : '+'
    pieces.push(`${hourWindow.avgIncidents.toFixed(1)} inc/race near ${stats.currentHourLabel} (${sign}${diff.toFixed(1)} vs your avg)`)
  } else if (daySlice.sessionCount >= MIN_RACES_FOR_DAY_STATS) {
    const diff = daySlice.avgIncidents - baseline.avgIncidents
    const sign = diff <= 0 ? '' : '+'
    pieces.push(`${daySlice.avgIncidents.toFixed(1)} inc/race on ${stats.currentDayLabel}s (${sign}${diff.toFixed(1)} vs your avg)`)
  }

  if (hourWindow.avgPosition !== null) {
    pieces.push(`P${hourWindow.avgPosition.toFixed(1)} avg finish`)
  }

  const detail = pieces.length > 0 ? pieces.join(' • ') : 'Based on your race history in this window.'
  return { headline, detail }
}

/**
 * Detail line for a verdict produced by the broadened-window fallback. We
 * lead with "thin data on this hour, here's the broader read" so the user
 * knows why the verdict isn't pinned to the exact hour, then back it up
 * with the same inc-vs-avg numbers the normal path uses.
 */
function formatFallbackDetail(
  scopeLabel: string,
  broadened: BroadenedRank,
  stats: RaceNowEvaluation['stats'],
  baseline: ReturnType<typeof overallBaseline>,
  exactHourSessions: number,
): string {
  const diff = broadened.avgIncidents - baseline.avgIncidents
  const sign = diff <= 0 ? '' : '+'
  const thinNote =
    exactHourSessions === 0
      ? `No races logged at exactly ${stats.currentHourLabel} yet — broader read across your ${scopeLabel}`
      : `Only ${exactHourSessions} race${exactHourSessions === 1 ? '' : 's'} at exactly ${stats.currentHourLabel} — broader read across your ${scopeLabel}`
  const incNote = `${broadened.avgIncidents.toFixed(1)} inc/race (${sign}${diff.toFixed(1)} vs your avg)`
  return `${thinNote} • ${incNote}`
}

// ── Practice alternatives ───────────────────────────────────────────────────
//
// When the verdict isn't "good", we want to redirect the driver to something
// productive — practice the thing their own history says they're weakest at,
// instead of jumping into a race they'll regret.
//
// The suggestions are tailored, not generic:
//   - The track with their highest incidents/lap → a practice session to
//     clean up the racing line.
//   - The car with their highest incidents/lap → a time trial to build
//     car-specific pace without traffic.
//
// A minimum-sample floor keeps us from blaming a track/car the driver tried
// once on a bad night. If nothing meets the floor, we fall back to a generic
// suggestion so the panel is never empty.

export interface AlternativeSessionInput {
  trackName: string | null
  carModel: string
  category: string
  incidentCount: number | null
  completedLaps: number | null
}

export interface PracticeAlternative {
  kind: 'practice' | 'time-trial' | 'hot-lap'
  title: string
  detail: string
  trackName?: string
  carModel?: string
}

const MIN_SESSIONS_FOR_ALT = 3
const MIN_LAPS_FOR_ALT = 5

interface WeakSpot {
  name: string
  sessionCount: number
  avgIncPerLap: number
  totalLaps: number
}

function findWeakestBy(
  sessions: AlternativeSessionInput[],
  key: (s: AlternativeSessionInput) => string | null,
): WeakSpot | null {
  const buckets = new Map<string, { incidents: number; laps: number; count: number }>()
  for (const s of sessions) {
    const k = key(s)
    if (!k) continue
    const laps = s.completedLaps ?? 0
    if (laps <= 0) continue
    const inc = s.incidentCount ?? 0
    const b = buckets.get(k) ?? { incidents: 0, laps: 0, count: 0 }
    b.incidents += inc
    b.laps += laps
    b.count += 1
    buckets.set(k, b)
  }

  let best: WeakSpot | null = null
  for (const [name, b] of buckets) {
    if (b.count < MIN_SESSIONS_FOR_ALT) continue
    if (b.laps < MIN_LAPS_FOR_ALT) continue
    const avg = b.incidents / b.laps
    if (!best || avg > best.avgIncPerLap) {
      best = { name, sessionCount: b.count, avgIncPerLap: avg, totalLaps: b.laps }
    }
  }
  return best
}

/**
 * Find 0-3 practice alternatives based on a driver's worst spots.
 *
 * Returns `[]` for the top tiers (`best`, `good`) — there's no reason to
 * redirect someone whose current window is in their top quartile of
 * cleanliness. For every other verdict (including `insufficient`) we return
 * at least one suggestion so the "Try instead" section isn't blank.
 */
export function buildPracticeAlternatives(
  sessions: AlternativeSessionInput[],
  evaluation: RaceNowEvaluation | null,
): PracticeAlternative[] {
  if (!evaluation) return []
  if (evaluation.verdict === 'best' || evaluation.verdict === 'good') return []

  const worstTrack = findWeakestBy(sessions, s => s.trackName)
  const worstCar = findWeakestBy(sessions, s => s.carModel || null)

  const alts: PracticeAlternative[] = []

  if (worstTrack) {
    alts.push({
      kind: 'practice',
      title: `Practice at ${worstTrack.name}`,
      detail: `Your highest incident rate — ${worstTrack.avgIncPerLap.toFixed(2)}/lap across ${worstTrack.sessionCount} races. A no-pressure session will clean up the lines that keep costing you.`,
      trackName: worstTrack.name,
    })
  }

  if (worstCar && (!worstTrack || worstCar.name !== worstTrack.name)) {
    alts.push({
      kind: 'time-trial',
      title: `Time trial in the ${worstCar.name}`,
      detail: `Your messiest car — ${worstCar.avgIncPerLap.toFixed(2)} inc/lap over ${worstCar.sessionCount} races. Chase pace alone; braking and rotation improve faster without traffic.`,
      carModel: worstCar.name,
    })
  }

  // Fallback — we still want to say *something* useful when history is thin.
  if (alts.length === 0) {
    alts.push({
      kind: 'practice',
      title: 'Jump into a practice session instead',
      detail: "Not enough history yet to pinpoint a weak spot. A no-points practice will still build the hour-of-day rhythm your race history is flagging.",
    })
  }

  return alts
}

