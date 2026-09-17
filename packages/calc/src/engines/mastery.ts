export interface TrackMastery {
  /**
   * Canonical track id from the `tracks` registry — populated when the
   * resolver matched the session to a canonical track. Null only for
   * legacy/unresolved sessions; the dashboard's SVG lookup should be
   * keyed by this when present and fall back to `trackName` otherwise.
   */
  trackId: string | null
  trackName: string
  familyKey: string
  totalSessions: number
  totalLaps: number
  avgPosition: number | null
  bestPosition: number | null
  avgIncidents: number
  masteryScore: number         // 0-100
  masteryTier: 'bronze' | 'silver' | 'gold' | 'diamond'
  trend: 'improving' | 'declining' | 'stable' | 'new'
  lastRaced: string
  gameNames: string[]
}

export interface CarAffinity {
  manufacturer: string
  brandKey: string
  cars: { carModel: string; gameName: string; sessionCount: number }[]
  totalSessions: number
  totalLaps: number
  avgPosition: number | null
  bestPosition: number | null
  avgIncidents: number
  affinityScore: number        // 0-100
  trend: 'improving' | 'declining' | 'stable'
}

interface RaceSession {
  id: string
  carModel: string
  manufacturer: string
  trackId: string | null
  trackName: string
  finishPosition: number | null
  incidentCount: number
  metadata: Record<string, any> | null
  createdAt: Date
  gameName: string
}

export function computeTrackMastery(sessions: RaceSession[]): TrackMastery[] {
  if (sessions.length === 0) return []

  // Group by canonical trackId when the resolver matched, otherwise by
  // trackName. Two sessions for the same physical track that resolved
  // to the same trackId collapse into one group even if their trackName
  // strings differ (legacy rows vs newly-resolved ones).
  const trackMap = new Map<string, RaceSession[]>()
  for (const session of sessions) {
    const key = session.trackId ?? `name:${session.trackName}`
    if (!trackMap.has(key)) {
      trackMap.set(key, [])
    }
    trackMap.get(key)!.push(session)
  }

  const results: TrackMastery[] = []

  for (const [, trackSessions] of trackMap.entries()) {
    const trackId = trackSessions[0].trackId
    const trackName = trackSessions[0].trackName
    // Basic stats
    const totalSessions = trackSessions.length
    const totalLaps = trackSessions.reduce((sum, s) => {
      const completedLaps = s.metadata?.completedLaps ?? 0
      return sum + completedLaps
    }, 0)

    // Position stats
    const positions = trackSessions
      .filter(s => s.finishPosition !== null)
      .map(s => s.finishPosition as number)

    const avgPosition = positions.length > 0
      ? positions.reduce((a, b) => a + b, 0) / positions.length
      : null
    const bestPosition = positions.length > 0 ? Math.min(...positions) : null

    // Incidents
    const avgIncidents = trackSessions.reduce((sum, s) => sum + s.incidentCount, 0) / totalSessions

    // Game names
    const gameNames = [...new Set(trackSessions.map(s => s.gameName))]

    // Calculate mastery score
    let masteryScore = 0
    {
      // Familiarity (30%): log-based, caps around 20 sessions
      const familiarity = Math.min(1, Math.log(totalSessions + 1) / Math.log(21))

      // Consistency (30%): standard deviation of positions
      let consistency = 0.5
      if (positions.length >= 2) {
        const mean = avgPosition!
        const variance = positions.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / positions.length
        const stddev = Math.sqrt(variance)
        consistency = Math.max(0, Math.min(1, 1 - stddev / Math.max(mean, 1)))
      }

      // Pace (20%): position-based percentile
      let pace = 0
      if (avgPosition !== null) {
        if (avgPosition <= 3) {
          pace = 1.0
        } else if (avgPosition <= 10) {
          pace = (10 - avgPosition) / 7
        } else {
          pace = Math.max(0, (20 - avgPosition) / 10)
        }
      }

      // Cleanness (20%): incident penalty
      const cleanness = Math.max(0, 1 - avgIncidents / 8)

      masteryScore = (familiarity * 0.3 + consistency * 0.3 + pace * 0.2 + cleanness * 0.2) * 100
      masteryScore = Math.min(100, masteryScore)
    }

    // Mastery tier
    let masteryTier: TrackMastery['masteryTier']
    if (masteryScore >= 75) {
      masteryTier = 'diamond'
    } else if (masteryScore >= 50) {
      masteryTier = 'gold'
    } else if (masteryScore >= 25) {
      masteryTier = 'silver'
    } else {
      masteryTier = 'bronze'
    }

    // Trend analysis
    let trend: TrackMastery['trend'] = 'stable'
    if (positions.length === 1) {
      trend = 'new'
    } else if (positions.length >= 6) {
      const first3 = positions.slice(0, 3)
      const last3 = positions.slice(-3)
      const avgFirst = first3.reduce((a, b) => a + b, 0) / first3.length
      const avgLast = last3.reduce((a, b) => a + b, 0) / last3.length

      if (avgLast < avgFirst - 0.5) {
        trend = 'improving'
      } else if (avgLast > avgFirst + 0.5) {
        trend = 'declining'
      }
    }

    // Last raced
    const lastRaced = trackSessions.reduce((latest, s) =>
      s.createdAt > latest.createdAt ? s : latest
    ).createdAt.toISOString()

    // Family key for styling
    const familyKey = trackName.toLowerCase().replace(/[\s&-]+/g, '-')

    results.push({
      trackId,
      trackName,
      familyKey,
      totalSessions,
      totalLaps,
      avgPosition,
      bestPosition,
      avgIncidents,
      masteryScore: Math.round(masteryScore),
      masteryTier,
      trend,
      lastRaced,
      gameNames
    })
  }

  // Sort by mastery score descending
  results.sort((a, b) => b.masteryScore - a.masteryScore)
  return results
}

