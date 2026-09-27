# Telemetry Sidecar Schema

> JSONL line shape produced by `prodrive-overlay`'s recorder and consumed by
> `prodrive-designer`'s replayer mapper. Frozen here so any field added to one
> side gets mirrored on the other.

## Files

- **Producer:** [`prodrive-overlay/modules/js/telemetry-sidecar.js`](../apps/overlay) — `captureFrame()` writes one line per ~30fps poll.
- **Consumer:** [`prodrive-designer/replayer/sidecar-mapper.js`](https://github.com/DOOOOM/prodrive-designer/blob/main/replayer/sidecar-mapper.js) — `frameToPropBag()` inverts each line back into the flat plugin-shape prop bag the dashboard polls.

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

## Per-frame rows

Field names are intentionally short to keep file size down — at 30fps this accumulates fast.

| Field | Type | Source property | Notes |
|------|------|----------------|-------|
| `t` | `number` | — | Seconds since recording start, 3-decimal precision |
| `frame` | `number` | — | Monotonic counter from 0 |
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
| `gear` | `number` | `DataCorePlugin.GameData.Gear` | -1=R, 0=N, 1+=fwd |
| `steer` | `number` | `DataCorePlugin.GameRawData.Telemetry.SteeringWheelAngle` | Radians |
| **G-forces** | | | |
| `latG` | `number` | `RacingDesk.Plugin.DS.LatG` | g |
| `longG` | `number` | `RacingDesk.Plugin.DS.LongG` | g |
| **Incidents & flags** | | | |
| `incidents` | `number` | `RacingDesk.Plugin.DS.IncidentCount` | |
| `flag` | `string` | `RacingDesk.Plugin.DS.FlagState` | `green`, `yellow`, `red`, `blue`, `white`, `checkered`, `none` |
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
| `closestCar` | `number` | `RacingDesk.Plugin.DS.ClosestCarDistance` | Metres |
| `sessionState` | `number` | `RacingDesk.Plugin.Grid.SessionState` | |
| `endOfRace` | `boolean` | `RacingDesk.Plugin.DS.IsEndOfRace` | |

## Summary line (`_type: "summary"`)

Written by `stop()` after flushing the buffer.

| Field | Type | Notes |
|------|------|-------|
| `_type` | `"summary"` | Discriminator |
| `frames` | `number` | Total frames captured |
| `durationMs` | `number` | Wall-clock duration in ms |
| `markers` | `Marker[]` | Detected events (incidents, position changes, lap completions, pit entry/exit) |

### Marker shape

```ts
type Marker =
  | { type: 'incident',         frame: number, t: number, from: number, to: number }
  | { type: 'position_change',  frame: number, t: number, from: number, to: number, direction: 'gained' | 'lost' }
  | { type: 'new_lap',          frame: number, t: number, lap: number }
  | { type: 'pit_entry',        frame: number, t: number }
  | { type: 'pit_exit',         frame: number, t: number };
```

## Adding a new field — the contract

When you add a field to the producer (`telemetry-sidecar.js`), the consumer (`sidecar-mapper.js`) **must** be updated in the same change-set so the dashboard sees the data on replay. Older recordings without the field default to `0` / empty in the mapper — backwards-compatible.

1. Add to the `frame = { ... }` literal in `captureFrame()`. Use a short, descriptive key (`px` not `playerXNormalized`).
2. Map it back in `frameToPropBag()`. Use `num(frame.<key>)` to default 0 for old files.
3. Add a row to this doc.
4. If it changes the shape of an existing field or removes one, bump `schemaVersion` in `writeHeader()` and add a migration note here.
