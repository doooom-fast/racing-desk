# External Data Source Adoption Plan

**Sources:** Lovely Sim Racing repos, TUMFTM racetrack-database, racing-data.org
**Consumers:** RaceCor Overlay (Electron HUD) + Pro Drive Web App

---

## Source Summary

### Lovely Track Data (`lovely-track-data`)
- JSON per track, keyed by SimHub game ID + track ID
- Fields: name, trackId, country (ISO 2-letter), length (meters), pitEntry/pitExit (0.0–1.0 fraction), turn[] (start, end, name), sector[] (marker, name), time[] (reference laps by car class)
- Manifest at `data/manifest.json` groups by game
- Games: iRacing, ACC, AC, AMS2, F1 24/25, LMU
- Corner names sourced from RacingCircuits.info
- ~200+ tracks across all games

### Lovely Car Data (`lovely-car-data`)
- JSON per car, keyed by SimHub car ID
- Fields: carName, carId, carClass (shorthand like GT3/LMP2/TCR), ledNumber, redlineBlinkInterval, ledColor[], ledRpm[] (per-gear RPM thresholds)
- Manifest at `data/manifest.json` groups by game
- Games: iRacing, ACC, AC, AMS2, F1 24/25, LMU, pCars, rFactor2
- ~500+ cars across all games

### Lovely Car Classes (`lovely-car-classes`)
- Single `car-classes.json` mapping full car names → class shorthands
- 51 entries covering GT3, GT4, GTE, LMP2, LMP3, TCR, DTM, INDY, MX5, etc.
- Bridges the gap between game-specific class naming and normalized shorthands

### TUMFTM Racetrack Database
- CSV per track: 4 columns (x_m, y_m, w_tr_right_m, w_tr_left_m)
- Centerline coordinates + track width on both sides
- Separate racelines/ folder with optimal racing line x/y
- 25 tracks (17 F1, 7 DTM, 1 IndyCar)
- Source: OpenStreetMap GPS + satellite imagery
- Quality varies by track — good for well-mapped venues

### racing-data.org
- Racing API with circuit, driver, team, and historical data
- Site was unreachable during research — may be down, paywalled, or geofenced
- Treat as speculative until we can verify availability and terms
- Fallback: skip or revisit later

---

## What We Already Have (Gap Analysis)

### Overlay (`racecor-overlay/data/`)
| Data | Current Source | Gap |
|------|---------------|-----|
| Track name, location, history | `tracks.json` (hand-curated, ~50 tracks) | No corner names, no pit positions, no track length in meters |
| Car name, specs, history | `cars.json` (hand-curated, ~40 cars) | No car class shorthand, no SimHub ID mapping |
| Track SVG maps | Plugin records CSV → API converts to SVG | No independent geometry source for validation |
| Car logos | Cloud API `/api/logos` + local SVG fallback | Coverage gaps for less common manufacturers |

### Web App (`web/src/data/`)
| Data | Current Source | Gap |
|------|---------------|-----|
| Track ID resolution | `iracing-track-map.ts` (250+ entries, iRacing only) | No ACC/LMU/AMS2 game ID mapping |
| Track location/country | `track-metadata.ts` (~80 entries) | Missing many tracks, no track length |
| Track commentary | `commentary_tracks.json` | Corner names are in `famousCorners[]` but incomplete |
| Car commentary | `commentary_cars.json` | Car class is present but not normalized |
| Car class resolution | Inline logic in various components | No canonical class lookup table |
| Master track list | `master-tracks.json` (47 entries) | Small, iRacing-heavy |
| Master brand list | `master-brands.json` (24 brands) | Good coverage, missing some niche brands |
| DB track maps | `trackMaps` table (community uploads) | No pit entry/exit, no corner metadata |
| DB car logos | `carLogos` table (community uploads) | No car class or spec data |

---

## Adoption Plan

### Phase 1: Lovely Track Data → Web + Overlay

**Goal:** Enrich track metadata with corner names, pit positions, track length, and multi-game support.

#### 1a. Ingest pipeline (web)

Create a build-time script (`scripts/ingest-lovely-tracks.ts`) that:

1. Clones or fetches `lovely-track-data` manifest
2. For each iRacing track in the manifest:
   - Match against existing `IRACING_TRACK_MAP` entries by trackId/name fuzzy match
   - Extract: corner names + positions, pit entry/exit, length (meters), country, sector markers
3. For ACC/LMU tracks:
   - Create new entries in a game-aware track map (extend `iracing-track-map.ts` pattern to multi-game, or create `game-track-map.ts`)
4. Output: enriched `track-metadata.ts` with new fields, updated `commentary_tracks.json` with corner names