function extractManufacturer(carModel: string): string {
  const MULTI_WORD = ['aston martin', 'alfa romeo', 'mercedes-amg', 'mercedes amg', 'red bull', 'ktm x-bow']
  // Series/organization prefixes that appear in iRacing car names before the actual brand.
  // Stripped iteratively so "NASCAR Cup Toyota Camry" → "Toyota Camry" → "Toyota".
  // Order longer-first so "next gen" wins over "gen" when both could match.
  const SERIES_PREFIXES = [
    'next gen',
    'global', 'fia', 'imsa', 'sro', 'super',
    'nascar', 'usac', 'arca', 'indycar', 'v8',
    'cup', 'xfinity', 'truck', 'supercars', 'supercar', 'gen6', 'gen', 'series',
    'menards', // ARCA Menards Series sponsor
  ]
  let lower = carModel.toLowerCase()
  let model = carModel

  // Strip leading series prefixes iteratively until none match
  let stripped = true
  while (stripped) {
    stripped = false
    for (const prefix of SERIES_PREFIXES) {
      if (lower.startsWith(prefix + ' ')) {
        model = model.slice(prefix.length).trim()
        lower = model.toLowerCase()
        stripped = true
        break
      }
    }
  }

  for (const brand of MULTI_WORD) {
    if (lower.startsWith(brand)) {
      return model.slice(0, brand.length).replace(/\b\w/g, c => c.toUpperCase())
    }
  }

  return model.split(' ')[0] || 'Unknown'
}

