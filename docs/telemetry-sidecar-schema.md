# Telemetry Sidecar Schema

> JSONL line shape written beside a recording and read by the editor (`apps/edit`). Frozen here so any field added to
> one side gets mirrored on the other.

## Files

- **Producer:** [`apps/overlay/modules/js/telemetry-sidecar.js`](../apps/overlay/modules/js/telemetry-sidecar.js) — since 2026-09-30 a pure
  module written by the main process (`modules/js/obs/recording.js` polls `:8889/racing-desk/` at 30 Hz while OBS records a live sim
  session), one line per poll. It was the HUD page's, which stopped with a reload or the garage.
- **Consumer:** `apps/edit/src/ingest/parse-telemetry.js`, and `prodrive-designer`'s replayer mapper (archived).
- **Where:** `<video>.telemetry.jsonl`, the video's name with its extension swapped, beside the file OBS wrote — written
  there, and moved with the video into the recording's folder (`D:\Racing Desk\Recordings\<date track car>\`) once the
  recording has stopped (docs/recording.md). A replay clip saved while the buffer runs gets a sidecar of its own
  (`Replay <date>.telemetry.jsonl`, `kind: "replay"`) in the same folder, or in `Replays` under the recordings folder. A TV
  take (docs/recording.md, TV shots) is `<the recording's video> tv.mp4` in the same folder with `<…> tv.telemetry.jsonl`
  beside it (`kind: "tv"`): its frames are what the sim showed in the replay while the take was recorded, its `pauses` are
  the seeks between the moments, and it has no chapters.

## Since OBS (2026-09-30): what changed, all additive (schemaVersion stays 1)

- Every frame carries the sim's own clock, `sn` (iRacing's `SessionNum`) and `st` (`SessionTime`, seconds), present only
  where the sim said them: a moment in the sidecar is found again in iRacing's replay by them.
