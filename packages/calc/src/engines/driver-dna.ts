export interface DriverDNA {
  consistency: number      // 0-100, low lap time / position variance
  racecraft: number        // 0-100, positions gained, top finishes
  cleanness: number        // 0-100, inverse incident rate
  endurance: number        // 0-100, performance in longer sessions
  adaptability: number     // 0-100, breadth of cars/tracks
  improvement: number      // 0-100, iRating trend (50 = stable)
  wetWeather: number       // 0-100, placeholder at 50
  experience: number       // 0-100, total laps/races driven
}

export interface DriverArchetype {
  major: string        // e.g. "The Professor"
  variant: string      // e.g. "The Surgical Striker"
  majorDescription: string
  variantDescription: string
}

export interface DNAInsight {
  dimension: keyof DriverDNA
  label: string
  value: number
  description: string
  trend: 'improving' | 'declining' | 'stable'
}

interface SessionData {
  finishPosition: number | null
  incidentCount: number | null
  metadata: Record<string, any> | null
  carModel: string
  trackName: string | null
  gameName: string | null
  createdAt: string
}

interface RatingData {
  iRating: number
  prevIRating: number | null
  createdAt: string
}

// ── Scoring helpers ─────────────────────────────────────────────────────────

function stddev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
  return Math.sqrt(variance)
}

function computeRatingSlope(ratingHistory: RatingData[]): number {
  if (ratingHistory.length < 2) return 0
  const sorted = [...ratingHistory].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
  const n = sorted.length
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  sorted.forEach((rating, i) => {
    sumX += i; sumY += rating.iRating; sumXY += i * rating.iRating; sumX2 += i * i
  })
  return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
}

// ── Compute DNA scores ──────────────────────────────────────────────────────

export function computeDriverDNA(sessions: SessionData[], ratingHistory: RatingData[]): DriverDNA {
  // CONSISTENCY
  const trackSessions = new Map<string | null, number[]>()
  sessions.forEach((s) => {
    if (s.finishPosition !== null) {
      if (!trackSessions.has(s.trackName)) trackSessions.set(s.trackName, [])
      trackSessions.get(s.trackName)!.push(s.finishPosition)
    }
  })
  let consistencyScore = 50
  const tracksWithData = Array.from(trackSessions.values()).filter((p) => p.length >= 2)
  if (tracksWithData.length > 0) {
    const avgStddev = tracksWithData.map((p) => stddev(p)).reduce((a, b) => a + b, 0) / tracksWithData.length
    consistencyScore = Math.max(0, Math.min(100, 100 - (avgStddev / 5) * 100))
  }

  // RACECRAFT
  let racecraftScore = 50
  const withPosition = sessions.filter((s) => s.finishPosition !== null)
  if (withPosition.length > 0) {
    let weighted = 0
    withPosition.forEach((s) => {
      const p = s.finishPosition!
      if (p === 1) weighted += 3
      else if (p === 2) weighted += 2
      else if (p === 3) weighted += 1.5
      else if (p <= 5) weighted += 0.5
    })
    racecraftScore = Math.min(100, (weighted / withPosition.length) * 100)
  }

  // CLEANNESS
  let cleannessScore = 50
  const withIncidents = sessions.filter((s) => s.incidentCount !== null)
  if (withIncidents.length > 0) {
    const avgInc = withIncidents.reduce((sum, s) => sum + s.incidentCount!, 0) / withIncidents.length
    cleannessScore = Math.max(0, (1 - avgInc / 8) * 100)
  }

  // ENDURANCE
  let enduranceScore = 50
  let longCount = 0
  sessions.forEach((s) => {
    const m = s.metadata || {}
    if ((m.completedLaps && m.completedLaps > 20) || (m.totalLaps && m.totalLaps > 20)) longCount++
  })
  if (sessions.length > 0) enduranceScore = (longCount / sessions.length) * 100

  // ADAPTABILITY
  const uniqueCars = new Set(sessions.map((s) => s.carModel)).size
  const uniqueTracks = new Set(sessions.map((s) => s.trackName)).size
  const adaptabilityScore = Math.min(100, (Math.log2(uniqueCars * uniqueTracks + 1) / Math.log2(50)) * 100)

  // IMPROVEMENT
  let improvementScore = 50
  if (ratingHistory.length >= 3) {
    const slope = computeRatingSlope(ratingHistory)
    improvementScore = slope > 0
      ? Math.min(100, 50 + (slope / 20) * 50)
      : Math.max(0, 50 + (slope / 20) * 50)
  }

  // WET WEATHER (placeholder)
  const wetWeatherScore = 50

  // EXPERIENCE
  let experienceScore = 50
  let totalLaps = 0
  sessions.forEach((s) => { if (s.metadata?.completedLaps) totalLaps += s.metadata.completedLaps })
  if (totalLaps > 0) {
    experienceScore = Math.min(100, (Math.log10(totalLaps + 1) / Math.log10(5000)) * 100)
  } else {
    experienceScore = Math.min(100, (Math.log10(sessions.length + 1) / Math.log10(200)) * 100)
  }

  return {
    consistency: consistencyScore,
    racecraft: racecraftScore,
    cleanness: cleannessScore,
    endurance: enduranceScore,
    adaptability: adaptabilityScore,
    improvement: improvementScore,
    wetWeather: wetWeatherScore,
    experience: experienceScore,
  }
}