export function computeCarAffinity(sessions: RaceSession[]): CarAffinity[] {
  if (sessions.length === 0) return []

  // Group by manufacturer
  // Treat generic/series names like "Global" as missing so we extract the real brand from the car model
  const GENERIC_MANUFACTURERS = new Set(['global', 'fia', 'imsa', 'sro', 'nascar', 'usac', 'arca', 'indycar', 'v8'])
  const manufacturerMap = new Map<string, RaceSession[]>()
  for (const session of sessions) {
    const raw = session.manufacturer?.trim()
    const isGeneric = !raw || GENERIC_MANUFACTURERS.has(raw.toLowerCase())
    const manufacturer = isGeneric ? extractManufacturer(session.carModel) : raw
    if (!manufacturerMap.has(manufacturer)) {
      manufacturerMap.set(manufacturer, [])
    }
    manufacturerMap.get(manufacturer)!.push(session)
  }

  const results: CarAffinity[] = []

  for (const [manufacturer, mfrSessions] of manufacturerMap.entries()) {
    const totalSessions = mfrSessions.length
    const totalLaps = mfrSessions.reduce((sum, s) => {
      const completedLaps = s.metadata?.completedLaps ?? 0
      return sum + completedLaps
    }, 0)

    // Position stats
    const positions = mfrSessions
      .filter(s => s.finishPosition !== null)
      .map(s => s.finishPosition as number)

    const avgPosition = positions.length > 0
      ? positions.reduce((a, b) => a + b, 0) / positions.length
      : null
    const bestPosition = positions.length > 0 ? Math.min(...positions) : null

    // Incidents
    const avgIncidents = mfrSessions.reduce((sum, s) => sum + s.incidentCount, 0) / totalSessions

    // Build car list
    const carMap = new Map<string, { gameName: string; count: number }[]>()
    for (const session of mfrSessions) {
      const key = `${session.carModel}|${session.gameName}`
      if (!carMap.has(session.carModel)) {
        carMap.set(session.carModel, [])
      }
      const existing = carMap.get(session.carModel)!.find(c => c.gameName === session.gameName)
      if (existing) {
        existing.count++
      } else {
        carMap.get(session.carModel)!.push({ gameName: session.gameName, count: 1 })
      }
    }

    const cars = Array.from(carMap.entries()).map(([carModel, games]) => ({
      carModel,
      gameName: games[0].gameName,
      sessionCount: games.reduce((sum, g) => sum + g.count, 0)
    }))

    // Calculate affinity score (consistency 40%, pace 30%, cleanness 20%, familiarity 10%)
    let affinityScore = 0
    {
      // Consistency (40%)
      let consistency = 0.5
      if (positions.length >= 2) {
        const mean = avgPosition!
        const variance = positions.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / positions.length
        const stddev = Math.sqrt(variance)
        consistency = Math.max(0, Math.min(1, 1 - stddev / Math.max(mean, 1)))
      }

      // Pace (30%)
      let pace = 0
      if (avgPosition !== null) {
        if (avgPosition <= 3) {
          pace = 1.0
        } else if (avgPosition <= 10) {
          pace = (10 - avgPosition) / 7
        } else {
          pace = Math.max(0, (20 - avgPosition) / 10)
        }
      }

      // Cleanness (20%)
      const cleanness = Math.max(0, 1 - avgIncidents / 8)

      // Familiarity (10%)
      const familiarity = Math.min(1, Math.log(totalSessions + 1) / Math.log(21))

      affinityScore = (consistency * 0.4 + pace * 0.3 + cleanness * 0.2 + familiarity * 0.1) * 100
      affinityScore = Math.min(100, affinityScore)
    }

    // Trend analysis
    let trend: CarAffinity['trend'] = 'stable'
    if (positions.length >= 6) {
      const first3 = positions.slice(0, 3)
      const last3 = positions.slice(-3)
      const avgFirst = first3.reduce((a, b) => a + b, 0) / first3.length
      const avgLast = last3.reduce((a, b) => a + b, 0) / last3.length

      if (avgLast < avgFirst - 0.5) {
        trend = 'improving'
      } else if (avgLast > avgFirst + 0.5) {
        trend = 'declining'
      }
    }

    const brandKey = manufacturer.toLowerCase().replace(/[\s-]+/g, '-')

    results.push({
      manufacturer,
      brandKey,
      cars,
      totalSessions,
      totalLaps,
      avgPosition,
      bestPosition,
      avgIncidents,
      affinityScore: Math.round(affinityScore),
      trend
    })
  }

  // Sort by total sessions descending
  results.sort((a, b) => b.totalSessions - a.totalSessions)
  return results
}
