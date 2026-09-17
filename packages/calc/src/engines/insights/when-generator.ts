import type { WhenProfile, WhenInsight } from '../when-engine.js'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function avg(values: (number | null)[]): number {
  const filtered = values.filter((v) => v !== null) as number[]
  return filtered.length ? filtered.reduce((a, b) => a + b, 0) / filtered.length : 0
}

function stdDev(values: (number | null)[]): number {
  const filtered = values.filter((v) => v !== null) as number[]
  if (filtered.length < 2) return 0
  const mean = avg(values)
  const variance = filtered.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / filtered.length
  return Math.sqrt(variance)
}

function median(values: (number | null)[]): number {
  const filtered = values.filter((v) => v !== null) as number[]
  if (!filtered.length) return 0
  filtered.sort((a, b) => a - b)
  return filtered[Math.floor(filtered.length / 2)]
}

function minBy<T>(arr: T[], fn: (item: T) => number): T | null {
  return arr.length ? arr.reduce((min, item) => (fn(item) < fn(min) ? item : min)) : null
}

function maxBy<T>(arr: T[], fn: (item: T) => number): T | null {
  return arr.length ? arr.reduce((max, item) => (fn(item) > fn(max) ? item : max)) : null
}

function getHourLabel(hour: number): string {
  if (hour === 0) return '12am'
  if (hour < 12) return `${hour}am`
  if (hour === 12) return '12pm'
  return `${hour - 12}pm`
}

function getDayLabel(dayIndex: number): string {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  return days[dayIndex] || 'Unknown'
}

function getTimeOfDay(hour: number): string {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 21) return 'evening'
  return 'night'
}

function isWeekend(dayIndex: number): boolean {
  return dayIndex >= 5 // Saturday=5, Sunday=6
}

function isWeekday(dayIndex: number): boolean {
  return !isWeekend(dayIndex)
}

function getConsecutiveWinners(slices: any[], threshold: number = 0.15): number {
  let streak = 0
  for (const slice of slices) {
    if (slice.winRate >= threshold) {
      streak++
    } else if (streak > 0) {
      break
    }
  }
  return streak
}

function countSlicesAboveThreshold(slices: any[], key: string, threshold: number): number {
  return slices.filter((s) => (s[key] ?? 0) >= threshold).length
}

// ============================================================================
// MAIN GENERATOR
// ============================================================================

