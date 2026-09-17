export type MomentType =
  | 'comeback'
  | 'heartbreak'
  | 'win_streak'
  | 'podium_streak'
  | 'clean_streak'
  | 'milestone_irating'
  | 'license_promotion'
  | 'new_track'
  | 'new_car'
  | 'personal_best'
  | 'century'
  | 'iron_man'

export interface Moment {
  type: MomentType
  date: string
  title: string
  description: string
  significance: number // 1-10
  carModel?: string
  trackName?: string
  gameName?: string
}

export interface SessionRecord {
  id: string
  carModel: string
  trackName: string
  finishPosition?: number
  incidentCount: number
  metadata?: {
    completedLaps?: number
    totalLaps?: number
    bestLapTime?: number
    preRaceIRating?: number
    estimatedIRatingDelta?: number
    startedAt?: string
    finishedAt?: string
  }
  createdAt: Date
  gameName: string
  sessionType: string
}

export interface RatingRecord {
  iRating: number
  prevIRating: number
  prevLicense?: string
  license: string
  sessionType?: string
  createdAt: Date
}

const LICENSE_ORDER = ['R', 'D', 'C', 'B', 'A', 'P']

export function detectMoments(
  sessions: SessionRecord[],
  ratingHistory: RatingRecord[],
): Moment[] {
  const moments: Moment[] = []
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

  // milestone_irating
  const iRatingThresholds = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000]
  ratingHistory.forEach((record) => {
    iRatingThresholds.forEach((threshold) => {
      if (record.prevIRating < threshold && record.iRating >= threshold) {
        const significance = Math.min(10, 6 + Math.floor(iRatingThresholds.indexOf(threshold) / 2))
        moments.push({
          type: 'milestone_irating',
          date: new Date(record.createdAt).toISOString(),
          title: `Broke ${threshold} iRating`,
          description: `Reached ${record.iRating} iRating`,
          significance,
        })
      }
    })
  })

  // license_promotion (skip time trials — they report bogus license data)
  ratingHistory.forEach((record) => {
    const st = (record.sessionType || '').toLowerCase()
    const isTT = st.includes('time trial') || st.includes('time_trial') || st.includes('timetrial') || st.includes('lone qual')
    if (isTT) return
    if (record.prevLicense && record.prevLicense !== record.license) {
      const prevIdx = LICENSE_ORDER.indexOf(record.prevLicense)
      const currIdx = LICENSE_ORDER.indexOf(record.license)
      if (currIdx > prevIdx) {
        moments.push({
          type: 'license_promotion',
          date: new Date(record.createdAt).toISOString(),
          title: `Promoted to ${record.license} License`,
          description: `Advanced from ${record.prevLicense} to ${record.license}`,
          significance: 7,
        })
      }
    }
  })

  // win_streak
  let winStreak = 0
  let lastWinDate: Date | null = null
  sortedSessions.forEach((session, idx) => {
    const isWin = session.finishPosition === 1
    if (isWin) {
      winStreak++
      lastWinDate = new Date(session.createdAt)
    } else {
      if (winStreak >= 2) {
        moments.push({
          type: 'win_streak',
          date: lastWinDate!.toISOString(),
          title: `${winStreak} Win Streak`,
          description: `${winStreak} consecutive 1st place finishes`,
          significance: Math.min(9, 5 + winStreak),
          carModel: sortedSessions[idx - 1]?.carModel,
          trackName: sortedSessions[idx - 1]?.trackName,
          gameName: sortedSessions[idx - 1]?.gameName,
        })
      }
      winStreak = 0
      lastWinDate = null
    }
  })
  if (winStreak >= 2) {
    moments.push({
      type: 'win_streak',
      date: lastWinDate!.toISOString(),
      title: `${winStreak} Win Streak`,
      description: `${winStreak} consecutive 1st place finishes`,
      significance: Math.min(9, 5 + winStreak),
      carModel: sortedSessions[sortedSessions.length - 1]?.carModel,
      trackName: sortedSessions[sortedSessions.length - 1]?.trackName,
      gameName: sortedSessions[sortedSessions.length - 1]?.gameName,
    })
  }

  // podium_streak
  let podiumStreak = 0
  let lastPodiumDate: Date | null = null
  sortedSessions.forEach((session, idx) => {
    const isPodium =
      session.finishPosition && session.finishPosition >= 1 && session.finishPosition <= 3
    if (isPodium) {
      podiumStreak++
      lastPodiumDate = new Date(session.createdAt)
    } else {
      if (podiumStreak >= 3) {
        moments.push({
          type: 'podium_streak',
          date: lastPodiumDate!.toISOString(),
          title: `${podiumStreak} Podium Streak`,
          description: `${podiumStreak} consecutive podium finishes`,
          significance: Math.min(7, 5 + podiumStreak - 2),
          carModel: sortedSessions[idx - 1]?.carModel,
          trackName: sortedSessions[idx - 1]?.trackName,
          gameName: sortedSessions[idx - 1]?.gameName,
        })
      }
      podiumStreak = 0
      lastPodiumDate = null
    }
  })
  if (podiumStreak >= 3) {
    moments.push({
      type: 'podium_streak',
      date: lastPodiumDate!.toISOString(),
      title: `${podiumStreak} Podium Streak`,
      description: `${podiumStreak} consecutive podium finishes`,
      significance: Math.min(7, 5 + podiumStreak - 2),
      carModel: sortedSessions[sortedSessions.length - 1]?.carModel,
      trackName: sortedSessions[sortedSessions.length - 1]?.trackName,
      gameName: sortedSessions[sortedSessions.length - 1]?.gameName,
    })
  }

  // clean_streak
  let cleanStreak = 0
  let lastCleanDate: Date | null = null
  sortedSessions.forEach((session, idx) => {
    const isClean = session.incidentCount === 0
    if (isClean) {
      cleanStreak++
      lastCleanDate = new Date(session.createdAt)
    } else {
      if (cleanStreak >= 5) {
        moments.push({
          type: 'clean_streak',
          date: lastCleanDate!.toISOString(),
          title: `${cleanStreak} Clean Race Streak`,
          description: `${cleanStreak} consecutive incident-free races`,
          significance: Math.min(8, 4 + cleanStreak - 4),
          carModel: sortedSessions[idx - 1]?.carModel,
          trackName: sortedSessions[idx - 1]?.trackName,
          gameName: sortedSessions[idx - 1]?.gameName,
        })
      }
      cleanStreak = 0
      lastCleanDate = null
    }
  })
  if (cleanStreak >= 5) {
    moments.push({
      type: 'clean_streak',
      date: lastCleanDate!.toISOString(),
      title: `${cleanStreak} Clean Race Streak`,
      description: `${cleanStreak} consecutive incident-free races`,
      significance: Math.min(8, 4 + cleanStreak - 4),
      carModel: sortedSessions[sortedSessions.length - 1]?.carModel,
      trackName: sortedSessions[sortedSessions.length - 1]?.trackName,
      gameName: sortedSessions[sortedSessions.length - 1]?.gameName,
    })
  }

  // comeback
  sortedSessions.forEach((session) => {
    const isPodium =
      session.finishPosition && session.finishPosition >= 1 && session.finishPosition <= 5
    if (isPodium && session.incidentCount > 0) {
      moments.push({
        type: 'comeback',
        date: new Date(session.createdAt).toISOString(),
        title: 'Comeback Victory',
        description: `Fought through adversity to finish P${session.finishPosition}`,
        significance: 6,
        carModel: session.carModel,
        trackName: session.trackName,
        gameName: session.gameName,
      })
    }
  })

  // personal_best per track
  const trackBests = new Map<string, SessionRecord>()
  sortedSessions.forEach((session) => {
    if (session.finishPosition) {
      const current = trackBests.get(session.trackName)
      if (!current || session.finishPosition! < (current.finishPosition ?? Infinity)) {
        trackBests.set(session.trackName, session)
      }
    }
  })
  trackBests.forEach((session) => {
    moments.push({
      type: 'personal_best',
      date: new Date(session.createdAt).toISOString(),
      title: `Track Best: ${session.trackName}`,
      description: `Achieved P${session.finishPosition} finish at ${session.trackName}`,
      significance: 4,
      carModel: session.carModel,
      trackName: session.trackName,
      gameName: session.gameName,
    })
  })

  // new_track
  const seenTracks = new Set<string>()
  sortedSessions.forEach((session) => {
    if (!seenTracks.has(session.trackName)) {
      seenTracks.add(session.trackName)
      moments.push({
        type: 'new_track',
        date: new Date(session.createdAt).toISOString(),
        title: `New Track: ${session.trackName}`,
        description: `First time racing at ${session.trackName}`,
        significance: 3,
        carModel: session.carModel,
        trackName: session.trackName,
        gameName: session.gameName,
      })
    }
  })

  // new_car
  const seenCars = new Set<string>()
  sortedSessions.forEach((session) => {
    if (!seenCars.has(session.carModel)) {
      seenCars.add(session.carModel)
      moments.push({
        type: 'new_car',
        date: new Date(session.createdAt).toISOString(),
        title: `New Car: ${session.carModel}`,
        description: `First time driving a ${session.carModel}`,
        significance: 3,
        carModel: session.carModel,
        trackName: session.trackName,
        gameName: session.gameName,
      })
    }
  })

  // century (50, 100, 200, 500)
  const centuryMilestones = [50, 100, 200, 500]
  centuryMilestones.forEach((milestone) => {
    if (sortedSessions.length >= milestone) {
      const sessionAtMilestone = sortedSessions[milestone - 1]
      moments.push({
        type: 'century',
        date: new Date(sessionAtMilestone.createdAt).toISOString(),
        title: `${milestone} Races`,
        description: `Completed ${milestone} race sessions`,
        significance: 7,
        carModel: sessionAtMilestone.carModel,
        trackName: sessionAtMilestone.trackName,
        gameName: sessionAtMilestone.gameName,
      })
    }
  })

  // iron_man
  let maxLaps = 0
  let ironManSession: SessionRecord | null = null
  sortedSessions.forEach((session) => {
    const laps = session.metadata?.completedLaps ?? 0
    if (laps > maxLaps) {
      maxLaps = laps
      ironManSession = session
    }
  })
  if (ironManSession !== null && maxLaps > 0) {
    const ims = ironManSession as SessionRecord
    moments.push({
      type: 'iron_man',
      date: new Date(ims.createdAt).toISOString(),
      title: 'Iron Man',
      description: `${maxLaps} laps in a single race`,
      significance: 5,
      carModel: ims.carModel,
      trackName: ims.trackName,
      gameName: ims.gameName,
    })
  }

  // Sort by significance desc, then date desc
  moments.sort((a, b) => {
    if (b.significance !== a.significance) {
      return b.significance - a.significance
    }
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  })

  return moments
}
