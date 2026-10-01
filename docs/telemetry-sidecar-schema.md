# Telemetry Sidecar Schema

> JSONL line shape written beside a recording and read by the editor (`apps/edit`). Frozen here so any field added to
> one side gets mirrored on the other.

## Files

- **Producer:** [`apps/overlay/modules/js/telemetry-sidecar.js`](../apps/overlay/modules/js/telemetry-sidecar.js) — since 2026-09-30 a pure
  module written by the main process (`modules/js/obs/recording.js` polls `:8889/racing-desk/` at 30 Hz while OBS records a live sim
  session), one line per poll. It was the HUD page's, which stopped with a reload or the garage.
- **Consumer:** `apps/edit/src/ingest/parse-telemetry.js`, and `prodrive-designer`'s replayer mapper (archived).
- **Where:** `<video>.telemetry.jsonl`, the video's name with its extension swapped, beside the file OBS wrote.

## Since OBS (2026-09-30): what changed, all additive (schemaVersion stays 1)

- Every frame carries the sim's own clock, `sn` (iRacing's `SessionNum`) and `st` (`SessionTime`, seconds), present only
  where the sim said them: a moment in the sidecar is found again in iRacing's replay by them.
- The header carries `producer` (`"obs"`), `obsOutputPath` (the file OBS wrote), `videoStartUtc` (when the recording's STARTED
  event arrived, the same instant as `startedAt`) and `videoOffsetMs` (what to add to `t` to reach video time; `0` until a
  better one is read back from the finished file's chapters, a later build).
- The summary carries `stoppedAt`, `obsOutputPath` (the last file, if OBS split it) and `reason` when the recording ended for
  one (`OBS went away`, `Racing Desk quit`).
- `flag` is the payload's one word, `currentFlagState` (it read `DS.FlagState`, which no host sends, so every frame said `green`);
  `none` where there is no word.
- `gear` is the **string** the HUD shows: `"N"`, `"R"`, `"3"` (it turned `N` into `0`). A reader that wants a number takes `R` as
  `-1`, `N` as `0`.
- `closestCar` is no longer written (`DS.ClosestCarDistance` was never sent either). A reader defaults it to 0.
- A marker `{ type: 'file_changed', path, frame, t }` is added when OBS begins a new file mid-recording (file splitting).

## Layout

A `.telemetry.jsonl` file is one JSON value per line:

```
{ "_type": "header", ... }                  ← line 1, written lazily on first frame
{ "t": 0.035, "frame": 0, "pos": 9, ... }   ← per-frame rows
{ "t": 0.068, "frame": 1, ... }
...
{ "_type": "summary", "frames": N, ... }    ← final line on stop()
```

Frame rows are sorted by `t` ascending. The header and summary are filtered out by the consumer's index builder.

## Header line (`_type: "header"`)

Lazy-written on the first `captureFrame()` after `start()`. Reads car / track from the live property bag so it matches whatever the per-frame rows reflect.

| Field | Type | Notes |
|------|------|-------|
| `_type` | `"header"` | Discriminator |
| `schemaVersion` | `number` | Currently `1`. Bump on incompatible changes. |
| `startedAt` | `string` | ISO-8601 timestamp |
| `car` | `string \| null` | `DataCorePlugin.GameData.CarModel` |
| `track` | `string \| null` | `DataCorePlugin.GameData.TrackName` |
| `gameId` | `string \| null` | `iracing`, `acc`, etc. |
| `isDemo` | `boolean` | `true` when DemoMode was active |
| `producer` | `string` | `"obs"` (added 2026-09-30) |
| `obsOutputPath` | `string \| null` | The file OBS wrote, as `RecordStateChanged` STARTED named it |
| `videoStartUtc` | `string` | When STARTED arrived, ISO-8601: a provisional video start |
| `videoOffsetMs` | `number` | Milliseconds to add to `t` for video time; `0` until read back from the file's chapters (a later build) |

## Per-frame rows

Field names are intentionally short to keep file size down — at 30fps this accumulates fast.

| Field | Type | Source property | Notes |
|------|------|----------------|-------|
| `t` | `number` | — | Seconds since recording start, 3-decimal precision |
| `frame` | `number` | — | Monotonic counter from 0 |
| `sn` | `number` | `DataCorePlugin.GameRawData.Telemetry.SessionNum` | iRacing's session number; absent where the sim did not say (added 2026-09-30) |
| `st` | `number` | `DataCorePlugin.GameRawData.Telemetry.SessionTime` | Seconds into that session, 3-decimal; absent where the sim did not say (added 2026-09-30) |
| **Position & race state** | | | |
| `pos` | `number` | `DataCorePlugin.GameData.Position` | Race position |
| `totalCars` | `number` | `RacingDesk.Plugin.Grid.TotalCars` | |
| `gapAhead` | `number` | `IRacingExtraProperties.iRacing_Opponent_Ahead_Gap` | Seconds |
| `gapBehind` | `number` | `IRacingExtraProperties.iRacing_Opponent_Behind_Gap` | Seconds |
| `lap` | `number` | `DataCorePlugin.GameData.CurrentLap` | |
| `sector` | `number` | `RacingDesk.Plugin.DS.CurrentSector` | 1-based |
| `lapDelta` | `number` | `RacingDesk.Plugin.DS.LapDelta` | Seconds |
| **Speed & inputs** | | | |
| `speed` | `number` | `DataCorePlugin.GameData.SpeedMph` | mph |
| `throttle` | `number` | `DataCorePlugin.GameData.Throttle` | 0..1 (or 0..10000% — normalized downstream) |
| `brake` | `number` | `DataCorePlugin.GameData.Brake` | 0..1 |
| `gear` | `string` (was `number`) | `DataCorePlugin.GameData.Gear` | The string the HUD shows: `"R"`, `"N"`, `"1"`… (since 2026-09-30; older files have -1=R, 0=N, 1+=fwd) |
| `steer` | `number` | `DataCorePlugin.GameRawData.Telemetry.SteeringWheelAngle` | Radians |
| **G-forces** | | | |
| `latG` | `number` | `RacingDesk.Plugin.DS.LatG` | g |
| `longG` | `number` | `RacingDesk.Plugin.DS.LongG` | g |
| **Incidents & flags** | | | |
| `incidents` | `number` | `RacingDesk.Plugin.DS.IncidentCount` | |
| `flag` | `string` | `currentFlagState` (was `RacingDesk.Plugin.DS.FlagState`, never sent) | `none`, `green`, `yellow`, `red`, `blue`, `white`, `checkered`, `meatball`, `black`, `debris`, `orange` |
| `pit` | `boolean` | `RacingDesk.Plugin.DS.IsInPitLane` | |
| **Fuel** | | | |
| `fuel` | `number` | `DataCorePlugin.GameData.Fuel` | Litres |
| `maxFuel` | `number` | `DataCorePlugin.GameData.MaxFuel` | Litres |
| `fuelLap` | `number` | `DataCorePlugin.Computed.Fuel_LitersPerLap` | Litres/lap (added 2026-04-26) |
| `remLaps` | `number` | `DataCorePlugin.GameData.RemainingLaps` | (added 2026-04-26) |
| **Tires** (added 2026-04-26) | | | |
| `tFL`, `tFR`, `tRL`, `tRR` | `number` | `DataCorePlugin.GameData.TyreTemp{FL,FR,RL,RR}` | °C |
| `wFL`, `wFR`, `wRL`, `wRR` | `number` | `DataCorePlugin.GameData.TyreWear{FL,FR,RL,RR}` | 0..1 |
| **In-car adjustments** (added 2026-04-26) | | | |
| `bb` | `number` | `dcBrakeBias` | Raw plugin value (~30..70 percent) |
| `tc` | `number` | `dcTractionControl` | 0..12 typical |
| `abs` | `number` | `dcABS` | 0..12 typical |
| **Track position** (added 2026-04-26) | | | |
| `px` | `number` | `RacingDesk.Plugin.TrackMap.PlayerX` | 0..100 viewBox coords |
| `py` | `number` | `RacingDesk.Plugin.TrackMap.PlayerY` | 0..100 viewBox coords |
| `hdg` | `number` | `RacingDesk.Plugin.TrackMap.PlayerHeading` | Radians |
| **Proximity & session** | | | |
| `closestCar` | `number` | `RacingDesk.Plugin.DS.ClosestCarDistance` | Metres — **no longer written** (never sent); a reader defaults it to 0 |
| `sessionState` | `number` | `RacingDesk.Plugin.Grid.SessionState` | |
| `endOfRace` | `boolean` | `RacingDesk.Plugin.DS.IsEndOfRace` | |

## Summary line (`_type: "summary"`)

Written by `stop()` after flushing the buffer.

| Field | Type | Notes |
|------|------|-------|
| `_type` | `"summary"` | Discriminator |
| `frames` | `number` | Total frames captured |
| `durationMs` | `number` | Wall-clock duration in ms |
| `markers` | `Marker[]` | Detected events (incidents, position changes, lap completions, pit entry/exit, file changes) |
| `stoppedAt` | `string` | ISO-8601, when the recording ended (added 2026-09-30) |
| `obsOutputPath` | `string \| null` | The last file OBS wrote (differs from the header's after a split) |
| `reason` | `string` | Only when the recording ended for one: `OBS went away`, `Racing Desk quit`, `started again` |

### Marker shape

```ts
type Marker =
  | { type: 'incident',         frame: number, t: number, from: number, to: number }
  | { type: 'position_change',  frame: number, t: number, from: number, to: number, direction: 'gained' | 'lost' }
  | { type: 'new_lap',          frame: number, t: number, lap: number }
  | { type: 'pit_entry',        frame: number, t: number }
  | { type: 'pit_exit',         frame: number, t: number }
  | { type: 'file_changed',     frame: number, t: number, path: string };   // OBS began a new file (a split)
```

## Adding a new field — the contract

When you add a field to the producer (`telemetry-sidecar.js`), the consumer (`sidecar-mapper.js`) **must** be updated in the same change-set so the dashboard sees the data on replay. Older recordings without the field default to `0` / empty in the mapper — backwards-compatible.

1. Add to the `frame = { ... }` literal in `captureFrame()`. Use a short, descriptive key (`px` not `playerXNormalized`).
2. Map it back in `frameToPropBag()`. Use `num(frame.<key>)` to default 0 for old files.
3. Add a row to this doc.
4. If it changes the shape of an existing field or removes one, bump `schemaVersion` in `writeHeader()` and add a migration note here.