- The header carries `producer` (`"obs"`), `kind` (`"recording"`, `"replay"` for a clip the replay buffer saved, or `"tv"` for a TV take),
  `obsOutputPath` (the file OBS wrote), `videoStartUtc` (when the recording's STARTED event arrived, the same instant as
  `startedAt`; for a clip, the clip's start worked out from its end) and `videoOffsetMs` (`0`: a provisional value; **a
  reader takes the summary's**).
- The summary carries `stoppedAt`, `obsOutputPath` (the last file, if OBS split it; the file where it now is, once moved),
  `reason` when the recording ended for one (`OBS went away`, `Racing Desk quit`, `saved` for a clip), **`videoOffsetMs`**
  (what to add to `t` to reach video time, as found once the file was finished), **`alignment`** (how:
  `{ method: "chapters", pairs, spreadMs, fileChapters }` from the chapters Racing Desk sent read back from the file's
  chapter track and paired by name — the tightest; `{ method: "end", videoStartUtc, durationMs, approximate? }` from the
  file's end — a plain MP4, Chapters off, a clip (`endFrom: "request" | "event"`), a file OBS never finalised
  (`approximate: true`); `{ method: "none", why }` when neither could be had, and `videoOffsetMs` is the header's 0; an
  `end` alignment says where the end came from, `endFrom`: `"request"` (StopRecord was sent), `"event"` (OBS's
  STOPPING, for a stop made in OBS) or `"lastSeen"` (the last moment OBS was seen recording, for a recording whose end
  it never told: always `approximate`); a `chapters` alignment says `dropped` when it set aside a pair that strayed), and
  **`chapters`** (`[{ name, frame, t }]`: each chapter sent to OBS, with the t it was sent at in ms; OBS's own "Start" at 0
  is not among them; a chapter is listed once OBS has taken it, so one that never reached OBS is not), and **`pauses`**
  (`[{ from, to }]`, ms of `t`, present when the recording was paused: the video's clock stood still for each, so video
  time is `t + videoOffsetMs` less the lengths of the pauses before it; `videoOffsetMs` is the offset for the frames
  before the first pause, and an alignment of a paused recording is `approximate`).
- `flag` is the payload's one word, `currentFlagState` (it read `DS.FlagState`, which no host sends, so every frame said `green`);
  `none` where there is no word.
- `gear` is the **string** the HUD shows: `"N"`, `"R"`, `"3"` (it turned `N` into `0`). A reader that wants a number takes `R` as
  `-1`, `N` as `0`.
- `closestCar` is no longer written (`DS.ClosestCarDistance` was never sent either). A reader defaults it to 0.
- Markers `{ type: 'recording_paused' }` and `{ type: 'recording_resumed' }` (with `frame` and `t`) are added when OBS pauses
  and resumes the recording.
- A marker `{ type: 'file_changed', path, frame, t }` is added when OBS begins a new file mid-recording (file splitting).
  The sidecar stays one file, named for the file the recording began with.
- A recording Racing Desk lost for a while — it was restarted mid-recording, or OBS could not be reached for half a minute
  and then answered again still recording the same file — goes on in the same sidecar: a `{ "_type": "resumed", "resumedAt",
  "t" }` line (`t`: seconds into the video when it was found again) in place of a second header, and the frames after it
  are numbered from 0 again, with `t` still counted from the video's start. Its final summary carries `resumed: true`. A file
  can therefore hold more than one summary (the one before the gap says why it ended, `OBS went away`): a reader takes the
  header from the first line and the last summary as the file's. `t` goes on from the zero the **header** says
  (`startedAt`), also for a recording of his own that Racing Desk found again, so the frames before and after the gap
  share one offset.
- A recording whose end OBS never told (it crashed, or was stopped while the WebSocket was down) is filed when OBS next
  answers and is not recording it, or when Racing Desk next starts and finds it in its state file: one more summary line
  is appended — the earlier summary's, with the offset, the `alignment` (`endFrom: "lastSeen"`), the file's new path and
  `refiled: true` — and a last line cut short by a crash is left on a line of its own, which a reader skips.

## Layout

A `.telemetry.jsonl` file is one JSON value per line:

```
{ "_type": "header", ... }                  ← line 1, written lazily on first frame
{ "t": 0.035, "frame": 0, "pos": 9, ... }   ← per-frame rows
{ "t": 0.068, "frame": 1, ... }
...
{ "_type": "summary", "frames": N, ... }    ← final line on stop()
```

(A resumed recording has a `{ "_type": "resumed", ... }` line after a summary, more frames, and a last summary: see above.)

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
| `tyreWear` | `string` | `"percent-remaining"`: what `wFL`..`wRR` mean in this file (added 2026-10-01); absent in an older file, whose meaning is mixed (see the Tires rows) |
| `producer` | `string` | `"obs"` (added 2026-09-30) |
| `kind` | `string` | `"recording"`, `"replay"` for a clip the replay buffer saved, or `"tv"` for a TV take (added 2026-10-01) |
| `obsOutputPath` | `string \| null` | The file OBS wrote, as `RecordStateChanged` STARTED named it (a clip: as `ReplayBufferSaved` named it) |
| `videoStartUtc` | `string` | When STARTED arrived, ISO-8601: a provisional video start (a clip: its end less its duration) |
| `videoOffsetMs` | `number` | `0`, provisional: **the summary's is the one to use** |

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
| `wFL`, `wFR`, `wRL`, `wRR` | `number \| null` | `DataCorePlugin.GameData.TyreWear{FrontLeft,FrontRight,RearLeft,RearRight}` | Tread remaining, 0..100 %, 100 = new, as the sim last measured it (iRacing measures in the pits only); `null` where not measured — **a reader must not default it to 0, which would be a bald tyre** (0 on the wire is not a measurement either). A corner whose tyre was changed (a stop with it ticked, or a reset to the pits) reads a new set's 100 until the sim measures it, and `wNew` says which. The header's `tyreWear: "percent-remaining"` says a file has this meaning. Root CLAUDE.md, Tyre wear. A file without that header field was written before 2026-10-01 and its meaning is mixed: a host recorded 0..100 remaining, a SimHub plugin 0..100 remaining (SimHub's own number) or 0..1 worn (its old fallback from the sim's bands), and an unmeasured corner as 0 |
| `wNew` | `number` | `RacingDesk.Plugin.TyreNewSetFlags` | Which of `wFL`..`wRR` are a new set's 100 by assumption, not the sim's measurement: one bit a corner, `PitSvFlags`' bits — 0x01 FL, 0x02 FR, 0x04 RL, 0x08 RR; 0 where every number is the sim's own, and 0 in the demo and from a plugin before the key (added 2026-10-01; absent in files written before it, and a reader defaults it to 0) |
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
| `obsOutputPath` | `string \| null` | The last file OBS wrote (differs from the header's after a split), where it is once filed |
| `reason` | `string` | Only when the recording ended for one: `OBS went away`, `Racing Desk quit`, `started again`, `OBS said it was not recording`, `saved` (a clip) |
| `resumed` | `boolean` | `true` on the summary of a sidecar that was gone on in (it counts only the frames since the `resumed` line) |
| `videoOffsetMs` | `number` | Milliseconds to add to `t` for video time, as found once the file was finished (added 2026-10-01) |
| `alignment` | `object` | How it was found: `{ method: "chapters", pairs, spreadMs, fileChapters, dropped?, approximate? }`, `{ method: "end", videoStartUtc, durationMs, approximate?, endFrom? }` (`endFrom`: `"request"`, `"event"`, `"lastSeen"`; for a clip `"request"` or `"event"` too) or `{ method: "none", why }` (added 2026-10-01) |
| `chapters` | `Chapter[]` | `{ name, frame, t }` for each chapter OBS took, `t` in ms from the provisional start (added 2026-10-01) |
| `pauses` | `{ from, to }[]` | Present when the recording was paused: ms of `t`, the video's clock stood still for each (added 2026-10-01) |
| `refiled` | `boolean` | `true` on a summary added later, when a recording whose end OBS never told was found and filed (added 2026-10-01) |

### Marker shape

```ts
type Marker =
  | { type: 'incident',         frame: number, t: number, from: number, to: number }
  | { type: 'position_change',  frame: number, t: number, from: number, to: number, direction: 'gained' | 'lost' }
  | { type: 'new_lap',          frame: number, t: number, lap: number }
  | { type: 'pit_entry',        frame: number, t: number }
  | { type: 'pit_exit',         frame: number, t: number }
  | { type: 'recording_paused',  frame: number, t: number }   // OBS paused the recording (the video's clock stops)
  | { type: 'recording_resumed', frame: number, t: number }
  | { type: 'file_changed',     frame: number, t: number, path: string };   // OBS began a new file (a split)
```

## Adding a new field — the contract

When you add a field to the producer (`telemetry-sidecar.js`), the consumer (`sidecar-mapper.js`) **must** be updated in the same change-set so the dashboard sees the data on replay. Older recordings without the field default to `0` / empty in the mapper — backwards-compatible.

1. Add to the `frame = { ... }` literal in `captureFrame()`. Use a short, descriptive key (`px` not `playerXNormalized`).
2. Map it back in `frameToPropBag()`. Use `num(frame.<key>)` to default 0 for old files.
3. Add a row to this doc.
4. If it changes the shape of an existing field or removes one, bump `schemaVersion` in `writeHeader()` and add a migration note here.