export function generateDetailedInsights(profile: WhenProfile): WhenInsight[] {
  const insights: WhenInsight[] = []

  // ============================================================================
  // SECTION 1: TIME-OF-DAY PATTERNS
  // ============================================================================

  // Morning peak detector
  {
    const morning = profile.byHour.filter((h, i) => i >= 5 && i < 12)
    const avgMorningPos = avg(morning.map((h) => h.avgPosition))
    const avgMorningWinRate = avg(morning.map((h) => h.winRate))
    const totalMorningSessions = morning.reduce((sum, h) => sum + h.sessionCount, 0)

    if (totalMorningSessions >= 5 && avgMorningWinRate >= 0.12) {
      insights.push({
        type: 'positive',
        text: `Morning racer. Win rate jumps to ${(avgMorningWinRate * 100).toFixed(0)}% before noon. Schedule serious grinding sessions earlier in the day.`,
      })
    }
  }

  // Evening peak detector
  {
    const evening = profile.byHour.filter((h, i) => i >= 17 && i < 21)
    const avgEveningWinRate = avg(evening.map((h) => h.winRate))
    const totalEveningSessions = evening.reduce((sum, h) => sum + h.sessionCount, 0)

    if (totalEveningSessions >= 5 && avgEveningWinRate >= 0.12) {
      insights.push({
        type: 'positive',
        text: `Golden hour evenings. Between ${getHourLabel(17)}–${getHourLabel(21)}, you maintain a ${(avgEveningWinRate * 100).toFixed(0)}% win rate. Peak sharpness.`,
      })
    }
  }

  // Late-night performance
  {
    const lateNight = profile.byHour.filter((h, i) => i >= 22 || i < 5)
    const totalLateNightSessions = lateNight.reduce((sum, h) => sum + h.sessionCount, 0)
    const avgLateNightIncidents = avg(lateNight.map((h) => h.avgIncidents))

    if (totalLateNightSessions >= 4 && avgLateNightIncidents >= 1.5) {
      insights.push({
        type: 'negative',
        text: `Racing after 10pm is risky. Incident rate spikes to ${avgLateNightIncidents.toFixed(2)} per session. Fatigue is costing you.`,
      })
    }
  }

  // Lunch hour racing pattern
  {
    const lunchHours = profile.byHour.filter((h, i) => i >= 11 && i < 14)
    const totalLunchSessions = lunchHours.reduce((sum, h) => sum + h.sessionCount, 0)
    const avgLunchPos = avg(lunchHours.map((h) => h.avgPosition))

    if (totalLunchSessions >= 4 && avgLunchPos && avgLunchPos <= 5) {
      insights.push({
        type: 'positive',
        text: `Crushing lunch hour racing. Average ${avgLunchPos.toFixed(1)}th place finish between 11am–2pm. Optimal break-time peak.`,
      })
    }
  }

  // Pre-work session performance
  {
    const preWork = profile.byHour.filter((h, i) => i >= 6 && i < 9)
    const totalPreWorkSessions = preWork.reduce((sum, h) => sum + h.sessionCount, 0)
    const avgPreWorkWinRate = avg(preWork.map((h) => h.winRate))

    if (totalPreWorkSessions >= 3 && avgPreWorkWinRate <= 0.05) {
      insights.push({
        type: 'negative',
        text: `Early morning sessions (6am–9am) are your weakest. Win rate drops to ${(avgPreWorkWinRate * 100).toFixed(0)}%. Need better warm-up routine.`,
      })
    }
  }

  // Hour-to-hour consistency
  {
    const nonZeroHours = profile.byHour.filter((h) => h.sessionCount > 0)
    if (nonZeroHours.length >= 5) {
      const winRates = nonZeroHours.map((h) => h.winRate)
      const variance = stdDev(winRates)

      if (variance >= 0.15) {
        const best = maxBy(nonZeroHours, (h) => h.winRate)
        const worst = minBy(nonZeroHours, (h) => h.winRate)

        if (best && worst && best.winRate - worst.winRate >= 0.2) {
          insights.push({
            type: 'neutral',
            text: `Huge time-of-day swing. ${best.label} is ${(best.winRate * 100).toFixed(0)}% wins, ${worst.label} is ${(worst.winRate * 100).toFixed(0)}%. Schedule important races during peak hours.`,
          })
        }
      }
    }
  }

  // ============================================================================
  // SECTION 2: DAY-OF-WEEK PATTERNS
  // ============================================================================

  // Best day detector
  {
    const best = maxBy(profile.byDayOfWeek, (d) => d.winRate)
    if (best && best.sessionCount >= 4 && best.winRate >= 0.15) {
      insights.push({
        type: 'positive',
        text: `${best.label} is your lucky day. Win rate peaks at ${(best.winRate * 100).toFixed(0)}% over ${best.sessionCount} sessions. Block off ${best.label}s for ranked grind.`,
      })
    }
  }

  // Worst day detector
  {
    const worst = minBy(profile.byDayOfWeek, (d) => d.winRate)
    if (worst && worst.sessionCount >= 4 && worst.winRate <= 0.05) {
      insights.push({
        type: 'negative',
        text: `${worst.label} is rough. Only ${(worst.winRate * 100).toFixed(0)}% wins across ${worst.sessionCount} sessions. Avoid ranked races on ${worst.label}s.`,
      })
    }
  }

  // Weekday vs weekend pattern
  {
    const weekdaySlices = profile.byDayOfWeek.filter((_, i) => isWeekday(i))
    const weekendSlices = profile.byDayOfWeek.filter((_, i) => isWeekend(i))

    const totalWeekday = weekdaySlices.reduce((sum, d) => sum + d.sessionCount, 0)
    const totalWeekend = weekendSlices.reduce((sum, d) => sum + d.sessionCount, 0)

    if (totalWeekday >= 5 && totalWeekend >= 4) {
      const avgWeekdayWinRate = avg(weekdaySlices.map((d) => d.winRate))
      const avgWeekendWinRate = avg(weekendSlices.map((d) => d.winRate))

      if (avgWeekdayWinRate - avgWeekendWinRate >= 0.1) {
        insights.push({
          type: 'positive',
          text: `Weekday warrior. ${(avgWeekdayWinRate * 100).toFixed(0)}% win rate Mon–Fri vs ${(avgWeekendWinRate * 100).toFixed(0)}% weekends. Focused racing wins.`,
        })
      } else if (avgWeekendWinRate - avgWeekdayWinRate >= 0.1) {
        insights.push({
          type: 'positive',
          text: `Weekend grinding pays off. ${(avgWeekendWinRate * 100).toFixed(0)}% win rate Sat–Sun vs ${(avgWeekdayWinRate * 100).toFixed(0)}% weekdays. Fresher on weekends.`,
        })
      }
    }
  }

  // Friday night phenomenon
  {
    const friday = profile.byDayOfWeek[4]
    if (friday && friday.sessionCount >= 3) {
      const avgWeekdayExcludingFriday = avg(
        profile.byDayOfWeek.slice(0, 4).map((d) => d.winRate),
      )

      if (friday.winRate >= avgWeekdayExcludingFriday + 0.08) {
        insights.push({
          type: 'positive',
          text: `Friday is your weekend preview. Win rate jumps to ${(friday.winRate * 100).toFixed(0)}%. End-of-week energy hits different.`,
        })
      }
    }
  }

  // Sunday slump
  {
    const sunday = profile.byDayOfWeek[6]
    const saturday = profile.byDayOfWeek[5]

    if (sunday && saturday && sunday.sessionCount >= 3 && saturday.sessionCount >= 3) {
      if (saturday.winRate - sunday.winRate >= 0.12) {
        insights.push({
          type: 'neutral',
          text: `Sunday slump detected. Saturday: ${(saturday.winRate * 100).toFixed(0)}% wins, Sunday: ${(sunday.winRate * 100).toFixed(0)}%. Weekend fatigue?`,
        })
      }
    }
  }

  // Monday motivation check
  {
    const monday = profile.byDayOfWeek[0]
    const avgOtherDays = avg(profile.byDayOfWeek.slice(1).map((d) => d.winRate))

    if (monday && monday.sessionCount >= 3 && monday.winRate >= avgOtherDays + 0.1) {
      insights.push({
        type: 'positive',
        text: `Monday motivation is real. ${(monday.winRate * 100).toFixed(0)}% win rate. Start-of-week focus translates to racecraft.`,
      })
    }
  }

  // Mid-week consistency
  {
    const midWeek = profile.byDayOfWeek.slice(1, 5) // Tue-Fri
    const totalMidWeek = midWeek.reduce((sum, d) => sum + d.sessionCount, 0)
    const avgMidWeekPos = avg(midWeek.map((d) => d.avgPosition))

    if (totalMidWeek >= 8 && avgMidWeekPos && avgMidWeekPos <= 4) {
      insights.push({
        type: 'positive',
        text: `Mid-week grind. Average ${avgMidWeekPos.toFixed(1)}th place Tuesday–Friday across ${totalMidWeek} races.`,
      })
    }
  }

  // ============================================================================
  // SECTION 3: SESSION LENGTH PATTERNS
  // ============================================================================

  // Sprint specialist
  {
    const short = profile.bySessionLength[0]
    const medium = profile.bySessionLength[1]
    const long = profile.bySessionLength[2]

    if (short && short.sessionCount >= 5) {
      if (
        (medium?.sessionCount ?? 0) < 3 &&
        (long?.sessionCount ?? 0) < 3 &&
        short.winRate >= 0.15
      ) {
        insights.push({
          type: 'positive',
          text: `You're a sprint specialist. ${(short.winRate * 100).toFixed(0)}% win rate in short sprints (<15 laps) vs minimal experience in longer formats.`,
        })
      }
    }
  }

  // Endurance strength
  {
    const long = profile.bySessionLength[2]
    if (long && long.sessionCount >= 4 && long.avgIncidents && long.avgIncidents <= 0.8) {
      insights.push({
        type: 'positive',
        text: `Endurance racing suits you. Only ${long.avgIncidents.toFixed(2)} incidents per long session (30+ laps). Solid consistency.`,
      })
    }
  }

  // Format inconsistency
  {
    const sessions = profile.bySessionLength.filter((s) => s.sessionCount >= 3)
    if (sessions.length >= 2) {
      const winRates = sessions.map((s) => s.winRate)
      const variance = stdDev(winRates)

      if (variance >= 0.12) {
        const best = maxBy(sessions, (s) => s.winRate)
        const worst = minBy(sessions, (s) => s.winRate)

        if (best && worst && best.winRate - worst.winRate >= 0.15) {
          insights.push({
            type: 'neutral',
            text: `Big gap between ${best.label}er and ${worst.label}er races. Pick your race type wisely.`,
          })
        }
      }
    }
  }

  // Medium-length sweet spot
  {
    const medium = profile.bySessionLength[1]
    const avgMedium = avg(profile.bySessionLength.map((s) => s.winRate))

    if (medium && medium.sessionCount >= 6 && medium.winRate >= avgMedium + 0.08) {
      insights.push({
        type: 'positive',
        text: `Medium-distance races (15–30 laps) are your sweet spot. Win rate hits ${(medium.winRate * 100).toFixed(0)}%. Balanced effort and results.`,
      })
    }
  }

  // ============================================================================
  // SECTION 4: CONSISTENCY & VARIANCE PATTERNS
  // ============================================================================

  // Overall consistency
  {
    const allHours = profile.byHour.filter((h) => h.sessionCount > 0)
    if (allHours.length >= 8) {
      const variance = stdDev(allHours.map((h) => h.winRate))

      if (variance < 0.08) {
        insights.push({
          type: 'positive',
          text: `Remarkably consistent across times. Win rate varies by only ${(variance * 100).toFixed(1)}%. Disciplined in every session.`,
        })
      } else if (variance >= 0.2) {
        insights.push({
          type: 'negative',
          text: `Results are all over the place. ${(variance * 100).toFixed(1)}% variance. Time-of-day, fatigue, or luck playing a huge role.`,
        })
      }
    }
  }

  // Position consistency
  {
    const allDays = profile.byDayOfWeek.filter((d) => d.avgPosition !== null)
    if (allDays.length >= 5) {
      const positions = allDays.map((d) => d.avgPosition) as number[]
      const posVariance = stdDev(positions)

      if (posVariance <= 1.5) {
        const avgPos = median(positions)
        insights.push({
          type: 'positive',
          text: `Rock-solid consistency. Average ${avgPos.toFixed(1)}th place with only ${posVariance.toFixed(2)}σ variance. You know your pace.`,
        })
      }
    }
  }

  // Win rate volatility
  {
    const days = profile.byDayOfWeek.filter((d) => d.sessionCount >= 2)
    if (days.length >= 6) {
      const variance = stdDev(days.map((d) => d.winRate))

      if (variance >= 0.18) {
        insights.push({
          type: 'neutral',
          text: `Results swing wildly day-to-day. ${(variance * 100).toFixed(1)}% variance. Car setup, field strength, or mental state differs a lot.`,
        })
      }
    }
  }

  // ============================================================================
  // SECTION 5: INCIDENT PATTERNS & CLEAN RACING
  // ============================================================================

  // Clean racer detector
  {
    const allSlices = [...profile.byHour, ...profile.byDayOfWeek, ...profile.bySessionLength]
    const avgIncidentsAll = avg(allSlices.map((s) => s.avgIncidents))

    if (avgIncidentsAll <= 0.5) {
      insights.push({
        type: 'positive',
        text: `Squeaky clean. Average of ${avgIncidentsAll.toFixed(2)} incidents per session. Courteous, methodical racer.`,
      })
    }
  }

  // Crash-prone detection
  {
    const allSlices = [...profile.byHour, ...profile.byDayOfWeek, ...profile.bySessionLength]
    const avgIncidentsAll = avg(allSlices.map((s) => s.avgIncidents))

    if (avgIncidentsAll >= 2.0) {
      insights.push({
        type: 'negative',
        text: `Incident rate is high. ${avgIncidentsAll.toFixed(2)} per session average. Work on racecraft and positioning.`,
      })
    }
  }

  // Hour-based incident spike
  {
    const worstHour = maxBy(profile.byHour, (h) => h.avgIncidents)
    const bestHour = minBy(profile.byHour, (h) => h.avgIncidents)

    if (
      worstHour &&
      bestHour &&
      worstHour.sessionCount >= 3 &&
      bestHour.sessionCount >= 3 &&
      worstHour.avgIncidents - bestHour.avgIncidents >= 1.0
    ) {
      insights.push({
        type: 'negative',
        text: `Huge incident spike at ${worstHour.label}. You average ${worstHour.avgIncidents.toFixed(2)} incidents then vs ${bestHour.avgIncidents.toFixed(2)} at ${bestHour.label}. Fatigue or field composition?`,
      })
    }
  }

  // Fatigue signal: late session incidents
  {
    const lateHours = profile.byHour.filter((h, i) => i >= 20 || i < 6)
    const earlyHours = profile.byHour.filter((h, i) => i >= 6 && i < 12)

    const totalLate = lateHours.reduce((sum, h) => sum + h.sessionCount, 0)
    const totalEarly = earlyHours.reduce((sum, h) => sum + h.sessionCount, 0)

    if (totalLate >= 4 && totalEarly >= 4) {
      const avgLateIncidents = avg(lateHours.map((h) => h.avgIncidents))
      const avgEarlyIncidents = avg(earlyHours.map((h) => h.avgIncidents))

      if (avgLateIncidents - avgEarlyIncidents >= 1.2) {
        insights.push({
          type: 'negative',
          text: `Fatigue is costing you. Late-night incidents (${avgLateIncidents.toFixed(2)}) are ${(avgLateIncidents - avgEarlyIncidents).toFixed(2)} higher than mornings. Stop before you get tired.`,
        })
      }
    }
  }

  // Clean race window
  {
    const cleanWindows = profile.byHour.filter(
      (h) => h.sessionCount >= 2 && h.avgIncidents <= 0.3,
    )

    if (cleanWindows.length >= 2) {
      const labels = cleanWindows.slice(0, 3).map((h) => h.label)
      insights.push({
        type: 'positive',
        text: `Clean racing window. ${labels.join(', ')} show near-zero incidents. Peak focus and smoothness.`,
      })
    }
  }

  // ============================================================================
  // SECTION 6: WIN & PODIUM PATTERNS
  // ============================================================================

  // Win cluster detection
  {
    const bestHour = maxBy(profile.byHour, (h) => h.winRate)
    const avgWinRate = avg(profile.byHour.map((h) => h.winRate))

    if (bestHour && bestHour.sessionCount >= 4 && bestHour.winRate >= avgWinRate + 0.15) {
      insights.push({
        type: 'positive',
        text: `Win clustering at ${bestHour.label}. ${(bestHour.winRate * 100).toFixed(0)}% vs ${(avgWinRate * 100).toFixed(0)}% average. Dominant peak hour.`,
      })
    }
  }

  // Podium consistency
  {
    const avgPodiumRate = avg(profile.byHour.map((h) => h.podiumRate))
    const strongPodiumHours = profile.byHour.filter((h) => h.podiumRate >= 0.35 && h.sessionCount >= 3)

    if (strongPodiumHours.length >= 4 && avgPodiumRate >= 0.25) {
      insights.push({
        type: 'positive',
        text: `Podium finishes are your norm. Crack the top 3 in ${(avgPodiumRate * 100).toFixed(0)}% of races. Consistent high performance.`,
      })
    }
  }

  // Win drought
  {
    const zeroWinDays = profile.byDayOfWeek.filter(
      (d) => d.sessionCount >= 3 && d.winRate === 0,
    )

    if (zeroWinDays.length >= 2) {
      insights.push({
        type: 'negative',
        text: `Dry spell on ${zeroWinDays.map((d) => d.label).join(' and ')}. Zero wins across ${zeroWinDays[0]?.sessionCount || 0}+ sessions. Field tougher or setup off.`,
      })
    }
  }

  // Top-ten dominance
  {
    const avgTopTenRate = avg(profile.byHour.map((h) => h.topTenRate))

    if (avgTopTenRate >= 0.75) {
      insights.push({
        type: 'positive',
        text: `Top-10 finishes automatic. ${(avgTopTenRate * 100).toFixed(0)}% of races. You're in the fast group.`,
      })
    }
  }

  // Position progression by time
  {
    const afternoonHours = profile.byHour.filter((h, i) => i >= 12 && i < 17)
    const nightHours = profile.byHour.filter((h, i) => i >= 20 || i < 6)

    const totalAfternoon = afternoonHours.reduce((sum, h) => sum + h.sessionCount, 0)
    const totalNight = nightHours.reduce((sum, h) => sum + h.sessionCount, 0)

    if (totalAfternoon >= 4 && totalNight >= 4) {
      const avgAfternoonPos = avg(afternoonHours.map((h) => h.avgPosition))
      const avgNightPos = avg(nightHours.map((h) => h.avgPosition))

      if (avgAfternoonPos && avgNightPos && avgAfternoonPos - avgNightPos >= 2) {
        insights.push({
          type: 'neutral',
          text: `Afternoon pace is better. ${avgAfternoonPos.toFixed(1)}th place vs ${avgNightPos.toFixed(1)}th late night. Mental sharpness matters.`,
        })
      }
    }
  }

  // ============================================================================
  // SECTION 7: iRATING TRAJECTORY
  // ============================================================================

  // iRating climber
  {
    const gainingHours = profile.byHour.filter(
      (h) => h.avgIRatingDelta !== null && h.avgIRatingDelta > 0 && h.sessionCount >= 3,
    )

    if (gainingHours.length >= 5) {
      const avgGain = avg(gainingHours.map((h) => h.avgIRatingDelta))
      insights.push({
        type: 'positive',
        text: `You're climbing. Average +${avgGain.toFixed(0)} iR when sessions go well. Consistent skill improvement in your main hours.`,
      })
    }
  }

  // iRating bleeder
  {
    const bleedingHours = profile.byHour.filter(
      (h) => h.avgIRatingDelta !== null && h.avgIRatingDelta < 0 && h.sessionCount >= 3,
    )

    if (bleedingHours.length >= 4) {
      const avgLoss = avg(bleedingHours.map((h) => h.avgIRatingDelta))
      insights.push({
        type: 'negative',
        text: `Shedding iR at certain hours. Average ${avgLoss.toFixed(0)} iR in ${bleedingHours.map((h) => h.label).join(', ')}. Swap to lower splits or take a break.`,
      })
    }
  }

  // iRating plateau
  {
    const hoursWithDelta = profile.byHour.filter(
      (h) => h.avgIRatingDelta !== null && h.sessionCount >= 4,
    )

    if (hoursWithDelta.length >= 6) {
      const deltas = hoursWithDelta.map((h) => h.avgIRatingDelta ?? 0)
      const variance = stdDev(deltas)

      if (variance <= 50 && avg(deltas) >= -20 && avg(deltas) <= 20) {
        insights.push({
          type: 'neutral',
          text: `Your iR is holding steady, ±${variance.toFixed(0)}. Matched to your skill level. Gains require car mastery or setup tuning.`,
        })
      }
    }
  }

  // Peak performance iRating window
  {
    const peakIRatingWindow = maxBy(
      profile.byHour.filter((h) => h.sessionCount >= 3 && h.avgIRatingDelta !== null),
      (h) => h.avgIRatingDelta ?? -999,
    )

    if (peakIRatingWindow && peakIRatingWindow.avgIRatingDelta && peakIRatingWindow.avgIRatingDelta > 15) {
      insights.push({
        type: 'positive',
        text: `iR gains peak at ${peakIRatingWindow.label}. +${peakIRatingWindow.avgIRatingDelta.toFixed(0)} average. Optimal grind window.`,
      })
    }
  }

  // ============================================================================
  // SECTION 8: VOLUME & SCHEDULING PATTERNS
  // ============================================================================

  // Overracing detection
  {
    const totalSessions = profile.byHour.reduce((sum, h) => sum + h.sessionCount, 0)
    const avgSessionsPerHour = totalSessions / 24

    if (totalSessions >= 40) {
      const lateNightSessions = profile.byHour
        .filter((h, i) => i >= 22 || i < 5)
        .reduce((sum, h) => sum + h.sessionCount, 0)
      const lateNightIncidents = avg(
        profile.byHour.filter((h, i) => i >= 22 || i < 5).map((h) => h.avgIncidents),
      )

      if (lateNightSessions >= 8 && lateNightIncidents >= 1.8) {
        insights.push({
          type: 'negative',
          text: `Overracing in low-energy hours. ${lateNightSessions} late-night sessions with ${lateNightIncidents.toFixed(2)} avg incidents. Quality over quantity.`,
        })
      }
    }
  }

  // Optimal session frequency
  {
    const sessionsByDay = profile.byDayOfWeek
      .map((d) => d.sessionCount)
      .filter((count) => count > 0)

    if (sessionsByDay.length >= 5) {
      const avg_count = sessionsByDay.reduce((a, b) => a + b, 0) / sessionsByDay.length
      const best_day = maxBy(profile.byDayOfWeek, (d) => d.sessionCount)
      const best_day_winrate = best_day?.winRate ?? 0

      if (avg_count >= 8 && best_day && best_day.sessionCount >= 12 && best_day_winrate >= 0.12) {
        insights.push({
          type: 'positive',
          text: `Sweet spot found. ${avg_count.toFixed(0)} sessions per day maintains ${(best_day_winrate * 100).toFixed(0)}% win rate.`,
        })
      }
    }
  }

  // Volume distribution
  {
    const nonZeroHours = profile.byHour.filter((h) => h.sessionCount > 0)
    if (nonZeroHours.length >= 1) {
      const maxHourCount = Math.max(...nonZeroHours.map((h) => h.sessionCount))
      const minHourCount = Math.min(...nonZeroHours.map((h) => h.sessionCount))

      if (maxHourCount >= minHourCount * 4) {
        const busiest = maxBy(nonZeroHours, (h) => h.sessionCount)
        insights.push({
          type: 'neutral',
          text: `Racing front-loaded to ${busiest?.label} (${maxHourCount} sessions). Spread runs out to stay fresh.`,
        })
      }
    }
  }

  // Light racing days
  {
    const lightDays = profile.byDayOfWeek.filter((d) => d.sessionCount === 1 && d.winRate >= 0.5)

    if (lightDays.length >= 2) {
      insights.push({
        type: 'positive',
        text: `Quality over quantity on ${lightDays.map((d) => d.label).join(' and ')}. Single focused session, high win rate.`,
      })
    }
  }

  // ============================================================================
  // SECTION 9: SCHEDULING & OPTIMIZATION ADVICE
  // ============================================================================

  // Ideal race window
  {
    const strongHours = profile.byHour.filter(
      (h) => h.sessionCount >= 3 && h.winRate >= 0.15 && h.avgIncidents <= 0.8,
    )

    if (strongHours.length >= 2) {
      insights.push({
        type: 'positive',
        text: `Schedule important races during ${strongHours.slice(0, 2).map((h) => h.label).join(' or ')}. Sharp, clean, winning.`,
      })
    }
  }

  // Avoid this window
  {
    const weakHours = profile.byHour.filter(
      (h) => h.sessionCount >= 3 && h.winRate <= 0.05 && h.avgIncidents >= 1.5,
    )

    if (weakHours.length >= 1) {
      insights.push({
        type: 'negative',
        text: `Avoid ranked races around ${weakHours[0].label}. Low win rate plus high incidents equals perfect storm. Stick to practice.`,
      })
    }
  }

  // Break day recommendation
  {
    const worstDays = profile.byDayOfWeek
      .map((d, i) => ({ ...d, dayIndex: i }))
      .filter((d) => d.sessionCount >= 4 && d.winRate <= 0.08)

    if (worstDays.length >= 1) {
      insights.push({
        type: 'neutral',
        text: `Take ${worstDays[0].label} off from racing. Use it for setup testing or iRacing Academy refreshers.`,
      })
    }
  }

  // Peak performance day
  {
    const peak = maxBy(profile.byDayOfWeek, (d) => d.winRate)

    if (peak && peak.sessionCount >= 5 && peak.winRate >= 0.15) {
      insights.push({
        type: 'positive',
        text: `${peak.label} is championship race day. Save best focus and fuel for then. ${(peak.winRate * 100).toFixed(0)}% win rate that day.`,
      })
    }
  }

  // ============================================================================
  // SECTION 10: QUIRKY & FUN OBSERVATIONS
  // ============================================================================

  // Night owl racer
  {
    const nightHours = profile.byHour.filter((h, i) => i >= 21 || i < 6)
    const totalNightSessions = nightHours.reduce((sum, h) => sum + h.sessionCount, 0)
    const dayHours = profile.byHour.filter((h, i) => i >= 6 && i < 21)
    const totalDaySessions = dayHours.reduce((sum, h) => sum + h.sessionCount, 0)

    if (
      totalNightSessions >= totalDaySessions &&
      totalNightSessions >= 15 &&
      avg(nightHours.map((h) => h.winRate)) >= 0.12
    ) {
      insights.push({
        type: 'positive',
        text: `Night owl racer. Most sessions after dark, and you're good at it. Late-night grid suits your style.`,
      })
    }
  }

  // Weekend warrior
  {
    const weekendSessions = profile.byDayOfWeek
      .slice(5)
      .reduce((sum, d) => sum + d.sessionCount, 0)
    const weekdaySessions = profile.byDayOfWeek
      .slice(0, 5)
      .reduce((sum, d) => sum + d.sessionCount, 0)

    if (weekendSessions >= weekdaySessions * 2 && weekendSessions >= 12) {
      insights.push({
        type: 'neutral',
        text: `Certified weekend warrior. Most of your ${weekendSessions} sessions happen Sat–Sun. iRacing is your weekend hobby.`,
      })
    }
  }

  // Lunch break racer
  {
    const lunchSessions = profile.byHour
      .filter((h, i) => i >= 11 && i < 14)
      .reduce((sum, h) => sum + h.sessionCount, 0)

    if (lunchSessions >= 8) {
      insights.push({
        type: 'neutral',
        text: `Lunch break grinder. ${lunchSessions} sessions between 11am–2pm. Dedication (or understanding boss).`,
      })
    }
  }

  // Consistency paradox
  {
    const allSlices = [
      ...profile.byHour.filter((h) => h.sessionCount >= 2),
      ...profile.byDayOfWeek.filter((d) => d.sessionCount >= 2),
    ]

    const positions = allSlices
      .map((s) => s.avgPosition)
      .filter((p) => p !== null) as number[]

    if (positions.length >= 5) {
      const posVariance = stdDev(positions)
      const winRates = allSlices.map((s) => s.winRate)
      const winVariance = stdDev(winRates)

      if (posVariance <= 1 && winVariance >= 0.15) {
        insights.push({
          type: 'neutral',
          text: `Paradox: identical positions (${posVariance.toFixed(2)}σ) but wildly swinging win rate. Strategy or luck?`,
        })
      }
    }
  }

  // Heatmap anomaly
  {
    if (profile.heatmapData.length >= 10) {
      const maxScore = Math.max(...profile.heatmapData.map((h) => h.score))
      const avgScore = avg(profile.heatmapData.map((h) => h.score))

      if (maxScore >= avgScore * 2) {
        const anomaly = maxBy(profile.heatmapData, (h) => h.score)
        if (anomaly) {
          const dayLabel = getDayLabel(anomaly.day)
          insights.push({
            type: 'positive',
            text: `Hot spot. ${dayLabel} at ${getHourLabel(anomaly.hour)} is a goldmine (${anomaly.score.toFixed(2)}x average). Mark it.`,
          })
        }
      }
    }
  }

  // Bi-weekly pattern
  {
    const hoursWithData = profile.byHour.filter((h) => h.sessionCount >= 3)
    if (hoursWithData.length >= 8) {
      const alternatingGood = hoursWithData.some((h) => h.winRate >= 0.15)
      const alternatingBad = hoursWithData.some((h) => h.winRate <= 0.05)

      if (alternatingGood && alternatingBad && profile.byDayOfWeek.length >= 6) {
        const dayVariance = stdDev(profile.byDayOfWeek.map((d) => d.winRate))
        if (dayVariance >= 0.16) {
          insights.push({
            type: 'neutral',
            text: `On-off pattern detected. Alternating hot and cold stretches. Setup-tuning cycles or practice investment.`,
          })
        }
      }
    }
  }

  // Lunch hour sweet spot (extended)
  {
    const noon = profile.byHour.filter((h, i) => i >= 11 && i < 13)
    const totalNoon = noon.reduce((sum, h) => sum + h.sessionCount, 0)
    const avgNoonWinRate = avg(noon.map((h) => h.winRate))
    const avgNoonPos = avg(noon.map((h) => h.avgPosition))

    if (totalNoon >= 5 && avgNoonWinRate >= 0.18 && avgNoonPos && avgNoonPos <= 3) {
      insights.push({
        type: 'positive',
        text: `Noon is your secret weapon. Lunch-hour sessions average ${avgNoonPos.toFixed(1)}th place with ${(avgNoonWinRate * 100).toFixed(0)}% wins. Dominating.`,
      })
    }
  }

  // ============================================================================
  // CLEANUP: PREVENT DUPLICATE TYPES
  // ============================================================================

  // Remove duplicates while preserving order
  const seen = new Set<string>()
  return insights.filter((insight) => {
    const key = `${insight.type}:${insight.text.substring(0, 30)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
