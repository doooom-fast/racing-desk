/**
 * Race Summary Generator
 *
 * Produces structured, deterministic race summaries by composing insights
 * from the existing commentary, mastery, and behavioral analysis engines.
 * No AI API calls — all narrative is generated from the data.
 */

// ── Types ───────────────────────────────────────────────────────────────────────

export interface RaceSessionInput {
  id: string
  carModel: string
  manufacturer: string | null
  trackName: string | null
  finishPosition: number | null
  incidentCount: number | null
  sessionType: string | null
  category: string
  metadata: Record<string, any> | null
  createdAt: Date
}

export interface LapTelemetryInput {
  lapNumber: number
  lapTime: number | null
  sector1: number | null
  sector2: number | null
  sector3: number | null
  incidentCount: number
  isCleanLap: boolean | null
  rageScore: number | null
  throttleAggression: number | null
  steeringErraticism: number | null
  brakingAggression: number | null
  proximityChasing: number | null
}

export interface SessionBehaviorInput {
  hardBrakingEvents: number
  closePassCount: number
  tailgatingSeconds: number
  offTrackCount: number
  spinCount: number
  cleanLaps: number
  totalLaps: number
  peakRageScore: number
  avgRageScore: number
  rageSpikes: number
  cooldownsTriggered: number
  retaliationAttempts: number
  incidentsByPhase: Record<string, number> | null
  incidentLocations: Array<{ trackPosition: number; lapNumber: number; type?: string; points?: number }> | null
  commentaryLog: Array<{ lap: number; topic: string; severity: number; sentiment?: string; text: string }> | null
}

export interface TrackHistoryInput {
  sessions: RaceSessionInput[]
  bestPosition: number | null
  avgPosition: number | null
  avgIncidents: number
  totalRaces: number
}

export interface RatingContext {
  preRaceIRating: number | null
  postRaceIRating: number | null
  preRaceSR: number | null
  postRaceSR: number | null
  irDelta: number | null
  srDelta: number | null
}

// ── Output Types ────────────────────────────────────────────────────────────────

export interface RaceSummary {
  headline: string
  subheadline: string
  overallVerdict: 'excellent' | 'good' | 'mixed' | 'tough' | 'learning'
  strengths: SummaryPoint[]
  improvements: SummaryPoint[]
  lapAnalysis: LapAnalysis
  temperReport: TemperReport | null
  trackContext: TrackContextReport | null
  ratingImpact: RatingImpactReport | null
}

export interface SummaryPoint {
  icon: string        // lucide icon name
  title: string
  detail: string
  metric?: string     // e.g. "92%", "+34 iR"
}

export interface LapAnalysis {
  bestLap: number | null
  bestLapTime: number | null
  worstLapTime: number | null
  avgLapTime: number | null
  consistency: number          // 0-100
  fastestSector: { sector: number; time: number } | null
  slowestSector: { sector: number; time: number } | null
  lapTimeProgression: 'improving' | 'degrading' | 'stable' | 'unknown'
}

export interface TemperReport {
  verdict: string
  avgTemper: number
  peakTemper: number
  peakLap: number | null
  calmestStretch: { from: number; to: number } | null
  temperTrigger: string | null
}

export interface TrackContextReport {
  isPersonalBest: boolean
  trackRaceCount: number
  positionTrend: 'improving' | 'declining' | 'stable' | 'first_time'
  historicalAvgPosition: number | null
  historicalBestPosition: number | null
  narrativeLine: string
}

export interface RatingImpactReport {
  irDelta: number
  srDelta: number
  narrative: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function formatLapTime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3)
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
  return Math.sqrt(variance)
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// ── Main Generator ──────────────────────────────────────────────────────────────