// ── 10 Major Archetypes ─────────────────────────────────────────────────────
// Each major is identified by the dominant trait or trait combination.
// Evaluated in order — first match wins.
// All descriptions are haiku (5-7-5 syllables).

type Dimension = 'consistency' | 'racecraft' | 'cleanness' | 'endurance' | 'adaptability' | 'improvement' | 'experience'
const DIMS: Dimension[] = ['consistency', 'racecraft', 'cleanness', 'endurance', 'adaptability', 'improvement', 'experience']

interface MajorArchetype {
  name: string
  description: string
  test: (dna: DriverDNA, primary: Dimension, secondary: Dimension) => boolean
  variants: VariantDef[]
}

interface VariantDef {
  name: string
  description: string
  test: (dna: DriverDNA, primary: Dimension, secondary: Dimension) => boolean
}

const MAJORS: MajorArchetype[] = [
  // ── 1. The Legend ─────────────────────────────────────────────────────────
  {
    name: 'The Legend',
    description: 'No weakness to find\nmastery in every turn\nthe complete driver',
    test: (dna) => {
      const scores = DIMS.map(d => dna[d])
      return scores.every(s => s >= 65) && scores.filter(s => s >= 75).length >= 5
    },
    variants: [
      { name: 'The GOAT', description: 'All scores touch the sky\nstatistically flawless drive\nperfection achieved', test: (dna) => DIMS.every(d => dna[d] >= 85) },
      { name: 'The Untouchable', description: 'Clean and never wrong\nbarely puts a single wheel\nout of perfect line', test: (dna) => dna.cleanness >= 85 && dna.consistency >= 85 },
      { name: 'The Complete Package', description: 'No weaknesses found\nstill improving every race\nrarest of them all', test: (dna) => dna.improvement >= 70 && DIMS.every(d => dna[d] >= 65) },
      { name: 'The Dynasty Builder', description: 'Years of being great\nexperience paired with skill\na dynasty built', test: (dna) => dna.experience >= 85 },
      { name: 'The Benchmark', description: 'Consistent and great\nthe standard others chase down\nmeasure yourself here', test: (dna) => dna.consistency >= 80 },
      { name: 'The Apex Predator', description: 'Racecraft crowns the rest\nelite in everything else\napex predator', test: (dna) => dna.racecraft >= 80 },
      { name: 'The Ironclad', description: 'Endurance shines bright\ncrowning an already strong\nformidable force', test: (dna) => dna.endurance >= 80 },
      { name: 'The Polymath', description: 'Master of all cars\nadapting to every track\nversatile genius', test: (dna) => dna.adaptability >= 80 },
      { name: 'The Phenom', description: 'Elite yet still climb\nthe best has not arrived yet\nmore to come from you', test: (dna) => dna.improvement >= 75 },
      { name: 'The Champion', description: 'Excellence all round\nin every field of racing\na true champion', test: () => true },
    ],
  },

  // ── 2. The Professor ──────────────────────────────────────────────────────
  {
    name: 'The Professor',
    description: 'Precise and measured\nperformance through repeating\nmethodical craft',
    test: (dna, primary) => primary === 'consistency',
    variants: [
      { name: 'The Surgeon', description: 'Precise cuts through air\ncleanness paired with iron will\nclinical control', test: (dna) => dna.cleanness >= 70 },
      { name: 'The Metronome', description: 'Same result each time\nracecraft locked to steady hands\ndelivering wins', test: (dna) => dna.racecraft >= 60 },
      { name: 'The Iron Wall', description: 'Lap fifty like one\nendurance meets precision\nno fade in your pace', test: (dna) => dna.endurance >= 65 },
      { name: 'The Swiss Army Knife', description: 'Consistent on all\nevery car and every track\nprecision travels', test: (dna) => dna.adaptability >= 65 },
      { name: 'The Rising Tide', description: 'Growing race by race\nconsistency compounds now\nfoundations are set', test: (dna) => dna.improvement >= 65 },
      { name: 'The Stalwart', description: 'Years of steady hands\nexperience reinforced\nprecision runs deep', test: (dna) => dna.experience >= 65 },
      { name: 'The Predictable Force', description: 'They know what you\'ll do\nand still cannot defeat you\nreliable dread', test: (dna) => dna.consistency >= 85 },
      { name: 'The Control Freak', description: 'Nothing left to chance\nyou manage every detail\ncontrol is comfort', test: (dna) => dna.consistency >= 75 },
      { name: 'The Steady Hand', description: 'Rarely a bad day\nmeasured in your every move\nsteady hand prevails', test: (dna) => dna.cleanness >= 55 },
      { name: 'The Calibrator', description: 'Fine-tuning it all\nconsistency the anchor\nbuilding from this base', test: () => true },
    ],
  },

  // ── 3. The Gladiator ──────────────────────────────────────────────────────
  {
    name: 'The Gladiator',
    description: 'Wheel to wheel you fight\nfinding gaps that don\'t exist\nborn to compete hard',
    test: (dna, primary) => primary === 'racecraft',
    variants: [
      { name: 'The Smooth Operator', description: 'Passing without touch\nelite racecraft clean as silk\nsmooth through every gap', test: (dna) => dna.cleanness >= 70 },
      { name: 'The Precision Weapon', description: 'Steady hands that strike\nconsistency fuels the fight\nalways in the spot', test: (dna) => dna.consistency >= 65 },
      { name: 'The Closer', description: 'Late race is your stage\nracecraft sharpens as miles pass\nmoves when others fade', test: (dna) => dna.endurance >= 65 },
      { name: 'The Shapeshifter', description: 'Any car you fight\nadapting racecraft to all\nunpredictable', test: (dna) => dna.adaptability >= 65 },
      { name: 'The Prodigy', description: 'Racecraft growing fast\nopponents aren\'t ready yet\nyour next level waits', test: (dna) => dna.improvement >= 65 },
      { name: 'The Old Fox', description: 'Seen every trick twice\nveteran racecraft runs deep\nwise beyond the wheel', test: (dna) => dna.experience >= 70 },
      { name: 'The Bulldozer', description: 'Fast but physical\nraw speed with room to refine\npower over grace', test: (dna) => dna.cleanness < 40 },
      { name: 'The Assassin', description: 'Strike without warning\nclinical overtakes land\nthey never see you', test: (dna) => dna.racecraft >= 85 },
      { name: 'The Street Fighter', description: 'Pack racing is home\nyou thrive in closest combat\nelbow room is yours', test: (dna) => dna.racecraft >= 70 },
      { name: 'The Contender', description: 'Always in the fight\nstrong racecraft keeps you ahead\npositions are earned', test: () => true },
    ],
  },

  // ── 4. The Guardian ───────────────────────────────────────────────────────
  {
    name: 'The Guardian',
    description: 'Clean lines every lap\nsafety is your sacred vow\nnot a wheel set wrong',
    test: (dna, primary) => primary === 'cleanness',
    variants: [
      { name: 'The Zen Master', description: 'Clean and consistent\ncomplete control at all times\nnothing out of place', test: (dna) => dna.consistency >= 70 },
      { name: 'The Gentleman Racer', description: 'Win with deep respect\nclean racecraft earns the trophies\nhonor on the track', test: (dna) => dna.racecraft >= 60 },
      { name: 'The Marathon Monk', description: 'Clean through every mile\nlong races are your safe space\npatience never breaks', test: (dna) => dna.endurance >= 65 },
      { name: 'The Ambassador', description: 'Clean in every car\nrespected on every track\nambassador\'s grace', test: (dna) => dna.adaptability >= 65 },
      { name: 'The Disciplined Learner', description: 'Clean and getting fast\nbuilding speed without the cost\ndiscipline pays off', test: (dna) => dna.improvement >= 65 },
      { name: 'The Sage', description: 'Wisdom on the track\nyears of clean and careful laps\npristine driving art', test: (dna) => dna.experience >= 70 },
      { name: 'The Untouched', description: 'Vanishing contact\nthe incident chart stays clean\na ghost on the grid', test: (dna) => dna.cleanness >= 90 },
      { name: 'The Pacifist', description: 'Trouble finds you not\nclean laps flow like water runs\navoiding all harm', test: (dna) => dna.cleanness >= 80 },
      { name: 'The Safety Car', description: 'Clean first fast comes next\nsafety rating glows like gold\nspeed will follow soon', test: (dna) => dna.racecraft < 40 },
      { name: 'The Clean Sheet', description: 'Cleanness defines you\nyour identity on track\nspotless is the way', test: () => true },
    ],
  },

  // ── 5. The Marathoner ─────────────────────────────────────────────────────
  {
    name: 'The Marathoner',
    description: 'Built for the long haul\nstronger when the others fade\nmiles are your ally',
    test: (dna, primary) => primary === 'endurance',
    variants: [
      { name: 'The Diesel Engine', description: 'Output never drops\nconsistent through the distance\nyou never slow down', test: (dna) => dna.consistency >= 65 },
      { name: 'The Last-Lap Specialist', description: 'Make your move late on\nendurance fuels the racecraft\nwhen it matters most', test: (dna) => dna.racecraft >= 60 },
      { name: 'The Bulletproof', description: 'Long and clean you run\nfinishing safely each time\nbulletproof resolve', test: (dna) => dna.cleanness >= 70 },
      { name: 'The Nomad', description: 'Distance knows no bounds\nany car at any track\nno borders for you', test: (dna) => dna.adaptability >= 65 },
      { name: 'The Long Game', description: 'Stamina still climbs\nendurance improving fast\nbigger goals await', test: (dna) => dna.improvement >= 60 },
      { name: 'The Road Warrior', description: 'Thousands of long laps\na veteran of distance\nthe road warrior', test: (dna) => dna.experience >= 70 },
      { name: 'The Iron Man', description: 'Built for the longest\ntwenty-four hour races call\nextreme endurance', test: (dna) => dna.endurance >= 85 },
      { name: 'The Grinder', description: 'Patience is your way\nevery race through to the end\nnever giving up', test: (dna) => dna.endurance >= 75 },
      { name: 'The Tortoise', description: 'Slow and steady wins\nendurance over raw speed\nthe pace sustains you', test: (dna) => dna.racecraft < 40 },
      { name: 'The Distance Runner', description: 'Longer races suit\nyou thrive when others all wilt\ndistance is your friend', test: () => true },
    ],
  },

  // ── 6. The Chameleon ──────────────────────────────────────────────────────
  {
    name: 'The Chameleon',
    description: 'Any car will do\nequally at home on all\nversatile and quick',
    test: (dna, primary) => primary === 'adaptability',
    variants: [
      { name: 'The Renaissance Driver', description: 'Mastered through volume\nadaptable and seasoned\nvariety speaks', test: (dna) => dna.experience >= 70 },
      { name: 'The Wildcard', description: 'Dangerous in all\nunpredictable racecraft\nany car a threat', test: (dna) => dna.racecraft >= 60 },
      { name: 'The Diplomat', description: 'Adapting cleanly\nno matter what the car is\ntidy everywhere', test: (dna) => dna.cleanness >= 65 },
      { name: 'The Explorer', description: 'Unfamiliar roads\nlong races in unknown cars\nhandled with such ease', test: (dna) => dna.endurance >= 60 },
      { name: 'The Quick Study', description: 'Every new car clicks\nadaptability still grows\nlearning faster now', test: (dna) => dna.improvement >= 65 },
      { name: 'The Reliable Utility', description: 'Good across the range\nconsistent in every class\nreliable force', test: (dna) => dna.consistency >= 65 },
      { name: 'The World Traveler', description: 'Breadth beyond belief\nthe whole sim racing landscape\nyour playground awaits', test: (dna) => dna.adaptability >= 90 },
      { name: 'The Jack of All Trades', description: 'Good at everything\nmaster of nothing just yet\nbreadth before the depth', test: (dna) => dna.adaptability >= 75 && DIMS.every(d => dna[d] >= 40 && dna[d] <= 70) },
      { name: 'The Sponge', description: 'Natural car feel\nabsorbing new disciplines\nclicks in any seat', test: (dna) => dna.improvement >= 55 },
      { name: 'The Generalist', description: 'Wide foundations laid\nyou\'ve tried a range of racing\nbroad roots growing deep', test: () => true },
    ],
  },

  // ── 7. The Rising Star ────────────────────────────────────────────────────
  {
    name: 'The Rising Star',
    description: 'Steep trajectory\nlearning faster than them all\nskyward bound you climb',
    test: (dna, primary) => primary === 'improvement',
    variants: [
      { name: 'The Hungry Wolf', description: 'Learning how to fight\nimproving racecraft drives rise\nhungry for the win', test: (dna) => dna.racecraft >= 60 },
      { name: 'The Fast Learner', description: 'Clean foundations rise\nrapid growth the proper way\nspeed with discipline', test: (dna) => dna.cleanness >= 65 },
      { name: 'The Builder', description: 'Endurance expands\nbuilding stamina and skill\nmade for bigger things', test: (dna) => dna.endurance >= 60 },
      { name: 'The Evolution', description: 'A moving target\nadapting while improving\ncan\'t be pinned down yet', test: (dna) => dna.adaptability >= 65 },
      { name: 'The Momentum Builder', description: 'Gains are sticking now\nconsistency locks in place\nmomentum compounds', test: (dna) => dna.consistency >= 60 },
      { name: 'The Shooting Star', description: 'Raw natural gift\nmeteoric with few laps\ntalent before time', test: (dna) => dna.experience < 40 },
      { name: 'The Late Bloomer', description: 'Found a brand new gear\nimproving despite the years\nsecond wind has come', test: (dna) => dna.experience >= 70 },
      { name: 'The Rocket', description: 'Rating climbing fast\nsoaring upward without pause\nlike a rocket launch', test: (dna) => dna.improvement >= 85 },
      { name: 'The Breakout', description: 'Something clicked at last\nnow the upswing is for real\nfire cannot be stopped', test: (dna) => dna.improvement >= 70 },
      { name: 'The Climber', description: 'Each race a bit more\nsteady upward step by step\nalways getting there', test: () => true },
    ],
  },

  // ── 8. The Veteran ────────────────────────────────────────────────────────
  {
    name: 'The Veteran',
    description: 'Thousands of laps run\nknowledge forged through countless miles\nexperience speaks',
    test: (dna, primary) => primary === 'experience',
    variants: [
      { name: 'The Ironman', description: 'Distance veteran\nlong races twice familiar\nseen it all before', test: (dna) => dna.endurance >= 65 },
      { name: 'The Journeyman', description: 'Many roads traveled\nvast experience runs wide\na true all-rounder', test: (dna) => dna.adaptability >= 65 },
      { name: 'The Wise Elder', description: 'Wisdom wears no marks\nyears of clean and careful craft\npristine veteran', test: (dna) => dna.cleanness >= 70 },
      { name: 'The Wily Veteran', description: 'Every trick is known\nyears of racecraft forged in fire\nthe wise fox still hunts', test: (dna) => dna.racecraft >= 60 },
      { name: 'The Evergreen', description: 'Still improving now\nage is nothing but a word\nthe green never fades', test: (dna) => dna.improvement >= 65 },
      { name: 'The Reliable Machine', description: 'Deep roots steady fruit\nexperience delivers\nalways counted on', test: (dna) => dna.consistency >= 65 },
      { name: 'The Hall of Famer', description: 'More laps than most dream\na library of knowledge\nimmortal on track', test: (dna) => dna.experience >= 90 },
      { name: 'The Plateau', description: 'Vast experience\nold habits may need breaking\nsearch for the new path', test: (dna) => dna.improvement < 40 },
      { name: 'The Seasoned Pro', description: 'Deep experience\nit shows in every choice made\nthe seasoned pro drives', test: (dna) => dna.experience >= 75 },
      { name: 'The Campaigner', description: 'Many races run\nevery lap adds to the whole\nthe library grows', test: () => true },
    ],
  },

  // ── 9. The Underdog ───────────────────────────────────────────────────────
  {
    name: 'The Underdog',
    description: 'Room to grow each day\nevery racer starts somewhere\nyour time is coming',
    test: (dna) => {
      const scores = DIMS.map(d => dna[d])
      return scores.every(s => s < 60) || (dna.improvement < 40 && Math.max(...scores) < 65)
    },
    variants: [
      { name: 'The Comeback Kid', description: 'Numbers may be down\nbut fire still burns inside you\nbounce-back season starts', test: (dna) => dna.improvement >= 45 },
      { name: 'The Diamond in the Rough', description: 'Cleanness hints at more\nthe speed will surely follow\ndiamond in the rough', test: (dna) => dna.cleanness >= 50 },
      { name: 'The Scrapper', description: 'Raw racecraft is there\nrefining it unlocks all\nthe scrapper fights on', test: (dna) => dna.racecraft >= 45 },
      { name: 'The Survivor', description: 'You finish each race\nendurance is your foothold\nsurvival counts too', test: (dna) => dna.endurance >= 45 },
      { name: 'The Experimenter', description: 'You have tried it all\nnow it\'s time to specialize\nfocus sharpens blades', test: (dna) => dna.adaptability >= 50 },
      { name: 'The Grizzled Vet', description: 'Years have not yet shown\nfundamentals need review\nexperience waits', test: (dna) => dna.experience >= 60 },
      { name: 'The Work in Progress', description: 'Pieces coming close\nconsistency starts to show\nalmost there keep on', test: (dna) => dna.consistency >= 45 },
      { name: 'The Fixer-Upper', description: 'So much room to grow\nand that means room to succeed\ncelebrate each gain', test: (dna) => DIMS.every(d => dna[d] < 45) },
      { name: 'The Gritty Racer', description: 'Push through the plateau\nresults don\'t reflect the work\ngrit will find a way', test: (dna) => dna.improvement < 35 },
      { name: 'The Hungry Driver', description: 'Every score has room\nfocus on just one to start\nmomentum will build', test: () => true },
    ],
  },

  // ── 10. The Rookie ────────────────────────────────────────────────────────
  {
    name: 'The Rookie',
    description: 'Fresh upon the grid\nevery lap a lesson learned\nthe journey begins',
    test: (dna) => dna.experience < 30,
    variants: [
      { name: 'The Natural', description: 'Raw talent shines through\nstrong racecraft from the first lap\na natural gift', test: (dna) => dna.racecraft >= 60 },
      { name: 'The Clean Slate', description: 'Clean habits from start\nthat discipline will compound\na promising dawn', test: (dna) => dna.cleanness >= 60 },
      { name: 'The Instant Adapter', description: 'Quick to learn new cars\nalready adapting fast\nclicks in any seat', test: (dna) => dna.adaptability >= 55 },
      { name: 'The Quick Starter', description: 'Steep learning curve climbed\nimproving from the first day\nrapid rise begins', test: (dna) => dna.improvement >= 65 },
      { name: 'The Methodical Newcomer', description: 'Building steady now\nconsistency comes early\na smart way to start', test: (dna) => dna.consistency >= 55 },
      { name: 'The Endurance Rookie', description: 'Drawn to longer runs\nrare patience for one so new\nstaying power found', test: (dna) => dna.endurance >= 50 },
      { name: 'The Fearless Rookie', description: 'Bold moves right away\naggressive from the first race\nfear will come later', test: (dna) => dna.racecraft >= 45 && dna.cleanness < 40 },
      { name: 'The Cautious Newcomer', description: 'Careful in the start\nconfidence will bring the speed\nclean before you\'re quick', test: (dna) => dna.cleanness >= 50 && dna.racecraft < 35 },
      { name: 'The Sponge', description: 'Absorbing it all\nevery session stored away\nlessons everywhere', test: (dna) => dna.improvement >= 50 },
      { name: 'The Fresh Face', description: 'Just getting started\na thousand laps will follow\nthe first turn awaits', test: () => true },
    ],
  },
]

