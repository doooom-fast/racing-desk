#!/usr/bin/env node
/**
 * parse-shtl.js — Convert SimHub .shtl track layout files to racecor CSV format
 *
 * Usage:
 *   node scripts/parse-shtl.js <input.shtl> [output-dir]
 *
 * Output (written to output-dir, defaulting to same dir as input):
 *   <trackId>.csv          — WorldX,WorldZ,LapDistPct (ready for /api/admin/tracks upload)
 *   <trackId>.meta.json    — Track metadata: name, length, sectors, game, car, lap time
 *
 * .shtl format:
 *   Gzip-compressed JSON produced by SimHub's telemetry recorder.
 *   CarCoordinates[].Value = [x, y, z] world-relative position (y = elevation, discarded)
 *   CarCoordinates[].p     = lap distance percentage 0.0–1.0
 *   SectorDefinitions      = { "1": 0.0, "2": 0.328, "3": 0.634 } (lap % boundaries)
 *   HasRelativeCarCoordinates = true  → coords are relative to start position, fine for normalization
 */

import { createReadStream } from 'fs'
import { createGunzip } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'
import { basename, extname, dirname, join, resolve } from 'path'

// ── CLI entry point ────────────────────────────────────────────────────────────

const [,, inputPath, outputDir] = process.argv

if (!inputPath) {
  console.error('Usage: node scripts/parse-shtl.js <input.shtl> [output-dir]')
  process.exit(1)
}

const resolvedInput = resolve(inputPath)
const resolvedOutput = outputDir ? resolve(outputDir) : dirname(resolvedInput)

parseShtl(resolvedInput, resolvedOutput)
  .then(({ csvPath, metaPath, pointCount, trackId }) => {
    console.log(`✓ Parsed ${pointCount} track points`)
    console.log(`  CSV  → ${csvPath}`)
    console.log(`  Meta → ${metaPath}`)
    console.log(`  Track ID: ${trackId}`)
  })
  .catch(err => {
    console.error('Error:', err.message)
    process.exit(1)
  })

// ── Core parser ────────────────────────────────────────────────────────────────

/**
 * Parse a .shtl file and write CSV + metadata to outputDir.
 * @param {string} inputPath  - Absolute path to the .shtl file
 * @param {string} outputDir  - Directory to write output files into
 * @returns {Promise<{ csvPath, metaPath, pointCount, trackId }>}
 */
export async function parseShtl(inputPath, outputDir) {
  const data = await decompressJson(inputPath)
  const { csv, meta } = convertShtl(data)

  const trackId = meta.trackId
  mkdirSync(outputDir, { recursive: true })

  const csvPath  = join(outputDir, `${trackId}.csv`)
  const metaPath = join(outputDir, `${trackId}.meta.json`)

  writeFileSync(csvPath,  csv,                    'utf8')
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')

  return { csvPath, metaPath, pointCount: meta.pointCount, trackId }
}

/**
 * Convert a parsed .shtl JSON object into CSV text and metadata.
 * Pure function — no I/O. Useful for in-process use (e.g. web API route).
 *
 * @param {object} data - Parsed JSON from a .shtl file
 * @returns {{ csv: string, meta: object }}
 */