export function generateRaceSummary(
  session: RaceSessionInput,
  laps: LapTelemetryInput[],
  behavior: SessionBehaviorInput | null,
  trackHistory: TrackHistoryInput | null,
  ratingCtx: RatingContext,
): RaceSummary {
  const meta = (session.metadata || {}) as Record<string, any>
  const pos = session.finishPosition
  const incidents = session.incidentCount ?? 0
  const isDNF = !pos || pos === 0
  const isPractice = (session.sessionType || '').toLowerCase().includes('practice')
  const fieldSize: number | null = meta.fieldSize ?? null
  const completedLaps = meta.completedLaps ?? laps.length

  // ── Lap Analysis ────────────────────────────────────────────────────────────
  const validLaps = laps.filter(l => l.lapTime && l.lapTime > 0)
  const lapTimes = validLaps.map(l => l.lapTime!)
  const bestLapTime = lapTimes.length > 0 ? Math.min(...lapTimes) : null
  const worstLapTime = lapTimes.length > 0 ? Math.max(...lapTimes) : null
  const avgLapTime = lapTimes.length > 0 ? lapTimes.reduce((a, b) => a + b, 0) / lapTimes.length : null
  const bestLap = bestLapTime ? validLaps.find(l => l.lapTime === bestLapTime)?.lapNumber ?? null : null

  // Lap time consistency: 100 = perfect, 0 = all over the place
  let lapConsistency = 50
  if (lapTimes.length >= 3) {
    const sd = stddev(lapTimes)
    const mean = avgLapTime!
    const cv = mean > 0 ? (sd / mean) * 100 : 0  // coefficient of variation as %
    // cv 0% = 100 consistency, cv 5%+ = 0 consistency
    lapConsistency = Math.max(0, Math.min(100, 100 - cv * 20))
  }

  // Sector analysis
  const s1Times = validLaps.filter(l => l.sector1).map(l => l.sector1!)
  const s2Times = validLaps.filter(l => l.sector2).map(l => l.sector2!)
  const s3Times = validLaps.filter(l => l.sector3).map(l => l.sector3!)
  const sectorAvgs = [
    s1Times.length > 0 ? { sector: 1, time: s1Times.reduce((a, b) => a + b, 0) / s1Times.length } : null,
    s2Times.length > 0 ? { sector: 2, time: s2Times.reduce((a, b) => a + b, 0) / s2Times.length } : null,
    s3Times.length > 0 ? { sector: 3, time: s3Times.reduce((a, b) => a + b, 0) / s3Times.length } : null,
  ].filter(Boolean) as { sector: number; time: number }[]

  const fastestSector = sectorAvgs.length > 0 ? sectorAvgs.reduce((a, b) => a.time < b.time ? a : b) : null
  const slowestSector = sectorAvgs.length > 0 ? sectorAvgs.reduce((a, b) => a.time > b.time ? a : b) : null

  // Progression: compare first-third vs last-third of laps
  let lapTimeProgression: 'improving' | 'degrading' | 'stable' | 'unknown' = 'unknown'
  if (lapTimes.length >= 6) {
    const third = Math.floor(lapTimes.length / 3)
    const firstThird = lapTimes.slice(0, third)
    const lastThird = lapTimes.slice(-third)
    const firstAvg = firstThird.reduce((a, b) => a + b, 0) / firstThird.length
    const lastAvg = lastThird.reduce((a, b) => a + b, 0) / lastThird.length
    const diff = ((lastAvg - firstAvg) / firstAvg) * 100
    if (diff < -0.5) lapTimeProgression = 'improving'
    else if (diff > 0.5) lapTimeProgression = 'degrading'
    else lapTimeProgression = 'stable'
  }

  const lapAnalysis: LapAnalysis = {
    bestLap,
    bestLapTime,
    worstLapTime,
    avgLapTime,
    consistency: lapConsistency,
    fastestSector,
    slowestSector,
    lapTimeProgression,
  }

  // ── Temper Report ───────────────────────────────────────────────────────────
  let temperReport: TemperReport | null = null
  if (behavior) {
    const rageLaps = laps.filter(l => l.rageScore !== null).map(l => ({ lap: l.lapNumber, rage: l.rageScore! }))
    const peakRageLap = rageLaps.length > 0 ? rageLaps.reduce((a, b) => a.rage > b.rage ? a : b) : null

    // Find calmest stretch (3+ consecutive laps with rage < 20)
    let calmestStretch: { from: number; to: number } | null = null
    if (rageLaps.length >= 3) {
      let currentStart = rageLaps[0]?.lap ?? 0
      let currentLength = 0
      let bestStart = 0
      let bestLength = 0

      for (const rl of rageLaps) {
        if (rl.rage < 20) {
          if (currentLength === 0) currentStart = rl.lap
          currentLength++
          if (currentLength > bestLength) {
            bestLength = currentLength
            bestStart = currentStart
          }
        } else {
          currentLength = 0
        }
      }
      if (bestLength >= 3) {
        calmestStretch = { from: bestStart, to: bestStart + bestLength - 1 }
      }
    }

    // Determine main temper trigger from commentary log
    let temperTrigger: string | null = null
    if (behavior.commentaryLog && behavior.commentaryLog.length > 0) {
      const highSeverity = behavior.commentaryLog.filter(c => c.severity >= 3)
      if (highSeverity.length > 0) {
        // Count topics
        const topicCounts = new Map<string, number>()
        highSeverity.forEach(c => {
          topicCounts.set(c.topic, (topicCounts.get(c.topic) || 0) + 1)
        })
        const sorted = [...topicCounts.entries()].sort((a, b) => b[1] - a[1])
        if (sorted.length > 0) temperTrigger = sorted[0][0]
      }
    }

    let temperVerdict: string
    if (behavior.avgRageScore < 15) temperVerdict = 'Exceptional composure throughout — you stayed cool under pressure.'
    else if (behavior.avgRageScore < 30) temperVerdict = 'Solid composure overall with only minor spikes.'
    else if (behavior.avgRageScore < 50) temperVerdict = 'Mixed composure — you had moments of frustration but recovered.'
    else temperVerdict = 'This was a high-stress race. Your composure took a hit — review what triggered the spikes.'

    temperReport = {
      verdict: temperVerdict,
      avgTemper: behavior.avgRageScore,
      peakTemper: behavior.peakRageScore,
      peakLap: peakRageLap?.lap ?? null,
      calmestStretch,
      temperTrigger,
    }
  }

  // ── Track Context ───────────────────────────────────────────────────────────
  let trackContext: TrackContextReport | null = null
  if (trackHistory && trackHistory.totalRaces > 0) {
    const isPersonalBest = pos !== null && pos > 0 && (
      trackHistory.bestPosition === null || pos <= trackHistory.bestPosition
    )

    let positionTrend: TrackContextReport['positionTrend'] = 'stable'
    if (trackHistory.totalRaces === 1) {
      positionTrend = 'first_time'
    } else if (trackHistory.sessions.length >= 3) {
      const recentPositions = trackHistory.sessions
        .slice(0, 3)
        .filter(s => s.finishPosition && s.finishPosition > 0)
        .map(s => s.finishPosition!)
      const olderPositions = trackHistory.sessions
        .slice(3)
        .filter(s => s.finishPosition && s.finishPosition > 0)
        .map(s => s.finishPosition!)

      if (recentPositions.length > 0 && olderPositions.length > 0) {
        const recentAvg = recentPositions.reduce((a, b) => a + b, 0) / recentPositions.length
        const olderAvg = olderPositions.reduce((a, b) => a + b, 0) / olderPositions.length
        if (recentAvg < olderAvg - 1) positionTrend = 'improving'
        else if (recentAvg > olderAvg + 1) positionTrend = 'declining'
      }
    }

    let narrativeLine: string
    if (positionTrend === 'first_time') {
      narrativeLine = `This was your first race at this track. ${
        pos && pos <= 5 ? 'An impressive debut — you showed real pace on unfamiliar ground.' :
        incidents === 0 ? 'You kept it clean for a first outing — a solid foundation to build on.' :
        'Learning a new track takes time. The data from this run will accelerate your next visit.'
      }`
    } else if (isPersonalBest) {
      narrativeLine = `New personal best at this track — ${ordinal(pos!)} place! You have raced here ${trackHistory.totalRaces} times and this is your strongest result.`
    } else if (positionTrend === 'improving') {
      narrativeLine = `Your results here are trending upward. Over ${trackHistory.totalRaces} races, your recent form is clearly stronger.`
    } else if (positionTrend === 'declining') {
      narrativeLine = `Your recent results here have dipped compared to your historical average of P${trackHistory.avgPosition?.toFixed(1)}. Worth reviewing what has changed.`
    } else {
      narrativeLine = `You have raced here ${trackHistory.totalRaces} times with an average finish of P${trackHistory.avgPosition?.toFixed(1)}. This session was ${
        pos && trackHistory.avgPosition && pos < trackHistory.avgPosition ? 'above' : 'around'
      } your typical pace.`
    }

    trackContext = {
      isPersonalBest,
      trackRaceCount: trackHistory.totalRaces,
      positionTrend,
      historicalAvgPosition: trackHistory.avgPosition,
      historicalBestPosition: trackHistory.bestPosition,
      narrativeLine,
    }
  }

  // ── Rating Impact ───────────────────────────────────────────────────────────
  let ratingImpact: RatingImpactReport | null = null
  if (ratingCtx.irDelta !== null || ratingCtx.srDelta !== null) {
    const irD = ratingCtx.irDelta ?? 0
    const srD = ratingCtx.srDelta ?? 0

    let narrative: string
    if (irD > 0 && srD >= 0) {
      narrative = `A rewarding race — you gained ${irD > 0 ? '+' + irD + ' iRating' : ''}${srD > 0 ? ' and +' + srD.toFixed(2) + ' Safety Rating' : ''}. Both metrics moved in the right direction.`
    } else if (irD > 0 && srD < 0) {
      narrative = `You gained +${irD} iRating from a strong finish, but the incidents cost you ${srD.toFixed(2)} Safety Rating. A cleaner race would have been the full package.`
    } else if (irD < 0 && srD >= 0) {
      narrative = `You lost ${irD} iRating from the finish position, but clean racing earned you ${srD > 0 ? '+' + srD.toFixed(2) : ''} Safety Rating. Patience is building your license.`
    } else if (irD < 0 && srD < 0) {
      narrative = `A tough one — both iRating (${irD}) and Safety Rating (${srD.toFixed(2)}) took a hit. Review the incident data below and focus on one area to improve next time.`
    } else {
      narrative = `Ratings held steady this race.`
    }

    ratingImpact = {
      irDelta: irD,
      srDelta: srD,
      narrative,
    }
  }

  // ── Strengths & Improvements ──────────────────────────────────────────────
  const strengths: SummaryPoint[] = []
  const improvements: SummaryPoint[] = []

  // Position
  if (!isPractice && pos && pos > 0) {
    if (pos === 1) {
      strengths.push({ icon: 'Trophy', title: 'Race Winner', detail: `Took the top step${fieldSize ? ` in a field of ${fieldSize}` : ''}.`, metric: 'P1' })
    } else if (pos <= 3) {
      strengths.push({ icon: 'Medal', title: 'Podium Finish', detail: `A strong ${ordinal(pos)} place${fieldSize ? ` out of ${fieldSize}` : ''}.`, metric: `P${pos}` })
    } else if (pos <= 5) {
      strengths.push({ icon: 'TrendingUp', title: 'Top-5 Finish', detail: `Finished ${ordinal(pos)}${fieldSize ? ` in a ${fieldSize}-car field` : ''} — solid pace.`, metric: `P${pos}` })
    } else if (fieldSize && pos <= Math.ceil(fieldSize * 0.25)) {
      strengths.push({ icon: 'ChevronUp', title: 'Top Quarter', detail: `${ordinal(pos)} of ${fieldSize} — in the top 25% of the field.`, metric: `P${pos}` })
    }

    if (fieldSize && pos > Math.ceil(fieldSize * 0.5)) {
      improvements.push({ icon: 'Target', title: 'Position', detail: `Finished ${ordinal(pos)} of ${fieldSize}. Aim for the top half by focusing on qualifying pace and clean first laps.`, metric: `P${pos}` })
    }
  }

  if (isDNF && !isPractice) {
    improvements.push({ icon: 'AlertTriangle', title: 'Did Not Finish', detail: 'The race ended early. Focus on survival — finishing races is the fastest way to gain both rating and experience.' })
  }

  // Incidents
  if (incidents === 0 && completedLaps > 0) {
    strengths.push({ icon: 'Shield', title: 'Incident-Free', detail: `Zero incidents across ${completedLaps} laps — exceptional awareness and car control.`, metric: '0x' })
  } else if (incidents <= 2 && completedLaps > 5) {
    strengths.push({ icon: 'ShieldCheck', title: 'Clean Racing', detail: `Only ${incidents} incident${incidents > 1 ? 's' : ''} in ${completedLaps} laps — well-managed risk.`, metric: `${incidents}x` })
  } else if (incidents >= 8) {
    improvements.push({ icon: 'ShieldAlert', title: 'High Incidents', detail: `${incidents} incidents in ${completedLaps} laps is above target. Review the incident heatmap below to find patterns.`, metric: `${incidents}x` })
  } else if (incidents >= 5) {
    improvements.push({ icon: 'ShieldAlert', title: 'Incident Rate', detail: `${incidents} incidents — a reduction here would significantly boost your Safety Rating.`, metric: `${incidents}x` })
  }

  // Lap consistency
  if (lapConsistency >= 85 && lapTimes.length >= 5) {
    strengths.push({ icon: 'Activity', title: 'Metronomic Pace', detail: `Your lap times were exceptionally consistent — the mark of a well-controlled race.`, metric: `${lapConsistency.toFixed(0)}%` })
  } else if (lapConsistency < 50 && lapTimes.length >= 5) {
    improvements.push({ icon: 'Activity', title: 'Lap Consistency', detail: `Large variance in lap times suggests inconsistent braking points or lost time recovering from mistakes. Drill your weakest corners.` })
  }

  // Lap time progression
  if (lapTimeProgression === 'improving') {
    strengths.push({ icon: 'TrendingDown', title: 'Race Pace Improved', detail: 'You got faster as the race went on — good tire management and track adaptation.' })
  } else if (lapTimeProgression === 'degrading') {
    improvements.push({ icon: 'TrendingUp', title: 'Late-Race Pace Drop', detail: 'Your lap times got slower toward the end. This could be fatigue, tire degradation, or loss of concentration. Practice longer stints.' })
  }

  // Behavioral insights
  if (behavior) {
    const cleanLapPct = behavior.totalLaps > 0 ? (behavior.cleanLaps / behavior.totalLaps) * 100 : 0

    if (cleanLapPct >= 90) {
      strengths.push({ icon: 'Sparkles', title: 'Clean Lap Rate', detail: `${cleanLapPct.toFixed(0)}% of your laps were incident-free — outstanding discipline.`, metric: `${cleanLapPct.toFixed(0)}%` })
    }

    if (behavior.closePassCount >= 5) {
      strengths.push({ icon: 'Swords', title: 'Active Racer', detail: `${behavior.closePassCount} close passes — you were in the mix and made moves count.`, metric: `${behavior.closePassCount}` })
    }

    if (behavior.offTrackCount >= 3) {
      improvements.push({ icon: 'MapPinOff', title: 'Track Limits', detail: `${behavior.offTrackCount} off-track excursions. Dial back entry speed at the corners where these occurred.`, metric: `${behavior.offTrackCount}` })
    }

    if (behavior.spinCount >= 2) {
      improvements.push({ icon: 'RotateCcw', title: 'Car Control', detail: `${behavior.spinCount} spins this session. Reduce throttle aggression on exit or check your setup for oversteer.`, metric: `${behavior.spinCount}` })
    }

    if (behavior.avgRageScore < 15) {
      strengths.push({ icon: 'Heart', title: 'Cool Head', detail: 'Your composure was excellent throughout — frustration never took the wheel.' })
    } else if (behavior.peakRageScore > 70) {
      improvements.push({ icon: 'Flame', title: 'Composure Spike', detail: `Peak rage hit ${behavior.peakRageScore.toFixed(0)} — when frustration peaks, incident risk follows. Consider a cooldown strategy.`, metric: `${behavior.peakRageScore.toFixed(0)}` })
    }

    // Incident phase
    if (behavior.incidentsByPhase) {
      const phases = behavior.incidentsByPhase as Record<string, number>
      const earlyInc = phases.early ?? 0
      const midInc = phases.mid ?? 0
      const lateInc = phases.late ?? 0
      const total = earlyInc + midInc + lateInc

      if (total > 0 && earlyInc > midInc && earlyInc > lateInc) {
        improvements.push({ icon: 'FastForward', title: 'Lap-1 Incidents', detail: 'Most incidents happened early. Be more conservative in the opening phase — positions gained cleanly in the second half stick.' })
      } else if (total > 0 && lateInc > earlyInc && lateInc > midInc) {
        improvements.push({ icon: 'Battery', title: 'Late-Race Incidents', detail: 'Incidents concentrated in the final phase. This suggests fatigue or increased risk-taking. Maintain your earlier discipline.' })
      }
    }
  }

  // Track context strengths/improvements
  if (trackContext?.isPersonalBest) {
    strengths.push({ icon: 'Star', title: 'Personal Best', detail: trackContext.narrativeLine })
  }

  if (trackContext?.positionTrend === 'first_time' && incidents <= 2 && pos && pos > 0) {
    strengths.push({ icon: 'MapPin', title: 'Strong Debut', detail: `Clean first outing at a new track with a P${pos} finish.` })
  }

  // Rating strengths
  if (ratingCtx.irDelta !== null && ratingCtx.irDelta > 50) {
    strengths.push({ icon: 'Zap', title: 'Big iRating Gain', detail: `+${ratingCtx.irDelta} iRating — a significant step up from this single race.`, metric: `+${ratingCtx.irDelta}` })
  }

  if (ratingCtx.srDelta !== null && ratingCtx.srDelta > 0.1) {
    strengths.push({ icon: 'ShieldPlus', title: 'SR Boost', detail: `+${ratingCtx.srDelta.toFixed(2)} Safety Rating — clean racing pays dividends.`, metric: `+${ratingCtx.srDelta.toFixed(2)}` })
  }

  // ── Headline & Verdict ────────────────────────────────────────────────────
  let overallVerdict: RaceSummary['overallVerdict']
  let headline: string
  let subheadline: string

  if (isPractice) {
    overallVerdict = 'good'
    headline = 'Practice Session Complete'
    subheadline = `${completedLaps} laps logged at ${session.trackName || 'the track'} in the ${session.carModel}.`
  } else if (isDNF) {
    overallVerdict = 'tough'
    headline = 'Race Ended Early'
    subheadline = `DNF at ${session.trackName || 'the track'} — but every race teaches something.`
  } else if (pos === 1 && incidents <= 2) {
    overallVerdict = 'excellent'
    headline = 'Dominant Victory'
    subheadline = `P1 with ${incidents === 0 ? 'zero' : 'minimal'} incidents — a textbook race.`
  } else if (pos === 1) {
    overallVerdict = 'excellent'
    headline = 'Race Winner'
    subheadline = `Took the win at ${session.trackName || 'the track'}${fieldSize ? ` in a ${fieldSize}-car field` : ''}.`
  } else if (pos && pos <= 3 && incidents <= 3) {
    overallVerdict = 'excellent'
    headline = 'Clean Podium'
    subheadline = `${ordinal(pos)} place with tight, clean racing — a quality result.`
  } else if (pos && pos <= 3) {
    overallVerdict = 'good'
    headline = 'Podium Finish'
    subheadline = `${ordinal(pos)} place at ${session.trackName || 'the track'}. A few less incidents and this would have been perfect.`
  } else if (pos && pos <= 5 && incidents <= 3) {
    overallVerdict = 'good'
    headline = 'Strong Top-5'
    subheadline = `${ordinal(pos)} with clean racing — you were right in contention.`
  } else if (incidents === 0 && completedLaps > 0) {
    overallVerdict = 'good'
    headline = 'Incident-Free Race'
    subheadline = `A clean race at ${session.trackName || 'the track'} — discipline that builds SR over time.`
  } else if (incidents >= 8 || (ratingCtx.srDelta !== null && ratingCtx.srDelta < -0.15)) {
    overallVerdict = 'tough'
    headline = 'Difficult Race'
    subheadline = `${incidents} incidents made this a rough one. The data below shows exactly where things went wrong.`
  } else if (strengths.length > improvements.length) {
    overallVerdict = 'good'
    headline = 'Solid Race'
    subheadline = `A positive outing at ${session.trackName || 'the track'} with more things going right than wrong.`
  } else if (improvements.length > strengths.length + 1) {
    overallVerdict = 'learning'
    headline = 'Room to Grow'
    subheadline = `Not your best day, but the data here gives you a clear roadmap for next time.`
  } else {
    overallVerdict = 'mixed'
    headline = 'Mixed Session'
    subheadline = `Some good, some rough at ${session.trackName || 'the track'} — the details tell the story.`
  }

  return {
    headline,
    subheadline,
    overallVerdict,
    strengths,
    improvements,
    lapAnalysis,
    temperReport,
    trackContext,
    ratingImpact,
  }
}
