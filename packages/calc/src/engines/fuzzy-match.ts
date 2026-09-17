// Fuzzy matching normalization service for cars and tracks across games

export interface CanonicalCar {
  familyKey: string          // e.g., "mclaren-720s-gt3"
  manufacturer: string       // e.g., "McLaren"
  displayName: string        // e.g., "McLaren 720S GT3"
  variants: string[]         // all raw carModel strings that matched
  gameNames: string[]        // games where this car appears
}

export interface CanonicalTrack {
  familyKey: string          // e.g., "spa-francorchamps"
  displayName: string        // e.g., "Spa-Francorchamps"
  variants: { trackName: string; gameName: string }[]
}

const MULTI_WORD_BRANDS = ['aston martin', 'alfa romeo', 'mercedes-amg', 'mercedes amg', 'red bull', 'ktm x-bow']

/**
 * Tokenize input: lowercase, remove special chars except hyphens, split on spaces/hyphens, filter empty
 */
export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^\w\s\-]/g, '')
    .split(/[\s\-]+/)
    .filter(t => t.length > 0)
}

/**
 * Normalize for comparison: lowercase, strip accents, remove punctuation
 */
export function normalizeForComparison(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s\-]/g, '')
    .trim()
}

/**
 * Jaccard similarity: intersection/union of token sets
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a)
  const setB = new Set(b)

  const intersection = new Set([...setA].filter(x => setB.has(x)))
  const union = new Set([...setA, ...setB])

  if (union.size === 0) return 1
  return intersection.size / union.size
}

/**
 * Levenshtein distance: standard dynamic programming implementation
 */
export function levenshteinDistance(a: string, b: string): number {
  const dp: number[][] = Array(a.length + 1)
    .fill(null)
    .map(() => Array(b.length + 1).fill(0))

  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      )
    }
  }

  return dp[a.length][b.length]
}

/**
 * Normalized Levenshtein: 1 - (distance / max(a.length, b.length))
 */
export function normalizedLevenshtein(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  const distance = levenshteinDistance(a, b)
  return 1 - distance / maxLen
}

/**
 * Extract brand name from car model
 * Handle multi-word brands, otherwise take first word
 */