// ── Archetype resolver ──────────────────────────────────────────────────────

function getPrimarySecondary(dna: DriverDNA): [Dimension, Dimension] {
  const entries = DIMS.map(d => ({ dim: d, score: dna[d] }))
  entries.sort((a, b) => b.score - a.score)
  return [entries[0].dim, entries[1].dim]
}

export function getDriverArchetype(dna: DriverDNA): DriverArchetype {
  const [primary, secondary] = getPrimarySecondary(dna)

  for (const major of MAJORS) {
    if (!major.test(dna, primary, secondary)) continue

    // Found the major — now find the variant
    for (const variant of major.variants) {
      if (variant.test(dna, primary, secondary)) {
        return {
          major: major.name,
          variant: variant.name,
          majorDescription: major.description,
          variantDescription: variant.description,
        }
      }
    }

    // Shouldn't happen (last variant is always () => true) but fallback
    return {
      major: major.name,
      variant: major.name,
      majorDescription: major.description,
      variantDescription: major.description,
    }
  }

  // Absolute fallback
  return {
    major: 'The Competitor',
    variant: 'The Competitor',
    majorDescription: 'Room to grow from here\na racer on the journey\nevery lap teaches',
    variantDescription: 'Room to grow from here\na racer on the journey\nevery lap teaches',
  }
}