**New fields to add to `track-metadata.ts`:**
```typescript
interface TrackLocation {
  country: string;
  countryCode: string;
  flag: string;
  city: string;
  // NEW from lovely-track-data:
  lengthMeters?: number;
  pitEntry?: number;      // 0.0–1.0 track fraction
  pitExit?: number;       // 0.0–1.0 track fraction
  corners?: { name: string; start: number; end: number }[];
  sectors?: { name: string; marker: number }[];
}
```

**DB schema extension** — add to `trackMaps` table:
```sql
ALTER TABLE track_maps ADD COLUMN pit_entry DOUBLE PRECISION;
ALTER TABLE track_maps ADD COLUMN pit_exit DOUBLE PRECISION;
ALTER TABLE track_maps ADD COLUMN corners JSONB;        -- [{name, start, end}]
ALTER TABLE track_maps ADD COLUMN lovely_track_id TEXT;  -- for re-sync
```

#### 1b. Overlay consumption

The overlay gets track data from the plugin HTTP API (SimHub properties) and the web API (`/api/tracks`). Two integration points:

1. **Web API enrichment**: When `/api/tracks?trackName=X` is called, return the new corner/pit/length fields alongside existing SVG and sector data. The overlay's `track-map.js` can then render corner name labels on the minimap.

2. **Plugin-side enrichment**: Bundle the lovely-track-data JSON for iRacing into the SimHub plugin's resources. The plugin can emit corner names as a new property (e.g., `RaceCorProDrive.CurrentCorner`) by cross-referencing the driver's track position percentage against the corner start/end ranges. This enables the commentary engine to reference corners by name.

#### 1c. Corner name overlay feature

New module or extension to `track-map.js`:
- Render corner name labels at their start positions on the SVG minimap
- Highlight the current corner based on player's lap distance percentage
- Feed corner name into the commentary system for "Turn 1 / Eau Rouge" callouts

---

### Phase 2: Lovely Car Data + Car Classes → Web + Overlay

**Goal:** Normalize car class resolution and add SimHub ID mapping across games.

#### 2a. Car class lookup table (web)

Create `web/src/data/car-class-map.ts`:

```typescript
// Merge lovely-car-data carClass + lovely-car-classes
export const CAR_CLASS_MAP: Record<string, string> = {
  // From lovely-car-classes (name → shorthand)
  "Ferrari 488 GT3 Evo 2020": "GT3",
  "Porsche 911 GT3 R": "GT3",
  // ...
};

// From lovely-car-data (SimHub carId → class)
export const SIMHUB_CAR_CLASS: Record<string, Record<string, string>> = {
  iracing: {
    "audir8lmsevo2gt3": "GT3",
    "ferrarievogt3": "GT3",
    // ...
  },
  assettocorsacompetizione: { /* ... */ },
};
```

This replaces the inline class-guessing logic scattered across components.

#### 2b. Multi-game car ID resolution (web)

Extend the brand/car mapping pattern used in `iracing-track-map.ts` to cars:

```typescript
// web/src/data/game-car-map.ts
export const GAME_CAR_MAP: Record<string, Record<string, string>> = {
  iracing: {
    "audir8lmsevo2gt3": "audi-r8-lms-evo-ii-gt3",  // → master car ID
    // ...
  },
  assettocorsacompetizione: {
    "audi_r8_lms_evo_ii_gt3": "audi-r8-lms-evo-ii-gt3",
    // ...
  },
};
```

#### 2c. Overlay car class display

The overlay currently shows the car model string from SimHub. With the class lookup:
- `poll-engine.js` can resolve the SimHub car ID → class shorthand
- Display class badge (GT3, LMP2, etc.) alongside the car name in the HUD
- Feed car class into the commentary engine for class-aware callouts

#### 2d. LED/RPM data (stretch goal)

The lovely-car-data includes per-car LED colors and RPM thresholds per gear. This could feed:
- A shift light indicator in the overlay (WebGL or Canvas)
- Accurate redline display calibrated per car
- Not critical but is free data that's already structured

---

### Phase 3: TUMFTM Racetrack Database → Track Map Validation + Racing Lines

**Goal:** Use real-world GPS centerlines to validate/generate track map SVGs and optionally show optimal racing lines.

#### 3a. Track map SVG generation (web)

Current flow: Plugin records CSV from SimHub → upload to web API → CSV-to-SVG conversion. The TUMFTM data provides an independent geometry source:

1. Create `scripts/ingest-tumftm-tracks.ts`:
   - Parse each track CSV (x_m, y_m, w_tr_right_m, w_tr_left_m)
   - Normalize coordinates to a 0–100 viewBox (matching existing SVG pipeline)
   - Generate SVG path using Catmull-Rom → Bézier conversion (same algorithm as existing `csvToSvg`)
   - Store as reference SVGs in the DB or as static assets