export function convertShtl(data) {
  const coords = data.CarCoordinates
  if (!Array.isArray(coords) || coords.length === 0) {
    throw new Error('.shtl file contains no CarCoordinates data')
  }

  // Build CSV rows: WorldX,WorldZ,LapDistPct
  // Value[0] = X, Value[1] = Y (elevation, discarded), Value[2] = Z
  const rows = []
  for (const point of coords) {
    const [x, , z] = point.Value   // destructure, skip Y
    const p = point.p
    if (typeof x !== 'number' || typeof z !== 'number' || typeof p !== 'number') continue
    // Skip degenerate last point (SimHub writes [0,0,0] at lap end)
    if (x === 0 && z === 0 && p > 0.99) continue
    rows.push(`${x},${z},${p}`)
  }

  if (rows.length < 10) {
    throw new Error(`Too few valid track points (${rows.length}); minimum is 10`)
  }

  const csv = rows.join('\n')

  // Sector boundaries: convert SimHub's { "1": 0.0, "2": 0.328, "3": 0.634 }
  // to an array of *start percentages*, dropping sector 1 (always 0.0) since
  // the DB stores the intermediate boundaries only.
  // e.g. 3 sectors → [0.328407, 0.634463]
  const sectorDefs = data.SectorDefinitions ?? {}
  const sectorBoundaries = Object.entries(sectorDefs)
    .map(([, v]) => v)
    .sort((a, b) => a - b)
    .filter(v => v > 0)   // drop 0.0 (sector 1 start = lap start)

  // Track ID: use iRacing's TrackName slug directly (e.g. "adelaide", "spa", "silverstone").
  // This matches the internal iRacing identifier and aligns with the master-tracks catalog.
  // For multi-config tracks with a non-trivial config, append it so each layout gets its
  // own map entry (e.g. "silverstone-grand-prix", "nurburgring-nordschleife").
  const trackName   = data.TrackName ?? ''
  const trackConfig = data.TrackConfig ?? ''
  const iracingBase = slugify(trackName) || slugify(data.TrackDisplayName ?? 'unknown-track')
  // Only append config when it meaningfully distinguishes layouts (i.e. there IS a config
  // and it differs from the bare track name).
  const configSlug  = slugify(trackConfig)
  const trackId     = (configSlug && configSlug !== iracingBase)
    ? `${iracingBase}-${configSlug}`
    : iracingBase

  const meta = {
    trackId,
    trackName:       data.TrackName       ?? null,
    trackConfig:     data.TrackConfig     ?? null,
    displayName:     data.TrackDisplayName ?? null,
    trackLengthM:    data.ReportedTrackLength ?? null,
    trackLengthKm:   data.ReportedTrackLength != null
                       ? +(data.ReportedTrackLength / 1000).toFixed(4)
                       : null,
    gameName:        (data.GameCode ?? '').toLowerCase() || null,
    gameReader:      data.GameReader ?? null,
    carModel:        data.CarModel   ?? null,
    carId:           data.CarId      ?? null,

    // Sector info
    sectorCount:     Object.keys(sectorDefs).length || 3,
    sectorBoundaries,          // e.g. [0.328407, 0.634463]

    // Lap timing (informational — not used by track map pipeline)
    lapTime:         data.LapTime  ?? null,
    s1Time:          data.S1Time   ?? null,
    s2Time:          data.S2Time   ?? null,
    s3Time:          data.S3Time   ?? null,
    sectorDetails:   data.SectorDetails ?? [],

    // Recording metadata
    lapId:           data.LapId         ?? null,
    lapNumber:       data.LapNumber     ?? null,
    sessionId:       data.SessionId     ?? null,
    recordDate:      data.RecordDate    ?? null,
    shtlVersion:     data.Version       ?? null,
    hasRelativeCoords: data.HasRelativeCarCoordinates ?? true,

    pointCount: rows.length,
  }

  return { csv, meta }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Decompress a gzip file and parse its contents as JSON.
 * @param {string} filePath
 * @returns {Promise<object>}
 */
function decompressJson(filePath) {
  return new Promise((resolve, reject) => {
    const chunks = []
    createReadStream(filePath)
      .pipe(createGunzip())
      .on('data', chunk => chunks.push(chunk))
      .on('end',  () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (e) {
          reject(new Error(`Failed to parse JSON after decompression: ${e.message}`))
        }
      })
      .on('error', reject)
  })
}

/**
 * Convert a string to a URL/filesystem-safe slug.
 * e.g. "adelaide-Street Circuit" → "adelaide-street-circuit"
 */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