// ── Legacy wrapper (backwards compat) ───────────────────────────────────────

/** @deprecated Use getDriverArchetype which returns major + variant */
export function generateInsights(
  dna: DriverDNA,
  sessions: SessionData[],
  ratingHistory: RatingData[]
): DNAInsight[] {
  const computeTrend = (dimension: keyof DriverDNA): 'improving' | 'declining' | 'stable' => {
    const recentSessions = sessions.slice(-10)
    const previousSessions = sessions.slice(-20, -10)
    if (recentSessions.length === 0 || previousSessions.length === 0) return 'stable'

    let recentScore = 0, previousScore = 0

    if (dimension === 'consistency') {
      const compute = (list: SessionData[]) => {
        const trackMap = new Map<string | null, number[]>()
        list.forEach((s) => { if (s.finishPosition !== null) { if (!trackMap.has(s.trackName)) trackMap.set(s.trackName, []); trackMap.get(s.trackName)!.push(s.finishPosition) } })
        const tracks = Array.from(trackMap.values()).filter((p) => p.length >= 2)
        if (tracks.length === 0) return 50
        const avg = tracks.map((p) => stddev(p)).reduce((a, b) => a + b) / tracks.length
        return Math.max(0, Math.min(100, 100 - (avg / 5) * 100))
      }
      recentScore = compute(recentSessions); previousScore = compute(previousSessions)
    } else if (dimension === 'racecraft') {
      const compute = (list: SessionData[]) => {
        const withPos = list.filter((s) => s.finishPosition !== null)
        if (withPos.length === 0) return 50
        let w = 0; withPos.forEach((s) => { const p = s.finishPosition!; if (p === 1) w += 3; else if (p === 2) w += 2; else if (p === 3) w += 1.5; else if (p <= 5) w += 0.5 })
        return Math.min(100, (w / withPos.length) * 100)
      }
      recentScore = compute(recentSessions); previousScore = compute(previousSessions)
    } else if (dimension === 'cleanness') {
      const compute = (list: SessionData[]) => {
        const wi = list.filter((s) => s.incidentCount !== null)
        if (wi.length === 0) return 50
        const avg = wi.reduce((sum, s) => sum + s.incidentCount!, 0) / wi.length
        return Math.max(0, (1 - avg / 8) * 100)
      }
      recentScore = compute(recentSessions); previousScore = compute(previousSessions)
    } else if (dimension === 'endurance') {
      const compute = (list: SessionData[]) => {
        let c = 0; list.forEach((s) => { const m = s.metadata || {}; if ((m.completedLaps && m.completedLaps > 20) || (m.totalLaps && m.totalLaps > 20)) c++ })
        return list.length > 0 ? (c / list.length) * 100 : 50
      }
      recentScore = compute(recentSessions); previousScore = compute(previousSessions)
    } else if (dimension === 'improvement') {
      const recent = ratingHistory.slice(-10), prev = ratingHistory.slice(-20, -10)
      const calc = (r: RatingData[]) => { if (r.length < 2) return 50; const s = computeRatingSlope(r); return s > 0 ? Math.min(100, 50 + (s / 20) * 50) : Math.max(0, 50 + (s / 20) * 50) }
      recentScore = calc(recent); previousScore = calc(prev)
    } else {
      return 'stable'
    }

    const diff = recentScore - previousScore
    if (diff > 5) return 'improving'
    if (diff < -5) return 'declining'
    return 'stable'
  }

  const descriptions: Record<keyof DriverDNA, (score: number) => string> = {
    consistency: (s) => s >= 85 ? 'Remarkably consistent finishes' : s >= 70 ? 'Fairly stable results' : s >= 50 ? 'Moderate consistency' : 'Results vary quite a bit',
    racecraft: (s) => s >= 80 ? 'Expert wheel-to-wheel competitor' : s >= 65 ? 'Strong podium contender' : s >= 50 ? 'Solid fundamentals' : 'Room to grow in racecraft',
    cleanness: (s) => s >= 85 ? 'Exceptional cleanness' : s >= 70 ? 'Low incident rate' : s >= 50 ? 'Reasonable incident rate' : 'Above-average incidents',
    endurance: (s) => s >= 80 ? 'Excels in long races' : s >= 60 ? 'Handles distance well' : s >= 50 ? 'Some longer race experience' : 'Mostly shorter formats',
    adaptability: (s) => s >= 85 ? 'True all-rounder' : s >= 70 ? 'Wide variety of experience' : s >= 50 ? 'Moderate range' : 'Focused on specific disciplines',
    improvement: (s) => s >= 85 ? 'Climbing steeply' : s >= 65 ? 'Steady improvement' : s >= 50 ? 'Stable skill level' : 'Declining trend',
    wetWeather: () => 'Wet weather data coming soon',
    experience: (s) => s >= 85 ? 'Vast experience' : s >= 70 ? 'Hundreds of laps' : s >= 50 ? 'Moderate experience' : 'Relatively new',
  }

  const labels: Record<keyof DriverDNA, string> = {
    consistency: 'Consistency', racecraft: 'Racecraft', cleanness: 'Cleanness',
    endurance: 'Endurance', adaptability: 'Adaptability', improvement: 'Improvement',
    wetWeather: 'Wet Weather', experience: 'Experience',
  }

  return (Object.keys(labels) as (keyof DriverDNA)[]).map(dim => ({
    dimension: dim, label: labels[dim], value: dna[dim],
    description: descriptions[dim](dna[dim]), trend: computeTrend(dim),
  }))
}