2. Use cases:
   - **Fallback SVGs** for tracks where no user has uploaded a plugin-recorded map yet
   - **Validation** — compare plugin-recorded maps against GPS truth to detect drift/errors
   - **Track width rendering** — the width data enables rendering track boundaries, not just centerline

#### 3b. Racing line overlay (overlay)

The TUMFTM racelines/ CSVs contain the mathematically optimal racing line:

1. Convert raceline CSV to SVG path (same normalization as track centerline)
2. New overlay option: render the optimal racing line as a semi-transparent path on the track minimap
3. Show player's current position relative to the optimal line

**Caveat:** Only 25 tracks covered, and these are real-world optimals — sim physics may differ. Label this as "reference line" not "fastest line."

#### 3c. Track width for spotter (stretch goal)

The track width data (left/right in meters) could enhance the spotter module:
- Know the actual track width at any point
- Better proximity calculations for side-by-side warnings
- Identify narrow sections where overtaking is riskier

---

### Phase 4: racing-data.org (Conditional)

**Status:** Site was unreachable during research. Before investing effort:

1. Verify the API is actually live and accessible
2. Check pricing — may be free tier or paid only
3. Assess data overlap with what lovely-* already provides
4. If it offers series schedules, race calendars, or driver/team metadata that we don't get elsewhere, create an integration similar to the iRacing Week Planner fetcher (`iracing-schedule-fetcher.ts`)

**Skip unless** it provides something the other sources don't.

---

## Implementation Priority

| Priority | Phase | Effort | Value | Notes |
|----------|-------|--------|-------|-------|
| **P0** | 1a: Ingest lovely tracks | Medium | High | Corner names + pit positions are the biggest metadata gap |
| **P0** | 2a: Car class lookup | Low | High | Replaces scattered inline logic, enables class-aware features |
| **P1** | 1b: API enrichment | Low | High | Expose new fields through existing `/api/tracks` endpoint |
| **P1** | 1c: Corner names in overlay | Medium | High | Visible feature: corner labels on minimap + commentary |
| **P1** | 2b: Multi-game car map | Medium | Medium | Needed when ACC/LMU support matures |
| **P2** | 2c: Overlay car class display | Low | Medium | Nice-to-have badge in the HUD |
| **P2** | 3a: TUMFTM SVG generation | Medium | Medium | Fallback maps for tracks without user uploads |
| **P3** | 3b: Racing line overlay | Medium | Low | Cool feature but limited to 25 tracks |
| **P3** | 2d: LED/RPM data | Low | Low | Shift light indicator, niche use |
| **P4** | 4: racing-data.org | Unknown | Unknown | Blocked on site availability |
| **P3** | 3c: Track width for spotter | High | Low | Complex integration for marginal spotter improvement |

---

## Data Freshness Strategy

The lovely-* repos are community-maintained and update with new game content. Options:

1. **Snapshot + manual refresh**: Download JSON once, commit to repo, periodically pull updates. Simple but stale-prone.

2. **Build-time fetch**: CI/CD pulls latest from GitHub raw URLs during build. Always fresh but adds an external dependency to the build.

3. **Hybrid**: Commit a snapshot as fallback, but fetch latest at build time when available. Gracefully degrades if GitHub is down.

**Recommendation:** Option 3 (hybrid). The lovely-* data changes slowly (new cars/tracks per sim update, maybe quarterly). A committed snapshot with periodic refresh is the right balance. The ingest script can be run manually or on a schedule.

For TUMFTM: snapshot only. The repo hasn't been updated in years and the data is static (real-world track geometry doesn't change often).

---

## ID Reconciliation

The hardest part of this whole plan is matching IDs across systems:

| System | Track ID Example | Car ID Example |
|--------|-----------------|----------------|
| SimHub (live telemetry) | `"daytona international speedway"` | `"audir8lmsevo2gt3"` |
| Lovely Track Data | `"daytona-international-speedway-road"` | `"audir8lmsevo2gt3"` |
| Pro Drive (web DB) | `"daytona-road"` | n/a (brand-level only) |
| IRACING_TRACK_MAP | `"Daytona International Speedway"` → `"daytona-road"` | n/a |
| TUMFTM | `"Sakhir"` (25 tracks only) | n/a |
| Commentary JSON | `"daytona"` key | `"audi r8 lms evo ii gt3"` substring |

The ingest scripts need a reconciliation step:
1. For lovely → ProDrive: match on SimHub game ID + normalized name/slug
2. For TUMFTM → ProDrive: manual mapping table (only 25 tracks, do it once)
3. Build a canonical ID registry that all systems reference

The `iracing-track-map.ts` already solves this for iRacing tracks. Extend the pattern to a `GameEntityResolver` that handles tracks and cars across all games, with the lovely-* SimHub IDs as the primary key (since SimHub is the data source for all live telemetry).