export function extractManufacturer(carModel: string): string {
  const normalized = carModel.toLowerCase()

  for (const brand of MULTI_WORD_BRANDS) {
    if (normalized.startsWith(brand)) {
      return brand
        .split(/[\s\-]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    }
  }

  const firstWord = carModel.split(/[\s\-]/)[0]
  return firstWord.charAt(0).toUpperCase() + firstWord.slice(1)
}

/**
 * Extract car family key: manufacturer + core model tokens
 * Strip: evo, ii, 2024, year numbers, edition words
 * Slugify to kebab-case
 */
export function extractCarFamily(carModel: string): string {
  const manufacturer = extractManufacturer(carModel)
  const manufacturerTokens = manufacturer.toLowerCase().split(/[\s\-]+/)

  let tokens = tokenize(carModel)

  // Remove manufacturer tokens from the start
  let startIdx = 0
  for (const mfgToken of manufacturerTokens) {
    if (tokens[startIdx] === mfgToken) {
      startIdx++
    }
  }
  tokens = tokens.slice(startIdx)

  // Filter out edition words and year numbers
  const skipTokens = new Set([
    'evo', 'ii', '2', '2024', '2023', '2022', '2021', '2020',
    'edition', 'special', 'limited', 'race', 'sport', 'performance',
    'gt2', 'gt3', 'gt4', 'gtc'
  ])

  tokens = tokens.filter(t => !skipTokens.has(t))

  // Build family: manufacturer slug + remaining tokens
  const allTokens = [...manufacturerTokens, ...tokens]
  return allTokens.join('-')
}

/**
 * Group car variants by family key with similarity-based merging
 */
export function groupCarVariants(
  carModels: { carModel: string; gameName: string }[]
): CanonicalCar[] {
  const familyGroups = new Map<string, { carModel: string; gameName: string }[]>()

  // Group by exact familyKey
  for (const car of carModels) {
    const familyKey = extractCarFamily(car.carModel)
    if (!familyGroups.has(familyKey)) {
      familyGroups.set(familyKey, [])
    }
    familyGroups.get(familyKey)!.push(car)
  }

  // Merge groups with high Jaccard similarity
  const groups = Array.from(familyGroups.entries())
  const merged = new Map<string, { carModel: string; gameName: string }[]>()
  const processed = new Set<string>()

  for (let i = 0; i < groups.length; i++) {
    const [keyA, groupA] = groups[i]
    if (processed.has(keyA)) continue

    const mergedGroup = [...groupA]
    processed.add(keyA)

    const tokensA = tokenize(keyA)

    for (let j = i + 1; j < groups.length; j++) {
      const [keyB, groupB] = groups[j]
      if (processed.has(keyB)) continue

      const tokensB = tokenize(keyB)
      const similarity = jaccardSimilarity(tokensA, tokensB)

      if (similarity > 0.6) {
        mergedGroup.push(...groupB)
        processed.add(keyB)
      }
    }

    merged.set(keyA, mergedGroup)
  }

  // Build canonical cars
  return Array.from(merged.entries()).map(([familyKey, cars]) => {
    const uniqueModels = Array.from(new Set(cars.map(c => c.carModel)))
    const games = Array.from(new Set(cars.map(c => c.gameName)))
    const manufacturer = extractManufacturer(uniqueModels[0])
    const displayName = uniqueModels[0]

    return {
      familyKey,
      manufacturer,
      displayName,
      variants: uniqueModels,
      gameNames: games,
    }
  })
}

/**
 * Normalize track name:
 * 1. normalizeForComparison()
 * 2. Remove common prefixes/suffixes
 * 3. Remove layout specifiers after " - "
 * 4. Trim
 */
export function normalizeTrackName(trackName: string): string {
  let normalized = normalizeForComparison(trackName)

  const prefixes = ['circuit de ', 'circuit ', 'autodromo ', 'circuito ']
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length)
    }
  }

  const suffixes = [
    ' international speedway',
    ' raceway',
    ' motorsport park',
    ' circuit',
    ' grand prix circuit',
  ]
  for (const suffix of suffixes) {
    if (normalized.endsWith(suffix)) {
      normalized = normalized.slice(0, -suffix.length)
    }
  }

  // Remove layout specifiers after " - "
  const dashIdx = normalized.indexOf(' - ')
  if (dashIdx !== -1) {
    normalized = normalized.slice(0, dashIdx)
  }

  return normalized.trim()
}

/**
 * Extract track family key: normalizeTrackName + slugify to kebab-case
 */
export function extractTrackFamily(trackName: string): string {
  const normalized = normalizeTrackName(trackName)
  return normalized.replace(/\s+/g, '-')
}

/**
 * Group track variants by family key with similarity-based merging
 */
export function groupTrackVariants(
  tracks: { trackName: string; gameName: string }[]
): CanonicalTrack[] {
  const familyGroups = new Map<string, { trackName: string; gameName: string }[]>()

  // Group by exact familyKey
  for (const track of tracks) {
    const familyKey = extractTrackFamily(track.trackName)
    if (!familyGroups.has(familyKey)) {
      familyGroups.set(familyKey, [])
    }
    familyGroups.get(familyKey)!.push(track)
  }

  // Merge groups with high normalized Levenshtein similarity
  const groups = Array.from(familyGroups.entries())
  const merged = new Map<string, { trackName: string; gameName: string }[]>()
  const processed = new Set<string>()

  for (let i = 0; i < groups.length; i++) {
    const [keyA, groupA] = groups[i]
    if (processed.has(keyA)) continue

    const mergedGroup = [...groupA]
    processed.add(keyA)

    for (let j = i + 1; j < groups.length; j++) {
      const [keyB, groupB] = groups[j]
      if (processed.has(keyB)) continue

      const similarity = normalizedLevenshtein(keyA, keyB)

      if (similarity > 0.7) {
        mergedGroup.push(...groupB)
        processed.add(keyB)
      }
    }

    merged.set(keyA, mergedGroup)
  }

  // Build canonical tracks
  return Array.from(merged.entries()).map(([familyKey, tracks]) => {
    const variants = tracks.map(t => ({
      trackName: t.trackName,
      gameName: t.gameName,
    }))
    const displayName = tracks[0].trackName

    return {
      familyKey,
      displayName,
      variants,
    }
  })
}
